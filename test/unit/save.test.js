// Battery-backed save/load (engine/save.asm) — the one place this suite has
// to fake a power cycle, because that is the only thing that actually proves
// the feature.
//
// The vendored jsnes core treats $6000-$7FFF as plain cpu.mem: mapper0's
// load/write cover it and MMC1/MMC3 inherit that, so it emulates no WRAM
// enable or write-protect bit at all (rom.batteryRam is a vestigial boolean
// upstream never wired to anything). That means every test below proves the
// record's *logic* -- the layout, the checksum, the identity, the range
// checks, Continue's wiring into init_session -- and nothing here can prove
// the MMC3 $A001 write or MMC1's held PRG-RAM-disable bit are correct on
// real hardware or in Mesen. Those go to the reviewer by inspection
// (engine/banks.asm) and, if available, the Mesen Lua runner.
//
// A recurring shape below, learned from a review pass that found four real
// bugs the first version of this file could not see: each one was invisible
// because the fixture happened to pick the one shape that could not expose
// it -- Save was always the last command on its page, the saved map always
// had songId: null, the "different build" test only ever flipped a marker
// byte to a value no real build writes. Every test here that guards a fix
// is built in the shape that would have caught the bug, not the shape that
// happens to exercise the code.
//
// powerCycle() below is what a real power cycle with the battery intact
// looks like on this core: snapshot $6000-$7FFF, reloadROM() (which rebuilds
// the mapper and calls nes.reset(), the same full reset a real console does
// on every power-up), then write the snapshot back -- exactly the part of
// the console a battery keeps powered when everything else loses state.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { Emulator } from '../../renderer/emulator/runcontrol.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createSong } from '../../shared/audio.js';
import { renumberSpellDeletion } from '../../shared/project.js';
import { saveIdentity } from '../../shared/save.js';
import { battleTables, statAt } from '../../main/build/battletables.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const SWITCHES = 0x390;
const VARIABLES = 0x500;
const CUR_SONG = 0x8b; // cur_map+1, cur_map = bt_owner_rec+1 = $8A
const NO_SONG = 0xff;
// Magic Forge phase 4 (BE_RESTORE) — the live, per-member RAM arrays
// party_apply_level writes, indexed by adding the member index directly
// (each is MAX_PARTY bytes wide, contiguous).
const PC_HP_MAX = 0x039c;
const PC_MP_MAX = 0x03a4;
const PC_SPELLS = 0x03b8;

const ST_GAMEPLAY = 0;
const ST_TITLE = 3;

const A = 0;
const SELECT = 2;
const START = 3;
const RIGHT = 7;
const LEFT = 6;
const DOWN = 5;
const UP = 4;

const SRAM_BASE = 0x6000;
const SRAM_SIZE = 0x2000;
// The record's own layout, from assets/save.inc (shared/save.js's
// SAVE_FIELDS + main/build/generate.js) — fixed regardless of which project
// builds it, since none of these fields' sizes vary with project content
// (only the *identity*, which folds in screen/map counts, does). Offsets
// relative to SRAM_BASE, sourced by hand from a real build rather than read
// back out of the one under test, which would prove nothing.
const SAVE_FLAT_SCREEN_OFFSET = 0x00;
const SAVE_PLAYER_Y_OFFSET = 0x02;
const SAVE_PLAYER_DIR_OFFSET = 0x03;
const SAVE_INV_ITEMS_OFFSET = 0x1d;
const SAVE_INV_COUNT_OFFSET = 0x25;
const SAVE_PARTY_SIZE_OFFSET = 0x29;
// Magic Forge phase 4 (BE_RESTORE) — sourced the same way, by hand from a
// real build's assets/save.inc (`SAVE_PC_HP_MAX = $6030`, `SAVE_PC_MP_MAX =
// $6038`, `SAVE_PC_SPELLS = $604C`, each minus SRAM_BASE).
const SAVE_PC_HP_MAX_OFFSET = 0x30;
const SAVE_PC_MP_MAX_OFFSET = 0x38;
const SAVE_PC_LEVEL_OFFSET = 0x3c;
const SAVE_PC_IN_PARTY_OFFSET = 0x48;
const SAVE_PC_SPELLS_OFFSET = 0x4c;
const SAVE_CHECKSUM_LO_OFFSET = 0x50;
const SAVE_CHECKSUM_HI_OFFSET = 0x51;
// Widened from two bytes to four this round -- see shared/save.js's
// saveIdentity() for why -- which pushed the marker from 0x54 to 0x56.
const SAVE_IDENTITY_OFFSET = 0x52;
const SAVE_MARKER_OFFSET = 0x56;
const SAVE_BODY_LEN = 80;
const SAVE_MARKER_VALID = 0xa5;

function boot(romPath, frames = 60) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const tap = (nes, button, frames = 10) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

/**
 * A real power cycle with the battery intact: everything but $6000-$7FFF
 * loses state, the same as unplugging and replugging an NES with a
 * battery-backed cartridge in it. reloadROM() is doing what boot already
 * does on a real console (rebuild the mapper, nes.reset()); the snapshot and
 * restore around it is what a battery being there, instead of not, changes.
 * Takes anything shaped like { cpu: { mem }, reloadROM() } — a bare NES or
 * an Emulator's own .nes both qualify.
 */
