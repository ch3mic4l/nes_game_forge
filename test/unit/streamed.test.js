// Streamed worlds, phase 1 slice A: the world model, validation and the build
// refusal (docs/design-streamed-worlds.md §2, §3, §5). Every test names the
// wrong implementation it would catch.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { checkCapacity, generateAssets } from '../../main/build/generate.js';
import {
  createProject,
  createMap,
  normalizeProject,
  reconcileCartridge,
  validateProject,
  growOrShrinkMap,
  reorderMapsCore,
  LIMITS,
  CHOICE_LIMITS,
  mapGridLimit,
  streamedGridProblems,
  StreamedGridError
} from '../../shared/project.js';
import {
  MAPPERS,
  MIRRORING,
  mapperById,
  streamCapable,
  streamCapableFourScreen,
  streamCapableTwoNametable
} from '../../shared/cartridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = ['sample', 'sample-rpg', 'sample-mmc1', 'sample-mmc3', 'sample-u512', 'sample-rpg-mmc1'];

const project = (mapperId, mirroring) => {
  const p = createProject('Streamed');
  p.cartridge.mapper = mapperId;
  p.cartridge.mirroring = mirroring;
  return p;
};
const streamedProblems = (p) => validateProject(p).filter((x) => /stream/i.test(x.message));
// A streamed map of the given grid, screens filled in by normalize's own rules.
const gridMap = (p, w, h, streamed = true) => {
  const m = p.maps[0];
  m.gridW = w;
  m.gridH = h;
  m.screens = Array.from({ length: w * h }, () => structuredClone(m.screens[0]));
  if (streamed) m.streamed = true;
  return m;
};

// ---------------------------------------------------------------- capability

test('streamCapable*: keyed on mapper AND mirroring, every registry pair', () => {
  // A predicate keyed on mapper only would pass NROM/MMC1 but fail the
  // UNROM-512-vertical (two-nametable, not four-screen) and MMC1-anything-not-four-screen rows.
  for (const mapper of MAPPERS.filter((m) => m.supported)) {
    for (const mirroring of MIRRORING) {
      const four = mapper.id === 30 && mirroring.id === 'fourscreen';
      const two = [30, 1, 4].includes(mapper.id) && mirroring.id !== 'fourscreen';
      const label = `${mapper.name}/${mirroring.id}`;
      assert.equal(streamCapableFourScreen(mapper, mirroring.id), four, `four-screen ${label}`);
      assert.equal(streamCapableTwoNametable(mapper, mirroring.id), two, `two-nametable ${label}`);
      assert.equal(streamCapable(mapper, mirroring.id), four || two, `either ${label}`);
    }
  }
  // MMC1 has no four-screen wiring, so even the four-screen id must not make it capable of either.
  assert.equal(streamCapable(mapperById(1), 'fourscreen'), false);
  assert.equal(streamCapable(mapperById(0), 'vertical'), false);
});

// ---------------------------------------------------------------- normalize

test('an ordinary map never gains a streamed key, and the fixtures normalize without one', async () => {
  // A normalizer always emitting `streamed: false` would put a key on every map of every fixture.
  for (const name of FIXTURES) {
    const loaded = await loadProject(path.join(ROOT, name));
    const p = normalizeProject(loaded.project ?? loaded);
    for (const map of p.maps) assert.equal('streamed' in map, false, `${name}: ${map.name}`);
  }
  const p = createProject('x');
  assert.equal('streamed' in p.maps[0], false);
  assert.equal('streamed' in normalizeProject({ ...p, maps: [{ ...p.maps[0], streamed: false }] }).maps[0], false);
  // Content identity, not just key absence: an ordinary map normalizes identically with the key
  // absent, false or "yes", and keeps every uniquely named screen (wrong: a streamed-aware branch
  // that also rebuilt or re-clamped ordinary screens would drop or rename one).
  const named = { ...p.maps[0], gridW: 3, gridH: 2, screens: Array.from({ length: 6 }, (_, i) => ({ ...p.maps[0].screens[0], name: `S${i}` })) };
  const norm = (extra) => normalizeProject({ ...p, maps: [{ ...named, ...extra }] }).maps[0];
  assert.deepEqual(norm({ streamed: false }), norm({}));
  assert.deepEqual(norm({ streamed: 'yes' }), norm({}));
  assert.deepEqual(norm({}).screens.map((x) => x.name), ['S0', 'S1', 'S2', 'S3', 'S4', 'S5']);
  // Truthy-but-not-true is not streamed (a `Boolean(raw.streamed)` would accept "yes").
  assert.equal('streamed' in normalizeProject({ ...p, maps: [{ ...p.maps[0], streamed: 'yes' }] }).maps[0], false);
});

