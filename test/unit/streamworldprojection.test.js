// Large streamed worlds (ROADMAP item 15), phase 2 slice 4a: per-tile OAM projection.
//
// The routines under test (engine/streamworld.asm's sw_oam_project_x/sw_oam_project_y/
// sw_oam_rowbase, engine/oam.asm's build_oam_draw_sw, engine/entities.asm's
// draw_one_entity_show_sw) have zero production callers that ever run with a moving camera --
// nothing in this slice or the ones before it writes sw_cam_origin_* more than once (the single
// landing write this slice adds, engine/streamworld.asm's sw_resolve_divdone), and nothing moves
// sw_col/sw_row after that either. Ruling 2 (handoff-next/brief-streamed-worlds-phase2-s4a.md)
// requires every test here to first poke sw_cam_origin_*/sw_col/sw_row away from the landing
// values (0) and assert independently hand-computed OAM bytes -- otherwise an implementation that
// just copies player_x/player_y straight into OAM (numerically correct only at the landing wall,
// survey fact 5) would pass every test that only boots to the wall and looks.
//
// Every expected byte here comes from projectAxis/cornerWorld below, an independent
// reimplementation of sw_project_axis's own documented contract (its own header comment in
// engine/streamworld.asm: "iff 0 <= delta < visibleWidth"), not a copy of the assembly -- the
// same "independent oracle" convention streamworldresident.test.js's expectedMetatileId already
// uses.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { callRoutine } from '../lib/callroutine.js';
import NES from '../../renderer/emulator/core/nes.js';

// engine/constants.asm -- hardcoded per CLAUDE.md's own rule (a test that reads the file it is
// checking proves nothing). Zero-page block (player_x through anim_frame, oam_idx/de_ex/de_ey),
// unchanged since phase 1.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const PLAYER_DIR = 0x12;
const ANIM_FRAME = 0x13;
const OAM_IDX = 0x20;
const MAP_IS_STREAMED = 0xfe; // engine/constants.asm:593
// sw_cam_origin_x/y_lo/hi -- engine/constants.asm:675-678, no writer anywhere in engine/ before
// this slice's own single landing write (sw_resolve_divdone).
const SW_CAM_ORIGIN_X_LO = 0x035c;
const SW_CAM_ORIGIN_X_HI = 0x035d;
const SW_CAM_ORIGIN_Y_LO = 0x035e;
const SW_CAM_ORIGIN_Y_HI = 0x035f;
const SW_COL = 0x05a0; // engine/constants.asm:969
const SW_ROW = 0x05a1; // engine/constants.asm:970
const ENT_ACTIVE = 0x0300; // @size=MAX_ENTITIES
const ENT_ACTOR = 0x0308;
const ENT_X = 0x0310;
const ENT_Y = 0x0318;
const ENT_DIR = 0x0320;
const ENT_FRAME = 0x0328;
const ENT_TIMER = 0x0330;
const ENT_HURT = 0x0388;
const DIR_DOWN = 0;
const OAM = 0x0200;
// The camera/NMI-arbitration chain (test/unit/camera.test.js's own hardcoded values, re-verified
// against the real build below -- same equate chain, unaffected by this slice).
const CAM_X_LO = 0xaf;
const CAM_Y_LO = 0xb0;
const CAM_NT = 0xb1;
const CAM_DIRTY = 0xb5;
const NMI_CAM_X_LO = 0xb6;
const NMI_CAM_Y_LO = 0xb7;
const NMI_CAM_NT = 0xb8;
const VRAM_READY = 0x3f;
const ST_ACTIVE = 0x05b5;

/**
 * projectAxis: sw_project_axis's own documented contract (engine/streamworld.asm), mirrored
 * bit-for-bit: 16-bit unsigned world/origin, delta = (world - origin) mod 65536, visible iff the
 * delta's own high byte is exactly 0 AND (width==0 (the 256-wide X sentinel) OR the low byte is
 * < width). The routine's own header is explicit that this is an exact zero test on the high
 * byte, not a signed compare of any kind ("Any negative delta hides -- there is no partial-left-
 * edge case").
 */
function projectAxis(world, origin, width) {
  const delta = (world - origin) & 0xffff;
  const deltaLo = delta & 0xff;
  const deltaHi = delta >> 8;
  const visible = deltaHi === 0 && (width === 0 || deltaLo < width);
  return { byte: deltaLo, visible };
}

