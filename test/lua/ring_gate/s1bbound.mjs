// Phase 3b S1b round 2, finding 1: the BOUND, as per-path arithmetic. Pure (rows, sweeps in; numbers out) so s1b_unit.mjs can feed it synthetic rows.
//
//   G(body) = NMI + reads + projection + remainder        (every term a MEASURED quantity of that body: nmiT and the read events from Mesen, the projection from jsnes' profile)
//
//   estimate(class) = max nmiT over the cell's bodies                                [SAMPLED, reported against plan 2.2's 2,167]
//                + max remainder over EVERY body of the class (not the max-G body)  [SAMPLED]
//                + the class's read ceiling x the dearest read of the cell           [source-counted x EXHAUSTIVE price: s1bcost.mjs sweeps every (current, target) pair]
//                + passes(class) x the player's per-pass projection ceiling          [source pass count x exhaustive per-routine maxima x 4 tiles]
//                + passes(class) x the dearest entity-draw PASS of the cell          [source pass count x SAMPLED per-pass maximum]
//
// ROUND 3 (Chris's option A, review 2 finding 1): the remainder, the per-pass entity draw and the releasing NMI are SAMPLED maxima, so this sum is a composed ESTIMATE, never a proof. The judge reports it
// as `UNCERTIFIED` (s1bjudge.mjs) -- never PASS, and over the gate it FAILS, because an estimate that does not fit is evidence worth refusing -- and no report may call its distance from the gate certified slack.
// The reads and the player projection are the only terms with an exhaustive/source basis; the MEASURED Mesen G of every class keeps its own PASS/FAIL gate verdict (a measurement, not an estimate).
//
// PASSES PER CLASS (round 3, finding 2): round 2 charged ONE projection pass and a two-pass draw maximum to every class, which UNDER-charged the two-pass class (a C4a body with G 18,124 bounded at 16,672). The
// OAM composition (`build_oam` = the player's 4 tiles x (sw_oam_project_x + _y), then `draw_entities`) runs once per iteration in main_loop_draw (engine/boot.asm `main_loop_draw`, `jsr build_oam` /
// `jsr draw_entities`), and a SECOND time in exactly two places reachable in a non-forced-blank iteration: sw_dlg_lifecycle_open (engine/streamdialog.asm, the `jsr build_oam` / `jsr draw_entities` after
// sw_dlg_origin_capture, in the dialogue-open step) or sw_dlg_lifecycle_close_b (the same pair, in the camera release that main_loop_idle polls every iteration through sw_dlg17_camrelease). The two are never
// in one iteration (close_b needs sw_dlg15_state == SW_DLG15_DRAINING, which only text_close_attr_tail enters, long after the open step). A walking class needs game_state == ST_GAMEPLAY at the top of the
// iteration (engine/boot.asm `lda <game_state; bne main_loop_ui`), but DRAINING exists only while a dialogue's game_state is still ST_DIALOG: close_ui (engine/ui.asm, `lda #ST_GAMEPLAY; sta <game_state`)
// runs AFTER close_b inside sw_dlg17_camrelease (engine/streamworld.asm, `jmp close_ui` / `jmp sw_dlg_closeformove_check`). So only the frozen classes (C4a, C4b, C4bw, C4c) can run two passes; a walking class runs
// one; a battle (CB) owns the shadow and runs none (main_loop_draw's `beq main_loop_ready` under ST_BATTLE). Every other build_oam/draw_entities call site is a forced-blank redraw (C0, exempt:
// sw_position_jump_guard, the redraw/title/boot paths) or SAVE_FLASH's sw_save_resync (a forced-blank commit; a body that is not C0 on its observed evidence would be class Cx and fail `class:none-unclassified`).
export const PASS_CEILING = { C1: 1, C1s: 1, C2: 1, C3a: 1, C3b: 1, C3s: 1, CB: 0, C4a: 2, C4b: 2, C4bw: 2, C4c: 2 };
/** The terms of the estimate that are sampled maxima (what makes it uncertified), named in every verdict and report. */
export const SAMPLED_TERMS = ['sampled remainder', 'sampled entity draw', 'sampled NMI'];
export const UNCERTIFIED_LABEL = `estimate (uncertified: ${SAMPLED_TERMS.join(', ')})`;
//
// A read is priced at ITS OWN full call cost (JSR and RTS included) in the table of the layout it ran on; "attainable" prices use ring-adjacent (current, target) pairs (a probe or an
// arm reads the current screen's neighbour, wrapping at the seam -- every observed read is asserted adjacent below, so a counter-example to the argument fails the gate);
// "source" prices use every pair and are reported separately as the unattained combination.
export const PROJ_PLAN = { perCall: 67, calls: 18, total: 1206 };
/** HEAD's player draw (build_oam_draw_sw) projects each of its 4 tiles through sw_oam_project_x and _y (each ends in sw_project_axis); the entities do NOT: draw_entities takes one per-frame origin
 *  (sw_ent_setup, one sw_oam_rowbase) and each entity then takes the cull / in-window / straddle path of draw_one_entity_show_sw with no sw_project_axis call. The per-call figure is 67 (plan 2.2) at the leaf. */
