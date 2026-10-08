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
import { analyze, judgeSplit, parseSplitOutput, SPLIT_SABOTAGES, harnessPsb } from './ringsplit.mjs';
import { CONTROLS, controlIds, declaredFor, controlBuilds, controlFlags, CELL_IDS, MMC3_CELLS, positiveLabel, controlLabel, REQUIRED_ITEMS } from './s1ccontrols.mjs';
import { validateS1cResult, decodeLabel, recomputeVerdict } from './s1caudit.mjs';
import zlib from 'node:zlib';
import { sha256 } from './ringtree.mjs';
import { auditChain } from './ringhome.mjs';
import { auditProvenance } from './ringprovindex.mjs';
import { s1bRowStatus, buildGate, render } from './s1c_gate.mjs';
import { jobs } from './ringjobs.mjs';
import { matrixScripts } from './ringjobs.mjs';
import { fingerprintGaps, harnessFingerprint } from './ringprov.mjs';
import { longestPath, nmiBound, maxQSum, certifiedMargin, decode, fixedBank, sweep, ENTRY_DELAY_CYCLES, VBLANK_CYCLES, RTI_CYCLES, OAM_DMA_CYCLES } from './ringwcet.mjs';
import { buildNmiRing, wcetFor } from './ringnmi.mjs';
import { makeTree } from './ringtree.mjs';
import { CELLS } from './ringworld.mjs';

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
  const p = parseSplitOutput('F 1 N,100,241,5,36864,0,1,1,0,0,2 S,245,10 U,245,12 W,8000,1,2010,245,10,120 Z,1,1,0,1,1\nDONE ok\nTRIALS planned=2 consumed=2 skipped=0 done=2\n');
  assert.deepEqual(p.events.map((e) => e.t), ['N', 'S', 'U', 'W', 'Z']);
  assert.equal(p.events[3].addr, 0x8000);
  assert.equal(p.done, true);
  assert.deepEqual(p.trials, { planned: 2, consumed: 2, skipped: 0, done: 2 });
});
test('the split sabotage edits still apply to the stock engine source exactly once, and the harness PSB replaces the stock block exactly once', () => {
  const split = fs.readFileSync(path.join(ROOT, 'engine/split.asm'), 'utf8');
  for (const [id, s] of Object.entries(SPLIT_SABOTAGES)) if (s.edit) assert.notEqual(s.edit(split), split, `${id} changed nothing`);
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
      assert.ok((d.outcome === 'caught' && d.mustFail.length > 0) || (d.outcome === 'pass' && d.why), `${id} ring ${ring}`);
    }
    const f = controlFlags(id);
    assert.equal([f.sabotage, f.mutation, f.breakMode, f.split].filter((x) => x).length, 1, `${id}: exactly one runner flag`);
    assert.ok(controlBuilds(id).length >= 1);
  }
  assert.deepEqual(controlIds(8).length, 8);
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
  for (const id of Object.keys(CONTROLS)) if (CONTROLS[id].kind === 'patch') assert.ok(fs.existsSync(path.join(HERE, 'sabotage', `${CONTROLS[id].arg}.patch`)), id);
  assert.equal(declaredFor('close-expect-87', 1).outcome, 'pass');
  assert.equal(declaredFor('close-expect-87', 2).outcome, 'caught');
  assert.equal(declaredFor('nmi-wrap-row-32', 1).outcome, 'pass');
  assert.equal(declaredFor('nmi-wrap-row-32', 2).outcome, 'caught');
});
test('the matrix names every control on every cell it is declared for, each beside its matching positive', () => {
  const names = new Set(jobs('/p', '/l').map((j) => j.name));
  for (const id of Object.keys(CONTROLS)) for (const c of CELL_IDS) {
    if (CONTROLS[id].row === 8 && !MMC3_CELLS.includes(c)) continue;
    for (const [gt, pl] of controlBuilds(id)) {
      assert.ok(names.has(controlLabel(id, c, gt, pl)), `${id} ${c} ${gt} ${pl} has no job`);
      assert.ok(names.has(positiveLabel(CONTROLS[id].row, c, gt, pl)), `${id} ${c} ${gt} ${pl}: its matching positive has no job`);
    }
  }
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
  assert.match(s1bRowStatus(rec(ran), 7, 'mesen').note, /NEEDS A RULING/);
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
const itemsOf = (row, status = () => 'PASS') => REQUIRED_ITEMS[row].map((id) => ({ id, status: status(id), detail: `${id} detail` }));
const tallyOf = (items) => items.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] ?? 0) + 1 }), {});
const H64 = 'a'.repeat(64), H64b = 'b'.repeat(64);
/** A consistent { result, stamp, label } for a row/cell/build (and control): the matching positive of validateS1cResult; each test then corrupts ONE thing. */
function s1cPair({ row = 5, cell = 'MMC3-V', gt = 'action', pl = 'resident', control = null, items = null } = {}) {
  const label = control ? controlLabel(control, cell, gt, pl) : positiveLabel(row, cell, gt, pl);
  const declared = control ? declaredFor(control, cell.endsWith('-V') ? 1 : 2) : { outcome: 'pass-all' };
  const its = items ?? (declared.outcome === 'caught' ? itemsOf(row, (id) => (declared.mustFail.includes(id) ? 'FAIL' : 'PASS')) : itemsOf(row));
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
    const plan = { row: p.result.row, cell: p.result.cell, gameType: p.result.gameType, placement: p.result.placement, control: p.result.control, purpose: `row${p.result.row}-${rowName}`, romSha256: H64, luaSha256: H64b };
    const stamp = {
      schema: 'ring-prov-3', kind: 's1c-run', status: 'built', ...p.stamp, slice: 'S1c', matchingPositive: p.result.control ? positiveLabel(p.result.row, p.result.cell, p.result.gameType, p.result.placement) : null,
      attempt: { startedAt: 'x' }, harness: fp, head: 'h', baseline: 'b', patches: [], nesasm: { sha256: H64 }, host: { kernel: 'k' },
      projectSha256: H64, plan: { ...plan, sha256: sha256(JSON.stringify(plan)) }, build: { streamRing: p.result.cell.endsWith('-V') ? 1 : 2, placement: { requested: p.result.placement, assembled: p.result.placement === 'banked' ? 'switchable' : 'resident' } },
      userSavesUntouched: true, mesenChain: [{ n: 1, spec: plan.purpose, purpose: plan.purpose, pid: 7, status: p.result.mesenStatus, isolated: true, settingsSha256: 'a', exe: '/m', loadedFiles: ['/x'] }],
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
  const b = await buildNmiRing({ cell: CELLS.find((c) => c.id === cellId), gt, placement, label: `unit-wcet-${cellId}-${gt}-${placement}`, tree: makeTree({ ring: true }) });
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
    const b = await buildNmiRing({ cell: CELLS.find((c) => c.id === 'MMC1-V'), gt: 'action', placement: 'resident', breakMode, label: `unit-wcet-${breakMode}`, tree: makeTree({ ring: true }) });
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