function powerCycle(nes, frames = 60) {
  const battery = nes.cpu.mem.slice(SRAM_BASE, SRAM_BASE + SRAM_SIZE);
  nes.reloadROM();
  nes.cpu.mem.set(battery, SRAM_BASE);
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const walkTo = (nes, targetX, targetY, budget = 400) => {
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
};

/** Step toward (targetX, targetY) one frame at a time, stopping the instant `until` is true. */
function walkUntil(nes, targetX, targetY, until, budget = 400) {
  for (let i = 0; i < budget; i++) {
    if (until()) return true;
    if (nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY) return false;
    const dx = targetX - nes.cpu.mem[PLAYER_X];
    const dy = targetY - nes.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) return until();
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
    if (until()) return true;
  }
  return until();
}

/**
 * A project that can save: sample-rpg, on MMC1, with a title (Continue needs
 * one) and a touch-triggered NPC a few steps from the start whose event is
 * `commands`. Touch, not interact: the event has no Say, so game_state never
 * leaves ST_GAMEPLAY and there is no message box to drive through first.
 */
async function buildSaveable(t, commands, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-save-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
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
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] }
    }
  });
  if (mutate) mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return built.romPath;
}

/** Walk onto the saver at (64,96), stopping the instant `until` is true (default: the marker validates). */
function touchSaver(nes, until = () => nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET] === SAVE_MARKER_VALID) {
  const touched = walkUntil(nes, 64, 96, until);
  assert.ok(touched, 'walking to the saver never satisfied the given condition');
  for (let i = 0; i < 10; i++) nes.frame(); // let the step that touched it settle to a stop
}

test(
  'save, power cycle, Continue: the world is where it was, switches and variables intact',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [
      { op: 'setSwitch', switch: 5 },
      { op: 'setVar', variable: 2, value: 9 },
      { op: 'save' }
    ]);
    const nes = boot(romPath);
    tap(nes, START); // into the game, past the title
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'never left the title');

    touchSaver(nes);
    const savedX = nes.cpu.mem[PLAYER_X];
    const savedY = nes.cpu.mem[PLAYER_Y];
    const savedScreen = nes.cpu.mem[FLAT_SCREEN];
    assert.equal(nes.cpu.mem[SWITCHES] & (1 << 5), 1 << 5, 'switch 5 should be set before the save even round-trips');
    assert.equal(nes.cpu.mem[VARIABLES + 2], 9, 'variable 2 should be set before the save even round-trips');

    // Walk away, so the game-in-progress position would visibly differ from
    // both the saved spot and the fresh-game start spot -- proving Continue
    // restores the saved position specifically, not just any position.
    walkTo(nes, 176, 176);
    assert.notEqual(nes.cpu.mem[PLAYER_X], savedX, 'walking away should have moved the player');

    powerCycle(nes);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'a power cycle should boot back to the title');

    tap(nes, SELECT); // Continue -- bound to SELECT by default in the title state
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'Continue should have loaded the save and resumed play');
    assert.equal(nes.cpu.mem[PLAYER_X], savedX, "Continue should restore the player's saved x");
    assert.equal(nes.cpu.mem[PLAYER_Y], savedY, "Continue should restore the player's saved y");
    assert.equal(nes.cpu.mem[FLAT_SCREEN], savedScreen, 'Continue should restore the saved screen');
    assert.equal(nes.cpu.mem[SWITCHES] & (1 << 5), 1 << 5, 'switch 5 should have survived the round trip');
    assert.equal(nes.cpu.mem[VARIABLES + 2], 9, 'variable 2 should have survived the round trip');
  }
);

// --- bug 1: Save has no operand ---------------------------------------------
//
// script_op_save used to end `jmp script_next2`, which skips an opcode byte
// *and* an operand byte -- correct for every other command Save was modelled
// on, wrong for Save itself, which OP_SAVE (engine/constants.asm) spells out
// has none. The old test never caught it because Save was always the last
// command on its page: skipping one byte too many just landed on the page's
// own terminator, which reads as "page over" either way. Putting a real
// command after Save is what makes the extra skip visible -- it corrupts or
// swallows whatever follows, rather than harmlessly overshooting into
// nothing.

test(
  'Save does not corrupt the command that follows it',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }, { op: 'setSwitch', switch: 7 }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes, () => nes.cpu.mem[SWITCHES] & (1 << 7));
    assert.equal(
      nes.cpu.mem[SWITCHES] & (1 << 7),
      1 << 7,
      'the Set switch command right after Save should still have run'
    );
  }
);