export const PROJ_SHAPE = { playerTiles: 4 };
export const PROJ_GROUPS = ['px', 'py'];
/** The player's projection ceiling: the exhaustive per-routine maxima (s1bcost.sweepProjection, JSR+RTS included) times the source call count. */
export const projCeiling = (sweep) => PROJ_SHAPE.playerTiles * (sweep.sw_oam_project_x.max + sweep.sw_oam_project_y.max);
const gsum = (j, g) => (j?.prof?.[g] ?? 0) + 6 * (j?.prof?.calls?.[g]?.calls ?? 0);
export const projOfRow = (j) => PROJ_GROUPS.reduce((s, g) => s + gsum(j, g), 0);
export const NMI_PLAN = 2167;
export const parseEvents = (row) => (row.events ?? []).map((e) => { const [k, A, X, d, cc, cr] = e.split(':'); return { k, A: +A, X: +X, d: +d, cc: +cc, cr: +cr }; });

/**
 * Splits a body's read events into the transactions the engine made. A `p` (sw_peek_byte) event is preceded by the `g` and `l` of the calls it wraps (events are emitted at
 * the routine's final RTS, innermost first); the other g/l events are standalone (the strip arm's goto and its restore). Cost of a call = d + 12 (its JSR and RTS).
 */
export function readsOfRow(row) {
  const ev = parseEvents(row);
  const used = new Set();
  let nestingErrors = 0;
  const peeks = [];
  ev.forEach((e, i) => {
    if (e.k !== 'p') return;
    let gi = -1, li = -1;
    for (let j = i - 1; j >= 0 && (gi < 0 || li < 0); j--) { if (used.has(j)) continue; if (ev[j].k === 'g' && gi < 0) gi = j; else if (ev[j].k === 'l' && li < 0) li = j; }
    if (gi < 0 || li < 0) { nestingErrors++; return; }
    used.add(gi); used.add(li); used.add(i);
    peeks.push({ i, g: gi, l: li, cost: e.d + 12 });
  });
  const standalone = ev.map((e, i) => ({ ...e, i })).filter((e) => !used.has(e.i));
  const gotos = standalone.filter((e) => e.k === 'g'), locs = standalone.filter((e) => e.k === 'l');
  const total = peeks.reduce((s, p) => s + p.cost, 0) + [...gotos, ...locs].reduce((s, e) => s + e.d + 12, 0);
  return { ev, peeks, gotos, locs, total, nestingErrors };
}

const axisIndex = (ring, col, row) => (ring === 1 ? col : row);
/**
 * Every observed read event against the exhaustive sweep of the layout it ran on: the full call cost must lie in the sweep's [cheapest, dearest] cell for (current, target) over the mapper-state variants (one point on every board but UNROM 512) -- peek within [Y=0, Y=255]
 * -- and the pair must be ring-adjacent. Returns { checked, mismatches[], nonAdjacent[], outOfDomain[] }.
 */
