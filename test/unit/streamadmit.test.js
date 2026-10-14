// Large streamed worlds (ROADMAP item 15), phase 3b slices S4a and S4b, commit C1 of each: ADMISSION of the two-nametable ring on MMC3 (S4a) and MMC1 (S4b)
// for action games. UNROM 512 non-four-screen (S4c) and any streamed RPG (S5) are still refused.
//
// What this file pins (the engine behaviour of the ring itself is the streamring*.test.js family, run through the bypass copy; here the
// REAL tree is used -- test/lib/ringbypass.js's `bypass: false` copy has no refusal lift at all):
//   (a) the ring is admitted ONLY for N x 1 / 1 x N on MMC3 and MMC1 action -- an independent table over board x mirroring x game type x grid shape;
//   (b) a streamed RPG on every two-nametable board is refused, with the kind checkStreamedMapperSwitch relies on, and the RPG refusal does not
//       leak onto the one board an RPG already streams on (UNROM 512 four-screen);
//   (c) the dead-axis refusals still fire on MMC3 and MMC1, from cameraAxes;
//   (d) switchableMappers / checkStreamedMapperSwitch never offer a board that then fails validate (exhaustive over the table above);
//   (e) saves (Chris's ruling 3): a mirroring-only edit keeps saveCompatToken and the save identity; a save made on one mirroring Continues on the
//       other and the ring is reconstructed (nametable + attribute oracle after the landing), on both boards; a resize still invalidates;
//   plus the admitted project builds through the real cli.js path on both mirrorings of both boards, and boots past a lap of the ring with no refusal lift.
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
  streamRingAdmittedBoardNames
} from '../../shared/cartridge.js';
import { saveIdentity } from '../../shared/save.js';
import { checkCapacity, checkStreamedMapperSwitch, switchableMappers } from '../../main/build/generate.js';
import { saveProject } from '../../main/project-io.js';
import { createStreamedProject } from '../lib/streamedproject.js';
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
const kinds = (p) => streamedBoardProblems(p).map((x) => x.kind);
const errors = (p) => validateProject(p).filter((x) => x.severity === 'error');

// ---------------------------------------------------------------------------------------------------------------- (a) the admission table

// The EXPECTED behaviour, written down independently of streamRingAdmitted: which boards admit what. MMC3 (S4a) and MMC1 (S4b) action admit both ring
// mirrorings; nothing else on a two-nametable board does; UNROM 512 four-screen (the torus) is untouched; MMC1 / MMC3 have no four-screen wiring.
const RING_BOARDS = [MMC1, MMC3]; // stated here, then checked against the registry datum below
function expectedKinds({ mapper, mirroring, gameType }, gridW, gridH) {
  if (mirroring === 'fourscreen') return mapper === U512 ? [] : ['capability']; // MMC1/MMC3 cannot wire it ("cannot stream a world"): not capable, so no dead axis either
  const out = [];
  if (RING_BOARDS.includes(mapper)) { if (gameType !== 'action') out.push('ringGame'); } else out.push('capability'); // UNROM 512: no ring on this board yet (S4c)
  // the dead axis is judged on every capable two-nametable board, admitted or not: vertical scrolls sideways (N x 1 only), horizontal up and down (1 x N only)
  if (mirroring === 'vertical' && gridH > 1) out.push('deadAxis');
  if (mirroring === 'horizontal' && gridW > 1) out.push('deadAxis');
  return out;
}
const GRIDS = [[1, 1], [6, 1], [1, 6], [2, 2]];
const TABLE = [];
for (const mapper of [MMC1, MMC3, U512]) for (const mirroring of ['vertical', 'horizontal', 'fourscreen']) for (const gameType of ['action', 'rpg']) for (const [gridW, gridH] of GRIDS) TABLE.push({ mapper, mirroring, gameType, gridW, gridH });
const labelOf = (c) => `${resolveMapper(c.mapper).name} ${c.mirroring} ${c.gameType} ${c.gridW}x${c.gridH}`;

