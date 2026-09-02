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
  createTileset,
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
  renumberSpellDeletion,
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
  EVENT_COMMANDS,
  MOVE_TARGETS,
  MOVE_DIRECTIONS,
  VISIBLE_STATES,
  FADE_DIRECTIONS,
  liveCommonEvents,
  choiceLabel,
  // ROADMAP item 7 phase 1 (handoff-maporg/design-maporg.md) --------------
  remapScreenReferences,
  reorderMapsCore,
  // ROADMAP item 7 phase 2 -------------------------------------------------
  addMapCore,
  duplicateMapCore,
  // ROADMAP item 7 phase 3 -------------------------------------------------
  deleteMapCore,
  buildDeleteMapTranslate,
  buildResizeTranslate,
  buildPerMapTranslate,
  growOrShrinkMap,
  auditDroppedReferences,
  FALLBACK_SCREEN,
  // ROADMAP item 7 phase 4 -------------------------------------------------
  nameForNewMapFromSource,
  buildCloneTranslate,
  applyCloneTranslate,
  duplicateScreenViaGrowthCore,
  duplicateScreenIntoNewMapCore,
  // ROADMAP item 7 phase 5 -------------------------------------------------
  clampPasteOrigin,
  buildRegionClip,
  pasteRegionCore,
  pasteCapacityProblem
} from '../../shared/project.js';
import { resolveStartAt } from '../../shared/playscenario.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { resolveMapper, rpgCapable } from '../../shared/cartridge.js';
import { flattenScreens, resolveEntityByte, checkCapacity } from '../../main/build/generate.js';
import { compileText, opIndex, OP_JUMP, OP_STING, encodeString } from '../../main/build/textcompile.js';
import { createSong, songFrameLength, songByte, sfxByte, sfxFrameLength } from '../../shared/audio.js';
import { battleTables } from '../../main/build/battletables.js';
import { FONT_BASE } from '../../shared/font.js';
import { BLANK_TILE } from '../../shared/chr.js';
import { spawnSync } from 'node:child_process';
import NES from '../../renderer/emulator/core/nes.js';
import { saveIdentity } from '../../shared/save.js';
import { decodeCommand, decodeBody, decodeEvent } from '../lib/eventdecoder.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');

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
    // mpCost 0-255 (widened from the old 0-99 to match the engine's and the
    // editor field's real domain -- design §4.3) and a legacy flat `amount`,
    // which normalizeSpell's one-time migration turns into
    // amountMin === amountMax === <the same clamped ceiling>.
    spells: [{ name: 'Fire', mpCost: 500, kind: 'wat', element: 'fire', amount: 900 }],
    party: [
      { name: 'Hero', baseHp: 999 },
      { name: 'Mage', startsInParty: false, spells: [{ spellId: 0, level: 99 }, { spellId: 7, level: 2 }] }
    ]
  });
  assert.equal(project.spells[0].mpCost, 255);
  assert.equal(project.spells[0].kind, 'damage');
  assert.equal(project.spells[0].amountMin, 255, 'a legacy amount past the ceiling migrates in, clamped, to both ends');
  assert.equal(project.spells[0].amountMax, 255);
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

// --- renumberSpellDeletion (Magic Forge, phase 1) — the primitive only. The
// old Spells… modal these tests originally targeted is gone as of phase 3
// (renderer/forges/magic/magic.js); the Magic Forge's own delete handler is
// the primitive's real caller now, and that handler is renderer code
// (confirmModal, store, toast) a node:test process cannot drive — main/smoke.js
// is what exercises it for real. These tests call the export directly, the
// same way the item/actor siblings' tests do above.

test('deleting a spell renumbers a party member’s learned entries and a monster’s cast spell, without attaching a level to the wrong spell', () => {
  const project = createProject('Quest', 'rpg');
  // The brief's own reproduction: Fire/Ice/Bolt, a member who learned Ice at
  // level 3 and Bolt at level 5 (in that authoring order), and a monster that
  // casts Bolt. Deleting Fire (index 0, named by neither reference) must
  // renumber Ice -> 0 and Bolt -> 1 everywhere without disturbing which level
  // goes with which spell.
  project.spells = [createSpell(0, 'Fire'), createSpell(1, 'Ice'), createSpell(2, 'Bolt')];
  project.party = [
    { ...createPartyMember(0, 'Hero'), spells: [{ spellId: 1, level: 3 }, { spellId: 2, level: 5 }] }
  ];
  project.sprites.actors = [{ name: 'Slime', damage: 1, battle: { spellId: 2 } }];

  renumberSpellDeletion(project, 0); // delete "Fire"
  project.spells.splice(0, 1);
  project.spells.forEach((spell, id) => (spell.id = id));

  assert.deepEqual(project.spells.map((s) => s.name), ['Ice', 'Bolt'], 'the surviving catalog shifts down');

  const learned = project.party[0].spells;
  const learnedIce = learned.find((entry) => project.spells[entry.spellId]?.name === 'Ice');
  const learnedBolt = learned.find((entry) => project.spells[entry.spellId]?.name === 'Bolt');
  assert.ok(learnedIce, 'Hero should still know Ice, now at its shifted id');
  assert.equal(learnedIce.level, 3, 'Ice must keep the level it was authored at, not a level that used to belong to Bolt');
  assert.ok(learnedBolt, 'Hero should still know Bolt, now at its shifted id');
  assert.equal(learnedBolt.level, 5, 'Bolt must keep its own authored level too');

  assert.equal(project.sprites.actors[0].battle.spellId, 1, 'the monster’s cast spell (Bolt) shifts down to its new id, not dropped');

  // Wrong implementation this fixture exists to catch: the pre-fix Spells…
  // modal's Save handler, which filtered a member's learned entries down to
  // ids that still exist post-renumber *without shifting the survivors'
  // spellId values* -- so a surviving entry keeps pointing at its old,
  // now-reassigned id instead of following the spell it actually names.
  const wrongImplementation = (proj, index) => {
    const survivingIds = new Set(proj.spells.map((spell, id) => id).filter((id) => id !== index));
    for (const member of proj.party ?? []) {
      member.spells = (member.spells ?? []).filter((entry) => survivingIds.has(entry.spellId));
    }
  };
  const brokenProject = createProject('Quest', 'rpg');
  brokenProject.spells = [createSpell(0, 'Fire'), createSpell(1, 'Ice'), createSpell(2, 'Bolt')];
  brokenProject.party = [
    { ...createPartyMember(0, 'Hero'), spells: [{ spellId: 1, level: 3 }, { spellId: 2, level: 5 }] }
  ];
  wrongImplementation(brokenProject, 0);
  brokenProject.spells.splice(0, 1);
  brokenProject.spells.forEach((spell, id) => (spell.id = id));
  const brokenLearned = brokenProject.party[0].spells;
  const brokenLearnedBolt = brokenLearned.find((entry) => brokenProject.spells[entry.spellId]?.name === 'Bolt');
  assert.ok(
    !brokenLearnedBolt || brokenLearnedBolt.level !== 5,
    'sanity check: the wrong implementation must actually get this fixture wrong, or this test would not be distinguishing anything'
  );
});

test('a monster’s battle.spellId naming exactly the deleted spell becomes null', () => {
  const project = createProject('Quest', 'rpg');
  project.spells = [createSpell(0, 'Fire'), createSpell(1, 'Ice')];
  project.sprites.actors = [{ name: 'Slime', damage: 1, battle: { spellId: 0 } }];

  renumberSpellDeletion(project, 0); // delete "Fire", which the monster casts

  assert.equal(
    project.sprites.actors[0].battle.spellId,
    null,
    'a monster whose one spell was just deleted casts nothing, not spell 0 by accident'
  );

  // Wrong implementation this catches: shift-only logic with no exact-match
  // branch (`shift(id) => id > index ? id - 1 : id` applied unconditionally,
  // no `=== index` check at all) would leave 0 as 0 here, silently pointing
  // the monster at whatever now occupies id 0 instead of casting nothing.
});

test('a monster’s battle.spellId naming a spell above the deleted one is decremented, not left alone or zeroed', () => {
  const project = createProject('Quest', 'rpg');
  project.spells = [createSpell(0, 'Fire'), createSpell(1, 'Ice'), createSpell(2, 'Bolt')];
  project.sprites.actors = [{ name: 'Golem', damage: 1, battle: { spellId: 2 } }]; // casts "Bolt"

  renumberSpellDeletion(project, 0); // delete "Fire"

  assert.equal(
    project.sprites.actors[0].battle.spellId,
    1,
    'a monster casting a spell above the deleted one should shift down to the spell’s new id'
  );

  // Wrong implementation this catches: treating every non-null spellId as
  // untouchable except an exact match (i.e. only handling the sentinel case
  // from the previous test, with no `shift()` for ids above the deletion)
  // would leave this at 2, which after the catalog shrinks to 2 entries names
  // nothing at all.
});

test('a party member’s learned entry naming the deleted spell is removed entirely, not clamped to a sentinel', () => {
  const project = createProject('Quest', 'rpg');
  project.spells = [createSpell(0, 'Fire'), createSpell(1, 'Ice')];
  project.party = [{ ...createPartyMember(0, 'Hero'), spells: [{ spellId: 0, level: 4 }, { spellId: 1, level: 2 }] }];

  renumberSpellDeletion(project, 0); // delete "Fire", which Hero had learned at level 4

  const learned = project.party[0].spells;
  assert.equal(learned.length, 1, 'the entry naming the deleted spell is dropped, not kept with a null spellId');
  assert.equal(learned[0].spellId, 0, 'the surviving entry (was Ice, id 1) shifts down to id 0');
  assert.equal(learned[0].level, 2, 'the surviving entry keeps its own authored level');

  // Wrong implementation this catches: reusing the actor sentinel discipline
  // for member.spells too (setting spellId to null instead of filtering the
  // entry out) -- there is no "learned nothing" entry sitting in the array
  // for null to mean, so a null-spellId entry here is stale data, not a
  // faithful "forgot this spell" representation.
});

test('battle.spellId === null before deletion stays null after — the fixed point is not disturbed', () => {
  const project = createProject('Quest', 'rpg');
  project.spells = [createSpell(0, 'Fire'), createSpell(1, 'Ice')];
  project.sprites.actors = [{ name: 'Rat', damage: 1, battle: { spellId: null } }];

  // Deleting index 1, not 0: a mutation that coerces a missing spellId to a
  // live numeric sentinel before the shift (see below) only produces a
  // *different* number than the deleted index when the two are not equal --
  // deleting index 0 would let the coerced value collide with the
  // exact-match branch and mask the defect by coincidence.
  renumberSpellDeletion(project, 1);

  assert.equal(project.sprites.actors[0].battle.spellId, null, 'a monster that already cast nothing should still cast nothing');

  // Wrong implementation this catches, run and confirmed to fail: treating a
  // missing spellId as the numeric sentinel 0 before shifting --
  // `const spellId = actor.battle?.spellId ?? 0;` in place of the real
  // `typeof spellId !== 'number'` guard, so `null` becomes `shift(0)` = `0`
  // (0 is not > 1) instead of staying `null`. Run against this exact
  // fixture: `actor.battle.spellId` came back `0`, not `null` -- a live,
  // wrong spell id where the monster should still be casting nothing.
});

test('deleting the last of a 32-entry catalog shifts nothing anywhere, and the primitive still does not touch project.spells itself', () => {
  const project = createProject('Quest', 'rpg');
  project.spells = Array.from({ length: 32 }, (_, id) => createSpell(id));
  project.sprites.actors = [{ name: 'Boss', damage: 1, battle: { spellId: 30 } }];
  project.party = [{ ...createPartyMember(0, 'Hero'), spells: [{ spellId: 30, level: 10 }] }];
  const spellsBefore = project.spells.slice(); // same array entries, captured before the call

  renumberSpellDeletion(project, 31); // delete the last entry, id 31, named by nothing

  assert.equal(project.sprites.actors[0].battle.spellId, 30, 'a reference below the deleted last entry must not move');
  assert.equal(project.party[0].spells.length, 1, 'a learned entry below the deleted last entry must survive');
  assert.equal(project.party[0].spells[0].spellId, 30, 'and must not shift, since nothing above it was deleted');
  assert.equal(project.party[0].spells[0].level, 10, 'and keeps its authored level');

  // The primitive's own documented contract: it never splices
  // project.spells[index] or restamps ids -- the caller does that. Asserted
  // directly, not just implied by the reference-shift asserts above: all 32
  // entries survive, in place, by identity.
  assert.equal(project.spells.length, 32, 'renumberSpellDeletion must not have spliced project.spells itself');
  for (let id = 0; id < 32; id++) {
    assert.equal(project.spells[id], spellsBefore[id], `spell ${id} must be the same object at the same index, untouched`);
    assert.equal(project.spells[id].id, id, `spell ${id} must keep its own id`);
  }

  // Wrong implementation this catches, run and confirmed to fail: a
  // renumberSpellDeletion that also splices project.spells[index] and
  // restamps every survivor's id by position -- violating its own documented
  // "the caller removes project.spells[index] itself" contract. Run against
  // this exact fixture: project.spells.length came back 31, not 32, tripping
  // the length assertion immediately (the per-id identity/id loop after it
  // never got the chance to also catch the restamp). The id>=index-vs->
  // off-by-one this test used to also claim is dropped: neither `id >= index`
  // nor `id > index` disturbs id 30 here (30 is below index 31 either way),
  // so no shift-arithmetic slip this fixture's own numbers can express is
  // exposed by it -- the splice/restamp mutation above is what this fixture
  // actually catches.
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

// ---------------------------------------------------------------------------
// ROADMAP item 7 -- map organization and reuse, phase 1
// (handoff-maporg/design-maporg.md, handoff-maporg/maporg-phase-plan.md)
//
// The shared mechanism (remapScreenReferences, canonicalizeFlat,
// buildReorderTranslate, reorderMapsCore, the save-compatibility token), the
// test-only wire decoder (test/lib/eventdecoder.js), and Reorder Maps -- the
// simplest complete operation the mechanism supports, called through the
// SAME commit-free core (reorderMapsCore) the real Map Forge handler wraps
// in its own store.commit, not a second copy of its body. Delete/Resize/
// Duplicate/paste/folders are later phases and are not tested here.
// ---------------------------------------------------------------------------

// Fix round 1, finding 2: no test-local reorder body here any more.
// reorderMapsCore (shared/project.js) is the one commit-free core both
// renderer/forges/map/map.js's reorderMaps (wrapped in its own single
// store.commit) and every test below call directly -- sabotaging it is
// sabotaging the exact function production runs, not an independent copy
// of its body.

// §11 test 1 (Fix round 1, finding 5: widened with a Branch `else` Warp and
// a common-event Warp, nested inside a branch there too -- the reviewer's
// own point that production reaches both `else` and `project.commonEvents`
// via `projectEvents`/`allCommands`, but the fixture advertised as walking
// "every reference kind from the inventory" never actually authored either,
// so a walker that silently dropped one would still have passed.)
test('remapScreenReferences walks every reference kind from the inventory, isolated', () => {
  const project = createProject('Remap inventory');
  const mapA = createMap(0, 'A');
  mapA.gridW = 2;
  mapA.gridH = 1;
  const a0 = createScreen();
  const a1 = createScreen();
  mapA.screens = [a0, a1]; // flat 0, 1
  const mapB = createMap(1, 'B');
  const b0 = createScreen();
  mapB.screens = [b0]; // flat 2
  const mapC = createMap(2, 'C');
  const c0 = createScreen();
  mapC.screens = [c0]; // flat 3
  project.maps = [mapA, mapB, mapC];

  const doorSelf = { actorId: 0, x: 0, y: 0, props: { toScreen: 1, event: null } }; // same map (A -> A)
  const doorExternal = { actorId: 0, x: 0, y: 0, props: { toScreen: 2, event: null } }; // different map (A -> B)
  a0.entities = [doorSelf, doorExternal];

  const topWarpEntity = {
    actorId: 0, x: 0, y: 0,
    props: {
      toScreen: 0,
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: 0, x: 0, y: 0 }] }] }
    }
  };
  b0.entities = [topWarpEntity];

  const branchWarpEntity = {
    actorId: 0, x: 0, y: 0,
    props: {
      toScreen: 0,
      event: {
        pages: [{
          cond: { type: 'none', arg: 0 },
          commands: [
            {
              op: 'branch',
              cond: { type: 'none', arg: 0 },
              then: [{ op: 'warp', screen: 3, x: 0, y: 0 }],
              // A second warp, in the branch's OTHER side, with its own
              // target distinguishable from the `then` warp's (2, not 3) --
              // production reaches this only because remapScreenReferences
              // walks allCommands rather than just a page's then-side.
              else: [{ op: 'warp', screen: 2, x: 0, y: 0 }]
            }
          ]
        }]
      }
    }
  };
  const choiceWarpEntity = {
    actorId: 0, x: 0, y: 0,
    props: {
      toScreen: 0,
      event: {
        pages: [{
          cond: { type: 'none', arg: 0 },
          commands: [
            { op: 'choice', options: [{ text: 'Go', commands: [{ op: 'warp', screen: 1, x: 0, y: 0 }] }] }
          ]
        }]
      }
    }
  };
  c0.entities = [branchWarpEntity, choiceWarpEntity];

  // A common event -- reached only by walking project.commonEvents
  // (projectEvents), not any placement's own entities -- holding a Warp
  // nested inside a branch, own target (0) distinguishable from every
  // other warp above.
  project.commonEvents = [
    {
      id: 0,
      name: 'Nested Warp Event',
      event: {
        pages: [{
          cond: { type: 'none', arg: 0 },
          commands: [
            { op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'warp', screen: 0, x: 0, y: 0 }], else: [] }
          ]
        }]
      }
    }
  ];

  const translate = (i) => 3 - i; // a known rule: reverse the whole flat order
  remapScreenReferences(project, translate);

  assert.equal(doorSelf.props.toScreen, 2, 'self-referential door remaps by the given translate');
  assert.equal(doorExternal.props.toScreen, 1, 'cross-map door remaps by the given translate');
  assert.equal(topWarpEntity.props.event.pages[0].commands[0].screen, 3, 'a top-level warp remaps');
  assert.equal(
    branchWarpEntity.props.event.pages[0].commands[0].then[0].screen,
    0,
    "a warp nested inside a branch's then side remaps"
  );
  assert.equal(
    branchWarpEntity.props.event.pages[0].commands[0].else[0].screen,
    1,
    "a warp nested inside a branch's else side remaps"
  );
  assert.equal(
    choiceWarpEntity.props.event.pages[0].commands[0].options[0].commands[0].screen,
    2,
    'a warp nested inside a choice option remaps'
  );
  assert.equal(
    project.commonEvents[0].event.pages[0].commands[0].then[0].screen,
    3,
    'a warp nested inside a common event (itself nested in a branch) remaps'
  );
});

// §11 test 2
test('a door\'s props.toScreen is remapped even when its actor is not currently door-behaved', () => {
  const project = createProject('Pickup byte');
  project.sprites.actors = [{ name: 'Chest', behavior: 'pickup' }];
  project.maps = [createMap(0, 'A'), createMap(1, 'B')];
  const entity = { actorId: 0, x: 0, y: 0, props: { toScreen: 0, event: null } };
  project.maps[0].screens[0].entities = [entity];

  const translate = (i) => (i === 0 ? 1 : 0);
  remapScreenReferences(project, translate);

  assert.equal(entity.props.toScreen, 1, "a pickup-behaved entity's toScreen is still rewritten, not skipped");
});

