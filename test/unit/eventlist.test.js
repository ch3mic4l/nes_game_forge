// The Map Forge's project-wide event search.
//
// The interesting claim is that "find uses" needs no separate machinery: the
// text searched is the text shown, and the text shown has already resolved
// switch numbers, actor ids and screen indices into names. These tests pin
// that, because the moment the index stores raw numbers instead, searching a
// switch by its name silently finds nothing and looks like "no uses".

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEventIndex, searchEvents } from '../../renderer/forges/map/eventlist.js';
import { createProject, createMap, createScreen, flatScreens } from '../../shared/project.js';

/** A project with a chest, a locked door, an innkeeper and somewhere to go. */
function scenario() {
  const project = createProject('Quest');
  project.maps[0].name = 'Overworld';
  project.maps[0].screens[0].name = 'Cave mouth';
  project.maps.push(createMap(1, 'Castle'));
  project.maps[1].screens[0].name = 'Throne room';
  project.switches = ['Gate opened'];

  project.sprites.actors = [
    { name: 'Chest', behavior: 'npc' },
    { name: 'Door', behavior: 'door' },
    { name: 'Villager', behavior: 'npc' }
  ];

  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 32,
      y: 48,
      props: {
        name: 'Gate key chest',
        event: {
          pages: [
            { cond: { type: 'switchOff', arg: 0 }, commands: [{ op: 'setSwitch', switch: 0 }] },
            { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Empty.' }] }
          ]
        }
      }
    },
    { actorId: 1, x: 96, y: 16, props: { toScreen: 1, toX: 120, toY: 200 } },
    { actorId: 2, x: 64, y: 64, props: { dialogue: 'Mind the wolves.' } }
  ];

  const context = {
    actors: project.sprites.actors,
    switches: project.switches,
    screens: flatScreens(project).map((entry) => entry.label),
    party: []
  };
  return { project, context };
}

test('the index covers every placed actor in every map, named or not', () => {
  const { project, context } = scenario();
  const rows = buildEventIndex(project, context);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.title),
    ['Gate key chest', 'Door', 'Villager'],
    'an unnamed placement reads as the actor it is'
  );
  assert.equal(rows[0].where, 'Overworld · Cave mouth');
  assert.equal(rows[0].at, '32,48');
});

test('a switch is found by its name, because that is what the row says', () => {
  const { project, context } = scenario();
  const rows = buildEventIndex(project, context);

  const uses = searchEvents(rows, 'Gate opened');
  assert.equal(uses.length, 1);
  assert.equal(uses[0].title, 'Gate key chest');
  assert.ok(
    uses[0].detail.some((line) => line.includes('Turn on Gate opened')),
    'the command reads with the switch named'
  );

  // And renaming the switch moves the answer with it: the row is built from the
  // project's names, not from a copy made when the event was written.
  project.switches[0] = 'Portcullis';
  context.switches = project.switches;
  const renamed = buildEventIndex(project, context);
  assert.equal(searchEvents(renamed, 'Gate opened').length, 0);
  assert.equal(searchEvents(renamed, 'Portcullis').length, 1);
});

test('a warp destination is found by the name of the screen it leads to', () => {
  const { project, context } = scenario();
  const rows = buildEventIndex(project, context);
  const found = searchEvents(rows, 'Throne room');
  assert.equal(found.length, 1, 'the door into the throne room');
  assert.equal(found[0].title, 'Door');
  assert.match(found[0].detail[0], /→ Castle · Throne room at 120,200/);
});

test('terms match in any order, and dialogue is searchable', () => {
  const { project, context } = scenario();
  const rows = buildEventIndex(project, context);
  assert.equal(searchEvents(rows, 'chest gate').length, 1);
  assert.equal(searchEvents(rows, 'gate chest').length, 1, 'order must not matter');
  assert.equal(searchEvents(rows, 'wolves').length, 1, 'a line of dialogue finds its speaker');
  assert.equal(searchEvents(rows, 'chest wolves').length, 0, 'every term has to match');
  assert.equal(searchEvents(rows, '   ').length, rows.length, 'an empty query is not a filter');
});

test('a row with nothing to show says what the actor is, not what it fails to do', () => {
  const { project, context } = scenario();
  project.sprites.actors.push({ name: 'Gem', behavior: 'pickup' });
  project.maps[0].screens[0].entities.push({ actorId: 3, x: 8, y: 8, props: {} });
  const rows = buildEventIndex(project, context);

  // A pickup with no dialogue is doing its job; an NPC with none is an
  // oversight. Saying "does nothing when talked to" about a gem invents a
  // problem, and this codebase does not label working things as broken.
  assert.equal(rows.at(-1).note, 'Pickup');
  assert.equal(rows.find((row) => row.title === 'Villager')?.note, 'says nothing when talked to');
});

test('a screen with no actors contributes no rows and does not throw', () => {
  const project = createProject('Empty');
  project.maps[0].screens.push(createScreen());
  assert.deepEqual(buildEventIndex(project, { actors: [], switches: [], screens: [], party: [] }), []);
});
