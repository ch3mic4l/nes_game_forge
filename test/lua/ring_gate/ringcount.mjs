// Phase 3b S1b, row 2: the executed-path counters, in BOTH emulators. A frame is classified by what it was OBSERVED to execute -- instruction entries
// at named kernel labels and CPU writes to the mapper / PPU mask registers -- never by a state byte or a routine name the frame is "supposed" to run.
//
// One body = the interval [NMI entry that released the mainline, mainline's arrival at `wait_vblank_loop`) (the interval G measures, sw_manifest.lua.template).
// Per body the harness records every counter below (sparse: zero counters are omitted), in
//   Mesen : exec/write memory callbacks, injected through runManifest({extraLua}) -- the manifest template itself is untouched;
//   jsnes : a wrapper of nes.cpu.emulate (the instruction about to execute is at REG_PC + 1, the core's convention) and of nes.mmap.write.
// `classify` is shared by both: the same counters give the same class, whatever ran them.
import fs from 'node:fs';
import NES from '../../../renderer/emulator/core/nes.js';

/** key -> kernel label. A leading '?' = optional (the build may lack it: action-only knockback, Move/Wait/Flash/Sfx-only labels). Every label must be a resident kernel address ($C000+). */
export const TERMS = {
  // the reads (plan 2.2): one sw_peek_byte = one sw_goto + one sw_locate_current
  peek: 'sw_peek_byte', goto: 'sw_goto', loc: 'sw_locate_current', rowloop: 'sw_goto_rowloop', bank: 'switch_prg_bank', chr: '?switch_chr_bank',
  // the probes: every movement probe enters sw_hazard_probe_solid; a hazard probe enters sw_hazard_probe_type directly
  hzs: 'sw_hazard_probe_solid', hzt: 'sw_hazard_probe_type', same: 'sw_hazard_probe_same', xprobe: 'sw_hazard_probe_cross', tofst: 'sw_terrain_or_fill_solid_type', wall: 'sw_tofst_solid',
  // the driver
  upl: 'update_player', swup: 'sw_update_player', wx: 'sw_up_do_x', wy: 'sw_up_do_y', pl: 'sw_pstep_left', pr: 'sw_pstep_right', pu: 'sw_pstep_up', pd: 'sw_pstep_down',
  hz: 'player_hazard', kb: '?sw_knockback_step', xl: 'sw_cross_left', xr: 'sw_cross_right', xu: 'sw_cross_up', xd: 'sw_cross_down', talk: '?sw_talker_cross',
  // the camera / strip arm
  cam: 'sw_frame_camera_window', win: 'sw_win_arm', armc: 'sw_stream_start_col', armr: 'sw_stream_start_row',
  // entities and the draw
  ent: 'update_entities', mld: 'main_loop_draw', proj: 'sw_project_axis', anim: '?entity_animate', draw: 'draw_entities',
  // the entity draw (draw_one_entity_show_sw's three paths: cull / in-window / straddle, each tile loop counted at its own label; the per-frame origin sw_ent_setup)
  den: 'draw_one_entity', dsw: 'draw_one_entity_show_sw', dno: 'draw_one_entity_none', dcl: 'dsw_cull', dsr: 'dsw_straddle', dit: 'dsw_in_tile', dst: 'dsw_st_tile', dsp: 'dsw_st_park', dct: 'dsw_cull_tile', sup: 'sw_ent_setup',
  // the frozen-world terms
  ui: 'ui_tick', cbt: '?call_battle', mv: '?move_tick', mvf: '?move_finish', wt: '?wait_tick', txt: 'text_tick', mnu: 'ui_tick_menu', cls: '?text_close_step', cla: '?text_close_attr', resume: '?script_resume',
  // Flash / Shake / Sfx live
  flh: '?flash_tick_hold', flo: '?flash_apply_on', flc: '?flash_tick_confirm', sfx: '?sfx_channel_tick_playing',
  // the MMC3 scanline IRQ (engine/split.asm irq: absent from every other board): its handler writes $E000 + the $8000/$8001 pair (3 mapper-range writes), 3 more when it re-arms; a body long enough to span the split line takes it in the mainline
  irq: '?irq',
  // the NMI
  nms: 'sw_nmi_stream', nmr: 'sw_nmi_stream_reduced', nmb: 'nmi_drain_big', nmd: 'nmi_vram_dispatch', shk: '?nmi_scroll_cam_shake_apply'
};
/** Counters that are not label entries: CPU writes. mwm/mwn = mapper-register-range ($8000-$FFFF) writes in the mainline / inside the NMI; z0 = a $2001 write of 0 (rendering off), zon = the restore, vdw = $2007 writes while blank, c0 = a complete blank with a draw between and its restore. */
export const WRITE_KEYS = ['mwm', 'mwn', 'z0', 'zon', 'vdw', 'c0', 'pkc', 'pkx', 'ovr'];
/** The RAM the body's end-state is read from (the arm's own parameters: plan 2.4 (d)). */
export const STATE_RAM = ['st_active', 'st_cur', 'st_len', 'st_fnt', 'st_ftile', 'st_vary', 'sw_col', 'sw_row', 'player_iframes'];

