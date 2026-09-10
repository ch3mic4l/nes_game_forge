// Play from here — starting the player somewhere other than the project's own
// ⚑ Start, for testing a screen without walking to it.
//
// Four claims are worth pinning down. The addresses come from
// engine/constants.asm rather than a copy of it in JavaScript, so renaming or
// moving one of those bytes has to fail here rather than in the app. The
// override goes through the engine's own door, so it lands on the screen it
// asked for even on a cartridge that boots into a title screen. Getting there
// costs one tick of the world at the authored start, and that tick has to leave
// no trace — a pickup sitting on the start square is the cheapest thing that
// would prove otherwise. And it is only ever RAM: the ROM the emulator runs is
// the file on disk, byte for byte, which is what keeps a test-play shortcut out
// of anything the user could ship.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEquates, missingEquates } from '../../shared/enginesyms.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
import {
  applyStartOverride,
  startOverrideProblem,
  MAIN_LOOP,
  MAIN_LOOP_WARP,
  REQUIRED_RAM
} from '../../renderer/emulator/testplay.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { LIMITS } from '../../shared/project.js';
import { finishNamingIfOpen } from '../lib/naming.js';
import { BORDER_H, BORDER_CORNER } from '../../shared/font.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM);

const engineConstants = () => parseEquates(fs.readFileSync(path.join(ROOT, 'engine/constants.asm'), 'utf8'));

// Greenwood is a 2x2 map and the title is the map after it, so flat screen 3 is
// the far corner of the world: not where the cartridge starts, and not the
// screen it boots into either.
const TARGET_SCREEN = 3;
const TARGET_X = 48;
const TARGET_Y = 64;

/** The sample ROM in a fresh emulator, with the constants and labels it was built with. */
function loaded() {
  const rom = new Uint8Array(fs.readFileSync(ROM));
  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(rom);
  return {
    emulator,
    rom,
    build: {
      ram: parseEquates(fs.readFileSync(path.join(SAMPLE, 'build/constants.asm'), 'utf8')),
      symbols: parseSymbolFile(fs.readFileSync(path.join(SAMPLE, 'build/game.fns'), 'utf8'))
    }
  };
}

const GEM = 1; // the sample's pickup actor
// The metatile the player is standing on at the authored start: player_hazard
// probes 8 right and 12 down of the player's corner, which at 112,112 is
// column 7, row 7.
const START_CELL = 7 * LIMITS.screenCols + 7;

/**
 * The sample, tweaked and built into a temp directory. Reaching the point where
 * a door is decided means running one tick of the world at the player's start,
 * so every variant here is a way of making that tick leave a mark if it can.
 *
 * No title screen in any of them: boot then spawns the *start* screen's actors,
 * which is what puts anything underfoot at all. On a title cartridge the actors
 * present at that moment are the title's — that is to say none — and these
 * tests would pass without proving anything.
 */
async function builtVariant(t, tweak) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-testplay-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.project.titleMap = null;
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  return {
    emulator,
    project,
    build: {
      ram: parseEquates(fs.readFileSync(path.join(dir, 'build/constants.asm'), 'utf8')),
      symbols: parseSymbolFile(fs.readFileSync(built.symbolPath, 'utf8'))
    }
  };
}

test('the engine still defines every name the override pokes', () => {
  const ram = engineConstants();
  assert.deepEqual(missingEquates(ram, REQUIRED_RAM), []);
  // Two spot values, so a parser that returned an empty object could not pass
  // the check above by accident.
  assert.equal(ram.player_x, 0x10);
  assert.equal(ram.warp_ready, 0x2e);
});

test('a missing address is reported rather than poked', () => {
  const ram = engineConstants();
  const symbols = { [MAIN_LOOP]: 0xc31d, [MAIN_LOOP_WARP]: 0xc339 };
  assert.equal(startOverrideProblem({ ram, symbols }), null);
  assert.match(startOverrideProblem({ ram: null, symbols }), /could not be read/);
  assert.match(startOverrideProblem({ ram, symbols: {} }), new RegExp(MAIN_LOOP));
  assert.match(
    startOverrideProblem({ ram, symbols: { [MAIN_LOOP]: 0xc31d } }),
    new RegExp(MAIN_LOOP_WARP)
  );

  const { warp_scr, ...withoutWarp } = ram;
  assert.match(startOverrideProblem({ ram: withoutWarp, symbols }), /warp_scr/);
});

