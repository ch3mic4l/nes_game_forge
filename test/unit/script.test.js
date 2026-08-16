// Events: pages, conditions, switches, and the actor that stops being there.
//
// The showcase is the chest — page one gives a gem and turns a switch on, page
// two is guarded by that switch and says the chest is empty — because it is the
// smallest thing that exercises page selection, a condition, a command with a
// side effect and the ordering between them all at once. Everything here builds
// its own project rather than touching `sample/`, which is a checked-in fixture.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { ARROW_TILE, FONT_BASE } from '../../shared/font.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import {
  compileText,
  EVT_PAGES_END,
  OP_JUMP,
  OP_END,
  OP_CALL,
  OP_MUSIC,
  NO_SONG,
  OP_BATTLE,
  NO_ACTOR,
  NO_COMMON_EVENT_SLOT,
  opIndex
} from '../../main/build/textcompile.js';
import {
  createProject,
  normalizeProject,
  validateProject,
  compiledPages,
  enabledCommands,
  CHOICE_LIMITS,
  RPG_LIMITS,
  BEHAVIORS,
  EVENT_COMMANDS,
  EVENT_CONDITIONS,
  MAX_BRANCH_DEPTH,
  availableTriggers,
  effectiveTrigger,
  NO_COMMON_EVENT_ID,
  commonEventId
} from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const INV_COUNT = 0x37;
const BOX_STATE = 0x40;
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const INV_ITEMS = 0x378;
const SWITCHES = 0x390;
const VARIABLES = 0x500;
const PLAYER_HP = 0x4e;
const PENDING_ENT = 0x7c;
const NO_ENTITY = 0xff;

const ST_GAMEPLAY = 0;
const BOX_PAGEWAIT = 3;
const BOX_ENDWAIT = 6;
const BOX_CHOICEWAIT = 8;
const CHOICE_SEL = 0x7a;
// The box is nametable rows 24-29 and its text starts on the second of them,
// from BOX_ADDR_HI/BOX_TEXT_LO in engine/constants.asm.
const TEXT_ROW = 25;

const A = 0;
const B = 1;
const UP = 4;
const DOWN = 5;
const RIGHT = 7;

/** The player start, so an actor placed here is inside the interact reach. */
const START_X = 112;
const START_Y = 112;

function boot(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  // A cartridge with a title screen boots into it; every scenario here is about
  // the game behind it, so press through. `game_state` is ST_TITLE only when the
  // project actually has one, so this is a no-op for the ROMs that do not.
  if (nes.cpu.mem[0x25] === 3) {
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

const hold = (nes, button, frames) => {
  nes.buttonDown(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
  nes.buttonUp(1, button);
  nes.frame();
};

const waiting = (nes) => {
  const box = nes.cpu.mem[BOX_STATE];
  return box === BOX_PAGEWAIT || box === BOX_ENDWAIT || box === BOX_CHOICEWAIT;
};

/**
 * Talk, then press through every page until the conversation ends.
 *
 * `answers` is what to do at each question, in the order they come up: how many
 * rows down the cursor moves before the button. A question with no answer left
 * takes the first option, which is what an empty list means.
 */
function talkThrough(nes, budget = 30, answers = []) {
  tap(nes, B);
  const pending = [...answers];
  for (let press = 0; press < budget; press++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    // Wait for the box to want an answer, then give it one. A press outside a
    // wait is ignored by design, so polling for the wait is what makes this
    // independent of how long the text is.
    for (let frame = 0; frame < 600; frame++) {
      if (waiting(nes) || nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) break;
      nes.frame();
    }
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    if (nes.cpu.mem[BOX_STATE] === BOX_CHOICEWAIT) {
      const steps = pending.shift() ?? 0;
      for (let step = 0; step < steps; step++) tap(nes, DOWN);
    }
    tap(nes, A);
    for (let i = 0; i < 20; i++) nes.frame();
  }
  return nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
}

/** Run frames until the question is up and waiting, or give up. */
function reachQuestion(nes, frames = 600) {
  for (let frame = 0; frame < frames; frame++) {
    if (nes.cpu.mem[BOX_STATE] === BOX_CHOICEWAIT) return true;
    nes.frame();
  }
  return false;
}

const switchOn = (nes, n) => Boolean(nes.cpu.mem[SWITCHES + (n >> 3)] & (1 << (n & 7)));

// Every actor these tests talk to is an `npc`: a patroller would walk out of the
// interact action's 20-pixel reach between one conversation and the next, and a
// test that has to chase its subject is testing the chase.
const NPC = 4; // appended by buildWith, after the sample's four actors
const GEM = 1;

/**
 * A one-screen project with whatever actors the caller places, built and booted.
 * Derived from the sample so there is real art and a real tileset behind it.
 */
async function buildWith(t, entities, tweak = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-script-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const slime = project.sprites.actors[0];
  project.sprites.actors.push({ ...structuredClone(slime), id: NPC, name: 'Chest', behavior: 'npc' });
  assert.equal(project.sprites.actors[NPC].id, NPC, 'the sample gained an actor');
  project.maps[0].screens[0].entities = entities;
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  // The ROM path as well as a booted machine: a test about what happens on the
  // title screen has to do its own booting, because `boot` presses through it.
  return { project, romPath: built.romPath, nes: boot(built.romPath) };
}

const chest = (pages) => ({
  actorId: NPC,
  x: START_X,
  y: START_Y - 16,
  props: { event: { pages } }
});

test('a page guarded by the switch it sets runs exactly once', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'switchOff', arg: 5 },
        commands: [
          { op: 'say', text: 'A gem sits inside.' },
          { op: 'give', actor: GEM },
          { op: 'setSwitch', switch: 5 }
        ]
      },
      { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'It is empty.' }] }
    ])
  ]);

  assert.equal(nes.cpu.mem[INV_COUNT], 0);
  assert.equal(switchOn(nes, 5), false);

  assert.ok(talkThrough(nes), 'the first conversation never ended');
  assert.equal(nes.cpu.mem[INV_COUNT], 1, 'the chest did not give the gem');
  assert.equal(nes.cpu.mem[INV_ITEMS], 1, 'the bag should hold the gem actor');
  assert.equal(switchOn(nes, 5), true, 'the chest did not set its switch');

  assert.ok(talkThrough(nes), 'the second conversation never ended');
  assert.equal(nes.cpu.mem[INV_COUNT], 1, 'the guarded page ran a second time');
});

test('Take removes what Give handed over, and Carrying gates on it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    chest([
      // Only reachable while the gem is in the bag, and it takes it back — so
      // page one runs, then page two, then page one again, forever.
      {
        cond: { type: 'hasItem', arg: GEM },
        commands: [{ op: 'say', text: 'You hand it over.' }, { op: 'take', actor: GEM }]
      },
      {
        cond: { type: 'none', arg: 0 },
        commands: [{ op: 'say', text: 'Here, take this.' }, { op: 'give', actor: GEM }]
      }
    ])
  ]);

  assert.ok(talkThrough(nes));
  assert.equal(nes.cpu.mem[INV_COUNT], 1, 'the fallback page should have given a gem');

  assert.ok(talkThrough(nes));
  assert.equal(nes.cpu.mem[INV_COUNT], 0, 'carrying the gem should have reached the Take page');

  assert.ok(talkThrough(nes));
  assert.equal(nes.cpu.mem[INV_COUNT], 1, 'an empty bag should fall through to the second page again');
});

test('a Give naming an actor past the end of the list does not pass validation', () => {
  // Not renumberActorDeletion's null -- a plain out-of-range id, the shape a
  // project written by a later version or a hand-edited one can hold
  // without ever having gone through a deletion at all. actorMissing
  // (shared/project.js) has to catch this the same way it catches null.
  const project = createProject('Quest');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: 99 }] }] } }
  });
  const errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.ok(
    errors.some((p) => /do not name a real/.test(p.message)),
    'a Give past the end of the actor list should not pass validation'
  );
});

/** The first index at which `needle` occurs in `haystack`, or -1. */
function indexOfBytes(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

test('script_op_give stops the event on NO_ACTOR rather than indexing the bag or carrying on', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // validateProject already refuses to let a *live* unresolvable Give reach
  // buildProject (the test above), so there is no project this test could
  // author that would compile NO_ACTOR through the front door — which is
  // exactly the point: the guard this proves is for whatever validateProject
  // does not see, a hand-edited or later-version ROM among them. So this
  // builds an ordinary, valid ROM and patches the one byte a corrupt project
  // could produce, the same way applyHeaderPatch (main/build/pipeline.js)
  // already rewrites an assembled ROM's bytes directly for UNROM 512.
  //
  // A command after the Give is what tells "stopped" and "skipped" apart:
  // an opcode the engine cannot run is supposed to stop the event the same
  // way script_run_bad's unknown-opcode case does, not carry on to whatever
  // comes next having silently not done the thing it was there for.
  const OP_GIVE = opIndex('give');
  const TOUCHED_SWITCH = 5;
  const entities = [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          { op: 'say', text: 'Here.' },
          { op: 'give', actor: GEM },
          { op: 'setSwitch', switch: TOUCHED_SWITCH }
        ]
      }
    ])
  ];
  const { project, romPath } = await buildWith(t, entities);

  const [compiled] = compileText(normalizeProject(structuredClone(project))).events;
  const giveAt = compiled.indexOf(OP_GIVE);
  assert.notEqual(giveAt, -1, 'the compiled event has no OP_GIVE to find');
  assert.equal(compiled[giveAt + 1], GEM, "OP_GIVE's own argument should be the actor id right after it");

  const romBytes = fs.readFileSync(romPath);
  const at = indexOfBytes(romBytes, compiled);
  assert.notEqual(at, -1, "the compiled event's own bytes were not found verbatim in the built ROM");
  assert.equal(
    indexOfBytes(romBytes.subarray(at + 1), compiled),
    -1,
    'the compiled event should appear exactly once, or patching one occurrence proves nothing about which ran'
  );

  const patched = Uint8Array.from(romBytes);
  patched[at + giveAt + 1] = NO_ACTOR;
  const patchedPath = path.join(path.dirname(romPath), 'patched.nes');
  await fs.promises.writeFile(patchedPath, patched);

  // Through boot(), not a fresh NES() with no further setup: the sample
  // fixture has a title screen, and only boot() knows to press through it.
  const nes = boot(patchedPath);

  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[INV_COUNT], 0, 'a NO_ACTOR byte reached add_item and indexed the bag with it');
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << TOUCHED_SWITCH),
    0,
    'the event carried on past the unrunnable Give instead of stopping there'
  );
});

test('script_op_call stops the event on NO_COMMON_EVENT_SLOT rather than skipping past it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Same technique as script_op_give's NO_ACTOR test just above, and for the
  // same reason: validateProject already refuses a *live* call naming a
  // common event that does not resolve, so there is no project this test
  // could author that would compile NO_COMMON_EVENT_SLOT through the front
  // door. This builds an ordinary, valid ROM with a call that genuinely
  // resolves, then patches the one byte a corrupt project (hand-edited, or
  // written by a later version) could produce, the same way applyHeaderPatch
  // (main/build/pipeline.js) already rewrites an assembled ROM's bytes
  // directly for UNROM 512.
  //
  // Reproduces "Call Reward, then Set switch Quest complete" for real, in
  // the emulator: before this fix, the engine had nothing to refuse -- the
  // compiler dropped an unresolved call entirely, so there was no byte here
  // to patch at all and the switch after it always ran. Now the compiler
  // always emits the call, so the byte exists, and script_op_call reading
  // NO_COMMON_EVENT_SLOT out of it is what has to stop the event rather than
  // running the Set switch that follows.
  const REWARD_VAR = 0;
  const TOUCHED_SWITCH = 5;
  const entities = [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          { op: 'say', text: 'Here.' },
          { op: 'call', event: 0 },
          { op: 'setSwitch', switch: TOUCHED_SWITCH }
        ]
      }
    ])
  ];
  const { project, romPath } = await buildWith(t, entities, (project) => {
    project.commonEvents = [
      {
        name: 'Reward',
        event: {
          pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: REWARD_VAR, value: 1 }] }]
        }
      }
    ];
  });

  // events[0] is the Reward common event itself -- compileText (main/build/
  // textcompile.js) pushes every live common event before it walks the
  // placed entities -- so the chest's own compiled event, the one carrying
  // OP_CALL, is events[1].
  const [, compiled] = compileText(normalizeProject(structuredClone(project))).events;
  const callAt = compiled.indexOf(OP_CALL);
  assert.notEqual(callAt, -1, 'the compiled event has no OP_CALL to find');
  assert.notEqual(compiled[callAt + 1], NO_COMMON_EVENT_SLOT, "the call should have resolved to a real slot, not already be NO_COMMON_EVENT_SLOT");

  const romBytes = fs.readFileSync(romPath);
  const at = indexOfBytes(romBytes, compiled);
  assert.notEqual(at, -1, "the compiled event's own bytes were not found verbatim in the built ROM");
  assert.equal(
    indexOfBytes(romBytes.subarray(at + 1), compiled),
    -1,
    'the compiled event should appear exactly once, or patching one occurrence proves nothing about which ran'
  );

  const patched = Uint8Array.from(romBytes);
  patched[at + callAt + 1] = NO_COMMON_EVENT_SLOT;
  const patchedPath = path.join(path.dirname(romPath), 'patched.nes');
  await fs.promises.writeFile(patchedPath, patched);

  const nes = boot(patchedPath);

  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + REWARD_VAR], 0, 'a NO_COMMON_EVENT_SLOT byte reached event_ptr_lo/hi and ran Reward anyway');
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << TOUCHED_SWITCH),
    0,
    'the event carried on past the unresolvable Call instead of stopping there'
  );
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the world was not handed back -- the event should have ended, not hung');
});

