// Map Forge World view (ROADMAP item 7, C2): the pure half of its links, renderer/forges/map/worldlinks.js. Each test states, in its
// first comment line, the wrong implementation it exists to catch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutWorld, worldCellRect, worldMarkerSize } from '../../renderer/forges/map/worldlayout.js';
import {
  LINK_ALL_LIMIT,
  LINK_TOLERANCE,
  defaultLinkMode,
  linkBow,
  quadraticControl,
  linkEndpoint,
  linkPath,
  pointOnCurve,
  pathBounds,
  distanceToPath,
  linkAt,
  linkFocus,
  visibleLinks,
  landingCount,
  arrowHead
} from '../../renderer/forges/map/worldlinks.js';

const BOX = { width: 900, height: 520 };
/** A world of the given maps (`[gridW, gridH]`) at a scale. */
const worldAt = (shapes, scale = 2) => layoutWorld(shapes.map(([gridW, gridH]) => ({ gridW, gridH })), BOX, scale);
/** A link between two pixels of screens, as buildWorldMarkers shapes it. */
function link(from, to, extra = {}) {
  const side = (e) => ({ flat: e.flat ?? 0, mapIndex: e.mapIndex ?? 0, screenIndex: e.screenIndex ?? 0, x: e.x ?? 0, y: e.y ?? 0, entityIndex: e.entityIndex ?? 0 });
  return { kind: 'door', from: side(from), to: side(to), stored: 0, dangling: false, compiled: true, via: null, self: false, source: 'D', ...extra };
}

test('bow: the control point is mid + bow * n with n the unit normal of the DIRECTED chord, so the reverse link bows the other way -- (50,18) and (50,-18) for (0,0) -> (100,0)', () => {
  // wrong: D1's `from.flat < to.flat ? +1 : -1` index term, which reversed n back and put both directions on one curve; a hard-coded bow of 20
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  assert.equal(linkBow(100), 18, 'bow = clamp(0.18 * len, 6, 40)');
  assert.deepEqual(quadraticControl(a, b, linkBow(100)), { x: 50, y: 18 });
  assert.deepEqual(quadraticControl(b, a, linkBow(100)), { x: 50, y: -18 });
  // the helper that takes an explicit bow, with the design's 20 px example
  assert.deepEqual(quadraticControl(a, b, 20), { x: 50, y: 20 });
  assert.deepEqual(quadraticControl(b, a, 20), { x: 50, y: -20 });
  // the endpoints swapped to a vertical pair: n = (-dy, dx) / len
  assert.deepEqual(quadraticControl({ x: 0, y: 0 }, { x: 0, y: 100 }, 18), { x: -18, y: 50 });
  assert.deepEqual(quadraticControl({ x: 0, y: 100 }, { x: 0, y: 0 }, 18), { x: 18, y: 50 });
  // and a zero-length chord has no normal at all
  assert.deepEqual(quadraticControl(a, a, 18), { x: 0, y: 0 });
});

test('bow: the public linkPath applies the formula and its clamps -- 100 px gives 18, a short chord 6, a long one 40 -- and A -> B, B -> A land on opposite sides', () => {
  // wrong: a constant bow, a missing floor or ceiling, or linkPath ignoring direction (the helper right and the public function wrong)
  const layout = worldAt([[1, 1]], 16); // one cell, 256 x 240 px at scale 16: a pixel (x, y) of the screen is (x + 8, y + 8) of the cell
  const at = (x, y, flat = 0) => ({ flat, x, y });
  // the two ends carry different flat indices (as a real pair does), so a rule that orders the chord by index is not hidden by a tie
  const ab = linkPath(link(at(20, 40, 0), at(120, 40, 1)), layout);
  const ba = linkPath(link(at(120, 40, 1), at(20, 40, 0)), layout);
  assert.equal(ab.shape, 'curve');
  assert.deepEqual([ab.len, ab.bow], [100, 18]);
  assert.deepEqual([ab.c.x - ab.a.x, ab.c.y - ab.a.y], [50, 18], 'A -> B bows to +y of its chord');
  assert.deepEqual([ba.c.x - ba.a.x, ba.c.y - ba.a.y], [-50, -18], 'B -> A bows to -y');
  assert.notDeepEqual(ab.c, ba.c, 'the two directions are never on one curve');
  // the clamps, on a world at scale 4 (a screen pixel is a quarter of a world pixel): 120 screen px = a 30 px chord, a 7-cell reach is far past 222 px
  const small = worldAt([[8, 1]], 4);
  const onSmall = (screenIndex, x) => ({ flat: screenIndex, screenIndex, x, y: 100 });
  assert.equal(linkPath(link(onSmall(0, 0), onSmall(0, 120)), small).bow, 6, 'a 30 px chord: 0.18 * 30 = 5.4 is below the floor');
  assert.equal(linkPath(link(onSmall(0, 0), onSmall(0, 200)), small).bow, 9, 'a 50 px chord is between the clamps');
  assert.equal(linkPath(link(onSmall(0, 0), onSmall(7, 0)), small).bow, 40, 'a 462 px chord: 83 is above the ceiling');
  assert.equal(linkBow(0), 6);
  assert.equal(linkBow(1000), 40);
});