// §11 test 3
test(
  'canonicalizeFlat resolves a pre-edit out-of-range value to its already-effective target, not to the fallback',
  () => {
    const project = createProject('Canonicalize');
    project.maps = [0, 1, 2, 3].map((i) => createMap(i, `M${i}`)); // 4 maps, 1 screen each -> flat 0..3
    const door = { actorId: 0, x: 0, y: 0, props: { toScreen: 255, event: null } }; // effective target: screen 3
    const warpEntity = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'choice', options: [{ text: 'Go', commands: [{ op: 'warp', screen: 255, x: 0, y: 0 }] }] }
            ]
          }]
        }
      }
    };
    project.maps[0].screens[0].entities = [door, warpEntity];

    // Move map 3's content to new flat position 2 -- nonzero, deliberately
    // distinct from FALLBACK_SCREEN's own value of 0.
    const result = reorderMapsCore(project, [0, 1, 3, 2]);

    assert.equal(door.props.toScreen, 2, "a pre-edit out-of-range door byte follows its already-effective target");
    assert.equal(
      warpEntity.props.event.pages[0].commands[0].options[0].commands[0].screen,
      2,
      'the identical resolution applies to a nested warp'
    );
    assert.equal(
      result.droppedTargets.length,
      0,
      'a value already resolved to a real, surviving screen must never be reported as dropped'
    );
  }
);

// §11 test 5
test(
  "a maps-only reorder leaves titleScreen/startScreen untouched -- only titleMap/startMap move, and droppedTargets is always empty",
  () => {
    const project = createProject('Title reorder');
    const mapA = createMap(0, 'A');
    const mapB = createMap(1, 'B');
    mapB.gridW = 1;
    mapB.gridH = 3;
    mapB.screens = [createScreen(), createScreen(), createScreen()];
    project.maps = [mapA, mapB];
    project.project.titleMap = 1;
    project.project.titleScreen = 2;
    project.project.startMap = 1;
    project.project.startScreen = 2;

    const result = reorderMapsCore(project, [1, 0]); // swap map order

    assert.equal(project.project.titleMap, 0, 'titleMap follows the map it named to its new position');
    assert.equal(project.project.titleScreen, 2, 'titleScreen is untouched -- the map itself did not change');
    assert.equal(project.project.startMap, 0, 'startMap follows the map it named to its new position');
    assert.equal(project.project.startScreen, 2, 'startScreen is untouched -- the map itself did not change');
    assert.equal(result.droppedTargets.length, 0, 'a reorder is a total bijection -- nothing is ever dropped');
  }
);

// §11 test 6
test(
  'reorder preserves the content every stored reference points at -- self and cross-map doors, warps nested in a ' +
    'branch and a choice, title and start',
  () => {
    const project = createProject('Content preservation', 'action');
    const alpha = createMap(0, 'Alpha');
    alpha.gridW = 1;
    alpha.gridH = 2;
    const a0 = createScreen();
    a0.name = 'A0';
    const a1 = createScreen();
    a1.name = 'A1';
    alpha.screens = [a0, a1];

    const beta = createMap(1, 'Beta');
    const b0 = createScreen();
    b0.name = 'B0';
    beta.screens = [b0];

    const gamma = createMap(2, 'Gamma');
    const g0 = createScreen();
    g0.name = 'G0';
    gamma.screens = [g0];

    project.maps = [alpha, beta, gamma]; // flat: A0=0, A1=1, B0=2, G0=3

    const doorSelf = { actorId: 0, x: 0, y: 0, props: { toScreen: 1, event: null } }; // -> A1
    const doorExternal = { actorId: 0, x: 0, y: 0, props: { toScreen: 3, event: null } }; // -> G0
    a0.entities = [doorSelf, doorExternal];

    const branchWarpEntity = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'warp', screen: 1, x: 0, y: 0 }], else: [] } // -> A1
            ]
          }]
        }
      }
    };
    b0.entities = [branchWarpEntity];

    const choiceWarpEntity = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'choice', options: [{ text: 'Go', commands: [{ op: 'warp', screen: 2, x: 0, y: 0 }] }] } // -> B0
            ]
          }]
        }
      }
    };
    g0.entities = [choiceWarpEntity];

    project.project.titleMap = 1; // Beta
    project.project.titleScreen = 0; // B0
    project.project.startMap = 2; // Gamma
    project.project.startScreen = 0; // G0

    reorderMapsCore(project, [2, 0, 1]); // new order: Gamma, Alpha, Beta

    const flatNow = flatScreens(project);
    const flatIndexOf = (screen) => flatNow.findIndex((entry) => entry.screen === screen);
    const mapIndexOf = (screen) => flatNow.find((entry) => entry.screen === screen).mapIndex;

    assert.equal(doorSelf.props.toScreen, flatIndexOf(a1), "the self-referential door still names A1's content");
    assert.equal(doorExternal.props.toScreen, flatIndexOf(g0), "the cross-map door still names Gamma's content");
    assert.equal(
      branchWarpEntity.props.event.pages[0].commands[0].then[0].screen,
      flatIndexOf(a1),
      "the branch-nested warp still names A1's content"
    );
    assert.equal(
      choiceWarpEntity.props.event.pages[0].commands[0].options[0].commands[0].screen,
      flatIndexOf(b0),
      "the choice-nested warp still names B0's content"
    );
    assert.equal(project.project.titleMap, mapIndexOf(b0), 'titleMap still names Beta');
    assert.equal(project.project.titleScreen, 0, 'titleScreen -- per-map -- is unaffected by a maps-only reorder');
    assert.equal(project.project.startMap, mapIndexOf(g0), 'startMap still names Gamma');
    assert.equal(project.project.startScreen, 0);
  }
);

// §11 test 24
test(
  'decoder corpus round-trip: every real opcode, encoded then decoded, on a pinned valid MMC1/RPG project',
  () => {
    const project = createProject('Corpus', 'rpg');
    project.cartridge.mapper = 1; // MMC1: RPG-capable and save-capable in one choice
    project.project.titleMap = 0;
    project.project.titleScreen = 0;

    project.sprites.actors = [
      { name: 'Player', behavior: 'player' },
      { name: 'NPC', behavior: 'npc' },
      { name: 'Monster', behavior: 'npc', damage: 1, battle: { atk: 4, def: 2 } }
    ];
    project.items = [{ id: 0, name: 'Potion', actorId: null, metaspriteId: null, effect: { kind: 'none', amount: 0 } }];
    project.songs = [createSong('Song A'), createSong('Song B')];
    project.sfx = [
      { name: 'Effect A', volume: 15, steps: [{ note: 5, duration: 10 }] },
      { name: 'Effect B', volume: 15, steps: [{ note: 7, duration: 12 }] }
    ];
    project.commonEvents = [
      { id: 0, name: 'First', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 5 }] }] } },
      { id: 1, name: 'Second', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 6 }] }] } }
    ];
    project.commonEventSeq = 2;

    project.maps[0].name = 'Home';
    project.maps[0].gridW = 1;
    project.maps[0].gridH = 2;
    const home0 = createScreen();
    const home1 = createScreen();
    project.maps[0].screens = [home0, home1]; // flat 0, 1 -- warp targets flat 1

    const commands = [
      { op: 'say', text: 'Corpus dialogue line one.' },
      { op: 'give', item: 0 },
      { op: 'take', item: 0 },
      { op: 'setSwitch', switch: 3 },
      { op: 'clearSwitch', switch: 4 },
      { op: 'setVar', variable: 1, value: 5 },
      { op: 'addVar', variable: 2, value: 6 },
      { op: 'subVar', variable: 3, value: 7 },
      { op: 'heal', value: 10 },
      { op: 'damage', value: 20 },
      { op: 'save' },
      { op: 'move', who: 'self', dir: 'up', dist: 40 },
      { op: 'turn', who: 'player', dir: 'left' },
      { op: 'wait', frames: 30 },
      { op: 'shake', frames: 15 },
      { op: 'visible', state: 'hidden' },
      { op: 'fade', dir: 'out' },
      { op: 'flash' },
      { op: 'join', member: 0 },
      { op: 'call', event: 1 }, // the SECOND live common event
      { op: 'music', song: 0 },
      {
        op: 'route',
        who: 'player',
        legs: [
          { op: 'move', dir: 'right', dist: 99 }, // distinct from the standalone move above
          { op: 'turn', dir: 'down' } // distinct from the standalone turn above
        ]
      },
      { op: 'sting', song: 1 }, // the SECOND song
      { op: 'sfx', sfx: 1 }, // the SECOND effect
      { op: 'battle', monsters: [2] }, // fewer than RPG_LIMITS.monstersPerBattle
      {
        op: 'branch',
        cond: { type: 'none', arg: 0 },
        then: [{ op: 'warp', screen: 1, x: 50, y: 60 }],
        else: [{
          op: 'choice',
          options: [
            { text: 'Empty', commands: [] },
            {
              text: 'Nested',
              commands: [{
                op: 'choice',
                options: [
                  { text: 'Inner A', commands: [{ op: 'setSwitch', switch: 10 }] },
                  { text: 'Inner B', commands: [] }
                ]
              }]
            }
          ]
        }]
      }
    ];

    project.maps[0].screens[0].entities = [
      { actorId: 1, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];

    const built = normalizeProject(project);
    // normalizeProject rebuilds every screen object fresh -- home1 above is
    // the pre-normalize object; the warp's decoded target is compared
    // against the live one this test actually compiles against.
    const home1Ref = built.maps[0].screens[1];
    const errors = validateProject(built).filter((p) => p.severity === 'error');
    assert.deepEqual(
      errors,
      [],
      'the corpus fixture must be legal on its own terms, not merely large enough to host every opcode'
    );

    const compiled = compileText(built);
    const flat = flattenScreens(built).flat;
    const entity = built.maps[0].screens[0].entities[0];
    const bytes = compiled.events[compiled.eventFor.get(entity)];

    const decoded = decodeEvent(bytes, { strings: compiled.strings, flat });
    const body = decoded[0].body;
    let i = 0;
    const next = () => body[i++];
    const labelBytes = (text) => encodeString(choiceLabel(text)).bytes;

    assert.deepEqual(next().text, encodeString('Corpus dialogue line one.').bytes, 'say');
    assert.deepEqual(next().raw, [0], 'give item 0');
    assert.deepEqual(next().raw, [0], 'take item 0');
    assert.deepEqual(next().raw, [3], 'setSwitch');
    assert.deepEqual(next().raw, [4], 'clearSwitch');
    assert.deepEqual(next().raw, [1, 5], 'setVar');
    assert.deepEqual(next().raw, [2, 6], 'addVar');
    assert.deepEqual(next().raw, [3, 7], 'subVar');
    assert.deepEqual(next().raw, [10], 'heal');
    assert.deepEqual(next().raw, [20], 'damage');
    assert.deepEqual(next().raw, [], 'save');
    assert.deepEqual(
      next().raw,
      [MOVE_TARGETS.findIndex((e) => e.id === 'self'), MOVE_DIRECTIONS.findIndex((e) => e.id === 'up'), 40],
      'move'
    );
    assert.deepEqual(
      next().raw,
      [MOVE_TARGETS.findIndex((e) => e.id === 'player'), MOVE_DIRECTIONS.findIndex((e) => e.id === 'left')],
      'turn'
    );
    assert.deepEqual(next().raw, [30], 'wait');
    assert.deepEqual(next().raw, [15], 'shake');
    assert.deepEqual(next().raw, [VISIBLE_STATES.findIndex((e) => e.id === 'hidden')], 'visible');
    assert.deepEqual(next().raw, [FADE_DIRECTIONS.findIndex((e) => e.id === 'out')], 'fade');
    assert.deepEqual(next().raw, [], 'flash');
    assert.deepEqual(next().raw, [0], 'join');

    const callSlot = liveCommonEvents(built).findIndex((entry) => entry.id === built.commonEvents[1].id);
    assert.notEqual(callSlot, 0, "a hardcoded-to-slot-0 decoder must not coincidentally pass");
    assert.deepEqual(next().raw, [callSlot], 'call');

    assert.deepEqual(next().raw, [0], 'music, song 0');

    // route: zero framing -- its two legs decode as ordinary move/turn entries.
    assert.deepEqual(
      next().raw,
      [MOVE_TARGETS.findIndex((e) => e.id === 'player'), MOVE_DIRECTIONS.findIndex((e) => e.id === 'right'), 99],
      "the route's first leg"
    );
    assert.deepEqual(
      next().raw,
      [MOVE_TARGETS.findIndex((e) => e.id === 'player'), MOVE_DIRECTIONS.findIndex((e) => e.id === 'down')],
      "the route's second leg"
    );

    const stingIndex = songByte(built.songs, 1);
    assert.notEqual(stingIndex, 0, "a hardcoded-to-index-0 decoder must not coincidentally pass");
    const sting = next();
    assert.equal(sting.raw[0], stingIndex, 'sting index');
    assert.equal(
      sting.raw[1],
      Math.min(songFrameLength(built.songs[stingIndex]), 255),
      "sting duration, re-derived from the AUTHORED target"
    );

    const sfxIndex = sfxByte(built.sfx, 1);
    assert.notEqual(sfxIndex, 0, "a hardcoded-to-index-0 decoder must not coincidentally pass");
    const sfx = next();
    assert.equal(sfx.raw[0], sfxIndex, 'sfx index');
    assert.equal(
      sfx.raw[1],
      Math.min(sfxFrameLength(built.sfx[sfxIndex]), 255),
      "sfx duration, re-derived from the AUTHORED target"
    );

    const battle = next();
    assert.equal(battle.raw.length, RPG_LIMITS.monstersPerBattle, 'battle is fixed-width');
    assert.equal(battle.raw[0], 2, "battle's one authored, real monster id");
    for (let k = 1; k < RPG_LIMITS.monstersPerBattle; k++) {
      assert.equal(battle.raw[k], NO_ACTOR, 'every unauthored battle slot is NO_ACTOR-padded');
    }

    const branchIndex = i; // captured BEFORE next() advances -- branch's own position in `body`
    const branch = next();
    assert.equal(branch.form, 'branch');
    assert.equal(branch.then.length, 1);
    assert.equal(branch.then[0].form, 'warp');
    assert.equal(branch.then[0].target, home1Ref, "the branch's warp resolves to the real, known target screen");
    assert.equal(branch.then[0].x, 50);
    assert.equal(branch.then[0].y, 60);

    assert.equal(branch.else.length, 1);
    const choice = branch.else[0];
    assert.equal(choice.form, 'choice');
    assert.deepEqual(choice.labels, [labelBytes('Empty'), labelBytes('Nested')]);
    assert.deepEqual(choice.options[0], [], 'a legal, zero-length option body');
    assert.equal(choice.options[1].length, 1);
    const nestedChoice = choice.options[1][0];
    assert.equal(nestedChoice.form, 'choice', 'recursion, two levels deep');
    assert.deepEqual(nestedChoice.labels, [labelBytes('Inner A'), labelBytes('Inner B')]);
    assert.equal(nestedChoice.options[0].length, 1);
    assert.deepEqual(nestedChoice.options[0][0].raw, [10]);
    assert.deepEqual(nestedChoice.options[1], []);
    // past: each option's own value is the total size of every record after
    // it -- the last option's is always 0, provably, not merely consumed.
    assert.equal(choice.past[choice.past.length - 1], 0, "the last option's own past is always 0");
    assert.ok(choice.past[0] > 0, "a non-last option's own past is provably nonzero");
    assert.equal(nestedChoice.past[nestedChoice.past.length - 1], 0);
    assert.ok(nestedChoice.past[0] > 0);

    assert.equal(i, body.length, 'every real opcode in the corpus was decoded -- decodeEvent returned with no error');

    // Fix round 1, finding 4 (strengthened, Fix round 2, finding 2): the
    // negative control -- prove decodeEvent actually VALIDATES past, not
    // merely consumes it. Round 1's own locator scanned for the first
    // [recordLength=2, OP_JUMP, past] byte pattern anywhere in the event and
    // never established it was unique or that it belonged to THIS Choice's
    // option 0 -- the review is right that another empty, non-final option
    // with the identical trailing size (or a later corpus addition placing
    // one earlier) would satisfy the same scan, silently changing which
    // decoder path this control actually proves.
    //
    // Derived instead, DIRECTLY from the decoded structure this test already
    // has in hand -- no byte-pattern search, so no coincidental match is
    // possible: option 0's own `past` byte's absolute offset in `bytes` is
    // exactly the page header (4) + the size of every top-level command
    // decoded before `branch` + the branch's own header (5: op/cond/arg/
    // value/thenLen) + `then`'s own bytes + the OP_JUMP/elseLen pair (2) +
    // the choice's own header (2: op/count, plus one string id per option)
    // + option 0's own [recordLength, ...body, OP_JUMP] prefix. Every term
    // is read off the decoded tree's own `.size`/`.labels`/`.options`
    // fields, not assumed.
    const precedingBytes = body.slice(0, branchIndex).reduce((sum, command) => sum + command.size, 0);
    const branchByteOffset = 4 + precedingBytes;
    const thenBytes = branch.then.reduce((sum, command) => sum + command.size, 0);
    const elseByteOffset = branchByteOffset + 5 + thenBytes + 2;
    const choiceHeaderBytes = 2 + choice.labels.length; // op, count, one string id per option
    const option0BodyBytes = choice.options[0].reduce((sum, command) => sum + command.size, 0);
    const pastByteIndex = elseByteOffset + choiceHeaderBytes + 1 + option0BodyBytes + 1; // recordLength, body, OP_JUMP, [past]

    const expectedPast0 = choice.past[0];
    assert.equal(
      bytes[pastByteIndex],
      expectedPast0,
      "the derived offset must land on option 0's own past byte, confirmed against its already-decoded value " +
        '-- proof the offset is structurally correct, not merely plausible'
    );

    const corrupted = bytes.slice();
    const corruptedPast0 = expectedPast0 === 1 ? 2 : 1; // a different, still-nonzero value
    corrupted[pastByteIndex] = corruptedPast0;
    assert.throws(
      () => decodeEvent(corrupted, { strings: compiled.strings, flat }),
      new RegExp(`past=${corruptedPast0}, expected ${expectedPast0}\\b`),
      'a Choice option whose past byte is wrong but nonzero must be rejected, not silently treated as merely consumed'
    );
  }
);