export function checkEventPrices(rows, sweep) {
  const { n, ring } = sweep;
  const out = { checked: { g: 0, l: 0, p: 0 }, mismatches: [], nonAdjacent: [], outOfDomain: [] };
  for (const r of rows) {
    for (const e of parseEvents(r)) {
      const t = axisIndex(ring, e.A, e.X), c = e.k === 'l' ? t : axisIndex(ring, e.cc, e.cr);
      const cost = e.d + 12;
      const where = `${r.phase}@${r.frame} ${e.k}:${e.A}:${e.X}${e.k === 'l' ? '' : ` cur ${e.cc}:${e.cr}`}`;
      if (e.k === 'l') {
        // sw_locate_current's registers at entry are not a target; only the current screen decides it
        const cur = axisIndex(ring, e.A, e.X); // an `l` event's two fields are the current screen's col and row, read at its final RTS
        if (!(cur >= 0 && cur < n)) { out.outOfDomain.push(where); continue; }
        out.checked.l++;
        { const hi = sweep.loc[cur * n], lo = sweep.locLo?.[cur * n] ?? hi; if (cost < lo || cost > hi) out.mismatches.push(`${where}: measured ${cost}, sweep [${lo}, ${hi}]`); }
        continue;
      }
      if (!(t >= 0 && t < n && c >= 0 && c < n)) { out.outOfDomain.push(where); continue; }
      out.checked[e.k]++;
      const d = (t - c + n) % n;
      if (!(d === 0 || d === 1 || d === n - 1)) out.nonAdjacent.push(where);
      if (e.k === 'g') { const hi = sweep.goto[c * n + t], lo = sweep.gotoLo?.[c * n + t] ?? hi; if (cost < lo || cost > hi) out.mismatches.push(`${where}: measured ${cost}, sweep [${lo}, ${hi}]`); }
      else if (cost < sweep.peek[c * n + t] || cost > sweep.peekHi[c * n + t]) out.mismatches.push(`${where}: measured ${cost}, sweep [${sweep.peek[c * n + t]}, ${sweep.peekHi[c * n + t]}]`);
    }
  }
  return out;
}

/** The dearest read of a cell over the sweeps of every layout its specs ran on: { peek, goto, loc } for the attainable (adjacent) and the source (all pairs) domains. */
export function cellPrices(sweeps) {
  const mk = (dom) => ({
    peek: Math.max(...sweeps.map((s) => Math.max(s.stats.peek[dom].cycles, s.stats.peekHi[dom].cycles))),
    goto: Math.max(...sweeps.map((s) => s.stats.goto[dom].cycles)),
    loc: Math.max(...sweeps.map((s) => s.stats.loc[dom].cycles))
  });
  return { adj: mk('adj'), all: mk('all') };
}

/**
 * One body's terms: Mesen G and nmiT, the read events' total, the jsnes projection and entity-draw cycles (call cost incl. JSR) of the corresponding body, and the remainder.
 * The groups never overlap: reads sit inside the probes / the arm, the player projection inside build_oam, the entity draw (with its own sw_ent_setup + sw_oam_rowbase) apart.
 */
export function bodyTerms(m, j) {
  const rd = readsOfRow(m);
  // a Mesen body with no jsnes counterpart (a synthetic-poke phase, a divergent body) has no profile: its projection and entity-draw cycles stay inside its own G, and classBounds bounds such a body
  // AS ITSELF (own G + the ceiling reads it did not make) rather than letting it into the decomposed remainder
  const proj = j ? projOfRow(j) : 0;
  const draw = j ? (j.prof?.draw ?? 0) + 6 * (j.prof?.calls?.draw?.calls ?? 0) : 0;
  const nmi = m.counters?.nmiT ?? 0;
  const projCalls = PROJ_GROUPS.reduce((n, g) => n + (j?.prof?.calls?.[g]?.calls ?? 0), 0);
  const drawCalls = j?.prof?.calls?.draw?.calls ?? 0;
  // the OAM passes this body ran: draw_entities calls (one per pass), and the player's projection calls (4 tiles x 2 axes = 8 per pass); the two must tell the same story
  const passes = Math.max(drawCalls, Math.ceil(projCalls / (2 * PROJ_SHAPE.playerTiles)));
  return { G: m.G, nmi, reads: rd.total, proj, draw, projCalls, drawCalls, passes, paired: !!j, rem: m.G - nmi - rd.total - proj - draw, nPeek: rd.peeks.length, nGoto: rd.gotos.length };
}

