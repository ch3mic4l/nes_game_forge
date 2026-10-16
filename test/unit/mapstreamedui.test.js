// The Map Forge's streamed-map decisions (renderer/forges/map/streamedui.js): the Streamed checkbox, the
// size fields, the refuse-before-commit preflight and Duplicate screen's room predicate. Pure -- no DOM, no
// map.js. Every test names the wrong implementation it would catch. Board facts are hardcoded where a test
// must not read the code it checks, each with the shared/cartridge.js fact it comes from.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LIMITS,
  createMap,
  createProject,
  createScreen,
  growOrShrinkMap,
  normalizeProject,
  streamedBoardProblems,
  streamedGridProblems,
  validateProject
} from '../../shared/project.js';
import { MAPPERS, mirroringOptions, streamCapable } from '../../shared/cartridge.js';
import { Store } from '../../renderer/store.js';
import {
  applyStreamOff,
  applyStreamOn,
  clampAxis,
  commitAfterConfirm,
  commitIfAllowed,
  duplicateFullMessage,
  errorMessages,
  errorProblems,
  hasDuplicateRoom,
  newErrors,
  planResize,
  planStreamOff,
  planStreamOn,
  ruleKey,
  sizePlan,
  STALE_RESIZE_NOTE,
  streamToggleState
} from '../../renderer/forges/map/streamedui.js';
import { createStreamedProject } from '../lib/streamedproject.js';

// mapper ids: 0 NROM-256, 1 MMC1, 2 UxROM, 3 CNROM, 4 MMC3, 30 UNROM 512 (shared/cartridge.js MAPPERS)
const NROM = 0;
const MMC1 = 1;
const UXROM = 2;
const MMC3 = 4;
const U512 = 30;

const ordinary = (opts) => {
  const p = createStreamedProject(opts);
  for (const map of p.maps) {
    delete map.streamed;
    delete map.fillMetatileId;
  }
  return p;
};
const json = (v) => JSON.stringify(v);
const flagged = (project, index = 0) => {
  const c = structuredClone(project);
  c.maps[index].streamed = true;
  return c;
};
const problem = (where, message) => ({ severity: 'error', where, message });
/** Every legal (mapper, mirroring) pair the registry offers: the matrix the board-shaped tests run over. */
const BOARDS = MAPPERS.filter((m) => m.supported).flatMap((mapper) =>
  mirroringOptions(mapper).map((mirroring) => ({ mapper: mapper.id, mirroring: mirroring.id, name: `${mapper.name} ${mirroring.id}` }))
);

test('the matrix covers every board family (a matrix that silently shrinks would pass anything)', () => {
  for (const id of [NROM, MMC1, UXROM, 3, MMC3, U512]) assert.ok(BOARDS.some((b) => b.mapper === id), `mapper ${id} is in the matrix`);
  assert.ok(BOARDS.some((b) => b.mirroring === 'fourscreen'));
  assert.ok(BOARDS.length >= 12);
});

test('U1 turning Streamed off: allowed up to the ordinary limit on BOTH axes, refused beyond it on either, never by area', () => {
  // Catches an area test (w*h <= 16 allows 16 x 1, which normalizeProject clamps to 4 x 1 on the next load) and a Math.max/sum test.
  const side = 4; // LIMITS.mapGrid, from shared/project.js
  assert.equal(LIMITS.mapGrid, side);
  for (const [w, h] of [[4, 4], [3, 3], [1, 1], [4, 1], [1, 4]]) {
    const p = createStreamedProject({ gridW: w, gridH: h });
    assert.deepEqual(planStreamOff(p, 0), { ok: true }, `${w} x ${h} may stop streaming`);
  }
  for (const [w, h] of [[1, 30], [30, 1], [5, 1], [1, 5], [16, 1], [1, 16], [5, 5], [255, 1]]) {
    const p = createStreamedProject({ gridW: w, gridH: h });
    const plan = planStreamOff(p, 0);
    assert.equal(plan.ok, false, `${w} x ${h} is refused`);
    assert.match(plan.message, new RegExp(`${w} × ${h} screens`), 'the message names the size');
    assert.match(plan.message, /Shrink/, 'and what to do');
  }
  assert.ok(16 * 1 <= side * side, '16 x 1 has an area an area test would accept');
});

test('U2 turning Streamed off leaves exactly an ordinary map: both keys deleted, never set false', () => {
  // Catches `streamed = false` (normalizeMap drops a false flag on the next save, rewriting a fixture, and the in-memory JSON differs from an ordinary map's)
  // and a fillMetatileId left behind.
  const base = ordinary({ gridW: 3, gridH: 3 });
  const on = structuredClone(base);
  applyStreamOn(on, 0);
  assert.equal(on.maps[0].streamed, true);
  on.maps[0].fillMetatileId = 7; // what normalizeProject would have written for a streamed map
  applyStreamOff(on, 0);
  assert.equal('streamed' in on.maps[0], false, 'the key is gone, not false');
  assert.equal('fillMetatileId' in on.maps[0], false);
  assert.equal(json(on.maps[0]), json(base.maps[0]), 'the map equals the ordinary map');
  assert.equal(json(normalizeProject(structuredClone(on)).maps[0]), json(normalizeProject(structuredClone(base)).maps[0]), 'and normalizes identically');
  // turning on writes the flag alone
  const only = structuredClone(base);
  applyStreamOn(only, 0);
  assert.deepEqual(Object.keys(only.maps[0]).filter((k) => !(k in base.maps[0])), ['streamed']);
});

