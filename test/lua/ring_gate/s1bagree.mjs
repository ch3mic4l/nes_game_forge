// Phase 3b S1b round 2, finding 4: PER-BODY agreement and sanity of the executed-path records. Pure (rows in, failures out) so s1b_unit.mjs can feed it synthetic and
// sabotaged rows. Round 1 compared class MAXIMA across the emulators, so a counter deleted in BOTH records, or counters permuted between bodies, still agreed; here
//   compareBodies    corresponding bodies (same spec, same phase, same ordinal) must carry EXACTLY the same class, counters, read events and end state in both emulators;
//                    the documented timing exceptions are the only tolerances (below), and the permutation of any two non-identical bodies is a failure;
//   relationships    the counters must satisfy the arithmetic of the transactions the engine actually made, so two identically broken hooks cannot agree their way past it:
//                      #g events == goto, #l events == loc, #p events == peek, pkc == the sum of the p events' d, bank == goto + loc (+ the explicit extras),
//                      mwm == K(mapper) x (bank + chr)  (K = register writes per bank switch, from the primitive's source), mwn == K x NMI-side switches;
//   requiredEvidence a record with no loc, bank, mapper-write or read-price evidence at all is a failed measurement, not a pass;
//   classInvariants  the class a body was given must be consistent with the INDEPENDENTLY read game state (a frozen class has game_state != 0, a walking one 0).
import { parseEvents } from './s1bbound.mjs';

/** Register writes one PRG-bank switch makes, per mapper number (engine/banks.asm: MMC1's 5-write serial register, MMC3's TWO select + data pairs, because a 16 KB bank is two consecutive 8 KB registers: 4 writes; UNROM 512's one latch write); each figure was confirmed against the measured mainline counters of its cell. */
export const WRITES_PER_SWITCH = { 1: 5, 4: 4, 30: 1 };
/** Mapper-register writes of ONE forced-blank screen redraw (C0) beyond its PRG switches, per mapper number (engine/screens.asm redraw_screen -> switch_chr_bank): MMC1's 5-write CHR select, MMC3's six register
 *  select/value pairs (12 writes: R0-R5) plus redraw_screen's own `sta $E000` (the scanline counter off, under SPLIT_ENABLED, which every MMC3 cell builds), UNROM 512's one latch write. Each figure was read from the
 *  C0 bodies of every cell's measured record (mainline writes 45 = 5 x (8 + 1) on MMC1, 45 = 4 x 8 + 13 on MMC3, 9 = 8 + 1 on UNROM 512) and from the source named. */
/** Mapper-range writes of one MMC3 scanline-IRQ handler (engine/split.asm `irq:`, line 138): [last entry, re-arming entry]. The handler always writes `sta $E000` (line 140) and the R1 select/data pair `sta $8000` / `sta $8001`
 *  (lines 153, 155) = 3; when the program has a next entry it also writes `sta $C000` / `sta $C001` / `sta $E001` (lines 161-163) = 6. There is no other path: every handler entry makes exactly 3 or exactly 6 writes, so the
 *  writes beyond a body's PRG switches that its `irq` counter explains are 3a + 6b with a + b == irq (multiples of 3, from 3*irq to 6*irq), never an arbitrary interval. An IRQ landing in a mainline body is counted in `mwm` (it is not the NMI). */
export const IRQ_WRITES = { 4: [3, 6] };
/** Whether `rest` mapper-range writes are exactly the output of `irq` handler entries: some a + b == irq with rest == lo*a + hi*b (the reachable totals). */
export function irqWritesReachable(rest, irq, mapper) {
  const [lo, hi] = IRQ_WRITES[mapper] ?? [0, 0];
  for (let b = 0; b <= irq; b++) if (rest === lo * (irq - b) + hi * b) return true;
  return false;
}
export const REDRAW_WRITES = { 1: 5, 4: 13, 30: 1 };
/** The documented timing exceptions between the two emulators: nmiT is the releasing NMI's own length and varies by +-1..2 cycles between cores (the NMI-latency model). */
export const NMI_TOLERANCE = 2;
const KEYS_EXACT = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'nmiT').sort();

