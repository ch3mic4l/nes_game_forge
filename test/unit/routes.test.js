// Move/Turn/Wait routes: an authoring convenience over Move/Turn/Wait, not a
// new opcode. A route compiles to exactly the legs it holds, flattened
// inline with no framing of its own -- so the central claim this file exists
// to prove is byte-identity: a route and the same commands hand-chained must
// produce indistinguishable ROMs, and a route with nothing live inside it
// must cost a project nothing at all. See handoff-routes/design-routes.md.
//
// Everything here builds its own project rather than touching `sample/` or
// `sample-rpg/`, which are checked-in fixtures -- the one exception is the
// advice-string test, which loads sample-rpg read-only (loadProject) the
// same way test/unit/kernelbytes.test.js already does, and never writes
// back into it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { compileText } from '../../main/build/textcompile.js';
import { checkCapacity, projectWithoutCommands, MOVE_KERNEL_ALLOWANCE, FACE_KERNEL_ALLOWANCE } from '../../main/build/generate.js';
import { projectUsesText } from '../../shared/font.js';
import {
  createProject,
  normalizeProject,
  compiledPages,
  routeLegs,
  ROUTE_LEG_OPS,
  projectUsesMove,
  projectUsesTurn,
  projectUsesWait
} from '../../shared/project.js';
import { routeTrace, drawRouteTrace } from '../../renderer/forges/map/events.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

/**
 * A one-screen, one-actor project with `commands` on its only placement's
 * only page, on a screen wiped to metatile 0 (open by construction) so a
 * Move test never runs into scenery. Mirrors move.test.js's own `buildWith`.
 */
async function buildWith(t, commands) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-routes-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 96,
      y: 96,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, dir, romPath: built.romPath };
}

/** A project of its own, JS-level (no build), with `commands` on one page. */
function projectWith(commands) {
  const project = createProject('Routes', 'action');
  project.sprites.actors = [{ name: 'Hero', behavior: 'player' }];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    }
  ];
  return normalizeProject(project);
}

// ------------------------------------------------------- byte identity

test('a route compiles byte-identical to the same legs hand-chained -- who: player throughout', {
  skip: !hasRom && 'run `npm run build:sample` first'
}, async (t) => {
  // who: 'player' consistently, not 'self' anywhere: a broken legWithWho
  // injection that always compiles `self` regardless of the route's own
  // `who` would produce a plausible-looking, wrong ROM this test only
  // catches if the fixture's true `who` differs from that broken default.
  const routeProject = await buildWith(t, [
    { op: 'route', who: 'player', legs: [
      { op: 'move', dir: 'down', dist: 32 },
      { op: 'turn', dir: 'left' },
      { op: 'wait', frames: 20 }
    ] }
  ]);
  const chainedProject = await buildWith(t, [
    { op: 'move', who: 'player', dir: 'down', dist: 32 },
    { op: 'turn', who: 'player', dir: 'left' },
    { op: 'wait', frames: 20 }
  ]);
  assert.deepEqual(
    [...fs.readFileSync(routeProject.romPath)],
    [...fs.readFileSync(chainedProject.romPath)],
    'a route and the same legs hand-chained must compile to the byte-identical ROM'
  );
});

test('a route nested inside a branch compiles byte-identical to the hand-chained equivalent, including the branch\'s own length byte', () => {
  const routeProject = projectWith([
    {
      op: 'branch',
      cond: { type: 'none', arg: 0 },
      then: [
        { op: 'route', who: 'self', legs: [
          { op: 'move', dir: 'right', dist: 8 },
          { op: 'wait', frames: 5 }
        ] }
      ],
      else: []
    }
  ]);
  const chainedProject = projectWith([
    {
      op: 'branch',
      cond: { type: 'none', arg: 0 },
      then: [
        { op: 'move', who: 'self', dir: 'right', dist: 8 },
        { op: 'wait', frames: 5 }
      ],
      else: []
    }
  ]);
  const [routeEvent] = compileText(routeProject).events;
  const [chainedEvent] = compileText(chainedProject).events;
  assert.deepEqual(
    Array.from(routeEvent),
    Array.from(chainedEvent),
    'a route inside a branch\'s then-side must compile identically, including the branch\'s own then-length byte'
  );
});

test('an off route costs a project nothing -- not one byte of ROM', {
  skip: !hasRom && 'run `npm run build:sample` first'
}, async (t) => {
  const withOff = await buildWith(t, [
    { op: 'route', off: true, who: 'self', legs: [{ op: 'move', dir: 'left', dist: 32 }] },
    { op: 'setSwitch', switch: 5 }
  ]);
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);
  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a switched-off route must leave the ROM identical to one with no route at all'
  );
});

// ------------------------------------------------------------ predicates