test('(a) the ring is admitted for MMC1 and MMC3 action N x 1 / 1 x N only: every board x mirroring x game type x grid shape against an independent table', () => {
  // Catches a lift for any grid (a 2 x 2 or the dead-axis shape accepted), for any board (UNROM 512 accepted), for RPG, a refusal that survived on
  // MMC3 or MMC1 action (MMC1 not lifted), and a lift that also let a hand-edited four-screen MMC1/MMC3 file through. Raw (un-reconciled) projects on purpose.
  for (const c of TABLE) {
    const p = project(c);
    assert.deepEqual(kinds(p), expectedKinds(c, c.gridW, c.gridH), labelOf(c));
    // and validateProject agrees: it is an error exactly when the table says a refusal exists
    const boardErrors = errors(p).filter((x) => /stream/i.test(x.message) && !/camera/i.test(x.message));
    assert.equal(boardErrors.length > 0, expectedKinds(c, c.gridW, c.gridH).length > 0, `${labelOf(c)}: validateProject`);
  }
});

test('(a) the admission predicate is one datum per board: only MMC1 and MMC3 list a game type, and a mirroring that is not a ring is never admitted', () => {
  // Catches a second reading of the board list (a hard-coded mapper id in project.js), an admission that ignores the mirroring, and a board admitted for a
  // game type its datum does not list (MMC1 admitted for RPG, UNROM 512 admitted early).
  for (const mapper of MAPPERS.filter((m) => m.supported)) {
    assert.deepEqual(streamRingAdmittedGameTypes(mapper), RING_BOARDS.includes(mapper.id) ? ['action'] : [], mapper.name);
    for (const mirroring of ['vertical', 'horizontal', 'fourscreen']) {
      for (const gameType of ['action', 'rpg']) {
        const want = RING_BOARDS.includes(mapper.id) && mirroring !== 'fourscreen' && gameType === 'action';
        assert.equal(streamRingAdmitted(mapper, mirroring, gameType), want, `${mapper.name} ${mirroring} ${gameType}`);
      }
      assert.equal(streamRingBoardAdmitted(mapper, mirroring), RING_BOARDS.includes(mapper.id) && mirroring !== 'fourscreen', `${mapper.name} ${mirroring} (board)`);
    }
  }
  assert.equal(streamRingAdmittedBoardNames('action'), 'MMC1 or MMC3', 'the boards the refusal messages name, in registry order');
  assert.equal(streamRingAdmittedBoardNames('rpg'), '', 'no board admits a streamed RPG ring until S5');
});

