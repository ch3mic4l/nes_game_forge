// Equipment (ROADMAP item 5), build commit C2: E4 byte identity, design-equipment.md section 8 (2)-(5). C2 adds a data model and no engine,
// generator or ROM change, so every ROM below must equal the hash the post-C1b tree (720d976) produced. The hashes are literals, captured by
// handoff-next/equip/c2/capture-pins.mjs on that tree before any C2 edit (a clean checkout of 720d976, built from mkdtemp copies); a test that
// read them from the tree under test would prove nothing. Every project is a loadProject() read of a checked-in fixture, edited in memory and
// built in its own mkdtemp directory: none of the six fixtures is written to or changes.
// RPG_HASHES were re-captured post-C3b (ruling E11: physical_damage's ATK parking fix moves every RPG ROM by two operand bytes). They
// are the output of rpgVariant/buildHash (test/lib/equipvariants.js) for each board and variant on the C3b tree, pasted as literals; old -> new
// in handoff-next/equip/c3b/pins.md. ACTION_HASHES did not move and stay the post-C1b values.
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
// the sample-rpg hash in handoff-next/equip/c3b/fixture-hashes-after.txt (46197555...).
const RPG_HASHES = {
  1: { // MMC1
    'save=0 naming=0': { size: 163856, hash: '8382f807243641513080b2583ad8326dcc0a28ff99bb0cd0b4bb0360b7cb2524' },
    'save=0 naming=1': { size: 163856, hash: '46197555869db699ddf3bd8f467320545038cc6e354cd808c3c763391030f643' },
    'save=1 naming=0': { size: 163856, hash: 'fd6d3104d7da2d26fa5a4da5534b9fcbbfdc22e5a174aaeaf83642e33be8e248' },
    'save=1 naming=1': { size: 163856, hash: '1c5d4db455e38fcb9b128b9cff19bc4fbfa834cbf5bac9d60a4b9559164e996a' }
  },
  4: { // MMC3
    'save=0 naming=0': { size: 294928, hash: '198df020d17429ce52d7d39d511b895b86eb28596ab1aa9e9d343dab590aa836' },
    'save=0 naming=1': { size: 294928, hash: '357a7b98fc2550649e4eb3e9ab4557bc62aef2285d9af55db8c95f19860ced0e' },
    'save=1 naming=0': { size: 294928, hash: '56b9db55e77842a1bc1e4005a340e4f941002ba40306209f8a4768da8ef08874' },
    'save=1 naming=1': { size: 294928, hash: '1c429467cf1984687ea7949c889af15c3df041102a7543e8f266ef20d6222489' }
  },
  30: { // UNROM 512
    'save=0 naming=0': { size: 524304, hash: '65e5db4f5c14bf29f1e2ec186b794c226eba736f813623569fabb31fb6f145a0' },
    'save=0 naming=1': { size: 524304, hash: '17991a5934c5f7062c97add7835eb374b8e7e52abfea5bd85fad3e8955d5b0db' },
    'save=1 naming=0': { size: 524304, hash: '99b8e37ac85d1203ba127f0c44807daafb297fe28323459889cb4881e9304210' },
    'save=1 naming=1': { size: 524304, hash: '85fb85e70b6781321a216fda14d2a6a8d84a97fae56899bfdaf029332dcca3df' }
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
test('(2) sample-rpg builds to its pinned post-C3b hash on MMC1, MMC3 and UNROM 512', { skip }, async () => {
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

// (4b) C4: the same dormant data PLUS an `equip` binding. ACTIONS gained `equip` (index 9) and the Controller Forge offers it in every game type, so an
// action game can bind it. The stripped reference here keeps the binding (the binding itself writes one byte of input.inc, so it cannot equal
// the unbound ACTION_HASHES); what must not move is everything the equipment DATA could add. The control proves the binding is in the ROM.
test('(4b) an action game with equip data AND an equip binding builds byte-identical to the same game with the binding and no equip data, on every board', { skip }, async () => {
  // Catches a dispatch chain whose `cmp #ACT_EQUIP` assembles unconditionally (it would move every action ROM by the compare, bound or not),
  // and an opener / Equip screen assembled for an action game because the binding exists. The binding is on Select in gameplay.
  const bind = (project) => {
    project.input.states.gameplay.SELECT = 'equip';
    return project;
  };
  for (const mapper of SUPPORTED_MAPPERS) {
    const unbound = await buildHash(await actionVariant({ mapper: mapper.id }));
    assert.deepEqual(unbound, ACTION_HASHES[mapper.name], `${mapper.name}: the unbound game is the pinned ROM (the ACTIONS append changed nothing)`);
    const bound = await buildHash(bind(await actionVariant({ mapper: mapper.id })));
    const dormant = bind(await actionVariant({ mapper: mapper.id }));
    addDormantEquipment(dormant);
    assert.deepEqual(await buildHash(dormant), bound, `${mapper.name}: equip data under an equip binding changes no byte`);
    assert.equal(bound.size, unbound.size, `${mapper.name}: the binding changes content, never the size`);
    assert.notEqual(bound.hash, unbound.hash, `${mapper.name}: control -- the binding is real (it is one byte of input.inc)`);
  }
});

// (5) Equipment-free Save and naming variants of an RPG.
test('(5) equipment-free Save and naming variants of sample-rpg build to the post-C3b hashes on all three RPG boards', { skip }, async () => {
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
