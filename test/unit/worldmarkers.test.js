// Map Forge World view (ROADMAP item 7): the markers and links in renderer/forges/map/worldmarkers.js. Commit C1 built the two the
// project itself names -- where the player starts and which screen is the title screen; commit C2 the doors, warps, events and
// talkers (M1-M7 of docs/design-world-overview.md section 7). Each test states, in its first comment line, the wrong
// implementation it exists to catch.
//
//   M1 start, title and doors   M2 dangling and landings   M3 warps   M4 common events by call path   M5 events and talkers
//   M6 the remap oracle and its change detector   M7 read-only, the fixtures, eventlist.js

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createProject,
  createMap,
  createScreen,
  flatScreens,
  remapScreenReferences,
  reorderMapsCore,
  buildReorderTranslate,
  CHOICE_LIMITS
} from '../../shared/project.js';
import { loadProject } from '../../main/project-io.js';
import { buildWorldMarkers, referenceInventory, doorTarget, describeLink } from '../../renderer/forges/map/worldmarkers.js';
import { buildEventIndex } from '../../renderer/forges/map/eventlist.js';

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

test('M7: the checked-in fixtures give the markers the probe counted -- sample/ a start, a title, a door, two events and a talker, sample-rpg/ a start and an event', async () => {
  // wrong: a start resolved in the wrong space (sample/ starts on map 0 but its title is on map 1); a phantom title on the RPG; a counted marker for the dialogue-only actor on the wrong side
  const sample = await loadProject(SAMPLE);
  const sampleWorld = buildWorldMarkers(sample);
  assert.deepEqual(sampleWorld.markers.map((m) => m.kind), ['start', 'title', 'door', 'event', 'event', 'talk']);
  assert.deepEqual([sampleWorld.start.mapIndex, sampleWorld.start.screenIndex, sampleWorld.start.x, sampleWorld.start.y], [0, 0, 112, 112]);
  assert.equal(sampleWorld.title.mapIndex, 1, 'the title is on map 1');
  assert.equal(sampleWorld.start.flat, 0);
  assert.equal(sampleWorld.title.flat, sample.maps[0].screens.length);
  const rpg = await loadProject(SAMPLE_RPG);
  const rpgWorld = buildWorldMarkers(rpg);
  assert.deepEqual(rpgWorld.markers.map((m) => m.kind), ['start', 'event']);
  assert.equal(rpgWorld.title, null);
  assert.deepEqual(rpgWorld.links, []);
  // the one link of sample/: the portal on screen 3 leads to screen 0
  assert.equal(sampleWorld.links.length, 1);
  assert.deepEqual([sampleWorld.links[0].kind, sampleWorld.links[0].from.flat, sampleWorld.links[0].to.flat, sampleWorld.links[0].dangling], ['door', 3, 0, false]);
});

// ------------------------------------------------------------------------------------------------ C2: actors, doors and warps

const ACTORS = [
  { name: 'Door', behavior: 'door' },
  { name: 'Villager', behavior: 'npc' },
  { name: 'Coin', behavior: 'pickup' }
];
const DOOR = 0;
const VILLAGER = 1;
const COIN = 2;

/** `worldOf` with the three actors above, so a placed entity has a behavior to be read by. */
function actorWorld(...counts) {
  const project = worldOf(...counts);
  project.sprites.actors = structuredClone(ACTORS);
  return project;
}

/** Place an actor on screen `screenIndex` of map `mapIndex`; returns its entity index. */
function place(project, mapIndex, screenIndex, actorId, props = {}, x = 32, y = 48) {
  const entities = project.maps[mapIndex].screens[screenIndex].entities;
  entities.push({ actorId, x, y, props: { name: '', ...props } });
  return entities.length - 1;
}

const NOW = { type: 'none', arg: 0 };
const page = (commands, cond = NOW) => ({ cond, commands });
const warp = (screen, x = 0, y = 0, extra = {}) => ({ op: 'warp', screen, x, y, ...extra });
const call = (event, extra = {}) => ({ op: 'call', event, ...extra });
const say = (text = 'hi') => ({ op: 'say', text });
const eventOf = (...pages) => ({ pages });
/** The warp links of a world, as `stored -> compiled`, so a test can name the target it means. */
const warpsByTarget = (world) => Object.fromEntries(world.links.filter((l) => l.kind === 'warp').map((l) => [l.stored, l.compiled]));

