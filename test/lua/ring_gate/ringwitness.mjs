// Named coverage witnesses of the sweep scenes (docs: handoff-next/phase3b-s1a-coverage.md section 3). A witness is an IDENTITY a scene must
// have observed, derived from the scene's own geometry when it is built (requirement) and, separately, from the records a run produced
// (observation). The judge fails a scene by naming every required identity no record observed. Neither side reads the other's output.
import { expectedCamera } from '../../lib/streamcamera.js';

/** Per-ring geometry on the scrolling axis. P = ring length in blocks, H = NT boundary, S = blocks per screen, K = camera-to-window offset. */
export const GEOM = {
  1: { P: 32, H: 16, S: 16, K: 8, span: 256, center: 120, fwd: 'right', back: 'left', axis: 'x', deadAxis: 'y', deadFwd: 'down', deadBack: 'up' },
  2: { P: 30, H: 15, S: 15, K: 7, span: 240, center: 112, fwd: 'down', back: 'up', axis: 'y', deadAxis: 'x', deadFwd: 'right', deadBack: 'left' }
};
export const bmaxOf = (ring, n) => Math.max(0, (n - 2) * GEOM[ring].S);

/** The window origin block the camera rule gives for a recorded/planned player position (expectedCamera is the independent statement of the rule). */
export function windowBlock({ ring, n, col, row, px, py }) {
  const g = GEOM[ring];
  const cam = expectedCamera({ gridW: ring === 1 ? n : 1, gridH: ring === 1 ? 1 : n, col, row, px, py });
  return ring === 1 ? cam.sw_fc_desc * g.S + cam.sw_fc_desl : cam.sw_fc_desr * g.S + cam.sw_fc_desrl;
}

const rel3 = (v, at) => (v === at - 1 ? 'before' : v === at ? 'at' : v === at + 1 ? 'after' : null);
/** The boundary identities a settled window origin `b` (arrived `dir`) witnesses -- one function, used for the requirement and the observation. */
export function categoryIds({ ring, n, b, dir }) {
  const { P, H, S } = GEOM[ring];
  const bmax = bmaxOf(ring, n);
  const edge = b > 0 && b < bmax ? 'interior' : 'edge';
  const ids = [];
  const c0 = b % P, c1 = (b + P - 1) % P; // near and far (entering) edge physical block column/row
  for (const [which, c] of [['near', c0], ['far', c1]]) {
    if (c === P - 1 || c === 0 || c === 1) ids.push(`${which}-phys-wrap:${c === P - 1 ? 'before' : c === 0 ? 'at' : 'after'}:${dir}:${edge}`);
    const nt = rel3(c, H);
    if (nt) ids.push(`${which}-nt-bnd:${nt}:${dir}:${edge}`);
  }
  for (const [name, k] of [['screen-15-16', 16 * S], ['region-23-24', 24 * S]]) {
    const nearRel = rel3(b, k), farRel = rel3(b + P - 1, k);
    if (nearRel) ids.push(`near-${name}:${nearRel}:${dir}`);
    if (farRel) ids.push(`far-${name}:${farRel}:${dir}`);
  }
  const blk = rel3(b, 256);
  if (blk) ids.push(`block-255-256:${blk}:${dir}`);
  if (ring === 1) { const hi = rel3(b, 2040); if (hi) ids.push(`camhi-127-128:${hi}:${dir}`); } // camPx = (b+8)*16: its hi byte reaches 128 at b = 2040
  return ids;
}

/**
 * The dialogue class an open box belongs to, from the camera registers the nudge left (cam floored to 16 px): ring 1 the box's first tile column
 * `r = cam_x/8` (even, 0..30) and the NT parity; ring 2 the box's first tile row `R0 = (cam_y/8 + 24) mod 30` (even) and the NT parity (cam_nt bit 1).
 */
export function dialogueClassId(ring, s) {
  if (ring === 1) return `dlg:r=${(s.cam_x_lo & 0xf0) >> 3}:p=${s.cam_nt & 1}`;
  return `dlg:R0=${(((s.cam_y_lo & 0xf0) >> 3) + 24) % 30}:p=${(s.cam_nt >> 1) & 1}`;
}

