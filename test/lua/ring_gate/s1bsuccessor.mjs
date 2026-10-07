// The judge-only successor's judgement of ONE record (round 4: review 3's blocking finding, "successor soundness"). Pure: record JSON + decoded retained bodies in, items and refusals out.
//
// The successor may do exactly three things to a pre-triage (as-run) record: remove its agree:bodies / agree:chase / agree:reported items, add the items the triage ruling defines (agree:bodies, agree:chase,
// agree:dsp, agree:reported, sanity:dsp per emulator, all re-derived by the SAME s1bjudge.agreementItems the judge uses) and recompute the verdict those items can move. It does so only after the
// predecessor is RECONSTRUCTED: the as-run judge's full comparison (dsp INCLUDED, compareBodies(..., { ignore: [] })) is re-run on the retained bodies and the three recorded items must equal
// the reconstruction word for word, status included. A record that does not reconcile -- a missing required item, a malformed or extra one, a recorded count or list the bodies do not reproduce -- is
// REFUSED: no item is removed, the verdict is not touched, and the caller reports a problem and exits nonzero.
import { compareBodies, dspRangeFailures, NMI_TOLERANCE, DIVERGENT_SPECS } from './s1bagree.mjs';
import { agreementItems, estimateRefusal, summary } from './s1bjudge.mjs';

/** The items a successor owns; an original must carry the first three (or none) and never the rest. */
export const PREDECESSOR_IDS = ['agree:bodies', 'agree:chase', 'agree:reported'];
const SUCCESSOR_ONLY = ['agree:dsp', 'sanity:dsp'];

/**
 * The as-run (pre-triage) comparison rule: every counter INCLUDING dsp is compared, and inside a DECLARED-DIVERGENT spec (chase) a phase is divergent only when some body differs in something other than dsp
 * (a phase whose every difference is dsp is an ordinary mismatch); the dsp discrepancies listed are the bodies whose ONLY difference is dsp (any phase). Reconstructed from the as-run records, which it must reproduce
 * exactly -- there is no saved copy of the as-run judge.
 */
export const preTriageCompare = (perSpec) => compareBodies(perSpec, { predecessor: true });

/** The as-run (pre-triage) wording of the three agreement items. Kept verbatim: the recorded details are reconciled against it by equality. */
export function predecessorItems(perSpec, cmpr = preTriageCompare(perSpec)) {
  const dv = cmpr.divergent.map((d) => `${d.spec}/${d.phase} (${d.differ}/${d.bodies} bodies differ, agreeing prefix ${d.agreeingPrefix}; first: ${d.first})`);
  const out = {};
  out['agree:bodies'] = { status: cmpr.mismatches.length || cmpr.unpaired.length || !cmpr.compared ? 'FAIL' : 'PASS',
    detail: `${cmpr.compared} bodies of ${cmpr.phases - cmpr.synthetic.length} phases in ${cmpr.specs} specs compared one to one (class, every counter, every read event, game_state, end state): ${cmpr.exact} phases exactly equal, ${cmpr.divergent.length} phases of declared-divergent specs EXCLUDED from this verdict (UNCERTIFIED: item agree:chase), ${cmpr.c0Length.length} phases whose length differs by a C0 body's whole-frame duration difference between the cores (${cmpr.c0Length.join('; ') || 'none'}), ${cmpr.mismatches.length} UNACCEPTED mismatches (no counter is skew-tolerated any more: a body that differs in dsp only is a mismatch like any other; ${cmpr.dsp.plain.length} such bodies are listed by name in agree:reported)${cmpr.mismatches[0] ? ` (first ${cmpr.mismatches[0].at}: ${cmpr.mismatches[0].diffs.slice(0, 3).join(', ')})` : ''}, ${cmpr.unpaired.length} phases with unequal body counts${cmpr.unpaired[0] ? ` (${cmpr.unpaired[0]})` : ''}; nmiT within +-${NMI_TOLERANCE} on agreeing bodies; Mesen G - jsnes cyc over equal bodies in [${cmpr.timing.gMinusCyc.min}, ${cmpr.timing.gMinusCyc.max}]` };
  if (perSpec.some((x) => x.name in DIVERGENT_SPECS && x.mesen?.rows && x.jsnes?.rows)) out['agree:chase'] = { status: cmpr.divergent.length ? 'UNCERTIFIED' : 'PASS',
    detail: cmpr.divergent.length ? `UNCERTIFIED: the chase / knockback cross-check of the jsnes counters is NOT established for this cell -- ${cmpr.divergent.length} phase(s) leave lockstep between the cores (${dv.join(' | ')}) and no deterministic damaging-chaser witness was built (Chris's option A); a jsnes counter disagreeing with Mesen inside them is not detected. Each emulator's bodies still face every per-body sanity rule on their own.` : 'every phase of the damaging-chaser spec stays in lockstep and is compared exactly in agree:bodies' };
  out['agree:reported'] = { status: 'PASS', detail: `not compared (reported): ${cmpr.synthetic.length} phases whose Mesen bodies carry the template's SYNTHETIC pokes (${cmpr.synthetic.join(', ') || 'none'}); OBSERVED dsp discrepancies (${cmpr.dsp.plain.length} bodies, each also an unaccepted mismatch above) ${cmpr.dsp.plain.join(' | ') || 'none'}; divergent ${dv.join(' | ') || 'none'}` };
  return out;
}

