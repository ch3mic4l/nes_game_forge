// Phase 3b slice S0: a streamed battle draws (and wipes a dead monster to) the backdrop of the map
// that OWNS the screen, not whatever byte screen_map[flat_screen] happens to land on.
//
// screen_map holds only the compact ORDINARY rows (main/build/generate.js, ordinaryFlat), so on a
// streamed screen flat_screen indexes past its end, and in a mixed project an ordinary map placed
// after a streamed one has flat_screen != its compact row. Both draw_battle_screen
// (engine/battle.asm) and wipe_monster (engine/battleturn.asm) now read cur_map under
// STREAMING_ENABLED, the owner apply_map_music / apply_map_music_direct set at every landing.
//
// A return-only test cannot see this -- the fight ends the same with the wrong backdrop -- so
// every assertion here reads the actual nametable bytes. Each map gets its own DISTINCT sky and
// ground tile, so a read of any other map's row, or of sky for ground, fails by value.
//
// Wrong implementations each scenario catches (the sabotage runs are in
// handoff-next/phase3b-s0-backdrop-report.md):
//   Before  (flat == compact row) -- sky/ground swapped; wipe filling with sky; a fix that breaks the
//           plain ordinary case while repairing the others.
//   Streamed (no screen_map row)  -- screen_map[flat_screen] (the shipped defect); screen_map[ord_screen]
//           (stale compact row); a draw fixed without its wipe, or a wipe without its draw.
//   After   (flat != compact row) -- screen_map[flat_screen] again, which reads a streamed-prefix-shifted
//           row; any lookup keyed on flat_screen alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import NES from '../../renderer/emulator/core/nes.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// ---- from engine/constants.asm ----
const GAME_STATE = 0x25;
const FLAT_SCREEN = 0x16;
const MAP_IS_STREAMED = 0xfe;
const BT_SEL = 0x55;
const ST_GAMEPLAY = 0;
const ST_BATTLE = 5;
const BT_SKY_ROWS = 4;
const BT_BOX_ROW = 20;
const BT_MON_ROW = 4;
const BT_MON_COL = 4;
const A_BTN = 0;
const DOWN = 5;
const BC_FIGHT = 0;

const BACKDROPS = {
  before: { sky: 0x41, ground: 0x42 },
  streamed: { sky: 0x51, ground: 0x52 },
  after: { sky: 0x61, ground: 0x62 }
};

const tap = (nes, button, frames = 14) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

function nametable(nes) {
  return nes.ppu.vramMem.subarray(0x2000, 0x2400);
}
const cell = (nt, row, col) => nt[row * 32 + col];

/** Mixed RPG: Before (2x2) -> Streamed (3x2) -> After (2x2), one fightable Slime, every map with
 *  its own distinct backdrop and a rate-1 wandering encounter so a single step starts a fight. */
function mixedProject(startMap) {
  const project = createStreamedProject({ gameType: 'rpg', mixed: true });
  project.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0, battleTile: 1, battleW: 4, battleH: 4 } };
  // Block art (tiles 1-4, 17-20, 33-36, 49-52 of the battle tileset): a monster with none is drawn as
  // sprites, leaving the wipe nothing visible to repaint.
  const [before, streamed, after] = project.maps;
  assert.equal(before.streamed === true, false);
  assert.equal(streamed.streamed, true);
  assert.equal(after.streamed === true, false);
  for (const [map, key] of [[before, 'before'], [streamed, 'streamed'], [after, 'after']]) {
    map.battleSkyTile = BACKDROPS[key].sky;
    map.battleGroundTile = BACKDROPS[key].ground;
    map.encounters = { rate: 1, actorIds: [0] };
  }
  const firstScreen = { before: 0, streamed: before.screens.length, after: before.screens.length + streamed.gridW * streamed.gridH };
  // A streamed screen in the middle of its grid, so nothing about it is "screen 0".
  project.project.startScreen = startMap === 'streamed' ? firstScreen.streamed + 4 : firstScreen[startMap];
  return project;
}

async function bootInto(startMap) {
  const project = mixedProject(startMap);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamedbackdrop-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    const mem = nes.cpu.mem;
    let frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || (startMap === 'streamed' && mem[MAP_IS_STREAMED] !== 1)) && frames < 300) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 300, 'cold boot must reach gameplay');
    for (let i = 0; i < 100; i++) nes.frame();
    assert.equal(mem[MAP_IS_STREAMED], startMap === 'streamed' ? 1 : 0, 'the start screen must be on the intended kind of map');
    return { nes, mem };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Walk down until the rate-1 encounter starts, then let the intro draw settle. */
function enterBattle(nes, mem) {
  for (let step = 0; step < 60 && mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    nes.buttonDown(1, DOWN);
    nes.frame();
    nes.buttonUp(1, DOWN);
  }
  for (let i = 0; i < 30 && mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_BATTLE, 'the wandering encounter never started a fight');
  for (let i = 0; i < 20; i++) nes.frame();
}

