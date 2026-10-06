// Unit check of the judge itself (no emulator): the reviewer's judge-probe, recast. A SYNTHETIC record built from the oracle's own correct
// expectation must pass (the matching positive); each corruption of it must fail the DIALOGUE assertion. Run: node --test test/lua/ring_gate/judge_unit.mjs
//   wrong live NT   -- terrain right, a whole six-row box drawn in the OTHER live NT, attributes corrupted (round 1's judge returned ok:true)
//   attributes only -- every attribute byte of both live NTs corrupted
//   shifted box     -- the right box one tile row too high
//   wrong glyph     -- one typed glyph wrong; missing page arrow; truncated box (a border column short)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ringProject, cellById } from './ringworld.mjs';
import { ringExpected, boxFootprint, typedSoFar } from '../../lib/ringoracle.js';
import { judge, talkerText, typingProgressFailures, sequenceFailures } from './ringjudge.mjs';
import { laps, seam, TYPING } from './ringscene.mjs';

function fixture(cellId) {
  const cell = cellById(cellId);
  const { project, gridW, gridH } = ringProject({ cell });
  const player = { col: 0, row: 0, px: 120, py: 120 };
  const base = ringExpected({ project, ring: cell.ring, gridW, gridH, player });
  const cam = { nt: base.camera.cam_nt, x: base.camera.cam_x_lo & 0xf0, y: base.camera.cam_y_lo & 0xf0 };
  const text = talkerText(project, gridW, 0, 0);
  const box = boxFootprint({ ring: cell.ring, cam, typed: typedSoFar(text, 99, 99), arrow: true });
  const exp = ringExpected({ project, ring: cell.ring, gridW, gridH, player, box });
  const vram = {};
  const aliases = cell.ring === 1 ? [[0, 0x2000, 0x2800], [1, 0x2400, 0x2c00]] : [[0, 0x2000, 0x2400], [2, 0x2800, 0x2c00]];
  for (const [nt, live, alias] of aliases) {
    const bytes = new Uint8Array(1024);
    bytes.set(exp.nts[nt].tiles); bytes.set(exp.nts[nt].attr, 960);
    vram[live] = bytes; vram[alias] = bytes;
  }
  const state = { sw_col: 0, sw_row: 0, player_x: 120, player_y: 120, cam_nt: base.camera.cam_nt, cam_x_lo: cam.x, cam_y_lo: cam.y, ppuctrl_nt: base.camera.cam_nt, st_active: 0, game_state: 2, box_state: 6, msg_col: 13, msg_line: 0, vram_len: 0 };
  return { cell, project, gridW, gridH, vram, state, liveBases: aliases.map((a) => a[1]), box };
}
const rec = (f, vram) => ({ label: 'unit:open', kind: 'dlg-open', vram, state: f.state });
const ctxOf = (f) => ({ project: f.project, ring: f.cell.ring, gridW: f.gridW, gridH: f.gridH, typing: TYPING });
const copy = (vram) => Object.fromEntries(Object.entries(vram).map(([k, v]) => [k, v.slice()]));
// sets one byte of a live NT AND its mirror alias (the recorders read through the mirroring, so both views carry it)
function setByte(v, f, liveIdx, off, val) {
  const live = f.liveBases[liveIdx];
  const old = f.vram[live];
  for (const k of Object.keys(v).map(Number)) if (f.vram[k] === old) v[k][off] = val;
}
const glyphTiles = (f) => [...f.box.tiles].filter(([, t]) => t > 0xa0 && t < 0xfa); // typed letters (not space, border or arrow furniture)