test('U3 the Streamed checkbox: always visible; a streamed map stays clearable on any board; an ordinary map on a board that cannot stream is disabled with the reason', () => {
  // Catches hiding the control when the board cannot stream (a streamed map left on an NROM board by the Build panel would have no UI to clear the flag).
  for (const board of BOARDS) {
    const capable = streamCapable(MAPPERS.find((m) => m.id === board.mapper), board.mirroring);
    const streamed = createStreamedProject({ mapper: board.mapper, mirroring: board.mirroring, gridW: 1, gridH: 1 });
    const s = streamToggleState(streamed, 0);
    assert.equal(s.visible, true, `${board.name}: visible`);
    assert.equal(s.checked, true, `${board.name}: checked`);
    assert.equal(s.enabled, true, `${board.name}: a streamed map is always clearable`);
    assert.equal(s.reason, null);
    assert.equal(typeof s.note === 'string' && s.note.length > 0, !capable, `${board.name}: a note exactly when the board no longer streams`);
    const plain = ordinary({ mapper: board.mapper, mirroring: board.mirroring, gridW: 1, gridH: 1 });
    const o = streamToggleState(plain, 0);
    assert.equal(o.visible, true);
    assert.equal(o.checked, false);
    assert.equal(o.enabled, capable, `${board.name}: enabled exactly when the board can stream`);
    if (!capable) assert.match(o.reason, /cannot stream a world/, `${board.name}: the reason is the validator's own words`);
    else assert.equal(o.reason, null);
  }
  // hardcoded anchors (NROM streams nowhere; MMC3 and UNROM 512 four-screen stream)
  assert.equal(streamToggleState(ordinary({ mapper: NROM, mirroring: 'horizontal' }), 0).enabled, false);
  assert.equal(streamToggleState(ordinary({ mapper: MMC3, mirroring: 'horizontal' }), 0).enabled, true);
  assert.equal(streamToggleState(ordinary({ mapper: U512, mirroring: 'fourscreen' }), 0).enabled, true);
  assert.equal(streamToggleState(createStreamedProject({ mapper: NROM, mirroring: 'horizontal' }), 0).enabled, true);
});

test('U4 turning Streamed on: refused whenever it adds a validateProject error, naming the first new one; allowed when it adds none', () => {
  // Catches a permissive toggle that lets the project go red, and a gate that hard-codes the rule instead of asking validateProject.
  const cases = [
    ['2x2 on MMC3 horizontal', { mapper: MMC3, mirroring: 'horizontal', gridW: 2, gridH: 2 }, /2 screens wide/],
    ['2x2 on MMC3 vertical', { mapper: MMC3, mirroring: 'vertical', gridW: 2, gridH: 2 }, /2 screens tall/],
    ['2x2 on MMC1 vertical', { mapper: MMC1, mirroring: 'vertical', gridW: 2, gridH: 2 }, /2 screens tall/],
    ['NROM horizontal', { mapper: NROM, mirroring: 'horizontal' }, /cannot stream a world/],
    ['UxROM vertical', { mapper: UXROM, mirroring: 'vertical' }, /cannot stream a world/],
    ['camera off', { mapper: U512, mirroring: 'fourscreen', camera: false }, /camera/i]
  ];
  for (const [label, opts, pattern] of cases) {
    const p = ordinary(opts);
    const plan = planStreamOn(p, 0);
    assert.equal(plan.ok, false, `${label}: refused`);
    assert.match(plan.message, pattern, label);
    assert.ok(errorMessages(flagged(p)).includes(plan.message), `${label}: the message is validateProject's own, word for word`);
    assert.ok(!errorMessages(p).includes(plan.message), `${label}: and it is new`);
  }
  for (const [label, opts] of [
    ['1x1 MMC3 horizontal', { mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 1 }],
    ['1x1 MMC3 vertical', { mapper: MMC3, mirroring: 'vertical', gridW: 1, gridH: 1 }],
    ['1x1 MMC1 horizontal', { mapper: MMC1, mirroring: 'horizontal', gridW: 1, gridH: 1 }],
    ['4x4 UNROM 512 four-screen', { mapper: U512, mirroring: 'fourscreen', gridW: 4, gridH: 4 }]
  ]) {
    const p = ordinary(opts);
    assert.deepEqual(planStreamOn(p, 0), { ok: true }, label);
    assert.deepEqual(errorMessages(flagged(p)), errorMessages(p), `${label}: the flagged project is no redder`);
  }
  // an error the project already had does not block: only NEW errors do (a stem match, so a counted message is one rule)
  const red = ordinary({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 1 });
  red.maps.push(createMap(1, 'Second'));
  red.maps[1].streamed = true;
  red.maps[1].gridW = 2; // already a dead-axis error on map 1
  red.maps[1].gridH = 1;
  red.maps[1].screens = [createScreen(), createScreen()];
  assert.ok(errorMessages(red).some((m) => /2 screens wide/.test(m)), 'precondition: the project is already red');
  assert.deepEqual(planStreamOn(red, 0), { ok: true }, 'a 1x1 may stream in a project that is already red for another map');
  const at = (message) => [problem('Map Forge', message)];
  assert.deepEqual(newErrors(at('Map "A" is 2 screens'), at('Map "A" is 3 screens')), [], 'a changed count is the same rule');
  assert.equal(newErrors(at('Map "A" is 2 screens'), [...at('Map "A" is 2 screens'), ...at('Map "B" is 2 screens')]).length, 1, 'a second map failing the same rule is new');
});

test('U5 sizePlan over every board: the dead axis is exactly the one the dead-axis refusal names, held at 1; the live axes reach the streamed ceiling', () => {
  // Catches swapped H/V (vertical mirroring scrolls sideways, so HEIGHT is dead), LIMITS.mapGrid left in the clamp, and a hard-coded mapper list.
  for (const board of BOARDS) {
    const wide = createStreamedProject({ mapper: board.mapper, mirroring: board.mirroring, gridW: 2, gridH: 1 });
    const tall = createStreamedProject({ mapper: board.mapper, mirroring: board.mirroring, gridW: 1, gridH: 2 });
    const refusedWide = streamedBoardProblems(wide).some((p) => p.kind === 'deadAxis');
    const refusedTall = streamedBoardProblems(tall).some((p) => p.kind === 'deadAxis');
    assert.ok(!(refusedWide && refusedTall), `${board.name}: never both axes dead`);
    const expectDead = refusedWide ? 'width' : refusedTall ? 'height' : null;
    const plan = sizePlan(createStreamedProject({ mapper: board.mapper, mirroring: board.mirroring, gridW: 1, gridH: 1 }), 0);
    assert.equal(plan.deadAxis, expectDead, `${board.name}: dead axis`);
    for (const axis of ['width', 'height']) {
      if (axis === expectDead) {
        assert.equal(plan[axis].max, 1, `${board.name}: ${axis} held at 1`);
        assert.equal(plan[axis].locked, true, `${board.name}: ${axis} locked at 1`);
        assert.equal(typeof plan[axis].reason, 'string');
      } else {
        assert.equal(plan[axis].max, LIMITS.streamedGrid, `${board.name}: ${axis} reaches the streamed ceiling`);
        assert.equal(plan[axis].locked, false);
      }
    }
    // an ordinary map keeps the ordinary clamp and no lock on any board
    const plain = sizePlan(ordinary({ mapper: board.mapper, mirroring: board.mirroring, gridW: 2, gridH: 2 }), 0);
    assert.deepEqual([plain.width.max, plain.height.max, plain.width.locked, plain.height.locked, plain.deadAxis], [LIMITS.mapGrid, LIMITS.mapGrid, false, false, null], `${board.name}: ordinary`);
  }
  // hardcoded anchors, from shared/cartridge.js streamRingMode: horizontal mirroring = a column (width dead), vertical = a row (height dead)
  assert.equal(sizePlan(createStreamedProject({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 30 }), 0).deadAxis, 'width');
  assert.equal(sizePlan(createStreamedProject({ mapper: MMC3, mirroring: 'vertical', gridW: 30, gridH: 1 }), 0).deadAxis, 'height');
  assert.equal(sizePlan(createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 16, gridH: 15 }), 0).deadAxis, null);
  assert.equal(LIMITS.streamedGrid, 255);
});

