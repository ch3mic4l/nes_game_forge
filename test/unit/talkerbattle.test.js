// Slice S3b fix round 1, finding 3: L5's executable cases are pinned (test/lua/sw_talker_battle.mjs). No Mesen here: the case list, the generated Lua and the judge are
// checked, so a launch cannot silently shrink or accept a wrong result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CASES, caseProblems } from '../lua/sw_talker_battle.mjs';
import { OTHER_LAUNCHES } from '../lua/run_sw_cross.mjs';

const NO = 255;
const good = (c) => {
  const e = c.expect;
  const r = { why: 'settled', frames: 300, vars: [0, 0, 0, 0, 0, 0, 0, 0], sw0: e.sw0 ?? 1, rec: NO, scr: NO, crossed: 0, owed: NO, ent: NO, slot: -1, slotDir: -1, slotActive: -1, slotY: -1, state: 0, entries: [] };
  for (const [i, v] of Object.entries(e.vars)) r.vars[i] = v;
  if (e.entries !== undefined) {
    r.entries = Array.from({ length: e.entries }, () => ({ h: 1, talkEnt: e.goneEntry ? NO : 2, slot: e.goneEntry ? -1 : 2, crossed: e.goneEntry?.crossed ?? 0 }));
  }
  if (e.slotAfter) { r.slot = 2; r.slotDir = e.slotAfter.dir ?? 0; r.slotActive = e.slotAfter.hidden ? 3 : 1; r.slotY = e.slotAfter.y ?? 32; }
  return r;
};

test('L5 pins 24 unique cases (8 T5, 16 T6), all RPG, each with a Battle on its page, and OTHER_LAUNCHES prices exactly them', () => {
  assert.equal(CASES.length, 24);
  assert.equal(new Set(CASES.map((c) => c.id)).size, 24);
  assert.equal(CASES.filter((c) => c.kind === 'T5').length, 8);
  assert.equal(CASES.filter((c) => c.kind === 'T6').length, 16);
  for (const c of CASES) {
    assert.equal(c.gameType, 'rpg', c.id);
    assert.ok(JSON.stringify(c.pages(7)).includes('"op":"battle"'), `${c.id} has a Battle`);
  }
  const l5 = OTHER_LAUNCHES.find((o) => o.name === 'L5');
  assert.equal(l5.cells, CASES.length);
  assert.ok(l5.processes <= 4);
});

test('L5 judge accepts the intended result of every case and rejects each single deviation (the negative control)', () => {
  for (const c of CASES) {
    assert.deepEqual(caseProblems(c, good(c)), [], c.id);
    assert.ok(caseProblems(c, { ...good(c), why: 'timeout in drive' }).length, `${c.id}: a timeout is a failure`);
    const v = good(c); v.vars[0] = 0;
    assert.ok(caseProblems(c, v).length, `${c.id}: a page that did not finish fails`);
    assert.ok(caseProblems(c, { ...good(c), owed: 0 }).length, `${c.id}: a leftover owed record fails`);
  }
  const t5 = CASES.find((c) => c.id === 'T5/cross-battle-say');
  const lost = good(t5); lost.vars[2] = 0;
  assert.ok(caseProblems(t5, lost).some((p) => /variable 2/.test(p)), 'the owed entry that never re-fired is named');
  const rebound = CASES.find((c) => c.id === 'T6/live-after-a-respawn-rebound/move-self/battle');
  const stale = good(rebound); stale.entries.at(-1).talkEnt = 5;
  assert.ok(caseProblems(rebound, stale).some((p) => /current slot/.test(p)), 'a stale talk_ent is named');
  const wrongY = good(rebound); wrongY.slotY = 32;
  assert.ok(caseProblems(rebound, wrongY).some((p) => /y 32/.test(p)), 'a talker that did not walk is named');
  const gone = CASES.find((c) => c.id === 'T6/gone-the-player-crossed-away/turn/battle');
  const live = good(gone); live.entries[0].talkEnt = 3; live.entries[0].slot = 3;
  assert.ok(caseProblems(gone, live).length, 'a gone talker that is present fails');
});

test('L5 Lua template has no placeholder the builder does not fill, and every case names its handlers', () => {
  const t = fs.readFileSync(new URL('../lua/sw_talker_battle.lua.template', import.meta.url), 'utf8');
  const src = fs.readFileSync(new URL('../lua/sw_talker_battle.mjs', import.meta.url), 'utf8');
  for (const ph of new Set(t.match(/__[A-Z0-9_]+__/g))) assert.ok(src.includes(ph + ':'), `${ph} is substituted`);
  for (const c of CASES.filter((x) => x.kind === 'T6')) assert.equal(c.handlers.length, c.cmdName === 'say' ? 0 : 1, c.id);
});

// ---------------------------------------------------------------- the runner itself (review 2 finding 3): no Mesen; a fake emulator stands in

import os from 'node:os';
import path from 'node:path';
import { runL5, parseL5Args, completeness, MAX_PROCS } from '../lua/sw_talker_battle.mjs';

