// Runs ringscene steps under Mesen's test runner and returns the same records ringrun_jsnes.mjs produces, for the same judge.
//
// EVERY Mesen process runs in its own throwaway HOME (a copy of the user's settings.json, --doNotSaveSettings, a private save directory), so a ring run
// never reads or writes a save in the user's own ~/.config/Mesen2/Saves, and 18 concurrent matrix jobs cannot share one `game.sav`. (A CLI save-folder
// override was tried first and ignored by this Mesen build; the HOME is what its save path follows.) `userSavesSnapshot()` is compared before and after a
// chain: a chain that changed the user's directory throws.
//
// A scene with a power cycle (`{op:'cycle'}`: a Save, then Continue from the title after a power-on) is a CHAIN of Mesen invocations: Mesen's own
// process start is the power-on. Invocation 1 runs the steps up to the cycle and exits, which persists its battery RAM (a .sav) or its flash sector
// (an .ips) into ITS save directory; the Node side hashes whatever it left, seeds a COPY of exactly those files into invocation 2's own fresh save
// directory, and invocation 2 starts with `{op:'fresh'}` (the Lua side of the cycle: wait for the title, SELECT = Continue) and the rest of the steps.
// The records of the invocations are concatenated; the cycle hold carries `placeBefore`, the place the previous invocation ended in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadedFilesOfPid, fileStamp } from './ringprov.mjs';
import { RING_ADDR } from './ringaddr.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The Mesen binary, resolved ONCE to an absolute executable path in this process: $MESEN (a path, or a bare command looked up on PATH), else the usual
// unpacked-release location under the home directory, else `Mesen` on PATH. The same path is spawned, hashed by mesenStamp and used for the unit availability
// skip, so what is stamped is what ran. A configured $MESEN that is not an executable file is an ERROR (MESEN_ERROR, raised by runMesen); no binary at all
// leaves MESEN null (an optional tool: a unit skip, or an UNMEASURED campaign row).
const isExecutable = (p) => { try { return fs.statSync(p).isFile() && (fs.accessSync(p, fs.constants.X_OK), true); } catch { return false; } };
const onPath = (name, pathVar) => (pathVar ?? '').split(path.delimiter).filter(Boolean).map((d) => path.join(path.resolve(d), name)).find(isExecutable) ?? null;
export function resolveMesen({ env = process.env, home = os.homedir() } = {}) {
  if (env.MESEN) {
    const p = env.MESEN.includes('/') ? path.resolve(env.MESEN) : onPath(env.MESEN, env.PATH);
    if (p && isExecutable(p)) return { path: p, error: null, source: '$MESEN' };
    return { path: null, error: `$MESEN=${env.MESEN} is not an executable file${env.MESEN.includes('/') ? '' : ' on PATH'}`, source: '$MESEN' };
  }
  const cand = path.join(home, 'Downloads/Mesen2/bin/linux-x64/Release/Mesen');
  if (isExecutable(cand)) return { path: cand, error: null, source: 'home candidate' };
  const p = onPath('Mesen', env.PATH);
  return p ? { path: p, error: null, source: 'PATH' } : { path: null, error: null, source: 'none' };
}
const RESOLVED = resolveMesen();
export const MESEN = RESOLVED.path;
export const MESEN_ERROR = RESOLVED.error;
/** Why no Mesen can run here, or null when one can. */
export const mesenUnavailable = () => (MESEN ? null : MESEN_ERROR ?? 'no executable Mesen: set $MESEN, or put Mesen on PATH');
const SETTINGS = path.join(os.homedir(), '.config/Mesen2/settings.json');
const USER_SAVES = path.join(os.homedir(), '.config/Mesen2/Saves');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const luaValue = (v) => {
  if (Array.isArray(v)) return `{${v.map(luaValue).join(',')}}`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${k}=${luaValue(x)}`).join(',')}}`;
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
};
const unhex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));

/** name -> { sha256, bytes } of every file directly in `dir` ({} when absent): the identity of a save directory. */
export function dirSnapshot(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir).sort()) { const p = path.join(dir, n); if (fs.statSync(p).isFile()) { const b = fs.readFileSync(p); out[n] = { sha256: sha(b), bytes: b.length }; } }
  return out;
}
/** The user's own Mesen save directory, name -> sha256/bytes/mtime: a ring run must leave it exactly as it was. */
export function userSavesSnapshot() {
  const out = dirSnapshot(USER_SAVES);
  for (const n of Object.keys(out)) out[n].mtimeMs = fs.statSync(path.join(USER_SAVES, n)).mtimeMs;
  return out;
}

