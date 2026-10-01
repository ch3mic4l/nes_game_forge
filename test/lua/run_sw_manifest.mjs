// Driver for the streamed-world frame-gate manifest: builds a scene ROM (test/lua/sw_manifest_scene.mjs),
// instantiates test/lua/sw_manifest.lua.template with that ROM's own symbols, runs it under Mesen's test
// runner and returns the parsed PHASE/BIND/CLASS lines. Library use: `runManifest(opts)`; CLI use prints
// the result as JSON:
//   node test/lua/run_sw_manifest.mjs --gt=action --sizes=2,2,2,2,2,2,2,2 [--wide] [--root=<repo>]
//        [--flashAt=x,y] [--scenario=walk|say|stand|stress|m9f|name|ord] [--mesen=<path>] [--out=<dir>]
// `mutate(project, {createMap, createScreen})` (test/lua/sw_sweep_mutate.mjs) is an authored change to the scene's project, applied before
// it is normalized and validated. The result also carries `prov` (the engine, harness, generator and Mesen hashes of this process, and the
// sha-256 of this job's normalized project and ROM: test/lua/sw_provenance.mjs), `frames` (frames the Mesen session ran) and `timing`
// ({buildMs, mesenMs}). Provenance is taken BEFORE the build and checked again after the session (and against `expect`, the state a stage started
// with); a change throws SourceChangedError. `cache` (a MeasurementCache) + `jobId` turn a job whose measurement key matches an earlier one into a
// reuse (`reuse: {of, key}`, no Mesen session); `prepareOnly` stops after the build and returns the key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildScene, REPO } from './sw_manifest_scene.mjs';
import { processProvenance, projectHash, romHash, assertSameSources, measurementKey, sha256, EXEC_FLAGS } from './sw_provenance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MESEN_DEFAULT = process.env.MESEN || '/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen';
export const GATE = 29780;

const held = (...names) => Object.fromEntries(names.map((n) => [n, true]));
// The scripted runs. `collect` phases are measured; `mode` pokes RAM at the top of every body in that phase.
export const SCENARIOS = {
  // The reference busy frame: eight chasers, a Right walk into the eight-actor target (column strip + the
  // touch Shake/Flash/Sfx), then a Down walk into the second (row strip). On an RPG the walk ends in the
  // contact battle, so the standing rows below are a separate scene.
  walk: [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'pre', frames: 95, held: held('down') },
    { name: 'walkR', frames: 260, held: held('right', 'down'), collect: true },
    { name: 'walkD', frames: 240, held: held('down'), collect: true }
  ],
  // The standing rows, on the eight-actor target with patrolling (non-contact) actors.
  stand: [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'settle', frames: 40 },
    { name: 'M1', frames: 40, collect: true },
    { name: 'M3', frames: 40, collect: true, mode: 'm3' },
    { name: 'M6', frames: 60, collect: true, mode: 'flash', period: 12 },
    { name: 'M4a', frames: 40, collect: true, mode: 'menu', restore: true },
    { name: 'M4b', frames: 40, collect: true, mode: 'dialog', restore: true }
  ],
  // M9 without Flip: the touch actor's event is Flash + Say, so the box opens on the frame the column strip
  // is still draining; the queue (flash palette packet + the box's rows) exceeds 35 bytes and owns the vblank.
  say: [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'pre', frames: 95, held: held('down') },
    { name: 'walkR', frames: 260, held: held('right', 'down'), collect: true },
    { name: 'sayD', frames: 400, held: held('down'), collect: true }
  ],
  // SYNTHETIC (a RAM poke re-arms flash_left; no authored schedule has been observed to do this): the walk
  // again, with a Flash forced every 7 frames while a strip is in flight.
  stress: [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'pre', frames: 95, held: held('down') },
    { name: 'walkR', frames: 260, held: held('right', 'down'), collect: true },
    { name: 'stressD', frames: 240, held: held('down'), collect: true, mode: 'flashstress', period: 7, trace: true }
  ],
  // SYNTHETIC: the p11/o7 RAM-rearm row -- an 800-frame Down walk with flash_left re-armed every 11 frames
  // (offset 7) while a strip is in flight. Measured to overrun on the action frame from n=8 (1-2 frames),
  // with the parent overrunning more; reported, never used to derive STREAM_TILE_BOUND.
  stressP11: [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'pre', frames: 95, held: held('down') },
    { name: 'walkR', frames: 260, held: held('right', 'down'), collect: true },
    { name: 'stressD', frames: 800, held: held('down'), collect: true, mode: 'flashstress', period: 11, offset: 7, trace: true }
  ],
  // SYNTHETIC: one forced Flash (period 1000, offset 139) while a strip is in flight -- the single-coincidence row.
  stressSingle: [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'pre', frames: 95, held: held('down') },
    { name: 'walkR', frames: 260, held: held('right', 'down'), collect: true },
    { name: 'stressD', frames: 240, held: held('down'), collect: true, mode: 'flashstress', period: 1000, offset: 139, trace: true }
  ],
  // M9 forced (SYNTHETIC): frozen dialogue frames with a strip still in flight and an 81-byte queue.
  m9f: [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'pre', frames: 95, held: held('down') },
    { name: 'walkR', frames: 260, held: held('right', 'down'), collect: true },
    { name: 'm9fD', frames: 200, held: held('down'), collect: true, mode: 'm9f' }
  ],
  name: [
    { name: 'boot', waitFor: 'naming' },
    { name: 'M4c', frames: 60, collect: true }
  ],
  ord: [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'settle', frames: 30 },
    { name: 'M0', frames: 120, collect: true }
  ]
};

