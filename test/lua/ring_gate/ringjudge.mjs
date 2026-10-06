// The judge: takes one emulator-recorded checkpoint and decides it against the oracle (test/lib/ringoracle.js). The recorders (jsnes here,
// Mesen's Lua) only RECORD: player state, camera registers, the PPUCTRL nametable select, the dialogue progress bytes and the live NTs +
// their mirror aliases as read through the board's mirroring. Every verdict is made here, in one place, for both emulators.
//
// TWO verdicts, reported separately (a run can be byte-perfect and still not have covered its scenario, or the reverse):
//   judge(rec, ctx)                      the VRAM/attribute verdict of one record
//   judgeCoverage(records, expect, ctx)  did the run actually do what its scenario declares (screens, crossings, live NTs, dialogues)
//
// What the dialogue check does NOT cover: the canonical bus address of a write. Both recorders read through the board's mirroring, so an
// engine that wrote a box through a mirror ALIAS ($2800 for $2000 on vertical) is indistinguishable from one that wrote the live NT. Alias
// equality (`aliasMismatches`) proves the mirroring is the cell's, not which address was written. Closing that would take a PPU write trace;
// S1a does not have one, and no check here claims it.
import { ringExpected, boxFootprint, typedSoFar, diffAgainst, aliasMismatches, displayedLiveIndex, RING_LIVE_NTS, NT_BASE } from '../../lib/ringoracle.js';
import { wrapText } from '../../../shared/font.js';
import { witnessFailures } from './ringwitness.mjs';

/** rec.vram is { [addr]: Uint8Array|number[] } keyed by 0x2000/0x2400/0x2800/0x2c00 -> 1024 bytes each. */
export const readerOf = (vram) => (addr) => vram[addr & 0x2c00][addr & 0x3ff];

/** The text of the `enter` talker on the streamed map's screen (sw_row * gridW + sw_col) -- the project's own data. */
export function talkerText(project, gridW, col, row) {
  const screen = project.maps[0].screens[row * gridW + col];
  const ent = screen?.entities?.find((e) => e.props?.event?.pages?.[0]?.commands?.[0]?.op === 'say');
  return ent ? ent.props.event.pages[0].commands[0].text : null;
}

/** The dialogue nudge floors the camera to its 16 px boundary on each axis independently (docs/design-streamed-worlds.md section 7). */
const nudged = (camera) => ({ nt: camera.cam_nt, x: camera.cam_x_lo & 0xf0, y: camera.cam_y_lo & 0xf0 });

/** The progress counters of a typing record against the compiled first page and the scenario's declared prefix. */
export function typingProgressFailures(s, text, declared) {
  const fails = [];
  const page = wrapText(text ?? '')[0] ?? [];
  const last = page.length - 1;
  if (!declared) fails.push('the scenario declares no typing prefix for a typing record');
  if (!(Number.isInteger(s.msg_line) && s.msg_line >= 0 && s.msg_line <= last)) fails.push(`msg_line ${s.msg_line} is outside the compiled first page (${page.length} text line(s))`);
  else {
    const len = page[s.msg_line].length;
    if (!(s.msg_col >= 1 && s.msg_col <= len)) fails.push(`msg_col ${s.msg_col} is outside text line ${s.msg_line} (${len} glyphs)`);
    if (s.msg_line === last && s.msg_col >= len) fails.push(`typing record with the whole first page typed (msg_line ${s.msg_line}, msg_col ${s.msg_col} of ${len}): a complete page is not a partial typing observation`);
  }
  if (declared) {
    if (s.msg_line !== declared.line) fails.push(`msg_line ${s.msg_line}, the scenario declares typing on line ${declared.line}`);
    if (!(s.msg_col >= declared.minCol && s.msg_col <= declared.maxCol)) fails.push(`msg_col ${s.msg_col} is outside the declared typing prefix ${declared.minCol}..${declared.maxCol}`);
  }
  return fails;
}

