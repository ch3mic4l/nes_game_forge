// Camera register, phase 1 (docs/design-camera.md, ROADMAP item 12): the
// nmi_scroll rewrite and the twelve-byte RAM chain (engine/constants.asm),
// with no consumer built on top of it yet -- nothing in this phase ever
// moves cam_x_lo/cam_y_lo/cam_nt in real play, so every non-trivial
// assertion below pokes the register bytes directly rather than driving a
// slide that does not exist yet. Phase 2 (the screen-edge slide) gets its
// own test file; this one only proves the register and its NMI application.
//
// Everything here builds its own project rather than touching `sample/`,
// which is a checked-in fixture.

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
import { runNesasm } from '../../main/build/nesasm.js';
import { referenceNametable } from '../lua/build_camera_roms.mjs';
import { createProject, createTileset, normalizeProject, projectUsesCamera } from '../../shared/project.js';
import { finishNamingIfOpen } from '../lib/naming.js';
import { callRoutine } from '../lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG_MMC1 = path.join(ROOT, 'sample-rpg-mmc1');

// Engine RAM, from engine/constants.asm's camera chain (docs/design-camera.md
// §2's twelve bytes, chained unconditionally off bt_walk_step). Hardcoded
// with this comment rather than parsed from the file under test, per
// CLAUDE.md's own rule: a test that reads the file it is checking proves
// nothing.
const CAM_X_LO = 0xaf;
const CAM_Y_LO = 0xb0;
const CAM_NT = 0xb1;
const CAM_SLIDE_LEFT = 0xb2;
const CAM_SLIDE_DIR = 0xb3;
const CAM_FAR = 0xb4;
const CAM_DIRTY = 0xb5;
const NMI_CAM_X_LO = 0xb6;
const NMI_CAM_Y_LO = 0xb7;
const NMI_CAM_NT = 0xb8;
const NMI_TMP = 0xb9;
const CAM_SLIDE_B_PENDING = 0xba;
const ALL_TWELVE = [
  CAM_X_LO, CAM_Y_LO, CAM_NT, CAM_SLIDE_LEFT, CAM_SLIDE_DIR, CAM_FAR,
  CAM_DIRTY, NMI_CAM_X_LO, NMI_CAM_Y_LO, NMI_CAM_NT, NMI_TMP, CAM_SLIDE_B_PENDING
];
const SHAKE_LEFT = 0x9b; // engine/constants.asm; confirmed against shake.test.js's own SHAKE_LEFT
const TMP = 0x06; // engine/constants.asm's mainline scratch nmi_tmp exists to avoid clobbering
const VRAM_READY = 0x3f; // engine/constants.asm, a plain literal equate
const GAME_STATE = 0x25;

const NPC = 4; // appended by buildWith, after the sample's four actors
const START_X = 112;
const START_Y = 112;
const B = 1;

function boot(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  if (nes.cpu.mem[GAME_STATE] === 3) {
    nes.buttonDown(1, 3);
    nes.frame();
    nes.buttonUp(1, 3);
    for (let i = 0; i < 12; i++) nes.frame();
  }
  // sample has hero naming on; finishNamingIfOpen is a no-op when naming is
  // off, so this is safe unconditionally -- the identical shake.test.js
  // precedent.
  finishNamingIfOpen(nes);
  return nes;
}

const run = (nes, frames) => {
  for (let i = 0; i < frames; i++) nes.frame();
};

/**
 * Steps the CPU directly from `startAddr` to `stopAddr`, instruction by
 * instruction, without ever calling `nes.frame()` -- the technique phase 1's
 * own nmi_tmp test uses for a routine with no `rts` of its own (nmi_scroll
 * falls through into split_arm/frame_cnt/rti). NMI generation is disabled
 * for the duration so a stray interrupt cannot divert PC mid-walk; a caller
 * that wants a real NMI to fire again afterward must restore $2000 itself
 * (nmi_scroll's own last-written value is PPUCTRL_ON = $88 with whichever
 * nametable bit cam_nt/nmi_cam_nt currently holds).
 */
function runToLabel(nes, startAddr, stopAddr, maxSteps = 200000) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.REG_PC = startAddr - 1;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== stopAddr) {
    nes.cpu.emulate();
    assert.ok(++steps < maxSteps, `never reached $${stopAddr.toString(16)}`);
  }
}

// Engine RAM needed to drive and observe real gameplay crossings, on top of
// the camera chain above.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const PENDING_ENT = 0x7c;
const SCREEN_FRESH = 0x7d;
const TALK_ENT = 0x3a;
const WARP_READY = 0x2e;
const WARP_SCR = 0x2f;
const WARP_X = 0x30;
const WARP_Y = 0x31;
const ENC_STEP = 0x61;
const PLAYER_HP = 0x4e;
const PC_HP = 0x398; // pc_hp,0 -- the RPG health model (party_damage), @size=MAX_PARTY
const ENT_ACTIVE = 0x300;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const ENT_TOUCHED = 0x518;
const BIND_COUNT = 0x557;
const SWITCHES = 0x390;
const PROBE_X = 0x08;
const PROBE_Y = 0x09;
const BOX_STATE = 0x40;
const NO_ENTITY = 0xff;
const DIR_RIGHT = 3;
const DIR_LEFT = 2;
const DIR_UP = 1;
const DIR_DOWN = 0;
const MAX_X = 240;
const MAX_Y = 224;

/**
 * Holds `dpadButton` from a threshold position (never poking flat_screen
 * directly), driving real frames until the crossing has either landed on a
 * new screen or the frame budget is exhausted -- the test plan's own "cross
 * an edge by holding the direction" rule. Returns once the crossing frame
 * itself has run (flat_screen already updated, the slide, if any, just
 * armed); the caller drives further frames to watch the slide or the cut.
 */
function crossEdge(nes, dpadButton, { playerX, playerY, maxFrames = 10 } = {}) {
  if (playerX !== undefined) nes.cpu.mem[PLAYER_X] = playerX;
  if (playerY !== undefined) nes.cpu.mem[PLAYER_Y] = playerY;
  const before = nes.cpu.mem[FLAT_SCREEN];
  nes.buttonDown(1, dpadButton);
  let i = 0;
  for (; i < maxFrames && nes.cpu.mem[FLAT_SCREEN] === before; i++) nes.frame();
  assert.notEqual(nes.cpu.mem[FLAT_SCREEN], before, `the crossing never left screen ${before} within ${maxFrames} frames`);
  return i;
}

/**
 * The PPU's own live background X scroll, composed from the three internal
 * fields the vendored core actually stores a $2005/$2000 write into -- real
 * emulator state, not a byte this engine writes for the test's benefit. The
 * identical helper shake.test.js already uses.
 */
const scrollX = (nes) => nes.ppu.regH * 256 + nes.ppu.regHT * 8 + nes.ppu.regFH;

/** The PPU's own live background Y scroll, composed the same way scrollX is. */
const scrollY = (nes) => nes.ppu.regV * 240 + nes.ppu.regVT * 8 + nes.ppu.regFV;

/**
 * The PPUMASK byte actually in effect, reconstructed from the same fields
 * the vendored core's own $2001 write handler sets -- the identical helper
 * shake.test.js already uses.
 */
const ppuMask = (nes) =>
  nes.ppu.f_dispType |
  (nes.ppu.f_bgClipping << 1) |
  (nes.ppu.f_spClipping << 2) |
  (nes.ppu.f_bgVisibility << 3) |
  (nes.ppu.f_spVisibility << 4) |
  (nes.ppu.f_color << 5);

/**
 * A build of `sample` with the camera toggled and, optionally, one talkable
 * NPC 16px above the player's own start position carrying `commands` --
 * the identical placement shake.test.js's own buildWith uses. `commands`
 * exists only to turn on whatever generated flag a live command needs
 * (SHAKE_ENABLED for a live Shake, in this file); nothing here drives those
 * commands through real gameplay except where a test says so -- every other
 * assertion pokes the RAM the resulting code reads instead, since nothing in
 * phase 1 has a consumer that could trigger it for real.
 */
async function buildWith(t, { camera = true, commands = null } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-camera-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.cartridge.camera = camera;
  if (commands) {
    const slime = project.sprites.actors[0];
    project.sprites.actors.push({ ...structuredClone(slime), id: NPC, name: 'Walker', behavior: 'npc' });
    project.maps[0].screens[0].entities.push({
      actorId: NPC,
      x: START_X,
      y: START_Y - 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    });
  }
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const nes = boot(built.romPath);
  return { project, dir, romPath: built.romPath, nes, addrOf };
}

/**
 * A build of `sample` (a real 2x2 grid, one shared tileset, hero naming on)
 * with the camera on and `mutate(project)` applied before saving -- the
 * phase 2 fixture every crossing test below builds from. `sample`'s own
 * Greenwood map already gives a same-tileset right neighbour (screen 0 ->
 * screen 1, the H axis) and a same-tileset down neighbour (screen 0 ->
 * screen 2, the V axis) for free, so most tests need no map surgery at all.
 */
async function buildSlide(t, { mirroring = 'vertical', mapperId = 0, mutate = null } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-camera-slide-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.cartridge.camera = true;
  project.cartridge.mirroring = mirroring;
  project.cartridge.mapper = mapperId;
  if (mutate) mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const nes = boot(built.romPath);
  return { project, dir, romPath: built.romPath, nes, addrOf };
}

/**
 * A build of `sample-rpg-mmc1` (a real, checked-in 2x1 RPG world, MMC1, no
 * scanline IRQ, hero naming off) with the camera on and `mutate(project)`
 * applied before saving -- used only where a phase 2 test genuinely needs
 * the RPG-only health model (party_damage) or the wandering-encounter
 * mechanic (check_encounter, gated on BATTLE_ENABLED), neither of which
 * `sample`'s own action game type ever assembles at all.
 */
