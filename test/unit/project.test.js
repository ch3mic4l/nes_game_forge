import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  createPartyMember,
  createSpell,
  normalizeProject,
  reconcileCartridge,
  validateProject,
  ACTIONS,
  BEHAVIORS,
  BUTTONS,
  INPUT_STATES,
  LIMITS,
  RPG_LIMITS,
  SCREEN_METATILES,
  COLLISION_TYPES,
  collisionIndex,
  AUTHOR_NAME_MAX,
  createMap,
  createScreen,
  screenLabel,
  entityLabel,
  flatScreens,
  resolveCommonEventIds,
  commonEventId,
  renumberSongDeletion,
  renumberActorDeletion,
  battleFormationSlice,
  liveCommands,
  compiledPages,
  projectEvents,
  CHOICE_LIMITS,
  EVENT_COMMANDS
} from '../../shared/project.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { resolveMapper, rpgCapable } from '../../shared/cartridge.js';
import { flattenScreens } from '../../main/build/generate.js';
import { compileText, opIndex, OP_JUMP } from '../../main/build/textcompile.js';
import { FONT_BASE } from '../../shared/font.js';
import { BLANK_TILE } from '../../shared/chr.js';
import { spawnSync } from 'node:child_process';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

test('a new project satisfies its own schema', () => {
  const project = createProject('Demo');
  assert.equal(project.project.name, 'Demo');
  assert.equal(project.tilesets.length, 1);
  assert.equal(project.tilesets[0].background.tiles.length, LIMITS.tilesPerTable);
  assert.equal(project.tilesets[0].background.tiles[0], BLANK_TILE);
  assert.equal(project.tilesets[0].sprites.tiles.length, LIMITS.tilesPerTable);
  assert.equal(project.cartridge.mapper, 0);
  assert.equal(project.metatiles.length, LIMITS.metatiles);
  assert.equal(project.maps[0].screens[0].metatiles.length, SCREEN_METATILES);
  assert.deepEqual(validateProject(project), []);
});

test('normalizeProject is idempotent on a fresh project', () => {
  const project = createProject('Demo');
  assert.deepEqual(normalizeProject(structuredClone(project)), project);
});

test('normalizeProject repairs junk without throwing', () => {
  const project = normalizeProject({
    project: { name: '', startMap: 99, startX: -5 },
    tilesets: { background: { tiles: ['nope', 42] } },
    palettes: { bg: [[999, -1, 'x', 3]] },
    metatiles: [{ tiles: [1000, -3], palette: 9, collision: 'lava' }],
    maps: [{ gridW: 99, gridH: 0, screens: [{ metatiles: [999, -4] }] }],
    input: { states: { gameplay: { A: 'teleport' } } }
  });
  assert.equal(project.project.startMap, 0);
  assert.equal(project.project.startX, 0);
  assert.equal(project.tilesets[0].background.tiles[0], BLANK_TILE);
  assert.ok(project.palettes.bg[0].every((value) => value >= 0 && value <= 0x3f));
  assert.equal(project.metatiles[0].collision, 'open');
  // Out-of-range numbers are clamped into range; only non-numeric junk falls
  // back to the default.
  assert.ok(project.metatiles[0].palette < LIMITS.palettes);
  assert.ok(project.metatiles[0].tiles.every((value) => value >= 0 && value < LIMITS.tilesPerTable));
  assert.equal(project.maps[0].gridW, LIMITS.mapGrid);
  assert.equal(project.maps[0].gridH, 1);
  assert.equal(project.maps[0].screens.length, LIMITS.mapGrid);
  assert.ok(project.maps[0].screens[0].metatiles.every((value) => value < LIMITS.metatiles));
  // An unknown action falls back to the default binding rather than persisting.
  assert.equal(project.input.states.gameplay.A, 'attack');
});

test('every background palette shares one backdrop colour', () => {
  const project = normalizeProject({
    palettes: {
      bg: [
        [0x21, 1, 2, 3],
        [0x0f, 4, 5, 6],
        [0x30, 7, 8, 9],
        [0x11, 10, 11, 12]
      ],
      sprite: [
        [0x05, 1, 2, 3],
        [0x06, 4, 5, 6],
        [0x07, 7, 8, 9],
        [0x08, 10, 11, 12]
      ]
    }
  });
  const backdrop = project.palettes.bg[0][0];
  assert.equal(backdrop, 0x21);
  for (const palette of [...project.palettes.bg, ...project.palettes.sprite]) {
    assert.equal(palette[0], backdrop);
  }
});

test('map screen count always matches its grid', () => {
  const project = normalizeProject({ maps: [{ gridW: 3, gridH: 2, screens: [] }] });
  assert.equal(project.maps[0].screens.length, 6);
  for (const screen of project.maps[0].screens) {
    assert.equal(screen.metatiles.length, SCREEN_METATILES);
  }
});

test('validateProject flags entity overflow', () => {
  const project = createProject('Demo');
  project.maps[0].screens[0].entities = Array.from({ length: LIMITS.entitiesPerScreen + 2 }, () => ({
    actorId: 0,
    x: 0,
    y: 0,
    props: {}
  }));
  const problems = validateProject(project);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].severity, 'error');
  assert.match(problems[0].message, /entities/);
});

test('collision types map to stable engine indices', () => {
  assert.equal(collisionIndex('open'), 0);
  assert.equal(collisionIndex('solid'), 1);
  assert.equal(COLLISION_TYPES[0].id, 'open');
  // Unknown ids must not produce a negative index the generator would emit.
  assert.equal(collisionIndex('nonsense'), 0);
});

// --------------------------------------------------------------- game types

test('a project is an action game unless it says otherwise', () => {
  const action = createProject('Quest');
  assert.equal(action.project.gameType, 'action');
  assert.equal(action.cartridge.mapper, 0);
  assert.deepEqual(action.party, []);

  // A project written before game types existed had no battle system, so
  // reading one as an action game is the only answer that cannot break it.
  const legacy = normalizeProject({ project: { name: 'Old' } });
  assert.equal(legacy.project.gameType, 'action');
});

test('an RPG starts on a board that can actually hold one', () => {
  const rpg = createProject('Quest', 'rpg');
  assert.equal(rpg.project.gameType, 'rpg');
  assert.ok(rpgCapable(resolveMapper(rpg.cartridge.mapper)), 'default RPG mapper is RPG-capable');
  assert.equal(rpg.tilesets.length, 2, 'a battle tileset comes for free');
  assert.equal(rpg.rpg.battleTilesetId, 1);
  assert.equal(rpg.party.length, 1, 'someone has to be playable');
  assert.deepEqual(validateProject(rpg).filter((p) => p.severity === 'error'), []);
});

