// Phase 3a slice S1: the streamed entity projection (engine/streamworld.asm, sw_ent_setup ..
// draw_one_entity_show_sw under `.if STREAM_PROJ_ENABLED`) against its ORACLE -- the shipped per-tile
// routine, assembled from the same tree by a Code Forge override that turns the S1 block off
// (test/lib/streamprojoracle.js). Both ROMs are booted, given identical RAM, and draw_entities is run
// in each; all 256 shadow bytes and oam_idx must be equal.
//
// What each test proves, and why it is not vacuous
//   T1   random corpus, fixed seeds, six art sets x both game types: whole-shadow equality. Vacuity
//        guards: PC hooks on dsw_cull / dsw_straddle / dsw_in_tile in the S1 ROM count how often each
//        class really ran (per art set, the classes the art can reach must each be > 0, and the classes
//        it cannot reach must be exactly 0, which also pins the generated SW_U* bounds); the corpus is
//        also counted for zero-tile poses, NO_ANIM actors and hurt-flicker draws, and for cases whose
//        shadow the routine really changed.
//   T1b  boundary pins: every tile-under-test placed at screen Y in {-2,-1,0,1,2,100,238..241,248} and
//        X in {-2,-1,0,1,20,100,254..257,264}, from three entity placements, on the extreme tiles of
//        every pose, with the shadow PREFILLED by a distinct pattern so a byte the routine did not write
//        is visible. Then hand-computed expectations, independent of the oracle, on single-tile art:
//        Y=0 -> tile/attr/X written and Y byte $FF; Y=240 -> Y byte $FF only; Y=-1 -> parked; Y=1 ->
//        Y byte 0; and the class each lands in. Plus the cull threshold itself.
//   T2   a culled actor followed by a visible one: the visible one's slots land where the oracle put
//        them AND where hand arithmetic says (16 + 4 x the culled actor's tile count).
//   T3   8 actors x 16 tiles overflowing oam_idx mid-actor and at the last actor: byte-equal to the
//        shipped wrapping output.
//   M    mutant detection: five S1 ROMs, each assembled from the S1 text with ONE defect, must all be
//        caught by the same comparison (so the suite proves its own discriminating power). Each is
//        also required to pass with the defect removed (the positive control is every test above).
//
// Skipped only when nesasm is absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ART_NAMES, MUTANTS, PIN_PREFILL,
  hasNesasm, loadPair, makeRng, randomState, runCase, describeMismatch, pinCases, classOf, expectedSlot,
  facingAnim
} from '../lib/streamprojoracle.js';

const skip = !hasNesasm && 'nesasm not found on PATH';
const GAME_TYPES = ['action', 'rpg'];
const CORPUS_N = 600; // per art set per game type
const seedFor = (art, gt) => 12345 + ART_NAMES.indexOf(art) * 7919 + (gt === 'rpg' ? 104729 : 0);

const pairCache = new Map();
function getPair(art, gt, mutant = null) {
  const key = `${art}/${gt}/${mutant ?? ''}`;
  if (!pairCache.has(key)) pairCache.set(key, loadPair(art, gt, { mutant }));
  return pairCache.get(key);
}

// Classes an art set can and cannot reach (bounds: inside needs xmax-xmin <= 255 and ymax-ymin <= 239).
const EXPECT_CLASSES = {
  small: { must: ['cull', 'inside', 'straddle'], never: [] },
  wide: { must: ['cull', 'straddle'], never: ['inside'] },
  mid: { must: ['cull', 'inside', 'straddle'], never: [] },
  edge: { must: ['cull', 'straddle'], never: ['inside'] },
  late: { must: ['cull', 'inside', 'straddle'], never: [] },
  unit: { must: ['cull', 'inside', 'straddle'], never: [] }
};
const hitsToClasses = (h) => ({ cull: h.dsw_cull ?? 0, straddle: h.dsw_straddle ?? 0, inside: h.dsw_in_tile ?? 0 });

