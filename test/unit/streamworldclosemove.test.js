// Large streamed worlds (ROADMAP item 15), phase 2 slice 8 -- close-for-Move.
//
// handoff-next/brief-streamed-worlds-phase2-s8.md: a scripted Move beginning while a dialogue box
// is open on a streamed screen used to be refused outright (shared/project.js's own "Item 4"). This
// slice lifts that refusal by making the box draw down correctly first -- engine/ui.asm's
// ui_tick_move_guard_start/_end arms sw_dlg17_move_close and holds every frame at ui_tick_state
// (never move_tick) until engine/streamworld.asm's sw_dlg17_camrelease (phase 2 slice 7b's own
// drain-acknowledged release) fires; sw_dlg_closeformove_check there then clears the flag and
// returns directly instead of falling into close_ui, so script_active/talk_ent/game_state all
// survive for move_finish's own script_resume to find the suspended Move page again.
//
// Every expected value below is either read directly off a real, driven interact/open/close
// sequence (never hardcoded frame counts -- driveUntil), or computed independently in plain JS from
// engine/script.asm's/engine/entities.asm's own documented contracts (script_active gates
// script_resume's jmp script_run vs jmp box_close; game_state is set once when a scripted event's
// first box opens and only close_ui, at the true end, resets it) -- never read back from the
// routine under test.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { validateProject } from '../../shared/project.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import NES from '../../renderer/emulator/core/nes.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// engine/constants.asm -- hardcoded per CLAUDE.md's own rule (a test that reads the file it is
// checking proves nothing). Resolved by hand-walking the chained zero-page equates with
// test/lib/equates.js as a one-off authoring aid (not shipped here), then transcribed as literals.
const GAME_STATE = 0x25;
const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const MAP_IS_STREAMED = 0xfe;
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const BOX_STATE = 0x40;
const BOX_CLOSED = 0;
const BOX_ENDWAIT = 6;
const ENT_X = 0x0310;
const ENT_Y = 0x0318;
const VRAM_READY = 0x3f;
const VRAM_LEN = 0x3c;
const SW_DLG15_STATE = 0xf3;
const SW_DLG15_IDLE = 0;
const SW_DLG15_DRAINING = 2;
const SW_DLG17_CAMHOLD = 0x07f0;
const SW_DLG17_MOVE_CLOSE = 0x07f1;
const SCRIPT_PTR_LO = 0x47;
const SCRIPT_PTR_HI = 0x48;
const SCRIPT_ACTIVE = 0x49;
const TALK_ENT = 0x3a;
const MV_WHO = 0x94;
const MV_DIR = 0x95;
const MV_LEFT = 0x96;
const MV_ENT = 0x5ff;

const B = 1;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

// ---------------------------------------------------------------------------------------------
// Boot/drive harness -- test/unit/streamworlddialogue.test.js's own conventions, copied locally
// per this codebase's own established per-suite-duplication rule (each ROM-booting suite keeps
// its own boot helper).
// ---------------------------------------------------------------------------------------------

async function buildAndBoot(project, { requireStreamed = true, overrides = null } = {}) {
  if (overrides) project.code = { overrides, files: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-closemove-boot-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    const mem = nes.cpu.mem;
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const addrOf = (label) => {
      const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
      assert.ok(m, `${label} should be a named symbol in game.fns`);
      return parseInt(m[1], 16);
    };
    let frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || (requireStreamed && mem[MAP_IS_STREAMED] !== 1)) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY within 200 frames');
    for (let i = 0; i < 100; i++) nes.frame();
    return { nes, mem, addrOf };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function driveUntil(nes, mem, predicate, maxFrames = 400) {
  let frames = 0;
  while (!predicate(mem) && frames < maxFrames) {
    nes.frame();
    frames++;
  }
  return frames;
}

function walkToEntity(nes, mem, slot, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const targetX = mem[ENT_X + slot];
    const targetY = mem[ENT_Y + slot];
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

function interactEntity(project, { x, y, commands, actorName = 'NPC' }) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: actorName, behavior: 'npc', hp: 1, damage: 0 });
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  screen.entities = screen.entities ?? [];
  const slot = screen.entities.length;
  screen.entities.push({ actorId, x, y, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } });
  return slot;
}

/** One frame's worth of pressing `button`, no extra settle frames -- unlike
 * streamworlddialogue.test.js's own `tap`, callers here need to inspect the very next frame. */
function pressOnce(nes, button) {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
}

/** Walk to the NPC, open the box, drive to BOX_ENDWAIT, and press B once more -- the standard
 * "open and dismiss a one-message Say" sequence (streamworlddialogue.test.js's own
 * driveDialogueToClose), leaving `nes`/`mem` at exactly the frame the dismiss press ran, so a
 * caller can inspect the arm frame and every frame after it one at a time. */
function openAndDismiss(nes, mem, slot) {
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the message must finish typing and reach ENDWAIT before dismissing');
  pressOnce(nes, B);
}

function say(text) {
  return { op: 'say', text };
}
function moveUp(dist) {
  return { op: 'move', who: 'player', dir: 'up', dist };
}
/** Fix round 1, finding A1: an NPC's own scripted Move (mv_who == MOVE_SELF) -- must never touch
 * the player's box at all. */
function moveSelfUp(dist) {
  return { op: 'move', who: 'self', dir: 'up', dist };
}

// ---------------------------------------------------------------------------------------------
// Positive: build
// ---------------------------------------------------------------------------------------------

test('positive build: a Say immediately followed by a player Move on a streamed screen builds clean (Item 4 lifted)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(24)] });
  const errors = validateProject(project).filter((e) => e.severity === 'error');
  assert.deepEqual(errors, [], `close-for-Move must lift the old refusal: ${JSON.stringify(errors)}`);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-closemove-buildclean-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(fs.existsSync(built.romPath));
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Positive: runtime, real interact-driven Say -> Move -> Say
// ---------------------------------------------------------------------------------------------

test('positive runtime: Say -> Move -> Say through the real event pipeline draws the box down, holds the move, then resumes and reopens', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(24), say('Bye.')] });
  const { nes, mem } = await buildAndBoot(project);

  openAndDismiss(nes, mem, slot);
  // The dismiss frame itself: script_resume ran script_op_move in the same frame, so the arm
  // (sw_dlg17_move_close) must already be set, and the box must not simply vanish -- game_state
  // stays ST_DIALOG and script_active stays set the whole time.
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 1, 'the arm frame must set sw_dlg17_move_close');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'game_state must still read ST_DIALOG on the arm frame');
  assert.equal(mem[SCRIPT_ACTIVE], 1, 'script_active must survive the arm frame');
  const talkEntAtArm = mem[TALK_ENT];
  const yAtArm = mem[PLAYER_Y];
  const mvLeftAtArm = mem[MV_LEFT];
  assert.ok(mvLeftAtArm > 0, 'mv_left must already be nonzero -- script_op_move ran this same frame');

  // Held frames: box draws down (BOX_CLOSING -> BOX_CLOSED -> DRAINING), and the player must not
  // move at all while it does -- ui_tick_move_holding routes every one of these frames to
  // text_tick, never move_tick. game_state itself stays ST_DIALOG for the WHOLE scripted event
  // (Say -> Move -> Say), including after the release once the Move is genuinely running, so the
  // hold's own signal is sw_dlg17_move_close, not game_state.
  // Fix round 1, finding A5 (Part B, third bullet): record the CLOSING -> DRAINING -> IDLE trace
  // and its guards (sw_dlg17_camhold, vram_ready) on this SAME real close-for-Move event, not
  // merely move_close/eventual BOX_CLOSED as before.
  const dlgTrace = [];
  let heldFrames = 0;
  while (mem[SW_DLG17_MOVE_CLOSE] === 1 && heldFrames < 60) {
    dlgTrace.push({ dlg: mem[SW_DLG15_STATE], box: mem[BOX_STATE], camhold: mem[SW_DLG17_CAMHOLD], vramReady: mem[VRAM_READY] });
    assert.equal(mem[PLAYER_Y], yAtArm, `frame ${heldFrames}: the player must not move at all while the box draws down`);
    assert.equal(mem[MV_LEFT], mvLeftAtArm, `frame ${heldFrames}: mv_left must not decrement while held`);
    assert.equal(mem[TALK_ENT], talkEntAtArm, `frame ${heldFrames}: talk_ent must not change while held`);
    assert.equal(mem[SCRIPT_ACTIVE], 1, `frame ${heldFrames}: script_active must not change while held`);
    assert.equal(mem[GAME_STATE], ST_DIALOG, `frame ${heldFrames}: game_state must still read ST_DIALOG while held`);
    nes.frame();
    heldFrames++;
  }
  assert.ok(heldFrames < 60, 'the draw-down must actually finish within budget, not stall forever');
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'the release must clear sw_dlg17_move_close');
  assert.equal(mem[SCRIPT_ACTIVE], 1, 'script_active must have survived the whole draw-down');

  // The recorded trace must actually visit the shared closing row/attribute self-loop
  // (box_state == BOX_CLOSING == 5), then DRAINING with box_state already BOX_CLOSED (the same
  // real gap case 3 already found for an ordinary close), with sw_dlg17_camhold raised throughout,
  // before this loop's own exit frame lands back in IDLE -- close-for-Move reuses the identical
  // closing-tail mechanism as an ordinary held close (row 14/15 of TRANSITION_TABLE,
  // test/unit/streamworlddialogue.test.js).
  const closingIndex = dlgTrace.findIndex((s) => s.box === 5 /* BOX_CLOSING */);
  assert.ok(closingIndex >= 0, `the held span must actually visit BOX_CLOSING: ${JSON.stringify(dlgTrace)}`);
  const drainingIndex = dlgTrace.findIndex((s) => s.dlg === SW_DLG15_DRAINING);
  assert.ok(drainingIndex > closingIndex, 'DRAINING must be entered only after the CLOSING row/attribute phase, never before or during it');
  assert.equal(dlgTrace[drainingIndex].box, BOX_CLOSED, 'box_state must already read BOX_CLOSED the instant DRAINING begins');
  assert.ok(dlgTrace.slice(closingIndex, drainingIndex + 1).every((s) => s.camhold === 1), 'sw_dlg17_camhold must stay raised through the whole CLOSING -> DRAINING span');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'this loop\'s own exit frame -- the SAME frame sw_dlg17_move_close cleared, above -- is the DRAINING -> IDLE release close-for-Move shares with an ordinary close');

  // Released: the move now actually proceeds.
  const moveFrames = driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 120);
  assert.ok(moveFrames < 120, 'the held Move must actually complete within budget once released');
  assert.ok(mem[PLAYER_Y] < yAtArm, 'the player must have actually moved (up decreases Y) once released');

  // script_resume must have continued into the second Say -- box_state must leave BOX_CLOSED
  // again (game_state itself stays ST_DIALOG for the whole event, so it cannot signal a reopen).
  const secondOpenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(secondOpenFrames < 60, 'the second Say must actually open -- script_resume must have continued the event, not dropped it');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT normally');
  pressOnce(nes, B);
  const finalCloseFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.ok(finalCloseFrames < 60, 'the whole event must finish and return to ST_GAMEPLAY');
  assert.equal(mem[SCRIPT_ACTIVE], 0, 'script_active must be clear once the whole event has genuinely finished');
});

