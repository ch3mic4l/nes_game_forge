// Phase 3b S1c row 8 (plan 2.5/2.6): the MMC3 scanline split (engine/split.asm) against strip / mixed NMI work and the main thread's own PRG switches, on a RING
// build. MMC3 cells only: the split IRQ and split_lock are assembled only on MMC3 (SPLIT_ENABLED); MMC1 and UNROM 512 have neither.
//
// The builder renders sw_split_ring.lua.template (a recorder + stimulus) for one cell. The ROM under test is the HARNESS build: switch_prg_bank carries
// jsr hd_pre / jsr hd_g0..hd_g4 -- RAM-counted delay loops that are ZERO unless the Lua pokes them, so the harness's only job is to let the recorder stretch the
// lock/sei window until an NMI or the split IRQ is due inside it. Everything else is the shipped engine (the ring patches, then the harness override of
// banks.asm). Each sabotage is one more override edit on top, with the matching positive being the same harness build without it.
//
// The judge below restates the CONTRACT, not the source: a simulated MMC3 register file driven by the observed writes in time order; the split program
// (R1 = the live tileset's bank above the box row, the font bank from the box row down); split_arm skips its whole frame when split_lock is up; switch_prg_bank's
// four writes are not interleaved with anyone else's; R0 and R2-R5 are not written while the world runs.
//
// LIFECYCLE (S5 C3, RPG cells on MMC3 only): the same judge, program-aware (the engine's own split_select picks SPL_BOX / SPL_BATTLE per frame), over a scripted game session in the same harness
// ROM -- a battle fought from a ring screen, a warp, a real Save (part A) and, in a second Mesen process on the same ROM and private HOME, the power-on and Continue (part B). Its verdicts FOLD into
// the row's existing items (a FAIL anywhere fails the item) and two items are new: r8:lc-return (the PRG pair, the tileset registers and R1 at every session mark equal the field's) and r8:lc-coverage
// (the session really did enter a battle with the split program armed, really warped, saved and continued).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCellTree, sha256, readTreeText } from './ringtree.mjs';
import { ringProject, buildCell } from './ringworld.mjs';
import { spawnMesen } from './ringnmi.mjs';
import { createMap } from '../../../shared/project.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPLIT_TEMPLATE = path.join(HERE, '../sw_split_ring.lua.template');
export { spawnMesen };

/** Harness RAM (engine/constants.asm holds nothing in $07E0-$07EF; asserted at build time against the build's own symbol table). */
export const HD = { preLo: 0x07e0, preHi: 0x07e1, gap: [0x07e2, 0x07e3, 0x07e4, 0x07e5, 0x07e6] };
export const GAP_ITERS = 12; // 7 cycles each

const STOCK_PSB = `switch_prg_bank:
  asl a                     ; 16 KB bank -> the first of its two 8 KB banks
  sta <mmc_tmp               ; shared scratch; only one mapper family is ever built
  .if SPLIT_ENABLED
  php
  sei
  lda #1
  sta <split_lock
  .endif
  lda #6
  sta $8000
  lda <mmc_tmp
  sta $8001
  lda #7
  sta $8000
  lda <mmc_tmp
  clc
  adc #1
  sta $8001
  .if SPLIT_ENABLED
  lda #0
  sta <split_lock
  plp
  .endif
  rts
`;

/**
 * The session scene (an RPG ring project's mutate): a one-screen title map (Continue needs a title), a Slime two tiles below the start, a Doorway 64 px above it that warps to the next screen, and, on that
 * screen, a Saver whose `enter` event saves on arrival (a touch Saver right of the start, on the field screen, serves the 'lc-skip-warp' control). `screen` is the field screen (SESSION_FIELD). The shapes are test/unit/streamringsplit.test.js's (the jsnes half of the same obligation): Slime { hp 1, acc 0 } at start + 32, an `enter` warp, an `enter` save.
 */
/** Where the session plays (test/unit/streamringrpg.test.js FIELD_FAR): a vertical ring's first ~24 screens share the battle code's 16 KB window, so its field is deep in a 60-screen world; a horizontal ring's screen 2 already lives past it. */
export const SESSION_FIELD = { n: { 1: 60, 2: 4 }, screen: { 1: 55, 2: 2 } };