test('projectUsesMove/Turn/Wait see legs inside a route', () => {
  const moveOnly = projectWith([{ op: 'route', who: 'self', legs: [{ op: 'move', dir: 'down', dist: 16 }] }]);
  assert.equal(projectUsesMove(moveOnly), true);
  assert.equal(projectUsesTurn(moveOnly), false);
  assert.equal(projectUsesWait(moveOnly), false);

  const turnWaitOnly = projectWith([
    { op: 'route', who: 'self', legs: [{ op: 'turn', dir: 'up' }, { op: 'wait', frames: 10 }] }
  ]);
  assert.equal(projectUsesMove(turnWaitOnly), false);
  assert.equal(projectUsesTurn(turnWaitOnly), true);
  assert.equal(projectUsesWait(turnWaitOnly), true);

  const offMoveInsideRoute = projectWith([
    { op: 'route', who: 'self', legs: [{ op: 'move', dir: 'down', dist: 16, off: true }] }
  ]);
  assert.equal(projectUsesMove(offMoveInsideRoute), false, 'an off leg must not count as a live Move');

  // §13 test 5's own fixture: a live Move leg, but the whole ROUTE is off --
  // a different shape from the off-leg case just above (a live leg inside a
  // dead container, rather than a dead leg inside a live one), and the one
  // the design's own test explicitly requires. isLive's route branch has to
  // treat a switched-off route as dead regardless of what its legs say.
  const liveMoveInsideOffRoute = projectWith([
    { op: 'route', off: true, who: 'self', legs: [{ op: 'move', dir: 'down', dist: 16 }] }
  ]);
  assert.equal(
    projectUsesMove(liveMoveInsideOffRoute),
    false,
    'a live Move leg inside an off: true route must not count -- the whole route is switched off'
  );
});

test('an empty or all-off route costs a project nothing and does not turn on projectUsesText', () => {
  for (const commands of [
    [{ op: 'route', who: 'self', legs: [] }],
    [{ op: 'route', who: 'self', legs: [
      { op: 'move', dir: 'down', dist: 16, off: true },
      { op: 'turn', dir: 'up', off: true },
      { op: 'wait', frames: 10, off: true }
    ] }]
  ]) {
    const project = projectWith(commands);
    const event = project.maps[0].screens[0].entities[0].props.event;
    assert.equal(compiledPages(event).length, 0, 'a page whose only command is a dead route has no live commands');
    assert.deepEqual(compileText(project).events, [], 'compileText must emit no event for an entity with nothing live');
    assert.equal(projectUsesMove(project), false);
    assert.equal(projectUsesTurn(project), false);
    assert.equal(projectUsesWait(project), false);
    assert.equal(
      projectUsesText(project),
      false,
      'a dead route must not spuriously turn on the MMC3 font-split cost -- it authors nothing'
    );
  }
});

// ---------------------------------------------------- projectWithoutCommands

test('projectWithoutCommands strips only the matching legs inside a route, not the whole route', () => {
  const project = projectWith([
    { op: 'route', who: 'self', legs: [
      { op: 'move', dir: 'down', dist: 16 },
      { op: 'turn', dir: 'up' },
      { op: 'wait', frames: 10 }
    ] }
  ]);
  const stripped = projectWithoutCommands(project, ['move']);
  const route = stripped.maps[0].screens[0].entities[0].props.event.pages[0].commands[0];
  assert.equal(route.op, 'route', 'the route container itself must still be present');
  assert.equal(route.legs[0].op, 'move');
  assert.equal(route.legs[0].off, true, 'the Move leg must be switched off');
  assert.notEqual(route.legs[1].off, true, 'the Turn leg must be untouched');
  assert.notEqual(route.legs[2].off, true, 'the Wait leg must be untouched');
  // The original project must be untouched -- projectWithoutCommands works
  // on its own clone.
  const originalRoute = project.maps[0].screens[0].entities[0].props.event.pages[0].commands[0];
  assert.notEqual(originalRoute.legs[0].off, true, 'the original project must not be mutated');
});

// This checks the *refusal and its advice string*, not a measured byte
// delta -- test/unit/kernelbytes.test.js's own "a route whose only leg is
// Turn measures exactly..." test is what measures a real cost. What this
// test proves is narrower and complementary: the exact "sample-rpg with
// Save and Move on UNROM 512 does not build" documented-limitation refusal
// that file already establishes for a BARE Move still fires, unchanged,
// with the route-wrapped Move naming itself in the advice exactly as a bare
// one would (same freed-byte figure) -- i.e. checkCapacity/
// kernelShortfallAdvice do not need to special-case a route at all.
test('a route-wrapped Move still triggers the documented UNROM 512 refusal, with advice naming it exactly as a bare Move', {
  skip: !hasNesasm && 'nesasm not found on PATH'
}, async (t) => {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 30; // UNROM 512
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: {
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'save' }, { op: 'route', who: 'self', legs: [{ op: 'move', dir: 'up', dist: 16 }] }]
          }
        ]
      }
    }
  });
  const { problems } = checkCapacity(project);
  const error = problems.find((p) => p.severity === 'error' && /lookup tables/.test(p.message));
  assert.ok(error, 'this combination is a documented refusal on UNROM 512 -- checkCapacity must still refuse it');
  assert.match(
    error.message,
    new RegExp(`removing every Move command \\(frees ${MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} bytes\\)`),
    'the advice must name the route-wrapped Move exactly as it would a bare one, with the identical freed-byte figure'
  );
});