async function buildRpgSlide(t, { mutate = null } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-camera-rpgslide-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG_MMC1);
  project.cartridge.camera = true;
  if (mutate) mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = boot(built.romPath);
  return { project, dir, romPath: built.romPath, nes };
}

// A dummy, never-triggered Shake -- present purely so SHAKE_ENABLED assembles;
// several tests below poke shake_left directly rather than running the
// scripted command through real dialogue.
const DUMMY_SHAKE = [{ op: 'shake', frames: 1 }];

// -------------------------------------------------------- 1. Shake composition

test(
  'camera at rest composes with Shake identically to the camera-off build',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const off = await buildWith(t, { camera: false, commands: DUMMY_SHAKE });
    const on = await buildWith(t, { camera: true, commands: DUMMY_SHAKE });
    // Synthetic: nothing in phase 1 ever moves cam_x_lo/y_lo/nt away from the
    // (0,0) reset leaves them at, so this is the only camera state a real
    // project can ever reach -- poking shake_left directly (rather than
    // running the scripted Shake through dialogue) isolates the composition
    // from anything else a real conversation would also touch.
    off.nes.cpu.mem[SHAKE_LEFT] = 7;
    on.nes.cpu.mem[SHAKE_LEFT] = 7;
    const seqOff = [];
    const seqOn = [];
    for (let i = 0; i < 10; i++) {
      run(off.nes, 1);
      run(on.nes, 1);
      // nes.cpu.mem[0x2000] is the real PPUCTRL byte -- the vendored mapper's
      // own $2000 write handler stores every write there
      // (renderer/emulator/core/mappers/mapper0.js's regWrite), the same
      // "real emulator state" rule scrollX/scrollY/ppuMask already follow.
      // scrollX/scrollY alone cover only the nametable-select bits of
      // PPUCTRL; they cannot see a wrong pattern-table/sprite-size/increment
      // selection composed into the same byte, which is exactly what
      // ora #PPUCTRL_ON could get wrong without moving the scroll at all.
      seqOff.push([off.nes.cpu.mem[0x2000], scrollX(off.nes), scrollY(off.nes), ppuMask(off.nes)]);
      seqOn.push([on.nes.cpu.mem[0x2000], scrollX(on.nes), scrollY(on.nes), ppuMask(on.nes)]);
    }
    assert.deepEqual(
      seqOn,
      seqOff,
      'with cam_x_lo=cam_nt=0 (camera at rest), the whole per-frame (PPUCTRL, PPUMASK, scrollX, scrollY) sequence ' +
        'over a Shake must be byte-identical to the camera-off build -- the composition reduces to today\'s exact output'
    );
  }
);

// ------------------------------------------------------ 2. Publication lock

test(
  'a torn wrap update is never shown: NMI mid-wrap holds the pre-tick coordinate (synthetic)',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildWith(t, { camera: true });

    // Establish a known, complete "pre-tick" coordinate as the snapshot's own
    // last-good value.
    nes.cpu.mem[CAM_X_LO] = 10;
    nes.cpu.mem[CAM_Y_LO] = 20;
    nes.cpu.mem[CAM_NT] = 0;
    run(nes, 1);
    assert.equal(scrollX(nes), 10, 'sanity: the pre-tick coordinate is on screen before the synthetic tear');
    assert.equal(scrollY(nes), 20);

    // Synthetic: simulate an NMI landing between a wrap tick's low-byte store
    // and its cam_nt toggle -- cam_dirty raised, only the low byte moved so
    // far, nt still holds its old value. Real play cannot land an NMI at a
    // chosen instruction boundary on demand; a direct poke can.
    nes.cpu.mem[CAM_DIRTY] = 1;
    nes.cpu.mem[CAM_X_LO] = 240; // torn: cam_nt has not been toggled yet
    run(nes, 1);
    assert.equal(nes.cpu.mem[NMI_CAM_X_LO], 10, 'the snapshot must not refresh while cam_dirty is set');
    assert.equal(nes.cpu.mem[NMI_CAM_Y_LO], 20);
    assert.equal(nes.cpu.mem[NMI_CAM_NT], 0);
    assert.equal(scrollX(nes), 10, 'the PPU must keep showing the pre-tick coordinate, never the torn one');
    assert.equal(scrollY(nes), 20);

    // Clear the lock and finish the pair -- the next NMI must catch up.
    nes.cpu.mem[CAM_DIRTY] = 0;
    nes.cpu.mem[CAM_NT] = 1;
    run(nes, 1);
    assert.equal(nes.cpu.mem[NMI_CAM_X_LO], 240, 'once the lock clears, the snapshot must catch up to the real tick');
    assert.equal(nes.cpu.mem[NMI_CAM_NT], 1);
    assert.equal(scrollX(nes), 256 + 240);
    assert.equal(scrollY(nes), 20);
  }
);

test(
  'a dirty-set camera and a draining vram packet do not corrupt each other\'s NMI (synthetic)',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes, addrOf } = await buildWith(t, { camera: true });

    nes.cpu.mem[CAM_X_LO] = 10;
    nes.cpu.mem[CAM_Y_LO] = 20;
    nes.cpu.mem[CAM_NT] = 0;
    run(nes, 1);
    assert.equal(scrollX(nes), 10, 'sanity: the last-complete snapshot is on screen before the synthetic setup');
    assert.equal(scrollY(nes), 20);

    // Synthetic: hold the publication lock, then queue a one-byte packet
    // through vram_open/vram_push/vram_end (the callRoutine helper lifted
    // into test/lib/ once this file needed it too) and mark it ready so this
    // same NMI's own drain runs before nmi_scroll -- the drain's own $2006
    // writes move the PPU's addressing state, which is exactly what a
    // camera that "skipped" its write (round 1's rejected shape) would have
    // left on screen instead of the real coordinate.
    nes.cpu.mem[CAM_DIRTY] = 1;
    nes.cpu.REG_ACC = 0x23;
    nes.cpu.REG_Y = 0x00;
    callRoutine(nes, addrOf('vram_open'));
    nes.cpu.REG_ACC = 0xff;
    callRoutine(nes, addrOf('vram_push'));
    callRoutine(nes, addrOf('vram_end'));
    // callRoutine disables NMI generation as a side effect of making its own
    // stub call reliably return (nes.mmap.write(0x2000, 0)) -- restore it to
    // nmi_scroll's own last-written value (PPUCTRL_ON, nt=0) or the frame
    // below would never actually take an NMI at all, making this assertion
    // vacuously true regardless of what nmi_scroll's camera path does.
    nes.mmap.write(0x2000, 0x88);
    nes.cpu.mem[VRAM_READY] = 1;

    run(nes, 1);
    assert.equal(
      scrollX(nes),
      10,
      'the live PPU scroll must equal the last-complete snapshot -- not (0,0), and not the drain\'s own leftover address'
    );
    assert.equal(scrollY(nes), 20);
  }
);

// --------------------------------------------------- 3. Shake wrap carries

test(
  'Shake composes correctly at every wrap boundary, all four nametables (synthetic)',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildWith(t, { camera: true, commands: DUMMY_SHAKE });
    // Synthetic: a slide's own 16-step arithmetic (phase 2) does not
    // naturally land on every one of these boundary combinations within a
    // single crossing, so they are injected directly. Extended for phase 2
    // (design-camera.md §7 "Shake wrap lows") from phase 1's own {0,1} to
    // all four nametables -- a vertical slide sits on nt 2 (cam_far_nt,
    // engine/camera.asm), which phase 1 alone could never reach, and
    // Shake's own `eor #1` (nmi_scroll, engine/boot.asm) must only ever
    // touch bit 0 (the horizontal nametable half of the pair) -- bit 1 (the
    // vertical half) must read back exactly (nt>>1) throughout, never
    // disturbed by a horizontal shake. scrollX's own (nt*256+x±2) & 511
    // formula already reduces correctly for nt=2/3 (256*2 = 512 ≡ 0 mod
    // 512), unchanged from phase 1; scrollY must additionally account for
    // nt's own bit 1 selecting the vertical nametable half, which phase 1's
    // nt∈{0,1} range never exercised (both have bit 1 clear).
    for (const nt of [0, 1, 2, 3]) {
      for (const x of [0, 1, 254, 255]) {
        // The +2 phase: shake_left decrements to an even value.
        nes.cpu.mem[CAM_X_LO] = x;
        nes.cpu.mem[CAM_Y_LO] = 50;
        nes.cpu.mem[CAM_NT] = nt;
        nes.cpu.mem[CAM_DIRTY] = 0;
        nes.cpu.mem[SHAKE_LEFT] = 1;
        run(nes, 1);
        assert.equal(
          scrollX(nes),
          (nt * 256 + x + 2) & 511,
          `nt=${nt} x=${x}, +2 phase: scrollX must be (nt*256+x+2) mod 512`
        );
        assert.equal(scrollY(nes), (nt >> 1) * 240 + 50, `nt=${nt} x=${x}, +2 phase: bit 1 (vertical half) must read back exactly nt>>1, never disturbed by the horizontal shake`);

        // The -2 phase: shake_left decrements to an odd value.
        nes.cpu.mem[CAM_X_LO] = x;
        nes.cpu.mem[CAM_Y_LO] = 50;
        nes.cpu.mem[CAM_NT] = nt;
        nes.cpu.mem[CAM_DIRTY] = 0;
        nes.cpu.mem[SHAKE_LEFT] = 2;
        run(nes, 1);
        assert.equal(
          scrollX(nes),
          (nt * 256 + x - 2 + 512) & 511,
          `nt=${nt} x=${x}, -2 phase: scrollX must be (nt*256+x-2) mod 512`
        );
        assert.equal(scrollY(nes), (nt >> 1) * 240 + 50, `nt=${nt} x=${x}, -2 phase: bit 1 (vertical half) must read back exactly nt>>1, never disturbed by the horizontal shake`);
      }
    }
  }
);

