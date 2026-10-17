// The Map Forge's World view, the pure half of its links: where a door or a warp is drawn as a curve between two screens, which
// link a point is on, and which links a mode shows. Pure and DOM-free; imports `worldlayout.js` only. world.js draws and
// listens (docs/design-world-overview.md, section 3).
//
// A link runs from its source marker (the door or the cutscene actor's pixel) to its landing pixel inside the target cell, both
// mapped to world pixels by `scale / 16`, so the arrow lands where the player would. Every link is a quadratic curve that
// bows to the same side of its own *directed* chord: reversing the chord reverses the normal, so A -> B and B -> A bow to
// opposite sides by construction and a two-way pair never lies on one curve. A link whose two ends are closer than a marker
// is a ring, never a zero-length path.

import { worldCellRect, worldMarkerSize } from './worldlayout.js';

/** How far (in world pixels) from a curve a pointer still counts as on it. */
export const LINK_TOLERANCE = 3;
/** Up to this many links the default is to draw all of them; above it, only those of the screen in focus. */
export const LINK_ALL_LIMIT = 32;
/** The bow of a curve is this fraction of its chord, held between the next two. */
export const LINK_BOW_RATIO = 0.18;
export const LINK_BOW_MIN = 6;
export const LINK_BOW_MAX = 40;
/** The curve is tested (and could be drawn) as this many straight segments. */
const SEGMENTS = 24;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** The mode a world with `count` links starts in: All up to LINK_ALL_LIMIT links, Focus above. The toolbar overrides it. */
export const defaultLinkMode = (count) => (count > LINK_ALL_LIMIT ? 'focus' : 'all');

/**
 * The world pixel a `{ mapIndex, screenIndex, x, y }` (a pixel inside the 256 x 240 screen) is drawn at: the centre of the 16 x
 * 16 thing there, kept inside its cell. Null for a screen the world does not have.
 */
export function linkEndpoint(layout, end) {
  const cell = worldCellRect(layout, end.mapIndex, end.screenIndex);
  if (!cell) return null;
  const scaled = (pixel) => Math.round(((pixel + 8) * layout.scale) / 16);
  return { x: cell.x + clamp(scaled(end.x), 0, cell.w - 1), y: cell.y + clamp(scaled(end.y), 0, cell.h - 1) };
}

/** The bow of a curve whose chord is `len` long. */
export const linkBow = (len) => clamp(LINK_BOW_RATIO * len, LINK_BOW_MIN, LINK_BOW_MAX);

/**
 * The control point of the quadratic from `a` to `b`: the chord's midpoint pushed `bow` along the unit normal of the *directed*
 * chord, `n = (-dy, dx) / len`. Reversing the chord reverses `n`, so the reverse link bows the other way, always the same way
 * for the same pair, with no index term. A zero-length chord has no normal: the midpoint.
 */
export function quadraticControl(a, b, bow) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (len === 0) return mid;
  return { x: mid.x + (bow * -dy) / len, y: mid.y + (bow * dx) / len };
}

/**
 * Where a link is drawn, in full-world pixels: `{ shape: 'curve', a, b, c, len, bow }` (a quadratic from `a` to `b` with control
 * point `c`), or `{ shape: 'ring', a, b, centre, radius }` when the ends are closer than a marker. Null if either end's screen
 * is not in the world. The bow is `linkBow(len)`.
 */
