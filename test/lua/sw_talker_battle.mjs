// Phase 3a slice S3b, launch L5 (review 1 finding 3: "pin L5's executable cases"): the talker + scripted Battle cases of the S3b unit suite
// (test/unit/streamedtalker.test.js, T5 and T6) replayed through Mesen's independent core. The CASES below are the whole pinned list (24 cases, all RPG,
// each with a Battle on its page); every expectation is written out by hand from the unit tests' assertions, never read back from a run.
//
//   node test/lua/sw_talker_battle.mjs --list [--match=<regex>]                print the pinned cases and their expectations
//   node test/lua/sw_talker_battle.mjs --build=<outDir> [--match=<regex>]      build every selected case's ROM and Lua (no Mesen)
//   node test/lua/sw_talker_battle.mjs --run --out=<json> [--match=<regex>] [--procs=1..4] [--mesen=<path>] [--build=<outDir>]
//                                                                              run them in Mesen (1..4 processes; the 20 ceiling is checked first)
//
// A certification run is complete only when EXACTLY the selected cases ran to completion: an empty selection, a worker count outside 1..4, an emulator
// that errored, timed out or exited nonzero (RESULT line or not), a case that did not report, and a case reported twice each fail it. Every case's raw
// RESULT line, exit status and generated ROM/project/Lua linkage are saved to --out together with the engine, generator, harness, runner, template and
// Mesen fingerprints, so the observed variables, talker state and handler entries can be audited afterwards (review 2 finding 3).
//
// A run needs Chris's go-ahead (a D launch). Each case is one Mesen process of about 15-25 s; 24 cases at 4 processes is about 2 minutes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { parseEquates } from '../../shared/enginesyms.js';
import { crossProject, page, move, addVar, setSwitch, say, wait, R, DIRS } from '../lib/streamedcross.js';
import { assertRoom, countMesen, parseFlags, wholeNumber } from './sw_move_policy.mjs';
import { MESEN_DEFAULT } from './run_sw_manifest.mjs';
import { REPO } from './sw_manifest_scene.mjs';
import { EXEC_FLAGS, processProvenance, projectHash, romHash, sha256 } from './sw_provenance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NO = R.NO_ENTITY;
const BATTLE = (id) => ({ op: 'battle', monsters: [id] });
const talkerPages = (commands) => [page([addVar(1)], { type: 'switchOn', arg: 0 }), page([...commands, setSwitch(0)])];
const enterNpc = (screen, commands, extra = {}) => ({ screen, x: 32, y: 32, trigger: 'enter', pages: [page(commands)], ...extra });

// ---------------------------------------------------------------- T5: the owed enter event across a Battle

const T5 = [
  { id: 'T5/cross-battle-say', commands: (m) => [move('right', 100), BATTLE(m), say('A'), addVar(0)], extras: [enterNpc(1, [addVar(2)])], expect: { vars: { 0: 1, 2: 1 }, owed: NO } },
  { id: 'T5/repeated-battles', commands: (m) => [move('right', 100), BATTLE(m), BATTLE(m), say('A'), addVar(0)], extras: [enterNpc(1, [addVar(2)])], expect: { vars: { 0: 1, 2: 1 }, owed: NO } },
  { id: 'T5/two-crossings-battle', commands: (m) => [move('right', 200), move('right', 155), BATTLE(m), say('A'), addVar(0)], extras: [enterNpc(1, [addVar(2)]), enterNpc(2, [addVar(3)])], expect: { vars: { 0: 1, 2: 0, 3: 1 }, owed: NO } },
  { id: 'T5/two-crossings-different-records', commands: (m) => [move('right', 200), move('right', 155), BATTLE(m), say('A'), addVar(0)], extras: [enterNpc(1, [addVar(2)]), { screen: 2, x: 64, y: 64 }, enterNpc(2, [addVar(3)])], expect: { vars: { 0: 1, 2: 0, 3: 1 }, owed: NO } },
  { id: 'T5/final-crossing-no-enter-actor', commands: (m) => [move('right', 200), move('right', 155), BATTLE(m), say('A'), addVar(0)], extras: [enterNpc(1, [addVar(2)]), { screen: 2, x: 64, y: 64, trigger: 'interact', pages: [page([addVar(4)])] }], expect: { vars: { 0: 1, 2: 0, 4: 0 }, owed: NO } },
  { id: 'T5/no-enter-actor-owes-nothing', commands: (m) => [move('right', 100), BATTLE(m), say('A'), addVar(0)], extras: [{ screen: 1, x: 32, y: 32 }, { screen: 1, x: 64, y: 32, trigger: 'interact', pages: [page([addVar(4)])] }], expect: { vars: { 0: 1, 2: 0, 3: 0, 4: 0 }, owed: NO } },
  { id: 'T5/switch-before-battle-drops', commands: (m) => [move('right', 100), setSwitch(3), BATTLE(m), say('A'), addVar(0)], extras: [enterNpc(1, [addVar(2)], { hideSwitch: 3 })], expect: { vars: { 0: 1, 2: 0 }, owed: NO } },
  { id: 'T5/switch-after-battle-fires', commands: (m) => [move('right', 100), BATTLE(m), setSwitch(3), say('A'), addVar(0)], extras: [enterNpc(1, [addVar(2)], { hideSwitch: 3 })], expect: { vars: { 0: 1, 2: 1 }, owed: NO } }
];

