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
  EVENT_CONDITIONS,
  overCapDeleteWarning,
  screenLabel,
  entityLabel,
  flatScreens,
  resolveCommonEventIds,
  commonEventId,
  renumberSongDeletion,
  renumberActorDeletion,
  renumberItemDeletion,
  renumberMetaspriteDeletion,
  battleFormationSlice,
  NO_ACTOR,
  NO_ITEM,
  NO_METASPRITE,
  ITEM_EFFECT_KINDS,
  itemMissing,
  itemPickerOptions,
  canBackItem,
  itemActorOptions,
  projectUsesItems,
  projectUsesSfx,
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
import { compileText, opIndex, OP_JUMP, OP_STING } from '../../main/build/textcompile.js';
import { createSong, songFrameLength } from '../../shared/audio.js';
import { battleTables } from '../../main/build/battletables.js';
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

test('deleting an actor renumbers a battle formation, nested or not, and never touches Give/Take', () => {
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
                { op: 'give', item: 1 }, // an item id — must not be touched by actor renumbering
                { op: 'take', item: 2 },
                { op: 'battle', monsters: [1, 2, 3] },
                {
                  op: 'branch',
                  cond: { type: 'none', arg: 0 },
                  then: [{ op: 'battle', monsters: [1] }],
                  else: [{ op: 'battle', monsters: [3] }]
                },
                {
                  op: 'choice',
                  options: [{ text: 'Fight', commands: [{ op: 'battle', monsters: [2] }] }]
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
  assert.deepEqual(
    commands.map((c) => c.op),
    ['give', 'take', 'battle', 'branch', 'choice']
  );
  const [give, take, battle, branch, choice] = commands;
  // Give/Take is an item reference now, moved entirely out of actor-deletion
  // renumbering (see renumberItemDeletion below) — an actor deletion must
  // leave it exactly as it found it, id 1/2 and all, even though those
  // happen to be actor-shaped numbers here.
  assert.equal(give.item, 1, 'a Give item command is not touched by renumberActorDeletion at all');
  assert.equal(take.item, 2, 'a Take item command is not touched by renumberActorDeletion at all');
  assert.deepEqual(battle.monsters, [1, 2], 'the deleted actor drops out of the formation and the rest shift down');
  assert.deepEqual(branch.then[0].monsters, [], 'a formation naming exactly the deleted actor empties out, nested');
  assert.deepEqual(branch.else[0].monsters, [2], 'a formation above the deleted actor shifts down, nested');
  assert.deepEqual(
    choice.options[0].commands[0].monsters,
    [1],
    'a formation inside a question option should renumber too'
  );
});

// --- three references renumberActorDeletion used to walk straight past, or
// has grown a new case for since ----------------------------------------
//
// The drop and Carrying cases below were the same defect as the Give/Take
// one, found by enumerating every place an actor id was used as an item: a
// stored index is not an identity, so a reference nobody renumbers silently
// comes to mean whichever actor now sits at that number. All three moved to
// renumberItemDeletion once items existed to be the reference's true id
// space (see the tests below) — what stays here, tested last, is the new
// case actor deletion gained instead: project.items[].actorId.

test('deleting an actor renumbers a project.items[].actorId, and does not leave it pointing at its neighbour', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
  project.items = [
    { id: 0, name: 'Above', actorId: 2 }, // names "C" — above the deletion
    { id: 1, name: 'Exactly', actorId: 1 }, // names exactly the deleted actor
    { id: 2, name: 'Below', actorId: 0 }, // names "A" — below the deletion
    { id: 3, name: 'Orphan', actorId: null } // already names nothing
  ];

  renumberActorDeletion(project, 1); // delete "B"

  const [above, exactly, below, orphan] = project.items;
  assert.equal(above.actorId, 1, 'an item naming an actor above the deleted one should shift down, not stay on the number');
  assert.equal(exactly.actorId, null, 'an item naming exactly the deleted actor becomes an orphan, not deleted');
  assert.equal(below.actorId, 0, 'an item naming an actor below the deleted one should not move');
  assert.equal(orphan.actorId, null, 'an item that already named nothing should stay naming nothing');
});

test('an already-migrated project’s custom item names, ordering, extra records and references survive normalization unchanged', () => {
  // normalize(normalize(x)) === normalize(x) alone would still pass an
  // implementation that unconditionally rebuilds the same deterministic
  // item list every time -- it would just rebuild the same wrong thing
  // twice. This pins the stronger claim: once items[] exists, whatever an
  // author actually did to it (renamed one, reordered them, added one
  // nothing references yet) is exactly what a load-then-save round trip
  // hands back, not a fresh derivation from the current actor roster.
  const raw = {
    project: { name: 'Custom', gameType: 'rpg' },
    sprites: {
      actors: [
        { name: 'Hero', behavior: 'player' },
        { name: 'Slime', behavior: 'patroller', damage: 1, battle: { drop: 2, dropPct: 20 } },
        { name: 'Relic', behavior: 'pickup' }
      ]
    },
    // Deliberately out of actor-id order, custom-named, and with a third
    // entry ("Trinket") no reference in the project names at all -- an item
    // an author added by hand (or a future Database Forge will) ahead of
    // anything pointing at it yet.
    items: [
      { id: 0, name: 'Ye Olde Relic', actorId: 2, metaspriteId: 3 },
      { id: 1, name: 'Slime Goo', actorId: 1, metaspriteId: null },
      { id: 2, name: 'Trinket', actorId: null, metaspriteId: null }
    ],
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                x: 0,
                y: 0,
                props: { event: { pages: [{ cond: { type: 'hasItem', arg: 0 }, commands: [{ op: 'give', item: 1 }] }] } }
              }
            ]
          }
        ]
      }
    ]
  };

  const once = normalizeProject(raw);
  assert.equal(once.items.length, 3, 'no item was synthesized or dropped');
  assert.deepEqual(
    once.items.map((i) => i.name),
    ['Ye Olde Relic', 'Slime Goo', 'Trinket'],
    'custom names and their order survive exactly as authored'
  );
  assert.equal(once.items[2].actorId, null, 'the unreferenced extra record is preserved, orphan and all');

  const twice = normalizeProject(structuredClone(once));
  assert.deepEqual(twice.items, once.items, 'a second normalization changes nothing about the items list');
  assert.deepEqual(
    twice.maps[0].screens[0].entities[0].props.event,
    once.maps[0].screens[0].entities[0].props.event,
    'the references naming those items are untouched by a second pass too'
  );
});

test('deleting an item renumbers Give/Take, a monster’s drop, and Carrying conditions, nested or not', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [
    { name: 'A', damage: 1, battle: { drop: 2, dropPct: 50 } }, // drops item "C" — above the deletion
    { name: 'B', damage: 1, battle: { drop: null, dropPct: 0 } }, // already names nothing
    { name: 'C', damage: 1, battle: { drop: 1, dropPct: 50 } }, // drops exactly the deleted item
    { name: 'D', damage: 1, battle: { drop: 0, dropPct: 50 } } // drops item "A" — below the deletion
  ];
  project.items = [{ id: 0, name: 'A' }, { id: 1, name: 'B' }, { id: 2, name: 'C' }, { id: 3, name: 'D' }];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: [
            {
              cond: { type: 'hasItem', arg: 2 }, // above the deletion
              commands: [
                { op: 'give', item: 1 }, // names the item about to be deleted
                { op: 'take', item: 2 }, // above it — should shift down
                {
                  op: 'branch',
                  cond: { type: 'hasItem', arg: 1 }, // exactly the deleted item
                  then: [
                    // A branch inside a branch: the nesting allCommands exists for.
                    { op: 'branch', cond: { type: 'hasItem', arg: 3 }, then: [{ op: 'give', item: 1 }], else: [] }
                  ],
                  else: [{ op: 'take', item: 3 }]
                },
                {
                  op: 'choice',
                  options: [
                    {
                      text: 'Yes',
                      commands: [{ op: 'branch', cond: { type: 'hasItem', arg: 2 }, then: [], else: [] }]
                    }
                  ]
                }
              ]
            },
            { cond: { type: 'hasItem', arg: 1 }, commands: [] },
            // Not an item reference at all — switch 2 must come through untouched.
            { cond: { type: 'switchOn', arg: 2 }, commands: [] }
          ]
        }
      }
    }
  ];
  // A common event is not reached by walking a placement's commands — a `call`
  // names it by id rather than holding its pages — so an implementation that
  // walked placed actors alone would pass every assertion above while leaving
  // the original bug intact in exactly the bodies authored once and used
  // everywhere. projectEvents() covers both; this is what says so.
  project.commonEvents = [
    {
      id: 0,
      name: 'Reward',
      event: {
        pages: [
          {
            cond: { type: 'hasItem', arg: 2 },
            commands: [{ op: 'branch', cond: { type: 'hasItem', arg: 1 }, then: [], else: [] }]
          }
        ]
      }
    }
  ];

  renumberItemDeletion(project, 1); // delete item "B"

  const [a, b, c, d] = project.sprites.actors;
  assert.equal(a.battle.drop, 1, 'a drop naming an item above the deleted one should shift down, not stay on the number');
  assert.equal(c.battle.drop, null, 'a drop naming exactly the deleted item should read as missing, the same as Give/Take');
  assert.equal(d.battle.drop, 0, 'a drop naming an item below the deleted one should not move');
  assert.equal(b.battle.drop, null, 'a drop that already named nothing should stay naming nothing');

  const pages = project.maps[0].screens[0].entities[0].props.event.pages;
  const [give, take, outerBranch, choice] = pages[0].commands;
  assert.equal(pages[0].cond.arg, 1, 'a page condition naming an item above the deleted one should shift down');
  // Nothing is dropped -- a Give/Take naming exactly the deleted item becomes
  // visibly missing (item: null) rather than erasing whatever else the event
  // went on to do.
  assert.equal(give.item, null, 'a Give item command naming exactly the deleted item should read as missing');
  assert.equal(take.item, 1, 'a Take item command naming an item above the deleted one should shift down');
  assert.equal(
    outerBranch.cond.arg,
    NO_ITEM,
    'a branch condition naming exactly the deleted item should stop naming an item at all'
  );
  assert.equal(outerBranch.then[0].cond.arg, 2, 'a condition nested two branches deep should renumber too');
  assert.equal(
    outerBranch.then[0].then[0].item,
    null,
    'a Give item nested two branches deep and naming the deleted item should read as missing too'
  );
  assert.equal(outerBranch.else[0].item, 2, 'a Take item below the deleted one, nested in a branch, should shift down');
  assert.equal(
    choice.options[0].commands[0].cond.arg,
    1,
    'a condition inside a question option should renumber the same way'
  );
  assert.equal(pages[1].cond.arg, NO_ITEM, 'a second page naming exactly the deleted item gets the same answer');
  assert.equal(pages[2].cond.type, 'switchOn', 'a switch condition is not an item reference');
  assert.equal(pages[2].cond.arg, 2, 'a switch condition’s argument must not be renumbered as if it were an item');

  const commonPage = project.commonEvents[0].event.pages[0];
  assert.equal(commonPage.cond.arg, 1, 'a common event’s own page condition should renumber, not only a placement’s');
  assert.equal(
    commonPage.commands[0].cond.arg,
    NO_ITEM,
    'a branch condition inside a common event should be marked missing the same way'
  );
});

test('a map’s wandering-encounter table is renumbered when an actor is deleted', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  project.maps = [createMap(0, 'World'), createMap(1, 'Cave')];
  project.maps[0].encounters = { rate: 8, actorIds: [0, 1, 2] };
  project.maps[1].encounters = { rate: 8, actorIds: [1] }; // only the doomed actor

  renumberActorDeletion(project, 1); // delete "B"

  // The battle-formation answer, for the same reason: the table is a list, so
  // the deleted id drops out of it rather than becoming a sentinel, and the
  // ids above it shift down. mapEncounterFormation's own `id < actorCount`
  // filter only ever catches the first of the two failures — an id that went
  // out of range. An id that used to mean B and now means C is still in
  // range, so nothing downstream can see it.
  assert.deepEqual(
    project.maps[0].encounters.actorIds,
    [0, 1],
    'the deleted actor drops out of the table and C shifts down — 1 must not silently keep meaning "whoever is at 1"'
  );
  assert.deepEqual(
    project.maps[1].encounters.actorIds,
    [],
    'a table whose only entry was the deleted actor empties out rather than retargeting'
  );
});

