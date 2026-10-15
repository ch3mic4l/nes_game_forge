// Large streamed worlds (ROADMAP item 15), phase 3b slices S4a, S4b, S4c and S5, commit C1/C2 of each: ADMISSION of the two-nametable ring on MMC3 (S4a), MMC1 (S4b)
// and UNROM 512 (S4c) for action games, and (S5 C2) for turn-based RPGs on all three.
//
// What this file pins (the engine behaviour of the ring itself is the streamring*.test.js family, run through the bypass copy; here the
// REAL tree is used -- test/lib/ringbypass.js's `bypass: false` copy has no refusal lift at all):
//   (a) the ring is admitted ONLY for N x 1 / 1 x N on UNROM 512, MMC1 and MMC3, for action and RPG alike -- an independent table over board x mirroring x game type x grid shape;
//   (b) a streamed RPG is admitted on every two-nametable board, and the two refusal arms that no registered board reaches any more are pinned on a SYNTHETIC board
//       (test/lib/syntheticboard.js): `ringGame` (a board whose datum lacks the project's game type) and `capability` (a ring board with no datum), each with its exact message;
//   (c) the dead-axis refusals still fire on UNROM 512, MMC1 and MMC3, from cameraAxes, for both game types;
//   (d) switchableMappers / checkStreamedMapperSwitch never offer a board that then fails validate (exhaustive over the table above);
//   (e) saves (Chris's ruling 3): a mirroring-only edit keeps saveCompatToken and the save identity; a save made on one mirroring Continues on the
//       other and the ring is reconstructed (nametable + attribute oracle after the landing), on all three boards (the battery RAM on MMC1/MMC3, the flash sector
//       on UNROM 512), for action and RPG; a resize still invalidates;
//   (f) the depth pin: no admitted horizontal action ring is deeper than the depth the ring gate certified (S4c Step 1, docs/design-streamed-worlds-phase3b.md section 15);
//       the RPG depth pin is streamringresources.test.js (i), also on the real path;
//   (g) the capacity boundary of a streamed RPG through the real refusal: the largest 1 x N that builds and the smallest refused, one- and two-tileset, per horizontal board;
//   plus the admitted project builds through the real cli.js path on both mirrorings of all three boards for both game types, and boots past a lap of the ring with no refusal lift.
// Each test names the wrong implementation it catches.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  validateProject,
  streamedBoardProblems,
  reconcileCartridge,
  growOrShrinkMap,
  createMap
} from '../../shared/project.js';
import {
  MAPPERS,
  resolveMapper,
  cameraAxes,
  streamRingAdmitted,
  streamRingBoardAdmitted,
  streamRingAdmittedGameTypes,
  streamRingAdmittedBoardNames,
  screenRegions,
  reservesFlashSaveRegion
} from '../../shared/cartridge.js';
import { streamRegionsPerRow } from '../../shared/streamlayout.js';
import { saveIdentity } from '../../shared/save.js';
import { checkCapacity, checkStreamedMapperSwitch, switchableMappers, planStreamedRegions } from '../../main/build/generate.js';
import { parse } from 'acorn';
import { saveProject } from '../../main/project-io.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { withSyntheticBoard, SYNTHETIC_NAME } from '../lib/syntheticboard.js';
import { oneTilesetRpg, buildRing } from '../lib/ringrpg.js';
import { waitForNamingReady, finishNamingIfOpen } from '../lib/naming.js';
import { makeBypassTree, loadBypassTree, buildThrough } from '../lib/ringbypass.js';
import { runScene, cellById, assertRingRun } from '../lib/ringrun.js';
import { laps } from '../lua/ring_gate/ringscene.mjs';
import { ringProject } from '../lua/ring_gate/ringworld.mjs';
import { bootRom, runSteps, readState } from '../lua/ring_gate/ringrun_jsnes.mjs';
import { judge } from '../lua/ring_gate/ringjudge.mjs';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const MMC1 = 1;
const MMC3 = 4;
const U512 = 30;
const project = ({ mapper, mirroring, gameType = 'action', gridW, gridH }) => createStreamedProject({ mapper, mirroring, gameType, gridW, gridH, camera: true });
const projectOf = project; // the (c) test shadows `project` with a game-type-bound one
const kinds = (p) => streamedBoardProblems(p).map((x) => x.kind);
const errors = (p) => validateProject(p).filter((x) => x.severity === 'error');

// ---------------------------------------------------------------------------------------------------------------- (a) the admission table

// The EXPECTED behaviour, written down independently of streamRingAdmitted: which boards admit what. MMC3 (S4a), MMC1 (S4b) and UNROM 512 (S4c) admit
// both ring mirrorings for action games and (S5) for RPGs; UNROM 512 four-screen (the torus) is untouched; MMC1 / MMC3 have no four-screen wiring.
const RING_BOARDS = [U512, MMC1, MMC3]; // stated here (registry order), then checked against the registry datum below
const GAME_TYPES = ['action', 'rpg'];
function expectedKinds({ mapper, mirroring }, gridW, gridH) {
  if (mirroring === 'fourscreen') return mapper === U512 ? [] : ['capability']; // MMC1/MMC3 cannot wire it ("cannot stream a world"): not capable, so no dead axis either
  const out = [];
  if (!RING_BOARDS.includes(mapper)) out.push('capability'); // every registered streamable board has a ring for both game types since S5: no 'ringGame', no 'capability'
  // the dead axis is judged on every capable two-nametable board, admitted or not: vertical scrolls sideways (N x 1 only), horizontal up and down (1 x N only)
  if (mirroring === 'vertical' && gridH > 1) out.push('deadAxis');
  if (mirroring === 'horizontal' && gridW > 1) out.push('deadAxis');
  return out;
}
const GRIDS = [[1, 1], [6, 1], [1, 6], [2, 2]];
const TABLE = [];
for (const mapper of [MMC1, MMC3, U512]) for (const mirroring of ['vertical', 'horizontal', 'fourscreen']) for (const gameType of ['action', 'rpg']) for (const [gridW, gridH] of GRIDS) TABLE.push({ mapper, mirroring, gameType, gridW, gridH });
const labelOf = (c) => `${resolveMapper(c.mapper).name} ${c.mirroring} ${c.gameType} ${c.gridW}x${c.gridH}`;

test('(a) the ring is admitted for UNROM 512, MMC1 and MMC3 action AND RPG, N x 1 / 1 x N only: every board x mirroring x game type x grid shape against an independent table', () => {
  // Catches a lift for any grid (a 2 x 2 or the dead-axis shape accepted), a game type left refused on one board (the `rpg` datum missing from UNROM 512, MMC1 or MMC3), a refusal
  // that survived on a board (a board not lifted), a lift for the wrong mirroring on UNROM 512 (its four-screen torus must stay as it was), and a lift that also let a
  // hand-edited four-screen MMC1/MMC3 file through. Raw (un-reconciled) projects on purpose.
  for (const c of TABLE) {
    const p = project(c);
    assert.deepEqual(kinds(p), expectedKinds(c, c.gridW, c.gridH), labelOf(c));
    // and validateProject agrees: it is an error exactly when the table says a refusal exists
    const boardErrors = errors(p).filter((x) => /stream/i.test(x.message) && !/camera/i.test(x.message));
    assert.equal(boardErrors.length > 0, expectedKinds(c, c.gridW, c.gridH).length > 0, `${labelOf(c)}: validateProject`);
  }
});

test('(a) the admission predicate is one datum per board: only UNROM 512, MMC1 and MMC3 list a game type, both of them, and a mirroring that is not a ring is never admitted', () => {
  // Catches a second reading of the board list (a hard-coded mapper id in project.js), an admission that ignores the mirroring (UNROM 512 four-screen is the torus,
  // not a two-nametable ring), and a board admitted for a game type its datum does not list (a board missing `rpg`, or admitted for a type nobody listed).
  for (const mapper of MAPPERS.filter((m) => m.supported)) {
    assert.deepEqual(streamRingAdmittedGameTypes(mapper), RING_BOARDS.includes(mapper.id) ? ['action', 'rpg'] : [], mapper.name);
    for (const mirroring of ['vertical', 'horizontal', 'fourscreen']) {
      for (const gameType of GAME_TYPES) {
        const want = RING_BOARDS.includes(mapper.id) && mirroring !== 'fourscreen';
        assert.equal(streamRingAdmitted(mapper, mirroring, gameType), want, `${mapper.name} ${mirroring} ${gameType}`);
      }
      assert.equal(streamRingBoardAdmitted(mapper, mirroring), RING_BOARDS.includes(mapper.id) && mirroring !== 'fourscreen', `${mapper.name} ${mirroring} (board)`);
    }
  }
  assert.equal(streamRingAdmittedBoardNames('action'), 'UNROM 512, MMC1 or MMC3', 'the boards the refusal messages name, in registry order, as an English list');
  assert.equal(streamRingAdmittedBoardNames('rpg'), 'UNROM 512, MMC1 or MMC3', 'and, since S5, the same three for a streamed RPG');
});

