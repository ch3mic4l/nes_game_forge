// Phase 3b S1b rows 2, 4 and 7: the VERDICTS over a cell's witness runs. Pure (rows in, items out) so test/lua/ring_gate/s1b_unit.mjs can feed it synthetic
// rows and prove each rule fails when its evidence is missing. An item = { id, emu, status: 'PASS'|'FAIL'|'N/A'|'UNMEASURED', detail }.
//   perSpec[]  = { name, mesen: { status, rows } | null, jsnes: { finished, rows } | null, dlgSingle, hasKnock, seams: { crossings, failures } | null }
//   ctx        = { cell, gt, ring (1|2), n, placement, emus: ['mesen','jsnes'], consts: { SW_RING_COL_LEN, SW_RING_ROW_LEN, STREAM_RING } }
import { classify } from './ringcount.mjs';
import { WRITES_PER_SWITCH, compareBodies, relationshipFailures, requiredEvidence, classInvariants, pairBodies, DSP_KEYS, dspRangeFailures, NMI_TOLERANCE, DIVERGENT_SPECS } from './s1bagree.mjs';
import { classBounds, cellPrices, checkEventPrices, projCeiling, bodyTerms, PASS_CEILING, SAMPLED_TERMS, UNCERTIFIED_LABEL } from './s1bbound.mjs';
import { coverageItems, armStateFailures, ARM_ACTIVE, ARM_FNT } from './s1bcover.mjs';

export const GATE = 29780; // the NTSC frame budget G is measured against (sw_manifest.lua.template FRAME)
/** How close (cycles, either side) to GATE a body is REPORTED by name (a near-miss or a near-overrun). */
export const NEAR = 64;
/**
 * THE ONE PLACE the gate's inequality lives, and it is STRICT: the harness verdict is `G < 29,780` (Chris's ruling of 2026-10-06; the accepted plan's row 4 says `<`). The Lua template
 * (sw_manifest.lua.template) counts its own raw diagnostic `gateFail` as `G > 29,780`, i.e. it would let a body at exactly 29,780 through; that raw count is a template diagnostic and is NEVER the verdict
 * here. Every verdict of this harness (per-class gate, the class estimate, the padding controls, the report tables) reads this predicate: a body at exactly GATE FAILS, whatever the template's own tally says.
 */
export const gateAllows = (G) => G < GATE;
/** The 2.1 classes each game type must witness, with what makes the class a class (the judge's required set). */
export const REQUIRED = {
  action: ['C0', 'C1', 'C2', 'C3a', 'C3b', 'C4a', 'C4b', 'C4bw', 'C4c'],
  rpg: ['C0', 'C1', 'C2', 'C3a', 'C4a', 'C4b', 'C4bw', 'C4c', 'CB']
};
/** Reads per body, by class: [max sw_peek_byte, max sw_goto] -- plan 2.2's source-derived counts (2 movement probes + 1 hazard probe + 1 arm), here as CEILINGS the counters must stay under. */
export const READ_CEILING = {
  C1: [3, 3], C2: [3, 4], C3a: [2, 3], C3b: [3, 4], C4a: [0, 0], C4bw: [0, 0], C4b: [2, 3], C4c: [2, 3], CB: [0, 0], C1s: [1, 1], C3s: [0, 0]
};
const COEXIST_C2 = ['armCol|armRow', 'entities', 'projection', 'flash', 'shake', 'sfx', 'movProbe', 'hazard', 'nmiStream|nmiStreamReduced|nmiBig'];
const cmp = (a, b) => a - b;
const has = (terms, spec) => spec.split('|').some((t) => terms.includes(t));

/** Per emulator: every body row of every spec, with its spec name. */
export const allRows = (perSpec, emu) => perSpec.flatMap((s) => (s[emu]?.rows ?? []).map((r) => ({ ...r, spec: s.name })));

/**
 * Per class summary over `rows`: n, max of each counter, the union of terms, gateFail (G > GATE), the bodies at exactly GATE, the max-G body.
 * (ringwork.summarize is the same shape; this one also keeps the per-body term sets for the coincidence rules.)
 */
export function perClass(rows) {
  const out = {};
  for (const r of rows) {
    const c = (out[r.cls] ??= { n: 0, maxG: null, gateFail: 0, at: [], near: [], ovr: 0, max: {}, top: null, rows: [] });
    c.n++;
    for (const [k, v] of Object.entries(r.counters)) c.max[k] = Math.max(c.max[k] ?? 0, v);
    c.ovr += r.counters.ovr ? 1 : 0;
    if (r.G !== undefined) {
      if (c.maxG === null || r.G > c.maxG) { c.maxG = r.G; c.top = r; }
      if (!gateAllows(r.G)) c.gateFail++;
      if (r.G === GATE) c.at.push(`${r.spec}@${r.frame}`);
      if (Math.abs(r.G - GATE) <= NEAR) c.near.push({ at: `${r.spec}@${r.frame}`, G: r.G });
    }
    c.rows.push(r);
  }
  return out;
}

