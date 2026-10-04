// Phase 3a slice S3b (handoff-next/streamed-worlds-phase3a-s3b-plan.md section 1, T5-T9): the event's talker and
// its deferred enter event across a scripted Move that crosses a seam.
//
//   T5   the owed enter event: a crossing Move arms the destination's `enter` actor, the page finishes first, the
//        entry then fires EXACTLY once -- also across a scripted Battle, repeated Battles, two crossings (only the
//        last screen's entry), a Warp (the old entry is dropped), a switch set before / after the battle returns, a
//        destination with no enter actor (the absent sentinel, never a leftover), an owed actor that is gone by the
//        time the page ends (the discard reaches settle_owed_none) and a stale record left by an earlier event.
//   T6   the talker matrix: {live, live after a respawn (rebound), gone because the player crossed away, gone
//        because a switch suppresses it} x {Turn, Visible, Move-self, Say} x {no battle, battle}, run through the
//        waiting frames that follow, with the corruption watch on (T8) and the entry-state the handlers saw.
//   T6b  a skipped Move-self cleans up what the handler wrote before its guard (mv_left, mv_ent): a full RAM diff
//        against a no-op control, with the allowed bytes listed.
//   T6c  an event that ended leaves no identity for a later, non-scripted battle to revive.
//   T8   no store through an `ent_*` array at an index >= MAX_ENTITIES, at any instruction of any frame.
//   T9   lifecycle: init_session (game over -> Start), take_door (valid target only) and close_ui each clear the
//        talker identity; Save carries none of it.
//
// Expected values are written out here from the design (plan section 4), never read from the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SAVE_LAYOUT_VERSION } from '../../shared/save.js';
import {
  crossProject, buildBoot, page, move, addVar, setSwitch, say, wait, R, BTN, DIRS, variable, switchOn, talkerBytes, slotOfRecord, entitySnapshot,
  runFrames, runUntil, tap, drive, tracePc, watchEntityIndexWrites, ramDiff
} from '../lib/streamedcross.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const WARP_READY = 0x2e; // engine/constants.asm
const WARP_SCR = 0x2f;
const WARP_X = 0x30;
const WARP_Y = 0x31;
const NO = R.NO_ENTITY;

/** The talker's pages: the first passing page runs, so once switch 0 is on the page below it only counts how often the entry re-fires (variable 1). */
const talkerPages = (commands) => [page([addVar(1)], { type: 'switchOn', arg: 0 }), page([...commands, setSwitch(0)])];
const enterNpc = (screen, commands, extra = {}) => ({ screen, x: 32, y: 32, trigger: 'enter', pages: [page(commands)], ...extra });

async function boot(options) {
  const scene = crossProject(options);
  const built = await buildBoot(scene.project);
  return { ...scene, ...built };
}

const awaitScript = (nes) => runUntil(nes, () => nes.cpu.mem[R.SCRIPT_ACTIVE] === 1, 300, 'the talker page to start');

// ------------------------------------------------------------------ T5: the owed enter event

const BATTLE = (id) => ({ op: 'battle', monsters: [id] });

/** Runs a scene to the end of its page; returns what was observed on the way. */
async function runOwed({ gameType = 'action', commands, extras, monster = false, hook }) {
  const s = await boot({ gameType, start: { screen: 0, x: 200, y: 112 }, pages: talkerPages(commands(null)), extras, monster });
  // the commands may name the monster id: rebuild now that it is known
  if (monster) {
    const again = crossProject({ gameType, start: { screen: 0, x: 200, y: 112 }, pages: talkerPages(commands(s.monsterId)), extras, monster });
    const built = await buildBoot(again.project);
    Object.assign(s, again, built);
  }
  const { nes, mem } = s;
  awaitScript(nes);
  const seen = { variablesDuringPage: [], owedDuringPage: new Set(), pendingDuringPage: new Set() };
  const frames = drive(nes, {
    max: 4000,
    onFrame: () => {
      if (mem[R.SCRIPT_ACTIVE] === 1) {
        seen.variablesDuringPage.push([variable(mem, 2), variable(mem, 3)]);
        seen.owedDuringPage.add(mem[R.OWED_ENTER_REC]);
      }
      if (hook) hook(s, seen);
    }
  });
  runFrames(nes, 60); // nothing may fire late either
  return { ...s, seen, frames };
}