/** One body's comparison: [] when equal, else the human-readable differences. */
export function compareBody(m, j, { ignore = [] } = {}) {
  const d = [];
  if (m.cls !== j.cls) d.push(`class ${m.cls}/${j.cls}`);
  for (const k of KEYS_EXACT(m.counters, j.counters)) if (!ignore.includes(k) && (m.counters[k] ?? 0) !== (j.counters[k] ?? 0)) d.push(`${k} ${m.counters[k] ?? 0}/${j.counters[k] ?? 0}`);
  if (Math.abs((m.counters.nmiT ?? 0) - (j.counters.nmiT ?? 0)) > NMI_TOLERANCE) d.push(`nmiT ${m.counters.nmiT}/${j.counters.nmiT}`);
  if (JSON.stringify(m.events ?? []) !== JSON.stringify(j.events ?? [])) d.push(`events ${(m.events ?? []).length}/${(j.events ?? []).length}`);
  if (m.gs !== j.gs) d.push(`game_state ${m.gs}/${j.gs}`);
  for (const k of new Set([...Object.keys(m.state ?? {}), ...Object.keys(j.state ?? {})])) if ((m.state?.[k] ?? 0) !== (j.state?.[k] ?? 0)) d.push(`state.${k} ${m.state?.[k]}/${j.state?.[k]}`);
  return d;
}

/** Round 3 triage (reviewer's ruling on review 2 finding 4): the entity draw's park-split counter `dsp` is the one counter the two cores are known to disagree on (a body's worth of parked tiles at the
 *  transitions of a moving entity across the viewport edge; the cause is NOT established). Its cross-core EQUALITY is declared UNCERTIFIED and split out of `agree:bodies` into the item `agree:dsp`:
 *  `compareBodies` ignores it for the ordinary body agreement (every other comparison unchanged) and reports every discrepancy as an observation (`out.dsp`). No alignment rule, no tolerance, no pairing
 *  permission: `pairBodies` keeps full equality, `dsp` included. What replaces it as a CERTIFIED check is the per-emulator range guard `dspRangeFailures` (0 <= dsp <= dst), which does not certify an
 *  in-range wrong or dead `dsp` hook. */
export const DSP_KEYS = ['dsp'];
/**
 * Per emulator, independently: `dst` and `dsp` of every body are nonnegative integers (an omitted counter is the format's zero default) and `dsp <= dst`, because every `dsw_st_park` visit belongs to one
 * `dsw_st_tile` iteration of the same straddle loop (engine/streamworld.asm, dsw_straddle: `dsw_st_tile:` ... `bne dsw_st_park` / `bcs dsw_st_park` ... `dsw_st_park:` ... `bne dsw_st_tile`-style loop, one
 * park per tile). A hook that counts 1000 parks over 16 tile iterations is wrong in that emulator whatever the other one says.
 */
export function dspRangeFailures(perSpec, emu) {
  const bad = [];
  for (const s of perSpec) for (const r of s[emu]?.rows ?? []) {
    const dst = r.counters?.dst ?? 0, dsp = r.counters?.dsp ?? 0;
    const why = !Number.isInteger(dst) || dst < 0 ? `dst ${dst} is not a nonnegative integer` : !Number.isInteger(dsp) || dsp < 0 ? `dsp ${dsp} is not a nonnegative integer` : dsp > dst ? `dsp ${dsp} > dst ${dst}` : null;
    if (why) bad.push(`${s.name}@${r.frame} ${r.cls}: ${why}`);
  }
  return bad;
}
/** The per-body read-event buffer's size (ringcount.mjs evAdd / EV.slice): a body that fills it has TRUNCATED events. Only a C0 (forced-blank redraw: a whole screen's blocks are read; exempt from the gate, never priced by the bound) may. */
export const EVENT_CAP = 64;
/**
 * Specs whose two emulator runs are DECLARED not to stay in lockstep, with the measured reason. Their bodies are still held to every per-body sanity rule (relationships, class/state,
 * required evidence) in each emulator separately; only the one-to-one equality is replaced by the prefix + content-signature report below. A permutation or a deleted counter cannot hide
 * here: the sanity rules read the events, which are independent of the counters.
 */
export const DIVERGENT_SPECS = {
  chase: 'the damaging-chaser pursuit leaves lockstep at the first contact body in the two cores (cause not isolated: both cores boot to the same zeroed RAM, the input schedule is identical and only the knockback bodies diverge); each core is internally deterministic'
};
// Round 3 (review 2 finding 4, Chris's option A): a phase of a DIVERGENT spec that really leaves lockstep (a body differing in anything but `dsp`, which agree:dsp judges apart) is NOT accepted as agreement: it is excluded from
// `agree:bodies` and reported by the item `agree:chase`, whose status is UNCERTIFIED -- the cross-check of the knockback/chase counters is not established for that cell, and a jsnes counter disagreement INSIDE
// such a phase (a C3b draw count 8 against 9, say) is NOT detected. No deterministic witness was built for it. A phase that stays in lockstep is compared exactly like every other.
const phasesOf = (rows) => { const o = new Map(); for (const r of rows) (o.get(r.phase) ?? o.set(r.phase, []).get(r.phase)).push(r); return o; };