/** The price of a read on this cell: the largest complete sw_peek_byte observed (Mesen cycles), and the largest per-body mapper-write count. */
export const readPrice = (rows) => rows.reduce((m, r) => Math.max(m, r.counters.pkx ?? 0), 0);

/**
 * The bound (plan-review-3 finding 3): for each class, the worst measured body PLUS the reads its source ceiling allows and that body did not make, each priced at
 * the dearest complete read measured on this cell at the deepest row. A read is `sw_goto` + `sw_locate_current` and everything inside them (the bank switches, the row
 * loop): charging that one measured price per missing read charges the mapper delta and the row-loop work once, inside the read, and never again as a separate credit.
 * Returns { [class]: { maxG, gotos, ceiling, price, boundG, ok } }.
 */
export function boundByClass(classes, price) {
  const out = {};
  for (const [cls, c] of Object.entries(classes)) {
    if (cls === 'C0' || c.maxG === null) continue;
    const ceil = READ_CEILING[cls]?.[1] ?? 0;
    const gotos = c.top?.counters?.goto ?? 0;
    const extra = Math.max(0, ceil - gotos);
    out[cls] = { maxG: c.maxG, gotos, ceiling: ceil, price, extra, boundG: c.maxG + extra * price, ok: gateAllows(c.maxG + extra * price) };
  }
  return out;
}

/**
 * Round 2, finding 6: the NUMERICAL gate outcome and nothing else. The completed Mesen bodies of every spec, C0 excluded (exempt on observed force-blank evidence only), whose
 * G the gate refuses. A `--expect=gate-fail` control is accepted only if at least one such body exists AND the run itself was operationally sound; the overrun diagnostics
 * (`overruns:*`, a body that spans a frame) are NOT a numerical G failure and can never satisfy it. `allows` is injectable so a control can DISABLE the numerical verdict
 * while keeping every diagnostic (the round-1 hole: a disabled threshold still "failed" through the overrun items).
 */
export function numericGateFailures(perSpec, allows = gateAllows) {
  return allRows(perSpec, 'mesen').filter((r) => r.cls !== 'C0' && Number.isFinite(r.G) && !allows(r.G)).map((r) => ({ spec: r.spec, frame: r.frame, cls: r.cls, G: r.G }));
}
/** Operational failures of the run itself: a Mesen exit that is not 0, a timeout, no bodies, an unmeasured run item -- never a control success. */
export function operationalFailures(items, perSpec) {
  const bad = items.filter((i) => /^run:/.test(i.id) && i.status !== 'PASS').map((i) => `${i.id} ${i.emu}: ${i.status} (${i.detail})`);
  for (const s of perSpec) if (s.mesen && (s.mesen.status !== 0 || s.mesen.timeout || !(s.mesen.rows?.length > 0))) bad.push(`run:${s.name} mesen: exit ${s.mesen.status}${s.mesen.timeout ? ', timeout' : ''}, ${s.mesen.rows?.length ?? 0} bodies`);
  return [...new Set(bad)];
}
/** { numeric, operational, ok } of a gate-fail control: ok = at least one numerical G failure and no operational failure. */
export function gateFailControl(items, perSpec, allows = gateAllows) {
  const numeric = numericGateFailures(perSpec, allows), operational = operationalFailures(items, perSpec);
  return { numeric, operational, ok: numeric.length > 0 && operational.length === 0 };
}