test('turning a project into an RPG raises the mapper, and only then', () => {
  const project = createProject('Quest');
  project.project.gameType = 'rpg';
  reconcileCartridge(project);
  assert.ok(rpgCapable(resolveMapper(project.cartridge.mapper)));

  // Loading a file never silently upgrades it: normalize keeps its downward-only
  // fallback, so a hand-edited RPG on NROM stays on NROM and fails validation
  // with an explanation instead of quietly changing the cartridge.
  const loaded = normalizeProject({ project: { name: 'Hand', gameType: 'rpg' }, cartridge: { mapper: 0 } });
  assert.equal(loaded.cartridge.mapper, 0);
  const problems = validateProject(loaded).filter((p) => p.severity === 'error');
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /program bank switching/);
});

test('every input state carries a full row of bindings', () => {
  const project = createProject('Demo');
  assert.deepEqual(Object.keys(project.input.states), INPUT_STATES);
  for (const state of INPUT_STATES) {
    for (const button of BUTTONS) {
      assert.ok(ACTIONS.some((a) => a.id === project.input.states[state][button]));
    }
  }
});

test('an input file from before the new states back-fills them', () => {
  // The order of INPUT_STATES is the wire format, so the rows that existed must
  // survive untouched while the new ones appear with their defaults.
  const project = normalizeProject({
    input: { states: { gameplay: { A: 'dash', B: 'item' }, menu: { A: 'cancel' } } }
  });
  assert.equal(project.input.states.gameplay.A, 'dash');
  assert.equal(project.input.states.gameplay.B, 'item');
  assert.equal(project.input.states.menu.A, 'cancel');
  assert.equal(project.input.states.battle.A, 'confirm');
  assert.equal(project.input.states.title.START, 'confirm');
});

// ------------------------------------------------------- events and actors

test('entity props keep dialogue, events and hide switches in range', () => {
  const project = normalizeProject({
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 1,
                x: 10,
                y: 20,
                props: {
                  dialogue: 'x'.repeat(500),
                  hideSwitch: 999,
                  colour: 'kept', // unknown props still ride along
                  event: {
                    pages: [
                      {
                        cond: { type: 'switchOn', arg: 999 },
                        commands: [
                          { op: 'say', text: 'Hello.' },
                          { op: 'setSwitch', switch: 300 },
                          { op: 'nonsense' },
                          { op: 'warp', screen: 2, x: 40, y: 50 }
                        ]
                      }
                    ]
                  }
                }
              }
            ]
          }
        ]
      }
    ]
  });
  const { props } = project.maps[0].screens[0].entities[0];
  assert.ok(props.dialogue.length <= 240);
  assert.equal(props.hideSwitch, RPG_LIMITS.switches - 1);
  assert.equal(props.colour, 'kept');
  assert.equal(props.event.pages[0].cond.arg, RPG_LIMITS.switches - 1);
  // The unknown command is dropped rather than compiled into a bad opcode.
  assert.deepEqual(props.event.pages[0].commands.map((c) => c.op), ['say', 'setSwitch', 'warp']);
  assert.equal(props.event.pages[0].commands[1].switch, RPG_LIMITS.switches - 1);
});

test('an entity with no event stores null rather than an empty shell', () => {
  const project = normalizeProject({ maps: [{ screens: [{ entities: [{ actorId: 0, x: 1, y: 2 }] }] }] });
  const { props } = project.maps[0].screens[0].entities[0];
  assert.equal(props.event, null);
  assert.equal(props.hideSwitch, null);
  assert.equal(props.dialogue, '');
});

test('a common event keeps its id through normalization, however it is deleted', () => {
  // A `call` command carries a common event's id, not its row in the list, so
  // normalizeCommonEvents has to hand back the same id for the same entry
  // every time it is asked — and never hand out an id something else in the
  // list is already using, or two calls would end up naming the same slot.
  const project = normalizeProject({
    commonEvents: [
      { id: 5, name: 'A', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'A' }] }] } },
      { id: 2, name: 'B', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'B' }] }] } }
    ]
  });
  assert.deepEqual(
    project.commonEvents.map((entry) => entry.id),
    [5, 2],
    'an authored id was renumbered even though nothing collided'
  );
  // Nothing else in this project has ever claimed 6 or higher, so the next
  // fresh id has to start there — one past the highest id actually in use,
  // whatever seq the project came in with.
  assert.equal(project.commonEventSeq, 6);

  // A hand-edited duplicate is not trusted as-is — the second one spending an
  // id the first already claimed is exactly the corruption ids exist to rule
  // out — so it is handed a fresh one instead. Not the lowest free id: 0 was
  // never spent by this list, but handing it out here would be exactly the
  // reuse ids are for ruling out one step removed from a deletion rather than
  // reachable straight from this one project alone.
  const collided = normalizeProject({
    commonEvents: [
      { id: 3, name: 'First', event: null },
      { id: 3, name: 'Second', event: null }
    ]
  });
  assert.deepEqual(collided.commonEvents.map((entry) => entry.id), [3, 4]);
  assert.equal(collided.commonEventSeq, 5);

  // Old projects saved before common events existed carry none, and one
  // loaded from a version that never numbered them gets sequential ids
  // starting from 0 — not from array position blindly, which is exactly the
  // bug this id exists to avoid reintroducing.
  const legacy = normalizeProject({ commonEvents: [{ name: 'X' }, { name: 'Y' }] });
  assert.deepEqual(legacy.commonEvents.map((entry) => entry.id), [0, 1]);
  assert.equal(legacy.commonEventSeq, 2);
});