function runCorpus(pair, n, seed) {
  const rng = makeRng(seed);
  const hits = {};
  const feat = { cases: 0, bad: 0, changed: 0, noAnim: 0, zeroTile: 0, hurtSkip: 0, first: null };
  const P = pair.project.sprites;
  for (let k = 0; k < n; k++) {
    const st = randomState(pair, rng);
    const r = runCase(pair, st, hits);
    feat.cases++;
    if (!r.ok) { feat.bad++; feat.first ??= describeMismatch(pair, st, r); }
    if (r.ob.some((v, i) => v !== st.prefill[i])) feat.changed++;
    for (const e of st.ents) {
      if (!e) continue;
      const an = facingAnim(pair.actors[e.actor], e.dir);
      if (an === null) { feat.noAnim++; continue; }
      const f = P.animations[an].frames[e.frame];
      if (!f || !P.metasprites[f.metaspriteId].tiles.length) feat.zeroTile++;
      if (e.hurt & 2) feat.hurtSkip++;
    }
  }
  return { hits: hitsToClasses(hits), ...feat };
}

// ------------------------------------------------------------------------------------------------ T1
for (const gt of GAME_TYPES) {
  for (const art of ART_NAMES) {
    test(`T1 whole-shadow oracle: ${art} art, ${gt} game (${CORPUS_N} seeded states)`, { skip }, async (t) => {
      const pair = await getPair(art, gt);
      const r = runCorpus(pair, CORPUS_N, seedFor(art, gt));
      t.diagnostic(`T1 ${art}/${gt}: seed ${seedFor(art, gt)}, ${r.cases} cases, classes ${JSON.stringify(r.hits)}, ` +
        `noAnim ${r.noAnim}, zeroTile ${r.zeroTile}, hurtSkip ${r.hurtSkip}, shadow changed in ${r.changed}`);
      assert.equal(r.bad, 0, `every case must match the oracle; first: ${r.first}`);
      const want = EXPECT_CLASSES[art];
      for (const c of want.must) assert.ok(r.hits[c] > 0, `${art}/${gt}: the corpus never exercised the ${c} class (${JSON.stringify(r.hits)}) -- vacuous`);
      for (const c of want.never) assert.equal(r.hits[c], 0, `${art}/${gt}: this art's bounds make the ${c} class unreachable, but it ran`);
      assert.ok(r.changed > r.cases / 2, 'most cases must actually draw something');
      if (art === 'small') {
        assert.ok(r.noAnim > 0, 'small art carries an actor with no animation (NO_ANIM)');
        assert.ok(r.zeroTile > 0, 'small art carries a zero-tile pose (ms_count = 0) and a zero-frame animation');
        assert.ok(r.hurtSkip > 0, 'hurt flicker must appear in the corpus');
      }
    });
  }
}

// ------------------------------------------------------------------------------------------------ T1b
function runPins(pair, opts) {
  const reach = { cull: new Set(), inside: new Set(), straddle: new Set() };
  const counts = { cull: 0, inside: 0, straddle: 0, none: 0 };
  let total = 0, bad = 0, first = null;
  for (const c of pinCases(pair, opts)) {
    const hits = {};
    const r = runCase(pair, c.st, hits);
    total++;
    const cls = classOf(hits);
    counts[cls]++;
    if (reach[cls]) { reach[cls].add('y' + c.ty); reach[cls].add('x' + c.tx); }
    if (!r.ok) { bad++; first ??= describeMismatch(pair, c.st, r) + ` pin(tile ${c.ti} at x=${c.tx} y=${c.ty})`; }
  }
  return { total, bad, first, reach, counts };
}
const PIN_Y = [-1, 0, 1, 239, 240];
const PIN_X = [-1, 0, 255, 256];