// §11 test 7 (also exercises §7 item 2's decoder and its resolveEntityByte helper)
test(
  "the decoder proves reorder preserves compiled semantics -- a warp's target across maps, a Say and a Choice " +
    "label whose raw compiled ids are provably forced to shift, and a pickup entity's item byte, untouched",
  () => {
    const project = createProject('Semantic reorder', 'action');
    project.sprites.actors = [
      { name: 'NPC', behavior: 'npc' },
      { name: 'Chest', behavior: 'pickup' }
    ];
    project.items = [{ id: 0, name: 'Key', actorId: 1, metaspriteId: null, effect: { kind: 'none', amount: 0 } }];

    const mapA = createMap(0, 'MapA');
    const a0 = createScreen();
    mapA.screens = [a0];
    const mapB = createMap(1, 'MapB');
    const b0 = createScreen();
    mapB.screens = [b0];
    project.maps = [mapA, mapB]; // flat: A0=0, B0=1

    // (b)/(c): map A authors a unique string before the shared one; map B
    // authors only the shared one -- internString's own dedup-by-content
    // order (not which placement authors it) is what forces the shared
    // string's raw id to differ once the reorder changes which map compiles
    // first. The identical construction is applied to a Choice label,
    // nested inside a branch's then, per Fix round 3 finding 3.
    const entityA = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'say', text: 'Only in A' },
              { op: 'say', text: 'Hello' },
              { op: 'warp', screen: 1, x: 10, y: 20 }, // (a) cross-map: A -> B
              { op: 'say', text: 'Unique before choice' },
              {
                op: 'branch',
                cond: { type: 'none', arg: 0 },
                then: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }] }],
                else: []
              }
            ]
          }]
        }
      }
    };
    const entityB = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'say', text: 'Hello' },
              {
                op: 'branch',
                cond: { type: 'none', arg: 0 },
                then: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }] }],
                else: []
              }
            ]
          }]
        }
      }
    };
    const pickupEntity = { actorId: 1, x: 0, y: 0, props: { toScreen: 5, event: null } };
    a0.entities = [entityA, pickupEntity];
    b0.entities = [entityB];

    const built = normalizeProject(project);
    const entityARef = built.maps[0].screens[0].entities[0];
    const pickupRef = built.maps[0].screens[0].entities[1];
    // normalizeProject rebuilds every screen object fresh -- b0 above is
    // the pre-normalize object; track the live one this test actually
    // reorders and decodes against.
    const b0Ref = built.maps[1].screens[0];

    const idOf = (strings, text) => {
      const bytes = encodeString(text).bytes;
      return strings.findIndex((entry) => entry.length === bytes.length && entry.every((v, i) => v === bytes[i]));
    };

    const before = compileText(built);
    const flatBefore = flattenScreens(built).flat;
    const helloBefore = idOf(before.strings, 'Hello');
    const yesBefore = idOf(before.strings, choiceLabel('Yes'));

    const itemIdForActorBefore = new Map(
      built.items.filter((item) => typeof item.actorId === 'number').map((item) => [item.actorId, item.id])
    );
    const pickupResultBefore = resolveEntityByte(
      pickupRef,
      built.sprites.actors[pickupRef.actorId],
      projectUsesItems(built),
      itemIdForActorBefore,
      flatBefore.length
    );

    reorderMapsCore(built, [1, 0]); // MapB, MapA -- B's own content now compiles first

    const after = compileText(built);
    const flatAfter = flattenScreens(built).flat;
    const helloAfter = idOf(after.strings, 'Hello');
    const yesAfter = idOf(after.strings, choiceLabel('Yes'));

    assert.notEqual(helloBefore, -1);
    assert.notEqual(helloAfter, -1);
    assert.notEqual(helloBefore, helloAfter, "the shared Say string's raw compiled id must genuinely shift");
    assert.notEqual(yesBefore, -1);
    assert.notEqual(yesAfter, -1);
    assert.notEqual(yesBefore, yesAfter, "the shared Choice label's raw compiled id must genuinely shift");

    const decodedBefore = decodeEvent(before.events[before.eventFor.get(entityARef)], {
      strings: before.strings,
      flat: flatBefore
    });
    const decodedAfter = decodeEvent(after.events[after.eventFor.get(entityARef)], {
      strings: after.strings,
      flat: flatAfter
    });
    assert.deepEqual(
      decodedBefore,
      decodedAfter,
      "entity A's decoded event is semantically identical before and after the reorder"
    );

    // The warp's own raw byte is required to change (B moved from flat 1 to
    // flat 0), but its decoded target is the SAME SCREEN OBJECT either way.
    const warpBefore = decodedBefore[0].body.find((c) => c.form === 'warp');
    const warpAfter = decodedAfter[0].body.find((c) => c.form === 'warp');
    assert.equal(warpBefore.target, b0Ref);
    assert.equal(warpAfter.target, b0Ref);
    // The raw screen byte's own position in the compiled event -- computed
    // from decodedBefore's own command sizes rather than hand-counted, since
    // the shape (4-byte page header, then each command in author order) is
    // identical in both builds; only some operand VALUES differ.
    let screenByteAt = 4; // the page header
    for (const command of decodedBefore[0].body) {
      if (command.form === 'warp') break;
      screenByteAt += command.size;
    }
    screenByteAt += 1; // opcode, then the screen operand
    assert.notEqual(
      before.events[before.eventFor.get(entityARef)][screenByteAt],
      after.events[after.eventFor.get(entityARef)][screenByteAt],
      "the warp's own raw compiled screen byte is required to differ"
    );

    const itemIdForActorAfter = new Map(
      built.items.filter((item) => typeof item.actorId === 'number').map((item) => [item.actorId, item.id])
    );
    const pickupResultAfter = resolveEntityByte(
      pickupRef,
      built.sprites.actors[pickupRef.actorId],
      projectUsesItems(built),
      itemIdForActorAfter,
      flatAfter.length
    );
    assert.equal(pickupResultBefore.kind, 'item');
    assert.equal(pickupResultAfter.kind, 'item');
    assert.equal(
      pickupResultBefore.itemId,
      pickupResultAfter.itemId,
      "a pickup entity's compiled byte is an item id, never routed through flat[...], untouched by a screen reorder"
    );
  }
);

/** The four compiled SAVE_IDENTITY_N bytes generate.js emits into assets/config.inc, read back
 *  out of a real build -- the actual compiled artifact, not a second JS-level recomputation of
 *  shared/save.js's own saveIdentity() (already what test 20's own JS-level half checks). */
async function readSaveIdentityBytes(dir) {
  const text = await fs.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  return [0, 1, 2, 3].map((i) => {
    const match = new RegExp(`SAVE_IDENTITY_${i}\\s*=\\s*(\\d+)`).exec(text);
    assert.ok(match, `SAVE_IDENTITY_${i} not found in config.inc`);
    return Number(match[1]);
  });
}

// §11 test 8 (Fix round 1, finding 3: both halves the design spells out --
// the token-change assertions, deterministic rather than probabilistic, and
// the save-enabled half's own opposite claim, previously entirely absent.)
test(
  'reorder then its own inverse permutation is a byte-identical ROM round trip on a save-free fixture ' +
    '(the token changes on each application, deterministically); the opposite holds on a save-enabled ' +
    'variant, whose compiled SAVE_IDENTITY bytes must differ after the identical round trip',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reorder-'));
    t.after(() => fs.rm(dir1, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE);
    // Save-free AND title-free, stated directly per design §7 item 3/§11 test
    // 8's own pin: SAVE_ENABLED never assembles, so saveCompatToken's own
    // (genuinely changing, twice) value never reaches a single compiled byte.
    project.project.titleMap = null;
    project.project.titleScreen = 0;
    await saveProject(dir1, project);
    const built1 = await buildProject({ dir: dir1, project, log: () => {} });
    const romA = await fs.readFile(built1.romPath);

    // Both draws known in advance, so "the token genuinely changed on each
    // reorder" is provable by construction, never a probabilistic
    // t1 !== t2 comparison that could pass on a broken implementation by
    // sheer luck (or fail on a correct one at 1/65535) -- the same
    // deterministic-mock discipline test 21 already uses.
    const queue = [0.1, 0.9];
    t.mock.method(Math, 'random', () => queue.shift());

    const newMapOrder = [1, 0]; // sample/ has exactly two maps
    reorderMapsCore(project, newMapOrder);
    const tokenAfterFirst = project.project.saveCompatToken;
    assert.equal(
      tokenAfterFirst,
      1 + Math.floor(0.1 * 0xffff),
      'the first reorder must redraw a token equal to its own mocked draw'
    );

    reorderMapsCore(project, newMapOrder); // [1,0] is its own inverse
    const tokenAfterSecond = project.project.saveCompatToken;
    assert.equal(
      tokenAfterSecond,
      1 + Math.floor(0.9 * 0xffff),
      'the second (inverse) reorder must ALSO redraw a token -- it does not restore the pre-round-trip value'
    );
    assert.notEqual(
      tokenAfterFirst,
      tokenAfterSecond,
      'known by construction of the two queued mock draws, not a runtime coincidence -- each reorder is its own qualifying edit'
    );
    t.mock.restoreAll();

    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reorder-'));
    t.after(() => fs.rm(dir2, { recursive: true, force: true }));
    await saveProject(dir2, project);
    const built2 = await buildProject({ dir: dir2, project, log: () => {} });
    const romB = await fs.readFile(built2.romPath);

    assert.deepEqual(
      [...romA],
      [...romB],
      'a reorder composed with its own exact inverse must build byte-identical ROMs on a save-free project -- ' +
        'the token changed twice above, but never reached a compiled byte since SAVE_ENABLED is off'
    );

    // The OPPOSITE claim, on a save-enabled variant of the identical
    // round trip -- design §11 test 8's own second, separate assertion,
    // folded into this test rather than a new one since it shares the same
    // round-trip fixture shape. Per §6.10's own explicit policy: two
    // qualifying edits draw two independent tokens, and no attempt is made
    // to recognize a round trip as a no-op -- so a save-enabled project's
    // compiled SAVE_IDENTITY_0..3 bytes are REQUIRED to differ before and
    // after, even though the map order returns to exactly what it was. This
    // is the intended behavior, not a bug the save-free half above somehow
    // missed.
    const dirSaveA = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reorder-save-'));
    t.after(() => fs.rm(dirSaveA, { recursive: true, force: true }));
    const saveEnabledProject = await loadProject(SAMPLE);
    saveEnabledProject.cartridge.mapper = 1; // MMC1 -- save-capable; sample/ ships on NROM
    saveEnabledProject.project.titleMap = 1; // sample/'s own Title map -- Save needs one
    saveEnabledProject.project.titleScreen = 0;
    saveEnabledProject.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
    });
    await saveProject(dirSaveA, saveEnabledProject);
    await buildProject({ dir: dirSaveA, project: saveEnabledProject, log: () => {} });
    const identityBeforeRoundTrip = await readSaveIdentityBytes(dirSaveA);

    reorderMapsCore(saveEnabledProject, newMapOrder);
    reorderMapsCore(saveEnabledProject, newMapOrder); // the identical round trip

    const dirSaveB = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reorder-save-'));
    t.after(() => fs.rm(dirSaveB, { recursive: true, force: true }));
    await saveProject(dirSaveB, saveEnabledProject);
    await buildProject({ dir: dirSaveB, project: saveEnabledProject, log: () => {} });
    const identityAfterRoundTrip = await readSaveIdentityBytes(dirSaveB);

    assert.notDeepEqual(
      identityBeforeRoundTrip,
      identityAfterRoundTrip,
      'a save-enabled project\'s compiled SAVE_IDENTITY_0..3 bytes must differ after the identical round trip, ' +
        'per §6.10\'s own policy -- this is intentional, not the save-free half\'s claim failing to hold here too'
    );
  }
);

// -------- shared harness for tests 20/21 -- mirrors test/unit/save.test.js's
// own buildSaveable/boot/tap/touchSaver (lines 93-200), duplicated here per
// this repository's own per-file convention (every other ROM-booting test
// file duplicates its own `boot`, never imports one from a sibling file).

// Engine RAM, from engine/constants.asm.
const REORDER_PLAYER_X = 0x10;
const REORDER_GAME_STATE = 0x25;
const REORDER_SRAM_BASE = 0x6000;
const REORDER_SRAM_SIZE = 0x2000;
const REORDER_SAVE_MARKER_OFFSET = 0x56;
const REORDER_SAVE_MARKER_VALID = 0xa5;
const REORDER_ST_GAMEPLAY = 0;
const REORDER_ST_TITLE = 3;
const REORDER_A = 0;
const REORDER_SELECT = 2;
const REORDER_START = 3;
const REORDER_RIGHT = 7;
const REORDER_LEFT = 6;
const REORDER_DOWN = 5;
const REORDER_UP = 4;

function reorderBoot(romPath, frames = 60) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fsSync.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const reorderTap = (nes, button, frames = 10) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

function reorderWalkUntil(nes, targetX, targetY, until, budget = 400) {
  for (let i = 0; i < budget; i++) {
    if (until()) return true;
    if (nes.cpu.mem[REORDER_GAME_STATE] !== REORDER_ST_GAMEPLAY) return false;
    const dx = targetX - nes.cpu.mem[REORDER_PLAYER_X];
    const dy = targetY - nes.cpu.mem[0x11];
    let button = null;
    if (dx > 1) button = REORDER_RIGHT;
    else if (dx < -1) button = REORDER_LEFT;
    else if (dy > 1) button = REORDER_DOWN;
    else if (dy < -1) button = REORDER_UP;
    if (button === null) return until();
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
    if (until()) return true;
  }
  return until();
}

function reorderTouchSaver(nes, x, y, until = () => nes.cpu.mem[REORDER_SRAM_BASE + REORDER_SAVE_MARKER_OFFSET] === REORDER_SAVE_MARKER_VALID) {
  const touched = reorderWalkUntil(nes, x, y, until);
  assert.ok(touched, 'walking to the saver never satisfied the given condition');
  for (let i = 0; i < 10; i++) nes.frame();
}

/**
 * sample-rpg with MMC1, a title, a live Save on a touch-triggered NPC, and a
 * SECOND map (one screen) so there is something real to reorder against --
 * design-maporg.md §11 test 20/21's own "two/three maps of one screen each."
 */
async function buildReorderSaveable(t, mutate) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reordersave-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 1; // MMC1
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].encounters = { rate: 0, actorIds: [] }; // a wandering monster must not race this
  const saverId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  project.maps[0].screens[0].entities.push({
    actorId: saverId,
    x: 64,
    y: 96,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] }
    }
  });
  project.maps.push(createMap(project.maps.length, 'Second'));
  if (mutate) mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, romPath: built.romPath };
}

// Fix round 1, finding 1 (High): a permanent regression test for the
// token-zero backward-compatibility promise -- shared/save.js's own
// conditional push (`if (saveCompatToken) values.push(saveCompatToken)`) is
// the ONLY protection for the claim that a project with `saveCompatToken
// === 0` folds the identical eleven-value sequence it always did, and
// nothing else in this test file pins it permanently. The reviewer's own
// finding is right that "field absent equals field explicitly zero" is
// vacuous: normalizeProject/saveIdentity's own `?? 0` collapses both inputs
// to the identical zero, so an unconditional `values.push(saveCompatToken)`
// sabotage folds twelve values either way and that equality still passes.
//
// The golden below is a deliberate wire-compatibility pin, not a value
// derived from this tree's own current code: computed once, from a clean
// `git worktree add` at `8e3e1c9` (the commit item 7 was written against,
// before shared/save.js knew saveCompatToken existed at all), on the
// IDENTICAL fixture built here. It must only ever change on an intentional
// SAVE_LAYOUT_VERSION-class break -- an accidental extra fold term (the
// unconditional-push sabotage this test's own sabotage evidence applies)
// must fail this test, not have the golden quietly updated to match it.
test(
  'saveIdentity: a token-zero project folds the pre-item-7 identity sequence, byte-identical to the pinned ' +
    'golden computed from 8e3e1c9',
  () => {
    const project = createProject('Golden', 'rpg');
    project.maps.push(createMap(1, 'Second'));
    project.sprites.actors.push({ name: 'Monster', damage: 1 });
    project.items.push({
      id: 0,
      name: 'Potion',
      actorId: null,
      metaspriteId: null,
      effect: { kind: 'none', amount: 0 }
    });

    // Fix round 2, finding 1: every project-dependent value saveIdentity
    // folds, pinned and asserted individually BEFORE the opaque hash
    // comparison below. This fixture appends to createProject's own RPG
    // defaults (starter party, rpg.maxLevel, the initial 1-map/1-screen
    // shape) rather than assigning a fully synthetic tuple, so a later,
    // unrelated product change to one of those defaults (a second starter
    // party member, a different maxLevel default, a different starter-map
    // shape) would otherwise move this golden's own input while leaving the
    // legacy fold contract untouched -- an opaque hash mismatch with no
    // local evidence of what drifted. Each assertion below fails locally
    // and legibly on the specific field that moved instead. Only the
    // global layout constants saveIdentity also folds (RPG_LIMITS.variables/
    // party, MAX_ITEMS, SAVE_LAYOUT_VERSION) are left implicit -- an
    // intentional change to one of those IS the compatibility-class break
    // this golden exists to force a deliberate update for.
    const screenCount = project.maps.reduce((total, map) => total + map.screens.length, 0);
    assert.equal(screenCount, 2, 'screenCount input must stay pinned at 2 (two maps, one screen each)');
    assert.equal(project.maps.length, 2, 'mapCount input must stay pinned at 2');
    assert.equal(project.sprites.actors.length, 1, 'actorCount input must stay pinned at 1');
    assert.equal(project.rpg.maxLevel, 15, "maxLevel input must stay pinned at 15 (createProject's own RPG default)");
    assert.equal(
      project.party.length,
      1,
      "partyCount input must stay pinned at 1 (createProject's own RPG starter party)"
    );
    assert.equal(project.project.gameType, 'rpg', 'battleEnabled input must stay pinned at rpg (gameType)');
    assert.equal(projectUsesItems(project), true, 'itemsEnabled input must stay pinned at true');
    assert.equal(project.items.length, 1, 'itemCount input must stay pinned at 1');
    assert.equal(project.project.saveCompatToken, 0, 'the golden fixture is token-zero by construction');

    assert.equal(
      saveIdentity(project),
      2144726128, // computed at 8e3e1c9 on this identical, now fully pinned, fixture; see the comment above
      "saveIdentity must fold the pre-item-7 sequence exactly for a token-zero project -- an old cartridge save's " +
        'own identity bytes were computed against this fold, and must still validate against it'
    );
  }
);

// §11 test 20
test(
  'saveCompatToken/saveIdentity: a same-flat-count reorder redraws the token and changes identity',
  () => {
    const project = createProject('Token JS', 'rpg');
    project.cartridge.mapper = 1;
    project.project.titleMap = 0;
    project.maps = [createMap(0, 'A'), createMap(1, 'B')];
    assert.equal(project.project.saveCompatToken, 0);
    const before = saveIdentity(project);

    reorderMapsCore(project, [1, 0]); // screenCount/mapCount both unchanged

    assert.ok(Number.isInteger(project.project.saveCompatToken));
    assert.ok(project.project.saveCompatToken >= 1 && project.project.saveCompatToken <= 0xffff);
    const after = saveIdentity(project);
    assert.notEqual(before, after, "a redrawn token must change saveIdentity's output");

    // The width-hole fix: an out-of-range stored token must not fold as its
    // own & 0xffff alias -- it falls back to 0, the same "no qualifying edit"
    // default a project that never performed one already has.
    const raw = createProject('Clamp');
    raw.project.saveCompatToken = 0x10001; // 65537 -- aliases 1 under & 0xffff
    const normalized = normalizeProject(raw);
    assert.equal(normalized.project.saveCompatToken, 0, 'an out-of-range stored token falls back to 0');
  }
);

// §11 test 20 (b)/(c): full integration + negative control
test(
  'save-compat token: a reorder invalidates a cartridge save; rebuilding the unreordered project accepts the ' +
    'identical save (negative control)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { project, romPath: romPath1 } = await buildReorderSaveable(t);
    const nes = reorderBoot(romPath1);
    reorderTap(nes, REORDER_START);
    reorderTouchSaver(nes, 64, 96);
    assert.equal(
      nes.cpu.mem[REORDER_SRAM_BASE + REORDER_SAVE_MARKER_OFFSET],
      REORDER_SAVE_MARKER_VALID,
      'the real save never completed'
    );
    const foreignBattery = nes.cpu.mem.slice(REORDER_SRAM_BASE, REORDER_SRAM_BASE + REORDER_SRAM_SIZE);

    // (b) the reordered build.
    const reordered = structuredClone(project);
    reorderMapsCore(reordered, [1, 0]); // swap the two maps -- screenCount/mapCount both unchanged
    const dirReordered = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reordersave-b-'));
    t.after(() => fs.rm(dirReordered, { recursive: true, force: true }));
    await saveProject(dirReordered, reordered);
    const builtReordered = await buildProject({ dir: dirReordered, project: reordered, log: () => {} });
    const other = reorderBoot(builtReordered.romPath);
    other.cpu.mem.set(foreignBattery, REORDER_SRAM_BASE);
    reorderTap(other, REORDER_SELECT);
    assert.equal(
      other.cpu.mem[REORDER_GAME_STATE],
      REORDER_ST_TITLE,
      'a save from before the reorder must be refused, not misapplied'
    );

    // (c) the negative control -- the identical save, on a build from the
    // UNREORDERED project, proving the refusal above is caused by the
    // reorder's token redraw and not by unrelated build nondeterminism.
    const dirSame = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-reordersave-c-'));
    t.after(() => fs.rm(dirSame, { recursive: true, force: true }));
    await saveProject(dirSame, project);
    const builtSame = await buildProject({ dir: dirSame, project, log: () => {} });
    const same = reorderBoot(builtSame.romPath);
    same.cpu.mem.set(foreignBattery, REORDER_SRAM_BASE);
    reorderTap(same, REORDER_SELECT);
    assert.equal(
      same.cpu.mem[REORDER_GAME_STATE],
      REORDER_ST_GAMEPLAY,
      'the identical save on an unreordered rebuild must still be accepted'
    );
  }
);

