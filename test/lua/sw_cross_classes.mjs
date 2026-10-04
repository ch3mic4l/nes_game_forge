// Phase 3a slice S3b: the composition classes of a crossing body and the fail-closed verdict of a cross-stage cell (plan section 4.5, as amended by
// review 2 section 3 and spike review 3 section 2). PURE: it reads the body rows of one run (`bodyRows`) and decides, from marks and state
// transitions seen on the SAME body, which classes that body belongs to. It launches nothing.
//
// A body is one row: the MK line's marks (every exec of a marked routine, `ran`) zipped with its TR line (G, the releasing NMI's recorded queue
// `q`, the strip state going in/out `st0`/`st1`, whether that NMI advanced the strip `stadv`, the queue the body published `pub`, Flash's state).
// `q` is `relVlen` -- the queue at the releasing NMI's entry -- and `pub` the end-of-body publication field; neither is the other.
//
//   crossing      move_tick + spawn_entities + sw_talker_cross                               (the commit of a seam crossing, with S3b's talker hook)
//   vseam         crossing + sw_stream_start_row + (st0 = 0, st1 != 0) + q > 0 + move_finish + the tail's own script_op_*
//   hseam-a       crossing + sw_stream_start_col + q in 1..35 + stadv = 1 + (st0 = 0, st1 != 0) + the PREVIOUS body ended with a strip in flight
//                 (a queue drain, a strip completion in that same releasing NMI, a column arm and the crossing, all on one body)
//   hseam-b       crossing + sw_stream_start_col + a Flash PUBLICATION on that body (flashPublished below)
//   preseam-arm   move_tick + sw_frame_camera_window + sw_stream_start_row + (st0 = 0, st1 != 0), and no crossing: the long Move's last row arm
//   return        a second crossing, back to the column the first left, whose body ran sw_talker_rebind AND resolved the talker's LAST slot (eight
//                 sw_tr_loop steps, no sw_tr_gone): the A -> B -> A live rebind of the last of eight populated slots
//   return-prod   a return body that also carries a producer of its own: a Flash publication, a column arm, a queued publication or a drained queue
//
// THE FLASH-REARM FIX (spike review 3 section 2). The v2 predicate read `flash_left` at BODY HANDOFF (`rfl`) and demanded the publishing
// transition 1 -> 255 there. A Flash continuation (script_op_flash) that runs LATER in the same body re-arms flash_left to 7, so a genuine
// Flash-publication / column-arm / crossing body ends with `pub = 35, fl = 1, rfl = 7` and was rejected (26 saved records). The publishing
// evidence is now captured at the producer itself: the body ran flash_tick AND one of the two calls that actually queue a palette packet
// (flash_apply_on on the arm tick, fade_apply_palette on the restore tick) AND its published queue holds a whole 32-byte palette packet (>= 35
// bytes). A later re-arm cannot erase a mark. `rfl` is no longer read. A drain-only body (flash_tick ran its hold or confirm tick, the packet
// was published on an EARLIER body) has neither apply mark; a body with pub = 0 has no packet: both stay negative.
//
// For rows measured BEFORE the apply marks existed (the spike's preserved traces), `flashPublishedHistorical` is the narrower derived rule the
// review accepted: flash_tick ran, the body started with fl = 1, pub >= 35, and the recipe is a switch-tail one. It is a DERIVED classification,
// not a measured post-tick transition, and the verdict says so (`basis`).
import { PROVENANCE_FIELDS } from './sw_provenance.mjs';

export const GATE = 29780;
export const PACKET_MIN = 35; // one 32-byte palette packet plus its 3-byte header
const MARK_RE = /([A-Za-z_][A-Za-z0-9_]*)@(\d+)/g;
const NOISE = new Set(['NMI', 'RTI']);

