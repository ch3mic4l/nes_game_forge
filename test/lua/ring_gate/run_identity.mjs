#!/usr/bin/env node
// Row 1 -- ROM identity, every cell, plus the STREAM_RING=0 byte-identity proof for the six fixtures and the four-screen control.
//   node test/lua/ring_gate/run_identity.mjs [--json=<file>] [--sabotage=<name>] [--ring=1|2] [--prov-dir=<dir>] [--log=<path>]
// Exit 0 = every cell's outcome is the declared one; 1 = a declared outcome was not met; 2 = an unexpected build error or a bad invocation (errors
// take precedence over every other verdict).
// --sabotage=<name> layers sabotage/<name>.patch on top of the complete prototype. Each cell's outcome (catch / pass) is DECLARED per sabotage in
// ringsabotage.mjs and compared with the actual one; combinations proven unbuildable from source are predeclared witnesses (the build is still
// attempted and must fail with the declared message). --log=<path> only links the log file the caller redirects this run to into the stamps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTree, loadTree, ROOT, sha256 } from './ringtree.mjs';
import { CELLS, GAME_TYPES, ringProject, buildCell } from './ringworld.mjs';
import { identityFailures } from './ringidentity.mjs';
import { harnessFingerprint, stampResult, writeAttempt, finishAttempt, nesasmStamp, hostStamp, fileStamp } from './ringprov.mjs';
import { IDENTITY_OUTCOME, buildErrorWitness, classifyBuildError } from './ringsabotage.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const die = (msg) => { console.error(`run_identity: ${msg}`); process.exit(2); };
for (const a of args) if (!['sabotage', 'json', 'ring', 'prov-dir', 'log'].some((k) => a.startsWith(`--${k}=`))) die(`unknown argument ${a}`);
if (flag('ring') !== undefined && !['1', '2'].includes(flag('ring'))) die(`--ring=${flag('ring')} is not 1|2`);
const sabotage = flag('sabotage');
const jsonOut = flag('json');
const provDir = flag('prov-dir');
const stamp = sabotage ? `sab-${sabotage}-` : '';
const links = { result: jsonOut ? path.resolve(jsonOut) : null, log: flag('log') ? path.resolve(flag('log')) : null };
if (sabotage && !IDENTITY_OUTCOME[sabotage]) die(`sabotage ${sabotage} has no declared identity outcome in ringsabotage.mjs`);
const BULK = 3000;
const FIXTURES = ['sample', 'sample-rpg', 'sample-mmc1', 'sample-mmc3', 'sample-u512', 'sample-rpg-mmc1'];

const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);

