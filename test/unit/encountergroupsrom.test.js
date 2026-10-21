// Encounter groups, headless ROM tests (handoff-next/encgroups appendix C1-C13): variants of sample-rpg built in mkdtemp
// directories and driven through the ROM's own check_encounter -> start_encounter. The sample-rpg fixture is only read.
//
// Method. For each of the 256 rng seeds the test sets rng, primes the step counter, and runs check_encounter (test/lib/
// callroutine.js), then reads the four mon_slot_actor bytes. The roll the ROM sees is rollOf(seed): check_encounter's
// unconditional rng_next, then the one inside the rate gate (rpg.test.js:921-1010 pins the same two advances). The expected
// formation is an INDEPENDENT LITERAL LAW per layout -- a hand-written threshold array and a formation per range, never a call to
// encounterThresholds -- and a separate assertion compares the bytes the generator wrote in maps.inc to those literals, so wrong
// generation cannot be its own oracle.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProject } from '../../main/project-io.js';
import { createProject, createMap, planEncounterConversion, applyEncounterConversion, projectWithoutEncounterGroups } from '../../shared/project.js';
import { BUTTON } from '../../renderer/emulator/runcontrol.js';
import { callRoutine } from '../lib/callroutine.js';
import { checkCapacity } from '../../main/build/generate.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import {
  ROOT, SAMPLE_RPG, RAM, rpgBase, addMonsters, addMap, pushGroup, groupMap, legacyMap, firstScreens, buildTo, dbBytes, bootRom,
  referenceRngNext, rollOf, attempt
} from '../lib/encgroups.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm ? 'nesasm not found on PATH' : !fs.existsSync(SAMPLE_RPG) && 'sample-rpg missing';
const FF = 0xff;
const pad = (ids) => [...ids, FF, FF, FF, FF].slice(0, 4);
const SEEDS = Array.from({ length: 256 }, (_, i) => i);

/** The literal law: the first threshold >= roll picks that entry's formation. */
const lawPick = (thr, forms, roll) => forms[thr.findIndex((cut) => roll <= cut)];
/** The legacy law: (roll & 3) + 1 leading slots of the map's four-slot row. */
const lawPrefix = (row, roll) => row.map((id, slot) => (slot < (roll & 3) + 1 ? id : FF));

function checkMap(nes, built, where, expected, label, { encStep = 0 } = {}) {
  const seen = new Set();
  for (const seed of SEEDS) {
    const roll = rollOf(seed);
    const want = expected(roll);
    const got = attempt(nes, built.symbols, seed, where, { encStep });
    assert.deepEqual(got.slots, want, `${label}: seed ${seed} (roll ${roll})`);
    assert.equal(got.fought, want[0] !== FF, `${label}: seed ${seed}: fight state`);
    seen.add(want.join());
  }
  return seen;
}

// ------------------------------------------------------------------------------------------------ layouts shared by C1, C9, C10

/** C1: three formations, weights 1:2:5 (thr 31, 95, 255), on map 0 of sample-rpg. */
function layoutOne(project) {
  const [a, b, c, d] = addMonsters(project, 4);
  pushGroup(project, 'Solo', [0]);
  pushGroup(project, 'Pair', [3, a]);
  pushGroup(project, 'Trio', [b, c, d]);
  groupMap(project.maps[0], 1, [[0, 1], [1, 2], [2, 5]]);
  return { thr: [31, 95, 255], forms: [pad([0]), pad([3, a]), pad([b, c, d])] };
}

/** C9: a legacy map (map 0, four monsters) beside a group map (map 1). */
function layoutNine(project) {
  const [a, b, c] = addMonsters(project, 3);
  pushGroup(project, 'G', [a, b]);
  legacyMap(project.maps[0], 1, [0, 3, a, c]);
  const second = addMap(project, 'Groups');
  groupMap(project.maps[second], 1, [[0, 1]]);
  return { row: [0, 3, a, c] };
}

// ---------------------------------------------------------------------------------------------------------------- C1 + C10