test('T5 crossing Move, no battle: the destination\'s enter event fires exactly once, after the page ends', boots, async () => {
  const { mem, seen } = await runOwed({
    commands: () => [move('right', 100), say('A'), addVar(0)],
    extras: [enterNpc(1, [addVar(2)])]
  });
  assert.ok(seen.variablesDuringPage.length > 20, 'the page ran for a while');
  assert.ok(seen.variablesDuringPage.every(([v]) => v === 0), 'the entry did not fire while the page was running');
  assert.ok([...seen.owedDuringPage].includes(0), 'the destination actor (record 0) was owed during the page');
  assert.equal(variable(mem, 0), 1, 'the page finished');
  assert.equal(variable(mem, 2), 1, 'the entry fired exactly once, after the page');
  assert.deepEqual(talkerBytes(mem), { rec: NO, scr: mem[R.TALK_SCR], crossed: 0, owed: NO, ent: NO }, 'nothing is owed or remembered afterwards');
});

test('T5 crossing Move then a scripted Battle then a Say: the entry fires exactly once, after the page (RPG)', boots, async () => {
  const { mem, seen } = await runOwed({
    gameType: 'rpg', monster: true,
    commands: (m) => [move('right', 100), m === null ? addVar(5) : BATTLE(m), say('A'), addVar(0)],
    extras: [enterNpc(1, [addVar(2)])]
  });
  assert.ok(seen.variablesDuringPage.every(([v]) => v === 0), 'the entry did not fire before the page ended');
  assert.equal(variable(mem, 0), 1, 'the page finished');
  assert.equal(variable(mem, 2), 1, 'the entry survived the battle and fired exactly once');
});

test('T5 repeated Battles within one page: the owed record survives each, and the entry still fires once (RPG)', boots, async () => {
  const { mem } = await runOwed({
    gameType: 'rpg', monster: true,
    commands: (m) => [move('right', 100), m === null ? addVar(5) : BATTLE(m), m === null ? addVar(5) : BATTLE(m), say('A'), addVar(0)],
    extras: [enterNpc(1, [addVar(2)])]
  });
  assert.equal(variable(mem, 0), 1);
  assert.equal(variable(mem, 2), 1);
});

test('T5 two crossings and a Battle: only the final screen\'s entry is owed (RPG)', boots, async () => {
  const { mem } = await runOwed({
    gameType: 'rpg', monster: true,
    commands: (m) => [move('right', 200), move('right', 155), m === null ? addVar(5) : BATTLE(m), say('A'), addVar(0)],
    extras: [enterNpc(1, [addVar(2)]), enterNpc(2, [addVar(3)])]
  });
  assert.equal(variable(mem, 0), 1);
  assert.equal(variable(mem, 2), 0, 'the middle screen\'s entry is not owed: every crossing overwrites the record');
  assert.equal(variable(mem, 3), 1, 'the last screen\'s entry fires once');
});

test('T5 two crossings whose entry actors hold DIFFERENT records: the final crossing overwrites the owed record, never keeps the first (RPG; sabotage 4)', boots, async () => {
  const { mem } = await runOwed({
    gameType: 'rpg', monster: true,
    commands: (m) => [move('right', 200), move('right', 155), m === null ? addVar(5) : BATTLE(m), say('A'), addVar(0)],
    // screen 1's entry is record 0; screen 2's is record 1 behind plain scenery at record 0, so a kept record 0 would resolve to the scenery
    extras: [enterNpc(1, [addVar(2)]), { screen: 2, x: 64, y: 64 }, enterNpc(2, [addVar(3)])]
  });
  assert.equal(variable(mem, 0), 1);
  assert.equal(variable(mem, 2), 0, 'the middle screen\'s entry is not owed');
  assert.equal(variable(mem, 3), 1, 'the last screen\'s entry (record 1) fires once: the record was overwritten by the final crossing');
});

test('T5 a final crossing into a screen with NO enter actor clears what an earlier crossing owed (RPG; sabotage 4)', boots, async () => {
  const { mem } = await runOwed({
    gameType: 'rpg', monster: true,
    commands: (m) => [move('right', 200), move('right', 155), m === null ? addVar(5) : BATTLE(m), say('A'), addVar(0)],
    // screen 2's record 0 is an interact actor whose event counts: a stale record 0 carried over from screen 1 would re-arm it
    extras: [enterNpc(1, [addVar(2)]), { screen: 2, x: 64, y: 64, trigger: 'interact', pages: [page([addVar(4)])] }]
  });
  assert.equal(variable(mem, 0), 1);
  assert.equal(variable(mem, 2), 0, 'screen 1\'s entry is not owed');
  assert.equal(variable(mem, 4), 0, 'nothing is owed after a final crossing into a screen with no entry: the absent sentinel overwrote screen 1\'s record');
  assert.equal(mem[R.OWED_ENTER_REC], NO);
});

