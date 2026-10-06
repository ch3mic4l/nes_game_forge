// Large streamed worlds (ROADMAP item 15), phase 2 slice 10b, review round 1 finding F2 -- the RPG
// boundary rows the relocation changed. A streamed RPG whose music+sfx+dialogue fit the RESIDENT
// kernel-hi ceiling keeps the dialogue overlay resident; one byte more and it relocates into the
// battle bank, where the ceiling is larger (generate.js streamworldDialogueBanked is the one
// predicate). This file pins both edges, byte for byte, in the three variants that change the
// reservation:
//
//   row 1  no-Save  content == resident ceiling      -> stays resident, builds
//   row 2  no-Save  content == resident ceiling + 1  -> relocates, builds
//   row 3  no-Save  content == relocated ceiling     -> builds          row 4  +1 -> refused
//   row 5  Save     content == relocated ceiling     -> builds          row 6  +1 -> refused
//   row 7  Move     content == relocated ceiling     -> builds          row 8  +1 -> refused
//
// Every content total is AUTHORED, as a literal in CEILINGS below (measured on the stock tree with
// nesasm and pinned so a legitimately re-measured allowance must be edited here on purpose), and
// asserted -- against the ceiling functions and against the compiled content itself -- BEFORE any
// build. The helper that reaches a total (growTextExactlyBy) asserts it landed exactly on it; no
// step of it consults the predicate or the refusal, so an implementation cannot decide where a row
// ends by refusing. The action boundary coverage stays in streamedceiling.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  checkCapacity,
  contentCeilingBytes,
  residentContentCeilingBytes,
  streamworldDialogueBanked,
  streamworldHiBytesFor
} from '../../main/build/generate.js';
import { buildProject } from '../../main/build/pipeline.js';
import { growTextExactlyBy, parseCeilingMessage } from '../lib/exactcontent.js';
import { OBSERVER_SCREEN, buildAndBoot, buildPinching, hasSymbol } from '../lib/streamedpinching.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';

// Authored totals (bytes of music + sfx + dialogue). resident = the ceiling with the overlay in
// kernel-hi; relocated = the ceiling once it moved into the battle bank. Only the no-Save resident
// edge is a named row (the predicate does not depend on the variant), so only it is pinned.
//
// Phase 3a slice S1 moved every one of these DOWN by exactly 231 bytes (before -> after: no-Save
// resident 1560 -> 1329, relocated 2802 -> 2571; Save relocated 2687 -> 2456; Move relocated
// 2681 -> 2450). Cause: a project that places an actor on a streamed screen (every project here)
// now assembles the per-actor projection, whose kernel-hi cost STREAMWORLD_ENTITY_PROJ_KERNEL_HI_
// ALLOWANCE (395) replaces the 164 bytes of B1's per-tile draw_one_entity_show_sw it displaces:
// 395 - 164 = 231 fewer bytes of music + sfx + dialogue fit beside the resident set. The Flash guard
// (10 bytes) does not appear here: these projects have no Flash.
//
// Phase 3a slice S3a moved ONLY the Move row UP by exactly 56 bytes (relocated 2450 -> 2506): the Move's
// kernel-hi allowance STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE went 76 -> 20 when the Move's private probe pair
// was deleted for the shared sw_pstep_* driver. The no-Move rows carry no such allowance and do not move.
//
// Phase 3a slice S3a.5 moved EVERY one of these UP by exactly 78 bytes (no-Save resident 1329 -> 1407, relocated
// 2571 -> 2649; Save relocated 2456 -> 2534; Move relocated 2506 -> 2584). Cause: STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE
// went 1102 -> 1024 when sw_camera_window_recompute's two repeated-subtract loops became closed forms. Every ceiling
// is BANK_SIZE (8192) - 64 - streamworldHiBytesFor, and that sum holds the window term exactly once in every variant
// (relocation removes the dialogue mapper/lifecycle/relocated terms and adds the banked shim, never the window term):
// 8128 - 6799 = 1329 -> 8128 - 6721 = 1407; 8128 - 5557 = 2571 -> 8128 - 5479 = 2649; 8128 - 5672 = 2456 -> 8128 - 5594 =
// 2534; 8128 - 5622 = 2506 -> 8128 - 5544 = 2584 (each reservation 78 smaller).
//
// Phase 3a slice S3b moved ONLY the Move row DOWN, by exactly 188 bytes (relocated 2584 -> 2396). Cause: the Move's own kernel-hi
// allowance (STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE, 20: the four sw_step_nocross guards) is deleted with the ownership stop, and the talker
// bookkeeping a streamed Move now carries (TALKER_KERNEL_HI_ALLOWANCE 196 + TALKER_CROSS_CALLS_KERNEL_HI_ALLOWANCE 12 = 208) replaces it:
// 208 - 20 = 188 fewer bytes of music + sfx + dialogue fit beside the resident set (8128 - 5544 = 2584 -> 8128 - 5732 = 2396). The rows
// without a Move carry neither term and do not move.
//
// The Say/Move overrun fix then moved EVERY one of these DOWN: the resident ceiling by exactly 23 (1407 -> 1384) and each
// relocated ceiling by exactly 4 (2649 -> 2645, 2534 -> 2530, 2396 -> 2392). Cause: the text-box close now resolves each screen
// run once through the bounded sw_read_run chunk, which costs 6 resident bytes (STREAMWORLD_DIALOGUE_READ_CHUNK_KERNEL_HI_ALLOWANCE)
// plus 17 more in the close row itself (the lifecycle/terrain/consumer allowance 523/520 -> 540/537). A resident build charges all
// 23; a relocated build keeps only the chunk read's 6 and the shim's own change (113 -> 111) resident, so it is 4 bytes down, and its
// battle-bank overlay grew 17 (STREAMWORLD_DIALOGUE_BATTLE_ALLOWANCE 1385 -> 1402). The figures below are measured, not derived.
//
// The Continue-at-local-y fix then moved ONLY the Save row DOWN, by exactly 24 (relocated 2530 -> 2506). Cause: a streamed Save build now carries
// sw_save_streamed_screen (STREAMWORLD_SAVE_RANGE_KERNEL_HI_ALLOWANCE, 24 kernel-hi bytes); the no-Save and Move rows carry no Save and do not move.
const CEILINGS = {
  nosave: { resident: 1384, relocated: 2645 },
  save: { relocated: 2506 },
  move: { relocated: 2392 }
};
const VARIANT_NAME = { nosave: 'no-Save', save: 'Save', move: 'Move' };

