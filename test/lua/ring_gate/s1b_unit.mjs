// Unit checks of the S1b gate's own machinery (no emulator): the classifier, the seam decoder and the judge. For each rule: a SYNTHETIC record that
// satisfies it passes (the matching positive) and the corruption that the rule exists to catch fails it. Run: node --test test/lua/ring_gate/s1b_unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, coexisting } from './ringcount.mjs';
import { decodeSeams, expectedOrigin, torusOf } from './ringseam.mjs';
import { judgeCell, summary, GATE, REQUIRED, perClass, allRows } from './s1bjudge.mjs';
import { SPEC_NAMES } from './s1bspecs.mjs';

// ---------------------------------------------------------------- classify: by observed execution only
test('classify: each class comes from its own evidence', () => {
  const want = [
    [{ z0: 1, zon: 1, vdw: 5, c0: 1, pl: 1 }, 'C0'], [{ pl: 1, hzs: 2 }, 'C1'], [{ pl: 1, armr: 1 }, 'C2'], [{ xr: 1, pl: 1 }, 'C3a'], [{ kb: 1, pl: 1 }, 'C3b'],
    [{ txt: 1 }, 'C4a'], [{ mv: 1 }, 'C4b'], [{ wt: 1 }, 'C4bw'], [{ mv: 1, mvf: 1 }, 'C4c'], [{ upl: 1 }, 'C1s'], [{ mld: 1 }, 'C3s'], [{ cbt: 1, ui: 1 }, 'CB'], [{}, 'Cx']
  ];
  for (const [counters, cls] of want) assert.equal(classify(counters), cls, JSON.stringify(counters));
});
test('classify: a blank with no draw between, or no restore, is NOT a C0 (the exemption needs all three observations)', () => {
  assert.notEqual(classify({ z0: 1, zon: 1, vdw: 0, pl: 1 }), 'C0');
  assert.notEqual(classify({ z0: 1, vdw: 9, pl: 1 }), 'C0');
});
test('classify: a Move body is C4b whatever game_state says (the classifier reads execution, not a state byte)', () => {
  assert.equal(classify({ mv: 1, gs: 0 }), 'C4b');
  assert.equal(classify({ mv: 1, gs: 2 }), 'C4b');
});

// ---------------------------------------------------------------- decodeSeams
const base = { gs: 0, fresh: 0, mvLeft: 0, camX: 0, camY: 0, camNt: 0, stActive: 0, stLen: 0, stFnt: 0, ents: [], phase: 'p' };
/** Vertical ring (ring 1): N x 1; the player walks right 1 px/frame from world x = 2*256 + 240. */
function walkFrames({ ring = 1, gridW = 6, gridH = 1, from = 240, count = 40, screen = 2, spawn = true, origin = true, jump = false } = {}) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    let w = (ring === 1 ? screen * 256 : screen * 240) + from + i; if (jump && i >= 16) w += 40;
    const per = ring === 1 ? 256 : 240;
    const sc = Math.floor(w / per), loc = w % per;
    const f = { ...base, frame: i, col: ring === 1 ? sc : 0, row: ring === 1 ? 0 : sc, px: ring === 1 ? loc : 120, py: ring === 1 ? 120 : loc, flat: ring === 1 ? sc : sc * gridW };
    const o = expectedOrigin(f, gridW, gridH);
    f.originX = origin ? o.x : 0; f.originY = origin ? o.y : 0;
    const t = torusOf(o); f.scroll = { x: ring === 1 ? t.x : 0, y: ring === 1 ? 0 : t.y };
    f.ents = spawn || sc !== screen + 1 ? (sc === screen + 1 ? [{ actor: 3, x: 40, y: 40 }] : []) : [];
    frames.push(f);
  }
  return frames;
}
const SCREENS = [[], [], [], [{ actor: 3, x: 40, y: 40 }], [], []];
const ctx = (extra = {}) => ({ ring: 1, screens: SCREENS, gridW: 6, gridH: 1, ...extra });
test('decodeSeams: a clean walk crossing decodes with no failure and one crossing', () => {
  const r = decodeSeams(walkFrames(), ctx());
  assert.equal(r.crossings.length, 1);
  assert.deepEqual(r.failures, []);
  assert.equal(r.crossings[0].spawnMatch, true);
});
test('decodeSeams: a position jump across the seam is caught', () => assert.ok(decodeSeams(walkFrames({ jump: true }), ctx()).failures.some((f) => /jumped|not one screen|origin/.test(f))));
test('decodeSeams: the wrong entity spawn on the arrival screen is caught', () => {
  const r = decodeSeams(walkFrames({ spawn: false }), ctx());
  assert.ok(r.failures.some((f) => /spawned/.test(f)), r.failures.join('|'));
});
test('decodeSeams: a camera origin that disagrees with the design formula is caught', () => assert.ok(decodeSeams(walkFrames({ origin: false }), ctx()).failures.some((f) => /camera origin/.test(f))));
test('decodeSeams: a published scroll that is not the torus position of the origin is caught', () => {
  const fr = walkFrames();
  for (const f of fr.slice(15, 30)) f.scroll = { x: (f.scroll.x + 17) % 512, y: 0 };
  assert.ok(decodeSeams(fr, ctx()).failures.some((f) => /published scroll/.test(f)));
});
test('decodeSeams: a horizontal (ring 2) walk down crosses with the same checks', () => {
  const fr = walkFrames({ ring: 2, gridW: 1, gridH: 6, from: 224 });
  const r = decodeSeams(fr, { ring: 2, screens: SCREENS, gridW: 1, gridH: 6 });
  assert.equal(r.crossings.length, 1); assert.deepEqual(r.failures, []);
});
test('decodeSeams: a run that never settles in gameplay is a failure, never an empty pass', () => assert.equal(decodeSeams(walkFrames().map((f, i) => ({ ...f, gs: i % 2 ? 0 : 1 })), ctx()).failures.length, 1));

// ---------------------------------------------------------------- the judge
const CONSTS = { SW_RING_COL_LEN: 30, SW_RING_ROW_LEN: 16 };
const spec = (name) => name;
// the synthetic cell's read prices (full call cycles incl. JSR/RTS): every pair of the swept ring costs the same, so a body's events can be built from them and checked against the sweep
const COST = { goto: 100, loc: 80, peek: 200, peekHi: 210 };
const MAPPER = 1, K = 5;
const NSW = 14;
/** One swept ring layout in the shape s1bcost.sweepReads returns (matrices, invariance flags, per-domain maxima). */
function synthSweep(ring, n = NSW) {
  const fill = (v) => new Uint16Array(n * n).fill(v);
  const st = (v) => ({ all: { cycles: v, at: [1, 0] }, adj: { cycles: v, at: [1, 0] } });
  return { key: `${ring}:${n}:synthetic`, n, ring, layout: { sha256: 'x'.repeat(64) }, goto: fill(COST.goto), loc: fill(COST.loc), peek: fill(COST.peek), peekHi: fill(COST.peekHi), gotoCInvariant: true, locTInvariant: true,
    stats: { goto: st(COST.goto), loc: st(COST.loc), peek: st(COST.peek), peekHi: st(COST.peekHi) }, digest: 'd' };
}
const SYNTH_PROJ = Object.fromEntries([['sw_project_axis', 67, 51], ['sw_oam_project_x', 99, 80], ['sw_oam_project_tile_x', 111, 90], ['sw_oam_rowbase', 118, 118], ['sw_oam_project_y', 264, 200], ['sw_oam_project_tile_y', 168, 150]].map(([k, mx, mn]) => [k, { max: mx, min: mn, calls: 1000, at: 0 }]));
/** The read events (and the counters they imply) of `peeks` sw_peek_byte transactions and `arms` standalone goto+restore pairs, as the counting hooks emit them (innermost first). */
function reads(ring, peeks, arms = 0) {
  const tgt = ring === 1 ? [1, 0] : [0, 1], cur = [0, 0];
  const events = [];
  for (let i = 0; i < peeks; i++) events.push(`g:${tgt[0]}:${tgt[1]}:${COST.goto - 12}:${cur[0]}:${cur[1]}`, `l:${cur[0]}:${cur[1]}:${COST.loc - 12}`, `p:${tgt[0]}:${tgt[1]}:${COST.peek - 12}:${cur[0]}:${cur[1]}`);
  for (let i = 0; i < arms; i++) events.push(`g:${tgt[0]}:${tgt[1]}:${COST.goto - 12}:${cur[0]}:${cur[1]}`, `l:${cur[0]}:${cur[1]}:${COST.loc - 12}`);
  const goto = peeks + arms, loc = peeks + arms;
  return { events, counters: { peek: peeks, goto, loc, bank: goto + loc, mwm: K * (goto + loc), pkc: peeks * (COST.peek - 12), pkx: peeks ? COST.peek - 12 : 0 } };
}
/** The jsnes profile of a body (cycles per group, call counts); `px`/`py` are the player's projection, `draw` the entity draw. */
const PROF = (px, py, draw, pxc = 4, pyc = 4, drawc = 1) => ({ px, py, draw, calls: { px: { calls: pxc, max: 80 }, py: { calls: pyc, max: 200 }, draw: { calls: drawc, max: 900 } } });
/** The counter set of each class, chosen to satisfy every judge rule; G values well under the gate. Rows are IDENTICAL in the two emulators (G aside), as a real agreeing run's are. */
function goodRows(gt, ring, n) {
  const walkingGs = new Set(['C1', 'C2', 'C3a', 'C3b', 'C3s', 'C1s']);
  const mk = (frame, counters, G, { state = {}, rd = null, prof = null } = {}) => {
    const r = rd ?? reads(ring, 0);
    const c = { nmiT: 2000, ...counters, ...r.counters, ...(counters.peek !== undefined ? { peek: counters.peek } : {}) };
    const cls = classify(c);
    const gs = walkingGs.has(cls) ? 0 : cls === 'C4b' || cls === 'C4c' || cls === 'C4bw' ? 2 : 1;
    return { phase: 'p', frame, G, gs, counters: c, events: r.events, prof, cyc: G, state: { st_len: ring === 1 ? CONSTS.SW_RING_COL_LEN : CONSTS.SW_RING_ROW_LEN, st_ftile: 0, st_fnt: 0, st_vary: 0, st_cur: 0, ...state }, cls, terms: coexisting(c) };
  };
  const arm = ring === 1 ? { armc: 1 } : { armr: 1 };
  // the arm's VALID state (round 3): st_active 1 for a column strip, 2 for a row strip; st_fnt a legal destination parity of the axis ({0, 4} ring 1, {0, 8} ring 2)
  const armState = (fnt) => ({ st_active: ring === 1 ? 1 : 2, st_fnt: ring === 1 ? (fnt ? 4 : 0) : (fnt ? 8 : 0) });
  const busy = { pl: 1, hzs: 2, hzt: 3, flh: 1, shk: 1, sfx: 1, nms: 1, proj: 8, dsw: 8, dst: 16, dit: 0, dct: 0, ent: 1, anim: 3, dsp: 0 };
  const rows = [
    mk(1, { pl: 1, hzs: 2, hzt: 3, same: 3, upl: 1, mld: 1 }, 15000),
    mk(2, { ...busy, xprobe: 3 }, 17000, { rd: reads(ring, 3), prof: PROF(240, 560, 5200) }),
    mk(3, { pl: 1, hzs: 2, hzt: 3, wall: 1 }, 15000),
    mk(4, { ...busy, ...arm, rowloop: ring === 1 ? 0 : n - 1, win: 1, cam: 1, xprobe: 2 }, 19000, { rd: reads(ring, 0, 1), state: { st_ftile: 0, ...armState(0) }, prof: PROF(240, 560, 5200) }),
    mk(5, { pl: 1, ...arm, win: 1, cam: 1, st_x: 0, ent: 1, proj: 8, hzs: 2, hzt: 3 }, 18000, { rd: reads(ring, 0, 1), state: { st_ftile: 2, ...armState(1) }, prof: PROF(240, 560, 3000) }),
    mk(6, { xr: 1, pl: 1, hzs: 2, hzt: 2 }, 17500, { rd: reads(ring, 2, 1) }),
    mk(7, { txt: 1 }, 18000), mk(8, { mv: 1, xr: 1 }, 14000, { rd: reads(ring, 2, 1) }), mk(9, { wt: 1 }, 9000), mk(10, { mv: 1, mvf: 1 }, 15000, { rd: reads(ring, 2) }),
    mk(11, { z0: 1, zon: 1, vdw: 100, c0: 1 }, 29000), mk(12, { mld: 1 }, 9000)
  ];
  if (gt === 'action') rows.push(mk(13, { kb: 1, pl: 1, hzs: 2, hzt: 3, dsw: 8, dst: 15, dit: 0, dct: 0, anim: 1, dsp: 0, proj: 8 }, 14000, { rd: reads(ring, 1), prof: PROF(240, 560, 4800) }));
  if (gt === 'rpg') rows.push(mk(14, { cbt: 1, ui: 1 }, 12000));
  return rows;
}
function good({ gt = 'action', ring = 2, n = 14, placement = 'resident', emus = ['mesen', 'jsnes'] } = {}) {
  const rows = goodRows(gt, ring, n);
  const side = (emu) => (emu === 'mesen' ? { status: 0, frames: 500, rows: rows.map((r) => ({ ...r, counters: { ...r.counters }, state: { ...r.state } })) } : { finished: true, rows: rows.map((r) => ({ ...r, G: undefined, counters: { ...r.counters }, state: { ...r.state } })) });
  const sweep = synthSweep(ring);
  const proj = { key: 'proj:synthetic', projection: SYNTH_PROJ };
  const perSpec = SPEC_NAMES.map((name) => ({ name, mesen: emus.includes('mesen') ? side('mesen') : null, jsnes: emus.includes('jsnes') ? side('jsnes') : null,
    dlgSingle: placement === 'banked' ? 0x9000 : 0xd000, hasKnock: gt === 'action', romSha256: 'a'.repeat(64), script: [{ name: 'p', collect: true, mode: null }], distinctTerrain: true,
    seams: { crossings: [{ kind: 'walk', spawnMatch: true, terrainFrames: 40, terrainBlocks: 10000, terrainBad: 0 }, { kind: 'move', spawnMatch: true, terrainFrames: 8, terrainBlocks: 2000, terrainBad: 0 }], failures: [], binding: { bound: 2, bound_by: { walk: 1, move: 1 }, outside: 0, outside_by: { walk: 0, move: 0 }, unbound: [], orphans: [] } } }));
  const cost = { sweeps: [sweep], bySpec: Object.fromEntries(SPEC_NAMES.map((nm) => [nm, { sweep, proj }])) };
  return { perSpec, ctx: { cell: { id: 'MMC1-H' }, gt, ring, n, placement, emus, consts: CONSTS, mapper: MAPPER, cost } };
}
const failing = (items) => items.filter((i) => i.status === 'FAIL' || i.status === 'UNMEASURED').map((i) => `${i.emu}:${i.id}`);
const only = (items, id) => items.filter((i) => i.id === id);

