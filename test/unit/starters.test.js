// ROADMAP item 8 (starter projects), phase 1: the catalog, the IPC rename and
// unknown-id handling, and the picker's own structural proof
// (docs/design-starter-projects.md §3, §4, §6, §11 tests 1, 2, 3, 4, 13).
// Tests 5 and 16a live in main/smoke.js, not here (§11's own split).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STARTERS } from '../../shared/starters/index.js';
import {
  createProject,
  validateProject,
  GAME_TYPES,
  LIMITS,
  PLAYER_TILES,
  CHOICE_LIMITS,
  planLibraryImport,
  applyPlannedProject,
  effectiveTrigger,
  compiledPages,
  liveCommands,
  reconcileCartridge
} from '../../shared/project.js';
import { LIBRARY_ENTRIES } from '../../shared/library/index.js';
import { createProjectAt, loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { checkCapacity } from '../../main/build/generate.js';
import { resolveMapper, chrPayloadRegions, NESASM_BANK_BYTES } from '../../shared/cartridge.js';
import { BLANK_TILE } from '../../shared/chr.js';
import { HERO_IDLE_TILES, HERO_WALK_TILES } from '../../shared/starters/figures.js';
import { screenFromArt as screenFromArtViaTools } from '../../tools/sample-common.js';
import { screenFromArt as screenFromArtViaStarters } from '../../shared/starters/authoring.js';
import { nodeDomViolations, fixtureReferences, literalOccurrences } from '../lib/sourcescan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- 1: the catalog itself -------------------------------------------------

test('1: the two blank starters are byte-for-byte deep-equal to createProject, with every literal expectation pinned rather than read off the entry under test', () => {
  const blankAction = STARTERS.find((s) => s.id === 'blank-action');
  const blankRpg = STARTERS.find((s) => s.id === 'blank-rpg');
  assert.ok(blankAction, 'STARTERS must contain a "blank-action" entry');
  assert.ok(blankRpg, 'STARTERS must contain a "blank-rpg" entry');

  // Literal on both sides -- a build() that sets or omits a field createProject
  // itself does not (a stray titleMap, a palette tweak) fails here even if the
  // catalog's own gameType field agrees with the bug.
  assert.deepStrictEqual(blankAction.build('X'), createProject('X', 'action'));
  assert.deepStrictEqual(blankRpg.build('X'), createProject('X', 'rpg'));

  // The catalog's own gameType metadata, checked independently of what
  // build() actually produces -- a catalog entry whose gameType field
  // disagrees with its own build output is a real, separate bug the
  // deep-equal checks above cannot see (design §11 test 1's own round-3
  // correction: nothing in this codebase reads starter.gameType today, but
  // it is metadata the picker's own hint text depends on being right).
  assert.equal(blankAction.gameType, 'action');
  assert.equal(blankRpg.gameType, 'rpg');

  const ids = STARTERS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'every STARTERS id must be unique');
  for (const starter of STARTERS) {
    assert.equal(typeof starter.id, 'string');
    assert.equal(typeof starter.label, 'string');
    assert.equal(typeof starter.hint, 'string');
    assert.ok(GAME_TYPES.some((g) => g.id === starter.gameType), `gameType "${starter.gameType}" must be a real GAME_TYPES id`);
    assert.equal(typeof starter.build, 'function');
  }
});

// --- 2: the picker is a real consumer of the catalog, not a second list ----

test('2: renderer/app.js imports STARTERS, chooseStarter references it, no starter label lives in a second string/template literal anywhere in the file, and chooseGameType is gone', () => {
  const text = fsSync.readFileSync(path.join(ROOT, 'renderer/app.js'), 'utf8');

  // (a) the import itself.
  assert.match(
    text,
    /import\s*\{\s*STARTERS\s*\}\s*from\s*'\.\.\/shared\/starters\/index\.js';/,
    'renderer/app.js must import STARTERS from ../shared/starters/index.js'
  );

  // (b) no literal label anywhere in the file, in ANY of the three quote
  // kinds -- via the scanner's own literalOccurrences, not a raw
  // text.includes(), which only ever checked the single- and double-quoted
  // spellings and so missed a template-literal duplicate list entirely
  // (`const labels = [\`Blank action\`, \`Blank RPG\`]; ... labels[index]`
  // passed every prior version of this test). Not scoped to chooseStarter's
  // own body, so a second, wired-correctly label list declared elsewhere
  // (and merely rendered from inside chooseStarter) still fails this
  // (design §11 test 2's own round-3 widening).
  for (const starter of STARTERS) {
    const occurrences = literalOccurrences(text, starter.label);
    assert.deepEqual(
      occurrences,
      [],
      `the literal label ${JSON.stringify(starter.label)} must not appear in any string/template literal in renderer/app.js (found ${JSON.stringify(occurrences)})`
    );
  }

  // (c) chooseStarter's own body actually consumes the import (proves (a)
  // is not an unused import) -- extracted structurally, the same
  // "read the source, don't trust a hand-written summary" idiom
  // test/unit/playerparts.test.js:380-394 already uses for a different
  // delegation.
  // The lazy `[\s\S]*?` stops at the first column-0 `}` -- chooseStarter's
  // own closing brace, since every inner brace in its body is indented --
  // with no assumption about what is declared next, so a harmless
  // reordering of renderer/app.js cannot fail this for a reason unrelated
  // to what it checks.
  const fnMatch = text.match(/function chooseStarter\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find a top-level chooseStarter() function in renderer/app.js');
  assert.match(fnMatch[0], /\bSTARTERS\b/, "chooseStarter's own body must reference STARTERS");

  // (d) the old function is really gone, not just unused.
  assert.doesNotMatch(text, /\bchooseGameType\b/);
});

// --- 3: every starter builds and validates clean ---------------------------

test('3: every STARTERS entry\'s build("X") returns without throwing and validates with zero errors', () => {
  for (const starter of STARTERS) {
    let project;
    assert.doesNotThrow(() => {
      project = starter.build('X');
    }, `starter "${starter.id}" threw while building`);
    const errors = validateProject(project).filter((p) => p.severity === 'error');
    assert.deepEqual(errors, [], `starter "${starter.id}" must validate with zero errors`);
  }
});

// --- 4: createProjectAt's own starterId resolution and unknown-id refusal --

test('4: createProjectAt resolves starterId before touching the filesystem, refuses an unknown id, and keeps its default', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-starters-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  // An unknown id must leave the directory untouched entirely -- not even
  // created -- rather than a fallback to blank-action.
  const missing = path.join(base, 'missing');
  await assert.rejects(createProjectAt(missing, 'X', 'no-such-starter'), /Unknown starter "no-such-starter"/);
  const missingExists = await fs.access(missing).then(
    () => true,
    () => false
  );
  assert.equal(missingExists, false, 'an unknown starterId must not create the target directory');

  // A real, non-default id.
  const rpgDir = path.join(base, 'rpg');
  await createProjectAt(rpgDir, 'X', 'blank-rpg');
  const rpgProject = await loadProject(rpgDir);
  assert.equal(rpgProject.project.gameType, 'rpg');

  // The omitted-argument default keeps the two untouched main/smoke.js call
  // sites working (neither passes a third argument today).
  const defaultDir = path.join(base, 'default');
  await createProjectAt(defaultDir, 'X');
  const defaultProject = await loadProject(defaultDir);
  assert.equal(defaultProject.project.gameType, 'action');
});