/**
 * Round 2, finding 4: DECLARED counter faults -- each one is an instrumentation defect (a wrong assembled address, a wrong write range, a dead hook) installed in BOTH
 * emulators at once, so the two records agree with each other and only a relationship against the executed transactions can see it. `--fault=counter-*` of run_s1b.mjs
 * runs a witness with one installed and requires the gate to FAIL.
 *   counter-loc-half     `loc` counts sw_lc_8000 (the even-region half of sw_locate_current) instead of its entry
 *   counter-mwm-range    the mainline mapper-write counter's address range excludes the cell's own PRG-bank register (MMC3: $8000-$9FFF, the others $A000-$FFFF)
 *   counter-price-addr   the read-price hook's exit address is sw_peek_byte+9, not its RTS
 *   counter-dead         the loc, bank, mapper-write and read-price counters are all dead (count nothing)
 */
export const COUNTER_FAULTS = ['counter-loc-half', 'counter-mwm-range', 'counter-price-addr', 'counter-dead'];
/** The (lo, hi) the mainline mapper-write counter covers: $8000-$FFFF, or a deliberately wrong sub-range under counter-mwm-range (`mapper` = the cell's mapper number). */
// under counter-mwm-range the range is chosen PER MAPPER to EXCLUDE the register the mapper's real bank switch writes (engine/banks.asm: MMC1 $E000, MMC3 $8000/$8001, UNROM 512 the $C000 latch), so the
// faulted counter sees none (MMC1) or only some (MMC3, U512) of the writes: a range that still covered the register would be no fault at all
export const mwmRange = (fault, mapper) => (fault === 'counter-mwm-range' ? (mapper === 4 ? [0xa000, 0xffff] : mapper === 30 ? [0x8000, 0xbfff] : [0x8000, 0xdfff]) : fault === 'counter-dead' ? [0, -1] : [0x8000, 0xffff]);
const NON_COUNTER_SYMS = ['sw_enter_screen'];
/**
 * The inclusive-cycle PROFILE of a body (jsnes only): per group, the cycles from the outermost entry of any of its routines to that call's return (a shadow-stack-free test on
 * the hardware stack pointer: the call has returned once SP is back above its entry value), summed over the body. Groups overlap on purpose (the probes are inside the driver, the
 * reads inside the probes), so a group is NEVER added to another: the plan-2.2 reconciliation (s1bbound.mjs) names which are nested and derives the remainder.
 */
export const PROFILE_GROUPS = {
  probes: ['sw_hazard_probe_solid', 'sw_hazard_probe_type'],
  px: ['sw_oam_project_x', 'sw_oam_project_tile_x'], py: ['sw_oam_project_y', 'sw_oam_project_tile_y'], rb: ['sw_oam_rowbase'], pa: ['sw_project_axis'],
  driver: ['sw_update_player'], winarm: ['sw_win_arm'], strip: ['sw_stream_start_col', 'sw_stream_start_row'], cam: ['sw_frame_camera_window'],
  ent: ['update_entities'], draw: ['draw_entities'], mld: ['main_loop_draw'], ui: ['ui_tick'], music: ['music_tick'], read: ['sw_peek_byte']
};
/** Per-activation maxima are kept for these groups (a projection call's own cost, JSR included): { calls, max } under prof.px / prof.py / prof.rb. */
/** The label table a run counts, under `fault` (null = the real one). */
export function termsFor(fault = null) {
  if (!fault) return TERMS;
  if (!COUNTER_FAULTS.includes(fault)) throw new Error(`${fault} is not a declared counter fault`);
  const t = { ...TERMS };
  if (fault === 'counter-loc-half') t.loc = 'sw_lc_8000';
  if (fault === 'counter-dead') { delete t.loc; delete t.bank; }
  return t;
}
export const termSyms = (fault = null) => [...Object.values(termsFor(fault)), ...NON_COUNTER_SYMS];
export const stateRam = () => [...STATE_RAM];

