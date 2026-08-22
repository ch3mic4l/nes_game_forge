// The selected test scenario (ROADMAP item 3's "Reload the ROM" bullet):
// turning Map Forge's raw indices into a name/position description
// (describePlayScenario), and resolving that description back against
// whatever project is in hand later (resolveStartAt/resolveFormation).
//
// The scenario is a description, not a reference: following a name is
// defined behaviour, including when the name has moved to different content
// since it was chosen (an actor deleted and a different one renamed to the
// same name). Only genuine ambiguity -- two things currently answering to
// the same name -- has no defined answer, and refuses rather than guesses.
// See shared/playscenario.js's own header for the full reasoning.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createMap, createScreen, flatScreens } from '../../shared/project.js';
import { describePlayScenario, resolveStartAt, resolveFormation } from '../../shared/playscenario.js';

/** A minimal actor stub -- only `.name` and its array position matter here. */
function actor(name) {
  return { name };
}

/** Same reflow resizeMap() (renderer/forges/map/map.js) performs: existing
 * screen *objects* move to their new row-major slot when width changes; a
 * cell a shrink discarded and a later expand brings back gets a fresh,
 * blank, unnamed screen instead of the one that used to be there. */
function resize(map, newW, newH) {
  const oldW = map.gridW;
  const oldH = map.gridH;
  const screens = [];
  for (let row = 0; row < newH; row++) {
    for (let col = 0; col < newW; col++) {
      screens.push(row < oldH && col < oldW ? map.screens[row * oldW + col] : createScreen());
    }
  }
  map.gridW = newW;
  map.gridH = newH;
  map.screens = screens;
}

function baseProject() {
  const project = createProject('Test Game', 'action');
  // World already exists (index 0) with one screen; add a second map with a
  // 2x1 grid so there is somewhere for width-resize/position tests to live.
  const dungeon = createMap(1, 'Dungeon');
  dungeon.gridW = 2;
  dungeon.gridH = 1;
  dungeon.screens = [createScreen(), createScreen()];
  project.maps.push(dungeon);
  return project;
}

// ---------------------------------------------------------- describePlayScenario

test('describePlayScenario converts raw indices into names/position, with no numeric id and no cached label', () => {
  const project = baseProject();
  project.maps[1].screens[1].name = 'Boss Room';
  project.sprites.actors = [actor('Slime'), actor('Bat')];

  const described = describePlayScenario(
    { startAt: { screen: 2, x: 40, y: 60, label: 'stray label' }, battleTest: { formation: [0, 1, 0], label: 'stray' } },
    project
  );

  assert.deepEqual(described.startAt, { mapName: 'Dungeon', screenIndex: 1, screenName: 'Boss Room', x: 40, y: 60 });
  assert.deepEqual(described.battleTest, { formation: ['Slime', 'Bat', 'Slime'] });
  assert.ok(!('label' in described.startAt), 'no label field should survive into the stored description');
  assert.ok(
    !JSON.stringify(described).includes('"0"') && !('0' in described.battleTest),
    'no numeric actor id should survive -- only names'
  );
});

test('describePlayScenario returns null for a field Map Forge did not ask to remember', () => {
  const project = baseProject();
  const described = describePlayScenario({ startAt: { screen: 0, x: 8, y: 8 } }, project);
  assert.equal(described.battleTest, null);
});

// ------------------------------------------------------------- resolveFormation

test('deleting an earlier actor shifts the id resolveFormation resolves to', () => {
  const project = baseProject();
  project.sprites.actors = [actor('Slime'), actor('Bat'), actor('Wolf')];
  const remembered = { formation: ['Bat'] };

  // Bat starts at id 1; deleting the actor before it renumbers Bat to id 0,
  // exactly as sprite.js's own delete handler does.
  project.sprites.actors.splice(0, 1);
  const resolved = resolveFormation(remembered, project);

  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.value, { formation: [0], label: 'Bat' });
});

test('deleting the named actor and renaming a non-adjacent survivor to the same name resolves to the new actor, not a cached first answer', () => {
  const project = baseProject();
  // Five actors so the renamed survivor's post-delete id (3) is neither the
  // deleted actor's original id (1) nor adjacent to it -- ruling out an
  // implementation that coincidentally passes via an off-by-one from the
  // deletion's own renumbering rather than genuinely re-resolving by name.
  project.sprites.actors = [actor('Rat'), actor('Slime'), actor('Goblin'), actor('Wolf')];
  const remembered = { formation: ['Slime'] };

  // Warm any hypothetical cache with a first, legitimate resolution.
  const first = resolveFormation(remembered, project);
  assert.equal(first.ok, true);
  assert.deepEqual(first.value, { formation: [1], label: 'Slime' });

  // Delete "Slime" (id 1) -- Goblin and Wolf shift down to ids 1 and 2 --
  // then rename Wolf, now at id 2, to "Slime": neither the original id (1)
  // nor adjacent to it.
  project.sprites.actors.splice(1, 1);
  project.sprites.actors[2].name = 'Slime';

  const second = resolveFormation(remembered, project);
  assert.equal(second.ok, true);
  assert.deepEqual(second.value, { formation: [2], label: 'Slime' });
});

test('renaming the referenced actor away from the remembered name refuses -- the name is the whole identity', () => {
  const project = baseProject();
  project.sprites.actors = [actor('Slime')];
  const remembered = { formation: ['Slime'] };

  project.sprites.actors[0].name = 'Big Slime';
  const resolved = resolveFormation(remembered, project);

  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /no actor is named "Slime"/);
});

test('two actors sharing the remembered name refuses, naming the ambiguity, rather than picking one', () => {
  const project = baseProject();
  project.sprites.actors = [actor('Slime'), actor('Slime')];
  const resolved = resolveFormation({ formation: ['Slime'] }, project);

  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /more than one actor is named "Slime"/);
});