// ----------------------------------------------------- 4. First visible frame

test(
  'nmi_scroll recovers the published coordinate immediately after a screen redraw',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildWith(t, { commands: [{ op: 'warp', screen: 1, x: 40, y: 40 }] });

    // engine/boot.asm's reset clears $0000-$07FF, which covers the whole
    // camera chain -- every byte reads 0 after boot with no code of its own.
    for (const addr of ALL_TWELVE) {
      assert.equal(nes.cpu.mem[addr], 0, `byte $${addr.toString(16)} should be 0 after boot`);
    }

    // Poke a non-zero coordinate -- not vacuous at (0,0) -- and confirm it is
    // already on screen before anything else happens.
    nes.cpu.mem[CAM_X_LO] = 40;
    nes.cpu.mem[CAM_Y_LO] = 60;
    nes.cpu.mem[CAM_NT] = 1;
    run(nes, 1);
    assert.equal(scrollX(nes), 256 + 40, 'the poked coordinate is already visible before any redraw');
    assert.equal(scrollY(nes), 60);

    // Force a redraw_screen: tap interact, which runs the scripted Warp
    // synchronously (script_op_warp only arms warp_ready this frame -- see
    // CLAUDE.md's own two-phase warp protocol); the following frame's
    // settle_owed calls take_door, which is what actually calls
    // redraw_screen and its own enable_rendering.
    nes.buttonDown(1, B);
    nes.frame();
    nes.buttonUp(1, B);
    run(nes, 1); // settle_owed -> take_door -> redraw_screen -> enable_rendering

    // enable_rendering (engine/boot.asm) is unconditional mainline code,
    // untouched by phase 1: it always resets the scroll to (0,0) the instant
    // it re-enables rendering, exactly as it did before the camera existed.
    // This is the one partial frame the picture is visible before this
    // redraw's own pending NMI has run -- not a camera regression, since
    // nothing in phase 1 makes a redraw camera-aware (that is phase 2's
    // consumer).
    assert.equal(scrollX(nes), 0, 'enable_rendering\'s own reset is unconditional mainline code, unchanged by phase 1');
    assert.equal(scrollY(nes), 0);

    // The very next vblank -- an NMI landing after the redraw -- must
    // recover the published coordinate: nmi_scroll's own unconditional,
    // every-vblank write is exactly what stops a screen transition from
    // leaving the picture stuck on whatever mainline code last wrote.
    run(nes, 1);
    assert.equal(scrollX(nes), 256 + 40, 'the redraw must not leave nmi_scroll stuck on (0,0)');
    assert.equal(scrollY(nes), 60);

    run(nes, 3);
    assert.equal(scrollX(nes), 256 + 40, 'and it stays recovered -- not merely a one-frame coincidence');
    assert.equal(scrollY(nes), 60);
  }
);

// ------------------------------------------------------------- 5. nmi_tmp

test(
  'the Shake+camera composition uses nmi_tmp, never mainline <tmp',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes, addrOf } = await buildWith(t, { camera: true, commands: DUMMY_SHAKE });

    // Isolate nmi_scroll's own composition from everything else a real frame
    // touches (a full nes.frame() also runs music_tick, probe_type and other
    // mainline consumers of <tmp, which would clobber the sentinel for
    // reasons having nothing to do with the camera and make this assertion
    // meaningless). nmi_scroll has no `rts` of its own -- it falls through
    // into split_arm/frame_cnt/rti -- so this steps the CPU directly from
    // nmi_scroll to nmi_scroll_done rather than reusing callRoutine's
    // JSR/rts stub, which assumes a routine that returns.
    const nmiScroll = addrOf('nmi_scroll');
    const nmiScrollDone = addrOf('nmi_scroll_done');

    nes.cpu.mem[CAM_X_LO] = 100;
    nes.cpu.mem[CAM_Y_LO] = 20;
    nes.cpu.mem[CAM_NT] = 0;
    nes.cpu.mem[CAM_DIRTY] = 0;
    nes.cpu.mem[TMP] = 0xab; // sentinel
    nes.cpu.mem[SHAKE_LEFT] = 1; // the +2 phase
    runToLabel(nes, nmiScroll, nmiScrollDone);

    assert.equal(nes.cpu.mem[TMP], 0xab, 'tmp must be untouched by the composition');
    assert.equal(nes.cpu.mem[NMI_TMP], 102, 'nmi_tmp must hold the composed low byte (100 + 2)');
  }
);

// ======================================================================
// Phase 2: candidate (b), the screen-edge slide (docs/design-camera.md §7)
// ======================================================================

/**
 * Triggers a genuine NMI (the vendored core's own 0-delay `nmiImmediate`
 * path, `renderer/emulator/core/cpu.js`'s `emulate()`: setting it and
 * calling `emulate()` once services a full `doNonMaskableInterrupt` --
 * pushes P and the real PC, jumps to the vector -- with no instruction
 * executed first), then steps until control genuinely returns to
 * `pausedPC` via the ROM's own `rti`. docs/design-camera.md §6: the
 * publication lock covers `nmi_scroll`'s whole read-and-compose of
 * cam_x_lo/y_lo/nt, not merely its own trailing store, so invoking
 * `nmi_scroll` alone and reading only snapshot RAM cannot catch a mutant
 * that keeps the snapshot right but skips the PPU writes while dirty --
 * only a real interrupt entry/exit, checked against the real PPU state
 * afterward, can.
 */
function triggerRealNmi(nes, pausedPC, budget = 20000) {
  nes.cpu.nmiImmediate = true;
  nes.cpu.emulate(); // services the interrupt entry itself -- 0 instructions executed first
  let steps = 0;
  while (nes.cpu.REG_PC !== pausedPC) {
    nes.cpu.emulate();
    assert.ok(++steps < budget, 'the real NMI never returned to the interrupted instruction');
  }
}

/**
 * Instruction-stepped through one wrap tick: drives real frames to the tick
 * just before the wrap (or, for the UP direction, stops right after the
 * arm, before any tick, for a wrap that lands on the FIRST tick), then
 * steps camera_slide_tick by hand to prove the publication lock (cam_dirty
 * raised BEFORE the coordinate store, a torn-window NMI still reads the
 * pre-tick snapshot AND the real PPU registers, and the very next NMI
 * after release reads the new ones) -- design-camera.md §7's own
 * "Publication: NMI mid-wrap" row. `coordAddr` is CAM_X_LO or CAM_Y_LO,
 * `coordBefore`/`coordAfter` the pre/post-wrap values, `ntBefore`/`ntAfter`
 * the pre/post nametable index. The OTHER axis's own resting coordinate
 * (never touched by this tick) is read once, up front, since it is needed
 * to compute the exact expected scrollX/scrollY at each boundary.
 */