// Review-fix slice A, item 6: createProjectAt used to refuse a non-empty
// destination only when it was NOT already a project -- so pointing New
// Project at a folder that already held a project silently overwrote it.
// assertEmptyProjectDestination (main/project-io.js) now refuses ANY
// non-empty destination, with two distinct messages.
test('4b: createProjectAt refuses a destination that already contains a project, leaving its data untouched', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-starters-existing-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const dir = path.join(base, 'existing');
  await createProjectAt(dir, 'Original', 'blank-action');
  const originalTiles = await fs.readFile(path.join(dir, 'tiles', 'tilesets.json'), 'utf8');

  await assert.rejects(createProjectAt(dir, 'Overwriter', 'blank-rpg'), /already contains a project/);

  const tilesAfter = await fs.readFile(path.join(dir, 'tiles', 'tilesets.json'), 'utf8');
  assert.equal(tilesAfter, originalTiles, 'the original project’s tile data must be untouched after a refused overwrite');
  const reopened = await loadProject(dir);
  assert.equal(reopened.project.gameType, 'action', 'the original project must still be the one on disk, not the rejected overwrite');
});

test('4c: createProjectAt still refuses a destination holding unrelated (non-project) files, with a distinct message from 4b', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-starters-junk-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const dir = path.join(base, 'junk');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'notes.txt'), 'unrelated file');

  await assert.rejects(createProjectAt(dir, 'X', 'blank-action'), /already contains other files/);
  const stillThere = await fs.readFile(path.join(dir, 'notes.txt'), 'utf8');
  assert.equal(stillThere, 'unrelated file');
});

// --- 6: every starter assembles into a real ROM ----------------------------

// Tile bytes: main/build/generate.js's own per-tileset CHR emission
// (:2270-2273) -- `chr.set(encodeTiles(padTable(source.background)), 0)`
// then `chr.set(encodeTiles(padTable(source.sprites)), CHR_BANK_BYTES / 2)`
// -- background fills the first half of the 8 KB background+sprites
// payload, sprites the second, on both kinds of board. `shared/chr.js`'s
// TILE_BYTES (16) is one tile's own byte count.
const CHR_BANK_BYTES = 8192;
const CHR_TILE_BYTES = 16;

/**
 * The file offset of tileset 0's own sprite half in the assembled `.nes` at
 * `romBytes`. Two boards, two layouts -- computing this by "16-byte header
 * then PRG then CHR" alone is wrong for the second one, and silently so: an
 * out-of-range read comes back `undefined`, and `undefined !== 0` is true.
 *
 * - CHR-ROM: 16-byte iNES header, then PRG (`mapper.prgUnits * 16384`),
 *   then tileset 0's own 8 KB CHR bank -- sprites at its own midpoint.
 * - CHR-RAM (`mapper.chrRam`, e.g. UNROM 512 -- never tested by `mapper.id`
 *   directly, since the flag is what every other CHR-RAM-aware call site in
 *   this codebase reads): there is no CHR-ROM at all. Each tileset's own
 *   8 KB payload streams into program space instead, one whole switchable-
 *   window region per tileset, claimed off the front by `chrPayloadRegions`
 *   (shared/cartridge.js:594-598, built on `prgLayout`'s own region list,
 *   shared/cartridge.js:499-513). generate.js's own CHR-RAM emission
 *   (main/build/generate.js:2302-2316) `.incbin`s the IDENTICAL
 *   background+sprites payload (:2270-2273) whole into that region's own
 *   nesasm bank at `.org $8000`/`$A000` -- bank-relative offset 0 either
 *   way (CLAUDE.md's own "nesasm places a bank's contents at file offset
 *   `address & (bank size - 1)`") -- so the payload starts at file offset
 *   16 + `region.nesasmBank * NESASM_BANK_BYTES` (`prgLayout`'s own bank
 *   unit), sprites at its own `+ CHR_BANK_BYTES / 2` exactly as on a
 *   CHR-ROM board. Cross-checked against a real build: this computes 4112
 *   for the overworld starter on UNROM 512, the figure measured directly
 *   against a real ROM before this fix.
 */
function spriteTableOffset(project, romBytes) {
  const mapper = resolveMapper(project.cartridge.mapper);
  let offset;
  if (mapper.chrRam) {
    const region = chrPayloadRegions(mapper, project.tilesets.length)[0];
    assert.ok(region, 'spriteTableOffset: no chrPayloadRegions entry for tileset 0 on a CHR-RAM board');
    offset = 16 + region.nesasmBank * NESASM_BANK_BYTES + CHR_BANK_BYTES / 2;
  } else {
    offset = 16 + mapper.prgUnits * 16384 + CHR_BANK_BYTES / 2;
  }
  // Bounds first, before any byte is ever inspected: an out-of-range
  // offset must fail loudly here, never silently read back `undefined`
  // and compare unequal to 0.
  assert.ok(
    offset + CHR_BANK_BYTES / 2 <= romBytes.length,
    `spriteTableOffset: computed offset ${offset} (sprite half, ${CHR_BANK_BYTES / 2} bytes) exceeds the ROM's ` +
      `own length ${romBytes.length}`
  );
  return offset;
}

/** The 16 bytes of tile `tileIndex` at `spriteOffset` in `romBytes` -- throws rather than reading past the end. */
function tileBytes(romBytes, spriteOffset, tileIndex) {
  const start = spriteOffset + tileIndex * CHR_TILE_BYTES;
  assert.ok(
    start + CHR_TILE_BYTES <= romBytes.length,
    `tileBytes: tile ${tileIndex} at offset ${start} (${CHR_TILE_BYTES} bytes) exceeds the ROM's own length ${romBytes.length}`
  );
  return romBytes.subarray(start, start + CHR_TILE_BYTES);
}