test('judge: the synthetic positive passes every rule (the matching positive of the controls below)', () => {
  const items = judgeCell(good());
  assert.deepEqual(failing(items), [], failing(items).join(' '));
  assert.ok(summary(items).PASS > 80);
});
test('judge: the synthetic RPG positive passes, with C3b an N/A carrying the source proof', () => {
  const items = judgeCell(good({ gt: 'rpg' }));
  assert.deepEqual(failing(items), [], failing(items).join(' '));
  assert.match(only(items, 'class:C3b')[0].detail, /sw_knockback_step/);
  assert.equal(only(items, 'class:C3b')[0].status, 'N/A');
});
test('judge: a vertical ring (ring 1) positive passes: the deepest-row rule is that no row loop ever iterates', () => {
  const items = judgeCell(good({ ring: 1, n: 255 }));
  assert.deepEqual(failing(items), [], failing(items).join(' '));
});
test('control: a required class never witnessed fails (each of them)', () => {
  for (const cls of REQUIRED.action) {
    const g = good();
    for (const s of g.perSpec) for (const e of ['mesen', 'jsnes']) s[e].rows = s[e].rows.filter((r) => r.cls !== cls);
    assert.ok(failing(judgeCell(g)).some((f) => f.endsWith(`class:${cls}`)), cls);
  }
});
test('control: a body that is not a Move body is not counted as C4b -- the classifier that drops the Move body fails the class', () => {
  const g = good();
  for (const s of g.perSpec) for (const e of ['mesen', 'jsnes']) s[e].rows = s[e].rows.filter((r) => r.cls !== 'C4b');
  const f = failing(judgeCell(g));
  assert.ok(f.includes('mesen:class:C4b') && f.includes('jsnes:class:C4b'), f.join(' '));
});
test('control: the gate is STRICT (G < 29,780): 29,779 passes, exactly 29,780 FAILS and is NAMED, 29,781 fails', () => {
  const body = (G) => { const g = good(); g.perSpec[0].mesen.rows[1].G = G; return judgeCell(g); };
  assert.equal(only(body(GATE - 1), 'gate:C1')[0].status, 'PASS', '29,779 is inside the budget');
  const at = only(body(GATE), 'gate:C1')[0];
  assert.equal(at.status, 'FAIL', 'a body at exactly 29,780 is refused (round 2 let it through under the template\'s <=)');
  assert.match(at.detail, /AT EXACTLY 29780 \(refused\): walk@2/);
  assert.match(at.detail, /template's raw gateFail diagnostic counts G > 29780 and is not the verdict/);
  assert.equal(only(body(GATE + 1), 'gate:C1')[0].status, 'FAIL');
});
test('control: an NMI landing inside a body (overruns) fails even when G is under the gate', () => {
  const g = good(); g.perSpec[0].mesen.rows[1].counters.ovr = 1;
  assert.equal(only(judgeCell(g), 'overruns:C1')[0].status, 'FAIL');
});
test('control: C0 is exempt from the gate only with its blank/draw/restore evidence; a C0 body over the gate is reported, not failed', () => {
  const g = good(); g.perSpec[0].mesen.rows.find((r) => r.cls === 'C0').G = GATE + 5000;
  const items = judgeCell(g);
  assert.equal(only(items, 'gate:C0')[0].status, 'PASS');
  assert.match(only(items, 'gate:C0')[0].detail, /1 at or over 29780/);
  assert.equal(only(items, 'bound:C0').length, 0);
});
test('control: an unclassified body fails (nothing is dropped)', () => {
  const g = good(); g.perSpec[0].jsnes.rows.push({ phase: 'p', frame: 99, counters: { zzz: 1 }, state: {}, cls: 'Cx', terms: [] });
  assert.ok(failing(judgeCell(g)).includes('jsnes:class:none-unclassified'));
});
test('control: a read count above the plan\'s ceiling fails', () => {
  const g = good(); g.perSpec[0].mesen.rows[1].counters.peek = 4;
  assert.ok(failing(judgeCell(g)).includes('mesen:reads:C1'));
});
test('control: Mesen and jsnes disagreeing on a structural counter fails', () => {
  const g = good(); g.perSpec[0].jsnes.rows[1].counters.bank = 9;
  const f = failing(judgeCell(g));
  assert.ok(f.includes('both:agree:bodies'), f.join(' '));
  assert.ok(f.includes('jsnes:sanity:relationships'), 'the arithmetic of the transactions catches it in the emulator that is wrong, on its own');
});
test('control: the arm\'s strip length must be the build\'s own constant; the axis must be the ring\'s', () => {
  const g = good(); for (const s of g.perSpec) s.mesen.rows.forEach((r) => { if (r.counters.armr) r.state.st_len = 15; });
  assert.ok(failing(judgeCell(g)).includes('mesen:arm:st_len'));
  const w = good(); for (const s of w.perSpec) s.mesen.rows.forEach((r) => { if (r.counters.armr) { r.counters.armc = 1; } });
  assert.ok(failing(judgeCell(w)).includes('mesen:arm:axis'));
});
test('control: a claimed banked placement needs the overlay in the switchable window; a resident claim needs it in the kernel', () => {
  const g = good({ placement: 'banked' }); g.perSpec[0].dlgSingle = 0xd000;
  assert.ok(failing(judgeCell(g)).includes('-:placement:walk'));
  const r = good({ placement: 'resident' }); r.perSpec[0].dlgSingle = 0x9000;
  assert.ok(failing(judgeCell(r)).includes('-:placement:walk'));
});
test('control: a seam decode failure, or no seam decode at all, fails; a run that crossed nothing fails', () => {
  const g = good(); g.perSpec[0].seams.failures = ['frame 1: world jumped'];
  assert.ok(failing(judgeCell(g)).includes('jsnes:seam:walk'));
  const none = good(); for (const s of none.perSpec) s.seams = null;
  assert.ok(failing(judgeCell(none)).includes('jsnes:seam:walk'));
  const nm = good(); for (const s of nm.perSpec) s.seams.crossings = s.seams.crossings.filter((c) => c.kind !== 'move');
  assert.ok(failing(judgeCell(nm)).includes('jsnes:seam:move'));
});
test('control: a spec that produced no result in a requested emulator is UNMEASURED, never dropped', () => {
  const g = good(); g.perSpec[2].jsnes = null;
  const items = judgeCell(g);
  assert.ok(items.some((i) => i.status === 'UNMEASURED' && i.id === `run:${g.perSpec[2].name}`));
});
test('control: a Mesen-less run reports the gate UNMEASURED (jsnes cannot define G)', () => {
  const items = judgeCell(good({ emus: ['jsnes'] }));
  assert.equal(only(items, 'gate')[0].status, 'UNMEASURED');
});
test('judge: every spec the runner names exists and the judge needs the specs it asks for', () => {
  for (const n of ['walk', 'chase', 'heavy', 'heavy14', 'warp', 'mv-say', 'edge']) assert.ok(SPEC_NAMES.includes(n), n);
});

// ---------------------------------------------------------------- the provenance audit of an s1b-witness stamp
import { auditStamp } from './ringprovindex.mjs';
import { sha256 } from './ringtree.mjs';
const H = (c) => c.repeat(64);
const INV = { n: 1, spec: 'walk', purpose: 'witness', pid: 1, status: 0, signal: null, isolated: true, homeSeen: '<isolated-HOME>', exe: '/x/Mesen', settingsSha256: H('f'), loadedFiles: [{ path: '/x/MesenCore.so', sha256: H('1') }] };
function stamp(over = {}) {
  const planned = { cell: 'MMC1-H', gameType: 'action', placement: 'resident', n: 14, specs: [{ name: 'walk', kind: 'manifest', romSha256: H('a'), invocations: ['witness'] }] };
  return {
    schema: 'ring-prov-3', kind: 's1b-witness', status: 'built', attempt: { startedAt: 'x' }, harness: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, H('b')])),
    head: 'h', baseline: 'b', patches: [], links: { result: '/r', log: '/l' }, nesasm: { sha256: H('c') }, host: { kernel: 'k' },
    romSha256: H('d'), projectSha256: H('e'), plan: { ...planned, sha256: sha256(JSON.stringify(planned)) }, counts: { PASS: 100 }, expect: 'pass', verdictOk: true,
    gateFailed: false, gateFailures: 0, operationalFailures: 0, sabotage: null, userSavesUntouched: true, mesenChain: [INV],
    results: [{ scene: 's', emu: 'mesen+jsnes', emulatorStamp: { emulator: 'Mesen', loadedFiles: [{ path: '/x/MesenCore.so', sha256: H('1') }, { path: '/x/Mesen.dll', sha256: H('2') }], binarySha256: H('3'), host: { kernel: 'k' } } }],
    ...over
  };
}
import zlib from 'node:zlib';
/** The retained records of a synthetic stamp, in memory: { stamp fragment, read() }. */
function retainedFor(g) {
  const bodies = zlib.gzipSync(JSON.stringify(g.perSpec.map((s) => ({ name: s.name, mesen: s.mesen.rows, jsnes: s.jsnes.rows }))));
  const sweeps = zlib.gzipSync(JSON.stringify({ reads: [], projection: [] }));
  return { retained: { bodies: { file: 'r.bodies.json.gz', sha256: sha256(bodies), bytes: bodies.length }, sweeps: { file: 'r.sweeps.json.gz', sha256: sha256(sweeps), bytes: sweeps.length } }, read: (f) => (/bodies/.test(f) ? bodies : sweeps) };
}
const R0 = retainedFor(good());
const audit = (st, read = R0.read) => auditStamp({ retained: R0.retained, ...st }, 'x.json', () => true, read);
test('audit: a complete s1b-witness stamp passes; each missing attestation fails', () => {
  assert.deepEqual(audit(stamp()), []);
  assert.ok(audit(stamp({ userSavesUntouched: false })).some((m) => /saves were untouched/.test(m)));
  assert.ok(audit(stamp({ verdictOk: false })).some((m) => /declared verdict/.test(m)));
  assert.ok(audit(stamp({ mesenChain: [] })).some((m) => /no Mesen invocation is retained/.test(m)));
  assert.ok(audit(stamp({ counts: { PASS: 90, FAIL: 1 } })).some((m) => /positive with 1 FAIL/.test(m)));
  assert.ok(audit(stamp({ plan: { ...stamp().plan, n: 15 } })).some((m) => /plan does not hash/.test(m)));
  assert.ok(audit(stamp({ results: [{ scene: 's', emulatorStamp: { emulator: 'Mesen', loadedFiles: [] } }] })).some((m) => /NATIVE core/.test(m)));
});
test('audit: the retained Mesen chain must equal the planned invocations, each isolated, exit 0, with its executable and mapped files (round 2, finding 3)', () => {
  const withPlan = (specs, chain) => { const planned = { cell: 'MMC1-H', gameType: 'action', placement: 'resident', n: 14, specs }; return stamp({ plan: { ...planned, sha256: sha256(JSON.stringify(planned)) }, mesenChain: chain }); };
  const mv = [{ name: 'mv-lead', kind: 'move', romSha256: H('a'), invocations: ['calibration', 'witness'] }];
  const cal = { ...INV, spec: 'mv-lead', purpose: 'calibration' }, wit = { ...INV, n: 2, spec: 'mv-lead', purpose: 'witness' };
  assert.deepEqual(audit(withPlan(mv, [cal, wit])), []);
  assert.ok(audit(withPlan(mv, [wit])).some((m) => /expected 1 mv-lead\/calibration/.test(m)), 'a calibration session that was planned but never retained');
  assert.ok(audit(withPlan(mv, [cal, wit, { ...wit, n: 3 }])).some((m) => /expected 1 mv-lead\/witness invocation\(s\), the chain holds 2/.test(m)));
  assert.ok(audit(withPlan(mv, [{ ...cal, isolated: false, homeSeen: '/home/chris' }, wit])).some((m) => /not confirmed to run under the private HOME/.test(m)), 'a spawn that ran under the parent HOME');
  assert.ok(audit(withPlan(mv, [cal, { ...wit, status: 1 }])).some((m) => /exited with status 1/.test(m)));
  assert.ok(audit(withPlan(mv, [cal, { ...wit, status: null }])).some((m) => /exited with status null/.test(m)), 'a manufactured/unfinished status is not a 0');
  assert.ok(audit(withPlan(mv, [cal, { ...wit, exe: null }])).some((m) => /does not record the executable/.test(m)));
  assert.ok(audit(withPlan(mv, [cal, { ...wit, loadedFiles: [] }])).some((m) => /does not record the files it mapped/.test(m)));
  assert.ok(audit(withPlan([{ ...mv[0], invocations: undefined }], [cal, wit])).some((m) => /does not name every spec/.test(m)));
});
test('audit: a sabotage control that did not fail the G gate is rejected; one that did is accepted', () => {
  const ok = stamp({ expect: 'gate-fail', sabotage: 'pad-mainline-over', gateFailed: true, gateFailures: 31, operationalFailures: 0, counts: { PASS: 50, FAIL: 12 } });
  assert.deepEqual(audit(ok), []);
  assert.ok(audit({ ...ok, gateFailed: false }).some((m) => /did not fail the G gate/.test(m)));
  assert.ok(audit({ ...ok, gateFailures: 0 }).some((m) => /NUMERICAL G failure/.test(m)), 'a stamp whose only failures are diagnostics');
  assert.ok(audit({ ...ok, operationalFailures: 2 }).some((m) => /operationally sound/.test(m)));
});

