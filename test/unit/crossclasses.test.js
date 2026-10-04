// Phase 3a slice S3b: the composition classes of the cross stage (test/lua/sw_cross_classes.mjs) -- plan 4.5, review 2 section 3, spike review 3
// section 2. Every expectation here is hand-written from those documents and from REAL bodies (test/fixtures/crossstage/real-bodies.json, measured
// through the shipped manifest harness), never computed from the predicate under test.
//
// What the controls prove:
//   B-positive re-arm   the Flash-tail crossing body that ends `pub = 35, fl = 1, rfl = 7` IS a Flash publication / column arm / crossing body.
//                       The v2 predicate (reimplemented below as the oracle of the DEFECT, `v2FlashPublished`) rejects it; the shipped one accepts it.
//   A-positive/B-negative  a real drain-only class-(a) body runs flash_tick (its hold tick) and publishes nothing: hseam-a, not hseam-b.
//   mutations           each property removed from the B body (the producer's apply mark, the published packet, flash_tick, the column arm, the crossing)
//                       makes class B stop firing -- so "any rfl = 7 body" is not accepted without producer evidence.
// "Covers all publication tails" is NOT claimed: the apply-mark rule covers a body on which flash_tick actually called a publishing routine; a body
// whose only Flash evidence is the saved end-of-body state is classified only by the derived-historical rule, which is labelled as derived.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATE, PACKET_MIN, bodyRows, flashPublished, flashPublishedHistorical, isCrossing, classifyBodies, gateProblems, gatedRows, worstGated,
  crossingExpectation, requiredClasses, cellVerdict, factProblems, traceProblems, stageCompositionProblems, SEAM_SLACK, parentTiming
} from '../lua/sw_cross_classes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/crossstage', name), 'utf8'));
const real = fx('real-bodies.json');
const counter = fx('rearm-counterexamples.json').rows;
const clone = (x) => structuredClone(x);
const crossingOf = (rows) => rows.find((r) => r.ran.includes('move_tick') && r.ran.includes('spawn_entities'));
const classesOf = (rows, opts) => classifyBodies(rows, opts).flatMap((b) => b.classes);

// The v2 predicate, written out as the oracle of the defect (spike/hseam3.mjs flashPublished): the end-of-body state must show 1 -> 255 or 7 -> 6.
const v2FlashPublished = (r) => r.ran.includes('flash_tick') && ((r.fl === 7 && r.rfl === 6) || (r.fl === 1 && r.rfl === 255)) && r.pub >= 35;

test('the packet size the classifier requires is one whole palette packet: 32 bytes of data and its 3-byte header', () => {
  assert.equal(PACKET_MIN, 35);
  assert.equal(GATE, 29780);
});

test('B-positive re-arm control: the real Flash-tail body that ends pub 35 / fl 1 / rfl 7 is a class (b) body; the v2 predicate rejected it', () => {
  const B = crossingOf(real.rearmB.rows);
  assert.deepEqual([B.pub, B.fl, B.rfl], [35, 1, 7], 'the fixture really is the re-arm case');
  assert.equal(v2FlashPublished(B), false, 'the end-of-body predicate loses this body (the defect)');
  assert.equal(flashPublished(B), true);
  const got = classifyBodies(real.rearmB.rows, { tail: 'flash' });
  assert.deepEqual(got.map((b) => b.classes), [['crossing', 'hseam-b']]);
  assert.equal(got[0].basis, 'marks');
  // the producer evidence is what decides, in both of the two publishing calls
  for (const mark of ['fade_apply_palette']) assert.ok(B.ran.includes(mark));
});

test('A-positive / B-negative control: a real drain-only class-(a) body runs flash_tick but publishes nothing', () => {
  const A = crossingOf(real.classA.rows);
  assert.deepEqual([A.q, A.stadv, A.st0, A.st1, A.pub], [35, 1, 0, 1, 0], 'the fixture really is the drain-only body');
  assert.ok(A.ran.includes('flash_tick'), 'flash_tick ran: a classifier keyed on the mark alone would call it B');
  assert.equal(flashPublished(A), false);
  assert.deepEqual(classifyBodies(real.classA.rows, { tail: 'switch' }).map((b) => b.classes), [['crossing', 'hseam-a']]);
});

