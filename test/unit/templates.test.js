// Event templates.
//
// The one that matters is the free-switch scan. A template's whole value is
// that it picks a switch nobody is using; hand out one that is already
// load-bearing and the result is two unrelated events firing together, which
// reads as an engine bug and is not one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_TEMPLATES, templatesFor, usedSwitches, firstFreeSwitch } from '../../renderer/forges/map/templates.js';
import {
  createProject,
  normalizeProject,
  EVENT_COMMANDS,
  EVENT_CONDITIONS,
  IMPLEMENTED_COMMANDS,
  RPG_LIMITS
} from '../../shared/project.js';

test('a switch counts as used wherever it can hide', () => {
  const project = createProject('Uses');
  project.sprites.actors = [{ name: 'Chest', behavior: 'npc' }];
  project.maps[0].screens[0].entities = [
    { actorId: 0, x: 0, y: 0, props: { hideSwitch: 3 } },
    {
      actorId: 0,
      x: 16,
      y: 0,
      props: {
        event: {
          pages: [
            { cond: { type: 'switchOn', arg: 1 }, commands: [{ op: 'setSwitch', switch: 5 }] },
            { cond: { type: 'switchOff', arg: 2 }, commands: [{ op: 'clearSwitch', switch: 8 }] }
          ]
        }
      }
    }
  ];

  assert.deepEqual([...usedSwitches(project)].sort((a, b) => a - b), [1, 2, 3, 5, 8]);
  assert.equal(firstFreeSwitch(project), 0);

  // A condition's arg only counts when the condition is about a switch —
  // "Carrying item" puts an actor id in the same field.
  const carrying = createProject('Carrying');
  carrying.maps[0].screens[0].entities = [
    { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'hasItem', arg: 7 }, commands: [] }] } } }
  ];
  assert.equal(usedSwitches(carrying).has(7), false, 'an actor id is not a switch');
});

test('all switches spent means no free switch, not switch zero', () => {
  const project = createProject('Full');
  project.sprites.actors = [{ name: 'NPC', behavior: 'npc' }];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: Array.from({ length: RPG_LIMITS.switches }, (_, n) => ({
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'setSwitch', switch: n }]
          }))
        }
      }
    }
  ];
  assert.equal(firstFreeSwitch(project), null);
});

test('every template builds an event the engine can actually run', () => {
  const project = createProject('Templates', 'rpg');
  project.sprites.actors = [{ name: 'Gem', behavior: 'pickup' }];

  for (const template of EVENT_TEMPLATES) {
    const free = firstFreeSwitch(project);
    const event = template.build(project, free);
    assert.ok(event.pages.length >= 2, `${template.id} needs a fallback page`);

    for (const page of event.pages) {
      assert.ok(
        EVENT_CONDITIONS.some((entry) => entry.id === page.cond.type),
        `${template.id} uses a condition that exists`
      );
      assert.ok(page.commands.length, `${template.id} has no page that does nothing`);
      for (const command of page.commands) {
        assert.ok(IMPLEMENTED_COMMANDS.has(command.op), `${template.id} uses only implemented commands`);
        const spec = EVENT_COMMANDS.find((entry) => entry.id === command.op);
        for (const arg of spec.args) assert.notEqual(command[arg], undefined, `${template.id}: ${command.op}.${arg}`);
      }
    }

    // The one guarantee a template makes: the guard is a switch nobody else
    // holds, and the pages survive normalization unchanged.
    const guard = event.pages[0].cond;
    if (guard.type === 'switchOff' || guard.type === 'switchOn') assert.equal(guard.arg, free);
    project.maps[0].screens[0].entities = [{ actorId: 0, x: 0, y: 0, props: { event } }];
    const normalized = normalizeProject(structuredClone(project));
    assert.deepEqual(normalized.maps[0].screens[0].entities[0].props.event, event, `${template.id} round-trips`);
  }
});

test('templates that need a party are hidden from a project without one', () => {
  const action = createProject('Action');
  const rpg = createProject('Quest', 'rpg');
  assert.ok(templatesFor(rpg).some((entry) => entry.id === 'recruit'));
  assert.ok(!templatesFor(action).some((entry) => entry.id === 'recruit'));
  assert.ok(templatesFor(action).length, 'an action project still gets the rest');
});

test('a template hands over an actual pickup where the project has one', () => {
  const project = createProject('Give');
  project.sprites.actors = [
    { name: 'Villager', behavior: 'npc' },
    { name: 'Gem', behavior: 'pickup' }
  ];
  const chest = EVENT_TEMPLATES.find((entry) => entry.id === 'chest').build(project, 0);
  const give = chest.pages[0].commands.find((command) => command.op === 'give');
  assert.equal(give.actor, 1, 'the gem, not the villager');
});
