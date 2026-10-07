// Driver for the streamed-world frame-gate manifest: builds a scene ROM (test/lua/sw_manifest_scene.mjs),
// instantiates test/lua/sw_manifest.lua.template with that ROM's own symbols, runs it under Mesen's test
// runner and returns the parsed PHASE/BIND/CLASS lines. Library use: `runManifest(opts)`; CLI use prints
// the result as JSON:
//   node test/lua/run_sw_manifest.mjs --gt=action --sizes=2,2,2,2,2,2,2,2 [--wide] [--root=<repo>]
//        [--flashAt=x,y] [--scenario=walk|say|stand|stress|m9f|name|ord] [--mesen=<path>] [--out=<dir>]
//        [--ring=MMC1-V|MMC1-H|MMC3-V|MMC3-H|U512-V|U512-H [--ringN=<screens>]]   (phase 3b S1b: the ring-cartridge scene, through the gate's patched tree)
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

// The idle-callback registration, as a substitution value for __IDLE_REG__ in the template. The default is byte-for-byte the line the template
// carried before the contact endpoint existed, so every non-R rendered script is unchanged.
export const IDLE_REG = 'emu.addMemoryCallback(onIdle, emu.callbackType.exec, SYM.wait_vblank_loop)';
// The R-only CONTACT ENDPOINT (opt-in: runManifest({ contactEndpoint: true })). The RPG walk ends in the contact battle, but phases advance on
// emulator frames and `finish()` prints DONE whatever the mainline is doing, so a mainline hung inside the contact body (the slot-5 battle_begin
// bug) still produced 177 completed bodies and a clean DONE. The wrapper runs the complete `onIdle` measurement of the body that just finished,
// and only then ends the TERMINAL collected phase if that body began in ST_GAMEPLAY and has now entered ST_BATTLE: the contact body, tail
// included, is a measured body (an over-gate one counts in gateFail like any other), and the run finishes through the normal summary path with
// a `CONTACT` line. Never at battle_begin, main_loop_ready or a frame boundary: only at the idle poll, after onIdle.
export const CONTACT_IDLE_REG = `local contactPhase = PHASES[#PHASES]
emu.addMemoryCallback(function()
  local began, ph, gs0 = inBody, bodyPhase, bodyGs
  onIdle()
  if began and ph == contactPhase and ph.collect and gs0 == SYM.ST_GAMEPLAY and rd(SYM.game_state) == SYM.ST_BATTLE then
    print(string.format("CONTACT frame=%d phase=%s", frame, ph.name))
    finish()
  end
end, emu.callbackType.exec, SYM.wait_vblank_loop)`;

/**
 * A RING cell's version of a scripted run (phase 3b S1b): the same phases with the held buttons on the ring's own axis. A vertical-mirroring ring
 * (ring 1) scrolls horizontally and its y axis is dead, so only `right` is held; a horizontal-mirroring ring (ring 2) holds only `down`. The phases,
 * their lengths and their measured/unmeasured roles are unchanged, so a ring's rows line up with the four-screen walk's.
 */
export function ringScript(script, ring) {
  const keep = ring.ring === 1 ? 'right' : 'down';
  const drop = ring.ring === 1 ? 'down' : 'right';
  return script.map((ph) => {
    if (!ph.held) return ph;
    const held = Object.fromEntries(Object.entries(ph.held).filter(([k]) => k !== drop));
    // a phase that only held the dead axis (the four-screen walk's `pre`) keeps walking along the ring
    return { ...ph, held: Object.keys(held).length === 0 && ph.held[drop] ? { [keep]: true } : held };
  });
}

const posInt = (v) => Number.isSafeInteger(v) && v > 0;
/**
 * THE validity of a contact-completed endpoint, for a fresh run (runManifest) and for every persisted record (test/lua/sw_bound_sweep.mjs isBad): `m` is
 * { contact, frames, phases }, `terminal` the name of the script's terminal collected phase. The marker is exactly { frame, phase }; its phase IS the
 * terminal collected phase (the wrapper only ever ends that one); its frame is a positive integer and IS the frame the run ended on (finish() prints
 * DONE on the frame it prints CONTACT); the run's frame count and the terminal phase's body count are positive integers. Returns the reasons it is not valid.
 */
