// UNROM 512's flash save (engine/flash.asm, engine/save.asm's
// save_media_fetch/save_media_commit) -- the same feature save.test.js
// covers for battery, but with an asymmetry battery has no equivalent of:
// the record lives inside the ROM image itself (flash), which the vendored
// core's own write-through keeps in sync across an in-session reset
// (nes.reloadROM(), which reparses nes.romData -- see mapper30.js's own
// comment on writeThroughRomData) but which a genuinely fresh load can
// never see, because there is no disk-backed flash artifact in the
// built-in player (phase 2.1's own finding). Both halves are asserted
// below; either one failing silently would mean this feature works in the
// app and bricks a real cartridge, or the other way around.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// Engine RAM, from engine/constants.asm -- the same addresses save.test.js
// already hardcodes by hand rather than reading back out of the build under
// test (which would prove nothing).
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;

const ST_GAMEPLAY = 0;
const ST_TITLE = 3;

const SELECT = 2;
const START = 3;
const RIGHT = 7;
const LEFT = 6;
const DOWN = 5;
const UP = 4;

// The flash sector: bank 30 (shared/cartridge.js's flashSaveSectorBank for
// UNROM 512), offset $3000 within that bank's own 16 KB ($B000-$8000).
// SAVE_RECORD_LEN is sample-rpg's own real figure (80-byte body + 2-byte
// checksum + 4-byte identity + 1-byte marker), sourced by hand from a real
// build the same way save.test.js's own SAVE_BODY_LEN is -- see that
// file's comment on why reading it back out of the build under test would
// prove nothing.
const SAVE_BANK = 30;
const SECTOR_OFFSET = 0x3000;
const SAVE_RECORD_LEN = 87;
const SAVE_MARKER_OFFSET = SAVE_RECORD_LEN - 1;
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

/** The marker byte in the sector's *canonical* bank data -- readable regardless of which bank is currently mapped in. */
function sectorMarker(nes) {
  return nes.rom.rom[SAVE_BANK][SECTOR_OFFSET + SAVE_MARKER_OFFSET];
}

/** The whole 4 KB sector pipeline.js's checkFlashSectorBlank inspects at build time, read back the same way. */
function sectorBytes(nes) {
  return nes.rom.rom[SAVE_BANK].subarray(SECTOR_OFFSET, SECTOR_OFFSET + 0x1000);
}

// Plain movement toward a target, nothing else -- no early exit on
// game_state, which blips non-gameplay for a single frame while the event
// system dispatches a page and would race the multi-frame erase-then-
// program sequence a flash commit actually runs (engine/flash.asm), unlike
// save.test.js's own walkUntil, which only ever has a battery board's
// effectively-instant write to wait out. touchFlashSaver below has its own
// loop, stopping on the sector marker instead, for the same reason.
const walkTo = (nes, targetX, targetY, budget = 400) => {
  for (let i = 0; i < budget; i++) {
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

/**
 * sample-rpg on UNROM 512, with a title (Continue needs one) and a
 * touch-triggered NPC a few steps from the start whose event is `commands`
 * -- the same shape save.test.js's own buildSaveable builds for battery,
 * mapper swapped and no otherwise-unrelated deviation from it.
 */
async function buildFlashSaveable(t, commands) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flashsave-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 30; // UNROM 512
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
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return built.romPath;
}

/**
 * Walk toward the saver, pressing no further buttons once the sector marker
 * validates. The touch fires -- and the record is written -- while the
 * player is still short of (64,96) (touch range, not exact-tile overlap; see
 * the record's own x/y bytes), and nothing about a touch trigger blocks
 * further movement once its one-frame world-freeze ends. A walk that kept
 * pressing toward the exact target after that point would carry the player
 * those last few pixels onto (64,96) itself -- a real position, just not the
 * one the save actually recorded -- and every position assertion below
 * would then be comparing the wrong two numbers. Stopping on the marker
 * (not on game_state, which blips non-gameplay for one frame only and
 * would race the multi-frame erase-then-program sequence, see walkTo's own
 * comment) is what keeps "where the test looked" and "where the record
 * says" the same tile.
 */
function touchFlashSaver(nes) {
  for (let i = 0; i < 400; i++) {
    if (sectorMarker(nes) === SAVE_MARKER_VALID) break;
    const dx = 64 - nes.cpu.mem[PLAYER_X];
    const dy = 96 - nes.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) break;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'walking to the saver never validated the flash sector marker');
  for (let i = 0; i < 10; i++) nes.frame(); // let the step that touched it settle to a stop
}