// ---------------------------------------------------------------------------------------------
// Fix round 1, finding A1: close-for-Move must arm only for the player (mv_who != 0), never for
// an NPC's own scripted Move (mv_who == MOVE_SELF, docs/design-streamed-worlds.md ~1980-1985).
// ---------------------------------------------------------------------------------------------

test('positive (A1): an NPC\'s own scripted Move (mv_who == MOVE_SELF) never force-closes its own box -- close-for-Move exists only for the player', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveSelfUp(24), say('Bye.')] });
  const { nes, mem } = await buildAndBoot(project);
  openAndDismiss(nes, mem, slot);
  assert.equal(mem[MV_WHO], 0, 'sanity: this Move must actually be mv_who == MOVE_SELF');
  assert.ok(mem[MV_LEFT] > 0, 'sanity: script_op_move must actually have started the NPC\'s own Move this frame');
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'the arm frame must never set sw_dlg17_move_close for an NPC\'s own Move');
  const playerYAtArm = mem[PLAYER_Y];
  const npcYAtArm = mem[ENT_Y + slot];

  let sawBoxClosing = false;
  let sawNpcMove = false;
  for (let i = 0; i < 60 && mem[MV_LEFT] !== 0; i++) {
    nes.frame();
    if (mem[BOX_STATE] === 5 /* BOX_CLOSING */) sawBoxClosing = true;
    if (mem[ENT_Y + slot] !== npcYAtArm) sawNpcMove = true;
  }
  assert.equal(mem[MV_LEFT], 0, 'the NPC\'s own Move must actually complete within budget');
  assert.ok(!sawBoxClosing, 'the player\'s box must never enter BOX_CLOSING for an NPC\'s own Move -- close-for-Move must never arm at all');
  assert.ok(sawNpcMove, 'sanity: the NPC must actually have moved');
  assert.equal(mem[PLAYER_Y], playerYAtArm, 'the player must never move for an NPC\'s own scripted Move');
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'sw_dlg17_move_close must never have been set at any point during an NPC\'s own Move');

  const secondOpenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(secondOpenFrames < 60, 'the second Say must open normally once the NPC\'s own Move finishes');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT normally');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the whole NPC-Move event must finish normally');
});

// ---------------------------------------------------------------------------------------------
// Fix round 1, finding A2: independent positive controls -- a nonzero conversation slot with
// post-Move identity/continuation and a later interaction with a DIFFERENT entity, and an
// ordinary-map Move in a mixed project (unmutated, real completion).
// ---------------------------------------------------------------------------------------------

test('positive control (A2): a nonzero talk_ent slot survives its own Say -> Move -> Say untouched, and a later interaction with a DIFFERENT entity gets its own correct talk_ent, not a leftover', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  const fillerSlot = interactEntity(project, { x: 16, y: 16, commands: [say('Filler.')], actorName: 'Filler' });
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(24), say('Bye.')] });
  assert.equal(fillerSlot, 0, 'sanity: the filler must actually be slot 0');
  assert.equal(slot, 1, 'sanity: the real close-for-Move NPC must actually be a nonzero slot');
  const { nes, mem } = await buildAndBoot(project);

  openAndDismiss(nes, mem, slot);
  const talkEntAtArm = mem[TALK_ENT];
  assert.equal(talkEntAtArm, slot, 'talk_ent must read the real NPC\'s own nonzero slot at arm');

  driveUntil(nes, mem, (m) => m[SW_DLG17_MOVE_CLOSE] === 0, 60);
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'sanity: the release must actually fire within budget');
  assert.equal(mem[TALK_ENT], talkEntAtArm, 'talk_ent must still read the same nonzero slot immediately after the release');

  driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 120);
  assert.equal(mem[MV_LEFT], 0, 'the held Move must actually complete');
  assert.equal(mem[TALK_ENT], talkEntAtArm, 'talk_ent must still read the same nonzero slot once the Move has actually finished');

  driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT');
  assert.equal(mem[TALK_ENT], talkEntAtArm, 'talk_ent must still read the same nonzero slot for the second Say');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'sanity: the whole first conversation must finish');

  assert.ok(walkToEntity(nes, mem, fillerSlot), 'the player must actually be able to reach the filler afterward');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the filler\'s own Say must open normally');
  assert.equal(mem[TALK_ENT], fillerSlot, 'talk_ent must now read the filler\'s own slot (0) -- a leftover from the earlier close-for-Move conversation would still show slot 1');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the filler\'s own conversation must finish normally too');
});

test('positive control (A2): an ordinary-map scripted Move in a mixed project runs immediately, unaffected by close-for-Move, which exists only for a streamed screen', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ mixed: true });
  const ordinaryMap = project.maps.find((m) => m.streamed !== true);
  assert.ok(ordinaryMap, 'this fixture must actually carry a non-streamed map alongside the streamed one');
  ordinaryMap.screens[0].entities = ordinaryMap.screens[0].entities ?? [];
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'NPC', behavior: 'npc', hp: 1, damage: 0 });
  const slot = ordinaryMap.screens[0].entities.length;
  ordinaryMap.screens[0].entities.push({
    actorId,
    x: 96,
    y: 96,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [say('Hi.'), moveUp(16), say('Bye.')] }] } }
  });
  project.project.startMap = project.maps.indexOf(ordinaryMap);
  project.project.startScreen = 0;
  const { nes, mem } = await buildAndBoot(project, { requireStreamed: false });
  assert.equal(mem[MAP_IS_STREAMED], 0, 'sanity: must actually have booted onto the ordinary map');
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  const yAtArm = mem[PLAYER_Y];
  pressOnce(nes, B);
  let sawMovementWhileStillOpen = false;
  for (let i = 0; i < 15; i++) {
    nes.frame();
    if (mem[PLAYER_Y] !== yAtArm && mem[BOX_STATE] !== BOX_CLOSED) sawMovementWhileStillOpen = true;
  }
  assert.ok(sawMovementWhileStillOpen, 'the real engine must move the player immediately, before the box has even started to visually close -- close-for-Move must never engage on an ordinary map');
  driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 60);
  assert.equal(mem[MV_LEFT], 0, 'the Move must actually complete');
  assert.notEqual(mem[PLAYER_Y], yAtArm, 'the player must have actually moved');
  driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the whole ordinary-map event must finish normally');
});

// ---------------------------------------------------------------------------------------------
// Sabotage. Each mutation is applied via project.code.overrides (a scratch copy of a real engine
// file with one line changed), never by editing a repository file. One mutation per run.
// ---------------------------------------------------------------------------------------------

function readEngineSource(name) {
  return fs.readFileSync(new URL(`../../engine/${name}`, import.meta.url), 'utf8');
}

function mutateOnce(source, oldLine, newLine, label) {
  const count = source.split(oldLine).length - 1;
  assert.equal(count, 1, `sabotage setup: "${oldLine}" must appear exactly once (${label})`);
  return source.replace(oldLine, newLine);
}

// case 1 --------------------------------------------------------------------------------------

test('sabotage case 1: script_active cleared by the draw-down instead of preserved strands the second Say', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlg_closeformove_check:\n  lda sw_dlg17_move_close\n  beq sw_dlg_closeformove_close_ui\n  lda #0\n  sta sw_dlg17_move_close\n  rts\n',
    'sw_dlg_closeformove_check:\n  lda sw_dlg17_move_close\n  beq sw_dlg_closeformove_close_ui\n  lda #0\n  sta sw_dlg17_move_close\n  sta <script_active\n  rts\n',
    'case 1: script_active wrongly cleared by the draw-down'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(24), say('Bye.')] });

  // Positive control: the real (unmutated) sequence must reach the second Say (already proven by
  // the positive runtime test above) -- this run only needs to show the mutant differs.
  const { nes, mem } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  openAndDismiss(nes, mem, slot);
  driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 200);
  assert.equal(mem[MV_LEFT], 0, 'sanity: the move itself must still complete under this mutant');
  const framesToSecondOpen = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(
    framesToSecondOpen >= 60 && mem[BOX_STATE] === BOX_CLOSED,
    'with script_active wrongly cleared, script_resume must take the box_close branch instead of resuming the second Say -- the second Say must never open'
  );
});

// case 2 --------------------------------------------------------------------------------------