test('T5 a destination with no enter actor owes nothing -- the absent sentinel, never a leftover accumulator (a decoy record 1 must not fire)', boots, async () => {
  const { mem, seen } = await runOwed({
    gameType: 'rpg', monster: true,
    commands: (m) => [move('right', 100), m === null ? addVar(5) : BATTLE(m), say('A'), addVar(0)],
    // record 0: plain scenery; record 1: an interact actor whose event would count if the re-arm resolved record 1
    extras: [{ screen: 1, x: 32, y: 32 }, { screen: 1, x: 64, y: 32, trigger: 'interact', pages: [page([addVar(4)])] }]
  });
  assert.equal(variable(mem, 0), 1);
  assert.equal([...seen.owedDuringPage].filter((v) => v !== NO).length, 0, 'owed_enter_rec held the absent sentinel $FF throughout the page');
  assert.equal(variable(mem, 4), 0, 'no record was re-armed after the battle');
  assert.equal(variable(mem, 2) + variable(mem, 3), 0, 'nothing else fired');
});

test('T5 the absent sentinel without a battle: owed_enter_rec reads $FF straight after the crossing (action)', boots, async () => {
  const { seen } = await runOwed({ commands: () => [move('right', 100), say('A'), addVar(0)], extras: [{ screen: 1, x: 32, y: 32 }] });
  assert.deepEqual([...seen.owedDuringPage], [NO]);
});

test('T5 Move then Warp: the old entry is dropped and the destination\'s fires', boots, async () => {
  const { mem } = await runOwed({
    commands: () => [move('right', 100), { op: 'warp', screen: 2, x: 40, y: 112 }],
    extras: [enterNpc(1, [addVar(2)]), enterNpc(2, [addVar(3)])]
  });
  assert.equal(variable(mem, 2), 0, 'the screen the page crossed to is not entered by the warp: its owed entry is dropped');
  assert.equal(variable(mem, 3), 1, 'the warp destination\'s own entry fires');
  assert.equal(mem[R.OWED_ENTER_REC], NO);
});

test('T5 a switch set BEFORE the battle returns drops the owed entry (the respawn rejects the hidden record) (RPG)', boots, async () => {
  const { mem } = await runOwed({
    gameType: 'rpg', monster: true,
    commands: (m) => [move('right', 100), setSwitch(3), m === null ? addVar(5) : BATTLE(m), say('A'), addVar(0)],
    extras: [enterNpc(1, [addVar(2)], { hideSwitch: 3 })]
  });
  assert.equal(variable(mem, 0), 1);
  assert.equal(variable(mem, 2), 0, 'the entry was dropped, the same result as leaving and re-entering');
  assert.equal(mem[R.OWED_ENTER_REC], NO);
});

test('T5 a switch set AFTER the battle returned does not drop it: the entry still fires, as the same page does with no battle (RPG)', boots, async () => {
  const { mem } = await runOwed({
    gameType: 'rpg', monster: true,
    commands: (m) => [move('right', 100), m === null ? addVar(5) : BATTLE(m), setSwitch(3), say('A'), addVar(0)],
    extras: [enterNpc(1, [addVar(2)], { hideSwitch: 3 })]
  });
  assert.equal(variable(mem, 2), 1);
});

test('T5 a cancelled dispatch: the owed actor is gone when the page ends -- the discard resets the record and settle_owed returns', boots, async () => {
  let poked = false;
  const { mem } = await runOwed({
    commands: () => [move('right', 100), wait(40), addVar(0)],
    extras: [enterNpc(1, [addVar(2)])],
    hook: ({ mem: m }) => {
      if (!poked && m[R.OWED_ENTER_REC] !== NO && m[R.SCRIPT_ACTIVE] === 1) {
        const slot = slotOfRecord(m, m[R.OWED_ENTER_REC]);
        assert.ok(slot >= 0, 'the owed actor is live on the new screen');
        m[R.ENT_ACTIVE + slot] = 0; // gone: the shipped guard in settle_owed ("the slot must still hold an actor")
        poked = true;
      }
    }
  });
  assert.ok(poked);
  assert.equal(variable(mem, 0), 1, 'the page finished');
  assert.equal(variable(mem, 2), 0, 'no event ran for the vanished actor');
  assert.equal(mem[R.OWED_ENTER_REC], NO, 'the owed record was discarded');
  assert.equal(mem[R.PENDING_ENT], NO, 'nothing is armed');
  assert.equal(mem[R.GAME_STATE], R.ST_GAMEPLAY, 'the frame was an ordinary one (settle_owed_none)');
});