test('endpoints: a landing at 0 and at 240/224 lies inside the target cell, at the centre of the 16 x 16 thing there', () => {
  // wrong: an arrow that ends on the cell's edge or off it (x + 16 for the far side), or one drawn at the top-left of the thing instead of its centre
  for (const scale of [1, 2, 3, 4]) {
    const layout = worldAt([[2, 2]], scale);
    for (const [x, y] of [[0, 0], [240, 224], [240, 0], [0, 224], [112, 112]]) {
      const cell = worldCellRect(layout, 0, 3);
      const p = linkEndpoint(layout, { mapIndex: 0, screenIndex: 3, x, y });
      assert.ok(p.x >= cell.x && p.x < cell.x + cell.w && p.y >= cell.y && p.y < cell.y + cell.h, `scale ${scale} landing ${x},${y} inside the cell`);
    }
  }
  const layout = worldAt([[1, 1]], 4);
  const cell = worldCellRect(layout, 0, 0);
  assert.deepEqual(linkEndpoint(layout, { mapIndex: 0, screenIndex: 0, x: 112, y: 112 }), { x: cell.x + 30, y: cell.y + 30 }, '(112 + 8) * 4 / 16 = 30');
  assert.equal(linkEndpoint(layout, { mapIndex: 0, screenIndex: 9, x: 0, y: 0 }), null, 'a screen the world does not have');
});

test('a link whose ends are closer than a marker is a ring, never a zero-length path; one that is not is a curve', () => {
  // wrong: a self link drawn as a zero-length curve (nothing visible, and a divide by zero in the normal)
  const layout = worldAt([[1, 1]], 3);
  const size = worldMarkerSize(3);
  const same = linkPath(link({ x: 112, y: 112 }, { x: 112, y: 112 }, { self: true }), layout);
  assert.equal(same.shape, 'ring');
  assert.ok(same.radius > 0 && Number.isFinite(same.centre.x));
  assert.equal(same.c, undefined);
  // 16 screen pixels at scale 3 is 3 world pixels: still a ring; 160 screen pixels is 30: a curve
  assert.equal(linkPath(link({ x: 100, y: 100 }, { x: 116, y: 100 }), layout).shape, 'ring');
  assert.ok(Math.abs(160 * 3 / 16) > size);
  assert.equal(linkPath(link({ x: 20, y: 100 }, { x: 180, y: 100 }), layout).shape, 'curve');
  assert.ok(pathBounds(same).w > 0);
});

test('a same-screen link is a curve when its ends are separated: `self` records incidence, the geometry chooses the shape', () => {
  // wrong: linkPath drawing every link with link.self as a ring (a door across its own screen collapsing onto its landing), or a `self` test added to the ring rule
  const layout = worldAt([[1, 1]], 4);
  const across = linkPath(link({ x: 0, y: 0 }, { x: 240, y: 224 }, {}), layout);
  const sameScreen = linkPath(link({ x: 0, y: 0 }, { x: 240, y: 224 }, { self: true }), layout);
  assert.equal(sameScreen.shape, 'curve');
  assert.ok(sameScreen.len > worldMarkerSize(4));
  assert.deepEqual(sameScreen, across, 'the self flag changes nothing about the path');
});

test('a curve ends exactly at its landing pixel and the arrowhead points the way the curve arrives', () => {
  // wrong: an arrowhead aimed along the chord instead of the curve's tangent at the end, or a tip that is not the landing pixel
  const layout = worldAt([[2, 1]], 4);
  const path = linkPath(link({ flat: 0, screenIndex: 0, x: 16, y: 16 }, { flat: 1, screenIndex: 1, x: 200, y: 100 }), layout);
  assert.deepEqual(pointOnCurve(path, 0), path.a);
  assert.deepEqual(pointOnCurve(path, 1), path.b);
  const [tip, left, right] = arrowHead(path, 7);
  assert.deepEqual(tip, path.b);
  // both base corners are the same distance back from the tip, along -(b - c)
  const back = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const tangent = { x: path.b.x - path.c.x, y: path.b.y - path.c.y };
  const length = Math.hypot(tangent.x, tangent.y);
  assert.ok(Math.abs(back.x - (path.b.x - (tangent.x / length) * 7)) < 1e-9);
  assert.ok(Math.abs(back.y - (path.b.y - (tangent.y / length) * 7)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(left.x - right.x, left.y - right.y) - 7) < 1e-9, 'the base is as wide as the head is long / 1');
});