/** What one settled record's own state witnesses besides its window origin: the clamps and the 16-bit borrow. */
export function stateIds({ ring, n, state }) {
  const g = GEOM[ring];
  const world = ring === 1 ? state.sw_col * 256 + state.player_x : state.sw_row * 240 + state.player_y;
  const raw = world - g.center;
  const cap = (n - 1) * g.span;
  const ids = [];
  if (raw < 0) ids.push('clamp-lo');
  if (raw >= 1 && raw <= 15) ids.push('clamp-lo-edge');
  if (raw > cap) ids.push('clamp-hi');
  if (raw >= cap - 15 && raw <= cap - 1 && cap > 15) ids.push('clamp-hi-edge');
  const scr = ring === 1 ? state.sw_col : state.sw_row;
  const local = ring === 1 ? state.player_x : state.player_y;
  if (scr >= 1) ids.push(local < g.center ? 'carry:borrow' : 'carry:no-borrow');
  return ids;
}

export const dirOfHold = (ring, btn) => (btn === GEOM[ring].fwd ? 'fwd' : btn === GEOM[ring].back ? 'back' : null);

/**
 * The identities observed in a run's records. `scoped`: only records whose label starts with 'sw:' (the sweep's own checks) contribute; a
 * dialogue's closed record or a stray check never counts as a window arrival.
 */