test('sabotage case 2: talk_ent left stale by the draw-down is observably stomped mid-draw-down (a subsequent interact would answer with the wrong entity)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlg_closeformove_check:\n  lda sw_dlg17_move_close\n  beq sw_dlg_closeformove_close_ui\n  lda #0\n  sta sw_dlg17_move_close\n  rts\n',
    'sw_dlg_closeformove_check:\n  lda sw_dlg17_move_close\n  beq sw_dlg_closeformove_close_ui\n  lda #0\n  sta sw_dlg17_move_close\n  lda #0\n  sta <talk_ent\n  rts\n',
    'case 2: talk_ent wrongly clobbered by the draw-down'
  );
  const project = createStreamedProject({});
  // A filler entity first, so the real interact NPC lands at slot 1, not 0 -- talk_ent must read
  // nonzero at arm, or the mutant's own wrong write (to 0) would coincidentally match.
  const streamedMap = project.maps.find((m) => m.streamed === true);
  streamedMap.screens[0].entities = [{ actorId: project.sprites.actors.push({ name: 'Filler', behavior: 'npc', hp: 1, damage: 0 }) - 1, x: 16, y: 16, props: {} }];
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(24), say('Bye.')] });
  assert.equal(slot, 1, 'sanity: the real interact NPC must actually be at a nonzero slot');
  const { nes, mem } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  openAndDismiss(nes, mem, slot);
  const talkEntAtArm = mem[TALK_ENT];
  assert.notEqual(talkEntAtArm, 0, 'sanity: talk_ent must read nonzero at arm for a nonzero-slot NPC');
  driveUntil(nes, mem, (m) => m[SW_DLG17_MOVE_CLOSE] === 0, 60);
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'sanity: the release must actually fire within budget');
  assert.equal(mem[TALK_ENT], 0, 'the mutant must have stomped talk_ent to 0 at the release -- a subsequent interact would misread which entity is being spoken to');
});

// case A1 (mv_who) ----------------------------------------------------------------------------

test('sabotage case A1: removing the mv_who check arms close-for-Move for an NPC\'s own Move too, wrongly force-closing the player\'s box', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlg_cfm_guard:\n  lda <mv_who\n  beq sw_dlg_cfm_guard_go     ; MOVE_SELF -- an NPC\'s own Move, unaffected\n  lda sw_dlg17_move_close\n',
    'sw_dlg_cfm_guard:\n  ; MUTANT (case A1): mv_who check removed -- arms for every mover, not just the player\n  lda sw_dlg17_move_close\n',
    'case A1: mv_who check removed from sw_dlg_cfm_guard'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveSelfUp(24), say('Bye.')] });
  const { nes, mem } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  openAndDismiss(nes, mem, slot);
  assert.equal(mem[MV_WHO], 0, 'sanity: this Move must actually be mv_who == MOVE_SELF');
  let sawBoxClosing = false;
  for (let i = 0; i < 30; i++) {
    nes.frame();
    if (mem[BOX_STATE] === 5 /* BOX_CLOSING */) sawBoxClosing = true;
  }
  assert.ok(sawBoxClosing, 'without the mv_who check, the mutant must wrongly force-close the player\'s box for an NPC\'s own Move -- the real implementation (previous test) never does this at all');
});

// case 3 --------------------------------------------------------------------------------------

test('sabotage case 3: the Move proceeding one frame before the draw-down finishes moves the player while the box is still visually open', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlg_cfm_guard_holding:\n  jmp ui_tick_state           ; hand this frame to the ordinary game_state\n                              ; dispatch (text_tick) instead of move_tick\n',
    'sw_dlg_cfm_guard_holding:\n  jmp sw_dlg_cfm_guard_go     ; MUTANT: fall straight through to move_tick anyway\n',
    'case 3: held frames wrongly proceed to move_tick'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(24), say('Bye.')] });
  const { nes, mem } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  openAndDismiss(nes, mem, slot);
  const yAtArm = mem[PLAYER_Y];
  let sawMovementBeforeClose = false;
  for (let i = 0; i < 30 && mem[GAME_STATE] === ST_DIALOG; i++) {
    nes.frame();
    if (mem[PLAYER_Y] !== yAtArm) sawMovementBeforeClose = true;
  }
  assert.ok(sawMovementBeforeClose, 'the mutant must let the player move while game_state still reads ST_DIALOG (box not yet visually closed)');
});

// case 4 --------------------------------------------------------------------------------------

// A MIXED project -- one streamed map, plus an ordinary map elsewhere -- is the only way the
// mutant's removed map_is_streamed check can matter: the whole dialogue-lifecycle mechanism
// (engine/streamworld.asm) is not even assembled into a project that never streams at all, so a
// wholly non-streamed project could never even reach this mutant's own guarded code.
test('sabotage case 4: the priority patch firing on a non-streamed screen of a streaming-capable project stalls a Move that should proceed immediately', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    '  lda <map_is_streamed\n  beq sw_dlg_cfm_guard_go     ; ordinary map: nothing to close, unaffected\n  lda <box_state\n',
    '  ; MUTANT (case 4): map_is_streamed check removed -- fires on every map\n  lda <box_state\n',
    'case 4: map_is_streamed check removed'
  );
  const project = createStreamedProject({ mixed: true });
  const ordinaryMap = project.maps.find((m) => m.streamed !== true);
  assert.ok(ordinaryMap, 'this fixture must actually carry a non-streamed map alongside the streamed one');
  ordinaryMap.screens[0].entities = ordinaryMap.screens[0].entities ?? [];
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'NPC', behavior: 'npc', hp: 1, damage: 0 });
  const slot = ordinaryMap.screens[0].entities.length;
  ordinaryMap.screens[0].entities.push({
    actorId,
    x: 96,
    y: 96,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [say('Hi.'), moveUp(16), say('Bye.')] }] } }
  });
  project.project.startMap = project.maps.indexOf(ordinaryMap);
  project.project.startScreen = 0;
  const { nes, mem } = await buildAndBoot(project, { requireStreamed: false, overrides: [{ name: 'streamworld.asm', text: mutant }] });
  assert.equal(mem[MAP_IS_STREAMED], 0, 'sanity: must actually have booted onto the ordinary map');
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  const yAtArm = mem[PLAYER_Y];
  pressOnce(nes, B);
  // Confirmed directly (a real, unmutated run of this identical mixed project/scenario): the
  // ordinary engine's own rules run the Move IMMEDIATELY on the dismiss frame, well before the box
  // itself closes -- box_state stays BOX_ENDWAIT (the player visibly moves while the message is
  // still on screen) until the SECOND Say later takes it over. The mutant instead force-closes the
  // box (arming sw_dlg17_move_close and calling box_close, exactly sw_dlg_cfm_guard's own arm
  // branch) -- something ordinary-map dialogue never does -- and stalls the move behind it.
  let sawBoxClosingWhileHeld = false;
  for (let i = 0; i < 15; i++) {
    if (mem[BOX_STATE] === 5 /* BOX_CLOSING */) sawBoxClosingWhileHeld = true;
    nes.frame();
  }
  assert.ok(sawBoxClosingWhileHeld, 'the mutant must wrongly force-close the ordinary-map box (BOX_CLOSING) -- the real engine never puts an ordinary box into BOX_CLOSING here at all');
  // Worse: because sw_dlg17_camhold was never armed at OPEN time on an ordinary map (that is the
  // streamed dialogue mapper's own doing), sw_dlg17_camrelease's release never engages either --
  // the ordinary text.asm close path finishes the whole scripted event on its own schedule
  // regardless, silently dropping the still-unfinished Move: script_active reads 0 (event over)
  // while mv_left is still nonzero, and the player never actually reached the destination.
  driveUntil(nes, mem, (m) => m[SCRIPT_ACTIVE] === 0, 60);
  assert.equal(mem[SCRIPT_ACTIVE], 0, 'sanity: the mutant must still let the event nominally finish');
  assert.notEqual(mem[MV_LEFT], 0, 'the mutant must have silently dropped the Move -- mv_left never reaches 0 despite the event ending');
  assert.equal(mem[PLAYER_Y], yAtArm, 'the mutant must never have actually moved the player at all, unlike the real engine which moves immediately');
});

// case 5 --------------------------------------------------------------------------------------

// Fix round 1, B1 ruling (Chris, 2026-09-26): the original coder brief's own premise for this
// case -- "game_state leaves the dialogue value when the box closes" -- was wrong; game_state
// stays ST_DIALOG for the WHOLE scripted event (Say -> Move -> Say), including after the
// release, exactly as the positive runtime test above already asserts frame by frame. The test
// below (kept as an extra demonstration only, relocated to its new home in sw_dlg_cfm_guard) does
// NOT count as case 5 any more -- the real case 5 is the positive regression immediately after it.

test('demonstration only (not case 5): gating the move dispatch on game_state (which never changes mid-event) deadlocks the held Move forever', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlg_cfm_guard_go:\n  jmp move_tick\n',
    'sw_dlg_cfm_guard_go:\n  lda <game_state\n  cmp #ST_DIALOG\n  beq sw_dlg_cfm_guard_holding\n  jmp move_tick\n',
    'demonstration: wrong game_state gate before move_tick'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(24), say('Bye.')] });
  const { nes, mem } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  openAndDismiss(nes, mem, slot);
  const frames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 200);
  assert.ok(
    frames >= 200 && mem[GAME_STATE] !== ST_GAMEPLAY,
    'with move_tick gated on game_state == ST_DIALOG, the held Move must never be allowed to run at all -- game_state stays ST_DIALOG for the whole scripted event by design, so this must deadlock, not merely delay'
  );
});

