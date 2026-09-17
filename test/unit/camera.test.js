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
import { createProject, normalizeProject, projectUsesCamera } from '../../shared/project.js';
import { finishNamingIfOpen } from '../lib/naming.js';
import { callRoutine } from '../lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');

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
  'Shake composes correctly at every wrap boundary, both nametables (synthetic)',
  { skip: !fs.existsSync(path.join(SAMPLE, 'build/game.nes')) && 'run `npm run build:sample` first' },
  async (t) => {
    const { nes } = await buildWith(t, { camera: true, commands: DUMMY_SHAKE });
    // Synthetic: a slide's own 16-step arithmetic (phase 2) does not
    // naturally land on every one of these eight boundary combinations
    // within a single crossing, so they are injected directly.
    for (const nt of [0, 1]) {
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
        assert.equal(scrollY(nes), 50);

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
        assert.equal(scrollY(nes), 50);
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
    function runToLabel(startAddr, stopAddr) {
      nes.mmap.write(0x2000, 0); // NMI generation off, matching callRoutine's own guard
      nes.cpu.irqRequested = false;
      nes.cpu.F_INTERRUPT = 1;
      nes.cpu.REG_PC = startAddr - 1;
      let steps = 0;
      while ((nes.cpu.REG_PC + 1) !== stopAddr) {
        nes.cpu.emulate();
        assert.ok(++steps < 20000, 'never reached nmi_scroll_done');
      }
    }

    nes.cpu.mem[CAM_X_LO] = 100;
    nes.cpu.mem[CAM_Y_LO] = 20;
    nes.cpu.mem[CAM_NT] = 0;
    nes.cpu.mem[CAM_DIRTY] = 0;
    nes.cpu.mem[TMP] = 0xab; // sentinel
    nes.cpu.mem[SHAKE_LEFT] = 1; // the +2 phase
    runToLabel(nmiScroll, nmiScrollDone);

    assert.equal(nes.cpu.mem[TMP], 0xab, 'tmp must be untouched by the composition');
    assert.equal(nes.cpu.mem[NMI_TMP], 102, 'nmi_tmp must hold the composed low byte (100 + 2)');
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

test('no CAMERA_SLIDE/CAMERA_CANDIDATE/FORGE_CAMERA line exists anywhere in the shipping tree', () => {
  // docs/design-camera.md's own prototype scaffolding (the consumer flags
  // and its env-var measurement gates) must not ship with phase 1 -- see
  // "Decisions already made" #1. Grepped directly rather than trusted from
  // the diff: a stray leftover from adapting the design's own diffs would
  // read as a pure addition and pass a text review that only looked at what
  // was added, not what the whole tree now contains.
  const roots = ['engine', 'main', 'shared', 'renderer'].map((d) => path.join(ROOT, d));
  const pattern = /CAMERA_SLIDE|CAMERA_CANDIDATE|FORGE_CAMERA/;
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
  assert.deepEqual(offenders, [], `no file under engine/, main/, shared/ or renderer/ may mention CAMERA_SLIDE/CAMERA_CANDIDATE/FORGE_CAMERA in phase 1: ${offenders.join(', ')}`);
});
