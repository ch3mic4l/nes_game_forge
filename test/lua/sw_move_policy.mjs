// The ONE policy of the M11 measurement commands (phase 3a slice S3a, fix round 2, review 2 required change 2): what a cell is, which options
// the commands accept, what a measured cell must show and which rows are held to the gate. `run_sw_move_sweep.mjs` (the campaign) and the
// standalone CLI of `run_sw_move_manifest.mjs` (one cell) both validate through this file, so neither can be the weaker path.
//
// Not a harness file (test/lua/sw_provenance.mjs HARNESS_FILES): it adds the scene's COMPACTION (needsCompact) and the rules, nothing the
// recorded curve's provenance reads.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { measureMove, validateCell, populations, CONTINUATION, GATE, TAILS, LEADS, TOUCH } from './run_sw_move_manifest.mjs';
import { ANIM_PRESETS } from './sw_bound_sweep.mjs';
import { REPO } from './sw_manifest_scene.mjs';
import { compactRoot } from './sw_compact_root.mjs';

export const MACHINE_CEILING = 20; // Chris's limit: Mesen processes at once, all runs together
export const COINCIDENCE_KINDS = ['strip', 'arm', 'pub'];

// ----------------------------------------------------------------- options

/** Mesen processes already on the machine (0 when pgrep finds none; a pgrep that cannot run is an error, never "0"). */
export function countMesen() {
  const r = spawnSync('pgrep', ['-c', '-x', 'Mesen'], { encoding: 'utf8' });
  if (r.error || ![0, 1].includes(r.status)) throw new Error(`cannot count the running Mesen processes (pgrep: ${r.error?.message ?? `status ${r.status}`})`);
  const n = Number((r.stdout ?? '').trim());
  if (!Number.isInteger(n) || n < 0) throw new Error(`cannot count the running Mesen processes (pgrep printed ${JSON.stringify(r.stdout)})`);
  return n;
}

/** `needed` more Mesen processes must fit under the ceiling beside the `running` ones. */
export function assertRoom(needed, running = countMesen()) {
  if (needed + running > MACHINE_CEILING) throw new Error(`${needed} Mesen process(es) plus ${running} already running exceeds the machine ceiling of ${MACHINE_CEILING}`);
}

/**
 * Parses `--name=value` flags against `spec` ({ name: 'value' | 'bool' }): an unknown flag, a bare argument, a repeated flag, a valued flag with
 * no value and a boolean flag carrying one are each an error naming the flag.
 */
export function parseFlags(argv, spec) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/s.exec(arg);
    if (!m) throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    const [, name, value] = m;
    if (!Object.hasOwn(spec, name)) throw new Error(`unknown option --${name}`);
    if (Object.hasOwn(out, name)) throw new Error(`--${name} was given twice`);
    if (spec[name] === 'bool') {
      if (value !== undefined) throw new Error(`--${name} takes no value, got ${JSON.stringify(value)}`);
      out[name] = true;
    } else {
      if (value === undefined || value === '') throw new Error(`--${name} needs a value`);
      out[name] = value;
    }
  }
  return out;
}

/** A whole number lo..hi from a flag's text; `raw` undefined gives `dflt`. */
export function wholeNumber(raw, name, lo, hi, dflt) {
  const s = raw ?? String(dflt);
  if (!/^\d+$/.test(s)) throw new Error(`--${name} must be a whole number, got ${JSON.stringify(raw)}`);
  const v = Number(s);
  if (!Number.isSafeInteger(v) || v < lo || v > hi) throw new Error(`--${name} must be ${lo}..${hi}, got ${v}`);
  return v;
}

export const oneOf = (raw, name, allowed, dflt) => {
  const v = raw ?? dflt;
  if (!allowed.includes(v)) throw new Error(`--${name} must be one of ${allowed.join(', ')}, got ${JSON.stringify(raw)}`);
  return v;
};

// ----------------------------------------------------------------- the cell

/** A cell is measured on a COMPACTED copy of its scene when it is an RPG project with a switch-bound tile and a Flash command (below). */
export const needsCompact = (c) => c.gt === 'rpg' && Boolean(c.bound) && (c.lead === 'flash' || c.tail === 'flash');

export const cellId = (c) => [c.which, c.gt, c.wide ? 'wide' : 'tight', c.pop, c.anim ?? 'P0', c.bound ? 'bound' : 'plain', `lead-${c.lead}`, `tail-${c.tail}`, `d${c.dist}`, `y${c.touchY}`, ...(needsCompact(c) ? ['compact'] : [])].join('/');

/** What a cell must show for its figures to count (validateCell's `expect`). */
export function expectFor(c) {
  const e = { step: 'strip', final: true, continuation: CONTINUATION[c.tail] ? c.tail : undefined };
  // The parent never calls the camera window during a Move (finding F6), so no strip is armed there: it only has to have timed its step and final
  // bodies and run the tail's continuation; the strip/coincidence compositions are properties of the new engine.
  if (c.which === 'parent') return { step: c.lead === 'flash' ? false : true, final: true, continuation: e.continuation }; // a Flash-lead arrangement is a short Move: the final body alone
  if (c.lead === 'flash') { e.coincidence = c.kind; e.step = false; }
  if (c.lead === 'say') { e.step = 'strip'; }
  return e;
}