const tileHasNonZeroByte = (romBytes, spriteOffset, tileIndex) =>
  [...tileBytes(romBytes, spriteOffset, tileIndex)].some((byte) => byte !== 0);

test('6: every starter builds into a real ROM (buildProject/inspectRom) in a fresh mkdtemp directory, and every content starter\'s own build log AND assembled ROM bytes name the real player-frame content', async (t) => {
  const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
  assert.ok(hasNesasm, 'nesasm must be present on PATH -- this test must not silently skip when it is missing');

  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-starters-build-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const contentStarters = new Set(STARTERS.filter((s) => !s.id.startsWith('blank-')).map((s) => s.id));

  for (const starter of STARTERS) {
    const dir = path.join(base, starter.id);
    await saveProject(dir, starter.build('X'));
    const reloaded = await loadProject(dir);
    const lines = [];
    let buildResult;
    await assert.doesNotReject(async () => {
      buildResult = await buildProject({ dir, project: reloaded, log: (line) => lines.push(line) });
    }, `starter "${starter.id}" failed to build`);

    // The compiled-side proof that the eight authored player frames really
    // reached the build and the other 24 really fell back to the
    // placeholder -- generate.js's own log line (main/build/generate.js,
    // the per-slot player stamp), matched on the real number, not just the
    // phrase: a starter whose playerTiles held 24 blank strings instead of
    // 24 nulls would never log this line at all (a non-null canonical
    // string is never replaced by the placeholder), which is exactly the
    // bug this line exists to catch.
    if (contentStarters.has(starter.id)) {
      const expectedCount = PLAYER_TILES - 8;
      const expected = `note: ${expectedCount} of the ${PLAYER_TILES} player sprite slots used the placeholder.`;
      assert.ok(
        lines.includes(expected),
        `starter "${starter.id}": expected the build log to contain ${JSON.stringify(expected)}, got ${JSON.stringify(lines)}`
      );

      // The same claim, proven against the real assembled ROM bytes rather
      // than only the pre-build JS object: a starter whose playerTiles[0..7]
      // held BLANK_TILE strings (a real string, so the shape test above
      // alone would not catch it) would compile eight fully transparent
      // frames -- 16 zero bytes each -- with no error and no different log
      // line at all.
      const romBytes = await fs.readFile(buildResult.romPath);
      const spriteOffset = spriteTableOffset(reloaded, romBytes);
      for (let i = 0; i < 8; i++) {
        assert.ok(
          tileHasNonZeroByte(romBytes, spriteOffset, i),
          `starter "${starter.id}": tileset 0's own sprite tile ${i} in the assembled ROM is sixteen zero bytes (the frame is blank)`
        );
      }
      // Control: a null-backed slot (tile 8) resolves to the build-time
      // placeholder -- real, non-blank art too -- so this is not merely
      // "some bytes somewhere in the ROM happen to be non-zero".
      assert.ok(
        tileHasNonZeroByte(romBytes, spriteOffset, 8),
        `starter "${starter.id}": the placeholder-backed sprite tile 8 is unexpectedly sixteen zero bytes`
      );
    }
  }

  // A real control exercising the CHR-RAM branch of spriteTableOffset
  // above, not only its CHR-ROM one: the overworld starter again, switched
  // to UNROM 512 (mapper 30, `mapper.chrRam`) -- a project variant built
  // into its own mkdtemp directory, never a fixture (CLAUDE.md's own "no
  // test may mutate any of the six [fixtures] -- variants go to mkdtemp
  // directories"). reconcileCartridge is the documented way to change a
  // project's mapper (CLAUDE.md's own `reconcileCartridge` passage): set
  // `cartridge.mapper` first, then call it in the same step so tileset
  // count and mirroring are brought back into agreement, exactly as the UI
  // would in one commit.
  {
    const unromProject = STARTERS.find((s) => s.id === 'overworld').build('X');
    unromProject.cartridge.mapper = 30;
    reconcileCartridge(unromProject);

    const dir = path.join(base, 'overworld-unrom512');
    await saveProject(dir, unromProject);
    const reloaded = await loadProject(dir);
    let buildResult;
    await assert.doesNotReject(async () => {
      buildResult = await buildProject({ dir, project: reloaded });
    }, 'overworld on UNROM 512 failed to build');

    const romBytes = await fs.readFile(buildResult.romPath);
    const spriteOffset = spriteTableOffset(reloaded, romBytes);
    for (let i = 0; i < 8; i++) {
      assert.ok(
        tileHasNonZeroByte(romBytes, spriteOffset, i),
        `overworld on UNROM 512: tileset 0's own sprite tile ${i} in the assembled ROM is sixteen zero bytes (the frame is blank)`
      );
    }
    assert.ok(
      tileHasNonZeroByte(romBytes, spriteOffset, 8),
      'overworld on UNROM 512: the placeholder-backed sprite tile 8 is unexpectedly sixteen zero bytes'
    );
  }
});

// --- playerTiles' own shape: the 24 unauthored frames are `null`, not a ----
// --- blank string ------------------------------------------------------------

// generateAssets (main/build/generate.js) only substitutes its placeholder
// for `canonical !== null` -- a BLANK_TILE *string* reads as "authored
// blank" and compiles to zero CHR bytes, so a starter whose playerTiles
// held 24 blank strings instead of 24 nulls would make the player vanish
// outright the moment they faced anything but down. And "a string" alone is
// not "authored": BLANK_TILE (a real, valid string) at entries 0-7 would
// pass a bare `typeof === 'string'` check while compiling to a fully
// transparent frame -- so entries 0-7 are checked against the real,
// shared figure's own tile content directly, not merely their type.
test('every content starter\'s own playerTiles holds the two authored frames, then exactly `null` (not a blank string) for the 24 unauthored ones', () => {
  const contentStarters = STARTERS.filter((s) => !s.id.startsWith('blank-'));
  assert.ok(contentStarters.length > 0, 'expected at least one content starter');
  const expectedAuthored = [...HERO_IDLE_TILES, ...HERO_WALK_TILES];
  for (const starter of contentStarters) {
    const project = starter.build('X');
    const playerTiles = project.sprites.playerTiles;
    assert.equal(playerTiles.length, PLAYER_TILES, `${starter.id}: playerTiles must have exactly ${PLAYER_TILES} entries`);
    assert.deepEqual(
      playerTiles.slice(0, 8),
      expectedAuthored,
      `${starter.id}: playerTiles[0..7] must be exactly the shared figure's own idle+walk tiles`
    );
    for (let i = 0; i < 8; i++) {
      assert.notEqual(playerTiles[i], BLANK_TILE, `${starter.id}: playerTiles[${i}] must not be a blank tile`);
    }
    for (let i = 8; i < PLAYER_TILES; i++) {
      // A plain `assert.equal(t, null)`, not a falsy/blank check -- a blank
      // string is exactly the bug this test exists to catch.
      assert.equal(playerTiles[i], null, `${starter.id}: playerTiles[${i}] must be exactly null, got ${JSON.stringify(playerTiles[i])}`);
    }
  }
});

