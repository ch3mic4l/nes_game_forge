// Build-time classes, slice C0 (ROADMAP item 5 remainder; handoff-next/classes-bc/design.md sec 2.2, 6, 7): the harness and the half of the
// ROM-identity matrix that holds on TODAY's tree. 36 cases (test/lib/classcases.js) -- {plain, Save + naming, streamed + Save} x {MMC1, MMC3,
// UNROM 512} x four gate scenarios -- each built as a set of HAND-RESOLVED, UNCLASSED projects (only profileId / spells / usableBy set by hand
// to what a class will resolve to). Independent oracles read the generated pc_hp/mp/atk/def/mag/mdef_at, pc_spells_at, eq_who and
// config.inc's MAGIC_*_ENABLED against an expectation written in the harness, and header byte 6 against a value derived from the iNES
// spec. C2 adds the classed twin of each variant and its ROM-equality tests beside these; it changes nothing here (see the header of
// test/lib/classcases.js).
//
// Why one named test per oracle group: a sabotage (a wrong generator) must die in a test whose name says what it broke, and from C2 each of
// the nine prototype sabotages must die on the oracle reads ALONE, with every ROM-to-ROM comparison removed. The groups call the same
// check* functions a sabotage test calls, and a ROM is built once per (case, variant) and shared by all of them.
//
// Fail-fast and never skipped: a missing nesasm or a build error is a red test, not a skip. Every build runs in its own mkdtemp directory
// and no fixture is read for anything but its spells. Growth C0 pins (FIXTURE_PINS / VARIANT_PINS / STREAMED_SAVE_PIN,
// test/unit/growthgenerator.test.js) stay where they are, literal and untouched; this file adds none and reads none.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_BASES,
  CASE_BOARDS,
  GATE_SCENARIOS,
  VARIANT_KEYS,
  assertStats,
  buildCase,
  caseSpecs,
  checkGates,
  checkGrowth,
  checkHeader,
  checkOracles,
  checkSpells,
  checkWho,
  expectedHdr6,
  readRom,
  variantKeysOf
} from '../lib/classcases.js';

// One build per (case, variant): every test below shares it. Only the small parsed read is kept, never the ROM or the project.
const reads = new Map();
const romOf = (c, key) => {
  const id = `${c.tag}|${key}`;
  if (!reads.has(id)) reads.set(id, readRom(c.projects[key], `${c.tag} [${key}]`));
  return reads.get(id);
};

/** Run `fn(case)` over all 36 cases, fail-fast. A case is rebuilt per test (cheap, and keeps 36 x 7 project clones out of memory). */
async function eachCase(fn) {
  for (const spec of caseSpecs()) await fn(await buildCase(spec.base, spec.board, spec.scenario));
}
/** Run `check(case, key, built)` on every built variant of every case. */
const everyRom = (check) => eachCase(async (c) => { for (const key of variantKeysOf(c)) check(c, key, await romOf(c, key)); });

test('the case family is 3 bases x 3 boards x 4 gate scenarios, each with its hand-resolved variants', async () => {
  // Catches a family that quietly lost an axis (a board, a base or a scenario dropped), a variant that is missing where its pieces are allowed,
  // and a piece wrongly refused (or wrongly kept) on UNROM 512 streamed + Save.
  const specs = caseSpecs();
  assert.equal(CASE_BASES.length, 3);
  assert.deepEqual(CASE_BOARDS.map((b) => [b.id, b.ines]), [[1, 1], [4, 4], [30, 30]]);
  assert.deepEqual(GATE_SCENARIOS.map((s) => s.name), ['main', 'class-only-MAG', 'class-only-MDEF', 'retained-shadowed-by-zero-class']);
  assert.equal(specs.length, 36);
  const tags = new Set();
  let noPieces = 0;
  await eachCase(async (c) => {
    assert.ok(!tags.has(c.tag), `${c.tag} is unique`);
    tags.add(c.tag);
    const wanted = c.pieces ? VARIANT_KEYS : VARIANT_KEYS.filter((k) => k !== 'remasked');
    assert.deepEqual(variantKeysOf(c), wanted, `${c.tag}: variants`);
    assert.equal(c.pieces, !(c.base.label === 'streamed world + Save' && c.board.id === 30), `${c.tag}: pieces are refused exactly on UNROM 512 streamed + Save`);
    if (!c.pieces) noPieces++;
    for (const key of variantKeysOf(c)) assert.equal(c.projects[key].cartridge.mapper, c.board.id, `${c.tag} [${key}]: board`);
  });
  assert.equal(noPieces, 4, 'only the four UNROM 512 streamed + Save cases run without pieces');
});

test('header byte 6 of every built case ROM is the value the iNES spec gives, not the one the cartridge table gives', async () => {
  // Catches a mapper-number nibble, the Save/battery bit, the four-screen bit or the mirroring bit wrong in the built header. The expectation
  // is derived from the spec in test/lib/classcases.js (expectedHdr6): a test that asked shared/cartridge.js what to expect would agree with
  // a broken headerPatch / mapper entry and pass.
  await everyRom(checkHeader);
  // Negative control: the oracle itself rejects each way of being wrong, so the tests above cannot pass vacuously.
  assert.equal(expectedHdr6({ ines: 30, mirroring: 'fourscreen', battery: true }), 0xeb, 'UNROM 512, four-screen, flash save');
  assert.equal(expectedHdr6({ ines: 1, mirroring: 'vertical', battery: true }), 0x13, 'MMC1, vertical, battery');
  assert.equal(expectedHdr6({ ines: 4, mirroring: 'horizontal', battery: false }), 0x40, 'MMC3, horizontal, no battery');
});

