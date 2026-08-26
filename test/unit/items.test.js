// Phase 4b: the bag holds item ids instead of actor ids. These are the four
// named test deliverables the phase 4 design document (§8, revised in round
// 3) called out specifically -- an unbacked pickup on both paths, a pinned
// pre-change hash (not a same-implementation comparison), and legacy-icon
// compatibility including the empty-animation edge case finding 2 found.
// Deliverable 4 (direct NUM_ITEMS save-bound coverage) lives in
// test/unit/save.test.js, beside the rest of save_check_valid's own bounds.
//
// Nothing here touches any of the five checked-in fixtures -- every project
// is either freshly constructed or a structuredClone of a loadProject() read,
// built into its own mkdtemp directory.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { generateAssets, resolveItemIcon } from '../../main/build/generate.js';
import { createProject, validateProject, LIMITS, NO_METASPRITE } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fssync.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const PICKUPS = 0x24;
const INV_COUNT = 0x37;
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const ENT_X = 0x310;
const ENT_Y = 0x318;

const A = 0;
const B = 1;
const UP = 4;
const DOWN = 5;

function boot(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fssync.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  if (nes.cpu.mem[0x25] === 3) {
    nes.buttonDown(1, 3);
    nes.frame();
    nes.buttonUp(1, 3);
    for (let i = 0; i < 12; i++) nes.frame();
  }
  return nes;
}

const tap = (nes, button, frames = 2) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

const hold = (nes, button, frames) => {
  nes.buttonDown(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
  nes.buttonUp(1, button);
};

/** Chase an actor's live position, the same way menus.test.js's own helper does. */
function walkToEntity(nes, slot, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const targetX = nes.cpu.mem[ENT_X + slot];
    const targetY = nes.cpu.mem[ENT_Y + slot];
    const x = nes.cpu.mem[PLAYER_X];
    const y = nes.cpu.mem[PLAYER_Y];
    const buttons = [];
    if (x < targetX - 2) buttons.push(7); // RIGHT
    else if (x > targetX + 2) buttons.push(6); // LEFT
    if (y < targetY - 2) buttons.push(DOWN);
    else if (y > targetY + 2) buttons.push(UP);
    if (!buttons.length) return true;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  return false;
}

function findSlot(nes, actorId) {
  for (let slot = 0; slot < 8; slot++) {
    if (nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === actorId) return slot;
  }
  return -1;
}

// --------------------------------------------------------------------------
// Deliverable 1: an unbacked pickup on both paths.
// --------------------------------------------------------------------------

/**
 * sample, with a second pickup actor pushed on that no item's actorId names
 * -- deliberately not added to project.items at all. `mode` places it either
 * at the start position (touch range, entity_pickup collects it as soon as
 * the world starts moving -- during boot()'s own frames, before a test even
 * gets a chance to act) or 16px away (interact-only reach -- within
 * REACH_RANGE 20, outside TOUCH_RANGE 12), one build per mode so touching
 * the first can never fire before the interact-only case is checked, and so
 * each routine gets its own direct, uncontaminated coverage rather than one
 * standing in for the other.
 */
async function buildUnbacked(t, mode) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-unbacked-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const gem = project.sprites.actors.find((actor) => actor.behavior === 'pickup');
  const fake = { ...structuredClone(gem), id: project.sprites.actors.length, name: 'Fake' };
  project.sprites.actors.push(fake);
  const x = mode === 'touch' ? project.project.startX : project.project.startX - 16;
  project.maps[0].screens[0].entities.push({ actorId: fake.id, x, y: project.project.startY, props: {} });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, fake, romPath: built.romPath };
}