test('mutations of the B body: each missing property stops class (b) -- producer, packet, flash_tick, column arm, crossing', () => {
  const base = real.rearmB.rows;
  const cases = [
    ['no apply call (the body ran only flash_tick\'s hold/confirm tick)', (r) => { r.ran = r.ran.filter((m) => m !== 'fade_apply_palette' && m !== 'flash_apply_on'); }],
    ['nothing published (pub = 0)', (r) => { r.pub = 0; }],
    ['a partial packet (pub = 34)', (r) => { r.pub = 34; }],
    ['no flash_tick', (r) => { r.ran = r.ran.filter((m) => m !== 'flash_tick'); }],
    ['no column arm', (r) => { r.ran = r.ran.filter((m) => m !== 'sw_stream_start_col'); }],
    ['no crossing hook', (r) => { r.ran = r.ran.filter((m) => m !== 'sw_talker_cross'); }],
    ['no spawn_entities', (r) => { r.ran = r.ran.filter((m) => m !== 'spawn_entities'); }]
  ];
  for (const [name, mutate] of cases) {
    const rows = clone(base);
    mutate(crossingOf(rows) ?? rows.find((r) => r.ran.includes('flash_tick')));
    assert.ok(!classesOf(rows, { tail: 'flash' }).includes('hseam-b'), `${name}: class (b) must not fire`);
  }
  // and "any rfl = 7 body" is NOT accepted: the same state without producer evidence is negative
  const rows = clone(base);
  const B = crossingOf(rows);
  B.ran = B.ran.filter((m) => m !== 'fade_apply_palette');
  assert.deepEqual([B.pub, B.fl, B.rfl], [35, 1, 7]);
  assert.ok(!classesOf(rows, { tail: 'flash' }).includes('hseam-b'));
});

test('the 26 preserved Flash-tail records: rejected by v2, and classified B only by the DERIVED-HISTORICAL rule, labelled as derived', () => {
  assert.equal(counter.length, 26);
  for (const r of counter) {
    assert.deepEqual([r.pub, r.fl, r.rfl], [35, 1, 7], `${r.file} frame ${r.f}`);
    assert.equal(v2FlashPublished(r), false, 'v2 loses every one of them');
    assert.equal(flashPublished(r), false, 'no apply marks were recorded then: the marks rule cannot vouch for them');
    assert.equal(flashPublishedHistorical(r, { tail: 'flash' }), false, 'a Flash TAIL is not a switch-tail recipe: the derived rule does not cover it');
  }
  // the derived rule covers switch-tail recipes only (spike review 3, "Stored rows without rfl"), and says so
  const sw = clone(counter[0]);
  sw.ran = [...sw.ran, 'script_op_set'];
  assert.equal(flashPublishedHistorical(sw, { tail: 'switch' }), true);
  const got = classifyBodies([sw], { tail: 'switch', historical: true }).find((b) => b.classes.includes('hseam-b'));
  assert.equal(got?.basis, 'derived-historical');
  assert.equal(classifyBodies([sw], { tail: 'switch' }).some((b) => b.classes.includes('hseam-b')), false, 'never without asking for the historical reading');
});

// ---- the other classes, from a real vertical body and from rows with one property removed