test('pc_hp/mp/atk/def_at (and pc_mag/mdef_at when their gate is on) follow the resolved profile at every level, retained numbers never showing', async () => {
  // Catches a generator that reads a profiled member's raw baseX / xPerLevel (the retained numbers are large and positive), flattens a
  // non-linear curve, lets a profile of the wrong member win, or falls back to raw numbers for a member that retains a profile.
  await everyRom(checkGrowth);
});

test('pc_spells_at holds each member\'s intended learned-by-level masks; a retained spell the role does not list never shows', async () => {
  // Catches a spell dropped or added at one level, a union of a role's list with the member's retained list, and a role's list ignored.
  await everyRom(checkSpells);
});

test('eq_who holds exactly the intended wearers of each piece, and is not emitted when the project has no piece', async () => {
  // Catches an eq_who row that ignores usableBy (everyone eligible), a restricted classless member, a mask applied to the wrong piece, and a
  // table emitted for a project the kernel refuses a piece in.
  await everyRom(checkWho);
});

test('MAGIC_POWER_ENABLED / MAGIC_DEFENCE_ENABLED follow the effective growth by reference, and pc_mag_at / pc_mdef_at are emitted exactly when on', async () => {
  // Catches a gate forced on with no source, a gate read from a member's raw fields (a profile-only mage builds with MAG silently off, a
  // shadowed retained MAG turns it on), and an authored-but-unreferenced profile that opens a gate.
  await everyRom(checkGates);
});

test('the oracle reads are callable on their own: each rejects a corrupted read of a good ROM (they can fail)', async () => {
  // Catches an oracle that cannot fail. C2's sabotage tests run exactly these checks on the ROM of a wrong implementation; here the wrong
  // implementation is simulated on the read itself, one field at a time, on a case with every feature (pieces, both gates).
  const spec = caseSpecs().find((s) => s.base.label === 'Save + naming together' && s.board.id === 4 && s.scenario.name === 'class-only-MAG');
  const c = await buildCase(spec.base, spec.board, spec.scenario);
  const good = await romOf(c, 'resolved');
  checkOracles(c, 'resolved', good);
  const L = c.maxLevel;
  const bent = (patch) => { const copy = structuredClone(good); patch(copy); return copy; };
  const rejects = [
    ['header: save bit lost', checkHeader, (b) => { b.hdr6 &= ~2; }],
    ['header: wrong mapper nibble', checkHeader, (b) => { b.hdr6 ^= 0x10; }],
    ['growth: one hp byte off by one', checkGrowth, (b) => { b.tables.pc_hp_at[L + 2] += 1; }],
    ['growth: the MAG table missing', checkGrowth, (b) => { b.tables.pc_mag_at = null; }],
    ['spells: one spell dropped at one level', checkSpells, (b) => { b.tables.pc_spells_at[L - 1] &= ~1; }],
    ['spells: a retained spell added at one level', checkSpells, (b) => { b.tables.pc_spells_at[1] |= 1 << c.slotOf.get(c.retainedSpells[0][0].spellId); }],
    ['eq_who: everyone eligible', checkWho, (b) => { b.tables.eq_who[c.pieceIds[0]] = 0b1111; }],
    ['eq_who: a non-piece item marked wearable', checkWho, (b) => { b.tables.eq_who[0] = 1; }],
    ['gates: MDEF forced on', checkGates, (b) => { b.flags.MAGIC_DEFENCE_ENABLED = 1; }],
    ['gates: MAG off', checkGates, (b) => { b.flags.MAGIC_POWER_ENABLED = 0; }]
  ];
  for (const [what, check, patch] of rejects) assert.throws(() => check(c, 'resolved', bent(patch)), assert.AssertionError, what);
});

test('hand-resolved variants relate as the design says: unreferenced profiles move no byte, every data axis is visible, no variant changes the ROM size', async () => {
  // Catches (a) an authored-but-unreferenced growth profile that moves a byte or a gate, (b) a generator blind to a data axis -- swapped
  // profiles, a changed piece mask, a member's retained profile, retained data of an unassigned member -- which would make C2's classed-equals-
  // hand-resolved comparison vacuous, and (c) a change that grows the ROM for the same data (the zero-engine-change claim).
  const names = (c) => (c.pieces ? 'with pieces' : 'no pieces');
  await eachCase(async (c) => {
    const rom = async (key) => romOf(c, key);
    const base = await rom('base');
    const resolved = await rom('resolved');
    const unreferenced = await rom('unreferenced');
    assert.equal(unreferenced.sha, base.sha, `${c.tag}: unreferenced profiles build the identical ROM (${names(c)})`);
    assert.notEqual(resolved.sha, base.sha, `${c.tag}: resolved differs from the project with no profile`);
    assert.notEqual((await rom('swapped')).sha, resolved.sha, `${c.tag}: swapped roles differ`);
    assert.notEqual((await rom('fallback')).sha, resolved.sha, `${c.tag}: a member's retained profile differs from the role's profile`);
    const unassigned = await rom('unassigned');
    assert.notEqual(unassigned.sha, base.sha, `${c.tag}: retained data of an unassigned member differs from the project with none`);
    assert.notEqual(unassigned.sha, resolved.sha, `${c.tag}: unassigned differs from resolved`);
    if (c.pieces) assert.notEqual((await rom('remasked')).sha, resolved.sha, `${c.tag}: a changed piece mask differs`);
    for (const key of variantKeysOf(c)) assert.equal((await rom(key)).size, base.size, `${c.tag} [${key}]: same ROM size as the base`);
  });
});

test('summary: builds and assertions in the case family', async (t) => {
  // Not a check: prints the counts the C0 report quotes. Runs last, after every group above has filled the build cache.
  t.diagnostic(`classidentity: 36 cases, ${reads.size} ROM builds (each shared by every group), ${assertStats.count} assertions in the case-family library`);
});