for (const [mapperId, mapperName] of [[1, 'MMC1'], [4, 'MMC3'], [30, 'UNROM 512']]) {
  test(`C1/C10 ${mapperName}: three formations 1:2:5 follow the literal threshold law for all 256 seeds; tables equal their literals`, { skip }, async (t) => {
    const project = await rpgBase(mapperId);
    const { thr, forms } = layoutOne(project);
    const built = await buildTo(t, project, 'c1');
    assert.match(built.config, /^ENC_GROUPS\s*=\s*1\b/m);
    // The generator's bytes against the hand-written literals (a separate assertion from the ROM law below).
    assert.deepEqual(dbBytes(built.maps, 'map_enc_off'), [0], 'one group map starts at entry 0');
    assert.deepEqual(dbBytes(built.maps, 'enc_thr'), [31, 95, 255]);
    assert.deepEqual(dbBytes(built.maps, 'enc_grp'), [0, 1, 2]);
    assert.deepEqual(dbBytes(built.maps, 'enc_group_actors'), forms.flat());
    const nes = bootRom(built.romPath);
    const seen = checkMap(nes, built, { flat: 0 }, (roll) => lawPick(thr, forms, roll), `${mapperName} L1`);
    assert.equal(seen.size, 3, 'every formation is reached (a picker scanning only the first threshold fails)');
  });

  test(`C9/C10 ${mapperName}: a live legacy map beside a group map keeps (roll & 3) + 1 leading slots, per seed, equal to the all-legacy build`, { skip }, async (t) => {
    const project = await rpgBase(mapperId);
    const { row } = layoutNine(project);
    const twin = projectWithoutEncounterGroups(project);
    const built = await buildTo(t, project, 'c9');
    const plain = await buildTo(t, twin, 'c9twin');
    assert.match(built.config, /^ENC_GROUPS\s*=\s*1\b/m);
    assert.match(plain.config, /^ENC_GROUPS\s*=\s*0\b/m);
    assert.equal(dbBytes(built.maps, 'map_enc_off')[0], FF, 'the legacy map is marked $FF');
    assert.deepEqual(dbBytes(built.maps, 'map_enc_actors'), dbBytes(plain.maps, 'map_enc_actors'), 'rows unchanged for every map');
    const nes = bootRom(built.romPath);
    const nesPlain = bootRom(plain.romPath);
    const seen = new Set();
    for (const seed of SEEDS) {
      const roll = rollOf(seed);
      const got = attempt(nes, built.symbols, seed, { flat: 0 });
      assert.deepEqual(got.slots, lawPrefix(row, roll), `${mapperName}: seed ${seed}: the (second & 3) + 1 law`);
      const base = attempt(nesPlain, plain.symbols, seed, { flat: 0 });
      assert.deepEqual(got, base, `${mapperName}: seed ${seed}: identical to the every-map-legacy build, state included`);
      seen.add(got.slots.filter((id) => id !== FF).length);
    }
    assert.deepEqual([...seen].sort(), [1, 2, 3, 4], 'every prefix length 1..4 occurs');
  });
}

test('C1: a real player step (walk right) agrees with the check_encounter attempts for a handful of seeds', { skip }, async (t) => {
  const project = await rpgBase(1);
  const { thr, forms } = layoutOne(project);
  const built = await buildTo(t, project, 'c1walk');
  for (const seed of [1, 40, 77, 130, 200, 254]) {
    const nes = bootRom(built.romPath);
    nes.cpu.mem[RAM.rng] = seed;
    nes.buttonDown(1, BUTTON.RIGHT);
    nes.frame();
    nes.buttonUp(1, BUTTON.RIGHT);
    for (let i = 0; i < 10; i++) nes.frame();
    const slots = [0, 1, 2, 3].map((i) => nes.cpu.mem[RAM.monSlotActor + i]);
    assert.deepEqual(slots, lawPick(thr, forms, rollOf(seed)), `walked step, seed ${seed}`);
    assert.equal(nes.cpu.mem[RAM.gameState], 5, 'the walk started a battle');
  }
});

// ---------------------------------------------------------------------------------------------------------------------- C2

test('C2: eight entries [16,1,1,1,1,1,1,16]: the last entry is reached and every threshold literal holds', { skip }, async (t) => {
  const project = await rpgBase(1);
  const ids = addMonsters(project, 8);
  ids.forEach((id, i) => pushGroup(project, `G${i}`, [id]));
  const weights = [16, 1, 1, 1, 1, 1, 1, 16];
  groupMap(project.maps[0], 1, weights.map((w, i) => [i, w]));
  const thr = [107, 114, 120, 127, 134, 140, 147, 255]; // floor(cum * 255 / 38), by hand
  const built = await buildTo(t, project, 'c2');
  assert.deepEqual(dbBytes(built.maps, 'enc_thr'), thr);
  assert.deepEqual(dbBytes(built.maps, 'enc_grp'), [0, 1, 2, 3, 4, 5, 6, 7]);
  const forms = ids.map((id) => pad([id]));
  const nes = bootRom(built.romPath);
  const seen = checkMap(nes, built, { flat: 0 }, (roll) => lawPick(thr, forms, roll), 'L2');
  assert.equal(seen.size, 8, 'all eight entries reachable, the last through the $FF stop');
});