for (const gt of GAME_TYPES) {
  for (const art of ART_NAMES) {
    test(`T1b boundary pins vs oracle: ${art} art, ${gt} game`, { skip }, async (t) => {
      const pair = await getPair(art, gt);
      const r = runPins(pair);
      t.diagnostic(`T1b ${art}/${gt}: ${r.total} pin cases, classes ${JSON.stringify(r.counts)}`);
      assert.ok(r.total > 300, 'a real pin set');
      assert.equal(r.bad, 0, `every pin must match the oracle; first: ${r.first}`);
      assert.equal(r.counts.none, 0, 'every case must reach one of the three classes');
    });
  }

  test(`T1b every boundary value is reached in the classes that can reach it (${gt} game)`, { skip }, async (t) => {
    // straddle: every boundary value, on the art that cannot go inside; inside: on art whose bounds are 0
    const edge = runPins(await getPair('edge', gt));
    const unit = runPins(await getPair('unit', gt));
    const late = runPins(await getPair('late', gt));
    t.diagnostic(`reach ${gt}: straddle(edge) ${[...edge.reach.straddle].sort().join(' ')}`);
    t.diagnostic(`reach ${gt}: inside(unit) ${[...unit.reach.inside].sort().join(' ')}`);
    for (const y of PIN_Y) assert.ok(edge.reach.straddle.has('y' + y), `straddle never reached Y=${y}`);
    for (const x of PIN_X) assert.ok(edge.reach.straddle.has('x' + x), `straddle never reached X=${x}`);
    for (const y of [0, 1, 239]) assert.ok(unit.reach.inside.has('y' + y), `inside never reached Y=${y}`);
    for (const x of [0, 255]) assert.ok(unit.reach.inside.has('x' + x), `inside never reached X=${x}`);
    assert.ok(edge.reach.straddle.has('y2') && late.counts.inside + late.counts.straddle > 0);
    assert.equal(edge.bad + unit.bad + late.bad, 0, 'and all three agree with the oracle');
  });

  test(`T1b hand-computed slot bytes, independent of the oracle, and their classes (${gt} game)`, { skip }, async (t) => {
    // Single-tile art, tile 0 of metasprite 0: tile byte $30, attribute 0. Screen positions p in
    // ys x xs: cull if either coordinate is outside [-128,383] (base high byte not 0/$FF); inside if
    // both are on screen (the bounds are exactly 0); otherwise straddle.
    const pair = await getPair('unit', gt);
    const ys = [-200, -129, -128, -2, -1, 0, 1, 100, 238, 239, 240, 241, 383, 384, 400];
    const xs = [-200, -129, -128, -2, -1, 0, 1, 100, 254, 255, 256, 257, 383, 384, 400];
    const written = [0x30, 0x00];
    let n = 0;
    const seen = { cull: 0, inside: 0, straddle: 0 };
    for (const ty of ys) for (const tx of xs) for (const [col, row, ex, ey] of [[1, 1, 100, 100], [2, 1, 250, 230]]) {
      const st = {
        prefill: PIN_PREFILL.slice(), oamIdx: 16, col, row,
        ents: [{ actor: 0, dir: 0, frame: 0, x: ex, y: ey, hurt: 0 }, ...Array(7).fill(null)],
        ox: (col * 256 + ex - tx) & 0xffff, oy: (row * 240 + ey - ty) & 0xffff
      };
      const hits = {};
      const r = runCase(pair, st, hits);
      const want = expectedSlot(PIN_PREFILL, 16, tx, ty, written);
      const where = `unit/${gt}: tile at x=${tx} y=${ty}`;
      assert.deepEqual(r.ob.slice(16, 20), want, `${where}: S1 slot`);
      assert.deepEqual(r.oa.slice(16, 20), want, `${where}: oracle slot (the hand model must agree with the shipped routine)`);
      assert.equal(r.ib, 20, `${where}: oam_idx advances by one slot whatever the class`);
      for (let i = 20; i < 256; i++) assert.equal(r.ob[i], i % 4 === 0 ? 0xff : PIN_PREFILL[i], `${where}: the park loop writes only the Y byte of each remaining slot (byte ${i})`);
      const inRange = (v, lo, hi) => v >= lo && v <= hi;
      const cls = !inRange(tx, -128, 383) || !inRange(ty, -128, 383) ? 'cull'
        : inRange(tx, 0, 255) && inRange(ty, 0, 239) ? 'inside' : 'straddle';
      assert.equal(classOf(hits), cls, `${where}: class`);
      seen[cls]++;
      n++;
    }
    t.diagnostic(`hand-computed ${gt}: ${n} cases, classes ${JSON.stringify(seen)}`);
    // the five named expectations, spelled out once so a change to expectedSlot cannot silently weaken them
    const one = (tx, ty) => {
      const st = { prefill: PIN_PREFILL.slice(), oamIdx: 16, col: 1, row: 1, ents: [{ actor: 0, dir: 0, frame: 0, x: 100, y: 100, hurt: 0 }, ...Array(7).fill(null)], ox: (256 + 100 - tx) & 0xffff, oy: (240 + 100 - ty) & 0xffff };
      return runCase(pair, st, null).ob.slice(16, 20);
    };
    assert.deepEqual(one(100, 0), [0xff, 0x30, 0x00, 100], 'Y=0: drawn, Y byte $FF');
    assert.deepEqual(one(100, 1), [0x00, 0x30, 0x00, 100], 'Y=1: Y byte 0');
    assert.deepEqual(one(100, 239), [238, 0x30, 0x00, 100], 'Y=239: Y byte 238');
    assert.deepEqual(one(100, 240), [0xff, PIN_PREFILL[17], PIN_PREFILL[18], PIN_PREFILL[19]], 'Y=240: Y byte only');
    assert.deepEqual(one(100, -1), [0xff, PIN_PREFILL[17], PIN_PREFILL[18], PIN_PREFILL[19]], 'Y=-1: parked');
    assert.deepEqual(one(255, 100), [99, 0x30, 0x00, 255], 'X=255: drawn');
    assert.deepEqual(one(256, 100), [0xff, PIN_PREFILL[17], PIN_PREFILL[18], PIN_PREFILL[19]], 'X=256: parked');
    assert.deepEqual(one(-1, 100), [0xff, PIN_PREFILL[17], PIN_PREFILL[18], PIN_PREFILL[19]], 'X=-1: parked');
    assert.deepEqual(one(0, 100), [99, 0x30, 0x00, 0], 'X=0: drawn');
  });

  test(`T1b cull threshold: base high byte $FF/$00 still admits a visible +-127 tile (${gt} game)`, { skip }, async (t) => {
    // The actor's screen position P is swept across both edges of the {-128..383} window with the
    // widest tile (offset +127 / -128) so a tile from just inside the window lands on screen.
    let n = 0, bad = 0, first = null;
    for (const art of ['edge', 'wide']) {
      const pair = await getPair(art, gt);
      for (let actor = 0; actor < pair.actors.length; actor++) {
        for (const p of [-131, -130, -129, -128, -127, -126, -97, -96, -95, 350, 380, 381, 382, 383, 384, 385, 386]) {
          for (const axis of ['x', 'y']) {
            for (const other of [40, 200]) {
              const col = 1, row = 1, ex = 100, ey = 100;
              const px = axis === 'x' ? p : other;
              const py = axis === 'y' ? p : other;
              const st = {
                prefill: PIN_PREFILL.slice(), oamIdx: 16, col, row,
                ents: [{ actor, dir: 0, frame: 0, x: ex, y: ey, hurt: 0 }, ...Array(7).fill(null)],
                ox: (col * 256 + ex - px) & 0xffff, oy: (row * 240 + ey - py) & 0xffff
              };
              const r = runCase(pair, st, null);
              n++;
              if (!r.ok) { bad++; first ??= describeMismatch(pair, st, r) + ` P(${axis})=${p}`; }
            }
          }
        }
      }
    }
    t.diagnostic(`cull threshold ${gt}: ${n} cases`);
    assert.equal(bad, 0, `first: ${first}`);
  });
}

