// The banked code region: the first cross-bank call this engine has ever made.
//
// The dangerous half is not getting *into* the bank — it is getting back out.
// `player.asm` dereferences `mtptr` out of the switchable window every single
// frame, so a trampoline that forgets to put the screen bank back leaves the
// game reading its map out of the battle system's code. That is what the ROM
// test at the bottom is for.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { createProject, createMap, createScreen } from '../../shared/project.js';
import {
  SCREEN_REGION_BYTES,
  chrPayloadRegions,
  codeRegions,
  mapperById,
  prgLayout,
  screenCapacity,
  screenRegions
} from '../../shared/cartridge.js';
import { generateAssets, codeRegionCount, flattenScreens } from '../../main/build/generate.js';
import { buildProject } from '../../main/build/pipeline.js';
import { loadProject, saveProject } from '../../main/project-io.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
// This test reads sample-rpg's checked-in project.json through loadProject
// and builds its own ROM from scratch — it never touches
// sample-rpg/build/game.nes, so gating it on that build artifact (the way
// tests that actually read the built ROM do) would skip it on a clean
// checkout with nesasm installed, exactly the tree a broken trampoline is
// most likely to first reach unexercised. nesasm itself is the only real
// dependency, the same reason kernelbytes.test.js gates on it instead.
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

/** One generated `.db $xx,$xx,…` table, read back out of a `.inc` file by label. */
function parseDbBlock(text, label) {
  const marker = `${label}:\n`;
  const start = text.indexOf(marker);
  assert.ok(start !== -1, `${label} not found in generated output`);
  const values = [];
  for (const line of text.slice(start + marker.length).split('\n')) {
    if (!line.startsWith('  .db')) break;
    for (const token of line.slice(5).split(',')) values.push(parseInt(token.trim().slice(1), 16));
  }
  return values;
}

const MMC1 = mapperById(1);
const UNROM512 = mapperById(30);
const NROM = mapperById(0);

// --- region arithmetic ------------------------------------------------------

test('a reserved code region comes out of the screens, not out of thin air', () => {
  for (const mapper of [NROM, MMC1, UNROM512]) {
    const plain = screenRegions(mapper, 1, 0);
    const reserved = screenRegions(mapper, 1, 1);
    assert.equal(reserved.length, plain.length - 1, `${mapper.name} did not give up a region`);
    // ...and the region it gave up is the one the code got.
    const code = codeRegions(mapper, 1, 1);
    assert.equal(code.length, 1);
    assert.deepEqual(code[0], plain[0], `${mapper.name} handed out a region that was not the first free one`);
  }
});

test('the code region sits after the CHR-RAM payloads, not on top of them', () => {
  // UNROM 512 keeps its tilesets in program space, so this is the board where
  // two claims on the same window have to be kept apart.
  const payloads = chrPayloadRegions(UNROM512, 3);
  const code = codeRegions(UNROM512, 3, 1);
  assert.equal(payloads.length, 3);
  const used = new Set([...payloads, ...code].map((region) => region.nesasmBank));
  assert.equal(used.size, 4, 'a payload region and the code region overlap');
  for (const region of screenRegions(UNROM512, 3, 1)) {
    assert.ok(!used.has(region.nesasmBank), `screen region ${region.nesasmBank} is already spoken for`);
  }
});

test('the quoted screen capacity drops by exactly one region', () => {
  const perRegion = Math.floor(SCREEN_REGION_BYTES / 305);
  assert.equal(
    screenCapacity(MMC1, 305, 1, 1),
    screenCapacity(MMC1, 305, 1, 0) - perRegion,
    'reserving a bank should cost the screens that fit in it, and no more'
  );
});

test('only an RPG spends a region on code', () => {
  assert.equal(codeRegionCount(createProject('Action')), 0);
  assert.equal(codeRegionCount(createProject('Quest', 'rpg')), 1);
});

test('an action project emits no code bank and no trampoline', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-nocode-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await generateAssets({ dir, project: createProject('Action') });
  const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
  assert.match(config, /BATTLE_ENABLED = 0/);
  const code = await fs.promises.readFile(path.join(dir, 'build/assets/code.inc'), 'utf8');
  assert.doesNotMatch(code, /\.bank/, 'a region was reserved for a game that has no battles');
});

// --- the trampoline, in a real ROM ------------------------------------------