// ---------------------------------------------------------------------------------------------------------------------- C3

test('C3: nonzero noncontiguous group ids, repeated actors and padding; rows are dense by authored id with unscaled enc_grp', { skip }, async (t) => {
  const project = await rpgBase(1);
  const [a, b] = addMonsters(project, 2);
  for (let g = 0; g < 20; g++) pushGroup(project, `G${g}`, [a]); // 17 of them stay unused
  project.encounterGroups[3].monsters = [0, 0, 3]; // [S, S, B]
  project.encounterGroups[9].monsters = [3, b];
  project.encounterGroups[17].monsters = [0]; // [S] only: slots 1..3 stay $FF
  groupMap(project.maps[0], 1, [[17, 1], [3, 1], [9, 2]]);
  const thr = [63, 127, 255]; // 1:1:2 of 255
  const built = await buildTo(t, project, 'c3');
  assert.deepEqual(dbBytes(built.maps, 'enc_thr'), thr);
  assert.deepEqual(dbBytes(built.maps, 'enc_grp'), [2, 0, 1], 'unscaled row indices, rows dense by authored id (3, 9, 17)');
  assert.deepEqual(dbBytes(built.maps, 'enc_group_actors'), [0, 0, 3, FF, 3, b, FF, FF, 0, FF, FF, FF], 'unreferenced groups get no row');
  const forms = [pad([0]), pad([0, 0, 3]), pad([3, b])];
  checkMap(bootRom(built.romPath), built, { flat: 0 }, (roll) => lawPick(thr, forms, roll), 'L3');
});

// ---------------------------------------------------------------------------------------------------------------------- C3b

test('C3b: a group of FOUR distinct live monsters emits all four bytes and starts all four runtime slots (the fourth slot is not dropped)', { skip }, async (t) => {
  const project = await rpgBase(1);
  const ids = addMonsters(project, 4);
  assert.deepEqual(ids, [4, 5, 6, 7], 'sample-rpg has four actors, so the new monsters are 4..7');
  pushGroup(project, 'Quad', [4, 5, 6, 7]);
  pushGroup(project, 'Solo', [0]);
  groupMap(project.maps[0], 1, [[0, 1], [1, 1]]);
  const thr = [127, 255]; // floor(1 * 255 / 2), then the $FF stop
  const built = await buildTo(t, project, 'c3b');
  assert.deepEqual(dbBytes(built.maps, 'enc_thr'), thr);
  assert.deepEqual(dbBytes(built.maps, 'enc_grp'), [0, 1]);
  // Hand-written bytes: row 0 holds all four ids, the last one included; row 1 is [Slime, $FF x3].
  assert.deepEqual(dbBytes(built.maps, 'enc_group_actors'), [4, 5, 6, 7, 0, FF, FF, FF]);
  const forms = [[4, 5, 6, 7], pad([0])];
  const seen = checkMap(bootRom(built.romPath), built, { flat: 0 }, (roll) => lawPick(thr, forms, roll), 'L3b');
  assert.equal(seen.size, 2, 'both the four-monster fight and the single fight occur');
  assert.ok([...seen].includes('4,5,6,7'), 'a fight started with all four monster slots live');
});

// ---------------------------------------------------------------------------------------------------------------------- C4