// case 5, real (B1 ruling): slice 3's own collision/ownership-edge blocking (sw_move_probe/
// sw_move_probe_solid, engine/streamworld.asm) must still apply normally once a close-for-Move
// Move is actually released and running -- a solid tile stops it exactly like an ordinary
// (non-dialogue) scripted Move, and script_active/talk_ent/game_state all survive the whole
// thing, including the blocked stop and the later Say. move_blocked (engine/entities.asm) zeroes
// mv_left and jmps straight to move_finish/script_resume -- identical continuation shape to a
// Move that reached its full requested distance -- so a blocked Move must resume the script (the
// second Say) exactly as the positive runtime test's own unblocked Move already does.
test('sabotage case 5 / positive: a real Say -> Move event, blocked by a solid tile partway through the released Move, still preserves script_active/talk_ent/game_state and still resumes the second Say', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  // NPC at (200, 112) -- createProject's own default startX/Y (120, 112) already matches the
  // NPC's own y, so walkToEntity only ever moves horizontally to reach it: the player's final y
  // is EXACTLY 112, no diagonal-approach slop on the axis the Move (and the wall) uses.
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(64), say('Bye.')] });
  // A whole solid metatile ROW (all 16 columns) at metatile row 5 (y 80-95) on the interact
  // screen -- wide enough that the small (+/-2px) x slop walkToEntity's own diagonal approach can
  // leave standing does not matter, and starting well below the wall (y=112) with a requested
  // distance (64) that would reach y=48 if nothing blocked it, so the block is unambiguous: the
  // player must stop at the wall, nowhere near the full requested distance.
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  project.metatiles[4].collision = 'solid';
  for (let col = 0; col < 16; col++) screen.metatiles[5 * 16 + col] = 4;
  const { nes, mem } = await buildAndBoot(project);

  openAndDismiss(nes, mem, slot);
  assert.equal(mem[PLAYER_Y], 112, 'sanity: the player must actually be at y=112 (no diagonal-approach slop) before the Move begins');
  const talkEntAtArm = mem[TALK_ENT];
  assert.ok(mem[MV_LEFT] > 0, 'sanity: the arm frame must already have started the Move');

  driveUntil(nes, mem, (m) => m[SW_DLG17_MOVE_CLOSE] === 0, 60);
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'sanity: the release must actually fire within budget');
  assert.equal(mem[SCRIPT_ACTIVE], 1, 'script_active must survive the release');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'game_state must still read ST_DIALOG at the release -- the second Say is still pending');
  assert.equal(mem[TALK_ENT], talkEntAtArm, 'talk_ent must survive the release');

  const moveFrames = driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 120);
  assert.ok(moveFrames < 120, 'the Move must actually finish (blocked, not merely slow) within budget');
  assert.ok(mem[PLAYER_Y] > 48, 'the player must have been blocked well short of the full requested distance (y=48) by the solid row at y 80-95');
  assert.ok(mem[PLAYER_Y] < 112, 'sanity: the player must have actually moved some distance before being blocked');
  assert.equal(mem[SCRIPT_ACTIVE], 1, 'script_active must survive the collision stop');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'game_state must still read ST_DIALOG after the collision stop -- move_blocked\'s jmp move_finish/script_resume must not have ended the event');
  assert.equal(mem[TALK_ENT], talkEntAtArm, 'talk_ent must survive the collision stop');

  const secondOpenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(secondOpenFrames < 60, 'the second Say must actually open -- a blocked Move must resume the script exactly like a completed one');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT normally');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the whole event must finish and return to ST_GAMEPLAY');
  assert.equal(mem[SCRIPT_ACTIVE], 0, 'script_active must be clear once the whole event has genuinely finished');
});

// case 6 --------------------------------------------------------------------------------------

// Fix round 1, finding A3: the previous version of this case called sw_dlg17_camrelease directly
// (test/lib/callroutine.js's own stub) with vram_ready poked, then stopped -- never resuming real
// nes.frame() driving to finish the SAME Move and open the SAME later Say, and the mutant's own
// technique (poking vram_ready between real frame() calls) was shown by the reviewer's own
// case6-stock control to also "pass" on genuinely correct stock code.
//
// This version drives entirely real frames instead, using the engine's own natural timing rather
// than any poke: engine/boot.asm's main_loop_ready sets vram_ready=1 as the LAST store of the
// mainline pass that queues the box's final close-attribute packet (the same pass that sets
// sw_dlg15_state=DRAINING, via sw_dlg_hi_close_attr_tail), and NMI only drains it (clearing
// vram_ready back to 0) at the vblank that STARTS THE NEXT nes.frame() call -- so by the time the
// frame that first shows DRAINING has returned to JS, vram_ready genuinely still reads 1,
// undrained, for the whole rest of that call; only the FOLLOWING nes.frame() call's own leading
// NMI drains it, and sw_dlg17_camrelease (polled from main_loop_idle, after main_loop_ready, on
// every frame) only then sees vram_ready==0 and releases. This is a real, natural, exactly-one-
// frame gap -- not a poke, not an extended artificial delay -- and it is what the positive test
// below actually observes.

test('sabotage case 6 / positive: the final close-attribute packet stays genuinely pending (undrained) for exactly one real frame after the draining wait begins, with zero displacement and unchanged mv_left, before the drain is acknowledged and the SAME Move and the later Say finish', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem } = await buildAndBoot(project);
  openAndDismiss(nes, mem, slot);
  const yAtArm = mem[PLAYER_Y];
  const mvLeftAtArm = mem[MV_LEFT];

  const framesToDraining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
  assert.ok(framesToDraining < 60, 'sanity: must actually reach the draining wait');
  // The exact frame DRAINING first appears: the final packet was queued and vram_ready set to 1
  // in this SAME mainline pass, and that pass's own NMI (the one that will eventually drain it)
  // has not run yet -- this is the real "extra wait" this whole case exists to prove.
  assert.notEqual(mem[VRAM_READY], 0, 'the final close-attribute packet must still be genuinely pending (undrained) on the exact frame the draining wait begins');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'the hold must still be logically set while the packet is pending');
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 1, 'sw_dlg17_move_close must still be set while the packet is pending');
  assert.equal(mem[PLAYER_Y], yAtArm, 'zero displacement: the player must not have moved at all while the packet is pending');
  assert.equal(mem[MV_LEFT], mvLeftAtArm, 'mv_left must be completely unchanged while the packet is pending');

  // The very next real frame: that pending packet's own NMI (at the START of this frame() call)
  // drains it and clears vram_ready, and THIS frame's own mainline camrelease poll (which runs
  // after that drain) sees vram_ready==0 and acknowledges it -- the release actually fires.
  nes.frame();
  assert.equal(mem[VRAM_READY], 0, 'the drain must actually have been acknowledged -- vram_ready must now read 0');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'the release must actually fire on this exact frame, once the drain is acknowledged');
  assert.equal(mem[SW_DLG17_CAMHOLD], 0, 'once released, camhold must clear');
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'once released, sw_dlg17_move_close must clear');

  // The SAME Move now actually finishes, and script_resume continues into the SAME later Say --
  // real, continued frame-driving, not a fresh/separate run.
  const moveFrames = driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 120);
  assert.ok(moveFrames < 120, 'the held Move must actually complete within budget once released');
  assert.ok(mem[PLAYER_Y] < yAtArm, 'the player must have actually moved (up decreases Y) once released');
  const secondOpenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(secondOpenFrames < 60, 'the second Say must actually open -- script_resume must have continued the SAME event');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT normally');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the whole event must finish and return to ST_GAMEPLAY');
});

test('sabotage case 6: removing the vram_ready guard collapses the draining wait into the very same mainline pass it begins, never observably holding it for even the one real frame the real implementation always takes', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    '  lda <vram_ready\n  bne sw_dlg17cr_done\n  ; Fix round 1, finding A1: acquire before the first restore store, exactly\n',
    '  ; MUTANT (case 6): vram_ready guard removed\n  ; Fix round 1, finding A1: acquire before the first restore store, exactly\n',
    'case 6: vram_ready guard removed from sw_dlg17_camrelease'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  openAndDismiss(nes, mem, slot);
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 1, 'sanity: the arm frame must set sw_dlg17_move_close');
  // Without the guard, camrelease (called later in the SAME mainline pass that sets
  // sw_dlg15_state=DRAINING, via main_loop_idle -- after main_loop_ready, in that same pass)
  // releases immediately, in that SAME pass -- before that pass's own NMI has even run once. By
  // the time any nes.frame() call returns to JS, SW_DLG15_STATE must therefore never have been
  // observed at DRAINING at all: it goes straight from whatever BOX_CLOSING-era value it held
  // to IDLE within one single frame() call, unlike the real implementation (previous test), which
  // always holds it there for exactly one real, observable frame.
  let sawDraining = false;
  for (let i = 0; i < 30 && mem[SW_DLG17_MOVE_CLOSE] === 1; i++) {
    nes.frame();
    if (mem[SW_DLG15_STATE] === SW_DLG15_DRAINING) sawDraining = true;
  }
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'sanity: the mutant must still eventually release');
  assert.ok(!sawDraining, 'without the vram_ready guard, DRAINING must never be observable at any real frame boundary -- the real implementation (previous test) always holds it there for exactly one extra frame');
});

// case 6, extended delay (round 2, finding A1) ------------------------------------------------

// The two tests above only ever observe a NATURAL one-frame gap (NMI's own next-frame timing).
// Round 2, finding A1 asks for the final packet held unconsumed across SEVERAL real frames while
// frame signalling, mainline and the Move dispatch all keep running -- reusing
// streamworlddialogue.test.js's own resumable consumer interception (round 3/4/5, A7 case 8,
// :2819-2888), never a direct release-routine call. Intercepting cpu.emulate() the instant control
// is about to enter vram_drain and answering with the exact RTS this vendored core's own opcode 42
// case performs (pull two bytes off the stack, low then high, straight into REG_PC) skips
// vram_drain's body entirely -- vram_ready/vram_len stay completely untouched -- while frame
// signalling, mainline and (if already released) the Move dispatch all keep running exactly as
// they would on real hardware. No hand-poked flag on either side.