test('T5 a stale owed record is obsoleted by the next event that starts: a later battle re-arms nothing (RPG)', boots, async () => {
  const probe = crossProject({ gameType: 'rpg', monster: true, extras: [enterNpc(1, []), { screen: 1 }] });
  const unrelated = { screen: 1, x: 100, y: 60, trigger: 'interact', pages: [page([BATTLE(probe.monsterId), say('B'), addVar(6)])] };
  const again = await boot({
    gameType: 'rpg', monster: true, start: { screen: 0, x: 200, y: 112 },
    pages: talkerPages([move('right', 100), say('A'), addVar(0)]),
    extras: [enterNpc(1, [addVar(2)]), unrelated]
  });
  assert.equal(again.monsterId, probe.monsterId, 'the monster id the unrelated event names is the scene\'s');
  const { nes, mem } = again;
  awaitScript(nes);
  drive(nes, { max: 4000 });
  assert.equal(variable(mem, 2), 1, 'the first page and its owed entry ran normally');
  // leave a stale record behind, as a record that was never consumed would be
  mem[R.OWED_ENTER_REC] = 0;
  mem[R.TALK_CROSSED] = 1;
  const unrelatedSlot = slotOfRecord(mem, again.extraRecords[1]);
  assert.ok(unrelatedSlot >= 0, 'the unrelated actor is live on the new screen');
  mem[R.PENDING_ENT] = unrelatedSlot; // settle_owed starts its event next frame
  drive(nes, { max: 4000 });
  assert.equal(variable(mem, 6), 1, 'the unrelated event ran to its end (battle and message)');
  assert.equal(variable(mem, 2), 1, 'the stale owed entry was not re-armed by that event\'s battle');
});

// ------------------------------------------------------------------ T6 / T6b / T8: the talker matrix

const STATES = {
  'live, no crossing': { prefix: [], live: true, crossings: 0 },
  'live after a respawn (rebound)': { prefix: [setSwitch(2), move('right', 100), move('left', 100)], live: true, decoy: true, crossings: 2 },
  'gone: the player crossed away': { prefix: [move('right', 100)], live: false, crossings: 1 },
  'gone: a switch suppresses it': { prefix: [setSwitch(1), setSwitch(2), move('right', 100), move('left', 100)], live: false, decoy: true, hide: 1, crossings: 2 }
};
const SELF = {
  turn: { command: { op: 'turn', who: 'self', dir: 'up' }, handler: 'script_op_turn', live: (m, slot) => assert.equal(m[R.ENT_DIR + slot], DIRS.up, 'the talker was turned') },
  visible: { command: { op: 'visible', state: 'hidden' }, handler: 'script_op_visible', live: (m, slot) => assert.ok(m[R.ENT_ACTIVE + slot] & R.ENT_HIDDEN, 'the talker was hidden') },
  'move-self': { command: move('down', 16, 'self'), handler: 'script_op_move', live: (m, slot) => assert.equal(m[R.ENT_Y + slot], 48, 'the talker walked its 16 px') },
  say: { command: say('HELLO'), handler: null, live: () => {} }
};
const FOLLOW = { wait: [wait(12)], say: [say('NEXT')] };

function matrixPages(stateName, cmdName, battleId, follow) {
  const st = STATES[stateName];
  return talkerPages([...st.prefix, ...(battleId === null ? [] : [BATTLE(battleId)]), SELF[cmdName].command, ...FOLLOW[follow], addVar(0)]);
}