// §11 test 21
test(
  'undo then a genuinely different reorder redraws a different token -- deterministic, no residual probabilism',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { project } = await buildReorderSaveable(t, (p) => {
      p.maps.push(createMap(p.maps.length, 'Third')); // [Starfall Plain(A), Second(B), Third(C)]
    });

    const preReorderSnapshot = structuredClone(project);

    // Both draws known in advance, so t2 !== t1 is provable by construction,
    // never a runtime coincidence -- Fix round 3, finding 6.
    const queue = [0.00002, 0.99998];
    t.mock.method(Math, 'random', () => queue.shift());

    reorderMapsCore(project, [1, 0, 2]); // [A,B,C] -> [B,A,C]
    const t1 = project.project.saveCompatToken;
    assert.equal(t1, 1 + Math.floor(0.00002 * 0xffff));

    const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-undo21-a-'));
    t.after(() => fs.rm(dir1, { recursive: true, force: true }));
    await saveProject(dir1, project);
    const built1 = await buildProject({ dir: dir1, project, log: () => {} });
    const nes = reorderBoot(built1.romPath);
    reorderTap(nes, REORDER_START);
    reorderTouchSaver(nes, 64, 96);
    const foreignBattery = nes.cpu.mem.slice(REORDER_SRAM_BASE, REORDER_SRAM_BASE + REORDER_SRAM_SIZE);

    // Undo -- store.undo()'s own whole-project structuredClone restore, done
    // by hand here since this test drives the project object directly rather
    // than through renderer/store.js.
    const restored = structuredClone(preReorderSnapshot);
    assert.equal(restored.project.saveCompatToken, 0, 'undo genuinely restores the pre-reorder token');

    reorderMapsCore(restored, [2, 0, 1]); // a DIFFERENT reorder: [A,B,C] -> [C,A,B]
    const t2 = restored.project.saveCompatToken;
    assert.equal(t2, 1 + Math.floor(0.99998 * 0xffff));
    assert.notEqual(t2, t1, 'known by construction of the two queued mock draws, not a runtime coincidence');

    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-undo21-b-'));
    t.after(() => fs.rm(dir2, { recursive: true, force: true }));
    await saveProject(dir2, restored);
    const built2 = await buildProject({ dir: dir2, project: restored, log: () => {} });
    const other = reorderBoot(built2.romPath);
    other.cpu.mem.set(foreignBattery, REORDER_SRAM_BASE);
    reorderTap(other, REORDER_SELECT);
    assert.equal(
      other.cpu.mem[REORDER_GAME_STATE],
      REORDER_ST_TITLE,
      'the save from the undone branch must be refused after a different, genuinely reordered rebuild'
    );
  }
);

// ---------------------------------------------------------------------------
// ROADMAP item 7 -- map organization and reuse, phase 2
// (handoff-maporg/design-maporg.md §4.2/§4.3/§6.2/§9, handoff-maporg/maporg-phase-plan.md)
//
// The append operations: Add Map and Duplicate Map, both funneling through
// the shared buildAppendCanonicalizeTranslate primitive, and the
// duplicate-name validateProject warning. Per this phase's own house rule
// (carried forward from phase 1's round-1 review): every operation gets a
// commit-free core in shared/project.js (addMapCore, duplicateMapCore) that
// both renderer/forges/map/map.js's single store.commit and the tests below
// call -- no test-local mirror of a renderer function. Delete/Resize/
// Duplicate-screen/paste/folders are later phases and are not tested here.
// ---------------------------------------------------------------------------

// §11 test 4
test(
  'duplicate-append canonicalizes a pre-existing out-of-range value against the PRE-append flat count, ' +
    'not the post-append one',
  () => {
    const project = createProject('Duplicate canonicalize');
    const map = createMap(0, 'Home');
    map.gridW = 1;
    map.gridH = 3;
    map.screens = [createScreen(), createScreen(), createScreen()]; // flat 0, 1, 2
    project.maps = [map];
    const door = { actorId: 0, x: 0, y: 0, props: { toScreen: 255, event: null } }; // effective target: screen 2
    map.screens[0].entities = [door];

    const clone = duplicateMapCore(project, 0);

    assert.equal(project.maps.length, 2, 'duplicate appends a second map');
    assert.equal(project.maps[1].screens.length, 3, 'screenCount doubles');
    assert.equal(
      door.props.toScreen,
      2,
      "the original door's pre-existing out-of-range value follows its own already-resolved, pre-edit " +
        'effective target -- not the new, post-append last screen (5), which re-clamping against the ' +
        'larger count would silently produce'
    );

    // Fix round 1, finding 1: the coverage gap the review names -- nothing
    // previously asserted anything about the CLONE's own copy of the
    // identical out-of-range value. It must resolve to the CLONE's own
    // last screen, by object-derived flat position (never a hardcoded
    // number), proving the canonicalizing pass reaches the clone's own
    // freshly-cloned operands too, not only the rest of the project.
    const clonedDoor = clone.screens[0].entities[0];
    const cloneScreen2FlatIndex = flatScreens(project).findIndex((entry) => entry.screen === clone.screens[2]);
    assert.equal(
      clonedDoor.props.toScreen,
      cloneScreen2FlatIndex,
      "the clone's own copy of the out-of-range door resolves to the CLONE's own last screen, not the original's"
    );
  }
);

// §11 test 9
test(
  'duplicate map: self-referential doors and nested Warps (top-level, branch, choice) follow the copy; ' +
    'external references do not; the original is completely unchanged',
  () => {
    const project = createProject('Duplicate split');
    // A multi-screen Precursor map ahead of the one being duplicated -- so
    // the source map's own flat range starts at a nonzero, non-mapIndex
    // offset (3, not 1). An implementation that derived the source's own
    // flat base from `mapIndex` directly, rather than summing every
    // preceding map's own screen count, would coincidentally still be
    // correct at mapIndex 0 (both give 0) and only be caught here.
    const precursor = createMap(0, 'Precursor');
    precursor.gridW = 1;
    precursor.gridH = 3;
    precursor.screens = [createScreen(), createScreen(), createScreen()]; // flat 0, 1, 2
    const mapA = createMap(1, 'A');
    mapA.gridW = 1;
    mapA.gridH = 2;
    const a0 = createScreen();
    const a1 = createScreen();
    mapA.screens = [a0, a1]; // flat 3, 4
    const mapB = createMap(2, 'B');
    const b0 = createScreen();
    mapB.screens = [b0]; // flat 5
    project.maps = [precursor, mapA, mapB];
    const mapAIndex = 1;

    const doorSelf = { actorId: 0, x: 0, y: 0, props: { toScreen: 4, event: null } }; // A -> A1 (self)
    const doorExternal = { actorId: 0, x: 0, y: 0, props: { toScreen: 5, event: null } }; // A -> B0 (external)
    const warpEntity = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'warp', screen: 4, x: 0, y: 0 }, // top-level, self
              {
                op: 'branch',
                cond: { type: 'none', arg: 0 },
                then: [{ op: 'warp', screen: 5, x: 0, y: 0 }], // branch-then, external
                // Fix round 1, finding 2: a self-referential warp in the
                // branch's OTHER side, whose translated value must differ
                // from its authored one (4 -> a real, different flat index)
                // -- a walker that enters `then` but never `else` (or vice
                // versa) would leave this one stale, and the fixture's own
                // only other branch-nested warp (then, above) is external,
                // whose correct outcome is "unchanged" and so cannot catch
                // a walker that skips a whole branch side.
                else: [{ op: 'warp', screen: 4, x: 0, y: 0 }] // branch-else, self
              },
              { op: 'choice', options: [{ text: 'Go', commands: [{ op: 'warp', screen: 4, x: 0, y: 0 }] }] } // choice-nested, self
            ]
          }]
        }
      }
    };
    a0.entities = [doorSelf, doorExternal, warpEntity];

    // Item 7 phase 5, design §8: whole-map Duplicate structuredClone's the
    // whole source map object, so folder should already come along for
    // free, with no code change of its own -- proven here directly rather
    // than assumed, since a `folder`-less fixture (every other one in this
    // file, written before §8 existed) could never have caught its absence.
    mapA.folder = 'Dungeons';

    const originalSnapshot = structuredClone(mapA);
    assert.equal(project.project.saveCompatToken, 0);

    const clone = duplicateMapCore(project, mapAIndex);

    assert.equal(clone.folder, 'Dungeons', "the copy's own folder came along for free with structuredClone(sourceMap)");

    assert.deepEqual(mapA, originalSnapshot, "the original map's own entities and events are completely unchanged");
    assert.equal(
      project.project.saveCompatToken,
      0,
      'Duplicate Map never redraws the token -- screenCount already moves (§6.10), the identical argument ' +
        "addMapCore's own policy already makes"
    );

    const flatNow = flatScreens(project);
    const cloneA1FlatIndex = flatNow.findIndex((entry) => entry.screen === clone.screens[1]);
    const b0FlatIndex = flatNow.findIndex((entry) => entry.screen === b0);

    const [cloneDoorSelf, cloneDoorExternal, cloneWarpEntity] = clone.screens[0].entities;
    assert.equal(
      cloneDoorSelf.props.toScreen,
      cloneA1FlatIndex,
      "the copy's self-referential door points at the copy's own screen 1, not the original's"
    );
    assert.equal(
      cloneDoorExternal.props.toScreen,
      b0FlatIndex,
      "the copy's external door still points at the same external target the original's does"
    );

    const [topWarp, branchCmd, choiceCmd] = cloneWarpEntity.props.event.pages[0].commands;
    assert.equal(topWarp.screen, cloneA1FlatIndex, "the copy's top-level self-referential warp follows the copy");
    assert.equal(
      branchCmd.then[0].screen,
      b0FlatIndex,
      "the copy's branch-then external warp stays pointed at the external target"
    );
    assert.equal(
      branchCmd.else[0].screen,
      cloneA1FlatIndex,
      "the copy's branch-else self-referential warp follows the copy -- proving the walker enters BOTH branch sides"
    );
    assert.equal(
      choiceCmd.options[0].commands[0].screen,
      cloneA1FlatIndex,
      "the copy's choice-nested self-referential warp follows the copy"
    );
  }
);

// §11 test 10
test(
  "duplicate map: the auto-suffixed name avoids §4.3's collision, verified against resolveStartAt " +
    '(not merely a cosmetic string check)',
  () => {
    const project = createProject('Duplicate naming');
    const dungeon = createMap(0, 'Dungeon');
    project.maps = [dungeon];

    const remembered = { mapName: 'Dungeon', screenIndex: 0, screenName: '', x: 0, y: 0 };
    const before = resolveStartAt(remembered, project);
    assert.equal(before.ok, true, 'sanity: the scenario resolves before duplicating at all');

    const clone = duplicateMapCore(project, 0);
    assert.equal(clone.name, 'Dungeon copy', 'the copy is auto-suffixed, never a verbatim name collision');

    const after = resolveStartAt(remembered, project);
    assert.equal(
      after.ok,
      true,
      "resolveStartAt must still resolve after duplicating -- the copy's own name must not collide with the source's"
    );

    // Fix round 1, finding 3: the required sequence is "copy", "copy 2",
    // "copy 3", ... -- a destination already holding BOTH "Dungeon" and
    // "Dungeon copy" must produce exactly "Dungeon copy 2" next. A helper
    // whose loop special-cases its own first numbered iteration to mean
    // "no number" skips "copy 2" entirely and produces "copy 3" here
    // instead -- invisible to the single-duplicate fixture above, which
    // never has "copy" already taken when it runs.
    const collisionProject = createProject('Duplicate naming collision');
    collisionProject.maps = [createMap(0, 'Dungeon'), createMap(1, 'Dungeon copy')];
    const secondClone = duplicateMapCore(collisionProject, 0);
    assert.equal(
      secondClone.name,
      'Dungeon copy 2',
      'with "Dungeon" and "Dungeon copy" both already taken, the next candidate must be "Dungeon copy 2"'
    );
  }
);

// §11 test 17
test(
  'validateProject warns on duplicate map names and duplicate same-map screen names, excluding empty ' +
    'names and cross-map collisions',
  () => {
    const warningsOf = (project) => validateProject(project).filter((p) => p.severity === 'warning');

    // (a) two maps sharing a name -- warns.
    {
      const project = createProject('Dup names A');
      project.maps = [createMap(0, 'Same'), createMap(1, 'Same')];
      const warnings = warningsOf(project);
      assert.ok(
        warnings.some((w) => /map name/.test(w.message)),
        'two same-named maps must produce a map-name warning'
      );
    }

    // (b) two non-empty-named screens on the SAME map -- warns.
    {
      const project = createProject('Dup names B');
      const map = createMap(0, 'Home');
      map.gridW = 1;
      map.gridH = 2;
      const s0 = createScreen();
      s0.name = 'Vault';
      const s1 = createScreen();
      s1.name = 'Vault';
      map.screens = [s0, s1];
      project.maps = [map];
      const warnings = warningsOf(project);
      assert.ok(
        warnings.some((w) => /screen name/.test(w.message)),
        'two same-named screens on the same map must produce a screen-name warning'
      );
    }

    // (c) two screens on DIFFERENT maps sharing a name -- does not warn.
    {
      const project = createProject('Dup names C');
      const mapA = createMap(0, 'A');
      const sa = createScreen();
      sa.name = 'Vault';
      mapA.screens = [sa];
      const mapB = createMap(1, 'B');
      const sb = createScreen();
      sb.name = 'Vault';
      mapB.screens = [sb];
      project.maps = [mapA, mapB];
      const warnings = warningsOf(project);
      assert.ok(
        !warnings.some((w) => /screen name/.test(w.message)),
        'the same screen name in two DIFFERENT maps must not warn -- screenLabel already disambiguates ' +
          'by map name, and resolveStartAt is scoped per-map'
      );
    }

    // (d) an ordinary multi-screen map, every screen unnamed except one -- does not warn at all.
    {
      const project = createProject('Dup names D');
      const map = createMap(0, 'Home');
      map.gridW = 1;
      map.gridH = 3;
      const s0 = createScreen(); // unnamed
      const s1 = createScreen(); // unnamed
      const s2 = createScreen();
      s2.name = 'Boss Room';
      map.screens = [s0, s1, s2];
      project.maps = [map];
      assert.deepEqual(
        warningsOf(project),
        [],
        'empty screen names must be excluded from the count entirely, or this fires on nearly every ordinary project'
      );
    }
  }
);

// §11 test 25
test(
  'Add Map keeps a pre-existing out-of-range operand at its effective target, never redraws the token, ' +
    'and never collides names after a Delete',
  () => {
    // (a)/(b): out-of-range door and nested warp keep their effective target; no token redraw.
    {
      const project = createProject('Add map canonicalize');
      const map = createMap(0, 'Home');
      map.gridW = 1;
      map.gridH = 3;
      map.screens = [createScreen(), createScreen(), createScreen()]; // flat 0, 1, 2
      project.maps = [map];
      const door = { actorId: 0, x: 0, y: 0, props: { toScreen: 255, event: null } };
      const warpEntity = {
        actorId: 0, x: 0, y: 0,
        props: {
          toScreen: 0,
          event: {
            pages: [{
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'warp', screen: 255, x: 0, y: 0 }], else: [] }
              ]
            }]
          }
        }
      };
      map.screens[0].entities = [door, warpEntity];
      assert.equal(project.project.saveCompatToken, 0);

      addMapCore(project);

      assert.equal(project.maps.length, 2, 'a new map was appended');
      assert.equal(
        door.props.toScreen,
        2,
        "the door's pre-existing out-of-range value follows its own already-resolved, pre-edit effective " +
          'target -- not the new map\'s own single screen (3), which re-clamping against the larger count ' +
          'would silently produce'
      );
      assert.equal(
        warpEntity.props.event.pages[0].commands[0].then[0].screen,
        2,
        "the nested warp's pre-existing out-of-range value follows the identical resolution"
      );
      assert.equal(
        project.project.saveCompatToken,
        0,
        'Add Map never redraws the token -- screenCount already moves (§6.10)'
      );
    }

    // (c) the delete-then-add naming collision the round-3 self-check found.
    {
      const project = createProject('Add map naming');
      project.maps = [createMap(0, 'Dungeon'), createMap(1, 'Map 1')];
      project.maps.splice(0, 1); // delete "Dungeon" -- one map remains, "Map 1", at array length 1
      const newMap = addMapCore(project);
      assert.notEqual(
        newMap.name,
        'Map 1',
        'the literal `Map ${project.maps.length}` collision (length is back down to 1) must not recur'
      );
      assert.ok(
        project.maps.every((m) => m === newMap || m.name !== newMap.name),
        "the new map's name must be distinct from every surviving map's, per nameForNewMap's own scan"
      );
      // Fix round 1, finding 4: "not Map 1" plus uniqueness alone passes a
      // helper that scans from zero and returns "Map 0" -- itself a real,
      // if different, contract violation (the scan is specified to start
      // from existingMaps.length, not 0). Assert the derived literal the
      // specified scan actually produces: existingMaps.length is 1 ("Map
      // 1" survives), so the scan starts there, finds "Map 1" taken, and
      // must land on "Map 2".
      assert.equal(newMap.name, 'Map 2', "nameForNewMap's scan must start from existingMaps.length (1), not 0");
    }
  }
);

// ---------------------------------------------------------------------------
// ROADMAP item 7 -- map organization and reuse, phase 3
// (handoff-maporg/design-maporg.md §4.2/§6.1.3/§6.1.4/§6.4/§6.8/§6.9)
//
// Delete Map and Resize Map: the retrofit of two already-shipped operations
// that today restructure the map list with zero reference repair. Per this
// slice's own house rule: every operation is a commit-free core in
// shared/project.js (deleteMapCore, growOrShrinkMap) that both
// renderer/forges/map/map.js's single store.commit and the tests below call
// -- no test-local mirror of a renderer function.
// ---------------------------------------------------------------------------

