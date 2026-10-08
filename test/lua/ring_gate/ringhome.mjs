// Phase 3b S1b: ONE private HOME for every Mesen process a witness run starts, and the record of every such process (round 2, finding 3).
// A witness run starts Mesen more than once (a Move scene's touch-body CALIBRATION, then the witness itself); round 1 isolated only the second. This module is the
// single place the private HOME is made, the single source of the `{ mesenEnv, onMesenChild }` pair threaded through every spawn, and what turns each spawned
// process into an invocation record -- its pid, what it was for, the HOME the kernel says it was started with (/proc/<pid>/environ), the executable it ran,
// the files it mapped, its exit status and signal -- so the provenance retains what actually ran, never a manufactured status.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadedFilesOfPid, fileStamp } from './ringprov.mjs';
import { sha256 } from './ringtree.mjs';

const USER_SETTINGS = () => path.join(os.homedir(), '.config/Mesen2/settings.json');

/** The HOME a live process was started with, read from the kernel (null when unreadable). */
export function homeOfPid(pid) {
  try { for (const kv of fs.readFileSync(`/proc/${pid}/environ`, 'latin1').split('\0')) if (kv.startsWith('HOME=')) return kv.slice(5); } catch { /* gone */ }
  return null;
}
const exeOfPid = (pid) => { try { return fs.readlinkSync(`/proc/${pid}/exe`); } catch { return null; } };

/**
 * A private HOME (a copy of the user's settings.json, an empty save directory) and the hooks every spawn must carry. `ctx` is the `mesenCtx` of ringwork.runWitness:
 * `{ mesenEnv, onMesenChild(child, { spec, purpose }) }`. `settings` overrides the copied settings file (a unit test without an installed Mesen).
 */
export function openIsolatedHome({ settings = USER_SETTINGS(), requireSettings = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 's1b-home-'));
  const cfg = path.join(home, '.config', 'Mesen2');
  fs.mkdirSync(path.join(cfg, 'Saves'), { recursive: true });
  if (fs.existsSync(settings)) fs.copyFileSync(settings, path.join(cfg, 'settings.json'));
  else if (requireSettings) { fs.rmSync(home, { recursive: true, force: true }); throw new Error(`no ${settings}: Mesen hangs on a first-run HOME; start Mesen once by hand`); }
  const env = { ...process.env, HOME: home };
  delete env.XDG_CONFIG_HOME;
  const invocations = [];
  const loaded = new Set();
  const settingsSha256 = fs.existsSync(path.join(cfg, 'settings.json')) ? sha256(fs.readFileSync(path.join(cfg, 'settings.json'))) : null;
  const onMesenChild = (child, info = {}) => {
    const t0 = Date.now();
    const rec = { n: invocations.length + 1, spec: info.spec ?? null, purpose: info.purpose ?? null, pid: child.pid ?? null, homeSeen: homeOfPid(child.pid), exe: exeOfPid(child.pid), settingsSha256, status: null, signal: null, ms: null, loadedFiles: [] };
    invocations.push(rec);
    const mine = new Set();
    const poll = setInterval(() => { loadedFilesOfPid(child.pid, mine); loadedFilesOfPid(child.pid, loaded); rec.homeSeen ??= homeOfPid(child.pid); rec.exe ??= exeOfPid(child.pid); }, 100);
    child.on('close', (status, signal) => {
      clearInterval(poll);
      rec.status = status; rec.signal = signal ?? null; rec.ms = Date.now() - t0;
      // hashed NOW, while the private HOME (where Mesen extracts its native core) still exists; the path is normalised so a stamp does not depend on the temp name
      rec.loadedFiles = [...mine].sort().map((p) => fileStamp(p)).filter(Boolean).map((f) => ({ ...f, path: f.path.startsWith(home) ? `<isolated-HOME>${f.path.slice(home.length)}` : f.path }));
    });
  };
  return {
    home, env, ctx: { mesenEnv: env, onMesenChild }, invocations, loaded,
    /** the invocation records as the provenance retains them: `isolated` = the kernel-reported HOME of the process IS this private HOME and is not the user's */
    chain: () => invocations.map((r) => ({ ...r, isolated: r.homeSeen === home && path.resolve(home) !== path.resolve(os.homedir()), homeSeen: r.homeSeen === home ? '<isolated-HOME>' : r.homeSeen })),
    dispose: () => fs.rmSync(home, { recursive: true, force: true })
  };
}

/** Problems with a retained invocation chain against the invocations the run MEANT to start (`expected` = [{ spec, purpose }]): empty = sound. */
export function auditChain(chain, expected, { statusOk = [0] } = {}) {
  const bad = [];
  if (!Array.isArray(chain) || chain.length === 0) return ['no Mesen invocation is retained'];
  const key = (r) => `${r.spec}/${r.purpose}`;
  const want = new Map(); for (const e of expected) want.set(key(e), (want.get(key(e)) ?? 0) + 1);
  const got = new Map(); for (const r of chain) got.set(key(r), (got.get(key(r)) ?? 0) + 1);
  for (const [k, n] of want) if ((got.get(k) ?? 0) !== n) bad.push(`expected ${n} ${k} invocation(s), the chain holds ${got.get(k) ?? 0}`);
  for (const k of got.keys()) if (!want.has(k)) bad.push(`an unplanned invocation ${k}`);
  for (const r of chain) {
    const id = `invocation ${r.n} (${key(r)})`;
    if (!r.pid) bad.push(`${id} has no pid`);
    if (!statusOk.includes(r.status)) bad.push(`${id} exited with status ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}`);
    if (r.isolated !== true) bad.push(`${id} was not confirmed to run under the private HOME (the kernel reported ${r.homeSeen ?? 'nothing'})`);
    if (!r.settingsSha256) bad.push(`${id} has no settings hash`);
    if (!r.exe) bad.push(`${id} does not record the executable it ran`);
    if (!Array.isArray(r.loadedFiles) || r.loadedFiles.length === 0) bad.push(`${id} does not record the files it mapped`);
  }
  return bad;
}