/**
 * cornerWorld: one tile's own world coordinate, matching the caller's own 8-bit
 * `clc; adc offset` (wrapping mod 256, with the real carry feeding the next screen unit) --
 * engine/oam.asm's build_oam_draw_sw / engine/streamworld.asm's sw_oam_project_x/y. `size` is the
 * screen's own axis size (256 for X, 240 for Y) -- for X this reduces to `unit*256 + local +
 * offset` exactly (a screen is exactly 256px wide, so the 8-bit wrap and the 256-wide screen unit
 * agree); for Y it does NOT reduce the same way (a screen is 240px tall, not a power of two), so
 * this function keeps the real wrap-then-multiply order rather than the X-only shortcut.
 */
function cornerWorld(unit, size, local, offset) {
  const sum = local + offset;
  const wrapped = sum & 0xff;
  const carry = sum > 255 ? 1 : 0;
  return (unit + carry) * size + wrapped;
}

/** sw_oam_project_y's own extra step beyond projectAxis: the one-scanline-early -1, applied only
 * once, only on a visible result; a hidden result reports the $FF park sentinel. */
function projectY(worldY, originY) {
  const { byte, visible } = projectAxis(worldY, originY, 240);
  if (!visible) return { oamY: 0xff, visible: false };
  return { oamY: (byte - 1) & 0xff, visible: true };
}

const CORNERS = [
  { name: 'TL', xOff: 0, yOff: 0, oam: 0 },
  { name: 'TR', xOff: 8, yOff: 0, oam: 4 },
  { name: 'BL', xOff: 0, yOff: 8, oam: 8 },
  { name: 'BR', xOff: 8, yOff: 8, oam: 12 }
];

/** Every corner's own expected (hidden, oamX, oamY), from the SAME sw_col/sw_row/player position/
 * camera origin a test poked -- never read back off the built ROM. */
function expectedPlayerCorners({ swCol, swRow, playerX, playerY, originX, originY }) {
  return CORNERS.map((c) => {
    const worldX = cornerWorld(swCol, 256, playerX, c.xOff);
    const worldY = cornerWorld(swRow, 240, playerY, c.yOff);
    const px = projectAxis(worldX, originX, 0);
    const py = projectY(worldY, originY);
    const hidden = !px.visible || !py.visible;
    return { ...c, hidden, oamX: px.byte, oamY: py.oamY };
  });
}

/** `mutate`, when given, runs on the project before it is saved/built -- projection tests 7-9
 * (below) need real sprites.metasprites/animations/actors, which createStreamedProject({}) ships
 * none of (every test above them only exercises entity drawing through the *hidden* early-exit
 * path, test 1's slot 0, or not at all). */
async function buildHarness(t, mutate) {
  const project = createStreamedProject({});
  if (mutate) mutate(project);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworldprojection-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  return { project, addrOf, nes, mem: nes.cpu.mem };
}

/** Resets exactly the state a fresh build_oam_draw call needs, leaving everything else at
 * whatever the previous call in the same test left it -- every test sets its own sw_col/sw_row/
 * origin/player position explicitly, so nothing here is load-bearing for correctness, only
 * convenience. */
function primeCommon(mem) {
  mem[MAP_IS_STREAMED] = 1;
  mem[PLAYER_DIR] = 0;
  mem[ANIM_FRAME] = 0;
}

function setOrigin(mem, originX, originY) {
  mem[SW_CAM_ORIGIN_X_LO] = originX & 0xff;
  mem[SW_CAM_ORIGIN_X_HI] = (originX >> 8) & 0xff;
  mem[SW_CAM_ORIGIN_Y_LO] = originY & 0xff;
  mem[SW_CAM_ORIGIN_Y_HI] = (originY >> 8) & 0xff;
}

function readPlayerOam(mem) {
  return CORNERS.map((c) => ({ y: mem[OAM + c.oam], x: mem[OAM + c.oam + 3] }));
}

/**
 * entityTileWorld: the oracle for engine/entities.asm's per-tile entity projection
 * (sw_oam_project_tile_x/y, engine/streamworld.asm), fix round 1 finding 2 -- deliberately NOT
 * cornerWorld/projectY above, which model the OLDER sw_oam_project_x/y contract the player's four
 * fixed corners use (an 8-bit-wrapped `local+offset`, carrying into the NEXT screen UNIT on
 * overflow -- exact only because the player's +0/+8 corner offsets never push a local coordinate
 * past 255). A metasprite tile's own offset is signed across the full -128..127 range
 * (shared/project.js normalizeMetasprite) and an entity's placement is not bounded the way player
 * movement is (normalizeEntity accepts x through 255, y through 239), so sw_oam_project_tile_y's
 * own header explains why it does NOT reuse that wrap-then-multiply shortcut: it multiplies
 * sw_row by 240 exactly ONCE (rowBase16, precomputed by the caller) and folds every per-tile
 * signed offset in afterward by a plain 16-bit add, which -- unlike multiplication -- stays
 * consistent under wraparound. sw_oam_project_tile_x's own sign-extension technique reduces to the
 * identical plain 16-bit add for X (256 being a power of two makes the two formulations agree).
 * So the oracle here is simply `unit*size + base + offset`, reduced mod 65536 exactly once --
 * never a two-step wrap-then-carry.
 */