export function observedWitnesses(records, { ring, n }, { detail = false } = {}) {
  const g = GEOM[ring];
  const seen = new Map(); // id -> first record label (detail: { label, index, kind, b, state, hold } of the first observing record)
  let cur = null, curIndex = -1, curB = null;
  const STATE_KEYS = ['sw_col', 'sw_row', 'player_x', 'player_y', 'cam_x_lo', 'cam_y_lo', 'cam_nt', 'ppuctrl_nt'];
  const note = (id, label) => {
    if (seen.has(id)) return;
    if (!detail) { seen.set(id, label); return; }
    seen.set(id, {
      label, index: curIndex, kind: cur.kind, ...(curB === null ? {} : { b: curB }),
      ...(cur.state ? { state: Object.fromEntries(STATE_KEYS.map((k) => [k, cur.state[k]])) } : {}),
      ...(cur.hold ? { hold: Object.fromEntries(['btn', 'reached', 'why', 'pos', 'slot', 'expectSlot', 'place', 'placeBefore'].filter((k) => cur.hold[k] !== undefined).map((k) => [k, cur.hold[k]])) } : {})
    });
  };
  let last = null; // the previous record that was a hold, until the next check consumes it
  let prevCheck = null;
  let lastRedraw = null;
  let lastShakeAfter = null;
  for (const [ri, r] of records.entries()) {
    cur = r; curIndex = ri; curB = null;
    if (r.kind === 'hold') {
      last = r;
      if (r.hold && r.hold.btn === 'battle' && r.hold.reached && r.hold.slot >= 0) note(`battle-slot:${r.hold.slot}`, r.label); // the entity slot that made contact (bt_from_ent), read on the frame the battle began
      if (r.hold && r.hold.why === 'blocked' && !r.hold.reached) note(`dead-axis:wall:${r.hold.btn}`, r.label);
      continue;
    }
    if (r.kind === 'shake-frame') { note(`shake:ppuctrl=${r.state.ppuctrl_nt}`, r.label); continue; } // PPUCTRL's select during a real Shake (1/3 are the transient ones)
    if (r.kind === 'dlg-open') { const id = dialogueClassId(ring, r.state); if (id) note(id, r.label); continue; }
    if (r.kind !== 'settled' || !r.label.startsWith('sw:')) { last = null; continue; }
    const s = r.state;
    if (r.label.startsWith('sw:shake-')) {
      // after the shake: the display register is EXACTLY the camera's NT again (not merely an alias), and ordinary streaming resumes after it
      const exact = s.ppuctrl_nt === s.cam_nt;
      if (r.label.startsWith('sw:shake-after:')) { if (exact) note(`shake-restored:cam_nt=${s.cam_nt}`, r.label); lastShakeAfter = s; }
      else if (exact && lastShakeAfter && ((ring === 1 ? s.cam_x_lo !== lastShakeAfter.cam_x_lo : s.cam_y_lo !== lastShakeAfter.cam_y_lo) || s.cam_nt !== lastShakeAfter.cam_nt)) note(`shake-stream:cam_nt=${s.cam_nt}`, r.label);
      last = null;
      continue;
    }
    if (r.label.startsWith('sw:redraw:') || r.label.startsWith('sw:stream:')) {
      // a redraw entry's landing / the walk that follows it: the identity carries the entry, the window's physical origin c0 and the direction
      const [, kind, entry, , dir] = r.label.split(':');
      const b = windowBlock({ ring, n, col: s.sw_col, row: s.sw_row, px: s.player_x, py: s.player_y });
      curB = b;
      if (kind === 'redraw') { note(`redraw:${entry}:c0=${b % g.P}:${dir}`, r.label); lastRedraw = { entry, b, dir }; if (entry === 'continue') note(`continue-land:s=${ring === 1 ? s.sw_col : s.sw_row}:y=${s.player_y}`, r.label); }
      else if (lastRedraw && lastRedraw.entry === entry && (dir === 'fwd' ? b > lastRedraw.b : b < lastRedraw.b)) note(`stream:${entry}:c0=${lastRedraw.b % g.P}:${dir}`, r.label);
      for (const id of stateIds({ ring, n, state: s })) note(id, r.label);
      last = null;
      continue;
    }
    const b = windowBlock({ ring, n, col: s.sw_col, row: s.sw_row, px: s.player_x, py: s.player_y });
    curB = b;
    const hold = last?.hold;
    const dir = hold && hold.reached ? dirOfHold(ring, hold.btn) : null;
    if (!last) note(`landing:b=${b}:parity=${Math.floor(b / g.S) & 1}`, r.label);
    else if (dir) {
      note(`win:b=${b}:${dir}`, r.label);
      for (const id of categoryIds({ ring, n, b, dir })) note(id, r.label);
      // a reversal: this arrival's direction differs from the previous check's arrival direction
      if (prevCheck && prevCheck.dir && prevCheck.dir !== dir) {
        note(`rev:${prevCheck.dir}2${dir}:f=${prevCheck.f}`, r.label);
      }
    }
    for (const id of stateIds({ ring, n, state: s })) note(id, r.label);
    prevCheck = { dir, f: (ring === 1 ? s.cam_x_lo : s.cam_y_lo) & 15 };
    last = null;
  }
  return seen;
}

/** The first observing record of every identity: id -> { label, index, kind, b?, state?, hold? } (the witness -> record map a stamp carries; no VRAM dump). */
export const observedWitnessRecords = (records, opts) => observedWitnesses(records, opts, { detail: true });

/** Requirement side: ids a scene's PLAN declares (arrivals {b,dir}, landing b, extra ids), derived from geometry alone. */
export function requiredWitnesses({ ring, n, landing, arrivals = [], extra = [] }) {
  const g = GEOM[ring];
  const ids = new Set(extra);
  if (landing !== undefined) ids.add(`landing:b=${landing}:parity=${Math.floor(landing / g.S) & 1}`);
  for (const { b, dir } of arrivals) { ids.add(`win:b=${b}:${dir}`); for (const id of categoryIds({ ring, n, b, dir })) ids.add(id); }
  return [...ids].sort();
}

/** The failures of a run against the scene's required identities (one line per missing identity, capped by the caller). */
export function witnessFailures(records, expect, ctx) {
  if (!expect.witnesses) return [];
  const seen = observedWitnesses(records, { ring: ctx.ring, n: expect.n });
  return expect.witnesses.filter((id) => !seen.has(id)).map((id) => `missing witness ${id}`);
}