/**
 * Judges one record. ctx: { project, ring, gridW, gridH, typing } (`typing` = the scenario's declared partial typing prefix, ringscene.mjs
 * TYPING; mandatory for a typing record). Returns { label, ok, fails: [...], boxNts?: [liveIdx...] }.
 *   kind 'settled':    live NTs == oracle, camera registers == the camera rule, aliases agree, displayed NT live, strip idle.
 *   kind 'dlg-typing': as 'dlg-open' with the glyphs typed so far (msg_line/msg_col), BYTE-EXACT; the one cell the engine may still have queued
 *                      (vram_len != 0) is accepted either way. The progress counters themselves are bounded: msg_line inside the compiled first
 *                      page, msg_col inside that line, short of the whole page, and inside the scenario's declared prefix -- so neither an
 *                      impossible counter nor a COMPLETE page can stand in for the partial typing observation the scenario requires.
 *   kind 'dlg-open':   the whole box -- border, interior, text, arrow, extent -- and the attribute quadrants under it, BYTE-EXACT in both live
 *                      NTs, at the camera the dialogue's own nudge floors to; the camera/display/state checks hold while it is open.
 */
export function judge(rec, ctx) {
  const { project, ring, gridW, gridH } = ctx;
  if (rec.kind === 'hold') return { label: rec.label, ok: true, fails: [] }; // a hold is judged by judgeCoverage
  const fails = [];
  const read = readerOf(rec.vram);
  const s = rec.state;
  const player = { col: s.sw_col, row: s.sw_row, px: s.player_x, py: s.player_y };
  const alias = aliasMismatches(read, ring);
  if (alias.length) fails.push(`mirror alias differs: $${alias[0].alias.toString(16)} vs $${alias[0].live.toString(16)} (the cell's mirroring is not the one under test)`);
  const dialogue = rec.kind === 'dlg-open' || rec.kind === 'dlg-typing';
  const base = ringExpected({ project, ring, gridW, gridH, player });
  const camera = base.camera;
  let exp = base;
  let boxNts;
  let alt = null;
  if (dialogue) {
    const text = talkerText(project, gridW, s.sw_col, s.sw_row);
    if (text === null) fails.push(`no talker text on screen (${s.sw_col},${s.sw_row}): a dialogue is open where the project has none`);
    const open = rec.kind === 'dlg-open';
    if (open && ![3, 6].includes(s.box_state)) fails.push(`box_state ${s.box_state} at a typed checkpoint (page-wait 3 / end-wait 6)`);
    if (!open && s.box_state !== 2) fails.push(`box_state ${s.box_state} at a typing checkpoint (typing 2)`);
    if (s.game_state !== 2) fails.push(`game_state ${s.game_state} while a dialogue is open (2)`);
    const cam = nudged(camera);
    const typedAt = (col) => (open ? { lines: typedSoFar(text ?? '', 99, 99).lines } : typedSoFar(text ?? '', s.msg_line, col));
    const make = (col) => boxFootprint({ ring, cam, typed: typedAt(col), arrow: open });
    const box = make(s.msg_col);
    boxNts = [...box.nts];
    exp = ringExpected({ project, ring, gridW, gridH, player, box });
    if (!open && s.vram_len !== 0 && s.msg_col > 0) alt = ringExpected({ project, ring, gridW, gridH, player, box: make(s.msg_col - 1) });
    if (!open && s.msg_col < 1) fails.push('typing checkpoint with no glyph typed');
    if (!open) fails.push(...typingProgressFailures(s, text, ctx.typing));
    if (s.cam_x_lo !== cam.x) fails.push(`dialogue camera x ${s.cam_x_lo}, the 16 px floor of the camera rule's ${camera.cam_x_lo} is ${cam.x}`);
    if (s.cam_y_lo !== cam.y) fails.push(`dialogue camera y ${s.cam_y_lo}, the 16 px floor of the camera rule's ${camera.cam_y_lo} is ${cam.y}`);
  } else {
    if (s.cam_x_lo !== camera.cam_x_lo) fails.push(`cam_x_lo ${s.cam_x_lo}, camera rule wants ${camera.cam_x_lo}`);
    if (s.cam_y_lo !== camera.cam_y_lo) fails.push(`cam_y_lo ${s.cam_y_lo}, camera rule wants ${camera.cam_y_lo}`);
  }
  let bad = diffAgainst(read, exp, ring, { limit: 100000 });
  if (alt) { const other = new Set(diffAgainst(read, alt, ring, { limit: 100000 }).map((b) => b.addr)); bad = bad.filter((b) => other.has(b.addr)); }
  for (const b of bad.slice(0, 8)) fails.push(`${b.where} @$${b.addr.toString(16)}: got ${b.got}, want ${b.want}`);
  if (bad.length > 8) fails.push(`... ${bad.length} bytes differ in all`);
  if (s.cam_nt !== camera.cam_nt) fails.push(`cam_nt ${s.cam_nt}, camera rule wants ${camera.cam_nt}`);
  // The display: the PPUCTRL select, seen through the mirroring, must show the live NT the camera rule picks. A horizontal-ring Shake may
  // select index 1/3 transiently (an alias of live 0/2): accepted, because after mirroring it is the same NT.
  if (displayedLiveIndex(ring, s.ppuctrl_nt) !== displayedLiveIndex(ring, camera.cam_nt)) fails.push(`PPUCTRL shows live NT ${displayedLiveIndex(ring, s.ppuctrl_nt)} (select ${s.ppuctrl_nt}), the camera rule wants live NT ${displayedLiveIndex(ring, camera.cam_nt)}`);
  if (s.st_active !== 0) fails.push(`strip still active (st_active=${s.st_active}) at ${rec.kind} checkpoint`);
  return { label: rec.label, ok: !fails.length, fails, boxNts };
}