test('a common event id is never reused, even after the entry that held it is deleted', () => {
  // The whole reason an id is not simply "the lowest one free": the lowest
  // free id is exactly the one a deletion just vacated, so handing it to the
  // next entry added would retarget any call still naming the one that was
  // removed — the identical failure a stable id exists to rule out, just
  // deferred by one edit. commonEventSeq is what remembers the ceiling
  // independently of which ids the current list happens to hold.
  let project = normalizeProject({
    commonEvents: [
      { name: 'A', event: null },
      { name: 'B', event: null }
    ]
  });
  assert.deepEqual(project.commonEvents.map((e) => e.id), [0, 1]);
  assert.equal(project.commonEventSeq, 2);

  // Delete A (id 0) the way the list editor's ✕ does: a plain splice.
  project.commonEvents = project.commonEvents.filter((entry) => entry.id !== 0);
  project = normalizeProject(project); // a save/load round trip carries the project through unchanged
  assert.deepEqual(project.commonEvents.map((e) => e.id), [1]);
  assert.equal(project.commonEventSeq, 2, 'the ceiling must not fall back down just because 0 is unused again');

  // Add a replacement. It must not be handed 0 back.
  project.commonEvents.push({ id: project.commonEventSeq, name: 'C', event: null });
  project.commonEventSeq += 1;
  project = normalizeProject(project);
  assert.deepEqual(project.commonEvents.map((e) => e.id), [1, 2], 'the freed id 0 was handed to the replacement');
  assert.equal(project.commonEventSeq, 3);
});

test('resolveCommonEventIds never reuses an id below the persisted seq', () => {
  // The unit `normalizeCommonEvents` is built on, exercised directly: a seq
  // ahead of every id actually in the list still has to win over "the lowest
  // id nothing here is using" — that lower number is a retired id, not a
  // free one, and only `seq` remembers the difference.
  const { ids, seq } = resolveCommonEventIds([{ name: 'Only survivor' }], 6);
  assert.deepEqual(ids, [6], 'a fresh id must come from the seq, not from position 0');
  assert.equal(seq, 7);

  // A seq lower than an id actually present is corrected upward rather than
  // trusted — a hand-edited file could easily understate it.
  const corrected = resolveCommonEventIds([{ id: 9 }], 2);
  assert.deepEqual(corrected.ids, [9]);
  assert.equal(corrected.seq, 10);
});

test('commonEventId rejects everything past the safe integer range, not only non-integers', () => {
  // Number.isInteger accepts 2**53 and every double above it that still
  // rounds to a whole number, but none of them has a unique successor —
  // `n + 1 === n` past that point — so a counter built on a merely-integer
  // check could hand out the same id twice. Number.isSafeInteger is the
  // actual boundary this has to hold at.
  const unsafe = Number.MAX_SAFE_INTEGER + 1; // 9007199254740992
  assert.equal(Number.isInteger(unsafe), true, 'the test is not exercising anything if this is false');
  assert.equal(commonEventId(unsafe), null);
  assert.equal(commonEventId(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER, 'the boundary itself is still valid');

  // `Number(null)` is 0, not NaN — the one input commonEventId cannot afford
  // to run through a bare Number() call, or a missing reference reads as a
  // request for common event 0 rather than as missing.
  assert.equal(commonEventId(null), null);
  assert.equal(commonEventId(undefined), null);
  assert.equal(commonEventId(''), null);

  // A numeric string is still a valid id — the compiler has to accept this
  // exact input too, since it is what an unnormalized live command can hold.
  assert.equal(commonEventId('5'), 5);
  assert.equal(commonEventId(-3), null);
  assert.equal(commonEventId(2.5), null);

  // An entry authored with an unsafe id cannot be trusted with it, so it is
  // reassigned — from a seq that itself cannot be trusted past this range
  // either, which is why it also falls back rather than trying to advance.
  const project = normalizeProject({
    commonEvents: [{ id: unsafe, name: 'Unsafe', event: null }],
    commonEventSeq: unsafe
  });
  assert.notEqual(project.commonEvents[0].id, unsafe);
  assert.ok(Number.isSafeInteger(project.commonEvents[0].id));
  assert.ok(Number.isSafeInteger(project.commonEventSeq));
});

test('commonEventId rejects values that only coerce to 0, not values that are 0', () => {
  // Number(false), Number([]) and Number('   ') are all 0, same as
  // Number('0') — so a bare Number() call cannot tell a malformed reference
  // from a request for common event 0. Guarding the input's type first is
  // what keeps a hand-edited `false` or `[]` from silently resolving to
  // whichever common event actually holds id 0.
  assert.equal(commonEventId(false), null);
  assert.equal(commonEventId(true), null);
  assert.equal(commonEventId([]), null);
  assert.equal(commonEventId([0]), null);
  assert.equal(commonEventId({}), null);
  assert.equal(commonEventId('   '), null);
  assert.equal(commonEventId('0'), 0, 'a genuinely numeric string for 0 is still valid');
  assert.equal(commonEventId(0), 0, 'and so is the number itself');
});

test('an invalid call reference normalizes to NO_COMMON_EVENT_ID, never to 0', () => {
  // 0 is an id a common event can actually be sitting at, so falling back to
  // it for a reference that could not be understood would silently retarget
  // a dangling or hand-edited call to whatever that one happens to be —
  // exactly the bug a stable id exists to rule out, from the other end.
  const project = normalizeProject({
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: -7 }] }] } }
              }
            ]
          }
        ]
      }
    ]
  });
  const call = project.maps[0].screens[0].entities[0].props.event.pages[0].commands[0];
  assert.equal(call.op, 'call');
  assert.notEqual(call.event, 0);
  assert.equal(commonEventId(call.event), null, 'the normalized reference must still fail commonEventId');
});

// The disk is a separate schema from the in-memory one, and commonEventSeq in
// particular is easy to lose without a test noticing: a project whose surviving
// common events happen to imply the same ceiling the counter already holds would
// pass even with the field silently dropped from project-io.js. Both cases below
// are built so the current list cannot reconstruct the right answer on its own.
test('commonEventSeq survives a disk round trip even when the surviving list could not reconstruct it', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-seq-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // One low-numbered survivor; the seq is far ahead of anything it implies.
  const project = normalizeProject({
    commonEvents: [{ id: 3, name: 'Survivor', event: null }],
    commonEventSeq: 40
  });
  assert.equal(project.commonEventSeq, 40);
  await saveProject(dir, project);
  const reopened = await loadProject(dir);
  assert.equal(reopened.commonEventSeq, 40, 'the seq did not survive the round trip');
  assert.equal(reopened.commonEvents[0].id, 3, 'the survivor itself round-tripped');

  // Nothing survives at all, so there is nothing left in the list that could
  // even hint at a minimum for the seq to fall back on.
  const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-seq-empty-'));
  t.after(() => fs.rm(emptyDir, { recursive: true, force: true }));
  const emptied = normalizeProject({ commonEvents: [], commonEventSeq: 40 });
  assert.equal(emptied.commonEventSeq, 40);
  await saveProject(emptyDir, emptied);
  const reopenedEmpty = await loadProject(emptyDir);
  assert.equal(reopenedEmpty.commonEventSeq, 40, 'an empty list must not reset the seq back to 0');
});

