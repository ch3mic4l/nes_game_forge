// Unit checks of the S1c gate's own machinery (no emulator): section rendering, the NMI/close/split judges, the controls table, the chain audit and the gate table. For each
// rule: a SYNTHETIC record that satisfies it passes (the matching positive) and the corruption the rule exists to catch fails the item it declares -- and, for a control, no other
// item is allowed to be the reason. Run: node --test test/lua/ring_gate/s1c_unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSections } from './ringsections.mjs';
import { vblankMargin, modelNmi, judgeNmi, splitArmed, parseNmiOutput, GEOM, planCases, requiredCover, worstMetatiles, queueShape, packetsFor, SHAPE_A, SHAPE_B } from './ringnmi.mjs';
import { parseQueue, queueProblems, judgeClose, parseCloseOutput, closeShape } from './ringclose.mjs';
import { analyze, judgeSplit, judgeLifecycle, foldLifecycle, parseSplitOutput, SPLIT_SABOTAGES, harnessPsb, buildSplitRing, checkHarnessReservation, hdLayout, HD, HD_RESERVATION } from './ringsplit.mjs';
import { CONTROLS, controlIds, declaredFor, controlBuilds, controlFlags, controlHasForm, CELL_IDS, MMC3_CELLS, positiveLabel, controlLabel, REQUIRED_ITEMS, requiredItems } from './s1ccontrols.mjs';
import { validateS1cResult, decodeLabel, recomputeVerdict } from './s1caudit.mjs';
import zlib from 'node:zlib';
import { sha256, provenanceFor } from './ringtree.mjs';
import { auditChain } from './ringhome.mjs';
import { auditProvenance } from './ringprovindex.mjs';
import { s1bRowStatus, buildGate, render } from './s1c_gate.mjs';
import { jobs } from './ringjobs.mjs';
import { matrixScripts } from './ringjobs.mjs';
import { fingerprintGaps, harnessFingerprint } from './ringprov.mjs';
import { longestPath, nmiBound, maxQSum, certifiedMargin, decode, fixedBank, sweep, ENTRY_DELAY_CYCLES, VBLANK_CYCLES, RTI_CYCLES, OAM_DMA_CYCLES, OPCODES } from './ringwcet.mjs';
import { buildNmiRing, wcetFor } from './ringnmi.mjs';
import { makeCellTree } from './ringtree.mjs';
import { sabotageRings } from './ringsabotage.mjs';
import { CELLS, cellById } from './ringworld.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 's1c-unit-'));

// ---------------------------------------------------------------- renderSections
test('renderSections: legacy drops ring sections and markers, ring drops legacy ones', () => {
  const t = ['a', '--@legacy', 'L1', '--@endlegacy', '--@ring', 'R1', '--@endring', 'b'].join('\n');
  assert.equal(renderSections(t, 'legacy'), 'a\nL1\nb');
  assert.equal(renderSections(t, 'ring'), 'a\nR1\nb');
});
test('renderSections: an unbalanced or nested marker is an error, never a silently kept section', () => {
  assert.throws(() => renderSections('--@ring\nx', 'ring'), /unterminated/);
  assert.throws(() => renderSections('--@legacy\n--@ring\n--@endring\n--@endlegacy', 'ring'), /inside an open/);
  assert.throws(() => renderSections('--@endring', 'ring'), /closes nothing/);
  assert.throws(() => renderSections('x', 'both'), /unknown section mode/);
});
test('the real deadline templates render in both modes and the legacy render holds no marker line', () => {
  for (const f of ['sw_close_deadline.lua.template']) {
    const text = fs.readFileSync(path.join(HERE, '..', f), 'utf8');
    assert.ok(!/^--@/m.test(renderSections(text, 'legacy')) && !/^--@/m.test(renderSections(text, 'ring')));
  }
});

// ---------------------------------------------------------------- the NMI judge
test('vblankMargin: inside vblank passes, a finish before or past it fails', () => {
  assert.equal(vblankMargin(250, 100).ok, true);
  assert.equal(vblankMargin(5, 100).ok, false);
  assert.equal(vblankMargin(260, 340).ok, false); // rti's 18 remaining dots spill past scanline 260
});
const tiles = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, { tl: 16 + i, tr: 17 + i, bl: 40 + i, br: 41 + i, pal: i & 3 }]));
const h2 = (n) => (n & 255).toString(16).padStart(2, '0');
/** One synthetic strip-only NMI record of ring `ring`, exactly what the model wants (the matching positive); `mut` edits it. */
function nmiParsed(ring, mut = (n) => n) {
  const g = GEOM[ring];
  const pre = { active: g.axis, cur: 0, len: g.len, vary: 0, fnt: 0, ftile: 4, ready: 0, vlen: 0, sbuf: Uint8Array.from({ length: 32 }, (_, i) => 1 + ((i * 5 + 1) % 24)), shadow: new Uint8Array(256), vbuf: new Uint8Array(0) };
  const exp = modelNmi(pre, { ring, tiles });
  const n = mut({ caseIdx: 1, name: 'strip-a', frame: 3, pre, entry: { scanline: 241, cycle: 10 }, post: { ...exp.post, shadow: exp.shadow }, rti: { scanline: 250, cycle: 120 }, writes: [...exp.writes, 'C90', 'S00', 'S00'] });
  return { cases: [{ idx: 1, name: 'strip-a', mode: 'strip' }], nmis: [n], done: true, shortCase: false, error: null };
}
// a static bound a synthetic record satisfies (its interrupts last ~1060 cycles and enter 3 cycles after the edge); the real bound comes from ringwcet.mjs
const WCET_OK = { strip: 2100, mixed: 2150, mismatch: { strip: null, mixed: null } };
const nmiCtx = (ring, wcet = WCET_OK) => ({ ring, tiles, palFx: false, cases: [{ name: 'strip-a', mode: 'strip' }], wcet });
const failing = (items) => items.filter((i) => i.status === 'FAIL').map((i) => i.id);
for (const ring of [1, 2]) {
  test(`judgeNmi ring ${ring}: the model's own record passes every per-NMI item`, () => {
    const items = judgeNmi(nmiParsed(ring), nmiCtx(ring));
    assert.deepEqual(failing(items), []);
    for (const id of ['arm:geometry', 'ppu:writes', 'ppu:live-nt', 'block:advance', 'chunk:size', 'tail:scroll', 'deadline:strip']) assert.equal(items.find((i) => i.id === id).status, 'PASS', id);
  });
  test(`judgeNmi ring ${ring}: a strip armed at the other ring's length fails arm:geometry and nothing is called caught for an unrelated reason`, () => {
    const items = judgeNmi(nmiParsed(ring, (n) => ({ ...n, pre: { ...n.pre, len: 30 } })), nmiCtx(ring));
    assert.ok(failing(items).includes('arm:geometry'));
  });
  test(`judgeNmi ring ${ring}: an NMI that finishes past vblank fails deadline:strip only`, () => {
    const items = judgeNmi(nmiParsed(ring, (n) => ({ ...n, rti: { scanline: 5, cycle: 5 } })), nmiCtx(ring));
    assert.ok(failing(items).includes('deadline:strip'));
    assert.ok(!failing(items).includes('ppu:writes'));
  });
}
test('judgeNmi vertical: a block written at nametable +$08 fails ppu:writes AND ppu:live-nt (the dest-plus08 control)', () => {
  const items = judgeNmi(nmiParsed(1, (n) => ({ ...n, writes: n.writes.map((w, i) => (i === 0 ? `A${h2(parseInt(w.slice(1), 16) + 8)}` : w)) })), nmiCtx(1));
  assert.ok(failing(items).includes('ppu:writes') && failing(items).includes('ppu:live-nt'));
});
test('judgeNmi: a run that never finished is run:complete FAIL, never a pass', () => {
  const items = judgeNmi({ ...nmiParsed(1), done: false }, nmiCtx(1));
  assert.ok(failing(items).includes('run:complete'));
});
test('parseNmiOutput reads the recorder lines', () => {
  const line = 'NMI case=1 name=strip-a f=3 pre=1,0,15,0,0,4,0,0 sbuf=0102 shadow=- vbuf=- sl0=241 cy0=10 post=0,15,0,0,0 postshadow=- sl=250 cy=120 w=A20,D10';
  const p = parseNmiOutput(`CASE 1 strip-a strip\n${line}\nDONE ok\n`);
  assert.equal(p.nmis.length, 1);
  assert.equal(p.nmis[0].pre.len, 15);
  assert.deepEqual(p.nmis[0].writes, ['A20', 'D10']);
  assert.equal(p.done, true);
});

// ---------------------------------------------------------------- the close judge
const hex = (bytes) => bytes.map(h2).join('');
const pk = (hi, lo, data) => [hi, lo, data.length, ...data];
const rows = (n, v = 1) => Array.from({ length: n }, () => v);
/** A close queue for ring `ring` (vertical: close row split 3+a / 3+b across the join at column `a`). */
function closeQueue(ring, a = 20) {
  const flips = [...pk(0x20, 0x01, [1, 2]), ...pk(0x24 === 0 ? 0 : (ring === 1 ? 0x24 : 0x28), 0x01, [3, 4])];
  const flash = pk(0x3f, 0x00, rows(32));
  const arrow = pk(0x20, 0x41, [0]);
  const row = ring === 1 ? [...pk(0x22, 32 - a + 0x20 * 0, rows(a)), ...pk(0x26, 0x20 * 0, rows(32 - a))] : pk(0x22, 0x40, rows(32));
  const b = [...flips, ...flash, ...arrow, ...row, 0];
  return b;
}
test('closeShape: 88 bytes (vram_len 87) vertical, 85 (84) horizontal', () => {
  assert.deepEqual([closeShape(1).bytes, closeShape(1).vramLen, closeShape(2).bytes, closeShape(2).vramLen], [88, 87, 85, 84]);
});
test('queueProblems: a well-formed vertical split and horizontal one-packet queue each pass their own ring and fail the other (the retired fixed-87 assertion)', () => {
  // the vertical close row starts at column 32-a of a row and ends at its right edge; its second part starts at column 0 on the other live nametable
  const qv = closeQueue(1, 20);
  // adjust the vertical row so its first part reaches the right edge: lo & 31 == 12, cnt 20
  qv.splice(0, qv.length, ...[...pk(0x20, 0x01, [1, 2]), ...pk(0x24 + 0 * 0, 0x01, [3, 4]), ...pk(0x3f, 0, rows(32)), ...pk(0x20, 0x41, [0]), ...pk(0x22, 0x40 + 12, rows(20)), ...pk(0x26, 0x40, rows(12)), 0]);
  const hv = hex(qv);
  const pv = parseQueue(qv.length - 1, hv);
  assert.equal(qv.length, 88);
  assert.deepEqual(queueProblems(pv, 1), []);
  assert.ok(queueProblems(pv, 2).length > 0, 'an 88-byte queue is not the horizontal ring\'s close frame');
  const qh = [...pk(0x20, 0x01, [1, 2]), ...pk(0x28, 0x01, [3, 4]), ...pk(0x3f, 0, rows(32)), ...pk(0x20, 0x41, [0]), ...pk(0x22, 0x40, rows(32)), 0];
  assert.equal(qh.length, 85);
  const ph = parseQueue(qh.length - 1, hex(qh));
  assert.deepEqual(queueProblems(ph, 2), []);
  assert.ok(queueProblems(ph, 1).length > 0, 'an 85-byte queue is not the vertical ring\'s close frame');
});
test('parseQueue: a terminator before vram_len and a missing terminator are rejected', () => {
  assert.match(parseQueue(10, '0000000000').error, /terminator at 0/);
  assert.match(parseQueue(4, '2001010001ff').error ?? '', /terminator|packets end/);
});
test('judgeClose: exit 7 is a FAIL of close:queue (the old "workload short" pass route is closed), exit 0 with a good queue passes it', () => {
  const qh = [...pk(0x20, 0x01, [1, 2]), ...pk(0x28, 0x01, [3, 4]), ...pk(0x3f, 0, rows(32)), ...pk(0x20, 0x41, [0]), ...pk(0x22, 0x40, rows(32)), 0];
  const base = { queue: { len: 84, hex: hex(qh) }, fail: null, rti: { scanline: 250, cycle: 100, vramLen: 0, vramReady: 0, writes: 0 }, finish: { scanline: 255, cycle: 1, lastScroll: 255 }, oks: ['all 85 bytes', 'publication: ok', 'scroll reset ok'] };
  const good = judgeClose({ ...base, status: 0 }, { ring: 2 });
  assert.equal(good.find((i) => i.id === 'close:queue').status, 'PASS');
  const bad = judgeClose({ ...base, status: 7, fail: { code: 7, message: 'vram_len is 84, not 87' } }, { ring: 2 });
  assert.equal(bad.find((i) => i.id === 'close:queue').status, 'FAIL');
  const vert = judgeClose({ ...base, status: 0 }, { ring: 1 });
  assert.equal(vert.find((i) => i.id === 'close:queue').status, 'FAIL', 'an 84-byte horizontal queue is not the vertical ring\'s');
});
test('judgeClose: a harness error (exit 99) is run:operational FAIL, not a close verdict', () => {
  const items = judgeClose({ status: 99, queue: null, fail: null, rti: null, finish: null, oks: [] }, { ring: 1 });
  assert.equal(items.find((i) => i.id === 'run:operational').status, 'FAIL');
});
test('parseCloseOutput reads QUEUE / FAIL / RTI / FINISH lines', () => {
  const p = parseCloseOutput('QUEUE len=84 hex=2001\nRTI scanline=250 cycle=9 vram_len=0 vram_ready=0 writes=3\nFINISH scanline=255 cycle=2 lastscroll=255\nOK all 85 bytes\n', 0);
  assert.deepEqual([p.queue.len, p.rti.scanline, p.finish.lastScroll, p.oks.length], [84, 250, 255, 1]);
});

// ---------------------------------------------------------------- the split judge
const RANGES = { psb: [0x1000, 0x1100], arm: [0x2000, 0x2100], irq: [0x2100, 0x2200] };
const CTX = { fontR1: 10, boxL: 191, ranges: RANGES };
/**
 * A synthetic row-8 event stream that obeys the whole contract: armed frames (one IRQ each), disarmed frames, a locked frame, and switch_prg_bank calls. `mut` receives the builder state
 * and may edit the events list before it is returned.
 */