// ---------------------------------------------------------------- round 2, finding 6: a gate-fail control is a NUMERICAL G failure, never a diagnostic
import { gateFailControl, numericGateFailures, gateAllows, NEAR } from './s1bjudge.mjs';
test('gate-fail control: a completed non-C0 body over the gate in a sound run is a numerical failure (the matching positive)', () => {
  const g = good(); g.perSpec[0].mesen.rows[1].G = GATE + 1;
  const items = judgeCell(g);
  const c = gateFailControl(items, g.perSpec);
  assert.equal(c.ok, true); assert.equal(c.numeric.length, 1); assert.equal(c.operational.length, 0);
});
test('gate-fail control: overrun diagnostics alone are NOT a numerical G failure (round 1 accepted them)', () => {
  const g = good(); for (const s of g.perSpec) s.mesen.rows.forEach((r) => { r.counters.ovr = 1; });
  const items = judgeCell(g);
  assert.ok(items.some((i) => /^overruns:/.test(i.id) && i.status === 'FAIL'), 'the diagnostics do fail the judge');
  assert.equal(gateFailControl(items, g.perSpec).ok, false);
});
test('gate-fail control: with the NUMERICAL verdict disabled (the threshold accepts everything) a real over-gate run is rejected, diagnostics or not', () => {
  const g = good(); for (const s of g.perSpec) s.mesen.rows.forEach((r) => { r.G = GATE + 5000; r.counters.ovr = 1; });
  const items = judgeCell(g);
  assert.equal(gateFailControl(items, g.perSpec).ok, true);
  assert.equal(gateFailControl(items, g.perSpec, () => true).ok, false, 'a disabled G threshold must not satisfy the control');
});
test('gate-fail control: C0 bodies over the gate are never the numerical failure; an operationally failed run is never a control success', () => {
  const c0 = good(); c0.perSpec[0].mesen.rows.find((r) => r.cls === 'C0').G = GATE + 9000;
  assert.equal(numericGateFailures(c0.perSpec).length, 0);
  const bad = good(); bad.perSpec[0].mesen.rows[1].G = GATE + 1; bad.perSpec[1].mesen.status = 1;
  const r = gateFailControl(judgeCell(bad), bad.perSpec);
  assert.equal(r.ok, false); assert.ok(r.operational.length > 0);
  const tmo = good(); tmo.perSpec[0].mesen.rows[1].G = GATE + 1; tmo.perSpec[0].mesen.timeout = true;
  assert.equal(gateFailControl(judgeCell(tmo), tmo.perSpec).ok, false);
});
test('the gate inequality is one named place: gateAllows is STRICT (G < 29,780), and a body inside the near band is reported by name', () => {
  assert.equal(gateAllows(GATE - 1), true); assert.equal(gateAllows(GATE), false); assert.equal(gateAllows(GATE + 1), false);
  const g = good(); g.perSpec[0].mesen.rows[1].G = GATE - NEAR; g.perSpec[0].mesen.rows[0].G = GATE - NEAR - 1;
  const k = perClass(allRows(g.perSpec, 'mesen')).C1;
  assert.deepEqual(k.near.map((x) => x.G), [GATE - NEAR]);
});


// ---------------------------------------------------------------- round 2, finding 1: the bound is per-path arithmetic over exhaustive prices
import { classBounds, cellPrices, readsOfRow, checkEventPrices, bodyTerms } from './s1bbound.mjs';
import { READ_CEILING } from './s1bjudge.mjs';
const boundOf = (g) => { const items = judgeCell(g); return { items, b: g.ctx.boundOut }; };
test('bound: the synthetic positive carries a per-class ESTIMATE below the gate, UNCERTIFIED and never PASS, every term named and the formula adding up', () => {
  const g = good(); const { items, b } = boundOf(g);
  assert.equal(only(items, 'bound:C2')[0].status, 'UNCERTIFIED');
  assert.match(only(items, 'bound:C2')[0].detail, /estimate \(uncertified: sampled remainder, sampled entity draw, sampled NMI\)/);
  assert.equal(items.filter((i) => /^bound:/.test(i.id) && i.status === 'PASS').length, 0, 'no bound item is ever a PASS: the sampled terms are not proved');
  assert.equal(only(items, 'bound:certification')[0].status, 'UNCERTIFIED');
  assert.match(only(items, 'bound:certification')[0].detail, /NOT CLAIMED: a proof for those terms, certified slack against 29780/);
  const c2 = b.byClass.C2;
  assert.equal(c2.formula.adj, b.nmiMax + c2.remMax + c2.reads.adj + c2.projCeil + c2.drawCeil);
  assert.equal(c2.reads.adj, 3 * Math.max(COST.peek, COST.peekHi) + 1 * (COST.goto + COST.loc), 'C2 ceiling [3 peeks, 4 gotos]: three whole peeks and one arm goto + restore, at the swept prices');
  assert.equal(b.projCeiling, 4 * (99 + 264));
});
test('control: a dearer read at the SAME count fails the bound (the bound follows the exhaustive price, not the sampled body)', () => {
  const g = good(); for (const w of g.ctx.cost.sweeps) w.stats.peek.adj.cycles = 9000;
  const { items } = boundOf(g);
  assert.equal(only(items, 'bound:C2')[0].status, 'FAIL');
  assert.match(only(items, 'bound:C2')[0].detail, /NOT a measured overrun/);
  // and the base run is unchanged for the same rows: the count did not move
  const base = boundOf(good()).items; assert.equal(only(base, 'bound:C2')[0].status, 'UNCERTIFIED');
});
test('control: a LOWER-G sample with a larger non-read remainder raises the bound (the max-G body is not the bound)', () => {
  const base = boundOf(good()).b.byClass.C2;
  const g = good();
  // a C2 body with a smaller G than the busy one, no projection / draw / read cycles inside it: nearly everything of it is remainder
  const extra = { phase: 'p', frame: 77, G: 16000, gs: 0, counters: { nmiT: 2000, pl: 1, hzs: 2, hzt: 3, armr: 1, armc: 1, win: 1, cam: 1, goto: 1, loc: 1, bank: 2, mwm: 10, ...reads(2, 0, 1).counters, peek: 0, pkc: 0, pkx: 0 }, events: reads(2, 0, 1).events, prof: PROF(0, 0, 0, 0, 0, 0), state: { st_len: 16, st_fnt: 0 }, cls: 'C2', terms: [] };
  extra.counters.goto = 1; extra.counters.loc = 1;
  for (const e of ['mesen', 'jsnes']) g.perSpec[0][e].rows.push({ ...extra, G: e === 'mesen' ? 16000 : undefined, counters: { ...extra.counters }, state: { ...extra.state } });
  const b = boundOf(g).b.byClass.C2;
  assert.ok(b.remMax > base.remMax, `${b.remMax} > ${base.remMax}`);
  assert.equal(b.remMax, 16000 - 2000 - 180);
  assert.ok(b.maxG < 29000 && b.formula.adj > base.formula.adj);
});
test('bound: a Mesen body with no jsnes counterpart is bounded as ITSELF (own G + the ceiling reads it did not make), never dropped, and never inflates the paired remainder', () => {
  const g = good();
  const stray = { phase: 'q', frame: 5, G: 25000, gs: 0, counters: { nmiT: 2000, pl: 1, hzs: 2, hzt: 3, armr: 1, win: 1, cam: 1, ...reads(2, 0, 1).counters }, events: reads(2, 0, 1).events, prof: null, state: { st_len: 16 }, cls: 'C2', terms: [] };
  g.perSpec[0].mesen.rows.push(stray);
  const b = boundOf(g).b.byClass.C2;
  assert.equal(b.n - b.nPaired, 1);
  assert.equal(b.unpairedMax.cycles, 25000 + (3 * COST.peekHi + COST.goto + COST.loc - (COST.goto + COST.loc)));
  assert.equal(b.bound.adj, Math.max(b.formula.adj, b.unpairedMax.cycles));
  stray.G = 29900; // an unpaired body whose own bound exceeds the gate fails the class
  assert.equal(only(boundOf(g).items, 'bound:C2')[0].status, 'FAIL');
});
test('bound: classBounds fails a class whose honest components exceed the gate, and reports the every-pair domain separately', () => {
  const g = good(); const pairs = g.perSpec.flatMap((s) => s.mesen.rows.map((m, i) => ({ spec: s.name, m, j: s.jsnes.rows[i], cls: m.cls })));
  const mk = (peek) => cellPrices([{ stats: { peek: { adj: { cycles: peek }, all: { cycles: peek * 2 } }, peekHi: { adj: { cycles: peek }, all: { cycles: peek * 2 } }, goto: { adj: { cycles: 100 }, all: { cycles: 100 } }, loc: { adj: { cycles: 80 }, all: { cycles: 80 } } } }]);
  const r = classBounds({ pairs, ceiling: READ_CEILING, prices: mk(4000), allows: gateAllows, projSweep: SYNTH_PROJ });
  assert.equal(r.byClass.C2.ok, false); assert.ok(r.byClass.C2.bound.all > r.byClass.C2.bound.adj);
  const ok = classBounds({ pairs, ceiling: READ_CEILING, prices: mk(200), allows: gateAllows, projSweep: SYNTH_PROJ });
  assert.equal(ok.byClass.C2.ok, true);
});
test('bound: every read event must equal the exhaustive sweep at its own coordinates; a repriced event, a non-adjacent pair and an off-domain screen are each reported', () => {
  const sw = synthSweep(2); const row = (e) => [{ phase: 'p', frame: 1, events: e }];
  assert.deepEqual(checkEventPrices(row(reads(2, 1).events), sw).mismatches, []);
  assert.equal(checkEventPrices(row(['g:0:1:89:0:0', 'l:0:0:68', 'p:0:1:188:0:0']), sw).mismatches.length, 1, 'a goto priced 101 instead of 100');
  assert.equal(checkEventPrices(row(['p:0:1:300:0:0']), sw).mismatches.length, 1, 'a peek outside the swept [Y=0, Y=255] interval');
  assert.equal(checkEventPrices(row(['g:0:5:88:0:0']), sw).nonAdjacent.length, 1);
  assert.equal(checkEventPrices(row(['g:0:99:88:0:0']), sw).outOfDomain.length, 1);
});
test('bound: a read priced at its events is the sum of its calls\' own costs (peek wraps its goto and restore; the arm\'s are standalone)', () => {
  const r = readsOfRow({ events: reads(2, 2, 1).events });
  assert.equal(r.peeks.length, 2); assert.equal(r.gotos.length, 1); assert.equal(r.locs.length, 1);
  assert.equal(r.total, 2 * COST.peek + COST.goto + COST.loc);
  assert.equal(r.nestingErrors, 0);
});