// ------------------------------------------------------------------------------------------------ T2
// Culled actors interleaved with visible ones (small art, walkDown, frame 0): ent 0 actor 1 (8 tiles),
// ent 1 actor 0 (1 tile), ent 2 actor 2 (16 tiles), ent 3 actor 1 (8 tiles). Ents 0 and 2 sit at
// screen x = -140 (cull), ents 1 and 3 at x = 110 (250 px to the right in the same screen).
function t2State(oamIdx = 16) {
  const ents = [
    { actor: 1, dir: 0, frame: 0, x: 0, y: 100, hurt: 0 },
    { actor: 0, dir: 0, frame: 0, x: 250, y: 100, hurt: 0 },
    { actor: 2, dir: 0, frame: 0, x: 0, y: 100, hurt: 0 },
    { actor: 1, dir: 0, frame: 0, x: 250, y: 100, hurt: 0 },
    null, null, null, null
  ];
  return {
    prefill: PIN_PREFILL.slice(), oamIdx, col: 1, row: 1, ents,
    ox: (256 + 0 + 140) & 0xffff, oy: (240 + 100 - 100) & 0xffff
  };
}
for (const gt of GAME_TYPES) {
  test(`T2 slot allocation: visible actors after culled ones land where the oracle puts them (${gt} game)`, { skip }, async (t) => {
    const pair = await getPair('small', gt);
    const hits = {};
    const r = runCase(pair, t2State(), hits);
    assert.ok(r.ok, describeMismatch(pair, t2State(), r));
    assert.equal(hits.dsw_cull, 2, 'exactly the two far actors are culled');
    // hand arithmetic: 8 culled slots (16..47), 1 visible slot (48), 16 culled (52..115), 8 visible from 116
    for (let k = 0; k < 8; k++) assert.equal(r.ob[16 + 4 * k], 0xff, `culled slot ${k}`);
    assert.equal(r.ob[17], PIN_PREFILL[17], 'a culled slot keeps its tile byte');
    assert.deepEqual(r.ob.slice(48, 52), [99, 0x30, 0x00, 110], 'ent 1: tile (0,0) at (110,100) lands right after ent 0\'s 8 culled slots');
    for (let k = 0; k < 16; k++) assert.equal(r.ob[52 + 4 * k], 0xff, `culled slot ${8 + 1 + k}`);
    // ent 3: ms2 tile 0 is at (-8,-8): screen (102,92) -> Y byte 91, X 102
    assert.equal(r.ob[116], 91, 'ent 3 first tile Y');
    assert.equal(r.ob[119], 102, 'ent 3 first tile X');
    assert.equal(r.ib, 16 + 4 * (8 + 1 + 16 + 8), 'oam_idx advanced by every tile of every actor, culled or not');
    t.diagnostic(`T2 ${gt}: oam_idx ${r.ib}, cull hits ${hits.dsw_cull}, inside tiles ${hits.dsw_in_tile}`);
  });
}