test(
  'flash save, reset in session, Continue: the world is where it was',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildFlashSaveable(t, [{ op: 'save' }]);
    const nes = boot(romPath);
    tap(nes, START);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'never left the title');
    // Not just the marker byte -- pipeline.js's checkFlashSectorBlank
    // (test/unit/flashsector.test.js's own subject) inspects the whole 4 KB
    // region, and buildFlashSaveable above already went through that check
    // once during the build; this reads the real artifact back and asks
    // the same question independently, rather than only trusting that the
    // build did not throw.
    assert.ok(sectorBytes(nes).every((byte) => byte === 0xff), 'the flash sector should ship entirely blank');

    touchFlashSaver(nes);
    const savedX = nes.cpu.mem[PLAYER_X];
    const savedY = nes.cpu.mem[PLAYER_Y];
    const savedScreen = nes.cpu.mem[FLAT_SCREEN];
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the flash sector should validate right after the save');

    // Walk away, so the game-in-progress position would visibly differ from
    // both the saved spot and the fresh-game start spot -- proving Continue
    // restores the saved position specifically, not just any position.
    walkTo(nes, 176, 176);
    assert.notEqual(nes.cpu.mem[PLAYER_X], savedX, 'walking away should have moved the player');

    // An in-session reset: nes.reloadROM() reparses nes.romData, which the
    // flash write-through (mapper30.js's programFlashByte) already kept in
    // step with the save -- the emulator-equivalent of the console losing
    // power with the cartridge still seated (see this file's own header
    // comment for why this is not the same claim as surviving a fresh load).
    nes.reloadROM();
    for (let i = 0; i < 60; i++) nes.frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'an in-session reset should boot back to the title');

    tap(nes, SELECT); // Continue -- bound to SELECT by default in the title state
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'Continue should have loaded the save and resumed play');
    assert.equal(nes.cpu.mem[PLAYER_X], savedX, "Continue should restore the player's saved x");
    assert.equal(nes.cpu.mem[PLAYER_Y], savedY, "Continue should restore the player's saved y");
    assert.equal(nes.cpu.mem[FLAT_SCREEN], savedScreen, 'Continue should restore the saved screen');
  }
);

test(
  'a genuinely fresh load never sees a flash save the built-in player made',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildFlashSaveable(t, [{ op: 'save' }]);
    const originalBytes = fs.readFileSync(romPath); // read once, before anything saves to it

    const nes = boot(romPath);
    tap(nes, START);
    touchFlashSaver(nes);
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'sanity: the save should have committed');

    // Not the same NES instance reloaded -- a brand new one, loaded from the
    // *original* file bytes read before the save happened. There is no
    // disk-backed flash artifact in the built-in player (phase 2.1), so this
    // is what "close the app and reopen the project" actually looks like.
    const fresh = new NES({ onFrame: () => {}, emulateSound: false });
    fresh.loadROM(new Uint8Array(originalBytes));
    for (let i = 0; i < 60; i++) fresh.frame();
    assert.equal(fresh.cpu.mem[GAME_STATE], ST_TITLE, 'a fresh load should boot to the title');
    assert.equal(sectorMarker(fresh), 0xff, 'a fresh load must not see the other instance\'s save at all');

    tap(fresh, SELECT); // Continue, on a cartridge that (from this instance's view) was never saved to
    assert.equal(fresh.cpu.mem[GAME_STATE], ST_TITLE, 'Continue over a blank sector should do nothing');
  }
);
