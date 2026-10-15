// Large streamed worlds (ROADMAP item 15), phase 3b slice S6, commit C1: the release checks. The ring itself is pinned by streamadmit.test.js and the streamring*.test.js
// family; what is pinned here is what a USER's project does on it, with nothing new in engine/, main/ or shared/:
//   (a) every shipped starter, moved onto each of the six ring cells (UNROM 512, MMC1, MMC3 x vertical, horizontal) the way the Build panel moves it (reconcileCartridge,
//       camera on, every map streamed), against a HARDCODED expectation table -- three starters are clean, the other two are refused by a rule that predates the ring
//       (switch-bound tiles on a streamed screen; the kernel lookup-table bytes on MMC3 / UNROM 512), and each such refusal is pinned by its message, not just by "has an error";
//   (b) growing a map the wrong way (2 x 1 under horizontal, 1 x 2 under vertical) is the dead-axis refusal, naming the Map Forge, and nothing else;
//   (c) planLibraryImport on a streamed ring project, every LIBRARY_ENTRIES entry on all six cells x both game types: every import succeeds (no entry is refused anywhere), the
//       input is not touched, the plan is the plan for the same project with streaming off, and the applied project has no validate and no capacity errors;
//   (d) a streamed map beside ordinary ones is legal (streamedmixed.test.js pins the engine for it): there is no rule about what a door or warp points at.
// Each test names the wrong implementation it catches. Builds run through the real pipeline, no bypass.
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
  planLibraryImport,
  applyPlannedProject
} from '../../shared/project.js';
import { MAPPERS, resolveMapper, streamRingAdmittedGameTypes } from '../../shared/cartridge.js';
import { STARTERS } from '../../shared/starters/index.js';
import { LIBRARY_ENTRIES } from '../../shared/library/index.js';
import { checkCapacity } from '../../main/build/generate.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';

const U512 = 30;
const MMC1 = 1;
const MMC3 = 4;
const BOARD_NAME = { [U512]: 'UNROM 512', [MMC1]: 'MMC1', [MMC3]: 'MMC3' }; // stated here, then checked against the registry below

// The ring cells, derived from the registry: every supported board that lists a ring game type, times the two two-nametable mirrorings.
const RING_CELLS = MAPPERS.filter((m) => m.supported && streamRingAdmittedGameTypes(m).length).flatMap((m) =>
  ['vertical', 'horizontal'].map((mirroring) => ({ mapper: m.id, name: m.name, mirroring }))
);
const cellLabel = (c) => `${c.name} ${c.mirroring}`;