test('validateProject warns about a pickup actor no item names', async (t) => {
  const project = await loadProject(SAMPLE);
  const gem = project.sprites.actors.find((actor) => actor.behavior === 'pickup');
  const fake = { ...structuredClone(gem), id: project.sprites.actors.length, name: 'Fake' };
  project.sprites.actors.push(fake);
  project.maps[0].screens[0].entities.push({ actorId: fake.id, x: 0, y: 0, props: {} });

  const warnings = validateProject(project).filter(
    (entry) => entry.severity === 'warning' && /has behaviour Pickup but no item names it/.test(entry.message)
  );
  assert.equal(warnings.length, 1, 'exactly one warning should name the unbacked pickup actor');
  assert.match(warnings[0].message, /Fake/, 'the warning should name the actor');

  // The backed gem itself must not also warn -- only the actor with no
  // item, not every pickup in the project.
  assert.ok(
    !warnings.some((entry) => /Gem/.test(entry.message)),
    'the sample fixture’s own backed Gem must not warn'
  );
});

test('entity_pickup (touch) refuses an unbacked pickup: it vanishes and counts, but never enters the bag', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { fake, romPath } = await buildUnbacked(t, 'touch');
  // Spawned exactly at the player's own start position, so contact fires
  // during boot()'s own frames (the initial run-up plus the title
  // press-through), before any test code even runs -- checked directly
  // rather than walked onto, since walking away and back would only prove
  // the same fact a second time.
  const nes = boot(romPath);

  assert.equal(nes.cpu.mem[PICKUPS], 1, 'walking onto it should still count toward pickups');
  assert.equal(nes.cpu.mem[INV_COUNT], 0, 'an unbacked pickup must not enter the bag -- add_item should refuse NO_ITEM');
  assert.equal(
    [...Array(8).keys()].filter(
      (slot) => nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === fake.id
    ).length,
    0,
    'no slot should still show the unbacked pickup actor active -- it should have vanished on contact'
  );
});

test('do_interact refuses an unbacked pickup the same way: it vanishes and counts, but never enters the bag', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // A separate build from the touch case above, with only the interact-only
  // placement -- touching would otherwise collect (or, per the test above,
  // try to and be refused) during boot()'s own frames, before this test
  // could isolate do_interact's own path at all.
  const { fake, romPath } = await buildUnbacked(t, 'interact');
  const nes = boot(romPath);
  const slot = findSlot(nes, fake.id);
  assert.notEqual(slot, -1, 'the interact-only Fake pickup did not spawn');

  assert.ok(walkToEntity(nes, slot), 'could not reach the interact-only Fake pickup');
  tap(nes, B); // B is bound to interact

  assert.equal(nes.cpu.mem[PICKUPS], 1, 'interacting with it should still count toward pickups');
  assert.equal(nes.cpu.mem[INV_COUNT], 0, 'an unbacked pickup must not enter the bag via do_interact either');
  assert.equal(nes.cpu.mem[ENT_ACTIVE + slot], 0, 'it should still vanish off the map');
});

// --------------------------------------------------------------------------
// Deliverable 2: a pinned pre-change hash, not a same-implementation
// comparison -- comparing two builds of the new code against each other
// proves internal consistency, not backward compatibility with master. This
// hash was captured by building createProject('Baseline') (no items, no
// Save command, default mapper) under master, before any phase-4 change
// landed, immediately before this branch's first edit.
// --------------------------------------------------------------------------

// Re-pinned for the player.asm movement-tail dedup (the kernel diet that
// reopened MMC3's Save+Move margin): re-captured from a `git worktree` at
// master (9eda25f) with *only* that diet's diff applied -- no other phase 4b
// change -- so this still asserts what it always asserted (an items-disabled
// build is unaffected by items), not the diet compared against itself.
// Building the current tree and pasting its hash here would have made this
// assertion vacuous.
const PINNED_BASELINE_HASH = '6a586eae7c9855176e158c15edff6885551ec647b31eb24bbdff741d54f7e986';
const PINNED_BASELINE_SIZE = 40976;

test('a project with no items and no Save is byte-identical to the pre-phase-4b master build', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-baseline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = createProject('Baseline');
  assert.equal(project.items.length, 0, 'this case needs a project with no items at all');
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const rom = await fs.readFile(built.romPath);
  assert.equal(rom.length, PINNED_BASELINE_SIZE, 'ROM size drifted from the pinned pre-phase-4b baseline');
  const hash = crypto.createHash('sha256').update(rom).digest('hex');
  assert.equal(
    hash,
    PINNED_BASELINE_HASH,
    'an items-disabled, Save-disabled project must assemble byte-for-byte identically to master -- if this is ' +
      'a deliberate change, re-pin the hash by building this exact project on master and say why in the commit'
  );
});