test('actors carry battle stats whether or not the project uses them', () => {
  const project = normalizeProject({
    sprites: { actors: [{ name: 'Slime', damage: 99, battle: { atk: 300, weak: 'plaid', dropPct: 1000 } }] }
  });
  const actor = project.sprites.actors[0];
  assert.equal(actor.damage, 8, 'contact damage is clamped');
  assert.equal(actor.battle.atk, 255);
  assert.equal(actor.battle.weak, 'none', 'an unknown element falls back rather than reaching the ROM');
  assert.equal(actor.battle.dropPct, 100);
  assert.equal(actor.battle.battleTile, null, 'no battle art means draw the metasprite instead');
});

test('the npc behaviour is a real behaviour with a stable index', () => {
  assert.equal(BEHAVIORS[BEHAVIORS.length - 1].id, 'npc', 'appended, because the order is the wire format');
  const project = normalizeProject({ sprites: { actors: [{ name: 'Elder', behavior: 'npc' }] } });
  assert.equal(project.sprites.actors[0].behavior, 'npc');
});

// -------------------------------------------------------- party and spells

test('party members and spells clamp against each other', () => {
  const project = normalizeProject({
    project: { gameType: 'rpg' },
    cartridge: { mapper: 1 },
    spells: [{ name: 'Fire', mpCost: 500, kind: 'wat', element: 'fire', amount: 900 }],
    party: [
      { name: 'Hero', baseHp: 999 },
      { name: 'Mage', startsInParty: false, spells: [{ spellId: 0, level: 99 }, { spellId: 7, level: 2 }] }
    ]
  });
  assert.equal(project.spells[0].mpCost, 99);
  assert.equal(project.spells[0].kind, 'damage');
  assert.equal(project.spells[0].amount, 255);
  assert.equal(project.party[0].baseHp, 255);
  assert.equal(project.party[0].startsInParty, true, 'the first member always starts');
  assert.equal(project.party[1].startsInParty, false);
  // A spell reference past the end of the list is dropped, and the level is
  // clamped to the progression's own ceiling.
  assert.equal(project.party[1].spells.length, 1);
  assert.equal(project.party[1].spells[0].level, project.rpg.maxLevel);
});

test('a party is capped and an RPG never ends up with nobody in it', () => {
  const project = normalizeProject({
    project: { gameType: 'rpg' },
    cartridge: { mapper: 1 },
    party: Array.from({ length: 9 }, (_, i) => ({ name: `M${i}` }))
  });
  assert.equal(project.party.length, RPG_LIMITS.party);

  const empty = normalizeProject({ project: { gameType: 'rpg' }, cartridge: { mapper: 1 }, party: [] });
  assert.equal(empty.party.length, 1);
});

test('maps carry a battle backdrop and an encounter table', () => {
  const project = normalizeProject({
    maps: [{ battleGroundTile: 900, encounters: { rate: 400, actorIds: [1, 2, 3, 4, 5, 6] } }]
  });
  const map = project.maps[0];
  assert.equal(map.battleGroundTile, LIMITS.tilesPerTable - 1);
  assert.equal(map.encounters.rate, 255);
  assert.equal(map.encounters.actorIds.length, RPG_LIMITS.encounterActors);

  // No encounter table at all means no wandering monsters, not a default one.
  assert.equal(normalizeProject({ maps: [{}] }).maps[0].encounters.rate, 0);
});

test('deleting a song renumbers every reference, including one nested inside a branch', () => {
  const project = createProject();
  project.songs = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  project.maps[0].songId = 2;
  project.maps.push(createMap(1, 'Second'));
  project.maps[1].songId = 1; // names the song about to be deleted
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
                  cond: { type: 'none', arg: 0 },
                  // A switch used only inside a branch was once invisible to
                  // usedSwitches for exactly this reason — a song named only
                  // here has to be found the same way a switch is.
                  then: [{ op: 'music', song: 2 }],
                  else: [{ op: 'music', song: 0 }]
                },
                { op: 'music', song: null }
              ]
            }
          ]
        }
      }
    }
  ];

  renumberSongDeletion(project, 1); // delete the middle song, "B"

  assert.equal(project.maps[0].songId, 1, 'a map naming a song above the deleted one should shift down');
  assert.equal(project.maps[1].songId, null, 'a map naming the deleted song should go silent');

  const [branch, silence] = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  assert.equal(branch.then[0].song, 1, 'a Play music command nested inside a branch did not renumber');
  assert.equal(branch.else[0].song, 0, 'a reference below the deleted song should not move');
  assert.equal(silence.song, null, 'Silence should stay Silence');
});

test('deleting an actor renumbers Give/Take item as well as a battle formation, nested or not', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
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
                { op: 'give', actor: 1 }, // names the actor about to be deleted
                { op: 'take', actor: 2 }, // above it — should shift down
                { op: 'battle', monsters: [1, 2, 3] },
                {
                  op: 'branch',
                  cond: { type: 'none', arg: 0 },
                  then: [{ op: 'give', actor: 1 }],
                  else: [{ op: 'take', actor: 3 }]
                },
                {
                  op: 'choice',
                  options: [{ text: 'Take it', commands: [{ op: 'give', actor: 2 }] }]
                }
              ]
            }
          ]
        }
      }
    }
  ];

  renumberActorDeletion(project, 1); // delete "B"

  const commands = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  // Nothing is dropped -- a Give/Take naming exactly the deleted actor
  // becomes visibly missing (actor: null) rather than erasing whatever else
  // the event went on to do.
  assert.deepEqual(
    commands.map((c) => c.op),
    ['give', 'take', 'battle', 'branch', 'choice']
  );
  const [give, take, battle, branch, choice] = commands;
  assert.equal(give.actor, null, 'a Give item command naming exactly the deleted actor should read as missing');
  assert.equal(take.actor, 1, 'a Take item command naming an actor above the deleted one should shift down');
  assert.deepEqual(battle.monsters, [1, 2], 'the deleted actor drops out of the formation and the rest shift down');
  assert.equal(branch.then[0].actor, null, 'a Give item nested in a branch names the deleted actor the same way');
  assert.equal(branch.else[0].actor, 2, 'a reference below the deleted actor inside a branch should not move');
  assert.equal(choice.options[0].commands[0].actor, 1, 'a reference inside a question option should renumber too');
});

