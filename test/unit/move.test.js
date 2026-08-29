// The Move command: an event walks an actor, and waits while it happens.
//
// Move is the one command whose whole point is that it takes time, so most of
// what is worth asserting here is about *when* the command after it runs --
// not only that the actor ended up somewhere. A Move that teleported and let
// the page carry straight on would pass a test that only looked at the final
// position.
//
// It is also the first command gated on a `projectUsesMove` predicate for a
// capacity reason rather than a hardware one (see kernelCodeBytes in
// main/build/generate.js), so the last two tests here are about what a project
// that does *not* use it pays -- which must be nothing at all.
//
// Everything builds its own project rather than touching `sample/`, which is a
// checked-in fixture.

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
  projectUsesMove
} from '../../shared/project.js';
import { MOVE_KERNEL_ALLOWANCE, FACE_KERNEL_ALLOWANCE } from '../../main/build/generate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const ENT_DIR = 0x320;
const SWITCHES = 0x390;

const ST_GAMEPLAY = 0;
const B = 1;

// From engine/constants.asm's DIR_*, which MOVE_DIRECTIONS is written to match.
const DIR_DOWN = 0;
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
 * A one-screen project with one talkable actor carrying `commands`, on a screen
 * wiped to metatile 0.
 *
 * The wipe matters: metatile 0 is 'Empty' and open by construction
 * (createMetatile's default, shared/project.js), so every square is walkable
 * without this test having to know anything about the sample's actual art. A
 * Move test that ran into scenery would be testing the scenery.
 */
async function buildWith(t, commands, tweak = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-move-'));
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

test('a Move compiles to its opcode, both selectors as list positions, and a distance', () => {
  // A common event rather than a placement: this test is about the four bytes a
  // Move compiles to, and a common event is the smallest thing that reaches the
  // compiler's events table without also having to satisfy a map, a screen and
  // an actor that the assertion does not care about.
  const project = normalizeProject({
    ...createProject('Move wire'),
    commonEvents: [
      {
        id: 0,
        name: 'Walk',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [{ op: 'move', who: 'player', dir: 'left', dist: 40 }]
            }
          ]
        }
      }
    ]
  });

  // compileText returns one byte array per compiled event, not one flat blob.
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(opIndex('move'));
  assert.ok(at >= 0, 'the compiled events should contain an OP_MOVE');
  assert.deepEqual(
    bytes.slice(at, at + 4),
    [
      opIndex('move'),
      MOVE_TARGETS.findIndex((entry) => entry.id === 'player'),
      MOVE_DIRECTIONS.findIndex((entry) => entry.id === 'left'),
      40
    ],
    'who and dir compile to their positions in the shared lists, not to raw strings'
  );
  // The direction byte is the engine's own DIR_*, which is the whole reason
  // MOVE_DIRECTIONS is written in that order rather than a readable one.
  assert.equal(MOVE_DIRECTIONS.findIndex((entry) => entry.id === 'left'), DIR_LEFT);
  assert.equal(MOVE_DIRECTIONS.findIndex((entry) => entry.id === 'down'), DIR_DOWN);
});

test('an unknown who or dir falls back to the first entry rather than being dropped', () => {
  const [command] = normalizeProject({
    ...createProject('Fallback'),
    commonEvents: [
      {
        id: 0,
        name: 'E',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [{ op: 'move', who: 'the-cat', dir: 'widdershins', dist: 8 }]
            }
          ]
        }
      }
    ]
  }).commonEvents[0].event.pages[0].commands;

  assert.equal(command.op, 'move', 'the command survives — a Move that lost its direction is still a Move');
  assert.equal(command.who, MOVE_TARGETS[0].id);
  assert.equal(command.dir, MOVE_DIRECTIONS[0].id);
  assert.equal(command.dist, 8, 'and the distance it did have is untouched');
});

// ------------------------------------------------------------- the engine

