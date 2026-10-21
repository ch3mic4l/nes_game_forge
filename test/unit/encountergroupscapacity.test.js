// Encounter groups, generator tables and capacity (handoff-next/encgroups appendix B6 and D, commit C2): the row/entry policy
// literals, the entry and row boundaries, the advice that reaches a build, the Code Forge pair and the table-byte term against the
// bytes the generator really emitted. sample-rpg is only read; builds go to mkdtemp directories.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createProject, validateProject, projectWithoutEncounterGroups, planEncounterConversion, applyEncounterConversion, encounterEntryTotal, encounterRowPlan } from '../../shared/project.js';
import { KERNEL_SLACK, checkCapacity, kernelCodeBytes, kernelTableBytes, generateAssets, assertEncounterGroupBounds, ENCGROUP_KERNEL_ALLOWANCE } from '../../main/build/generate.js';
import { resolveMapper, prgLayout } from '../../shared/cartridge.js';
import {
  SAMPLE_RPG, rpgBase, addMonsters, addMap, pushGroup, groupMap, legacyMap, buildTo, dbBytes, bootRom, attempt
} from '../lib/encgroups.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm ? 'nesasm not found on PATH' : !fs.existsSync(SAMPLE_RPG) && 'sample-rpg missing';
const FF = 0xff;
const errorsOf = (project, rule) => validateProject(project).filter((p) => p.severity === 'error' && (!rule || p.rule === rule));
const tableBytesOf = (maps) => ['map_enc_off', 'enc_thr', 'enc_grp', 'enc_group_actors'].reduce((sum, label) => sum + (dbBytes(maps, label)?.length ?? 0), 0);

/** A bare MMC3 RPG with four monster actors and `groupCount` single-monster groups -- room for dozens of maps. */
function bareRpg(groupCount = 8) {
  const project = createProject('Enc', 'rpg');
  project.cartridge.mapper = 4;
  for (let i = 0; i < 4; i++) project.sprites.actors.push({ name: `Mon${i}`, behavior: 'monster', hp: 5, damage: 1 });
  for (let g = 0; g < groupCount; g++) pushGroup(project, `G${g}`, [g % 4]);
  return project;
}

/** Appends a rate>0 group map whose table lists `groups` (weight 1 each); returns its index. */
function addGroupMap(project, groups, rate = 5) {
  const index = addMap(project, `M${project.maps.length}`);
  groupMap(project.maps[index], rate, groups.map((g) => [g, 1]));
  return index;
}

// ------------------------------------------------------------------------------------------------------ row and entry policy

test('row policy literals: unreferenced, dead and rate-0-only groups get no row; rows dense by authored id; enc_grp unscaled; no empty row without a fallback', { skip }, async (t) => {
  const project = await rpgBase(1);
  addMonsters(project, 1);
  pushGroup(project, 'G0', [0]); // referenced
  pushGroup(project, 'G1', [3]); // authored, never referenced
  pushGroup(project, 'G2', [200]); // dead
  pushGroup(project, 'G3', [4]); // used only by a rate-0 map
  pushGroup(project, 'G4', [3, 4]); // referenced
  groupMap(project.maps[0], 5, [[4, 1], [2, 1], [0, 1]]); // the dead group's entry is dropped at compile
  const quiet = addMap(project);
  groupMap(project.maps[quiet], 0, [[3, 1]]);
  const built = await buildTo(t, project, 'rows');
  assert.deepEqual(dbBytes(built.maps, 'enc_group_actors'), [0, FF, FF, FF, 3, 4, FF, FF], 'two rows (G0, G4), no empty row');
  assert.deepEqual(dbBytes(built.maps, 'enc_grp'), [1, 0], 'entries in table order, rows unscaled: G4 = row 1, G0 = row 0');
  assert.deepEqual(dbBytes(built.maps, 'enc_thr'), [127, 255]);
  assert.deepEqual(dbBytes(built.maps, 'map_enc_off'), [0, 0]);
  assert.deepEqual(encounterRowPlan(project), { groups: [0, 4], fallback: false, count: 2 });
  assert.equal(tableBytesOf(built.maps), project.maps.length + 4 * 2 + 2 * 2, 'M + 4R + 2E');

  const withFallback = structuredClone(project);
  const empty = addMap(withFallback);
  groupMap(withFallback.maps[empty], 3, [], [0]);
  const second = await buildTo(t, withFallback, 'rows2');
  assert.deepEqual(dbBytes(second.maps, 'enc_group_actors'), [0, FF, FF, FF, 3, 4, FF, FF, FF, FF, FF, FF], 'the shared empty row comes last');
  assert.deepEqual(dbBytes(second.maps, 'enc_grp'), [1, 0, 2], 'the fallback entry points at the empty row, index 2');
  assert.deepEqual(dbBytes(second.maps, 'enc_thr'), [127, 255, 255]);
  assert.deepEqual(dbBytes(second.maps, 'map_enc_off'), [0, 0, 2]);
  assert.equal(tableBytesOf(second.maps), withFallback.maps.length + 4 * 3 + 2 * 3);
});