test('a live Give/Take with a missing actor blocks the build; a switched-off one does not', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'Gem' }];
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: null }] }] }
    }
  });
  const errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /do not name a real/);

  // Switching it off is the same escape hatch the previous round's finding
  // gave a disabled battle command: scaffolding that names nothing real
  // must not be what stands between an author and a build.
  project.maps[0].screens[0].entities[0].props.event.pages[0].commands[0].off = true;
  assert.deepEqual(validateProject(project).filter((p) => p.severity === 'error'), []);
});

test('the give/take check applies to an action project too, and now refuses a build it used to allow', {
  skip: !hasNesasm && 'nesasm not found on PATH'
}, async (t) => {
  // Give/Take is a base-engine command (engine/ui.asm's add_item/inv_items),
  // not one BATTLE_ENABLED gates, so an action project offers it same as an
  // RPG does -- but the check itself lived inside validateProject's
  // gameType === 'rpg' block until this round, which made it unreachable
  // for exactly this project type. A project that built cleanly on 38001c6
  // with a stale give/take id can fail here now: that is the intended
  // effect of moving the check where the command actually lives, not a
  // regression, but it is a compatibility change and deserves its own
  // regression test rather than riding along on an RPG one that could never
  // have caught it going missing again.
  const project = createProject('Quest'); // action, the default gameType
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: 99 }] }] } }
  });

  const errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1, 'an action project should get the same validateProject error an RPG does');
  assert.match(errors[0].message, /do not name a real/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-action-give-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  await assert.rejects(
    buildProject({ dir, project, log: () => {} }),
    /do not name a real/,
    'buildProject should refuse this project rather than compiling actor 99 into the ROM as-is'
  );
});

test('a Run common event command naming a deleted common event fails validation and cannot build', {
  skip: !hasNesasm && 'nesasm not found on PATH'
}, async (t) => {
  // This gap predates the battle command entirely -- it came in with common
  // events themselves (490c71e) -- and was never caught because nothing
  // asked whether a call's target still resolved. Reproduces the sequence
  // that reads as silent data loss: Call Reward, then Set switch Quest
  // complete, with the Reward common event gone. Before this fix, the call
  // just compiled away and the switch still got set as though Reward had
  // run.
  const QUEST_COMPLETE = 5;
  const project = createProject('Quest');
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.commonEvents = []; // Reward has been deleted; nothing defines id 0 any more
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'call', event: 0 }, { op: 'setSwitch', switch: QUEST_COMPLETE }]
          }
        ]
      }
    }
  });

  const errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /no longer exists or has nothing left in it/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-dangling-call-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  await assert.rejects(
    buildProject({ dir, project, log: () => {} }),
    /no longer exists or has nothing left in it/,
    'buildProject should refuse this project rather than silently dropping the call and setting the switch anyway'
  );

  // liveCommands still yields the dangling call -- that half is unchanged
  // and is not what this fix touches.
  const [command] = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  const live = [...liveCommands([command], CHOICE_LIMITS.options)];
  assert.equal(live.length, 1, 'liveCommands should still yield the structurally live call');
  assert.equal(live[0].op, 'call');
});

test("a Give/Take's missing actor survives normalize instead of clamping to a real one", () => {
  const project = normalizeProject({
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                x: 0,
                y: 0,
                props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: null }] }] } }
              }
            ]
          }
        ]
      }
    ]
  });
  const [command] = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  assert.equal(command.actor, null, 'the generic byte clamp would have turned this into actor 0 -- a real actor id');
  // And a second pass leaves it exactly where the first one did.
  assert.deepEqual(normalizeProject(structuredClone(project)).maps, project.maps);
});

test('a title screen pointing at a deleted map falls back to none', () => {
  const project = normalizeProject({ project: { titleMap: 5, titleScreen: 9 }, maps: [{}] });
  assert.equal(project.project.titleMap, null);
});

test('validateProject refuses artwork under the message font', () => {
  const project = createProject('Talky');
  project.maps[0].screens[0].entities.push({ actorId: 0, x: 0, y: 0, props: { dialogue: 'Hi.' } });
  assert.deepEqual(validateProject(project), [], 'blank reserved tiles are fine');

  project.tilesets[0].background.tiles[FONT_BASE + 4] = '3'.repeat(64);
  const problems = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].where, 'Tile Forge');
  assert.match(problems[0].message, /message font/);
});

test('a battle command whose every monster id has gone stale is flagged the same as an empty one', () => {
  // Deleting the only actor a formation named leaves the array non-empty but
  // every id in it out of range -- textcompile.js clamps each one to
  // NO_ACTOR, so this compiles to the identical instant win an
  // authored-empty formation does. Validation has to judge the formation by
  // what survives normalization, not by whether the array started out empty.
  const project = createProject('Quest', 'rpg');
  project.sprites.actors.push({ name: 'Slime', damage: 10 });
  const staleId = project.sprites.actors.length; // never assigned to any actor
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'battle', monsters: [staleId] }] }] }
    }
  });
  const errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /name no monsters/);

  // A formation that still has at least one real monster left is a warning,
  // not a build-stopping error -- it still compiles to a fight.
  project.maps[0].screens[0].entities[0].props.event.pages[0].commands[0].monsters = [0, staleId];
  assert.deepEqual(validateProject(project).filter((p) => p.severity === 'error'), []);
  const warnings = validateProject(project).filter((p) => p.severity === 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /name an actor that/);
});

test('a switched-off battle command does not block the build, wherever it is nested', () => {
  // A disabled command is authoring scaffolding: the compiler's own
  // traversal (encodeBody, main/build/textcompile.js) skips it, so a build
  // must not stop for something the ROM was never going to contain.
  const project = createProject('Quest', 'rpg');
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      trigger: 'touch',
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'battle', monsters: [], off: true },
              {
                op: 'branch',
                off: true,
                cond: { type: 'none', arg: 0 },
                then: [{ op: 'battle', monsters: [] }],
                else: []
              },
              { op: 'say', text: 'Still here.' }
            ]
          }
        ]
      }
    }
  });
  assert.deepEqual(validateProject(project).filter((p) => p.severity === 'error'), []);
});

const OP_END = opIndex('end');

// Fixed width in bytes -- opcode plus its own arguments -- for every
// EVENT_COMMANDS entry that is not self-describing (branch and choice carry
// their own length bytes and are decoded structurally instead; see
// decodeOpSequence). Mirrors the args each one has in shared/project.js, not
// a second guess at it: one entry per arg, one byte each, plus the opcode.
const FIXED_OPCODE_WIDTH = {
  say: 2,
  give: 2,
  take: 2,
  setSwitch: 2,
  clearSwitch: 2,
  warp: 4,
  join: 2,
  setVar: 3,
  addVar: 3,
  subVar: 3,
  call: 2,
  music: 2,
  battle: 1 + RPG_LIMITS.monstersPerBattle
};