const V = () => clone(real.vseam.rows);
test('vseam: the real vertical body is crossing + vseam; each property removed fails the class (no q, no arm, no move_finish, no hook, no continuation)', () => {
  assert.deepEqual(classifyBodies(V(), { tail: 'switch' }).map((b) => b.classes), [['crossing', 'vseam']]);
  const drops = [
    ['q = 0 (nothing queued at the releasing NMI)', (r) => { r.q = 0; }],
    ['no row arm mark', (r) => { r.ran = r.ran.filter((m) => m !== 'sw_stream_start_row'); }],
    ['st1 = 0 (nothing armed)', (r) => { r.st1 = 0; }],
    ['st0 != 0 (a strip was already in flight: not an arm)', (r) => { r.st0 = 1; }],
    ['no move_finish', (r) => { r.ran = r.ran.filter((m) => m !== 'move_finish'); }],
    ['no tail continuation', (r) => { r.ran = r.ran.filter((m) => m !== 'script_op_set'); }]
  ];
  for (const [name, f] of drops) { const rows = V(); f(rows[0]); assert.ok(!classesOf(rows, { tail: 'switch' }).includes('vseam'), `${name}: vseam must not fire`); }
  const noHook = V(); noHook[0].ran = noHook[0].ran.filter((m) => m !== 'sw_talker_cross');
  assert.deepEqual(classesOf(noHook, { tail: 'switch' }), [], 'without sw_talker_cross it is not a crossing at all, so no class fires');
  // a tail with no continuation mark (none) does not demand one
  const none = V(); none[0].ran = none[0].ran.filter((m) => m !== 'script_op_set');
  assert.ok(classesOf(none, { tail: 'none' }).includes('vseam'));
});

test('hseam-a: each property removed from the real class-(a) body fails it (queue range, strip completion, arm, previous strip)', () => {
  const A = () => clone(real.classA.rows);
  const drops = [
    ['q = 0', (r) => { r.q = 0; }],
    ['q = 36 (an exclusive queue: the strip waits)', (r) => { r.q = 36; }],
    ['the releasing NMI advanced no strip (stadv 0)', (r) => { r.stadv = 0; }],
    ['st0 != 0', (r) => { r.st0 = 2; }],
    ['st1 = 0', (r) => { r.st1 = 0; }],
    ['no column arm', (r) => { r.ran = r.ran.filter((m) => m !== 'sw_stream_start_col'); }]
  ];
  for (const [name, f] of drops) { const rows = A(); f(crossingOf(rows)); assert.ok(!classesOf(rows, { tail: 'switch' }).includes('hseam-a'), `${name}: hseam-a must not fire`); }
  const rows = A();
  const i = rows.indexOf(crossingOf(rows));
  rows[i - 1].st1 = 0; // the previous body ended with the strip idle: nothing was completed in this releasing NMI
  assert.ok(!classesOf(rows, { tail: 'switch' }).includes('hseam-a'), 'a previous idle strip: hseam-a must not fire');
});

test('preseam-arm: the long Move\'s last row arm before the seam, and not the crossing itself', () => {
  const row = { f: 716, G: 25264, q: 0, st0: 0, st1: 2, stadv: 0, pub: 0, fl: 0, rfl: 0, col: 2, row: 58, px: 242, py: 200, ran: ['move_tick', 'sw_frame_camera_window', 'sw_stream_start_row'] };
  assert.deepEqual(classifyBodies([row], { tail: 'say' }).map((b) => b.classes), [['preseam-arm']]);
  for (const [name, f] of [['no camera call', (r) => { r.ran = r.ran.filter((m) => m !== 'sw_frame_camera_window'); }], ['no arm mark', (r) => { r.ran = r.ran.filter((m) => m !== 'sw_stream_start_row'); }], ['already active', (r) => { r.st0 = 1; }], ['nothing armed', (r) => { r.st1 = 0; }]]) {
    const r = clone(row); f(r); assert.deepEqual(classesOf([r], { tail: 'say' }), [], name);
  }
  const crossed = clone(row); crossed.ran.push('spawn_entities', 'sw_talker_cross');
  assert.ok(!classesOf([crossed], { tail: 'say' }).includes('preseam-arm'), 'a body that crossed is a crossing, not the pre-seam arm');
});

