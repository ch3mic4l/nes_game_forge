// The streamed text-box close row (engine/streamdialog.asm sw_dlg_close_row), pinned by an INDEPENDENT oracle
// (test/lib/closeoracle.js) in both placements: every row's packet address, count and tile bytes, and every terrain
// read it makes (screen column, screen row, offset, length -- each at most 8 and never across a screen).
//
// The painted-scene equivalence runs of the Say/Move overrun fix could not see two mutants -- a 16-wide segment and a
// dropped grid-height bound -- because the pixels came out identical; this oracle is what catches them (the sabotage
// tests below), along with the other three the review's table names (row-14/15 boundary, screen-column carry, wrong
// vertical half).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStreamedProject } from '../lib/streamedproject.js';
import { buildPinching, buildAndBoot, configValue, symbolAddr, hasSymbol, runConversation } from '../lib/streamedpinching.js';
import { decorateTerrain, installReadRecorder, closeCases, compareRow } from '../lib/closeoracle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const dialogSource = fs.readFileSync(path.join(ROOT, 'engine/streamdialog.asm'), 'utf8');

const GRID = { gridW: 27, gridH: 3 };

function residentProject(gameType) {
  const p = createStreamedProject({ gameType, ...GRID, dialogue: ['Hello there.'] });
  return decorateTerrain(p);
}

function bankedProject() {
  const { project } = buildPinching('nosave');
  return decorateTerrain(project);
}

async function boot(project, mutate = null) {
  if (mutate) project.code = { overrides: [{ name: 'streamdialog.asm', text: mutate(dialogSource) }], files: [] };
  const b = await buildAndBoot(project);
  const map = project.maps.find((m) => m.streamed === true);
  const banked = hasSymbol(b.symbols, 'sw_dlg_banked_start');
  const reads = installReadRecorder(b.nes, symbolAddr(b.symbols, 'sw_dlg_read_chunk'));
  const ctx = {
    nes: b.nes,
    closeAddr: symbolAddr(b.symbols, 'sw_dlg_close_row'),
    reads,
    bank: banked ? configValue(b.configInc, 'BATTLE_BANK') : null
  };
  return { ctx, banked, grid: { gridW: map.gridW, gridH: map.gridH }, symbols: b.symbols, nes: b.nes };
}

function failures(project, ctx, grid) {
  const bad = [];
  for (const c of closeCases(grid)) {
    const m = compareRow(project, ctx, c);
    if (m) bad.push(m);
  }
  return bad;
}

const PLACEMENTS = [
  { label: 'resident action', make: () => residentProject('action'), banked: false },
  { label: 'resident rpg', make: () => residentProject('rpg'), banked: false },
  { label: 'banked rpg (overlay in the battle bank, field on another)', make: bankedProject, banked: true }
];

for (const { label, make, banked } of PLACEMENTS) {
  test(`close-row oracle [${label}]: every row's packets and chunk reads match the project, across the boundary matrix`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
    const project = make();
    const { ctx, banked: gotBanked, grid } = await boot(project);
    console.log(`close oracle [${label}]: grid ${grid.gridW}x${grid.gridH}`);
    assert.equal(gotBanked, banked, 'the placement under test is the one built');
    const cases = closeCases(grid);
    assert.ok(cases.length > 400, `a real matrix (${cases.length})`);
    const bad = failures(project, ctx, grid);
    assert.deepEqual(bad.slice(0, 3), [], `${bad.length}/${cases.length} rows disagree with the oracle`);
    // Coverage the matrix must really have: every kind of read, and the seam split.
    const lens = new Set(ctx.reads.map((r) => r.len));
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) assert.ok(lens.has(n), `no chunk of ${n} cells was ever read`);
    assert.ok(Math.max(...lens) <= 8, 'a chunk is at most 8 cells');
    // The committed inventory's grid is narrower than a region; the 23/24 seam is covered where the grid reaches it.
    if (grid.gridW > 24) assert.ok(ctx.reads.some((r) => r.scol >= 23 && r.scol <= 24), 'region columns 23/24 were read');
  });
}

// ---- the sabotages: each mutant of the close row must fail the oracle ------------------------------------------

const MUTANTS = [
  { name: 'row 14/15 boundary (cmp #15 -> cmp #14)', old: '  cmp #15\n  bcc sw_dlgcr_rowok', next: '  cmp #14\n  bcc sw_dlgcr_rowok', all: true },
  { name: 'a 16-wide segment (and #7/eor #7 -> and #15/eor #15)', old: '  and #7\n  eor #7', next: '  and #15\n  eor #15', all: true },
  { name: 'the screen-column carry dropped', old: '  bne sw_dlgcr_nowrap\n  inc <sw_dlgcr_sc', next: '  bne sw_dlgcr_nowrap\n  nop\n  nop', all: true },
  { name: 'the grid-height bound dropped (fill read as terrain)', old: '  ldx <sw_dlgcr_row\n  cpx sw_grid_h\n  bcs sw_dlgcr_fill', next: '  ldx <sw_dlgcr_row\n  nop\n  nop\n  nop', all: true },
  { name: 'BOX_MT_ROW dropped from the row add', old: '  pla\n  clc\n  adc #BOX_MT_ROW\n  clc\n  adc sw_dlg_orow_l', next: '  pla\n  clc\n  adc sw_dlg_orow_l', all: true },
  { name: 'the wrong vertical half (bne -> beq)', old: '  lda <sw_dlgw_half\n  bne sw_dlgcr_bottom\n  lda mt_tl,y', next: '  lda <sw_dlgw_half\n  beq sw_dlgcr_bottom\n  lda mt_tl,y', all: true }
];

