// Phase 3b S1b rows 2 and 4: one WITNESS RUN = one scripted scene on one ring cell, measured in Mesen (the manifest template: G, plus the executed-path
// counters injected through extraLua) and in jsnes (the same counters, ringcount.runJsnesCounted), every body classified by what it observably executed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runManifest, SCENARIOS, ringScript } from '../run_sw_manifest.mjs';
import { measureMove } from '../run_sw_move_manifest.mjs';
import { luaCounters, luaSyms, luaRam, runJsnesCounted, classify, coexisting, movementProbes, hazardProbes } from './ringcount.mjs';
import { prepareRing } from './ringcli.mjs';
import { ANIM_PRESETS } from '../sw_bound_sweep.mjs';
import crypto from 'node:crypto';
import { GATE, gateAllows } from './s1bjudge.mjs';
import { makeMutate } from '../sw_sweep_mutate.mjs';
import { sweepReads, sweepProjection } from './s1bcost.mjs';

export const SIZES = [2, 2, 2, 2, 2, 2, 2, 2];

/** Mesen rows -> the common row shape of runJsnesCounted ({phase, frame, G, gs, counters, state}). */
export function mesenRows(res) {
  const rows = [];
  for (const [phase, list] of Object.entries(res.counters ?? {})) {
    const evs = new Map((res.events?.[phase] ?? []).map((e) => [e.f, e.ev]));
    for (const r of list) {
      const counters = {}; const state = {};
      for (const [k, v] of Object.entries(r)) { if (k.startsWith('r_')) state[k.slice(2)] = v; else if (!['f', 'G', 'gs', 'fl'].includes(k)) counters[k] = v; }
      rows.push({ phase, frame: r.f, G: r.G, gs: r.gs, fl: r.fl, counters, state, events: evs.get(r.f) ?? [] });
    }
  }
  return rows;
}
export const withClass = (rows) => rows.map((r) => ({ ...r, cls: classify(r.counters), terms: coexisting(r.counters) }));

/** Whether a spec's Move scene first runs a lead-less calibration Mesen session (the one a Say lead's B press is scheduled from). The runner's planned invocation list is derived from THIS. */
export const needsCalibration = (spec) => spec.kind === 'move' && (spec.lead ?? 'none') === 'say' && !spec.script;
/** The Mesen invocations a witness run of `spec` starts, in order: [{ spec, purpose }]. The provenance audits the retained chain against the union of these. */
export const plannedInvocations = (spec) => [...(needsCalibration(spec) ? [{ spec: spec.name, purpose: 'calibration' }] : []), { spec: spec.name, purpose: 'witness' }];
/** The spawn hooks of ONE Mesen invocation: the private environment and the child hook tagged with what the process is for. EVERY spawn of a witness run takes its hooks from here. */
export const ctxFor = (mesenCtx, spec, purpose) => ({ mesenEnv: mesenCtx.mesenEnv, onMesenChild: mesenCtx.onMesenChild ? (child) => mesenCtx.onMesenChild(child, { spec: spec?.name ?? null, purpose }) : undefined });

/** The measured touch body of a ring Move scene: the index (within the measured phase) of the first move_tick body of a lead-less run -- what a lead-Say run's B press is scheduled from. */
export async function calibrateTouchBody({ cellInfo, gt, touchY, dist = 150, mesen, mesenCtx = {}, spec = null }) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-touch-'));
  try {
    const { res } = await measureMove({ gt, tail: 'none', lead: 'none', dist, root: cellInfo.tree.root, ring: cellInfo.ring, pop: 'many-small', tiles: 15, wide: true, touchY, outDir: out, extraLua: luaCounters(), extraSyms: luaSyms(), extraRam: luaRam(), ...ctxFor(mesenCtx, spec, 'calibration'), ...(mesen ? { mesen } : {}) });
    const rows = withClass(mesenRows(res));
    const i = rows.findIndex((r) => r.cls === 'C4b');
    if (i < 0) throw new Error('calibrateTouchBody: the lead-less Move scene never ran a move_tick body');
    return i;
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
}