function assertWrapTickPublicationLock(nes, addrOf, { coordAddr, nmiCoordAddr, coordBefore, coordAfter, ntBefore, ntAfter }) {
  const cameraSlideTick = addrOf('camera_slide_tick');
  const restX = nes.cpu.mem[CAM_X_LO];
  const restY = nes.cpu.mem[CAM_Y_LO];
  const xBefore = coordAddr === CAM_X_LO ? coordBefore : restX;
  const yBefore = coordAddr === CAM_Y_LO ? coordBefore : restY;
  const xAfter = coordAddr === CAM_X_LO ? coordAfter : restX;
  const yAfter = coordAddr === CAM_Y_LO ? coordAfter : restY;
  const expectScroll = (nt, x, y) => ({ x: ((nt & 1) * 256 + x) & 511, y: (nt >> 1) * 240 + y });

  // Step from camera_slide_tick's own entry until cam_dirty flips 0 -> 1 --
  // that transition happens on the instruction right after `inc <cam_dirty>`,
  // i.e. BEFORE the coordinate's own store (design-camera.md §6, "A
  // publication lock that only covers the second of two stores is not a
  // lock" -- the ordering requirement camera_slide_tick's own publication
  // lock depends on).
  nes.mmap.write(0x2000, 0); // NMI generation off while hand-stepping to the boundary
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.REG_PC = cameraSlideTick - 1;
  let steps = 0;
  while (true) {
    const before = nes.cpu.mem[CAM_DIRTY];
    nes.cpu.emulate();
    steps++;
    if (before === 0 && nes.cpu.mem[CAM_DIRTY] === 1) break;
    assert.ok(steps < 2000, 'cam_dirty was never raised');
  }
  assert.equal(nes.cpu.mem[coordAddr], coordBefore, 'the raise happens one instruction BEFORE the coordinate store: coord must still read the pre-tick value here');
  assert.equal(nes.cpu.mem[CAM_NT], ntBefore, 'nt must still read the pre-tick value at the raise');

  // One more instruction: the coordinate's own wrapped store.
  nes.cpu.emulate();
  assert.equal(nes.cpu.mem[coordAddr], coordAfter, 'the coordinate must already show its wrapped value right after its own store');
  assert.equal(nes.cpu.mem[CAM_DIRTY], 1, 'cam_dirty must still be raised right after the coordinate store -- the toggle has not run yet');

  // The TRUE resume point -- captured before any callRoutine call, which
  // hijacks PC via its own JSR/NOP stub and does not restore the caller's
  // context on return.
  const pausedPC = nes.cpu.REG_PC;
  const pausedA = nes.cpu.REG_ACC;
  const pausedX = nes.cpu.REG_X;
  const pausedY = nes.cpu.REG_Y;
  const pausedP = nes.cpu.getStatus();

  // A deliberately disruptive packet: opened at $2700, a real nametable
  // address unrelated to any camera write, so THIS NMI's own drain issues
  // real $2006 writes that move the PPU's addressing state before
  // nmi_scroll ever runs -- the exact condition "$2000 rewritten after the
  // drain, not before" (CLAUDE.md) exists for.
  nes.cpu.REG_ACC = 0x27;
  nes.cpu.REG_Y = 0x00;
  callRoutine(nes, addrOf('vram_open'));
  nes.cpu.REG_ACC = 0xaa;
  callRoutine(nes, addrOf('vram_push'));
  callRoutine(nes, addrOf('vram_end'));
  nes.cpu.mem[VRAM_READY] = 1;
  // Restore the true resume point and every register callRoutine's own
  // stub-call sequence clobbered -- the packet setup is not part of the
  // interrupted instruction stream.
  nes.cpu.REG_PC = pausedPC;
  nes.cpu.REG_ACC = pausedA;
  nes.cpu.REG_X = pausedX;
  nes.cpu.REG_Y = pausedY;
  nes.cpu.setStatus(pausedP);

  // The torn-window NMI: cam_nt has NOT been toggled yet, so the real PPU
  // registers (not merely the snapshot RAM) must still hold the complete
  // PRE-tick coordinate, never a torn mix of the new coordinate and the
  // old nt, never (0,0), and never the drain's own disruptive address.
  triggerRealNmi(nes, pausedPC);
  assert.equal(nes.cpu.REG_ACC, pausedA, 'A must be restored exactly by the real rti/pla sequence');
  assert.equal(nes.cpu.REG_X, pausedX, 'X must be restored exactly');
  assert.equal(nes.cpu.REG_Y, pausedY, 'Y must be restored exactly');
  assert.equal(nes.cpu.getStatus(), pausedP, 'P must be restored exactly by rti');
  assert.equal(nes.cpu.mem[nmiCoordAddr], coordBefore, 'a torn wrap must never publish: the snapshot must hold the pre-tick coordinate');
  assert.equal(nes.cpu.mem[NMI_CAM_NT], ntBefore, 'a torn wrap must never publish: the snapshot must hold the pre-tick nt');
  {
    const want = expectScroll(ntBefore, xBefore, yBefore);
    assert.equal(nes.cpu.mem[0x2000] & 0x03, ntBefore & 0x03, 'a torn wrap must never publish: PPUCTRL nametable bits must hold the pre-tick nt, not (0,0) and not the drain\'s own address');
    assert.equal(scrollX(nes), want.x, 'a torn wrap must never publish: the real PPU scrollX must hold the pre-tick coordinate');
    assert.equal(scrollY(nes), want.y, 'a torn wrap must never publish: the real PPU scrollY must hold the pre-tick coordinate');
  }

  // Resume: step until the nt toggle runs and cam_dirty is released.
  let resumeSteps = 0;
  while (nes.cpu.mem[CAM_DIRTY] !== 0) {
    nes.cpu.emulate();
    assert.ok(++resumeSteps < 50, 'cam_dirty was never released');
  }
  assert.equal(nes.cpu.mem[CAM_NT], ntAfter, 'cam_nt must show the toggled value once cam_dirty releases');

  // The next NMI, still a real interrupt entry/exit: must now publish the
  // new, complete coordinate on the PPU itself, not merely in snapshot RAM.
  const releasedPC = nes.cpu.REG_PC;
  triggerRealNmi(nes, releasedPC);
  assert.equal(nes.cpu.mem[nmiCoordAddr], coordAfter, 'once released, the very next NMI must publish the new coordinate');
  assert.equal(nes.cpu.mem[NMI_CAM_NT], ntAfter, 'once released, the very next NMI must publish the new nt');
  {
    const want = expectScroll(ntAfter, xAfter, yAfter);
    assert.equal(nes.cpu.mem[0x2000] & 0x03, ntAfter & 0x03, 'once released, PPUCTRL nametable bits must show the new nt');
    assert.equal(scrollX(nes), want.x, 'once released, the real PPU scrollX must show the new coordinate');
    assert.equal(scrollY(nes), want.y, 'once released, the real PPU scrollY must show the new coordinate');
  }
}

// ---------------------------------- 1. Instruction-stepped publication lock

test(
  'a torn wrap update is never published: horizontal wrap (right), instruction-stepped',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes, addrOf } = await buildSlide(t); // default vertical mirroring -> H axis
    crossEdge(nes, 7, { playerX: MAX_X, playerY: 96 }); // Right
    for (let i = 0; i < 25 && nes.cpu.mem[CAM_SLIDE_LEFT] !== 1; i++) nes.frame();
    assert.equal(nes.cpu.mem[CAM_SLIDE_LEFT], 1, 'never reached the last (wrapping) tick');
    assertWrapTickPublicationLock(nes, addrOf, {
      coordAddr: CAM_X_LO,
      nmiCoordAddr: NMI_CAM_X_LO,
      coordBefore: 240,
      coordAfter: 0,
      ntBefore: 0,
      ntAfter: 1
    });
  }
);

test(
  'a torn wrap update is never published: vertical wrap (down), instruction-stepped',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes, addrOf } = await buildSlide(t, { mirroring: 'horizontal' }); // V axis
    crossEdge(nes, 5, { playerX: 112, playerY: MAX_Y }); // Down
    for (let i = 0; i < 25 && nes.cpu.mem[CAM_SLIDE_LEFT] !== 1; i++) nes.frame();
    assert.equal(nes.cpu.mem[CAM_SLIDE_LEFT], 1, 'never reached the last (wrapping) tick');
    assertWrapTickPublicationLock(nes, addrOf, {
      coordAddr: CAM_Y_LO,
      nmiCoordAddr: NMI_CAM_Y_LO,
      coordBefore: 225,
      coordAfter: 0,
      ntBefore: 0,
      ntAfter: 2
    });
  }
);

test(
  'a torn wrap update is never published: vertical wrap (up), instruction-stepped -- the FIRST tick, which borrows immediately',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes, addrOf } = await buildSlide(t, { mirroring: 'horizontal' }); // V axis
    // Cross down first to reach screen 2, then cross back up -- the FIRST
    // tick of an UP slide wraps immediately (0 - 15 already borrows), so
    // this test intercepts right after the arm, before any tick has run.
    crossEdge(nes, 5, { playerX: 112, playerY: MAX_Y }); // Down, to screen 2
    for (let i = 0; i < 25 && nes.cpu.mem[CAM_SLIDE_LEFT] !== 0; i++) nes.frame();
    nes.buttonUp(1, 5);
    run(nes, 3);
    crossEdge(nes, 4, { playerX: 112, playerY: 0 }); // Up, back to screen 0
    assert.equal(nes.cpu.mem[CAM_SLIDE_LEFT], 16, 'the arm must land here with no tick run yet');
    assertWrapTickPublicationLock(nes, addrOf, {
      coordAddr: CAM_Y_LO,
      nmiCoordAddr: NMI_CAM_Y_LO,
      coordBefore: 0,
      coordAfter: 225,
      ntBefore: 0,
      ntAfter: 2
    });
  }
);

// -------------------------------------------------- 2. Literal first visible frame

/**
 * Runs exactly one real game frame (nes.frame()'s own body, reproduced
 * rather than called, per CLAUDE.md's own precedent of stepping a routine
 * directly rather than through a stub that assumes it returns) but stops the
 * instant $2001 receives a NEW write, mid-frame -- catching the precise
 * instruction boundary "the instant rendering turns on," which
 * `nes.frame()`'s own all-or-nothing return cannot. NMI generation and
 * every other real timing stays exactly as ordinary play would leave it
 * (unlike runToLabel's own hand-stepping helpers above, which deliberately
 * disable NMI to control the exact moment of a synthetic interrupt) -- a
 * real NMI landing before the mask write is exactly the second half of this
 * row's own "with/without an NMI landing first" ask.
 */
function driveToMaskWrite(nes, maxFrameBoundaries = 25, maxSteps = 400000) {
  // Two-phase watch: a redraw's own forced-blank clear (bits 0x18 both 0)
  // must be seen FIRST, or gameplay's already-steady mask-on state (from
  // before this call) would trivially satisfy "bits 0x18 set" on step one --
  // this is specifically the blank -> on TRANSITION a redraw performs, not
  // merely "rendering is currently on". Held across however many real
  // frame() boundaries the crossing frame's own forced-blank draw actually
  // spans (redraw_screen_slide can poll past more than one PPU-frame-
  // boundary while NMI stays suppressed) -- never reset mid-search, unlike
  // one call per real frame would.
  let sawBlank = false;
  let lastMask = nes.cpu.mem[0x2001];
  let steps = 0;
  let frameBoundaries = 0;
  nes.controllers[1].clock();
  nes.controllers[2].clock();
  nes.ppu.startFrame();
  for (;;) {
    if (nes.cpu.cyclesToHalt === 0) {
      const cycles = nes.cpu.emulate();
      nes.papu.clockFrameCounter(cycles, nes.cpu.apuCatchupCycles);
      nes.cpu.apuCatchupCycles = 0;
    } else {
      const chunk = Math.min(nes.cpu.cyclesToHalt, 8);
      for (let i = 0; i < chunk; i++) nes.ppu.advanceDots(3);
      nes.papu.clockFrameCounter(chunk);
      nes.cpu.cyclesToHalt -= chunk;
      nes.cpu._cpuCycleBase += chunk;
    }
    const mask = nes.cpu.mem[0x2001];
    if (mask !== lastMask) {
      if ((mask & 0x18) === 0) sawBlank = true;
      else if (sawBlank && (mask & 0x18) === 0x18) break;
      lastMask = mask;
    }
    assert.ok(++steps < maxSteps, 'never observed a blank -> mask-on transition');
    if (nes.ppu.frameEnded) {
      nes.ppu.frameEnded = false;
      assert.ok(++frameBoundaries < maxFrameBoundaries, 'never observed a blank -> mask-on transition within the frame budget');
      nes.controllers[1].clock();
      nes.controllers[2].clock();
    }
  }
  return {
    scrollX: scrollX(nes),
    scrollY: scrollY(nes),
    ppuctrlNt: nes.cpu.mem[0x2000] & 0x03,
    mask: nes.cpu.mem[0x2001]
  };
}