// ------------------------------------------------------------------------------------------------ T3
for (const gt of GAME_TYPES) {
  test(`T3 overflow: 8 actors x 16 tiles wrap oam_idx exactly as the shipped routine does (${gt} game)`, { skip }, async (t) => {
    const pair = await getPair('small', gt);
    let cases = 0, midActor = 0;
    for (const oamIdx of [0, 16, 64, 100, 240, 252]) {
      for (const layout of ['visible', 'cull', 'alternate', 'straddle']) {
        // screen position of an entity = ent x - (ox - 256), ent y - (oy - 240)
        const ents = Array.from({ length: 8 }, (_, i) => ({
          actor: 2, dir: 0, frame: 0, hurt: 0,
          x: layout === 'visible' ? 60 + i * 10 : layout === 'alternate' ? (i % 2 ? 250 : 0) : 0,
          y: layout === 'visible' ? 80 + i * 6 : 100
        }));
        const st = {
          prefill: PIN_PREFILL.slice(), oamIdx, col: 1, row: 1, ents,
          ox: layout === 'visible' ? 256 : layout === 'straddle' ? 256 + 6 : 256 + 140, // straddle: x = -6; cull/alternate: x = -140 (+250 = 110)
          oy: 240
        };
        const hits = {};
        const r = runCase(pair, st, hits);
        assert.ok(r.ok, describeMismatch(pair, st, r));
        const drawn = (hits.dsw_in_tile ?? 0);
        if (drawn > 0 && drawn % 16 !== 0) midActor++;
        cases++;
      }
    }
    // the two named shapes: start 16 all visible wraps inside the fourth actor (16 + 3 x 64 = 208, 12 of its 16 tiles fit);
    // start 64 wraps exactly at the end of the seventh (64 + 7 x 64 = 512)
    for (const oamIdx of [16, 64]) {
      const st = {
        prefill: PIN_PREFILL.slice(), oamIdx, col: 1, row: 1,
        ents: Array.from({ length: 8 }, (_, i) => ({ actor: 2, dir: 0, frame: 0, x: 60 + i * 10, y: 80 + i * 6, hurt: 0 })),
        ox: 256, oy: 240
      };
      const hits = {};
      const r = runCase(pair, st, hits);
      assert.ok(r.ok, describeMismatch(pair, st, r));
      if (oamIdx === 16) assert.ok(hits.dsw_in_tile < 128, `start 16 wraps part-way through an actor: fewer than 128 tiles are drawn (drew ${hits.dsw_in_tile})`);
      // start 64: 64 + 7 x 64 = 512 -> the wrap lands exactly on the seventh actor's last tile, the eighth starts at 0
      if (oamIdx === 64) assert.equal(hits.dsw_in_tile, 128, 'start 64 truncates no actor');
      t.diagnostic(`T3 ${gt}: start ${oamIdx}: final oam_idx ${r.ib}, ${hits.dsw_in_tile} inside tiles drawn of 128`);
      cases++;
    }
    t.diagnostic(`T3 ${gt}: ${cases} overflow cases, ${midActor} truncated an actor part-way`);
    assert.ok(midActor > 0, 'at least one case must overflow in the middle of an actor');
  });
}

