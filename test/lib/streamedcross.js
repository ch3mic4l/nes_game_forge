// Phase 3a slice S3b: the scene and observation helpers the crossing-Move and talker tests share
// (handoff-next/streamed-worlds-phase3a-s3b-plan.md section 1's T1-T12). Every address is
// transcribed by hand from engine/constants.asm, each with its source: a test that read the file it
// checks would prove nothing. The scenes are built on test/lib/streamedmovecam.js's terrainProject
// (every metatile block distinguishable, one NPC on the start screen running an `enter` event).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { A, terrainProject, buildBoot, tracePc } from './streamedmovecam.js';

export { A, buildBoot, tracePc };

// from engine/constants.asm
export const R = {
  TALK_ENT: 0x3a, SCRIPT_ACTIVE: 0x49, PENDING_ENT: 0x7c, WARP_READY: 0x2e, GAME_STATE: 0x25, FLAT_SCREEN: 0x16,
  ENT_ACTIVE: 0x300, ENT_ACTOR: 0x308, ENT_X: 0x310, ENT_Y: 0x318, ENT_DIR: 0x320, ENT_RECORD: 0x520,
  SWITCHES: 0x390, VARIABLES: 0x500, MV_ENT: 0x5ff, MV_WHO: 0x94, MV_DIR: 0x95, MV_LEFT: 0x96,
  TALK_REC: 0x7f2, TALK_SCR: 0x7f3, TALK_CROSSED: 0x7f4, OWED_ENTER_REC: 0x7f5, // S3b: the four talker bytes
  MAX_ENTITIES: 8, NO_ENTITY: 0xff, ENT_HIDDEN: 0x02, ENT_PRESENT: 0x01,
  ST_GAMEPLAY: 0, ST_DIALOG: 2, ST_BATTLE: 5,
  BOX_STATE: 0x40, BOX_TYPING: 2, BOX_PAGEWAIT: 3, BOX_ENDWAIT: 6, // engine/constants.asm: box_state and the states a confirm press answers
  BT_SEL: 0x55, BC_FIGHT: 0 // engine/constants.asm: the battle menu's cursor and its first command
};
export const BTN = { A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 };
export const DIRS = { down: 0, up: 1, left: 2, right: 3 }; // engine/constants.asm DIR_*

// ------------------------------------------------------------------ scenes

export const page = (commands, cond = { type: 'none', arg: 0 }) => ({ cond, commands });
export const move = (dir, dist, who = 'player') => ({ op: 'move', who, dir, dist });
export const addVar = (variable, value = 1) => ({ op: 'addVar', variable, value });
export const setSwitch = (n) => ({ op: 'setSwitch', switch: n });
export const say = (text) => ({ op: 'say', text });
export const wait = (frames) => ({ op: 'wait', frames });

/**
 * A streamed project whose start screen holds the TALKER: an `enter`-triggered NPC at (32,32) running `pages`. Around it:
 *   decoy    a first record on the start screen (hidden once switch 2 is on), so the talker's slot differs between a first
 *            spawn and a respawn -- a stale slot number cannot pass for the rebound one
 *   talker   { hideSwitch } the talker is not spawned while that switch is on
 *   extras   [{ screen, x, y, trigger, pages, hideSwitch }] more NPCs, in the order given (their record = their index on their screen)
 *   monster  an RPG battle actor (not placed), for the `battle` command; its actor index is returned
 * Returns { project, talkerRecord, extraRecords, monsterId, actorIds }.
 */