test('M1: only door actors give door links; a non-door entity\'s default toScreen gives none, and every map/screen comes from the flat index', () => {
  // wrong: reading every entity as remapScreenReferences does (a villager's toScreen 0 becomes a door); map-space and flat-space mixed
  const project = actorWorld(2, 3);
  const door = place(project, 1, 0, DOOR, { toScreen: 4, toX: 48, toY: 64 }); // flat 2 -> flat 4 (map 1, screen 2)
  place(project, 0, 1, VILLAGER, { toScreen: 3 });
  place(project, 1, 1, COIN, { toScreen: 1 });
  const { links, markers } = buildWorldMarkers(project);
  assert.equal(links.length, 1);
  const [link] = links;
  assert.equal(link.kind, 'door');
  assert.deepEqual(link.from, { flat: 2, mapIndex: 1, screenIndex: 0, entityIndex: door, x: 32, y: 48 });
  assert.deepEqual(link.to, { flat: 4, mapIndex: 1, screenIndex: 2, x: 48, y: 64 });
  assert.equal(link.stored, 4);
  assert.equal(link.dangling, false);
  assert.equal(link.compiled, true);
  assert.equal(link.via, null);
  assert.equal(link.self, false);
  assert.deepEqual(markers.filter((m) => m.kind === 'door').map((m) => [m.flat, m.entityIndex, m.hasLinks]), [[2, door, true]]);
});

test('M1: a door on its own screen is a self link, and a missing landing is the default 112,112', () => {
  // wrong: a same-screen door dropped or drawn as a zero-length path; an absent landing read as 0,0
  const project = actorWorld(2);
  place(project, 0, 1, DOOR, { toScreen: 1 });
  const [link] = buildWorldMarkers(project).links;
  assert.equal(link.self, true);
  assert.deepEqual([link.to.x, link.to.y], [112, 112]);
  assert.equal(link.to.flat, 1);
});

test('M2: a target past the end is a dangling link to the last screen, never dropped; a landing and a marker are clamped by their own bounds', () => {
  // wrong: no clamp (an arrow off the map); a dropped link; source bounds (the actor's pixel) confused with landing bounds
  const project = actorWorld(2, 3);
  place(project, 0, 0, DOOR, { toScreen: 200, toX: 30, toY: 40 });
  const cutscene = place(project, 0, 1, VILLAGER, { event: eventOf(page([warp(9, 255, 239)])) }, 255, 239);
  const world = buildWorldMarkers(project);
  const door = world.links.find((l) => l.kind === 'door');
  assert.equal(door.dangling, true);
  assert.equal(door.to.flat, 4, 'the ROM goes to the last of the five screens');
  assert.deepEqual([door.to.mapIndex, door.to.screenIndex], [1, 2]);
  assert.equal(door.stored, 200);
  assert.match(describeLink(project, door), /screen 200 — the project has 5; the ROM goes to Map 1 · screen 2 at 30,40/);
  const toLast = world.links.find((l) => l.kind === 'warp');
  assert.equal(toLast.dangling, true);
  assert.deepEqual([toLast.to.x, toLast.to.y], [240, 224], 'a landing of 255,239 is held to 240,224 as the compiler does');
  const marker = world.markers.find((m) => m.screenIndex === 1 && m.entityIndex === cutscene);
  assert.deepEqual([marker.x, marker.y], [240, 224], 'the source marker stays inside its 256 x 240 cell');
  assert.equal(world.markers.find((m) => m.kind === 'door').dangling, true, 'the door marker carries the warning');
  assert.equal(marker.dangling, true);
});

