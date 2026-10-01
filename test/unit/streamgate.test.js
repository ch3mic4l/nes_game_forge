// Phase 3a slice S1, plan section 5.4 "Hard assertions in the unit suite", rows M0-M2 of the
// workload manifest (section 5.3), both game types (action, rpg). Everything here is measured by
// calling the real engine routine engine/entities.asm `draw_entities` in the real built ROM through
// the callRoutine stub (test/lib/streamgatecost.js), with the emulator core's own per-instruction
// cycle count. This is the CHEAP layer: cycle-exact for one routine, blind to coincident NMI work
// (the Mesen full-system sweep, test/fixtures/streambound-curve.json, is the landing figure).
//
// What each test proves, and why it is not vacuous
//   scene       the population is what the rows claim: eight actors, sum of their largest pose
//               (shared/project.js streamTiles, the figure the Map Forge warning uses) === the real
//               STREAM_TILE_BOUND (15), distribution 2,2,2,2,2,2,2,1, art really animated (two frames,
//               frame 0 the costliest), every entity put on that frame.
//   M1          all B tiles take the INSIDE class: PC hits on dsw_in_tile === B and none on
//               dsw_st_tile / dsw_cull_tile, all B tiles actually drawn (no $FF Y byte).  Without
//               the class guard a mis-built scene (say every actor culled) would be a cheap, passing
//               "measurement".
//   M2          the worst class: bounds widened by a NON-drawn pose of one actor, so every tile takes
//               the STRADDLE path (dsw_st_tile === B) while all B tiles still land on screen and are
//               written (the costliest straddle).  M2e (extra row) is the tight art placed across the
//               screen edges: straddle with parked tiles.
//   D bands     D === measured +- MARGIN, so a mis-built scene that happens to be cheaper OR dearer
//               fails; MARGIN is stated, never a round hardware number.
//   M0          a streaming project whose CURRENT map is ordinary: the S1 ROM's draw output equals
//               the PARENT ROM's (commit 99d4156, built from that commit's own tree) in all 256 OAM
//               bytes, oam_idx and the RAM the draw touches, and the cycle delta of one
//               draw_entities call equals the itemised fixed overhead, decoded from the ROM's own
//               hook bytes (a JSR to sw_ent_setup that answers `map_is_streamed == 0` with an RTS).
//               The hook decode pins the exact instructions, so a hook that grows fails.
//   regression  ROW_MULTIPLY_REGRESSION_THRESHOLD is a PERFORMANCE-REGRESSION threshold (the measured
//               D at B plus MARGIN), asserted in the M1/M2 tests. It is not the 29,780-cycle hardware
//               gate (that is the Mesen figure's) and is not tightened to catch a chosen mutant; the
//               sabotage that reintroduces a per-tile row-base multiply reports what it does to it.
//
// RAM addresses are transcribed from engine/constants.asm (a test that parsed the file it checks
// would prove nothing); code labels come from the built game.fns.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { STREAM_TILE_BOUND } from '../../shared/streambound.js';
import { streamTiles } from '../../shared/project.js';
import { setState, oracleText } from '../lib/streamprojoracle.js';
import {
  hasNesasm, R, gateProject, sizesFor, inside, crossing, sceneState, SCREEN_INDEX,
  boot, buildBooted, buildParent, dropParentTree, runStreamedDraw, callCounted, decodeSpan, sumCycles
} from '../lib/streamgatecost.js';

const skip = !hasNesasm && 'nesasm not on PATH';
const B = STREAM_TILE_BOUND;
const TYPES = ['action', 'rpg'];
const OAM_BUSY = 0xf8; // from engine/constants.asm
const MAP_IS_STREAMED = 0xfe; // from engine/constants.asm