/**
 * Runs one witness. `spec` = { name, kind: 'manifest'|'move', scenario?, script?, lead?, tail?, dist?, touchY?, pop?, tiles?, flashAt?, sizes?, wide? }.
 * `cellInfo` = prepareRing's result for the cell (tree + ring spec). Returns { name, cell, gt, ring, mesen:{rows,status,frames,boundSyms}, jsnes:{rows,frames,finished} }.
 */
export async function runWitness({ cellInfo, gt, spec, mesen, withJsnes = true, keepDir = null, mesenCtx = {}, onFrame = null, counterFault = null, sweepCache = null, inputDelay = 0 }) {
  const outDir = keepDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ring-witness-'));
  const mapperNo = cellInfo.ring.mapper;
  const common = { extraLua: luaCounters({ fault: counterFault, mapper: mapperNo }), extraSyms: luaSyms(counterFault), extraRam: luaRam(), ...ctxFor(mesenCtx, spec, 'witness') };
  let res;
  if (spec.kind === 'move') {
    const touchBody = needsCalibration(spec) ? await calibrateTouchBody({ cellInfo, gt, touchY: spec.touchY ?? 60, dist: spec.dist ?? 150, mesen, mesenCtx, spec }) : null;
    ({ res } = await measureMove({ gt, tail: spec.tail ?? 'none', lead: spec.lead ?? 'none', dist: spec.dist ?? 150, root: cellInfo.tree.root, ring: cellInfo.ring, pop: spec.pop ?? 'many-small', tiles: spec.tiles ?? 15, wide: spec.wide ?? true, touchY: spec.touchY, touchBody, mesen, outDir, ...(spec.script ? { script: spec.script } : {}), ...common }));
  } else {
    res = await runManifest({ root: cellInfo.tree.root, ring: cellInfo.ring, gt, sizes: spec.sizes ?? SIZES, wide: spec.wide ?? true, scenario: spec.scenario ?? 'walk', nosfx: false, flashAt: (typeof spec.flashAt === 'function' ? spec.flashAt(cellInfo.ring) : spec.flashAt) ?? null, mesen, outDir, ...(spec.phases ? { phases: typeof spec.phases === 'function' ? spec.phases(cellInfo.ring) : spec.phases } : {}), ...(spec.anim ? { anim: ANIM_PRESETS[spec.anim] } : {}), ...(spec.start ? { start: spec.start } : {}), ...(spec.bound ? { mutate: makeMutate({ bound: true }) } : {}), ...(spec.flashCmds ? { flashCmds: typeof spec.flashCmds === 'function' ? spec.flashCmds(cellInfo.ring) : spec.flashCmds } : {}), ...common });
  }
  const romSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, 'scene.nes'))).digest('hex');
  const out = { name: spec.name, gt, ring: cellInfo.ring, romSha256, dlgSingle: res.symbols?.code?.sw_dlg_single ?? null, sceneScreens: res.sceneScreens ?? null, sceneProject: res.sceneProject ?? null, consts: Object.fromEntries(['STREAM_RING', 'SW_RING_COL_LEN', 'SW_RING_ROW_LEN', 'SW_RW_NT_STEP', 'SW_RW_NT_END', 'SW_DLG_BANKED', 'BATTLE_ENABLED'].map((k) => [k, res.symbols?.ram?.[k] ?? null])), hasKnock: Number.isFinite(res.symbols?.code?.sw_knockback_step), mesen: { status: res.status, frames: res.frames, boundSyms: res.boundSyms, done: res.done, timeout: res.timeout, rows: withClass(mesenRows(res)), phases: res.phases }, jsnes: null, outDir };
  out.script = (res.script ?? []).map((ph) => ({ name: ph.name, collect: !!ph.collect, mode: ph.mode ?? null }));
  if (withJsnes) {
    const js = runJsnesCounted(path.join(outDir, 'scene.nes'), res.symbols, res.script, { onFrame: onFrame && ((nes, f, ph, ram) => onFrame(nes, f, ph, ram, { sceneProject: out.sceneProject })), fault: counterFault, mapper: mapperNo, inputDelay });
    out.jsnes = { frames: js.frames, finished: js.finished, rows: withClass(js.rows) };
  }
  if (sweepCache) {
    // the exhaustive read-cost sweep of THIS scene's layout (s1bcost.mjs), one per distinct fixed-bank image: what decides a read's cycles is the assembled kernel and the world's depth
    const rom = fs.readFileSync(path.join(outDir, 'scene.nes'));
    const prgBanks = rom[4];
    const fixed = rom.subarray(16 + (prgBanks - 1) * 16384, 16 + prgBanks * 16384);
    const key = `${cellInfo.ring.ring}:${cellInfo.ring.n}:${crypto.createHash('sha256').update(fixed).digest('hex')}`;
    if (!sweepCache.has(key)) sweepCache.set(key, { key, ...sweepReads({ romPath: path.join(outDir, 'scene.nes'), sym: res.symbols, ring: cellInfo.ring.ring, n: cellInfo.ring.n }) });
    out.sweepKey = key;
    const pk = `proj:${crypto.createHash('sha256').update(fixed).digest('hex')}`;
    if (!sweepCache.has(pk)) sweepCache.set(pk, { key: pk, projection: sweepProjection({ romPath: path.join(outDir, 'scene.nes'), sym: res.symbols }) });
    out.projKey = pk;
  }
  if (!keepDir) fs.rmSync(outDir, { recursive: true, force: true });
  return out;
}