test('(a) streamedBoardProblems FOLLOWS the registry datum: changing streamRingGameTypes on a board changes what validate admits, with nothing else edited (S4a C1 review P3)', () => {
  // Catches the escaping implementation the review named: `mapper.id !== 4` / `gameType !== 'action'` hard-coded in streamedBoardProblems while the helpers
  // (streamRingAdmitted & co.) stay intact and keep passing the datum-only tests above -- now for both admitted boards, and for the board names the refusal
  // messages carry (a message that still says "MMC1 or MMC3" after MMC1's datum is gone). The registry entry is changed in place and restored in finally.
  const entry = (id) => MAPPERS.find((m) => m.id === id);
  const kindsOf = (mapper, mirroring, gameType) => kinds(project({ mapper, mirroring, gridW: mirroring === 'vertical' ? 6 : 1, gridH: mirroring === 'vertical' ? 1 : 6, gameType }));
  const capabilityText = (mapper, mirroring) => streamedBoardProblems(project({ mapper, mirroring, gridW: 1, gridH: 1 })).find((x) => x.kind === 'capability')?.message ?? '';
  const mmc1 = entry(MMC1), mmc3 = entry(MMC3), u512 = entry(U512);
  const orig = { mmc1: Object.getOwnPropertyDescriptor(mmc1, 'streamRingGameTypes'), mmc3: Object.getOwnPropertyDescriptor(mmc3, 'streamRingGameTypes'), u512: Object.getOwnPropertyDescriptor(u512, 'streamRingGameTypes') };
  assert.deepEqual(mmc3.streamRingGameTypes, ['action']);
  assert.deepEqual(mmc1.streamRingGameTypes, ['action']);
  assert.equal(orig.u512, undefined, 'UNROM 512 has no datum today');
  const set = (m, v) => Object.defineProperty(m, 'streamRingGameTypes', { value: v, configurable: true, writable: true, enumerable: true });
  try {
    for (const [board, other] of [[mmc3, mmc1], [mmc1, mmc3]]) {
      const id = board.id;
      for (const mirroring of ['vertical', 'horizontal']) {
        assert.deepEqual(kindsOf(id, mirroring, 'action'), [], `${board.name} ${mirroring}: as shipped, action is admitted`);
        // the datum removed: action is refused, as a board without a ring (not as a game-type refusal), and the messages stop naming the board
        delete board.streamRingGameTypes;
        assert.deepEqual(kindsOf(id, mirroring, 'action'), ['capability'], `${board.name} ${mirroring}: without the datum it is a board with no ring`);
        assert.deepEqual(kindsOf(id, mirroring, 'rpg'), ['capability']);
        assert.match(capabilityText(id, mirroring), new RegExp(`Streamed maps work on ${other.name} with horizontal or vertical mirroring \\(action games\\)`), `${board.name}: the message names only the board that is still admitted`);
        assert.doesNotMatch(capabilityText(id, mirroring), new RegExp(`${board.name} or|or ${board.name} with`));
        assert.match(streamedBoardProblems(project({ mapper: 0, mirroring, gridW: 1, gridH: 1 })).find((x) => x.kind === 'capability').message, new RegExp(`or ${other.name} with horizontal or vertical mirroring \\(action games\\)`), 'and so does the "cannot stream a world" message');
        // an empty list is the same as none
        set(board, []);
        assert.deepEqual(kindsOf(id, mirroring, 'action'), ['capability'], `${board.name} ${mirroring}: an empty list`);
        // a game type added: RPG follows
        set(board, ['action', 'rpg']);
        assert.deepEqual(kindsOf(id, mirroring, 'rpg'), [], `${board.name} ${mirroring}: rpg added is admitted`);
        // the datum narrowed to rpg only: action is now the refused game type, with the game-type kind (the board still has a ring)
        set(board, ['rpg']);
        assert.deepEqual(kindsOf(id, mirroring, 'action'), ['ringGame'], `${board.name} ${mirroring}: action removed`);
        assert.deepEqual(kindsOf(id, mirroring, 'rpg'), []);
        set(board, orig[board === mmc1 ? 'mmc1' : 'mmc3'].value);
        assert.deepEqual(kindsOf(other.id, mirroring, 'action'), [], 'and the other board is unchanged');
      }
    }
    // the datum ADDED to a board that has none: UNROM 512 action is admitted, its RPG is the game-type refusal, and the messages now name it
    for (const mirroring of ['vertical', 'horizontal']) {
      set(u512, ['action']);
      assert.deepEqual(kindsOf(U512, mirroring, 'action'), [], `${mirroring}: ['action'] added to UNROM 512`);
      assert.deepEqual(kindsOf(U512, mirroring, 'rpg'), ['ringGame']);
      assert.equal(streamRingAdmittedBoardNames('action'), 'UNROM 512 or MMC1 or MMC3', 'registry order');
      delete u512.streamRingGameTypes;
      assert.deepEqual(kindsOf(U512, mirroring, 'action'), ['capability'], 'restored');
    }
    // validateProject, the user-facing gate, follows the same datum
    delete mmc1.streamRingGameTypes;
    assert.ok(errors(project({ mapper: MMC1, mirroring: 'vertical', gridW: 6, gridH: 1 })).some((x) => /stream/i.test(x.message)), 'validateProject refuses MMC1 action when the datum is gone');
  } finally {
    for (const [m, d] of [[mmc1, orig.mmc1], [mmc3, orig.mmc3], [u512, orig.u512]]) {
      if (d) Object.defineProperty(m, 'streamRingGameTypes', d); else delete m.streamRingGameTypes;
    }
  }
  assert.deepEqual(mmc3.streamRingGameTypes, ['action'], 'restored');
  assert.deepEqual(mmc1.streamRingGameTypes, ['action'], 'restored');
  assert.equal('streamRingGameTypes' in u512, false);
  assert.deepEqual(kinds(project({ mapper: MMC3, mirroring: 'vertical', gridW: 6, gridH: 1 })), []);
  assert.deepEqual(kinds(project({ mapper: MMC1, mirroring: 'vertical', gridW: 6, gridH: 1 })), []);
});