/**
 * Whether the gate G <= 29,780 applies to a cell's step and final rows: EVERY new-engine cell, whatever its lead. The only bodies a Say lead
 * exempts are its pre-Move text-box close bodies, which `classify` already files under `before.*` (a separately classified, known
 * dialogue-restoration cost, docs/design-streamed-worlds-phase3a.md); the Move's own step and final bodies stay M11.
 */
export const gated = (c) => c.which === 'new';

/** Every problem that makes a measured cell unusable or over the gate: validateCell's composition rules plus the gate on its gated rows. */
export function cellProblems(summary, cell, { gate = GATE } = {}) {
  const out = validateCell(summary, expectFor(cell));
  if (gated(cell)) {
    for (const [row, g] of [['M11a step', summary.maxStep], ['M11b final', summary.maxFinal]]) if (!(g <= gate)) out.push(`${row} G = ${g} exceeds the gate ${gate}`);
  }
  return out;
}

/** The tile count of a cell's scene: the bound variant holds one tile less (the switch-bound tile makes it 14). */
export const cellTiles = (c, tiles) => (c.bound ? tiles - 1 : tiles);

/** One measurement of a cell (the compaction, when the cell needs it, goes through the compacting root). */
export function measureCell(c, { tiles = 15, root = REPO } = {}) {
  return measureMove({ ...c, tiles: cellTiles(c, tiles), root: needsCompact(c) ? compactRoot(root) : root });
}

// ----------------------------------------------------------------- the standalone command's options

const CELL_FLAGS = { gt: 'value', tail: 'value', lead: 'value', dist: 'value', pop: 'value', anim: 'value', bound: 'value', touchY: 'value', root: 'value', which: 'value', wide: 'value', tiles: 'value', coincide: 'value' };

/**
 * `node test/lua/run_sw_move_manifest.mjs ...` : one cell, held to the same rules as a campaign cell. Every malformed or out-of-range option
 * throws a plain Error naming it; the 20-process ceiling is checked before anything is launched.
 */
export function parseCellOptions(argv, { running } = {}) {
  const a = parseFlags(argv, CELL_FLAGS);
  const gt = oneOf(a.gt, 'gt', ['action', 'rpg'], 'action');
  const tail = oneOf(a.tail, 'tail', Object.keys(TAILS), 'none');
  const lead = oneOf(a.lead, 'lead', Object.keys(LEADS), 'none');
  const tiles = wholeNumber(a.tiles, 'tiles', 8, 16, 15);
  const bound = oneOf(a.bound, 'bound', ['0', '1'], '0') === '1';
  const wide = oneOf(a.wide, 'wide', ['0', '1'], '1') === '1';
  const pop = oneOf(a.pop, 'pop', Object.keys(populations(bound ? tiles - 1 : tiles)), 'many-small');
  const anim = a.anim === undefined ? null : oneOf(a.anim, 'anim', Object.keys(ANIM_PRESETS), null);
  const dist = wholeNumber(a.dist, 'dist', 1, 255, 150);
  const touchY = wholeNumber(a.touchY, 'touchY', 0, 239, TOUCH.y);
  let root = REPO;
  if (a.root !== undefined) {
    root = path.resolve(a.root);
    if (!fs.existsSync(path.join(root, 'main/build/pipeline.js'))) throw new Error(`--root ${JSON.stringify(a.root)} is not a project tree (no main/build/pipeline.js)`);
    if (a.which === undefined) throw new Error('--root needs --which=new|parent: the gate applies to the new engine only');
  }
  const which = oneOf(a.which, 'which', ['new', 'parent'], 'new');
  let kind;
  if (a.coincide !== undefined) {
    if (lead !== 'flash') throw new Error('--coincide names a Flash-lead arrangement: it needs --lead=flash');
    if (which !== 'new') throw new Error('--coincide is a property of the new engine: it needs --which=new');
    kind = oneOf(a.coincide, 'coincide', COINCIDENCE_KINDS);
  } else if (lead === 'flash' && which === 'new') {
    throw new Error(`--lead=flash on the new engine must name the coincidence it claims: --coincide=${COINCIDENCE_KINDS.join('|')}`);
  }
  assertRoom(1, running ?? countMesen());
  const cell = { which, gt, wide, pop, anim, bound, lead, tail, dist, touchY, ...(kind ? { kind } : {}) };
  return { cell, tiles, root };
}

/**
 * The standalone command, as a function (so a test can inject `measure`): parse -> measure -> hold the cell to the policy.
 * exitCode 2 = a malformed option or a full machine (nothing was launched), 1 = the cell is unsound or over the gate, 0 = sound.
 */
export async function runCell(argv, { measure = measureCell, running } = {}) {
  let opt;
  try { opt = parseCellOptions(argv, { running }); } catch (e) { return { exitCode: 2, stdout: '', stderr: `error: ${e.message}\n` }; }
  const t0 = Date.now();
  const { summary } = await measure(opt.cell, { tiles: opt.tiles, root: opt.root });
  const problems = cellProblems(summary, opt.cell);
  const text = JSON.stringify({ ...summary, problems: [...(summary.problems ?? []), ...problems.filter((p) => !(summary.problems ?? []).includes(p))], ms: Date.now() - t0 });
  return { exitCode: problems.length ? 1 : 0, stdout: text + '\n', stderr: '' };
}