// --- renumberMetaspriteDeletion (round 2, item 4) — imported since it was
// written, never called by any test until now. Three consumers, one
// deletion, exact/above/below for each, plus the nullable fixed point for
// the two that have one. An animation frame has no sentinel of its own, so
// its exact-match case is a removal rather than a null, unlike the other
// two — see the function's own docstring for why.

test('renumberMetaspriteDeletion: an animation frame naming exactly the deleted metasprite is removed, not clamped', () => {
  const project = createProject('Quest');
  project.sprites.animations = [
    {
      id: 0,
      name: 'Walk',
      loop: true,
      frames: [
        { metaspriteId: 1, duration: 8 }, // below the deletion — must not move
        { metaspriteId: 2, duration: 8 }, // exactly the deleted metasprite — must be dropped
        { metaspriteId: 3, duration: 8 }, // above — shifts down to 2
        { metaspriteId: 4, duration: 8 } // above — shifts down to 3
      ]
    }
  ];

  renumberMetaspriteDeletion(project, 2);

  assert.deepEqual(
    project.sprites.animations[0].frames,
    [
      { metaspriteId: 1, duration: 8 },
      { metaspriteId: 2, duration: 8 },
      { metaspriteId: 3, duration: 8 }
    ],
    'the frame naming exactly metasprite 2 is removed outright, and the two above it shift down by one'
  );
});

test('renumberMetaspriteDeletion: an animation can lose every frame, which the Sprite Forge already permits', () => {
  const project = createProject('Quest');
  project.sprites.animations = [
    { id: 0, name: 'Blink', loop: true, frames: [{ metaspriteId: 5, duration: 4 }] }
  ];

  renumberMetaspriteDeletion(project, 5);

  assert.deepEqual(project.sprites.animations[0].frames, [], 'an animation whose only frame named the deleted metasprite ends up empty, not clamped to a substitute');
});

test('renumberMetaspriteDeletion: a party member’s metaspriteId is the ordinary nullable fixed point', () => {
  const project = createProject('Quest', 'rpg');
  project.party = [
    { ...createPartyMember(0, 'Below'), metaspriteId: 1 },
    { ...createPartyMember(1, 'Exact'), metaspriteId: 2 },
    { ...createPartyMember(2, 'Above'), metaspriteId: 4 },
    { ...createPartyMember(3, 'AlreadyNothing'), metaspriteId: null }
  ];

  renumberMetaspriteDeletion(project, 2);

  const [below, exact, above, already] = project.party;
  assert.equal(below.metaspriteId, 1, 'a party member below the deleted metasprite should not move');
  assert.equal(exact.metaspriteId, null, 'a party member naming exactly the deleted metasprite reads as "Not drawn"');
  assert.equal(above.metaspriteId, 3, 'a party member above the deleted metasprite should shift down');
  assert.equal(already.metaspriteId, null, 'a party member already drawing nothing should stay that way');
});

// Round 5 finding: before LIMITS.metasprites existed, a real metasprite
// could legitimately be assigned id 255 -- byte-identical to NO_METASPRITE.
// fixedPoint's old check order tested "is this the sentinel" before "is
// this the exact index being deleted", so deleting a real metasprite 255
// matched the sentinel branch first and returned NO_METASPRITE
// unconditionally -- which for a party member (whose exact-match answer is
// `null`, not NO_METASPRITE, a value with no meaning in that field) left the
// reference stale at 255 rather than cleared to null. Constructed directly
// here (bypassing the UI cap and validateProject, both editor-level
// safeguards) to exercise renumberMetaspriteDeletion's own logic the way an
// already-over-cap or hand-edited project could still reach it -- the fix
// (checking the exact match first) does not depend on the cap catching this
// upstream.
test('renumberMetaspriteDeletion: deleting a real metasprite 255 clears a party member’s reference to it, not leaves it stale at 255', () => {
  const project = createProject('Quest', 'rpg');
  project.party = [{ ...createPartyMember(0, 'Exact255'), metaspriteId: 255 }];

  renumberMetaspriteDeletion(project, 255);

  assert.equal(
    project.party[0].metaspriteId,
    null,
    'deleting the real metasprite this party member points at must clear the reference to null (draws nothing), ' +
      'not leave it stale at 255 -- which, post-deletion, names an id that no longer exists'
  );
});

// Round 7 finding: the fix above (round 5) only closed the ambiguity for the
// id *being deleted*. A party member referencing a real, *surviving*
// metasprite 255 while some other index is deleted never reaches the
// exact-match branch at all -- it used to fall into the sentinel-preservation
// branch, which fired for both callers unconditionally, leaving 255
// un-shifted. This is the recovery path an over-cap project is specifically
// steered into (validateProject's own message: "delete N of them"), so a
// party member's icon silently corrupting on exactly that path is the worst
// place for this bug to live.
test('renumberMetaspriteDeletion: a party member referencing a surviving real metasprite 255 shifts down like any other reference, when a different metasprite is deleted', () => {
  const project = createProject('Quest', 'rpg');
  // 256 metasprites (ids 0-255): an over-cap array validateProject would
  // refuse to build, constructed directly to exercise the deletion recovery
  // path an author would actually be told to take.
  project.sprites.metasprites = Array.from({ length: 256 }, (_, id) => ({ id, name: `M${id}`, tiles: [] }));
  project.party = [{ ...createPartyMember(0, 'Surviving255'), metaspriteId: 255 }];

  // Delete index 0 -- unrelated to 255, the case the exact-match branch
  // cannot reach at all.
  renumberMetaspriteDeletion(project, 0);
  project.sprites.metasprites.splice(0, 1);

  assert.equal(
    project.party[0].metaspriteId,
    254,
    'a real metasprite 255 must shift to 254 like any other surviving reference above the deleted index -- ' +
      'staying at 255 would point past the end of the now-255-entry array'
  );
  assert.ok(
    project.party[0].metaspriteId < project.sprites.metasprites.length,
    'the shifted reference must be a valid index into the array as it now stands'
  );
});

test('renumberMetaspriteDeletion: an item’s exact-match case is NO_METASPRITE, not the party member’s null -- deleting an item’s chosen icon must not silently show the backing actor’s art instead', () => {
  const project = createProject('Quest', 'rpg');
  project.items = [
    { id: 0, name: 'Below', actorId: null, metaspriteId: 1 },
    { id: 1, name: 'Exact', actorId: 5, metaspriteId: 2 },
    { id: 2, name: 'Above', actorId: null, metaspriteId: 4 },
    { id: 3, name: 'AlreadyNothing', actorId: null, metaspriteId: NO_METASPRITE },
    { id: 4, name: 'Unset', actorId: null, metaspriteId: null }
  ];

  renumberMetaspriteDeletion(project, 2);

  const [below, exact, above, alreadyNothing, unset] = project.items;
  assert.equal(below.metaspriteId, 1, 'an item below the deleted metasprite should not move');
  // Not null: for an item, null now means "derive one from the backing
  // actor" (normalizeItem's own field comment), not "no icon" -- returning
  // null here would silently swap in actor 5's own art the next time this
  // item's icon is drawn, which is the exact regression finding 1 (round 4)
  // found: the fixedPoint helper's *shift* path already special-cased
  // NO_METASPRITE, but its *exact-deletion* path did not, and a test right
  // here enshrined the wrong result until now.
  assert.equal(
    exact.metaspriteId,
    NO_METASPRITE,
    'an item naming exactly the deleted metasprite must become NO_METASPRITE (no icon), not null (derive from the actor)'
  );
  assert.equal(above.metaspriteId, 3, 'an item above the deleted metasprite should shift down');
  assert.equal(alreadyNothing.metaspriteId, NO_METASPRITE, 'an item already carrying NO_METASPRITE should stay that way');
  assert.equal(unset.metaspriteId, null, 'an item that was never set should stay unset, not become NO_METASPRITE');
});

// Round 4 finding (Medium 4): a malformed explicit metaspriteId must not
// normalize into real, working-looking artwork. normalizeItem used the
// generic numeric clamp() before this, which rounds and clamps into range
// by design -- clamp(-1, 0, 255, 0) is 0, a real metasprite, not "no icon"
// -- contradicting the field's own documented rule (the comment right above
// it in normalizeItem) that a malformed explicit reference becomes
// NO_METASPRITE, the same as an out-of-range one already correctly did.
test('normalizeItem: a malformed explicit metaspriteId becomes NO_METASPRITE, not a rounded/clamped real metasprite', () => {
  const project = normalizeProject({
    items: [
      { id: 0, name: 'Negative', metaspriteId: -1 },
      { id: 1, name: 'Fractional', metaspriteId: 2.4 },
      { id: 2, name: 'NotANumber', metaspriteId: 'oops' },
      { id: 3, name: 'TooHigh', metaspriteId: 300 },
      { id: 4, name: 'ExplicitNone', metaspriteId: NO_METASPRITE },
      { id: 5, name: 'RealValue', metaspriteId: 7 },
      { id: 6, name: 'Unset', metaspriteId: null }
    ]
  });
  const [negative, fractional, notANumber, tooHigh, explicitNone, realValue, unset] = project.items;
  assert.equal(negative.metaspriteId, NO_METASPRITE, '-1 must not clamp to metasprite 0');
  assert.equal(fractional.metaspriteId, NO_METASPRITE, '2.4 must not round to metasprite 2 -- an id is a whole number or nothing');
  assert.equal(notANumber.metaspriteId, NO_METASPRITE, '"oops" must not fall back to metasprite 0');
  assert.equal(tooHigh.metaspriteId, NO_METASPRITE, '300 is out of range and must not clamp into range');
  assert.equal(explicitNone.metaspriteId, NO_METASPRITE, 'NO_METASPRITE itself is a legitimate explicit value and must survive normalization');
  assert.equal(realValue.metaspriteId, 7, 'a real, in-range value must still pass through unchanged');
  assert.equal(unset.metaspriteId, null, 'null must stay null, not become NO_METASPRITE -- unset and explicitly-none are different things');
});

// A round-trip proof, not just a normalization-time one: a malformed value
// saved once (which normalization already fixes) must not somehow resurface
// as real artwork on a later load either -- normalizeProject is idempotent
// on its own output, so this is really the same guarantee seen twice, but
// it is the shape an actual save/load cycle exercises.
test('normalizeItem: the NO_METASPRITE fallback survives a normalize/save/normalize round trip', () => {
  const once = normalizeProject({ items: [{ id: 0, name: 'Bad', metaspriteId: -5 }] });
  assert.equal(once.items[0].metaspriteId, NO_METASPRITE);
  const twice = normalizeProject(JSON.parse(JSON.stringify(once)));
  assert.equal(twice.items[0].metaspriteId, NO_METASPRITE, 'a second normalization pass must not change the already-correct sentinel');
});

// ROADMAP item 5, phase 4c round 1: items[].effect, the one-time migration
// from the backing actor's raw battle.heal (phase4-design.md §5). These
// mirror the metaspriteId tests just above -- same one-time-derivation
// shape, same idempotence guarantee, one field over. Round 2 is what wrote
// this order down as EFFECT_NONE/HEAL/DAMAGE (engine/constants.asm) and gave
// it a reader (use_item_apply, engine/ui.asm) -- this array's order is that
// equates list's own wire format, so `none` staying index 0 is not just a
// migration default any more, it is what a later engine change must not
// silently reorder.
test('ITEM_EFFECT_KINDS: none stays index 0, the wire-format engine/constants.asm’s EFFECT_* equates spell out', () => {
  assert.equal(ITEM_EFFECT_KINDS[0].id, 'none', 'none must stay first -- it is what every item meant before this field existed');
  assert.ok(ITEM_EFFECT_KINDS.some((entry) => entry.id === 'heal'));
  assert.ok(ITEM_EFFECT_KINDS.some((entry) => entry.id === 'damage'));
});

