// The content audit of a row 5 / 6 / 8 result (round 2, finding 1). A stamp's summary (status, counts, failed, verdictOk) is a CLAIM about the result file it links; this module reads the
// result's own items and recomputes every claim from them against the CURRENT declarations (s1ccontrols.mjs), so a result that is missing, empty, contradictory or for another run
// cannot be certified by a stamp that says it passed. Pure (no fs, no emulator); the provenance audit (ringprovindex.mjs) and the gate (s1c_gate.mjs) both call it, and the unit
// tests mutate synthetic records against it.
import { CONTROLS, CELL_IDS, MMC3_CELLS, REQUIRED_ITEMS, UNSOUND_IDS, CONTROL_EXIT_OK, BUILDS, controlBuilds, declaredFor, positiveLabel, controlLabel } from './s1ccontrols.mjs';

export const LEGAL_STATUS = ['PASS', 'FAIL', 'UNMEASURED'];
const LABEL = /^s1c-r([568])-(?:ctl-(.+)-)?((?:MMC1|MMC3|U512)-[VH])-(action|rpg)-(resident|banked)$/;

/** A label -> the run it names: { row, cell, gt, placement, control, ring } or null when it is not an S1c run label or is not a run the matrix declares. */
export function decodeLabel(label) {
  const m = LABEL.exec(String(label));
  if (!m) return null;
  const [, row, control, cell, gt, placement] = m;
  const d = { row: Number(row), cell, gt, placement, control: control ?? null, ring: cell.endsWith('-V') ? 1 : 2 };
  if (d.control === null ? label !== positiveLabel(d.row, cell, gt, placement) : (!(d.control in CONTROLS) || label !== controlLabel(d.control, cell, gt, placement))) return null;
  if (d.control !== null && CONTROLS[d.control].row !== d.row) return null;
  if (d.row === 8 && !MMC3_CELLS.includes(cell)) return null;
  if (d.control !== null && !controlBuilds(d.control).some(([g, p]) => g === gt && p === placement)) return null;
  if (!CELL_IDS.includes(cell) || !BUILDS.some(([g, p]) => g === gt && p === placement)) return null;
  return d;
}

/** The declaration a run of `d` answers to: a positive passes everything; a control answers to s1ccontrols.mjs for its ring. */
export const declarationFor = (d) => (d.control === null ? { outcome: 'pass-all' } : declaredFor(d.control, d.ring));