test(
  'the coordinate lands on the PPU before rendering turns on, both at arm and at completion',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildSlide(t);

    // Establish a stale, non-vacuous scroll before crossing -- the very
    // next real NMI (nmi_scroll, phase 1) republishes it every vblank, so
    // this is demonstrably on the PPU, not merely written and forgotten.
    // Kept THROUGH the crossing (never pre-cleared): a pre-clear here would
    // make the arm's own `sta <cam_x_lo` (engine/camera.asm) deletable
    // without this test failing, since there would be nothing stale left
    // for a missing reset to fail to overwrite.
    nes.cpu.mem[CAM_X_LO] = 100;
    nes.cpu.mem[CAM_Y_LO] = 60;
    nes.cpu.mem[CAM_NT] = 1;
    run(nes, 1);
    assert.equal(scrollX(nes), 356, 'sanity: the stale coordinate is really on screen before the crossing'); // nt=1 -> 256+100
    assert.equal(scrollY(nes), 60);

    // Drive right up to the crossing threshold, then step the arm's own
    // draw+publish sequence, frame by frame, stopping at the exact
    // blank -> mask-on transition redraw_screen_slide's own tail performs.
    nes.cpu.mem[PLAYER_X] = MAX_X;
    nes.cpu.mem[PLAYER_Y] = 96;
    nes.buttonDown(1, 7);
    const at = driveToMaskWrite(nes);
    // The arm's own RAM reset (engine/camera.asm's `lda #0; sta cam_x_lo;
    // sta cam_y_lo; sta cam_nt`), not only the PPU write it happens to
    // precede -- the same "assert the RAM byte directly" strengthening
    // completion's own assertions below already use, here on the arm side.
    assert.equal(nes.cpu.mem[CAM_X_LO], 0, 'cam_x_lo must be reset by the arm, not merely left stale until a later tick overwrites it');
    assert.equal(nes.cpu.mem[CAM_Y_LO], 0, 'cam_y_lo must be reset by the arm');
    assert.equal(nes.cpu.mem[CAM_NT], 0, 'cam_nt must be reset by the arm');
    assert.equal(at.scrollX, 0, 'the arm publishes (0,0) BEFORE turning rendering on -- never the stale (100, nt 1)');
    assert.equal(at.scrollY, 0);
    assert.equal(at.ppuctrlNt, 0, 'nametable-select bits must already be 0 at the same instant');
    assert.equal(at.mask & 0x18, 0x18, 'sanity: this really was the mask-on write');

    // The published coordinate must survive the first real NMI after it --
    // not merely correct for one instant.
    nes.mmap.write(0x2000, at.ppuctrlNt | 0x88);
    run(nes, 1);
    assert.equal(scrollX(nes), 0, 'the coordinate must still read (0,0) after the first real NMI following the arm');
    assert.equal(scrollY(nes), 0);

    // Drive the rest of the slide and dissect completion's own tail the
    // identical way -- at ITS $2001 write, the PPU must already show true
    // (0,0,nt 0), not the mid-slide (0,0,nt 1) the last tick left.
    for (let i = 0; i < 25 && nes.cpu.mem[CAM_SLIDE_LEFT] > 1; i++) nes.frame();
    assert.equal(nes.cpu.mem[CAM_SLIDE_LEFT], 1, 'never reached the last tick');
    const atComplete = driveToMaskWrite(nes);
    assert.equal(atComplete.scrollX, 0, 'completion publishes true (0,0) BEFORE turning rendering back on');
    assert.equal(atComplete.scrollY, 0);
    assert.equal(atComplete.ppuctrlNt, 0, 'completion must land on nametable 0, never the mid-slide nt 1 the last tick left');
    // The $2000 write above derives its nametable bits from A (still 0 from
    // `lda #0` a few instructions earlier), not from reading cam_nt back --
    // so a dropped `sta <cam_nt` would leave THIS instant's PPU write
    // looking correct while the RAM byte itself stays stale at the
    // mid-slide 1, corrupting only the NEXT NMI's own composition. Assert
    // the RAM byte directly, not only the PPU write it happens to precede.
    assert.equal(nes.cpu.mem[CAM_NT], 0, 'cam_nt itself must be reset, not merely the PPU write that read a stale A instead of it');
    nes.buttonUp(1, 7);
  }
);

// -------------------------------------------------------- 3. World frozen every tick

test(
  'the slide, tick by tick: 16 frames, the world frozen throughout, horizontal (right)',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildSlide(t);
    const playerY = nes.cpu.mem[PLAYER_Y];
    crossEdge(nes, 7, { playerX: MAX_X, playerY }); // Right
    assert.equal(nes.cpu.mem[CAM_SLIDE_DIR], DIR_RIGHT);
    assert.equal(nes.cpu.mem[CAM_FAR], 1);
    // The arm frame itself (inside crossEdge) sets cam_slide_left=16 without
    // ticking it -- main_loop's own gate is checked at the TOP of the frame,
    // before update_player ever reaches cross_right, so the arm frame and
    // the first tick are never the same frame. One settle frame separates
    // them (verified empirically, not assumed): cam_slide_left still reads
    // 16 here, unmoved.
    run(nes, 1);
    assert.equal(nes.cpu.mem[CAM_SLIDE_LEFT], 16, 'the settle frame right after the arm must not have ticked yet');
    // The "frozen" baseline is taken AFTER the arm: spawn_entities legitimately
    // replaces ent_x/ent_y with the INCOMING screen's own actors once, at arm
    // time (design-camera.md §3) -- what must never change again is THIS
    // array, across all 16 ticks, not the outgoing screen's array from before
    // the crossing.
    const before = {
      gameState: nes.cpu.mem[GAME_STATE],
      encStep: nes.cpu.mem[ENC_STEP],
      entX: [...nes.cpu.mem.slice(ENT_X, ENT_X + 8)],
      entY: [...nes.cpu.mem.slice(ENT_Y, ENT_Y + 8)]
    };
    // Hold Right plus B (interact) through the whole slide -- the frozen-world
    // gate blocks dispatch_input entirely, so this must do nothing.
    nes.buttonDown(1, B);
    for (let k = 1; k <= 16; k++) {
      run(nes, 1);
      assert.equal(nes.cpu.mem[CAM_SLIDE_LEFT], 16 - k, `tick ${k}: cam_slide_left`);
      if (k < 16) {
        assert.equal(nes.cpu.mem[CAM_X_LO], 16 * k, `tick ${k}: cam_x_lo`);
        assert.equal(nes.cpu.mem[CAM_NT], 0, `tick ${k}: cam_nt`);
      } else {
        assert.equal(nes.cpu.mem[CAM_X_LO], 0, 'tick 16: cam_x_lo wraps to 0');
        assert.equal(nes.cpu.mem[CAM_NT], 1, 'tick 16: cam_nt flips to 1');
      }
      // Frozen world: nothing the ordinary per-frame updates would touch
      // may move, on any of the 16 ticks.
      assert.equal(nes.cpu.mem[PLAYER_Y], playerY, `tick ${k}: player_y must not move`);
      assert.equal(nes.cpu.mem[GAME_STATE], before.gameState, `tick ${k}: game_state must not change`);
      assert.equal(nes.cpu.mem[ENC_STEP], before.encStep, `tick ${k}: enc_step must not advance`);
      assert.deepEqual([...nes.cpu.mem.slice(ENT_X, ENT_X + 8)], before.entX, `tick ${k}: no entity may move`);
      assert.deepEqual([...nes.cpu.mem.slice(ENT_Y, ENT_Y + 8)], before.entY, `tick ${k}: no entity may move`);
      assert.equal(nes.cpu.mem[BOX_STATE], 0, `tick ${k}: no box may open`);
    }
    // The completion frame: (0,0,0), pending cleared. cam_slide_b_pending
    // clears BEFORE camera_slide_complete_b is even called (source order),
    // so it reaching 0 does not by itself mean the completion draw has
    // finished -- wait for cam_nt itself, the one byte only completion's own
    // tail ever sets back to 0.
    for (let i = 0; i < 10 && nes.cpu.mem[CAM_NT] !== 0; i++) run(nes, 1);
    assert.equal(nes.cpu.mem[CAM_X_LO], 0);
    assert.equal(nes.cpu.mem[CAM_Y_LO], 0);
    assert.equal(nes.cpu.mem[CAM_NT], 0);
    assert.equal(nes.cpu.mem[CAM_SLIDE_B_PENDING], 0);
    nes.buttonUp(1, 7);
    nes.buttonUp(1, B);
  }
);

test(
  'the slide, tick by tick: vertical twin on the horizontal-mirroring fixture (down, then up)',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildSlide(t, { mirroring: 'horizontal' });
    crossEdge(nes, 5, { playerX: 112, playerY: MAX_Y }); // Down
    assert.equal(nes.cpu.mem[CAM_SLIDE_DIR], DIR_DOWN);
    assert.equal(nes.cpu.mem[CAM_FAR], 2);
    run(nes, 1); // the same one-frame settle the horizontal test documents
    for (let k = 1; k <= 16; k++) {
      run(nes, 1);
      if (k < 16) {
        assert.equal(nes.cpu.mem[CAM_Y_LO], 15 * k, `down tick ${k}: cam_y_lo`);
        assert.equal(nes.cpu.mem[CAM_NT], 0, `down tick ${k}: cam_nt`);
      } else {
        assert.equal(nes.cpu.mem[CAM_Y_LO], 0, 'down tick 16: cam_y_lo wraps to 0');
        assert.equal(nes.cpu.mem[CAM_NT], 2, 'down tick 16: cam_nt flips to 2');
      }
    }
    nes.buttonUp(1, 5);
    for (let i = 0; i < 10 && nes.cpu.mem[CAM_NT] !== 0; i++) run(nes, 1);
    run(nes, 3);

    // Cross back up: the FIRST tick already wraps (0 - 15 borrows).
    crossEdge(nes, 4, { playerX: 112, playerY: 0 }); // Up
    assert.equal(nes.cpu.mem[CAM_SLIDE_DIR], DIR_UP);
    run(nes, 1); // the same one-frame settle the horizontal test documents
    const expectedY = [225, 210, 195, 180, 165, 150, 135, 120, 105, 90, 75, 60, 45, 30, 15, 0];
    for (let k = 1; k <= 16; k++) {
      run(nes, 1);
      assert.equal(nes.cpu.mem[CAM_Y_LO], expectedY[k - 1], `up tick ${k}: cam_y_lo`);
      assert.equal(nes.cpu.mem[CAM_NT], 2, `up tick ${k}: cam_nt stays toggled the whole slide (only one wrap, on tick 1)`);
    }
    nes.buttonUp(1, 4);
  }
);

