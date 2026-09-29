// Large streamed worlds (ROADMAP item 15), phase 2 slice 10b, review round 1 finding F1 -- the Build
// panel's "Battle system" meter must show the region total the build decides on, including the
// dialogue overlay when a pinching streamed RPG relocates it into that bank.
//
// The placement decision has ONE definition (main/build/streamplacement.js, streamworldDialogueBanked);
// the panel reaches it through battleRegionBytesPlaced, which the renderer can import because nothing
// in that module's import closure touches Node. This file pins:
//   1. that closure stays renderer-safe (no Node builtin, no import of generate.js);
//   2. the panel's own source asks for the placed figure (a revert to the two-argument
//      battleRegionBytes call fails here);
//   3. what the panel would show: the pinching RPG includes the 1,385-byte overlay, its resident twin
//      does not, in every variant;
//   4. that figure is what nesasm really put in the battle bank, and the same figure checkCapacity's
//      own region refusal quotes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSpell } from '../../shared/project.js';
import { resolveMapper, codeRegions } from '../../shared/cartridge.js';
import { checkCapacity, streamworldDialogueBanked } from '../../main/build/generate.js';
import { buildProject } from '../../main/build/pipeline.js';
import { battleRegionBytes, battleRegionCeiling, STREAMWORLD_DIALOGUE_BATTLE_ALLOWANCE } from '../../main/build/battletables.js';
import { battleRegionBytesPlaced } from '../../main/build/streamplacement.js';
import { nodeDomViolations, scanSource } from '../lib/sourcescan.js';
import { buildPinching } from '../lib/streamedpinching.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const MAPPER = resolveMapper(30);
const VARIANTS = ['nosave', 'save', 'move'];
const OVERLAY_BYTES = 1385; // the relocated overlay's own share of the battle region, literal

// ---------------------------------------------------------------------------------------------
// 1. Renderer safety of the module the panel imports.
// ---------------------------------------------------------------------------------------------

/** Every file reachable through static imports/re-exports from `entry`, repo-relative. */
function importClosure(entry) {
  const seen = new Map();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const specifiers = new Set([...scanSource(text).imports, ...[...text.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1])]);
    seen.set(file, { text, specifiers: [...specifiers] });
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue;
      queue.push(path.relative(ROOT, path.resolve(ROOT, path.dirname(file), specifier)));
    }
  }
  return seen;
}

test('F1: the module the Build panel imports has a renderer-safe import closure (shared/ plus three pure compilers, no Node, no generate.js)', () => {
  const closure = importClosure('main/build/streamplacement.js');
  const allowedBuild = new Set(['main/build/streamplacement.js', 'main/build/songcompile.js', 'main/build/textcompile.js', 'main/build/battletables.js']);
  for (const [file, { text, specifiers }] of closure) {
    assert.ok(file.startsWith('shared/') || allowedBuild.has(file), `${file} is outside shared/ and the allowed pure compilers`);
    assert.deepEqual(nodeDomViolations(text), [], `${file} must touch no Node API or DOM`);
    for (const specifier of specifiers) assert.ok(specifier.startsWith('.'), `${file} imports the bare specifier ${specifier}`);
  }
  assert.ok(closure.has('main/build/textcompile.js') && closure.has('shared/project.js'), 'the walk must really reach the compilers and shared/');
  assert.equal(closure.has('main/build/generate.js'), false, 'the placement module must not import the generator');
});

test('F1: the module scan is not vacuous -- it does see a Node import added to the closure', () => {
  assert.ok(nodeDomViolations("import fs from 'node:fs';\nexport const x = fs;\n").length > 0);
});

// ---------------------------------------------------------------------------------------------
// 2. The panel asks for the placed figure.
// ---------------------------------------------------------------------------------------------