/**
 * perSpec[] = { name, mesen: { rows }, jsnes: { rows }, script: [{ name, mode }] }. Rows pair by (spec, phase, ordinal within the phase). A phase whose script entry has a `mode` carries the
 * Mesen template's SYNTHETIC pokes (flash_left, game_state, box_state written by the Lua; jsnes has no such hook): it is reported, not compared. Returns
 * { specs, phases, bodies, compared, synthetic, exact, dsp, divergent[], mismatches[{ at, diffs }], unpaired[], c0Length[], timing }.
 * `ignore` is the counters left out of the acceptance (the triage's DSP_KEYS by default); `predecessor: true` is the PRE-triage rule the as-run judge applied (full comparison, dsp included; see the comment at `leaves`), which only the judge-only successor evaluation (s1bsuccessor.mjs) uses to reconstruct the as-run records.
 */
export function compareBodies(perSpec, { ignore = DSP_KEYS, predecessor = false } = {}) {
  const out = { specs: 0, phases: 0, bodies: 0, compared: 0, synthetic: [], exact: 0, dsp: { compared: 0, differ: 0, bodies: [], plain: [], maxAbs: 0 }, divergent: [], mismatches: [], unpaired: [], c0Length: [], timing: { nmiMaxDelta: 0, gMinusCyc: { min: Infinity, max: -Infinity } } };
  for (const s of perSpec) {
    if (!s.mesen?.rows || !s.jsnes?.rows) continue;
    out.specs++;
    const synth = new Set((s.script ?? []).filter((p) => p.mode).map((p) => p.name));
    const M = phasesOf(s.mesen.rows), J = phasesOf(s.jsnes.rows);
    for (const ph of new Set([...M.keys(), ...J.keys()])) {
      out.phases++;
      const a = M.get(ph) ?? [], b = J.get(ph) ?? [];
      // a forced-blank redraw (C0) lasts however many vblanks its draw needs, and the two cores' timing models can differ by WHOLE FRAMES on it (measured: 539,763 vs 569,544 cycles, one frame): the
      // phase then ends one body earlier or later in one core. That, and only that, excuses a length difference: each frame of it must be accounted for by a C0 pair's whole-frame duration difference.
      const c0Frames = a.reduce((t, m, i) => (m.cls === 'C0' && b[i]?.cls === 'C0' && Number.isFinite(m.G) && Number.isFinite(b[i].cyc) ? t + Math.round(Math.abs(m.G - b[i].cyc) / 29780) : t), 0);
      if (a.length !== b.length && Math.abs(a.length - b.length) > c0Frames) out.unpaired.push(`${s.name}/${ph}: ${a.length} Mesen bodies, ${b.length} jsnes bodies`);
      else if (a.length !== b.length) out.c0Length.push(`${s.name}/${ph}: ${a.length} Mesen / ${b.length} jsnes bodies, a C0 body differing by ${c0Frames} whole frame(s)`);
      if (synth.has(ph)) { out.synthetic.push(`${s.name}/${ph} (${a.length} bodies)`); continue; }
      const bad = [], phaseDsp = [];
      let prefix = -1;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        out.bodies++; out.compared++;
        const diffs = compareBody(a[i], b[i], { ignore: predecessor ? [] : ignore });
        // the uncertified dsp comparison: every body whose dsp differs is an OBSERVATION (it never enters `diffs`, `bad`, the pairing or the timing statistics)
        out.dsp.compared++;
        { const dm = a[i].counters.dsp ?? 0, dj = b[i].counters.dsp ?? 0; if (dm !== dj) { out.dsp.differ++; out.dsp.maxAbs = Math.max(out.dsp.maxAbs, Math.abs(dm - dj)); out.dsp.bodies.push(`${s.name}/${ph}#${i}: dsp ${dm}/${dj}`); phaseDsp.push({ at: `${s.name}/${ph}#${i}: dsp ${dm}/${dj}`, only: predecessor ? diffs.every((d) => d.startsWith('dsp ')) : !diffs.length }); } }
        if (!diffs.length) out.timing.nmiMaxDelta = Math.max(out.timing.nmiMaxDelta, Math.abs((a[i].counters.nmiT ?? 0) - (b[i].counters.nmiT ?? 0)));
        if (Number.isFinite(a[i].G) && Number.isFinite(b[i].cyc) && !diffs.length) { out.timing.gMinusCyc.min = Math.min(out.timing.gMinusCyc.min, a[i].G - b[i].cyc); out.timing.gMinusCyc.max = Math.max(out.timing.gMinusCyc.max, a[i].G - b[i].cyc); }
        if (diffs.length) { bad.push({ at: `${s.name}/${ph}#${i}`, diffs }); if (prefix < 0) prefix = i; }
      }
      // the PRE-triage rule (predecessor): inside a declared-divergent spec only a body differing in something OTHER than dsp makes the phase divergent; a phase whose every difference is dsp is an ordinary mismatch
      const leaves = s.name in DIVERGENT_SPECS && (!predecessor || bad.some((x) => x.diffs.some((d) => !d.startsWith('dsp '))));
      out.dsp.plain.push(...phaseDsp.filter((x) => x.only).map((x) => x.at));
      if (!bad.length) { out.exact++; continue; }
      if (leaves) out.divergent.push({ spec: s.name, phase: ph, bodies: a.length, differ: bad.length, agreeingPrefix: prefix, first: bad[0].diffs.slice(0, 3).join(', ') });
      else out.mismatches.push(...bad);
    }
  }
  return out;
}

