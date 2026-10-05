// The Say/Move overrun fix's capacity cost, as boundary cases (handoff-next/streamed-worlds-say-move-overrun-impl-report.md).
//
// The fix costs +23 resident kernel-hi bytes, or +17 in the battle bank and +4 kernel-hi when the dialogue code is banked
// (docs/reference-kernel-budget.md). Chris accepted that some projects that built before are now refused, on ONE condition: the
// refusal is checkCapacity's plain-language message naming the Forge, never an assembler bank overflow and never a broken ROM.
// So each boundary is tested in both directions -- exactly at the line (no error, and the assembler agrees by building) and one
// byte over (exactly one capacity error, and buildProject stops with that message):
//
//   1. the battle (overlay) bank, banked placement          -- here (rows O1/O2), per committed variant
//   2. resident kernel-hi, no battle bank to relocate to    -- here (rows R1/R2, an action project)
//   3. banked kernel-hi (the relocated content ceiling)     -- streamworlddialogueboundary.test.js F2 rows 3-8
//   4. the relocation threshold, both sides                 -- F2 rows 1-2 (a roomy battle bank) and here (rows T1-T3: a battle bank
//                                                              that cannot take the overlay)
//   5. the reviewer's counterexample                        -- T3: a resident-at-HEAD 88-actor project, content 1,407, which now relocates,
//                                                              would need 8,190 in a bank that holds 8,172, and must get the message
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildProject } from '../../main/build/pipeline.js';
import { checkCapacity, contentCeilingBytes, residentContentCeilingBytes, streamworldDialogueBanked } from '../../main/build/generate.js';
import { battleRegionBytes, battleRegionCeiling } from '../../main/build/battletables.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { createSpell } from '../../shared/project.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { buildPinching, buildAndBoot, hasSymbol } from '../lib/streamedpinching.js';
import { growTextExactlyBy } from '../lib/exactcontent.js';
import { decorateTerrain } from '../lib/closeoracle.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
const MAPPER = resolveMapper(30);
const CEILING = battleRegionCeiling(MAPPER);
const ACTOR_BYTES = 30; // measured: one more actor adds this to the battle region
const LEVEL_BYTES = 7; // measured: one more highest level adds this

const errorsOf = (p) => checkCapacity(p).problems.filter((x) => x.severity === 'error');
const contentOf = (p) => {
  const c = checkCapacity(p);
  return c.musicBytes + c.sfxBytes + c.textBytes;
};
const regionOf = (p) => battleRegionBytes(p, MAPPER, { streamDialogueBanked: streamworldDialogueBanked(p, MAPPER) });

function addActors(p, n) {
  const template = p.sprites.actors.at(-1);
  for (let i = 0; i < n; i++) p.sprites.actors.push({ ...structuredClone(template), id: p.sprites.actors.length, name: `M${p.sprites.actors.length}` });
}

/** Grows the battle region to EXACTLY `target` bytes: actors (30 each), spells (9 for the first, then 17 each) and the highest
 * level (7 per level) are the three knobs; the figure is verified, never assumed. `actors: false` leaves kernel-lo alone (an actor adds
 * kernel-lo bytes, and the Save variant has 2 spare). */
function fitBattleRegion(p, target, { actors = true } = {}) {
  const d = target - regionOf(p);
  assert.ok(d >= 0, `the starting project (${regionOf(p)}) must sit below ${target}`);
  const spellCost = (n) => (n === 0 ? 0 : 9 + 17 * (n - 1));
  const maxLevelRoom = 99 - p.rpg.maxLevel;
  for (let levels = 0; levels <= Math.min(maxLevelRoom, 60); levels++) {
    for (let spells = 0; spells <= 12; spells++) {
      const left = d - levels * LEVEL_BYTES - spellCost(spells);
      if (left >= 0 && (actors ? left % ACTOR_BYTES === 0 : left === 0)) {
        addActors(p, left / ACTOR_BYTES);
        for (let i = 0; i < spells; i++) p.spells.push(createSpell());
        p.rpg.maxLevel += levels;
        assert.equal(regionOf(p), target, `battle region must land on exactly ${target}`);
        return p;
      }
    }
  }
  throw new Error(`no actor/spell/level combination adds exactly ${d}`);
}