function assertBackdrop(nt, { sky, ground }, label) {
  for (let row = 0; row < BT_SKY_ROWS; row++) {
    for (let col = 0; col < 32; col++) {
      assert.equal(cell(nt, row, col), sky, `${label}: sky row ${row} col ${col} must be this map's sky tile`);
    }
  }
  // Below the monsters (one slime fills BT_MON_ROW..+3) and above the message box.
  for (let row = BT_MON_ROW + 4; row < BT_BOX_ROW; row++) {
    for (let col = 0; col < 32; col++) {
      assert.equal(cell(nt, row, col), ground, `${label}: ground row ${row} col ${col} must be this map's ground tile`);
    }
  }
}

function monsterCells(nt) {
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) cells.push(cell(nt, BT_MON_ROW + r, BT_MON_COL + c));
  return cells;
}

for (const startMap of ['before', 'streamed', 'after']) {
  test(
    `battle on the ${startMap} map draws that map's own backdrop, wipes the dead monster to its ground, and returns`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const want = BACKDROPS[startMap];
      const { nes, mem } = await bootInto(startMap);
      enterBattle(nes, mem);
      const flat = mem[FLAT_SCREEN];

      // Draw: the actual nametable, not the chosen index.
      assertBackdrop(nametable(nes), want, `${startMap} draw`);
      const drawn = monsterCells(nametable(nes));
      assert.ok(drawn.some((tile) => tile !== want.ground), 'precondition: the monster must be on screen before the wipe, or the wipe assertion proves nothing');

      // Kill it: one physical Attack ends a 1-HP slime, and the wipe repaints its 4x8 cells with the
      // map's ground tile. Poll every frame -- the wipe is four queued rows, then the victory text.
      chooseFight(nes);
      let wiped = false;
      for (let press = 0; press < 40 && mem[GAME_STATE] === ST_BATTLE && !wiped; press++) {
        nes.buttonDown(1, A_BTN);
        nes.frame();
        nes.buttonUp(1, A_BTN);
        for (let i = 0; i < 12 && !wiped; i++) {
          nes.frame();
          wiped = monsterCells(nametable(nes)).every((tile) => tile === want.ground);
        }
      }
      assert.ok(wiped, `${startMap}: the dead monster's cells must be wiped to this map's ground tile ${want.ground}`);
      assert.equal(mem[GAME_STATE], ST_BATTLE, 'the wipe must be observed inside the battle, not after it');

      // Return: finish the fight and land back on the same screen.
      for (let round = 0; round < 80 && mem[GAME_STATE] === ST_BATTLE; round++) tap(nes, A_BTN, 12);
      assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the battle never ended');
      for (let i = 0; i < 40; i++) nes.frame();
      assert.equal(mem[MAP_IS_STREAMED], startMap === 'streamed' ? 1 : 0);
      assert.equal(mem[FLAT_SCREEN], flat, 'the fight must end on the screen it began on');
    }
  );
}

function chooseFight(nes) {
  for (let i = 0; i < 8 && nes.cpu.mem[BT_SEL] !== BC_FIGHT; i++) tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[BT_SEL], BC_FIGHT, 'the battle menu never reached Fight');
  tap(nes, A_BTN, 6);
}

// ---- one session: the owner is the LIVE cur_map, not the start map's -------------------------------
//
// The three tests above cold-boot ON each battle map, so an implementation reading a constant -- the
// start map's owner, the first landing's, a cached copy -- passes all of them. Here one ROM boots on
// Before and is then moved IN-SESSION by the warp queue (warp_scr/warp_x/warp_y/warp_ready, the state a
// Warp command's door leaves for main_loop's take_door): onto a streamed screen, onto the ordinary map
// after it, then onto a different streamed screen. Each landing runs a scripted Battle command (an
// enter-triggered event) and the monster is killed by a SPELL, so the wipe is reached through
// cast/spell_damage rather than only the physical attack. Each time: the nametable sky/ground, the
// wipe fill, and the return. Wrong implementations caught: a start-map (Before) owner -> fails the first
// landing; the first landing's owner kept -> fails the second; screen_map[flat_screen] -> fails streamed
// and After; a wipe fixed only for the physical path is still the same wipe_monster, so a spell-path
// wipe that used another table would fail by value here.
const CUR_MAP = 0x8a; // engine/constants.asm: cur_map = bt_owner_rec+1
const WARP_READY = 0x2e;
const WARP_SCR = 0x2f;
const WARP_X = 0x30;
const WARP_Y = 0x31;
const BC_MAGIC = 1;
const PC_MP = 0x3a0; // engine/constants.asm: pc_mp