test('C4: several group maps with different tables at nonzero entry offsets, a rate-0 group map and a legacy map between them', { skip }, async (t) => {
  const project = await rpgBase(1);
  const ids = addMonsters(project, 6);
  ['A', 'B', 'C', 'D', 'E'].forEach((name, i) => pushGroup(project, name, [ids[i]]));
  const [A, B, C, D, E] = ids;
  for (let i = 0; i < 4; i++) addMap(project);
  groupMap(project.maps[0], 1, [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]); // 5 entries, offset 0
  groupMap(project.maps[1], 0, [[0, 1], [1, 1]], [0, 3]); // rate 0: no entries, offset byte 0, never read
  groupMap(project.maps[2], 1, [[1, 1], [4, 3]]); // 2 entries, offset 5
  legacyMap(project.maps[3], 1, [0, 3]);
  groupMap(project.maps[4], 1, [[0, 2], [2, 1], [3, 1]]); // 3 entries, offset 7
  const built = await buildTo(t, project, 'c4');
  assert.deepEqual(dbBytes(built.maps, 'map_enc_off'), [0, 0, 5, FF, 7], 'a generator that wrote every offset as 0 fails here');
  assert.deepEqual(dbBytes(built.maps, 'enc_thr'), [51, 102, 153, 204, 255, 63, 255, 127, 191, 255]);
  assert.deepEqual(dbBytes(built.maps, 'enc_grp'), [0, 1, 2, 3, 4, 1, 4, 0, 2, 3]);
  const nes = bootRom(built.romPath);
  const f = (...x) => x.map((id) => pad([id]));
  checkMap(nes, built, { flat: 0 }, (r) => lawPick([51, 102, 153, 204, 255], f(A, B, C, D, E), r), 'map 0');
  checkMap(nes, built, { flat: 2 }, (r) => lawPick([63, 255], f(B, E), r), 'map 2 (offset 5)');
  checkMap(nes, built, { flat: 4 }, (r) => lawPick([127, 191, 255], f(A, C, D), r), 'map 4 (offset 7)');
  checkMap(nes, built, { flat: 3 }, (r) => lawPrefix(pad([0, 3]), r), 'map 3 (legacy)');
});

// ---------------------------------------------------------------------------------------------------------------------- C5

/** A mixed ordinary/streamed RPG (UNROM 512): Before (4 ordinary screens), Streamed (map 1), After. */
function mixedRpg(camera = true) {
  const project = createStreamedProject({ gameType: 'rpg', mixed: true, camera });
  const ids = [];
  for (let i = 0; i < 4; i++) {
    ids.push(project.sprites.actors.length);
    project.sprites.actors.push({ name: `Mon${i}`, behavior: 'monster', hp: 5, damage: 1 });
  }
  return { project, ids };
}

test('C5: a mixed ordinary/streamed project with the streamed map at a nonzero map index follows the group law', { skip }, async (t) => {
  const { project, ids } = mixedRpg();
  const [a, b, c] = ids;
  pushGroup(project, 'Pair', [a, b]);
  pushGroup(project, 'Solo', [c]);
  assert.equal(project.maps[1].streamed, true, 'the streamed map is map 1');
  groupMap(project.maps[1], 1, [[0, 1], [1, 3]]); // streamed, owner index 1
  groupMap(project.maps[2], 1, [[1, 1], [0, 1]]); // ordinary After
  legacyMap(project.maps[0], 1, [a, b, c]);
  const built = await buildTo(t, project, 'c5');
  assert.deepEqual(dbBytes(built.maps, 'map_enc_off'), [FF, 0, 2]);
  assert.deepEqual(dbBytes(built.maps, 'enc_thr'), [63, 255, 127, 255]);
  const nes = bootRom(built.romPath);
  const ordinaryAfter = 4; // Before's four screens, then After: the streamed screens are not in the ordinary flat table
  checkMap(nes, built, { streamedMap: 1 }, (r) => lawPick([63, 255], [pad([a, b]), pad([c])], r), 'streamed map 1');
  checkMap(nes, built, { flat: ordinaryAfter }, (r) => lawPick([127, 255], [pad([c]), pad([a, b])], r), 'ordinary map 2');
  checkMap(nes, built, { flat: 0 }, (r) => lawPrefix(pad([a, b, c]), r), 'ordinary legacy map 0');
});

// ------------------------------------------------------------------------------------------------------------------ C6, C7, C8

for (const withOther of [false, true]) {
  test(`C6: an empty group-mode table retaining actorIds [A,B] starts nothing and spends the step (${withOther ? 'with' : 'without'} another active group map)`, { skip }, async (t) => {
    const project = await rpgBase(1);
    const [a] = addMonsters(project, 1);
    groupMap(project.maps[0], 5, [], [0, 3]);
    if (withOther) {
      pushGroup(project, 'G', [a]);
      const other = addMap(project);
      groupMap(project.maps[other], 1, [[0, 1]]);
    }
    const built = await buildTo(t, project, 'c6');
    assert.match(built.config, /^ENC_GROUPS\s*=\s*1\b/m, 'mode decides: the predicate holds');
    assert.deepEqual(dbBytes(built.maps, 'map_enc_actors').slice(0, 4), [0, 3, FF, FF], 'the retained row still ships');
    const nes = bootRom(built.romPath);
    for (const seed of SEEDS) {
      const got = attempt(nes, built.symbols, seed, { flat: 0 }, { encStep: 4 });
      assert.deepEqual(got.slots, [FF, FF, FF, FF], `seed ${seed}: never A or B`);
      assert.equal(got.fought, false);
      assert.equal(got.encStep, 0, `seed ${seed}: enc_step reset`);
    }
  });
}