test('play from here lands on the screen it asked for', { skip: !hasRom && 'sample ROM not built' }, () => {
  const { emulator, build } = loaded();
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);

  const { ram } = build;
  assert.equal(emulator.peek(ram.flat_screen), TARGET_SCREEN);
  assert.equal(emulator.peek(ram.player_x), TARGET_X);
  assert.equal(emulator.peek(ram.player_y), TARGET_Y);
  // The engine consumed the door rather than the override merely parking the
  // request: take_door clears the flag as its first act, and it is what
  // redraws the screen and respawns its actors.
  assert.equal(emulator.peek(ram.warp_ready), 0);

  // And the world really is that screen, which the counter alone would not
  // show: these are the actors Greenwood's far corner is holding, where the
  // screen the cartridge starts on has one.
  const spawned = [];
  for (let slot = 0; slot < ram.MAX_ENTITIES; slot++) {
    if (emulator.peek(ram.ent_active + slot)) spawned.push(emulator.peek(ram.ent_actor + slot));
  }
  assert.deepEqual(spawned, [1, 5, 3]);
});

test('nothing on the start square is picked up on the way past', { skip: !hasRom && 'sample ROM not built' }, async (t) => {
  const { emulator, build } = await builtVariant(t, (project) => {
    project.maps[0].screens[0].entities = [
      { actorId: GEM, x: project.project.startX, y: project.project.startY, props: {} }
    ];
  });
  const { ram } = build;

  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);
  assert.equal(emulator.peek(ram.flat_screen), TARGET_SCREEN);
  assert.equal(emulator.peek(ram.pickups), 0, 'the gem on the start square was collected on the way past');
  assert.equal(emulator.peek(ram.inv_count), 0, 'the bag picked something up on the way past');

  // ...and the gem really is collectable, so the assertions above are about the
  // override rather than about a project where nothing could have happened.
  emulator.reset();
  for (let frame = 0; frame < 20; frame++) emulator.runFrame();
  finishNamingIfOpen(emulator.nes); // sample now has hero naming on (phase 5): a titleless boot cold-opens the grid
  assert.equal(emulator.peek(ram.pickups), 1, 'booting normally should have collected the gem');
});

test('a hazard on the start square costs no health on the way past', { skip: !hasRom && 'sample ROM not built' }, async (t) => {
  const { emulator, build, project } = await builtVariant(t, (draft) => {
    // The floor the player stands on at the start, turned to spikes. A metatile
    // is global, so this is one edit rather than one per screen.
    const underfoot = draft.maps[0].screens[0].metatiles[START_CELL];
    draft.metatiles[underfoot].collision = 'damage';
  });
  const { ram } = build;
  // What a new game starts with — read from the project, not from RAM, which is
  // still all zeroes until the cartridge has booted.
  const hearts = project.project.maxHearts;

  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);
  assert.equal(emulator.peek(ram.flat_screen), TARGET_SCREEN);
  assert.equal(emulator.peek(ram.player_hp), hearts, 'the spikes at the start took a heart on the way past');
  // The invincible frames the override borrowed to arrange that are handed back,
  // or the test play would begin with a free run through everything hostile.
  assert.equal(emulator.peek(ram.player_iframes), 0);

  // And the spikes are real: booting normally onto them costs a heart.
  emulator.reset();
  for (let frame = 0; frame < 20; frame++) emulator.runFrame();
  finishNamingIfOpen(emulator.nes); // sample now has hero naming on (phase 5): a titleless boot cold-opens the grid
  assert.ok(
    emulator.peek(ram.player_hp) < hearts,
    `booting normally onto the spikes should have hurt, but health is still ${emulator.peek(ram.player_hp)}`
  );
});

test('it plays past a title screen', { skip: !hasRom && 'sample ROM not built' }, () => {
  const { emulator, build } = loaded();
  // The sample boots into its title, and every state but gameplay freezes the
  // world -- so a start override that did not skip it would sit unconsumed.
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);
  assert.equal(emulator.peek(build.ram.game_state), build.ram.ST_GAMEPLAY);
});