// --- 7: every CONTENT starter validates with zero problems of any severity -

// Design §7.1's own rationale for this bar is specifically about the
// CONTENT starters ("none of the three content starters carries one
// today"), not the two blank entries -- and it cannot be, structurally:
// `blank-rpg` is required (design §4, test 1) to build byte-for-byte
// identical to plain `createProject('X', 'rpg')`, which on its own already
// carries a pre-existing "No actor deals damage, so no battle can ever
// start" warning (confirmed at HEAD, before this phase, with no starter
// code involved at all) that no starter-side change could remove without
// breaking that identity. Scoped to non-blank ids so this test only ever
// asks the question design §7.1 actually means to ask.
test("7: validateProject raises zero errors AND zero warnings for every CONTENT starter -- no content starter carries an expected warning", () => {
  const contentStarters = STARTERS.filter((s) => !s.id.startsWith('blank-'));
  assert.ok(contentStarters.length > 0, 'expected at least one content starter');
  for (const starter of contentStarters) {
    const problems = validateProject(starter.build('X'));
    assert.deepEqual(
      problems,
      [],
      `starter "${starter.id}" must validate with zero problems of any severity (found ${JSON.stringify(problems)})`
    );
  }
});

// --- 8: every starter fits the capacity checkCapacity enforces -------------

test('8: checkCapacity raises zero errors for every starter', (t) => {
  for (const starter of STARTERS) {
    const result = checkCapacity(starter.build('X'));
    const errors = result.problems.filter((p) => p.severity === 'error');
    assert.deepEqual(errors, [], `starter "${starter.id}" must have zero checkCapacity errors (found ${JSON.stringify(errors)})`);
    t.diagnostic(`starter "${starter.id}": screenCount=${result.screenCount}, capacity=${JSON.stringify(result.capacity)}`);
  }
});

// --- 9: the overworld's own choice is structurally real ---------------------

test("9: the overworld starter's trader event contains a real choice -- at least two options, each option's body ending in a say", () => {
  const overworld = STARTERS.find((s) => s.id === 'overworld');
  const project = overworld.build('X');
  const greenwood = project.maps.find((m) => m.name === 'Greenwood');
  assert.ok(greenwood, 'expected a map named "Greenwood"');
  const screen = greenwood.screens[0];

  // Found by walking placed entities to an actor with behavior 'npc' whose
  // own event contains a choice -- not by position, so a reordering of the
  // screen's own entities array cannot silently break this test.
  let trader = null;
  for (const entity of screen.entities ?? []) {
    const actor = project.sprites.actors[entity.actorId];
    if (actor?.behavior !== 'npc') continue;
    const pages = entity.props?.event?.pages ?? [];
    if (pages.some((page) => (page.commands ?? []).some((c) => c.op === 'choice'))) {
      trader = entity;
      break;
    }
  }
  assert.ok(trader, 'no npc placement on Greenwood has a choice in its event');

  const choiceCommand = trader.props.event.pages.flatMap((page) => page.commands).find((c) => c.op === 'choice');
  assert.ok(choiceCommand, 'expected to find the choice command again');
  assert.ok(choiceCommand.options.length >= 2, `the choice must have at least two options, found ${choiceCommand.options.length}`);
  for (const option of choiceCommand.options) {
    const last = option.commands[option.commands.length - 1];
    assert.equal(last?.op, 'say', `every option's own body must end in a say (got ${JSON.stringify(option.commands)})`);
  }
});

// A structurally-real choice and give/switch chain is not the same claim as
// "reachable": deleting the Cottage event, or switching the trader's own
// stored trigger to `enter`, both pass test 9 above untouched while making
// the advertised interaction unreachable in play (round 2's own fix). Round
// 3 found two further holes in that fix itself: `.find()` locates a page
// wherever it sits, so reversing the Cottage's own two pages -- or
// inserting an unconditional page ahead of the trader's choice -- passed
// everything while the engine's own "first passing page wins" rule
// (engine/script.asm) would have run the WRONG one; and the sequence
// assertions read raw `commands`, so `off: true` on the choice, the give or
// the setSwitch passed everything too, even though a switched-off command
// is authoring scaffolding the ROM never runs.
//
// `selectPage` mirrors the engine's own rule directly rather than trusting
// `.find()`: the first (in `compiledPages`' own order -- a page whose
// commands are ALL switched off is dropped from the ROM entirely, per its
// own doc comment, so it can never be a candidate) whose `cond` passes
// against the given switch state. Any `cond.type` this does not recognise
// throws, so a future condition type is never silently treated as passing.
function selectPage(event, switchesOn) {
  for (const page of compiledPages(event)) {
    const cond = page.cond ?? { type: 'none', arg: 0 };
    if (cond.type === 'none') return page;
    if (cond.type === 'switchOn') {
      if (switchesOn.has(cond.arg)) return page;
      continue;
    }
    if (cond.type === 'switchOff') {
      if (!switchesOn.has(cond.arg)) return page;
      continue;
    }
    throw new Error(`selectPage: unsupported cond type "${cond.type}"`);
  }
  return null;
}

/**
 * Every problem with the overworld starter's own two advertised
 * interactions, given `project`: a plain list of strings, empty when
 * clean, in the same shape `arrivalProblems` above already uses. Page
 * selection goes through `selectPage` (never `.find()`), and every command
 * sequence is derived from `liveCommands` (shared/eventrules.js, re-
 * exported from shared/project.js) -- never a raw `.map(c => c.op)` over
 * `page.commands` -- so a switched-off command is exactly as invisible here
 * as it is to the real compiler.
 */