function entityTileWorld(unit, size, base, offset) {
  return (unit * size + base + offset) & 0xffff;
}

test(
  'projection 1: a uniformly negative delta on one axis parks every one of the player\'s four OAM slots, and likewise hides an entity outright -- catches an unconditional draw / a player_x-straight-through copy',
  async (t) => {
    const { addrOf, nes, mem } = await buildHarness(t);
    const buildOamDraw = addrOf('build_oam_draw');
    const drawOneEntity = addrOf('draw_one_entity');

    for (const axis of ['x', 'y']) {
      primeCommon(mem);
      const swCol = 10;
      const swRow = 10;
      mem[SW_COL] = swCol;
      mem[SW_ROW] = swRow;
      mem[PLAYER_X] = 100;
      mem[PLAYER_Y] = 90;
      // The origin sits 50px AHEAD of the player on the axis under test (a negative delta), and
      // exactly at the player's own position on the other axis (delta 0, visible) -- so a
      // uniformly-hidden-on-one-axis corner set still exercises the OTHER axis's own real
      // arithmetic rather than trivially hiding both.
      const worldX = cornerWorld(swCol, 256, 100, 0);
      const worldY = cornerWorld(swRow, 240, 90, 0);
      const originX = axis === 'x' ? worldX + 50 : worldX;
      const originY = axis === 'y' ? worldY + 50 : worldY;
      setOrigin(mem, originX, originY);

      // Prime every OAM byte the player's four slots could occupy with a sentinel the park
      // branch never writes (it only ever stores $FF into the Y byte) -- proves X/tile/pal are
      // left untouched on a parked corner, not merely that Y became $FF.
      for (let i = 0; i < 16; i++) mem[OAM + i] = 0x77;
      callRoutine(nes, buildOamDraw);

      for (const c of CORNERS) {
        assert.equal(mem[OAM + c.oam], 0xff, `axis ${axis}: corner ${c.name}'s own OAM Y byte must be $FF (parked)`);
        assert.equal(mem[OAM + c.oam + 3], 0x77, `axis ${axis}: corner ${c.name}'s own OAM X byte must be untouched (the park branch never writes it)`);
      }

      // Likewise an entity: origin (ent_x/ent_y) hidden must skip draw_metasprite entirely --
      // oam_idx and the OAM region it would have written both stay exactly as primed.
      const slot = 0;
      mem[ENT_HURT + slot] = 0;
      mem[ENT_ACTOR + slot] = 0;
      mem[ENT_DIR + slot] = DIR_DOWN;
      mem[ENT_X + slot] = 100;
      mem[ENT_Y + slot] = 90;
      mem[OAM_IDX] = 40;
      for (let i = 40; i < 56; i++) mem[OAM + i] = 0x66;
      nes.cpu.REG_X = slot;
      callRoutine(nes, drawOneEntity);
      assert.equal(mem[OAM_IDX], 40, `axis ${axis}: a fully-hidden entity must never advance oam_idx (draw_metasprite never runs)`);
      for (let i = 40; i < 56; i++) assert.equal(mem[OAM + i], 0x66, `axis ${axis}: a fully-hidden entity must never write OAM byte ${i}`);
    }
  }
);

test(
  "projection 2: a player origin sitting 249px(X)/233px(Y) from the camera origin draws only the top-left corner -- the other three each park on at least one axis, never wrapping to 1/0 -- catches per-metasprite (rather than per-tile) visibility",
  async (t) => {
    const { addrOf, nes, mem } = await buildHarness(t);
    const buildOamDraw = addrOf('build_oam_draw');
    primeCommon(mem);
    const swCol = 5;
    const swRow = 3;
    mem[SW_COL] = swCol;
    mem[SW_ROW] = swRow;
    const playerX = 249;
    const playerY = 233;
    mem[PLAYER_X] = playerX;
    mem[PLAYER_Y] = playerY;
    // Origin pinned exactly at this screen's own top-left world position (lo=0, hi=sw_col/sw_row)
    // -- so the TL corner's own delta is simply the player's own local coordinate (249/233), and
    // the +8 offset corners cross the 256/240 boundary exactly the way the brief's own case
    // describes.
    setOrigin(mem, swCol * 256, swRow * 240);

    const expected = expectedPlayerCorners({ swCol, swRow, playerX, playerY, originX: swCol * 256, originY: swRow * 240 });
    assert.equal(expected.find((c) => c.name === 'TL').hidden, false, 'sanity: TL must be the one visible corner');
    assert.equal(expected.find((c) => c.name === 'TL').oamX, 249);
    assert.equal(expected.find((c) => c.name === 'TL').oamY, 232);
    for (const name of ['TR', 'BL', 'BR']) {
      assert.equal(expected.find((c) => c.name === name).hidden, true, `sanity: ${name} must be hidden (this test is pointless if it is not)`);
    }

    for (let i = 0; i < 16; i++) mem[OAM + i] = 0x77;
    callRoutine(nes, buildOamDraw);
    for (const c of expected) {
      if (c.hidden) {
        assert.equal(mem[OAM + c.oam], 0xff, `corner ${c.name} must be parked ($FF), never wrapped to a small X/Y`);
        assert.notEqual(mem[OAM + c.oam], 1, `corner ${c.name}'s Y must never read back as a wrapped 0/1`);
      } else {
        assert.equal(mem[OAM + c.oam], c.oamY, `corner ${c.name}'s own OAM Y byte`);
        assert.equal(mem[OAM + c.oam + 3], c.oamX, `corner ${c.name}'s own OAM X byte`);
      }
    }
  }
);

