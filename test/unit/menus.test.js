// The two frozen-world states the Controller Forge binds buttons for, driven
// through the built ROM: the inventory menu and dialogue. These are what make
// the item, cancel and confirm actions mean something, so the assertions are on
// engine RAM (state, bag, highlight) and on the sprite shadow, which is the only
// place the overlay exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const PICKUPS = 0x24;
const GAME_STATE = 0x25;
const DEFEATED = 0x27;
const INV_COUNT = 0x37;
const INV_SEL = 0x38;
const ITEMS_USED = 0x39;
const TALK_ENT = 0x3a;
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const INV_ITEMS = 0x378;
const OAM = 0x200;

// Game states, from engine/constants.asm.
const ST_GAMEPLAY = 0;
const ST_MENU = 1;
const ST_DIALOG = 2;
const NO_ENTITY = 0xff;

// jsnes button numbers.
const A = 0;
const B = 1;
const SELECT = 2;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

function boot(romPath = ROM_PATH, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  // A cartridge with a title screen boots into it; every scenario here is about
  // the game behind it, so press through. `game_state` is ST_TITLE only when the
  // project actually has one, so this is a no-op for the ROMs that do not.
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

/** Chase an actor's live position — a patroller keeps moving while we approach. */
function walkToEntity(nes, slot, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const targetX = nes.cpu.mem[ENT_X + slot];
    const targetY = nes.cpu.mem[ENT_Y + slot];
    const x = nes.cpu.mem[PLAYER_X];
    const y = nes.cpu.mem[PLAYER_Y];
    const buttons = [];
    if (x < targetX - 2) buttons.push(RIGHT);
    else if (x > targetX + 2) buttons.push(LEFT);
    if (y < targetY - 2) buttons.push(DOWN);
    else if (y > targetY + 2) buttons.push(UP);
    if (!buttons.length) return true;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  return false;
}

/** Sprites the shadow is actually showing, ignoring the parked ones. */
function liveSprites(nes) {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const y = nes.cpu.mem[OAM + i * 4];
    if (y !== 0xff) out.push({ y, tile: nes.cpu.mem[OAM + i * 4 + 1], x: nes.cpu.mem[OAM + i * 4 + 3] });
  }
  return out;
}

/** The sample's first gem, which lives on the screen below the start. */
function walkToTheGem(nes) {
  hold(nes, DOWN, 220);
  for (let slot = 0; slot < 8; slot++) {
    if (nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === 1) return slot;
  }
  return -1;
}

test('the item action opens the inventory, which freezes the world', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);

  tap(nes, SELECT); // SELECT is bound to item
  assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU);

  const frozenY = nes.cpu.mem[PLAYER_Y];
  hold(nes, DOWN, 40);
  assert.equal(nes.cpu.mem[PLAYER_Y], frozenY, 'the player walked while the menu was open');

  // The menu row binds A to confirm and B to cancel, so an action that only
  // exists during play must not reach the world from here.
  tap(nes, A);
  assert.equal(nes.cpu.mem[DEFEATED], 0, 'confirm attacked something through the menu');

  tap(nes, B); // cancel
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  hold(nes, DOWN, 20);
  assert.ok(nes.cpu.mem[PLAYER_Y] > frozenY, 'the player did not start moving again');
});

test('a collected pickup goes into the bag, and confirm spends it', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  const gem = walkToTheGem(nes);
  assert.ok(gem >= 0, 'the gem did not spawn');
  assert.ok(walkToEntity(nes, gem), 'could not reach the gem');
  for (let i = 0; i < 6; i++) nes.frame();

  assert.equal(nes.cpu.mem[PICKUPS], 1, 'walking onto the gem did not collect it');
  assert.equal(nes.cpu.mem[INV_COUNT], 1, 'the gem did not reach the bag');
  // The bag holds the item id (0, sample's own "Gem"), not the actor id (1)
  // it used to hold before phase 4b retargeted the bag to item ids.
  assert.equal(nes.cpu.mem[INV_ITEMS], 0, 'the bag should hold the gem item (id 0)');

  const worldSprites = liveSprites(nes).length;
  tap(nes, SELECT);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU);
  assert.ok(
    liveSprites(nes).length > worldSprites,
    'the open inventory drew nothing into the sprite shadow'
  );

  tap(nes, A); // confirm spends the highlighted item
  assert.equal(nes.cpu.mem[INV_COUNT], 0);
  assert.equal(nes.cpu.mem[ITEMS_USED], 1);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'spending an item should leave the menu open');

  tap(nes, A); // an empty bag has nothing left to spend
  assert.equal(nes.cpu.mem[ITEMS_USED], 1);

  tap(nes, B);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
});