// Round 4 finding (High 2): the action-only baseline above cannot reach
// battleTables() at all -- codeRegions()/battleTables() only run for an RPG
// -- so it structurally could not have caught item_name/item_heal being
// pushed unconditionally there (dbRows([]) still emits a one-byte ".db $00"
// stub each, so an items-disabled RPG was gaining 2 real banked bytes and
// shifting every label after them, for two tables nothing in that build
// ever reads). A pinned no-items RPG baseline is what actually exercises
// that path. Captured the same way: createProject('BaselineRPG', 'rpg') on
// MMC1, under master, before this round's fix landed.
// Re-pinned the same way and for the same reason as PINNED_BASELINE_HASH
// above: a worktree at master (9eda25f) with only the player.asm dedup
// applied, no other phase 4b change.
const PINNED_RPG_BASELINE_HASH = '14ad62e9f02e67c6ecc5d722cc89749c7ba430e4b5917b66ba1dcc18ee4e9a85';
const PINNED_RPG_BASELINE_SIZE = 147472;

test('an RPG with no items and no Save is byte-identical to the pre-round-4 master build', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-baseline-rpg-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = createProject('BaselineRPG', 'rpg');
  project.cartridge.mapper = 1; // MMC1, RPG-capable -- reaches battleTables()
  assert.equal(project.items.length, 0, 'this case needs an RPG with no items at all');
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const rom = await fs.readFile(built.romPath);
  assert.equal(rom.length, PINNED_RPG_BASELINE_SIZE, 'ROM size drifted from the pinned pre-round-4 RPG baseline');
  const hash = crypto.createHash('sha256').update(rom).digest('hex');
  assert.equal(
    hash,
    PINNED_RPG_BASELINE_HASH,
    'an items-disabled RPG must assemble byte-for-byte identically to master, including in the banked battle ' +
      'region -- if this is a deliberate change, re-pin the hash by building this exact project on master and ' +
      'say why in the commit'
  );
});

// --------------------------------------------------------------------------
// Deliverable 3: phase-3 upgrade compatibility for the icon, including the
// empty-animation case finding 2 found -- resolveItemIcon (main/build/
// generate.js) has to reproduce draw_actor_icon's exact runtime behaviour,
// not what the project data merely reads like.
// --------------------------------------------------------------------------

function baseItemIconProject() {
  const project = createProject('Icon', 'action');
  project.sprites = {
    metasprites: [
      { id: 0, name: 'Idle0', tiles: [{ x: 0, y: 0, tile: 1, palette: 0, hflip: false, vflip: false }] },
      { id: 1, name: 'Idle1', tiles: [{ x: 0, y: 0, tile: 2, palette: 0, hflip: false, vflip: false }] }
    ],
    animations: [],
    actors: []
  };
  return project;
}

