// The Equip screen (ROADMAP item 5, build commit C4; docs/design-equipment.md section 4, test rows 13 and 15's jsnes half).
//
// Every scenario boots a real ROM in the vendored jsnes core under Emulator.stepInstruction() (test/lib/equipscreen.js) and presses
// real pad buttons through the real input table: `equip` is bound to Select in play and in the bag, the battle row is never touched
// (E9). Each test names the wrong implementation it catches. The three engine negative controls (F1: no bt_from_ent, no setup_monsters
// reset, no `pla; pla`) and the unbounded-publish control are built as Code Forge overrides of the stock file with one asserted-unique
// edit, so they run in the suite and never touch the repository; the same scenario that passes on the stock engine must FAIL on each.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  gearProject,
  gearStreamedProject,
  screenFor,
  withEngineEdit,
  BUTTON,
  R,
  ST,
  BP,
  NO_ITEM,
  NO_ENTITY,
  piece,
  WEAPON,
  ARMOR,
  RAM
} from '../lib/equipscreen.js';
import { equate } from '../lib/equipharness.js';
import { ARROW_TILE, charToTile } from '../../shared/font.js';

const hasNesasm = spawnSync('nesasm', [], { encoding: 'utf8' }).error === undefined;
const skip = !hasNesasm && 'nesasm not found on PATH';
const BOARDS = [1, 4, 30]; // MMC1, MMC3, UNROM 512: the RPG-capable boards
const BOARD_NAME = { 1: 'MMC1', 4: 'MMC3', 30: 'UNROM 512' };

/** Boot a gear project to the field with members 0-2 recruited and `bag` in the pack. */
async function field(t, mapper, bag = [1, 2, 3, 4, 9, 10, 11], mutate) {
  const screen = await screenFor(t, await gearProject({ mapper, mutate }));
  screen.boot();
  screen.recruit(0, 1, 2);
  screen.setBag(bag);
  screen.frames(3);
  return screen;
}