function interactionProblems(project) {
  const problems = [];
  const greenwood = project.maps.find((m) => m.name === 'Greenwood')?.screens[0];
  const cottage = project.maps.find((m) => m.name === 'Cottage')?.screens[0];
  if (!greenwood || !cottage) return ['expected a Greenwood and a Cottage map'];

  const findNpcWithCommand = (screen, op) => {
    for (const entity of screen.entities ?? []) {
      const actor = project.sprites.actors[entity.actorId];
      if (actor?.behavior !== 'npc') continue;
      const pages = entity.props?.event?.pages ?? [];
      if (pages.some((page) => (page.commands ?? []).some((c) => c.op === op))) return entity;
    }
    return null;
  };

  const trader = findNpcWithCommand(greenwood, 'choice');
  if (!trader) {
    problems.push('no npc placement on Greenwood mentions a choice');
  } else {
    const traderActor = project.sprites.actors[trader.actorId];
    if (effectiveTrigger(trader, traderActor, project) !== 'interact') {
      problems.push("the trader's own effective trigger is not \"interact\"");
    }
    const selected = selectPage(trader.props.event, new Set());
    if (!selected) {
      problems.push("no page of the trader's own event is selected with no switches on");
    } else {
      const liveOps = [...liveCommands(selected.commands, CHOICE_LIMITS.options)];
      const liveChoice = liveOps.find((c) => c.op === 'choice');
      if (!liveChoice) {
        problems.push("the trader's own selected page has no live choice command");
      } else if (liveChoice.options.length < 2) {
        problems.push(`the trader's own live choice has only ${liveChoice.options.length} option(s), need >= 2`);
      }
    }
  }

  const cottageVillager = findNpcWithCommand(cottage, 'give');
  if (!cottageVillager) {
    problems.push('no npc placement on Cottage mentions a give');
    return problems;
  }
  const cottageActor = project.sprites.actors[cottageVillager.actorId];
  if (effectiveTrigger(cottageVillager, cottageActor, project) !== 'interact') {
    problems.push("the Cottage villager's own effective trigger is not \"interact\"");
  }

  // Switch 0 OFF: the give page must be the one selected, with its own
  // exact live command sequence.
  const givenSelected = selectPage(cottageVillager.props.event, new Set());
  if (!givenSelected) {
    problems.push("no page of the Cottage villager's own event is selected with switch 0 off");
  } else {
    const liveGiveOps = [...liveCommands(givenSelected.commands, CHOICE_LIMITS.options)];
    const liveOpNames = liveGiveOps.map((c) => c.op);
    const expectedOpNames = ['say', 'give', 'setSwitch'];
    if (JSON.stringify(liveOpNames) !== JSON.stringify(expectedOpNames)) {
      problems.push(
        `the Cottage villager's own selected page (switch 0 off) has live ops ${JSON.stringify(liveOpNames)}, expected ${JSON.stringify(expectedOpNames)}`
      );
    } else {
      const giveCommand = liveGiveOps.find((c) => c.op === 'give');
      if (giveCommand.item !== 0) problems.push('the live give command does not name item 0 (the Coin)');
      const setSwitchCommand = liveGiveOps.find((c) => c.op === 'setSwitch');
      if (setSwitchCommand.switch !== 0) problems.push('the live setSwitch command does not set switch 0');
    }
  }

  // Switch 0 ON: the fallback page must be selected instead, and must still
  // say something on a repeat visit.
  const fallbackSelected = selectPage(cottageVillager.props.event, new Set([0]));
  if (!fallbackSelected) {
    problems.push("no page of the Cottage villager's own event is selected with switch 0 on");
  } else if (fallbackSelected === givenSelected) {
    problems.push('the same page is selected with switch 0 off and switch 0 on -- the give is never actually guarded');
  } else {
    const liveFallbackOps = [...liveCommands(fallbackSelected.commands, CHOICE_LIMITS.options)];
    if (!liveFallbackOps.some((c) => c.op === 'say')) {
      problems.push("the Cottage villager's own fallback page (switch 0 on) has no live say");
    }
  }

  return problems;
}

test("9b: the overworld starter's advertised interactions are really reachable -- effective trigger, real page selection (not `.find()`), and live (not raw) command sequences", () => {
  const overworld = STARTERS.find((s) => s.id === 'overworld').build('X');
  const problems = interactionProblems(overworld);
  assert.deepEqual(problems, [], `the overworld starter has interaction-reachability problems: ${JSON.stringify(problems)}`);
});

// Negative controls: interactionProblems is only trustworthy if it can
// actually fail on a genuinely bad project.

test("interactionProblems negative control: reversing the Cottage villager's own two pages shadows the give behind the fallback", () => {
  const overworld = STARTERS.find((s) => s.id === 'overworld').build('X');
  const clone = structuredClone(overworld);
  const cottage = clone.maps.find((m) => m.name === 'Cottage').screens[0];
  const villager = cottage.entities.find((e) => (e.props?.event?.pages ?? []).some((p) => (p.commands ?? []).some((c) => c.op === 'give')));
  villager.props.event.pages.reverse();
  const problems = interactionProblems(clone);
  assert.ok(problems.length > 0, `expected the reversed Cottage pages to be reported, got no problems`);
});

test("interactionProblems negative control: an unconditional page inserted before the trader's own choice shadows it", () => {
  const overworld = STARTERS.find((s) => s.id === 'overworld').build('X');
  const clone = structuredClone(overworld);
  const greenwood = clone.maps.find((m) => m.name === 'Greenwood').screens[0];
  const trader = greenwood.entities.find((e) => (e.props?.event?.pages ?? []).some((p) => (p.commands ?? []).some((c) => c.op === 'choice')));
  trader.props.event.pages.unshift({ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'A shadowing page.' }] });
  const problems = interactionProblems(clone);
  assert.ok(problems.length > 0, 'expected the inserted shadowing page to be reported, got no problems');
});

test("interactionProblems negative control: off:true on the give page's own give or setSwitch command is independently reported", () => {
  for (const op of ['give', 'setSwitch']) {
    const overworld = STARTERS.find((s) => s.id === 'overworld').build('X');
    const clone = structuredClone(overworld);
    const cottage = clone.maps.find((m) => m.name === 'Cottage').screens[0];
    const villager = cottage.entities.find((e) => (e.props?.event?.pages ?? []).some((p) => (p.commands ?? []).some((c) => c.op === 'give')));
    const givePage = villager.props.event.pages.find((p) => (p.commands ?? []).some((c) => c.op === 'give'));
    givePage.commands.find((c) => c.op === op).off = true;
    const problems = interactionProblems(clone);
    assert.ok(problems.length > 0, `expected off:true on the give page's own "${op}" command to be reported, got no problems`);
  }
});

test("interactionProblems negative control: off:true on the trader's own choice command is reported", () => {
  const overworld = STARTERS.find((s) => s.id === 'overworld').build('X');
  const clone = structuredClone(overworld);
  const greenwood = clone.maps.find((m) => m.name === 'Greenwood').screens[0];
  const trader = greenwood.entities.find((e) => (e.props?.event?.pages ?? []).some((p) => (p.commands ?? []).some((c) => c.op === 'choice')));
  const choicePage = trader.props.event.pages.find((p) => (p.commands ?? []).some((c) => c.op === 'choice'));
  choicePage.commands.find((c) => c.op === 'choice').off = true;
  const problems = interactionProblems(clone);
  assert.ok(problems.length > 0, "expected off:true on the trader's own choice command to be reported, got no problems");
});