/** Builds fixture `name` (from a mkdtemp copy; the fixture itself is never mutated) through `tree`, with a complete attempt stamp. */
async function fixtureRom(tree, name, kind) {
  const loaded = await loadTree(tree);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ring-fix-${name}-`));
  const lines = [];
  let stampPath = null;
  try {
    fs.cpSync(path.join(ROOT, name), dir, { recursive: true });
    fs.rmSync(path.join(dir, 'build'), { recursive: true, force: true });
    const project = await (await import(new URL(`file://${path.join(tree.root, 'main/project-io.js')}`).href)).loadProject(dir);
    stampPath = writeAttempt(provDir, `ring0-${name}-${kind}`, {
      kind: 'ring0-build', fixture: name, tree: kind, links: { result: links.result, log: links.log, comparison: provDir ? path.join(provDir, `ring0-${name}.json`) : null },
      head: tree.head, trackedStatus: tree.status, baseline: tree.baseline, patches: tree.patches,
      mapper: project.cartridge?.mapper ?? null, mirroring: project.cartridge?.mirroring ?? null, projectSha256: sha256(JSON.stringify(canonical(project))),
      harness: harnessFingerprint(), nesasm: nesasmStamp(), host: hostStamp(), builtFrom: 'mkdtemp copy of the fixture; the fixture is never mutated'
    });
    const built = await loaded.buildProject({ dir, project, log: (l) => lines.push(l) });
    const rom = fs.readFileSync(path.join(dir, 'build/game.nes'));
    const cfgText = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
    const num = (n) => Number(new RegExp(`^${n}\\s*=\\s*(\\d+)`, 'm').exec(cfgText)?.[1] ?? NaN);
    const banks = {};
    for (const l of lines) { const m = l.match(/^BANK\s+(\d+)\s+(\d+)\/\s*(\d+)\s*$/); if (m) banks[m[1]] = { used: +m[2], free: +m[3] }; }
    const romSha = sha256(rom);
    finishAttempt(stampPath, 'built', {
      romSha256: romSha, header: { mapper: (rom[6] >> 4) | (rom[7] & 0xf0), flags6: rom[6], fourScreen: (rom[6] & 8) !== 0 },
      streamRing: num('STREAM_RING'), streamingEnabled: num('STREAMING_ENABLED'),
      placement: Number.isFinite(num('SW_DLG_BANKED')) ? { generatedFlag: num('SW_DLG_BANKED') } : 'n/a (no streamed dialogue overlay in this fixture)',
      resources: { bankUsage: banks, buildLogLines: lines.length, buildLogSha256: sha256(lines.join('\n')) }
    });
    return { sha: romSha, stampPath };
  } catch (e) {
    finishAttempt(stampPath, 'error', { error: { firstLine: String(e.message).split('\n')[0], message: String(e.message).slice(0, 4000) }, resources: { buildLogTail: lines.slice(-12) } });
    throw e;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const results = [];
// failures: outcomes that contradict their declaration (a positive cell that fails, a declared catch that passes, ...); errors: an unexpected
// build or assembler error -- never a catch, and the exit code ranks it above every other verdict (2). Witnessed build errors are neither.
let failures = 0;
let errors = 0;
let witnessed = 0;
let caught = 0;
function record(row) {
  results.push(row);
  if (row.error) errors++; else if (row.mismatch || row.fails.length && !sabotage) failures++;
}

const tree = makeTree({ ring: true, extra: sabotage ? [sabotage] : [] });

// ---- STREAM_RING=0: the six fixtures through the patched tree are byte-identical to the unpatched tree (every constituent build stamped)
if (!sabotage) {
  const pristine = makeTree({ ring: false });
  for (const name of FIXTURES) {
    let a, b;
    try { [a, b] = [await fixtureRom(pristine, name, 'pristine'), await fixtureRom(tree, name, 'patched')]; }
    catch (e) { record({ row: 'ring0-identity', cell: name, gameType: '-', fails: [], error: `BUILD ERROR (not a catch): ${e.message.split('\n')[0]}` }); continue; }
    record({ row: 'ring0-identity', cell: name, gameType: '-', fails: a.sha === b.sha ? [] : [`patched ROM ${b.sha.slice(0, 12)} != unpatched ${a.sha.slice(0, 12)}`], sha256: b.sha });
    if (provDir) {
      // the constituents get their result first, so the hashes the comparison records are of their FINAL stamps
      const cmpPath = path.join(provDir, `ring0-${name}.json`);
      for (const st of [a.stampPath, b.stampPath]) stampResult(st, { row: 'ring0-identity', comparison: cmpPath, equal: a.sha === b.sha });
      fs.writeFileSync(cmpPath, JSON.stringify({ schema: 'ring-prov-3', kind: 'ring0-identity-comparison', status: 'built', fixture: name, baseline: tree.baseline, head: tree.head, trackedStatus: tree.status,
        patches: tree.patches, pristineRomSha256: a.sha, patchedRomSha256: b.sha, equal: a.sha === b.sha,
        constituents: { pristine: { stamp: a.stampPath, sha256: sha256(fs.readFileSync(a.stampPath)) }, patched: { stamp: b.stampPath, sha256: sha256(fs.readFileSync(b.stampPath)) } },
        links: { result: links.result, log: links.log }, harness: harnessFingerprint(), results: [{ row: 'ring0-identity', equal: a.sha === b.sha }] }, null, 1));
    }
  }
  fs.rmSync(pristine.root, { recursive: true, force: true });
}

// ---- row 1: every cell x game type x placement it can reach
for (const cell of CELLS.filter((c) => !flag('ring') || c.ring === Number(flag('ring')))) {
  for (const gameType of GAME_TYPES) {
    for (const banked of gameType === 'rpg' ? [false, true] : [false]) {
      const { project } = ringProject({ cell, gameType, bulkText: banked ? BULK : 0 });
      const placement = banked ? 'banked' : 'resident';
      const declared = sabotage ? IDENTITY_OUTCOME[sabotage](cell, gameType, banked) : 'pass';
      let built;
      try { built = await buildCell({ tree, project, cell, gameType, provDir, links, sabotage: sabotage ?? null, label: `${stamp}${cell.id}-${gameType}${banked ? '-banked' : ''}`, requestedPlacement: placement }); }
      catch (e) {
        const msg = e.message.split('\n')[0];
        const cls = classifyBuildError(sabotage, cell, gameType, e.message);
        if (cls.kind === 'witnessed') { witnessed++; results.push({ row: 'identity', cell: cell.id, gameType, placement, fails: [], witnessed: `predeclared unbuildable: ${msg}` }); stampResult(e.provPath, { row: 'identity', witnessedBuildError: cls }); }
        else { record({ row: 'identity', cell: cell.id, gameType, placement, fails: [], error: `BUILD ERROR (not a catch${cls.declared ? `; declared ${cls.declared}` : ''}): ${msg}` }); stampResult(e.provPath, { row: 'identity', error: msg }); }
        continue;
      }
      if (sabotage && buildErrorWitness(sabotage, cell, gameType)) {
        record({ row: 'identity', cell: cell.id, gameType, placement, fails: [], mismatch: 'predeclared UNBUILDABLE combination built successfully: the source-proof declaration is contradicted', prov: built.prov });
        stampResult(built.provPath, { row: 'identity', contradictedDeclaration: true });
        fs.rmSync(built.dir, { recursive: true, force: true });
        continue;
      }
      const fails = identityFailures(built, cell, { expectBanked: banked });
      const actual = fails.length ? 'catch' : 'pass';
      if (actual === 'catch') caught++;
      record({ row: 'identity', cell: cell.id, gameType, placement, fails, declared, mismatch: actual === declared ? null : `declared ${declared}, observed ${actual}`, prov: built.prov });
      stampResult(built.provPath, { row: 'identity', fails, declared, observed: actual, sabotage: sabotage ?? null });
      fs.rmSync(built.dir, { recursive: true, force: true });
    }
  }
}

// ---- the control: a four-screen build of the same project must FAIL the identity cell (a silent fallback counted as a ring pass)
if (!sabotage) {
  for (const cell of [CELLS.find((c) => c.id === 'U512-V'), CELLS.find((c) => c.id === 'U512-H')]) {
    const { project } = ringProject({ cell, gameType: 'action', n: 2 });
    project.cartridge.mirroring = 'fourscreen';
    project.maps[0].gridW = 2; project.maps[0].gridH = 2; // four-screen keeps both axes live: a 2 x 2 world
    project.maps[0].screens = [0, 1, 2, 3].map(() => structuredClone(project.maps[0].screens[0]));
    let built;
    try { built = await buildCell({ tree, project, cell, gameType: 'action', provDir, links, label: `control-four-screen-${cell.id}` }); }
    catch (e) { record({ row: 'identity-control', cell: `${cell.id} built four-screen`, gameType: 'action', fails: [], error: `BUILD ERROR (not a catch): ${e.message.split('\n')[0]}` }); continue; }
    const fails = identityFailures(built, cell, { expectBanked: false });
    record({ row: 'identity-control', cell: `${cell.id} built four-screen`, gameType: 'action', fails: fails.length ? [] : ['four-screen build PASSED the identity cell'], seen: fails });
    stampResult(built.provPath, { row: 'identity-control', rejectedBy: fails });
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
}
fs.rmSync(tree.root, { recursive: true, force: true });

const pad = (s, n) => String(s).padEnd(n);
for (const r of results) {
  const verdict = r.error ? `ERROR ${r.error}` : r.witnessed ? `N/A ${r.witnessed}` : r.mismatch ? `MISMATCH ${r.mismatch}${r.fails.length ? ' [' + r.fails.join('; ') + ']' : ''}` : sabotage ? (r.fails.length ? `CAUGHT (declared) ${r.fails.join('; ')}` : 'PASS (declared: identity cannot see this sabotage)') : r.fails.length ? 'FAIL ' + r.fails.join('; ') : 'PASS';
  console.log(`${pad(r.row, 16)} ${pad(r.cell, 22)} ${pad(r.gameType, 7)} ${pad(r.placement ?? '', 9)} ${verdict}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
const mismatches = results.filter((r) => r.mismatch).length;
if (sabotage) {
  const declaredCatches = results.filter((r) => r.declared === 'catch').length;
  console.log(`sabotage ${sabotage}: ${caught} cells caught (${declaredCatches} declared), ${mismatches} outcomes differ from their declaration, ${witnessed} predeclared-unbuildable cells witnessed, ${errors} unexpected build errors (errors are not catches)`);
} else console.log(errors ? `${errors} BUILD ERRORS, ${failures} FAILING` : failures ? `${failures} FAILING` : 'all identity cells pass');
process.exit(errors ? 2 : failures || mismatches ? 1 : 0);