const numbers = (text) => (text.match(/\d+/g) ?? []).map(Number);
const trim = (text) => text.replace(/^[#| ]+|[#| ]+$/g, '').replace(/ {2,}/g, ' ');

// ---------------------------------------------------------------------------------------------------- 13. the screen end to end

for (const mapper of BOARDS) {
  test(`${BOARD_NAME[mapper]}: Equip opens from play and from the bag, changes member, equips, unequips and leaves with the field exactly as it was`, { skip }, async (t) => {
    // Catches, in one walk: an opener that does not freeze the field; a header that does not name the active member; a member step that lands on
    // an unrecruited slot or does not wrap; a commit that does not move the piece between the bag and the slot (bag identities are exact); a
    // leave that returns into the battle bank, leaves enc_step, a pending entity or a live script behind, or does not restore the screen bank.
    const screen = await field(t, mapper);
    const names = screen.built.project.party.map((m) => m.name);
    screen.frames(2);
    const sp = screen.readySp;
    const window = screen.window();
    const enc = screen.mem[R.ENC_STEP];
    assert.ok(sp > 0, 'the main loop was measured');

    // --- from play
    screen.openFromGameplay();
    assert.equal(screen.state, ST.BATTLE, 'Equip runs as battle phases');
    assert.equal(screen.phase, BP.EQ_SLOTS);
    assert.equal(screen.mem[R.BT_ACTOR], 0, 'the first recruited member');
    assert.match(screen.row(0), new RegExp(`EQUIP +${names[0]}`));
    assert.match(trim(screen.row(1)), /^>WEAPON +NONE$/);
    assert.match(trim(screen.row(2)), /^ ?ARMOR +NONE$/);
    assert.match(trim(screen.row(3)), /^ ?ACCESSORY +NONE$/);
    assert.match(trim(screen.row(6)), /A:PICK B:OUT/);
    assert.ok(screen.battleFetches > 0, 'the Equip tick runs from the battle bank (the window is mapped for the tick only)');

    // --- change member: 0 -> 1 -> 2 -> (3 is not recruited) -> 0, and Left from 0 -> 2
    for (const [button, member] of [[BUTTON.RIGHT, 1], [BUTTON.RIGHT, 2], [BUTTON.RIGHT, 0], [BUTTON.LEFT, 2], [BUTTON.LEFT, 1], [BUTTON.LEFT, 0]]) {
      screen.tap(button, 4);
      assert.equal(screen.mem[R.BT_ACTOR], member, `member after ${button === BUTTON.RIGHT ? 'Right' : 'Left'}`);
      assert.match(screen.row(0), new RegExp(`EQUIP +${names[member]}`), `the header names member ${member}`);
    }

    // --- equip the weapon: A opens the list, the cursor starts on the first piece, A wears it
    screen.tap(BUTTON.A, 4);
    assert.equal(screen.phase, BP.EQ_LIST);
    assert.equal(screen.mem[R.BT_LEN], 4, 'four weapons in the bag, the Wand is not Rian\'s to wear');
    assert.equal(screen.mem[R.BT_SEL], 1, 'the cursor starts on the first piece, never on NONE');
    assert.deepEqual(Array.from(screen.mem.slice(R.BT_LIST, R.BT_LIST + 4)), [1, 2, 3, 4], 'the list is the bag\'s pieces for this slot, in bag order');
    const before = numbers(screen.row(4));
    screen.tap(BUTTON.A, 4);
    assert.equal(screen.phase, BP.EQ_SLOTS, 'wearing a piece returns to the slot rows');
    assert.deepEqual(screen.worn(), [1, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255], 'Sword1 on member 0, weapon slot');
    assert.deepEqual(screen.bag(), [2, 3, 4, 9, 10, 11], 'the worn piece left the bag');
    assert.equal(screen.mem[R.PC_EQ_ATK], 1, 'the cached ATK bonus is the piece\'s');
    assert.match(trim(screen.row(1)), /^>WEAPON +Sword1$/);
    assert.deepEqual(numbers(screen.row(4)).slice(0, 2), [before[0] + 1, before[0] + 1], 'the ATK line shows the new total on both sides once worn');

    // --- unequip: the NONE row (Up from the first piece), the old piece goes back to the END of the bag
    screen.tap(BUTTON.A, 4);
    assert.equal(screen.mem[R.BT_SEL], 1);
    screen.tap(BUTTON.UP, 3);
    assert.equal(screen.mem[R.BT_SEL], 0, 'the NONE row');
    screen.tap(BUTTON.A, 4);
    assert.equal(screen.phase, BP.EQ_SLOTS);
    assert.deepEqual(screen.worn(), Array(12).fill(NO_ITEM), 'the slot is empty again');
    assert.deepEqual(screen.bag(), [2, 3, 4, 9, 10, 11, 1], 'the taken-off piece returns to the end of the bag');
    assert.equal(screen.mem[R.PC_EQ_ATK], 0);

    // --- B out from the slot rows: gameplay, the field exactly as it was
    screen.tap(BUTTON.B, 12);
    assert.equal(screen.state, ST.GAMEPLAY);
    screen.frames(40);
    assert.equal(screen.state, ST.GAMEPLAY, 'nothing took the field over after the exit (an entry event replaying would)');
    assert.equal(screen.readySp, sp, 'the main loop\'s stack pointer is what it was before the open');
    assert.deepEqual(screen.window(), window, 'the field\'s screen bank is mapped again');
    assert.equal(screen.windowFetches, 0, 'no instruction was fetched from the switchable window once the field was back');
    assert.equal(screen.mem[R.ENC_STEP], enc, 'enc_step is zero, as battle_end leaves it');
    assert.equal(screen.mem[R.ENC_STEP], 0);
    assert.equal(screen.mem[R.PENDING_ENT], NO_ENTITY, 'no pending touch or enter event');
    assert.equal(screen.mem[R.SCRIPT_ACTIVE], 0, 'no script is running');

    // --- from the bag: B opens the inventory, Select opens Equip, B out lands on the field (not the bag)
    screen.openFromBag();
    assert.equal(screen.state, ST.BATTLE);
    assert.equal(screen.phase, BP.EQ_SLOTS);
    screen.tap(BUTTON.B, 12);
    screen.frames(20);
    assert.equal(screen.state, ST.GAMEPLAY, 'leaving Equip from the bag goes to the field');
    assert.equal(screen.readySp, sp);
    assert.deepEqual(screen.window(), window);
    assert.equal(screen.windowFetches, 0);
  });
}

test('Equip leaves a running field exactly where it was: the entry event does not replay (a Give on screen entry)', { skip }, async (t) => {
  // Catches a leave that redraws the field without battle_end's `pending_ent = NO_ENTITY`: spawn_entities arms the screen's enter event
  // again on every redraw, so every visit to Equip would re-run it. The event here is a Give, which leaves a countable trace in the bag.
  const project = await gearProject({
    mutate: (p) => {
      const actorId = p.sprites.actors.length;
      p.sprites.actors.push({ name: 'Greeter', behavior: 'npc', hp: 1, damage: 0 });
      p.maps[0].screens[0].entities.push({
        actorId,
        x: 200,
        y: 40,
        props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', item: 0 }] }] } }
      });
    }
  });
  const screen = await screenFor(t, project);
  screen.boot(90);
  screen.recruit(0, 1);
  const bagAfterBoot = screen.bag();
  assert.ok(bagAfterBoot.includes(0), 'precondition: the entry event ran once at boot and gave the Potion');
  screen.setBag([...bagAfterBoot, 1]);
  const expected = screen.bag();
  screen.openFromGameplay();
  screen.tap(BUTTON.B, 12);
  screen.frames(60);
  assert.equal(screen.state, ST.GAMEPLAY);
  assert.deepEqual(screen.bag(), expected, 'the entry event did not run again');
  assert.equal(screen.mem[R.PENDING_ENT], NO_ENTITY);
});

// ---------------------------------------------------------------------------------------------------- 13. F1: the dedicated entry

/**
 * The F1 first-use scenario: a fresh boot (so bt_from_ent is its power-on value, 0, which names entity slot 0) with entity 0 active;
 * open Equip and leave. Returns the facts the three negative controls are judged on.
 */
function firstUse(screen) {
  screen.recruit(0, 1);
  const entity0Before = screen.mem[R.ENT_ACTIVE];
  const fromEntBefore = screen.mem[R.BT_FROM_ENT];
  screen.openFromGameplay();
  const fromEntOpen = screen.mem[R.BT_FROM_ENT];
  screen.tap(BUTTON.B, 12);
  screen.frames(20);
  return { entity0Before, fromEntBefore, fromEntOpen, entity0After: screen.mem[R.ENT_ACTIVE], state: screen.state };
}

test('F1 first use: a boot with an entity in slot 0, open Equip, B out -> entity 0 is still there and bt_from_ent was NO_ENTITY', { skip }, async (t) => {
  // Catches an opener that reaches battle_end with bt_from_ent still at its power-on 0: battle_end reads it as "the entity that started this
  // fight" and deactivates entity slot 0 (the player's first neighbour vanishes after a visit to a menu).
  const screen = await field(t, 1);
  const facts = firstUse(screen);
  assert.equal(facts.fromEntBefore, 0, 'precondition: bt_from_ent is the power-on 0, which names slot 0');
  assert.equal(facts.entity0Before, 1, 'precondition: entity 0 is active on the first screen');
  assert.equal(facts.fromEntOpen, NO_ENTITY);
  assert.equal(facts.entity0After, 1, 'entity 0 survived the visit');
  assert.equal(facts.state, ST.GAMEPLAY);
});

test('negative control F1 (a): without `bt_from_ent = NO_ENTITY` entity 0 is deactivated on exit', { skip }, async (t) => {
  const project = withEngineEdit(await gearProject(), 'battle.asm', [['  lda #NO_ENTITY\n  sta <bt_from_ent\n  ldx #0\neq_in_member:', '  ldx #0\neq_in_member:']]);
  const screen = await screenFor(t, project);
  screen.boot();
  const facts = firstUse(screen);
  assert.equal(facts.entity0Before, 1);
  assert.equal(facts.entity0After, 0, 'the sabotaged engine deactivates entity 0 -- the check above is what catches it');
});

/**
 * The F1 flee scenario: a real fight is started and fled from (hit feedback and miss are on), which leaves monsters flagged live and the
 * feedback timers set; then Equip is opened. Returns what the screen then sees.
 */
function afterFlee(screen) {
  screen.recruit(0, 1);
  walk(screen, 160, 176);
  walk(screen, 176, 176, 200);
  assert.equal(screen.runUntil(() => screen.state === ST.BATTLE && screen.phase === BP.MENU, 900), true, 'walking into Slime starts a fight and reaches the first menu');
  // Make the stale state certain rather than hoped for: the fight may be walked away from, both feedback timers are running, and a second
  // monster flag is live -- what a mid-fight flee leaves behind. Then the real flee path (battle_end with bt_flee set) takes the party out.
  const fromEnt = screen.mem[R.BT_FROM_ENT];
  assert.ok(fromEnt < 8, 'precondition: the fight was started by a placed monster');
  screen.mem[R.BT_ESC] = 1;
  screen.mem[R.BT_HURT_LEFT] = 5;
  screen.mem[R.BT_MISS_LEFT] = 5;
  let fled = false;
  for (let attempt = 0; attempt < 80 && !fled; attempt++) {
    // The battle menu: FIGHT, MAGIC, ITEM, RUN -- Down until RUN, A. The party is kept alive (the slime would win the long way round) and the
    // wait varies per attempt, because the flee roll is the frame-synchronised RNG and a fixed rhythm can lose it for ever.
    screen.mem[R.BT_ESC] = 1;
    for (let i = 0; i < 4; i++) screen.mem[0x0398 + i] = screen.mem[0x039c + i]; // pc_hp := pc_hp_max (engine/constants.asm)
    if (screen.phase === BP.MENU) {
      for (let i = 0; i < 4 && screen.mem[R.BT_SEL] !== 3; i++) screen.tap(BUTTON.DOWN, 4);
    }
    screen.tap(BUTTON.A, 8 + ((attempt * 5) % 11));
    // BS_FLED waits for a button before the fight ends.
    // One frame at a time: Slime is still touching the party, so a few spare frames after the field returns would start the next fight.
    for (let i = 0; i < 400 && screen.mem[R.BT_FLEE] === 1 && screen.state !== ST.GAMEPLAY; i++) {
      screen.emu.setButton(BUTTON.A, i % 8 === 0);
      screen.frame();
    }
    screen.emu.setButton(BUTTON.A, false);
    fled = screen.state === ST.GAMEPLAY;
  }
  assert.ok(fled, 'the party ran away');
  // A flee leaves the monster standing against the party, and the very next frame would touch it again; stand it down so the stale fight state
  // is what Equip meets (the test arranges the field, it does not touch the state under test).
  screen.mem[R.ENT_ACTIVE + fromEnt] = 0;
  const stale = { alive: screen.mem[R.MON_SLOT_ALIVE], hurt: screen.mem[R.BT_HURT_LEFT], miss: screen.mem[R.BT_MISS_LEFT] };
  screen.openFromGameplay();
  return { stale, alive: [0, 1, 2, 3].map((i) => screen.mem[R.MON_SLOT_ALIVE + i]), hurt: screen.mem[R.BT_HURT_LEFT], miss: screen.mem[R.BT_MISS_LEFT], actors: [0, 1, 2, 3].map((i) => screen.mem[R.MON_SLOT_ACTOR + i]) };
}

function walk(screen, x, y, budget = 600) {
  for (let i = 0; i < budget; i++) {
    if (screen.state !== ST.GAMEPLAY) return;
    const dx = x - screen.mem[R.PLAYER_X];
    const dy = y - screen.mem[0x11]; // player_y
    let button = null;
    if (dx > 1) button = BUTTON.RIGHT;
    else if (dx < -1) button = BUTTON.LEFT;
    else if (dy > 1) button = BUTTON.DOWN;
    else if (dy < -1) button = BUTTON.UP;
    if (button === null) return;
    screen.emu.setButton(button, true);
    screen.frame();
    screen.emu.setButton(button, false);
  }
}

test('F1 after a flee: open Equip -> no monster live, no hit or miss timer, no monster in any slot', { skip }, async (t) => {
  // Catches an intro that does not run the fight-only reset: a flee leaves monsters flagged live and the feedback timers set, and the
  // Equip screen would draw monster sprites and tick hurt/miss fx over the menu.
  const screen = await field(t, 1);
  const facts = afterFlee(screen);
  assert.ok(facts.stale.alive !== 0 || facts.stale.hurt !== 0 || facts.stale.miss !== 0, 'precondition: the flee left stale fight state behind');
  assert.deepEqual(facts.alive, [0, 0, 0, 0], 'mon_slot_alive is zero');
  assert.equal(facts.hurt, 0, 'bt_hurt_left is zero');
  assert.equal(facts.miss, 0, 'bt_miss_left is zero');
  assert.deepEqual(facts.actors, [NO_ITEM, NO_ITEM, NO_ITEM, NO_ITEM], 'every monster slot is empty');
  assert.equal(screen.phase, BP.EQ_SLOTS);
});

test('negative control F1 (b): without the setup_monsters reset a flee\'s live flags and timers survive into Equip', { skip }, async (t) => {
  const project = withEngineEdit(await gearProject(), 'battle.asm', [['  jsr setup_monsters\n  lda #NO_ENTITY\n  sta <bt_from_ent\n  ldx #0\neq_in_member:', '  lda #NO_ENTITY\n  sta <bt_from_ent\n  ldx #0\neq_in_member:']]);
  const screen = await screenFor(t, project);
  screen.boot();
  const facts = afterFlee(screen);
  assert.ok(facts.alive.some((flag) => flag !== 0) || facts.hurt !== 0 || facts.miss !== 0, 'the sabotaged engine leaves fight state live -- the check above is what catches it');
});

test('negative control F1 (c): without `pla; pla` the exit returns into the battle bank with the field mapped (fetches from the window)', { skip }, async (t) => {
  // Without the two pla the rts after battle_end returns to equip_dispatch's caller inside the switchable window, which battle_end's redraw
  // has just re-mapped to the field's screen data: the stack is balanced either way, so only the fetch count sees it.
  const project = withEngineEdit(await gearProject(), 'battle.asm', [['eq_leave:\n  pla\n  pla\n  jmp battle_end', 'eq_leave:\n  jmp battle_end']]);
  const screen = await screenFor(t, project);
  screen.boot();
  screen.recruit(0, 1);
  screen.openFromGameplay();
  screen.tap(BUTTON.B, 4);
  screen.frames(6);
  assert.ok(screen.windowFetches > 0 || screen.mem[R.GAME_STATE] !== ST.GAMEPLAY, 'the sabotaged exit executes screen data as code -- the fetch check is what catches it');
});

// ---------------------------------------------------------------------------------------------------- 13. F2: the pick list

for (const mapper of BOARDS) {
  test(`${BOARD_NAME[mapper]}: F2 eight pieces plus NONE: nine navigable rows, wrap, the last piece is worn, the bag drops to seven`, { skip }, async (t) => {
    // Catches a list that stops at the first screenful (bt_len 4), a navigation length off by one (NONE unreachable, or a phantom ninth piece),
    // a scroll that loses the cursor, and a commit that reads the wrong row (row r is bt_list[r-1], row 0 is NONE).
    const screen = await field(t, mapper, [1, 2, 3, 4, 5, 6, 7, 8]);
    screen.openFromGameplay();
    screen.tap(BUTTON.A, 4);
    assert.equal(screen.phase, BP.EQ_LIST);
    assert.equal(screen.mem[R.BT_LEN], 8, 'eight eligible pieces');
    assert.equal(screen.mem[R.BT_SEL], 1);
    const seen = [screen.mem[R.BT_SEL]];
    const scrolls = [screen.mem[R.BT_SCROLL]];
    for (let i = 0; i < 7; i++) {
      screen.tap(BUTTON.DOWN, 2);
      seen.push(screen.mem[R.BT_SEL]);
      scrolls.push(screen.mem[R.BT_SCROLL]);
    }
    assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8], 'seven Downs reach the last piece');
    // The window moves the moment the cursor would leave it (scroll = sel - 2), not a row late: a follow that lands one row high ends in the
    // same place (6) by a different path ([0, 0, 2, 2, 4, 4, 6, 6]), so the path is what is pinned.
    assert.deepEqual(scrolls, [0, 0, 1, 2, 3, 4, 5, 6], 'the window follows the cursor one row at a time once it reaches the third visible row');
    assert.equal(screen.mem[R.BT_SCROLL], 6, 'three rows are visible, so the window follows to rows 6-8');
    assert.match(screen.row(1), /Sword6/);
    assert.match(screen.row(3), /Sword8/);
    screen.tap(BUTTON.DOWN, 2);
    assert.equal(screen.mem[R.BT_SEL], 0, 'one more Down wraps to NONE');
    assert.equal(screen.mem[R.BT_SCROLL], 0);
    assert.match(trim(screen.row(1)), /^>NONE/);
    screen.tap(BUTTON.UP, 2);
    assert.equal(screen.mem[R.BT_SEL], 8, 'Up from NONE wraps to the last piece');
    screen.frames(6);
    screen.tap(BUTTON.A, 6);
    assert.equal(screen.worn()[0], 8, 'Sword8 is worn');
    assert.deepEqual(screen.bag(), [1, 2, 3, 4, 5, 6, 7], 'the bag dropped to the other seven, order kept');
    assert.equal(screen.mem[R.PC_EQ_ATK], 8);
  });
}