async function runMatrix({ stateName, cmdName, battle, follow = 'wait', control = false }) {
  const st = STATES[stateName];
  const gameType = battle ? 'rpg' : 'action';
  const make = (battleId) => crossProject({
    gameType, start: { screen: 0, x: 200, y: 112 }, decoy: Boolean(st.decoy), monster: battle,
    talker: st.hide !== undefined ? { hideSwitch: st.hide } : {},
    pages: control
      ? talkerPages([...st.prefix, ...(battleId === null ? [] : [BATTLE(battleId)]), { op: 'setVar', variable: 6, value: 0 }, ...FOLLOW[follow], addVar(0)])
      : matrixPages(stateName, cmdName, battleId, follow)
  });
  let scene = make(null);
  if (battle) scene = make(scene.monsterId);
  const built = await buildBoot(scene.project);
  const { nes, mem, syms } = built;
  const watch = watchEntityIndexWrites(nes);
  const entries = [];
  const handler = SELF[cmdName].handler ? syms[SELF[cmdName].handler] : undefined;
  const unwatch = handler === undefined ? () => {} : tracePc(nes, (pc) => {
    if (pc === handler) entries.push({ talkEnt: mem[R.TALK_ENT], slot: slotOfRecord(mem, scene.talkerRecord), crossed: mem[R.TALK_CROSSED], snap: entitySnapshot(mem) });
  });
  awaitScript(nes);
  const playerMoves = st.prefix.filter((c) => c.op === 'move').length;
  const afterCmd = [];
  drive(nes, {
    max: 5000,
    onFrame: () => {
      if (cmdName === 'move-self' && !st.live && entries.length > playerMoves) afterCmd.push([mem[R.MV_LEFT], mem[R.MV_ENT]]);
    }
  });
  runFrames(nes, 8);
  unwatch();
  watch.stop();
  return { ...scene, ...built, entries, afterCmd, hits: watch.hits, playerMoves };
}

for (const stateName of Object.keys(STATES)) {
  for (const cmdName of Object.keys(SELF)) {
    for (const battle of [false, true]) {
      test(`T6 talker ${stateName} x ${cmdName} x ${battle ? 'a Battle first (RPG)' : 'no battle'}: the self-command acts on the live talker or is a no-op that continues the page`, boots, async () => {
        const r = await runMatrix({ stateName, cmdName, battle });
        const st = STATES[stateName];
        const { mem } = r;
        assert.deepEqual(r.hits, [], 'no store through an entity array at an index >= MAX_ENTITIES (T8)');
        assert.equal(variable(mem, 0), 1, 'the page ran to its end: the command after the self-command ran');
        assert.equal(switchOn(mem, 0), 1);
        if (SELF[cmdName].handler) {
          const entry = r.entries.at(-1);
          const want = (cmdName === 'move-self' ? r.playerMoves : 0) + 1; // script_op_move also serves the page's player Moves
          assert.ok(entry && r.entries.length === want, `the handler was entered once for the self-command (${r.entries.length} entries, want ${want})`);
          if (st.live) {
            assert.ok(entry.slot >= 0, 'the talker is live when the command runs');
            assert.equal(entry.talkEnt, entry.slot, 'talk_ent names the talker\'s CURRENT slot (rebound after the respawn), not a stale one');
          } else {
            assert.equal(entry.slot, -1, 'the talker is not on this screen (the scene made it gone)');
            assert.equal(entry.talkEnt, NO, 'talk_ent is the absent sentinel');
            assert.equal(entry.crossed, st.crossings > 0 ? 1 : 0, 'talk_crossed says a crossing happened during this event');
          }
        }
        if (st.live && SELF[cmdName].handler) SELF[cmdName].live(mem, slotOfRecord(mem, r.talkerRecord));
        if (!st.live && SELF[cmdName].handler) assert.equal(entitySnapshot(mem), r.entries.at(-1).snap.replace(/^/, ''), 'a gone talker\'s command changed no entity on the screen');
        if (cmdName === 'move-self' && !st.live) assert.ok(r.afterCmd.length > 5 && r.afterCmd.every(([left, ent]) => left === 0 && ent === NO), 'after the skipped Move: mv_left = 0 and mv_ent = $FF on every later frame');
        // the identity ended with the event
        assert.deepEqual({ rec: mem[R.TALK_REC], crossed: mem[R.TALK_CROSSED], owed: mem[R.OWED_ENTER_REC], ent: mem[R.TALK_ENT] }, { rec: NO, crossed: 0, owed: NO, ent: NO });
        // the entry re-fires after the page exactly when the talker's own screen was entered last and the talker spawned there
        const wantRefire = stateName === 'live after a respawn (rebound)' ? 1 : 0;
        assert.equal(variable(mem, 1), wantRefire, `the talker's own enter event re-fired ${wantRefire} time(s) after the page`);
      });
    }
  }
}