test('the trampoline reaches the banked code and puts the screen bank back', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-bank-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('Quest', 'rpg');
  assert.equal(project.cartridge.mapper, 1, 'an RPG should default to a mapper that can switch PRG');
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const code = await fs.promises.readFile(path.join(dir, 'build/assets/code.inc'), 'utf8');
  assert.match(code, /\.include "battle\.asm"/);
  assert.match(code, /\.org \$8000/, 'the battle bank must be assembled at the window base');

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 30; i++) nes.frame();

  // `init_session` calls into the bank to build the party out of tables that
  // only exist over there, so a party with hit points is proof the trampoline
  // went in and came back. Addresses from engine/constants.asm.
  const PC_HP = 0x398;
  const PC_HP_MAX = 0x39c;
  const PARTY_SIZE = 0x65;
  assert.equal(nes.cpu.mem[PARTY_SIZE], 1, 'the banked party setup never ran');
  assert.ok(nes.cpu.mem[PC_HP] > 0, 'the first member has no hit points');
  assert.equal(nes.cpu.mem[PC_HP], nes.cpu.mem[PC_HP_MAX], 'a new party should start full');

  // And the screen pointer is back where the world expects it, which is the
  // half that fails silently: `player.asm` reads the map through it every frame,
  // so a trampoline that forgot to restore the bank would have the player
  // walking through the battle system's code as if it were a map.
  const mtptr = [nes.cpu.mem[0x02], nes.cpu.mem[0x03]];
  const y = nes.cpu.mem[0x11];
  nes.buttonDown(1, 5);
  for (let i = 0; i < 30; i++) nes.frame();
  nes.buttonUp(1, 5);
  assert.notEqual(nes.cpu.mem[0x11], y, 'the player never moved, so the map is being read from the wrong bank');
  assert.deepEqual([nes.cpu.mem[0x02], nes.cpu.mem[0x03]], mtptr, 'the screen pointer moved on its own');
});