test('normalizeItem: effect derives heal from the backing actor’s battle.heal when unset', () => {
  const project = normalizeProject({
    sprites: { actors: [{ id: 0, name: 'Backer', behavior: 'pickup', battle: { heal: 30 } }] },
    items: [{ id: 0, name: 'Potion', actorId: 0 }]
  });
  assert.deepEqual(project.items[0].effect, { kind: 'heal', amount: 30 });
});

test('normalizeItem: effect derives none when the backing actor has no positive battle.heal', () => {
  const zero = normalizeProject({
    sprites: { actors: [{ id: 0, name: 'Backer', behavior: 'pickup', battle: { heal: 0 } }] },
    items: [{ id: 0, name: 'Key', actorId: 0 }]
  });
  assert.deepEqual(zero.items[0].effect, { kind: 'none', amount: 0 });

  const noBacker = normalizeProject({ items: [{ id: 0, name: 'ScriptOnly', actorId: null }] });
  assert.deepEqual(noBacker.items[0].effect, { kind: 'none', amount: 0 }, 'no actorId at all must not throw and must derive none');

  const staleBacker = normalizeProject({ items: [{ id: 0, name: 'Stale', actorId: 5 }] });
  assert.deepEqual(staleBacker.items[0].effect, { kind: 'none', amount: 0 }, 'an actorId naming no real actor must derive none, not throw');
});

// Round 1b review finding A1: NO_ACTOR is LIMITS.actors itself (255), so an
// over-cap, 256-plus-actor roster has a REAL raw actor sitting at that exact
// index -- the identical sentinel-aliasing trap LIMITS.metasprites =
// NO_METASPRITE already exists to close one id space over. An item whose
// actorId does not resolve (out of range, or garbage) normalizes to
// NO_ACTOR, and indexing rawActors with that sentinel's own numeric value
// must not silently read actor 255's real battle.heal.
test('normalizeItem: effect derivation must not alias NO_ACTOR into a real actor at index 255 on an over-cap roster', () => {
  const actors = Array.from({ length: 256 }, (_, id) => ({ id, name: `Actor ${id}`, behavior: 'npc' }));
  actors[255].battle = { heal: 77 }; // a real, positive heal sitting at NO_ACTOR's own numeric value
  const project = normalizeProject({
    sprites: { actors },
    // 9999 is garbage and out of range -- normalizeItem's own actorId
    // fallback turns it into NO_ACTOR (255), which must not then be used to
    // index actor 255's very real battle.heal.
    items: [{ id: 0, name: 'Garbage actorId', actorId: 9999 }]
  });
  assert.equal(project.items[0].actorId, NO_ACTOR, 'sanity: the garbage actorId should normalize to NO_ACTOR');
  assert.deepEqual(
    project.items[0].effect,
    { kind: 'none', amount: 0 },
    'must derive none, not alias into actor 255’s real battle.heal just because NO_ACTOR happens to equal 255'
  );
});

test('normalizeItem: an explicit effect is used as-is and is never re-derived from the backing actor again', () => {
  const project = normalizeProject({
    sprites: { actors: [{ id: 0, name: 'Backer', behavior: 'pickup', battle: { heal: 99 } }] },
    items: [{ id: 0, name: 'Bomb', actorId: 0, effect: { kind: 'damage', amount: 12 } }]
  });
  assert.deepEqual(
    project.items[0].effect,
    { kind: 'damage', amount: 12 },
    'an explicit effect must win over the backing actor’s battle.heal, not be overridden by it'
  );

  // The idempotence guarantee itself: save the normalized project back
  // (effect is now explicit) and normalize again with the actor's heal
  // changed underneath it -- a re-derivation would silently overwrite a
  // later items editor's own value, which is exactly what this field's
  // one-time-at-normalization design (phase4-design.md §5) exists to avoid.
  const resaved = JSON.parse(JSON.stringify(project));
  resaved.sprites.actors[0].battle.heal = 200;
  const reloaded = normalizeProject(resaved);
  assert.deepEqual(
    reloaded.items[0].effect,
    { kind: 'damage', amount: 12 },
    'once effect is explicit, it must not be re-derived from the actor on a later normalize'
  );
});

test('normalizeItem: an unrecognized explicit effect kind falls back to none, the same safe-default shape actorId/metaspriteId already use', () => {
  const project = normalizeProject({ items: [{ id: 0, name: 'Weird', effect: { kind: 'poison', amount: 5 } }] });
  assert.equal(project.items[0].effect.kind, 'none', 'an unrecognized kind must not be resurrected or crash normalization');
  assert.equal(project.items[0].effect.amount, 5, 'amount is independent of kind and still clamped/kept on its own');
});

test('normalizeItem: an explicit effect amount is clamped through damageAmount, matching Heal/Damage command values', () => {
  const project = normalizeProject({
    items: [
      { id: 0, name: 'Negative', effect: { kind: 'heal', amount: -10 } },
      { id: 1, name: 'TooHigh', effect: { kind: 'heal', amount: 999 } },
      { id: 2, name: 'Fractional', effect: { kind: 'heal', amount: 4.6 } },
      { id: 3, name: 'NotANumber', effect: { kind: 'heal', amount: 'oops' } }
    ]
  });
  const [negative, tooHigh, fractional, notANumber] = project.items;
  assert.equal(negative.effect.amount, 0, 'a negative amount must clamp to 0, not go negative');
  assert.equal(tooHigh.effect.amount, 255, '999 must clamp to the byte ceiling');
  assert.equal(fractional.effect.amount, 5, '4.6 must round the same way damageAmount already does for Heal/Damage commands');
  assert.equal(notANumber.effect.amount, 0, 'a non-numeric amount must not throw and must become 0');
});

test('migrateItemsFromActors: a legacy pre-item-schema project’s synthesized item also derives its effect from the backing actor’s battle.heal', () => {
  // No `items` array at all -- the pre-item-schema discriminator, so this
  // goes through migrateItemsFromActors rather than normalizeItem.
  const project = normalizeProject({
    sprites: { actors: [{ id: 0, name: 'Torch', behavior: 'pickup', battle: { heal: 15 } }] }
  });
  assert.equal(project.items.length, 1, 'the pickup actor should synthesize exactly one item');
  assert.deepEqual(project.items[0].effect, { kind: 'heal', amount: 15 }, 'the synthesized item should derive its effect the same way normalizeItem’s own migration does');
});

test('validateProject: an item’s effect is only refused when present and malformed -- absent is tolerated like metaspriteId: null already is', () => {
  const base = createProject('Effects');
  base.sprites.actors.push({ id: 0, name: 'Backer', behavior: 'pickup', battle: { heal: 10 } });

  const missing = structuredClone(base);
  missing.items = [{ id: 0, name: 'Legacy', actorId: 0, metaspriteId: null }]; // no `effect` key at all
  assert.ok(
    !validateProject(missing).some((p) => /effect/i.test(p.message)),
    'an item built before this field existed (no `effect` key) must not be refused'
  );

  const wellFormed = structuredClone(base);
  wellFormed.items = [{ id: 0, name: 'Fine', actorId: 0, metaspriteId: null, effect: { kind: 'heal', amount: 10 } }];
  assert.ok(
    !validateProject(wellFormed).some((p) => /effect/i.test(p.message)),
    'a well-formed explicit effect must not be refused'
  );

  const badKind = structuredClone(base);
  badKind.items = [{ id: 0, name: 'BadKind', actorId: 0, metaspriteId: null, effect: { kind: 'poison', amount: 5 } }];
  const badKindProblems = validateProject(badKind);
  assert.ok(
    badKindProblems.some((p) => p.severity === 'error' && /effect/i.test(p.message)),
    'an item with an unrecognized explicit effect kind must be refused'
  );

  const badAmount = structuredClone(base);
  badAmount.items = [{ id: 0, name: 'BadAmount', actorId: 0, metaspriteId: null, effect: { kind: 'heal', amount: 999 } }];
  const badAmountProblems = validateProject(badAmount);
  assert.ok(
    badAmountProblems.some((p) => p.severity === 'error' && /effect/i.test(p.message)),
    'an item with an out-of-range explicit effect amount must be refused'
  );

  // Round 1b review finding A2: main/project-io.js's saveProject normalizes
  // its own local copy of whatever it is handed and writes that to disk --
  // it never hands the normalized project back to the live renderer store,
  // so re-saving from the same session leaves this refusal in place forever.
  // Only closing and reopening the project actually runs loadProject (and so
  // normalizeProject) fresh. The advice must say so, and must attribute the
  // problem to the Items Forge now that one exists (round 1b) rather than
  // the Sprite Forge, which never edited this field.
  const effectProblem = badKindProblems.find((p) => /effect/i.test(p.message));
  assert.equal(effectProblem.where, 'Items Forge', 'a malformed effect is an Items Forge problem now that one exists');
  assert.doesNotMatch(
    effectProblem.message,
    /re-save/i,
    'must not tell the author to re-save -- saveProject normalizes a local copy and never updates the live session'
  );
  assert.match(
    effectProblem.message,
    /close and reopen/i,
    'must tell the author to actually reload the project, since that is what runs normalizeProject again'
  );
});

test('a battle formation’s empty-slot sentinel is a fixed point, not decremented again by the next actor deletion', () => {
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
              // An authored formation already holding the empty-slot sentinel —
              // a hand-edited project, or one written by a later version.
              commands: [{ op: 'battle', monsters: [NO_ACTOR, 2] }]
            }
          ]
        }
      }
    }
  ];

  renumberActorDeletion(project, 1); // delete "B"
  renumberActorDeletion(project, 0); // now delete "A", from underneath it
  const page = project.maps[0].screens[0].entities[0].props.event.pages[0];
  assert.deepEqual(
    page.commands[0].monsters,
    [NO_ACTOR, 0],
    'an empty formation slot is the sentinel and must not be walked either — while the real id beside it ' +
      'shifts once per deletion (2 → 1 → 0), the sentinel stays put; walked, it would read $FD by now'
  );
});

test('a reference already marked missing is a fixed point, not decremented again by the next item deletion', () => {
  const project = createProject('Quest', 'rpg');
  project.items = [{ id: 0, name: 'A' }, { id: 1, name: 'B' }, { id: 2, name: 'C' }, { id: 3, name: 'D' }];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: [{ cond: { type: 'hasItem', arg: 1 }, commands: [{ op: 'give', item: NO_ITEM }] }]
        }
      }
    }
  ];

  renumberItemDeletion(project, 1); // delete item "B" — the condition becomes missing
  const page = project.maps[0].screens[0].entities[0].props.event.pages[0];
  assert.equal(page.cond.arg, NO_ITEM, 'the first deletion marks the condition missing');

  renumberItemDeletion(project, 0); // now delete item "A", from underneath it
  assert.equal(
    page.cond.arg,
    NO_ITEM,
    'a condition already marked missing must stay exactly NO_ITEM — walked down once per later deletion it ' +
      'drifts to $FE, $FD, … and comes back into range the moment the item list grows again'
  );
  assert.equal(
    page.commands[0].item,
    NO_ITEM,
    'a hand-edited Give/Take already holding NO_ITEM must not be walked as if it were a real id either'
  );
});