// --- content-starter art integrity: an imported actor's own tiles must ----
// --- still be there, not painted over by hand-authored art -----------------

// The shape design §11 test 11 already specifies for the dungeon's own
// Skeleton, generalized here to every content starter and every imported
// monster/pickup actor: setting `villagerFirstIndex = 36` in
// shared/starters/overworld.js (writing the Villager's own idle art over
// the Coin's four imported tiles) passed tests 7, 15 and 17 -- test 15 pins
// palettes only, nothing pinned the imported tiles themselves, so a starter
// that lands its hand-authored art on top of an import ships (say) a Bat
// drawn as a green-suited villager with nothing here to notice.
//
// A pinned roster, keyed by starter id like PALETTE_TABLE, is what makes
// this non-vacuous a second way: renaming the Bat actor to "Moth" (and
// repainting it) would leave the by-name lookup below simply skipping it --
// Coin alone would still satisfy a bare "at least one" count. Every name in
// the roster must exist, by name, in that starter's own actors, or the test
// fails on the missing one; the "any other actor whose name matches an
// entry" sweep still runs too, so a fourth import phases 3-4 add is checked
// even before its own name is added here.
const IMPORTED_ACTORS = { overworld: ['Bat', 'Coin'] };

function assertActorDrawsItsOwnArt(starterId, project, actor, entry) {
  const animation = project.sprites.animations[actor.anims?.idle];
  assert.ok(animation, `${starterId}: actor "${actor.name}" has no real idle animation`);

  // A set comparison, not an index comparison: planActorImport's own
  // tileMap is free to place an entry's tiles at any destination indices,
  // and an animation can hold more than one frame/metasprite.
  const tileIndices = new Set();
  for (const frame of animation.frames ?? []) {
    const metasprite = project.sprites.metasprites[frame.metaspriteId];
    assert.ok(metasprite, `${starterId}: actor "${actor.name}"'s idle animation references no real metasprite`);
    for (const tile of metasprite.tiles ?? []) tileIndices.add(tile.tile);
  }
  const actualTiles = new Set([...tileIndices].map((index) => project.tilesets[0].sprites.tiles[index]));
  const expectedTiles = new Set(entry.spriteTiles);
  assert.deepStrictEqual(
    actualTiles,
    expectedTiles,
    `${starterId}: actor "${actor.name}" (imported from the library entry of the same name) no longer draws ` +
      "that entry's own art -- something else has been written over its tiles"
  );
}

test("an imported monster/pickup actor's own idle art is still that library entry's own tiles, not something hand-authored written over them -- across every content starter", () => {
  const importableEntries = LIBRARY_ENTRIES.filter((e) => e.kind === 'monster' || e.kind === 'pickup');
  const contentStarters = STARTERS.filter((s) => !s.id.startsWith('blank-'));
  assert.ok(contentStarters.length > 0, 'expected at least one content starter');

  for (const starter of contentStarters) {
    const project = starter.build('X');
    const roster = IMPORTED_ACTORS[starter.id];
    assert.ok(roster?.length, `expected an IMPORTED_ACTORS roster for starter "${starter.id}"`);

    // The pinned roster: every named actor must exist, by name.
    for (const name of roster) {
      const entry = importableEntries.find((e) => e.name === name);
      assert.ok(entry, `no monster/pickup library entry named "${name}" (IMPORTED_ACTORS["${starter.id}"] is stale)`);
      const actor = project.sprites.actors.find((a) => a.name === name);
      assert.ok(actor, `${starter.id}: expected an actor named "${name}" (imported from the library entry of the same name)`);
      assertActorDrawsItsOwnArt(starter.id, project, actor, entry);
    }

    // Any OTHER actor whose name happens to match a library entry, so a
    // fourth import a future phase adds is checked even before its own name
    // is added to IMPORTED_ACTORS above.
    for (const actor of project.sprites.actors) {
      if (roster.includes(actor.name)) continue;
      const entry = importableEntries.find((e) => e.name === actor.name);
      if (!entry) continue;
      assertActorDrawsItsOwnArt(starter.id, project, actor, entry);
    }
  }
});

// --- 15: pinned palette-adoption outcomes, keyed by starter id --------------

// One row per import, in the starter's own documented order (design
// §9.1). Phases 3-4 add a `dungeon`/`rpg` key here, growing this same
// table rather than duplicating the test.
const PALETTE_TABLE = {
  overworld: [
    { kind: 'terrain', name: 'Grass Plains', table: 'bg', slot: 1, written: true },
    { kind: 'terrain', name: 'Dirt Path', table: 'bg', slot: 1, written: false },
    { kind: 'terrain', name: 'Wood Planks', table: 'bg', slot: 2, written: true },
    { kind: 'monster', name: 'Bat', table: 'sprite', slot: 1, written: true },
    { kind: 'pickup', name: 'Coin', table: 'sprite', slot: 2, written: true }
  ]
};

test("15: each starter's own documented import sequence produces the pinned palette slot/written outcome, and the shipped build() output holds the matching colours", () => {
  for (const [id, rows] of Object.entries(PALETTE_TABLE)) {
    const starter = STARTERS.find((s) => s.id === id);
    assert.ok(starter, `expected a STARTERS entry with id "${id}"`);

    // (a) replay the documented sequence fresh, on a matching createProject
    // base, with no options.paletteSlot -- the identical call shape
    // build() itself uses -- and check each import's own real {slot,
    // written} report against the pinned table.
    let project = createProject('X', starter.gameType);
    for (const row of rows) {
      const entry = LIBRARY_ENTRIES.find((e) => e.kind === row.kind && e.name === row.name);
      assert.ok(entry, `no ${row.kind} library entry named "${row.name}"`);
      const planned = planLibraryImport(project, entry, { tilesetId: 0 });
      assert.ok(planned.ok, `importing "${row.name}" for "${id}" failed: ${planned.reason}`);
      project = applyPlannedProject(project, planned.project);
      const outcome = row.table === 'bg' ? planned.report.palette : planned.report.palettes[0];
      assert.equal(outcome.table, row.table, `"${row.name}" (${id}): palette table`);
      assert.equal(outcome.slot, row.slot, `"${row.name}" (${id}): palette slot`);
      assert.equal(outcome.written, row.written, `"${row.name}" (${id}): palette written`);
    }

    // (b) independently: the shipped build() output's final palettes hold
    // exactly the colours this table implies at each named slot.
    const built = starter.build('X');
    for (const row of rows) {
      const entry = LIBRARY_ENTRIES.find((e) => e.kind === row.kind && e.name === row.name);
      const actual = row.table === 'bg' ? built.palettes.bg[row.slot] : built.palettes.sprite[row.slot];
      assert.deepEqual(actual, entry.palette, `${id}'s own palettes.${row.table}[${row.slot}] must hold "${row.name}"'s colours`);
    }
  }
});