test('C7: a group whose only actors are deleted starts nothing and consumes enc_step', { skip }, async (t) => {
  const project = await rpgBase(1);
  pushGroup(project, 'Dead', [200]);
  groupMap(project.maps[0], 5, [[0, 1]]);
  const built = await buildTo(t, project, 'c7');
  assert.deepEqual(dbBytes(built.maps, 'enc_group_actors'), [FF, FF, FF, FF], 'only the shared empty row');
  const nes = bootRom(built.romPath);
  for (const seed of SEEDS) {
    const got = attempt(nes, built.symbols, seed, { flat: 0 }, { encStep: 4 });
    assert.deepEqual([got.slots, got.fought, got.encStep], [[FF, FF, FF, FF], false, 0], `seed ${seed}`);
  }
});

test('C8: a group with a harmless-but-referenced actor still fights', { skip }, async (t) => {
  const project = await rpgBase(1);
  pushGroup(project, 'Potion', [1]); // sample-rpg actor 1 is the Potion pickup
  groupMap(project.maps[0], 1, [[0, 1]]);
  const built = await buildTo(t, project, 'c8');
  const nes = bootRom(built.romPath);
  for (const seed of SEEDS) {
    const got = attempt(nes, built.symbols, seed, { flat: 0 });
    assert.deepEqual([got.slots, got.fought], [pad([1]), true], `seed ${seed}`);
  }
});

// --------------------------------------------------------------------------------------------------------------------- C11

/** 65 one-screen maps on MMC3: map 0 legacy [A,B,C], map 64 legacy [D] -- whose 8-bit row lookup (64*4)&255 = 0 reads map 0's row. */
async function aliasProject() {
  // A bare createProject RPG, not sample-rpg: 65 maps cost 22+ kernel-lo bytes each, and sample-rpg's naming and Join tables leave
  // too little room for the converted variants (the capacity check refused them while this test was written).
  const project = createProject('Alias', 'rpg');
  project.cartridge.mapper = 4;
  const [a, b, c, d] = [0, 1, 2, 3];
  for (const id of [a, b, c, d]) project.sprites.actors.push({ name: `Mon${id}`, behavior: 'monster', hp: 5, damage: 1 });
  while (project.maps.length < 65) addMap(project);
  legacyMap(project.maps[0], 1, [a, b, c]);
  legacyMap(project.maps[64], 1, [d]);
  return { project, ids: [a, b, c, d] };
}

function checkAliased(nes, built, ids, label) {
  const [a, b, c] = ids;
  for (const seed of SEEDS) {
    const roll = rollOf(seed);
    const got = attempt(nes, built.symbols, seed, { flat: 64 });
    assert.deepEqual(got.slots, lawPrefix(pad([a, b, c]), roll), `${label}: seed ${seed}: map 64 fights map 0's row, never D`);
  }
}

