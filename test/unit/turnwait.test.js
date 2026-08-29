// Turn and Wait: item 6's first slice -- the two individual opcodes "Move /
// turn / wait routes" needed, now that Move itself is done. This is not the
// whole verb: a *route* (a sequence of legs authored and previewed together)
// and a Map Forge preview for it are still unbuilt, pure authoring/compiler
// work with no engine side to test here -- what this file covers is Turn and
// Wait as commands an author can already chain by hand, one at a time, on a
// page. Both reuse move_face (engine/entities.asm) --
// Turn calls it directly, and it is the routine Move's own facing decision
// already was -- so the sharpest thing to prove here is not "Turn sets a
// facing" alone, it is that FACE_ENABLED (shared/project.js's projectUsesFace)
// gates move_face correctly: a Turn-only project must assemble it without
// assembling any of Move's own ~379-byte machinery, and a project with both
// live must pay for move_face exactly once, not twice. The capacity side of
// that is measured directly in test/unit/kernelbytes.test.js; this file
// covers the wire format and the runtime behaviour, including the one thing
// that has to be verified rather than assumed: that a scripted Move and a
// scripted Wait can never be suspended at the same time.
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
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { compileText, opIndex } from '../../main/build/textcompile.js';
import {
  MOVE_DIRECTIONS,
  MOVE_TARGETS,
  createProject,
  normalizeProject,
  projectUsesTurn,
  projectUsesWait,
  projectUsesFace
} from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM. player_dir and the mv_*/wt_* chain are computed expressions in
// engine/constants.asm (`mv_who = sv_len+1`, and so on), not plain `name =
// $HH` literals, so they cannot be read back by shared/enginesyms.js's
// parseEquates (which deliberately only understands literal equates -- see
// its own comment). Confirmed two independent ways rather than assumed: by
// injecting `.db mv_who, mv_dir, mv_left, mv_step, mv_tmp, split_lock, wt_left`
// into a real build's main.asm and reading the emitted bytes back out of the
// ROM, and by observing wt_left/mv_left actually count down at exactly these
// addresses in a live emulator run (see the Move/Wait overlap test below).
// wt_left is chained after split_lock (not after mv_tmp, where it sat before
// review caught it) specifically so split_lock -- a symbol that pre-dates
// Wait -- keeps its own historical address and a switched-off Wait costs a
// project not one byte, including of every other symbol's own address.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const PLAYER_DIR = 0x12;
const GAME_STATE = 0x25;
const BOX_STATE = 0x40;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const ENT_DIR = 0x320;
const SWITCHES = 0x390;
const MV_LEFT = 0x96;
const WT_LEFT = 0x9a;

const ST_GAMEPLAY = 0;
const BOX_ENDWAIT = 6; // engine/text.asm's BOX_ENDWAIT -- the message is over, confirm resumes the script
const A = 0;
const B = 1;

// From engine/constants.asm's DIR_*, which MOVE_DIRECTIONS is written to match.
const DIR_DOWN = 0;
const DIR_UP = 1;
const DIR_LEFT = 2;

const START_X = 112;
const START_Y = 112;
const NPC = 4; // appended by buildWith, after the sample's four actors

const switchOn = (nes, n) => Boolean(nes.cpu.mem[SWITCHES + (n >> 3)] & (1 << (n & 7)));

function boot(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  if (nes.cpu.mem[GAME_STATE] === 3) {
    nes.buttonDown(1, 3);
    nes.frame();
    nes.buttonUp(1, 3);
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

/**
 * A one-screen project with one talkable actor carrying `commands`, 16px
 * above the player's own start position -- interact range (REACH_RANGE 20)
 * without overlapping the player's own tile, the identical placement
 * move.test.js's own buildWith uses, so `tap(nes, B)` reaches it with no walk
 * needed and no risk of the two entities' starting positions colliding. The
 * wipe matters: metatile 0 is 'Empty' and open by construction, so every
 * square is walkable without this test having to know anything about the
 * sample's actual art.
 */
async function buildWith(t, commands, tweak = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-turnwait-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const slime = project.sprites.actors[0];
  project.sprites.actors.push({ ...structuredClone(slime), id: NPC, name: 'Walker', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: NPC,
      x: START_X,
      y: START_Y - 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    }
  ];
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, dir, romPath: built.romPath, nes: boot(built.romPath) };
}

// --------------------------------------------------------------- the wire

test('a Turn compiles to its opcode plus who/dir as list positions, no distance byte', () => {
  // Pinned against the literal in engine/constants.asm:768 (OP_TURN = $14),
  // not just opIndex('turn') read back from the same table the assertion
  // below also reads its expected byte from -- reordering EVENT_COMMANDS and
  // updating OP_* in lockstep would stay green forever without this, since
  // both sides of that assertion would still agree with each other while
  // disagreeing with the engine.
  assert.equal(opIndex('turn'), 0x14, "opIndex('turn') must match engine/constants.asm's OP_TURN literally, not just internally");
  const project = normalizeProject({
    ...createProject('Turn wire'),
    commonEvents: [
      {
        id: 0,
        name: 'Face',
        event: {
          pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'turn', who: 'player', dir: 'left' }] }]
        }
      }
    ]
  });
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(opIndex('turn'));
  assert.ok(at >= 0, 'the compiled events should contain an OP_TURN');
  assert.deepEqual(
    bytes.slice(at, at + 3),
    [opIndex('turn'), MOVE_TARGETS.findIndex((entry) => entry.id === 'player'), MOVE_DIRECTIONS.findIndex((entry) => entry.id === 'left')],
    'a Turn is exactly three bytes -- opcode, who, dir -- with no distance operand'
  );
});