function splitStream(mut = (e) => e) {
  const ev = [];
  let clk = 100000, R6 = 0, R7 = 1, R1 = 2;
  const frames = [
    { sm: 1, lock: 0, call: true }, { sm: 1, lock: 0 }, { sm: 0, lock: 0 }, { sm: 1, lock: 1 }, { sm: 1, lock: 0, call: true }, { sm: 0, lock: 0, call: true }
  ];
  ev.push({ t: 'G', f: 1 });
  const w = (addr, val, pc, sl, cy = 10) => { ev.push({ t: 'W', addr, val, pc, sl, cy, clk: (clk += 7) }); };
  for (const f of frames) {
    clk += 29000;
    ev.push({ t: 'N', clk, sl: 241, cy: 5, ipc: 0x9000, lock: f.lock, sm: f.sm, st: 1, vr: 0, vl: 0, r1: 2 });
    if (f.call) {
      const bank = 3;
      ev.push({ t: 'P', a: bank, sl: 100, cy: 0, clk: (clk += 5) });
      ev.push({ t: 'K', v: 1, clk: (clk += 5) });
      w(0x8000, 6, 0x1010, 100); w(0x8001, bank * 2, 0x1012, 100); w(0x8000, 7, 0x1014, 100); w(0x8001, bank * 2 + 1, 0x1016, 100);
      R6 = bank * 2; R7 = bank * 2 + 1;
      ev.push({ t: 'K', v: 0, clk: (clk += 5) });
      ev.push({ t: 'X', sl: 100, cy: 20, clk: (clk += 5) });
    }
    if (f.lock === 0) {
      ev.push({ t: 'S', sl: 245, cy: 10 }, { t: 'U', sl: 245, cy: 12 });
      w(0x8000, 1, 0x2010, 245); w(0x8001, 2, 0x2012, 245); R1 = 2;
      if (f.sm === 1) { w(0xc000, 191, 0x2014, 245); w(0xc001, 191, 0x2016, 245); w(0xe001, 0, 0x2018, 245); }
      else w(0xe000, 0, 0x2014, 245);
      if (f.sm === 1) {
        ev.push({ t: 'I', clk: (clk += 24000), sl: 191, cy: 30, ipc: 0x9000 });
        w(0xe000, 0, 0x2110, 191); w(0x8000, 1, 0x2112, 191); w(0x8001, 10, 0x2114, 191); R1 = 10;
      }
    }
    ev.push({ t: 'Z', f: 1, st: 1, vl: 0, gs: 1, sm: f.sm });
  }
  void R6; void R7; void R1;
  return mut(ev);
}
const splitParsed = (events) => ({ events, frames: 6, error: null, done: true, trials: { planned: 0, consumed: 0, skipped: 0, done: 0 } });
const byId = (items, id) => items.find((i) => i.id === id);
test('judgeSplit: the contract-obeying stream passes every item but r8:coverage (its thresholds are a property of the real stimulus)', () => {
  const items = judgeSplit(splitParsed(splitStream()), CTX);
  const notPass = items.filter((i) => i.status !== 'PASS').map((i) => `${i.id}=${i.status}`);
  assert.deepEqual(notPass, ['r8:coverage=UNMEASURED']);
});
const mutate = (fn) => judgeSplit(splitParsed(splitStream(fn)), CTX);
test('judgeSplit sabotage 1: R7 written with the wrong value fails r8:prg-group and r8:prg-window', () => {
  const items = mutate((ev) => { const w = ev.filter((e) => e.t === 'W' && e.pc === 0x1016); w[0].val += 2; return ev; });
  assert.equal(byId(items, 'r8:prg-group').status, 'FAIL');
  assert.equal(byId(items, 'r8:prg-window').status, 'FAIL');
});
test('judgeSplit sabotage 2: split_arm selecting R0, or writing the font bank into R1, fails the arm grammar and the CHR checks', () => {
  const r0 = mutate((ev) => { ev.find((e) => e.t === 'W' && e.pc === 0x2010).val = 0; return ev; });
  assert.equal(byId(r0, 'r8:arm-grammar').status, 'FAIL');
  assert.equal(byId(r0, 'r8:chr-regs').status, 'FAIL');
  const wr = mutate((ev) => { ev.find((e) => e.t === 'W' && e.pc === 0x2012).val = 10; return ev; });
  assert.equal(byId(wr, 'r8:arm-grammar').status, 'FAIL');
  assert.equal(byId(wr, 'r8:terrain').status, 'FAIL');
});
test('judgeSplit sabotage 3: an IRQ landing between a select and its value ($8000 and $8001 of one pair) fails r8:prg-group (the sei control)', () => {
  const items = mutate((ev) => {
    const k = ev.findIndex((e) => e.t === 'W' && e.pc === 0x1012);
    ev.splice(k, 0, { t: 'I', clk: ev[k].clk - 1, sl: 100, cy: 12, ipc: 0x1011 }, { t: 'W', addr: 0xe000, val: 0, pc: 0x2110, sl: 100, cy: 14, clk: ev[k].clk - 1 }, { t: 'W', addr: 0x8000, val: 1, pc: 0x2112, sl: 100, cy: 20, clk: ev[k].clk - 1 }, { t: 'W', addr: 0x8001, val: 10, pc: 0x2114, sl: 100, cy: 22, clk: ev[k].clk - 1 });
    return ev;
  });
  assert.equal(byId(items, 'r8:prg-group').status, 'FAIL');
});
test('judgeSplit sabotage 4/5: a locked frame that still reaches split_arm_unlocked or writes arm/latch registers fails r8:lock', () => {
  const noLock = mutate((ev) => { const n = ev.findIndex((e) => e.t === 'N' && e.lock === 1); ev.splice(n + 1, 0, { t: 'S', sl: 245, cy: 10 }, { t: 'U', sl: 245, cy: 12 }); return ev; });
  assert.equal(byId(noLock, 'r8:lock').status, 'FAIL');
  const armLocked = mutate((ev) => { const n = ev.findIndex((e) => e.t === 'N' && e.lock === 1); ev.splice(n + 1, 0, { t: 'W', addr: 0xc000, val: 191, pc: 0x2014, sl: 245, cy: 10, clk: ev[n].clk + 9 }, { t: 'W', addr: 0xe001, val: 0, pc: 0x2018, sl: 245, cy: 11, clk: ev[n].clk + 10 }); return ev; });
  assert.equal(byId(armLocked, 'r8:lock').status, 'FAIL');
});
test('judgeSplit sabotage 6: an IRQ in a disarmed frame (the line left enabled) fails r8:irq-count; an IRQ writing extra registers fails r8:irq-grammar', () => {
  const left = mutate((ev) => {
    const n = ev.filter((e) => e.t === 'N').find((e) => e.sm === 0);
    const k = ev.indexOf(n);
    ev.splice(k + 1, 0, { t: 'I', clk: n.clk + 24000, sl: 191, cy: 30, ipc: 0x9000 }, { t: 'W', addr: 0xe000, val: 0, pc: 0x2110, sl: 191, cy: 31, clk: n.clk + 24001 }, { t: 'W', addr: 0x8000, val: 1, pc: 0x2112, sl: 191, cy: 32, clk: n.clk + 24002 }, { t: 'W', addr: 0x8001, val: 10, pc: 0x2114, sl: 191, cy: 33, clk: n.clk + 24003 });
    return ev;
  });
  assert.equal(byId(left, 'r8:irq-count').status, 'FAIL');
  const extra = mutate((ev) => { const k = ev.findIndex((e) => e.t === 'W' && e.pc === 0x2114); ev.splice(k + 1, 0, { t: 'W', addr: 0xe001, val: 0, pc: 0x2116, sl: 191, cy: 34, clk: ev[k].clk + 1 }); return ev; });
  assert.equal(byId(extra, 'r8:irq-grammar').status, 'FAIL');
});
test('judgeSplit: a split whose R1 switch lands a scanline-window early fails r8:terrain; a run with no DONE line fails r8:run', () => {
  const early = mutate((ev) => { ev.find((e) => e.t === 'W' && e.pc === 0x2114).sl = 100; return ev; });
  assert.equal(byId(early, 'r8:terrain').status, 'FAIL');
  const items = judgeSplit({ ...splitParsed(splitStream()), done: false }, CTX);
  assert.equal(byId(items, 'r8:run').status, 'FAIL');
});
test('judgeSplit: the exact mapper-write totals are asserted, not an interval (one extra arm write fails r8:totals)', () => {
  const items = mutate((ev) => { const k = ev.findIndex((e) => e.t === 'W' && e.pc === 0x2018); ev.splice(k + 1, 0, { t: 'W', addr: 0xe001, val: 0, pc: 0x2018, sl: 245, cy: 20, clk: ev[k].clk + 1 }); return ev; });
  assert.equal(byId(items, 'r8:totals').status, 'FAIL');
});
test('parseSplitOutput reads frame lines into events in order', () => {
  const p = parseSplitOutput('F 1 N,100,241,5,36864,0,1,1,0,0,2 S,245,10 U,245,12 W,8000,1,2010,245,10,120 Z,1,1,0,1,1\nTRIALS planned=2 consumed=2 skipped=0 done=2\nDONE ok\n'); // the recorder prints TRIALS, then DONE: the DONE line ends what is judged
  assert.deepEqual(p.events.map((e) => e.t), ['N', 'S', 'U', 'W', 'Z']);
  assert.equal(p.events[3].addr, 0x8000);
  assert.equal(p.done, true);
  assert.deepEqual(p.trials, { planned: 2, consumed: 2, skipped: 0, done: 2 });
});
// ---- the recorder's terminal line (FU1): the judge sees what was printed up to the first DONE, and what it leaves out is counted
const F1 = 'F 1 N,100000,241,5,36864,0,1,1,0,0,2 S,245,10 U,245,12 W,8000,1,2010,245,10,100007 Z,1,1,0,1,1';
const F2 = 'F 2 N,129000,241,5,36864,1,1,1,0,0,2 W,8001,2,2012,245,12,129010 Z,2,1,0,1,1';
const FLATE = 'F 3 N,158000,241,5,36864,1,1,1,0,0,2 W,e000,0,2014,245,14,158010 Z,3,1,0,1,1'; // a frame that ended after the recorder had already said DONE
const T2 = 'TRIALS planned=2 consumed=2 skipped=0 done=2';
test('parseSplitOutput: the F lines after the first DONE are not judged but are counted (post-DONE callbacks must not move the judge, the cut must not be silent)', () => {
  const clean = [F1, F2, T2, 'DONE frames=2'].join('\n') + '\n';
  const late = [F1, F2, T2, 'DONE frames=2', FLATE, T2.replace('consumed=2', 'consumed=3'), 'DONE frames=3'].join('\n') + '\n';
  const p = parseSplitOutput(late), q = parseSplitOutput(clean);
  assert.equal(p.frames, 2);
  assert.deepEqual(p.events, q.events, 'the events are the clean stream\'s: the late frame\'s N and W are gone');
  assert.deepEqual(p.trials, { planned: 2, consumed: 2, skipped: 0, done: 2 }, 'the first TRIALS line, not the late one');
  assert.equal(p.postDone, 1, 'the dropped F line is observable');
  assert.equal(p.postDoneLines, 2, 'and so are the late TRIALS and DONE lines');
  assert.equal(q.postDone, 0); assert.equal(q.postDoneLines, 0);
  assert.deepEqual(judgeSplit(p, CTX), judgeSplit(q, CTX), 'the judge cannot tell the two streams apart');
});
test('parseSplitOutput: an ERROR before DONE is the run\'s error; an ERROR after it is counted and not judged', () => {
  const before = parseSplitOutput([F1, 'ERROR lifecycle: the battle never ended', 'DONE frames=1'].join('\n') + '\n');
  assert.equal(before.error, 'lifecycle: the battle never ended');
  assert.equal(byId(judgeSplit(before, CTX), 'r8:run').status, 'FAIL');
  assert.match(byId(judgeSplit(before, CTX), 'r8:run').detail, /recorder error: lifecycle: the battle never ended/);
  const after = parseSplitOutput([F1, F2, T2, 'DONE frames=2', 'ERROR timed out in stage done trial 3'].join('\n') + '\n');
  assert.equal(after.error, null, 'a post-DONE ERROR is not the run\'s error (Mesen\'s exit status still reports a failed run: run:exit)');
  assert.equal(after.postDoneLines, 1);
});
test('parseSplitOutput: a stream with no DONE line is parsed whole, as before (a cut with no terminal line cuts nothing)', () => {
  const p = parseSplitOutput([F1, F2, 'ERROR never reached ST_GAMEPLAY within 400 frames'].join('\n') + '\n');
  assert.equal(p.frames, 2); assert.equal(p.events.length, 8); assert.equal(p.done, false);
  assert.equal(p.error, 'never reached ST_GAMEPLAY within 400 frames'); assert.equal(p.trials, null);
  assert.equal(p.postDone, 0); assert.equal(p.postDoneLines, 0);
  const empty = parseSplitOutput('');
  assert.equal(empty.frames, 0); assert.equal(empty.done, false);
});
test('parseSplitOutput: a lifecycle session is two scripts, each parsed whole from its own stdout (part B is not post-DONE of part A); the retained-raw blob handed over unsplit is visible as post-DONE', () => {
  const partA = [F1, 'F 2 L,save,2,2,0,0,56,0,0,120,120 Z,2,1,0,1,1', 'TRIALS planned=2 consumed=2 skipped=0 done=2', 'DONE frames=2 sram=128', FLATE].join('\n') + '\n';
  const partB = ['F 1 N,100000,241,5,36864,0,0,0,0,0,2 L,cont-out,1,2,0,0,56,0,0,120,120 Z,1,1,0,0,0', 'TRIALS planned=0 consumed=0 skipped=0 done=0', 'DONE frames=1 sram=0'].join('\n') + '\n';
  const a = parseSplitOutput(partA), b = parseSplitOutput(partB);
  assert.equal(a.frames, 2); assert.equal(a.sram, 128); assert.equal(a.postDone, 1);
  assert.deepEqual(a.events.map((e) => e.t), ['N', 'S', 'U', 'W', 'Z', 'L', 'Z'], 'part A is parsed completely up to its DONE; the late frame (N, W, Z) is not in it');
  assert.equal(b.frames, 1); assert.equal(b.done, true); assert.equal(b.postDone, 0);
  assert.deepEqual(b.events.map((e) => e.t), ['N', 'L', 'Z'], 'part B is parsed completely');
  // the retained blob (run_s1c.mjs) is `#### part main / lc-a / lc-b` markers around the three stdouts; parsed as ONE stream, part B would be post-DONE of part A and silently absent unless counted
  const blob = `#### part lc-a\n${partA}\n#### part lc-b\n${partB}`;
  const whole = parseSplitOutput(blob);
  assert.equal(whole.frames, a.frames, 'only part A is judged');
  assert.equal(whole.postDone, 2, 'part A\'s late frame and part B\'s whole frame are counted as dropped, so the misuse shows');
});
test('the split recorder (sw_split_ring.lua.template) ends once: emu.stop is called only from halt(), every callback it registers goes through guarded(), and both DONE sites and fail() halt', () => {
  const lua = fs.readFileSync(path.join(ROOT, 'test/lua/sw_split_ring.lua.template'), 'utf8');
  const stops = [...lua.matchAll(/emu\.stop\(/g)].length;
  assert.equal(stops, 1, 'emu.stop appears once (inside halt): a second stop site would end the run without marking it finished');
  assert.match(lua, /local function halt\(code\) finished = true; stage = "done"; emu\.stop\(code\) end/);
  const regs = [...lua.matchAll(/emu\.add(?:Event|Memory)Callback\((.*)/g)].map((m) => m[1]);
  assert.equal(regs.length, 14, 'the 14 registrations: sram, $2001, endFrame, inputPolled, 8 exec, split_lock write, the mapper-register loop');
  for (const r of regs) assert.ok(r.startsWith('guarded('), `an unguarded callback keeps running after DONE: emu.addXCallback(${r.slice(0, 40)}`);
  assert.equal([...lua.matchAll(/\bhalt\(0\)/g)].length, 2, 'both DONE sites (plain onFrame, lifecycle script) halt');
  assert.match(lua, /local function fail\(code, msg\) say\("ERROR " \.\. msg\); halt\(code\) end/);
  assert.ok(!/say\("ERROR " \.\. tostring\(err\)\)/.test(lua), 'the lifecycle coroutine\'s error goes through fail() too');
});
test('the split sabotage edits still apply to the stock engine source exactly once, and the harness PSB replaces the stock block exactly once', () => {
  for (const [id, s] of Object.entries(SPLIT_SABOTAGES)) if (s.edit) { const src = fs.readFileSync(path.join(ROOT, 'engine', s.file ?? 'split.asm'), 'utf8'); assert.notEqual(s.edit(src), src, `${id} changed nothing`); }
  const banks = fs.readFileSync(path.join(ROOT, 'engine/banks.asm'), 'utf8');
  assert.equal(banks.split('switch_prg_bank:\n  asl a').length - 1, 1);
  assert.ok(harnessPsb({}).includes('hd_psb_end') && !harnessPsb({ sei: false }).includes('  sei\n'));
});

// ---------------------------------------------------------------- the controls table
test('controls: every control is declared for both rings with a mustFail set (or a stated pass reason), a row 5|6|8 and a buildable runner flag', () => {
  for (const id of Object.keys(CONTROLS)) {
    assert.ok([5, 6, 8].includes(CONTROLS[id].row), id);
    for (const ring of [1, 2]) {
      const d = declaredFor(id, ring);
      assert.ok((d.outcome === 'caught' && d.mustFail.length > 0) || (d.outcome === 'pass' && d.why) || (d.outcome === 'na' && d.why), `${id} ring ${ring}`);
      assert.equal(d.outcome === 'na', !controlHasForm(id, ring), `${id} ring ${ring}: a declared N/A is exactly a control with no form on that ring`);
    }
    const f = controlFlags(id);
    assert.equal([f.sabotage, f.mutation, f.breakMode, f.split].filter((x) => x).length, 1, `${id}: exactly one runner flag`);
    assert.ok(controlBuilds(id).length >= 1);
  }
  assert.deepEqual(controlIds(8).length, 10);
});
test('controls: each row-8 control declares exactly the items its sabotage declares, and the six plan sabotages are all present', () => {
  for (const id of controlIds(8)) {
    const arg = CONTROLS[id].arg;
    assert.deepEqual([...declaredFor(id, 1).mustFail].sort(), [...SPLIT_SABOTAGES[arg].declared].sort(), id);
  }
  // plan 2.7's six: R6/R7 corrupted, R0 / wrong R1, sei removed, split_lock removed, split armed during a locked frame, split IRQ left armed
  for (const k of ['prg-r7-wrong', 'prg-transient', 'split-r0', 'split-wrong-r1', 'no-sei', 'no-lock', 'arm-while-locked', 'irq-left-armed']) assert.ok(k in SPLIT_SABOTAGES, k);
});
test('controls: each patch control names a real sabotage patch and each horizontal-only/vertical-only declaration flips with the ring', () => {
  // a patch control's file exists exactly on the rings its sabotage has a form for (SABOTAGE_RINGS), in that ring's directory
  for (const id of Object.keys(CONTROLS)) if (CONTROLS[id].kind === 'patch') for (const ring of [1, 2]) assert.equal(fs.existsSync(path.join(HERE, 'sabotage', ring === 1 ? 'vertical' : '', `${CONTROLS[id].arg}.patch`)), sabotageRings(CONTROLS[id].arg).includes(ring), `${id} ring ${ring}`);
  assert.equal(declaredFor('close-expect-87', 1).outcome, 'pass');
  assert.equal(declaredFor('close-expect-87', 2).outcome, 'caught');
  assert.equal(declaredFor('nmi-wrap-row-32', 1).outcome, 'na');
  assert.equal(controlHasForm('nmi-wrap-row-32', 1), false);
  assert.equal(declaredFor('nmi-wrap-row-32', 2).outcome, 'caught');
  // the mirror-image equivalent mutants: caught on the vertical ring, control-level N/A (no form) on the horizontal one
  for (const id of ['nmi-strip-len-30-vertical', 'nmi-wrap-col-30']) {
    assert.equal(declaredFor(id, 1).outcome, 'caught', id);
    assert.equal(declaredFor(id, 2).outcome, 'na', id);
    assert.match(declaredFor(id, 2).why, /equivalent mutant/, id);
    assert.equal(controlHasForm(id, 1), true, id);
    assert.equal(controlHasForm(id, 2), false, id);
  }
});
test('the matrix names every control on every cell it is declared for, each beside its matching positive', () => {
  const names = new Set(jobs('/p', '/l').map((j) => j.name));
  for (const id of Object.keys(CONTROLS)) for (const c of CELL_IDS) {
    if (CONTROLS[id].row === 8 && !MMC3_CELLS.includes(c)) continue;
    for (const [gt, pl] of controlBuilds(id)) {
      assert.equal(names.has(controlLabel(id, c, gt, pl)), controlHasForm(id, c.endsWith('-V') ? 1 : 2), `${id} ${c} ${gt} ${pl}: a job exists exactly when the control has a form on the cell's ring`);
      if (!controlHasForm(id, c.endsWith('-V') ? 1 : 2)) continue;
      assert.ok(names.has(positiveLabel(CONTROLS[id].row, c, gt, pl)), `${id} ${c} ${gt} ${pl}: its matching positive has no job`);
    }
  }
});
// The scheduling invariant behind the C3 matrix's three UNMEASURED cells: the job list must never ask a runner for a sabotage form its cell's ring does not have (the runner dies "no ring-1 form").
// Generic over EVERY job: each job's argv names its sabotage directly (--sabotage=) or through a control (--control= -> a patch control's sabotage), and its cells by --cell=, else --ring=, else all six.
// run_identity.mjs is the one runner that takes a sabotage across all cells by design: it witnesses a no-form cell as N/A itself (run_identity.mjs, "no form of this sabotage exists for this ring").
test('no scheduled job names a sabotage absent from its cell\'s ring (every job kind of ringjobs.mjs)', () => {
  const arg = (j, n) => j.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const WITNESSES_ITSELF = ['test/lua/ring_gate/run_identity.mjs'];
  const kinds = new Set();
  let checked = 0;
  for (const j of jobs('/p', '/l')) {
    const ctl = arg(j, 'control');
    const sab = arg(j, 'sabotage') ?? (ctl !== undefined && CONTROLS[ctl]?.kind === 'patch' ? CONTROLS[ctl].arg : undefined);
    if (sab === undefined || WITNESSES_ITSELF.includes(j.argv[0])) continue;
    const cell = arg(j, 'cell'), ring = arg(j, 'ring');
    const scope = CELLS.filter((c) => (cell === undefined || c.id === cell) && (ring === undefined || c.ring === Number(ring)));
    assert.ok(scope.length > 0, `${j.name}: selects no cell`);
    for (const c of scope) assert.ok(sabotageRings(sab).includes(c.ring), `${j.name}: sabotage ${sab} has no ring-${c.ring} form (${c.id})`);
    kinds.add(j.argv[0]); checked++;
  }
  // not vacuous: every runner that takes a sabotage is covered, and the horizontal wrap-row-32 control is still scheduled where the form exists
  assert.ok(checked >= 70, `only ${checked} sabotage-carrying jobs checked`);
  for (const k of ['run_oracle', 'run_campaign', 'run_s1b', 'run_s1c']) assert.ok([...kinds].some((f) => f.endsWith(`${k}.mjs`)), `${k} carries no checked job`);
  const names = jobs('/p', '/l').map((j) => j.name);
  assert.ok(names.includes('s1c-r5-ctl-nmi-wrap-row-32-MMC3-H-action-resident'));
  for (const id of ['nmi-strip-len-30-vertical', 'nmi-wrap-col-30']) {
    assert.ok(names.includes(`s1c-r5-ctl-${id}-MMC3-V-action-resident`), id);
    for (const c of ['MMC1-H', 'MMC3-H', 'U512-H']) assert.ok(!names.includes(`s1c-r5-ctl-${id}-${c}-action-resident`), `${id} ${c}`);
  }
  for (const c of ['MMC1-V', 'MMC3-V', 'U512-V']) assert.ok(!names.includes(`s1c-r5-ctl-nmi-wrap-row-32-${c}-action-resident`), c);
});
test('the harness fingerprint covers every S1c module and template, and every script the matrix executes', () => {
  const fp = harnessFingerprint();
  for (const must of ['run_s1c.mjs', 's1ccontrols.mjs', 'ringnmi.mjs', 'ringclose.mjs', 'ringsplit.mjs', 'ringsections.mjs', 's1c_unit.mjs', 's1c_gate.mjs', 's1c_noflag.mjs', 's1caudit.mjs', 'ringwcet.mjs']) assert.ok(`test/lua/ring_gate/${must}` in fp, must);
  for (const must of ['test/lua/sw_nmi_ring.lua.template', 'test/lua/sw_close_deadline.lua.template', 'test/lua/sw_split_ring.lua.template', 'test/lua/build_sw_nmi_roms.mjs', 'test/lua/build_sw_close_deadline_roms.mjs']) assert.ok(must in fp, must);
  assert.deepEqual(fingerprintGaps(fp, matrixScripts()), []);
});

// ---------------------------------------------------------------- the Mesen chain audit with a status allow-list
const inv = (status) => ({ n: 1, spec: 'row8-split', purpose: 'row8-split', pid: 7, status, isolated: true, settingsSha256: 'a', exe: '/m', loadedFiles: ['/x'] });
test('auditChain: a status outside the allowed set is a problem (a timed-out recorder is never a pass), inside it is not', () => {
  const want = [{ spec: 'row8-split', purpose: 'row8-split' }];
  assert.equal(auditChain([inv(0)], want).length, 0);
  assert.match(auditChain([inv(5)], want)[0], /exited with status 5/);
  assert.equal(auditChain([inv(5)], want, { statusOk: [0, 5, 7, 8, 9] }).length, 0);
  assert.match(auditChain([inv(99)], want, { statusOk: [0, 5, 7, 8, 9] })[0], /status 99/);
});

// ---------------------------------------------------------------- the provenance audit's S1c rules
test('provenance: an s1c control stamp whose matching positive is absent from the certificate is a problem', () => {
  const dir = tmp();
  try {
    const st = { schema: 'ring-prov-3', kind: 's1c-run', label: controlLabel('split-r0', 'MMC3-V', 'action', 'resident'), status: 'built', row: 8, cell: 'MMC3-V', gameType: 'action', placement: 'resident', control: 'split-r0',
      matchingPositive: positiveLabel(8, 'MMC3-V', 'action', 'resident'), verdictOk: true, counts: { PASS: 3, FAIL: 2 }, results: [] };
    fs.writeFileSync(path.join(dir, `${st.label}.json`), JSON.stringify(st));
    const r = auditProvenance(dir, null);
    assert.ok(r.problems.some((p) => /its matching positive .* is not in this certificate/.test(p)), r.problems.join('\n'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the gate table
const rec = (items, extra = {}) => ({ sabotage: null, fault: null, verdictOk: true, items, ...extra });
test('gate: option A\'s uncertified items print as UNCERTIFIED, never PASS; a FAIL item fails; no record is UNMEASURED', () => {
  const items = [{ id: 'run:walk', emu: 'mesen', status: 'PASS' }, { id: 'gate:C1', emu: 'mesen', status: 'PASS' }, { id: 'bound:C1', emu: 'mesen', status: 'UNCERTIFIED' }, { id: 'bound:certification', emu: 'mesen', status: 'UNCERTIFIED' }, { id: 'overruns:C1', emu: 'mesen', status: 'PASS' }];
  const s = s1bRowStatus(rec(items), 4, 'mesen');
  assert.equal(s.status, 'UNCERTIFIED');
  assert.match(s.note, /bound:certification/);
  assert.equal(s1bRowStatus(rec([...items, { id: 'gate:C2', emu: 'mesen', status: 'FAIL' }]), 4, 'mesen').status, 'FAIL');
  assert.equal(s1bRowStatus(null, 4, 'mesen').status, 'UNMEASURED');
  assert.equal(s1bRowStatus(rec(items), 4, 'jsnes').status, 'N/A');
  assert.equal(s1bRowStatus(rec(items, { verdictOk: false }), 7, 'mesen').status, 'UNMEASURED', 'a record with no row-7 item at all is not a pass of row 7');
  const ran = [{ id: 'run:seam-walk', emu: 'mesen', status: 'PASS' }, { id: 'run:seam-move', emu: 'mesen', status: 'PASS' }, { id: 'seam:walk', emu: 'jsnes', status: 'PASS' }];
  assert.equal(s1bRowStatus(rec(ran), 7, 'mesen').status, 'N/A', 'Mesen ran the seam specs but decodes nothing: N/A with its stated proof, flagged for a ruling');
  const row7 = s1bRowStatus(rec(ran), 7, 'mesen').note;
  assert.match(row7, /accepted as N\/A by S1c reviews 1 and 3; jsnes supplies the decoded-seam evidence and no Mesen-side decode is claimed/);
  assert.doesNotMatch(row7, /NEEDS A RULING/, 'the verdict is settled (phase3b-s1c-cert-review.md): no pending-ruling wording');
  assert.equal(s1bRowStatus(rec([ran[0], ran[2]]), 7, 'mesen').status, 'UNMEASURED', 'a Mesen seam spec that did not run is not N/A');
  assert.equal(s1bRowStatus(rec(ran), 7, 'jsnes').status, 'PASS');
});
test('gate: an empty certificate is every cell UNMEASURED and the gate FAILS (never prints a pass for what it did not read)', () => {
  const dir = tmp();
  try {
    const g = buildGate({ prov: dir, logs: dir, construct: true });
    const r = render(g, { prov: dir, logs: dir });
    assert.equal(r.fail, true);
    assert.match(r.text, /GATE FAIL/);
    assert.ok(g.entries.every((e) => e.mesen.status === 'UNMEASURED' || e.mesen.status === 'N/A'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


// ================================================================ round 2
// ---------------------------------------------------------------- finding 5: a row's own N/A is never upgraded by the common validity items
const common = (emu, status = 'PASS') => ['run:walk', 'placement:resident', 'arm:geometry'].map((id) => ({ id, emu, status }));
const na4 = { id: 'gate', emu: 'jsnes', status: 'N/A', detail: 'G is a Mesen cycle measurement' };
test('gate finding 5: a row whose own item is N/A stays N/A beside PASSing common validity items', () => {
  const s = s1bRowStatus(rec([na4, ...common('jsnes')]), 4, 'jsnes');
  assert.equal(s.status, 'N/A');
  assert.match(s.note, /Mesen cycle measurement/);
});
test('gate finding 5: a row whose own item is N/A still FAILS beside a failing common validity item, and is UNMEASURED beside an unmeasured one', () => {
  assert.equal(s1bRowStatus(rec([na4, ...common('jsnes'), { id: 'run:edge', emu: 'jsnes', status: 'FAIL' }]), 4, 'jsnes').status, 'FAIL');
  assert.equal(s1bRowStatus(rec([na4, ...common('jsnes'), { id: 'arm:late', emu: 'jsnes', status: 'UNMEASURED' }]), 4, 'jsnes').status, 'UNMEASURED');
  // 'both'/'-' items count on every emulator
  assert.equal(s1bRowStatus(rec([na4, { id: 'placement:x', emu: 'both', status: 'FAIL' }]), 4, 'jsnes').status, 'FAIL');
});
test('gate finding 5: a row with real own items is the worst of them and the common items (unchanged), UNCERTIFIED still printed as such', () => {
  const own = { id: 'gate:C1', emu: 'mesen', status: 'PASS' };
  assert.equal(s1bRowStatus(rec([own, ...common('mesen')]), 4, 'mesen').status, 'PASS');
  assert.equal(s1bRowStatus(rec([own, ...common('mesen'), { id: 'run:x', emu: 'mesen', status: 'FAIL' }]), 4, 'mesen').status, 'FAIL');
  assert.equal(s1bRowStatus(rec([own, { id: 'bound:C1', emu: 'mesen', status: 'UNCERTIFIED' }, ...common('mesen')]), 4, 'mesen').status, 'UNCERTIFIED');
});
test('gate finding 5: the row-7 Mesen exception propagates a common FAIL/UNMEASURED instead of printing N/A', () => {
  const ran = [{ id: 'run:seam-walk', emu: 'mesen', status: 'PASS' }, { id: 'run:seam-move', emu: 'mesen', status: 'PASS' }];
  assert.equal(s1bRowStatus(rec([...ran, ...common('mesen')]), 7, 'mesen').status, 'N/A');
  assert.equal(s1bRowStatus(rec([...ran, ...common('mesen'), { id: 'placement:banked', emu: 'mesen', status: 'FAIL' }]), 7, 'mesen').status, 'FAIL');
  assert.equal(s1bRowStatus(rec([...ran, ...common('mesen'), { id: 'arm:late', emu: 'mesen', status: 'UNMEASURED' }]), 7, 'mesen').status, 'UNMEASURED');
  assert.equal(s1bRowStatus(rec([ran[0], ...common('mesen')]), 7, 'mesen').status, 'UNMEASURED');
});

// ---------------------------------------------------------------- finding 1: the result is READ and every claim recomputed from its items
const itemsOf = (row, status = () => 'PASS', gt = 'action') => requiredItems(row, gt).map((id) => ({ id, status: status(id), detail: `${id} detail` }));
const tallyOf = (items) => items.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] ?? 0) + 1 }), {});
const H64 = 'a'.repeat(64), H64b = 'b'.repeat(64);
/** A consistent { result, stamp, label } for a row/cell/build (and control): the matching positive of validateS1cResult; each test then corrupts ONE thing. */
function s1cPair({ row = 5, cell = 'MMC3-V', gt = 'action', pl = 'resident', control = null, items = null } = {}) {
  const label = control ? controlLabel(control, cell, gt, pl) : positiveLabel(row, cell, gt, pl);
  const declared = control ? declaredFor(control, cell.endsWith('-V') ? 1 : 2) : { outcome: 'pass-all' };
  const its = items ?? (declared.outcome === 'caught' ? itemsOf(row, (id) => (declared.mustFail.includes(id) ? 'FAIL' : 'PASS'), gt) : itemsOf(row, undefined, gt));
  const failed = its.filter((i) => i.status === 'FAIL').map((i) => i.id);
  const counts = tallyOf(its);
  const mesenStatus = control ? 5 : 0;
  const verdictOk = recomputeVerdict(its, declared).ok;
  const result = { label, row, cell, gameType: gt, placement: pl, control, declared, verdictOk, items: its, counts, failed, mesenStatus, romSha256: H64, luaSha256: H64b };
  const stamp = { label, row, cell, gameType: gt, placement: pl, control, declared, verdictOk, counts, failed, mesenStatus, romSha256: H64, luaSha256: H64b, results: [{ scene: label, emu: 'mesen', counts, verdictOk, emulatorStamp: null }] };
  return { label, result, stamp };
}
const problems = (p) => validateS1cResult(p.result, p.stamp, p.label);
test('s1caudit: decodeLabel names only runs the matrix declares', () => {
  assert.deepEqual(decodeLabel('s1c-r5-MMC3-V-action-resident'), { row: 5, cell: 'MMC3-V', gt: 'action', placement: 'resident', control: null, ring: 1 });
  assert.equal(decodeLabel('s1c-r8-MMC1-V-action-resident'), null, 'row 8 is MMC3-only');
  assert.equal(decodeLabel('s1c-r5-MMC3-V-action-banked'), null, 'action banked does not exist');
  assert.equal(decodeLabel('s1c-r5-ctl-no-such-MMC3-V-action-resident'), null);
  assert.equal(decodeLabel('s1c-r6-ctl-nmi-chunk4-MMC3-V-action-resident'), null, 'a control belongs to its own row');
  assert.equal(decodeLabel('s1c-r5-ctl-nmi-arm-len30-MMC3-V-rpg-banked'), null, 'a control only on the builds it is declared for');
});
test('s1caudit: a consistent positive and a consistent caught control validate clean, on every row', () => {
  for (const row of [5, 6, 8]) assert.deepEqual(problems(s1cPair({ row })), [], `row ${row}`);
  for (const [control, row] of [['nmi-arm-len30', 5], ['close-no-flash', 6], ['split-prg-transient', 8], ['split-r0', 8], ['nmi-cover-drop-start', 5]]) assert.deepEqual(problems(s1cPair({ row, control })), [], control);
});
test('s1caudit: a zero-item, missing, or unreadable result is rejected, even when the stamp says it passed', () => {
  const p = s1cPair();
  assert.match(validateS1cResult(null, p.stamp, p.label)[0], /missing or unreadable/);
  assert.ok(problems({ ...p, result: { ...p.result, items: [], counts: {}, failed: [] } }).some((m) => /zero-item|no items/.test(m)));
  assert.ok(problems({ ...p, result: { ...p.result, items: undefined } }).some((m) => /no items/.test(m)));
});
test('s1caudit: a missing, duplicate, extra or unknown-status item is rejected', () => {
  const p = s1cPair();
  const mut = (f) => { const items = f(p.result.items.map((i) => ({ ...i }))); return problems({ ...p, result: { ...p.result, items, counts: tallyOf(items) }, stamp: { ...p.stamp, counts: tallyOf(items) } }); };
  assert.ok(mut((it) => it.filter((i) => i.id !== 'deadline:strip')).some((m) => /required item\(s\) absent: deadline:strip/.test(m)));
  assert.ok(mut((it) => it.filter((i) => i.id !== 'cover:domain')).some((m) => /absent: cover:domain/.test(m)));
  assert.ok(mut((it) => [...it, { ...it[0] }]).some((m) => /duplicate item/.test(m)));
  assert.ok(mut((it) => [...it, { id: 'r8:lock', status: 'PASS', detail: 'x' }]).some((m) => /outside row 5/.test(m)));
  assert.ok(mut((it) => it.map((i, k) => (k === 2 ? { ...i, status: 'MAYBE' } : i))).some((m) => /illegal status/.test(m)));
});
test('s1caudit: a stamp or result that contradicts the items (counts, failed ids, verdict) is rejected', () => {
  const p = s1cPair();
  const failItems = p.result.items.map((i) => (i.id === 'deadline:mixed' ? { ...i, status: 'FAIL' } : { ...i }));
  // the items now FAIL one, but the result and the stamp both still claim an all-pass verdict
  const lie = problems({ ...p, result: { ...p.result, items: failItems } });
  assert.ok(lie.some((m) => /counts differ/.test(m)) && lie.some((m) => /failed ids differ/.test(m)) && lie.some((m) => /do not meet the declaration/.test(m)) && lie.some((m) => /verdictOk contradicts/.test(m)), lie.join('\n'));
  // a stamp whose counts say more passes than the result holds
  assert.ok(problems({ ...p, stamp: { ...p.stamp, counts: { PASS: 99 } } }).some((m) => /counts differ/.test(m)));
  assert.ok(problems({ ...p, stamp: { ...p.stamp, failed: ['deadline:strip'] } }).some((m) => /failed ids differ/.test(m)));
  assert.ok(problems({ ...p, stamp: { ...p.stamp, verdictOk: false } }).some((m) => /verdictOk contradicts/.test(m)));
  assert.ok(problems({ ...p, result: { ...p.result, mesenStatus: 7 } }).some((m) => /Mesen exit differs|may end with/.test(m)));
});
test('s1caudit: a result for another run (cell, game type, placement, control, row, label) or a stale declaration is rejected', () => {
  const p = s1cPair();
  for (const [k, v] of [['cell', 'MMC1-V'], ['gameType', 'rpg'], ['placement', 'banked'], ['control', 'nmi-chunk4'], ['row', 6]]) {
    assert.ok(problems({ ...p, result: { ...p.result, [k]: v } }).some((m) => /identity/.test(m)), k);
    assert.ok(problems({ ...p, stamp: { ...p.stamp, [k]: v } }).some((m) => /identity/.test(m)), `stamp ${k}`);
  }
  assert.ok(problems({ ...p, result: { ...p.result, label: 's1c-r5-MMC1-V-action-resident' } }).some((m) => /label/.test(m)));
  assert.ok(problems({ ...p, result: { ...p.result, declared: { outcome: 'pass' } } }).some((m) => /declared outcome/.test(m)));
  assert.ok(problems({ ...p, result: { ...p.result, romSha256: H64b } }).some((m) => /ROM and Lua/.test(m)));
});
test('s1caudit: a caught control whose named failure is ABSENT is rejected despite a true stamped verdict', () => {
  const p = s1cPair({ row: 8, control: 'split-prg-transient' });
  // r8:prg-window is declared; make it PASS while every counter, the failed list and the verdict still claim a catch
  const items = p.result.items.map((i) => (i.id === 'r8:prg-window' ? { ...i, status: 'PASS' } : i));
  const bad = problems({ ...p, result: { ...p.result, items } });
  assert.ok(bad.some((m) => /did not FAIL/.test(m)), bad.join('\n'));
  // ... even when the stamp is made internally consistent with that lie
  const fake = { ...p, result: { ...p.result, items, counts: tallyOf(items), failed: items.filter((i) => i.status === 'FAIL').map((i) => i.id), verdictOk: true }, stamp: { ...p.stamp, counts: tallyOf(items), failed: items.filter((i) => i.status === 'FAIL').map((i) => i.id), verdictOk: true } };
  assert.ok(problems(fake).some((m) => /did not FAIL|do not meet the declaration/.test(m)));
});
test('s1caudit: a control caught only because its run was unsound (a timeout, an incomplete workload) is rejected', () => {
  for (const [row, control, unsound] of [[5, 'nmi-arm-len30', 'run:complete'], [8, 'split-r0', 'r8:run'], [8, 'split-r0', 'run:exit'], [6, 'close-no-flash', 'run:operational']]) {
    const p = s1cPair({ row, control });
    const items = p.result.items.map((i) => (i.id === unsound ? { ...i, status: 'FAIL' } : i));
    const q = { ...p, result: { ...p.result, items, counts: tallyOf(items), failed: items.filter((i) => i.status === 'FAIL').map((i) => i.id) }, stamp: { ...p.stamp, counts: tallyOf(items), failed: items.filter((i) => i.status === 'FAIL').map((i) => i.id) } };
    assert.ok(problems(q).some((m) => /unsound/.test(m)), `${control} ${unsound}: ${problems(q).join(' | ')}`);
  }
});
test('s1caudit: a positive with a UNMEASURED or FAIL item is rejected, a declared-pass control with one too', () => {
  const p = s1cPair({ row: 8 });
  const items = p.result.items.map((i) => (i.id === 'r8:terrain' ? { ...i, status: 'UNMEASURED' } : i));
  assert.ok(problems({ ...p, result: { ...p.result, items, counts: tallyOf(items) }, stamp: { ...p.stamp, counts: tallyOf(items) } }).some((m) => /do not meet the declaration/.test(m)));
  const horizontal = s1cPair({ row: 6, control: 'close-expect-87', cell: 'MMC1-V' }); // declared PASS on a vertical ring
  assert.deepEqual(problems(horizontal), []);
  const hi = horizontal.result.items.map((i) => (i.id === 'close:queue' ? { ...i, status: 'FAIL' } : i));
  assert.ok(problems({ ...horizontal, result: { ...horizontal.result, items: hi, counts: tallyOf(hi), failed: ['close:queue'] }, stamp: { ...horizontal.stamp, counts: tallyOf(hi), failed: ['close:queue'] } }).some((m) => /do not meet the declaration/.test(m)));
});

/** A complete certificate directory pair holding the consistent pairs `pairs`: every stamp field auditStamp requires, the result, log and retained raw output. */
function certDir(pairs, { raw = true } = {}) {
  const prov = tmp(), logs = tmp();
  const fp = harnessFingerprint();
  for (const p of pairs) {
    const rowName = { 5: 'nmi', 6: 'close', 8: 'split' }[p.result.row];
    const gz = zlib.gzipSync(Buffer.from(`raw ${p.label}`));
    const plan = { row: p.result.row, cell: p.result.cell, gameType: p.result.gameType, placement: p.result.placement, control: p.result.control, purpose: `row${p.result.row}-${rowName}`, romSha256: H64, luaSha256: H64b, ...(p.result.row === 8 && p.result.gameType === 'rpg' ? { lifecycle: { romSha256: H64b, luaSha256: H64, purposes: ['row8-split-lc-a', 'row8-split-lc-b'] } } : {}) };
    const stamp = {
      schema: 'ring-prov-3', kind: 's1c-run', status: 'built', ...p.stamp, slice: 'S1c', matchingPositive: p.result.control ? positiveLabel(p.result.row, p.result.cell, p.result.gameType, p.result.placement) : null,
      attempt: { startedAt: 'x' }, harness: fp, head: 'h', ...provenanceFor(p.result.cell.endsWith('-V') ? 1 : 2, false, p.result.control && controlFlags(p.result.control).sabotage ? [controlFlags(p.result.control).sabotage] : []), nesasm: { sha256: H64 }, host: { kernel: 'k' },
      projectSha256: H64, plan: { ...plan, sha256: sha256(JSON.stringify(plan)) }, build: { streamRing: p.result.cell.endsWith('-V') ? 1 : 2, placement: { requested: p.result.placement, assembled: p.result.placement === 'banked' ? 'switchable' : 'resident' } },
      userSavesUntouched: true,
      // a row-8 RPG run is a session: the plain run plus the lifecycle ROM's part A and part B (S5 C3)
      mesenChain: [plan.purpose, ...(p.result.row === 8 && p.result.gameType === 'rpg' ? ['row8-split-lc-a', 'row8-split-lc-b'] : [])].map((purpose, i) => ({ n: i + 1, spec: purpose, purpose, pid: 7 + i, status: p.result.mesenStatus, isolated: true, settingsSha256: 'a', exe: '/m', loadedFiles: ['/x'] })),

      emulators: { mesen: {}, jsnes: { na: 'not measured: this slice has no jsnes timing recorder; Mesen is the authoritative measurement' } },
      results: p.stamp.results,
      links: { result: `/historical/elsewhere/${p.label}.json`, log: `/historical/elsewhere/${p.label}.log`, raw: `/historical/elsewhere/${p.label}.raw.gz` },
      retained: { raw: raw ? { sha256: sha256(gz), bytes: gz.length } : undefined }
    };
    fs.writeFileSync(path.join(prov, `${p.label}.json`), JSON.stringify(stamp));
    fs.writeFileSync(path.join(logs, `${p.label}.json`), JSON.stringify(p.result));
    fs.writeFileSync(path.join(logs, `${p.label}.log`), 'log');
    if (raw) fs.writeFileSync(path.join(logs, `${p.label}.raw.gz`), gz);
  }
  return { prov, logs, done: () => { fs.rmSync(prov, { recursive: true, force: true }); fs.rmSync(logs, { recursive: true, force: true }); } };
}
test('provenance finding 1: files resolve from the directory arguments only (the stamps\' historical absolute paths are never read), and a clean certificate audits clean', () => {
  const c = certDir([s1cPair({ row: 8 }), s1cPair({ row: 8, control: 'split-prg-transient' })]);
  try {
    const r = auditProvenance(c.prov, c.logs, { construct: true });
    assert.deepEqual(r.problems, []);
    assert.equal(r.mode, 'construct');
  } finally { c.done(); }
});
test('provenance finding 1: a missing result, a zero-item matching positive or a tampered result is a problem; a control beside an unvalidated positive is rejected', () => {
  const pos = s1cPair({ row: 8 }), ctl = s1cPair({ row: 8, control: 'split-prg-transient' });
  let c = certDir([pos, ctl]);
  try {
    fs.rmSync(path.join(c.logs, `${pos.label}.json`));
    const r = auditProvenance(c.prov, c.logs, { construct: true });
    assert.ok(r.problems.some((m) => m.includes(pos.label) && /links.result .* missing/.test(m)), r.problems.join('\n'));
    assert.ok(r.problems.some((m) => m.includes(ctl.label) && /matching positive .* is not valid evidence/.test(m)), r.problems.join('\n'));
  } finally { c.done(); }
  c = certDir([{ ...pos, result: { ...pos.result, items: [], counts: {}, failed: [] }, stamp: { ...pos.stamp, counts: { PASS: 13 } } }, ctl]);
  try {
    const r = auditProvenance(c.prov, c.logs, { construct: true });
    assert.ok(r.problems.some((m) => m.includes(ctl.label) && /matching positive .* is not valid evidence/.test(m)), r.problems.join('\n'));
  } finally { c.done(); }
  c = certDir([pos]);
  try {
    const bad = { ...pos.result, items: pos.result.items.map((i) => (i.id === 'r8:lock' ? { ...i, status: 'FAIL' } : i)) };
    fs.writeFileSync(path.join(c.logs, `${pos.label}.json`), JSON.stringify(bad));
    assert.ok(auditProvenance(c.prov, c.logs, { construct: true }).problems.some((m) => /counts differ|do not meet/.test(m)));
  } finally { c.done(); }
});
test('provenance finding 1: a retained raw output that is missing or does not hash is a problem', () => {
  const p = s1cPair({ row: 5 });
  let c = certDir([p], { raw: false });
  try { assert.ok(auditProvenance(c.prov, c.logs, { construct: true }).problems.some((m) => /raw recorder output is not retained/.test(m))); } finally { c.done(); }
  c = certDir([p]);
  try {
    fs.writeFileSync(path.join(c.logs, `${p.label}.raw.gz`), zlib.gzipSync(Buffer.from('something else')));
    assert.ok(auditProvenance(c.prov, c.logs, { construct: true }).problems.some((m) => /raw recorder output does not hash/.test(m)));
  } finally { c.done(); }
});
test('provenance finding 1: a finalized INDEX.json is VERIFIED (a changed, added or removed file is a problem); construction mode ignores it; without an explicit construct request a missing index is a problem', () => {
  const p = s1cPair({ row: 8 });
  const c = certDir([p]);
  try {
    const first = auditProvenance(c.prov, c.logs, { construct: true });
    assert.equal(first.mode, 'construct');
    fs.writeFileSync(path.join(c.prov, 'INDEX.json'), JSON.stringify(first.index));
    const ok = auditProvenance(c.prov, c.logs);
    assert.equal(ok.mode, 'verify');
    assert.deepEqual(ok.problems, []);
    // the recorded keys are matched by file name, so an old index written with absolute paths still verifies
    const abs = { ...first.index, logs: Object.fromEntries(Object.entries(first.index.logs).map(([k, v]) => [`/old/place/${k}`, v])), results: Object.fromEntries(Object.entries(first.index.results).map(([k, v]) => [`/old/place/${k}`, v])) };
    fs.writeFileSync(path.join(c.prov, 'INDEX.json'), JSON.stringify(abs));
    assert.deepEqual(auditProvenance(c.prov, c.logs).problems, []);
    fs.writeFileSync(path.join(c.prov, 'INDEX.json'), JSON.stringify(first.index));
    // tamper: change the log after the index was written
    fs.writeFileSync(path.join(c.logs, `${p.label}.log`), 'a different log');
    const t = auditProvenance(c.prov, c.logs);
    assert.ok(t.problems.some((m) => /INDEX.json logs: .* does not hash to the recorded/.test(m)), t.problems.join('\n'));
    assert.deepEqual(auditProvenance(c.prov, c.logs, { construct: true }).problems, [], 'construction mode does not read the index');
    // tamper: a stamp edited after the index
    fs.writeFileSync(path.join(c.logs, `${p.label}.log`), 'log');
    const stampFile = path.join(c.prov, `${p.label}.json`);
    fs.writeFileSync(stampFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stampFile, 'utf8')), note: 'edited' }));
    assert.ok(auditProvenance(c.prov, c.logs).problems.some((m) => /INDEX.json stamps: .* does not hash/.test(m)));
  } finally { c.done(); }
});
test('gate finding 1: the gate reads the linked results -- a stamp claiming PASS over a missing or contradictory result is a FAIL cell, and the audit problem fails the gate', () => {
  const pos = s1cPair({ row: 8 });
  const c = certDir([pos]);
  try {
    const lbl = pos.label;
    const g = buildGate({ prov: c.prov, logs: c.logs, construct: true });
    const e = g.entries.find((x) => x.row === 8 && x.cell === 'MMC3-V' && x.gt === 'action' && x.placement === 'resident');
    assert.equal(e.mesen.status, 'PASS', e.mesen.note);
    assert.equal(e.jsnes.status, 'N/A');
    fs.rmSync(path.join(c.logs, `${lbl}.json`));
    const g2 = buildGate({ prov: c.prov, logs: c.logs, construct: true });
    const e2 = g2.entries.find((x) => x.row === 8 && x.cell === 'MMC3-V' && x.gt === 'action' && x.placement === 'resident');
    assert.equal(e2.mesen.status, 'FAIL');
    assert.match(e2.mesen.note, /evidence invalid/);
    assert.equal(render(g2, { prov: c.prov, logs: c.logs }).fail, true);
    // contradictory result: an item FAILs, counts and verdict still say pass
    fs.writeFileSync(path.join(c.logs, `${lbl}.json`), JSON.stringify({ ...pos.result, items: pos.result.items.map((i, k) => (k === 3 ? { ...i, status: 'FAIL' } : i)) }));
    const e3 = buildGate({ prov: c.prov, logs: c.logs, construct: true }).entries.find((x) => x.row === 8 && x.cell === 'MMC3-V' && x.gt === 'action' && x.placement === 'resident');
    assert.equal(e3.mesen.status, 'FAIL');
  } finally { c.done(); }
});

// ---------------------------------------------------------------- finding 3: the transient PRG window
const W = (addr, val, pc = 0xe100) => ({ t: 'W', addr, val, pc, sl: 100, cy: 5, clk: 0 });
const splitCtx = { ranges: { psb: [0xe000, 0xe200], arm: [0xe300, 0xe400], irq: [0xe500, 0xe600] }, boxL: 100, fontR1: 12 };
/** Events of `calls` switch_prg_bank calls (bank 3); `transient` adds the wrong-then-restored pair inside every call. */
function prgEvents({ transient = false, outside = false } = {}) {
  const ev = [{ t: 'G', f: 1 }];
  for (let k = 0; k < 3; k++) {
    ev.push({ t: 'N', clk: k * 1000, sl: 241, cy: 5, ipc: 0, lock: 0, sm: 0, st: 0, vr: 0, vl: 0, r1: 4 }, { t: 'P', a: 3, sl: 20, cy: 5, clk: k * 1000 + 100 });
    ev.push(W(0x8000, 6), W(0x8001, 6), W(0x8000, 7), W(0x8001, 7));
    if (transient) ev.push(W(0x8000, 6), W(0x8001, 8), W(0x8000, 7), W(0x8001, 9), W(0x8000, 6), W(0x8001, 6), W(0x8000, 7), W(0x8001, 7));
    ev.push({ t: 'X', sl: 20, cy: 90, clk: k * 1000 + 200 });
    if (outside) ev.push(W(0x8000, 6), W(0x8001, 8), W(0x8000, 6), W(0x8001, 6));
    ev.push({ t: 'Z', f: k, st: 0, vl: 0, gs: 0, sm: 0 });
  }
  return { events: ev, frames: 3, error: null, done: true, trials: null };
}
test('judgeSplit finding 3: a transient wrong R6/R7 restored before the routine returns fails r8:prg-window AND r8:prg-group; the stock stream passes both', () => {
  const stock = judgeSplit(prgEvents(), splitCtx);
  assert.equal(stock.find((i) => i.id === 'r8:prg-window').status, 'PASS');
  assert.equal(stock.find((i) => i.id === 'r8:prg-group').status, 'PASS');
  const tr = judgeSplit(prgEvents({ transient: true }), splitCtx);
  assert.equal(tr.find((i) => i.id === 'r8:prg-window').status, 'FAIL');
  assert.equal(tr.find((i) => i.id === 'r8:prg-group').status, 'FAIL');
  assert.match(tr.find((i) => i.id === 'r8:prg-window').detail, /commit R6=8 inside call bank 3, wanted 6/);
});
test('judgeSplit finding 3: r8:prg-window catches a transient on its OWN -- the commit check does not depend on the call group having four writes', () => {
  // the stream the group item cannot call wrong: four writes in order per call, the wrong value commit comes from a write the group does not own (outside the PSB range)
  const ev = prgEvents();
  ev.events.splice(ev.events.findIndex((e) => e.t === 'X'), 0, W(0x8000, 6, 0xe700), W(0x8001, 8, 0xe700), W(0x8000, 6, 0xe700), W(0x8001, 6, 0xe700));
  const items = judgeSplit(ev, splitCtx);
  assert.equal(items.find((i) => i.id === 'r8:prg-window').status, 'FAIL');
  assert.match(items.find((i) => i.id === 'r8:prg-window').detail, /commit R6=8/);
});
test('judgeSplit finding 3: an R6/R7 commit outside any call after the first measured frame fails r8:prg-window; before it, the boot sequence is allowed', () => {
  assert.equal(judgeSplit(prgEvents({ outside: true }), splitCtx).find((i) => i.id === 'r8:prg-window').status, 'FAIL');
  const boot = prgEvents();
  boot.events.unshift(W(0x8000, 6), W(0x8001, 0), W(0x8000, 7), W(0x8001, 1));
  assert.equal(judgeSplit(boot, splitCtx).find((i) => i.id === 'r8:prg-window').status, 'PASS');
});
test('harnessPsb finding 3: the transient option commits a wrong pair then restores the right one before unlocking; the stock PSB has neither', () => {
  const t = harnessPsb({ transient: true }), n = harnessPsb({});
  assert.ok(t.length > n.length && !n.includes('adc #3'));
  assert.ok(t.indexOf('adc #3') > t.indexOf('adc #1') && t.indexOf('adc #3') < t.indexOf('lda #0\n  sta <split_lock'), 'wrong values commit after the right pair and before the unlock');
  assert.equal(t.split('sta $8001').length - 1, 6, 'six value commits: the right pair, a wrong pair, the restored pair');
  assert.equal(n.split('sta $8001').length - 1, 2);
});

// ---------------------------------------------------------------- finding 2: the row 5 timing domain
test('planCases finding 2: every legal start of both live nametables, strip and mixed, in both coordinate classes, plus the worst family -- for every ring', () => {
  for (const ring of [1, 2]) for (const mmc3 of [false, true]) {
    const g = GEOM[ring];
    const cases = planCases(ring, { cover: { worstIds: [32, 33], mmc3 } });
    const strips = cases.filter((c) => c.mode !== 'real');
    const startsOf = (f) => new Set(strips.filter(f).map((c) => `${c.fnt}/${c.vary}`));
    assert.equal(startsOf((c) => c.mode === 'strip' && c.name.includes('-base-')).size, 2 * g.P, `ring ${ring} strip starts`);
    assert.equal(startsOf((c) => c.mode === 'mixed' && c.name.includes('-base-')).size, 2 * g.P);
    for (const cq of [0, 1]) assert.equal(strips.filter((c) => c.name.includes('-base-') && c.name.endsWith(`-c${cq}`) && c.mode === 'mixed').length, 2 * g.P, 'a coordinate class per start');
    for (const c of strips) assert.equal((c.ftile >> 1) & 1, Number(c.name.slice(-1)), `${c.name}: the strip coordinate is of the class its name claims`);
    assert.equal(strips.filter((c) => c.name.includes('-worst-')).length, 3 * 2 * g.P, 'worst: strip + mixed A + mixed B (3 families x 2 nametables x P)');
    assert.ok(strips.filter((c) => c.name.includes('-worst-')).every((c) => (mmc3 ? c.tail === 'armed' : c.tail === undefined)));
    assert.deepEqual(new Set(strips.filter((c) => c.mode === 'mixed' && c.name.includes('-worst-')).map((c) => c.packets.length)), new Set([1, 8]));
    assert.ok(strips.every((c) => c.len === g.len && c.active === g.axis && c.vary < g.P && c.ftile % 2 === 0 && c.ftile <= g.ftileMax));
    const need = requiredCover(ring);
    assert.equal(need.any.length, 2 * 2 * g.P * 2);
    assert.equal(need.worst.length, 2 * g.P * 3);
  }
});
test('planCases finding 2: the removal mutations each remove exactly what they name', () => {
  for (const ring of [1, 2]) {
    const g = GEOM[ring], cover = { worstIds: [32], mmc3: true };
    const full = planCases(ring, { cover }).map((c) => c.name);
    const dropStart = planCases(ring, { cover, mutation: 'cover-drop-start' });
    assert.ok(dropStart.every((c) => c.mode === 'real' || c.vary !== Math.floor(g.P / 2)) && dropStart.length < full.length);
    const dropClass = planCases(ring, { cover, mutation: 'cover-drop-class' });
    assert.ok(dropClass.filter((c) => c.mode === 'mixed').every((c) => (c.ftile >> 1) % 2 === 0) && dropClass.some((c) => c.mode === 'strip' && (c.ftile >> 1) % 2 === 1));
    const dropWorst = planCases(ring, { cover, mutation: 'cover-drop-worst' });
    assert.ok(!dropWorst.some((c) => c.name.includes('-worst-')) && dropWorst.some((c) => c.name.includes('-base-')));
  }
});
test('worstMetatiles / queueShape / packetsFor: the worst ids cross a page in the most tables; both queue shapes total 35 bytes', () => {
  const w = worstMetatiles([0x20, 0x60, 0xa0, 0xe0, 0xbf], [1, 31, 32, 63, 64]);
  assert.deepEqual(w.ids, [32, 63, 64], '0xe0 + id crosses a page from id 32 up');
  assert.equal(w.crossings, 1);
  assert.equal(w.perId.find((x) => x.id === 31).c, 0);
  for (const shape of [SHAPE_A, SHAPE_B]) {
    const bytes = packetsFor(shape).flatMap((p) => [p.hi, p.lo, p.vals.length, ...p.vals]);
    assert.equal(queueShape(Uint8Array.from([...bytes, 0])), shape === SHAPE_A ? '1p/35' : '8p/35');
    assert.equal(bytes.length, 35);
  }
});

// cover:domain at judge level: a full synthetic run built from the plan by the model passes; the plan with a part removed FAILS cover:domain and nothing else
const tilesWide = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [i + 1, { tl: 16 + i, tr: 17 + i, bl: 40 + i, br: 41 + i, pal: i & 3 }]));
function synthRun(ring, cases, { mmc3 = false } = {}) {
  const nmis = [];
  cases.forEach((c, ci) => {
    if (c.mode === 'real') return;
    const bytes = c.mode === 'mixed' ? [...c.packets.flatMap((p) => [p.hi, p.lo, p.vals.length, ...p.vals]), 0] : [];
    let pre = { active: c.active, cur: 0, len: c.len, vary: c.vary, fnt: c.fnt, ftile: c.ftile, ready: c.mode === 'mixed' ? 1 : 0, vlen: c.mode === 'mixed' ? bytes.length - 1 : 0, sm: c.tail === 'armed' ? 1 : 0, lock: 0, sbuf: Uint8Array.from(c.ids), shadow: new Uint8Array(256), vbuf: Uint8Array.from([...bytes, ...new Array(64 - bytes.length).fill(0)]) };
    for (let guard = 0; guard < 40 && pre.active !== 0; guard++) {
      const exp = modelNmi(pre, { ring, tiles: tilesWide });
      // split_arm's tail, as Mesen records it: armed = select R1, its value, latch, reload, enable; disarmed = select R1, its value, disable; a non-MMC3 build writes nothing
      const mw = !mmc3 ? [] : pre.sm ? [{ addr: 0x8000, val: 1 }, { addr: 0x8001, val: 4 }, { addr: 0xc000, val: 30 }, { addr: 0xc001, val: 30 }, { addr: 0xe001, val: 30 }] : [{ addr: 0x8000, val: 1 }, { addr: 0x8001, val: 4 }, { addr: 0xe000, val: 30 }];
      nmis.push({ caseIdx: ci + 1, name: c.name, frame: nmis.length, pre, entry: { scanline: 241, cycle: 10 }, post: { ...exp.post, shadow: exp.shadow }, rti: { scanline: 250, cycle: 120 }, mw, writes: [...exp.writes, 'C90', 'S00', 'S00'] });
      pre = { ...pre, active: exp.post.active, cur: exp.post.cur, vary: exp.post.vary, shadow: exp.shadow };
    }
  });
  return { cases: cases.map((c, i) => ({ idx: i + 1, name: c.name, mode: c.mode })), nmis, done: true, shortCase: false, error: null };
}
for (const ring of [1, 2]) for (const mmc3 of [false, true]) {
  const cover = { worstIds: [32, 33, 34], crossings: 1, mmc3, splBox: 1 };
  const judge = (cases) => judgeNmi(synthRun(ring, cases, { mmc3 }), { ring, tiles: tilesWide, palFx: false, cases, cover, wcet: WCET_OK });
  test(`cover:domain ring ${ring} mmc3=${mmc3}: the full plan passes; each removal fails cover:domain only`, () => {
    const full = planCases(ring, { cover });
    const items = judge(full);
    assert.equal(items.find((i) => i.id === 'cover:domain').status, 'PASS', items.find((i) => i.id === 'cover:domain').detail);
    assert.deepEqual(failing(items), []);
    assert.ok(items.find((i) => i.id === 'cover:domain').cases.length >= 5 * GEOM[ring].P * 2);
    for (const mutation of ['cover-drop-start', 'cover-drop-class', 'cover-drop-worst']) {
      const its = judge(planCases(ring, { cover, mutation }));
      assert.deepEqual(failing(its), ['cover:domain'], mutation);
    }
  });
  test(`cover:domain ring ${ring} mmc3=${mmc3}: a worst-family strip run without the armed tail / the 8-packet queue / the worst ids does not count as the worst family`, () => {
    const full = planCases(ring, { cover });
    const strip = (f) => full.map((c) => (c.name.includes('-worst-') ? f(c) : c));
    const noIds = judge(strip((c) => ({ ...c, ids: c.ids.map(() => 1) })));
    assert.deepEqual(failing(noIds), ['cover:domain']);
    const noB = judge(full.filter((c) => !(c.mode === 'mixed' && c.packets?.length === 8)));
    assert.deepEqual(failing(noB), ['cover:domain']);
    if (mmc3) assert.deepEqual(failing(judge(strip((c) => ({ ...c, tail: undefined })))), ['cover:domain']);
  });
}
// round 3, finding 2: worst-family coverage is qualified from EVERY contributing interrupt, never from the first interrupt of the strip
for (const ring of [1, 2]) for (const mmc3 of [false, true]) {
  const cover = { worstIds: [32, 33, 34], crossings: 1, mmc3, splBox: 1 };
  const full = planCases(ring, { cover });
  const run = () => synthRun(ring, full, { mmc3 });
  const judgeRun = (r) => judgeNmi(r, { ring, tiles: tilesWide, palFx: false, cases: full, cover, wcet: WCET_OK });
  const worstNmisOf = (r, pred) => r.nmis.filter((n) => full[n.caseIdx - 1].name.includes('-worst-') && pred(n));
  /** Apply `edit` to every NMI of the worst-family strips whose index within its strip satisfies `from` (and, with `mode`, of that mode only). */
  const mutateLater = (r, edit, { mode = null, from = 1 } = {}) => {
    const seen = new Map();
    for (const n of r.nmis) {
      const k = seen.get(n.caseIdx) ?? 0; seen.set(n.caseIdx, k + 1);
      const c = full[n.caseIdx - 1];
      if (c.name.includes('-worst-') && k >= from && (!mode || c.mode === mode)) edit(n, k);
    }
    return r;
  };
  test(`cover:domain round 3 ring ${ring} mmc3=${mmc3}: the unmutated synthetic run passes (the baseline of the mutation units)`, () => {
    const items = judgeRun(run());
    assert.equal(items.find((i) => i.id === 'cover:domain').status, 'PASS', items.find((i) => i.id === 'cover:domain').detail);
    assert.deepEqual(failing(items), []);
  });
  test(`cover:domain round 3 ring ${ring} mmc3=${mmc3}: a later mixed chunk that loses its queue (the interrupt then takes the strip-only arm) does not count`, () => {
    const r = mutateLater(run(), (n) => { n.pre = { ...n.pre, ready: 0, vlen: 0, vbuf: new Uint8Array(64) }; }, { mode: 'mixed' });
    // the model is told the same story: the trace is otherwise self-consistent, so only the coverage predicate can object
    const items = judgeRun(r);
    assert.ok(items.find((i) => i.id === 'cover:domain').status === 'FAIL', items.find((i) => i.id === 'cover:domain').detail);
    assert.match(items.find((i) => i.id === 'cover:domain').detail, /changed kind part-way|never completed as one kind of work throughout|never completed with EVERY interrupt/);
  });
  test(`cover:domain round 3 ring ${ring} mmc3=${mmc3}: a later chunk consuming a non-worst id does not count (the first chunk's ids are not the strip's)`, () => {
    const r = judgeRun(mutateLater(run(), (n) => { const sb = Uint8Array.from(n.pre.sbuf); for (let i = n.pre.cur; i < Math.min(32, n.pre.cur + 3); i++) sb[i] = 1; n.pre = { ...n.pre, sbuf: sb }; }));
    assert.equal(r.find((i) => i.id === 'cover:domain').status, 'FAIL', r.find((i) => i.id === 'cover:domain').detail);
    assert.match(r.find((i) => i.id === 'cover:domain').detail, /not worst ids/);
    // and only ONE later chunk losing it, the last, is enough
    const lastOnly = judgeRun((() => { const rr = run(); const seen = new Map(); for (const n of rr.nmis) seen.set(n.caseIdx, n); for (const [ci, n] of seen) { if (!full[ci - 1].name.includes('-worst-') || n.pre.cur === 0) continue; const sb = Uint8Array.from(n.pre.sbuf); sb[n.pre.cur] = 1; n.pre = { ...n.pre, sbuf: sb }; } return rr; })());
    assert.equal(lastOnly.find((i) => i.id === 'cover:domain').status, 'FAIL');
  });
  test(`cover:domain round 3 ring ${ring} mmc3=${mmc3}: a worst-family strip whose queue shape changes on a later mixed interrupt does not count`, () => {
    const other = (n) => { const bytes = [0x3f, 0, 31, ...new Array(31).fill(2), 0]; n.pre = { ...n.pre, vlen: 34, vbuf: Uint8Array.from([...bytes, ...new Array(64 - bytes.length).fill(0)]) }; };
    const r = judgeRun(mutateLater(run(), other, { mode: 'mixed' }));
    assert.equal(r.find((i) => i.id === 'cover:domain').status, 'FAIL', r.find((i) => i.id === 'cover:domain').detail);
  });
  if (mmc3) {
    test(`cover:domain round 3 ring ${ring}: the armed tail removed only AFTER the first interrupt of each worst strip fails cover:domain (split_mode, the lock, the executed writes -- each on its own)`, () => {
      const cd = (r) => r.find((i) => i.id === 'cover:domain');
      const variants = {
        'split_mode left 0 after the first interrupt': (n) => { n.pre = { ...n.pre, sm: 0 }; },
        'the executed sequence is the disarmed branch': (n) => { n.mw = [{ addr: 0x8000, val: 1 }, { addr: 0x8001, val: 4 }, { addr: 0xe000, val: 30 }]; },
        'the lock was up (split_arm returned early, no mapper write)': (n) => { n.pre = { ...n.pre, lock: 1 }; n.mw = []; },
        'the poke was made but nothing executed': (n) => { n.mw = []; },
        'the trace carries no mapper-write record': (n) => { n.mw = null; },
        'the lock byte is not recorded': (n) => { n.pre = { ...n.pre, lock: null }; },
        'a wrong latch value on the enable write': (n) => { n.mw = [{ addr: 0x8000, val: 1 }, { addr: 0x8001, val: 4 }, { addr: 0xc000, val: 30 }, { addr: 0xc001, val: 30 }, { addr: 0xe001, val: 0 }]; }
      };
      for (const [what, edit] of Object.entries(variants)) {
        const r = judgeRun(mutateLater(run(), edit));
        assert.equal(cd(r).status, 'FAIL', `${what}: ${cd(r).detail}`);
        assert.deepEqual(failing(r).includes('cover:domain'), true, what);
      }
      // the same removal on the FIRST interrupt only is still caught (a strip with no armed first interrupt is not credited either)
      const first = judgeRun(mutateLater(run(), (n) => { n.mw = []; }, { from: 0 }));
      assert.equal(cd(first).status, 'FAIL');
    });
    test(`cover:domain round 3 ring ${ring}: splitArmed distinguishes the armed sequence from the lock early return, the disarmed branch and a missing record`, () => {
      const armed = [{ addr: 0x8000, val: 1 }, { addr: 0x8001, val: 4 }, { addr: 0xc000, val: 30 }, { addr: 0xc001, val: 30 }, { addr: 0xe001, val: 30 }];
      assert.equal(splitArmed({ lock: 0, sm: 1 }, armed, 1).ok, true);
      assert.equal(splitArmed({ lock: 1, sm: 1 }, [], 1).ok, false);
      assert.equal(splitArmed({ lock: 0, sm: 1 }, [{ addr: 0x8000, val: 1 }, { addr: 0x8001, val: 4 }, { addr: 0xe000, val: 0 }], 1).ok, false);
      assert.equal(splitArmed({ lock: 0, sm: 2 }, armed, 1).ok, false, 'another split mode');
      assert.equal(splitArmed({ lock: 0, sm: 1 }, null, 1).ok, false);
      assert.equal(splitArmed({ lock: null, sm: 1 }, armed, 1).ok, false);
      assert.equal(splitArmed({ lock: 0, sm: 1 }, [...armed].reverse(), 1).ok, false, 'wrong order');
      assert.equal(splitArmed({ lock: 0, sm: 1 }, [{ addr: 0x8000, val: 6 }, ...armed.slice(1)], 1).ok, false, 'selected R6, not R1');
    });
  }
}
test('cover:domain: with no coverage context the item is UNMEASURED, never PASS', () => {
  const items = judgeNmi(nmiParsed(1), nmiCtx(1));
  assert.equal(items.find((i) => i.id === 'cover:domain').status, 'UNMEASURED');
});

// ---------------------------------------------------------------- round 3, finding 1: construction is an explicit choice, never a fallback
const dirOf = (name) => path.join(ROOT, 'test/lua', name);
const gateAt = (c, opts = {}) => { const g = buildGate({ prov: c.prov, logs: c.logs, ...opts }); return { g, r: render(g, { prov: c.prov, logs: c.logs }) }; };
test('round 3 finding 1: verification and the default gate FAIL when INDEX.json is missing (they never fall back to construction); explicit construction is accepted and labelled', () => {
  const c = certDir([s1cPair({ row: 8 })]);
  try {
    const v = auditProvenance(c.prov, c.logs);
    assert.equal(v.mode, 'verify');
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((m) => /INDEX.json is missing/.test(m)), v.problems.join('\n'));
    const { g, r } = gateAt(c);
    assert.equal(r.fail, true, 'the default gate fails without an index');
    assert.equal(g.audit.mode, 'verify');
    assert.match(r.text, /GATE FAIL/);
    assert.match(r.text, /INDEX\.json is missing/);
    // explicit construction: accepted, and the output says it is an unfinalized construct-mode result
    const k = auditProvenance(c.prov, c.logs, { construct: true });
    assert.equal(k.mode, 'construct');
    assert.deepEqual(k.problems, []);
    const e = gateAt(c, { construct: true });
    assert.equal(e.g.audit.mode, 'construct');
    assert.match(e.r.text, /CONSTRUCT mode \(explicit\): UNFINALIZED/);
    assert.match(e.r.text, /^(GATE PASS|GATE FAIL) \(construct mode, UNFINALIZED: not a verified certificate\)/m);
    assert.equal(fs.existsSync(path.join(c.prov, 'INDEX.json')), false, 'construct mode in the gate is read-only: it writes no index');
  } finally { c.done(); }
});
test('round 3 finding 1: an unreadable, non-object or contradicted INDEX.json fails verification; a verified gate says VERIFY and passes', () => {
  const c = certDir([s1cPair({ row: 8 })]);
  try {
    const good = auditProvenance(c.prov, c.logs, { construct: true }).index;
    const idx = path.join(c.prov, 'INDEX.json');
    for (const [what, body, re] of [['unreadable', '{not json', /INDEX.json is unreadable/], ['null', 'null', /INDEX.json is not an index object/], ['array', '[]', /INDEX.json is not an index object/], ['empty object', '{}', /is on disk but was never recorded/]]) {
      fs.writeFileSync(idx, body);
      const v = auditProvenance(c.prov, c.logs);
      assert.equal(v.ok, false, what);
      assert.ok(v.problems.some((m) => re.test(m)), `${what}: ${v.problems.join(' | ')}`);
      assert.equal(gateAt(c).r.fail, true, `${what}: the gate fails`);
    }
    fs.writeFileSync(idx, JSON.stringify(good));
    const ok = gateAt(c);
    assert.equal(ok.g.audit.ok, true);
    assert.equal(ok.g.audit.mode, 'verify');
    assert.match(ok.r.text, /VERIFY: the recorded INDEX.json is required/);
    assert.deepEqual(ok.g.audit.problems, []);
  } finally { c.done(); }
});
test('round 3 finding 1: a consistent result+stamp edit passes ONLY by deleting the index -- the default gate then fails, construction labels it unfinalized', () => {
  const pos = s1cPair({ row: 8, control: 'split-prg-transient' }), match = s1cPair({ row: 8 });
  const c = certDir([pos, match]);
  try {
    const idx = path.join(c.prov, 'INDEX.json');
    fs.writeFileSync(idx, JSON.stringify(auditProvenance(c.prov, c.logs, { construct: true }).index));
    assert.equal(gateAt(c).g.audit.ok, true, 'the unaltered certificate verifies (a partial certificate still fails the gate for its unmeasured cells, so the audit is what is judged)');
    // alter the control's result AND stamp consistently (a required failure turned PASS would not change the counts the same way, so use an additional failed item)
    const res = JSON.parse(fs.readFileSync(path.join(c.logs, `${pos.label}.json`), 'utf8'));
    res.items = res.items.map((i) => (i.id === 'r8:totals' ? { ...i, status: 'FAIL', detail: 'edited' } : i));
    res.counts = tallyOf(res.items); res.failed = res.items.filter((i) => i.status === 'FAIL').map((i) => i.id);
    fs.writeFileSync(path.join(c.logs, `${pos.label}.json`), JSON.stringify(res));
    const stFile = path.join(c.prov, `${pos.label}.json`), st = JSON.parse(fs.readFileSync(stFile, 'utf8'));
    st.counts = res.counts; st.failed = res.failed; st.results = [{ ...st.results[0], counts: res.counts }];
    fs.writeFileSync(stFile, JSON.stringify(st));
    const withIdx = gateAt(c);
    assert.equal(withIdx.g.audit.ok, false, 'with the index present the edit is a recorded-hash mismatch');
    assert.ok(withIdx.g.audit.problems.some((m) => /does not hash to the recorded/.test(m)));
    fs.rmSync(idx);
    const noIdx = gateAt(c);
    assert.equal(noIdx.g.audit.ok, false, 'with the index deleted the default gate still FAILS (missing index)');
    assert.ok(noIdx.g.audit.problems.some((m) => /INDEX.json is missing/.test(m)));
    assert.equal(auditProvenance(c.prov, c.logs).ok, false);
  } finally { c.done(); }
});
test('round 3 finding 1: the stamp\'s embedded results[0] summary is validated -- a contradicted counts/verdictOk, a missing or a duplicated entry is rejected', () => {
  const p = s1cPair({ row: 8 });
  assert.deepEqual(problems(p), []);
  const bad = (results) => problems({ ...p, stamp: { ...p.stamp, results } });
  assert.ok(bad([{ ...p.stamp.results[0], counts: { FAIL: 13 }, verdictOk: false }]).some((m) => /embedded results\[0\] summary contradicts/.test(m)));
  assert.ok(bad([{ ...p.stamp.results[0], verdictOk: false }]).some((m) => /embedded results\[0\] summary contradicts/.test(m)), 'verdictOk alone');
  assert.ok(bad([{ ...p.stamp.results[0], counts: { PASS: 1 } }]).some((m) => /embedded results\[0\] summary contradicts/.test(m)), 'counts alone');
  assert.ok(bad([]).some((m) => /embedded results\[0\] summary contradicts/.test(m)), 'no entry');
  assert.ok(bad([p.stamp.results[0], p.stamp.results[0]]).some((m) => /embedded results\[0\] summary contradicts/.test(m)), 'two entries');
  assert.ok(bad([{ ...p.stamp.results[0], scene: 'another' }]).some((m) => /embedded results\[0\] summary contradicts/.test(m)), 'another scene');
});
test('round 3 finding 1: the CLIs are explicit -- ringprovindex needs --verify or --construct; --verify and run_sw_ring_gate.sh fail on a missing index; --construct writes one', () => {
  const c = certDir([s1cPair({ row: 8 })]);
  const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT });
  const idx = path.join(c.prov, 'INDEX.json');
  try {
    const none = run('node', [dirOf('ring_gate/ringprovindex.mjs'), c.prov, c.logs]);
    assert.equal(none.status, 2, 'neither flag is a usage error');
    const both = run('node', [dirOf('ring_gate/ringprovindex.mjs'), c.prov, c.logs, '--verify', '--construct']);
    assert.equal(both.status, 2);
    const v = run('node', [dirOf('ring_gate/ringprovindex.mjs'), c.prov, c.logs, '--verify']);
    assert.equal(v.status, 1, v.stdout);
    assert.match(v.stdout, /INDEX.json is missing/);
    assert.doesNotMatch(v.stdout, /verify: recorded hashes checked\): .* 0 problems/);
    assert.equal(fs.existsSync(idx), false, '--verify is read-only');
    const sh = run('bash', [dirOf('run_sw_ring_gate.sh'), c.prov, c.logs]);
    assert.equal(sh.status, 1, sh.stdout + sh.stderr);
    assert.match(sh.stdout, /INDEX\.json is missing/);
    const k = run('node', [dirOf('ring_gate/ringprovindex.mjs'), c.prov, c.logs, '--construct']);
    assert.equal(k.status, 0, k.stdout);
    assert.match(k.stdout, /construct mode: INDEX.json written, UNFINALIZED/);
    assert.equal(fs.existsSync(idx), true);
    const v2 = run('node', [dirOf('ring_gate/ringprovindex.mjs'), c.prov, c.logs, '--verify']);
    assert.equal(v2.status, 0, v2.stdout);
    const shc = run('bash', [dirOf('run_sw_ring_gate.sh'), c.prov, c.logs, '--construct']);
    assert.match(shc.stdout, /\(construct mode, UNFINALIZED: not a verified certificate\)/);
  } finally { c.done(); }
});

