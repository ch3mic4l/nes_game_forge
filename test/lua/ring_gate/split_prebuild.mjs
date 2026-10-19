#!/usr/bin/env node
// E21 (Equipment C6c): the build-only prerequisite of the row-8 split harness, run before EVERY pilot or matrix launch and in the release run. NO Mesen: it assembles what row 8 would run and
// proves the harness RAM reservation (ringsplit.mjs HD_RESERVATION) overlaps no allocation of the build's own constants.asm / config.inc / cartridge.inc. It exists because the pilot spent 71 minutes
// to learn that Equipment C3's pc_eq_atk..pc_eq_mdef sat on the old reservation: all 36 row-8 jobs failed at this guard before any emulator ran.
//   node test/lua/ring_gate/split_prebuild.mjs      one line per build and a total; exit 0 only when EVERY build passed, 1 otherwise. There is no skip: a missing nesasm is a failed build.
// Builds (11): the six positive MMC3 row-8 configurations (V and H x action-resident, rpg-resident, rpg-banked), the four RPG lifecycle variants (V and H x resident, banked), and the one flash +
// equipment + Save range case outside row 8 (UNROM 512, EQUIP_SAVE_SHIFT 12, record 139: the highest RAM the engine reaches below the reservation) checked against the same reservation.
// It does NOT certify split timing: a build that passes here can still fail its Mesen verdict.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSplitRing, checkHarnessReservation, HD, HD_RESERVATION } from './ringsplit.mjs';
import { cellById } from './ringworld.mjs';
import { scanEquates, resolveEquates } from '../../lib/equates.js';
import { equipProject, WEAPON, piece } from '../../lib/equipharness.js';
import { saveProject } from '../../../main/project-io.js';
import { buildProject } from '../../../main/build/pipeline.js';

const rows = [];
const run = async (name, fn) => {
  try { rows.push({ name, ok: true, detail: await fn() }); } catch (e) { rows.push({ name, ok: false, detail: `${e && e.stack ? e.message : e}` }); }
  const r = rows[rows.length - 1];
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${name.padEnd(46)} ${r.detail}`);
};

const HD_LOAD = (a) => [0xad, a & 0xff, a >> 8]; // lda abs

const splitBuild = (cellId, gt, placement, lifecycle) => async () => {
  const b = await buildSplitRing({ cell: cellById(cellId), gt, placement, lifecycle, label: `split-prebuild-${cellId}-${gt}-${placement}${lifecycle ? '-lc' : ''}` });
  try {
    const lua = fs.readFileSync(b.luaPath, 'utf8') + (b.luaPathB ? fs.readFileSync(b.luaPathB, 'utf8') : '');
    if (!lua.includes(`hd_pre_lo=${HD.preLo}`) || !lua.includes(`hd_pre_hi=${HD.preHi}`)) throw new Error('the generated Lua does not carry the harness reservation addresses');
    const rom = Buffer.from(b.built.rom);
    if (rom.indexOf(Buffer.from(HD_LOAD(HD.preLo))) < 0) throw new Error(`the harness ROM has no lda $${HD.preLo.toString(16)}: the delay loop did not assemble against the reservation`);
    const checked = checkHarnessReservation({ constantsText: fs.readFileSync(path.join(b.built.dir, 'build/constants.asm'), 'utf8'), symbols: b.built.symbols });
    return `rom ${b.romSha256.slice(0, 12)} lua ${b.luaSha256.slice(0, 12)} ${checked} RAM allocations clear of $${HD_RESERVATION.base.toString(16)}-$${(HD_RESERVATION.base + HD_RESERVATION.length - 1).toString(16)}`;
  } finally { b.dispose(); }
};

const worstCase = async () => {
  const project = await equipProject({ mapper: 30, save: true, items: [piece(1, 'Sword', WEAPON, { atk: 7 })] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-prebuild-u512-'));
  try {
    await saveProject(dir, project);
    await buildProject({ dir, project, log: () => {} });
    const pending = new Map();
    const read = (f) => fs.readFileSync(path.join(dir, 'build', f), 'utf8');
    for (const f of ['constants.asm', 'assets/config.inc', 'assets/cartridge.inc']) scanEquates(read(f), pending);
    const symbols = new Map();
    resolveEquates(pending, symbols);
    if (symbols.get('EQUIP_SAVE_SHIFT') !== 12) throw new Error(`this is not the shift-12 worst case: EQUIP_SAVE_SHIFT = ${symbols.get('EQUIP_SAVE_SHIFT')}`);
    const checked = checkHarnessReservation({ constantsText: read('constants.asm'), symbols });
    return `EQUIP_SAVE_SHIFT 12, ${checked} RAM allocations clear of the reservation`;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

for (const cell of ['MMC3-V', 'MMC3-H']) for (const [gt, placement] of [['action', 'resident'], ['rpg', 'resident'], ['rpg', 'banked']]) await run(`row8 ${cell} ${gt}-${placement}`, splitBuild(cell, gt, placement, false));
for (const cell of ['MMC3-V', 'MMC3-H']) for (const placement of ['resident', 'banked']) await run(`row8 lifecycle ${cell} rpg-${placement}`, splitBuild(cell, 'rpg', placement, true));
await run('UNROM 512 + equipment + flash Save', worstCase);

const bad = rows.filter((r) => !r.ok);
console.log(`split_prebuild: ${rows.length} builds, ${rows.length - bad.length} ok, ${bad.length} failed${bad.length ? ': ' + bad.map((r) => r.name).join('; ') : ''}`);
process.exit(bad.length || rows.length !== 11 ? 1 : 0);
