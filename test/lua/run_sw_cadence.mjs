// Mover parity gate dispatch cadence, in Mesen (phase 3a slice S1, option (a1), review 2's acceptance note).
//
//   node test/lua/run_sw_cadence.mjs [--mesen=<path>] [--break=eor|beq|ungate|starve] [--scene=<name>] [--json]
//
// Builds three streamed scenes of the sweep harness (the same scene builder and authored mutations the frame-gate sweep uses), runs
// each under Mesen with test/lua/sw_cadence.lua.template, and asserts, from PC hooks past the gate rather than from frame_cnt at
// update_entities entry, that every slot is dispatched exactly on the bodies where (slot xor frame_cnt) & 1 == 0 and only then.
//   walk       an ordinary walk at the shipped bound (plain 15, P8 wide, 7 blocked chasers, Flash y 212): frame_cnt advances 1 per body
//   overrun-b  the bound-tile curve's n = 16 failing row (31,746 cycles): bodies overrun, so frame_cnt advances 2 between bodies
//   overrun-p  the plain curve's n = 17 failing row (Flash x 241)
//   beyond     (only with --scene=beyond; reported, never pinned) plain n = 24, far past the bound, where bodies overrun for long stretches
// It reports the maximum wait in bodies of one slot -- from the start of a continuous run of visits to its first dispatch, between two
// dispatches, and from the last dispatch (or the run's start, when there was none) to the end of the run or of the walk -- and fails when a
// wait exceeds PINNED_MAX_GAP, when a slot that is visited is never dispatched, or when a scene does not show the frame_cnt behaviour it is
// there for (FRAME_COUNTER: the overruns must see frame_cnt step by 2, the walk must not). The fairness caveat: a slot whose parity is
// locked against frame_cnt advancing by 2 every body would never run.
//
// --break=eor | beq | ungate patches the BUILT ROM's gate (txa / eor <frame_cnt / and #1 / bne) -- no `eor`, `bne` -> `beq`, no gate at all --
// as a negative control: each must fail on a WRONG_PARITY or NOT_DISPATCHED violation, not on a harness error. --break=starve leaves the ROM
// alone and has the script zero frame_cnt just before the gate reads it (parity locked, every odd slot starved: no parity violation at all);
// it must fail on the starvation checks. Exit: 0 every scene passed (or, with --break, every scene FAILED as its control must), 1 otherwise,
// 2 harness error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildScene, eightSplit, REPO } from './sw_manifest_scene.mjs';
import { makeMutate } from './sw_sweep_mutate.mjs';
import { mkJob, ANIM_PRESETS } from './sw_bound_sweep.mjs';
import { MESEN_DEFAULT } from './run_sw_manifest.mjs';
import { EXEC_FLAGS } from './sw_provenance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const held = (...names) => Object.fromEntries(names.map((n) => [n, true]));
// the 'walk' scenario of run_sw_manifest.mjs: 95 frames down, 260 right+down (the column strip), 240 down (the row strip)
const WALK = [{ untilFrame: 95, held: held('down') }, { untilFrame: 355, held: held('right', 'down') }, { untilFrame: 595, held: held('down') }];

// The largest observed gap, in bodies, between two dispatches of one slot, measured 2026-10-01 (see docs/reference-engine.md, "The streamed
// entity projection", mover parity gate). A regression that starves a slot raises it; the check fails above these figures.
export const PINNED_MAX_GAP = { walk: 2, 'overrun-b': 3, 'overrun-p': 3 };
/** What each pinned scene must show of frame_cnt between bodies: the walk advances it by 1 every body, the overruns by 2 at least once. */
export const FRAME_COUNTER = { walk: { maxStep: 1, jumps: 'none' }, 'overrun-b': { maxStep: 2, jumps: 'some' }, 'overrun-p': { maxStep: 2, jumps: 'some' } };
/** A slot visited this often must have been dispatched at least once, or its parity was locked against the counter. */
export const MIN_VISITS_OWING_DISPATCH = 4;

const job = (over) => mkJob({ stage: 'X', gt: 'action', wide: true, anim: 'P8', k: 7, shape: 'even', y: 212, ...over });
export const SCENES = {
  walk: job({ sizes: eightSplit(15) }),
  'overrun-b': job({ sizes: eightSplit(16), bound: true }),
  'overrun-p': job({ sizes: eightSplit(17), tag: 'flashx241', flashX: 241 })
};
export const EXTRA_SCENES = { beyond: job({ sizes: eightSplit(24) }) };

