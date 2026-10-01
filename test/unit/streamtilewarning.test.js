// Phase 3a slice S1 (plan section 5.5, T10/T11): the streamed-screen tile-bound warning and the Code
// Forge sentence. Every test names the wrong implementation it would catch.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  createMap,
  createScreen,
  validateProject,
  streamTiles,
  describeStreamTileWarning,
  streamTileBoundFor,
  projectUsesBoundTiles,
  NO_ANIM
} from '../../shared/project.js';
import { STREAM_TILE_BOUND, STREAM_TILE_BOUND_WITH_BOUND_TILES } from '../../shared/streambound.js';
import { checkCapacity, STREAMED_BOUNDS_CODE_SENTENCE } from '../../main/build/generate.js';

const tiles = (n) => Array.from({ length: n }, (_, i) => ({ x: (i % 2) * 8, y: (i >> 1) * 8, tile: 1, attr: 0, flipH: false, flipV: false }));

// One actor per entry in `sizes`: each with a single down-walk animation whose frames are the given
// metasprite tile counts (so "the largest frame not first" is expressible).
function build({ streamed = true, placements, frames, noAnim = false } = {}) {
  const p = createProject('Bound');
  p.maps = [];
  const map = createMap(0, 'M');
  map.gridW = 1;
  map.gridH = 1;
  map.screens = [createScreen()];
  if (streamed) map.streamed = true;
  p.maps.push(map);
  p.sprites.metasprites = [];
  p.sprites.animations = [];
  p.sprites.actors = [];
  frames.forEach((counts, a) => {
    const ids = counts.map((c) => {
      p.sprites.metasprites.push({ id: p.sprites.metasprites.length, name: `m${p.sprites.metasprites.length}`, tiles: tiles(c) });
      return p.sprites.metasprites.length - 1;
    });
    p.sprites.animations.push({ id: a, name: `a${a}`, frames: ids.map((metaspriteId) => ({ metaspriteId, duration: 4 })), loop: true });
    p.sprites.actors.push({ id: a, name: `actor${a}`, anims: { idle: noAnim ? NO_ANIM : a } });
  });
  map.screens[0].entities = placements.map((actorId, i) => ({ actorId, x: 2 + i, y: 2, props: {} }));
  return p;
}
const warnings = (p) =>
  validateProject(p)
    .filter((f) => f.severity === 'warning' && /sprite tiles/.test(f.message) && /streamed screens are supported/.test(f.message))
    .map((f) => f.message);

test('bound: exactly B tiles is silent, B+1 warns (an off-by-one > vs >= is caught)', () => {
  const B = STREAM_TILE_BOUND;
  assert.ok(B >= 1, 'STREAM_TILE_BOUND is a measured figure, not the 0 placeholder');
  assert.deepEqual(warnings(build({ frames: [[B]], placements: [0] })), []);
  assert.equal(warnings(build({ frames: [[B + 1]], placements: [0] })).length, 1);
});

test('text: N is the recomputed figure and B the bound, both in the message', () => {
  const B = STREAM_TILE_BOUND;
  const p = build({ frames: [[B + 3]], placements: [0] });
  const [w] = warnings(p);
  assert.match(w, new RegExp(`up to ${B + 3} sprite tiles`));
  assert.match(w, new RegExp(`supported up to ${B}\\.`));
  assert.equal(streamTiles(p, p.maps[0].screens[0]), B + 3);
});

test('zero-frame fallback: an animation with no frames counts metasprite 0, not 0 tiles', () => {
  // Wrong implementation: authored frames only (maxTiles over frames[], 0 for none). The engine draws
  // metasprite 0 (12 tiles here) for a zero-frame animation.
  const B = STREAM_TILE_BOUND;
  const p = build({ frames: [[B + 1]], placements: [0] });
  p.sprites.animations[0].frames = [];
  const s = p.maps[0].screens[0];
  assert.equal(streamTiles(p, s), B + 1, 'metasprite 0 is the pose drawn');
  const [w] = warnings(p);
  assert.match(w, new RegExp(`up to ${B + 1} sprite tiles`));
  // The fallback beats a smaller authored frame elsewhere: metasprite 0 has 12, the frame has 3.
  const q = build({ frames: [[12], [3]], placements: [0, 1] });
  q.sprites.animations[0].frames = [];
  assert.equal(streamTiles(q, q.maps[0].screens[0]), 12 + 3);
});