test('a streamed map keeps its own grid ceiling; an ordinary map still clamps to mapGrid', () => {
  const base = createProject('x');
  const raw = (extra) => ({ ...base, maps: [{ ...base.maps[0], ...extra }] });
  const big = normalizeProject(raw({ streamed: true, gridW: 20, gridH: 5 })).maps[0];
  assert.deepEqual([big.streamed, big.gridW, big.gridH, big.screens.length], [true, 20, 5, 100]);
  // A clamp that ignored `streamed` would leave 4 x 4.
  const flat = normalizeProject(raw({ gridW: 20, gridH: 5 })).maps[0];
  assert.deepEqual([flat.gridW, flat.gridH], [LIMITS.mapGrid, LIMITS.mapGrid]);
  // The per-axis 255 ceiling is a legal edge here; anything over it is refused, never clamped (below).
  const wide = normalizeProject(raw({ streamed: true, gridW: 255, gridH: 1 })).maps[0];
  assert.deepEqual([wide.gridW, wide.gridH, wide.screens.length], [255, 1, 255]);
  assert.equal(mapGridLimit(wide), 255);
  assert.equal(mapGridLimit(flat), LIMITS.mapGrid);
});

const named = (base, n) => Array.from({ length: n }, (_, i) => ({ ...structuredClone(base.screens[0]), name: `S${i}` }));
const rawStreamed = (p, extra) => ({ ...p, maps: [{ ...p.maps[0], streamed: true, ...extra }] });

test('an illegal streamed grid is refused, never trimmed, never allocated, and the input is untouched', () => {
  const p = project(30, 'fourscreen');
  const base = p.maps[0];
  const cases = {
    // Wrong implementation caught: clamping 256 -> 255 and silently dropping S255 (review 2 finding 1).
    '256x1 populated': { gridW: 256, gridH: 1, screens: named(base, 256) },
    // Wrong implementation caught: trimming 16x16 to 16x15 (round 1).
    '16x16 populated': { gridW: 16, gridH: 16, screens: named(base, 256) },
    // Wrong implementation caught: padding to 65,025 / retaining a sparse zero-screen map (finding 2).
    '255x255 empty': { gridW: 255, gridH: 255, screens: [] },
    '255x255 three': { gridW: 255, gridH: 255, screens: named(base, 3) },
    'axis over ceiling, one row': { gridW: 999, gridH: 1, screens: [] },
    'more screens than the grid': { gridW: 2, gridH: 1, screens: named(base, 5) },
    'zero axis': { gridW: 0, gridH: 3, screens: [] }
  };
  for (const [label, extra] of Object.entries(cases)) {
    const raw = rawStreamed(p, extra);
    const before = structuredClone(raw);
    const started = performance.now();
    assert.throws(() => normalizeProject(raw), (e) => e instanceof StreamedGridError && e.problems.length === 1 && /Map Forge|map JSON/.test(e.message) && e.message.includes(base.name), label);
    assert.ok(performance.now() - started < 200, `${label}: nothing large was built`);
    assert.deepEqual(raw, before, `${label}: input unmodified`);
  }
});