export function contactEndpointProblems({ contact, frames, phases } = {}, terminal) {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return ['the contact-completed marker is absent or not an object'];
  const p = [];
  if (Object.keys(contact).sort().join() !== 'frame,phase') p.push('the marker is not exactly {frame, phase}');
  if (contact.phase !== terminal) p.push(`the marker's phase ${JSON.stringify(contact.phase)} is not the terminal collected phase ${JSON.stringify(terminal)}`);
  if (!posInt(contact.frame)) p.push('the marker frame is not a positive integer');
  if (!posInt(frames)) p.push('the run frame count is not a positive integer');
  else if (posInt(contact.frame) && contact.frame !== frames) p.push(`the marker frame ${contact.frame} is not the frame the run ended on (${frames})`);
  if (!posInt(phases?.[terminal]?.n)) p.push('the terminal phase recorded no bodies');
  return p;
}

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
  let contact = null;
  const counters = {};
  const events = {};
  for (const line of text.split('\n')) {
    let m;
    if ((m = /^PHASE (\S+) (.*)$/.exec(line))) phases[m[1]] = { ...kv(m[2]), classes: {} };
    else if ((m = /^BIND (\S+) (.*)$/.exec(line))) phases[m[1]].bind = kv(m[2]);
    else if ((m = /^CLASS (\S+) (\S+) (.*)$/.exec(line))) phases[m[1]].classes[m[2]] = kv(m[3]);
    else if ((m = /^MK (\S+) f=(\d+) (.*)$/.exec(line))) (marksOut[m[1]] ??= []).push({ f: Number(m[2]), line: m[3] });
    else if ((m = /^CN (\S+) (.*)$/.exec(line))) (counters[m[1]] ??= []).push(kv(m[2]));
    else if ((m = /^EV (\S+) f=(\d+) (\S+)$/.exec(line))) (events[m[1]] ??= []).push({ f: Number(m[2]), ev: m[3].split(';') });
    else if ((m = /^CONTACT frame=(\d+) phase=(\S+)/.exec(line))) contact = { frame: Number(m[1]), phase: m[2] };
    else if ((m = /^TR (\S+) (.*)$/.exec(line))) (trace[m[1]] ??= []).push({ ...kv(m[2].replace(/st=(\d+)\/(\d+)/, 'st0=$1 st1=$2')) });
  }
  return { phases, trace, marks: marksOut, ...(Object.keys(counters).length ? { counters } : {}), ...(Object.keys(events).length ? { events } : {}), ...(contact ? { contact } : {}), done: /^DONE /m.test(text), timeout: /^TIMEOUT/m.test(text) };
}

/** A ring gate run may only spawn Mesen with an environment whose HOME is a private directory, never the user's own (which holds ~/.config/Mesen2/Saves). */
export function requirePrivateHome(env) {
  const h = env?.HOME;
  if (!h) throw new Error('a ring Mesen run needs a private environment (mesenEnv with its own HOME): refusing to spawn Mesen under the parent HOME');
  if (path.resolve(h) === path.resolve(os.homedir())) throw new Error(`a ring Mesen run's HOME is the user's own (${h}): refusing to spawn Mesen there`);
}