// -------------------------------------------------- 4. Axis gate and fallbacks

/**
 * A cut: no slide state ever moves, flat_screen changes in one frame (the
 * crossing stub's own `sta <flat_screen>` runs before the long draw, the
 * same "flat_screen changes immediately, drawing takes longer" shape a
 * slide's own arm has), and the PPU is at rest once the redraw's own
 * (unrelated to camera) draw has actually finished -- an ordinary
 * redraw_screen's ~1000 $2007 writes can themselves span more than one
 * nes.frame() call in this stepping model (the identical reason
 * camera_slide_complete_b needs a settle wait above), so this polls for
 * enable_rendering's own mask-on write rather than assuming one frame is
 * enough.
 */
function assertCut(nes, framesBefore) {
  assert.equal(nes.cpu.mem[CAM_SLIDE_LEFT], 0, 'a cut must never arm a slide');
  assert.equal(framesBefore, 1, 'flat_screen must change in a single frame, exactly like today\'s cut');
  for (let i = 0; i < 10 && (nes.cpu.mem[0x2001] & 0x18) !== 0x18; i++) run(nes, 1);
  assert.equal(nes.cpu.mem[0x2001] & 0x18, 0x18, 'the redraw never finished turning rendering back on');
  run(nes, 1); // let nmi_scroll republish once more, settled
  assert.equal(scrollX(nes), 0, 'a cut must leave the PPU at rest');
  assert.equal(scrollY(nes), 0);
}

test(
  'default vertical mirroring: a vertical crossing cuts (CAMERA_SLIDE_V is 0)',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildSlide(t); // default vertical mirroring
    const frames = crossEdge(nes, 5, { playerX: 112, playerY: MAX_Y }); // Down
    assertCut(nes, frames);
  }
);

test(
  'horizontal mirroring: a horizontal crossing cuts (CAMERA_SLIDE_H is 0)',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildSlide(t, { mirroring: 'horizontal' });
    const frames = crossEdge(nes, 7, { playerX: MAX_X, playerY: 96 }); // Right
    assertCut(nes, frames);
  }
);

test(
  'UNROM 512 four-screen: both axes slide',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const rightNes = (await buildSlide(t, { mapperId: 30, mirroring: 'fourscreen' })).nes;
    crossEdge(rightNes, 7, { playerX: MAX_X, playerY: 96 }); // Right
    assert.notEqual(rightNes.cpu.mem[CAM_SLIDE_LEFT], 0, 'the horizontal axis must slide on four-screen');

    const downNes = (await buildSlide(t, { mapperId: 30, mirroring: 'fourscreen' })).nes;
    crossEdge(downNes, 5, { playerX: 112, playerY: MAX_Y }); // Down
    assert.notEqual(downNes.cpu.mem[CAM_SLIDE_LEFT], 0, 'the vertical axis must slide on four-screen too');
  }
);

test(
  'a tileset mismatch on the live axis cuts, and the crossing still happens',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    // Tileset is a MAP-level field (map.tilesetId, screen_tileset emitted
    // once per map and repeated for every screen in it -- main/build/
    // generate.js's flattenScreens), and screen_left/right/up/down never
    // cross a map boundary -- so two screens genuinely adjacent via a
    // cross_* edge always share one map and therefore, today, always share
    // one tileset. A real mismatch is consequently not reachable through the
    // schema at all; it is reachable only the way the engine itself sees
    // it -- the generated screen_tileset table -- so this test patches that
    // one generated byte directly, the same test-only "patch a mkdtemp build
    // directory" technique the kernel-lo ledger test uses for
    // CAMERA_SLIDE_ENABLED (Decision 8), proving cross_right's own
    // `cmp screen_tileset,x` fallback exactly as written, independent of
    // whether any current authoring path can reach it.
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-camera-mismatch-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE);
    project.cartridge.camera = true;
    project.cartridge.mapper = 1; // MMC1 -- NROM (the default) holds only one tileset at all
    project.tilesets.push(createTileset(1, 'Other'));
    await saveProject(dir, project);
    const { buildDir } = await generateAssets({ dir, project, log: () => {} });
    const mapsIncPath = path.join(buildDir, 'assets', 'maps.inc');
    let mapsInc = await fs.promises.readFile(mapsIncPath, 'utf8');
    const m = /^screen_tileset:\n {2}\.db (.+)$/m.exec(mapsInc);
    assert.ok(m, 'screen_tileset table not found in generated maps.inc');
    const bytes = m[1].split(',');
    assert.equal(bytes[1], '$00', 'sanity: screen 1 (the H-axis right neighbour of screen 0) starts on tileset 0');
    bytes[1] = '$01'; // screen 1 alone now names the second tileset
    mapsInc = mapsInc.replace(m[0], `screen_tileset:\n  .db ${bytes.join(',')}`);
    await fs.promises.writeFile(mapsIncPath, mapsInc);
    const result = await runNesasm({ cwd: buildDir, source: 'main.asm' });
    assert.ok(result.ok, `patched build failed to assemble: ${JSON.stringify(result.errors)}`);
    const nes = boot(result.romPath);

    const frames = crossEdge(nes, 7, { playerX: MAX_X, playerY: 96 }); // Right
    assertCut(nes, frames);
    assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the crossing itself must still happen, just as a hard cut');
  }
);

// ------------------------------------------------------ 5. Nametable content

/** A nametable's own raw 960 tile bytes + 64 attribute bytes, read at its OWN
 *  address range ($2000+nt*0x400) rather than through the PPU's mirroring
 *  translation -- what was actually WRITTEN to that specific nametable
 *  slot, which is exactly what draw_screen_at's own $2006/$2007 writes
 *  target. The same raw-address technique test/unit/cartridge.test.js
 *  already uses for nametable 0. */
function readNametableRaw(nes, nt) {
  const base = 0x2000 + nt * 0x400;
  const tileBytes = Array.from({ length: 960 }, (_, i) => nes.ppu.vramMem[base + i]);
  const attrBytes = Array.from({ length: 64 }, (_, i) => nes.ppu.vramMem[base + 0x3c0 + i]);
  return { tileBytes, attrBytes };
}

test(
  'nametable content: the far nametable matches the incoming screen, nametable 0 matches the outgoing one, then the incoming one after completion',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes, project } = await buildSlide(t);
    const outgoingRef = referenceNametable(project, project.maps[0].screens[0]);
    const incomingRef = referenceNametable(project, project.maps[0].screens[1]);

    const nt0Before = readNametableRaw(nes, 0);
    assert.deepEqual(nt0Before, outgoingRef, 'sanity: nametable 0 already matches the outgoing screen before crossing');

    crossEdge(nes, 7, { playerX: MAX_X, playerY: 96 }); // Right, arms the slide

    const farAfterArm = readNametableRaw(nes, 1); // cam_far == 1 for a horizontal crossing
    assert.deepEqual(farAfterArm, incomingRef, 'after the arming frame, the far nametable must match the incoming screen');
    const nt0AfterArm = readNametableRaw(nes, 0);
    assert.deepEqual(nt0AfterArm, outgoingRef, 'nametable 0 must still be the outgoing screen -- it is never touched during the arm');

    // Drive the slide to completion, then nametable 0 must match the incoming screen.
    for (let i = 0; i < 25 && nes.cpu.mem[CAM_SLIDE_LEFT] !== 0; i++) run(nes, 1);
    assert.equal(nes.cpu.mem[CAM_SLIDE_LEFT], 0, 'the slide never completed its 16 ticks');
    for (let i = 0; i < 10 && nes.cpu.mem[CAM_NT] !== 0; i++) run(nes, 1);
    assert.equal(nes.cpu.mem[CAM_NT], 0, 'the completion redraw never finished');
    const nt0AfterComplete = readNametableRaw(nes, 0);
    assert.deepEqual(nt0AfterComplete, incomingRef, 'after completion, nametable 0 must match the incoming screen');
    nes.buttonUp(1, 7);
  }
);

// -------------------------------------------------------- 6. Arming frame stops