const tally = (items) => items.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] ?? 0) + 1 }), {});
const sameCounts = (a, b) => {
  const ks = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
  return ks.every((k) => (a?.[k] ?? 0) === (b?.[k] ?? 0));
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Recomputes the verdict of `items` under `declared` (the one the run's declaration implies): { ok, why }.
 *   positive (pass-all) / declared pass : no FAIL, no UNMEASURED
 *   declared caught                      : every mustFail item FAILED, and no item of the run itself (UNSOUND_IDS) is anything but PASS
 */
export function recomputeVerdict(items, declared) {
  const failed = items.filter((i) => i.status === 'FAIL').map((i) => i.id);
  const bad = items.filter((i) => i.status !== 'PASS').map((i) => `${i.id}=${i.status}`);
  if (declared.outcome === 'caught') {
    const missing = declared.mustFail.filter((id) => !failed.includes(id));
    const unsound = items.filter((i) => UNSOUND_IDS.includes(i.id) && i.status !== 'PASS').map((i) => `${i.id}=${i.status}`);
    if (unsound.length) return { ok: false, why: `the run itself was unsound (${unsound.join(', ')})` };
    if (missing.length) return { ok: false, why: `declared item(s) ${missing.join(', ')} did not FAIL` };
    return { ok: true, why: '' };
  }
  return bad.length ? { ok: false, why: `${bad.join(', ')} (declared ${declared.outcome === 'pass' ? 'a pass' : 'every item PASS'})` } : { ok: true, why: '' };
}

/**
 * Every problem between a result record, the stamp that links it and the run the label names. `result` null/undefined = the linked result could not be read.
 * Checks: identity (label, row, cell, game type, placement, control), the declaration, the exact required item set without duplicates or extras, legal statuses, the counts, the failed ids
 * and the verdict recomputed from the items (also against the stamp's embedded results[0] summary), the Mesen exit, and agreement between the result and the stamp. A stamped `verdictOk: true` is never trusted: it is compared with the
 * recomputation, and the recomputation itself must succeed.
 */
export function validateS1cResult(result, stamp, label) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(m); };
  const d = decodeLabel(label);
  need(d, `label ${label} names no run the matrix declares`);
  need(result && typeof result === 'object', 'the linked result is missing or unreadable');
  if (!d || !result || typeof result !== 'object') return bad;
  need(result.label === label && stamp?.label === label, `result label ${result.label} / stamp label ${stamp?.label} are not ${label}`);
  for (const [who, rec] of [['result', result], ['stamp', stamp ?? {}]]) {
    need(rec.row === d.row && rec.cell === d.cell && rec.gameType === d.gt && rec.placement === d.placement && (rec.control ?? null) === d.control,
      `${who} identity (row ${rec.row}, ${rec.cell} ${rec.gameType} ${rec.placement}, control ${rec.control ?? null}) is not the run ${label} names`);
  }
  const declared = declarationFor(d);
  need(same(result.declared, declared) && same(stamp?.declared, declared), `the declared outcome in the result/stamp is not the current declaration ${JSON.stringify(declared)}`);
  const items = Array.isArray(result.items) ? result.items : null;
  need(items && items.length > 0, 'the result holds no items (a zero-item result certifies nothing)');
  if (!items?.length) return bad;
  const ids = items.map((i) => i?.id);
  need(items.every((i) => i && typeof i.id === 'string' && typeof i.detail === 'string'), 'an item lacks its id or detail');
  const required = REQUIRED_ITEMS[d.row];
  const dup = [...new Set(ids.filter((id, k) => ids.indexOf(id) !== k))];
  const missing = required.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !required.includes(id));
  need(!dup.length, `duplicate item(s): ${dup.join(', ')}`);
  need(!missing.length, `required item(s) absent: ${missing.join(', ')}`);
  need(!extra.length, `item(s) outside row ${d.row}'s declared set: ${[...new Set(extra)].join(', ')}`);
  const illegal = items.filter((i) => !LEGAL_STATUS.includes(i?.status)).map((i) => `${i?.id}=${i?.status}`);
  need(!illegal.length, `illegal status: ${illegal.join(', ')}`);
  if (illegal.length) return bad;
  const counts = tally(items);
  need(sameCounts(counts, result.counts) && sameCounts(counts, stamp?.counts), `the counts differ from the items: items say ${JSON.stringify(counts)}, result ${JSON.stringify(result.counts)}, stamp ${JSON.stringify(stamp?.counts)}`);
  const failed = items.filter((i) => i.status === 'FAIL').map((i) => i.id);
  need(same([...failed].sort(), [...(result.failed ?? [])].sort()) && same([...failed].sort(), [...(stamp?.failed ?? [])].sort()), `the failed ids differ from the items: items say [${failed}], result [${result.failed}], stamp [${stamp?.failed}]`);
  const v = recomputeVerdict(items, declared);
  need(v.ok, `the items do not meet the declaration: ${v.why}`);
  need(result.verdictOk === v.ok && stamp?.verdictOk === v.ok, `verdictOk contradicts the items: recomputed ${v.ok}, result ${result.verdictOk}, stamp ${stamp?.verdictOk}`);
  // the stamp's EMBEDDED per-scene summary (results[0]) is a third copy of the same claim: it must agree with the items too, so contradictory summaries cannot coexist in one stamp
  const emb = Array.isArray(stamp?.results) && stamp.results.length === 1 ? stamp.results[0] : null;
  need(emb && emb.scene === label && emb.emu === 'mesen' && sameCounts(counts, emb.counts) && emb.verdictOk === v.ok,
    `the stamp's embedded results[0] summary contradicts the items: items say ${JSON.stringify(counts)} verdictOk ${v.ok}, embedded ${JSON.stringify(emb?.counts)} verdictOk ${emb?.verdictOk} (scene ${emb?.scene}, ${stamp?.results?.length ?? 'no'} results)`);
  need(result.mesenStatus === stamp?.mesenStatus, `Mesen exit differs: result ${result.mesenStatus}, stamp ${stamp?.mesenStatus}`);
  need(d.control === null ? result.mesenStatus === 0 : CONTROL_EXIT_OK.includes(result.mesenStatus), `Mesen exit ${result.mesenStatus} is not one ${d.control === null ? 'a positive may end with (0)' : `a control may end with (${CONTROL_EXIT_OK})`}`);
  need(result.romSha256 === stamp?.romSha256 && result.luaSha256 === stamp?.luaSha256 && /^[0-9a-f]{64}$/.test(result.romSha256 ?? '') && /^[0-9a-f]{64}$/.test(result.luaSha256 ?? ''), 'the result and the stamp do not name the same ROM and Lua');
  return bad;
}

/** The label of a control's matching positive (null for a positive or an unreadable label). */
export const positiveLabelOf = (label) => { const d = decodeLabel(label); return d && d.control !== null ? positiveLabel(d.row, d.cell, d.gt, d.placement) : null; };

/** A one-line summary of a validated result for the gate table. */
export const summarize = (result) => `${result.items.length} items, ${tally(result.items).PASS ?? 0} PASS`;