/** Splits a step list at its power cycles: the first group runs as given, each later group starts with {op:'fresh'} (the cycle's far side). */
export function splitAtCycles(steps) {
  const groups = [[]];
  for (const s of steps) {
    if (s.op === 'cycle') groups.push([{ ...s, op: 'fresh' }]);
    else groups[groups.length - 1].push(s);
  }
  return groups;
}

/** One Mesen process, in a private HOME whose save directory is seeded with `seed` ({name: Buffer}); returns { stdout, status, saves, seeded, ... }. */
async function invoke(romPath, steps, { seed = {}, timeoutMs = 240000 } = {}) {
  if (mesenUnavailable()) throw new Error(mesenUnavailable());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-mesen-'));
  try {
    const home = path.join(root, 'home');
    const cfg = path.join(home, '.config', 'Mesen2');
    const saves = path.join(cfg, 'Saves');
    fs.mkdirSync(saves, { recursive: true });
    if (!fs.existsSync(SETTINGS)) throw new Error(`no ${SETTINGS}: Mesen hangs on a first-run HOME; start Mesen once by hand`);
    fs.copyFileSync(SETTINGS, path.join(cfg, 'settings.json'));
    for (const [n, buf] of Object.entries(seed)) fs.writeFileSync(path.join(saves, n), buf);
    const seeded = dirSnapshot(saves);
    const lua = fs.readFileSync(path.join(HERE, 'ring_oracle.lua.template'), 'utf8').replace('__ADDR__', luaValue(RING_ADDR)).replace('__STEPS__', luaValue(steps));
    const luaPath = path.join(root, 'ring_oracle.lua');
    fs.writeFileSync(luaPath, lua);
    const loaded = new Set();
    const env = { ...process.env, HOME: home };
    delete env.XDG_CONFIG_HOME;
    const t0 = Date.now();
    let pid = null;
    const r = await new Promise((resolve, reject) => {
      const child = spawn(MESEN, ['--testRunner', '--doNotSaveSettings', '--enableStdout', luaPath, romPath], { stdio: ['ignore', 'pipe', 'pipe'], env });
      pid = child.pid;
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d; });
      // the files this Mesen process really mapped (its NATIVE core is extracted to <HOME>/.config/Mesen2 and loaded from THERE): sampled while it runs
      const poll = setInterval(() => loadedFilesOfPid(child.pid, loaded), 100);
      child.on('close', () => clearInterval(poll));
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout }); });
    });
    // hash what the process mapped NOW, while its private HOME still exists; the path is normalised so stamps do not depend on the temp name
    const loadedStamps = [...loaded].sort().map((p) => fileStamp(p)).filter(Boolean).map((f) => ({ ...f, path: f.path.startsWith(home) ? `<isolated-HOME>${f.path.slice(home.length)}` : f.path }));
    return { stdout: r.stdout, status: r.status, saves: Object.fromEntries(Object.keys(dirSnapshot(saves)).map((n) => [n, fs.readFileSync(path.join(saves, n))])), seeded, producedSnapshot: dirSnapshot(saves), loadedStamps, loadedPaths: [...loaded], pid, ms: Date.now() - t0, settingsSha256: sha(fs.readFileSync(SETTINGS)) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const placeOf = (kv) => (kv.worldX === undefined ? undefined : { worldX: kv.worldX, worldY: kv.worldY, curMap: kv.curMap, flatScreen: kv.flatScreen });
const kvOf = (tokens) => Object.fromEntries(tokens.filter((t) => /^[A-Za-z]+=-?\d+$/.test(t)).map((t) => { const [k, v] = t.split('='); return [k, +v]; }));

/** The records and the END place of one invocation's stdout. */
function parse(stdout) {
  const err = /^ERROR (.*)$/m.exec(stdout);
  if (err) throw new Error(`mesen script error: ${err[1]}`);
  if (!/^DONE /m.test(stdout)) throw new Error('mesen did not finish');
  const records = [];
  let end = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('END ')) { end = placeOf(kvOf(line.trim().split(' '))); continue; }
    if (line.startsWith('HOLD ')) {
      const t = line.trim().split(' ');
      const [, btn, target, why, pos, entry, blanks] = t;
      const kv = kvOf(t.slice(7));
      const hold = { btn, reached: why === 'target' || why === 'fought', why, pos: +pos };
      if (entry) Object.assign(hold, { entry, blanks: +blanks, minBlanks: { battle: 2, shake: 8 }[entry] ?? 1 });
      if (kv.slot !== undefined) { hold.slot = kv.slot; if (kv.want >= 0) hold.expectSlot = kv.want; }
      const place = placeOf(kv);
      if (place) hold.place = place;
      records.push({ label: `hold:${btn}:${target}`, kind: 'hold', hold });
      continue;
    }
    if (!line.startsWith('REC ')) continue;
    const f = line.trim().split(' ');
    const [, label, kind, gs, col, row, px, py, camNt, camX, camY, stAct, vlen, box, streamed, pnt, mcol, mline] = f;
    records.push({
      label, kind,
      state: { game_state: +gs, sw_col: +col, sw_row: +row, player_x: +px, player_y: +py, cam_nt: +camNt, cam_x_lo: +camX, cam_y_lo: +camY, st_active: +stAct, vram_len: +vlen, box_state: +box, msg_col: +mcol, msg_line: +mline, map_is_streamed: +streamed, ppuctrl_nt: +pnt },
      vram: { 0x2000: unhex(f[18]), 0x2400: unhex(f[19]), 0x2800: unhex(f[20]), 0x2c00: unhex(f[21]) }
    });
  }
  return { records, end };
}

