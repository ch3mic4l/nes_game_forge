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
  commonEventId
} from '../../shared/project.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadProject, saveProject } from '../../main/project-io.js';
import { resolveMapper, rpgCapable } from '../../shared/cartridge.js';
import { flattenScreens } from '../../main/build/generate.js';
import { FONT_BASE } from '../../shared/font.js';
import { BLANK_TILE } from '../../shared/chr.js';

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

test('an invalid call reference normalizes to NO_COMMON_EVENT, never to 0', () => {
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