test('(a) streamedBoardProblems FOLLOWS the registry datum: changing streamRingGameTypes on a board changes what validate admits, with nothing else edited (S4a C1 review P3)', () => {
  // Catches the escaping implementation the review named: `mapper.id !== 4` / `gameType !== 'action'` hard-coded in streamedBoardProblems while the helpers
  // (streamRingAdmitted & co.) stay intact and keep passing the datum-only tests above -- now for all three admitted boards and both game types, and for the board names the refusal
  // messages carry (a message that still says "UNROM 512, MMC1 or MMC3" after a board's datum is gone). The datum is removed / narrowed on each REAL board in turn (the synthetic-board
  // pins in (b) are the isolated form of the same two arms). The registry entry is changed in place and restored in finally.
  const entry = (id) => MAPPERS.find((m) => m.id === id);
  const kindsOf = (mapper, mirroring, gameType) => kinds(project({ mapper, mirroring, gridW: mirroring === 'vertical' ? 6 : 1, gridH: mirroring === 'vertical' ? 1 : 6, gameType }));
  const capabilityText = (mapper, mirroring) => streamedBoardProblems(project({ mapper, mirroring, gridW: 1, gridH: 1 })).find((x) => x.kind === 'capability')?.message ?? '';
  const boards = RING_BOARDS.map(entry); // registry order: UNROM 512, MMC1, MMC3
  const orig = boards.map((b) => Object.getOwnPropertyDescriptor(b, 'streamRingGameTypes'));
  const nrom = entry(0);
  assert.equal(Object.getOwnPropertyDescriptor(nrom, 'streamRingGameTypes'), undefined);
  for (const b of boards) assert.deepEqual(b.streamRingGameTypes, ['action', 'rpg'], b.name);
  const set = (m, v) => Object.defineProperty(m, 'streamRingGameTypes', { value: v, configurable: true, writable: true, enumerable: true });
  const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names.join(''));
  try {
    for (const board of boards) {
      const others = boards.filter((b) => b !== board).map((b) => b.name); // still registry order
      for (const mirroring of ['vertical', 'horizontal']) {
        const id = board.id;
        for (const gameType of GAME_TYPES) assert.deepEqual(kindsOf(id, mirroring, gameType), [], `${board.name} ${mirroring}: as shipped, ${gameType} is admitted`);
        // the datum removed: action is refused, as a board without a ring (not as a game-type refusal), and the messages stop naming the board
        delete board.streamRingGameTypes;
        assert.deepEqual(kindsOf(id, mirroring, 'action'), ['capability'], `${board.name} ${mirroring}: without the datum it is a board with no ring`);
        assert.deepEqual(kindsOf(id, mirroring, 'rpg'), ['capability']);
        const text = capabilityText(id, mirroring);
        assert.match(text, /not implemented yet on this board/, 'the "no ring yet" refusal, reached only by removing the datum');
        assert.ok(text.includes(`Streamed maps work on ${list(others)} with horizontal or vertical mirroring and on UNROM 512 with four-screen mirroring`), `${board.name}: the message names only the boards that are still admitted: ${text}`);
        const cannot = streamedBoardProblems(project({ mapper: 0, mirroring, gridW: 1, gridH: 1 })).find((x) => x.kind === 'capability').message;
        assert.ok(cannot.includes(`Streamed maps need ${list(others)} with horizontal or vertical mirroring, or UNROM 512 with four-screen mirroring`), `and so does the "cannot stream a world" message: ${cannot}`);
        // an empty list is the same as none
        set(board, []);
        assert.deepEqual(kindsOf(id, mirroring, 'action'), ['capability'], `${board.name} ${mirroring}: an empty list`);
        // the datum narrowed to action only: RPG is the refused game type, with the game-type kind (the board still has a ring) -- the pre-S5 shape of every ring board
        set(board, ['action']);
        assert.deepEqual(kindsOf(id, mirroring, 'rpg'), ['ringGame'], `${board.name} ${mirroring}: rpg removed`);
        assert.deepEqual(kindsOf(id, mirroring, 'action'), []);
        // ...to rpg only: action is the refused one
        set(board, ['rpg']);
        assert.deepEqual(kindsOf(id, mirroring, 'action'), ['ringGame'], `${board.name} ${mirroring}: action removed`);
        assert.deepEqual(kindsOf(id, mirroring, 'rpg'), []);
        // a game type added back: both follow
        set(board, ['action', 'rpg']);
        for (const gameType of GAME_TYPES) assert.deepEqual(kindsOf(id, mirroring, gameType), [], `${board.name} ${mirroring}: ${gameType} admitted again`);
        for (const other of boards.filter((b) => b !== board)) assert.deepEqual(kindsOf(other.id, mirroring, 'action'), [], `and ${other.name} is unchanged`);
      }
      for (const gameType of GAME_TYPES) assert.equal(streamRingAdmittedBoardNames(gameType), list(boards.map((b) => b.name)), `restored between boards (${gameType})`);
    }
    // a datum on a board that cannot stream at all admits nothing: the mirroring/capability rules come first (NROM stays "cannot stream a world")
    set(nrom, ['action']);
    for (const mirroring of ['vertical', 'horizontal']) assert.deepEqual(kindsOf(0, mirroring, 'action'), ['capability'], `NROM ${mirroring} with a datum`);
    delete nrom.streamRingGameTypes;
    // validateProject, the user-facing gate, follows the same datum
    delete entry(U512).streamRingGameTypes;
    assert.ok(errors(project({ mapper: U512, mirroring: 'vertical', gridW: 6, gridH: 1 })).some((x) => /stream/i.test(x.message)), 'validateProject refuses UNROM 512 action when the datum is gone');
    assert.ok(errors(project({ mapper: U512, mirroring: 'horizontal', gridW: 1, gridH: 6 })).some((x) => /stream/i.test(x.message)));
    // ...and the torus on the same board is not asked about the ring datum at all
    assert.deepEqual(kinds(project({ mapper: U512, mirroring: 'fourscreen', gridW: 3, gridH: 2 })), [], 'UNROM 512 four-screen does not read the ring datum');
  } finally {
    boards.forEach((m, i) => { if (orig[i]) Object.defineProperty(m, 'streamRingGameTypes', orig[i]); else delete m.streamRingGameTypes; });
    delete nrom.streamRingGameTypes;
  }
  for (const b of boards) assert.deepEqual(b.streamRingGameTypes, ['action', 'rpg'], `${b.name} restored`);
  assert.equal('streamRingGameTypes' in nrom, false);
  for (const b of RING_BOARDS) assert.deepEqual(kinds(project({ mapper: b, mirroring: 'vertical', gridW: 6, gridH: 1 })), []);
});

test('(a) the refusal messages, generated from the registry: the list reads as English, an admitted board gets no capability refusal, and neither is the old "four-screen only" or "action games" text', () => {
  // Catches a stale message that tells a user the board they just were admitted on does not work, a message that names only one board (the S4a hard-coded MMC3),
  // the S4c reword (the list is "UNROM 512, MMC1 or MMC3", not "UNROM 512 or MMC1 or MMC3", and the four-screen clause is not repeated inside it) and the S5 reword: once the
  // datum lists both game types on the same boards the message no longer says "(action games)" as if an RPG were refused.
  for (const mirroring of ['horizontal', 'vertical']) {
    for (const mapper of RING_BOARDS) assert.deepEqual(streamedBoardProblems(project({ mapper, mirroring, gridW: 1, gridH: 1 })).filter((x) => x.kind === 'capability'), [], `${resolveMapper(mapper).name} ${mirroring}`);
  }
  const noStream = streamedBoardProblems(project({ mapper: 0, mirroring: 'horizontal', gridW: 1, gridH: 1 })).filter((x) => x.kind === 'capability');
  assert.equal(noStream.length, 1);
  assert.equal(noStream[0].where, 'Build');
  assert.equal(noStream[0].message,
    'Map "Streamed" is streamed, but NROM-256 with horizontal mirroring cannot stream a world. Streamed maps need UNROM 512, MMC1 or MMC3 with horizontal or vertical mirroring, ' +
    'or UNROM 512 with four-screen mirroring -- change the board in the Build panel, or remove "streamed" (or set it to false) for this map in the project\'s map JSON.');
  assert.doesNotMatch(noStream[0].message, /UNROM 512 or MMC1|action games/);
  // the same message for an RPG project (the text is the same for both game types while the datum is)
  assert.equal(streamedBoardProblems(project({ mapper: 0, mirroring: 'horizontal', gameType: 'rpg', gridW: 1, gridH: 1 })).find((x) => x.kind === 'capability').message, noStream[0].message);
});