test('(a) the refusal messages: UNROM 512 says "not implemented yet on this board" and names MMC1 and MMC3; an admitted board gets no capability refusal; neither is the old "four-screen only" text', () => {
  // Catches a stale message that tells an MMC3 or MMC1 user the board they just were admitted on does not work, and a message that names only MMC3.
  for (const mirroring of ['horizontal', 'vertical']) {
    const found = streamedBoardProblems(project({ mapper: U512, mirroring, gridW: 1, gridH: 1 })).filter((x) => x.kind === 'capability');
    assert.equal(found.length, 1);
    assert.equal(found[0].where, 'Build');
    assert.match(found[0].message, /not implemented yet on this board/);
    assert.match(found[0].message, /MMC1 or MMC3 with horizontal or vertical mirroring \(action games\)/);
    assert.doesNotMatch(found[0].message, /UNROM 512 with four-screen mirroring today/);
    for (const mapper of RING_BOARDS) assert.deepEqual(streamedBoardProblems(project({ mapper, mirroring, gridW: 1, gridH: 1 })).filter((x) => x.kind === 'capability'), [], `${resolveMapper(mapper).name} ${mirroring}`);
  }
  const noStream = streamedBoardProblems(project({ mapper: 0, mirroring: 'horizontal', gridW: 1, gridH: 1 })).filter((x) => x.kind === 'capability');
  assert.match(noStream[0].message, /MMC1 or MMC3 with horizontal or vertical mirroring \(action games\)/, 'the "cannot stream a world" message lists what does work');
});

// ---------------------------------------------------------------------------------------------------------------- (b) RPG

test('(b) a streamed RPG on every two-nametable board is refused (kind ringGame on MMC1 / MMC3, capability on UNROM 512); UNROM 512 four-screen RPG is not', () => {
  // Catches RPG leaking in before S5 -- an admission keyed on the board alone (MMC1 admitted for RPG) -- and the opposite error, an RPG refusal that keys
  // on "any streamed RPG" and breaks the torus RPG that already streams.
  for (const mapper of [MMC1, MMC3, U512]) {
    for (const mirroring of ['vertical', 'horizontal']) {
      const gridW = mirroring === 'vertical' ? 4 : 1;
      const gridH = mirroring === 'vertical' ? 1 : 4;
      const p = project({ mapper, mirroring, gameType: 'rpg', gridW, gridH });
      assert.deepEqual(kinds(p), [RING_BOARDS.includes(mapper) ? 'ringGame' : 'capability'], `${resolveMapper(mapper).name} ${mirroring}`);
      const refusal = errors(p).filter((x) => x.where === 'Build' && /two-nametable ring/.test(x.message));
      assert.equal(refusal.length, 1, 'validateProject carries it, naming the Build panel');
      if (RING_BOARDS.includes(mapper)) {
        assert.match(refusal[0].message, /streamed RPGs are not implemented there yet/);
        assert.match(refusal[0].message, new RegExp(`on ${resolveMapper(mapper).name} with ${mirroring} mirroring`), 'the message names the board it refused');
      }
      // the same project as an action game: admitted on MMC1 and MMC3 only
      const action = project({ mapper, mirroring, gameType: 'action', gridW, gridH });
      assert.equal(errors(action).some((x) => /two-nametable ring/.test(x.message)), !RING_BOARDS.includes(mapper));
    }
  }
  assert.deepEqual(kinds(project({ mapper: U512, mirroring: 'fourscreen', gameType: 'rpg', gridW: 3, gridH: 2 })), [], 'the torus RPG is untouched');
});

// ---------------------------------------------------------------------------------------------------------------- (c) dead axis