test('every map_enc_actors row keeps its mapEncounterFormation bytes in every mode (the 8-bit *4 aliasing)', { skip }, async (t) => {
  const project = await rpgBase(1);
  addMonsters(project, 2);
  pushGroup(project, 'G', [4]);
  legacyMap(project.maps[0], 1, [0, 3, 99, 4]); // a dead id is filtered, $FF padded
  const b = addMap(project);
  groupMap(project.maps[b], 3, [[0, 1]], [0, 4]); // group mode retains its dormant list's row
  const c = addMap(project);
  groupMap(project.maps[c], 0, [[0, 1]], [3]); // rate 0 too
  const built = await buildTo(t, project, 'actors');
  assert.deepEqual(dbBytes(built.maps, 'map_enc_actors'), [0, 3, 4, FF, 0, 4, FF, FF, 3, FF, FF, FF]);
});

// ---------------------------------------------------------------------------------------------------------------- table term

test('kernelTableBytes adds 1*maps + 4*rows + 2*entries, equal to the bytes the generator emitted: sample-rpg shape, 32 x 7 over 32 groups, a fallback map', { skip }, async (t) => {
  const mapper = resolveMapper(4);
  const delta = (project) => kernelTableBytes(project, mapper).tableBytes - kernelTableBytes(projectWithoutEncounterGroups(project), mapper).tableBytes;

  // The sample-rpg shape: 1 map, 1 group, 1 entry, no fallback, no empty row = 1 + 4 + 2 = 7 (+ 48 code = 55).
  const sample = await rpgBase(1);
  applyEncounterConversion(sample, planEncounterConversion(sample, 0));
  const sampleBuilt = await buildTo(t, sample, 'sampletable');
  assert.equal(tableBytesOf(sampleBuilt.maps), 7);
  assert.equal(kernelTableBytes(sample, resolveMapper(1)).tableBytes - kernelTableBytes(projectWithoutEncounterGroups(sample), resolveMapper(1)).tableBytes, 7);
  assert.equal(kernelCodeBytes(sample, resolveMapper(1)) - kernelCodeBytes(projectWithoutEncounterGroups(sample), resolveMapper(1)), 48);

  // 32 maps x 7 entries over 32 distinct live groups: 32 + 4*32 + 2*224 = 608 (+ 48 = 656).
  const wide = bareRpg(0);
  for (let g = 0; g < 32; g++) pushGroup(wide, `G${g}`, [g % 4]);
  while (wide.maps.length < 32) addMap(wide);
  wide.maps.forEach((map, m) => groupMap(map, 5, [0, 1, 2, 3, 4, 5, 6].map((k) => [(m + k) % 32, 1])));
  assert.equal(encounterEntryTotal(wide), 224);
  assert.deepEqual(encounterRowPlan(wide).count, 32);
  assert.equal(delta(wide), 608);
  const wideBuilt = await buildTo(t, wide, 'wide');
  assert.equal(tableBytesOf(wideBuilt.maps), 608, 'the generator emits exactly the priced bytes');
  assert.equal(kernelCodeBytes(wide, mapper) - kernelCodeBytes(projectWithoutEncounterGroups(wide), mapper), ENCGROUP_KERNEL_ALLOWANCE);

  // The same with one fallback map: +4 (empty row) +2 (its entry) +1 (its map_enc_off byte).
  const fallback = structuredClone(wide);
  const extra = addMap(fallback);
  groupMap(fallback.maps[extra], 5, []);
  assert.equal(delta(fallback), 608 + 4 + 2 + 1);
  const fallbackBuilt = await buildTo(t, fallback, 'widefallback');
  assert.equal(tableBytesOf(fallbackBuilt.maps), 608 + 4 + 2 + 1);
});