// ---- the measured figures (cycles of ONE draw_entities call, the callRoutine stub's own 6-cycle
// JSR included, jsnes cpu.emulate() counting) at B = 15, 2026-10-01 (S1 option (a1): the shipped bound is one below the
// certified 16), engine with the S1 projection. (At B = 18, 2026-09-29: M1 5002, M2 5723 on action. M2e is
// not at B: it is measured on the pinned FIXED_SIZES population, below, and kept at its B = 18 figures.)
// Measured by this file's own runs (each test prints its figure); update deliberately if the engine's
// draw legitimately changes.
const MEASURED_D = {
  action: { M1: 4812, M2: 5353, M2e: 5696 },
  rpg: { M1: 4812, M2: 5354, M2e: 5694 }
};
// MARGIN is 1.5% of the measured figure, rounded up to the next 10 cycles. The emulation is
// deterministic, so the margin only exists to let an intentional, small engine change through; a
// larger change must re-measure here.
const marginFor = (measured) => Math.ceil((measured * 0.015) / 10) * 10;
// A PERFORMANCE-REGRESSION threshold per game type and row: the measured D at B plus its margin.
// Not the hardware frame gate (29,780 is the Mesen full-system figure's), and not tightened to make
// any mutant fail. Sabotage 7 (a per-tile sw_oam_rowbase multiply in the inside path) is judged
// against this and its actual result is reported, whichever way it falls.
export const ROW_MULTIPLY_REGRESSION_THRESHOLD = Object.freeze({
  action: Object.freeze({ M1: MEASURED_D.action.M1 + marginFor(MEASURED_D.action.M1), M2: MEASURED_D.action.M2 + marginFor(MEASURED_D.action.M2), M2e: MEASURED_D.action.M2e + marginFor(MEASURED_D.action.M2e) }),
  rpg: Object.freeze({ M1: MEASURED_D.rpg.M1 + marginFor(MEASURED_D.rpg.M1), M2: MEASURED_D.rpg.M2 + marginFor(MEASURED_D.rpg.M2), M2e: MEASURED_D.rpg.M2e + marginFor(MEASURED_D.rpg.M2e) })
});

// ---- builds, once per game type
const cache = new Map();
function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}
const sizes = sizesFor(B);
// Two rows are about the GEOMETRY of one population, not about the bound, and pin FIXED_SIZES (the B = 18 even split) so the bound
// moving does not change what they are asked of. M2e places the three bottom-edge actors at y 234 so that their second row of tiles
// (a 3-tile pose) parks, and five actors across the right edge; with fewer tiles per actor the bottom actors would not cross at all
// and the five-poses-park claim would not hold. M0 compares an ordinary-map draw with the PARENT ROM's, and its cycle delta (the itemised hook, 19) holds only for a population
// whose draw loop meets the same page-crossing branches in both ROMs: measured 2026-10-01 on action, the delta is 19 for
// 3,3,2,2,2,2,2,2 and 3,2,2,2,2,2,2,2 and 12 for 2,2,2,2,2,2,2,1 and 2,2,2,2,2,2,2,2 (S1 is then 7 cycles CHEAPER than parent plus
// hook: code alignment in the unmodified draw loop, not the hook), and the other way round on RPG for 1,1,1,1,1,1,1,1. So M0 pins
// its own population instead of following the bound, which moved from 18 to 15 and would otherwise have changed what the
// exact-equality assertion is asked of.
const FIXED_SIZES = [3, 3, 2, 2, 2, 2, 2, 2];
const FIXED_TILES = FIXED_SIZES.reduce((a, b) => a + b, 0);
const m0Tight = (type) => memo(`m0-tight-${type}`, () => buildBooted(gateProject({ gameType: type, sizes: FIXED_SIZES })));
const m0Parent = (type) => memo(`m0-parent-${type}`, () => buildParent(gateProject({ gameType: type, sizes: FIXED_SIZES })));
const tight = (type) => memo(`tight-${type}`, () => buildBooted(gateProject({ gameType: type, sizes })));
const wideRom = (type) => memo(`wide-${type}`, () => buildBooted(gateProject({ gameType: type, sizes, wide: true })));
const parent = (type) => memo(`parent-${type}`, () => buildParent(gateProject({ gameType: type, sizes })));
after(() => dropParentTree());