/** The ordered body rows of a run's measured phase(s): MK line + TR line per body. Throws on a run whose two streams disagree. */
export function bodyRows(res) {
  const marks = res.marks?.M11 ?? [];
  const trace = res.trace?.M11 ?? [];
  if (marks.length !== trace.length) throw new Error(`the run recorded ${marks.length} mark lines but ${trace.length} trace lines`);
  return marks.map((m, i) => {
    const t = trace[i];
    if (t.f !== m.f) throw new Error(`body ${i}: mark frame ${m.f} != trace frame ${t.f}`);
    const G = Number(/G=(\d+)/.exec(m.line)?.[1]);
    if (!Number.isFinite(G)) throw new Error(`body ${i} (frame ${m.f}): no finite G in its mark line`);
    const all = [...m.line.matchAll(MARK_RE)].map((x) => x[1]).filter((n) => !NOISE.has(n));
    const count = {};
    for (const n of all) count[n] = (count[n] ?? 0) + 1;
    return { ...t, G, ran: [...new Set(all)], count };
  });
}

const has = (r, m) => r.ran.includes(m);
/** How many times a marked routine ran on a body (rows measured before multiplicities were kept have none: 1 per name). */
export const times = (r, m) => r.count?.[m] ?? (has(r, m) ? 1 : 0);
export const MAX_ENTITIES = 8; // engine/constants.asm

/** Whether Flash PUBLISHED a palette packet on this body: the producer's own marks, never the end-of-body state. */
export const flashPublished = (r) => has(r, 'flash_tick') && (has(r, 'flash_apply_on') || has(r, 'fade_apply_palette')) && r.pub >= PACKET_MIN;
/** The derived rule for rows measured before the apply marks existed (switch-tail recipes only; see the header). */
export const flashPublishedHistorical = (r, { tail }) => tail === 'switch' && has(r, 'flash_tick') && r.fl === 1 && r.pub >= PACKET_MIN;

/**
 * The producers that share the return crossing's own body: a Flash palette publication (the one `return-prod` requires), a column arm, a body that
 * queued VRAM work (`pub`), or a releasing NMI that drained a queue (`q`) -- the work the rebind has to coexist with in one frame (review 1 finding 3).
 */
export function returnProducers(r) {
  const out = [];
  if (flashPublished(r)) out.push('flash-publication');
  if (has(r, 'sw_stream_start_col')) out.push('column-arm');
  if (r.pub > 0) out.push('queue-publication');
  if (r.q > 0) out.push('queue-drain');
  return out;
}

export const isCrossing = (r) => has(r, 'move_tick') && has(r, 'spawn_entities') && has(r, 'sw_talker_cross');
const armed = (r) => r.st0 === 0 && r.st1 !== 0;

/** The tail continuation each tail runs in the final body (the script_op_* handler); `none` and `ret` add none. */
export const TAIL_MARK = { none: null, say: 'script_op_say', flash: 'script_op_flash', switch: 'script_op_set', move2: 'script_op_move', ret: 'script_op_move' };

/** The classes of every body of a run. Each entry: { f, classes: [...], basis?, row }. Bodies with no class are omitted. */
export function classifyBodies(rows, { tail = 'none', historical = false } = {}) {
  const out = [];
  let firstCrossing = null;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const classes = [];
    let basis;
    if (isCrossing(r)) {
      classes.push('crossing');
      const cont = TAIL_MARK[tail];
      if (has(r, 'sw_stream_start_row') && armed(r) && r.q > 0 && has(r, 'move_finish') && (!cont || has(r, cont))) classes.push('vseam');
      const col = has(r, 'sw_stream_start_col') && r.st1 !== 0;
      if (col && r.q >= 1 && r.q <= PACKET_MIN && r.stadv === 1 && armed(r) && !!prev && prev.st1 !== 0) classes.push('hseam-a');
      if (has(r, 'sw_stream_start_col')) {
        if (flashPublished(r)) { classes.push('hseam-b'); basis = 'marks'; }
        else if (historical && flashPublishedHistorical(r, { tail })) { classes.push('hseam-b'); basis = 'derived-historical'; }
      }
      if (firstCrossing === null) firstCrossing = r;
      else if (r.col === firstCrossing.col - 1 && has(r, 'sw_talker_rebind')) {
        // the live rebind resolved the talker's LAST slot: the scan ran MAX_ENTITIES steps and never reached the gone path
        if (times(r, 'sw_tr_loop') === MAX_ENTITIES && !has(r, 'sw_tr_gone')) {
          classes.push('return');
          if (returnProducers(r).includes('flash-publication')) classes.push('return-prod');
        } else classes.push('return-rebind-only');
      }
    } else if (has(r, 'move_tick') && has(r, 'sw_frame_camera_window') && has(r, 'sw_stream_start_row') && armed(r) && !has(r, 'spawn_entities')) classes.push('preseam-arm');
    if (classes.length) out.push({ f: r.f, classes, ...(basis ? { basis } : {}), row: r });
  });
  return out;
}

