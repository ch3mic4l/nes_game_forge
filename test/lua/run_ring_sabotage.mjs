#!/usr/bin/env node
// Phase 3b S2 (C2) sabotage runner. For each named sabotage of test/lib/ringbypass.js (RING_SABOTAGES) it runs the ring test files with
// FORGE_RING_SABOTAGE=<name> -- every makeBypassTree() in those processes applies the edits to its mkdtemp COPY, never to the real tree -- and
// records which tests failed. A sabotage that fails no test is a hole: exit 1. A sabotaged run is on the minimal matrix (MMC3 vertical, action) so a
// sabotage costs about a minute; the unsabotaged control row clears FORGE_RING_SABOTAGE, so it runs the FULL matrix (every test of the seven files) and must pass.
// The last sabotage, `trace-attach-once`, is not an engine edit: it puts back the PPU trace defect (the trace left on the first PPU across a power
// cycle) through FORGE_RING_TRACE_SABOTAGE and runs only the two files that hold its regressions, the matrix-independent `(c)` tests.
//   node test/lua/run_ring_sabotage.mjs [--log=<file>] [name ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RING_SABOTAGES } from '../lib/ringbypass.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = ['streamring', 'streamringidentity', 'streamringstrip', 'streamringoracle', 'streamringdialogue', 'streamringredraw', 'streamringcontinue'].map((f) => `test/unit/${f}.test.js`);
const args = process.argv.slice(2);
const logFile = args.find((a) => a.startsWith('--log='))?.slice(6);
const names = args.filter((a) => !a.startsWith('--'));
const TRACE_SABOTAGES = { 'trace-attach-once': { note: 'the PPU write trace stays on the first PPU: a post-Continue alias write goes unseen' } };
const ALL_SABOTAGES = { ...RING_SABOTAGES, ...TRACE_SABOTAGES };
const run = names.length ? names : Object.keys(ALL_SABOTAGES);
for (const n of run) if (!(n in ALL_SABOTAGES)) { console.error(`unknown sabotage ${n}`); process.exit(2); }

const out = [];
const say = (line) => { console.log(line); out.push(line); };
const runOne = (name) => {
  const env = { ...process.env };
  delete env.FORGE_RING_SABOTAGE;
  delete env.FORGE_RING_TRACE_SABOTAGE;
  let files = FILES;
  const flags = [];
  if (name in TRACE_SABOTAGES) {
    env.FORGE_RING_TRACE_SABOTAGE = 'attach-once';
    files = ['test/unit/streamringoracle.test.js', 'test/unit/streamringcontinue.test.js'];
    flags.push('--test-name-pattern', '\\(c\\)');
  } else if (name) env.FORGE_RING_SABOTAGE = name;
  const r = spawnSync('node', ['--test', '--test-reporter=tap', ...flags, ...files], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const failed = [...r.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]).filter((n) => !/^(\/|test\/)/.test(n));
  const pass = Number(r.stdout.match(/^# pass (\d+)/m)?.[1] ?? NaN);
  const fail = Number(r.stdout.match(/^# fail (\d+)/m)?.[1] ?? NaN);
  return { status: r.status, pass, fail, failed };
};

say(`ring sabotage run ${new Date().toISOString()}  files: ${FILES.length}  matrix: MMC3 vertical, action (FORGE_RING_SABOTAGE set)`);
const control = runOne(null);
say(`CONTROL (no sabotage; the FULL matrix, every test of the seven files): pass ${control.pass} fail ${control.fail} exit ${control.status}`);
let holes = control.fail !== 0 || control.status !== 0 ? 1 : 0;
for (const name of run) {
  const r = runOne(name);
  const caught = r.fail > 0;
  if (!caught) holes++;
  say(`${caught ? 'CAUGHT ' : 'MISSED '} ${name.padEnd(18)} pass ${r.pass} fail ${r.fail}  -- ${ALL_SABOTAGES[name].note}`);
  for (const f of r.failed.slice(0, 12)) say(`           failed: ${f}`);
  if (r.failed.length > 12) say(`           ... and ${r.failed.length - 12} more`);
}
say(holes ? `${holes} HOLE(S)` : `all ${run.length} sabotages caught`);
if (logFile) fs.writeFileSync(logFile, out.join('\n') + '\n');
process.exit(holes ? 1 : 0);