/** The Lua appended after the template's idle registration (it sees the template's file-level locals: SYM, PHASES, frame, T0, bodyPhase, bodyGs, bodyFl, clock, rd). */
export function luaCounters({ fault = null, mapper = 1 } = {}) {
  const terms = termsFor(fault);
  const [mwLo, mwHi] = mwmRange(fault, mapper);
  const priceOff = fault === 'counter-price-addr' ? 9 : 10;
  const noPrice = fault === 'counter-dead';
  return `
-- ===== ring gate row 2: executed-path counters (test/lua/ring_gate/ringcount.mjs) =====
local CN_TERMS = ${JSON.stringify(terms).replace(/"([^"]+)":"\??([^"]+)"/g, '["$1"]="$2"').replace(/^\{/, '{').replace(/\}$/, '}')}
local CN = {}
local cnBody, cnInNmi, cnBlank, cnVdw = false, false, false, 0
local EV, cnNmiT0, cnLastNmiD, cnRelNmi = {}, 0, 0, 0
local function cnBump(k) CN[k] = (CN[k] or 0) + 1 end
for key, name in pairs(CN_TERMS) do
  local a = SYM[name]
  if a then emu.addMemoryCallback(function() cnBump(key) end, emu.callbackType.exec, a) end
end
emu.addMemoryCallback(function()
  if not cnBody then CN = {}; EV = {}; cnBlank = false; cnVdw = 0 else cnBump("ovr") end
  cnInNmi = true
end, emu.callbackType.exec, SYM.nmi)
emu.addMemoryCallback(function() cnInNmi = false end, emu.callbackType.exec, SYM.nmi_rti)
emu.addMemoryCallback(function() cnBody = true; cnRelNmi = cnLastNmiD end, emu.callbackType.exec, SYM.main_loop_body_start)
-- the cycles spent INSIDE sw_peek_byte (jsr sw_goto; lda; pha; jsr sw_locate_current; pla; rts: its rts is 10 bytes in -- checked): the exact price of a read
-- on this cell at this row depth (the bank switches and the row loop are inside it), so a bound can charge an unwitnessed read what a witnessed one cost.
-- EVENTS: every sw_goto / sw_locate_current / sw_peek_byte call of the body, in execution order, as kind:A:X:cycles (A = col, X = row at entry; the cycles are the routine's
-- own, entry to the exec of its final RTS, so the whole call costs cycles + 6 (RTS) + 6 (the caller's JSR)), printed on an EV line beside the body's CN line.
local function evAdd(s) if #EV < 64 then EV[#EV + 1] = s end end
local function regs() local st = emu.getState(); return st["cpu.a"], st["cpu.x"] end
local gT0, gC, gR, gCC, gCR, lT0, lC, lR, pkC, pkR, pkCC, pkCR = 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
local gRts = SYM.sw_locate_current and (SYM.sw_locate_current - 1)
local lRts = SYM.sw_enter_screen and (SYM.sw_enter_screen - 1)
if not ${noPrice} and gRts and rd(gRts) == 0x60 then
  emu.addMemoryCallback(function() gT0 = clock(); gC, gR = regs(); gCC, gCR = rd(SYM.sw_col), rd(SYM.sw_row) end, emu.callbackType.exec, SYM.sw_goto)
  emu.addMemoryCallback(function() evAdd(string.format("g:%d:%d:%d:%d:%d", gC, gR, clock() - gT0, gCC, gCR)) end, emu.callbackType.exec, gRts)
elseif not ${noPrice} then print("CNERR sw_locate_current-1 is not the rts of sw_goto") end
if not ${noPrice} and lRts and rd(lRts) == 0x60 then
  emu.addMemoryCallback(function() lT0 = clock(); lC, lR = regs() end, emu.callbackType.exec, SYM.sw_locate_current)
  emu.addMemoryCallback(function() evAdd(string.format("l:%d:%d:%d", rd(SYM.sw_col), rd(SYM.sw_row), clock() - lT0)) end, emu.callbackType.exec, lRts)
elseif not ${noPrice} then print("CNERR sw_enter_screen-1 is not the rts of sw_locate_current") end
local pkT0, pkRts = 0, SYM.sw_peek_byte and (SYM.sw_peek_byte + ${priceOff})
if pkRts and not ${noPrice} then
  if rd(pkRts) ~= 0x60 then print("CNERR sw_peek_byte+${priceOff} is not an rts")
  else
    emu.addMemoryCallback(function() pkT0 = clock(); pkC, pkR = regs(); pkCC, pkCR = rd(SYM.sw_col), rd(SYM.sw_row) end, emu.callbackType.exec, SYM.sw_peek_byte)
    emu.addMemoryCallback(function()
      local d = clock() - pkT0
      CN["pkc"] = (CN["pkc"] or 0) + d
      if d > (CN["pkx"] or 0) then CN["pkx"] = d end
      evAdd(string.format("p:%d:%d:%d:%d:%d", pkC, pkR, d, pkCC, pkCR))
    end, emu.callbackType.exec, pkRts)
  end
end
emu.addMemoryCallback(function() cnNmiT0 = clock() end, emu.callbackType.exec, SYM.nmi)
emu.addMemoryCallback(function() cnLastNmiD = clock() - cnNmiT0 + 13 end, emu.callbackType.exec, SYM.nmi_rti)
if ${mwHi} >= ${mwLo} then emu.addMemoryCallback(function() cnBump(cnInNmi and "mwn" or "mwm") end, emu.callbackType.write, ${mwLo}, ${mwHi}) end
emu.addMemoryCallback(function(_, v)
  if (v & 0x18) == 0 then cnBump("z0"); cnBlank = true; cnVdw = 0
  else cnBump("zon"); if cnBlank and cnVdw > 0 then cnBump("c0") end; cnBlank = false end
end, emu.callbackType.write, 0x2001)
emu.addMemoryCallback(function() if cnBlank then cnVdw = cnVdw + 1; cnBump("vdw") end end, emu.callbackType.write, 0x2007)
emu.addMemoryCallback(function()
  if not cnBody then return end
  cnBody = false
  local ph = bodyPhase
  if not ph or not ph.collect then return end
  local parts = { string.format("CN %s f=%d G=%d gs=%d fl=%d", ph.name, frame, clock() - T0, bodyGs, bodyFl) }
  for _, n in ipairs({ ${stateRam().map((n) => `"${n}"`).join(', ')} }) do if SYM[n] then parts[#parts + 1] = string.format("r_%s=%d", n, rd(SYM[n])) end end
  parts[#parts + 1] = string.format("nmiT=%d", cnRelNmi)
  local ks = {}
  for k in pairs(CN) do ks[#ks + 1] = k end
  table.sort(ks)
  for _, k in ipairs(ks) do parts[#parts + 1] = string.format("%s=%d", k, CN[k]) end
  print(table.concat(parts, " "))
  if #EV > 0 then print(string.format("EV %s f=%d %s", ph.name, frame, table.concat(EV, ";"))) end
end, emu.callbackType.exec, SYM.wait_vblank_loop)
`;
}