/** The gate in the built ROM: txa / eor <frame_cnt / and #1 / bne rel, found by its bytes (unique), returned as a file offset. */
export function findGate(rom, frameCnt) {
  const pat = [0x8a, 0x45, frameCnt, 0x29, 0x01, 0xd0];
  const hits = [];
  for (let i = 16; i + 7 <= rom.length; i++) if (pat.every((b, j) => rom[i + j] === b)) hits.push(i);
  if (hits.length !== 1) throw new Error(`the gate bytes occur ${hits.length} times in the ROM`);
  return hits[0];
}
export function breakGate(rom, frameCnt, mode) {
  const at = findGate(rom, frameCnt);
  if (mode === 'eor') { rom[at + 1] = 0xea; rom[at + 2] = 0xea; } // txa / nop / nop / and #1 / bne: A is the slot, parity of the slot alone
  else if (mode === 'beq') rom[at + 5] = 0xf0;
  else if (mode === 'ungate') for (let i = 0; i < 7; i++) rom[at + i] = 0xea;
  else throw new Error(`unknown --break mode ${mode}`);
}

const lua = (v) => (typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : Array.isArray(v) ? '{' + v.map(lua).join(',') + '}' : '{' + Object.entries(v).map(([k, x]) => `[${JSON.stringify(k)}]=${lua(x)}`).join(',') + '}');

export function parseCadence(text) {
  const m = /^CADENCE (.*)$/m.exec(text);
  if (!m) return null;
  const kv = Object.fromEntries([...m[1].matchAll(/(\w+)=(-?\d+)/g)].map((x) => [x[1], Number(x[2])]));
  const slots = /^SLOTS (.*)$/m.exec(text)?.[1] ?? '';
  const slotStats = [...slots.matchAll(/(\d+):(\d+)\/(\d+)\/(\d+)/g)].map((x) => ({ slot: Number(x[1]), visits: Number(x[2]), dispatches: Number(x[3]), maxGap: Number(x[4]) }));
  return { ...kv, slots, slotStats, gaps: /^GAPS (.*)$/m.exec(text)?.[1] ?? '', violations_: [...text.matchAll(/^VIOL (.*)$/gm)].map((x) => x[1]), done: /^DONE /m.test(text) };
}

export async function runScene(name, { mesen = MESEN_DEFAULT, breakMode = null } = {}) {
  if (breakMode && !['eor', 'beq', 'ungate', 'starve'].includes(breakMode)) throw new Error(`unknown --break mode ${breakMode}`);
  const j = SCENES[name] ?? EXTRA_SCENES[name];
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-cadence-'));
  try {
    const cfg = structuredClone(j.cfg);
    const built = await buildScene({ root: REPO, gt: j.gt, sizes: j.sizes, wide: !!j.wide, anim: ANIM_PRESETS[j.anim], flashAt: [j.flashX ?? 242, j.y], ...(j.gridH ? { gridH: j.gridH } : {}), mutate: makeMutate(cfg), outDir: dir });
    const { code, ram } = built.symbols;
    for (const n of ['main_loop_body_start', 'mover_parity_gate', 'mover_parity_gate_end']) if (!Number.isFinite(code[n])) throw new Error(`${n} is not a symbol of this build`);
    for (const n of ['frame_cnt', 'game_state', 'ST_GAMEPLAY']) if (!Number.isFinite(ram[n])) throw new Error(`${n} is not an engine equate of this build`);
    if (code.mover_parity_gate_end - code.mover_parity_gate !== 7) throw new Error('not a streamed build: the gate is not 7 bytes');
    if (breakMode && breakMode !== 'starve') { const rom = fs.readFileSync(built.romPath); breakGate(rom, ram.frame_cnt, breakMode); fs.writeFileSync(built.romPath, rom); }
    const sym = { main_loop_body_start: code.main_loop_body_start, mover_parity_gate: code.mover_parity_gate, mover_parity_gate_end: code.mover_parity_gate_end, frame_cnt: ram.frame_cnt, game_state: ram.game_state, ST_GAMEPLAY: ram.ST_GAMEPLAY };
    let t = fs.readFileSync(path.join(HERE, 'sw_cadence.lua.template'), 'utf8');
    for (const [token, value] of [['__SYM__', lua(sym)], ['__FRAMES__', lua(WALK)], ['__LOCK_PARITY__', breakMode === 'starve' ? 'true' : 'false']]) { if (t.split(token).length !== 2) throw new Error(`expected one ${token}`); t = t.split(token).join(value); }
    const luaPath = path.join(dir, 'cadence.lua');
    fs.writeFileSync(luaPath, t);
    const r = await new Promise((resolve, reject) => {
      const child = spawn(mesen, [...EXEC_FLAGS.args, luaPath, built.romPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout }); });
    });
    const res = parseCadence(r.stdout);
    if (!res || !res.done || r.status !== 0) throw new Error(`${name}: Mesen did not finish (status ${r.status}): ${r.stdout.slice(-300)}`);
    return { name, id: j.id, ...res };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** The starvation half: a wait above the pin, or a slot that was visited and never dispatched. The part --break=starve must fail on. */
