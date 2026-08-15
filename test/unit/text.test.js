// The message box, driven through the built ROM.
//
// Everything about it is invisible to engine RAM alone — the point of the thing
// is what ends up in the nametable — so most of these read `nes.ppu.vramMem`
// back and decode it through the same font module the compiler wrote it with.
// The typewriter, the paging and the restore are each a separate multi-frame
// state machine, and the restore in particular is the one that fails silently:
// a box that comes down leaving the wrong tiles behind looks like map
// corruption, not like a text bug.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { generateAssets } from '../../main/build/generate.js';
import { createProject } from '../../shared/project.js';
import { encodeTiles } from '../../shared/chr.js';
import { ARROW_TILE, FONT_BASE, FONT_TILES, charToTile } from '../../shared/font.js';
import { encodeString } from '../../main/build/textcompile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25;
const BOX_STATE = 0x40;
const ENT_X = 0x310;
const ENT_Y = 0x318;

const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const BOX_CLOSED = 0;
const BOX_TYPING = 2;
const BOX_PAGEWAIT = 3;
const BOX_ENDWAIT = 6;

// The box covers tile rows 24-29 of nametable 0, which is metatile rows 12-14.
const BOX_TOP_ROW = 24;
const BOX_ROWS_HIGH = 6;
// ARROW_LO in engine/constants.asm, as an offset from $2000.
const ARROW_OFFSET = 0x39e;

const A = 0;
const B = 1;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

function boot(romPath = ROM_PATH, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  // A cartridge with a title screen boots into it; every scenario here is about
  // the game behind it, so press through. `game_state` is ST_TITLE only when the
  // project actually has one, so this is a no-op for the ROMs that do not.
  if (nes.cpu.mem[0x25] === 3) {
    nes.buttonDown(1, 3);
    nes.frame();
    nes.buttonUp(1, 3);
    for (let i = 0; i < 12; i++) nes.frame();
  }
  return nes;
}

const tap = (nes, button, frames = 2) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

const run = (nes, frames) => {
  for (let i = 0; i < frames; i++) nes.frame();
};

/** Chase an actor's live position — a patroller keeps moving while we approach. */
function walkToEntity(nes, slot, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const targetX = nes.cpu.mem[ENT_X + slot];
    const targetY = nes.cpu.mem[ENT_Y + slot];
    const x = nes.cpu.mem[PLAYER_X];
    const y = nes.cpu.mem[PLAYER_Y];
    const buttons = [];
    if (x < targetX - 2) buttons.push(RIGHT);
    else if (x > targetX + 2) buttons.push(LEFT);
    if (y < targetY - 2) buttons.push(DOWN);
    else if (y > targetY + 2) buttons.push(UP);
    if (!buttons.length) return true;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  return false;
}

/** The six tile rows the box covers, as raw nametable bytes. */
const boxRows = (nes) =>
  Array.from({ length: BOX_ROWS_HIGH }, (_, row) =>
    [...nes.ppu.vramMem.slice(0x2000 + (BOX_TOP_ROW + row) * 32, 0x2000 + (BOX_TOP_ROW + row) * 32 + 32)]
  );

/** A text row of the box, decoded back through the font into a string. */
function boxLine(nes, line) {
  const start = 0x2000 + (BOX_TOP_ROW + 1 + line) * 32 + 2;
  let out = '';
  for (let col = 0; col < 28; col++) {
    const tile = nes.ppu.vramMem[start + col];
    out += tile >= FONT_BASE ? String.fromCharCode(32 + (tile - FONT_BASE)) : '�';
  }
  return out.trimEnd();
}

/** Advance until `predicate` holds, so a test never hardcodes a frame count. */
function runUntil(nes, predicate, budget = 600) {
  for (let i = 0; i < budget; i++) {
    if (predicate(nes)) return true;
    nes.frame();
  }
  return predicate(nes);
}

// --- the compiled font ------------------------------------------------------

test('the font is stamped into every background table of a project with text', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-font-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('Talky');
  project.maps[0].screens[0].entities.push({ actorId: 0, x: 96, y: 96, props: { dialogue: 'Hi.' } });
  await generateAssets({ dir, project });

  const chr = await fs.promises.readFile(path.join(dir, 'build/assets/tiles0.chr'));
  const expected = encodeTiles(FONT_TILES);
  assert.deepEqual(
    [...chr.slice(FONT_BASE * 16, FONT_BASE * 16 + expected.length)],
    [...expected],
    'the background table should carry the font at $A0'
  );
  // The letter A is the readable half of that: it must not be blank.
  const capitalA = charToTile('A') * 16;
  assert.ok([...chr.slice(capitalA, capitalA + 16)].some((byte) => byte !== 0), 'the glyph for A is blank');
});

test('a project whose only text lives in a common event still gets the font', async (t) => {
  // No placement has a dialogue string or a live event of its own -- the only
  // Say in the whole project is inside a common event nothing has called yet.
  // The reservation has to see that, or the ROM would draw text with no font
  // behind it the day something finally calls it.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-common-font-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('Common');
  project.commonEvents = [
    {
      name: 'Greeting',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hi.' }] }] }
    }
  ];
  await generateAssets({ dir, project });

  const chr = await fs.promises.readFile(path.join(dir, 'build/assets/tiles0.chr'));
  const expected = encodeTiles(FONT_TILES);
  assert.deepEqual(
    [...chr.slice(FONT_BASE * 16, FONT_BASE * 16 + expected.length)],
    [...expected],
    'the background table should carry the font even though nothing places it'
  );
});