test(
  'the arming frame stops: no second-axis movement, no hazard, no wandering-encounter step',
  { skip: !fs.existsSync(path.join(SAMPLE_RPG_MMC1, 'build/game.nes')) && 'run `npm run build:sample:rpg` first' },
  async (t) => {
    const { nes } = await buildRpgSlide(t, {
      mutate: (project) => {
        // A wandering-encounter step able to fire the instant check_encounter
        // runs -- rate 1 means the very first counted step reaches it.
        project.maps[0].encounters = { rate: 1, actorIds: [0, 0, 0, 0] };
        // A hazard on the landing square (screen 1's own cell 112 -- col 0,
        // row 7, exactly where the player lands after crossing right from
        // (112,112)) that would cost a hit the instant player_hazard ran.
        project.metatiles[project.maps[0].screens[1].metatiles[112]].collision = 'damage';
      }
    });
    const encStepBefore = nes.cpu.mem[ENC_STEP];
    const pcHpBefore = nes.cpu.mem[PC_HP];
    nes.cpu.mem[PLAYER_X] = MAX_X;
    nes.cpu.mem[PLAYER_Y] = 112;
    // Hold both Right and Down -- update_player's own horizontal-then-vertical
    // order means only Right is ever evaluated on the arming frame, since
    // screen_fresh (set by spawn_entities inside redraw_screen_slide, before
    // update_player_vertical is ever reached) stops the frame there.
    nes.buttonDown(1, 7); // Right
    nes.buttonDown(1, 5); // Down
    nes.frame();
    assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the crossing must have happened this frame');
    assert.equal(nes.cpu.mem[PLAYER_X], 0, 'the horizontal axis landed');
    assert.equal(nes.cpu.mem[PLAYER_Y], 112, 'the vertical axis (Down) must never have been evaluated at all');
    assert.equal(nes.cpu.mem[SCREEN_FRESH], 1, 'screen_fresh must be set once cross_right returns (spawn_entities, inside redraw_screen_slide)');
    assert.equal(nes.cpu.mem[ENC_STEP], encStepBefore, 'check_encounter must never have run on the arming frame');
    assert.equal(nes.cpu.mem[PC_HP], pcHpBefore, 'player_hazard must never have run on the arming frame');
    nes.buttonUp(1, 7);
    nes.buttonUp(1, 5);
  }
);

// -------------------------------------------------- 7. Events settle after the slide

test(
  'the incoming screen\'s entry event never runs during the slide, only on the first ordinary frame after -- and first claim wins over a touch actor standing on the landing square',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const ENTRY_NPC = NPC + 1;
    const TOUCH_NPC = NPC + 2;
    // screen 1 already carries two entities (a door and an interact NPC) --
    // the two pushed here land in slots 2 and 3, once spawn_entities walks
    // them in order.
    const ENTRY_SLOT = 2;
    const TOUCH_SLOT = 3;
    const { nes } = await buildSlide(t, {
      mutate: (project) => {
        const slime = project.sprites.actors[0];
        project.sprites.actors.push({ ...structuredClone(slime), id: ENTRY_NPC, name: 'Greeter', behavior: 'npc' });
        project.sprites.actors.push({ ...structuredClone(slime), id: TOUCH_NPC, name: 'Toucher', behavior: 'npc' });
        assert.equal(project.maps[0].screens[1].entities.length, ENTRY_SLOT, 'sanity: screen 1 must carry exactly two entities before these are added');
        project.maps[0].screens[1].entities.push({
          actorId: ENTRY_NPC,
          x: 200,
          y: 200,
          props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 2 }] }] } }
        });
        // Standing exactly on the landing square (0, 96) -- where crossEdge
        // below lands the player after crossing right at playerY=96.
        project.maps[0].screens[1].entities.push({
          actorId: TOUCH_NPC,
          x: 0,
          y: 96,
          props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 3 }] }] } }
        });
      }
    });
    crossEdge(nes, 7, { playerX: MAX_X, playerY: 96 }); // Right, arms the slide + spawn_entities
    run(nes, 1); // settle frame

    // No dialogue may open on any of the 16 ticks or the completion frame,
    // and pending_ent must already name the ENTRY slot -- spawn_entities
    // (inside redraw_screen_slide, at arm time) claims it via arm_event
    // long before the world ever unfreezes, so the touch actor's own
    // contact detection (update_entities, which cannot run at all during
    // the frozen slide) never even gets a chance to compete for the claim.
    for (let k = 1; k <= 16; k++) {
      run(nes, 1);
      assert.equal(nes.cpu.mem[BOX_STATE], 0, `tick ${k}: no box may open (the entry event must not run yet)`);
      assert.equal(nes.cpu.mem[GAME_STATE], 0, `tick ${k}: game_state must stay ST_GAMEPLAY`);
      assert.equal(nes.cpu.mem[PENDING_ENT], ENTRY_SLOT, `tick ${k}: pending_ent must still name the entry slot -- first claim wins`);
    }
    // Completion, then a few settle frames -- pending_ent must still be
    // armed (not yet consumed) right up until settle_owed actually runs it.
    for (let i = 0; i < 10 && nes.cpu.mem[CAM_NT] !== 0; i++) run(nes, 1);
    assert.equal(nes.cpu.mem[PENDING_ENT], ENTRY_SLOT, `pending_ent must still name the entry actor (slot ${ENTRY_SLOT}) once the slide completes`);
    assert.equal(nes.cpu.mem[GAME_STATE], 0, 'still ST_GAMEPLAY the instant completion lands -- settle_owed has not run yet this frame');

    // The first ordinary frame after: settle_owed disarms pending_ent BEFORE
    // running the event body (CLAUDE.md's own two-phase rule). setSwitch
    // suspends nothing, so the whole event -- disarm, then run -- completes
    // within this one frame; switch 2 being set is the proof it actually ran.
    // Switch 3 (the touch actor's own) must NOT be set here: first claim
    // wins means the touch actor never preempts the entry event, on this
    // settlement frame or any frame up to it. (Standing on the touch
    // actor's own square is real, ongoing contact, so update_entities does
    // go on to arm ITS OWN, separate, legitimate touch event on a LATER
    // frame once the entry event has released pending_ent -- that is not a
    // race the entry lost, it is an independent contact event the player
    // never walked off of; this test does not run far enough to observe
    // it, since first claim wins is a claim about what happens up to and
    // including the entry's own settlement, not about touch never firing
    // at all.)
    assert.equal(nes.cpu.mem[SWITCHES] & (1 << 2), 0, 'sanity: switch 2 must not already be set before the entry event runs');
    assert.equal(nes.cpu.mem[SWITCHES] & (1 << 3), 0, 'sanity: switch 3 must not already be set');
    run(nes, 1);
    assert.equal(nes.cpu.mem[PENDING_ENT], NO_ENTITY, 'pending_ent must be disarmed once its event has started');
    assert.notEqual(nes.cpu.mem[SWITCHES] & (1 << 2), 0, 'the entry event must have run: switch 2 must now be set');
    assert.equal(nes.cpu.mem[SWITCHES] & (1 << 3), 0, 'the touch actor must not have fired: switch 3 must still be clear -- first claim wins');
    nes.buttonUp(1, 7);
  }
);

test(
  'a warp chain survives the slide\'s own settlement: the third screen\'s pending_ent/screen_fresh arrive intact',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const ENTRY_NPC = NPC + 1;
    const THIRD_NPC = NPC + 2;
    const ENTRY_SLOT = 2; // screen 1's own two existing entities, as above
    const THIRD_SCREEN = 2; // screen 0's own down neighbour -- untouched by this crossing
    const THIRD_SLOT = 3; // screen 2 already carries three entities of its own
    const WARP_TARGET_X = 112;
    const WARP_TARGET_Y = 112;
    const warpCommand = { op: 'warp', screen: THIRD_SCREEN, x: WARP_TARGET_X, y: WARP_TARGET_Y };
    const { nes } = await buildSlide(t, {
      mutate: (project) => {
        const slime = project.sprites.actors[0];
        project.sprites.actors.push({ ...structuredClone(slime), id: ENTRY_NPC, name: 'Warper', behavior: 'npc' });
        project.sprites.actors.push({ ...structuredClone(slime), id: THIRD_NPC, name: 'ThirdGreeter', behavior: 'npc' });
        project.maps[0].screens[1].entities.push({
          actorId: ENTRY_NPC,
          x: 200,
          y: 200,
          props: {
            trigger: 'enter',
            event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [warpCommand, { op: 'setSwitch', switch: 2 }] }] }
          }
        });
        // The third screen's own entry event -- proves its pending_ent/
        // screen_fresh really did arrive armed, not merely that flat_screen
        // changed.
        project.maps[0].screens[THIRD_SCREEN].entities.push({
          actorId: THIRD_NPC,
          x: 200,
          y: 200,
          props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 4 }] }] } }
        });
      }
    });
    crossEdge(nes, 7, { playerX: MAX_X, playerY: 96 }); // Right, arms the slide
    for (let i = 0; i < 25 && nes.cpu.mem[CAM_SLIDE_LEFT] !== 0; i++) run(nes, 1);
    for (let i = 0; i < 10 && nes.cpu.mem[CAM_NT] !== 0; i++) run(nes, 1);
    assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'still on the incoming screen the instant completion lands');

    // The settlement frame: settle_owed disarms pending_ent and runs the
    // entry event, whose first command (script_op_warp) only ARMS
    // warp_ready -- it does not itself change flat_screen (CLAUDE.md's own
    // two-phase warp protocol).
    run(nes, 1);
    assert.equal(nes.cpu.mem[WARP_READY], 1, 'the settlement frame must arm warp_ready');
    assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'flat_screen must be UNCHANGED on the settlement frame -- the door has not been taken yet');
    // The queued destination itself -- not merely that SOME warp is pending.
    // script_op_warp (engine/script.asm) is the writer this fixture
    // exercises (a scripted Warp); entity_door (engine/entities.asm) writes
    // the identical three bytes for a placed door instead. take_door
    // (engine/boot.asm) is the only reader, one frame later, either way.
    assert.equal(nes.cpu.mem[WARP_SCR], THIRD_SCREEN, 'warp_scr must name the authored destination screen');
    assert.equal(nes.cpu.mem[WARP_X], WARP_TARGET_X, 'warp_x must hold the authored destination x');
    assert.equal(nes.cpu.mem[WARP_Y], WARP_TARGET_Y, 'warp_y must hold the authored destination y');

    // One frame later: settle_owed finds warp_ready already set and calls
    // take_door, which is what actually changes flat_screen AND copies
    // warp_x/warp_y into player_x/player_y (engine/boot.asm's take_door,
    // same routine, same frame -- there is no separate "the player arrives"
    // step to wait for).
    run(nes, 1);
    assert.equal(nes.cpu.mem[FLAT_SCREEN], THIRD_SCREEN, 'flat_screen must now be the third screen');
    assert.equal(nes.cpu.mem[PLAYER_X], WARP_TARGET_X, 'player_x must land on the queued destination x');
    assert.equal(nes.cpu.mem[PLAYER_Y], WARP_TARGET_Y, 'player_y must land on the queued destination y');
    assert.equal(nes.cpu.mem[PENDING_ENT], THIRD_SLOT, `the third screen's own entry event must be armed (slot ${THIRD_SLOT})`);
    assert.equal(nes.cpu.mem[SCREEN_FRESH], 1, 'screen_fresh must be armed for the third screen too');
    assert.equal(nes.cpu.mem[SWITCHES] & (1 << 4), 0, 'sanity: the third screen\'s own switch must not already be set');

    // take_door's own jmp redraw_screen (engine/boot.asm) draws the third
    // screen under forced blank in the SAME frame that changed flat_screen
    // above, and empirically this forced-blank draw does not finish (mask
    // back on) within that same nes.frame() call -- the identical "a
    // forced-blank draw can outlast one nes.frame() call" property the
    // slide's own arm/completion already have, here on the plain
    // (non-slide) redraw_screen path instead. Synchronize on that
    // transition explicitly, by reading $2001 directly rather than
    // reusing driveToMaskWrite (which needs to catch the transition
    // mid-instruction and cannot be handed an already-blanked frame midway
    // through), then assert the third screen's own entry event runs on the
    // very next ordinary frame -- not merely "eventually, within some
    // bound".
    assert.equal(nes.cpu.mem[0x2001] & 0x18, 0, 'sanity: the destination redraw must still be under forced blank right after take_door');
    for (let i = 0; i < 5 && (nes.cpu.mem[0x2001] & 0x18) !== 0x18; i++) {
      run(nes, 1);
      assert.equal(nes.cpu.mem[PENDING_ENT], THIRD_SLOT, 'the destination redraw must not itself disarm the pending entry event');
    }
    assert.equal(nes.cpu.mem[0x2001] & 0x18, 0x18, 'the destination redraw must finish (mask back on) within the frame budget');
    run(nes, 1);
    assert.equal(nes.cpu.mem[PENDING_ENT], NO_ENTITY, 'pending_ent must be disarmed once the third screen\'s own event has started');
    assert.notEqual(nes.cpu.mem[SWITCHES] & (1 << 4), 0, 'the third screen\'s own entry event must have run');
    nes.buttonUp(1, 7);
  }
);