// §11 test 18
test(
  'deleteMapCore applies the three-case map-space policy to startMap/titleMap, repairs every flat-space ' +
    'reference (including through DROPPED_SCREEN/FALLBACK_SCREEN), and never defaults an already-null titleMap',
  () => {
    // Case A (referenced index > mapIndex: decrements) and Case B (referenced
    // index < mapIndex: unchanged), exercised together so a wrong
    // implementation that decrements every reference regardless of side
    // cannot pass both at once. Also the first place DROPPED_SCREEN/
    // FALLBACK_SCREEN get genuinely exercised (phase 1's own recorded gap):
    // a door on a surviving screen names a screen that belongs to the map
    // being deleted.
    {
      const project = createProject('Delete map space');
      const alpha = createMap(0, 'Alpha');
      alpha.gridW = 1;
      alpha.gridH = 1;
      const a0 = createScreen();
      a0.name = 'A0';
      alpha.screens = [a0];

      const beta = createMap(1, 'Beta'); // deleted
      const b0 = createScreen();
      b0.name = 'B0';
      const b1 = createScreen();
      b1.name = 'B1';
      beta.screens = [b0, b1];

      const gamma = createMap(2, 'Gamma');
      const g0 = createScreen();
      g0.name = 'G0';
      gamma.screens = [g0];

      project.maps = [alpha, beta, gamma]; // flat: A0=0, B0=1, B1=2, G0=3

      const doorToDeleted = { actorId: 0, x: 0, y: 0, props: { toScreen: 1, event: null } }; // -> B0, about to be deleted
      const doorSurvives = { actorId: 0, x: 0, y: 0, props: { toScreen: 3, event: null } }; // -> G0, survives
      a0.entities = [doorToDeleted, doorSurvives];

      const branchWarpEntity = {
        actorId: 0, x: 0, y: 0,
        props: {
          toScreen: 0,
          event: {
            pages: [{
              cond: { type: 'none', arg: 0 },
              commands: [
                {
                  op: 'branch',
                  cond: { type: 'none', arg: 0 },
                  // Code review round 1, finding 2: every reference that travels the
                  // DROPPED_SCREEN path elsewhere in this test is a door -- the Warp-
                  // specific conditional in remapScreenReferences' own dropped branch
                  // (shared/project.js) was never actually reached. This nested Warp
                  // (then side) targets B1, about to be deleted, so it must resolve to
                  // FALLBACK_SCREEN below; the else side keeps its own already-proven
                  // surviving-target case, so both the walk (branch nesting) and the
                  // Warp dropped branch are proved by the same entity.
                  then: [{ op: 'warp', screen: 2, x: 0, y: 0 }], // -> B1, about to be deleted
                  else: [{ op: 'warp', screen: 0, x: 0, y: 0 }] // -> A0, survives
                }
              ]
            }]
          }
        }
      };
      g0.entities = [branchWarpEntity];

      project.project.startMap = 0; // Case B: < mapIndex (1) -- must stay unchanged
      project.project.startScreen = 0;
      project.project.titleMap = 2; // Case A: > mapIndex (1) -- must decrement
      project.project.titleScreen = 0;

      deleteMapCore(project, 1);

      assert.equal(project.maps.length, 2, 'Beta was removed');
      assert.equal(project.maps[0], alpha, "Alpha's own object identity is untouched");
      assert.equal(project.maps[1], gamma, "Gamma survives, now at position 1 -- its own object identity is untouched");

      const flatNow = flatScreens(project);
      const flatIndexOf = (screen) => flatNow.findIndex((entry) => entry.screen === screen);

      assert.equal(
        doorToDeleted.props.toScreen,
        FALLBACK_SCREEN(project),
        "a reference to a screen that belonged to the deleted map redirects to FALLBACK_SCREEN, not some " +
          'coincidentally-similar surviving index'
      );
      assert.notEqual(
        doorToDeleted.props.toScreen,
        1,
        'the dropped reference must not merely keep its own stale raw value by accident'
      );
      assert.equal(doorSurvives.props.toScreen, flatIndexOf(g0), "the cross-map door still names Gamma's content");
      assert.equal(
        branchWarpEntity.props.event.pages[0].commands[0].else[0].screen,
        flatIndexOf(a0),
        "the branch-else-nested warp still names Alpha's content"
      );
      assert.equal(
        branchWarpEntity.props.event.pages[0].commands[0].then[0].screen,
        FALLBACK_SCREEN(project),
        "the branch-then-nested warp targeted a screen belonging to the deleted map -- it redirects to " +
          'FALLBACK_SCREEN through the Warp-specific dropped branch of remapScreenReferences, not merely the ' +
          'door branch already proven above (code review round 1, finding 2)'
      );
      assert.notEqual(
        branchWarpEntity.props.event.pages[0].commands[0].then[0].screen,
        2,
        'the dropped nested warp must not merely keep its own stale raw value by accident'
      );

      assert.equal(project.project.startMap, 0, 'Case B: startMap (0) is below mapIndex (1) -- unchanged');
      assert.equal(project.project.startScreen, 0, 'startMap never named the deleted map -- startScreen is untouched');
      assert.equal(project.project.titleMap, project.maps.indexOf(gamma), 'Case A: titleMap (2) is above mapIndex (1) -- decrements to Gamma\'s new position');
      assert.equal(project.project.titleScreen, 0, "titleMap didn't become null -- titleScreen is untouched");
    }

    // Mirror of the fixture above: startMap > mapIndex (must decrement) and a
    // non-null titleMap < mapIndex (must stay unchanged) -- code review
    // round 1, finding 1. The fixture above split Case A onto titleMap and
    // Case B onto startMap; nothing exercised the OPPOSITE pairing, so this
    // field-specific implementation passed every original fixture:
    //   startMap = old === mapIndex ? 0 : old;                       // never decrements when old > mapIndex
    //   titleMap = old === null ? null : old === mapIndex ? null : old - 1;  // always decrements, even when old < mapIndex
    // Both fields need all three cases across the fixture set, not three
    // cases split between them.
    {
      const project = createProject('Delete map space mirror');
      const alpha = createMap(0, 'Alpha');
      const a0 = createScreen();
      a0.name = 'A0';
      alpha.screens = [a0];

      const beta = createMap(1, 'Beta'); // deleted
      const b0 = createScreen();
      b0.name = 'B0';
      beta.screens = [b0];

      const gamma = createMap(2, 'Gamma');
      const g0 = createScreen();
      g0.name = 'G0';
      gamma.screens = [g0];

      project.maps = [alpha, beta, gamma]; // flat: A0=0, B0=1, G0=2

      project.project.startMap = 2; // Case A: > mapIndex (1) -- must decrement
      project.project.startScreen = 0;
      project.project.titleMap = 0; // Case B: < mapIndex (1), non-null -- must stay unchanged
      project.project.titleScreen = 0;

      deleteMapCore(project, 1);

      assert.equal(project.maps.length, 2, 'Beta was removed');
      assert.equal(project.maps[0], alpha, "Alpha's own object identity is untouched");
      assert.equal(project.maps[1], gamma, "Gamma survives, now at position 1");

      assert.equal(
        project.project.startMap,
        project.maps.indexOf(gamma),
        "Case A: startMap (2) is above mapIndex (1) -- decrements to Gamma's new position. The field-specific " +
          'sabotage above (startMap = old === mapIndex ? 0 : old) would leave this at 2, never decrementing'
      );
      assert.equal(project.project.startScreen, 0, 'startMap never named the deleted map -- startScreen is untouched');
      assert.equal(
        project.project.titleMap,
        0,
        'Case B: titleMap (0) is below mapIndex (1), non-null -- stays unchanged. The field-specific sabotage ' +
          'above (titleMap = old === mapIndex ? null : old - 1) would decrement this to -1 unconditionally'
      );
      assert.equal(project.project.titleScreen, 0, 'titleMap never became null -- titleScreen is untouched');
    }

    // Case C: referenced index === mapIndex (the deleted map itself). Both
    // startMap and titleMap point AT the map being deleted, in the same
    // fixture, so a wrong implementation that only handles one of the two
    // fields cannot pass by accident. Deliberately the LAST of three maps
    // (mapIndex 2), not the first: closing self-check exercise finding --
    // with mapIndex 0, a sabotaged implementation that drops the ===
    // mapIndex case entirely (falls through to "> mapIndex ? decrement :
    // unchanged") produces "unchanged" (0), which coincidentally equals the
    // correct fallback (0) too, so the bug is invisible. mapIndex 2 makes
    // "unchanged" (2) and "always decrement" (1) both distinguishable, real,
    // in-range wrong values against the correct fallback (0).
    {
      const project = createProject('Delete map target');
      const before0 = createMap(0, 'Before0');
      const p0 = createScreen();
      p0.name = 'P0';
      before0.screens = [p0];

      const before1 = createMap(1, 'Before1');
      const q0 = createScreen();
      q0.name = 'Q0';
      before1.screens = [q0];
      const doorToDoomed = { actorId: 0, x: 0, y: 0, props: { toScreen: 2, event: null } }; // -> X0, about to be deleted
      q0.entities = [doorToDoomed];

      const doomed = createMap(2, 'Doomed'); // deleted -- mapIndex 2, the LAST map
      const x0 = createScreen();
      x0.name = 'X0';
      doomed.screens = [x0];

      project.maps = [before0, before1, doomed]; // flat: P0=0, Q0=1, X0=2

      project.project.startMap = 2; // === mapIndex
      project.project.startScreen = 1; // nonzero, to prove the fallback actually resets it
      project.project.titleMap = 2; // === mapIndex
      project.project.titleScreen = 1; // nonzero, to prove the fallback actually resets it

      deleteMapCore(project, 2);

      assert.equal(project.maps.length, 2);
      assert.equal(project.maps[0], before0, "Before0's own object identity is untouched");
      assert.equal(project.maps[1], before1, "Before1's own object identity is untouched");
      assert.equal(project.project.startMap, 0, 'Case C: startMap named the deleted map -- falls back to 0 of the surviving array');
      assert.equal(project.project.startScreen, 0, 'startMap fell back -- startScreen resets to 0 alongside it');
      assert.equal(project.project.titleMap, null, 'Case C: titleMap named the deleted map -- falls back to null (titleless is legal)');
      assert.equal(project.project.titleScreen, 0, 'titleMap just became null -- titleScreen resets to 0');
      assert.equal(
        doorToDoomed.props.toScreen,
        FALLBACK_SCREEN(project),
        "a surviving screen's own reference to the deleted map's content redirects to FALLBACK_SCREEN"
      );
    }

    // The 7th, independent fixture: titleMap is null from the START (never
    // set), and an UNRELATED map is deleted. A wrong implementation that
    // defaults any null titleMap to map 0 on delete -- e.g. `oldTitleMap ?? 0`
    // as a defensive fallback, mistaking titleless for an error case -- is
    // invisible to every fixture above, since all three start from a
    // non-null title.
    {
      const project = createProject('Delete map null title');
      const p = createMap(0, 'P');
      const p0 = createScreen();
      p.screens = [p0];
      const q = createMap(1, 'Q');
      const q0 = createScreen();
      q.screens = [q0];
      const r = createMap(2, 'R'); // deleted -- unrelated to title/start
      const r0 = createScreen();
      r.screens = [r0];
      project.maps = [p, q, r]; // flat: P0=0, Q0=1, R0=2

      const doorAcross = { actorId: 0, x: 0, y: 0, props: { toScreen: 1, event: null } }; // -> Q0, survives
      p0.entities = [doorAcross];

      project.project.titleMap = null;
      project.project.titleScreen = 7; // deliberately nonzero, stale data with no titleMap to interpret it under
      project.project.startMap = 0; // < mapIndex (2) -- Case B again, cheap extra coverage
      project.project.startScreen = 0;

      deleteMapCore(project, 2);

      assert.equal(project.maps.length, 2);
      assert.equal(project.project.titleMap, null, 'an already-null titleMap must stay strictly null, never defaulted to a real map');
      assert.equal(
        project.project.titleScreen,
        0,
        'per design §6.8, titleScreen is reset whenever the post-op titleMap is null'
      );

      const flatNow = flatScreens(project);
      const flatIndexOf = (screen) => flatNow.findIndex((entry) => entry.screen === screen);
      assert.equal(doorAcross.props.toScreen, flatIndexOf(q0), "the cross-map door still names Q's content");
    }
  }
);

// §11 test 19
test(
  'growOrShrinkMap relocates startScreen/titleScreen through the per-map diff on a grow, falls back to per-map ' +
    '0 on a shrink, and repairs every flat-space reference project-wide either way',
  () => {
    // Design fix round 1, finding 9's own binding correction to this test's
    // fixture requirements: the resized map must sit SECOND OR LATER in
    // project.maps (nonzero flat base), never first. On a first map, flat
    // and per-map coordinates are numerically identical for every screen it
    // holds, so an implementation that wires flatTranslate into the
    // startScreen/titleScreen fixup instead of the dedicated perMapTranslate
    // would be invisible on a first-map fixture. Away sits before Home
    // specifically to make that bug produce a visibly wrong, in-range value
    // (see the sabotage evidence in the phase 3 report). Beyond sits after
    // Home so the flat-space shift is proven on content on BOTH sides of the
    // resized map, not only downstream of it.
    //
    // Grow: [a,b,c,d] (2x2) -> [a,b,new,c,d,new] (3x2), design §6.9's own
    // shape. c's old per-map index (row1,col0 = 2) must become 3 in the new
    // grid.
    {
      const project = createProject('Resize grow');
      const away = createMap(0, 'Away');
      const e0 = createScreen();
      e0.name = 'e0';
      const e1 = createScreen();
      e1.name = 'e1';
      away.screens = [e0, e1];

      const home = createMap(1, 'Home'); // the resized map -- flat base 2, not 0
      home.gridW = 2;
      home.gridH = 2;
      const a = createScreen();
      a.name = 'a';
      const b = createScreen();
      b.name = 'b';
      const c = createScreen();
      c.name = 'c';
      const d = createScreen();
      d.name = 'd';
      home.screens = [a, b, c, d]; // per-map: a=0, b=1, c=2, d=3

      const beyond = createMap(2, 'Beyond');
      const f0 = createScreen();
      f0.name = 'f0';
      beyond.screens = [f0];

      project.maps = [away, home, beyond]; // flat before: e0=0, e1=1, a=2, b=3, c=4, d=5, f0=6

      const doorToC = { actorId: 0, x: 0, y: 0, props: { toScreen: 4, event: null } }; // -> c, old flat index
      const doorToF = { actorId: 0, x: 0, y: 0, props: { toScreen: 6, event: null } }; // -> f0, old flat index, a map AFTER Home
      e0.entities = [doorToC, doorToF];

      // Code review round 1, finding 3: start and title must sit on
      // DIFFERENT screens with DIFFERENT correct results, or an
      // implementation that computes one relocation and assigns it to both
      // fields passes anyway:
      //   const next = perMapTranslate(oldStartScreen);
      //   if (wasStartHere) startScreen = next === DROPPED_SCREEN ? 0 : next;
      //   if (wasTitleHere) titleScreen = next === DROPPED_SCREEN ? 0 : next;
      // -- the reviewer's own operand-alias sabotage. start sits on c (per-map
      // 2 -> 3), title sits on d (per-map 3 -> 4); the alias above would
      // compute c's own relocation (3) and wrongly assign it to titleScreen
      // too, instead of d's (4).
      project.project.startMap = 1; // Home
      project.project.startScreen = 2; // c, at its OLD per-map index
      project.project.titleMap = 1; // Home
      project.project.titleScreen = 3; // d, at its OWN, DIFFERENT old per-map index

      growOrShrinkMap(project, 1, 3, 2);

      assert.equal(home.gridW, 3);
      assert.equal(home.gridH, 2);
      assert.equal(home.screens.length, 6);
      assert.equal(home.screens[3], c, "c's own object identity lands at the new per-map index 3, design's own shape");
      assert.equal(home.screens[4], d, "d's own object identity lands at the new per-map index 4");

      assert.equal(
        project.project.startScreen,
        3,
        "startScreen named c by its OLD per-map index (2) -- the grow relocates it to c's new per-map index (3). " +
          "On this fixture (Home at nonzero flat base 2), an implementation that mistakenly translates through " +
          'flat-space instead of per-map-space would land on 2 (canonicalizeFlat(2, 7) resolves to a, not c) -- ' +
          'a real, in-range, distinguishably WRONG value, not merely a range-clamp escape'
      );
      assert.equal(
        project.project.titleScreen,
        4,
        "titleScreen named d by its OWN OLD per-map index (3), DIFFERENT from startScreen's -- the grow relocates " +
          "it to d's new per-map index (4). An implementation that reuses startScreen's own relocated value (3) " +
          "for titleScreen too (the operand-alias sabotage) would leave this at 3, not 4"
      );
      assert.equal(project.project.startMap, 1, 'a resize never touches startMap -- the map itself still exists');
      assert.equal(project.project.titleMap, 1, 'a resize never touches titleMap -- the map itself still exists');

      const flatNow = flatScreens(project);
      const flatIndexOf = (screen) => flatNow.findIndex((entry) => entry.screen === screen);
      assert.equal(doorToC.props.toScreen, flatIndexOf(c), "the door's own flat-space reference to c also relocates");
      assert.equal(
        doorToF.props.toScreen,
        flatIndexOf(f0),
        "Beyond's own flat base shifted (Home grew by 2 screens) -- the door to f0, AFTER Home, follows it project-wide"
      );
    }

    // Shrink: 2x2 -> 1x1, only 'a' survives; b, c, d are all dropped. Both
    // startScreen and titleScreen point at different dropped cells, so a
    // wrong implementation that only handles one of the two fields cannot
    // pass by accident. A flat-space reference from elsewhere in the
    // project to a dropped cell is also exercised here -- the flat-space
    // DROPPED_SCREEN/FALLBACK_SCREEN path, distinct from the per-map
    // fallback startScreen/titleScreen use. Home again sits second, not
    // first, for the identical reason as the grow fixture above.
    {
      const project = createProject('Resize shrink');
      const away = createMap(0, 'Away');
      const e0 = createScreen();
      e0.name = 'e0';
      const e1 = createScreen();
      e1.name = 'e1';
      away.screens = [e0, e1];

      const home = createMap(1, 'Home'); // the resized map -- flat base 2, not 0
      home.gridW = 2;
      home.gridH = 2;
      const a = createScreen();
      a.name = 'a';
      const b = createScreen();
      b.name = 'b';
      const c = createScreen();
      c.name = 'c';
      const d = createScreen();
      d.name = 'd';
      home.screens = [a, b, c, d];

      const beyond = createMap(2, 'Beyond');
      const f0 = createScreen();
      f0.name = 'f0';
      beyond.screens = [f0];

      project.maps = [away, home, beyond]; // flat before: e0=0, e1=1, a=2, b=3, c=4, d=5, f0=6

      const doorToB = { actorId: 0, x: 0, y: 0, props: { toScreen: 3, event: null } }; // -> b, about to be dropped
      const doorToF = { actorId: 0, x: 0, y: 0, props: { toScreen: 6, event: null } }; // -> f0, survives, base shifts down
      e0.entities = [doorToB, doorToF];

      project.project.startMap = 1; // Home
      project.project.startScreen = 1; // b, dropped, per-map index -- a flat-vs-per-map bug would misread this
      // as flat index 1, which is Away's own e1, a real surviving screen unrelated to Home entirely
      project.project.titleMap = 1; // Home
      project.project.titleScreen = 2; // c, dropped, a DIFFERENT dropped cell than startScreen's -- a flat-vs-per-map
      // bug would misread this as flat index 2, which is Home's own 'a', KEPT by the shrink but at the wrong slot

      growOrShrinkMap(project, 1, 1, 1);

      assert.equal(home.gridW, 1);
      assert.equal(home.gridH, 1);
      assert.equal(home.screens.length, 1);
      assert.equal(home.screens[0], a);

      assert.equal(
        project.project.startScreen,
        0,
        'startScreen named a dropped cell (per-map) -- falls back to per-map position 0, not the flat-space ' +
          "misreading (1) that would resolve to Away's own e1, a real, surviving, unrelated screen"
      );
      assert.equal(
        project.project.titleScreen,
        0,
        'titleScreen named a DIFFERENT dropped cell -- also falls back to per-map position 0, not the ' +
          "flat-space misreading (2) that would resolve to Home's own kept screen 'a' at the wrong per-map slot"
      );

      const flatNow = flatScreens(project);
      const flatIndexOf = (screen) => flatNow.findIndex((entry) => entry.screen === screen);
      assert.equal(
        doorToB.props.toScreen,
        FALLBACK_SCREEN(project),
        "a project-wide reference to a screen the shrink dropped redirects to FALLBACK_SCREEN, the flat-space " +
          'path, independent of the per-map fallback startScreen/titleScreen use'
      );
      assert.equal(
        doorToF.props.toScreen,
        flatIndexOf(f0),
        "Beyond's own flat base shifted down (Home shrank by 3 screens) -- the surviving door to f0 follows it"
      );
    }
  }
);