test('legal streamed grids normalize to full rectangular grids', () => {
  // Wrong implementation caught: an off-by-one ceiling (255 refused) or a product check that rejects 15x17.
  const p = project(30, 'fourscreen');
  const base = p.maps[0];
  for (const [w, h] of [[255, 1], [15, 17], [1, 255]]) {
    const m = normalizeProject(rawStreamed(p, { gridW: w, gridH: h, screens: named(base, w * h) })).maps[0];
    assert.deepEqual([m.gridW, m.gridH, m.screens.length], [w, h, w * h]);
    assert.ok(m.screens.every((s) => Array.isArray(s.metatiles) && s.name.startsWith('S')));
  }
  // Wrong implementation caught: a 1x1 that stays empty (the ordinary path pads).
  const one = normalizeProject(rawStreamed(p, { gridW: 1, gridH: 1, screens: [] })).maps[0];
  assert.equal(one.screens.length, 1);
  assert.ok(Array.isArray(one.screens[0].metatiles));
});

test('streamedGridProblems tolerates garbage and reads nothing it should not', () => {
  // Wrong implementation caught: a predicate that assumes maps is an array of objects with numeric axes.
  for (const raw of [undefined, null, 5, 'x', {}, { maps: 'no' }, { maps: [null, 7, 'a'] }, { maps: [{ streamed: true, gridW: 'big', gridH: {} }] }]) {
    assert.doesNotThrow(() => streamedGridProblems(raw));
  }
  assert.equal(streamedGridProblems({ maps: [{ streamed: true, gridW: 'big' }] }).length, 1);
  assert.equal(streamedGridProblems({ maps: [{ gridW: 999, gridH: 999 }] }).length, 0, 'an ordinary map is never its business');
  assert.equal(streamedGridProblems({ maps: [{ streamed: 'yes', gridW: 999 }] }).length, 0);
});

test('an ordinary oversized map still clamps exactly as before', () => {
  // Wrong implementation caught: the streamed refusal leaking into ordinary maps.
  const p = project(30, 'fourscreen');
  const m = normalizeProject({ ...p, maps: [{ ...p.maps[0], gridW: 999, gridH: 5, screens: named(p.maps[0], 30) }] }).maps[0];
  assert.deepEqual([m.gridW, m.gridH, m.screens.length], [LIMITS.mapGrid, LIMITS.mapGrid, 16]);
  assert.equal('streamed' in m, false);
});