const ONE = '^T5/cross-battle-say$';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-l5-test-'));
/** A stand-in emulator: prints FAKE_RESULT as the RESULT line (when set) and exits with FAKE_EXIT. */
function fakeMesen(dir, { exec = true } = {}) {
  const f = path.join(dir, 'Mesen');
  fs.writeFileSync(f, `#!/usr/bin/env node\nif (process.env.FAKE_RESULT) console.log('RESULT ' + process.env.FAKE_RESULT);\nprocess.exit(Number(process.env.FAKE_EXIT ?? 0));\n`);
  fs.chmodSync(f, exec ? 0o755 : 0o644);
  return f;
}
async function withFake(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('L5 parses a strict worker count 1..4, rejects an empty selection and an unsaid mode, and runs nothing for any of them', async () => {
  assert.equal(parseL5Args(['--run', '--out=x.json']).procs, MAX_PROCS);
  assert.equal(parseL5Args(['--run', '--out=x.json', '--procs=1']).procs, 1);
  for (const bad of ['0', '5', '-1', '2.5', 'abc', '1e1', '20']) assert.throws(() => parseL5Args(['--run', '--out=x.json', `--procs=${bad}`]), /--procs/, bad);
  assert.throws(() => parseL5Args(['--run', '--out=x.json', '--match=^nothing-like-this$']), /selects no case/);
  assert.throws(() => parseL5Args(['--run', '--out=x.json', '--match=(']), /not a regular expression/);
  assert.throws(() => parseL5Args(['--run']), /--out/);
  assert.throws(() => parseL5Args([]), /say what to do/);
  assert.throws(() => parseL5Args(['--list', '--run', '--out=x.json']), /different modes/);
  const dir = tmpDir();
  const out = path.join(dir, 'l5.json');
  // through the whole command: exit 2, no results file, nothing built (the output directory stays empty)
  for (const args of [['--procs=0'], ['--procs=5'], ['--match=^zzz$']]) {
    const r = await runL5(['--run', `--out=${out}`, `--build=${dir}/b`, ...args], { running: 0 });
    assert.equal(r.exitCode, 2, args.join(' '));
    assert.ok(!fs.existsSync(out) && !fs.existsSync(`${dir}/b`), `${args.join(' ')}: nothing was built or written`);
  }
  const full = await runL5(['--run', `--out=${out}`, '--match=^T5/cross-battle-say$', `--mesen=${fakeMesen(dir)}`], { running: 17 });
  assert.equal(full.exitCode, 2, 'a machine with 17 Mesen already running has no room for 4 more');
  assert.match(full.stderr, /exceeds the machine ceiling/);
  const missing = await runL5(['--run', `--out=${out}`, '--match=^T5/cross-battle-say$', `--mesen=${dir}/nope`], { running: 0 });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.stderr, /Mesen is not at/);
});

test('L5 completeness: exactly the selected cases, each once', () => {
  const sel = [{ id: 'a' }, { id: 'b' }];
  assert.equal(completeness(sel, [{ id: 'b' }, { id: 'a' }]).complete, true);
  assert.deepEqual(completeness(sel, [{ id: 'a' }]).missing, ['b']);
  assert.deepEqual(completeness(sel, [{ id: 'a' }, { id: 'a' }]).twice, ['a']);
  assert.equal(completeness(sel, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).complete, false);
  assert.deepEqual(completeness(sel, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).extra, ['c']);
  assert.equal(completeness(sel, []).complete, false);
});

test('L5 run: a fake emulator that answers correctly passes and its RAW RESULT, exit status and ROM/project linkage and fingerprints are saved; a nonzero exit, no RESULT and an unstartable emulator each fail', async () => {
  const dir = tmpDir();
  const c = CASES.find((x) => x.id === 'T5/cross-battle-say');
  const result = JSON.stringify(good(c));
  const out = path.join(dir, 'l5.json');
  const run = (mesen, env, extra = []) => withFake(env, () => runL5(['--run', `--out=${out}`, `--match=${ONE}`, '--procs=1', `--mesen=${mesen}`, ...extra], { running: 0 }));

  const ok = await run(fakeMesen(dir), { FAKE_RESULT: result, FAKE_EXIT: '0' });
  assert.equal(ok.exitCode, 0, ok.stdout + ok.stderr);
  let doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(doc.complete, true);
  assert.deepEqual([doc.selected.length, doc.completed, doc.failed], [1, 1, 0]);
  assert.equal(doc.results[0].rawResult, result, 'the raw RESULT line is kept verbatim');
  assert.equal(doc.results[0].exit, 0);
  assert.deepEqual(doc.results[0].result, good(c));
  for (const k of ['rom', 'project', 'lua']) assert.match(doc.results[0].link[k], /^[0-9a-f]{64}$/, `link.${k}`);
  for (const k of ['engine', 'harness', 'generator', 'mesen', 'runner', 'template', 'cases']) assert.match(doc.fingerprints[k], /^[0-9a-f]{64}$/, `fingerprints.${k}`);

  const nonzero = await run(fakeMesen(dir), { FAKE_RESULT: result, FAKE_EXIT: '3' });
  assert.equal(nonzero.exitCode, 1, 'a RESULT line does not excuse a nonzero exit');
  doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(doc.failed, 1);
  assert.equal(doc.results[0].exit, 3);
  assert.match(doc.results[0].problems.join(';'), /exited with status 3, not 0/);

  const silent = await run(fakeMesen(dir), { FAKE_RESULT: '', FAKE_EXIT: '0' });
  assert.equal(silent.exitCode, 1);
  assert.match(JSON.parse(fs.readFileSync(out, 'utf8')).results[0].problems.join(';'), /no RESULT line/);

  const wrong = await run(fakeMesen(dir), { FAKE_RESULT: JSON.stringify({ ...good(c), vars: [0, 0, 0, 0, 0, 0, 0, 0] }), FAKE_EXIT: '0' });
  assert.equal(wrong.exitCode, 1, 'a wrong observation fails even on a clean exit');

  const dead = await run(fakeMesen(dir, { exec: false }), { FAKE_RESULT: result });
  assert.equal(dead.exitCode, 1);
  assert.match(JSON.parse(fs.readFileSync(out, 'utf8')).results[0].problems.join(';'), /could not be started/);
});