test(
  'projection 3: a world position at sw_col/sw_row >= 128 (world x/y past 32768) projects the exact same relative OAM bytes as the identical delta at a low sw_col/sw_row -- catches a signed compare on the projection\'s own high byte',
  async (t) => {
    const { addrOf, nes, mem } = await buildHarness(t);
    const buildOamDraw = addrOf('build_oam_draw');

    async function runAt(swCol, swRow) {
      primeCommon(mem);
      mem[SW_COL] = swCol;
      mem[SW_ROW] = swRow;
      const playerX = 40;
      const playerY = 30;
      mem[PLAYER_X] = playerX;
      mem[PLAYER_Y] = playerY;
      // Origin at this screen's own top-left, exactly as projection 2 -- the only variable
      // across the two calls is the magnitude of sw_col/sw_row (and so of every world/origin
      // byte derived from it), never the relative delta.
      setOrigin(mem, swCol * 256, swRow * 240);
      for (let i = 0; i < 16; i++) mem[OAM + i] = 0x00;
      callRoutine(nes, buildOamDraw);
      return readPlayerOam(mem);
    }

    const low = await runAt(2, 2); // world x/y well under 32768
    const high = await runAt(200, 130); // world x = 51200, world y = 31200 -- both >= 32768/16384
                                          // and sw_col/sw_row's own raw byte has bit 7 set, the
                                          // exact shape a signed (BMI-based) high-byte compare
                                          // would treat differently from an unsigned zero test
    assert.deepEqual(
      high,
      low,
      'the projected OAM bytes must depend only on the relative delta, never on the absolute magnitude (or sign bit) of sw_col/sw_row/the camera origin -- a signed compare on the projection\'s high byte would diverge here'
    );
    // Sanity: this is a real, all-visible case, not two coincidentally-parked runs agreeing on
    // nothing.
    assert.equal(low[0].x, 40);
    assert.equal(low[0].y, 29);
  }
);

test(
  'projection 4: sw_oam_project_y applies its one-scanline-early -1 exactly once, only on the visible side -- world y == origin y reports OAM Y $FF (visible, indistinguishable from parked, the design\'s own accepted trade-off); origin + 1 reports OAM Y 0 -- catches the -1 applied before the visibility test, or applied twice',
  async (t) => {
    const { addrOf, nes, mem } = await buildHarness(t);
    const swOamProjectY = addrOf('sw_oam_project_y');
    const swRow = 6;
    mem[SW_ROW] = swRow;
    const originY = swRow * 240 + 37; // an arbitrary non-zero low byte, so this is not
                                        // coincidentally testing only the origin==0 case
    mem[SW_CAM_ORIGIN_Y_LO] = originY & 0xff;
    mem[SW_CAM_ORIGIN_Y_HI] = (originY >> 8) & 0xff;

    // world y == origin y + 0: local Y chosen so cornerWorld(swRow, 240, localY, 0) == originY.
    const localYAtOrigin = originY - swRow * 240;
    assert.ok(localYAtOrigin >= 0 && localYAtOrigin < 256, 'sanity: the chosen local Y must be a plain byte');
    nes.cpu.REG_ACC = localYAtOrigin;
    nes.cpu.F_CARRY = 0; // no caller-side offset overflow
    callRoutine(nes, swOamProjectY);
    assert.equal(nes.cpu.F_CARRY, 0, 'delta 0 must report VISIBLE (carry clear), not hidden -- an apply-before-test bug would see a bogus -1 delta and hide it');
    assert.equal(nes.cpu.REG_ACC, 0xff, 'delta 0, visible, must read back as OAM Y $FF (0 - 1, wrapped) -- the design\'s own accepted ambiguity with the park sentinel');

    // world y == origin y + 1.
    const localYAtOriginPlus1 = (localYAtOrigin + 1) & 0xff;
    nes.cpu.REG_ACC = localYAtOriginPlus1;
    nes.cpu.F_CARRY = localYAtOrigin === 255 ? 1 : 0; // the caller's own offset-add carry, real
                                                         // wraparound if localYAtOrigin was 255
    callRoutine(nes, swOamProjectY);
    assert.equal(nes.cpu.F_CARRY, 0, 'delta 1 must still be visible');
    assert.equal(nes.cpu.REG_ACC, 0x00, 'delta 1, visible, must read back as OAM Y 0 -- a double-subtract bug would read $FE instead');
  }
);