test('return: a second crossing back to the first column whose body rebound the talker\'s LAST slot (eight scan steps, never the gone path)', () => {
  const mk = (f, col, extra = [], count = {}) => ({ f, G: 20000, q: 0, st0: 0, st1: 0, stadv: 0, pub: 0, fl: 0, rfl: 0, col, row: 27, px: 0, py: 0, ran: ['move_tick', 'spawn_entities', 'sw_talker_cross', ...extra], count });
  const last = (extra = []) => mk(90, 1, ['sw_talker_rebind', 'sw_tr_loop', ...extra], { sw_tr_loop: 8 });
  const first = mk(70, 2, ['sw_talker_rebind', 'sw_tr_loop'], { sw_tr_loop: 1 });
  assert.deepEqual(classifyBodies([first, last()]).map((b) => b.classes.includes('return')), [false, true]);
  assert.ok(!classifyBodies([mk(70, 2), mk(90, 1)]).some((b) => b.classes.includes('return')), 'no rebind on the second crossing');
  assert.ok(!classifyBodies([first, mk(90, 3, ['sw_talker_rebind', 'sw_tr_loop'], { sw_tr_loop: 8 })]).some((b) => b.classes.includes('return')), 'a second crossing onward is not a return');
  // a rebind that found its talker EARLY (a slot other than the last) or went down the gone path is not the last-slot return
  assert.ok(!classifyBodies([first, mk(90, 1, ['sw_talker_rebind', 'sw_tr_loop'], { sw_tr_loop: 3 })]).some((b) => b.classes.includes('return')), 'found in slot 2: not the last slot');
  assert.ok(!classifyBodies([first, last(['sw_tr_gone'])]).some((b) => b.classes.includes('return')), 'the gone path is not a rebind');
  assert.ok(classifyBodies([first, last()]).some((b) => b.classes.includes('return-rebind-only')) === false);
  assert.ok(classifyBodies([first, mk(90, 1, ['sw_talker_rebind', 'sw_tr_loop'], { sw_tr_loop: 3 })]).some((b) => b.classes.includes('return-rebind-only')));
});

test('return-prod: the return body must also publish a Flash palette packet (a queue drain alone is not a same-body producer)', () => {
  const ret = (extra = {}, ran = []) => ({ f: 90, G: 20000, q: 0, st0: 0, st1: 0, stadv: 0, pub: 0, fl: 0, rfl: 0, col: 1, row: 27, px: 0, py: 0, ran: ['move_tick', 'spawn_entities', 'sw_talker_cross', 'sw_talker_rebind', 'sw_tr_loop', ...ran], count: { sw_tr_loop: 8 }, ...extra });
  const first = { f: 70, G: 20000, q: 0, st0: 0, st1: 0, stadv: 0, pub: 0, fl: 0, rfl: 0, col: 2, row: 27, px: 0, py: 0, ran: ['move_tick', 'spawn_entities', 'sw_talker_cross'] };
  const prod = (r) => classifyBodies([first, r]).flatMap((b) => b.classes).includes('return-prod');
  assert.equal(prod(ret({ pub: 35, fl: 1, rfl: 7 }, ['flash_tick', 'flash_apply_on'])), true);
  assert.equal(prod(ret({ q: 35 })), false, 'queue drain alone');
  assert.equal(prod(ret({ pub: 35 }, ['sw_stream_start_col'])), false, 'a column arm alone');
  assert.equal(prod(ret({ pub: 35, fl: 1, rfl: 7 }, ['flash_tick'])), false, 'flash_tick without the apply mark published nothing');
});

// ---- the gate and the per-cell verdict