test('U5b the dead axis is repairable: a dead axis already above 1 (the board moved under the map) stays editable and clamps to 1', () => {
  // Catches a lock that disables the field whatever its value, which would leave the shape unfixable except by changing the board back.
  const p = createStreamedProject({ mapper: MMC3, mirroring: 'vertical', gridW: 1, gridH: 5 }); // vertical = row; height is dead and is 5
  const plan = sizePlan(p, 0);
  assert.equal(plan.deadAxis, 'height');
  assert.equal(plan.height.locked, false);
  assert.equal(clampAxis(plan, 'height', 9, 5), 1);
  assert.deepEqual(planResize(p, 0, 1, 1), { ok: true, noop: false });
});

test('U5c clampAxis: the per-map ceiling, whole numbers, and a non-number leaves the size alone', () => {
  // Catches `LIMITS.mapGrid` in the clamp (a 1 x 30 column typed 100 shrinks to 4), a clamp that lets 0 or a fraction through, and NaN reaching resize.
  const col = sizePlan(createStreamedProject({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 30 }), 0);
  assert.equal(clampAxis(col, 'height', 100, 30), 100);
  assert.equal(clampAxis(col, 'height', 300, 30), 255);
  assert.equal(clampAxis(col, 'height', 0, 30), 1);
  assert.equal(clampAxis(col, 'height', '', 30), 1);
  assert.equal(clampAxis(col, 'height', 2.4, 30), 2);
  assert.equal(clampAxis(col, 'height', 'abc', 30), 30);
  assert.equal(clampAxis(col, 'width', 2, 1), 1, 'the dead axis typed 2 is held at 1');
  const plain = sizePlan(ordinary({ gridW: 2, gridH: 2 }), 0);
  assert.equal(clampAxis(plain, 'width', 9, 2), LIMITS.mapGrid);
  assert.equal(clampAxis(plain, 'height', -3, 2), 1);
});

test('U6 planResize: the project-wide total, a streamed map\'s own grid rules and the dead axis refuse; an ordinary-only project is unaffected', () => {
  // Catches a per-axis clamp standing in for the aggregate (growOrShrinkMap itself only checks one map), restating the 255 rule in the renderer, and ignoring growOrShrinkMap's null.
  const mixed = (rows) => {
    const p = createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: rows });
    const other = createMap(1, 'Other');
    other.gridW = 4;
    other.gridH = 4;
    other.screens = Array.from({ length: 16 }, () => createScreen());
    p.maps.push(other);
    return p;
  };
  const p = mixed(200);
  const before = json(p);
  assert.equal(planResize(p, 0, 1, 239).ok, true, '200 -> 239 screens, 239 + 16 = 255: fits');
  const over = planResize(p, 0, 1, 240);
  assert.equal(over.ok, false, '240 + 16 = 256: refused');
  assert.match(over.message, /across all maps/);
  assert.equal(planResize(p, 0, 1, 255).ok, false, 'the old 1x255 case from the audit (271 screens)');
  assert.equal(json(p), before, 'planning never touches the live project');
  // the streamed map's own rules (growOrShrinkMap's null), worded by streamedGridProblems
  const big = createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 16, gridH: 15 });
  const refused = planResize(big, 0, 20, 15);
  assert.equal(refused.ok, false, '20 x 15 = 300 screens');
  assert.equal(refused.message, streamedGridProblems({ maps: [{ name: big.maps[0].name, streamed: true, gridW: 20, gridH: 15 }] })[0].message);
  // the dead axis (a new validateProject error)
  const column = createStreamedProject({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 30 });
  const dead = planResize(column, 0, 2, 30);
  assert.equal(dead.ok, false);
  assert.match(dead.message, /2 screens wide/);
  assert.ok(errorMessages(Object.assign(structuredClone(column), {})).every((m) => m !== dead.message), 'and it is new');
  // an ordinary-only project: grows and shrinks as before, with no refusal
  const plain = ordinary({ gridW: 2, gridH: 2 });
  assert.deepEqual(planResize(plain, 0, 4, 4), { ok: true, noop: false });
  assert.deepEqual(planResize(plain, 0, 1, 1), { ok: true, noop: false });
  // an unchanged size is a no-op, never a commit
  assert.deepEqual(planResize(plain, 0, 2, 2), { ok: true, noop: true });
  // an error the project already had does not block a resize that leaves it
  const red = createStreamedProject({ mapper: MMC3, mirroring: 'vertical', gridW: 1, gridH: 30 }); // height is dead and 30: already a dead-axis error
  assert.ok(errorMessages(red).some((m) => /30 screens tall/.test(m)));
  assert.equal(planResize(red, 0, 1, 20).ok, true, 'shrinking a map that is already red for the same rule is allowed');
});

