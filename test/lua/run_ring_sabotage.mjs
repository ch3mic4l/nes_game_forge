#!/usr/bin/env node
// Phase 3b S2 (C2) sabotage runner; S3 (C1) adds the horizontal ring's: a sabotage marked `side: 'h'` (test/lib/ringbypass.js) runs the horizontal files (FILES_H),
// the others the vertical ones (FILES), and the unsabotaged control runs all of them. For each named sabotage of test/lib/ringbypass.js (RING_SABOTAGES) it runs the ring test files with
// FORGE_RING_SABOTAGE=<name> -- every makeBypassTree() in those processes applies the edits to its mkdtemp COPY, never to the real tree -- and
// records which tests failed. A sabotage that is not CAUGHT is a hole: exit 1. Caught means node:test ran to completion (exit 1, no signal, finite TAP totals that add up,
// no cancelled test and no failed FILE) and a test the sabotage declares failed (EXPECTED_FAILURE below) -- a sabotage that merely breaks a subprocess (an import
// error, a crash, a timeout) fails some process and is not evidence about any ring assertion. A declared build-refusal assertion (h-far-branch-omitted) is an ordinary
// failed test and still counts. A sabotaged run is on the minimal matrix (MMC3 vertical, action) so a
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
const FILES_H = ['streamringh', 'streamringhstrip', 'streamringhoracle', 'streamringhdialogue', 'streamringhclose', 'streamringhredraw', 'streamringhfar'].map((f) => `test/unit/${f}.test.js`);
const TRACE_SABOTAGES = { 'trace-attach-once': { note: 'the PPU write trace stays on the first PPU: a post-Continue alias write goes unseen' } };
const ALL_SABOTAGES = { ...RING_SABOTAGES, ...TRACE_SABOTAGES };
const run = names.length ? names : Object.keys(ALL_SABOTAGES);
for (const n of run) if (!(n in ALL_SABOTAGES)) { console.error(`unknown sabotage ${n}`); process.exit(2); }

// The assertion each sabotage must break, as a regex on the failing test's name. One distinguishing test per sabotage, taken from what the sabotage
// breaks (the note above each in test/lib/ringbypass.js), not "any failure". A new sabotage in RING_SABOTAGES with no entry here is refused below.
const EXPECTED_FAILURE = {
  'strip-len-30': /^\(d\) the vertical ring column strip reads one screen/,
  'strip-load-30': /^\(d\) the vertical ring column strip reads one screen/,
  'wrap-skipped': /^config\.inc: the ring constants/,
  'render-4-nts': /^\(e\) dialogue open\/write\/close: MMC3-V/,
  'render-step-2': /^\(e\) dialogue open\/write\/close: MMC3-V/,
  'shadow-n32': /^\(e\) dialogue open\/write\/close: MMC3-V/,
  'attr-hi-3-omitted': /^\(e\) dialogue open\/write\/close: MMC3-V/,
  'cam-nt-compacted': /^\(a\) lap: MMC3-V/,
  'torus-leak': /^STREAM_RING = 0: every fixture and every four-screen streamed shape/,
  'h-far-branch-omitted': /^\(a\) a horizontal streamed build assembles on MMC1, MMC3 and UNROM 512/,
  'h-far-branch-inverted': /^MMC3 horizontal ring, mixed project: an ordinary screen's left crossing/,
  'h-row-len-32': /^the horizontal ring row strip reads one screen/,
  'h-row-load-32': /^the horizontal ring row strip reads one screen/,
  'h-wrap-32': /^\(a\) a horizontal streamed build assembles on MMC1, MMC3 and UNROM 512/,
  'h-wrap-30': /^\(a\) a horizontal streamed build assembles on MMC1, MMC3 and UNROM 512/,
  'h-camera-x-unfrozen': /^\(d\) the X-dead camera never moves X on a horizontal ring/,
  'h-column-strip-reached': /^\(e\) a column strip never arms on a horizontal ring/,
  'h-close-split-16': /^\(c\) horizontal close frame: MMC3-H action/,
  'h-cam-nt-compacted': /^\(b\) lap: MMC3-H/,
  'h-render-step-1': /^\(b\) lap: MMC3-H/,
  'ring-flag-off': /^config\.inc: the ring constants/,
  'trace-attach-once': /^\(c\) an alias write injected after every Continue power cycle is caught/
};
for (const n of Object.keys(ALL_SABOTAGES)) if (!(n in EXPECTED_FAILURE)) { console.error(`sabotage ${n} declares no EXPECTED_FAILURE`); process.exit(2); }