test('an actor hidden by a switch is gone the next time the screen loads', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Two actors: one that sets switch 3, and one that is hidden by it. The hidden
  // one is placed first, so this also proves a skipped record does not eat a
  // slot — the setter has to still spawn, into slot 0.
  const { nes } = await buildWith(t, [
    { actorId: NPC, x: 32, y: 32, props: { hideSwitch: 3 } },
    {
      actorId: NPC,
      x: START_X,
      y: START_Y - 16,
      props: {
        event: {
          pages: [
            { cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 3 }, { op: 'say', text: 'Gone.' }] }
          ]
        }
      }
    }
  ]);

  assert.equal(nes.cpu.mem[ENT_ACTIVE + 0], 1, 'the hideable actor should spawn while the switch is off');
  assert.equal(nes.cpu.mem[ENT_ACTIVE + 1], 1, 'the setter should spawn too');

  assert.ok(talkThrough(nes));
  assert.equal(switchOn(nes, 3), true);
  // Still on screen: spawning is what reads the switch, and that has not run again.
  assert.equal(nes.cpu.mem[ENT_ACTIVE + 0], 1);

  // Walk off the screen and back, which respawns.
  const walk = (button, frames) => {
    nes.buttonDown(1, button);
    for (let i = 0; i < frames; i++) nes.frame();
    nes.buttonUp(1, button);
  };
  walk(5, 120); // down, into the neighbouring screen
  assert.notEqual(nes.cpu.mem[FLAT_SCREEN], 0, 'never left the first screen');
  walk(4, 120); // back up
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 0, 'never came back');

  assert.equal(nes.cpu.mem[ENT_ACTIVE + 0], 1, 'a slot should still be filled');
  assert.equal(
    nes.cpu.mem[ENT_ACTOR + 0],
    NPC,
    'the surviving actor should have moved down into slot 0 rather than leaving a hole'
  );
  // Exactly one actor now, where there were two.
  const live = [...nes.cpu.mem.slice(ENT_ACTIVE, ENT_ACTIVE + 8)].filter(Boolean).length;
  assert.equal(live, 1, 'the hidden actor came back');
});

test('Warp moves the player, and the conversation ends when it does', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          { op: 'say', text: 'The floor gives way.' },
          { op: 'warp', screen: 3, x: 64, y: 48 }
        ]
      }
    ])
  ]);

  assert.equal(nes.cpu.mem[FLAT_SCREEN], 0);
  assert.ok(talkThrough(nes));
  for (let i = 0; i < 10; i++) nes.frame();

  assert.equal(nes.cpu.mem[FLAT_SCREEN], 3, 'the warp did not move the player');
  assert.equal(nes.cpu.mem[PLAYER_X], 64);
  assert.equal(nes.cpu.mem[PLAYER_Y], 48);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  assert.equal(nes.cpu.mem[BOX_STATE], 0, 'the box should be down after a warp');
});

test('an event whose every page is ruled out says nothing and ends cleanly', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    chest([{ cond: { type: 'switchOn', arg: 9 }, commands: [{ op: 'say', text: 'Never.' }] }])
  ]);

  tap(nes, B);
  for (let i = 0; i < 30; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'a silent event should not strand the player');
  assert.equal(nes.cpu.mem[BOX_STATE], 0);
});

// --- switching a command off -------------------------------------------------

test('a switched-off command leaves the ROM, and takes an emptied page with it', () => {
  const project = createProject('Toggles');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  const entity = {
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      dialogue: 'Fallback line.',
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'say', text: 'Kept.' },
              { op: 'setSwitch', switch: 4, off: true }
            ]
          }
        ]
      }
    }
  };
  project.maps[0].screens[0].entities = [entity];

  const compiled = compileText(project);
  const bytes = compiled.events[0];
  // [cond, arg, value, body length, ...body, EVT_PAGES_END] — the disabled
  // setSwitch is simply not there, so the body is one say plus the terminator.
  assert.equal(bytes[3], 3, 'body carries only the enabled command and OP_END');
  assert.equal(bytes.at(-1), EVT_PAGES_END);

  // Switch the last live command off and the page has nothing left to run. It
  // must not compile as an empty page: a page that matches and does nothing
  // swallows every page below it, so the event is gone and the plain dialogue
  // underneath comes back instead.
  entity.props.event.pages[0].commands[0].off = true;
  const emptied = compileText(project);
  assert.deepEqual(compiledPages(entity.props.event), [], 'nothing left to build');
  assert.equal(emptied.events.length, 1, 'the dialogue still needs an event');
  assert.equal(emptied.events[0][3], 3, 'one unconditional say — the fallback dialogue');
  assert.notEqual(
    emptied.strings.findIndex((bytes) => bytes.length),
    -1,
    'the fallback text was compiled'
  );

  // And with no dialogue to fall back on, the actor has no event at all.
  delete entity.props.dialogue;
  assert.equal(compileText(project).events.length, 0);
});

test('the off flag survives normalization only when it is set', () => {
  const project = normalizeProject({
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                props: {
                  event: {
                    pages: [
                      {
                        cond: { type: 'none', arg: 0 },
                        commands: [
                          { op: 'say', text: 'On' },
                          { op: 'say', text: 'Off', off: true },
                          { op: 'say', text: 'Nonsense', off: 'yes' }
                        ]
                      }
                    ]
                  }
                }
              }
            ]
          }
        ]
      }
    ]
  });
  const commands = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  assert.equal('off' in commands[0], false, 'an enabled command carries no flag at all');
  assert.equal(commands[1].off, true);
  assert.equal('off' in commands[2], false, 'only a literal true counts');

  // And the shared rule has to read `off` the same way the schema writes it.
  // A truthiness test here would call { off: 'yes' } disabled before a load and
  // enabled after one, so the same hand-edited project would compile to two
  // different ROMs depending on whether it had been through normalization.
  const page = {
    commands: [{ op: 'say', text: 'a' }, { op: 'say', text: 'b', off: true }, { op: 'say', text: 'c', off: 'yes' }]
  };
  assert.deepEqual(
    enabledCommands(page).map((command) => command.text),
    ['a', 'c'],
    'only a literal true disables, before normalization as well as after'
  );
});

test('switching every command off keeps the work and only stops the build', () => {
  // The toggle's promise is that a command can be taken out of the ROM without
  // being lost. The editor's Save therefore keeps a page whose commands are all
  // off — it is the genuinely empty page it drops — and only compiledPages
  // decides what is built.
  const project = createProject('Held');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  const event = {
    pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Kept.', off: true }] }]
  };
  project.maps[0].screens[0].entities = [{ actorId: 0, x: 0, y: 0, props: { event } }];

  const reloaded = normalizeProject(structuredClone(project));
  assert.deepEqual(
    reloaded.maps[0].screens[0].entities[0].props.event,
    event,
    'a save/load round trip keeps what was switched off, text and all'
  );
  assert.deepEqual(compiledPages(event), [], 'and none of it reaches the ROM');
  assert.equal(compileText(project).events.length, 0, 'no event, and no dialogue to fall back on');
});

// --------------------------------------------------------------- variables
//
// A switch answers yes or no. A variable counts, which is what a quest stage,
// a tally of what has been handed over or a score needs — and the thing worth
// testing is not that a byte can be written but that the counting and the
// comparison agree with each other over several conversations.

test('a variable counts, and a page waits for it to reach a number', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    chest([
      // Top page wins, so this one takes over the moment the count is high
      // enough — and stops the page below from counting any further.
      { cond: { type: 'varAtLeast', arg: 0, value: 3 }, commands: [{ op: 'say', text: 'That is plenty.' }] },
      {
        cond: { type: 'none', arg: 0 },
        commands: [{ op: 'say', text: 'One more.' }, { op: 'addVar', variable: 0, value: 1 }]
      }
    ])
  ]);

  for (let count = 1; count <= 3; count++) {
    assert.ok(talkThrough(nes), `conversation ${count} never ended`);
    assert.equal(nes.cpu.mem[VARIABLES], count, `the ${count}th talk should have counted`);
  }
  assert.ok(talkThrough(nes), 'the fourth conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES], 3, 'the guarded page took over, so nothing counted a fourth time');
});

test('a variable saturates rather than wrapping round', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // 250 + 10 and 5 - 20 are the two ends. Wrapping would put a quest counter
  // back at the beginning, which reads as the quest having been reset.
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          { op: 'say', text: 'Counting.' },
          { op: 'setVar', variable: 0, value: 250 },
          { op: 'addVar', variable: 0, value: 10 },
          { op: 'setVar', variable: 1, value: 5 },
          { op: 'subVar', variable: 1, value: 20 }
        ]
      }
    ])
  ]);

  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES], 255, '250 + 10 should stop at 255');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 0, '5 - 20 should stop at 0');
});