test('a Carrying item condition that names nothing normalizes to NO_ITEM, never to item 0', () => {
  // Everything itemMissing calls missing, which is exactly what the Map
  // Forge's own select now renders as "Missing item". If normalization
  // disagrees with that display the editor shows one thing and the ROM asks
  // after another — the disagreement the select was added to prevent.
  //
  // items: [] (present, even empty) is deliberate: it puts this project past
  // the migration and onto the plain "a Carrying number is already an item
  // id" path (see normalizeCondition), which is the one `itemConditionArg`
  // actually governs — roster-blind, the same as `actorConditionArg` always
  // was. The migration's own translation of a raw legacy actor id has a
  // separate test below, because resolving *that* genuinely depends on
  // which actors exist, unlike this one.
  const condition = (arg) =>
    normalizeProject({
      project: { name: 'Q', gameType: 'rpg' },
      items: [{ id: 0, name: 'Key' }, { id: 1, name: 'Potion' }, { id: 2, name: 'Map' }],
      maps: [
        {
          screens: [
            {
              entities: [
                { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'hasItem', arg }, commands: [{ op: 'say', text: 'hi' }] }] } } }
              ]
            }
          ]
        }
      ]
    }).maps[0].screens[0].entities[0].props.event.pages[0].cond;

  for (const raw of [null, undefined, -1, -0.4, 2.4, '2', 'gem', {}, NaN, Infinity]) {
    assert.equal(
      condition(raw).arg,
      NO_ITEM,
      `a condition argument of ${JSON.stringify(raw) ?? String(raw)} names no item, so it must normalize to the ` +
        'sentinel rather than being rounded or floored into a real item id'
    );
  }
  // A real reference is untouched, sentinel included.
  assert.equal(condition(2).arg, 2, 'a genuine item id must survive normalization unchanged');
  assert.equal(condition(0).arg, 0, 'item 0 is a real item, not a missing one');
  assert.equal(condition(NO_ITEM).arg, NO_ITEM, 'the sentinel itself round-trips');
});

