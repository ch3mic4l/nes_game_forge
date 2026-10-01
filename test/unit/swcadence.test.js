// The pure half of the mover-parity cadence check (test/lua/run_sw_cadence.mjs, which drives real Mesen and is run by hand like the other
// test/lua checks): finding and breaking the gate in a built ROM, reading the script's output, and deciding what fails. Each test names the
// wrong implementation it would catch. The Mesen runs themselves, and their four negative controls (eor, beq, ungate, starve), are in
// handoff-next/s1-a1 (cadence-*.log, fix6/cadence-*.log) and docs/reference-engine.md "The streamed entity projection", mover parity gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGate, breakGate, parseCadence, problems, starvationProblems, PINNED_MAX_GAP, FRAME_COUNTER, SCENES } from '../lua/run_sw_cadence.mjs';
import { buildScene, eightSplit, REPO } from '../lua/sw_manifest_scene.mjs';
import { hasNesasm } from '../lib/streamgatecost.js';
import os from 'node:os';

const skip = !hasNesasm && 'nesasm not on PATH';
const FC = 0x1b; // frame_cnt, from engine/constants.asm
const GATE = [0x8a, 0x45, FC, 0x29, 0x01, 0xd0, 0x1e];
const romWith = (...at) => { const r = new Uint8Array(4096).fill(0xff); for (const i of at) r.set(GATE, i); return r; };

test('findGate finds the gate by its seven bytes, and refuses a ROM where it is absent or ambiguous', () => {
  assert.equal(findGate(romWith(100), FC), 100);
  assert.throws(() => findGate(romWith(), FC), /occur 0 times/);
  assert.throws(() => findGate(romWith(100, 200), FC), /occur 2 times/);
  // a different zero-page operand is a different instruction, not the gate
  const other = romWith(100); other[102] = 0x1c;
  assert.throws(() => findGate(other, FC), /occur 0 times/);
});

test('breakGate: no eor, bne -> beq, no gate at all; each changes exactly the bytes it names', () => {
  const orig = romWith(100);
  const eor = romWith(100); breakGate(eor, FC, 'eor');
  assert.deepEqual([...eor.slice(100, 107)], [0x8a, 0xea, 0xea, 0x29, 0x01, 0xd0, 0x1e]);
  const beq = romWith(100); breakGate(beq, FC, 'beq');
  assert.deepEqual([...beq.slice(100, 107)], [0x8a, 0x45, FC, 0x29, 0x01, 0xf0, 0x1e]);
  const un = romWith(100); breakGate(un, FC, 'ungate');
  assert.deepEqual([...un.slice(100, 107)], Array(7).fill(0xea));
  for (const r of [eor, beq, un]) assert.deepEqual([...r.slice(0, 100)], [...orig.slice(0, 100)], 'nothing before the gate moved');
  assert.throws(() => breakGate(romWith(100), FC, 'nope'), /unknown --break mode/);
});

const OUT = [
  'CADENCE bodies=595 visits=3256 dispatches=1628 violations=0 maxGap=2 maxFirst=1 fcJumps=0 fcMaxStep=1 span=7',
  'SLOTS 0:407/203/2 1:407/204/2', 'GAPS 2x1604', 'DONE frames=643'
].join('\n');
const clean = () => ({ name: 'walk', ...parseCadence(OUT) });
// an overrun scene: frame_cnt steps by 2 once, the odd slots wait one body longer
const OVERRUN = OUT.replace('maxGap=2', 'maxGap=3').replace('fcJumps=0 fcMaxStep=1', 'fcJumps=1 fcMaxStep=2').replace('1:407/204/2', '1:407/204/3');
const overrun = () => ({ name: 'overrun-b', ...parseCadence(OVERRUN) });
// the reviewer's case (final review, F1): the gate sees a frame_cnt that never advances, so every odd slot is visited on every body and
// never dispatched; the old script's figures were maxGap 0 for such a slot, no parity violation, and totals that still looked like a half
const LOCKED = OUT.replace('1:407/204/2', '1:407/0/0').replace('dispatches=1628', 'dispatches=1624');

test('parseCadence reads the figures and refuses an unfinished session', () => {
  const r = parseCadence(OUT);
  assert.equal(r.visits, 3256); assert.equal(r.maxGap, 2); assert.equal(r.span, 7); assert.equal(r.done, true);
  assert.equal(parseCadence('no result here'), null);
  assert.equal(parseCadence(OUT.replace('DONE frames=643', '')).done, false);
  assert.deepEqual(parseCadence(OUT + '\nVIOL WRONG_PARITY body=3 slot=0 frame_cnt=3').violations_, ['WRONG_PARITY body=3 slot=0 frame_cnt=3']);
});

test('problems: a clean walk passes; a violation, a gap above the pin, a scene that never reached the gate, or a gate that is not a half each fail', () => {
  assert.deepEqual(problems(clean()), []);
  assert.match(problems({ ...clean(), violations: 1, violations_: ['WRONG_PARITY body=1 slot=0 frame_cnt=1'] })[0], /1 violations/);
  assert.match(problems({ ...clean(), maxGap: PINNED_MAX_GAP.walk + 1 })[0], /exceeds the pinned/);
  assert.match(problems({ ...clean(), visits: 40, dispatches: 20 })[0], /did not exercise the gate/);
  assert.match(problems({ ...clean(), dispatches: 3256 })[0], /not about half/);
  assert.match(problems({ ...clean(), dispatches: 0 })[0], /not about half/);
  assert.deepEqual(problems({ ...clean(), name: 'beyond', maxGap: 99 }), [], 'an unpinned scene is reported, never failed on its gap');
  assert.deepEqual(problems(overrun()), [], 'an overrun scene at its pin, with its frame_cnt step of 2, passes');
});