test('sabotage case 6 (round 2, finding A1 -- extended delay): the final close-attribute packet stays genuinely outstanding across several real frames while frame signalling and mainline keep running, with zero displacement, unchanged mv_left and preserved script identity on every held frame, before the drain is acknowledged and the SAME Move and the later Say finish', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  openAndDismiss(nes, mem, slot);
  const yAtArm = mem[PLAYER_Y];
  const mvLeftAtArm = mem[MV_LEFT];
  const talkEntAtArm = mem[TALK_ENT];

  const framesToDraining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
  assert.ok(framesToDraining < 60, 'sanity: must actually reach the draining wait');
  assert.notEqual(mem[VRAM_READY], 0, 'sanity: the final close-attribute packet must genuinely still be outstanding the instant draining begins');

  const vramDrainAddr = addrOf('vram_drain');
  const DELAY_CALLS = 5;
  let delayCallsRemaining = DELAY_CALLS;
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (delayCallsRemaining > 0 && (nes.cpu.REG_PC + 1) === vramDrainAddr) {
      delayCallsRemaining--;
      nes.cpu.REG_PC = nes.cpu.pull();
      nes.cpu.REG_PC += nes.cpu.pull() << 8;
      return;
    }
    return origEmulate();
  };
  try {
    for (let i = 0; i < DELAY_CALLS; i++) {
      nes.frame();
      assert.notEqual(mem[VRAM_READY], 0, `held frame ${i}: with the real consumer's own acknowledgement delayed, the final packet must still read outstanding`);
      // Round 3, finding A1: the literal requirement was queue LENGTH, not merely readiness --
      // vram_len is the packet's own remaining byte count, and a genuinely-held packet must
      // report it nonzero on every one of these frames, not just vram_ready's single bit.
      assert.notEqual(mem[VRAM_LEN], 0, `held frame ${i}: with the real consumer's own acknowledgement delayed, the final packet's own queued length must still read nonzero`);
      assert.equal(mem[SW_DLG15_STATE], SW_DLG15_DRAINING, `held frame ${i}: DRAINING must hold for as long as the real outstanding work is never acknowledged`);
      assert.equal(mem[SW_DLG17_MOVE_CLOSE], 1, `held frame ${i}: sw_dlg17_move_close must stay armed while genuinely held`);
      assert.equal(mem[PLAYER_Y], yAtArm, `held frame ${i}: zero displacement -- the player must not have moved at all while the packet is genuinely outstanding`);
      assert.equal(mem[MV_LEFT], mvLeftAtArm, `held frame ${i}: mv_left must be completely unchanged while the packet is genuinely outstanding`);
      assert.equal(mem[SCRIPT_ACTIVE], 1, `held frame ${i}: script_active must survive the whole held span`);
      assert.equal(mem[TALK_ENT], talkEntAtArm, `held frame ${i}: talk_ent must survive the whole held span`);
      assert.equal(mem[GAME_STATE], ST_DIALOG, `held frame ${i}: game_state must still read ST_DIALOG for the whole held span`);
    }
  } finally {
    nes.cpu.emulate = origEmulate;
  }

  const releaseFrames = driveUntil(nes, mem, (m) => m[SW_DLG17_MOVE_CLOSE] === 0, 10);
  assert.ok(releaseFrames < 10, 'once the real consumer is allowed to run again, the drain and release must resolve promptly, not stall');
  assert.equal(mem[VRAM_READY], 0, 'the real NMI consumer must actually have drained the packet as its own side effect');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'DRAINING must have resolved to IDLE once the real consumer actually ran');

  // The SAME Move now actually finishes, and script_resume continues into the SAME later Say.
  const moveFrames = driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 120);
  assert.ok(moveFrames < 120, 'the SAME held Move must actually complete within budget once released');
  assert.ok(mem[PLAYER_Y] < yAtArm, 'the player must have actually moved (up decreases Y) once released');
  const secondOpenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(secondOpenFrames < 60, 'the SAME later Say must actually open -- script_resume must have continued the event');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT normally');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the whole event must finish and return to ST_GAMEPLAY');
});

test('sabotage case 6 (round 2, finding A1 -- extended delay sabotage): removing the vram_ready guard releases regardless of an artificially extended delay of the real consumer -- DRAINING is never observably held even across several real frames', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    '  lda <vram_ready\n  bne sw_dlg17cr_done\n  ; Fix round 1, finding A1: acquire before the first restore store, exactly\n',
    '  ; MUTANT (case 6): vram_ready guard removed\n  ; Fix round 1, finding A1: acquire before the first restore store, exactly\n',
    'case 6 (extended delay): vram_ready guard removed from sw_dlg17_camrelease'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  openAndDismiss(nes, mem, slot);
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 1, 'sanity: the arm frame must set sw_dlg17_move_close');

  const vramDrainAddr = addrOf('vram_drain');
  const DELAY_CALLS = 5;
  let delayCallsRemaining = DELAY_CALLS;
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (delayCallsRemaining > 0 && (nes.cpu.REG_PC + 1) === vramDrainAddr) {
      delayCallsRemaining--;
      nes.cpu.REG_PC = nes.cpu.pull();
      nes.cpu.REG_PC += nes.cpu.pull() << 8;
      return;
    }
    return origEmulate();
  };
  let sawDrainingWhileHeld = false;
  try {
    for (let i = 0; i < 30 && mem[SW_DLG17_MOVE_CLOSE] === 1; i++) {
      nes.frame();
      if (mem[SW_DLG15_STATE] === SW_DLG15_DRAINING) sawDrainingWhileHeld = true;
    }
  } finally {
    nes.cpu.emulate = origEmulate;
  }
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'the mutant must have released regardless of the artificially delayed real consumer -- ignoring vram_ready entirely, unlike the real implementation (previous test), which stays genuinely held for the WHOLE delay');
  assert.ok(!sawDrainingWhileHeld, 'without the vram_ready guard, DRAINING must never be observably held even across an artificially extended delay of the real consumer');
});

// case 7 --------------------------------------------------------------------------------------

// Reuses streamworlddialogue.test.js's own established technique (its "round 2, finding A1" test)
// for proving sw_dlg17_camrelease's close_a/close_b rebuild publishes camera+OAM+terrain together:
// instruction-step to a precise midpoint inside the rebuild, inject a real NMI there, and assert
// the OAM guard (cam_dirty-gated, engine/boot.asm) skips that NMI's own $4014 DMA entirely rather
// than publishing a torn composition. That existing test only drives the rebuild via an ORDINARY
// dialogue close; this one drives it via the close-for-Move path this slice adds instead (the
// shared close_a/close_b block is otherwise untouched by this slice, per engine/streamworld.asm's
// own sw_dlg_closeformove_check, which runs strictly after this block's release), so this is the
// dedicated proof that arming a Move never disturbs that existing coherence guarantee.

const CAM_DIRTY = 0xb5;
const CAM_X_LO = 0xaf;
const CAM_Y_LO = 0xb0; // engine/constants.asm: cam_y_lo = cam_x_lo+1
// Round 3, finding A2: the case 7 (A2) joint capture below no longer reads nmi_cam_x_lo/y_lo
// (engine/constants.asm: cam_dirty+1/+2, NMI's own redundant RAM snapshot of what it last wrote)
// -- it reads the PPU's own persisted scroll registers directly (a local scrollX/scrollY, defined
// where used, matching test/unit/camera.test.js's own established "real emulator state" reading of
// nes.ppu.regH/regHT/regFH and regV/regVT/regFV), the literal target of the real $2005/$2000
// writes, never an engine-side copy of them.
const SW_CAM_ORIGIN_X_LO = 0x035c;
const SW_CAM_ORIGIN_X_HI = 0x035d;
const SW_CAM_ORIGIN_Y_LO = 0x035e;
const SW_CAM_ORIGIN_Y_HI = 0x035f;

function hardwareOam(nes) {
  return Array.from(nes.ppu.spriteMem.slice(0, 64));
}
function shadowOam(mem) {
  return Array.from(mem.slice(0x0200, 0x0200 + 64));
}

/** streamworlddialogue.test.js's own snapshotNameTables, extended (round 2, finding A2) to carry
 * attributes alongside tiles -- all four physical nametables (fourscreen mirroring, no aliasing).
 * The emulator keeps attributes in a SEPARATE array from tiles (renderer/emulator/core/ppu/
 * nametable.js), so a tile-only snapshot cannot tell a restored-but-recolored background apart
 * from a genuinely fully-restored one. */
function snapshotNameTables(nes) {
  return nes.ppu.nameTable.map((nt) => ({ tile: Array.from(nt.tile), attrib: Array.from(nt.attrib) }));
}

// Round 2, finding A2: test/unit/streamworldmove.test.js's own TL-corner OAM projection
// (projectOamX/projectOamY), copied locally (per-suite duplication convention) -- the same
// formula that file's own comment documents as mirroring test/unit/streamworldprojection.test.js's
// projectAxis/projectY, and already reused (not reinvented) across this codebase's own streamed-
// world test suites. delta = (world - origin) mod 65536; X reports the low byte directly, Y
// reports (delta-1)&0xff (sw_oam_project_y's own one-scanline-early -1).
function projectOamX(worldX, originX) {
  return (worldX - originX) & 0xff;
}
function projectOamY(worldY, originY) {
  return (((worldY - originY) & 0xffff) - 1) & 0xff;
}

/** Fix round 1, finding A4: drives real frames, from wherever `nes`/`mem` currently sit, until the
 * player's own y first differs from `yBefore` -- the Move's own first moving pixel. */
function driveToFirstMovingPixel(nes, mem, yBefore, budget = 60) {
  let frames = 0;
  while (mem[PLAYER_Y] === yBefore && frames < budget) {
    nes.frame();
    frames++;
  }
  return frames;
}

/** Fix round 1, finding A4: the one-frame joint capture itself -- restored terrain/attributes
 * (the whole background, unchanged from the independently captured pre-open snapshot), published
 * camera vs. that same pre-open origin (the x axis, untouched by an Up Move, must still read
 * exactly what it did before the box ever opened), a coherent projected hardware OAM (no tear),
 * and script identity (the event is still mid-flight, a second Say pending). */