test('a Carrying item condition migrated from a raw actor id resolves through the migration’s own map, never to item 0', () => {
  // The migration path (no items[] on the raw project) is a different
  // mechanism from the one above: it translates a *raw actor id* into the
  // item the migration created for it, so whether a value "resolves" here
  // genuinely depends on which actors exist — unlike itemConditionArg, this
  // is not roster-blind.
  const project = normalizeProject({
    project: { name: 'Q', gameType: 'rpg' },
    sprites: { actors: [{ name: 'Torch', behavior: 'pickup' }] },
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                x: 0,
                y: 0,
                props: {
                  event: {
                    pages: [
                      { cond: { type: 'hasItem', arg: 0 }, commands: [{ op: 'say', text: 'real' }] },
                      { cond: { type: 'hasItem', arg: 99 }, commands: [{ op: 'say', text: 'stale' }] },
                      { cond: { type: 'hasItem', arg: 'gem' }, commands: [{ op: 'say', text: 'garbage' }] }
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
  const [real, stale, garbage] = project.maps[0].screens[0].entities[0].props.event.pages;
  assert.equal(project.items.length, 1, 'the migration creates exactly one item for the one pickup actor');
  assert.equal(real.cond.arg, 0, 'a raw actor id the migration mapped to an item resolves to that item’s id');
  assert.equal(stale.cond.arg, NO_ITEM, 'a raw actor id past the end of the roster has no item to resolve to');
  assert.equal(garbage.cond.arg, NO_ITEM, 'a non-numeric raw value has no item to resolve to either');
});

// --- correction #2: the migration's own reference-collecting walk has to
// find a Carrying condition wherever one sits, mirroring renumberActorDeletion's
// renumberCondition(page.cond) called apart from its allCommands loop --------
//
// Every actor below is `npc`, deliberately not `pickup`: the only way it ends
// up in project.items at all is if migrateItemsFromActors' own walk actually
// visits the condition naming it. A test that used a pickup actor here (as
// the test above does, for a different reason) could not tell "the walk ran"
// from "the actor was going to get an item anyway" -- which is exactly how
// this gap went uncaught: the existing page-level coverage happened to use a
// pickup actor. Two referenced actors per test, not one, so the assertion
// pins the *correct* item id each resolves to (0 and 1, in ascending actor-id
// order) rather than merely "not the old actor id" -- a bug that mapped both
// to the same item, or swapped them, would still pass a single-actor check.

test('the migration walks a page’s own Carrying condition, not only its commands’ (correction #2)', () => {
  const project = normalizeProject({
    project: { name: 'Q', gameType: 'rpg' },
    sprites: {
      actors: [
        { name: 'Player', behavior: 'player' },
        { name: 'A', behavior: 'npc' },
        { name: 'B', behavior: 'npc' }
      ]
    },
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                x: 0,
                y: 0,
                props: {
                  event: {
                    pages: [
                      { cond: { type: 'hasItem', arg: 1 }, commands: [{ op: 'say', text: 'A' }] },
                      { cond: { type: 'hasItem', arg: 2 }, commands: [{ op: 'say', text: 'B' }] },
                      { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'neither' }] }
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
  assert.equal(
    project.items.length,
    2,
    'A and B are named only by their own page conditions, so an item exists for either only if the migration ' +
      'walked page.cond directly'
  );
  const [pageA, pageB] = project.maps[0].screens[0].entities[0].props.event.pages;
  assert.equal(pageA.cond.arg, 0, 'actor A (raw id 1) must migrate to item 0, the correct id -- not merely a changed one');
  assert.equal(pageB.cond.arg, 1, 'actor B (raw id 2) must migrate to item 1');
});

test('the migration walks a branch’s own Carrying condition, nested inside a page (correction #2)', () => {
  const project = normalizeProject({
    project: { name: 'Q', gameType: 'rpg' },
    sprites: {
      actors: [
        { name: 'Player', behavior: 'player' },
        { name: 'A', behavior: 'npc' },
        { name: 'B', behavior: 'npc' }
      ]
    },
    maps: [
      {
        screens: [
          {
            entities: [
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
                            cond: { type: 'hasItem', arg: 1 },
                            then: [],
                            // A branch inside a branch: the nesting allCommands (and this
                            // walk) already has to support elsewhere in this file.
                            else: [{ op: 'branch', cond: { type: 'hasItem', arg: 2 }, then: [], else: [] }]
                          }
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
  assert.equal(
    project.items.length,
    2,
    'A and B are named only by branch conditions, so an item exists for either only if the migration walked ' +
      'command.cond inside walkRawCommandList'
  );
  const [outer] = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  assert.equal(outer.cond.arg, 0, 'actor A (raw id 1), named by the outer branch, must migrate to item 0');
  assert.equal(outer.else[0].cond.arg, 1, 'actor B (raw id 2), named two branches deep, must migrate to item 1');
});

test('the migration walks a Carrying condition nested inside a question’s option (correction #2)', () => {
  const project = normalizeProject({
    project: { name: 'Q', gameType: 'rpg' },
    sprites: {
      actors: [
        { name: 'Player', behavior: 'player' },
        { name: 'A', behavior: 'npc' },
        { name: 'B', behavior: 'npc' }
      ]
    },
    maps: [
      {
        screens: [
          {
            entities: [
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
                            op: 'choice',
                            options: [
                              { text: 'Yes', commands: [{ op: 'branch', cond: { type: 'hasItem', arg: 1 }, then: [], else: [] }] },
                              { text: 'No', commands: [{ op: 'branch', cond: { type: 'hasItem', arg: 2 }, then: [], else: [] }] }
                            ]
                          }
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
  assert.equal(
    project.items.length,
    2,
    'A and B are named only inside a question’s options, so an item exists for either only if the migration ' +
      'walk recurses into option.commands, not only command.then/else'
  );
  const [choice] = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  assert.equal(choice.options[0].commands[0].cond.arg, 0, 'option "Yes" — actor A (raw id 1) — must migrate to item 0');
  assert.equal(choice.options[1].commands[0].cond.arg, 1, 'option "No" — actor B (raw id 2) — must migrate to item 1');
});

test('the actor roster is capped one short of the sentinel, so $FF can never name a real actor', () => {
  // NO_ACTOR is what every scalar actor reference means by "nothing" and what
  // every list pads an empty slot with. It is a byte, so the only way it can
  // stay unambiguous is for the roster never to reach it — the same rule
  // MAX_TABLE already applies to the compiled events table.
  assert.equal(LIMITS.actors, NO_ACTOR, 'the cap is the sentinel: ids run 0..NO_ACTOR-1');
  assert.equal(LIMITS.actors - 1, 0xfe, 'so the highest legal actor id is $FE');
});

test('a roster past the cap is refused, and a full one is not', () => {
  const project = createProject('Quest', 'action');
  const roster = (count) => Array.from({ length: count }, (_, id) => ({ name: `A${id}` }));

  project.sprites.actors = roster(LIMITS.actors);
  assert.deepEqual(
    validateProject(project).filter((problem) => /actors but/.test(problem.message)),
    [],
    'exactly LIMITS.actors is legal — the cap is a ceiling, not a limit one below it'
  );

  project.sprites.actors = roster(LIMITS.actors + 1);
  const errors = validateProject(project).filter((problem) => /actors but/.test(problem.message));
  assert.equal(errors.length, 1, 'one actor past the cap should be refused');
  assert.equal(errors[0].severity, 'error', 'an id that collides with the sentinel cannot be compiled at all');
  assert.equal(errors[0].where, 'Sprite Forge', 'the roster is edited in the Sprite Forge');
  assert.match(errors[0].message, new RegExp(String(LIMITS.actors)), 'the message should say what the ceiling is');
});

test('a project arriving over the cap keeps its actors; references to them are byte-clamped, and it says so', async (t) => {
  // LIMITS.actors + 2, not + 1: at + 1 the highest id is 255, which is still
  // byte-representable, so the old version of this test passed without ever
  // exercising a reference that cannot be encoded at all. 257 actors means a
  // highest id of 256, which is what actually forces the question.
  //
  // The contract this pins is deliberately narrower than "everything is
  // preserved", which is what an earlier comment here claimed and which was
  // never true: the actor *records* survive a round trip, so nothing is
  // deleted behind the author's back and the build is refused instead — but a
  // *reference* is a single byte in the ROM, and every reference field clamps
  // to one on load. Why those clamps stay rather than being widened is argued
  // where they live (normalizeProject, shared/project.js); the short version
  // is that the byte invariant belongs to this boundary and widening would
  // move the narrowing burden onto five separate consumers. It is *not* that
  // a widened value could corrupt a ROM — it could not, and the build
  // assertions at the end of this test are what say so.
  const over = LIMITS.actors + 2;
  const last = over - 1; // id 256 — one past what a byte can name
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-overcap-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const authored = createProject('Quest', 'action');
  authored.sprites.actors = Array.from({ length: over }, (_, id) => ({
    id,
    name: `A${id}`,
    behavior: 'npc',
    speed: 1,
    hp: 1,
    anims: {},
    battle: {}
  }));
  authored.maps[0].encounters = { rate: 8, actorIds: [last] };
  authored.maps[0].screens[0].entities = [
    {
      actorId: last,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'battle', monsters: [last] }] }]
        }
      }
    }
  ];
  // An item is the fourth kind of actor reference now — Give/Take, Carrying
  // and a monster's drop moved to the *item* id space this phase (see
  // renumberItemDeletion), so they no longer clamp against LIMITS.actors at
  // all; project.items[].actorId is the one genuinely new actor reference
  // this phase adds, and it needs its own assertion for the identical
  // reason the other three do — widening it would slip past every one below.
  authored.items = [{ id: 0, name: 'Loot', actorId: last }];

  await saveProject(dir, authored);
  const loaded = await loadProject(dir); // a real round trip, not normalizeProject in isolation

  // What is preserved: the records. Truncating them would erase real,
  // drawable work and leave every reference to it dangling — placements
  // included, which nothing validates.
  assert.equal(loaded.sprites.actors.length, over, 'every actor survives the round trip');
  assert.equal(loaded.sprites.actors[last].name, `A${last}`, 'including the ones past the ceiling');

  // What is not: any reference naming them. Every one of the four kinds
  // clamps to $FF, and each is asserted separately because each has its own
  // normalizer — widening any single one of them has to fail here.
  const entity = loaded.maps[0].screens[0].entities[0];
  const page = entity.props.event.pages[0];
  assert.equal(entity.actorId, 0xff, 'a placement above the byte range clamps');
  assert.deepEqual(page.commands[0].monsters, [0xff], 'so does a battle formation');
  assert.deepEqual(loaded.maps[0].encounters.actorIds, [0xff], 'so does an encounter table entry');
  assert.equal(loaded.items[0].actorId, 0xff, 'so does an item’s own backing actor');

  // And the author is told, in the refusal.
  const errors = validateProject(loaded).filter((problem) => /actors but/.test(problem.message));
  assert.equal(errors.length, 1, 'the build is refused');
  assert.match(errors[0].message, /not preserved/, 'the refusal must say that references above the ceiling do not survive');

  // Refusal precedes emission, pinned against a real build rather than
  // inferred from validateProject alone. This ordering is what keeps a
  // schema-clamped reference from being the only thing between a non-byte and
  // a .db, so it is load-bearing for the clamps' own justification and must
  // not be left to a reading of generateAssets. Needs no nesasm: the throw
  // happens in generateAssets, the first thing buildProject calls.
  await assert.rejects(
    () => buildProject({ dir, project: loaded, log: () => {} }),
    /actors but/,
    'an over-cap project must be refused by the build, not merely reported by validateProject'
  );
  await assert.rejects(
    () => fs.access(path.join(dir, 'build')),
    'the refusal must come before any asset is written — generateAssets throws before it creates build/'
  );
});

test('the delete confirmation says what deleting while over the ceiling costs', () => {
  // The build refusal is not reachable from the Sprite Forge: validateProject
  // is rendered only by the Build Forge (renderer/forges/build/build.js), and
  // a project reopens in whichever Forge was last active. So an author can
  // open an over-cap project, go straight to Actors and delete, having never
  // seen it. This is the string that meets them where the edit actually
  // happens; it is a pure function so it can be asserted here as well as
  // through the real dialog in `npm run smoke`.
  const project = createProject('Quest', 'action');
  const roster = (count) => Array.from({ length: count }, (_, id) => ({ name: `A${id}` }));

  project.sprites.actors = roster(LIMITS.actors);
  assert.equal(overCapDeleteWarning(project), '', 'a legal roster gets no warning — every reference is representable');

  project.sprites.actors = roster(LIMITS.actors + 1);
  const warning = overCapDeleteWarning(project);
  assert.match(warning, new RegExp(String(LIMITS.actors)), 'it should name the ceiling');
  assert.match(warning, new RegExp(String(LIMITS.actors - 1)), 'and the highest id a reference can still name');
  assert.match(warning, /not preserved/, 'and say plainly that those references do not survive');
});

test('the missing-item sentinel survives normalization and reaches the ROM as NO_ITEM', () => {
  // The in-memory assertions above would all still pass if a later
  // normalization or compiler change quietly turned the sentinel into 0 —
  // which is the one thing renumberItemDeletion's whole rationale depends on
  // not happening. This is the round trip: delete, normalize, compile, and
  // read the operand the engine will actually see. NO_ITEM (phase 4b): a
  // Carrying condition compiles to the item id directly now (itemMissing),
  // not an actor byte reached through the backing actor — has_item
  // (engine/script.asm) does a byte-equality scan of inv_items, which holds
  // item ids under ITEMS_ENABLED, so this is the wire format that matters.
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'Gem' }, { name: 'Relic' }];
  project.items = [{ id: 0, name: 'Gem', actorId: 0 }, { id: 1, name: 'Relic', actorId: 1 }];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: [
            { cond: { type: 'hasItem', arg: 1 }, commands: [{ op: 'say', text: 'You have the relic.' }] },
            { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Nothing here.' }] }
          ]
        }
      }
    }
  ];

  renumberItemDeletion(project, 1);
  project.items.splice(1, 1);

  const [event] = compileText(normalizeProject(project)).events;
  // A page header is [cond, arg, value, body length].
  assert.equal(event[0], EVENT_CONDITIONS.findIndex((entry) => entry.id === 'hasItem'), 'page 1 is still the Carrying item page');
  assert.equal(
    event[1],
    NO_ITEM,
    'the condition must reach the ROM as NO_ITEM — as 0 it would ask after whichever item now sits at id 0'
  );
});

// --- the byte-identity proof, kept as a live regression instead of a pinned
// hash (round 2's decision on the golden-hash question) --------------------
//
// A pinned whole-ROM sha256 records what was emitted the day it was written,
// which cannot tell "correct" from "consistently wrong" -- the thing that
// actually proved correctness during phase 3 was a before/after rebuild
// against the pre-migration code, and that proof cannot be repeated once
// this is committed. Pinning its *result* is not the same as keeping the
// proof, and phase 4 changes these exact bytes on purpose (inv_items
// becomes item-keyed), so the constant's first encounter with drift would
// be a legitimate change -- exactly the kind of bound this codebase's own
// convention (kernelbytes.test.js, bankedbytes.test.js) refuses to loosen
// reflexively when hit.
//
// Phase 4b rewrite: Give/Take, Carrying and mon_drop no longer resolve
// through the backing actor at all -- they compile to the item id directly
// (itemMissing's existence check, NO_ITEM for anything that fails it). This
// test now asserts that directly: build the synthesized scenario -- take, a
// page-level hasItem, a hasItem nested inside a branch, give, and a
// non-null battle.drop -- and assert each compiled operand equals the item
// id itself, computed from the project rather than written as a literal
// here. It fails the moment any of the three sites (Give/Take, Carrying,
// mon_drop) drifts from the other two.
test('Give, Take, a nested Carrying condition, and a monster’s drop all compile to the item id directly', () => {
  const project = createProject('Compile', 'rpg');
  project.sprites.actors = [
    { name: 'Player', behavior: 'player' },
    { name: 'A', behavior: 'npc' },
    { name: 'B', behavior: 'npc' },
    { name: 'C', behavior: 'npc' },
    { name: 'Monster', damage: 1, battle: { atk: 4, def: 2 } }
  ];
  // actorId deliberately does not track item id -- a bug that resolved
  // through the backing actor (the pre-4b behaviour) would produce a
  // wrong-but-plausible byte here, not an obviously-broken one.
  project.items = [
    { id: 0, name: 'Zero', actorId: 3, metaspriteId: null }, // backs C -- irrelevant to what this compiles to now
    { id: 1, name: 'One', actorId: 2, metaspriteId: null },
    { id: 2, name: 'Two', actorId: 1, metaspriteId: null }
  ];
  project.sprites.actors[4].battle.drop = 1; // Monster drops item 1
  project.sprites.actors[4].battle.dropPct = 20;
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: [
            {
              cond: { type: 'hasItem', arg: 0 }, // page-level Carrying: item 0
              commands: [
                { op: 'give', item: 2 },
                { op: 'take', item: 1 },
                {
                  op: 'branch',
                  cond: { type: 'hasItem', arg: 2 }, // nested Carrying: item 2
                  then: [{ op: 'say', text: 'x' }],
                  else: []
                }
              ]
            }
          ]
        }
      }
    }
  ];

  const normalized = normalizeProject(project);
  const built = compileText(normalized);
  const [event] = built.events;

  const OP_GIVE = opIndex('give');
  const OP_TAKE = opIndex('take');
  const OP_BRANCH = opIndex('branch');
  const HAS_ITEM = EVENT_CONDITIONS.findIndex((entry) => entry.id === 'hasItem');

  // Page header: [cond, arg, value, bodyLength].
  assert.equal(event[0], HAS_ITEM, 'the page condition is still Carrying');
  assert.equal(event[1], 0, 'the page-level Carrying operand equals item id 0 directly');

  // Positions, not indexOf: opcode and condition-index values are both
  // small enumerated ints (EVENT_COMMANDS' and EVENT_CONDITIONS' own row
  // order), so a blind indexOf can match an unrelated byte that happens to
  // carry the same small value elsewhere in the event — here, opIndex('take')
  // and this project's own Carrying-condition index collide numerically,
  // and indexOf(OP_TAKE) found the page header's own arg byte first. The
  // page header is a fixed 4 bytes and the command list's order is exactly
  // what this test authored (give, then take, then the branch), each a
  // known width, so the next command's position is computable rather than
  // searched for.
  const giveAt = 4; // right after the 4-byte page header
  assert.equal(event[giveAt], OP_GIVE, 'the first command is still Give');
  assert.equal(event[giveAt + 1], 2, 'Give’s operand equals item id 2 directly');

  const takeAt = giveAt + 2; // Give is a 2-byte command: opcode, operand
  assert.equal(event[takeAt], OP_TAKE, 'the second command is still Take');
  assert.equal(event[takeAt + 1], 1, 'Take’s operand equals item id 1 directly');

  // A branch's own header is [OP_IF-shaped: opcode, cond, arg, value, ...],
  // the same header a page carries, so the nested condition's arg sits two
  // bytes after the branch opcode.
  const branchAt = takeAt + 2; // Take is also a 2-byte command
  assert.equal(event[branchAt], OP_BRANCH, 'the third command is still the branch');
  assert.equal(event[branchAt + 1], HAS_ITEM, 'the nested condition is still Carrying');
  assert.equal(
    event[branchAt + 2],
    2,
    'the nested Carrying operand equals item id 2 directly, the same item Give named — proving the two sites agree'
  );

  // mon_drop, the third and last site asking the identical question about
  // the same item space, in a different file (main/build/battletables.js).
  const row = /^mon_drop:\n(.*)$/m.exec(battleTables(normalized));
  assert.ok(row, 'battleTables should emit a mon_drop table');
  const dropBytes = row[1].trim().replace(/^\.db /, '').split(',').map((s) => parseInt(s.replace('$', ''), 16));
  assert.equal(dropBytes[4], 1, 'the Monster’s (actor 4) drop compiles to item id 1 directly');
});

// ROADMAP item 5, phase 4c round 1d (finding D1): item_heal's source moved
// from the backing actor's battle.heal to items[].effect. Compatibility is
// the thing that has to be proven here, not inferred from a passing build --
// for a project migrated from the pre-4c economy, effect.amount was itself
// derived from this exact battle.heal (shared/project.js's deriveItemEffect),
// so the emitted table must still be byte-identical to what the old
// backing-actor derivation would have produced.
function itemHealBytes(project) {
  const row = /^item_heal:\n((?:\s*\.db .*\n?)+)/m.exec(battleTables(project));
  assert.ok(row, 'battleTables should emit an item_heal table');
  return row[1]
    .trim()
    .split('\n')
    .flatMap((line) => line.replace(/^\s*\.db\s*/, '').split(',').map((s) => parseInt(s.replace('$', ''), 16)));
}

test('item_heal stays byte-identical to the old backing-actor derivation for a project migrated from the pre-4c economy', () => {
  const project = normalizeProject({
    project: { gameType: 'rpg' },
    sprites: {
      actors: [
        { name: 'Potion', behavior: 'pickup', battle: { heal: 30 } },
        { name: 'Ether', behavior: 'pickup', battle: { heal: 0 } }, // migrates to kind 'none', amount 0
        { name: 'Slime', damage: 1, battle: {} } // not a pickup -- never referenced, no item synthesized
      ]
    }
  });
  assert.equal(project.items.length, 2, 'sanity: exactly the two pickup actors migrate into items');

  // The pre-4c formula, recomputed directly against the same raw actor
  // roster rather than by re-invoking removed code.
  const oldDerivation = project.items.map((item) => {
    const actor = typeof item.actorId === 'number' ? project.sprites.actors[item.actorId] : undefined;
    return actor?.battle?.heal ?? 0;
  });

  const emitted = itemHealBytes(project);
  assert.deepEqual(
    emitted,
    oldDerivation,
    'item_heal must emit exactly what the old backing-actor derivation would have, for a project that has not touched effect since migrating'
  );
  assert.deepEqual(emitted, [30, 0], 'sanity: matches the actors’ own battle.heal values directly');
});

// Round 1e review finding E2: the two cases above never told item_heal's
// real source (items[].effect) apart from the pre-4c one it replaced
// (actors[item.actorId].battle.heal) -- a damage-kind edit reads 0 under
// either formula, so it passed a counterexample that reads the actor and
// merely gates on kind. The only shape that discriminates the two sources is
// a heal-kind item whose effect.amount no longer matches its backing actor's
// battle.heal; the three cases after it close the same gap for actorId null,
// a deleted backing actor, and the normalization boundary.
test('item_heal reads an item’s own effect.amount directly, not the backing actor’s battle.heal gated by kind', () => {
  const project = normalizeProject({
    project: { gameType: 'rpg' },
    sprites: { actors: [{ name: 'Potion', behavior: 'pickup', battle: { heal: 30 } }] }
  });
  assert.deepEqual(project.items[0].effect, { kind: 'heal', amount: 30 }, 'sanity: migrated as a heal-30 potion');

  // Still heal-kind, still naming the same actor (whose battle.heal is still
  // 30) -- only effect.amount itself changes, simulating an Items Forge
  // edit. A formula that reads the actor gated on kind would still emit 30;
  // only reading effect.amount directly emits 99.
  project.items[0].effect = { kind: 'heal', amount: 99 };

  assert.deepEqual(
    itemHealBytes(project),
    [99],
    'item_heal must follow effect.amount (99) even though the backing actor’s own battle.heal (30) is unchanged and the kind is still heal'
  );
});

// The exact scenario finding D1 named: "changing a migrated potion to
// Damages 12 still healed its old actor amount". Kept alongside the
// discriminating case above, not in place of it -- this alone cannot tell
// the two sources apart (both formulas emit 0 for a non-heal kind), but it
// is still real coverage for the specific bug D1 reported.
test('item_heal emits 0 for a damage-kind item, not the migrated actor’s battle.heal it came from', () => {
  const project = normalizeProject({
    project: { gameType: 'rpg' },
    sprites: { actors: [{ name: 'Potion', behavior: 'pickup', battle: { heal: 30 } }] }
  });
  project.items[0].effect = { kind: 'damage', amount: 12 };

  assert.deepEqual(
    itemHealBytes(project),
    [0],
    'a damage-kind item must emit 0 for item_heal -- not 30, the actor’s old battle.heal it was migrated from'
  );
});

test('item_heal reads a heal-kind item’s own effect.amount when actorId is null -- a script-only item has no actor to fall back to at all', () => {
  const project = normalizeProject({
    items: [{ id: 0, name: 'Elixir', actorId: null, effect: { kind: 'heal', amount: 50 } }]
  });
  assert.deepEqual(itemHealBytes(project), [50], 'a script-only heal item must emit its own amount, not 0 from a missing actor');
});

test('item_heal reads a heal-kind item’s own effect.amount even when its backing actor no longer exists', () => {
  const project = normalizeProject({
    // actorId 5 names nothing -- the actor this item was migrated from was
    // deleted since, the same stale-reference shape renumberActorDeletion
    // already handles for every other actor-typed field.
    items: [{ id: 0, name: 'Old Potion', actorId: 5, effect: { kind: 'heal', amount: 40 } }]
  });
  assert.deepEqual(
    itemHealBytes(project),
    [40],
    'a deleted backing actor must not zero out an already-migrated effect -- the migration is one-time and effect is now independent of actorId'
  );
});

test('item_heal reflects normalizeItem’s own amount clamp -- an out-of-range effect.amount reaches item_heal as 255, not the raw value', () => {
  const project = normalizeProject({
    sprites: { actors: [{ name: 'Potion', behavior: 'pickup', battle: { heal: 30 } }] },
    items: [{ id: 0, name: 'Potion', actorId: 0, effect: { kind: 'heal', amount: 999 } }]
  });
  assert.equal(project.items[0].effect.amount, 255, 'sanity: normalizeItem clamps the explicit amount to a byte');
  assert.deepEqual(itemHealBytes(project), [255], 'item_heal must carry the normalized 255, not the raw out-of-range 999');
});

test('a monster whose drop no longer names an actor is a warning, not a refusal', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'Slime', damage: 1, battle: { drop: 7, dropPct: 50 } }];

  const problems = validateProject(project);
  const aboutDrop = problems.filter((problem) => /drop/i.test(problem.message));
  assert.equal(aboutDrop.length, 1, 'a drop past the end of the actor list should be reported exactly once');
  assert.equal(
    aboutDrop[0].severity,
    'warning',
    'a monster that drops nothing still fights, so this is the stale-reference warning, not the Give/Take refusal'
  );
  assert.equal(aboutDrop[0].where, 'Sprite Forge', 'the drop is edited in the Sprite Forge, so that is who it names');

  // renumberActorDeletion's own null is the other way to get here, and reads
  // as deliberate rather than stale: nothing to warn about.
  project.sprites.actors[0].battle.drop = null;
  assert.deepEqual(
    validateProject(project).filter((problem) => /drop/i.test(problem.message)),
    [],
    'a drop of "Nothing" is a choice, not a dangling reference'
  );
});

test('a drop past the end of the item list compiles to “nothing”, not an out-of-range id', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [
    { name: 'Slime', hp: 1, damage: 1, battle: { drop: 7, dropPct: 50 } },
    { name: 'Gem', hp: 1, damage: 0, battle: { drop: null, dropPct: 0 } }
  ];

  const row = /^mon_drop:\n(.*)$/m.exec(battleTables(project));
  assert.ok(row, 'battleTables should emit a mon_drop table');
  assert.equal(
    row[1].trim(),
    '.db $FF,$FF',
    'an unresolvable drop must reach roll_drop as $FF the way a stale mon_spell id already does — add_item does ' +
      'not range-check what it is handed'
  );
});

test('a live Give/Take with a missing item blocks the build; a switched-off one does not', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'Gem' }];
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', item: null }] }] }
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
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', item: 99 }] }] } }
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