test('F1: renderer/forges/build/build.js feeds the Battle system meter battleRegionBytesPlaced, never the two-argument battleRegionBytes', () => {
  const text = fs.readFileSync(path.join(ROOT, 'renderer/forges/build/build.js'), 'utf8');
  const { identifiers, imports } = scanSource(text);
  assert.ok(imports.includes('../../../main/build/streamplacement.js'), 'the panel imports the placement module');
  assert.equal(identifiers.some((id) => id.name === 'battleRegionBytes'), false, 'the panel must not call the unplaced battleRegionBytes at all');
  const code = text.split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  assert.match(
    code,
    /meter\(\s*'Battle system',\s*battleRegionBytesPlaced\(project, mapper\),\s*battleRegionCeiling\(mapper\)\s*\)/,
    'the Battle system meter must be battleRegionBytesPlaced(project, mapper) over battleRegionCeiling(mapper)'
  );
});

// ---------------------------------------------------------------------------------------------
// 3. What the panel would show.
// ---------------------------------------------------------------------------------------------

test('F1: a pinching streamed RPG shows the 1,385-byte overlay in its battle meter; its resident twin does not (every variant)', () => {
  assert.equal(STREAMWORLD_DIALOGUE_BATTLE_ALLOWANCE, OVERLAY_BYTES);
  for (const variant of VARIANTS) {
    const { project } = buildPinching(variant);
    const { project: twin } = buildPinching(variant, { twin: true });
    assert.equal(streamworldDialogueBanked(project, MAPPER), true, `${variant}: pinching relocates`);
    assert.equal(streamworldDialogueBanked(twin, MAPPER), false, `${variant}: the twin stays resident`);
    assert.equal(
      battleRegionBytesPlaced(project, MAPPER) - battleRegionBytes(project, MAPPER),
      OVERLAY_BYTES,
      `${variant}: the pinching project's meter must include the overlay`
    );
    assert.equal(battleRegionBytesPlaced(twin, MAPPER), battleRegionBytes(twin, MAPPER), `${variant}: the resident twin's meter must not`);
    console.log(
      `S10B-F1 ${variant}: panel figure ${battleRegionBytesPlaced(project, MAPPER)} (unplaced ${battleRegionBytes(project, MAPPER)}) of ${battleRegionCeiling(MAPPER)}; ` +
        `twin ${battleRegionBytesPlaced(twin, MAPPER)}`
    );
  }
});

// ---------------------------------------------------------------------------------------------
// 4. The figure is the build's own.
// ---------------------------------------------------------------------------------------------

async function realBattleRegionBytes(t, project) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-s10b-region-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const lines = [];
  await buildProject({ dir, project, log: (line) => lines.push(line) });
  const slot = codeRegions(MAPPER, project.tilesets.length, 1)[0];
  assert.ok(slot, 'codeRegions must reserve the RPG battle region');
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${slot.nesasmBank}\\s`).test(line));
  assert.ok(bankLine, `nesasm's usage table never mentioned bank ${slot.nesasmBank}`);
  return Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
}

for (const variant of VARIANTS) {
  test(`F1 [${variant}]: the panel's battle figure equals nesasm's real battle-bank usage, pinching and resident twin alike`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
    for (const twin of [false, true]) {
      const { project } = buildPinching(variant, { twin });
      const real = await realBattleRegionBytes(t, project);
      assert.equal(battleRegionBytesPlaced(project, MAPPER), real, `${variant}${twin ? ' twin' : ''}: the meter must equal what the assembler put in the bank`);
      assert.ok(real <= battleRegionCeiling(MAPPER), 'and it fits');
    }
  });
}

test('F1: the figure the panel shows is the figure checkCapacity refuses on when the overlay tips the battle region over', () => {
  const { project } = buildPinching('nosave');
  for (let i = 0; i < 115; i++) project.spells.push(createSpell(project.spells.length, `Spell${i}`));
  const shown = battleRegionBytesPlaced(project, MAPPER);
  const total = battleRegionCeiling(MAPPER);
  assert.ok(battleRegionBytes(project, MAPPER) <= total, 'precondition: without the overlay the region fits (the two-argument figure would promise room)');
  assert.ok(shown > total, 'the panel figure crosses the ceiling once the overlay is counted');
  const refusal = checkCapacity(project).problems.find((x) => x.severity === 'error' && x.where === 'Build & Play' && /dialogue code moves into/.test(x.message));
  assert.ok(refusal, 'checkCapacity refuses this project for the battle region');
  assert.match(refusal.message, new RegExp(`needs ${shown} bytes there but the bank holds ${total}`), 'the refusal quotes the panel figure and the panel ceiling');
});