test('load refuses an illegal streamed project with a plain message and leaves the files untouched', async () => {
  const p = project(30, 'fourscreen');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-illegal-'));
  const snapshot = () => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  try {
    await saveProject(dir, p);
    const file = path.join(dir, 'maps', fs.readdirSync(path.join(dir, 'maps')).sort()[0]);
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign(map, { streamed: true, gridW: 256, gridH: 1 });
    fs.writeFileSync(file, JSON.stringify(map));
    const before = snapshot();
    await assert.rejects(loadProject(dir), (e) => /at most 255/.test(e.message) && e.message.includes(p.maps[0].name));
    assert.deepEqual(snapshot(), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('save refuses an illegal streamed project: disk unchanged, no stray temp file', async () => {
  const p = project(30, 'fourscreen');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-illegal-save-'));
  const snapshot = () => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort().map((f) => [f, fs.statSync(path.join(dir, f)).isFile() ? fs.readFileSync(path.join(dir, f), 'utf8') : null]));
  try {
    await saveProject(dir, p);
    const before = snapshot();
    const bad = structuredClone(p);
    Object.assign(bad.maps[0], { streamed: true, gridW: 256, gridH: 1 });
    await assert.rejects(saveProject(dir, bad), StreamedGridError);
    assert.deepEqual(snapshot(), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('growOrShrinkMap refuses a streamed resize outside the limits before touching anything', () => {
  // Wrong implementation caught: a core with no streamed guard (the store does not roll back a throw).
  const p = project(30, 'fourscreen');
  p.maps[0].streamed = true;
  const n = normalizeProject(p);
  for (const [w, h] of [[256, 1], [16, 16], [0, 1]]) {
    const before = structuredClone(n);
    assert.equal(growOrShrinkMap(n, 0, w, h), null, `${w}x${h}`);
    assert.deepEqual(n, before);
  }
  const ok = growOrShrinkMap(n, 0, 255, 1);
  assert.ok(ok);
  assert.deepEqual([n.maps[0].gridW, n.maps[0].screens.length], [255, 255]);
  assert.ok(n.maps[0].screens.every(Boolean));
});

test('startScreen and titleScreen survive on a streamed map; on an ordinary map they still clamp', () => {
  const base = createProject('x');
  const mk = (streamed) => ({
    ...base,
    project: { ...base.project, startScreen: 99, titleMap: 0, titleScreen: 90 },
    maps: [{ ...base.maps[0], gridW: 20, gridH: 5, streamed }]
  });
  const s = normalizeProject(mk(true));
  assert.deepEqual([s.project.startScreen, s.project.titleScreen], [99, 90]);
  // Ordinary: the early clamp to 4 x 4 - 1 = 15 is unchanged. A re-clamp that ignored `streamed`
  // would keep 99 / 90 here instead.
  const o = normalizeProject(mk(false));
  assert.deepEqual([o.project.startScreen, o.project.titleScreen], [15, 15]);
  // Index 254 on a 255-screen map survives (wrong: a cap of 100/200 or of 254 exclusive), 255 clamps
  // to 254, and an index past the map's own length falls back to 0 (wrong: no boundary fallback).
  const at = (screen, w) => normalizeProject({
    ...base,
    project: { ...base.project, startScreen: screen, titleMap: 0, titleScreen: screen },
    maps: [{ ...base.maps[0], gridW: w, gridH: 1, streamed: true }]
  }).project;
  assert.deepEqual([at(254, 255).startScreen, at(254, 255).titleScreen], [254, 254]);
  assert.equal(at(255, 255).startScreen, 254);
  assert.deepEqual([at(254, 2).startScreen, at(254, 2).titleScreen], [0, 0]);
});

// ---------------------------------------------------------------- validateProject

test('gating: an unsupported board or mirroring is refused, naming the Build panel', () => {
  // A check keyed on "is the flag set" alone would return nothing for NROM.
  for (const [mapperId, mirroring] of [[0, 'vertical'], [2, 'horizontal'], [3, 'vertical']]) {
    const p = project(mapperId, mirroring);
    p.maps[0].streamed = true;
    const found = streamedProblems(p);
    assert.equal(found.length, 1, `mapper ${mapperId}`);
    assert.equal(found[0].severity, 'error');
    assert.equal(found[0].where, 'Build');
    assert.match(found[0].message, /cannot stream a world/);
  }
  // Raw, un-reconciled MMC1 + four-screen (no such wiring): refused through validateProject itself,
  // not just the predicate (wrong: validation that never called streamCapable for this pair).
  const raw = project(1, 'fourscreen');
  raw.maps[0].streamed = true;
  assert.equal(streamedProblems(raw).filter((x) => /cannot stream a world/.test(x.message)).length, 1);
  // UNROM 512 vertical is capable (two-nametable); a mapper-only gate for four-screen would refuse it.
  const u = project(30, 'vertical');
  u.maps[0].streamed = true;
  assert.deepEqual(streamedProblems(u), []);
  for (const [mapperId, mirroring] of [[30, 'fourscreen'], [1, 'horizontal'], [4, 'vertical']]) {
    const p = project(mapperId, mirroring);
    p.maps[0].streamed = true;
    assert.deepEqual(streamedProblems(p), [], `${mapperId}/${mirroring}`);
  }
});

test('an ordinary map on an incapable board raises no streamed problem at all', () => {
  const p = project(0, 'vertical');
  assert.deepEqual(streamedProblems(p), []);
});

test('grid ceiling: 255 screens legal, 256 refused, project-wide total counted', () => {
  const p = project(30, 'fourscreen');
  gridMap(p, 15, 17); // 255
  assert.deepEqual(streamedProblems(p), []);
  gridMap(p, 16, 16); // 256: `>=` instead of `>` would also refuse 255 above
  const over = streamedProblems(p);
  assert.equal(over.length, 2, 'the map and the project-wide total both name it');
  assert.ok(over.every((x) => x.severity === 'error' && x.where === 'Map Forge'));
  // A single axis past 255 is refused even where the product test is skipped by a stale check.
  const q = project(30, 'fourscreen');
  const m = gridMap(q, 1, 1);
  m.gridW = 300;
  assert.ok(streamedProblems(q).some((x) => /at most 255/.test(x.message)));
  // Zero, negative and fractional axes are refused even where the product is small (wrong: a check
  // that only compared the product to 255).
  for (const [w, h] of [[0, 5], [-3, -3], [2.5, 2], [5, 0.5]]) {
    const z = project(30, 'fourscreen');
    const zm = gridMap(z, 1, 1);
    zm.gridW = w;
    zm.gridH = h;
    assert.ok(streamedProblems(z).some((x) => x.where === 'Map Forge' && /at most 255/.test(x.message)), `${w} x ${h}`);
  }
  // Total across maps: an ordinary second map counts too.
  const t = project(30, 'fourscreen');
  gridMap(t, 15, 16); // 240
  const extra = createMap(1, 'Extra');
  extra.gridW = 4;
  extra.gridH = 4;
  extra.screens = Array.from({ length: 16 }, () => structuredClone(t.maps[0].screens[0]));
  t.maps.push(extra); // 256 in total
  assert.ok(streamedProblems(t).some((x) => /256 screens/.test(x.message)));
});

test('the 255 total is only asserted when a streamed map exists (ROM-neutral off)', () => {
  const p = project(30, 'fourscreen');
  const m = p.maps[0];
  m.gridW = 4;
  m.gridH = 4;
  m.screens = Array.from({ length: 16 }, () => structuredClone(m.screens[0]));
  for (let i = 1; i < 17; i++) p.maps.push({ ...structuredClone(m), id: i, name: `M${i}` }); // 272 screens, none streamed
  assert.deepEqual(streamedProblems(p), []);
});

test('two-nametable: the dead axis holds one screen, per mirroring, from cameraAxes', () => {
  // Vertical mirroring scrolls sideways => the map may be N x 1 only; horizontal => 1 x N only.
  // A rule that just said "not both > 1" would pass N x 1 under horizontal mirroring.
  for (const mapperId of [1, 4, 30]) {
    const v = project(mapperId, 'vertical');
    gridMap(v, 6, 1);
    assert.deepEqual(streamedProblems(v), [], `${mapperId} vertical N x 1`);
    gridMap(v, 1, 6);
    assert.match(streamedProblems(v).map((x) => x.message).join('|'), /1 screen tall \(N x 1\)/);
    gridMap(v, 3, 3);
    assert.equal(streamedProblems(v).length, 1);

    const h = project(mapperId, 'horizontal');
    gridMap(h, 1, 6);
    assert.deepEqual(streamedProblems(h), [], `${mapperId} horizontal 1 x N`);
    gridMap(h, 6, 1);
    assert.match(streamedProblems(h).map((x) => x.message).join('|'), /1 screen wide \(1 x N\)/);
  }
  // Four-screen has no dead axis: 5 x 5 is fine.
  const f = project(30, 'fourscreen');
  gridMap(f, 5, 5);
  assert.deepEqual(streamedProblems(f), []);
});

test('the dead-axis rule looks at every streamed map, not just the first', () => {
  // Wrong implementation caught: inspecting maps[0] only.
  const p = project(1, 'vertical');
  p.maps.push(createMap(1, 'Second'));
  p.maps[0].streamed = true; // 1 x 1, fine
  const second = p.maps[1];
  second.gridW = 1;
  second.gridH = 5;
  second.screens = Array.from({ length: 5 }, () => structuredClone(second.screens[0]));
  second.streamed = true;
  const found = streamedProblems(p);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /Map "Second"/);
});

test('the dead-axis rule is not stacked on top of an incapable board', () => {
  // NROM/3x3 must report the board once, not also a shape error the board could never have used.
  const p = project(0, 'vertical');
  gridMap(p, 3, 3);
  assert.equal(streamedProblems(p).length, 1);
});

// ---------------------------------------------------------------- the Move warning

const withEvent = (p, commands, { streamed = true, place = true } = {}) => {
  const m = gridMap(p, 1, 1, streamed);
  const actor = p.sprites.actors.find((a) => a.behavior !== 'player') ?? p.sprites.actors[0];
  if (place) {
    m.screens[0].entities = [
      { actorId: actor ? actor.id : 0, x: 32, y: 32, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
  }
  return m;
};
const moveWarnings = (p) => validateProject(p).filter((x) => x.severity === 'warning' && /moves the player/.test(x.message));
const mv = (extra = {}) => ({ op: 'move', who: 'player', dir: 'right', dist: 40, ...extra });

test('Move warning: a player Move on a streamed map warns; the same on an ordinary map does not', () => {
  const s = project(30, 'fourscreen');
  withEvent(s, [mv()]);
  const w = moveWarnings(s);
  assert.equal(w.length, 1);
  assert.equal(w[0].where, 'Map Forge');
  // A rule forgetting to scope to streamed maps would warn here too.
  const o = project(30, 'fourscreen');
  withEvent(o, [mv()], { streamed: false });
  assert.deepEqual(moveWarnings(o), []);
});

test('Move warning: any positive distance, in every direction, warns', () => {
  // Wrong implementation caught: a threshold (dist >= 20/40) or a rightward-only test.
  for (const dir of ['left', 'right', 'up', 'down']) {
    const p = project(30, 'fourscreen');
    withEvent(p, [mv({ dir, dist: 1 })]);
    assert.equal(moveWarnings(p).length, 1, dir);
    const r = project(30, 'fourscreen');
    withEvent(r, [{ op: 'route', who: 'player', legs: [{ op: 'move', dir, dist: 1 }] }]);
    assert.equal(moveWarnings(r).length, 1, `route ${dir}`);
  }
});

test('Move warning: found on a map that is not the first, and only the middle of three is streamed', () => {
  // Wrong implementation caught: scanning maps[0] only, or the last map only.
  const p = project(30, 'fourscreen');
  p.maps.push(createMap(1, 'Middle'), createMap(2, 'Last'));
  const mid = p.maps[1];
  mid.streamed = true;
  const actor = p.sprites.actors[0];
  mid.screens[0].entities = [{ actorId: actor ? actor.id : 0, x: 32, y: 32, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [mv()] }] } } }];
  const w = moveWarnings(p);
  assert.equal(w.length, 1);
  assert.match(w[0].message, /"Middle"/);
  // The same event on the ordinary first map of the same project stays silent.
  p.maps[0].screens[0].entities = structuredClone(mid.screens[0].entities);
  assert.equal(moveWarnings(p).length, 1);
  // Refusal and validation both find the middle map (wrong: inspecting only first/last).
  const q = project(0, 'vertical');
  q.maps.push(createMap(1, 'Middle'), createMap(2, 'Last'));
  q.maps[1].streamed = true;
  const found = streamedProblems(q);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /"Middle"/);
  const built = project(30, 'fourscreen');
  built.maps.push(createMap(1, 'Middle'), createMap(2, 'Last'));
  built.maps[1].streamed = true;
  const refused = checkCapacity(built).problems.filter((x) => /no engine yet/.test(x.message));
  assert.equal(refused.length, 1);
  assert.match(refused[0].message, /"Middle"/);
});

test('Move warning: a leg under a disabled ancestor, or in a choice option past the limit, is not reachable', () => {
  // Wrong implementation caught: finding routes through allCommands alone, which sees everything
  // mentioned rather than everything compiled.
  const leg = { op: 'route', who: 'player', legs: [{ op: 'move', dir: 'right', dist: 1 }] };
  const wait = { op: 'wait', frames: 10 };
  const cases = {
    'route under a disabled branch': [wait, { op: 'branch', off: true, cond: { type: 'none', arg: 0 }, then: [leg], else: [] }],
    'route in a disabled else': [wait, { op: 'branch', cond: { type: 'none', arg: 0 }, then: [], else: [{ ...leg, off: true }] }],
    'route past the option limit': [{
      op: 'choice',
      prompt: '',
      options: [
        ...Array.from({ length: CHOICE_LIMITS.options }, (_, i) => ({ label: `o${i}`, commands: [wait] })),
        { label: 'late', commands: [leg] }
      ]
    }]
  };
  for (const [label, commands] of Object.entries(cases)) {
    const p = project(30, 'fourscreen');
    withEvent(p, commands);
    assert.equal(moveWarnings(p).length, 0, label);
  }
  // Positive control: the same route under a live branch warns.
  const live = project(30, 'fourscreen');
  withEvent(live, [wait, { op: 'branch', cond: { type: 'none', arg: 0 }, then: [leg], else: [] }]);
  assert.equal(moveWarnings(live).length, 1);
});

test('Move warning: who, distance and liveness are honoured', () => {
  const cases = [
    ['an NPC (self) Move', [mv({ who: 'self' })], 0],
    ['a zero-distance Move', [mv({ dist: 0 })], 0],
    ['a switched-off Move', [mv({ off: true })], 0],
    ['a Move inside a live branch', [{ op: 'branch', cond: { type: 'none', arg: 0 }, then: [mv()], else: [] }], 1],
    ['a Move inside a choice option', [{ op: 'choice', prompt: '', options: [{ label: 'a', commands: [mv()] }] }], 1]
  ];
  for (const [label, commands, expected] of cases) {
    const p = project(30, 'fourscreen');
    withEvent(p, commands);
    assert.equal(moveWarnings(p).length, expected, label);
  }
});

test('Move warning: a route leg moving the player, and a call into a common event, both count', () => {
  // A walk over top-level commands only (or over liveCommands alone, which drops a route's own `who`)
  // misses both.
  const route = project(30, 'fourscreen');
  withEvent(route, [{ op: 'route', who: 'player', legs: [{ op: 'move', dir: 'left', dist: 20 }] }]);
  assert.equal(moveWarnings(route).length, 1);
  const npcRoute = project(30, 'fourscreen');
  withEvent(npcRoute, [{ op: 'route', who: 'self', legs: [{ op: 'move', dir: 'left', dist: 20 }] }]);
  assert.equal(moveWarnings(npcRoute).length, 0);

  const call = project(30, 'fourscreen');
  call.commonEvents = [
    { id: 3, name: 'Push', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [mv()] }] } }
  ];
  call.commonEventSeq = 4;
  withEvent(call, [{ op: 'call', event: 3 }]);
  assert.equal(moveWarnings(call).length, 1);
  // A two-hop call chain ending in a player Move (wrong: following one hop only).
  const hop = project(30, 'fourscreen');
  hop.commonEvents = [
    { id: 3, name: 'A', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 4 }] }] } },
    { id: 4, name: 'B', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [mv({ dist: 1 })] }] } }
  ];
  hop.commonEventSeq = 5;
  withEvent(hop, [{ op: 'call', event: 3 }]);
  assert.equal(moveWarnings(hop).length, 1);
  // A common event nobody on a streamed map calls does not warn on its own.
  const idle = project(30, 'fourscreen');
  idle.commonEvents = call.commonEvents;
  idle.commonEventSeq = 4;
  withEvent(idle, [{ op: 'end' }]);
  assert.equal(moveWarnings(idle).length, 0);
  // A self-calling common event terminates.
  const loop = project(30, 'fourscreen');
  loop.commonEvents = [{ id: 3, name: 'Loop', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 3 }] }] } }];
  loop.commonEventSeq = 4;
  withEvent(loop, [{ op: 'call', event: 3 }]);
  assert.equal(moveWarnings(loop).length, 0);
});