test('NO_ANIM, missing animation and an empty metasprite table contribute 0 without a crash', () => {
  const noAnim = build({ frames: [[5]], placements: [0], noAnim: true });
  assert.equal(streamTiles(noAnim, noAnim.maps[0].screens[0]), 0);
  const dangling = build({ frames: [[5]], placements: [0] });
  dangling.sprites.actors[0].anims.idle = 9; // no such animation
  assert.equal(streamTiles(dangling, dangling.maps[0].screens[0]), 0);
  const none = build({ frames: [[5]], placements: [0] });
  none.sprites.animations[0].frames = [];
  none.sprites.metasprites = [];
  assert.equal(streamTiles(none, none.maps[0].screens[0]), 0);
  assert.deepEqual(warnings(noAnim), []);
  assert.deepEqual(warnings(dangling), []);
  assert.deepEqual(warnings(none), []);
});

test('an ordinary map with the same actors never warns (the bound is a streamed-screen claim)', () => {
  assert.deepEqual(warnings(build({ streamed: false, frames: [[STREAM_TILE_BOUND + 5]], placements: [0] })), []);
});

test('a hideSwitch-guarded placement still counts; the largest frame need not be first', () => {
  const B = STREAM_TILE_BOUND;
  const p = build({ frames: [[1, B + 1, 2]], placements: [0] });
  p.maps[0].screens[0].entities[0].props = { hideSwitch: 0 };
  assert.equal(streamTiles(p, p.maps[0].screens[0]), B + 1);
  assert.equal(warnings(p).length, 1);
});

test('two offending screens give two warnings, each naming its own figure', () => {
  const B = STREAM_TILE_BOUND;
  const p = build({ frames: [[B + 1]], placements: [0] });
  const map = p.maps[0];
  map.gridW = 2;
  const second = createScreen();
  second.entities = [{ actorId: 0, x: 3, y: 3, props: {} }, { actorId: 0, x: 5, y: 3, props: {} }];
  map.screens.push(second);
  const w = warnings(p);
  assert.equal(w.length, 2);
  assert.ok(w.some((m) => m.includes(`up to ${B + 1} sprite tiles`)));
  assert.ok(w.some((m) => m.includes(`up to ${2 * (B + 1)} sprite tiles`)));
});

test('describeStreamTileWarning states N and B it is given', () => {
  const p = build({ frames: [[1]], placements: [0] });
  const m = describeStreamTileWarning(p, 0, 0, 40, 16);
  assert.match(m, /up to 40 sprite tiles/);
  assert.match(m, /supported up to 16\./);
  assert.doesNotMatch(m, /switch-bound/, 'a bound that is not lowered says nothing about bound tiles');
});

// ---- the second threshold: a project with a switch-bound tile is held to the lower figure -----------------------
const withBoundTile = (p) => {
  p.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 2 }];
  return p;
};

test('the two bounds: the margin policy puts the bound-tile figure below the plain one, and both are what the curve certified minus one', () => {
  assert.equal(STREAM_TILE_BOUND, 15);
  assert.equal(STREAM_TILE_BOUND_WITH_BOUND_TILES, 14);
  assert.ok(STREAM_TILE_BOUND_WITH_BOUND_TILES < STREAM_TILE_BOUND);
});

test('streamTileBoundFor follows projectUsesBoundTiles, the predicate that drives BOUND_TILE_ENABLED', () => {
  const plain = build({ frames: [[1]], placements: [0] });
  const bound = withBoundTile(build({ frames: [[1]], placements: [0] }));
  assert.equal(projectUsesBoundTiles(plain), false);
  assert.equal(projectUsesBoundTiles(bound), true);
  assert.equal(streamTileBoundFor(plain), STREAM_TILE_BOUND);
  assert.equal(streamTileBoundFor(bound), STREAM_TILE_BOUND_WITH_BOUND_TILES);
  // the bound tile may sit on an ORDINARY screen of another map: the figure is project-wide, as BOUND_TILE_ENABLED is
  const elsewhere = build({ frames: [[1]], placements: [0] });
  const ordinary = createMap(1, 'Ordinary');
  ordinary.gridW = 1;
  ordinary.gridH = 1;
  ordinary.screens = [createScreen()];
  ordinary.screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 2 }];
  elsewhere.maps.push(ordinary);
  assert.equal(streamTileBoundFor(elsewhere), STREAM_TILE_BOUND_WITH_BOUND_TILES);
});