test(
  'projection 5: the ordinary (non-streamed) draw path never reads sw_cam_origin_* at all, for the player or an entity -- catches a branch that runs the streamed path (or reads its state) regardless of map_is_streamed',
  async (t) => {
    const { addrOf, nes, mem } = await buildHarness(t);
    const buildOamDraw = addrOf('build_oam_draw');
    const drawOneEntity = addrOf('draw_one_entity');

    mem[MAP_IS_STREAMED] = 0;
    mem[PLAYER_DIR] = 1;
    mem[ANIM_FRAME] = 1;
    mem[PLAYER_X] = 77;
    mem[PLAYER_Y] = 88;
    mem[SW_COL] = 40;
    mem[SW_ROW] = 40;

    function runPlayerWith(origin) {
      setOrigin(mem, origin, origin);
      for (let i = 0; i < 16; i++) mem[OAM + i] = 0;
      callRoutine(nes, buildOamDraw);
      return Array.from({ length: 16 }, (_, i) => mem[OAM + i]);
    }
    const garbage = runPlayerWith(0xdead & 0xffff);
    const zero = runPlayerWith(0);
    assert.deepEqual(garbage, zero, "the player's ordinary OAM bytes must be identical regardless of sw_cam_origin_*'s own value");

    const slot = 1;
    mem[ENT_HURT + slot] = 0;
    mem[ENT_X + slot] = 60;
    mem[ENT_Y + slot] = 50;
    function runEntityWith(origin) {
      setOrigin(mem, origin, origin);
      mem[OAM_IDX] = 20;
      for (let i = 20; i < 24; i++) mem[OAM + i] = 0;
      nes.cpu.REG_X = slot;
      callRoutine(nes, drawOneEntity);
      return { idx: mem[OAM_IDX], bytes: Array.from({ length: 4 }, (_, i) => mem[OAM + 20 + i]) };
    }
    const entGarbage = runEntityWith(0xbeef & 0xffff);
    const entZero = runEntityWith(0);
    assert.deepEqual(entGarbage, entZero, "an entity's ordinary OAM bytes must be identical regardless of sw_cam_origin_*'s own value");
  }
);