// ---------------------------------------------------------------- round 3, finding 3: the static NMI bound and the certified deadline allowance
// A tiny hand-assembled program at $C000: `at(addr, bytes)` builds the reader longestPath/decode take.
const mem = (parts) => { const m = new Map(); for (const [addr, bytes] of parts) bytes.forEach((b, i) => m.set(addr + i, b)); return (a) => { if (!m.has(a)) throw new Error(`no byte at $${a.toString(16)}`); return m.get(a); }; };
// The documented NMOS 6502 timing, stated here independently of ringwcet.mjs's table (S2 C3: an absolute cost the bounds depend on, PHA's 3, was not pinned by any assertion -- changing it to 2 in memory
// left every test green). Base cycles by mnemonic class and addressing mode; the page-crossing cycle is the decoder's job and is asserted by the longestPath tests below.
const NMOS_READ = new Set(['ADC', 'AND', 'BIT', 'CMP', 'CPX', 'CPY', 'EOR', 'LDA', 'LDX', 'LDY', 'ORA', 'SBC']);
const NMOS_STORE = new Set(['STA', 'STX', 'STY']);
const NMOS_RMW = new Set(['ASL', 'DEC', 'INC', 'LSR', 'ROL', 'ROR']);
const NMOS_BRANCH = new Set(['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ']);
const NMOS_IMPLIED = { BRK: 7, RTI: 6, RTS: 6, PHA: 3, PHP: 3, PLA: 4, PLP: 4 }; // every other implied/accumulator instruction is 2
function nmosCycles(m, mode) {
  if (m === 'JSR') return 6;
  if (m === 'JMP') return mode === 'abs' ? 3 : 5;
  if (NMOS_BRANCH.has(m)) return 2;
  if (mode === 'imp' || mode === 'acc') return NMOS_IMPLIED[m] ?? 2;
  if (mode === 'imm') return 2;
  if (NMOS_READ.has(m)) return { zp: 3, zpx: 4, zpy: 4, abs: 4, abx: 4, aby: 4, izx: 6, izy: 5 }[mode];
  if (NMOS_STORE.has(m)) return { zp: 3, zpx: 4, zpy: 4, abs: 4, abx: 5, aby: 5, izx: 6, izy: 6 }[mode];
  if (NMOS_RMW.has(m)) return { zp: 5, zpx: 6, abs: 6, abx: 7 }[mode];
  throw new Error(`no documented cost for ${m} ${mode}`);
}
test('ringwcet opcode table: every entry costs what the documented NMOS timing says, and the costs the tests and the NMI entry rely on are asserted by name (a wrong PHA cost fails)', () => {
  assert.ok(OPCODES.size >= 150, `${OPCODES.size} opcodes in the table`);
  const wrong = [...OPCODES.values()].filter((o) => o.cyc !== nmosCycles(o.m, o.mode)).map((o) => `$${o.op.toString(16)} ${o.m} ${o.mode}: table ${o.cyc}, documented ${nmosCycles(o.m, o.mode)}`);
  assert.deepEqual(wrong, []);
  // by name: the push/pull/return costs the NMI prologue and tail are made of, and the entry-delay arithmetic
  const cost = (op) => OPCODES.get(op).cyc;
  assert.deepEqual({ PHA: cost(0x48), PLA: cost(0x68), PHP: cost(0x08), PLP: cost(0x28), RTI: cost(0x40), RTS: cost(0x60), JSR: cost(0x20), NOP: cost(0xea), TXA: cost(0x8a), TYA: cost(0x98), TAX: cost(0xaa), TAY: cost(0xa8) },
    { PHA: 3, PLA: 4, PHP: 3, PLP: 4, RTI: 6, RTS: 6, JSR: 6, NOP: 2, TXA: 2, TYA: 2, TAX: 2, TAY: 2 });
  assert.equal(RTI_CYCLES, cost(0x40), 'the charged rti is the table\'s RTI');
  assert.equal(ENTRY_DELAY_CYCLES, 7 + 7 + 7 + 1, 'the entry allowance is the three 7-cycle sequences plus one cycle of phase');
  // and through the decoder and the path walker: a hand-assembled pha ; pla ; rts costs exactly 3 + 4 + 6
  const r = mem([[0xc000, [0x48, 0x68, 0x60]]]);
  assert.deepEqual([0xc000, 0xc001, 0xc002].map((pc) => decode(r, pc).cyc), [3, 4, 6]);
  assert.equal(longestPath(0xc000, { read: r }).cycles, 3 + 4 + 6);
  // the SABOTAGE this test exists for: the table with PHA at 2 disagrees with the documented rule
  const bad = { ...OPCODES.get(0x48), cyc: 2 };
  assert.notEqual(bad.cyc, nmosCycles(bad.m, bad.mode), 'a PHA that costs 2 is caught by the rule comparison');
});
test('ringwcet decode: cycle counts of the documented 6502 table, addressing modes and branch targets', () => {
  const r = mem([[0xc000, [0xa9, 0x05, 0x8d, 0x00, 0x20, 0xbd, 0x20, 0xc0, 0xd0, 0xfb, 0x20, 0x34, 0x12, 0x6c, 0x00, 0x02]]]);
  assert.deepEqual([0xc000, 0xc002, 0xc005, 0xc008, 0xc00a, 0xc00d].map((pc) => { const d = decode(r, pc); return [d.m, d.mode, d.cyc, d.len]; }),
    [['LDA', 'imm', 2, 2], ['STA', 'abs', 4, 3], ['LDA', 'abx', 4, 3], ['BNE', 'rel', 2, 2], ['JSR', 'abs', 6, 3], ['JMP', 'ind', 5, 3]]);
  assert.equal(decode(r, 0xc008).target, 0xc005, 'bne -5 lands on the lda abs,x');
  assert.throws(() => decode(mem([[0xc000, [0x02]]]), 0xc000), /illegal opcode/);
});
test('ringwcet longestPath: a counted loop is bounded only by its budget, the taken/last-iteration cycles are exact, an unbudgeted loop throws', () => {
  // ldx #3 ; dex ; bne -3 ; rts
  const r = mem([[0xc000, [0xa2, 0x03, 0xca, 0xd0, 0xfd, 0x60]]]);
  assert.throws(() => longestPath(0xc000, { read: r }), /not bounded by a budget/);
  const b = longestPath(0xc000, { read: r, budgets: [{ name: 'dex', limit: 3, charges: new Map([[0xc002, 1]]) }] });
  assert.equal(b.cycles, 2 + (2 + 3) + (2 + 3) + (2 + 2) + 6, 'ldx, two taken iterations, the falling-through one, rts');
  const b2 = longestPath(0xc000, { read: r, budgets: [{ name: 'dex', limit: 1, charges: new Map([[0xc002, 1]]) }] });
  assert.equal(b2.cycles, 2 + 2 + 2 + 6, 'a budget of 1 leaves only the path that falls through at once (ldx, dex, bne not taken, rts)');
});
test('ringwcet longestPath: a taken branch across a page costs 2 extra, an indexed read that can cross costs 1, STA $4014 costs 4 + 514, a forced branch is forced', () => {
  // bne at $C0FC -> $C102 (the next instruction is at $C0FE, the target on page $C1)
  const r = mem([[0xc0fc, [0xd0, 0x04, 0x60]], [0xc0fe, [0x60]], [0xc102, [0x60]]]);
  assert.equal(longestPath(0xc0fc, { read: r }).cycles, 2 + 1 + 1 + 6, 'taken, page crossed: 2 + 1 + 1, then rts');
  assert.equal(longestPath(0xc0fc, { read: r, force: new Map([[0xc0fc, false]]) }).cycles, 2 + 6, 'forced not taken: the fall-through path only');
  const x = mem([[0xc000, [0xbd, 0xf0, 0xc0, 0x60]]]);
  assert.equal(longestPath(0xc000, { read: x, indexMax: () => 20 }).cycles, 4 + 1 + 6, '$C0F0,x with x up to 20 crosses a page');
  assert.equal(longestPath(0xc000, { read: x, indexMax: () => 15 }).cycles, 4 + 6, 'x up to 15 stays on the page');
  const d = mem([[0xc000, [0x8d, 0x14, 0x40, 0x60]]]);
  assert.equal(longestPath(0xc000, { read: d }).cycles, 4 + OAM_DMA_CYCLES + 6);
  const ij = mem([[0xc000, [0x6c, 0x00, 0x02]]]);
  assert.throws(() => longestPath(0xc000, { read: ij }), /indirect jump/);
});
test('ringwcet longestPath: a jsr runs the callee under the CALLER\'s budgets (a bound that spans calls is one bound)', () => {
  // main: jsr sub ; jsr sub ; rts      sub: dex-free body charged once per call: nop ; rts
  const r = mem([[0xc000, [0x20, 0x10, 0xc0, 0x20, 0x10, 0xc0, 0x60]], [0xc010, [0xea, 0x60]]]);
  assert.equal(longestPath(0xc000, { read: r }).cycles, 6 + 2 + 6 + 6 + 2 + 6 + 6);
  assert.throws(() => longestPath(0xc000, { read: r, budgets: [{ name: 'nop', limit: 1, charges: new Map([[0xc010, 1]]) }] }), /no feasible path/, 'a budget of one nop makes the second call infeasible, not free');
});
test('maxQSum: the largest attribute-quadrant sum over a chunk (bit 1 of 2 * st_vary alternates, the fixed coordinate class does not)', () => {
  assert.deepEqual([maxQSum(1, 15, 3), maxQSum(1, 15, 2), maxQSum(2, 16, 3), maxQSum(2, 16, 2)], [7, 4, 8, 5]);
  assert.ok(maxQSum(1, 15, 3) < 9 && maxQSum(2, 16, 3) < 9, 'both below the unrefined 3 per block');
});
test('certifiedMargin: the vblank cycles left after the entry delay, the handler and rti', () => {
  assert.equal(VBLANK_CYCLES, ((260 - 241) * 341 + 339) / 3);
  assert.equal(certifiedMargin(2000), VBLANK_CYCLES - (ENTRY_DELAY_CYCLES + 2000 + RTI_CYCLES));
  assert.ok(certifiedMargin(VBLANK_CYCLES) < 0);
});

