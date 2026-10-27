// The case family for the build-time-classes ROM-identity test (ROADMAP item 5 remainder, slice C0; design:
// handoff-next/classes-bc/design.md sec 2.2, 6, 7). Shared by test/unit/classidentity.test.js and, from C2 on, by the classed half and the
// prototype sabotages. Pure builders and pure oracles: nothing here is a test, so it can be imported from a copy of the tree that carries a
// deliberate wrong implementation and still judge it.
//
// The family: {plain, Save + naming, streamed + Save} x {MMC1, MMC3, UNROM 512} x four gate scenarios {main, class-only MAG, class-only MDEF,
// retained positive MAG/MDEF shadowed by zero class stats} = 36 cases. Every case is a `buildCase()` result: a base project plus a set of
// HAND-RESOLVED, UNCLASSED variants of it (only `profileId` / `spells` / `usableBy` set by hand to what a class would resolve to), and for
// each variant the independent expectation (`intent`) of what the generated tables must say. No `classes`, `classId` or `equip.classes`
// field exists in C0 -- no code reads them yet, and a test that is red on the tree it ships in is never committed.
//
// How C2 adds the classed (X) half WITHOUT rewriting this one. Each C0 variant has a classed twin that must build the identical ROM
// (VARIANT_TWINS below). C2 adds ONE function here, `classedTwin(c, key)`, returning the classed project for a variant key (a `classes`
// array on a structuredClone of c.projects.base, a `classId` per member, `equip.classes` per piece, the retained fields kept) and
// asserts `rom(twin).sha === rom(c.projects[key]).sha` in a new test of classidentity.test.js. The variants, their intents, the oracle
// reads and the checks below do not change: the classed twin is judged by the SAME `intent[key]`, because the twin and the hand-resolved
// variant must resolve to the same numbers. `ROLES` carries, per role, exactly the fields a class holds ({ name, profileId, spells }),
// so C2 builds `classes` from `c.roles` directly.
//
// The oracle reads (`readRom` + the `check*` functions) are callable on their own: `check*(c, key, built)` throws on a mismatch and needs
// no second ROM, so C2's sabotage tests run them against a built-with-a-wrong-implementation ROM and the ROM-to-ROM comparison is never
// what kills a sabotage (the prototype's TABLES_ONLY form).
//
// Independence of the oracles: `statOracle`, `learnedRow`, `expectedWho`, `expectedHdr6` and the gate rule are written here from the
// design and from shared/project.js's doc comments, never imported from shared/ or main/ (a test that read the code it checks would pass
// whatever the code did). Building and the symbol file are the only things taken from the tree under test.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { BANKED_CELLS } from './equipcells.js';
import { equipProject, SAMPLE_RPG } from './equipharness.js';

/** Every assertion this module makes goes through here, so a run can report how many it made. */
export const assertStats = { count: 0 };
const A = new Proxy(assert, { get: (target, prop) => (typeof target[prop] === 'function' ? (...args) => { assertStats.count++; return target[prop](...args); } : target[prop]) });

// ----------------------------------------------------------------------------------------------------------------- the axes

/** The three RPG-capable boards. `id` is the project's mapper id; `ines` is the iNES mapper number a person would write down (the spec's). */
export const CASE_BOARDS = [
  { id: 1, name: 'MMC1', ines: 1 },
  { id: 4, name: 'MMC3', ines: 4 },
  { id: 30, name: 'UNROM 512', ines: 30 }
];

const cellOf = (label) => {
  const cell = BANKED_CELLS.find((c) => c.label === label);
  if (!cell) throw new Error(`test/lib/equipcells.js has no cell "${label}"`);
  return cell;
};

/**
 * The three base projects. `battery` is whether the cartridge saves (iNES byte 6 bit 1) -- written by hand per base, not read off
 * projectUsesSave. `piecesOn(mapper)` is false where one equipment piece is refused for THAT project (a streamed + Save project on UNROM 512
 * is 20 bytes short of kernel-lo with one piece: `equipRefusedOn`, test/lib/equipcells.js), so that case runs without pieces.
 */