// ---------------------------------------------------------------- T6: the talker matrix, each row with a Battle first

const STATES = {
  'live, no crossing': { prefix: [], live: true, crossings: 0 },
  'live after a respawn (rebound)': { prefix: [setSwitch(2), move('right', 100), move('left', 100)], live: true, decoy: true, crossings: 2 },
  'gone: the player crossed away': { prefix: [move('right', 100)], live: false, crossings: 1 },
  'gone: a switch suppresses it': { prefix: [setSwitch(1), setSwitch(2), move('right', 100), move('left', 100)], live: false, decoy: true, hide: 1, crossings: 2 }
};
const SELF = {
  turn: { command: { op: 'turn', who: 'self', dir: 'up' }, handlers: ['script_op_turn'] },
  visible: { command: { op: 'visible', state: 'hidden' }, handlers: ['script_op_visible'] },
  'move-self': { command: move('down', 16, 'self'), handlers: ['script_op_move'] },
  say: { command: say('HELLO'), handlers: [] }
};
const slug = (s) => s.replace(/[^a-z]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

function t6Expect(stateName, cmdName) {
  const st = STATES[stateName];
  const playerMoves = st.prefix.filter((c) => c.op === 'move').length;
  const e = { vars: { 0: 1, 1: stateName === 'live after a respawn (rebound)' ? 1 : 0 }, sw0: 1, rec: NO, crossed: 0, owed: NO, ent: NO };
  if (SELF[cmdName].handlers.length) {
    e.entries = (cmdName === 'move-self' ? playerMoves : 0) + 1; // script_op_move also serves the page's player Moves
    if (st.live) { e.liveEntry = true; e.slotAfter = cmdName === 'turn' ? { dir: DIRS.up } : cmdName === 'visible' ? { hidden: true } : { y: 48 }; } else e.goneEntry = { crossed: st.crossings > 0 ? 1 : 0 };
  }
  return e;
}

export const CASES = [
  ...T5.map((c) => ({ ...c, kind: 'T5', gameType: 'rpg', pages: (m) => talkerPages(c.commands(m)), handlers: [] })),
  ...Object.keys(STATES).flatMap((stateName) => Object.keys(SELF).map((cmdName) => ({
    id: `T6/${slug(stateName)}/${cmdName}/battle`, kind: 'T6', gameType: 'rpg', stateName, cmdName,
    pages: (m) => talkerPages([...STATES[stateName].prefix, BATTLE(m), SELF[cmdName].command, wait(12), addVar(0)]),
    extras: [], decoy: Boolean(STATES[stateName].decoy), talker: STATES[stateName].hide !== undefined ? { hideSwitch: STATES[stateName].hide } : {},
    handlers: SELF[cmdName].handlers, expect: t6Expect(stateName, cmdName)
  })))
];

// ---------------------------------------------------------------- build

const need = (map, name) => { if (!(name in map)) throw new Error(`${name} is not a symbol of this build`); return map[name]; };

/** Builds one case: { project, rom, lua, talkerRecord } under outDir. */
export async function buildCase(c, outDir) {
  const make = (m) => crossProject({ gameType: c.gameType, start: { screen: 0, x: 200, y: 112 }, decoy: c.decoy, talker: c.talker ?? {}, extras: c.extras ?? [], monster: true, pages: c.pages(m) });
  const scene = make(make(null).monsterId);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-talker-battle-'));
  try {
    await saveProject(dir, scene.project);
    const built = await buildProject({ dir, project: scene.project, log: () => {} });
    await fs.promises.mkdir(outDir, { recursive: true });
    const base = c.id.replace(/\//g, '_');
    await fs.promises.copyFile(built.romPath, path.join(outDir, `${base}.nes`));
    const syms = parseSymbolFile(await fs.promises.readFile(built.symbolPath, 'utf8'));
    const ram = parseEquates(await fs.promises.readFile(path.join(dir, 'build/constants.asm'), 'utf8'));
    const subs = {
      __GAME_STATE__: need(ram, 'game_state'), __MAP_IS_STREAMED__: need(ram, 'map_is_streamed'), __SCRIPT_ACTIVE__: need(ram, 'script_active'), __PENDING_ENT__: need(ram, 'pending_ent'),
      __BOX_STATE__: need(ram, 'box_state'), __BT_SEL__: need(ram, 'bt_sel'), __BT_PHASE__: need(ram, 'bt_phase'), __BP_MENU__: need(ram, 'BP_MENU'), __BC_FIGHT__: need(ram, 'BC_FIGHT'),
      __VARIABLES__: need(ram, 'variables'), __SWITCHES__: need(ram, 'switches'),
      __TALK_REC__: need(ram, 'talk_rec'), __TALK_SCR__: need(ram, 'talk_scr'), __TALK_CROSSED__: need(ram, 'talk_crossed'), __OWED__: need(ram, 'owed_enter_rec'), __TALK_ENT__: need(ram, 'talk_ent'),
      __ENT_ACTIVE__: need(ram, 'ent_active'), __ENT_RECORD__: need(ram, 'ent_record'), __ENT_DIR__: need(ram, 'ent_dir'), __ENT_Y__: need(ram, 'ent_y'), __MAX_ENTITIES__: need(ram, 'MAX_ENTITIES'),
      __TALKER_RECORD__: scene.talkerRecord, __HANDLERS__: c.handlers.map((h) => need(syms, h)).join(', ')
    };
    let lua = await fs.promises.readFile(path.join(HERE, 'sw_talker_battle.lua.template'), 'utf8');
    for (const [k, v] of Object.entries(subs)) lua = lua.split(k).join(String(v));
    const left = lua.match(/__[A-Z0-9_]+__/g);
    if (left) throw new Error(`unsubstituted placeholders: ${[...new Set(left)].join(', ')}`);
    const luaPath = path.join(outDir, `${base}.lua`);
    await fs.promises.writeFile(luaPath, lua);
    const rom = path.join(outDir, `${base}.nes`);
    return { id: c.id, rom, lua: luaPath, handlerAddrs: c.handlers.map((h) => syms[h]), link: { rom: romHash(rom), project: projectHash(scene.project), lua: sha256(lua) } };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- judge

/** The problems of one parsed RESULT against its case's hand-written expectation ([] when sound). */
export function caseProblems(c, r) {
  const out = [];
  if (r.why !== 'settled') out.push(`the run ended as "${r.why}", not settled`);
  const e = c.expect;
  for (const [i, v] of Object.entries(e.vars ?? {})) if (r.vars[i] !== v) out.push(`variable ${i} is ${r.vars[i]}, want ${v}`);
  for (const k of ['sw0', 'rec', 'crossed', 'owed', 'ent']) if (e[k] !== undefined && r[k] !== e[k]) out.push(`${k} is ${r[k]}, want ${e[k]}`);
  if (e.entries !== undefined) {
    if (r.entries.length !== e.entries) out.push(`the self-command handler was entered ${r.entries.length} time(s), want ${e.entries}`);
    const last = r.entries.at(-1);
    if (last) {
      if (e.liveEntry && !(last.slot >= 0 && last.talkEnt === last.slot)) out.push(`live talker: talk_ent ${last.talkEnt} is not its current slot ${last.slot}`);
      if (e.goneEntry && !(last.slot === -1 || last.slot === 255) ) out.push(`gone talker: the talker is on this screen (slot ${last.slot})`);
      if (e.goneEntry && last.talkEnt !== NO) out.push(`gone talker: talk_ent is ${last.talkEnt}, want the absent sentinel`);
      if (e.goneEntry && last.crossed !== e.goneEntry.crossed) out.push(`gone talker: talk_crossed is ${last.crossed}, want ${e.goneEntry.crossed}`);
    }
  }
  if (e.slotAfter) {
    if (r.slot < 0) out.push('the live talker is not on the screen at the end');
    if (e.slotAfter.dir !== undefined && r.slotDir !== e.slotAfter.dir) out.push(`the talker faces ${r.slotDir}, want ${e.slotAfter.dir}`);
    if (e.slotAfter.hidden && !(r.slotActive & R.ENT_HIDDEN)) out.push('the talker was not hidden');
    if (e.slotAfter.y !== undefined && r.slotY !== e.slotAfter.y) out.push(`the talker is at y ${r.slotY}, want ${e.slotAfter.y}`);
  }
  return out;
}

export const MAX_PROCS = 4;
const L5_FLAGS = { list: 'bool', build: 'value', run: 'bool', match: 'value', procs: 'value', mesen: 'value', out: 'value' };
const CASE_TIMEOUT_MS = 120000;

/** One emulator process for one built case. Never throws: an emulator error, a timeout and a nonzero exit are RECORDED, and each fails the case. */
export async function runOne(built, c, mesen, { timeoutMs = CASE_TIMEOUT_MS } = {}) {
  const base = { id: c.id, link: built.link, handlerAddrs: built.handlerAddrs };
  const child = spawn(mesen, [...EXEC_FLAGS.args, built.lua, built.rom], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let timedOut = false;
  let spawnError = null;
  child.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const [status, signal] = await new Promise((resolve) => { child.on('close', (code, sig) => resolve([code, sig])); child.on('error', (e) => { spawnError = e; resolve([null, null]); }); });
  clearTimeout(timer);
  const problems = [];
  if (spawnError) problems.push(`the emulator could not be started: ${spawnError.message}`);
  if (timedOut) problems.push(`the emulator timed out after ${timeoutMs} ms and was killed`);
  else if (!spawnError && status !== 0) problems.push(`the emulator exited with ${status === null ? `signal ${signal}` : `status ${status}`}, not 0`);
  const line = /^RESULT (.*)$/m.exec(out)?.[1];
  if (!line) return { ...base, exit: status, signal, rawResult: null, result: null, problems: [...problems, `no RESULT line (exit ${status ?? signal})`] };
  let r;
  try { r = JSON.parse(line); } catch (e) { return { ...base, exit: status, signal, rawResult: line, result: null, problems: [...problems, `the RESULT line is not JSON: ${e.message}`] }; }
  return { ...base, exit: status, signal, frames: r.frames, rawResult: line, result: r, problems: [...problems, ...caseProblems(c, r)] };
}

/** Parses the command line strictly; throws a plain Error naming the bad option. Nothing has been built or launched when it throws. */
export function parseL5Args(argv, { cases = CASES } = {}) {
  const a = parseFlags(argv, L5_FLAGS);
  const procs = wholeNumber(a.procs, 'procs', 1, MAX_PROCS, MAX_PROCS);
  let re;
  try { re = new RegExp(a.match ?? '.'); } catch (e) { throw new Error(`--match is not a regular expression: ${e.message}`); }
  const selected = cases.filter((c) => re.test(c.id));
  if (!selected.length) throw new Error(`--match ${JSON.stringify(a.match ?? '.')} selects no case: an empty certification selection is never a pass`);
  const modes = ['list', 'run'].filter((m) => a[m]);
  if (modes.length > 1) throw new Error('--list and --run are different modes');
  if (a.run && !a.out) throw new Error('--out=<json> is required with --run: the raw results are the evidence');
  if (!a.run && a.out) throw new Error('--out belongs to --run');
  if (!a.list && !a.run && !a.build) throw new Error('say what to do: --list, --build=<dir> or --run --out=<json>');
  return { list: Boolean(a.list), run: Boolean(a.run), build: a.build ? path.resolve(a.build) : null, procs, selected, mesen: a.mesen ?? MESEN_DEFAULT, out: a.out ? path.resolve(a.out) : null };
}

/** Whether EXACTLY the selected cases reported, each once. */
export function completeness(selected, results) {
  const ids = results.map((r) => r.id);
  const missing = selected.filter((c) => !ids.includes(c.id)).map((c) => c.id);
  const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const extra = [...new Set(ids.filter((id) => !selected.some((c) => c.id === id)))];
  return { complete: missing.length === 0 && twice.length === 0 && extra.length === 0 && results.length === selected.length, missing, twice, extra };
}

/**
 * The whole command as a function (so a test can drive it): returns { exitCode, stdout, stderr }. exitCode 2 = a malformed option or a full machine (nothing was
 * built or launched), 1 = a failed or INCOMPLETE certification, 0 = every selected case ran to completion and passed.
 */
export async function runL5(argv, { cases = CASES, running } = {}) {
  let o;
  try { o = parseL5Args(argv, { cases }); } catch (e) { return { exitCode: 2, stdout: '', stderr: `error: ${e.message}\n` }; }
  const lines = [];
  if (o.list) { for (const c of o.selected) lines.push(`${c.id} ${JSON.stringify(c.expect)}`); lines.push(`${o.selected.length} cases`); return { exitCode: 0, stdout: lines.join('\n') + '\n', stderr: '' }; }
  if (o.run) {
    try {
      if (!fs.existsSync(o.mesen)) throw new Error(`Mesen is not at ${o.mesen} (--mesen=<path>)`);
      assertRoom(o.procs, running ?? countMesen());
    } catch (e) { return { exitCode: 2, stdout: '', stderr: `error: ${e.message}\n` }; }
  }
  const outDir = o.build ?? await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-l5-'));
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: o.run ? o.procs : 2 }, async () => {
    for (;;) {
      const c = o.selected[next++];
      if (!c) return;
      const built = await buildCase(c, outDir);
      if (!o.run) { lines.push(`built ${c.id}`); continue; }
      const r = await runOne(built, c, o.mesen);
      results.push(r);
      lines.push(`${r.problems.length ? 'FAIL' : 'ok  '} ${c.id} ${r.frames ?? '-'} frames ${r.problems.join('; ')}`);
    }
  }));
  if (!o.run) { lines.push(`${o.selected.length} cases built`); return { exitCode: 0, stdout: lines.join('\n') + '\n', stderr: '' }; }
  const { complete, missing, twice, extra } = completeness(o.selected, results);
  const failed = results.filter((r) => r.problems.length).length;
  const prov = processProvenance(REPO, o.mesen);
  const here = (f) => sha256(fs.readFileSync(path.join(HERE, f)));
  const doc = {
    l5: true, complete, procs: o.procs, selected: o.selected.map((c) => c.id), completed: results.length, failed, missing, reportedTwice: twice, unselected: extra,
    fingerprints: { ...prov, runner: here('sw_talker_battle.mjs'), template: here('sw_talker_battle.lua.template'), cases: sha256(JSON.stringify(CASES.map((c) => [c.id, c.expect]))) },
    results: results.sort((x, y) => (x.id < y.id ? -1 : 1))
  };
  await fs.promises.writeFile(o.out, JSON.stringify(doc, null, 1));
  lines.push(`${o.selected.length} cases selected, ${results.length} completed, ${failed} failed${complete ? '' : ` -- INCOMPLETE (missing ${missing.length}, reported twice ${twice.length}, unselected ${extra.length})`}; results in ${o.out}`);
  return { exitCode: failed || !complete ? 1 : 0, stdout: lines.join('\n') + '\n', stderr: '' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = await runL5(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.exitCode);
}