test('F2 NONE with a full bag is refused: BAG FULL in the hint, the list stays open, the slot and the bag are untouched', { skip }, async (t) => {
  // Catches a take-off that drops the piece (or loses it) when the bag has no room, and a refusal that closes the list or says nothing.
  const screen = await field(t, 1, [2, 3, 4, 5, 6, 7, 8, 9]);
  screen.setWorn(0, 1);
  screen.mem[0x07e0] = 1; // pc_eq_atk[0]: the cache that matches the worn Sword1
  screen.openFromGameplay();
  screen.tap(BUTTON.A, 4);
  assert.equal(screen.phase, BP.EQ_LIST);
  screen.tap(BUTTON.UP, 3);
  assert.equal(screen.mem[R.BT_SEL], 0);
  screen.tap(BUTTON.A, 6);
  assert.equal(screen.phase, BP.EQ_LIST, 'the list stays open');
  assert.match(screen.row(6), /BAG FULL/);
  assert.equal(screen.worn()[0], 1, 'Sword1 is still worn');
  assert.deepEqual(screen.bag(), [2, 3, 4, 5, 6, 7, 8, 9], 'the full bag is exactly as it was');
  assert.equal(screen.mem[R.INV_COUNT], 8);
  // Moving the cursor puts the normal hint back.
  screen.tap(BUTTON.DOWN, 4);
  assert.match(screen.row(6), /A:OK/);
});