// --- bug 2: overwriting a save is not interruption-safe ---------------------
//
// Writing the marker last protects only the *first* save: on every save
// after that, an old, still-valid record is sitting there while the body
// underneath it is being replaced, and a power loss partway through that
// replacement can leave the old marker and checksum both still agreeing with
// a body that is now some of the old save and some of the new one. The fix
// invalidates the marker before touching anything else, so the same
// interruption instead leaves no valid save at all -- recoverable by saving
// again, unlike a silently hybrid session.
//
// This drives the emulator instruction-by-instruction (Emulator, not the
// bare NES the rest of this file uses) with a write-watchpoint on the
// marker's own address, so what it observes is the real engine's real
// execution order, not a hand-constructed byte pattern standing in for it.

/** Frame-step an Emulator exactly like the bare-NES helpers above do. */
function emuTap(emulator, button, frames = 10) {
  emulator.setButton(button, true);
  emulator.nes.frame();
  emulator.setButton(button, false);
  for (let i = 0; i < frames; i++) emulator.nes.frame();
}

test(
  'overwriting a save invalidates the marker before touching anything else',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(new Uint8Array(fs.readFileSync(romPath)));
    for (let i = 0; i < 60; i++) emulator.nes.frame();
    emuTap(emulator, START);

    // Save A: switches/variables poked directly (this is about the record
    // mechanics, not about authoring the state that goes into it), then one
    // real touch.
    emulator.nes.cpu.mem[SWITCHES] = 0x00;
    emulator.nes.cpu.mem[VARIABLES + 2] = 5;
    touchSaver(emulator.nes);
    assert.equal(emulator.nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'save A never completed');

    // Simulate having played on since save A: different switches, different
    // variable. Walk off the saver's tile and back so touch can fire again.
    emulator.nes.cpu.mem[SWITCHES] = 0xff;
    emulator.nes.cpu.mem[VARIABLES + 2] = 99;
    walkTo(emulator.nes, 64, 60);

    // Now step the return approach one instruction at a time, watching for
    // the first write to the marker's own SRAM address.
    const markerAddr = SRAM_BASE + SAVE_MARKER_OFFSET;
    emulator.writeWatch.add(markerAddr);
    emulator.setButton(DOWN, true);
    let hit = null;
    for (let i = 0; i < 4_000_000 && !hit; i++) {
      emulator.stepInstruction();
      hit = emulator.checkBreak();
    }
    emulator.setButton(DOWN, false);
    assert.ok(hit, 'the second touch never wrote the marker at all -- did it fire?');
    assert.equal(hit.address, markerAddr);

    // The key assertion: the *first* write to the marker during an overwrite
    // must not be the valid sentinel -- it must be the upfront invalidate.
    assert.notEqual(
      hit.value,
      SAVE_MARKER_VALID,
      "the marker's first write during a second save must invalidate it, not already be the final valid write"
    );

    // Pull the plug right there, mid-overwrite, and confirm the interrupted
    // save reads as no save at all rather than a hybrid of A and B.
    powerCycle(emulator.nes);
    assert.equal(emulator.nes.cpu.mem[GAME_STATE], ST_TITLE);
    tap(emulator.nes, SELECT);
    assert.equal(
      emulator.nes.cpu.mem[GAME_STATE],
      ST_TITLE,
      'an overwrite interrupted right after the invalidate must not be offered to Continue'
    );
  }
);

// --- bug 3: Continue comes back with the music off --------------------------
//
// init_session stops the music and sets cur_map = NO_MAP; apply_map_music
// (engine/music.asm) trusts "cur_map already matches this screen's map" to
// mean "and that map's music is already playing". Restoring a saved cur_map
// used to satisfy the first half of that without the second, so
// apply_map_music saw them match and started nothing. The fix is that
// cur_map is no longer part of the record at all (shared/save.js), so
// init_session's own NO_MAP reset stands and apply_map_music decides fresh,
// the same as any other arrival. The old test's map had songId: null, which
// cannot tell "silent because nothing should play" from "silent because the
// invariant broke" apart -- this one gives the map a real song.

test(
  'Continue comes back with the map\'s music playing, not silence',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }], (project) => {
      project.songs.push(createSong('Test Song'));
      project.maps[0].songId = 0;
    });
    const nes = boot(romPath);
    tap(nes, START);
    assert.notEqual(nes.cpu.mem[CUR_SONG], NO_SONG, 'the map should already be playing its song before any save');

    touchSaver(nes);
    powerCycle(nes);
    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'Continue should have loaded the save and resumed play');
    assert.notEqual(
      nes.cpu.mem[CUR_SONG],
      NO_SONG,
      "Continue should leave the map's song playing, not silence"
    );
  }
);

// --- bug 4: the identity does not identify a project -------------------------
//
// The first identity folded in only layout facts (how many variables, how
// many party slots, how many inventory slots, a layout version) that are the
// same for every project this engine builds -- a *layout* identity, not a
// project one. Reflash a different project onto the same cartridge and the
// old identity, and the checksum computed over the same byte count either
// way, both still agreed. The fix folds in the project's own screen and map
// counts (and, two rounds later, actor count, level cap, actual party count
// and whether battle is enabled at all, widening to 32 bits -- see
// shared/save.js's own comment for the full history); this build's own
// project has more screens than the alternate project below, so the two now
// genuinely disagree. But the identity is still only what makes a mismatch
// *likely* to be caught, not what makes a load *safe* -- two projects that
// agree on every count it folds in still collide here by construction,
// which is exactly why range-checking what gets restored (bugs 5 and 6,
// below) is the check that actually stands between a hand-edited or foreign
// record and an out-of-bounds index, identity notwithstanding.