test('it leaves the screen drawn and the machine presentable', { skip: !hasRom && 'sample ROM not built' }, () => {
  const { emulator, build } = loaded();
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);

  // The redraw drives the PPU under forced blank, so returning part-way through
  // it would hand the player a black screen and a disabled NMI. Coming back at
  // the top of the loop is what rules that out: PPUCTRL_ON and PPUMASK_ON, from
  // engine/constants.asm, are back in the registers by then.
  assert.equal(emulator.nes.cpu.mem[0x2000], 0x88);
  assert.equal(emulator.nes.cpu.mem[0x2001], 0x1e);
});

// Phase 5 (docs/design-name-entry.md v16.4 §17 item 5): sample now carries
// hero naming for real, and builtVariant's own project is titleless -- a
// cold boot therefore lands mid-naming-grid-raise (boot.asm's own reset
// already ran name_begin/box_begin before main_loop is ever reached, per
// CLAUDE.md's own "a titleless cold boot never reaches start_game at all")
// before applyStartOverride's own poke ever runs at all. Investigated per
// that item, and testplay.js DOES need the fix below: ui_tick, the only
// thing that would ever drain box_state/box_after normally, only runs while
// game_state is non-zero, so nothing on the gameplay path the override
// forces would ever clear them on its own -- applyStartOverride now pokes
// both to BOX_CLOSED itself, in the same "make the tick inert" family as its
// other pokes. Whether the staleness is actually visible turned out to
// depend on how the next conversation is reached: a do_talk conversation's
// own script_start (engine/script.asm) zeroes box_state unconditionally
// before box_begin ever reads it, which masks the symptom for that specific
// path (see the border-row comment further down, where sabotage found this)
// -- but MMC3's split_select (engine/split.asm) reads box_state every frame
// regardless of whether a conversation is running, so the reset still
// matters on that board independent of what any particular conversation
// does.
test('it leaves the screen drawn and the machine presentable even mid-naming-grid-raise, on a titleless naming-on ROM', {
  skip: !hasRom && 'sample ROM not built'
}, async (t) => {
  // A Say-carrying NPC standing exactly where the override lands, so a real
  // conversation can be started with no walk needed -- this is what the
  // finding 2 fix round strengthens this test to reach: box_state/box_after
  // must not merely read as closed right after the override, they must
  // leave the box's own state machine ready for the NEXT box_begin to raise
  // a real frame, not take box_begin_clear's "already up" path for one that
  // was never drawn (engine/text.asm).
  const { emulator, build } = await builtVariant(t, (project) => {
    const npcId = project.sprites.actors.length;
    project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: npcId, name: 'Teller', behavior: 'npc' });
    project.maps[0].screens[TARGET_SCREEN].entities.push({
      actorId: npcId,
      x: TARGET_X,
      y: TARGET_Y,
      props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hello.' }] }] } }
    });
  });
  // Run to the same point applyStartOverride's own first internal step
  // stops at -- calling runToAddress again from there is a no-op (it checks
  // the current pc before stepping), so this only observes the state
  // applyStartOverride itself is about to act on, it does not change it.
  assert.ok(emulator.runToAddress(build.symbols[MAIN_LOOP]), 'the ROM did not reach its main loop');
  assert.equal(
    emulator.peek(build.ram.game_state),
    build.ram.ST_NAMEENTRY,
    'the cold boot should already be mid-naming before the override ever runs'
  );
  assert.notEqual(emulator.peek(build.ram.box_state), build.ram.BOX_CLOSED, 'the naming grid should already be raising a real box_state');
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);

  assert.equal(emulator.peek(build.ram.flat_screen), TARGET_SCREEN);
  assert.equal(
    emulator.peek(build.ram.game_state),
    build.ram.ST_GAMEPLAY,
    'the override should have taken over from the still-open naming grid'
  );
  assert.equal(emulator.nes.cpu.mem[0x2000], 0x88);
  assert.equal(emulator.nes.cpu.mem[0x2001], 0x1e);

  // finding 2: the override must also leave box_state/box_after closed. This
  // is the assertion that actually discriminates the fix -- verified by
  // sabotage (temporarily removing testplay.js's own two pokes): it fails
  // here, box_state reading 1 (BOX_OPENING) instead of 0. A stale box_state
  // matters on its own even though the very next conversation happens to
  // recover from it (see the comment below) -- MMC3's split_select
  // recomputes the font-bank split from box_state every single frame, so a
  // stale nonzero value is a wrong input to it for as long as it persists,
  // independent of whatever the next conversation does.
  assert.equal(emulator.peek(build.ram.box_state), build.ram.BOX_CLOSED, 'box_state should be closed after the override, not left mid-raise');
  assert.equal(emulator.peek(build.ram.box_after), build.ram.BOX_CLOSED, 'box_after should be closed after the override, not left pointing at BOX_NAMEENTRY');

  // Interact with the NPC standing on the landed square -- default binding
  // is B (jsnes button 1). Held across several real frames, not pulsed for
  // one: applyStartOverride leaves the CPU mid-instruction-stream at
  // main_loop's own entry rather than at a fresh frame boundary, so a
  // single runFrame() call can complete before the input poll this press
  // needs to reach ever runs again (confirmed empirically -- one frame
  // never started the conversation at all; three reliably does). Bounded on
  // the real effect (game_state leaving ST_GAMEPLAY), not a fixed count.
  emulator.setButton(BUTTON.B, true);
  for (let i = 0; i < 10 && emulator.peek(build.ram.game_state) === build.ram.ST_GAMEPLAY; i++) emulator.runFrame();
  emulator.setButton(BUTTON.B, false);
  assert.notEqual(emulator.peek(build.ram.game_state), build.ram.ST_GAMEPLAY, 'interacting with the NPC never started a conversation');
  let reachedTyping = false;
  for (let i = 0; i < 60 && !reachedTyping; i++) {
    emulator.runFrame();
    if (emulator.peek(build.ram.box_state) === build.ram.BOX_TYPING) reachedTyping = true;
  }
  assert.ok(reachedTyping, 'the conversation never reached BOX_TYPING');

  // The top border row (BOX_TOP_ROW, engine/text.asm's own box_row_addr,
  // row*32 with no column offset): corner, 30 horizontal fills, corner --
  // the test/unit/text.test.js boxRows idiom, read directly here since this
  // file has no ROM-independent import path to it.
  //
  // This assertion does NOT independently catch a missing box_state/
  // box_after reset, and sabotage confirmed that empirically: with
  // testplay.js's own pokes removed, this border still draws correctly and
  // BOX_TYPING is still reached, because do_talk's own start_dialog runs
  // through script_start (engine/script.asm), which unconditionally zeroes
  // box_state the instant ANY fresh conversation begins -- before box_begin
  // ever reads it. That masks box_begin_clear's "already up" mistake for
  // this specific reproduction (a do_talk-triggered conversation), which is
  // narrower than the original diagnosis claimed. It is kept here as a
  // straightforward proof that a real conversation still works correctly
  // after the override; the assertion that actually discriminates the fix
  // is the direct box_state/box_after check above.
  const topRow = Array.from({ length: 32 }, (_, col) => emulator.nes.ppu.vramMem[0x2000 + 24 * 32 + col]);
  assert.equal(topRow[0], BORDER_CORNER, 'the border row’s own left corner was not drawn');
  assert.equal(topRow[31], BORDER_CORNER, 'the border row’s own right corner was not drawn');
  assert.ok(topRow.slice(1, 31).every((tile) => tile === BORDER_H), 'the border row’s own horizontal fill was not drawn -- box_begin_clear kept a frame that was never actually raised');
});

test('the same ROM still boots where the project says', { skip: !hasRom && 'sample ROM not built' }, () => {
  const { emulator, rom, build } = loaded();
  const before = fs.readFileSync(ROM);
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);

  // Nothing was patched: neither the image handed to the emulator nor the file
  // it came from.
  assert.deepEqual(Buffer.from(rom), before);
  assert.deepEqual(fs.readFileSync(ROM), before);

  // And the cartridge proves it for itself. Reset is all it takes to get the
  // game the user would ship: its own title screen, and the player back at the
  // start the Map Forge authored.
  emulator.reset();
  for (let frame = 0; frame < 30; frame++) emulator.runFrame();
  const { ram } = build;
  assert.equal(emulator.peek(ram.game_state), 3); // ST_TITLE: the sample has one
  assert.equal(emulator.peek(ram.player_x), 112); // sample/project.json's startX
  assert.equal(emulator.peek(ram.player_y), 112);
});