test('editing or deleting actors that are neither the referenced one nor earlier than it leaves resolution unchanged', () => {
  const project = baseProject();
  project.sprites.actors = [actor('Slime'), actor('Goblin'), actor('Wolf')];
  const remembered = { formation: ['Slime'] };

  const before = resolveFormation(remembered, project);
  project.sprites.actors.splice(1, 1); // delete Goblin, which sits after Slime
  project.sprites.actors.push(actor('Bat'));
  const after = resolveFormation(remembered, project);

  assert.deepEqual(after, before);
});

// -------------------------------------------------------------- resolveStartAt

test('shrinking a map so an unnamed screen is discarded, then expanding it back, resolves to whatever now occupies that position', () => {
  const project = baseProject();
  const map = project.maps[1];
  resize(map, 1, 1); // discards screen index 1 entirely
  resize(map, 2, 1); // brings position 1 back as a fresh, blank, unnamed screen

  const remembered = { mapName: 'Dungeon', screenIndex: 1, screenName: '', x: 5, y: 5 };
  const resolved = resolveStartAt(remembered, project);

  assert.equal(resolved.ok, true);
  assert.equal(resolved.value.label, 'Dungeon · screen 1');
});

test('a named screen survives a width resize that relocates it -- resolution follows the object, not the old position', () => {
  const project = baseProject();
  const map = project.maps[1];
  // A 2x2 grid, not 2x1: resize()'s own row*oldW+col arithmetic only moves a
  // screen on row >= 1 to a *different* flat index when the width changes --
  // row 0 of a single-row map never moves at all under a width-only resize,
  // which would let a resolver that silently kept trusting the old
  // remembered index pass this test without ever following anything.
  map.gridW = 2;
  map.gridH = 2;
  map.screens = [createScreen(), createScreen(), createScreen(), createScreen()];
  map.screens[2].name = 'Boss Room'; // row 1, col 0 -- old index 2
  map.screens[2].metatiles[0] = 7; // a marker a fresh, blank screen would never have

  resize(map, 3, 2); // width change only: row 1's screens all shift to a new flat index
  const relocated = map.screens.find((screen) => screen.name === 'Boss Room');
  assert.notEqual(map.screens.indexOf(relocated), 2, 'the resize must actually relocate the screen for this test to mean anything');

  const remembered = { mapName: 'Dungeon', screenIndex: 2, screenName: 'Boss Room', x: 0, y: 0 };
  const resolved = resolveStartAt(remembered, project);

  assert.equal(resolved.ok, true);
  // Read back through the resolver's own answer, not by independently
  // finding the object ourselves -- otherwise this proves the object still
  // exists somewhere, not that resolveStartAt actually points at it.
  const resolvedScreen = flatScreens(project)[resolved.value.screen].screen;
  assert.equal(resolvedScreen.metatiles[0], 7, 'resolveStartAt must point at the relocated object, not a stale index');
});

test('two screens in the same map sharing the remembered name refuses, naming the ambiguity', () => {
  const project = baseProject();
  const map = project.maps[1];
  map.screens[0].name = 'Boss Room';
  map.screens[1].name = 'Boss Room';
  const resolved = resolveStartAt({ mapName: 'Dungeon', screenIndex: 0, screenName: 'Boss Room', x: 0, y: 0 }, project);

  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /more than one screen in "Dungeon" is named "Boss Room"/);
});

test('a map resized without a name to follow refuses for an unnamed screen', () => {
  const project = baseProject();
  const map = project.maps[1];
  resize(map, 1, 1); // discards screen index 1, and never brings the position back
  const resolved = resolveStartAt({ mapName: 'Dungeon', screenIndex: 1, screenName: '', x: 0, y: 0 }, project);

  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /no longer has a screen at position 1/);
});

test('editing an unrelated map leaves which content resolves, unchanged', () => {
  // Resizing an earlier map shifts every later map's *flat* screen number
  // (main/build/generate.js numbers screens in project.maps order), which is
  // exactly why resolveStartAt tracks a screen by (map name, position within
  // that map) rather than by the flat number Map Forge originally handed
  // over -- the flat number is allowed to move; which content it names is
  // not, and that is what this asserts, not raw equality of the whole result.
  const project = baseProject();
  const remembered = { mapName: 'Dungeon', screenIndex: 0, screenName: '', x: 1, y: 1 };
  const before = resolveStartAt(remembered, project);

  resize(project.maps[0], 5, 5); // World, not Dungeon
  const after = resolveStartAt(remembered, project);

  assert.equal(after.ok, true);
  assert.equal(after.value.label, before.value.label);
  assert.equal(after.value.x, before.value.x);
  assert.equal(after.value.y, before.value.y);
});

test('the map itself renamed and a different map renamed to the old name resolves to the new one, not a refusal', () => {
  const project = baseProject();
  project.maps[1].name = 'Old Dungeon';
  project.maps.push(createMap(2, 'Dungeon'));
  project.maps[2].screens[0].name = 'Fresh';

  const resolved = resolveStartAt({ mapName: 'Dungeon', screenIndex: 0, screenName: '', x: 2, y: 2 }, project);
  assert.equal(resolved.ok, true);
  assert.match(resolved.value.label, /^Dungeon/);
});

test('two maps sharing the remembered name refuses, naming the ambiguity', () => {
  const project = baseProject();
  project.maps.push(createMap(2, 'Dungeon'));
  const resolved = resolveStartAt({ mapName: 'Dungeon', screenIndex: 0, screenName: '', x: 0, y: 0 }, project);

  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /more than one map is named "Dungeon"/);
});
