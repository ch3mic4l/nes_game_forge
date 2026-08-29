// Show/Hide: item 6's third verb. [OP_VISIBLE, state], self only -- resolved
// through talk_ent the same way Move/Turn's own 'self' already is, since
// there is exactly one entity this command can ever mean. Does not suspend,
// the same instant shape OP_TURN already has.
//
// The whole point of the semantic decision this file exists to prove: hidden
// means invisible but otherwise fully alive. draw_entities is the only
// reader of ENT_HIDDEN (engine/entities.asm); AI (update_entities), contact
// (entity_contact) and interaction (do_talk/do_attack/do_interact) all keep
// reading ent_active for occupancy alone and never look at the hidden bit.
// Packed into ent_active's own spare bit (bit 1) rather than a new array --
// see engine/constants.asm's own comment on ent_active.
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
import { createProject, normalizeProject, projectUsesVisible } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM, from engine/constants.asm -- confirmed by observing the values
// actually take effect at these addresses in the runs below, the same
// discipline every other file in this family follows (shake.test.js,
// turnwait.test.js) rather than trusting the source read back.
const PLAYER_X = 0x10;
const GAME_STATE = 0x25;
const PICKUPS = 0x24;
const DEFEATED = 0x27;
const PLAYER_HP = 0x4e;
const PLAYER_IFRAMES = 0x4f;
const ENT_ACTIVE = 0x300;
const ENT_Y = 0x318;
const VARIABLES = 0x500;
const SWITCHES = 0x390;
const OAM = 0x200;

// ent_active's own packed bits (engine/constants.asm's ENT_PRESENT/ENT_HIDDEN).
const ENT_PRESENT = 0x01;
const ENT_HIDDEN = 0x02;

const ST_GAMEPLAY = 0;
const MAX_HEARTS = 3; // the schema default
const A = 0;
const B = 1;
const DOWN = 5;
const RIGHT = 7;

const START_X = 112;
const START_Y = 112;

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

/** Hold a direction until something happens, or give up. */
const walkUntil = (nes, button, predicate, budget = 120) => {
  nes.buttonDown(1, button);
  for (let i = 0; i < budget; i++) {
    nes.frame();
    if (predicate(nes)) break;
  }
  nes.buttonUp(1, button);
  return predicate(nes);
};

/** Sprites the shadow actually holds this frame -- draw_entities_park fills
 * everything past the last one written with $FF, so this counts what is
 * really being drawn, not merely what a slot's own state claims. */
const activeSpriteCount = (nes) => {
  let count = 0;
  for (let i = 0; i < 64; i++) if (nes.cpu.mem[OAM + i * 4] !== 0xff) count++;
  return count;
};

async function buildWith(t, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-visible-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [];
  mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, romPath: built.romPath, nes: boot(built.romPath) };
}

/** A fresh actor cloned from the sample's own slime, overridable per test. */
function pushActor(project, overrides) {
  const id = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id,
    name: 'Ghost',
    behavior: 'npc',
    ...overrides
  });
  return id;
}

const page = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

// --------------------------------------------------------------- the wire

test('a Show/Hide compiles to its opcode plus one state byte, hidden=0 shown=1', () => {
  // Pinned against the literal in engine/constants.asm (OP_VISIBLE = $17),
  // not just opIndex('visible') read back from the same table the assertion
  // below also reads its expected byte from.
  assert.equal(opIndex('visible'), 0x17, "opIndex('visible') must match engine/constants.asm's OP_VISIBLE literally, not just internally");
  const project = normalizeProject({
    ...createProject('Visible wire'),
    commonEvents: [
      {
        id: 0,
        name: 'Vanish',
        event: page([
          { op: 'visible', state: 'hidden' },
          { op: 'visible', state: 'shown' }
        ])
      }
    ]
  });
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(opIndex('visible'));
  assert.ok(at >= 0, 'the compiled events should contain an OP_VISIBLE');
  assert.deepEqual(
    bytes.slice(at, at + 4),
    [opIndex('visible'), 0, opIndex('visible'), 1],
    'Hide compiles state 0, Show compiles state 1, each opcode plus one byte'
  );
});

// ------------------------------------------------------------- the engine

test('a Show/Hide does not suspend the event -- the next command runs the same frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    const id = pushActor(project, {});
    project.maps[0].screens[0].entities.push({
      actorId: id,
      x: START_X,
      y: START_Y - 16,
      props: { event: page([{ op: 'visible', state: 'hidden' }, { op: 'setSwitch', switch: 5 }]) }
    });
  });
  tap(nes, B, 0); // talk: the page runs Hide then the next command, all before this frame ends
  const on = (n) => Boolean(nes.cpu.mem[SWITCHES + (n >> 3)] & (1 << (n & 7)));
  assert.equal(on(5), true, 'the command after Show/Hide must already have run -- it does not suspend the event');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'with nothing left to suspend on, the conversation ends the same frame it started');
});