// ----------------------------------------------------------------- the gate

/** Every Move or crossing body is gated, whatever its class (review 3 obligation 3): the bodies of `rows` that ran move_tick or spawn_entities. */
export const gatedRows = (rows) => rows.filter((r) => has(r, 'move_tick') || has(r, 'spawn_entities'));
export function gateProblems(rows, { gate = GATE } = {}) {
  const g = gatedRows(rows);
  if (!g.length) return ['no Move or crossing body was timed: nothing was gated'];
  return g.filter((r) => !(r.G <= gate)).map((r) => `body at frame ${r.f}: G = ${r.G} exceeds the gate ${gate} (ran ${r.ran.join(', ')})`);
}
export const worstGated = (rows) => Math.max(0, ...gatedRows(rows).map((r) => r.G));

// ----------------------------------------------------------------- what a cell must show

/**
 * Whether a vertical Move crosses the seam, by distance. The touch actor stands at y = touchY on the Down screen, the Move starts there, and the
 * seam is 240 - touchY px below. A Move at least SEAM_SLACK px past it MUST cross; one at least SEAM_SLACK short of it must not; in between the
 * start offset of the player's box makes it either, and a cell there is measured and gated but not held to a crossing. (Pinned by streamedcross
 * tests; tightened to the measured threshold once the S3b engine has measured it.)
 */
export const SEAM_SLACK = 16;
export function crossingExpectation(c) {
  const room = 240 - c.touchY;
  if (c.dist >= room + SEAM_SLACK) return 'required';
  if (c.dist <= room - SEAM_SLACK) return 'absent';
  return 'either';
}