export function crossProject({
  gameType = 'action', gridW = 3, gridH = 2, start = {}, pages, talker = {}, decoy = false, extras = [], monster = false, solids = [], carrier = true
} = {}) {
  const { screen = 0, x = 200, y = 112 } = start;
  const project = terrainProject({ gameType, gridW, gridH, commands: [], startX: x, startY: y, moveScreen: screen, solids });
  const map = project.maps[0];
  const screenEnts = map.screens[screen].entities;
  const talkerEnt = screenEnts.find((e) => e.props?.event);
  talkerEnt.x = talker.x ?? 32;
  talkerEnt.y = talker.y ?? 32;
  talkerEnt.props = { trigger: 'enter', event: { pages }, ...(talker.hideSwitch !== undefined ? { hideSwitch: talker.hideSwitch } : {}) };
  const actorIds = { talker: talkerEnt.actorId };
  if (decoy) {
    const id = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Decoy', behavior: 'npc', hp: 1, damage: 0 });
    screenEnts.unshift({ actorId: id, x: 96, y: 32, props: { hideSwitch: 2 } });
    actorIds.decoy = id;
  }
  const talkerRecord = screenEnts.indexOf(talkerEnt);
  const extraRecords = extras.map((e, i) => {
    const id = project.sprites.actors.length;
    project.sprites.actors.push({ name: `Extra ${i}`, behavior: 'npc', hp: 1, damage: 0 });
    const ents = (map.screens[e.screen].entities ??= []);
    ents.push({
      actorId: id, x: e.x ?? 32, y: e.y ?? 32,
      props: { ...(e.trigger ? { trigger: e.trigger } : {}), ...(e.pages ? { event: { pages: e.pages } } : {}), ...(e.hideSwitch !== undefined ? { hideSwitch: e.hideSwitch } : {}) }
    });
    actorIds[`extra${i}`] = id;
    return ents.length - 1;
  });
  // TALKER_ENABLED needs a Move somewhere in the project (a streamed map AND a Move): a scene whose talker page has none carries one
  // on an actor nobody touches (the last screen, an interact trigger), so the talker bookkeeping is assembled in every scene
  if (carrier) {
    const id = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Carrier', behavior: 'npc', hp: 1, damage: 0 });
    const last = map.screens[map.screens.length - 1];
    (last.entities ??= []).push({ actorId: id, x: 232, y: 200, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'player', dir: 'up', dist: 16 }] }] } } });
    actorIds.carrier = id;
  }
  let monsterId = null;
  if (monster) {
    monsterId = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } });
  }
  return { project, talkerRecord, extraRecords, monsterId, actorIds };
}

// ------------------------------------------------------------------ observation

export const variable = (mem, n) => mem[R.VARIABLES + n];
export const switchOn = (mem, n) => (mem[R.SWITCHES + (n >> 3)] >> (n & 7)) & 1;
export const talkerBytes = (mem) => ({ rec: mem[R.TALK_REC], scr: mem[R.TALK_SCR], crossed: mem[R.TALK_CROSSED], owed: mem[R.OWED_ENTER_REC], ent: mem[R.TALK_ENT] });

/** The live slot holding authored record `rec` of the current screen, or -1. */
export function slotOfRecord(mem, rec) {
  for (let i = 0; i < R.MAX_ENTITIES; i++) if (mem[R.ENT_ACTIVE + i] && mem[R.ENT_RECORD + i] === rec) return i;
  return -1;
}

/** Every per-slot byte of the entity arrays, as one comparable string. */
export function entitySnapshot(mem) {
  const out = [];
  for (const base of [R.ENT_ACTIVE, R.ENT_ACTOR, R.ENT_X, R.ENT_Y, R.ENT_DIR, R.ENT_RECORD]) out.push(Array.from(mem.slice(base, base + R.MAX_ENTITIES)).join(','));
  return out.join(' | ');
}

// ------------------------------------------------------------------ driving

export function runFrames(nes, n) { for (let i = 0; i < n; i++) nes.frame(); }

export const tap = (nes, button, after = 12) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  runFrames(nes, after);
};

export function runUntil(nes, pred, max, what) {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    nes.frame();
  }
  assert.ok(pred(), `timed out after ${max} frames waiting for ${what}`);
  return max;
}

/** Fights a scripted battle to its end (the weakest monster dies to the first Fight). */
export function finishBattle(nes) {
  const mem = nes.cpu.mem;
  for (let i = 0; i < 8 && mem[R.BT_SEL] !== R.BC_FIGHT; i++) tap(nes, BTN.DOWN, 4);
  assert.equal(mem[R.BT_SEL], R.BC_FIGHT, 'the battle menu never reached Fight');
  tap(nes, BTN.A, 20);
  for (let round = 0; round < 80 && mem[R.GAME_STATE] === R.ST_BATTLE; round++) tap(nes, BTN.A, 12);
  assert.notEqual(mem[R.GAME_STATE], R.ST_BATTLE, 'the battle never ended');
}