test('a Wait compiles to its opcode plus one frame-count byte', () => {
  // Pinned against the literal in engine/constants.asm:774 (OP_WAIT = $15),
  // for the identical reason the Turn wire test above pins OP_TURN.
  assert.equal(opIndex('wait'), 0x15, "opIndex('wait') must match engine/constants.asm's OP_WAIT literally, not just internally");
  const project = normalizeProject({
    ...createProject('Wait wire'),
    commonEvents: [
      { id: 0, name: 'Pause', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'wait', frames: 45 }] }] } }
    ]
  });
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(opIndex('wait'));
  assert.ok(at >= 0, 'the compiled events should contain an OP_WAIT');
  assert.deepEqual(bytes.slice(at, at + 2), [opIndex('wait'), 45], 'a Wait is exactly two bytes -- opcode and frame count');
});

test('an unknown Turn who or dir falls back to the first entry rather than being dropped', () => {
  const [command] = normalizeProject({
    ...createProject('Fallback'),
    commonEvents: [
      {
        id: 0,
        name: 'E',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'turn', who: 'the-cat', dir: 'widdershins' }] }] }
      }
    ]
  }).commonEvents[0].event.pages[0].commands;

  assert.equal(command.op, 'turn', 'the command survives');
  assert.equal(command.who, MOVE_TARGETS[0].id);
  assert.equal(command.dir, MOVE_DIRECTIONS[0].id);
});

// Round review (Low 2): the test above normalizes the project first, so an
// invalid who/dir is already resolved to MOVE_TARGETS[0]/MOVE_DIRECTIONS[0]
// -- valid ids -- before compileText ever sees it. That proves normalizeProject
// has its own fallback; it says nothing about encodeCommand's own
// `Math.max(0, MOVE_TARGETS.findIndex(...))` fallback in textcompile.js,
// which is what actually stands between a raw invalid target and a byte a
// real ROM never sees checked. Deleting that compiler-side fallback would
// leave the test above green (nothing reaches it) while a hand-edited or
// unnormalized project compiled 'the-cat'/'widdershins' as findIndex's own
// -1, unclamped -- which textcompile.js's byte() helper would then treat as
// a negative array index rather than refusing it. This is the test that
// actually exercises that line: an unnormalized command, handed to
// compileText directly.
test('an unnormalized Turn with an unknown who or dir still compiles to a safe fallback byte', () => {
  const project = {
    ...createProject('Unnormalized fallback'),
    commonEvents: [
      {
        id: 0,
        name: 'E',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              // Deliberately not run through normalizeProject -- 'the-cat'
              // and 'widdershins' are exactly the shape a hand-edited
              // project.json, or a project written by a later Forge version
              // naming a target this one has never heard of, could carry.
              commands: [{ op: 'turn', who: 'the-cat', dir: 'widdershins' }]
            }
          ]
        }
      }
    ]
  };
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(opIndex('turn'));
  assert.ok(at >= 0, 'the compiled events should contain an OP_TURN');
  assert.deepEqual(
    bytes.slice(at, at + 3),
    [opIndex('turn'), 0, 0],
    'an unrecognised who/dir must compile to the first list entry (0), not a dropped command or a negative index'
  );
});

// ------------------------------------------------------------- the engine