// Sting (item 6, sound-effect slice): design-sting.md §10/§12 test 13, round-1 finding 9, round-2
// finding 4. Unlike 'music', NO_SONG is never a legitimate reading for a live Sting -- there is no
// silence-equivalent sting -- so both "never chosen" and "chosen, then deleted" collapse to the
// identical refusal, the Give/Take shape (itemMissing above), not music's own silent-NO_SONG
// fallback. songByte's own behavior means null and an out-of-range index produce the same NO_SONG
// sentinel, which is why one test covers both.
test('a live Sting naming no song, or a deleted one, blocks the build; a switched-off one does not', () => {
  const project = createProject('Fanfare', 'rpg');
  project.songs = [{ name: 'Theme' }];
  const page = (commands) => {
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
    return project;
  };

  // (a) never chosen.
  page([{ op: 'sting', song: null }]);
  let errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Sound sting command.*do not name a real/);

  // (b) chosen, then deleted -- an index past the end of the (one-song) list. songByte collapses
  // this to the identical NO_SONG sentinel (a), so the message is identical too.
  page([{ op: 'sting', song: 5 }]);
  errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Sound sting command.*do not name a real/);

  // (c) switched off: scaffolding that names nothing real must not be what stands between an
  // author and a build, the same escape hatch Give/Take's own check already gives.
  page([{ op: 'sting', song: null, off: true }]);
  assert.deepEqual(validateProject(project).filter((p) => p.severity === 'error'), []);
});

test('a Sting song must resolve its own first pass within 255 frames, both sides of the boundary', () => {
  // The boundary itself, not merely "close to it" (round-1 code review finding 1): 51 rows at
  // framesPerRow 5 is exactly 255 frames (accepted), and 64 rows at framesPerRow 4 is exactly 256
  // (refused). Landing on the two integers either side of the real ceiling is what actually
  // distinguishes the two classic off-by-one validators a looser pair of fixtures (252/258, this
  // test's own first draft) cannot: `frames >= 255` (wrongly refusing the legal value 255) and
  // `frames > 256` (wrongly accepting the illegal value 256) both pass against 252/258, and both
  // are confirmed below to fail against 255/256 before this test is trusted.
  const project = createProject('Overlong', 'rpg');
  const songAt = (rows, framesPerRow) => ({
    ...createSong('Long'),
    tempo: { framesPerRow },
    patterns: [{ id: 0, rows, channels: {} }],
    order: [0]
  });
  const accepted = songAt(51, 5); // 51 * 5 = 255
  const refused = songAt(64, 4); // 64 * 4 = 256
  const page = (song) => {
    project.songs = [song];
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 0 }] }] } } }
    ];
    return project;
  };

  assert.equal(songFrameLength(accepted), 255, 'sanity: the fixture itself lands where the test says it does');
  assert.equal(songFrameLength(refused), 256);

  page(accepted);
  assert.deepEqual(
    validateProject(project).filter((p) => p.severity === 'error'),
    [],
    'a song resolving in exactly 255 frames must not be refused'
  );

  page(refused);
  const errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Sound sting command.*255 frames/);
});

test('a Sting invalid or overlong reference is refused however deep it is nested, inside a common event too', () => {
  // The recursion case round-2 finding 4 asked for explicitly: none of the top-level cases above
  // can catch a validator that scans only a page's own top-level commands, or one that walks map
  // events but skips common events entirely -- both omissions need a case placed exactly where the
  // sabotage would live, not merely claimed against a case that happens to pass anyway.
  const project = createProject('Nested Fanfare', 'rpg');
  project.songs = [{ name: 'Theme' }];
  project.commonEvents = [
    {
      id: 0,
      name: 'Alarm',
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'sting', song: 5 }], else: [] }]
          }
        ]
      }
    }
  ];
  project.maps[0].screens[0].entities = [];

  // (f) live, nested two levels deep (common event -> branch), naming a deleted song.
  let errors = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(errors.length, 1, 'a nested, live, invalid Sting inside a common event should be refused');
  assert.match(errors[0].message, /Sound sting command.*do not name a real/);

  // (g) its switched-off counterpart, at the identical nested location -- liveness still applies
  // correctly once recursion and common-event placement are both in play together.
  project.commonEvents[0].event.pages[0].commands[0].then[0].off = true;
  assert.deepEqual(
    validateProject(project).filter((p) => p.severity === 'error'),
    [],
    'the identical nested reference, switched off, must not be refused'
  );
});

test('validateProject\'s Sting duration check normalizes a malformed song exactly the way compileSong does', () => {
  // (h), round-2 finding 2: songFrameLength(rawSong) has to normalize its own input, not assume a
  // caller already did -- proven here by comparing validateProject's own decision (and, for an
  // accepted one, the compiler's own compiled duration byte) against a deliberately malformed raw
  // song with no tempo at all, which normalizeSong (shared/audio.js) coerces to framesPerRow 6 and
  // a single default 32-row pattern -- 192 frames, well under the ceiling.
  const project = createProject('Malformed', 'rpg');
  project.songs = [{ name: 'No Tempo At All' }]; // no order, no patterns, no tempo
  project.maps[0].screens[0].entities = [
    { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 0 }] }] } } }
  ];

  assert.deepEqual(
    validateProject(project).filter((p) => p.severity === 'error'),
    [],
    'a malformed song that normalizes to a legal duration must not be refused'
  );

  const [compiled] = compileText(project).events;
  assert.deepEqual(
    compiled.slice(4, 7),
    [OP_STING, 0, 192],
    'the compiled duration must match what songFrameLength computes for the identical raw song, ' +
      'proving its own internal normalization actually ran'
  );
});

test('normalizeProject keeps an already-present over-cap items array in full, so validateProject can still see it', () => {
  // Round 2, item 2: this used to slice(0, LIMITS.items) an *already-present*
  // raw.items array on load, the same way project.sprites.actors deliberately
  // does not for the identical reason -- silently truncating here would erase
  // the over-cap condition before validateProject ever ran, so the refusal
  // above could never fire for a hand-edited or later-version project, only
  // for one this version's own (capped) migration produced, which cannot
  // happen. The migration's own cap (migrateItemsFromActors) is a separate,
  // correct case: what it *derives* is capped there on purpose (round 1, Q2).
  const over = LIMITS.items + 5;
  const raw = {
    project: { name: 'Over', gameType: 'rpg' },
    items: Array.from({ length: over }, (_, id) => ({ id, name: `Item ${id}`, actorId: null }))
  };
  const project = normalizeProject(raw);
  assert.equal(project.items.length, over, 'every item survives normalization, not just the first LIMITS.items');
  assert.equal(project.items[over - 1].name, `Item ${over - 1}`, 'including the ones past the ceiling');
  assert.ok(
    validateProject(project).some((p) => /items but/.test(p.message)),
    'with the full list preserved, the over-cap refusal can actually fire'
  );
});