/**
 * Runs frames until the event is over and the world has been idle for `settle` frames: answers a battle (Fight) and closes a message box (A) when
 * nothing is walking. `onFrame(frameNumber)` runs after every frame (assertions that must hold throughout). Returns the frames taken.
 */
export function drive(nes, { max = 3000, settle = 24, onFrame = () => {}, answer = true } = {}) {
  const mem = nes.cpu.mem;
  let idle = 0;
  for (let f = 0; f < max; f++) {
    if (answer && mem[R.GAME_STATE] === R.ST_BATTLE) { finishBattle(nes); idle = 0; continue; }
    // a confirm press only while a message box is up and waiting: a press during a bare script (a Wait, a Turn) would end the event
    const boxWaiting = [R.BOX_PAGEWAIT, R.BOX_ENDWAIT].includes(mem[R.BOX_STATE]);
    if (answer && boxWaiting && f % 6 === 0) {
      nes.buttonDown(1, BTN.A);
      nes.frame();
      nes.buttonUp(1, BTN.A);
    } else nes.frame();
    onFrame(f);
    if (mem[R.SCRIPT_ACTIVE] === 0 && mem[R.GAME_STATE] === R.ST_GAMEPLAY && mem[R.PENDING_ENT] === R.NO_ENTITY) idle++;
    else idle = 0;
    if (idle >= settle) return f;
  }
  assert.fail(`the event never settled within ${max} frames (state ${mem[R.GAME_STATE]}, script_active ${mem[R.SCRIPT_ACTIVE]}, pending ${mem[R.PENDING_ENT]})`);
  return max;
}

// ------------------------------------------------------------------ the corruption watch (T8)

/** [{ name, base }] for every `@size=MAX_ENTITIES` array of engine/constants.asm: the arrays an index >= MAX_ENTITIES corrupts. */
export function entityArrays(constantsPath = new URL('../../engine/constants.asm', import.meta.url)) {
  const out = [];
  for (const m of fs.readFileSync(constantsPath, 'utf8').matchAll(/^(\w+)\s*=\s*\$([0-9A-Fa-f]+)[^\n]*@size=MAX_ENTITIES/gm)) out.push({ name: m[1], base: parseInt(m[2], 16) });
  return out;
}

// store / read-modify-write opcodes in abs,X (and sta abs,Y) addressing
const INDEXED_WRITES = new Set([0x9d, 0x1e, 0x3e, 0x5e, 0x7e, 0xde, 0xfe, 0x99]);

/**
 * Watches every instruction: a store or read-modify-write through `ent_*,x` (or `,y`) whose index register is >= MAX_ENTITIES is a write past the
 * end of an entity array -- whatever the index value ($FF, $80|slot, anything). Returns { stop(), hits } with hits = [{ pc, array, index }].
 */
export function watchEntityIndexWrites(nes) {
  const arrays = entityArrays();
  assert.ok(arrays.length >= 10 && arrays.some((a) => a.name === 'ent_dir') && arrays.some((a) => a.name === 'ent_active'), 'the entity arrays were found in constants.asm');
  const byBase = new Map(arrays.map((a) => [a.base, a.name]));
  const hits = [];
  const stop = tracePc(nes, (pc) => {
    const op = nes.mmap.load(pc);
    if (!INDEXED_WRITES.has(op)) return;
    const base = nes.mmap.load(pc + 1) | (nes.mmap.load(pc + 2) << 8);
    const name = byBase.get(base);
    if (!name) return;
    const index = op === 0x99 ? nes.cpu.REG_Y : nes.cpu.REG_X;
    if (index >= R.MAX_ENTITIES) hits.push({ pc, array: name, index });
  });
  return { stop, hits };
}

/** Indices of every byte that differs between two RAM images, skipping the stack page ($0100-$01FF: leftover return addresses of a deeper or shallower call chain), the OAM shadow page ($0200-$02FF) and `ignore`. */
export function ramDiff(a, b, ignore = new Set()) {
  const out = [];
  for (let i = 0; i < 0x800; i++) {
    if (i >= 0x100 && i < 0x300) continue;
    if (ignore.has(i)) continue;
    if (a[i] !== b[i]) out.push(i);
  }
  return out;
}