test('with a bound tile: exactly the lower bound is silent, one above warns, and the plain bound itself already warns', () => {
  const lo = STREAM_TILE_BOUND_WITH_BOUND_TILES;
  assert.deepEqual(warnings(withBoundTile(build({ frames: [[lo]], placements: [0] }))), []);
  assert.equal(warnings(withBoundTile(build({ frames: [[lo + 1]], placements: [0] }))).length, 1);
  // the same population without a bound tile is silent: a warning that ignored the project would not tell these apart
  assert.deepEqual(warnings(build({ frames: [[STREAM_TILE_BOUND]], placements: [0] })), []);
  assert.equal(warnings(withBoundTile(build({ frames: [[STREAM_TILE_BOUND]], placements: [0] }))).length, 1);
});

test('with a bound tile the text names the lowered figure and says why; without one it does not', () => {
  const lo = STREAM_TILE_BOUND_WITH_BOUND_TILES;
  const [w] = warnings(withBoundTile(build({ frames: [[lo + 1]], placements: [0] })));
  assert.match(w, new RegExp(`supported up to ${lo} \\(`));
  assert.match(w, new RegExp(`usual limit is ${STREAM_TILE_BOUND}`));
  assert.match(w, /switch-bound tiles/);
  const [plain] = warnings(build({ frames: [[STREAM_TILE_BOUND + 1]], placements: [0] }));
  assert.match(plain, new RegExp(`supported up to ${STREAM_TILE_BOUND}\\. `));
  assert.doesNotMatch(plain, /switch-bound/);
});

// ---- T11: the Code Forge sentence -----------------------------------------------------------------

const codeWarning = (p) => checkCapacity(p).problems.filter((f) => /hand-written engine code/.test(f.message));
const withCode = (p) => {
  p.code = { overrides: [], files: [{ name: 'x.asm', text: '; nothing\n' }] };
  return p;
};
// A project that streams AND places an actor (so projectUsesStreamedActors holds).
const streamedActors = () => build({ frames: [[2]], placements: [0] });

test('Code Forge sentence: present iff the project carries code AND streams actors', () => {
  const a = streamedActors();
  assert.equal(codeWarning(a).length, 0, 'streamed actors, no code: no code warning at all');
  const both = codeWarning(withCode(streamedActors()));
  assert.equal(both.length, 1);
  assert.ok(both[0].message.includes(STREAMED_BOUNDS_CODE_SENTENCE), 'code + streamed actors: sentence present');
  const ordinary = codeWarning(withCode(build({ streamed: false, frames: [[2]], placements: [0] })));
  assert.equal(ordinary.length, 1);
  assert.ok(!ordinary[0].message.includes(STREAMED_BOUNDS_CODE_SENTENCE), 'code, no streamed actors: absent');
  const emptyStreamed = withCode(build({ frames: [[2]], placements: [] }));
  assert.ok(!codeWarning(emptyStreamed)[0].message.includes(STREAMED_BOUNDS_CODE_SENTENCE), 'streamed map without actors: absent');
});

// The mover-speed note (phase 3a slice S1 (a1)): one predicate in shared/, so the editor and the engine's STREAMING_ENABLED gate cannot disagree.
test('moverSpeedNote: shown for patrollers and chasers exactly when the project has a streamed map, on any map', async () => {
  const { moverSpeedNote, STREAM_MOVER_SPEED_NOTE, projectUsesStreaming } = await import('../../shared/streamlayout.js');
  const { createProject } = await import('../../shared/project.js');
  const p = createProject('t');
  const patrol = { behavior: 'patroller' };
  const chase = { behavior: 'chaser' };
  assert.equal(projectUsesStreaming(p), false);
  assert.equal(moverSpeedNote(p, patrol), null, 'no streamed map: no note');
  p.maps[0].streamed = true;
  assert.equal(moverSpeedNote(p, patrol), STREAM_MOVER_SPEED_NOTE);
  assert.equal(moverSpeedNote(p, chase), STREAM_MOVER_SPEED_NOTE);
  assert.equal(STREAM_MOVER_SPEED_NOTE, 'Movers run at half speed in projects with a streamed map');
  for (const behavior of ['npc', 'pickup', 'door', 'player']) assert.equal(moverSpeedNote(p, { behavior }), null, behavior);
  assert.equal(moverSpeedNote(p, undefined), null);
  assert.equal(moverSpeedNote({ ...p, maps: [{ streamed: false }] }, patrol), null, 'a non-streamed project is silent');
});