async function itemMetaspriteTable(project) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-icon-'));
  try {
    await generateAssets({ dir, project });
    const text = await fs.readFile(path.join(dir, 'build/assets/items.inc'), 'utf8');
    const match = /item_metasprite:\n((?:\s*\.db .*\n?)+)/.exec(text);
    assert.ok(match, 'items.inc should emit an item_metasprite table for an items-enabled project');
    return match[1]
      .trim()
      .split('\n')
      .flatMap((line) => line.replace(/\s*\.db\s*/, '').split(',').map((value) => parseInt(value.replace('$', ''), 16)));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('an item with no explicit icon derives one from the backing actor’s resting frame, like draw_actor_icon drew it', async () => {
  const project = baseItemIconProject();
  project.sprites.animations = [{ id: 0, name: 'walkDown', loop: true, frames: [{ metaspriteId: 1, duration: 8 }] }];
  project.sprites.actors = [{ id: 0, name: 'Backer', behavior: 'pickup', speed: 1, hp: 1, anims: { walkDown: 0 } }];
  project.items = [{ id: 0, name: 'Migrated', actorId: 0, metaspriteId: null }];

  const table = await itemMetaspriteTable(project);
  assert.equal(table[0], 1, 'the icon should be frame 0’s metasprite (1), reproducing draw_actor_icon exactly');
});

test('an item whose resolved animation exists but has zero frames derives metasprite 0, not "no icon" -- the empty-animation stub finding 2 found', async () => {
  const project = baseItemIconProject();
  // An animation with no frames at all: the Sprite Forge permits this, and
  // spriteTables emits a one-byte .db $00 stub for it, which
  // draw_actor_icon's runtime dereferences as if it were real frame data --
  // drawing metasprite 0. resolveItemIcon has to reproduce that exact
  // surprising behaviour, not the more intuitive "no frames means no icon".
  project.sprites.animations = [{ id: 0, name: 'walkDown', loop: true, frames: [] }];
  project.sprites.actors = [{ id: 0, name: 'Backer', behavior: 'pickup', speed: 1, hp: 1, anims: { walkDown: 0 } }];
  project.items = [{ id: 0, name: 'Migrated', actorId: 0, metaspriteId: null }];

  const table = await itemMetaspriteTable(project);
  assert.equal(table[0], 0, 'an empty animation should derive metasprite 0 (the stub byte), not NO_METASPRITE');
});

test('an item backed by an actor with no idle or walkDown animation at all derives NO_METASPRITE', async () => {
  const project = baseItemIconProject();
  project.sprites.actors = [{ id: 0, name: 'Backer', behavior: 'pickup', speed: 1, hp: 1, anims: {} }];
  project.items = [{ id: 0, name: 'Migrated', actorId: 0, metaspriteId: null }];

  const table = await itemMetaspriteTable(project);
  assert.equal(table[0], 0xff, 'no idle/walkDown animation to derive from should mean no icon');
});

test('an item with an explicit, in-range metaspriteId is used as-is, not derived', async () => {
  const project = baseItemIconProject();
  project.sprites.animations = [{ id: 0, name: 'walkDown', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] }];
  project.sprites.actors = [{ id: 0, name: 'Backer', behavior: 'pickup', speed: 1, hp: 1, anims: { walkDown: 0 } }];
  project.items = [{ id: 0, name: 'Explicit', actorId: 0, metaspriteId: 1 }];

  const table = await itemMetaspriteTable(project);
  assert.equal(table[0], 1, 'an explicit metaspriteId must win over the legacy derivation, not be overridden by it');
});

test('an item with an explicit but out-of-range metaspriteId degrades to NO_METASPRITE, not to the legacy derivation', async () => {
  const project = baseItemIconProject();
  project.sprites.animations = [{ id: 0, name: 'walkDown', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] }];
  project.sprites.actors = [{ id: 0, name: 'Backer', behavior: 'pickup', speed: 1, hp: 1, anims: { walkDown: 0 } }];
  // Only 2 metasprites exist (ids 0-1); 200 is stale.
  project.items = [{ id: 0, name: 'Stale', actorId: 0, metaspriteId: 200 }];

  const table = await itemMetaspriteTable(project);
  assert.equal(
    table[0],
    0xff,
    'a stale explicit reference must not silently fall back to "unset" and re-derive from the actor -- it becomes no icon'
  );
});