test('M2: a door with a missing, string, negative or fractional toScreen resolves the way the compiler does, and the project\'s own labels agree with doorTarget', () => {
  // wrong: a thrown TypeError on a stale door; a negative stored number indexing from the end; two readings of one door
  const project = actorWorld(4);
  const entity = { actorId: DOOR, x: 16, y: 16, props: { toScreen: 2, toX: 7, toY: 9 } };
  const ok = doorTarget(project, 0, entity);
  assert.deepEqual([ok.stored, ok.dangling, ok.to.flat, ok.label, ok.rawX, ok.rawY], [2, false, 2, 'Map 0 · screen 2', 7, 9]);
  const gone = doorTarget(project, 0, { ...entity, props: { toScreen: 9 } });
  assert.deepEqual([gone.dangling, gone.label, gone.to.flat], [true, 'screen 9', 3]);
  const negative = doorTarget(project, 0, { ...entity, props: { toScreen: -1 } });
  assert.deepEqual([negative.dangling, negative.to.flat], [true, 0]);
  const bare = doorTarget(project, 0, { actorId: DOOR, x: 0, y: 0 });
  assert.deepEqual([bare.stored, bare.to.flat, bare.rawX, bare.rawY, bare.to.x, bare.to.y], [0, 0, 112, 112, 112, 112]);
  assert.equal(doorTarget(actorWorld(), 0, entity).to, null, 'a project with no screen has no target');
});

test('M3: a warp is found in a then, an else, a nested branch and a choice option; switched-off ones, dropped pages and options past the limit are present but not compiled', () => {
  // wrong: liveCommands only (a warp nested under an off command vanishes); allCommands only (everything shown compiled); top level only
  const project = actorWorld(8);
  const extraOptions = Array.from({ length: CHOICE_LIMITS.options }, (_, i) => ({ label: `o${i}`, commands: i === CHOICE_LIMITS.options - 1 ? [warp(1)] : [say('x')] }));
  extraOptions.push({ label: 'past the limit', commands: [warp(7)] });
  place(project, 0, 0, VILLAGER, {
    event: eventOf(
      page([
        warp(1),
        { op: 'branch', cond: NOW, then: [warp(2)], else: [{ op: 'branch', cond: NOW, then: [warp(3)], else: [] }] },
        { op: 'choice', options: extraOptions },
        warp(5, 0, 0, { off: true }),
        { op: 'branch', cond: NOW, then: [warp(4, 0, 0, { off: true })], else: [say('x')] }
      ]),
      page([warp(6, 0, 0, { off: true })]) // every command off: compiledPages drops the whole page
    )
  });
  const byTarget = warpsByTarget(buildWorldMarkers(project));
  assert.deepEqual(byTarget, { 1: true, 2: true, 3: true, 4: false, 5: false, 6: false, 7: false });
});

test('M4: a common event\'s warp is compiled if ANY call path to it is, whichever order the calls come in', () => {
  // wrong: a per-root visited set that lets a dead path hide a live one; order dependence; local-membership liveness
  const live = (project, ...calls) => {
    project.commonEvents = [{ id: 0, name: 'Teleport', event: eventOf(page([warp(3, 10, 20)])) }];
    project.commonEventSeq = 1;
    place(project, 0, 0, VILLAGER, { event: eventOf(page([say('hello'), ...calls])) });
    return buildWorldMarkers(project);
  };
  for (const order of [[call(0, { off: true }), call(0)], [call(0), call(0, { off: true })]]) {
    const world = live(actorWorld(5), ...order);
    assert.equal(world.links.length, 1, 'one link, whichever calls reach it');
    assert.equal(world.links[0].compiled, true);
    assert.deepEqual(world.links[0].via, { id: 0, name: 'Teleport' });
    assert.deepEqual([world.links[0].to.x, world.links[0].to.y], [10, 20]);
  }
  const disabled = live(actorWorld(5), call(0, { off: true }));
  assert.equal(disabled.links.length, 1, 'a switched-off call still mentions the warp');
  assert.equal(disabled.links[0].compiled, false);
});

