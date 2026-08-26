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
  createPartyMember,
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
  // "Carrying item" puts an item id in the same field.
  const carrying = createProject('Carrying');
  carrying.maps[0].screens[0].entities = [
    { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'hasItem', arg: 7 }, commands: [] }] } } }
  ];
  assert.equal(usedSwitches(carrying).has(7), false, 'an item id is not a switch');
});

test('a switch hides just as well inside a branch or an answer', () => {
  // The scan used to read only a page's own list, so every command that holds
  // commands was a new place a switch could sit unseen — and an unseen switch is
  // one a template hands out again. One nested case per kind, and one nested
  // inside the other, because the whole claim is that depth does not matter.
  const project = createProject('Nested');
  project.sprites.actors = [{ name: 'NPC', behavior: 'npc' }];
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
                  op: 'branch',
                  // A branch carries the same condition object a page does, so
                  // it is the same place to hide as a page's.
                  cond: { type: 'switchOn', arg: 11 },
                  then: [{ op: 'setSwitch', switch: 12 }],
                  else: [
                    {
                      op: 'choice',
                      options: [
                        { text: 'Yes', commands: [{ op: 'clearSwitch', switch: 13 }] },
                        {
                          text: 'No',
                          commands: [
                            {
                              op: 'branch',
                              cond: { type: 'switchOff', arg: 14 },
                              then: [{ op: 'setSwitch', switch: 15, off: true }],
                              else: []
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  ];

  const used = usedSwitches(project);
  for (const n of [11, 12, 13, 14]) assert.ok(used.has(n), `switch ${n} was not seen`);
  // Including one on a switched-off command: the toggle is about what the ROM
  // runs, and a line you are about to switch back on still names a switch that
  // is spoken for.
  assert.ok(used.has(15), 'a switched-off command still spends its switch');
  assert.equal(firstFreeSwitch(project), 0, 'nothing below 11 is in use');
});

test('a switch hides in a common event too, even one no placement calls yet', () => {
  // A call does not carry the callee's commands inline the way a branch or a
  // question does -- it names a common event by index -- so following `call`
  // edges would miss one authored but not yet wired up anywhere. Scanning
  // every common event directly, the way every placement is already scanned,
  // catches it regardless.
  const project = createProject('Common');
  project.sprites.actors = [{ name: 'Chest', behavior: 'npc' }];
  project.commonEvents = [
    {
      name: 'Reset',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 20 }] }] }
    }
  ];
  assert.ok(usedSwitches(project).has(20), 'a switch set only inside a common event was not seen');
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
  // A real project always reaches this point already migrated (`store.project`
  // is normalized); this test builds one by hand, so it has to set the item
  // a real one would already carry for the pickup above.
  project.items = [{ id: 0, name: 'Gem', actorId: 0, metaspriteId: null }];
  project.party.push(createPartyMember(1, 'Mage')); // so Recruit is buildable

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

test('Recruit is offered only once there is somebody left to recruit', () => {
  const action = createProject('Action');
  const rpg = createProject('Quest', 'rpg');
  const has = (project) => templatesFor(project).some((entry) => entry.id === 'recruit');
  const memberOf = (project) =>
    EVENT_TEMPLATES.find((entry) => entry.id === 'recruit')
      .build(project, 0)
      .pages[0].commands.find((command) => command.op === 'join').member;

  assert.equal(has(action), false, 'an action build does not assemble the battle bank');
  // A new RPG has only the hero, who is in the party from boot. Offering
  // Recruit here would compile a member index past the end of the generated
  // tables — party_join would read somebody else's stats.
  assert.equal(rpg.party.length, 1);
  assert.equal(has(rpg), false, 'nobody to recruit yet');

  rpg.party.push(createPartyMember(1, 'Mage'));
  assert.equal(has(rpg), true);
  assert.equal(memberOf(rpg), 1, 'an actual party member, and never the hero');

  // Length is not the question — `startsInParty` is authorable per member, so a
  // party of four can still have nobody to recruit. Recruiting somebody already
  // in the party is a conversation that does nothing and then sets the switch
  // that says it happened.
  rpg.party.push(createPartyMember(2, 'Knight'));
  rpg.party[2].startsInParty = true;
  assert.equal(memberOf(rpg), 1, 'the Mage, not the Knight who is already here');

  rpg.party[1].startsInParty = true;
  assert.equal(has(rpg), false, 'a full party with nobody left to join');

  assert.ok(templatesFor(action).length, 'an action project still gets the rest');
});

test('a template hands over an actual pickup where the project has one', () => {
  const project = createProject('Give');
  project.sprites.actors = [
    { name: 'Villager', behavior: 'npc' },
    { name: 'Gem', behavior: 'pickup' }
  ];
  project.items = [{ id: 0, name: 'Gem', actorId: 1, metaspriteId: null }];
  const chest = EVENT_TEMPLATES.find((entry) => entry.id === 'chest').build(project, 0);
  const give = chest.pages[0].commands.find((command) => command.op === 'give');
  assert.equal(give.item, 0, 'the gem’s item, not the villager');
});

test('a template with no pickup at all hands over a reference itemMissing calls missing, never item 0', () => {
  // firstPickup() (renderer/forges/map/templates.js) used to fall back to
  // actor 0 -- usually the player -- when the project had no pickup yet.
  // Porting that `?? 0` into the item id space would repeat the same defect
  // one id space over; it must fall back to `null` instead.
  const project = createProject('Empty');
  const chest = EVENT_TEMPLATES.find((entry) => entry.id === 'chest').build(project, 0);
  const give = chest.pages[0].commands.find((command) => command.op === 'give');
  assert.equal(give.item, null, 'nothing to give yet should read as missing, not item 0');

  const gate = EVENT_TEMPLATES.find((entry) => entry.id === 'lockedGate').build(project, 0);
  assert.equal(gate.pages[0].cond.arg, null, 'nothing to carry yet should read as missing, not item 0');
});