/** The synthetic-poke phases (the Lua template's pokes; not retained with the bodies) as the as-run record named them: `spec/phase (n bodies), ...`. null when the item is malformed. */
export function recordedSynthetic(reportedDetail) {
  const m = /^not compared \(reported\): (\d+) phases whose Mesen bodies carry the template's SYNTHETIC pokes \((.*?)\); OBSERVED dsp discrepancies \(/.exec(reportedDetail ?? '');
  if (!m) return null;
  if (m[2] === 'none') return +m[1] === 0 ? [] : null;
  const parts = m[2].split(/, (?=[^\s/(),]+\/[^\s(),]+ \(\d+ bodies\))/).map((p) => /^([^\s/(),]+)\/([^\s(),]+) \((\d+) bodies\)$/.exec(p));
  if (parts.some((x) => !x) || parts.length !== +m[1]) return null;
  return parts.map((x) => ({ spec: x[1], phase: x[2], bodies: +x[3] }));
}

const firstDiff = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return `at char ${i}: recorded "${a.slice(Math.max(0, i - 20), i + 40)}" / reconstructed "${b.slice(Math.max(0, i - 20), i + 40)}"`; };

/**
 * Judge one record. `bodies` = the decoded retained bodies [{ name, romSha256, mesen: rows[], jsnes: rows[] }]. Returns { ok, reasons[], items, fresh, counts, verdictOk, rule, reconcile, refused }.
 * `ok: false` means REFUSED: items / verdictOk / counts are the record's own, untouched.
 */