/**
 * The records a run produced, as the ordered ids the scenario's `sequence` declares: one id per check, per hold and per COMPLETE dialogue
 * transaction (typing -> open -> closed, consecutive, one label prefix). A transaction missing a stage, or opened by nobody's declaration (a
 * `~unexpected` prefix), is an id of its own that no scenario declares, so it fails as missing + unexpected.
 */
export function observedSequence(records, gridW) {
  const obs = [];
  const prefixOf = (l) => l.slice(0, l.lastIndexOf(':'));
  const isStage = (r) => /:(typing|open|closed)$/.test(r.label) && (r.kind === 'dlg-typing' || r.kind === 'dlg-open' || (r.kind === 'settled' && r.label.endsWith(':closed')));
  for (let i = 0; i < records.length; ) {
    const r = records[i];
    if (r.kind === 'shake-frame') { i++; continue; } // a variable number of quiet frames inside one shake hold: witnessed, not sequenced
    if (r.kind === 'hold') { obs.push({ id: `hold:${r.label}`, label: r.label }); i++; continue; }
    if (isStage(r)) {
      const prefix = prefixOf(r.label);
      const stages = [];
      let open = null;
      for (; i < records.length && isStage(records[i]) && prefixOf(records[i].label) === prefix; i++) {
        stages.push(records[i].label.slice(prefix.length + 1));
        if (records[i].kind === 'dlg-open') open = records[i];
      }
      const at = (open ?? r).state;
      const screen = at ? at.sw_row * gridW + at.sw_col : '?';
      const whole = stages.join('>') === 'typing>open>closed' && !prefix.endsWith('~unexpected');
      obs.push({ id: whole ? `dialogue@${screen}` : `dialogue@${screen}(${prefix.endsWith('~unexpected') ? 'unexpected ' : ''}stages ${stages.join('>')})`, label: prefix });
      continue;
    }
    obs.push({ id: `check:${r.label}`, label: r.label });
    i++;
  }
  return obs;
}
export const declaredSequenceIds = (sequence) => sequence.map((e) => (e.t === 'dialogue' ? `dialogue@${e.screen}` : `${e.t}:${e.t === 'hold' ? e.label : e.label}`));