test('parseCadence reads each slot\'s visits, dispatches and longest wait', () => {
  assert.deepEqual(parseCadence(OUT).slotStats, [{ slot: 0, visits: 407, dispatches: 203, maxGap: 2 }, { slot: 1, visits: 407, dispatches: 204, maxGap: 2 }]);
});

test('starvation: a slot visited on every body and never dispatched fails, by its dispatch count even when its recorded wait is 0, and by its wait when that is recorded', () => {
  const locked = { name: 'walk', ...parseCadence(LOCKED) };
  assert.equal(locked.violations, 0, 'the locked-parity case has no parity violation: that is why it escaped');
  assert.match(starvationProblems(locked).join('|'), /slot 1 was visited 407 times and never dispatched/);
  assert.match(problems(locked).join('|'), /never dispatched/);
  // the same starvation as the fixed script records it: the wait runs from the start of the run to the end of the walk
  const waited = { ...locked, maxGap: 298 };
  assert.match(problems(waited).join('|'), /max wait 298 bodies exceeds the pinned 2/);
  // a slot that was only visited a few times is owed nothing yet
  assert.deepEqual(starvationProblems({ ...clean(), slotStats: [{ slot: 1, visits: 3, dispatches: 0, maxGap: 0 }] }), []);
  assert.equal(starvationProblems({ ...clean(), slotStats: [{ slot: 1, visits: 4, dispatches: 0, maxGap: 0 }] }).length, 1);
  assert.deepEqual(starvationProblems(clean()), []);
});

test('each pinned scene must show its frame_cnt behaviour: the walk steps by 1 only, the overruns step by 2 at least once', () => {
  assert.deepEqual(FRAME_COUNTER, { walk: { maxStep: 1, jumps: 'none' }, 'overrun-b': { maxStep: 2, jumps: 'some' }, 'overrun-p': { maxStep: 2, jumps: 'some' } });
  // an overrun scene that stopped overrunning is a walk by another name
  const stopped = { ...overrun(), fcJumps: 0, fcMaxStep: 1 };
  assert.match(problems(stopped).join('|'), /frame_cnt max step 1, this scene must show 2/);
  assert.match(problems(stopped).join('|'), /no frame_cnt step of 2/);
  // and a walk that began to overrun is no longer the ordinary case
  assert.match(problems({ ...clean(), fcJumps: 1, fcMaxStep: 2 }).join('|'), /frame_cnt max step 2, this scene must show 1/);
  assert.match(problems({ ...clean(), fcJumps: 1 }).join('|'), /1 frame_cnt steps other than 1/);
});

test('the pinned gaps are the observed ones (2026-10-01) and every pinned scene exists', () => {
  assert.deepEqual(PINNED_MAX_GAP, { walk: 2, 'overrun-b': 3, 'overrun-p': 3 });
  assert.deepEqual(Object.keys(SCENES), Object.keys(PINNED_MAX_GAP));
});

test('the script reads frame_cnt at the gate\'s own eor, and hooks the first instruction past the gate', () => {
  const t = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../lua/sw_cadence.lua.template'), 'utf8');
  assert.match(t, /addMemoryCallback\(onEor, emu\.callbackType\.exec, SYM\.mover_parity_gate \+ 1\)/);
  assert.match(t, /addMemoryCallback\(onDispatch, emu\.callbackType\.exec, SYM\.mover_parity_gate_end\)/);
  assert.match(t, /addMemoryCallback\(onBody, emu\.callbackType\.exec, SYM\.main_loop_body_start\)/);
  // the verdict is taken at the eor, not at body start: an NMI between the two moves frame_cnt
  const onEor = /local function onEor\(\)[^]*?\nend/.exec(t)[0];
  assert.match(onEor, /rd\(SYM\.frame_cnt\)/);
});

test('the script times a first dispatch from the start of its run, and the starvation control locks frame_cnt before the gate\'s own read and only when asked', () => {
  const t = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../lua/sw_cadence.lua.template'), 'utf8');
  const onEor = /local function onEor\(\)[^]*?\nend/.exec(t)[0];
  const onDispatch = /local function onDispatch\(\)[^]*?\nend/.exec(t)[0];
  assert.match(onEor, /runStart\[slot\] = body/, 'a run of visits is marked where it starts');
  assert.match(onDispatch, /elseif runStart\[slot\] then[^]*?note\(slot, first\)/, 'a first dispatch is a wait counted from that start');
  assert.match(t, /local LOCK_PARITY = __LOCK_PARITY__/);
  const lock = onEor.indexOf('if LOCK_PARITY then emu.write(SYM.frame_cnt, 0');
  assert.ok(lock > 0 && lock < onEor.indexOf('rd(SYM.frame_cnt)'), 'the lock is written before the sample, and only under LOCK_PARITY');
});

test('the gate\'s bytes are in a built streamed ROM exactly once, at the gate label, and the span is seven bytes', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cadence-unit-'));
  try {
    const built = await buildScene({ root: REPO, gt: 'action', sizes: eightSplit(8), outDir: dir });
    const rom = fs.readFileSync(built.romPath);
    const at = findGate(rom, built.symbols.ram.frame_cnt);
    assert.equal(built.symbols.code.mover_parity_gate_end - built.symbols.code.mover_parity_gate, 7);
    assert.equal(rom[at + 6] > 0, true);
    // the bytes are unique in the file and span seven bytes between the two labels; this does not map file offset to CPU address
    assert.deepEqual([...rom.slice(at, at + 6)], [0x8a, 0x45, built.symbols.ram.frame_cnt, 0x29, 0x01, 0xd0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