export const CASE_BASES = [
  { label: 'plain', battery: false, make: (mapper) => equipProject({ mapper, items: [] }), piecesOn: () => true },
  ...['Save + naming together', 'streamed world + Save'].map((label) => {
    const cell = cellOf(label);
    return { label, battery: Boolean(cell.save), make: (mapper) => cell.make({ mapper, items: [], save: cell.save }), piecesOn: (mapper) => !cell.equipRefusedOn?.includes(mapper) };
  })
];

/**
 * The four gate scenarios. `mag` / `mdef` are the {base, perLevel} the ROLE profiles grow (the only gate source: no actor and no piece adds
 * MAG or MDEF, asserted per case); `ret` is the retained [baseMag, magPerLevel, baseMdef, mdefPerLevel] on the two profiled members;
 * `expect` is the independently expected state of MAGIC_POWER_ENABLED / MAGIC_DEFENCE_ENABLED for the hand-resolved variant.
 */
export const GATE_SCENARIOS = [
  { name: 'main', mag: [0, 0], mdef: [0, 0], ret: [0, 0, 0, 0], expect: { mag: false, mdef: false } },
  { name: 'class-only-MAG', mag: [6, 2], mdef: [0, 0], ret: [0, 0, 0, 0], expect: { mag: true, mdef: false } },
  { name: 'class-only-MDEF', mag: [0, 0], mdef: [5, 3], ret: [0, 0, 0, 0], expect: { mag: false, mdef: true } },
  { name: 'retained-shadowed-by-zero-class', mag: [0, 0], mdef: [0, 0], ret: [50, 3, 40, 2], expect: { mag: false, mdef: false } }
];

/** The variant keys and the classed twin C2 adds for each (see the header). `remasked` exists only in a case with pieces. */
export const VARIANT_TWINS = {
  base: 'the project with no classes at all (also: classes authored, none referenced)',
  resolved: 'two members assigned a class, two classless, class-masked pieces',
  swapped: 'the same classes assigned the other way round',
  remasked: 'one piece with a different class mask',
  fallback: 'a class with no profile assigned to a member that retains profile 2',
  unassigned: 'classes authored but every classId null (retained numbers, spells and masks left in place)',
  unreferenced: 'classes and profiles authored, no member assigned and no piece masked'
};
export const VARIANT_KEYS = Object.keys(VARIANT_TWINS);

// ------------------------------------------------------------------------------------------------------ independent oracles

const STATS = ['hp', 'mp', 'atk', 'def', 'mag', 'mdef'];
/** A member's own growth fields, spelled out here (not memberGrowthFields). */
const OWN_FIELDS = { hp: ['baseHp', 'hpPerLevel'], mp: ['baseMp', 'mpPerLevel'], atk: ['baseAtk', 'atkPerLevel'], def: ['baseDef', 'defPerLevel'], mag: ['baseMag', 'magPerLevel'], mdef: ['baseMdef', 'mdefPerLevel'] };
export const ownGrowth = (member) => Object.fromEntries(STATS.map((s) => [s, { base: member[OWN_FIELDS[s][0]], perLevel: member[OWN_FIELDS[s][1]], shape: 'linear' }]));

const HORIZON = 14; // the fixed level-15 horizon (k = level - 1 runs 0..14)
/** A stat at `level` from one { base, perLevel, shape } record: linear, front-loaded `early`, back-loaded `late`; clamped to a byte. */
export function statOracle({ base, perLevel, shape }, level) {
  const k = Math.max(0, Math.min(HORIZON, level - 1));
  let v;
  if (shape === 'early') v = base + Math.floor((perLevel * k * (2 * HORIZON - k) + HORIZON / 2) / HORIZON);
  else if (shape === 'late') v = base + Math.floor((perLevel * k * k + HORIZON / 2) / HORIZON);
  else v = base + perLevel * (level - 1);
  return Math.min(255, Math.max(0, v));
}

/** One member's `maxLevel` spell-mask bytes: bit s of byte L-1 set when the spell in slot s is learned by level L (slots are project.spells order, first 8). */
export const learnedRow = (slotOf, entries, maxLevel) =>
  Array.from({ length: maxLevel }, (_, i) => entries.reduce((mask, e) => (slotOf.has(e.spellId) && i + 1 >= e.level ? mask | (1 << slotOf.get(e.spellId)) : mask), 0));