export function rejudgeRecord(rec, bodies) {
  const reasons = [];
  const refuse = (why) => reasons.push(why);
  const orig = rec.items;
  const result = (extra = {}) => ({ ok: !reasons.length, reasons, items: orig, fresh: [], counts: rec.counts, verdictOk: rec.verdictOk, rule: 'REFUSED (reconciliation failed); record and verdict left exactly as recorded', ...extra });
  if (!Array.isArray(orig)) { refuse('the record has no items array'); return result(); }
  if (!Array.isArray(bodies)) { refuse('the retained bodies are not a list'); return result(); }
  // ---- the recorded emulator/spec context
  const names = new Set(bodies.map((b) => b.name));
  const recSpecs = (rec.perSpec ?? []).map((s) => s.name);
  if (recSpecs.length !== bodies.length || recSpecs.some((n) => !names.has(n))) refuse(`the record's specs (${recSpecs.length}) are not the retained bodies' specs (${bodies.length})`);
  else for (const s of rec.perSpec) if (bodies.find((b) => b.name === s.name).romSha256 !== s.romSha256) refuse(`spec ${s.name}: the retained bodies' ROM hash is not the record's`);
  const rows = (b, e) => (Array.isArray(b[e]) ? b[e] : null);
  const emusWithRows = ['mesen', 'jsnes'].filter((e) => bodies.some((b) => rows(b, e)?.length));
  const bothSpecs = bodies.filter((b) => rows(b, 'mesen')?.length && rows(b, 'jsnes')?.length);
  const chaseCompared = bothSpecs.some((b) => b.name in DIVERGENT_SPECS);
  const emusInItems = new Set(orig.map((i) => i.emu).filter((e) => e === 'mesen' || e === 'jsnes'));
  for (const e of emusWithRows) if (!emusInItems.has(e)) refuse(`${e} bodies are retained but the record carries no ${e} item`);
  // ---- the required predecessor items, before anything is removed
  const count = (id) => orig.filter((i) => i.id === id).length;
  const want = bothSpecs.length ? [...PREDECESSOR_IDS.filter((id) => id !== 'agree:chase' || chaseCompared)] : [];
  for (const id of PREDECESSOR_IDS) if (count(id) !== (want.includes(id) ? 1 : 0)) refuse(`${id}: ${count(id)} recorded, ${want.includes(id) ? 1 : 0} required (${bothSpecs.length} specs carry both emulators' bodies${id === 'agree:chase' ? `, chase ${chaseCompared ? 'among them' : 'not among them'}` : ''})`);
  for (const id of SUCCESSOR_ONLY) if (count(id)) refuse(`${id} is already recorded: a successor-only item in an as-run record`);
  const unknown = orig.filter((i) => /^agree:/.test(i.id) && !PREDECESSOR_IDS.includes(i.id));
  if (unknown.length) refuse(`unknown agreement items: ${unknown.map((i) => i.id).join(', ')}`);
  if (reasons.length) return result();
  // ---- reconstruct the pre-triage comparison and reconcile
  const syn = want.length ? recordedSynthetic(orig.find((i) => i.id === 'agree:reported')?.detail) : [];
  if (syn === null) { refuse('agree:reported is malformed: its synthetic-poke phases cannot be read'); return result(); }
  const perSpec = bodies.map((b) => {
    const mine = syn.filter((x) => x.spec === b.name);
    for (const x of mine) { const n = (rows(b, 'mesen') ?? []).filter((r) => r.phase === x.phase).length; if (n !== x.bodies) refuse(`synthetic ${x.spec}/${x.phase}: recorded ${x.bodies} Mesen bodies, retained ${n}`); }
    return { name: b.name, script: mine.map((x) => ({ name: x.phase, mode: 'synthetic' })), mesen: rows(b, 'mesen') ? { rows: rows(b, 'mesen') } : null, jsnes: rows(b, 'jsnes') ? { rows: rows(b, 'jsnes') } : null };
  });
  if (reasons.length) return result();
  const recon = { reconstructed: null };
  if (want.length) {
    const pre = predecessorItems(perSpec);
    recon.reconstructed = Object.fromEntries(Object.entries(pre).map(([id, v]) => [id, v.status]));
    for (const id of want) {
      const rec1 = orig.find((i) => i.id === id), exp = pre[id];
      if (rec1.emu !== 'both') refuse(`${id}: emulator "${rec1.emu}" recorded, "both" required`);
      if (rec1.status !== exp.status) refuse(`${id}: status ${rec1.status} recorded, ${exp.status} reconstructed from the retained bodies`);
      if (rec1.detail !== exp.detail) refuse(`${id}: the recorded detail does not match the reconstructed pre-triage comparison (${firstDiff(String(rec1.detail), exp.detail)})`);
    }
  }
  if (reasons.length) return result();
  // ---- the authorized successor transformation
  const kept = orig.filter((i) => !PREDECESSOR_IDS.includes(i.id));
  const fresh = [];
  const add = (id, emu, status, detail) => fresh.push({ id, emu, status, detail });
  if (want.length) {
    agreementItems(perSpec, add);
    // the authorized split, checked against the reconstruction: the old mismatches minus those that differ in dsp ONLY are the new ones
    const full = preTriageCompare(perSpec), split = compareBodies(perSpec);
    const dspOnly = full.mismatches.filter((m) => m.diffs.every((d) => d.startsWith('dsp '))).length;
    if (split.mismatches.length !== full.mismatches.length - dspOnly || split.divergent.length !== full.divergent.length || split.unpaired.length !== full.unpaired.length || split.compared !== full.compared) refuse(`the dsp split is not the only difference: ${full.mismatches.length} pre-triage mismatches, ${dspOnly} dsp-only, ${split.mismatches.length} after the split`);
    recon.split = { preTriageMismatches: full.mismatches.length, dspOnly, afterSplit: split.mismatches.length, dspBodies: full.dsp.plain.length };
  }
  for (const emu of emusWithRows) {
    const dr = dspRangeFailures(perSpec, emu);
    add('sanity:dsp', emu, dr.length ? 'FAIL' : 'PASS', dr.length ? `${dr.length} bodies whose park-split count is out of range (first ${dr[0]}): 0 <= dsp <= dst must hold in each emulator on its own` : `every body: dst and dsp are nonnegative integers with dsp <= dst (0 <= dsp <= dst, checked in this emulator alone). This does NOT certify an in-range wrong or dead dsp hook: the cross-core equality of dsp is agree:dsp, UNCERTIFIED`);
  }
  const ids = fresh.map((i) => `${i.emu}:${i.id}`);
  if (new Set(ids).size !== ids.length) refuse(`duplicate successor items: ${ids.join(', ')}`);
  if (reasons.length) return result();
  const items = [...kept, ...fresh];
  const counts = summary(items);
  const anyFail = items.some((i) => i.status === 'FAIL' || i.status === 'UNMEASURED');
  let verdictOk = rec.verdictOk, rule = 'carried as recorded (the changed items cannot move this verdict)', refused;
  if (rec.expect === 'pass') { verdictOk = !anyFail; rule = 'positive: no FAIL / UNMEASURED item'; }
  else if (rec.expect === 'bound-fail') {
    const ctl = { numeric: Array(rec.gateFailures ?? 0).fill(null), operational: Array.isArray(rec.operationalFailures) ? rec.operationalFailures : Array(rec.operationalFailures ?? 0).fill(null) };
    const r = estimateRefusal(items, ctl, rec.bound);
    verdictOk = !!rec.sabotage && r.ok; refused = r.refused;
    rule = `sampled estimate refusal (s1bjudge.estimateRefusal)${r.ok ? '' : `: NOT CAUGHT -- ${r.why.join('; ')}`}`;
  }
  return { ok: true, reasons, items, fresh, counts, verdictOk, rule, refused, reconcile: recon };
}