test('allowed members only: the pick list shows exactly the pieces whose usableBy has the active member\'s bit', { skip }, async (t) => {
  // Catches a list that ignores usableBy, or reads the wrong member's bit after a member change.
  const screen = await field(t, 1, [1, 11, 2]);
  screen.openFromGameplay();
  screen.tap(BUTTON.A, 4);
  assert.deepEqual(Array.from(screen.mem.slice(R.BT_LIST, R.BT_LIST + screen.mem[R.BT_LEN])), [1, 2], 'member 0 may not wear the Wand (usable by member 1 only)');
  screen.tap(BUTTON.B, 4);
  assert.equal(screen.phase, BP.EQ_SLOTS);
  screen.tap(BUTTON.RIGHT, 4);
  screen.tap(BUTTON.A, 4);
  assert.deepEqual(Array.from(screen.mem.slice(R.BT_LIST, R.BT_LIST + screen.mem[R.BT_LEN])), [1, 11, 2], 'member 1 may');
  screen.tap(BUTTON.DOWN, 3);
  screen.tap(BUTTON.A, 6);
  assert.equal(screen.worn()[1], 11, 'the Wand is on member 1');
  assert.deepEqual(screen.bag(), [1, 2]);
});

test('the stat preview is the engine\'s own number: the highlighted piece trial-worn, read, and put back', { skip }, async (t) => {
  // Catches a preview that adds the piece's stat itself (no saturation, wrong member), and one that forgets to restore the slot.
  const screen = await field(t, 1, [1, 2, 3, 4, 9, 10, 11]);
  screen.openFromGameplay();
  const [base] = numbers(screen.row(4));
  screen.tap(BUTTON.A, 4);
  for (const [sel, id] of [[1, 1], [2, 2], [3, 3], [4, 4]]) {
    assert.equal(screen.mem[R.BT_SEL], sel);
    assert.deepEqual(numbers(screen.row(4)).slice(0, 2), [base, base + id], `Sword${id}: ATK before and after`);
    assert.equal(screen.worn()[0], NO_ITEM, 'the trial never leaves the slot changed');
    assert.equal(screen.mem[R.PC_EQ_ATK], 0, 'nor the cached bonus');
    screen.tap(BUTTON.DOWN, 3);
  }
});

test('MAG and MDEF cells are blank when the build has neither stat, and shown when it has them', { skip }, async (t) => {
  // Catches a stat line that prints MAG 0>0 in a game with no magic power, or never prints it where magic exists.
  const plainGear = await gearProject({
    mutate: (p) => {
      p.items = p.items.filter((item) => !item.equip || (item.equip.mag === 0 && item.equip.mdef === 0));
      p.items.forEach((item, i) => (item.id = i));
      for (const member of p.party) Object.assign(member, { baseMag: 0, magPerLevel: 0, baseMdef: 0, mdefPerLevel: 0 });
      for (const actor of p.sprites.actors) if (actor.battle) Object.assign(actor.battle, { mag: 0, mdef: 0 });
    }
  });
  const screen = await screenFor(t, plainGear);
  screen.boot();
  screen.openFromGameplay();
  assert.match(trim(screen.row(4)), /^ATK +\d+>\s*\d+ DEF +\d+>\s*\d+$/);
  assert.equal(trim(screen.row(5)), '', 'no MAG or MDEF cell');
  const gear = await field(t, 1);
  gear.openFromGameplay();
  assert.match(trim(gear.row(5)), /^MAG +\d+>\s*\d+ MDEF +\d+>\s*\d+$/);
});