/**
 * The sequence of opcodes a compiled event body actually contains, in the
 * order encodeBody wrote them, flattened depth-first exactly the way
 * liveCommands' own pre-order yields (a branch or option's contents
 * immediately after the command that holds them) -- so the two are
 * comparable element for element, not just by count. Branch and choice are
 * decoded through their own length bytes rather than a fixed width, the
 * same self-describing shape that lets script_skip (engine/script.asm) step
 * over a body without decoding what is in it.
 */
function decodeOpSequence(bytes, cursor, end, out = []) {
  while (cursor < end) {
    const opcode = bytes[cursor];
    if (opcode === OP_END) break;
    const opName = EVENT_COMMANDS[opcode]?.id;
    assert.ok(opName, `byte ${opcode} at offset ${cursor} is not a recognised opcode`);
    out.push(opName);
    if (opName === 'branch') {
      const thenLen = bytes[cursor + 4];
      const thenStart = cursor + 5;
      // The OP_JUMP marker right after the then-body is the only thing that
      // tells script_skip (engine/script.asm) it has reached the else side
      // rather than more then-body it should keep stepping over -- a wrong
      // byte there is invisible to a decoder that only ever reads thenLen to
      // know where to stop, so it is checked by value, not just walked past.
      assert.equal(
        bytes[thenStart + thenLen],
        OP_JUMP,
        `branch at offset ${cursor}: expected OP_JUMP at ${thenStart + thenLen} (past the then-body), found ${bytes[thenStart + thenLen]}`
      );
      decodeOpSequence(bytes, thenStart, thenStart + thenLen, out);
      const elseLen = bytes[thenStart + thenLen + 1]; // past the OP_JUMP byte
      const elseStart = thenStart + thenLen + 2;
      decodeOpSequence(bytes, elseStart, elseStart + elseLen, out);
      cursor = elseStart + elseLen;
    } else if (opName === 'choice') {
      const count = bytes[cursor + 1];
      const first = cursor + 2 + count; // past the opcode, the count, and one string id per option

      // Every option's own length byte, read up front in the order the
      // records actually sit in -- the recursion below still walks the same
      // order, but this first pass is what lets the OP_JUMP marker and the
      // jump distance after each body be checked against values computed
      // from the lengths themselves, rather than only ever being used to
      // find the next record.
      const records = [];
      for (let i = 0, p = first; i < count; i++) {
        // Each option's own length byte counts its body *plus* the OP_JUMP
        // pair after it (encodeCommand's 'choice' case: `lengths[i] =
        // body.length + 2`), not the body alone -- the record is
        // [length, ...body, OP_JUMP, past], L+1 bytes end to end.
        const len = bytes[p];
        const bodyStart = p + 1;
        const bodyLen = len - 2;
        records.push({ start: p, len, bodyStart, bodyLen });
        p += len + 1;
      }

      // past[i] is "every record after option i, each one's own length byte
      // plus what it describes" (encodeCommand's own comment) -- accumulated
      // backwards here for the same reason it is easiest to compute forwards
      // there: option i's distance depends on every option below it, which
      // for the last option is zero and grows by one full record at a time
      // working back towards the first.
      let expectedPast = 0;
      for (let i = count - 1; i >= 0; i--) {
        const { start, len, bodyStart, bodyLen } = records[i];
        assert.equal(
          bytes[bodyStart + bodyLen],
          OP_JUMP,
          `choice option ${i} at offset ${cursor}: expected OP_JUMP at ${bodyStart + bodyLen} (past its body), found ${bytes[bodyStart + bodyLen]}`
        );
        assert.equal(
          bytes[bodyStart + bodyLen + 1],
          expectedPast,
          `choice option ${i} at offset ${cursor}: jump distance past the remaining options is ` +
            `${bytes[bodyStart + bodyLen + 1]}, expected ${expectedPast} -- a stale distance here would send ` +
            'script_choose (engine/script.asm) somewhere the compiled sequence never actually put a command'
        );
        expectedPast += 1 + len;
      }

      for (const { bodyStart, bodyLen } of records) {
        decodeOpSequence(bytes, bodyStart, bodyStart + bodyLen, out);
      }
      cursor = first + records.reduce((sum, r) => sum + r.len + 1, 0);
    } else {
      const width = FIXED_OPCODE_WIDTH[opName];
      assert.ok(width, `${opName} has no known fixed width -- add it to FIXED_OPCODE_WIDTH`);
      cursor += width;
    }
  }
  return out;
}