test('C11: 65-map aliasing -- converting map 0 never changes map 64 (it reads the converted map\'s preserved row)', { skip }, async (t) => {
  const { project, ids } = await aliasProject();
  const baseline = await buildTo(t, project, 'c11base');
  const nesBase = bootRom(baseline.romPath);
  checkAliased(nesBase, baseline, ids, 'baseline');
  const rowBefore = dbBytes(baseline.maps, 'map_enc_actors').slice(0, 4);
  const before = SEEDS.map((seed) => attempt(nesBase, baseline.symbols, seed, { flat: 64 }));
  assert.deepEqual(rowBefore, pad(ids.slice(0, 3)));

  for (const variant of ['a: map 0 rate positive', 'b1: map 0 rate zero', 'b2: map 0 rate zero + a second converted rate-positive map']) {
    const converted = structuredClone(project);
    if (variant.startsWith('b')) converted.maps[0].encounters.rate = 0;
    const plan = planEncounterConversion(converted, 0);
    assert.equal(plan.ok, true, plan.message);
    applyEncounterConversion(converted, plan);
    if (variant.startsWith('b2')) {
      converted.maps[1].encounters.rate = 1;
      const extra = planEncounterConversion(converted, 1);
      assert.equal(extra.ok, true, extra.message);
      applyEncounterConversion(converted, extra);
    }
    const built = await buildTo(t, converted, 'c11var');
    const wantGroups = variant.startsWith('a') || variant.startsWith('b2') ? 1 : 0;
    assert.match(built.config, new RegExp(`^ENC_GROUPS\\s*=\\s*${wantGroups}\\b`, 'm'), variant);
    assert.deepEqual(dbBytes(built.maps, 'map_enc_actors').slice(0, 4), rowBefore, `${variant}: the converted map's row is preserved byte for byte`);
    const nes = bootRom(built.romPath);
    const after = SEEDS.map((seed) => attempt(nes, built.symbols, seed, { flat: 64 }));
    assert.deepEqual(after, before, `${variant}: map 64's four slots and fight state are byte-identical for every seed`);
    if (variant.startsWith('a')) {
      // Converted map 0 itself follows the group law of its plan: prefixes [A], [A,B], [A,B,C] at weights 1,1,2.
      const [a, b, c] = ids;
      checkMap(nes, built, { flat: 0 }, (r) => lawPick([63, 127, 255], [pad([a]), pad([a, b]), pad([a, b, c])], r), 'converted map 0');
    } else {
      for (const seed of [0, 9, 99, 199]) {
        const got = attempt(nes, built.symbols, seed, { flat: 0 }, { encStep: 3 });
        assert.deepEqual([got.fought, got.encStep], [false, 3], `${variant}: rate-0 converted map 0 starts nothing and keeps enc_step`);
      }
    }
  }
});

test('C11: a streamed legacy owner at a nonzero map index in a mixed project (index >= 64 when capacity permits)', { skip }, async (t) => {
  // Before = 0, F fillers, Streamed = F + 1, After. F = 63 puts the streamed owner at 64 (its row lookup aliases onto row 0).
  const make = (fillerCount) => {
    const { project, ids } = mixedRpg(true);
    const fillers = Array.from({ length: fillerCount }, (_, i) => createMap(1 + i, `F${i}`));
    project.maps.splice(1, 0, ...fillers);
    project.maps.forEach((map, index) => (map.id = index));
    const streamedIndex = fillerCount + 1;
    const [a, b, c, d] = ids;
    legacyMap(project.maps[0], 1, [a, b, c]);
    legacyMap(project.maps[streamedIndex], 1, [d, c]);
    return { project, ids, streamedIndex };
  };
  const convert = (project) => {
    const variant = structuredClone(project);
    applyEncounterConversion(variant, planEncounterConversion(variant, 0));
    return variant;
  };
  const fits = (project) => !checkCapacity(project).problems.some((problem) => problem.severity === 'error');
  let fillerCount = 63;
  while (fillerCount > 0 && !(fits(make(fillerCount).project) && fits(convert(make(fillerCount).project)))) fillerCount--;
  const { project, ids, streamedIndex } = make(fillerCount);
  // Recorded gap: the camera streamed worlds require leaves room for fewer than 63 filler maps (22+ kernel-lo bytes each), so the
  // streamed owner cannot reach index 64 and the aliased lookup is not exercised for it; the highest feasible index is covered.
  if (streamedIndex < 64) t.diagnostic(`C11 streamed: capacity refuses index 64; covering the highest feasible nonzero index ${streamedIndex} (no aliasing there)`);
  assert.ok(streamedIndex >= 2, 'at least one filler fits');
  const [a, b, c, d] = ids;
  const row = streamedIndex >= 64 ? pad([a, b, c]) : pad([d, c]); // an index below 64 reads its own row
  const run = async (label, mutate) => {
    const variant = structuredClone(project);
    mutate(variant);
    const built = await buildTo(t, variant, 'c11stream');
    const nes = bootRom(built.romPath);
    for (const seed of SEEDS) {
      assert.deepEqual(attempt(nes, built.symbols, seed, { streamedMap: streamedIndex }).slots, lawPrefix(row, rollOf(seed)), `${label}: seed ${seed}`);
    }
  };
  await run('legacy', () => {});
  await run('map 0 converted', (variant) => applyEncounterConversion(variant, planEncounterConversion(variant, 0)));
});

