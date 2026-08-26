// The banked code region's capacity check — the sibling of kernelbytes.test.js,
// for the other bounded bank.
//
// An RPG's battle system lives in one 8 KB region of the switchable window
// (codeRegions(), shared/cartridge.js): engine/battle.asm — which pulls in
// battleui.asm and battleturn.asm — plus the tables main/build/battletables.js
// generates into assets/battle.inc beside it. Until this landed, nothing
// bounded that region: overflowing it surfaced as nesasm's own raw output,
// which is the failure mode this codebase otherwise refuses to ship.
//
// BASE_BATTLE_CODE_BYTES_BY_MAPPER is a hand-measured figure per board, and a
// hand-measured figure goes stale silently. This file re-measures it from a
// real build on every run, on every board that can reach the region at all.
//
// Two rules carry over from kernelbytes.test.js, and they are the point:
//
//  - Assert for EQUALITY, not `<=`. That file's own comment records what a
//    margin-only check costs: MMC1 sat at MMC3's larger SAVE allowance and
//    still passed, hiding five bytes of stale slack, because "covers enough"
//    cannot tell a correct figure from a generous one. Equality is available
//    here in a stronger form than it was there — see the next paragraph.
//  - Assert the semantic invariant, not the literal byte count of the day.
//    The fixture build asserts it assembles with at least BATTLE_SLACK free
//    and prints the real figure on failure, so a harmless change elsewhere in
//    the region does not fail the test and invite loosening it.
//
// The equality this file asserts is stronger than kernelbytes.test.js's own
// margin band, and deliberately so, because the underlying model is different.
// kernelCodeBytes must over-estimate: kernel-lo holds engine code the JS side
// cannot size alongside lookup tables it models by hand. This region has
// exactly two occupants, and battleTableBytes counts the second off
// battleTables' real emitted output rather than modelling it — so
// `base + battleTableBytes` is expected to equal nesasm's reported usage to
// the byte, and anything else is a bug in one of them rather than slack.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import {
  checkCapacity,
  kernelCodeBytes,
  kernelTableBytes,
  switchableMappers
} from '../../main/build/generate.js';
import {
  BASE_BATTLE_CODE_BYTES_BY_MAPPER,
  BATTLE_REGION_SOURCES,
  BATTLE_SLACK,
  battleCodeOverridden,
  battleRegionPlacementOverridden,
  battleRegionRelocates,
  baseBattleCodeBytes,
  battleRegionBytes,
  battleRegionCeiling,
  battleShortfallAdvice,
  battleTableBytes,
  battleTables,
  emittedBytes
} from '../../main/build/battletables.js';
import {
  SUPPORTED_MAPPERS,
  rpgCapable,
  codeRegions,
  resolveMapper,
  tilesetLimit,
  NESASM_BANK_BYTES
} from '../../shared/cartridge.js';
import { reconcileCartridge, validateProject } from '../../shared/project.js';
import { FONT_BASE, SPRITE_ARROW_TILE, fontChrPages } from '../../shared/font.js';
import { BLANK_TILE } from '../../shared/chr.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
// Builds its own ROMs from scratch, so it gates on nesasm itself rather than on
// a checked-in sample-rpg/build/game.nes — the same reasoning
// kernelbytes.test.js gives: gating on the fixture ROM is what lets a clean
// checkout silently skip the test built to catch this regression.
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// codeRegions() hands back nothing unless the project is an RPG, and an RPG
// needs rpgCapable() — so this is the complete list of boards that can reach
// the region, and therefore the complete list BASE_BATTLE_CODE_BYTES_BY_MAPPER
// can ever hold a measured entry for. Unlike the kernel table there is no
// fallback-for-unmeasured-boards case to design; the test below makes that a
// checked fact rather than an assumption.
const CAPABLE_MAPPERS = SUPPORTED_MAPPERS.filter(rpgCapable);

/**
 * Builds `sample-rpg` on `mapper`, optionally mutated, into a temp directory,
 * and returns nesasm's own reported usage for the region alongside what the
 * byte math predicts for the same project.
 *
 * The parsing technique is kernelbytes.test.js's: nesasm's segment-usage table
 * carries one row per bank, "BANK  62   7182/1010", right-aligned so the free
 * half can carry a leading space the used half never does ("7235/ 957").
 *
 * Never touches sample-rpg itself — every variant is written to its own
 * mkdtemp directory, because the five fixtures are checked in and two suites
 * have already fought over one of them.
 */