test('liveCommands and encodeBody agree on the actual sequence of compiled opcodes', () => {
  // Counting OP_BATTLE bytes only proved battle commands, only by count --
  // a duplicate plus a drop would cancel out, and nothing about it spoke to
  // any other opcode. This decodes the real compiled event back into an
  // opcode sequence and compares it against liveCommands' own sequence
  // directly, across every opcode this schema has, so identity and order
  // both have to agree, not just a total.
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'Slime', damage: 5 }];
  project.party = [{ id: 0, name: 'Hero', spells: [] }];

  // A resolvable common event, id 0 by resolveCommonEventIds' own default
  // (no explicit `id`, commonEventSeq starts at 0) -- present for every
  // scenario below so a `call` in any of them, not only the dedicated
  // dangling-call case further down, resolves to something real instead of
  // compiling away. Harmless to the scenarios that never emit `call`.
  const resolvableCommonEvents = [
    { name: 'Common', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: 0 }] }] } }
  ];

  const compiledSequence = (commands) => {
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
    project.commonEvents = resolvableCommonEvents;
    // compileText (main/build/textcompile.js) pushes every live common event
    // before it walks the placed entities, so with one common event present
    // the placed entity's compiled event is events[1], not events[0].
    const [, event] = compileText(project).events;
    // A page whose only commands are switched off has no live commands at
    // all, so compiledPages drops it and the entity gets no event and no
    // dialogue -- compileText emits nothing for it, not an empty event.
    if (!event) return [];
    return decodeOpSequence(event, 4, event.length); // past the page header
  };

  const liveSequence = (commands) => [...liveCommands(commands, CHOICE_LIMITS.options)].map((c) => c.op);

  const one = (op, extra) => ({ op, monsters: [0], actor: 0, switch: 0, screen: 0, x: 0, y: 0, member: 0, variable: 0, value: 0, event: 0, song: null, ...extra });

  const scenarios = {
    'a straight line of every fixed-width opcode, in order': [
      one('say'),
      one('give'),
      one('take'),
      one('setSwitch'),
      one('clearSwitch'),
      one('warp'),
      one('join'),
      one('setVar'),
      one('addVar'),
      one('subVar'),
      one('music'),
      one('call'), // resolvableCommonEvents' id 0 -- exercises FIXED_OPCODE_WIDTH.call against a real slot byte, not just NO_COMMON_EVENT_SLOT
      one('battle')
    ],
    "a branch's then side, then its else side": [
      { op: 'branch', cond: { type: 'none', arg: 0 }, then: [one('say')], else: [one('give')] }
    ],
    'all four choice options a box has rows for, each different': [
      {
        op: 'choice',
        options: [
          { text: 'A', commands: [one('say')] },
          { text: 'B', commands: [one('give')] },
          { text: 'C', commands: [one('setSwitch')] },
          { text: 'D', commands: [one('battle')] }
        ]
      }
    ],
    'a fifth choice option, past CHOICE_LIMITS.options': [
      {
        op: 'choice',
        options: [
          { text: 'A', commands: [one('say')] },
          { text: 'B', commands: [one('give')] },
          { text: 'C', commands: [one('setSwitch')] },
          { text: 'D', commands: [one('battle')] },
          { text: 'E', commands: [one('music')] } // discarded, must not appear on either side
        ]
      }
    ],
    'a switched-off branch, whatever it holds': [
      { op: 'branch', off: true, cond: { type: 'none', arg: 0 }, then: [one('say')], else: [one('give')] }
    ],
    'a switched-off command, directly': [one('say', { off: true })],
    'nested branches, three deep': [
      {
        op: 'branch',
        cond: { type: 'none', arg: 0 },
        then: [{ op: 'branch', cond: { type: 'none', arg: 0 }, then: [one('say')], else: [] }],
        else: []
      }
    ]
  };

  for (const [name, commands] of Object.entries(scenarios)) {
    assert.deepEqual(compiledSequence(commands), liveSequence(commands), name);
  }

  // A common event is reached by projectEvents rather than by walking a
  // placement's own pages, and compiles into the shared table whether or
  // not anything calls it -- the same comparison has to hold there too.
  project.maps[0].screens[0].entities = [];
  project.commonEvents = [{ name: 'Common', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [one('say')] }] } }];
  const [commonEvent] = compileText(project).events;
  const commonCompiled = decodeOpSequence(commonEvent, 4, commonEvent.length);
  let commonLive = [];
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      commonLive = commonLive.concat(liveSequence(page.commands));
    }
  }
  assert.deepEqual(commonCompiled, commonLive, 'a common event, reached through projectEvents');

  // A dangling `call` -- naming a common event id nothing defines -- used to
  // be the one documented exception to "these two sequences must match":
  // encodeCommand's 'call' case (main/build/textcompile.js) used to resolve
  // the reference and compile to nothing when it did not, the same way an
  // empty battle formation or a choice with no options does, while
  // liveCommands (which has no way to ask "does this reference resolve", the
  // same reason it cannot for a missing give/take actor either) kept
  // yielding the call regardless. That is no longer how the compiler answers
  // this: an unresolved call now still gets a table slot's worth of bytes,
  // carrying NO_COMMON_EVENT_SLOT as its operand, so script_op_call
  // (engine/script.asm) has something to read and refuse at runtime instead
  // of the command simply not being there -- and liveCommands and the
  // compiled sequence agree on 'call' now like every other opcode, with no
  // exception left to encode. event: 999 names nothing -- compiledSequence's
  // own resolvableCommonEvents (id 0) is the only common event it sets up.
  const danglingCallCommands = [one('say'), { op: 'call', event: 999 }, one('give')];
  const danglingCompiled = compiledSequence(danglingCallCommands);
  const danglingLive = liveSequence(danglingCallCommands);
  assert.deepEqual(danglingCompiled, ['say', 'call', 'give'], 'an unresolved call still gets its own bytes, carrying NO_COMMON_EVENT_SLOT');
  assert.deepEqual(danglingLive, ['say', 'call', 'give'], 'liveCommands is not expected to resolve a call target, but still yields it structurally');
  assert.deepEqual(danglingLive, danglingCompiled, 'no filtering needed any more -- the two sequences agree on a dangling call directly');
});

test('liveCommands refuses to walk without a choice-option limit', () => {
  // Required, not defaulted: an omitted limit used to mean "walk every
  // option, unbounded" -- silently the exact divergence from encodeBody
  // this argument exists to close. A caller that forgets it now finds out
  // immediately rather than shipping a validator that agrees with the
  // compiler by accident, only for as long as no project has a fifth option.
  const commands = [{ op: 'battle', monsters: [0] }];
  assert.throws(() => [...liveCommands(commands)], /choiceOptionLimit/);
  assert.throws(() => [...liveCommands(commands, undefined)], /choiceOptionLimit/);
  assert.doesNotThrow(() => [...liveCommands(commands, CHOICE_LIMITS.options)]);
});

test('a formation whose only valid monster falls past the truncation point reads as empty', () => {
  // The compiler (encodeCommand's 'battle' case, main/build/textcompile.js)
  // slices to RPG_LIMITS.monstersPerBattle *before* deciding which ids are
  // still real actors -- so a live, not-yet-normalized formation with more
  // entries than that can lose its only valid one to truncation rather than
  // to staleness, and still has to read as empty: the ROM never sees it
  // either way. battleFormationSlice is the one place both this and the
  // compiler apply that order, so they cannot drift apart on it again.
  const actorCount = 1; // only actor 0 exists
  const overfull = [99, 99, 99, 99, 0]; // the only valid id sits in the fifth slot
  const sliced = battleFormationSlice(overfull);
  assert.deepEqual(sliced, [99, 99, 99, 99], 'RPG_LIMITS.monstersPerBattle is 4');
  const valid = sliced.filter((id) => Number.isInteger(id) && id >= 0 && id < actorCount);
  assert.deepEqual(valid, [], 'the fifth slot never reaches the ROM, so its valid id does not count');

  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'Slime', damage: 5 }];
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'battle', monsters: overfull }] }] }
    }
  });
  const errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /name no monsters/);
});