const sig = (r) => JSON.stringify([r.cls, Object.entries(r.counters).filter(([k]) => k !== 'nmiT').sort(), r.events ?? []]);
/**
 * Corresponding bodies of the two emulators: [{ spec, phase, cls, m: mesenRow, j: jsnesRow | null, how }]. Equal-ordinal pairs that are EXACTLY equal (the acceptance rule of compareBodies; nothing is skew-tolerated any more) are 'ordinal'; in a divergent
 * spec each Mesen body takes the first unused jsnes body of its phase with the identical path signature ('signature'); a Mesen body in a synthetic-poke phase or with no counterpart has
 * j = null ('none': the bound then keeps its projection and entity-draw cycles inside the remainder, a conservative double count -- s1bbound.bodyTerms).
 */
export function pairBodies(perSpec) {
  const out = [];
  for (const s of perSpec) {
    if (!s.mesen?.rows) continue;
    const synth = new Set((s.script ?? []).filter((p) => p.mode).map((p) => p.name));
    const M = phasesOf(s.mesen.rows), J = phasesOf(s.jsnes?.rows ?? []);
    for (const [ph, a] of M) {
      const b = J.get(ph) ?? [];
      const used = new Set();
      a.forEach((m, i) => {
        let j = null, how = 'none';
        // FULL equality, `dsp` included (triage ruling): an uncertified comparison supplies no new pairing permission, so a body that differs even in `dsp` has no counterpart here and is bounded as itself
        if (!synth.has(ph) && b[i] && !compareBody(m, b[i]).length) { j = b[i]; how = 'ordinal'; used.add(i); }
        else if (!synth.has(ph) && s.name in DIVERGENT_SPECS) { const k = b.findIndex((x, ix) => !used.has(ix) && sig(x) === sig(m)); if (k >= 0) { j = b[k]; how = 'signature'; used.add(k); } }
        out.push({ spec: s.name, phase: ph, cls: m.cls, m, j, how });
      });
    }
  }
  return out;
}

