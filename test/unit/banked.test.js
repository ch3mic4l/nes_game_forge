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
import NES from '../../renderer/emulator/core/nes.js';
import { createProject } from '../../shared/project.js';
import {
  SCREEN_REGION_BYTES,
  chrPayloadRegions,
  codeRegions,
  mapperById,
  prgLayout,
  screenCapacity,
  screenRegions
} from '../../shared/cartridge.js';
import { generateAssets, codeRegionCount } from '../../main/build/generate.js';
import { buildProject } from '../../main/build/pipeline.js';
import { saveProject } from '../../main/project-io.js';

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