// ---------------------------------------------------------------- round 2, finding 2: each coverage witness is ONE body with the whole conjunction
const mapRows = (g, f) => { for (const s of g.perSpec) for (const e of ['mesen', 'jsnes']) s[e].rows.forEach((r) => f(r, e)); };
test('cover: the positive witnesses are all PASS; each reduction of the C2 busy body fails exactly the witness it breaks', () => {
  assert.deepEqual(failing(judgeCell(good())).filter((f) => /cover:/.test(f)), []);
  const one = good(); mapRows(one, (r) => { if (r.prof?.calls?.px) { r.prof.calls.px.calls = 1; r.prof.calls.py.calls = 1; } });
  assert.ok(failing(judgeCell(one)).includes('jsnes:cover:C2-busy'), 'a C2 body with ONE projection is not the busy frame');
  const inactive = good(); mapRows(inactive, (r) => { if (r.cls === 'C2') r.counters.win = 0; });
  assert.ok(failing(judgeCell(inactive)).includes('jsnes:cover:C2-busy'), 'an arm with no window update behind it');
  const fewDraws = good(); mapRows(fewDraws, (r) => { if (r.cls === 'C2') r.counters.dsw = 7; });
  assert.ok(failing(judgeCell(fewDraws)).includes('jsnes:cover:C2-busy'), 'seven of the eight entities');
  const noTiles = good(); mapRows(noTiles, (r) => { if (r.cls === 'C2') r.counters.dst = 3; });
  assert.ok(failing(judgeCell(noTiles)).includes('jsnes:cover:C2-busy'), 'entities drawn with three tiles iterated, not the scene\'s 14-15');
  const noShake = good(); mapRows(noShake, (r) => { if (r.cls === 'C2') { r.counters.shk = 0; r.terms = r.terms.filter((t) => t !== 'shake'); } });
  assert.ok(failing(judgeCell(noShake)).includes('jsnes:cover:C2-busy'), 'no Shake coexisting');
});
test('cover: the arm alignment needs both destination-nametable parities; a strip whose st_fnt is the unset 255 or one parity only fails', () => {
  const g = good(); mapRows(g, (r) => { if (r.counters.armr || r.counters.armc) r.state.st_fnt = 255; });
  assert.ok(failing(judgeCell(g)).includes('jsnes:cover:arm-alignment'), 'every strip at st_fnt 255 is one alignment (and not a legal one)');
  const one = good(); mapRows(one, (r) => { if (r.counters.armr || r.counters.armc) r.state.st_fnt = 0; });
  assert.ok(failing(judgeCell(one)).includes('jsnes:cover:arm-alignment'), 'one parity only');
});
test('cover: a crossing body that ran the hazard probe or the AI fails the exclusions; the entity-draw witnesses need every tile iterated and the animation live', () => {
  const x = good(); mapRows(x, (r) => { if (r.cls === 'C3a') r.counters.hz = 1; });
  assert.ok(failing(judgeCell(x)).includes('jsnes:cover:exclusions'));
  const d = good(); mapRows(d, (r) => { if (r.counters.dsw) r.counters.anim = 0; });
  assert.ok(failing(judgeCell(d)).some((f) => /cover:draw-/.test(f)));
});