// §11 test 22
test(
  'auditDroppedReferences counts surviving REFERENCES, not discarded screens -- the two numbers provably ' +
    'disagree, and a reference living on its own soon-to-be-discarded screen is excluded',
  () => {
    // (a) delete a map with 5 screens and zero incoming references: the
    // audit must report 0, not 5 -- the exact shape of round 1's own
    // category error (counting screens the translate would drop, not
    // references that would resolve to DROPPED_SCREEN).
    {
      const project = createProject('Audit delete zero refs');
      const doomed = createMap(0, 'Doomed');
      doomed.screens = [createScreen(), createScreen(), createScreen(), createScreen(), createScreen()];
      const other = createMap(1, 'Other');
      other.screens = [createScreen()]; // no entities at all -- nothing references anything
      project.maps = [doomed, other];

      const translate = buildDeleteMapTranslate(project, 0);
      const discarded = new Set(doomed.screens);
      assert.equal(auditDroppedReferences(project, translate, discarded), 0, '5 discarded screens, 0 references -- the audit must report 0');
    }

    // (b) delete a map with exactly 1 screen but TEN distinct incoming
    // doors/warps, split across placed entities AND common events: the
    // audit must report 10, not 1. Code review round 1, finding 4: widened
    // beyond the original all-top-level-door shape, which left a wrong audit
    // that only ever scans `entity.props.toScreen` on map screens and only
    // top-level `page.commands` in common events indistinguishable from the
    // real one (it would still return exactly 10 here). This fixture now
    // also exercises: a dropped-target Warp nested under a Branch on a
    // SURVIVING screen; one nested under a Choice option on a SURVIVING
    // screen; a NESTED (branch) common-event Warp, not only a top-level one;
    // and a Warp on the DISCARDED screen itself, whose exclusion must keep
    // the count at 10 rather than 11 or 12 -- proving the exclusion guard
    // covers the Warp walk, not only the door check.
    {
      const project = createProject('Audit delete ten refs');
      const doomed = createMap(0, 'Doomed');
      const target = createScreen();
      // A reference living ON the discarded screen itself -- both a door AND
      // a nested warp, each targeting the screen's own (about to be deleted)
      // flat position. Both would independently register as DROPPED_SCREEN
      // if evaluated, so if the exclusion guard were missing (or only
      // applied to the door check, not the warp walk), the count below would
      // read 11 or 12, not 10.
      target.entities = [{
        actorId: 0, x: 0, y: 0,
        props: {
          toScreen: 0, // self -- would be DROPPED_SCREEN if this screen weren't itself excluded
          event: {
            pages: [{
              cond: { type: 'none', arg: 0 },
              commands: [{ op: 'warp', screen: 0, x: 0, y: 0 }] // self -- same reasoning, the Warp branch specifically
            }]
          }
        }
      }];
      doomed.screens = [target];

      const other = createMap(1, 'Other');
      const plainDoorScreens = Array.from({ length: 6 }, () => {
        const screen = createScreen();
        screen.entities = [{ actorId: 0, x: 0, y: 0, props: { toScreen: 0, event: null } }]; // -> target, raw flat 0
        return screen;
      });
      const branchScreen = createScreen(); // a dropped-target Warp nested under a Branch, on a SURVIVING screen
      const choiceScreen = createScreen(); // a dropped-target Warp nested under a Choice option, on a SURVIVING screen
      other.screens = [...plainDoorScreens, branchScreen, choiceScreen];
      const branchFlat = other.screens.length - 2; // computed structurally, never hardcoded against the array shape
      const choiceFlat = other.screens.length - 1;
      branchScreen.entities = [{
        actorId: 0, x: 0, y: 0,
        props: {
          toScreen: 1 + branchFlat, // self -- a real, surviving target, so the door check contributes nothing extra
          event: {
            pages: [{
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'warp', screen: 0, x: 0, y: 0 }], else: [] } // -> target
              ]
            }]
          }
        }
      }];
      choiceScreen.entities = [{
        actorId: 0, x: 0, y: 0,
        props: {
          toScreen: 1 + choiceFlat, // self -- a real, surviving target, so the door check contributes nothing extra
          event: {
            pages: [{
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'choice', options: [{ text: 'Go', commands: [{ op: 'warp', screen: 0, x: 0, y: 0 }] }] } // -> target
              ]
            }]
          }
        }
      }];
      project.maps = [doomed, other];

      project.commonEvents = [
        {
          id: 0,
          name: 'Common top-level',
          event: {
            pages: [{
              cond: { type: 'none', arg: 0 },
              commands: [{ op: 'warp', screen: 0, x: 0, y: 0 }] // -> target, raw flat 0, top-level
            }]
          }
        },
        {
          id: 1,
          name: 'Common nested',
          event: {
            pages: [{
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'warp', screen: 0, x: 0, y: 0 }], else: [] } // -> target, nested
              ]
            }]
          }
        }
      ];

      // 6 plain doors + 1 branch-nested warp + 1 choice-nested warp on Other,
      // + 1 top-level and 1 nested common-event warp = 10. Target's own
      // self-referential door+warp are excluded entirely (its own screen is
      // discarded), so they contribute 0, not 2.
      const translate = buildDeleteMapTranslate(project, 0);
      const discarded = new Set(doomed.screens);
      assert.equal(
        auditDroppedReferences(project, translate, discarded),
        10,
        '1 discarded screen, 10 references (6 doors + branch-nested + choice-nested + top-level common-event + ' +
          "nested common-event) -- the audit must report 10, and the discarded screen's own door+warp must not " +
          'inflate it to 11 or 12'
      );
    }

    // (c) a reference whose OWN screen is inside the discarded set is
    // excluded entirely -- it leaves with its own screen, not "redirected".
    {
      const project = createProject('Audit delete own-screen excluded');
      const doomed = createMap(0, 'Doomed');
      const sA = createScreen();
      const sB = createScreen();
      sA.entities = [{ actorId: 0, x: 0, y: 0, props: { toScreen: 1, event: null } }]; // sA -> sB, BOTH discarded
      doomed.screens = [sA, sB];

      const survivor = createMap(1, 'Survivor');
      const sC = createScreen();
      sC.entities = [{ actorId: 0, x: 0, y: 0, props: { toScreen: 0, event: null } }]; // sC (survives) -> sA, discarded
      survivor.screens = [sC];

      project.maps = [doomed, survivor];

      const translate = buildDeleteMapTranslate(project, 0);
      const discarded = new Set([sA, sB]);
      assert.equal(
        auditDroppedReferences(project, translate, discarded),
        1,
        "only sC's reference counts -- sA's own reference to sB is excluded because sA itself is discarded"
      );
    }

    // Repeat (a) and (b) against Resize-shrink's own discardedScreens set,
    // built the same way growOrShrinkMap's dry run builds it.
    {
      // (a) again: a shrink dropping 5 screens, 0 incoming references.
      const project = createProject('Audit resize zero refs');
      const home = createMap(0, 'Home');
      home.gridW = 6;
      home.gridH = 1;
      home.screens = Array.from({ length: 6 }, () => createScreen());
      project.maps = [home];

      const oldScreens = home.screens;
      const newScreens = [oldScreens[0]]; // shrink to 1x1 -- keep only the first
      const translate = buildResizeTranslate(project, 0, newScreens);
      const discarded = new Set(oldScreens.filter((s) => !newScreens.includes(s)));
      assert.equal(discarded.size, 5);
      assert.equal(auditDroppedReferences(project, translate, discarded), 0, '5 discarded screens, 0 references -- the audit must report 0');
    }
    {
      // (b) again: a shrink dropping exactly 1 screen, 10 incoming references.
      const project = createProject('Audit resize ten refs');
      const home = createMap(0, 'Home');
      home.gridW = 2;
      home.gridH = 1;
      const kept = createScreen();
      const dropped = createScreen();
      home.screens = [kept, dropped]; // flat: kept=0, dropped=1

      const other = createMap(1, 'Other');
      other.screens = Array.from({ length: 8 }, () => {
        const screen = createScreen();
        screen.entities = [{ actorId: 0, x: 0, y: 0, props: { toScreen: 1, event: null } }]; // -> dropped, raw flat 1
        return screen;
      });
      project.maps = [home, other];

      project.commonEvents = Array.from({ length: 2 }, (_, i) => ({
        id: i,
        name: `Common ${i}`,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'warp', screen: 1, x: 0, y: 0 }] // -> dropped, raw flat 1
          }]
        }
      }));

      const oldScreens = home.screens;
      const newScreens = [kept]; // shrink to 1x1 -- drop the second screen
      const translate = buildResizeTranslate(project, 0, newScreens);
      const discarded = new Set(oldScreens.filter((s) => !newScreens.includes(s)));
      assert.equal(discarded.size, 1);
      assert.equal(
        auditDroppedReferences(project, translate, discarded),
        10,
        '1 discarded screen, 10 references (8 doors + 2 common-event warps) -- the audit must report 10'
      );
    }
  }
);

// ---------------------------------------------------------------------------
// ROADMAP item 7 -- map organization and reuse, phase 4
// (handoff-maporg/design-maporg.md §6.2/§6.2.1/§6.9.1)
//
// Duplicate Screen: the most intricate operation in this design. Two
// independently reviewable risks share one UI entry point -- §6.9.1's
// index-space correction (a naive reuse of growOrShrinkMap's generic
// translate mis-routes a self-reference the moment growth actually
// relocates the source) and §6.2.1's four-question all-maps-full fallback.
// Per this slice's own house rule: every operation is a commit-free core in
// shared/project.js (duplicateScreenViaGrowthCore, duplicateScreenIntoNewMapCore)
// that both the renderer's single store.commit and the tests below call --
// no test-local mirror of a renderer function.
//
// Cross-phase decision (declared, per the brief's own explicit ask): design
// §6.2.1 says the new map's metadata copy includes `folder`, but `folder`
// is item 7 phase 5's own field (design §8) and does not exist in this tree
// yet. This phase copies only the metadata that exists today (tilesetId,
// songId, battleSkyTile, battleGroundTile, encounters) and deliberately
// omits `folder` -- see the phase 4 report for the full reasoning and the
// exact note phase 5's brief must carry as a result.
// ---------------------------------------------------------------------------

// §11 test 11
test(
  'duplicate screen naming: an auto-suffixed non-empty name avoids §4.3\'s collision (verified against ' +
    'resolveStartAt, not merely a cosmetic string check), and an unnamed screen stays unnamed with no §9 warning',
  () => {
    // (a) a named screen
    {
      const project = createProject('Screen naming a');
      const map = createMap(0, 'Home');
      const s0 = createScreen();
      s0.name = 'Boss Room';
      map.screens = [s0]; // 1x1 -- room to grow
      project.maps = [map];

      const remembered = { mapName: 'Home', screenIndex: 0, screenName: 'Boss Room', x: 0, y: 0 };
      const before = resolveStartAt(remembered, project);
      assert.equal(before.ok, true, 'sanity: the scenario resolves before duplicating at all');

      const { cloneScreen } = duplicateScreenViaGrowthCore(project, 0, s0);
      assert.equal(cloneScreen.name, 'Boss Room copy', 'the copy is auto-suffixed, scoped to the destination map');

      const after = resolveStartAt(remembered, project);
      assert.equal(
        after.ok,
        true,
        "resolveStartAt must still resolve after duplicating -- the copy's own name must not collide with the source's"
      );
    }

    // (b) an unnamed screen
    {
      const project = createProject('Screen naming b');
      const map = createMap(0, 'Home');
      const s0 = createScreen(); // name: '' by default
      map.screens = [s0];
      project.maps = [map];

      const { cloneScreen } = duplicateScreenViaGrowthCore(project, 0, s0);
      assert.equal(
        cloneScreen.name,
        '',
        "an unnamed screen's copy stays unnamed -- never synthesized into a non-empty name, which would " +
          'manufacture a collision-prone identity where none was ever authored'
      );

      const problems = validateProject(project);
      assert.ok(
        !problems.some((p) => /screen name.*used more than once/i.test(p.message)),
        "two same-map screens both named '' must not trigger the §9 duplicate-name warning -- empty names are " +
          'excluded from that count by construction'
      );
    }
  }
);

// §11 test 12
test(
  'duplicate screen: no blank-cell reuse exists -- the grid always grows, and a pre-existing blank cell stays ' +
    'exactly createScreen()-shaped, never silently claimed',
  () => {
    const project = createProject('Duplicate screen no blank reuse');
    const map = createMap(0, 'Home');
    map.gridW = 2;
    map.gridH = 2;
    const a = createScreen();
    a.name = 'a';
    a.metatiles[0] = 5; // real, non-default content -- proves the CLONE actually holds a's own content
    const b = createScreen();
    b.name = 'b';
    b.metatiles[0] = 9; // real, non-default content -- b must not be even loosely blank-shaped itself, or a sabotage
    // that reuses "the first blank-looking cell" (a looser check than design's own full content-equality
    // one) could silently pick b instead of the ACTUAL blank cell this fixture means to protect, and this
    // test's own assertions -- scoped to `blank` alone -- would never notice
    const blank = createScreen(); // stays exactly createScreen()-shaped -- a real, referenceable screen, not free real estate
    const d = createScreen();
    d.name = 'd';
    map.screens = [a, b, blank, d]; // per-map: a=0, b=1, blank=2, d=3
    project.maps = [map]; // single map -- flat === per-map here

    const doorToBlank = { actorId: 0, x: 0, y: 0, props: { toScreen: 2, event: null } }; // -> blank, OLD flat index
    d.entities = [doorToBlank];

    const { cloneScreen } = duplicateScreenViaGrowthCore(project, 0, a);

    assert.equal(map.gridW, 3, 'the grid grew (2x2 -> 3x2), never reusing the blank cell in place');
    assert.equal(map.gridH, 2);
    assert.equal(map.screens.length, 6);
    assert.ok(map.screens.includes(blank), "the pre-existing blank cell's own object identity survives");
    assert.deepEqual(
      blank,
      createScreen(),
      "the pre-existing blank cell is STILL exactly createScreen()-shaped afterward -- untouched, not silently " +
        "claimed by the duplicate's own content"
    );
    assert.notEqual(cloneScreen, blank, 'the clone is a newly-grown cell, a distinct object from the pre-existing blank one');
    assert.equal(cloneScreen.metatiles[0], 5, "the clone genuinely holds a's own content");

    const flatNow = flatScreens(project);
    const flatIndexOf = (screen) => flatNow.findIndex((entry) => entry.screen === screen);
    assert.equal(
      doorToBlank.props.toScreen,
      flatIndexOf(blank),
      "the door to the pre-existing blank cell still names IT (by object identity, tracked through the resize's " +
        "own per-map diff), never the newly-grown cell that received the duplicate's content"
    );
  }
);

// §11 test 13
test(
  "cross-tileset duplicate returns a warning from the operation's own return value, never from " +
    'checkCapacity/validateProject',
  () => {
    const project = createProject('Cross tileset duplicate');
    project.cartridge.mapper = 3; // CNROM -- allows more than one tileset
    project.tilesets.push(createTileset(1, 'Dungeon set'));

    const sourceMap = createMap(0, 'Source');
    sourceMap.tilesetId = 0;
    const sourceScreen = sourceMap.screens[0];

    const targetMap = createMap(1, 'Target');
    targetMap.tilesetId = 1; // DIFFERENT tileset than the source map
    project.maps = [sourceMap, targetMap]; // targetMap has room (1x1 < 4x4)

    const { cloneScreen, warning } = duplicateScreenViaGrowthCore(project, 1, sourceScreen);

    assert.notEqual(cloneScreen, undefined);
    assert.equal(
      warning,
      'This map uses a different tileset — the copied art may not look the same here.',
      "the operation's own return value carries the warning when the destination map's tilesetId differs " +
        'from the source map\'s'
    );

    const problems = checkCapacity(project).problems;
    assert.ok(
      !problems.some((p) => /different tileset|copied art|look the same/i.test(p.message)),
      'the information must not survive into checkCapacity/validateProject output at all -- not even as a ' +
        'warning -- since nothing in the schema records where a metatile id came from'
    );

    // Code review round 1, finding 5: the same-tileset NEGATIVE control.
    // Without this, an implementation that returns CROSS_TILESET_WARNING
    // unconditionally -- regardless of whether the destination's tilesetId
    // actually differs -- passes the positive case above outright.
    const sameTilesetProject = createProject('Same tileset duplicate');
    sameTilesetProject.cartridge.mapper = 3;
    sameTilesetProject.tilesets.push(createTileset(1, 'Unused set'));
    const sourceMap2 = createMap(0, 'Source2');
    sourceMap2.tilesetId = 0;
    const sourceScreen2 = sourceMap2.screens[0];
    const targetMap2 = createMap(1, 'Target2');
    targetMap2.tilesetId = 0; // the SAME tileset as the source map
    sameTilesetProject.maps = [sourceMap2, targetMap2];

    const { warning: sameTilesetWarning } = duplicateScreenViaGrowthCore(sameTilesetProject, 1, sourceScreen2);
    assert.equal(
      sameTilesetWarning,
      null,
      'an ordinary same-tileset duplicate must return no warning at all, not merely a falsy-but-truthy string'
    );
  }
);