const out = [];
const say = (line) => { console.log(line); out.push(line); };
const runOne = (name) => {
  const env = { ...process.env };
  delete env.FORGE_RING_SABOTAGE;
  delete env.FORGE_RING_TRACE_SABOTAGE;
  let files = name && ALL_SABOTAGES[name].side === 'h' ? FILES_H : FILES;
  if (!name) files = [...FILES, ...FILES_H];
  const flags = [];
  if (name in TRACE_SABOTAGES) {
    env.FORGE_RING_TRACE_SABOTAGE = 'attach-once';
    files = ['test/unit/streamringoracle.test.js', 'test/unit/streamringcontinue.test.js'];
    flags.push('--test-name-pattern', '\\(c\\)');
  } else if (name) env.FORGE_RING_SABOTAGE = name;
  const r = spawnSync('node', ['--test', '--test-reporter=tap', ...flags, ...files], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const all = [...r.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  const isFile = (n) => /^(\/|test\/)/.test(n);
  const total = (key) => Number(r.stdout.match(new RegExp(`^# ${key} (\\d+)`, 'm'))?.[1] ?? NaN);
  const t = { tests: total('tests'), pass: total('pass'), fail: total('fail'), cancelled: total('cancelled'), skipped: total('skipped'), todo: total('todo') };
  // A run is complete when node:test reached its summary: every total is a number and they add up, nothing was cancelled, and no file failed as a file.
  const complete = r.error === undefined && r.signal === null && Object.values(t).every(Number.isFinite) && t.tests > 0 &&
    t.tests === t.pass + t.fail + t.cancelled + t.skipped + t.todo && t.cancelled === 0 && !all.some(isFile);
  return { status: r.status, signal: r.signal, ...t, complete, failed: all.filter((n) => !isFile(n)), fileFailures: all.filter(isFile) };
};
// caught, or why not
const judge = (name, r) => {
  if (!r.complete) return `node:test did not run to completion (exit ${r.status}${r.signal ? ` signal ${r.signal}` : ''}, tests ${r.tests} pass ${r.pass} fail ${r.fail} cancelled ${r.cancelled}${r.fileFailures.length ? `, failed file(s): ${r.fileFailures.slice(0, 3).join(', ')}` : ''})`;
  if (r.status !== 1 || r.fail === 0) return `no test failed (exit ${r.status}, fail ${r.fail})`;
  if (!r.failed.some((n) => EXPECTED_FAILURE[name].test(n))) return `none of the ${r.failed.length} failing test(s) is the declared ${EXPECTED_FAILURE[name]}`;
  return null;
};

say(`ring sabotage run ${new Date().toISOString()}  files: ${FILES.length} vertical + ${FILES_H.length} horizontal  matrix: MMC3 vertical / MMC3 horizontal, action (FORGE_RING_SABOTAGE set)`);
const control = runOne(null);
say(`CONTROL (no sabotage; the FULL matrix, every test of the ${FILES.length + FILES_H.length} files): pass ${control.pass} fail ${control.fail} exit ${control.status}${control.complete ? '' : ' (INCOMPLETE)'}`);
let holes = control.fail !== 0 || control.status !== 0 || !control.complete ? 1 : 0;
for (const name of run) {
  const r = runOne(name);
  const why = judge(name, r);
  if (why) holes++;
  say(`${why ? 'MISSED ' : 'CAUGHT '} ${name.padEnd(18)} pass ${r.pass} fail ${r.fail}  -- ${ALL_SABOTAGES[name].note}`);
  if (why) say(`           not caught: ${why}`);
  for (const f of r.failed.slice(0, 12)) say(`           failed: ${f}`);
  if (r.failed.length > 12) say(`           ... and ${r.failed.length - 12} more`);
}
say(holes ? `${holes} HOLE(S)` : `all ${run.length} sabotages caught`);
if (logFile) fs.writeFileSync(logFile, out.join('\n') + '\n');
process.exit(holes ? 1 : 0);