/**
 * The scenario's declared sequence against the observed one: missing, duplicate, unexpected and reordered mandatory records each fail by name.
 * A scenario with no declared sequence fails (a scenario cannot opt out of the requirement).
 */
export function sequenceFailures(records, sequence, gridW) {
  if (!Array.isArray(sequence) || !sequence.length) return ['the scenario declares no record sequence'];
  const fails = [];
  const want = declaredSequenceIds(sequence);
  const got = observedSequence(records, gridW).map((o) => o.id);
  const count = (a) => a.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map());
  const [cw, cg] = [count(want), count(got)];
  let setDiff = false;
  for (const id of new Set([...cw.keys(), ...cg.keys()])) {
    const [w, g] = [cw.get(id) ?? 0, cg.get(id) ?? 0];
    if (g < w) { fails.push(`missing mandatory record ${id}${w - g > 1 ? ` (x${w - g})` : ''}`); setDiff = true; }
    else if (g > w) { fails.push(w === 0 ? `unexpected record ${id}` : `duplicate record ${id} (observed ${g}, declared ${w})`); setDiff = true; }
  }
  if (!setDiff) {
    const k = want.findIndex((id, i) => id !== got[i]);
    if (k >= 0) fails.push(`reordered records: position ${k} declares ${want[k]}, observed ${got[k]}`);
  }
  return fails;
}

/**
 * The coverage verdict. records: a run's records in order; expect: the scenario's declaration (ringscene.mjs); ctx as for judge().
 * Every declared quantity is checked; a missing or malformed record fails. Returns { ok, fails, seen }.
 */