/** The symbols the Lua needs bound (runManifest `extraSyms`): required terms plain, optional ones '?'-prefixed. */
export const luaSyms = (fault = null) => termSyms(fault);
export const luaRam = () => [...STATE_RAM];

// ---------------------------------------------------------------------------------------------------------------- classification
const n = (r, k) => r[k] ?? 0;
/** The step (movement) probes a body made: each sw_pstep_* does two leading-corner probes, and those enter sw_hazard_probe_solid. */
export const movementProbes = (r) => n(r, 'hzs');
/** Probes made by the hazard read (player_hazard enters sw_hazard_probe_type directly). */
export const hazardProbes = (r) => Math.max(0, n(r, 'hzt') - n(r, 'hzs'));

/**
 * The class of one body, from what it OBSERVABLY executed (plan 2.1). Order matters only where two terms can coexist; each rule names its evidence:
 *   C0   : a $2001 write of 0, a draw while blank and the restore ('c0' counter) -- the only exemption, and only on that observation
 *   C4c  : move_finish / text_close_* / script_resume ran (the Move's last body and a text-box close are the handoffs)
 *   C4b  : move_tick ran                          (a scripted Move body)
 *   C4bw : wait_tick ran with no move_tick        (a nonterminal Wait: wait_tick only)
 *   C4a  : text_tick / the menu ran, no player step (frozen dialogue / menu)
 *   CB   : call_battle ran from ui_tick with no text/menu/move/wait (a live battle tick; an RPG's, never exempt)
 *   C3b  : sw_knockback_step ran                  (action knockback)
 *   C3a  : a sw_cross_* ran                       (a walking ownership crossing: update_entities is skipped)
 *   C2   : update_player stepped (sw_pstep_*) and a strip arm ran
 *   C1   : update_player stepped, no arm / crossing / knockback
 *   C1s  : update_player ran and did not step (standing)
 *   C3s  : main_loop_draw with no update_player / ui_tick: the frame OWED to a transition (a crossing's screen_fresh settle frame)
 *   Cx   : none of the above (reported, never dropped)
 */