// --------------------------------------------------------------------------------------------------------------------- C12

test('C12: a rate-0 group map, executed: no fight, enc_step untouched, rng advanced once per step -- identical to the legacy twin', { skip }, async (t) => {
  const project = await rpgBase(1);
  const [a] = addMonsters(project, 1);
  pushGroup(project, 'G', [a]);
  groupMap(project.maps[0], 0, [[0, 1]], [0, 3]); // rate 0, a nonempty table and a retained list
  const other = addMap(project);
  groupMap(project.maps[other], 1, [[0, 1]]); // keeps ENC_GROUPS on
  const twin = structuredClone(project);
  legacyMap(twin.maps[0], 0, [0, 3]);
  legacyMap(twin.maps[other], 1, [a]);
  const built = await buildTo(t, project, 'c12');
  const plain = await buildTo(t, twin, 'c12twin');
  assert.match(built.config, /^ENC_GROUPS\s*=\s*1\b/m);
  assert.deepEqual(dbBytes(built.maps, 'map_enc_off').slice(0, 2), [0, 0], 'the rate-0 group map is never read');
  const run = (nes, symbols, seed) => {
    const mem = nes.cpu.mem;
    mem[RAM.mapIsStreamed] = 0;
    mem[RAM.flatScreen] = 0;
    mem[RAM.rng] = seed;
    mem[RAM.encStep] = 7;
    const trace = [];
    let want = seed;
    for (let step = 0; step < 60; step++) {
      mem[RAM.moving] = 1;
      callRoutine(nes, symbols.check_encounter);
      want = referenceRngNext(want);
      trace.push([mem[RAM.rng], mem[RAM.encStep], mem[RAM.gameState]]);
      assert.equal(mem[RAM.rng], want, `seed ${seed} step ${step}: exactly one rng_next per step`);
      assert.equal(mem[RAM.encStep], 7, `seed ${seed} step ${step}: enc_step neither reset nor incremented`);
      assert.notEqual(mem[RAM.gameState], 5, 'no fight');
    }
    return trace;
  };
  const nes = bootRom(built.romPath);
  const nesPlain = bootRom(plain.romPath);
  for (const seed of [0, 1, 17, 64, 128, 201, 255]) {
    assert.deepEqual(run(nes, built.symbols, seed), run(nesPlain, plain.symbols, seed), `seed ${seed}: same RAM trajectory as the legacy build`);
  }
});

// --------------------------------------------------------------------------------------------------------------------- C13

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('C13: a project whose only group-mode map has rate 0 assembles to the same ROM as the legacy map; any rate > 0 changes it', { skip }, async (t) => {
  const legacy = await rpgBase(1);
  legacyMap(legacy.maps[0], 0, [0, 3]);
  const grouped = structuredClone(legacy);
  pushGroup(grouped, 'G', [0]);
  groupMap(grouped.maps[0], 0, [[0, 1]], [0, 3]);
  const asLegacy = await buildTo(t, legacy, 'c13a');
  const asGroups = await buildTo(t, grouped, 'c13b');
  assert.match(asGroups.config, /^ENC_GROUPS\s*=\s*0\b/m, 'predicate false');
  assert.equal(dbBytes(asGroups.maps, 'map_enc_off'), null, 'no group tables emitted');
  assert.deepEqual(dbBytes(asGroups.maps, 'map_enc_actors'), dbBytes(asLegacy.maps, 'map_enc_actors'));
  assert.equal(sha(asGroups.romPath), sha(asLegacy.romPath), 'game.nes is byte-identical');
  grouped.maps[0].encounters.rate = 1;
  const live = await buildTo(t, grouped, 'c13c');
  assert.notEqual(sha(live.romPath), sha(asLegacy.romPath), 'mutation: a rate > 0 group map changes the ROM');
});

test('C10: an action build proves ENC_GROUPS = 0 even with a group-mode map (the predicate needs an RPG)', { skip }, async (t) => {
  const project = await loadProject(path.join(ROOT, 'sample'));
  pushGroup(project, 'G', [0]);
  groupMap(project.maps[0], 5, [[0, 1]]);
  const built = await buildTo(t, project, 'c10action');
  assert.match(built.config, /^ENC_GROUPS\s*=\s*0\b/m);
  assert.equal(dbBytes(built.maps, 'map_enc_off'), null);
});