// the real assembled builds: the three pilot cells
const wcetBuild = async (cellId, gt, placement) => {
  const cell = CELLS.find((c) => c.id === cellId);
  const b = await buildNmiRing({ cell, gt, placement, label: `unit-wcet-${cellId}-${gt}-${placement}`, tree: makeCellTree({ cell, gameType: gt }) });
  return b;
};
const REAL = [['MMC3-H', 'rpg', 'banked'], ['MMC1-V', 'action', 'resident'], ['U512-H', 'rpg', 'banked']];
for (const [cellId, gt, placement] of REAL) {
  test(`ringwcet ${cellId} ${gt} ${placement}: the static bound of the assembled nmi is finite, refined <= unrefined, certified margins positive, the report path obeys its own budgets`, async () => {
    const b = await wcetBuild(cellId, gt, placement);
    try {
      const f = b.built.fns, read = fixedBank(b.built.rom);
      const ring = b.ring, geom = { axis: GEOM[ring].axis, P: GEOM[ring].P };
      const un = nmiBound({ rom: b.built.rom, fns: f, symbols: b.built.symbols, geom: null, chunk: 3, mixedChunk: 2 });
      const re = nmiBound({ rom: b.built.rom, fns: f, symbols: b.built.symbols, geom, chunk: 3, mixedChunk: 2, trace: true });
      assert.ok(Number.isFinite(re.strip) && Number.isFinite(re.mixed));
      assert.ok(re.strip <= un.strip && re.mixed <= un.mixed, 'a refinement can only remove paths');
      assert.ok(re.mixed > re.strip - 200 && re.strip > re.base && re.mixed > re.base + re.drain, 'the modes add their work to the shared prologue/DMA/scroll base');
      assert.equal(OAM_DMA_CYCLES, 514, '513 halted cycles + 1 for an odd start');
      assert.ok(re.base >= 4 + 514, 'the shared base contains the OAM DMA');
      assert.ok(certifiedMargin(re.strip) > 0 && certifiedMargin(re.mixed) > 0, `strip ${certifiedMargin(re.strip)}, mixed ${certifiedMargin(re.mixed)}`);
      // the reported longest path respects its budgets: at most 3 / 2 draw calls, one wrap body, the OAM DMA once
      for (const [path, blocks] of [[re.stripPath, 3], [re.mixedPath, 2]]) {
        const ds = path.map((pc) => decode(read, pc));
        assert.ok(ds.filter((d) => d.m === 'JSR' && d.target === f.sw_ns_draw_block).length <= blocks);
        assert.equal(ds.filter((d) => d.m === 'STA' && d.operand === 0x4014).length, 1, 'exactly one OAM DMA');
        assert.ok(ds.filter((d) => d.m === 'JSR' && d.target === f.vram_drain).length <= 1);
        assert.equal(path.filter((pc) => pc === f.nmi_rti).length, 0);
        const stVary = Number(b.built.symbols.get('st_vary'));
        assert.ok(ds.filter((d) => d.m === 'STA' && d.mode === 'abs' && d.operand === stVary).length <= 1, 'at most one wrap per interrupt');
        const shifts = ds.filter((d) => d.m === 'DEY' && ((d.pc > f.sw_nda_pshift && d.pc < f.sw_nda_pdone) || (d.pc > f.sw_nda_cshift && d.pc < f.sw_nda_cdone))).length;
        assert.ok(shifts <= 2 * maxQSum(geom.axis, geom.P, blocks), `${shifts} shift iterations`);
      }
      // the drain: the cost is linear in packets and data bytes and the worst admitted shape is one full 32-byte packet
      const t = re.drainTable;
      assert.deepEqual(t.argmax, [1, 32]);
      assert.ok(t.linear && t.linear.perByte > 0 && t.linear.perPacket > 0, 'every admitted shape fits base + perPacket*k + perByte*d');
      assert.equal(t.max, re.drain, 'the budgeted vram_drain path equals the worst enumerated shape');
      // the same fingerprint through the judge's own entry point
      const w = wcetFor({ rom: b.built.rom, fns: f, symbols: b.built.symbols, ring });
      assert.equal(w.strip, re.strip);
      assert.equal(w.mixed, re.mixed);
    } finally { b.dispose(); }
  });
}
test('ringwcet: a ROM whose chunk differs from the contract has no bound for that mode (the nmi-chunk4 / nmi-mixed3 controls), the other mode keeps its bound', async () => {
  for (const [breakMode, bad, good] of [['chunk4', 'strip', 'mixed'], ['mixed3', 'mixed', 'strip']]) {
    const b = await buildNmiRing({ cell: CELLS.find((c) => c.id === 'MMC1-V'), gt: 'action', placement: 'resident', breakMode, label: `unit-wcet-${breakMode}`, tree: makeCellTree({ cell: CELLS.find((c) => c.id === 'MMC1-V'), gameType: 'action' }) });
    try {
      assert.equal(b.wcet.error, undefined);
      assert.equal(b.wcet[bad], null);
      assert.match(b.wcet.mismatch[bad], /the contract says/);
      assert.ok(Number.isFinite(b.wcet[good]));
    } finally { b.dispose(); }
  }
});
test('ringwcet: nmiBound refuses a build with no recognisable NMI path rather than inventing a bound', () => {
  assert.throws(() => nmiBound({ rom: new Uint8Array(16 + 16384 * 2), fns: {}, symbols: new Map() }), /is not a symbol of this build/);
});