export function classify(r) {
  if (n(r, 'c0') > 0) return 'C0';
  const stepped = n(r, 'pl') + n(r, 'pr') + n(r, 'pu') + n(r, 'pd') > 0;
  const crossed = n(r, 'xl') + n(r, 'xr') + n(r, 'xu') + n(r, 'xd') > 0;
  const armed = n(r, 'armc') + n(r, 'armr') > 0;
  if (n(r, 'mvf') + n(r, 'cls') + n(r, 'cla') + n(r, 'resume') > 0) return 'C4c';
  if (n(r, 'mv') > 0) return 'C4b';
  if (n(r, 'wt') > 0) return 'C4bw';
  if (n(r, 'txt') + n(r, 'mnu') > 0 && !stepped) return 'C4a';
  if (n(r, 'cbt') > 0 && n(r, 'ui') > 0) return 'CB';
  if (n(r, 'kb') > 0) return 'C3b';
  if (crossed) return 'C3a';
  if (stepped && armed) return 'C2';
  if (stepped) return 'C1';
  if (n(r, 'upl') > 0) return 'C1s';
  if (n(r, 'mld') > 0 && n(r, 'ui') === 0) return 'C3s';
  return 'Cx';
}

/** The terms that coexisted in a body, as a sorted list of short names (plan-review-3 finding 1: report the actual coexistence). */
export function coexisting(r) {
  const t = [];
  if (n(r, 'wx')) t.push('axisX'); if (n(r, 'wy')) t.push('axisY');
  if (movementProbes(r)) t.push('movProbe'); if (hazardProbes(r) || n(r, 'hz')) t.push('hazard');
  if (n(r, 'armc')) t.push('armCol'); if (n(r, 'armr')) t.push('armRow');
  if (n(r, 'ent')) t.push('entities'); if (n(r, 'proj')) t.push('projection'); if (n(r, 'draw')) t.push('draw'); if (n(r, 'dsw')) t.push('entityDraw');
  if (n(r, 'flh') + n(r, 'flo') + n(r, 'flc')) t.push('flash'); if (n(r, 'shk')) t.push('shake'); if (n(r, 'sfx')) t.push('sfx');
  if (n(r, 'nms')) t.push('nmiStream'); if (n(r, 'nmr')) t.push('nmiStreamReduced'); if (n(r, 'nmb')) t.push('nmiBig');
  if (n(r, 'kb')) t.push('knockback'); if (n(r, 'mv')) t.push('moveTick'); if (n(r, 'wt')) t.push('waitTick');
  return t.sort();
}

// ---------------------------------------------------------------------------------------------------------------- jsnes
const BTN = { a: 0, b: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7 };

/**
 * Runs a built scene ROM under jsnes through `phases` (the manifest's own phase list: `held`, `frames`, `waitFor`, `collect`) and returns one row per body of a
 * collected phase: { phase, frame, counters, cyc, gs, state }. `sym` = { code, ram } (the scene's symbols.json). `cyc` is the sum of the CPU instruction cycles
 * from the releasing NMI's first instruction to the idle poll, +7 for the NMI sequence, PLUS the DMA stalls the core schedules (cpu.haltCycles): a cross-check of the Mesen G, never the gate.
 */