// §11 test 23
test(
  "duplicateScreenViaGrowthCore: a forced width-grow relocates the SOURCE, and the CLONE's own self-references " +
    "route to the clone itself, never to the source's new position",
  () => {
    const project = createProject('Forced width-grow duplicate');
    const home = createMap(0, 'Home');
    home.gridW = 2;
    home.gridH = 2;
    const p0 = createScreen();
    p0.name = 'p0';
    const p1 = createScreen();
    p1.name = 'p1';
    const p2 = createScreen();
    p2.name = 'p2';
    // Code review round 1, finding 2: the source sits at per-map index 3
    // (row 1, col 1), not 2 -- under the same 2x2 -> 3x2 growth this makes
    // the raw self-reference (3), the clone's own new flat position (2),
    // and the relocated original's new flat position (4) three genuinely
    // DISTINGUISHABLE values. At index 2, the clone happened to land at
    // exactly the source's own OLD flat index too, so a sabotage that
    // simply leaves a self-reference's raw value untouched (never routing
    // it anywhere) coincidentally produced the correct answer -- invisible
    // to that fixture. Index 3 rules that out: "untouched" (3), "clone" (2)
    // and "relocated original" (4) can no longer agree by accident.
    const source = createScreen();
    source.name = 'source';
    home.screens = [p0, p1, p2, source]; // per-map: p0=0, p1=1, p2=2, source=3

    const away = createMap(1, 'Away');
    const e0 = createScreen();
    e0.name = 'e0';
    away.screens = [e0];

    project.maps = [home, away]; // flat before: p0=0, p1=1, p2=2, source=3, e0=4

    const selfDoor = { actorId: 0, x: 0, y: 0, props: { toScreen: 3, event: null } }; // -> source itself
    const externalDoor = { actorId: 0, x: 0, y: 0, props: { toScreen: 4, event: null } }; // -> e0
    const eventEntity = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'warp', screen: 3, x: 0, y: 0 }, // top-level, self
              {
                op: 'branch',
                cond: { type: 'none', arg: 0 },
                then: [{ op: 'warp', screen: 4, x: 0, y: 0 }], // nested, external
                else: []
              },
              { op: 'choice', options: [{ text: 'Go', commands: [{ op: 'warp', screen: 3, x: 0, y: 0 }] }] } // nested, self
            ]
          }]
        }
      }
    };
    source.entities = [selfDoor, externalDoor, eventEntity];

    // Code review round 1, finding 4: non-default art and a real binding, so
    // a shallow clone that shares metatiles/boundTiles with the source
    // (`{ ...sourceScreen, entities: structuredClone(sourceScreen.entities) }`
    // -- everything else, art included, left aliased) is discriminable.
    source.metatiles[0] = 7;
    source.boundTiles = [{ row: 0, col: 0, switchId: 0, metatileId: 3 }];

    assert.equal(project.project.saveCompatToken, 0);

    const { cloneScreen } = duplicateScreenViaGrowthCore(project, 0, source);

    assert.equal(cloneScreen.metatiles[0], 7, "the clone's own metatiles genuinely hold the source's own content");
    assert.deepEqual(cloneScreen.boundTiles, [{ row: 0, col: 0, switchId: 0, metatileId: 3 }], "the clone's own boundTiles genuinely hold the source's own content");
    assert.notEqual(cloneScreen.metatiles, source.metatiles, 'distinct array, not aliased with the source');
    assert.notEqual(cloneScreen.boundTiles, source.boundTiles, 'distinct array, not aliased with the source');
    cloneScreen.metatiles[0] = 99; // mutate the CLONE's own art after duplication
    cloneScreen.boundTiles[0].metatileId = 55; // mutate a nested binding object too
    assert.equal(source.metatiles[0], 7, "mutating the clone's own art must not affect the SOURCE's");
    assert.equal(
      source.boundTiles[0].metatileId,
      3,
      "mutating the clone's own binding must not affect the SOURCE's nested binding object either"
    );

    assert.equal(home.gridW, 3);
    assert.equal(home.gridH, 2);
    assert.equal(home.screens.length, 6);
    assert.equal(
      home.screens[4],
      source,
      "the SOURCE's own object identity relocated to per-map index 4, design's own worked trace ([a,b,c,d] -> [a,b,new,c,d,new]) one row down"
    );
    assert.notEqual(cloneScreen, source, 'the clone is a distinct screen object from the (relocated) original');

    const flatNow = flatScreens(project);
    const flatIndexOf = (screen) => flatNow.findIndex((entry) => entry.screen === screen);
    const cloneFlat = flatIndexOf(cloneScreen);
    const sourceFlat = flatIndexOf(source);
    const e0Flat = flatIndexOf(e0);
    assert.notEqual(cloneFlat, sourceFlat, 'the clone and the relocated original occupy different, distinguishable positions');
    // The three candidate answers a plausible wrong implementation could
    // produce -- the raw, untranslated value (3); the clone's own new
    // position (2, correct); the relocated original's own new position
    // (4) -- are pairwise distinct, so none of the three sabotages below
    // can coincide with the correct answer by accident.
    assert.equal(cloneFlat, 2);
    assert.equal(sourceFlat, 4);
    assert.notEqual(cloneFlat, 3, 'sanity: the raw stored value (3) must not itself equal the correct answer');
    assert.notEqual(sourceFlat, 3, 'sanity: the raw stored value (3) must not itself equal the relocated-original answer either');

    // The CLONE's own self-references route to the CLONE's own new flat
    // position, never to the (also-relocated) ORIGINAL's, and never left at
    // their own raw, untranslated value -- precisely the two defects a
    // naive reuse of growOrShrinkMap's generic translate, or a translate
    // that simply leaves a self-reference's raw value alone, would each
    // produce.
    const cloneSelfDoor = cloneScreen.entities[0];
    const cloneExternalDoor = cloneScreen.entities[1];
    const cloneEvent = cloneScreen.entities[2];
    assert.equal(cloneSelfDoor.props.toScreen, cloneFlat, "the clone's own self-door routes to the CLONE itself");
    assert.notEqual(cloneSelfDoor.props.toScreen, 3, '...never left at its own raw, untranslated value');
    assert.notEqual(cloneSelfDoor.props.toScreen, sourceFlat, '...never to the relocated ORIGINAL');
    assert.equal(cloneExternalDoor.props.toScreen, e0Flat, "the clone's own external door still resolves to e0, unchanged in content");
    assert.equal(
      cloneEvent.props.event.pages[0].commands[0].screen,
      cloneFlat,
      "the clone's own top-level warp (self) routes to the clone itself"
    );
    assert.equal(
      cloneEvent.props.event.pages[0].commands[1].then[0].screen,
      e0Flat,
      "the clone's own branch-then-nested warp (external) still resolves to e0"
    );
    assert.equal(
      cloneEvent.props.event.pages[0].commands[2].options[0].commands[0].screen,
      cloneFlat,
      "the clone's own choice-nested warp (self) also routes to the clone itself"
    );

    // The ORIGINAL source's own references: correctly relocated to ITS OWN
    // new position by the ordinary generic growOrShrinkMap walk, run BEFORE
    // the clone's content ever existed -- proving that walk still works
    // correctly on the untouched original, unaffected by the clone's
    // presence.
    assert.equal(selfDoor.props.toScreen, sourceFlat, "the ORIGINAL's own self-door still names itself, at its own new position");
    assert.notEqual(selfDoor.props.toScreen, cloneFlat, "...never the clone's position");
    assert.equal(externalDoor.props.toScreen, e0Flat, "the ORIGINAL's own external door still resolves to e0");
    assert.equal(
      eventEntity.props.event.pages[0].commands[0].screen,
      sourceFlat,
      "the ORIGINAL's own top-level warp still names itself"
    );
    assert.equal(
      eventEntity.props.event.pages[0].commands[1].then[0].screen,
      e0Flat,
      "the ORIGINAL's own branch-nested warp still resolves to e0"
    );
    assert.equal(
      eventEntity.props.event.pages[0].commands[2].options[0].commands[0].screen,
      sourceFlat,
      "the ORIGINAL's own choice-nested warp still names itself"
    );

    // growth-routed duplicate is mechanically a resize, so it redraws
    // saveCompatToken unconditionally -- deterministic here, not merely
    // probable: drawSaveCompatToken's own range is [1, 0xffff] and can
    // never draw 0, so a fresh project's default 0 is guaranteed to change.
    assert.notEqual(
      project.project.saveCompatToken,
      0,
      'growth-routed duplicate redraws saveCompatToken -- it is, mechanically, a resize'
    );
  }
);

// growthTarget policy coverage -- not a §11-numbered design test, since
// growthTarget's own direction policy is this phase's own declared
// deviation (design-maporg.md only specifies "grows by one row or column,"
// never which). Code review round 1, finding 3: every growth fixture
// elsewhere in this phase happens to be 1x1 or 2x2, so all of them take the
// width-tie branch. An implementation hardcoded to `{ newWidth: gridW + 1,
// newHeight: gridH }` passes every one of them, and from a valid 4x1 map --
// which the UI still considers to have room -- produces an invalid 5x1 grid
// beyond LIMITS.mapGrid.
test(
  'duplicateScreenViaGrowthCore: growthTarget grows the SMALLER dimension (never always width), and never ' +
    'exceeds LIMITS.mapGrid on either axis',
  () => {
    const project = createProject('Width-dominant growth');
    const home = createMap(0, 'Home');
    home.gridW = LIMITS.mapGrid; // 4 -- already at the cap on this axis; a hardcoded width-grow would overflow it
    home.gridH = 1; // the only axis with room
    home.screens = Array.from({ length: home.gridW * home.gridH }, () => createScreen());
    const source = home.screens[0];
    project.maps = [home];

    duplicateScreenViaGrowthCore(project, 0, source);

    assert.equal(home.gridW, LIMITS.mapGrid, "width did not grow -- it was already at the cap, and a correct " +
      "policy grows the map's own SMALLER dimension, not always width");
    assert.equal(home.gridH, 2, 'height grew by one -- the only axis with room');
    assert.ok(home.gridW <= LIMITS.mapGrid, 'width must never exceed LIMITS.mapGrid');
    assert.ok(home.gridH <= LIMITS.mapGrid, 'height must never exceed LIMITS.mapGrid');
    assert.equal(home.screens.length, LIMITS.mapGrid * 2);
  }
);

// §11 test 27
test(
  'the every-map-4x4 fallback: duplicateScreenIntoNewMapCore\'s four observable choices, each proven ' +
    'independently, including that the clone and its mutable children are genuinely distinct objects',
  () => {
    const project = createProject('Every map full fallback');
    project.tilesets.push(createTileset(1, 'Dungeon set'));
    project.songs.push(createSong('Theme'));

    const dungeon = createMap(0, 'Dungeon');
    dungeon.gridW = 4;
    dungeon.gridH = 4;
    dungeon.screens = Array.from({ length: 16 }, () => createScreen());
    dungeon.tilesetId = 1; // non-default, so copying is a real, discriminating check
    dungeon.songId = 0;
    dungeon.battleSkyTile = 5;
    dungeon.battleGroundTile = 7;
    dungeon.encounters = { rate: 30, actorIds: [2, 5] };
    // Item 7 phase 5, design §8: the obligation phase 4 handed forward --
    // folder did not exist when this test was first written, so a non-null
    // value here is what actually exercises the newMap.folder copy this
    // phase adds; a fixture that never sets it could not catch its absence.
    dungeon.folder = 'Dungeons';
    const source = dungeon.screens[0];
    source.name = 'Boss Room'; // non-empty -- actually exercises nameForDuplicateScreen's non-empty branch
    // Code review round 1, finding 4: non-default art and a real binding, so
    // a shallow clone that shares metatiles/boundTiles with the source is
    // discriminable on this route too.
    source.metatiles[0] = 7;
    source.boundTiles = [{ row: 0, col: 0, switchId: 0, metatileId: 3 }];

    // A second, DIFFERENTLY-NAMED existing map already claiming the exact
    // string nameForNewMapFromSource would otherwise produce
    // ("Dungeon copy"), forcing the numbered " copy 2" branch -- not merely
    // asserted blindly. Also full (4x4), and also this fixture's own
    // external target for the source's own external references.
    const dungeonCopy = createMap(1, 'Dungeon copy');
    dungeonCopy.gridW = 4;
    dungeonCopy.gridH = 4;
    dungeonCopy.screens = Array.from({ length: 16 }, () => createScreen());
    project.maps = [dungeon, dungeonCopy]; // every map genuinely 4x4 -- flat: dungeon 0-15, dungeonCopy 16-31

    // Four Warps in total on the source: one self and one external at the
    // top level, one self and one external nested inside a branch.
    const selfDoor = { actorId: 0, x: 0, y: 0, props: { toScreen: 0, event: null } }; // -> source itself
    const externalDoor = { actorId: 0, x: 0, y: 0, props: { toScreen: 16, event: null } }; // -> dungeonCopy.screens[0]
    const eventEntity = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'warp', screen: 0, x: 0, y: 0 }, // top-level, self
              { op: 'warp', screen: 16, x: 0, y: 0 }, // top-level, external
              {
                op: 'branch',
                cond: { type: 'none', arg: 0 },
                then: [{ op: 'warp', screen: 0, x: 0, y: 0 }], // nested, self
                else: [{ op: 'warp', screen: 16, x: 0, y: 0 }] // nested, external
              }
            ]
          }]
        }
      }
    };
    // Code review round 1, finding 1: a door to a NEIGHBOR screen in the
    // source's own original map -- neither the source screen itself, nor a
    // screen on a different map. This is the case the correct SINGLETON
    // source range ([sourceFlatIndex, sourceFlatIndex + 1)) and a wrong
    // WHOLE-SOURCE-MAP range ([sourceMapStart, sourceMapStart + sourceMap.
    // screens.length)) disagree on: every other "external" reference this
    // fixture already authors targets flat 16, the OTHER map entirely, which
    // both a correct and a whole-map-range implementation classify
    // identically (external either way). A same-map neighbor is the one
    // reference a whole-map-range bug would wrongly treat as "self" and
    // shift by the append delta.
    const neighborDoor = { actorId: 0, x: 0, y: 0, props: { toScreen: 1, event: null } }; // -> dungeon.screens[1], a neighbor, NOT the source
    source.entities = [selfDoor, externalDoor, eventEntity, neighborDoor];

    // Incoming references from elsewhere, already pointing AT the source --
    // proving the original stays reachable after the promotion.
    const incomingDoor = { actorId: 0, x: 0, y: 0, props: { toScreen: 0, event: null } }; // -> source
    dungeonCopy.screens[1].entities = [incomingDoor];
    const incomingWarpEntity = {
      actorId: 0, x: 0, y: 0,
      props: {
        toScreen: 0,
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'warp', screen: 0, x: 0, y: 0 }], else: [] } // -> source, nested
            ]
          }]
        }
      }
    };
    dungeonCopy.screens[2].entities = [incomingWarpEntity];

    // An out-of-range door elsewhere: pre-append flat count is 32
    // (16 + 16), so its effective target is canonicalizeFlat(255, 32) = 31
    // -- dungeonCopy's own last screen, a specific, known screen.
    const outOfRangeDoor = { actorId: 0, x: 0, y: 0, props: { toScreen: 255, event: null } };
    dungeonCopy.screens[3].entities = [outOfRangeDoor];

    assert.equal(project.project.saveCompatToken, 0);
    const sourceSnapshotBefore = structuredClone(source);

    const { newMap, cloneScreen } = duplicateScreenIntoNewMapCore(project, source);

    // The new map is genuinely 1x1.
    assert.equal(newMap.gridW, 1);
    assert.equal(newMap.gridH, 1);
    assert.equal(newMap.screens.length, 1);
    assert.equal(newMap.screens[0], cloneScreen);

    // Metadata copied from the SOURCE MAP, not createMap's own generic
    // defaults -- folder now included, item 7 phase 5's own obligation
    // from phase 4, closing the gap the phase-4 fixture (which never set
    // folder at all) could not catch.
    assert.equal(newMap.tilesetId, 1, "tilesetId copied from the source map, not createMap's own default (0)");
    assert.equal(newMap.songId, 0, "songId copied from the source map, not createMap's own default (null)");
    assert.equal(newMap.battleSkyTile, 5);
    assert.equal(newMap.battleGroundTile, 7);
    assert.deepEqual(newMap.encounters, { rate: 30, actorIds: [2, 5] }, 'encounters copied in CONTENT');
    assert.notEqual(newMap.encounters, dungeon.encounters, 'but not the same object reference -- structuredClone, not aliased');
    assert.equal(newMap.folder, 'Dungeons', "folder copied from the source map, not createMap's own default (null)");

    // The new map's own name: nameForNewMapFromSource's own collision-
    // checked output, forced onto the numbered branch by the fixture's own
    // "Dungeon copy" map.
    assert.equal(newMap.name, 'Dungeon copy 2');

    // The screen's own name, carried unsuffixed into the new map's own
    // (always-empty) namespace.
    assert.equal(cloneScreen.name, 'Boss Room');

    const flatNow = flatScreens(project);
    const flatIndexOf = (screen) => flatNow.findIndex((entry) => entry.screen === screen);
    const cloneFlat = flatIndexOf(cloneScreen);
    const externalFlat = flatIndexOf(dungeonCopy.screens[0]);

    // Each of the four Warps individually, on the CLONE.
    const cloneSelfDoor = cloneScreen.entities[0];
    const cloneExternalDoor = cloneScreen.entities[1];
    const cloneEvent = cloneScreen.entities[2];
    assert.equal(cloneSelfDoor.props.toScreen, cloneFlat, "the clone's own self-door resolves to the clone's own singleton position");
    assert.equal(cloneExternalDoor.props.toScreen, externalFlat, "the clone's own external door resolves, unchanged in content, to the same external screen");
    assert.equal(cloneEvent.props.event.pages[0].commands[0].screen, cloneFlat, "the clone's own top-level self-warp resolves to the clone");
    assert.equal(cloneEvent.props.event.pages[0].commands[1].screen, externalFlat, "the clone's own top-level external-warp resolves, unchanged, to the external screen");
    assert.equal(
      cloneEvent.props.event.pages[0].commands[2].then[0].screen,
      cloneFlat,
      "the clone's own branch-then nested self-warp resolves to the clone"
    );
    assert.equal(
      cloneEvent.props.event.pages[0].commands[2].else[0].screen,
      externalFlat,
      "the clone's own branch-else nested external-warp resolves, unchanged, to the external screen"
    );

    // Code review round 1, finding 1: the clone's own copy of a door to a
    // NEIGHBOR in the source's own original map (dungeon.screens[1], not
    // the source screen itself) must stay aimed at that neighbor -- it is
    // external under the correct SINGLETON range. A whole-source-map-range
    // implementation would wrongly classify it as "self" (it falls inside
    // [0,16), the whole source map's own flat range) and shift it by the
    // append delta instead.
    const cloneNeighborDoor = cloneScreen.entities[3];
    assert.equal(
      cloneNeighborDoor.props.toScreen,
      flatIndexOf(dungeon.screens[1]),
      "the clone's own neighbor-door stays aimed at dungeon.screens[1] -- external under the singleton range, " +
        'not shifted by a whole-source-map-range bug'
    );

    // The pre-existing incoming door/warp still resolve to the ORIGINAL
    // screen's content, untouched -- the original stays reachable.
    const sourceFlat = flatIndexOf(source);
    assert.equal(incomingDoor.props.toScreen, sourceFlat, 'the pre-existing incoming door still names the ORIGINAL source screen');
    assert.equal(
      incomingWarpEntity.props.event.pages[0].commands[0].then[0].screen,
      sourceFlat,
      'the pre-existing incoming nested warp still names the ORIGINAL source screen'
    );

    // The pre-existing out-of-range door: its own pre-append effective
    // target (31), canonicalized -- never redirected to the new map's own
    // screen (which the append's own growth could otherwise make look
    // plausible if canonicalization ran against the wrong, POST-append count).
    assert.equal(outOfRangeDoor.props.toScreen, 31);

    // No saveCompatToken redraw -- append, screenCount already moves.
    assert.equal(project.project.saveCompatToken, 0, 'the all-maps-full fallback is an append -- it never redraws saveCompatToken');

    // No aliasing: reference inequality, AND the stronger behavioral proof.
    assert.notEqual(cloneScreen, source, 'the clone is a distinct screen object from the source');
    cloneScreen.entities[0].x += 1; // mutate the CLONE's own entity after duplication
    assert.equal(
      source.entities[0].x,
      sourceSnapshotBefore.entities[0].x,
      "mutating the clone's own entity must not affect the SOURCE's -- proving they are genuinely distinct objects, not aliased"
    );

    // Code review round 1, finding 4: the same no-aliasing proof, extended
    // to the screen's own mutable art/binding arrays -- a shallow clone
    // (`{ ...sourceScreen, entities: structuredClone(...) }`, leaving
    // metatiles/boundTiles shared with the source) passes every assertion
    // above and is only caught here.
    assert.equal(cloneScreen.metatiles[0], 7, "the clone's own metatiles genuinely hold the source's own content");
    assert.deepEqual(cloneScreen.boundTiles, [{ row: 0, col: 0, switchId: 0, metatileId: 3 }], "the clone's own boundTiles genuinely hold the source's own content");
    assert.notEqual(cloneScreen.metatiles, source.metatiles, 'distinct array, not aliased with the source');
    assert.notEqual(cloneScreen.boundTiles, source.boundTiles, 'distinct array, not aliased with the source');
    cloneScreen.metatiles[0] = 99; // mutate the CLONE's own art after duplication
    cloneScreen.boundTiles[0].metatileId = 55; // mutate a nested binding object too
    assert.equal(source.metatiles[0], 7, "mutating the clone's own art must not affect the SOURCE's");
    assert.equal(
      source.boundTiles[0].metatileId,
      3,
      "mutating the clone's own binding must not affect the SOURCE's nested binding object either"
    );
  }
);