for (const mapper of BOARDS) {
  test(`${BOARD_NAME[mapper]}: every stat cell's current-to-candidate separator is the font's '>' (EQ_CMP_TILE), never the cursor's down-pointing ARROW_TILE`, { skip }, async (t) => {
    // Catches (review C5 N1) a separator drawn with ARROW_TILE: it decodes to '>' in text, but on screen it is a down-pointing triangle, so an
    // unchanged stat read 11v11 and an increase looked like a decrease. The decoded rows cannot tell the two apart, so this reads the raw tiles.
    const screen = await field(t, mapper);
    const cmp = equate(screen.built, 'EQ_CMP_TILE');
    assert.equal(cmp, charToTile('>'), 'the build\'s equate is the font\'s own \'>\' position');
    assert.notEqual(cmp, ARROW_TILE);
    screen.openFromGameplay();
    // The cursor itself stays the arrow: the slot row carries ARROW_TILE and no comparison glyph.
    assert.equal(screen.rawRow(1).filter((tile) => tile === ARROW_TILE).length, 1, 'the cursor is still ARROW_TILE');
    assert.ok(screen.rawRow(1).every((tile) => tile !== cmp), 'and a slot row has no comparison glyph');
    // The default gear carries MAG and MDEF, so all four cells are on: ATK/DEF in row 4, MAG/MDEF in row 5. Two separators per row.
    for (const n of [4, 5]) {
      const tiles = screen.rawRow(n);
      assert.equal(tiles.filter((tile) => tile === cmp).length, 2, `row ${n}: two cells, two comparison glyphs (${screen.row(n)})`);
      assert.equal(tiles.filter((tile) => tile === ARROW_TILE).length, 0, `row ${n}: no cursor glyph in a stat cell`);
    }
    // A list open with a candidate under the cursor redraws the cells: the separator is the same tile then too.
    screen.tap(BUTTON.A, 4);
    screen.tap(BUTTON.DOWN, 3);
    for (const n of [4, 5]) {
      const tiles = screen.rawRow(n);
      assert.equal(tiles.filter((tile) => tile === cmp).length, 2, `list open, row ${n}: two comparison glyphs`);
      assert.equal(tiles.filter((tile) => tile === ARROW_TILE).length, 0, `list open, row ${n}: no cursor glyph in a stat cell`);
    }
  });

  test(`${BOARD_NAME[mapper]}: the '>' glyph is in the build's CHR (the message-font reservation), and is not the cursor's glyph`, { skip }, async (t) => {
    // Catches a comparison glyph whose tile is not stamped (a blank separator): the glyph must be non-blank at EQ_CMP_TILE in the page the
    // text draws from, and differ from ARROW_TILE's. A split board (MMC3) carries the font only in its own last CHR page.
    const built = (await field(t, mapper)).built;
    const cmp = equate(built, 'EQ_CMP_TILE');
    const assets = path.join(built.dir, 'build', 'assets');
    let pages = fs.readdirSync(assets).filter((name) => /^(tiles\d+\.chr|chrram\d+\.bin)$/.test(name)).sort();
    // Without a split every tileset carries the font (a page past the last tileset is board padding); with one, only the font's own page does.
    pages = equate(built, 'SPLIT_ENABLED') === 1 ? pages.slice(-1) : pages.slice(0, built.project.tilesets.length);
    assert.ok(pages.length > 0);
    const block = (data, tile) => data.subarray(tile * 16, tile * 16 + 16);
    for (const name of pages) {
      const data = fs.readFileSync(path.join(assets, name));
      const glyph = block(data, cmp);
      assert.ok(glyph.some((byte) => byte !== 0), `${name}: the '>' tile is stamped`);
      assert.notDeepEqual(Buffer.from(glyph), Buffer.from(block(data, ARROW_TILE)), `${name}: the comparison glyph is not the cursor's`);
    }
  });
}

// ---------------------------------------------------------------------------------------------------- 13. the opener's refusals

test('paused: the opener does nothing; unpaused it opens', { skip }, async (t) => {
  // Catches an opener that accepts `paused` (main_loop skips ui_tick while paused, so Equip would open with nothing driving it).
  const screen = await field(t, 1);
  screen.tap(BUTTON.START, 4);
  assert.equal(screen.mem[R.PAUSED], 1, 'precondition: Start paused the world');
  screen.tap(BUTTON.SELECT, 6);
  assert.equal(screen.state, ST.GAMEPLAY, 'Select did nothing while paused');
  assert.ok(![BP.EQ_INTRO, BP.EQ_SLOTS, BP.EQ_LIST].includes(screen.phase), 'no Equip phase was entered');
  screen.tap(BUTTON.START, 4);
  assert.equal(screen.mem[R.PAUSED], 0);
  screen.openFromGameplay();
  assert.equal(screen.phase, BP.EQ_SLOTS);
});

test('negative control: an opener that accepts `paused` opens Equip with nothing driving it', { skip }, async (t) => {
  const project = withEngineEdit(await gearProject(), 'input.asm', [['do_action_equip:\n  lda <paused\n  bne do_action_none\n', 'do_action_equip:\n']]);
  const screen = await screenFor(t, project);
  screen.boot();
  screen.recruit(0, 1);
  screen.tap(BUTTON.START, 4);
  assert.equal(screen.mem[R.PAUSED], 1);
  screen.tap(BUTTON.SELECT, 8);
  assert.equal(screen.state, ST.BATTLE, 'the sabotaged opener opened while paused -- the refusal test above is what catches it');
});

test('every other state refuses the action: dialogue, battle and a missing-member game open nothing', { skip }, async (t) => {
  // Catches an opener that tests only `paused` and opens over a conversation or a fight. `equip` is bound in EVERY state's row here so the
  // refusal is do_action_equip's own, not an absent binding.
  const everywhere = (p) => {
    for (const row of Object.values(p.input.states)) row.SELECT = 'equip';
  };
  const screen = await field(t, 1, [1, 2, 3], everywhere);
  // A fight: the battle row is inert (E9), so the press must not reach do_action at all.
  walk(screen, 160, 176);
  walk(screen, 176, 176, 200);
  assert.equal(screen.runUntil(() => screen.state === ST.BATTLE && screen.phase === BP.MENU, 900), true);
  screen.tap(BUTTON.SELECT, 8);
  assert.equal(screen.state, ST.BATTLE);
  assert.equal(screen.phase, BP.MENU, 'the fight menu was not replaced by Equip');
  // A conversation: game_state is ST_DIALOG with a box up. Poke the state (the input row then comes from the dialog row, which binds equip).
  const dialog = await field(t, 1, [1, 2, 3], everywhere);
  dialog.mem[R.GAME_STATE] = ST.DIALOG;
  dialog.tap(BUTTON.SELECT, 8);
  assert.ok(![BP.EQ_INTRO, BP.EQ_SLOTS, BP.EQ_LIST].includes(dialog.phase) || dialog.state !== ST.BATTLE, 'no Equip phase over a dialogue');
  assert.notEqual(dialog.state, ST.BATTLE);
});