export function judgeCoverage(records, expect, ctx) {
  const fails = [];
  const { gridW, ring } = ctx;
  const known = new Set(['settled', 'dlg-typing', 'dlg-open', 'hold', 'shake-frame']);
  for (const r of records) if (!known.has(r.kind)) fails.push(`record ${r.label}: unknown kind ${r.kind}`);
  for (const r of records) if (r.kind !== 'hold' && (!r.state || !r.vram)) fails.push(`record ${r.label}: no state/vram`);
  if (!records.length) fails.push('no records at all');
  const holds = records.filter((r) => r.kind === 'hold');
  if (holds.length !== expect.holds) fails.push(`${holds.length} holds recorded, scenario declares ${expect.holds}`);
  for (const h of holds) {
    if ((expect.walls ?? []).includes(h.label)) { if (h.hold?.reached || h.hold?.why !== 'blocked') fails.push(`wall hold ${h.label} was not stopped by the wall (${h.hold?.why}, world ${h.hold?.pos})`); }
    else if (!h.hold?.reached) fails.push(`hold ${h.label} did not reach its target (${h.hold?.why}, stopped at world ${h.hold?.pos})`);
    // a battle must come from the entity slot the scene PLANNED (bt_from_ent on the frame it began); a Continue must land where the previous run saved
    const hd = h.hold;
    if (hd?.entry === 'battle' && hd.expectSlot !== undefined && hd.slot !== hd.expectSlot) fails.push(`battle ${h.label}: contact from entity slot ${hd.slot}, the plan put the monster in slot ${hd.expectSlot}`);
    if (hd?.btn === 'cycle') {
      const here = JSON.stringify(hd.place ?? null), was = JSON.stringify(hd.placeBefore ?? null);
      if (!hd.place || !hd.placeBefore) fails.push(`Continue ${h.label}: no ${!hd.place ? 'landed' : 'pre-cycle'} place recorded, so it cannot be compared with the saved one`);
      else if (here !== was) fails.push(`Continue ${h.label} landed at ${here}, the run before the power cycle ended at ${was}`);
    }
    if (h.hold?.entry && !(h.hold.blanks >= h.hold.minBlanks)) fails.push(`entry ${h.hold.entry} (${h.label}) produced ${h.hold.blanks} blank/quiet-frame observation(s), it needs >= ${h.hold.minBlanks}`);
  }
  const sweep = expect.kind === 'sweep' || expect.kind === 'redraw' || expect.kind === 'shake';
  const flat = (r) => r.state.sw_row * gridW + r.state.sw_col;
  const checks = records.filter((r) => r.kind === 'settled' && /^(cold-boot|fwd@|back@|seam-landing)/.test(r.label));
  const screens = new Set(checks.map(flat));
  if (!sweep) for (const sc of expect.screens) if (!screens.has(sc)) fails.push(`screen ${sc} never visited (visited ${[...screens].sort().join(',')})`);
  let fwd = 0, back = 0;
  for (let i = 1; i < checks.length; i++) { const d = flat(checks[i]) - flat(checks[i - 1]); if (d > 0) fwd += d; else back += -d; }
  if (!sweep && fwd !== expect.forward) fails.push(`${fwd} forward screen crossings, scenario declares ${expect.forward}`);
  if (!sweep && back !== expect.back) fails.push(`${back} return screen crossings, scenario declares ${expect.back}`);
  const live = new Set(checks.map((r) => displayedLiveIndex(ring, r.state.ppuctrl_nt)));
  for (const n of expect.liveNts ?? []) if (!live.has(n)) fails.push(`live NT ${n} never displayed at a checkpoint`);
  const opens = records.filter((r) => r.kind === 'dlg-open');
  const typings = records.filter((r) => r.kind === 'dlg-typing');
  const closes = records.filter((r) => r.kind === 'settled' && r.label.endsWith(':closed'));
  if (opens.length !== expect.dialogues) fails.push(`${opens.length} dialogues opened, scenario declares ${expect.dialogues}`);
  if (typings.length !== expect.dialogues) fails.push(`${typings.length} typing stages observed, scenario declares ${expect.dialogues}`);
  if (closes.length !== expect.dialogues) fails.push(`${closes.length} dialogue closes recorded, scenario declares ${expect.dialogues}`);
  for (const r of typings) for (const f of typingProgressFailures(r.state, talkerText(ctx.project, gridW, r.state.sw_col, r.state.sw_row), ctx.typing)) fails.push(`typing record ${r.label}: ${f}`);
  const boxNts = new Set();
  let seamBoxes = 0;
  for (const r of opens) {
    const v = judge(r, ctx);
    for (const n of v.boxNts ?? []) boxNts.add(n);
    if ((v.boxNts ?? []).length === 2) seamBoxes++;
  }
  for (const n of expect.boxLiveNts) if (!boxNts.has(n)) fails.push(`no dialogue box ever drawn in live NT ${n}`);
  if (expect.boxSeam && !seamBoxes) fails.push('no dialogue box spans both live NTs (the seam-spanning box was not exercised)');
  fails.push(...sequenceFailures(records, expect.sequence, gridW));
  const wf = witnessFailures(records, expect, ctx);
  if (wf.length) fails.push(`${wf.length} required witness(es) not observed: ${wf.slice(0, 6).join('; ')}${wf.length > 6 ? '; ...' : ''}`);
  if (expect.kind === 'lap') {
    const last = checks[checks.length - 1];
    const first = checks[0];
    if (!first || !last || flat(first) !== 0 || flat(last) !== 0) fails.push('the lap did not start and end on world screen 0');
  }
  return { ok: !fails.length, fails, seen: { screens: [...screens], fwd, back, holds: holds.length, dialogues: opens.length, typings: typings.length, boxNts: [...boxNts], seamBoxes, live: [...live] } };
}