test('a Turn sets an entity’s facing at once and the next command runs the same frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'turn', who: 'self', dir: 'up' },
    { op: 'setSwitch', switch: 5 }
  ]);

  assert.equal(nes.cpu.mem[ENT_DIR], DIR_DOWN, 'the NPC starts facing down, the boot default');
  assert.equal(switchOn(nes, 5), false);
  const [entX, entY] = [nes.cpu.mem[ENT_X], nes.cpu.mem[ENT_Y]];

  tap(nes, B, 0); // talk: the page runs Turn then the next command, all before this frame ends
  // Deliberately not settled with run()/settle() first: Turn does not suspend,
  // so both the facing and the switch must already be set on the very frame
  // the conversation was entered, before any further frames advance at all.
  assert.equal(nes.cpu.mem[ENT_DIR], DIR_UP, 'facing is set the instant Turn runs');
  assert.equal(switchOn(nes, 5), true, 'and the command after it already ran -- Turn does not suspend the event');
  assert.equal(nes.cpu.mem[MV_LEFT], 0, 'Turn must never touch mv_left -- it is not a Move');
  // "Turns without walking" means exactly that: move_face (the routine both
  // Move and Turn call) sets facing alone, and a Turn that also nudged the
  // mover's own coordinates -- the way a live Move's step routine does --
  // would still pass every assertion above this one.
  assert.equal(nes.cpu.mem[ENT_X], entX, 'a Turn must not move the entity along X');
  assert.equal(nes.cpu.mem[ENT_Y], entY, 'a Turn must not move the entity along Y');
});

test('a Turn sets the player’s facing, not the actor that is speaking', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [{ op: 'turn', who: 'player', dir: 'left' }]);

  assert.equal(nes.cpu.mem[PLAYER_DIR], DIR_DOWN, 'the player starts facing down, the boot default');
  const [playerX, playerY] = [nes.cpu.mem[PLAYER_X], nes.cpu.mem[PLAYER_Y]];
  tap(nes, B, 0);
  assert.equal(nes.cpu.mem[PLAYER_DIR], DIR_LEFT, 'the player’s facing changed');
  assert.equal(nes.cpu.mem[ENT_DIR], DIR_DOWN, 'the NPC that was spoken to kept its own facing');
  // The identical "turns without walking" invariant the entity-side test
  // above asserts, applied to the player: move_face sets player_dir alone.
  assert.equal(nes.cpu.mem[PLAYER_X], playerX, 'a Turn must not move the player along X');
  assert.equal(nes.cpu.mem[PLAYER_Y], playerY, 'a Turn must not move the player along Y');
});

test('a Wait pauses the event for exactly the authored number of frames, then the next command runs', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'wait', frames: 10 },
    { op: 'setSwitch', switch: 6 }
  ]);

  // wt_left decrements once on the very frame the button press starts the
  // event (it is set to 10 and read back as 9 that same frame -- traced
  // directly against a real build before writing these numbers down), so
  // the switch turns on exactly 10 frames after the button-down frame, not
  // 10 frames after tap() returns. tap()'s own button-down frame plus its
  // default two follow-on frames leaves wt_left at 7; six more lands one
  // frame short of the count (wt_left 1, still waiting), and the seventh is
  // the transition.
  tap(nes, B); // talk: the page runs, hits Wait and suspends
  assert.equal(switchOn(nes, 6), false, 'the command after Wait must not have run yet');
  assert.equal(nes.cpu.mem[GAME_STATE], 2, 'the world stays frozen (ST_DIALOG) while the wait runs');

  run(nes, 6);
  assert.equal(switchOn(nes, 6), false, 'still waiting one frame before the count is up');
  assert.equal(nes.cpu.mem[WT_LEFT], 1, 'exactly one frame of the wait should remain');

  run(nes, 1); // the frame the countdown reaches zero
  assert.equal(switchOn(nes, 6), true, 'the wait finished and the next command ran');
  assert.ok(settle(nes), 'the conversation ends once Wait is over');
});