function assertJointCapture(nes, mem, { preOpenNametables, preOpenCamX, talkEntAtArm }) {
  assert.deepEqual(snapshotNameTables(nes), preOpenNametables, 'the whole background must already be fully restored (box gone) by the Move\'s own first moving pixel');
  assert.equal(mem[CAM_X_LO], preOpenCamX, 'the published camera\'s x axis (untouched by an Up Move) must still read exactly the independently captured pre-open origin');
  // Hardware OAM always lags mainline's own shadow OAM by exactly one frame (the previous NMI's
  // own DMA payload, sampled before this frame's build_oam/draw_entities has run) -- the harmless
  // lag streamworlddialogue.test.js's own "round 2, finding A1" test already documents. Capture
  // the shadow BEFORE advancing, then compare hardware to THAT snapshot one frame later.
  const shadowAtFirstMovingPixel = shadowOam(mem);
  nes.frame();
  assert.deepEqual(hardwareOam(nes), shadowAtFirstMovingPixel, 'the projected hardware OAM must catch up to be coherent with the first moving pixel\'s own shadow OAM one settle frame later -- no torn composition');
  assert.equal(mem[SCRIPT_ACTIVE], 1, 'script identity: script_active must still read 1 at the first moving pixel -- the event is still mid-flight');
  assert.equal(mem[TALK_ENT], talkEntAtArm, 'script identity: talk_ent must still read the same conversation slot at the first moving pixel');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'script identity: game_state must still read ST_DIALOG at the first moving pixel -- a second Say is still pending');
}

/** streamworlddialogue.test.js's own triggerRealNmi, copied locally. */
function triggerRealNmi(nes, pausedPC, budget = 20000) {
  nes.cpu.nmiImmediate = true;
  nes.cpu.emulate();
  let steps = 0;
  while (nes.cpu.REG_PC !== pausedPC) {
    nes.cpu.emulate();
    assert.ok(++steps < budget, 'the real NMI never returned to the interrupted instruction');
  }
}

test('sabotage case 7 / positive: a real NMI landing mid-rebuild during a close-for-Move draw-down is suppressed by the OAM guard, and the release publishes camera+OAM together once the rebuild finishes', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (a nonaligned camera origin -- fix round 1, finding A4)');
  const preOpenNametables = snapshotNameTables(nes);
  const preOpenCamX = mem[CAM_X_LO];
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the message must finish typing and reach ENDWAIT before dismissing');
  pressOnce(nes, B);
  const talkEntAtArm = mem[TALK_ENT];
  const framesToDraining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
  assert.ok(framesToDraining < 60, 'sanity: must actually reach the draining wait via the close-for-Move path');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'sanity: the hold must still be logically set going into the rebuild');

  const closeAStart = addrOf('sw_dlg_lifecycle_close_a_start');
  const closeBStart = addrOf('sw_dlg_lifecycle_close_b_start');
  const midPoint = closeBStart + 3; // past `jsr build_oam` (3 bytes), before draw_entities/draw_hud have run for real
  const hwBeforeInjection = hardwareOam(nes);

  nes.cpu.REG_PC = closeAStart - 1;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== midPoint) {
    nes.cpu.emulate();
    assert.ok(++steps < 5000, 'the close-for-Move rebuild\'s own midpoint was never reached');
  }
  assert.equal(mem[CAM_DIRTY], 1, 'setup: cam_dirty must be held at this exact midpoint -- inside the close_a/close_b bracket');
  for (let i = 16; i < 64; i++) mem[0x0200 + i] = 0xab;
  const tornShadow = shadowOam(mem);
  assert.notDeepEqual(tornShadow, hwBeforeInjection, 'sanity: the poisoned mid-rebuild shadow OAM really differs from the pre-injection hardware OAM');

  const pausedPC = nes.cpu.REG_PC;
  triggerRealNmi(nes, pausedPC);
  assert.deepEqual(hardwareOam(nes), hwBeforeInjection, 'an NMI landing mid-rebuild during close-for-Move must skip its own $4014 DMA entirely while cam_dirty is held -- hardware OAM must stay completely untouched, never showing the poisoned torn composition');

  let resumeSteps = 0;
  while (mem[CAM_DIRTY] !== 0) {
    nes.cpu.emulate();
    assert.ok(++resumeSteps < 5000, 'cam_dirty was never released after the interruption');
  }
  const finalShadow = shadowOam(mem);
  assert.notDeepEqual(finalShadow, tornShadow, 'sanity: the finished rebuild really does overwrite the poison');
  const restoredCamX = mem[CAM_X_LO];

  const releasedPC = nes.cpu.REG_PC;
  triggerRealNmi(nes, releasedPC);
  assert.deepEqual(hardwareOam(nes), finalShadow, 'once released, the very next real NMI must publish the complete, coherent final composition');
  assert.equal(mem[CAM_X_LO], restoredCamX, 'cam_x_lo must already equal the restored value the release settled on -- camera and OAM publish together, not staggered');

  // Fix round 1, finding A4: continue driving real frames (legitimate mainline PC throughout --
  // triggerRealNmi always returns execution to the exact interrupted instruction, unlike
  // callRoutine's own scratch-RAM stub) to the Move's own first moving pixel, and do the joint
  // capture there.
  driveUntil(nes, mem, (m) => m[SW_DLG17_MOVE_CLOSE] === 0, 30);
  assert.equal(mem[SW_DLG17_MOVE_CLOSE], 0, 'sanity: the release must have actually cleared sw_dlg17_move_close by now');
  const yAtRelease = mem[PLAYER_Y];
  const movingFrames = driveToFirstMovingPixel(nes, mem, yAtRelease);
  assert.ok(movingFrames < 60, 'the Move must actually start moving the player within budget');
  assertJointCapture(nes, mem, { preOpenNametables, preOpenCamX, talkEntAtArm });
});

test('sabotage case 7: moving the release marks before the restore/rebuild lets a mid-rebuild NMI publish a torn OAM straight to hardware', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  // Moves the four release-marking instructions (dec cam_dirty / clear camhold / set IDLE) to run
  // immediately after `inc <cam_dirty`, BEFORE the restore stores and the
  // build_oam/draw_entities/draw_hud rebuild, instead of after -- net effect, cam_dirty never
  // actually rises for the duration of the rebuild (inc immediately cancelled by dec), so the
  // cam_dirty-gated OAM guard (engine/boot.asm) can no longer tell a mid-rebuild NMI to skip its
  // own DMA. Every label stays defined (still needed elsewhere: kernelbytes.test.js/
  // streamworlddialogue.test.js's own span measurements), only the instruction ORDER changes.
  const mutant = mutateOnce(
    source,
    'sw_dlg_lifecycle_close_a_start:\n  inc <cam_dirty\nsw_dlg_lifecycle_close_a_end:\n  lda sw_dlg_cam_x_lo\n  sta <cam_x_lo\n  lda sw_dlg_cam_y_lo\n  sta <cam_y_lo\n  lda <sw_dlg15_origin_x_lo\n  sta sw_cam_origin_x_lo\n  lda <sw_dlg15_origin_x_hi\n  sta sw_cam_origin_x_hi\n  lda <sw_dlg15_origin_y_lo\n  sta sw_cam_origin_y_lo\n  lda <sw_dlg15_origin_y_hi\n  sta sw_cam_origin_y_hi\nsw_dlg_lifecycle_close_b_start:\n  jsr build_oam\n  jsr draw_entities\n  .if !BATTLE_ENABLED\n  jsr draw_hud\n  .endif\nsw_dlg_lifecycle_close_b_end:\n  dec <cam_dirty\n  lda #0\n  sta sw_dlg17_camhold\n  lda #SW_DLG15_IDLE\n  sta <sw_dlg15_state\n',
    'sw_dlg_lifecycle_close_a_start:\n  ; MUTANT (case 7): release marks moved before the restore/rebuild instead of after\n  inc <cam_dirty\n  dec <cam_dirty\n  lda #0\n  sta sw_dlg17_camhold\n  lda #SW_DLG15_IDLE\n  sta <sw_dlg15_state\nsw_dlg_lifecycle_close_a_end:\n  lda sw_dlg_cam_x_lo\n  sta <cam_x_lo\n  lda sw_dlg_cam_y_lo\n  sta <cam_y_lo\n  lda <sw_dlg15_origin_x_lo\n  sta sw_cam_origin_x_lo\n  lda <sw_dlg15_origin_x_hi\n  sta sw_cam_origin_x_hi\n  lda <sw_dlg15_origin_y_lo\n  sta sw_cam_origin_y_lo\n  lda <sw_dlg15_origin_y_hi\n  sta sw_cam_origin_y_hi\nsw_dlg_lifecycle_close_b_start:\n  jsr build_oam\n  jsr draw_entities\n  .if !BATTLE_ENABLED\n  jsr draw_hud\n  .endif\nsw_dlg_lifecycle_close_b_end:\n',
    'case 7: release marks moved before the restore/rebuild'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  openAndDismiss(nes, mem, slot);
  const framesToDraining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
  assert.ok(framesToDraining < 60, 'sanity: must still reach the draining wait under this mutant');

  const closeAStart = addrOf('sw_dlg_lifecycle_close_a_start');
  const closeBStart = addrOf('sw_dlg_lifecycle_close_b_start');
  const midPoint = closeBStart + 3; // past `jsr build_oam` (3 bytes), before draw_entities/draw_hud have run for real
  const hwBeforeInjection = hardwareOam(nes);

  nes.cpu.REG_PC = closeAStart - 1;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== midPoint) {
    nes.cpu.emulate();
    assert.ok(++steps < 5000, 'the mutant\'s own rebuild midpoint was never reached');
  }
  assert.equal(mem[CAM_DIRTY], 0, 'the mutant must already read cam_dirty == 0 at this midpoint -- the inc/dec pair cancelled before the rebuild ran, unlike the real implementation (previous test), which still holds it at 1 here');
  for (let i = 16; i < 64; i++) mem[0x0200 + i] = 0xab;
  const tornShadow = shadowOam(mem);
  assert.notDeepEqual(tornShadow, hwBeforeInjection, 'sanity: the poisoned mid-rebuild shadow OAM really differs from the pre-injection hardware OAM');

  const pausedPC = nes.cpu.REG_PC;
  triggerRealNmi(nes, pausedPC);
  assert.deepEqual(hardwareOam(nes), tornShadow, 'without cam_dirty held, the interrupting NMI\'s own unconditional DMA must publish the poisoned torn mid-rebuild composition straight to hardware -- exactly the historical one-frame sprite pop, which the real implementation (previous test) never lets through');
  // Fix round 1, finding A4 ("must fail the publication-order mutant"): the assertion immediately
  // above already fails under this mutant -- that IS the failure this whole test exists to prove.
  // The bug is transient (cam_dirty legitimately reads 0 again, correctly, by the time the
  // rebuild finishes -- this mutant's inc/dec pair cancel cleanly, they are not left corrupted),
  // so continuing real frames past this point to the Move's own first moving pixel (the new
  // joint-capture test the positive test above now also does) would observe nothing further wrong
  // here and would only add noise to an already-decisive test; the joint capture's own "must fail"
  // pairing for this case 7 is the assertion right above, not a second copy of it appended here.
});