test('each comparison passes exactly when it should, and declines when it should not', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // One chest, five pages, four conversations. The pages are in the order the
  // engine checks them, so reaching page three means pages one and two both
  // declined — which is how a single build shows each comparison saying no as
  // well as yes. Variable 0 is walked 0 → 5 → 9 → 2 so that every comparison is
  // asked above its number, below it, and exactly on it — which is where a
  // plausible wrong implementation hides. "At least" is reached once strictly
  // above its number (9 ≥ 8) and once exactly on it (2 ≥ 2), and "under 2" is
  // asked at 2, where an "at most" would wrongly match. Every page writes its
  // own witness variable, and the last page must never run at all: a comparison
  // that wrongly declined would fall through to it and say so.
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'varUnder', arg: 0, value: 2 },
        commands: [
          { op: 'say', text: 'Under two.' },
          { op: 'setVar', variable: 1, value: 1 },
          { op: 'setVar', variable: 0, value: 5 }
        ]
      },
      {
        cond: { type: 'varEquals', arg: 0, value: 5 },
        commands: [
          { op: 'say', text: 'Exactly five.' },
          { op: 'setVar', variable: 2, value: 1 },
          { op: 'setVar', variable: 0, value: 9 }
        ]
      },
      {
        cond: { type: 'varAtLeast', arg: 0, value: 8 },
        commands: [
          { op: 'say', text: 'Eight or more.' },
          { op: 'setVar', variable: 3, value: 1 },
          { op: 'setVar', variable: 0, value: 2 }
        ]
      },
      {
        cond: { type: 'varAtLeast', arg: 0, value: 2 },
        commands: [{ op: 'say', text: 'Two or more.' }, { op: 'setVar', variable: 4, value: 1 }]
      },
      {
        cond: { type: 'none', arg: 0 },
        commands: [{ op: 'say', text: 'Nothing matched.' }, { op: 'setVar', variable: 5, value: 1 }]
      }
    ])
  ]);

  assert.ok(talkThrough(nes), 'the first conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 1, '0 is under 2');
  assert.equal(nes.cpu.mem[VARIABLES], 5);

  // 5: not under 2, and not 8 or more — but exactly 5.
  assert.ok(talkThrough(nes), 'the second conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 2], 1, '5 equals 5');
  assert.equal(nes.cpu.mem[VARIABLES], 9);

  // 9: not under 2, not equal to 5, and strictly above 8 rather than on it —
  // which is what an "at least" written as "equals" would fail.
  assert.ok(talkThrough(nes), 'the third conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 3], 1, '9 is 8 or more');
  assert.equal(nes.cpu.mem[VARIABLES], 2);

  // 2: "under 2" must decline standing exactly on its number, 8-or-more must
  // decline below its number, and 2-or-more must match exactly on it.
  assert.ok(talkThrough(nes), 'the fourth conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 4], 1, '2 is 2 or more, and 2 is not under 2');

  assert.equal(nes.cpu.mem[VARIABLES + 5], 0, 'a comparison declined when it should have matched');
});

test('a variable condition carries its number, and only such a condition does', () => {
  const withPage = (cond, commands = [{ op: 'say', text: 'Hm.' }]) => {
    const project = createProject('Counters');
    project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond, commands }] } } }
    ];
    return project;
  };

  const project = withPage({ type: 'varAtLeast', arg: 2, value: 7 }, [
    { op: 'addVar', variable: 2, value: 3 }
  ]);
  const [bytes] = compileText(project).events;
  // [cond, arg, value, body length, ...body]: the header is four bytes on every
  // page, and this is the condition that reads the third of them.
  assert.equal(bytes[1], 2, 'the variable');
  assert.equal(bytes[2], 7, 'the number it is compared against');
  assert.equal(bytes[3], 4, 'addVar is three bytes, then OP_END');

  // The field itself is only there when the condition uses it, exactly as `off`
  // is only there when it is true — otherwise every page in every project would
  // gain a `value: 0` the next time it was saved.
  const page = (p) => normalizeProject(structuredClone(p)).maps[0].screens[0].entities[0].props.event.pages[0];
  assert.equal(page(project).cond.value, 7);
  assert.equal('value' in page(withPage({ type: 'switchOn', arg: 1, value: 9 })).cond, false);
  assert.equal('value' in page(withPage({ type: 'none', arg: 0 })).cond, false);

  // Both bytes are clamped by the schema...
  const wild = withPage({ type: 'varEquals', arg: 99, value: 300 });
  assert.equal(page(wild).cond.arg, RPG_LIMITS.variables - 1);
  assert.equal(page(wild).cond.value, 255);

  // ...and, separately, by the compiler — which is the one that matters. The
  // engine indexes the 16-byte variable block with that byte and range-checks
  // nothing, and `buildProject` is handed the project the app is holding rather
  // than one that has just come back through the schema. So the clamp is proved
  // here against a project that has *not* been normalized: an index of 99 would
  // otherwise have the engine compare against whatever lies past the block.
  const [wildBytes] = compileText(wild).events;
  assert.equal(wildBytes[1], RPG_LIMITS.variables - 1, 'the compiler clamped the variable index');
  assert.equal(wildBytes[2], 255, 'and the number it is compared against');

  // The same for the commands that *write* a variable, which is the direction
  // where an unclamped index would land on somebody else's byte.
  const [writeBytes] = compileText(
    withPage({ type: 'none', arg: 0 }, [{ op: 'setVar', variable: 99, value: 4 }])
  ).events;
  assert.equal(writeBytes[5], RPG_LIMITS.variables - 1, 'the compiler clamped the written variable');
  assert.equal(writeBytes[6], 4);
});

// ----------------------------------------------------------------- branching
//
// A page condition decides which page runs before it runs. A branch decides in
// the middle of one, which is what "give the reward, but only if they are
// carrying the key" needs without two pages repeating everything they share.
//
// The engine keeps no stack: which way a branch went is only ever where
// script_ptr points. So the things worth proving are that both sides are
// reachable, that what follows the branch runs either way, that a Say can
// suspend inside one and resume correctly, and that nesting works — because all
// four of those are that one claim seen from different sides.

test('a branch runs one side or the other, and the rest of the page either way', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          {
            op: 'branch',
            cond: { type: 'switchOn', arg: 5 },
            then: [{ op: 'say', text: 'You have the key.' }, { op: 'setVar', variable: 1, value: 1 }],
            else: [{ op: 'say', text: 'Come back with the key.' }, { op: 'setVar', variable: 2, value: 1 }]
          },
          // After the branch, whichever way it went: this is what proves the
          // else-branch is stepped over rather than run into.
          { op: 'addVar', variable: 0, value: 1 },
          { op: 'setSwitch', switch: 5 }
        ]
      }
    ])
  ]);

  // First time through, switch 5 is off, so the else-branch runs.
  assert.ok(talkThrough(nes), 'the first conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 2], 1, 'the else-branch should have run');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 0, 'the then-branch ran as well');
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the commands after the branch did not run');

  // The page turned the switch on, so this time the then-branch runs — and the
  // tail runs again, which it could not if the else-branch had been fallen into.
  assert.ok(talkThrough(nes), 'the second conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 1, 'the then-branch should have run');
  assert.equal(nes.cpu.mem[VARIABLES], 2, 'the commands after the branch did not run the second time');
});

test('a branch nests, and an empty else is not fallen into', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          { op: 'setVar', variable: 0, value: 4 },
          {
            op: 'branch',
            cond: { type: 'varAtLeast', arg: 0, value: 3 },
            then: [
              {
                op: 'branch',
                cond: { type: 'varUnder', arg: 0, value: 9 },
                // Both an inner branch and the commands around it, so the outer
                // then-length has to have counted the whole of the inner one.
                then: [{ op: 'setVar', variable: 1, value: 1 }],
                else: [{ op: 'setVar', variable: 2, value: 1 }]
              },
              { op: 'setVar', variable: 3, value: 1 }
            ],
            // Nothing here at all: the compiler still emits the jump the taken
            // then-branch runs into, and it must land past this.
            else: []
          },
          { op: 'say', text: 'Done.' },
          { op: 'setVar', variable: 4, value: 1 }
        ]
      }
    ])
  ]);

  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 1, 'the inner then-branch should have run');
  assert.equal(nes.cpu.mem[VARIABLES + 2], 0, 'the inner else-branch ran too');
  assert.equal(nes.cpu.mem[VARIABLES + 3], 1, 'the outer then-branch stopped at its inner branch');
  assert.equal(nes.cpu.mem[VARIABLES + 4], 1, 'the page did not continue past the branch');
});

test('a message inside a branch suspends and resumes where it left off', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Say is the command that hands control to the message box for several frames,
  // and script_resume picks the event up from script_ptr knowing nothing about
  // branches. A branch whose then-side is two messages and a counter is the
  // smallest thing that would break if resuming lost its place.
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          {
            op: 'branch',
            cond: { type: 'none', arg: 0 },
            then: [
              { op: 'say', text: 'The door is stuck fast.' },
              { op: 'setVar', variable: 1, value: 1 },
              { op: 'say', text: 'You give it a shove.' },
              { op: 'addVar', variable: 1, value: 1 }
            ],
            else: [{ op: 'setVar', variable: 2, value: 1 }]
          },
          { op: 'setVar', variable: 3, value: 1 }
        ]
      }
    ])
  ]);

  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 2, 'both sides of the suspended message did not run');
  assert.equal(nes.cpu.mem[VARIABLES + 2], 0, 'the else-branch ran');
  assert.equal(nes.cpu.mem[VARIABLES + 3], 1, 'the page did not resume past the branch');
});

test('a branch compiles to a page header inline, and its lengths are checked', () => {
  const project = createProject('Branching');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  const page = (commands) => {
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
    return normalizeProject(structuredClone(project));
  };

  const built = compileText(
    page([
      {
        op: 'branch',
        cond: { type: 'varAtLeast', arg: 1, value: 4 },
        then: [{ op: 'setVar', variable: 2, value: 9 }],
        else: [{ op: 'setVar', variable: 3, value: 8 }, { op: 'setVar', variable: 4, value: 7 }]
      }
    ])
  );
  const [bytes] = built.events;
  assert.deepEqual(built.problems, []);

  // [cond, arg, value, body length] then the body. Past OP_IF the branch is
  // that same four-byte header — which is the whole reason the engine reads a
  // branch with the routine it reads a page with.
  const OP_IF = EVENT_COMMANDS.findIndex((entry) => entry.id === 'branch');
  const body = bytes.slice(4);
  assert.equal(body[0], OP_IF);
  assert.equal(body[1], EVENT_CONDITIONS.findIndex((entry) => entry.id === 'varAtLeast'), 'the condition');
  assert.equal(body[2], 1, 'the variable it compares');
  assert.equal(body[3], 4, 'the number it compares against');
  assert.equal(body[4], 3, 'the then-branch is one three-byte command');
  assert.equal(body[8], OP_JUMP, 'a taken then-branch has to run into the jump');
  assert.equal(body[9], 6, 'the else-branch is two three-byte commands');
  assert.equal(body[16], OP_END, 'and the page ends after the branch');

  // Nothing in the else-branch still emits the jump, because that is what the
  // end of a taken then-branch runs into.
  const [lonely] = compileText(
    page([{ op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'setVar', variable: 0, value: 1 }], else: [] }])
  ).events;
  assert.equal(lonely.slice(4)[8], OP_JUMP);
  assert.equal(lonely.slice(4)[9], 0, 'an empty else-branch is a jump of nothing');

  // Every length in this format is one byte, and a branch is what makes 255 of
  // them reachable. A body that overflowed would send the engine into the middle
  // of a command, so it is refused by name rather than wrapped. setVar is three
  // bytes, which is what makes the boundary reachable exactly.
  const filler = (count) => Array.from({ length: count }, () => ({ op: 'setVar', variable: 0, value: 1 }));
  const branchOf = (side, count) => [
    { op: 'branch', cond: { type: 'none', arg: 0 }, then: [], else: [], [side]: filler(count) }
  ];

  const longThen = compileText(page(branchOf('then', 90)));
  assert.equal(longThen.problems.length, 2, 'the branch and the page it is in are both too long');
  assert.match(longThen.problems[0].message, /→ If compiles to 270 bytes/);
  assert.match(longThen.problems[0].message, /A branch would not help/);
  assert.equal(longThen.problems[0].where, 'Map Forge');

  // The else side is measured too, and named as itself.
  const longElse = compileText(page(branchOf('else', 90)));
  assert.match(longElse.problems[0].message, /→ Else compiles to 270 bytes/);

  // Exactly 255 in a branch side is the largest that fits, and that side is not
  // reported — while the page around it is, by the seven bytes of branch framing
  // plus its own OP_END. Which is the whole reason the advice above says a
  // branch cannot rescue an oversized body.
  const edge = compileText(page(branchOf('then', 85)));
  assert.equal(
    edge.problems.filter((problem) => /→ If/.test(problem.message)).length,
    0,
    '255 bytes is the largest a branch side may be, and it fits'
  );
  assert.match(edge.problems[0].message, /page 1 compiles to 263 bytes/);

  // ...while a page body of exactly 255 bytes of commands is one too many,
  // because the OP_END that ends it is part of what the length has to describe.
  assert.deepEqual(compileText(page(filler(84))).problems, [], '84 commands and an OP_END is 253');
  const pageEdge = compileText(page(filler(85)));
  assert.equal(pageEdge.problems.length, 1);
  assert.match(pageEdge.problems[0].message, /page 1 compiles to 256 bytes/);
});

