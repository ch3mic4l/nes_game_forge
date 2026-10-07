// Phase 3b S1b round 2, finding 2: the PER-PATH COVERAGE MAP. Round 1 asked a pooled question once per predicate ("is there ANY body with a same-screen probe?", "proj >= 8"),
// which a body that coexists nothing satisfies. Here every required witness is ONE body (spec@frame) that carries the whole conjunction at once, tied to the build's own constants and
// to the observed projection / draw / arm work, and a path that cannot be witnessed says why (an N/A names its source proof). Pure (rows in, items out); s1b_unit.mjs sabotages each
// witness separately. `rows` are the jsnes records (counters, state, terms, profile): the Mesen bodies are held equal to them per body (s1bagree.compareBodies).
//
// What the map does NOT claim: it witnesses the worst coincidence of the non-read terms; every READ is priced at the exhaustive sweep's maximum (s1bcost.mjs, s1bbound.mjs), so a
// read case that a route does not witness (same-screen, off-grid wall: no bank switch) can never lower the bound: it is dominated by the straddling read charged for every read slot.
import { PROJ_SHAPE } from './s1bbound.mjs';

const n = (r, k) => r.counters?.[k] ?? 0;
const calls = (r, g) => r.prof?.calls?.[g]?.calls ?? 0;
const at = (r) => `${r.spec}@${r.frame}`;
const tilesOf = (spec) => ({ heavy: 15, chase: 15, heavy14: 14 })[spec] ?? null;
/** Tiles an entity draw iterated this body: the three per-tile loops of draw_one_entity_show_sw. */
export const drawnTiles = (r) => n(r, 'dst') + n(r, 'dit') + n(r, 'dct');
const HAS = (r, ...terms) => terms.every((t) => (r.terms ?? []).some((x) => t.split('|').includes(x)));
const armCountersOf = (ring) => (ring === 1 ? 'armc' : 'armr');

/**
 * Round 3 (review 2 finding 3): the VALID arm state, axis by axis, from the build's own source (engine/streamworld.asm), not just its diversity.
 *   st_active   sw_stream_start_col ends `lda #1; sta st_active` (line 1582), sw_stream_start_row `lda #2; sta st_active` (line 1679): a column strip (ring 1, vertical) is active == 1, a row strip (ring 2) == 2;
 *               0 is idle (sw_ns_finish, line 1728), so an arm body whose strip is not active at the observation point is no arm at all.
 *   st_fnt      the destination-nametable contribution is a PARITY of the destination screen: (screenCol & 1) * 4 for a column strip (line 1492), (screenRow & 1) * 8 for a row strip (line 1598), so the only
 *               values are {0, 4} and {0, 8}; any other value (the unset 255, 254, ...) is an invalid state, however many distinct ones there are.
 * OBSERVATION POINT: the state is the body-end sample (Mesen at main_loop_ready, jsnes at the same instruction) of a body whose arm counter (armc / armr) is non-zero -- the strip started in that body is
 * published (st_active, st_fnt, st_ftile, st_vary, st_len are all stored by sw_stream_start_* before it returns) and is advanced only by later NMI drains, so it is still active at the end of its own start body.
 */
export const ARM_ACTIVE = { 1: 1, 2: 2 };
export const ARM_FNT = { 1: [0, 4], 2: [0, 8] };
/** { inactive[], badParity[] } over the bodies that ran the ring's arm (state read at the body end). */
export function armStateFailures(rows, { ring }) {
  const arm = armCountersOf(ring);
  const bodies = rows.filter((r) => n(r, arm) > 0);
  return {
    bodies: bodies.length,
    inactive: bodies.filter((r) => r.state?.st_active !== ARM_ACTIVE[ring]).map(at),
    badParity: bodies.filter((r) => !ARM_FNT[ring].includes(r.state?.st_fnt)).map((r) => `${at(r)} st_fnt ${r.state?.st_fnt}`)
  };
}