// ------------------------------------------------------------------------------------------------ M
// Mutant detection. Each mutant is the S1 text with one defect, built through the same override
// mechanism; the same comparisons that pass above must fail. `detect` returns which probe caught it.
async function detect(mutant) {
  const caught = [];
  for (const art of ['edge', 'unit', 'small']) {
    const pair = await getPair(art, 'action', mutant);
    const pins = runPins(pair);
    if (pins.bad) caught.push(`pins:${art}(${pins.bad}/${pins.total})`);
  }
  for (const art of ['small', 'wide', 'edge', 'unit']) {
    const pair = await getPair(art, 'action', mutant);
    const c = runCorpus(pair, 250, seedFor(art, 'action'));
    if (c.bad) caught.push(`corpus:${art}(${c.bad}/${c.cases})`);
  }
  const small = await getPair('small', 'action', mutant);
  const r2 = runCase(small, t2State(), {});
  if (!r2.ok) caught.push('T2');
  const edge = await getPair('edge', 'action', mutant);
  let cull = 0;
  for (let actor = 0; actor < edge.actors.length; actor++) for (const p of [-128, -127, -100, -97, 382, 383]) {
    const st = { prefill: PIN_PREFILL.slice(), oamIdx: 16, col: 1, row: 1, ents: [{ actor, dir: 0, frame: 0, x: 100, y: 100, hurt: 0 }, ...Array(7).fill(null)], ox: (256 + 100 - p) & 0xffff, oy: 240 };
    if (!runCase(edge, st, null).ok) cull++;
  }
  if (cull) caught.push(`cull-threshold(${cull})`);
  return caught;
}

const MUTANT_EXPECT = {
  'cull skips the oam_idx advance': 'T2',
  'cull threshold off by 32 (visible tile discarded)': null,
  'inside Y bound written <= 240': null,
  'OAM -1 applied before the range test': null,
  'hi-byte carry omitted in the per-tile X add': null
};
for (const name of Object.keys(MUTANTS)) {
  test(`M mutant caught by the oracle comparison: ${name}`, { skip }, async (t) => {
    const caught = await detect(name);
    t.diagnostic(`mutant "${name}" caught by: ${caught.join(', ') || 'NOTHING'}`);
    assert.ok(caught.length > 0, `mutant "${name}" passed every probe -- the suite cannot see this defect`);
    if (MUTANT_EXPECT[name]) assert.ok(caught.includes(MUTANT_EXPECT[name]), `expected the ${MUTANT_EXPECT[name]} probe to catch "${name}", got ${caught.join(', ')}`);
  });
}

test('M positive control: the unmutated S1 ROM passes every probe the mutants are run through', { skip }, async () => {
  const caught = await detect(null);
  assert.deepEqual(caught, [], 'the shipped S1 routine must pass its own detection probes');
});