// ---------------------------------------------------------------- save identity

test('saveCompatToken: a streamed map\'s structural edits redraw it; the flag alone does not', () => {
  const p = project(30, 'fourscreen');
  p.maps.push(createMap(1, 'Second'));
  p.maps[0].streamed = true;
  assert.equal(p.project.saveCompatToken, 0);
  // Toggling the flag through a real operation (normalize, which is what every save runs) leaves an
  // existing nonzero token alone (§3, "Save identity"). Wrong implementations: normalize redrawing
  // the token when the flag differs, or zeroing it.
  p.project.saveCompatToken = 7;
  for (const flag of [false, true]) {
    const q = structuredClone(p);
    q.maps[0].streamed = flag;
    assert.equal(normalizeProject(q).project.saveCompatToken, 7, `streamed=${flag}`);
  }
  p.project.saveCompatToken = 0;
  growOrShrinkMap(p, 0, 12, 1);
  assert.notEqual(p.project.saveCompatToken, 0, 'resizing a streamed map redraws');
  p.project.saveCompatToken = 0;
  reorderMapsCore(p, [1, 0]);
  assert.notEqual(p.project.saveCompatToken, 0, 'reordering maps redraws');
  // Growing past the ordinary cap is how a streamed map actually gets big.
  assert.equal(p.maps.find((m) => m.streamed).gridW, 12);
});