export function lifecycleScene(p, screen) {
  p.maps.push(createMap(p.maps.length, 'Title'));
  p.project.titleMap = p.maps.length - 1;
  p.project.titleScreen = 0;
  const on = (trigger, commands) => ({ trigger, event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } });
  const add = (a) => { p.sprites.actors.push(a); return p.sprites.actors.length - 1; };
  p.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } }; // C1's shape: the project's first actor, planted 32 px below the start
  const door = add({ name: 'Door', behavior: 'npc', hp: 1, damage: 0 });
  const saver = add({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  const streamed = p.maps[0];
  // the field screen: the Slime, the Doorway (warp to the next screen) and a Saver off to the right (the save the 'lc-skip-warp' control falls back on); the next screen: a Saver whose `enter` event saves the moment the warp lands (the session's Save)
  streamed.screens[screen].entities = [
    { actorId: 0, x: 120, y: 152, props: {} },
    { actorId: door, x: 120, y: 56, props: on('touch', [{ op: 'warp', screen: screen + 1, x: 60, y: 60 }]) },
    { actorId: saver, x: 170, y: 130, props: on('touch', [{ op: 'save' }]) }
  ];
  streamed.screens[screen + 1].entities = [{ actorId: saver, x: 150, y: 60, props: on('enter', [{ op: 'save' }]) }];
}

const hex4 = (n) => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** The harness switch_prg_bank (+ delay routines). `sei` false drops the mask; `r7Inc` is what the second pair adds to the bank (1 shipped). */
export function harnessPsb({ sei = true, r7Inc = 1, transient = false } = {}) {
  // `transient`: after the correct pair the routine commits a WRONG R6 and R7 (bank+2, bank+3) and then restores the right values, all before it unlocks and returns -- the final register
  // file is exactly the stock one, so only a judge that inspects every completed register-value commit (r8:prg-window) or the write count (r8:prg-group) can see it
  const wrongThenRestore = transient ? `  lda #6
  sta $8000
  lda <mmc_tmp
  clc
  adc #2
  sta $8001
  lda #7
  sta $8000
  lda <mmc_tmp
  clc
  adc #3
  sta $8001
  lda #6
  sta $8000
  lda <mmc_tmp
  sta $8001
  lda #7
  sta $8000
  lda <mmc_tmp
  clc
  adc #1
  sta $8001
` : '';
  const gaps = HD.gap.map((a, k) => `hd_g${k}:
  lda ${hex4(a)}
  beq hd_g${k}_d
hd_g${k}_l:
  sec
  sbc #1
  bne hd_g${k}_l
hd_g${k}_d:
  rts
`).join('');
  return `switch_prg_bank:
  asl a
  sta <mmc_tmp
  jsr hd_pre
  .if SPLIT_ENABLED
  php
${sei ? '  sei\n' : ''}  lda #1
  sta <split_lock
  .endif
  lda #6
  sta $8000
  jsr hd_g0
  lda <mmc_tmp
  sta $8001
  jsr hd_g1
  lda #7
  sta $8000
  jsr hd_g2
  lda <mmc_tmp
  clc
  adc #${r7Inc}
  sta $8001
${wrongThenRestore}  jsr hd_g3
  .if SPLIT_ENABLED
  lda #0
  sta <split_lock
  jsr hd_g4
  plp
  .endif
hd_psb_end:
  rts
hd_pre:
hd_pre_l:
  lda ${hex4(HD.preLo)}
  ora ${hex4(HD.preHi)}
  beq hd_pre_d
  lda ${hex4(HD.preLo)}
  sec
  sbc #1
  sta ${hex4(HD.preLo)}
  lda ${hex4(HD.preHi)}
  sbc #0
  sta ${hex4(HD.preHi)}
  jmp hd_pre_l
hd_pre_d:
  rts
${gaps}`;
}

const once = (text, needle, to, what) => {
  const n = text.split(needle).length - 1;
  if (n !== 1) throw new Error(`${what}: expected exactly one occurrence, found ${n} (the engine source moved)`);
  return text.replace(needle, to);
};

/**
 * Sabotages of row 8: id -> { file, declared: items that MUST fail, what, edit(text) }. `psb` options go to harnessPsb; the rest edit split.asm. Each declares the
 * mapper fault it plants; the matching positive is the harness build without it.
 */
export const SPLIT_SABOTAGES = {
  'prg-r7-wrong': { what: 'switch_prg_bank writes R7 = bank+2 (R6/R7 pair corrupted)', declared: ['r8:prg-group', 'r8:prg-window'], psb: { r7Inc: 2 } },
  'prg-transient': { what: 'switch_prg_bank commits a wrong R6 and R7 (bank+2, bank+3) and restores the right pair before it unlocks and returns (the final register file is the stock one)', declared: ['r8:prg-group', 'r8:prg-window'], psb: { transient: true } },
  'split-r0': { what: 'split_arm selects R0 instead of R1 (the live tileset bank lands in the 2 KB BG slot at $0000)', declared: ['r8:arm-grammar', 'r8:chr-regs'],
    file: 'split.asm', edit: (t) => once(t, 'split_arm_unlocked:\n  lda #1                      ; select R1', 'split_arm_unlocked:\n  lda #0                      ; select R1', 'split-r0') },
  'split-wrong-r1': { what: 'split_arm writes the FONT bank into R1 at the top of the frame (the art never comes back)', declared: ['r8:arm-grammar', 'r8:terrain'],
    file: 'split.asm', edit: (t) => once(t, '  sta $8000\n  lda <chr_r1\n  sta $8001\n  lda <split_mode', '  sta $8000\n  lda #FONT_R1\n  sta $8001\n  lda <split_mode', 'split-wrong-r1') },
  'no-sei': { what: 'switch_prg_bank does not mask the scanline IRQ', declared: ['r8:prg-group', 'r8:terrain'], psb: { sei: false } },
  'no-lock': { what: 'split_arm ignores split_lock', declared: ['r8:lock', 'r8:prg-group', 'r8:arm-grammar'],
    file: 'split.asm', edit: (t) => once(t, 'split_arm:\n  lda <split_lock\n  beq split_arm_unlocked\n  rts\nsplit_arm_unlocked:', 'split_arm:\nsplit_arm_unlocked:', 'no-lock') },
  'arm-while-locked': { what: 'a locked frame still arms the IRQ (latch and enable), skipping only the R1 select', declared: ['r8:lock'],
    file: 'split.asm', edit: (t) => once(t, 'beq split_arm_unlocked\n  rts\nsplit_arm_unlocked:', 'beq split_arm_unlocked\n  lda <split_mode\n  bne split_arm_go\n  rts\nsplit_arm_unlocked:', 'arm-while-locked') },
  // LIFECYCLE-ONLY controls: the plain row-8 stream is built WITHOUT the edit (the plain walk never leaves the field, so it is an ordinary positive there) and the session stream carries it
  'bank-restore-lost': { what: 'set_screen_ptr on a streamed map no longer re-locates the field screen: call_battle\'s restore is a no-op and the battle bank stays in the switchable window after a battle (override of screens.asm; the C1 no-bank-restore shape)', declared: ['r8:lc-return'], lifecycleOnly: true,
    file: 'screens.asm', edit: (t) => once(t, '  jsr sw_locate_current\n  rts\nset_screen_ptr_ordinary:', '  rts\nset_screen_ptr_ordinary:', 'bank-restore-lost') },
  'lc-skip-warp': { what: 'the session script omits the warp (a HARNESS mutation: the engine is the shipped one)', declared: ['r8:lc-coverage'], lifecycleOnly: true, lcSkipWarp: true },
  'irq-left-armed': { what: 'the IRQ handler leaves the line enabled when the program ends (the split IRQ stays armed across the frame and the strip drain)', declared: ['r8:irq-count', 'r8:irq-grammar'],
    file: 'split.asm', edit: (t) => once(t, 'irq_done:\n  pla', 'irq_done:\n  sta $E001\n  pla', 'irq-left-armed') }
};

/** Trial plan: NMI and IRQ trials interleaved, the offset P (cycles after split_lock goes up) swept across the whole window in two staggered passes. */
export function planTrials() {
  const trials = [];
  for (const shift of [0, 11]) for (let p = -30 + shift; p <= 640; p += 22) { trials.push({ kind: 'nmi', p }); trials.push({ kind: 'irq', p }); }
  return trials;
}

const RAM_NAMES = ['game_state', 'map_is_streamed', 'st_active', 'vram_len', 'vram_buf', 'vram_ready', 'split_mode', 'split_lock', 'chr_r1'];
const LC_RAM_NAMES = ['sw_col', 'sw_row', 'bt_sel', 'player_x', 'player_y'];
const FNS = ['main_loop_ready', 'nmi', 'nmi_rti', 'split_arm', 'split_arm_unlocked', 'irq', 'irq_done', 'switch_prg_bank', 'hd_psb_end', 'hd_pre', 'hd_pre_l', 'split_progs', 'split_prog_start'];
const lua = (v) => {
  if (Array.isArray(v)) return `{${v.map(lua).join(',')}}`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${k}=${lua(x)}`).join(',')}}`;
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
};

/** Builds one MMC3 cell's row-8 harness ROM and Lua (no Mesen). Returns { tree, built, dir, romPath, luaPath, ctx, romSha256, luaSha256, dispose }. */
export async function buildSplitRing({ cell, gt = 'action', placement = 'resident', sabotage = null, outDir = null, provDir = null, label = null, links = {}, tree = null, lifecycle = false }) {
  if (!cell.id.startsWith('MMC3')) throw new Error(`row 8 is MMC3-only; ${cell.id} is ${cell.mapper}`);
  if (sabotage && !(sabotage in SPLIT_SABOTAGES)) throw new Error(`unknown row-8 sabotage ${sabotage}: ${Object.keys(SPLIT_SABOTAGES).join(', ')}`);
  const own = !tree;
  const t = tree ?? makeCellTree({ cell, gameType: gt });
  if (lifecycle && gt !== 'rpg') throw new Error('the lifecycle session is an RPG scene (a battle, a Save, Continue)');
  // a lifecycle-only control leaves the plain stream unsabotaged; the session stream carries it
  const sab = sabotage && (lifecycle || !SPLIT_SABOTAGES[sabotage].lifecycleOnly) ? SPLIT_SABOTAGES[sabotage] : null;
  const fieldScreen = lifecycle ? SESSION_FIELD.screen[cell.ring] : 0;
  const { project } = ringProject({ cell, gameType: gt, n: lifecycle ? SESSION_FIELD.n[cell.ring] : 4, talkers: 'none', start: { screen: fieldScreen, x: 120, y: 120 }, bulkText: placement === 'banked' ? 3000 : 100, ...(lifecycle ? { mutate: (p) => lifecycleScene(p, fieldScreen) } : {}) });
  const banks = readTreeText(t, 'engine/banks.asm');
  const overrides = [{ name: 'banks.asm', text: once(banks, STOCK_PSB, harnessPsb(sab?.psb ?? {}), 'switch_prg_bank (MMC3)') }];
  if (sab?.file) overrides.push({ name: sab.file, text: sab.edit(readTreeText(t, `engine/${sab.file}`)) });
  project.code = { overrides, files: [] };
  const stamp = label ?? `s1c-split-${lifecycle ? 'lc-' : ''}${sabotage ? `sab-${sabotage}-` : ''}${cell.id}-${gt}-${placement}`;
  const built = await buildCell({ tree: t, project, cell, gameType: gt, label: stamp, provDir, links, requestedPlacement: placement, sabotage: null });
  try {
    const sym = built.symbols;
    for (const n of [...RAM_NAMES, ...(lifecycle ? LC_RAM_NAMES : []), 'SPL_BOX', 'FONT_R1', 'ST_GAMEPLAY', 'BOX_MT_ROW', ...(lifecycle ? ['SPL_BATTLE', 'SPL_TITLE', 'ST_TITLE', 'ST_BATTLE', 'BC_FIGHT', 'BATTLE_BANK', 'BT_BOX_ROW'] : [])]) if (!sym.has(n)) throw new Error(`${n} did not resolve out of this build's own constants.asm/config.inc`);
    for (const n of FNS) if (!Number.isFinite(built.fns[n])) throw new Error(`${n} is not a symbol of this build (SPLIT_ENABLED off, or the harness did not assemble)`);
    // the harness bytes live where nothing else does: no equate of this build's constants.asm covers $07E0-$07EF
    const constants = readTreeText(t, 'engine/constants.asm');
    for (const m of constants.matchAll(/^(\w+)\s*=\s*\$([0-9A-Fa-f]+)\b[^\n]*$/gm)) {
      const a0 = parseInt(m[2], 16);
      const sz = /@size=(\w+)/.exec(m[0]);
      const len = sz ? (/^\d+$/.test(sz[1]) ? Number(sz[1]) : (sym.has(sz[1]) ? sym.get(sz[1]) : 1)) : 1;
      if (a0 < 0x07f0 && a0 + len > 0x07e0 && a0 >= 0x0100 && a0 < 0x0800) throw new Error(`harness RAM $07E0-$07EF collides with ${m[1]} ($${m[2]} +${len})`);
    }
    const outd = outDir ?? built.dir;
    fs.mkdirSync(outd, { recursive: true });
    const romPath = path.join(outd, 'sw_split.nes');
    fs.writeFileSync(romPath, built.rom);
    const addr = Object.fromEntries([...RAM_NAMES, ...(lifecycle ? LC_RAM_NAMES : [])].map((n) => [n, sym.get(n)]));
    const consts = {
      main_loop_ready: built.fns.main_loop_ready, nmi: built.fns.nmi, nmi_rti: built.fns.nmi_rti, split_arm: built.fns.split_arm, split_arm_unlocked: built.fns.split_arm_unlocked, irq: built.fns.irq,
      psb: built.fns.switch_prg_bank, psb_end: built.fns.hd_psb_end, hd_check: built.fns.hd_pre_l, split_progs: built.fns.split_progs, split_prog_start: built.fns.split_prog_start,
      SPL_BOX: sym.get('SPL_BOX'), FONT_R1: sym.get('FONT_R1'), ST_GAMEPLAY: sym.get('ST_GAMEPLAY'), hd_pre_lo: HD.preLo, hd_pre_hi: HD.preHi, hd_g: HD.gap,
      ...(lifecycle ? { ST_TITLE: sym.get('ST_TITLE'), ST_BATTLE: sym.get('ST_BATTLE'), BC_FIGHT: sym.get('BC_FIGHT'), BATTLE_BANK: sym.get('BATTLE_BANK'), SPL_BATTLE: sym.get('SPL_BATTLE') } : {})
    };
    const plan = { btnA: cell.ring === 1 ? 'right' : 'down', btnB: cell.ring === 1 ? 'left' : 'up', leg: 150, unarmEvery: 7, mixedEvery: 2, gap: GAP_ITERS, tail: 90, maxFrames: 6000, packet: { hi: 0x3f, lo: 0x00, count: 32, first: 0x20 }, trials: planTrials() };
    const template = fs.readFileSync(SPLIT_TEMPLATE, 'utf8');
    const render = (pl) => { let text = template; for (const [tok, v] of [['__ADDR__', lua(addr)], ['__CONSTS__', lua(consts)], ['__PLAN__', lua(pl)]]) { if (text.split(tok).length !== 2) throw new Error(`expected one ${tok}`); text = text.split(tok).join(v); } return text; };
    // the session's two Lua scripts (part A, then part B on the same ROM after a power-on); the plain run's one
    const sessionPlan = (part) => ({ ...plan, trials: part === 'A' ? plan.trials : [], lifecycle: { part, toBattle: 'down', toDoor: 'up', toSaver: 'right', loiter: 900, skipWarp: Boolean(sab?.lcSkipWarp) } });
    const texts = lifecycle ? { A: render(sessionPlan('A')), B: render(sessionPlan('B')) } : { main: render(plan) };
    const luaPath = path.join(outd, lifecycle ? 'sw_split_lc_a.lua' : 'sw_split_ring.lua');
    const luaPathB = lifecycle ? path.join(outd, 'sw_split_lc_b.lua') : null;
    fs.writeFileSync(luaPath, lifecycle ? texts.A : texts.main);
    if (luaPathB) fs.writeFileSync(luaPathB, texts.B);
    const text = lifecycle ? texts.A + texts.B : texts.main;
    const ctx = {
      fontR1: sym.get('FONT_R1'), boxL: sym.get('BOX_MT_ROW') * 16 - 1, plannedTrials: plan.trials.length,
      ...(lifecycle ? { fieldScreen, warpTarget: fieldScreen + 1, battleL: sym.get('BT_BOX_ROW') * 8 - 1, battleBank: sym.get('BATTLE_BANK'), SPL_BATTLE: sym.get('SPL_BATTLE'), SPL_TITLE: sym.get('SPL_TITLE'), ST_BATTLE: sym.get('ST_BATTLE'), ring: cell.ring } : {}),
      ranges: { psb: [built.fns.switch_prg_bank, built.fns.hd_psb_end + 1], arm: [built.fns.split_arm, built.fns.irq], irq: [built.fns.irq, built.fns.irq_done + 8] }
    };
    return { tree: t, built, dir: built.dir, outDir: outd, romPath, luaPath, luaPathB, ctx, plan, sabotage, romSha256: sha256(built.rom), luaSha256: sha256(text), dispose: () => { fs.rmSync(built.dir, { recursive: true, force: true }); if (own) fs.rmSync(t.root, { recursive: true, force: true }); } };
  } catch (e) { fs.rmSync(built.dir, { recursive: true, force: true }); if (own) fs.rmSync(t.root, { recursive: true, force: true }); throw e; }
}

// ---- parse ------------------------------------------------------------------------------------------------------------------------------------------
const NUM = (s) => Number(s);
/** stdout -> { events, frames, error, done, trials }. Event order is the order of occurrence. */
export function parseSplitOutput(stdout) {
  const events = [];
  let frames = 0;
  const err = /^ERROR (.*)$/m.exec(stdout);
  const tr = /^TRIALS planned=(\d+) consumed=(\d+) skipped=(\d+) done=(\d+)/m.exec(stdout);
  for (const line of stdout.split('\n')) {
    const m = /^F (\d+) (.*)$/.exec(line);
    if (!m) continue;
    frames++;
    for (const tok of m[2].split(' ')) {
      const f = tok.split(',');
      const f1 = f.slice(1).map(NUM);
      switch (f[0]) {
        case 'N': events.push({ t: 'N', clk: f1[0], sl: f1[1], cy: f1[2], ipc: f1[3], lock: f1[4], sm: f1[5], st: f1[6], vr: f1[7], vl: f1[8], r1: f1[9] }); break;
        case 'S': events.push({ t: 'S', sl: f1[0], cy: f1[1] }); break;
        case 'U': events.push({ t: 'U', sl: f1[0], cy: f1[1] }); break;
        case 'W': events.push({ t: 'W', addr: parseInt(f[1], 16), val: NUM(f[2]), pc: parseInt(f[3], 16), sl: NUM(f[4]), cy: NUM(f[5]), clk: NUM(f[6]) }); break;
        case 'P': events.push({ t: 'P', a: f1[0], sl: f1[1], cy: f1[2], clk: f1[3] }); break;
        case 'T': events.push({ t: 'T', kind: f[1], p: NUM(f[2]), n: f[3] }); break;
        case 'K': events.push({ t: 'K', v: f1[0], clk: f1[1] }); break;
        case 'X': events.push({ t: 'X', sl: f1[0], cy: f1[1], clk: f1[2] }); break;
        case 'I': events.push({ t: 'I', clk: f1[0], sl: f1[1], cy: f1[2], ipc: f1[3] }); break;
        case 'Y': break;
        case 'G': events.push({ t: 'G', f: f1[0] }); break;
        case 'Z': events.push({ t: 'Z', f: f1[0], st: f1[1], vl: f1[2], gs: f1[3], sm: f1[4], ...(f1.length > 5 ? { lock: f1[5], r1: f1[6] } : {}) }); break;
        case 'B': events.push({ t: 'B', on: f[1] === '1' }); break;
        case 'M': events.push({ t: 'M', gs: f1[0], r1: f1[1], lock: f1[2], sm: f1[3], col: f1[4], row: f1[5] }); break;
        case 'L': events.push({ t: 'L', kind: f[1], f: NUM(f[2]), r1: NUM(f[3]), lock: NUM(f[4]), gs: NUM(f[5]), col: NUM(f[6]), row: NUM(f[7]), sm: NUM(f[8]), px: NUM(f[9]), py: NUM(f[10]) }); break;
        default: break;
      }
    }
  }
  const dn = /^DONE frames=\d+(?: sram=(\d+))?/m.exec(stdout);
  return { events, frames, error: err ? err[1] : null, done: /^DONE /m.test(stdout), sram: dn?.[1] === undefined ? null : Number(dn[1]), trials: tr ? { planned: +tr[1], consumed: +tr[2], skipped: +tr[3], done: +tr[4] } : null };
}

// ---- the judge --------------------------------------------------------------------------------------------------------------------------------------
const item = (id, status, detail, extra = {}) => ({ id, status, detail, ...extra });
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const MAX_LIST = 3;
const listed = (a) => `${a.length}: ${a.slice(0, MAX_LIST).join(' | ')}`;

/**
 * Walks the event stream once: groups writes by the routine that wrote them (the writing PC against the build's own symbol ranges), simulates MMC3's register
 * file, and records per-record facts. Returns the analysis the items read.
 */
export function analyze(parsed, ctx) {
  const inR = (pc, [lo, hi]) => pc >= lo && pc < hi;
  const owner = (pc) => (inR(pc, ctx.ranges.psb) ? 'P' : inR(pc, ctx.ranges.arm) ? 'A' : inR(pc, ctx.ranges.irq) ? 'I' : 'o');
  const R = new Array(8).fill(null);
  let sel = 0, afterG = false, psb = null, cur = null, lastX = -1e9;
  const recs = [], psbs = [], violations = { interleave: [], foreign: [], stray: [] }, landings = [];
  const trialsSeen = [], marks = [], bounds = [];
  let seq = 0;
  // forced blank: a session stream (the Lua prints B,0/B,1 when $2001 turns rendering off/on) knows when the picture was off; a plain stream never prints one and is always rendering
  const tracked = parsed.events.some((e) => e.t === 'B');
  let render = !tracked;
  const newRec = (n) => { cur = { n, arms: null, U: false, S: false, irqs: [], writes: [], afterG, r1Start: R[1], z: null, blank: !render }; recs.push(cur); };
  newRec(null);
  for (const e of parsed.events) {
    switch (e.t) {
      case 'G': afterG = true; cur.afterG = true; break;
      case 'B': render = e.on; if (!render) cur.blank = true; break;
      case 'N':
        newRec(e);
        if (psb && psb.lockClk !== null) landings.push({ kind: 'nmi', pos: psb.writes.length, unlocked: psb.unlocked, locked: e.lock === 1, clk: e.clk - 7, psb });
        break;
      case 'S': cur.S = true; cur.arm = { writes: [] }; break;
      case 'U': cur.U = true; break;
      case 'P': psb = { a: e.a, writes: [], start: e, lockClk: null, unlocked: false, trial: null, afterG, landed: [], rec: cur }; break;
      case 'T': if (psb) psb.trial = e; trialsSeen.push(e); break;
      case 'K': if (psb) { if (e.v === 1) psb.lockClk = e.clk; else psb.unlocked = true; } break;
      case 'I': {
        const irq = { e, writes: [] };
        cur.irqs.push(irq);
        if (psb && psb.lockClk !== null) landings.push({ kind: 'irq', pos: psb.writes.length, unlocked: psb.unlocked, clk: e.clk - 7, psb });
        irq.afterX = e.clk - lastX;
        break;
      }
      case 'X':
        if (psb) { psb.end = e; psbs.push(psb); psb = null; }
        lastX = e.clk;
        cur.px = psbs[psbs.length - 1];
        break;
      case 'W': {
        const o = owner(e.pc);
        const w = { ...e, owner: o, reg: e.addr === 0x8001 ? sel : null, rec: cur, render };
        // the hazard is a foreign write between a register SELECT ($8000) and its VALUE ($8001): after 1 or 3 of the four
        if (psb && psb.lockClk !== null && o !== 'P' && psb.writes.length % 2 === 1) violations.interleave.push(`${o}-routine write ${e.addr.toString(16)}=${e.val} between the select and the value of PSB pair ${(psb.writes.length + 1) / 2} (bank ${psb.a})`);
        if (o === 'P') { if (psb) psb.writes.push(w); else violations.stray.push(`PSB write ${e.addr.toString(16)} outside a call`); }
        else if (o === 'A') (cur.arm ?? (cur.arm = { writes: [] })).writes.push(w);
        else if (o === 'I') { if (!cur.irqs.length) cur.irqs.push({ e: null, writes: [] }); cur.irqs[cur.irqs.length - 1].writes.push(w); }
        else if (afterG && render) violations.foreign.push(`write ${e.addr.toString(16)}=${e.val} from pc ${e.pc.toString(16)} (no known routine)`);
        cur.writes.push(w);
        if (e.addr === 0x8000) sel = e.val & 7; else if (e.addr === 0x8001) R[sel] = e.val;
        w.shadow1 = R[1]; w.selAfter = sel;
        break;
      }
      case 'Z': cur.z = { ...e, R: [...R] }; break;
      // M and L are both taken at a COMPLETED RETURN BOUNDARY: main_loop_ready, reached after ui_tick (call_battle, which ends `jmp set_screen_ptr`) or the field update has returned. The main thread has no switch_prg_bank open there, so the
      // simulated register file at that instant is what the return left; a frame END is not such a boundary (the main thread can be inside a delayed switch_prg_bank when the frame ends, with the old pair still in R6/R7).
      case 'M': bounds.push({ ...e, seq: seq++, R: [...R], afterG, render }); break;
      case 'L': marks.push({ ...e, seq: seq++, R: [...R] }); break;
      default: break;
    }
  }
  const lat = [];
  for (const r of recs) if (r.n) for (const i of r.irqs) if (i.e && i.afterX > 120 && !landings.some((l) => l.kind === 'irq' && l.clk === i.e.clk - 7)) lat.push(i.e.clk - r.n.clk);
  const base = median(lat);
  return { recs, psbs, violations, landings, trialsSeen, base, R, ctx, marks, bounds };
}

function terrainOf(rec, a, ctx) {
  // R1 effective on visible line s (0..239) = the last R1 write on a line < s in this record (writes before line 0 count), else what the record inherited.
  const wr = rec.writes.filter((w) => w.reg === 1);
  const at = (s) => { let v = rec.r1Start; for (const w of wr) if (w.sl < s || w.sl >= 241) v = w.val; return v; };
  return { at, wr };
}

/** The scanline count a split program starts with, by split_mode (1 = SPL_BOX; 2 = SPL_BATTLE, session streams only); null = no such program here. */
const latchOf = (sm, ctx) => (sm === 1 ? ctx.boxL : ctx.battleL !== undefined && sm === ctx.SPL_BATTLE ? ctx.battleL : null);

export function judgeSplit(parsed, ctx, { sabotage = null, lifecycle = false } = {}) {
  const a = analyze(parsed, ctx);
  const items = [];
  // a session stream also contains frames the contract does not describe: the title (its own split program), and frames with the picture off (a battle's entry, a warp's redraw: forced blank, where the mapper registers are legitimately rewritten and no scanline IRQ fires)
  const g = a.recs.filter((r) => r.n && r.afterG && !(lifecycle && (r.blank || r.n.sm === ctx.SPL_TITLE)));
  const armedRecs = g.filter((r) => r.n.sm !== 0 && r.n.lock === 0);
  const lockedRecs = g.filter((r) => r.n.lock === 1);
  const offRecs = g.filter((r) => r.n.sm === 0 && r.n.lock === 0);
  const stripArmed = armedRecs.filter((r) => r.n.st !== 0);
  const mixedArmed = armedRecs.filter((r) => r.n.st !== 0 && r.n.vr === 1);
  const done = parsed.done && !parsed.error;
  items.push(done && g.length > 0 ? item('r8:run', 'PASS', `${parsed.frames} frames, ${g.length} measured, ${a.psbs.length} switch_prg_bank calls, ${a.recs.reduce((n, r) => n + r.irqs.length, 0)} split IRQs`)
    : item('r8:run', 'FAIL', `${parsed.error ? `recorder error: ${parsed.error}; ` : ''}${done ? '' : 'no DONE line; '}${g.length ? '' : 'no measured frame'}`));
  const P = a.psbs.filter((p) => p.afterG);

  // arm grammar: a skipped frame writes nothing; an unlocked frame selects R1, loads chr_r1, then either disables (off) or latches/enables the box program
  const armBad = [];
  for (const r of g) {
    const w = r.arm?.writes ?? [];
    if (r.n.lock === 1) { if (w.length || r.U) armBad.push(`f? locked NMI: split_arm ${r.U ? 'reached split_arm_unlocked' : ''}wrote ${w.length}`); continue; }
    if (!r.U) { armBad.push('unlocked NMI never reached split_arm_unlocked'); continue; }
    const latch = r.n.sm === 0 ? null : latchOf(r.n.sm, ctx);
    if (r.n.sm !== 0 && latch === null) { armBad.push(`split_mode ${r.n.sm} is no program of this stream`); continue; }
    const want = r.n.sm === 0
      ? [[0x8000, 1], [0x8001, r.n.r1], [0xe000, null]]
      : [[0x8000, 1], [0x8001, r.n.r1], [0xc000, latch], [0xc001, latch], [0xe001, null]];
    const ok = w.length === want.length && want.every(([ad, v], i) => w[i].addr === ad && (v === null || w[i].val === v));
    if (!ok) armBad.push(`sm=${r.n.sm} wrote [${w.map((x) => `${x.addr.toString(16)}=${x.val}`).join(' ')}], wanted [${want.map(([ad, v]) => `${ad.toString(16)}=${v ?? '*'}`).join(' ')}]`);
  }
  items.push(armBad.length ? item('r8:arm-grammar', 'FAIL', `${armBad.length} split_arm sequences differ from the contract: ${armBad.slice(0, MAX_LIST).join(' | ')}`)
    : g.length ? item('r8:arm-grammar', 'PASS', `${armedRecs.length} armed + ${offRecs.length} disarmed + ${lockedRecs.length} skipped NMIs write exactly the contract's sequence`) : item('r8:arm-grammar', 'UNMEASURED', 'no frame'));

  // irq grammar
  const irqBad = [];
  let irqN = 0;
  for (const r of g) for (const i of r.irqs) {
    irqN++;
    const w = i.writes;
    const ok = w.length === 3 && w[0].addr === 0xe000 && w[1].addr === 0x8000 && w[1].val === 1 && w[2].addr === 0x8001 && w[2].val === ctx.fontR1;
    if (!ok) irqBad.push(`[${w.map((x) => `${x.addr.toString(16)}=${x.val}`).join(' ')}]`);
  }
  items.push(irqBad.length ? item('r8:irq-grammar', 'FAIL', `${irqBad.length} IRQ handlers wrote other than [e000 8000=1 8001=FONT_R1]: ${irqBad.slice(0, MAX_LIST).join(' | ')}`)
    : irqN ? item('r8:irq-grammar', 'PASS', `${irqN} IRQs each write [$E000, $8000=1, $8001=FONT_R1]`) : item('r8:irq-grammar', 'UNMEASURED', 'no IRQ recorded'));

  // irq count: one per armed unlocked frame, none otherwise
  const cntBad = g.filter((r) => r.irqs.length !== (r.n.sm !== 0 && r.n.lock === 0 ? 1 : 0)).map((r) => `NMI clk ${r.n.clk}: sm=${r.n.sm} lock=${r.n.lock} saw ${r.irqs.length} IRQs`);
  items.push(cntBad.length ? item('r8:irq-count', 'FAIL', `${listed(cntBad)} IRQs per frame differ from armed-and-unlocked ? 1 : 0`)
    : g.length ? item('r8:irq-count', 'PASS', `exactly one IRQ in each of ${armedRecs.length} armed frames, none in ${offRecs.length + lockedRecs.length} others`) : item('r8:irq-count', 'UNMEASURED', 'no frame'));

  // prg group: four writes, in order, with the bank the call was given, never interleaved
  const grpBad = [...a.violations.interleave, ...a.violations.stray];
  for (const p of P) {
    const b = (p.a * 2) & 255;
    const want = [[0x8000, 6], [0x8001, b], [0x8000, 7], [0x8001, (b + 1) & 255]];
    const ok = p.writes.length === 4 && want.every(([ad, v], i) => p.writes[i].addr === ad && p.writes[i].val === v);
    if (!ok) grpBad.push(`call bank ${p.a}: wrote [${p.writes.map((x) => `${x.addr.toString(16)}=${x.val}`).join(' ')}]`);
  }
  items.push(grpBad.length ? item('r8:prg-group', 'FAIL', `${listed(grpBad)}`) : P.length ? item('r8:prg-group', 'PASS', `${P.length} switch_prg_bank calls each wrote [$8000=6, $8001=2b, $8000=7, $8001=2b+1] with nobody else's write inside`) : item('r8:prg-group', 'UNMEASURED', 'no call'));

  // prg window: the simulated register file after each call and at the end of every record
  const winBad = [];
  // replay: R6/R7 after each call, then at every record end against the latest completed call
  // and EVERY completed R6/R7 value commit: inside a call each must be the called bank (R6) / bank+1 (R7); after the first measured frame none may happen outside a call. A transient wrong
  // value that is restored before the routine returns changes neither the after-call nor the frame-end register file, and is visible only here.
  const replay = new Array(8).fill(null);
  let sel = 0, lastCall = null, openCall = null, afterG = false, commits = 0;
  for (const e of parsed.events) {
    if (e.t === 'G') afterG = true;
    if (e.t === 'P') openCall = { a: e.a };
    else if (e.t === 'W') {
      if (e.addr === 0x8000) sel = e.val & 7;
      else if (e.addr === 0x8001) {
        replay[sel] = e.val;
        if (sel === 6 || sel === 7) {
          if (openCall) {
            commits++;
            const b = (openCall.a * 2) & 255, want = sel === 6 ? b : (b + 1) & 255;
            if (e.val !== want) winBad.push(`commit R${sel}=${e.val} inside call bank ${openCall.a}, wanted ${want}`);
          } else if (afterG) winBad.push(`commit R${sel}=${e.val} outside any switch_prg_bank call`);
        }
      }
    }
    else if (e.t === 'X' && openCall) {
      const b = (openCall.a * 2) & 255;
      if (replay[6] !== b || replay[7] !== ((b + 1) & 255)) winBad.push(`after call bank ${openCall.a}: R6=${replay[6]} R7=${replay[7]}, wanted ${b}/${(b + 1) & 255}`);
      lastCall = { b };
      openCall = null;
    } else if (e.t === 'Z' && lastCall && !openCall) {
      if (replay[6] !== lastCall.b || replay[7] !== ((lastCall.b + 1) & 255)) winBad.push(`frame end: R6=${replay[6]} R7=${replay[7]}, the last call set ${lastCall.b}/${(lastCall.b + 1) & 255}`);
    }
  }
  items.push(winBad.length ? item('r8:prg-window', 'FAIL', `${listed(winBad)}`) : P.length ? item('r8:prg-window', 'PASS', `every one of the ${commits} completed R6/R7 value commits inside the ${P.length} calls equals the called bank (R7 = bank+1), none happens outside a call, and R6/R7 equal it after every call and at every frame end (${new Set(P.map((p) => p.a)).size} distinct bank value(s) called: with one, a misdirected R6/R7 write rewrites an equal value and only the R1/group items can see it)`) : item('r8:prg-window', 'UNMEASURED', 'no call'));

  // chr registers: nothing but R1 is written while the world runs; R1 ends every frame as the tileset's bank or the font
  const chrBad = [...a.violations.foreign];
  for (const r of g) for (const w of r.writes) if (w.addr === 0x8001 && w.reg !== null && [0, 2, 3, 4, 5].includes(w.reg)) chrBad.push(`write $8001=${w.val} while R${w.reg} is selected (${w.owner}-routine, scanline ${w.sl})`);
  for (const r of g) if (r.z && r.z.R[1] !== r.n.r1 && r.z.R[1] !== ctx.fontR1) chrBad.push(`frame end R1=${r.z.R[1]}, neither chr_r1 ${r.n.r1} nor FONT_R1 ${ctx.fontR1}`);
  items.push(chrBad.length ? item('r8:chr-regs', 'FAIL', `${listed(chrBad)}`) : g.length ? item('r8:chr-regs', 'PASS', 'no write to R0/R2-R5 while the world runs; R1 is the tileset bank or the font at every frame end') : item('r8:chr-regs', 'UNMEASURED', 'no frame'));

  // terrain: per visible line, what the observed R1 writes (with scanline) say the background would read
  const terr = [];
  let linesChecked = 0;
  const deferredRecs = new Set();
  for (const r of g) for (const i of r.irqs) if (i.e && a.base !== null && (i.e.clk - r.n.clk) - a.base > 12) deferredRecs.add(r);
  for (const r of g) {
    const { at } = terrainOf(r, a, ctx);
    const L = latchOf(r.n.sm, ctx) ?? ctx.boxL;
    if (r.n.lock === 1) {
      for (let s = 0; s < 240; s++) if (at(s) !== r.r1Start) { terr.push(`skipped frame: R1 changed to ${at(s)} at line ${s}`); break; }
      continue;
    }
    const defer = deferredRecs.has(r) ? 8 : 0;
    for (let s = 0; s < 240; s++) {
      if (r.n.sm !== 0 && s >= L && s <= L + defer) continue;
      const want = r.n.sm !== 0 && s > L + defer ? ctx.fontR1 : r.n.r1;
      linesChecked++;
      if (at(s) !== want) { terr.push(`NMI clk ${r.n.clk} sm=${r.n.sm}: line ${s} reads R1=${at(s)}, wanted ${want}`); break; }
    }
  }
  items.push(terr.length ? item('r8:terrain', 'FAIL', `${terr.length} frames with the wrong CHR bank on a visible line: ${terr.slice(0, MAX_LIST).join(' | ')}`)
    : linesChecked ? item('r8:terrain', 'PASS', `${linesChecked} lines across ${g.length} frames read the tileset bank above row ${ctx.boxL} and the font below, from the observed R1 writes`) : item('r8:terrain', 'UNMEASURED', 'no line checked'));

  // lock: a frame whose NMI found split_lock up does nothing to the split
  const lockBad = [];
  for (const r of lockedRecs) {
    const m = r.writes.filter((w) => w.addr === 0xc000 || w.addr === 0xc001 || w.addr === 0xe001 || w.owner === 'A');
    if (m.length || r.U || r.irqs.length) lockBad.push(`NMI clk ${r.n.clk}: lock up, yet ${m.length} arm/latch writes, ${r.U ? 'split_arm_unlocked reached, ' : ''}${r.irqs.length} IRQs`);
  }
  items.push(lockBad.length ? item('r8:lock', 'FAIL', `${listed(lockBad)}`)
    : lockedRecs.length ? item('r8:lock', 'PASS', `${lockedRecs.length} NMIs found split_lock up: none armed the split, none latched or enabled the IRQ, none was followed by one`) : item('r8:lock', 'UNMEASURED', 'no NMI found split_lock up'));

  // arm deadline: the last arm write is still in vblank (the counter clocks from the pre-render line)
  const dlBad = [];
  let dlMin = Infinity;
  for (const r of armedRecs.concat(offRecs)) {
    const w = r.arm?.writes ?? [];
    if (!w.length) continue;
    const last = w[w.length - 1];
    if (last.sl > 260 || last.sl < 241) dlBad.push(`NMI clk ${r.n.clk}: last arm write at ${last.sl}.${last.cy}`);
    dlMin = Math.min(dlMin, 260 * 341 + 340 - (last.sl * 341 + last.cy));
  }
  items.push(dlBad.length ? item('r8:arm-deadline', 'FAIL', `${listed(dlBad)}`) : Number.isFinite(dlMin) ? item('r8:arm-deadline', 'PASS', `every arm finishes in vblank (<= 260); least margin ${(dlMin / 3).toFixed(1)} cycles`) : item('r8:arm-deadline', 'UNMEASURED', 'no arm'));

  // exact reachable totals
  const wA = g.reduce((n, r) => n + (r.arm?.writes.length ?? 0), 0);
  const wantA = armedRecs.length * 5 + offRecs.length * 3;
  const wI = g.reduce((n, r) => n + r.irqs.reduce((m, i) => m + i.writes.length, 0), 0);
  const wP = P.reduce((n, p) => n + p.writes.length, 0);
  const totBad = [];
  if (wA !== wantA) totBad.push(`split_arm wrote ${wA}, expected exactly ${wantA} (5 per armed frame x ${armedRecs.length}, 3 per disarmed x ${offRecs.length}, 0 per skipped x ${lockedRecs.length})`);
  if (wI !== 3 * irqN) totBad.push(`split IRQs wrote ${wI}, expected exactly ${3 * irqN} (3 per IRQ x ${irqN})`);
  if (wP !== 4 * P.length) totBad.push(`switch_prg_bank wrote ${wP}, expected exactly ${4 * P.length} (4 per call x ${P.length})`);
  items.push(totBad.length ? item('r8:totals', 'FAIL', totBad.join('; ')) : item('r8:totals', 'PASS', `exact mapper-write totals: split_arm ${wA}, IRQ ${wI}, switch_prg_bank ${wP}`));

  // coverage: what the stimulus actually reached (a session stream's coverage is r8:lc-coverage)
  if (lifecycle) return items;
  const nmiPos = [0, 0, 0, 0, 0, 0], irqPos = [0, 0, 0, 0, 0, 0];
  for (const l of a.landings) (l.kind === 'nmi' ? nmiPos : irqPos)[Math.min(l.pos + (l.unlocked ? 1 : 0), 5)]++;
  // deferred IRQs (masked by sei, taken after plp): where inside the call the assertion would have landed
  const deferredPos = [0, 0, 0, 0, 0, 0];
  for (const r of g) for (const i of r.irqs) {
    if (!i.e || a.base === null || !r.n) continue;
    const lateBy = (i.e.clk - r.n.clk) - a.base;
    if (lateBy <= 12) continue;
    const natural = r.n.clk + a.base - 7;
    const p = a.psbs.find((x) => x.lockClk !== null && x.end && natural >= x.lockClk - 10 && natural <= x.end.clk);
    if (!p) continue;
    const pos = p.writes.filter((w) => w.clk <= natural).length;
    deferredPos[Math.min(pos, 5)]++;
  }
  const covDetail = `strip-active armed frames ${stripArmed.length}, mixed-arm armed frames ${mixedArmed.length}; NMI landings in the call by writes done [pre,g0,g1,g2,g3,g4] = [${nmiPos.join(',')}]; IRQ landings (inside the call) [${irqPos.join(',')}], masked-then-taken [${deferredPos.join(',')}]; trials ${parsed.trials ? `${parsed.trials.consumed}/${parsed.trials.planned} consumed, ${parsed.trials.skipped} skipped` : 'unknown'}`;
  const need = [];
  if (stripArmed.length < 30) need.push(`strip-active armed frames ${stripArmed.length} < 30`);
  if (mixedArmed.length < 10) need.push(`mixed-arm armed frames ${mixedArmed.length} < 10`);
  if (nmiPos[1] < 2) need.push(`NMI landings between the select and the value of R6 (g0): ${nmiPos[1]} < 2`);
  if (nmiPos[3] < 2) need.push(`NMI landings between the select and the value of R7 (g2): ${nmiPos[3]} < 2`);
  if (irqPos[1] + deferredPos[1] < 2) need.push(`IRQ assertions between the select and the value of R6 (g0): ${irqPos[1] + deferredPos[1]} < 2`);
  if (irqPos[3] + deferredPos[3] < 2) need.push(`IRQ assertions between the select and the value of R7 (g2): ${irqPos[3] + deferredPos[3]} < 2`);
  items.push(need.length ? item('r8:coverage', 'UNMEASURED', `${need.join('; ')}. ${covDetail}`, { counts: { nmiPos, irqPos, deferredPos, strip: stripArmed.length, mixed: mixedArmed.length } })
    : item('r8:coverage', 'PASS', covDetail, { counts: { nmiPos, irqPos, deferredPos, strip: stripArmed.length, mixed: mixedArmed.length } }));
  void sabotage;
  return items;
}

// ---- the session (lifecycle) judge ------------------------------------------------------------------------------------------------------------------
const marksOf = (an, kind) => an.marks.filter((m) => m.kind === kind);

/**
 * r8:lc-return and r8:lc-coverage over a session's two parsed streams (A: field, battle, warp, Save; B: power-on, Continue). The register file is the SIMULATED one (every observed $8000/$8001 write
 * in time order). It is read at COMPLETED RETURN BOUNDARIES only: main_loop_ready, which the main thread reaches straight after ui_tick -- in a battle, after call_battle has returned, and call_battle ENDS in
 * `jmp set_screen_ptr` (engine/banks.asm), so the restore IS the return (engine/boot.asm main_loop_ui -> main_loop_draw -> main_loop_ready). The recorder prints one `M` boundary on every such pass and
 * each scripted `L` mark is taken at one. No switch_prg_bank is open at a boundary (the main thread is single), and split_lock is down. A frame END is NOT a boundary: the main thread may be inside a
 * delayed switch_prg_bank then, with the previous pair still in R6/R7 and split_lock not yet up, and that is legitimate; it is never judged.
 *   field        the reference: R1 = chr_r1, a coherent pair [R6, R7 = R6 + 1], the tileset registers R0, R2-R5
 *   EVERY boundary with game_state = ST_BATTLE   lock down, a coherent pair EQUAL TO THE FIELD'S (the restore each battle call ends with), R1 = chr_r1 or the font page
 *   the first boundary after the fight, and EVERY boundary from it to battle-out   the field is back: the pair, the tileset registers R0/R2-R5 and chr_r1 are the field's, R1 on the tileset page (the font page
 *                only while a split program is selected), game_state 0, the same screen
 *   battle-mid/late/ret/out marks   the same checks again at the scripted points (battle-mid/late: SPL_BATTLE selected)
 *   warp-out / save / cont-out  a coherent pair, R1 = chr_r1 = the field tileset's, the tileset registers the field's, lock down; warp-out on screen 3; cont-out equal to what the Save left
 */
export function judgeLifecycle(parsedA, parsedB, ctx, { skipWarpExpected = false } = {}) {
  const A = analyze(parsedA, ctx), B = analyze(parsedB, ctx);
  const bad = [];
  let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) bad.push(msg); };
  const one = (an, kind) => { const m = marksOf(an, kind); return m.length ? m[0] : null; };
  const pair = (m) => [m.R[6], m.R[7]];
  const coherent = (m) => m.R[6] !== null && m.R[6] % 2 === 0 && m.R[7] === m.R[6] + 1;
  const tile = (m) => [m.R[0], m.R[2], m.R[3], m.R[4], m.R[5]];
  const screenOf = (m) => (ctx.ring === 1 ? m.col : m.row);
  const field = one(A, 'field');
  const common = (m, what) => {
    ok(m.lock === 0, `${what}: split_lock ${m.lock} at a main-loop mark`);
    ok(coherent(m), `${what}: PRG pair incoherent (R6 ${m.R[6]}, R7 ${m.R[7]})`);
    ok(m.R[1] === m.r1, `${what}: R1 ${m.R[1]} is not chr_r1 ${m.r1}`);
  };
  if (field) {
    common(field, 'field');
    ok(field.gs === 0, `field: game_state ${field.gs}`);
    ok(field.sm === 0, `field: split_mode ${field.sm} on an idle field (the split follows state, not events)`);
  }
  // what the field must have back after a battle (the first return, every later boundary, the settled battle-out mark). `strict`: a scripted mark is taken on an idle field, so R1 must be chr_r1; a boundary may sit in a frame
  // whose split program is still selected (split_select runs AFTER main_loop_ready), where the font page is legitimate until the next NMI rewrites R1.
  const restored = (m, what, strict) => {
    ok(m.lock === 0, `${what}: split_lock ${m.lock}`);
    ok(coherent(m), `${what}: PRG pair incoherent (R6 ${m.R[6]}, R7 ${m.R[7]})`);
    ok(m.R[1] === m.r1 || (!strict && m.sm !== 0 && m.R[1] === ctx.fontR1), `${what}: R1 ${m.R[1]} is not chr_r1 ${m.r1}`);
    ok(m.gs === 0, `${what}: game_state ${m.gs}`);
    ok(pair(m).join() === pair(field).join(), `${what}: the PRG pair ${pair(m)} is not the field's ${pair(field)} (the field screen's bank was not put back)`);
    ok(tile(m).join() === tile(field).join(), `${what}: the tileset registers R0,R2-R5 ${tile(m)} are not the field's ${tile(field)}`);
    ok(m.r1 === field.r1, `${what}: chr_r1 ${m.r1} is not the field's ${field.r1}`);
    ok(m.col === field.col && m.row === field.row, `${what}: back on screen ${m.col},${m.row}, the fight started on ${field.col},${field.row}`);
  };
  for (const k of ['battle-mid', 'battle-late']) for (const m of marksOf(A, k)) {
    ok(m.gs === ctx.ST_BATTLE, `${k}: game_state ${m.gs}, not ST_BATTLE`);
    ok(m.sm === ctx.SPL_BATTLE, `${k}: split_mode ${m.sm}, the engine did not select SPL_BATTLE (${ctx.SPL_BATTLE})`);
    ok(m.lock === 0, `${k}: split_lock ${m.lock}`);
    ok(field && coherent(m) && pair(m).join() === pair(field).join(), `${k}: the switchable window holds R6/R7 = ${m.R[6]}/${m.R[7]}, not the field's ${field ? pair(field) : '?'} (call_battle's restore did not put the field screen's bank back)`);
    ok(m.R[1] === m.r1 || m.R[1] === ctx.fontR1, `${k}: R1 ${m.R[1]} is neither chr_r1 ${m.r1} nor the font ${ctx.fontR1}`);
  }
  // every completed return boundary of the battle (the game_state of the pass is ST_BATTLE: ui_tick -> call_battle has just returned through set_screen_ptr), then every boundary after the fight up to battle-out
  const bs = A.bounds.filter((m) => m.afterG);
  const inBattle = bs.filter((m) => m.gs === ctx.ST_BATTLE);
  const lastBattle = inBattle.length ? inBattle[inBattle.length - 1] : null;
  const outMark = one(A, 'battle-out');
  const afterFight = lastBattle ? bs.filter((m) => m.seq > lastBattle.seq && (!outMark || m.seq <= outMark.seq)) : [];
  if (field) {
    inBattle.forEach((m, i) => {
      const what = `battle boundary ${i + 1}/${inBattle.length}`;
      ok(m.lock === 0, `${what}: split_lock ${m.lock}`);
      ok(coherent(m) && pair(m).join() === pair(field).join(), `${what}: the switchable window holds R6/R7 = ${m.R[6]}/${m.R[7]} after call_battle returned, not the field's ${pair(field)} (set_screen_ptr's restore did not put the field screen's bank back)`);
      ok(m.R[1] === m.r1 || m.R[1] === ctx.fontR1, `${what}: R1 ${m.R[1]} is neither chr_r1 ${m.r1} nor the font ${ctx.fontR1}`);
    });
    afterFight.forEach((m, i) => restored(m, i === 0 ? 'battle return (the first main-loop pass after the fight)' : `battle return boundary ${i + 1}/${afterFight.length}`, false));
  }
  const out = outMark;
  if (field && out) {
    restored(out, 'battle-out', true);
    ok(out.sm === 0, `battle-out: split_mode ${out.sm}`);
  }
  const ret = one(A, 'battle-ret');
  if (field && ret) { restored(ret, 'battle-ret', true); ok(ret.sm === 0, `battle-ret: split_mode ${ret.sm}`); }
  const warp = one(A, 'warp-out');
  if (field && warp) {
    common(warp, 'warp-out');
    ok(warp.gs === 0 && warp.sm === 0, `warp-out: game_state ${warp.gs}, split_mode ${warp.sm}`);
    ok(screenOf(warp) === ctx.warpTarget, `warp-out: landed on screen ${screenOf(warp)}, the doorway warps to ${ctx.warpTarget}`);
    ok(tile(warp).join() === tile(field).join(), `warp-out: the tileset registers ${tile(warp)} are not the field's ${tile(field)}`);
    ok(warp.r1 === field.r1, `warp-out: chr_r1 ${warp.r1} is not the field's ${field.r1}`);
    ok(pair(warp).join() !== [2 * ctx.battleBank, 2 * ctx.battleBank + 1].join(), 'warp-out: the window still holds the battle bank');
  }
  const save = one(A, 'save');
  if (field && save) {
    common(save, 'save');
    ok(save.gs === 0, `save: game_state ${save.gs}`);
    ok(tile(save).join() === tile(field).join() && save.r1 === field.r1, `save: tileset registers ${tile(save)} / chr_r1 ${save.r1} are not the field's`);
  }
  const cont = one(B, 'cont-out');
  if (field && cont) {
    common(cont, 'cont-out');
    ok(cont.gs === 0 && cont.sm === 0, `cont-out: game_state ${cont.gs}, split_mode ${cont.sm}`);
    ok(tile(cont).join() === tile(field).join() && cont.r1 === field.r1, `cont-out: tileset registers ${tile(cont)} / chr_r1 ${cont.r1} are not the field's (${tile(field)} / ${field.r1})`);
    if (save) {
      ok(cont.col === save.col && cont.row === save.row, `cont-out: Continue landed on screen ${cont.col},${cont.row}, the Save was made on ${save.col},${save.row}`);
      ok(pair(cont).join() === pair(save).join(), `cont-out: the PRG pair ${pair(cont)} is not the one the saved session ended with ${pair(save)}`);
    }
  }
  const ret1 = item('r8:lc-return', bad.length ? 'FAIL' : checks ? 'PASS' : 'UNMEASURED',
    bad.length ? `${listed(bad)}` : checks ? `${checks} checks: ${inBattle.length} main-loop return boundaries in the battle (the PRG pair is the field's after each call_battle return), ${afterFight.length} from the first return after the fight to battle-out (the pair, R0/R2-R5, chr_r1 and R1 are the field's), and the scripted marks (field, battle, warp, Save, power-on and Continue)` : 'no session mark was recorded');

  // ---- coverage: what the session really did (a verdict over an empty session would be vacuous)
  const need = [];
  const gsOf = (r) => r.z?.gs;
  const battleRecs = A.recs.filter((r) => r.n && r.afterG && gsOf(r) === ctx.ST_BATTLE);
  const battleArmed = battleRecs.filter((r) => r.n.sm === ctx.SPL_BATTLE && r.n.lock === 0);
  const battleIrqs = battleArmed.reduce((n, r) => n + r.irqs.length, 0);
  const battlePsb = A.psbs.filter((p) => p.afterG && gsOf(p.rec) === ctx.ST_BATTLE);
  const bNmi = [0, 0, 0, 0, 0, 0], bIrq = [0, 0, 0, 0, 0, 0];
  for (const l of A.landings) if (battlePsb.includes(l.psb)) (l.kind === 'nmi' ? bNmi : bIrq)[Math.min(l.pos + (l.unlocked ? 1 : 0), 5)]++;
  for (const k of ['field', 'battle-in', 'battle-mid', 'battle-late', 'battle-ret', 'battle-out', 'warp-out', 'save']) if (!one(A, k)) need.push(`no ${k} mark`);
  if (!one(B, 'cont-out')) need.push('no cont-out mark (Continue never reached the field)');
  if (inBattle.length < 60) need.push(`main-loop return boundaries in the battle ${inBattle.length} < 60`);
  if (!afterFight.length) need.push('no main-loop return boundary after the fight');
  if (!(parsedA.sram > 0)) need.push(`the Save wrote ${parsedA.sram ?? 'no'} battery RAM bytes`);
  if (!(parsedA.done && !parsedA.error)) need.push(`part A did not finish${parsedA.error ? `: ${parsedA.error}` : ''}`);
  if (!(parsedB.done && !parsedB.error)) need.push(`part B did not finish${parsedB.error ? `: ${parsedB.error}` : ''}`);
  if (battleArmed.length < 60) need.push(`SPL_BATTLE armed frames in battle ${battleArmed.length} < 60`);
  if (battleIrqs < 40) need.push(`split IRQs in battle frames ${battleIrqs} < 40 (the font split of the battle box)`);
  if (battlePsb.length < 40) need.push(`switch_prg_bank calls during the battle ${battlePsb.length} < 40`);
  const battleCalls = battlePsb.filter((p) => p.a === ctx.battleBank).length;
  if (battleCalls < 20) need.push(`switch_prg_bank(BATTLE_BANK = ${ctx.battleBank}) calls during the battle ${battleCalls} < 20 (the battle bank was never really entered)`);
  if (bNmi[1] < 1) need.push(`NMI landings between the select and the value of R6 inside a battle call ${bNmi[1]} < 1`);
  if (bNmi[3] < 1) need.push(`NMI landings between the select and the value of R7 inside a battle call ${bNmi[3]} < 1`);
  const detail = `battle: ${battleArmed.length} armed frames, ${battleIrqs} IRQs, ${battlePsb.length} switch_prg_bank calls (${battleCalls} into the battle bank), NMI landings by writes done [${bNmi.join(',')}], IRQ landings [${bIrq.join(',')}]; return boundaries observed ${inBattle.length} in the battle, ${afterFight.length} after the fight to battle-out; marks (kind R6/R7 R1 at their return boundary) A ${A.marks.map((m) => `${m.kind} ${m.R[6]}/${m.R[7]} R1=${m.R[1]}`).join(', ')} / B ${B.marks.map((m) => `${m.kind} ${m.R[6]}/${m.R[7]} R1=${m.R[1]}`).join(', ')}; battery bytes written ${parsedA.sram}`;
  const cov = need.length ? item('r8:lc-coverage', 'FAIL', `${need.join('; ')}. ${detail}`) : item('r8:lc-coverage', 'PASS', detail);
  void skipWarpExpected;
  return { items: [ret1, cov], analyses: { A, B } };
}