for (const id of ['MMC1-V', 'MMC1-H']) {
  test(`${id}: the matching positive passes`, () => {
    const f = fixture(id);
    const r = judge(rec(f, f.vram), ctxOf(f));
    assert.deepEqual(r.fails, []);
  });
  test(`${id}: a whole box in the wrong live NT with corrupted attributes fails`, () => {
    const f = fixture(id);
    const v = copy(f.vram);
    // terrain kept right under the camera's own NT, the six box rows (24-29) filled in the OTHER live NT, every attribute byte corrupted
    const other = f.liveBases[1 - (f.cell.ring === 1 ? f.state.cam_nt & 1 : f.state.cam_nt >> 1)];
    const otherAlias = f.cell.ring === 1 ? other + 0x800 : other + 0x400;
    v[other].fill(255, 24 * 32, 30 * 32); v[otherAlias] = v[other];
    for (const live of f.liveBases) v[live].fill(255, 960);
    const r = judge(rec(f, v), ctxOf(f));
    assert.equal(r.ok, false);
    assert.ok(r.fails.some((x) => /attr|tile/.test(x)), r.fails.join('|'));
  });
  test(`${id}: corrupted attributes alone fail`, () => {
    const f = fixture(id);
    const v = copy(f.vram);
    for (const live of f.liveBases) v[live].fill(255, 960);
    assert.equal(judge(rec(f, v), ctxOf(f)).ok, false);
  });
  test(`${id}: one wrong typed glyph, a missing arrow, and a truncated border each fail`, () => {
    const f = fixture(id);
    const [gk, gt] = glyphTiles(f)[0];
    const [gnt, gidx] = gk.split(':').map(Number);
    const v1 = copy(f.vram); setByte(v1, f, gnt, gidx, gt ^ 1);
    assert.equal(judge(rec(f, v1), ctxOf(f)).ok, false, 'wrong glyph');
    const [ak] = [...f.box.tiles].find(([, t]) => t === 0xff);
    const [ant, aidx] = ak.split(':').map(Number);
    const v2 = copy(f.vram); setByte(v2, f, ant, aidx, 0xa0);
    assert.equal(judge(rec(f, v2), ctxOf(f)).ok, false, 'missing arrow');
    const [bk] = [...f.box.tiles].find(([, t]) => t === 0xa0 + 91 - 0 || false) ?? [...f.box.tiles].find(([k]) => Number(k.split(':')[1]) % 32 === 31);
    const [bnt, bidx] = bk.split(':').map(Number);
    const v3 = copy(f.vram); setByte(v3, f, bnt, bidx, v3[f.liveBases[bnt]][bidx] ^ 0x10);
    assert.equal(judge(rec(f, v3), ctxOf(f)).ok, false, 'truncated border');
  });
}