const body = (G, ran, extra = {}) => ({ f: 1, G, q: 0, st0: 0, st1: 0, stadv: 0, pub: 0, fl: 0, rfl: 0, col: 1, row: 1, px: 0, py: 0, ran, ...extra });
test('every Move or crossing body is gated whatever its class; an over-gate row fails; an empty run gates nothing and fails', () => {
  const rows = [body(29780, ['move_tick']), body(29781, ['spawn_entities']), body(40000, ['script_op_say']), body(30000, ['move_finish'])];
  assert.equal(gatedRows(rows).length, 2);
  assert.equal(worstGated(rows), 29781);
  const problems = gateProblems(rows);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /G = 29781 exceeds the gate 29780/);
  assert.deepEqual(gateProblems([body(29780, ['move_tick'])]), []);
  assert.match(gateProblems([body(10, ['script_op_say'])])[0], /nothing was gated/);
  assert.equal(gateProblems([body(31000, ['move_tick'])], { gate: 31000 }).length, 0, 'the gate is injectable');
});

const cell = (over) => ({ stage: 'x4', which: 'new', dir: 'down', gt: 'action', wide: true, pop: 'many-small', anim: 'P1', bound: false, lead: 'flash', tail: 'switch', dist: 11, touchY: 239, ...over });
const ok = { status: 0, done: true, timeout: false };
test('cellVerdict: the real vertical body passes x4 under the gate; over-gate, missing class, bad status and timeout each fail', () => {
  const rows = V();
  assert.deepEqual(cellVerdict(cell({}), { ...ok, rows }), []);
  const over = V(); over[0].G = 29781;
  assert.ok(cellVerdict(cell({}), { ...ok, rows: over }).some((p) => /exceeds the gate/.test(p)));
  const noArm = V(); noArm[0].ran = noArm[0].ran.filter((m) => m !== 'sw_stream_start_row');
  assert.ok(cellVerdict(cell({}), { ...ok, rows: noArm }).some((p) => /missing composition class vseam/.test(p)));
  assert.ok(cellVerdict(cell({}), { ...ok, status: 1, rows }).some((p) => /exit status 1/.test(p)));
  assert.ok(cellVerdict(cell({}), { ...ok, timeout: true, rows }).some((p) => /timed out/.test(p)));
  assert.ok(cellVerdict(cell({}), { ...ok, done: false, rows }).some((p) => /did not finish/.test(p)));
  assert.ok(cellVerdict(cell({}), { ...ok, rows: [] }).some((p) => /no body was recorded/.test(p)));
});

test('a PARENT cell is held to a sound run AND to its scripted work: a missing crossing is expected, a missing Move or tail continuation is not', () => {
  const walk = [body(17617, ['move_tick', 'sw_frame_camera_window']), body(9400, ['move_finish', 'script_op_set'])];
  assert.deepEqual(cellVerdict(cell({ which: 'parent' }), { ...ok, rows: walk }), []);
  assert.ok(cellVerdict(cell({ which: 'parent' }), { ...ok, status: 2, rows: walk }).length > 0);
  // the 428 walking-only d11/y239 baselines: the parent never ran a Move at all
  const walking = [body(5000, ['sw_frame_camera_window'])];
  assert.deepEqual(cellVerdict(cell({ which: 'parent' }), { ...ok, rows: walking }).map((p) => p.slice(0, 22)), ['the parent ran no Move', 'the parent ran no fina', 'the parent\'s tail cont']);
  assert.ok(cellVerdict(cell({ which: 'parent' }), { ...ok, rows: [walk[0], body(9400, ['move_finish'])] }).some((p) => /tail continuation script_op_set/.test(p)), 'the final body lacks the switch tail');
  assert.deepEqual(cellVerdict(cell({ which: 'parent', tail: 'none' }), { ...ok, rows: [walk[0], body(9400, ['move_finish'])] }), [], 'a tail-less cell has no continuation to require');
  // ... and the stop-at-the-seam body on the NEW engine is a missing composition
  assert.ok(cellVerdict(cell({ which: 'new' }), { ...ok, rows: walk }).some((p) => /missing composition class/.test(p)));
  assert.deepEqual(parentTiming([body(100, ['move_tick']), body(300, ['move_finish']), body(900, ['script_op_say'])]), { move: 300, final: 300, bodies: 2 }, 'timing counts Move bodies only');
});