// -------------------------------------------------------------- round-trips

test('an unrecognized op is dropped on normalize without corrupting its neighbors', () => {
  const project = createProject('Routes', 'action');
  project.sprites.actors = [{ name: 'Hero' }];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [{ op: 'setSwitch', switch: 1 }, { op: 'aFutureVerbThisVersionDoesNotKnow' }, { op: 'setSwitch', switch: 2 }]
            }
          ]
        }
      }
    }
  ];
  const normalized = normalizeProject(project);
  const commands = normalized.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  assert.deepEqual(commands.map((c) => c.op), ['setSwitch', 'setSwitch']);
  assert.equal(commands[0].switch, 1);
  assert.equal(commands[1].switch, 2);
});

test('a route (and a leg) written by a later version with an unknown field survives normalization with the field dropped', () => {
  const project = createProject('Routes', 'action');
  project.sprites.actors = [{ name: 'Hero' }];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                {
                  op: 'route',
                  who: 'self',
                  speed: 'fast', // an unknown route-level field a future version might add
                  legs: [{ op: 'move', dir: 'down', dist: 16, color: 'red' }] // an unknown leg-level field
                }
              ]
            }
          ]
        }
      }
    }
  ];
  const normalized = normalizeProject(project);
  const route = normalized.maps[0].screens[0].entities[0].props.event.pages[0].commands[0];
  assert.equal(route.op, 'route');
  assert.equal(route.who, 'self');
  assert.equal(route.speed, undefined, 'an unknown field on the route must be dropped');
  assert.deepEqual(route.legs, [{ op: 'move', dir: 'down', dist: 16 }]);
  assert.equal(route.legs[0].color, undefined, 'an unknown field on a leg must be dropped');
  assert.equal(route.legs[0].who, undefined, 'a leg must never carry its own who');
});

// ------------------------------------------------------------ routeLegs

test('routeLegs: non-array input returns [], and the admitted set is exactly move/turn/wait', () => {
  assert.deepEqual(routeLegs(null), []);
  assert.deepEqual(routeLegs(undefined), []);
  assert.deepEqual(routeLegs('not an array'), []);
  assert.deepEqual(routeLegs(42), []);
  assert.deepEqual(
    routeLegs([{ op: 'move' }, { op: 'turn' }, { op: 'wait' }, { op: 'say' }, { op: 'branch' }, { op: 'route' }]).map(
      (leg) => leg.op
    ),
    ['move', 'turn', 'wait']
  );
  assert.deepEqual([...ROUTE_LEG_OPS].sort(), ['move', 'turn', 'wait']);
});

// -------------------------------------------------------- preview: routeTrace

test('routeTrace: no placement context (a common event) draws nothing, regardless of who', () => {
  const route = { op: 'route', who: 'self', legs: [{ op: 'move', dir: 'down', dist: 16 }] };
  const { caption, instructions } = routeTrace(route, undefined);
  assert.match(caption, /common event/i);
  assert.deepEqual(instructions, []);

  const playerRoute = { ...route, who: 'player' };
  const noPlaceStillNothing = routeTrace(playerRoute, undefined);
  assert.match(noPlaceStillNothing.caption, /common event/i);
  assert.deepEqual(noPlaceStillNothing.instructions, []);
});

test('routeTrace: placement present but who is player draws nothing, a different caption than the no-place case', () => {
  const route = { op: 'route', who: 'player', legs: [{ op: 'move', dir: 'down', dist: 16 }] };
  const { caption, instructions } = routeTrace(route, { screen: {}, x: 10, y: 10 });
  assert.match(caption, /player/i);
  assert.doesNotMatch(caption, /common event/i, 'the player caption must be textually distinct from the no-place caption');
  assert.deepEqual(instructions, []);
});

test('routeTrace: who is self with a place traces every live leg in order', () => {
  const route = {
    op: 'route',
    who: 'self',
    legs: [
      { op: 'move', dir: 'down', dist: 16 },
      { op: 'turn', dir: 'left' },
      { op: 'wait', frames: 20 }
    ]
  };
  const { caption, instructions } = routeTrace(route, { screen: {}, x: 100, y: 100 });
  assert.equal(caption, null);
  assert.deepEqual(instructions, [
    { kind: 'segment', from: { x: 100, y: 100 }, to: { x: 100, y: 116 } },
    { kind: 'facing', at: { x: 100, y: 116 }, dir: 'left' },
    { kind: 'pause', at: { x: 100, y: 116 }, frames: 20 }
  ]);
});