for (const MAPPER of [MMC1, MMC3]) test(`(c) the dead-axis refusals still fire on ${resolveMapper(MAPPER).name}, from cameraAxes, for every streamed map`, () => {
  // Catches a wrong dead axis (the vertical ring accepting 1 x N, the horizontal ring accepting N x 1) and a check that only looks at maps[0].
  assert.deepEqual(cameraAxes(resolveMapper(MAPPER), { mirroring: 'vertical' }), { horizontal: true, vertical: false });
  assert.deepEqual(cameraAxes(resolveMapper(MAPPER), { mirroring: 'horizontal' }), { horizontal: false, vertical: true });
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

// Measured through real builds by handoff-next/s4a-c1/capacity.mjs (MMC3) and handoff-next/s4b-c1/capacity.mjs (MMC1; logs capacity.log). The horizontal limit is the board's
// free 8 KB program regions (MMC3 30, MMC1 14 -- the 14 the phase 3b plan measured); the vertical ring is bounded by the grid ceiling alone.
const CAPACITY = {
  [MMC3]: { vertical: { largest: 255, refusedFrom: null }, horizontal: { largest: 30, refusedFrom: 31 } },
  [MMC1]: { vertical: { largest: 255, refusedFrom: null }, horizontal: { largest: 14, refusedFrom: 15 } }
};

for (const board of RING_BOARDS) test(`capacity: the largest 1 x N on a horizontal ${resolveMapper(board).name} ring is ${CAPACITY[board].horizontal.largest} screens and ${CAPACITY[board].horizontal.refusedFrom} is refused naming the Forge; N x 1 on vertical reaches the 255 grid ceiling`, () => {
  // Catches a region count off by one (the largest refused or the first-over accepted), MMC1 given MMC3's 30, and a vertical ring limited like the horizontal one.
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
  // keep 'fourscreen' on a board with no such wiring; and a hand-edited mirroring MMC3 does not have falls back too.
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
  // the Build panel's mirroring commit reconciles in the same commit (CLAUDE.md): pinned at the source, because the panel is DOM
  const build = fs.readFileSync(path.join(ROOT, 'renderer/forges/build/build.js'), 'utf8');
  const at = build.indexOf("store.commit('Change mirroring'");
  assert.ok(at > 0, 'the mirroring commit exists');
  const commit = build.slice(at, build.indexOf('});', at));
  assert.match(commit, /draft\.cartridge\.mirroring = id;[\s\S]*reconcileCartridge\(draft\)/, 'the mirroring edit reconciles inside the same commit');
});

// ---------------------------------------------------------------------------------------------------------------- (e) saves

for (const board of RING_BOARDS) test(`(e) ${resolveMapper(board).name}: a mirroring-only edit keeps saveCompatToken and the save identity; a resize invalidates (ruling 3)`, () => {
  // Catches a mirroring edit that redraws saveCompatToken (every save on that project would be refused after flipping V/H), and the opposite: a resize that
  // does not (a save could land in a room that no longer is). Only a 1 x 1 streamed map is valid on BOTH mirrorings (the dead axis flips), so the
  // valid mirroring-only edits are degenerate (ruling 3, discharged as engineering at S4a).
  const p = project({ mapper: board, mirroring: 'vertical', gridW: 1, gridH: 1 });
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
  const q = project({ mapper: board, mirroring: 'vertical', gridW: 4, gridH: 1 });
  const qToken = q.project.saveCompatToken ?? 0;
  q.cartridge.mirroring = 'horizontal';
  reconcileCartridge(q);
  assert.deepEqual(kinds(q), ['deadAxis'], 'an N x 1 map becomes refused when the mirroring flips');
  assert.equal(q.project.saveCompatToken ?? 0, qToken);
});

const realTree = () => makeBypassTree({ bypass: false });

for (const cellId of ['MMC3-V', 'MMC1-V']) test(`(e) ${cellId}: a save made on vertical mirroring Continues on horizontal after a mirroring-only edit: the ring is reconstructed (nametable + attribute oracle after the landing)`, { skip }, async (t) => {
  // Catches a save that did not survive the edit (Continue unavailable or a fresh start), a landing that put the player somewhere else, and a ring that was
  // not rebuilt for the new mirroring: the live nametables must equal the independent oracle (terrain + attributes) for the HORIZONTAL ring. On MMC1 the
  // mirroring is the software-controlled serial control register, so a ROM whose control-register write kept the old mirroring would fail the oracle here.
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
    const saved = runSteps(nesA, [{ op: 'title' }, { op: 'boot' }, { op: 'save', btn: 'right', axis: 'x', max: 3000, target: 's', battery: true }]);
    assert.equal(saved.find((r) => r.label === 'hold:save:s').hold.reached, true, 'the save was written to the battery RAM');
    const placeA = readState(nesA);
    assert.ok(placeA.player_x > 120, `the player stood away from the start when saving (x ${placeA.player_x})`);
    const sram = nesA.cpu.mem.slice(0x6000, 0x8000);

    // the SAME save in the horizontal ROM: Continue must find it and land the player where it was saved
    const nesB = bootRom(b.romPath);
    nesB.cpu.mem.set(sram, 0x6000);
    const records = runSteps(nesB, [{ op: 'cycle', axis: 'x', target: 's', battery: true }, { op: 'check', label: 'continued' }]);
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
    const none = runSteps(fresh, [{ op: 'cycle', axis: 'x', target: 's', battery: true }]);
    assert.equal(none.find((r) => r.label === 'hold:cycle:s').hold.reached, false, 'no save, no Continue');
  } finally {
    fs.rmSync(a.dir, { recursive: true, force: true });
    fs.rmSync(b.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------------------- builds, no bypass

test('an admitted MMC3 / MMC1 action ring builds through the real cli.js path on both mirrorings (no lift, no bypass), and the refused neighbours do not', { skip }, async (t) => {
  // Catches a validate that admits but a build gate that still refuses (or the reverse): the CLI is the shipped path. MMC1 and MMC3 take mirroring from their
  // own registers (generated MAPPER_MIRROR), but the header's mirroring bit is still the project's, so it is checked on both boards.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'admit-cli-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const cases = [
    { name: 'v', c: { mapper: MMC3, mirroring: 'vertical', gridW: 4, gridH: 1 }, ok: true },
    { name: 'h', c: { mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 4 }, ok: true },
    { name: 'mmc1v', c: { mapper: MMC1, mirroring: 'vertical', gridW: 4, gridH: 1 }, ok: true },
    { name: 'mmc1h', c: { mapper: MMC1, mirroring: 'horizontal', gridW: 1, gridH: 4 }, ok: true },
    { name: 'u512', c: { mapper: U512, mirroring: 'vertical', gridW: 4, gridH: 1 }, ok: false },
    { name: 'rpg', c: { mapper: MMC3, mirroring: 'vertical', gameType: 'rpg', gridW: 4, gridH: 1 }, ok: false },
    { name: 'mmc1rpg', c: { mapper: MMC1, mirroring: 'vertical', gameType: 'rpg', gridW: 4, gridH: 1 }, ok: false },
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
      assert.equal(bytes[6] & 1, c.mirroring === 'vertical' ? 1 : 0, `${name}: the iNES mirroring bit follows the project`);
    } else {
      assert.notEqual(run.status, 0, `${name} must be refused`);
      assert.ok(!fs.existsSync(rom), `${name}: no ROM`);
    }
  }
});

test('the boundary builds: MMC3 1 x 30 / MMC1 1 x 14 horizontal and 255 x 1 vertical assemble through the real path, and one more region does not', { skip }, async (t) => {
  // Catches a capacity figure that validate accepts but nesasm cannot place (or that refuses a fit): the edges, built, on both boards.
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

for (const id of ['MMC3-V', 'MMC3-H', 'MMC1-V', 'MMC1-H']) {
  test(`${id} action: a lap of the ring on the REAL tree (no refusal lift) -- terrain + attributes of both live nametables after every checkpoint, no alias write`, { skip }, async (t) => {
    // Catches an admission that validates and builds a ROM the ring engine cannot run: the S2/S3 oracle, on production code only.
    const tree = realTree();
    t.after(() => tree.dispose());
    const loaded = await loadBypassTree(tree);
    const cell = cellById(id);
    const scene = { ...laps({ ring: cell.ring, talkers: 'enter' }), start: {} };
    assertRingRun(assert, await runScene({ loaded, cell, gameType: 'action', scene, talkers: 'enter' }), `${id} action lap (production)`);
  });
}