for (const follow of ['wait', 'say']) {
  for (const stateName of ['gone: the player crossed away', 'gone: a switch suppresses it']) {
    test(`T6b skipped Move-self (${stateName}) followed by ${follow}: the RAM differs from a no-op control only in the listed bytes`, boots, async () => {
      const a = await runMatrix({ stateName, cmdName: 'move-self', battle: false, follow });
      const c = await runMatrix({ stateName, cmdName: 'move-self', battle: false, follow, control: true });
      assert.deepEqual(a.hits, []);
      // the handler writes mv_who, mv_dir, mv_left and mv_ent before its guard (engine/script.asm script_op_move) and the page is four bytes
      // longer than the control's, so script_ptr ends elsewhere; nothing else may differ
      const ALLOWED = new Set([0x47, 0x48, R.MV_WHO, R.MV_DIR, R.MV_LEFT, R.MV_ENT]);
      const diff = ramDiff(a.mem, c.mem, ALLOWED);
      assert.deepEqual(diff.map((i) => `${i.toString(16)}: ${a.mem[i]} vs control ${c.mem[i]}`), [], 'RAM outside the allowed bytes is identical to the control');
      assert.equal(a.mem[R.MV_LEFT], 0);
      assert.equal(a.mem[R.MV_ENT], NO);
    });
  }
}

// ------------------------------------------------------------------ rule R: before a crossing the shipped defence stands

test('T6 talk_crossed is per event: a second event with no crossing and no talker ends at its first self-command, as shipped (RPG-free)', boots, async () => {
  const second = { screen: 1, x: 100, y: 60, trigger: 'interact', pages: [page([wait(8), { op: 'turn', who: 'self', dir: 'up' }, addVar(3)])] };
  const s = await boot({
    start: { screen: 0, x: 200, y: 112 },
    pages: talkerPages([move('right', 100), addVar(0)]),
    extras: [second]
  });
  const { nes, mem } = s;
  awaitScript(nes);
  drive(nes, { max: 3000 });
  assert.equal(variable(mem, 0), 1);
  const slot = slotOfRecord(mem, s.extraRecords[0]);
  assert.ok(slot >= 0);
  mem[R.TALK_CROSSED] = 1; // a stale 1 from the first event: start_dialog must replace it for this one
  mem[R.PENDING_ENT] = slot;
  runUntil(nes, () => mem[R.SCRIPT_ACTIVE] === 1, 60, 'the second event to start');
  assert.equal(mem[R.TALK_CROSSED], 0, 'a new event starts with no crossing recorded');
  mem[R.TALK_ENT] = NO; // the talker vanishes without any crossing: the shipped defence-in-depth case
  drive(nes, { max: 600 });
  assert.equal(variable(mem, 3), 0, 'with no crossing the self-command ends the event (shipped); Rule R does not apply');
});

// ------------------------------------------------------------------ T6c

test('T6c an event that ended leaves no identity for a later, non-scripted battle to revive (RPG)', boots, async () => {
  const make = (monsterId) => {
    const sc = crossProject({
      gameType: 'rpg', monster: true, start: { screen: 0, x: 200, y: 112 },
      pages: talkerPages([move('right', 100), move('left', 100), addVar(0)])
    });
    if (monsterId !== null) sc.project.maps[0].encounters = { rate: 1, actorIds: [monsterId] };
    return sc;
  };
  const probe = make(null);
  const scene = make(probe.monsterId);
  const built = await buildBoot(scene.project);
  const { nes, mem } = built;
  awaitScript(nes);
  drive(nes, { max: 3000, answer: true });
  assert.equal(variable(mem, 0), 1);
  assert.deepEqual({ rec: mem[R.TALK_REC], crossed: mem[R.TALK_CROSSED], owed: mem[R.OWED_ENTER_REC], ent: mem[R.TALK_ENT] }, { rec: NO, crossed: 0, owed: NO, ent: NO }, 'the finished event left nothing behind');
  // a wandering encounter on the first walked step
  for (let i = 0; i < 80 && mem[R.GAME_STATE] === R.ST_GAMEPLAY; i++) { nes.buttonDown(1, BTN.DOWN); nes.frame(); nes.buttonUp(1, BTN.DOWN); }
  runUntil(nes, () => mem[R.GAME_STATE] === R.ST_BATTLE, 60, 'the wandering battle');
  drive(nes, { max: 2000 });
  assert.equal(mem[R.GAME_STATE], R.ST_GAMEPLAY);
  assert.deepEqual({ rec: mem[R.TALK_REC], crossed: mem[R.TALK_CROSSED], owed: mem[R.OWED_ENTER_REC], ent: mem[R.TALK_ENT] }, { rec: NO, crossed: 0, owed: NO, ent: NO }, 'no talker was revived and nothing was re-armed by that battle');
});