test('sabotage case 7 (A4, early-Move mutant): the joint capture\'s own preconditions -- a closed box and a fully restored background -- do not hold at the first moving pixel when the draw-down is skipped', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlg_cfm_guard_holding:\n  jmp ui_tick_state           ; hand this frame to the ordinary game_state\n                              ; dispatch (text_tick) instead of move_tick\n',
    'sw_dlg_cfm_guard_holding:\n  jmp sw_dlg_cfm_guard_go     ; MUTANT: fall straight through to move_tick anyway\n',
    'case 7 (A4): held frames wrongly proceed to move_tick (same mutation as case 3)'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC');
  const preOpenNametables = snapshotNameTables(nes);
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the message must finish typing and reach ENDWAIT before dismissing');
  pressOnce(nes, B);
  const yAtArm = mem[PLAYER_Y];
  const movingFrames = driveToFirstMovingPixel(nes, mem, yAtArm);
  assert.ok(movingFrames < 60, 'sanity: the mutant must still actually move the player eventually');
  // The real joint capture (previous test) requires the box already closed and the background
  // already fully restored by this exact frame -- under this mutant, the player is moving while
  // the box is still visually mid-close (case 3's own finding), so at least one of those two
  // preconditions must already be violated here, before any camera/OAM/script-identity check
  // could even be meaningful.
  const boxAlreadyClosed = mem[BOX_STATE] === BOX_CLOSED;
  const backgroundAlreadyRestored = JSON.stringify(snapshotNameTables(nes)) === JSON.stringify(preOpenNametables);
  assert.ok(!(boxAlreadyClosed && backgroundAlreadyRestored), 'the early-Move mutant must let the player start moving before the box has closed and the background has been restored -- the real implementation (previous test) never reaches its first moving pixel until both are true');
});

// case 7 (A2): uninterrupted joint capture (round 2, finding A2; rebuilt round 3, finding A2) --

// The interrupted test above (REG_PC teleported to closeAStart) is KEPT separately -- it remains
// the dedicated proof the OAM guard suppresses a torn mid-rebuild DMA. This test instead drives
// the WHOLE event through normal execution (no REG_PC overwrite anywhere), injects a real,
// resumable NMI at the rebuild's own vulnerable midpoint exactly as that test does (a RESUMABLE
// interception of cpu.emulate(): watching for the CPU's own natural PC to arrive there, reached by
// ordinary frame-driving -- the case 6 tests above already establish DRAINING holds for exactly
// one real frame, so the VERY NEXT nes.frame() call is known ahead of time to be the one whose
// mainline pass runs the release's own restore/rebuild -- then setting the vendored core's own
// nmiImmediate flag right there so the very next cpu.emulate() call takes a genuine interrupt
// instead of the next opcode: RTI resumes exactly where it left off, never an artificial jump),
// and performs its OWN joint capture at ONE further, explicitly-defined publication boundary: the
// very next real NMI after that interruption, i.e. the first NMI this whole sequence ever
// services with cam_dirty released -- the SAME one the interrupted test's own final phase reaches
// via a second triggerRealNmi. Round 3, finding A2: the earlier version of this test read
// terrain/scroll/script-identity at one frame boundary and hardware OAM one nes.frame() call
// later, comparing two different NMIs' own publications as though they were one. This version
// reads every one of those four things from that SAME single nes.frame() call, nothing advanced
// in between, and never compares hardware OAM to the engine's own shadow OAM -- an INDEPENDENTLY
// computed expectation for every part instead (restored terrain+attributes, the real PPU scroll
// registers, hardware sprite geometry, script identity).
test('case 7 (A2): an uninterrupted real Say -> Move event\'s own joint capture, at the SAME single NMI boundary that first makes the resolved rebuild observable in hardware, independently verifies restored terrain+attributes, the actual published scroll and hardware sprite geometry together, with a resumable real NMI exercising the publication-order fault at its own vulnerable rebuild boundary along the way', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({});
  // Meaningful nonzero attribute data (round 2, finding A2): createStreamedProject's own varied
  // region already places metatile ids 1/2/3 across roughly the first third of every screen
  // (test/lib/streamedproject.js) -- giving each a distinct nonzero palette here means the
  // interact screen's own attribute bytes are genuinely nonzero, not merely restorable zeros.
  project.metatiles[1].palette = 1;
  project.metatiles[2].palette = 2;
  project.metatiles[3].palette = 3;
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (a nonaligned camera origin)');
  for (let i = 0; i < 3; i++) nes.frame();
  const preOpenNametables = snapshotNameTables(nes);
  // Round 3, finding A2: sw_cam_origin_x/y_lo/hi -- never an NMI-time RAM snapshot of the
  // published scroll -- captured once, here, before the dialogue ever nudges the camera, and
  // never re-read afterward. sw_dlg_lifecycle_close_a's own restore (engine/streamworld.asm) sets
  // both cam_x_lo and sw_cam_origin_x_lo back to this exact pre-open value ("cam_x_lo and
  // sw_cam_origin_x_lo are always the same value", that file's own sw_dlg15_pending_step
  // comment); the Y axis's own worldY-mod-240 relationship (that same comment) is independently
  // reapplied below rather than assumed to equal a raw byte.
  const preOpenOriginX = mem[SW_CAM_ORIGIN_X_LO] | (mem[SW_CAM_ORIGIN_X_HI] << 8);
  const preOpenOriginY = mem[SW_CAM_ORIGIN_Y_LO] | (mem[SW_CAM_ORIGIN_Y_HI] << 8);
  assert.ok(preOpenNametables.some((nt) => nt.attrib.some((a) => a !== 0)), 'sanity: the pre-open background must actually carry nonzero attribute data somewhere');

  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the message must finish typing and reach ENDWAIT before dismissing');
  pressOnce(nes, B);
  const talkEntAtArm = mem[TALK_ENT];
  const framesToDraining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
  assert.ok(framesToDraining < 60, 'sanity: must actually reach the draining wait via the close-for-Move path');

  const closeBStart = addrOf('sw_dlg_lifecycle_close_b_start');
  const midPoint = closeBStart + 3; // past `jsr build_oam`, before draw_entities/draw_hud
  const hwBeforeInjection = hardwareOam(nes);
  let injected = false;
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (!injected && (nes.cpu.REG_PC + 1) === midPoint) {
      injected = true;
      assert.equal(mem[CAM_DIRTY], 1, 'setup: cam_dirty must be held the instant the rebuild\'s own midpoint is naturally reached');
      for (let i = 16; i < 64; i++) mem[0x0200 + i] = 0xab;
      nes.cpu.nmiImmediate = true;
    }
    return origEmulate();
  };
  try {
    nes.frame();
  } finally {
    nes.cpu.emulate = origEmulate;
  }
  assert.ok(injected, 'the rebuild\'s own midpoint must actually have been reached naturally within this one frame');
  assert.deepEqual(hardwareOam(nes), hwBeforeInjection, 'a real NMI landing mid-rebuild during close-for-Move must skip its own $4014 DMA entirely while cam_dirty is held -- hardware OAM must stay completely untouched, never showing the poisoned torn composition');
  // Round 3, finding A2: this exact instant -- the one real NMI this whole call services at the
  // injection point -- is also the ONLY frame at which the poisoned entity range (bytes 16-63,
  // above) could ever reach hardware if the guard failed to hold it back: draw_entities re-parks
  // every one of those slots in RAM immediately afterward regardless of whether this NMI's own
  // DMA already published the poison, so a check made any later frame can no longer tell a
  // publication-order fault from a correct one (round 3's own capture-only finding: the transient
  // tear heals itself one frame after this). Checked as its own INDEPENDENT fact -- every entity
  // slot parks at Y=255 whenever gameplay is paused, true of every other real frame this whole
  // dialogue has shown (sw_dlg17_camrelease's own "draw_entities parks every remaining sprite"
  // comment) -- never as a restatement of cam_dirty.
  for (let i = 16; i < 64; i += 4) {
    assert.equal(hardwareOam(nes)[i], 255, `hardware OAM: entity slot at byte ${i} must already read parked (Y=255) at this exact publication instant -- the one moment a publication-order fault would show unparked garbage instead`);
  }

  const releaseFrames = driveUntil(nes, mem, (m) => m[SW_DLG17_MOVE_CLOSE] === 0, 10);
  assert.ok(releaseFrames < 10, 'the release must actually have completed (possibly already within the injection frame above)');
  // Round 3, finding A2: captured HERE, before the very next real NMI's own mainline pass can
  // move the player any further -- hardware OAM always lags mainline's own shadow OAM by exactly
  // one frame (the assertJointCapture helper's own comment, above, reused here), so the
  // projection below must use the position this pending NMI is about to publish, not whatever
  // mem[] reads after it.
  const positionAtRelease = { x: mem[PLAYER_X], y: mem[PLAYER_Y] };
  const movingFrames = driveToFirstMovingPixel(nes, mem, positionAtRelease.y);
  assert.ok(movingFrames < 60, 'the Move must actually start moving the player within budget');

  // The joint capture itself -- everything read from THIS SAME single frame (the very next real
  // NMI after the interruption, cam_dirty now released), no REG_PC overwrite, no further
  // nes.frame() call between any of these four reads.
  assert.deepEqual(snapshotNameTables(nes), preOpenNametables, 'the whole background, INCLUDING attributes, must already be fully restored by this same publication');
  // Round 3, finding A2: the REAL PPU scroll registers -- cam_x_lo tracks worldX mod 256 (X
  // axis); cam_y_lo tracks worldY mod 240 (Y axis, engine/streamworld.asm's own comment) -- both
  // checked against the SAME independently captured pre-open origin, reduced by that same
  // engine-documented modulus rather than assumed to equal a raw byte.
  const scrollX = (n) => n.ppu.regH * 256 + n.ppu.regHT * 8 + n.ppu.regFH;
  const scrollY = (n) => n.ppu.regV * 240 + n.ppu.regVT * 8 + n.ppu.regFV;
  assert.equal(scrollX(nes) % 256, preOpenOriginX % 256, 'the ACTUAL PUBLISHED scroll\'s x axis (untouched by an Up Move) must still read exactly the independently captured pre-open origin');
  assert.equal(scrollY(nes) % 240, preOpenOriginY % 240, 'the ACTUAL PUBLISHED scroll\'s y axis, at this same publication, must still read exactly the independently captured pre-open origin');
  assert.equal(mem[SCRIPT_ACTIVE], 1, 'script identity: script_active must still read 1 at this same publication -- the event is still mid-flight');
  assert.equal(mem[TALK_ENT], talkEntAtArm, 'script identity: talk_ent must still read the same conversation slot at this same publication');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'script identity: game_state must still read ST_DIALOG at this same publication -- a second Say is still pending');

  // Hardware sprite geometry, independently projected from the SAME pre-publish position/origin
  // captured above -- never compared to the engine's own shadow OAM.
  const expectedOamX = projectOamX(positionAtRelease.x, preOpenOriginX);
  const expectedOamY = projectOamY(positionAtRelease.y, preOpenOriginY);
  const hw = hardwareOam(nes);
  assert.equal(hw[3], expectedOamX, 'hardware OAM: the player\'s own TL-corner X must equal the independently computed projection for the pre-publish position/origin this same NMI\'s own DMA published');
  assert.equal(hw[0], expectedOamY, 'hardware OAM: the player\'s own TL-corner Y must equal the independently computed projection for the pre-publish position/origin this same NMI\'s own DMA published');

  // The event must still genuinely finish afterward.
  const moveFrames = driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 120);
  assert.ok(moveFrames < 120, 'the held Move must actually complete within budget once released');
  const secondOpenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(secondOpenFrames < 60, 'the second Say must actually open -- script_resume must have continued the event');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT normally');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the whole event must finish and return to ST_GAMEPLAY');
});