/** The classes a NEW-engine cell of each stage must produce (plan 4.5). The horizontal stage's per-kind classes are chosen by the cell's own `kind`. */
export function requiredClasses(c) {
  if (c.which === 'parent') return [];
  switch (c.stage) {
    case 'x1': return ['preseam-arm', ...(crossingExpectation(c) === 'required' ? ['crossing'] : [])];
    case 'x2': case 'x3': return crossingExpectation(c) === 'required' ? ['crossing'] : [];
    case 'x4': case 'x6': return ['crossing', 'vseam'];
    case 'x5h': return c.kind === 'classA' || c.kind === 'classARpgBound' ? ['crossing', 'hseam-a'] : ['crossing'];
    case 'x5r': return ['crossing', 'return', 'return-prod'];
    default: throw new Error(`unknown cross stage ${c.stage}`);
  }
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/** A cell whose scene is populated and asserted on (the horizontal scenes and the vertical 'dest' / 'composed' ones; not the S3a 'walk' scene). */
export const isPopulatedScene = (c) => c.dir === 'right' || c.scene === 'dest' || c.scene === 'composed';

/** Build-time facts the populated scenes assert on (eight destination actors, the tile budget, the bound tile, the enter event, the touch actor, the return source). */
export function factProblems(c, facts) {
  if (!facts) return [];
  const out = [];
  const tiles = c.bound ? 14 : 15;
  if (facts.destEntities !== 8) out.push(`the destination has ${facts.destEntities} actors, not 8`);
  if (facts.destTiles !== tiles) out.push(`the destination holds ${facts.destTiles} tiles, not ${tiles}`);
  if (c.bound ? !(facts.boundTiles >= 1) : facts.boundTiles !== 0) out.push(`the bound tile is ${c.bound ? 'missing' : 'present in a plain scene'}`);
  if ((c.enter ?? 'set') === 'none' ? facts.enterEvents !== 0 : !(facts.enterEvents >= 1)) out.push('the destination enter event is wrong');
  if (!facts.touchOnSource) out.push('the touch actor is not on the source screen');
  if (c.scene === 'composed' || c.scene === 'dest') {
    // vertical: the touch actor is the LAST slot of a populated source, so the crossing's rebind has the whole screen to scan
    if (facts.srcEntities !== 8) out.push(`the source has ${facts.srcEntities} actors, not 8`);
    if (facts.touchSlot !== 7) out.push(`the touch actor is in slot ${facts.touchSlot}, not the last (7)`);
  }
  if (c.tail === 'ret') {
    // the return destination: populated, the talker last, an enter actor that owes an entry
    if (facts.srcEntities !== 8) out.push(`the return destination has ${facts.srcEntities} actors, not 8`);
    if (facts.srcTiles !== tiles) out.push(`the return destination holds ${facts.srcTiles} tiles, not ${tiles}`);
    if (facts.touchSlot !== 7) out.push(`the talker is in slot ${facts.touchSlot} of its screen, not the last (7)`);
    if (!(facts.srcEnter >= 1)) out.push('the return destination has no enter actor');
  }
  return out;
}

/**
 * The trace assertions of a populated cell (the spike's acc2.assertTrace, kept and made axis-aware): the crossing lands in the next screen of the same
 * column (down) or row (right), the final Move body is at or after it, the Flash lead (when authored) ran before it, the tail's continuation ran, and
 * the owed enter event fires AFTER the crossing's own event has ended -- tail-aware: none/switch/flash within three bodies, move2 after the second Move,
 * say held while the box is open, ret once, after the return.
 */
export function traceProblems(c, rows) {
  const out = [];
  const C = rows.find((r) => isCrossing(r));
  if (!C) return ['no crossing body: no body ran move_tick, spawn_entities and sw_talker_cross'];
  const prev = rows.filter((r) => r.f < C.f).at(-1);
  const bad = (cond, msg) => { if (!cond) out.push(msg); };
  if (c.dir === 'right') {
    bad(!!prev && prev.col + 1 === C.col && C.px < 16, 'the crossing does not land on the next column with the local x wrapped');
    bad(!!prev && prev.row === C.row, 'the crossing changes the row');
  } else {
    bad(!!prev && prev.row + 1 === C.row && prev.col === C.col, 'the crossing does not land on the next row of the same column');
  }
  bad(rows.some((r) => r.f >= C.f && has(r, 'move_finish')), 'no final Move body at or after the crossing');
  const leadFlash = c.dir === 'right' ? !c.nolead : c.lead === 'flash';
  const flashOn = rows.some((r) => r.f < C.f && has(r, 'script_op_flash'));
  if (c.dir === 'right' || c.lead === 'flash' || c.lead === 'none') bad(c.nolead ? !flashOn : leadFlash ? flashOn : true, c.nolead ? 'a Flash ran before the crossing in a no-lead cell' : 'no Flash lead ran before the crossing');
  const enter = c.enter ?? 'set';
  const fireMark = enter === 'wait' ? 'script_op_wait' : 'script_op_set';
  const fires = enter === 'none' ? [] : rows.filter((r) => r.f > C.f && has(r, 'start_dialog') && has(r, fireMark));
  // the event's own Moves end on a move_finish body each; the owed entry fires right after the LAST of them (a long Move ends well after the crossing)
  const finals = rows.filter((r) => r.f >= C.f && has(r, 'move_finish'));
  const D = fires[0];
  if (c.tail === 'say') bad(fires.length === 0, 'the owed enter event fired while the Say box was open');
  else if (c.tail === 'ret') out.push(...returnTraceProblems(c, rows, C, fires));
  else if (enter !== 'none') {
    const want = c.tail === 'move2' ? 2 : 1;
    const last = finals[want - 1];
    bad(finals.length >= want, `the event ran ${finals.length} final Move bodies after the crossing, not ${want}`);
    bad(!!D && !!last && D.f > last.f && D.f <= last.f + 3, c.tail === 'move2' ? 'the owed enter event did not fire right after the second Move' : 'the owed enter event did not fire within three bodies of the event\'s last Move');
  }
  const cont = TAIL_MARK[c.tail];
  // on the FINAL Move body itself: the enter event's own Set shares script_op_set with a switch tail, so a window of bodies could not tell them apart
  bad(!cont || rows.some((r) => r.f >= C.f && has(r, 'move_finish') && has(r, cont)), `the tail's continuation ${cont} did not run on the final Move body`);
  bad(!D || D.f > C.f, 'the owed enter event fired before the crossing');
  return out;
}

/**
 * The return row's own trace assertions: a second crossing back to the first column; the entry owed by the FIRST crossing's destination never fires
 * (the second crossing overwrites it), the one owed by the return destination fires exactly once, after the event's last Move, and the live rebind
 * of the return body resolved the talker's last slot (that is the `return` class, checked by the class list).
 */
export function returnTraceProblems(c, rows, C, fires) {
  const out = [];
  const crossings = rows.filter((r) => isCrossing(r));
  const R = crossings.find((r) => r.f > C.f && r.col === C.col - 1);
  if (!R) return ['the return Move never crossed back to the first column'];
  if ((c.enter ?? 'set') === 'none') return out;
  const lastFinal = Math.max(...rows.filter((r) => r.f >= R.f && has(r, 'move_finish')).map((r) => r.f));
  if (fires.some((r) => r.f < R.f)) out.push('the entry owed by the first crossing fired before the return crossing');
  if (fires.length !== 1) out.push(`${fires.length} owed enter events fired after the first crossing, not exactly the one the return destination owes`);
  else if (!(fires[0].f > R.f && fires[0].f <= lastFinal + 3)) out.push('the return destination\'s owed enter event did not fire right after the event\'s last Move');
  return out;
}

// ----------------------------------------------------------------- a parent

/**
 * What a PARENT cell must show. It stops at the seam, so a missing crossing is expected and is the one thing exempted; the scripted work is not:
 * a Move body (move_tick), its final body (move_finish) and the tail's continuation on a final body must all have run (review 1 finding 6: "never
 * crosses" is not "never moves"; 428 walking-only records passed as Move baselines).
 */
export function parentProblems(c, rows) {
  const out = [];
  if (!rows.some((r) => has(r, 'move_tick'))) out.push('the parent ran no Move step (move_tick): the scripted work did not happen');
  if (!rows.some((r) => has(r, 'move_finish'))) out.push('the parent ran no final Move body (move_finish)');
  const cont = TAIL_MARK[c.tail];
  if (cont && !rows.some((r) => has(r, 'move_finish') && has(r, cont))) out.push(`the parent's tail continuation ${cont} did not run on a final Move body`);
  return out;
}

/** The measured timing of a parent (never gated; reported): the worst G of its Move bodies and of its final bodies. */
export function parentTiming(rows) {
  const move = rows.filter((r) => has(r, 'move_tick') || has(r, 'move_finish'));
  return { move: Math.max(0, ...move.map((r) => r.G)), final: Math.max(0, ...rows.filter((r) => has(r, 'move_finish')).map((r) => r.G)), bodies: move.length };
}

/**
 * Every problem that makes one cell's measurement unusable or over the gate; [] when sound. `measured` = { rows, facts?, status, done, timeout }.
 * A parent cell is held to a sound run and to its scripted work (a missing crossing there is EXPECTED, never a problem); a new-engine cell is held to
 * its stage's classes, the gate on every Move/crossing body, and (populated scenes) the build facts and trace assertions.
 */
export function cellVerdict(c, measured, { gate = GATE, historical = false } = {}) {
  const out = [];
  if (measured.status !== 0) out.push(`Mesen exit status ${measured.status}`);
  if (!measured.done) out.push('the run did not finish (no DONE line)');
  if (measured.timeout) out.push('the run timed out');
  const rows = measured.rows ?? [];
  if (!rows.length) { out.push('no body was recorded'); return out; }
  if (rows.some((r) => !finite(r.G))) out.push('a body has no finite G');
  if (c.which === 'parent') { out.push(...parentProblems(c, rows)); if (isPopulatedScene(c)) out.push(...factProblems(c, measured.facts)); return out; }
  out.push(...gateProblems(rows, { gate }));
  const bodies = classifyBodies(rows, { tail: c.tail, historical });
  const seen = new Set(bodies.flatMap((b) => b.classes));
  for (const k of requiredClasses(c)) if (!seen.has(k)) out.push(`missing composition class ${k}: no body showed every required property on the same body`);
  if (c.dir === 'down' && crossingExpectation(c) === 'absent' && seen.has('crossing')) out.push('a crossing where the Move is too short to reach the seam');
  if (isPopulatedScene(c)) out.push(...factProblems(c, measured.facts), ...traceProblems(c, rows));
  return out;
}

/** A stage whose planned composition cells produced zero rows of a required class fails (an all-empty crossing campaign cannot pass). */
export function stageCompositionProblems(stage, cells, measuredById, { need = {} } = {}) {
  const want = need[stage] ?? [];
  const out = [];
  for (const klass of want) {
    const n = cells.filter((c) => c.which !== 'parent').filter((c) => {
      const m = measuredById.get(c.id);
      return m && !m.error && classifyBodies(m.rows ?? [], { tail: c.tail }).some((b) => b.classes.includes(klass));
    }).length;
    if (n === 0) out.push(`stage ${stage}: no planned cell produced a ${klass} body`);
  }
  return out;
}

/**
 * Shape-specific completion (review 1 finding 3): a stage-level "one hseam-a somewhere" is satisfied by any game shape, so the RPG + switch-bound class (a)
 * obligation (whose 78 original IDs are refusal receipts) has its OWN check: among the planned cells of its buildable equivalent, one at least must have
 * been measured soundly AND shown the same-body class (a) -- on an RPG project that carries a bound tile (the facts say so, not the cell's own claim).
 */
export const SHAPE_NEEDS = [{ name: 'class (a) on RPG + switch-bound tile', kind: 'classARpgBound', klass: 'hseam-a' }];
export function shapeCompletionProblems(planned, measuredById, shapes = SHAPE_NEEDS) {
  const out = [];
  for (const sh of shapes) {
    const cells = planned.filter((c) => c.which === 'new' && (c.kinds ?? [c.kind]).includes(sh.kind));
    if (!cells.length) continue; // a launch that does not plan the shape (the mandatory aggregate does: see run_sw_cross.mjs --aggregate)
    const good = cells.filter((c) => {
      const m = measuredById.get(c.id);
      if (!m || m.error || !m.rows) return false;
      if (c.gt !== 'rpg' || !c.bound || !(m.facts?.boundTiles >= 1)) return false;
      return classifyBodies(m.rows, { tail: c.tail }).some((b) => b.classes.includes(sh.klass));
    });
    if (!good.length) out.push(`shape ${sh.name}: none of ${cells.length} planned cells was measured with a ${sh.klass} body on an RPG project carrying a bound tile`);
  }
  return out;
}

/** The classes whose presence is required of a WHOLE stage (at least one cell shows it). */
export const STAGE_NEEDS = { x4: ['vseam'], x5h: ['hseam-a', 'hseam-b'], x5r: ['return', 'return-prod'], x6: ['vseam'], x1: ['preseam-arm', 'crossing'] };

/** Provenance fields every record must carry (re-exported so the cross runner and its tests share one list). */
export { PROVENANCE_FIELDS };