test('reconcileCartridge leaves a streamed map alone and the problem stands for the Build panel', () => {
  // Deliberately no automatic fix: no board is "the" streaming board, so unlike the RPG gate
  // there is nothing to raise the mapper to.
  const p = project(30, 'fourscreen');
  // Wrong implementation caught: reconcile keeping the flag but dropping/resizing authored screens.
  const base = p.maps[0];
  base.gridW = 6;
  base.gridH = 1;
  base.screens = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(base.screens[0]), name: `R${i}` }));
  base.streamed = true;
  p.cartridge.mapper = 0;
  reconcileCartridge(p);
  assert.equal(p.maps[0].streamed, true);
  assert.deepEqual([p.maps[0].gridW, p.maps[0].gridH], [6, 1]);
  assert.deepEqual(p.maps[0].screens.map((x) => x.name), ['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
  assert.equal(streamedProblems(p).length, 1);
});

// ---------------------------------------------------------------- the build refusal

test('build refusal: a streamed map is refused before the assembler, an ordinary one is not', async () => {
  const p = project(30, 'fourscreen');
  p.maps[0].streamed = true;
  const refused = checkCapacity(p).problems.filter((x) => /no engine yet/.test(x.message));
  assert.equal(refused.length, 1);
  assert.equal(refused[0].severity, 'error');
  assert.equal(refused[0].where, 'Map Forge');
  // Finding 4: no instruction to use a Map Forge control that does not exist; it names the JSON flag.
  assert.doesNotMatch(refused[0].message, /Turn Streamed off|in the Map Forge/);
  assert.match(refused[0].message, /"streamed": true/);
  const bad = project(0, 'vertical');
  bad.maps[0].streamed = true;
  const gate = streamedProblems(bad);
  assert.doesNotMatch(gate[0].message, /Turn Streamed off/);
  assert.match(gate[0].message, /map JSON/);
  // The refusal is a build-time problem, not a validateProject one: the editor's own problem list
  // is not the place for a limitation phase 2 removes.
  assert.equal(validateProject(p).filter((x) => /no engine yet/.test(x.message)).length, 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamed-'));
  try {
    await assert.rejects(generateAssets({ dir, project: p }), /streamed maps have no engine yet/);
    assert.equal(fs.existsSync(path.join(dir, 'build', 'game.nes')), false);
    p.maps[0].streamed = false;
    assert.equal(checkCapacity(p).problems.filter((x) => /no engine yet/.test(x.message)).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build refusal: a valid-board streamed map with a mixed project still refuses (any streamed map)', () => {
  const p = project(1, 'vertical');
  p.maps.push(createMap(1, 'Streamed one'));
  p.maps[1].streamed = true;
  assert.equal(checkCapacity(p).problems.filter((x) => /no engine yet/.test(x.message)).length, 1);
});