test('routeTrace: a zero-distance Move leg emits an explicit point instruction, not an invisible zero-length segment', () => {
  const route = { op: 'route', who: 'self', legs: [{ op: 'move', dir: 'down', dist: 0 }] };
  const { instructions } = routeTrace(route, { screen: {}, x: 50, y: 50 });
  assert.deepEqual(instructions, [{ kind: 'point', at: { x: 50, y: 50 } }]);
  assert.notDeepEqual(instructions, [{ kind: 'segment', from: { x: 50, y: 50 }, to: { x: 50, y: 50 } }]);
});

test('routeTrace: an off leg is skipped entirely and does not advance the walker', () => {
  const route = {
    op: 'route',
    who: 'self',
    legs: [
      { op: 'move', dir: 'down', dist: 16, off: true },
      { op: 'move', dir: 'right', dist: 8 }
    ]
  };
  const { instructions } = routeTrace(route, { screen: {}, x: 0, y: 0 });
  assert.deepEqual(instructions, [{ kind: 'segment', from: { x: 0, y: 0 }, to: { x: 8, y: 0 } }]);
});

test('routeTrace: an unadmitted leg neither renders nor advances the walker -- defense in depth against unfiltered input', () => {
  // routeTrace re-filters through routeLegs itself, independent of whatever
  // canonicalization the editor's own row render already did -- this calls
  // it directly with a raw, never-canonicalized legs array to prove that.
  const route = {
    op: 'route',
    who: 'self',
    legs: [{ op: 'move', dir: 'right', dist: 8 }, { op: 'say', text: 'illegal' }, { op: 'move', dir: 'right', dist: 8 }]
  };
  const { instructions } = routeTrace(route, { screen: {}, x: 0, y: 0 });
  assert.deepEqual(instructions, [
    { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 8, y: 0 } },
    { kind: 'segment', from: { x: 8, y: 0 }, to: { x: 16, y: 0 } }
  ]);
});

// ------------------------------------------------------ draw layer (drawRouteTrace)

/**
 * A fake 2d canvas context recording every call it receives, in order --
 * this file has no DOM under node:test, so this is the smallest thing that
 * can stand in for one and still let a test read back exactly what
 * drawRouteTrace asked it to draw.
 */
function fakeContext2d() {
  const calls = [];
  const record = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    strokeStyle: null,
    fillStyle: null,
    lineWidth: null,
    font: null,
    textAlign: null,
    textBaseline: null,
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    stroke: record('stroke'),
    fill: record('fill'),
    arc: record('arc'),
    fillText: record('fillText')
  };
}

test('drawRouteTrace: a facing instruction draws an arrowhead oriented by dir, not an undirected marker', () => {
  const rightCtx = fakeContext2d();
  drawRouteTrace(rightCtx, [{ kind: 'facing', at: { x: 10, y: 10 }, dir: 'right' }], 1);
  const leftCtx = fakeContext2d();
  drawRouteTrace(leftCtx, [{ kind: 'facing', at: { x: 10, y: 10 }, dir: 'left' }], 1);

  // Not an undirected outlined circle: a facing instruction must reach for
  // fill() (the arrowhead's own body) via at least one lineTo, with its
  // geometry actually depending on dir -- a right-facing and a left-facing
  // arrowhead from the identical position must draw different points.
  const rightLineTo = rightCtx.calls.find((call) => call.name === 'lineTo');
  const leftLineTo = leftCtx.calls.find((call) => call.name === 'lineTo');
  assert.ok(rightLineTo, 'a facing instruction must draw at least one line (the arrowhead body)');
  assert.ok(leftLineTo, 'a facing instruction must draw at least one line (the arrowhead body)');
  assert.notDeepEqual(
    rightCtx.calls.map((call) => call.args),
    leftCtx.calls.map((call) => call.args),
    'a right-facing and a left-facing arrowhead from the same position must draw different geometry'
  );
  assert.ok(
    rightCtx.calls.some((call) => call.name === 'fill'),
    'the arrowhead must be filled, not merely outlined -- an outlined circle is what round 1 shipped'
  );
});

test('drawRouteTrace: a pause instruction renders its own frame count, not just a generic marker', () => {
  const ctx = fakeContext2d();
  drawRouteTrace(ctx, [{ kind: 'pause', at: { x: 5, y: 5 }, frames: 42 }], 1);
  const text = ctx.calls.find((call) => call.name === 'fillText');
  assert.ok(text, 'a pause instruction must call fillText');
  assert.equal(text.args[0], '42', 'the drawn text must be the leg’s own frame count, not a placeholder');
});