test('a project with nothing to say keeps all 256 background tiles', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-nofont-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  await generateAssets({ dir, project: createProject('Quiet') });
  const chr = await fs.promises.readFile(path.join(dir, 'build/assets/tiles0.chr'));
  assert.ok(
    [...chr.slice(FONT_BASE * 16, 256 * 16)].every((byte) => byte === 0),
    'the font range should be untouched when the project shows no text'
  );
});

test('authored text compiles to the pages the editor previews', () => {
  const { bytes } = encodeString('One.\n\nTwo.');
  // Page break between them, terminator at the end, glyphs in between.
  assert.equal(bytes.at(-1), 0x00);
  assert.equal(bytes.filter((byte) => byte === 0x02).length, 1, 'a blank line is one page break');
  assert.equal(bytes[0], charToTile('O'));
});

// --- the box in the ROM -----------------------------------------------------

test('talking opens a box that types itself out', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  const before = boxRows(nes);
  assert.ok(walkToEntity(nes, 0), 'could not reach the slime');

  tap(nes, B); // interact
  assert.equal(nes.cpu.mem[GAME_STATE], ST_DIALOG);

  // The box goes up one row per frame — the NMI queue only carries one row per
  // vblank — so the first thing to assert is that it finished going up at all.
  assert.ok(runUntil(nes, (n) => n.cpu.mem[BOX_STATE] === BOX_TYPING), 'the box never finished opening');
  assert.notDeepEqual(boxRows(nes), before, 'the box drew nothing into the nametable');

  assert.ok(runUntil(nes, (n) => n.cpu.mem[BOX_STATE] === BOX_PAGEWAIT), 'the first page never filled');
  assert.equal(boxLine(nes, 0), 'A slime blocks the path,');
  assert.equal(boxLine(nes, 1), 'wobbling.');

  // The prompt has to be somewhere a television will actually show: the outer
  // eight pixels are overscan, so the frame's own bottom row is not a place to
  // put the one glyph that tells the player to press a button. Everything the
  // box draws is queued for the *next* vblank, hence the frames.
  run(nes, 3);
  assert.equal(nes.ppu.vramMem[0x2000 + ARROW_OFFSET], ARROW_TILE, 'no page arrow while waiting');
  assert.ok(ARROW_OFFSET < 29 * 32, 'the page arrow sits in the overscan');

  // Frozen, exactly as the portrait-only dialogue was.
  const frozenX = nes.cpu.mem[PLAYER_X];
  const frozenSlimeX = nes.cpu.mem[ENT_X];
  nes.buttonDown(1, RIGHT);
  run(nes, 30);
  nes.buttonUp(1, RIGHT);
  assert.equal(nes.cpu.mem[PLAYER_X], frozenX, 'the player walked while a message was up');
  assert.equal(nes.cpu.mem[ENT_X], frozenSlimeX, 'the slime kept patrolling while a message was up');
});

test('confirm turns the page, and the second page replaces the first', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  assert.ok(walkToEntity(nes, 0));
  tap(nes, B);
  assert.ok(runUntil(nes, (n) => n.cpu.mem[BOX_STATE] === BOX_PAGEWAIT));

  tap(nes, A);
  assert.ok(runUntil(nes, (n) => n.cpu.mem[BOX_STATE] === BOX_ENDWAIT), 'the last page never finished');
  assert.equal(boxLine(nes, 0), 'It does not seem to mind you');
  assert.equal(boxLine(nes, 3), '', 'the fourth line of the previous page should have been wiped');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_DIALOG, 'the conversation ended a page early');
});

test('closing the box puts the world back exactly as it was', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  assert.ok(walkToEntity(nes, 0));
  const before = boxRows(nes);
  const beforeAttr = [...nes.ppu.vramMem.slice(0x23f0, 0x2400)];

  tap(nes, B);
  // Bounded multi-tap: one press per wait, and the waits are the only presses
  // the box reacts to, so pressing through the typewriter cannot skip anything.
  let taps = 0;
  while (nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY && taps < 20) {
    runUntil(nes, (n) => n.cpu.mem[BOX_STATE] === BOX_PAGEWAIT || n.cpu.mem[BOX_STATE] === BOX_ENDWAIT);
    tap(nes, A);
    run(nes, 20);
    taps++;
  }
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, `the conversation never ended (${taps} taps)`);
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_CLOSED);

  // The box keeps no copy of what it covered: it rebuilds those rows out of the
  // screen's own metatiles, so this is the assertion that the arithmetic lining
  // the box up with metatile rows 12-14 is right.
  assert.deepEqual(boxRows(nes), before, 'the tiles under the box were not restored');
  assert.deepEqual(
    [...nes.ppu.vramMem.slice(0x23f0, 0x2400)],
    beforeAttr,
    'the attribute bytes under the box were not restored'
  );

  nes.buttonDown(1, RIGHT);
  run(nes, 20);
  nes.buttonUp(1, RIGHT);
  assert.notEqual(nes.cpu.mem[PLAYER_X], undefined);
});

test('an actor with nothing to say still gets the portrait, and one press ends it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-quiet-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = await loadProject(SAMPLE);
  // Same placement the sample uses, minus the line of dialogue.
  project.maps[0].screens[0].entities = [{ actorId: 0, x: 64, y: 160, props: {} }];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  assert.ok(walkToEntity(nes, 0), 'could not reach the slime');
  tap(nes, B);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_DIALOG);
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_CLOSED, 'an actor with no dialogue should raise no box');

  tap(nes, A);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'a single press should end a wordless conversation');
});