// Every Wait test above it runs with box_state at 0 -- the page's very first
// command is the Wait, so no box has ever been raised. ui.asm's own ui_tick
// comment says a box "may well be sitting open above the actor doing the
// walking (or the wait)" and tests wt_left *before* it ever looks at
// game_state for exactly that reason -- but nothing here had walked the one
// path that actually opens a box first: Say, dismissed, straight into Wait.
// Dismissing a Say's own BOX_ENDWAIT runs text_advance_end -> script_resume
// -> script_run (engine/text.asm, engine/script.asm), and neither of those
// touches box_state at all, so the box the Say left open stays open,
// unclosed, for the entire Wait that follows it. A wrong ui_tick that only
// serviced wt_left while box_state was 0 (say, `lda box_state / bne
// ui_tick_wait_done` guarding the WAIT_ENABLED block) would pass every other
// test in this file and simply never resume this event at all.
test('a Wait pauses correctly with a message box still open above it, the Say -> Wait -> SetSwitch path', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'say', text: 'Hi.' },
    { op: 'wait', frames: 10 },
    { op: 'setSwitch', switch: 8 }
  ]);

  tap(nes, B); // talk: the Say opens the box and types itself out
  for (let i = 0; i < 400 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the Say should have finished typing and be waiting to be dismissed');

  // Traced directly against a real build, the identical discipline the
  // box-closed Wait test above already applies: wt_left decrements once per
  // frame starting with the very frame that resumes the script, regardless
  // of whether a box happens to be sitting open above it, so tap()'s own
  // button-down frame plus its default two follow-on frames leaves wt_left
  // at 7 here exactly as it does there.
  tap(nes, A); // dismiss the Say -- script_resume runs Wait next, which suspends at once
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the box from the Say stays open while the Wait after it runs');
  assert.equal(switchOn(nes, 8), false, 'the command after Wait must not have run yet');
  assert.equal(nes.cpu.mem[GAME_STATE], 2, 'the world stays frozen (ST_DIALOG) while the wait runs');
  assert.equal(nes.cpu.mem[WT_LEFT], 7, 'three frames of the ten-frame wait should already be spent');

  run(nes, 6);
  assert.equal(switchOn(nes, 8), false, 'still waiting one frame before the count is up');
  assert.equal(nes.cpu.mem[WT_LEFT], 1, 'exactly one frame of the wait should remain');
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the box is still exactly where the Say left it, one frame before the wait ends');

  run(nes, 1); // the frame the countdown reaches zero
  assert.equal(switchOn(nes, 8), true, 'the wait finished and the next command ran');
  assert.ok(settle(nes), 'the conversation ends once Wait is over and the box comes down');
});

test('a Wait of zero does not suspend the event at all', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'wait', frames: 0 },
    { op: 'setSwitch', switch: 7 }
  ]);

  tap(nes, B, 0);
  // Nothing to wait for, so the page ran straight through -- the identical
  // reasoning a Move of distance 0 already gets in move.test.js: if a
  // zero-frame Wait suspended, wt_left would be zero with a script waiting on
  // it reaching zero, a wait nothing could ever end.
  assert.equal(switchOn(nes, 7), true, 'the next command runs immediately');
  assert.equal(nes.cpu.mem[WT_LEFT], 0, 'nothing was left suspended');
});

test('a scripted Move then a scripted Wait are never suspended at the same time', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Verified, not assumed: review's own claim was that mv_left and wt_left
  // can never both be non-zero, because a page suspends on whichever of
  // Move or Wait it reaches first and cannot reach the other until that one
  // resumes. This walks a real event through both commands back to back and
  // samples every single frame in between, rather than trusting the reasoning.
  const { nes } = await buildWith(t, [
    { op: 'move', who: 'self', dir: 'left', dist: 32 },
    { op: 'wait', frames: 20 },
    { op: 'turn', who: 'player', dir: 'up' }
  ]);

  tap(nes, B);
  let sawMove = false;
  let sawWait = false;
  let overlap = false;
  for (let i = 0; i < 80 && nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY; i++) {
    nes.frame();
    const mv = nes.cpu.mem[MV_LEFT];
    const wt = nes.cpu.mem[WT_LEFT];
    if (mv) sawMove = true;
    if (wt) sawWait = true;
    if (mv && wt) overlap = true;
  }
  assert.ok(sawMove, 'the Move should have been observed running');
  assert.ok(sawWait, 'the Wait should have been observed running');
  assert.equal(overlap, false, 'mv_left and wt_left must never both be non-zero on the same frame');
  assert.equal(nes.cpu.mem[ENT_X], START_X - 32, 'the Move finished first, exactly the authored distance');
  assert.equal(nes.cpu.mem[PLAYER_DIR], DIR_UP, 'and the Turn after the Wait still ran, in order');
});

