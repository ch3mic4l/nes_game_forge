// kernelCodeBytes (main/build/generate.js) is a hand-measured over-estimate
// of the engine code that shares the fixed kernel's low bank with the lookup
// tables, and checkCapacity() trusts it to leave room for both. It is a
// function of the project and mapper now, not one flat number: save/load
// (engine/save.asm) only assembles where the project has a live Save command
// on a battery-capable board, and charging every project on every mapper for
// the worst case of a feature it never turns on is what broke a 54-screen
// UxROM project that had nothing to do with saving (see the long comment
// beside kernelCodeBytes for the full story). A measurement taken on only one
// of the two configurations — with or without a live Save command — or on
// only one of several RPG-capable boards, is not the worst case, and the gap
// between the guess and reality only shows up as the assembler's own "Bank
// overflow" once a project actually turns on what this test did not look at,
// which is exactly the raw-assembler-output failure this codebase otherwise
// refuses to ship. This builds the real worst case for *each* configuration,
// on every board that configuration applies to, and asserts kernelCodeBytes
// still covers the largest of each — so the next regression, in either
// direction, is a failing test here rather than a bug report from someone
// else's project.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { kernelCodeBytes, KERNEL_SLACK, SAVE_KERNEL_ALLOWANCE } from '../../main/build/generate.js';
import { SUPPORTED_MAPPERS, rpgCapable, batteryCapable, prgLayout } from '../../shared/cartridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
// This test builds its own temporary ROMs from scratch rather than reading
// sample-rpg/build/game.nes, so it must not gate on that file the way the
// tests that actually read it do — this is the one thing standing between a
// kernel-overflow regression and a clean checkout silently skipping the test
// built to catch it. It depends on nothing but nesasm itself.
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// rpgCapable() (shared/cartridge.js) is the single writer for which boards an
// RPG may target at all — asserting the ceiling on only one of them assumes
// today's ordering holds forever, and a margin over the runner-up is not a
// margin a future change need respect.
const CAPABLE_MAPPERS = SUPPORTED_MAPPERS.filter(rpgCapable);

/**
 * Builds sample-rpg on `mapper` with every conditionally-assembled block
 * heal/damage's own measurement already covered (dialogue, action combat,
 * the RPG battle system, branches, questions, common-event calls, Play
 * music, Start a battle, Heal/Damage) turned on, plus a live Save command
 * when `withSave` is true — the whole point is nothing conditional is left
 * out of whichever configuration is being measured. Returns the real kernel
 * code size: nesasm's own usage for the kernel-lo bank, minus everything
 * before `reset` in it (the lookup tables — kernel_lo.inc, palettes,
 * metatiles, sprites, input, maps, chrtables — `reset` being the first label
 * of boot.asm, the first file of engine code included after them), measured
 * off the real assembly rather than recomputed by hand here.
 */
async function measureCodeBytes(t, mapper, withSave) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelbytes-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = mapper.id;
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  if (withSave) {
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
    });
  }
  await saveProject(dir, project);
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });

  const { kernelLoBank } = prgLayout(mapper);
  // nesasm's own "segment usage" table, one row per bank: "BANK  62   7182/1010"
  // — right-aligned, so the free half can carry a leading space the used
  // half never does ("7235/ 957").
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  assert.ok(Number.isFinite(used) && used > 0, `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`);

  assert.ok(built.symbolPath, `${mapper.name}: nesasm should have written a symbol file`);
  const symbols = await fsp.readFile(built.symbolPath, 'utf8');
  const resetMatch = symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m);
  assert.ok(resetMatch, `${mapper.name}: reset should be a named symbol in game.fns`);
  const resetAddr = parseInt(resetMatch[1], 16);

  return { project, codeBytes: used - (resetAddr - 0xc000) };
}