test('M4: liveness follows the whole path -- a nested off call, and a callee whose pages all compile away, are not compiled', () => {
  // wrong: judging a warp by its own body only (local membership); counting a callee the compiler gives no slot
  const project = actorWorld(6);
  project.commonEvents = [
    { id: 0, name: 'A', event: eventOf(page([say('a'), call(1, { off: true })])) },
    { id: 1, name: 'B', event: eventOf(page([call(2)])) },
    { id: 2, name: 'C', event: eventOf(page([warp(5)])) },
    { id: 3, name: 'Empty', event: eventOf(page([warp(4, 0, 0, { off: true })])) }
  ];
  project.commonEventSeq = 4;
  place(project, 0, 0, VILLAGER, { event: eventOf(page([call(0), call(3)])) });
  const byTarget = warpsByTarget(buildWorldMarkers(project));
  assert.deepEqual(byTarget, { 5: false, 4: false });
});

test('M4: a call is resolved by the id resolveCommonEventIds gives the entry, not by the raw field; two callers give two links; cycles end; a missing target and an uncalled body yield nothing', () => {
  // wrong: raw entry.id (a missing id finds nothing, a duplicate finds the wrong body); one link for two callers; recursion without a bound
  const project = actorWorld(8);
  project.commonEventSeq = 5;
  project.commonEvents = [
    { name: 'NoId', event: eventOf(page([warp(1)])) }, // resolves to 5
    { id: '2', name: 'StringId', event: eventOf(page([warp(2)])) }, // 2
    { id: 2, name: 'Duplicate', event: eventOf(page([warp(3)])) }, // 2 is taken: 6
    { id: -1, name: 'Sentinel', event: eventOf(page([warp(4)])) }, // 7
    { id: 20, name: 'Loop A', event: eventOf(page([warp(5), call(21)])) },
    { id: 21, name: 'Loop B', event: eventOf(page([warp(6), call(20)])) },
    { id: 30, name: 'Nobody calls this', event: eventOf(page([warp(7)])) }
  ];
  const first = place(project, 0, 0, VILLAGER, { event: eventOf(page([call(5), call(2), call(6), call(7), call(20), call(99), call('x')])) });
  const second = place(project, 0, 1, VILLAGER, { event: eventOf(page([call(5)])) });
  const world = buildWorldMarkers(project);
  const fromFirst = world.links.filter((l) => l.from.entityIndex === first && l.from.screenIndex === 0);
  assert.deepEqual(fromFirst.map((l) => l.stored).sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Object.fromEntries(fromFirst.map((l) => [l.stored, l.via.name])), { 1: 'NoId', 2: 'StringId', 3: 'Duplicate', 4: 'Sentinel', 5: 'Loop A', 6: 'Loop B' });
  assert.equal(world.links.filter((l) => l.stored === 7).length, 0, 'an uncalled body yields nothing');
  const again = world.links.filter((l) => l.from.entityIndex === second && l.from.screenIndex === 1);
  assert.deepEqual(again.map((l) => [l.stored, l.via.id]), [[1, 5]], 'a second caller is a second link');
});

test('M5: an event marker reads the effective trigger, an event switched off is one grey marker that says its dialogue, a talker is dialogue only, a door with an event stays one door', () => {
  // wrong: the stored trigger copied (a pickup stored as touch is walked into, so it reads interact); dead dialogue counted over a compiled event; a vanished marker; a door counted twice
  const project = actorWorld(3);
  const coin = place(project, 0, 0, COIN, { trigger: 'touch', event: eventOf(page([say('ding')])) });
  const villager = place(project, 0, 0, VILLAGER, { trigger: 'touch', event: eventOf(page([say('hi')])), dialogue: 'dead text' });
  const off = place(project, 0, 1, VILLAGER, { name: 'Sleeper', event: eventOf(page([say('zzz', )].map((c) => ({ ...c, off: true })))), dialogue: 'Wake up   now\nplease' });
  const talker = place(project, 0, 1, VILLAGER, { dialogue: '  I only talk.  ' });
  const mute = place(project, 0, 1, VILLAGER, {});
  const doorWithEvent = place(project, 0, 2, DOOR, { toScreen: 0, event: eventOf(page([warp(1)])) });
  const world = buildWorldMarkers(project);
  const markerOf = (screenIndex, entityIndex) => world.markers.find((m) => m.screenIndex === screenIndex && m.entityIndex === entityIndex);
  assert.deepEqual([markerOf(0, coin).kind, markerOf(0, coin).trigger], ['event', 'interact']);
  assert.deepEqual([markerOf(0, villager).kind, markerOf(0, villager).trigger, markerOf(0, villager).compiled, markerOf(0, villager).says], ['event', 'touch', true, '']);
  assert.deepEqual([markerOf(1, off).kind, markerOf(1, off).compiled, markerOf(1, off).says], ['event', false, 'Wake up   now\nplease']);
  assert.match(markerOf(1, off).title, /Sleeper — When talked to, 1 page, switched off; says “Wake up now please” instead/);
  assert.equal(markerOf(1, talker).kind, 'talk');
  assert.match(markerOf(1, talker).title, /Says “I only talk\.”/);
  assert.equal(markerOf(1, mute), undefined, 'an actor with nothing to show has no marker');
  assert.equal(world.markers.filter((m) => m.screenIndex === 2).length, 1);
  assert.equal(markerOf(2, doorWithEvent).kind, 'door');
  assert.equal(world.links.filter((l) => l.from.screenIndex === 2).length, 2, 'the door link and the warp are both links');
});