test(
  'projection 6: within one mainline frame, sw_cam_origin_* and cam_x_lo/y_lo/cam_nt are updated together under cam_dirty (raise, write, lower) -- the OAM the player is built with, and the nmi_cam_* snapshot the following interrupt segment publishes, both describe the SAME camera write, never a torn mix -- catches OAM built from a stale/cached origin. Its real production trigger (a per-frame origin writer) arrives in phase 2 slice 4b; this drives the identical raise/write/lower sequence by hand.',
  async (t) => {
    const { addrOf, nes, mem } = await buildHarness(t);
    const buildOamDraw = addrOf('build_oam_draw');
    const nmiVramDispatch = addrOf('nmi_vram_dispatch');
    const nmiScrollDone = addrOf('nmi_scroll_done');

    primeCommon(mem);
    const swCol = 7;
    const swRow = 4;
    mem[SW_COL] = swCol;
    mem[SW_ROW] = swRow;
    mem[PLAYER_X] = 100;
    mem[PLAYER_Y] = 90;

    // The raise/write/lower sequence 4b will drive every frame; here it is a single synchronous
    // JS-level poke (no real interrupt can land mid-sequence from this side), exactly the
    // "synthetic tear" convention camera.test.js's own publication-lock test already uses ("real
    // play cannot land an NMI at a chosen instruction boundary on demand; a direct poke can").
    mem[CAM_DIRTY] = 1;
    const originX = swCol * 256 + 10;
    const originY = swRow * 240 + 20;
    setOrigin(mem, originX, originY);
    mem[CAM_X_LO] = 55;
    mem[CAM_Y_LO] = 66;
    mem[CAM_NT] = 1;
    mem[CAM_DIRTY] = 0;

    const expected = expectedPlayerCorners({ swCol, swRow, playerX: 100, playerY: 90, originX, originY });
    assert.ok(expected.some((c) => !c.hidden), 'sanity: at least one corner must be visible');

    for (let i = 0; i < 16; i++) mem[OAM + i] = 0x77;
    callRoutine(nes, buildOamDraw);
    const afterBuild = readPlayerOam(mem);

    // The interrupt segment: idle strip (st_active=0, so sw_nmi_stream/_reduced rts immediately,
    // ruling 5) and no vram_buf packet queued (vram_ready=0) -- isolates the camera-snapshot half
    // of the splice from the streaming-drain half, which the sibling NMI test file covers.
    mem[VRAM_READY] = 0;
    mem[ST_ACTIVE] = 0;
    nes.mmap.write(0x2000, 0);
    nes.cpu.irqRequested = false;
    nes.cpu.F_INTERRUPT = 1;
    nes.cpu.REG_PC = nmiVramDispatch - 1;
    let steps = 0;
    while (nes.cpu.REG_PC + 1 !== nmiScrollDone) {
      nes.cpu.emulate();
      assert.ok(++steps < 200000, 'never reached nmi_scroll_done');
    }

    assert.equal(mem[NMI_CAM_X_LO], 55, 'cam_dirty was clear across the whole write -- the snapshot must show the real, non-stale cam_x_lo');
    assert.equal(mem[NMI_CAM_Y_LO], 66);
    assert.equal(mem[NMI_CAM_NT], 1);

    // Nothing in the interrupt segment (idle strip, no drain) touches OAM at all -- the player's
    // own OAM bytes, built from sw_cam_origin_* before the interrupt ran, must read back
    // identically after it, proving the mainline build and the interrupt's own snapshot agree on
    // the same camera write with no window for a torn read between them.
    const afterNmi = readPlayerOam(mem);
    assert.deepEqual(afterNmi, afterBuild, 'the OAM built before the interrupt segment must be untouched by it');
    for (let i = 0; i < expected.length; i++) {
      const c = expected[i];
      const got = afterNmi[i];
      if (c.hidden) {
        assert.equal(got.y, 0xff, `corner ${c.name} should be parked`);
      } else {
        assert.equal(got.y, c.oamY, `corner ${c.name}'s own OAM Y byte`);
        assert.equal(got.x, c.oamX, `corner ${c.name}'s own OAM X byte`);
      }
    }
  }
);

// ----------------------------------------------------------- fix round 1 (finding 1 / finding 2)

const ONE_TILE_ACTOR = () => ({
  metasprites: [{ id: 0, name: 'm0', tiles: [{ x: 0, y: 0, tile: 0x11, palette: 1, hflip: false, vflip: false }] }],
  animations: [{ id: 0, name: 'a0', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] }],
  actors: [{ name: 'Walker', behavior: 'patroller', speed: 1, hp: 1, damage: 0, anims: { walkDown: 0 } }]
});

test(
  "projection 7: two live, visible entities in different slots at different X and Y each draw their OWN OAM bytes, independently computed -- catches the slot-X clobber (sw_oam_rowbase leaves X=0 on return) that made every non-slot-0 entity draw at slot 0's own ent_x (fix round 1, finding 1; reviewer's own repro: slot 0 x=40, slot 1 x=100, both y=90)",
  async (t) => {
    const sprites = ONE_TILE_ACTOR();
    const { addrOf, nes, mem } = await buildHarness(t, (project) => {
      project.sprites.metasprites = sprites.metasprites;
      project.sprites.animations = sprites.animations;
      project.sprites.actors = sprites.actors;
    });
    const drawOneEntity = addrOf('draw_one_entity');

    primeCommon(mem);
    const swCol = 4;
    const swRow = 2;
    mem[SW_COL] = swCol;
    mem[SW_ROW] = swRow;
    // Origin at this screen's own top-left, so an entity's local x/y is its own delta directly.
    const originX = swCol * 256;
    const originY = swRow * 240;
    setOrigin(mem, originX, originY);

    // Reviewer's own values (slot 0 x=40, both y=90), plus a second entity in slot 3 -- not slot
    // 1 -- so a fix that special-cased "the second call" rather than genuinely restoring X per
    // call would still be caught.
    const placements = [
      { slot: 0, x: 40, y: 90 },
      { slot: 3, x: 100, y: 70 }
    ];
    for (const { slot, x, y } of placements) {
      mem[ENT_ACTIVE + slot] = 1;
      mem[ENT_HURT + slot] = 0;
      mem[ENT_ACTOR + slot] = 0;
      mem[ENT_X + slot] = x;
      mem[ENT_Y + slot] = y;
      mem[ENT_DIR + slot] = DIR_DOWN;
      mem[ENT_FRAME + slot] = 0;
      mem[ENT_TIMER + slot] = 0;
    }

    for (const { slot, x, y } of placements) {
      const base = 0x20 + slot * 4; // a distinct OAM scratch region per slot
      mem[OAM_IDX] = base;
      for (let i = base; i < base + 4; i++) mem[OAM + i] = 0x77;
      nes.cpu.REG_X = slot;
      callRoutine(nes, drawOneEntity);

      const worldX = entityTileWorld(swCol, 256, x, 0);
      const worldY = entityTileWorld(swRow, 240, y, 0);
      const px = projectAxis(worldX, originX, 0);
      const py = projectY(worldY, originY);
      assert.equal(px.visible, true, `sanity: slot ${slot}'s own tile must be visible`);
      assert.equal(py.visible, true, `sanity: slot ${slot}'s own tile must be visible`);
      assert.equal(mem[OAM + base + 3], px.byte, `slot ${slot}'s own OAM X byte must be ITS OWN x (${x}), never another slot's`);
      assert.equal(mem[OAM + base], py.oamY, `slot ${slot}'s own OAM Y byte`);
      assert.equal(mem[OAM + base + 1], 0x11, `slot ${slot}'s own OAM tile byte`);
      assert.equal(mem[OAM + base + 2], 1, `slot ${slot}'s own OAM attribute byte`);
      assert.equal(mem[OAM_IDX], base + 4, `slot ${slot} must have advanced oam_idx by exactly one tile`);
    }
  }
);