// -------------------------------------------------------- 8. Bound cache across the slide

test(
  'the bound-tile cache follows whichever screen is about to be drawn, not left on the outgoing screen\'s bindings',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const CELL_ROW = 3;
    const CELL_COL = 2;
    const SWITCH_ID = 3;
    const { nes, addrOf } = await buildSlide(t, {
      mutate: (project) => {
        const outgoingId = project.maps[0].screens[0].metatiles[CELL_ROW * 16 + CELL_COL];
        const incomingId = project.maps[0].screens[1].metatiles[CELL_ROW * 16 + CELL_COL];
        // Two distinct, fingerprintable substitutes, one per screen -- a
        // substitute equal to its own original could not distinguish
        // "applied" from "never consulted" (Appendix H's own rule).
        // Distinct collision types too, so probe_type's own return value (a
        // collision byte, not a metatile id) can prove which binding
        // resolved without relying only on the drawn tile bytes.
        project.metatiles[10] = { ...project.metatiles[10], tiles: [50, 51, 52, 53], palette: project.metatiles[outgoingId].palette, collision: 'solid' };
        project.metatiles[11] = { ...project.metatiles[11], tiles: [60, 61, 62, 63], palette: project.metatiles[incomingId].palette, collision: 'damage' };
        project.maps[0].screens[0].boundTiles = [{ switchId: SWITCH_ID, row: CELL_ROW, col: CELL_COL, metatileId: 10 }];
        project.maps[0].screens[1].boundTiles = [{ switchId: SWITCH_ID, row: CELL_ROW, col: CELL_COL, metatileId: 11 }];
      }
    });
    nes.cpu.mem[SWITCHES] |= 1 << SWITCH_ID;

    crossEdge(nes, 7, { playerX: MAX_X, playerY: 96 }); // Right, arms the slide

    // After the arm: the far nametable (nt 1) must show the INCOMING
    // screen's own substitute (11), not the outgoing screen's (10).
    const cellTL = readNametableRaw(nes, 1).tileBytes[CELL_ROW * 64 + CELL_COL * 2];
    assert.equal(cellTL, 60, 'the far nametable must show the incoming screen\'s own bound substitute');

    let sawZeroLeft = false;
    let cellTLAfter = null;
    for (let i = 0; i < 30; i++) {
      run(nes, 1);
      if (nes.cpu.mem[CAM_SLIDE_LEFT] === 0) sawZeroLeft = true;
      if (sawZeroLeft && nes.cpu.mem[CAM_NT] === 0) {
        cellTLAfter = readNametableRaw(nes, 0).tileBytes[CELL_ROW * 64 + CELL_COL * 2];
        break;
      }
    }
    assert.equal(nes.cpu.mem[CAM_NT], 0, 'the completion redraw never finished');

    // After completion: probe_type at the cell answers the incoming
    // screen's binding, and nametable 0 shows it too.
    assert.ok(cellTLAfter !== null, 'never observed completion within the frame budget');
    assert.equal(cellTLAfter, 60, 'nametable 0 must show the incoming screen\'s own bound substitute after completion');

    // probe_type answers a collision BYTE (mt_collision,y), not a metatile
    // id -- metatile 10 (outgoing) is 'solid', metatile 11 (incoming) is
    // 'damage', so the two are distinguishable through this contract too.
    nes.cpu.mem[PROBE_X] = CELL_COL * 16;
    nes.cpu.mem[PROBE_Y] = CELL_ROW * 16;
    callRoutine(nes, addrOf('probe_type'));
    const COL_DAMAGE = 3;
    assert.equal(nes.cpu.REG_ACC, COL_DAMAGE, 'probe_type must answer the incoming screen\'s own binding (damage), not the outgoing screen\'s (solid)');
    nes.buttonUp(1, 7);
  }
);

// -------------------------------------------------------------- 6. Config

test('CAMERA_ENABLED tracks projectUsesCamera, on and off, with no consumer flag anywhere in the tree', async (t) => {
  for (const camera of [false, true]) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-camera-config-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = normalizeProject(createProject('Camera Config'));
    project.cartridge.camera = camera;
    assert.equal(projectUsesCamera(project), camera);
    await generateAssets({ dir, project });
    const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
    assert.match(config, new RegExp(`^CAMERA_ENABLED = ${camera ? 1 : 0}$`, 'm'));
  }
});

// ----------------------------------------- 11. CAMERA_SLIDE_ENABLED / H / V

test('CAMERA_SLIDE_ENABLED equals CAMERA_ENABLED, and CAMERA_SLIDE_H/V follow the resolved mirroring', async (t) => {
  const cases = [
    { mirroring: 'vertical', h: 1, v: 0 },
    { mirroring: 'horizontal', h: 0, v: 1 }
  ];
  for (const camera of [false, true]) {
    for (const { mirroring, h, v } of cases) {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-camera-slide-config-'));
      t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
      const project = normalizeProject(createProject('Camera Slide Config'));
      project.cartridge.camera = camera;
      project.cartridge.mirroring = mirroring;
      await generateAssets({ dir, project });
      const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
      assert.match(
        config,
        new RegExp(`^CAMERA_SLIDE_ENABLED = ${camera ? 1 : 0}$`, 'm'),
        `camera=${camera} mirroring=${mirroring}: CAMERA_SLIDE_ENABLED must equal CAMERA_ENABLED`
      );
      assert.match(config, new RegExp(`^CAMERA_SLIDE_H = ${h}$`, 'm'), `mirroring=${mirroring}: CAMERA_SLIDE_H`);
      assert.match(config, new RegExp(`^CAMERA_SLIDE_V = ${v}$`, 'm'), `mirroring=${mirroring}: CAMERA_SLIDE_V`);
    }
  }

  // Four-screen: both axes, only reachable on a four-screen-capable board.
  {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-camera-slide-config-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = normalizeProject(createProject('Camera Slide Config Four'));
    project.cartridge.mapper = 30; // UNROM 512
    project.cartridge.camera = true;
    project.cartridge.mirroring = 'fourscreen';
    await generateAssets({ dir, project });
    const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
    assert.match(config, /^CAMERA_SLIDE_H = 1$/m);
    assert.match(config, /^CAMERA_SLIDE_V = 1$/m);
  }
});

test('no CAMERA_CANDIDATE/FORGE_CAMERA line exists anywhere in the shipping tree', () => {
  // docs/design-camera.md's own prototype scaffolding -- the candidate
  // selector and its env-var measurement gates -- must never ship: only (b)
  // exists ("Decisions already made" #1, phase 2). Narrowed from phase 1's
  // own CAMERA_SLIDE|CAMERA_CANDIDATE|FORGE_CAMERA pattern: CAMERA_SLIDE_*
  // now legitimately ships (engine/camera.asm, the generated config.inc
  // lines, player.asm's cross_* stubs) as the consumer's own gate, not
  // scaffolding. Grepped directly rather than trusted from the diff: a
  // stray leftover from adapting the design's own diffs would read as a
  // pure addition and pass a text review that only looked at what was
  // added, not what the whole tree now contains.
  const roots = ['engine', 'main', 'shared', 'renderer'].map((d) => path.join(ROOT, d));
  const pattern = /CAMERA_CANDIDATE|FORGE_CAMERA/;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(asm|js|inc)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        if (pattern.test(text)) offenders.push(full);
      }
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, [], `no file under engine/, main/, shared/ or renderer/ may mention CAMERA_CANDIDATE/FORGE_CAMERA: ${offenders.join(', ')}`);
});