export function starvationProblems(r) {
  const out = [];
  if (r.name in PINNED_MAX_GAP && r.maxGap > PINNED_MAX_GAP[r.name]) out.push(`max wait ${r.maxGap} bodies exceeds the pinned ${PINNED_MAX_GAP[r.name]}`);
  for (const s of r.slotStats ?? []) if (s.visits >= MIN_VISITS_OWING_DISPATCH && s.dispatches === 0) out.push(`slot ${s.slot} was visited ${s.visits} times and never dispatched`);
  return out;
}

/** What a scene's result must satisfy: no violation, every slot visited and dispatched about half the time, the fairness figure pinned, the scene's frame_cnt behaviour. */
export function problems(r) {
  const out = [];
  if (r.violations > 0) out.push(`${r.violations} violations: ${r.violations_.join('; ')}`);
  if (r.visits < 100) out.push(`only ${r.visits} gate visits: the scene did not exercise the gate`);
  if (!(r.dispatches > 0.3 * r.visits && r.dispatches < 0.7 * r.visits)) out.push(`${r.dispatches} dispatches of ${r.visits} visits: not about half`);
  out.push(...starvationProblems(r));
  const fc = FRAME_COUNTER[r.name];
  if (fc) {
    if (r.fcMaxStep !== fc.maxStep) out.push(`frame_cnt max step ${r.fcMaxStep}, this scene must show ${fc.maxStep}: it no longer is the case it stands for`);
    if (fc.jumps === 'none' && r.fcJumps !== 0) out.push(`${r.fcJumps} frame_cnt steps other than 1, this scene must show none`);
    if (fc.jumps === 'some' && !(r.fcJumps >= 1)) out.push('no frame_cnt step of 2: this scene no longer overruns');
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, v] = s.replace(/^--/, '').split('='); return [k, v ?? true]; }));
  const breakMode = a.break ?? null;
  let bad = 0;
  try {
    const names = a.scene ? [a.scene] : Object.keys(SCENES);
    const results = await Promise.all(names.map((n) => runScene(n, { mesen: a.mesen ?? MESEN_DEFAULT, breakMode })));
    for (const r of results) {
      const p = problems(r);
      console.log(`${r.name.padEnd(10)} bodies ${r.bodies}  visits ${r.visits}  dispatches ${r.dispatches}  violations ${r.violations}  max wait ${r.maxGap} (pin ${PINNED_MAX_GAP[r.name] ?? 'none'}, first dispatch ${r.maxFirst})  frame_cnt jumps ${r.fcJumps} (max step ${r.fcMaxStep})  ${p.length ? 'FAIL: ' + p.join(' | ') : 'ok'}`);
      console.log(`           slots visit/dispatch/maxgap ${r.slots}   gap histogram ${r.gaps}`);
      if (a.json) console.log(JSON.stringify(r));
      if (breakMode === 'starve') { if (starvationProblems(r).length === 0) bad++; } else if (breakMode) { if (r.violations === 0) bad++; } else if (p.length) bad++;
    }
    if (breakMode) console.log(bad === 0 ? `negative control ${breakMode}: every scene failed on ${breakMode === 'starve' ? 'the starvation checks' : 'violations'}, as it must` : `negative control ${breakMode}: ${bad} scene(s) did NOT fail`);
  } catch (e) { console.error(String(e.stack ?? e)); process.exit(2); }
  process.exit(bad ? 1 : 0);
}