// the judge: a deadline PASS reports BOTH the observed minimum and the certified allowance; the row FAILS when the allowance leaves no positive margin or the bound is falsified
for (const ring of [1, 2]) {
  const dl = (wcet, mut) => judgeNmi(nmiParsed(ring, mut), nmiCtx(ring, wcet)).find((i) => i.id === 'deadline:strip');
  test(`deadline:strip ring ${ring}: PASS carries the observed minimum margin and the certified allowance`, () => {
    const it = dl(WCET_OK);
    assert.equal(it.status, 'PASS', it.detail);
    assert.equal(it.certified, certifiedMargin(2100));
    assert.ok(it.margin > 0 && Number.isFinite(it.margin));
    assert.match(it.detail, /observed minimum margin .* CERTIFIED: handler <= 2100 cycles .* certified margin /);
  });
  test(`deadline:strip ring ${ring}: an allowance with no positive margin is FAIL even when every observed interrupt finished`, () => {
    const it = dl({ ...WCET_OK, strip: Math.ceil(VBLANK_CYCLES - ENTRY_DELAY_CYCLES - RTI_CYCLES) });
    assert.equal(it.status, 'FAIL');
    assert.match(it.detail, /no positive margin/);
    assert.equal(dl({ ...WCET_OK, strip: 2000 }).status, 'PASS');
  });
  test(`deadline:strip ring ${ring}: no static bound, a computation error and a chunk mismatch are FAIL, never a pass on the observed minimum alone`, () => {
    assert.match(dl(null).detail, /no static bound was supplied/);
    assert.equal(dl(null).status, 'FAIL');
    assert.match(dl({ error: 'boom' }).detail, /could not be computed: boom/);
    assert.match(dl({ strip: null, mixed: 2150, mismatch: { strip: 'the ROM\'s SW_STREAM_CHUNK is 4, the contract says 3', mixed: null } }).detail, /SW_STREAM_CHUNK is 4/);
  });
  test(`deadline:strip ring ${ring}: an observation longer than the static bound, or an entry later than the charged delay, FAILs the bound itself`, () => {
    const long = dl({ ...WCET_OK, strip: 500 });
    assert.equal(long.status, 'FAIL');
    assert.match(long.detail, /falsified.*longer than the static bound 500/);
    const late = dl(WCET_OK, (n) => ({ ...n, entry: { scanline: 241, cycle: 1 + 3 * (ENTRY_DELAY_CYCLES + 5) } }));
    assert.equal(late.status, 'FAIL');
    assert.match(late.detail, /later than the charged entry delay/);
    const ok = dl(WCET_OK, (n) => ({ ...n, entry: { scanline: 241, cycle: 1 + 3 * ENTRY_DELAY_CYCLES } }));
    assert.equal(ok.status, 'PASS', 'an entry exactly at the charged delay is inside the bound');
  });
}