const contentOf = (project) => {
  const cap = checkCapacity(project);
  return cap.musicBytes + cap.sfxBytes + cap.textBytes;
};
const errorsOf = (project) => checkCapacity(project).problems.filter((x) => x.severity === 'error');

/**
 * The stock pinching inventory (or its resident twin) with one filler `say` appended to the
 * observed NPC's page and grown until the compiled content is EXACTLY `total`. The total is
 * asserted before returning; nothing here builds.
 */
function authorContent(variant, { twin, total }) {
  const { project, slot } = buildPinching(variant, { twin });
  const before = contentOf(project);
  assert.ok(before < total, `${variant}: the starting inventory (${before}) must sit below the authored total ${total}`);
  const page = project.maps[0].screens[OBSERVER_SCREEN].entities[slot].props.event.pages[0];
  const filler = { op: 'say', text: 'Filler' };
  page.commands.push(filler);
  // growTextExactlyBy grows in words capped at WORD_CAP, so a target whose remaining distance comes out as
  // exactly 1 byte with the last word already full cannot be reached from that starting word. A different
  // opening (more short words before the grown one) moves where the last word ends; try a few and keep the first that lands (each lands EXACTLY or
  // throws -- the assertion below it is unchanged). Which one lands depends on the starting inventory's own size,
  // which a kernel-lo change (and so a trimmed placed-actor count) moves.
  let landed = false;
  let lastError;
  for (const opening of ['Filler', 'Filler a', 'Filler a b', 'Filler a b c', 'Filler a b c d']) {
    filler.text = opening;
    try {
      growTextExactlyBy(project, filler, total - contentOf(project));
      landed = true;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!landed) throw lastError;
  assert.equal(contentOf(project), total, `${variant}: authored content must be exactly ${total} before any build`);
  return project;
}

/** Built with no boot; returns the game.fns text. A capacity refusal or assembler failure throws. */
async function buildSymbols(project) {
  return (await buildAndBoot(project, { boot: false })).symbols;
}

const report = (row, variant, project, extra = '') =>
  console.log(
    `S10B-F2 row ${row} [${VARIANT_NAME[variant]}]: content ${contentOf(project)} ` +
      `resident ceiling ${residentContentCeilingBytes(project)} relocated/active ceiling ${contentCeilingBytes(project)} ` +
      `banked ${streamworldDialogueBanked(project)}${extra}`
  );

// ---- rows 1-2: the resident edge (no-Save) --------------------------------------------------

test('F2 row 1 [no-Save]: content exactly at the resident ceiling (1384) stays resident and builds', { skip }, async () => {
  const project = authorContent('nosave', { twin: true, total: CEILINGS.nosave.resident });
  assert.equal(residentContentCeilingBytes(project), CEILINGS.nosave.resident, 'the resident ceiling is the authored figure');
  assert.equal(streamworldDialogueBanked(project), false, 'content == the resident ceiling fits it: the overlay must stay resident');
  assert.equal(contentCeilingBytes(project), residentContentCeilingBytes(project), 'a resident build is held to the resident ceiling');
  assert.deepEqual(errorsOf(project), [], 'an exact resident fit is not refused');
  const symbols = await buildSymbols(project);
  assert.equal(hasSymbol(symbols, 'sw_dlg_banked_start'), false, 'the built ROM must carry no banked overlay');
  report(1, 'nosave', project, ' -> stays resident, builds');
});

test('F2 row 2 [no-Save]: content one byte over the resident ceiling (1385) relocates and builds under the relocated ceiling', { skip }, async () => {
  const project = authorContent('nosave', { twin: true, total: CEILINGS.nosave.resident + 1 });
  assert.equal(residentContentCeilingBytes(project), CEILINGS.nosave.resident, 'the resident ceiling is the authored figure');
  assert.equal(streamworldDialogueBanked(project), true, 'content one byte over the resident ceiling must relocate');
  assert.equal(contentCeilingBytes(project), CEILINGS.nosave.relocated, 'relocation buys the authored relocated ceiling');
  assert.deepEqual(errorsOf(project), [], 'the relocated project fits its larger ceiling');
  const symbols = await buildSymbols(project);
  assert.equal(hasSymbol(symbols, 'sw_dlg_banked_start'), true, 'the built ROM must carry the banked overlay');
  report(2, 'nosave', project, ' -> relocates, builds');
});

// ---- rows 3-8: the relocated edge, per variant ----------------------------------------------

const ROWS = [
  { variant: 'nosave', exactRow: 3, overRow: 4 },
  { variant: 'save', exactRow: 5, overRow: 6 },
  { variant: 'move', exactRow: 7, overRow: 8 }
];

for (const { variant, exactRow, overRow } of ROWS) {
  const relocated = CEILINGS[variant].relocated;

  test(`F2 row ${exactRow} [${VARIANT_NAME[variant]}]: content exactly at the relocated ceiling (${relocated}) builds`, { skip }, async () => {
    const project = authorContent(variant, { twin: false, total: relocated });
    assert.equal(streamworldDialogueBanked(project), true, 'the exact-fit project is relocated');
    assert.equal(contentCeilingBytes(project), relocated, 'the relocated ceiling is the authored figure');
    assert.deepEqual(errorsOf(project), [], 'an exact relocated fit is not refused');
    const symbols = await buildSymbols(project);
    assert.equal(hasSymbol(symbols, 'sw_dlg_banked_start'), true, 'the ROM assembled with the banked overlay at the exact ceiling');
    report(exactRow, variant, project, ' -> builds');
  });

  test(`F2 row ${overRow} [${VARIANT_NAME[variant]}]: content one byte over the relocated ceiling (${relocated + 1}) is refused, over by exactly 1`, { skip }, async (t) => {
    const project = authorContent(variant, { twin: false, total: relocated + 1 });
    assert.equal(streamworldDialogueBanked(project), true, 'the over-by-one project is relocated');
    assert.equal(contentCeilingBytes(project), relocated, 'the relocated ceiling is the authored figure');
    const errors = errorsOf(project);
    assert.equal(errors.length, 1, `exactly one refusal expected, got: ${errors.map((e) => e.message).join(' | ')}`);
    const refusal = errors[0];
    const fields = parseCeilingMessage(refusal.message);
    assert.equal(fields.musicBytes + fields.sfxBytes + fields.textBytes, relocated + 1, 'the refusal reports the authored total');
    assert.equal(fields.ceiling, relocated, 'the refusal quotes the relocated ceiling, not the resident one');
    assert.equal(fields.overBy, 1, 'over by exactly one byte');
    assert.equal(fields.streamworldHiBytes, streamworldHiBytesFor(project), 'the refusal reports the relocated reservation');
    assert.ok(['Sound Forge', 'Map Forge'].includes(refusal.where), `the refusal names the Forge that owns the content: ${refusal.where}`);
    // ...and the build itself stops there, with that message, rather than assembling a ROM.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-s10b-boundary-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await assert.rejects(buildProject({ dir, project }), /Together they must fit in \d+ bytes/);
    report(overRow, variant, project, ` -> refused: over by ${fields.overBy}, ceiling ${fields.ceiling}, reservation ${fields.streamworldHiBytes}, where ${refusal.where}`);
  });
}
