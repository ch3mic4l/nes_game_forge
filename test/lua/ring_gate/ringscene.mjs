// The scripted scenarios the oracle runs in BOTH emulators. One step list, two interpreters (ringrun_jsnes.mjs here, ring_oracle.lua.template
// under Mesen), so each emulator cross-checks the other on the same scenario. Steps are position-driven (world pixels read from RAM),
// never frame-counted, so a one-frame timing difference between the emulators cannot change what is checked.
//
//   {op:'boot'}                     run until the streamed map is live, then settle (a dialogue opened by the landing is handled)
//   {op:'check', label}             settle, then record (player state, camera, live NTs + aliases) for the judge
//   {op:'hold', btn, axis, gte|lte, max}   hold a d-pad button until the world position passes the target. The interpreter RECORDS whether
//                                   it was reached ({kind:'hold'}): an unreached hold is a coverage failure, never a silent stop.
//   {op:'dialog', label}            if a dialogue is open: record its typing stage, its open (typed) state, close with A, settle, record closed
// A dialogue that opens DURING a hold (an `enter` talker on a seam crossing) is handled by the same dialog procedure and the hold resumes.
//
// Every scenario DECLARES what it must have covered (`expect`); `judgeCoverage` (ringjudge.mjs) checks the records against it, as a verdict
// separate from the VRAM verdict. A run that does not move, or loses a dialogue, fails coverage even when every byte it did record is right.
//
// `expect.sequence` is the EXACT ordered list of mandatory records, declared here from the step list and the world geometry alone (never read
// back from a run): {t:'check', label}, {t:'hold', label} and {t:'dialogue', screen} (one typing -> open -> closed transaction, on the screen the
// player is in when it opens). `expect.typing` is the partial typing prefix every typing observation must show: msg_line, and msg_col in
// [minCol, maxCol] -- at least the recorder's threshold of 3 glyphs, never the whole first page.

/** The declared partial typing prefix of every typing observation: first line, 3..6 glyphs of the 13-glyph first page. */
export const TYPING = { line: 0, minCol: 3, maxCol: 6 };

/** The four-screen lap: forward across every screen and back, two checks per screen, enter talkers opening a dialogue per crossing. */
export function laps({ ring, n = 4, talkers }) {
  const axis = ring === 1 ? 'x' : 'y';
  const span = ring === 1 ? 256 : 240;
  const btnFwd = ring === 1 ? 'right' : 'down';
  const btnBack = ring === 1 ? 'left' : 'up';
  const start = 120; // the player's start coordinate on the walking axis
  const steps = [{ op: 'boot' }, { op: 'check', label: 'cold-boot' }];
  const points = [];
  for (let k = 0; k < n; k++) for (const off of [16, 136]) if (k * span + off > start + 8) points.push(k * span + off);
  points[points.length - 1] = n * span - 24;
  for (const p of points) {
    steps.push({ op: 'hold', btn: btnFwd, axis, gte: p, max: 900 });
    steps.push({ op: 'check', label: `fwd@${axis}=${p}` });
  }
  for (const p of [...points.slice(0, -1).reverse(), start]) {
    steps.push({ op: 'hold', btn: btnBack, axis, lte: p, max: 900 });
    steps.push({ op: 'check', label: `back@${axis}=${p}` });
  }
  const enter = talkers === 'enter';
  const sequence = [];
  if (enter) sequence.push({ t: 'dialogue', screen: 0 }); // the boot landing's own enter dialogue
  let pos = start;
  for (const st of steps) {
    if (st.op === 'check') sequence.push({ t: 'check', label: st.label });
    else if (st.op === 'hold') {
      // every screen the hold's target lies beyond is entered on the way: an `enter` talker opens a dialogue on each entry
      const target = st.gte ?? st.lte;
      const from = Math.floor(pos / span), to = Math.floor(target / span);
      if (enter) for (let s = from; s !== to; ) { s += to > from ? 1 : -1; sequence.push({ t: 'dialogue', screen: s }); }
      sequence.push({ t: 'hold', label: `hold:${st.btn}:${target}` });
      pos = target;
    }
  }
  return {
    steps,
    expect: {
      kind: 'lap', n, ring, axis,
      screens: Array.from({ length: n }, (_, i) => i),
      forward: n - 1, back: n - 1, // screen crossings seen between consecutive checks
      holds: steps.filter((st) => st.op === 'hold').length,
      liveNts: [0, 1],
      dialogues: enter ? 2 * (n - 1) + 1 : 0, // the boot landing, every forward crossing, every return crossing
      boxLiveNts: enter ? [0, 1] : [],
      boxSeam: false,
      typing: TYPING,
      sequence
    }
  };
}

/**
 * Dialogue-at-a-seam scenarios: the player LANDS at a position whose floored camera makes the six-row box straddle a physical
 * nametable seam (the boot landing opens the screen's `enter` dialogue there). `variant` 0: world screen 0; 1: world screen 1 (so the
 * straddle is the wrap edge of the physical ring rather than the NT0|NT1 seam). Geometry: the camera is the player minus (120 | 112), the
 * nudge floors it to 16 px, the box starts at tile column/row (cam/8) of its NT.
 */
export function seamStart({ ring, variant }) {
  // vertical: camera x local 16 -> player x 136 on screen `variant` (box columns 2..33 of the NT: straddles NT column 32)
  // horizontal: camera y local 16 -> player y 128 on screen `variant` (box rows 26..31 of the NT: straddles tile row 30)
  return ring === 1 ? { screen: variant, x: 136, y: 120 } : { screen: variant, x: 120, y: 128 };
}
export function seam({ ring, variant }) {
  return {
    steps: [{ op: 'boot' }, { op: 'check', label: 'seam-landing' }],
    expect: {
      kind: 'seam', ring, screens: [variant], forward: 0, back: 0, holds: 0, liveNts: [], dialogues: 1, boxLiveNts: [], boxSeam: true,
      typing: TYPING, sequence: [{ t: 'dialogue', screen: variant }, { t: 'check', label: 'seam-landing' }]
    }
  };
}