// checkCapacity's problems already CONTAIN validateProject's (generate.js: `[...validateProject(project), ...]`), so the two lists are united and de-duplicated, never concatenated:
// the S6 audit's probe concatenated them and saw the dungeon message twice per cell. De-duplicating also keeps this helper right if that overlap ever stops.
const errorsOf = (p) => {
  const seen = new Set();
  return [...validateProject(p), ...checkCapacity(p).problems].filter((x) => {
    const key = `${x.severity}|${x.where}|${x.message}`;
    if (x.severity !== 'error' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** A starter moved onto a ring cell the way the Build panel does it: set the board and mirroring, reconcile, camera on, then stream the maps in `streamedMaps` (default all). */
function onRing(starter, cell, { streamedMaps } = {}) {
  const p = starter.build('Release');
  p.cartridge.mapper = cell.mapper;
  p.cartridge.mirroring = cell.mirroring;
  reconcileCartridge(p);
  p.cartridge.camera = true;
  p.maps.forEach((m, i) => { m.streamed = streamedMaps ? streamedMaps.includes(i) : true; });
  return p;
}
const starterOf = (id) => STARTERS.find((s) => s.id === id);

async function buildsOk(p, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  try {
    const { size } = await buildProject({ dir, project: p });
    const rom = fs.readFileSync(path.join(dir, 'build', 'game.nes'));
    assert.equal(rom.length, size, `${label}: the ROM on disk is the one reported`);
    assert.equal(rom[6] >> 4, p.cartridge.mapper & 0xf, `${label}: a ROM for the project's own mapper`);
    assert.equal(rom[6] & 1, p.cartridge.mirroring === 'vertical' ? 1 : 0, `${label}: the iNES mirroring bit follows the project`);
    // the ROM is a STREAMED one: validate reads map.streamed directly, so a generator that built an ordinary world from a streamed project would still pass every check above
    const config = fs.readFileSync(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    assert.match(config, /^STREAMING_ENABLED = 1$/m, `${label}: the streamed-world engine is assembled`);
    assert.match(config, new RegExp(`^STREAM_RING = ${p.cartridge.mirroring === 'vertical' ? 1 : 2}$`, 'm'), `${label}: the ring is the one for this mirroring (1 vertical, 2 horizontal)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------------------- (a) starters on the six cells

// Written down independently of every validator. 'clean' = 0 errors and a build; 'bound' = the switch-bound-tiles rule; 'tables' = the kernel lookup-table capacity rule. Both refusals are
// older than the ring: the dungeon's first screen holds the project's only switch-bound tile, and the `rpg` starter's Save commands plus three maps plus the camera need more kernel-lo table
// bytes than MMC3 or UNROM 512 have free once streaming takes its share (MMC1 has the room). Neither is a ring defect, and the remedy each message names works.
const EXPECTED = {
  'blank-action': { [U512]: 'clean', [MMC1]: 'clean', [MMC3]: 'clean' },
  'blank-rpg': { [U512]: 'clean', [MMC1]: 'clean', [MMC3]: 'clean' },
  overworld: { [U512]: 'clean', [MMC1]: 'clean', [MMC3]: 'clean' },
  dungeon: { [U512]: 'bound', [MMC1]: 'bound', [MMC3]: 'bound' },
  rpg: { [U512]: 'tables', [MMC1]: 'clean', [MMC3]: 'tables' }
};
const REFUSAL = {
  bound: /^.+ · screen \d+ on the streamed map ".+" has switch-bound tiles, which a streamed screen cannot use yet -- remove them, or make this map ordinary\.$/,
  tables: /^The lookup tables need \d+ bytes but only \d+ are free alongside the engine code\. Try removing /
};

test('the ring cells are the registry\'s: UNROM 512, MMC1 and MMC3, both mirrorings -- six, named independently', () => {
  // Catches a cell loop that quietly covers fewer boards (a board dropped from the registry's ring list, or a loop built from a stale list), which every test below would then pass over.
  assert.equal(RING_CELLS.length, 6);
  assert.deepEqual([...new Set(RING_CELLS.map((c) => c.mapper))].sort((a, b) => a - b), [MMC1, MMC3, U512]);
  for (const c of RING_CELLS) assert.equal(c.name, BOARD_NAME[c.mapper], `board ${c.mapper} is the one the table below calls ${BOARD_NAME[c.mapper]}`);
  assert.deepEqual(RING_CELLS.map(cellLabel).sort(), ['MMC1 horizontal', 'MMC1 vertical', 'MMC3 horizontal', 'MMC3 vertical', 'UNROM 512 horizontal', 'UNROM 512 vertical']);
});

test('the expectation table names every shipped starter, and only those', () => {
  // Catches a new starter that ships without anyone deciding what it does on a ring, and a table row for a starter that no longer exists.
  assert.deepEqual(STARTERS.map((s) => s.id).sort(), Object.keys(EXPECTED).sort());
});

for (const starter of STARTERS) {
  test(`(a) the ${starter.id} starter on every ring cell: ${[...new Set(Object.values(EXPECTED[starter.id]))].join(' / ')} exactly as the table says, and a refusal is exactly the one named rule`, () => {
    // Catches a starter that a ring cell refuses for a NEW reason (any message outside the two named rules), a clean starter that gains an error on one board, a refusal that
    // stops firing (the dungeon admitted with its bound tile, the rpg admitted on MMC3 although its tables do not fit), a switch-bound refusal that names the wrong Forge, and a cell loop that skips a cell.
    const covered = new Set();
    for (const cell of RING_CELLS) {
      const p = onRing(starter, cell);
      assert.equal(p.cartridge.mapper, cell.mapper, `${starter.id} ${cellLabel(cell)}: reconcileCartridge keeps the board`);
      assert.equal(p.cartridge.mirroring, cell.mirroring, `${starter.id} ${cellLabel(cell)}: reconcileCartridge keeps the mirroring`);
      assert.ok(p.maps.every((m) => m.streamed), `${starter.id}: every map is streamed`);
      const expected = EXPECTED[starter.id][cell.mapper];
      const errs = errorsOf(p);
      if (expected === 'clean') {
        assert.deepEqual(errs.map((x) => x.message), [], `${starter.id} ${cellLabel(cell)}: clean`);
      } else {
        assert.equal(errs.length, 1, `${starter.id} ${cellLabel(cell)}: exactly one refusal (${errs.map((x) => x.message).join(' | ')})`);
        assert.match(errs[0].message, REFUSAL[expected], `${starter.id} ${cellLabel(cell)}`);
        // The switch-bound rule is the Map Forge's to fix. The lookup-table rule is filed under the Map Forge too, but only because streamedCapacityProblems has no better home for it (its
        // remedies are the camera, a Save command or a streamed map): that attribution is deliberately NOT pinned.
        if (expected === 'bound') assert.equal(errs[0].where, 'Map Forge', `${starter.id} ${cellLabel(cell)}`);
      }
      covered.add(`${cell.mapper}:${cell.mirroring}`);
    }
    assert.equal(covered.size, 6, `${starter.id}: all six cells were checked`);
  });
}

test('(a) the clean starters BUILD on every ring board, one build per starter per board (the mirroring alternates, so both header bits are built)', { skip }, async () => {
  // Catches a project that validates but does not assemble or capacity-checks differently from the build: blank-action, blank-rpg and overworld, each on UNROM 512, MMC1 and MMC3, plus the rpg
  // starter on MMC1, the one board it fits. The ROM must be for the project's own board with the project's own mirroring bit.
  let n = 0;
  for (const [si, id] of ['blank-action', 'blank-rpg', 'overworld', 'rpg'].entries()) {
    const boards = [...new Set(RING_CELLS.map((c) => c.mapper))].filter((m) => EXPECTED[id][m] === 'clean');
    assert.equal(boards.length, id === 'rpg' ? 1 : 3, `${id}: the boards it builds on`);
    for (const [bi, mapper] of boards.entries()) {
      const cell = RING_CELLS.find((c) => c.mapper === mapper && c.mirroring === (['vertical', 'horizontal'][(si + bi) % 2]));
      await buildsOk(onRing(starterOf(id), cell), `${id} ${cellLabel(cell)}`);
      n++;
    }
  }
  assert.equal(n, 10);
});

test('(a, d) the dungeon starter with only maps 1-3 streamed (the bound tile stays on the ordinary map 0) validates on all six cells and builds; its doors cross between ordinary and streamed maps', { skip }, async () => {
  // Catches the switch-bound refusal firing for a map that is not streamed (it must be per streamed map, not per project), and a door from an ordinary map into a streamed one, or the
  // reverse, being refused: there is no rule about what a door or warp points at (streamedmixed.test.js pins the engine for it), only each streamed map's own dead-axis rule.
  const dungeon = starterOf('dungeon');
  for (const cell of RING_CELLS) {
    const p = onRing(dungeon, cell, { streamedMaps: [1, 2, 3] });
    assert.deepEqual(p.maps.map((m) => m.streamed), [false, true, true, true]);
    assert.deepEqual(errorsOf(p).map((x) => x.message), [], `dungeon (maps 1-3 streamed) ${cellLabel(cell)}`);
  }
  // the claim in the title: every map is 1 x 1, so a door's flat target index IS its map index; some door leaves the ordinary map for a streamed one and some leaves a streamed map for the ordinary one
  const p = onRing(dungeon, RING_CELLS[0], { streamedMaps: [1, 2, 3] });
  const doors = p.maps.flatMap((m, from) => m.screens.flatMap((scr) => (scr.entities ?? []).filter((e) => p.sprites.actors[e.actorId]?.behavior === 'door').map((e) => ({ from, to: e.props?.toScreen ?? 0 }))));
  assert.ok(p.maps.every((m) => m.gridW === 1 && m.gridH === 1));
  assert.ok(doors.some((d) => !p.maps[d.from].streamed && p.maps[d.to].streamed), 'a door from the ordinary map into a streamed one');
  assert.ok(doors.some((d) => p.maps[d.from].streamed && !p.maps[d.to].streamed), 'a door from a streamed map into the ordinary one');
  await buildsOk(onRing(dungeon, RING_CELLS.find((c) => c.name === 'MMC3' && c.mirroring === 'vertical'), { streamedMaps: [1, 2, 3] }), 'dungeon maps 1-3 MMC3 vertical');
});

test('(d) the overworld with only map 0 streamed on MMC3 horizontal: its doors lead into ordinary maps, it validates with 0 errors and builds', { skip }, async () => {
  // Catches a rule invented for "a streamed map whose door points at an ordinary map" (there is none: a mixed project is legal, and streamedmixed.test.js pins warps from an ordinary
  // map into a streamed one and out of one into an ordinary one on the engine).
  const cell = RING_CELLS.find((c) => c.name === 'MMC3' && c.mirroring === 'horizontal');
  const p = onRing(starterOf('overworld'), cell, { streamedMaps: [0] });
  assert.deepEqual(p.maps.map((m) => m.streamed), [true, false, false]);
  assert.deepEqual(errorsOf(p).map((x) => x.message), []);
  await buildsOk(p, 'overworld map 0 streamed, MMC3 horizontal');
});

// ---------------------------------------------------------------------------------------------------------------- (b) wrong-way growth

for (const id of ['blank-action', 'blank-rpg']) {
  test(`(b) the ${id} starter grown the wrong way on every ring cell (2 x 1 under horizontal, 1 x 2 under vertical) is refused by the dead axis, naming the Map Forge, and nothing else`, () => {
    // Catches a dead-axis rule that is missing for one orientation or one board (the Map Forge accepting a 2 x 2-shaped world), one that names the wrong Forge, one that fires together with a
    // second, unrelated error (capacity, grid), and growOrShrinkMap refusing instead of leaving the refusal to validate.
    const covered = new Set();
    for (const cell of RING_CELLS) {
      const label = `${id} ${cellLabel(cell)}`;
      const p = onRing(starterOf(id), cell);
      assert.deepEqual(errorsOf(p), [], `${label}: clean before the growth`);
      const horizontal = cell.mirroring === 'horizontal';
      const grown = growOrShrinkMap(p, 0, horizontal ? 2 : 1, horizontal ? 1 : 2);
      assert.notEqual(grown, null, `${label}: a 2-screen streamed map is within the grid rules, so the resize itself is not refused`);
      assert.equal(p.maps[0].gridW * p.maps[0].gridH, 2, label);
      const problems = streamedBoardProblems(p);
      assert.deepEqual(problems.map((x) => x.kind), ['deadAxis'], label);
      assert.equal(problems[0].where, 'Map Forge', label);
      assert.match(problems[0].message, horizontal ? /is 2 screens wide, but .* can only stream up and down, so a streamed map must be 1 screen wide \(1 x N\)\./ : /is 2 screens tall, but .* can only stream side to side, so a streamed map must be 1 screen tall \(N x 1\)\./, label);
      const errs = errorsOf(p);
      assert.deepEqual(errs.map((x) => x.message), [problems[0].message], `${label}: the dead axis is the only error anywhere`);
      assert.equal(errs[0].where, 'Map Forge', label);
      covered.add(`${cell.mapper}:${cell.mirroring}`);
    }
    assert.equal(covered.size, 6, `${id}: all six cells were checked`);
  });
}

// ---------------------------------------------------------------------------------------------------------------- (c) the starter library

test('(c) planLibraryImport on a streamed ring project: every library entry on all six cells x both game types imports, leaves its input alone, plans exactly what it plans with streaming off, and applies to a project with no errors', () => {
  // Catches a plan that writes into the project it was handed (an import gated on map.streamed that mutates the caller's maps, or a shared reference), a plan that reads the streamed flag, the
  // cartridge or the grid and so differs from the non-streamed plan, an import that adds something a streamed ring refuses (a switch-bound tile, a placed actor, a capacity overrun), and a vacuous
  // run (no plan ever succeeds, or a kind never planned). Every one of the 264 plans succeeds today, so a refusal of ANY entry on ANY cell is a failure here: an implementation that
  // refuses one shipped entry identically in the streamed and the ordinary project would otherwise pass the equality below.
  assert.ok(LIBRARY_ENTRIES.length > 0);
  let plans = 0;
  for (const cell of RING_CELLS) for (const gameType of ['action', 'rpg']) {
    const vertical = cell.mirroring === 'vertical';
    const make = (streamed) => {
      const p = createStreamedProject({ mapper: cell.mapper, mirroring: cell.mirroring, gameType, gridW: vertical ? 4 : 1, gridH: vertical ? 1 : 4 });
      p.maps[0].streamed = streamed;
      return p;
    };
    assert.deepEqual(errorsOf(make(true)), [], `${cellLabel(cell)} ${gameType}: the base project is clean`);
    for (const entry of LIBRARY_ENTRIES) {
      const label = `${cellLabel(cell)} ${gameType} ${entry.kind} ${entry.name}`;
      const on = make(true);
      const before = structuredClone(on);
      const planOn = planLibraryImport(on, entry, {});
      assert.deepEqual(on, before, `${label}: the input is unchanged`);
      const planOff = planLibraryImport(make(false), entry, {});
      plans++;
      assert.equal(planOn.ok, true, `${label}: the import succeeds on the streamed project (${planOn.reason ?? ''})`);
      assert.equal(planOff.ok, true, `${label}: the import succeeds on the ordinary project (${planOff.reason ?? ''})`);
      // the plans differ in the streamed flag and in nothing else
      assert.equal(planOn.project.maps[0].streamed, true, label);
      assert.equal(planOff.project.maps[0].streamed, false, label);
      const normalized = (plan, flag) => { const c = structuredClone(plan); c.project.maps[0].streamed = flag; return c; };
      assert.deepEqual(normalized(planOn, 'same'), normalized(planOff, 'same'), `${label}: the plan equals the non-streamed plan`);
      const applied = applyPlannedProject(on, planOn.project);
      assert.deepEqual(errorsOf(applied), [], `${label}: the applied project has no validate or capacity errors`);
    }
  }
  assert.equal(plans, RING_CELLS.length * 2 * LIBRARY_ENTRIES.length);
});