test('a Move walks the actor, and the command after it waits until the walk is over', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'move', who: 'self', dir: 'left', dist: 32 },
    { op: 'setSwitch', switch: 5 }
  ]);

  const startX = nes.cpu.mem[ENT_X];
  assert.equal(startX, START_X, 'the actor starts where it was placed');
  assert.equal(switchOn(nes, 5), false);

  tap(nes, B); // talk: the page runs, hits the Move and suspends
  run(nes, 6);

  // Mid-walk is the whole point: it has started moving and the *next* command
  // has not run. A Move that teleported would already have set the switch here.
  const midX = nes.cpu.mem[ENT_X];
  assert.ok(midX < startX, `the actor should have started moving (${startX} -> ${midX})`);
  assert.ok(midX > startX - 32, `and should not be there yet (${midX})`);
  assert.equal(switchOn(nes, 5), false, 'the command after the Move must not have run yet');

  assert.ok(settle(nes), 'the conversation should end once the walk finishes');
  assert.equal(nes.cpu.mem[ENT_X], startX - 32, 'the actor lands exactly the authored distance away');
  assert.equal(switchOn(nes, 5), true, 'and only then does the next command run');
  assert.equal(nes.cpu.mem[ENT_DIR], DIR_LEFT, 'walking left leaves it facing left');
});

test('a Move that runs into the edge of the screen stops there and the event carries on', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Further than there is room for: the actor is 112 pixels from the left edge
  // and this asks for 200. The event must not wait forever for a walk that
  // cannot finish -- an author cannot see from the Map Forge what will be in
  // the way on the day, so the engine unwinds rather than hanging, the same
  // answer script_op_call gives a call stack that has run out.
  const { nes } = await buildWith(t, [
    { op: 'move', who: 'self', dir: 'left', dist: 200 },
    { op: 'setSwitch', switch: 6 }
  ]);

  tap(nes, B);
  assert.ok(settle(nes), 'a blocked Move must still end its own conversation');
  assert.ok(nes.cpu.mem[ENT_X] < 16, `the actor should be up against the edge (${nes.cpu.mem[ENT_X]})`);
  assert.equal(switchOn(nes, 6), true, 'and the command after it still runs');
});

test('a Move of zero does not suspend the event at all', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'move', who: 'self', dir: 'left', dist: 0 },
    { op: 'setSwitch', switch: 7 }
  ]);

  const startX = nes.cpu.mem[ENT_X];
  tap(nes, B);
  run(nes, 4);
  // Nothing to wait for, so the page ran straight through. If a zero-distance
  // Move suspended, mv_left would be zero with a script waiting on it reaching
  // zero -- a wait nothing could ever end.
  assert.equal(switchOn(nes, 7), true, 'the next command runs immediately');
  assert.equal(nes.cpu.mem[ENT_X], startX, 'and nothing moved');
});

test('a Move can walk the player instead of the actor that is speaking', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'move', who: 'player', dir: 'down', dist: 16 },
    { op: 'setSwitch', switch: 8 }
  ]);

  const startY = nes.cpu.mem[PLAYER_Y];
  const startX = nes.cpu.mem[PLAYER_X];
  const actorY = nes.cpu.mem[ENT_Y];

  tap(nes, B);
  assert.ok(settle(nes), 'the conversation ends when the player has finished walking');
  assert.equal(nes.cpu.mem[PLAYER_Y], startY + 16, 'the player moved the authored distance');
  assert.equal(nes.cpu.mem[PLAYER_X], startX, 'and only on the axis asked for');
  assert.equal(nes.cpu.mem[ENT_Y], actorY, 'the actor that was speaking stayed put');
  assert.equal(switchOn(nes, 8), true);
});

// ------------------------------------------------- what a project pays for it

test('a switched-off Move costs a project nothing — not one byte of ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const withOff = await buildWith(t, [
    { op: 'move', who: 'self', dir: 'left', dist: 32, off: true },
    { op: 'setSwitch', switch: 5 }
  ]);
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);

  // Not merely "it still builds": byte-for-byte, because projectUsesMove reads
  // liveCommands rather than every command, and MOVE_ENABLED gates the whole
  // implementation. A disabled Move that still switched the engine block on
  // would cost a project ~400 bytes of kernel for scaffolding the compiler
  // already drops -- and on a saving project, those are bytes the kernel bank
  // does not have.
  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a disabled Move must leave the ROM identical to one with no Move at all'
  );
});