// ------------------------------------------------------------------ T9: lifecycle and Save

test('T9 init_session (game over, then Start) clears the talker identity, talk_crossed and the owed record', boots, async () => {
  const s = await boot({
    start: { screen: 0, x: 200, y: 112 },
    pages: talkerPages([move('right', 100), wait(10), { op: 'damage', value: 99 }]),
    extras: [enterNpc(1, [addVar(2)])]
  });
  const { nes, mem } = s;
  awaitScript(nes);
  runUntil(nes, () => mem[R.GAME_STATE] === 4, 2000, 'game over (ST_GAMEOVER)');
  runFrames(nes, 30);
  mem[R.TALK_REC] = 1;
  mem[R.TALK_SCR] = 1;
  mem[R.TALK_CROSSED] = 1;
  mem[R.OWED_ENTER_REC] = 0;
  for (let i = 0; i < 80 && mem[R.GAME_STATE] !== R.ST_GAMEPLAY; i++) tap(nes, BTN.START, 6);
  assert.equal(mem[R.GAME_STATE], R.ST_GAMEPLAY, 'Start on the game-over screen began the new session');
  assert.deepEqual({ rec: mem[R.TALK_REC], crossed: mem[R.TALK_CROSSED], owed: mem[R.OWED_ENTER_REC] }, { rec: NO, crossed: 0, owed: NO }, 'init_session cleared all of it');
});

test('T9 take_door clears the identity only once the target is valid', boots, async () => {
  const s = await boot({ start: { screen: 0, x: 200, y: 112 }, pages: talkerPages([addVar(0)]) });
  const { nes, mem } = s;
  runFrames(nes, 90); // the talker's one-frame page runs and ends inside a single frame: there is no script_active to wait for
  const stale = () => { mem[R.TALK_REC] = 3; mem[R.TALK_SCR] = 1; mem[R.TALK_CROSSED] = 1; mem[R.OWED_ENTER_REC] = 2; };
  // an invalid target (past the last screen) is ignored: take_door returns before anything, the stale bytes stay
  stale();
  mem[WARP_SCR] = 200;
  mem[WARP_X] = 40;
  mem[WARP_Y] = 40;
  mem[WARP_READY] = 1;
  runFrames(nes, 3);
  assert.equal(mem[WARP_READY], 0, 'the door was consumed');
  assert.deepEqual({ rec: mem[R.TALK_REC], crossed: mem[R.TALK_CROSSED], owed: mem[R.OWED_ENTER_REC] }, { rec: 3, crossed: 1, owed: 2 }, 'an ignored door clears nothing');
  // a valid target clears them
  mem[WARP_SCR] = 1;
  mem[WARP_READY] = 1;
  runFrames(nes, 4);
  assert.equal(mem[R.FLAT_SCREEN], 1, 'the warp happened');
  assert.deepEqual({ rec: mem[R.TALK_REC], crossed: mem[R.TALK_CROSSED], owed: mem[R.OWED_ENTER_REC] }, { rec: NO, crossed: 0, owed: NO }, 'a valid door clears the identity');
});

test('T9 Save: the layout version is unchanged and none of the four talker bytes is part of the saved record', () => {
  assert.equal(SAVE_LAYOUT_VERSION, 3, 'S3b changes no save layout');
  for (const file of ['save.asm', 'flash.asm']) {
    const text = fs.readFileSync(path.join(ROOT, 'engine', file), 'utf8');
    for (const name of ['talk_rec', 'talk_scr', 'talk_crossed', 'owed_enter_rec']) assert.ok(!text.includes(name), `engine/${file} does not mention ${name}`);
  }
  const save = fs.readFileSync(path.join(ROOT, 'shared/save.js'), 'utf8');
  for (const name of ['talk_rec', 'talk_scr', 'talk_crossed', 'owed_enter_rec']) assert.ok(!save.includes(name), `shared/save.js does not mention ${name}`);
});