test('the M + 4*33 + 2*255 bound: 33 rows (32 groups + the empty row) and 255 entries, at the largest M that builds; the picker reaches the last rows', { skip }, async (t) => {
  const mapper = resolveMapper(4);
  const project = bareRpg(0);
  for (let g = 0; g < 32; g++) pushGroup(project, `G${g}`, [g % 4]);
  project.maps.length = 0;
  // 31 maps x 8 entries = 248, one 6-entry map = 254 ... plus one fallback map = 255 entries; the 32 groups are all referenced.
  for (let m = 0; m < 31; m++) addGroupMap(project, [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (m + k) % 32));
  addGroupMap(project, [24, 25, 26, 27, 28, 31]);
  addGroupMap(project, []); // the fallback map
  const referenced = new Set(project.maps.flatMap((map) => map.encounters.table.map((entry) => entry.group)));
  assert.equal(referenced.size, 32);
  assert.equal(encounterEntryTotal(project), 255);
  assert.equal(encounterRowPlan(project).count, 33);
  assert.deepEqual(errorsOf(project, 'encounter-entries-over'), [], '255 is accepted');
  // Pad with rate-0 maps (each 22 + 1 bytes) until the capacity check refuses, then take the last M that fits.
  let padded = structuredClone(project);
  for (;;) {
    const next = structuredClone(padded);
    addMap(next);
    if (checkCapacity(next).problems.some((p) => p.severity === 'error')) break;
    padded = next;
  }
  const M = padded.maps.length;
  assert.ok(M > 33, 'room for padding beyond the 33 rolling maps');
  const built = await buildTo(t, padded, 'bound');
  assert.equal(tableBytesOf(built.maps), M + 4 * 33 + 2 * 255);
  // Whole-bank accounting at the bound: nesasm's real kernel-lo usage against kernelCodeBytes + kernelTableBytes.
  const bankLine = built.lines.find((line) => new RegExp(`^BANK\\s+${prgLayout(mapper).kernelLoBank}\\s`).test(line));
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)[1]);
  const { fixedBytes, tableBytes } = kernelTableBytes(padded, mapper);
  const margin = kernelCodeBytes(padded, mapper) + fixedBytes + tableBytes - used;
  t.diagnostic(`bound fixture: M = ${M} maps, kernel-lo used ${used}, whole-bank margin ${margin}`);
  assert.ok(margin >= KERNEL_SLACK && margin <= KERNEL_SLACK * 2, `whole-bank margin ${margin} outside [KERNEL_SLACK, 2*KERNEL_SLACK]`);
  assert.equal(Math.max(...dbBytes(built.maps, 'enc_grp')), 32, 'the largest enc_grp literal is the empty row, byte offset 128');
  const nes = bootRom(built.romPath);
  // The last real row (group 31, row 31 at byte offset 124) and the empty row 32 (offset 128).
  const withLast = padded.maps.findIndex((map) => map.encounters.table?.some((entry) => entry.group === 31));
  assert.ok(withLast >= 0);
  const fallbackMap = 32;
  const empty = attempt(nes, built.symbols, 77, { flat: fallbackMap }, { encStep: 4 });
  assert.deepEqual([empty.slots, empty.fought, empty.encStep], [[FF, FF, FF, FF], false, 0], 'the fallback map reads row 32 and starts nothing');
  // The 6-entry map (index 31) ends with group 31: roll 255 selects its last entry, i.e. row 31 at offset 124, actor 31 % 4 = 3.
  const row31 = attempt(nes, built.symbols, seedForRoll(255), { flat: 31 }, { encStep: 4 });
  assert.deepEqual([row31.slots, row31.fought], [[3, FF, FF, FF], true], 'row 31 (offset 124) is read correctly');
  assert.equal(kernelTableBytes(padded, mapper).tableBytes - kernelTableBytes(projectWithoutEncounterGroups(padded), mapper).tableBytes, M + 4 * 33 + 2 * 255);
});

/** A seed whose check_encounter roll is exactly `roll` (the roll is two LFSR advances from the seed). */
function seedForRoll(roll) {
  const next = (v) => {
    if (v === 0) v = 0xa5;
    const carry = (v & 0x80) !== 0;
    v = (v << 1) & 0xff;
    if (carry) v ^= 0x71;
    return v;
  };
  for (let seed = 0; seed < 256; seed++) if (next(next(seed)) === roll) return seed;
  throw new Error(`no seed rolls ${roll}`);
}

// ------------------------------------------------------------------------------------------- refusals and the advice lever

