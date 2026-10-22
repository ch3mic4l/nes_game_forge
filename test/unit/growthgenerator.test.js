// Growth profiles, generator and magic gates (ROADMAP item 5 remainder, slice C2): `levelTable` in battletables.js and BOTH
// projectUsesMagicPower / projectUsesMagicDefence read growth through the resolver (effectiveGrowth / memberStatAt, shared/project.js),
// so a profile decides a party stat table and a magic gate exactly as the member's own fields did. Nothing in the engine, no allowance,
// no UI changed: the ROM of every profile-free project is byte-identical to the baseline.
//
// The ROM and battleTables hashes in T1/T2 are LITERALS pasted from handoff-next/classes/c0/pins.md, captured by c0/capture-pins.mjs on the
// unmodified tree (HEAD 621b0ab) before any growth-profile edit; a test that computed them from the tree under test would prove nothing.
// Every build runs in its own mkdtemp directory; every fixture is read-only (loaded or copied, edited in memory, never written back).
// Every test names the wrong implementation it catches. Sabotage runs: handoff-next/classes/c2/report.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { battleRegionBytes, battleTableBytes, battleTables, xpCurve } from '../../main/build/battletables.js';
import { kernelCodeBytes } from '../../main/build/generate.js';
import { codeRegions, resolveMapper } from '../../shared/cartridge.js';
import { saveIdentity } from '../../shared/save.js';
import {
  createGrowthProfile,
  createPartyMember,
  projectUsesMagicDefence,
  projectUsesMagicPower
} from '../../shared/project.js';
import { RPG_BOARDS, rpgVariant } from '../lib/equipvariants.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { RAM, SRAM_BASE, SRAM_SIZE, ST_GAMEPLAY, START, SELECT, boot, buildEquip, call, equipProject, selectBattleBank, tap, touchSaver } from '../lib/equipharness.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const opts = { skip: !hasNesasm && 'nesasm not found on PATH' };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

// ------------------------------------------------------------------------------------------------------------ helpers

const loadFixture = (name = 'sample-rpg') => loadProject(path.join(ROOT, name));

/** createGrowthProfile(id) with `over` ({ hp: [base, perLevel, shape], ... }) laid over the defaults (MAG and MDEF default to 0 / +0). */
function profile(id, over = {}) {
  const made = createGrowthProfile(id, `P${id}`);
  for (const [stat, [base, perLevel, shape = 'linear']] of Object.entries(over)) made[stat] = { base, perLevel, shape };
  return made;
}

/** Install `profiles` and assign them: `assign` maps a member index to a profile id. Mutates and returns `project`. */
function withProfiles(project, profiles, assign = {}) {
  project.growthProfiles = profiles;
  for (const [member, id] of Object.entries(assign)) project.party[Number(member)].profileId = id;
  return project;
}

const WAND = (mag, mdef) => ({
  id: 1,
  name: 'Wand',
  actorId: null,
  metaspriteId: null,
  effect: { kind: 'none', amount: 0 },
  equip: { slot: 0, atk: 0, def: 0, mag, mdef, usableBy: 0b1111 }
});

/** Numbers of one generated table (`label:` then `.db` rows up to the next label), or null when the table is absent. */
function table(text, label) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === `${label}:`);
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length && !/^\S+:/.test(lines[i]); i++) {
    for (const hex of lines[i].matchAll(/\$([0-9A-Fa-f]{2})/g)) out.push(parseInt(hex[1], 16));
  }
  return out;
}