async function measureRegion(t, mapper, mutate = () => {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-bankedbytes-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = mapper.id;
  mutate(project);
  await saveProject(dir, project);
  const lines = [];
  await buildProject({ dir, project, log: (line) => lines.push(line) });

  const slot = codeRegions(mapper, project.tilesets.length, 1)[0];
  assert.ok(slot, `${mapper.name}: codeRegions() reserved no region for an RPG`);
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${slot.nesasmBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${slot.nesasmBank}`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  assert.ok(
    Number.isFinite(used) && used > 0,
    `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`
  );
  return { project, used, predicted: battleRegionBytes(project, mapper), dir };
}

// The fail-safe half of baseBattleCodeBytes's own lookup. An unmeasured board
// would make the whole budget NaN, every comparison against NaN is false, and
// the refusal in checkCapacity would silently stop firing for it — a capacity
// check that always passes being worse than one that fails loudly. The
// fallback stops the NaN; this stops the fallback from ever being what a real
// board is judged by, which is the thing that would actually hide a
// regression.
test('every RPG-capable board has its own measured BASE_BATTLE_CODE_BYTES_BY_MAPPER entry', () => {
  assert.ok(CAPABLE_MAPPERS.length > 0, 'no RPG-capable mapper is registered — rpgCapable() found nothing');
  for (const mapper of CAPABLE_MAPPERS) {
    assert.ok(
      Number.isFinite(BASE_BATTLE_CODE_BYTES_BY_MAPPER[mapper.id]),
      `${mapper.name}: rpgCapable() is true but BASE_BATTLE_CODE_BYTES_BY_MAPPER[${mapper.id}] is ` +
        `${BASE_BATTLE_CODE_BYTES_BY_MAPPER[mapper.id]} — this board can reach the banked code region with ` +
        'no measured allowance for it. Measure one (build sample-rpg on it and subtract battleTableBytes ' +
        'from nesasm’s own usage for the region) before shipping this board.'
    );
    assert.equal(
      baseBattleCodeBytes(mapper),
      BASE_BATTLE_CODE_BYTES_BY_MAPPER[mapper.id],
      `${mapper.name}: baseBattleCodeBytes should read straight out of the per-mapper table, never the fallback`
    );
  }
});

// battleTableBytes counts .db operands off battleTables' own output, and is
// complete only while .db is the sole storage directive that output contains.
// That is a property of the emit, not of the counter -- so the counter throws
// rather than skipping, and this drives an unrecognised directive through it
// directly to prove it does.
//
// Directly, because that is the whole difficulty. battleTables emits only .db
// today, so no project can reach the throw, and an earlier version of this test
// -- which only walked battleTables' current output and asserted every line was
// a .db -- passed unchanged with the throw replaced by a `continue`. It proved
// today's emitter is uniform; it proved nothing about the counter. Both halves
// are here now: what the emitter does, and what the counter does about anything
// else.
test('battleTableBytes refuses a directive it cannot size instead of skipping it', async () => {
  // Half one: the counter itself, on sources no emitter produces today.
  assert.equal(emittedBytes('  .db $01,$02,$03'), 3, 'one byte per .db operand');
  assert.equal(emittedBytes('label:\n  .db $01\n; a comment\nEQUATE = 4\n'), 1, 'labels, comments and equates store nothing');
  assert.equal(emittedBytes('label:  .db $01,$02'), 2, 'a label sharing its line does not eat the directive');
  for (const directive of ['  .dw $1234', '  .ds 16', '  .org $8000', '  .incbin "x.chr"', '  lda #$00']) {
    assert.throws(
      () => emittedBytes(`  .db $01\n${directive}\n`),
      /cannot size/,
      `emittedBytes must refuse "${directive.trim()}" rather than skip it — silently ignoring what it ` +
        'cannot size is how the region’s capacity check comes to undercount'
    );
  }
  assert.throws(() => emittedBytes('  .db\n'), /no operands/, 'a .db with nothing after it is a bug, not zero bytes');

  // Half two: today's emitter really is uniform, so the count above is
  // complete for it. If this ever fails, the fix is to teach emittedBytes the
  // new directive — not to loosen it.
  const project = await loadProject(SAMPLE_RPG);
  const real = battleTableBytes(project);
  assert.ok(real > 0, 'sample-rpg should generate some table bytes');
  for (const line of battleTables(project).split('\n')) {
    const text = line.replace(/;.*$/, '').trim();
    if (!text) continue;
    const bare = text.replace(/^[A-Za-z_][A-Za-z0-9_]*:\s*/, '');
    if (!bare || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(bare)) continue;
    assert.match(
      bare,
      /^\.db\b/,
      `battleTables emitted "${bare}", which battleTableBytes has no size for. Teach emittedBytes about ` +
        'it (main/build/battletables.js) — otherwise the region’s capacity check silently undercounts.'
    );
  }
});

test('every RPG-capable board’s measured base equals nesasm’s own usage minus the table bytes', {
  skip: !hasNesasm && 'nesasm not found on PATH'
}, async (t) => {
  // Variants chosen to move every dimension the tables are a function of:
  // actor count, spell count, party size and maxLevel (which scales the four
  // per-level stat tables, the spells-known mask and the XP curve at once).
  // The stock allowance is what is left after the tables, so it can only be
  // trusted as a constant if it survives the tables changing size underneath
  // it. One build per variant per board, all in mkdtemp directories.
  const variants = [
    ['stock', () => {}],
    ['+6 actors', (p) => {
      const list = p.sprites.actors;
      const last = list[list.length - 1];
      for (let i = 0; i < 6; i++) list.push({ ...structuredClone(last), id: list.length, name: `EXTRA${i}` });
    }],
    ['+3 spells', (p) => {
      const list = p.spells;
      const last = list[list.length - 1];
      for (let i = 0; i < 3; i++) list.push({ ...structuredClone(last), id: list.length, name: `SPL${i}` });
    }],
    ['maxLevel 5', (p) => { p.rpg.maxLevel = 5; }],
    ['+1 party member', (p) => {
      p.party.push({ ...structuredClone(p.party[0]), id: p.party.length, name: 'DUDE', startsInParty: false });
    }]
  ];

  for (const mapper of CAPABLE_MAPPERS) {
    for (const [label, mutate] of variants) {
      const { project, used, predicted } = await measureRegion(t, mapper, mutate);
      const tables = battleTableBytes(project);
      // Equality, not <=. The model has no estimation error to absorb: the
      // region holds stock code plus tables, and the tables are counted off
      // the single writer's real output rather than modelled. A <= check here
      // would let the base drift upward silently, exactly the way MMC1's SAVE
      // allowance sat at MMC3's larger figure under kernelbytes.test.js's own
      // margin band. The real figures are in the message so a legitimate
      // change to battle.asm fails this with a re-measurement rather than an
      // investigation.
      assert.equal(
        used,
        predicted,
        `${mapper.name} (${label}): nesasm used ${used} bytes of the banked code region but the byte math ` +
          `predicts ${predicted} (base ${baseBattleCodeBytes(mapper)} + ${tables} table bytes). ` +
          `If engine/battle.asm, battleui.asm or battleturn.asm changed on purpose, re-measure: the new base ` +
          `for this board is ${used - tables}. If they did not, battleTableBytes has lost count of what ` +
          'battleTables emits.'
      );
    }
  }
});

test('the fixture assembles into its region with at least BATTLE_SLACK to spare', {
  skip: !hasNesasm && 'nesasm not found on PATH'
}, async (t) => {
  // The semantic invariant, not the byte count of the day: sample-rpg has to
  // fit, with the slack the budget claims to hold back still unspent. Pinning
  // today's figure instead would fail on any harmless change to the region and
  // invite loosening the bound rather than investigating it — so the real
  // number goes in the failure message and the assertion stays at what has to
  // hold.
  for (const mapper of CAPABLE_MAPPERS) {
    const { project, used } = await measureRegion(t, mapper);
    const free = NESASM_BANK_BYTES - used;
    assert.ok(
      free >= BATTLE_SLACK,
      `${mapper.name}: sample-rpg leaves only ${free} bytes free in the banked code region ` +
        `(used ${used} of ${NESASM_BANK_BYTES}), under the ${BATTLE_SLACK}-byte BATTLE_SLACK the budget ` +
        'holds back. The region is out of room — see battleShortfallAdvice for what closes a gap like this.'
    );
    // ...and checkCapacity must agree that this project is fine, or the meter
    // and the refusal are reading different numbers from the same build.
    const { problems } = checkCapacity(project);
    assert.equal(
      problems.filter((p) => p.severity === 'error' && /battle system needs/.test(p.message)).length,
      0,
      `${mapper.name}: sample-rpg fits the region but checkCapacity refused it anyway`
    );
  }
});

// The projectScreenCeiling arrangement, for this meter: build.js renders
// battleRegionBytes/battleRegionCeiling and nothing else, so this asserts the
// two numbers the panel shows are the two numbers the refusal is decided on.
// A meter that computes its own ceiling is how the panel comes to promise room
// the build then denies.
// What this checks and what it does NOT. It exercises the *expression* the
// Build panel renders -- battleRegionBytes/battleRegionCeiling -- against
// checkCapacity's own refusal, over a sweep of projects, and pins that the two
// change their minds on the same one. It does not import, mount or render the
// renderer, so it cannot catch build.js being changed to compute its own
// ceiling; an earlier version of this test claimed otherwise in its name.
// That half is covered where the renderer actually runs: `npm run smoke`
// reads the rendered meter out of the real Build panel's DOM and the main
// process asserts those numbers against checkCapacity, on both sides of the
// boundary. Sabotage-verified there by changing the meter's ceiling.
//
// Scoped to a project with the stock battle code, deliberately. Once
// battle.asm is overridden the two are answering different questions -- the
// meter shows a stock-based estimate under a hint that says so, while the
// refusal drops to the one bound an override cannot move -- and the test that
// pins that divergence is the override one below, not this one.
test('the meter’s expression and checkCapacity refuse on the same projects', async () => {
  const base = await loadProject(SAMPLE_RPG);
  const mapper = SUPPORTED_MAPPERS.find((entry) => entry.id === base.cartridge.mapper);
  assert.ok(mapper, 'sample-rpg should name a registered mapper');

  const refuses = (project) =>
    checkCapacity(project).problems.some(
      (problem) => problem.severity === 'error' && /battle system needs/.test(problem.message)
    );
  const meterFull = (project) => battleRegionBytes(project, mapper) > battleRegionCeiling(mapper);

  assert.equal(refuses(base), false, 'sample-rpg should fit');
  assert.equal(meterFull(base), false, 'the meter should not read over-full for a project that fits');

  // Walk actors on until the region overflows, checking at every step that the
  // meter and the refusal change their minds on the same project — not merely
  // that both eventually say no.
  const project = structuredClone(base);
  const template = project.sprites.actors[project.sprites.actors.length - 1];
  let flipped = false;
  for (let i = 0; i < 400 && !flipped; i++) {
    project.sprites.actors.push({
      ...structuredClone(template),
      id: project.sprites.actors.length,
      name: `M${i}`
    });
    assert.equal(
      meterFull(project),
      refuses(project),
      `with ${project.sprites.actors.length} actors the meter and checkCapacity disagree about whether the ` +
        'banked code region is over capacity — the panel would promise room the build denies'
    );
    flipped = refuses(project);
  }
  assert.ok(flipped, 'adding actors should eventually overflow the region — the sweep never reached the ceiling');
});

// checkCapacity's own advice, for a project that genuinely does not fit. Not
// just "a message appeared": the fix it names has to actually work, or it is
// worse than no advice at all.
test('the refusal names a change that actually closes the gap', async () => {
  const base = await loadProject(SAMPLE_RPG);
  // A title screen, so this case's kernel-lo pressure (below, via
  // switchableMappers) matches what it always has: sample-rpg as checked in
  // carries none, and TITLE_KERNEL_ALLOWANCE_BY_MAPPER (main/build/
  // generate.js) means a titleless project no longer pays for one. Without
  // this, enough actors to overflow the *battle* region (this test's own
  // loop, unrelated to kernel-lo) stops being enough to also overflow
  // kernel-lo on every other candidate board, and the "no board is a safe
  // switch" premise below silently stops holding.
  base.project.titleMap = 0;
  base.project.titleScreen = 0;
  const mapper = SUPPORTED_MAPPERS.find((entry) => entry.id === base.cartridge.mapper);
  const project = structuredClone(base);
  const template = project.sprites.actors[project.sprites.actors.length - 1];
  while (battleRegionBytes(project, mapper) <= battleRegionCeiling(mapper)) {
    project.sprites.actors.push({
      ...structuredClone(template),
      id: project.sprites.actors.length,
      name: `M${project.sprites.actors.length}`
    });
  }

  // Taken before ANY of the calls below, not between two of them:
  // checkCapacity reaches battleShortfallAdvice itself, so a snapshot taken
  // after the first call would compare two already-mutated states and an
  // idempotent mutation would survive it unnoticed.
  const snapshot = structuredClone(project);

  const problem = checkCapacity(project).problems.find(
    (entry) => entry.severity === 'error' && /battle system needs/.test(entry.message)
  );
  assert.ok(problem, 'an over-capacity project should be refused');
  assert.equal(problem.where, 'Sprite Forge');
  // This many extra actors also overflows kernel-lo on every other board, so
  // switchableMappers offers none — and with no candidate to have judged, the
  // message must say NOTHING about boards. "Changing mapper does not help" is
  // an affirmative claim; an empty candidate list is an absence of information
  // about boards, not evidence about them. Guarded on the list really being
  // empty so this cannot pass for the wrong reason.
  assert.deepEqual(
    switchableMappers(project, mapper, { checkBattleRegion: false }).map((entry) => entry.name),
    [],
    'this case needs a project no board is a safe switch for'
  );
  assert.doesNotMatch(
    problem.message,
    /changing mapper/,
    'with no candidate board assessed, the advice must not make a claim about boards either way'
  );

  const deficit = battleRegionBytes(project, mapper) - battleRegionCeiling(mapper);
  const advice = battleShortfallAdvice(project, mapper, deficit);
  const count = Number(advice.match(/removing (\d+) actors/i)?.[1] ?? 1);
  assert.ok(count > 0, `advice should name a number of actors to remove, got: ${advice}`);

  // Take exactly the advice and confirm the project then fits — and that one
  // fewer than advised does not, so the number is the real minimum rather than
  // a safe over-estimate.
  const fixed = structuredClone(project);
  fixed.sprites.actors.splice(fixed.sprites.actors.length - count, count);
  assert.ok(
    battleRegionBytes(fixed, mapper) <= battleRegionCeiling(mapper),
    `following the advice (${advice}) still leaves the region over capacity`
  );
  const short = structuredClone(project);
  short.sprites.actors.splice(short.sprites.actors.length - (count - 1), count - 1);
  assert.ok(
    battleRegionBytes(short, mapper) > battleRegionCeiling(mapper),
    `the advice over-states the fix: removing ${count - 1} actors already suffices, but it asked for ${count}`
  );

  // Neither battleShortfallAdvice nor checkCapacity may mutate the project
  // they are advising about, the same rule projectWithoutCommands follows for
  // kernelShortfallAdvice. Deep-compared rather than re-counted: the byte
  // count is blind to a mutation that happens to be the same size -- a renamed
  // monster, a reordered spell list, a stat changed in place -- which is most
  // of what a buggy probe would actually do to it.
  assert.deepEqual(project, snapshot, 'nothing here may touch the project it is advising about');
});

// Advice must never send an author off to shorten names: nameTiles pads every
// name to NAME_LIMIT, so renaming a monster to one letter frees exactly
// nothing. Worth a test rather than a comment, because "shorter names" is the
// obvious-sounding suggestion and was in this phase's own brief.
test('shortening a name frees no bytes, and the advice never suggests it', async () => {
  const project = await loadProject(SAMPLE_RPG);
  const mapper = SUPPORTED_MAPPERS.find((entry) => entry.id === project.cartridge.mapper);
  const before = battleTableBytes(project);
  const renamed = structuredClone(project);
  for (const actor of renamed.sprites.actors) actor.name = 'X';
  for (const spell of renamed.spells) spell.name = 'X';
  for (const member of renamed.party) member.name = 'X';
  assert.equal(battleTableBytes(renamed), before, 'names are padded to NAME_LIMIT, so shortening one frees nothing');
  assert.doesNotMatch(battleShortfallAdvice(project, mapper, 1), /name/i);
});

// The `.fail` backstop the generator emits into assets/code.inc, and the one
// thing that makes it worth having rather than reassuring: it fires.
//
// Be exact about what it covers, because a guard that cannot be reached reads
// as coverage it does not provide. An override that is simply too big is
// caught by nesasm's own per-byte bank check first — `Bank overflow, offset >
// $1FFF!` against battle.asm, which no check placed after the content can beat
// to the punch. What this catches is an override that *relocates* with its own
// `.bank`/`.org` and finishes outside the region: nothing trips nesasm's
// per-byte check, because the bytes land in a bank with room for them. Verified
// by stripping the guard and running nesasm by hand — both cases below then
// assemble with exit 0, no reported errors and a complete ROM, with battle
// code spliced silently over screen data and over the kernel respectively.
//
// Both bounds are exercised, because they catch different relocations and a
// single-bound guard would still pass a one-sided test: the upper bound catches
// running off the end, the lower one the backward `.org` splice CLAUDE.md
// documents as a real nesasm behaviour.
test('the generated .fail catches an override that finishes outside the region', {
  skip: !hasNesasm && 'nesasm not found on PATH'
}, async (t) => {
  const stock = await fsp.readFile(path.join(ROOT, 'engine', 'battle.asm'), 'utf8');
  const nops = (count) => new Array(count).fill('  nop').join('\n');

  const build = async (tail, mapperId = 1) => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-bankedfail-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = mapperId; // 1 = MMC1: the region is bank 0 at $8000
    project.code = { overrides: [{ name: 'battle.asm', text: `${stock}\n${tail}\n` }], files: [] };
    await saveProject(dir, project);
    try {
      await buildProject({ dir, project, log: () => {} });
      return null;
    } catch (error) {
      return error;
    }
  };

  // The control. Without it a guard that refused *everything* would pass the
  // two cases below and take every real RPG build down with it.
  assert.equal(await build(''), null, 'an override that is just the stock file must still build');
  assert.equal(await build(nops(3000)), null, 'an override that grows but still fits must still build');

  // The escape the guard CANNOT close, paired with the warning that exists
  // because it cannot. An override may relocate, write, and return: the final
  // location counter — all a nesasm `.if` can read — is then perfectly inside
  // the region while bytes have landed somewhere else entirely. Reproduced on
  // UNROM 512 in a separate check below; here it is enough that the build is
  // NOT refused (so no comment may claim it is caught) and that the warning
  // fires (so nothing is claimed that is not true).
  //
  // On UNROM 512 with sample-rpg's three tilesets the CHR payloads take the
  // first three regions, so the code region is nesasm bank 3 at $A000 and bank
  // 0 holds a CHR payload. Returning to bank 1 / $B000 lands inside [$A000,
  // $C000] and the guard is satisfied. The board matters: the same tail on
  // MMC1, whose region is bank 0 at $8000, returns to $B000 — outside its
  // bounds — and IS caught, which is why this case names its own mapper rather
  // than riding on the default.
  const returning = '  .bank 0\n  .org $8000\n  .db $AA,$BB,$CC,$DD\n  .bank 1\n  .org $B000';
  assert.equal(
    await build(returning, 30),
    null,
    'an override that relocates, writes and returns is NOT caught by the guard — if this starts failing, the ' +
      'guard got stronger and the comments saying it cannot must be updated'
  );

  for (const [label, tail] of [
    ['runs on into the next region', `  .bank 1\n  .org $A000\n${nops(64)}`],
    ['splices backward into the kernel bank', `  .bank 2\n  .org $C000\n${nops(64)}`],
    ['splices backward below the region base', `  .org $0600\n${nops(64)}`]
  ]) {
    const error = await build(tail);
    assert.ok(error, `an override that ${label} should be refused, but the build succeeded`);
    const errors = error.errors ?? [];
    assert.ok(
      errors.some((entry) => entry.file === 'assets/code.inc'),
      `an override that ${label} should be refused by the guard in assets/code.inc, but nesasm reported ` +
        `${JSON.stringify(errors)} — if the guard has moved or been dropped, this ROM assembles silently ` +
        'with battle code written over screen data or over the kernel.'
    );
  }
});

// The warning that covers what the guard cannot. A relocating override is not
// refused -- the capacity arithmetic is still right, and refusing a build over
// a directive nobody has shown to be wrong would be the overreach -- but the
// user is told the guard cannot bound it.
//
// The syntactic sweep below is the point of this test. Every "relocates" form
// here was assembled against real nesasm v3.1 and produced a clean build with a
// real ROM, and an earlier anchored-at-line-start scan saw only the last of
// them. Undotted `BANK`/`ORG` is the one easiest to write by accident.
//
// The glued-colon forms (`zz_b:.org $8100`) are here because a scan that split
// on whitespace alone missed every one of them: nesasm needs no space after a
// label's colon, so the label and the directive arrive as one token that
// matches nothing. Verified rather than assumed -- `zz_b:.org $C100` assembles
// clean and the bytes really do move to $C100. Spacing the colon is the form
// this test had before, which is exactly why it passed under the defect.
test('a relocating override of the battle sources is warned about, not refused', async () => {
  const base = await loadProject(SAMPLE_RPG);
  const warnings = (project) =>
    checkCapacity(project).problems.filter(
      (problem) => problem.where === 'Code Forge' && /looks like a \.bank or \.org relocation/.test(problem.message)
    );
  const withOverride = (text, name = 'battle.asm') => {
    const project = structuredClone(base);
    project.code = { overrides: [{ name, text }], files: [] };
    return project;
  };

  assert.deepEqual(warnings(base), [], 'a project with no overrides has nothing to warn about');

  // Forms nesasm accepts. All four assemble cleanly; all four must be seen.
  for (const [label, text] of [
    ['a dotted directive', '  .org $9000\n'],
    ['a dotted bank switch', '  .bank 2\n'],
    ['upper case', '  .ORG $9000\n'],
    ['UNDOTTED, which nesasm also accepts', '  BANK 0\n  ORG $8100\n'],
    ['undotted and lower case', '  bank 3\n'],
    ['a label with no colon before it', 'bt_lab .org $8100\n'],
    ['a dot-prefixed local label before it', '.locallab: .org $8100\n'],
    ['a colon label before it', 'bt_lab: .org $8100\n'],
    ['a colon glued to the directive', 'zz_b:.org $8100\n'],
    ['a colon glued to a bank switch', 'zz_a:.bank 0\n'],
    ['a colon glued to an upper-case directive', 'zz:.BANK 1\n'],
    ['a real directive after a string containing a semicolon', '  .db "a;b"\n  .org $9000\n']
  ]) {
    const project = withOverride(text);
    assert.equal(battleRegionRelocates(project), true, `${label} relocates: ${JSON.stringify(text)}`);
    const found = warnings(project);
    assert.equal(found.length, 1, `${label} should raise exactly one warning`);
    assert.equal(found[0].severity, 'warning', 'uncertainty is surfaced, not turned into a refusal');
    assert.equal(
      checkCapacity(project).problems.filter((problem) => problem.severity === 'error').length,
      0,
      'a relocating override must not be refused — the capacity arithmetic is still correct'
    );
  }

  // Forms that are not relocations. Quoted spans come out before comments, so a
  // `;` inside a string cannot truncate a line and a directive-looking word
  // inside a string cannot count.
  for (const [label, text] of [
    ['plain code', '  nop\n  lda #$00\n'],
    ['a mention in a comment', '  nop ; do not use .org here\n'],
    ['a directive name inside a .db string', '  .db "see .org here",$00\n'],
    ['a label that happens to be called bank', 'bank: .db $01\n'],
    ['a label that happens to be called org', 'org: .db $01\n']
  ]) {
    assert.equal(battleRegionRelocates(withOverride(text)), false, `${label} does not relocate`);
    assert.deepEqual(warnings(withOverride(text)), [], `${label} must not be warned about`);
  }

  // Only the region's own sources: an override elsewhere is not this bank's
  // problem, and warning about it here would point at the wrong bank.
  assert.equal(
    battleRegionRelocates(withOverride('  .org $9000\n', 'player.asm')),
    false,
    'player.asm does not assemble into this region'
  );

  // The limits, asserted as limits rather than left implied. These are what
  // "lexical best-effort" means concretely, and the warning's own wording says
  // so; if either of these ever starts returning true, the wording should be
  // revisited rather than the test loosened.
  assert.equal(
    battleRegionRelocates(withOverride('  .include "elsewhere.asm"\n')),
    false,
    'a relocation reached through .include is invisible to a text scan — stated, not fixed'
  );
  assert.equal(
    battleRegionRelocates(withOverride('MOVEIT .macro\n  .org $9000\n  .endm\n  MOVEIT\n')),
    true,
    'a macro *body* containing the directive is seen, because the text contains it — the invisible case is a ' +
      'macro that composes the directive rather than spelling it out'
  );

  // ...and the accepted false positives. Both assemble to nothing and both
  // warn. Deliberate: a spurious warning costs attention, a missed one costs a
  // silently corrupt ROM.
  for (const [label, text] of [
    ['an .org inside .if 0', '  .if 0\n  .org $9000\n  .endif\n'],
    ['an .org in a macro body nothing invokes', 'UNUSED .macro\n  .org $9000\n  .endm\n'],
    // Two colons is not a form nesasm accepts: `a:b:.org $C100` is rejected
    // outright ("Reserved symbol!" / "Unknown instruction!", no ROM), as are
    // `foo:qux:.org` and `foo::.org`. Judging every segment after a colon warns
    // on it anyway, and that is fine in the direction that matters -- code that
    // does not assemble cannot ship a corrupt ROM. Here so the behaviour is
    // pinned as a false positive rather than mistaken later for a real escape.
    ['a multi-colon form nesasm rejects outright', 'a:b:.org $9000\n']
  ]) {
    assert.equal(
      battleRegionRelocates(withOverride(text)),
      true,
      `${label} is an accepted false positive — the scan reads text, not what assembles`
    );
  }
});

// The reviewer's case, and the one this advice got wrong first time round: the
// region is the same 8 KB on every RPG-capable board, but the stock code
// inside it is not the same size, so MMC3 has 46 fewer usable bytes than the
// other two. A flat "changing mapper does not help" is false for an MMC3
// project over by 1 to 46 bytes, which is exactly the band where an author is
// most likely to act on it.
test('an MMC3 project inside the 46-byte band is told a different board fits', async () => {
  const base = await loadProject(SAMPLE_RPG);
  const mmc3 = SUPPORTED_MAPPERS.find((entry) => entry.id === 4);
  const mmc1 = SUPPORTED_MAPPERS.find((entry) => entry.id === 1);
  assert.equal(
    baseBattleCodeBytes(mmc3) - baseBattleCodeBytes(mmc1),
    46,
    'this test exists because MMC3 spends more of the region on stock code — re-derive it if that changed'
  );

  // Walk actors on until MMC3 is over but MMC1 would still fit: the band.
  const project = structuredClone(base);
  project.cartridge.mapper = 4;
  const template = project.sprites.actors[project.sprites.actors.length - 1];
  let inBand = false;
  for (let i = 0; i < 400 && !inBand; i++) {
    project.sprites.actors.push({
      ...structuredClone(template),
      id: project.sprites.actors.length,
      name: `M${i}`
    });
    inBand =
      battleRegionBytes(project, mmc3) > battleRegionCeiling(mmc3) &&
      battleRegionBytes(project, mmc1) <= battleRegionCeiling(mmc1);
  }
  assert.ok(inBand, 'never found a project over on MMC3 but fitting on MMC1 — the band should exist');

  const problem = checkCapacity(project).problems.find(
    (entry) => entry.severity === 'error' && /battle system needs/.test(entry.message)
  );
  assert.ok(problem, 'the MMC3 project should be refused');
  assert.doesNotMatch(
    problem.message,
    /changing mapper does not help/,
    `this project fits on another board unchanged, so the advice must not say a switch cannot help: ${problem.message}`
  );
  assert.match(problem.message, /in the Build panel has room for it/);

  // ...and the board it names has to be one the project could actually switch
  // to and then fit on, not merely one with a smaller base.
  const named = SUPPORTED_MAPPERS.find((entry) => problem.message.includes(`${entry.name} in the Build panel`));
  assert.ok(named, `the advice should name a registered board: ${problem.message}`);
  assert.ok(
    battleRegionBytes(project, named) <= battleRegionCeiling(named),
    `${named.name} was offered as a fix but the project does not fit its region either`
  );

  // The other direction: candidate boards exist and none of them has room. The
  // deficit is grown with SPELLS rather than actors on purpose — an actor costs
  // eight bytes of kernel-lo lookup table as well, so piling those on overflows
  // the candidates' kernel bank and empties the list, which is a third case
  // entirely (tested above). Spells live only in this region, so the
  // candidates stay switchable and the advice has something real to judge.
  const crowded = structuredClone(project);
  const spell = crowded.spells[crowded.spells.length - 1];
  while (battleRegionBytes(crowded, mmc1) <= battleRegionCeiling(mmc1)) {
    crowded.spells.push({ ...structuredClone(spell), id: crowded.spells.length, name: `S${crowded.spells.length}` });
  }
  assert.ok(
    switchableMappers(crowded, mmc3, { checkBattleRegion: false }).length > 0,
    'this case needs candidate boards to exist, or it is testing the empty-list branch by accident'
  );
  const far = checkCapacity(crowded).problems.find((entry) => /battle system needs/.test(entry.message));
  assert.ok(far, 'the crowded project should still be refused');
  assert.match(far.message, /changing mapper does not help/);
  // ...and the reason given has to be true. MMC1 and UNROM 512 really do spend
  // 46 fewer bytes of this region than MMC3; what they do not spend is *enough*
  // less to close a deficit this size. Saying they spend no less at all would
  // be a false statement in support of a correct conclusion.
  assert.doesNotMatch(
    far.message,
    /spends less of it/,
    'other boards do spend less of the region than MMC3 — just not enough less'
  );
  assert.match(far.message, /spends enough less of it/);
});

// switchableMappers is the single answer to "would a different board fix
// this?", shared by kernelShortfallAdvice and battleShortfallAdvice. A board
// it offers has to survive the switch: no content lost to reconcileCartridge,
// no new validateProject error, and still fitting all three bounded banks.
//
// The three cases below are the ones a hand-written filter chain actually got
// wrong, which is why the implementation asks reconcileCartridge and
// validateProject instead of restating their rules. They are checked through
// the real function rather than by re-deriving the rules here — a test that
// re-implements the thing it is testing agrees with itself, not with reality.
test('switchableMappers offers only boards the project survives switching to', async () => {
  const base = await loadProject(SAMPLE_RPG);
  const mmc3 = resolveMapper(4); // the only scanline-IRQ board
  const mmc1 = resolveMapper(1);

  // The positive control, and the reason none of this is vacuous: an ordinary
  // MMC3 RPG has candidates, so every "it is gone now" below is a real change
  // rather than an empty list staying empty.
  const open = switchableMappers({ ...structuredClone(base), cartridge: { ...base.cartridge, mapper: 4 } }, mmc3);
  assert.ok(open.length > 0, 'an ordinary MMC3 RPG should have boards it could switch to');
  assert.ok(
    open.some((entry) => entry.id === 1),
    'MMC1 should be among them — the later cases turn on it being removed'
  );

  // Every offered board must, after the switch, raise no error the project did
  // not already have. Asserted over the control set rather than assumed.
  for (const candidate of open) {
    const moved = structuredClone(base);
    moved.cartridge.mapper = candidate.id;
    reconcileCartridge(moved);
    assert.deepEqual(
      validateProject(moved)
        .filter((entry) => entry.severity === 'error')
        .map((entry) => `${entry.where}: ${entry.message}`),
      [],
      `${candidate.name} was offered but switching to it would refuse the build`
    );
  }

  const offers = (project, from) => switchableMappers(project, from).map((entry) => entry.id);

  // 1. Leaving MMC3 stamps the message font over $A0-$FF, so a tileset with
  //    art up there cannot go anywhere.
  const bgArt = structuredClone(base);
  bgArt.cartridge.mapper = 4;
  bgArt.tilesets[0].background.tiles[FONT_BASE + 3] = bgArt.tilesets[0].background.tiles[1];
  assert.notEqual(bgArt.tilesets[0].background.tiles[FONT_BASE + 3], BLANK_TILE, 'the case needs real art at $A0+');
  assert.deepEqual(offers(bgArt, mmc3), [], 'art in the font’s range should rule out every non-split board');

  // 2. *Entering* MMC3 costs sprite tile $FD, which the battle targeting
  //    cursor reserves there and nowhere else — so the hazard runs both ways.
  const sprArt = structuredClone(base);
  sprArt.cartridge.mapper = 1;
  sprArt.tilesets[0].sprites.tiles[SPRITE_ARROW_TILE] = sprArt.tilesets[0].sprites.tiles[1];
  assert.notEqual(sprArt.tilesets[0].sprites.tiles[SPRITE_ARROW_TILE], BLANK_TILE, 'the case needs real art at $FD');
  assert.ok(
    !offers(sprArt, mmc1).includes(4),
    'MMC3 reserves sprite tile $FD for the battle cursor, so a project using it must not be sent there'
  );

  // 3. A board that fixes one bounded bank by overflowing another is not a
  //    fix. sample-rpg with a live Save and a live Move does not fit
  //    kernel-lo on UNROM 512 (see the comment beside kernelCodeBytes), so it
  //    must not be offered however roomy its other banks are.
  const heavy = structuredClone(base);
  heavy.cartridge.mapper = 1;
  // A real title screen, not a titleless one: kernelCodeBytes now charges a
  // live Save command's forced title cost whether or not titleMap is set
  // (see its own comment beside `usesTitle`), so the kernel-lo totals below
  // are identical either way -- but a titleless Save project is not the
  // valid build this case is about, and leaving it titleless would make
  // "needs a title screen" a second, unrelated-looking pre-existing error
  // alongside the one the block below deliberately adds.
  heavy.project.titleMap = 0;
  heavy.project.titleScreen = 0;
  heavy.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: {
      event: {
        pages: [
          { cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }] }
        ]
      }
    }
  });
  // No filler content needed: sample-rpg's own Save+Move combination on
  // UNROM 512 already overflows kernel-lo by 155 bytes on its own, now that
  // the forced title cost is actually charged -- this is the same documented
  // shortfall test/unit/kernelbytes.test.js's own "does not build" test
  // covers, re-derived here rather than assumed. Before finding 1 of the
  // phase4a round-2 review, this needed 12 filler actors to reach a real
  // deficit at all, because a titleless project was undercharged by exactly
  // the title term; that undercharge is what this whole case is now free of.
  const { fixedBytes, tableBytes } = kernelTableBytes(heavy);
  const u512 = resolveMapper(30);
  assert.ok(
    kernelCodeBytes(heavy, u512) + fixedBytes + tableBytes > 8192,
    'this case needs a project that genuinely overflows kernel-lo on UNROM 512 — re-derive it if that changed'
  );
  assert.ok(!offers(heavy, mmc1).includes(30), 'a board that overflows kernel-lo must not be offered');

  // ...and an error the project ALREADY has must not suppress advice, or one
  // unrelated mistake silently costs the author every mapper suggestion.
  // Genuinely unrelated to capacity, unlike an earlier version of this case
  // (a live Save with no title screen) that the phase4a round-2 review
  // flagged: that error and the thing being tested here were the same fact
  // once a live Save started charging kernel-lo for its own forced title
  // cost, which made the test's premise and its guard the same thing. A
  // dangling `call` has nothing to do with any bounded bank -- it is a
  // Run-common-event reference to an id no live common event holds, caught
  // by validateProject's own liveCommonEventIds check, and touches no byte
  // count kernelTableBytes or kernelCodeBytes reads.
  heavy.maps[0].screens[0].entities[heavy.maps[0].screens[0].entities.length - 1].props.event.pages[0].commands.push({
    op: 'call',
    event: 9999
  });
  assert.ok(
    validateProject(heavy).some((entry) => /Run common event/.test(entry.message)),
    'this case needs a pre-existing, board-independent error to be meaningful'
  );
  assert.ok(offers(heavy, mmc1).length > 0, 'a pre-existing error must not rule out every board');

  // 4. The quiet-data-loss case, and the only one validateProject cannot see:
  //    UNROM 512 holds four tilesets, so switching an eight-tileset project to
  //    it makes reconcileCartridge drop half of them — and the *result* is a
  //    perfectly valid project, which is exactly what makes this dangerous.
  //    Nothing but comparing before and after catches it.
  const many = structuredClone(base);
  many.cartridge.mapper = 1;
  while (many.tilesets.length < 8) {
    const copy = structuredClone(many.tilesets[0]);
    copy.id = many.tilesets.length;
    copy.name = `Extra ${copy.id}`;
    many.tilesets.push(copy);
  }
  const truncated = structuredClone(many);
  truncated.cartridge.mapper = 30;
  reconcileCartridge(truncated);
  assert.ok(truncated.tilesets.length < many.tilesets.length, 'the case needs a switch that really truncates');
  assert.deepEqual(
    validateProject(truncated).filter((entry) => entry.severity === 'error'),
    [],
    'the truncated project must validate cleanly — otherwise this tests the error check, not the lossless one'
  );
  assert.ok(
    !offers(many, mmc1).includes(30),
    'switching would silently drop four tilesets, so UNROM 512 must not be offered as a fix'
  );
  assert.ok(offers(many, mmc1).length > 0, 'a board that costs nothing should still be offered here');

  // 5. Hand-written 6502 makes every fit check a guess, so no board is offered
  //    at all. Two of the three checks read models of stock code, and a plain
  //    user file lands in kernel-lo through assets/usercode.inc just as an
  //    override of an engine file replaces something already there.
  for (const code of [
    { overrides: [{ name: 'battle.asm', text: '; mine\n' }], files: [] },
    { overrides: [{ name: 'player.asm', text: '; mine\n' }], files: [] },
    { overrides: [], files: [{ name: 'mine.asm', text: '; mine\n' }] }
  ]) {
    const coded = structuredClone(base);
    coded.cartridge.mapper = 1;
    coded.code = code;
    assert.deepEqual(
      offers(coded, mmc1),
      [],
      'a project carrying hand-written code has an unmeasurable bank, so no board may be recommended: ' +
        JSON.stringify(code)
    );
  }
  // ...and the same project without the code still gets advice, so the guard
  // above is what withheld it rather than something else about the project.
  const uncoded = structuredClone(base);
  uncoded.cartridge.mapper = 1;
  assert.ok(offers(uncoded, mmc1).length > 0, 'the identical project without code must still be advised');

  // 6. The tileset ceiling checkCapacity applies is not the one
  //    reconcileCartridge applies: on MMC3 the split font costs a CHR page, so
  //    reconcile keeps 32 tilesets that checkCapacity then refuses. Losslessness
  //    cannot stand in for that check.
  const ceilingCase = structuredClone(base);
  ceilingCase.cartridge.mapper = 1;
  const mmc3Ceiling = tilesetLimit(mmc3, ceilingCase.cartridge, 0);
  while (ceilingCase.tilesets.length < mmc3Ceiling) {
    const copy = structuredClone(ceilingCase.tilesets[0]);
    copy.id = ceilingCase.tilesets.length;
    copy.name = `T${copy.id}`;
    ceilingCase.tilesets.push(copy);
  }
  const reconciled = structuredClone(ceilingCase);
  reconciled.cartridge.mapper = 4;
  reconcileCartridge(reconciled);
  assert.equal(
    reconciled.tilesets.length,
    ceilingCase.tilesets.length,
    'reconcileCartridge should NOT truncate here — that is what makes this case invisible to the lossless check'
  );
  assert.ok(
    reconciled.tilesets.length > tilesetLimit(mmc3, reconciled.cartridge, fontChrPages(reconciled, mmc3)),
    'this case needs a count reconcile allows but the font page pushes past checkCapacity’s own ceiling'
  );
  assert.ok(
    !offers(ceilingCase, mmc1).includes(4),
    'MMC3 cannot hold this many tilesets alongside the font’s CHR page, so it must not be offered'
  );
});