test('Play music compiles to a song index or NO_SONG for Silence', () => {
  const project = createProject('Jukebox');
  project.sprites.actors = [{ name: 'Speaker', behavior: 'npc' }];
  project.songs = [{ name: 'Theme' }];
  const page = (commands) => {
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
    return project;
  };

  const [named] = compileText(page([{ op: 'music', song: 0 }])).events;
  assert.deepEqual(named.slice(4, 6), [OP_MUSIC, 0], 'a live song compiles to its own index');

  const [silence] = compileText(page([{ op: 'music', song: null }])).events;
  assert.deepEqual(silence.slice(4, 6), [OP_MUSIC, NO_SONG], 'Silence compiles to NO_SONG');

  // A reference to a song that used to exist — deleted since, or never valid
  // to begin with — falls back to NO_SONG rather than pointing at whichever
  // song the table happens to hold at that index, same as an unresolvable
  // common event call falls back to NO_COMMON_EVENT_SLOT rather than running
  // whichever one the table happens to hold in its place.
  const [stale] = compileText(page([{ op: 'music', song: 5 }])).events;
  assert.deepEqual(stale.slice(4, 6), [OP_MUSIC, NO_SONG], 'a song past the end of the list falls back to NO_SONG');
});

test('Start a battle compiles to a fixed, NO_ACTOR-padded formation', () => {
  const project = createProject('Boss Fight', 'rpg');
  project.sprites.actors = [
    { name: 'Villager', damage: 0 },
    { name: 'Slime', damage: 4 },
    { name: 'Ogre', damage: 8 }
  ];
  const page = (commands) => {
    project.maps[0].screens[0].entities = [
      { actorId: 1, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
    return project;
  };

  const [partial] = compileText(page([{ op: 'battle', monsters: [1, 2] }])).events;
  assert.deepEqual(
    partial.slice(4, 9),
    [OP_BATTLE, 1, 2, NO_ACTOR, NO_ACTOR],
    'a two-monster formation should NO_ACTOR-pad the rest, not leave the command short'
  );

  const [full] = compileText(page([{ op: 'battle', monsters: [1, 2, 1, 2] }])).events;
  assert.deepEqual(full.slice(4, 9), [OP_BATTLE, 1, 2, 1, 2], 'a full formation needs no padding');

  // RPG_LIMITS.monstersPerBattle is the box the formation fits in, the same
  // way CHOICE_LIMITS.options is the box a question's answers fit in: past
  // it is dropped rather than overflowing into whatever byte comes next.
  const [tooMany] = compileText(page([{ op: 'battle', monsters: [1, 2, 1, 2, 1] }])).events;
  assert.deepEqual(tooMany.slice(4, 9), [OP_BATTLE, 1, 2, 1, 2], 'a fifth monster should be dropped, not overflow the command');
});

test('Give item / Take item compile to NO_ACTOR when the actor is missing', () => {
  const OP_GIVE = opIndex('give');
  const OP_TAKE = opIndex('take');
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'Gem', damage: 0 }];
  const page = (commands) => {
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
    return project;
  };

  const [named] = compileText(page([{ op: 'give', actor: 0 }])).events;
  assert.deepEqual(named.slice(4, 6), [OP_GIVE, 0], 'a live actor compiles to its own id');

  // renumberActorDeletion's mark for "this used to name an actor" -- not 0,
  // which a real actor could actually be sitting at.
  const [missing] = compileText(page([{ op: 'give', actor: null }])).events;
  assert.deepEqual(missing.slice(4, 6), [OP_GIVE, NO_ACTOR], 'a missing actor compiles to NO_ACTOR rather than 0');

  // Defensive: buildProject compiles the project the app is holding rather
  // than one freshly normalized, so a hand-edited or stale id past the end
  // of the actor list has to fall back the same way, not index the engine's
  // own tables past their end.
  const [stale] = compileText(page([{ op: 'take', actor: 5 }])).events;
  assert.deepEqual(stale.slice(4, 6), [OP_TAKE, NO_ACTOR], 'an actor past the end of the list falls back to NO_ACTOR');
});

test('a branch nested deeper than the editor offers still survives a round trip', async (t) => {
  // The rule this is about is the one the whole schema is built on: anything a
  // newer version of the Forge wrote is preserved through a save. Branches are
  // the first structure that recurses, and an earlier version of this dropped
  // the contents of anything past the editor's own nesting limit — which reads
  // as a project quietly losing work the moment it is opened here.
  // A question at the bottom of the nest, because the other half of that rule is
  // the one the variables cost a bug to learn: a field nobody wrote a line for
  // in project-io is a field that is silently not there when the file comes
  // back. An option's label and its command list are two such fields.
  const deep = (levels) => {
    let command = {
      op: 'choice',
      options: [
        { text: 'Take it', commands: [{ op: 'setVar', variable: 0, value: 1 }] },
        { text: 'Leave it', commands: [] }
      ]
    };
    for (let level = 0; level < levels; level++) {
      command = { op: 'branch', cond: { type: 'none', arg: 0 }, then: [command], else: [] };
    }
    return command;
  };

  const project = createProject('Deep');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  const levels = MAX_BRANCH_DEPTH + 4;
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [deep(levels)] }] } }
    }
  ];

  // A real round trip, not a normalize: the disk is its own schema, and what is
  // being claimed is that the file comes back with everything it went in with.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-deep-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const normalized = normalizeProject(structuredClone(project));
  await saveProject(dir, normalized);
  const reopened = await loadProject(dir);
  assert.deepEqual(reopened.maps[0].screens[0].entities, normalized.maps[0].screens[0].entities);

  let command = reopened.maps[0].screens[0].entities[0].props.event.pages[0].commands[0];
  for (let level = 0; level < levels; level++) {
    assert.equal(command.op, 'branch', `level ${level} of the nesting was dropped`);
    command = command.then[0];
  }
  assert.deepEqual(
    command,
    {
      op: 'choice',
      options: [
        { text: 'Take it', commands: [{ op: 'setVar', variable: 0, value: 1 }] },
        { text: 'Leave it', commands: [] }
      ]
    },
    'the innermost command was lost, or came back missing a label or a list'
  );

  // The engine has no limit either — nesting is bytes inside bytes — so it
  // compiles, and every level is one OP_IF.
  const OP_IF = EVENT_COMMANDS.findIndex((entry) => entry.id === 'branch');
  const built = compileText(reopened);
  assert.deepEqual(built.problems, []);
  assert.equal(built.events[0].filter((byte) => byte === OP_IF).length, levels);
});

test('nesting past what any project could hold fails by name, not by stack', () => {
  // The guard exists so a corrupt or hostile file cannot recurse normalization
  // until the runtime gives out. What it must not do is truncate: an error the
  // app can show beats a project silently missing its deep end, and it beats a
  // RangeError from somewhere inside the schema.
  // Alternating the two commands that hold commands, because the guard is about
  // the depth of the recursion rather than about which command recursed.
  const deep = (levels) => {
    let command = { op: 'say', text: 'Bottom.' };
    for (let level = 0; level < levels; level++) {
      command =
        level % 2
          ? { op: 'branch', cond: { type: 'none', arg: 0 }, then: [command], else: [] }
          : { op: 'choice', options: [{ text: 'On', commands: [command] }] };
    }
    return command;
  };
  const withNesting = (levels) => ({
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [deep(levels)] }] } }
              }
            ]
          }
        ]
      }
    ]
  });

  assert.throws(() => normalizeProject(withNesting(200)), /nests event commands more than 64 deep/);
  // And the level below the guard is ordinary data, so the boundary is a limit
  // rather than a fence somewhere in the middle of what people might write.
  assert.doesNotThrow(() => normalizeProject(withNesting(60)));
});

// ------------------------------------------------------------------ triggers
//
// Everything above is about what an event says. A trigger is about when it runs,
// which until now was always "the player walked up and pressed the button" — so
// nothing could happen *to* the player. The two worth proving are that each
// trigger fires at its own moment, and that neither fires twice: a touch event
// ends with the player still standing on the actor, and an entry event ends with
// the screen still loaded, so both have somewhere obvious to loop forever.

const DOOR = 3; // Portal, the sample's door actor
const npcAt = (props, x = START_X, y = START_Y - 16) => ({ actorId: NPC, x, y, props });

test('a touch event runs on contact, and not again until the player steps off', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    npcAt({
      trigger: 'touch',
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'addVar', variable: 0, value: 1 }, { op: 'say', text: 'Careful!' }]
          }
        ]
      }
    })
  ]);

  // Standing 16 pixels away is outside TOUCH_RANGE, and no button has been
  // pressed: an event that ran here would be running on its own.
  for (let frame = 0; frame < 20; frame++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES], 0, 'the event ran without being touched');

  hold(nes, UP, 6);
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'walking into it did not run its event');
  assert.notEqual(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the event did not start a conversation');

  // The conversation ends with the player still standing exactly where they were
  // when it started, which is the shape that would restart it forever.
  assert.ok(talkThrough(nes), 'the conversation never ended');
  for (let frame = 0; frame < 90; frame++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'standing still on it ran the event again');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);

  // Stepping off re-arms it, and stepping back on fires it a second time.
  hold(nes, DOWN, 12);
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'walking away ran the event');
  hold(nes, UP, 12);
  assert.equal(nes.cpu.mem[VARIABLES], 2, 'walking back into it did not run the event again');
});

test('a trigger is a choice, so the interact button does not also run the event', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // What makes an event run is one answer, not a set. An entry event is a scene
  // meant to happen as the screen appears; if the button worked as well, walking
  // up to whatever carried it and pressing interact would play it again.
  const { nes } = await buildWith(t, [
    npcAt({
      trigger: 'enter',
      event: {
        pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }]
      }
    })
  ]);

  for (let frame = 0; frame < 40; frame++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the entry event did not run on its own');

  // Standing right beside it and pressing the button, several times.
  for (let press = 0; press < 3; press++) tap(nes, B, 20);
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the interact button ran an event that is not its to run');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'pressing interact started a conversation');
});

test('a touch event waits for the frame to finish before it takes over', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // A touch trigger arms rather than starting, because the entity loop is still
  // walking the other slots when it fires. A door on the same square is the case
  // that shows why: it would otherwise redraw the screen out from under the
  // conversation the touch had just started. The warp settles first, and the
  // event on the screen the player has left never runs.
  const { nes } = await buildWith(t, [
    npcAt({
      trigger: 'touch',
      event: {
        pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setVar', variable: 0, value: 1 }] }]
      }
    }),
    // The door sits on the same spot, so one step lands on both of them.
    { actorId: DOOR, x: START_X, y: START_Y - 16, props: { toScreen: 1, toX: START_X, toY: START_Y } }
  ]);

  hold(nes, UP, 10);
  for (let frame = 0; frame < 30; frame++) nes.frame();

  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the door did not take the player through');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'a conversation survived the screen it started on');
  assert.equal(nes.cpu.mem[VARIABLES], 0, 'the event ran on a screen the player had already left');
});

test('walking onto a screen gives it the frame, not the world it walked into', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Crossing a screen edge redraws from inside update_player, so the rest of
  // that frame would otherwise be the *new* screen's actors running before the
  // event it owes. The reading is the player's hearts: the actor waiting at the
  // landing spot deals contact damage, and an entry event that says something
  // freezes the world — so a heart lost here is a frame that should not have
  // happened at all.
  const BRAMBLE = 5; // the sample's stationary actor with contact damage
  const { nes } = await buildWith(
    t,
    [],
    (project) => {
      // The fixture's own level design is not what is under test, and a wall in
      // the way would make this about pathfinding.
      for (const screen of project.maps[0].screens) screen.metatiles = screen.metatiles.map(() => 0);
      project.maps[0].screens[1].entities = [
        npcAt(
          {
            trigger: 'enter',
            event: {
              pages: [
                {
                  cond: { type: 'none', arg: 0 },
                  commands: [{ op: 'setVar', variable: 0, value: 1 }, { op: 'say', text: 'Mind the brambles.' }]
                }
              ]
            }
          },
          128,
          64
        ),
        // cross_right lands the player at x = 0 with their y unchanged, which is
        // exactly here.
        { actorId: BRAMBLE, x: 8, y: START_Y, props: {} }
      ];
    }
  );

  const hearts = nes.cpu.mem[PLAYER_HP];
  assert.ok(hearts > 0, 'the fixture should start with hearts');

  for (let step = 0; step < 120 && nes.cpu.mem[FLAT_SCREEN] === 0; step++) hold(nes, RIGHT, 1);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the player never crossed onto the next screen');

  for (let frame = 0; frame < 8; frame++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the screen walked onto did not run its entry event');
  assert.equal(nes.cpu.mem[PLAYER_HP], hearts, 'the new screen got a frame of its own before its event did');
});