// ---- typing progress (review 2 finding 1): the counters are bounded to the compiled page and the declared prefix; a COMPLETE page cannot stand in
// for the partial typing observation. A typing record is built from the oracle's own expectation of "the first `col` glyphs typed, no arrow".
function typingRecord(f, { typedLine = 0, typedCol = 3, msg_line = 0, msg_col = 3, vram_len = 0 } = {}) {
  const text = talkerText(f.project, f.gridW, 0, 0);
  const base = ringExpected({ project: f.project, ring: f.cell.ring, gridW: f.gridW, gridH: f.gridH, player: { col: 0, row: 0, px: 120, py: 120 } });
  const cam = { nt: base.camera.cam_nt, x: base.camera.cam_x_lo & 0xf0, y: base.camera.cam_y_lo & 0xf0 };
  const box = boxFootprint({ ring: f.cell.ring, cam, typed: typedSoFar(text, typedLine, typedCol), arrow: false });
  const exp = ringExpected({ project: f.project, ring: f.cell.ring, gridW: f.gridW, gridH: f.gridH, player: { col: 0, row: 0, px: 120, py: 120 }, box });
  const vram = {};
  const aliases = f.cell.ring === 1 ? [[0, 0x2000, 0x2800], [1, 0x2400, 0x2c00]] : [[0, 0x2000, 0x2400], [2, 0x2800, 0x2c00]];
  for (const [nt, live, alias] of aliases) {
    const bytes = new Uint8Array(1024);
    bytes.set(exp.nts[nt].tiles); bytes.set(exp.nts[nt].attr, 960);
    vram[live] = bytes; vram[alias] = bytes;
  }
  return { label: 'boot:typing', kind: 'dlg-typing', vram, state: { ...f.state, box_state: 2, msg_line, msg_col, vram_len } };
}
for (const id of ['MMC1-V', 'MMC1-H']) {
  test(`${id}: a genuine partial typing record (3 glyphs) passes`, () => {
    const f = fixture(id);
    assert.deepEqual(judge(typingRecord(f), ctxOf(f)).fails, []);
  });
  test(`${id}: the reviewer's synthetic record (whole box typed, no arrow, msg_line 99, msg_col 3) fails on the counters`, () => {
    const f = fixture(id);
    const r = judge(typingRecord(f, { typedLine: 99, typedCol: 99, msg_line: 99, msg_col: 3 }), ctxOf(f));
    assert.equal(r.ok, false);
    assert.ok(r.fails.some((x) => /msg_line 99 is outside the compiled first page/.test(x)), r.fails.join('|'));
  });
  test(`${id}: a complete page with honest counters (msg_col 13 of 13) fails as a complete page`, () => {
    const f = fixture(id);
    const r = judge(typingRecord(f, { typedLine: 0, typedCol: 13, msg_line: 0, msg_col: 13 }), ctxOf(f));
    assert.ok(r.fails.some((x) => /whole first page typed/.test(x)), r.fails.join('|'));
    assert.ok(r.fails.some((x) => /outside the declared typing prefix/.test(x)), r.fails.join('|'));
  });
  test(`${id}: premature text (counters at 3, every glyph already drawn) fails on the bytes`, () => {
    const f = fixture(id);
    const r = judge(typingRecord(f, { typedLine: 0, typedCol: 13, msg_line: 0, msg_col: 3 }), ctxOf(f));
    assert.equal(r.ok, false);
    assert.ok(r.fails.some((x) => /tile/.test(x)), r.fails.join('|'));
  });
  test(`${id}: honest progress beyond the declared prefix, and an undeclared scenario, both fail`, () => {
    const f = fixture(id);
    const far = judge(typingRecord(f, { typedCol: 9, msg_col: 9 }), ctxOf(f));
    assert.ok(far.fails.some((x) => /outside the declared typing prefix 3\.\.6/.test(x)), far.fails.join('|'));
    const undeclared = judge(typingRecord(f), { ...ctxOf(f), typing: undefined });
    assert.ok(undeclared.fails.some((x) => /declares no typing prefix/.test(x)), undeclared.fails.join('|'));
  });
}
test('typingProgressFailures: line past the page, column past the line, zero column', () => {
  assert.ok(typingProgressFailures({ msg_line: 1, msg_col: 3 }, 'RING SCREEN 0', TYPING).some((x) => /msg_line 1 is outside/.test(x)));
  assert.ok(typingProgressFailures({ msg_line: 0, msg_col: 40 }, 'RING SCREEN 0', TYPING).some((x) => /msg_col 40 is outside text line 0/.test(x)));
  assert.ok(typingProgressFailures({ msg_line: 0, msg_col: 0 }, 'RING SCREEN 0', TYPING).some((x) => /msg_col 0 is outside/.test(x)));
  assert.deepEqual(typingProgressFailures({ msg_line: 0, msg_col: 4 }, 'RING SCREEN 0', TYPING), []);
});