test('MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE still cover what Move actually costs', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // The same rule kernelbytes.test.js enforces for SAVE_KERNEL_ALLOWANCE_BY_MAPPER,
  // and here for a sharper reason: these two allowances sum to exactly the
  // measured delta, 395, with no margin of their own -- KERNEL_SLACK is the
  // only deliberate headroom kernelCodeBytes carries (see its own comment) --
  // so drift in either is not a tightened capacity check, it is an assembler
  // failure for real projects. move_face split out into its own
  // FACE_KERNEL_ALLOWANCE with item 6's Turn/Wait first slice (so a Turn-only
  // project pays for it without also paying for the rest of Move), which is
  // why this measures against the sum rather than MOVE_KERNEL_ALLOWANCE
  // alone: this project has no live Turn, so it still pays both terms
  // together, and the sum is what covers it. Save and Move together on MMC3
  // with text used to be a few bytes
  // short of the kernel-lo bank on the worst-fitting real project measured
  // (sample-rpg): a kernel diet (engine/combat.asm, gated `.if !BATTLE_ENABLED`),
  // per-mapper budgeting (BASE_KERNEL_CODE_BYTES_BY_MAPPER) and a second,
  // unrelated fix to entity_contact's own player_iframes check together closed
  // it -- it now assembles with 21 bytes to spare, which kernelbytes.test.js
  // asserts directly, not a margin to lean on. checkCapacity still names the
  // feature or board that would close a gap like it whenever one remains,
  // rather than only reporting the shortfall (kernelShortfallAdvice) -- see
  // kernelCodeBytes's own comment for the numbers.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-move-cost-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const usage = async (commands) => {
    const project = await loadProject(SAMPLE);
    const slime = project.sprites.actors[0];
    project.sprites.actors.push({ ...structuredClone(slime), id: NPC, name: 'Walker', behavior: 'npc' });
    project.maps[0].screens[0].entities = [
      {
        actorId: NPC,
        x: START_X,
        y: START_Y - 16,
        props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
      }
    ];
    const target = await fs.promises.mkdtemp(path.join(dir, 'build-'));
    await saveProject(target, project);
    const lines = [];
    await buildProject({ dir: target, project, log: (line) => lines.push(line) });
    // nesasm's own usage table. The sample is NROM, whose kernel-lo bank is 2.
    const row = lines.find((line) => /^BANK\s+2\s/.test(line));
    assert.ok(row, "nesasm's usage table should mention the kernel-lo bank");
    return Number(row.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  };

  const withMove = await usage([
    { op: 'move', who: 'self', dir: 'left', dist: 32 },
    { op: 'move', who: 'player', dir: 'down', dist: 16 }
  ]);
  const without = await usage([{ op: 'setSwitch', switch: 5 }]);
  const cost = withMove - without;
  const allowance = MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE;

  assert.ok(
    cost <= allowance,
    `Move now costs ${cost} bytes of kernel but MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE only reserves ` +
      `${allowance} — checkCapacity is promising table room the assembler will refuse. ` +
      'Re-measure and raise it (see the comment beside kernelCodeBytes).'
  );
  assert.ok(
    cost > allowance - 120,
    `Move costs ${cost} bytes but MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE reserves ${allowance} — so much ` +
      'slack that it has stopped tracking the engine, which hides the next regression the way a ' +
      'too-low one causes it. Re-measure and lower it.'
  );
});

test('projectUsesMove ignores a Move the compiler would drop', () => {
  const project = createProject('Predicate');
  const pages = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'move', who: 'self', dir: 'left', dist: 8 }]) }];
  assert.equal(projectUsesMove(project), true, 'a live Move counts');

  project.commonEvents = [
    { id: 0, name: 'E', event: pages([{ op: 'move', who: 'self', dir: 'left', dist: 8, off: true }]) }
  ];
  assert.equal(projectUsesMove(project), false, 'a switched-off one does not');

  // Inside a branch, which is where usedSwitches once failed to look: the
  // predicate walks the same liveCommands every other whole-event question does.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        {
          op: 'branch',
          cond: { type: 'none', arg: 0 },
          then: [{ op: 'move', who: 'self', dir: 'left', dist: 8 }],
          else: []
        }
      ])
    }
  ];
  assert.equal(projectUsesMove(project), true, 'a Move nested inside a branch still counts');
});