test('crossing an edge ends the frame inside update_player as well', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // A crossing does not unwind update_player: cross_* is reached with a jmp and
  // ends in redraw_screen, whose rts comes back here. So the *rest* of the same
  // routine — the spike underfoot, the step towards a wandering monster — would
  // still be spent on the screen that has just arrived. This one goes *down*
  // deliberately: a vertical crossing happens after the check that catches a
  // horizontal one, so the floor of the new screen is the only thing that can
  // answer for it.
  const DAMAGE_TILE = 40; // one of the sample's spare metatiles, made harmful
  const DOWN_SCREEN = 2; // the 2x2 grid's bottom-left, below the start screen
  const { nes } = await buildWith(
    t,
    [],
    (project) => {
      project.metatiles[DAMAGE_TILE].collision = 'damage';
      for (const [index, screen] of project.maps[0].screens.entries()) {
        screen.metatiles = screen.metatiles.map(() => 0);
        // The whole top row of the destination, so the landing cell is harmful
        // however the crossing rounds.
        if (index === DOWN_SCREEN) {
          for (let col = 0; col < 16; col++) screen.metatiles[col] = DAMAGE_TILE;
        }
      }
      project.maps[0].screens[DOWN_SCREEN].entities = [
        npcAt(
          {
            trigger: 'enter',
            event: {
              pages: [
                {
                  cond: { type: 'none', arg: 0 },
                  commands: [{ op: 'setVar', variable: 0, value: 1 }, { op: 'say', text: 'Watch your step.' }]
                }
              ]
            }
          },
          128,
          64
        )
      ];
    }
  );

  const hearts = nes.cpu.mem[PLAYER_HP];
  for (let step = 0; step < 120 && nes.cpu.mem[FLAT_SCREEN] === 0; step++) hold(nes, DOWN, 1);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], DOWN_SCREEN, 'the player never crossed onto the screen below');

  for (let frame = 0; frame < 8; frame++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the screen walked onto did not run its entry event');
  assert.equal(nes.cpu.mem[PLAYER_HP], hearts, 'the floor of the new screen was charged for before its event ran');
});

test('what the frame already owes happens before the buttons do', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // A touch event arms on one frame and runs on the next, and the buttons are
  // read into actions in between. They must be read *after*: an interact reaches
  // start_dialog and an event is free to warp, so a button on this frame could
  // otherwise send the player somewhere else and take the owed event with it.
  // Attacking the actor whose event is owed is the same claim at its smallest —
  // the swing lands after the event, which by then has frozen the world.
  const { nes } = await buildWith(
    t,
    [
      npcAt({
        trigger: 'touch',
        event: {
          pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setVar', variable: 0, value: 1 }] }]
        }
      })
    ],
    (project) => {
      project.sprites.actors[NPC].hp = 1; // one swing beats it, so the race is a race
    }
  );

  // Walk into it, watching the engine's own answer to "does this frame owe an
  // event": pressing the button a frame earlier or later would be testing
  // whichever of the two happened to win.
  nes.buttonDown(1, UP);
  let armed = false;
  for (let frame = 0; frame < 60 && !armed; frame++) {
    nes.frame();
    armed = nes.cpu.mem[PENDING_ENT] !== NO_ENTITY;
  }
  nes.buttonUp(1, UP);
  assert.ok(armed, 'walking into it never armed an event');
  assert.equal(nes.cpu.mem[VARIABLES], 0, 'the event ran before it was owed');

  // The next frame is the one that runs it, and the attack is pressed on exactly
  // that frame.
  nes.buttonDown(1, A);
  nes.frame();
  nes.buttonUp(1, A);
  for (let frame = 0; frame < 30; frame++) nes.frame();

  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the event the frame owed did not run');
  assert.equal(nes.cpu.mem[ENT_ACTIVE], 1, 'the attack landed before the event it owed');
});

test('the screen Start draws gets its own opening before the world touches it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Start on the title screen draws the first screen of the game from inside
  // dispatch_input, which is the one place a whole screen arrives without a
  // warp and without a crossing. The frame it arrives on is not the world's:
  // the reading is the player's hearts against something standing where the
  // game begins.
  const BRAMBLE = 5; // the sample's stationary actor with contact damage
  const { nes } = await buildWith(
    t,
    [
      npcAt(
        {
          trigger: 'enter',
          event: {
            pages: [
              {
                cond: { type: 'none', arg: 0 },
                commands: [{ op: 'setVar', variable: 0, value: 1 }, { op: 'say', text: 'It begins.' }]
              }
            ]
          }
        },
        64,
        64
      ),
      { actorId: BRAMBLE, x: START_X, y: START_Y + 8, props: {} }
    ],
    (project) => {
      for (const screen of project.maps[0].screens) screen.metatiles = screen.metatiles.map(() => 0);
    }
  );

  // buildWith's boot presses Start on the title, so the game has already begun.
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the first screen of the game never spoke');
  assert.equal(nes.cpu.mem[PLAYER_HP], 3, 'the world got a frame on the screen Start drew');
});

test('a second button pressed with confirm does not act on the screen it drew', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // dispatch_input looks up game_state again for every button, so two pressed
  // together are read in two different states once the first one changes it:
  // confirm begins the game, and interact — on the same frame — then talks to
  // whatever the first screen spawned, on a screen the player has not seen a
  // frame of. If that conversation warps, the opening is discarded with it.
  const AWAY = 3;
  const { romPath } = await buildWith(
    t,
    [
      npcAt(
        {
          trigger: 'enter',
          event: {
            pages: [
              {
                cond: { type: 'none', arg: 0 },
                commands: [{ op: 'setVar', variable: 0, value: 1 }, { op: 'say', text: 'You came.' }]
              }
            ]
          }
        },
        64,
        64
      ),
      // Standing where the game begins, and happy to be talked to.
      {
        actorId: NPC,
        x: START_X,
        y: START_Y + 8,
        props: {
          trigger: 'interact',
          event: {
            pages: [
              { cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: AWAY, x: START_X, y: START_Y }] }
            ]
          }
        }
      }
    ],
    (project) => {
      for (const screen of project.maps[0].screens) screen.metatiles = screen.metatiles.map(() => 0);
    }
  );

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let frame = 0; frame < 30; frame++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], 3, 'the fixture should boot into its title screen');

  // Confirm and interact on the very same frame. A is the button the dispatcher
  // reads first, so it is the one that can change the state under the rest —
  // Start is read last and could never do this.
  nes.buttonDown(1, A);
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, A);
  nes.buttonUp(1, B);
  for (let frame = 0; frame < 40; frame++) nes.frame();

  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the first screen of the game never spoke');
  assert.notEqual(nes.cpu.mem[FLAT_SCREEN], AWAY, 'the second button talked its way off the screen');
});

test('a button on the arrival frame cannot warp a screen out of its own opening', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // The reason the settle has to come before dispatch_input rather than merely
  // before the world: an interact reaches start_dialog, and that event is free
  // to warp. The redraw clears what is pending — so pressing the button on the
  // frame a screen arrives could mean its opening is simply never spoken.
  const AWAY = 3; // somewhere neither screen involved would otherwise reach
  const { nes } = await buildWith(
    t,
    [],
    (project) => {
      for (const screen of project.maps[0].screens) screen.metatiles = screen.metatiles.map(() => 0);
      project.maps[0].screens[1].entities = [
        npcAt(
          {
            trigger: 'enter',
            event: {
              pages: [
                {
                  cond: { type: 'none', arg: 0 },
                  commands: [{ op: 'setVar', variable: 0, value: 1 }, { op: 'say', text: 'At last.' }]
                }
              ]
            }
          },
          128,
          64
        ),
        // Standing where the crossing lands, and happy to be talked to.
        {
          actorId: NPC,
          x: 16,
          y: START_Y,
          props: {
            trigger: 'interact',
            event: {
              pages: [
                {
                  cond: { type: 'none', arg: 0 },
                  commands: [{ op: 'warp', screen: AWAY, x: START_X, y: START_Y }]
                }
              ]
            }
          }
        }
      ];
    }
  );

  for (let step = 0; step < 120 && nes.cpu.mem[FLAT_SCREEN] === 0; step++) hold(nes, RIGHT, 1);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the player never crossed onto the next screen');

  // The very next frame is the one the screen's opening is owed on.
  tap(nes, B);
  for (let frame = 0; frame < 30; frame++) nes.frame();

  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the screen never got to say its piece');
  assert.notEqual(nes.cpu.mem[FLAT_SCREEN], AWAY, 'a button on the arrival frame warped the opening away');
});

test('an entry event runs as the screen loads, before the player can move', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Screen 0 greets and sends the player on; screen 1 greets them when they
  // land. Together that is the whole of the rule: an entry event fires without
  // being asked, it fires once, and one that warps hands the moment on to
  // whatever the next screen owes rather than swallowing it.
  const { nes } = await buildWith(
    t,
    [
      npcAt({
        trigger: 'enter',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'addVar', variable: 0, value: 1 },
                { op: 'say', text: 'You should not be here.' },
                { op: 'warp', screen: 1, x: START_X, y: START_Y }
              ]
            }
          ]
        }
      })
    ],
    (project) => {
      project.maps[0].screens[1].entities = [
        npcAt({
          trigger: 'enter',
          event: {
            pages: [
              { cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 1, value: 1 }] }
            ]
          }
        })
      ];
    }
  );

  // Nothing has been pressed but Start on the title, and the first screen has
  // already spoken.
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the entry event did not run on its own');
  assert.notEqual(nes.cpu.mem[BOX_STATE], 0, 'it did not get as far as opening the box');

  assert.ok(talkThrough(nes), 'the conversation never ended');
  for (let frame = 0; frame < 30; frame++) nes.frame();

  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the warp at the end of the event did not happen');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 1, 'the screen warped into never ran its own entry event');
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the first screen ran its entry event twice');

  // ...and standing on the new screen does not run it over and over.
  for (let frame = 0; frame < 120; frame++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES + 1], 1, 'the entry event ran again while the screen sat there');
});

test('one actor owns the moment a screen loads, and the Map Forge says which', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const entering = (variable) => ({
    trigger: 'enter',
    event: {
      pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable, value: 1 }] }]
    }
  });
  const { nes } = await buildWith(t, [
    npcAt(entering(0), START_X, START_Y - 16),
    npcAt(entering(1), START_X + 32, START_Y - 16)
  ]);

  for (let frame = 0; frame < 60; frame++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the first entry event did not run');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 0, 'the second one ran as well, on top of the first');
});

test('a pickup keeps its own meaning for being walked into', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Walking into a pickup collects it, so touch is a moment already spoken for.
  // `availableTriggers` is what says so, and the compiler applies it as well as
  // the editor — this is that rule seen from the ROM, where the event must not
  // run and the gem must still land in the bag.
  const { nes } = await buildWith(t, [
    {
      actorId: GEM,
      x: START_X,
      y: START_Y - 16,
      props: {
        trigger: 'touch',
        event: {
          pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setVar', variable: 0, value: 1 }] }]
        }
      }
    }
  ]);

  hold(nes, UP, 8);
  assert.equal(nes.cpu.mem[INV_COUNT], 1, 'the pickup was not collected');
  assert.equal(nes.cpu.mem[VARIABLES], 0, 'the event ran instead of the pickup being collected');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'collecting a pickup started a conversation');
});