test('M5: markers come in priority order -- start, title, doors, events, talkers -- so a hit-test on a shared corner finds the more important one first', () => {
  // wrong: a talker placed over a door in the project\'s own order wins the click
  const project = actorWorld(2);
  place(project, 0, 0, VILLAGER, { dialogue: 'talk' });
  place(project, 0, 0, VILLAGER, { event: eventOf(page([say('e')])) });
  place(project, 0, 0, DOOR, { toScreen: 1 });
  Object.assign(project.project, { titleMap: 0, titleScreen: 1 });
  assert.deepEqual(buildWorldMarkers(project).markers.map((m) => m.kind), ['start', 'title', 'door', 'event', 'talk']);
});

/** A project with doors, a non-door entity with a stored toScreen, nested warps, a multiply called and an uncalled common event, raw and dangling targets. */
function oracleProject() {
  const project = actorWorld(3, 2);
  place(project, 0, 0, DOOR, { toScreen: 4 });
  place(project, 0, 1, DOOR, { toScreen: 250 });
  place(project, 1, 0, VILLAGER, { toScreen: 2, event: eventOf(page([call(0), { op: 'branch', cond: NOW, then: [warp(3)], else: [{ op: 'branch', cond: NOW, then: [warp(250, 3, 3)], else: [] }] }])) });
  place(project, 1, 1, COIN, { toScreen: 1, event: eventOf(page([call(0), warp(1, 0, 0, { off: true })])) });
  project.maps[1].screens[1].entities.push({ actorId: VILLAGER, x: 0, y: 0, props: {} }); // no toScreen stored: the remapper still asks about it, as 0
  project.commonEvents = [
    { id: 0, name: 'Called twice', event: eventOf(page([warp(2), { op: 'choice', options: [{ label: 'a', commands: [warp(0)] }] }])) },
    { id: 1, name: 'Uncalled', event: eventOf(page([warp(4)])) }
  ];
  project.commonEventSeq = 2;
  return project;
}

test('M6: the stored values remapScreenReferences asks translate about are exactly referenceInventory(project), as a multiset (each body once, called or not)', () => {
  // wrong: expanding a common event per caller (D1\'s count differed from the remapper\'s), or leaving an uncalled body out, or skipping a non-door entity\'s toScreen
  const project = oracleProject();
  const inventory = referenceInventory(project).map((r) => `${r.kind}:${r.stored}`).sort();
  const asked = [];
  // the recording translate: identity, noting which kind of field each question came from by the order the remapper walks (doors first)
  remapScreenReferences(structuredClone(project), (value) => {
    asked.push(value);
    return value;
  });
  const doorCount = referenceInventory(project).filter((r) => r.kind === 'door').length;
  const labelled = asked.map((value, i) => `${i < doorCount ? 'door' : 'warp'}:${value}`).sort();
  assert.deepEqual(labelled, inventory);
  assert.ok(inventory.includes('door:2') && inventory.includes('warp:4'), 'the non-door entity\'s toScreen and the uncalled body are in it');
  assert.equal(inventory.filter((r) => r === 'warp:2').length, 1, 'a body called twice is listed once');
});