test('a hidden entity keeps its AI running -- it must actually move while hidden -- and stops being drawn', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    const id = pushActor(project, { behavior: 'patroller', speed: 1 });
    project.maps[0].screens[0].entities.push({
      actorId: id,
      x: START_X,
      y: START_Y - 16,
      props: { event: page([{ op: 'visible', state: 'hidden' }]) }
    });
  });
  const slot = 0;
  const shownCount = activeSpriteCount(nes);

  tap(nes, B, 0); // talk: hides the actor
  assert.equal(
    nes.cpu.mem[ENT_ACTIVE + slot] & ENT_PRESENT,
    ENT_PRESENT,
    'a hidden entity must still read as occupied (bit 0) -- hidden is not gone'
  );
  assert.equal(nes.cpu.mem[ENT_ACTIVE + slot] & ENT_HIDDEN, ENT_HIDDEN, 'the hidden bit must be set');

  const hiddenCount = activeSpriteCount(nes);
  assert.ok(
    hiddenCount < shownCount,
    `hiding should draw fewer sprites (was ${shownCount}, now ${hiddenCount})`
  );

  const yAfterHide = nes.cpu.mem[ENT_Y + slot];
  run(nes, 90);
  const yAfterRun = nes.cpu.mem[ENT_Y + slot];
  assert.notEqual(
    yAfterRun,
    yAfterHide,
    'a hidden entity must keep patrolling -- AI must not stop just because it is invisible'
  );
  assert.equal(activeSpriteCount(nes), hiddenCount, 'still not drawn 90 frames later, while it keeps moving');
});

test('a hidden entity can still be talked to, and still deals contact damage', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    const id = pushActor(project, { damage: 1 });
    project.maps[0].screens[0].entities.push({
      actorId: id,
      x: START_X,
      y: START_Y + 16, // in interact reach (16 < REACH_RANGE 20) but not touching (16 >= TOUCH_RANGE 12)
      props: { event: page([{ op: 'visible', state: 'hidden' }, { op: 'addVar', variable: 0, value: 1 }]) }
    });
  });
  const slot = 0;

  // Both taps use the default follow-frame count, not 0: read_pad's own
  // pad_new is edge-triggered off pad_last (engine/input.asm), so the button
  // must be seen released for at least one real frame before a second press
  // counts as new -- a tap with 0 follow frames releases the button without
  // ever running a frame while it reads as up, which the very next
  // buttonDown then hides from pad_last entirely.
  tap(nes, B); // first talk: hides it, var 0 becomes 1
  assert.equal(nes.cpu.mem[ENT_ACTIVE + slot] & ENT_HIDDEN, ENT_HIDDEN, 'should be hidden after the first press');
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the event should have run once');

  tap(nes, B); // second talk: do_talk must still find a hidden actor
  assert.equal(nes.cpu.mem[VARIABLES], 2, "do_talk must still find and run a hidden actor's own event");

  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS, 'not touching yet -- should still be at full hearts');
  assert.ok(
    walkUntil(nes, DOWN, (n) => n.cpu.mem[PLAYER_HP] < MAX_HEARTS),
    'walking onto a hidden damage actor never landed a hit'
  );
  assert.ok(nes.cpu.mem[PLAYER_IFRAMES] > 0, 'contact should still grant the usual invincibility window');
});

test('a hidden entity can still be attacked and defeated', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    const id = pushActor(project, { hp: 1 });
    project.maps[0].screens[0].entities.push({
      actorId: id,
      x: START_X,
      y: START_Y - 16,
      props: { event: page([{ op: 'visible', state: 'hidden' }]) }
    });
  });
  const slot = 0;

  tap(nes, B, 0); // talk: hides it
  assert.equal(nes.cpu.mem[ENT_ACTIVE + slot] & ENT_HIDDEN, ENT_HIDDEN, 'should be hidden before the attack');
  assert.equal(nes.cpu.mem[DEFEATED], 0);

  tap(nes, A, 0); // attack: do_attack must still find a hidden slot
  assert.equal(nes.cpu.mem[DEFEATED], 1, 'do_attack must still find and defeat a hidden actor with 1 HP');
  assert.equal(nes.cpu.mem[ENT_ACTIVE + slot], 0, 'a defeated actor clears both bits, hidden or not');
});

test('a pickup hidden from the moment the screen loads can still be collected via the interact button', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    const id = pushActor(project, { behavior: 'pickup' });
    project.maps[0].screens[0].entities.push({
      actorId: id,
      x: START_X,
      y: START_Y - 16,
      props: { trigger: 'enter', event: page([{ op: 'visible', state: 'hidden' }]) }
    });
  });
  const slot = 0;

  assert.equal(
    nes.cpu.mem[ENT_ACTIVE + slot] & ENT_HIDDEN,
    ENT_HIDDEN,
    'the entry event should already have hidden it by the time the screen finished loading'
  );
  assert.equal(nes.cpu.mem[PICKUPS], 0);

  tap(nes, B, 0); // interact: do_interact must still find a hidden pickup in reach
  assert.equal(nes.cpu.mem[PICKUPS], 1, 'do_interact must still find and collect a hidden pickup');
  assert.equal(nes.cpu.mem[ENT_ACTIVE + slot], 0, 'a collected pickup clears both bits, hidden or not');
});