test(
  "projection 8: an entity whose own origin tile sits off-window still draws a DIFFERENT tile of the same metasprite that IS visible -- catches per-metasprite (rather than per-tile) clipping reintroduced at the entity layer (fix round 1, finding 2; reviewer's own repro shape: a two-tile metasprite whose second tile would wrap to a small in-range X/Y instead of parking)",
  async (t) => {
    const { addrOf, nes, mem } = await buildHarness(t, (project) => {
      project.sprites.metasprites = [
        {
          id: 0,
          name: 'edge',
          tiles: [
            { x: 0, y: 0, tile: 0x30, palette: 0, hflip: false, vflip: false }, // the entity's own base -- made to sit off-window
            { x: 16, y: 0, tile: 0x31, palette: 0, hflip: false, vflip: false } // pulled back into view by its own offset
          ]
        }
      ];
      project.sprites.animations = [{ id: 0, name: 'a0', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] }];
      project.sprites.actors = [{ name: 'Edge', behavior: 'patroller', speed: 1, hp: 1, damage: 0, anims: { walkDown: 0 } }];
    });
    const drawOneEntity = addrOf('draw_one_entity');

    primeCommon(mem);
    const swCol = 0;
    const swRow = 0;
    mem[SW_COL] = swCol;
    mem[SW_ROW] = swRow;
    const entX = 249;
    const entY = 90;
    // The camera origin sits 11px AHEAD of the entity's own base tile on X (so the base tile's own
    // world position, delta -11, is hidden) and 10px behind on Y (so Y is visible for every tile
    // below, isolating the X clipping this test is actually about).
    const originX = 260;
    const originY = 80;
    setOrigin(mem, originX, originY);

    const slot = 2;
    mem[ENT_ACTIVE + slot] = 1;
    mem[ENT_HURT + slot] = 0;
    mem[ENT_ACTOR + slot] = 0;
    mem[ENT_X + slot] = entX;
    mem[ENT_Y + slot] = entY;
    mem[ENT_DIR + slot] = DIR_DOWN;
    mem[ENT_FRAME + slot] = 0;
    mem[ENT_TIMER + slot] = 0;

    const base = 0x30;
    mem[OAM_IDX] = base;
    for (let i = base; i < base + 8; i++) mem[OAM + i] = 0x77;
    nes.cpu.REG_X = slot;
    callRoutine(nes, drawOneEntity);

    const baseWorldX = entityTileWorld(swCol, 256, entX, 0);
    const baseWorldY = entityTileWorld(swRow, 240, entY, 0);
    const basePx = projectAxis(baseWorldX, originX, 0);
    assert.equal(basePx.visible, false, "sanity: the base tile's own X must be off-window -- this test is pointless otherwise");
    assert.equal(mem[OAM + base], 0xff, "the base (offset 0,0) tile must be parked, since its own X is off-window");
    assert.equal(mem[OAM + base + 3], 0x77, "a parked tile's own OAM X byte must be untouched (the park branch never writes it)");

    const secondWorldX = entityTileWorld(swCol, 256, entX, 16);
    const secondWorldY = entityTileWorld(swRow, 240, entY, 0);
    const secondPx = projectAxis(secondWorldX, originX, 0);
    const secondPy = projectY(secondWorldY, originY);
    assert.equal(secondPx.visible, true, 'sanity: the second tile must be visible -- this test is pointless otherwise');
    assert.equal(secondPy.visible, true);
    assert.equal(mem[OAM + base + 4], secondPy.oamY, "the second tile's own OAM Y byte, even though the metasprite's own base tile was hidden");
    assert.equal(mem[OAM + base + 4 + 3], secondPx.byte, "the second tile's own OAM X byte");
    assert.notEqual(mem[OAM + base + 4 + 3], 1, "must never wrap to the naive 8-bit-truncated small X a whole-metasprite-origin projection would produce");
  }
);

