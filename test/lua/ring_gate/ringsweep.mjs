// The sweep scenes of the coverage campaign (handoff-next/phase3b-s1a-coverage.md sections 2-5): a world of N screens, a landing at a chosen
// window origin, and a walk that visits every window-origin block of an interval forward and back, with every landing, check and hold declared
// (`expect.sequence`) and every boundary identity the walk must witness declared (`expect.witnesses`, ringwitness.mjs) from the GEOMETRY.
import { TYPING } from './ringscene.mjs';
import { GEOM, bmaxOf, windowBlock, requiredWitnesses } from './ringwitness.mjs';

/** Where the player lands for a world position on the scrolling axis (ringProject's `start`). */
export function startFor(ring, world) {
  const g = GEOM[ring];
  return ring === 1 ? { screen: Math.floor(world / g.span), x: world % g.span, y: 120 } : { screen: Math.floor(world / g.span), x: 120, y: world % g.span };
}
const posOf = (ring, world) => {
  const g = GEOM[ring];
  return ring === 1 ? { col: Math.floor(world / g.span), row: 0, px: world % g.span, py: 120 } : { col: 0, row: Math.floor(world / g.span), px: 120, py: world % g.span };
};

/** The sweep. b0/b1: the window-origin interval (b1 clipped to bmax); walk: also step every 32 px (the camera-only cases N <= 2). */
export function sweepScene({ ring, n, b0 = 0, b1 = null, walk = false, landTerminal = false, wall = true }) {
  const g = GEOM[ring];
  const bmax = bmaxOf(ring, n);
  b1 = Math.min(b1 ?? bmax, bmax);
  if (b0 > b1) throw new Error(`sweep b0 ${b0} > b1 ${b1}`);
  const Wf = (b) => (b + g.K) * 16 + g.center; // first world position whose window origin is b, moving forward
  const Wb = (b) => (b + g.K) * 16 + 15 + g.center; // the last one, moving back
  const ceilW = (n - 1) * g.span + g.center; // world position at which the camera reaches its ceiling
  const endW = n * g.span - (ring === 1 ? 16 : 24);
  const startW = landTerminal ? ceilW + 24 : b0 > 0 ? Wf(b0) : g.center;
  const land = windowBlock({ ring, n, ...posOf(ring, startW) });
  const steps = [{ op: 'boot' }, { op: 'check', label: 'sw:land' }];
  const arrivals = [];
  const extra = [];
  const carry = (w) => { if (Math.floor(w / g.span) >= 1 && w < n * g.span) extra.push(w % g.span < g.center ? 'carry:borrow' : 'carry:no-borrow'); };
  const planned = (w) => windowBlock({ ring, n, ...posOf(ring, w) });
  const leg = (dir, item) => {
    const hold = dir === 'fwd' ? { op: 'hold', btn: g.fwd, axis: g.axis, gte: item.w, max: 900 } : { op: 'hold', btn: g.back, axis: g.axis, lte: item.w, max: 900 };
    steps.push(hold, { op: 'check', label: item.label });
    if (item.b !== undefined) arrivals.push({ b: item.b, dir });
    carry(item.w);
  };
  const blocksFwd = [];
  for (let k = b0 + 1; k <= b1; k++) {
    if (planned(Wf(k)) !== k) throw new Error(`sweep: forward target of block ${k} gives window ${planned(Wf(k))}`);
    blocksFwd.push({ w: Wf(k), label: `sw:fwd:b=${k}`, b: k });
  }
  const walkPts = [];
  if (walk) for (let w = startW + 32; w < ceilW - 16; w += 32) walkPts.push({ w, b: planned(w) });
  const ascending = (arr) => [...arr].sort((x, y) => x.w - y.w);
  const walkFwd = walkPts.map((p) => ({ ...p, label: `sw:fwd:w=${p.w}` }));
  const walkBack = walkPts.map((p) => ({ ...p, label: `sw:back:w=${p.w}` }));
  if (!landTerminal) for (const it of ascending([...blocksFwd, ...walkFwd])) leg('fwd', it);
  // the turnaround: run to the LAST pixel of block b1 first, so the back leg that follows really moves back inside b1 (a hold that ends on its
  // first frame at the block's first pixel would otherwise step back into b1 - 1)
  if (b1 < bmax && !landTerminal) leg('fwd', { w: Wb(b1), label: 'sw:turn' });
  // the terminal region: the camera's ceiling and the world's last pixel
  const terminal = b1 === bmax;
  if (terminal && !landTerminal) {
    if (n >= 2 && ceilW - 8 > startW) { leg('fwd', { w: ceilW - 8, label: 'sw:hi-edge' }); extra.push('clamp-hi-edge'); }
    leg('fwd', { w: ceilW + 24, label: 'sw:hi' });
    extra.push('clamp-hi');
  }
  if (terminal) { leg('fwd', { w: endW, label: 'sw:hi-end' }); if (landTerminal) extra.push('clamp-hi'); }
  // back: the turnaround block, then every block down to b0 (and the camera-only walk points)
  const blocksBack = [];
  for (let k = b1; k >= b0; k--) {
    if (planned(Wb(k)) !== k) throw new Error(`sweep: back target of block ${k} gives window ${planned(Wb(k))}`);
    blocksBack.push({ w: Wb(k), label: `sw:back:b=${k}`, b: k });
  }
  for (const it of ascending([...blocksBack, ...walkBack]).reverse()) leg('back', it);
  if (b0 === 0 && !landTerminal) {
    leg('back', { w: g.center + 10, label: 'sw:lo-edge' });
    leg('back', { w: g.center - 20, label: 'sw:lo' });
    extra.push('clamp-lo', 'clamp-lo-edge');
  }
  if (landTerminal) for (const it of blocksFwd) leg('fwd', it); // after a terminal landing: forward again through the same blocks
  if (wall) {
    steps.push({ op: 'hold', btn: g.deadFwd, axis: g.deadAxis, gte: 99999, max: 900, wall: true }, { op: 'check', label: `sw:wall:${g.deadFwd}` });
    steps.push({ op: 'hold', btn: g.deadBack, axis: g.deadAxis, lte: -1, max: 900, wall: true }, { op: 'check', label: `sw:wall:${g.deadBack}` });
    extra.push(`dead-axis:wall:${g.deadFwd}`, `dead-axis:wall:${g.deadBack}`);
  }
  const sequence = [];
  for (const st of steps) {
    if (st.op === 'check') sequence.push({ t: 'check', label: st.label });
    else if (st.op === 'hold') sequence.push({ t: 'hold', label: `hold:${st.btn}:${st.gte ?? st.lte}` });
  }
  const walls = steps.filter((st) => st.wall).map((st) => `hold:${st.btn}:${st.gte ?? st.lte}`);
  return {
    steps, start: startFor(ring, startW), world: { n, talkers: 'none' },
    expect: {
      kind: 'sweep', ring, n, b0, b1, bmax, holds: steps.filter((st) => st.op === 'hold').length, walls, dialogues: 0, boxLiveNts: [], boxSeam: false,
      typing: TYPING, sequence, witnesses: requiredWitnesses({ ring, n, landing: land, arrivals, extra })
    }
  };
}