/** The bitmask of members `list` (indexes). */
export const maskOf = (list) => list.reduce((m, idx) => m | (1 << idx), 0);

/** iNES 1.0 header byte 6, from the spec (nesdev "INES"): bits 7-4 mapper low nibble, bit 3 four-screen, bit 1 battery/flash save, bit 0 vertical. */
export function expectedHdr6({ ines, mirroring, battery }) {
  const mirrorBit = mirroring === 'vertical' || mirroring === 'fourscreen' ? 1 : 0; // UNROM 512 four-screen is bits 3 AND 0 (cartridge.js documents the board)
  const fourScreen = mirroring === 'fourscreen' ? 8 : 0;
  return ((ines & 0x0f) << 4) | fourScreen | (battery ? 2 : 0) | mirrorBit;
}

/** A magic gate is on exactly when some member's EFFECTIVE growth of that stat is positive (base or per level); a profile nobody references moves nothing. */
export const expectedGates = (intent) => ({
  mag: intent.some((m) => m.growth.mag.base > 0 || m.growth.mag.perLevel > 0),
  mdef: intent.some((m) => m.growth.mdef.base > 0 || m.growth.mdef.perLevel > 0)
});

// ---------------------------------------------------------------------------------------------------------------- the case

const RETAINED = { baseHp: 99, hpPerLevel: 30, baseMp: 77, mpPerLevel: 9, baseAtk: 200, atkPerLevel: 15, baseDef: 90, defPerLevel: 9 }; // positive: must never show while a profile decides
const rec = (base, perLevel, shape = 'linear') => ({ base, perLevel, shape });
const profile = (id, name, s) => ({ id, name, ...s });

/**
 * A piece: slot index into EQUIP_SLOTS (0 weapon, 1 armour, 2 accessory), one stat. `wearers` is the intended wearer set of the
 * hand-resolved variant, as member indexes; `usableBy` is what the project stores for it.
 */
const makePiece = (name, slot, stat, amount, usableBy) => ({
  name,
  actorId: null,
  metaspriteId: null,
  effect: { kind: 'none', amount: 0 },
  equip: { slot, atk: 0, def: 0, mag: 0, mdef: 0, [stat]: amount, usableBy }
});

let sampleSpells;
const sampleRpgSpells = async () => (sampleSpells ??= (await loadProject(SAMPLE_RPG)).spells); // the streamed base ships none

/**
 * One case. Returns { tag, base, board, scenario, battery, pieces, maxLevel, spells, slotOf, profiles, roles, retainedSpells, pieceIds,
 * projects: { <variant key>: project }, intent: { <variant key>: [{ growth, spells } per member] }, wearers: { <variant key>: { <piece name>: [member idx] } } }.
 * Nothing is written to disk; every project is a structuredClone of the base, which is built fresh per case.
 */
