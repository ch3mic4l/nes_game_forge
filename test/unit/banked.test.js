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
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
import { createProject, createMap } from '../../shared/project.js';
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
// PRG bank the code region already claims on most boards — so
// switch_prg_bank(BATTLE_BANK) and switch_prg_bank(screen_bank[flat_screen])
// would select the very same bank on the unmodified sample there, and
// mtptr's target bytes would read correctly whether or not the trampoline
// restores anything, because nothing ever moved. Padding the map with enough
// blank screens to push Iris's own past that shared bank is one way to make
// a missing restore visible, and an earlier version of this test did that —
// but "enough" screens to cross a PRG bank (~26, from the fixed 8 KB a
// region holds) got more expensive than the kernel-lo table budget could
// spare for a padding project the moment save/load grew that budget's other
// side, which made the two requirements mutually exclusive on any board
// where the code region and the first screen region share a PRG bank.
//
// UNROM 512 does not share one: it is the CHR-RAM board, so codeRegions()
// (shared/cartridge.js) is sliced *after* chrPayloadRegions() takes the
// first region for the tileset payload, landing the code region and the
// first screen region on two different 16 KB banks by construction — no
// padding, no screen-count arithmetic to keep in step with the kernel
// growing, and a board this codebase already builds RPGs on regardless.
test(
  'a Join command mid-script also restores the screen bank, with no redraw to hide it',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-bank-join-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE_RPG);
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.cartridge.mapper = 30; // UNROM 512 -- see the comment above
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

// --- the call_battle interrupt race -----------------------------------------
//
// switch_prg_bank's MMC3 register-select/value pairs (engine/banks.asm) are
// not under forced blank the way switch_chr_bank always is: call_battle
// reaches it with rendering on and the scanline split live, every tick of a
// battle. An interrupt landing between a select and its value sends the
// value to whichever register that interrupt itself last selected -- the
// scanline IRQ and NMI's split_arm (engine/split.asm) both only ever select
// R1 -- so the PRG bank silently never switches and battle_entry runs with
// whatever the switchable window still holds. php/sei mask the IRQ for the
// pair; split_lock is what stands in for masking NMI, which sei cannot do.
// This forces both interrupt sources into that exact gap, on a real build,
// and proves the bank still ends up correct.
//
// Making that observable takes more than sample-rpg as-is: its one screen
// and the banked code region both land in the *same* physical 16 KB PRG
// bank by construction (screenRegions() starts handing out regions right
// where codeRegions() left off, and up to 26 small screens pack into one
// region before a second is needed -- see shared/cartridge.js), so
// switch_prg_bank(BATTLE_BANK) and switch_prg_bank(screen_bank[flat_screen])
// select the same bank there and a corrupted register would go unnoticed --
// the exact trap banked.test.js's own Join test above already had to build
// around. Twenty-seven blank screens of padding, spent before the real map,
// push it into a second bank so the two calls disagree and a broken
// register select becomes visible in the bytes at $8000, not just in
// whether gameplay happens to still look right.
function paddingMap(id) {
  const map = createMap(id, `Padding ${id}`);
  const metatileCount = map.screens[0].metatiles.length;
  map.gridW = 4;
  map.gridH = 4;
  map.screens = Array.from({ length: 16 }, () => ({
    name: '',
    metatiles: new Array(metatileCount).fill(0),
    entities: []
  }));
  map.encounters = { rate: 0, actorIds: [] };
  return map;
}