test(
  "a save from a different project's build is refused, not misapplied",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');
    const foreignBattery = nes.cpu.mem.slice(SRAM_BASE, SRAM_BASE + SRAM_SIZE);

    // A second project, same engine version, same RPG_LIMITS -- but a
    // different screen count, which is exactly the fact the old identity
    // never looked at. It needs a live Save command of its own too, or
    // SAVE_ENABLED is off and this build never assembles Continue at all --
    // which would make this test pass for having nothing to accept the
    // foreign save *with*, not for correctly refusing it.
    const otherRomPath = await buildSaveable(t, [{ op: 'save' }], (project) => {
      project.maps.push({
        id: project.maps.length,
        name: 'Extra',
        gridW: 1,
        gridH: 1,
        screens: [
          {
            metatiles: new Array(240).fill(0),
            attributes: new Array(64).fill(0),
            entities: [],
            neighbours: { up: null, down: null, left: null, right: null },
            name: ''
          }
        ],
        tilesetId: project.maps[0].tilesetId,
        encounters: { rate: 0, actorIds: [] },
        songId: null
      });
    });
    const other = boot(otherRomPath);
    other.cpu.mem.set(foreignBattery, SRAM_BASE);
    tap(other, SELECT);
    assert.equal(
      other.cpu.mem[GAME_STATE],
      ST_TITLE,
      "a save written by a project with a different screen count must be refused, not restored into this one"
    );
  }
);

/** The exact 2-byte checksum save_checksum (engine/save.asm) computes. */
function computeChecksum(bytes) {
  let sum1 = 0;
  let sum2 = 0;
  for (const b of bytes) {
    sum1 = (sum1 + b) & 0xff;
    sum2 = (sum2 + sum1) & 0xff;
  }
  return [sum1, sum2];
}

test(
  'a restored value out of this build\'s own range is refused, checksum and identity notwithstanding',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');

    // Corrupt flat_screen to a value this build cannot have a screen at, then
    // recompute a checksum that matches the corrupted body -- so identity and
    // checksum both still pass, and only the range check on load can catch
    // this. 250 screens is not a value normalizeProject or the compiler would
    // ever produce for a project this small; it is what a hand-edited or
    // bit-flipped SRAM looks like.
    nes.cpu.mem[SRAM_BASE + SAVE_FLAT_SCREEN_OFFSET] = 250;
    const body = nes.cpu.mem.slice(SRAM_BASE, SRAM_BASE + SAVE_BODY_LEN);
    const [sum1, sum2] = computeChecksum(body);
    nes.cpu.mem[SRAM_BASE + SAVE_CHECKSUM_LO_OFFSET] = sum1;
    nes.cpu.mem[SRAM_BASE + SAVE_CHECKSUM_HI_OFFSET] = sum2;

    powerCycle(nes);
    tap(nes, SELECT);
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_TITLE,
      'an out-of-range flat_screen must be refused even with a self-consistent checksum'
    );
  }
);

// --- bug 5: four more restored values were trusted as indices ---------------
//
// A byte read out of SRAM is untrusted input (see engine/save.asm's header
// comment). The identity and checksum only prove a record is self-consistent
// and came from a build shaped like this one -- they say nothing about
// whether an individual field is safe to index with, which is what each of
// these four checks now guards. Same shape as the flat_screen test above:
// corrupt exactly one field in an otherwise-real save, recompute a matching
// checksum, and confirm nothing but the new check can refuse it.

function corruptAndReseal(nes, offset, value) {
  nes.cpu.mem[SRAM_BASE + offset] = value;
  const body = nes.cpu.mem.slice(SRAM_BASE, SRAM_BASE + SAVE_BODY_LEN);
  const [sum1, sum2] = computeChecksum(body);
  nes.cpu.mem[SRAM_BASE + SAVE_CHECKSUM_LO_OFFSET] = sum1;
  nes.cpu.mem[SRAM_BASE + SAVE_CHECKSUM_HI_OFFSET] = sum2;
}

test(
  'a restored player_dir of 4 is refused -- build_oam only has four directions',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');

    corruptAndReseal(nes, SAVE_PLAYER_DIR_OFFSET, 4);

    powerCycle(nes);
    tap(nes, SELECT);
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_TITLE,
      'a player_dir this build has no player_tiles row for must be refused'
    );
  }
);

test(
  'a restored player_y that would index past the screen record is refused',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');

    // 235: with BODY_B (15) added, the collision probe lands on row 15 -- past
    // the 240-byte per-screen metatile record. 225 is the first value ordinary
    // movement's own MAX_Y clamp would never produce either.
    corruptAndReseal(nes, SAVE_PLAYER_Y_OFFSET, 235);

    powerCycle(nes);
    tap(nes, SELECT);
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_TITLE,
      'a player_y past MAX_Y must be refused even though it fits in a byte'
    );
  }
);