const parkedTiles = (oam, from, count) => { let n = 0; for (let i = 0; i < count; i++) if (oam[from + i * 4] === 0xff) n++; return n; };
const PLAYER_BYTES = 16; // oam_idx at entry: four player sprites
const log = (s) => console.log(`streamgate: ${s}`);

// ---------------------------------------------------------------------------------------------
test('scene: eight actors, animated two-frame art, totalling exactly STREAM_TILE_BOUND tiles', { skip }, () => {
  assert.deepEqual(sizes, [2, 2, 2, 2, 2, 2, 2, 1], 'eightSplit(B), the even split, at B = 15');
  assert.equal(B, 15, 'STREAM_TILE_BOUND moved: re-measure MEASURED_D below (and the distribution above)');
  for (const wide of [false, true]) {
    const p = gateProject({ gameType: 'action', sizes, wide });
    const screen = p.maps[0].screens[SCREEN_INDEX];
    assert.equal(screen.entities.length, 8);
    assert.equal(streamTiles(p, screen), B, 'the shared per-screen sprite-tile figure is B');
    p.sprites.actors.forEach((a, i) => {
      const frames = p.sprites.animations[a.anims.walkDown].frames;
      assert.equal(frames.length, 2, 'real animation, two frames');
      const counts = frames.map((f) => p.sprites.metasprites[f.metaspriteId].tiles.length);
      assert.equal(counts[0], sizes[i]);
      assert.ok(counts[1] <= counts[0], 'frame 0 is the costliest pose');
    });
  }
});