// ---------------------------------------------------------------------------------------------------------------- (b) RPG

test('(b) a streamed RPG is admitted on every two-nametable board (no ringGame kind, no Build-panel error); UNROM 512 four-screen RPG is unchanged; NROM is still refused', () => {
  // Catches an RPG left refused on one board (the `rpg` datum missing from UNROM 512, MMC1 or MMC3: a refusal survives with the S4 text), an admission that ALSO lets through what it
  // must not (the dead-axis shape, an RPG on a board that cannot stream), and the torus RPG that already streamed being disturbed.
  for (const mapper of RING_BOARDS) {
    for (const mirroring of ['vertical', 'horizontal']) {
      const gridW = mirroring === 'vertical' ? 4 : 1;
      const gridH = mirroring === 'vertical' ? 1 : 4;
      const p = project({ mapper, mirroring, gameType: 'rpg', gridW, gridH });
      assert.deepEqual(kinds(p), [], `${resolveMapper(mapper).name} ${mirroring}`);
      assert.deepEqual(errors(p).filter((x) => /stream/i.test(x.message)), [], `${resolveMapper(mapper).name} ${mirroring}: validateProject carries no streamed error`);
    }
  }
  assert.deepEqual(kinds(project({ mapper: U512, mirroring: 'fourscreen', gameType: 'rpg', gridW: 3, gridH: 2 })), [], 'the torus RPG is untouched');
  for (const mirroring of ['vertical', 'horizontal']) assert.deepEqual(kinds(project({ mapper: 0, mirroring, gameType: 'rpg', gridW: 1, gridH: 1 })), ['capability'], `NROM ${mirroring} rpg: still cannot stream`);
});

// The two refusal arms of streamedBoardProblems that no registered board reaches any more. Both stay (Chris, 2026-10-14) as guards for a streamable board added without its datum or
// with a one-game-type one; each is pinned HERE on a synthetic board with its exact message. Expected messages are written out, independent of the code that generates them.
const SYN_TAIL = 'change the board and mirroring in the Build panel, or remove "streamed" (or set it to false) for this map in the project\'s map JSON.';
test('(b) the `ringGame` arm still fires, on a synthetic board whose datum lacks the game type: kind, tier, message, validateProject and the Build-panel preflight (a deleted or inverted arm is caught)', () => {
  // Catches: the arm deleted (an unlisted game type passes as admitted), the arm inverted (a listed game type refused), the game-type word wrong for the project (RPG vs "game of this type"),
  // the suggested boards not coming from the registry for THAT game type, the preflight (checkStreamedMapperSwitch) dropping the tier so a Build-panel switch lands on a refused board, and
  // the tier order (ringGame pre-empts the dead axis, like capability).
  withSyntheticBoard(['action'], (id) => {
    for (const mirroring of ['vertical', 'horizontal']) {
      const [gridW, gridH] = mirroring === 'vertical' ? [4, 1] : [1, 4];
      const rpg = project({ mapper: id, mirroring, gameType: 'rpg', gridW, gridH });
      assert.deepEqual(kinds(rpg), ['ringGame'], `${mirroring}: rpg not listed`);
      const found = streamedBoardProblems(rpg);
      assert.equal(found[0].where, 'Build');
      assert.equal(found[0].message,
        `Map "Streamed" is streamed in a turn-based RPG on ${SYNTHETIC_NAME} with ${mirroring} mirroring, which only reaches the two-nametable ring -- streamed RPGs are not implemented there yet. ` +
        `A streamed RPG works on UNROM 512, MMC1 or MMC3 with horizontal or vertical mirroring, or on UNROM 512 with four-screen mirroring; ${SYN_TAIL}`);
      assert.equal(errors(rpg).filter((x) => x.message === found[0].message).length, 1, 'validateProject carries it');
      assert.deepEqual(kinds(project({ mapper: id, mirroring, gameType: 'action', gridW, gridH })), [], `${mirroring}: action is listed and admitted`);
    }
    // the preflight: a project on a real board moved to the synthetic one is refused with the game-type message, before the dead axis (a 4 x 40 RPG on vertical would also be a dead-axis shape)
    const real = project({ mapper: MMC3, mirroring: 'vertical', gameType: 'rpg', gridW: 4, gridH: 40 });
    reconcileCartridge(real);
    const refusals = checkStreamedMapperSwitch(real, id, 'vertical');
    assert.equal(refusals.length, 1);
    assert.match(refusals[0], /^Map "Streamed" is streamed in a turn-based RPG on Synthetic board with vertical mirroring/);
    assert.ok(!/screens tall/.test(refusals[0]), 'ringGame pre-empts the dead axis');
  });
  // the board narrowed to RPG: the OTHER game type is refused, with the neutral wording and the registry's action boards
  withSyntheticBoard(['rpg'], (id) => {
    const action = project({ mapper: id, mirroring: 'vertical', gameType: 'action', gridW: 4, gridH: 1 });
    assert.deepEqual(kinds(action), ['ringGame']);
    assert.equal(streamedBoardProblems(action)[0].message,
      `Map "Streamed" is streamed in a game of this type on ${SYNTHETIC_NAME} with vertical mirroring, which only reaches the two-nametable ring -- streamed games of this type are not implemented there yet. ` +
      `A streamed game of this type works on UNROM 512, MMC1 or MMC3 with horizontal or vertical mirroring, or on UNROM 512 with four-screen mirroring; ${SYN_TAIL}`);
    assert.deepEqual(kinds(project({ mapper: id, mirroring: 'vertical', gameType: 'rpg', gridW: 4, gridH: 1 })), []);
  });
  // both listed: the arm does not fire for either, the board counts as a ring board for both, and the registry is restored after
  withSyntheticBoard(['action', 'rpg'], (id) => {
    for (const gameType of GAME_TYPES) assert.deepEqual(kinds(project({ mapper: id, mirroring: 'horizontal', gameType, gridW: 1, gridH: 4 })), [], gameType);
    assert.equal(streamRingAdmittedBoardNames('rpg'), `UNROM 512, MMC1, MMC3 or ${SYNTHETIC_NAME}`, 'a board the datum lists is named by the messages');
  });
  assert.equal(streamRingAdmittedBoardNames('rpg'), 'UNROM 512, MMC1 or MMC3', 'the synthetic board is gone from the registry');
  assert.equal(MAPPERS.some((m) => m.name === SYNTHETIC_NAME), false);
});

test('(b) the `capability` "no ring yet" arm still fires, on a synthetic ring board with no datum or an empty one: kind, message, and the boards it names come from the registry', () => {
  // Catches: the arm deleted, a datum-less board treated as admitted, an empty list treated as "no datum" differently, the message naming a typed board list instead of the registry's
  // (the synthetic board is not named, the three real ones are), and the "cannot stream a world" message (a different arm) leaking into it.
  for (const datum of [undefined, []]) {
    withSyntheticBoard(datum, (id) => {
      for (const gameType of GAME_TYPES) for (const mirroring of ['vertical', 'horizontal']) {
        const p = project({ mapper: id, mirroring, gameType, gridW: 1, gridH: 1 });
        assert.deepEqual(kinds(p), ['capability'], `${JSON.stringify(datum)} ${gameType} ${mirroring}`);
        const found = streamedBoardProblems(p)[0];
        assert.equal(found.where, 'Build');
        assert.equal(found.message,
          `Map "Streamed" is streamed on ${SYNTHETIC_NAME} with ${mirroring} mirroring, which only reaches the two-nametable ring -- not implemented yet on this board. ` +
          `Streamed maps work on UNROM 512, MMC1 or MMC3 with horizontal or vertical mirroring and on UNROM 512 with four-screen mirroring; ${SYN_TAIL}`);
        assert.ok(!/cannot stream a world/.test(found.message));
        assert.equal(errors(p).filter((x) => x.message === found.message).length, 1, 'validateProject carries it');
      }
      // the Build-panel preflight asks the same arm
      const real = project({ mapper: MMC1, mirroring: 'vertical', gameType: 'rpg', gridW: 4, gridH: 1 });
      reconcileCartridge(real);
      const refusals = checkStreamedMapperSwitch(real, id, 'vertical');
      assert.equal(refusals.length, 1);
      assert.match(refusals[0], /not implemented yet on this board/);
    });
  }
  // a datum that lists game types makes the message per-game-type once the real boards differ (the generated list never hard-codes "action games")
  withSyntheticBoard(['action'], () => {
    const nrom = streamedBoardProblems(project({ mapper: 0, mirroring: 'horizontal', gameType: 'action', gridW: 1, gridH: 1 })).find((x) => x.kind === 'capability').message;
    assert.ok(nrom.includes(`Streamed maps need UNROM 512, MMC1, MMC3 or ${SYNTHETIC_NAME} (action games) and UNROM 512, MMC1 or MMC3 (turn-based RPGs) with horizontal or vertical mirroring, or UNROM 512 with four-screen mirroring --`), nrom);
  });
});