// --- 17: arrival safety, across every starter -------------------------------

const TOUCH_RANGE = 12; // from engine/constants.asm
const BODY_L = 2; // from engine/constants.asm
const BODY_R = 13; // from engine/constants.asm
const BODY_T = 8; // from engine/constants.asm
const BODY_B = 15; // from engine/constants.asm

/**
 * Every problem with landing at `(x, y)` on `screen` (of `project`), given
 * every OTHER thing already on that screen: touch-range proximity to
 * `otherEntities`, then passability of every metatile the player's own
 * collision body would overlap there. A plain list of strings, empty when
 * the landing is clean -- shared by every arrival check below (a door's own
 * target, and, per finding 5, the project's own start position) so the two
 * can never independently drift on what "a safe landing" means. No
 * boundTiles substitution is applied: a bound cell only substitutes while
 * its own switch is ON (normalizeScreen's {switchId, row, col, metatileId},
 * design-tile.md §10), so at the screen's default (off) switch state the
 * painted metatile already IS the effective one -- there is nothing to
 * substitute yet, not an omitted rule.
 */
function landingProblems(label, project, screen, x, y, otherEntities) {
  const problems = [];
  for (const other of otherEntities) {
    const dx = Math.abs(x - other.x);
    const dy = Math.abs(y - other.y);
    if (!(dx >= TOUCH_RANGE || dy >= TOUCH_RANGE)) {
      problems.push(`${label}: landing at (${x}, ${y}) is within touch range of a placement at (${other.x}, ${other.y})`);
    }
  }
  const left = Math.floor((x + BODY_L) / 16);
  const right = Math.floor((x + BODY_R) / 16);
  const top = Math.floor((y + BODY_T) / 16);
  const bottom = Math.floor((y + BODY_B) / 16);
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const metatileId = screen.metatiles[row * LIMITS.screenCols + col];
      const metatile = project.metatiles[metatileId];
      if (!metatile) {
        problems.push(`${label}: no metatile ${metatileId} exists (row ${row}, col ${col})`);
        continue;
      }
      if (metatile.collision === 'solid' || metatile.collision === 'water') {
        problems.push(`${label}: lands on ${metatile.collision} ground at (row ${row}, col ${col})`);
      }
    }
  }
  return problems;
}

/**
 * Every arrival-safety problem in `project`: every placed entity's x/y (and
 * a door's own toScreen/toX/toY) must be finite numbers, every door's own
 * target screen must resolve, and every door's own landing point must pass
 * `landingProblems` against the destination screen's REAL entity list --
 * deliberately with no exemption for the door doing the checking. A door on
 * screen A targeting screen B is never IN screen B's own entity list at
 * all, so the only placement an `other === entity` exemption could ever
 * have excluded is a door landing on its own screen -- the self-targeting
 * case this function exists to catch, not wave through.
 */
function arrivalProblems(project) {
  const problems = [];
  const flatScreens = project.maps.flatMap((map) => map.screens);

  for (const screen of flatScreens) {
    for (const entity of screen.entities ?? []) {
      if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) {
        problems.push(`a placed entity's x/y must be finite numbers (actorId ${entity.actorId})`);
        continue;
      }

      const actor = project.sprites.actors[entity.actorId];
      if (actor?.behavior !== 'door') continue;

      const toScreen = entity.props?.toScreen;
      const toX = entity.props?.toX;
      const toY = entity.props?.toY;
      if (!Number.isFinite(toScreen) || !Number.isFinite(toX) || !Number.isFinite(toY)) {
        problems.push(`a door's toScreen/toX/toY must be finite numbers (actorId ${entity.actorId})`);
        continue;
      }

      const destination = flatScreens[toScreen];
      if (!destination) {
        problems.push(`a door's toScreen (${toScreen}) does not resolve to a real screen (actorId ${entity.actorId})`);
        continue;
      }

      problems.push(
        ...landingProblems(`door at (${entity.x}, ${entity.y})`, project, destination, toX, toY, destination.entities ?? [])
      );
    }
  }
  return problems;
}

test("17: every door's own landing point is far enough from every other placement on the destination screen, and passable for the player's whole collision body -- across every starter", () => {
  for (const starter of STARTERS) {
    const project = starter.build('X');
    const problems = arrivalProblems(project);
    assert.deepEqual(problems, [], `starter "${starter.id}" has arrival-safety problems: ${JSON.stringify(problems)}`);
  }

  // §9.1's own placement table for the overworld, pinned directly, so a
  // silently moved placement fails even if it happens to still satisfy the
  // generic checks above.
  const overworld = STARTERS.find((s) => s.id === 'overworld').build('X');
  const byBehavior = (screen, behavior) =>
    screen.entities.filter((e) => overworld.sprites.actors[e.actorId]?.behavior === behavior);
  const greenwood = overworld.maps.find((m) => m.name === 'Greenwood').screens[0];
  const cottage = overworld.maps.find((m) => m.name === 'Cottage').screens[0];

  const bat = byBehavior(greenwood, 'patroller')[0];
  assert.ok(bat, 'expected a patroller (the Bat) on Greenwood');
  assert.deepEqual([bat.x, bat.y], [96, 80], 'the Bat must sit at (96, 80) on Greenwood');

  const trader = byBehavior(greenwood, 'npc')[0];
  assert.ok(trader, 'expected an npc (the trader) on Greenwood');
  assert.deepEqual([trader.x, trader.y], [160, 96], 'the trader must sit at (160, 96) on Greenwood');

  const greenwoodDoor = byBehavior(greenwood, 'door')[0];
  assert.ok(greenwoodDoor, 'expected a door on Greenwood');
  assert.deepEqual([greenwoodDoor.x, greenwoodDoor.y], [224, 48], "Greenwood's own door must sit at (224, 48)");
  assert.deepEqual(
    [greenwoodDoor.props.toScreen, greenwoodDoor.props.toX, greenwoodDoor.props.toY],
    [1, 32, 176],
    "Greenwood's own door must target screen 1 (Cottage) landing at (32, 176)"
  );

  const cottageVillager = byBehavior(cottage, 'npc')[0];
  assert.ok(cottageVillager, 'expected an npc on Cottage');
  assert.deepEqual([cottageVillager.x, cottageVillager.y], [128, 96], "Cottage's own villager must sit at (128, 96)");

  const cottageDoor = byBehavior(cottage, 'door')[0];
  assert.ok(cottageDoor, 'expected a door on Cottage');
  assert.deepEqual([cottageDoor.x, cottageDoor.y], [32, 48], "Cottage's own door must sit at (32, 48)");
  assert.deepEqual(
    [cottageDoor.props.toScreen, cottageDoor.props.toX, cottageDoor.props.toY],
    [0, 64, 176],
    "Cottage's own door must target screen 0 (Greenwood) landing at (64, 176)"
  );

  // §9.1's own start-position and title pins -- the other half of "where
  // the player actually begins," untouched by every check above: moving
  // the start onto the Greenwood door's own cell, or clearing titleMap,
  // would pass every assertion above unmodified.
  assert.equal(overworld.project.startMap, 0, 'the overworld starter must start on map 0 (Greenwood)');
  assert.equal(overworld.project.startScreen, 0, 'the overworld starter must start on screen 0');
  assert.equal(overworld.project.startX, 48, 'the overworld starter must start at x 48');
  assert.equal(overworld.project.startY, 192, 'the overworld starter must start at y 192');
  assert.equal(overworld.project.titleMap, 2, 'the overworld starter must use map 2 (Title) as its title map');
  assert.equal(overworld.project.titleScreen, 0, "the overworld starter's title screen must be screen 0");

  // The start position must itself be a safe landing -- the same rule a
  // door's own arrival point is held to, reusing landingProblems' own inner
  // check directly (not a third, hand-rolled copy of it) so the player does
  // not spawn on the Bat or inside solid ground.
  const startProblems = landingProblems(
    "the overworld starter's own start position",
    overworld,
    greenwood,
    overworld.project.startX,
    overworld.project.startY,
    greenwood.entities ?? []
  );
  assert.deepEqual(
    startProblems,
    [],
    `the overworld starter's own start position has arrival-safety problems: ${JSON.stringify(startProblems)}`
  );
});