test('M6: after a map reorder the rebuilt links\' targets are the permutation of the old ones, expanded per caller, dangling ones included', () => {
  // wrong: links read before the remap, or a dangling target left unresolved so it lands on a different screen than the ROM\'s
  const project = oracleProject();
  const key = (l) => `${l.kind}|${l.source}|${l.from.screenIndex}|${l.stored === undefined ? '' : l.via?.id ?? ''}|${l.to.x},${l.to.y}`;
  const before = buildWorldMarkers(project).links;
  const order = [1, 0];
  const permute = buildReorderTranslate(project, order);
  const expected = before.map((l) => ({ key: key(l), to: permute(l.to.flat), dangling: l.dangling }));
  reorderMapsCore(project, order);
  const after = buildWorldMarkers(project).links;
  const sortBy = (list) => list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.to - b.to));
  assert.deepEqual(sortBy(after.map((l) => ({ key: key(l), to: l.to.flat, dangling: false }))), sortBy(expected.map((e) => ({ ...e, dangling: false }))));
  assert.ok(before.some((l) => l.dangling), 'the fixture does hold a dangling target');
});

// The raw SHA-256 of the two shared files the read side depends on. If this test is red a file `referenceInventory` /
// `buildWorldMarkers` read through has changed: audit `referenceInventory` against `remapScreenReferences` (and against
// `projectEvents` and `allCommands`) -- does the remapper still reach exactly the fields the inventory lists? does a new stored
// screen reference need a link? -- extend the oracle fixture above if so, THEN update the digests. A harmless edit raising this
// alarm is accepted; a missed change is not. (No comment/whitespace normalisation and no short hash: both were shown to miss
// real changes, handoff-next/worldview/d2-review2.md, finding 2.)
// Re-pinned for equipment C2 (docs/design-equipment.md): audited -- the diff to shared/project.js adds EQUIP_SLOTS, the equipment fields in
// the item/party normalizers, three predicates, startEquip/usableBy handling in renumberItemDeletion/renumberPartyMemberDeletion, grantNewMember,
// releaseEquipment and five validateProject rules. remapScreenReferences, projectEvents and allCommands are untouched and no new stored
// screen reference exists, so referenceInventory needs no change.
// Re-pinned for equipment C3: audited -- the diff to shared/project.js adds only the two exported predicates projectUsesEquipmentMag /
// projectUsesEquipmentMdef (a read of item.equip.mag / .mdef); nothing stores a screen reference and remapScreenReferences, projectEvents
// and allCommands are untouched.
// Re-pinned for encounter groups (data layer): audited -- the diff to shared/project.js adds the group limits, the encounter-group helpers,
// planner and normalizers, a group walk in monsterActorIds and renumberActorDeletion, renumberEncounterGroupDeletion, group-mode handling in
// battleFormations, and four validateProject rules. remapScreenReferences, projectEvents and allCommands are untouched and no new stored
// screen reference exists (a group names actors, a table names groups), so referenceInventory needs no change.
// Re-pinned for encounter groups fix 1: audited -- the diff is planEncounterConversion's entry-total refusal only (existing total + cost > 255,
// zero-cost conversions included); remapScreenReferences, projectEvents and allCommands are untouched and no stored screen reference is added.
// Re-pinned for encounter groups C2: audited -- the diff to shared/project.js adds projectWithoutEncounterGroups (a clone with every map's
// encounters.mode/table removed) and one validateEncounterGroups rule (encounter-groups-code-override, a read of project.code.overrides names);
// remapScreenReferences, projectEvents and allCommands are untouched and no stored screen reference is added.
// Re-pinned for growth profiles D1: audited -- the diff to shared/project.js adds the GROWTH_LIMITS table, points normalizePartyMember's twelve
// clamps at it (same values) and corrects the MONSTER_GROWTH_FIELDS comment; remapScreenReferences, projectEvents and allCommands are untouched
// and no stored screen reference is added.
// Re-pinned for growth profiles C1: audited -- the diff to shared/project.js adds RPG_LIMITS.growthProfiles, member.profileId, the profile
// curve/resolver/deletion helpers (GROWTH_SHAPES, profileStatAt, effectiveGrowth, memberStatAt, growthProfileUsers,
// renumberGrowthProfileDeletion) and normalizeGrowthProfiles with its two call sites in normalizeProject; remapScreenReferences,
// projectEvents and allCommands are untouched and no stored screen reference is added (a profileId names a profile, not a screen).
// Re-pinned for growth profiles C2: audited -- `git diff -U0 shared/project.js` is three hunks: the private partyGrowsStat helper, and projectUsesMagicPower
// / projectUsesMagicDefence reading the party source through it (effectiveGrowth) instead of member.baseX / xPerLevel; remapScreenReferences,
// projectEvents and allCommands are untouched and no stored screen reference is added.
// Re-pinned for growth profiles C3 fix 1: audited -- `git diff -U0 shared/project.js` against C2 adds the exported clampGrowthValue (a clamp through
// GROWTH_LIMITS) and points normalizeGrowthProfiles' base / perLevel at it (same values); remapScreenReferences, projectEvents and allCommands are
// untouched and no stored screen reference is added.
const PINNED_DIGESTS = {
  'shared/project.js': 'c2183bd5e9768c49428e6c897744cb07c354ba3261484ae6cc6cd1158f64c458',
  'shared/eventrules.js': '8fb4ac1e24cdd60802fde56eeee83ac0d1983c86bfcca509ec026b087c611f72'
};