test('U7 a refused toggle or resize never reaches the store: undo depth and dirty are unchanged; an allowed one is exactly one entry', () => {
  // Catches `commit` wrapping a refused plan (store.commit records an undo entry and sets dirty even when its mutator does nothing).
  const store = new Store();
  store.open('/x', createStreamedProject({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 30 }));
  const snapshot = json(store.project);
  const refusals = [
    [planResize(store.project, 0, 2, 30), 'dead axis'],
    [planResize(store.project, 0, 1, 256), 'over the per-axis ceiling'],
    [planStreamOff(store.project, 0), 'turn-off of a 1 x 30']
  ];
  for (const [plan, label] of refusals) {
    assert.equal(plan.ok, false, label);
    assert.equal(commitIfAllowed(store, plan, 'X', () => assert.fail('the mutator must not run')), false, label);
  }
  assert.equal(store.undoStack.length, 0, 'no undo entry');
  assert.equal(store.dirty, false);
  assert.equal(json(store.project), snapshot);
  const same = planResize(store.project, 0, 1, 30);
  assert.equal(commitIfAllowed(store, same, 'X', () => assert.fail('an unchanged size commits nothing')), false);
  assert.equal(store.undoStack.length, 0);
  // allowed: one entry, and one undo restores
  const ok = planResize(store.project, 0, 1, 40);
  assert.equal(commitIfAllowed(store, ok, 'Resize', (project) => { project.maps[0].gridH = 40; }), true);
  assert.equal(store.undoStack.length, 1);
  assert.equal(store.dirty, true);
  store.undo();
  assert.equal(json(store.project), snapshot);
  // the toggle: allowed on, one entry; undo clears it
  const s2 = new Store();
  s2.open('/y', ordinary({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 1 }));
  const on = planStreamOn(s2.project, 0);
  assert.equal(commitIfAllowed(s2, on, 'Stream map', (project) => applyStreamOn(project, 0)), true);
  assert.equal(s2.undoStack.length, 1);
  assert.equal(s2.project.maps[0].streamed, true);
  s2.undo();
  assert.equal('streamed' in s2.project.maps[0], false, 'undo restores the ordinary map');
});

test('U8 Duplicate screen: no streamed map has in-place room; the picker filter is the same predicate; the wording never says 4×4 for a streamed map', () => {
  // Catches the old `w*h < 16` check (it grows a 1 x 1 MMC3 H streamed map into a dead-axis 2 x 1) and a stale "4×4" line for a streamed source.
  const map = (opts) => createStreamedProject(opts).maps[0];
  for (const [w, h] of [[1, 1], [1, 3], [3, 1], [4, 4], [1, 30], [200, 1], [16, 15]]) {
    assert.equal(hasDuplicateRoom(map({ mapper: MMC3, mirroring: 'horizontal', gridW: w, gridH: h })), false, `streamed ${w} x ${h}`);
  }
  const plain = (w, h) => ordinary({ gridW: w, gridH: h }).maps[0];
  assert.equal(hasDuplicateRoom(plain(1, 1)), true);
  assert.equal(hasDuplicateRoom(plain(4, 3)), true);
  assert.equal(hasDuplicateRoom(plain(4, 4)), false);
  // the picker's candidates: a streamed map is never offered as a destination, an ordinary one with room is
  const maps = [map({ gridW: 1, gridH: 1 }), plain(2, 2), plain(4, 4), plain(1, 1)];
  assert.deepEqual(maps.map((m, i) => [m, i]).filter(([m]) => hasDuplicateRoom(m)).map(([, i]) => i), [1, 3]);
  const streamedMessage = duplicateFullMessage(map({ gridW: 1, gridH: 1 }));
  assert.match(streamedMessage, /streamed map/);
  assert.match(streamedMessage, /size fields/);
  assert.doesNotMatch(streamedMessage, /\d\s*[×x]\s*\d/, 'no "4×4" for a streamed map');
  const ord = plain(4, 4);
  ord.name = 'Overworld';
  assert.equal(duplicateFullMessage(ord), '"Overworld" is already full (4×4 screens). Pick another map with room:', 'the ordinary wording is unchanged');
});

test('every project the helpers plan on stays valid JSON-for-JSON when a plan is not applied (planning has no side effects)', () => {
  for (const board of BOARDS) {
    const p = createStreamedProject({ mapper: board.mapper, mirroring: board.mirroring, gridW: 1, gridH: 1 });
    const before = json(p);
    streamToggleState(p, 0);
    sizePlan(p, 0);
    planStreamOn(p, 0);
    planStreamOff(p, 0);
    planResize(p, 0, 1, 1);
    planResize(p, 0, 3, 3);
    assert.equal(json(p), before, board.name);
  }
  assert.ok(validateProject(createStreamedProject()), 'sanity: the fixture validates');
});

// --- review round 2 (handoff-next/mapforge/c1-review1.md): the repair shrink, the rule identity, the selected-map index ---