test('the crossing expectation by distance: required well past the seam, absent well short of it, either in between', () => {
  const at = (touchY, dist) => crossingExpectation({ touchY, dist });
  assert.equal(SEAM_SLACK, 16);
  assert.equal(at(60, 196), 'required'); // 240 - 60 = 180; 180 + 16
  assert.equal(at(60, 195), 'either');
  assert.equal(at(60, 164), 'absent'); // 180 - 16: the last distance that must NOT cross
  assert.equal(at(60, 165), 'either');
  assert.equal(at(239, 11), 'either', 'x4 starts a Move at the screen edge: it is held to vseam by its stage, not to this distance table');
});

test('the classes each stage requires of a NEW cell (x1 pre-seam arm, x4/x6 vseam, x5h class (a), x5r return); a parent requires none', () => {
  assert.deepEqual(requiredClasses({ stage: 'x1', which: 'new', touchY: 60, dist: 200 }), ['preseam-arm', 'crossing']);
  assert.deepEqual(requiredClasses({ stage: 'x1', which: 'new', touchY: 60, dist: 170 }), ['preseam-arm']);
  assert.deepEqual(requiredClasses({ stage: 'x2', which: 'new', touchY: 80, dist: 200 }), ['crossing']);
  assert.deepEqual(requiredClasses({ stage: 'x3', which: 'new', touchY: 60, dist: 200 }), ['crossing']);
  assert.deepEqual(requiredClasses({ stage: 'x4', which: 'new' }), ['crossing', 'vseam']);
  assert.deepEqual(requiredClasses({ stage: 'x6', which: 'new' }), ['crossing', 'vseam']);
  assert.deepEqual(requiredClasses({ stage: 'x5h', which: 'new', kind: 'classA' }), ['crossing', 'hseam-a']);
  assert.deepEqual(requiredClasses({ stage: 'x5h', which: 'new', kind: 'f1' }), ['crossing']);
  assert.deepEqual(requiredClasses({ stage: 'x5r', which: 'new' }), ['crossing', 'return', 'return-prod']);
  assert.deepEqual(requiredClasses({ stage: 'x4', which: 'parent' }), []);
  assert.throws(() => requiredClasses({ stage: 'x9', which: 'new' }), /unknown cross stage/);
});

