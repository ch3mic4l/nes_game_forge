// Phase 3b S1b, row 7: DECODED SEAMS. "The player moved 300 px" is not a decode. For every crossing of a screen seam -- a walking ownership crossing and a
// scripted Move's crossing -- this reads, frame by frame, the state the runtime holds (position, owning screen, camera origin, published scroll, strip,
// spawned entities) and checks each against an independent expectation, in the style of test/lib/streamedmovecam.js (`expectedOrigin`, `torusOf`,
// `snapshot`) and test/lib/streamdecoder.js (the authored record the engine must have spawned). Run under jsnes (full memory + PPU); a Mesen body row carries the
// same identity (sw_col/sw_row/player/cam) through ringcount STATE_RAM, so the walk/Move frames the counters classify are the frames decoded here.
//   frame  = per-frame snapshot (decodeFrame, called from runWitness's onFrame hook)
//   decode = every crossing frame in the snapshot list, with the failures it produced (decodeSeams)
import { expectedTiles, nametableTiles } from '../../lib/streamedmovecam.js';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The 2-bit palette the PPU's attribute table holds for world block (bx, by), by the parity rule's torus position (the raw attribute byte is kept at offset 0x3C0 of each nametable's tile array by the vendored core). */
export function nametableAttr(nes, bx, by) {
  const tc = (((bx >> 4) & 1) * 16 + (bx & 15)) * 2, tr = ((Math.floor(by / 15) & 1) * 15 + (by % 15)) * 2;
  const nt = nes.ppu.nameTable[nes.ppu.ntable1[(tr >= 30 ? 2 : 0) + (tc >= 32 ? 1 : 0)]];
  const rr = tr % 30, cc = tc % 32;
  return (nt.tile[0x3c0 + (rr >> 2) * 8 + (cc >> 2)] >> (((rr >> 1) & 1) * 4 + ((cc >> 1) & 1) * 2)) & 3;
}
/**
 * Terrain AND attribute containment: every block the 256 x 240 viewport at world `origin` overlaps shows the four tiles and the palette the project's own record says (test/lib/streamedmovecam.js
 * expectedTiles / nametableTiles, the Phase 3a decoder; the palette is the metatile's, which is what the strip's attribute write must reproduce). Returns { blocks, bad: [{ bx, by, want, got, wantPal, gotPal }] }.
 */
export function viewportCheck(nes, project, gridW, gridH, origin) {
  const bad = [];
  let blocks = 0;
  for (let by = Math.floor(origin.y / 16); by <= Math.floor((origin.y + 239) / 16); by++) {
    for (let bx = origin.x >> 4; bx <= (origin.x + 255) >> 4; bx++) {
      blocks++;
      const want = expectedTiles(project, gridW, gridH, bx, by), got = nametableTiles(nes, bx, by);
      const sc = bx >> 4, sr = Math.floor(by / 15);
      const id = bx >= 0 && by >= 0 && sc < gridW && sr < gridH ? project.maps[0].screens[sr * gridW + sc].metatiles[(by % 15) * 16 + (bx & 15)] : (project.maps[0].fillMetatileId ?? 0);
      const wantPal = project.metatiles[id].palette & 3, gotPal = nametableAttr(nes, bx, by);
      if (want.some((t, i) => t !== got[i]) || wantPal !== gotPal) bad.push({ bx, by, want, got, wantPal, gotPal });
    }
  }
  return { blocks, bad };
}

/** One frame's state, read through the BUILD's own symbol table (names from constants.asm) -- see decodeSeams for what each is checked against. */
export function decodeFrame(nes, frame, phase, ram, scene = null, prev = null) {
  const m = nes.cpu.mem;
  const g = (n) => m[ram[n]];
  const present = [];
  for (let i = 0; i < 8; i++) if (g('ent_active') !== undefined && (m[ram.ent_active + i] & 1)) present.push({ actor: m[ram.ent_actor + i], x: m[ram.ent_x + i], y: m[ram.ent_y + i] });
  const rec = {
    frame, phase: phase?.name ?? null, gs: g('game_state'), col: g('sw_col'), row: g('sw_row'), flat: g('flat_screen'), px: g('player_x'), py: g('player_y'),
    fresh: g('screen_fresh'), mvLeft: ram.mv_left !== undefined ? g('mv_left') : 0,
    originX: m[ram.sw_cam_origin_x_lo] | (m[ram.sw_cam_origin_x_hi] << 8), originY: m[ram.sw_cam_origin_y_lo] | (m[ram.sw_cam_origin_y_hi] << 8),
    camX: g('cam_x_lo'), camY: g('cam_y_lo'), camNt: g('cam_nt'),
    scroll: { x: nes.ppu.regH * 256 + nes.ppu.regHT * 8 + nes.ppu.regFH, y: nes.ppu.regV * 240 + nes.ppu.regVT * 8 + nes.ppu.regFV },
    shakeLeft: ram.shake_left !== undefined ? g('shake_left') : 0, boxState: ram.box_state !== undefined ? g('box_state') : 0,
    stActive: g('st_active'), stLen: g('st_len'), stFnt: g('st_fnt'), ents: present
  };
  if (scene?.distinct && rec.gs !== 3 && rec.col < scene.gridW && rec.row < scene.gridH && rec.px > 0 && rec.py > 0) {
    // the displayed viewport is the origin whose torus position the PPU's scroll registers hold: this frame's origin, else the previous frame's (the one-frame publication ordering)
    const t = torusOf({ x: rec.originX, y: rec.originY });
    const live = scene.ring === 1 ? 'x' : 'y';
    const origin = t[live] === rec.scroll[live] || !prev ? { x: rec.originX, y: rec.originY } : { x: prev.originX, y: prev.originY };
    const vc = viewportCheck(nes, scene.project, scene.gridW, scene.gridH, origin);
    rec.terrain = { blocks: vc.blocks, badCount: vc.bad.length, bad: vc.bad.slice(0, 3), origin };
  }
  return rec;
}

const worldOf = (s) => ({ x: s.col * 256 + s.px, y: s.row * 240 + s.py });
/** The camera origin the design's one formula per axis gives (docs/design-streamed-worlds.md; streamedmovecam.expectedOrigin) -- the dead axis of a ring is pinned at 0. */
export function expectedOrigin(s, gridW, gridH) {
  const w = worldOf(s);
  return { x: clamp(w.x - 120, 0, (gridW - 1) * 256), y: clamp(w.y - 112, 0, (gridH - 1) * 240) };
}
/** The torus scroll a world-pixel origin publishes (streamedmovecam.torusOf): ring position = screen parity + local pixel. */
export const torusOf = (o) => ({ x: ((o.x >> 8) & 1) * 256 + (o.x & 255), y: (Math.floor(o.y / 240) & 1) * 240 + (o.y % 240) });

/**
 * Decodes every crossing in `frames` (the per-frame snapshots, in order). `ring` 1 = vertical mirroring (the world is N x 1, the player walks right),
 * 2 = horizontal (1 x N, down); `screens` = the scene's authored per-screen entity lists [{actor,x,y}] (the independent record of what each screen holds).
 * Returns { crossings: [{ frame, phase, from, to, kind, ... }], failures: [string], frames } where kind = 'move' if the body was a Move body (mv_left > 0 on either side), else 'walk'.
 * `around` = how many frames either side of a crossing are decoded for camera/scroll continuity.
 */
export function decodeSeams(allFrames, { ring, screens, gridW, gridH, around = 4 }) {
  // the boot/landing frames (the title -> gameplay landing is a forced-blank redraw, S1a's C0 rows) are not a crossing: decoding starts at the first frame of four consecutive gameplay frames on one screen with the player placed (a pre-landing frame reads sw_col/sw_row/player_x/player_y as 0)
  const inGrid = (s) => s.col < gridW && s.row < gridH;
  const first = allFrames.findIndex((s, i) => s.gs === 0 && s.px > 0 && s.py > 0 && inGrid(s) && [1, 2, 3].every((d) => allFrames[i + d] && allFrames[i + d].gs === 0 && allFrames[i + d].col === s.col && allFrames[i + d].row === s.row));
  if (first < 0) return { crossings: [], failures: ['the run never settled on a screen in gameplay (no four consecutive frames on one screen)'], frames: allFrames.length };
  const frames = allFrames.slice(first);
  const failures = [];
  const crossings = [];
  const axis = ring === 1 ? 'x' : 'y';
  const screenOf = (s) => (ring === 1 ? s.col : s.row);
  const size = ring === 1 ? 256 : 240;
  const fail = (f, msg) => failures.push(`frame ${f.frame} (${f.phase}): ${msg}`);
  // every frame, the identity/camera/scroll rules (the arrival frame included)
  for (const s of frames) {
    if (s.gs !== 0 && s.gs !== 2 && s.gs !== 5) continue; // gameplay / dialogue / battle: the world position still has to be coherent in 0 and 2
    if (s.flat !== s.col + s.row * gridW) fail(s, `flat_screen ${s.flat} != sw_col ${s.col} + sw_row ${s.row} * gridW ${gridW}`);
    if (ring === 1 && s.row !== 0) fail(s, `sw_row ${s.row} on a 1-row ring`);
    if (ring === 2 && s.col !== 0) fail(s, `sw_col ${s.col} on a 1-column ring`);
  }
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (a.col === b.col && a.row === b.row) continue;
    const dCol = b.col - a.col, dRow = b.row - a.row;
    const c = { frame: b.frame, phase: b.phase, from: [a.col, a.row], to: [b.col, b.row], kind: (a.mvLeft > 0 || b.mvLeft > 0 || b.gs === 2) ? 'move' : 'walk' };
    crossings.push(c);
    // 1. identity: exactly one screen along the ring axis, the dead axis untouched
    const along = ring === 1 ? dCol : dRow, dead = ring === 1 ? dRow : dCol;
    if (Math.abs(along) !== 1 || dead !== 0) fail(b, `crossing ${a.col},${a.row} -> ${b.col},${b.row} is not one screen along the ring axis`);
    c.dir = along;
    // 2. position continuity: the world coordinate along the axis advances by the step (1-2 px per frame; 3 = headroom for a fractional step), never jumps
    const pa = worldOf(a)[axis], pb = worldOf(b)[axis];
    c.step = pb - pa;
    if (Math.abs(c.step) > 3) fail(b, `world ${axis} jumped ${pa} -> ${pb} across the seam (${c.step} px)`);
    // 3. the local coordinate wrapped: it leaves one end of the screen and enters the other
    const la = axis === 'x' ? a.px : a.py, lb = axis === 'x' ? b.px : b.py;
    if (along === 1 && !(la + c.step >= size - 3 && lb <= 3 + (size === 240 ? 0 : 0)) && !(lb < la)) fail(b, `local ${axis} ${la} -> ${lb} does not wrap past the screen end (${size})`);
    // 4. the dead axis never moved
    const dead0 = axis === 'x' ? worldOf(a).y : worldOf(a).x, dead1 = axis === 'x' ? worldOf(b).y : worldOf(b).x;
    if (Math.abs(dead1 - dead0) > 3) fail(b, `dead-axis world coordinate jumped ${dead0} -> ${dead1}`);
    // 5. camera origin and published scroll, `around` frames either side
    let checked = 0;
    for (let k = Math.max(0, i - around); k <= Math.min(frames.length - 1, i + around); k++) {
      const s = frames[k];
      if (s.gs !== 0 && s.gs !== 2) continue;
      const exp = expectedOrigin(s, gridW, gridH);
      if (s.originX !== exp.x || s.originY !== exp.y) fail(s, `camera origin (${s.originX},${s.originY}), the design's formula says (${exp.x},${exp.y}) at world (${worldOf(s).x},${worldOf(s).y})`);
      // the published scroll: the PPU's scroll registers hold the torus position of the camera origin this frame's NMI published (this frame's or, if the
      // mainline had not yet moved the origin when the NMI ran, the previous frame's: one of the two, never anything else); the dead axis stays at 0
      if (s.gs === 0 && k > 0) {
        const t = torusOf({ x: s.originX, y: s.originY }), tp = torusOf({ x: frames[k - 1].originX, y: frames[k - 1].originY });
        const ok = (t2) => (ring === 1 ? s.scroll.x === t2.x && s.scroll.y === 0 : s.scroll.y === t2.y && s.scroll.x === 0);
        if (!ok(t) && !ok(tp)) fail(s, `published scroll (${s.scroll.x},${s.scroll.y}) is neither the torus position of this frame's origin (${t.x},${t.y}) nor the previous frame's (${tp.x},${tp.y})`);
      } else if (s.gs === 2 && k > 0) {
        // a scripted Move runs inside the dialogue state: the camera is published by the NMI that follows the mainline body that moved the origin, so the scroll the PPU holds at the end of frame k
        // is the torus position of the origin of frame k-1 -- exactly one frame behind, never this frame's and never anything older (a stale scroll is the fault this rule exists for). While a
        // Shake is live (shake_left > 0 on either frame) the published scroll is displaced by the shake offset (<= 2 px on either axis, wrapping at the torus), nothing more.
        const tp = torusOf({ x: frames[k - 1].originX, y: frames[k - 1].originY });
        const shaking = s.shakeLeft > 0 || frames[k - 1].shakeLeft > 0;
        const tol = shaking ? 2 : 0;
        const dx = Math.min((s.scroll.x - (ring === 1 ? tp.x : 0) + 512) % 512, (( ring === 1 ? tp.x : 0) - s.scroll.x + 512) % 512);
        const dy = Math.min((s.scroll.y - (ring === 1 ? 0 : tp.y) + 480) % 480, ((ring === 1 ? 0 : tp.y) - s.scroll.y + 480) % 480);
        if (dx > tol || dy > tol) fail(s, `Move published scroll (${s.scroll.x},${s.scroll.y}) is not the torus position of the PREVIOUS frame's origin (${ring === 1 ? tp.x : 0},${ring === 1 ? 0 : tp.y})${shaking ? ' within the 2 px Shake displacement' : ''}`);
      }
      if (s.terrain) {
        c.terrainFrames = (c.terrainFrames ?? 0) + 1; c.terrainBlocks = (c.terrainBlocks ?? 0) + s.terrain.blocks;
        if (s.terrain.badCount > 0) { c.terrainBad = (c.terrainBad ?? 0) + s.terrain.badCount; fail(s, `${s.terrain.badCount} viewport block(s) differ from the project's terrain/attribute record at origin (${s.terrain.origin.x},${s.terrain.origin.y}), first ${JSON.stringify(s.terrain.bad[0])}`); }
      }
      checked++;
    }
    c.originFramesChecked = checked;
    // 6. the arrival: spawn decode -- the entities present on the arrival frame are the authored record of that screen (actor ids; the arrival frame skips update_entities, so positions are the authored ones too)
    const authored = screens[b.row * gridW + b.col] ?? [];
    const key = (e) => `${e.actor},${e.x},${e.y}`;
    const got = b.ents.map(key).sort(), want = authored.map(key).sort();
    c.spawned = got.length; c.authored = want.length;
    c.spawnMatch = JSON.stringify(got) === JSON.stringify(want);
    if (!c.spawnMatch) fail(b, `arrival screen (${b.col},${b.row}) spawned [${got.join(' ')}], the authored record holds [${want.join(' ')}]`);
    // 7. strip state is coherent: idle or the ring's own length
    if (b.stActive && b.stLen !== (ring === 1 ? 15 : 16) && b.stLen !== 0) fail(b, `strip length ${b.stLen} at the crossing (ring ${ring})`);
  }
  return { crossings, failures, frames: frames.length };
}