for (const m of MUTANTS) {
  for (const { label, make } of PLACEMENTS.filter((p) => m.all || !p.banked).filter((p) => p.label !== 'resident rpg')) {
    test(`close-row sabotage [${label}]: ${m.name} fails the oracle`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
      const project = make();
      assert.equal(dialogSource.split(m.old).length - 1, 1, `sabotage setup: the needle must appear exactly once`);
      const { ctx, grid } = await boot(project, (src) => src.replace(m.old, m.next));
      const bad = failures(project, ctx, grid);
      assert.ok(bad.length > 0, `the mutant "${m.name}" passed the oracle`);
    });
  }
}

// ---- the alias lifetime: row-scoped, across seam reopens and into the attribute work --------------------------------
//
// sw_dlgcr_lc/sc/row are the border interior tile ($E9), the retired per-cell counter ($EA) and sw_dlgw_tmp ($E2, which is ALSO
// live in the attribute work after the terrain rows). The claim is a LIFETIME one: each is initialised afresh inside one close
// row and never carried between rows or into the attribute stage. Proven here by poisoning them from outside:
//   - on ENTRY to every sw_dlg_close_row the three bytes are overwritten with junk (so a row that relied on a value left by earlier
//     code -- the border writer's fill, a previous row -- would read junk);
//   - on RETURN from every close row they are overwritten again with different junk (so a later stage -- the next row, the
//     attribute restore -- that relied on a value the row left behind would read junk).
// A whole real conversation (open, pages, close) then must render exactly the nametable/attribute checkpoints of the unpoisoned
// run, in both placements, and the poisoned run must have really crossed a seam reopen (a row published in two packets).

const ALIAS_BYTES = [0xe2, 0xe9, 0xea];

async function conversationRun(placement, poison, mutate = null) {
  const { project, slot } = buildPinching('nosave', { twin: placement === 'resident' });
  decorateTerrain(project); // distinctive terrain, so a wrongly restored row shows
  if (mutate) project.code = { overrides: [{ name: 'streamdialog.asm', text: mutate(dialogSource) }], files: [] };
  const b = await buildAndBoot(project);
  const { nes, mem, symbols } = b;
  const closeRow = symbolAddr(symbols, 'sw_dlg_close_row');
  const reopen = symbolAddr(symbols, 'sw_dlg_run_reopen');
  const chunk = symbolAddr(symbols, 'sw_dlg_read_chunk');
  const stats = { rows: 0, reopens: 0, maxReopensInRow: 0, poisoned: 0, reads: 0, maxReadsInRow: 0 };
  let rowReads = 0;
  const original = nes.cpu.emulate.bind(nes.cpu);
  let armed = null;
  let rowReopens = 0;
  nes.cpu.emulate = () => {
    const cpu = nes.cpu;
    const pc = (cpu.REG_PC + 1) & 0xffff;
    if (armed && pc === armed.ret && cpu.REG_SP === armed.sp + 2) {
      if (poison) for (const a of ALIAS_BYTES) mem[a] = 0x5a;
      stats.maxReopensInRow = Math.max(stats.maxReopensInRow, rowReopens);
      stats.maxReadsInRow = Math.max(stats.maxReadsInRow, rowReads);
      armed = null;
    } else if (!armed && pc === closeRow) {
      stats.rows++;
      rowReopens = 0;
      rowReads = 0;
      if (poison) {
        for (const a of ALIAS_BYTES) mem[a] = 0xa5;
        stats.poisoned++;
      }
      const ret = (mem[0x100 | ((cpu.REG_SP + 1) & 0xff)] + (mem[0x100 | ((cpu.REG_SP + 2) & 0xff)] << 8) + 1) & 0xffff;
      armed = { ret, sp: cpu.REG_SP };
    }
    if (pc === chunk) {
      stats.reads++;
      rowReads++;
    }
    if (pc === reopen) {
      stats.reopens++;
      rowReopens++;
    }
    return original();
  };
  const checkpoints = runConversation(nes, mem, slot, 'nosave');
  return { checkpoints, stats };
}