// ---------------------------------------------------------------------------
// ROADMAP item 7 -- map organization and reuse, phase 5 (the last one)
// (handoff-maporg/design-maporg.md §6.3/§8/§10)
//
// Region copy/paste and folders -- the two remaining pieces of the design
// with no dependency on each other -- plus the closing draw-site census
// (test 26), which spans every operation this design defines and can only
// be completed now that all ten exist. Per this slice's own house rule:
// pasteRegionCore/buildRegionClip/clampPasteOrigin are the commit-free
// cores both the renderer's single store.commit and the tests below call.
// ---------------------------------------------------------------------------

// buildRegionClip -- the copy side of §6.3, not itself a §11-numbered test
// (14/15/16 all specify PASTE behavior; nothing in the design's own test
// plan names a dedicated copy-side test). Self-check finding: every fixture
// in this section originally constructed its own `clip` object as a literal,
// never actually calling buildRegionClip against a real screen -- meaning a
// bug in the copy-side reader itself (row/col swapped, the wrong screen
// read, boundTiles filtered with an off-by-one) would have passed every
// paste-focused fixture below, since none of them exercise the function
// that actually reads a rectangle off a screen. Closed directly.
test(
  "buildRegionClip reads a rectangle off a screen correctly -- metatiles row-major relative to the rectangle, " +
    'and only the boundTiles entries actually inside it, also made relative',
  () => {
    const project = createProject('Build region clip');
    const map = createMap(0, 'Home');
    map.tilesetId = 3;
    const screen = map.screens[0];
    project.maps = [map];

    // A distinctive 3x2 pattern at origin (row 2, col 1) -- every cell a
    // different value, so a row/col transposition bug cannot hide behind a
    // symmetric fixture.
    const pattern = [11, 12, 13, 21, 22, 23];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) screen.metatiles[(2 + r) * LIMITS.screenCols + (1 + c)] = pattern[r * 3 + c];
    }

    screen.boundTiles = [
      { row: 2, col: 2, switchId: 5, metatileId: 9 }, // inside the rectangle -- relative (0,1)
      { row: 5, col: 5, switchId: 1, metatileId: 2 } // outside the rectangle -- must be excluded entirely
    ];

    const clip = buildRegionClip(project, 0, 0, 2, 1, 3, 2);
    assert.equal(clip.width, 3);
    assert.equal(clip.height, 2);
    assert.deepEqual(clip.metatiles, pattern, 'metatile ids read row-major, relative to the rectangle');
    assert.deepEqual(
      clip.boundTiles,
      [{ row: 0, col: 1, switchId: 5, metatileId: 9 }],
      'only the binding actually inside the rectangle is included, and its own row/col are made relative'
    );
    assert.equal(clip.sourceTilesetId, 3, "the source MAP's own tilesetId, for the cross-tileset warning");
  }
);

// pasteRegionCore's optional entity payload -- design §6.3's own "second,
// optional step," with no dedicated §11 test number (unlike the
// metatile/boundTiles half, tests 14-16). Real, shipped code deserves real
// coverage regardless of test-plan numbering -- self-check finding, closed
// directly rather than left as smoke-only (which never even exercised the
// "include actors" checkbox).
test(
  "pasteRegionCore: the optional entity payload is cloned onto the destination (a distinct object, not the " +
    'same reference)',
  () => {
    const project = createProject('Paste with entities');
    const map = createMap(0, 'Home');
    const screen = map.screens[0];
    project.maps = [map];

    const clip = { width: 1, height: 1, metatiles: [0], boundTiles: [], sourceTilesetId: 0 };
    const entityA = { actorId: 0, x: 10, y: 20, props: {} };
    const entityB = { actorId: 1, x: 30, y: 40, props: {} };
    const { warning } = pasteRegionCore(project, 0, 0, 0, 0, clip, [entityA, entityB]);
    assert.equal(warning, null);
    assert.equal(screen.entities.length, 2);
    assert.deepEqual(screen.entities[0], entityA, 'the pasted entity holds the same content');
    assert.notEqual(screen.entities[0], entityA, 'but is a distinct clone, not the same object reference');
    assert.deepEqual(screen.entities[1], entityB);
    assert.notEqual(screen.entities[1], entityB);
  }
);

// Code review round 1, finding 3: an atomic capacity policy -- check both
// caps BEFORE mutating anything, refuse the whole paste if either would be
// exceeded, and report why in plain language naming the limit. Two
// controls, exactly as the fix brief names them: eight retained
// out-of-rectangle bindings plus one copied binding; and fewer free actor
// slots than copied actors. Both assert the destination is COMPLETELY
// unchanged (metatiles included -- nothing may be half-applied) and that
// the refusal is reported, distinguishable from success.
test(
  'pasteRegionCore/pasteCapacityProblem refuse the WHOLE paste, atomically, when the combined binding count ' +
    'would exceed LIMITS.boundTilesPerScreen -- the destination is left completely unchanged',
  () => {
    const project = createProject('Paste bindings over cap');
    const map = createMap(0, 'Home');
    const screen = map.screens[0];
    project.maps = [map];

    // Eight retained bindings, all OUTSIDE the 1x1 rectangle about to be
    // pasted at (0,0) -- every one individually valid, per-screen, before
    // the paste.
    screen.boundTiles = Array.from({ length: LIMITS.boundTilesPerScreen }, (_, i) => ({
      row: 5,
      col: i,
      switchId: 0,
      metatileId: 1
    }));
    const beforeBoundTiles = structuredClone(screen.boundTiles);
    const beforeMetatiles = screen.metatiles.slice();

    // One copied binding -- 8 retained + 1 copied = 9, one over the limit.
    const clip = {
      width: 1,
      height: 1,
      metatiles: [9], // non-default -- if the metatile write happened despite the refusal, this would show it
      boundTiles: [{ row: 0, col: 0, switchId: 1, metatileId: 2 }],
      sourceTilesetId: 0
    };

    const problem = pasteCapacityProblem(project, 0, 0, 0, 0, clip);
    assert.ok(problem, 'pasteCapacityProblem must report a problem BEFORE any commit would even be attempted');
    assert.ok(problem.includes('9'), 'names the combined count that would result (8 retained + 1 copied)');
    assert.ok(problem.includes(String(LIMITS.boundTilesPerScreen)), 'names the actual limit');

    const outcome = pasteRegionCore(project, 0, 0, 0, 0, clip);
    assert.ok(outcome.refused, 'pasteRegionCore itself refuses too -- the same check, not a second implementation');
    assert.equal(outcome.warning, undefined, 'a refusal is not a warning -- distinguishable from success');
    assert.deepEqual(screen.boundTiles, beforeBoundTiles, 'no bindings changed -- the refusal is atomic');
    assert.deepEqual(screen.metatiles, beforeMetatiles, 'no metatiles written either -- nothing half-applied');
  }
);

test(
  'pasteRegionCore/pasteCapacityProblem refuse the WHOLE paste, atomically, when fewer actor slots remain than ' +
    'were copied -- the destination is left completely unchanged, never a silent partial paste',
  () => {
    const project = createProject('Paste entities over cap');
    const map = createMap(0, 'Home');
    const screen = map.screens[0];
    project.maps = [map];
    // One free slot; two actors were copied.
    for (let i = 0; i < LIMITS.entitiesPerScreen - 1; i++) screen.entities.push({ actorId: 0, x: 0, y: 0, props: {} });
    const beforeEntities = structuredClone(screen.entities);
    const beforeMetatiles = screen.metatiles.slice();

    const clip = { width: 1, height: 1, metatiles: [9], boundTiles: [], sourceTilesetId: 0 };
    const extra = [
      { actorId: 0, x: 1, y: 1, props: {} },
      { actorId: 0, x: 2, y: 2, props: {} }
    ];

    const problem = pasteCapacityProblem(project, 0, 0, 0, 0, clip, extra);
    assert.ok(problem);
    assert.ok(problem.includes(String(LIMITS.entitiesPerScreen + 1)), 'names the combined count that would result');
    assert.ok(problem.includes(String(LIMITS.entitiesPerScreen)), 'names the actual limit');

    const outcome = pasteRegionCore(project, 0, 0, 0, 0, clip, extra);
    assert.ok(outcome.refused);
    assert.equal(outcome.warning, undefined);
    assert.deepEqual(
      screen.entities,
      beforeEntities,
      'not one of the two copied actors was added -- a silent partial paste (one added, one dropped) is exactly ' +
        'the defect this control catches'
    );
    assert.deepEqual(screen.metatiles, beforeMetatiles, 'no metatiles written either');
  }
);

// §11 test 14
test(
  'boundTiles paste is destination-rectangle REPLACE, not overlay',
  () => {
    const project = createProject('Paste boundTiles replace');
    const map = createMap(0, 'Home');
    const screen = map.screens[0];
    project.maps = [map];

    screen.boundTiles = [
      { row: 2, col: 3, switchId: 0, metatileId: 9 }, // inside the pasted rectangle, source has NO binding here
      { row: 0, col: 0, switchId: 1, metatileId: 4 } // outside the pasted rectangle -- must survive untouched
    ];

    const clip = {
      width: 3,
      height: 3,
      metatiles: new Array(9).fill(5),
      boundTiles: [{ row: 0, col: 0, switchId: 2, metatileId: 7 }], // relative (0,0) -> destination (1,2)
      sourceTilesetId: map.tilesetId
    };
    // Paste at row 1, col 2 -- rectangle spans rows 1-3, cols 2-4, which
    // includes (2,3) but not (0,0).
    const { warning } = pasteRegionCore(project, 0, 0, 1, 2, clip);
    assert.equal(warning, null);

    assert.deepEqual(
      screen.boundTiles,
      [
        { row: 0, col: 0, switchId: 1, metatileId: 4 }, // untouched -- outside the pasted rectangle
        { row: 1, col: 2, switchId: 2, metatileId: 7 } // the source's own binding, offset by the paste origin
      ],
      "the destination's own pre-existing binding inside the rectangle is genuinely CLEARED (not merely " +
        "overwritten by a source binding -- there wasn't one to overwrite with), and the source's own " +
        'binding is written in on top'
    );
  }
);

// §11 test 15
test(
  'copy/paste region respects SCREEN_METATILES bounds and does not corrupt adjacent content',
  () => {
    const project = createProject('Paste edge clamp');
    const map = createMap(0, 'Home');
    const screen = map.screens[0];
    project.maps = [map];

    // A deterministic, non-uniform pattern across the whole screen, so
    // "outside the pasted rectangle" is provable byte-for-byte, not merely
    // assumed to still be all-zero.
    screen.metatiles = screen.metatiles.map((_, i) => i % 60);
    const before = screen.metatiles.slice();

    const width = 3;
    const height = 3;
    const clip = { width, height, metatiles: new Array(width * height).fill(63), boundTiles: [], sourceTilesetId: 0 };
    // An origin chosen to run past BOTH edges at once.
    const originRow = LIMITS.screenRows - 1; // 14
    const originCol = LIMITS.screenCols - 1; // 15
    pasteRegionCore(project, 0, 0, originRow, originCol, clip);

    const expectedRow = LIMITS.screenRows - height; // 12 -- clamped fully on-screen
    const expectedCol = LIMITS.screenCols - width; // 13
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        assert.equal(
          screen.metatiles[(expectedRow + r) * LIMITS.screenCols + (expectedCol + c)],
          63,
          `pasted cell (row ${expectedRow + r}, col ${expectedCol + c}) must hold the clip's own content`
        );
      }
    }

    // Everything outside the clamped rectangle is byte-identical to before
    // the paste -- an off-by-one in the row/col-to-flat-index arithmetic
    // would bleed into a neighboring row or column, invisible in a
    // paste-in-the-middle test but real here.
    for (let i = 0; i < SCREEN_METATILES; i++) {
      const row = Math.floor(i / LIMITS.screenCols);
      const col = i % LIMITS.screenCols;
      const inside = row >= expectedRow && row < expectedRow + height && col >= expectedCol && col < expectedCol + width;
      if (!inside) assert.equal(screen.metatiles[i], before[i], `metatile ${i} outside the pasted rectangle must be unchanged`);
    }
  }
);

// §11 test 16
test(
  'map.folder round-trips through save/load, normalizes idempotently, and is ignored by the build',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // (a) build-invisibility: a project with map.folder set vs the identical
    // project with it deleted entirely must produce byte-identical ROMs.
    const base = await loadProject(SAMPLE);
    const withFolder = structuredClone(base);
    withFolder.maps[0].folder = 'Dungeons';
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-folder-a-'));
    t.after(() => fs.rm(dirA, { recursive: true, force: true }));
    await saveProject(dirA, withFolder);
    const builtA = await buildProject({ dir: dirA, project: withFolder, log: () => {} });
    const romA = await fs.readFile(builtA.romPath);

    const withoutFolder = structuredClone(base);
    delete withoutFolder.maps[0].folder;
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-folder-b-'));
    t.after(() => fs.rm(dirB, { recursive: true, force: true }));
    await saveProject(dirB, withoutFolder);
    const builtB = await buildProject({ dir: dirB, project: withoutFolder, log: () => {} });
    const romB = await fs.readFile(builtB.romPath);

    assert.deepEqual(romA, romB, 'map.folder must reach zero compiled bytes, present or absent');

    // (b) saveProject/loadProject round-trips a project with map.folder set
    // -- closes the gap an implementation missing normalizeMap's own
    // round-trip would fall into (round 1's own build-only check could
    // never see this, since it never reloads the project at all).
    const dirC = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-folder-c-'));
    t.after(() => fs.rm(dirC, { recursive: true, force: true }));
    const project = createProject('Folder round trip');
    project.maps[0].folder = 'Dungeons';
    await saveProject(dirC, project);
    const reloaded = await loadProject(dirC);
    assert.equal(
      reloaded.maps[0].folder,
      'Dungeons',
      "the reloaded project's own folder survives a real save/load round trip -- the exact real-world path an " +
        'author hits every session'
    );

    // (c) normalizeProject is idempotent on its own output.
    const normalizedOnce = normalizeProject({ maps: [{ folder: 'Dungeons' }] });
    const normalizedTwice = normalizeProject(normalizedOnce);
    assert.equal(
      normalizedTwice.maps[0].folder,
      'Dungeons',
      'folder survives a second normalization pass unchanged'
    );
  }
);

// §11 test 26
test(
  'the draw-site census: saveCompatToken is redrawn on exactly the five qualifying structural edits, ' +
    'and never on the five non-qualifying ones',
  (t) => {
    // Five distinct, pre-seeded fractional values -- one per qualifying
    // draw, consumed strictly in the order the five qualifying fixtures
    // run below -- so each draw is individually distinguishable and the
    // resulting token is checked against its own known, predicted value,
    // never merely "changed."
    const queue = [0.11, 0.22, 0.33, 0.44, 0.55];
    let callCount = 0;
    t.mock.method(Math, 'random', () => {
      callCount++;
      return queue.shift();
    });
    const predictedToken = (fraction) => 1 + Math.floor(fraction * 0xffff);

    // --- Qualifying: exactly one draw, token equals the mocked draw's own value ---

    {
      // reorder (§6.7)
      const project = createProject('Census reorder');
      project.maps = [createMap(0, 'A'), createMap(1, 'B')];
      const before = callCount;
      reorderMapsCore(project, [1, 0]);
      assert.equal(callCount - before, 1, 'reorder must draw exactly once');
      assert.equal(project.project.saveCompatToken, predictedToken(0.11));
    }
    {
      // delete map (§6.8)
      const project = createProject('Census delete');
      project.maps = [createMap(0, 'A'), createMap(1, 'B')];
      const before = callCount;
      deleteMapCore(project, 0);
      assert.equal(callCount - before, 1, 'delete map must draw exactly once');
      assert.equal(project.project.saveCompatToken, predictedToken(0.22));
    }
    {
      // grow-resize (§6.9)
      const project = createProject('Census grow');
      const map = createMap(0, 'A');
      map.gridW = 1;
      map.gridH = 1;
      project.maps = [map];
      const before = callCount;
      growOrShrinkMap(project, 0, 2, 1);
      assert.equal(callCount - before, 1, 'grow-resize must draw exactly once');
      assert.equal(project.project.saveCompatToken, predictedToken(0.33));
    }
    {
      // shrink-resize (§6.9)
      const project = createProject('Census shrink');
      const map = createMap(0, 'A');
      map.gridW = 2;
      map.gridH = 1;
      map.screens = [createScreen(), createScreen()];
      project.maps = [map];
      const before = callCount;
      growOrShrinkMap(project, 0, 1, 1);
      assert.equal(callCount - before, 1, 'shrink-resize must draw exactly once');
      assert.equal(project.project.saveCompatToken, predictedToken(0.44));
    }
    {
      // growth-routed single-screen duplicate (§6.9.1)
      const project = createProject('Census growth-duplicate');
      const map = createMap(0, 'A'); // 1x1 -- room to grow
      project.maps = [map];
      const source = map.screens[0];
      const before = callCount;
      duplicateScreenViaGrowthCore(project, 0, source);
      assert.equal(callCount - before, 1, 'growth-routed duplicate must draw exactly once -- it is, mechanically, a resize');
      assert.equal(project.project.saveCompatToken, predictedToken(0.55));
    }

    // --- Non-qualifying: zero draws, saveCompatToken unchanged from its pre-commit value ---

    {
      // append-only whole-map duplicate (§6.2)
      const project = createProject('Census whole-map duplicate');
      project.maps = [createMap(0, 'A')];
      const tokenBefore = project.project.saveCompatToken;
      const before = callCount;
      duplicateMapCore(project, 0);
      assert.equal(callCount - before, 0, 'whole-map duplicate must never draw -- screenCount already moves');
      assert.equal(project.project.saveCompatToken, tokenBefore);
    }
    {
      // Add Map (§6.2)
      const project = createProject('Census add map');
      const tokenBefore = project.project.saveCompatToken;
      const before = callCount;
      addMapCore(project);
      assert.equal(callCount - before, 0, 'Add Map must never draw -- screenCount already moves');
      assert.equal(project.project.saveCompatToken, tokenBefore);
    }
    {
      // a folder-name edit (§8) -- a bare field write, no shared core of its
      // own (there is nothing to remap or repair), matching the design's
      // own framing exactly.
      const project = createProject('Census folder edit');
      project.maps = [createMap(0, 'A')];
      const tokenBefore = project.project.saveCompatToken;
      const before = callCount;
      project.maps[0].folder = 'Dungeons';
      assert.equal(callCount - before, 0, 'a folder edit must never draw');
      assert.equal(project.project.saveCompatToken, tokenBefore);
    }
    {
      // a region paste (§6.3)
      const project = createProject('Census paste');
      project.maps = [createMap(0, 'A')];
      const tokenBefore = project.project.saveCompatToken;
      const before = callCount;
      const clip = { width: 1, height: 1, metatiles: [5], boundTiles: [], sourceTilesetId: 0 };
      pasteRegionCore(project, 0, 0, 0, 0, clip);
      assert.equal(callCount - before, 0, 'a region paste must never draw -- no screen identity or count changes');
      assert.equal(project.project.saveCompatToken, tokenBefore);
    }
    {
      // the all-maps-full fallback, duplicate-screen-into-a-brand-new-map
      // (§6.2.1) -- the tenth fixture, an append like whole-map Duplicate
      // and Add Map and covered by the identical argument, never
      // separately asserted before this test.
      const project = createProject('Census new-map fallback');
      project.maps = [createMap(0, 'A')];
      const source = project.maps[0].screens[0];
      const tokenBefore = project.project.saveCompatToken;
      const before = callCount;
      duplicateScreenIntoNewMapCore(project, source);
      assert.equal(callCount - before, 0, 'the all-maps-full fallback must never draw -- it is an append, like the other two');
      assert.equal(project.project.saveCompatToken, tokenBefore);
    }
  }
);