// ---------------------------------------------------------------------------------------------------- 13. a chord that opens Equip (review R1 of C4)

// do_action_equip switches game_state to ST_BATTLE and returns; dispatch_input looks the state up again for every button, so a button later in
// the same pass would read the BATTLE row against a screen whose first frame has not run. Two real chords reach it with ordinary bindings:
// A(equip)+B(cancel, the stock battle B) cancelled the screen before eq_intro ran, and Select(equip)+Start(pause, an accepted authored battle
// START) paused a world that had just handed its tick to Equip -- a state main_loop's paused skip then made unrecoverable.
const chordProject = (mutate) => gearProject({ mutate });
const A_EQUIP = (p) => {
  p.input.states.gameplay.A = 'equip';
  p.input.states.menu.A = 'equip';
};
const START_PAUSES_IN_BATTLE = (p) => {
  p.input.states.battle.START = 'pause';
};
/** Press `buttons` together for one frame, then let Equip's intro and first rows run. */
function chord(screen, buttons) {
  for (const b of buttons) screen.emu.setButton(b, true);
  screen.frame();
  for (const b of buttons) screen.emu.setButton(b, false);
  screen.frames(24);
}
/** Settle a booted field and return to a pad-clean state before a chord (the first frame after a screen is drawn drops the pad). */
async function chordField(t, mutate, fromBag, edits) {
  let project = await chordProject(mutate);
  if (edits) project = withEngineEdit(project, ...edits);
  const screen = await screenFor(t, project);
  screen.boot();
  screen.recruit(0, 1, 2);
  screen.setBag([1, 2, 3]);
  screen.frames(3);
  if (fromBag) {
    screen.tap(BUTTON.B, 4); // gameplay B is `item`: the bag opens
    assert.equal(screen.state, ST.MENU, 'precondition: the bag is open');
  }
  return screen;
}
const NO_GUARD = ['input.asm', [['  lda <game_state           ; a press that opened the Equip screen has taken the rest of the pass: the buttons after it\n  cmp #ST_BATTLE            ; would be read against the battle row it selected (B -> cancel, Start -> pause) before\n  beq dispatch_done         ; eq_intro has drawn a frame of the screen (review R1 of C4)\n', '']]];

for (const fromBag of [false, true]) {
  test(`A(equip)+B(cancel) pressed together ${fromBag ? 'in the bag' : 'in play'} ends with Equip open on its slot rows, not cancelled`, { skip }, async (t) => {
    // Catches an opener that leaves the rest of the dispatch pass running: B then reads the battle row's `cancel` and close_ui drops the new
    // screen (state 0 with bt_phase left at BP_EQ_INTRO) before eq_intro ever drew it.
    const screen = await chordField(t, A_EQUIP, fromBag);
    chord(screen, [BUTTON.A, BUTTON.B]);
    assert.equal(screen.state, ST.BATTLE, 'Equip is open');
    assert.equal(screen.phase, BP.EQ_SLOTS, 'on its slot rows');
    assert.equal(screen.mem[R.PAUSED], 0);
    assert.equal(screen.mem[R.BOX_STATE], 0);
  });

  test(`Select(equip)+Start(pause in the battle row) pressed together ${fromBag ? 'in the bag' : 'in play'} opens Equip unpaused`, { skip }, async (t) => {
    // Catches the same leak through Start: the authored battle START=pause paused the world the instant Equip opened, after which the
    // dispatcher skips battle input and main_loop skips ui_tick -- Equip could not be left.
    const screen = await chordField(t, START_PAUSES_IN_BATTLE, fromBag);
    chord(screen, [BUTTON.SELECT, BUTTON.START]);
    assert.equal(screen.state, ST.BATTLE, 'Equip is open');
    assert.equal(screen.phase, BP.EQ_SLOTS, 'on its slot rows');
    assert.equal(screen.mem[R.PAUSED], 0, 'the world is not paused');
    screen.tap(BUTTON.B, 6);
    assert.equal(screen.state, ST.GAMEPLAY, 'B leaves: the screen is still being driven');
  });
}

test('negative control: an opener that leaves the dispatch pass running lets B cancel and Start pause the screen it just opened', { skip }, async (t) => {
  const cancelled = await chordField(t, A_EQUIP, false, NO_GUARD);
  chord(cancelled, [BUTTON.A, BUTTON.B]);
  assert.equal(cancelled.state, ST.GAMEPLAY, 'B cancelled before the intro ran -- the A+B tests above are what catch it');
  assert.equal(cancelled.phase, BP.EQ_INTRO);
  const paused = await chordField(t, START_PAUSES_IN_BATTLE, false, NO_GUARD);
  chord(paused, [BUTTON.SELECT, BUTTON.START]);
  assert.equal(paused.mem[R.PAUSED], 1, 'Start paused the opening screen -- the Select+Start tests above are what catch it');
});

// ---------------------------------------------------------------------------------------------------- 13. Equip Back (E9) and the input table

test('Equip Back: B in the list returns to the slot rows, B on a slot row leaves; the generated input rows carry no Equip entry', { skip }, async (t) => {
  // Catches a list B that leaves the field outright (losing the slot rows), a slot-row B that stays, and an Equip implementation that edits the
  // battle input row (E9: the screen reads the pad directly; the row stays inert under ST_BATTLE).
  const screen = await field(t, 1);
  screen.openFromGameplay();
  screen.tap(BUTTON.A, 4);
  assert.equal(screen.phase, BP.EQ_LIST);
  screen.tap(BUTTON.B, 4);
  assert.equal(screen.state, ST.BATTLE, 'still in Equip');
  assert.equal(screen.phase, BP.EQ_SLOTS, 'B in the list went back to the slot rows');
  assert.equal(screen.mem[R.EQ_CUR_SLOT], 0);
  screen.tap(BUTTON.B, 12);
  assert.equal(screen.state, ST.GAMEPLAY, 'B on a slot row left');
  const inputInc = fs.readFileSync(path.join(screen.built.dir, 'build', 'assets', 'input.inc'), 'utf8');
  const rows = inputInc.split('\n').filter((line) => /^\s*\.db /.test(line)).map((line) => line.trim());
  // States: gameplay, menu, dialog, title, gameover, battle, nameentry; buttons A, B, SELECT, START; equip is action 9.
  assert.equal(rows[0], '.db $01,$04,$09,$05', 'gameplay: A talk, B item (action 4), Select equip (action 9), Start pause');
  assert.equal(rows[1], '.db $07,$06,$09,$05', 'menu: Select is equip');
  assert.equal(rows[5], '.db $07,$06,$00,$00', 'the battle row is the stock inert row: no generated Equip entry');
});