test('touch is offered only where nothing else already owns being walked into', () => {
  const action = createProject('Action');
  const rpg = createProject('Quest');
  rpg.project.gameType = 'rpg';
  const triggersFor = (actor, project = action) => availableTriggers(actor, project).map((entry) => entry.id);

  assert.deepEqual(triggersFor({ behavior: 'npc' }), ['interact', 'touch', 'enter']);
  assert.deepEqual(
    triggersFor({ behavior: 'pickup' }),
    ['interact', 'enter'],
    'a pickup is collected by being walked into'
  );
  assert.deepEqual(triggersFor({ behavior: 'door' }), ['interact', 'enter'], 'a door is walked through');

  // The same actor, and the answer depends on the project: contact damage costs
  // a heart in an action game and the event still runs, but in an RPG it starts
  // a battle, which freezes the world before the event could have its turn.
  const monster = { behavior: 'chaser', damage: 2 };
  assert.ok(triggersFor(monster).includes('touch'), 'contact damage does not stop an event in an action game');
  assert.equal(triggersFor(monster, rpg).includes('touch'), false, 'in an RPG that contact is a battle');
  assert.ok(triggersFor({ behavior: 'chaser', damage: 0 }, rpg).includes('touch'), 'a harmless RPG actor is fine');

  // Every behaviour keeps the two that are not about walking into something.
  for (const entry of BEHAVIORS) {
    for (const project of [action, rpg]) {
      const offered = triggersFor({ behavior: entry.id, damage: 4 }, project);
      assert.ok(offered.includes('interact'), `${entry.id} lost the interact trigger`);
      assert.ok(offered.includes('enter'), `${entry.id} lost the entry trigger`);
    }
  }

  // A trigger this version does not have becomes the one every event had before
  // there were triggers, rather than being dropped along with the event.
  const normalized = normalizeProject({
    maps: [
      {
        screens: [
          {
            entities: [
              { actorId: 0, props: { trigger: 'someLaterIdea', dialogue: 'Kept.' } },
              { actorId: 0, props: { dialogue: 'Also kept.' } },
              { actorId: 0, props: { trigger: 'enter', dialogue: 'Entering.' } }
            ]
          }
        ]
      }
    ]
  });
  const placed = normalized.maps[0].screens[0].entities;
  assert.equal(placed[0].props.trigger, 'interact');
  assert.equal(placed[0].props.dialogue, 'Kept.', 'the rest of the placement went with it');
  assert.equal(placed[1].props.trigger, 'interact', 'a placement that predates triggers gets the old meaning');
  assert.equal(placed[2].props.trigger, 'enter');
});

// ----------------------------------------------------------------- questions
//
// A branch asks the game which way to go; a question asks the player. The engine
// remembers nothing but which row the cursor is on, so what is worth proving is
// that every option is reachable, that the page carries on afterwards whichever
// one was picked, that a Say inside an option suspends and resumes, and that a
// question nests with the branch it is a cousin of.

test('every option of a question is reachable, and the page carries on after it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const ask = {
    op: 'choice',
    options: [
      { text: 'Yes', commands: [{ op: 'setVar', variable: 1, value: 1 }] },
      { text: 'No', commands: [{ op: 'setVar', variable: 2, value: 1 }] },
      { text: 'Ask again later', commands: [{ op: 'setVar', variable: 3, value: 1 }] }
    ]
  };
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          { op: 'say', text: 'Will you help?' },
          ask,
          // Whichever option ran, this runs after it: the jump each option ends
          // with has to land past the ones below it and nowhere else.
          { op: 'addVar', variable: 0, value: 1 }
        ]
      }
    ])
  ]);

  // The cursor starts on the first option, so no presses of Down at all.
  assert.ok(talkThrough(nes, 30, [0]), 'the first conversation never ended');
  assert.deepEqual(
    [1, 2, 3].map((n) => nes.cpu.mem[VARIABLES + n]),
    [1, 0, 0],
    'the first option should have run, and only it'
  );
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the command after the question did not run');

  assert.ok(talkThrough(nes, 30, [1]), 'the second conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 2], 1, 'one press of Down should have picked the second option');
  assert.equal(nes.cpu.mem[VARIABLES], 2, 'the command after the question did not run again');

  // ...and the last option, which is the one whose jump has nothing left to
  // step over — the case a length that counted itself would get wrong.
  assert.ok(talkThrough(nes, 30, [2]), 'the third conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 3], 1, 'two presses of Down should have picked the third option');
  assert.equal(nes.cpu.mem[VARIABLES], 3, 'the command after the question did not run a third time');
});

test('the cursor wraps at both ends of a question', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          {
            op: 'choice',
            options: [
              { text: 'First', commands: [] },
              { text: 'Second', commands: [] },
              { text: 'Third', commands: [] }
            ]
          }
        ]
      }
    ])
  ]);

  tap(nes, B);
  assert.ok(reachQuestion(nes), 'the question never came up');
  assert.equal(nes.cpu.mem[CHOICE_SEL], 0, 'the cursor starts on the first option');

  // Off the top of a three-option list is the third option, not option 255 —
  // which would walk the answer straight past the end of the command.
  tap(nes, 4); // Up
  assert.equal(nes.cpu.mem[CHOICE_SEL], 2, 'Up from the first option should reach the last');
  tap(nes, DOWN);
  assert.equal(nes.cpu.mem[CHOICE_SEL], 0, 'Down from the last option should reach the first');
  tap(nes, DOWN);
  tap(nes, DOWN);
  assert.equal(nes.cpu.mem[CHOICE_SEL], 2);

  // And the whole thing still ends: an option with nothing in it runs nothing
  // and falls out of the question like any other.
  tap(nes, A);
  for (let frame = 0; frame < 400 && nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY; frame++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'an empty option did not end the conversation');
});

test('the box draws one answer per row, with the cursor beside the one picked', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Everything else here asserts on engine RAM, which cannot see a label drawn
  // one row too low or a cursor written into the text instead of beside it —
  // and those are exactly the mistakes this makes easy. So this one reads the
  // nametable the ROM actually wrote.
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          {
            op: 'choice',
            options: [
              { text: 'Buy the lantern', commands: [] },
              { text: 'Sell the rope', commands: [] },
              { text: 'Nothing today', commands: [] }
            ]
          }
        ]
      }
    ])
  ]);

  tap(nes, B);
  assert.ok(reachQuestion(nes), 'the question never came up');
  // The last thing queued drains on the next vblank, so what is on screen is
  // always a frame or two behind the state that asked for it.
  for (let frame = 0; frame < 4; frame++) nes.frame();

  // The box is tile rows 24-29; its four rows of text start at row 25, column 2,
  // and the cursor sits in column 1 — inside the frame, outside the text.
  const cell = (row, col) => nes.ppu.vramMem[0x2000 + row * 32 + col];
  const text = (row) => {
    let out = '';
    for (let col = 2; col < 30; col++) {
      const tile = cell(row, col);
      out += tile >= FONT_BASE ? String.fromCharCode(32 + (tile - FONT_BASE)) : ' ';
    }
    return out.trimEnd();
  };
  const cursorRow = () => [0, 1, 2, 3].findIndex((n) => cell(TEXT_ROW + n, 1) === ARROW_TILE);

  assert.equal(text(TEXT_ROW), 'Buy the lantern');
  assert.equal(text(TEXT_ROW + 1), 'Sell the rope');
  assert.equal(text(TEXT_ROW + 2), 'Nothing today');
  assert.equal(text(TEXT_ROW + 3), '', 'the fourth row belongs to a fourth answer, and there is none');
  assert.equal(cursorRow(), 0, 'the cursor starts beside the first answer');

  tap(nes, DOWN);
  for (let frame = 0; frame < 4; frame++) nes.frame(); // the queue drains next vblank
  assert.equal(cursorRow(), 1, 'the cursor did not move with the D-pad');
  assert.equal(text(TEXT_ROW), 'Buy the lantern', 'moving the cursor disturbed a label');

  // Answering takes the cursor down with it: it is outside the width the next
  // message would wipe, so nothing else would ever rub it out.
  tap(nes, A);
  for (let frame = 0; frame < 8; frame++) nes.frame();
  assert.equal(cursorRow(), -1, 'the cursor was left on screen after the answer');
});

test('an answer with no label yet leaves its row blank and the screen intact', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Adding an answer and not having typed its label yet is an ordinary thing to
  // be holding, and it compiles to a string of nothing but the end marker. The
  // row it draws is empty — but opening a VRAM packet and closing it without
  // pushing a byte leaves a count of zero, which the drain reads as 256 and
  // writes a page of stale queue into the nametable. Nothing in engine RAM can
  // see that happen, so this reads the screen.
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          {
            op: 'choice',
            options: [
              { text: '', commands: [] },
              { text: 'Named', commands: [{ op: 'setVar', variable: 1, value: 1 }] }
            ]
          }
        ]
      }
    ])
  ]);

  tap(nes, B);
  assert.ok(reachQuestion(nes), 'the question never came up');
  for (let frame = 0; frame < 6; frame++) nes.frame();

  const cell = (row, col) => nes.ppu.vramMem[0x2000 + row * 32 + col];
  const rowText = (row) => {
    let out = '';
    for (let col = 2; col < 30; col++) {
      const tile = cell(row, col);
      out += tile >= FONT_BASE ? String.fromCharCode(32 + (tile - FONT_BASE)) : ' ';
    }
    return out.trim();
  };

  assert.equal(rowText(TEXT_ROW), '', 'the unlabelled answer drew something');
  assert.equal(rowText(TEXT_ROW + 1), 'Named', 'the answer below it was not drawn');
  // 256 bytes of stale queue starting at the blank row would run straight
  // through the rows under it and out of the box entirely, so the frame is what
  // says whether anything overran: it is the same on both sides of the box.
  for (const row of [24, 29]) {
    assert.equal(cell(row, 1), cell(row, 30), `the box frame on row ${row} was overwritten`);
  }
  assert.equal(cell(TEXT_ROW, 0), cell(TEXT_ROW + 1, 0), 'the left edge of the box was overwritten');

  // ...and it is still answerable: the cursor starts on it and Down reaches the
  // one below, which is the only way to prove the blank row is a row at all.
  assert.equal(nes.cpu.mem[CHOICE_SEL], 0);
  tap(nes, DOWN);
  assert.ok(talkThrough(nes, 20), 'the conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 1, 'the labelled answer below the blank one did not run');
});

test('a message inside an option suspends and resumes, and questions nest', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Say is the command that hands the box several frames of control, and a
  // question is answered through a path of its own rather than script_resume —
  // so an option that says two things and then asks something else is the
  // smallest thing that would break if either lost its place.
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          {
            op: 'choice',
            options: [
              {
                text: 'Take the left road',
                commands: [
                  { op: 'say', text: 'The road bends north.' },
                  { op: 'setVar', variable: 1, value: 1 },
                  { op: 'say', text: 'A gate blocks the way.' },
                  {
                    op: 'choice',
                    options: [
                      { text: 'Open it', commands: [{ op: 'setVar', variable: 2, value: 1 }] },
                      { text: 'Turn back', commands: [{ op: 'setVar', variable: 3, value: 1 }] }
                    ]
                  },
                  { op: 'addVar', variable: 1, value: 1 }
                ]
              },
              { text: 'Take the right road', commands: [{ op: 'setVar', variable: 4, value: 1 }] }
            ]
          },
          { op: 'setVar', variable: 5, value: 1 }
        ]
      }
    ])
  ]);

  // The first option, then the second option of the question inside it.
  assert.ok(talkThrough(nes, 40, [0, 1]), 'the conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 2, 'both sides of the suspended messages did not run');
  assert.equal(nes.cpu.mem[VARIABLES + 2], 0, 'the inner first option ran');
  assert.equal(nes.cpu.mem[VARIABLES + 3], 1, 'the inner second option should have run');
  assert.equal(nes.cpu.mem[VARIABLES + 4], 0, 'the outer second option ran');
  assert.equal(nes.cpu.mem[VARIABLES + 5], 1, 'the page did not carry on past the outer question');
});

test('a question inside a branch, and a branch inside a question', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // The two commands that hold commands, each inside the other. Neither knows
  // anything about the other — nesting is bytes inside bytes — which is exactly
  // the claim worth a test, because it is the claim that costs nothing to break.
  const { nes } = await buildWith(t, [
    chest([
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          { op: 'setVar', variable: 0, value: 7 },
          {
            op: 'branch',
            cond: { type: 'varAtLeast', arg: 0, value: 5 },
            then: [
              {
                op: 'choice',
                options: [
                  { text: 'Pay', commands: [{ op: 'subVar', variable: 0, value: 5 }] },
                  {
                    text: 'Haggle',
                    commands: [
                      {
                        op: 'branch',
                        cond: { type: 'varUnder', arg: 0, value: 10 },
                        then: [{ op: 'setVar', variable: 1, value: 1 }],
                        else: [{ op: 'setVar', variable: 2, value: 1 }]
                      }
                    ]
                  }
                ]
              }
            ],
            else: [{ op: 'setVar', variable: 3, value: 1 }]
          },
          { op: 'setVar', variable: 4, value: 1 }
        ]
      }
    ])
  ]);

  assert.ok(talkThrough(nes, 30, [1]), 'the conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES], 7, 'the first option ran instead of the second');
  assert.equal(nes.cpu.mem[VARIABLES + 1], 1, 'the branch inside the second option did not run');
  assert.equal(nes.cpu.mem[VARIABLES + 2], 0, 'the wrong side of the inner branch ran');
  assert.equal(nes.cpu.mem[VARIABLES + 3], 0, 'the outer else-branch ran');
  assert.equal(nes.cpu.mem[VARIABLES + 4], 1, 'the page did not carry on past the branch');
});