test('entry limit: 255 compiled entries are accepted, 256 refused with the offending maps listed; the generator refuses before emitting a byte', { skip }, async (t) => {
  const project = bareRpg(8);
  project.maps.length = 0;
  for (let m = 0; m < 31; m++) addGroupMap(project, [0, 1, 2, 3, 4, 5, 6, 7]);
  addGroupMap(project, [0, 1, 2, 3, 4, 5, 6]); // 248 + 7 = 255
  assert.equal(encounterEntryTotal(project), 255);
  assert.deepEqual(errorsOf(project, 'encounter-entries-over'), []);
  addGroupMap(project, [0]); // 256
  const refused = errorsOf(project, 'encounter-entries-over');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].subject.maps.length, 33, 'every rolling map is listed');
  assert.deepEqual(refused[0].counts, [256, 255]);
  assert.match(refused[0].message, /compile to 256 entries; the limit is 255/);
  const fs2 = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs2.mkdtemp(path.join(os.tmpdir(), 'forge-enclimit-'));
  t.after(() => fs2.rm(dir, { recursive: true, force: true }));
  await assert.rejects(() => generateAssets({ dir, project }), /compile to 256 entries/);
  assert.equal(fs.existsSync(path.join(dir, 'build')), false, 'nothing was emitted');
});