test('an over-cap items list is refused, the same way an over-cap actor roster already is', () => {
  const project = createProject('Quest', 'rpg');
  project.items = Array.from({ length: LIMITS.items + 1 }, (_, id) => ({ id, name: `Item ${id}`, actorId: null }));

  const errors = validateProject(project).filter((p) => /items but/.test(p.message));
  assert.equal(errors.length, 1, 'an over-cap items list should be refused exactly once');
  assert.equal(errors[0].severity, 'error');
  assert.equal(errors[0].where, 'Items Forge', 'items now have an editor of their own (round 1b) -- attributed there');
  assert.match(
    errors[0].message,
    /delete/i,
    'the message should point at the Delete control the Items Forge now offers'
  );
  assert.doesNotMatch(
    errors[0].message,
    /actor roster|the actors/i,
    'the message must not send the author to trim actors -- an already-migrated items array does not shrink ' +
      'when actors do, so that would fix the wrong list'
  );

  project.items.length = LIMITS.items;
  assert.deepEqual(
    validateProject(project).filter((p) => /items but/.test(p.message)),
    [],
    'exactly at the cap is legal'
  );
});

test('two items sharing a backing actor is refused — each item must name a different actor', () => {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = [{ name: 'Key' }];
  project.items = [
    { id: 0, name: 'Rusty Key', actorId: 0, metaspriteId: null },
    { id: 1, name: 'Shiny Key', actorId: 0, metaspriteId: null }
  ];

  const errors = validateProject(project).filter((p) => /more than one item/.test(p.message));
  assert.equal(errors.length, 1, 'two items naming the same actor should be refused exactly once, not once per item');
  assert.equal(errors[0].severity, 'error');

  // Orphaned items (actorId: null) do not collide with each other -- "names
  // no actor" is not "names the same actor twice".
  project.items[1].actorId = null;
  assert.deepEqual(
    validateProject(project).filter((p) => /more than one item/.test(p.message)),
    [],
    'null does not count as a shared actorId'
  );

  // Round 2, item 5: NO_ACTOR ($FF) is normalizeItem's own fallback for a
  // malformed actorId, not a real one -- two independently malformed items
  // must not be reported as "sharing" an actor they neither one names.
  project.items[0].actorId = NO_ACTOR;
  project.items[1].actorId = NO_ACTOR;
  assert.deepEqual(
    validateProject(project).filter((p) => /more than one item/.test(p.message)),
    [],
    'two items that both fell back to NO_ACTOR must not read as sharing an actor'
  );

  project.items[0].actorId = 0;
  project.items[1].actorId = 0;
  project.items.push({ id: 2, name: 'Ceremonial Key', actorId: 0, metaspriteId: null });
  const three = validateProject(project).filter((p) => /more than one item/.test(p.message));
  assert.equal(three.length, 1, 'three items sharing one actor is still one error, naming the one actor involved');

  // Round 4 finding (Medium 5): a stale in-range actorId -- real when the
  // item was authored, orphaned since the actor was deleted -- is a
  // different kind of "does not resolve" than NO_ACTOR, but the same shape:
  // two items that both landed on the identical no-longer-real actorId must
  // not read as "sharing an actor" any more than two independently
  // NO_ACTOR-marked items do above. The only actor in this project is index
  // 0; actorId 7 names nothing.
  project.items[0].actorId = 7;
  project.items[1].actorId = 7;
  project.items[2].actorId = 7;
  assert.deepEqual(
    validateProject(project).filter((p) => /more than one item/.test(p.message)),
    [],
    'three items that all carry the identical stale actorId must not read as sharing a real actor'
  );
});

// --- itemPickerOptions (phase 4b): the single writer of what an item-naming
// <select> offers, extracted after the Map Forge's Carrying and Give/Take
// selects and the Sprite Forge's Drops select were each found keeping their
// own copy of the same filter -- the exact effectiveTrigger-shaped drift
// CLAUDE.md already warns about. One helper, tested here directly; all
// three pickers only ever render its output now.
//
// Round 3 rewrite: existence and pickup-backing became two separate
// questions (shared/project.js's itemMissing docstring). An item whose
// actorId is null or names a deleted actor is not an "orphan" any more --
// it is an ordinary, fully valid item that simply has no physical pickup,
// so it is offered exactly like any other. `missing` now only ever
// represents a selectedId that names no real item at all.

test('itemPickerOptions: every item is offered, regardless of whether it has a physical pickup', () => {
  const items = [
    { id: 0, name: 'Backed', actorId: 1, metaspriteId: null },
    { id: 1, name: 'ScriptOnly', actorId: null, metaspriteId: null }, // never placed, only ever Given
    { id: 2, name: 'StaleBacking', actorId: 5, metaspriteId: null } // named actor no longer exists
  ];

  const { healthy, missing } = itemPickerOptions(items, null);

  assert.deepEqual(
    healthy,
    [
      { value: 0, label: 'Backed', selected: false },
      { value: 1, label: 'ScriptOnly', selected: false },
      { value: 2, label: 'StaleBacking', selected: false }
    ],
    'actorId is optional metadata now -- it must not gate whether an item is offered at all'
  );
  assert.deepEqual(
    missing,
    { value: null, label: 'Missing item', selected: true },
    'a selectedId of null names no real item, so there is something to represent'
  );
});

test('itemPickerOptions: a selectedId naming no real item is the only case that produces a missing entry', () => {
  const items = [
    { id: 0, name: 'One', actorId: null, metaspriteId: null },
    { id: 1, name: 'Two', actorId: null, metaspriteId: null }
  ];

  assert.equal(itemPickerOptions(items, 1).missing, null, 'a real id, even with no pickup backing, has nothing to represent as missing');
  assert.deepEqual(
    itemPickerOptions(items, 99).missing,
    { value: 99, label: 'Missing item', selected: true },
    'an out-of-range id is still missing'
  );
  assert.deepEqual(
    itemPickerOptions(items, undefined).missing,
    { value: undefined, label: 'Missing item', selected: true },
    'undefined is still missing'
  );
});

test('itemPickerOptions: selected-ness lands on exactly one option, healthy or missing, never both or neither', () => {
  const items = [
    { id: 0, name: 'One', actorId: 1, metaspriteId: null },
    { id: 1, name: 'Two', actorId: null, metaspriteId: null }
  ];
  const countSelected = (result) => (result.healthy.filter((o) => o.selected).length + (result.missing?.selected ? 1 : 0));

  // A real selection, backed or not: the missing entry is absent, one
  // healthy option is selected either way.
  assert.equal(countSelected(itemPickerOptions(items, 0)), 1, 'selecting a backed item selects exactly it');
  assert.equal(itemPickerOptions(items, 0).missing, null, 'a real selection has nothing to represent as missing');
  assert.equal(countSelected(itemPickerOptions(items, 1)), 1, 'selecting a script-only item selects exactly it, same as a backed one');
  assert.equal(itemPickerOptions(items, 1).missing, null, 'a script-only item is not missing');

  // A selection naming nothing at all (null, or past the end of the list):
  // still exactly one selected entry, on the missing placeholder.
  assert.equal(countSelected(itemPickerOptions(items, null)), 1, 'selecting nothing still selects exactly the missing entry');
  assert.equal(countSelected(itemPickerOptions(items, 99)), 1, 'an out-of-range id still selects exactly the missing entry');
});

// ROADMAP item 5, phase 4c round 1c: itemActorOptions, the reverse direction
// of itemPickerOptions above -- which actor an item's own `actorId` can name.
// Same {healthy, missing} shape, same "selected-ness lands exactly once"
// discipline.

test('canBackItem: only a pickup-behaviour actor qualifies', () => {
  assert.equal(canBackItem({ behavior: 'pickup' }), true);
  for (const behavior of ['patroller', 'chaser', 'door', 'npc', 'player']) {
    assert.equal(canBackItem({ behavior }), false, `${behavior} must not qualify`);
  }
  assert.equal(canBackItem(null), false, 'a missing actor must not throw and must not qualify');
  assert.equal(canBackItem(undefined), false);
});

test('itemActorOptions: only pickup actors are offered, and null is a legitimate script-only selection with nothing missing', () => {
  const actors = [
    { name: 'Torch', behavior: 'pickup' },
    { name: 'Slime', behavior: 'chaser' },
    { name: 'Gem', behavior: 'pickup' }
  ];

  const { healthy, missing } = itemActorOptions(actors, null);
  assert.deepEqual(
    healthy,
    [
      { value: 0, label: 'Torch', selected: false },
      { value: 2, label: 'Gem', selected: false }
    ],
    'Slime (chaser) must be excluded outright -- nothing reads an item’s actorId for a non-pickup behaviour'
  );
  assert.equal(missing, null, 'null is script-only, a legitimate value with nothing to warn about');
});

test('itemActorOptions: a real selection, backed or script-only, produces no missing entry and selects exactly one option', () => {
  const actors = [{ name: 'Torch', behavior: 'pickup' }];
  const countSelected = (result) => result.healthy.filter((o) => o.selected).length + (result.missing?.selected ? 1 : 0);

  assert.equal(countSelected(itemActorOptions(actors, 0)), 1, 'selecting the one eligible actor selects exactly it');
  assert.equal(itemActorOptions(actors, 0).missing, null);
});

test('itemActorOptions: a stale actorId (no longer resolves at all) is missing, distinct from one that resolves but is not a pickup', () => {
  const actors = [{ name: 'Torch', behavior: 'pickup' }, { name: 'Slime', behavior: 'chaser' }];

  const stale = itemActorOptions(actors, 99);
  assert.deepEqual(stale.missing, { value: 99, label: 'Missing actor', selected: true }, 'out of range entirely -- a stale reference');

  const ineligible = itemActorOptions(actors, 1);
  assert.deepEqual(
    ineligible.missing,
    { value: 1, label: 'Slime (not a Pickup actor)', selected: true },
    'resolves to a real actor, but one whose behaviour changed away from pickup since -- must still show the true stored value, ' +
      'and must say why it is not in the healthy list rather than reading as an unexplained stale reference'
  );
  assert.equal(
    ineligible.healthy.some((o) => o.selected),
    false,
    'the ineligible actor must not also appear selected among the healthy (pickup-only) options'
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

// --- save media (phases 2.2-2.3 of the UNROM 512 flash-save work) ----------

function saveProjectFor(mapperId) {
  const project = createProject('Quest');
  project.cartridge.mapper = mapperId;
  project.project.titleMap = 0; // Save also requires a title, not the thing under test here
  project.project.titleScreen = 0;
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
  return project;
}

test('a live Save command refuses to build on a board with no save medium at all', () => {
  const project = saveProjectFor(0); // NROM -- no battery RAM, no flash chip
  const errors = validateProject(project).filter((p) => p.severity === 'error');
  const message = errors.map((e) => e.message).find((m) => /save/.test(m));
  assert.ok(message, 'expected a Save-related error');
  assert.match(message, /no battery-backed RAM and no self-flashing program ROM/);
  assert.match(message, /Choose MMC1, MMC3 or UNROM 512 in the Build panel, or remove the Save command/);
});

// UNROM 512 used to be refused here on purpose (phase 2.2: the medium was
// real but engine/save.asm had no flash driver yet, see
// saveMediaImplemented's own comment in shared/cartridge.js). Phase 2.3
// gave it engine/flash.asm and flipped SAVE_FLASH_IMPLEMENTED, so it now
// belongs in the same "not refused" bucket as the battery boards -- the
// same swap the flag itself was built to make in one place, verified here
// by the fact that this test needed no code change beyond adding 30 to the
// list below.
test('a live Save command on any save-capable board (MMC1, MMC3, UNROM 512) is not refused', () => {
  for (const mapperId of [1, 4, 30]) {
    const project = saveProjectFor(mapperId);
    const errors = validateProject(project).filter((p) => p.severity === 'error');
    const saveErrors = errors.filter((e) => /save/.test(e.message));
    assert.deepEqual(saveErrors, [], `mapper ${mapperId} should not refuse a live Save`);
  }
});

test("a Give/Take's missing item survives normalize instead of clamping to a real one", () => {
  // No raw.items here at all -- the migration path. A raw actor: null has
  // nothing for actorToItem to resolve, so it stays null rather than
  // clamping to item 0.
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
  assert.equal(command.item, null, 'the generic byte clamp would have turned this into item 0 -- a real item id');
  // And a second pass leaves it exactly where the first one did.
  assert.deepEqual(normalizeProject(structuredClone(project)).maps, project.maps);
});

test("a Give/Take's explicit item: null is preserved, once items[] already exists, rather than resurrecting a legacy actor", () => {
  // Correction #7: property presence decides which raw field wins, and an
  // explicit `item: null` must not fall back to a conflicting legacy
  // `actor` and resurrect it -- the new field always wins outright.
  const project = normalizeProject({
    items: [{ id: 0, name: 'Key' }],
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                x: 0,
                y: 0,
                props: {
                  event: {
                    pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', item: null, actor: 0 }] }]
                  }
                }
              }
            ]
          }
        ]
      }
    ]
  });
  const [command] = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  assert.equal(command.item, null, 'an explicit item: null must be kept, not overridden by a conflicting legacy actor');
});