// battleRegionBytes counts the STOCK battle code. A Code Forge override of it
// is hand-written 6502, outside the byte math the same way all user code is —
// and CLAUDE.md's rule about that cuts both ways: a guess "would either refuse
// a project that fits or promise room the assembler then denies". So the
// refusal drops to the one bound an override cannot move (the generated tables
// alone), the meter keeps its stock-based figure under a hint saying so, and
// the advice stops claiming any reduction is sufficient.
test('an override of the battle sources withdraws the claim rather than guessing', async () => {
  const base = await loadProject(SAMPLE_RPG);
  const mapper = SUPPORTED_MAPPERS.find((entry) => entry.id === base.cartridge.mapper);
  assert.equal(battleCodeOverridden(base), false, 'sample-rpg overrides nothing');

  // Which files land in the region is a fact about the engine's own include
  // graph, not about the constant — so walk it and assert the constant agrees.
  // Following only battle.asm's direct includes would miss a file pulled in one
  // level deeper, and looping over BATTLE_REGION_SOURCES itself would be
  // circular: deleting an entry would shrink the loop with it and still pass,
  // which a sabotage run caught it doing.
  const walk = async (name, seen = new Set()) => {
    if (seen.has(name)) return seen;
    seen.add(name);
    const text = await fsp.readFile(path.join(ROOT, 'engine', name), 'utf8');
    for (const match of text.matchAll(/^\s*\.include\s+"([^"]+)"/gm)) {
      if (match[1].startsWith('assets/')) continue; // generated, not overridable
      await walk(match[1], seen);
    }
    return seen;
  };
  const reachable = [...(await walk('battle.asm'))];
  assert.deepEqual(
    [...BATTLE_REGION_SOURCES].sort(),
    reachable.sort(),
    'BATTLE_REGION_SOURCES must be every stock file reachable from battle.asm — assets/code.inc includes ' +
      'battle.asm, and everything it pulls in, at any depth, assembles into the same region. If the include ' +
      'graph changed, this constant has to follow or battleCodeOverridden will miss an override and go on ' +
      'treating a stale base as measured.'
  );
  for (const name of reachable) {
    const project = structuredClone(base);
    project.code = { overrides: [{ name, text: '; hello\n' }], files: [] };
    assert.equal(battleCodeOverridden(project), true, `${name} assembles into the region and must count`);
  }
  const unrelated = structuredClone(base);
  unrelated.code = { overrides: [{ name: 'player.asm', text: '; hello\n' }], files: [] };
  assert.equal(battleCodeOverridden(unrelated), false, 'player.asm is in the kernel, not this region');

  // main.asm is not IN the region but decides whether assets/code.inc reaches
  // the ROM at all, and where. An override of it can move the generated tables
  // out of the region entirely, which unsettles even the tables-only bound the
  // refusal falls back to — so it has to count, despite not being a file the
  // include walk above can see.
  assert.ok(
    !reachable.includes('main.asm'),
    'main.asm is one level above battle.asm’s include graph — that is why it needs its own list'
  );
  const placement = structuredClone(base);
  placement.code = { overrides: [{ name: 'main.asm', text: '; mine\n' }], files: [] };
  assert.equal(
    battleRegionPlacementOverridden(placement),
    true,
    'an override of main.asm controls where assets/code.inc lands, and whether it lands at all'
  );
  // ...and it is a DIFFERENT question from the size one, deliberately. An
  // override of battle.asm leaves the tables where they are, so "the tables
  // alone must fit" survives it; an override of main.asm does not, so nothing
  // about this region may be refused at all.
  assert.equal(battleCodeOverridden(placement), false, 'main.asm is not in the region — it decides where it is');
  const sizeOnly = structuredClone(base);
  sizeOnly.code = { overrides: [{ name: 'battle.asm', text: '; mine\n' }], files: [] };
  assert.equal(
    battleRegionPlacementOverridden(sizeOnly),
    false,
    'overriding battle.asm changes the region’s size, not its placement'
  );

  // The known limitation, pinned rather than papered over: an override changes
  // what the region really holds and the model cannot see it.
  const overridden = structuredClone(base);
  overridden.code = { overrides: [{ name: 'battle.asm', text: '; nothing at all\n' }], files: [] };
  assert.equal(
    battleRegionBytes(overridden, mapper),
    battleRegionBytes(base, mapper),
    'the model cannot see an override — which is why the conclusions built on it are withdrawn'
  );

  const grow = (project, count) => {
    const template = project.sprites.actors[project.sprites.actors.length - 1];
    for (let i = 0; i < count; i++) {
      project.sprites.actors.push({
        ...structuredClone(template),
        id: project.sprites.actors.length,
        name: `M${project.sprites.actors.length}`
      });
    }
    return project;
  };
  const refusal = (project) =>
    checkCapacity(project).problems.find(
      (entry) => entry.severity === 'error' && /battle system/.test(entry.message)
    );

  // The false-refusal case, and the point of the whole branch. Stock, this
  // project is over. Overridden, the real size is unknown and the override may
  // well be smaller — so refusing it would turn away a project that fits, on a
  // measurement of a file that is not being assembled.
  const stockOver = grow(structuredClone(base), 131);
  assert.ok(refusal(stockOver), 'this case needs a project the stock base refuses');
  const overrideOver = structuredClone(stockOver);
  overrideOver.code = { overrides: [{ name: 'battle.asm', text: '; a smaller battle system\n' }], files: [] };
  assert.equal(
    refusal(overrideOver),
    undefined,
    'a project whose own battle code might be smaller than the engine’s must not be refused on the engine’s size'
  );

  // ...but the bound an override cannot move is still enforced, and said
  // honestly: the tables alone do not fit, and no reduction is promised to be
  // sufficient because sufficiency is not knowable here.
  const tablesOver = grow(structuredClone(overrideOver), 400);
  const problem = refusal(tablesOver);
  assert.ok(problem, 'tables that alone exceed the region must still be refused, override or not');
  assert.equal(problem.where, 'Sprite Forge');
  assert.match(problem.message, /tables alone need/);
  assert.match(problem.message, /before this project’s own battle code is counted at all/);
  assert.match(problem.message, /is the least that could fit/);
  assert.doesNotMatch(
    problem.message,
    /would free enough|frees enough/,
    'sufficiency is not knowable with an override — the advice must not promise it'
  );
  assert.doesNotMatch(
    problem.message,
    /has room for it/,
    'no board can be said to have room for a project whose battle code has not been sized'
  );
  assert.match(problem.message, /the assembler is the only thing that can tell you the real total/);

  // The placement case withdraws the refusal entirely rather than falling back
  // to the tables-only bound: that bound assumes the tables are in this region,
  // which is precisely what a custom main.asm decides. Refusing here would turn
  // away a project whose own main puts them somewhere they fit.
  const relocated = structuredClone(tablesOver);
  relocated.code = { overrides: [{ name: 'main.asm', text: '; my own layout\n' }], files: [] };
  assert.ok(refusal(tablesOver), 'the same project is refused while main.asm is stock');
  assert.equal(
    refusal(relocated),
    undefined,
    'with main.asm overridden, even the tables-only bound assumes a placement this project has taken over'
  );
});