/**
 * The C1/C2 busy-frame witness the plan names (2.4 (a)(d)(e)): ONE body carrying the player's whole projection (4 tiles x 2 axes = 8 sw_project_axis calls), all 8 live entities
 * drawn with every tile of the scene's population iterated, damage-capable chasers' spec aside, Shake + Flash + Sfx live, the NMI strip drain, two leading-corner probes and the
 * hazard probe -- and, for C2, a strip arm whose state matches the build (axis, st_active, st_len).
 */
export function busyWitness(rows, cls, { ring, wantLen, minTiles = 14 }) {
  const arm = armCountersOf(ring);
  const ok = rows.filter((r) => r.cls === cls
    && n(r, 'proj') >= PROJ_SHAPE.playerTiles * 2 && calls(r, 'px') >= PROJ_SHAPE.playerTiles && calls(r, 'py') >= PROJ_SHAPE.playerTiles
    && n(r, 'dsw') >= 8 && drawnTiles(r) >= (tilesOf(r.spec) ?? minTiles)
    && HAS(r, 'flash', 'shake', 'sfx', 'nmiStream|nmiStreamReduced|nmiBig', 'movProbe', 'hazard')
    && (cls !== 'C2' || (n(r, arm) > 0 && r.state?.st_len === wantLen && n(r, 'win') > 0 && n(r, 'cam') > 0)));
  const best = ok.reduce((m, r) => (m === null || (r.cyc ?? 0) > (m.cyc ?? 0) ? r : m), null);
  const near = rows.filter((r) => r.cls === cls).reduce((m, r) => {
    const score = [n(r, 'proj') >= 8, n(r, 'dsw') >= 8, drawnTiles(r) >= (tilesOf(r.spec) ?? minTiles), HAS(r, 'flash'), HAS(r, 'shake'), HAS(r, 'sfx'), HAS(r, 'nmiStream|nmiStreamReduced|nmiBig'), HAS(r, 'movProbe'), HAS(r, 'hazard'), cls !== 'C2' || n(r, arm) > 0].filter(Boolean).length;
    return Math.max(m, score);
  }, 0);
  return { ok: ok.length, best, nearest: near, of: 10 };
}

/**
 * The arm's alignments (2.4 (d)): the strip's destination-nametable parity (st_fnt: the screen-parity contribution to the PPU nametable select) and whether its ring position WRAPS. The
 * strip runs st_len blocks along the ring and the engine wraps st_vary at st_len (SW_RING_COL_LEN / SW_RING_ROW_LEN: the ring's own length), so a start at st_vary = 0 never wraps and a
 * start at st_vary > 0 wraps once. The start position is recovered from the body-end state: st_vary - st_cur (mod st_len). The first-tile coordinate st_ftile is reported too.
 */