test('M6: change detector -- shared/project.js and shared/eventrules.js are the files whose raw SHA-256 the inventory was audited against', () => {
  // wrong: a detector on the remapper\'s comment-stripped text (misses a change in projectEvents/allCommands or in a literal), or none at all
  for (const [file, pinned] of Object.entries(PINNED_DIGESTS)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(here, '../..', file))).digest('hex');
    assert.equal(
      actual,
      pinned,
      `${file} changed. Audit referenceInventory (renderer/forges/map/worldmarkers.js) against remapScreenReferences -- and against ` +
        `projectEvents and allCommands, which it reads through -- then update PINNED_DIGESTS in test/unit/worldmarkers.test.js.`
    );
  }
});

test('M7: buildWorldMarkers neither throws on, nor changes, a deep-frozen project that has doors, warps and common events', () => {
  // wrong: an in-place sort of a shared list, a default written back into props, any write to the project the view was only asked to read
  const project = oracleProject();
  const before = JSON.stringify(project);
  deepFreeze(project);
  const world = buildWorldMarkers(project);
  assert.ok(world.links.length >= 6 && world.markers.length >= 5);
  assert.equal(JSON.stringify(project), before);
  assert.ok(referenceInventory(project).length >= 10, 'and the inventory reads it too');
});

test('M7: eventlist.js prints a door\'s line from doorTarget -- normal and dangling', () => {
  // wrong: the list and the map reading a door two ways (a dangling door printed as a screen label, or the landing clamped in one place only)
  const project = actorWorld(2, 3);
  project.maps[1].screens[2].name = 'Throne room';
  project.maps[1].name = 'Castle';
  place(project, 0, 0, DOOR, { toScreen: 4, toX: 120, toY: 200 });
  place(project, 0, 1, DOOR, { toScreen: 200, toX: 255, toY: 239 });
  const lines = buildEventIndex(project, {}).filter((row) => !row.common).map((row) => row.detail[0]);
  assert.deepEqual(lines, ['→ Castle · Throne room at 120,200', '→ screen 200 at 255,239']);
  const entity = project.maps[0].screens[1].entities[0];
  const target = doorTarget(project, 1, entity);
  assert.equal(lines[1], `→ ${target.label} at ${target.rawX},${target.rawY}`);
  assert.deepEqual([target.to.x, target.to.y], [240, 224], 'the World view clamps the landing; the list prints it as typed');
});