export async function buildCase(base, board, scenario) {
  const root = await base.make(board.id);
  root.cartridge.mapper = board.id;
  if (root.spells.length < 3) root.spells = structuredClone(await sampleRpgSpells());
  const pieces = base.piecesOn(board.id);
  const tag = `${base.label}/${board.name}/${scenario.name}${pieces ? '' : '/no-pieces(refused here)'}`;
  const spells = root.spells.map((s) => s.id);
  const maxLevel = root.rpg.maxLevel;
  const slotOf = new Map(root.spells.slice(0, 8).map((s, i) => [s.id, i]));
  A.ok(root.party.length >= 4 && spells.length >= 3 && maxLevel >= 5, `${tag}: precondition: 4 members, 3 spells, maxLevel >= 5`);
  A.ok(!(root.sprites.actors ?? []).some((a) => (a.battle?.mag ?? 0) > 0 || (a.battle?.mdef ?? 0) > 0), `${tag}: precondition: no actor MAG/MDEF (gate control)`);
  A.ok(!root.items.some((i) => (i.equip?.mag ?? 0) > 0 || (i.equip?.mdef ?? 0) > 0), `${tag}: precondition: no piece adds MAG/MDEF (gate control)`);
  A.ok(root.party.every((m) => m.profileId == null), `${tag}: precondition: the base party has no profile`);
  A.equal((root.growthProfiles ?? []).length, 0, `${tag}: precondition: the base has no growth profiles`);

  const warrior = { hp: rec(30, 6, 'early'), mp: rec(0, 0), atk: rec(8, 2, 'late'), def: rec(5, 2), mag: rec(...scenario.mag), mdef: rec(...scenario.mdef) };
  const mage = { hp: rec(18, 3), mp: rec(10, 3, 'early'), atk: rec(0, 0), def: rec(2, 1, 'late'), mag: rec(...scenario.mag), mdef: rec(...scenario.mdef) };
  const decoy = { hp: rec(120, 9), mp: rec(40, 4), atk: rec(70, 5), def: rec(60, 5), mag: rec(0, 0), mdef: rec(0, 0) };
  const profiles = [profile(0, 'Warrior', warrior), profile(1, 'Mage', mage), profile(2, 'Decoy', decoy)];
  // What a class holds, per role: its profile and its spell list. Role 2 is authored and never assigned.
  const roles = [
    { name: 'Warrior', profileId: 0, spells: [{ spellId: spells[0], level: 2 }, { spellId: spells[2], level: 4 }] },
    { name: 'Mage', profileId: 1, spells: [{ spellId: spells[1], level: 1 }, { spellId: spells[0], level: 5 }] },
    { name: 'Spare', profileId: 2, spells: [{ spellId: spells[2], level: 3 }] }
  ];
  const retainedSpells = [[{ spellId: spells[1], level: 1 }], [{ spellId: spells[2], level: 2 }]]; // distinct, nonempty, ABSENT from the member's role
  A.ok(!roles[0].spells.some((e) => e.spellId === spells[1]) && !roles[1].spells.some((e) => e.spellId === spells[2]), `${tag}: precondition: retained spell absent from its role`);
  // The role profiles are genuinely non-linear, and differ from the retained numbers at the top level (a shadowed number would show).
  for (const stat of ['hp', 'atk']) {
    A.notEqual(statOracle(profiles[0][stat], 5), statOracle({ ...profiles[0][stat], shape: 'linear' }, 5), `${tag}: precondition: Warrior ${stat} is non-linear`);
  }
  A.notEqual(statOracle(profiles[0].hp, maxLevel), RETAINED.baseHp + RETAINED.hpPerLevel * (maxLevel - 1), `${tag}: precondition: retained hp is not the profile's`);

  // Every variant starts from the same base; pieces (when the board takes them) are appended with usableBy EVERYONE.
  const P0 = structuredClone(root);
  const pieceIds = [];
  const PIECES = [['Blade', 0, 'atk', 3], ['Guard', 1, 'def', 2], ['Rod', 2, 'atk', 1]];
  if (pieces) for (const [name, slot, stat, amount] of PIECES) { pieceIds.push(P0.items.length); P0.items.push({ ...makePiece(name, slot, stat, amount, 0b1111), id: P0.items.length }); }
  const setWho = (project, who) => pieceIds.forEach((id, i) => { project.items[id].equip.usableBy = maskOf(who[PIECES[i][0]]); });
  const ALL = [0, 1, 2, 3];

  const retain = (m, i) => Object.assign(m, RETAINED, { baseMag: scenario.ret[0], magPerLevel: scenario.ret[1], baseMdef: scenario.ret[2], mdefPerLevel: scenario.ret[3], spells: structuredClone(retainedSpells[i]) });
  const resolve = (project, assign) => { // members 0 and 1 resolved to roles `assign`: profile and spell list set by hand, retained numbers left in place
    project.growthProfiles = structuredClone(profiles);
    project.party.slice(0, 2).forEach((m, i) => { retain(m, i); m.profileId = roles[assign[i]].profileId; m.spells = structuredClone(roles[assign[i]].spells); });
  };

  const projects = { base: structuredClone(P0) };
  const wearers = { base: Object.fromEntries(PIECES.map(([n]) => [n, ALL])) };
  const wearersResolved = { Blade: [0, 2], Guard: ALL, Rod: [1, 2, 3] };          // Blade: role 0 only (and a classless wearer); Rod: role 1 only
  const wearersSwapped = { Blade: [1, 2], Guard: ALL, Rod: [0, 2, 3] };
  const wearersRemasked = { Blade: [1, 2], Guard: ALL, Rod: [1, 2, 3] };          // Blade narrowed to role 1
  const wearersUnassigned = { Blade: [0, 1, 2], Guard: ALL, Rod: ALL };           // the retained usableBy alone: no class mask applies to a classless member

  projects.resolved = structuredClone(P0); resolve(projects.resolved, [0, 1]); if (pieces) setWho(projects.resolved, wearersResolved);
  wearers.resolved = wearersResolved;
  projects.swapped = structuredClone(P0); resolve(projects.swapped, [1, 0]); if (pieces) setWho(projects.swapped, wearersSwapped);
  wearers.swapped = wearersSwapped;
  if (pieces) { projects.remasked = structuredClone(projects.resolved); setWho(projects.remasked, wearersRemasked); wearers.remasked = wearersRemasked; }
  projects.fallback = structuredClone(projects.resolved); projects.fallback.party[0].profileId = 2;   // a profile-less role: the member's retained profile 2 decides
  wearers.fallback = wearersResolved;
  projects.unassigned = structuredClone(P0); projects.unassigned.growthProfiles = structuredClone(profiles);
  projects.unassigned.party.slice(0, 2).forEach((m, i) => retain(m, i)); projects.unassigned.party[0].profileId = 2; if (pieces) setWho(projects.unassigned, wearersUnassigned);
  wearers.unassigned = wearersUnassigned;
  projects.unreferenced = structuredClone(P0); projects.unreferenced.growthProfiles = structuredClone(profiles);   // authored, referenced by no one
  wearers.unreferenced = wearers.base;

  // The hand-written expectation per member: the growth records and the spell list the generated tables must show.
  const own = (project, m) => ({ growth: ownGrowth(project.party[m]), spells: project.party[m].spells ?? [] });
  const viaRole = (project, assign) => project.party.map((_, m) => (m < 2 ? { growth: structuredClone(profiles[roles[assign[m]].profileId]), spells: roles[assign[m]].spells } : own(project, m)));
  const intent = {
    base: projects.base.party.map((_, m) => own(projects.base, m)),
    resolved: viaRole(projects.resolved, [0, 1]),
    swapped: viaRole(projects.swapped, [1, 0]),
    fallback: projects.fallback.party.map((_, m) => (m === 0 ? { growth: structuredClone(profiles[2]), spells: roles[0].spells } : m === 1 ? { growth: structuredClone(profiles[1]), spells: roles[1].spells } : own(projects.fallback, m))),
    unassigned: projects.unassigned.party.map((_, m) => (m === 0 ? { growth: structuredClone(profiles[2]), spells: retainedSpells[0] } : own(projects.unassigned, m))),
    unreferenced: projects.unreferenced.party.map((_, m) => own(projects.unreferenced, m))
  };
  if (pieces) intent.remasked = viaRole(projects.remasked, [0, 1]);

  // Gate control, checked on the hand-written expectation rather than assumed: the scenario really discriminates a raw-field gate.
  A.deepEqual(expectedGates(intent.resolved), scenario.expect, `${tag}: the resolved variant's expected gates are the scenario's`);
  const rawGates = expectedGates(projects.resolved.party.map((m) => ({ growth: ownGrowth(m) })));
  if (scenario.name !== 'main') A.ok(rawGates.mag !== scenario.expect.mag || rawGates.mdef !== scenario.expect.mdef, `${tag}: the scenario discriminates a raw-field gate`);

  return { tag, base, board, scenario, battery: base.battery, pieces, maxLevel, spells, slotOf, profiles, roles, retainedSpells, pieceIds, pieceNames: PIECES.map(([n]) => n), projects, intent, wearers };
}