function sessionProject() {
  const project = mixedProject('before');
  const [before, streamed, after] = project.maps;
  for (const map of project.maps) map.encounters = { rate: 0, actorIds: [] }; // only scripted fights here
  // One damaging spell that kills the 1-HP slime outright; the hero knows it from level 1.
  project.spells = [{ id: 0, name: 'Bolt', mpCost: 1, kind: 'damage', amountMin: 50, amountMax: 50, element: 'none', scope: 'one' }];
  project.party[0].spells = [{ spellId: 0, level: 1 }];
  const trigger = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'Trigger', behavior: 'npc', hp: 1, damage: 0 });
  const fight = () => ({
    actorId: trigger,
    x: 16,
    y: 16,
    props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'battle', monsters: [0] }] }] } }
  });
  const streamedFirst = before.screens.length;
  const afterFirst = streamedFirst + streamed.gridW * streamed.gridH;
  streamed.screens[4].entities = [fight()];
  streamed.screens[1].entities = [fight()];
  after.screens[0].entities = [fight()];
  return { project, landings: [
    { key: 'streamed', flat: streamedFirst + 4, map: 1, streamed: 1 },
    { key: 'after', flat: afterFirst, map: 2, streamed: 0 },
    { key: 'streamed', flat: streamedFirst + 1, map: 1, streamed: 1 }
  ] };
}

test(
  'one session: warping Before -> streamed -> After -> streamed, each scripted battle draws and spell-wipes to the map it is on NOW',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const { project, landings } = sessionProject();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamedbackdrop-session-'));
    let nes;
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const mem = nes.cpu.mem;
    for (let i = 0; i < 300 && mem[GAME_STATE] !== ST_GAMEPLAY; i++) nes.frame();
    for (let i = 0; i < 100; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'cold boot must reach gameplay');
    assert.equal(mem[CUR_MAP], 0, 'the session starts on Before (map 0)');
    assert.equal(mem[MAP_IS_STREAMED], 0);

    let step = 0;
    for (const landing of landings) {
      step++;
      const label = `landing ${step} (${landing.key}, screen ${landing.flat})`;
      const want = BACKDROPS[landing.key];
      mem[WARP_SCR] = landing.flat;
      mem[WARP_X] = 128;
      mem[WARP_Y] = 128;
      mem[WARP_READY] = 1;
      for (let i = 0; i < 90 && mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
      assert.equal(mem[GAME_STATE], ST_BATTLE, `${label}: the enter-triggered Battle command never started a fight`);
      assert.equal(mem[FLAT_SCREEN], landing.flat, `${label}: landed on the warp target`);
      assert.equal(mem[CUR_MAP], landing.map, `${label}: the landing published its owning map`);
      assert.equal(mem[MAP_IS_STREAMED], landing.streamed);
      for (let i = 0; i < 20; i++) nes.frame();

      assertBackdrop(nametable(nes), want, `${label} draw`);
      assert.ok(monsterCells(nametable(nes)).some((tile) => tile !== want.ground), `${label}: the monster must be drawn before the wipe`);

      // Magic -> the first (only) spell -> the only target; kills the slime, then watch the wipe.
      for (let i = 0; i < 8 && mem[BT_SEL] !== BC_MAGIC; i++) tap(nes, DOWN, 4);
      assert.equal(mem[BT_SEL], BC_MAGIC, `${label}: the battle menu never reached Magic`);
      const mpBefore = mem[PC_MP];
      tap(nes, A_BTN, 6);
      tap(nes, A_BTN, 6);
      assert.equal(mpBefore - mem[PC_MP], 1, `${label}: the kill must be the spell (Bolt costs 1 MP), not a physical attack`);
      let wiped = false;
      for (let press = 0; press < 40 && mem[GAME_STATE] === ST_BATTLE && !wiped; press++) {
        for (let i = 0; i < 12 && !wiped; i++) {
          nes.frame();
          wiped = monsterCells(nametable(nes)).every((tile) => tile === want.ground);
        }
        if (!wiped) {
          nes.buttonDown(1, A_BTN);
          nes.frame();
          nes.buttonUp(1, A_BTN);
        }
      }
      assert.ok(wiped, `${label}: the spell-killed monster's cells must be wiped to this map's ground tile ${want.ground}`);
      assert.equal(mem[GAME_STATE], ST_BATTLE, `${label}: the wipe must be observed inside the battle`);

      for (let round = 0; round < 80 && mem[GAME_STATE] === ST_BATTLE; round++) tap(nes, A_BTN, 12);
      assert.equal(mem[GAME_STATE], ST_GAMEPLAY, `${label}: the battle never ended`);
      for (let i = 0; i < 40; i++) nes.frame();
      assert.equal(mem[FLAT_SCREEN], landing.flat, `${label}: the fight ends on the screen it began on`);
      assert.equal(mem[CUR_MAP], landing.map);
    }
  }
);