/**
 * Binds every decoded crossing to the body that made it, and every crossing body to a decoded crossing. `rows` = the jsnes rows of the spec (each with .frame, .cls, .counters, .phase).
 * A body of nes.frame() call F carries row.frame == F - 1 and the decoder's snapshot of that call is `frame` F, so crossing.frame - 1 names the body. A walking ownership crossing is a C3a body, a
 * scripted Move's a C4b body, and the direction counter (xl / xr / xu / xd) must agree with the decoded direction of travel along the ring.
 */
export function bindCrossings(crossings, rows, { ring }) {
  const dirKey = (dir) => (ring === 1 ? (dir > 0 ? 'xr' : 'xl') : (dir > 0 ? 'xd' : 'xu'));
  // a walking ownership crossing is a C3a body, or a C3b one when a chaser's knockback is live in the same body (kb outranks the crossing in the classifier); a scripted Move's seam crossing is a C4b body, or
  // the C4c one in which the Move completes (the final handoff body, mvf)
  const want = { walk: ['C3a', 'C3b'], move: ['C4b', 'C4c'] };
  const used = new Set();
  const unbound = [];
  let bound = 0, outside = 0;
  const bound_by = { walk: 0, move: 0 }, outside_by = { walk: 0, move: 0 };
  // a body exists only for a COLLECTED phase (the positioning frames before it are not measured); a crossing there has no body to bind and is counted, not dropped
  const span = new Map();
  for (const r of rows) { const e = span.get(r.phase) ?? [Infinity, -Infinity]; span.set(r.phase, [Math.min(e[0], r.frame), Math.max(e[1], r.frame)]); }
  const measured = (f) => [...span.values()].some(([a, b]) => f >= a && f <= b);
  for (const c of crossings) {
    if (!measured(c.frame - 1)) { outside++; outside_by[c.kind]++; continue; }
    const i = rows.findIndex((r, ix) => !used.has(ix) && r.frame === c.frame - 1 && want[c.kind].includes(r.cls) && (r.counters[dirKey(c.dir)] ?? 0) > 0);
    if (i < 0) { unbound.push(`${c.kind} crossing at frame ${c.frame} (${c.from.join(',')} -> ${c.to.join(',')}, dir ${c.dir}) has no ${want[c.kind].join('/')} body at frame ${c.frame - 1} that ran ${dirKey(c.dir)}`); continue; }
    used.add(i); bound++; bound_by[c.kind]++;
  }
  const orphans = rows.filter((r, ix) => !used.has(ix) && ['xl', 'xr', 'xu', 'xd'].some((k) => (r.counters[k] ?? 0) > 0) && (want.walk.includes(r.cls) || want.move.includes(r.cls))).map((r) => `${r.phase}@${r.frame} ${r.cls} ran sw_cross_* but no decoded crossing is at frame ${r.frame + 1}`);
  return { bound, bound_by, outside, outside_by, total: crossings.length, unbound, orphans };
}
