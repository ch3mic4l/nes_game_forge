// The turn-based battle system, driven through the built RPG sample ROM.
//
// Everything here goes through the banked code region, so every assertion is
// also an assertion that the trampoline in engine/banks.asm is behaving: the
// battle runs in a PRG bank the field's map data normally occupies, and the
// engine has to come back out of it sixty times a second.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createProject, NO_MEMBER, createSpell, battleCombatantOamMax, MAX_OAM_ENTRIES, MISS_OAM_TILES, normalizeProject, battleFxOamRoom } from '../../shared/project.js';
import { armBattleFx, tickBattleFx, drawnBattleFx } from '../../renderer/widgets/battlefx.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { checkCapacity } from '../../main/build/generate.js';
import { statAt, xpCurve, nameTiles, NAME_LIMIT, dropThreshold } from '../../main/build/battletables.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { compileText, opIndex, EVT_PAGES_END } from '../../main/build/textcompile.js';
import { decodeBody } from '../lib/eventdecoder.js';
import { textToTiles, MISS_TILE_M, MISS_TILE_M_ART, MISS_TILE_I_ART, MISS_TILE_S_ART } from '../../shared/font.js';
import {
  BOX_ROW,
  NM_ROW,
  NM_COL,
  NM_LEN,
  PC_NAME_RAM,
  NAME_LEN,
  ST_NAMEENTRY,
  BOX_NAMEENTRY,
  BOX_NAMEDONE,
  namingReady,
  waitForNamingReady,
  gotoCell,
  clearName,
  typeNameAndFinish,
  finishNamingIfOpen,
  nameBytes
} from '../lib/naming.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample-rpg');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);
const needsSample = !hasRom && 'run `npm run sample:rpg && npm run build:sample:rpg` first';

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const INV_COUNT = 0x37;
const INV_SEL = 0x38;
const ITEMS_USED = 0x39;
const BOX_STATE = 0x40;
const BT_PHASE = 0x53;
const BT_ACTOR = 0x54;
const BT_SEL = 0x55;
const BT_TARGET = 0x56;
const BT_DMG_LO = 0x58;
const BT_DMG_HI = 0x59;
const BT_COUNT = 0x5b;
const BT_MON_ROW = 4; // engine/constants.asm -- the first monster's top row
const BT_MON_COL = 4; // engine/constants.asm
const GOLD_LO = 0x63;
const PARTY_SIZE = 0x65;
const BT_LEN = 0x6b;
const BT_ARG = 0x6d;
const VRAM_LEN = 0x3c;
const MSG_ROW = 21; // engine/constants.asm -- the message area and the lists share these rows
const MSG_COL = 2; // engine/constants.asm
const INV_ITEMS = 0x378;
const BT_LIST = 0x3e4;
const SWITCHES = 0x390;
const PC_HP = 0x398;
const PC_HP_MAX = 0x39c;
const PC_MP = 0x3a0;
const PC_LEVEL = 0x3a8;
const PC_XP_LO = 0x3ac;
const PC_IN_PARTY = 0x3b4;
const PC_SPELLS = 0x3b8;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const ENT_DIR = 0x320;
const MON_SLOT_ACTOR = 0x3bc;
const MON_HP = 0x3c0;
const MON_SLOT_MAX = 0x3c4;
const MON_ALIVE = 0x3c8;
const RNG = 0x62;
const TURN_ORDER = 0x3cc;
const MON_SLOT_MP = 0x3ec;
const PC_STATUS = 0x3f0;
const MON_STATUS = 0x3f4;
const STATUS_POISON = 1; // engine/constants.asm
const STATUS_BURN = 2; // engine/constants.asm
const POISON_DMG = 2; // engine/constants.asm
const BURN_DMG = 3; // engine/constants.asm

const ST_GAMEPLAY = 0;
const ST_MENU = 1;
const ST_DIALOG = 2;
const ST_GAMEOVER = 4;
const ST_BATTLE = 5;

const MAX_PARTY = 4; // engine/constants.asm -- combatant indices 0-3 party, 4-7 monsters
const MSG_HOLD = 45; // engine/constants.asm -- frames a line of battle text stays up unpressed

const BOX_PAGEWAIT = 3;
const BOX_ENDWAIT = 6;

const BP_INTRO = 0;
const BP_MENU = 1;
const BP_TARGET = 2;
const BP_SPELLS = 3;
const BP_ITEMS = 4;
const BP_MESSAGE = 6;
const BP_DONE = 11;

const BC_FIGHT = 0;
const BC_MAGIC = 1;
const BC_ITEM = 2;
const BC_RUN = 3;
const NUM_COMMANDS = 4;

const A = 0;
const B = 1;
const SELECT = 2;
const START = 3;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

function boot(romPath = ROM_PATH, frames = 40) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const tap = (nes, button, frames = 14) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

/** Walk back and forth until the step counter rolls a wandering monster. */
function walkIntoEncounter(nes, budget = 900) {
  for (let step = 0; step < budget; step++) {
    if (nes.cpu.mem[GAME_STATE] === ST_BATTLE) break;
    const button = step % 60 < 30 ? RIGHT : LEFT;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
  for (let i = 0; i < 12; i++) nes.frame();
  return nes.cpu.mem[GAME_STATE] === ST_BATTLE;
}

/** Move the battle menu highlight to a command and confirm it. */
function chooseCommand(nes, command) {
  for (let i = 0; i < 8 && nes.cpu.mem[BT_SEL] !== command; i++) tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[BT_SEL], command, 'the battle menu never reached that command');
  tap(nes, A, 6);
}

/** Press on until the battle ends or the budget runs out. */
function pressThrough(nes, budget = 60) {
  for (let i = 0; i < budget && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  return nes.cpu.mem[GAME_STATE];
}

/**
 * Walk to a spot, X leg first and then Y, so the route is two straight legs the
 * sample map keeps open. Stops early if the world stops being the world — which
 * is exactly what walking into a monster is supposed to do.
 */
function walkTo(nes, targetX, targetY, budget = 600) {
  for (let i = 0; i < budget; i++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY) return;
    const dx = targetX - nes.cpu.mem[PLAYER_X];
    const dy = targetY - nes.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) return;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
}

/** Talk (B), then press through every page until the conversation ends.
 *  Returns false the instant a named Join opens the naming grid mid-
 *  conversation (docs/design-name-entry.md §14) -- the caller drives it with
 *  typeNameAndFinish, then calls talkThrough again for whatever the script
 *  does after the Join, mirroring how any other mid-conversation suspend in
 *  this engine is already driven one segment at a time. */
function talkThrough(nes, budget = 30) {
  tap(nes, B);
  for (let press = 0; press < budget; press++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    for (let frame = 0; frame < 600; frame++) {
      const box = nes.cpu.mem[BOX_STATE];
      if (box === BOX_NAMEENTRY) return false;
      if (box === BOX_PAGEWAIT || box === BOX_ENDWAIT || nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) break;
      nes.frame();
    }
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    if (nes.cpu.mem[BOX_STATE] === BOX_NAMEENTRY) return false;
    tap(nes, A);
    for (let i = 0; i < 20; i++) nes.frame();
  }
  return nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
}

/** Walk to Iris (208,48) and recruit her -- the shared shape every plain
 *  recruit-Iris scenario in this file wants, now that sample-rpg ships her
 *  renamable (phase 5): talkThrough returns false the instant her own named
 *  Join opens the naming grid mid-conversation, so this drives the grid to
 *  END with the seeded default left untouched (the same as
 *  finishNamingIfOpen leaves a hero session) and resumes the conversation,
 *  the §14 "one segment at a time" shape talkThrough's own header already
 *  describes. A caller that needs the grid itself under test (a typed name,
 *  the ST_DIALOG/BOX_NAMEENTRY split) drives it directly instead, the way
 *  the dedicated named-Join test does. */
function recruitIris(nes) {
  walkTo(nes, 208, 48);
  if (talkThrough(nes)) return;
  waitForNamingReady(nes);
  gotoCell(nes, 2, 1); // END, leaving the seeded default name exactly as compiled
  tap(nes, A);
  for (let i = 0; i < 20 && nes.cpu.mem[BOX_STATE] === BOX_NAMEENTRY; i++) nes.frame();
  assert.ok(talkThrough(nes), 'the conversation never resumed after Iris\'s naming session');
}

// --- in-game party-member naming (docs/design-name-entry.md §14) ----------
//
// The grid helpers themselves live in test/lib/naming.js, shared with
// test/unit/nameentry.test.js (the action, kernel-lo placement) -- P2
// hygiene, phase 3 fix round 2. The shared shape is naming.js's own: every
// helper operates on an already-booted `nes` instance. bootPastNaming below
// is this file's own thin wrapper around that shape, since it is the one
// piece that is genuinely specific to this file (this file's own boot()/
// ROM_PATH, not naming.js's business).

/** Boot, then clear any hero-naming session with the default seeded name
 *  untouched -- this file's own boot()/ROM_PATH piped into naming.js's own
 *  finishNamingIfOpen. */
function bootPastNaming(romPath = ROM_PATH, frames = 40) {
  return finishNamingIfOpen(boot(romPath, frames));
}

// engine/constants.asm
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;

/** Which entity slot the given actor id currently occupies, or -1. */
function findBossSlot(nes, actorId) {
  for (let slot = 0; slot < 8; slot++) {
    if (nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === actorId) return slot;
  }
  return -1;
}

/** Run frames until it is a party member's turn to choose. */
function waitForMenu(nes, budget = 900) {
  for (let i = 0; i < budget && nes.cpu.mem[BT_PHASE] !== BP_MENU; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'the menu never came round');
}

/**
 * `count` tiles of the nametable at $2000, starting at (row, col) -- the raw
 * tile ids battle.asm/battleui.asm actually wrote, comparable directly to
 * nameTiles()'s output. Reads engine RAM cannot see: a wrong offset into
 * pc_name/mon_name/item_name/spell_name still leaves every RAM byte correct,
 * since the bug (handoff-namestride/brief-namestride.md) is in what
 * name_offset_pc hands a consumer, not in any table's own contents.
 */
function nametableRow(nes, row, col, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(nes.ppu.vramMem[0x2000 + row * 32 + col + i]);
  return out;
}

/**
 * The first nine columns of a battle string's own line -- push_battle_string
 * (engine/battleui.asm) overwrites the last three with a printed number, so
 * comparing the whole twelve would fail against a real damage-tick line
 * regardless of whether the label itself is right. `text` is BATTLE_STRINGS'
 * own second column (main/build/battletables.js), e.g. 'poisoned'/'burned'.
 */
function battleStringTiles(text) {
  return textToTiles(text.padEnd(9, ' ').slice(0, 9)).tiles;
}

/**
 * Pads `project.sprites.actors` with harmless filler entries so the next
 * actor pushed lands at exactly `targetId`. sprites.actors is indexed by id
 * (CLAUDE.md: "sprites.actors renumbers every later actor on a delete for
 * the identical reason"), and mon_name/mon_hp/etc (main/build/
 * battletables.js) are emitted one row per array position -- so id === array
 * index has to hold for a filler to land where its own id says it does.
 */
function padActorsTo(project, targetId) {
  const actors = project.sprites.actors;
  const template = structuredClone(actors[0]);
  while (actors.length < targetId) {
    const id = actors.length;
    actors.push({ ...structuredClone(template), id, name: `F${id}`, damage: 0, hp: 1 });
  }
}

/**
 * A build of the sample with `mutate` applied, in a temp dir the test owns.
 * Returns the full buildProject() result (romPath, symbolPath) -- most
 * callers only want romPath, so buildVariant below is the common case.
 */
async function buildVariantFull(t, name, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `forge-${name}-`));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // Naming stays exactly as sample-rpg ships it (phase 5, docs/design-
  // name-entry.md v16.4 §17 item 5, P2-2 fix round 2): hero and Join naming
  // both on for real, the same as every player of the shipped fixture sees.
  // A variant that genuinely needs naming off says so itself, in its own
  // `mutate`. Every non-naming-specific caller boots through
  // bootPastNaming() (hero naming, at cold boot) and recruits Iris through
  // recruitIris() (Join naming, mid-script) instead of stripping the flag
  // out from under the scenario its own test name describes.
  mutate(project);
  await saveProject(dir, project);
  return buildProject({ dir, project, log: () => {} });
}

/** A build of the sample with `mutate` applied, in a temp dir the test owns. */
async function buildVariant(t, name, mutate) {
  const built = await buildVariantFull(t, name, mutate);
  return built.romPath;
}

// --- calling one engine routine in isolation --------------------------------
//
// A stub JSR/NOP pair at $0700 (plain RAM, mirrored from $0000-$07FF, so it is
// executable regardless of which PRG bank is currently mapped), landing PC
// one byte before it so the very first emulate() step fetches the JSR. Used
// to unit-test a single routine's own contract without driving the whole
// game loop up to the exact frame that would reach it.
function callRoutine(nes, address) {
  nes.mmap.write(0x2000, 0); // NMI generation off -- a stray NMI mid-stub would
                              // both divert PC and inflate the returned cycle count
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1; // and IRQ must not land mid-stub either
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let cycles = 0;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    cycles += nes.cpu.emulate();
    assert.ok(++steps < 20000, 'routine never returned to the stub');
  }
  return cycles;
}

/**
 * The battle system's own code (battle.asm/battleui.asm/battleturn.asm) lives
 * in the switchable PRG window, which call_battle only ever holds mapped for
 * the duration of one call -- CLAUDE.md's "The battle system" section, and
 * engine/banks.asm's own call_battle comment ("the restore *is* the return").
 * So between frames the window is back to whatever screen bank the field was
 * showing, and jsr'ing straight into a battle-bank address from outside a
 * frame would execute that screen's data as code. switch_prg_bank itself
 * lives in the fixed kernel ($C000+), so it is reachable regardless, and
 * selecting BATTLE_BANK first (read out of this build's own generated
 * config.inc, never guessed) is what makes a direct call into battle-bank
 * code like apply_damage safe to make in isolation.
 */
function selectBattleBank(nes, built) {
  const dir = path.dirname(path.dirname(built.romPath));
  const configText = fs.readFileSync(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  const match = configText.match(/^BATTLE_BANK\s*=\s*(\d+)/m);
  assert.ok(match, 'BATTLE_BANK should be a named constant in config.inc');
  const battleBank = parseInt(match[1], 10);
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  nes.cpu.REG_ACC = battleBank;
  callRoutine(nes, addrOf('switch_prg_bank'));
  return addrOf;
}

/**
 * Resolve one RAM symbol out of a build's own `build/constants.asm`, the
 * copy that assembled the ROM in hand (Code Forge override included) --
 * shared/enginesyms.js's own parseEquates only understands a bare literal,
 * not a chained `name = otherName+1` expression, and most of this engine's
 * zero-page map (bt_wipe_mask included) is chained precisely so a new byte
 * never moves an existing one. This walks the identical chain by hand,
 * resolving `NAME = $hex`, `NAME = decimal`, `NAME = otherName`, and
 * `NAME = otherName+decimal` lines, exactly the restricted grammar this
 * codebase's own equate chains stay inside (rammap.test.js's scanEquates
 * documents and audits the same shape, project-wide).
 */
function resolveEngineAddress(constantsText, name) {
  const equates = new Map();
  for (const line of constantsText.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+)/);
    if (!m) continue;
    const [, n, rawExpr] = m;
    if (!equates.has(n)) equates.set(n, rawExpr.trim());
  }
  const cache = new Map();
  function resolve(n, seen) {
    if (cache.has(n)) return cache.get(n);
    assert.ok(!seen.has(n), `circular equate chain resolving ${n}`);
    seen.add(n);
    const expr = equates.get(n);
    assert.ok(expr !== undefined, `${n} is not defined in this build's own constants.asm`);
    let value;
    const hex = expr.match(/^\$([0-9A-Fa-f]+)$/);
    const dec = expr.match(/^(\d+)$/);
    const sum = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([A-Za-z_][A-Za-z0-9_]*|\d+)$/);
    const bare = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
    if (hex) value = parseInt(hex[1], 16);
    else if (dec) value = parseInt(dec[1], 10);
    else if (sum) {
      const add = /^\d+$/.test(sum[2]) ? parseInt(sum[2], 10) : resolve(sum[2], seen);
      value = resolve(sum[1], seen) + add;
    } else if (bare) value = resolve(bare[1], seen);
    else assert.fail(`${n} = ${expr} does not fit resolveEngineAddress's restricted grammar (literal, bare name, name+decimal, or name+name)`);
    cache.set(n, value);
    return value;
  }
  return resolve(name, new Set());
}

// --- the tables -------------------------------------------------------------

test('the level curve is a running total, so a level is never skipped', () => {
  const curve = xpCurve({ xpBase: 8, xpGrow: 4, maxLevel: 5 });
  assert.deepEqual(curve, [8, 20, 36, 56]);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] > curve[i - 1]);
});

test('per-level stats are base plus growth, and never overflow a byte', () => {
  assert.equal(statAt(24, 5, 1), 24);
  assert.equal(statAt(24, 5, 4), 39);
  assert.equal(statAt(200, 40, 15), 255, 'a byte is a byte');
});

test('an RPG on a mapper that cannot switch program banks is refused by name', () => {
  const project = createProject('Quest', 'rpg');
  project.cartridge.mapper = 0; // NROM
  const { problems } = checkCapacity(project);
  const refusal = problems.find(
    (problem) => problem.severity === 'error' && /program bank switching/.test(problem.message)
  );
  assert.ok(refusal, `expected a named refusal, got ${JSON.stringify(problems)}`);
});

// --- the battle -------------------------------------------------------------

test('walking far enough starts a battle, and the party is on the screen', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  assert.equal(nes.cpu.mem[PARTY_SIZE], 1);
  assert.ok(nes.cpu.mem[PC_HP] > 0, 'the party never got its hit points');

  assert.ok(walkIntoEncounter(nes), 'no wandering monster after nine hundred steps');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'the battle should be waiting for a command');
  assert.equal(nes.cpu.mem[BT_COUNT], 1, 'one monster should be in the formation');
  assert.ok(nes.cpu.mem[MON_HP] > 0, 'the monster has no hit points');
  assert.equal(nes.cpu.mem[MON_ALIVE], 1);

  // The world is frozen behind it, which is what ST_BATTLE is for.
  const x = nes.cpu.mem[PLAYER_X];
  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 30; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  assert.equal(nes.cpu.mem[PLAYER_X], x, 'the player walked during a battle');
});

test('FIGHT wears the monster down, and winning pays experience and gold', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  assert.ok(walkIntoEncounter(nes));
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should ask who to hit');
  tap(nes, A, 20); // confirm the target and let the exchange play out

  // An attack can miss — accuracy against evasion is a roll — so this waits for
  // one to land rather than assuming the first does.
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');

  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'the monster survived');
  assert.ok(nes.cpu.mem[PC_XP_LO] > 0, 'no experience was awarded');
  assert.ok(nes.cpu.mem[GOLD_LO] > 0, 'no gold was awarded');
});

test('MAGIC spends MP and does more to something the spell is strong against', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  assert.ok(walkIntoEncounter(nes));
  const startMp = nes.cpu.mem[PC_MP];
  const startHp = nes.cpu.mem[MON_HP];
  assert.ok(startMp > 0, 'the party member has no magic points');

  chooseCommand(nes, BC_MAGIC);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_SPELLS, 'MAGIC should open the spell list');
  tap(nes, A, 6); // the first spell it knows
  assert.ok(nes.cpu.mem[PC_MP] < startMp, 'casting cost nothing');
  tap(nes, A, 20); // confirm the target

  // Ember is a fire spell and the slime is weak to fire, so the ten it does
  // should land as fifteen — comfortably more than a plain attack.
  const dealt = startHp - nes.cpu.mem[MON_HP];
  assert.ok(dealt >= 12, `a spell against a weakness only did ${dealt}`);
});

test('a spell nobody can pay for is refused rather than cast', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-nomp-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.party[0].baseMp = 0;
  project.party[0].mpPerLevel = 0;
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = bootPastNaming(built.romPath);
  assert.equal(nes.cpu.mem[PC_MP], 0);
  assert.ok(walkIntoEncounter(nes));
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_MAGIC);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_SPELLS, 'the list should still open — the spell is known');
  tap(nes, A, 20);
  assert.equal(nes.cpu.mem[MON_HP], startHp, 'an unaffordable spell went off anyway');
});

test('a fight you were dragged into can be run from; one you walked into cannot', {
  skip: needsSample
}, () => {
  // Walking into a monster somebody placed is a fight the author meant to
  // happen, so RUN says so rather than rolling for it.
  const touched = bootPastNaming();
  for (let step = 0; step < 200 && touched.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const buttons = [];
    if (touched.cpu.mem[PLAYER_X] < 168) buttons.push(RIGHT);
    if (touched.cpu.mem[PLAYER_Y] < 168) buttons.push(DOWN);
    if (!buttons.length) break;
    for (const button of buttons) touched.buttonDown(1, button);
    touched.frame();
    for (const button of buttons) touched.buttonUp(1, button);
  }
  for (let i = 0; i < 30 && touched.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) touched.frame();
  assert.equal(touched.cpu.mem[GAME_STATE], ST_BATTLE);
  chooseCommand(touched, BC_RUN);
  for (let i = 0; i < 200; i++) touched.frame();
  assert.equal(touched.cpu.mem[GAME_STATE], ST_BATTLE, 'a placed monster should not let you leave');
  assert.equal(touched.cpu.mem[MON_ALIVE], 1);

  const nes = bootPastNaming();
  assert.ok(walkIntoEncounter(nes));

  // Running is a roll, so this keeps choosing it until it works — and never
  // presses A outside the menu, because a stray press would confirm FIGHT and
  // the test would end up proving something else entirely.
  let escaped = false;
  for (let attempt = 0; attempt < 30 && !escaped; attempt++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    // BP_MENU is a choice; BP_DONE is the line saying how it ended, which waits
    // for a press like every other outcome does.
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else if (nes.cpu.mem[BT_PHASE] === BP_DONE) tap(nes, A, 10);
    for (let i = 0; i < 90; i++) nes.frame(); // messages time themselves out
    escaped = nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
  }
  assert.ok(escaped, 'twenty attempts to run all failed, which is not a roll');
  assert.equal(nes.cpu.mem[MON_ALIVE], 1, 'running away should not beat anything');
  assert.equal(nes.cpu.mem[PC_XP_LO], 0, 'running away should pay nothing');
});

test('a wipe ends the game the same way running out of hearts does', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-wipe-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // A monster that cannot miss and hits harder than the party can survive.
  project.sprites.actors[0].battle = {
    ...project.sprites.actors[0].battle,
    atk: 250,
    acc: 255,
    speed: 200,
    def: 200
  };
  project.sprites.actors[0].hp = 200;
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = bootPastNaming(built.romPath);
  assert.ok(walkIntoEncounter(nes));
  chooseCommand(nes, BC_FIGHT);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[PC_HP], 0, 'the party should have been wiped out');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'a wipe should reach the game-over screen');
});

test('a status a lost battle leaves behind does not survive the restart that follows it', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-lostbattle-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // The same guaranteed loss "a wipe ends the game" above sets up.
  project.sprites.actors[0].battle = {
    ...project.sprites.actors[0].battle,
    atk: 250,
    acc: 255,
    speed: 200,
    def: 200
  };
  project.sprites.actors[0].hp = 200;
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = bootPastNaming(built.romPath);
  assert.ok(walkIntoEncounter(nes));
  // Poisoned mid-fight, the same way a monster's own Venom would leave it --
  // battle_finish (engine/battleturn.asm) jumps straight to player_died on
  // defeat, so battle_end never runs and never gets a chance to clear this.
  nes.cpu.mem[PC_STATUS] = 1;
  chooseCommand(nes, BC_FIGHT);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'the party should have been wiped out');
  assert.equal(
    nes.cpu.mem[PC_STATUS],
    1,
    'a defeat should not clear this on its own -- init_session is what is under test here, on restart'
  );

  for (let i = 0; i < 300 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the game-over message never finished');
  tap(nes, START, 10); // sample-rpg has no title, so this starts a new game directly
  // Rian ships renamable (phase 5), and restart_game re-seeds a fresh naming
  // session on every new game the same as a cold boot does (the dedicated
  // "restart_game re-seeds the default name" test below covers that in
  // detail) -- unrelated to what this test is about, so just clear it.
  finishNamingIfOpen(nes);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'restarting should have started a new game');
  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'init_session should clear a status a lost battle left behind');
});

// --- scripted heal and damage -----------------------------------------------
//
// engine/rpg.asm's party_heal/party_damage, reached from the field through
// OP_HEAL/OP_DAMAGE -- the RPG side of what combat.asm's gain_hearts/
// lose_hearts already are for an action project. Placed on actor 2 (Iris),
// the sample's own harmless npc -- the same actor id the "coming back from a
// battle" test above places a second time elsewhere on this screen, so a
// second placement carrying its own event is already proven not to collide
// with her own Join event at (208,32).

/** Iris, standing just above the player's own start position. */
function teller(pages, { x = 112, y = 96 } = {}) {
  return { actorId: 2, x, y, props: { event: { pages } } };
}

test('scripted Heal and Damage change every recruited member\'s HP, saturating at the max', {
  skip: needsSample
}, async (t) => {
  const TOUCHED = 20;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-healdamage-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].screens[0].entities.push(
    teller([
      {
        cond: { type: 'switchOff', arg: TOUCHED },
        commands: [{ op: 'say', text: 'Ow.' }, { op: 'damage', value: 3 }, { op: 'setSwitch', switch: TOUCHED }]
      },
      { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'There.' }, { op: 'heal', value: 255 }] }
    ])
  );
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = bootPastNaming(built.romPath);
  const max = nes.cpu.mem[PC_HP_MAX];
  assert.equal(nes.cpu.mem[PC_HP], max, 'the session should start on full HP');

  assert.ok(talkThrough(nes), 'the first conversation never ended');
  assert.equal(nes.cpu.mem[PC_HP], max - 3, 'Damage 3 should take exactly three HP');

  assert.ok(talkThrough(nes), 'the second conversation never ended');
  assert.equal(nes.cpu.mem[PC_HP], max, 'Heal 255 should be a full heal, saturating at the max');
});

test('Heal revives a party member who has fallen to zero, the same as an inn would', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'revive', (project) => {
    project.maps[0].screens[0].entities.push(
      teller([{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Rest.' }, { op: 'heal', value: 255 }] }])
    );
  });
  const nes = bootPastNaming(rom);
  const max = nes.cpu.mem[PC_HP_MAX];
  nes.cpu.mem[PC_HP] = 0; // fallen, but still recruited -- pc_in_party is untouched

  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[PC_HP], max, 'a fallen member should have been revived to the max');
});

test('a killing Damage wipes the whole recruited party and reaches game over ' +
  'without running the rest of the page', {
  skip: needsSample
}, async (t) => {
  const TOUCHED = 21;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-partywipe-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].encounters = { rate: 0, actorIds: [] }; // a wandering monster must not race this
  project.maps[0].screens[0].entities.push(
    teller([
      {
        cond: { type: 'none', arg: 0 },
        commands: [{ op: 'say', text: 'Ow.' }, { op: 'damage', value: 255 }, { op: 'setSwitch', switch: TOUCHED }]
      }
    ])
  );
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = bootPastNaming(built.romPath);
  // Recruit Iris first, so this is genuinely "everyone recruited," not a
  // one-member party's coincidence -- the same route the Join test above
  // proves is walkable both ways.
  recruitIris(nes);
  assert.equal(nes.cpu.mem[PARTY_SIZE], 2, 'Iris never joined');
  walkTo(nes, 112, 112);

  tap(nes, B);
  for (let i = 0; i < 300 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the line never finished');
  tap(nes, A); // dismiss -- resumes the script, and the killing Damage runs
  for (let i = 0; i < 300 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();

  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'wiping every recruited member should reach game over');
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the game-over message never finished');
  assert.equal(nes.cpu.mem[PC_HP], 0);
  assert.equal(nes.cpu.mem[PC_HP + 1], 0, "Iris's HP should have been wiped too");
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << TOUCHED),
    0,
    'the command after the killing Damage ran on a dead session'
  );
});

// --- the Damage metatile ------------------------------------------------
//
// engine/combat.asm's player_hazard now agrees with the scripted Damage
// command above about which health model an RPG means: the whole recruited
// party's HP through rpg.asm's party_damage, not player_hp. Getting there
// took two traps beyond the routing itself, both in player_hazard and
// update_player -- see combat.asm's own header comment.

test('standing on a Damage metatile drains the party on a cooldown, not every frame', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hazard-cooldown', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] }; // isolate the hazard from a wandering fight
    const damageId = 1;
    project.metatiles[damageId].collision = 'damage';
    project.maps[0].screens[0].metatiles = project.maps[0].screens[0].metatiles.map(() => damageId);
  });
  // The player starts standing on the tile, so booting already ran through
  // one hit before this test gets control -- worth keeping, not
  // working around, since it is exactly the "standing still costs a hit,
  // then nothing until the cooldown is up" behaviour under test, one hit
  // earlier than the rest of it.
  const nes = bootPastNaming(rom);
  const max = nes.cpu.mem[PC_HP_MAX];
  const afterBoot = nes.cpu.mem[PC_HP];
  assert.ok(afterBoot < max, 'standing on the tile through boot should already have cost something');
  assert.ok(afterBoot > max - 3, `boot alone cost ${max - afterBoot} HP, not roughly one hit`);

  // Well inside IFRAME_TIME's 60-frame cooldown (engine/constants.asm): a
  // naive routing with no cooldown, reusing player_hazard's action-mode body
  // verbatim, would already be draining the party every frame here.
  for (let i = 0; i < 15; i++) nes.frame();
  assert.equal(nes.cpu.mem[PC_HP], afterBoot, 'HP dropped again well inside the cooldown window');

  // Past a full cooldown window: exactly one more hit, not the continuous
  // per-frame drain that would already have wiped the party by now.
  for (let i = 0; i < 60; i++) nes.frame();
  const afterSecondWindow = nes.cpu.mem[PC_HP];
  assert.ok(afterSecondWindow > 0, 'the party was drained to zero standing still');
  assert.ok(afterSecondWindow < afterBoot, 'a second cooldown window should have cost something too');
  assert.ok(
    afterSecondWindow > afterBoot - 3,
    `the second window cost ${afterBoot - afterSecondWindow} HP, not roughly one hit`
  );
});

test('a lethal Damage metatile hit does not lose the race to a wandering encounter on the same step', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hazard-vs-encounter', (project) => {
    const damageId = 1;
    project.metatiles[damageId].collision = 'damage';
    // The whole screen open, one tile of Damage one column right of the start
    // position, and the start position placed one pixel short of that column
    // boundary -- so the very first frame the player moves is also the frame
    // player_hazard's probe (taken after moving) lands on the Damage tile.
    project.maps[0].screens[0].metatiles = project.maps[0].screens[0].metatiles.map(() => 0);
    project.maps[0].screens[0].metatiles[114] = damageId;
    project.project.startX = 23; // probe_x = startX+8 = 31, one pixel short of column 2
    project.project.startY = 112;
    // rate 1: the very first moving step already reaches the threshold, and
    // every one of the four formation slots names the same monster so a roll
    // of 1..4 slots always lands on a real encounter regardless of which
    // count it draws -- otherwise this test would only exercise the race by
    // luck.
    project.maps[0].encounters = { rate: 1, actorIds: [0, 0, 0, 0] };
  });
  const nes = bootPastNaming(rom);
  nes.cpu.mem[PC_HP] = 1; // one hit from the tile is lethal

  // One frame: the step that both crosses onto the Damage tile and makes
  // enc_step reach the map's rate (moving becomes true on the very same
  // frame) -- the exact race player_hazard's own game_state guard in
  // update_player exists for.
  nes.buttonDown(1, RIGHT);
  nes.frame();
  nes.buttonUp(1, RIGHT);
  for (let i = 0; i < 30; i++) nes.frame();

  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'the lethal hit should have ended the game');
  assert.notEqual(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'an encounter due the same step must not overwrite game over');
});

/**
 * A JS mirror of rng_next (engine/rpg.asm 14-24): an 8-bit Galois LFSR, zero
 * mapped to a fixed nonzero state so it is never a lock point. Used only to
 * predict what one call advances the byte to -- never to decide what a roll
 * "should" be by construction, which is exactly the gap that let `and #$83`
 * (see below) pass a test that only checked the observed counts' shape.
 */
function referenceRngNext(v) {
  if (v === 0) v = 0xa5;
  const carry = (v & 0x80) !== 0;
  v = (v << 1) & 0xff;
  if (carry) v ^= 0x71;
  return v & 0xff;
}

/**
 * Whether some second advance in `advances` would expose a wrong `and #3`
 * mask that flips `bit`. Losing bit 0 or bit 1 changes the roll on any
 * advance that has the bit set at all. Gaining a bit in 2..7 only changes
 * the roll when the advance's own low two bits are not already 3 -- an
 * advance of, say, binary `...111` (low bits already 3, count 4) looks
 * identical whether or not a wrong mask also keeps some higher bit, since
 * both clamp to the same 4-slot fill via start_encounter's own loop bound.
 * `and #$0B` (round 3) is exactly a seed set missing this: every stride-8
 * second advance that had bit 3 set also had low bits already 3, so gaining
 * bit 3 never showed up.
 */
function maskBitCovered(advances, bit) {
  if (bit <= 1) return advances.some((v) => (v & (1 << bit)) !== 0);
  return advances.some((v) => (v & (1 << bit)) !== 0 && (v & 3) !== 3);
}

// start_encounter used to take exactly bt_tmp2 slots, and check_encounter
// rolled bt_tmp2 as rng_next() & 3 -- 0..3, never 4, so a roll of 0 filled no
// slots and fell into start_encounter_none, silently starting no fight (a
// quarter of triggered encounters were a no-op, and the fourth encounter-table
// slot was dead). The fix makes bt_tmp2 mean "how many slots to take" (1..4)
// instead. One ROM, built once and reused across every seed below, with four
// distinct real monster actors (sample-rpg's own Slime and Snake, id 0 and 3,
// plus two more cloned from them below -- id 1 is the Potion pickup and id 2
// is Iris, an NPC, neither a monster) so a filled slot proves it copied its
// own table entry rather than merely being non-$FF.
test('a wandering encounter always takes 1..4 slots -- never zero, and every count 1..4 is reachable', {
  skip: needsSample
}, async (t) => {
  const formation = {};
  const built = await buildVariantFull(t, 'encounter-roll', (project) => {
    const actors = project.sprites.actors;
    const idC = actors.length;
    actors.push({ ...structuredClone(actors[0]), id: idC, name: 'Slime2' }); // Slime's own stats
    const idD = actors.length;
    actors.push({ ...structuredClone(actors[3]), id: idD, name: 'Snake2' }); // Snake's own stats
    formation.ids = [0, 3, idC, idD]; // sample-rpg's own two monsters plus two more, all distinct
    project.maps[0].encounters = { rate: 1, actorIds: formation.ids };
  });
  const IDS = formation.ids;

  // Spread across the whole byte range rather than computing the LFSR by
  // hand: enough seeds that the roll's low two bits (taken after
  // check_encounter's own two rng_next() advances -- line 32's unconditional
  // roll, then line 46's actual roll) are observed to cover 0..3. A stride of
  // 8 (round 2) was not enough on its own -- none of those 32 seeds' second
  // advances happened to have bit 3 set, so `and #$0B` passed unnoticed; the
  // self-check right below is what would have caught that instead of relying
  // on this comment's own claim.
  const seeds = [];
  for (let seed = 0; seed < 256; seed += 6) seeds.push(seed);

  // Prove the seed set can see every wrong mask `and #3` could become,
  // rather than merely asserting it in a comment (the round-2 gap): for
  // every bit `and #3` could gain (2..7) or lose (0, 1), some seed's second
  // advance must be able to expose it (maskBitCovered above). A future edit
  // that thins this list back down fails loudly here, naming the bit, rather
  // than quietly reopening the hole assertion (c) below depends on closing.
  const secondAdvances = seeds.map((seed) => referenceRngNext(referenceRngNext(seed)));
  for (let bit = 0; bit <= 7; bit++) {
    assert.ok(
      maskBitCovered(secondAdvances, bit),
      `this seed set cannot see a wrong "and #3" mask that changes bit ${bit} -- no chosen seed's second rng_next ` +
        `advance ${bit <= 1 ? 'has that bit set' : 'has that bit set while its own low two bits are not already 3'}` +
        '; add a seed whose second advance does'
    );
  }

  const observedCounts = new Set();
  for (const seed of seeds) {
    const nes = bootPastNaming(built.romPath);
    nes.cpu.mem[RNG] = seed;
    nes.buttonDown(1, RIGHT);
    nes.frame();
    nes.buttonUp(1, RIGHT);
    for (let i = 0; i < 10; i++) nes.frame();

    // (a) no roll yields zero -- a rate-1 map always starts a fight.
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_BATTLE,
      `rng seed ${seed}: a triggered wandering encounter must always enter battle, never silently do nothing`
    );

    // (b) the filled slots are always a prefix -- slots 0..count-1 hold
    // IDS[0..count-1] in order, and count is always in 1..4.
    const slots = [0, 1, 2, 3].map((i) => nes.cpu.mem[MON_SLOT_ACTOR + i]);
    const count = slots.filter((v) => v !== 0xff).length;
    observedCounts.add(count);
    assert.ok(count >= 1 && count <= 4, `rng seed ${seed}: filled slot count ${count} is outside 1..4`);
    for (let slot = 0; slot < 4; slot++) {
      const expected = slot < count ? IDS[slot] : 0xff;
      assert.equal(
        slots[slot],
        expected,
        `rng seed ${seed}: slot ${slot} should be ${expected === 0xff ? '$FF (empty)' : expected} but was ${slots[slot]}`
      );
    }

    // (c) the count is not merely in range -- it is exactly the roll this
    // seed predicts. check_encounter calls rng_next twice on the field
    // (line 32, unconditional; line 46, the roll) before start_encounter
    // ever reads bt_tmp2, so a seeded rng sees exactly those two advances.
    // This is what and #$83 (same instruction size as and #3, so a wrong
    // fix could slip past a size-only sabotage check) fails: it still
    // clamps to a valid 1..4 count via start_encounter's own loop bound,
    // and still eventually shows all four counts across enough seeds, but
    // the count it picks for a *given* seed stops matching this formula.
    const firstAdvance = referenceRngNext(seed);
    const secondAdvance = referenceRngNext(firstAdvance);
    const predictedCount = (secondAdvance & 3) + 1;
    assert.equal(
      count,
      predictedCount,
      `rng seed ${seed}: predicted count ${predictedCount} from two rng_next advances (${firstAdvance}, then ` +
        `${secondAdvance}) but the ROM filled ${count} slots -- either the fix does not mask to 0..3 before ` +
        'adding one, or this reference model no longer matches rng_next'
    );
  }

  assert.deepEqual(
    [...observedCounts].sort(),
    [1, 2, 3, 4],
    `every formation size 1..4 should be reachable across these seeds; observed ${JSON.stringify([...observedCounts].sort())}`
  );
});

// player_iframes (engine/combat.asm) is the action side's own invincible
// window, and player_hazard reuses it purely as the RPG's floor-damage
// cooldown -- see this file's own header comment. entity_contact used to
// read that same byte before deciding whether to start a contact battle,
// which meant a Damage metatile silently suppressed every monster encounter
// for the ~60 frames after it hit: a player who stepped on a hazard could
// then walk straight through a monster with no fight at all.
test('touching a damaging actor still starts a fight inside a Damage metatile\'s cooldown', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hazard-then-touch', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] }; // isolate from a wandering fight
    const damageId = 1;
    project.metatiles[damageId].collision = 'damage';
    project.maps[0].screens[0].metatiles = project.maps[0].screens[0].metatiles.map(() => damageId);
    // The slime (actorId 0, damage 1) one metatile right of the start
    // position -- close enough to touch a handful of frames after boot,
    // well inside IFRAME_TIME's 60-frame cooldown the floor hit standing at
    // start already armed.
    const slime = project.maps[0].screens[0].entities.find((e) => e.actorId === 0);
    slime.x = project.project.startX + 16;
    slime.y = project.project.startY;
  });
  const nes = bootPastNaming(rom);
  // Booting already took the floor hit standing at start (see the cooldown
  // test above), so player_iframes is still well inside
  // IFRAME_TIME here -- exactly the window entity_contact's bug left a
  // contact battle unable to start in.
  assert.ok(nes.cpu.mem[PC_HP] < nes.cpu.mem[PC_HP_MAX], 'the floor hit before this test began should have landed');

  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  nes.buttonUp(1, RIGHT);

  assert.equal(
    nes.cpu.mem[GAME_STATE],
    ST_BATTLE,
    "touching the slime inside the floor hazard's cooldown should still have started a fight"
  );
});

test('enough experience raises a level, and a level restores you', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-level-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // One easy monster worth more than a level's worth of experience.
  project.sprites.actors[0].hp = 1;
  project.sprites.actors[0].battle = {
    ...project.sprites.actors[0].battle,
    xp: 60,
    def: 0,
    eva: 0,
    acc: 0, // and it can never land a hit, so the level-up is the only change
    speed: 1
  };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = bootPastNaming(built.romPath);
  const hpAtOne = nes.cpu.mem[PC_HP_MAX];
  assert.equal(nes.cpu.mem[PC_LEVEL], 1);

  assert.ok(walkIntoEncounter(nes));
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  pressThrough(nes);

  assert.ok(nes.cpu.mem[PC_LEVEL] > 1, 'sixty experience should have been worth a level');
  assert.ok(nes.cpu.mem[PC_HP_MAX] > hpAtOne, 'a level should raise the maximum');
  assert.equal(nes.cpu.mem[PC_HP], nes.cpu.mem[PC_HP_MAX], 'a level should heal you to the new maximum');
});

test('walking into a placed monster is a fight, and beating it removes it', {
  skip: needsSample
}, async (t) => {
  // Wandering monsters turned off, so the only fight that can start is the one
  // this test is about — otherwise a random encounter on the way to the corner
  // would be indistinguishable from the answer.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-touch-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = bootPastNaming(built.romPath);
  // The sample places a slime in the bottom-right corner.
  for (let step = 0; step < 400 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const buttons = [];
    if (nes.cpu.mem[PLAYER_X] < 168) buttons.push(RIGHT);
    if (nes.cpu.mem[PLAYER_Y] < 168) buttons.push(DOWN);
    if (!buttons.length) break;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');

  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let i = 0; i < 80 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);

  // Back on the field, and the actor that started it is gone rather than
  // standing there ready to start the same fight again.
  const ENT_ACTIVE = 0x300;
  const ENT_ACTOR = 0x308;
  for (let slot = 0; slot < 8; slot++) {
    if (nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === 0) {
      assert.fail('the beaten monster is back on the field');
    }
  }

  // touch_encounter records the slot that started the fight in bt_from_ent
  // (engine/rpg.asm), and battle_end deactivates exactly that entity after
  // the redraw, so the next update_entities pass skips it -- the same slot
  // cannot re-engage the instant control returns to the field. Another
  // gameplay frame, standing right where the fight happened, is the direct
  // check for that rather than an inference from the entity being gone.
  nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the field re-engaged the same slot on the very next frame');
});

test('coming back from a battle is not entering the screen again', {
  skip: needsSample
}, async (t) => {
  // A battle ends by redrawing the field, and a redraw is what arms an entry
  // event — so without a word from battle_end, every fight replays whatever the
  // screen says when the player walks in. On a screen with wandering monsters
  // that is every few steps.
  const VARIABLES = 0x500; // from engine/constants.asm
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-reentry-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  project.maps[0].screens[0].entities.push({
    actorId: 2, // Iris, who has nothing to do with the fight
    x: 96,
    y: 32,
    props: {
      trigger: 'enter',
      event: {
        pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }]
      }
    }
  });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = bootPastNaming(built.romPath);
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the entry event did not run when the game started');

  // Into the slime in the bottom-right corner, exactly as the touch-encounter
  // test does it.
  for (let step = 0; step < 400 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const buttons = [];
    if (nes.cpu.mem[PLAYER_X] < 168) buttons.push(RIGHT);
    if (nes.cpu.mem[PLAYER_Y] < 168) buttons.push(DOWN);
    if (!buttons.length) break;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the entry event ran again on the way to the fight');

  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let i = 0; i < 80 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the battle never ended');

  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the screen ran its entry event again when the battle ended');
});

// --- joining, and fighting as more than one ---------------------------------

test('a Join event recruits a member mid-script, and they fight from then on', {
  skip: needsSample
}, async (t) => {
  // Wandering monsters off, so the walk to Iris cannot be interrupted.
  const rom = await buildVariant(t, 'join', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const nes = bootPastNaming(rom);
  assert.equal(nes.cpu.mem[PARTY_SIZE], 1);
  assert.equal(nes.cpu.mem[PC_IN_PARTY + 1], 0, 'Iris should not start in the party');

  // Iris stands at (208,32); talking to her says a line, joins her, and sets
  // switch 0 — which is also the switch that hides her from then on.
  recruitIris(nes);

  assert.equal(nes.cpu.mem[PARTY_SIZE], 2, 'Join never ran');
  assert.equal(nes.cpu.mem[PC_IN_PARTY + 1], 1);
  assert.ok(nes.cpu.mem[PC_HP + 1] > 0, 'the recruit arrived with no hit points');
  assert.ok(nes.cpu.mem[SWITCHES] & 1, 'the event should have set switch 0');

  // The field survived the cross-bank call: the player can still walk, which
  // means mtptr is still pointing at the map and not at the battle system.
  const before = nes.cpu.mem[PLAYER_X];
  walkTo(nes, before - 16, 48, 30);
  assert.ok(nes.cpu.mem[PLAYER_X] < before, 'the player cannot move after the Join');

  // And the next battle seats both members: the turn order holds member 0,
  // member 1 and the monster, fastest first, with the rest empty.
  walkTo(nes, 112, 112);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');
  waitForMenu(nes);
  const order = Array.from({ length: 8 }, (_, i) => nes.cpu.mem[TURN_ORDER + i]);
  // Members are speed 4 and the slime speed 3, so the party leads the round.
  assert.deepEqual(order.slice(0, 3), [0, 1, 4], `turn order was ${order.join(',')}`);
  assert.equal(order[3], 0xff, 'a fourth combatant appeared from nowhere');

  const state = pressThrough(nes, 90);
  assert.equal(state, ST_GAMEPLAY, 'two attackers could not finish one slime');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);
  assert.ok(nes.cpu.mem[PC_XP_LO + 1] > 0, 'the recruit fought and earned nothing');
});

// --- in-game party-member naming (docs/design-name-entry.md, phase 3) ------

test('hero naming: a typed name lands in pc_name_ram at the right stride offset, and game_state hands off to gameplay', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hero-naming', (project) => {
    project.party[0].renamable = true;
  });
  const nes = boot(rom);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should open at the start of a new game');
  typeNameAndFinish(nes, 'Zed');
  for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the hero naming session never handed off to gameplay');
  assert.deepEqual(
    nameBytes(nes, 0),
    [...textToTiles('Zed').tiles, ...Array(NAME_LEN - 3).fill(textToTiles(' ').tiles[0])],
    'the typed name should land at pc_name_ram slot 0, blank-padded'
  );
});

// P2-1 (docs/design-name-entry.md phase 3 fix round 2): the banked-placement
// twin of the identical action-side test in nameentry.test.js -- mirrors it
// exactly, since the two placements are the whole point of this phase. A
// counter, not a switch: setSwitch is idempotent, so it cannot distinguish
// "fired once" from "fired twice."
test('hero naming: the starting screen\'s own entry event fires exactly once, after naming, never before and never twice', {
  skip: needsSample
}, async (t) => {
  const VARIABLES = 0x0500; // engine/constants.asm
  const rom = await buildVariant(t, 'hero-naming-entry-once', (project) => {
    project.party[0].renamable = true;
    const screen = project.maps[project.project.startMap].screens[project.project.startScreen];
    screen.entities[0].props.trigger = 'enter';
    screen.entities[0].props.event = {
      pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }]
    };
  });
  const nes = boot(rom);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should be open');
  waitForNamingReady(nes);
  assert.equal(
    nes.cpu.mem[VARIABLES],
    0,
    'the entry event must not have run yet while the naming session is still open -- proves this assertion is ' +
      'checking a byte that could actually be nonzero, not one structurally stuck at 0'
  );
  gotoCell(nes, 2, 1); // END, seeded default untouched
  tap(nes, A);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'naming should have handed off to gameplay');
  for (let i = 0; i < 20; i++) nes.frame(); // let a same-frame-armed entry event actually run
  assert.equal(
    nes.cpu.mem[VARIABLES],
    1,
    'the entry event must fire exactly once -- 0 would mean it never ran (settle_owed swallowed it), 2 would mean ' +
      'it ran once before naming and again after (the starting screen redrawn out from under a still-open session)'
  );
});

test('hero naming: DEL via the grid cell and DEL via the Cancel action produce identical pc_name_ram contents', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hero-naming-del', (project) => {
    project.party[0].renamable = true;
  });

  const viaGrid = boot(rom);
  waitForNamingReady(viaGrid);
  gotoCell(viaGrid, 0, 0); // 'A'
  tap(viaGrid, A);
  clearName(viaGrid); // DEL via the grid cell

  const viaCancel = boot(rom);
  waitForNamingReady(viaCancel);
  gotoCell(viaCancel, 0, 0);
  tap(viaCancel, A);
  for (let i = 0; i < NAME_LEN && viaCancel.cpu.mem[NM_LEN] > 0; i++) tap(viaCancel, B); // Cancel action
  assert.equal(viaCancel.cpu.mem[NM_LEN], 0, 'Cancel never emptied the name');

  assert.deepEqual(nameBytes(viaGrid, 0), nameBytes(viaCancel, 0), 'DEL via either path must leave identical bytes');
});

test('hero naming: nm_acted is a per-frame latch -- two queued button presses on the same frame produce exactly one grid action', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hero-naming-latch', (project) => {
    project.party[0].renamable = true;
  });
  const nes = boot(rom);
  waitForNamingReady(nes);
  clearName(nes);
  gotoCell(nes, 0, 0); // 'A'
  // Press A and B on the same frame -- select AND cancel/delete queued together.
  nes.buttonDown(1, A);
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, A);
  nes.buttonUp(1, B);
  for (let i = 0; i < 14; i++) nes.frame();
  assert.equal(nes.cpu.mem[NM_LEN], 1, 'exactly one grid action (the type) should have registered, not two that cancel out');
});

test('hero naming: DOWN then UP from row 0 returns to the exact starting cell; UP then DOWN does not, unless it started at column 0', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hero-naming-ring', (project) => {
    project.party[0].renamable = true;
  });
  const nes = boot(rom);
  waitForNamingReady(nes);
  gotoCell(nes, 0, 5);
  tap(nes, DOWN);
  tap(nes, UP);
  assert.equal(nes.cpu.mem[NM_ROW], 0, 'DOWN then UP should return to row 0');
  assert.equal(nes.cpu.mem[NM_COL], 5, 'DOWN then UP should return to the exact starting column');

  const nes2 = boot(rom);
  waitForNamingReady(nes2);
  gotoCell(nes2, 0, 5);
  tap(nes2, UP);
  tap(nes2, DOWN);
  assert.equal(nes2.cpu.mem[NM_ROW], 0, 'UP then DOWN should still land on row 0 (DOWN\'s own wrap)');
  assert.notEqual(nes2.cpu.mem[NM_COL], 5, 'UP then DOWN from a non-zero column must NOT return to the start -- DOWN wraps to column 0 unconditionally');
  assert.equal(nes2.cpu.mem[NM_COL], 0, 'DOWN\'s own wrap always resets the column to 0');
});

test('hero naming: an empty name (END pressed immediately after clearing) is accepted, and the seeded default round-trips unchanged when END is pressed with no edits', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hero-naming-empty', (project) => {
    project.party[0].renamable = true;
  });

  const empty = boot(rom);
  waitForNamingReady(empty);
  clearName(empty);
  gotoCell(empty, 2, 1); // END
  tap(empty, A);
  for (let i = 0; i < 20 && empty.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) empty.frame();
  assert.equal(empty.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'an all-space name must be accepted, not rejected');
  assert.deepEqual(nameBytes(empty, 0), Array(NAME_LEN).fill(textToTiles(' ').tiles[0]), 'an all-space name should read back as ten space tiles');

  const seeded = boot(rom);
  waitForNamingReady(seeded);
  const before = nameBytes(seeded, 0);
  gotoCell(seeded, 2, 1); // END, no edits
  tap(seeded, A);
  for (let i = 0; i < 20 && seeded.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) seeded.frame();
  assert.deepEqual(nameBytes(seeded, 0), before, 'the seeded default must round-trip unchanged when END is pressed with no edits');
});

test('hero naming: restart_game (a game over\'s own path back to a fresh session) re-seeds the default name, not whatever the last session typed', {
  skip: needsSample
}, async (t) => {
  // A real, scripted killing hit, not a poked PC_HP array: an 'enter'
  // trigger with a live Damage command for 255 reaches player_died through
  // the ordinary field path (script_op_damage -> party_damage -> jmp
  // player_died, engine/script.asm/engine/rpg.asm) the instant gameplay
  // begins, right after naming ends -- the identical mechanism the existing
  // "a killing Damage wipes the whole recruited party" test already proves
  // reaches game over on this exact engine, reused here via 'enter' instead
  // of 'touch' so it needs no walk to trigger.
  const rom = await buildVariant(t, 'hero-naming-restart', (project) => {
    project.party[0].renamable = true;
    project.project.titleMap = null; // titleless: a game over restarts straight into a new game
    project.maps[0].encounters = { rate: 0, actorIds: [] }; // a wandering monster must not race this
    const screen = project.maps[project.project.startMap].screens[project.project.startScreen];
    screen.entities[0].props.trigger = 'enter';
    screen.entities[0].props.event = {
      pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'damage', value: 255 }] }]
    };
  });
  const nes = boot(rom);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'titleless cold boot should reach naming directly');
  const seededDefault = nameBytes(nes, 0);
  typeNameAndFinish(nes, 'Zed');
  assert.deepEqual(
    nameBytes(nes, 0).slice(0, 3),
    textToTiles('Zed').tiles,
    'the typed name should have landed the instant naming ends -- before checking for the game over below, since ' +
      'the entry event\'s own killing Damage command can reach ST_GAMEOVER within the same handful of frames ' +
      'gameplay begins in'
  );

  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] !== ST_GAMEOVER; i++) nes.frame();
  assert.equal(
    nes.cpu.mem[GAME_STATE],
    ST_GAMEOVER,
    'the entry event\'s own killing Damage command never reached game over -- no early return: this must be a ' +
      'real failure, not a silently skipped assertion'
  );
  const BOX_ENDWAIT_LOCAL = 6;
  for (let i = 0; i < 200 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT_LOCAL; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT_LOCAL, 'the game-over message never reached BOX_ENDWAIT');
  tap(nes, START, 20); // restart_game's own hardwired Start
  assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'restart_game should reopen hero naming, titleless');
  waitForNamingReady(nes);
  assert.deepEqual(
    nameBytes(nes, 0),
    seededDefault,
    'the fresh session\'s own seeded preview must be the compiled default, not the previous session\'s typed name'
  );
});

test('a named Join opens the naming grid entirely inside ST_DIALOG (never ST_NAMEENTRY), recruits before naming, and resumes the script after', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'join-naming', (project) => {
    project.party[1].renamable = true; // Iris, the recruiter's own target
    project.maps[0].encounters = { rate: 0, actorIds: [] }; // wandering monsters off
  });
  // Rian ships renamable too (phase 5) -- bootPastNaming clears his own hero
  // session first, so what is under test here is Iris's Join naming alone.
  const nes = bootPastNaming(rom);
  assert.equal(nes.cpu.mem[PC_IN_PARTY + 1], 0, 'Iris should not start in the party');

  walkTo(nes, 208, 48);
  const finishedWithoutNaming = talkThrough(nes);
  assert.equal(finishedWithoutNaming, false, 'talkThrough should stop at the naming grid, not finish the conversation');
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_NAMEENTRY);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_DIALOG, 'a named Join\'s own session must run inside ST_DIALOG, never ST_NAMEENTRY');
  assert.equal(nes.cpu.mem[PC_IN_PARTY + 1], 1, 'BE_JOIN should already have run before BE_NAME_BEGIN');

  typeNameAndFinish(nes, 'Kip');
  assert.ok(talkThrough(nes, 10) || nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY, 'the conversation never resumed after naming');
  assert.deepEqual(
    nameBytes(nes, 1).slice(0, 3),
    textToTiles('Kip').tiles,
    'the recruit\'s own typed name should land at pc_name_ram slot 1'
  );
  assert.ok(nes.cpu.mem[SWITCHES] & 1, 'the page\'s own trailing setSwitch command should still have run, after naming');
});

// Join-guard brief (handoff-next/join-guard-brief.md): battle_entry_join
// (engine/battle.asm) had no bound check of its own on a Join command's own
// operand -- unlike party_init_slot, which already guards its own identical
// access to the same per-level tables. validateProject refuses a live join
// like this at authoring time (project.test.js), so this proves the engine's
// own runtime guard holds too, for a hand-edited or later-version ROM that
// bypassed validation. The compiled operand is patched directly in the built
// ROM, located by finding the exact bytes compileText produces for this
// project rather than a hand-picked file offset -- a change to the
// compiler's own layout would move the byte and this test would notice, not
// silently patch the wrong one.
test('battle_entry_join refuses a Join operand at or above PARTY_SIZE, whether the sentinel or a stale numeric index', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-join-guard-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // Wandering monsters off, so the walk to Iris cannot be interrupted -- the
  // same fixture shape the Join test above uses.
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  // Locate the Iris recruit entity by content (a live 'join' command
  // somewhere in its event), not by actor id or map position -- sample-rpg's
  // own layout is not this test's concern.
  let joinEntity = null;
  for (const map of project.maps) {
    for (const screen of map.screens) {
      for (const entity of screen.entities ?? []) {
        const pages = entity.props?.event?.pages ?? [];
        if (pages.some((page) => (page.commands ?? []).some((c) => c.op === 'join'))) joinEntity = entity;
      }
    }
  }
  assert.ok(joinEntity, 'sample-rpg should carry exactly one placement with a live Join command');

  // compileText on the identical project object the ROM was built from: the
  // compiler is deterministic, so this reproduces the exact bytes embedded
  // in the ROM, the same discipline test/lib/eventdecoder.js already applies
  // elsewhere in this codebase.
  const compiled = compileText(project);
  const bytes = compiled.events[compiled.eventFor.get(joinEntity)];
  assert.ok(bytes, 'compileText should have compiled a slot for the Join entity’s event');

  const OP_JOIN = opIndex('join');
  // Walks the page/command framing exactly as decodeBody (test/lib/
  // eventdecoder.js) does, tracking absolute offsets as it goes -- decodeBody
  // itself only hands back decoded command objects, not the byte offset each
  // one started at, so this reconstructs that from each command's own
  // reported size. Only finds a top-level Join, not one nested inside a
  // branch or a choice option -- sample-rpg's own Join is top-level (a plain
  // Say/Join/SetSwitch sequence), so this is sufficient for this fixture; a
  // mismatch here surfaces as opAt === -1, not a silent wrong offset.
  const opAt = (() => {
    let cursor = 0;
    while (bytes[cursor] !== EVT_PAGES_END) {
      const bodyLen = bytes[cursor + 3];
      const commands = decodeBody(bytes, cursor + 4, bodyLen - 1, { strings: [], flat: [] });
      let at = cursor + 4;
      for (const cmd of commands) {
        if (bytes[at] === OP_JOIN) return at + 1; // the operand, one byte past the opcode
        at += cmd.size;
      }
      cursor += 4 + bodyLen;
    }
    return -1;
  })();
  assert.notEqual(opAt, -1, 'the Join command must be a live, top-level, decodable command in its own event');
  // Member 1 (Iris), with the high bit set -- Iris ships renamable (phase 5),
  // so textcompile.js's own 'join' case ORs in 0x80 (main/build/
  // textcompile.js: `named ? (memberByte | 0x80) : memberByte`).
  assert.equal(
    bytes[opAt],
    0x81,
    'sample-rpg’s Iris Join should still name member 1, with naming on -- if this moved, re-derive the fixture'
  );

  // Confirm the located event's bytes appear in the built ROM exactly once,
  // so patching operandOffset below cannot silently hit a different copy.
  const romBytes = fs.readFileSync(built.romPath);
  const needle = Buffer.from(bytes);
  const first = romBytes.indexOf(needle);
  assert.ok(first !== -1, 'the compiled event bytes must appear in the built ROM verbatim');
  assert.equal(
    romBytes.indexOf(needle, first + 1),
    -1,
    'the compiled event bytes must appear exactly once in the ROM, or the patch below could hit the wrong copy'
  );
  const operandOffset = first + opAt;
  assert.equal(romBytes[operandOffset], 0x81, 'byte at the located offset must be the Join operand itself');

  // round 2 finding 1: patching only NO_MEMBER ($FF) proves a guard shaped
  // like `cpx #NO_MEMBER / beq skip` too -- that compare happens to refuse
  // the sentinel while doing nothing for a plain stale numeric index, which
  // is not what battle_entry_join actually does (`cpx #PARTY_SIZE / bcs`,
  // engine/battle.asm). sample-rpg's own party has two members, so
  // PARTY_SIZE is 2 and the operand value 2 is the exact boundary a
  // sentinel-only compare would let through: 2 !== NO_MEMBER, so `beq`
  // never fires, and party_join would recruit a member that does not exist.
  // Patching both values into two separately built ROMs and asserting the
  // identical refusal on each is what tells the real guard and the
  // sentinel-only one apart.
  const buildPatched = (value, suffix) => {
    const patched = Buffer.from(romBytes);
    patched[operandOffset] = value;
    const patchedPath = path.join(dir, 'build', 'join-guard-' + suffix + '.nes');
    fs.writeFileSync(patchedPath, patched);
    return patchedPath;
  };

  // Round 3 review, finding 5: party_size/pc_in_party alone only prove
  // battle_entry_join declined to recruit anyone -- they say nothing about
  // *how* it got back to the field. A wrong `bcs battle_entry_restore`
  // (engine/battle.asm) in place of `bcs battle_entry_join_skip` would run
  // party_restore instead of skipping straight to rts, and party_restore
  // still ends in an rts back to call_battle (the same chain the checked-in
  // skip uses), so party_size/pc_in_party would come out identical either
  // way on this freshly booted fixture -- nothing recruited, nothing
  // in-party changes. What differs is party_restore's own side effect: it
  // unconditionally recomputes pc_hp_max/pc_mp_max/pc_spells for every
  // PARTY_SIZE slot from that slot's current pc_level, live or not. Seeding
  // slot 0's pc_hp_max to a value the level tables would never produce
  // before triggering the refused Join, then asserting it is still that
  // same artificial value afterward, is what tells "skipped outright" and
  // "ran party_restore, which happened to recompute the identical number"
  // apart.
  const assertJoinRefused = (patchedPath, label) => {
    // Rian ships renamable (phase 5); unrelated to the Join operand guard
    // this test is actually about.
    const nes = bootPastNaming(patchedPath);
    assert.equal(nes.cpu.mem[PARTY_SIZE], 1, label + ': only the starting member should have started');

    const realHpMax = nes.cpu.mem[PC_HP_MAX];
    const seededHpMax = (realHpMax + 111) & 0xff; // guaranteed different from whatever the tables actually produced
    nes.cpu.mem[PC_HP_MAX] = seededHpMax;

    walkTo(nes, 208, 48);
    assert.ok(talkThrough(nes), label + ': the conversation never ended');

    assert.equal(
      nes.cpu.mem[PARTY_SIZE],
      1,
      label + ': a stale Join operand must not recruit anyone -- battle_entry_join’s own cpx #PARTY_SIZE guard should refuse it'
    );
    for (let slot = 0; slot < MAX_PARTY; slot++) {
      assert.equal(
        nes.cpu.mem[PC_IN_PARTY + slot],
        slot === 0 ? 1 : 0,
        label + ': pc_in_party slot ' + slot + ' must be untouched by the refused Join'
      );
    }
    assert.equal(
      nes.cpu.mem[PC_HP_MAX],
      seededHpMax,
      label + ': the refused Join must not have run party_restore -- the seeded pc_hp_max should be untouched, ' +
        'not recomputed back to the level tables’ own value'
    );
  };

  assertJoinRefused(buildPatched(NO_MEMBER, 'sentinel'), 'NO_MEMBER ($FF)');
  assertJoinRefused(buildPatched(2, 'boundary'), 'a stale numeric member (2, exactly PARTY_SIZE)');
});

// --- the Say token (docs/design-name-entry.md §9a, phase 4) -----------------

const BOX_TEXT_ROW = 25; // engine/constants.asm -- the field box's text starts here, column 2
const BOX_TEXT_COL = 2;

/** Talk (B), run frames until the box has finished typing its current page
 *  (or is waiting to be dismissed at the end of the message), then settle a
 *  few more frames for the last queued glyph to actually drain into the
 *  nametable -- the same "the last thing queued drains on the next vblank"
 *  margin test/unit/script.test.js's own box tests already take. Leaves the
 *  conversation open (does not press through to the end); a caller reading
 *  the nametable does not need it closed. */
function openSayAndSettle(nes, budget = 200) {
  tap(nes, B);
  for (let frame = 0; frame < budget; frame++) {
    const box = nes.cpu.mem[BOX_STATE];
    if (box === BOX_PAGEWAIT || box === BOX_ENDWAIT) break;
    nes.frame();
  }
  for (let i = 0; i < 4; i++) nes.frame();
}

// P1-B (round-1 finding): must actually type a name DIFFERENT from the
// seeded default and assert those glyphs -- an engine that always showed the
// default (e.g. a token reader that never re-reads pc_name_ram after typing,
// or a naming session that never actually committed the typed letters) would
// pass a test that only ever checks the default. The naming-off default case
// is P1-2, immediately below, and is left exactly as it was.
test('the Say token renders the TYPED name in the nametable, not the default -- hero naming on, read via the nametable itself (docs/design-name-entry.md §15)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'name-token-basic', (project) => {
    project.party[0].renamable = true;
    project.maps[0].screens[0].entities.push(teller([{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hi {name}.' }] }]));
  });
  const nes = boot(rom);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should open at the start of a new game');
  typeNameAndFinish(nes, 'Zed');
  for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
  assert.notEqual(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'naming should have handed off');
  openSayAndSettle(nes);
  assert.deepEqual(
    nametableRow(nes, BOX_TEXT_ROW, BOX_TEXT_COL, 'Hi Zed.'.length),
    textToTiles('Hi Zed.').tiles,
    'the token should expand to the just-typed name ("Zed"), not the compiled default ("Rian")'
  );
});

test('P1-2 (round-1 finding): an RPG with the token authored and naming switched OFF reads party[0].name byte-exact from the nametable -- not merely "some name"', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'name-token-naming-off', (project) => {
    // Naming off explicitly -- this test's own premise (the title says so)
    // is the OFF control beside the "hero naming on" test just above it;
    // sample-rpg itself now ships both renamable (phase 5), so this has to
    // say so rather than merely not touching the flag.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.maps[0].screens[0].entities.push(
      teller([{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Welcome, {name}!' }] }])
    );
  });
  const nes = boot(rom); // plain boot(), never bootPastNaming -- there is no naming session to clear
  assert.notEqual(nes.cpu.mem[GAME_STATE], undefined);
  openSayAndSettle(nes);
  assert.deepEqual(
    nametableRow(nes, BOX_TEXT_ROW, BOX_TEXT_COL, 'Welcome, Rian!'.length),
    textToTiles('Welcome, Rian!').tiles,
    'party_init’s own unconditional pc_name seed (docs/design-name-entry.md §8) should have seeded pc_name_ram ' +
      'slot 0 with the compiled name at boot, with no naming session ever opening'
  );
});

// P1-A (round-1 finding): the token's OTHER compile path -- plain dialogue,
// no authored event at all -- end to end, RPG placement. kernelbytes.
// test.js's own predicate test already proves projectUsesNameToken reads
// effectiveDialogue; this is the real build + nametable half.
test('P1-A (round-1 finding): the token in PLAIN DIALOGUE (no authored event) renders the real name after talking to the entity', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'name-token-dialogue', (project) => {
    project.maps[0].screens[0].entities.push({ actorId: 2, x: 112, y: 96, props: { dialogue: 'Hi {name}.', event: null } });
  });
  const nes = bootPastNaming(rom); // Rian ships renamable (phase 5); unrelated to this test's own token check
  openSayAndSettle(nes);
  assert.deepEqual(
    nametableRow(nes, BOX_TEXT_ROW, BOX_TEXT_COL, 'Hi Rian.'.length),
    textToTiles('Hi Rian.').tiles,
    'plain dialogue carrying the token should expand it the same as a scripted Say'
  );
});

// P1-1 (round-1 finding): a Say carrying the token TWICE, proving both
// instances draw correctly -- not just the first. draw_entities' own
// ptr_lo/ptr_hi write (engine/entities.asm) runs every frame regardless of
// whether a token is on screen, which is exactly why text_type_name reloads
// ptr_lo/ptr_hi unconditionally rather than only on a token's own first
// frame (P1-1's fix). The text between the two occurrences ("meet") forces
// several ordinary glyph frames, each running draw_entities in between, so
// the SECOND token's own first frame is reached only after draw_entities has
// already written ptr_lo/ptr_hi for whatever else is on screen -- sample-rpg's
// own map0/screen0 carries three other placed actors (idle, but
// entity_animation runs its own lookup for every active entity regardless of
// whether its frame index actually changes) alongside the teller itself, so
// this is real intervening engine work, not a contrived gap.
test('P1-1 (round-1 finding): a Say with the token TWICE draws the SECOND token correctly too, not whatever draw_entities left in ptr_lo/ptr_hi between the two', {
  skip: needsSample
}, async (t) => {
  // "{name} meet {name}." is 19 literal characters, reserved at 27 visual
  // columns (19 + 2*4) -- under BOX_COLS (28), so wrapText keeps both
  // occurrences on the SAME line rather than wrapping the second onto the
  // box's next row, which would let a bug that only breaks the second token
  // hide behind a coincidental row mismatch instead of a wrong glyph.
  const rom = await buildVariant(t, 'name-token-twice', (project) => {
    project.maps[0].screens[0].entities.push(
      teller([{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: '{name} meet {name}.' }] }])
    );
  });
  const nes = bootPastNaming(rom); // Rian ships renamable (phase 5); unrelated to this test's own token check
  openSayAndSettle(nes, 400);
  assert.deepEqual(
    nametableRow(nes, BOX_TEXT_ROW, BOX_TEXT_COL, 'Rian meet Rian.'.length),
    textToTiles('Rian meet Rian.').tiles,
    'both the first AND the second token instance must read the real name -- a shared-scratch clobber between ' +
      'them would corrupt only the second onward, not the first'
  );
});

test('a two-monster formation is targeted one at a time, and the cursor wraps', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'twomon', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);

  // battle_begin runs mid-frame and the intro tick runs on the next one, so
  // there is exactly one frame in which the formation can still be edited —
  // which is what lets this test stage a second slime.
  assert.equal(nes.cpu.mem[BT_PHASE], BP_INTRO, 'the intro already ran');
  nes.cpu.mem[MON_SLOT_ACTOR + 1] = 0;
  for (let i = 0; i < 12; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_COUNT], 2, 'the second monster was not seated');
  assert.equal(nes.cpu.mem[MON_ALIVE + 1], 1);

  waitForMenu(nes);
  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET);
  assert.equal(nes.cpu.mem[BT_TARGET], 4, 'targeting should start on the first monster');
  tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[BT_TARGET], 5, 'the cursor never moved to the second monster');
  tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[BT_TARGET], 4, 'the cursor should wrap over the two empty slots');

  tap(nes, A, 20);
  const state = pressThrough(nes, 120);
  assert.equal(state, ST_GAMEPLAY, 'the two-slime fight never ended');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);
  assert.equal(nes.cpu.mem[MON_ALIVE + 1], 0, 'the second monster survived being beaten');
  assert.ok(nes.cpu.mem[PC_XP_LO] >= 12, 'two slimes should pay both their experience');
});

// --- magic, items and drops -------------------------------------------------

test('a heal spell restores HP, cures poison, and costs its MP', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);

  // Mend is authored at level 3, so it is granted here the way a level would
  // grant it: pc_spells is the RAM the engine actually consults.
  nes.cpu.mem[PC_SPELLS] |= 2;
  nes.cpu.mem[PC_HP] = 5;
  nes.cpu.mem[PC_MP] = 20;
  nes.cpu.mem[PC_STATUS] = 1; // poisoned, so the cure is observable

  chooseCommand(nes, BC_MAGIC);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_SPELLS);
  tap(nes, DOWN, 4); // Ember is first; Mend is the second row
  tap(nes, A, 6);    // choose it
  tap(nes, A, 10);   // and confirm the target

  const expected = Math.min(5 + 18, nes.cpu.mem[PC_HP_MAX]);
  assert.equal(nes.cpu.mem[PC_HP], expected, 'Mend should heal eighteen, capped at the maximum');
  assert.equal(nes.cpu.mem[PC_MP], 16, 'Mend costs four');
  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'a heal should cure poison');
});

// --- magic power and magic defence (docs/design-magic-power.md, phase 1) ---
//
// combatant_mag/combatant_mdef and spell_damage's/cast_heal's own call-site
// additions (engine/battleturn.asm). Every test below names the wrong
// implementation it rules out in its own comment, the design's own test-plan
// numbering (§14) kept in each title for cross-reference.

test('test 4: a party caster\'s Ember (fire, flat 10) against the fire-weak Slime deals exactly 90 with baseMag = 50 -- the add applied before the elemental modifier (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'magorder', (project) => {
    project.party[0].baseMag = 50;
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 200; // headroom so the hit does not saturate at death
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6); // Ember, sample-rpg's own flat amountMin === amountMax === 10
  tap(nes, A, 20); // confirm the target

  // (10 + 50) * 1.5 = 90 -- the add applied before the weak multiply. An
  // add-after-weakness wrong implementation would instead compute
  // 15 + 50 = 65; no add at all deals 15 (the existing flat-range test's own
  // unmodified number).
  assert.equal(startHp - nes.cpu.mem[MON_HP], 90, 'baseMag should add before the elemental modifier, not after or not at all');
});

test('test 5: a monster caster\'s spell is scaled by its own mag, read through the slot-to-actor-id indirection, not the raw slot number (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'monmag', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, spellIds: [0], mag: 40 };
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, mag: 200 };
    project.party[0].baseHp = 200;
  });
  const nes = bootPastNaming(rom);
  // The snake waits in the bottom-left corner -- the same spot the existing
  // monster-spell test uses.
  walkTo(nes, 32, 112);
  walkTo(nes, 32, 208, 300);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the snake did not start a fight');

  // Watch mon_slot_mp rather than PC_HP for any drop: physical_damage floors
  // a hopeless atk-def at 1 and adds 0-3 RNG noise, so a scratch from an
  // earlier, uncast round could otherwise be mistaken for the spell's own
  // hit. An MP drop, and only an MP drop, means this round's action was the
  // cast (monster_turn spends MP in the same instruction stream that falls
  // straight into cast_spell, before any physical-attack path can run
  // instead).
  let dealt = null;
  for (let round = 0; round < 60 && dealt === null; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    const mpBefore = nes.cpu.mem[MON_SLOT_MP];
    const hpBefore = nes.cpu.mem[PC_HP];
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    if (nes.cpu.mem[MON_SLOT_MP] < mpBefore) dealt = hpBefore - nes.cpu.mem[PC_HP];
  }
  assert.ok(dealt !== null, 'sixty rounds and the snake never cast Ember');
  // (10 + 40) = 50, no elemental modifier against a party target ("elements
  // only describe monsters"). Reading mon_mag by raw slot index (0, the
  // Snake's own formation slot) instead of its resolved actor id (3) would
  // instead read the unrelated Slime's own mag (200): (10 + 200) = 210.
  assert.equal(
    dealt,
    50,
    'the cast should scale with mon_mag[3] (the Snake\'s own actor id), not mon_mag[0] (a different actor read by raw slot number)'
  );
});

test('test 6a: a heal spell\'s amount scales with baseMag, added before the existing clamp-to-max -- uncapped (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'healmaguncapped', (project) => {
    project.party[0].baseHp = 100; // headroom above 5 + 18 + 50 = 73
    project.party[0].baseMag = 50;
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 2;
  nes.cpu.mem[PC_HP] = 5;
  nes.cpu.mem[PC_MP] = 20;
  assert.ok(nes.cpu.mem[PC_HP_MAX] > 73, 'the fixture\'s own max must clear 5+18+50 for this condition to be observable');

  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4); // Ember is first; Mend is the second row
  tap(nes, A, 6);
  tap(nes, A, 10);

  // Rules out: the add being skipped entirely (a wrong implementation would
  // show 23, the existing heal test's own unmodified number).
  assert.equal(nes.cpu.mem[PC_HP], 73, '5 + 18 + 50 = 73 -- the add must land, not be skipped');
});

test('test 6b: a heal spell\'s amount scales with baseMag, added before the existing clamp-to-max -- capped, against the combined total (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'healmagcapped', (project) => {
    project.party[0].baseMag = 50;
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 2;
  const max = nes.cpu.mem[PC_HP_MAX];
  nes.cpu.mem[PC_HP] = max - 10; // exactly 10 HP of headroom, read at runtime
  nes.cpu.mem[PC_MP] = 20;

  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4);
  tap(nes, A, 6);
  tap(nes, A, 10);

  // Rules out two distinct wrong implementations: one that drops the clamp
  // for the combined total (wraps or exceeds max outright), and one that
  // clamps roll alone against max and then bolts mag on afterward with no
  // clamp of its own (leaves a value that can read either above max or, if
  // it wraps past 255, wrapped to something below it).
  assert.equal(
    nes.cpu.mem[PC_HP],
    max,
    'roll+mag together should clamp to the max as one combined total, not roll alone with mag bolted on unclamped afterward'
  );
});

test('test 7: poison and burn are unaffected by a caster\'s baseMag (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'magpoison', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0 }; // never hits back
    project.party[0].baseMag = 200;
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 4; // Venom is authored at level 2; grant it directly
  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4);
  tap(nes, A, 6);
  tap(nes, A, 10);
  assert.equal(nes.cpu.mem[MON_STATUS], STATUS_POISON, 'the slime should be poisoned');

  const startHp = nes.cpu.mem[MON_HP];
  let ticked = false;
  for (let round = 0; round < 30 && !ticked; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    ticked = nes.cpu.mem[MON_HP] !== startHp;
  }
  assert.ok(ticked, 'thirty rounds and poison never bit');
  assert.equal(
    startHp - nes.cpu.mem[MON_HP],
    POISON_DMG,
    'a poison tick should cost exactly POISON_DMG, unaffected by the caster\'s own baseMag'
  );
});

// Fix round 1, P1-2: the poison case above never exercises burn -- the
// existing burn test (roughly :3804) has both stats off, so nothing
// confirmed BURN_DMG survives a live baseMag the way POISON_DMG's own
// assertion just did. Modeled directly on that existing test's own sequence
// (project.spells[2].kind = 'burn' repurposes Venom into this build's Burn
// spell, same menu row, same taps), with the caster's baseMag added.
test('test 7 (burn sibling): burn is unaffected by a caster\'s baseMag (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'magburn', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[2].kind = 'burn'; // Venom becomes this build's Burn spell
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0 }; // never hits back
    project.party[0].baseMag = 200;
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 4; // Venom/Burn is authored at level 2; grant it directly
  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4); // past Ember to Venom/Burn
  tap(nes, A, 6);
  tap(nes, A, 10);   // aim it at the slime
  assert.equal(nes.cpu.mem[MON_STATUS], STATUS_BURN, 'the slime should be burned, not poisoned');

  const startHp = nes.cpu.mem[MON_HP];
  let ticked = false;
  for (let round = 0; round < 30 && !ticked; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    ticked = nes.cpu.mem[MON_HP] !== startHp;
  }
  assert.ok(ticked, 'thirty rounds and burn never bit');
  assert.equal(
    startHp - nes.cpu.mem[MON_HP],
    BURN_DMG,
    'a burn tick should cost exactly BURN_DMG, unaffected by the caster\'s own baseMag'
  );
});

test('test 8: a flat-range spell still consumes no RNG with magic power live (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'flatmag', (project) => {
    project.party[0].baseMag = 50;
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 255;
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  nes.cpu.mem[RNG] = 0x99; // the flat branch must never read this
  tap(nes, A, 20);

  assert.equal(startHp - nes.cpu.mem[MON_HP], 90, 'a flat-range spell should still deal exactly its deterministic number with mag live');
  assert.equal(nes.cpu.mem[RNG], 0x99, 'combatant_mag must never call rng_next, even when the spell itself is flat');
});

test('test 9: cast_all\'s RNG state and bt_tmp2 sentinel survive magic power the same way they survive the existing roll (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'multitarget-mag', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].scope = 'all';
    project.spells[0].amountMin = 1;
    project.spells[0].amountMax = 100;
    project.spells[0].element = 'none';
    project.sprites.actors[0].hp = 150;
    project.party[0].baseMag = 20;
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  nes.cpu.mem[MON_SLOT_ACTOR + 1] = 0; // a second slime in the formation
  for (let i = 0; i < 12; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_COUNT], 2);
  waitForMenu(nes);
  const startHp0 = nes.cpu.mem[MON_HP];
  const startHp1 = nes.cpu.mem[MON_HP + 1];

  chooseCommand(nes, BC_MAGIC);
  // Identical seed/trace as the existing multitarget test: rolls of 59 then
  // 18, RNG ending at 0x76.
  nes.cpu.mem[RNG] = 0x00;
  tap(nes, A, 12);

  const dealt0 = startHp0 - nes.cpu.mem[MON_HP];
  const dealt1 = startHp1 - nes.cpu.mem[MON_HP + 1];
  assert.equal(dealt0, 79, 'the first target should take its own roll (59) plus the caster\'s own baseMag (20)');
  assert.equal(dealt1, 38, 'the second target should take its own, different roll (18) plus the identical baseMag (20)');
  assert.equal(
    nes.cpu.mem[RNG],
    0x76,
    'exactly two rng_next calls should have run -- combatant_mag must never touch bt_tmp2 or the RNG'
  );
});

test('test 12: a caster at level > 1 deals roll + statAt(baseMag, magPerLevel, level), not just roll + baseMag (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'maggrowth', (project) => {
    project.party[0].baseMag = 10;
    project.party[0].magPerLevel = 5;
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_LEVEL] = 3;
  nes.cpu.mem[MON_HP] = 200;
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  tap(nes, A, 20);

  // statAt(10, 5, 3) = 10 + 5*(3-1) = 20; (10 + 20) * 1.5 = 45. A wrong
  // implementation that ignores magPerLevel would instead deal (10+10)*1.5=30.
  assert.equal(startHp - nes.cpu.mem[MON_HP], 45, 'the caster\'s own level growth should apply, not just baseMag');
});

test('test 13: roll + mag saturates at 255 rather than wrapping (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'magsaturate', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].amountMin = 200;
    project.spells[0].amountMax = 200;
    project.spells[0].element = 'none'; // isolate from spell_damage_weak's own separate saturation
    project.party[0].baseMag = 255;
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 255; // the real byte ceiling

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  tap(nes, A, 20);

  // 200 + 255 = 455, saturates at 255: the target is exactly killed. A
  // wrapping implementation would land on 455 mod 256 = 199, leaving 56 HP.
  assert.equal(nes.cpu.mem[MON_HP], 0, 'roll + mag should saturate at 255, not wrap to 199 and leave 56 HP');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);
});

test('test 20: mdef subtracts before the elemental modifier, not after (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'mdeforder', (project) => {
    project.party[0].baseMag = 50;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, mdef: 20 };
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 200;
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  tap(nes, A, 20);

  // Correct (subtract before the modifier, floored): (10 + 50 - 20) * 1.5 = 60.
  // Subtract-after wrong implementation: (10+50)*1.5 - 20 = 70. No-subtract
  // wrong implementation: 90 (test 4's own number).
  assert.equal(startHp - nes.cpu.mem[MON_HP], 60, 'mdef should subtract before the elemental modifier, floored, not after or not at all');
});

test('test 21a: mdef floors at 1, never 0 -- exact-zero subtraction (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'mdeffloorexact', (project) => {
    project.spells[0].element = 'none'; // isolate from the weak/strong step
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, mdef: 10 };
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 200;
  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  tap(nes, A, 20);
  // roll (10) - mdef (10) = exactly 0 -- floors to 1, not 0.
  assert.equal(startHp - nes.cpu.mem[MON_HP], 1, 'an exact roll == mdef hit should floor at 1, not deal 0');
});

test('test 21b: mdef floors at 1, never 0 -- underflow (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'mdeffloorunderflow', (project) => {
    project.spells[0].element = 'none';
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, mdef: 255 };
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 200;
  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  tap(nes, A, 20);
  // mdef (255) exceeds the roll (10): underflow, forced to 0, then floored
  // to 1 by the shared bne/floor check -- an implementation that forces 0 on
  // underflow but skips that shared check would also read 0 here, the
  // identical wrong number test 21a rules out, which is why both conditions
  // are needed.
  assert.equal(startHp - nes.cpu.mem[MON_HP], 1, 'mdef exceeding the roll should still floor at 1, not deal 0');
});

test('test 22: an mdef-only build subtracts against the bare roll, with no combatant_mag involved at all (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'mdefonly', (project) => {
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, mdef: 4 };
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 200;
  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  tap(nes, A, 20);
  // (10 - 4) * 1.5 = 9 -- mdef alone; this build has no baseMag/battle.mag
  // anywhere, so MAGIC_POWER_ENABLED is off and combatant_mag does not exist.
  assert.equal(startHp - nes.cpu.mem[MON_HP], 9, 'mdef alone should apply with no stray mag contribution');
});

test('test 23: poison and burn are unaffected by a target\'s mdef (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'mdefpoison', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0, mdef: 250 };
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 4; // Venom
  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4);
  tap(nes, A, 6);
  tap(nes, A, 10);
  assert.equal(nes.cpu.mem[MON_STATUS], STATUS_POISON, 'the slime should be poisoned regardless of its own mdef');

  const startHp = nes.cpu.mem[MON_HP];
  let ticked = false;
  for (let round = 0; round < 30 && !ticked; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    ticked = nes.cpu.mem[MON_HP] !== startHp;
  }
  assert.ok(ticked, 'thirty rounds and poison never bit');
  assert.equal(
    startHp - nes.cpu.mem[MON_HP],
    POISON_DMG,
    'a poison tick should cost exactly POISON_DMG, unaffected by the target\'s own mdef'
  );
});

// Fix round 1, P1-2: the poison case above never exercises burn -- see the
// identical note on test 7's own burn sibling just above. Modeled on the
// existing burn test's own sequence, with the target's own mdef added.
test('test 23 (burn sibling): burn is unaffected by a target\'s mdef (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'mdefburn', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[2].kind = 'burn'; // Venom becomes this build's Burn spell
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0, mdef: 250 };
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 4; // Venom/Burn
  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4);
  tap(nes, A, 6);
  tap(nes, A, 10);
  assert.equal(nes.cpu.mem[MON_STATUS], STATUS_BURN, 'the slime should be burned, not poisoned, regardless of its own mdef');

  const startHp = nes.cpu.mem[MON_HP];
  let ticked = false;
  for (let round = 0; round < 30 && !ticked; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    ticked = nes.cpu.mem[MON_HP] !== startHp;
  }
  assert.ok(ticked, 'thirty rounds and burn never bit');
  assert.equal(
    startHp - nes.cpu.mem[MON_HP],
    BURN_DMG,
    'a burn tick should cost exactly BURN_DMG, unaffected by the target\'s own mdef'
  );
});

// Fix round 1, P1-3: the prior version of this test set
// `MON_SLOT_ACTOR + 1 = 0`, making BOTH formation slots actor 0 -- so both
// targets shared the identical mdef (10), and an implementation that read
// the first target's mdef once and wrongly reused it for every target still
// produced the same 49/8 numbers this test asserted, passing a defect it
// was supposed to catch. Fixed by giving the two slots different actor ids
// (0 and 3) with different mdef (10 and 5), so a per-target read and a
// reused-first-target read diverge on the second number. Recomputed from
// this test's own seed trace, not assumed: the roll sequence is identical to
// the pre-existing multitarget test's own (59 then 18, seed 0x00, RNG ending
// at 0x76), since the rolls depend only on the spell's own amount table, not
// on which actor is being hit. Correct: dealt0 = 59 - 10 = 49,
// dealt1 = 18 - 5 = 13. A reused-first-target-defence implementation would
// instead compute dealt1 = 18 - 10 = 8, the wrong number the prior version
// of this test could never distinguish from the correct one.
test('test 24: an all-target spell subtracts mdef per target independently -- bt_tmp2 and the RNG survive it the same way they survive magic power (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'multitarget-mdef', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].scope = 'all';
    project.spells[0].amountMin = 1;
    project.spells[0].amountMax = 100;
    project.spells[0].element = 'none';
    project.sprites.actors[0].hp = 150;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, mdef: 10 };
    project.sprites.actors[3].hp = 150;
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, mdef: 5 };
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  nes.cpu.mem[MON_SLOT_ACTOR + 1] = 3; // a different actor (Snake, mdef 5), not another copy of the Slime
  for (let i = 0; i < 12; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_COUNT], 2);
  waitForMenu(nes);
  const startHp0 = nes.cpu.mem[MON_HP];
  const startHp1 = nes.cpu.mem[MON_HP + 1];

  chooseCommand(nes, BC_MAGIC);
  nes.cpu.mem[RNG] = 0x00;
  tap(nes, A, 12);

  const dealt0 = startHp0 - nes.cpu.mem[MON_HP];
  const dealt1 = startHp1 - nes.cpu.mem[MON_HP + 1];
  assert.equal(dealt0, 49, 'the first target should take its own roll (59) minus its own mdef (10)');
  assert.equal(
    dealt1,
    13,
    'the second target should take its own, different roll (18) minus its OWN mdef (5), not the first target\'s (10, which would show 8)'
  );
  assert.equal(
    nes.cpu.mem[RNG],
    0x76,
    'exactly two rng_next calls should have run -- mdef\'s own subtraction touches no RNG and must not disturb bt_tmp2 either'
  );
});

test('test 25: a target at level > 1 is defended by statAt(baseMdef, mdefPerLevel, level), not just baseMdef (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'mdefgrowth', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].amountMin = 30;
    project.spells[0].amountMax = 30;
    project.spells[0].element = 'none';
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, spellIds: [0], mag: 0 };
    project.party[0].baseMdef = 4;
    project.party[0].mdefPerLevel = 3;
    project.party[0].baseHp = 200; // headroom across up to sixty rounds of physical scratches
  });
  const nes = bootPastNaming(rom);
  nes.cpu.mem[PC_LEVEL] = 3;
  walkTo(nes, 32, 112);
  walkTo(nes, 32, 208, 300);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the snake did not start a fight');

  let dealt = null;
  for (let round = 0; round < 60 && dealt === null; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    const mpBefore = nes.cpu.mem[MON_SLOT_MP];
    const hpBefore = nes.cpu.mem[PC_HP];
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    if (nes.cpu.mem[MON_SLOT_MP] < mpBefore) dealt = hpBefore - nes.cpu.mem[PC_HP];
  }
  assert.ok(dealt !== null, 'sixty rounds and the snake never cast its spell');
  // statAt(4, 3, 3) = 4 + 3*(3-1) = 10; 30 - 10 = 20. A wrong implementation
  // that ignores mdefPerLevel would instead read mdef as a flat 4: 30-4=26.
  assert.equal(dealt, 20, 'the target\'s own level growth should defend, not just baseMdef');
});

test('test 28: a heal is unaffected by mdef on the healed member (sample-rpg)', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'mdefheal', (project) => {
    project.party[0].baseMdef = 50;
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 2; // Mend
  nes.cpu.mem[PC_HP] = 5;
  nes.cpu.mem[PC_MP] = 20;

  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4);
  tap(nes, A, 6);
  tap(nes, A, 10);

  // A wrong implementation that mistakenly reused spell_damage's own
  // subtract-and-floor logic for cast_heal too would instead underflow
  // (18 < 50), floor to 1, and heal only 5 + 1 = 6.
  assert.equal(nes.cpu.mem[PC_HP], 23, 'mdef must never be read for a heal -- 5 + 18, unaffected by the caster\'s own baseMdef');
});

// --- spell amount ranges (Magic Forge phase 2, roll_spell_amount/mod8) -----
//
// Every seed below was derived offline by hand-simulating engine/rpg.asm's
// rng_next (asl a; on carry, eor #$71; a zero state substitutes $A5) and
// engine/battleturn.asm's mod8 (an 8-iteration shift/compare/subtract),
// never by importing or re-implementing either inside this file -- the point
// of an emulator-backed fixture is that it exercises the real ROM's actual
// routines, not a JS model of them. "Nothing advances the LFSR in battle but
// the rolls themselves" (see the atkover test above), so seeding it
// immediately before the tap that triggers the one roll under test is
// deterministic. Casts against `element: 'none'` isolate roll_spell_amount's
// own output from spell_damage's separate weak/strong multiply, except where
// a fixture is deliberately testing that interaction (saturation).

test('a flat-range spell (amountMin === amountMax) consumes no RNG at all -- the migrated old flat-amount read, byte-for-byte', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 255; // headroom above the flat spell's own weak-multiplied damage, so the subtraction below reads the real number rather than a saturated-at-death one
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6); // Ember, sample-rpg's own flat amountMin === amountMax === 10
  nes.cpu.mem[RNG] = 0x99; // arbitrary -- the flat branch must never read this
  tap(nes, A, 20); // confirm the target -- where the (skipped) roll would happen

  // Fire into the slime's own fire weakness: 10 * 1.5 = 15 exactly,
  // deterministic -- the identical number the pre-migration flat
  // `spell_amount,x` read always produced.
  assert.equal(startHp - nes.cpu.mem[MON_HP], 15, 'a flat-range spell should still deal exactly its old flat number');
  assert.equal(nes.cpu.mem[RNG], 0x99, 'spell_amount_n === 1 must take the no-roll branch and never call rng_next');

  // Wrong implementation this catches: a roll_spell_amount that always jsr's
  // rng_next once "to be safe" even when n === 1 would still hand back
  // amountMin here (any result mod 1 is 0), so the damage-number assertion
  // alone would not catch it -- only pairing it with the untouched-RNG-byte
  // assertion tells a silent RNG-state shift apart from a merely-correct
  // number, which is the entire byte-for-byte migration guarantee.
});

test('a maximal range (1-255) reaches amountMin on a seed whose first draw is 0', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'maxrange', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].amountMin = 1;
    project.spells[0].amountMax = 255; // n = 255, limit = floor(255/255)*255 = 255
    project.spells[0].element = 'none'; // isolate the roll from the weak/strong multiply
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 255;
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  // seed 0xB8: rng_next(0xB8) = 0x01, draw = 0x01 - 1 = 0 < limit(255), accepted
  // on the first call; mod8(0, 255) = 0; result = amountMin(1) + 0 = 1.
  nes.cpu.mem[RNG] = 0xb8;
  tap(nes, A, 20);

  assert.equal(startHp - nes.cpu.mem[MON_HP], 1, 'the maximal-range roll should reach exactly amountMin here, not stay stuck away from it');
  assert.equal(nes.cpu.mem[RNG], 0x01, 'exactly one rng_next call should have run');

  // Wrong implementation this catches: the pre-round-4 masked-AND construction
  // this design replaced could never produce amountMin at all on this range
  // (High 1 finding) -- any seed handed to it would land somewhere in
  // [amountMin+1, amountMax], so this specific low-end value is exactly what
  // that defect could never pass.
});

test('a non-maximal range reaches both of its own endpoints', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'endpoints', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].amountMin = 10;
    project.spells[0].amountMax = 20; // n = 11, limit = floor(255/11)*11 = 253
    project.spells[0].element = 'none';
  });

  {
    const nes = bootPastNaming(rom);
    walkTo(nes, 160, 176);
    walkTo(nes, 176, 176, 200);
    waitForMenu(nes);
    nes.cpu.mem[MON_HP] = 255;
    const startHp = nes.cpu.mem[MON_HP];
    chooseCommand(nes, BC_MAGIC);
    tap(nes, A, 6);
    // seed 0x06: rng_next(0x06) = 0x0C, draw = 11 < limit(253); mod8(11, 11) = 0;
    // result = amountMin(10) + 0 = 10.
    nes.cpu.mem[RNG] = 0x06;
    tap(nes, A, 20);
    assert.equal(startHp - nes.cpu.mem[MON_HP], 10, 'this seed should reach the range’s own minimum exactly');
  }
  {
    const nes = bootPastNaming(rom);
    walkTo(nes, 160, 176);
    walkTo(nes, 176, 176, 200);
    waitForMenu(nes);
    nes.cpu.mem[MON_HP] = 255;
    const startHp = nes.cpu.mem[MON_HP];
    chooseCommand(nes, BC_MAGIC);
    tap(nes, A, 6);
    // seed 0x0B: rng_next(0x0B) = 0x16, draw = 21 < limit(253); mod8(21, 11) = 10;
    // result = amountMin(10) + 10 = 20.
    nes.cpu.mem[RNG] = 0x0b;
    tap(nes, A, 20);
    assert.equal(startHp - nes.cpu.mem[MON_HP], 20, 'this seed should reach the range’s own maximum exactly');
  }

  // Wrong implementation this catches: an off-by-one in the final
  // `adc spell_amount_min,x` (say, forgetting the add and returning the bare
  // modulo) would report 0 and 10 here instead of 10 and 20 -- close enough
  // to "looks like it's in range" to pass a loose bounds check, which is
  // exactly why every fixture in this section asserts an exact value.
});

test('mod8 divisor boundaries: n=2, n=128 with a real rejection, n=255 returns the draw unchanged, and n=127 at its own limit', {
  skip: needsSample
}, async (t) => {
  {
    const rom = await buildVariant(t, 'n2', (project) => {
      project.maps[0].encounters = { rate: 0, actorIds: [] };
      project.spells[0].amountMin = 5;
      project.spells[0].amountMax = 6; // n = 2, limit = 254
      project.spells[0].element = 'none';
    });
    const nes = bootPastNaming(rom);
    walkTo(nes, 160, 176);
    walkTo(nes, 176, 176, 200);
    waitForMenu(nes);
    nes.cpu.mem[MON_HP] = 255;
    const startHp = nes.cpu.mem[MON_HP];
    chooseCommand(nes, BC_MAGIC);
    tap(nes, A, 6);
    // seed 0x00: state 0 substitutes $A5; rng_next(0xA5) = 0x3B, draw = 0x3A =
    // 58 < limit(254); mod8(58, 2) = 0; result = amountMin(5) + 0 = 5.
    nes.cpu.mem[RNG] = 0x00;
    tap(nes, A, 20);
    assert.equal(startHp - nes.cpu.mem[MON_HP], 5, 'n=2 should still divide correctly at the smallest real divisor');
  }
  {
    const rom = await buildVariant(t, 'n128', (project) => {
      project.maps[0].encounters = { rate: 0, actorIds: [] };
      project.spells[0].amountMin = 1;
      project.spells[0].amountMax = 128; // n = 128, limit = floor(255/128)*128 = 128
      project.spells[0].element = 'none';
    });
    const nes = bootPastNaming(rom);
    walkTo(nes, 160, 176);
    walkTo(nes, 176, 176, 200);
    waitForMenu(nes);
    nes.cpu.mem[MON_HP] = 255;
    const startHp = nes.cpu.mem[MON_HP];
    chooseCommand(nes, BC_MAGIC);
    tap(nes, A, 6);
    // seed 0x41: rng_next(0x41) = 0x82, draw = 0x81 = 129 >= limit(128) --
    // rejected, roll again. rng_next(0x82) = 0x75, draw = 0x74 = 116 <
    // limit(128) -- accepted. mod8(116, 128) = 116 (116 < 128, no subtraction
    // is ever needed); result = amountMin(1) + 116 = 117. Two rng_next calls
    // -- one real rejection -- land the RNG byte on 0x75.
    nes.cpu.mem[RNG] = 0x41;
    tap(nes, A, 20);
    assert.equal(startHp - nes.cpu.mem[MON_HP], 117, 'n=128 (roughly 50% acceptance) should still land exactly after its one rejection');
    assert.equal(nes.cpu.mem[RNG], 0x75, 'exactly two rng_next calls (one rejected, one accepted) should have run');
  }
  {
    const rom = await buildVariant(t, 'n255', (project) => {
      project.maps[0].encounters = { rate: 0, actorIds: [] };
      project.spells[0].amountMin = 1;
      project.spells[0].amountMax = 255; // n = 255, limit = 255 -- mod8 never subtracts
      project.spells[0].element = 'none';
    });
    const nes = bootPastNaming(rom);
    walkTo(nes, 160, 176);
    walkTo(nes, 176, 176, 200);
    waitForMenu(nes);
    nes.cpu.mem[MON_HP] = 255;
    const startHp = nes.cpu.mem[MON_HP];
    chooseCommand(nes, BC_MAGIC);
    tap(nes, A, 6);
    // seed 0xDC: rng_next(0xDC) = 0xC9, draw = 0xC8 = 200 < limit(255);
    // mod8(200, 255) = 200 unchanged (200 < 255, the loop's `cmp`/`bcc` never
    // subtracts on any of its eight iterations); result = amountMin(1) + 200 = 201.
    nes.cpu.mem[RNG] = 0xdc;
    tap(nes, A, 20);
    assert.equal(startHp - nes.cpu.mem[MON_HP], 201, 'n=255 should hand the draw straight through unchanged, plus amountMin');
  }
  {
    const rom = await buildVariant(t, 'n127', (project) => {
      project.maps[0].encounters = { rate: 0, actorIds: [] };
      project.spells[0].amountMin = 1;
      project.spells[0].amountMax = 127; // n = 127, limit = floor(255/127)*127 = 254
      project.spells[0].element = 'none';
    });
    const nes = bootPastNaming(rom);
    walkTo(nes, 160, 176);
    walkTo(nes, 176, 176, 200);
    waitForMenu(nes);
    nes.cpu.mem[MON_HP] = 255;
    const startHp = nes.cpu.mem[MON_HP];
    chooseCommand(nes, BC_MAGIC);
    tap(nes, A, 6);
    // seed 0x7F: rng_next(0x7F) = 0xFE, draw = 0xFD = 253 < limit(254) --
    // accepted right at the edge of the accepted domain; mod8(253, 127) = 126
    // (253 - 127 = 126); result = amountMin(1) + 126 = 127 (== amountMax,
    // its own catalog's ceiling).
    nes.cpu.mem[RNG] = 0x7f;
    tap(nes, A, 20);
    assert.equal(startHp - nes.cpu.mem[MON_HP], 127, 'n=127 at draw=253, one below the rejection edge, should still divide exactly');
  }

  // Wrong implementations these four fixtures catch -- each actually run
  // against a sabotaged engine/battleturn.asm and confirmed to fail before
  // being written down, not merely reasoned about:
  // (1) a mod8 that stops after seven shift/subtract iterations instead of
  // eight under-reduces n=2 -- run: dealt 6 instead of 5.
  // (2) `cmp`/`sbc` against the wrong table inside the loop
  // (spell_amount_min,x instead of spell_amount_n,x) also breaks n=2 -- run:
  // dealt 8 instead of 5.
  // (3) a rejection loop that forgets to re-roll (accepting the first draw
  // regardless of the limit check) does NOT report the raw rejected draw
  // (129) for n=128: 129 still passes through mod8 (129 mod 128 = 1) and
  // amountMin(1) is then added, landing on 2 -- run: dealt 2 instead of 117.
});

test('a range that reaches into a weakness still saturates at $FF, the same as a flat one already does', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'weakrange', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].amountMin = 170;
    project.spells[0].amountMax = 200; // n = 31, limit = floor(255/31)*31 = 248
    // element stays 'fire' -- the slime is weak to it (sample-rpg default).
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 255; // saturated damage is exactly its whole HP, same setup as the flat-amount saturation test above

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);
  // seed 0x00 -> $A5 substitution -> rng_next = 0x3B, draw = 58 < limit(248);
  // mod8(58, 31) = 27; result = amountMin(170) + 27 = 197. Weak-multiplied:
  // 197 >> 1 = 98, 98 + 197 = 295, which wraps past 255 (carry set) --
  // spell_damage_weak saturates to $FF (255) rather than storing the wrapped
  // low byte 39.
  nes.cpu.mem[RNG] = 0x00;
  tap(nes, A, 20);

  assert.equal(nes.cpu.mem[MON_HP], 0, 'a saturated weakness hit from a rolled amount should take all 255, not a wrapped 39');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'and 255 damage into 255 HP is a kill');

  // Wrong implementation this catches: trusting that "saturation is
  // inherited, not re-derived" (design §8.0) without actually driving a
  // rolled -- not authored -- value through spell_damage_weak would miss a
  // regression where the roll's result somehow bypassed bt_dmg_lo and
  // reached the weak multiply through a different, unsaturated path.
});

test('a heal spell rolling near a member’s max HP still clamps to it, the same as a flat one already does', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'healrange', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[1].amountMin = 40;
    project.spells[1].amountMax = 60; // n = 21, limit = floor(255/21)*21 = 252
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 2; // Mend is authored at level 3; grant it directly, as the flat-heal test above does
  nes.cpu.mem[PC_HP] = 250;
  nes.cpu.mem[PC_HP_MAX] = 255;
  nes.cpu.mem[PC_MP] = 20;

  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4); // Ember is first; Mend is the second row
  tap(nes, A, 6);
  // seed 0x00 -> $A5 substitution -> rng_next = 0x3B, draw = 58 < limit(252);
  // mod8(58, 21) = 16 (58 - 21 - 21 = 16); result = amountMin(40) + 16 = 56.
  // 250 + 56 = 306, past both the 255-byte wrap point and PC_HP_MAX(255) --
  // cast_heal's own bcs guard catches the carry before the max-compare runs.
  nes.cpu.mem[RNG] = 0x00;
  tap(nes, A, 10);

  assert.equal(nes.cpu.mem[PC_HP], 255, 'a rolled heal that would overshoot the max should clamp to it, not wrap');

  // Wrong implementation this catches: relying on cast_heal's own
  // bcs-before-cmp guard being new, untested code for a rolled value -- it
  // is not (design §8.0), but the guard was previously only ever exercised
  // by a flat authored amount large enough to overflow (18, PC_HP_MAX 24 in
  // the base fixture); this is the first assertion that drives a *rolled*
  // value through the exact same carry path.
});

test('an all-target spell rolls independently per target -- two living monsters take different damage from one cast', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'multitarget', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].scope = 'all';
    project.spells[0].amountMin = 1;
    project.spells[0].amountMax = 100; // n = 100, limit = 200
    project.spells[0].element = 'none';
    project.sprites.actors[0].hp = 150; // both slimes must survive the larger possible roll
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  nes.cpu.mem[MON_SLOT_ACTOR + 1] = 0; // a second slime in the formation, same as the groupspell test above
  for (let i = 0; i < 12; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_COUNT], 2);
  waitForMenu(nes);
  const startHp0 = nes.cpu.mem[MON_HP];
  const startHp1 = nes.cpu.mem[MON_HP + 1];

  chooseCommand(nes, BC_MAGIC);
  // seed 0x00 -> $A5 substitution -> rng_next = 0x3B, draw = 58 < limit(200);
  // mod8(58, 100) = 58 (58 < 100, no subtraction); result = amountMin(1) + 58
  // = 59 for the first living target (cast_all's own loop starts at
  // other_side()'s base slot and walks up). The LFSR's state after that roll
  // is 0x3B (59); rng_next(0x3B) = 0x76, draw = 0x75 = 117 < limit(200);
  // mod8(117, 100) = 17 (117 - 100 = 17); result = amountMin(1) + 17 = 18 for
  // the second target. 59 != 18: the two targets are independently rolled,
  // not one shared roll applied twice.
  nes.cpu.mem[RNG] = 0x00;
  tap(nes, A, 12); // scope "all": no target to pick, it just resolves

  const dealt0 = startHp0 - nes.cpu.mem[MON_HP];
  const dealt1 = startHp1 - nes.cpu.mem[MON_HP + 1];
  assert.equal(dealt0, 59, 'the first target should take exactly its own roll');
  assert.equal(dealt1, 18, 'the second target should take exactly its own, different roll');
  assert.notEqual(dealt0, dealt1, 'two independently-rolled targets landing on the same number here would be indistinguishable from one shared roll applied twice');
  // Exactly two rng_next calls ran for the whole cast, one per living target:
  // 0x00 -> substituted 0xA5 -> 0x3B (first roll's own new state) -> 0x76
  // (second roll's own new state, per the trace above). This is what makes
  // roll_spell_amount/mod8's own header comment's "bt_tmp2 is NEVER touched"
  // claim a tested one rather than a hope: bt_tmp2 is cast_all's own
  // end-of-side loop sentinel (bt_target's ceiling), read every iteration of
  // the loop this cast runs through, so either routine touching it would
  // corrupt that ceiling mid-loop -- reading turn_order as if it were
  // liveness data, walking past the two real monster slots, and (among other
  // things) drawing more or fewer rolls than the two genuinely alive targets
  // call for. A stray extra or dropped rng_next call is exactly what would
  // show up here as a final RNG byte other than 0x76, even if the two
  // damage numbers above happened to still look plausible.
  assert.equal(nes.cpu.mem[RNG], 0x76, 'exactly two rng_next calls should have run, one per living target');

  // Wrong implementation this catches: rolling once outside cast_all's loop
  // and reusing the same result for every target (design §8's own "caching a
  // single roll... for a less interesting result" alternative it explicitly
  // rejected) -- every assertion elsewhere in this section would still pass
  // with that implementation, since each cast in isolation still lands on a
  // correct, exact value; only a genuine two-target cast in the same battle
  // tick exposes the difference.
  //
  // A second wrong implementation, run and confirmed to fail: `mod8`
  // clobbering `bt_tmp2` instead of `bt_tmp` (its first instruction
  // sabotaged from `sta bt_tmp` to `sta bt_tmp2`) -- corrupting cast_all's
  // own end-of-side sentinel mid-loop, the load-bearing "bt_tmp2 is NEVER
  // touched" contract roll_spell_amount/mod8's own header comment states.
  // Run against this exact fixture (this test's real, unmodified assertions,
  // not an isolated copy): it failed at the very first damage assertion
  // above ("the first target should take exactly its own roll", actual 1,
  // expected 59) -- corrupting bt_tmp2 also corrupts the uninitialized
  // `bt_tmp` this mutation leaves `asl bt_tmp` operating on, so the first
  // roll's own result is already wrong before the RNG-byte assertion is ever
  // reached. The RNG-byte assertion still stands as the direct test of the
  // sentinel-survival claim -- a subtler clobber that left `bt_tmp` alone
  // but still touched `bt_tmp2` only somewhere reachable from mod8/
  // roll_spell_amount would corrupt cast_all's loop ceiling without
  // necessarily producing a wrong-looking single-target number -- but this
  // exact mutation is caught earlier, by the damage numbers, and the report
  // for this fix round records the real failing line rather than a value
  // this run never actually produced.
});

test('ITEM heals from the bag, spends the potion, and cures poison', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  // A potion in the bag, as if it had been picked up on the field. Item id 0
  // (sample-rpg's own "Potion") -- the bag holds item ids under
  // ITEMS_ENABLED (phase 4b), not the actor id (1) that used to back it.
  nes.cpu.mem[INV_ITEMS] = 0;
  nes.cpu.mem[INV_COUNT] = 1;
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_HP] = 5;
  nes.cpu.mem[PC_STATUS] = 1;

  chooseCommand(nes, BC_ITEM);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag');
  tap(nes, A, 10);

  const expected = Math.min(5 + 20, nes.cpu.mem[PC_HP_MAX]);
  assert.equal(nes.cpu.mem[PC_HP], expected, 'the potion should heal twenty, capped at the maximum');
  assert.equal(nes.cpu.mem[INV_COUNT], 0, 'the potion should be spent');
  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'a potion should flush the poison out');
});

// --- saturation at the top of a byte ----------------------------------------
//
// The battle-side heals and multipliers each add in eight bits and then compare
// against a maximum -- and an add that carries past 255 hands the comparison a
// wrapped low byte smaller than either operand, so the clamp accepts a wrong,
// low answer. gain_hearts (engine/combat.asm) and party_heal (engine/rpg.asm)
// both guard this with a `bcs` to the clamp before the `cmp`; these four tests
// pin the same guard onto the battle side. Every fixture is chosen so the
// correct answer and the wrapped answer are far apart (253 vs 14, 0 vs 211...),
// and the maxima sit *below* 255 so an implementation that saturated to 255
// instead of the member's own max would fail too.

test('a potion used near the top of a byte clamps to the max instead of wrapping', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  nes.cpu.mem[INV_ITEMS] = 0; // the potion, by item id
  nes.cpu.mem[INV_COUNT] = 1;
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  // 250 + 20 carries past 255; the wrapped byte would be 14, and 14 < 253
  // sails straight through the one-comparison clamp.
  nes.cpu.mem[PC_HP] = 250;
  nes.cpu.mem[PC_HP_MAX] = 253;

  chooseCommand(nes, BC_ITEM);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag');
  tap(nes, A, 10);

  assert.equal(nes.cpu.mem[PC_HP], 253, 'a potion at high HP should clamp to the max, not wrap below it');
  assert.equal(nes.cpu.mem[INV_COUNT], 0, 'the potion should still be spent');
});

test('a heal spell cast near the top of a byte clamps to the max instead of wrapping', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 2; // Mend, granted the way its level would
  nes.cpu.mem[PC_MP] = 20;
  // 250 + 18 carries; the wrapped byte would be 12.
  nes.cpu.mem[PC_HP] = 250;
  nes.cpu.mem[PC_HP_MAX] = 253;

  chooseCommand(nes, BC_MAGIC);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_SPELLS);
  tap(nes, DOWN, 4); // past Ember to Mend
  tap(nes, A, 6);
  tap(nes, A, 10);

  assert.equal(nes.cpu.mem[PC_HP], 253, 'Mend at high HP should clamp to the max, not wrap below it');
  assert.equal(nes.cpu.mem[PC_MP], 16, 'the clamped cast still costs its four MP');
});

test('a monster healing itself near the top of a byte clamps to its own max', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'monheal', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // The snake casts Mend instead of Venom, and cannot brute-force the fight
    // ending before it does; the party can sit through sixty rounds of it.
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, atk: 0, spellIds: [1] };
    project.party[0].baseHp = 200;
  });
  const nes = bootPastNaming(rom);
  // The snake waits in the bottom-left corner, and a walked-into fight refuses
  // RUN -- which is what makes stalling rounds possible at all.
  walkTo(nes, 32, 112);
  walkTo(nes, 32, 208, 300);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the snake did not start a fight');
  for (let i = 0; i < 12; i++) nes.frame();

  // 250 + 18 carries; the wrapped byte would be 12. Only the snake's own Mend
  // ever touches its HP from here: the party only stalls with refused RUNs.
  nes.cpu.mem[MON_HP] = 250;
  nes.cpu.mem[MON_SLOT_MAX] = 253;

  let healed = false;
  for (let round = 0; round < 60 && !healed; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    healed = nes.cpu.mem[MON_HP] !== 250;
  }
  assert.ok(healed, 'sixty rounds and the snake never cast Mend on itself');
  assert.equal(nes.cpu.mem[MON_HP], 253, 'a monster healing at high HP should clamp to its own max, not wrap');
});

test('a weakness hit at 171 or more saturates instead of dealing less than the plain hit', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'weakover', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // Ember into the slime's fire weakness: 200 * 1.5 = 300, which wraps to 44
    // in eight bits -- *less* than the unmodified 200 -- and saturates to 255.
    // A flat range (amountMin === amountMax) keeps this deterministic: n == 1
    // means roll_spell_amount takes its no-roll branch and hands back exactly
    // 200 every cast, no RNG involved.
    project.spells[0].amountMin = 200;
    project.spells[0].amountMax = 200;
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 255; // saturated damage is exactly its whole HP

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);  // Ember is the first row
  tap(nes, A, 10); // aim it at the slime

  assert.equal(nes.cpu.mem[MON_HP], 0, 'a saturated weakness hit should take all 255, not a wrapped 44');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'and 255 damage into 255 HP is a kill');
});

test('a physical attack of 253 or more survives its own noise roll instead of wrapping', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'atkover', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // Attack 255 against defence 0 leaves bt_tmp at 255 before the 0-3 noise
    // roll is added; any nonzero roll used to wrap the hardest possible hit
    // down to a scratch of 0-2.
    project.party[0].baseAtk = 255;
    project.party[0].atkPerLevel = 0;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, def: 0 };
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET);
  // Nothing advances the LFSR in battle but the rolls themselves, so seeding it
  // here makes the attack deterministic: $B8 -> $01 (roll_hit: 1 < acc-eva, a
  // hit) -> $02 (noise 2, the roll that used to wrap 255 + 2 down to 1).
  nes.cpu.mem[MON_HP] = 255;
  nes.cpu.mem[RNG] = 0xb8;
  tap(nes, A, 20);

  assert.equal(nes.cpu.mem[MON_HP], 0, 'a 255-attack hit should saturate at 255 damage, not wrap to 1');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'and 255 damage into 255 HP is a kill');
});

// ROADMAP item 5 phase 4c round 3, design deliverable 5 (phase4-design.md
// §8): build_item_list (engine/battleui.asm) now filters the battle ITEM
// menu to kind == heal and amount > 0 -- what item_chosen can actually spend
// consistently. A damage-kind item or a zero-amount heal item is a real,
// valid item everywhere else; it must simply never be a selectable row in
// that one menu.
test(
  'the battle ITEM menu lists only what it can spend consistently, while a damage-kind and a zero-amount item stay usable everywhere else',
  { skip: needsSample },
  async (t) => {
    // Round 3b review, K2: the original fixture put the sole qualifying
    // Potion first, so a filter whose scan stops at the first *rejected*
    // item (rather than skipping it and continuing) had nothing to expose
    // it -- and no positive-amount `none`-kind item existed to tell "requires
    // heal" apart from "merely rejects damage" (a `none` item with a
    // nonzero amount is a legal record, since Amount is only *disabled* in
    // the UI for kind `none`, not zeroed underneath). This bag interleaves
    // two qualifying heals between three different kinds of reject, with a
    // reject first, so both gaps have somewhere to show up.
    const rom = await buildVariant(t, 'twomenu', (project) => {
      project.items.push({ id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 5 } });
      project.items.push({ id: 2, name: 'Dud', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 0 } });
      project.items.push({ id: 3, name: 'Charm', actorId: null, metaspriteId: null, effect: { kind: 'none', amount: 7 } });
      project.items.push({ id: 4, name: 'Ether', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 8 } });
    });

    // Bag order: Bomb (reject: wrong kind), Potion (accept), Dud (reject:
    // right kind, wrong amount), Charm (reject: wrong kind, a legal
    // positive-amount `none`), Ether (accept) -- a reject leads, both
    // rejection branches (kind and amount) sit before a later accept they
    // must not swallow, and no two accepts are adjacent. A scan that stops
    // at any reject, on either branch, or a predicate that merely excludes
    // `damage` instead of requiring `heal`, each has a concrete,
    // distinguishing outcome to be wrong about.
    const battleNes = bootPastNaming(rom);
    battleNes.cpu.mem[INV_ITEMS] = 1; // Bomb
    battleNes.cpu.mem[INV_ITEMS + 1] = 0; // Potion
    battleNes.cpu.mem[INV_ITEMS + 2] = 2; // Dud
    battleNes.cpu.mem[INV_ITEMS + 3] = 3; // Charm
    battleNes.cpu.mem[INV_ITEMS + 4] = 4; // Ether
    battleNes.cpu.mem[INV_COUNT] = 5;
    assert.ok(walkIntoEncounter(battleNes));
    waitForMenu(battleNes);
    chooseCommand(battleNes, BC_ITEM);
    assert.equal(battleNes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag -- real items are still in it');
    assert.equal(
      battleNes.cpu.mem[BT_LEN],
      2,
      'exactly the Potion and the Ether should be listed -- a scan that stops at the leading Bomb would see 0, ' +
        'and a scan that stops at the Dud or the Charm (both sitting between the two accepts) would see 1'
    );
    assert.equal(battleNes.cpu.mem[BT_LIST], 0, 'the first listed row should be the Potion (id 0), in bag order');
    assert.equal(
      battleNes.cpu.mem[BT_LIST + 1],
      4,
      'the second listed row should be the Ether (id 4) -- a predicate that merely excludes `damage`, rather ' +
        'than requiring `heal`, would have also listed the Charm (id 3, kind `none`, amount 7) here instead'
    );
    assert.equal(battleNes.cpu.mem[INV_COUNT], 5, 'merely opening the list must not spend or drop anything from the bag');

    // The field: the Bomb, the Dud and the Charm all remain real, spendable
    // items there, via the same use_item (engine/ui.asm) round 2 already
    // covers -- this menu's own filter has nothing to do with what the
    // field applies.
    const fieldNes = bootPastNaming(rom);
    fieldNes.cpu.mem[INV_ITEMS] = 1; // the Bomb
    fieldNes.cpu.mem[INV_COUNT] = 1;
    fieldNes.cpu.mem[INV_SEL] = 0;
    for (let i = 0; i < 4; i++) fieldNes.cpu.mem[PC_HP + i] = 10;
    tap(fieldNes, SELECT);
    assert.equal(fieldNes.cpu.mem[GAME_STATE], ST_MENU);
    tap(fieldNes, A);
    assert.equal(fieldNes.cpu.mem[INV_COUNT], 0, 'the Bomb should be spent from the field even though the battle menu never lists it');
    assert.ok(fieldNes.cpu.mem[PC_HP] < 10, 'the Bomb’s own damage should have applied to the recruited member');

    fieldNes.cpu.mem[INV_ITEMS] = 2; // the Dud
    fieldNes.cpu.mem[INV_COUNT] = 1;
    fieldNes.cpu.mem[INV_SEL] = 0;
    tap(fieldNes, SELECT);
    tap(fieldNes, A);
    assert.equal(fieldNes.cpu.mem[INV_COUNT], 0, 'the Dud should be spent from the field too -- kind alone decides, not the amount');
    assert.equal(fieldNes.cpu.mem[ITEMS_USED], 2, 'both field uses so far should have counted as spent');

    fieldNes.cpu.mem[INV_ITEMS] = 3; // the Charm
    fieldNes.cpu.mem[INV_COUNT] = 1;
    fieldNes.cpu.mem[INV_SEL] = 0;
    tap(fieldNes, SELECT);
    tap(fieldNes, A);
    assert.equal(fieldNes.cpu.mem[INV_COUNT], 1, 'a none-kind item is a key item, kept rather than spent, on the field too');
    assert.equal(fieldNes.cpu.mem[ITEMS_USED], 2, 'a kept key item must not count as spent');
  }
);

// Finding 5 (phase4-design.md §9): the filter can leave bt_len at 0 while
// inv_count is still positive -- a bag holding only field-only-kind items.
// battle_menu_item now decides whether to open BP_ITEMS from the *filtered*
// bt_len, not raw inv_count (engine/battleui.asm), so this bag must not
// reach the broken state the design describes: BT_PHASE staying at
// BP_MENU (Items simply does not open) rather than opening onto an empty
// list whose row-select code would index a stale bt_list[0] and whose Up
// press would underflow bt_sel to $FF (battle_list_up's own `lda bt_len /
// sbc #1`, which computes 0 - 1 = $FF when bt_len is genuinely zero).
test(
  'a bag of only field-only-kind items does not open the battle ITEM menu into a stale or underflowing list -- finding 5',
  { skip: needsSample },
  async (t) => {
    const rom = await buildVariant(t, 'itemsonlyfield', (project) => {
      project.items.push({ id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 5 } });
      project.items.push({ id: 2, name: 'Dud', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 0 } });
    });
    const nes = bootPastNaming(rom);
    nes.cpu.mem[INV_ITEMS] = 1; // the Bomb
    nes.cpu.mem[INV_ITEMS + 1] = 2; // the Dud
    nes.cpu.mem[INV_COUNT] = 2; // no Potion in the bag at all -- nothing qualifies

    assert.ok(walkIntoEncounter(nes));
    waitForMenu(nes);

    // Poke a stale value into bt_list, standing in for whatever an earlier
    // list build (a previous battle's spell or item list) left behind --
    // the exact leftover finding 5 warns a fresh, empty build could still be
    // read through.
    nes.cpu.mem[BT_LIST] = 77;

    chooseCommand(nes, BC_ITEM);
    assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'Items should not open at all -- nothing in the bag qualifies for this menu');
    assert.equal(nes.cpu.mem[BT_LEN], 0, 'the filtered length should read the real, freshly computed zero, not a stale nonzero leftover');
    assert.equal(nes.cpu.mem[BT_SEL], BC_ITEM, 'the highlight should still be sitting on ITEM in the main battle menu, not moved into a list');

    // Up must still behave like the ordinary battle menu's own wraparound,
    // never like the list's -- no $FF, ever.
    tap(nes, UP, 4);
    assert.notEqual(nes.cpu.mem[BT_SEL], 0xff, 'the highlight must never underflow to $FF');
    assert.ok(nes.cpu.mem[BT_SEL] < NUM_COMMANDS, 'the highlight should stay a real battle-menu command');
    assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'still the main battle menu -- Items never opened');
  }
);

// Round 5, B1: the gap ROADMAP.md itself named as outstanding after round 4c.
// item_chosen (engine/battleturn.asm) reads `bt_list,x` to find which item a
// selected row names, then reads item_heal,y (y = that item's own id) for its
// amount -- three separate places a wrong implementation could substitute a
// different item, a different order, or a different amount and still look
// right. Round 6 review found the amount read was not actually covered:
// sample-rpg's own Potion is item id 0, and this test used to select it, so
// an unindexed `lda item_heal` (always reading item_heal[0], Potion's own
// slot) coincidentally produced the same answer as the correct `lda
// item_heal,y`. Potion is excluded from this bag entirely now -- both
// accepted items are freshly authored with nonzero ids, so item_heal[0]
// is never the right answer for either of them, and an unindexed read is
// forced to disagree.
//
// The bag: Bomb(1, reject: kind), Tonic(4, accept, heal 12), Dud(2, reject:
// amount), Ether(3, accept, heal 8). Filtered list, in bag-scan order: [4,
// 3] -- Tonic (the higher id) comes first, already non-ascending without
// forcing it, which is what an id-sorting implementation would get wrong.
// Selecting row 1 (Ether, id 3) means inv_items[1] is Tonic (4), not Ether
// -- a `bt_list,x` -> `inv_items,x` substitution would read the wrong slot
// entirely, and even the two accepted items' own amounts (12 vs 8) differ,
// so a substitution that happened to land on the other accepted item would
// still show up as the wrong heal.
test(
  'item_chosen maps a selected, filtered battle row back to the correct item and amount -- not by index into inv_items, not by sorted id order, not by item 0\'s own amount',
  { skip: needsSample },
  async (t) => {
    const rom = await buildVariant(t, 'rowmapping', (project) => {
      project.items.push({ id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 5 } });
      project.items.push({ id: 2, name: 'Dud', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 0 } });
      project.items.push({ id: 3, name: 'Ether', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 8 } });
      project.items.push({ id: 4, name: 'Tonic', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 12 } });
    });
    const nes = bootPastNaming(rom);
    nes.cpu.mem[INV_ITEMS] = 1; // Bomb
    nes.cpu.mem[INV_ITEMS + 1] = 4; // Tonic
    nes.cpu.mem[INV_ITEMS + 2] = 2; // Dud
    nes.cpu.mem[INV_ITEMS + 3] = 3; // Ether
    nes.cpu.mem[INV_COUNT] = 4;
    assert.ok(walkIntoEncounter(nes));
    waitForMenu(nes);
    nes.cpu.mem[PC_HP] = 5;

    chooseCommand(nes, BC_ITEM);
    assert.equal(nes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag');
    assert.equal(nes.cpu.mem[BT_LEN], 2, 'only the Tonic and the Ether should be listed');
    assert.equal(nes.cpu.mem[BT_LIST], 4, 'row 0 should be the Tonic (id 4) -- it comes first in bag order');
    assert.equal(nes.cpu.mem[BT_LIST + 1], 3, 'row 1 should be the Ether (id 3) -- bt_list must not be sorted by id');

    // Select row 1 (the Ether), not row 0 -- open_menu/battle_menu_item
    // already reset bt_sel to 0, so this is a real D-pad move, not a poke.
    tap(nes, DOWN, 4);
    assert.equal(nes.cpu.mem[BT_SEL], 1, 'DOWN should move the highlight onto row 1');
    tap(nes, A, 10);

    const expected = Math.min(5 + 8, nes.cpu.mem[PC_HP_MAX]);
    assert.equal(
      nes.cpu.mem[PC_HP],
      expected,
      'the Ether’s own heal (8) should have applied -- reading inv_items,x at x=1 would have found Tonic ' +
        'instead (applying 12), a sorted bt_list would have applied Tonic’s own 12 too, and an unindexed ' +
        'item_heal read would have applied item 0’s own amount (Potion, 20) regardless of which item was chosen'
    );
    assert.equal(nes.cpu.mem[INV_COUNT], 3, 'exactly one item (the Ether) should have been removed');
    assert.deepEqual(
      [...nes.cpu.mem.slice(INV_ITEMS, INV_ITEMS + 3)],
      [1, 4, 2],
      'the bag should close up over the Ether’s own slot (index 3), leaving Bomb, Tonic, Dud in their original order'
    );
  }
);

// ROADMAP item 5 phase 4c round 2, design deliverable 6: the field menu's
// own use_item (engine/ui.asm), not item_chosen -- this is a different call
// site with its own register-clobber hazard. party_heal (engine/rpg.asm)
// returns with X = MAX_PARTY, not inv_sel, so use_item's own reload of
// inv_sel after jsr use_item_apply is load-bearing: without it, the shift
// loop that closes the bag over the spent slot starts from the wrong X. A
// "does healing happen" test cannot see this -- the heal amount is read
// from inv_items,x using the *original* X, before use_item_apply ever runs,
// so it applies correctly either way. Only the bag's own post-state (which
// item survived, in which slot) tells the two apart, which is why this
// asserts that and not just the HP delta.
test(
  'use_item (field menu) removes the correct slot, not X = MAX_PARTY -- the register-clobber bug a "does healing happen" test would miss',
  { skip: needsSample },
  async (t) => {
    const rom = await buildVariant(t, 'itemslot', (project) => {
      project.items.push({ id: 1, name: 'Ether', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 5 } });
    });
    const nes = bootPastNaming(rom);
    // Potion (id 0) at slot 0, Ether (id 1) at slot 1 -- inv_sel points at
    // slot 0, the non-last slot. If the register clobber reappeared, X
    // would be MAX_PARTY (4) at the top of the shift loop instead of 0;
    // cpx inv_count (2) is already true there, so the loop would exit on
    // its first check, nothing would actually shift, and the wrong item
    // (Potion) would still be sitting in slot 0 where Ether belongs.
    nes.cpu.mem[INV_ITEMS] = 0;
    nes.cpu.mem[INV_ITEMS + 1] = 1;
    nes.cpu.mem[INV_COUNT] = 2;
    nes.cpu.mem[INV_SEL] = 0;
    nes.cpu.mem[PC_HP] = 5;

    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'SELECT should open the field menu');
    tap(nes, A);

    assert.equal(nes.cpu.mem[INV_COUNT], 1, 'exactly one item should remain');
    assert.equal(
      nes.cpu.mem[INV_ITEMS],
      1,
      'the Ether (id 1) should have shifted down into slot 0 -- if this is still 0 (the Potion), the shift never ' +
        'ran, the exact symptom of use_item_apply’s own X clobber leaking into it'
    );
    const expected = Math.min(5 + 20, nes.cpu.mem[PC_HP_MAX]);
    assert.equal(nes.cpu.mem[PC_HP], expected, 'the selected Potion’s own heal (20) should still have applied');
  }
);

// Round 2b review, H2: only the lethal Damage path (finding 4, below) had a
// test on the RPG side -- party_damage's *alive* return (the `bne
// use_item_apply_alive` branch) had no coverage of its own. A caller that
// treated every non-zero party_damage result as lethal, or that never
// actually applied the damage at all, would still have passed everything
// else in this file.
test(
  'a non-lethal field-used Damage item lowers party HP without ending the game -- party_damage’s alive return',
  { skip: needsSample },
  async (t) => {
    // Round 2b review round 2 (J2): amount 2, not 1 -- item_effect_kind and
    // item_effect_amount (engine/ui.asm's use_item_apply) are read by the
    // identical instruction regardless of game type, so a stand-in that
    // hardcodes every damage item to exactly one point would have applied 1
    // here too and passed this test unnoticed if it had used amount 1.
    const rom = await buildVariant(t, 'nonlethaldamage', (project) => {
      project.items.push({ id: 1, name: 'Rock', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 2 } });
    });
    const nes = bootPastNaming(rom);
    nes.cpu.mem[INV_ITEMS] = 1; // the Rock
    nes.cpu.mem[INV_COUNT] = 1;
    nes.cpu.mem[INV_SEL] = 0;
    nes.cpu.mem[PC_HP] = 5;

    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'SELECT should open the field menu');
    tap(nes, A);

    assert.equal(nes.cpu.mem[PC_HP], 3, 'the Rock’s own 2 points of damage should have applied to the recruited member, not 1');
    assert.equal(nes.cpu.mem[INV_COUNT], 0, 'the Rock should be spent');
    assert.equal(nes.cpu.mem[ITEMS_USED], 1);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'a non-lethal Damage item must not end the game');
  }
);

// Round 2c review, ride-along P2: amount 2 (above) is below every plausible
// hardcoded-small-constant mutation, including a clamp-to-3 -- 2 is already
// under 3, so clamping to 3 would leave it unchanged and this test alone
// could not tell a real 2 from a clamped one. Amount 4, deliberately above
// 3, closes that: a clamp-to-3 mutation would apply 3 instead of 4 and land
// at 2 HP, not the real 1.
test(
  'a non-lethal field-used Damage item above 3 applies its own real amount, not a clamp to 3',
  { skip: needsSample },
  async (t) => {
    const rom = await buildVariant(t, 'nonlethaldamage4', (project) => {
      project.items.push({ id: 1, name: 'Boulder', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 4 } });
    });
    const nes = bootPastNaming(rom);
    nes.cpu.mem[INV_ITEMS] = 1; // the Boulder
    nes.cpu.mem[INV_COUNT] = 1;
    nes.cpu.mem[INV_SEL] = 0;
    nes.cpu.mem[PC_HP] = 5;

    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'SELECT should open the field menu');
    tap(nes, A);

    assert.equal(nes.cpu.mem[PC_HP], 1, 'the Boulder’s own 4 points of damage should have applied in full, not clamped to 3 (which would leave 2)');
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'still non-lethal -- 5 - 4 = 1, not dead');
  }
);

// Finding 4 (phase 4 design §9): use_item_apply must never jump to
// player_died itself -- it is reached by jsr, so a jmp there would strand
// its own return address (back into use_item's shift logic) for some
// unrelated rts to mis-pop later. "It didn't crash" proves nothing here --
// the corruption is silent until something else happens to pop that stray
// address. The direct proof is the stack itself: the instant PC reaches
// player_died, its return address must not point back inside use_item at
// all, which it would if use_item_apply had jumped there mid-call.
//
// Round 2b review, H3: the address-range check alone is weaker than it
// looks. A caller-side path that jumps to player_died while use_item_apply's
// own one-byte `pha` result is still sitting unpopped on the stack pushes
// the return-address read one byte further down than it should be -- that
// misread also lands outside [useItemStart, useItemEnd], for the wrong
// reason, and would still pass. Two more checks close that: the stack
// POINTER itself must match a second, independently measured occurrence of
// the identical call depth (dispatch_input, entered by `jsr` from main_loop
// exactly once, the same depth player_died sits at through use_item's own
// jmp chain) -- a leftover pha leaves SP one lower than that, which a
// one-sided range check on the address it produces cannot catch. And the
// bag itself must already show the spend (inv_count decremented, items_used
// incremented) by the moment PC reaches player_died, since a jump that
// happens before use_item's own shift/pla runs would land here too early to
// have done either.
//
// Round 2b review round 2 (J3): even those additions admit one more wrong
// implementation -- one that pla's, detects death, and jumps to player_died
// AFTER dec inv_count/inc items_used but BEFORE the highlight-repair block
// (`lda inv_sel / cmp inv_count / ...`) that pulls inv_sel back when the
// spent slot was the last one. A single-item bag hides this completely:
// spending the only item leaves inv_sel at 0 whether or not the repair ran,
// because inv_sel started at 0 and the repair's own result for a now-empty
// bag is also 0. A two-item bag with the lethal item in the *last* slot
// makes the repair's own effect (pulling inv_sel from 1 back to 0) visible,
// and the surviving item's slot proves the shift/dec ran at all.
test(
  'a lethal field-used Damage item ends up back in the real return chain, not stranded inside use_item -- finding 4',
  { skip: needsSample },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-lethaluse-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE);
    project.items.push({ id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 255 } });
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });

    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const addrOf = (label) => {
      const match = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
      assert.ok(match, `${label} should be a named symbol in game.fns`);
      return parseInt(match[1], 16);
    };
    const useItemStart = addrOf('use_item');
    const useItemEnd = addrOf('use_item_done');
    const playerDiedAddr = addrOf('player_died');
    const dispatchInputAddr = addrOf('dispatch_input');
    assert.ok(useItemEnd > useItemStart, 'use_item_done should sit after use_item in the assembled ROM');

    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    const nes = emulator.nes;
    const frame = () => nes.frame();
    for (let i = 0; i < 40; i++) frame();
    finishNamingIfOpen(nes); // Rian ships renamable (phase 5); the stack baseline below is measured after this, not before

    // sample-rpg's own item 0 (the Potion) sits harmlessly in slot 0; the
    // Bomb sits in slot 1, the *last* slot -- the one arrangement that makes
    // a skipped highlight repair observable.
    nes.cpu.mem[INV_ITEMS] = 0; // the Potion, unused, proves the shift/order
    nes.cpu.mem[INV_ITEMS + 1] = 1; // the Bomb
    nes.cpu.mem[INV_COUNT] = 2;
    for (let i = 0; i < 4; i++) nes.cpu.mem[PC_HP + i] = 1; // one hit wipes whoever is recruited

    emulator.setButton(BUTTON.SELECT, true);
    frame();
    emulator.setButton(BUTTON.SELECT, false);
    for (let i = 0; i < 12; i++) frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'SELECT should open the field menu');

    // open_menu (engine/ui.asm) resets inv_sel to 0 unconditionally on
    // open, so pointing at the last slot needs one RIGHT press after
    // opening, not a direct poke beforehand -- poking inv_sel before SELECT
    // is exactly what the original, single-item version of this test did,
    // and is exactly why it never noticed the highlight repair could be
    // skipped: slot 0 was already where open_menu was going to put it.
    emulator.setButton(BUTTON.RIGHT, true);
    frame();
    emulator.setButton(BUTTON.RIGHT, false);
    for (let i = 0; i < 4; i++) frame();
    assert.equal(nes.cpu.mem[INV_SEL], 1, 'RIGHT should move the highlight onto the Bomb, the last slot');

    // Baseline: SP the instant dispatch_input is entered on an ordinary
    // frame, before the lethal item is even used. dispatch_input is one jsr
    // deep from main_loop (`jsr dispatch_input`, 2 bytes); player_died below
    // is reached from inside that same, still-unreturned call, through
    // dispatch_input's own `txa`/`pha` (engine/input.asm's dispatch_loop,
    // "the handlers use X to walk the entity slots", 1 byte) and its `jsr
    // do_action` (2 bytes) -- do_action_confirm, use_item and use_item_apply
    // add nothing further of their own once use_item_apply's jsr/rts and
    // use_item's pha/pla have each balanced, so a correct implementation
    // reaches player_died exactly 3 bytes deeper than dispatch_input's own
    // entry point. That +3 is this file's own structure, not a guess -- a
    // second, independently measured occurrence of dispatch_input's own
    // depth is what it is measured against, rather than a literal SP value
    // that would say nothing about why it should be that number.
    assert.ok(
      emulator.runToAddress(dispatchInputAddr, { frames: 10 }),
      'dispatch_input should run every ordinary frame while sitting in the menu'
    );
    const expectedSp = (nes.cpu.REG_SP - 3) & 0xff;
    for (let i = 0; i < 4; i++) frame(); // let this frame finish cleanly before the real button press

    emulator.breakpoints.add(playerDiedAddr);
    emulator.setButton(BUTTON.A, true);
    const reached = emulator.runToAddress(playerDiedAddr, { frames: 10 });
    emulator.setButton(BUTTON.A, false);
    assert.ok(reached, 'player_died should be reached within a few frames of confirming the lethal item');
    assert.equal(emulator.pc, playerDiedAddr);

    // By the time PC reaches player_died, use_item's own shift loop, dec/inc
    // and the highlight fixup have already run (they all sit between the
    // pha and the jmp), so the spend must already be fully visible -- a jump
    // reached before the fixup completed would land here having done the
    // dec/inc but skipped exactly the highlight repair, which is what the
    // inv_sel assertion below exists to catch.
    assert.equal(nes.cpu.mem[INV_COUNT], 1, 'the lethal Bomb should already be removed from the bag by the time player_died runs');
    assert.equal(nes.cpu.mem[ITEMS_USED], 1, 'items_used should already be bumped by the time player_died runs');
    assert.equal(
      nes.cpu.mem[INV_SEL],
      0,
      'spending the last slot (1) should have pulled inv_sel back to 0 by the time player_died runs -- a jump ' +
        'reached after the dec/inc but before the highlight repair would leave inv_sel stranded at 1, past the ' +
        'end of the one remaining item'
    );
    assert.equal(nes.cpu.mem[INV_ITEMS], 0, 'the surviving Potion should still be sitting in slot 0, untouched');

    // The instant PC lands on player_died, read the return address sitting
    // on top of the stack -- exactly what an rts right here would jump to.
    const sp = nes.cpu.REG_SP & 0xff;
    const lo = nes.cpu.mem[0x100 | ((sp + 1) & 0xff)];
    const hi = nes.cpu.mem[0x100 | ((sp + 2) & 0xff)];
    const returnAddr = (((hi << 8) | lo) + 1) & 0xffff;
    assert.ok(
      returnAddr < useItemStart || returnAddr > useItemEnd,
      `the stack's own return address (0x${returnAddr.toString(16)}) falls inside use_item ` +
        `(0x${useItemStart.toString(16)}-0x${useItemEnd.toString(16)}) -- a stray jsr use_item_apply return address ` +
        'is still sitting on the stack, exactly finding 4'
    );
    assert.equal(
      sp,
      expectedSp,
      `the stack pointer at player_died (0x${sp.toString(16)}) does not match dispatch_input's own baseline depth ` +
        `(0x${expectedSp.toString(16)}) -- a leftover pha byte would leave it exactly one lower than this`
    );

    for (let i = 0; i < 20; i++) frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'the lethal hit should still reach game over normally');
  }
);

test('a certain drop lands in the bag on victory', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'drop', (project) => {
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, dropPct: 100 };
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  assert.equal(nes.cpu.mem[INV_COUNT], 0);

  waitForMenu(nes);
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  const state = pressThrough(nes, 120);
  assert.equal(state, ST_GAMEPLAY, 'the fight never ended');
  assert.ok(nes.cpu.mem[INV_COUNT] >= 1, 'a certain drop never dropped');
  // Item id 0, not actor id 1 -- the bag holds item ids under ITEMS_ENABLED.
  assert.equal(nes.cpu.mem[INV_ITEMS], 0, 'the drop should be the potion the slime carries');
});

// --- review finding 13: roll_drop compares a 0-63 roll to a 0-100 byte -----

// roll_drop (engine/battleturn.asm) scales its own roll to 0-63 before
// comparing it against mon_drop_pct, so the byte battletables.js emits into
// that table has to live in the identical 0-63 domain -- dropThreshold is
// the single place that scaling happens, at generation time, with no engine
// change of its own.
test('dropThreshold scales an authored percentage into the 0-63 roll domain', () => {
  assert.equal(dropThreshold(0), 0, 'a 0% chance must keep roll_drop\'s own early-out meaning "never"');
  assert.equal(dropThreshold(1), 1);
  assert.equal(dropThreshold(50), 32, '50% of 64 is 32');
  assert.equal(dropThreshold(100), 64, '100% is one past the largest value a 0-63 roll can ever produce -- certain');

  // Monotonic: raising the authored percentage must never lower the compiled
  // byte, or an author's own "more likely" slider would compile backwards.
  let prev = -1;
  for (let pct = 0; pct <= 100; pct++) {
    const value = dropThreshold(pct);
    assert.ok(value >= prev, `dropThreshold(${pct}) = ${value} should not be lower than the previous percentage's ${prev}`);
    prev = value;
  }
});

// The generation-level fix cross-checked against the real engine: roll_drop
// itself, called directly (bypassing the whole battle flow, the same
// isolation technique as the apply_damage test above) once per seed 0-255,
// counted against a JS model built from referenceRngNext (already proven
// against rng_next elsewhere in this file) and dropThreshold together. A
// generation-only fix that scaled the wrong way, rounded the wrong way, or
// never reached mon_drop_pct at all would all show up here as a seed-sweep
// count that does not match the model, not merely as "some drops happened".
test('roll_drop\'s own drop rate matches referenceRngNext + dropThreshold across every seed, for 0%, 50% and 100%', {
  skip: needsSample
}, async (t) => {
  for (const pct of [0, 50, 100]) {
    const built = await buildVariantFull(t, `dropthreshold-sweep-${pct}`, (project) => {
      project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, dropPct: pct };
    });
    const nes = bootPastNaming(built.romPath, 10);
    const addrOf = selectBattleBank(nes, built);
    const rollDrop = addrOf('roll_drop');
    const threshold = dropThreshold(pct);

    let drops = 0;
    let predictedDrops = 0;
    for (let seed = 0; seed < 256; seed++) {
      nes.cpu.mem[MON_SLOT_ACTOR] = 0; // this build's slime, slot 0
      nes.cpu.mem[RNG] = seed;
      nes.cpu.mem[INV_COUNT] = 0;
      nes.cpu.mem[INV_ITEMS] = 0xff;
      nes.cpu.REG_X = 0;
      callRoutine(nes, rollDrop);
      if (nes.cpu.mem[INV_COUNT] === 1) drops++;

      const roll64 = referenceRngNext(seed) >> 2;
      if (roll64 < threshold) predictedDrops++;
    }

    assert.equal(
      drops,
      predictedDrops,
      `dropPct ${pct} (threshold ${threshold}): predicted ${predictedDrops} drops across all 256 seeds, the ROM gave ${drops}`
    );
    // Sanity on the model itself, so a model bug cannot pass by predicting
    // the same wrong number the old bug produced: 0% must never drop, and
    // 100% must always drop, in both the prediction and the ROM alike.
    if (pct === 0) assert.equal(drops, 0, 'a 0% drop chance must never drop');
    if (pct === 100) assert.equal(drops, 256, 'a 100% drop chance must always drop');
  }
});

test('a group spell reaches every monster in the formation at once', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'groupspell', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].scope = 'all';
    project.sprites.actors[0].hp = 30; // both slimes survive the hit, so it is measurable
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_INTRO);
  nes.cpu.mem[MON_SLOT_ACTOR + 1] = 0;
  for (let i = 0; i < 12; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_COUNT], 2);

  waitForMenu(nes);
  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 12); // Ember, now scope "all": no target to pick, it just resolves

  // Fire against a fire weakness: ten becomes fifteen, on both of them.
  assert.equal(nes.cpu.mem[MON_HP], 15, 'the first monster took the wrong damage');
  assert.equal(nes.cpu.mem[MON_HP + 1], 15, 'the group spell missed the second monster');
});

// --- review finding 9: killing a formation in one tick overruns vblank -----

// wipe_monster's own four-row sweep, called once per dying monster, used to
// let an all-target spell killing four at once queue 4 x 44 = 176 bytes of
// PPUDATA in the same frame -- past the ~2273-cycle vblank window, so the
// writes land on visible scanlines. The fix (bt_wipe_mask/bt_wipe_row,
// wipe_tick) turns that into a per-frame producer budgeted at one 8-byte
// row -- an 11-byte packet with its 3-byte header -- at a time. Measured
// directly against real PPUDATA traffic ($2007 writes, the same oracle the
// review's own repro used) rather than against internal RAM state, since
// the defect is about how much lands in one frame, not about whether it
// eventually all lands.
test('killing a whole formation in one tick queues at most one wipe row a frame, not a 176-byte spike', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'wipe-budget', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].scope = 'all';
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  // Force all four monster slots alive with one hit point each -- the wipe
  // budget is a property of apply_damage_mon/wipe_tick alone, not of
  // whichever formation the walk actually seated, and this is the review's
  // own repro shape: an all-target spell killing four monsters at once.
  for (let slot = 0; slot < 4; slot++) {
    nes.cpu.mem[MON_SLOT_ACTOR + slot] = 0;
    nes.cpu.mem[MON_HP + slot] = 1;
    nes.cpu.mem[MON_ALIVE + slot] = 1;
  }
  nes.cpu.mem[BT_COUNT] = 4;

  chooseCommand(nes, BC_MAGIC);

  const writesPerFrame = [];
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  let current = 0;
  nes.mmap.write = (address, value) => {
    if (address === 0x2007) current++;
    return originalWrite(address, value);
  };

  nes.buttonDown(1, A); // Ember, scope "all" -- resolves immediately, killing all four
  current = 0;
  nes.frame();
  writesPerFrame.push(current);
  nes.buttonUp(1, A);
  // Just long enough to cover the cast's own message and the full wipe
  // drain (measured at 16 frames for four monsters' four rows each) --
  // deliberately short of MSG_HOLD (45 frames), past which the message
  // auto-advances on its own and queues unrelated post-battle traffic
  // (the victory line, and so on) that has nothing to do with this fix.
  for (let i = 0; i < 25; i++) {
    current = 0;
    nes.frame();
    writesPerFrame.push(current);
  }
  nes.mmap.write = originalWrite;

  assert.equal(nes.cpu.mem[BT_COUNT], 0, 'all four monsters should have died to the one cast');

  const maxPerFrame = Math.max(...writesPerFrame);
  // The old bug's own shape: one dying monster's wipe alone is 4 rows of 8
  // (32 PPUDATA bytes) queued in a single call, so four monsters dying in
  // the same tick was up to 128 wipe bytes in one frame, on top of whatever
  // the message flow queued that same frame. Nothing this fix touches
  // should ever again approach that -- the budgeted path caps a single
  // wipe-driven frame at one row (8), and the largest *other* single-frame
  // producer measured on this build (clear_message's own 4 rows, see the
  // report) is 52, so 60 is generous headroom above real producers and far
  // below the old bug's own magnitude.
  assert.ok(
    maxPerFrame <= 60,
    `no single frame should come anywhere near a full monster wipe (32 PPUDATA bytes) at once, let alone four -- ` +
      `saw a peak of ${maxPerFrame} $2007 writes in one frame`
  );

  // The budgeted rows themselves: four monsters x four rows x eight bytes is
  // 128 bytes total, and it must be spread over many frames (one row a
  // frame), never bunched into a handful of them.
  const wipeFrames = writesPerFrame.filter((count) => count === 8);
  const wipeBytes = wipeFrames.length * 8;
  assert.equal(wipeBytes, 4 * 4 * 8, 'the four monsters\' full wipes (4 rows each, 8 bytes a row) should all eventually drain');
  assert.ok(
    wipeFrames.length >= 15,
    `the 16 wipe rows should be spread across at least 15 distinct frames (one row a frame) -- saw only ${wipeFrames.length}`
  );
});

// Round 2 review finding: wipe_tick re-picked the lowest set bt_wipe_mask bit
// every frame it was idle between rows, but bt_wipe_row is a single counter
// shared across whichever slot it lands on -- so a lower slot dying while a
// higher one was mid-wipe stole that in-progress row count instead of
// starting its own sweep at row 0, and its own earlier rows were never
// queued at all. bt_wipe_slot (engine/constants.asm) makes the active slot
// sticky: a fresh pick only happens once bt_wipe_row is back at zero.
//
// Reproduces the reviewer's own staggered-death shape directly against RAM
// state (the same technique the apply_damage isolation tests above use):
// slots 1-3 die in one tick (bt_wipe_mask set for all three at once, as a
// real all-target kill would leave it), then slot 0 dies two rows into
// slot 3's own sweep -- the exact interruption point the finding names.
// Every one of the four blocks' four rows is then checked directly in the
// nametable, not just bt_wipe_mask reaching zero, because the bug's own
// shape is "some rows silently never queued," which an empty mask alone
// cannot distinguish from "every row genuinely queued."
test('a lower slot dying while a higher slot is mid-wipe still gets all four of its own rows blanked', {
  skip: needsSample
}, async (t) => {
  let capturedProject;
  const built = await buildVariantFull(t, 'wipe-stagger', (project) => {
    capturedProject = project;
    project.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const BT_WIPE_MASK = resolveEngineAddress(constantsText, 'bt_wipe_mask');
  const BT_WIPE_ROW = resolveEngineAddress(constantsText, 'bt_wipe_row');
  const fillTile = capturedProject.maps[0].battleGroundTile;

  const nes = bootPastNaming(built.romPath);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  // Force all four monster slots alive with real block art (sample-rpg's
  // slime has one, battleTile 32) so a wiped cell is observably different
  // from an unwiped one -- a metasprite-only monster would leave the
  // background exactly as ground fill either way and prove nothing.
  for (let slot = 0; slot < 4; slot++) {
    nes.cpu.mem[MON_SLOT_ACTOR + slot] = 0;
    nes.cpu.mem[MON_HP + slot] = 1;
    nes.cpu.mem[MON_ALIVE + slot] = 1;
  }
  nes.cpu.mem[BT_COUNT] = 4;
  for (let i = 0; i < 4; i++) nes.frame(); // let draw_monsters actually paint the four blocks

  // Slots 1-3 die in the same tick: bt_wipe_mask gets all three bits at
  // once, exactly as apply_damage_mon leaves it after an all-target spell
  // kills them within the same cast_all loop.
  for (const slot of [1, 2, 3]) {
    nes.cpu.mem[MON_ALIVE + slot] = 0;
    nes.cpu.mem[MON_HP + slot] = 0;
  }
  nes.cpu.mem[BT_COUNT] = 1;
  nes.cpu.mem[BT_WIPE_MASK] = (1 << 1) | (1 << 2) | (1 << 3);

  // Ten frames drains slot 1's own four rows, then slot 2's own four, then
  // two of slot 3's own four -- deterministic in both the fixed and the
  // buggy shared-counter implementation alike, since nothing has diverged
  // between them yet at this point: neither has had a reason to re-pick or
  // stay sticky before the very first interruption below. Driving the poke
  // by frame count rather than by reading bt_wipe_slot (the fix's own new
  // byte, meaningless in the sabotaged version) is what makes this a fair
  // sabotage target instead of merely re-checking the fix's own bookkeeping.
  let staggered = false;
  let drained = false;
  for (let i = 0; i < 60 && !drained; i++) {
    nes.frame();
    if (!staggered && i === 9) {
      assert.equal(
        nes.cpu.mem[BT_WIPE_ROW],
        2,
        'scenario setup is wrong, not the fix: expected slot 3 to be two rows into its own wipe by the tenth frame'
      );
      // Slot 3 is two rows into its own sweep -- kill slot 0 right now.
      nes.cpu.mem[MON_ALIVE + 0] = 0;
      nes.cpu.mem[MON_HP + 0] = 0;
      nes.cpu.mem[BT_COUNT] = 0;
      nes.cpu.mem[BT_WIPE_MASK] |= 1 << 0;
      staggered = true;
    }
    if (staggered && nes.cpu.mem[BT_WIPE_MASK] === 0) drained = true;
  }
  assert.ok(drained, 'bt_wipe_mask never reached zero -- the wipe queue got stuck');

  // vram_buf's own contract: NMI drains what mainline queued *this* frame at
  // the *next* vblank, so the last row's packet -- built during the very
  // frame bt_wipe_mask reached zero -- is not yet visible in the nametable
  // until one more nes.frame() has run. Two, for margin.
  for (let i = 0; i < 2; i++) nes.frame();

  for (let slot = 0; slot < 4; slot++) {
    for (let row = 0; row < 4; row++) {
      const tiles = nametableRow(nes, BT_MON_ROW + slot * 4 + row, BT_MON_COL, 8);
      assert.deepEqual(
        tiles,
        new Array(8).fill(fillTile),
        `slot ${slot} row ${row} should be fully blanked to the ground fill tile (${fillTile}) -- got [${tiles.join(',')}]` +
          (slot === 0 && row < 2 ? ' (slot 0\'s own top two rows are exactly what the bug left unwiped)' : '')
      );
    }
  }
});

// A direct cycle measurement of the thing the ~2273-cycle vblank window
// actually bounds: vram_drain, NMI's own routine, draining whatever a
// producer queued the frame before. wipe_tick runs on the mainline (which has
// the whole ~29,780-cycle NTSC frame to spare, not the vblank window), so
// timing wipe_tick itself would measure the wrong budget entirely -- what
// matters is how many bytes it adds to vram_buf, and what draining that
// costs. Four real apply_damage calls (via callRoutine, the same isolation
// as the apply_damage_mon test above) set all four bt_wipe_mask bits through
// the real engine mechanism; wipe_tick then queues exactly one row (11
// bytes: a 3-byte header plus 8 PPUDATA bytes) rather than a dying monster's
// old four-row, 44-byte sweep, let alone four of those in the same frame.
test('draining one wipe row costs a small fraction of the ~2273-cycle vblank window', {
  skip: needsSample
}, async (t) => {
  const built = await buildVariantFull(t, 'wipe-cycles', () => {});
  const addrOf = (label) => {
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const nes = bootPastNaming(built.romPath, 10);
  selectBattleBank(nes, built);
  const applyDamage = addrOf('apply_damage');
  const wipeTick = addrOf('wipe_tick');

  nes.cpu.mem[BT_COUNT] = 4;
  for (let slot = 0; slot < 4; slot++) {
    nes.cpu.mem[MON_ALIVE + slot] = 1;
    nes.cpu.mem[MON_HP + slot] = 1;
    nes.cpu.mem[BT_TARGET] = MAX_PARTY + slot;
    nes.cpu.mem[BT_DMG_LO] = 1;
    nes.cpu.mem[BT_DMG_HI] = 0;
    callRoutine(nes, applyDamage);
  }
  assert.equal(nes.cpu.mem[BT_COUNT], 0, 'all four slots should have died, each owing wipe_tick a row');

  const VRAM_LEN = 0x3c; // engine/constants.asm
  const VRAM_BUF = 0x0400; // engine/constants.asm
  nes.cpu.mem[VRAM_LEN] = 0;
  nes.cpu.mem[VRAM_BUF] = 0;
  callRoutine(nes, wipeTick); // mainline: builds the packet, does not drain it
  assert.equal(nes.cpu.mem[VRAM_LEN], 11, "wipe_tick should queue exactly one row's own packet (3-byte header + 8 PPUDATA bytes), not more");

  // vram_drain is called from NMI with A/X/Y already saved -- callRoutine's
  // own stub does not save them, but this routine does not need that
  // discipline to answer the one question here, which is purely how many
  // cycles it takes to walk the one packet just queued.
  const drainCycles = callRoutine(nes, addrOf('vram_drain'));
  assert.ok(
    drainCycles < 1000,
    `draining one wipe row (${drainCycles} cycles) should leave generous room under the ~2273-cycle vblank window, ` +
      'even after the OAM DMA\'s own 513 cycles and NMI\'s register save/restore'
  );
});

// --- the monster spell list (docs/design-monster-spell-list.md), phase 1 --
// engine-harness tests 6-9 of §12's own test plan. Tests 1-4, 11, 12 (schema
// and generator) live in test/unit/project.test.js; test 2 (the banked
// allowance isolation) lives in test/unit/bankedbytes.test.js; test 13 (the
// Monster Forge's own single-select migration) lives in main/smoke.js.

// rng_next (engine/rpg.asm:14-24), reproduced here in JS: an 8-bit Galois
// LFSR. `rng == 0` is repaired to $A5 before shifting; the shift's own
// carry-out XORs in $71. Every test below that predicts an exact rng byte
// or cast/decline outcome computes it with this function, never a
// hand-picked constant -- the same discipline lfsr-sim2.mjs (the design's
// own simulation script) holds to.
function rngNext(state) {
  const seed = state === 0 ? 0xa5 : state;
  const carryOut = (seed & 0x80) !== 0;
  let next = (seed << 1) & 0xff;
  if (carryOut) next ^= 0x71;
  return next;
}

const MONSTER_PICK_LIMIT = { 2: 254, 3: 255, 4: 252 }; // floor(255/K)*K, indexed by K

/**
 * Simulates monster_turn's pick-first algorithm (docs/design-monster-spell-
 * list.md §6's own listing) exactly, given the rng byte already in `rng`
 * the instant monster_turn is entered and the number of currently-
 * affordable entries in the scanned sub-list. Returns { idx, cast, rng,
 * draws } -- idx is only meaningful when cast is true; rng is the byte left
 * in `rng` once the routine returns (the post-coin boundary callRoutine's
 * own return coincides with, under the acc: 0/flat-spell protocol below).
 */
function pickFirst(seedIn, affordableCount) {
  let rng = seedIn;
  let draws = 0;
  let idx = 0;
  if (affordableCount > 1) {
    const limit = MONSTER_PICK_LIMIT[affordableCount];
    for (;;) {
      rng = rngNext(rng);
      draws++;
      const draw = rng - 1; // sec/sbc #1 -- rng_next() never returns 0, so no underflow
      if (draw >= limit) continue; // rejected: redraw
      idx = draw % affordableCount;
      break;
    }
  }
  rng = rngNext(rng);
  draws++;
  const cast = (rng & 1) === 0;
  return { idx, cast, rng, draws };
}

/**
 * The §12 engine-harness protocol for tests 6, 8 and 9: builds `mutate`'s
 * own sample-rpg variant, boots it, selects the battle bank, and runs the
 * one-time setup (the real party_init/setup_monsters routines, not
 * hand-listed values) with `testedActorId` seated in monster slot 0
 * (combatant index MAX_PARTY). Returns a `trial(mp, seed)` stepper that
 * performs the full per-trial reset (§12) and calls monster_turn once
 * through callRoutine, leaving rng/mon_slot_mp/bt_arg in their post-call
 * state for the caller to read.
 */
async function buildMonsterTurnHarness(t, name, testedActorId, mutate) {
  const built = await buildVariantFull(t, name, mutate);
  const nes = bootPastNaming(built.romPath, 10);
  const addrOf = selectBattleBank(nes, built);

  callRoutine(nes, addrOf('party_init'));
  nes.cpu.mem[MON_SLOT_ACTOR] = testedActorId;
  for (let slot = 1; slot < 4; slot++) nes.cpu.mem[MON_SLOT_ACTOR + slot] = 0xff; // NO_ACTOR
  callRoutine(nes, addrOf('setup_monsters'));
  nes.cpu.mem[BT_ACTOR] = 4; // MAX_PARTY + slot 0

  return {
    nes,
    addrOf,
    trial(mp, seed) {
      nes.cpu.mem[MON_SLOT_MP] = mp;
      nes.cpu.mem[PC_HP] = nes.cpu.mem[PC_HP_MAX];
      nes.cpu.mem[PC_STATUS] = 0;
      nes.cpu.mem[VRAM_LEN] = 0;
      nes.cpu.mem[RNG] = seed;
      callRoutine(nes, addrOf('monster_turn'));
    }
  };
}

test('test 6: pick-first (option i) diverges from an unconditional four-slot draw (option ii) on exactly 64 of 255 seeds, at a controlled MP value', {
  skip: needsSample
}, async (t) => {
  const h = await buildMonsterTurnHarness(t, 'msl-test6', 3, (project) => {
    project.sprites.actors[3].battle = {
      ...project.sprites.actors[3].battle,
      acc: 0,
      spellIds: [2, 0] // Venom (cost 2), Ember (cost 3)
    };
  });

  let divergences = 0;
  for (let seed = 1; seed <= 255; seed++) {
    h.trial(2, seed); // MP=2: Venom affordable, Ember is not -- bt_len==1, the coin alone decides
    const castVenom = h.nes.cpu.mem[MON_SLOT_MP] !== 2;

    const draw = rngNext(seed); // both algorithms' own single first draw, from the identical seed
    const castI = (draw & 1) === 0; // option (i): bt_len==1's own coin-only short circuit
    const castII = (draw & 3) === 0; // option (ii): unconditional 4-slot index, slot 0 (Venom) only

    assert.equal(castVenom, castI, `seed ${seed}: real hardware should match option (i)'s own coin-only prediction`);
    if (castI !== castII) divergences++;
    if (seed === 1) {
      assert.equal(castI, true, "named witness (design §6/§12 test 6): seed 1's real hardware should cast Venom");
      assert.equal(castII, false, 'named witness: option (ii) attacks on the identical seed (the drawn slot is $FF padding)');
    }
  }
  assert.equal(
    divergences,
    64,
    'option (i) and option (ii) should disagree on cast-vs-attack for exactly 64 of the 255 seeds, computed exhaustively'
  );
});

test('test 7: mod_monster_len computes dividend mod divisor exactly, for every dividend 0-254 at every divisor 2, 3, 4', {
  skip: needsSample
}, async (t) => {
  const built = await buildVariantFull(t, 'msl-test7', (project) => {
    project.sprites.actors[3].battle = {
      ...project.sprites.actors[3].battle,
      spellIds: [2, 0] // turns MONSTER_SPELL_LIST_ENABLED on project-wide
    };
  });
  const nes = bootPastNaming(built.romPath, 10);
  const addrOf = selectBattleBank(nes, built);
  const modMonsterLen = addrOf('mod_monster_len');

  for (const divisor of [2, 3, 4]) {
    for (let dividend = 0; dividend <= 254; dividend++) {
      nes.cpu.mem[BT_LEN] = divisor;
      nes.cpu.REG_ACC = dividend;
      callRoutine(nes, modMonsterLen);
      assert.equal(
        nes.cpu.REG_ACC,
        dividend % divisor,
        `mod_monster_len(${dividend}, ${divisor}) should be ${dividend % divisor}`
      );
    }
  }
});

// K -> {ids, costs}: Snake's own spellIds in order, and each entry's own MP
// cost, pairwise distinct at every K (Venom 2, Ember 3, Mend 4, Frost 1 --
// the extra flat spell the harness intro (§12) adds), so an MP spend alone
// identifies the chosen index independent of and in addition to bt_arg.
const MSL_TEST8_CONFIGS = {
  2: { ids: [2, 0], costs: [2, 3] },
  3: { ids: [2, 0, 1], costs: [2, 3, 4] },
  4: { ids: [2, 0, 1, 3], costs: [2, 3, 4, 1] }
};

test('test 8: exhaustive per-seed coin+picker check at K=2,3,4 -- cast/decline, chosen index, and exit rng, against the pickFirst oracle', {
  skip: needsSample
}, async (t) => {
  for (const K of [2, 3, 4]) {
    const { ids, costs } = MSL_TEST8_CONFIGS[K];
    const h = await buildMonsterTurnHarness(t, `msl-test8-k${K}`, 3, (project) => {
      project.spells.push({
        id: 3, name: 'Frost', kind: 'damage', amountMin: 6, amountMax: 6,
        element: 'none', scope: 'one', mpCost: 1
      });
      project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, acc: 0, spellIds: ids };
    });

    for (let seed = 1; seed <= 255; seed++) {
      h.trial(4, seed); // 4 affords every one of the four costs at once
      const expected = pickFirst(seed, K);
      const mpAfter = h.nes.cpu.mem[MON_SLOT_MP];
      const cast = mpAfter !== 4;
      assert.equal(cast, expected.cast, `K=${K} seed ${seed}: cast/decline should match the oracle`);
      if (expected.cast) {
        assert.equal(
          mpAfter,
          4 - costs[expected.idx],
          `K=${K} seed ${seed}: MP spend should match the predicted index's own cost`
        );
        assert.equal(
          h.nes.cpu.mem[BT_ARG],
          ids[expected.idx],
          `K=${K} seed ${seed}: bt_arg (the cast spell id) should identify the predicted index`
        );
      }
      assert.equal(
        h.nes.cpu.mem[RNG],
        expected.rng,
        `K=${K} seed ${seed}: rng at callRoutine's own return should match the oracle's post-coin value`
      );
    }
  }
});

test('test 9: RNG-consumption identity for a single-affordable-entry monster, feature off entirely vs on project-wide (a second actor enabling it)', {
  skip: needsSample
}, async (t) => {
  const seed = 1; // rngNext(1) = 2, even -- the coin passes on this seed
  const mp = 2; // Venom's own cost, affordable

  const off = await buildMonsterTurnHarness(t, 'msl-test9-off', 3, (project) => {
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, acc: 0, spellIds: [2] };
  });
  off.trial(mp, seed);
  const rngOff = off.nes.cpu.mem[RNG];

  const on = await buildMonsterTurnHarness(t, 'msl-test9-on', 3, (project) => {
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, acc: 0, spellIds: [2] };
    // A second actor with 2+ entries -- turns MONSTER_SPELL_LIST_ENABLED on
    // project-wide without the tested actor (Snake) ever exercising the
    // pick-retry block itself.
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, spellIds: [0, 1] };
  });
  on.trial(mp, seed);
  const rngOn = on.nes.cpu.mem[RNG];

  assert.equal(
    off.nes.cpu.mem[MON_SLOT_MP],
    mp - 2,
    'sanity: the feature-off build should have cast Venom on this seed'
  );
  assert.equal(
    on.nes.cpu.mem[MON_SLOT_MP],
    mp - 2,
    'sanity: the feature-on build should have cast Venom on this seed too'
  );
  // rngOn === rngOff alone cannot distinguish "both consumed one draw" from
  // "both consumed two" -- pin each side to the single draw rngNext(seed)
  // itself predicts (round-1 review, finding 2), not just to each other.
  assert.equal(
    rngOff,
    rngNext(seed),
    'the feature-off build should leave rng at exactly the coin\'s own single draw'
  );
  assert.equal(
    rngOn,
    rngNext(seed),
    'the feature-on build should leave rng at exactly the coin\'s own single draw too, not a second (pick) draw'
  );
  assert.equal(
    rngOn,
    rngOff,
    'the on build should consume the same single rng_next call the off build does, both landing on the byte rngNext predicts'
  );
});

// --- poison and the monsters' own magic -------------------------------------

test('a monster with a spell casts it, spending its own MP, and poison ticks', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'monspell', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // The snake cannot brute-force the fight ending before it ever casts, and
    // the party can sit through sixty rounds of it.
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, atk: 0 };
    project.party[0].baseHp = 200;
  });
  const nes = bootPastNaming(rom);
  // The snake waits in the bottom-left corner.
  walkTo(nes, 32, 112);
  walkTo(nes, 32, 208, 300);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the snake did not start a fight');
  for (let i = 0; i < 12; i++) nes.frame();
  // The snake is faster than the member, so it may have acted — and cast —
  // before this first look; seated MP just has to be sane.
  const seatedMp = nes.cpu.mem[MON_SLOT_MP];
  assert.ok(seatedMp > 0 && seatedMp <= 8, `the snake was seated with ${seatedMp} MP`);

  // Stall with RUN (a walked-into fight refuses it) until the snake casts.
  let poisoned = false;
  for (let round = 0; round < 60 && !poisoned; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    poisoned = nes.cpu.mem[PC_STATUS] !== 0;
  }
  assert.ok(poisoned, 'sixty rounds and the snake never cast Venom');
  assert.ok(nes.cpu.mem[MON_SLOT_MP] < 8, 'casting should have cost the snake MP');

  // Poison bites after the victim's own turns: stall two more rounds and the
  // member is strictly worse off than the snake's zero-attack scratches allow.
  const hpWhenPoisoned = nes.cpu.mem[PC_HP];
  for (let round = 0; round < 6; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
  }
  assert.ok(nes.cpu.mem[PC_HP] < hpWhenPoisoned, 'poison never cost the member anything');
});

test('the party can poison a monster, and the poison alone finishes it', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'poison', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // Four hit points is two poison ticks, and it can never hit back.
    project.sprites.actors[0].hp = 4;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0 };
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  // Venom is authored at level 2; grant it the way the level would.
  nes.cpu.mem[PC_SPELLS] |= 4;
  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4); // past Ember to Venom
  tap(nes, A, 6);
  tap(nes, A, 10);   // aim it at the slime
  assert.equal(nes.cpu.mem[MON_STATUS], 1, 'the slime should be poisoned');
  assert.equal(nes.cpu.mem[MON_HP], 4, 'poison should not deal its damage up front');

  // Stall; the slime's misses each end in a poison tick, and two of those are
  // the whole of its four hit points.
  let ended = ST_BATTLE;
  for (let round = 0; round < 30 && ended === ST_BATTLE; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    ended = nes.cpu.mem[GAME_STATE];
  }
  assert.equal(ended, ST_GAMEPLAY, 'the poison never finished the slime');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);
  assert.ok(nes.cpu.mem[PC_XP_LO] > 0, 'a poison victory should still pay out');
});

// --- Burn, the second status (roadmap item 13.4, docs/design-status-effects.md) ---

test('a spell of kind burn lands on a monster, and its own tick after its turn carries its own message', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'burn', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[2].kind = 'burn'; // Venom becomes this build's Burn spell
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0 }; // never hits back, so MON_HP moves only from the tick under test
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  // Venom/Burn is authored at level 2; grant it the way the level would.
  nes.cpu.mem[PC_SPELLS] |= 4;
  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4); // past Ember to Venom/Burn
  tap(nes, A, 6);
  tap(nes, A, 10);   // aim it at the slime
  assert.equal(nes.cpu.mem[MON_STATUS], STATUS_BURN, 'the slime should be burned, not poisoned');

  // Stall with RUN (a walked-into fight refuses it) until a tick lands.
  const startHp = nes.cpu.mem[MON_HP];
  let ticked = false;
  for (let round = 0; round < 30 && !ticked; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    ticked = nes.cpu.mem[MON_HP] !== startHp;
  }
  assert.ok(ticked, 'thirty rounds and burn never bit');
  assert.equal(startHp - nes.cpu.mem[MON_HP], BURN_DMG, "a burn tick should cost exactly BURN_DMG, not poison's own amount");
  assert.deepEqual(
    nametableRow(nes, MSG_ROW + 1, MSG_COL, 9),
    battleStringTiles('burned'),
    "the tick line on screen should be burn's own message, not poison's SUFFERS/poisoned"
  );
});

// This is the generalization's own reason for existing: the old single-bit
// bt_ptick mechanism could only ever raise one status line before advancing
// the turn, so it would fail this the moment a second status was live at
// once. Every assertion below checks RAM *and* the nametable at each step,
// not just the final HP -- a wrong dispatch order (burn before poison) or a
// dispatch that skips straight to advancing the turn would still land on the
// same total HP loss, and only checking each tick in sequence catches it.
test('a combatant poisoned and burned on its own turn takes both ticks, in order, as two separate messages, before the turn advances', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'dual-status', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // Never hits back, so PC_HP only ever moves from the ticks under test.
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0 };
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  nes.cpu.mem[PC_STATUS] = STATUS_POISON | STATUS_BURN;
  const actorAtStart = nes.cpu.mem[BT_ACTOR];
  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should ask who to hit');
  tap(nes, A, 5); // confirm the target -- the attack lands and its own line shows
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, "the attack's own line should be up");
  const startHp = nes.cpu.mem[PC_HP];

  tap(nes, A, 5); // dismiss the attack's own line -- poison should go first, lowest bit
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'a status tick should have raised its own line');
  assert.equal(startHp - nes.cpu.mem[PC_HP], POISON_DMG, "the first tick should be poison's own amount");
  assert.deepEqual(
    nametableRow(nes, MSG_ROW + 1, MSG_COL, 9),
    battleStringTiles('poisoned'),
    "the first tick line should be poison's own message"
  );

  tap(nes, A, 5); // dismiss the poison tick -- burn should follow, on the same turn
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the second status tick should have raised its own line');
  assert.equal(startHp - nes.cpu.mem[PC_HP], POISON_DMG + BURN_DMG, "the second tick should add burn's own amount, not repeat poison's");
  assert.deepEqual(
    nametableRow(nes, MSG_ROW + 1, MSG_COL, 9),
    battleStringTiles('burned'),
    "the second tick line should be burn's own message, not another poison line"
  );

  tap(nes, A, 5); // dismiss the burn tick -- nothing left to tick, so the turn should advance
  // Not "BT_PHASE !== BP_MESSAGE": the monster's own turn can raise its own
  // message (a miss, since acc: 0 above never lets it land a hit) the moment
  // it comes round, so BP_MESSAGE reappearing here is expected, not a third
  // status line. The turn actually advancing is what BT_ACTOR moving away
  // from the party member proves instead.
  assert.notEqual(nes.cpu.mem[BT_ACTOR], actorAtStart, 'with both ticks paid, the turn should move on to the next combatant');
  assert.equal(
    nes.cpu.mem[PC_STATUS],
    STATUS_POISON | STATUS_BURN,
    'a tick must not cure the status it just bit from -- only a heal or a potion does'
  );
});

// --- review finding 8: a dead monster ticked again decrements bt_count twice --

// Isolated call into apply_damage itself (via callRoutine/selectBattleBank),
// bypassing the whole turn engine on purpose: every real caller that can
// reach a monster combatant already screens for aliveness one way or another
// (cast_all's own combatant_alive_x, and -- once the sibling fix below is in
// place -- battle_status_dispatch's own check), so apply_damage_mon's own
// guard is unreachable through ordinary play. It still has to hold on its
// own terms, as the last line of defense the routine's own contract
// promises: an already-dead slot must see no store, no bt_count move, and no
// wipe, regardless of who or what calls it.
test('apply_damage does not touch an already-dead monster slot a second time', {
  skip: needsSample
}, async (t) => {
  const built = await buildVariantFull(t, 'apply-damage-guard', () => {});
  const addrOf = (label) => {
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const nes = bootPastNaming(built.romPath, 10);
  selectBattleBank(nes, built);
  const applyDamage = addrOf('apply_damage');

  // Slot 0 already dead, but left holding hp == the damage about to be
  // "applied" again -- exactly the shape a second status tick on the same
  // dead combatant produces (poison already having zeroed it, then burn
  // rolling in with its own amount). bt_count stands in for "three other
  // monsters are still alive", so a wrong second decrement is visible as a
  // wrong number, not merely a non-zero one.
  nes.cpu.mem[MON_ALIVE] = 0;
  nes.cpu.mem[MON_HP] = 5;
  nes.cpu.mem[BT_COUNT] = 3;
  nes.cpu.mem[BT_TARGET] = MAX_PARTY; // combatant index 4 == monster slot 0
  nes.cpu.mem[BT_DMG_LO] = 5;
  nes.cpu.mem[BT_DMG_HI] = 0;

  callRoutine(nes, applyDamage);

  assert.equal(nes.cpu.mem[BT_COUNT], 3, 'apply_damage must not decrement bt_count for a slot that was already dead');
  assert.equal(nes.cpu.mem[MON_HP], 5, 'an already-dead slot must not have its hp touched at all, let alone re-zeroed');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'an already-dead slot must stay dead');
});

// The full turn engine's own side of the same defect: two status bits ticking
// on the SAME combatant's SAME turn, the monster's own (party-vs-monster
// status ticks on a party member are already covered by the dual-status test
// above; this is the bt_count/mon_slot_alive half that test cannot reach).
// Every assertion checks the nametable as well as RAM, the same discipline
// the dual-status test uses, because a dispatch that silently skips straight
// to advancing the turn could look right on HP alone.
test('a monster poisoned and burned on its own turn dies once, not twice, and takes no tick once dead', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'monster-dual-status', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.party[0].baseHp = 200; // the slime's own ordinary attacks must not derail the stall loop
  });
  const nes = bootPastNaming(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);

  // Stall every party turn with RUN (a walked-into fight refuses it, so this
  // never actually flees) until the slime's own action message comes up --
  // that is the moment to poke its status and hp, before dismissing it.
  let round;
  for (round = 0; round < 60; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    if (nes.cpu.mem[BT_ACTOR] >= MAX_PARTY && nes.cpu.mem[BT_PHASE] === BP_MESSAGE) break;
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
  }
  assert.ok(nes.cpu.mem[BT_ACTOR] >= MAX_PARTY, 'sixty rounds and the slime never got its own turn');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, "the slime's own action line should be up");
  assert.equal(nes.cpu.mem[BT_COUNT], 1, 'only the one slime should still be standing going in');

  nes.cpu.mem[MON_STATUS] = STATUS_POISON | STATUS_BURN;
  nes.cpu.mem[MON_HP] = POISON_DMG; // exactly lethal on the poison tick alone

  tap(nes, A, 14); // dismiss the slime's own action line -- poison should fire and kill it
  assert.equal(nes.cpu.mem[BT_COUNT], 0, 'poison killing the slime should drop bt_count to zero, once');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'the slime should be dead');
  assert.equal(nes.cpu.mem[MON_HP], 0, "poison's own tick should have zeroed its hp");
  assert.deepEqual(
    nametableRow(nes, MSG_ROW + 1, MSG_COL, 9),
    battleStringTiles('poisoned'),
    "the first tick line should be poison's own message"
  );

  tap(nes, A, 14); // dismiss the poison tick -- burn must NOT get a second kill at the dead slime
  assert.equal(nes.cpu.mem[BT_COUNT], 0, 'bt_count must not move again once the slime is already dead -- no double decrement, no underflow to 255');
  assert.equal(nes.cpu.mem[MON_HP], 0, "a dead slime's hp must not move again either");
  assert.notDeepEqual(
    nametableRow(nes, MSG_ROW + 1, MSG_COL, 9),
    battleStringTiles('burned'),
    'a dead combatant must take no further tick this turn -- burn should never get its own line here'
  );

  const finalState = pressThrough(nes, 120);
  assert.equal(finalState, ST_GAMEPLAY, 'the battle must actually end in victory, not hang on a corrupted bt_count');
  assert.equal(nes.cpu.mem[BT_COUNT], 0, 'bt_count must stay at zero through to the end, never wrap to 255');
});

test('a heal spell cures both poison and burn at once', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);

  // Mend is authored at level 3, granted the way a level would.
  nes.cpu.mem[PC_SPELLS] |= 2;
  nes.cpu.mem[PC_HP] = 5;
  nes.cpu.mem[PC_MP] = 20;
  nes.cpu.mem[PC_STATUS] = STATUS_POISON | STATUS_BURN;

  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4); // Ember is first; Mend is the second row
  tap(nes, A, 6);    // choose it
  tap(nes, A, 10);   // confirm the target

  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'a heal should cure both poison and burn together, not just one bit');
});

test('a potion cures both poison and burn at once', {
  skip: needsSample
}, () => {
  const nes = bootPastNaming();
  nes.cpu.mem[INV_ITEMS] = 0;
  nes.cpu.mem[INV_COUNT] = 1;
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_HP] = 5;
  nes.cpu.mem[PC_STATUS] = STATUS_POISON | STATUS_BURN;

  chooseCommand(nes, BC_ITEM);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag');
  tap(nes, A, 10);

  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'a potion should flush both poison and burn out together, not just one bit');
});

test('winning a battle clears a status that fight leaves behind, not just one it never had', {
  skip: needsSample
}, async (t) => {
  // A one-hit-point slime dies to the first attack that lands, so the fight
  // stays short and deterministic regardless of how many extra poison-tick
  // messages the status under test adds to every party turn.
  const rom = await buildVariant(t, 'won-poisoned', (project) => {
    project.sprites.actors[0].hp = 1;
  });
  const nes = bootPastNaming(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  // Poisoned mid-fight, the same way a monster's own Venom would leave it --
  // battle_end is what is under test here, not how the status was acquired.
  nes.cpu.mem[PC_STATUS] = 1;

  let state = ST_BATTLE;
  for (let round = 0; round < 30 && state === ST_BATTLE; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    else tap(nes, A, 12);
    state = nes.cpu.mem[GAME_STATE];
  }
  assert.equal(state, ST_GAMEPLAY, 'the fight never ended');
  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'battle_end should clear a status a won fight leaves behind');
});

// --- an event starting a battle ----------------------------------------------

test('a Start a battle command suspends the script, and winning resumes it', {
  skip: needsSample
}, async (t) => {
  const VARIABLES = 0x500; // engine/constants.asm
  const rom = await buildVariant(t, 'scripted-battle', (project) => {
    // Only the scripted fight may start -- a random encounter on the way
    // would be indistinguishable from the answer.
    project.maps[0].encounters = { rate: 0, actorIds: [] };

    // An entry event on this screen, so battle_end re-arming it would show up.
    project.maps[0].screens[0].entities.push({
      actorId: 2, // Iris, who has nothing to do with the fight
      x: 96,
      y: 32,
      props: {
        trigger: 'enter',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
      }
    });

    // A boss: touching it starts a scripted fight against the Slime (actor
    // 0), and the command after it -- turning on a switch -- is the win
    // case, authored with no new vocabulary. Losing is not authored at all:
    // it is already a game over, from player_died.
    const bossId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: bossId,
      name: 'Boss Door',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: bossId,
      x: 176,
      y: 32,
      props: {
        trigger: 'touch',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'battle', monsters: [0] },
                { op: 'setSwitch', switch: 5 }
              ]
            }
          ]
        }
      }
    });
  });

  const nes = bootPastNaming(rom);
  const startScreen = nes.cpu.mem[FLAT_SCREEN];
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the entry event did not run when the game started');
  assert.equal(nes.cpu.mem[SWITCHES] & (1 << 5), 0, 'the boss switch should not already be on');

  walkTo(nes, 176, 32);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'touching the boss did not start the scripted fight');
  for (let i = 0; i < 12; i++) nes.frame(); // let battle_intro's own first tick settle in
  assert.equal(nes.cpu.mem[BT_COUNT], 1, 'the formation should hold exactly the one monster named');
  assert.equal(nes.cpu.mem[MON_SLOT_ACTOR], 0, "the formation should be the Slime, not the map's own encounter table");

  // Win it — the same way "FIGHT wears the monster down" does, since it is
  // the same lone Slime.
  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);

  // The event resumed at the command after the battle: the win case, with no
  // lose branch anywhere to author.
  assert.ok(nes.cpu.mem[SWITCHES] & (1 << 5), 'the script did not resume after winning');

  // The field is intact: the redraw that put the player back did not replay
  // this screen's entry event...
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the screen ran its entry event again when the battle ended');
  // ...it is still the screen the player was standing on...
  assert.equal(nes.cpu.mem[FLAT_SCREEN], startScreen, 'the battle left the player on a different screen');
  // ...and the trampoline restored the screen bank: the player can still
  // walk, which means mtptr is reading the map again, not the battle system.
  const before = nes.cpu.mem[PLAYER_X];
  walkTo(nes, before - 16, nes.cpu.mem[PLAYER_Y], 30);
  assert.ok(nes.cpu.mem[PLAYER_X] < before, 'the player cannot move after the scripted battle');
});

// battle_begin (this file) captures talk_ent into bt_owner_ent/bt_owner_rec
// and then unconditionally clears talk_ent to NO_ENTITY on the way into a
// fight -- correct for a random or contact-damage encounter, neither of
// which ever set it. battle_end's own owner loop restores ent_touched,x for
// the resolved slot but, before this fix, never put talk_ent back -- so a
// resumed script's own MOVE_SELF/talk_ent defense-in-depth check
// (script_op_move, script_op_turn -- see their own comments) read NO_ENTITY,
// mistook it for the real "nobody to be" case, and silently jmp
// script_finish'd: neither the Move/Turn nor anything after it on the page
// ran. Pre-existing on master for Move; Turn inherited it unmodified because
// it shares the identical defense-in-depth shape. Both are tested here
// because Move is the one that had been shipping silently broken -- an
// assertion that only checked the facing (or the position) would pass on a
// build that still drops every command after it, which is the actual
// symptom, so both the movement/facing effect AND the switch after it are
// asserted.
test('a Move self right after winning a scripted battle still runs, and so does the command after it', {
  skip: needsSample
}, async (t) => {
  let bossId;
  const rom = await buildVariant(t, 'battle-move-self', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    bossId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: bossId,
      name: 'Boss Door',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: bossId,
      x: 176,
      y: 32,
      props: {
        trigger: 'touch',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'battle', monsters: [0] },
                { op: 'move', who: 'self', dir: 'up', dist: 16 },
                { op: 'setSwitch', switch: 5 }
              ]
            }
          ]
        }
      }
    });
  });

  const nes = bootPastNaming(rom);
  walkTo(nes, 176, 32);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'touching the boss did not start the scripted fight');
  for (let i = 0; i < 12; i++) nes.frame();

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  // pressThrough only presses while game_state is ST_BATTLE, so it stops the
  // instant battle_end hands off -- which, correctly, is ST_DIALOG here (the
  // Move now suspends), not ST_GAMEPLAY yet. Settling further is what tells
  // "the script correctly resumed and is walking" apart from "the script
  // silently terminated" -- the bug this test exists for makes battle_end
  // land on ST_GAMEPLAY immediately, skipping the Move (and the suspend)
  // entirely, so asserting ST_GAMEPLAY right after pressThrough would have
  // passed on the *broken* build and failed on the fixed one.
  pressThrough(nes);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the conversation never finished settling');

  const bossSlot = findBossSlot(nes, bossId);
  assert.notEqual(bossSlot, -1, 'the boss should still be on the field after winning');
  // Y, not merely "X unchanged": an implementation that skips the Move
  // entirely and falls straight through to SetSwitch would also leave X at
  // 176 (nothing moved it sideways either way), so an X-only check cannot
  // tell "the Move ran and only touched Y, as authored" apart from "the Move
  // never ran at all." Y actually reaching 16 is the one value only a real,
  // executed Move up produces.
  assert.equal(
    nes.cpu.mem[ENT_Y + bossSlot],
    16,
    'the boss must have actually walked up 16px -- Move up changes Y from 32 to 16'
  );
  assert.equal(
    nes.cpu.mem[ENT_X + bossSlot],
    176,
    'the boss must not have silently moved sideways -- Move up only touches Y'
  );
  assert.ok(
    nes.cpu.mem[SWITCHES] & (1 << 5),
    'the command after the Move must still have run -- a silently terminated page would leave this off ' +
      'even though the boss itself is still standing right there'
  );
});

test('a Turn self right after winning a scripted battle still runs, and so does the command after it', {
  skip: needsSample
}, async (t) => {
  let bossId;
  const rom = await buildVariant(t, 'battle-turn-self', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    bossId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: bossId,
      name: 'Boss Door',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: bossId,
      x: 176,
      y: 32,
      props: {
        trigger: 'touch',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'battle', monsters: [0] },
                { op: 'turn', who: 'self', dir: 'up' },
                { op: 'setSwitch', switch: 5 }
              ]
            }
          ]
        }
      }
    });
  });

  const nes = bootPastNaming(rom);
  walkTo(nes, 176, 32);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'touching the boss did not start the scripted fight');
  for (let i = 0; i < 12; i++) nes.frame();

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  // Turn does not suspend, so unlike Move above, battle_end handing off
  // straight to ST_GAMEPLAY here is the correct outcome either way -- the
  // bug and the fix both leave state ST_GAMEPLAY, since script_finish is
  // where both the broken and the working path end up, just by different
  // routes. What actually distinguishes them is whether the facing and the
  // switch got set on the way, which the assertions below check.
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');

  const bossSlot = findBossSlot(nes, bossId);
  assert.notEqual(bossSlot, -1, 'the boss should still be on the field after winning');
  assert.equal(
    nes.cpu.mem[ENT_DIR + bossSlot],
    1 /* DIR_UP, engine/constants.asm */,
    'the Turn right after the battle must have set the boss’s facing'
  );
  assert.ok(
    nes.cpu.mem[SWITCHES] & (1 << 5),
    'the command after the Turn must still have run -- a silently terminated page would leave this off'
  );
});

test('winning does not re-arm the boss even when its own event reshuffles entity slots', {
  skip: needsSample
}, async (t) => {
  // The boss's own event hides an earlier actor before it battles, so the
  // redraw that follows victory spawns the boss into a *different* slot than
  // it held during the fight (the hidden actor no longer takes one ahead of
  // it). Restoring ent_touched by a slot index remembered before the fight
  // would put it back on whatever now sits in that slot instead of the boss
  // — and the boss's own slot, left clear, would read as a fresh touch and
  // arm the same event again. If battle_end is asking the field who the
  // player is standing on right now rather than trusting a stale index, the
  // reshuffle makes no difference and this passes; if it regresses to a
  // remembered index, the battle restarts forever.
  const HIDE_SWITCH = 7;
  let bossId;
  const rom = await buildVariant(t, 'scripted-battle-reshuffle', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };

    // An actor placed *before* the boss in the entity list, so hiding it
    // shifts every later actor — the boss included — down one slot.
    const earlyId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: earlyId,
      name: 'Early Bird',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: earlyId,
      x: 64,
      y: 32,
      props: { hideSwitch: HIDE_SWITCH }
    });

    // The boss: hides Early Bird, then fights. Both happen inside the one
    // conversation, so the shift is already decided by the time battle_begin
    // runs — it just is not applied until battle_end's own redraw.
    bossId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: bossId,
      name: 'Boss Door',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: bossId,
      x: 176,
      y: 32,
      props: {
        trigger: 'touch',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'setSwitch', switch: HIDE_SWITCH },
                { op: 'battle', monsters: [0] },
                { op: 'turn', who: 'self', dir: 'up' }
              ]
            }
          ]
        }
      }
    });
  });

  const nes = bootPastNaming(rom);

  walkTo(nes, 176, 32);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'touching the boss did not start the scripted fight');
  for (let i = 0; i < 12; i++) nes.frame(); // let battle_intro's own first tick settle in

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');

  // The boss should still be standing there, just no longer next to Early
  // Bird — which is what actually moves it into a different slot than it
  // fought in, since spawn_entities assigns slots by walking the entity
  // list in order and Early Bird no longer takes one ahead of it.
  const ENT_ACTIVE = 0x300;
  const ENT_ACTOR = 0x308;
  let bossSlot = -1;
  for (let slot = 0; slot < 8; slot++) {
    if (nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === bossId) bossSlot = slot;
  }
  assert.notEqual(bossSlot, -1, 'the boss should still be on the field after winning');

  // Give the field several frames to settle. A regression re-arms the boss's
  // event on the very next update_entities pass and never leaves ST_BATTLE
  // again; the fix leaves the world running.
  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the boss re-armed itself and the battle restarted');

  // The Turn after Battle is what actually exercises battle_end's own
  // resolve-by-record comment, not merely ent_touched -- restoring talk_ent
  // from the *pre-battle* bt_owner_ent (the boss's old slot, one higher than
  // its resolved slot now that Early Bird no longer takes one ahead of it)
  // would apply this Turn to whatever now sits in that stale slot instead of
  // the boss, and the boss's own facing would stay the boot default. Neither
  // the Move/Turn tests above nor the reshuffle itself, without this
  // follow-up command, can see that: both apply "self" to a slot that never
  // moved, and this is the one scenario where "self" and "the pre-battle
  // slot" name two different things.
  assert.equal(
    nes.cpu.mem[ENT_DIR + bossSlot],
    1 /* DIR_UP, engine/constants.asm */,
    'the Turn right after the battle must have set the boss’s own facing at its post-reshuffle slot, not ' +
      'whatever now sits in its stale pre-battle one'
  );
});

test('a random encounter that lands on a touch event does not suppress it', {
  skip: needsSample
}, async (t) => {
  const TOUCH_SWITCH = 6;
  const rom = await buildVariant(t, 'random-encounter-touch', (project) => {
    // Rate 3 rather than the usual "walk until it rolls": the player moves 2
    // pixels a frame and TOUCH_RANGE is 12, so the entity 16 pixels away
    // first reads as touched on the third moving frame -- the same frame
    // enc_step reaches a rate of 3. That is the exact interleaving the bug
    // depends on: check_encounter (inside update_player) freezes the world
    // before update_entities, later the same frame, ever gets to arm the
    // touch through settle_owed.
    project.maps[0].encounters = { rate: 3, actorIds: [0] };

    // A touch-triggered event with no damage of its own, so the only way
    // into it is entity_trigger_touch -- never entity_contact/touch_encounter.
    project.maps[0].screens[0].entities.push({
      actorId: 2, // Iris, who has nothing to do with the fight
      x: 128,
      y: 112,
      props: {
        trigger: 'touch',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: TOUCH_SWITCH }] }] }
      }
    });
  });

  const nes = bootPastNaming(rom);
  assert.equal(nes.cpu.mem[PLAYER_X], 112);
  assert.equal(nes.cpu.mem[PLAYER_Y], 112);

  walkTo(nes, 128, 112, 20);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'the random encounter never started');
  for (let i = 0; i < 12; i++) nes.frame(); // let battle_intro's own first tick settle in
  assert.equal(nes.cpu.mem[BT_COUNT], 1, 'the formation should hold exactly the one monster named');
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << TOUCH_SWITCH),
    0,
    'the touch event ran before the encounter could steal the frame -- the scenario never happened'
  );

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');

  // The touch was only ever armed, never run -- it must come back able to
  // fire, not latched shut the way a genuinely-run event should be. Give the
  // field a few frames to notice the player is still standing there.
  for (let i = 0; i < 30 && !(nes.cpu.mem[SWITCHES] & (1 << TOUCH_SWITCH)); i++) nes.frame();
  assert.ok(
    nes.cpu.mem[SWITCHES] & (1 << TOUCH_SWITCH),
    'the touch event never ran after the random encounter stole its frame'
  );
});

test("an entry event's own battle does not suppress an unrelated touch entity underfoot", {
  skip: needsSample
}, async (t) => {
  const ENTRY_SWITCH = 5;
  const BYSTANDER_SWITCH = 6;
  const rom = await buildVariant(t, 'entry-battle-bystander', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    const { startX, startY } = project.project;

    // The screen's own opening event: touching nothing, just arriving is
    // enough. Its battle freezes the world before update_entities has run
    // even once this screen, which is the exact interleaving this guards --
    // settle_owed dispatches an armed entry event before update_player/
    // update_entities ever run on the frame the screen is drawn.
    project.maps[0].screens[0].entities.push({
      actorId: 2, // Iris, who has nothing to do with either event
      x: 16,
      y: 16,
      props: {
        trigger: 'enter',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [
          { op: 'battle', monsters: [0] },
          { op: 'setSwitch', switch: ENTRY_SWITCH }
        ] }] }
      }
    });

    // A bystander the player already stands on at boot: a touch event wholly
    // unrelated to the entry event's own battle, and never scanned before
    // that battle steals the frame. Iris again -- no damage, so this is the
    // event/trigger path only, never entity_contact/touch_encounter's.
    project.maps[0].screens[0].entities.push({
      actorId: 2,
      x: startX,
      y: startY,
      props: {
        trigger: 'touch',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: BYSTANDER_SWITCH }] }] }
      }
    });
  });

  const nes = bootPastNaming(rom);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, "the entry event's battle never started");
  for (let i = 0; i < 12; i++) nes.frame(); // let battle_intro's own first tick settle in
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << BYSTANDER_SWITCH),
    0,
    'the bystander was never standing there to have run already -- the scenario never happened'
  );

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');
  assert.ok(nes.cpu.mem[SWITCHES] & (1 << ENTRY_SWITCH), "the entry event's own script did not resume after winning");

  // The bystander's touch was never armed, let alone run -- it must not come
  // back latched shut by a restore meant for the entry event's own actor.
  for (let i = 0; i < 30 && !(nes.cpu.mem[SWITCHES] & (1 << BYSTANDER_SWITCH)); i++) nes.frame();
  assert.ok(
    nes.cpu.mem[SWITCHES] & (1 << BYSTANDER_SWITCH),
    "the bystander's touch event never ran once the world resumed"
  );
});

// --- the namestride fix (handoff-namestride/brief-namestride.md) -----------
//
// name_offset_pc (engine/battle.asm) used to hand back an 8-bit offset a
// caller added to a name table's own label -- index * NAME_LEN computed with
// the carry discarded. NAME_LEN is 10, so index 26 produced 260, which
// wrapped to offset 4: four glyphs into the *next* entry's own name rather
// than the start of entry 26's. name_offset_pc now advances a 16-bit table
// pointer (ptr_lo/ptr_hi) in place instead.
//
// Both tests below read the nametable the ROM actually wrote, not engine RAM
// -- the bug is in what a consumer was told to point at, not in any table's
// own contents, so every RAM byte stays correct throughout and cannot see
// it. Each fixture is chosen so the wrapped, wrong read and the real, right
// one are obviously different strings -- never a name that is all spaces, a
// name shared between the two entries the wrap would blend, or an index
// whose wrapped offset happens to land on padding, any of which could pass
// by accident.
//
// Round 1 review, finding 2: an implementation that computes index*NAME_LEN
// correctly as a real 16-bit product, but then adds the product's low byte
// into ptr_lo and the product's high byte into ptr_hi as two *independent*
// additions (each with its own carry-clear) rather than chaining the carry
// from the first add into the second, is wrong exactly when
// LOW(table) + index*NAME_LEN >= 256 -- and passes everything else, since
// the missing carry is silently absorbed whenever that sum stays under 256.
// Both tests below therefore pick their low-index control to *also* force
// that carry, and assertForcesCarry proves it against the real address in
// this build's own game.fns before checking a single glyph -- a fixture
// that merely assumes the carry happens is exactly the vacuous-pass trap
// the coder's own round-0 report already named for a different case.

/**
 * Reads `label`'s address out of this build's own game.fns (never hardcoded
 * -- a filler count or an engine edit can move where a table lands) and
 * asserts that reading entry `index` of a `stride`-byte-wide table based
 * there genuinely requires a carry out of the low byte:
 * LOW(base) + index*stride >= 256. Without this, a fixture that merely looks
 * plausible could stop forcing the carry the moment something upstream
 * moves the table, and go silently vacuous.
 */
function assertForcesCarry(symbolPath, label, index, stride) {
  const symbols = parseSymbolFile(fs.readFileSync(symbolPath, 'utf8'));
  const base = symbols[label];
  assert.equal(typeof base, 'number', `${label} should be a named symbol in this build's game.fns`);
  const lowSum = (base & 0xff) + index * stride;
  assert.ok(
    lowSum >= 256,
    `this fixture does not force a carry out of ptr_lo: LOW(${label})=${base & 0xff} (from $${base.toString(16)}) ` +
      `+ ${index}*${stride} = ${lowSum}, under 256 -- pick a different index`
  );
}

test(
  'a monster at actor id 26 draws its own name when it attacks, and a low-index monster (one that also forces a ' +
    'carry out of ptr_lo) in the same fight still draws correctly',
  { skip: needsSample },
  async (t) => {
    const built = await buildVariantFull(t, 'namestride-monster', (project) => {
      project.maps[0].encounters = { rate: 0, actorIds: [] };
      padActorsTo(project, 26);
      const template = structuredClone(project.sprites.actors[0]);
      // Actor 23: needs to land LOW(mon_name) + 23*NAME_LEN(10) >= 256 in
      // *this* build (this project's own extra actors and entities move
      // mon_name from the stock build's address -- 23 is chosen against
      // this variant's own real address, asserted below, not the stock
      // figure) -- this index needs the carry a plausible-but-wrong
      // implementation could still drop (finding 2), and it stays under 26
      // so it also still proves the low-index case the round-0 brief
      // required.
      project.sprites.actors[23] = {
        ...template,
        id: 23,
        name: 'IMP23',
        damage: 1,
        hp: 40,
        battle: { ...template.battle, speed: 150, acc: 255, eva: 0 }
      };
      // Actor 26 is the round-0 wrap: 26 * NAME_LEN(10) = 260, and the
      // discarded carry left the old 8-bit routine at offset 4 -- four
      // glyphs into actor 0's own name ("Slime"). Very high speed and
      // accuracy so it reliably gets an early, message-producing turn
      // without depending on a roll.
      project.sprites.actors.push({
        ...template,
        id: 26,
        name: 'GHOUL',
        damage: 1,
        hp: 60,
        battle: { ...template.battle, speed: 250, acc: 255, eva: 0 }
      });
      project.maps[0].screens[0].entities.push({
        actorId: 26,
        x: 112,
        y: 144,
        props: { name: '', toScreen: 0, toX: 112, toY: 112, dialogue: '', event: null, trigger: 'interact', hideSwitch: null }
      });
    });

    assertForcesCarry(built.symbolPath, 'mon_name', 23, NAME_LIMIT);

    const nes = bootPastNaming(built.romPath);
    walkTo(nes, 112, 144, 200);
    for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into actor 26 did not start a fight');

    // The one-frame formation-edit window the twomon test above also uses:
    // battle_begin runs mid-frame and the intro tick runs on the next one, so
    // there is exactly one frame left in which a second monster can still be
    // seated. Actor 23 (well under the wrap, and asserted above to force the
    // carry) is the low-index control this same battle now also proves.
    assert.equal(nes.cpu.mem[BT_PHASE], BP_INTRO, 'the intro already ran');
    nes.cpu.mem[MON_SLOT_ACTOR + 1] = 23;
    for (let i = 0; i < 12; i++) nes.frame();
    assert.equal(nes.cpu.mem[BT_COUNT], 2, 'the second monster was not seated');
    assert.equal(nes.cpu.mem[MON_ALIVE + 1], 1);

    const seen = {};
    for (let round = 0; round < 200 && Object.keys(seen).length < 2; round++) {
      const phase = nes.cpu.mem[BT_PHASE];
      if (phase === BP_MENU) {
        chooseCommand(nes, BC_FIGHT);
        tap(nes, A, 20); // confirm whichever target is highlighted -- who gets hit is not this test's question
        continue;
      }
      if (phase === BP_MESSAGE) {
        const actor = nes.cpu.mem[BT_ACTOR];
        if (actor >= MAX_PARTY && !(actor in seen)) {
          for (let i = 0; i < 4; i++) nes.frame(); // the queued packet drains on the next vblank
          seen[actor] = nametableRow(nes, MSG_ROW, MSG_COL, NAME_LIMIT);
        }
        tap(nes, A, 10);
        continue;
      }
      nes.frame();
    }

    assert.equal(
      Object.keys(seen).length,
      2,
      'both monsters never got a message-naming turn -- combatant indices seen: ' + Object.keys(seen).join(',')
    );
    assert.deepEqual(
      seen[4],
      nameTiles('GHOUL'),
      'actor 26 must draw its own name -- a wrong implementation would draw "e     Poti" here instead ' +
        '(actor 0\'s own chars 4-9, "Slime" padded, followed by actor 1\'s chars 0-3, "Poti" from "Potion")'
    );
    assert.deepEqual(
      seen[5],
      nameTiles('IMP23'),
      'the low-index, carry-forcing control (actor 23) must still draw correctly in the same battle -- an ' +
        'implementation that drops the carry from ptr_lo into ptr_hi would draw from 256 bytes before the ' +
        'correct address here instead'
    );
  }
);

test(
  'an item at id 26 draws its own name in the battle ITEM list, and a low-index item in the same bag still draws correctly',
  { skip: needsSample },
  async (t) => {
    const built = await buildVariantFull(t, 'namestride-item', (project) => {
      // sample-rpg's own Potion is item id 0 (migrated from actor 1's heal
      // stat on load); left in the project but not put in the bag here --
      // item 14 is this build's low-index control instead, chosen (like
      // actor 18 above) to also force a carry out of ptr_lo: LOW(item_name)
      // in the stock build is $78 (120), and 120 + 14*NAME_LEN(10) = 260 >=
      // 256 (finding 2). Verified against this build's own real address
      // below, not assumed from the stock figure. Fillers 1..13 and 15..25
      // land item 26 at the round-0 wrap: 26 * NAME_LEN(10) = 260, offset 4
      // -- four glyphs into item 0's own name ("Potion").
      for (let id = project.items.length; id < 26; id++) {
        if (id === 14) {
          project.items.push({ id, name: 'GEM14', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 5 } });
        } else {
          project.items.push({ id, name: `I${id}`, actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 1 } });
        }
      }
      project.items.push({
        id: 26,
        name: 'ELIXIR26',
        actorId: null,
        metaspriteId: null,
        effect: { kind: 'heal', amount: 30 }
      });
    });

    assertForcesCarry(built.symbolPath, 'item_name', 14, NAME_LIMIT);

    const nes = bootPastNaming(built.romPath);
    nes.cpu.mem[INV_ITEMS] = 14; // GEM14 -- the low-index, carry-forcing control
    nes.cpu.mem[INV_ITEMS + 1] = 26; // the round-0 wrap
    nes.cpu.mem[INV_COUNT] = 2;
    assert.ok(walkIntoEncounter(nes));
    waitForMenu(nes);
    chooseCommand(nes, BC_ITEM);
    assert.equal(nes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag');
    assert.equal(nes.cpu.mem[BT_LEN], 2, 'both items should be listed -- build_item_list admits both (kind heal, amount > 0)');
    for (let i = 0; i < 4; i++) nes.frame(); // the queued rows drain on the next vblank

    assert.deepEqual(
      nametableRow(nes, MSG_ROW, MSG_COL, NAME_LIMIT),
      nameTiles('GEM14'),
      'the low-index, carry-forcing control (item 14) must still draw correctly in the same list -- an ' +
        'implementation that drops the carry from ptr_lo into ptr_hi would draw from 256 bytes before the ' +
        'correct address here instead'
    );
    assert.deepEqual(
      nametableRow(nes, MSG_ROW + 1, MSG_COL, NAME_LIMIT),
      nameTiles('ELIXIR26'),
      'item 26 must draw its own name -- a wrong implementation would draw "on    I1  " here instead ' +
        '(item 0\'s own chars 4-9, "Potion" padded, followed by item 1\'s chars 0-3, "I1  ")'
    );
  }
);

// ---------------------------------------------------------------------------
// Battle-side animation (docs/design-battle-animation.md v4.1, phase 1b).
// The reference-integrity half (isValidAnimationRef, isPlayableBattleAnimation,
// validateProject's refusals) is JS-only and tested in project.test.js; this
// section is the engine mechanism itself, driven through the real ROM.
// ---------------------------------------------------------------------------

/** Resolve the four bt_fx_* zero-page bytes out of a build's own constants.asm. */
function resolveFxAddrs(built) {
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  return {
    BT_FX_ANIM: resolveEngineAddress(constantsText, 'bt_fx_anim'),
    BT_FX_SLOT: resolveEngineAddress(constantsText, 'bt_fx_slot'),
    BT_FX_FRAME: resolveEngineAddress(constantsText, 'bt_fx_frame'),
    BT_FX_TIMER: resolveEngineAddress(constantsText, 'bt_fx_timer')
  };
}

const NO_ANIM = 0xff;

test('a monster’s own physical attack arms its attackAnim before roll_hit runs, whether the roll then hits or misses', {
  skip: needsSample
}, async (t) => {
  // Slime (actor 0) never casts (no spellIds), so monster_turn always falls
  // through to monster_turn_attack -- the real, only physical-attack path
  // for a monster (round 2's own finding, Appendix A's attack_target comment).
  const built = await buildVariantFull(t, 'fx-monster-attack', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: 1 }; // "Slime" animation
  });
  const { BT_FX_ANIM, BT_FX_SLOT } = resolveFxAddrs(built);
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const monsterTurnAttack = addrOf('monster_turn_attack');

  // Isolated call: bt_actor names the acting monster (slot 4, the first
  // monster combatant), mon_slot_actor[0] maps that slot to Slime's own
  // actor id, and pc_in_party[0]/pc_hp[0] give pick_party_target a live
  // target to land on -- all of it plain RAM, poke-able directly, unlike
  // the compiled mon_acc/pc_eva tables roll_hit itself reads.
  const setup = () => {
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY; // slot 4
    nes.cpu.mem[MON_SLOT_ACTOR] = 0; // Slime
    nes.cpu.mem[PC_IN_PARTY] = 1;
    nes.cpu.mem[PC_HP] = 50;
    nes.cpu.mem[BT_FX_ANIM] = NO_ANIM;
  };

  // Case 1: sample-rpg's own default acc/eva -- rig the RNG so the very
  // next roll_hit call is a genuine hit (referenceRngNext(0) is small, well
  // under the sample's own threshold).
  setup();
  nes.cpu.mem[RNG] = 0;
  callRoutine(nes, monsterTurnAttack);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], 1, 'the attack visual must be armed on a hit');
  assert.equal(nes.cpu.mem[BT_FX_SLOT], MAX_PARTY, 'armed over the ACTOR’s own slot (the swing), not the target’s');
  assert.notEqual(nes.cpu.mem[BT_DMG_HI], 0xff, 'sanity: this roll must actually have been a hit');

  // Case 2: a forced miss -- Slime's own acc set to 0 underflows against any
  // eva, roll_hit's own unconditional bcc branch, no RNG dependency at all.
  const missBuilt = await buildVariantFull(t, 'fx-monster-miss', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: 1, acc: 0 };
  });
  const missAddrs = resolveFxAddrs(missBuilt);
  const missNes = bootPastNaming(missBuilt.romPath);
  const missAddrOf = selectBattleBank(missNes, missBuilt);
  missNes.cpu.mem[BT_ACTOR] = MAX_PARTY;
  missNes.cpu.mem[MON_SLOT_ACTOR] = 0;
  missNes.cpu.mem[PC_IN_PARTY] = 1;
  missNes.cpu.mem[PC_HP] = 50;
  missNes.cpu.mem[missAddrs.BT_FX_ANIM] = NO_ANIM;
  callRoutine(missNes, missAddrOf('monster_turn_attack'));
  assert.equal(missNes.cpu.mem[missAddrs.BT_FX_ANIM], 1, 'the attack visual must be armed on a forced miss too');
  assert.equal(missNes.cpu.mem[missAddrs.BT_FX_SLOT], MAX_PARTY, 'still armed over the actor’s own slot on a miss');
  assert.equal(missNes.cpu.mem[BT_DMG_HI], 0xff, 'sanity: this roll must actually have missed');
});

// Review round 1, P2 finding 2 / round 2 P2 finding 1: setup_monsters' own
// clear (engine/battle.asm) is what stops a running effect from leaking
// from one battle into the next -- not merely the identical clear
// battle_message_done already performs on every message dismissal,
// including a battle's own closing Victory/Defeat/Fled line, and not merely
// the OTHER two guards this design has (battle_fx_tick/battle_fx_draw's own
// BP_INTRO checks, proven separately below). Proving the LIFECYCLE property
// means leaving a long effect genuinely "running" at the moment the second
// battle's own intro starts, in the same emulator, with no reboot and no
// hand-clearing of the FX bytes in between -- so the state is deliberately
// RE-ARMED right after the first battle's own Victory message has already
// dismissed (and, with it, already cleared bt_fx_anim through the ordinary
// message path), which is what makes this test fail on a REMOVED
// setup_monsters clear specifically, rather than passing vacuously because
// nothing was ever "running" to begin with.
//
// Round 2's own correction: the seed must be a REAL, legitimately
// mid-flight state in an animation that actually has that many frames and
// that long a hold -- not frame 3 of a one-frame, duration-16 animation,
// which a broken intro guard could dereference past the end of without ever
// proving anything about the guard itself. This test also now checks that
// the seed survives on the field side, right up to the moment BP_INTRO is
// reached (before the battle bank's own first tick has run at all) -- a
// stronger claim than "bt_fx_anim reads NO_ANIM once intro is over," which
// alone cannot tell "setup's own clear ran" apart from "something on the
// field side already stepped on it first."
//
// What this test does NOT attempt: pausing mid-BP_INTRO to call
// battle_fx_tick/battle_fx_draw in isolation and then resuming real
// frame-stepping on the SAME emulator afterward. That was tried and
// reproducibly crashes jsnes ("invalid opcode at address $808") even with
// nothing more than a single isolated switch_prg_bank call in between --
// narrowed by disabling first the tick/draw calls (resuming worked), then
// selectBattleBank alone (still crashed), which places the fault in
// resuming normal frame-stepping after ANY callRoutine-driven excursion at
// this exact point, not in this test's own bt_fx_* logic. The next test,
// `battle_fx_tick and battle_fx_draw's own BP_INTRO guards leave a
// mid-flight effect and OAM entirely untouched`, proves the same two guards
// with a dedicated, fully isolated harness (fresh nes, never resumed)
// instead -- exactly the fallback the review itself named ("an isolated
// callRoutine ... is acceptable").
test('a long effect deliberately re-armed after one battle ends is cleared by the NEXT battle’s own setup, not by leftover message-dismissal state', {
  skip: needsSample
}, async (t) => {
  const longAnimId = 3; // pushed below -- a real, multi-frame, long-duration animation
  const SEED_SLOT = 1; // a slot the second battle will never itself use for combatant 4
  const SEED_FRAME = 1; // the middle of three frames -- neither just-armed nor about to finish
  const SEED_TIMER = 50; // well under this frame's own 200-tick hold
  const built = await buildVariantFull(t, 'fx-stale-across-battles', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.animations.push({
      id: longAnimId,
      name: 'LongRunning',
      loop: false,
      frames: [
        { metaspriteId: 1, duration: 200 },
        { metaspriteId: 1, duration: 200 },
        { metaspriteId: 1, duration: 200 }
      ]
    });
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: longAnimId };
  });
  const { BT_FX_ANIM, BT_FX_SLOT, BT_FX_FRAME, BT_FX_TIMER } = resolveFxAddrs(built);
  const nes = bootPastNaming(built.romPath);

  // First battle: Slime, the deterministic touch encounter, won in one hit.
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 1; // guaranteed one-hit kill, whether the attack lands this round or a later one
  let rounds = 0;
  while (nes.cpu.mem[GAME_STATE] === ST_BATTLE && nes.cpu.mem[MON_ALIVE] === 1 && rounds++ < 12) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  const firstBattleOutcome = pressThrough(nes, 60);
  assert.equal(firstBattleOutcome, ST_GAMEPLAY, 'the first battle never actually ended');

  // By now, battle_message_done's own unconditional clear has already run
  // at least once (the Victory line's own dismissal) -- confirmed, not
  // assumed, so the deliberate re-arm just below is proven necessary rather
  // than redundant.
  assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'sanity: the message-dismissal clear already ran once, ending the first battle’s own effect');

  // Deliberately re-seed a "still running" effect AFTER the first battle is
  // over -- nothing in ordinary gameplay does this; it exists purely so the
  // next assertions are testing the SECOND battle's own setup clear, not
  // merely observing the message clear a second time.
  nes.cpu.mem[BT_FX_ANIM] = longAnimId;
  nes.cpu.mem[BT_FX_SLOT] = SEED_SLOT;
  nes.cpu.mem[BT_FX_FRAME] = SEED_FRAME;
  nes.cpu.mem[BT_FX_TIMER] = SEED_TIMER;

  // Second battle, same emulator, no reboot: Snake's own touch encounter.
  walkTo(nes, 32, 176);
  walkTo(nes, 32, 208, 300);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the snake did not start the second fight');

  // The field side sets game_state (and bt_phase, fresh, to BP_INTRO) before
  // the battle bank's own first tick ever runs -- so the very first
  // observable frame of the second battle IS BP_INTRO, and the seeded state
  // must still be exactly what this test put there: nothing on the field
  // side has any business touching bt_fx_*.
  assert.equal(nes.cpu.mem[BT_PHASE], BP_INTRO, 'the second battle must begin at BP_INTRO, before its own first tick has run');
  assert.equal(nes.cpu.mem[BT_FX_ANIM], longAnimId, 'the seeded state must survive on the field side, before BP_INTRO’s own first tick');
  assert.equal(nes.cpu.mem[BT_FX_FRAME], SEED_FRAME, 'the seeded frame must survive on the field side');
  assert.equal(nes.cpu.mem[BT_FX_TIMER], SEED_TIMER, 'the seeded timer must survive on the field side');

  // Now let the real intro/setup actually run.
  for (let i = 0; i < 30 && nes.cpu.mem[BT_PHASE] === BP_INTRO; i++) nes.frame();
  assert.notEqual(nes.cpu.mem[BT_PHASE], BP_INTRO, 'the second battle’s own intro never finished');

  // The running effect this test re-seeded must be gone: setup_monsters'
  // own clear is what actually does this. Removing setup_monsters' own
  // clear leaves bt_fx_anim exactly at longAnimId here, which is the
  // sabotage this assertion exists to catch.
  assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'setup_monsters must clear bt_fx_anim to $FF for the second battle -- a re-armed effect from the first must not survive into it');

  waitForMenu(nes);
  // The second battle's own first menu/draw: still no trace of the old
  // effect, several ticks in, not merely on the one tick this test could
  // otherwise have gotten lucky on.
  for (let i = 0; i < 5; i++) {
    nes.frame();
    assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'the second battle’s own first menu/draw must show no trace of the first battle’s effect');
  }
});

// Review round 2, P2 finding 1's own fallback, taken: battle_fx_tick's and
// battle_fx_draw's own BP_INTRO guards, proven directly with a dedicated,
// fully isolated harness -- a fresh boot, bt_phase forced to BP_INTRO by
// hand, and a REAL, valid mid-flight seed (the identical 3-frame,
// duration-200 animation and frame/timer values the lifecycle test above
// uses), rather than resumed inside that same lifecycle sequence (see that
// test's own comment for why: resuming real frame-stepping after a
// callRoutine excursion at this exact point reproducibly crashes jsnes,
// unrelated to anything this design added). This is what actually
// distinguishes "the guard blocked it" from "setup's later clear cleaned up
// after it ran," which the lifecycle test's own bt_fx_anim-after-intro
// assertion cannot do on its own.
test('battle_fx_tick and battle_fx_draw’s own BP_INTRO guards leave a mid-flight effect and OAM entirely untouched', {
  skip: needsSample
}, async (t) => {
  const longAnimId = 3;
  const SEED_SLOT = 1;
  const SEED_FRAME = 1;
  const SEED_TIMER = 50;
  const built = await buildVariantFull(t, 'fx-intro-guards', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.animations.push({
      id: longAnimId,
      name: 'LongRunning',
      loop: false,
      frames: [
        { metaspriteId: 1, duration: 200 },
        { metaspriteId: 1, duration: 200 },
        { metaspriteId: 1, duration: 200 }
      ]
    });
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: longAnimId };
  });
  const { BT_FX_ANIM, BT_FX_SLOT, BT_FX_FRAME, BT_FX_TIMER } = resolveFxAddrs(built);
  const dir = path.dirname(path.dirname(built.romPath));
  const OAM_IDX = resolveEngineAddress(fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8'), 'oam_idx');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);

  nes.cpu.mem[BT_PHASE] = BP_INTRO;
  nes.cpu.mem[BT_FX_ANIM] = longAnimId;
  nes.cpu.mem[BT_FX_SLOT] = SEED_SLOT;
  nes.cpu.mem[BT_FX_FRAME] = SEED_FRAME;
  nes.cpu.mem[BT_FX_TIMER] = SEED_TIMER;

  callRoutine(nes, addrOf('battle_fx_tick'));
  assert.equal(nes.cpu.mem[BT_FX_ANIM], longAnimId, 'battle_fx_tick’s own BP_INTRO guard must not end the effect either');
  assert.equal(nes.cpu.mem[BT_FX_SLOT], SEED_SLOT, 'battle_fx_tick’s own BP_INTRO guard must leave the seeded slot untouched');
  assert.equal(nes.cpu.mem[BT_FX_FRAME], SEED_FRAME, 'battle_fx_tick’s own BP_INTRO guard must leave the seeded frame untouched');
  assert.equal(nes.cpu.mem[BT_FX_TIMER], SEED_TIMER, 'battle_fx_tick’s own BP_INTRO guard must leave the seeded timer untouched');

  nes.cpu.mem.fill(0xff, 0x200, 0x300); // battle_sprite_clear's own park step, done by hand for this isolated call
  nes.cpu.mem[OAM_IDX] = 0;
  callRoutine(nes, addrOf('battle_fx_draw'));
  assert.equal(nes.cpu.mem[OAM_IDX], 0, 'battle_fx_draw’s own BP_INTRO guard must draw nothing at all');
  assert.deepEqual([...nes.cpu.mem.slice(0x200, 0x300)], new Array(0x100).fill(0xff), 'battle_fx_draw’s own BP_INTRO guard must leave the entire OAM shadow parked, not merely its first byte');
  assert.equal(nes.cpu.mem[BT_FX_ANIM], longAnimId, 'battle_fx_draw’s own BP_INTRO guard must not end the effect either');
  assert.equal(nes.cpu.mem[BT_FX_SLOT], SEED_SLOT, 'battle_fx_draw’s own BP_INTRO guard must leave the seeded slot untouched');
  assert.equal(nes.cpu.mem[BT_FX_FRAME], SEED_FRAME, 'battle_fx_draw’s own BP_INTRO guard must leave the seeded frame untouched');
  assert.equal(nes.cpu.mem[BT_FX_TIMER], SEED_TIMER, 'battle_fx_draw’s own BP_INTRO guard must leave the seeded timer untouched');
});

// cast_spell's own arming block (docs/design-battle-animation.md §3.3): a
// monster caster (bt_actor = MAX_PARTY, Slime, attackAnim authored) and a
// second monster caster (Snake, attackAnim explicitly null) casting eight
// spells that between them cover every branch the review round 1 asked
// for: attack-anim fallback, spell-only (no fallback to have won against),
// "both" (the spell's own anim winning over a real fallback) for a
// single-target damage AND a single-target status spell (both target the
// victim), a heal and an all-target spell (both target the caster), the
// party "neither" no-op (battle_fx_arm_attack's own unconditional `bcc
// rts`), and the MONSTER "neither" no-op (mon_anim_attack itself is
// NO_ANIM, battle_fx_arm_at's own `cmp NO_ANIM / beq rts` -- a genuinely
// different no-op path the party case cannot exercise).
//
// Review round 1, P2 finding 3 / round 2 P3 finding 3 / round 3 wording nit:
// cases 1, 2, 4, 5 and 8 each give their own spell and the spell at its
// "accidental index" (whatever id the arming block's own `tax` calls leave
// in X if the `ldx <bt_arg` reload were missing on that specific branch)
// DIFFERENT kinds (not merely amounts -- round 2's own correction, see
// below), so a reload missing on the branch each exercises is caught by
// kind, not just amount. Case 3 is not one of these: Case 3 uses spell index
// 2 and animation id 2, so its intended and accidental dispatch indices
// coincide. A missing reload there would coincidentally still read
// StatusTarget's own kind, and case 3 exists to prove the "both" precedence
// rule instead (see its own comment below), not reload integrity. Every
// assertion below checks the exact resulting HP/status regardless, not
// merely that something changed:
//  - Case 1 (AttackFallback, bt_arg=0) arms through battle_fx_arm_attack,
//    which ends with X = FALLBACK_ANIM (3) -- a real, valid spell index
//    (HealCaster, kind 'heal'). Round 2 found that an earlier version of
//    this fixture aliased FALLBACK_ANIM to SpellWins's own index (1)
//    instead, and gave the two the SAME kind and scope ('damage'/'one'),
//    differing only in amount -- but `spell_damage` (engine/battleturn.asm)
//    reloads X from bt_arg itself before rolling the amount, so a reload
//    missing only on the fallback branch still dealt AttackFallback's own
//    correct 30 regardless: the kind dispatch (which reads spell_kind,x
//    with the STILL-corrupted X) took the identical 'damage'/'one' branch
//    either way, and the amount roll's own reload masked the rest. Aliasing
//    HealCaster instead means a reload missing here sends the dispatch into
//    the SK_HEAL branch entirely -- healing the caster instead of damaging
//    the target -- which no inner reload can mask.
//  - Cases 2, 4, 5 (SpellWins/HealCaster/AllCaster) all share `anim:
//    SPELL_ANIM` (2, StatusTarget's own index, kind 'poison'). Arming
//    through battle_fx_arm_at ends with X = SPELL_ANIM. A reload missing
//    only after the spell-anim branch would read spell 2's own kind
//    ('poison') for every one of these three instead of their own (damage/
//    heal/damage), so none of their real, distinct, exact effects would
//    land, and PC_STATUS would incorrectly show POISON instead.
//  - Case 8 (MonsterNeither, bt_arg=7, Snake) independently exercises the
//    identical fallback-branch reload, aliasing HealCaster (3) the same
//    way as case 1 now does, by coincidence of X's own value after
//    battle_fx_arm_attack's "no attackAnim, no-op" path -- round 2's review
//    identified this as the case that actually caught the round-1 sabotage
//    result, before case 1 itself was fixed to also distinguish it.
//
// Run twice, under both spell-list gates (MONSTER_SPELL_LIST_ENABLED on and
// off): cast_spell's own animation-arming block sits outside
// `.if MONSTER_SPELL_LIST_ENABLED` entirely, so nothing here should ever
// differ between the two builds -- a fallback reading the wrong field, or a
// test that only ever exercised one gate, is what this doubling catches.
for (const spellListOn of [true, false]) {
  test(`cast_spell animation precedence, target-vs-caster policy, and post-arm dispatch integrity -- MONSTER_SPELL_LIST_ENABLED ${spellListOn ? 'on' : 'off'}`, {
    skip: needsSample
  }, async (t) => {
    const SPELL_ANIM = 2; // "Potion" -- also StatusTarget's own real index (2)
    const SPELL_ONLY_ANIM = 3; // pushed below -- a real animation, also HealCaster's own real spell index (3)
    // Slime's own attackAnim -- deliberately the SAME real animation id as
    // SPELL_ONLY_ANIM (3), which is what makes X = 3 (HealCaster, kind
    // 'heal') the accidental spell index if the fallback branch's own
    // reload were missing (see the header comment above for why this must
    // be a different KIND from AttackFallback's own 'damage', not merely a
    // different amount).
    const FALLBACK_ANIM = SPELL_ONLY_ANIM;
    const built = await buildVariantFull(t, `fx-cast-precedence-${spellListOn ? 'on' : 'off'}`, (project) => {
      project.maps[0].encounters = { rate: 0, actorIds: [] };
      project.sprites.animations.push({ id: SPELL_ONLY_ANIM, name: 'SpellOnly', loop: false, frames: [{ metaspriteId: 1, duration: 8 }] });
      project.spells = [
        { ...createSpell(0, 'AttackFallback'), kind: 'damage', scope: 'one', amountMin: 30, amountMax: 30, anim: null },
        { ...createSpell(1, 'SpellWins'), kind: 'damage', scope: 'one', amountMin: 50, amountMax: 50, anim: SPELL_ANIM },
        { ...createSpell(2, 'StatusTarget'), kind: 'poison', scope: 'one', anim: SPELL_ANIM },
        { ...createSpell(3, 'HealCaster'), kind: 'heal', scope: 'one', amountMin: 5, amountMax: 5, anim: SPELL_ANIM },
        { ...createSpell(4, 'AllCaster'), kind: 'damage', scope: 'all', amountMin: 20, amountMax: 20, anim: SPELL_ANIM },
        { ...createSpell(5, 'Neither'), kind: 'damage', scope: 'one', amountMin: 40, amountMax: 40, anim: null },
        { ...createSpell(6, 'SpellOnly'), kind: 'damage', scope: 'one', amountMin: 75, amountMax: 75, anim: SPELL_ONLY_ANIM },
        { ...createSpell(7, 'MonsterNeither'), kind: 'damage', scope: 'one', amountMin: 60, amountMax: 60, anim: null }
      ];
      project.sprites.actors[0].battle = {
        ...project.sprites.actors[0].battle,
        attackAnim: FALLBACK_ANIM,
        spellIds: spellListOn ? [0, 1] : [0]
      };
      // Snake (actor 3): a second monster with NO attackAnim of its own,
      // for the spell-only and monster-neither cases -- Slime's own
      // attackAnim is always real, so every case above it would still pass
      // even if battle_fx_arm_attack's own mon_anim_attack == NO_ANIM path
      // (as opposed to the party's unconditional bt_actor < MAX_PARTY path)
      // were broken.
      project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, attackAnim: null };
    });
    const { BT_FX_ANIM, BT_FX_SLOT } = resolveFxAddrs(built);
    const nes = bootPastNaming(built.romPath);
    const addrOf = selectBattleBank(nes, built);
    const castSpell = addrOf('cast_spell');

    const reset = (actorId = 0) => {
      nes.cpu.mem[MON_SLOT_ACTOR] = actorId; // monster slot 0 (combatant 4)
      nes.cpu.mem[PC_IN_PARTY] = 1;
      nes.cpu.mem[PC_HP] = 200;
      nes.cpu.mem[PC_STATUS] = 0;
      nes.cpu.mem[MON_HP] = 200;
      nes.cpu.mem[MON_SLOT_MAX] = 253;
      nes.cpu.mem[MON_ALIVE] = 1;
      nes.cpu.mem[MON_STATUS] = 0;
      nes.cpu.mem[BT_FX_ANIM] = NO_ANIM;
    };

    // Case 1: attack-anim fallback, target for a single-target damage spell.
    // Accidental index if the reload is missing only on this branch: 3
    // (HealCaster, kind 'heal') -- a different KIND, not merely a different
    // amount (round 2's own correction: spell_damage reloads X from bt_arg
    // itself before rolling the amount, so two same-kind spells differing
    // only in amount cannot distinguish this branch -- see the header
    // comment above).
    reset();
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY;
    nes.cpu.mem[BT_TARGET] = 0;
    nes.cpu.mem[MON_HP] = 200;
    nes.cpu.mem[BT_ARG] = 0; // AttackFallback
    callRoutine(nes, castSpell);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], FALLBACK_ANIM, 'AttackFallback: no spell.anim authored -- must fall back to the caster’s own attackAnim');
    assert.equal(nes.cpu.mem[BT_FX_SLOT], MAX_PARTY, 'the fallback always plays over the caster’s own slot');
    assert.equal(nes.cpu.mem[PC_HP], 200 - 30, 'AttackFallback must deal exactly its own 30 damage to the target, not silently do nothing (the accidental index’s own heal never touches the target’s HP at all)');
    assert.equal(nes.cpu.mem[MON_HP], 200, 'AttackFallback must not have healed the caster instead of damaging the target (HealCaster, the accidental index if the fallback branch’s own reload were missing)');

    // Case 2 ("both"): the spell's own anim wins over a real fallback,
    // single-target damage -- target. Accidental index if the reload is
    // missing only on the spell-anim branch: 2 (StatusTarget, poison) --
    // would apply no damage and the wrong status instead of this exact 50.
    reset();
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY;
    nes.cpu.mem[BT_TARGET] = 0;
    nes.cpu.mem[BT_ARG] = 1; // SpellWins
    callRoutine(nes, castSpell);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], SPELL_ANIM, 'SpellWins: the spell’s own anim must win over the caster’s attackAnim fallback');
    assert.equal(nes.cpu.mem[BT_FX_SLOT], 0, 'a single-target damage spell plays over the TARGET, not the caster');
    assert.equal(nes.cpu.mem[PC_HP], 200 - 50, 'SpellWins must deal exactly its own 50, not StatusTarget’s own poison (the accidental index if the spell-anim branch’s own reload were missing)');
    assert.equal(nes.cpu.mem[PC_STATUS], 0, 'and must not have poisoned the target instead');

    // Case 3: single-target status -- also the target, not the caster.
    reset();
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY;
    nes.cpu.mem[BT_TARGET] = 0;
    nes.cpu.mem[BT_ARG] = 2; // StatusTarget
    callRoutine(nes, castSpell);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], SPELL_ANIM, 'StatusTarget must play its own authored anim');
    assert.equal(nes.cpu.mem[BT_FX_SLOT], 0, 'a single-target status spell plays over the TARGET');
    assert.equal(nes.cpu.mem[PC_STATUS], STATUS_POISON, 'StatusTarget’s own poison must still have landed on the target');
    assert.equal(nes.cpu.mem[PC_HP], 200, 'and must not have dealt any damage');

    // Case 4: heal -- the caster, never the target. Accidental index if the
    // reload is missing only on the spell-anim branch: 2 (StatusTarget,
    // poison, targeting bt_target) -- would leave MON_HP untouched and
    // incorrectly poison the party instead of healing the caster.
    reset();
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY;
    nes.cpu.mem[BT_TARGET] = 0;
    nes.cpu.mem[MON_HP] = 100;
    nes.cpu.mem[BT_ARG] = 3; // HealCaster
    callRoutine(nes, castSpell);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], SPELL_ANIM, 'HealCaster must play its own authored anim');
    assert.equal(nes.cpu.mem[BT_FX_SLOT], MAX_PARTY, 'a heal plays over the CASTER, never the target -- no one target to point at');
    assert.equal(nes.cpu.mem[MON_HP], 100 + 5, 'HealCaster must heal exactly its own 5, not silently do nothing (the accidental index’s own poison never touches HP at all)');
    assert.equal(nes.cpu.mem[PC_HP], 200, 'and must not have touched the (unrelated) target at all');
    assert.equal(nes.cpu.mem[PC_STATUS], 0, 'nor poisoned it instead of healing the caster');

    // Case 5: an all-target spell -- the caster, the flourish reading, not
    // any one target. Accidental index if the reload is missing only on
    // the spell-anim branch: 2 (StatusTarget, poison, scope one) -- would
    // poison just the one target instead of damaging the whole party.
    reset();
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY;
    nes.cpu.mem[BT_TARGET] = 0;
    nes.cpu.mem[BT_ARG] = 4; // AllCaster
    callRoutine(nes, castSpell);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], SPELL_ANIM, 'AllCaster must play its own authored anim');
    assert.equal(nes.cpu.mem[BT_FX_SLOT], MAX_PARTY, 'an all-target spell plays over the CASTER, not any one member of the other side');
    assert.equal(nes.cpu.mem[PC_HP], 200 - 20, 'AllCaster must deal exactly its own 20 to the party, not silently poison one member instead');
    assert.equal(nes.cpu.mem[PC_STATUS], 0, 'and must not have poisoned the target instead of damaging the party');

    // Case 6: neither field authored -- a PARTY caster's own attackAnim
    // fallback is unconditionally a no-op (battle_fx_arm_attack's own
    // `bcc rts` for bt_actor < MAX_PARTY), so this is the true "arms
    // nothing" case. bt_fx_anim is pre-set to a sentinel, not NO_ANIM, to
    // prove the call genuinely touches nothing at all, not merely that it
    // happens to leave NO_ANIM where NO_ANIM already was.
    reset();
    nes.cpu.mem[BT_ACTOR] = 0; // a party member
    nes.cpu.mem[BT_TARGET] = MAX_PARTY; // Slime, the monster combatant
    nes.cpu.mem[BT_FX_ANIM] = 77; // sentinel, not NO_ANIM
    nes.cpu.mem[BT_ARG] = 5; // Neither
    callRoutine(nes, castSpell);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], 77, 'Neither: no spell.anim and a party caster’s own fallback is a no-op -- the sentinel must be untouched');
    assert.equal(nes.cpu.mem[MON_HP], 200 - 40, 'Neither’s own damage must still have landed on the target, exactly its own 40');

    // Case 7 ("spell-only", review round 1 finding 3): Snake, a monster
    // with NO attackAnim of its own, casting a spell that DOES have one --
    // there is no real fallback to have won against here at all, unlike
    // cases 2/4/5's "both" shape.
    reset(3); // Snake
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY;
    nes.cpu.mem[BT_TARGET] = 0;
    nes.cpu.mem[BT_ARG] = 6; // SpellOnly
    callRoutine(nes, castSpell);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], SPELL_ONLY_ANIM, 'SpellOnly: the spell’s own anim must play with no caster attackAnim to have won against at all');
    assert.equal(nes.cpu.mem[BT_FX_SLOT], 0, 'a single-target damage spell plays over the TARGET');
    assert.equal(nes.cpu.mem[PC_HP], 200 - 75, 'SpellOnly must deal exactly its own 75');

    // Case 8 ("monster neither", review round 1 finding 3): Snake casting a
    // spell with no anim of its own AND no attackAnim to fall back to --
    // the genuinely different no-op path from case 6's party-side one:
    // battle_fx_arm_attack reaches battle_fx_arm_at with
    // A = mon_anim_attack[Snake] = NO_ANIM, so it is `battle_fx_arm_at`'s
    // own `cmp #NO_ANIM / beq rts` that no-ops here, never the party's
    // `bt_actor < MAX_PARTY` branch (Snake IS a monster combatant, MAX_PARTY
    // and up).
    reset(3); // Snake
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY;
    nes.cpu.mem[BT_TARGET] = 0;
    nes.cpu.mem[BT_FX_ANIM] = 77; // sentinel, not NO_ANIM
    nes.cpu.mem[BT_ARG] = 7; // MonsterNeither
    callRoutine(nes, castSpell);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], 77, 'MonsterNeither: no spell.anim and no attackAnim -- battle_fx_arm_at’s own NO_ANIM no-op, the sentinel must be untouched');
    assert.equal(nes.cpu.mem[PC_HP], 200 - 60, 'MonsterNeither’s own damage must still have landed, exactly its own 60');
  });
}

// battle_fx_tick's own duration timing (docs/design-battle-animation.md
// §3.3), isolated: battle_fx_arm_at/battle_fx_tick called directly, never
// through a real battle message (whose own MSG_HOLD = 45 would cap a
// duration-255 animation long before it could finish on its own -- the
// separate message-cap test below is what proves THAT half). Three
// single-frame animations, durations 1/2/255, added to the catalog and
// referenced directly by id -- not through spell_anim/mon_anim_attack at
// all, since battle_fx_arm_at/battle_fx_tick read anim_count/anim_ptr_lo/hi,
// the pre-existing overworld sprite tables every animation gets regardless
// of whether anything battle-side references it.
test('battle_fx_tick duration timing, isolated: duration 1 ends after exactly 1 tick, duration 2 after exactly 2, duration 255 at the compare on tick 255', {
  skip: needsSample
}, async (t) => {
  const dur1 = 3; // sample-rpg ships animations 0-2; these are appended after
  const dur2 = 4;
  const dur255 = 5;
  const built = await buildVariantFull(t, 'fx-duration', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    for (const [id, duration] of [[dur1, 1], [dur2, 2], [dur255, 255]]) {
      project.sprites.animations.push({ id, name: `Dur${duration}`, loop: false, frames: [{ metaspriteId: 1, duration }] });
    }
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: dur1 }; // flips the gate on
  });
  const { BT_FX_ANIM, BT_FX_FRAME, BT_FX_TIMER } = resolveFxAddrs(built);
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const armAt = addrOf('battle_fx_arm_at');
  const tick = addrOf('battle_fx_tick');
  // battle_fx_tick's own BP_INTRO guard (the same first-tick reasoning
  // setup_monsters's own reset needs) would make every isolated call here a
  // no-op if bt_phase were still (or ever) BP_INTRO -- a real battle always
  // moves off it before the first tick, so pin it to any other phase.
  nes.cpu.mem[BT_PHASE] = BP_MENU;

  const arm = (animId) => {
    nes.cpu.REG_ACC = animId;
    nes.cpu.REG_Y = MAX_PARTY; // slot 4, arbitrary
    callRoutine(nes, armAt);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], animId, `sanity: arming animation ${animId} should set bt_fx_anim`);
    assert.equal(nes.cpu.mem[BT_FX_FRAME], 0);
    assert.equal(nes.cpu.mem[BT_FX_TIMER], 0);
  };

  arm(dur1);
  callRoutine(nes, tick);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'duration 1 must end after exactly 1 tick');

  arm(dur2);
  callRoutine(nes, tick);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], dur2, 'duration 2 must NOT have ended after only 1 tick');
  callRoutine(nes, tick);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'duration 2 must end after exactly 2 ticks');

  arm(dur255);
  for (let i = 0; i < 254; i++) {
    callRoutine(nes, tick);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], dur255, `duration 255 must not end before tick 255 (still running after tick ${i + 1})`);
  }
  callRoutine(nes, tick); // the 255th tick
  assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'duration 255 must end at the compare on tick 255, with no byte ever needing to exceed it');
});

// A 3+ frame sequence, isolated the identical way: bt_fx_frame must advance
// through each frame in order, timed from the arm tick -- an off-by-one here
// is invisible to a 1- or 2-frame test (both above), since neither ever
// exercises a MIDDLE frame's own transition.
test('battle_fx_tick advances a 3-frame animation in order, each frame held for exactly its own authored duration', {
  skip: needsSample
}, async (t) => {
  const seqId = 3;
  const built = await buildVariantFull(t, 'fx-sequence', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.animations.push({
      id: seqId,
      name: 'Sequence',
      loop: false,
      frames: [
        { metaspriteId: 1, duration: 2 },
        { metaspriteId: 1, duration: 3 },
        { metaspriteId: 1, duration: 4 }
      ]
    });
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: seqId };
  });
  const { BT_FX_ANIM, BT_FX_FRAME } = resolveFxAddrs(built);
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.REG_ACC = seqId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, addrOf('battle_fx_arm_at'));
  assert.equal(nes.cpu.mem[BT_FX_FRAME], 0);

  const tick = addrOf('battle_fx_tick');
  const expected = [
    [1, 0], [2, 1], // frame 0 (duration 2): held ticks 1, advances to 1 on tick 2
    [3, 1], [4, 1], [5, 2], // frame 1 (duration 3): held ticks 3-4, advances to 2 on tick 5
    [6, 2], [7, 2], [8, 2], [9, NO_ANIM] // frame 2 (duration 4): held ticks 6-8, done on tick 9
  ];
  for (const [tickNumber, frameOrDone] of expected) {
    callRoutine(nes, tick);
    if (frameOrDone === NO_ANIM) {
      assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, `tick ${tickNumber}: the sequence should have ended`);
    } else {
      assert.equal(nes.cpu.mem[BT_FX_ANIM], seqId, `tick ${tickNumber}: the sequence should still be running`);
      assert.equal(nes.cpu.mem[BT_FX_FRAME], frameOrDone, `tick ${tickNumber}: expected frame ${frameOrDone}`);
    }
  }
});

// Message-cap termination, through a REAL battle message this time (not the
// isolated-routine harness above, which cannot observe MSG_HOLD at all):
// an animation authored at duration 255 must end when the message is
// dismissed -- long before tick 255, since MSG_HOLD caps it first.
test('a duration-255 animation ends when the battle message is dismissed, not at its own natural end', {
  skip: needsSample
}, async (t) => {
  const longAnimId = 3;
  const built = await buildVariantFull(t, 'fx-message-cap', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.animations.push({ id: longAnimId, name: 'Long', loop: false, frames: [{ metaspriteId: 1, duration: 255 }] });
    project.spells[0].anim = longAnimId; // Ember
  });
  const { BT_FX_ANIM } = resolveFxAddrs(built);
  const nes = bootPastNaming(built.romPath);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6); // Ember, the first row
  tap(nes, A, 10); // aim it at the slime -- the attack's own message should now be up
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the cast’s own message should be up');
  assert.equal(nes.cpu.mem[BT_FX_ANIM], longAnimId, 'the long animation should still be running while the message holds');

  tap(nes, A, 10); // dismiss the message well before tick 255
  assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'dismissing the message must end the effect immediately, regardless of its own authored duration');
});

// review round 1, P2 finding 4: §6's own required case is the NORMAL
// MSG_HOLD timeout, not early dismissal -- the early-A test above proves
// dismissing the message clears the effect, but says nothing about the
// no-input path, which is a genuinely different route through the same
// `battle_message_done` clear (battle_message_wait's own `dec <bt_timer> /
// bne battle_message_hold` branch, never the `BTN_A` one). A production bug
// that cleared the effect only on the A-press branch, leaving it running
// forever on a message nobody dismisses, would still pass the test above.
test('a duration-255 animation ends when the battle message times out on its own, with no input at all, long before tick 255', {
  skip: needsSample
}, async (t) => {
  const longAnimId = 3;
  const built = await buildVariantFull(t, 'fx-message-timeout', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.animations.push({ id: longAnimId, name: 'Long', loop: false, frames: [{ metaspriteId: 1, duration: 255 }] });
    project.spells[0].anim = longAnimId; // Ember
  });
  const { BT_FX_ANIM } = resolveFxAddrs(built);
  const nes = bootPastNaming(built.romPath);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6); // Ember, the first row
  tap(nes, A, 10); // aim it at the slime -- the attack's own message should now be up
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the cast’s own message should be up');
  assert.equal(nes.cpu.mem[BT_FX_ANIM], longAnimId, 'the long animation should still be running while the message holds');

  // No input at all from here on. MSG_HOLD (45) is well short of the
  // authored duration (255), so ending here proves the timeout path
  // specifically, not the natural end of a 255-tick flipbook -- and since
  // `tap(nes, A, 10)` above already let some of the message's own hold run
  // out settling the cast, this counts frames from HERE rather than
  // assuming the timer was still fresh at exactly MSG_HOLD.
  let framesWaited = 0;
  while (nes.cpu.mem[BT_PHASE] === BP_MESSAGE && framesWaited < MSG_HOLD + 5) {
    assert.equal(nes.cpu.mem[BT_FX_ANIM], longAnimId, `the effect must stay armed for every frame the message is still up, unpressed (frame ${framesWaited})`);
    nes.frame();
    framesWaited++;
  }
  assert.notEqual(nes.cpu.mem[BT_PHASE], BP_MESSAGE, `the message must have timed out on its own within MSG_HOLD (${MSG_HOLD}) frames of no input, saw it still up after ${framesWaited}`);
  assert.ok(framesWaited > 0, 'sanity: the message must not have been already gone the instant it appeared');
  assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'the message timing out with no input at all must end the effect too, well before its own tick 255');
});

// Register/scratch contract (docs/design-battle-animation.md §3.3's own
// table): none of the four routines may touch bt_tmp/bt_tmp2/bt_digits/
// bt_list -- scratch other in-flight battle code (cast_all's own bt_tmp2
// sentinel among them) depends on surviving untouched across a call. A
// future edit reaching for shared scratch instead of its own bytes is what
// this catches. It says nothing about A/X/Y beyond that scope, but not
// every routine here is free to clobber all three regardless: the
// contract table's own row for `battle_fx_arm_at` requires it to PRESERVE
// Y specifically (both real call sites carry the target/caster slot in Y
// across the call) -- this test does not assert that (Y is out of its own
// stated scope, bt_tmp/bt_tmp2/bt_digits/bt_list), so it is not where that
// guarantee is checked.
test('none of battle_fx_arm_at/arm_attack/tick/draw touch bt_tmp, bt_tmp2, bt_digits or bt_list', {
  skip: needsSample
}, async (t) => {
  const animId = 3;
  const built = await buildVariantFull(t, 'fx-scratch-contract', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.sprites.animations.push({ id: animId, name: 'Swing', loop: false, frames: [{ metaspriteId: 1, duration: 8 }] });
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: animId };
  });
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const BT_TMP = resolveEngineAddress(constantsText, 'bt_tmp');
  const BT_TMP2 = resolveEngineAddress(constantsText, 'bt_tmp2');
  const BT_DIGITS = resolveEngineAddress(constantsText, 'bt_digits');
  const { BT_FX_ANIM } = resolveFxAddrs(built);

  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.mem[MON_SLOT_ACTOR] = 0;

  const sentinels = () => {
    nes.cpu.mem[BT_TMP] = 0x11;
    nes.cpu.mem[BT_TMP2] = 0x22;
    for (let i = 0; i < 3; i++) nes.cpu.mem[BT_DIGITS + i] = 0x33 + i;
    for (let i = 0; i < 8; i++) nes.cpu.mem[BT_LIST + i] = 0x44 + i;
  };
  const assertScratchUntouched = (label) => {
    assert.equal(nes.cpu.mem[BT_TMP], 0x11, `${label}: bt_tmp must be untouched`);
    assert.equal(nes.cpu.mem[BT_TMP2], 0x22, `${label}: bt_tmp2 must be untouched`);
    for (let i = 0; i < 3; i++) assert.equal(nes.cpu.mem[BT_DIGITS + i], 0x33 + i, `${label}: bt_digits[${i}] must be untouched`);
    for (let i = 0; i < 8; i++) assert.equal(nes.cpu.mem[BT_LIST + i], 0x44 + i, `${label}: bt_list[${i}] must be untouched`);
  };

  sentinels();
  nes.cpu.REG_ACC = animId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, addrOf('battle_fx_arm_at'));
  assertScratchUntouched('battle_fx_arm_at');

  sentinels();
  nes.cpu.mem[BT_ACTOR] = MAX_PARTY;
  callRoutine(nes, addrOf('battle_fx_arm_attack'));
  assertScratchUntouched('battle_fx_arm_attack');

  sentinels();
  nes.cpu.mem[BT_FX_ANIM] = animId; // something genuinely running
  callRoutine(nes, addrOf('battle_fx_tick'));
  assertScratchUntouched('battle_fx_tick');

  sentinels();
  nes.cpu.mem[BT_FX_ANIM] = animId;
  callRoutine(nes, addrOf('battle_fx_draw'));
  assertScratchUntouched('battle_fx_draw');
});

// The conservative, project-wide fit check (docs/design-battle-animation.md
// §3.3/§3.6): BATTLE_FX_OAM_ROOM is a single build-time constant --
// `max(0, MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper))` -- and
// battle_fx_draw compares a frame's own ms_count against it directly, with
// no notion of "how many sprites this particular battle happens to be
// using" at all. The four filler monsters below, named in a live but
// never-triggered `battle` command, exist purely to inflate
// battleCombatantOamMax (and so shrink the compiled room) well past what
// the real, small touch-encounter fight (Slime alone) would ever need --
// proving the room used is the project's own worst case, not a live count,
// without this test ever needing to actually fight that inflated formation.
// `miss` (default false, preserving every existing caller's behavior exactly):
// when true, the fixture also turns on rpg.miss and shrinks `room` by
// MISS_OAM_TILES -- BATTLE_FX_OAM_ROOM's own generated formula
// (main/build/generate.js) -- so the SAME exact-fit/one-over animations this
// fixture already builds land on the MISS-aware boundary instead, with no
// duplicated fixture.
async function buildFxFitFixture(t, { miss = false } = {}) {
  let room;
  let oversizedAnimId;
  let mixedAnimId;
  let exactAnimId;
  let oneOverAnimId;
  let fillerIds;
  const built = await buildVariantFull(t, 'fx-conservative-fit', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    if (miss) project.rpg.miss = true;
    // Every id below is read back from the array's own length at the moment
    // of each push, never hardcoded -- a hardcoded id here would silently
    // collide with (or leave a gap against) whatever sample-rpg's own
    // catalog already holds, aliasing one animation's compiled table row
    // onto a completely different entry.
    const bigMetaId = project.sprites.metasprites.length;
    project.sprites.metasprites.push({
      id: bigMetaId,
      name: 'Big filler',
      tiles: Array.from({ length: 12 }, (_, i) => ({ tile: 64 + i, x: 0, y: 0, palette: 0 }))
    });
    const bigAnimId = project.sprites.animations.length;
    project.sprites.animations.push({ id: bigAnimId, name: 'BigWalk', loop: true, frames: [{ metaspriteId: bigMetaId }] });
    fillerIds = [];
    for (let i = 0; i < 4; i++) {
      const id = project.sprites.actors.length;
      project.sprites.actors.push({
        id, name: `Filler${i}`, behavior: 'npc', speed: 1, hp: 1, damage: 0,
        anims: { idle: bigAnimId, walkDown: null, walkUp: null, walkSide: null },
        battle: {}
      });
      fillerIds.push(id);
    }
    // Live (cond: none, never disabled) but never actually triggered by
    // this test's own playthrough -- battleFormations walks liveCommands
    // regardless of whether a placement is ever interacted with.
    project.maps[0].screens[0].entities.push({
      actorId: 0, x: 240, y: 224, props: { event: { pages: [{ commands: [{ op: 'battle', monsters: fillerIds }] }] } }
    });

    room = MAX_OAM_ENTRIES - battleCombatantOamMax(project, resolveMapper(project.cartridge.mapper)) - (miss ? MISS_OAM_TILES : 0);
    assert.ok(room >= 3 && room < 40, `sanity: expected a small but real room, got ${room}`);

    const oversized = room + 10;
    const smallMetaId = project.sprites.metasprites.length;
    project.sprites.metasprites.push({
      id: smallMetaId,
      name: 'Small',
      tiles: [{ tile: 90, x: 0, y: 0, palette: 0 }, { tile: 91, x: 0, y: 0, palette: 0 }]
    });
    const oversizedMetaId = project.sprites.metasprites.length;
    project.sprites.metasprites.push({
      id: oversizedMetaId,
      name: 'Oversized',
      tiles: Array.from({ length: oversized }, (_, i) => ({ tile: 100 + i, x: 0, y: 0, palette: 0 }))
    });
    oversizedAnimId = project.sprites.animations.length;
    project.sprites.animations.push({
      id: oversizedAnimId,
      name: 'Oversized',
      loop: false,
      frames: [{ metaspriteId: oversizedMetaId }]
    });
    mixedAnimId = project.sprites.animations.length;
    project.sprites.animations.push({
      id: mixedAnimId,
      name: 'Mixed',
      loop: false,
      frames: [{ metaspriteId: smallMetaId }, { metaspriteId: oversizedMetaId }]
    });

    // review round 1, P2 finding 1: the admission boundary itself --
    // exactly `room` tiles (must be admitted, every entry written) and
    // exactly `room + 1` (must be rejected outright), not room+10 (which
    // only pins "way too big," and survives `cmp #BATTLE_FX_OAM_ROOM+2`
    // unchanged, per the reviewer's own supplied sabotage result).
    const exactMetaId = project.sprites.metasprites.length;
    project.sprites.metasprites.push({
      id: exactMetaId,
      name: 'ExactFit',
      tiles: Array.from({ length: room }, (_, i) => ({ tile: 150 + i, x: 0, y: 0, palette: 0 }))
    });
    exactAnimId = project.sprites.animations.length;
    project.sprites.animations.push({ id: exactAnimId, name: 'ExactFit', loop: false, frames: [{ metaspriteId: exactMetaId }] });

    const oneOverMetaId = project.sprites.metasprites.length;
    project.sprites.metasprites.push({
      id: oneOverMetaId,
      name: 'OneOver',
      tiles: Array.from({ length: room + 1 }, (_, i) => ({ tile: 150 + i, x: 0, y: 0, palette: 0 }))
    });
    oneOverAnimId = project.sprites.animations.length;
    project.sprites.animations.push({ id: oneOverAnimId, name: 'OneOver', loop: false, frames: [{ metaspriteId: oneOverMetaId }] });

    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: oversizedAnimId };
  });
  return {
    built,
    room: () => room,
    oversizedAnimId: () => oversizedAnimId,
    mixedAnimId: () => mixedAnimId,
    exactAnimId: () => exactAnimId,
    oneOverAnimId: () => oneOverAnimId,
    fillerIds: () => fillerIds
  };
}

test('conservative fit: BATTLE_FX_OAM_ROOM is the project-wide worst case, and an animation exceeding it is skipped on every one of several ticks, not merely the first', {
  skip: needsSample
}, async (t) => {
  const { built, room, oversizedAnimId: oversizedAnimIdFn } = await buildFxFitFixture(t);
  const oversizedAnimId = oversizedAnimIdFn();
  const dir = path.dirname(path.dirname(built.romPath));
  const configText = fs.readFileSync(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  const compiledRoom = Number(configText.match(/^BATTLE_FX_OAM_ROOM\s*=\s*(\d+)/m)?.[1]);
  assert.equal(compiledRoom, room(), 'BATTLE_FX_OAM_ROOM must equal MAX_OAM_ENTRIES - battleCombatantOamMax exactly -- the compiled figure IS the worst case, computed once, never a live count');

  const { BT_FX_ANIM, BT_FX_FRAME } = resolveFxAddrs(built);
  const OAM_IDX = resolveEngineAddress(fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8'), 'oam_idx');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.REG_ACC = oversizedAnimId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, addrOf('battle_fx_arm_at'));
  assert.equal(nes.cpu.mem[BT_FX_ANIM], oversizedAnimId, 'sanity: the oversized animation should have armed');

  const draw = addrOf('battle_fx_draw');
  for (let tick = 0; tick < 3; tick++) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300); // battle_sprite_clear's own park step, done by hand for this isolated call
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, draw);
    assert.equal(nes.cpu.mem[OAM_IDX], 0, `tick ${tick}: oam_idx must stay 0 -- nothing may be drawn`);
    assert.equal(nes.cpu.mem[0x200], 0xff, `tick ${tick}: OAM byte 0 must stay parked at $FF -- the frame does not fit and must be skipped, every tick, not merely the first`);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], oversizedAnimId, `tick ${tick}: being skipped at draw time must not end the effect -- it is still "running," simply invisible`);
  }
});

test('conservative fit: within one animation, a small frame draws and an oversized frame is skipped, independently, frame by frame', {
  skip: needsSample
}, async (t) => {
  const { built, mixedAnimId: mixedAnimIdFn } = await buildFxFitFixture(t);
  const mixedAnimId = mixedAnimIdFn();
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const OAM_IDX = resolveEngineAddress(constantsText, 'oam_idx');
  const { BT_FX_ANIM, BT_FX_FRAME } = resolveFxAddrs(built);

  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.REG_ACC = mixedAnimId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, addrOf('battle_fx_arm_at'));
  assert.equal(nes.cpu.mem[BT_FX_FRAME], 0, 'sanity: armed on frame 0, the small one');

  const draw = addrOf('battle_fx_draw');
  nes.cpu.mem.fill(0xff, 0x200, 0x300);
  nes.cpu.mem[OAM_IDX] = 0;
  callRoutine(nes, draw);
  assert.notEqual(nes.cpu.mem[OAM_IDX], 0, 'frame 0 (2 tiles) fits its own room and must draw real sprites');
  assert.notEqual(nes.cpu.mem[0x200], 0xff, 'frame 0 must have written a real OAM entry, not left the park byte');

  // Advance to frame 1 (the oversized one) directly -- bt_fx_frame is the
  // one byte that decides which frame draws, so poking it is equivalent to
  // ticking there for this isolated check.
  nes.cpu.mem[BT_FX_FRAME] = 1;
  nes.cpu.mem.fill(0xff, 0x200, 0x300);
  nes.cpu.mem[OAM_IDX] = 0;
  callRoutine(nes, draw);
  assert.equal(nes.cpu.mem[OAM_IDX], 0, 'frame 1 (oversized) must be skipped -- oam_idx must stay 0');
  assert.equal(nes.cpu.mem[0x200], 0xff, 'frame 1 must leave the OAM park byte untouched');
});

// review round 1, P2 finding 1: the admission boundary itself, pinned on
// both sides. `cmp #BATTLE_FX_OAM_ROOM+1 / bcs skip` means "admit anything
// up to and including room, reject room+1 and up" -- a frame of exactly
// room tiles is the largest one this project can ever be shown drawing, and
// room+1 is the smallest one it must never draw. Neither the room+10
// ("oversized") nor the 2-tile ("small") fixtures used by the two tests
// above can distinguish a `+1` boundary from a `+2` or an off-by-one in the
// other direction -- both survive comfortably on either side of either
// wrong comparison. Checked across several ticks, both ways, so a
// "skip/admit once, then flip" bug cannot hide either.
test('conservative fit: the OAM admission boundary is exact -- room tiles admits and draws every one, room+1 rejects the whole frame, on every tick', {
  skip: needsSample
}, async (t) => {
  const {
    built,
    room: roomFn,
    exactAnimId: exactAnimIdFn,
    oneOverAnimId: oneOverAnimIdFn,
    fillerIds: fillerIdsFn
  } = await buildFxFitFixture(t);
  const room = roomFn();
  const exactAnimId = exactAnimIdFn();
  const oneOverAnimId = oneOverAnimIdFn();
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const OAM_IDX = resolveEngineAddress(constantsText, 'oam_idx');
  const { BT_FX_ANIM } = resolveFxAddrs(built);

  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const armAt = addrOf('battle_fx_arm_at');
  const draw = addrOf('battle_fx_draw');
  nes.cpu.mem[BT_PHASE] = BP_MENU;

  // Exactly `room`: admitted, every one of the room entries actually
  // written (not merely "oam_idx moved") -- checked across three ticks, so
  // an admit-once-then-reject bug cannot hide behind the first tick alone.
  nes.cpu.REG_ACC = exactAnimId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, armAt);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], exactAnimId, 'sanity: the exact-fit animation should have armed');
  for (let tick = 0; tick < 3; tick++) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, draw);
    assert.equal(nes.cpu.mem[OAM_IDX], room * 4, `tick ${tick}: exactly room (${room}) entries must be written, oam_idx should read ${room * 4}`);
    for (let i = 0; i < room; i++) {
      assert.notEqual(nes.cpu.mem[0x200 + i * 4], 0xff, `tick ${tick}: OAM entry ${i} of ${room} must be a real, written sprite, not the park byte`);
    }
    // Nothing past the room'th entry may have been touched.
    assert.equal(nes.cpu.mem[0x200 + room * 4], 0xff, `tick ${tick}: the entry immediately after the admitted room must stay parked`);
  }

  // Exactly room + 1: rejected outright, the WHOLE OAM shadow and oam_idx
  // left exactly as battle_sprite_clear's own park step leaves them --
  // checked across three ticks the identical way.
  nes.cpu.REG_ACC = oneOverAnimId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, armAt);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], oneOverAnimId, 'sanity: the one-over animation should have armed');
  for (let tick = 0; tick < 3; tick++) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, draw);
    assert.equal(nes.cpu.mem[OAM_IDX], 0, `tick ${tick}: room+1 must be rejected outright -- oam_idx must stay 0`);
    for (let i = 0x200; i < 0x300; i++) {
      assert.equal(nes.cpu.mem[i], 0xff, `tick ${tick}: the WHOLE OAM shadow must stay parked at $FF when room+1 is rejected, byte ${i - 0x200} did not`);
    }
  }

  // Review round 2, P3 finding 2: the follow-on draw must exercise the
  // ACTUAL worst-case reserved load that produced the compiled `room`, not
  // whatever happens to be alive by default (this fixture never fights the
  // four filler monsters for real, so mon_slot_alive is all zero at boot --
  // the earlier version's own oam_idx >= room*4 check would have passed
  // even if battle_sprite_pc had drawn nothing at all). Populating the four
  // filler monsters as the CURRENT battle's own combatants makes
  // battle_sprite_pc's own fall-through into battle_sprite_mon draw exactly
  // the formation battleCombatantOamMax priced in; the party side is forced
  // present and alive below (a normal boot alone leaves it short, see that
  // comment), which is what makes it match battleCombatantOamMax's own party
  // term -- the same project data that term reads -- and this project's
  // mapper (MMC1, sample-rpg's own default) has no split cursor to add. By
  // construction, room + battleCombatantOamMax
  // = MAX_OAM_ENTRIES exactly (`room` above IS `MAX_OAM_ENTRIES -
  // battleCombatantOamMax`), so admitting the exact-fit effect (`room`
  // entries) and then this exact worst-case combatant load
  // (`battleCombatantOamMax` entries) must fill the OAM shadow to precisely
  // 64 sprites -- an exact multiple of the 256-byte shadow, which
  // legitimately wraps oam_idx back to 0 rather than leaving it at some
  // larger value, exactly as the design allows and the review named.
  nes.cpu.mem.fill(0xff, 0x200, 0x300);
  nes.cpu.mem[OAM_IDX] = 0;
  nes.cpu.REG_ACC = exactAnimId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, armAt);
  callRoutine(nes, draw);
  assert.equal(nes.cpu.mem[OAM_IDX], room * 4, 'sanity: the exact-fit effect drew its own room entries before the combatant load runs');
  const effectBytesBeforeCombatants = [...nes.cpu.mem.slice(0x200, 0x200 + room * 4)];

  const fillerIds = fillerIdsFn();
  for (let i = 0; i < fillerIds.length; i++) {
    nes.cpu.mem[MON_SLOT_ACTOR + i] = fillerIds[i];
    nes.cpu.mem[MON_ALIVE + i] = 1;
  }
  // battleCombatantOamMax's own party term (shared/project.js) sums EVERY
  // party array entry unconditionally -- the worst case it reserves for
  // covers a member who has not joined yet, not merely whoever pc_in_party
  // already holds at this fresh boot. sample-rpg's own second member (Iris)
  // starts outside the party, so a fresh boot's own real draw would
  // otherwise fall 4 tiles short of the reserved worst case for a reason
  // that has nothing to do with this test's own OAM boundary claim -- force
  // every one of the MAX_PARTY combatant slots present; pc_metasprite's own
  // $FF ("no icon") for whichever slots this project genuinely has no
  // member in is what naturally makes this match battleCombatantOamMax's
  // own real party sum exactly, not an assumption this test makes on its
  // own.
  for (let i = 0; i < MAX_PARTY; i++) {
    nes.cpu.mem[PC_IN_PARTY + i] = 1;
    if (nes.cpu.mem[PC_HP + i] === 0) nes.cpu.mem[PC_HP + i] = 1;
  }
  nes.cpu.REG_X = 0;
  callRoutine(nes, addrOf('battle_sprite_pc'));

  const effectBytesAfterCombatants = [...nes.cpu.mem.slice(0x200, 0x200 + room * 4)];
  assert.deepEqual(
    effectBytesAfterCombatants,
    effectBytesBeforeCombatants,
    'the reserved worst-case combatant load must never overwrite the exact-fit effect’s own admitted OAM entries'
  );
  const combatantMax = MAX_OAM_ENTRIES - room; // by construction -- see comment above
  assert.equal(
    nes.cpu.mem[OAM_IDX],
    0,
    `the exact-fit effect (${room}) plus the real worst-case combatant load (${combatantMax}) must total exactly ` +
      `${MAX_OAM_ENTRIES} sprites -- oam_idx legitimately wraps to 0, not merely growing past room*4`
  );
  // And it must be a real wrap from actually drawing 64 sprites, not a
  // no-op that coincidentally also reads oam_idx as 0 -- the bytes the
  // combatant load was responsible for (everything from room*4 onward, one
  // full wrap around the 256-byte shadow) must no longer be the park byte.
  for (let i = room * 4; i < 0x100; i++) {
    assert.notEqual(nes.cpu.mem[0x200 + i], 0xff, `byte ${i} (part of the real worst-case combatant load) must have been actually written, not left parked`);
  }
});

// §14 round 2, test row "MISS OAM overflow, exact-fit boundary restored"
// (finding 5, P2) -- the runtime half the phase-2b report scaled down to a
// compiled-constant-only check. The identical admission-boundary shape as
// the test just above, but with rpg.miss ALSO on: buildFxFitFixture's own
// MISS-aware room (`MAX_OAM_ENTRIES - battleCombatantOamMax - MISS_OAM_TILES`)
// means `room` here is 4 tiles smaller than the plain-fit fixture's own --
// by construction, room + battleCombatantOamMax + MISS_OAM_TILES sums to
// exactly MAX_OAM_ENTRIES (64), which is what the design's own row 5 asks
// for. Exercises battle_fx_draw's own real compiled `cmp #BATTLE_FX_OAM_ROOM+1`
// (engine/battleui.asm) -- not a re-read of the JS-side formula -- so a
// generator that forgets the `- MISS_OAM_TILES` term produces a REAL,
// wider compiled room that admits the room+1 frame this test expects
// rejected.
//
// Wrong implementation this catches: `battleFxOamRoom` (main/build/
// generate.js) computed without its own `- MISS_OAM_TILES` term -- with
// MISS on, the room+1 ("one tile larger than the MISS-aware room") frame
// would then be admitted instead of rejected, since the real compiled room
// would still be 4 tiles too generous.
test('conservative fit, MISS-aware: with rpg.miss on, room shrinks by MISS_OAM_TILES and the same admission boundary holds exactly -- room admits and draws every tile, room+1 rejects the whole frame', {
  skip: needsSample
}, async (t) => {
  const {
    built,
    room: roomFn,
    exactAnimId: exactAnimIdFn,
    oneOverAnimId: oneOverAnimIdFn
  } = await buildFxFitFixture(t, { miss: true });
  const room = roomFn();
  const exactAnimId = exactAnimIdFn();
  const oneOverAnimId = oneOverAnimIdFn();
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const OAM_IDX = resolveEngineAddress(constantsText, 'oam_idx');
  const { BT_FX_ANIM } = resolveFxAddrs(built);

  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const armAt = addrOf('battle_fx_arm_at');
  const draw = addrOf('battle_fx_draw');
  nes.cpu.mem[BT_PHASE] = BP_MENU;

  // Exactly `room` (already 4 smaller than the plain-fit fixture's own,
  // since this build turned rpg.miss on): admitted, every entry actually
  // written, checked across three ticks.
  nes.cpu.REG_ACC = exactAnimId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, armAt);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], exactAnimId, 'sanity: the exact-fit (MISS-aware) animation should have armed');
  for (let tick = 0; tick < 3; tick++) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, draw);
    assert.equal(nes.cpu.mem[OAM_IDX], room * 4, `tick ${tick}: exactly room (${room}, MISS-aware) entries must be written, oam_idx should read ${room * 4}`);
    for (let i = 0; i < room; i++) {
      assert.notEqual(nes.cpu.mem[0x200 + i * 4], 0xff, `tick ${tick}: OAM entry ${i} of ${room} must be a real, written sprite, not the park byte`);
    }
    assert.equal(nes.cpu.mem[0x200 + room * 4], 0xff, `tick ${tick}: the entry immediately after the admitted room must stay parked`);
  }

  // Exactly room + 1: rejected outright -- the WHOLE OAM shadow and oam_idx
  // left exactly as battle_sprite_clear's own park step leaves them. This is
  // the assertion a missing `- MISS_OAM_TILES` term breaks: with the term
  // missing, the real compiled BATTLE_FX_OAM_ROOM is 4 tiles wider than
  // `room` here, so a room+1-tile frame would still fit under the
  // (wrongly generous) real room and would be admitted instead of rejected.
  nes.cpu.REG_ACC = oneOverAnimId;
  nes.cpu.REG_Y = MAX_PARTY;
  callRoutine(nes, armAt);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], oneOverAnimId, 'sanity: the one-over (MISS-aware) animation should have armed');
  for (let tick = 0; tick < 3; tick++) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, draw);
    assert.equal(nes.cpu.mem[OAM_IDX], 0, `tick ${tick}: room+1 (MISS-aware) must be rejected outright -- oam_idx must stay 0`);
    for (let i = 0x200; i < 0x300; i++) {
      assert.equal(nes.cpu.mem[i], 0xff, `tick ${tick}: the WHOLE OAM shadow must stay parked at $FF when room+1 (MISS-aware) is rejected, byte ${i - 0x200} did not`);
    }
  }
});

// Phase 3 (docs/design-battle-animation.md §15.6): THE GATE -- the
// frame-for-frame trace test that must exist and pass before a single line of
// renderer/forges/magic/magic.js's own canvas/controls is written (§7's own
// phasing). The ROM is the oracle; renderer/widgets/battlefx.js's DOM-free
// stepper (armBattleFx/tickBattleFx/drawnBattleFx) is what is under test --
// the sfx.test.js shape (test/unit/sfx.test.js:521-576, "the ROM driver and
// SfxReplayer agree on every frame").
//
// One fixture builder, extending buildFxFitFixture's own shape above, with
// three differences §15.6 requires: (1) every frame's own duration is
// authored explicitly, never left to normalizeAnimation's default; (2) the
// four filler combatants are 13 tiles each, not 12, so room lands in
// 3 <= room <= 6 (the design's own retuning, §15.6, "the 16-tile ceiling and
// the exact-room/room+1/room+10 relationship"); (3) every admitted
// metasprite gets its own disjoint tile-id block, so the OAM tile byte
// battle_fx_draw actually wrote identifies which one drew, never inferred
// from re-running the JS side's own fit arithmetic.
//
// Board: sample-rpg's own default (MMC1, mapper 1) only. buildFxFitFixture
// (above) does not parameterize the board either -- the brief's own
// allowance ("if it does not, one board is acceptable -- say which") is
// exercised here explicitly. The design's own measured rooms (§15.6) are
// MMC1 4, MMC3 3, UNROM 512 4; this fixture asserts 3 <= room <= 6 on
// whichever board it runs (MMC1 here) rather than hardcoding one of the
// three -- the assertion is the same regardless of board, only the build
// target differs.
async function buildFxTraceFixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-fx-trace-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].encounters = { rate: 0, actorIds: [] };

  // Four filler combatants at 13 tiles each (buildFxFitFixture's own shape,
  // above, uses 12 -- §15.6's own retuning needs 13 so room lands in
  // 3 <= room <= 6 rather than buildFxFitFixture's own wider range).
  const bigMetaId = project.sprites.metasprites.length;
  project.sprites.metasprites.push({
    id: bigMetaId,
    name: 'Big filler',
    tiles: Array.from({ length: 13 }, (_, i) => ({ tile: 90 + i, x: 0, y: 0, palette: 0 }))
  });
  const bigAnimId = project.sprites.animations.length;
  project.sprites.animations.push({ id: bigAnimId, name: 'BigWalk', loop: true, frames: [{ metaspriteId: bigMetaId, duration: 8 }] });
  const fillerIds = [];
  for (let i = 0; i < 4; i++) {
    const id = project.sprites.actors.length;
    project.sprites.actors.push({
      id, name: `TraceFiller${i}`, behavior: 'npc', speed: 1, hp: 1, damage: 0,
      anims: { idle: bigAnimId, walkDown: null, walkUp: null, walkSide: null },
      battle: {}
    });
    fillerIds.push(id);
  }
  project.maps[0].screens[0].entities.push({
    actorId: 0, x: 232, y: 216, props: { event: { pages: [{ commands: [{ op: 'battle', monsters: fillerIds }] }] } }
  });

  // MISS off, unconditionally (§15.6: "the fit trace runs with MISS OFF" --
  // with the 13-tile filler tuning, a MISS-on room clamps to 0 on every
  // board, leaving no positive room for any fitting case at all).
  project.rpg.miss = false;

  // Every admitted metasprite gets its own disjoint tile-id block (none of
  // these ranges overlap, and none overlaps the 90-102 filler block above),
  // so the drawn OAM tile byte alone identifies which metasprite drew.
  const push = (name, tiles) => {
    const id = project.sprites.metasprites.length;
    project.sprites.metasprites.push({ id, name, tiles: tiles.map((tile) => ({ tile, x: 0, y: 0, palette: 0 })) });
    return id;
  };
  const pushAnim = (name, frames) => {
    const id = project.sprites.animations.length;
    project.sprites.animations.push({ id, name, loop: false, frames });
    return id;
  };

  const dur1MetaId = push('Dur1', [30]);
  const dur1AnimId = pushAnim('Dur1', [{ metaspriteId: dur1MetaId, duration: 1 }]);

  const dur255MetaId = push('Dur255', [31]);
  const dur255AnimId = pushAnim('Dur255', [{ metaspriteId: dur255MetaId, duration: 255 }]);

  const seq0MetaId = push('Seq0', [34]);
  const seq1MetaId = push('Seq1', [35]);
  const seq2MetaId = push('Seq2', [36]);
  const seq3MetaId = push('Seq3', [37]);
  const seqAnimId = pushAnim('Sequence', [
    { metaspriteId: seq0MetaId, duration: 2 },
    { metaspriteId: seq1MetaId, duration: 3 },
    { metaspriteId: seq2MetaId, duration: 4 },
    { metaspriteId: seq3MetaId, duration: 255 }
  ]);

  const emptyAnimId = pushAnim('Empty', []);

  const zeroTileMetaId = push('ZeroTile', []);
  const zeroTileAnimId = pushAnim('ZeroTile', [{ metaspriteId: zeroTileMetaId, duration: 3 }]);

  const smallMetaId = push('Small', [40, 41]);

  // room is computed AFTER normalization (below); the Oversized/ExactFit/
  // OneOver metasprites are built once room is known, all still well under
  // the 16-tile ceiling (room in 3..6, so room+10 in 13..16).
  const mapper = resolveMapper(project.cartridge.mapper);
  const preliminaryRoom = MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper);
  assert.ok(preliminaryRoom >= 3 && preliminaryRoom <= 6, `sanity: preliminary room (${preliminaryRoom}) must be in 3..6 before the fit metasprites are even built`);

  const oversizedCount = preliminaryRoom + 10;
  const oversizedMetaId = push('Oversized', Array.from({ length: oversizedCount }, (_, i) => 50 + i));
  const exactCount = preliminaryRoom;
  const exactMetaId = push('ExactFit', Array.from({ length: exactCount }, (_, i) => 70 + i));
  const oneOverCount = preliminaryRoom + 1;
  const oneOverMetaId = push('OneOver', Array.from({ length: oneOverCount }, (_, i) => 80 + i));

  const exactAnimId = pushAnim('ExactFit', [{ metaspriteId: exactMetaId, duration: 5 }]);
  const oneOverAnimId = pushAnim('OneOver', [{ metaspriteId: oneOverMetaId, duration: 5 }]);
  const mixed1AnimId = pushAnim('SmallThenOversized', [
    { metaspriteId: smallMetaId, duration: 2 },
    { metaspriteId: oversizedMetaId, duration: 2 }
  ]);
  const mixed2AnimId = pushAnim('OversizedThenSmall', [
    { metaspriteId: oversizedMetaId, duration: 2 },
    { metaspriteId: smallMetaId, duration: 2 }
  ]);

  project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: dur1AnimId }; // flips BATTLE_ANIM_ENABLED on

  // The single normalization boundary (§15.6): normalizeProject is called
  // exactly ONCE, and that SAME returned object feeds both the ROM build
  // and the JS trace's own animation/metasprite reads -- never a private
  // normalizeAnimation/normalizeMetasprite import (neither is exported),
  // and never two independently normalized copies that could disagree.
  const normalized = normalizeProject(project);

  const room = battleFxOamRoom(normalized, resolveMapper(normalized.cartridge.mapper));
  assert.ok(room >= 3 && room <= 6, `room (${room}) must be in 3..6 after normalization -- the fixture's own retuning depends on this`);
  assert.equal(room, preliminaryRoom, 'room must not have moved between the preliminary (pre-fit-metasprite) measurement and the post-normalization one');

  // Fail loudly, never skip: every fixture metasprite's own normalized
  // tiles.length must equal its authored count -- nothing here may have been
  // silently sliced by normalizeMetasprite's own 16-tile ceiling.
  const expectedCounts = {
    [dur1MetaId]: 1,
    [dur255MetaId]: 1,
    [seq0MetaId]: 1,
    [seq1MetaId]: 1,
    [seq2MetaId]: 1,
    [seq3MetaId]: 1,
    [zeroTileMetaId]: 0,
    [smallMetaId]: 2,
    [oversizedMetaId]: oversizedCount,
    [exactMetaId]: exactCount,
    [oneOverMetaId]: oneOverCount
  };
  for (const [id, expectedCount] of Object.entries(expectedCounts)) {
    const actualCount = normalized.sprites.metasprites[Number(id)].tiles.length;
    assert.equal(actualCount, expectedCount, `metasprite ${id} must keep its authored ${expectedCount} tiles after normalization, got ${actualCount} -- normalizeMetasprite's 16-tile ceiling must not have truncated it`);
  }

  await saveProject(dir, normalized);
  const built = await buildProject({ dir, project: normalized, log: () => {} });

  // A reverse lookup from a drawn OAM tile byte back to the metasprite id it
  // came from -- the ROM's own answer must be identified this way, never by
  // re-running the JS side's own fit arithmetic (§15.6).
  const tileToMetaspriteId = new Map();
  for (const id of [
    dur1MetaId, dur255MetaId, seq0MetaId, seq1MetaId, seq2MetaId, seq3MetaId,
    smallMetaId, oversizedMetaId, exactMetaId, oneOverMetaId
  ]) {
    const firstTile = normalized.sprites.metasprites[id].tiles[0]?.tile;
    assert.ok(firstTile !== undefined, `metasprite ${id} must have at least one tile to key the reverse lookup on`);
    assert.ok(!tileToMetaspriteId.has(firstTile), `tile ${firstTile} must not already be claimed by another admitted metasprite -- disjoint blocks required`);
    tileToMetaspriteId.set(firstTile, id);
  }

  return {
    built,
    normalized,
    room,
    mapper,
    tileToMetaspriteId,
    ids: {
      dur1AnimId, dur255AnimId, seqAnimId, emptyAnimId, zeroTileAnimId,
      exactAnimId, oneOverAnimId, mixed1AnimId, mixed2AnimId
    }
  };
}

test('phase 3 §15.6 THE GATE: the frame-for-frame ROM trace matches renderer/widgets/battlefx.js exactly, case by case', {
  skip: needsSample
}, async (t) => {
  const { built, normalized, room, tileToMetaspriteId, ids } = await buildFxTraceFixture(t);
  const { BT_FX_ANIM, BT_FX_FRAME, BT_FX_TIMER } = resolveFxAddrs(built);
  const dir = path.dirname(path.dirname(built.romPath));
  const OAM_IDX = resolveEngineAddress(fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8'), 'oam_idx');

  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const armAt = addrOf('battle_fx_arm_at');
  const tick = addrOf('battle_fx_tick');
  const draw = addrOf('battle_fx_draw');
  nes.cpu.mem[BT_PHASE] = BP_MENU;

  const tileCount = (metaspriteId) => normalized.sprites.metasprites[metaspriteId].tiles.length;

  // Reads battle_fx_draw's own answer straight off the OAM shadow it wrote,
  // the :5386-5429/:6050-6079 way -- never derived from bt_fx_frame/anim.
  const readRomDrawn = () => {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, draw);
    if (nes.cpu.mem[OAM_IDX] === 0) return null;
    const tile = nes.cpu.mem[0x201]; // first OAM entry's own tile byte
    const metaspriteId = tileToMetaspriteId.get(tile);
    assert.ok(metaspriteId !== undefined, `drawn tile ${tile} must map back to one of the admitted metasprites' own disjoint blocks`);
    return metaspriteId;
  };

  const romObserve = () => {
    const anim = nes.cpu.mem[BT_FX_ANIM];
    const live = anim !== NO_ANIM;
    const rawFrame = nes.cpu.mem[BT_FX_FRAME];
    const rawTimer = nes.cpu.mem[BT_FX_TIMER];
    return {
      live,
      frame: live ? rawFrame : null,
      timer: live ? rawTimer : null,
      drawn: readRomDrawn(),
      _rawFrame: rawFrame,
      _rawTimer: rawTimer
    };
  };

  /**
   * Runs one fixture case: arms both the ROM (through battle_fx_arm_at, a
   * real call, never poking bt_fx_* by hand) and the JS stepper
   * (armBattleFx), then observes both at index 0 (BEFORE any tick) and after
   * every tick through `bound + 2`, asserting {live, frame, timer, drawn}
   * agree at every index. `animId` is NO_ANIM (0xff) for the "arms nothing"
   * cases; `jsAnimation` is null for those same cases (armBattleFx(null) is
   * the JS equivalent).
   */
  function traceCase(label, { animId, jsAnimation, bound }) {
    // Every case seeds a known, clean, inactive ROM state first (§15.6) --
    // explicitly reset, never left over from whatever the previous case's
    // own trace ended on.
    nes.cpu.mem[BT_FX_ANIM] = NO_ANIM;
    nes.cpu.mem[BT_FX_FRAME] = 0;
    nes.cpu.mem[BT_FX_TIMER] = 0;

    nes.cpu.REG_ACC = animId;
    nes.cpu.REG_Y = MAX_PARTY; // an arbitrary combatant slot, per the existing arm() helper above
    callRoutine(nes, armAt);

    let jsState = armBattleFx(jsAnimation);

    const compare = (index) => {
      const rom = romObserve();
      const jsDrawnId = drawnBattleFx(jsState, room, tileCount);
      const js = {
        live: jsState !== null,
        frame: jsState?.frame ?? null,
        timer: jsState?.timer ?? null,
        drawn: jsDrawnId
      };
      assert.deepEqual(
        { live: rom.live, frame: rom.frame, timer: rom.timer, drawn: rom.drawn },
        js,
        `${label}: observation ${index} (ROM raw frame/timer were ${rom._rawFrame}/${rom._rawTimer})`
      );
    };

    compare(0); // observation 0, taken BEFORE the first battle_fx_tick call (§15.6)
    for (let i = 1; i <= bound + 2; i++) {
      callRoutine(nes, tick);
      jsState = tickBattleFx(jsState);
      compare(i);
    }
  }

  const animOf = (id) => normalized.sprites.animations[id];
  const sumDurations = (id) => animOf(id).frames.reduce((total, f) => total + f.duration, 0);

  // Case 1: one frame, duration 1.
  traceCase('case 1 (dur1)', { animId: ids.dur1AnimId, jsAnimation: animOf(ids.dur1AnimId), bound: sumDurations(ids.dur1AnimId) });

  // Case 2: one frame, duration 255.
  traceCase('case 2 (dur255)', { animId: ids.dur255AnimId, jsAnimation: animOf(ids.dur255AnimId), bound: sumDurations(ids.dur255AnimId) });

  // Case 3: 4 frames, distinct durations, one at 255.
  traceCase('case 3 (sequence)', { animId: ids.seqAnimId, jsAnimation: animOf(ids.seqAnimId), bound: sumDurations(ids.seqAnimId) });

  // Case 4: an empty animation -- arms and immediately reverts.
  traceCase('case 4 (empty)', { animId: ids.emptyAnimId, jsAnimation: animOf(ids.emptyAnimId), bound: 0 });

  // Case 5: a single frame whose metasprite has zero tiles -- live and
  // ticking, but never draws (the room compare PASSES for it; it is
  // draw_metasprite's own separate, later ms_count == 0 return that stops it).
  traceCase('case 5 (zero-tile)', { animId: ids.zeroTileAnimId, jsAnimation: animOf(ids.zeroTileAnimId), bound: sumDurations(ids.zeroTileAnimId) });

  // Case 6: exact-room and room+1 fit cases.
  traceCase('case 6 (exact fit)', { animId: ids.exactAnimId, jsAnimation: animOf(ids.exactAnimId), bound: sumDurations(ids.exactAnimId) });
  traceCase('case 6 (one over)', { animId: ids.oneOverAnimId, jsAnimation: animOf(ids.oneOverAnimId), bound: sumDurations(ids.oneOverAnimId) });

  // Case 7: one frame exceeds room, one fits, in both orders.
  traceCase('case 7 (small then oversized)', { animId: ids.mixed1AnimId, jsAnimation: animOf(ids.mixed1AnimId), bound: sumDurations(ids.mixed1AnimId) });
  traceCase('case 7 (oversized then small)', { animId: ids.mixed2AnimId, jsAnimation: animOf(ids.mixed2AnimId), bound: sumDurations(ids.mixed2AnimId) });

  // Case 8: NO_ANIM itself, from a clean state -- genuinely armed (REG_ACC =
  // NO_ANIM), not skipped.
  traceCase('case 8 (NO_ANIM from clean)', { animId: NO_ANIM, jsAnimation: null, bound: 0 });

  // The two ROM-only cases (§15.6): arming over an ALREADY-LIVE effect,
  // asserting the engine's own contract directly -- armBattleFx is
  // deliberately restricted to fresh construction and models neither case,
  // so there is no JS side to compare against here.
  {
    // Live effect (the Sequence, mid-flight), then armed with NO_ANIM: the
    // second arm call must be a complete no-op (the early cmp #NO_ANIM/beq
    // returns before touching any state).
    nes.cpu.mem[BT_FX_ANIM] = NO_ANIM;
    nes.cpu.REG_ACC = ids.seqAnimId;
    nes.cpu.REG_Y = MAX_PARTY;
    callRoutine(nes, armAt);
    callRoutine(nes, tick);
    callRoutine(nes, tick); // frame 0, timer 2 of a duration-2 first frame -- advanced into frame 1, timer 0
    // P3-9 fix: two ticks alone leaves timer at exactly 0 (the Sequence's
    // own frame 0 has duration 2), which an incorrect arm path that resets
    // timer to 0 would also produce -- "timer unchanged" below could not
    // tell preservation from clearing. One more tick (frame 1's own
    // duration is 3) leaves BOTH frame and timer genuinely nonzero first.
    callRoutine(nes, tick);
    const animBefore = nes.cpu.mem[BT_FX_ANIM];
    const frameBefore = nes.cpu.mem[BT_FX_FRAME];
    const timerBefore = nes.cpu.mem[BT_FX_TIMER];
    assert.equal(animBefore, ids.seqAnimId, 'sanity: must genuinely still be live and mid-flight before the second arm call');
    assert.notEqual(frameBefore, 0, 'sanity: frame must be genuinely nonzero before the second arm call');
    assert.notEqual(timerBefore, 0, 'sanity: timer must be genuinely nonzero before the second arm call -- P3-9: two ticks alone leaves it at exactly 0');

    nes.cpu.REG_ACC = NO_ANIM;
    nes.cpu.REG_Y = MAX_PARTY;
    callRoutine(nes, armAt);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], animBefore, 'ROM-only case: arming NO_ANIM over a live effect must leave bt_fx_anim unchanged');
    assert.equal(nes.cpu.mem[BT_FX_FRAME], frameBefore, 'ROM-only case: arming NO_ANIM over a live effect must leave bt_fx_frame unchanged');
    assert.equal(nes.cpu.mem[BT_FX_TIMER], timerBefore, 'ROM-only case: arming NO_ANIM over a live effect must leave bt_fx_timer unchanged');
  }
  {
    // Live effect (the Sequence, mid-flight again), then armed with a real,
    // EMPTY animation: bt_fx_anim becomes NO_ANIM, but bt_fx_frame/timer are
    // left at whatever the previous effect held them at -- NOT reset to 0.
    nes.cpu.mem[BT_FX_ANIM] = NO_ANIM;
    nes.cpu.REG_ACC = ids.seqAnimId;
    nes.cpu.REG_Y = MAX_PARTY;
    callRoutine(nes, armAt);
    callRoutine(nes, tick);
    callRoutine(nes, tick); // frame 0, timer 2 of a duration-2 first frame -- advanced into frame 1, timer 0
    // P3-9 fix: the identical off-by-zero as the NO_ANIM case above -- one
    // more tick before capturing frameBefore/timerBefore so both are
    // genuinely nonzero, or "unchanged" cannot distinguish preservation
    // from clearing.
    callRoutine(nes, tick);
    const animLiveBefore = nes.cpu.mem[BT_FX_ANIM];
    const frameBefore = nes.cpu.mem[BT_FX_FRAME];
    const timerBefore = nes.cpu.mem[BT_FX_TIMER];
    assert.equal(animLiveBefore, ids.seqAnimId, 'sanity: must genuinely still be live and mid-flight before the second arm call');
    assert.notEqual(frameBefore, 0, 'sanity: frame must be genuinely nonzero before the second arm call');
    assert.notEqual(timerBefore, 0, 'sanity: timer must be genuinely nonzero before the second arm call -- P3-9: two ticks alone leaves it at exactly 0');

    nes.cpu.REG_ACC = ids.emptyAnimId;
    nes.cpu.REG_Y = MAX_PARTY;
    callRoutine(nes, armAt);
    assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'ROM-only case: arming a real, empty animation over a live effect must revert bt_fx_anim to NO_ANIM');
    assert.notEqual(nes.cpu.mem[BT_FX_ANIM], animLiveBefore, 'sanity: bt_fx_anim must actually have moved from the live Sequence id');
    assert.equal(nes.cpu.mem[BT_FX_FRAME], frameBefore, 'ROM-only case: arming an empty animation over a live effect must NOT reset bt_fx_frame to 0 -- battle_fx_arm_at_empty never touches it');
    assert.equal(nes.cpu.mem[BT_FX_TIMER], timerBefore, 'ROM-only case: arming an empty animation over a live effect must NOT reset bt_fx_timer to 0 either -- only bt_fx_anim moved');
  }
});

// Rendered-pixel overlap (docs/design-battle-animation.md §3.3): a real
// battle, a real combatant icon, a real armed effect over the same slot,
// and the actual jsnes PPU frame buffer read back -- not OAM order, not
// vram_buf, the pixels a player would actually see. Both the combatant's
// own icon (Slime's metasprite 1) and the effect get their own single,
// solid, distinct-colour tile (SOLID_TILE's own shape) so the overlap is
// unambiguous: whichever one rendered is directly readable off the screen,
// with no dependence on either art's own real (here, blank) pixel content.
test('the armed effect renders ON TOP of the combatant icon it overlaps, on the real PPU frame buffer', {
  skip: needsSample
}, async (t) => {
  const ICON_COLOR = '1'.repeat(64);
  const FX_COLOR = '2'.repeat(64);
  let fxAnimId;
  const built = await buildVariantFull(t, 'fx-pixel-overlap', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    const tileset = project.tilesets[project.rpg.battleTilesetId];
    const iconTile = 200;
    const fxTile = 201;
    tileset.sprites.tiles[iconTile] = ICON_COLOR;
    tileset.sprites.tiles[fxTile] = FX_COLOR;
    // Slime's own resting icon (draw_actor_icon -> its walkDown animation's
    // frame 0 -> this metasprite) becomes one solid, opaque tile.
    const slimeMetaId = project.sprites.actors[0].anims.walkDown;
    project.sprites.metasprites[slimeMetaId].tiles = [{ tile: iconTile, x: 0, y: 0, palette: 0, hflip: false, vflip: false }];
    const fxMetaId = project.sprites.metasprites.length;
    project.sprites.metasprites.push({
      id: fxMetaId,
      name: 'FxOverlap',
      tiles: [{ tile: fxTile, x: 0, y: 0, palette: 0, hflip: false, vflip: false }]
    });
    fxAnimId = project.sprites.animations.length;
    project.sprites.animations.push({ id: fxAnimId, name: 'FxOverlap', loop: false, frames: [{ metaspriteId: fxMetaId, duration: 30 }] });
    // Flips BATTLE_ANIM_ENABLED on -- without it, battle_fx_draw does not
    // even assemble, and setup_monsters never clears bt_fx_anim at all.
    // This test arms the effect by poking RAM directly, never through a
    // real cast, so which reference flips the gate does not matter.
    // battleTile: null forces Slime to draw as a SPRITE (draw_actor_icon)
    // rather than its shipped block art -- sample-rpg's own Slime has real
    // battle artwork, which battle_sprite_mon skips as an OAM sprite
    // entirely (it is drawn on the background instead), leaving nothing at
    // the combatant's own slot for the effect to overlap.
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, attackAnim: fxAnimId, battleTile: null };
  });
  const { BT_FX_ANIM, BT_FX_SLOT, BT_FX_FRAME, BT_FX_TIMER } = resolveFxAddrs(built);

  const state = { frame: null };
  const nes = new NES({ onFrame: (buffer) => (state.frame = buffer), emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 40; i++) nes.frame(); // boot()'s own settle, mirrored here for the frame-capturing nes
  finishNamingIfOpen(nes);
  const pixelAt = (x, y) => state.frame[y * 256 + x];

  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);
  assert.equal(nes.cpu.mem[BT_FX_ANIM], NO_ANIM, 'sanity: nothing armed yet');

  // Read a pixel inside the combatant's own 8x8 icon, one tile down and
  // right of the monster row/col origin's corner -- away from the exact
  // corner, which real hardware renders one scanline off (CLAUDE.md's own
  // split-cursor note).
  const x = BT_MON_COL * 8 + 4;
  const y = BT_MON_ROW * 8 + 4;
  nes.frame();
  const before = pixelAt(x, y);

  nes.cpu.mem[BT_FX_ANIM] = fxAnimId;
  nes.cpu.mem[BT_FX_SLOT] = MAX_PARTY; // the same slot the icon draws over
  nes.cpu.mem[BT_FX_FRAME] = 0;
  nes.cpu.mem[BT_FX_TIMER] = 0;
  nes.frame();
  // OAM DMA runs at the START of vblank, copying whatever mainline built
  // during the PREVIOUS frame -- so the frame that just ran rebuilt the
  // shadow with the effect now in it, but the sprite memory the PPU
  // actually reads for THAT frame's own picture is still last frame's. One
  // more frame is what actually gets the new shadow on screen.
  nes.frame();
  const after = pixelAt(x, y);

  assert.notEqual(after, before, 'arming the effect over the combatant’s own slot must change what renders at the overlap');
  // The two solid colours are read back directly from a frame where only
  // one or the other could possibly have drawn there, rather than assumed.
  nes.cpu.mem[BT_FX_ANIM] = NO_ANIM; // revert to icon-only for the control read
  nes.frame();
  nes.frame();
  const iconOnly = pixelAt(x, y);
  assert.equal(before, iconOnly, 'sanity: the icon-only colour is stable and reproducible');
});

// ---------------------------------------------------------------------------
// Battle-side animation, phase 2a -- hit feedback (docs/design-battle-
// animation.md §12). The shared bt_hurt_slot/bt_hurt_left pair: a sprite
// blink for a metasprite-drawn combatant, an attribute flash for a
// block-art monster. Driven almost entirely through isolated callRoutine
// calls, per the brief's own trap note: resuming real frame-stepping after
// a callRoutine excursion mid-battle-transition reproducibly crashes
// jsnes, so a lifecycle test (walking into a fight, playing it out) and an
// isolated routine test never mix on the same `nes` instance here.
// ---------------------------------------------------------------------------

const BT_TMP2 = 0x5d; // engine/constants.asm -- cast_all's own end-of-side sentinel
const PAD_NEW = 0x18; // engine/constants.asm -- buttons pressed this frame only
const VRAM_BUF = 0x0400; // engine/constants.asm
const BTN_A = 0x80; // engine/constants.asm
const BTN_B = 0x40;
const BTN_DOWN = 0x04;
const BP_ACT = 5; // engine/constants.asm -- resolve the chosen action
const BT_CMD = 0x6c; // engine/constants.asm -- the command chosen this turn

/**
 * Decode vram_buf's own packets -- [addr_hi, addr_lo, count, bytes...]
 * repeated up to `len`, a $00 high byte terminating early -- into a list of
 * {addr, bytes, data} (bytes including the 3-byte header, data the raw
 * payload bytes alone), for tests that need to see the real packet
 * composition, not just the total queued length. `data` is fix2's own
 * addition (item 1): existing callers only ever read `.addr`/`.bytes`, so
 * this is additive, not a behavior change for them.
 */
function decodeVramBuf(nes, len) {
  const out = [];
  let i = 0;
  while (i < len) {
    const hi = nes.cpu.mem[VRAM_BUF + i];
    if (hi === 0) break;
    const count = nes.cpu.mem[VRAM_BUF + i + 2];
    const data = [];
    for (let j = 0; j < count; j++) data.push(nes.cpu.mem[VRAM_BUF + i + 3 + j]);
    out.push({ addr: (hi << 8) | nes.cpu.mem[VRAM_BUF + i + 1], bytes: count + 3, data });
    i += 3 + count;
  }
  return out;
}
// draw_battle_attr's own attribute-table base ($23C0) plus the per-monster
// offset battle_hurt_attr_open/battle_hurt_restore_slot/draw_battle_attr all
// compute the same way: (slot+1)*8 rows down, +1 column in.
const ATTR_BASE = 0x23c0;
const attrAddrForMonSlot = (slot) => ATTR_BASE + (slot + 1) * 8 + 1;
const BT_GROUND_ATTR = 0x55; // engine/constants.asm
const FLASH_TINT = 0xff; // battle_hurt_tick's own flash write

/**
 * A hit-feedback build: no wandering encounters (every scenario below drives
 * combat state directly), rpg.hitFeedback on, and Slime's own battlePalette
 * bumped to 2 (attribute byte 0xAA) so the three attribute values this
 * section cares about -- ground (0x55), an authored tint (0xAA), and the
 * flash tint (0xFF) -- are always three DIFFERENT bytes. Left at Slime's
 * shipped palette (3 -> 0xFF) the authored tint and the flash tint would be
 * numerically identical, and no assertion here could tell them apart.
 */
async function buildHitFeedback(t, name, mutate = () => {}) {
  return buildVariantFull(t, name, (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.rpg.hitFeedback = true;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, battlePalette: 2 };
    mutate(project);
  });
}

/** Resolve the two bt_hurt_* zero-page bytes out of a build's own constants.asm. */
function resolveHurtAddrs(built) {
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  return {
    BT_HURT_SLOT: resolveEngineAddress(constantsText, 'bt_hurt_slot'),
    BT_HURT_LEFT: resolveEngineAddress(constantsText, 'bt_hurt_left')
  };
}

function resolveOamIdx(built) {
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  return resolveEngineAddress(constantsText, 'oam_idx');
}

/** Resolve the wipe state-machine's own two zero-page bytes. */
function resolveWipeAddrs(built) {
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  return {
    BT_WIPE_MASK: resolveEngineAddress(constantsText, 'bt_wipe_mask'),
    BT_WIPE_ROW: resolveEngineAddress(constantsText, 'bt_wipe_row')
  };
}

/**
 * Round 1 review, finding 1: a test that calls a routine directly proves
 * that routine, not that the game ever reaches it. The tests below drive
 * the REAL dispatcher by calling battle_tick itself (not a producer inside
 * it) through callRoutine -- a jsr into a stub, never nes.frame() -- with
 * pad_new poked directly to stand in for a button press for that one tick.
 * This is the battle-anim design reviewer's own independently-verified
 * technique; the orchestrator confirmed it reaches the real design-doc
 * figures (127, 48) against the unmodified engine and asked that it be
 * reused rather than rebuilt. It is not a return to isolated-call testing:
 * battle_tick is the real, complete per-frame dispatcher (wipe_tick ->
 * battle_hurt_tick -> battle_dispatch -> battle_draw_sprites), run start to
 * finish every time; only the controller hardware's own serial-read timing
 * is bypassed, which holding a real button down across several
 * nes.frame()/Emulator.stepInstruction() calls was found to desynchronize
 * badly enough to spuriously end the battle and re-trigger the touch
 * encounter several ticks later -- a hazard of simulating hardware timing
 * this precisely, not a hit-feedback defect (checked independently against
 * a clean, un-mutated battle with no hit feedback at all, where it does not
 * reproduce either).
 */

/**
 * Like callRoutine, but samples `readValue()` once per visit to `sampleAddr`
 * (not once per cycle spent there), until PC returns to the stub -- the
 * instrumented-trace fallback the brief's own §14 round 2 row calls for,
 * since a post-return read of a loop's own scratch byte can legitimately
 * differ from what the loop itself saw on every iteration (push_combatant_
 * name/cast_all_next both reuse bt_tmp2 for different things at different
 * moments).
 */
function callRoutineTrace(nes, address, sampleAddr, readValue) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  const samples = [];
  let wasAt = false;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    const at = (nes.cpu.REG_PC + 1) === sampleAddr;
    if (at && !wasAt) samples.push(readValue());
    wasAt = at;
    nes.cpu.emulate();
    assert.ok(++steps < 200000, 'routine never returned to the stub');
  }
  return samples;
}

// §14 round 2 (finding 4, P2) -- multi-target sentinel integrity, corrected
// observation point. Two cases: a low actor id (0, sample-rpg's own Slime)
// and a high one (31, a real, in-range actor above the loop boundary for a
// genuine 32-actor project, padActorsTo's own shape). bt_tmp2 is sampled
// AT cast_all_next, immediately after every apply_damage call -- never
// after cast_all returns, since push_combatant_name legitimately reuses
// bt_tmp2 once the loop is over.
//
// Wrong implementation this catches: the stated design (§12.3) is already
// correct here -- battle_hurt_attr_open/battle_hurt_restore_slot never
// touch bt_tmp2 at all -- so this row exists to make sure the TEST oracle
// watches the right moment; a test written as "call cast_all, then read
// bt_tmp2" would accept a broken engine that corrupts the sentinel mid-loop
// and then happens to leave it readable again by the time the call returns.
for (const [label, actorId, setup] of [
  ['low actor id (0, Slime)', 0, (project) => {}],
  ['high actor id (31, a padded 32-actor project)', 31, (project) => padActorsTo(project, 32)]
]) {
  test(`multi-target sentinel integrity: bt_tmp2 survives cast_all’s own loop, ${label}`, {
    skip: needsSample
  }, async (t) => {
    const built = await buildHitFeedback(t, `hf-sentinel-${actorId}`, (project) => {
      setup(project);
      project.spells[0].scope = 'all';
      project.spells[0].amountMin = 1;
      project.spells[0].amountMax = 1; // deterministic: n=1, no RNG dependency
      project.sprites.actors[actorId].hp = 100; // must survive its own hit
    });
    const nes = bootPastNaming(built.romPath);
    const addrOf = selectBattleBank(nes, built);
    const castAllNext = addrOf('cast_all_next');

    nes.cpu.mem[BT_PHASE] = BP_MENU;
    nes.cpu.mem[BT_ACTOR] = 0; // a party member -- other_side() targets the monster side
    nes.cpu.mem[BT_ARG] = 0; // spell 0, mutated to scope 'all' above
    for (let slot = 0; slot < 4; slot++) {
      nes.cpu.mem[MON_SLOT_ACTOR + slot] = actorId;
      nes.cpu.mem[MON_ALIVE + slot] = 1;
      nes.cpu.mem[MON_HP + slot] = 100;
    }
    const hpBefore = [0, 1, 2, 3].map((slot) => nes.cpu.mem[MON_HP + slot]);
    const pcHpBefore = [0, 1, 2, 3].map((slot) => nes.cpu.mem[PC_HP + slot]);

    const samples = callRoutineTrace(nes, addrOf('cast_all'), castAllNext, () => nes.cpu.mem[BT_TMP2]);

    assert.equal(samples.length, 4, 'cast_all_next should be visited exactly once per monster slot');
    for (const [i, sample] of samples.entries()) {
      assert.equal(sample, MAX_PARTY + 4, `bt_tmp2 must read cast_all’s own end-of-side sentinel (8) at iteration ${i}, not a corrupted value`);
    }
    for (let slot = 0; slot < 4; slot++) {
      assert.equal(hpBefore[slot] - nes.cpu.mem[MON_HP + slot], 1, `monster slot ${slot} must have taken exactly the rolled amount`);
    }
    for (let slot = 0; slot < 4; slot++) {
      assert.equal(nes.cpu.mem[PC_HP + slot], pcHpBefore[slot], `party member ${slot} must be untouched -- the cast targeted the other side`);
    }
  });
}

// mon_tile guard (§2(e)'s own limitation against Appendix C, reopened and
// closed by §12.1's explicit check): Snake (actor 3, sample-rpg) has no
// block art (battleTile: null -> mon_tile == $FF), so hit feedback on its
// slot must be a pure sprite blink -- battle_hurt_tick queues nothing, and
// only battle_sprite_mon’s own icon-skip applies.
test('mon_tile guard: hit feedback armed on a metasprite-fallback monster queues no attribute packet, only the icon skip happens', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-montile-guard');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const OAM_IDX = resolveOamIdx(built);

  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.mem[MON_SLOT_ACTOR] = 3; // Snake -- mon_tile == $FF
  nes.cpu.mem[MON_ALIVE] = 1;
  nes.cpu.mem[MON_HP] = 10;
  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY; // combatant 4 = monster slot 0
  nes.cpu.mem[BT_HURT_LEFT] = 5;
  nes.cpu.mem[VRAM_LEN] = 0;

  callRoutine(nes, addrOf('battle_hurt_tick'));
  assert.equal(nes.cpu.mem[VRAM_LEN], 0, 'battle_hurt_tick must queue no attribute packet for a metasprite-fallback monster');
  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 4, 'the shared timer must still count down even though nothing is drawn to the background');

  // The icon-skip half of the same mechanism still applies to Snake, on a
  // skip-band tick (2 & 2 != 0).
  nes.cpu.mem.fill(0xff, 0x200, 0x300);
  nes.cpu.mem[OAM_IDX] = 0;
  for (let slot = 0; slot < 4; slot++) nes.cpu.mem[PC_IN_PARTY + slot] = 0; // isolate the monster
  nes.cpu.mem[BT_HURT_LEFT] = 2; // 2 & 2 != 0 -- skip band
  nes.cpu.REG_X = 0;
  callRoutine(nes, addrOf('battle_sprite_mon'));
  assert.equal(nes.cpu.mem[OAM_IDX], 0, 'the icon itself must still be skipped on a skip-band tick');

  nes.cpu.mem.fill(0xff, 0x200, 0x300);
  nes.cpu.mem[OAM_IDX] = 0;
  nes.cpu.mem[BT_HURT_LEFT] = 4; // 4 & 2 == 0 -- draw band
  nes.cpu.REG_X = 0;
  callRoutine(nes, addrOf('battle_sprite_mon'));
  assert.ok(nes.cpu.mem[OAM_IDX] > 0, 'sanity: the icon does draw on a draw-band tick, so the skip-band result above is not a setup mistake');
});

// §14 round 1 -- dead-monster restoration, not abandonment (finding 2, P2).
// Round 1 review finding 3 (P2): rewritten for a REAL kill and a REAL wipe.
// A block-art monster reaches its starting tint (flash or authored) through
// real battle_hurt_tick ticks -- read off the PPU attribute byte afterwards,
// never written there directly -- then takes a lethal hit through a real
// attack_target (roll_hit -> physical_damage -> apply_damage ->
// apply_damage_mon, the same chain a real party turn runs), with a second
// monster alive throughout. Real battle_tick calls then run until wipe_tick
// has erased all four of the dead monster's rows and cleared its own
// bt_wipe_mask bit, checking at every step that the dead cell already reads
// BT_GROUND_ATTR and stays there, and that the live monster's own cell never
// moves.
// Wrong implementation this catches: the design's own previous policy
// ("abandon, no restore") passing this exact scenario with a permanently
// stranded $FF -- round 1's own seeded/isolated version of this test
// already caught that same mutation (round 2 review), so what this
// rewrite adds is integration through the real kill and the real wipe
// (apply_damage_mon's own bt_wipe_mask bit, wipe_tick's own row-by-row
// sweep) rather than a bug the helper-level check could not see at all.
for (const [label, framesBeforeDeath] of [
  ['mid-flash-tint (bt_hurt_left & 2 != 0)', 7], // decrements to 6; 6 & 2 = 2
  ['mid-authored-tint (bt_hurt_left & 2 == 0)', 6] // decrements to 5; 5 & 2 = 0
]) {
  test(`dead-monster restoration: a real killing hit on a flashing block-art monster restores BT_GROUND_ATTR through a real wipe, ${label}`, {
    skip: needsSample
  }, async (t) => {
    const built = await buildHitFeedback(t, `hf-dead-restore-real-${framesBeforeDeath}`, (project) => {
      project.party[0].acc = 255; // attacker: guarantee the lethal hit lands
      project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, eva: 0 };
    });
    const nes = bootPastNaming(built.romPath);
    const addrOf = selectBattleBank(nes, built);
    const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
    const { BT_WIPE_MASK, BT_WIPE_ROW } = resolveWipeAddrs(built);
    const battleTickAddr = addrOf('battle_tick');

    nes.cpu.mem[BT_PHASE] = BP_MENU;
    for (let slot = 0; slot < 2; slot++) {
      nes.cpu.mem[MON_SLOT_ACTOR + slot] = 0; // Slime, block art, attr 0xAA
      nes.cpu.mem[MON_ALIVE + slot] = 1;
      nes.cpu.mem[MON_HP + slot] = slot === 0 ? 1 : 100; // slot 0 dies to any scratch; slot 1 survives
    }
    nes.cpu.mem[BT_WIPE_MASK] = 0;
    nes.cpu.mem[BT_WIPE_ROW] = 0;
    nes.cpu.mem[RNG] = 0;
    nes.ppu.vramMem[attrAddrForMonSlot(1)] = 0xaa; // sentinel: the still-alive monster's own cell

    // Establish the real starting tint: arm slot 0, then run ONE real
    // battle_hurt_tick and drain it -- the attribute byte this produces is
    // read back below, never assumed.
    nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY + 0;
    nes.cpu.mem[BT_HURT_LEFT] = framesBeforeDeath;
    nes.cpu.mem[VRAM_LEN] = 0;
    callRoutine(nes, addrOf('battle_hurt_tick'));
    callRoutine(nes, addrOf('vram_drain'));
    const expectedStartTint = (nes.cpu.mem[BT_HURT_LEFT] & 2) !== 0 ? FLASH_TINT : 0xaa;
    assert.equal(
      nes.ppu.vramMem[attrAddrForMonSlot(0)],
      expectedStartTint,
      `a real tick must have produced the ${label} starting tint before the kill`
    );

    // The lethal hit through real damage handling: bt_actor (party member 0)
    // attacks bt_target (monster slot 0), with monster slot 1 alive and
    // untouched throughout.
    nes.cpu.mem[BT_ACTOR] = 0;
    nes.cpu.mem[BT_TARGET] = MAX_PARTY + 0;
    callRoutine(nes, addrOf('attack_target'));
    assert.equal(nes.cpu.mem[MON_ALIVE + 0], 0, 'the real attack must have killed slot 0');
    assert.equal(nes.cpu.mem[MON_ALIVE + 1], 1, 'slot 1 must still be alive -- only slot 0 was targeted');
    assert.notEqual(nes.cpu.mem[BT_WIPE_MASK] & 1, 0, 'apply_damage_mon must have queued slot 0 for a real wipe');

    // Real ticks: battle_hurt_tick's own dead-check fires on the very next
    // tick (bt_hurt_slot still names the now-dead slot 0), forcing
    // BT_GROUND_ATTR; wipe_tick pays down slot 0's four rows one a tick.
    // Both run inside the SAME real battle_tick dispatcher, not called in
    // isolation.
    for (let tick = 0; tick < 6; tick++) {
      nes.cpu.mem[PAD_NEW] = 0;
      nes.cpu.mem[VRAM_LEN] = 0;
      callRoutine(nes, battleTickAddr);
      callRoutine(nes, addrOf('vram_drain')); // real battle_tick only queues; NMI is what normally drains
      const attr0 = nes.ppu.vramMem[attrAddrForMonSlot(0)];
      assert.equal(attr0, BT_GROUND_ATTR, `tick ${tick}: the dead monster’s own cell must read as ground, never the stranded flash tint or its own authored tint`);
      assert.equal(nes.ppu.vramMem[attrAddrForMonSlot(1)], 0xaa, `tick ${tick}: the still-alive monster’s own cell must be untouched throughout`);
    }
    assert.equal(nes.cpu.mem[BT_WIPE_MASK], 0, 'four real ticks must have paid down all of slot 0’s rows and cleared its own wipe bit');
    assert.equal(nes.cpu.mem[BT_WIPE_ROW], 0, 'the wipe row counter must be back at zero once slot 0’s own sweep is complete');
  });
}

// §14 round 1 -- arm-time death restoration (finding 2's second path). An
// all-target spell's own cast_all loop kills a flashing block-art monster
// on an early iteration, then re-arms onto a different target on a later
// iteration in the SAME tick -- battle_hurt_tick never gets another chance
// to see the now-abandoned slot, so battle_hurt_restore_slot's own
// arm-time dead-check is the only thing that can still fix it.
// Wrong implementation this catches: battle_hurt_restore_slot skipping the
// dead old slot's own restore entirely (using mon_attr instead of
// BT_GROUND_ATTR), stranding the tint the tick-based fix alone cannot reach
// once the shared pair has moved on.
test('arm-time death restoration: cast_all killing the flashing monster then re-arming onto a later target restores BT_GROUND_ATTR', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-armtime-death', (project) => {
    project.spells[0].scope = 'all';
    project.spells[0].amountMin = 1;
    project.spells[0].amountMax = 1;
    project.sprites.actors[0].hp = 1; // every hit on this actor is lethal
  });
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);

  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.mem[BT_ACTOR] = 0;
  nes.cpu.mem[BT_ARG] = 0;
  for (let slot = 0; slot < 2; slot++) {
    nes.cpu.mem[MON_SLOT_ACTOR + slot] = 0; // Slime, block art
    nes.cpu.mem[MON_ALIVE + slot] = 1;
    nes.cpu.mem[MON_HP + slot] = 1; // one hit each -- slot 0 dies on the first target processed
  }
  nes.ppu.vramMem[attrAddrForMonSlot(0)] = 0xaa; // sentinel: not yet ground

  // Already flashing on slot 0 (target index MAX_PARTY+0) before the cast.
  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY + 0;
  nes.cpu.mem[BT_HURT_LEFT] = 20;

  callRoutine(nes, addrOf('cast_all'));
  callRoutine(nes, addrOf('vram_drain'));

  assert.equal(
    nes.ppu.vramMem[attrAddrForMonSlot(0)],
    BT_GROUND_ATTR,
    'the killed monster’s own cell must read as ground once the shared pair has moved on to a later target'
  );
  // Round 1 review: this message previously said "surviving target," but
  // slot 1 also has 1 HP and dies to the identical hit -- survival is not
  // what this path needs (battle_hurt_restore_slot's arm-time dead-check
  // fires the same way for a live or an already-dead new target); only that
  // the shared pair genuinely moved on to a LATER target is being asserted.
  assert.equal(nes.cpu.mem[BT_HURT_SLOT], MAX_PARTY + 1, 'the shared pair must have moved on to the later target processed by cast_all’s own loop');
});

// Multi-target hit-feedback policy: only the LAST target processed by an
// all-target spell ends up blinking/flashing. Round 1 review finding 4
// (P2): rewritten to give the three monsters distinct authored attribute
// values and observe the EARLIER targets' own visible cells -- not merely
// bt_hurt_slot/bt_hurt_left -- across a real battle_tick's own cast and
// every real feedback tick that follows. Wrong implementation this
// catches: an implementation that restores an earlier target's cell to the
// wrong value (or leaves the flash tint on it) once the shared pair moves
// off it, invisible to a test that only ever checks bt_hurt_slot/
// bt_hurt_left and never reads what the earlier targets' own cells
// actually show.
test('multi-target hit-feedback policy: an all-target spell hitting 3 living monsters leaves only the last slot flashing, through a real battle_tick', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-multitarget-policy-real', (project) => {
    project.spells[0].scope = 'all';
    project.spells[0].amountMin = 1;
    project.spells[0].amountMax = 1;
    // Three block-art monsters, three distinct authored attribute values
    // (palette*0x55): slot 0 = 0x00, slot 1 = 0xAA -- both deliberately off
    // BT_GROUND_ATTR (0x55) and FLASH_TINT (0xFF), so a sabotage that
    // stamps either reserved value on an earlier slot cannot hide behind a
    // coincidental match. Slot 2 (the one still named by the shared pair
    // afterwards) gets the remaining palette, 0x55 -- harmless there, since
    // this test never exercises ground-restore on a still-living monster.
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, battleTile: 32, battlePalette: 0 }; // Slime -> slot 0
    project.sprites.actors[1].battle = { ...project.sprites.actors[1].battle, battleTile: 32, battlePalette: 2 }; // Potion -> slot 1
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, battleTile: 32, battlePalette: 1 }; // Snake -> slot 2
    project.sprites.actors[0].hp = 100;
    project.sprites.actors[1].hp = 100;
    project.sprites.actors[3].hp = 100;
  });
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const battleTickAddr = addrOf('battle_tick');
  const ATTR0 = 0x00;
  const ATTR1 = 0xaa;
  const ATTR2 = 0x55;

  nes.cpu.mem[BT_PHASE] = BP_ACT; // a cast is pending, as in the queue-length tests above
  nes.cpu.mem[BT_ACTOR] = 0;
  nes.cpu.mem[BT_ARG] = 0;
  nes.cpu.mem[BT_CMD] = BC_MAGIC;
  nes.cpu.mem[MON_SLOT_ACTOR + 0] = 0; // Slime
  nes.cpu.mem[MON_SLOT_ACTOR + 1] = 1; // Potion
  nes.cpu.mem[MON_SLOT_ACTOR + 2] = 3; // Snake
  for (let slot = 0; slot < 3; slot++) {
    nes.cpu.mem[MON_ALIVE + slot] = 1;
    nes.cpu.mem[MON_HP + slot] = 100;
  }
  nes.cpu.mem[MON_ALIVE + 3] = 0; // only 3 living monsters this tick
  nes.cpu.mem[BT_HURT_LEFT] = 0; // nothing armed beforehand
  nes.cpu.mem[PAD_NEW] = 0;
  nes.cpu.mem[VRAM_LEN] = 0;

  // Round 2 review, "also from the review's notes": sample the final slot's
  // own cell too, before AND on this same cast frame. battle_hurt_tick runs
  // BEFORE battle_dispatch every tick (battle_tick's own order), and
  // bt_hurt_left was still 0 -- nothing armed -- at the moment this tick's
  // own battle_hurt_tick ran, so cast_all's own arm of slot 2 (later the
  // same tick) has nothing yet drawn for it. This build never calls
  // draw_battle_screen, so slot 2's attribute cell holds whatever the field
  // screen's own last redraw left at that nametable offset, not a bare
  // zero -- captured here rather than assumed, so the assertion below is
  // "still exactly what it was," not a guess at the byte's own value.
  const preCastAttr2 = nes.ppu.vramMem[attrAddrForMonSlot(2)];

  callRoutine(nes, battleTickAddr);
  callRoutine(nes, addrOf('vram_drain'));

  assert.equal(nes.cpu.mem[BT_HURT_SLOT], MAX_PARTY + 2, 'only the LAST living target processed should end up named by the shared pair');
  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20, 'the shared timer should be freshly armed for that last target, not left mid-count from an earlier one');
  assert.equal(nes.ppu.vramMem[attrAddrForMonSlot(0)], ATTR0, 'slot 0 must already show its own authored attribute on the very frame the shared pair moved past it');
  assert.equal(nes.ppu.vramMem[attrAddrForMonSlot(1)], ATTR1, 'slot 1 must already show its own authored attribute on the very frame the shared pair moved past it');
  assert.equal(nes.ppu.vramMem[attrAddrForMonSlot(2)], preCastAttr2, 'slot 2, newly armed this same tick, must show nothing drawn yet -- battle_hurt_tick had already run, with nothing armed, before cast_all armed it');

  // Every following real tick: slots 0 and 1 must keep their own authored
  // values throughout -- not a single visible tick of anything else --
  // while only slot 2 (the one still named by the shared pair) alternates
  // between the flash tint and its own authored value. Slot 2's own
  // expectation is derived from an INDEPENDENTLY PREDICTED countdown
  // (max(0, 20 - (tick + 1)), the identical convention the party-blink
  // real-lifecycle test uses), asserted against the real register first --
  // deriving "expected" from the observed bt_hurt_left instead (round 2
  // review) cannot tell a real countdown apart from a frozen one, since
  // both read back self-consistently against whatever battle_hurt_tick did
  // or did not do.
  for (let tick = 0; tick < 20; tick++) {
    nes.cpu.mem[PAD_NEW] = 0;
    nes.cpu.mem[VRAM_LEN] = 0;
    callRoutine(nes, battleTickAddr);
    callRoutine(nes, addrOf('vram_drain'));
    assert.equal(nes.ppu.vramMem[attrAddrForMonSlot(0)], ATTR0, `tick ${tick}: slot 0 must never show anything but its own authored attribute`);
    assert.equal(nes.ppu.vramMem[attrAddrForMonSlot(1)], ATTR1, `tick ${tick}: slot 1 must never show anything but its own authored attribute`);
    const predictedLeft = Math.max(0, 20 - (tick + 1));
    assert.equal(nes.cpu.mem[BT_HURT_LEFT], predictedLeft, `tick ${tick}: battle_tick's own battle_hurt_tick must have decremented bt_hurt_left for real`);
    const expectedSlot2 = predictedLeft !== 0 && (predictedLeft & 2) !== 0 ? FLASH_TINT : ATTR2;
    assert.equal(
      nes.ppu.vramMem[attrAddrForMonSlot(2)],
      expectedSlot2,
      `tick ${tick}: slot 2 (predicted bt_hurt_left=${predictedLeft}) should show ${expectedSlot2 === FLASH_TINT ? 'the flash tint' : 'its own authored attribute'}`
    );
  }
});

// §14 round 2 -- vram_buf queue-length, corrected schedules (finding 1, P2).
// Two cases, both counted on the queue itself. Round 1 review finding 1:
// rewritten to drive both schedules through a REAL battle_tick execution --
// the old versions called battle_hurt_tick and cast_all directly (case a)
// or wipe_tick/battle_hurt_tick/battle_list_back directly with a seeded
// open list (case b), which proves each producer's own byte cost in
// isolation but never that the real dispatcher reaches all of them
// together on one tick, and the reviewer showed all 14 engine tests (this
// pair included) still pass with battle_tick's own jsr battle_hurt_tick
// replaced by three nops. Both cases below call battle_tick itself --
// wipe_tick, battle_hurt_tick, battle_dispatch and battle_draw_sprites are
// all reached in their real order, in one call -- through callRoutine (a
// jsr into the stub, never nes.frame()), with pad_new poked directly to
// stand in for a button press: this is the design reviewer's own
// independently-verified technique (review-runtime.mjs), reused here
// rather than rebuilt, because it sidesteps a real hazard the orchestrator
// confirmed empirically: holding a real controller button down across
// several nes.frame()/Emulator.stepInstruction() calls (needed to land
// exactly mid-tick, before that tick's own NMI drains the queue) was found
// to desynchronize dispatch_input's own edge detection badly enough to
// spuriously end the battle and re-trigger the touch encounter, several
// ticks later -- a real hazard of simulating hardware button timing this
// precisely, not a defect in do_action_cancel or the hit-feedback engine
// code itself (do_action_cancel's own ST_BATTLE fallthrough to close_ui
// was independently checked against a clean, minimal, un-mutated battle
// and never reproduced there). Driving pad_new directly is not a
// step down to an isolated call: battle_tick is still the real, complete
// per-frame dispatcher, run start to finish: nothing about its own
// sequencing is bypassed, only the controller hardware's own serial-read
// timing is, which no wrong implementation of hit feedback could exploit.
// Wrong implementation this catches: a producer that the real dispatch
// chain never actually reaches on the tick §12.6/the brief describes --
// entirely invisible to a test that calls each producer directly instead
// of letting battle_tick's own real sequencing decide what runs.
test('vram_buf queue length: the 20-byte feedback maximum, distinct from cast_all’s own 28-byte message, through a real battle_tick', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-vrambuf-20', (project) => {
    project.spells[0].scope = 'all';
    project.spells[0].amountMin = 1;
    project.spells[0].amountMax = 1;
    project.sprites.actors[0].hp = 100;
  });
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const battleTickAddr = addrOf('battle_tick');
  const printNumAddr = addrOf('print_num');

  for (let slot = 0; slot < 4; slot++) {
    nes.cpu.mem[MON_SLOT_ACTOR + slot] = 0; // Slime, block art, attr 0xAA
    nes.cpu.mem[MON_ALIVE + slot] = 1;
    nes.cpu.mem[MON_HP + slot] = 100;
  }
  nes.cpu.mem[BT_ACTOR] = 0; // a party member -- other_side() targets the monster side
  nes.cpu.mem[BT_ARG] = 0; // spell 0, mutated to scope 'all' above
  nes.cpu.mem[BT_CMD] = BC_MAGIC; // battle_act checks this to reach cast_spell, not attack_target
  // Already flashing on the 4th monster (slot 3, combatant MAX_PARTY+3).
  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY + 3;
  nes.cpu.mem[BT_HURT_LEFT] = 20;
  // bt_phase = BP_ACT: the real dispatcher resolves the pending cast on
  // this very tick (the same state spell_chosen's own scope-'all' branch
  // leaves behind, one real button press earlier -- seeding straight to it
  // is the allowed "precondition in RAM," the event under test is real).
  nes.cpu.mem[BT_PHASE] = BP_ACT;
  nes.cpu.mem[PAD_NEW] = 0;
  nes.cpu.mem[VRAM_LEN] = 0;

  // Sample vram_len the instant this tick's own execution reaches
  // print_num (cast_all's own trailing message), so the feedback packets
  // are counted separately from the message -- a temporary
  // nes.cpu.emulate() wrapper observing PC on every real instruction this
  // single battle_tick call executes, never a second, separate call.
  let sampledAt20 = null;
  const originalEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (sampledAt20 === null && (nes.cpu.REG_PC + 1) === printNumAddr) sampledAt20 = nes.cpu.mem[VRAM_LEN];
    return originalEmulate();
  };
  callRoutine(nes, battleTickAddr);
  nes.cpu.emulate = originalEmulate;

  assert.equal(sampledAt20, 20, 'exactly 5 feedback packets (20 bytes) must be queued by the time this tick’s own cast_all reaches its own message, through the real battle_tick dispatcher (wipe_tick -> battle_hurt_tick -> battle_dispatch -> battle_act -> cast_spell -> cast_all)');
  assert.equal(nes.cpu.mem[VRAM_LEN], 48, 'the full tick must queue 20 feedback bytes plus cast_all’s own 28-byte message (13 name + 15 string), 48 total');

  // Round 2 review, "also from the review's notes": decodeVramBuf was
  // written but never used -- assert the actual packet COMPOSITION, not
  // only the totals a coincidentally-wrong sum could still satisfy. The
  // first 5 packets queued (indices 0-19 of the 48 total) must each be a
  // bare 4-byte attribute write (3-byte header + 1 attribute byte) --
  // battle_hurt_arm/battle_hurt_restore_slot's own shape -- and the
  // remaining bytes must be cast_all's own two message packets, 13 and 15
  // bytes, in that order (the name row, then the rest of the line).
  const packets = decodeVramBuf(nes, 48);
  const feedbackPackets = packets.slice(0, 5);
  const messagePackets = packets.slice(5);
  assert.equal(feedbackPackets.length, 5, 'exactly 5 packets must be queued before the message packets');
  for (const [i, p] of feedbackPackets.entries()) {
    assert.equal(p.bytes, 4, `feedback packet ${i}: must be a bare 4-byte attribute write (3-byte header + 1 attribute byte), not a differently-shaped packet`);
  }
  // Round 3 review finding 2 (P3): a same-sized packet queued at the WRONG
  // cell would satisfy the byte-count assertions above -- assert each
  // packet's own destination. Order: battle_hurt_tick's own ongoing flash
  // on the already-flashing slot 3, then cast_all's own loop restoring the
  // superseded slot -- 3 again (the shared pair moving off it onto target
  // 0), then 0, then 1, then 2 (each restored as the pair moves on to the
  // next target).
  assert.deepEqual(
    feedbackPackets.map((p) => p.addr),
    [3, 3, 0, 1, 2].map((slot) => attrAddrForMonSlot(slot)),
    'the five feedback packets must land at monster slots [3, 3, 0, 1, 2] in that order -- the ongoing flash on slot 3, then the restore of slot 3 as the pair moves onto target 0, then the restores of 0, 1 and 2 as it moves on again each time'
  );
  assert.deepEqual(messagePackets.map((p) => p.bytes), [13, 15], 'cast_all’s own message must be exactly two packets, 13 bytes then 15 bytes, following the 5 feedback packets');
});

// §12.6's own six-tick sequence: an all-target spell kills three monsters
// and leaves the fourth flashing; A dismisses the message; the next actor's
// own menu opens; Down selects MAGIC; A opens the spell list; B closes it.
// Six real battle_tick calls, each with pad_new poked to stand in for
// exactly the one button that tick's own real dispatch would have read --
// the design reviewer's own independently-verified technique
// (review-runtime.mjs), confirmed to reach 127 on the real, unmodified
// engine before this brief's own round of work began.
test('vram_buf queue length: the 127-byte whole-frame maximum (a wipe, a flash, and battle_list_back closing in the same tick), through six real battle_tick executions', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-vrambuf-127', (project) => {
    project.spells[0].scope = 'all';
    project.spells[0].amountMin = 5;
    project.spells[0].amountMax = 5; // deterministic: kills the three 5-HP monsters, not the 999-HP fourth
  });
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const battleTickAddr = addrOf('battle_tick');
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const ram = (name) => resolveEngineAddress(constantsText, name);
  const BT_WIPE_MASK = ram('bt_wipe_mask');
  const BT_WIPE_ROW = ram('bt_wipe_row');
  const BT_CMD = ram('bt_cmd');
  const BT_ROUND = ram('bt_round');
  const BT_FLEE = ram('bt_flee');
  const BT_PTICK = ram('bt_ptick');
  const STATUS_PENDING = ram('status_pending');
  const PC_STATUS = ram('pc_status');
  const PC_SPELLS = ram('pc_spells');
  const TURN_ORDER = ram('turn_order');
  const BT_COUNT = ram('bt_count');

  for (let slot = 0; slot < 4; slot++) {
    nes.cpu.mem[MON_SLOT_ACTOR + slot] = 0; // Slime, block art
    nes.cpu.mem[MON_ALIVE + slot] = 1;
    // Round 2 review finding 3 (P3): 999 written into MON_HP -- a
    // Uint8Array-backed view -- silently truncates to 231, not the intended
    // "survives everything" figure; 100 is a genuinely in-range HP that
    // still survives the 5-damage cast on the three doomed slots.
    nes.cpu.mem[MON_HP + slot] = slot < 3 ? 5 : 100; // slots 0-2 die to the cast, slot 3 survives
    nes.cpu.mem[PC_STATUS + slot] = 0;
    nes.cpu.mem[PC_SPELLS + slot] = 1; // party member 0 knows spell 0
    nes.cpu.mem[TURN_ORDER + slot] = slot;
  }
  nes.cpu.mem[BT_ACTOR] = 0;
  nes.cpu.mem[BT_ARG] = 0;
  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY;
  nes.cpu.mem[BT_HURT_LEFT] = 0; // nothing flashing yet -- the cast arms it for real
  nes.cpu.mem[BT_PHASE] = BP_ACT; // seeded straight to "a cast is pending", as in the 20-byte test above
  nes.cpu.mem[BT_CMD] = BC_MAGIC;
  nes.cpu.mem[BT_ROUND] = 0;
  nes.cpu.mem[BT_FLEE] = 0;
  nes.cpu.mem[BT_PTICK] = 0;
  nes.cpu.mem[STATUS_PENDING] = 0;
  nes.cpu.mem[BT_WIPE_MASK] = 0;
  nes.cpu.mem[BT_WIPE_ROW] = 0;
  // Round 2 review finding 3: four living monsters need bt_count = 4 --
  // left at its RAM-reset default of 0, the three kills below underflow it
  // to 253 instead of a real, in-range surviving count.
  nes.cpu.mem[BT_COUNT] = 4;

  const ticks = [
    ['(1) cast the all-target spell', 0],
    ['(2) A dismisses the resulting message', BTN_A],
    ["(3) the next actor's own menu opens", 0],
    ['(4) Down selects MAGIC', BTN_DOWN],
    ['(5) A opens the spell list', BTN_A],
    ['(6) B closes it -- battle_list_back, on the same tick as the still-owed wipe row and the still-live flash', BTN_B]
  ];
  let queued = null;
  for (const [label, pad] of ticks) {
    nes.cpu.mem[PAD_NEW] = pad;
    nes.cpu.mem[VRAM_LEN] = 0;
    callRoutine(nes, battleTickAddr);
    queued = nes.cpu.mem[VRAM_LEN];
    if (label.startsWith('(1)')) {
      assert.equal(nes.cpu.mem[MON_ALIVE + 0], 0, 'slot 0 should have died to the cast');
      assert.equal(nes.cpu.mem[MON_ALIVE + 1], 0, 'slot 1 should have died to the cast');
      assert.equal(nes.cpu.mem[MON_ALIVE + 2], 0, 'slot 2 should have died to the cast');
      assert.equal(nes.cpu.mem[MON_ALIVE + 3], 1, 'slot 3 should have survived the cast');
      assert.equal(nes.cpu.mem[BT_HURT_SLOT], MAX_PARTY + 3, 'the shared pair should be flashing the surviving 4th monster after the cast');
      assert.equal(nes.cpu.mem[BT_COUNT], 1, 'bt_count must read a real, in-range surviving count (1) after the three kills, not an underflowed 253');
      assert.equal(nes.cpu.mem[MON_HP + 3], 93, 'the survivor’s own HP must reflect a real, in-range starting value taking the cast’s own damage, not a truncated 999-turned-231 sentinel');
    }
  }

  assert.equal(queued, 127, 'the whole-frame maximum on the sixth (B-press) tick must be exactly 11 (wipe) + 4 (flash) + 112 (battle_list_back) = 127 bytes');

  // Round 2 review, "also from the review's notes": assert the sixth tick's
  // own packet COMPOSITION with decodeVramBuf, not only its 127-byte total
  // -- one 11-byte wipe-row packet (the still-owed wipe from the earlier
  // kills), one 4-byte attribute packet at the still-flashing monster's own
  // cell, and battle_list_back's own packets summing to 112.
  const packets = decodeVramBuf(nes, queued);
  assert.equal(packets[0].bytes, 11, 'the first packet on this tick must be the 11-byte wipe row still owed from the earlier kills');
  assert.equal(packets[1].bytes, 4, 'the second packet must be the 4-byte attribute write for the still-flashing monster’s own cell');
  // Round 3 review finding 2 (P3): a same-sized packet queued at the WRONG
  // address would satisfy the byte-count assertion above while still
  // corrupting a different cell -- assert the second packet's own
  // destination, not only its length.
  assert.equal(packets[1].addr, attrAddrForMonSlot(3), 'the second packet must land at slot 3’s own attribute cell -- the still-flashing survivor -- not merely be 4 bytes long');
  const listBackBytes = packets.slice(2).reduce((sum, p) => sum + p.bytes, 0);
  assert.equal(listBackBytes, 112, 'every packet after the wipe and the flash must be battle_list_back’s own closing redraw, summing to exactly 112 bytes');
});

// §14 round 1 (corrected round 2) -- hit-flash trace, both bands and
// cessation. Samples the real PPU attribute byte on every tick of the
// full BT_HURT_FRAMES (20) countdown.
test('hit-flash trace: two-tick bands of each tint, the terminal tick forcing the authored tint, cessation confirmed on the queue itself', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-flash-trace');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);

  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.mem[MON_SLOT_ACTOR] = 0; // Slime, block art, attr 0xAA
  nes.cpu.mem[MON_ALIVE] = 1;
  nes.cpu.mem[MON_HP] = 10;
  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY;
  nes.cpu.mem[BT_HURT_LEFT] = 20; // BT_HURT_FRAMES

  const tints = [];
  const queued = [];
  for (let tick = 0; tick < 22; tick++) {
    nes.cpu.mem[VRAM_LEN] = 0;
    callRoutine(nes, addrOf('battle_hurt_tick'));
    queued.push(nes.cpu.mem[VRAM_LEN] > 0);
    callRoutine(nes, addrOf('vram_drain'));
    tints.push(nes.ppu.vramMem[attrAddrForMonSlot(0)]);
  }

  // Ticks 1-19 (index 0-18): the countdown decrements from 20 to 1, so the
  // value tested by "and #2" is bt_hurt_left AFTER the decrement, i.e.
  // 19,18,...,1 across these 19 ticks -- two-tick bands of each tint.
  for (let i = 0; i < 19; i++) {
    const leftAfterDec = 19 - i; // 19 down to 1
    const expected = (leftAfterDec & 2) !== 0 ? FLASH_TINT : 0xaa;
    assert.equal(tints[i], expected, `tick ${i + 1}: bt_hurt_left=${leftAfterDec} should show ${expected === FLASH_TINT ? 'the flash tint' : 'the authored tint'}`);
    assert.ok(queued[i], `tick ${i + 1}: a packet must be queued every tick while bt_hurt_left is nonzero`);
  }
  // Tick 20 (index 19): bt_hurt_left reaches 0 -- the terminal tick, which
  // must force the authored tint regardless of which band it would
  // otherwise have landed in.
  assert.equal(tints[19], 0xaa, 'the terminal tick must force the authored tint');
  assert.ok(queued[19], 'the terminal tick must still queue its own packet');
  // No packet on any tick after the terminal one -- cessation confirmed on
  // the queue itself, not merely a stable PPU byte (which cannot by itself
  // distinguish "nothing queued" from "the same value queued twice").
  for (let i = 20; i < 22; i++) {
    assert.equal(queued[i], false, `tick ${i + 1}: no packet may be queued once the countdown has already reached 0`);
    assert.equal(tints[i], 0xaa, `tick ${i + 1}: the last-drawn tint must still read as the authored one, unchanged`);
  }
});

// §14 round 5 -- BP_INTRO guard, hurt timer (split from the old combined
// row). A stale timer from a previous battle must not tick or queue
// anything while bt_phase still reads BP_INTRO.
test('BP_INTRO guard: a stale bt_hurt_left neither decrements nor queues anything on the first, still-BP_INTRO tick', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-bpintro-guard');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);

  nes.cpu.mem[BT_PHASE] = BP_INTRO;
  nes.cpu.mem[MON_SLOT_ACTOR] = 0;
  nes.cpu.mem[MON_ALIVE] = 1;
  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY; // stale from a previous battle
  nes.cpu.mem[BT_HURT_LEFT] = 20;
  nes.cpu.mem[VRAM_LEN] = 0;

  callRoutine(nes, addrOf('battle_hurt_tick'));

  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20, 'battle_hurt_tick must not decrement the stale timer while bt_phase still reads BP_INTRO');
  assert.equal(nes.cpu.mem[VRAM_LEN], 0, 'battle_hurt_tick must queue nothing while bt_phase still reads BP_INTRO');
});

// §14 round 5 -- battle-entry reset, hurt timer (split from the old
// combined row). A timer left counting down at the end of one battle
// (neither battle_end nor player_died clears it, §12.4) must read 0 once
// the NEXT battle's own setup_monsters has run.
test('battle-entry reset: a hurt timer still counting down at the end of one battle reads 0 once the next battle’s setup_monsters has run', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-entry-reset');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);

  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY;
  nes.cpu.mem[BT_HURT_LEFT] = 11; // still counting down, as if the battle just ended mid-flash

  callRoutine(nes, addrOf('setup_monsters'));

  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 0, 'setup_monsters must clear bt_hurt_left for the next battle');
});

// Orchestrator addition (not a §14 row): party-member blink. The case a
// player sees most, and no §14 row covers it -- battle_sprite_pc's own
// skip-check, isolated the identical way the monster-side tests above are.
test('party-member blink: the named party member’s icon is absent from OAM exactly on skip-band ticks; an unrelated member draws on every tick', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-party-blink');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const OAM_IDX = resolveOamIdx(built);

  // Isolate member 0 alone: no other party member, no living monster, so
  // any OAM bytes written can only be member 0's own icon.
  nes.cpu.mem[PC_IN_PARTY] = 1;
  nes.cpu.mem[PC_HP] = 50;
  for (let slot = 1; slot < 4; slot++) nes.cpu.mem[PC_IN_PARTY + slot] = 0;
  for (let slot = 0; slot < 4; slot++) nes.cpu.mem[MON_ALIVE + slot] = 0;
  nes.cpu.mem[BT_HURT_SLOT] = 0; // member 0

  let drawnBytes = null;
  for (let hurtLeft = 0; hurtLeft <= 20; hurtLeft++) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    nes.cpu.mem[BT_HURT_LEFT] = hurtLeft;
    nes.cpu.REG_X = 0;
    callRoutine(nes, addrOf('battle_sprite_pc'));
    const skipped = hurtLeft !== 0 && (hurtLeft & 2) !== 0;
    if (!skipped) {
      if (drawnBytes === null) drawnBytes = nes.cpu.mem[OAM_IDX];
      assert.equal(nes.cpu.mem[OAM_IDX], drawnBytes, `hurtLeft=${hurtLeft}: a draw tick must write the same byte count every time`);
      assert.ok(drawnBytes > 0, 'sanity: a draw tick must write at least one OAM entry');
    } else {
      assert.equal(nes.cpu.mem[OAM_IDX], 0, `hurtLeft=${hurtLeft} (a skip-band tick, bit 1 set): the icon must be entirely absent from OAM`);
    }
  }

  // An unrelated combatant (member 1, bt_hurt_slot still naming member 0)
  // must draw on every tick, regardless of bt_hurt_left.
  nes.cpu.mem[PC_IN_PARTY] = 0;
  nes.cpu.mem[PC_IN_PARTY + 1] = 1;
  nes.cpu.mem[PC_HP + 1] = 50;
  let unrelatedBytes = null;
  for (const hurtLeft of [0, 2, 3, 4, 20]) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    nes.cpu.mem[BT_HURT_LEFT] = hurtLeft;
    nes.cpu.REG_X = 0;
    callRoutine(nes, addrOf('battle_sprite_pc'));
    if (unrelatedBytes === null) unrelatedBytes = nes.cpu.mem[OAM_IDX];
    assert.ok(nes.cpu.mem[OAM_IDX] > 0, `hurtLeft=${hurtLeft}: an unrelated party member must still draw`);
    assert.equal(nes.cpu.mem[OAM_IDX], unrelatedBytes, `hurtLeft=${hurtLeft}: an unrelated party member’s own draw must be unaffected by bt_hurt_left`);
  }
});

// Round 2 review finding 2 (P2): the two lifecycle tests below previously
// only ever SEEDED bt_phase = BP_INTRO by hand -- an undeclared substitute
// for the brief's own explicit "a real battle ends through battle_end ... a
// real next battle entry" requirement, since no battle_end or battle_begin
// call ever actually ran, and the all-$FF monster array was a synthetic
// formation rather than one a real entry point populated. This helper drives
// both for real, through callRoutine (the instruction-step harness -- never
// resuming nes.frame(), which the brief says is unnecessary here and which
// 1b's own history already showed can desynchronize dispatch_input's edge
// detection when a real button is held across several frame-stepped calls):
// a coherent battle about to end, with bt_hurt_left nonzero because a hit is
// still counting down, ends through a real battle_end (kernel-resident, so
// the field's own screen bank -- not the battle bank -- must still be
// switched in for its own jsr redraw_screen to draw the right screen); then
// a real, valid one-monster formation is seeded as the precondition
// battle_begin does not itself own (the same precondition allowance already
// used elsewhere in this file, e.g. the monster HP/alive seeds before a
// cast); then a real battle_begin (also kernel-resident) enters the next
// battle for real. Only once both real transitions have run does this
// switch in the battle bank, for the caller's own first real battle_tick.
// `missLeftBeforeEnd` (fix1, brief item 3): the stale MISS value alongside
// `hurtLeftBeforeEnd`, rather than a duplicated MISS-only helper. `null`
// (the default, every pre-fix1 call site's own behavior, unchanged) means
// "this timer is not part of this scenario": hurtLeftBeforeEnd === null
// turns rpg.hitFeedback OFF for the build (a real MISS-alone lifecycle),
// missLeftBeforeEnd === null leaves rpg.miss at its own default (false,
// since buildHitFeedback never sets it) -- both non-null builds a real
// both-toggles-live lifecycle. buildHitFeedback's own mutate callback runs
// AFTER its unconditional `project.rpg.hitFeedback = true`, so this can
// still override it back to false for the MISS-alone case with no change
// to buildHitFeedback itself.
async function enterBattleForRealAfterEnding(t, name, hurtLeftBeforeEnd, missLeftBeforeEnd = null) {
  const built = await buildHitFeedback(t, name, (project) => {
    if (hurtLeftBeforeEnd === null) project.rpg.hitFeedback = false;
    if (missLeftBeforeEnd !== null) project.rpg.miss = true;
  });
  const nes = bootPastNaming(built.romPath);
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const ram = (n) => resolveEngineAddress(constantsText, n);
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const kernelAddrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built); // unconditional equates -- always resolvable, gated or not
  const BT_FROM_ENT = ram('bt_from_ent');
  const BT_FLEE = ram('bt_flee');
  const TALK_ENT = ram('talk_ent');
  const BT_OWNER_ENT = ram('bt_owner_ent');
  const SCRIPT_ACTIVE = ram('script_active');

  // A coherent battle about to end, with a hit and/or a miss still counting
  // down (whichever this scenario asked for -- see the header comment).
  // Round 3 review finding 3 (P3): battle_end's own event-owner restore
  // (engine/rpg.asm) keys off bt_owner_ent -- left at whatever boot
  // happened to leave it (a real, in-range entity slot, 0), it walked
  // ent_active/ent_record looking for a match and, on finding one,
  // silently restored talk_ent to that slot, exercising the SCRIPTED-
  // event-owner path instead of the clean no-owner one this scenario means
  // to seed. bt_owner_ent = NO_ENTITY ($FF) takes battle_end's own
  // `cpx #MAX_ENTITIES / bcs battle_end_no_restore` branch immediately, the
  // same way bt_from_ent/talk_ent already do for their own checks.
  // script_active is kept explicitly 0 too, for the same reason: this is a
  // non-scripted scenario (a random or contact-damage fight, never one
  // reached mid-script), and battle_end's own post-restore branch
  // (gameplay vs. frozen dialog) reads it to decide which.
  if (hurtLeftBeforeEnd !== null) {
    nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY;
    nes.cpu.mem[BT_HURT_LEFT] = hurtLeftBeforeEnd;
  }
  if (missLeftBeforeEnd !== null) {
    nes.cpu.mem[BT_MISS_SLOT] = MAX_PARTY;
    nes.cpu.mem[BT_MISS_LEFT] = missLeftBeforeEnd;
  }
  nes.cpu.mem[BT_FROM_ENT] = 0xff; // NO_ENTITY -- no touch-encounter actor to restore
  nes.cpu.mem[BT_FLEE] = 0; // not fleeing -- battle_end's own entity-touch branch runs
  nes.cpu.mem[TALK_ENT] = 0xff; // NO_ENTITY -- nobody being spoken to
  nes.cpu.mem[BT_OWNER_ENT] = 0xff; // NO_ENTITY -- no suspended script's own event to restore
  nes.cpu.mem[SCRIPT_ACTIVE] = 0; // no script mid-run -- the clean gameplay path, not the frozen-dialog one
  // battle_outcome (engine/battleturn.asm) is what actually sets bt_phase
  // to BP_DONE, right before battle_dispatch's own BP_DONE branch reaches
  // battle_finish -> battle_end -- BP_DONE, not BP_INTRO/boot's own
  // default, is the real phase a battle is in the instant battle_end runs.
  nes.cpu.mem[BT_PHASE] = BP_DONE;
  nes.cpu.mem[GAME_STATE] = ST_BATTLE;

  callRoutine(nes, kernelAddrOf('battle_end'));
  assert.equal(nes.cpu.mem[GAME_STATE], 0, 'battle_end must have returned to ordinary gameplay for real'); // ST_GAMEPLAY, engine/constants.asm
  // The clean no-owner path was taken: battle_end must not have restored
  // talk_ent to a real entity slot -- it must still read NO_ENTITY, exactly
  // as seeded above, never overwritten by a spurious owner match.
  assert.equal(nes.cpu.mem[TALK_ENT], 0xff, 'battle_end must not have restored talk_ent to any entity -- bt_owner_ent named NO_ENTITY, so the clean no-owner path must have run');

  // Another valid formation -- one living block-art monster -- seeded as
  // the precondition battle_begin itself does not own (the field's own
  // start_encounter populates this before jmp battle_begin in the real
  // engine; battle_begin takes no monster argument at all).
  nes.cpu.mem[MON_SLOT_ACTOR] = 0;
  for (let slot = 1; slot < 4; slot++) nes.cpu.mem[MON_SLOT_ACTOR + slot] = 0xff;

  callRoutine(nes, kernelAddrOf('battle_begin'));
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'battle_begin must have entered a real battle for real');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_INTRO, 'battle_begin must have set bt_phase to BP_INTRO for real');
  if (hurtLeftBeforeEnd !== null) {
    assert.equal(nes.cpu.mem[BT_HURT_LEFT], hurtLeftBeforeEnd, 'battle_begin itself must not touch bt_hurt_left -- only setup_monsters, reached later through a real battle_tick, does');
  }
  if (missLeftBeforeEnd !== null) {
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], missLeftBeforeEnd, 'battle_begin itself must not touch bt_miss_left -- only setup_monsters, reached later through a real battle_tick, does');
  }

  const addrOf = selectBattleBank(nes, built);
  return {
    nes,
    addrOf,
    BT_HURT_LEFT,
    BT_MISS_LEFT,
    battleTickAddr: addrOf('battle_tick'),
    battleDispatchAddr: addrOf('battle_dispatch')
  };
}

// §14 round 5 -- BP_INTRO guard, hurt timer: round 1 review finding 1's own
// lifecycle version, beside the isolated one above (kept as a direct unit
// check of the guard in isolation). Round 2 review finding 2: reaches this
// same first tick through a REAL battle_end then a REAL battle_begin
// (enterBattleForRealAfterEnding above), not a seeded bt_phase. Wrong
// implementation this catches: the guard's own absence on the hurt side --
// integration through the real end/entry lifecycle is what this version
// adds; the retained isolated test above already catches the guard's
// removal in isolation, so this one is not needed to detect that mutation
// alone, only to prove the guard still holds once a real end/entry is what
// produced the tick under test.
test('BP_INTRO guard, real lifecycle: a stale bt_hurt_left neither decrements nor queues anything on battle_tick’s own first, still-BP_INTRO tick, after a real battle_end and a real battle_begin', {
  skip: needsSample
}, async (t) => {
  const { nes, addrOf, BT_HURT_LEFT, battleTickAddr, battleDispatchAddr } = await enterBattleForRealAfterEnding(t, 'hf-bpintro-guard-real', 20);
  nes.cpu.mem[PAD_NEW] = 0;
  nes.cpu.mem[VRAM_LEN] = 0;

  // Sample right after battle_hurt_tick returns -- battle_dispatch's own
  // entry, the very next thing battle_tick does -- before battle_dispatch's
  // own BP_INTRO branch can reach battle_intro -> setup_monsters, which
  // ALSO clears bt_hurt_left unconditionally: checking only once the whole
  // tick has finished could not tell "the guard worked" apart from
  // "setup_monsters reset it anyway, a tick late."
  let sampledLeft = null;
  let sampledVram = null;
  const originalEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (sampledLeft === null && (nes.cpu.REG_PC + 1) === battleDispatchAddr) {
      sampledLeft = nes.cpu.mem[BT_HURT_LEFT];
      sampledVram = nes.cpu.mem[VRAM_LEN];
    }
    return originalEmulate();
  };
  callRoutine(nes, battleTickAddr);
  nes.cpu.emulate = originalEmulate;

  assert.equal(sampledLeft, 20, 'battle_hurt_tick must not decrement the stale timer on the real first tick, while bt_phase still reads BP_INTRO');
  assert.equal(sampledVram, 0, 'battle_hurt_tick must queue nothing on the real first tick, while bt_phase still reads BP_INTRO');
});

// §14 round 5 -- battle-entry reset, hurt timer: round 1 review finding 1's
// own lifecycle version, beside the isolated setup_monsters unit check
// above. Round 2 review finding 2: reaches setup_monsters through a real
// battle_end then a real battle_begin then a real battle_tick
// (enterBattleForRealAfterEnding above) -- not a seeded bt_phase, and not a
// direct call to setup_monsters itself. Wrong implementation this catches:
// setup_monsters clearing bt_hurt_left only when called in isolation but
// never actually reached once a real end/entry (not merely a seeded
// BP_INTRO) is what produced the tick -- integration the retained isolated
// setup_monsters unit test above cannot, by itself, exercise, since it
// never runs battle_end/battle_begin/battle_dispatch at all.
test('battle-entry reset, real lifecycle: a hurt timer still counting down reads 0 once a real battle_tick has run the next battle’s own setup_monsters, after a real battle_end and a real battle_begin', {
  skip: needsSample
}, async (t) => {
  const { nes, addrOf, BT_HURT_LEFT, battleTickAddr } = await enterBattleForRealAfterEnding(t, 'hf-entry-reset-real', 11);
  nes.cpu.mem[PAD_NEW] = 0;

  // The real next battle's own first tick: battle_dispatch's own BP_INTRO
  // branch reaches battle_intro -> setup_monsters for real.
  callRoutine(nes, battleTickAddr);

  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 0, 'a real battle_tick reaching setup_monsters through battle_intro must clear bt_hurt_left for the next battle');
});

// fix1 item 3 -- the MISS-side real-lifecycle twins §14 rows 3032/3035 (MISS
// alone) and 3033/3036 (both live) ask for, the same shape as the hit-side
// pair just above (2a's own :7401/:7476), through the identical extended
// enterBattleForRealAfterEnding. Sabotage sites 1 and 6 from the phase-2b
// report's own disconnected-call-site table were re-run against these
// twins (see the report for this round); both now fail here too, not only
// against the isolated callRoutine tests.
//
// Wrong implementation this catches: the guard's own absence on the MISS
// side -- integration through the real end/entry lifecycle is what this
// version adds; the isolated test elsewhere in this file already catches
// the guard's removal in isolation, so this one is not needed to detect
// that mutation alone, only to prove the guard still holds once a real
// end/entry is what produced the tick under test.
test('BP_INTRO guard, real lifecycle: a stale bt_miss_left does not decrement on battle_tick’s own first, still-BP_INTRO tick, after a real battle_end and a real battle_begin', {
  skip: needsSample
}, async (t) => {
  const { nes, BT_MISS_LEFT, battleTickAddr, battleDispatchAddr } = await enterBattleForRealAfterEnding(t, 'miss-bpintro-guard-real', null, 30);
  nes.cpu.mem[PAD_NEW] = 0;

  // Sample right after battle_miss_tick returns -- battle_dispatch's own
  // entry, the very next thing battle_tick does -- before battle_dispatch's
  // own BP_INTRO branch can reach battle_intro -> setup_monsters, which
  // ALSO clears bt_miss_left unconditionally: checking only once the whole
  // tick has finished could not tell "the guard worked" apart from
  // "setup_monsters reset it anyway, a tick late."
  let sampledLeft = null;
  const originalEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (sampledLeft === null && (nes.cpu.REG_PC + 1) === battleDispatchAddr) {
      sampledLeft = nes.cpu.mem[BT_MISS_LEFT];
    }
    return originalEmulate();
  };
  callRoutine(nes, battleTickAddr);
  nes.cpu.emulate = originalEmulate;

  assert.equal(sampledLeft, 30, 'battle_miss_tick must not decrement the stale timer on the real first tick, while bt_phase still reads BP_INTRO');
});

// Wrong implementation this catches: either guard implemented so it depends
// on the other flag also being on, or a shared scratch byte between the two
// tick routines that only misbehaves when both run in the same frame.
test('BP_INTRO guard, real lifecycle, both live: neither bt_hurt_left nor bt_miss_left decrements on battle_tick’s own first, still-BP_INTRO tick, after a real battle_end and a real battle_begin', {
  skip: needsSample
}, async (t) => {
  const { nes, BT_HURT_LEFT, BT_MISS_LEFT, battleTickAddr, battleDispatchAddr } = await enterBattleForRealAfterEnding(t, 'both-bpintro-guard-real', 20, 30);
  nes.cpu.mem[PAD_NEW] = 0;
  nes.cpu.mem[VRAM_LEN] = 0;

  let sampledHurt = null;
  let sampledMiss = null;
  let sampledVram = null;
  const originalEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (sampledHurt === null && (nes.cpu.REG_PC + 1) === battleDispatchAddr) {
      sampledHurt = nes.cpu.mem[BT_HURT_LEFT];
      sampledMiss = nes.cpu.mem[BT_MISS_LEFT];
      sampledVram = nes.cpu.mem[VRAM_LEN];
    }
    return originalEmulate();
  };
  callRoutine(nes, battleTickAddr);
  nes.cpu.emulate = originalEmulate;

  assert.equal(sampledHurt, 20, 'battle_hurt_tick must not decrement the stale timer on the real first tick, with MISS also live');
  assert.equal(sampledMiss, 30, 'battle_miss_tick must not decrement the stale timer on the real first tick, with hit feedback also live');
  assert.equal(sampledVram, 0, 'neither guard may queue anything on the real first tick');
});

// Wrong implementation this catches: an `.if`-separated reset whose MISS
// half never runs when hit feedback is not also live in the same build --
// integration through the real end/entry lifecycle is what this version
// adds beyond the isolated setup_monsters unit test elsewhere in this file.
test('battle-entry reset, real lifecycle: a MISS timer still counting down reads 0 once a real battle_tick has run the next battle’s own setup_monsters, after a real battle_end and a real battle_begin', {
  skip: needsSample
}, async (t) => {
  const { nes, BT_MISS_LEFT, battleTickAddr } = await enterBattleForRealAfterEnding(t, 'miss-entry-reset-real', null, 17);
  nes.cpu.mem[PAD_NEW] = 0;

  callRoutine(nes, battleTickAddr);

  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'a real battle_tick reaching setup_monsters through battle_intro must clear bt_miss_left for the next battle');
});

// Wrong implementation this catches: a reset that drops one half
// specifically when both flags coexist -- a failure mode the two
// single-flag real-lifecycle tests above cannot see, since each only ever
// assembles its own half.
test('battle-entry reset, real lifecycle, both live: both bt_hurt_left and bt_miss_left read 0 once a real battle_tick has run the next battle’s own setup_monsters, after a real battle_end and a real battle_begin', {
  skip: needsSample
}, async (t) => {
  const { nes, BT_HURT_LEFT, BT_MISS_LEFT, battleTickAddr } = await enterBattleForRealAfterEnding(t, 'both-entry-reset-real', 11, 17);
  nes.cpu.mem[PAD_NEW] = 0;

  callRoutine(nes, battleTickAddr);

  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 0, 'a real battle_tick must still clear bt_hurt_left with MISS also live');
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'a real battle_tick must still clear bt_miss_left with hit feedback also live');
});

// Orchestrator addition (not a §14 row), round 1 review finding 1's own
// lifecycle version: a monster's REAL attack (monster_turn_attack -- the
// complete, real physical-attack turn: pick_party_target -> roll_hit ->
// apply_damage -> battle_hurt_arm, not an isolated poke of bt_hurt_slot/
// left) lands on a party member, then real battle_tick calls draw (or skip)
// the icon every tick that follows, through the real battle_draw_sprites ->
// battle_sprite_pc path -- beside the isolated branch/parity unit test
// above, which still covers "an unrelated member draws on every tick" on
// its own, but in a SEPARATE run from the victim, so it cannot prove both
// at once.
// Round 2 review finding 1 (P2): the previous draft removed every party
// member but the victim (pc_in_party cleared for every other slot), so
// nothing in this test could ever fail a wrong implementation that also
// stops drawing every OTHER present member the instant the victim blinks --
// battle_sprite_pc's loop keeps going past the victim's own slot in the
// real routine, but a test with no one left in that loop cannot see a
// wrong implementation that exits it early. Both of sample-rpg's party
// members (Rian, slot 0; Iris, slot 1 -- the only two this project's own
// per-level tables cover) are now kept alive and present throughout, and
// each one's own OAM contribution is identified by POSITION: draw_metasprite
// writes each tile's Y byte as its own metasprite offset plus
// BT_PARTY_Y + slot*BT_PARTY_STEP (engine/constants.asm), so the two
// members' sprites land in disjoint, non-overlapping 32-pixel Y bands with
// no ambiguity about which slot drew what.
// Wrong implementation this catches: battle_hurt_arm never actually being
// reached from the monster's real attack path (e.g. wired only into the
// player-side/cast_all call sites, invisible to a test that pokes
// bt_hurt_slot/bt_hurt_left directly), AND (round 2 review) a skip branch
// that exits battle_sprite_pc's own loop early instead of only skipping the
// victim's own draw_metasprite call, which would silently stop every
// present member after the victim from drawing too.
test('party-member blink, real lifecycle: a monster’s real landed attack arms hit feedback on the target, and real battle_tick draws track it tick by tick, with another present member drawing throughout', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'hf-party-blink-real', (project) => {
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 255 }; // guarantee the hit
    project.party[0].eva = 0;
    project.party[1].eva = 0; // both members equally hittable -- pick_party_target's own choice is asserted below, not assumed
  });
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);

  // engine/constants.asm: BT_PARTY_Y = 32, BT_PARTY_STEP = 32 -- each party
  // slot's own metasprite tiles land at Y = (a small per-tile offset) +
  // BT_PARTY_Y + slot*BT_PARTY_STEP, so slot 0 occupies [32,63], slot 1
  // [64,95], and so on: 32-pixel bands wide enough that no real metasprite
  // (a handful of pixels tall) can straddle two of them.
  const BT_PARTY_Y = 32;
  const BT_PARTY_STEP = 32;
  const oamEntriesInSlotBand = (slot) => {
    const lowY = BT_PARTY_Y + slot * BT_PARTY_STEP;
    const highY = lowY + BT_PARTY_STEP - 1;
    let count = 0;
    for (let i = 0; i < 64; i++) {
      const y = nes.cpu.mem[0x200 + i * 4];
      if (y === 0xff) continue; // battle_sprite_clear's own park value -- unused slot
      if (y >= lowY && y <= highY) count++;
    }
    return count;
  };

  nes.cpu.mem[BT_ACTOR] = MAX_PARTY; // the attacking monster's own combatant slot
  nes.cpu.mem[MON_SLOT_ACTOR] = 0;
  nes.cpu.mem[MON_ALIVE] = 1;
  for (let slot = 0; slot < 2; slot++) {
    nes.cpu.mem[PC_IN_PARTY + slot] = 1;
    nes.cpu.mem[PC_HP + slot] = 50;
  }
  for (let slot = 2; slot < 4; slot++) nes.cpu.mem[PC_IN_PARTY + slot] = 0; // sample-rpg has no real per-level table for these
  nes.cpu.mem[BT_HURT_LEFT] = 0; // nothing armed yet
  nes.cpu.mem[RNG] = 0; // acc 255 / eva 0: any roll but 255 hits; a fixed low seed keeps this deterministic

  // Round 3 review finding 1 (P2): record BOTH members' HP before the
  // attack, so the real victim can be established from the attack's own
  // EFFECT (who actually lost HP), independently of whatever bt_hurt_slot
  // says -- reading bt_hurt_slot alone (round 2's own version) proves only
  // that drawing follows the feedback state, never that the feedback
  // named the member the attack actually damaged.
  const hpBefore = [nes.cpu.mem[PC_HP + 0], nes.cpu.mem[PC_HP + 1]];

  // The monster's real, complete turn -- not an isolated poke of
  // bt_hurt_slot/bt_hurt_left.
  callRoutine(nes, addrOf('monster_turn_attack'));

  const hpAfter = [nes.cpu.mem[PC_HP + 0], nes.cpu.mem[PC_HP + 1]];
  const damaged = [0, 1].filter((slot) => hpAfter[slot] < hpBefore[slot]);
  assert.equal(damaged.length, 1, `exactly one of the two present members must have lost HP to the real attack, got ${JSON.stringify(hpAfter)} from ${JSON.stringify(hpBefore)}`);
  const victimSlot = damaged[0];
  const otherSlot = victimSlot === 0 ? 1 : 0;
  assert.equal(hpAfter[otherSlot], hpBefore[otherSlot], `the other present member (slot ${otherSlot}) must not have lost any HP to an attack that landed on slot ${victimSlot}`);
  // With this fixture's own deterministic setup (pick_party_target picks
  // the first alive combatant from slot 0, and both members are equally
  // hittable), the real victim must be slot 0 -- asserted explicitly, per
  // the brief: report an unexpected target rather than silently adapting
  // every later assertion to wherever the attack happened to land.
  assert.equal(victimSlot, 0, 'this fixture’s own deterministic setup must send the real attack to party member 0 -- an attack landing anywhere else is unexpected and must fail here, not be adapted to');

  // Feedback must name the SAME member the attack actually damaged, both
  // by bt_hurt_slot (the shared hit-feedback pair) and bt_target (the
  // attack's own chosen target, still readable here since monster_turn_attack
  // never clears it) -- not merely a present member.
  assert.equal(nes.cpu.mem[BT_HURT_SLOT], victimSlot, 'bt_hurt_slot must name the same member the real attack actually damaged');
  assert.equal(nes.cpu.mem[BT_TARGET], victimSlot, 'bt_target -- the attack’s own chosen target -- must equal the independently established victim too');
  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20, 'the landed hit should have armed a fresh timer');

  // A living, drawable member must follow the victim in party order --
  // the precondition the concurrent-OAM checks below depend on to mean
  // anything at all.
  assert.equal(nes.cpu.mem[PC_IN_PARTY + otherSlot], 1, `party member ${otherSlot}, following the victim in party order, must be present`);
  assert.ok(nes.cpu.mem[PC_HP + otherSlot] > 0, `party member ${otherSlot}, following the victim in party order, must be alive`);
  const pcMetasprite = addrOf('pc_metasprite'); // a ROM table (main/build/battletables.js), not a RAM equate -- resolved off game.fns like any other battle-bank label
  assert.notEqual(nes.cpu.mem[pcMetasprite + otherSlot], 0xff, `party member ${otherSlot}, following the victim in party order, must be drawable (a real metasprite, not $FF)`);

  // Real ticks: battle_tick's own battle_draw_sprites -> battle_sprite_pc
  // draws (or skips) the icon every tick, unconditionally -- no button
  // needed, and bt_hurt_left is read back AFTER each tick's own
  // battle_hurt_tick has already decremented it, the same value
  // battle_sprite_pc's own skip check used on that same tick.
  nes.cpu.mem[BT_PHASE] = BP_MENU;
  for (let tick = 0; tick < 20; tick++) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[PAD_NEW] = 0;
    callRoutine(nes, addrOf('battle_tick'));
    // Predicted independently of whatever the register currently reads --
    // battle_tick's own battle_hurt_tick must actually decrement it one
    // frame at a time from BT_HURT_FRAMES (20), floored at 0. Re-deriving
    // "expected" from the CURRENT bt_hurt_left value instead (as an earlier
    // draft of this test did) cannot tell "the real countdown ran" apart
    // from "battle_hurt_tick never ran at all and bt_hurt_left is still its
    // initial 20" -- both cases dead-reckon into a self-consistent parity,
    // since battle_sprite_pc reads the identical (frozen) byte the test
    // would also be reading. This is the check that catches Finding 1's own
    // required sabotage (battle_tick's `jsr battle_hurt_tick` -> nops).
    const predictedLeft = Math.max(0, 20 - (tick + 1));
    assert.equal(nes.cpu.mem[BT_HURT_LEFT], predictedLeft, `tick ${tick}: battle_tick's own battle_hurt_tick must have decremented bt_hurt_left for real`);
    const skipped = predictedLeft !== 0 && (predictedLeft & 2) !== 0;
    const victimCount = oamEntriesInSlotBand(victimSlot);
    if (skipped) {
      assert.equal(victimCount, 0, `tick ${tick}: the hit member's (slot ${victimSlot}) icon must be entirely absent from OAM on a real skip-band tick (predicted hurtLeft=${predictedLeft})`);
    } else {
      assert.ok(victimCount > 0, `tick ${tick}: the hit member's (slot ${victimSlot}) icon must have drawn at least one OAM entry on a real draw tick (predicted hurtLeft=${predictedLeft})`);
    }
    // Round 2 review finding 1: the OTHER present member must draw on
    // EVERY tick, skip-band or not -- bt_hurt_slot never names it, so
    // battle_sprite_pc's own skip check can never apply to it.
    assert.ok(oamEntriesInSlotBand(otherSlot) > 0, `tick ${tick}: the other present member (slot ${otherSlot}) must still draw at least one OAM entry, regardless of the victim's own skip/draw state`);
  }
});

// ---------------------------------------------------------------------------
// Battle-side animation, phase 2b -- the MISS overlay (docs/design-battle-
// animation.md §13). Independent of phase 2a's bt_hurt_slot/bt_hurt_left
// pair: its own bt_miss_slot/bt_miss_left, its own arm/tick/draw routines,
// gated on MISS_ENABLED alone. Driven through isolated callRoutine calls,
// the identical discipline the phase 2a section above uses.
// ---------------------------------------------------------------------------

/** A MISS-only build: no wandering encounters, rpg.miss on, hitFeedback left off. */
async function buildMissFixture(t, name, mutate = () => {}) {
  return buildVariantFull(t, name, (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.rpg.miss = true;
    mutate(project);
  });
}

/** Resolve the two bt_miss_* zero-page bytes out of a build's own constants.asm. */
function resolveMissAddrs(built) {
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  return {
    BT_MISS_SLOT: resolveEngineAddress(constantsText, 'bt_miss_slot'),
    BT_MISS_LEFT: resolveEngineAddress(constantsText, 'bt_miss_left')
  };
}

// §14 round 5 -- BP_INTRO guard, MISS timer (split from the old combined
// row, MISS's own side). A stale timer from a previous battle must not
// tick anything while bt_phase still reads BP_INTRO.
// Wrong implementation this catches: battle_miss_tick missing its own
// BP_INTRO guard.
test('BP_INTRO guard: a stale bt_miss_left does not decrement on the first, still-BP_INTRO tick', {
  skip: needsSample
}, async (t) => {
  const built = await buildMissFixture(t, 'miss-bpintro-guard');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);

  nes.cpu.mem[BT_PHASE] = BP_INTRO;
  nes.cpu.mem[BT_MISS_SLOT] = MAX_PARTY; // stale from a previous battle
  nes.cpu.mem[BT_MISS_LEFT] = 30;

  callRoutine(nes, addrOf('battle_miss_tick'));

  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30, 'battle_miss_tick must not decrement the stale timer while bt_phase still reads BP_INTRO');
});

// §14 round 5 -- BP_INTRO guard, both live (integration). Neither guard may
// depend on the other flag also being on, and running both in the same
// frame must surface no interaction the two isolated checks above cannot
// see.
test('BP_INTRO guard: both bt_hurt_left and bt_miss_left stay untouched on the same still-BP_INTRO tick, with both toggles live', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'both-bpintro-guard', (project) => {
    project.rpg.miss = true;
  });
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);

  nes.cpu.mem[BT_PHASE] = BP_INTRO;
  nes.cpu.mem[MON_SLOT_ACTOR] = 0;
  nes.cpu.mem[MON_ALIVE] = 1;
  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY;
  nes.cpu.mem[BT_HURT_LEFT] = 20;
  nes.cpu.mem[BT_MISS_SLOT] = MAX_PARTY;
  nes.cpu.mem[BT_MISS_LEFT] = 30;
  nes.cpu.mem[VRAM_LEN] = 0;

  callRoutine(nes, addrOf('battle_hurt_tick'));
  callRoutine(nes, addrOf('battle_miss_tick'));

  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20, 'the hurt timer must not decrement while bt_phase still reads BP_INTRO, with MISS also live');
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30, 'the MISS timer must not decrement while bt_phase still reads BP_INTRO, with hit feedback also live');
  assert.equal(nes.cpu.mem[VRAM_LEN], 0, 'neither guard may queue anything while bt_phase still reads BP_INTRO');
});

// §14 round 5 -- battle-entry reset, MISS timer (split from the old
// combined row, MISS's own side). A timer left counting down at the end of
// one battle (neither battle_end nor player_died clears it, §13.4) must
// read 0 once the next battle's own setup_monsters has run.
test('battle-entry reset: a MISS timer still counting down at the end of one battle reads 0 once the next battle’s setup_monsters has run', {
  skip: needsSample
}, async (t) => {
  const built = await buildMissFixture(t, 'miss-entry-reset');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);

  nes.cpu.mem[BT_MISS_SLOT] = MAX_PARTY;
  nes.cpu.mem[BT_MISS_LEFT] = 17; // still counting down, as if the battle just ended mid-overlay

  callRoutine(nes, addrOf('setup_monsters'));

  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'setup_monsters must clear bt_miss_left for the next battle');
});

// §14 round 5 -- battle-entry reset, both live (integration). Confirms the
// split under the v5.1 ledger decision kept BOTH .if blocks rather than one
// silently replacing the other when both are compiled into the same build.
test('battle-entry reset: both bt_hurt_left and bt_miss_left read 0 after one setup_monsters, with both toggles live', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'both-entry-reset', (project) => {
    project.rpg.miss = true;
  });
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);

  nes.cpu.mem[BT_HURT_SLOT] = MAX_PARTY;
  nes.cpu.mem[BT_HURT_LEFT] = 11;
  nes.cpu.mem[BT_MISS_SLOT] = MAX_PARTY;
  nes.cpu.mem[BT_MISS_LEFT] = 17;

  callRoutine(nes, addrOf('setup_monsters'));

  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 0, 'setup_monsters must still clear bt_hurt_left with MISS also live');
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'setup_monsters must still clear bt_miss_left with hit feedback also live');
});

// §14 round 1 -- Real attack-path miss coverage (finding 6, P2). Both real
// call sites -- attack_target (party) and monster_turn_attack (monster) --
// through a real roll_hit, forced to miss deterministically on BOTH of its
// two exits: the underflow branch (party attacker, evasion above accuracy)
// and the RNG branch (monster attacker, seed chosen so rng_next returns AT
// the margin -- predicted with referenceRngNext, never searched for at test
// time: referenceRngNext(100) === 200, and the monster's own acc/eva are set
// so the margin is exactly 200, so the roll ties the margin -- roll_hit's
// own `bcs roll_hit_miss` takes a tie as a miss).
//
// fix2 P2 (review 1): the previous version of this fixture ALSO set Slime's
// own eva to 0, which made Rian's own acc:0 attack compute 0-0 -- carry SET
// (no borrow), so `bcc roll_hit_miss` was never taken at all; the "underflow"
// case actually fell through to the identical RNG-tie exit case 2 already
// covers, through a margin of 0 (any rng_next() >= 0 is a miss, unconditionally,
// on every byte). Fixed by leaving Slime's own eva at sample-rpg's own
// default (4, confirmed by the precondition assertion below) -- strictly
// above Rian's forced acc:0, so 0-4 genuinely underflows regardless of RNG.
// Distinguished from the RNG exit independently of the outcome by the RNG
// byte itself ($62, rpg.test.js's own RNG constant): the underflow branch's
// own `bcc roll_hit_miss` returns before ever reaching `jsr rng_next`, so the
// byte must read back UNCHANGED across the party's own attack, and CHANGED
// (to referenceRngNext's own predicted value) across the monster's.
test('real attack-path miss coverage: attack_target (underflow) and monster_turn_attack (RNG) both arm the MISS overlay on the real dodging target', {
  skip: needsSample
}, async (t) => {
  const built = await buildMissFixture(t, 'miss-real-attack-path', (project) => {
    // Party member 0 (Rian) attacking: acc forced to 0 so it underflows
    // against Slime's own eva (left at its default, 4) regardless of the
    // RNG state at all -- Slime's own eva is NEVER overridden here.
    project.party[0].acc = 0;
    // Slime (actor 0) attacking: acc set so the margin is exactly 200 --
    // referenceRngNext(100) === 200 (predicted below, not searched for).
    // This does not touch Slime's own eva at all -- the party's own attack
    // above needs it left at its default.
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 200 };
    project.party[0].eva = 0;
    assert.equal(project.sprites.actors[0].battle.eva, 4, 'sanity: Slime must ship eva 4 by default -- this fixture never overrides it');
    assert.ok(project.party[0].acc < project.sprites.actors[0].battle.eva, `precondition: Rian's own acc (${project.party[0].acc}) must be strictly below Slime's own eva (${project.sprites.actors[0].battle.eva}) for the party's own attack to genuinely underflow`);
  });
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);
  const BT_PARTY_X = 200, BT_PARTY_Y = 32, BT_PARTY_STEP = 32; // engine/constants.asm
  const OAM_IDX = resolveOamIdx(built);

  // --- Case 1: attack_target, underflow branch --------------------------
  {
    const nes = bootPastNaming(built.romPath);
    const addrOf = selectBattleBank(nes, built);
    nes.cpu.mem[BT_PHASE] = BP_MENU;
    nes.cpu.mem[MON_SLOT_ACTOR + 0] = 0; // Slime
    nes.cpu.mem[MON_ALIVE + 0] = 1;
    nes.cpu.mem[BT_ACTOR] = 0; // Rian
    nes.cpu.mem[BT_TARGET] = MAX_PARTY + 0; // the monster in slot 0 -- who dodges
    nes.cpu.mem[BT_MISS_LEFT] = 0;
    nes.cpu.mem[VRAM_LEN] = 0;
    const vramLenBefore = nes.cpu.mem[VRAM_LEN];
    nes.cpu.mem[RNG] = 77; // an arbitrary, real value the underflow exit must never touch
    const rngBefore = nes.cpu.mem[RNG];

    callRoutine(nes, addrOf('attack_target'));

    assert.equal(nes.cpu.mem[RNG], rngBefore, 'the underflow exit must never call rng_next -- the RNG byte must read back exactly as seeded');

    assert.equal(nes.cpu.mem[BT_DMG_HI], 0xff, 'sanity: this roll must actually have missed (underflow)');
    assert.equal(nes.cpu.mem[BT_MISS_SLOT], MAX_PARTY + 0, 'bt_miss_slot must name the real dodging target -- the monster bt_target named, not the attacker');
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30, 'bt_miss_left must be freshly armed to BT_MISS_FRAMES (30)');
    assert.ok(nes.cpu.mem[VRAM_LEN] > vramLenBefore, 'the "misses" message must have been queued into vram_buf');

    // OAM: the four MISS tiles at the monster's own anchor, one row (8px)
    // above BT_MON_ROW*8, computed independently of bt_miss_slot itself.
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, addrOf('battle_miss_draw'));
    const expectedY = BT_MON_ROW * 8 - 8; // slot 0 -- no +32*slot offset
    const expectedX = BT_MON_COL * 8;
    for (let i = 0; i < 4; i++) {
      assert.equal(nes.cpu.mem[0x200 + i * 4 + 0], expectedY, `MISS tile ${i}: Y must be the monster's own anchor row minus 8`);
      assert.equal(nes.cpu.mem[0x200 + i * 4 + 3], expectedX + i * 8, `MISS tile ${i}: X must step 8px per glyph from the monster's own anchor column`);
    }
    assert.equal(nes.cpu.mem[OAM_IDX], 16, 'battle_miss_draw must have written exactly 4 OAM entries (16 bytes)');

    // Lifecycle: 30 real battle_miss_tick calls exhaust the countdown to
    // exactly 0, and a 31st call queues nothing further (already 0).
    for (let tick = 1; tick <= 30; tick++) {
      callRoutine(nes, addrOf('battle_miss_tick'));
      assert.equal(nes.cpu.mem[BT_MISS_LEFT], Math.max(0, 30 - tick), `tick ${tick}: bt_miss_left must count down for real`);
    }
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'the countdown must reach exactly 0 at BT_MISS_FRAMES (30) ticks');
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, addrOf('battle_miss_draw'));
    assert.equal(nes.cpu.mem[OAM_IDX], 0, 'once bt_miss_left is 0, battle_miss_draw must draw nothing');
  }

  // --- Case 2: monster_turn_attack, RNG branch, plus early dismissal ------
  {
    const nes = bootPastNaming(built.romPath);
    const addrOf = selectBattleBank(nes, built);
    nes.cpu.mem[BT_PHASE] = BP_MENU;
    nes.cpu.mem[BT_ACTOR] = MAX_PARTY + 0; // Slime attacking
    nes.cpu.mem[MON_SLOT_ACTOR + 0] = 0;
    nes.cpu.mem[MON_ALIVE + 0] = 1;
    nes.cpu.mem[PC_IN_PARTY + 0] = 1;
    nes.cpu.mem[PC_HP + 0] = 50;
    nes.cpu.mem[RNG] = 100; // referenceRngNext(100) === 200, tying the margin (200) -- a miss

    callRoutine(nes, addrOf('monster_turn_attack'));

    // fix2 P2: the RNG branch, unlike the underflow one, must actually
    // consume the RNG byte -- rng_next's own LFSR advance (engine/rpg.asm)
    // leaves it at referenceRngNext(100) = 200, never the seeded 100 it
    // started from.
    assert.equal(nes.cpu.mem[RNG], referenceRngNext(100), 'the RNG branch must have called rng_next for real -- the RNG byte must read the LFSR-advanced value, not the seeded one');
    assert.equal(nes.cpu.mem[BT_DMG_HI], 0xff, 'sanity: this roll must actually have missed (RNG tie)');
    assert.equal(nes.cpu.mem[BT_TARGET], 0, 'sanity: pick_party_target must have chosen party member 0');
    assert.equal(nes.cpu.mem[BT_MISS_SLOT], 0, 'bt_miss_slot must name the real dodging party member (0), from bt_target, not the attacking monster');
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30, 'bt_miss_left must be freshly armed');

    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[OAM_IDX] = 0;
    callRoutine(nes, addrOf('battle_miss_draw'));
    const expectedY = BT_PARTY_Y - 8; // slot 0 -- no +BT_PARTY_STEP*slot offset
    for (let i = 0; i < 4; i++) {
      assert.equal(nes.cpu.mem[0x200 + i * 4 + 0], expectedY, `MISS tile ${i}: Y must be the party member's own anchor row minus 8`);
      assert.equal(nes.cpu.mem[0x200 + i * 4 + 3], BT_PARTY_X + i * 8, `MISS tile ${i}: X must step from the party's fixed BT_PARTY_X`);
    }

    // Early dismissal, then a second, independent miss on the next turn:
    // the first overlay must be gone (forced to 0 by battle_message_done),
    // and the second must start clean at 30 with no overlap.
    callRoutine(nes, addrOf('battle_message_done'));
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'battle_message_done must force-clear bt_miss_left on dismissal');

    nes.cpu.mem[RNG] = 100; // force the same RNG-branch miss again, on the next turn
    callRoutine(nes, addrOf('monster_turn_attack'));
    assert.equal(nes.cpu.mem[BT_MISS_SLOT], 0, 'the second, independent miss must re-arm on the real dodging target');
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30, 'the second miss must start clean at 30, never inheriting anything from the first');
  }
});

// fix2 P2 (review 1): the required real dismissal/next-turn lifecycle,
// missing from the isolated coverage above -- which calls
// battle_message_done and monster_turn_attack directly, checks only the
// timer, and never drives A through battle_tick/battle_message_wait or
// observes the old glyphs actually disappear from that tick's own OAM
// shadow. Driven exclusively through callRoutine(battle_tick) with pad_new
// seeded -- the accepted harness the 127-byte six-tick test and the
// dispatch-chain test above already use -- never a direct call to
// battle_message_done or monster_turn_attack anywhere in this test. One
// real party turn (FIGHT -> target -> act, item 2's own corrected underflow
// fixture), its own countdown observed on real ticks against an
// independently predicted value (never re-read from itself), an early A
// dismissal observed on THAT SAME tick both in bt_miss_left and in the real
// OAM shadow, and the next scheduled turn (the monster's own, forced to
// miss via the RNG-tie fixture from case 2 above) producing a second,
// independent miss starting clean at 30. Both messages are decoded with
// decodeVramBuf and checked against the real "misses" text, not merely
// "some text was queued."
//
// Wrong implementation this catches: battle_message_done's own
// `sta <bt_miss_left` clear NOPed -- the isolated tests above already catch
// this on the timer alone; this test must ALSO catch it on the dismissal
// tick's own OAM shadow (MISS_TILE_M still present where the clear should
// have stopped battle_miss_draw from writing it).
test('real dismissal and next-turn lifecycle: a real miss dismisses cleanly through battle_tick, and the next scheduled turn arms a second, independent miss', {
  skip: needsSample
}, async (t) => {
  const built = await buildMissFixture(t, 'miss-real-dismissal-lifecycle', (project) => {
    // The identical, corrected underflow/RNG-tie fixture from the test
    // above: Rian's own acc:0 underflows against Slime's own eva (left at
    // its default, 4); Slime's own acc:200 against Rian's own eva (forced
    // to 0) ties the RNG margin at 200. Speeds are left at their own
    // defaults (Rian 4 > Slime 3), so the party goes first without needing
    // any override.
    project.party[0].acc = 0;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 200 };
    project.party[0].eva = 0;
  });
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);
  const OAM_IDX = resolveOamIdx(built);
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const ram = (name) => resolveEngineAddress(constantsText, name);
  const BT_ROUND = ram('bt_round');
  const BT_FLEE = ram('bt_flee');
  const BT_PTICK = ram('bt_ptick');
  const STATUS_PENDING = ram('status_pending');
  const PC_STATUS = ram('pc_status');
  const MON_STATUS = ram('mon_slot_status');
  const TURN_ORDER = ram('turn_order');
  const BT_COUNT = ram('bt_count');
  const BP_NEXT = 7; // engine/constants.asm -- advance the turn order
  const { BT_WIPE_MASK, BT_WIPE_ROW } = resolveWipeAddrs(built);

  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const battleTickAddr = addrOf('battle_tick');

  // A fresh, one-monster battle's own RAM, seeded directly -- the identical
  // shape the 127-byte six-tick test above already uses (never a real
  // battle_intro/setup_monsters call): Rian (party 0) and Slime (monster
  // slot 0), Rian first in turn order (speed 4 > 3, unmodified).
  nes.cpu.mem[MON_SLOT_ACTOR + 0] = 0;
  nes.cpu.mem[MON_ALIVE + 0] = 1;
  nes.cpu.mem[MON_HP + 0] = 200;
  nes.cpu.mem[PC_IN_PARTY + 0] = 1;
  nes.cpu.mem[PC_HP + 0] = 50;
  nes.cpu.mem[PC_STATUS + 0] = 0;
  nes.cpu.mem[MON_STATUS + 0] = 0;
  nes.cpu.mem[BT_COUNT] = 1;
  nes.cpu.mem[BT_FLEE] = 0;
  nes.cpu.mem[BT_PTICK] = 0;
  nes.cpu.mem[STATUS_PENDING] = 0;
  nes.cpu.mem[BT_WIPE_MASK] = 0;
  nes.cpu.mem[BT_WIPE_ROW] = 0;
  nes.cpu.mem[BT_ROUND] = 0;
  nes.cpu.mem[BT_SEL] = 0; // BC_FIGHT
  nes.cpu.mem[BT_ACTOR] = 0; // Rian's own turn first
  nes.cpu.mem[TURN_ORDER + 0] = 0;
  nes.cpu.mem[TURN_ORDER + 1] = MAX_PARTY + 0;
  for (let slot = 2; slot < 8; slot++) nes.cpu.mem[TURN_ORDER + slot] = 0xff;
  nes.cpu.mem[BT_PHASE] = BP_MENU;

  // Tick 1: BP_MENU + A -- FIGHT is already selected (bt_sel 0), and
  // first_live_monster (called from battle_menu_fight) targets the one
  // monster in the formation.
  nes.cpu.mem[PAD_NEW] = BTN_A;
  callRoutine(nes, battleTickAddr);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should have asked who to hit');

  // Tick 2: BP_TARGET + A -- confirm the target.
  nes.cpu.mem[PAD_NEW] = BTN_A;
  callRoutine(nes, battleTickAddr);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_ACT, 'confirming the target should have moved to BP_ACT');

  // Tick 3: BP_ACT -- the real attack resolves this tick, forced to miss
  // (underflow) -- attack_target -> attack_missed -> battle_miss_arm, all
  // reached through battle_act's own dispatch, never called directly.
  nes.cpu.mem[PAD_NEW] = 0;
  nes.cpu.mem[VRAM_LEN] = 0;
  callRoutine(nes, battleTickAddr);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the resolved attack should be holding its own message');
  assert.equal(nes.cpu.mem[BT_DMG_HI], 0xff, 'sanity: the real party attack must have missed');
  assert.equal(nes.cpu.mem[BT_MISS_SLOT], MAX_PARTY + 0, 'bt_miss_slot must name the real dodging monster');
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30, 'bt_miss_left must be freshly armed to BT_MISS_FRAMES (30), never decremented on its own arming tick');
  {
    const packets = decodeVramBuf(nes, nes.cpu.mem[VRAM_LEN]);
    assert.equal(packets.length, 2, 'a plain "X misses" message is exactly two packets: the name, then the string');
    assert.deepEqual(packets[0].data, nameTiles('Rian'), 'the first packet must be the attacker’s own real name, "Rian" -- not merely some text');
    assert.deepEqual(packets[1].data.slice(0, 9), battleStringTiles('misses'), 'the second packet must be the real "misses" line -- not merely some text');
  }

  // Ticks 4-8: the message held, five real ticks -- the countdown observed
  // against an independently computed value, never re-read from bt_miss_left
  // itself.
  for (let tick = 1; tick <= 5; tick++) {
    nes.cpu.mem[PAD_NEW] = 0;
    callRoutine(nes, battleTickAddr);
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30 - tick, `tick ${tick} of the held message: bt_miss_left must count down for real`);
  }
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'sanity: the message must still be held after five ticks, well under MSG_HOLD (45)');

  // Early dismissal: A during BP_MESSAGE. On THIS tick, battle_message_done
  // force-clears bt_miss_left, and battle_draw_sprites (running at the end
  // of this SAME tick) must draw nothing for MISS -- the four glyph entries
  // must be gone from the OAM shadow THIS tick, not merely next tick.
  nes.cpu.mem.fill(0xff, 0x200, 0x300);
  nes.cpu.mem[OAM_IDX] = 0;
  nes.cpu.mem[PAD_NEW] = BTN_A;
  callRoutine(nes, battleTickAddr);
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'the dismissal tick itself must read bt_miss_left as 0, observed on that tick, not the one after it');
  assert.notEqual(nes.cpu.mem[0x200 + 1], MISS_TILE_M, 'the dismissal tick’s own OAM shadow must not carry MISS_TILE_M at entry 0 -- battle_miss_draw must have drawn nothing this tick');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_NEXT, 'dismissing a plain message with no status pending must advance straight to BP_NEXT, the same tick');

  // The next scheduled turn: BP_NEXT -> battle_next -> the monster's own
  // real turn, forced to miss via the RNG-tie fixture (case 2 above), all
  // synchronously within this ONE tick -- never a direct call to
  // monster_turn_attack.
  nes.cpu.mem[RNG] = 100; // referenceRngNext(100) === 200, tying the monster's own margin (200)
  nes.cpu.mem[PAD_NEW] = 0;
  nes.cpu.mem[VRAM_LEN] = 0;
  callRoutine(nes, battleTickAddr);
  assert.equal(nes.cpu.mem[BT_ROUND], 1, 'sanity: the round must have advanced to the monster’s own turn');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the monster’s own real turn must have resolved into its own message, the same tick');
  assert.equal(nes.cpu.mem[BT_DMG_HI], 0xff, 'sanity: the real monster attack must have missed (RNG tie)');
  assert.equal(nes.cpu.mem[BT_MISS_SLOT], 0, 'the second miss must name the real dodging party member (0), from the monster’s own bt_target');
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30, 'the second, independent miss must start clean at 30, with no overlap from the first');
  {
    const packets = decodeVramBuf(nes, nes.cpu.mem[VRAM_LEN]);
    assert.equal(packets.length, 2, 'the monster’s own "X misses" message is exactly two packets too');
    assert.deepEqual(packets[0].data, nameTiles('Slime'), 'the first packet must be the attacking monster’s own real name, "Slime"');
    assert.deepEqual(packets[1].data.slice(0, 9), battleStringTiles('misses'), 'the second packet must be the real "misses" line');
  }
});

// fix2 P2 (review 1): the both-live message-cap asymmetry, driven the
// identical real-tick way as the test just above (never a direct call to
// battle_message_done or a physical-attack routine): a real landed hit
// first, arming hit feedback for real through apply_damage -> battle_hurt_arm
// (never seeded by hand), so bt_hurt_left is genuinely counting down on its
// own real clock; then the monster's own real miss, arming bt_miss_left;
// then an early dismissal of the miss's own message, asserting bt_hurt_left
// keeps following its own independently predicted countdown, completely
// untouched by the clear that only ever targets bt_miss_left. The isolated
// asymmetry test elsewhere in this file (which seeds both timers directly
// and calls battle_message_done in isolation) is kept alongside this one.
test('message-cap asymmetry, real lifecycle: a real landed hit keeps counting on its own clock across a real miss’s own early dismissal', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'asymmetry-both-real-lifecycle', (project) => {
    project.rpg.miss = true;
    // Rian's own attack against Slime must LAND for certain: acc 255
    // against Slime's own eva forced to 0, plus a controlled RNG roll well
    // under the margin (no chance left to the emulator's own RNG state).
    project.party[0].acc = 255;
    // Slime's own attack against Rian must MISS for certain, through the
    // underflow branch (no RNG dependency at all): acc 0 against Rian's own
    // eva, left at its default (8) -- strictly above Slime's forced 0.
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0, eva: 0 };
    assert.ok(project.sprites.actors[0].battle.acc < project.party[0].eva, `precondition: Slime's own acc (${project.sprites.actors[0].battle.acc}) must be strictly below Rian's own eva (${project.party[0].eva}) for the monster's own attack to underflow`);
  });
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const ram = (name) => resolveEngineAddress(constantsText, name);
  const BT_ROUND = ram('bt_round');
  const BT_FLEE = ram('bt_flee');
  const BT_PTICK = ram('bt_ptick');
  const STATUS_PENDING = ram('status_pending');
  const PC_STATUS = ram('pc_status');
  const MON_STATUS = ram('mon_slot_status');
  const TURN_ORDER = ram('turn_order');
  const BT_COUNT = ram('bt_count');
  const BP_NEXT = 7; // engine/constants.asm -- advance the turn order
  const { BT_WIPE_MASK, BT_WIPE_ROW } = resolveWipeAddrs(built);

  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const battleTickAddr = addrOf('battle_tick');

  nes.cpu.mem[MON_SLOT_ACTOR + 0] = 0;
  nes.cpu.mem[MON_ALIVE + 0] = 1;
  nes.cpu.mem[MON_HP + 0] = 200;
  nes.cpu.mem[PC_IN_PARTY + 0] = 1;
  nes.cpu.mem[PC_HP + 0] = 50;
  nes.cpu.mem[PC_STATUS + 0] = 0;
  nes.cpu.mem[MON_STATUS + 0] = 0;
  nes.cpu.mem[BT_COUNT] = 1;
  nes.cpu.mem[BT_FLEE] = 0;
  nes.cpu.mem[BT_PTICK] = 0;
  nes.cpu.mem[STATUS_PENDING] = 0;
  nes.cpu.mem[BT_WIPE_MASK] = 0;
  nes.cpu.mem[BT_WIPE_ROW] = 0;
  nes.cpu.mem[BT_ROUND] = 0;
  nes.cpu.mem[BT_SEL] = 0; // BC_FIGHT
  nes.cpu.mem[BT_ACTOR] = 0;
  nes.cpu.mem[TURN_ORDER + 0] = 0;
  nes.cpu.mem[TURN_ORDER + 1] = MAX_PARTY + 0;
  for (let slot = 2; slot < 8; slot++) nes.cpu.mem[TURN_ORDER + slot] = 0xff;
  nes.cpu.mem[BT_PHASE] = BP_MENU;

  // Tick 1-2: FIGHT, confirm the target.
  nes.cpu.mem[PAD_NEW] = BTN_A;
  callRoutine(nes, battleTickAddr);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET);
  nes.cpu.mem[PAD_NEW] = BTN_A;
  callRoutine(nes, battleTickAddr);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_ACT);

  // Tick 3: the real attack resolves, forced to land -- RNG seeded to a
  // value well under the 255 margin (referenceRngNext(1) === 2).
  nes.cpu.mem[RNG] = 1;
  nes.cpu.mem[PAD_NEW] = 0;
  callRoutine(nes, battleTickAddr);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the resolved attack should be holding its own message');
  assert.equal(nes.cpu.mem[BT_DMG_HI], 0, 'sanity: the real party attack must have landed, not missed');
  assert.equal(nes.cpu.mem[BT_HURT_SLOT], MAX_PARTY + 0, 'the real hit must have armed hit feedback on the real target, through apply_damage -> battle_hurt_arm');
  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20, 'bt_hurt_left must be freshly armed to BT_HURT_FRAMES (20)');
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'sanity: nothing has missed yet -- bt_miss_left must still read 0');
  let hurtElapsed = 0; // real battle_tick calls since bt_hurt_left armed (tick 3, inclusive of this one)

  // Ticks 4-5: the hit's own message held.
  for (let tick = 1; tick <= 2; tick++) {
    nes.cpu.mem[PAD_NEW] = 0;
    callRoutine(nes, battleTickAddr);
    hurtElapsed++;
    assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20 - hurtElapsed, `tick ${tick} of the hit's own held message: bt_hurt_left must count down for real`);
  }

  // Dismiss the hit's own message -- battle_message_done never touches
  // bt_hurt_left at all (§12.4's own asymmetry, the identical rule this
  // whole test is about), so only the real battle_hurt_tick's own decrement
  // (running before dispatch on this same tick) applies.
  nes.cpu.mem[PAD_NEW] = BTN_A;
  callRoutine(nes, battleTickAddr);
  hurtElapsed++;
  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20 - hurtElapsed, 'dismissing the LANDED hit’s own message must not itself clear or otherwise perturb bt_hurt_left');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_NEXT, 'dismissing the hit’s own message must advance straight to BP_NEXT');

  // The next scheduled turn: the monster's own real attack, forced to miss
  // (underflow, no RNG dependency) -- arms bt_miss_left for real, in the
  // same tick bt_hurt_left keeps counting on its own independent clock.
  nes.cpu.mem[PAD_NEW] = 0;
  callRoutine(nes, battleTickAddr);
  hurtElapsed++;
  assert.equal(nes.cpu.mem[BT_ROUND], 1, 'sanity: the round must have advanced to the monster’s own turn');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the monster’s own real turn must have resolved into its own message');
  assert.equal(nes.cpu.mem[BT_DMG_HI], 0xff, 'sanity: the real monster attack must have missed (underflow)');
  assert.equal(nes.cpu.mem[BT_MISS_SLOT], 0, 'the real miss must name the real dodging party member (0)');
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30, 'bt_miss_left must be freshly armed to BT_MISS_FRAMES (30)');
  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20 - hurtElapsed, 'bt_hurt_left must still be following its own independent countdown, unaffected by the monster’s own miss arming');

  // Ticks: hold the miss's own message for two more real ticks, both
  // timers counting down independently.
  for (let tick = 1; tick <= 2; tick++) {
    nes.cpu.mem[PAD_NEW] = 0;
    callRoutine(nes, battleTickAddr);
    hurtElapsed++;
    assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20 - hurtElapsed, `tick ${tick} of the miss's own held message: bt_hurt_left must still count down on its own clock`);
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 30 - tick, `tick ${tick} of the miss's own held message: bt_miss_left must count down for real`);
  }

  // Early dismissal of the MISS's own message: battle_message_done
  // force-clears bt_miss_left, but bt_hurt_left must follow ONLY its own
  // real countdown across this same tick, untouched by the clear.
  nes.cpu.mem[PAD_NEW] = BTN_A;
  callRoutine(nes, battleTickAddr);
  hurtElapsed++;
  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'the dismissal tick itself must force-clear bt_miss_left');
  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 20 - hurtElapsed, 'bt_hurt_left must follow its own independently predicted countdown across the dismissal tick, untouched by the clear that only ever targets bt_miss_left');
});

// Orchestrator addition (not a §14 row) -- disconnected-call-site coverage.
// Every other MISS test above calls battle_miss_tick/battle_miss_draw
// DIRECTLY, which cannot catch battle_tick's own `jsr battle_miss_tick` or
// battle_draw_sprites' own `jsr battle_miss_draw` being replaced by NOPs --
// the exact trap 2a's own round 1 review found (its own call sites inside
// battle_tick). This drives battle_tick itself, for real, across a full
// BT_MISS_FRAMES countdown, and confirms the OAM draw dispatch chain reaches
// battle_miss_draw too.
test('battle_tick’s own dispatch chain really calls battle_miss_tick and battle_draw_sprites really calls battle_miss_draw', {
  skip: needsSample
}, async (t) => {
  const built = await buildMissFixture(t, 'miss-real-tick-dispatch');
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);
  const OAM_IDX = resolveOamIdx(built);

  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.mem[MON_SLOT_ACTOR + 0] = 0;
  nes.cpu.mem[MON_ALIVE + 0] = 1;
  nes.cpu.mem[PC_IN_PARTY + 0] = 1;
  nes.cpu.mem[PC_HP + 0] = 50;
  nes.cpu.mem[BT_MISS_SLOT] = MAX_PARTY + 0; // the monster in slot 0
  nes.cpu.mem[BT_MISS_LEFT] = 30;

  for (let tick = 1; tick <= 31; tick++) {
    nes.cpu.mem.fill(0xff, 0x200, 0x300);
    nes.cpu.mem[PAD_NEW] = 0;
    callRoutine(nes, addrOf('battle_tick'));
    const predictedLeft = Math.max(0, 30 - tick);
    assert.equal(
      nes.cpu.mem[BT_MISS_LEFT],
      predictedLeft,
      `tick ${tick}: battle_tick's own real dispatch chain must have decremented bt_miss_left to ${predictedLeft}`
    );
    // battle_draw_sprites clears the shadow to $FF and re-parks oam_idx to 0
    // every tick, then draws MISS FIRST when it is still counting -- so OAM
    // entry 0's own TILE byte (offset 1) must read MISS_TILE_M specifically,
    // not merely "not $FF" (a combatant icon drawn at entry 0 instead, which
    // is exactly what happens once the sabotaged jsr is a no-op, is also
    // "not $FF" and would pass a weaker check).
    if (predictedLeft > 0) {
      assert.equal(
        nes.cpu.mem[0x200 + 1],
        MISS_TILE_M,
        `tick ${tick}: OAM entry 0's own tile must be MISS_TILE_M ($${MISS_TILE_M.toString(16)}) -- real evidence battle_draw_sprites reached battle_miss_draw, not merely that SOMETHING drew there`
      );
    } else {
      // Once exhausted, MISS draws nothing -- entry 0 is then whatever the
      // combatant loops drew instead (also real, just never MISS_TILE_M).
      assert.notEqual(nes.cpu.mem[0x200 + 1], MISS_TILE_M, `tick ${tick}: once bt_miss_left is 0, MISS_TILE_M must not appear at OAM entry 0`);
    }
  }
});

// §14 round 1 -- Non-miss negative coverage (finding 6). Five paths that
// resemble a miss but are not attack-evasion misses (§13.1's own
// enumeration): item_chosen_none (and round 2 finding 6: the item is not
// consumed either), battle_menu_failed, a damage spell, a status-effect
// spell, and a status tick. None of these may ever call battle_miss_arm.
test('non-miss negative coverage: item_chosen_none, battle_menu_failed, a damage spell, a status spell and a status tick never touch bt_miss_left', {
  skip: needsSample
}, async (t) => {
  const built = await buildMissFixture(t, 'miss-negative-coverage');
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);

  const freshNes = () => {
    const nes = bootPastNaming(built.romPath);
    const addrOf = selectBattleBank(nes, built);
    nes.cpu.mem[BT_PHASE] = BP_MENU;
    nes.cpu.mem[BT_ACTOR] = 0;
    nes.cpu.mem[BT_TARGET] = 0;
    nes.cpu.mem[MON_SLOT_ACTOR + 0] = 0;
    nes.cpu.mem[MON_ALIVE + 0] = 1;
    nes.cpu.mem[PC_IN_PARTY + 0] = 1;
    nes.cpu.mem[PC_HP + 0] = 50;
    nes.cpu.mem[BT_MISS_SLOT] = 0xff;
    nes.cpu.mem[BT_MISS_LEFT] = 0;
    return { nes, addrOf };
  };

  // item_chosen_none: also confirm the item is not consumed (round 2
  // finding 6) -- inv_count/items_used untouched.
  {
    const { nes, addrOf } = freshNes();
    nes.cpu.mem[INV_COUNT] = 3;
    nes.cpu.mem[ITEMS_USED] = 1;
    callRoutine(nes, addrOf('item_chosen_none'));
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'item_chosen_none must never touch bt_miss_left');
    assert.equal(nes.cpu.mem[INV_COUNT], 3, 'item_chosen_none must not consume the item');
    assert.equal(nes.cpu.mem[ITEMS_USED], 1, 'item_chosen_none must not consume the item');
  }

  // battle_menu_failed: a failed flee attempt.
  {
    const { nes, addrOf } = freshNes();
    callRoutine(nes, addrOf('battle_menu_failed'));
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'battle_menu_failed must never touch bt_miss_left');
  }

  // A damage spell (Ember, id 0, scope one) -- spells never call roll_hit.
  {
    const { nes, addrOf } = freshNes();
    nes.cpu.mem[BT_ARG] = 0;
    callRoutine(nes, addrOf('cast_spell'));
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'a damage spell must never touch bt_miss_left');
  }

  // A status-effect spell (Venom, id 2, poison).
  {
    const { nes, addrOf } = freshNes();
    nes.cpu.mem[BT_ARG] = 2;
    callRoutine(nes, addrOf('cast_spell'));
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'a status-effect spell must never touch bt_miss_left');
  }

  // A status tick (poison_tick) -- self-damage, bt_target set to bt_actor,
  // no roll_hit at all.
  {
    const { nes, addrOf } = freshNes();
    callRoutine(nes, addrOf('poison_tick'));
    assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'a status tick must never touch bt_miss_left');
  }
});

// §14 -- Message-cap asymmetry (both). Requires both flags live. A miss's
// own message dismissal must force-clear bt_miss_left while a
// separately-still-counting bt_hurt_left (from an earlier, unrelated hit) is
// NOT cleared the same way (§12.4's own stated asymmetry).
test('message-cap asymmetry: battle_message_done force-clears bt_miss_left but leaves a still-counting bt_hurt_left alone', {
  skip: needsSample
}, async (t) => {
  const built = await buildHitFeedback(t, 'asymmetry-both', (project) => {
    project.rpg.miss = true;
  });
  const nes = bootPastNaming(built.romPath);
  const addrOf = selectBattleBank(nes, built);
  const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
  const { BT_MISS_SLOT, BT_MISS_LEFT } = resolveMissAddrs(built);
  const dir = path.dirname(path.dirname(built.romPath));
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const BT_PTICK = resolveEngineAddress(constantsText, 'bt_ptick');

  nes.cpu.mem[BT_PHASE] = BP_MENU;
  nes.cpu.mem[MON_SLOT_ACTOR + 0] = 0;
  nes.cpu.mem[MON_ALIVE + 0] = 1;
  // An earlier, unrelated hit still counting down.
  nes.cpu.mem[BT_HURT_SLOT] = 0;
  nes.cpu.mem[BT_HURT_LEFT] = 15;
  // A miss just drawn this turn.
  nes.cpu.mem[BT_MISS_SLOT] = MAX_PARTY + 0;
  nes.cpu.mem[BT_MISS_LEFT] = 10;
  nes.cpu.mem[BT_ACTOR] = 0;
  nes.cpu.mem[BT_PTICK] = 0;

  callRoutine(nes, addrOf('battle_message_done'));

  assert.equal(nes.cpu.mem[BT_MISS_LEFT], 0, 'battle_message_done must force-clear bt_miss_left on dismissal');
  assert.equal(nes.cpu.mem[BT_HURT_LEFT], 15, 'battle_message_done must leave a still-counting bt_hurt_left untouched -- the stated asymmetry');
});

// fix1 item 2 -- rows 12/13 (design lines 3038/3039), the real-frame path,
// tried before any OAM-shadow fallback. Real frames and real button
// presses only (walkIntoEncounter -> chooseCommand -> tap), never a
// callRoutine excursion followed by nes.frame() -- the trap 1b's own
// history already found. The miss is forced deterministically through the
// attacking side's own stats (accuracy 0 underflows against any evasion,
// roll_hit's own unconditional branch), so no RNG control is needed
// mid-frame. Both attempts below worked on the first real try: no crash,
// no state that could not be reached -- see the report for the narrative.
//
// NES sprites display one scanline BELOW their own OAM Y byte (a
// well-documented hardware quirk this emulator reproduces exactly --
// renderer/emulator/core/ppu/index.js's own `dy = sprY + 1`), so the pixel
// row read back for glyph row 0 is the OAM Y plus 1, not the OAM Y itself.
//
// Wrong implementation this catches: a draw-order or coordinate
// regression in battle_miss_draw -- the glyph landing at the wrong anchor,
// the wrong tile order (M/I/S/S), or a palette/attribute byte that paints
// the wrong colour -- invisible to the OAM-shadow-only tests elsewhere in
// this file, which never actually render a frame.
test('MISS overlay: the real M/I/S/S glyph shape renders at the dodging monster’s own anchor, on the real PPU frame buffer', {
  skip: needsSample
}, async (t) => {
  const built = await buildVariantFull(t, 'miss-pixel-real', (project) => {
    project.rpg.miss = true;
    project.party[0].acc = 0; // guaranteed underflow miss on the party's own attack -- no RNG needed
  });

  const state = { frame: null };
  const nes = new NES({ onFrame: (buffer) => (state.frame = buffer), emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 40; i++) nes.frame(); // boot()'s own settle, mirrored here for the frame-capturing nes
  finishNamingIfOpen(nes);
  const pixelAt = (x, y) => state.frame[y * 256 + x];

  assert.ok(walkIntoEncounter(nes), 'no wandering monster after nine hundred steps');
  waitForMenu(nes);
  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should ask who to hit');

  // Baseline, BEFORE the attack: the sky above the single monster's own
  // icon row, where the overlay lands one tile up from its anchor.
  const anchorX = BT_MON_COL * 8;
  const anchorY = BT_MON_ROW * 8 - 8 + 1; // +1: the OAM-Y hardware offset
  const before = [];
  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 32; px++) before.push(pixelAt(anchorX + px, anchorY + py));
  }

  // Confirm the target: the attack resolves the very same tick, forced to
  // miss (party acc: 0), arming the overlay for real through
  // attack_missed -> battle_miss_arm. A modest frame budget lands well
  // inside the 30-tick countdown and past the one-frame OAM-DMA lag the
  // phase 1b pixel test above already documents.
  tap(nes, A, 5);
  assert.notEqual(nes.cpu.mem[BT_DMG_HI], 0, 'sanity: this must have been a miss, not a landed hit');

  const after = [];
  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 32; px++) after.push(pixelAt(anchorX + px, anchorY + py));
  }

  // Compared through the real sprite palette, not a hand-typed colour:
  // MISS's own glyphs are drawn in sprite palette 0, slot 1
  // (battle_miss_draw's own attribute byte is 0) -- shared/nespalette.js's
  // resolved RGB for that slot, read back off the booted ROM itself.
  const sprColor1 = nes.ppu.sprPalette[1];
  const glyphs = [MISS_TILE_M_ART, MISS_TILE_I_ART, MISS_TILE_S_ART, MISS_TILE_S_ART];
  const glyphNames = ['M', 'I', 'S', 'S'];
  for (let tile = 0; tile < 4; tile++) {
    const art = glyphs[tile];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const idx = row * 32 + tile * 8 + col;
        const on = art[row * 8 + col] === '1';
        if (on) {
          assert.equal(
            after[idx], sprColor1,
            `tile ${tile} (${glyphNames[tile]}) row ${row} col ${col}: an "on" pixel in the authored art must show the glyph's own slot-1 colour`
          );
        } else {
          assert.equal(
            after[idx], before[idx],
            `tile ${tile} (${glyphNames[tile]}) row ${row} col ${col}: an "off" pixel in the authored art must be unchanged from before the miss (sprite colour 0 is transparent)`
          );
        }
      }
    }
  }
});

// Row 13: the same real-frame path, with an attackAnim authored on the
// MONSTER (BATTLE_ANIM_ENABLED on, HIT_FEEDBACK_ENABLED off) so its own
// missed attack plays the flipbook over its own (attacking) slot at the
// same time MISS plays over the party member it missed -- the two
// combatant slots' own anchors (BT_MON_ROW*8 for the monster, BT_PARTY_Y
// for the party) sit at the identical Y band by coincidence in this
// project (both 32) but at entirely different X (BT_MON_COL*8=32 vs.
// BT_PARTY_X=200), so there is no risk of the two OAM draws overlapping
// pixel-for-pixel; each is read back from its own, disjoint anchor.
//
// Wrong implementation this catches: the combined-frame OAM interaction
// (§13.6) going untested until a real project hits it -- an OAM-budget
// miscalculation silently dropping one of the two draws would leave that
// one's own anchor unchanged from its own pre-attack baseline.
test('MISS overlay + battle animation: both the flipbook’s own frame and the MISS glyph render in the same rendered frame, at their own disjoint anchors', {
  skip: needsSample
}, async (t) => {
  // Distinct, solid, unambiguous colours (the 1b pixel-overlap test's own
  // precedent above) -- the monster's own resting icon is replaced with its
  // OWN solid tile too, or a "before" read here could coincidentally match
  // the flipbook's own colour through Slime's stock art sharing the same
  // palette index, proving nothing.
  const ICON_COLOR = '1'.repeat(64);
  const FX_COLOR = '2'.repeat(64);
  let fxAnimId;
  const built = await buildVariantFull(t, 'miss-plus-fx-pixel-real', (project) => {
    project.rpg.miss = true;
    // The monster's own attack must miss (acc: 0, underflow, no RNG
    // needed) and must carry the flipbook. The PARTY's own attack, taken
    // first (default speeds: Rian 4 > Slime 3, unchanged), must instead
    // LAND for certain (acc: 255, the monster's own eva forced to 0) --
    // it must never itself become a miss, or it would arm bt_miss_left
    // over the WRONG combatant before this test ever reaches the monster's
    // own turn. battleTile: null draws the monster as a sprite icon.
    project.party[0].acc = 255;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0, eva: 0, battleTile: null };
    const tileset = project.tilesets[project.rpg.battleTilesetId];
    const iconTile = 200;
    const fxTile = 201;
    tileset.sprites.tiles[iconTile] = ICON_COLOR;
    tileset.sprites.tiles[fxTile] = FX_COLOR;
    const slimeMetaId = project.sprites.actors[0].anims.walkDown;
    project.sprites.metasprites[slimeMetaId].tiles = [{ tile: iconTile, x: 0, y: 0, palette: 0, hflip: false, vflip: false }];
    const fxMetaId = project.sprites.metasprites.length;
    project.sprites.metasprites.push({
      id: fxMetaId,
      name: 'FxMiss',
      tiles: [{ tile: fxTile, x: 0, y: 0, palette: 0, hflip: false, vflip: false }]
    });
    fxAnimId = project.sprites.animations.length;
    project.sprites.animations.push({ id: fxAnimId, name: 'FxMiss', loop: false, frames: [{ metaspriteId: fxMetaId, duration: 30 }] });
    project.sprites.actors[0].battle.attackAnim = fxAnimId;
  });

  const state = { frame: null };
  const nes = new NES({ onFrame: (buffer) => (state.frame = buffer), emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 40; i++) nes.frame();
  finishNamingIfOpen(nes);
  const pixelAt = (x, y) => state.frame[y * 256 + x];

  assert.ok(walkIntoEncounter(nes), 'no wandering monster after nine hundred steps');
  waitForMenu(nes);

  // The party's own turn, forced to land (never a miss): FIGHT, confirm
  // the target, and let the exchange resolve into the message it prints.
  // Both battle_fx_anim and bt_miss_left are still untouched here -- the
  // party's own physical attack never arms either.
  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should ask who to hit');
  tap(nes, A, 3);
  assert.equal(nes.cpu.mem[BT_DMG_HI], 0, 'sanity: the party’s own attack must have landed (acc: 255, eva: 0)');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the party’s own message should still be up, not yet dismissed');

  // Baseline reads: the message is still up, one turn away from the
  // monster's own -- the monster's own icon cell (the flipbook's anchor,
  // still its own resting ICON_COLOR) and the sky above the party's own
  // row (the MISS anchor, plain background).
  const BT_PARTY_X = 200; // engine/constants.asm
  const BT_PARTY_Y = 32;
  const fxX = BT_MON_COL * 8 + 4;
  const fxY = BT_MON_ROW * 8 + 4 + 1; // +1: OAM-Y hardware offset
  const missAnchorX = BT_PARTY_X;
  const missAnchorY = BT_PARTY_Y - 8 + 1;
  const fxBefore = pixelAt(fxX, fxY);
  const missBefore = [];
  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 32; px++) missBefore.push(pixelAt(missAnchorX + px, missAnchorY + py));
  }

  // Dismiss the party's own message -- battle_message_advance moves the
  // round on to the monster, whose own turn (monster_turn_attack, forced
  // to miss) runs synchronously, within the very same tick, arming both
  // the flipbook (over its own attacking slot) and MISS (over the party
  // member it missed) for real.
  tap(nes, A, 5);
  assert.notEqual(nes.cpu.mem[BT_DMG_HI], 0, 'sanity: the monster’s own attack must have missed (acc: 0)');
  for (let i = 0; i < 2; i++) nes.frame(); // settle past the one-frame OAM-DMA lag

  const fxAfter = pixelAt(fxX, fxY);
  const missAfter = [];
  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 32; px++) missAfter.push(pixelAt(missAnchorX + px, missAnchorY + py));
  }

  assert.notEqual(fxAfter, fxBefore, 'the flipbook’s own frame must have rendered over the attacking monster’s own slot');
  assert.equal(fxAfter, nes.ppu.sprPalette[2], 'the flipbook’s own frame must show FX_COLOR’s own resolved sprite-palette slot 2');

  const sprColor1 = nes.ppu.sprPalette[1];
  const glyphs = [MISS_TILE_M_ART, MISS_TILE_I_ART, MISS_TILE_S_ART, MISS_TILE_S_ART];
  const glyphNames = ['M', 'I', 'S', 'S'];
  for (let tile = 0; tile < 4; tile++) {
    const art = glyphs[tile];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const idx = row * 32 + tile * 8 + col;
        const on = art[row * 8 + col] === '1';
        if (on) {
          assert.equal(
            missAfter[idx], sprColor1,
            `tile ${tile} (${glyphNames[tile]}) row ${row} col ${col}: MISS's own glyph must still render at its own anchor alongside the flipbook`
          );
        } else {
          assert.equal(
            missAfter[idx], missBefore[idx],
            `tile ${tile} (${glyphNames[tile]}) row ${row} col ${col}: unchanged background where the art is "off"`
          );
        }
      }
    }
  }
});