test('the real horizontal bodies pass the full horizontal verdict (build facts and trace assertions), and each broken fact or trace property is named', () => {
  const facts = { destEntities: 8, destTiles: 15, boundTiles: 0, enterEvents: 1, touchOnSource: true };
  const c = { stage: 'x5h', kind: 'classA', which: 'new', dir: 'right', gt: 'action', wide: true, bound: false, tail: 'switch', enter: 'set', pop: 'many-small' };
  assert.deepEqual(factProblems(c, facts), []);
  for (const [name, f, re] of [['7 actors', { destEntities: 7 }, /not 8/], ['14 tiles plain', { destTiles: 14 }, /not 15/], ['a bound tile in a plain scene', { boundTiles: 1 }, /bound tile is present/], ['no enter event', { enterEvents: 0 }, /enter event/], ['no touch actor', { touchOnSource: false }, /touch actor/]]) {
    assert.match(factProblems(c, { ...facts, ...f }).join(';'), re, name);
  }
  assert.equal(factProblems({ ...c, bound: true }, { ...facts, destTiles: 14, boundTiles: 1 }).length, 0);
  // the trace assertions, on a run built around the real crossing body: a Flash lead, the approach, the crossing, the final body with the tail's
  // continuation, and the owed enter event firing right after
  const full = () => {
    const C = clone(crossingOf(real.classA.rows));
    const mk = (f, col, px, ran) => ({ ...clone(C), f, col, px, ran, q: 0, st0: 0, st1: 0, stadv: 0, pub: 0 });
    return [mk(60, 1, 200, ['script_op_flash']), mk(70, 1, 254, ['move_tick']), { ...C, f: 71, col: 2, px: 0 }, mk(72, 2, 1, ['move_tick', 'move_finish', 'script_op_set']), mk(73, 2, 2, ['settle_owed', 'start_dialog', 'script_op_set'])];
  };
  assert.deepEqual(traceProblems(c, full()), [], 'the whole run is sound');
  const breaks = [
    ['no crossing hook', (rows) => { for (const r of rows) r.ran = r.ran.filter((m) => m !== 'sw_talker_cross'); }, /no crossing body/],
    ['lands on the same column', (rows) => { rows[2].col = 1; }, /next column/],
    ['lands with the local x not wrapped', (rows) => { rows[2].px = 40; }, /next column/],
    ['changes the row', (rows) => { rows[2].row += 1; }, /changes the row/],
    ['no final Move body', (rows) => { rows[3].ran = rows[3].ran.filter((m) => m !== 'move_finish'); }, /no final Move body/],
    ['no Flash lead', (rows) => { rows[0].ran = []; }, /no Flash lead/],
    ['the tail continuation never ran', (rows) => { rows[3].ran = rows[3].ran.filter((m) => m !== 'script_op_set'); }, /continuation script_op_set did not run on the final Move body/],
    ['the owed enter event never fired', (rows) => { rows[4].ran = []; }, /owed enter event did not fire/],
    ['the owed enter event fired too late', (rows) => { rows[4].f = 90; }, /owed enter event did not fire/]
  ];
  for (const [name, f, re] of breaks) { const rows = full(); f(rows); assert.match(traceProblems(c, rows).join(';'), re, name); }
  // a Say tail holds the owed entry while its box is open: firing is the failure
  const say = full(); say[3].ran = ['move_tick', 'move_finish', 'script_op_say'];
  assert.match(traceProblems({ ...c, tail: 'say' }, say).join(';'), /fired while the Say box was open/);
  assert.deepEqual(traceProblems({ ...c, tail: 'say' }, say.slice(0, 4)), [], 'held: nothing fired');
});

test('stageCompositionProblems: a stage whose planned composition cells produce zero rows of a required class fails (an all-empty crossing campaign cannot pass)', () => {
  const cells = [cell({ id: 'a' }), cell({ id: 'b', gt: 'rpg' })];
  const measured = new Map([['a', { rows: [body(20000, ['move_tick'])] }], ['b', { rows: [body(20000, ['move_tick'])] }]]);
  assert.deepEqual(stageCompositionProblems('x4', cells, measured, { need: { x4: ['vseam'] } }), ['stage x4: no planned cell produced a vseam body']);
  measured.set('b', { rows: V() });
  assert.deepEqual(stageCompositionProblems('x4', cells, measured, { need: { x4: ['vseam'] } }), [], 'one real vseam row is enough for the stage');
});

test('bodyRows zips the MK and TR streams and refuses a run whose streams disagree', () => {
  const res = { marks: { M11: [{ f: 5, line: 'G=100 move_tick@10 NMI@3 spawn_entities@20 move_tick@30' }] }, trace: { M11: [{ f: 5, q: 35, pub: 0 }] } };
  const rows = bodyRows(res);
  assert.deepEqual(rows[0].ran, ['move_tick', 'spawn_entities']);
  assert.equal(rows[0].G, 100);
  assert.throws(() => bodyRows({ marks: { M11: [{ f: 5, line: 'G=1' }] }, trace: { M11: [] } }), /1 mark lines but 0 trace lines/);
  assert.throws(() => bodyRows({ marks: { M11: [{ f: 5, line: 'G=1' }] }, trace: { M11: [{ f: 6 }] } }), /mark frame 5 != trace frame 6/);
  assert.throws(() => bodyRows({ marks: { M11: [{ f: 5, line: 'no figure' }] }, trace: { M11: [{ f: 5 }] } }), /no finite G/);
  assert.equal(isCrossing(rows[0]), false, 'no talker hook mark: not a crossing');
});