async function built(project) {
  return (await buildAndBoot(project, { boot: false })).symbols;
}

async function assertBuildRefusedWith(project, pattern) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-overrun-cap-'));
  try {
    await assert.rejects(buildProject({ dir, project, log: () => {} }), pattern, 'the build must stop with the capacity message, not at the assembler');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---- O1/O2: the overlay's own bank (banked placement) ----------------------------------------

// (The Save and Move variants are left out: the Save one has 2 spare kernel-lo bytes and the Move one 16, and an actor costs more, so
// neither can be grown to the line; spells plus levels reach only ~600 of the ~1,900 bytes between them and it. The overlay arithmetic
// is one code path in all three; each variant's own banked content boundary is F2 rows 3-8.)
for (const variant of ['nosave']) {
  test(`O1 [${variant}]: the battle region exactly at its ceiling (${CEILING}) with the banked overlay builds`, { skip }, async () => {
    const { project } = buildPinching(variant);
    assert.equal(streamworldDialogueBanked(project, MAPPER), true, 'the committed inventory is banked');
    fitBattleRegion(project, CEILING, { actors: true });
    assert.deepEqual(errorsOf(project), [], 'an exact fit is not refused');
    const symbols = await built(project);
    assert.ok(hasSymbol(symbols, 'sw_dlg_banked_start'), 'the overlay really is in the battle bank');
  });

  test(`O2 [${variant}]: one byte over the battle region's ceiling is refused by checkCapacity, and the build stops with that message`, { skip }, async () => {
    const { project } = buildPinching(variant);
    fitBattleRegion(project, CEILING + 1, { actors: true });
    const errors = errorsOf(project);
    assert.equal(errors.length, 1, `exactly one refusal expected: ${errors.map((e) => e.message).join(' | ')}`);
    assert.equal(errors[0].where, 'Build & Play', 'the refusal names the Forge that shows the figure');
    assert.match(errors[0].message, new RegExp(`needs ${CEILING + 1} bytes there but the bank holds ${CEILING}`));
    await assertBuildRefusedWith(project, new RegExp(`needs ${CEILING + 1} bytes there but the bank holds ${CEILING}`));
  });
}

// ---- R1/R2: resident kernel-hi with no battle bank to relocate to (an action project) --------

function actionProject() {
  const p = createStreamedProject({ gameType: 'action', dialogue: ['Hello there.'] });
  return p;
}

function authorActionContent(total) {
  const p = actionProject();
  const filler = { op: 'say', text: 'Filler' };
  p.maps[0].screens[0].entities[0].props.event.pages[0].commands.push(filler);
  growTextExactlyBy(p, filler, total - contentOf(p));
  assert.equal(contentOf(p), total);
  return p;
}

test('R1: an action project with content exactly at the resident ceiling builds (it has no battle bank, so there is nowhere else to go)', { skip }, async () => {
  const ceiling = residentContentCeilingBytes(actionProject());
  const p = authorActionContent(ceiling);
  assert.equal(streamworldDialogueBanked(p, MAPPER), false, 'no battle bank: never relocated');
  assert.equal(contentCeilingBytes(p), ceiling);
  assert.deepEqual(errorsOf(p), []);
  const symbols = await built(p);
  assert.equal(hasSymbol(symbols, 'sw_dlg_banked_start'), false);
});

test('R2: one byte over the resident ceiling is refused with the Sound Forge / Map Forge message, exactly 1 over, and the build stops there', { skip }, async () => {
  const ceiling = residentContentCeilingBytes(actionProject());
  const p = authorActionContent(ceiling + 1);
  const errors = errorsOf(p);
  assert.equal(errors.length, 1, errors.map((e) => e.message).join(' | '));
  assert.ok(['Sound Forge', 'Map Forge'].includes(errors[0].where), errors[0].where);
  assert.match(errors[0].message, new RegExp(`must fit in ${ceiling} bytes`));
  await assertBuildRefusedWith(p, /Together they must fit in \d+ bytes/);
});

// ---- T1-T3: the relocation threshold, for a battle bank that cannot take the overlay ----------

// The nosave resident twin with 88 actors: its battle region is 6,788 at the old resident ceiling, so a relocation there
// needs 6,788 + the whole 1,402-byte overlay = 8,190 > 8,172. Before the fix its resident ceiling was 1,407 (it built resident);
// now the ceiling is 1,384, so the last 23 content bytes tip it over the line.
function crowdedTwin(content) {
  const { project: p, slot } = buildPinching('nosave', { twin: true });
  addActors(p, 88 - p.sprites.actors.length);
  const filler = { op: 'say', text: 'Filler' };
  p.maps[0].screens[3].entities[slot].props.event.pages[0].commands.push({ op: 'end' }, filler);
  for (const opening of ['Filler', 'Filler a', 'Filler a b', 'Filler a b c']) {
    filler.text = opening;
    try {
      growTextExactlyBy(p, filler, content - contentOf(p));
      return p;
    } catch (e) {
      if (opening === 'Filler a b c') throw e;
    }
  }
  return p;
}

test('T1: the crowded twin with content exactly at the new resident ceiling stays resident and builds (its battle bank is untouched)', { skip }, async () => {
  const probe = crowdedTwin(1000);
  const ceiling = residentContentCeilingBytes(probe);
  const p = crowdedTwin(ceiling);
  assert.equal(streamworldDialogueBanked(p, MAPPER), false, 'content == the resident ceiling fits it');
  assert.equal(p.sprites.actors.length, 88);
  assert.deepEqual(errorsOf(p), []);
  assert.ok(!hasSymbol(await built(p), 'sw_dlg_banked_start'));
});

test('T2: one byte over the resident ceiling makes the crowded twin relocate; the whole overlay does not fit its battle bank, so checkCapacity refuses with the both-banks message and the build stops there', { skip }, async () => {
  const ceiling = residentContentCeilingBytes(crowdedTwin(1000));
  const p = crowdedTwin(ceiling + 1);
  assert.equal(streamworldDialogueBanked(p, MAPPER), true, 'one byte over: relocates');
  const need = regionOf(p);
  assert.ok(need > CEILING, `the whole overlay must not fit: ${need} vs ${CEILING}`);
  const errors = errorsOf(p);
  assert.equal(errors.length, 1, errors.map((e) => e.message).join(' | '));
  assert.equal(errors[0].where, 'Build & Play');
  assert.match(errors[0].message, new RegExp(`its dialogue code moves into the battle system.s program bank -- and the battle system, with that dialogue code, needs ${need} bytes there but the bank holds ${CEILING}`));
  await assertBuildRefusedWith(p, /with that dialogue code, needs \d+ bytes there/);
});

test("T3: the review's counterexample -- a project that built resident at content 1,407 (battle bank 6,788) is now refused with the capacity message, needing 8,190 in a bank that holds 8,172", { skip }, async () => {
  const p = crowdedTwin(1407);
  assert.ok(residentContentCeilingBytes(p) < 1407, 'the resident ceiling fell below the old edge');
  assert.equal(streamworldDialogueBanked(p, MAPPER), true);
  assert.equal(regionOf(p), 8190, 'the whole 1,402-byte overlay on top of 6,788');
  assert.ok(regionOf(p) - CEILING === 18, 'by 18 (it was 25 before phase 3b S0 shortened the streamed backdrop lookups by 7)');
  const errors = errorsOf(p);
  assert.equal(errors.length, 1, errors.map((e) => e.message).join(' | '));
  assert.match(errors[0].message, /needs 8190 bytes there but the bank holds 8172/);
  await assertBuildRefusedWith(p, /needs 8190 bytes there but the bank holds 8172/);
});

// keep decorateTerrain imported for symmetry with the close oracle's projects (a decorated project must stay capacity-neutral)
test('a decorated project costs the same bytes as the plain one (terrain ids and tile numbers are not sized)', () => {
  const a = createStreamedProject({ gameType: 'rpg', gridW: 3, gridH: 2, dialogue: ['Hi.'] });
  const before = checkCapacity(a);
  decorateTerrain(a);
  const after = checkCapacity(a);
  assert.equal(after.textBytes, before.textBytes);
  assert.equal(after.musicBytes, before.musicBytes);
});