// ---------------------------------------------------------------------------------------------
for (const type of TYPES) {
  test(`M1 [${type}]: all ${B} tiles INSIDE; D within the band and under the regression threshold`, { skip }, async () => {
    const built = await tight(type);
    const st = sceneState({ place: inside });
    const r = runStreamedDraw(built, st);
    assert.equal(r.hits.setup, 1, 'sw_ent_setup ran once');
    assert.deepEqual([r.hits.inside, r.hits.straddle, r.hits.cull], [B, 0, 0], 'every tile took the inside class');
    assert.equal(parkedTiles(r.oam, PLAYER_BYTES, B), 0, 'all tiles drawn');
    assert.equal(r.oamIdx, PLAYER_BYTES + 4 * B, 'oam_idx advanced by exactly B tiles');
    const M = MEASURED_D[type].M1;
    const margin = marginFor(M);
    log(`D [${type}, M1 inside] = ${r.cycles} cycles (measured ${M}, margin ${margin}, threshold ${ROW_MULTIPLY_REGRESSION_THRESHOLD[type].M1})`);
    assert.ok(r.cycles <= ROW_MULTIPLY_REGRESSION_THRESHOLD[type].M1, `M1 D ${r.cycles} exceeds the regression threshold ${ROW_MULTIPLY_REGRESSION_THRESHOLD[type].M1}`);
    assert.ok(r.cycles <= M + margin, `M1 D ${r.cycles} > measured ${M} + ${margin}`);
    assert.ok(r.cycles >= M - margin, `M1 D ${r.cycles} < measured ${M} - ${margin}: the scene is cheaper than the row claims`);
  });

  test(`M2 [${type}]: all ${B} tiles STRADDLE (drawn); D within the band and under the regression threshold`, { skip }, async () => {
    const built = await wideRom(type);
    const st = sceneState({ place: inside });
    const r = runStreamedDraw(built, st);
    assert.equal(r.hits.setup, 1);
    assert.deepEqual([r.hits.inside, r.hits.straddle, r.hits.cull], [0, B, 0], 'every tile took the straddle class');
    assert.equal(parkedTiles(r.oam, PLAYER_BYTES, B), 0, 'and every one is written on screen: the costliest straddle');
    const M = MEASURED_D[type].M2;
    const margin = marginFor(M);
    log(`D [${type}, M2 straddle] = ${r.cycles} cycles (measured ${M}, margin ${margin}, threshold ${ROW_MULTIPLY_REGRESSION_THRESHOLD[type].M2})`);
    assert.ok(r.cycles <= ROW_MULTIPLY_REGRESSION_THRESHOLD[type].M2, `M2 D ${r.cycles} exceeds the regression threshold ${ROW_MULTIPLY_REGRESSION_THRESHOLD[type].M2}`);
    assert.ok(r.cycles <= M + margin, `M2 D ${r.cycles} > measured ${M} + ${margin}`);
    assert.ok(r.cycles >= M - margin, `M2 D ${r.cycles} < measured ${M} - ${margin}: the scene is cheaper than the row claims`);
  });

  test(`M2e [${type}]: tight art placed across the screen edges -> STRADDLE with parked tiles`, { skip }, async () => {
    const built = await m0Tight(type); // FIXED_SIZES, see above
    const st = sceneState({ place: crossing });
    const r = runStreamedDraw(built, st);
    assert.equal(r.hits.setup, 1);
    assert.deepEqual([r.hits.inside, r.hits.straddle, r.hits.cull], [0, FIXED_TILES, 0], 'every tile took the straddle class');
    const parked = parkedTiles(r.oam, PLAYER_BYTES, FIXED_TILES);
    // a tile parks when its top-left is at or past the screen's right edge (x > 255) or bottom edge (y > 239); the
    // art is a 4-wide grid of 8x8 tiles (test/lua/sw_manifest_scene.mjs grid()), so the count is derived, not eyeballed
    const expectedParked = FIXED_SIZES.reduce((total, k, i) => {
      const at = crossing(i);
      let n = 0;
      for (let t = 0; t < k; t++) if (at.x + (t % 4) * 8 > 255 || at.y + Math.floor(t / 4) * 8 > 239) n++;
      return total + n;
    }, 0);
    assert.equal(parked, expectedParked, `the tiles beyond an edge park, and only those (got ${parked})`);
    assert.ok(parked >= 5 && parked < FIXED_TILES, 'the five right-edge poses each park at least one tile, and not all of them');
    const M = MEASURED_D[type].M2e;
    const margin = marginFor(M);
    log(`D [${type}, M2e edge-crossing, ${parked} parked] = ${r.cycles} cycles (measured ${M}, margin ${margin}, threshold ${ROW_MULTIPLY_REGRESSION_THRESHOLD[type].M2e})`);
    assert.ok(r.cycles <= ROW_MULTIPLY_REGRESSION_THRESHOLD[type].M2e);
    assert.ok(r.cycles <= M + margin, `M2e D ${r.cycles} > measured ${M} + ${margin}`);
    assert.ok(r.cycles >= M - margin, `M2e D ${r.cycles} < measured ${M} - ${margin}`);
  });
}