/** A project whose map 0 is `gridW` x `gridH` screens, one Give command naming no item on every screen. */
const withMissingItems = (project) => {
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  for (const screen of project.maps[0].screens) {
    screen.entities.push({ actorId: 0, x: 0, y: 0, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', item: null }] }] } } });
  }
  return project;
};

test('U6b a repair shrink is allowed: "2 ... commands" becoming "1 ... command" is the same rule, on an ordinary map and on a streamed one, through the real Store', () => {
  // Catches a novelty test on the message text (digits blanked, grammar kept): shared/project.js words the Give/Take error with "command(s)", so the count 2 -> 1
  // changed the text, the shrink that FIXES an error was refused as a new one and an edit the pre-C1 handler allowed was blocked before its confirmation.
  const makers = {
    ordinary: () => withMissingItems(ordinary({ gridW: 2, gridH: 1 })),
    streamed: () => withMissingItems(createStreamedProject({ gridW: 2, gridH: 1 }))
  };
  for (const [label, make] of Object.entries(makers)) {
    const p = make();
    assert.equal(errorMessages(p).length, 1, `${label}: the only error is the missing item`);
    assert.match(errorMessages(p)[0], /^2 Give item \/ Take item commands do not name a real item/, `${label}: precondition, plural`);
    const store = new Store();
    store.open('/repair', p);
    const snapshot = json(store.project);
    const plan = planResize(store.project, 0, 1, 1);
    assert.deepEqual(plan, { ok: true, noop: false }, `${label}: the repair shrink is allowed`);
    assert.equal(commitIfAllowed(store, plan, 'Resize map', (project) => growOrShrinkMap(project, 0, 1, 1)), true, `${label}: and reaches the store`);
    assert.equal(store.undoStack.length, 1, `${label}: as one undo entry`);
    assert.equal(store.project.maps[0].screens.length, 1);
    assert.match(errorMessages(store.project)[0], /^1 Give item \/ Take item command do not name a real item/, `${label}: the validator now says it in the singular (the grammar really changed)`);
    store.undo();
    assert.equal(json(store.project), snapshot, `${label}: undo restores`);
  }
  // a rule that was NOT failing still refuses, even while an old counted rule is failing and changing its number
  const mixed = withMissingItems(createStreamedProject({ gridW: 1, gridH: 2 }));
  const beside = createMap(1, 'Beside');
  beside.gridW = 4;
  beside.gridH = 4;
  beside.screens = Array.from({ length: 16 }, () => createScreen());
  mixed.maps.push(beside);
  assert.equal(errorMessages(mixed).length, 1);
  assert.equal(planResize(mixed, 0, 1, 1).ok, true, 'shrinking away the old error: allowed');
  const refused = planResize(mixed, 0, 1, 255);
  assert.equal(refused.ok, false, 'growing into the project-wide total: a new rule, refused');
  assert.match(refused.message, /across all maps/);
  // the same on a streamed column on a two-nametable board: a dead-axis error is new, the missing-item one is old
  const column = withMissingItems(createStreamedProject({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 2 }));
  assert.equal(planResize(column, 0, 1, 1).ok, true);
  assert.match(planResize(column, 0, 2, 2).message, /2 screens wide/);
});

test('U6f a resize in a project with no streamed map is never gated by validation: a normalized, valid ordinary project grows as it did before C1; the same edit beside a streamed map is still gated', () => {
  // Catches a preflight that compares validateProject errors for EVERY project: a new screen holds metatile 0, and when that metatile is damaging, adding one turns combat
  // and the message font on (shared/font.js projectUsesCombat / projectUsesText), which introduces a Tile Forge error about $A0-$FF background art -- an error no streamed rule
  // is behind. The pre-C1 handler committed that resize; the gate must be scoped to a project that holds a streamed map (review round 2, the P2).
  const damaging = (project) => {
    project.maps[0].screens[0].metatiles.fill(1);
    project.metatiles[0].collision = 'damage';
    project.tilesets[0].background.tiles[160] = '1'.repeat(64);
    return project;
  };
  const artwork = /artwork in background tiles \$A0-\$FF/;
  const plain = normalizeProject(damaging(createProject('ordinary'))); // the reviewer's repro, normalized
  assert.equal(plain.maps.some((m) => m.streamed === true), false, 'precondition: no streamed map');
  assert.deepEqual(errorMessages(plain), [], 'precondition: the project is valid, and stays valid through normalizeProject');
  const grown = structuredClone(plain);
  growOrShrinkMap(grown, 0, 2, 1);
  assert.ok(errorMessages(grown).some((m) => artwork.test(m)), 'precondition: the edit really does add a validateProject error (else this test proves nothing)');
  const store = new Store();
  store.open('/ordinary', plain);
  const snapshot = json(store.project);
  const plan = planResize(store.project, 0, 2, 1);
  assert.deepEqual(plan, { ok: true, noop: false }, 'allowed, as before C1');
  assert.equal(commitIfAllowed(store, plan, 'Resize map', (project) => growOrShrinkMap(project, 0, 2, 1)), true);
  assert.deepEqual([store.project.maps[0].gridW, store.project.maps[0].gridH, store.project.maps[0].screens.length], [2, 1, 2], 'the resulting size');
  assert.equal(store.undoStack.length, 1, 'exactly one undo entry');
  store.undo();
  assert.equal(json(store.project), snapshot, 'undo restores the original');
  assert.deepEqual([store.project.maps[0].gridW, store.project.maps[0].gridH], [1, 1], 'back to 1 x 1');
  assert.deepEqual(planResize(store.project, 0, 1, 1), { ok: true, noop: true }, 'the unchanged size is still a no-op');
  // the converse: a project that holds a streamed map keeps the gate -- on the streamed map and on the ordinary map beside it
  const beside = createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: 1 });
  const other = createMap(1, 'Beside');
  other.screens[0].metatiles.fill(1);
  beside.maps.push(other);
  damaging(beside); // map 0 (streamed) and Beside both avoid metatile 0, so the project is valid until a NEW screen holds it
  assert.equal(beside.maps.some((m) => m.streamed === true), true, 'precondition: a streamed map is present');
  assert.deepEqual(errorMessages(beside), [], 'precondition: valid');
  const refusedOrdinary = planResize(beside, 1, 2, 1);
  assert.equal(refusedOrdinary.ok, false, 'an ORDINARY map resized beside a streamed one is gated');
  assert.match(refusedOrdinary.message, artwork);
  assert.equal(planResize(beside, 1, 1, 1).noop, true);
  const wasLive = json(beside);
  const store2 = new Store();
  store2.open('/beside', beside);
  assert.equal(commitIfAllowed(store2, planResize(store2.project, 1, 2, 1), 'Resize map', (project) => growOrShrinkMap(project, 1, 2, 1)), false);
  assert.equal(store2.undoStack.length, 0, 'and a refusal leaves no undo entry');
  assert.equal(json(store2.project), wasLive);
  // ... and on the STREAMED map itself (review round 3, P3): the damaging-metatile growth of a streamed 1 x 1 is refused too.
  // Catches a gate that exempts the streamed map's own Tile Forge error (`.filter(p => map.streamed !== true || p.where !== 'Tile Forge')` on the fresh errors),
  // which every ordinary-neighbour assertion above survives.
  const alone = damaging(createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: 1 }));
  assert.equal(alone.maps[0].streamed, true, 'precondition: the map being resized is the streamed one');
  assert.deepEqual(errorMessages(alone), [], 'precondition: valid');
  const grownAlone = structuredClone(alone);
  assert.notEqual(growOrShrinkMap(grownAlone, 0, 1, 2), null, 'precondition: the grid rules allow 1 x 2');
  assert.ok(errorMessages(grownAlone).some((m) => artwork.test(m)), 'precondition: the growth really adds the Tile Forge error');
  const refusedOwn = planResize(alone, 0, 1, 2);
  assert.equal(refusedOwn.ok, false, 'the streamed map\'s own growth is gated');
  assert.match(refusedOwn.message, artwork);
  const ownLive = json(alone);
  const store3 = new Store();
  store3.open('/alone', alone);
  assert.equal(commitIfAllowed(store3, refusedOwn, 'Resize map', (project) => growOrShrinkMap(project, 0, 1, 2)), false, 'refused through commitIfAllowed');
  assert.equal(json(store3.project), ownLive, 'the project is unchanged');
  assert.equal(store3.undoStack.length, 0, 'no undo entry');
  assert.equal(store3.dirty, false, 'and not dirty');
});