/** Build `project` in a fresh mkdtemp directory; returns what the cells below assert on. */
async function measure(project) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-growthgen-'));
  try {
    await saveProject(dir, project);
    const lines = [];
    const built = await buildProject({ dir, project, log: (line) => lines.push(line) });
    const rom = await fs.readFile(built.romPath);
    const configText = await fs.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8').catch(() => '');
    const symbols = new Set(
      (await fs.readFile(built.symbolPath, 'utf8')).split('\n').map((line) => line.match(/^(\w+)\s*=/)?.[1]).filter(Boolean)
    );
    const mapper = resolveMapper(project.cartridge.mapper);
    const slot = codeRegions(mapper, project.tilesets.length, 1)[0];
    const bankLine = slot && lines.find((line) => new RegExp(`^BANK\\s+${slot.nesasmBank}\\s`).test(line));
    const used = bankLine ? Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]) : null;
    return {
      project,
      rom: sha(rom),
      size: rom.length,
      config: sha(configText),
      flag: (name) => Number(configText.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'))?.[1]),
      symbols,
      tables: battleTables(project),
      used,
      predicted: battleRegionBytes(project, mapper),
      tableBytes: battleTableBytes(project)
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const zeros = (n) => Array(n).fill(0);
const ROW0 = zeros(8); // sample-rpg: maxLevel 8
const range = (from, step, n = 8) => Array.from({ length: n }, (_, i) => from + step * i);

/**
 * One cell of the gate matrix. `want` gives, for the four magic columns, either the literal numbers it must carry or null
 * (absent from the tables AND from the assembled symbols), plus both predicates and both config flags. The region accounting rides
 * along: battleRegionBytes must equal the assembler's own count for that exact build.
 */
function assertCell(m, label, want) {
  const { power, defence, pcMag, monMag, pcMdef, monMdef } = want;
  assert.equal(projectUsesMagicPower(m.project), power, `${label}: projectUsesMagicPower`);
  assert.equal(projectUsesMagicDefence(m.project), defence, `${label}: projectUsesMagicDefence`);
  assert.equal(m.flag('MAGIC_POWER_ENABLED'), +power, `${label}: MAGIC_POWER_ENABLED`);
  assert.equal(m.flag('MAGIC_DEFENCE_ENABLED'), +defence, `${label}: MAGIC_DEFENCE_ENABLED`);
  for (const [name, literal] of [['pc_mag_at', pcMag], ['mon_mag', monMag], ['pc_mdef_at', pcMdef], ['mon_mdef', monMdef]]) {
    assert.deepEqual(table(m.tables, name), literal, `${label}: ${name} contents (null = absent)`);
    assert.equal(m.symbols.has(name), literal !== null, `${label}: ${name} in the assembled symbols`);
  }
  assert.equal(m.used, m.predicted, `${label}: battleRegionBytes equals nesasm's own usage of the banked region`);
}

const OFF = { power: false, defence: false, pcMag: null, monMag: null, pcMdef: null, monMdef: null };

// ----------------------------------------------------------------------------------- C0 pins (pasted from c0/pins.md)

const BATTLE_TABLES_SHA = {
  'sample-rpg': '87833067add35409f05f086b735a4f66e410448b16597f72826fd266eeee0367',
  'sample-rpg-mmc1': 'e120b358ea0dc9b8528c1ebba347b595f8cf692377630f14c595ce3b69c8340c'
};
const FIXTURE_PINS = {
  sample: { size: 40976, rom: '442565369e9da7011901b459317adb4d3c07d9c24fd8f388bcf92b731829e846', config: '170d4ed7b6114ea811980446c6ffbf7518d299d19f9579c516f8be69c8928c29' },
  'sample-mmc1': { size: 139280, rom: '54150a3dc8bc958c56a08b7105423046c8d2503e2c9986210be61387109e9833', config: 'd3a5ac153b2478aa724acbf6af2dcf1d8c907cc82630e69080aaddc79c172825' },
  'sample-mmc3': { size: 278544, rom: '7069a6341ae75c5ed1187981a8a1486cf1e61c4ccb3cdc6b208acec5017362ec', config: 'd15c8a70c1a35764a472e54ca90f96c9a715a14d2696d20740c2a688b123bc6a' },
  'sample-u512': { size: 524304, rom: '44b4d10952d4ce7da7c7113f8bf186fa19b5558ad1cc12caf7a1ee8472547525', config: 'bb4abdb6be6025eff7e67771728a901b7d3e0d21db41f7dec2724b23deadc9be' },
  'sample-rpg': { size: 163856, rom: '46197555869db699ddf3bd8f467320545038cc6e354cd808c3c763391030f643', config: '759812cd3fd36d4401beb805c0b285609ee0278f7aa069cb6a0d34005f3adf53' },
  'sample-rpg-mmc1': { size: 147472, rom: '0cb33fec9be29c716b9682b55c6e039faee0f2752b778dabc17b959ed5e7b9b3', config: 'ef885af098a474c0bf1ef289e921ea7a0c848198a5eb1a71e2cf48c381be41d5' }
};
// rpgVariant (test/lib/equipvariants.js), keyed `<mapper id> save=<0|1> naming=<0|1>`.
const VARIANT_PINS = {
  '1 save=0 naming=0': { size: 163856, rom: '8382f807243641513080b2583ad8326dcc0a28ff99bb0cd0b4bb0360b7cb2524', config: 'd7435240e273dd021daa26ae0d2d1bf5e12a5a358e83899186f7614adb94f955' },
  '1 save=0 naming=1': { size: 163856, rom: '46197555869db699ddf3bd8f467320545038cc6e354cd808c3c763391030f643', config: '759812cd3fd36d4401beb805c0b285609ee0278f7aa069cb6a0d34005f3adf53' },
  '1 save=1 naming=0': { size: 163856, rom: 'fd6d3104d7da2d26fa5a4da5534b9fcbbfdc22e5a174aaeaf83642e33be8e248', config: '78456dc34b8b67cf9c2ab01fe3c645c09c8483832664c24d0ff4630ebfe3826e' },
  '1 save=1 naming=1': { size: 163856, rom: '1c5d4db455e38fcb9b128b9cff19bc4fbfa834cbf5bac9d60a4b9559164e996a', config: '03c23c788d2bd425996b424416ae3f623f752971f73ca39015e1c41a583d12a6' },
  '4 save=0 naming=0': { size: 294928, rom: '198df020d17429ce52d7d39d511b895b86eb28596ab1aa9e9d343dab590aa836', config: 'd6e3686f9faf96e91e71ce6b2a5c4105a44c58717bf3e8c48e4c505724cf139c' },
  '4 save=0 naming=1': { size: 294928, rom: '357a7b98fc2550649e4eb3e9ab4557bc62aef2285d9af55db8c95f19860ced0e', config: 'd5b98d537ba401c60b74435c80f113f5221b0f2f15184779e9dc605df341080f' },
  '4 save=1 naming=0': { size: 294928, rom: '56b9db55e77842a1bc1e4005a340e4f941002ba40306209f8a4768da8ef08874', config: 'cecab6198ee81cb492b0c3309998fe0f3f8a62b4170a38d3223a84cda4d6d7ce' },
  '4 save=1 naming=1': { size: 294928, rom: '1c429467cf1984687ea7949c889af15c3df041102a7543e8f266ef20d6222489', config: '791b0d30e55da8de63490f7eae5e8eac43d00523f7f22bc7ea045b842cdaae7c' },
  '30 save=0 naming=0': { size: 524304, rom: '65e5db4f5c14bf29f1e2ec186b794c226eba736f813623569fabb31fb6f145a0', config: '1f42b84d5d0e85d1a0cadedb773a53b2a08b573655e2ebfe8482758ae6a1ee90' },
  '30 save=0 naming=1': { size: 524304, rom: '17991a5934c5f7062c97add7835eb374b8e7e52abfea5bd85fad3e8955d5b0db', config: '5a25737cab69f2d232a98bc0ae45cc867ffca84e4bb9ef2adef1789abc8c64cb' },
  '30 save=1 naming=0': { size: 524304, rom: '99b8e37ac85d1203ba127f0c44807daafb297fe28323459889cb4881e9304210', config: 'c3ec421b06156164631b7062871338f9fe3c6fcedc5f7fe639a6ea8258085f09' },
  '30 save=1 naming=1': { size: 524304, rom: '85fb85e70b6781321a216fda14d2a6a8d84a97fae56899bfdaf029332dcca3df', config: 'cfdddc7ace0ea4ff7f95ede43eba5caf45053c594d2f46bc8e32cd057a6bec15' }
};
const STREAMED_SAVE_PIN = {
  size: 524304,
  rom: '91f5a4951ac0478b463d810cc31aafaf196dfeb7ae71f81fa72b42d425e25a6c',
  config: '2ed99df5975b2853ff318285add44e065009be01d59f3e11699f2ac80ee045a9',
  tables: 'e46e8b511c494a9d5aeaf3e7531716c6879a9f375b2101d425ab01491d1aaece'
};
const BASELINE = FIXTURE_PINS['sample-rpg']; // sample-rpg as checked in == rpgVariant { MMC1, save 0, naming 1 }

/** capture-pins.mjs's fixture build: the fixture copied WITHOUT build/ to a mkdtemp directory, loaded there, built there. */
async function buildFixtureCopy(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-growthgen-fx-'));
  try {
    await fs.cp(path.join(ROOT, name), dir, { recursive: true, filter: (src) => path.basename(src) !== 'build' });
    const project = await loadProject(dir);
    const built = await buildProject({ dir, project, log: () => {} });
    const rom = await fs.readFile(built.romPath);
    const config = await fs.readFile(path.join(dir, 'build', 'assets', 'config.inc'));
    return { size: rom.length, rom: sha(rom), config: sha(config) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const identity = (m) => ({ size: m.size, rom: m.rom, config: m.config });

// ------------------------------------------------------------------------------------------------------- T1 / T2 pins

test('T1: battleTables(sample-rpg) and (sample-rpg-mmc1) text equal the C0 literal sha256', async () => {
  // Catches any table-text change for a profile-free project: levelTable now goes through memberStatAt, and a resolver that
  // altered a single byte of an unprofiled member's row (an off-by-one k, a clamp) would move this hash.
  for (const name of ['sample-rpg', 'sample-rpg-mmc1']) {
    assert.equal(sha(battleTables(await loadFixture(name))), BATTLE_TABLES_SHA[name], name);
  }
});

test('T2: the six fixtures build to their C0 ROM and config.inc hashes', opts, async () => {
  // Catches a generator or gate change that moves any fixture ROM: all six have profileId null on every member, so none may move.
  for (const [name, pin] of Object.entries(FIXTURE_PINS)) {
    assert.deepEqual(await buildFixtureCopy(name), pin, name);
  }
});

test('T2: profile-free sample-rpg variants (3 boards x Save x naming) and a streamed + Save UNROM 512 RPG match their C0 hashes', opts, async () => {
  // Catches a profile term leaking into the Save, naming or streamed paths of a project that has no profile.
  for (const board of RPG_BOARDS) {
    for (const save of [false, true]) {
      for (const naming of [false, true]) {
        const m = await measure(await rpgVariant({ mapper: board.id, save, naming }));
        assert.deepEqual(identity(m), VARIANT_PINS[`${board.id} save=${+save} naming=${+naming}`], `${board.name} save=${+save} naming=${+naming}`);
      }
    }
  }
  const streamed = createStreamedProject({ gameType: 'rpg', dialogue: [{ text: 'Hello.', save: true }] });
  streamed.project.titleMap = 0;
  streamed.project.titleScreen = 0;
  const m = await measure(streamed);
  assert.deepEqual(identity(m), { size: STREAMED_SAVE_PIN.size, rom: STREAMED_SAVE_PIN.rom, config: STREAMED_SAVE_PIN.config });
  assert.equal(sha(m.tables), STREAMED_SAVE_PIN.tables, 'streamed + Save battleTables');
});

// ------------------------------------------------------------------------------------------------------------ T3, T4

test('T3: a linear profile equal to each member\'s custom numbers builds the identical ROM, retained custom numbers or not', opts, async () => {
  // Catches a resolver that perturbs a linear table (k off by one, a different clamp), and a generator that still reads the
  // member's own fields for a profile-assigned member (the second build gives the members wild retained numbers that must not leak).
  const project = await loadFixture();
  const profiles = project.party.map((member, id) =>
    profile(id, {
      hp: [member.baseHp, member.hpPerLevel],
      mp: [member.baseMp, member.mpPerLevel],
      atk: [member.baseAtk, member.atkPerLevel],
      def: [member.baseDef, member.defPerLevel],
      mag: [member.baseMag, member.magPerLevel],
      mdef: [member.baseMdef, member.mdefPerLevel]
    })
  );
  const assigned = withProfiles(structuredClone(project), profiles, { 0: 0, 1: 1 });
  assert.deepEqual(identity(await measure(assigned)), BASELINE, 'one linear profile per member');

  const retained = structuredClone(assigned);
  for (const member of retained.party) {
    Object.assign(member, { baseHp: 99, hpPerLevel: 7, baseMp: 77, mpPerLevel: 3, baseAtk: 200, atkPerLevel: 9, baseDef: 100, defPerLevel: 5 });
  }
  assert.deepEqual(identity(await measure(retained)), BASELINE, 'custom numbers retained under the profile decide nothing');
});

test('T4: an unreferenced profile with MAG and MDEF moves no gate and no byte', opts, async () => {
  // Catches a gate on a profile's existence (S3: `growthProfiles.some(p => p.mag.base > 0)`): the project has the profile, no member uses it.
  const project = withProfiles(await loadFixture(), [profile(0, { mag: [9, 1], mdef: [9, 1] })]);
  const m = await measure(project);
  assertCell(m, 'unreferenced', OFF);
  assert.deepEqual(identity(m), BASELINE, 'the unreferenced profile changes no byte of the ROM');
});

// ------------------------------------------------------------------------------------------------------------- T5, T-G

test('T5: a referenced profile with MAG > 0 (member MAG 0) switches the gate on, carries its row, and the region model equals nesasm, on all three boards', opts, async () => {
  // Catches a gate still reading member.baseMag (S1): a profile-only mage would build with magic power silently off.
  for (const board of RPG_BOARDS) {
    const project = withProfiles(await loadFixture(), [profile(0, { mag: [9, 1] })], { 0: 0 });
    project.cartridge.mapper = board.id;
    const m = await measure(project);
    assertCell(m, board.name, { power: true, defence: false, pcMag: [...range(9, 1), ...ROW0], monMag: zeros(4), pcMdef: null, monMdef: null });
  }
});

test('T-G (i)-(iii): a MAG-only, an MDEF-only and a both profile turn on exactly their own gate and columns', opts, async () => {
  // Catches S1 (MAG gate on raw fields: (i) and (iii) fail) and S8 (MDEF gate left on raw fields while MAG is updated: (ii) and (iii) fail).
  const mag = withProfiles(await loadFixture(), [profile(0, { mag: [9, 1] })], { 0: 0 });
  assertCell(await measure(mag), '(i) MAG-only profile', { power: true, defence: false, pcMag: [...range(9, 1), ...ROW0], monMag: zeros(4), pcMdef: null, monMdef: null });

  const mdef = withProfiles(await loadFixture(), [profile(0, { mdef: [7, 2] })], { 0: 0 });
  assertCell(await measure(mdef), '(ii) MDEF-only profile', { power: false, defence: true, pcMag: null, monMag: null, pcMdef: [...range(7, 2), ...ROW0], monMdef: zeros(4) });

  const both = withProfiles(await loadFixture(), [profile(0, { mag: [9, 1], mdef: [7, 2] })], { 0: 0 });
  assertCell(await measure(both), '(iii) both', {
    power: true,
    defence: true,
    pcMag: [...range(9, 1), ...ROW0],
    monMag: zeros(4),
    pcMdef: [...range(7, 2), ...ROW0],
    monMdef: zeros(4)
  });
});

test('T-G (iv): each unreferenced profile (MAG, MDEF, both) leaves both gates off and the ROM at the baseline', opts, async () => {
  // Catches S3, a gate on existence, in either predicate separately.
  for (const [label, over] of [['MAG', { mag: [9, 1] }], ['MDEF', { mdef: [7, 2] }], ['both', { mag: [9, 1], mdef: [7, 2] }]]) {
    const m = await measure(withProfiles(await loadFixture(), [profile(0, over)]));
    assertCell(m, `(iv) unreferenced ${label}`, OFF);
    assert.deepEqual(identity(m), BASELINE, `(iv) ${label}: ROM unchanged`);
  }
});

test('T-G (v): raw baseMag 8 is overridden by a referenced zero profile, and is a live gate without it', opts, async () => {
  // Catches a MAG gate that ORs the member's raw fields back in (S13, MAG form): the member's own 8 must not count under a profile.
  const raw = await loadFixture();
  raw.party[0].baseMag = 8;
  assertCell(await measure(raw), '(v) control, no profile', { power: true, defence: false, pcMag: [...zeros(8).fill(8), ...ROW0], monMag: zeros(4), pcMdef: null, monMdef: null });
  assertCell(await measure(withProfiles(structuredClone(raw), [profile(0)], { 0: 0 })), '(v) zero profile assigned', OFF);
});

test('T-G (vi): an actor with battle.mag > 0 keeps the gate on with no profile at all', opts, async () => {
  // Catches a predicate rewritten so that the party branch is the only source (the actor source dropped).
  const project = await loadFixture();
  project.sprites.actors[0].battle.mag = 5;
  assertCell(await measure(project), '(vi) actor MAG', { power: true, defence: false, pcMag: [...ROW0, ...ROW0], monMag: [5, 0, 0, 0], pcMdef: null, monMdef: null });
});

test('T-G (vii): a referenced zero profile overrides retained raw MDEF, for the base and the per-level number independently', opts, async () => {
  // Catches S13, the stale raw-MDEF OR (`|| member.baseMdef > 0 || member.mdefPerLevel > 0` kept beside the effective read):
  // (i)-(vi) and T5 all start with raw MDEF 0, so only these cells can see it. Each control proves the raw number alone is a live gate.
  for (const [label, set, row] of [
    ['baseMdef 8', { baseMdef: 8 }, zeros(8).fill(8)],
    ['mdefPerLevel 3', { mdefPerLevel: 3 }, range(0, 3)]
  ]) {
    const raw = await loadFixture();
    Object.assign(raw.party[0], set);
    assertCell(await measure(raw), `(vii) control ${label}`, { power: false, defence: true, pcMag: null, monMag: null, pcMdef: [...row, ...ROW0], monMdef: zeros(4) });
    assertCell(await measure(withProfiles(structuredClone(raw), [profile(0)], { 0: 0 })), `(vii) ${label} under a zero profile`, OFF);
  }
});

test('T-G (viii): a referenced zero profile overrides a per-level-only raw MAG (magPerLevel 3, baseMag 0)', opts, async () => {
  // Catches the per-level half of a stale raw-MAG OR (S13, MAG form), which cell (v) (raw base only) cannot see.
  const raw = await loadFixture();
  raw.party[0].magPerLevel = 3;
  assertCell(await measure(raw), '(viii) control', { power: true, defence: false, pcMag: [...range(0, 3), ...ROW0], monMag: zeros(4), pcMdef: null, monMdef: null });
  assertCell(await measure(withProfiles(structuredClone(raw), [profile(0)], { 0: 0 })), '(viii) under a zero profile', OFF);
});

test('T-G: a profile whose MAG (MDEF) has base 0 and per-level 3, raw member stats zero, keeps its own gate, flag and columns, the other gate off', opts, async () => {
  // Catches a party source that checks a profile's base alone (`base > 0 || (member.profileId == null && perLevel > 0)`): every other
  // profile cell gives the stat a positive base, and the per-level-only controls above exercise retained custom growth, not a profile.
  const STEP = range(0, 3); // [0, 3, ..., 21] over the sample-rpg's 8 levels
  const mag = withProfiles(await loadFixture(), [profile(0, { mag: [0, 3] })], { 0: 0 });
  assertCell(await measure(mag), 'MAG step-only profile', { power: true, defence: false, pcMag: [...STEP, ...ROW0], monMag: zeros(4), pcMdef: null, monMdef: null });
  const mdef = withProfiles(await loadFixture(), [profile(0, { mdef: [0, 3] })], { 0: 0 });
  assertCell(await measure(mdef), 'MDEF step-only profile', { power: false, defence: true, pcMag: null, monMag: null, pcMdef: [...STEP, ...ROW0], monMdef: zeros(4) });
});

// (ix): four cells, one test each, so a predicate that fails any ONE of the four sources names it. Each cell is built against the same
// cell with that one stat toggled back to 0 (the same piece, items and every other datum in both).
const IX_CASES = [
  {
    label: 'actor MAG',
    mutate: (p) => (p.sprites.actors[0].battle.mag = 5),
    want: { power: true, defence: false, pcMag: [...ROW0, ...ROW0], monMag: [5, 0, 0, 0], pcMdef: null, monMdef: null },
    region: 82,
    tables: 20
  },
  {
    label: 'actor MDEF',
    mutate: (p) => (p.sprites.actors[3].battle.mdef = 7),
    want: { power: false, defence: true, pcMag: null, monMag: null, pcMdef: [...ROW0, ...ROW0], monMdef: [0, 0, 0, 7] },
    region: 76,
    tables: 20
  },
  {
    label: 'equipment MAG',
    wand: [9, 0],
    want: { power: true, defence: false, pcMag: [...ROW0, ...ROW0], monMag: zeros(4), pcMdef: null, monMdef: null },
    region: 109,
    tables: 22
  },
  {
    label: 'equipment MDEF',
    wand: [0, 9],
    want: { power: false, defence: true, pcMag: null, monMag: null, pcMdef: [...ROW0, ...ROW0], monMdef: zeros(4) },
    region: 103,
    tables: 22
  }
];

/** sample-rpg with the zero profile on member 0, raw MAG / MDEF 8 retained under it, and the Wand piece (stats `wand`) in the catalog. */
async function ixProject({ mutate = () => {}, wand = [0, 0] } = {}) {
  const project = withProfiles(await loadFixture(), [profile(0)], { 0: 0 });
  Object.assign(project.party[0], { baseMag: 8, baseMdef: 8 });
  project.items.push(WAND(...wand));
  mutate(project);
  return project;
}

for (const { label, mutate, wand, want, region, tables } of IX_CASES) {
  test(`T-G (ix): with the zero profile still assigned and raw MAG / MDEF positive, ${label} alone keeps its own gate, flag and columns`, opts, async () => {
    // Catches S14 (a profile-branch early return: the predicate answers false once an assigned profile has no growth, skipping the actor
    // and equipment sources). The cell must stay on with the other gate and its two columns off, and the region must grow by exactly the
    // existing feature's price (actor +82 / +76, equipment +109 / +103 with +22 table bytes) against the same build with the stat at 0.
    const off = await measure(await ixProject());
    assertCell(off, '(ix) base: zero profile, zero sources', OFF);
    const on = await measure(await ixProject({ mutate, wand }));
    assertCell(on, `(ix) ${label}`, want);
    assert.equal(on.used - off.used, region, `${label}: real region bytes against the same cell with the stat at 0`);
    assert.equal(on.tableBytes - off.tableBytes, tables, `${label}: table bytes against the same cell with the stat at 0`);
  });
}

for (const { label, wand, want, region } of IX_CASES.filter((c) => c.wand)) {
  test(`T-G (ix) control: the unprofiled ${label} build has the same predicates, literal columns and region delta`, opts, async () => {
    // The unprofiled equipment-only control (raw MAG / MDEF 0, no profile): what the profile cells above are measured to equal.
    const offProject = await loadFixture();
    offProject.items.push(WAND(0, 0));
    const off = await measure(offProject);
    const onProject = await loadFixture();
    onProject.items.push(WAND(...wand));
    const on = await measure(onProject);
    assertCell(on, `(ix) unprofiled ${label}`, want);
    assert.equal(on.used - off.used, region, `${label}: region delta`);
  });
}

// ------------------------------------------------------------------------------------------------------------ T6-T8

// A profile giving every stat a non-linear shape. Rows for maxLevel 8 (k = 0..7), computed from the section 3.2 formulas by hand --
//   early: base + floor((p*k*(28-k) + 7) / 14);  late: base + floor((p*k*k + 7) / 14)
// -- and cross-checked against the design's own goldens (perLevel 3: early k=1,2,14 -> 6, 11, 42; late k=1,2,7,14 -> 0, 1, 11, 42;
// base 24 / +3 at level 8: early 56, late 35).
const MIXED = { hp: [24, 3, 'early'], mp: [8, 3, 'late'], atk: [6, 2, 'early'], def: [4, 2, 'late'], mag: [9, 1, 'early'], mdef: [2, 4, 'late'] };
const MIXED_ROWS = {
  pc_hp_at: [24, 30, 35, 40, 45, 49, 52, 56],
  pc_mp_at: [8, 8, 9, 10, 11, 13, 16, 19],
  pc_atk_at: [6, 10, 13, 17, 20, 22, 25, 27],
  pc_def_at: [4, 4, 5, 5, 6, 8, 9, 11],
  pc_mag_at: [9, 11, 13, 14, 16, 17, 18, 20],
  pc_mdef_at: [2, 2, 3, 5, 7, 9, 12, 16]
};
const LINEAR_ROWS = { pc_hp_at: range(24, 5), pc_mp_at: range(8, 2), pc_atk_at: range(6, 1), pc_def_at: range(4, 1) };

test('T6: a non-linear profile emits the hand-computed rows for all six stats (member 0), and the other member keeps its own', async () => {
  // Catches a resolver that ignores shape (S2), a stat routed to the wrong table, and a generator that still reads the member's own fields.
  const project = withProfiles(await loadFixture(), [profile(0, MIXED)], { 0: 0 });
  const text = battleTables(project);
  for (const [name, row] of Object.entries(MIXED_ROWS)) {
    const all = table(text, name);
    assert.deepEqual(all.slice(0, 8), row, `${name} member 0`);
    assert.deepEqual(all.slice(8), name === 'pc_mag_at' || name === 'pc_mdef_at' ? ROW0 : LINEAR_ROWS[name], `${name} member 1 (unprofiled)`);
  }
});

test('T7: T6 on a streamed RPG on UNROM 512, and with Save on', opts, async () => {
  // Catches a streamed-world or Save path that bypasses the profile-backed table (the streamed project builds a different generator branch).
  for (const save of [false, true]) {
    const streamed = createStreamedProject({ gameType: 'rpg', ...(save ? { dialogue: [{ text: 'Hello.', save: true }] } : {}) });
    const project = streamed;
    if (save) {
      project.project.titleMap = 0;
      project.project.titleScreen = 0;
    }
    project.rpg.maxLevel = 8;
    withProfiles(project, [profile(0, MIXED)], { 0: 0 });
    const m = await measure(project);
    const label = `streamed${save ? ' + Save' : ''}`;
    for (const [name, row] of Object.entries(MIXED_ROWS)) {
      assert.deepEqual(table(m.tables, name).slice(0, 8), row, `${label}: ${name}`);
    }
    assert.equal(m.flag('MAGIC_POWER_ENABLED'), 1, label);
    assert.equal(m.flag('MAGIC_DEFENCE_ENABLED'), 1, label);
    assert.equal(m.used, m.predicted, `${label}: battleRegionBytes equals nesasm`);
  }
});

test('T8: two members sharing a profile get identical rows; reassigning one changes only that member\'s row; editing the profile moves every user', async () => {
  // Catches a resolver that memoizes per profile instead of per member, or a table that is keyed by profile instead of by member.
  const early = profile(0, { hp: [24, 3, 'early'] });
  const late = profile(1, { hp: [24, 3, 'late'] });
  const project = withProfiles(await loadFixture(), [early, late], { 0: 0, 1: 0 });
  const hp = (p) => table(battleTables(p), 'pc_hp_at');
  const EARLY = [24, 30, 35, 40, 45, 49, 52, 56];
  const LATE = [24, 24, 25, 26, 27, 29, 32, 35];
  assert.deepEqual(hp(project), [...EARLY, ...EARLY], 'both on the early profile');
  project.party[1].profileId = 1;
  assert.deepEqual(hp(project), [...EARLY, ...LATE], 'member 1 reassigned: member 0 untouched');
  project.growthProfiles[1].hp = { base: 24, perLevel: 3, shape: 'early' };
  assert.deepEqual(hp(project), [...EARLY, ...EARLY], 'editing profile 1 moves its user');
});

test('T-N2b: a referenced non-linear profile\'s emitted rows at level cap 1 and 5 are the prefix of its rows at cap 15', async () => {
  // Catches S12 in the generator: a horizon taken from project.rpg.maxLevel would retune every level when the cap changes.
  // The pure resolver version of this is T-N2 (growthprofiles.test.js); this one exercises the integrated generator.
  const base = await loadFixture();
  const rows = (cap) => {
    const project = withProfiles(structuredClone(base), [profile(0, MIXED)], { 0: 0 });
    project.rpg.maxLevel = cap;
    const text = battleTables(project);
    return Object.fromEntries(Object.keys(MIXED_ROWS).map((name) => [name, table(text, name).slice(0, cap)]));
  };
  const full = rows(15);
  assert.equal(full.pc_hp_at.length, 15);
  assert.equal(full.pc_hp_at[14], 66, 'early, base 24 +3: base + 14 * 3 at level 15');
  assert.equal(full.pc_mdef_at[14], 58, 'late, base 2 +4: base + 14 * 4 at level 15');
  for (const cap of [1, 5]) {
    const cut = rows(cap);
    for (const name of Object.keys(MIXED_ROWS)) assert.deepEqual(cut[name], full[name].slice(0, cap), `${name} at cap ${cap}`);
  }
});

// ----------------------------------------------------------------------------------------------------------- T9, T10

const FIRST_MEMBER = { hp: [24, 3, 'early'] };
const SECOND_MEMBER = { hp: [40, 3, 'late'] }; // retained own HP stays the fixture's 24/+5, so 40 and 43 can only come from the profile

test('T9: level-ups read the profile: an early-bloomer and a delayed-join member on a profile reach the hand-computed pc_hp_max', opts, async (t) => {
  // Catches a table that is right but not what try_level_up reads (a stale row base), and a profile applied to the first member only.
  const profiled = await buildEquip(
    t,
    await equipProject({ mutate: (p) => withProfiles(p, [profile(0, FIRST_MEMBER), profile(1, SECOND_MEMBER)], { 0: 0, 1: 1 }) })
  );
  const linear = await buildEquip(t, await equipProject());
  assert.equal(profiled.project.party[1].startsInParty, false, 'member 1 is the delayed-join member');
  const curve = xpCurve(profiled.project.rpg);

  const levelTo = (built, member, level) => {
    const nes = boot(built.romPath);
    selectBattleBank(nes, built);
    if (member === 1) {
      // The delayed-join member is recruited by the real party_join before any XP: join loads the profile's level-1 HP (40; its own
      // retained 24/+5 would give 24), current HP included.
      assert.equal(nes.cpu.mem[RAM.PC_IN_PARTY + member], 0, 'member 1 starts unjoined');
      call(nes, built, 'party_join', { x: member });
      assert.equal(nes.cpu.mem[RAM.PC_IN_PARTY + member], 1, 'party_join recruited member 1');
      assert.equal(nes.cpu.mem[RAM.PC_HP_MAX + member], 40, 'join loads the profile\'s level-1 HP maximum');
      assert.equal(nes.cpu.mem[RAM.PC_HP + member], 40, 'join loads the profile\'s level-1 current HP');
    }
    nes.cpu.mem[RAM.PC_XP_LO + member] = curve[level - 2] & 0xff; // exactly the total that reaches `level`
    nes.cpu.mem[RAM.PC_XP_HI + member] = (curve[level - 2] >> 8) & 0xff;
    call(nes, built, 'try_level_up', { x: member });
    assert.equal(nes.cpu.mem[RAM.PC_LEVEL + member], level, `member ${member} reached level ${level}`);
    return nes.cpu.mem[RAM.PC_HP_MAX + member];
  };
  assert.equal(levelTo(profiled, 0, 5), 45, 'early profile, level 5 (the member\'s own +5 growth would give 44)');
  assert.equal(levelTo(profiled, 0, 2), 30, 'early profile, level 2 (the member\'s own +5 growth gives 29)');
  assert.equal(levelTo(linear, 0, 2), 29, 'control: the same member without the profile');
  assert.equal(levelTo(profiled, 1, 5), 43, 'delayed-join member on a late 40/+3 profile, level 5 (its own 24/+5 growth would give 44)');
});

test('T10: Continue after the profile is edited recomputes pc_hp_max from the NEW profile (like editing hpPerLevel)', opts, async (t) => {
  // Catches a restore that trusts the saved byte: a build edited between save and load must move a saved member's max HP exactly
  // as editing hpPerLevel does today. Both ROMs share one save identity (a profile edit alone must not move it, or Continue is refused).
  const make = (hp) => equipProject({ save: true, mutate: (p) => withProfiles(p, [profile(0, { hp })], { 0: 0 }) });
  const a = await buildEquip(t, await make([24, 3, 'early']));
  const b = await buildEquip(t, await make([24, 3, 'late']));
  assert.equal(saveIdentity(a.project), saveIdentity(b.project), 'a profile edit alone does not move saveIdentity');
  const EARLY_L3 = 35; // early, base 24 +3, k = 2 (see T6)
  const LATE_L3 = 25; // late, same, k = 2
  assert.notEqual(EARLY_L3, LATE_L3);

  const MARKER_OFFSET = 0x7e; // shared/save.js SAVE_FIELDS (120 bytes) + checksum 2 + identity 4; save.test.js SAVE_MARKER_OFFSET
  const nesA = boot(a.romPath, 60);
  tap(nesA, START, 30);
  assert.equal(nesA.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY, 'New Game reached gameplay (naming is off)');
  nesA.cpu.mem[RAM.PC_LEVEL] = 3;
  nesA.cpu.mem[RAM.PC_HP_MAX] = EARLY_L3; // exactly what ROM A itself holds at level 3
  nesA.cpu.mem[RAM.PC_HP] = EARLY_L3;
  touchSaver(nesA, () => nesA.cpu.mem[SRAM_BASE + MARKER_OFFSET] === 0xa5);
  assert.equal(nesA.cpu.mem[RAM.PC_LEVEL], 3);
  const battery = nesA.cpu.mem.slice(SRAM_BASE, SRAM_BASE + SRAM_SIZE);

  const nesB = boot(b.romPath, 60);
  nesB.cpu.mem.set(battery, SRAM_BASE);
  tap(nesB, SELECT, 30); // Continue
  assert.equal(nesB.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY, 'ROM B accepted the transplanted save');
  assert.equal(nesB.cpu.mem[RAM.PC_LEVEL], 3);
  assert.equal(nesB.cpu.mem[RAM.PC_HP_MAX], LATE_L3, 'pc_hp_max is the new profile\'s level-3 value, not the saved 35');
});

// ------------------------------------------------------------------------------------------------------------------ T11

test('T11: a profile adds no kernel-lo allowance: kernelCodeBytes of a profile-using project equals the same project without', async () => {
  // Catches S6, a stray `GROWTH_*_ALLOWANCE` charged to kernelCodeBytes (the banked-region twin is every cell's used == predicted above).
  for (const board of RPG_BOARDS) {
    const plain = await loadFixture();
    plain.cartridge.mapper = board.id;
    const used = withProfiles(structuredClone(plain), [profile(0, MIXED), profile(1)], { 0: 0, 1: 1 });
    assert.equal(kernelCodeBytes(used, resolveMapper(board.id)), kernelCodeBytes(plain, resolveMapper(board.id)), board.name);
  }
});