// ---------------------------------------------------------------------------------------------------- 13. streamed worlds

/** Boot a streamed RPG, open Equip, wear a piece, leave. Returns the facts the field-bank judgement is made of. */
async function streamedSession(t, project) {
  const screen = await screenFor(t, project);
  screen.boot(120);
  screen.recruit(0, 1);
  screen.setBag([1, 2]);
  screen.frames(10);
  const running = screen.state === ST.GAMEPLAY;
  const sp = screen.readySp;
  const window = screen.window();
  screen.openFromGameplay();
  const opened = screen.state === ST.BATTLE;
  const battleFetches = screen.battleFetches;
  screen.tap(BUTTON.A, 4);
  screen.tap(BUTTON.A, 4);
  const worn = screen.worn()[0];
  screen.tap(BUTTON.B, 12);
  screen.frames(240); // a streamed world's redraw on the way out takes tens of frames; the stale return address only runs once it is done
  return {
    running,
    opened,
    battleFetches,
    worn,
    state: screen.state,
    windowBack: JSON.stringify(screen.window()) === JSON.stringify(window),
    windowFetches: screen.windowFetches,
    spBack: screen.readySp === sp
  };
}

for (const mapper of [1, 30]) {
  test(`${BOARD_NAME[mapper]}: Equip from a streamed RPG whose field bank is not the battle bank returns the field bank`, { skip }, async (t) => {
    // Catches an exit that leaves the battle bank mapped (or a stale streamed window): the world's rows are read through the switchable window,
    // so a wrong bank is a different world on the next frame. The window bytes while Equip is up differ from the field's, and are equal again after.
    const facts = await streamedSession(t, gearStreamedProject({ mapper }));
    assert.equal(facts.running, true, 'the streamed world is running');
    assert.equal(facts.opened, true);
    assert.ok(facts.battleFetches > 0, 'the Equip tick runs from the battle bank');
    assert.equal(facts.worn, 1, 'Equip works inside a streamed world');
    assert.equal(facts.state, ST.GAMEPLAY);
    assert.equal(facts.windowBack, true, 'the field bank is mapped again');
    assert.equal(facts.windowFetches, 0);
    assert.equal(facts.spBack, true);
  });

  test(`negative control F8 (d) on ${BOARD_NAME[mapper]}: a streamed exit that skips \`pla; pla\` fails the same field-bank judgement`, { skip }, async (t) => {
    // The same session on an engine whose eq_leave keeps the hook's return address: the rts lands in the window the field's screen data now
    // fills, so the judgement the stock engine passes (no fetch from the window, the field bank back, the stack where it was) must not hold.
    const project = withEngineEdit(gearStreamedProject({ mapper }), 'battle.asm', [['eq_leave:\n  pla\n  pla\n  jmp battle_end', 'eq_leave:\n  jmp battle_end']]);
    const facts = await streamedSession(t, project);
    assert.equal(facts.running && facts.opened, true, 'the control still reaches Equip');
    const judged = facts.state === ST.GAMEPLAY && facts.windowBack && facts.windowFetches === 0 && facts.spBack;
    assert.equal(judged, false, `the control's exit looked like a clean one: ${JSON.stringify(facts)}`);
  });
}

// ---------------------------------------------------------------------------------------------------- 15. F8: the producer accounting (jsnes half)

/** The whole Equip session worth watching: open (every dirty bit set), the list, a member change, a commit, leave. Returns the frames' peaks. */
function session(screen, fromBag) {
  screen.peaks.length = 0;
  if (fromBag) screen.openFromBag();
  else screen.openFromGameplay();
  screen.tap(BUTTON.A, 6);
  screen.tap(BUTTON.DOWN, 6);
  screen.tap(BUTTON.A, 6);
  screen.tap(BUTTON.RIGHT, 12);
  screen.tap(BUTTON.B, 12);
  return screen.peaks.filter((p) => p.state === ST.BATTLE || p.phase >= BP.EQ_INTRO);
}

test('F8(a): vram_len never exceeds 34 on any Equip frame -- opened from play and from the bag, every dirty bit set at the intro', { skip }, async (t) => {
  // One row is 3 header + 30 cells = 33 bytes; the terminator is the 34th. Catches a flush that publishes a second row (or the whole mask) in
  // one tick -- it would be 66+ bytes against the 88 the three field producers already account for.
  for (const fromBag of [false, true]) {
    const screen = await field(t, 1);
    const peaks = session(screen, fromBag);
    const max = Math.max(...peaks.map((p) => p.max));
    assert.ok(peaks.length >= 12, 'the session spans many frames');
    assert.equal(max, 33, `the peak is exactly one row (${fromBag ? 'from the bag' : 'from play'})`);
    assert.ok(max <= 34);
    assert.ok(peaks.filter((p) => p.max === 33).length >= 8, 'the seven intro rows drained one per frame');
  }
});

test('negative control F8(a): publishing two rows per tick exceeds 34', { skip }, async (t) => {
  const project = withEngineEdit(await gearProject(), 'battle.asm', [['eq_slots:\n  jsr eq_flush\n', 'eq_slots:\n  jsr eq_flush\n  jsr eq_flush\n']]);
  const screen = await screenFor(t, project);
  screen.boot();
  screen.recruit(0, 1);
  screen.setBag([1, 2, 3]);
  const max = Math.max(...session(screen, false).map((p) => p.max));
  assert.ok(max > 34, `the sabotaged flush publishes ${max} bytes in one frame -- the <= 34 assertion above is what catches it`);
});