export function runJsnesCounted(romPath, sym, phases, { maxFrames = 6000, onFrame = null, fault = null, mapper = 1, inputDelay = 0 } = {}) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  const cpu = nes.cpu;
  const at = new Map(); // address -> [keys]
  for (const [key, label] of Object.entries(termsFor(fault))) {
    const name = label.replace(/^\?/, '');
    const a = sym.code[name];
    if (!Number.isFinite(a)) { if (label.startsWith('?')) continue; throw new Error(`${name} is not a symbol of this build`); }
    if (a < 0xc000) throw new Error(`${name} is not a resident kernel label ($${a.toString(16)}): an exec counter on a banked address would alias`);
    (at.get(a) ?? at.set(a, []).get(a)).push(key);
  }
  const A = (name) => sym.code[name];
  const NMI = A('nmi'), RTI = A('nmi_rti'), START = A('main_loop_body_start'), IDLE = A('wait_vblank_loop');
  const ram = sym.ram;
  const rd = (name) => cpu.mem[ram[name]];
  const [mwLo, mwHi] = mwmRange(fault, mapper);
  const noPrice = fault === 'counter-dead';
  const load = (a) => nes.mmap.load(a);
  // the read-price hooks: the final RTS of sw_goto / sw_locate_current and sw_peek_byte+10 (sw_peek_byte+9 under counter-price-addr), each checked to BE an RTS, exactly as the Lua does
  const GOTO = A('sw_goto'), LOC = A('sw_locate_current'), PEEK = A('sw_peek_byte');
  const gRts = LOC - 1, lRts = A('sw_enter_screen') - 1, pRts = PEEK + (fault === 'counter-price-addr' ? 9 : 10);
  const isRts = (a) => Number.isFinite(a) && a >= 0xc000 && cpu.mem[a] === 0x60;
  const hookG = !noPrice && isRts(gRts), hookL = !noPrice && isRts(lRts), hookP = !noPrice && isRts(pRts);
  let CN = {}, EV = [], cyc = 0, tot = 0, body = false, inNmi = false, blank = false, vdw = 0, counting = false;
  let rows = [], frame = 0, held = {}, pi = 0, pframes = 0;
  let phaseNow = null, gsStart = 0;
  let gT0 = 0, gC = 0, gR = 0, gCC = 0, gCR = 0, lT0 = 0, pT0 = 0, pC = 0, pR = 0, pCC = 0, pCR = 0, nmiT0 = 0, lastNmiD = 0, relNmi = 0;
  const profAt = new Map();
  for (const [g, labels] of Object.entries(PROFILE_GROUPS)) for (const l of labels) { const a = A(l); if (Number.isFinite(a)) (profAt.get(a) ?? profAt.set(a, []).get(a)).push(g); }
  let active = {}, prof = {}, pcalls = {};
  const bump = (k) => { CN[k] = (CN[k] ?? 0) + 1; };
  const origWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (addr, v) => {
    if (addr >= 0x8000) { if (addr >= mwLo && addr <= mwHi) bump(inNmi ? 'mwn' : 'mwm'); }
    else if (addr === 0x2001) { if ((v & 0x18) === 0) { bump('z0'); blank = true; vdw = 0; } else { bump('zon'); if (blank && vdw > 0) bump('c0'); blank = false; } }
    else if (addr === 0x2007 && blank) { vdw++; bump('vdw'); }
    return origWrite(addr, v);
  };
  // DMA stalls (the OAM DMA's 513/514 cycles, the DMC's 4) are scheduled by the core through cpu.haltCycles and consumed by nes.frame(); the instruction sum below adds them
  // at the moment they are scheduled, so `cyc` is instruction cycles + stalls: the same quantity the Mesen master clock counts
  const origHalt = cpu.haltCycles.bind(cpu);
  cpu.haltCycles = (n) => { tot += n; if (counting) cyc += n; return origHalt(n); };
  const origEmulate = cpu.emulate.bind(cpu);
  cpu.emulate = () => {
    // a maskable IRQ is serviced at the START of this emulate() call and the handler's first instruction executes in the SAME call (cpu.js: doIrq, then the fetch): the instruction about to run is the
    // vector's target, not the one at REG_PC. Without this the `irq` label (MMC3's scanline IRQ) is never seen entering in jsnes while Mesen's exec callback sees it.
    const irqNow = cpu.irqRequested && cpu.irqType === 0 && cpu.F_INTERRUPT === 0;
    const pc = irqNow ? (cpu.mem[0xfffe] | (cpu.mem[0xffff] << 8)) : (cpu.REG_PC + 1) & 0xffff;
    const executes = !cpu.nmiImmediate; // an immediate NMI fires INSTEAD of the instruction at pc
    const sp = cpu.REG_SP;
    for (const g in active) if (sp >= active[g].sp + 2) { prof[g] = (prof[g] ?? 0) + (tot - active[g].t0); const cost = tot - active[g].t0 + 6; (pcalls[g] = pcalls[g] ?? { calls: 0, max: 0 }).calls++; pcalls[g].max = Math.max(pcalls[g].max, cost); delete active[g]; }
    if (executes) {
      const pg = profAt.get(pc);
      if (pg) for (const g of pg) if (!active[g] && !(g === 'rb' && active.py)) active[g] = { sp, t0: tot };
      const keys = at.get(pc);
      if (keys) for (const k of keys) bump(k);
      if (pc === GOTO && hookG) { gT0 = tot; gC = cpu.REG_ACC; gR = cpu.REG_X; gCC = rd('sw_col'); gCR = rd('sw_row'); }
      else if (pc === gRts && hookG) EV.push(`g:${gC}:${gR}:${tot - gT0}:${gCC}:${gCR}`);
      else if (pc === LOC && hookL) lT0 = tot;
      else if (pc === lRts && hookL) EV.push(`l:${rd('sw_col')}:${rd('sw_row')}:${tot - lT0}`);
      else if (pc === PEEK && hookP) { pT0 = tot; pC = cpu.REG_ACC; pR = cpu.REG_X; pCC = rd('sw_col'); pCR = rd('sw_row'); }
      else if (pc === pRts && hookP) { const d = tot - pT0; CN.pkc = (CN.pkc ?? 0) + d; if (d > (CN.pkx ?? 0)) CN.pkx = d; EV.push(`p:${pC}:${pR}:${d}:${pCC}:${pCR}`); }
      if (pc === NMI) { nmiT0 = tot; if (!body) { CN = {}; EV = []; prof = {}; active = {}; pcalls = {}; cyc = 7; blank = false; vdw = 0; counting = true; } else bump('ovr'); inNmi = true; }
      else if (pc === RTI) { inNmi = false; lastNmiD = tot - nmiT0 + 13; }
      else if (pc === START) { body = true; relNmi = lastNmiD; gsStart = rd('game_state'); }
      else if (pc === IDLE) {
        // the template advances a waitFor-gameplay phase from its idle-poll callback: the first body that COMPLETES in gameplay (RAM reads gameplay at power-on, so a
        // state-byte check would fire before the game has landed)
        if (phaseNow?.waitFor === 'gameplay' && rd('game_state') === ram.ST_GAMEPLAY) ready = true;
      }
      if (pc === IDLE && body) {
        body = false;
        if (counting && phaseNow?.collect) {
          const state = {};
          for (const nm of STATE_RAM) if (nm in ram) state[nm] = rd(nm);
          rows.push({ phase: phaseNow.name, frame, counters: { ...CN, nmiT: relNmi }, events: EV.slice(0, 64), prof: { ...prof, calls: pcalls }, cyc: cyc, gs: gsStart, state });
        }
        counting = false;
      }
    }
    const c = origEmulate();
    tot += c;
    if (counting) cyc += c;
    return c;
  };
  const apply = (h) => { for (const [k, i] of Object.entries(BTN)) { if (h[k]) nes.buttonDown(1, i); else nes.buttonUp(1, i); } };
  let ready = false;
  const advance = () => { pi++; pframes = 0; phaseNow = phases[pi] ?? null; held = phaseNow?.held ?? {}; };
  pi = 0; phaseNow = phases[0]; held = phaseNow?.held ?? {};
  const heldQ = [];
  while (phaseNow && frame < maxFrames) {
    heldQ.push(held);
    apply(heldQ.length > inputDelay ? heldQ[heldQ.length - 1 - inputDelay] : {});
    nes.frame();
    frame++; pframes++;
    if (onFrame) onFrame(nes, frame, phaseNow, ram);
    if (phaseNow.waitFor === 'gameplay') { if (ready) { ready = false; advance(); pframes = 1; } }
    else if (phaseNow.waitFor === 'naming') { if (rd('box_state') === ram.BOX_NAMEENTRY && rd('box_row') >= ram.BOX_TEXT_ROWS) advance(); }
    else if (pframes >= phaseNow.frames) advance();
  }
  return { rows, frames: frame, finished: !phaseNow };
}