// ---------------------------------------------------------------------------------------------
// The shipped per-tile routine (the same project with the projection disabled by a Code Forge
// override, test/lib/streamprojoracle.js oracleText) is what the projection replaces. S1 is a defect
// fix and may not worsen a frame: on every row it must cost strictly less, for identical output.
for (const type of TYPES) {
  test(`reference [${type}]: S1 is cheaper than the shipped per-tile routine on M1, M2 and M2e, with identical output`, { skip }, async () => {
    const override = [{ name: 'streamworld.asm', text: oracleText() }];
    const rows = [
      ['M1', () => tight(type), () => buildBooted(gateProject({ gameType: type, sizes }), override), inside],
      ['M2', () => wideRom(type), () => buildBooted(gateProject({ gameType: type, sizes, wide: true }), override), inside],
      ['M2e', () => tight(type), () => buildBooted(gateProject({ gameType: type, sizes }), override), crossing]
    ];
    for (const [row, s1Build, shippedBuild, place] of rows) {
      const s1 = runStreamedDraw(await s1Build(), sceneState({ place }));
      const shipped = runStreamedDraw(await shippedBuild(), sceneState({ place }));
      log(`reference [${type}, ${row}]: shipped per-tile routine ${shipped.cycles} cycles, S1 ${s1.cycles}`);
      const built = await shippedBuild();
      assert.equal(built.code.dsw_in_tile, undefined, 'the override really assembled the shipped routine: the projection labels do not exist');
      assert.deepEqual(s1.oam, shipped.oam, `${row}: identical shadow`);
      assert.equal(s1.oamIdx, shipped.oamIdx);
      assert.ok(s1.cycles < shipped.cycles, `${row}: S1 ${s1.cycles} is not cheaper than the shipped ${shipped.cycles}`);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// M0
const rel = (b) => (b > 127 ? b - 256 : b);

/**
 * The S1 hooks that sit in the fixed kernel, decoded from the built bytes. Returns the itemised
 * cycle costs: the draw_entities hook on an ORDINARY current map (`hook`), and the per-frame hooks in
 * the main loop and NMI (`frame`, reported; they are not inside draw_entities so callRoutine does not
 * see them).
 */
function itemiseHooks(rom, c) {
  const items = {};
  // draw_entities' call site: exactly one JSR, to sw_ent_setup
  const call = decodeSpan(rom, c.proj_setup_call, c.proj_setup_call_end);
  assert.deepEqual(call.map((x) => x.mn), ['JSR']);
  assert.equal(call[0].bytes[1] | (call[0].bytes[2] << 8), c.sw_ent_setup, 'the hook calls sw_ent_setup');
  // sw_ent_setup on a non-streamed map: LDA map_is_streamed ; BEQ done (taken) ; done: RTS
  const head = decodeSpan(rom, c.sw_ent_setup, c.sw_ent_setup + 4, { taken: true });
  assert.deepEqual(head.map((x) => x.mn), ['LDA zp', 'BEQ']);
  assert.deepEqual(head[0].bytes, [0xa5, MAP_IS_STREAMED]);
  assert.equal(head[1].addr + 2 + rel(head[1].bytes[1]), c.sw_ent_setup_done, 'the early-out branch lands on the RTS');
  const done = decodeSpan(rom, c.sw_ent_setup_done, c.sw_ent_setup_done + 1);
  assert.deepEqual(done.map((x) => x.mn), ['RTS']);
  items.hook = [...call, ...head, ...done];
  items.hookCycles = sumCycles(items.hook);

  // the per-frame hooks (reported, and pinned so they cannot grow unnoticed)
  const set = (from, to, imm) => {
    const s = decodeSpan(rom, from, to);
    assert.deepEqual(s.map((x) => x.bytes), [[0xa9, imm], [0x85, OAM_BUSY]]);
    return sumCycles(s);
  };
  const initSpan = decodeSpan(rom, c.oam_busy_init, c.oam_busy_init_end);
  assert.deepEqual(initSpan.map((x) => x.bytes), [[0x85, OAM_BUSY]]);
  const nmi = decodeSpan(rom, c.oam_busy_nmi, c.oam_busy_nmi_end);
  assert.deepEqual(nmi.map((x) => x.mn), ['LDA zp', 'BNE']);
  assert.deepEqual(nmi[0].bytes, [0xa5, OAM_BUSY]);
  assert.equal(nmi[1].addr + 2 + rel(nmi[1].bytes[1]), c.nmi_oam_skip, 'the NMI test skips the DMA when a shadow is busy');
  items.frame = {
    setUi: set(c.oam_busy_set_ui, c.oam_busy_set_ui_end, 1),
    setDraw: set(c.oam_busy_set_draw, c.oam_busy_set_draw_end, 1),
    clear: set(c.oam_busy_clear, c.oam_busy_clear_end, 0),
    init: sumCycles(initSpan),
    nmiIdle: sumCycles(nmi) // oam_busy == 0: branch not taken
  };
  return items;
}

const memDiff = (a, b, ranges) => {
  const out = [];
  for (const [lo, hi] of ranges) for (let i = lo; i <= hi; i++) if (a[i] !== b[i]) out.push(i);
  return out;
};

const M0_STATES = {
  'inside positions': () => sceneState({ place: inside }),
  'edge-crossing positions': () => sceneState({ place: crossing }),
  'shadow nearly full (oam_idx 200, wraps to full)': () => sceneState({ place: inside, oamIdx: 200 }),
  'x/y wrap around the byte, struck actors': () => {
    const st = sceneState({ place: (i) => ({ x: 200 + i * 7, y: 210 + i * 5 }), oamIdx: 24 });
    st.ents[2].hurt = 3; st.ents[5].hurt = 1;
    return st;
  }
};

for (const type of TYPES) {
  test(`M0 [${type}]: ordinary current map -- output equals the parent's, cycle delta equals the itemised fixed overhead`, { skip }, async () => {
    const s1 = await m0Tight(type);
    const par = await m0Parent(type);
    const items = itemiseHooks(s1.rom, s1.code);
    log(`M0 [${type}] itemised draw_entities hook on an ordinary map = ${items.hookCycles} cycles: ` +
      items.hook.map((x) => `${x.mn} ${x.cyc}`).join(', '));
    log(`M0 [${type}] per-frame hooks (main loop / NMI, not inside draw_entities): set_draw ${items.frame.setDraw}, clear ${items.frame.clear}, ` +
      `set_ui ${items.frame.setUi} (UI frames only), init_session ${items.frame.init}, NMI test ${items.frame.nmiIdle} cycles`);
    assert.equal(par.code.sw_ent_setup, undefined, 'the parent has no projection setup: the baseline is the shipped routine');
    const names = [];
    for (const [name, make] of Object.entries(M0_STATES)) {
      const st = make();
      // a freshly booted core per side and per state: the two start from the identical power-on RAM
      const sides = [s1, par].map((b) => {
        const nes = boot(b.rom);
        setState(nes, st);
        nes.cpu.mem[MAP_IS_STREAMED] = 0; // the current map is ordinary
        nes.cpu.mem[OAM_BUSY] = 0;
        return nes;
      });
      const a = callCounted(sides[0], s1.code.draw_entities, { setup: s1.code.sw_ent_setup, inside: s1.code.dsw_in_tile, straddle: s1.code.dsw_st_tile, cull: s1.code.dsw_cull_tile });
      const b = callCounted(sides[1], par.code.draw_entities, {});
      assert.deepEqual([a.hits.setup, a.hits.inside, a.hits.straddle, a.hits.cull], [1, 0, 0, 0], `${name}: the hook ran once and no projection class was entered`);
      // output: all 256 OAM bytes and oam_idx
      const oa = Array.from(sides[0].cpu.mem.slice(R.OAM, R.OAM + 256));
      const ob = Array.from(sides[1].cpu.mem.slice(R.OAM, R.OAM + 256));
      assert.deepEqual(oa, ob, `${name}: all 256 OAM bytes equal the parent's`);
      assert.equal(sides[0].cpu.mem[R.OAM_IDX], sides[1].cpu.mem[R.OAM_IDX], `${name}: oam_idx equals the parent's`);
      // RAM effects: the whole zero page and the variable pages $0200-$06FF (OAM shadow included). Not compared: the stack page
      // ($0100-$01FF) and the stub page ($0700), which hold return addresses and the stub itself.
      const diff = memDiff(sides[0].cpu.mem, sides[1].cpu.mem, [[0x00, 0xff], [0x200, 0x6ff]]);
      assert.deepEqual(diff.map((x) => '$' + x.toString(16)), [], `${name}: no RAM byte differs from the parent's`);
      names.push(`${name}: OAM (256 bytes), oam_idx, zero page and $0200-$06FF identical`);
      // cycles
      const delta = a.cycles - b.cycles;
      log(`M0 [${type}] "${name}": S1 ${a.cycles}, parent ${b.cycles}, delta ${delta} (itemised ${items.hookCycles})`);
      assert.equal(delta, items.hookCycles, `${name}: cycle delta is exactly the itemised hook cost`);
    }
    log(names.join('\n           '));
  });
}