test('hiding does not survive a screen change', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    const npc = pushActor(project, {});
    project.maps[0].screens[0].entities.push({
      actorId: npc,
      x: START_X,
      y: START_Y - 16,
      props: { event: page([{ op: 'visible', state: 'hidden' }]) }
    });
    const lever = pushActor(project, {});
    project.maps[0].screens[0].entities.push({
      actorId: lever,
      x: START_X + 40,
      y: START_Y,
      props: { event: page([{ op: 'warp', screen: 0, x: START_X, y: START_Y }]) }
    });
  });
  const npcSlot = 0;

  tap(nes, B, 0); // hides the NPC, which starts 16px above the player
  assert.equal(
    nes.cpu.mem[ENT_ACTIVE + npcSlot] & ENT_HIDDEN,
    ENT_HIDDEN,
    'should be hidden before the screen change'
  );

  // Walk to the lever and pull it -- warping to the same screen forces
  // redraw_screen -> spawn_entities to run again.
  assert.ok(
    walkUntil(nes, RIGHT, (n) => Math.abs(n.cpu.mem[PLAYER_X] - (START_X + 40)) < 20),
    'never got within reach of the lever'
  );
  tap(nes, B, 0);

  assert.equal(
    nes.cpu.mem[ENT_ACTIVE + npcSlot],
    ENT_PRESENT,
    'a screen redraw must make every placement visible again, hidden or not -- Hide is not permanence'
  );
});

test('Show after Hide restores drawing', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    const id = pushActor(project, {});
    project.maps[0].screens[0].entities.push({
      actorId: id,
      x: START_X,
      y: START_Y - 16,
      props: {
        event: {
          pages: [
            { cond: { type: 'switchOff', arg: 0 }, commands: [{ op: 'visible', state: 'hidden' }, { op: 'setSwitch', switch: 0 }] },
            { cond: { type: 'none', arg: 0 }, commands: [{ op: 'visible', state: 'shown' }, { op: 'clearSwitch', switch: 0 }] }
          ]
        }
      }
    });
  });
  const slot = 0;
  const shownBefore = activeSpriteCount(nes);

  // Both taps use the default follow-frame count -- see the identical note
  // in the "still be talked to" test above for why 0 would hide the release
  // from read_pad's own pad_last and make the second press invisible.
  tap(nes, B); // switch 0 is off: page 0 runs -- hide, then turn switch 0 on
  assert.equal(nes.cpu.mem[ENT_ACTIVE + slot] & ENT_HIDDEN, ENT_HIDDEN, 'should be hidden after the first press');
  const hiddenCount = activeSpriteCount(nes);
  assert.ok(hiddenCount < shownBefore, 'hiding should draw fewer sprites');

  tap(nes, B); // switch 0 is now on: page 0's condition fails, page 1 runs -- show, clear switch 0
  assert.equal(
    nes.cpu.mem[ENT_ACTIVE + slot],
    ENT_PRESENT,
    'Show must clear the hidden bit, restoring exactly ENT_PRESENT'
  );
  assert.equal(activeSpriteCount(nes), shownBefore, 'Show must restore drawing to exactly what it was before Hide');
});

test('a switched-off Show/Hide costs a project nothing -- not one byte of ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const withOff = await buildWith(t, (project) => {
    const id = pushActor(project, {});
    project.maps[0].screens[0].entities.push({
      actorId: id,
      x: START_X,
      y: START_Y - 16,
      props: { event: page([{ op: 'visible', state: 'hidden', off: true }, { op: 'setSwitch', switch: 5 }]) }
    });
  });
  const without = await buildWith(t, (project) => {
    const id = pushActor(project, {});
    project.maps[0].screens[0].entities.push({
      actorId: id,
      x: START_X,
      y: START_Y - 16,
      props: { event: page([{ op: 'setSwitch', switch: 5 }]) }
    });
  });
  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a disabled Show/Hide must leave the ROM identical to one with no Show/Hide at all'
  );
});

test('projectUsesVisible ignores a command the compiler would drop', () => {
  const project = createProject('Predicate');
  const pages = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'visible', state: 'hidden' }]) }];
  assert.equal(projectUsesVisible(project), true, 'a live Show/Hide counts');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'visible', state: 'hidden', off: true }]) }];
  assert.equal(projectUsesVisible(project), false, 'a switched-off one does not');

  // Inside a branch, the same place usedSwitches once failed to look.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        {
          op: 'branch',
          cond: { type: 'none', arg: 0 },
          then: [{ op: 'visible', state: 'hidden' }],
          else: []
        }
      ])
    }
  ];
  assert.equal(projectUsesVisible(project), true, 'a Show/Hide nested inside a branch still counts');

  // And inside a Choice option -- the one place a hand-rolled walk that only
  // knew about then/else would still miss it.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        {
          op: 'choice',
          options: [
            { text: 'Go', commands: [{ op: 'visible', state: 'hidden' }] },
            { text: 'No', commands: [] }
          ]
        }
      ])
    }
  ];
  assert.equal(projectUsesVisible(project), true, 'a Show/Hide inside a Choice option still counts');
});
