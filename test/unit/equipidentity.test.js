// Equipment (ROADMAP item 5), build commit C2: E4 byte identity, design-equipment.md section 8 (2)-(5). C2 adds a data model and no engine,
// generator or ROM change, so every ROM below must equal the hash the post-C1b tree (720d976) produced. The hashes are literals, captured by
// handoff-next/equip/c2/capture-pins.mjs on that tree before any C2 edit (a clean checkout of 720d976, built from mkdtemp copies); a test that
// read them from the tree under test would prove nothing. Every project is a loadProject() read of a checked-in fixture, edited in memory and
// built in its own mkdtemp directory: none of the six fixtures is written to or changes.
//
// Later commits (C3, C4) must keep these passing: equipment off assembles byte for byte as before, on every board.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { SUPPORTED_MAPPERS, saveMediaImplemented } from '../../shared/cartridge.js';
import {
  normalizeProject,
  projectUsesEquipment,
  projectUsesMagicDefence,
  projectUsesMagicPower,
  validateProject
} from '../../shared/project.js';
import { RPG_BOARDS, actionVariant, buildHash, rpgVariant } from '../lib/equipvariants.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';

// sample-rpg on each RPG board, by { save, naming } (rpgVariant). 'save=0 naming=1' is the fixture exactly as checked in, so the MMC1 entry is also
// the sample-rpg hash in handoff-next/equip/c1b/fixture-hashes-after.txt (6ff7950f...).
const RPG_HASHES = {
  1: { // MMC1
    'save=0 naming=0': { size: 163856, hash: '554ba7fbc7bc67ebc415e9341e4adabd699d0a1c613f98b754738a0471bc9509' },
    'save=0 naming=1': { size: 163856, hash: '6ff7950fef409b9d63e37d3f4884bb020f82ffa4fa14ec9f1509acabb8c3a80e' },
    'save=1 naming=0': { size: 163856, hash: '0a23a4d94b416a95856b9e9c8337b15ac28e9932ceb02d67d4529e2b4473fe58' },
    'save=1 naming=1': { size: 163856, hash: '1ecf12a095b22eb1d0087c0cb5b862887434f6eea246b672d41f52552ed71fca' }
  },
  4: { // MMC3
    'save=0 naming=0': { size: 294928, hash: 'd2c321bd1cdd04545e9dedc2f216b23df2a3ae00ea973e43150fd006e4e56d85' },
    'save=0 naming=1': { size: 294928, hash: 'e831f71d7c21d82ee0740cd3949eb46f507402f8df974d16979aa1e196a91110' },
    'save=1 naming=0': { size: 294928, hash: 'd05d62ba2f5f233c0585d3cfeae12723346c9ff5950e29ece8f362fa784b1bdf' },
    'save=1 naming=1': { size: 294928, hash: '66e8b0bea22ea0e5212a2ef7024441657251358d126b322c522990aff17e3ebb' }
  },
  30: { // UNROM 512
    'save=0 naming=0': { size: 524304, hash: '66cad197054406904fbbdf422968bbd3f89172eb0d86238b0b772351f7d958f8' },
    'save=0 naming=1': { size: 524304, hash: 'e492ede55ea173c8e77d612833c3422e5d0059ef0768a76657fb1a6155143fda' },
    'save=1 naming=0': { size: 524304, hash: '12a282ab48615746c1deb1d4a2e216f73886c623eefd080edd17e7477b079293' },
    'save=1 naming=1': { size: 524304, hash: '7043ee6c248c2d850fa41559e33aab612111c055d07e91454ff72d0f28a5739f' }
  }
};

// The `sample` action game on every supported board, with no equipment data (the stripped project of case (4)).
const ACTION_HASHES = {
  'NROM-256': { size: 40976, hash: '442565369e9da7011901b459317adb4d3c07d9c24fd8f388bcf92b731829e846' },
  CNROM: { size: 40976, hash: 'f746e0a28f91066427e5c93577665a7dbbb3dc5bb0abf177aac0705d6013b527' },
  GxROM: { size: 40976, hash: '2ade8f082cc4d85756ee13e55601e1c28980ed12e952f2e71d3f586901895c13' },
  'Color Dreams': { size: 40976, hash: 'fe49465c2770a6f18ad34cd546f08e68c4c41e2b72b46e01fe92b829a31560a7' },
  UxROM: { size: 139280, hash: 'c09265c0b8a6b67e8eb34c525d2962388dae82054f219029ea700bfc5d908ce9' },
  'UNROM 512': { size: 524304, hash: '9f1d691ffcaada8e991220063da81a2168b59a4816e6af952eaf1bdb126c3ee6' },
  MMC1: { size: 139280, hash: 'f47e7789bebc9a75463863cf48a3fe60d08014c34f8b7502405a3381e28339f9' },
  MMC3: { size: 278544, hash: '937e49f477921b8dc3919e1582403999d716d17518ec689c700cda6f0e5f4586' }
};

const variantKey = ({ save, naming }) => `save=${+save} naming=${+naming}`;

test('the pin tables cover every RPG board and every supported board', () => {
  // Catches a new board that no identity pin covers: it would ship with equipment's byte-identity claim untested there.
  assert.deepEqual(Object.keys(RPG_HASHES).map(Number).sort((a, b) => a - b), RPG_BOARDS.map((board) => board.id));
  assert.deepEqual(Object.keys(ACTION_HASHES).sort(), SUPPORTED_MAPPERS.map((mapper) => mapper.name).sort());
});

