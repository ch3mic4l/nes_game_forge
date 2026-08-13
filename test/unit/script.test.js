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
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { compileText, EVT_PAGES_END } from '../../main/build/textcompile.js';
import {
  createProject,
  normalizeProject,
  compiledPages,
  enabledCommands,
  RPG_LIMITS
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

const ST_GAMEPLAY = 0;
const BOX_PAGEWAIT = 3;
const BOX_ENDWAIT = 6;

const A = 0;
const B = 1;

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

/** Talk, then press through every page until the conversation ends. */
function talkThrough(nes, budget = 30) {
  tap(nes, B);
  for (let press = 0; press < budget; press++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    // Wait for the box to want an answer, then give it one. A press outside a
    // wait is ignored by design, so polling for the wait is what makes this
    // independent of how long the text is.
    for (let frame = 0; frame < 600; frame++) {
      const box = nes.cpu.mem[BOX_STATE];
      if (box === BOX_PAGEWAIT || box === BOX_ENDWAIT || nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) break;
      nes.frame();
    }
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    tap(nes, A);
    for (let i = 0; i < 20; i++) nes.frame();
  }
  return nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
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
  return { project, nes: boot(built.romPath) };
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