/** Every (base, board, scenario) triple, in the order the family is built: 3 bases x 3 boards x 4 scenarios. */
export const caseSpecs = () => CASE_BASES.flatMap((base) => CASE_BOARDS.flatMap((board) => GATE_SCENARIOS.map((scenario) => ({ base, board, scenario }))));
export const variantKeysOf = (c) => VARIANT_KEYS.filter((k) => c.projects[k]);

// ------------------------------------------------------------------------------------------- building a ROM and reading it back

/** The generated tables the oracles read, and the gate flags; a table is `null` when the build did not emit it. */
export const ORACLE_TABLES = ['pc_hp_at', 'pc_mp_at', 'pc_atk_at', 'pc_def_at', 'pc_mag_at', 'pc_mdef_at', 'pc_spells_at', 'eq_who'];
export const ORACLE_FLAGS = ['MAGIC_POWER_ENABLED', 'MAGIC_DEFENCE_ENABLED'];

/**
 * Build `project` in its own mkdtemp directory (removed before returning; a fixture is never written to) and read it back:
 * { tag, size, sha, hdr6, mirroring, tables: { label: bytes | null }, symbols: { label: boolean }, flags: { NAME: 0 | 1 } }.
 * Tables and flags come from the generated build/assets/*.inc (what the assembler saw); `symbols` says whether the same label made it
 * into the ROM's own symbol file, so a table that was written but not assembled cannot satisfy an oracle.
 */