test('an RPG project round-trips through normalize unchanged', () => {
  const project = createProject('Quest', 'rpg');
  project.spells.push(createSpell(0, 'Cure'));
  project.party.push(createPartyMember(1, 'Mage'));
  project.party[1].spells.push({ spellId: 0, level: 3 });
  project.switches.push('Chest opened');
  const normalized = normalizeProject(structuredClone(project));
  assert.deepEqual(normalized, project);
});

// --- authoring names ---------------------------------------------------------

test('screens and placed actors carry a name for the author, capped and tidied', () => {
  const project = normalizeProject({
    maps: [
      {
        screens: [
          {
            name: `  Cave   mouth  ${'x'.repeat(80)}`,
            entities: [{ actorId: 0, x: 0, y: 0, props: { name: '  Gate key chest ' } }]
          }
        ]
      }
    ]
  });
  const screen = project.maps[0].screens[0];
  assert.equal(screen.name.length, AUTHOR_NAME_MAX);
  assert.match(screen.name, /^Cave mouth x+$/, 'runs of whitespace collapse, ends trimmed');
  assert.equal(screen.entities[0].props.name, 'Gate key chest');

  // Unnamed is the empty string, never a number: the number is where the screen
  // sits, and a resize moves it.
  assert.equal(normalizeProject({ maps: [{}] }).maps[0].screens[0].name, '');
});

test('a screen reads by its name where it has one and by its position where it does not', () => {
  const project = createProject('Named');
  project.maps[0].name = 'Overworld';
  assert.equal(screenLabel(project, 0, 0), 'Overworld · screen 0');
  project.maps[0].screens[0].name = 'Cave mouth';
  assert.equal(screenLabel(project, 0, 0), 'Overworld · Cave mouth');
  assert.equal(entityLabel(project, { actorId: 0 }), project.sprites.actors[0]?.name ?? 'Actor 0');
  assert.equal(entityLabel(project, { actorId: 0, props: { name: 'Innkeeper' } }), 'Innkeeper');
});

test('the screen list the UI offers is numbered the way the engine numbers screens', () => {
  const project = createProject('Two maps');
  project.maps.push(createMap(1, 'Caves'));
  project.maps[1].gridW = 2;
  project.maps[1].gridH = 2;
  project.maps[1].screens = [createScreen(), createScreen(), createScreen(), createScreen()];

  // A door's toScreen and a warp command's screen are indices into this list,
  // and the generator compiles its table in the same order. Disagree and the
  // player lands somewhere the editor never showed.
  const offered = flatScreens(project);
  const compiled = flattenScreens(project).flat;
  assert.equal(offered.length, compiled.length);
  offered.forEach((entry, index) => {
    assert.equal(entry.screen, compiled[index].screen, `screen ${index} is the same object in both`);
  });
});

// The disk is a separate schema from the in-memory one: `saveProject` spreads a
// project across a folder of files by hand, so a part nobody wrote a line for is
// simply not written. That is invisible until the project is reopened, which is
// exactly when losing it costs the most work — the variables' names were lost
// this way. Comparing the whole project against itself after a round trip is the
// only form of this test that keeps holding as parts are added.
test('every part of a project survives being written and read back', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-roundtrip-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const draft = createProject('Round Trip', 'rpg');
  // Something away from the default in every part that is written out, because a
  // part left at its defaults would normalize back to those same defaults after
  // being dropped — and pass. Each line below is one file, or one field of the
  // head file, that `saveProject` has to have remembered.
  draft.project.name = 'Round Trip';
  draft.project.startX = 64;
  draft.project.titleMap = 0;
  draft.cartridge.mapper = 1;
  draft.cartridge.mirroring = 'horizontal';
  draft.switches[0] = 'Chest opened';
  draft.variables[0] = 'Gems handed over';
  draft.commonEvents.push({
    name: 'Reward',
    event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'A gem!' }] }] }
  });
  draft.tilesets[0].name = 'Woodland';
  draft.tilesets[0].background.tiles[1] = '1'.repeat(64);
  draft.tilesets[0].sprites.tiles[2] = '2'.repeat(64);
  draft.palettes.bg[0][1] = 0x21;
  draft.palettes.sprite[1][2] = 0x16;
  draft.metatiles[1].name = 'Bramble';
  draft.metatiles[1].collision = 'damage';
  draft.metatiles[1].tiles = [4, 5, 6, 7];
  draft.sprites.metasprites.push({ name: 'Hero', tiles: [{ tile: 3, x: 0, y: 0, palette: 1 }] });
  draft.sprites.animations.push({ name: 'Walk', frames: [{ metaspriteId: 0, duration: 6 }] });
  draft.sprites.actors.push({ name: 'Innkeeper', behavior: 'npc', animationId: 0, damage: 2 });
  draft.input.states.gameplay.A = 'interact';
  draft.input.states.menu.START = 'cancel';
  draft.party[0].name = 'Ilse';
  draft.party[0].baseHp = 24;
  draft.spells.push({ name: 'Ember', kind: 'damage', amount: 9, cost: 3, element: 'fire' });
  draft.rpg.xpBase = 12;
  draft.rpg.maxLevel = 9;
  draft.rpg.battleTilesetId = 0;
  draft.maps[0].name = 'Greenwood';
  draft.maps[0].songId = 0;
  draft.maps[0].encounters = { ...draft.maps[0].encounters, rate: 24 };
  draft.maps[0].screens[0].name = 'The clearing';
  draft.maps[0].screens[0].metatiles[5] = 1;
  draft.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 32,
      y: 48,
      props: {
        name: 'Innkeeper',
        dialogue: 'Rooms are five gold.',
        event: {
          pages: [
            {
              cond: { type: 'varAtLeast', arg: 0, value: 3 },
              commands: [{ op: 'say', text: 'That will do.' }, { op: 'subVar', variable: 0, value: 3 }]
            }
          ]
        }
      }
    }
  ];
  draft.code.files.push({ name: 'hooks.asm', text: '; nothing yet\n' });
  draft.code.overrides.push({ name: 'player.asm', text: '; mine now\n' });
  draft.songs.push({ name: 'Overworld', tempo: 9 });

  // Normalized once, so what is compared is a project in the shape the app holds
  // — the same shape `loadProject` returns — rather than the hand-written one.
  const project = normalizeProject(draft);
  await saveProject(dir, project);
  const reopened = await loadProject(dir);

  // Every top-level part is named, so a whole part going missing is a failure
  // that says which one rather than a wall of diff.
  for (const part of Object.keys(project)) {
    assert.deepEqual(reopened[part], project[part], `${part} did not survive the round trip`);
  }
  assert.deepEqual(reopened, project);
});