test(
  'a restored inv_items entry naming no item this build has is refused',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // Give an item first, so inv_count > 0 and the corrupted slot is one the
    // live-entries loop actually walks -- corrupting an unused slot would
    // prove nothing, since draw_menu never reads past inv_count either. Item
    // 0 is sample-rpg's own "Potion" -- sample-rpg has a live item, so
    // ITEMS_ENABLED is true for this build and inv_items now holds the item
    // id directly (0), not the actor id (1) it used to back it with.
    const romPath = await buildSaveable(t, [{ op: 'give', item: 0 }, { op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes, () => nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET] === SAVE_MARKER_VALID);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');
    assert.ok(
      nes.cpu.mem[SRAM_BASE + SAVE_INV_COUNT_OFFSET] > 0,
      'the Give command should have left a live inventory entry to corrupt'
    );

    // This build has 1 item (sample-rpg's Potion, NUM_ITEMS = 1): 200 names
    // none of them, and refuses under the ITEMS_ENABLED bound (NUM_ITEMS)
    // rather than the legacy actor one (NUM_ACTORS) this build never reads.
    corruptAndReseal(nes, SAVE_INV_ITEMS_OFFSET, 200);

    powerCycle(nes);
    tap(nes, SELECT);
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_TITLE,
      "a live inv_items entry naming no item this build has must be refused"
    );
  }
);

test(
  // Deliverable 4 (phase 4 design, §8): direct RAM-level coverage that the
  // bound is really NUM_ITEMS and not still NUM_ACTORS. A corruption value
  // past both (the test above, 200) cannot tell the two apart -- it fails
  // either way. 1 is a real, valid actor id in this 5-actor build (sample-rpg's
  // 4 plus the Saver) but not a valid item id in this 1-item build
  // (NUM_ITEMS = 1, ids 0 only), so this only fails if the enabled-path
  // bound genuinely switched to NUM_ITEMS rather than silently staying
  // NUM_ACTORS under the new .if ITEMS_ENABLED branch.
  'a restored inv_items entry naming a real actor but no real item is still refused',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'give', item: 0 }, { op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes, () => nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET] === SAVE_MARKER_VALID);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');
    assert.ok(
      nes.cpu.mem[SRAM_BASE + SAVE_INV_COUNT_OFFSET] > 0,
      'the Give command should have left a live inventory entry to corrupt'
    );

    corruptAndReseal(nes, SAVE_INV_ITEMS_OFFSET, 1);

    powerCycle(nes);
    tap(nes, SELECT);
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_TITLE,
      'an inv_items entry of 1 must be refused under NUM_ITEMS (=1, ids 0 only) even though actor 1 is real -- ' +
        'a pass here would mean save_check_valid is still bounding this build against NUM_ACTORS'
    );
  }
);

test(
  'a restored pc_level of 0 is refused -- try_level_up would decrement it past the table',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');

    // init_session starts every party member at level 1, so the first
    // pc_level slot is a live one -- 0 is a floor violation a ceiling-only
    // check would never catch.
    corruptAndReseal(nes, SAVE_PC_LEVEL_OFFSET, 0);

    powerCycle(nes);
    tap(nes, SELECT);
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_TITLE,
      'a pc_level of 0 must be refused -- try_level_up would dey it to $FF'
    );
  }
);

// --- bug 6: MAX_PARTY is a capacity, the party tables are as long as the party --
//
// pc_level's own bound is against MAX_LEVEL, which is correct because
// xp_next_lo/hi are generated to MAX_LEVEL rows regardless of the project --
// a fixed engine capacity. pc_metasprite, pc_speed and pc_name are a
// different shape entirely: generated only as long as project.party.length,
// the project's *actual* roster. A save with a live pc_in_party slot at or
// past that length passes every existing check (marker, identity, checksum,
// party_size <= MAX_PARTY, every pc_level in range) and then reads past
// those tables the moment battle_draw_sprites or build_spell_list trusts the
// slot as a living combatant. sample-rpg's own party has 2 members, so slot
// 3 is exactly such a slot: never touched by this project's own play, only
// reachable by corrupting the record directly.

test(
  "a live pc_in_party slot beyond this project's actual party is refused",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');

    // sample-rpg has 2 party members (PARTY_SIZE = 2), so slot 3 names no
    // one this build generated a pc_metasprite/pc_speed/pc_name row for.
    // party_size and every pc_level slot are already in range -- only the
    // new pc_in_party bound can catch this.
    corruptAndReseal(nes, SAVE_PC_IN_PARTY_OFFSET + 3, 1);

    powerCycle(nes);
    tap(nes, SELECT);
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_TITLE,
      "a live pc_in_party slot past this project's real party must be refused"
    );
  }
);

test(
  'a corrupt checksum reads as no save, and Continue is not offered for it',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the save never actually happened');

    // Flip a bit in the middle of the body after the fact -- the marker and
    // the identity both still read as whatever the real save wrote, so only
    // save_check_valid's checksum recompute can catch this.
    nes.cpu.mem[SRAM_BASE + 10] ^= 0xff;

    powerCycle(nes);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE);

    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'Continue over a corrupt save should do nothing');
  }
);