// Round review (Low 3): the test above only covers Move -> Wait, where
// script_op_wait's own `sta wt_left` overwrites whatever mv_left's own
// resume left behind -- so a defective wait_tick that calls script_resume
// one frame early, while wt_left is still 1 rather than 0, would still pass
// it: mv_left is already 0 by the time Wait starts (Move finished first),
// so there is nothing for wait_tick's own stale non-zero wt_left to overlap
// with. The reverse order is what actually exercises that: if wait_tick
// resumes with wt_left still non-zero, the very next command (a Move) sets
// mv_left non-zero on the same frame, and the two overlap for real.
test('a scripted Wait then a scripted Move are never suspended at the same time', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'wait', frames: 10 },
    { op: 'move', who: 'self', dir: 'left', dist: 32 },
    { op: 'turn', who: 'player', dir: 'up' }
  ]);

  tap(nes, B);
  let sawMove = false;
  let sawWait = false;
  let overlap = false;
  for (let i = 0; i < 80 && nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY; i++) {
    nes.frame();
    const mv = nes.cpu.mem[MV_LEFT];
    const wt = nes.cpu.mem[WT_LEFT];
    if (mv) sawMove = true;
    if (wt) sawWait = true;
    if (mv && wt) overlap = true;
  }
  assert.ok(sawWait, 'the Wait should have been observed running');
  assert.ok(sawMove, 'the Move should have been observed running');
  assert.equal(overlap, false, 'wt_left and mv_left must never both be non-zero on the same frame');
  assert.equal(nes.cpu.mem[ENT_X], START_X - 32, 'the Move still ran after the Wait, exactly the authored distance');
  assert.equal(nes.cpu.mem[PLAYER_DIR], DIR_UP, 'and the Turn after the Move still ran, in order');
});

// ------------------------------------------------- what a project pays for it

test('a switched-off Turn and a switched-off Wait cost a project nothing — not one byte of ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const withOff = await buildWith(t, [
    { op: 'turn', who: 'self', dir: 'up', off: true },
    { op: 'wait', frames: 10, off: true },
    { op: 'setSwitch', switch: 5 }
  ]);
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);

  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a disabled Turn and Wait must leave the ROM identical to one with neither at all'
  );
});

test('projectUsesTurn and projectUsesWait ignore a command the compiler would drop', () => {
  const project = createProject('Predicate');
  const pages = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'turn', who: 'self', dir: 'left' }]) }];
  assert.equal(projectUsesTurn(project), true, 'a live Turn counts');
  assert.equal(projectUsesFace(project), true, 'and it alone is enough to need move_face');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'turn', who: 'self', dir: 'left', off: true }]) }];
  assert.equal(projectUsesTurn(project), false, 'a switched-off one does not');
  assert.equal(projectUsesFace(project), false, 'and neither does move_face -- nothing else calls it here');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'wait', frames: 30 }]) }];
  assert.equal(projectUsesWait(project), true, 'a live Wait counts');
  assert.equal(projectUsesFace(project), false, 'Wait does not touch move_face at all');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'wait', frames: 30, off: true }]) }];
  assert.equal(projectUsesWait(project), false, 'a switched-off Wait does not');

  // Inside a branch, the same place usedSwitches once failed to look.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        {
          op: 'branch',
          cond: { type: 'none', arg: 0 },
          then: [{ op: 'turn', who: 'self', dir: 'left' }],
          else: [{ op: 'wait', frames: 5 }]
        }
      ])
    }
  ];
  assert.equal(projectUsesTurn(project), true, 'a Turn nested inside a branch still counts');
  assert.equal(projectUsesWait(project), true, 'so does a Wait in the other side');

  // A question's own options are a second place a command can hide, the same
  // way a branch's two sides already are above -- liveCommands
  // (shared/eventrules.js) recurses into choice.options[] for exactly this
  // reason, but nothing here had ever driven a Turn or a Wait through one: a
  // projectUsesTurn/projectUsesWait that walked only a page's own list and a
  // branch's then/else, and never a choice's options, would still pass every
  // test above it in this file.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        {
          op: 'choice',
          options: [
            { text: 'Turn', commands: [{ op: 'turn', who: 'self', dir: 'left' }] },
            { text: 'Wait', commands: [{ op: 'wait', frames: 5 }] }
          ]
        }
      ])
    }
  ];
  assert.equal(projectUsesTurn(project), true, 'a Turn inside a Choice option still counts');
  assert.equal(projectUsesWait(project), true, 'so does a Wait inside another option');

  // And a switched-off one inside an option is scaffolding the compiler
  // drops, the identical reasoning the top-level and branch-nested cases
  // above already apply.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        {
          op: 'choice',
          options: [
            { text: 'Turn', commands: [{ op: 'turn', who: 'self', dir: 'left', off: true }] },
            { text: 'Wait', commands: [{ op: 'wait', frames: 5, off: true }] }
          ]
        }
      ])
    }
  ];
  assert.equal(projectUsesTurn(project), false, 'a switched-off Turn inside a Choice option does not count');
  assert.equal(projectUsesWait(project), false, 'neither does a switched-off Wait inside a Choice option');
});