// ---------------------------------------------------------------------------------------------------------------- (c) dead axis

for (const MAPPER of RING_BOARDS) for (const gameType of GAME_TYPES) test(`(c) the dead-axis refusals still fire on ${resolveMapper(MAPPER).name} ${gameType}, from cameraAxes, for every streamed map`, () => {
  // Catches a wrong dead axis (the vertical ring accepting 1 x N, the horizontal ring accepting N x 1) -- for an RPG too, whose admission must not carry the grid rule with it --
  // and a check that only looks at maps[0].
  assert.deepEqual(cameraAxes(resolveMapper(MAPPER), { mirroring: 'vertical' }), { horizontal: true, vertical: false });
  assert.deepEqual(cameraAxes(resolveMapper(MAPPER), { mirroring: 'horizontal' }), { horizontal: false, vertical: true });
  const project = (o) => projectOf({ ...o, gameType });
  const v = project({ mapper: MAPPER, mirroring: 'vertical', gridW: 6, gridH: 1 });
  assert.deepEqual(kinds(v), []);
  v.maps[0].gridW = 1; v.maps[0].gridH = 6; v.maps[0].screens = v.maps[0].screens.slice(0, 1).concat(Array.from({ length: 5 }, () => structuredClone(v.maps[0].screens[0])));
  const vProblems = streamedBoardProblems(v);
  assert.deepEqual(vProblems.map((x) => x.kind), ['deadAxis']);
  assert.equal(vProblems[0].where, 'Map Forge');
  assert.match(vProblems[0].message, /screens tall.*1 screen tall \(N x 1\)/s);
  const h = project({ mapper: MAPPER, mirroring: 'horizontal', gridW: 6, gridH: 1 });
  const hProblems = streamedBoardProblems(h);
  assert.deepEqual(hProblems.map((x) => x.kind), ['deadAxis']);
  assert.match(hProblems[0].message, /screens wide.*1 screen wide \(1 x N\)/s);
  // every streamed map is judged: a second, bad map is named
  const two = project({ mapper: MAPPER, mirroring: 'vertical', gridW: 3, gridH: 1 });
  const second = createMap(1, 'Tall');
  second.gridW = 1; second.gridH = 3; second.streamed = true; second.screens = Array.from({ length: 3 }, () => structuredClone(two.maps[0].screens[0]));
  two.maps.push(second);
  const found = streamedBoardProblems(two);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /Map "Tall"/);
});

// ---------------------------------------------------------------------------------------------------------------- capacity

// Measured through real builds by handoff-next/s4a-c1/capacity.mjs (MMC3), handoff-next/s4b-c1/capacity.mjs (MMC1) and handoff-next/s4c-c1/capacity.mjs (UNROM 512; logs capacity.log).
// The horizontal limit is the board's free 8 KB program regions (MMC3 30, MMC1 14, UNROM 512 61 -- the figures the phase 3b plan measured; UNROM 512's 64 regions less
// the fixed kernel's two less one CHR-RAM tileset page); the vertical ring is bounded by the grid ceiling alone.
const CAPACITY = {
  [MMC3]: { vertical: { largest: 255, refusedFrom: null }, horizontal: { largest: 30, refusedFrom: 31 } },
  [MMC1]: { vertical: { largest: 255, refusedFrom: null }, horizontal: { largest: 14, refusedFrom: 15 } },
  [U512]: { vertical: { largest: 255, refusedFrom: null }, horizontal: { largest: 61, refusedFrom: 62 } }
};

for (const board of RING_BOARDS) test(`capacity: the largest 1 x N on a horizontal ${resolveMapper(board).name} ring is ${CAPACITY[board].horizontal.largest} screens and ${CAPACITY[board].horizontal.refusedFrom} is refused naming the Forge; N x 1 on vertical reaches the 255 grid ceiling`, () => {
  // Catches a region count off by one (the largest refused or the first-over accepted), a board given another board's figure (MMC1 given MMC3's 30, UNROM 512 given
  // 62 because its CHR-RAM page was not charged), and a vertical ring limited like the horizontal one.
  const cap = CAPACITY[board];
  const name = resolveMapper(board).name;
  const mk = (mirroring, n) => project({ mapper: board, mirroring, gridW: mirroring === 'vertical' ? n : 1, gridH: mirroring === 'vertical' ? 1 : n });
  const refused = (p) => [...validateProject(p), ...checkCapacity(p).problems].filter((x) => x.severity === 'error');
  assert.deepEqual(refused(mk('horizontal', cap.horizontal.largest)).map((x) => x.message), []);
  const over = refused(mk('horizontal', cap.horizontal.refusedFrom));
  assert.equal(over.length, 1);
  assert.equal(over[0].where, 'Map Forge');
  assert.match(over[0].message, new RegExp(`The streamed maps need ${cap.horizontal.refusedFrom} of the ${cap.horizontal.largest} 8 KB program regions ${name} has free for world data\\. Shrink a streamed map`));
  assert.deepEqual(refused(mk('vertical', cap.vertical.largest)).map((x) => x.message), []);
  assert.ok(refused(mk('vertical', cap.vertical.largest + 1)).some((x) => x.where === 'Map Forge' && /at most 255/.test(x.message)), 'the grid ceiling, not capacity, bounds a vertical ring');
});

// ---------------------------------------------------------------------------------------------------------------- (g) RPG capacity, through the real refusal

// A streamed RPG's horizontal depth, measured by handoff-next/s5-c2/capacity.mjs (log capacity.log) through validateProject + checkCapacity + a real build (no bypass): the battle bank takes one
// 8 KB region off the front, so an RPG is one row shallower than the same action project on MMC1 / MMC3 (13 / 29 against 14 / 30) and, on UNROM 512, two regions shallower when it keeps
// its two default tilesets (Main + Battle; each CHR-RAM tileset is a payload region): 59 against 61, and 60 for the lightest (one-tileset) RPG. The vertical ring is bounded by the grid only.
// Hardcoded on purpose. The U512 figure 60 is ADMITTED, not certified: the ring gate's RPG cells ran at 59 (S4c C2); C3 measures the 60th row (docs/design-streamed-worlds-phase3b.md section 17).
const RPG_CAPACITY = {
  [MMC1]: { oneTileset: 13, twoTilesets: 13 },
  [MMC3]: { oneTileset: 29, twoTilesets: 29 },
  [U512]: { oneTileset: 60, twoTilesets: 59 }
};
const rpgRing = (board, mirroring, n, tilesets) => {
  const p = project({ mapper: board, mirroring, gameType: 'rpg', gridW: mirroring === 'vertical' ? n : 1, gridH: mirroring === 'vertical' ? 1 : n });
  return tilesets === 1 ? oneTilesetRpg(p) : p;
};
const refusedErrors = (p) => [...validateProject(p), ...checkCapacity(p).problems].filter((x) => x.severity === 'error');
for (const board of RING_BOARDS) test(`(g) capacity: the largest streamed RPG 1 x N on a horizontal ${resolveMapper(board).name} ring is ${RPG_CAPACITY[board].oneTileset} (one tileset) / ${RPG_CAPACITY[board].twoTilesets} (two) and one more is refused naming the Forge; N x 1 on vertical reaches the 255 grid ceiling`, () => {
  // Catches a region count off by one for an RPG (the battle bank not charged: MMC1 14 / MMC3 30 / UNROM 512 61 admitted; or charged twice), a CHR-RAM tileset page not charged on UNROM 512
  // (60 admitted for the default two-tileset RPG), an RPG given the action board's figure, a vertical RPG limited like the horizontal one, and a refusal that names the wrong Forge.
  const name = resolveMapper(board).name;
  for (const [key, tilesets] of [['oneTileset', 1], ['twoTilesets', 2]]) {
    const largest = RPG_CAPACITY[board][key];
    assert.deepEqual(refusedErrors(rpgRing(board, 'horizontal', largest, tilesets)).map((x) => x.message), [], `${name} ${key}: 1 x ${largest} is admitted`);
    const over = refusedErrors(rpgRing(board, 'horizontal', largest + 1, tilesets));
    assert.equal(over.length, 1, `${name} ${key}: 1 x ${largest + 1} is refused once`);
    assert.equal(over[0].where, 'Map Forge');
    assert.match(over[0].message, new RegExp(`The streamed maps need ${largest + 1} of the ${largest} 8 KB program regions ${name} has free for world data\\. Shrink a streamed map`));
    assert.deepEqual(refusedErrors(rpgRing(board, 'vertical', 255, tilesets)).map((x) => x.message), [], `${name} ${key}: 255 x 1 vertical is admitted`);
    assert.ok(refusedErrors(rpgRing(board, 'vertical', 256, tilesets)).some((x) => x.where === 'Map Forge' && /at most 255/.test(x.message)), 'the grid ceiling, not capacity, bounds a vertical ring');
  }
});