test('a question compiles to its options up front and its bodies behind them', () => {
  const project = createProject('Asking');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  const page = (commands) => {
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
    return normalizeProject(structuredClone(project));
  };
  const OP_CHOICE = EVENT_COMMANDS.findIndex((entry) => entry.id === 'choice');

  const built = compileText(
    page([
      {
        op: 'choice',
        options: [
          { text: 'Yes', commands: [{ op: 'setVar', variable: 1, value: 1 }] },
          { text: 'No', commands: [] }
        ]
      }
    ])
  );
  assert.deepEqual(built.problems, []);
  const body = built.events[0].slice(4); // past the page header

  assert.equal(body[0], OP_CHOICE);
  assert.equal(body[1], 2, 'two options');
  // The string ids are contiguous and up front, which is what lets the box draw
  // row n from the n'th byte after the count without walking any bodies.
  assert.equal(body[2], 0, 'the first option interned first');
  assert.equal(body[3], 1, 'and the second after it');
  assert.equal(body[4], 5, 'the first record is a three-byte command and its jump');
  assert.equal(body[8], OP_JUMP, 'every option ends with the jump a then-branch ends with');
  assert.equal(body[9], 3, 'past the second record: its length byte, an empty body and its jump');
  assert.equal(body[10], 2, 'the second record is nothing but its jump');
  assert.equal(body[11], OP_JUMP);
  assert.equal(body[12], 0, 'the last option has nothing left to step over');
  assert.equal(body[13], OP_END, 'and the page ends after the question');

  // The labels reach the string table as themselves, wrapped by nothing: a
  // label is one row of the box, and a control byte in the middle of one would
  // be drawn as a tile.
  const [yes, no] = built.strings;
  assert.deepEqual(yes, [...'Yes'].map((char) => char.charCodeAt(0) - 32 + 0xa0).concat(0));
  assert.equal(no.length, 'No'.length + 1, 'two glyphs and the end of the string');

  // Lengths are single bytes here as everywhere, and a question is the second
  // structure that makes 255 reachable. Both the record and the distance the
  // first option has to jump are measured, and both name what to shorten.
  const filler = (count) => Array.from({ length: count }, () => ({ op: 'setVar', variable: 0, value: 1 }));
  const long = compileText(
    page([{ op: 'choice', options: [{ text: 'Long', commands: filler(85) }, { text: 'Short', commands: [] }] }])
  );
  assert.match(long.problems[0].message, /→ “Long” compiles to 257 bytes/);
  assert.equal(long.problems[0].where, 'Map Forge');

  const far = compileText(
    page([{ op: 'choice', options: [{ text: 'First', commands: [] }, { text: 'Second', commands: filler(85) }] }])
  );
  assert.match(far.problems[0].message, /→ “Second” compiles to 257 bytes/);
  assert.match(far.problems[1].message, /→ the options after the first compiles to 258 bytes/);

  // An unnamed option is still named in the problem, because the author has to
  // be able to find the one being complained about.
  const unnamed = compileText(page([{ op: 'choice', options: [{ text: '', commands: filler(85) }] }]));
  assert.match(unnamed.problems[0].message, /→ “option 1” compiles to 257 bytes/);
});

test('a question is clamped to what the box can show, and an empty one is not a command', () => {
  const optionsOf = (count) =>
    Array.from({ length: count }, (_, n) => ({ text: `Option ${n}`, commands: [] }));
  const withChoice = (options) =>
    normalizeProject({
      maps: [
        {
          screens: [
            {
              entities: [
                {
                  actorId: 0,
                  props: {
                    event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'choice', options }] }] }
                  }
                }
              ]
            }
          ]
        }
      ]
    });

  const commandsOf = (project) => project.maps[0].screens[0].entities[0].props.event.pages[0].commands;

  // Four rows of text, four options. A fifth is dropped rather than kept for a
  // later version to honour: there is no row for it, so it is not data — it is
  // an option the player could neither see nor reach.
  assert.equal(commandsOf(withChoice(optionsOf(6)))[0].options.length, CHOICE_LIMITS.options);
  // A question with nothing to choose between is not a question at all.
  assert.deepEqual(commandsOf(withChoice([])), []);

  // A label is one row wide and cannot wrap, so it is squeezed onto one.
  const long = 'x'.repeat(CHOICE_LIMITS.label + 10);
  const squeezed = commandsOf(withChoice([{ text: `  two   ${'y'.repeat(40)}\nlines  `, commands: [] }, { text: long }]))[0];
  assert.equal(squeezed.options[0].text.includes('\n'), false, 'a label may not carry a line break');
  assert.ok(squeezed.options[0].text.startsWith('two y'), 'runs of whitespace collapse');
  assert.equal(squeezed.options[1].text.length, CHOICE_LIMITS.label);
  assert.deepEqual(squeezed.options[1].commands, [], 'an option with no command list gets an empty one');
});

test('a trigger the actor has stopped having room for is kept, and read as one thing', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // An actor is edited in a different Forge to the one that places it, so a
  // placement set to touch can find itself on an actor that has since been given
  // contact damage in an RPG. What must not happen is the editor showing one
  // answer, the hint describing another and the ROM running a third.
  const project = createProject('Quest');
  project.project.gameType = 'rpg';
  project.sprites.actors = [{ name: 'Wisp', behavior: 'chaser', damage: 0 }];
  const placement = { actorId: 0, x: 0, y: 0, props: { trigger: 'touch', dialogue: 'Boo.' } };
  const actor = project.sprites.actors[0];

  assert.equal(effectiveTrigger(placement, actor, project), 'touch', 'a harmless actor can be walked into');

  // The Sprite Forge gives it teeth, and walking into it now means a battle.
  actor.damage = 3;
  assert.equal(effectiveTrigger(placement, actor, project), 'interact', 'the trigger it can no longer have');
  assert.equal(placement.props.trigger, 'touch', 'the authored choice was overwritten rather than kept');
  // ...and it comes back, which is the whole reason it is kept rather than
  // reconciled: a change to an actor must not destroy work on a placement.
  actor.damage = 0;
  assert.equal(effectiveTrigger(placement, actor, project), 'touch', 'putting the damage back did not restore it');

  // The ROM agrees with the editor, which is the half of this that a unit test
  // of the schema cannot see: build it and read the byte back out of the record.
  const { project: built, romPath } = await buildWith(t, [
    { actorId: NPC, x: START_X, y: START_Y - 16, props: { trigger: 'touch', dialogue: 'Careful.' } }
  ], (tweaked) => {
    tweaked.sprites.actors[NPC].damage = 2; // an action game: touch still stands
  });
  assert.ok(fs.existsSync(romPath));
  assert.equal(
    effectiveTrigger(built.maps[0].screens[0].entities[0], built.sprites.actors[NPC], built),
    'touch',
    'contact damage in an action game costs a heart and the event still runs'
  );
});

test('a question is live even when its options do nothing', () => {
  // A branch with nothing live inside it is invisible, so it is not a live
  // command. A question with two empty options is not: it stops the
  // conversation and waits to be answered, which the player can see happening.
  const event = {
    pages: [
      {
        cond: { type: 'none', arg: 0 },
        commands: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }]
      }
    ]
  };
  assert.equal(enabledCommands(event.pages[0]).length, 1);
  assert.equal(compiledPages(event).length, 1);

  // ...and switching it off takes its options with it, like any other command.
  const off = { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ ...event.pages[0].commands[0], off: true }] }] };
  assert.deepEqual(enabledCommands(off.pages[0]), []);
  assert.deepEqual(compiledPages(off), []);
});

test('a long page that is declined is stepped over exactly', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // A page body's length is one byte, and stepping over a declined page means
  // adding the header to it. At 252 and up that sum carries out of the
  // accumulator — which script_skip cannot see, because it clears the carry
  // before adding to the pointer — and the engine lands four bytes inside the
  // page it meant to skip, running whatever it finds there as an opcode.
  //
  // 83 three-byte commands, one two-byte command and the OP_END is 252, which
  // is the length that makes the sum wrap to exactly zero: the engine then steps
  // over nothing at all and reads the same page header again, forever. The other
  // lengths in range wander instead, and wandering can land back on its feet —
  // this one cannot, which is what makes it the case worth writing down.
  const filler = [
    ...Array.from({ length: 83 }, () => ({ op: 'setVar', variable: 5, value: 1 })),
    { op: 'give', actor: GEM }
  ];
  const { nes } = await buildWith(t, [
    chest([
      { cond: { type: 'switchOn', arg: 7 }, commands: filler },
      {
        cond: { type: 'none', arg: 0 },
        commands: [{ op: 'say', text: 'Past it.' }, { op: 'setVar', variable: 0, value: 1 }]
      }
    ])
  ]);

  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the page after the long declined one did not run');
  assert.equal(nes.cpu.mem[VARIABLES + 5], 0, 'the declined page ran anyway');
});

test('a branch with nothing live inside it is not a live command', () => {
  // The rule that makes an empty page dangerous makes an empty branch dangerous
  // in exactly the same way: it matches, does nothing, and swallows every page
  // below it — and the plain dialogue underneath.
  const project = createProject('Hollow');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  const event = {
    pages: [
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          {
            op: 'branch',
            cond: { type: 'switchOn', arg: 1 },
            then: [{ op: 'say', text: 'Off.', off: true }],
            else: []
          }
        ]
      }
    ]
  };
  project.maps[0].screens[0].entities = [
    { actorId: 0, x: 0, y: 0, props: { dialogue: 'Fallback line.', event } }
  ];

  assert.deepEqual(enabledCommands(event.pages[0]), [], 'a branch with nothing live in it is not live');
  assert.deepEqual(compiledPages(event), [], 'so the page it is alone on does not reach the ROM');

  // ...and the dialogue underneath comes back, exactly as it does when the last
  // live command on a page is switched off.
  const built = compileText(normalizeProject(structuredClone(project)));
  assert.equal(built.events.length, 1);
  assert.equal(built.events[0][3], 3, 'one unconditional say — the fallback dialogue');

  // A branch with one live command on either side is still live, so the fix
  // cannot have swallowed the ordinary case.
  const live = { ...event.pages[0].commands[0], else: [{ op: 'say', text: 'On.' }] };
  assert.equal(enabledCommands({ commands: [live] }).length, 1);
});

// -------------------------------------------------------------- common events
//
// Everything above is one body run by the one placement that owns it. A common
// event is the first thing in this list the script runner has to *remember*
// something for: which command to come back to once the callee runs out of
// pages. The showcase is the same chest as the very first test, except the
// "a gem!" half is authored once, off to the side, and reached by name.

const HUNTER = 2; // Hunter, the sample's chaser -- a second distinct give target