// (2) Per-board pins for sample-rpg (only MMC1 was pinned before).
test('(2) sample-rpg builds to its pinned post-C1b hash on MMC1, MMC3 and UNROM 512', { skip }, async () => {
  // Catches any engine, generator or schema change that moves an RPG ROM when the project has no equipment.
  for (const board of RPG_BOARDS) {
    const built = await buildHash(await rpgVariant({ mapper: board.id, save: false, naming: true }));
    assert.deepEqual(built, RPG_HASHES[board.id]['save=0 naming=1'], board.name);
  }
});

// (3) The normalized shape itself changes nothing.
test('(3) sample-rpg with equip: null on every item and the section 1 fields present builds to the same hash', { skip }, async () => {
  // Catches a generator that reads `equip` or `startEquip` as present-means-on (an `equip: null` that still emits a table), and a normalizer whose
  // new keys leak into an emitted byte. The project is normalized (the keys really are there) and also handed over un-normalized with the keys set.
  for (const board of RPG_BOARDS) {
    const project = await rpgVariant({ mapper: board.id, save: false, naming: true });
    for (const item of project.items) item.equip = null;
    for (const member of project.party) member.startEquip = [null, null, null];
    assert.ok(project.items.length > 0 && project.items.every((item) => item.equip === null), 'the fields are present');
    assert.equal(projectUsesEquipment(project), false);
    assert.deepEqual(await buildHash(project), RPG_HASHES[board.id]['save=0 naming=1'], board.name);
    assert.deepEqual(await buildHash(normalizeProject(structuredClone(project))), RPG_HASHES[board.id]['save=0 naming=1'], `${board.name} (normalized)`);
  }
});

// (4) Dormant equipment on an action game.
//
// The ROM comparison is the load-bearing half and runs FIRST, before any predicate assertion: a predicate that ignored gameType would
// otherwise be caught by the cheap `projectUsesEquipment` check alone and the byte comparison would never have been shown to catch
// it. Two shapes, because a flag emitted without code changes no byte by itself: the plain action game, and one with Save live (the
// save record's field list, the descriptor tables and the Save kernel allowance all read the predicate -- C3 -- so a predicate that
// leaks a pc_equip field into an action game's record changes the ROM).
async function saveActionVariant(mapper) {
  const project = await actionVariant({ mapper });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
  return project;
}

function addDormantEquipment(project) {
  assert.ok(project.items.length > 0);
  project.items[0].equip = { slot: 1, atk: 255, def: 255, mag: 255, mdef: 255, usableBy: 0b1111 };
  project.party[0].startEquip = [null, 0, null];
}

test('(4) an action game whose items carry equip data builds byte-identical to the stripped project, on every board', { skip }, async () => {
  // Catches a predicate or generator that ignores gameType (equipment tables, magic power or defence assembled for an action game, a pc_equip
  // field in an action game's save record), and a dormant field that leaks into an emitted byte. The data is deliberately maximal: every
  // stat, MAG and MDEF included (the two that would turn magic on).
  const verdicts = [];
  for (const mapper of SUPPORTED_MAPPERS) {
    const stripped = await buildHash(await actionVariant({ mapper: mapper.id }));
    assert.deepEqual(stripped, ACTION_HASHES[mapper.name], `${mapper.name}: the stripped project is the post-C1b ROM`);
    const dormant = await actionVariant({ mapper: mapper.id });
    addDormantEquipment(dormant);
    verdicts.push([`${mapper.name}`, await buildHash(dormant), stripped]);

    if (!saveMediaImplemented(mapper)) continue;
    const savedStripped = await buildHash(await saveActionVariant(mapper.id));
    const savedDormant = await saveActionVariant(mapper.id);
    addDormantEquipment(savedDormant);
    verdicts.push([`${mapper.name} + Save`, await buildHash(savedDormant), savedStripped]);
  }
  for (const [label, built, expected] of verdicts) assert.deepEqual(built, expected, `${label}: dormant equipment changes no byte`);

  // Then the predicate half, and the control that "identical" is not "absent".
  for (const mapper of SUPPORTED_MAPPERS) {
    const dormant = await actionVariant({ mapper: mapper.id });
    addDormantEquipment(dormant);
    assert.equal(projectUsesEquipment(dormant), false, `${mapper.name}: the predicate is off for an action game`);
    assert.equal(projectUsesMagicPower(dormant), false);
    assert.equal(projectUsesMagicDefence(dormant), false);
    assert.ok(
      validateProject(dormant).some((problem) => problem.rule === 'equip-ignored-action-game'),
      `${mapper.name}: the dormant data really is in the project (the control for "identical because absent")`
    );
  }
});

// (5) Equipment-free Save and naming variants of an RPG.
test('(5) equipment-free Save and naming variants of sample-rpg build to the post-C1b hashes on all three RPG boards', { skip }, async () => {
  // Catches an equipment term that leaks into the Save or naming code paths when equipment is off (the allowance gated on Save alone, a flag
  // emitted unconditionally). Save on/off x naming on/off, apart and together: twelve builds, each pinned.
  for (const board of RPG_BOARDS) {
    for (const save of [false, true]) {
      for (const naming of [false, true]) {
        const variant = { save, naming };
        const built = await buildHash(await rpgVariant({ mapper: board.id, ...variant }));
        assert.deepEqual(built, RPG_HASHES[board.id][variantKey(variant)], `${board.name} ${variantKey(variant)}`);
      }
    }
  }
});