test('F8(a) with Flash: an Equip row and a Flash on-edge share a frame at 33 + 35 = 68 bytes, inside the 88 the producer table gives', { skip }, async (t) => {
  // Equip is not a fourth independent producer: battle_tick runs inside ui_tick, in the slot the four mutually exclusive frozen-world ticks
  // use, so the worst frame is Flash (35) + one Equip row (33) + terminator (1) = 69, or flip (10) + one row (33) + 1 = 44: a frame that holds
  // both a flip and Flash (45) publishes no row at all (E12, below), so the 78-byte frame that settled on scanline 257 on MMC3 never occurs.
  // The Mesen half of this is test/lua/run_equip_nmi_check.sh.
  const project = await gearProject({
    mutate: (p) => {
      const actorId = p.sprites.actors.length;
      p.sprites.actors.push({ name: 'Flasher', behavior: 'npc', hp: 1, damage: 0 });
      p.maps[0].screens[0].entities.push({ actorId, x: 200, y: 40, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] } } });
    }
  });
  const screen = await screenFor(t, project);
  screen.boot();
  screen.recruit(0, 1);
  const flashLeft = screen.built.symbols.flash_left ?? null;
  assert.equal(flashLeft, null, 'flash_left is an equate, not a label');
  // flash_left = fade_reload+1 (engine/constants.asm): resolved from this build's own constants.
  const { scanEquates, resolveEquates } = await import('../lib/equates.js');
  const pending = new Map();
  for (const file of ['constants.asm', 'assets/config.inc', 'assets/cartridge.inc']) scanEquates(fs.readFileSync(path.join(screen.built.dir, 'build', file), 'utf8'), pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  const FLASH_LEFT = symbols.get('flash_left');
  assert.ok(FLASH_LEFT > 0, 'flash_left resolved');
  screen.openFromGameplay();
  // Re-open the dirty mask so a row publishes on the same frame the Flash edge does.
  screen.mem[R.EQ_DIRTY] = 0x7f;
  screen.peaks.length = 0;
  screen.mem[FLASH_LEFT] = 7; // FLASH_ARM_VALUE: the edge publishes on the next flash_tick
  screen.frames(3);
  const max = Math.max(...screen.peaks.map((p) => p.max));
  assert.equal(max, 68, 'Flash (35) + one Equip row (33)');
  assert.ok(max + 10 + 1 <= 88, 'plus a flip (10) and the terminator stays inside the three-producer bound of 88');
});

/** An Equip session whose frame carries a live bound-tile flip AND a Flash edge: the two producers that queue ahead of Equip's tick. */
async function flipFlashSession(t, edits) {
  let project = await gearProject({
    mutate: (p) => {
      const actorId = p.sprites.actors.length;
      p.sprites.actors.push({ name: 'Flasher', behavior: 'npc', hp: 1, damage: 0 });
      p.metatiles[1].tiles = [5, 6, 7, 8];
      p.metatiles[1].palette = p.metatiles[0].palette;
      p.maps[0].screens[0].metatiles = new Array(240).fill(0);
      p.maps[0].screens[0].boundTiles = [{ switchId: 5, row: 0, col: 0, metatileId: 1 }];
      p.maps[0].screens[0].entities.push({ actorId, x: 200, y: 40, props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 5 }, { op: 'flash' }] }] } } });
    }
  });
  if (edits) project = withEngineEdit(project, ...edits);
  const screen = await screenFor(t, project);
  screen.boot();
  screen.recruit(0, 1);
  const { scanEquates, resolveEquates } = await import('../lib/equates.js');
  const pending = new Map();
  for (const file of ['constants.asm', 'assets/config.inc', 'assets/cartridge.inc']) scanEquates(fs.readFileSync(path.join(screen.built.dir, 'build', file), 'utf8'), pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  screen.openFromGameplay();
  screen.mem[R.EQ_DIRTY] = 0x7f;
  screen.peaks.length = 0;
  screen.mem[symbols.get('flash_left')] = 7; // FLASH_ARM_VALUE: the edge publishes on the next flash_tick
  screen.mem[0x055f] = 0; // flip_pending_idx, from engine/constants.asm
  screen.mem[0x0567] = 1; // flip_pending_count
  screen.frame();
  const first = { max: screen.peaks[0].max, dirty: screen.mem[R.EQ_DIRTY] };
  screen.frames(12);
  return { first, rest: screen.peaks.slice(1).map((peak) => peak.max), dirtyAfter: screen.mem[R.EQ_DIRTY] };
}

test('E12: a frame that already carries a flip and a Flash edge (45 bytes) publishes no Equip row; the row goes out the next frame', { skip }, async (t) => {
  // Catches an Equip tick that appends its row to the flip + Flash frame (10 + 35 + 33 = 78 bytes, whose NMI settles past scanline 256 on MMC3,
  // test/lua/run_equip_nmi_check.sh), and, the other way, a deferral that drops the row instead of keeping its dirty bit.
  const { first, rest, dirtyAfter } = await flipFlashSession(t);
  assert.equal(first.max, 45, 'flip (10) + Flash (35), no Equip row');
  assert.equal(first.dirty, 0x7f, 'every row is still dirty: nothing was published and no bit was cleared');
  assert.ok(rest.every((max) => max <= 68), `no later frame exceeds Flash + one row (${rest.join(',')}); a flip + Flash frame is 45 and defers again`);
  assert.ok(rest.filter((max) => max >= 33).length >= 7, 'all seven rows went out afterwards');
  assert.equal(dirtyAfter, 0, 'and the screen finished drawing');
});

test('negative control: an Equip tick without the deferral appends its row to the flip + Flash frame (78 bytes)', { skip }, async (t) => {
  const { first } = await flipFlashSession(t, ['battle.asm', [['  ldx <vram_len\n  cpx #EQ_QUEUE_MAX+1\n  bcs eq_fl_done              ; the frame already carries a flip and Flash: the row stays dirty and goes out next frame (E12)\n', '']]]);
  assert.equal(first.max, 78, 'the sabotaged tick published a row on top of the flip and Flash -- the deferral test above is what catches it');
});

// ---------------------------------------------------------------------------------------------------- 13. the screen's text is the generator's, not hand-typed

test('the Equip strings are emitted from EQUIP_STRINGS and addressed by EQS_*: the engine and the table cannot drift', { skip }, async (t) => {
  // Catches a hand-numbered string index in the engine that the table order silently disagrees with.
  const { EQUIP_STRINGS } = await import('../../main/build/battletables.js');
  const screen = await field(t, 1);
  const battleInc = fs.readFileSync(path.join(screen.built.dir, 'build', 'assets', 'battle.inc'), 'utf8');
  EQUIP_STRINGS.forEach(([name], index) => assert.match(battleInc, new RegExp(`^EQS_${name} = ${index}$`, 'm'), `EQS_${name}`));
  assert.deepEqual(
    EQUIP_STRINGS.map(([, text]) => text),
    ['EQUIP', 'WEAPON', 'ARMOR', 'ACCESSORY', 'NONE', 'BAG FULL', 'A:PICK B:OUT', 'A:OK  B:BACK'],
    'the words the screen says'
  );
  assert.ok(EQUIP_STRINGS.every(([, text]) => text.length <= 12), 'every line fits the twelve-column message area');
  assert.equal(RAM.PC_EQUIP, 0x07d4, 'pc_equip is where the harness believes (engine/constants.asm)');
});

// piece/ARMOR/WEAPON are re-exported for the controls above and kept referenced so a refactor of the helper does not silently drop them.
void [piece, WEAPON, ARMOR];