test('U6g a resize waiting on its confirmation commits nothing if the project changed meanwhile (Undo, an edit, a replacement), on a streamed project and an ordinary one; the answer is never re-planned', async () => {
  // The handler plans, asks, then commits; Undo/Redo stay reachable behind the dialog (review round 3, P2). Catches: no guard (the stale mutator commits
  // against the undone project), the revision read AFTER the wait (always equal, so never stale), a guard only for streamed projects, and a guard that
  // re-plans instead of cancelling (the user approved a different project).
  const mixed = () => {
    // the reviewer's shape: an ordinary 1 x 1 beside a streamed 1 x 254 is exactly 255 screens, on a board that streams both axes
    const project = createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: 254 });
    project.maps.unshift(createMap(0, 'Ordinary'));
    project.maps.forEach((map, id) => (map.id = id));
    assert.deepEqual(errorMessages(project), [], 'precondition: valid at 255 screens');
    return project;
  };
  const cases = [
    {
      name: 'streamed project',
      project: mixed,
      // two valid edits to reach the state the dialog opens on, then the resize the stale plan wants: 4 x 4 -> 3 x 4 (fine from there), but 1 x 1 -> 3 x 4 is 266
      setup: (store) => {
        store.commit('Shrink streamed', (project) => growOrShrinkMap(project, 1, 1, 239));
        store.commit('Grow ordinary', (project) => growOrShrinkMap(project, 0, 4, 4));
      },
      resize: [0, 3, 4],
      intervene: { undo: (store) => { store.undo(); store.undo(); } }
    },
    {
      name: 'ordinary project',
      project: () => createProject('ordinary'),
      setup: (store) => store.commit('Grow', (project) => growOrShrinkMap(project, 0, 3, 3)),
      resize: [0, 2, 3],
      intervene: { undo: (store) => store.undo() }
    }
  ];
  const others = {
    'an edit': (store) => store.commit('Rename', (project) => (project.maps[0].name = 'Renamed')),
    'a replacement': (store) => store.open('/other', createProject('other'))
  };
  for (const c of cases) {
    for (const [how, change] of Object.entries({ ...c.intervene, ...others })) {
      const store = new Store();
      store.open('/p', c.project());
      c.setup(store);
      const [index, w, h] = c.resize;
      const plan = planResize(store.project, index, w, h);
      assert.equal(plan.ok && !plan.noop, true, `${c.name}: precondition: the plan was allowed when the dialog opened`);
      let answer;
      const asked = new Promise((resolve) => (answer = resolve));
      const pending = commitAfterConfirm(store, plan, 'Resize map', (project) => growOrShrinkMap(project, index, w, h), () => asked);
      change(store); // while the dialog is open
      const afterChange = json(store.project);
      const depth = store.undoStack.length;
      const redo = store.redoStack.length;
      const errorsBefore = errorMessages(store.project);
      const dirty = store.dirty;
      answer(true); // the user clicks Resize on the stale dialog
      assert.equal(await pending, 'stale', `${c.name}, ${how}: the answer is discarded`);
      assert.equal(json(store.project), afterChange, `${c.name}, ${how}: the project is exactly what the change left`);
      assert.equal(store.undoStack.length, depth, `${c.name}, ${how}: no new undo entry`);
      assert.equal(store.redoStack.length, redo, `${c.name}, ${how}: the redo stack survives`);
      assert.equal(store.dirty, dirty, `${c.name}, ${how}: dirty is untouched`);
      assert.deepEqual(errorMessages(store.project), errorsBefore, `${c.name}, ${how}: no new validation error`);
    }
  }
  // the stale commit would have been harmful (else the streamed case proves nothing): applied to the undone project it adds the 266-screen error
  const harm = mixed();
  growOrShrinkMap(harm, 0, 3, 4);
  assert.ok(errorMessages(harm).some((m) => /266 screens/.test(m)), 'the unguarded commit is a validation error');
  // controls: an unchanged project commits once after the dialog; a "no" commits nothing; no dialog at all commits at once
  const control = new Store();
  control.open('/c', createProject('control'));
  const growPlan = planResize(control.project, 0, 2, 1);
  const mutate = (project) => growOrShrinkMap(project, 0, 2, 1);
  assert.equal(await commitAfterConfirm(control, growPlan, 'Resize map', mutate, () => Promise.resolve(false)), 'cancelled');
  assert.equal(control.undoStack.length, 0, 'a "no" commits nothing');
  assert.equal(await commitAfterConfirm(control, growPlan, 'Resize map', mutate, () => Promise.resolve(true)), 'committed');
  assert.equal(control.undoStack.length, 1, 'a "yes" on an unchanged project is exactly one undo entry');
  assert.equal(control.project.maps[0].gridW, 2);
  const direct = new Store();
  direct.open('/d', createProject('direct'));
  assert.equal(await commitAfterConfirm(direct, planResize(direct.project, 0, 2, 1), 'Resize map', mutate, null), 'committed');
  assert.equal(direct.undoStack.length, 1, 'no confirmation: committed at once');
  assert.equal(await commitAfterConfirm(direct, { ok: true, noop: true }, 'Resize map', mutate, null), 'refused', 'a no-op plan never commits');
  assert.match(STALE_RESIZE_NOTE, /project changed/);
});

test('U6c the already-over-total policy: growing past a total the project already fails is the same rule (256 -> 257), by design -- it is not an absolute screen cap', () => {
  // Pins the accepted policy (design record, "new by rule"; review round 1, finding 2) so it cannot be mistaken for a hard gate. Catches turning the rule into
  // "refuse whenever the total is over 255" (which would also refuse the REPAIR shrink below) and the opposite, a gate that stopped refusing the first crossing.
  const make = (rows) => {
    const p = createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: rows });
    const beside = createMap(1, 'Beside');
    beside.gridW = 4;
    beside.gridH = 4;
    beside.screens = Array.from({ length: 16 }, () => createScreen());
    p.maps.push(beside);
    return p;
  };
  const crossing = make(239); // 239 + 16 = 255
  assert.equal(errorMessages(crossing).length, 0);
  assert.equal(planResize(crossing, 0, 1, 240).ok, false, '255 -> 256 is the first crossing: a new rule, refused');
  const over = make(240); // 256: already failing the total
  assert.ok(errorMessages(over).some((m) => /holds 256 screens/.test(m)), 'precondition: 256 screens');
  assert.deepEqual(planResize(over, 0, 1, 241), { ok: true, noop: false }, '256 -> 257: the same existing rule, allowed');
  assert.deepEqual(planResize(over, 0, 1, 255), { ok: true, noop: false }, '256 -> 271: likewise (the audit\'s example)');
  assert.deepEqual(planResize(over, 0, 1, 100), { ok: true, noop: false }, 'and shrinking toward the limit');
  assert.equal(planResize(over, 0, 1, 256).ok, false, 'a streamed map\'s own per-side ceiling still refuses');
  const store = new Store();
  store.open('/over', over);
  assert.equal(commitIfAllowed(store, planResize(store.project, 0, 1, 241), 'Resize map', (project) => growOrShrinkMap(project, 0, 1, 241)), true);
  assert.ok(errorMessages(store.project).some((m) => /holds 257 screens/.test(m)), 'the project is left failing the same rule, 257 screens');
});