export async function runManifest({
  root = REPO, gt = 'action', sizes = null, wide = false, scenario = 'walk', phases = null, beh = null,
  mesen = MESEN_DEFAULT, outDir = null, gridH, nosfx, flashAt = null, flashBeh, flashCmds, gauntlet = null, anim = null, marks = [], mutate = null, contactEndpoint = false,
  expect = null, cache = null, jobId = null, prepareOnly = false, waitInflight = true,
  // phase 3b S1b: `ring` = { mapper, mirroring, ring: 1|2, n } builds the scene on a ring cartridge (sw_manifest_scene.mjs) and `root` is the patched tree;
  // `extraLua` is appended after the idle registration (it sees every file-level local of the template: the ring gate's counters use it), `extraSyms` /
  // `extraRam` are further code / RAM symbols it binds. All three absent, the rendered script and the build are byte-for-byte what they were.
  ring = null, extraLua = '', extraSyms = [], extraRam = [], start = null,
  // Phase 3b S1b: the Mesen process's environment (a private HOME, so no run touches the user's own ~/.config/Mesen2) and a hook handed the spawned child (its pid and the files it maps are stamped)
  // `allowParentHome` is the human CLI's explicit opt-in to the user's own HOME; a RING run (the gate's) without a private HOME is refused before anything is built (finding 3, round 1:
  // a calibration run once escaped the isolation)
  mesenEnv = null, onMesenChild = null, allowParentHome = false
}) {
  if (ring && !prepareOnly && !allowParentHome) requirePrivateHome(mesenEnv);
  if (contactEndpoint && !(phases ?? SCENARIOS[scenario])?.at(-1)?.collect) throw new Error('the contact endpoint ends the TERMINAL phase, which must be a collected one');
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
    const built = await buildScene({ root, gt, sizes, wide, beh: beh ?? (standStart ? 'patroller' : null), nameStart, standStart, ordinaryStart, sayOnFlash, outDir: dir, flashAt, gauntlet, anim, mutate, ...(ring ? { ring } : {}), ...(start ? { start } : {}), ...(flashBeh ? { flashBeh } : {}), ...(flashCmds ? { flashCmds } : {}), ...(gridH ? { gridH } : {}), ...(nosfx !== undefined ? { nosfx } : {}) });
    const sym = { ...Object.fromEntries(RAM_SYMS.filter((n) => n in built.symbols.ram).map((n) => [n, built.symbols.ram[n]])) };
    // the contact endpoint's own binding: ONLY an opt-in run carries ST_BATTLE, so every other rendered script's symbol table is unchanged
    if (contactEndpoint) {
      if (!('ST_BATTLE' in built.symbols.ram)) throw new Error('the contact endpoint needs ST_BATTLE, which this build lacks (an RPG-only state)');
      sym.ST_BATTLE = built.symbols.ram.ST_BATTLE;
    }
    for (const n of extraRam) {
      if (!(n in built.symbols.ram)) throw new Error(`${n} is not a RAM symbol of this build`);
      sym[n] = built.symbols.ram[n];
    }
    for (const n of [...CODE_SYMS, ...marks]) {
      if (!Number.isFinite(built.symbols.code[n])) throw new Error(`${n} is not a symbol of this build`);
      sym[n] = built.symbols.code[n];
    }
    // an extra symbol named '?label' is OPTIONAL (the counters bind labels some game types do not assemble, e.g. the action-only knockback step);
    // the script sees an absent one as nil, and the result's `boundSyms` says which were bound
    const boundSyms = [];
    for (const n0 of extraSyms) {
      const optional = n0.startsWith('?');
      const n = optional ? n0.slice(1) : n0;
      if (!Number.isFinite(built.symbols.code[n])) { if (optional) continue; throw new Error(`${n} is not a symbol of this build`); }
      sym[n] = built.symbols.code[n];
      boundSyms.push(n);
    }
    let t = await fs.promises.readFile(path.join(HERE, 'sw_manifest.lua.template'), 'utf8');
    const script = ring ? ringScript(phases ?? SCENARIOS[scenario], ring) : (phases ?? SCENARIOS[scenario]);
    for (const [token, value] of [['__SYM__', lua(sym)], ['__MARKS__', lua(marks)], ['__PHASES__', lua(script)], ['__ICON__', String(Math.max(0, built.symbols.icon))], ['__IDLE_REG__', (contactEndpoint ? CONTACT_IDLE_REG : IDLE_REG) + (extraLua ? '\n' + extraLua : '')]]) {
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
      const child = spawn(mesen, [...EXEC_FLAGS.args, luaPath, built.romPath], { stdio: ['ignore', 'pipe', 'pipe'], ...(mesenEnv ? { env: mesenEnv } : {}) });
      if (onMesenChild) onMesenChild(child);
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
    const measurement = { ...parsed, status: r.status, symbols: built.symbols, stderr: r.stderr.slice(0, 400), frames, ...(extraSyms.length ? { boundSyms } : {}), ...(ring ? { script, sceneProject: built.project, sceneScreens: built.project.maps[0].screens.map((sc) => (sc.entities ?? []).map((e) => ({ actor: e.actorId, x: e.x, y: e.y }))) } : {}) };
    // LIVENESS: a contact-endpoint run that reached its frame limit without the CONTACT marker measured a prefix of a run that never completed
    // its contact body (a hang in the mainline looks exactly like this: the frames go on, DONE prints). It is an operational failure, never a result.
    if (contactEndpoint) {
      const ph = Object.values(parsed.phases).at(-1);
      if (!parsed.contact) throw new Error(`the contact endpoint was not reached (no completed gameplay body entered ST_BATTLE in the terminal phase; ${frames} frames, ${ph?.n ?? 0} bodies in the last phase): the run is not a measurement`);
      const bad = contactEndpointProblems({ contact: parsed.contact, frames, phases: parsed.phases }, script.at(-1).name); // the SAME validator every persisted record is held to
      if (bad.length) throw new Error(`the contact endpoint is not a valid completed endpoint (${bad.join('; ')}): the run is not a measurement`);
    }
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
  // --ring=<MMC1-V|MMC1-H|MMC3-V|MMC3-H|U512-V|U512-H> [--ringN=<screens>]: build the scene on that ring cell through the gate's patched tree
  // (test/lua/ring_gate/ringcli.mjs; imported only when the flag is given). Absent, nothing below differs from the four-screen CLI.
  let ringArg = {}; let cleanup = null;
  if (a.ring !== undefined) {
    if (a.ring === true) { console.error('--ring needs a cell id (MMC1-V, MMC1-H, MMC3-V, MMC3-H, U512-V, U512-H)'); process.exit(2); }
    if (a.root !== undefined) { console.error('--ring builds its own patched tree: it cannot be combined with --root'); process.exit(2); }
    const { prepareRing } = await import('./ring_gate/ringcli.mjs');
    const sizes0 = a.sizes ? a.sizes.split(',').map(Number) : null;
    const r = await prepareRing({ cellId: a.ring, gt: a.gt ?? 'action', n: a.ringN ? Number(a.ringN) : null, sizes: sizes0, wide: Boolean(a.wide) });
    ringArg = { ring: r.ring, root: r.tree.root }; cleanup = () => r.dispose();
  }
  try {
    const res = await runManifest({
      gt: a.gt ?? 'action', flashAt: a.flashAt ? a.flashAt.split(',').map(Number) : null, sizes: a.sizes ? a.sizes.split(',').map(Number) : null, wide: Boolean(a.wide), root: a.root ?? REPO,
      scenario: a.scenario ?? 'walk', mesen: a.mesen ?? MESEN_DEFAULT, outDir: a.out ?? null, beh: a.beh ?? null, ...ringArg, ...(a.ring !== undefined ? { allowParentHome: true } : {})
    });
    const { symbols, ...rest } = res;
    console.log(JSON.stringify(rest, null, 1));
  } finally { cleanup?.(); }
}