// ---------------------------------------------------------------------------------------------------------------- (d) the switch preflight

test('(d) no board is ever offered, and no preflight is silent, for a streamed project that then fails validate: exhaustive over the admission table', () => {
  // Catches UI drift: switchableMappers offering a board whose ring is refused, or checkStreamedMapperSwitch (the preflight) missing a refusal kind
  // (an RPG offered MMC3 because 'ringGame' was left out of its loop).
  for (const c of TABLE) {
    const p = project(c);
    reconcileCartridge(p); // a project on the Build panel is always reconciled
    const from = resolveMapper(p.cartridge.mapper);
    for (const offered of switchableMappers(p, from)) {
      const moved = structuredClone(p);
      moved.cartridge.mapper = offered.id;
      reconcileCartridge(moved);
      assert.deepEqual(streamedBoardProblems(moved), [], `${labelOf(c)}: ${offered.name} offered but refused`);
    }
    for (const candidate of [MMC1, MMC3, U512]) {
      for (const mirroring of ['vertical', 'horizontal', 'fourscreen']) {
        const moved = structuredClone(p);
        moved.cartridge.mapper = candidate;
        moved.cartridge.mirroring = mirroring;
        reconcileCartridge(moved);
        const board = streamedBoardProblems(moved);
        const refusals = checkStreamedMapperSwitch(p, candidate, mirroring);
        // grids here are tiny, so the aggregate region check never fires: the preflight answers exactly what the board rules answer
        assert.equal(refusals.length > 0, board.length > 0, `${labelOf(c)} -> ${resolveMapper(candidate).name} ${mirroring}`);
        // and it never answers with a tier later than the first failing one
        const first = ['capability', 'ringGame', 'deadAxis'].find((kind) => board.some((x) => x.kind === kind));
        if (first) assert.deepEqual(refusals, board.filter((x) => x.kind === first).map((x) => x.message));
      }
    }
  }
});

test('(d) reconcileCartridge on a mapper/mirroring change reconciles to a mirroring the new board has, so admission sees the post-switch shape', () => {
  // Catches a Build-panel commit that skips reconcile: a streamed U512 four-screen project moved to MMC3 must end on a ring mirroring (vertical), never
  // keep 'fourscreen' on a board with no such wiring; and a hand-edited mirroring MMC3 does not have falls back too. UNROM 512 is the board that KEEPS
  // four-screen (S4c, asserted in the Build panel test below), so it is never the board that falls back.
  const p = project({ mapper: U512, mirroring: 'fourscreen', gridW: 4, gridH: 1 });
  p.cartridge.mapper = MMC3;
  reconcileCartridge(p);
  assert.equal(p.cartridge.mirroring, 'vertical');
  assert.deepEqual(kinds(p), []);
  const q = project({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 4 });
  q.cartridge.mirroring = 'fourscreen';
  reconcileCartridge(q);
  assert.equal(q.cartridge.mirroring, 'vertical');
  // MMC1 the same (S4b): moving a four-screen U512 project to MMC1 lands on a ring mirroring, and a hand-edited four-screen MMC1 falls back to vertical
  const r = project({ mapper: U512, mirroring: 'fourscreen', gridW: 4, gridH: 1 });
  r.cartridge.mapper = MMC1;
  reconcileCartridge(r);
  assert.equal(r.cartridge.mirroring, 'vertical');
  assert.deepEqual(kinds(r), []);
  const s = project({ mapper: MMC1, mirroring: 'horizontal', gridW: 1, gridH: 4 });
  s.cartridge.mirroring = 'fourscreen';
  reconcileCartridge(s);
  assert.equal(s.cartridge.mirroring, 'vertical');
});

// The Build panel's mirroring <select> commits through `store.commit('Change mirroring', (draft) => {...})` and CLAUDE.md requires reconcileCartridge in that same commit. The panel is DOM
// (renderer/forges/build/build.js cannot be mounted under node:test), so the callback is EXECUTED, not text-matched: acorn finds the commit call in the real source, the callback's own source is
// compiled with only `id` (the selected value, a closure variable of the onchange handler) and the real reconcileCartridge bound, and it runs on real drafts. A commented-out assignment
// (`draft.cartridge.mirroring = 'vertical'; // draft.cartridge.mirroring = id;` -- the S4b C1 review's escape of the old source-text pin), a dropped reconcile, or a reconcile before the
// assignment each leave a different draft and fail below.
function buildPanelMirroringCallback() {
  const text = fs.readFileSync(path.join(ROOT, 'renderer/forges/build/build.js'), 'utf8');
  const found = [];
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    const c = node.callee;
    if (node.type === 'CallExpression' && c?.type === 'MemberExpression' && c.object?.name === 'store' && c.property?.name === 'commit' && node.arguments[0]?.value === 'Change mirroring') found.push(node.arguments[1]);
    for (const k of Object.keys(node)) for (const v of Array.isArray(node[k]) ? node[k] : [node[k]]) if (v && typeof v === 'object') walk(v);
  };
  walk(parse(text, { ecmaVersion: 'latest', sourceType: 'module' }));
  assert.equal(found.length, 1, "exactly one store.commit('Change mirroring', ...) in the Build panel");
  assert.equal(found[0].type, 'ArrowFunctionExpression');
  return new Function('reconcileCartridge', 'id', `return (${text.slice(found[0].start, found[0].end)});`);
}
test("(d) the Build panel's mirroring commit assigns the SELECTED mirroring and reconciles the same draft: the real callback, executed, on UNROM 512, MMC1 and MMC3 drafts (a commented-out assignment, a dropped reconcile and a reconcile-first order are all caught)", () => {
  const callback = (id) => buildPanelMirroringCallback()(reconcileCartridge, id);
  for (const gameType of GAME_TYPES) for (const board of RING_BOARDS.filter((id) => id !== U512)) { // MMC1 / MMC3 have no four-screen wiring; UNROM 512 is the next block. Both game types (S5): a reconcile skipped only for an RPG would pass an action-only loop
    const name = `${resolveMapper(board).name} ${gameType}`;
    // vertical -> horizontal on a 1 x 1 streamed map (admitted on both mirrorings): the selection lands, and the draft is still admitted
    const d = project({ mapper: board, mirroring: 'vertical', gameType, gridW: 1, gridH: 1 });
    callback('horizontal')(d);
    assert.equal(d.cartridge.mirroring, 'horizontal', `${name}: the callback assigns the selected mirroring`);
    assert.deepEqual(kinds(d), [], `${name}: and the draft is still admitted`);
    callback('vertical')(d);
    assert.equal(d.cartridge.mirroring, 'vertical', `${name}: and back`);
    // a mirroring the board does not have (a hand-edited or stale selection): the assignment lands and RECONCILE, in the same callback, takes it back to a ring mirroring
    const f = project({ mapper: board, mirroring: 'horizontal', gameType, gridW: 1, gridH: 1 });
    callback('fourscreen')(f);
    assert.equal(f.cartridge.mirroring, 'vertical', `${name}: four-screen is not offered, reconcile falls back to vertical inside the same commit`);
    assert.deepEqual(kinds(f), []);
  }
  // UNROM 512 does have four-screen: the selection must SURVIVE reconcile there (a reconcile that always reset the mirroring would pass the MMC1/MMC3 half above)
  for (const gameType of GAME_TYPES) {
    const u = project({ mapper: U512, mirroring: 'vertical', gameType, gridW: 4, gridH: 1 });
    callback('fourscreen')(u);
    assert.equal(u.cartridge.mirroring, 'fourscreen', `UNROM 512 ${gameType} keeps the four-screen selection through reconcile`);
  }
  // The transitions between the torus and the ring on a STREAMED UNROM 512 project (S4c): the one board whose mirroring choices include both.
  //   a 1 x 1 world is valid on every mirroring: ring -> ring -> torus, each admitted, the selection kept
  const w = project({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: 1 });
  callback('horizontal')(w);
  assert.equal(w.cartridge.mirroring, 'horizontal');
  assert.deepEqual(kinds(w), [], 'torus -> horizontal ring on a 1 x 1 action world is admitted');
  callback('vertical')(w);
  assert.deepEqual(kinds(w), [], 'and vertical');
  callback('fourscreen')(w);
  assert.equal(w.cartridge.mirroring, 'fourscreen');
  assert.deepEqual(kinds(w), []);
  //   a torus-shaped world (3 x 2) moved onto a ring is the dead axis's to refuse -- the commit does not touch the map, the validate result does the talking
  const wide = project({ mapper: U512, mirroring: 'fourscreen', gridW: 3, gridH: 2 });
  callback('horizontal')(wide);
  assert.equal(wide.cartridge.mirroring, 'horizontal');
  assert.deepEqual(kinds(wide), ['deadAxis'], 'torus -> ring on a 3 x 2 world: refused by the dead axis, not silently accepted');
  assert.equal(wide.maps[0].gridW, 3, 'the commit leaves the authored grid alone');
  //   a streamed RPG moved from the torus (where it streams) onto a ring is admitted since S5 (a 1 x 1 world), and a torus-shaped one is the dead axis's to refuse, as for an action game
  const rpg = project({ mapper: U512, mirroring: 'fourscreen', gameType: 'rpg', gridW: 1, gridH: 1 });
  assert.deepEqual(kinds(rpg), []);
  callback('horizontal')(rpg);
  assert.deepEqual(kinds(rpg), [], 'torus RPG -> ring: admitted');
  callback('fourscreen')(rpg);
  assert.deepEqual(kinds(rpg), [], 'and back to the torus');
  const wideRpg = project({ mapper: U512, mirroring: 'fourscreen', gameType: 'rpg', gridW: 3, gridH: 2 });
  callback('vertical')(wideRpg);
  assert.deepEqual(kinds(wideRpg), ['deadAxis'], 'torus RPG 3 x 2 -> ring: the dead axis, not a game-type refusal');
  //   ring -> torus spends a CHR-RAM page (tilesetLimit), so the SAME commit has to trim the tilesets: reconcile in the commit, not after it
  const four = project({ mapper: U512, mirroring: 'horizontal', gridW: 1, gridH: 6 });
  while (four.tilesets.length < 4) four.tilesets.push(structuredClone(four.tilesets[0]));
  four.maps[0].tilesetId = 3;
  callback('fourscreen')(four);
  assert.equal(four.cartridge.mirroring, 'fourscreen');
  assert.equal(four.tilesets.length, 3, 'four-screen has one tileset fewer: the same commit trims it');
  assert.equal(four.maps[0].tilesetId, 0, 'and re-points the map that used the trimmed tileset');
  assert.deepEqual(kinds(four), [], 'a 1 x 6 world is a valid torus');
});