/**
 * Mid-block reversals at every fine residue 0..15 of the camera pixel, at two window origins of opposite near-edge screen parity: walk forward
 * to the residue, straight back across a block boundary, forward again (a back->forward reversal at the residue 8 further on).
 */
export function reversalScene({ ring, n = 6, bases = [20, 37], residues = Array.from({ length: 16 }, (_, i) => i) }) {
  const g = GEOM[ring];
  const Wf = (b) => (b + g.K) * 16 + g.center;
  const startW = Wf(bases[0]) - 40;
  const steps = [{ op: 'boot' }, { op: 'check', label: 'sw:land' }];
  const extra = [];
  // every reversal point is positioned EXACTLY (op 'to'), so each fine residue is hit, not skipped by the fractional walking speed
  const to = (btn, w, label) => steps.push({ op: 'to', btn, fwd: g.fwd, back: g.back, axis: g.axis, target: w, max: 200 }, { op: 'check', label });
  for (const b0 of bases) for (const r of residues) {
    const top = Wf(b0) + r;
    to(g.fwd, top, `sw:rev:b=${b0}:r=${r}:fwd`);
    to(g.back, top - 24, `sw:rev:b=${b0}:r=${r}:back`);
    to(g.fwd, top - 8, `sw:rev:b=${b0}:r=${r}:fwd2`);
    extra.push(`rev:fwd2back:f=${r}`, `rev:back2fwd:f=${(r + 8) & 15}`); // (top-24 and top-8 are both = r+8 mod 16 -- the back->fwd reversal sits at the second)
  }
  const sequence = steps.filter((st) => st.op !== 'boot').map((st) => (st.op === 'check' ? { t: 'check', label: st.label } : { t: 'hold', label: `hold:${st.btn}:${st.target ?? st.gte ?? st.lte}` }));
  return {
    steps, start: startFor(ring, startW), world: { n, talkers: 'none' },
    expect: { kind: 'sweep', ring, n, holds: steps.filter((st) => st.op === 'hold' || st.op === 'to').length, walls: [], dialogues: 0, boxLiveNts: [], boxSeam: false, typing: TYPING, sequence, witnesses: requiredWitnesses({ ring, n, landing: windowBlock({ ring, n, ...posOf(ring, startW) }), arrivals: [], extra }) }
  };
}