export async function readRom(project, tag) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-classes-id-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const rom = await fs.readFile(built.romPath);
    const symbols = parseSymbolFile(await fs.readFile(built.symbolPath, 'utf8'));
    const assetDir = path.join(dir, 'build', 'assets');
    const texts = [];
    for (const f of await fs.readdir(assetDir)) if (f.endsWith('.inc')) texts.push(await fs.readFile(path.join(assetDir, f), 'utf8'));
    const all = texts.join('\n');
    const tableOf = (label) => {
      const i = all.indexOf(`\n${label}:`);
      if (i < 0) return null;
      const rest = all.slice(i + label.length + 2);
      const end = rest.search(/\n[A-Za-z_]\w*:/);
      return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/\$([0-9A-Fa-f]{2})/g)].map((m) => parseInt(m[1], 16));
    };
    const flags = {};
    for (const name of ORACLE_FLAGS) {
      const m = all.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'));
      A.ok(m, `${tag}: ${name} is in config.inc`);
      flags[name] = Number(m[1]);
    }
    return {
      tag,
      size: rom.length,
      sha: crypto.createHash('sha256').update(rom).digest('hex'),
      hdr6: rom[6],
      mirroring: project.cartridge.mirroring,
      tables: Object.fromEntries(ORACLE_TABLES.map((label) => [label, tableOf(label)])),
      symbols: Object.fromEntries(ORACLE_TABLES.map((label) => [label, symbols[label] !== undefined])),
      flags
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------------------ the oracle checks
// Each: (c, key, built) -> undefined, throwing an AssertionError that names the case, the variant and the first wrong byte.

const where = (c, key, what) => `${c.tag} [${key}]: ${what}`;

/** Header byte 6 equals the spec-derived value. */
export function checkHeader(c, key, built) {
  A.ok(built.size > 0x10, where(c, key, 'the ROM has a header'));
  const want = expectedHdr6({ ines: c.board.ines, mirroring: built.mirroring, battery: c.battery });
  A.equal(built.hdr6, want, where(c, key, `header byte 6 is ${built.hdr6}, the iNES spec gives ${want}`));
}

/** pc_hp/mp/atk/def_at (and pc_mag/mdef_at when their gate is on) hold, per member and level, exactly the intended growth. */
export function checkGrowth(c, key, built) {
  const intent = c.intent[key];
  const L = c.maxLevel;
  const gates = expectedGates(intent.map((m) => ({ growth: m.growth })));
  for (const stat of STATS) {
    const label = `pc_${stat}_at`;
    const table = built.tables[label];
    const emitted = stat === 'mag' ? gates.mag : stat === 'mdef' ? gates.mdef : true;
    if (!emitted) {
      A.equal(table, null, where(c, key, `${label} is not emitted (no member grows ${stat})`));
      continue;
    }
    A.ok(table, where(c, key, `${label} is emitted`));
    A.equal(built.symbols[label], true, where(c, key, `${label} is a symbol of the ROM`));
    A.equal(table.length, intent.length * L, where(c, key, `${label} has ${intent.length} members x ${L} levels`));
    intent.forEach((member, m) => {
      for (let level = 1; level <= L; level++) {
        const want = statOracle(member.growth[stat], level);
        A.equal(table[m * L + level - 1], want, where(c, key, `${label} member ${m} level ${level} is ${table[m * L + level - 1]}, the intended growth gives ${want}`));
      }
    });
  }
}

/** pc_spells_at holds, per member, exactly the intended learned-by-level masks; a retained spell the role does not list never shows. */
export function checkSpells(c, key, built) {
  const L = c.maxLevel;
  const table = built.tables.pc_spells_at;
  A.ok(table, where(c, key, 'pc_spells_at is emitted'));
  A.equal(built.symbols.pc_spells_at, true, where(c, key, 'pc_spells_at is a symbol of the ROM'));
  A.equal(table.length, c.intent[key].length * L, where(c, key, 'pc_spells_at has one byte per member per level'));
  c.intent[key].forEach((member, m) => {
    const want = learnedRow(c.slotOf, member.spells, L);
    A.deepEqual(table.slice(m * L, (m + 1) * L), want, where(c, key, `pc_spells_at member ${m} is ${table.slice(m * L, (m + 1) * L)}, the intended list gives ${want}`));
  });
  if (['resolved', 'remasked', 'fallback'].includes(key)) { // the role replaces the member's list: the retained spell is absent at every level (not 'swapped': there member 0's retained spell is role 1's own)
    [0, 1].forEach((m) => {
      const bit = 1 << c.slotOf.get(c.retainedSpells[m][0].spellId);
      for (let level = 1; level <= L; level++) A.equal(table[m * L + level - 1] & bit, 0, where(c, key, `member ${m}'s retained spell shows at level ${level}`));
    });
  }
}

/** eq_who holds, per item id, the mask of intended wearers (0 for an item that is not a piece); with no piece the table is not emitted. */
export function checkWho(c, key, built) {
  const who = built.tables.eq_who;
  if (!c.pieces) {
    A.equal(who, null, where(c, key, 'eq_who is not emitted (no piece in this project)'));
    return;
  }
  A.ok(who, where(c, key, 'eq_who is emitted'));
  A.equal(built.symbols.eq_who, true, where(c, key, 'eq_who is a symbol of the ROM'));
  const project = c.projects[key];
  A.equal(who.length, project.items.length, where(c, key, 'eq_who has one byte per item id'));
  const want = project.items.map((_, id) => {
    const i = c.pieceIds.indexOf(id);
    return i < 0 ? 0 : maskOf(c.wearers[key][c.pieceNames[i]]);
  });
  want.forEach((mask, id) => A.equal(who[id], mask, where(c, key, `eq_who[item ${id}] is %${who[id].toString(2)}, the intended wearers give %${mask.toString(2)}`)));
}

/** MAGIC_POWER_ENABLED / MAGIC_DEFENCE_ENABLED follow the intended growth by reference, and pc_mag_at / pc_mdef_at are emitted exactly when their gate is on. */
export function checkGates(c, key, built) {
  const want = expectedGates(c.intent[key].map((m) => ({ growth: m.growth })));
  A.equal(built.flags.MAGIC_POWER_ENABLED, Number(want.mag), where(c, key, `MAGIC_POWER_ENABLED is ${built.flags.MAGIC_POWER_ENABLED}, expected ${Number(want.mag)}`));
  A.equal(built.flags.MAGIC_DEFENCE_ENABLED, Number(want.mdef), where(c, key, `MAGIC_DEFENCE_ENABLED is ${built.flags.MAGIC_DEFENCE_ENABLED}, expected ${Number(want.mdef)}`));
  A.equal(built.tables.pc_mag_at !== null, want.mag, where(c, key, 'pc_mag_at is emitted iff the MAG gate is on'));
  A.equal(built.tables.pc_mdef_at !== null, want.mdef, where(c, key, 'pc_mdef_at is emitted iff the MDEF gate is on'));
  if (key === 'resolved') A.deepEqual(want, c.scenario.expect, where(c, key, "the resolved variant's gates are the scenario's"));
}

/** All five oracle reads on one built variant -- what a sabotage test runs on its own. */
export function checkOracles(c, key, built) {
  checkHeader(c, key, built);
  checkGrowth(c, key, built);
  checkSpells(c, key, built);
  checkWho(c, key, built);
  checkGates(c, key, built);
}