// --------------------------------------------------------------------------
// Round 5: LIMITS.metasprites closes the $FF collision between a real
// metasprite id and NO_METASPRITE. Before this cap existed, the Sprite
// Forge's Add button was genuinely uncapped, so a project could reach a real
// metasprite 255 -- byte-identical to NO_METASPRITE, with no way for a
// derived icon or an explicit reference to tell the two apart. The cap
// (LIMITS.metasprites = NO_METASPRITE, the same shape LIMITS.actors/items
// already use), enforced by validateProject's own refusal of an over-cap
// array (below), is the whole guarantee: a real metasprite id in any project
// that reaches generation is never 255.
//
// Round 5 also added a defensive ceiling clamp inside resolveItemIcon
// itself, reasoning that buildProject compiles the project the app is
// holding rather than one that has passed validateProject. Round 6
// sabotage-testing found that reasoning does not survive contact with the
// actual byte space: metaspriteId is one byte, so 255 is simultaneously the
// only value the clamp could ever treat differently AND NO_METASPRITE's own
// value -- meaning a real metasprite 255 and "no icon" produce the identical
// return value with or without the clamp. Two tests here asserted exactly
// that indistinguishable output and could not have failed either way; they
// are deleted along with the clamp they were testing, rather than kept as
// coverage that only looked like coverage. See resolveItemIcon's own
// comment (main/build/generate.js) for the full reasoning. The boundary
// test below (254, one below the cap) is the one that actually
// distinguishes real behaviour and is kept.
// --------------------------------------------------------------------------

test('resolveItemIcon: a real metasprite at the new ceiling (254) still resolves correctly, both derived and explicit', () => {
  const metasprites = Array.from({ length: 255 }, (_, id) => ({ id, name: `M${id}`, tiles: [] }));
  const animations = [{ id: 0, name: 'walkDown', loop: true, frames: [{ metaspriteId: 254, duration: 8 }] }];
  const actor = { id: 0, name: 'Backer', behavior: 'pickup', speed: 1, hp: 1, anims: { walkDown: 0 } };

  assert.equal(
    resolveItemIcon({ id: 0, name: 'Derived', actorId: 0, metaspriteId: null }, actor, animations, metasprites),
    254,
    'the highest legitimate metasprite id (254, one below the cap) must still resolve as real art when derived'
  );
  assert.equal(
    resolveItemIcon({ id: 1, name: 'Explicit', actorId: null, metaspriteId: 254 }, null, [], metasprites),
    254,
    'and the same id must still resolve as real art when named explicitly'
  );
});

// Round 6 finding: nothing pinned what the cap actually *is* -- the over-cap
// test below is written relative to LIMITS.metasprites (`+ 1` entries), the
// same self-referential shape CLAUDE.md already warns against ("a test that
// reads the file it is checking proves nothing"). Changing LIMITS.metasprites
// from NO_METASPRITE to a plain 256 reopens the exact collision round 5
// exists to close, and every test in this file still passes, because they
// all measure themselves against whatever the constant currently says rather
// than against the one fact that actually matters: that the cap *is* the
// sentinel. This is the direct, absolute check -- mirrors
// project.test.js's identical pin for LIMITS.actors against NO_ACTOR.
test('the cap is the sentinel: LIMITS.metasprites must equal NO_METASPRITE, not merely some number', () => {
  assert.equal(LIMITS.metasprites, NO_METASPRITE, 'the cap is the sentinel: ids run 0..NO_METASPRITE-1');
  assert.equal(LIMITS.metasprites - 1, 0xfe, 'so the highest legal metasprite id is $FE');
});

test('validateProject refuses a project with more metasprites than LIMITS.metasprites allows, naming the Sprite Forge, without dropping any of them', () => {
  const project = createProject('Metasprites');
  project.sprites.metasprites = Array.from({ length: LIMITS.metasprites + 1 }, (_, id) => ({
    id,
    name: `M${id}`,
    tiles: []
  }));

  const errors = validateProject(project).filter((entry) => entry.severity === 'error' && /metasprites/.test(entry.message));
  assert.equal(errors.length, 1, 'an over-cap metasprite array should be refused exactly once');
  assert.equal(errors[0].where, 'Sprite Forge');
  assert.match(errors[0].message, new RegExp(String(LIMITS.metasprites)), 'the message should name the ceiling');
  assert.equal(
    project.sprites.metasprites.length,
    LIMITS.metasprites + 1,
    'validateProject must not have silently sliced the array -- the extra metasprite is real content, kept for the author to decide'
  );

  // Exactly at the cap is legal.
  project.sprites.metasprites.length = LIMITS.metasprites;
  assert.deepEqual(
    validateProject(project).filter((entry) => /metasprites but/.test(entry.message)),
    [],
    'exactly at the ceiling is legal'
  );
});