for (const placement of ['resident', 'banked']) {
  test(`alias lifetime [${placement}]: poisoning $E2/$E9/$EA on entry to and return from every close row changes nothing in a real conversation, which crosses a seam reopen`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
    const clean = await conversationRun(placement, false);
    const poisoned = await conversationRun(placement, true);
    assert.ok(poisoned.stats.rows >= 6, `the conversation closed ${poisoned.stats.rows} rows (a close is six terrain rows)`);
    assert.equal(poisoned.stats.poisoned, poisoned.stats.rows, 'every row was poisoned on entry');
    // the point of the fix: one bounded read per screen run (at most three per row), never one walk per cell (sixteen)
    assert.ok(clean.stats.reads > 0 && clean.stats.maxReadsInRow <= 3, `a close row makes at most 3 chunk reads (max ${clean.stats.maxReadsInRow}, ${clean.stats.reads} in ${clean.stats.rows} rows)`);
    assert.deepEqual(poisoned.stats.rows, clean.stats.rows, 'poisoning changed how many rows ran');
    assert.ok(poisoned.stats.maxReopensInRow >= 2, `a row must have crossed the seam (published two packets): max reopens in one row ${poisoned.stats.maxReopensInRow}`);
    assert.equal(poisoned.checkpoints.length, clean.checkpoints.length);
    for (let i = 0; i < clean.checkpoints.length; i++) {
      assert.deepEqual(poisoned.checkpoints[i].nt, clean.checkpoints[i].nt, `${placement}: checkpoint ${clean.checkpoints[i].label} differs once the alias bytes are poisoned`);
    }
  });
}

// Each of the three initialisations is load-bearing: drop one and the poisoned run no longer renders the stock close.
const INIT_MUTANTS = [
  { name: 'the row-start local column never stored (sw_dlgcr_lc)', old: '  sta <sw_dlgcr_lc           ; local col of the next cell\n', next: '  nop\n  nop\n' },
  { name: 'the row-start screen column never stored (sw_dlgcr_sc)', old: '  sta <sw_dlgcr_sc           ; its screen col\n', next: '  nop\n  nop\n' },
  { name: 'the row\'s screen row never stored (sw_dlgcr_row)', old: '  stx <sw_dlgcr_row         ; screenRow\n', next: '  nop\n  nop\n' }
];
for (const m of INIT_MUTANTS) {
  test(`alias lifetime sabotage: ${m.name} is caught once the alias bytes are poisoned`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
    assert.equal(dialogSource.split(m.old).length - 1, 1, 'sabotage setup: the needle must appear exactly once');
    const clean = await conversationRun('resident', false);
    const mutant = await conversationRun('resident', true, (src) => src.replace(m.old, m.next));
    const same = mutant.checkpoints.every((c, i) => JSON.stringify(c.nt) === JSON.stringify(clean.checkpoints[i]?.nt));
    assert.equal(same, false, `the mutant "${m.name}" still rendered the stock close`);
  });
}

// ---- the release guard in the BANKED placement ---------------------------------------------------------------------------
// The resident placement's `vram_ready` guard in sw_dlg17_camrelease is pinned by streamworlddialogue.test.js (case 8, with its own
// sabotages). The banked placement keeps its own copy of that poll in the resident shim (engine/streamworld.asm), which no test reached:
// dropping its `vram_ready` check released the camera and input the frame the last close packet was still queued. This is that test.
test('banked placement: the camera/input release waits for the close\'s last packet to drain (the shim\'s vram_ready guard)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const VRAM_READY = 0x3f, SW_DLG15_STATE = 0xf3, DRAINING = 2, ST_DIALOG = 2, ST_GAMEPLAY = 0, BOX_STATE = 0x40, BOX_ENDWAIT = 6, GAME_STATE = 0x25; // from engine/constants.asm
  const { project, slot } = buildPinching('nosave');
  const b = await buildAndBoot(project);
  assert.ok(hasSymbol(b.symbols, 'sw_dlg_banked_start'), 'the overlay is banked');
  const { nes, mem } = b;
  const { walkToEntity, press, BTN } = await import('../lib/streamedpinching.js');
  assert.ok(walkToEntity(nes, mem, slot));
  press(nes, BTN.B, 0);
  let seen = false;
  for (let i = 0; i < 1500 && !seen; i++) {
    nes.frame();
    if (mem[BOX_STATE] === BOX_ENDWAIT) { for (let k = 0; k < 3; k++) nes.frame(); press(nes, BTN.B, 0); } // the Observer's pages, then its last close
    if (mem[BOX_STATE] === 8) { for (let k = 0; k < 3; k++) nes.frame(); press(nes, BTN.A, 0); } // BOX_CHOICEWAIT: take the cursor's answer
    if (mem[SW_DLG15_STATE] === DRAINING) {
      seen = true;
      assert.equal(mem[VRAM_READY], 1, 'the close\'s last attribute packet is still queued on the frame DRAINING is entered');
      assert.equal(mem[GAME_STATE], ST_DIALOG, 'and the world is still frozen: the camera/input release did not fire with that packet outstanding');
    }
  }
  assert.ok(seen, 'the close reached DRAINING');
  for (let i = 0; i < 10; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'CONTROL: once the packet drained the release happened');
});