test('U6d the rule identity: one rule\'s error replaced by a different rule\'s is new; a changed count, number grammar or list is not; a second instance is', () => {
  // Catches a comparison on the digit-blanked message (singular/plural reads as a different rule), a comparison on `where` alone or on prose-less counts
  // (A -> B passes), a lost multiset (a second instance passes) and quoted names erased (another map's error passes as the same one).
  const mf = (message) => problem('Map Forge', message);
  const give = (n, grammar) => mf(`${n} Give item / Take item command${n === 1 ? '' : 's'} do not name a real item. Pick an item or switch the command off.${grammar ?? ''}`);
  assert.deepEqual(newErrors([give(2)], [give(1)]), [], '2 -> 1: the same rule');
  assert.deepEqual(newErrors([give(1)], [give(2)]), [], '1 -> 2: the same rule');
  assert.deepEqual(newErrors([give(7)], [give(12)]), [], 'a count changing digits');
  const sting = (n) => mf(`${n} Sound sting command${n === 1 ? '' : 's'} do not name a real song.`);
  const A = give(2);
  const B = sting(2);
  assert.deepEqual(newErrors([A], [B]), [B], 'A -> B: a different rule\'s error replacing it is new');
  assert.deepEqual(newErrors([A], [B, A]), [B], 'A -> A + B');
  assert.deepEqual(newErrors([A, A], [A]), [], 'A + A -> A');
  assert.deepEqual(newErrors([A], [A, A]), [A], 'A -> A + A: a second instance is new');
  assert.deepEqual(newErrors([A], []), [], 'cleared');
  assert.notEqual(ruleKey(A), ruleKey(mf(A.message.replace('Give item', 'Take item'))), 'a one-word difference in the rule is a different rule');
  assert.notEqual(ruleKey(mf('Map "A" is 2 screens wide')), ruleKey(mf('Map "A" is 2 screens tall')));
  assert.notEqual(ruleKey(mf('Map "A" is 2 screens wide')), ruleKey(mf('Map "a" is 2 screens wide')), 'quoted names keep their case: "A" and "a" are two maps');
  assert.equal(ruleKey(mf('Map "A" is 2 screens wide')), ruleKey(mf('Map "A" is 12 screens wide')), 'and the same quoted name with a changed count is one rule');
  assert.notEqual(ruleKey(mf('Map "Map 1" is 2 screens wide')), ruleKey(mf('Map "Map 2" is 2 screens wide')), 'another map failing the same rule is another instance');
  assert.notEqual(ruleKey(problem('Map Forge', 'x is wrong')), ruleKey(problem('Items Forge', 'x is wrong')), 'the Forge that reports it is part of the identity');
  // real validator messages: a tall error and a wide error are different rules
  const tall = createStreamedProject({ mapper: MMC3, mirroring: 'vertical', gridW: 1, gridH: 5 });
  const wide = createStreamedProject({ mapper: MMC3, mirroring: 'horizontal', gridW: 5, gridH: 1 });
  assert.equal(newErrors(errorProblems(tall), errorProblems(wide)).length, 1, 'real messages: tall -> wide is A -> B');
  assert.deepEqual(newErrors(errorProblems(tall), errorProblems(structuredClone(tall))), []);
});

test('U6e every `=== 1` / `!== 1` counted-message ternary in shared/project.js folds to one rule across its singular and plural forms (only these recognised forms: a count worded another way is not scanned)', () => {
  // The validator's problems carry no rule id, so ruleKey folds grammatical number. This reads every `${n === 1 ? 'a' : 'b'}` / `${n !== 1 ? ...}` pair out of
  // shared/project.js's own source and checks each folds; a new irregular noun or verb pair worded in that ternary form fails here and ruleKey is taught it.
  // It is NOT an exhaustiveness check: a `> 1` form, a plural helper or a pre-built word is invisible to this regex (review round 2, P3). Review found none in
  // validateProject today (all 15 string conditionals there are `=== 1`); whoever adds one owns extending this scan.
  const source = fs.readFileSync(new URL('../../shared/project.js', import.meta.url), 'utf8');
  const literal = "('(?:[^'\\\\]|\\\\.)*'|\"[^\"]*\")";
  const pairs = [...source.matchAll(new RegExp('\\$\\{[\\w.()]+ (===|!==) 1 \\? ' + literal + ' : ' + literal + '\\}', 'g'))].map((m) => {
    const [one, many] = [m[2].slice(1, -1), m[3].slice(1, -1)];
    return m[1] === '===' ? [one, many] : [many, one];
  });
  assert.ok(pairs.length >= 15, 'found the counted-message ternaries (' + pairs.length + ')');
  const forms = new Set(pairs.map((pair) => JSON.stringify(pair)));
  for (const expected of [['', 's'], ['s', ''], [' has', 's have'], ['is', 'are'], [' is', 's are']]) {
    assert.ok(forms.has(JSON.stringify(expected)), 'the scan sees the ' + JSON.stringify(expected) + ' form');
  }
  for (const [one, many] of pairs) {
    const attached = [one, many].every((form) => /^(s| |$)/.test(form));
    const sentence = (form) => (attached ? 'thing' + form : 'thing ' + form) + ' in the project, see "Map 1" here';
    assert.equal(ruleKey(problem('Map Forge', '1 ' + sentence(one))), ruleKey(problem('Map Forge', '12 ' + sentence(many))), JSON.stringify([one, many]));
  }
});

test('U4b turning Streamed on: switch-bound tiles refuse it too, with the validator\'s own message', () => {
  // Catches a toggle gate that honors only the shape/board/camera errors and drops the streamed-content ones (here bound tiles), the survivor review round 1 named for U4.
  const p = ordinary({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: 1 });
  p.maps[0].screens[0].boundTiles.push({ switchId: 0, row: 0, col: 0, metatileId: 1 });
  const plan = planStreamOn(p, 0);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /switch-bound tiles, which a streamed screen cannot use/);
  assert.ok(errorMessages(flagged(p)).includes(plan.message));
});