const lua = (v) => {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '{' + v.map(lua).join(',') + '}';
  return '{' + Object.entries(v).map(([k, x]) => `[${JSON.stringify(k)}]=${lua(x)}`).join(',') + '}';
};

const CODE_SYMS = ['main_loop_body_start', 'main_loop_ready', 'nmi', 'nmi_rti', 'wait_vblank_loop', 'draw_entities', 'sw_frame_camera_window', 'sw_position_jump_guard'];
const RAM_SYMS = ['vram_len', 'st_active', 'st_cur', 'game_state', 'ST_MENU', 'ST_DIALOG', 'ST_GAMEPLAY', 'inv_count', 'inv_sel',
  'inv_items', 'box_state', 'box_row', 'BOX_NAMEENTRY', 'BOX_TEXT_ROWS', 'talk_ent', 'flash_left', 'FLASH_ARM_VALUE', 'oam_idx',
  'sw_col', 'sw_row', 'ent_active', 'ent_x', 'ent_y', 'map_is_streamed', 'sw_cam_origin_x_lo', 'sw_cam_origin_x_hi',
  'sw_cam_origin_y_lo', 'sw_cam_origin_y_hi', 'player_x', 'player_y', 'vram_buf', 'win_row_screen', 'win_row_local',
  'win_col_screen', 'win_col_local', 'st_len', 'FLASH_PENDING'];