/**
 * The class bounds of one cell. `pairs` = [{ spec, m: mesenRow, j: jsnesRow, cls }] (corresponding bodies), `ceiling` = READ_CEILING ([peeks, gotos] per class),
 * `prices` = cellPrices(sweeps). Returns { nmiMax, byClass: { cls: { n, maxG, remMax, remAt, projCeil, reads: {adj, all}, bound: {adj, all}, atMaxG } } }.
 */
export function classBounds({ pairs, ceiling, prices, allows, projSweep, passCeiling = PASS_CEILING }) {
  const nmiMax = pairs.reduce((mx, p) => Math.max(mx, p.m.counters?.nmiT ?? 0), 0);
  const byClass = {};
  // the dearest entity-draw PASS of the cell (a body's draw cycles / its draw_entities calls), not a two-pass body charged whole to every class
  let drawPass = { cycles: 0, at: null }, unpaired = 0;
  const readCeil = (cls, dom) => { const [peeks, gotos] = ceiling[cls] ?? [0, 0]; const pr = prices[dom]; return peeks * pr.peek + Math.max(0, gotos - peeks) * (pr.goto + pr.loc); };
  for (const p of pairs) {
    if (p.cls === 'C0' || !Number.isFinite(p.m.G)) continue;
    const t = bodyTerms(p.m, p.j);
    const c = (byClass[p.cls] ??= { n: 0, nPaired: 0, maxG: -1, remMax: -1e9, remAt: null, projSeen: false, drawSeen: false, atMaxG: null, unpairedMax: { cycles: -1, at: null }, passMax: 0, passViolations: [] });
    c.n++;
    if (p.m.G > c.maxG) { c.maxG = p.m.G; c.atMaxG = { spec: p.spec, frame: p.m.frame, ...t }; }
    if (!t.paired) {
      // a Mesen body with no jsnes counterpart (a synthetic-poke phase, a body the two cores do not agree on) cannot be decomposed into its projection / entity-draw terms: it is bounded as ITSELF
      // -- its own measured G (every term of it already inside) plus the reads its class's source ceiling allows and it did not make, at the exhaustive price
      unpaired++;
      const own = readsOfRow(p.m).total;
      const b = p.m.G + Math.max(0, readCeil(p.cls, 'adj') - own);
      if (b > c.unpairedMax.cycles) c.unpairedMax = { cycles: b, at: `${p.spec}@${p.m.frame}`, G: p.m.G, ownReads: own };
      continue;
    }
    c.nPaired++;
    if (t.drawCalls > 0) { const per = Math.ceil(t.draw / t.drawCalls); if (per > drawPass.cycles) drawPass = { cycles: per, at: `${p.spec}@${p.m.frame}`, passes: t.drawCalls }; }
    if (t.rem > c.remMax) { c.remMax = t.rem; c.remAt = { spec: p.spec, frame: p.m.frame, ...t }; }
    if (t.projCalls > 0) c.projSeen = true;
    if (t.draw > 0) c.drawSeen = true;
    c.passMax = Math.max(c.passMax, t.passes);
    // a body that ran more OAM passes than its class's source ceiling is a counter-example to the source argument itself
    if (t.passes > (passCeiling[p.cls] ?? 1)) c.passViolations.push(`${p.spec}@${p.m.frame} ran ${t.passes} OAM passes, the source ceiling of ${p.cls} is ${passCeiling[p.cls] ?? 1}`);
  }
  for (const [cls, c] of Object.entries(byClass)) {
    c.passes = passCeiling[cls] ?? 1;
    c.projPass = projCeiling(projSweep);
    c.projCeil = c.projSeen ? c.passes * c.projPass : 0;
    c.drawCeil = c.drawSeen ? c.passes * drawPass.cycles : 0;
    c.reads = {};
    c.bound = {};
    c.formula = {};
    for (const dom of ['adj', 'all']) {
      c.reads[dom] = readCeil(cls, dom);
      c.formula[dom] = c.nPaired ? nmiMax + c.remMax + c.reads[dom] + c.projCeil + c.drawCeil : 0;
      const ub = c.unpairedMax.cycles >= 0 ? c.unpairedMax.cycles + (dom === 'all' ? readCeil(cls, 'all') - readCeil(cls, 'adj') : 0) : 0;
      c.bound[dom] = Math.max(c.formula[dom], ub);
    }
    // an estimate that is BELOW a G the cell really measured is not an upper bound of anything (round 2's C4a: 16,672 for a body of 18,124): refused, independently of the gate
    c.undercut = c.bound.adj < c.maxG;
    c.ok = allows(c.bound.adj) && !c.undercut && !c.passViolations.length;
    c.okAll = allows(c.bound.all);
  }
  return { nmiMax, drawPass, byClass, unpaired };
}