test('common events compile into the same table a placement’s own event does', () => {
  const project = createProject('Common');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }, { name: 'Gem' }];
  project.commonEvents = [
    {
      name: 'Reward',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: GEM }] }] }
    }
  ];
  const caller = () => ({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 0 }] }] } }
  });
  // Two placements naming the same common event by index, to prove authoring
  // it once and calling it from more than one place is exactly what it looks
  // like: both compile to a call into the one table slot "Reward" occupies.
  project.maps[0].screens[0].entities = [caller(), caller()];
  const built = compileText(normalizeProject(structuredClone(project)));
  assert.deepEqual(built.problems, []);

  // Common events are pushed first, so "Reward" lands at table slot 0 and the
  // two placements' own events -- pushed after -- land at slots 1 and 2.
  assert.equal(built.events.length, 3);
  assert.deepEqual(built.events[0], [0, 0, 0, 3, /* give */ 2, GEM, OP_END, EVT_PAGES_END]);
  for (const event of built.events.slice(1)) {
    assert.deepEqual(event.slice(4), [OP_CALL, 0, OP_END, EVT_PAGES_END], 'call, then slot 0, then end');
  }

  // A call naming a common event that has no live slot -- deleted, or never
  // live to begin with -- still gets its own bytes, carrying NO_COMMON_EVENT_SLOT
  // as its operand rather than pointing at whatever the table happens to hold
  // in its place, and rather than dropping out of the body the way a question
  // with no options does. script_op_call (engine/script.asm) is what reads
  // and refuses that sentinel at runtime; the compiler's job is only to leave
  // it something to refuse.
  const dangling = createProject('Dangling');
  dangling.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  dangling.commonEvents = [{ name: 'Empty', event: null }];
  dangling.maps[0].screens[0].entities = [caller()];
  const droppedBuilt = compileText(normalizeProject(structuredClone(dangling)));
  assert.equal(droppedBuilt.events.length, 1, 'the empty common event took no table slot');
  assert.deepEqual(
    droppedBuilt.events[0].slice(4),
    [OP_CALL, NO_COMMON_EVENT_SLOT, OP_END, EVT_PAGES_END],
    'the call should carry NO_COMMON_EVENT_SLOT rather than being dropped'
  );
});

test('deleting a common event does not retarget the calls that survive it', () => {
  // A, B and C, authored in that order, get ids 0, 1 and 2. A placement calls
  // B by that id. Deleting A -- exactly what the Common events editor's ✕
  // does, a plain splice with no renumbering -- leaves the list as [B, C]
  // with B and C's ids untouched. If the compiler ever went back to
  // resolving a call by its row in the list instead of by id, this call
  // would silently start running C, the thing that took B's old row, instead
  // of the B it actually names.
  const project = createProject('Deleted');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.commonEvents = [
    { id: 0, name: 'A', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'A' }] }] } },
    { id: 1, name: 'B', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'B' }] }] } },
    { id: 2, name: 'C', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'C' }] }] } }
  ];
  project.maps[0].screens[0].entities = [
    { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 1 }] }] } } }
  ];

  // A deleted out from under B and C, the way the list editor's ✕ leaves it:
  // a plain splice, with B and C's own ids untouched.
  project.commonEvents = project.commonEvents.filter((entry) => entry.id !== 0);
  const built = compileText(normalizeProject(structuredClone(project)));

  // B and C still compile, in whichever order the list holds them, and the
  // caller's OP_CALL slot still has to resolve to whichever one carries B's
  // id -- not to whatever now happens to sit where B used to sit.
  assert.equal(built.events.length, 3, 'two common events plus the caller');
  const callerBody = built.events[2].slice(4);
  assert.equal(callerBody[0], OP_CALL);
  const targetBody = built.events[callerBody[1]];
  // Decode the target event's Say text back through the string table, rather
  // than asserting on a slot number that is itself the thing under test.
  const decoded = built.strings[targetBody[5]]
    .filter((byte) => byte >= FONT_BASE)
    .map((byte) => String.fromCharCode(byte - FONT_BASE + 32))
    .join('');
  assert.equal(decoded, 'B', `the call ran "${decoded}" instead of the B it was authored to name`);
});

test('a dangling call still resolves to nothing after its deleted id is issued to a replacement', () => {
  // A is deleted, and a replacement is added afterward -- exactly what
  // clicking "+ Common event" does, drawing its id from commonEventSeq
  // rather than from the lowest id nothing is using (see
  // resolveCommonEventIds in shared/project.js). A call still naming A's old
  // id must not start running the replacement just because the replacement
  // landed in the table slot A used to occupy.
  let project = createProject('Replaced');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.commonEvents = [
    { name: 'A', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'A' }] }] } }
  ];
  project.maps[0].screens[0].entities = [
    { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 0 }] }] } } }
  ];
  project = normalizeProject(project);
  assert.equal(project.commonEvents[0].id, 0);
  assert.equal(project.commonEventSeq, 1);

  // A deleted, exactly as the list editor's ✕ leaves it: a plain splice.
  project.commonEvents = project.commonEvents.filter((entry) => entry.id !== 0);
  project = normalizeProject(project);
  assert.equal(project.commonEvents.length, 0);
  assert.equal(project.commonEventSeq, 1, 'the ceiling must not fall back to 0 just because nothing is using it now');

  // A replacement, added the way "+ Common event" adds one: from the seq,
  // not from whatever id the deletion just freed.
  project.commonEvents.push({
    id: project.commonEventSeq,
    name: 'Replacement',
    event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Replacement' }] }] }
  });
  project.commonEventSeq += 1;
  project = normalizeProject(project);
  assert.equal(project.commonEvents[0].id, 1, 'the replacement should not have been handed the deleted id back');

  const built = compileText(structuredClone(project));
  // Only the replacement compiles into the table; the caller's call, still
  // naming id 0, carries NO_COMMON_EVENT_SLOT rather than being resolved
  // against whatever id now occupies the slot A used to.
  assert.equal(built.events.length, 2, 'the replacement plus the caller');
  const callerBody = built.events[1].slice(4);
  assert.deepEqual(
    callerBody,
    [OP_CALL, NO_COMMON_EVENT_SLOT, OP_END, EVT_PAGES_END],
    'the dangling call should carry NO_COMMON_EVENT_SLOT, not resolve to the replacement'
  );
});

test('a live, unnormalized call resolves the same way a saved one does', () => {
  // buildProject is handed the project the app is holding, which may never
  // have been through normalizeEventCommand since the call was authored —
  // so command.event straight off an in-memory command can be a string, the
  // way an unconverted form field would leave it. commonEventTableIndex's
  // own keys are built by running every entry's id through commonEventId
  // (see resolveCommonEventIds), so a raw command.event has to go through
  // the identical function or a call that works after a save silently stops
  // working before one.
  const project = createProject('Live');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.commonEvents = [
    {
      id: 0,
      name: 'Reward',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Reward' }] }] }
    }
  ];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: '0' }] }] } }
    }
  ];
  // Not run through normalizeProject: this is exactly the shape buildProject
  // receives when the live app hands over the project it is currently
  // holding.
  const built = compileText(project);
  assert.deepEqual(built.problems, []);
  assert.equal(built.events.length, 2);
  const callerBody = built.events[1].slice(4);
  assert.equal(callerBody[0], OP_CALL);
  assert.equal(callerBody[1], 0, 'the string "0" should resolve exactly like the number 0 does');
});

test('an unresolvable call carries NO_COMMON_EVENT_SLOT and never runs common event 0', () => {
  // 0 is an id a common event can really be sitting at, so an invalid
  // reference falling back to it would silently run that one instead of
  // stopping — the same failure a dangling reference already had to be
  // taught not to cause, from the opposite direction.
  const project = createProject('Zero');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.commonEvents = [
    {
      id: 0,
      name: 'Zero',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Zero' }] }] }
    }
  ];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: -7 }] }] } }
    }
  ];
  const normalized = normalizeProject(structuredClone(project));
  const call = normalized.maps[0].screens[0].entities[0].props.event.pages[0].commands[0];
  assert.equal(call.event, NO_COMMON_EVENT_ID, 'an invalid reference must not normalize to 0');
  assert.equal(commonEventId(call.event), null);

  const built = compileText(normalized);
  assert.equal(built.events.length, 2, 'the common event plus the caller');
  const callerBody = built.events[1].slice(4);
  assert.deepEqual(
    callerBody,
    [OP_CALL, NO_COMMON_EVENT_SLOT, OP_END, EVT_PAGES_END],
    'the invalid call should carry NO_COMMON_EVENT_SLOT, not resolve to common event 0'
  );
});

test('deleting a common event in the built ROM still runs what the survivor names', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // The same scenario as the byte-level test above, but through a booted ROM:
  // A, B and C get ids 0, 1 and 2; the chest calls B; A is deleted the way
  // the editor's ✕ leaves it, splicing the list without touching B or C's
  // ids. Talking to the chest has to give the Gem that B hands over, not the
  // Hunter that C would -- C being the thing that slid into B's old row.
  const { nes } = await buildWith(t, [chest([{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 1 }] }])], (project) => {
    project.commonEvents = [
      { id: 1, name: 'B', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: GEM }] }] } },
      { id: 2, name: 'C', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: HUNTER }] }] } }
    ];
  });
  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[INV_COUNT], 1);
  assert.equal(nes.cpu.mem[INV_ITEMS], GEM, 'the call ran C instead of the B it was authored to name');
});

test('a call reaches into a common event and comes back to the command after it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(
    t,
    [
      chest([
        {
          cond: { type: 'none', arg: 0 },
          commands: [
            { op: 'say', text: 'Before.' },
            { op: 'give', actor: 0 }, // Slime
            { op: 'call', event: 0 },
            { op: 'give', actor: HUNTER },
            { op: 'say', text: 'After.' }
          ]
        }
      ])
    ],
    (project) => {
      project.commonEvents = [
        {
          name: 'Reward',
          event: {
            pages: [
              {
                cond: { type: 'none', arg: 0 },
                commands: [{ op: 'say', text: 'Reward!' }, { op: 'give', actor: GEM }]
              }
            ]
          }
        }
      ];
    }
  );

  assert.ok(talkThrough(nes), 'the conversation never ended');
  // Three pages, three gifts, in the order they were authored: the common
  // event's own Say suspended and resumed correctly, its Give ran exactly
  // once, and script_ptr came back to the command after the call rather than
  // restarting the chest's page or skipping past it.
  assert.equal(nes.cpu.mem[INV_COUNT], 3);
  assert.deepEqual(
    [...nes.cpu.mem.slice(INV_ITEMS, INV_ITEMS + 3)],
    [0, GEM, HUNTER],
    'the bag should read Slime, Gem, Hunter — before, inside the call, and after it'
  );
});

test('the same call runs the common event again, not a copy of it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // The whole point of a common event is authoring the body once. Firing the
  // same call twice should run it twice, with the same effect each time,
  // rather than something that only works the first time script_ptr visits
  // that table slot.
  const { nes } = await buildWith(
    t,
    [chest([{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 0 }] }])],
    (project) => {
      project.commonEvents = [
        {
          name: 'Count',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
        }
      ];
    }
  );
  assert.ok(talkThrough(nes), 'the first conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES], 1);
  assert.ok(talkThrough(nes), 'the second conversation never ended');
  assert.equal(nes.cpu.mem[VARIABLES], 2, 'the same common event ran a second time from the same placement');
});

test('a cycle between common events is bounded, not a hang', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Common event A calls B, B calls A, and so on. CALL_STACK_DEPTH in
  // engine/constants.asm is the one place that recursion is bounded: once the
  // stack is full a call is skipped rather than pushed, so the chain unwinds
  // instead of running forever. Each level counts once on the way down, so the
  // final count is exactly the bound — proof the engine stopped pushing there
  // and not one level sooner or later.
  const { nes } = await buildWith(
    t,
    [chest([{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 0 }, { op: 'say', text: 'Done.' }] }])],
    (project) => {
      project.commonEvents = [
        {
          name: 'A',
          event: {
            pages: [
              {
                cond: { type: 'none', arg: 0 },
                commands: [{ op: 'addVar', variable: 0, value: 1 }, { op: 'call', event: 1 }]
              }
            ]
          }
        },
        {
          name: 'B',
          event: {
            pages: [
              {
                cond: { type: 'none', arg: 0 },
                commands: [{ op: 'addVar', variable: 0, value: 1 }, { op: 'call', event: 0 }]
              }
            ]
          }
        }
      ];
    }
  );

  assert.ok(talkThrough(nes, 60), 'a cycle between common events hung the conversation');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the world was not handed back');
  // The engine's own CALL_STACK_DEPTH (engine/constants.asm) is 4: the chest's
  // own call is depth 1, and A and B alternate from there until the fifth call
  // finds the stack full and is skipped instead of pushed.
  assert.equal(nes.cpu.mem[VARIABLES], 4, 'the recursion bound did not land where the engine defines it');
});