// ---------------------------------------------------------------------------------------------------------------- (e) saves

for (const board of RING_BOARDS) for (const gameType of GAME_TYPES) test(`(e) ${resolveMapper(board).name} ${gameType}: a mirroring-only edit keeps saveCompatToken and the save identity; a resize invalidates (ruling 3)`, () => {
  // Catches a mirroring edit that redraws saveCompatToken (every save on that project would be refused after flipping V/H), and the opposite: a resize that
  // does not (a save could land in a room that no longer is). Only a 1 x 1 streamed map is valid on BOTH mirrorings (the dead axis flips), so the
  // valid mirroring-only edits are degenerate (ruling 3, discharged as engineering at S4a). Both game types since S5: an RPG's reconcile must not take a different path.
  const p = project({ mapper: board, mirroring: 'vertical', gameType, gridW: 1, gridH: 1 });
  assert.deepEqual(kinds(p), []);
  const token = p.project.saveCompatToken ?? 0;
  const identity = saveIdentity(p);
  p.cartridge.mirroring = 'horizontal';
  reconcileCartridge(p);
  assert.deepEqual(kinds(p), [], 'the edited project is still admitted');
  assert.equal(p.project.saveCompatToken ?? 0, token, 'saveCompatToken unchanged by a mirroring-only edit');
  assert.equal(saveIdentity(p), identity, 'the save identity is unchanged');
  // a resize (the same horizontal project, 1 x 1 -> 1 x 2) draws a new token and changes the identity
  assert.notEqual(growOrShrinkMap(p, 0, 1, 2), null);
  assert.notEqual(p.project.saveCompatToken ?? 0, token, 'a resize redraws saveCompatToken');
  assert.notEqual(saveIdentity(p), identity, 'and invalidates every earlier save');
  // a mirroring edit that makes the project invalid does not touch the token either (the refusal is validate's, not the save's)
  const q = project({ mapper: board, mirroring: 'vertical', gameType, gridW: 4, gridH: 1 });
  const qToken = q.project.saveCompatToken ?? 0;
  q.cartridge.mirroring = 'horizontal';
  reconcileCartridge(q);
  assert.deepEqual(kinds(q), ['deadAxis'], 'an N x 1 map becomes refused when the mirroring flips');
  assert.equal(q.project.saveCompatToken ?? 0, qToken);
});

const realTree = () => makeBypassTree({ bypass: false });