test(
  'a blank cartridge (never saved) offers no Continue either',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE);
    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'Continue on a fresh cartridge should do nothing');
  }
);

test(
  'a project with no Save command ships with the battery header bit clear',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-nosave-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = 1; // MMC1 -- battery-capable, but nothing uses it
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const header = await fs.promises.readFile(built.romPath);
    assert.equal(header[6] & 0x02, 0, 'a project with no Save command must not set the battery bit');
  }
);

// --- Magic Forge phase 4: BE_RESTORE (handoff-magic/phase4-design.md) ------
//
// continue_game (engine/save.asm) now calls call_battle(BE_RESTORE) once,
// right after load_apply_body, to recompute every party member's pc_spells
// (and, as an accepted side effect, pc_hp_max/pc_mp_max) from their restored
// pc_level against the *current* build's own tables -- the save's raw
// pc_spells byte is a bitmask of catalog *positions*, and nothing renumbers
// it when a spell is deleted, so a save written before the delete would
// otherwise restore a party that knows the wrong spell (see
// engine/battle.asm's own party_restore comment for the full account).
//
// A small helper, not exported by battletables.js itself: nesasm assembles
// every .db operand in this file as one contiguous byte stream regardless of
// which label sits in front of it, so a table's own "past the end" bytes are
// simply whatever the next .db line(s) after it happen to hold -- real,
// deterministic output, not undefined behaviour. Reading it this way (off
// battleTables(project)'s own returned text, in JS, before assembly ever
// runs) is one of the two techniques the design's own Q6 names; the other is
// parsing the built assets/battle.inc, which would say the same thing, since
// that file's content *is* this function's return value.
function flattenBattleTableBytes(project) {
  const text = battleTables(project);
  const bytes = [];
  const labelOffsets = {};
  for (const line of text.split('\n')) {
    const label = line.match(/^(\w+):$/);
    if (label) {
      labelOffsets[label[1]] = bytes.length;
      continue;
    }
    const db = line.match(/^\s*\.db\s+(.+)$/);
    if (db) {
      for (const token of db[1].split(',')) bytes.push(parseInt(token.trim().replace('$', ''), 16));
    }
  }
  return { bytes, labelOffsets };
}

/** level_row's own arithmetic (engine/battle.asm): Y = member * MAX_LEVEL + level - 1. */
function levelRow(project, member, level) {
  return member * project.rpg.maxLevel + (level - 1);
}

/**
 * The spell bitmask party_apply_level would compute for `member` at `level`
 * against `project`'s *current* spells catalog -- the same algorithm
 * battleTables' own `known` builds (main/build/battletables.js), reimplemented
 * here rather than imported because the source computes it inline for every
 * member/level pair at once, not as a callable single-lookup function.
 */
function expectedSpellMask(project, memberIndex, level) {
  const member = project.party[memberIndex];
  let mask = 0;
  for (const entry of member.spells ?? []) {
    const slot = project.spells.findIndex((spell) => spell.id === entry.spellId);
    if (slot < 0 || slot > 7) continue;
    if (level >= Math.max(1, entry.level)) mask |= 1 << slot;
  }
  return mask;
}