/**
 * Folds the session streams' verdicts into the plain stream's items. A shared item FAILS if any stream fails it, is UNMEASURED if the plain stream is, and PASSES otherwise (a session stream that
 * measured nothing for an item -- r8:lock in the Continue part, which runs no trials -- does not weaken it: r8:lc-coverage is what proves the session was not vacuous). The run items need every
 * stream to be sound. The plain stream's r8:coverage stays its own.
 */
export function foldLifecycle(plain, sessionItems) {
  const streams = Object.entries(sessionItems);
  const RUN = new Set(['run:exit', 'r8:run']);
  return plain.map((it) => {
    if (it.id === 'r8:coverage') return it;
    const parts = streams.map(([name, items]) => [name, items.find((x) => x.id === it.id)]).filter(([, x]) => x);
    const failing = parts.filter(([, x]) => x.status === 'FAIL');
    const unsound = RUN.has(it.id) ? parts.filter(([, x]) => x.status !== 'PASS') : [];
    const status = it.status === 'FAIL' || failing.length ? 'FAIL' : unsound.length ? 'FAIL' : it.status;
    const extra = parts.filter(([, x]) => x.status !== 'UNMEASURED').map(([n, x]) => `[session ${n}: ${x.status}] ${x.detail}`).join(' || ');
    return { ...it, status, detail: extra ? `${it.detail} || ${extra}` : it.detail };
  });
}