export function linkPath(link, layout) {
  const a = linkEndpoint(layout, link.from);
  const b = linkEndpoint(layout, link.to);
  if (!a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const size = worldMarkerSize(layout.scale);
  if (len < size) return { shape: 'ring', a, b, centre: b, radius: size / 2 + 2 };
  const bow = linkBow(len);
  return { shape: 'curve', a, b, c: quadraticControl(a, b, bow), len, bow };
}

/** The point at parameter `t` (0..1) of a curve path. */
export function pointOnCurve(path, t) {
  const u = 1 - t;
  return {
    x: u * u * path.a.x + 2 * u * t * path.c.x + t * t * path.b.x,
    y: u * u * path.a.y + 2 * u * t * path.c.y + t * t * path.b.y
  };
}

/** The pixel rectangle `{ x, y, w, h }` a path lies inside (a curve lies inside the hull of its three points), for culling to a window. */
export function pathBounds(path) {
  if (path.shape === 'ring') {
    const r = path.radius + 1;
    return { x: path.centre.x - r, y: path.centre.y - r, w: 2 * r, h: 2 * r };
  }
  const xs = [path.a.x, path.b.x, path.c.x];
  const ys = [path.a.y, path.b.y, path.c.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const span = dx * dx + dy * dy;
  const t = span === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / span, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** How far the point is from the path: a curve is tested as SEGMENTS straight pieces, a ring by its circle (and inside it). */
export function distanceToPath(path, x, y) {
  if (path.shape === 'ring') return Math.max(0, Math.hypot(x - path.centre.x, y - path.centre.y) - path.radius);
  let best = Infinity;
  let last = path.a;
  for (let i = 1; i <= SEGMENTS; i++) {
    const next = pointOnCurve(path, i / SEGMENTS);
    best = Math.min(best, distanceToSegment(x, y, last.x, last.y, next.x, next.y));
    last = next;
  }
  return best;
}

/**
 * The link under a full-world point: the nearest of `links` whose path passes within `tolerance`, ties broken by the smaller
 * `from.flat`, then by the order given. Null when none is close enough.
 */
export function linkAt(layout, links, x, y, tolerance = LINK_TOLERANCE) {
  let best = null;
  let bestDistance = Infinity;
  for (const link of links) {
    const path = linkPath(link, layout);
    if (!path) continue;
    const box = pathBounds(path);
    if (x < box.x - tolerance || x > box.x + box.w + tolerance || y < box.y - tolerance || y > box.y + box.h + tolerance) continue;
    const distance = distanceToPath(path, x, y);
    if (distance > tolerance) continue;
    if (distance < bestDistance || (distance === bestDistance && link.from.flat < best.from.flat)) {
      best = link;
      bestDistance = distance;
    }
  }
  return best;
}

/** The links that leave, land on, or stay on the screen `flat`, each once (a link that stays is filed under both). */
export function linkFocus(links, byScreen, flat) {
  const entry = byScreen?.get(flat);
  const incident = entry ? [...entry.out, ...entry.in] : (links ?? []).filter((link) => link.from.flat === flat || link.to.flat === flat);
  return [...new Set(incident)];
}

/** The links a mode shows: every one in 'all', the focus screen's in 'focus', none in 'off'. */
export function visibleLinks(mode, links, byScreen, focusFlat) {
  if (mode === 'off') return [];
  if (mode === 'all') return links;
  return linkFocus(links, byScreen, focusFlat);
}

/** How many links (this one included) land on the same pixel of the same screen. */
export function landingCount(links, link) {
  return links.filter((other) => other.to.flat === link.to.flat && other.to.x === link.to.x && other.to.y === link.to.y).length;
}

/**
 * The three corners of the arrowhead at the end of a path, `size` pixels long: the tip is the landing pixel itself, the base
 * lies back along the curve's own tangent there (the control point to the end; the chord for a ring).
 */
export function arrowHead(path, size) {
  const from = path.shape === 'curve' ? path.c : path.a;
  let dx = path.b.x - from.x;
  let dy = path.b.y - from.y;
  let len = Math.hypot(dx, dy);
  if (len === 0) {
    dx = 1;
    dy = 0;
    len = 1;
  }
  const ux = dx / len;
  const uy = dy / len;
  const back = { x: path.b.x - ux * size, y: path.b.y - uy * size };
  const half = size * 0.5;
  return [path.b, { x: back.x - uy * half, y: back.y + ux * half }, { x: back.x + uy * half, y: back.y - ux * half }];
}