test(
  'projection 9: a per-tile offset large enough to cross a screen boundary on its own parks that tile rather than wrapping it back into a small, plausible-looking OAM byte -- catches an implementation that projects only the entity\'s own origin and then adds each tile\'s offset to the already-truncated 8-bit OAM byte (draw_metasprite\'s own +de_ex/+de_ey convention, correct for the shared non-field callers it stays reserved for, but wrong here per fix round 1, finding 2)',
  async (t) => {
    const { addrOf, nes, mem } = await buildHarness(t, (project) => {
      project.sprites.metasprites = [
        {
          id: 0,
          name: 'overflow',
          tiles: [
            { x: 0, y: 0, tile: 0x40, palette: 2, hflip: false, vflip: false }, // baseline, visible
            { x: 127, y: 0, tile: 0x41, palette: 2, hflip: false, vflip: false }, // X offset alone crosses a screen
            { x: 0, y: 127, tile: 0x42, palette: 2, hflip: false, vflip: false } // Y offset alone crosses a screen
          ]
        }
      ];
      project.sprites.animations = [{ id: 0, name: 'a0', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] }];
      project.sprites.actors = [{ name: 'Overflow', behavior: 'patroller', speed: 1, hp: 1, damage: 0, anims: { walkDown: 0 } }];
    });
    const drawOneEntity = addrOf('draw_one_entity');

    primeCommon(mem);
    const swCol = 0;
    const swRow = 0;
    mem[SW_COL] = swCol;
    mem[SW_ROW] = swRow;
    const entX = 200;
    const entY = 150;
    const originX = 0;
    const originY = 0;
    setOrigin(mem, originX, originY);

    const slot = 5;
    mem[ENT_ACTIVE + slot] = 1;
    mem[ENT_HURT + slot] = 0;
    mem[ENT_ACTOR + slot] = 0;
    mem[ENT_X + slot] = entX;
    mem[ENT_Y + slot] = entY;
    mem[ENT_DIR + slot] = DIR_DOWN;
    mem[ENT_FRAME + slot] = 0;
    mem[ENT_TIMER + slot] = 0;

    const base = 0x40;
    mem[OAM_IDX] = base;
    for (let i = base; i < base + 12; i++) mem[OAM + i] = 0x77;
    nes.cpu.REG_X = slot;
    callRoutine(nes, drawOneEntity);

    // Tile 0: the baseline, both axes visible -- proves the fixture draws at all.
    const baseWorldX = entityTileWorld(swCol, 256, entX, 0);
    const baseWorldY = entityTileWorld(swRow, 240, entY, 0);
    const basePx = projectAxis(baseWorldX, originX, 0);
    const basePy = projectY(baseWorldY, originY);
    assert.equal(basePx.visible, true);
    assert.equal(basePy.visible, true);
    assert.equal(mem[OAM + base], basePy.oamY);
    assert.equal(mem[OAM + base + 3], basePx.byte);

    // Tile 1: x offset +127 pushes world X to 327 -- a real screen crossing (deltaHi=1), which
    // must park. A naive project-origin-then-add-offset-to-the-OAM-byte implementation would
    // instead compute 200 + 127 = 327 mod 256 = 71, a small, entirely plausible-looking (and
    // wrong) visible X.
    const xOverflowWorld = entityTileWorld(swCol, 256, entX, 127);
    const xOverflowPx = projectAxis(xOverflowWorld, originX, 0);
    assert.equal(xOverflowPx.visible, false, 'sanity: the offset must genuinely cross a screen boundary');
    assert.equal(mem[OAM + base + 4], 0xff, 'an X offset that crosses a screen boundary on its own must park, not wrap to 71');
    assert.equal(mem[OAM + base + 4 + 3], 0x77, "a parked tile's own OAM X byte must be untouched");

    // Tile 2: y offset +127 pushes world Y to 277 -- likewise a real screen crossing.
    const yOverflowWorld = entityTileWorld(swRow, 240, entY, 127);
    const yOverflowPy = projectY(yOverflowWorld, originY);
    assert.equal(yOverflowPy.visible, false, 'sanity: the offset must genuinely cross a screen boundary');
    assert.equal(mem[OAM + base + 8], 0xff, 'a Y offset that crosses a screen boundary on its own must park');
  }
);