const FLASH_BANK = 30; // flashSaveSectorBank(UNROM 512), shared/cartridge.js (flashsave.test.js hardcodes it the same way); the sector is the top 4 KB of that 16 KB bank
const FLASH_SECTOR = 0x3000;
for (const cellId of ['MMC3-V', 'MMC1-V', 'U512-V']) test(`(e) ${cellId}: a save made on vertical mirroring Continues on horizontal after a mirroring-only edit: the ring is reconstructed (nametable + attribute oracle after the landing)`, { skip }, async (t) => {
  // Catches a save that did not survive the edit (Continue unavailable or a fresh start), a landing that put the player somewhere else, and a ring that was
  // not rebuilt for the new mirroring: the live nametables must equal the independent oracle (terrain + attributes) for the HORIZONTAL ring. On MMC1 the
  // mirroring is the software-controlled serial control register, so a ROM whose control-register write kept the old mirroring would fail the oracle here.
  // On UNROM 512 the save medium is the flash sector inside the ROM image (no battery RAM): the carry is that 4 KB sector, copied from the vertical ROM's
  // flash bank into the horizontal ROM's, and a mirroring edit that moved the sector (or redrew the identity the save is checked against) would lose it.
  const battery = cellId !== 'U512-V';
  const tree = realTree();
  t.after(() => tree.dispose());
  const loaded = await loadBypassTree(tree);
  const cellV = cellById(cellId);
  const { project: projA } = ringProject({
    cell: cellV, n: 1, talkers: 'none',
    mutate: (p) => {
      p.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
      const actorId = p.sprites.actors.length - 1;
      p.maps.push(createMap(p.maps.length, 'Title'));
      p.project.titleMap = p.maps.length - 1;
      p.project.titleScreen = 0;
      p.maps[0].screens[0].entities.push({ actorId, x: 200, y: 120, props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } } });
    }
  });
  const projB = structuredClone(projA);
  projB.cartridge.mirroring = 'horizontal';
  reconcileCartridge(projB);
  assert.equal(projB.project.saveCompatToken ?? 0, projA.project.saveCompatToken ?? 0);
  assert.deepEqual(kinds(projB), []);
  const a = await buildThrough(loaded, projA);
  const b = await buildThrough(loaded, projB);
  try {
    const nesA = bootRom(a.romPath);
    const saved = runSteps(nesA, [{ op: 'title' }, { op: 'boot' }, { op: 'save', btn: 'right', axis: 'x', max: 3000, target: 's', battery }]);
    assert.equal(saved.find((r) => r.label === 'hold:save:s').hold.reached, true, 'the save was written to the battery RAM');
    const placeA = readState(nesA);
    assert.ok(placeA.player_x > 120, `the player stood away from the start when saving (x ${placeA.player_x})`);
    const sram = battery ? nesA.cpu.mem.slice(0x6000, 0x8000) : Uint8Array.from(nesA.rom.rom[FLASH_BANK].subarray(FLASH_SECTOR, FLASH_SECTOR + 0x1000));
    if (!battery) assert.ok(sram.some((v) => v !== 0xff), 'the flash sector holds the save (it shipped blank)');

    // the SAME save in the horizontal ROM: Continue must find it and land the player where it was saved
    // (the flash chip writes through to nes.romData, so the carried sector goes into the ROM FILE the horizontal NES boots from, at its iNES offset)
    let romB = b.romPath;
    if (!battery) {
      const bytes = fs.readFileSync(b.romPath);
      bytes.set(sram, 16 + FLASH_BANK * 0x4000 + FLASH_SECTOR);
      romB = `${b.romPath}.carried.nes`;
      fs.writeFileSync(romB, bytes);
    }
    const nesB = bootRom(romB);
    if (battery) nesB.cpu.mem.set(sram, 0x6000);
    const records = runSteps(nesB, [{ op: 'cycle', axis: 'x', target: 's', battery }, { op: 'check', label: 'continued' }]);
    const cycle = records.find((r) => r.label === 'hold:cycle:s');
    assert.equal(cycle.hold.reached, true, `Continue landed on the streamed map from the other mirroring's save (${cycle.hold.why})`);
    const rec = records.find((r) => r.label === 'continued');
    assert.equal(rec.state.player_x, placeA.player_x, 'the landing is the saved x');
    assert.equal(rec.state.player_y, placeA.player_y, 'the landing is the saved y');
    const verdict = judge(rec, { project: projB, ring: 2, gridW: 1, gridH: 1 });
    assert.deepEqual(verdict.fails, [], 'both live nametables ($2000/$2800) match the oracle, attributes included');
    assert.equal(rec.state.map_is_streamed, 1);

    // control: without the save the same ROM has no Continue (so the landing above really came from the carried save)
    const fresh = bootRom(b.romPath);
    const none = runSteps(fresh, [{ op: 'cycle', axis: 'x', target: 's', battery }]);
    assert.equal(none.find((r) => r.label === 'hold:cycle:s').hold.reached, false, 'no save, no Continue');
  } finally {
    fs.rmSync(a.dir, { recursive: true, force: true });
    fs.rmSync(b.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------------------- builds, no bypass

test('an admitted UNROM 512 / MMC1 / MMC3 action AND RPG ring builds through the real cli.js path on both mirrorings (no lift, no bypass), and the refused neighbours do not', { skip }, async (t) => {
  // Catches a validate that admits but a build gate that still refuses (or the reverse): the CLI is the shipped path. Every RPG row here was `ok: false` until S5. MMC1 and MMC3 take mirroring from their
  // own registers (generated MAPPER_MIRROR), but the header's mirroring bit is still the project's, so it is checked on every ring board. UNROM 512 four-screen
  // (the torus) builds as it always did.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'admit-cli-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const cases = [
    { name: 'v', c: { mapper: MMC3, mirroring: 'vertical', gridW: 4, gridH: 1 }, ok: true },
    { name: 'h', c: { mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 4 }, ok: true },
    { name: 'mmc1v', c: { mapper: MMC1, mirroring: 'vertical', gridW: 4, gridH: 1 }, ok: true },
    { name: 'mmc1h', c: { mapper: MMC1, mirroring: 'horizontal', gridW: 1, gridH: 4 }, ok: true },
    { name: 'u512v', c: { mapper: U512, mirroring: 'vertical', gridW: 4, gridH: 1 }, ok: true },
    { name: 'u512h', c: { mapper: U512, mirroring: 'horizontal', gridW: 1, gridH: 4 }, ok: true },
    { name: 'u512torus', c: { mapper: U512, mirroring: 'fourscreen', gridW: 3, gridH: 2 }, ok: true },
    { name: 'u512rpg', c: { mapper: U512, mirroring: 'vertical', gameType: 'rpg', gridW: 4, gridH: 1 }, ok: true },
    { name: 'u512rpgh', c: { mapper: U512, mirroring: 'horizontal', gameType: 'rpg', gridW: 1, gridH: 4 }, ok: true },
    { name: 'u512rpgtorus', c: { mapper: U512, mirroring: 'fourscreen', gameType: 'rpg', gridW: 3, gridH: 2 }, ok: true },
    { name: 'u512rpgwrongaxis', c: { mapper: U512, mirroring: 'horizontal', gameType: 'rpg', gridW: 4, gridH: 1 }, ok: false },
    { name: 'u512rpg2x2', c: { mapper: U512, mirroring: 'vertical', gameType: 'rpg', gridW: 2, gridH: 2 }, ok: false },
    { name: 'nromrpg', c: { mapper: 0, mirroring: 'horizontal', gameType: 'rpg', gridW: 1, gridH: 4 }, ok: false },
    { name: 'u512wrongaxis', c: { mapper: U512, mirroring: 'vertical', gridW: 1, gridH: 4 }, ok: false },
    { name: 'nrom', c: { mapper: 0, mirroring: 'horizontal', gridW: 1, gridH: 4 }, ok: false },
    { name: 'rpg', c: { mapper: MMC3, mirroring: 'vertical', gameType: 'rpg', gridW: 4, gridH: 1 }, ok: true },
    { name: 'rpgh', c: { mapper: MMC3, mirroring: 'horizontal', gameType: 'rpg', gridW: 1, gridH: 4 }, ok: true },
    { name: 'mmc1rpg', c: { mapper: MMC1, mirroring: 'vertical', gameType: 'rpg', gridW: 4, gridH: 1 }, ok: true },
    { name: 'mmc1rpgh', c: { mapper: MMC1, mirroring: 'horizontal', gameType: 'rpg', gridW: 1, gridH: 4 }, ok: true },
    { name: 'mmc3rpg2x2', c: { mapper: MMC3, mirroring: 'horizontal', gameType: 'rpg', gridW: 2, gridH: 2 }, ok: false },
    { name: 'mmc1rpgwrongaxis', c: { mapper: MMC1, mirroring: 'vertical', gameType: 'rpg', gridW: 1, gridH: 4 }, ok: false },
    { name: 'wrongaxis', c: { mapper: MMC3, mirroring: 'vertical', gridW: 1, gridH: 4 }, ok: false },
    { name: 'mmc1wrongaxis', c: { mapper: MMC1, mirroring: 'horizontal', gridW: 4, gridH: 1 }, ok: false }
  ];
  for (const { name, c, ok } of cases) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    await saveProject(dir, project(c));
    const run = spawnSync('node', [path.join(ROOT, 'main/build/cli.js'), dir], { encoding: 'utf8' });
    const rom = path.join(dir, 'build/game.nes');
    if (ok) {
      assert.equal(run.status, 0, `${name}: ${run.stderr}${run.stdout}`.slice(0, 600));
      const bytes = fs.readFileSync(rom);
      assert.equal(bytes[6] >> 4, c.mapper & 0xf, `${name}: a ROM for the project's own mapper`);
      if (c.mirroring !== 'fourscreen') assert.equal(bytes[6] & 1, c.mirroring === 'vertical' ? 1 : 0, `${name}: the iNES mirroring bit follows the project`);
      else assert.equal(bytes[6] & 8, 8, `${name}: the iNES four-screen bit`);
    } else {
      assert.notEqual(run.status, 0, `${name} must be refused`);
      assert.ok(!fs.existsSync(rom), `${name}: no ROM`);
    }
  }
});

test('the boundary builds: MMC3 1 x 30 / MMC1 1 x 14 / UNROM 512 1 x 61 horizontal and 255 x 1 vertical assemble through the real path, and one more region does not', { skip }, async (t) => {
  // Catches a capacity figure that validate accepts but nesasm cannot place (or that refuses a fit): the edges, built, on every ring board.
  const tree = realTree();
  t.after(() => tree.dispose());
  const loaded = await loadBypassTree(tree);
  for (const board of RING_BOARDS) {
    const cap = CAPACITY[board];
    for (const [mirroring, n] of [['horizontal', cap.horizontal.largest], ['vertical', cap.vertical.largest]]) {
      const built = await buildThrough(loaded, project({ mapper: board, mirroring, gridW: mirroring === 'vertical' ? n : 1, gridH: mirroring === 'vertical' ? 1 : n }));
      try { assert.ok(fs.existsSync(built.romPath), `${resolveMapper(board).name} ${mirroring} ${n}`); } finally { fs.rmSync(built.dir, { recursive: true, force: true }); }
    }
    await assert.rejects(() => buildThrough(loaded, project({ mapper: board, mirroring: 'horizontal', gridW: 1, gridH: cap.horizontal.refusedFrom })),
      new RegExp(`need ${cap.horizontal.refusedFrom} of the ${cap.horizontal.largest} 8 KB program regions`));
  }
});

test('the boundary builds for a streamed RPG: 1 x 13 / 29 / 60 (one tileset) and 13 / 29 / 59 (two) horizontal and 255 x 1 vertical assemble through the real path, and one more region does not', { skip }, async (t) => {
  // Catches an RPG capacity figure that validate accepts but nesasm cannot place (the battle bank's region, or a CHR page, charged wrongly), and a refusal that is not the Forge-naming one.
  const tree = realTree();
  t.after(() => tree.dispose());
  const loaded = await loadBypassTree(tree);
  for (const board of RING_BOARDS) {
    for (const [key, tilesets] of [['oneTileset', 1], ['twoTilesets', 2]]) {
      const n = RPG_CAPACITY[board][key];
      for (const [mirroring, depth] of [['horizontal', n], ['vertical', 255]]) {
        const built = await buildThrough(loaded, rpgRing(board, mirroring, depth, tilesets));
        try { assert.ok(fs.existsSync(built.romPath), `${resolveMapper(board).name} ${key} ${mirroring} ${depth}`); } finally { fs.rmSync(built.dir, { recursive: true, force: true }); }
      }
      await assert.rejects(() => buildThrough(loaded, rpgRing(board, 'horizontal', n + 1, tilesets)), new RegExp(`need ${n + 1} of the ${n} 8 KB program regions`), `${resolveMapper(board).name} ${key}`);
    }
  }
});