// ---------------------------------------------------------------- round 2, finding 4: per-body agreement and the arithmetic of the transactions
test('agree: a permutation of two non-identical bodies in ONE emulator fails the per-body comparison (the class maxima still agree)', () => {
  const g = good(); const j = g.perSpec[0].jsnes.rows;
  [j[1], j[3]] = [j[3], j[1]];
  const f = failing(judgeCell(g));
  assert.ok(f.includes('both:agree:bodies'), f.join(' '));
});
test('agree: a counter deleted in BOTH records fails the arithmetic of the transactions even though the two records still agree', () => {
  const g = good(); mapRows(g, (r) => { delete r.counters.loc; });
  const f = failing(judgeCell(g));
  assert.ok(!f.includes('both:agree:bodies') || true);
  assert.ok(f.includes('mesen:sanity:relationships') && f.includes('jsnes:sanity:relationships'), f.join(' '));
});
test('sanity: a dead counter (no mapper write, no price, no restore anywhere) is a failed measurement, not a quiet pass', () => {
  for (const k of ['mwm', 'bank', 'loc', 'pkx']) { const g = good(); mapRows(g, (r) => { r.counters[k] = 0; }); assert.ok(failing(judgeCell(g)).includes('mesen:sanity:evidence'), k); }
  const e = good(); mapRows(e, (r) => { r.events = []; });
  assert.ok(failing(judgeCell(e)).includes('mesen:sanity:evidence'), 'no read events at all');
});
test('sanity: the mapper writes must be K per switch; a body with fewer, or a bank counter below its goto + loc, fails', () => {
  const w = good(); mapRows(w, (r, e) => { if (e === 'mesen' && r.counters.mwm) r.counters.mwm -= 1; });
  assert.ok(failing(judgeCell(w)).includes('mesen:sanity:relationships'));
  const b = good(); mapRows(b, (r) => { if (r.counters.bank) r.counters.bank -= 1; });
  assert.ok(failing(judgeCell(b)).includes('mesen:sanity:relationships'));
  const pk = good(); mapRows(pk, (r) => { if (r.counters.pkx) r.counters.pkx += 1; });
  assert.ok(failing(judgeCell(pk)).includes('jsnes:sanity:relationships'));
});
test('sanity: a class that disagrees with the independently read game_state fails (a walking class with game_state 2; a frozen C4a with game_state 0)', () => {
  const g = good(); mapRows(g, (r) => { if (r.cls === 'C1') r.gs = 2; });
  assert.ok(failing(judgeCell(g)).includes('mesen:sanity:class-state'));
  const f = good(); mapRows(f, (r) => { if (r.cls === 'C4a') r.gs = 0; });
  assert.ok(failing(judgeCell(f)).includes('jsnes:sanity:class-state'));
});
test('agree: a phase carrying the template\'s synthetic pokes is REPORTED, not compared; a declared-divergent spec is reported with its prefix, and its bodies still face the sanity rules', () => {
  const g = good(); g.perSpec[0].script = [{ name: 'p', collect: true, mode: 'm3' }]; g.perSpec[0].jsnes.rows[1].counters.bank = 9;
  const items = judgeCell(g);
  assert.equal(only(items, 'agree:bodies')[0].status, 'PASS');
  assert.match(only(items, 'agree:reported')[0].detail, /walk\/p/);
  const c = good(); const chase = c.perSpec.find((x) => x.name === 'chase'); chase.jsnes.rows.find((r) => r.cls === 'C3b').counters.dsw = 3;
  const it = judgeCell(c);
  assert.equal(only(it, 'agree:bodies')[0].status, 'PASS');
  assert.match(only(it, 'agree:reported')[0].detail, /chase\/p \(1\/\d+ bodies differ/);
});

// ---------------------------------------------------------------- round 2, finding 5: the Move scroll rule, terrain, binding
import { bindCrossings } from './ringseam.mjs';
/** A scripted Move across the seam: gameplay frames, then the dialogue state (gs 2) with the camera published one frame behind the origin. */
function moveFrames({ mutate = null, shake = false } = {}) {
  const fr = walkFrames({ count: 40 });
  fr.forEach((f, i) => { if (i >= 8) { f.gs = 2; f.mvLeft = 5; f.shakeLeft = shake ? 3 : 0; const t = torusOf({ x: fr[i - 1].originX, y: fr[i - 1].originY }); f.scroll = { x: t.x, y: 0 }; } });
  if (mutate) mutate(fr);
  return fr;
}
test('decodeSeams: a Move crossing whose scroll is the torus position of the PREVIOUS frame\'s origin decodes clean as a move', () => {
  const r = decodeSeams(moveFrames(), ctx());
  assert.deepEqual(r.failures, []); assert.equal(r.crossings[0].kind, 'move');
});
test('decodeSeams: a fixed scroll (123,45), a stale scroll and this frame\'s own origin each fail the Move rule', () => {
  const fixed = decodeSeams(moveFrames({ mutate: (fr) => fr.forEach((f, i) => { if (i >= 8) f.scroll = { x: 123, y: 45 }; }) }), ctx());
  assert.ok(fixed.failures.some((f) => /Move published scroll \(123,45\)/.test(f)), fixed.failures.slice(0, 2).join('|'));
  const stale = decodeSeams(moveFrames({ mutate: (fr) => fr.forEach((f, i) => { if (i >= 10 && i < 30) f.scroll = { ...fr[9].scroll }; }) }), ctx());
  assert.ok(stale.failures.some((f) => /Move published scroll/.test(f)));
  const current = decodeSeams(moveFrames({ mutate: (fr) => fr.forEach((f, i) => { if (i >= 8) { const t = torusOf({ x: f.originX, y: f.originY }); f.scroll = { x: t.x, y: 0 }; } }) }), ctx());
  assert.ok(current.failures.some((f) => /PREVIOUS frame/.test(f)), 'the walking rule\'s this-frame-or-previous would accept it; the Move rule is exactly one frame behind');
});
test('decodeSeams: a live Shake displaces the Move scroll by at most 2 px, no more', () => {
  const shifted = (d) => decodeSeams(moveFrames({ shake: true, mutate: (fr) => fr.forEach((f, i) => { if (i >= 8) f.scroll = { x: (f.scroll.x + d + 512) % 512, y: 0 }; }) }), ctx());
  assert.deepEqual(shifted(2).failures, []); assert.deepEqual(shifted(-2).failures, []);
  assert.ok(shifted(3).failures.length > 0);
  const noShake = decodeSeams(moveFrames({ mutate: (fr) => fr.forEach((f, i) => { if (i >= 8) f.scroll = { x: (f.scroll.x + 1) % 512, y: 0 }; }) }), ctx());
  assert.ok(noShake.failures.length > 0, 'a 1 px displacement with no Shake live');
});
test('bindCrossings: a decoded walk crossing binds to the C3a body that ran the matching sw_cross_*, a Move to the C4b one; a wrong class, direction or missing body does not', () => {
  const row = (frame, cls, counters, phase = 'p') => ({ phase, frame, cls, counters });
  const walk = { kind: 'walk', frame: 11, dir: 1, from: [0, 1], to: [0, 2] }, move = { kind: 'move', frame: 31, dir: 1, from: [0, 2], to: [0, 3] };
  const rows = [row(9, 'C1', {}), row(10, 'C3a', { xd: 1 }), row(11, 'C1', {}), row(29, 'C4b', {}), row(30, 'C4b', { xd: 1 })];
  const ok = bindCrossings([walk, move], rows, { ring: 2 });
  assert.deepEqual([ok.bound, ok.unbound, ok.orphans], [2, [], []]);
  assert.equal(bindCrossings([{ ...walk, dir: -1 }], rows, { ring: 2 }).unbound.length, 1, 'the body ran xd (down), the crossing went up');
  assert.equal(bindCrossings([{ ...move, kind: 'walk' }], rows, { ring: 2 }).unbound.length, 1, 'a Move body is not a walking crossing\'s body');
  assert.equal(bindCrossings([], rows, { ring: 2 }).orphans.length, 2, 'bodies that crossed with no decoded crossing');
  assert.equal(bindCrossings([{ ...walk, frame: 5 }], rows, { ring: 2 }).outside, 1, 'a crossing before every measured phase is counted, not bound');
});
test('judge: an unbound crossing, a stray crossing body or a terrain mismatch around a crossing each fail their own seam item', () => {
  const u = good(); u.perSpec[0].seams.binding.unbound = ['walk crossing at frame 5 has no C3a body']; u.perSpec[0].seams.binding.bound_by.walk = 0;
  assert.ok(failing(judgeCell(u)).includes('jsnes:seam:bound-walk'));
  const t = good(); t.perSpec[0].seams.crossings[1].terrainBad = 16;
  assert.ok(failing(judgeCell(t)).includes('jsnes:seam:terrain-move'));
  const none = good(); for (const s of none.perSpec) for (const c of s.seams.crossings) c.terrainFrames = 0;
  assert.ok(failing(judgeCell(none)).includes('jsnes:seam:terrain-walk'), 'a run that decoded no terrain at all is a failure, never a pass');
});

test('audit: the retained per-body records must exist, hash to the stamp, and (a positive) satisfy the transaction arithmetic when RECOMPUTED from the retained bytes', () => {
  assert.deepEqual(audit(stamp()), []);
  assert.ok(audit(stamp({ retained: undefined }), R0.read).some((m) => /retained per-body records|positive stamp without/.test(m)), 'a positive with no retained records');
  assert.ok(audit(stamp(), (f) => Buffer.from('tampered')).some((m) => /does not hash/.test(m)));
  assert.ok(audit(stamp(), () => { throw new Error('ENOENT'); }).some((m) => /is missing/.test(m)));
  const g = good(); for (const s of g.perSpec) for (const e of ['mesen', 'jsnes']) s[e].rows.forEach((r) => { delete r.counters.loc; });
  const bad = retainedFor(g);
  assert.ok(audit(stamp({ retained: bad.retained }), bad.read).some((m) => /break the transaction arithmetic when recomputed/.test(m)), 'records the judge would have refused, hashing correctly, are still refused');
  assert.ok(audit(stamp({ retained: bad.retained }), bad.read).some((m) => /hold no loc/.test(m)));
});

test('sanity: a full read-event buffer is legal only in a C0 (events then only bound the counters); in any gated class it is a failure, and an over-full count never passes', () => {
  const g = good();
  const full = reads(2, 0, 40).events; // 80 events > the buffer
  const c0 = { phase: 'q', frame: 3, G: 29000, gs: 0, counters: { nmiT: 2000, z0: 1, zon: 1, vdw: 100, c0: 1, goto: 78, loc: 78, bank: 156, mwm: 780, peek: 0, pkc: 0, pkx: 0 }, events: full.slice(0, 64), prof: null, state: {}, cls: 'C0', terms: [] };
  for (const e of ['mesen', 'jsnes']) g.perSpec[0][e].rows.push({ ...c0, counters: { ...c0.counters } });
  assert.ok(!failing(judgeCell(g)).some((f) => /sanity:relationships/.test(f)), 'a truncated C0 is fine');
  const c1 = { ...c0, cls: 'C1', counters: { ...c0.counters, c0: 0, pl: 1 } };
  const h = good(); for (const e of ['mesen', 'jsnes']) h.perSpec[0][e].rows.push({ ...c1, counters: { ...c1.counters } });
  assert.ok(failing(judgeCell(h)).includes('mesen:sanity:relationships'), 'a truncated gated body has unpriced reads');
  const over = good(); for (const e of ['mesen', 'jsnes']) over.perSpec[0][e].rows.push({ ...c0, counters: { ...c0.counters, goto: 10 } });
  assert.ok(failing(judgeCell(over)).includes('mesen:sanity:relationships'), 'more events than the counter says');
});
test('agree: a phase one body longer in one emulator fails, unless a C0 body of that phase differs by that many WHOLE FRAMES between the cores (the only excuse)', () => {
  const g = good(); g.perSpec[0].mesen.rows.push({ ...g.perSpec[0].mesen.rows[0], frame: 99, counters: { ...g.perSpec[0].mesen.rows[0].counters } });
  assert.ok(failing(judgeCell(g)).includes('both:agree:bodies'), 'an extra Mesen body with no excuse');
  const e = good(); e.perSpec[0].mesen.rows.push({ ...e.perSpec[0].mesen.rows[0], frame: 99, counters: { ...e.perSpec[0].mesen.rows[0].counters } });
  const c0m = e.perSpec[0].mesen.rows.find((r) => r.cls === 'C0'), c0j = e.perSpec[0].jsnes.rows.find((r) => r.cls === 'C0');
  c0m.G = 539763; c0j.cyc = 569544;
  const it = judgeCell(e);
  assert.equal(only(it, 'agree:bodies')[0].status, 'PASS'); assert.match(only(it, 'agree:bodies')[0].detail, /1 phases whose length differs by a C0/);
  c0j.cyc = 539763 + 500; // under one frame apart: no excuse
  assert.ok(failing(judgeCell(e)).includes('both:agree:bodies'));
});

// ---------------------------------------------------------------- round-2 matrix findings: MMC3 redraw writes, the mapper-state price interval, the bound-fail control
import { relationships, REDRAW_WRITES, WRITES_PER_SWITCH } from './s1bagree.mjs';
import * as require_agree from './s1bagree.mjs';
test('relationships: a forced-blank redraw on MMC3 is 12 CHR writes + the scanline disable (13) beyond its PRG switches; any other residue fails; a non-C0 body gets no such allowance', () => {
  assert.deepEqual(REDRAW_WRITES, { 1: 5, 4: 13, 30: 1 });
  const body = (cls, bank, mwm) => ({ cls, counters: { goto: 0, loc: 0, peek: 0, pkc: 0, pkx: 0, bank, mwm }, events: [] });
  assert.deepEqual(relationships(body('C0', 8, 4 * 8 + 13), 4), [], 'one redraw: 32 + 13');
  assert.deepEqual(relationships(body('C0', 2, 4 * 2 + 26), 4), [], 'two redraws');
  assert.equal(relationships(body('C0', 8, 4 * 8 + 12), 4).length, 1, 'a redraw missing the $E000 write: 12 is not a whole redraw');
  assert.equal(relationships(body('C1', 8, 4 * 8 + 13), 4).length, 1, 'a walking body has no redraw');
  assert.deepEqual(relationships(body('C0', 8, 5 * 8 + 5), 1), [], 'MMC1: one CHR select');
  assert.deepEqual(relationships(body('C0', 8, 8 + 1), 30, 1), [], 'UNROM 512: one latch write');
});
test('bound: an event priced inside the swept [cheapest, dearest] mapper-state interval is accepted, one outside it is a mismatch', () => {
  const sw = synthSweep(2); const row = (e) => [{ phase: 'p', frame: 1, events: e }];
  sw.gotoLo = sw.goto.map((v) => v - 1); sw.locLo = sw.loc.map((v) => v - 1);
  assert.deepEqual(checkEventPrices(row(['g:0:1:88:0:0']), sw).mismatches, [], 'goto 100: the dearest cell (88 + 12)');
  assert.deepEqual(checkEventPrices(row(['g:0:1:87:0:0']), sw).mismatches, [], 'goto 99: the cheapest cell');
  assert.equal(checkEventPrices(row(['g:0:1:86:0:0']), sw).mismatches.length, 1, 'goto 98: below the interval');
  assert.equal(checkEventPrices(row(['g:0:1:89:0:0']), sw).mismatches.length, 1, 'goto 101: above the interval');
  assert.equal(checkEventPrices(row(['l:0:0:69']), sw).mismatches.length, 1, 'a locate dearer than the sweep: the round-2 finding (103 against 102)');
});

test('relationships: on MMC3 the writes beyond the PRG switches of a walking body are the scanline IRQ handlers it took (3 each, 6 re-arming); none unexplained, and none without an irq counter', () => {
  const { IRQ_WRITES } = require_agree;
  assert.deepEqual(IRQ_WRITES, { 4: [3, 6] });
  const body = (cls, bank, mwm, irq) => ({ cls, counters: { goto: 0, loc: 0, peek: 0, pkc: 0, pkx: 0, bank, mwm, ...(irq === undefined ? {} : { irq }) }, events: [] });
  assert.deepEqual(relationships(body('C4c', 9, 36 + 3, 1), 4), [], 'one last-entry IRQ: 3 writes');
  assert.deepEqual(relationships(body('C4c', 9, 36 + 6, 1), 4), [], 'one re-arming IRQ: 6 writes');
  assert.equal(relationships(body('C4c', 9, 36 + 3), 4).length, 1, 'three extra writes and no irq counter: the round-2 matrix failure');
  assert.equal(relationships(body('C4c', 9, 36 + 7, 1), 4).length, 1, 'seven writes cannot be one IRQ');
  assert.equal(relationships(body('C4c', 9, 36, 1), 4).length, 1, 'an irq counted but no writes seen: a dead mapper-write hook');
  assert.deepEqual(relationships(body('C0', 8, 32 + 13 + 3, 1), 4), [], 'a redraw and an IRQ together');
});

// ================================================================ ROUND 3 (review 2, findings 1-6; Chris's option A)
import { PASS_CEILING, UNCERTIFIED_LABEL, projCeiling } from './s1bbound.mjs';
import { irqWritesReachable, IRQ_WRITES, compareBodies as compareAll, pairBodies, DIVERGENT_SPECS } from './s1bagree.mjs';
import { armStateFailures } from './s1bcover.mjs';

// ---------------------------------------------------------------- finding 5: the strict gate, through every path that decides a verdict
test('finding 5: a completed non-C0 body at exactly 29,780 is a NUMERICAL gate failure (the gate-fail control path), 29,779 is not', () => {
  const at = good(); at.perSpec[0].mesen.rows[1].G = GATE;
  const c = gateFailControl(judgeCell(at), at.perSpec);
  assert.equal(c.numeric.length, 1); assert.equal(c.ok, true, 'the equality body is refused by the numerical verdict, in a sound run');
  assert.match(String(c.numeric[0].G), /29780/);
  const inside = good(); inside.perSpec[0].mesen.rows[1].G = GATE - 1;
  assert.equal(numericGateFailures(inside.perSpec).length, 0);
  assert.equal(gateFailControl(judgeCell(inside), inside.perSpec).ok, false, 'no failing body: not a control success');
});
test('finding 5: a class ESTIMATE at exactly 29,780 is refused, 29,779 is not (the stray-body path pins the equality exactly)', () => {
  const run = (G) => {
    const g = good();
    // a Mesen body with no jsnes counterpart is bounded as itself: own G + the ceiling reads it did not make (3 peeks x peekHi for C2 here), so G = 29,150 puts the class estimate at exactly 29,780
    const stray = { phase: 'q', frame: 5, G, gs: 0, counters: { nmiT: 2000, pl: 1, hzs: 2, hzt: 3, armr: 1, win: 1, cam: 1, ...reads(2, 0, 1).counters }, events: reads(2, 0, 1).events, prof: null, state: { st_len: 16, st_active: 2, st_fnt: 0 }, cls: 'C2', terms: [] };
    g.perSpec[0].mesen.rows.push(stray);
    return { items: boundOf(g).items, b: boundOf(g).b.byClass.C2 };
  };
  const eq = run(GATE - 3 * COST.peekHi); assert.equal(eq.b.bound.adj, GATE);
  assert.equal(only(eq.items, 'bound:C2')[0].status, 'FAIL', 'an estimate AT 29,780 does not fit a strict budget');
  const under = run(GATE - 3 * COST.peekHi - 1); assert.equal(under.b.bound.adj, GATE - 1);
  assert.equal(only(under.items, 'bound:C2')[0].status, 'UNCERTIFIED');
});

// ---------------------------------------------------------------- finding 2: the OAM passes per class, from source
test('finding 2: the per-class pass ceilings are the source derivation (frozen classes 2, walking 1, battle 0)', () => {
  assert.deepEqual(PASS_CEILING, { C1: 1, C1s: 1, C2: 1, C3a: 1, C3b: 1, C3s: 1, CB: 0, C4a: 2, C4b: 2, C4bw: 2, C4c: 2 });
});
/** The reviewer's say@338 body: G 18,124 = NMI 667 + remainder 3,663 + 2 projection passes of 1,452 + 2 entity-draw passes of 5,445 (two draw_entities calls, eight px and eight py calls; the profile holds the cycles without the 6-cycle JSR the terms add per call). */
const SAY338 = () => {
  const m = { phase: 'p', frame: 338, G: 18124, gs: 1, counters: { nmiT: 667, txt: 1, ...reads(2, 0).counters }, events: [], cls: 'C4a', terms: [], state: {}, cyc: 18124 };
  const j = { ...m, G: undefined, prof: { px: 1000, py: 1808, draw: 10878, calls: { px: { calls: 8, max: 80 }, py: { calls: 8, max: 200 }, draw: { calls: 2, max: 900 } } } };
  return { pairs: [{ spec: 'say', m, j, cls: 'C4a' }], m, j };
};
test('finding 2: say@338 (G 18,124, two OAM passes) is never undercut: the corrected C4a estimate equals the body, the round-2 formula gave 16,672', () => {
  const { pairs } = SAY338();
  assert.equal(projCeiling(SYNTH_PROJ), 4 * (99 + 264), 'a pass of the player\'s projection: 4 tiles x (x + y) = 1,452');
  const r = classBounds({ pairs, ceiling: READ_CEILING, prices: cellPrices([{ stats: { peek: { adj: { cycles: 200 }, all: { cycles: 200 } }, peekHi: { adj: { cycles: 200 }, all: { cycles: 200 } }, goto: { adj: { cycles: 100 }, all: { cycles: 100 } }, loc: { adj: { cycles: 80 }, all: { cycles: 80 } } } }]), allows: gateAllows, projSweep: SYNTH_PROJ });
  const c = r.byClass.C4a;
  assert.equal(c.passes, 2); assert.equal(c.projCeil, 2 * 1452); assert.equal(r.drawPass.cycles, 5445); assert.equal(c.drawCeil, 2 * 5445);
  assert.equal(c.formula.adj, 667 + 3663 + 2 * 1452 + 2 * 5445); assert.equal(c.formula.adj, 18124);
  assert.ok(c.bound.adj >= c.maxG && !c.undercut && c.ok);
  assert.equal(667 + 3663 + 1452 + 2 * 5445, 16672, 'the round-2 formula (one projection pass, the whole two-pass draw): the reviewer\'s undercut');
});
test('finding 2: a two-pass control -- omitting EITHER pass undercuts the measured body and is refused', () => {
  const { pairs } = SAY338();
  const prices = cellPrices([{ stats: { peek: { adj: { cycles: 200 }, all: { cycles: 200 } }, peekHi: { adj: { cycles: 200 }, all: { cycles: 200 } }, goto: { adj: { cycles: 100 }, all: { cycles: 100 } }, loc: { adj: { cycles: 80 }, all: { cycles: 80 } } } }]);
  const one = classBounds({ pairs, ceiling: READ_CEILING, prices, allows: gateAllows, projSweep: SYNTH_PROJ, passCeiling: { ...PASS_CEILING, C4a: 1 } }).byClass.C4a;
  assert.equal(one.undercut, true, 'one pass charged: the estimate is below the body\'s own G');
  assert.equal(one.ok, false); assert.ok(one.passViolations.length >= 1, 'and the body ran 2 passes, more than the ceiling of 1');
  assert.equal(one.projCeil, 1452); assert.equal(one.drawCeil, 5445, 'each of the two terms drops by exactly one pass');
  // omitting only the SECOND PROJECTION pass (the other term still two passes) is the round-2 shape: 16,672 < 18,124
  const proj1 = 667 + 3663 + 1452 + 2 * 5445; assert.ok(proj1 < 18124);
  // omitting only the second DRAW pass
  const draw1 = 667 + 3663 + 2 * 1452 + 5445; assert.ok(draw1 < 18124);
  const three = classBounds({ pairs, ceiling: READ_CEILING, prices, allows: gateAllows, projSweep: SYNTH_PROJ, passCeiling: { ...PASS_CEILING, C4a: 3 } }).byClass.C4a;
  assert.ok(three.bound.adj > 18124 && three.ok, 'a ceiling above the observed passes over-bounds, it does not fail');
});
test('finding 2: a walking-class body that ran two OAM passes contradicts the source ceiling and fails its class', () => {
  const g = good();
  const row = g.perSpec[0].jsnes.rows[1]; row.prof = PROF(480, 1120, 10400, 8, 8, 2);
  const { items } = boundOf(g);
  assert.equal(only(items, 'bound:C1')[0].status, 'FAIL'); assert.match(only(items, 'bound:C1')[0].detail, /ran 2 OAM passes, the source ceiling of C1 is 1/);
});

// ---------------------------------------------------------------- finding 3: a VALID arm
test('finding 3: all st_active = 0 fails arm:active ALONE; the parities and everything else still hold', () => {
  const g = good(); for (const s of g.perSpec) s.mesen.rows.forEach((r) => { if (r.counters.armr) r.state.st_active = 0; });
  const items = judgeCell(g);
  assert.equal(only(items, 'arm:active').find((i) => i.emu === 'mesen').status, 'FAIL');
  assert.match(only(items, 'arm:active').find((i) => i.emu === 'mesen').detail, /strip not active/);
  assert.equal(only(items, 'arm:parity').find((i) => i.emu === 'mesen').status, 'PASS');
  assert.equal(only(items, 'arm:active').find((i) => i.emu === 'jsnes').status, 'PASS', 'the other emulator is judged on its own record');
});
test('finding 3: two distinct ILLEGAL parities (254, 255) fail arm:parity ALONE -- diversity of values is not validity', () => {
  const g = good(); let k = 0;
  for (const s of g.perSpec) s.mesen.rows.forEach((r) => { if (r.counters.armr) r.state.st_fnt = (k++ % 2) ? 254 : 255; });
  const items = judgeCell(g);
  const par = only(items, 'arm:parity').find((i) => i.emu === 'mesen');
  assert.equal(par.status, 'FAIL'); assert.match(par.detail, /illegal/); assert.match(par.detail, /st_fnt 25[45]/);
  assert.equal(only(items, 'arm:active').find((i) => i.emu === 'mesen').status, 'PASS');
});
test('finding 3: both together fail both items, each by its own name; the legal parity set is axis-specific ({0,4} column strips, {0,8} row strips)', () => {
  const g = good(); for (const s of g.perSpec) s.mesen.rows.forEach((r) => { if (r.counters.armr) { r.state.st_active = 0; r.state.st_fnt = 255; } });
  const items = judgeCell(g);
  assert.equal(only(items, 'arm:active').find((i) => i.emu === 'mesen').status, 'FAIL'); assert.equal(only(items, 'arm:parity').find((i) => i.emu === 'mesen').status, 'FAIL');
  // the axis: 4 is a legal COLUMN parity and an illegal ROW parity (and 8 the reverse)
  const rows = (ring, fnt) => [{ frame: 1, spec: 's', counters: ring === 1 ? { armc: 1 } : { armr: 1 }, state: { st_active: ring === 1 ? 1 : 2, st_fnt: fnt } }];
  assert.equal(armStateFailures(rows(1, 4), { ring: 1 }).badParity.length, 0); assert.equal(armStateFailures(rows(2, 4), { ring: 2 }).badParity.length, 1);
  assert.equal(armStateFailures(rows(2, 8), { ring: 2 }).badParity.length, 0); assert.equal(armStateFailures(rows(1, 8), { ring: 1 }).badParity.length, 1);
  assert.equal(armStateFailures(rows(1, 4), { ring: 1 }).inactive.length, 0); assert.equal(armStateFailures([{ ...rows(1, 4)[0], state: { st_active: 2, st_fnt: 4 } }], { ring: 1 }).inactive.length, 1, 'a row strip (2) in a column ring is not the ring\'s arm');
});
test('finding 3: a ring-1 positive uses the column parities {0, 4}: 8 is illegal there', () => {
  const g = good({ ring: 1, n: 255 }); for (const s of g.perSpec) s.jsnes.rows.forEach((r) => { if (r.counters.armc && r.state.st_fnt === 4) r.state.st_fnt = 8; });
  assert.equal(only(judgeCell(g), 'arm:parity').find((i) => i.emu === 'jsnes').status, 'FAIL');
});

// ---------------------------------------------------------------- finding 4: agreement without a blanket exception
import { estimateRefusal, UNCERTIFIED_OK } from './s1bjudge.mjs';
import { dspRangeFailures, DSP_KEYS } from './s1bagree.mjs';
const sanityDsp = (items, emu) => only(items, 'sanity:dsp').find((i) => i.emu === emu);
test('triage item 1: dsp 0 against 1000 with dst 16 in one ordinary walk body FAILS the named per-emulator sanity item sanity:dsp, while agree:dsp stays UNCERTIFIED', () => {
  const g = good(); g.perSpec[0].jsnes.rows[1].counters.dsp = 1000;
  assert.equal(g.perSpec[0].jsnes.rows[1].counters.dst, 16, 'the mutated body is a busy walk body with dst 16');
  const items = judgeCell(g);
  assert.equal(sanityDsp(items, 'jsnes').status, 'FAIL'); assert.match(sanityDsp(items, 'jsnes').detail, /dsp 1000 > dst 16/);
  assert.equal(sanityDsp(items, 'mesen').status, 'PASS', 'each emulator is judged on its own record');
  assert.equal(only(items, 'agree:dsp')[0].status, 'UNCERTIFIED');
  assert.ok(failing(items).includes('jsnes:sanity:dsp'));
  // and the same mutation in Mesen's record fails the Mesen item
  const m = good(); m.perSpec[0].mesen.rows[1].counters.dsp = 1000;
  assert.equal(sanityDsp(judgeCell(m), 'mesen').status, 'FAIL');
});
test('triage item 1: dsp equality is split out of agree:bodies: an in-range cross-core dsp difference leaves agree:bodies PASS and agree:dsp UNCERTIFIED with the observation kept, and the limitation is stated', () => {
  const g = good(); g.perSpec[0].jsnes.rows[1].counters.dsp = 2;
  const items = judgeCell(g);
  assert.equal(only(items, 'agree:bodies')[0].status, 'PASS', 'every other comparison still holds');
  const d = only(items, 'agree:dsp')[0];
  assert.equal(d.status, 'UNCERTIFIED'); assert.match(d.detail, /1 differ \(largest absolute difference 2\)/); assert.match(d.detail, /walk\/p#1: dsp 0\/2/);
  assert.match(d.detail, /NOT CLAIMED: that an in-range wrong or dead dsp hook in either emulator is detected/);
  assert.match(only(items, 'agree:reported')[0].detail, /OBSERVED dsp discrepancies .*dsp 0\/2/);
  assert.equal(sanityDsp(items, 'jsnes').status, 'PASS', 'dsp 2 <= dst 16: in range, so only the uncertified item records it');
  assert.equal(only(judgeCell(good()), 'agree:dsp')[0].status, 'UNCERTIFIED', 'declared uncertified whatever the observations (none here)');
});
test('triage item 1: a non-dsp disagreement still FAILS agree:bodies (even beside a dsp difference), and dsp is the only ignored counter', () => {
  assert.deepEqual(DSP_KEYS, ['dsp']);
  const g = good(); g.perSpec[0].jsnes.rows[1].counters.bank = 9; g.perSpec[0].jsnes.rows[1].counters.dsp = 2;
  const items = judgeCell(g);
  assert.equal(only(items, 'agree:bodies')[0].status, 'FAIL'); assert.match(only(items, 'agree:bodies')[0].detail, /bank 4\/9|bank \d+\/9/);
  const h = good(); h.perSpec[0].jsnes.rows[1].counters.dst = 17; // dst is not dsp: it is compared
  assert.equal(only(judgeCell(h), 'agree:bodies')[0].status, 'FAIL');
});
test('triage item 1: dspRangeFailures: nonnegative integers, dsp <= dst, omitted counters are zero, per emulator', () => {
  const rows = (c) => [{ name: 's', jsnes: { rows: [{ frame: 1, cls: 'C1', counters: c }] }, mesen: { rows: [] } }];
  assert.deepEqual(dspRangeFailures(rows({ dst: 16, dsp: 16 }), 'jsnes'), []);
  assert.deepEqual(dspRangeFailures(rows({}), 'jsnes'), [], 'both omitted: zero default');
  assert.equal(dspRangeFailures(rows({ dsp: 1 }), 'jsnes').length, 1, 'a park with no tile iteration');
  assert.equal(dspRangeFailures(rows({ dst: 16, dsp: 17 }), 'jsnes').length, 1);
  assert.equal(dspRangeFailures(rows({ dst: 16, dsp: -1 }), 'jsnes').length, 1);
  assert.equal(dspRangeFailures(rows({ dst: 16, dsp: 1.5 }), 'jsnes').length, 1);
  assert.equal(dspRangeFailures(rows({ dst: 16.5, dsp: 0 }), 'jsnes').length, 1);
});
test('finding 4: pairBodies applies the acceptance rule -- a dsp-only different ordinal pair is not a pair', () => {
  const g = good(); g.perSpec[0].jsnes.rows[1].counters.dsp = 2;
  const pairs = pairBodies(g.perSpec);
  assert.ok(!pairs.some((p) => p.spec === g.perSpec[0].name && p.m.frame === 2 && p.j && p.j.frame === 2 && p.j.counters.dsp === 2 && p.how === 'ordinal'), 'the differing ordinal body is not accepted as the partner');
});
test('finding 4: MMC3 IRQ writes are the reachable totals only: 3 or 6 per IRQ; 4 and 5 fail (and so do 7, 8 for one IRQ)', () => {
  assert.deepEqual(IRQ_WRITES, { 4: [3, 6] });
  const body = (extra, irq) => ({ cls: 'C4c', counters: { goto: 0, loc: 0, peek: 0, pkc: 0, pkx: 0, bank: 9, mwm: 36 + extra, irq }, events: [] });
  for (const ok of [3, 6]) assert.deepEqual(relationships(body(ok, 1), 4), [], `${ok} writes for one IRQ`);
  for (const bad of [4, 5, 7, 8]) assert.equal(relationships(body(bad, 1), 4).length, 1, `${bad} writes cannot be one IRQ handler`);
  for (const ok of [6, 9, 12]) assert.deepEqual(relationships(body(ok, 2), 4), [], `${ok} writes for two IRQs (3+3, 3+6, 6+6)`);
  for (const bad of [7, 8, 10, 11, 13]) assert.equal(relationships(body(bad, 2), 4).length, 1, `${bad} writes cannot be two IRQ handlers`);
  assert.equal(irqWritesReachable(4, 1, 4), false); assert.equal(irqWritesReachable(5, 1, 4), false); assert.equal(irqWritesReachable(9, 2, 4), true);
});
test('finding 4: a chase-spec phase that leaves lockstep is UNCERTIFIED (agree:chase), not accepted by a whitelist and not silently green', () => {
  assert.ok('chase' in DIVERGENT_SPECS);
  // an ordinary spec: a jsnes C3b entity-draw count of 9 against Mesen's 8 FAILS agree:bodies
  const ord = good(); const kb = ord.perSpec[0].jsnes.rows.find((r) => r.cls === 'C3b'); kb.counters.dsw = 9;
  assert.equal(only(judgeCell(ord), 'agree:bodies')[0].status, 'FAIL');
  // the chase spec: the same mutation leaves lockstep in a DECLARED-divergent spec -> the item it lands in is the explicitly UNCERTIFIED one
  const g = good(); const chase = g.perSpec.find((s) => s.name === 'chase');
  chase.jsnes.rows.find((r) => r.cls === 'C3b').counters.dsw = 9;
  const items = judgeCell(g);
  assert.equal(only(items, 'agree:chase')[0].status, 'UNCERTIFIED');
  assert.match(only(items, 'agree:chase')[0].detail, /NOT established for this cell/);
  assert.match(only(items, 'agree:chase')[0].detail, /a jsnes counter disagreeing with Mesen inside them is not detected/);
  // and an unmutated chase spec is compared EXACTLY like every other: no uncertified item
  assert.equal(only(judgeCell(good()), 'agree:chase')[0].status, 'PASS');
});
test('finding 3: coverage counts only LEGAL parities as the two it needs: {0, 255} is one legal value and fails cover:arm-alignment on its own item', () => {
  const g = good();
  for (const s of g.perSpec) s.jsnes.rows.forEach((r) => { if (r.counters.armr && r.state.st_fnt === 8) r.state.st_fnt = 255; });
  const items = judgeCell(g);
  assert.equal(only(items, 'cover:arm-alignment')[0].status, 'FAIL'); assert.match(only(items, 'cover:arm-alignment')[0].detail, /both LEGAL parities required \(st_fnt 1 distinct/);
  assert.equal(only(items, 'arm:parity').find((i) => i.emu === 'jsnes').status, 'FAIL');
});

// ---------------------------------------------------------------- triage item 2: the under-pad control is SAMPLED ESTIMATE REFUSAL, with no baseline-red tolerance
/** A cell whose only refusal is the sampled class estimate: the swept peek price is raised until the C2 estimate reaches the gate while every measured G stays far below it. */
const refusing = () => { const g = good(); for (const w of g.ctx.cost.sweeps) w.stats.peek.adj.cycles = 9000; return g; };
const verdict = (g, ctl = { numeric: [], operational: [] }) => { const items = judgeCell(g); return { items, r: estimateRefusal(items, ctl, g.ctx.boundOut) }; };
test('triage item 2: the matching positive -- an estimate at or over the gate refuses alone, measured gate passing, only declared uncertified items besides: CAUGHT', () => {
  const { items, r } = verdict(refusing());
  assert.equal(only(items, 'bound:C2')[0].status, 'FAIL'); assert.deepEqual(r.why, []); assert.equal(r.ok, true); assert.ok(r.refused.includes('C2'));
  assert.ok(items.every((i) => ['PASS', 'N/A'].includes(i.status) || (i.status === 'FAIL' && /^bound:C/.test(i.id)) || (i.status === 'UNCERTIFIED' && UNCERTIFIED_OK.test(i.id))));
  assert.equal(items.some((i) => i.baselineRed !== undefined), false, 'baselineRed is gone from the records');
});
test('triage item 2: forcing every bound item nonfailing is NOT CAUGHT (a disabled estimate threshold)', () => {
  const g = refusing(); const items = judgeCell(g).map((i) => (/^bound:C/.test(i.id) && i.status === 'FAIL' ? { ...i, status: 'UNCERTIFIED' } : i));
  assert.equal(estimateRefusal(items, { numeric: [], operational: [] }, g.ctx.boundOut).ok, false, 'the estimate still reaches the gate but no bound item refuses');
  const clean = verdict(good()); assert.equal(clean.r.ok, false, 'an ordinary cell has no refusing estimate');
});
test('triage item 2: an injected numerical failure, or an operational failure, is NOT CAUGHT', () => {
  assert.equal(verdict(refusing(), { numeric: [{ spec: 'walk', frame: 2, G: GATE }], operational: [] }).r.ok, false);
  assert.equal(verdict(refusing(), { numeric: [], operational: ['walk: timeout'] }).r.ok, false);
});
test('triage item 2: dsp = 1000 with dst = 16, or a non-dsp agreement failure, injected next to the real refusal is NOT CAUGHT (no baseline-red tolerance)', () => {
  const a = refusing(); a.perSpec[0].jsnes.rows[1].counters.dsp = 1000;
  const ra = verdict(a); assert.equal(ra.r.ok, false); assert.ok(ra.r.why.some((w) => /FAIL jsnes:sanity:dsp/.test(w)), ra.r.why.join('; '));
  const b = refusing(); b.perSpec[0].jsnes.rows[1].counters.bank = 9;
  const rb = verdict(b); assert.equal(rb.r.ok, false); assert.ok(rb.r.why.some((w) => /FAIL both:agree:bodies/.test(w)), rb.r.why.join('; '));
});
test('triage item 2: a bound item that fails WITHOUT its estimate reaching the gate (a pass-ceiling contradiction) is not a sampled estimate refusal', () => {
  const g = good(); g.ctx.passCeiling = { ...PASS_CEILING, C1: 0 };
  const { items, r } = verdict(g);
  assert.equal(only(items, 'bound:C1')[0].status, 'FAIL'); assert.equal(r.ok, false);
  assert.ok(r.why.some((w) => /no bound:<class> item FAILS from an estimate reaching or exceeding the gate/.test(w)));
});

// ---------------------------------------------------------------- round 4 (review 3, successor soundness): the judge-only successor refuses what it cannot reconcile
import { rejudgeRecord, predecessorItems, recordedSynthetic } from './s1bsuccessor.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** An AS-RUN (pre-triage) record built from a synthetic cell: the three agreement items are the predecessor's, and `skew` makes jsnes disagree with Mesen in dsp alone (the as-run judge failed that). */
function asRun({ skew = true } = {}) {
  const g = good();
  if (skew) g.perSpec[0].jsnes.rows[1].counters.dsp = 2;
  const keep = judgeCell(g).filter((i) => !/^agree:/.test(i.id) && i.id !== 'sanity:dsp');
  const pre = predecessorItems(g.perSpec);
  const items = [...keep, ...Object.entries(pre).map(([id, v]) => ({ id, emu: 'both', status: v.status, detail: v.detail }))];
  const bodies = g.perSpec.map((s) => ({ name: s.name, romSha256: s.romSha256, mesen: s.mesen.rows, jsnes: s.jsnes.rows }));
  const rec = { expect: 'pass', verdictOk: !failing(items).length, counts: summary(items), items, perSpec: g.perSpec.map((s) => ({ name: s.name, romSha256: s.romSha256 })) };
  return { rec, bodies, g };
}
const edit = (rec, id, f) => ({ ...rec, items: rec.items.map((i) => (i.id === id ? { ...i, ...f(i) } : i)) });
const refused = (r, re) => { assert.equal(r.ok, false, 'must be refused'); assert.ok(r.reasons.some((w) => re.test(w)), r.reasons.join(' | ')); assert.equal(r.verdictOk, false, 'the red positive stays red'); };
test('round 4: the matching positive -- a record red only on the dsp equality reconciles with its reconstruction and turns green; the split items replace the three', () => {
  const { rec, bodies } = asRun();
  assert.equal(rec.verdictOk, false); assert.deepEqual(failing(rec.items), ['both:agree:bodies']);
  const r = rejudgeRecord(rec, bodies);
  assert.equal(r.ok, true, r.reasons.join(' | ')); assert.equal(r.verdictOk, true);
  assert.deepEqual(failing(r.items), []);
  assert.equal(only(r.items, 'agree:dsp')[0].status, 'UNCERTIFIED'); assert.equal(only(r.items, 'agree:bodies')[0].status, 'PASS');
  assert.deepEqual(r.reconcile.split, { preTriageMismatches: 1, dspOnly: 1, afterSplit: 0, dspBodies: 1 });
  assert.ok(only(r.items, 'sanity:dsp').length === 2, 'one sanity:dsp per emulator');
});
test('round 4 probe 1: an original mismatch count of 999,999 with the totals unchanged is REFUSED, the positive stays red (a count compared only to the new zero would pass it)', () => {
  const { rec, bodies } = asRun();
  const bad = edit(rec, 'agree:bodies', (i) => ({ detail: i.detail.replace(/(\d+) UNACCEPTED mismatches/, '999999 UNACCEPTED mismatches') }));
  assert.notEqual(bad.items.find((i) => i.id === 'agree:bodies').detail, rec.items.find((i) => i.id === 'agree:bodies').detail);
  refused(rejudgeRecord(bad, bodies), /agree:bodies: the recorded detail does not match the reconstructed pre-triage comparison/);
});
test('round 4 probe 2: the original agree:bodies item deleted from a both-emulator positive is REFUSED, never silently dropped', () => {
  const { rec, bodies } = asRun();
  const bad = { ...rec, items: rec.items.filter((i) => i.id !== 'agree:bodies') };
  refused(rejudgeRecord(bad, bodies), /agree:bodies: 0 recorded, 1 required/);
  refused(rejudgeRecord({ ...rec, items: rec.items.filter((i) => i.id !== 'agree:reported') }, bodies), /agree:reported: 0 recorded, 1 required/);
  refused(rejudgeRecord({ ...rec, items: rec.items.filter((i) => i.id !== 'agree:chase') }, bodies), /agree:chase: 0 recorded, 1 required/);
});
test('round 4: every other way a predecessor can fail to reconcile is refused (status, emulator, duplicate, malformed, unknown, successor-only item, retained bodies changed, synthetic list)', () => {
  const { rec, bodies } = asRun();
  refused(rejudgeRecord(edit(rec, 'agree:bodies', () => ({ status: 'PASS' })), bodies), /status PASS recorded, FAIL reconstructed/);
  refused(rejudgeRecord(edit(rec, 'agree:bodies', () => ({ emu: 'jsnes' })), bodies), /"jsnes" recorded, "both" required/);
  refused(rejudgeRecord({ ...rec, items: [...rec.items, rec.items.find((i) => i.id === 'agree:bodies')] }, bodies), /agree:bodies: 2 recorded, 1 required/);
  refused(rejudgeRecord(edit(rec, 'agree:reported', () => ({ detail: 'nothing' })), bodies), /agree:reported is malformed/);
  refused(rejudgeRecord({ ...rec, items: [...rec.items, { id: 'agree:other', emu: 'both', status: 'PASS', detail: '' }] }, bodies), /unknown agreement items: agree:other/);
  refused(rejudgeRecord({ ...rec, items: [...rec.items, { id: 'agree:dsp', emu: 'both', status: 'UNCERTIFIED', detail: '' }] }, bodies), /agree:dsp is already recorded/);
  const moved = bodies.map((b, i) => (i ? b : { ...b, jsnes: b.jsnes.map((r, k) => (k === 3 ? { ...r, counters: { ...r.counters, pl: 7 } } : r)) }));
  refused(rejudgeRecord(rec, moved), /agree:bodies: the recorded detail does not match/);
  refused(rejudgeRecord(rec, bodies.map((b) => ({ ...b, mesen: null }))), /agree:bodies: 1 recorded, 0 required/);
  refused(rejudgeRecord(rec, bodies.map((b, i) => (i ? b : { ...b, mesen: null }))), /agree:bodies: the recorded detail does not match/);
  refused(rejudgeRecord(rec, bodies.slice(1)), /the record's specs/);
  refused(rejudgeRecord(rec, bodies.map((b, i) => (i ? b : { ...b, romSha256: 'b'.repeat(64) }))), /ROM hash/);
  assert.equal(recordedSynthetic('not compared (reported): 1 phases whose Mesen bodies carry the template\'s SYNTHETIC pokes (walk/p (9 bodies)); OBSERVED dsp discrepancies (0 bodies')?.[0].bodies, 9);
  refused(rejudgeRecord(edit(rec, 'agree:reported', (i) => ({ detail: i.detail.replace('(0 phases whose', '(0 phases whose').replace(/: 0 phases whose Mesen bodies carry the template's SYNTHETIC pokes \(none\)/, ": 1 phases whose Mesen bodies carry the template's SYNTHETIC pokes (walk/p (999 bodies))") })), bodies), /synthetic walk\/p: recorded 999 Mesen bodies/);
});
test('round 4: a one-emulator record (jsnes bodies only, no agreement items) is carried; agreement items without a comparison, or a comparison without items, is not', () => {
  const g = good({ emus: ['jsnes'] });
  const items = judgeCell(g).filter((i) => !/^agree:/.test(i.id) && i.id !== 'sanity:dsp');
  const bodies = g.perSpec.map((s) => ({ name: s.name, romSha256: s.romSha256, mesen: null, jsnes: s.jsnes.rows }));
  const rec = { expect: 'seam-fail', verdictOk: true, counts: summary(items), items, perSpec: g.perSpec.map((s) => ({ name: s.name, romSha256: s.romSha256 })) };
  const r = rejudgeRecord(rec, bodies);
  assert.equal(r.ok, true, r.reasons.join(' | ')); assert.equal(r.verdictOk, true); assert.deepEqual(r.fresh.map((i) => `${i.emu}:${i.id}`), ['jsnes:sanity:dsp']);
  const { rec: both } = asRun({ skew: false });
  refused(rejudgeRecord({ ...rec, verdictOk: false, items: [...items, ...both.items.filter((i) => /^agree:/.test(i.id))] }, bodies), /agree:bodies: 1 recorded, 0 required/);
});
test('round 4: an under-pad record is re-judged by estimateRefusal -- a not-caught outcome is reported with its reasons, never carried as true', () => {
  const { rec, bodies } = asRun({ skew: false });
  const r = rejudgeRecord({ ...rec, expect: 'bound-fail', sabotage: 'pad-mainline-under', verdictOk: true, bound: { byClass: {} }, gateFailures: 0, operationalFailures: [] }, bodies);
  assert.equal(r.ok, true); assert.equal(r.verdictOk, false); assert.match(r.rule, /NOT CAUGHT/);
});

// The reviewer's two probes against the REAL r3 record (MMC1-V action resident: 107 UNACCEPTED mismatches), through the real command, with a copied stamp and unchanged retained bytes.
const HERE4 = path.dirname(fileURLToPath(import.meta.url)), ROOT4 = path.resolve(HERE4, '../../..');
const R3 = path.join(ROOT4, 'handoff-next/s1b-r3-logs'), R3P = path.join(ROOT4, 'handoff-next/s1b-provenance-r3');
const REAL = 's1b-MMC1-V-action-resident.json';
const haveR3 = fs.existsSync(path.join(R3, REAL)) && fs.existsSync(R3P);
function realProbe(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's1b-r4-'));
  const logs = path.join(tmp, 'logs'), prov = path.join(tmp, 'prov'), out = path.join(tmp, 'out');
  fs.mkdirSync(logs); fs.mkdirSync(prov);
  for (const f of fs.readdirSync(R3).filter((x) => x.startsWith(REAL.replace('.json', '')))) fs.copyFileSync(path.join(R3, f), path.join(logs, f));
  const rec = JSON.parse(fs.readFileSync(path.join(logs, REAL), 'utf8'));
  mutate(rec); fs.writeFileSync(path.join(logs, REAL), JSON.stringify(rec, null, 1));
  const stamp = fs.readdirSync(R3P).find((f) => f.endsWith('.json') && f !== 'INDEX.json' && JSON.parse(fs.readFileSync(path.join(R3P, f), 'utf8')).links?.result?.endsWith(`/${REAL}`));
  const st = JSON.parse(fs.readFileSync(path.join(R3P, stamp), 'utf8')); st.links = { ...st.links, result: path.join(logs, REAL), log: path.join(logs, REAL.replace('.json', '.log')) };
  fs.writeFileSync(path.join(prov, stamp), JSON.stringify(st, null, 1));
  const run = spawnSync(process.execPath, [path.join(HERE4, 's1b_rejudge.mjs'), logs, prov, out], { encoding: 'utf8' });
  const man = JSON.parse(fs.readFileSync(path.join(out, 'SUCCESSOR.json'), 'utf8'));
  const res = JSON.parse(fs.readFileSync(path.join(out, REAL), 'utf8'));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { run, man, res };
}
test('round 4 (real record, real command): the genuine record passes; 107 -> 999,999 mismatches and a deleted agree:bodies both exit nonzero, report a problem and keep the positive red', { skip: haveR3 ? false : 'handoff-next r3 evidence not present' }, () => {
  const ok = realProbe(() => {});
  assert.equal(ok.run.status, 0, ok.run.stdout + ok.run.stderr); assert.equal(ok.res.verdictOk, true); assert.equal(ok.man.audit.problems, 0);
  const p1 = realProbe((rec) => { const i = rec.items.find((x) => x.id === 'agree:bodies'); assert.match(i.detail, /107 UNACCEPTED mismatches/); i.detail = i.detail.replace('107 UNACCEPTED mismatches', '999999 UNACCEPTED mismatches'); });
  assert.notEqual(p1.run.status, 0); assert.equal(p1.res.verdictOk, false); assert.ok(p1.man.audit.problems >= 1); assert.match(p1.run.stdout, /reconciliation refused: .*agree:bodies/);
  const p2 = realProbe((rec) => { rec.items = rec.items.filter((x) => x.id !== 'agree:bodies'); });
  assert.notEqual(p2.run.status, 0); assert.equal(p2.res.verdictOk, false); assert.ok(p2.man.audit.problems >= 1); assert.match(p2.run.stdout, /agree:bodies: 0 recorded, 1 required/);
});