/**
 * Runs `steps` as a chain of private-HOME Mesen invocations (one per power cycle) and returns the concatenated records. Extra properties on the array:
 *   loadedPaths / loadedStamps   the files the processes mapped (hashed while their HOME existed; the path of one under the HOME is `<isolated-HOME>/...`)
 *   invocations                  one entry per process: { n, ops, seededSaves, producedSaves, status, pid, ms, settingsSha256, saveDir } -- the provenance
 *                                of the persistence chain (what went in, what came out, for which medium)
 *   userSavesUntouched           true: the user's own Mesen save directory was identical before and after the chain (a violation throws)
 */
export async function runMesen(romPath, steps, { timeoutMs = 240000 } = {}) {
  const before = userSavesSnapshot();
  const groups = splitAtCycles(steps);
  const records = [];
  const invocations = [];
  const loadedStamps = new Map();
  const loadedPaths = new Set();
  let carry = {}; // the save directory the previous invocation left, handed to the next as a COPY
  let prevEnd = null;
  for (const [i, group] of groups.entries()) {
    const run = await invoke(romPath, group, { seed: carry, timeoutMs });
    const { records: recs, end } = (() => { try { return parse(run.stdout); } catch (e) { throw new Error(`${e.message} (invocation ${i + 1}/${groups.length}, exit ${run.status})`); } })();
    if (i > 0) { const c = recs.find((r) => r.kind === 'hold' && r.hold.btn === 'cycle'); if (c && prevEnd) c.hold.placeBefore = prevEnd; }
    records.push(...recs);
    const cyc = group.find((s) => s.op === 'fresh' || s.op === 'save');
    invocations.push({
      n: i + 1, ops: group.map((s) => s.op).join(','), persistence: groups.length > 1 ? (steps.find((s) => s.op === 'cycle')?.battery ? 'battery RAM (.sav)' : 'flash (.ips)') : 'none',
      seededSaves: run.seeded, producedSaves: run.producedSnapshot, status: run.status, pid: run.pid, ms: run.ms, settingsSha256: run.settingsSha256,
      saveDir: 'private mkdtemp HOME, removed after the invocation (never the user\'s ~/.config/Mesen2/Saves)', hasCycleOrSave: !!cyc
    });
    for (const f of run.loadedStamps) loadedStamps.set(`${f.path}:${f.sha256}`, f);
    for (const p of run.loadedPaths) loadedPaths.add(p);
    carry = run.saves;
    prevEnd = end;
  }
  const after = userSavesSnapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`a ring Mesen run changed the user's own save directory ${USER_SAVES}`);
  records.loadedPaths = [...loadedPaths];
  records.loadedStamps = [...loadedStamps.values()];
  records.invocations = invocations;
  records.userSavesUntouched = true;
  return records;
}