export function judgeCell({ perSpec, ctx }) {
  const items = [];
  const add = (id, emu, status, detail) => items.push({ id, emu, status, detail });
  const { gt, ring, n, placement } = ctx;
  const emus = ctx.emus;
  // ---- 1. every run completed in every requested emulator
  for (const s of perSpec) for (const emu of emus) {
    const r = s[emu];
    if (!r) { add(`run:${s.name}`, emu, 'UNMEASURED', `${s.name} produced no ${emu} result`); continue; }
    if (emu === 'mesen') add(`run:${s.name}`, emu, r.status === 0 && r.rows.length > 0 && !r.timeout ? 'PASS' : 'FAIL', `exit ${r.status}, ${r.rows.length} bodies, frames ${r.frames}${r.timeout ? ', TIMEOUT' : ''}`);
    else add(`run:${s.name}`, emu, r.finished && r.rows.length > 0 ? 'PASS' : 'FAIL', `${r.rows.length} bodies${r.finished ? '' : ', phase list never finished'}`);
  }
  // ---- 2. the dialogue placement the cell claims is the placement the ROM assembled (a banked claim must be a switchable-window overlay)
  for (const s of perSpec) {
    const a = s.dlgSingle;
    const ok = placement === 'banked' ? a >= 0x8000 && a < 0xc000 : a >= 0xc000;
    add(`placement:${s.name}`, '-', ok ? 'PASS' : 'FAIL', `sw_dlg_single at $${(a ?? 0).toString(16)}, the cell is ${placement}`);
  }
  const byEmu = Object.fromEntries(emus.map((e) => [e, perClass(allRows(perSpec, e))]));
  // ---- 3. classes witnessed, by observed execution; nothing unclassified
  for (const emu of emus) {
    const cls = byEmu[emu];
    for (const c of REQUIRED[gt]) {
      if (c === 'C3b' && gt === 'rpg') continue;
      if (cls[c]?.n > 0) add(`class:${c}`, emu, 'PASS', `${cls[c].n} bodies`);
      else add(`class:${c}`, emu, 'FAIL', 'never witnessed in any spec');
    }
    if (gt === 'rpg') {
      const kb = perSpec.some((s) => s.hasKnock);
      add('class:C3b', emu, !kb && !cls.C3b ? 'N/A' : 'FAIL', 'RPG has no knockback: sw_knockback_step is not in any RPG ROM (the symbol is absent; engine/streamworld.asm assembles it under .if !BATTLE_ENABLED)');
    }
    const cx = cls.Cx?.n ?? 0;
    add('class:none-unclassified', emu, cx === 0 ? 'PASS' : 'FAIL', cx ? `${cx} bodies matched no class (first: ${JSON.stringify(cls.Cx.rows[0].counters)})` : 'every body classified');
  }
  // ---- 4. 2.2's read counts, confirmed or refuted by the counters, per class, per emulator
  for (const emu of emus) for (const [c, [pk, gt_]] of Object.entries(READ_CEILING)) {
    const k = byEmu[emu][c];
    if (!k) continue;
    const mp = k.max.peek ?? 0, mg = k.max.goto ?? 0;
    add(`reads:${c}`, emu, mp <= pk && mg <= gt_ ? 'PASS' : 'FAIL', `max peek ${mp} (ceiling ${pk}), max goto ${mg} (ceiling ${gt_}), attained: ${mp === pk && mg === gt_ ? 'both' : mp === pk ? 'peek' : mg === gt_ ? 'goto' : 'neither'}`);
  }
  // ---- 5. the deepest row (the read paths themselves are the per-route coverage map of section 7: s1bcover.mjs)
  for (const emu of emus) {
    const rows = allRows(perSpec, emu);
    if (ring === 1) { const rl = Math.max(0, ...rows.map((r) => r.counters.rowloop ?? 0)); add('path:deepest-row', emu, rl === 0 ? 'PASS' : 'FAIL', `a vertical ring's sw_goto row loop never iterates (max ${rl}): gridH == 1`); }
    else {
      const deep = rows.find((r) => (r.counters.armr ?? 0) > 0 && r.counters.goto === 1 && r.counters.rowloop === n - 1);
      add('path:deepest-row', emu, deep ? 'PASS' : 'FAIL', deep ? `${deep.spec}@${deep.frame}: one arm sw_goto at row ${n - 1} ran the row loop ${deep.counters.rowloop} times (N-1 = ${n - 1})` : `no single-goto arm body ran the row loop N-1 = ${n - 1} times (deepest row of the ${n}-screen world unmeasured)`);
    }
  }
  // ---- 6. the arm (d): axis and strip parameters against the build's own constants
  for (const emu of emus) {
    const rows = allRows(perSpec, emu).filter((r) => (r.counters.armc ?? 0) + (r.counters.armr ?? 0) > 0);
    const wantLen = ring === 1 ? ctx.consts?.SW_RING_COL_LEN : ctx.consts?.SW_RING_ROW_LEN;
    const wrongAxis = rows.filter((r) => (ring === 1 ? (r.counters.armr ?? 0) : (r.counters.armc ?? 0)) > 0);
    const lens = new Set(rows.map((r) => r.state.st_len));
    const badLen = rows.filter((r) => r.state.st_len !== wantLen);
    add('arm:axis', emu, rows.length && !wrongAxis.length ? 'PASS' : 'FAIL', `${rows.length} arm bodies, ${wrongAxis.length} on the wrong axis (a ${ring === 1 ? 'vertical' : 'horizontal'} ring arms ${ring === 1 ? 'columns' : 'rows'})`);
    add('arm:st_len', emu, rows.length && !badLen.length && wantLen ? 'PASS' : 'FAIL', `st_len values ${[...lens].join(',')} against the build's ${ring === 1 ? 'SW_RING_COL_LEN' : 'SW_RING_ROW_LEN'} = ${wantLen}`);
    // round 3 (review 2 finding 3): the arm must be a VALID state, not merely a diverse one -- active at the observation point, and a destination parity the axis can produce (s1bcover.mjs, with the source lines)
    const as = armStateFailures(allRows(perSpec, emu), { ring });
    add('arm:active', emu, as.bodies && !as.inactive.length ? 'PASS' : 'FAIL', `${as.bodies} arm bodies; st_active at the body-end sample must be ${ARM_ACTIVE[ring]} (a ${ring === 1 ? 'column' : 'row'} strip: sw_stream_start_${ring === 1 ? 'col' : 'row'} ends in st_active = ${ARM_ACTIVE[ring]}): ${as.inactive.length} bodies with the strip not active${as.inactive[0] ? ` (first ${as.inactive[0]})` : ''}`);
    add('arm:parity', emu, as.bodies && !as.badParity.length ? 'PASS' : 'FAIL', `${as.bodies} arm bodies; st_fnt must be a destination parity of the ${ring === 1 ? 'column' : 'row'} axis, one of {${ARM_FNT[ring].join(', ')}}: ${as.badParity.length} illegal${as.badParity[0] ? ` (first ${as.badParity[0]})` : ''}`);
  }
  // ---- 7. the per-path coverage map (round 2 finding 2): every witness is ONE jsnes body carrying the whole conjunction (s1bcover.mjs)
  if (emus.includes('jsnes')) {
    const wantLen = ring === 1 ? ctx.consts?.SW_RING_COL_LEN : ctx.consts?.SW_RING_ROW_LEN;
    coverageItems(allRows(perSpec, 'jsnes'), { gt, ring, wantLen, ceiling: READ_CEILING }, add);
  } else add('cover', 'jsnes', 'UNMEASURED', 'jsnes was not requested: the per-path coverage map reads the jsnes rows (their profile and state), which the Mesen rows are held equal to per body');
  // ---- 7a. damaging chasers (action only: an RPG contact is a battle, never a knockback): the knockback bodies of the damage-1 chaser spec, entities live
  if (gt === 'action') for (const emu of emus) {
    const kb = (perSpec.find((x) => x.name === 'chase')?.[emu]?.rows ?? []).filter((r) => r.cls === 'C3b');
    const best = kb.reduce((m, r) => ((r.counters.dsw ?? 0) > (m?.counters.dsw ?? -1) ? r : m), null);
    add('coexist:C3b-damage', emu, best && (best.counters.dsw ?? 0) >= 8 ? 'PASS' : 'FAIL', best ? `${kb.length} knockback bodies from damaging chasers; busiest: ${best.counters.dsw} entity draws, peek ${best.counters.peek}, goto ${best.counters.goto}, terms ${best.terms.join('+')}` : 'the damaging-chaser spec produced no knockback body');
  }
  // ---- 9. per-BODY agreement and sanity of the counters (round 2 finding 4: round 1 compared class maxima)
  if (emus.includes('mesen') && emus.includes('jsnes')) {
    agreementItems(perSpec, add);
  }
  for (const emu of emus) {
    const rf = relationshipFailures(perSpec, emu, ctx.mapper);
    add('sanity:relationships', emu, rf.length ? 'FAIL' : 'PASS', rf.length ? `${rf.length} bodies break the transaction arithmetic (first ${rf[0].at} ${rf[0].cls}: ${rf[0].bad.slice(0, 2).join('; ')})` : `every body: g/l/p events == goto/loc/peek, pkc == the peeks' prices, pkx == the dearest, bank >= goto + loc, mapper writes == ${WRITES_PER_SWITCH[ctx.mapper]} per switch`);
    const ev = requiredEvidence(perSpec, emu);
    add('sanity:evidence', emu, ev.missing.length ? 'FAIL' : 'PASS', ev.missing.length ? `the record has no ${ev.missing.join(', ')} evidence at all (a dead counter, not a quiet body)` : `reads priced, restored, switched and written: ${Object.entries(ev.need).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const dr = dspRangeFailures(perSpec, emu);
    add('sanity:dsp', emu, dr.length ? 'FAIL' : 'PASS', dr.length ? `${dr.length} bodies whose park-split count is out of range (first ${dr[0]}): every dsw_st_park visit belongs to one dsw_st_tile iteration, so 0 <= dsp <= dst must hold in each emulator on its own` : `every body: dst and dsp are nonnegative integers with dsp <= dst (0 <= dsp <= dst, checked in this emulator alone). This does NOT certify an in-range wrong or dead dsp hook: the cross-core equality of dsp is agree:dsp, UNCERTIFIED`);
    const ci = classInvariants(perSpec, emu);
    add('sanity:class-state', emu, ci.length ? 'FAIL' : 'PASS', ci.length ? `${ci.length} bodies whose class disagrees with the independently read game_state (first ${ci[0]})` : 'every body\'s class is consistent with game_state read at its end');
  }
  // ---- 10. decoded seams (jsnes): every crossing decoded, walking and Move
  const seams = perSpec.flatMap((s) => (s.seams ? [{ name: s.name, ...s.seams }] : []));
  const crossings = seams.flatMap((s) => s.crossings.map((c) => ({ ...c, spec: s.name })));
  for (const kind of ['walk', 'move']) {
    const list = crossings.filter((c) => c.kind === kind);
    const bad = seams.flatMap((s) => s.failures.filter((f) => !!f).map((f) => `${s.name}: ${f}`));
    if (!seams.length) add(`seam:${kind}`, 'jsnes', 'UNMEASURED', 'no seam decode ran');
    else add(`seam:${kind}`, 'jsnes', list.length && !bad.length ? 'PASS' : 'FAIL', `${list.length} ${kind} crossings decoded (${list.filter((c) => c.spawnMatch).length} with the authored arrival record spawned; ${kind === 'move' ? 'scroll = the torus position of the PREVIOUS frame\'s origin, within the Shake displacement' : 'scroll = this frame\'s or the previous frame\'s'}), ${bad.length} decode failures${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`);
    // every decoded crossing is bound to the body that made it (C3a for a walk, C4b for a Move, with the matching direction counter), and every crossing body to a decoded crossing
    const bind = seams.map((s) => ({ name: s.name, b: s.binding })).filter((x) => x.b);
    const mine = bind.map((x) => ({ name: x.name, unbound: x.b.unbound.filter((u) => u.startsWith(kind)), orphans: kind === 'move' ? x.b.orphans.filter((o) => / (C4b|C4c) /.test(o)) : x.b.orphans.filter((o) => / (C3a|C3b) /.test(o)) }));
    const unb = mine.flatMap((x) => x.unbound.map((u) => `${x.name}: ${u}`)), orph = mine.flatMap((x) => x.orphans.map((o) => `${x.name}: ${o}`));
    const out2 = bind.reduce((n2, x) => n2 + (x.b.outside_by?.[kind] ?? 0), 0), bnd = bind.reduce((n2, x) => n2 + (x.b.bound_by?.[kind] ?? 0), 0);
    if (bind.length) add(`seam:bound-${kind}`, 'jsnes', list.length && bnd && !unb.length && !orph.length ? 'PASS' : 'FAIL', `${bnd}/${list.length - out2} decoded ${kind} crossings bound to a ${kind === 'move' ? 'C4b/C4c' : 'C3a/C3b'} body that ran the matching sw_cross_*; ${out2} crossings in positioning frames outside every measured phase (no body exists there, counted not bound); ${orph.length} such bodies without a decoded crossing${unb[0] ? ' (' + unb[0] + ')' : ''}${orph[0] ? ' (' + orph[0] + ')' : ''}`);
    else add(`seam:bound-${kind}`, 'jsnes', 'UNMEASURED', 'no crossing binding ran');
    // the terrain: viewport tiles AND attributes against the project's record, on the distinguishable-terrain specs
    const tl = list.filter((c) => (c.terrainFrames ?? 0) > 0 && seams.find((s) => s.name === c.spec) && perSpec.find((p) => p.name === c.spec)?.distinctTerrain);
    const tb = tl.reduce((n2, c) => n2 + (c.terrainBad ?? 0), 0), tf = tl.reduce((n2, c) => n2 + (c.terrainFrames ?? 0), 0), tk = tl.reduce((n2, c) => n2 + (c.terrainBlocks ?? 0), 0);
    add(`seam:terrain-${kind}`, 'jsnes', tl.length && !tb ? 'PASS' : 'FAIL', `${tl.length} ${kind} crossings on a distinguishable-terrain ring: ${tf} frames / ${tk} viewport blocks around them match the project's tiles and attribute palette, ${tb} blocks differ`);
  }
  // ---- 11. the mainline G gate (Mesen): per class, with C0 separate; overruns; the bodies at exactly GATE are named
  if (emus.includes('mesen')) {
    const cls = byEmu.mesen;
    for (const [c, k] of Object.entries(cls)) {
      if (c === 'C0') { add('gate:C0', 'mesen', 'PASS', `exempt ON OBSERVED EVIDENCE only: ${k.n} bodies each with a $2001 write of 0, a $2007 draw while blank and the restore (c0); max G ${k.maxG}, ${k.gateFail} at or over ${GATE} (reported, not gating)`); continue; }
      add(`gate:${c}`, 'mesen', k.gateFail === 0 ? 'PASS' : 'FAIL', `${k.n} bodies, max G ${k.maxG}${k.maxG !== null && k.top ? ` (${k.top.spec}@${k.top.frame}, goto ${k.top.counters.goto ?? 0}, peek ${k.top.counters.peek ?? 0}, mwm ${k.top.counters.mwm ?? 0})` : ''}, ${k.gateFail} bodies refused by the harness verdict G < ${GATE} (a body at exactly ${GATE} is refused; the Lua template's raw gateFail diagnostic counts G > ${GATE} and is not the verdict), overruns ${k.ovr}${k.at.length ? `, AT EXACTLY ${GATE} (refused): ${k.at.join(' ')}` : ''}`);
      add(`overruns:${c}`, 'mesen', k.ovr === 0 ? 'PASS' : 'FAIL', `${k.ovr} bodies with an NMI landing inside (diagnostic: a body that spans a frame)`);
    }
    // every frame within NEAR cycles of the gate, either side, by name (whichever way the `<=` / `<` ruling goes)
    const nearAll = Object.entries(cls).flatMap(([c, k]) => (c === 'C0' ? [] : k.near.map((x) => `${c} ${x.at} G=${x.G}`)));
    add('gate:near', 'mesen', 'PASS', `${nearAll.length} non-C0 bodies within ${NEAR} cycles of ${GATE}${nearAll.length ? `: ${nearAll.join('; ')}` : ''} (the harness verdict is gateAllows: G < ${GATE}, strict)`);
    // ---- 12. the bound (round 2 finding 1): per-path arithmetic over exhaustively swept read prices and the per-body terms
    boundItems({ perSpec, ctx, add });
  } else add('gate', 'mesen', 'UNMEASURED', 'Mesen was not requested: G is defined by the template through emu.getState().masterClock, which jsnes does not model (jsnes carries the cycle cross-check only)');
  if (emus.includes('jsnes')) add('gate', 'jsnes', 'N/A', 'G is the template\'s masterClock difference (DMA stalls, NMI latency); the vendored core DOES schedule the OAM-DMA stall (513/514 cycles, ppu/index.js and nes.js) and the counting wrapper adds it (cpu.haltCycles hook) to `cyc`, but it still has no masterClock, so its `cyc` is the instruction-cycle cross-check only, never the gate (the agreement item reports Mesen G - jsnes cyc over equal bodies)');
  return items;
}
/**
 * The cross-core agreement items (exported so the judge-only successor evaluation re-derives them from retained bodies with exactly this code): `agree:bodies` (every comparison except `dsp`), `agree:chase`
 * (UNCERTIFIED when a declared-divergent spec leaves lockstep), `agree:dsp` (the cross-core equality of the park-split counter: ALWAYS UNCERTIFIED, observations kept) and `agree:reported`.
 */
export function agreementItems(perSpec, add) {
  const cmpr = compareBodies(perSpec);
  const dv = cmpr.divergent.map((d) => `${d.spec}/${d.phase} (${d.differ}/${d.bodies} bodies differ, agreeing prefix ${d.agreeingPrefix}; first: ${d.first})`);
  add('agree:bodies', 'both', cmpr.mismatches.length || cmpr.unpaired.length || !cmpr.compared ? 'FAIL' : 'PASS',
    `${cmpr.compared} bodies of ${cmpr.phases - cmpr.synthetic.length} phases in ${cmpr.specs} specs compared one to one (class, every counter EXCEPT dsp, every read event, game_state, end state): ${cmpr.exact} phases exactly equal, ${cmpr.divergent.length} phases of declared-divergent specs EXCLUDED from this verdict (UNCERTIFIED: item agree:chase), ${cmpr.c0Length.length} phases whose length differs by a C0 body's whole-frame duration difference between the cores (${cmpr.c0Length.join('; ') || 'none'}), ${cmpr.mismatches.length} UNACCEPTED mismatches${cmpr.mismatches[0] ? ` (first ${cmpr.mismatches[0].at}: ${cmpr.mismatches[0].diffs.slice(0, 3).join(', ')})` : ''}, ${cmpr.unpaired.length} phases with unequal body counts${cmpr.unpaired[0] ? ` (${cmpr.unpaired[0]})` : ''}; nmiT within +-${NMI_TOLERANCE} on agreeing bodies; Mesen G - jsnes cyc over equal bodies in [${cmpr.timing.gMinusCyc.min}, ${cmpr.timing.gMinusCyc.max}]`);
  if (perSpec.some((x) => x.name in DIVERGENT_SPECS)) add('agree:chase', 'both', cmpr.divergent.length ? 'UNCERTIFIED' : 'PASS',
    cmpr.divergent.length ? `UNCERTIFIED: the chase / knockback cross-check of the jsnes counters is NOT established for this cell -- ${cmpr.divergent.length} phase(s) leave lockstep between the cores (${dv.join(' | ')}) and no deterministic damaging-chaser witness was built (Chris's option A); a jsnes counter disagreeing with Mesen inside them is not detected. Each emulator's bodies still face every per-body sanity rule on their own.` : `every phase of the damaging-chaser spec stays in lockstep and is compared exactly in agree:bodies`);
  add('agree:dsp', 'both', 'UNCERTIFIED',
    `UNCERTIFIED (declared whatever the observations: reviewer's triage ruling): the cross-core equality of the entity draw's park-split counter dsp is NOT certified. ${cmpr.dsp.compared} bodies compared, ${cmpr.dsp.differ} differ (largest absolute difference ${cmpr.dsp.maxAbs}); the discrepancies are observations only, no alignment rule or tolerance is applied, and pairBodies keeps full equality (dsp included). NOT CLAIMED: that an in-range wrong or dead dsp hook in either emulator is detected -- only the per-emulator range guard sanity:dsp (0 <= dsp <= dst) applies${cmpr.dsp.bodies[0] ? `. Observed (first ${Math.min(6, cmpr.dsp.bodies.length)}): ${cmpr.dsp.bodies.slice(0, 6).join(' | ')}` : ''}`);
  add('agree:reported', 'both', 'PASS', `not compared (reported): ${cmpr.synthetic.length} phases whose Mesen bodies carry the template's SYNTHETIC pokes (${cmpr.synthetic.join(', ') || 'none'}); OBSERVED dsp discrepancies ${cmpr.dsp.bodies.join(' | ') || 'none'} (${cmpr.dsp.differ} bodies; judged by agree:dsp); divergent ${dv.join(' | ') || 'none'}`);
}

/** The uncertified items an under-pad control may carry (the declared ones only); every other item must PASS or be legitimately N/A. */
export const UNCERTIFIED_OK = /^(bound:|agree:dsp$|agree:chase$)/;
/**
 * The under-pad control's acceptance, named SAMPLED ESTIMATE REFUSAL (it is not a proved class-bound refusal: the estimate's remainder, entity draw and NMI are sampled maxima). Caught only if, together:
 * the run was operationally sound (no operational failure), no completed non-C0 body failed the numerical G gate, at least one `bound:<class>` item FAILS because its estimate REACHES OR EXCEEDS the gate
 * (not merely because it undercut a measured G), and every other item is PASS, N/A, or one of the declared uncertified items (UNCERTIFIED_OK) -- nothing else may FAIL or be UNMEASURED. There is no
 * baseline-red tolerance. `ctl` = gateFailControl(...)'s { numeric, operational }; `bound` = the cell's boundOut.
 */
export function estimateRefusal(items, ctl, bound) {
  const why = [];
  if (ctl.operational.length) why.push(`${ctl.operational.length} operational failures`);
  if (ctl.numeric.length) why.push(`${ctl.numeric.length} numerical G failures`);
  const reaching = Object.entries(bound?.byClass ?? {}).filter(([, b]) => !gateAllows(b.bound.adj)).map(([c]) => c);
  const refused = reaching.filter((c) => items.some((i) => i.id === `bound:${c}` && i.status === 'FAIL'));
  if (!refused.length) why.push('no bound:<class> item FAILS from an estimate reaching or exceeding the gate');
  for (const i of items) {
    if (i.status === 'PASS' || i.status === 'N/A') continue;
    if (i.status === 'FAIL' && /^bound:C/.test(i.id)) continue;
    if (i.status === 'UNCERTIFIED' && UNCERTIFIED_OK.test(i.id)) continue;
    why.push(`${i.status} ${i.emu}:${i.id}`);
  }
  return { ok: !why.length, why, refused };
}

/** The bound's items: the sweep's own checks, the event prices against it, the projection sweep, and one bound per class (attainable domain judged, every-pair domain reported). */
function boundItems({ perSpec, ctx, add }) {
  const sweeps = ctx.cost?.sweeps;
  if (!sweeps?.length) { add('cost:sweep', 'both', 'UNMEASURED', 'no read-cost sweep was run for this cell'); return []; }
  const bySpec = new Map(perSpec.map((s) => [s.name, ctx.cost.bySpec[s.name]]));
  const uniq = [...new Map(sweeps.map((w) => [w.key, w])).values()];
  add('cost:sweep', 'jsnes', uniq.every((w) => w.gotoCInvariant && w.locTInvariant) ? 'PASS' : 'FAIL', `${uniq.length} distinct kernel layout(s), every (current, target) pair of the ${uniq.map((w) => w.n).join('/')}-screen ring called through sw_peek_byte (Y=0 and Y=255), sw_goto and sw_locate_current: goto cost independent of the current screen: ${uniq.every((w) => w.gotoCInvariant)}, locate cost independent of the target: ${uniq.every((w) => w.locTInvariant)}; dearest peek ${Math.max(...uniq.map((w) => w.stats.peekHi.all.cycles))} cycles over all pairs, ${Math.max(...uniq.map((w) => w.stats.peekHi.adj.cycles))} ring-adjacent; digests ${uniq.map((w) => w.digest.slice(0, 10)).join(',')}`);
  for (const emu of ctx.emus) {
    let chk = { g: 0, l: 0, p: 0 }, bad = [], nonAdj = [], oob = [];
    for (const sp of perSpec) {
      const sw = bySpec.get(sp.name)?.sweep;
      if (!sw) continue;
      const r = checkEventPrices(sp[emu]?.rows ?? [], sw);
      for (const k of ['g', 'l', 'p']) chk[k] += r.checked[k];
      bad.push(...r.mismatches); nonAdj.push(...r.nonAdjacent); oob.push(...r.outOfDomain);
    }
    add(`cost:events`, emu, bad.length || nonAdj.length || oob.length || !(chk.g && chk.l && chk.p) ? 'FAIL' : 'PASS', `${chk.g} sw_goto, ${chk.l} sw_locate_current and ${chk.p} sw_peek_byte events priced at their own coordinates: ${bad.length} differ from the sweep${bad[0] ? ` (${bad[0]})` : ''}, ${nonAdj.length} non-adjacent pairs${nonAdj[0] ? ` (${nonAdj[0]})` : ''}, ${oob.length} outside the swept domain`);
  }
  const projs = [...new Map(perSpec.map((s) => bySpec.get(s.name)?.proj).filter(Boolean).map((p) => [p.key, p])).values()];
  if (!projs.length) { add('cost:proj', 'jsnes', 'UNMEASURED', 'no projection sweep'); return []; }
  const pj = projs.reduce((m, p) => ({ ...m, ...Object.fromEntries(Object.entries(p.projection).map(([k, v]) => [k, Math.max(m[k]?.max ?? 0, v.max) === v.max ? v : m[k]])) }), {});
  const jr = allRows(perSpec, 'jsnes');
  const obsPx = Math.max(0, ...jr.map((r) => r.prof?.calls?.px?.max ?? 0)), obsPy = Math.max(0, ...jr.map((r) => r.prof?.calls?.py?.max ?? 0));
  const swPx = Math.max(pj.sw_oam_project_x.max, pj.sw_oam_project_tile_x.max), swPy = Math.max(pj.sw_oam_project_y.max, pj.sw_oam_project_tile_y.max);
  add('cost:proj', 'jsnes', obsPx <= swPx && obsPy <= swPy && obsPx > 0 ? 'PASS' : 'FAIL', `exhaustive over every branch class: sw_project_axis max ${pj.sw_project_axis.max} (min ${pj.sw_project_axis.min}), sw_oam_project_x ${pj.sw_oam_project_x.max}, _tile_x ${pj.sw_oam_project_tile_x.max}, sw_oam_project_y ${pj.sw_oam_project_y.max}, _tile_y ${pj.sw_oam_project_tile_y.max}, sw_oam_rowbase ${pj.sw_oam_rowbase.max}; the dearest observed call (x ${obsPx}, y ${obsPy}) is <= its swept maximum; the player's 4 tiles x 2 axes ceiling = ${projCeiling(pj)}`);
  if (!ctx.emus.includes('mesen') || !ctx.emus.includes('jsnes')) { add('bound', 'mesen', 'UNMEASURED', 'the bound pairs each Mesen body (G, nmiT, read events) with its jsnes body (profile): both emulators are required'); return []; }
  const prices = cellPrices(uniq);
  const pairs = pairBodies(perSpec);
  const res = classBounds({ pairs, ceiling: READ_CEILING, prices, allows: gateAllows, projSweep: pj, passCeiling: ctx.passCeiling ?? PASS_CEILING });
  ctx.boundOut = { prices, nmiMax: res.nmiMax, drawPass: res.drawPass, projCeiling: projCeiling(pj), byClass: res.byClass, pairs: pairs.length, unpairedBodies: res.unpaired, certification: 'uncertified-estimate', sampledTerms: SAMPLED_TERMS };
  // ROUND 3 (Chris's option A, review 2 finding 1): the class bound is an ESTIMATE composed of sampled maxima, never a certified bound. It is reported as UNCERTIFIED when it fits and FAILS when it does not (or
  // undercuts a measured G, or a body ran more OAM passes than the source ceiling): never PASS. Its distance from the gate is not certified slack.
  add('bound:certification', 'mesen', 'UNCERTIFIED', `the class bounds below are ${UNCERTIFIED_LABEL}: the remainder (max over every sampled body of the class), the per-pass entity draw (max over every sampled body) and the releasing NMI (max over the cell's bodies) are sampled maxima, so a scene with a worse remainder, draw or NMI than the variants sampled would not be seen. NOT CLAIMED: a proof for those terms, certified slack against ${GATE}, or any bound for an unsampled project. The reads (source count x exhaustive price) and the player projection (source pass count x exhaustive per-routine maxima) are the only terms with a source basis. The MEASURED Mesen G of every class keeps its own gate verdict.`);
  for (const [c, b] of Object.entries(res.byClass)) {
    const [pk, gt_] = READ_CEILING[c] ?? [0, 0];
    const why = [!gateAllows(b.bound.adj) ? `estimate ${b.bound.adj} is not < ${GATE}: NOT a measured overrun, the sampled-term estimate does not fit (no lever applied)` : '', b.undercut ? `the estimate ${b.bound.adj} is BELOW the worst measured G ${b.maxG}: it is not an upper bound of its own sample` : '', ...b.passViolations.slice(0, 2)].filter(Boolean);
    add(`bound:${c}`, 'mesen', b.ok ? 'UNCERTIFIED' : 'FAIL', `${b.ok ? `${UNCERTIFIED_LABEL}, ` : 'ESTIMATE REFUSED, '}${b.nPaired} decomposed bodies: NMI ${res.nmiMax} (sampled) + remainder ${b.remMax} (sampled max) + reads ${b.reads.adj} (${pk} peeks x ${prices.adj.peek} + ${Math.max(0, gt_ - pk)} arm(s) x (${prices.adj.goto} goto + ${prices.adj.loc} restore): exhaustive, ring-adjacent) + ${b.passes} OAM pass(es) (source ceiling) x (player projection ${b.projPass} + entity draw ${res.drawPass.cycles} per pass, sampled) = ${b.projCeil} + ${b.drawCeil} => ${b.formula.adj}${b.n - b.nPaired ? `; ${b.n - b.nPaired} bodies with no exactly-equal jsnes counterpart bounded as themselves (own G + unmade ceiling reads): worst ${b.unpairedMax.cycles} at ${b.unpairedMax.at}` : ''}; class estimate ${b.bound.adj}${why.length ? ` -- ${why.join('; ')}` : ''}; every-pair reads ${b.reads.all} give ${b.bound.all} (${b.okAll ? `< ${GATE}` : `not < ${GATE}`}; unattained, reported, not judged); worst measured G ${b.maxG}`);
  }
  return [];
}
export const summary = (items) => items.reduce((o, i) => { o[i.status] = (o[i.status] ?? 0) + 1; return o; }, {});