// A second door into the trampoline, entirely apart from BE_INIT, and the one
// CLAUDE.md names as the sharpest test of the restore: the Join command
// (engine/script.asm's script_op_join) calls call_battle(BE_JOIN) *mid-field*,
// with no redraw of any kind following it — the script goes straight on to
// its next command over the same map, same screen, same frame. That absence
// is what makes this the meaningful case: a battle's own return to the field
// calls redraw_screen regardless, which sets the screen pointer on its own
// account and would mask a broken call_battle behind a correct redraw_screen.
// Join has no such cover. The sample already has the event: Iris recruits
// herself with Say, then Join, then a switch.
//
// The sample is one screen, though, and one screen fits inside the same 16 KB
// PRG bank the code region already claims — so switch_prg_bank(BATTLE_BANK)
// and switch_prg_bank(screen_bank[flat_screen]) select the very same bank on
// the unmodified sample, and mtptr's target bytes read correctly whether or
// not the trampoline restores anything, because nothing ever moved. Enough
// padding screens ahead of Iris's own map push it into a *different* PRG
// bank than BATTLE_BANK, so a missing restore is something this test can
// actually see: the bytes at mtptr's address, read straight through the
// mapper (nes.mmap.load, not nes.cpu.mem — reads at $8000+ are cartridge
// reads, not the flat RAM array), rather than mtptr's own value, which a
// broken restore never touches either way.
test(
  'a Join command mid-script also restores the screen bank, with no redraw to hide it',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-bank-join-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE_RPG);
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // Push Iris's map into a PRG bank the code region does not occupy — see
    // the comment above. ~26 screens fill one region on this mapper; three
    // full 4x4 maps (48) comfortably clears the one region left in the code
    // region's own 16 KB bank.
    for (let n = 0; n < 3; n++) {
      const padding = createMap(90 + n, `Padding ${n}`);
      padding.gridW = 4;
      padding.gridH = 4;
      padding.screens = Array.from({ length: 16 }, () => createScreen());
      padding.tilesetId = project.maps[0].tilesetId;
      project.maps.unshift(padding);
    }
    project.project.startMap = project.maps.length - 1; // still boot into Iris's map
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });

    // The padding above only makes this test mean anything if it actually
    // landed Iris's map in a different PRG bank than the trampoline's own —
    // otherwise switch_prg_bank(BATTLE_BANK) and switch_prg_bank(screen_bank[
    // flat_screen]) select the same bank, nothing about the restore is
    // exercised, and every assertion below would still pass a build with the
    // trampoline broken. Read the numbers straight out of what the generator
    // actually wrote, rather than recomputing the packing by hand here, so a
    // future change to that packing fails this assertion loudly instead of
    // quietly making the rest of the test vacuous the way the un-padded
    // sample once did.
    const configInc = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
    const battleBank = Number(configInc.match(/BATTLE_BANK\s*=\s*(\d+)/)?.[1]);
    assert.ok(Number.isInteger(battleBank), 'BATTLE_BANK not found in config.inc');
    const mapsInc = await fs.promises.readFile(path.join(dir, 'build/assets/maps.inc'), 'utf8');
    const screenBank = parseDbBlock(mapsInc, 'screen_bank');
    const { mapBase } = flattenScreens(project);
    const startFlatScreen = mapBase[project.project.startMap] + project.project.startScreen;
    assert.notEqual(
      screenBank[startFlatScreen],
      battleBank,
      "the padding no longer separates Iris's map from the code region -- this test cannot see a broken " +
        'trampoline until it does again'
    );

    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    for (let i = 0; i < 40; i++) nes.frame();

    // Addresses from engine/constants.asm.
    const PLAYER_X = 0x10;
    const PLAYER_Y = 0x11;
    const GAME_STATE = 0x25;
    const PARTY_SIZE = 0x65;
    const ST_GAMEPLAY = 0;
    const LEFT = 6;
    const RIGHT = 7;
    const DOWN = 5;
    const UP = 4;
    const A = 0;
    const B = 1;

    const walkTo = (targetX, targetY, budget = 600) => {
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

    // Iris stands at (208,32); the same spot the RPG test suite's own Join
    // test walks to.
    walkTo(208, 48);
    assert.equal(nes.cpu.mem[PARTY_SIZE], 1, 'Iris should not already be recruited');

    // mtptr's own value never changes here — nothing writes a new one unless
    // set_screen_ptr runs, and flat_screen has not changed either way — so
    // the read that actually exercises the restore is the sixteen bytes it
    // points at, fetched through the mapper the way the CPU itself would.
    const mtptrAddr = () => nes.cpu.mem[0x02] | (nes.cpu.mem[0x03] << 8);
    const screenBytes = () => Array.from({ length: 16 }, (_, i) => nes.mmap.load(mtptrAddr() + i));
    const before = screenBytes();

    // Talk, wait for the (multi-frame-typed) message to finish so an A press
    // actually dismisses it rather than landing mid-type, then poll for
    // Join's own effect — not for game_state to return to ST_GAMEPLAY, which
    // waits for the box's own multi-frame closing animation on top of that
    // and would leave room for something else to have fixed a broken pointer
    // by then. party_size becoming 2 is Join having actually run, on the
    // very frame it ran.
    const BOX_STATE = 0x40;
    const BOX_PAGEWAIT = 3;
    const BOX_ENDWAIT = 6;
    nes.buttonDown(1, B);
    nes.frame();
    nes.buttonUp(1, B);
    for (let i = 0; i < 600; i++) {
      const box = nes.cpu.mem[BOX_STATE];
      if (box === BOX_PAGEWAIT || box === BOX_ENDWAIT) break;
      nes.frame();
    }
    assert.equal(nes.cpu.mem[PARTY_SIZE], 1, 'talking should not have recruited Iris before the message is dismissed');
    nes.buttonDown(1, A);
    nes.frame();
    nes.buttonUp(1, A);
    for (let i = 0; i < 60 && nes.cpu.mem[PARTY_SIZE] === 1; i++) nes.frame();
    assert.equal(nes.cpu.mem[PARTY_SIZE], 2, 'Join never ran');

    // The bytes at mtptr's address, checked the instant Join's own effect is
    // visible — not after the box has finished closing, which is several
    // frames later and would be true even if call_battle(BE_JOIN) forgot the
    // restore, since nothing else in this sequence ever touches the PRG bank
    // either way.
    assert.deepEqual(screenBytes(), before, 'the bank never came back, so mtptr is reading the battle system now');

    // And once the box has finished closing, the field is actually playable:
    // the player can still walk, which player.asm does by dereferencing
    // mtptr fresh every frame.
    for (let i = 0; i < 90 && nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY; i++) nes.frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the conversation never ended');
    const x = nes.cpu.mem[PLAYER_X];
    walkTo(x - 16, nes.cpu.mem[PLAYER_Y], 30);
    assert.notEqual(nes.cpu.mem[PLAYER_X], x, 'the player cannot move after the Join');
  }
);