test('a legacy-only actor on an already-migrated project resolves to missing, never synthesizing a new item', () => {
  // Correction #7's fourth bullet: once items[] exists, a stray legacy
  // `actor` field (no `item` present at all) resolves to missing rather
  // than growing the items list outside the one-time migration.
  const project = normalizeProject({
    items: [{ id: 0, name: 'Key', actorId: 5 }],
    sprites: { actors: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }, { name: 'F' }] },
    maps: [
      {
        screens: [
          {
            entities: [
              {
                actorId: 0,
                x: 0,
                y: 0,
                props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', actor: 5 }] }] } }
              }
            ]
          }
        ]
      }
    ]
  });
  const [command] = project.maps[0].screens[0].entities[0].props.event.pages[0].commands;
  assert.equal(command.item, null, 'a legacy actor reference on an already-migrated project resolves to missing');
  assert.equal(project.items.length, 1, 'no new item was synthesized for it');
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
  battle: 1 + RPG_LIMITS.monstersPerBattle,
  heal: 2,
  damage: 2,
  // [opcode, who, dir, dist] / [opcode, who, dir] / [opcode, frames] -- the
  // same per-leg byte figures design-routes.md's own §3.4 gives, matching
  // what a route's legs compile to exactly as well as what a bare Move/
  // Turn/Wait command does. No `route` entry: no byte ever decodes as one
  // (route is `virtual: true`, EVENT_COMMANDS) -- adding one here would
  // silently paper over a bug where a route opcode leaked into the output.
  move: 4,
  turn: 3,
  wait: 2,
  // [opcode, id, duration] -- the identical [opcode, song, duration] shape
  // OP_STING already has, one format over.
  sfx: 3
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
  project.sfx = [{ name: 'Boop', volume: 10, steps: [{ note: 5, duration: 10 }] }];

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
      one('battle'),
      one('heal'),
      one('damage')
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
    ],
    // A route contributes no opcode of its own -- liveCommands recurses into
    // its admitted legs INSTEAD OF yielding the wrapper (design-routes.md
    // §5.2), so the live/compiled sequences here are just move/turn/wait,
    // never 'route'. See the dedicated block below the loop for the same
    // scenario checked against an independently hand-written expected
    // sequence, not just against each other.
    'a route, flattened to its own legs with no opcode of its own': [
      {
        op: 'route',
        who: 'self',
        legs: [
          { op: 'move', dir: 'down', dist: 16 },
          { op: 'turn', dir: 'up' },
          { op: 'wait', frames: 10 }
        ]
      }
    ],
    'a live Play a sound effect command, then a switched-off one': [
      one('sfx', { sfx: 0 }),
      one('sfx', { sfx: 0, off: true })
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

  // A route holding an unadmitted leg -- a live, not-yet-normalized shape
  // only reachable by constructing it directly here, never through the
  // editor or normalizeProject -- checked against a THIRD, independently
  // hand-written expected sequence (never derived by calling routeLegs or
  // any other shared code), not just compiledCompiled === liveCompiled
  // against each other. A shared-but-wrong routeLegs implementation (an
  // accidentally widened ROUTE_LEG_OPS admitting 'say', say) would make
  // both compiledSequence's real-byte decode and liveSequence's schema walk
  // agree on the same wrong answer -- this is what catches that a
  // self-consistent-but-wrong pair cannot.
  const routeWithIllegalLeg = [
    {
      op: 'route',
      who: 'self',
      legs: [
        { op: 'move', dir: 'down', dist: 8 },
        one('say'), // unadmitted -- must be silently dropped by both sides
        { op: 'turn', dir: 'left' },
        { op: 'wait', frames: 5 },
        one('sfx', { sfx: 0 }) // unadmitted, per design-sfx.md §3.8/§7 (finding 9): an sfx
                                // command sitting in a raw route leg must never make
                                // SFX_ENABLED disagree with the compiled byte stream
      ]
    }
  ];
  const routeCompiled = compiledSequence(routeWithIllegalLeg);
  const routeLive = liveSequence(routeWithIllegalLeg);
  const independentlyExpected = ['move', 'turn', 'wait'];
  assert.deepEqual(routeCompiled, independentlyExpected, 'the compiler must silently drop the unadmitted leg');
  assert.deepEqual(routeLive, independentlyExpected, 'liveCommands must silently drop the unadmitted leg too');

  // The direct SFX_ENABLED-level proof design-sfx.md §7 test 16 asks for: an sfx command
  // sitting only in an illegal route leg must never turn projectUsesSfx on, since the
  // compiled stream (routeCompiled above) never contains it either.
  const illegalLegProject = createProject('Quest', 'action');
  illegalLegProject.maps[0].screens[0].entities = [
    { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: routeWithIllegalLeg }] } } }
  ];
  assert.equal(
    projectUsesSfx(illegalLegProject),
    false,
    'an sfx command reachable only through an illegal route leg must not enable SFX_ENABLED'
  );
});

// EVENT_COMMANDS' own OP_END..OP_SFX values, hand-copied from
// engine/constants.asm the same way this file's own PLAYER_X/GAME_STATE-
// style tests already hardcode engine RAM addresses elsewhere -- "a test
// that reads the file it is checking proves nothing."
const ENGINE_OPCODES = {
  end: 0x00,
  say: 0x01,
  give: 0x02,
  take: 0x03,
  setSwitch: 0x04,
  clearSwitch: 0x05,
  warp: 0x06,
  join: 0x07,
  setVar: 0x08,
  addVar: 0x09,
  subVar: 0x0a,
  branch: 0x0b,
  choice: 0x0c,
  call: 0x0d,
  music: 0x0e,
  battle: 0x0f,
  heal: 0x10,
  damage: 0x11,
  save: 0x12,
  move: 0x13,
  turn: 0x14,
  wait: 0x15,
  shake: 0x16,
  visible: 0x17,
  fade: 0x18,
  flash: 0x19,
  sting: 0x1a,
  sfx: 0x1b
};

test('EVENT_COMMANDS: every real-opcode entry keeps its engine constant value; the virtual tail is contiguous and last', () => {
  // The rule design-routes.md §3.0 states as a standing invariant, made
  // mechanically checkable rather than merely asserted in prose: a
  // contiguous OP_*-backed real prefix, in engine/constants.asm order,
  // starting at index 0, followed by a contiguous `virtual: true` tail
  // (currently just `route`). A future engine-backed command must be
  // inserted immediately before the virtual tail, never after any virtual
  // entry; a future virtual command must be appended after it.
  for (const [id, expected] of Object.entries(ENGINE_OPCODES)) {
    assert.equal(
      opIndex(id),
      expected,
      `${id} must compile to $${expected.toString(16).padStart(2, '0')}, matching engine/constants.asm's OP_${id.toUpperCase()}`
    );
  }

  const real = EVENT_COMMANDS.filter((entry) => !entry.virtual);
  const virtual = EVENT_COMMANDS.filter((entry) => entry.virtual);

  assert.equal(real.length, Object.keys(ENGINE_OPCODES).length, 'every real-opcode entry must be marked virtual:false (the default)');
  assert.deepEqual(
    real.map((entry) => entry.id),
    Object.keys(ENGINE_OPCODES),
    'real entries must stay contiguous from index 0, in engine/constants.asm order'
  );
  assert.deepEqual(
    EVENT_COMMANDS.map((entry) => entry.id).slice(0, real.length),
    real.map((entry) => entry.id),
    'the real prefix must occupy indices 0..real.length-1 exactly -- nothing virtual may sit among them'
  );
  assert.ok(
    virtual.every((entry, i) => EVENT_COMMANDS.indexOf(entry) === real.length + i),
    'virtual entries must form one contiguous tail immediately after the real entries, in array order'
  );
  // Today's one virtual entry, named directly so a silent second one (or a
  // renamed one) is caught rather than only a count.
  assert.deepEqual(virtual.map((entry) => entry.id), ['route']);
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
  draft.items.push({ id: 0, name: 'Room key', actorId: 0, metaspriteId: 0 });
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

test('items.json is always written, including when empty, so a missing file and an empty array stay distinguishable', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-itemsjson-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // Round 2, item 6: a project with no pickup actor migrates to `[]` either
  // way, so the assertions below could not tell "the discriminator branched
  // and produced an empty result" from "it always returns [] regardless of
  // whether items.json is even read." A pickup actor is what makes the two
  // paths actually diverge: present-and-empty must stay empty (no
  // re-synthesis), while absent must synthesize an item for it.
  const draft = createProject('Items discriminator');
  draft.sprites.actors.push({ name: 'Torch', behavior: 'pickup' });
  draft.items = []; // already migrated, deliberately holding none

  await saveProject(dir, draft);
  const itemsPath = path.join(dir, 'items.json');
  const onDisk = JSON.parse(await fs.readFile(itemsPath, 'utf8'));
  assert.deepEqual(onDisk, [], 'items.json exists and holds an empty array, not being skipped entirely');

  // With items.json present and empty, a pickup actor sitting right there
  // must NOT be re-synthesized into an item -- "already migrated" means no
  // synthesis, ever, even when synthesis would have found something to do.
  const stillEmpty = await loadProject(dir);
  assert.deepEqual(stillEmpty.items, [], 'an already-migrated project with no items stays empty, not re-derived from its pickup actor');

  // The discriminator itself: remove the file to simulate a project saved
  // before it existed, and confirm the load path actually branches on its
  // presence rather than always reading `[]` regardless -- with the file
  // gone, that same pickup actor must now be synthesized into an item.
  await fs.rm(itemsPath);
  const migrated = await loadProject(dir);
  assert.equal(migrated.items.length, 1, 'a missing items.json must trigger the migration, which finds the pickup actor');
  assert.equal(migrated.items[0].actorId, 0, 'the synthesized item backs the Torch actor');

  // And once items.json exists again (any save writes it), reopening the
  // project must not silently vanish a real item by re-deriving from actors.
  await saveProject(dir, migrated);
  assert.deepEqual(
    JSON.parse(await fs.readFile(itemsPath, 'utf8')),
    [{ id: 0, name: 'Torch', actorId: 0, metaspriteId: null, effect: { kind: 'none', amount: 0 } }],
    'a real item survives being written to items.json'
  );
  const reloaded = await loadProject(dir);
  assert.deepEqual(reloaded.items, migrated.items, 'and survives being read back, unchanged by a second load');
});