/** The plan's own figures (docs/design-streamed-worlds.md 2.2 / section 11: UNROM 512 PROVEN row), reconciled against what this cell measured, term by term. */
export const PLAN_22 = { nmi: 2167, probes: 5648, projection: 1206, driver: 563, arm: 7668, busy: 11839, combined: 26953 };
/**
 * The plan-2.2 reconciliation of ONE cell: for every profile group the largest inclusive per-body cycles (call cost, JSR included) over every jsnes body of every spec and the body that holds it,
 * the largest player projection (the px + py groups), the largest NMI (Mesen nmiT), and for each class the max-G Mesen body's own decomposition. The groups NEST (the probes sit inside the
 * driver, the reads inside the probes and the arm), so no row of this table is a summand of another: a figure here is compared with the plan's figure of the same name, never added.
 */
export function reconcile(perSpec) {
  const groups = {};
  const jr = perSpec.flatMap((s) => (s.jsnes?.rows ?? []).map((r) => ({ ...r, spec: s.name })));
  const names = [...new Set(jr.flatMap((r) => Object.keys(r.prof ?? {}).filter((k) => k !== 'calls')))];
  for (const g of names) for (const r of jr) { const c = gsum(r, g); if (!groups[g] || c > groups[g].cycles) groups[g] = { cycles: c, at: `${r.spec}@${r.frame}`, cls: r.cls, calls: r.prof?.calls?.[g]?.calls ?? 0 }; }
  const proj = jr.reduce((m, r) => { const c = projOfRow(r); return c > m.cycles ? { cycles: c, at: `${r.spec}@${r.frame}`, cls: r.cls, calls: PROJ_GROUPS.reduce((n, g) => n + (r.prof?.calls?.[g]?.calls ?? 0), 0) } : m; }, { cycles: 0, at: null, cls: null, calls: 0 });
  const mr = perSpec.flatMap((s) => (s.mesen?.rows ?? []).map((r) => ({ ...r, spec: s.name })));
  const nmi = mr.reduce((m, r) => ((r.counters?.nmiT ?? 0) > m.cycles ? { cycles: r.counters.nmiT, at: `${r.spec}@${r.frame}`, cls: r.cls } : m), { cycles: 0, at: null, cls: null });
  const byClass = {};
  for (const r of mr) { if (r.cls === 'C0' || !Number.isFinite(r.G)) continue; if (!byClass[r.cls] || r.G > byClass[r.cls].G) byClass[r.cls] = { G: r.G, at: `${r.spec}@${r.frame}`, nmiT: r.counters?.nmiT ?? 0, reads: readsOfRow(r).total }; }
  return { groups, proj, nmi, byClass };
}