test(
  "an interrupt forced between switch_prg_bank's select and value still lands on the right register",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const kind of ['irq', 'nmi']) {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `forge-bank-race-${kind}-`));
      t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
      const project = await loadProject(SAMPLE_RPG);
      project.cartridge.mapper = 4; // MMC3 -- the only board with this race
      // The real map, encounters and dialogue (for SPLIT_ENABLED) untouched --
      // just moved past two full 16-screen padding maps so its own screen
      // lands in a different PRG bank than the code region. See the comment
      // above paddingMap.
      const realMap = project.maps[0];
      project.maps = [paddingMap(1), paddingMap(2), realMap];
      project.project.startMap = 2;
      project.project.startScreen = 0;
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });

      const configInc = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
      assert.match(
        configInc,
        /SPLIT_ENABLED = 1/,
        'sample-rpg must show text for the split machinery (and this race) to be live on MMC3'
      );
      const battleBank = Number(configInc.match(/BATTLE_BANK\s*=\s*(\d+)/)?.[1]);
      assert.ok(Number.isInteger(battleBank), 'BATTLE_BANK not found in config.inc');

      const mapsInc = await fs.promises.readFile(path.join(dir, 'build/assets/maps.inc'), 'utf8');
      const screenBank = parseDbBlock(mapsInc, 'screen_bank');
      assert.notEqual(
        screenBank[32],
        battleBank,
        'the padding no longer separates the real map from the code region -- this test cannot see a broken ' +
          'register select until it does again'
      );

      // Addresses from engine/constants.asm.
      const PLAYER_X = 0x10;
      const PLAYER_Y = 0x11;
      const GAME_STATE = 0x25;
      const BT_PHASE = 0x53;
      const ST_TITLE = 3;
      const ST_BATTLE = 5;
      const BP_MENU = 1;

      const emulator = new Emulator({ onFrame: () => {} });
      emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
      const nes = emulator.nes;
      const frame = () => nes.frame();

      for (let i = 0; i < 30; i++) frame();
      if (nes.cpu.mem[GAME_STATE] === ST_TITLE) {
        emulator.setButton(BUTTON.START, true);
        frame();
        emulator.setButton(BUTTON.START, false);
        for (let i = 0; i < 12; i++) frame();
      }

      // March toward a wandering monster, the same walk split.test.js's own
      // battle test does, stopping the instant battle_begin flips
      // game_state. call_battle(BE_TICK) does not run this same frame --
      // main_loop's own game_state check (boot.asm) happens before the world
      // update that can set it -- so the frame boundary here is clean and
      // the vulnerable switch_prg_bank call is still one frame ahead.
      for (let step = 0; step < 900 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; step++) {
        const buttons = [];
        if (nes.cpu.mem[PLAYER_X] < 168) buttons.push(BUTTON.RIGHT);
        if (nes.cpu.mem[PLAYER_Y] < 168) buttons.push(BUTTON.DOWN);
        if (!buttons.length) buttons.push(step & 16 ? BUTTON.RIGHT : BUTTON.DOWN);
        for (const button of buttons) emulator.setButton(button, true);
        frame();
        for (const button of buttons) emulator.setButton(button, false);
      }
      assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, `${kind}: no encounter after nine hundred steps`);

      // Single-step the next frame, instruction by instruction, with a
      // write-watch on $8000. The first write of value 6 there this frame is
      // guaranteed to be switch_prg_bank(BATTLE_BANK)'s own register-6
      // select -- 6 is a literal register number, not a bank, so nothing
      // else in this engine ever writes it there. The instant it lands,
      // force the interrupt: this is the exact gap between the select and
      // its value the bug report describes.
      emulator.writeWatch.add(0x8000);
      let injected = false;
      let frameEnded = false;
      while (!frameEnded) {
        frameEnded = emulator.stepInstruction();
        if (!injected) {
          const hit = emulator.checkBreak();
          if (hit && hit.kind === 'write' && hit.address === 0x8000 && hit.value === 6) {
            injected = true;
            if (kind === 'irq') emulator.nes.cpu.requestIrq(emulator.nes.cpu.IRQ_NORMAL);
            else emulator.nes.cpu.nmiImmediate = true; // fires at the very next instruction
          }
        }
      }
      emulator.writeWatch.delete(0x8000);
      assert.ok(injected, `${kind}: never caught switch_prg_bank's register-6 select -- the walk never reached a battle`);

      // The direct check: $8000-$9FFF (register 6's half) must now hold the
      // battle bank's own bytes, not whatever the field's screen bank left
      // there. This is what a corrupted register select gets wrong -- gameplay
      // can still coincidentally look fine even when it is (see the comment
      // above paddingMap), but the bytes cannot.
      const expected = nes.rom.rom[battleBank].subarray(0, 256);
      const actual = nes.cpu.mem.subarray(0x8000, 0x8000 + 256);
      assert.deepEqual(
        [...actual],
        [...expected],
        `${kind}: $8000-$81FF does not hold the battle bank -- switch_prg_bank's register-6 write landed ` +
          'somewhere else'
      );

      // And the game itself is still in one piece: the battle menu comes up
      // rather than the emulator crashing into whatever the wrong bank held.
      let ok = false;
      for (let i = 0; i < 900 && !ok; i++) {
        frame();
        ok = nes.cpu.mem[BT_PHASE] === BP_MENU;
      }
      assert.ok(ok, `${kind}: the battle menu never came up`);
    }
  }
);