/**
 * Both directions, and a *floor* under the margin so it cannot quietly erode.
 *
 * `gap` is how much of the margin is legitimately spoken for by
 * BASE_KERNEL_CODE_BYTES being measured off a *different* board than
 * whichever one turns out "worst" here — real and structural (see
 * measuredBaselineGap below), not slop, so it is subtracted out before
 * judging whether the remaining margin looks right. Pass 0 for the no-save
 * configuration, where "worst" already *is* the figure
 * BASE_KERNEL_CODE_BYTES claims to measure, so no such gap exists.
 *
 * `floorGap` and `ceilingGap` are two different questions and must not share
 * a value, a bug this file had at first: `floorGap` is how much of *this
 * run's actual worst board's own* margin is spoken for by
 * BASE_KERNEL_CODE_BYTES being measured off a different board than that one
 * specifically -- if the wrong (larger, "what if a different board were
 * worst") gap is used here, the floor becomes so loose it stops meaning
 * anything, the exact failure mode this floor exists to prevent, just moved
 * one level up. `ceilingGap` is the other direction and does want the
 * worst-case across every battery board, since a future run's "worst" board
 * need not be today's.
 *
 * KERNEL_SLACK is deliberate headroom kernelCodeBytes adds on top of an
 * allowance that is itself supposed to already equal the worst measured
 * delta — not a second, looser allowance a stale first one gets to quietly
 * borrow from. A margin under `floorGap + KERNEL_SLACK` means the
 * reservation has fallen behind what the engine now actually costs. This
 * floor is *not* the same claim as "SAVE_KERNEL_ALLOWANCE equals the largest
 * measured delta" — it is only a consequence of that claim, and a positive
 * gap can absorb a stale allowance without the consequence ever showing:
 * SAVE_KERNEL_ALLOWANCE recorded at 531 against a true 552 failed this floor
 * only because MMC3 happened to have the smaller gap (margin fell to 7);
 * recorded at 544 — still 8 bytes short of the true 552 — the same floor
 * passes cleanly, because floorGap (8, MMC3's own) plus KERNEL_SLACK (20)
 * covers it by coincidence. That is exactly why
 * assertAllowanceMatchesMeasuredDeltas below exists: it asserts the rule
 * itself, not this consequence of it.
 */
function assertCovers(t, measurements, budgetFor, floorGap, ceilingGap, label) {
  const worst = measurements.reduce((max, entry) => (entry.codeBytes > max.codeBytes ? entry : max));
  const budget = budgetFor(worst);
  const margin = budget - worst.codeBytes;
  const summary = measurements.map((entry) => `${entry.mapper.name}: ${entry.codeBytes}`).join(', ');

  assert.ok(
    worst.codeBytes <= budget,
    `${label}: the real engine measures up to ${worst.codeBytes} bytes of kernel code, on ${worst.mapper.name}, ` +
      `but kernelCodeBytes only reserves ${budget} [${summary}] — checkCapacity() is promising table room the ` +
      'assembler will refuse. Re-measure and raise the relevant term (see the comment beside kernelCodeBytes).'
  );
  assert.ok(
    margin >= floorGap + KERNEL_SLACK,
    `${label}: kernelCodeBytes reserves ${budget} but the worst measured is ${worst.codeBytes} bytes, on ` +
      `${worst.mapper.name} [${summary}] — only a ${margin}-byte margin, under ${worst.mapper.name}'s own ` +
      `${floorGap}-byte measured board-baseline gap plus the ${KERNEL_SLACK}-byte KERNEL_SLACK this ` +
      'reservation is supposed to leave untouched. Re-measure and raise the relevant term (see the comment ' +
      'beside kernelCodeBytes).'
  );
  // Not just a floor: a constant so much larger than reality that it stopped
  // tracking the engine would hide the next regression exactly the way a
  // too-low one causes one, just silently instead of loudly. ceilingGap is
  // measured off this run's own boards (see measuredBaselineGap below), not
  // a hardcoded guess -- an honest future board with a wider legitimate
  // baseline gap widens this ceiling along with it instead of tripping it.
  assert.ok(
    margin <= ceilingGap + KERNEL_SLACK * 2,
    `${label}: kernelCodeBytes reserves ${budget}, far more than the worst measured ${worst.codeBytes} bytes, ` +
      `on ${worst.mapper.name} [${summary}] — a ${margin}-byte margin is more than the ${ceilingGap}-byte ` +
      'largest measured board-baseline gap plus twice KERNEL_SLACK can explain; confirm this measurement is ' +
      'still the actual worst case rather than a stale, overly generous guess.'
  );
}

/**
 * The direct form of "SAVE_KERNEL_ALLOWANCE equals the largest measured
 * delta" — not a consequence of it, the way assertCovers's margin floor
 * above is. That floor bounds the *total* budget against the *worst*
 * board's with-save figure; it can stay green while the allowance itself is
 * stale, because BASE_KERNEL_CODE_BYTES being measured off a different,
 * non-battery board than whichever battery board is "worst" leaves a
 * positive gap that a modestly-understated allowance can hide inside.
 * Comparing each battery board's own measured save/no-save delta straight
 * against the constant is what the rule actually says, board by board, with
 * no gap to hide behind — the check that would have caught both 531 (true
 * worst 552) and a hypothetical 544 (also short of 552, and invisible to
 * the margin floor once MMC3's own 8-byte gap covers the difference).
 */