/** buildSaveable's own shape, but keeping the project object for saveIdentity(). */
async function buildSaveableProject(t, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-restore-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 1; // MMC1
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  const saverId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  project.maps[0].screens[0].entities.push({
    actorId: saverId,
    x: 64,
    y: 96,
    props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
  if (mutate) mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, romPath: built.romPath };
}

// Wrong implementation this catches: a BE_RESTORE that is never called at
// all -- a no-op stub, or one that forgot the .if BATTLE_ENABLED gate and
// quietly did nothing -- would leave pc_spells/pc_hp_max/pc_mp_max holding
// the raw transplanted bytes ROM A wrote under the OLD catalog, not the
// values ROM B's own current tables say for the restored level.
test(
  'BE_RESTORE recomputes pc_spells/pc_hp_max/pc_mp_max from the restored level against the current build, not the transplanted save',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // ROM A: sample-rpg as checked in. Rian (party member 0) knows Ember
    // (spell id 0) at level 1, Venom (id 2) at level 2, Mend (id 1) at level
    // 3 -- sample-rpg/party.json's own data, unmutated.
    const a = await buildSaveableProject(t);

    // ROM B: the identical project, with "Mend" (spell index 1) deleted the
    // same way the Magic Forge's own delete handler does it (renderer/
    // forges/magic/magic.js): renumberSpellDeletion first (repairs every
    // reference), then splice, then renumber the remaining ids to their new
    // positions. Venom (was index 2) becomes index 1; Mend is gone.
    const b = await buildSaveableProject(t, (project) => {
      renumberSpellDeletion(project, 1);
      project.spells.splice(1, 1);
      project.spells.forEach((entry, position) => (entry.id = position));
    });

    // The transplant below is only meaningful if save_check_valid actually
    // accepts it on ROM B -- assert the precondition directly rather than
    // assume it: saveIdentity folds in none of project.spells (shared/
    // save.js), so a spell-catalog-only change must never move the identity.
    assert.equal(
      saveIdentity(a.project),
      saveIdentity(b.project),
      'a spell catalog change alone must not move saveIdentity, or this transplant proves nothing'
    );

    // Every value computed up front, before anything is written to a
    // record: the stale mask/hp_max/mp_max ROM A's own catalog gives member
    // 0 at level 3 (what a save actually written by ROM A at that level
    // would coherently carry, and what load_apply_body alone would leave in
    // place if BE_RESTORE never ran), against the correct mask ROM B's own
    // (post-delete) catalog gives the same member/level. The masks must
    // differ, or this fixture cannot tell "recomputed" from "trusted the
    // transplanted byte" apart.
    const staleMask = expectedSpellMask(a.project, 0, 3);
    assert.equal(staleMask, 0b111, 'fixture setup is wrong if ROM A does not have Rian knowing all three spells at level 3');
    const expectedMask = expectedSpellMask(b.project, 0, 3);
    assert.equal(expectedMask, 0b011, "fixture setup is wrong if ROM B's own catalog does not give Rian exactly Ember+Venom at level 3");
    assert.notEqual(expectedMask, staleMask, 'ROM A and ROM B must disagree about the mask, or this fixture proves nothing');

    const staleHpMax = statAt(a.project.party[0].baseHp, a.project.party[0].hpPerLevel, 3);
    const staleMpMax = statAt(a.project.party[0].baseMp, a.project.party[0].mpPerLevel, 3);
    const expectedHpMax = statAt(b.project.party[0].baseHp, b.project.party[0].hpPerLevel, 3);
    const expectedMpMax = statAt(b.project.party[0].baseMp, b.project.party[0].mpPerLevel, 3);
    // ROM A and ROM B share the identical party.json stats -- only the spell
    // catalog differs between them -- so these are equal by construction,
    // confirmed rather than assumed: the hp/mp assertions below therefore
    // only prove "recomputed to a sane value for the restored level," not
    // "recomputed against ROM B's own catalog rather than ROM A's carried-
    // over one" -- the mask is the one assertion in this fixture that can
    // tell the two builds apart (round 1 review, finding 1).
    assert.equal(staleHpMax, expectedHpMax, "fixture assumption wrong: ROM A and ROM B's own level-3 hp_max should be identical");
    assert.equal(staleMpMax, expectedMpMax, "fixture assumption wrong: ROM A and ROM B's own level-3 mp_max should be identical");

    // A real save on ROM A, then plant all four of ROM A's own coherent
    // level-3 values directly into the sealed record -- corruptAndReseal is
    // the file's own existing "plant one byte, reseal the checksum around
    // it" tool, called four times in a row (each reseals over the record's
    // then-current state, so the final checksum covers all four pokes
    // together). `pc_level` alone is not an invalid value to plant (1..
    // MAX_LEVEL is legal); `pc_spells`/`pc_hp_max`/`pc_mp_max` are what make
    // this a *coherent* level-3 record rather than a level-1 one wearing a
    // level-3 label -- round 1 review, finding 1: the previous version of
    // this fixture only ever changed `pc_level`, leaving the level-1 mask
    // (`1`) in place, so the omitted-call sabotage caught `1 !== 3` rather
    // than the intended stale-catalog `7 !== 3`.
    const nesA = boot(a.romPath);
    tap(nesA, START);
    touchSaver(nesA);
    assert.equal(nesA.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save on ROM A never completed');
    corruptAndReseal(nesA, SAVE_PC_LEVEL_OFFSET, 3); // member 0's level (offset 0 within the field)
    corruptAndReseal(nesA, SAVE_PC_SPELLS_OFFSET, staleMask);
    corruptAndReseal(nesA, SAVE_PC_HP_MAX_OFFSET, staleHpMax);
    corruptAndReseal(nesA, SAVE_PC_MP_MAX_OFFSET, staleMpMax);

    // Assert the sealed record actually carries what was just planted,
    // before it is ever transplanted anywhere -- this is what proves the
    // fixture is carrying a coherent old-build save rather than an
    // internally inconsistent one (round 1 review, finding 1's own ask).
    assert.equal(nesA.cpu.mem[SRAM_BASE + SAVE_PC_LEVEL_OFFSET], 3, "ROM A's own sealed record does not carry the planted level");
    assert.equal(nesA.cpu.mem[SRAM_BASE + SAVE_PC_SPELLS_OFFSET], staleMask, "ROM A's own sealed record does not carry the planted mask");
    assert.equal(nesA.cpu.mem[SRAM_BASE + SAVE_PC_HP_MAX_OFFSET], staleHpMax, "ROM A's own sealed record does not carry the planted hp_max");
    assert.equal(nesA.cpu.mem[SRAM_BASE + SAVE_PC_MP_MAX_OFFSET], staleMpMax, "ROM A's own sealed record does not carry the planted mp_max");

    const foreignBattery = nesA.cpu.mem.slice(SRAM_BASE, SRAM_BASE + SRAM_SIZE);

    const nesB = boot(b.romPath);
    nesB.cpu.mem.set(foreignBattery, SRAM_BASE);
    tap(nesB, SELECT); // Continue
    assert.equal(
      nesB.cpu.mem[GAME_STATE],
      ST_GAMEPLAY,
      'ROM B should have accepted the transplanted save (identity-compatible) and resumed play'
    );

    assert.equal(
      nesB.cpu.mem[PC_SPELLS],
      expectedMask,
      "pc_spells was not recomputed against ROM B's own current catalog -- BE_RESTORE never ran, or read the wrong table"
    );
    assert.equal(nesB.cpu.mem[PC_HP_MAX], expectedHpMax, 'pc_hp_max was not recomputed from the restored level');
    assert.equal(nesB.cpu.mem[PC_MP_MAX], expectedMpMax, 'pc_mp_max was not recomputed from the restored level');
  }
);

// Wrong implementation this catches: BE_RESTORE's own loop bounded at
// MAX_PARTY instead of PARTY_SIZE -- directly, by its own writes to the two
// slots a correct implementation must never touch. sample-rpg's own party
// has 2 members (PARTY_SIZE = 2), so slots 2 and 3 are exactly such slots --
// never assigned a per-level table row at all, since pc_hp_at/pc_mp_at/
// pc_spells_at are each generated PARTY_SIZE * MAX_LEVEL rows wide, not
// MAX_PARTY * MAX_LEVEL.
test(
  "BE_RESTORE's loop stays within PARTY_SIZE -- it must never touch a slot past the project's real party",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { project, romPath } = await buildSaveableProject(t);
    assert.equal(project.party.length, 2, 'this fixture needs sample-rpg\'s own 2-member party, unmutated');

    // The real bytes a MAX_PARTY-bounded loop would fetch for slots 2 and 3
    // at level 1 -- the level party_init leaves every never-joined slot at,
    // and the level a fresh save (nothing here levels anyone up) therefore
    // carries for them too. Read off battleTables(project)'s own returned
    // text, not guessed.
    const { bytes, labelOffsets } = flattenBattleTableBytes(project);
    const outOfBounds = {};
    for (const [label, key] of [
      ['pc_hp_at', 'hpMax'],
      ['pc_mp_at', 'mpMax'],
      ['pc_spells_at', 'spells']
    ]) {
      outOfBounds[key] = [2, 3].map((member) => bytes[labelOffsets[label] + levelRow(project, member, 1)]);
    }

    // Chosen sentinels, and the precondition that makes them safe to use:
    // each must differ from the real out-of-bounds byte it will sit beside,
    // or a MAX_PARTY-bounded loop's own wrong write would coincidentally
    // reproduce the sentinel and this fixture would silently pass a wrong
    // implementation (design's own review round 2, finding 2).
    const SENTINEL_HP_MAX = 0xaa;
    const SENTINEL_MP_MAX = 0xbb;
    const SENTINEL_SPELLS = 0xcc;
    for (const value of outOfBounds.hpMax) {
      assert.notEqual(SENTINEL_HP_MAX, value, 'hp_max sentinel collides with the real generated byte -- pick another');
    }
    for (const value of outOfBounds.mpMax) {
      assert.notEqual(SENTINEL_MP_MAX, value, 'mp_max sentinel collides with the real generated byte -- pick another');
    }
    for (const value of outOfBounds.spells) {
      assert.notEqual(SENTINEL_SPELLS, value, 'spells sentinel collides with the real generated byte -- pick another');
    }

    const nes = boot(romPath);
    tap(nes, START);
    touchSaver(nes);
    assert.equal(nes.cpu.mem[SRAM_BASE + SAVE_MARKER_OFFSET], SAVE_MARKER_VALID, 'the real save never completed');

    for (const member of [2, 3]) {
      corruptAndReseal(nes, SAVE_PC_HP_MAX_OFFSET + member, SENTINEL_HP_MAX);
      corruptAndReseal(nes, SAVE_PC_MP_MAX_OFFSET + member, SENTINEL_MP_MAX);
      corruptAndReseal(nes, SAVE_PC_SPELLS_OFFSET + member, SENTINEL_SPELLS);
    }

    powerCycle(nes);
    tap(nes, SELECT); // Continue
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'Continue should have loaded the save and resumed play');

    for (const member of [2, 3]) {
      assert.equal(
        nes.cpu.mem[PC_HP_MAX + member],
        SENTINEL_HP_MAX,
        `slot ${member}'s pc_hp_max was overwritten -- BE_RESTORE's loop reached a slot past PARTY_SIZE`
      );
      assert.equal(
        nes.cpu.mem[PC_MP_MAX + member],
        SENTINEL_MP_MAX,
        `slot ${member}'s pc_mp_max was overwritten -- BE_RESTORE's loop reached a slot past PARTY_SIZE`
      );
      assert.equal(
        nes.cpu.mem[PC_SPELLS + member],
        SENTINEL_SPELLS,
        `slot ${member}'s pc_spells was overwritten -- BE_RESTORE's loop reached a slot past PARTY_SIZE`
      );
    }
  }
);