test('linkAt: the nearest link within the tolerance, nothing beyond it, ties by the smaller from.flat', () => {
  // wrong: first-in-list wins; no tolerance (a 1 px line impossible to hit); an unbounded tolerance; a tie broken by order given
  const layout = worldAt([[4, 1]], 4);
  const left = link({ flat: 0, screenIndex: 0, x: 16, y: 112 }, { flat: 3, screenIndex: 3, x: 16, y: 112 });
  const near = linkPath(left, layout);
  const middle = pointOnCurve(near, 0.5);
  assert.equal(linkAt(layout, [left], middle.x, middle.y), left);
  assert.equal(linkAt(layout, [left], middle.x, middle.y + LINK_TOLERANCE - 0.5), left);
  assert.equal(linkAt(layout, [left], middle.x, middle.y + LINK_TOLERANCE + 1.5), null, 'beyond the tolerance');
  // two links on the same curve (same ends): the tie goes to the smaller from.flat, whatever order they are given in
  const twin = { ...left, from: { ...left.from, flat: 5 }, source: 'twin' };
  assert.equal(linkAt(layout, [twin, left], middle.x, middle.y), left);
  assert.equal(linkAt(layout, [left, twin], middle.x, middle.y), left);
  // the nearer one wins even when it comes second
  const far = link({ flat: 0, screenIndex: 0, x: 16, y: 16 }, { flat: 3, screenIndex: 3, x: 16, y: 16 });
  const nearer = linkAt(layout, [far, left], middle.x, middle.y);
  assert.equal(nearer, left);
  assert.equal(linkAt(layout, [], 0, 0), null);
  assert.ok(distanceToPath(near, middle.x, middle.y) < 1e-9);
});

test('linkAt: a link into a screen the world does not have is skipped, not thrown on', () => {
  // wrong: a TypeError on a stale link the instant a project change removed its target
  const layout = worldAt([[1, 1]], 2);
  const stale = link({ x: 0, y: 0 }, { screenIndex: 9, x: 0, y: 0 });
  assert.equal(linkAt(layout, [stale], 10, 10), null);
  assert.equal(linkPath(stale, layout), null);
});

test('linkFocus includes outgoing, incoming and self links, each once; visibleLinks follows the mode', () => {
  // wrong: only outgoing links in focus; a self link counted twice; Focus showing all; Off showing some
  const out = link({ flat: 1 }, { flat: 2 });
  const incoming = link({ flat: 3 }, { flat: 1 });
  const self = link({ flat: 1 }, { flat: 1 }, { self: true });
  const other = link({ flat: 4 }, { flat: 5 });
  const links = [out, incoming, self, other];
  const byScreen = new Map([
    [1, { markers: [], out: [out, self], in: [incoming, self] }],
    [2, { markers: [], out: [], in: [out] }]
  ]);
  const focus = linkFocus(links, byScreen, 1);
  assert.equal(focus.length, 3);
  assert.deepEqual(new Set(focus), new Set([out, incoming, self]));
  assert.deepEqual(linkFocus(links, byScreen, 9), [], 'a screen with no links');
  assert.deepEqual(linkFocus(links, null, 5), [other], 'and the same answer from the list alone');
  assert.equal(visibleLinks('all', links, byScreen, 1), links);
  assert.deepEqual(visibleLinks('off', links, byScreen, 1), []);
  assert.deepEqual(new Set(visibleLinks('focus', links, byScreen, 1)), new Set([out, incoming, self]));
});

test('defaultLinkMode: All up to 32 links, Focus from 33', () => {
  // wrong: the boundary one off (>= or > 31/33), a default that never changes, or the modes swapped
  assert.equal(LINK_ALL_LIMIT, 32);
  assert.equal(defaultLinkMode(0), 'all');
  assert.equal(defaultLinkMode(1), 'all');
  assert.equal(defaultLinkMode(31), 'all');
  assert.equal(defaultLinkMode(32), 'all');
  assert.equal(defaultLinkMode(33), 'focus');
  assert.equal(defaultLinkMode(2040), 'focus');
});

test('landingCount: links that land on the same pixel of the same screen are counted, nearby ones are not', () => {
  // wrong: counting by screen only (every door into a room "lands here"), or not counting the link itself
  const a = link({ flat: 0 }, { flat: 4, x: 112, y: 112 });
  const b = link({ flat: 1 }, { flat: 4, x: 112, y: 112 });
  const c = link({ flat: 2 }, { flat: 4, x: 113, y: 112 });
  const d = link({ flat: 3 }, { flat: 5, x: 112, y: 112 });
  assert.equal(landingCount([a, b, c, d], a), 2);
  assert.equal(landingCount([a, b, c, d], c), 1);
  assert.equal(landingCount([a], a), 1);
});