test('interacting with an actor that is not a pickup starts a conversation', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  assert.equal(nes.cpu.mem[TALK_ENT], NO_ENTITY, 'nobody should be speaking at boot');
  assert.ok(walkToEntity(nes, 0), 'could not reach the slime');

  tap(nes, B); // B is bound to interact
  assert.equal(nes.cpu.mem[GAME_STATE], ST_DIALOG);
  assert.equal(nes.cpu.mem[TALK_ENT], 0, 'the conversation should name the slime');
  assert.equal(nes.cpu.mem[ENT_ACTIVE], 1, 'talking must not defeat the actor');

  const frozenX = nes.cpu.mem[PLAYER_X];
  const frozenSlimeX = nes.cpu.mem[ENT_X];
  hold(nes, RIGHT, 30);
  assert.equal(nes.cpu.mem[PLAYER_X], frozenX, 'the player walked during a conversation');
  assert.equal(nes.cpu.mem[ENT_X], frozenSlimeX, 'the slime kept patrolling during a conversation');

  // The dialogue row binds both A and B to confirm. The slime has two pages to
  // say, and each press turns one page rather than ending the conversation, so
  // this taps until the box comes down instead of assuming one press does it.
  // What matters here is that confirm is what ends it; text.test.js owns the box.
  let taps = 0;
  while (nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY && taps < 20) {
    tap(nes, A);
    for (let i = 0; i < 60; i++) nes.frame();
    taps++;
  }
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, `the conversation never ended (${taps} presses)`);
  assert.equal(nes.cpu.mem[TALK_ENT], NO_ENTITY);
  hold(nes, RIGHT, 20);
  assert.notEqual(nes.cpu.mem[PLAYER_X], frozenX, 'the world did not restart after the conversation');
});

// One gem is all the sample carries, and a bag of one proves nothing about
// moving the highlight or closing the gap a spent item leaves, so this one
// builds its own project: three pickups, two of them distinguishable.
test('the highlight walks the bag, and spending an item closes the gap', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-menu-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = await loadProject(SAMPLE);
  const gem = project.sprites.actors.find((actor) => actor.behavior === 'pickup');
  const gemItem = project.items.find((item) => item.actorId === gem.id);
  assert.ok(gemItem, 'the sample fixture should already have an item backing the gem');
  // A second pickup actor, so the bag holds two telltale ids rather than three
  // copies of one and the shuffle is visible.
  const relic = { ...structuredClone(gem), id: project.sprites.actors.length, name: 'Relic' };
  project.sprites.actors.push(relic);
  // ...and its own item: an unbacked pickup actor is refused at add_item
  // (engine/ui.asm's centralized NO_ITEM guard, phase 4b), so a second
  // pickup actor with no item of its own would silently not enter the bag
  // at all rather than filling it with a second, distinguishable id.
  const relicItem = { id: project.items.length, name: 'Relic', actorId: relic.id, metaspriteId: null };
  project.items.push(relicItem);

  const place = (actorId, x, y) => ({ actorId, x, y, props: { toScreen: 0, toX: 112, toY: 112 } });
  // All three inside the interact action's 20-pixel reach of the player start and
  // outside the 12 pixels that count as touching, so the bag fills from three
  // button presses and the test never has to walk anywhere.
  project.maps[0].screens[0].entities = [
    place(gem.id, 112 + 16, 112),
    place(relic.id, 112 - 16, 112),
    place(gem.id, 112, 112 + 16)
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  for (let i = 0; i < 3; i++) tap(nes, B);
  assert.equal(nes.cpu.mem[INV_COUNT], 3, 'three interacts should have filled the bag');
  assert.deepEqual(
    [...nes.cpu.mem.slice(INV_ITEMS, INV_ITEMS + 3)],
    [gemItem.id, relicItem.id, gemItem.id],
    'the bag should hold the item ids of what was collected, in the order it was collected'
  );

  tap(nes, SELECT);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU);
  assert.equal(nes.cpu.mem[INV_SEL], 0);

  tap(nes, RIGHT);
  tap(nes, RIGHT);
  assert.equal(nes.cpu.mem[INV_SEL], 2);
  tap(nes, RIGHT);
  assert.equal(nes.cpu.mem[INV_SEL], 0, 'the highlight should wrap past the last item');
  tap(nes, LEFT);
  assert.equal(nes.cpu.mem[INV_SEL], 2, 'the highlight should wrap past the first item');

  tap(nes, A); // spending the last item has to pull the highlight back
  assert.equal(nes.cpu.mem[INV_COUNT], 2);
  assert.equal(nes.cpu.mem[ITEMS_USED], 1);
  assert.equal(nes.cpu.mem[INV_SEL], 1);

  tap(nes, LEFT);
  assert.equal(nes.cpu.mem[INV_SEL], 0);
  tap(nes, A); // spending from the middle of the bag closes up over the gap
  assert.equal(nes.cpu.mem[INV_COUNT], 1);
  assert.equal(nes.cpu.mem[ITEMS_USED], 2);
  assert.equal(nes.cpu.mem[INV_ITEMS], relicItem.id, 'the relic should have moved down into slot 0');
  assert.equal(nes.cpu.mem[INV_SEL], 0);
});