test('sabotage case 7 (A2): the SAME uninterrupted joint-capture drive, with the release marks moved before the restore/rebuild, lets the naturally-injected NMI publish a torn OAM straight to hardware', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlg_lifecycle_close_a_start:\n  inc <cam_dirty\nsw_dlg_lifecycle_close_a_end:\n  lda sw_dlg_cam_x_lo\n  sta <cam_x_lo\n  lda sw_dlg_cam_y_lo\n  sta <cam_y_lo\n  lda <sw_dlg15_origin_x_lo\n  sta sw_cam_origin_x_lo\n  lda <sw_dlg15_origin_x_hi\n  sta sw_cam_origin_x_hi\n  lda <sw_dlg15_origin_y_lo\n  sta sw_cam_origin_y_lo\n  lda <sw_dlg15_origin_y_hi\n  sta sw_cam_origin_y_hi\nsw_dlg_lifecycle_close_b_start:\n  jsr build_oam\n  jsr draw_entities\n  .if !BATTLE_ENABLED\n  jsr draw_hud\n  .endif\nsw_dlg_lifecycle_close_b_end:\n  dec <cam_dirty\n  lda #0\n  sta sw_dlg17_camhold\n  lda #SW_DLG15_IDLE\n  sta <sw_dlg15_state\n',
    'sw_dlg_lifecycle_close_a_start:\n  ; MUTANT (case 7, A2): release marks moved before the restore/rebuild instead of after\n  inc <cam_dirty\n  dec <cam_dirty\n  lda #0\n  sta sw_dlg17_camhold\n  lda #SW_DLG15_IDLE\n  sta <sw_dlg15_state\nsw_dlg_lifecycle_close_a_end:\n  lda sw_dlg_cam_x_lo\n  sta <cam_x_lo\n  lda sw_dlg_cam_y_lo\n  sta <cam_y_lo\n  lda <sw_dlg15_origin_x_lo\n  sta sw_cam_origin_x_lo\n  lda <sw_dlg15_origin_x_hi\n  sta sw_cam_origin_x_hi\n  lda <sw_dlg15_origin_y_lo\n  sta sw_cam_origin_y_lo\n  lda <sw_dlg15_origin_y_hi\n  sta sw_cam_origin_y_hi\nsw_dlg_lifecycle_close_b_start:\n  jsr build_oam\n  jsr draw_entities\n  .if !BATTLE_ENABLED\n  jsr draw_hud\n  .endif\nsw_dlg_lifecycle_close_b_end:\n',
    'case 7 (A2): release marks moved before the restore/rebuild'
  );
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [say('Hi.'), moveUp(16), say('Bye.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project, { overrides: [{ name: 'streamworld.asm', text: mutant }] });
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the message must finish typing and reach ENDWAIT before dismissing');
  pressOnce(nes, B);
  const framesToDraining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
  assert.ok(framesToDraining < 60, 'sanity: must still reach the draining wait under this mutant');

  const closeBStart = addrOf('sw_dlg_lifecycle_close_b_start');
  const midPoint = closeBStart + 3;
  const hwBeforeInjection = hardwareOam(nes);
  let injected = false;
  let camDirtyAtMidpoint = null;
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (!injected && (nes.cpu.REG_PC + 1) === midPoint) {
      injected = true;
      camDirtyAtMidpoint = mem[CAM_DIRTY];
      for (let i = 16; i < 64; i++) mem[0x0200 + i] = 0xab;
      nes.cpu.nmiImmediate = true;
    }
    return origEmulate();
  };
  try {
    nes.frame();
  } finally {
    nes.cpu.emulate = origEmulate;
  }
  assert.ok(injected, 'the mutant\'s own rebuild midpoint must actually have been reached naturally within this one frame');
  assert.equal(camDirtyAtMidpoint, 0, 'the mutant must already read cam_dirty == 0 at this midpoint -- the inc/dec pair cancelled before the rebuild ran, unlike the real implementation (previous test), which still holds it at 1 here');
  assert.notDeepEqual(hardwareOam(nes), hwBeforeInjection, 'without cam_dirty held, the naturally-injected NMI\'s own unconditional DMA must publish the poisoned torn mid-rebuild composition straight to hardware -- exactly what the real implementation\'s own uninterrupted joint-capture test (previous test) never lets through');
});

// ---------------------------------------------------------------------------------------------
// Byte-identity: this slice must cost nothing when unused. Baseline is 0ea504b, the tip commit
// immediately before this slice's own work began (git log at the top of this session).
// ---------------------------------------------------------------------------------------------

function slice8BaselineOverrides() {
  return ['constants.asm', 'streamworld.asm', 'ui.asm'].map((name) => ({
    name,
    text: execFileSync('git', ['show', `0ea504b:engine/${name}`], { encoding: 'utf8' })
  }));
}

test('byte-identity: a non-streamed project assembles byte-identical to the pre-slice-8 (0ea504b) engine sources', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'rpg' });
  for (const map of project.maps) map.streamed = false;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-closemove-identity-noStream-'));
  const baselineDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-closemove-identity-noStream-baseline-'));
  t.after(() => Promise.all([dir, baselineDir].map((d) => fs.promises.rm(d, { recursive: true, force: true }))));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const baselineProject = structuredClone(project);
  baselineProject.code = { overrides: slice8BaselineOverrides(), files: [] };
  await saveProject(baselineDir, baselineProject);
  const baselineBuilt = await buildProject({ dir: baselineDir, project: baselineProject, log: () => {} });
  assert.deepEqual(
    fs.readFileSync(built.romPath),
    fs.readFileSync(baselineBuilt.romPath),
    'a non-streamed project must never pay for slice 8\'s own close-for-Move mechanism'
  );
});

test('byte-identity: a streamed project with no live Move assembles byte-identical to the pre-slice-8 (0ea504b) engine sources', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'action' });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-closemove-identity-noMove-'));
  const baselineDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-closemove-identity-noMove-baseline-'));
  t.after(() => Promise.all([dir, baselineDir].map((d) => fs.promises.rm(d, { recursive: true, force: true }))));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const baselineProject = structuredClone(project);
  baselineProject.code = { overrides: slice8BaselineOverrides(), files: [] };
  await saveProject(baselineDir, baselineProject);
  const baselineBuilt = await buildProject({ dir: baselineDir, project: baselineProject, log: () => {} });
  assert.deepEqual(
    fs.readFileSync(built.romPath),
    fs.readFileSync(baselineBuilt.romPath),
    'a streamed project that never uses a scripted Move must never pay for slice 8\'s own close-for-Move mechanism'
  );
});