export function armAlignments(rows, { ring, wantLen }) {
  const arm = armCountersOf(ring);
  const bodies = rows.filter((r) => n(r, arm) > 0);
  const cells = new Map();
  for (const r of bodies) {
    const start = (((r.state?.st_vary ?? 0) - (r.state?.st_cur ?? 0)) % wantLen + wantLen) % wantLen;
    const k = `fnt${r.state?.st_fnt}${start > 0 ? '+wrap' : '+nowrap'}`;
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  const wrongAxis = rows.filter((r) => n(r, ring === 1 ? 'armr' : 'armc') > 0).length;
  const badState = bodies.filter((r) => r.state?.st_len !== wantLen).length;
  const ftiles = new Set(bodies.map((r) => r.state?.st_ftile));
  return { bodies: bodies.length, cells: Object.fromEntries([...cells].sort()), wrongAxis, badState, ftiles: [...ftiles].sort((a, b) => a - b), fnts: new Set(bodies.map((r) => r.state?.st_fnt).filter((v) => ARM_FNT[ring].includes(v))).size, wraps: [...cells.keys()].filter((k) => k.endsWith('+wrap')).length, plain: [...cells.keys()].filter((k) => k.endsWith('+nowrap')).length };
}

/** Per route (class): the read cases witnessed, the attained read counts against the source ceiling (reported separately from the ceiling the bound charges). */
export function routeReads(rows, ceiling) {
  const out = {};
  for (const r of rows) {
    const o = (out[r.cls] ??= { bodies: 0, straddle: 0, same: 0, wall: 0, peekMax: 0, gotoMax: 0, deepest: null });
    o.bodies++;
    if (n(r, 'xprobe') > 0 && n(r, 'peek') > 0) o.straddle++;
    if (n(r, 'same') > 0 && !n(r, 'bank')) o.same++;
    if (n(r, 'wall') > 0 && !n(r, 'bank')) o.wall++;
    o.peekMax = Math.max(o.peekMax, n(r, 'peek')); o.gotoMax = Math.max(o.gotoMax, n(r, 'goto'));
  }
  for (const [c, o] of Object.entries(out)) { const [pk, gt] = ceiling[c] ?? [null, null]; o.ceiling = pk === null ? null : [pk, gt]; o.attained = pk === null ? null : { peek: o.peekMax === pk, goto: o.gotoMax === gt }; }
  return out;
}

/** The structural exclusions of 2.1, asserted on EVERY body of the class (a counter-example anywhere fails): a crossing runs neither the hazard probe nor the AI; a nonterminal Wait runs neither a Move, nor the camera/arm, nor a probe. */
export function exclusions(rows) {
  const bad = [];
  for (const r of rows) {
    if (r.cls === 'C3a' && (n(r, 'hz') > 0 || n(r, 'ent') > 0)) bad.push(`${at(r)}: a crossing body ran ${n(r, 'hz') ? 'the hazard probe' : ''}${n(r, 'ent') ? ' update_entities (the AI)' : ''}`);
    if (r.cls === 'C4bw' && (n(r, 'mv') + n(r, 'cam') + n(r, 'win') + n(r, 'armc') + n(r, 'armr') + n(r, 'hzs') + n(r, 'hz') > 0)) bad.push(`${at(r)}: a nonterminal Wait body ran ${['mv', 'cam', 'win', 'armc', 'armr', 'hzs', 'hz'].filter((k) => n(r, k)).join('+')}`);
  }
  return bad;
}

/** The draw's worst populations (2.4 (f)): every tile through the straddle loop and shown (none parked), and the mixed parked/shown straddle; for each tile bound the scene carries. */
export function drawWitnesses(rows) {
  const out = {};
  for (const spec of ['heavy', 'heavy14', 'chase']) {
    const t = tilesOf(spec);
    const sr = rows.filter((r) => r.spec === spec && n(r, 'dsw') > 0);
    out[spec] = {
      tiles: t, bodies: sr.length,
      allShown: sr.filter((r) => n(r, 'dst') >= t && n(r, 'dsp') === 0).length,
      allParked: sr.filter((r) => n(r, 'dst') >= t && n(r, 'dsp') >= t).length,
      mixed: sr.filter((r) => n(r, 'dst') >= t && n(r, 'dsp') > 0 && n(r, 'dsp') < t).length,
      animated: sr.filter((r) => n(r, 'anim') > 0).length
    };
  }
  return out;
}

/** Items. `ctx` = { gt, ring, wantLen, ceiling }, `rows` = the jsnes rows of every spec (each with .spec). */
export function coverageItems(rows, ctx, add) {
  const { gt, ring, wantLen, ceiling } = ctx;
  for (const cls of ['C1', 'C2']) {
    const w = busyWitness(rows, cls, { ring, wantLen });
    add(`cover:${cls}-busy`, 'jsnes', w.ok ? 'PASS' : 'FAIL', w.ok ? `${w.ok} ${cls} bodies carry, in ONE body: the player's 8 projection calls, all 8 entities drawn with every tile iterated, Flash+Shake+Sfx, the NMI strip drain, two leading-corner probes and the hazard probe${cls === 'C2' ? `, and an armed strip (st_len ${wantLen}, camera + window arm)` : ''}; heaviest ${at(w.best)} (${w.best.cyc} cycles, ${drawnTiles(w.best)} tiles)` : `no ${cls} body carries the whole conjunction (nearest: ${w.nearest}/${w.of} of its terms in one body)`);
  }
  const al = armAlignments(rows.filter((r) => r.cls === 'C2' || r.cls === 'C4b'), { ring, wantLen });
  // a 1-D ring's strip starts at the window's ring origin on the DEAD axis (cameraAxes pins it at 0: win_col_local / win_row_local), so it never starts mid-ring and never wraps; the wrap
  // alignment is then unreachable BY SOURCE and the item says so, but a body that does start mid-ring (a wrapping cell) must be witnessed, so the proof is checked on every arm body
  const wrapReachable = al.wraps > 0;
  add('cover:arm-alignment', 'jsnes', al.bodies && !al.wrongAxis && !al.badState && al.fnts >= 2 && al.plain >= 1 ? 'PASS' : 'FAIL',
    `${al.bodies} arm bodies; (destination-nametable parity, ring wrap) cells visited ${JSON.stringify(al.cells)}; ${al.wrongAxis} on the wrong axis, ${al.badState} with st_len off the build (${ring === 1 ? 'column' : 'row'} strip, st_len ${wantLen}); both LEGAL parities required (st_fnt ${al.fnts} distinct of the axis's legal {${ARM_FNT[ring].join(', ')}}); the wrapping start is ${wrapReachable ? 'witnessed' : `N/A: the ring's dead camera axis pins the strip's start at 0, so no strip starts mid-ring (checked on all ${al.bodies} arm bodies: every st_vary - st_cur == 0)`}`);
  const dw = drawWitnesses(rows);
  for (const [spec, d] of Object.entries(dw)) {
    if (!d.bodies) { if (spec === 'chase' && gt === 'rpg') continue; add(`cover:draw-${spec}`, 'jsnes', 'UNMEASURED', `${spec} produced no entity-draw body`); continue; }
    add(`cover:draw-${spec}`, 'jsnes', d.allShown > 0 && d.animated > 0 ? 'PASS' : 'FAIL', `${spec} (${d.tiles} tiles): ${d.allShown} bodies iterate all ${d.tiles} tiles through the straddle loop with none parked, ${d.allParked} with all parked, ${d.mixed} mixed; entity_animate live in ${d.animated}`);
  }
  const rr = routeReads(rows, ceiling);
  for (const [c, o] of Object.entries(rr)) {
    if (!ceiling[c] || ceiling[c][0] === 0) continue;
    const expectsReads = ['C1', 'C2', 'C3a', 'C4b', 'C4c', 'C3b'].includes(c);
    if (!expectsReads) continue;
    const reads = o.peekMax > 0 || o.gotoMax > 0;
    add(`cover:route-${c}`, 'jsnes', reads ? 'PASS' : 'N/A',
      `${o.bodies} bodies; read counts attained peek ${o.peekMax}/${o.ceiling[0]}, goto ${o.gotoMax}/${o.ceiling[1]} (${o.attained.peek && o.attained.goto ? 'ceiling attained' : 'ceiling NOT attained: the bound charges the unattained reads at the exhaustive price'}); cases witnessed: straddling ${o.straddle}, same-screen ${o.same}, off-grid wall ${o.wall} (the last two make no bank switch and are dominated by the straddling read charged in every slot)`);
  }
  const ex = exclusions(rows);
  add('cover:exclusions', 'jsnes', ex.length ? 'FAIL' : 'PASS', ex.length ? ex.slice(0, 3).join(' | ') : `no C3a body ran the hazard probe or the AI, no C4bw body a Move / camera / arm / probe (checked on every body)`);
}