test('index: every decision reads the SELECTED map, never map 0 (a distinct map 0 would give a different answer)', () => {
  // Catches a wrong-index implementation (`maps[0]`, `mapIndex` ignored) in each of U1-U7's functions; the earlier tests all select index 0.
  const gridOf = (project, index, w, h) => {
    const map = project.maps[index];
    map.gridW = w;
    map.gridH = h;
    map.screens = Array.from({ length: w * h }, () => createScreen());
  };
  const second = (project, name = 'Second') => {
    const map = createMap(project.maps.length, name);
    project.maps.push(map);
    return project.maps.length - 1;
  };
  // U1: map 0 may stop streaming, map 1 (1 x 30) may not -- and the other way round
  let p = createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: 1 });
  let i = second(p);
  p.maps[i].streamed = true;
  gridOf(p, i, 1, 30);
  assert.equal(planStreamOff(p, 0).ok, true);
  assert.equal(planStreamOff(p, i).ok, false, 'U1: map 1 is 1 x 30');
  assert.match(planStreamOff(p, i).message, /"Second" is 1 × 30/);
  gridOf(p, 0, 1, 30);
  gridOf(p, i, 2, 2);
  assert.equal(planStreamOff(p, 0).ok, false);
  assert.equal(planStreamOff(p, i).ok, true, 'U1: and map 0 being too big does not refuse map 1');
  // U2: the mutators touch only the selected map
  p = createStreamedProject({ mapper: U512, mirroring: 'fourscreen', gridW: 1, gridH: 1 });
  i = second(p);
  p.maps[i].streamed = true;
  p.maps[i].fillMetatileId = 3;
  const before0 = json(p.maps[0]);
  applyStreamOff(p, i);
  assert.equal(json(p.maps[0]), before0, 'U2: map 0 untouched by a turn-off of map 1');
  assert.equal('streamed' in p.maps[i] || 'fillMetatileId' in p.maps[i], false);
  applyStreamOn(p, i);
  assert.equal(p.maps[i].streamed, true);
  assert.equal(p.maps[0].streamed, true, 'U2: map 0 was streamed and stays so (a turn-on of map 1 writes map 1)');
  const q = ordinary({ gridW: 1, gridH: 1 });
  const j = second(q);
  applyStreamOn(q, j);
  assert.equal('streamed' in q.maps[0], false, 'U2: a turn-on of map 1 leaves ordinary map 0 ordinary');
  assert.equal(q.maps[j].streamed, true);
  // U3: map 0 streamed, map 1 ordinary, on a board that cannot stream
  p = createStreamedProject({ mapper: NROM, mirroring: 'horizontal', gridW: 1, gridH: 1 });
  i = second(p);
  delete p.maps[i].streamed;
  assert.deepEqual([streamToggleState(p, 0).checked, streamToggleState(p, 0).enabled], [true, true]);
  assert.deepEqual([streamToggleState(p, i).checked, streamToggleState(p, i).enabled], [false, false], 'U3: map 1 is an ordinary map on a board that cannot stream');
  assert.match(streamToggleState(p, i).reason, /"Second"/, 'and the reason names map 1');
  assert.match(streamToggleState(p, 0).note, new RegExp('"' + p.maps[0].name + '"'), 'U3: the note names map 0');
  // U4: map 0 may stream (1 x 1), map 1 (2 x 2 on MMC3) may not, and the refusal names map 1
  p = ordinary({ mapper: MMC3, mirroring: 'horizontal', gridW: 1, gridH: 1 });
  i = second(p);
  gridOf(p, i, 2, 2);
  assert.equal(planStreamOn(p, 0).ok, true);
  const refusal = planStreamOn(p, i);
  assert.equal(refusal.ok, false, 'U4: map 1 is 2 x 2');
  assert.match(refusal.message, /"Second"/);
  // U5: ordinary map 0, streamed map 1 on MMC3 horizontal (width dead), and the other way round
  p = ordinary({ mapper: MMC3, mirroring: 'horizontal', gridW: 2, gridH: 2 });
  i = second(p);
  p.maps[i].streamed = true;
  gridOf(p, i, 1, 30);
  assert.equal(sizePlan(p, 0).deadAxis, null);
  assert.equal(sizePlan(p, 0).height.max, LIMITS.mapGrid);
  assert.equal(sizePlan(p, i).deadAxis, 'width', 'U5: map 1 is the streamed column');
  assert.equal(sizePlan(p, i).height.max, LIMITS.streamedGrid);
  assert.equal(clampAxis(sizePlan(p, i), 'height', 100, 30), 100);
  assert.equal(clampAxis(sizePlan(p, 0), 'height', 100, 2), LIMITS.mapGrid);
  // U6: the preflight plans map 1's resize (it is the streamed one beside an ordinary 4 x 4 map 0)
  p = ordinary({ mapper: U512, mirroring: 'fourscreen', gridW: 4, gridH: 4 });
  i = second(p);
  p.maps[i].streamed = true;
  gridOf(p, i, 1, 100);
  assert.equal(planResize(p, i, 1, 239).ok, true);
  assert.equal(planResize(p, i, 1, 240).ok, false, 'U6: 240 + 16 screens is over the total');
  assert.deepEqual(planResize(p, i, 1, 100), { ok: true, noop: true }, 'U6: map 1\'s own size is the no-op, though map 0 is 4 x 4');
  assert.deepEqual(planResize(p, 0, 4, 4), { ok: true, noop: true });
  assert.deepEqual(planResize(p, 0, 3, 4), { ok: true, noop: false });
  // U7: the gate changes exactly the selected map, one undo entry
  const store = new Store();
  store.open('/index', p);
  const map0 = json(store.project.maps[0]);
  assert.equal(commitIfAllowed(store, planResize(store.project, i, 1, 150), 'Resize map', (project) => growOrShrinkMap(project, i, 1, 150)), true);
  assert.equal(store.project.maps[i].gridH, 150);
  assert.equal(json(store.project.maps[0]), map0, 'U7: map 0 untouched');
  assert.equal(store.undoStack.length, 1);
  const off = planStreamOff(store.project, i);
  assert.equal(off.ok, false);
  assert.equal(commitIfAllowed(store, off, 'Stop streaming map', () => assert.fail('refused')), false);
  assert.equal(store.undoStack.length, 1);
});