// Negative controls: arrivalProblems is only trustworthy if it can actually
// fail on a genuinely bad project, not just pass on this design's own
// already-clean one.

test('arrivalProblems negative control: a door that targets its own screen and lands on itself is reported, not silently exempted', () => {
  const overworld = STARTERS.find((s) => s.id === 'overworld').build('X');
  const clone = structuredClone(overworld);
  const greenwood = clone.maps.find((m) => m.name === 'Greenwood').screens[0];
  const doorActorId = clone.sprites.actors.findIndex((a) => a.behavior === 'door');
  assert.ok(doorActorId >= 0, 'expected a door actor in the overworld starter');
  // A door on Greenwood targeting Greenwood, landing exactly on its own
  // resting cell -- the engine would re-queue this warp every frame.
  greenwood.entities.push({
    actorId: doorActorId,
    x: 0,
    y: 0,
    props: { toScreen: 0, toX: 0, toY: 0, trigger: 'touch' }
  });
  const problems = arrivalProblems(clone);
  assert.ok(
    problems.some((p) => p.includes('within touch range')),
    `expected the self-targeting door to be reported, got ${JSON.stringify(problems)}`
  );
});

test("arrivalProblems negative control: a solid metatile under a door's own landing point is reported", () => {
  const overworld = STARTERS.find((s) => s.id === 'overworld').build('X');
  const clone = structuredClone(overworld);
  const cottage = clone.maps.find((m) => m.name === 'Cottage').screens[0];
  const solidId = clone.metatiles.findIndex((m) => m.name.startsWith('Metatile '));
  assert.ok(solidId >= 0, 'expected at least one unclaimed default metatile slot to repaint');
  clone.metatiles[solidId] = { ...clone.metatiles[solidId], collision: 'solid' };
  // Greenwood's own door lands on Cottage at (32, 176) (pinned above) -- put
  // the fresh solid metatile under the single cell the player's body
  // overlaps there.
  const row = Math.floor((176 + BODY_T) / 16);
  const col = Math.floor((32 + BODY_L) / 16);
  cottage.metatiles[row * LIMITS.screenCols + col] = solidId;
  const problems = arrivalProblems(clone);
  assert.ok(
    problems.some((p) => p.includes('lands on solid ground')),
    `expected the solid metatile under a landing point to be reported, got ${JSON.stringify(problems)}`
  );
});

// --- 13: no starter or starter test reaches for a fixture -------------------

// A fixture reference is a path, so this only ever looks inside string
// literals (never a comment, never an identifier) for one of the six real
// checked-in fixture directory names, and only when the name fills a whole
// path component -- see test/lib/sourcescan.js's own fixtureReferences.

test('13: no file under shared/starters/, nor this test file itself, references one of the six checked-in fixture directories', async () => {
  const dir = path.join(ROOT, 'shared/starters');
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0, 'expected at least one file under shared/starters/');
  const targets = [...files.map((name) => path.join(dir, name)), path.join(ROOT, 'test/unit/starters.test.js')];
  for (const file of targets) {
    const text = await fs.readFile(file, 'utf8');
    const offenders = fixtureReferences(text);
    assert.deepEqual(
      offenders,
      [],
      `${path.relative(ROOT, file)} must not reference one of the six checked-in fixture directories (found ${JSON.stringify(offenders)})`
    );
  }
});

// --- screenFromArt: a real re-export, not a copy ----------------------------

test('tools/sample-common.js\'s screenFromArt is identically shared/starters/authoring.js\'s screenFromArt (re-export, not a duplicate)', () => {
  assert.equal(screenFromArtViaTools, screenFromArtViaStarters);
});

// --- CLAUDE.md's "shared/ modules must stay free of DOM and Node APIs" ----

// See test/lib/sourcescan.js's own nodeDomViolations: identifier-level
// references are checked only in real code (never inside a string literal,
// so dialogue like "Look through the window." cannot trip it), and an
// import specifier is judged a Node builtin by node:module's own
// isBuiltin, covering every prefixed/bare/subpath spelling with no
// hand-written list -- static, side-effect, and dynamic imports alike.

test('every .js file under shared/starters/ stays free of Node and DOM APIs, per CLAUDE.md\'s own shared/ rule', async () => {
  const dir = path.join(ROOT, 'shared/starters');
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0, 'expected at least one file under shared/starters/');
  for (const name of files) {
    const label = `shared/starters/${name}`;
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    const violations = nodeDomViolations(text);
    assert.deepEqual(
      violations,
      [],
      `${label} ${violations.map((v) => v.detail).join('; ')}`
    );
  }
});