// ---------------------------------------------------------------- the session (lifecycle) judge: r8:lc-return, r8:lc-coverage, and the fold into the plain stream's items
const LCTX = { ...CTX, battleL: 159, battleBank: 0, SPL_BATTLE: 2, SPL_TITLE: 3, ST_BATTLE: 5, ring: 1, warpTarget: 56, fieldScreen: 55 };
const FIELD = 1, OTHER = 2; // switch_prg_bank arguments: the field screen's 16 KB bank (R6/R7 = 2/3), and the warp target's (4/5); the battle bank is 0 (R6/R7 = 0/1)
/**
 * One synthetic session stream from frame specs { sm, gs, banks: [PSB arguments in order], marks: [kinds], r1, col, row, land: 1|3 (an NMI lands after that many writes of the LAST call), span: true (the LAST call is
 * still open when the frame ends -- the delayed switch_prg_bank, P printed but no lock/writes yet -- and is completed at the start of the next frame, so that frame ends with the OLD pair in R6/R7), chr: chr_r1 as the boundary reads it (default 2), noirq: an armed frame whose split IRQ never arrives, cont: true (this frame
 * only continues the open call and ends without finishing it: a call spanning several frames) }. Every frame that is not inside a call ends in a main-loop boundary (`M`, printed by the recorder on every main_loop_ready pass).
 * Every frame is contract-obeying (an armed frame has its IRQ; a battle frame calls the battle bank and then restores the field's, exactly as call_battle does); `mutate` edits the specs first.
 */