for (const id of ['MMC3-V', 'MMC3-H', 'MMC1-V', 'MMC1-H', 'U512-V', 'U512-H']) for (const gameType of GAME_TYPES) {
  test(`${id} ${gameType}: a lap of the ring on the REAL tree (no refusal lift) -- terrain + attributes of both live nametables after every checkpoint, no alias write`, { skip }, async (t) => {
    // Catches an admission that validates and builds a ROM the ring engine cannot run: the S2/S3 oracle, on production code only. The RPG rows boot a ROM whose project is built by the
    // gate's own ringProject (a party, a battle bank, hero naming OFF so the first screen is the field -- the naming grid on a ring is streamringrpg.test.js (b) and the next test).
    const tree = realTree();
    t.after(() => tree.dispose());
    const loaded = await loadBypassTree(tree);
    const cell = cellById(id);
    const scene = { ...laps({ ring: cell.ring, talkers: 'enter' }), start: {} };
    assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'enter' }), `${id} ${gameType} lap (production)`);
  });
}

// A streamed RPG with hero naming ON: the real tree builds it and the ROM opens the naming grid at a new game, takes a name, and lands on a field whose nametables equal the oracle -- on all
// three boards and both mirrorings (the S5 C1 test of the same picture runs through the bypass copy at the seam; this is the shipped path).
for (const id of ['MMC3-V', 'MMC3-H', 'MMC1-V', 'MMC1-H', 'U512-V', 'U512-H']) {
  test(`${id} rpg: the real tree builds a hero-naming RPG ring that boots past the naming grid onto an oracle-equal field`, { skip }, async (t) => {
    // Catches a ring RPG that the shipped path builds but whose naming grid (hero naming draws through the streamed mapper) leaves the field wrong, or never closes.
    const tree = realTree();
    t.after(() => tree.dispose());
    const loaded = await loadBypassTree(tree);
    const cell = cellById(id);
    const r = await buildRing({ loaded, cell, gameType: 'rpg', mutate: (p) => { p.party[0].renamable = true; } });
    t.after(() => r.dispose());
    const nes = r.boot();
    const m = nes.cpu.mem;
    let f = 0;
    while (m[r.at('game_state')] !== r.at('ST_NAMEENTRY') && f++ < 600) nes.frame();
    assert.equal(m[r.at('game_state')], r.at('ST_NAMEENTRY'), 'hero naming opens at a new game');
    waitForNamingReady(nes);
    finishNamingIfOpen(nes);
    for (let i = 0; i < 90; i++) nes.frame();
    assert.equal(m[r.at('game_state')], 0, 'the naming grid closed onto the field');
    const v = r.judgeNow(nes, 'after-naming');
    assert.deepEqual(v.fails, [], 'both live nametables match the oracle after the grid closes');
  });
}

// ---------------------------------------------------------------------------------------------------------------- (f) the depth pin (S4c Step 1)

// The depth of a HORIZONTAL ring is its row count, and sw_goto's row loop costs 19 cycles per row. The ring gate certified each horizontal action cell at "the deepest world
// the capacity check admits with this workload": the `N=` of handoff-next/s4b-c2-logs-final/s1b-MMC1-H / -MMC3-H / -U512-H-action-resident.log (14, 30, 61), with a read at the
// deepest row (path:deepest-row: one arm sw_goto at row 60 ran the row loop 60 times) priced by the exhaustive cost sweep and a measured G of at most 20,026 against 29,780
// (docs/design-streamed-worlds-phase3b.md section 15). Hardcoded here on purpose: a test that read the ceiling from the code under test would prove nothing.
const CERTIFIED_DEPTH = { [MMC1]: 14, [MMC3]: 30, [U512]: 61 };

test('(f) depth pin: no admitted horizontal ring can be deeper than the depth the ring gate certified (MMC1 14, MMC3 30, UNROM 512 61), for any project the packer sees', () => {
  // Catches a change that lets an admitted world go deeper than the certificate covers: a larger prgUnits on a ring board (UNROM 512 at 33 admits 63), a CHR-RAM tileset
  // no longer charged a region (UNROM 512 at 62), a 1 x N ring costing less than one region per row, a flash-save sector or battle bank that no longer comes off the
  // streamed regions' count made to ADD regions, and a vertical ring that can have rows (its row loop must never iterate). Depth is region-bound, so a heavier or lighter
  // PROJECT can only be shallower than the lightest one; this pins the lightest one to the certified figure from three sides: the packer's ceiling, the real refusal, a second map.
  const refused = (p) => [...validateProject(p), ...checkCapacity(p).problems].filter((x) => x.severity === 'error');
  for (const board of RING_BOARDS) {
    const mapper = resolveMapper(board);
    const certified = CERTIFIED_DEPTH[board];
    // 1. no input to the packer gives a streamed map more than `certified` regions
    let ceiling = 0;
    for (const tilesets of [0, 1, 2, 3, 4]) for (const bankedCode of [0, 1, 2]) for (const reserveFlashSave of [false, true]) ceiling = Math.max(ceiling, screenRegions(mapper, tilesets, bankedCode, { reserveFlashSave }).length);
    assert.equal(ceiling, certified, `${mapper.name}: the most 8 KB regions any project can give streamed worlds`);
    assert.equal(streamRegionsPerRow(1), 1, 'a 1 x N map is one region per row, so its depth in rows is its region count');
    // 2. the real refusal, lightest project (one tileset, no Save, no code): N builds-clean, N + 1 is refused naming the Forge
    const mk = (n) => project({ mapper: board, mirroring: 'horizontal', gridW: 1, gridH: n });
    assert.deepEqual(refused(mk(certified)).map((x) => x.message), [], `${mapper.name}: 1 x ${certified}`);
    const over = refused(mk(certified + 1));
    assert.equal(over.length, 1, `${mapper.name}: 1 x ${certified + 1} is refused`);
    assert.equal(over[0].where, 'Map Forge');
    // ...and EVERY grid-valid height above the ceiling, up to the 255 grid limit, is refused too (not only N + 1): a height charge that wraps or masks (`(gridH & 0x3f) * ...`
    // would admit 1 x 64 on UNROM 512 while 61 / 62 still behaved) is an admitted world deeper than the certificate covers. Every refusal names the Forge that fixes it.
    const admittedTooDeep = [];
    for (let n = certified + 1; n <= 255; n++) {
      const problems = refused(mk(n));
      if (problems.length === 0 || !problems.every((x) => x.where === 'Map Forge')) admittedTooDeep.push(n);
    }
    assert.deepEqual(admittedTooDeep, [], `${mapper.name}: heights above ${certified} that were admitted (or refused by something other than the Map Forge)`);
    // 3. a second streamed map shares the same regions: the deepest single map beside another is shallower
    const two = mk(certified - 2);
    const second = createMap(1, 'Second');
    second.gridW = 1; second.gridH = 2; second.streamed = true; second.screens = Array.from({ length: 2 }, () => structuredClone(two.maps[0].screens[0]));
    two.maps.push(second);
    assert.deepEqual(refused(two).map((x) => x.message), [], `${mapper.name}: ${certified - 2} + 2 rows share the ${certified} regions exactly`);
    second.gridH = 3; second.screens.push(structuredClone(second.screens[0]));
    assert.equal(refused(two).length, 1, `${mapper.name}: one row more than the regions is refused`);
    // 4. a vertical ring has no rows: a second row is the dead axis's refusal, so sw_goto's row loop never iterates there
    assert.deepEqual(kinds(project({ mapper: board, mirroring: 'vertical', gridW: 2, gridH: 2 })), ['deadAxis'], `${mapper.name}: vertical is N x 1 only`);
  }
  // 5. what lowers the figure: UNROM 512's Save command takes the last region for the flash sector (60 left), and an RPG's battle bank takes one off the front
  assert.equal(reservesFlashSaveRegion(true, resolveMapper(U512)), true);
  assert.equal(planStreamedRegions(project({ mapper: U512, mirroring: 'horizontal', gridW: 1, gridH: 1 }), resolveMapper(U512), { reserveFlashSave: true }).usable.length, CERTIFIED_DEPTH[U512] - 1);
  assert.equal(screenRegions(resolveMapper(U512), 1, 1).length, CERTIFIED_DEPTH[U512] - 1);
});