function assertAllowanceMatchesMeasuredDeltas(noSave, withSave) {
  const noSaveByMapper = new Map(noSave.map((entry) => [entry.mapper.id, entry]));
  for (const withEntry of withSave) {
    const noEntry = noSaveByMapper.get(withEntry.mapper.id);
    assert.ok(noEntry, `${withEntry.mapper.name}: no matching no-save measurement to diff against`);
    const delta = withEntry.codeBytes - noEntry.codeBytes;
    assert.ok(
      delta <= SAVE_KERNEL_ALLOWANCE,
      `${withEntry.mapper.name}: save/load costs ${delta} bytes of kernel code (${noEntry.codeBytes} -> ` +
        `${withEntry.codeBytes}), but SAVE_KERNEL_ALLOWANCE only reserves ${SAVE_KERNEL_ALLOWANCE} — the ` +
        "allowance has fallen behind this board's own real cost. Re-measure and raise it (see the comment " +
        'beside kernelCodeBytes).'
    );
  }
}

/** `noSave`'s own worst figure — what BASE_KERNEL_CODE_BYTES is supposed to equal. */
function overallWorstNoSave(noSave) {
  return Math.max(...noSave.map((entry) => entry.codeBytes));
}

/** This specific mapper's own no-save measurement, from the same `noSave` array. */
function noSaveBaselineFor(noSave, mapper) {
  const entry = noSave.find((e) => e.mapper.id === mapper.id);
  assert.ok(entry, `${mapper.name}: no matching no-save measurement`);
  return entry.codeBytes;
}

/**
 * How much of a *this-run's-actual-worst-board's* with-save margin is
 * legitimately explained by BASE_KERNEL_CODE_BYTES being measured off a
 * different board than that one — the tight, run-specific gap the margin
 * floor needs. Not the same question as the ceiling's: see assertCovers's
 * own comment.
 */
function actualWorstBoardGap(noSave, worstMapper) {
  return overallWorstNoSave(noSave) - noSaveBaselineFor(noSave, worstMapper);
}

/**
 * The largest a with-save margin could legitimately be if a *different*
 * battery board — not necessarily today's worst — turned out worst instead,
 * derived from this run's own no-save measurements rather than a hardcoded
 * guess of today's gap, so an honest future board's own baseline does not
 * have to be predicted in advance to avoid a false failure here.
 */
function maxPossibleBatteryGap(noSave, batteryMappers) {
  const batteryBaselines = noSave
    .filter((entry) => batteryMappers.some((mapper) => mapper.id === entry.mapper.id))
    .map((entry) => entry.codeBytes);
  return overallWorstNoSave(noSave) - Math.min(...batteryBaselines);
}

test(
  'kernelCodeBytes covers the real engine, on every RPG-capable board, with and without save/load',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    assert.ok(CAPABLE_MAPPERS.length > 0, 'no RPG-capable mapper is registered — rpgCapable() found nothing');
    const batteryMappers = CAPABLE_MAPPERS.filter(batteryCapable);
    assert.ok(batteryMappers.length > 0, 'no battery-capable mapper is registered — batteryCapable() found nothing');

    // Every RPG-capable board, SAVE_ENABLED off -- including the
    // battery-capable ones, because a board that *can* save is not the same
    // as a project that *does*, and this configuration is what every project
    // with no Save command actually pays for regardless of which mapper it
    // targets.
    const noSave = [];
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, false);
      noSave.push({ mapper, project, codeBytes });
    }
    assertCovers(t, noSave, (worst) => kernelCodeBytes(worst.project, worst.mapper), 0, 0, 'no Save command');

    // Only the battery-capable boards, SAVE_ENABLED on.
    const withSave = [];
    for (const mapper of batteryMappers) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, true);
      withSave.push({ mapper, project, codeBytes });
    }
    const worstWithSave = withSave.reduce((max, entry) => (entry.codeBytes > max.codeBytes ? entry : max));
    const floorGap = actualWorstBoardGap(noSave, worstWithSave.mapper);
    const ceilingGap = maxPossibleBatteryGap(noSave, batteryMappers);
    assertCovers(
      t,
      withSave,
      (worst) => kernelCodeBytes(worst.project, worst.mapper),
      floorGap,
      ceilingGap,
      'a live Save command'
    );

    // The rule itself, board by board -- see assertAllowanceMatchesMeasuredDeltas's
    // own comment for why this is not redundant with assertCovers above.
    assertAllowanceMatchesMeasuredDeltas(noSave, withSave);

    // The whole point of splitting the reservation: a project with no Save
    // command gets the same budget on every board, battery-capable or not —
    // it must never pay anything toward the save allowance just for
    // targeting a board that could carry one.
    const noSaveBudgets = new Set(noSave.map((entry) => kernelCodeBytes(entry.project, entry.mapper)));
    assert.equal(
      noSaveBudgets.size,
      1,
      `a project with no Save command should get the same budget on every board, got ${[...noSaveBudgets]}`
    );
  }
);