const MAXKEYS = ['ovr', 'xl', 'xr', 'xu', 'xd', 'kb', 'pkc', 'pkx', 'peek', 'goto', 'loc', 'bank', 'rowloop', 'mwm', 'mwn', 'hzs', 'hzt', 'same', 'xprobe', 'wall', 'proj', 'cam', 'win'];
/** Per class: bodies, max G (Mesen), max of every counter, the union of coexisting terms and the body (frame) that holds the max G. */
export function summarize(rows) {
  const out = {};
  for (const r of rows) {
    const c = (out[r.cls] ??= { n: 0, maxG: null, maxAt: null, max: {}, terms: new Set(), at29780: null, gateFail: 0, top: null, maxCyc: null, ftiles: new Set() });
    if (r.cyc !== undefined && (c.maxCyc === null || r.cyc > c.maxCyc)) c.maxCyc = r.cyc;
    if (r.counters.armc || r.counters.armr) c.ftiles.add(`${r.state.st_fnt}:${r.state.st_ftile}:${r.state.st_len}`);
    c.n++;
    if (r.G !== undefined && (c.maxG === null || r.G > c.maxG)) { c.maxG = r.G; c.maxAt = r.frame; c.top = { phase: r.phase, frame: r.frame, G: r.G, counters: r.counters, state: r.state }; }
    if (r.G === undefined && r.cyc !== undefined && (c.top === null || r.cyc > c.top.cyc)) c.top = { phase: r.phase, frame: r.frame, cyc: r.cyc, counters: r.counters, state: r.state };
    if (r.G === GATE) c.at29780 = [...(c.at29780 ?? []), r.frame];
    if (r.G !== undefined && !gateAllows(r.G)) c.gateFail = (c.gateFail ?? 0) + 1;
    for (const k of MAXKEYS) c.max[k] = Math.max(c.max[k] ?? 0, r.counters[k] ?? 0);
    for (const t of r.terms) c.terms.add(t);
  }
  for (const c of Object.values(out)) { c.terms = [...c.terms].sort(); c.ftiles = [...c.ftiles].sort(); }
  return out;
}
export { SCENARIOS, ringScript, classify, coexisting, movementProbes, hazardProbes, prepareRing };