// ---- exact record sequence (review 2 finding 2): checkpoint ids, hold targets and dialogue transactions, in the declared order.
function synthRecords(sequence, gridW = 4) {
  const out = [];
  for (const e of sequence) {
    if (e.t === 'check') out.push({ label: e.label, kind: 'settled', state: { sw_col: 0, sw_row: 0 } });
    else if (e.t === 'hold') out.push({ label: e.label, kind: 'hold', hold: { reached: true } });
    else {
      const st = { sw_col: e.screen % gridW, sw_row: Math.floor(e.screen / gridW) };
      const k = out.filter((r) => r.kind === 'dlg-open').length;
      out.push({ label: `d${k}:typing`, kind: 'dlg-typing', state: st }, { label: `d${k}:open`, kind: 'dlg-open', state: st }, { label: `d${k}:closed`, kind: 'settled', state: st });
    }
  }
  return out;
}
for (const [name, scene] of [['lap vertical', laps({ ring: 1, talkers: 'enter' })], ['lap horizontal', laps({ ring: 2, talkers: 'enter' })], ['seam landing', seam({ ring: 1, variant: 1 })], ['lap, no talkers', laps({ ring: 1, talkers: 'none' })]]) {
  const seq = scene.expect.sequence;
  const gridW = scene.expect.ring === 1 ? 4 : 1;
  const run = (records) => sequenceFailures(records, seq, gridW);
  const base = () => synthRecords(seq, gridW);
  test(`${name}: the declared sequence, observed exactly, passes`, () => assert.deepEqual(run(base()), []));
  test(`${name}: removing the cold-boot / first checkpoint fails as missing`, () => {
    const r = base(); const i = r.findIndex((x) => x.kind === 'settled' && !x.label.endsWith(':closed')); r.splice(i, 1);
    assert.ok(run(r).some((x) => /missing mandatory record check:/.test(x)), run(r).join('|'));
  });
  test(`${name}: substituting a checkpoint label fails (missing and unexpected)`, () => {
    const r = base(); const i = r.findIndex((x) => x.kind === 'settled' && !x.label.endsWith(':closed')); r[i] = { ...r[i], label: 'cold-boot-2' };
    const f = run(r);
    assert.ok(f.some((x) => /missing mandatory record/.test(x)) && f.some((x) => /unexpected record check:cold-boot-2/.test(x)), f.join('|'));
  });
  test(`${name}: a duplicated checkpoint fails`, () => {
    const r = base(); const i = r.findIndex((x) => x.kind === 'settled' && !x.label.endsWith(':closed')); r.splice(i, 0, r[i]);
    assert.ok(run(r).some((x) => /duplicate record check:/.test(x)), run(r).join('|'));
  });
  test(`${name}: an unexpected extra record fails`, () => {
    const r = base(); r.push({ label: 'extra', kind: 'settled', state: { sw_col: 0, sw_row: 0 } });
    assert.ok(run(r).some((x) => /unexpected record check:extra/.test(x)), run(r).join('|'));
  });
  if (seq.filter((e) => e.t === 'hold').length >= 2) {
    test(`${name}: two holds swapped (reordered) fail, and a missing / wrong-target hold fails`, () => {
      const r = base(); const hs = r.map((x, i) => (x.kind === 'hold' ? i : -1)).filter((i) => i >= 0);
      const swapped = r.slice(); [swapped[hs[0]], swapped[hs[1]]] = [swapped[hs[1]], swapped[hs[0]]];
      assert.ok(run(swapped).some((x) => /reordered records/.test(x)), run(swapped).join('|'));
      const gone = r.slice(); gone.splice(hs[0], 1);
      assert.ok(run(gone).some((x) => /missing mandatory record hold:/.test(x)), run(gone).join('|'));
      const wrong = r.slice(); wrong[hs[0]] = { ...wrong[hs[0]], label: 'hold:right:1' };
      assert.ok(run(wrong).some((x) => /unexpected record hold:hold:right:1/.test(x)), run(wrong).join('|'));
    });
  }
  if (seq.some((e) => e.t === 'dialogue')) {
    test(`${name}: a dialogue missing its typing stage, a dropped dialogue, a wrong-screen dialogue and an unexpected one all fail`, () => {
      const r = base(); const i = r.findIndex((x) => x.kind === 'dlg-typing');
      const noTyping = r.slice(); noTyping.splice(i, 1);
      assert.ok(run(noTyping).some((x) => /missing mandatory record dialogue@/.test(x)), run(noTyping).join('|'));
      const dropped = r.slice(); dropped.splice(i, 3);
      assert.ok(run(dropped).some((x) => /missing mandatory record dialogue@/.test(x)), run(dropped).join('|'));
      const moved = r.map((x, k) => (k >= i && k < i + 3 ? { ...x, state: { sw_col: 3, sw_row: 0 } } : x));
      const wrongScreen = seq.find((e) => e.t === 'dialogue').screen !== 3;
      if (wrongScreen) assert.ok(run(moved).some((x) => /dialogue@3/.test(x)), run(moved).join('|'));
      const extra = r.concat([{ label: 'x~1~unexpected:typing', kind: 'dlg-typing', state: { sw_col: 0, sw_row: 0 } }, { label: 'x~1~unexpected:open', kind: 'dlg-open', state: { sw_col: 0, sw_row: 0 } }, { label: 'x~1~unexpected:closed', kind: 'settled', state: { sw_col: 0, sw_row: 0 } }]);
      assert.ok(run(extra).some((x) => /unexpected record dialogue@0\(unexpected/.test(x)), run(extra).join('|'));
    });
  }
}
test('a scenario with no declared sequence fails: coverage cannot be opted out of', () => {
  assert.ok(sequenceFailures([{ label: 'cold-boot', kind: 'settled', state: { sw_col: 0, sw_row: 0 } }], undefined, 4).some((x) => /declares no record sequence/.test(x)));
});

// ---- Round 3 coverage-verdict controls (judgeCoverage on synthetic records; no emulator) ----
import { judgeCoverage } from './ringjudge.mjs';
import { windowBlock, GEOM, requiredWitnesses, observedWitnesses, observedWitnessRecords } from './ringwitness.mjs';

const cov = (records, expect) => judgeCoverage(records, expect, { gridW: 1, ring: 2, project: null, typing: TYPING });
const S = (over = {}) => ({ game_state: 0, sw_col: 0, sw_row: 1, player_x: 120, player_y: 77, cam_nt: 0, cam_x_lo: 0, cam_y_lo: 205, st_active: 0, vram_len: 0, box_state: 0, msg_col: 0, msg_line: 0, map_is_streamed: 1, ppuctrl_nt: 0, ...over });
const R = (label, kind, over) => ({ label, kind, state: S(over), vram: { 0x2000: new Uint8Array(1) } });
const H = (label, hold) => ({ label, kind: 'hold', hold });
const shakeRecords = ({ quiet = 12, polarity = 1, after = {}, entryBlanks } = {}) => [
  ...Array.from({ length: quiet }, (_, i) => R(`shake:k0:f${i}`, 'shake-frame', { ppuctrl_nt: i % 2 ? polarity : 0 })),
  H('hold:shake:k0', { btn: 'shake', axis: 'y', entry: 'shake', minBlanks: 8, blanks: entryBlanks ?? quiet, reached: true, why: 'target', pos: 469 }),
  R('sw:shake-after:k0', 'settled', after)
];
const shakeExpect = (witnesses) => ({ kind: 'shake', ring: 2, n: 6, holds: 1, walls: [], dialogues: 0, boxLiveNts: [], boxSeam: false, typing: TYPING,
  sequence: [{ t: 'hold', label: 'hold:shake:k0' }, { t: 'check', label: 'sw:shake-after:k0' }], witnesses });
const WIT = ['shake:ppuctrl=0', 'shake:ppuctrl=1', 'shake-restored:cam_nt=0'];

test('shake coverage: a clean shake record set satisfies every declared witness (the matching positive)', () => {
  const v = cov(shakeRecords(), shakeExpect(WIT));
  assert.deepEqual(v.fails, []);
});
test('shake coverage: a shake that never selected nametable 1 is a named missing witness', () => {
  const v = cov(shakeRecords({ polarity: 0 }), shakeExpect(WIT));
  assert.ok(v.fails.some((f) => /missing witness shake:ppuctrl=1/.test(f)), v.fails.join('|'));
});
test('shake coverage: PPUCTRL left on the alias after the shake is not a restoration', () => {
  const v = cov(shakeRecords({ after: { ppuctrl_nt: 1 } }), shakeExpect(WIT));
  assert.ok(v.fails.some((f) => /missing witness shake-restored:cam_nt=0/.test(f)), v.fails.join('|'));
});
test('shake coverage: fewer than 8 quiet frames fails the entry count even when every witness is present', () => {
  const v = cov(shakeRecords({ quiet: 4, entryBlanks: 4 }), shakeExpect(WIT));
  assert.ok(v.fails.some((f) => /entry shake .* 4 .* needs >= 8/.test(f)), v.fails.join('|'));
});
test('shake coverage: the variable number of shake-frame records never perturbs the declared sequence', () => {
  for (const q of [8, 12]) assert.deepEqual(cov(shakeRecords({ quiet: q }), shakeExpect(WIT)).fails, []);
});
test('hold controls: a redraw entry with too few forced blanks, an unreached hold, an unstopped wall and an unknown record kind all fail', () => {
  const base = { kind: 'redraw', ring: 2, n: 6, walls: [], dialogues: 0, boxLiveNts: [], boxSeam: false, typing: TYPING, witnesses: [] };
  const one = (h, expectOver = {}) => cov([H('hold:x', h)], { ...base, holds: 1, sequence: [{ t: 'hold', label: 'hold:x' }], ...expectOver });
  assert.ok(one({ btn: 'battle', entry: 'battle', minBlanks: 2, blanks: 1, reached: true, why: 'fought', pos: 0 }).fails.some((f) => /entry battle .* 1 .* needs >= 2/.test(f)));
  assert.ok(one({ btn: 'down', reached: false, why: 'max', pos: 5 }).fails.some((f) => /did not reach its target/.test(f)));
  assert.ok(one({ btn: 'down', reached: true, why: 'target', pos: 5 }, { walls: ['hold:x'] }).fails.some((f) => /was not stopped by the wall/.test(f)));
  assert.deepEqual(one({ btn: 'down', reached: false, why: 'blocked', pos: 5 }, { walls: ['hold:x'] }).fails, []);
  assert.ok(cov([R('x', 'mystery')], { ...base, holds: 0, sequence: [] }).fails.some((f) => /unknown kind mystery/.test(f)));
});
test('witness controls: a stream witness needs the window to have moved on from its redraw; a redraw witness is keyed by the entry and the origin', () => {
  const at = (py, sr) => ({ sw_row: sr, player_y: py, player_x: 120 });
  const mk = (label, over) => R(label, 'settled', over);
  // ring 2, n=10: Wf(b) = (b+7)*16+112; world y 1668 -> b = (1668-112)/16-7 = 90.25 -> block 90
  const redraw = mk('sw:redraw:battle:b=90:fwd', at(228, 6));
  const stayed = mk('sw:stream:battle:b=90:fwd', at(228, 6));
  const moved = mk('sw:stream:battle:b=90:fwd', at(8, 7));
  const w = (recs) => [...observedWitnesses(recs, { ring: 2, n: 10 }).keys()];
  assert.ok(w([redraw]).includes(`redraw:battle:c0=${windowBlock({ ring: 2, n: 10, col: 0, row: 6, px: 120, py: 228 }) % GEOM[2].P}:fwd`));
  assert.ok(!w([redraw, stayed]).some((id) => id.startsWith('stream:')), 'a stream check at the same window is not a stream witness');
  assert.ok(w([redraw, moved]).some((id) => id.startsWith('stream:battle:')), 'the window moved on: the stream witness is observed');
  assert.ok(!w([moved]).some((id) => id.startsWith('stream:')), 'a stream check with no redraw before it witnesses nothing');
  void requiredWitnesses;
});

test('slot and Continue-place controls: a battle from an unplanned slot, a Continue that lands elsewhere or that records no place all fail; the matching records pass', () => {
  const base = { kind: 'redraw', ring: 2, n: 6, walls: [], dialogues: 0, boxLiveNts: [], boxSeam: false, typing: TYPING, witnesses: [] };
  const one = (h, label) => cov([H(label, h)], { ...base, holds: 1, sequence: [{ t: 'hold', label }] });
  const battle = (slot, expectSlot) => ({ btn: 'battle', entry: 'battle', minBlanks: 2, blanks: 2, reached: true, why: 'fought', pos: 0, slot, expectSlot });
  assert.deepEqual(one(battle(5, 5), 'hold:x').fails, []);
  assert.ok(one(battle(2, 5), 'hold:x').fails.some((f) => /contact from entity slot 2, the plan put the monster in slot 5/.test(f)));
  assert.deepEqual(one({ ...battle(0, undefined), expectSlot: undefined }, 'hold:x').fails, [], 'a hold with no planned slot is not slot-checked (the older scenes)');
  const place = { worldX: 120, worldY: 464, curMap: 0, flatScreen: 1 };
  const cyc = (over) => ({ btn: 'cycle', entry: 'continue', minBlanks: 1, blanks: 1, reached: true, why: 'target', pos: 464, place, placeBefore: place, ...over });
  assert.deepEqual(one(cyc({}), 'hold:cycle:x').fails, []);
  assert.ok(one(cyc({ place: { ...place, worldY: 465 } }), 'hold:cycle:x').fails.some((f) => /landed at .*"worldY":465.*ended at .*"worldY":464/.test(f)), 'a Continue one pixel off the saved place');
  assert.ok(one(cyc({ place: { ...place, flatScreen: 2 } }), 'hold:cycle:x').fails.some((f) => /Continue hold:cycle:x landed at/.test(f)), 'the wrong flat screen');
  assert.ok(one(cyc({ placeBefore: undefined }), 'hold:cycle:x').fails.some((f) => /no pre-cycle place recorded/.test(f)));
  assert.ok(one(cyc({ place: undefined }), 'hold:cycle:x').fails.some((f) => /no landed place recorded/.test(f)));
});
test('witness -> record map: the first observing record of each identity carries its label, kind, window and state; a battle slot is a witness', () => {
  const at = (py, sr) => ({ sw_row: sr, player_y: py, player_x: 120 });
  const redraw = R('sw:redraw:continue:b=90:fwd', 'settled', at(228, 6));
  const bat = H('hold:battle:f2', { btn: 'battle', entry: 'battle', minBlanks: 2, blanks: 2, reached: true, why: 'fought', pos: 7, slot: 5, expectSlot: 5 });
  const rec = observedWitnessRecords([bat, redraw, redraw], { ring: 2, n: 10 });
  const slot = rec.get('battle-slot:5');
  assert.equal(slot.label, 'hold:battle:f2'); assert.equal(slot.index, 0); assert.equal(slot.kind, 'hold'); assert.equal(slot.hold.slot, 5);
  const land = [...rec.entries()].find(([id]) => id.startsWith('redraw:continue:'));
  assert.equal(land[1].label, 'sw:redraw:continue:b=90:fwd'); assert.equal(land[1].index, 1); assert.equal(land[1].state.player_y, 228); assert.equal(typeof land[1].b, 'number');
  assert.ok(rec.has(`continue-land:s=6:y=228`));
  // the plain map and the detail map hold the same identities
  assert.deepEqual([...observedWitnesses([bat, redraw], { ring: 2, n: 10 }).keys()].sort(), [...observedWitnessRecords([bat, redraw], { ring: 2, n: 10 }).keys()].sort());
});