/** The arithmetic of the executed transactions of ONE body (see the header). `mapper` = the cell's mapper number (1, 4, 30). Returns the violated relationships. */
export function relationships(row, mapper) {
  const c = row.counters, ev = parseEvents(row);
  const n = (k) => ev.filter((e) => e.k === k).length;
  const bad = [];
  // a body that fills the event buffer holds a TRUNCATED list: legal only for a C0 (a forced-blank redraw reads a whole screen), and then the events can only be bounded by the counters, not equal them
  const capped = ev.length >= EVENT_CAP;
  if (capped && row.cls !== 'C0') bad.push(`the read-event buffer is full (${EVENT_CAP}) in a ${row.cls} body: its reads are not all priced`);
  const cmpr = (k, cnt, what) => { if (capped ? n(k) > cnt : n(k) !== cnt) bad.push(`${n(k)} ${what} read events, counter ${cnt}${capped ? ' (buffer full: events may only be FEWER)' : ''}`); };
  cmpr('g', c.goto ?? 0, 'sw_goto'); cmpr('l', c.loc ?? 0, 'sw_locate_current'); cmpr('p', c.peek ?? 0, 'sw_peek_byte');
  const sumD = ev.filter((e) => e.k === 'p').reduce((s, e) => s + e.d, 0);
  if (capped ? sumD > (c.pkc ?? 0) : sumD !== (c.pkc ?? 0)) bad.push(`peek prices sum ${sumD}, pkc ${c.pkc ?? 0}`);
  const maxD = ev.filter((e) => e.k === 'p').reduce((m, e) => Math.max(m, e.d), 0);
  if (capped ? maxD > (c.pkx ?? 0) : maxD !== (c.pkx ?? 0)) bad.push(`dearest peek ${maxD}, pkx ${c.pkx ?? 0}`);
  const k = WRITES_PER_SWITCH[mapper];
  if (k === undefined) bad.push(`no register-writes-per-switch figure for mapper ${mapper}`);
  else {
    // every sw_goto and every sw_locate_current ends in one switch_prg_bank; the body's other switches (screen draws, battle) enter it too: the counter may exceed, never fall below
    if ((c.bank ?? 0) < (c.goto ?? 0) + (c.loc ?? 0)) bad.push(`switch_prg_bank entered ${c.bank ?? 0}x, fewer than goto + loc = ${(c.goto ?? 0) + (c.loc ?? 0)}`);
    // every PRG switch makes K writes; a forced-blank screen draw (C0) also selects the tileset's CHR bank and, on MMC3, disables the scanline counter: REDRAW_WRITES per redraw (whole multiples, never fewer than the PRG switches')
    const extra = (c.mwm ?? 0) - k * (c.bank ?? 0);
    const rw = REDRAW_WRITES[mapper];
    // the writes beyond the PRG switches are a whole number of forced-blank redraws (C0 only) plus the scanline-IRQ handlers the body took: each is IRQ_WRITES[0]..[1], and the irq counter must say how many
    const irq = c.irq ?? 0, [iLo, iHi] = IRQ_WRITES[mapper] ?? [0, 0];
    let ok = false;
    for (let r = 0; r * rw <= extra && (row.cls === 'C0' || r === 0); r++) if (irqWritesReachable(extra - r * rw, irq, mapper)) ok = true;
    if (!ok) bad.push(`${c.mwm ?? 0} mainline mapper writes, ${k} per switch x ${c.bank ?? 0} switches = ${k * (c.bank ?? 0)}${row.cls === 'C0' ? ` (+ whole redraws of ${rw} writes each)` : ''}${IRQ_WRITES[mapper] ? ` (+ ${iLo} or ${iHi} per scanline IRQ, ${irq} taken: only 3a + 6b with a + b = ${irq} is reachable)` : ''}`);
  }
  return bad;
}

/** Every body of every spec, one emulator: the violated relationships, by body. */
export function relationshipFailures(perSpec, emu, mapper) {
  const out = [];
  for (const s of perSpec) for (const r of s[emu]?.rows ?? []) { const b = relationships(r, mapper); if (b.length) out.push({ at: `${s.name}/${r.phase}@${r.frame}`, cls: r.cls, bad: b }); }
  return out;
}

/** The evidence a cell's record must hold at all: reads were priced, restored, switched and written. A zero is a dead counter, never a quiet body. */
export function requiredEvidence(perSpec, emu) {
  const rows = perSpec.flatMap((s) => s[emu]?.rows ?? []);
  const sum = (f) => rows.reduce((t, r) => t + f(r), 0);
  const ev = (k) => sum((r) => parseEvents(r).filter((e) => e.k === k).length);
  const need = { loc: sum((r) => r.counters.loc ?? 0), bank: sum((r) => r.counters.bank ?? 0), mwm: sum((r) => r.counters.mwm ?? 0), peek: sum((r) => r.counters.peek ?? 0), goto: sum((r) => r.counters.goto ?? 0), pkx: sum((r) => r.counters.pkx ?? 0), 'p-events': ev('p'), 'g-events': ev('g'), 'l-events': ev('l'), nmiT: sum((r) => r.counters.nmiT ?? 0) };
  return { need, missing: Object.entries(need).filter(([, v]) => !(v > 0)).map(([k]) => k) };
}

/** Class vs the independently read game state (Mesen reads game_state at the body's end; jsnes at its end). */
export function classInvariants(perSpec, emu) {
  const out = [];
  const walking = new Set(['C1', 'C2', 'C3a', 'C3b', 'C3s', 'C1s']);
  for (const s of perSpec) for (const r of s[emu]?.rows ?? []) {
    if (r.cls === 'C0') continue;
    const frozen = !walking.has(r.cls);
    if (frozen && r.gs === 0 && !['C4b', 'C4c', 'C4bw'].includes(r.cls)) out.push(`${s.name}/${r.phase}@${r.frame}: ${r.cls} with game_state 0`);
    if (!frozen && r.gs !== 0) out.push(`${s.name}/${r.phase}@${r.frame}: ${r.cls} (a walking class) with game_state ${r.gs}`);
  }
  return out;
}
