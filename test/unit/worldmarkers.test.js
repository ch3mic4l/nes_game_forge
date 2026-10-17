// Map Forge World view (ROADMAP item 7, build commit C1): the markers the project itself names -- where the player starts and
// which screen is the title screen -- in renderer/forges/map/worldmarkers.js. (The next commit adds doors, warps and events to the
// same module; M2-M6 of docs/design-world-overview.md section 7 land with them.) Each test states, in its first comment line, the
// wrong implementation it exists to catch.
//
//   M1 start and title   M7 read-only, the fixtures

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, createMap, createScreen, flatScreens } from '../../shared/project.js';
import { loadProject } from '../../main/project-io.js';
import { buildWorldMarkers } from '../../renderer/forges/map/worldmarkers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(here, '../../sample');
const SAMPLE_RPG = path.join(here, '../../sample-rpg');

/** A project of maps with the given screen counts (1 x n columns): flat indices run 0.. through them in map order. */
function worldOf(...counts) {
  const project = createProject('World');
  project.maps = counts.map((count, i) => {
    const map = createMap(`Map ${i}`);
    map.name = `Map ${i}`;
    map.gridW = count;
    map.gridH = 1;
    map.screens = Array.from({ length: count }, () => createScreen());
    return map;
  });
  project.project.startMap = 0;
  project.project.startScreen = 0;
  project.project.titleMap = null;
  project.project.titleScreen = 0;
  return project;
}

test('M1: the start marker is on the flat index of startMap / startScreen, at startX / startY, not swapped and not a flat index of its own', () => {
  // wrong: startScreen read as a flat index; x and y swapped; map-space and flat-space mixed
  const project = worldOf(4, 3, 2);
  Object.assign(project.project, { startMap: 1, startScreen: 2, startX: 48, startY: 80 });
  const { start, markers } = buildWorldMarkers(project);
  assert.equal(start.kind, 'start');
  assert.equal(start.flat, 4 + 2, 'map 1 begins at flat 4, so its screen 2 is flat 6');
  assert.deepEqual([start.mapIndex, start.screenIndex], [1, 2]);
  assert.deepEqual([start.x, start.y], [48, 80]);
  assert.equal(start.entityIndex, null);
  assert.equal(start.title, 'Start — Map 1 · screen 2, at 48,80');
  assert.deepEqual(markers, [start]);
  // and the same answer from the project's own flat order, which the compiler numbers screens by
  assert.deepEqual(flatScreens(project)[start.flat].mapIndex, 1);
  assert.equal(flatScreens(project)[start.flat].screen, project.maps[1].screens[2]);
});

test('M1: a start pixel is clamped into the 256 x 240 cell, and a start that names no screen has no marker', () => {
  // wrong: a marker off the cell (x 255 on a 16 px thing); a thrown TypeError on a stale start; a marker on the wrong screen
  const project = worldOf(2);
  Object.assign(project.project, { startX: 255, startY: 239 });
  const { start } = buildWorldMarkers(project);
  assert.deepEqual([start.x, start.y], [240, 224]);
  Object.assign(project.project, { startX: -9, startY: 'x' });
  assert.deepEqual([buildWorldMarkers(project).start.x, buildWorldMarkers(project).start.y], [0, 0]);
  for (const [startMap, startScreen] of [[5, 0], [-1, 0], [0, 7], [0, -1]]) {
    Object.assign(project.project, { startMap, startScreen, startX: 16, startY: 16 });
    assert.equal(buildWorldMarkers(project).start, null, `startMap ${startMap}, startScreen ${startScreen}`);
  }
});

test('M1: titleMap null gives no title marker; a title resolves the way the compiler does (map base + titleScreen, held to the last screen)', () => {
  // wrong: a phantom title marker on screen 0; titleScreen read as a flat index; a title screen past the project's end left unresolved
  const project = worldOf(4, 3);
  assert.equal(buildWorldMarkers(project).title, null);
  assert.deepEqual(buildWorldMarkers(project).markers.map((m) => m.kind), ['start']);
  Object.assign(project.project, { titleMap: 1, titleScreen: 2 });
  const { title, markers } = buildWorldMarkers(project);
  assert.equal(title.kind, 'title');
  assert.equal(title.flat, 4 + 2);
  assert.deepEqual([title.mapIndex, title.screenIndex], [1, 2]);
  assert.deepEqual([title.x, title.y], [0, 0], 'the title tag sits at the top-left of its screen');
  assert.equal(title.title, 'Title screen');
  assert.deepEqual(markers.map((m) => m.kind), ['start', 'title'], 'the start first: where two share a place the start is on top');
  Object.assign(project.project, { titleMap: 0, titleScreen: 99 });
  assert.equal(buildWorldMarkers(project).title.flat, 6, 'held to the last screen of the whole project, as generate.js does');
  Object.assign(project.project, { titleMap: 9, titleScreen: 0 });
  assert.equal(buildWorldMarkers(project).title, null, 'a title map the project does not have');
});

test('M1: byScreen answers each marked screen by its flat index and has an empty links list for now', () => {
  // wrong: byScreen keyed by map-space, or missing the start; links invented before the doors commit
  const project = worldOf(3, 3);
  Object.assign(project.project, { startMap: 1, startScreen: 1, titleMap: 1, titleScreen: 1 });
  const world = buildWorldMarkers(project);
  assert.deepEqual([...world.byScreen.keys()], [4]);
  assert.deepEqual(world.byScreen.get(4).markers.map((m) => m.kind), ['start', 'title']);
  assert.deepEqual(world.byScreen.get(4).out, []);
  assert.deepEqual(world.byScreen.get(4).in, []);
  assert.deepEqual(world.links, []);
});

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

test('M7: buildWorldMarkers neither throws on, nor changes, a deep-frozen project', () => {
  // wrong: an in-place sort, a default written back, or any other write to the project the World view was only asked to read
  const project = worldOf(4, 3);
  Object.assign(project.project, { startMap: 1, startScreen: 1, titleMap: 0, titleScreen: 1 });
  const before = JSON.stringify(project);
  deepFreeze(project);
  const world = buildWorldMarkers(project);
  assert.equal(world.markers.length, 2);
  assert.equal(JSON.stringify(project), before);
});

test('M7: the checked-in fixtures give the markers the probe counted -- sample/ a start and a title, sample-rpg/ a start only', async () => {
  // wrong: a start resolved in the wrong space (sample/ starts on map 0 but its title is on map 1); a phantom title on the RPG
  const sample = await loadProject(SAMPLE);
  const sampleWorld = buildWorldMarkers(sample);
  assert.deepEqual(sampleWorld.markers.map((m) => m.kind), ['start', 'title']);
  assert.deepEqual([sampleWorld.start.mapIndex, sampleWorld.start.screenIndex, sampleWorld.start.x, sampleWorld.start.y], [0, 0, 112, 112]);
  assert.equal(sampleWorld.title.mapIndex, 1, 'the title is on map 1');
  assert.equal(sampleWorld.start.flat, 0);
  assert.equal(sampleWorld.title.flat, sample.maps[0].screens.length);
  const rpg = await loadProject(SAMPLE_RPG);
  const rpgWorld = buildWorldMarkers(rpg);
  assert.deepEqual(rpgWorld.markers.map((m) => m.kind), ['start']);
  assert.equal(rpgWorld.title, null);
  assert.deepEqual(rpgWorld.links, []);
});