test('the defensive generator bounds throw on an un-normalized project (entries over, rows over) and not at the limits', () => {
  const rows = bareRpg(0);
  for (let g = 0; g < 33; g++) pushGroup(rows, `G${g}`, [g % 4]); // 33 groups: past the 32 the normalizer allows
  addGroupMap(rows, Array.from({ length: 8 }, (_, k) => k));
  addGroupMap(rows, Array.from({ length: 8 }, (_, k) => 8 + k));
  addGroupMap(rows, Array.from({ length: 8 }, (_, k) => 16 + k));
  addGroupMap(rows, Array.from({ length: 8 }, (_, k) => 24 + k));
  addGroupMap(rows, [32]);
  assert.equal(encounterRowPlan(rows).count, 33);
  assertEncounterGroupBounds(rows); // 33 rows is the limit
  addGroupMap(rows, []); // the fallback's empty row makes 34
  assert.equal(encounterRowPlan(rows).count, 34);
  assert.throws(() => assertEncounterGroupBounds(rows), /need 34 table rows; the limit is 33/);
  assert.equal(errorsOf(rows, 'encounter-rows-over').length, 1, 'validateProject names the same rule');
  const entries = bareRpg(8);
  entries.maps.length = 0;
  for (let m = 0; m < 33; m++) addGroupMap(entries, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.throws(() => assertEncounterGroupBounds(entries), /compile to 264 entries; the limit is 255/);
  assertEncounterGroupBounds(bareRpg(2));
});

test('entry advice names edits that lower the compiled total: 31 x 8 + 7 + 1 = 256, the singleton is not recommended, applying the edit gives 255 and builds', { skip }, async (t) => {
  const project = bareRpg(8);
  project.maps.length = 0;
  for (let m = 0; m < 31; m++) addGroupMap(project, [0, 1, 2, 3, 4, 5, 6, 7]);
  const seven = addGroupMap(project, [0, 1, 2, 3, 4, 5, 6]);
  const single = addGroupMap(project, [0]);
  assert.equal(encounterEntryTotal(project), 256);
  // Clearing the singleton's only row frees nothing: it becomes a one-entry fallback.
  const cleared = structuredClone(project);
  cleared.maps[single].encounters.table = [];
  assert.equal(encounterEntryTotal(cleared), 256, 'a fallback entry still costs one');
  const [problem] = errorsOf(project, 'encounter-entries-over');
  assert.ok(problem);
  assert.match(problem.message, /256 entries; the limit is 255, so 1 must go/);
  assert.match(problem.message, /remove 1 row from M0 \(8 entries\)/);
  assert.doesNotMatch(problem.message, new RegExp(`M${single}\\b`), 'the singleton is not recommended');
  assert.match(problem.message, new RegExp(`M${seven} \\(up to 6 of 7\\)`));
  // Apply the recommended edit.
  project.maps[0].encounters.table.pop();
  assert.equal(encounterEntryTotal(project), 255);
  assert.deepEqual(errorsOf(project, 'encounter-entries-over'), []);
  assert.deepEqual(errorsOf(project), [], 'validates clean');
  const built = await buildTo(t, project, 'advice255');
  assert.equal(dbBytes(built.maps, 'enc_thr').length, 255, 'and builds');
});

test('entry advice, validation only: one two-entry table + 254 fallback maps (256) recommends that row; 300 one-entry maps (N = 45) recommend rate 0 / the actor list', () => {
  const small = bareRpg(2);
  small.maps.length = 0;
  const two = addGroupMap(small, [0, 1]);
  for (let m = 0; m < 254; m++) addGroupMap(small, []);
  assert.equal(encounterEntryTotal(small), 256);
  const [problem] = errorsOf(small, 'encounter-entries-over');
  assert.match(problem.message, new RegExp(`remove 1 row from M${two} \\(2 entries\\)`));
  small.maps[two].encounters.table.pop();
  assert.equal(encounterEntryTotal(small), 255);
  assert.deepEqual(errorsOf(small, 'encounter-entries-over'), []);

  const many = bareRpg(2);
  many.maps.length = 0;
  for (let m = 0; m < 300; m++) addGroupMap(many, [0]);
  assert.equal(encounterEntryTotal(many), 300);
  const [rate] = errorsOf(many, 'encounter-entries-over');
  assert.match(rate.message, /so 45 must go/);
  assert.match(rate.message, /Removing rows cannot be enough[^]*encounter rate to 0, or "Use the actor list again"/);
  const named = rate.message.match(/M\d+ \(1 entry\)/g) ?? [];
  assert.equal(named.length, 45, 'exactly 45 maps named');
  // Apply it: rate 0 on 45 maps.
  for (let m = 0; m < 45; m++) many.maps[m].encounters.rate = 0;
  assert.equal(encounterEntryTotal(many), 255);
  assert.deepEqual(errorsOf(many, 'encounter-entries-over'), []);
});

test('Code Forge pair: an rpg.asm override is refused beside a rolling group map; another stock override, or no rolling group map, is not', () => {
  const make = (overrideName, rate) => {
    const project = bareRpg(1);
    groupMap(project.maps[0], rate, [[0, 1]]);
    project.code = { overrides: [{ name: overrideName, text: '; hand-written\n' }], files: [] };
    return project;
  };
  const positive = errorsOf(make('rpg.asm', 5), 'encounter-groups-code-override');
  assert.equal(positive.length, 1);
  assert.equal(positive[0].where, 'Code Forge');
  assert.match(positive[0].message, /overrides rpg\.asm[^]*Code Forge[^]*Map Forge/);
  assert.deepEqual(errorsOf(make('entities.asm', 5), 'encounter-groups-code-override'), [], 'another stock override is not refused');
  assert.deepEqual(errorsOf(make('rpg.asm', 0), 'encounter-groups-code-override'), [], 'no rolling group map: the picker is not assembled');
  assert.equal(errorsOf(make('rpg.asm', 5)).some((p) => p.rule === 'encounter-groups-code-override'), true);
});

// ------------------------------------------------------------------------------------------------- real overflow and advice

test('a near-full RPG project the groups push over is refused with kernel-lo-tables-over, the advice lever frees exactly the counterfactual, and applying it builds', { skip }, async (t) => {
  const mapper = resolveMapper(1);
  const withMaps = async (n) => {
    const project = await rpgBase(1);
    for (let i = 0; i < n; i++) addMap(project);
    return project;
  };
  const overflowOf = (project) => checkCapacity(project).problems.find((p) => p.rule === 'kernel-lo-tables-over');
  // Largest map count the legacy project still fits.
  let n = 0;
  while (!overflowOf(await withMaps(n + 1))) n++;
  const legacy = await withMaps(n);
  assert.equal(overflowOf(legacy), undefined, 'the legacy project fits');
  const grouped = structuredClone(legacy);
  applyEncounterConversion(grouped, planEncounterConversion(grouped, 0));
  const refusal = overflowOf(grouped);
  assert.ok(refusal, 'the groups push it over kernel-lo');
  const occupancy = (project) => {
    const { fixedBytes, tableBytes } = kernelTableBytes(project, mapper);
    return kernelCodeBytes(project, mapper) + fixedBytes + tableBytes;
  };
  const freed = occupancy(grouped) - occupancy(projectWithoutEncounterGroups(grouped));
  assert.equal(freed, grouped.maps.length + 4 + 2 + ENCGROUP_KERNEL_ALLOWANCE, '1 per map + 4 per row + 2 per entry, plus the picker');
  const match = refusal.message.match(/the encounter groups \(the maps go back to their actor lists\) \(frees (\d+) bytes\)/);
  assert.ok(match, `the advice offers the lever: ${refusal.message}`);
  assert.equal(Number(match[1]), freed, 'the advice figure equals the counterfactual occupancy');
  // Apply it: the same project with the groups stripped fits and builds.
  const stripped = projectWithoutEncounterGroups(grouped);
  assert.equal(overflowOf(stripped), undefined);
  await buildTo(t, stripped, 'overflowfix');
  // Atomic: the refused project emits nothing.
  const fs2 = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs2.mkdtemp(path.join(os.tmpdir(), 'forge-encover-'));
  t.after(() => fs2.rm(dir, { recursive: true, force: true }));
  await assert.rejects(() => generateAssets({ dir, project: grouped }), /lookup tables need/);
  assert.equal(fs.existsSync(path.join(dir, 'build')), false);
});