function lcStream(frames, { sram = 128, done = true, error = null } = {}) {
  const ev = [];
  let clk = 100000;
  const w = (addr, val, pc, sl = 100, cy = 10) => ev.push({ t: 'W', addr, val, pc, sl, cy, clk: (clk += 7) });
  // power-on: the tileset registers are the field's (R0, R2-R5), written by the boot code (outside every known routine)
  [[0, 0], [2, 4], [3, 5], [4, 6], [5, 7]].forEach(([reg, v]) => { w(0x8000, reg, 0x3000); w(0x8001, v, 0x3002); });
  ev.push({ t: 'G', f: 1 });
  let open = null; // a switch_prg_bank left open across a frame end: its argument
  const finish = (bank) => { ev.push({ t: 'K', v: 1, clk: (clk += 5) }); w(0x8000, 6, 0x1010); w(0x8001, bank * 2, 0x1012); w(0x8000, 7, 0x1014); w(0x8001, bank * 2 + 1, 0x1016); ev.push({ t: 'K', v: 0, clk: (clk += 5) }); ev.push({ t: 'X', sl: 100, cy: 20, clk: (clk += 5) }); };
  for (const f of frames) {
    const sm = f.sm ?? 0, r1 = f.r1 ?? 2;
    clk += 29000;
    ev.push({ t: 'N', clk, sl: 241, cy: 5, ipc: 0x9000, lock: 0, sm, st: 1, vr: 0, vl: 0, r1: 2 });
    // the NMI handler first (arm, then the IRQ at the program's line), then the main loop's switch_prg_bank calls: the order the recorder prints them in
    ev.push({ t: 'S', sl: 245, cy: 10 }, { t: 'U', sl: 245, cy: 12 });
    const latch = sm === 1 ? LCTX.boxL : sm === 2 ? LCTX.battleL : null;
    w(0x8000, 1, 0x2010, 245); w(0x8001, r1, 0x2012, 245);
    if (latch !== null) { w(0xc000, latch, 0x2014, 245); w(0xc001, latch, 0x2016, 245); w(0xe001, 0, 0x2018, 245); } else w(0xe000, 0, 0x2014, 245);
    if (latch !== null && !f.noirq) {
      ev.push({ t: 'I', clk: (clk += 24000), sl: latch, cy: 30, ipc: 0x9000 });
      w(0xe000, 0, 0x2110, latch); w(0x8000, 1, 0x2112, latch); w(0x8001, LCTX.fontR1, 0x2114, latch);
    }
    // a landing: the frame's own record ends (its Z) and the NMI that arrives inside the call opens the next record, locked (split_lock is up inside a call)
    const land = () => { ev.push({ t: 'Z', f: 1, st: 1, vl: 0, gs: f.gs ?? 0, sm }); ev.push({ t: 'N', clk: (clk += 9), sl: 100, cy: 20, ipc: 0x1013, lock: 1, sm, st: 1, vr: 0, vl: 0, r1: 2 }); };
    if (open !== null && !f.cont) { finish(open); open = null; }
    (f.cont ? [] : f.banks ?? []).forEach((bank, i, all) => {
      ev.push({ t: 'P', a: bank, sl: 100, cy: 0, clk: (clk += 5) });
      if (f.span && i === all.length - 1) { open = bank; return; }
      ev.push({ t: 'K', v: 1, clk: (clk += 5) });
      w(0x8000, 6, 0x1010);
      if (f.land === 1 && i === all.length - 1) land(); // after 1 of the 4 writes: between R6's select and its value
      w(0x8001, bank * 2, 0x1012); w(0x8000, 7, 0x1014);
      if (f.land === 3 && i === all.length - 1) land(); // after 3: between R7's select and its value
      w(0x8001, bank * 2 + 1, 0x1016);
      ev.push({ t: 'K', v: 0, clk: (clk += 5) });
      ev.push({ t: 'X', sl: 100, cy: 20, clk: (clk += 5) });
    });
    if (open === null) ev.push({ t: 'M', gs: f.gs ?? 0, r1: f.chr ?? 2, lock: f.lock ?? 0, sm, col: f.col ?? 55, row: f.row ?? 0 });
    for (const kind of open === null ? f.marks ?? [] : []) ev.push({ t: 'L', kind, f: 1, r1: f.chr ?? 2, lock: f.lock ?? 0, gs: f.gs ?? 0, col: f.col ?? 55, row: f.row ?? 0, sm, px: 120, py: 120 });
    ev.push({ t: 'Z', f: 1, st: 1, vl: 0, gs: f.gs ?? 0, sm });
  }
  return { events: ev, frames: frames.length, error, done, sram, trials: { planned: 0, consumed: 0, skipped: 0, done: 0 } };
}
const battleFrames = (n = 70) => Array.from({ length: n }, (_, i) => ({ sm: 2, gs: 5, banks: [0, FIELD], r1: 2, land: i === 3 ? 1 : i === 4 ? 3 : undefined, marks: i === 1 ? ['battle-in'] : i === 2 ? ['battle-mid'] : i === n - 1 ? ['battle-late'] : [] }));
/** The whole session: part A = field, a battle, the return, a warp, a Save; part B = Continue. `mut({ A, B })` edits the frame specs. */
function lcSession(mut = () => {}) {
  const A = [
    { banks: [FIELD], marks: ['field'] },
    ...battleFrames(),
    { banks: [FIELD], marks: ['battle-ret'] }, { marks: ['battle-out'] },
    { banks: [OTHER], col: 56, marks: ['warp-out'] }, { col: 56, marks: ['save'] }
  ];
  const B = [{ banks: [OTHER], col: 56, marks: ['cont-out'] }];
  const spec = { A, B, sram: 128 };
  mut(spec);
  return [lcStream(spec.A, { sram: spec.sram }), lcStream(spec.B, {})];
}
const lcItems = (mut) => { const [a, b] = lcSession(mut); const r = judgeLifecycle(a, b, LCTX); return Object.fromEntries(r.items.map((i) => [i.id, i])); };
const lcMark = (spec, kind) => spec.A.find((f) => f.marks?.includes(kind)) ?? spec.B.find((f) => f.marks?.includes(kind));
test('judgeLifecycle: the contract-obeying session passes r8:lc-return and r8:lc-coverage', () => {
  const it = lcItems();
  assert.equal(it['r8:lc-return'].status, 'PASS', it['r8:lc-return'].detail);
  assert.equal(it['r8:lc-coverage'].status, 'PASS', it['r8:lc-coverage'].detail);
});
test('judgeLifecycle r8:lc-return: a battle whose restore is lost (the window left on the battle bank at a battle frame\'s end) fails it', () => {
  const it = lcItems((s) => { for (const f of s.A) if (f.sm === 2) f.banks = [0]; });
  assert.equal(it['r8:lc-return'].status, 'FAIL');
  assert.match(it['r8:lc-return'].detail, /battle-mid.*not the field's/);
});
test('judgeLifecycle r8:lc-return: the pair after the fight, after the warp, and after Continue each fail it when wrong', () => {
  assert.match(lcItems((s) => { lcMark(s, 'battle-out').banks = [0]; })['r8:lc-return'].detail, /battle-out: the PRG pair 0,1 is not the field's 2,3/);
  assert.match(lcItems((s) => { lcMark(s, 'warp-out').banks = [0]; })['r8:lc-return'].detail, /warp-out: the window still holds the battle bank/);
  assert.match(lcItems((s) => { lcMark(s, 'cont-out').banks = [FIELD]; })['r8:lc-return'].detail, /cont-out: the PRG pair 2,3 is not the one the saved session ended with 4,5/);
  assert.equal(lcItems((s) => { lcMark(s, 'cont-out').banks = [FIELD]; })['r8:lc-return'].status, 'FAIL');
});
// ---- the return boundary (review 1 of C3): the restore is judged where call_battle has returned, never at an arbitrary frame end
const lcFails = (mut, re, why) => { const it = lcItems(mut)['r8:lc-return']; assert.equal(it.status, 'FAIL', why); assert.match(it.detail, re, why); };
test('judgeLifecycle r8:lc-return: a wrong IMMEDIATE return that battle-out later repairs fails (the review\'s repro 2: the field pair is restored only 60 frames on)', () => {
  const mut = (s) => { lcMark(s, 'battle-ret').banks = [0]; lcMark(s, 'battle-out').banks = [FIELD]; };
  lcFails(mut, /battle return \(the first main-loop pass after the fight\): the PRG pair 0,1 is not the field's 2,3/, 'the first boundary after the fight');
  lcFails(mut, /battle-ret: the PRG pair 0,1 is not the field's 2,3/, 'the battle-ret mark');
  assert.equal(lcItems(mut)['r8:lc-coverage'].status, 'PASS', 'the session itself did everything: only the verdict differs');
  // the same hole with NO mark on that frame: the boundary alone catches it
  lcFails((s) => { const r = lcMark(s, 'battle-ret'); r.marks = r.marks.filter((k) => k !== 'battle-ret'); r.banks = [0]; s.A.find((x) => x.marks?.includes('battle-out')).banks = [FIELD]; }, /battle return \(the first main-loop pass after the fight\): the PRG pair 0,1/, 'an unmarked immediate return');
});
test('judgeLifecycle r8:lc-return: the immediate return carries its CHR obligations too (chr_r1, R1 on the tileset page, the tileset registers, the screen)', () => {
  lcFails((s) => { lcMark(s, 'battle-ret').chr = 3; lcMark(s, 'battle-ret').r1 = 3; }, /battle return \(the first main-loop pass after the fight\): chr_r1 3 is not the field's 2/, 'chr_r1');
  lcFails((s) => { lcMark(s, 'battle-ret').r1 = LCTX.fontR1; s.A.find((f) => f.marks?.includes('battle-out')).r1 = 2; }, /battle return \(the first main-loop pass after the fight\): R1 10 is not chr_r1 2/, 'R1 stuck on the font page with the split program off');
  lcFails((s) => { lcMark(s, 'battle-ret').col = 54; }, /battle return \(the first main-loop pass after the fight\): back on screen 54,0/, 'the screen');
  const [a, b] = lcSession();
  const i = a.events.findIndex((e) => e.t === 'M' && e.gs === 0 && a.events.slice(0, a.events.indexOf(e)).some((x) => x.t === 'M' && x.gs === LCTX.ST_BATTLE)); // the first boundary after the fight
  a.events.splice(i, 0, { t: 'W', addr: 0x8000, val: 3, pc: 0x3000, sl: 100, cy: 10, clk: 1e9 }, { t: 'W', addr: 0x8001, val: 9, pc: 0x3002, sl: 100, cy: 10, clk: 1e9 + 1 });
  const r = judgeLifecycle(a, b, LCTX).items[0];
  assert.equal(r.status, 'FAIL'); assert.match(r.detail, /battle return \(the first main-loop pass after the fight\): the tileset registers/);
});
test('judgeLifecycle r8:lc-return: one isolated battle boundary that lacks the field restore fails although every later boundary is restored (the review\'s repro 3)', () => {
  lcFails((s) => { const f = s.A.filter((x, i) => x.sm === 2 && !x.marks?.length && i > 20)[0]; f.banks = [0]; }, /battle boundary \d+\/\d+: the switchable window holds R6\/R7 = 0\/1 after call_battle returned, not the field's 2,3/, 'one unmarked battle frame');
  // and the first and the last battle boundary, which sit next to a mark
  lcFails((s) => { s.A.filter((x) => x.sm === 2)[0].banks = [0]; }, /battle boundary 1\/\d+/, 'the first boundary');
  lcFails((s) => { const b = s.A.filter((x) => x.sm === 2); b[b.length - 1].banks = [0]; }, /battle boundary \d+\/\d+/, 'the last boundary');
});
test('judgeLifecycle r8:lc-return: every boundary from the first return to battle-out is judged, not only the marked ones', () => {
  lcFails((s) => { s.A.splice(s.A.findIndex((f) => f.marks?.includes('battle-out')), 0, { banks: [0], r1: 2 }); s.A.splice(s.A.findIndex((f) => f.marks?.includes('battle-out')), 0, { banks: [FIELD] }); }, /battle return boundary 2\/\d+: the PRG pair 0,1 is not the field's/, 'a wrong boundary between battle-ret and battle-out that is repaired before the mark');
});
test('judgeLifecycle r8:lc-return: a frame that ENDS inside a delayed switch_prg_bank is legitimate and passes (parts of the retained positives: frame ends with the old pair, split_lock still 0)', () => {
  // the review\'s evidence: part A frames 217/220/223/226 of s1c-r8-MMC3-H-rpg-banked end with R6/R7 = 0/1 while the switch to the field bank is open and has written nothing; the next frame completes it
  const mut = (s) => {
    const bat = s.A.filter((f) => f.sm === 2 && !f.marks?.length);
    for (const i of [10, 20, 30]) bat[i].span = true; // ends inside the call, completed by the next frame
    bat[40].span = true; bat[41].cont = true; bat[42].cont = true; // a call that stays open over three frame ends
  };
  const it = lcItems(mut);
  assert.equal(it['r8:lc-return'].status, 'PASS', it['r8:lc-return'].detail);
  assert.equal(it['r8:lc-coverage'].status, 'PASS', it['r8:lc-coverage'].detail);
  // and the stream really holds such frame ends: Z records taken while R6/R7 is the battle pair and a call is open
  const [a] = lcSession(mut);
  const an = analyze(a, LCTX);
  assert.ok(an.recs.filter((r) => r.z && r.z.R[6] === 0 && r.z.R[7] === 1 && r.z.gs === LCTX.ST_BATTLE).length >= 5, 'frame ends with the battle pair still in the window');
  // an in-flight frame end that is NOT followed by the restore (the call is never completed) still fails at the next boundary
  lcFails((s) => { const bat = s.A.filter((f) => f.sm === 2 && !f.marks?.length); bat[10].banks = [0]; bat[10].span = false; bat[11].banks = [0]; }, /battle boundary/, 'a lost restore is still a lost restore');
});
// ---- fix 1b: every check of judgeLifecycle has a unit that fails it ALONE (handoff-next/s5-c3/judge-sweep-fix1b.mjs deletes each ok(...) / need.push(...) in turn and requires a failing test).
// (an armed battle frame's split IRQ writes the font page to R1 at the end of the frame: a stray R1 is injected with noirq.) A mutation is shaped so that the check under test is among the first three messages (the item's detail lists three).
const wr = (reg, val) => [{ t: 'W', addr: 0x8000, val: reg, pc: 0x3000, sl: 100, cy: 10, clk: 1e9 }, { t: 'W', addr: 0x8001, val, pc: 0x3002, sl: 100, cy: 10, clk: 1e9 + 1 }];
/** writes spliced into a stream just before its first event satisfying `pred` */
const injectBefore = (stream, pred, writes) => { stream.events.splice(stream.events.findIndex(pred), 0, ...writes); };
const isMark = (kind) => (e) => e.t === 'L' && e.kind === kind;
const firstAfterFight = (stream) => { let seenBattle = false; return stream.events.findIndex((e) => { if (e.t === 'M' && e.gs === LCTX.ST_BATTLE) seenBattle = true; return seenBattle && e.t === 'M' && e.gs !== LCTX.ST_BATTLE; }); };
const lcFailsStream = (mut, re, why) => { const [a, b] = lcSession(); mut(a, b); const it = judgeLifecycle(a, b, LCTX).items[0]; assert.equal(it.status, 'FAIL', why); assert.match(it.detail, re, why); };
const battleFrame = (s, n) => s.A.filter((f) => f.sm === 2 && !f.marks?.length)[n];
test('fix 1b, marks: an incoherent pair, R1 off the tileset page, game_state or split_mode wrong at the field / warp / Save / Continue marks each fail alone', () => {
  lcFailsStream((a) => injectBefore(a, isMark('save'), wr(7, 9)), /save: PRG pair incoherent/, 'common: coherent pair at a mark');
  lcFails((s) => { lcMark(s, 'save').r1 = LCTX.fontR1; }, /save: R1 10 is not chr_r1 2/, 'common: R1 at a mark');
  lcFails((s) => { lcMark(s, 'field').gs = 1; }, /field: game_state 1/, 'field game_state');
  lcFails((s) => { lcMark(s, 'field').sm = 1; }, /field: split_mode 1 on an idle field/, 'field split_mode');
  lcFails((s) => { Object.assign(lcMark(s, 'warp-out'), { gs: 1 }); }, /warp-out: game_state 1, split_mode 0/, 'warp-out game_state');
  lcFails((s) => { lcMark(s, 'warp-out').chr = 3; }, /warp-out: chr_r1 3 is not the field's 2/, 'warp-out chr_r1');
  lcFails((s) => { lcMark(s, 'save').gs = 1; }, /save: game_state 1/, 'save game_state');
  lcFails((s) => { lcMark(s, 'save').chr = 3; }, /save: tileset registers .* chr_r1 3 are not the field's/, 'save chr_r1');
  lcFailsStream((a) => injectBefore(a, isMark('save'), wr(2, 8)), /save: tileset registers/, 'save tileset registers');
  lcFails((s) => { lcMark(s, 'cont-out').gs = 1; }, /cont-out: game_state 1, split_mode 0/, 'cont-out game_state');
  lcFails((s) => { lcMark(s, 'cont-out').sm = 1; }, /cont-out: game_state 0, split_mode 1/, 'cont-out split_mode');
  lcFails((s) => { lcMark(s, 'cont-out').chr = 3; }, /cont-out: tileset registers .* chr_r1 3 are not the field's/, 'cont-out chr_r1');
  lcFailsStream((a, b) => injectBefore(b, isMark('cont-out'), wr(4, 9)), /cont-out: tileset registers/, 'cont-out tileset registers');
});
test('fix 1b, the battle marks: game_state, split_mode, split_lock and R1 at battle-mid each fail alone', () => {
  lcFails((s) => { lcMark(s, 'battle-mid').gs = 0; }, /battle-mid: game_state 0, not ST_BATTLE/, 'game_state');
  lcFails((s) => { lcMark(s, 'battle-mid').sm = 1; }, /battle-mid: split_mode 1, the engine did not select SPL_BATTLE/, 'split_mode');
  lcFails((s) => { lcMark(s, 'battle-mid').lock = 1; }, /battle-mid: split_lock 1/, 'split_lock');
  lcFails((s) => { Object.assign(lcMark(s, 'battle-mid'), { r1: 7, noirq: true }); }, /battle-mid: R1 7 is neither chr_r1 2 nor the font 10/, 'R1');
});
test('fix 1b, every battle boundary: a split_lock left up or R1 on a stray page at one unmarked boundary fails alone (the orchestrator\'s two survivors)', () => {
  lcFails((s) => { battleFrame(s, 5).lock = 1; }, /battle boundary \d+\/\d+: split_lock 1/, 'lock at one boundary');
  lcFails((s) => { Object.assign(battleFrame(s, 5), { r1: 7, noirq: true }); }, /battle boundary \d+\/\d+: R1 7 is neither chr_r1 2 nor the font 10/, 'R1 at one boundary');
  // the font page at a battle boundary is legitimate (a split IRQ that fired before the main thread got here)
  const ok1 = lcItems((s) => { battleFrame(s, 5).r1 = LCTX.fontR1; });
  assert.equal(ok1['r8:lc-return'].status, 'PASS', ok1['r8:lc-return'].detail);
});
test('fix 1b, the return after the fight: split_lock, an incoherent pair, game_state and the split program each fail alone', () => {
  const first = /battle return \(the first main-loop pass after the fight\): /;
  lcFails((s) => { lcMark(s, 'battle-ret').lock = 1; }, new RegExp(first.source + 'split_lock 1'), 'restored: lock');
  lcFailsStream((a) => a.events.splice(firstAfterFight(a), 0, ...wr(7, 5)), new RegExp(first.source + 'PRG pair incoherent'), 'restored: coherent');
  lcFails((s) => { lcMark(s, 'battle-ret').gs = 1; }, new RegExp(first.source + 'game_state 1'), 'restored: game_state');
  lcFails((s) => { lcMark(s, 'battle-out').sm = 1; }, /battle-out: split_mode 1/, 'battle-out split_mode');
  lcFails((s) => { lcMark(s, 'battle-ret').sm = 1; }, /battle-ret: split_mode 1/, 'battle-ret split_mode');
});
test('fix 1b, coverage: too few battle boundaries, no boundary after the fight, too few split IRQs, too few switch_prg_bank calls each fail alone', () => {
  const cov = (mut, re) => { const c = lcItems(mut)['r8:lc-coverage']; assert.equal(c.status, 'FAIL'); assert.match(c.detail, re); };
  cov((s) => { s.A.filter((f) => f.sm === 2 && !f.marks?.length).slice(10, 30).forEach((f) => { f.gs = 0; }); }, /main-loop return boundaries in the battle 50 < 60/);
  cov((s) => { s.A.length = s.A.map((f) => f.sm).lastIndexOf(2) + 1; }, /no main-loop return boundary after the fight/);
  cov((s) => { s.A.filter((f) => f.sm === 2).forEach((f) => { f.noirq = true; }); }, /split IRQs in battle frames 0 < 40/);
  cov((s) => { s.A.filter((f) => f.sm === 2 && !f.marks?.length).slice(10).forEach((f) => { f.banks = []; }); }, /switch_prg_bank calls during the battle 26 < 40/);
});
test('judgeLifecycle r8:lc-return: warp/Save/Continue on one coherent non-battle pair is not the judge\'s to refute (it does not know a screen\'s bank; r8:prg-window holds the pair to the latest switch\'s argument)', () => {
  const it = lcItems((s) => { lcMark(s, 'warp-out').banks = [3]; s.B[0].banks = [3]; });
  assert.equal(it['r8:lc-return'].status, 'PASS');
});
test('judgeLifecycle r8:lc-return: R1 left on the font (r1-stuck-font), a split_lock left up, or an odd/incoherent pair at a mark fails it', () => {
  const stuck = lcItems((s) => { lcMark(s, 'battle-out').r1 = LCTX.fontR1; });
  assert.equal(stuck['r8:lc-return'].status, 'FAIL'); assert.match(stuck['r8:lc-return'].detail, /battle-out: R1 10 is not chr_r1 2/);
  const locked = lcItems((s) => { lcMark(s, 'warp-out').lock = 1; });
  assert.equal(locked['r8:lc-return'].status, 'FAIL'); assert.match(locked['r8:lc-return'].detail, /warp-out: split_lock 1/);
  const odd = lcItems((s) => { lcMark(s, 'save').banks = [FIELD]; }); // a call whose pair is not [R6 even, R7 = R6 + 1] cannot be built by banks; corrupt R7 below
  void odd;
});
test('judgeLifecycle r8:lc-return: a tileset register changed across the warp, or a wrong landing screen, fails it', () => {
  const [a, b] = lcSession();
  // an R2 rewrite (a stray tileset register) before the warp mark: inject a write into the warp frame's record
  const idx = a.events.findIndex((e) => e.t === 'L' && e.kind === 'warp-out');
  a.events.splice(idx, 0, { t: 'W', addr: 0x8000, val: 2, pc: 0x3000, sl: 100, cy: 10, clk: 1e9 }, { t: 'W', addr: 0x8001, val: 8, pc: 0x3002, sl: 100, cy: 10, clk: 1e9 + 1 });
  const r = judgeLifecycle(a, b, LCTX).items[0];
  assert.equal(r.status, 'FAIL'); assert.match(r.detail, /warp-out: the tileset registers/);
  assert.match(lcItems((s) => { lcMark(s, 'warp-out').col = 3; })['r8:lc-return'].detail, /warp-out: landed on screen 3, the doorway warps to 56/);
  assert.match(lcItems((s) => { lcMark(s, 'cont-out').col = 55; })['r8:lc-return'].detail, /cont-out: Continue landed on screen 55,0, the Save was made on 56,0/);
});
test('judgeLifecycle r8:lc-return: a session with no mark at all is UNMEASURED, never a pass', () => {
  const a = lcStream([{ banks: [FIELD] }]), b = lcStream([{ banks: [FIELD] }]);
  const it = judgeLifecycle(a, b, LCTX).items;
  assert.equal(it[0].status, 'UNMEASURED');
  assert.equal(it[1].status, 'FAIL');
});
test('judgeLifecycle r8:lc-coverage: each thing the session must have done is a failure when it did not happen (the non-vacuity of the session)', () => {
  const cov = (mut, opts) => lcItems(mut)['r8:lc-coverage'];
  const bad = (mut, re) => { const c = cov(mut); assert.equal(c.status, 'FAIL'); assert.match(c.detail, re); };
  bad((s) => { s.A = s.A.filter((f) => !f.marks?.includes('warp-out')); }, /no warp-out mark/);
  bad((s) => { s.sram = 0; }, /the Save wrote 0 battery RAM bytes/);
  bad((s) => { s.B = []; s.B.push({ banks: [OTHER] }); }, /no cont-out mark/);
  bad((s) => { s.A = s.A.filter((f) => f.sm !== 2 || f.marks?.length); }, /SPL_BATTLE armed frames in battle \d+ < 60/);
  bad((s) => { for (const f of s.A) if (f.sm === 2) f.banks = [FIELD]; }, /switch_prg_bank\(BATTLE_BANK = 0\) calls during the battle 0 < 20/);
  bad((s) => { for (const f of s.A) delete f.land; }, /NMI landings between the select and the value of R6 inside a battle call 0 < 1/);
  bad((s) => { for (const f of s.A) if (f.land === 3) delete f.land; }, /NMI landings between the select and the value of R7 inside a battle call 0 < 1/);
  assert.equal(cov(() => {}).status, 'PASS');
  const [a, b] = lcSession();
  assert.match(judgeLifecycle({ ...a, done: false }, b, LCTX).items[1].detail, /part A did not finish/);
  assert.match(judgeLifecycle(a, { ...b, error: 'never reached ST_GAMEPLAY' }, LCTX).items[1].detail, /part B did not finish: never reached ST_GAMEPLAY/);
});
test('judgeLifecycle: a session stream folds into judgeSplit with the title and forced-blank frames excluded, and its own coverage skipped', () => {
  const [a] = lcSession();
  const items = judgeSplit(a, LCTX, { lifecycle: true });
  assert.ok(!items.some((i) => i.id === 'r8:coverage'), 'a session stream\'s coverage is r8:lc-coverage');
  assert.deepEqual(items.filter((i) => i.status !== 'PASS').map((i) => `${i.id}=${i.status}`), []);
  // a split_mode program that is neither SPL_BOX, SPL_BATTLE nor excluded fails the arm grammar
  const bad = lcStream([{ sm: 1, banks: [FIELD] }, { sm: 2 }]);
  bad.events.find((e) => e.t === 'N' && e.sm === 2).sm = 7;
  assert.equal(judgeSplit(bad, LCTX, { lifecycle: true }).find((i) => i.id === 'r8:arm-grammar').status, 'FAIL');
  // the title program (SPL_TITLE) and a frame with the picture off are not judged against the box/battle grammar
  const t = lcStream([{ sm: 1, banks: [FIELD] }, { sm: 3 }, { sm: 0 }]);
  const tn = t.events.filter((e) => e.t === 'N')[1];
  tn.sm = 3;
  const kept = judgeSplit(t, LCTX, { lifecycle: true }).find((i) => i.id === 'r8:irq-count');
  assert.notEqual(kept.status, 'FAIL', kept.detail);
  assert.equal(judgeSplit(t, LCTX).find((i) => i.id === 'r8:arm-grammar').status, 'FAIL', 'the same stream judged as a plain one rejects the title program');
});
test('foldLifecycle: a failing session fails the shared item, an unmeasured one never weakens a pass, an unsound session fails the run items', () => {
  const plain = [{ id: 'run:exit', status: 'PASS', detail: 'p' }, { id: 'r8:lock', status: 'PASS', detail: 'p' }, { id: 'r8:prg-group', status: 'PASS', detail: 'p' }, { id: 'r8:coverage', status: 'PASS', detail: 'cov' }];
  const sess = (o) => ({ A: [{ id: 'run:exit', status: 'PASS', detail: 'a' }, { id: 'r8:lock', status: 'PASS', detail: 'a' }, { id: 'r8:prg-group', status: 'PASS', detail: 'a' }, { id: 'r8:coverage', status: 'FAIL', detail: 'x' }], B: [{ id: 'run:exit', status: 'PASS', detail: 'b' }, { id: 'r8:lock', status: 'UNMEASURED', detail: 'b' }, { id: 'r8:prg-group', status: 'UNMEASURED', detail: 'b' }], ...o });
  const st = (items) => Object.fromEntries(items.map((i) => [i.id, i.status]));
  assert.deepEqual(st(foldLifecycle(plain, sess())), { 'run:exit': 'PASS', 'r8:lock': 'PASS', 'r8:prg-group': 'PASS', 'r8:coverage': 'PASS' });
  assert.equal(st(foldLifecycle(plain, sess({ A: [{ id: 'r8:prg-group', status: 'FAIL', detail: 'a' }] })))['r8:prg-group'], 'FAIL');
  assert.equal(st(foldLifecycle(plain, sess({ B: [{ id: 'run:exit', status: 'FAIL', detail: 'b' }] })))['run:exit'], 'FAIL');
  assert.equal(st(foldLifecycle(plain, sess({ B: [{ id: 'run:exit', status: 'UNMEASURED', detail: 'b' }] })))['run:exit'], 'FAIL', 'a run item a session stream did not PASS is a failure');
  assert.equal(st(foldLifecycle([{ ...plain[1], status: 'FAIL' }], sess()))['r8:lock'], 'FAIL', 'the plain stream\'s own failure stays');
  assert.match(foldLifecycle(plain, sess())[1].detail, /session A: PASS/);
});
test('row 8 on an RPG build holds 15 items, on an action build 13: the two lifecycle items are required exactly on RPG', () => {
  assert.equal(requiredItems(8, 'action').length, 13);
  assert.equal(requiredItems(8, 'rpg').length, 15);
  assert.deepEqual(requiredItems(8, 'rpg').slice(13), ['r8:lc-return', 'r8:lc-coverage']);
  for (const row of [5, 6]) assert.deepEqual(requiredItems(row, 'rpg'), REQUIRED_ITEMS[row]);
  // the audit holds an RPG row-8 result to the 15, and an action one to the 13
  const rpg = s1cPair({ row: 8, cell: 'MMC3-H', gt: 'rpg', pl: 'banked' });
  assert.deepEqual(problems(rpg), []);
  const lacking = s1cPair({ row: 8, cell: 'MMC3-H', gt: 'rpg', pl: 'banked', items: itemsOf(8, undefined, 'action') });
  assert.ok(problems(lacking).some((p) => /required item\(s\) absent: r8:lc-return, r8:lc-coverage/.test(p)), problems(lacking).join('; '));
  const extra = s1cPair({ row: 8, cell: 'MMC3-H', gt: 'action', pl: 'resident', items: itemsOf(8, undefined, 'rpg') });
  assert.ok(problems(extra).some((p) => /outside row 8's declared set: r8:lc-return, r8:lc-coverage/.test(p)), problems(extra).join('; '));
});
test('the session controls: declared on the MMC3 cells\' RPG builds only (resident and banked), each failing exactly the item its sabotage names, the plain stream built unsabotaged', () => {
  for (const id of ['split-bank-restore-lost', 'split-lc-skip-warp']) {
    assert.deepEqual(controlBuilds(id), [['rpg', 'resident'], ['rpg', 'banked']], id);
    assert.equal(SPLIT_SABOTAGES[CONTROLS[id].arg].lifecycleOnly, true, id);
    for (const ring of [1, 2]) assert.equal(declaredFor(id, ring).outcome, 'caught', id);
    assert.equal(decodeLabel(controlLabel(id, 'MMC3-H', 'action', 'resident')), null, 'an action build has no session');
    assert.ok(decodeLabel(controlLabel(id, 'MMC3-V', 'rpg', 'resident')));
    assert.equal(decodeLabel(controlLabel(id, 'MMC1-H', 'rpg', 'banked')), null, 'row 8 is MMC3-only');
  }
  assert.deepEqual(SPLIT_SABOTAGES['bank-restore-lost'].declared, ['r8:lc-return']);
  assert.deepEqual(SPLIT_SABOTAGES['lc-skip-warp'].declared, ['r8:lc-coverage']);
  // the engine edit still applies to the stock source exactly once
  const src = fs.readFileSync(path.join(ROOT, 'engine/screens.asm'), 'utf8');
  const edited = SPLIT_SABOTAGES['bank-restore-lost'].edit(src);
  assert.notEqual(edited, src);
  assert.equal(src.length - edited.length, '  jsr sw_locate_current\n'.length);
});

test('S5 C3: a row-8 RPG stamp retains the three-invocation session (plain run, lifecycle part A, part B) and names its lifecycle ROM; every other run retains exactly its one invocation and no lifecycle', () => {
  const rpg = s1cPair({ row: 8, cell: 'MMC3-H', gt: 'rpg', pl: 'banked' }), act = s1cPair({ row: 8, cell: 'MMC3-H' }), r5 = s1cPair({ row: 5, cell: 'MMC3-H', gt: 'rpg' });
  const audit = (pairs, edit) => {
    const c = certDir(pairs);
    try {
      if (edit) for (const [f, fn] of Object.entries(edit)) { const file = path.join(c.prov, `${f}.json`); const st = JSON.parse(fs.readFileSync(file, 'utf8')); fn(st); fs.writeFileSync(file, JSON.stringify(st)); }
      return auditProvenance(c.prov, c.logs, { construct: true }).problems;
    } finally { c.done(); }
  };
  assert.deepEqual(audit([rpg, act, r5]), [], 'a session, an action row-8 run and an RPG row-5 run each audit clean');
  assert.ok(audit([rpg], { [rpg.label]: (st) => { st.mesenChain = st.mesenChain.slice(0, 1); } }).some((m) => /exactly its 3 Mesen invocation/.test(m)), 'a session with only its plain invocation');
  assert.ok(audit([rpg], { [rpg.label]: (st) => { st.mesenChain.reverse(); } }).some((m) => /exactly its 3 Mesen invocation/.test(m)), 'out of order');
  assert.ok(audit([rpg], { [rpg.label]: (st) => { delete st.plan.lifecycle; st.plan.sha256 = sha256(JSON.stringify((({ sha256: _s, ...q }) => q)(st.plan))); } }).some((m) => /does not name its lifecycle ROM/.test(m)), 'no lifecycle ROM named');
  assert.ok(audit([rpg], { [rpg.label]: (st) => { st.plan.lifecycle.romSha256 = st.romSha256; st.plan.sha256 = sha256(JSON.stringify((({ sha256: _s, ...q }) => q)(st.plan))); } }).some((m) => /does not name its lifecycle ROM/.test(m)), 'the lifecycle ROM is the plain ROM');
  assert.ok(audit([act], { [act.label]: (st) => { st.plan.lifecycle = { romSha256: H64b, luaSha256: H64, purposes: [] }; st.plan.sha256 = sha256(JSON.stringify((({ sha256: _s, ...q }) => q)(st.plan))); } }).some((m) => /only a row-8 RPG session carries a lifecycle/.test(m)), 'a lifecycle on an action stamp');
  assert.ok(audit([r5], { [r5.label]: (st) => { st.mesenChain.push({ ...st.mesenChain[0], n: 2, purpose: 'row8-split-lc-a', spec: 'row8-split-lc-a' }); } }).some((m) => /exactly its 1 Mesen invocation/.test(m)), 'a second invocation on a row-5 run');
});

// ---- the row-8 harness RAM reservation (E20): one declaration, a guard that resolves the build's own allocation names ------------------------------------------------------------
// The pilot failed 36 of 36 row-8 jobs because Equipment C3 put pc_eq_atk..pc_eq_mdef on the old $07E0-$07EF reservation. The wrong implementations these controls name: a guard that reads only
// literal-$hex equates (missed every expression-based address), one that reads an unresolved @size as one byte, one that tests only the START of an allocation, and an HD that stops following its reservation.
const synthText = (lines) => lines.join('\n');
const synthSyms = (extra = []) => {
  const m = new Map(Array.from({ length: 60 }, (_, i) => [`filler_${i}`, 0x0300 + i]));
  for (const [n, a] of extra) m.set(n, a);
  return m;
};
test('HD derives from the one reservation: $07C0-$07CF, preLo $07C0, preHi $07C1, gaps $07C2-$07C6; a layout outside its reservation is refused', () => {
  assert.deepEqual(HD_RESERVATION, { base: 0x07c0, length: 16 });
  assert.deepEqual(HD, { preLo: 0x07c0, preHi: 0x07c1, gap: [0x07c2, 0x07c3, 0x07c4, 0x07c5, 0x07c6] });
  assert.deepEqual(hdLayout({ base: 0x0400, length: 16 }), { preLo: 0x0400, preHi: 0x0401, gap: [0x0402, 0x0403, 0x0404, 0x0405, 0x0406] }, 'moving the declaration moves every harness byte');
  assert.throws(() => hdLayout({ base: 0x0400, length: 4 }), /outside its reservation/);
});
test('checkHarnessReservation: the full interval of each allocation is tested against the full reservation (boundaries, a start below that reaches in, a start inside)', () => {
  const run = (addr, size) => checkHarnessReservation({ constantsText: synthText([`edge_arr = $${addr.toString(16)} ; @size=${size}`]), symbols: synthSyms([['edge_arr', addr]]) });
  assert.ok(run(0x07bf, 1) > 50, 'one byte just below passes');
  assert.ok(run(0x07d0, 4), 'just above passes');
  assert.ok(run(0x07b0, 16), 'a block ending at $07BF passes');
  assert.throws(() => run(0x07c0, 1), /collides with edge_arr/);
  assert.throws(() => run(0x07cf, 1), /collides with edge_arr/, 'the last reserved byte');
  assert.throws(() => run(0x07b0, 17), /collides with edge_arr/, 'a start below the reservation whose size reaches its first byte (a start-only test passes this)');
  assert.throws(() => run(0x07c8, 1), /collides with edge_arr/, 'a start inside');
  assert.throws(() => checkHarnessReservation({ constantsText: '', symbols: synthSyms([['edge_arr', 0x07c0]]) }), /collides with edge_arr/, 'an allocation with no @size is one byte');
});
test('checkHarnessReservation: an unresolved @size is refused, never read as one byte; an unresolved address is refused; only RAM-named equates are allocations', () => {
  const sym = synthSyms([['wide_arr', 0x07b8]]);
  assert.throws(() => checkHarnessReservation({ constantsText: 'wide_arr = $07B8 ; @size=NO_SUCH_COUNT', symbols: sym }), /@size=NO_SUCH_COUNT did not resolve/, 'a one-byte fallback would pass this and miss a 16-byte array reaching the reservation');
  assert.throws(() => checkHarnessReservation({ constantsText: 'UPPER_ARR = $0700 ; @size=NO_SUCH_COUNT', symbols: synthSyms() }), /did not resolve/, 'every annotation must resolve, whatever its name');
  assert.throws(() => checkHarnessReservation({ constantsText: 'wide_arr = $07B8 ; @size=0', symbols: sym }), /did not resolve to a positive integer/);
  assert.throws(() => checkHarnessReservation({ constantsText: '', symbols: synthSyms([['bad_addr', NaN]]) }), /bad_addr did not resolve to a non-negative integer address/);
  // a symbolic size resolves through the table, and an UPPER_CASE constant at the address is not a RAM allocation
  assert.throws(() => checkHarnessReservation({ constantsText: 'wide_arr = $07B8 ; @size=ARR_LEN', symbols: synthSyms([['wide_arr', 0x07b8], ['ARR_LEN', 16]]) }), /collides with wide_arr \(\$07B8 \+16\)/);
  assert.ok(checkHarnessReservation({ constantsText: '', symbols: synthSyms([['SOME_CONSTANT', 0x07c0]]) }), 'a constant that is not a RAM name (UPPER_CASE) is not an allocation');
  assert.throws(() => checkHarnessReservation({ constantsText: '', symbols: new Map([['only_one', 0x0300]]) }), /read the wrong table/, 'a near-empty table is a wrong read, not a pass');
});
test('the real build: the old $07E0-$07EF reservation collides with pc_eq_atk (the pilot failure), the new $07C0-$07CF one passes, and the HD addresses reach the generated Lua', async () => {
  const b = await buildSplitRing({ cell: cellById('MMC3-V'), gt: 'rpg', placement: 'resident', label: 's1c-unit-reservation' });
  try {
    const constantsText = fs.readFileSync(path.join(b.built.dir, 'build/constants.asm'), 'utf8');
    assert.ok(checkHarnessReservation({ constantsText, symbols: b.built.symbols }) > 50, 'the new reservation passes (buildSplitRing already ran it)');
    assert.throws(() => checkHarnessReservation({ constantsText, symbols: b.built.symbols, reservation: { base: 0x07e0, length: 16 } }), /collides with pc_eq_atk \(\$07E0 \+4\)/, 'the old reservation against the current tree');
    const lua = fs.readFileSync(b.luaPath, 'utf8');
    assert.ok(lua.includes(`hd_pre_lo=${0x07c0}`) && lua.includes(`hd_pre_hi=${0x07c1}`) && lua.includes(`hd_g={${HD.gap.join(',')}}`), 'the rendered Lua carries the new addresses');
    assert.ok(!/2016\b|0x07e0|0x7e0/i.test(lua), 'and none of the old $07E0');
  } finally { b.dispose(); }
});