export function parseOutput(text) {
  const kv = (s) => Object.fromEntries([...s.matchAll(/(\w+)=(-?\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const phases = {};
  const trace = {};
  const marksOut = {};
  for (const line of text.split('\n')) {
    let m;
    if ((m = /^PHASE (\S+) (.*)$/.exec(line))) phases[m[1]] = { ...kv(m[2]), classes: {} };
    else if ((m = /^BIND (\S+) (.*)$/.exec(line))) phases[m[1]].bind = kv(m[2]);
    else if ((m = /^CLASS (\S+) (\S+) (.*)$/.exec(line))) phases[m[1]].classes[m[2]] = kv(m[3]);
    else if ((m = /^MK (\S+) f=(\d+) (.*)$/.exec(line))) (marksOut[m[1]] ??= []).push({ f: Number(m[2]), line: m[3] });
    else if ((m = /^TR (\S+) (.*)$/.exec(line))) (trace[m[1]] ??= []).push({ ...kv(m[2].replace(/st=(\d+)\/(\d+)/, 'st0=$1 st1=$2')) });
  }
  return { phases, trace, marks: marksOut, done: /^DONE /m.test(text), timeout: /^TIMEOUT/m.test(text) };
}

export async function runManifest({
  root = REPO, gt = 'action', sizes = null, wide = false, scenario = 'walk', phases = null, beh = null,
  mesen = MESEN_DEFAULT, outDir = null, gridH, nosfx, flashAt = null, flashBeh, flashCmds, gauntlet = null, anim = null, marks = [], mutate = null,
  expect = null, cache = null, jobId = null, prepareOnly = false, waitInflight = true
}) {
  const dir = outDir ?? await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-manifest-run-'));
  const t0 = Date.now();
  let slot = null;
  try {
    // PROVENANCE IS TAKEN BEFORE ANYTHING IS MEASURED, from the sources as they are now, and must be what the stage started with (`expect`)
    const before = processProvenance(root, mesen);
    if (expect) assertSameSources(expect, before, 'before this job was built');
    const nameStart = scenario === 'name';
    const standStart = scenario === 'stand';
    const ordinaryStart = scenario === 'ord';
    const sayOnFlash = scenario === 'say';
    const built = await buildScene({ root, gt, sizes, wide, beh: beh ?? (standStart ? 'patroller' : null), nameStart, standStart, ordinaryStart, sayOnFlash, outDir: dir, flashAt, gauntlet, anim, mutate, ...(flashBeh ? { flashBeh } : {}), ...(flashCmds ? { flashCmds } : {}), ...(gridH ? { gridH } : {}), ...(nosfx !== undefined ? { nosfx } : {}) });
    const sym = { ...Object.fromEntries(RAM_SYMS.filter((n) => n in built.symbols.ram).map((n) => [n, built.symbols.ram[n]])) };
    for (const n of [...CODE_SYMS, ...marks]) {
      if (!Number.isFinite(built.symbols.code[n])) throw new Error(`${n} is not a symbol of this build`);
      sym[n] = built.symbols.code[n];
    }
    let t = await fs.promises.readFile(path.join(HERE, 'sw_manifest.lua.template'), 'utf8');
    const script = phases ?? SCENARIOS[scenario];
    for (const [token, value] of [['__SYM__', lua(sym)], ['__MARKS__', lua(marks)], ['__PHASES__', lua(script)], ['__ICON__', String(Math.max(0, built.symbols.icon))]]) {
      if (t.split(token).length !== 2) throw new Error(`expected one ${token}`);
      t = t.split(token).join(value);
    }
    const tBuilt = Date.now();
    const luaPath = path.join(dir, 'manifest.lua');
    await fs.promises.writeFile(luaPath, t);
    const own = { project: projectHash(built.project), rom: romHash(built.romPath) };
    const key = measurementKey({ project: own.project, rom: own.rom, lua: sha256(t), prov: before });
    if (prepareOnly) return { prov: { ...before, ...own }, cacheKey: key, timing: { buildMs: tBuilt - t0, mesenMs: 0 } };
    if (cache) {
      slot = await cache.acquire(key, { wait: waitInflight });
      if (slot.pending) { slot = null; return { pending: true, cacheKey: key }; }
      if (slot.hit) {
        // DUPLICATE: the same project, ROM, rendered script and source state was measured by `slot.value.jobId`; its measurement is this job's
        const { jobId: of, measurement } = slot.value;
        slot = null;
        return { ...structuredClone(measurement), prov: { ...before, ...own }, cacheKey: key, reuse: { of, key }, timing: { buildMs: tBuilt - t0, mesenMs: 0 } };
      }
    }
    // A spawn failure (no Mesen at that path) is an 'error' event, not a 'close': without a listener Node throws it
    // unhandled, bypassing the `finally` below and leaking the scene folder. Reject instead, so `finally` runs.
    const r = await new Promise((resolve, reject) => {
      const child = spawn(mesen, [...EXEC_FLAGS.args, luaPath, built.romPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      const timer = setTimeout(() => child.kill('SIGKILL'), EXEC_FLAGS.killMs);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    });
    const parsed = parseOutput(r.stdout);
    // ... and the sources must still be what they were when it was taken
    assertSameSources(before, processProvenance(root, mesen), 'during this job');
    const frames = Number(/^DONE frames=(\d+)/m.exec(r.stdout)?.[1] ?? NaN);
    const measurement = { ...parsed, status: r.status, symbols: built.symbols, stderr: r.stderr.slice(0, 400), frames };
    // only a COMPLETE, successful session is a measurement others may reuse
    if (slot) { if (measurement.done && !measurement.timeout && measurement.status === 0) slot.publish({ jobId, measurement }); else slot.fail(); slot = null; }
    return { ...measurement, prov: { ...before, ...own }, cacheKey: key, timing: { buildMs: tBuilt - t0, mesenMs: Date.now() - tBuilt } };
  } catch (e) {
    if (slot) slot.fail();
    throw e;
  } finally {
    if (!outDir) await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, v] = s.replace(/^--/, '').split('='); return [k, v ?? true]; }));
  const res = await runManifest({
    gt: a.gt ?? 'action', flashAt: a.flashAt ? a.flashAt.split(',').map(Number) : null, sizes: a.sizes ? a.sizes.split(',').map(Number) : null, wide: Boolean(a.wide), root: a.root ?? REPO,
    scenario: a.scenario ?? 'walk', mesen: a.mesen ?? MESEN_DEFAULT, outDir: a.out ?? null, beh: a.beh ?? null
  });
  const { symbols, ...rest } = res;
  console.log(JSON.stringify(rest, null, 1));
}
