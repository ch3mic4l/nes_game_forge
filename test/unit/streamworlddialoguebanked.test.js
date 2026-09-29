// Large streamed worlds (ROADMAP item 15), phase 2 slice 10b -- the streamed dialogue overlay in
// the RPG battle bank.
//
// engine/streamdialog.asm is ONE source assembled in one of two placements, chosen by the
// generated SW_DLG_BANKED flag (main/build/generate.js streamworldDialogueBanked -- the single
// predicate): kernel-hi where it always lived, or the battle bank for a streamed RPG whose
// music+sfx+dialogue outgrow the resident ceiling. This file pins the parts no other suite owns:
//
//  - the predicate, its consumers and the refusals (pure JS, no assembler);
//  - the resident-placement flattening the older sabotage suites depend on;
//  - the placement really is banked: a CPU execution hook proves overlay instructions run from
//    $8000-$BFFF with the battle bank selected, that a close-path terrain read leaves the window on
//    a screen bank and the NEXT executed instruction after the resident routine's rts is banked
//    overlay with the battle bank selected again, and that what the dialogue renders equals what
//    the resident twin renders, byte for byte (.slice() copies);
//  - source scans: the overlay selects no bank itself and adds no second trampoline;
//  - the hazards call_battle's reuse raises: H1 (no strip cancel on an overlay entry), H4 (the
//    bt_arg carriers) -- each with a mutant that must fail.
//
// The byte allowances themselves are equality-asserted where their siblings live
// (bankedbytes.test.js: STREAMWORLD_DIALOGUE_BATTLE_ALLOWANCE; kernelbytes.test.js: the two
// resident terms).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSpell } from '../../shared/project.js';
import { charToTile } from '../../shared/font.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { callRoutine } from '../lib/callroutine.js';
import {
  checkCapacity,
  contentCeilingBytes,
  residentContentCeilingBytes,
  streamworldDialogueBanked,
  streamworldHiBytesFor
} from '../../main/build/generate.js';
import { battleRegionBytes, battleRegionCeiling } from '../../main/build/battletables.js';
import { readEngineSource } from '../lib/enginesource.js';
import { buildCommittedInventory } from '../lib/streamedinventory.js';
import {
  BankedReturnError,
  BTN,
  BOX_STATE,
  BOX_ENDWAIT,
  GAME_STATE,
  RAM,
  buildAndBoot,
  buildPinching,
  hasSymbol,
  press,
  runHooked,
  snapshotNametable,
  symbolAddr,
  walkToEntity
} from '../lib/streamedpinching.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const MAPPER = resolveMapper(30);
const VARIANTS = ['nosave', 'save', 'move'];

const engine = (name) => fs.readFileSync(path.join(ROOT, 'engine', name), 'utf8');

/** Source without comment-only text -- a scan must see instructions, not prose about them. */
function code(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/;.*$/, ''))
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// The resident-placement flattening (test/lib/enginesource.js) equals the pre-slice text.
// ---------------------------------------------------------------------------------------------

test('readEngineSource("streamworld.asm") is the pre-relocation text of 59d4468, header comment aside', () => {
  const old = spawnSync('git', ['show', '59d4468:engine/streamworld.asm'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(old.status, 0, `git show must succeed: ${old.stderr}`);
  const flat = readEngineSource('streamworld.asm');
  // The only additions are streamdialog.asm's own header comment (its first `; ===`-free block up
  // to the first blank line) and the blank line at the include's end; nothing else may differ.
  const flatLines = flat.split('\n');
  const start = flatLines.findIndex((l) => l.startsWith('; streamdialog.asm --'));
  assert.ok(start > 0, 'the flattened text must carry streamdialog.asm’s header comment');
  let end = start;
  while (flatLines[end] !== '') end++;
  const stripped = [...flatLines.slice(0, start), ...flatLines.slice(end + 1)];
  const oldLines = old.stdout.split('\n');
  // ...and the one blank line the included file ends with, wherever the two first diverge.
  let i = 0;
  while (i < oldLines.length && stripped[i] === oldLines[i]) i++;
  assert.equal(stripped[i], '', `the only other addition must be a single blank line (first divergence at line ${i + 1})`);
  stripped.splice(i, 1);
  assert.equal(stripped.length, oldLines.length, 'flattening must not add or drop any other line');
  const bad = stripped.findIndex((l, k) => l !== oldLines[k]);
  assert.equal(bad, -1, `flattening must reproduce the pre-slice engine/streamworld.asm exactly (first difference at line ${bad + 1})`);
});

// ---------------------------------------------------------------------------------------------
// The predicate and its consumers (pure).
// ---------------------------------------------------------------------------------------------

test('streamworldDialogueBanked: true for the committed inventory in every variant, false for its resident twin', () => {
  for (const variant of VARIANTS) {
    const { project } = buildPinching(variant);
    const { project: twin } = buildPinching(variant, { twin: true });
    assert.equal(streamworldDialogueBanked(project), true, `${variant}: the committed inventory must relocate`);
    assert.equal(streamworldDialogueBanked(twin), false, `${variant}: the twin fits resident and must not relocate`);
    assert.equal(contentCeilingBytes(twin), residentContentCeilingBytes(twin), `${variant}: a resident twin's ceiling is the resident one`);
    assert.ok(
      contentCeilingBytes(project) > residentContentCeilingBytes(project),
      `${variant}: relocation must buy content room (${contentCeilingBytes(project)} vs ${residentContentCeilingBytes(project)})`
    );
    const cap = checkCapacity(project);
    assert.deepEqual(
      cap.problems.filter((x) => x.severity === 'error'),
      [],
      `${variant}: the committed inventory builds once relocated`
    );
    const content = cap.musicBytes + cap.sfxBytes + cap.textBytes;
    const spare = contentCeilingBytes(project) - content;
    assert.ok(spare > 0, `${variant}: the inventory must fit the relocated ceiling (spare ${spare})`);
    console.log(
      `S10B ceiling ${variant}: content ${content} ceiling ${contentCeilingBytes(project)} (resident ${residentContentCeilingBytes(project)}) spare ${spare}; ` +
        `kernel-hi reservation ${streamworldHiBytesFor(project)} vs resident-only ${streamworldHiBytesFor(twin)}`
    );
  }
});

test('streamworldDialogueBanked never fires for a project without a battle bank, without streaming, or with room', () => {
  // Action: no battle bank to relocate into -- same content, same refusal it always had.
  const { project: action } = buildCommittedInventory('action');
  assert.equal(streamworldDialogueBanked(action), false, 'an action project has no battle bank');
  const refusal = checkCapacity(action).problems.find((x) => x.severity === 'error' && /Music compiles/.test(x.message));
  assert.ok(refusal, 'an action project over the resident ceiling is still refused with the content-ceiling message');
  assert.equal(contentCeilingBytes(action), residentContentCeilingBytes(action));
  // Streamed RPG with little content: fits resident.
  const { project: small } = buildPinching('nosave', { twin: true });
  assert.equal(streamworldDialogueBanked(small), false);
  // Ordinary (non-streamed) RPG with the same heavy content: nothing to relocate.
  const { project: ordinary } = buildCommittedInventory('rpg');
  for (const map of ordinary.maps) map.streamed = false;
  assert.equal(streamworldDialogueBanked(ordinary), false, 'no streaming, no overlay');
});

// The relocated ceiling's own edges (exact fit builds, one byte over is refused) are pinned by
// authored totals in streamworlddialogueboundary.test.js -- no growth loop decides them here.

// B6 -- the battle region cannot also hold the overlay.
function refusedForRegion(project) {
  return checkCapacity(project).problems.find(
    (x) => x.severity === 'error' && x.where === 'Build & Play' && /dialogue code moves into/.test(x.message)
  );
}

function withSpells(project, count) {
  for (let i = 0; i < count; i++) project.spells.push(createSpell(project.spells.length, `Spell${i}`));
}

test('B6: a pinching project whose battle region cannot also hold the overlay is refused in plain language; its resident twin builds', () => {
  const { project } = buildPinching('nosave');
  withSpells(project, 115);
  const withOverlay = battleRegionBytes(project, MAPPER, { streamDialogueBanked: true });
  const without = battleRegionBytes(project, MAPPER);
  const ceiling = battleRegionCeiling(MAPPER);
  assert.ok(without <= ceiling, `precondition: the region alone must fit (${without} <= ${ceiling})`);
  assert.ok(withOverlay > ceiling, `precondition: the overlay must tip it over (${withOverlay} > ${ceiling})`);
  assert.equal(streamworldDialogueBanked(project), true);
  const err = refusedForRegion(project);
  assert.ok(err, 'the relocated overlay overflowing the battle region must be refused with its own message');
  assert.match(err.message, /music \(\d+ bytes\)/);
  assert.match(err.message, /sound effects \(\d+ bytes\)/);
  assert.match(err.message, new RegExp(`needs ${withOverlay} bytes there but the bank holds ${ceiling}`));
  assert.match(err.message, /Sound Forge/);
  assert.match(err.message, /Map Forge/);
  // The same spells with dialogue that fits resident: the region alone fits, so no refusal at all.
  const { project: twin } = buildPinching('nosave', { twin: true });
  withSpells(twin, 115);
  assert.equal(streamworldDialogueBanked(twin), false);
  assert.equal(refusedForRegion(twin), undefined);
  assert.deepEqual(checkCapacity(twin).problems.filter((x) => x.severity === 'error'), []);
});

// ---------------------------------------------------------------------------------------------
// Case 2 -- the overlay selects no bank itself and adds no second trampoline (source scan).
// ---------------------------------------------------------------------------------------------

const BANK_SELECTORS = /\b(switch_prg_bank|write_mapper_reg|set_screen_ptr|sw_locate_current|mapper_shadow|call_battle|battle_entry)\b/;
const DIRECT_MAPPER_STORE = /\bst[axy]\s+\$?[89A-Fa-f][0-9A-Fa-f]{3}\b/;

/** Returns a list of problems found scanning `overlay` (streamdialog.asm text) and `world`
 * (streamworld.asm text) for an ad hoc bank select or second trampoline. */
function scanBankSelects({ overlay, world, banks, battle }) {
  const problems = [];
  const body = code(overlay);
  body.split('\n').forEach((line, i) => {
    if (BANK_SELECTORS.test(line)) problems.push(`streamdialog.asm:${i + 1}: names a bank-select routine: ${line.trim()}`);
    if (DIRECT_MAPPER_STORE.test(line)) problems.push(`streamdialog.asm:${i + 1}: stores to $8000-$FFFF: ${line.trim()}`);
  });
  // streamworld.asm's shim block: the ONLY bank selection is sw_dlg_terrain_read's own
  // switch_prg_bank, preceded by lda #BATTLE_BANK; every BE_DLG_ operand is handed straight to
  // call_battle (the same routine the battle and naming entries use).
  const worldCode = code(world);
  const shim = worldCode.slice(worldCode.indexOf('sw_dlg_shim_start:'), worldCode.indexOf('sw_dlg_shim_end:'));
  const shimLines = shim.split('\n');
  shimLines.forEach((line, i) => {
    if (/\b(write_mapper_reg|set_screen_ptr|mapper_shadow|battle_entry)\b/.test(line)) problems.push(`shim:${i}: ${line.trim()}`);
    if (DIRECT_MAPPER_STORE.test(line)) problems.push(`shim:${i}: stores to $8000-$FFFF: ${line.trim()}`);
    if (/\bBE_DLG_\w+/.test(line) && !/\bBE_DLG_\w+\b/.test(line.replace(/lda #/, ''))) problems.push(`shim:${i}: ${line.trim()}`);
  });
  const switches = shimLines.map((l, i) => ({ l, i })).filter(({ l }) => /\bswitch_prg_bank\b/.test(l));
  if (switches.length !== 1) problems.push(`shim: expected exactly one switch_prg_bank (the H2 terrain re-select), found ${switches.length}`);
  else if (!/lda #BATTLE_BANK/.test(shimLines[switches[0].i - 1] ?? '')) problems.push('shim: the one switch_prg_bank is not preceded by lda #BATTLE_BANK');
  // Every BE_DLG_ load in the shim is followed, within the next two instructions, by call_battle.
  const nonBlank = shimLines.map((l) => l.trim()).filter(Boolean);
  nonBlank.forEach((l, i) => {
    if (/^lda #BE_DLG_/.test(l) && !/call_battle/.test(nonBlank.slice(i + 1, i + 3).join(' '))) {
      problems.push(`shim: ${l} is not handed to call_battle`);
    }
  });
  // The one place the resident world code jsr's the battle entry is call_battle itself.
  const battleEntryUses = code(banks)
    .split('\n')
    .filter((l) => /\b(jsr|jmp)\s+battle_entry\b/.test(l));
  if (battleEntryUses.length !== 1) problems.push(`banks.asm: expected exactly one jsr battle_entry (call_battle's), found ${battleEntryUses.length}`);
  if (/\bbattle_entry\b/.test(worldCode)) problems.push('streamworld.asm names battle_entry directly');
  // battle.asm dispatches BE_DLG_* through be_dlg_dispatch only.
  if (!/be_dlg_dispatch/.test(code(battle))) problems.push('battle.asm does not route BE_DLG_* through be_dlg_dispatch');
  return problems;
}

const stockScanInputs = () => ({
  overlay: engine('streamdialog.asm'),
  world: engine('streamworld.asm'),
  banks: engine('banks.asm'),
  battle: engine('battle.asm')
});

test('case 2: the overlay makes no bank select of its own and adds no second trampoline (source scan)', () => {
  assert.deepEqual(scanBankSelects(stockScanInputs()), []);
});

test('case 2 (control): the scan does see an ad hoc bank select and a second trampoline when one is added', () => {
  const stock = stockScanInputs();
  const a = scanBankSelects({ ...stock, overlay: stock.overlay.replace('sw_dlg_be_put_char:', 'sw_dlg_be_put_char:\n  lda #BATTLE_BANK\n  jsr switch_prg_bank') });
  assert.ok(a.length > 0, 'an ad hoc jsr switch_prg_bank inside the overlay must be reported');
  const b = scanBankSelects({ ...stock, overlay: stock.overlay.replace('sw_dlg_be_put_char:', 'sw_dlg_be_put_char:\n  sta $8000') });
  assert.ok(b.length > 0, 'a direct store into the mapper window must be reported');
  const c = scanBankSelects({ ...stock, world: stock.world.replace('sw_dlg_terrain_read:', 'sw_dlg_terrain_read:\n  jsr battle_entry') });
  assert.ok(c.length > 0, 'a second jsr battle_entry outside call_battle must be reported');
});

// ---------------------------------------------------------------------------------------------
// H3 -- game.fns agrees about which labels are resident and which are banked, in both placements.
// ---------------------------------------------------------------------------------------------

function symbolTable(text) {
  const out = new Map();
  for (const m of text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s+=\s+\$([0-9A-Fa-f]+)/gm)) out.set(m[1], parseInt(m[2], 16));
  return out;
}

// Relocated labels that must resolve inside the banked range / resident ones that must not.
const MUST_BE_BANKED = ['sw_dlg_origin_capture', 'sw_dlg_metatile', 'sw_dlg_be_put_char', 'sw_dlg_be_close_step', 'sw_dlg_be_camrelease', 'sw_dlg15_pending_step', 'be_dlg_dispatch', 'be_dlg_table', 'sw_dlg_relocated_end'];
const MUST_BE_RESIDENT = ['sw_dlg_shim_start', 'sw_dlg_shim_end', 'sw_dlg_hi_open_row', 'sw_dlg_hi_put_char', 'sw_dlg_hi_close_step', 'sw_dlg_hi_text_tick', 'sw_dlg17_camrelease', 'sw_dlg17cr_done', 'sw_dlg_terrain_read', 'sw_dlg_mapper_start', 'sw_dlg_mapper_end'];

for (const variant of VARIANTS) {
  test(`H3 [${variant}]: game.fns puts every relocated label in the banked range and every shim/resident label above $C000; the twin has no banked labels`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
    const { project } = buildPinching(variant);
    const banked = await buildAndBoot(project, { boot: false });
    const table = symbolTable(banked.symbols);
    const lo = table.get('sw_dlg_banked_start');
    const hi = table.get('sw_dlg_banked_end');
    assert.ok(lo >= 0x8000 && hi <= 0xc000 && hi > lo, `banked overlay must sit inside $8000-$BFFF (${lo?.toString(16)}-${hi?.toString(16)})`);
    let inBanked = 0;
    for (const [name, addr] of table) {
      if (!name.startsWith('sw_dlg') && !name.startsWith('be_dlg')) continue;
      // Every overlay-family label is in exactly one of the two placements: inside the banked
      // span (bounds inclusive: the _end marker sits on the first byte after it) or in kernel.
      const banked = addr >= lo && addr <= hi;
      assert.ok(banked !== addr >= 0xc000, `${name} at $${addr.toString(16)} is in neither the banked range nor the kernel`);
      if (banked) inBanked++;
    }
    for (const name of MUST_BE_BANKED) assert.ok(table.get(name) >= lo && table.get(name) <= hi, `${name} must be banked ($${table.get(name)?.toString(16)})`);
    for (const name of MUST_BE_RESIDENT) assert.ok(table.get(name) >= 0xc000, `${name} must stay resident ($${table.get(name)?.toString(16)})`);
    assert.ok(inBanked >= 60, `expected the whole overlay to be banked, found only ${inBanked} labels`);
    const { project: twinProject } = buildPinching(variant, { twin: true });
    const twin = await buildAndBoot(twinProject, { boot: false });
    const twinTable = symbolTable(twin.symbols);
    assert.equal(hasSymbol(twin.symbols, 'sw_dlg_banked_start'), false, 'a resident build must have no banked overlay');
    for (const [name, addr] of twinTable) {
      if (name.startsWith('sw_dlg') || name.startsWith('be_dlg')) {
        assert.ok(addr >= 0xc000, `resident placement: ${name} must be in kernel ($${addr.toString(16)})`);
      }
    }
    assert.ok(twinTable.has('sw_dlg_hi_put_char'), 'the resident placement keeps the same entry names');
  });
}

// ---------------------------------------------------------------------------------------------
// Case 4 -- genuinely banked execution, in the three variants.
// ---------------------------------------------------------------------------------------------

const hooked = new Map();
const twinRuns = new Map();
const runBanked = (variant) => {
  if (!hooked.has(variant)) hooked.set(variant, runHooked(variant));
  return hooked.get(variant);
};
const runTwin = (variant) => {
  if (!twinRuns.has(variant)) twinRuns.set(variant, runHooked(variant, { twin: true }));
  return twinRuns.get(variant);
};

/** Every relocation assertion on one run; returns nothing, throws on the first failure. Shared
 * by the stock tests and the sabotage tests (which expect it to throw on a mutant build). */
function assertBankedExecution(variant, run, twin) {
  const { stats, before, after, battleBank } = run;
  assert.equal(run.banked, true, `${variant}: the project must build with the overlay banked`);
  assert.notEqual(after.expected.bank, battleBank, `${variant}: precondition -- the field's screen must live in a different bank from the overlay, or a missing re-select is invisible`);
  assert.ok(stats.bankedInstr > 5000, `${variant}: only ${stats.bankedInstr} overlay instructions executed from the banked range -- the overlay did not really run there`);
  assert.deepEqual(stats.badFetch.slice(0, 3), [], `${variant}: overlay instructions fetched outside $8000-$BFFF or without the battle bank selected`);
  assert.ok(stats.dispatchHits >= 20, `${variant}: BE_DLG_* entries never reached be_dlg_dispatch (${stats.dispatchHits})`);
  assert.ok(stats.terrainReads > 0, `${variant}: the close path never read terrain through the resident routine`);
  assert.equal(stats.terrainMoved, stats.terrainReads, `${variant}: every terrain read must really move the window off the battle bank (${stats.terrainMoved}/${stats.terrainReads})`);
  assert.equal(stats.terrainReturns, stats.terrainReads, `${variant}: every terrain read must return`);
  // The first instruction after sw_dlg_terrain_read's rts is checked INSIDE the CPU hook (it throws
  // a BankedReturnError before that instruction runs); a run that got here recorded none.
  assert.deepEqual(
    stats.badReturns,
    [],
    `${variant}: the instruction after sw_dlg_terrain_read's rts must be banked overlay code with bank ${battleBank} selected`
  );
  assert.equal(stats.returnPcs.length, stats.terrainReads, `${variant}: every terrain read's first return fetch must have been checked`);
  // On return to the field: the screen bank, mtptr and mapper_shadow are what the locator says.
  assert.equal(after.bank, after.expected.bank, `${variant}: field window bank not restored`);
  assert.equal(after.shadow & 0x1f, after.expected.bank, `${variant}: mapper_shadow bank bits not restored`);
  assert.equal(after.ptr, after.expected.ptr, `${variant}: mtptr not restored`);
  assert.deepEqual(after.bank, before.bank, `${variant}: screen bank differs from before the conversation`);
  assert.equal(after.shadow, before.shadow, `${variant}: mapper_shadow differs from before the conversation`);
  assert.equal(after.ptr, before.ptr, `${variant}: mtptr differs from before the conversation`);
  // The rendered result equals the resident placement's, checkpoint by checkpoint.
  assert.deepEqual(
    run.checkpoints.map((c) => c.label),
    twin.checkpoints.map((c) => c.label),
    `${variant}: the conversation must pass through the same states in both placements`
  );
  for (let i = 0; i < run.checkpoints.length; i++) {
    const a = run.checkpoints[i];
    const b = twin.checkpoints[i];
    for (let nt = 0; nt < a.nt.length; nt++) {
      assert.deepEqual(a.nt[nt].tile, b.nt[nt].tile, `${variant} @${a.label}: nametable ${nt} tile bytes differ from the resident placement`);
      assert.deepEqual(a.nt[nt].attrib, b.nt[nt].attrib, `${variant} @${a.label}: nametable ${nt} attribute bytes differ from the resident placement`);
    }
  }
}

for (const variant of VARIANTS) {
  test(`case 4 [${variant}]: overlay instructions execute banked; the terrain read re-enters banked code with the battle bank; the field and rendering are restored and match the resident placement`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
    const [run, twin] = await Promise.all([runBanked(variant), runTwin(variant)]);
    assert.equal(twin.banked, false, `${variant}: the twin must be the resident placement`);
    assertBankedExecution(variant, run, twin);
    const s = run.stats;
    console.log(
      `S10B case4 ${variant}: ${s.bankedInstr} banked instructions, ${s.dispatchHits} entries, ${s.terrainReads} terrain reads (${s.terrainMoved} moved the window), ` +
        `${run.checkpoints.length} checkpoints identical to the resident twin`
    );
  });
}

// The comparison must not be vacuous: the observed dialogue really draws glyphs. "Hello" is in the
// Observer's first line (Save variant: the committed NPC's own line contains "mill").
test('case 4: the rendered checkpoints actually contain the typed text (the comparison is not of two blank boxes)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const run = await runBanked('nosave');
  assert.ok(rowContains(run.checkpoints[0].nt, 'Hello'), 'the first checkpoint must show the typed word "Hello"');
});

/** Is the tile sequence for `word` present contiguously in any nametable row? */
function rowContains(nt, word) {
  const needle = [...word].map((c) => charToTile(c));
  for (const table of nt) {
    for (let row = 0; row < 30; row++) {
      const cells = table.tile.slice(row * 32, row * 32 + 32);
      for (let x = 0; x + needle.length <= 32; x++) {
        if (needle.every((t, k) => cells[x + k] === t)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// B7 -- H4's carriers: the glyph rides call_battle in bt_arg, so a carrier clobbered across the
// trampoline shows as wrong glyphs on screen (runtime, not a source check).
// ---------------------------------------------------------------------------------------------

test('B7: the typed glyphs survive call_battle (bt_arg carrier), checked against tiles derived from the text itself', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const run = await runBanked('nosave');
  for (const word of ['Hello', 'there', 'traveler']) {
    assert.ok(rowContains(run.checkpoints[0].nt, word), `"${word}" must be rendered from its own glyphs`);
  }
  assert.ok(rowContains(run.checkpoints[1].nt, 'Second'), 'the second page must render "Second"');
});

// ---------------------------------------------------------------------------------------------
// B5 -- H1: an overlay entry never cancels the in-flight strip PENDING is waiting on.
// Same scenario as streamworlddialogue.test.js case 8 (a real strip armed through
// sw_stream_start_col, then B), run on the RELOCATED build: with call_battle's cancel applied to
// the BE_DLG_PENDING entry the strip would be killed on the first PENDING frame and st_cur could
// never reach st_len.
// ---------------------------------------------------------------------------------------------

async function pendingWithRealStrip(mutate = null) {
  const { project, slot } = buildPinching('nosave');
  if (mutate) mutate(project);
  const { nes, mem, addrOf, symbols } = await buildAndBoot(project);
  assert.ok(hasSymbol(symbols, 'sw_dlg_banked_start'), 'the project must be relocated');
  assert.ok(walkToEntity(nes, mem, slot), 'the player must reach the Observer');
  const paused = { pc: nes.cpu.REG_PC, a: nes.cpu.REG_ACC, x: nes.cpu.REG_X, y: nes.cpu.REG_Y, p: nes.cpu.getStatus() };
  nes.cpu.REG_ACC = mem[RAM.win_col_screen];
  nes.cpu.REG_X = mem[RAM.win_col_local];
  callRoutine(nes, addrOf('sw_stream_start_col'));
  assert.equal(mem[RAM.st_active], 1, 'setup: the strip must be armed');
  nes.cpu.REG_PC = paused.pc;
  nes.cpu.REG_ACC = paused.a;
  nes.cpu.REG_X = paused.x;
  nes.cpu.REG_Y = paused.y;
  nes.cpu.setStatus(paused.p);
  nes.mmap.write(0x2000, 0x88 | (mem[RAM.cam_nt] & 3));
  press(nes, BTN.B, 0);
  assert.equal(mem[RAM.sw_dlg15_state], 1, 'PENDING must hold while the strip drains');
  let frames = 0;
  let sawProgress = false;
  let last = mem[RAM.st_cur];
  while (mem[RAM.sw_dlg15_state] === 1 && frames < 40) {
    nes.frame();
    frames++;
    if (mem[RAM.st_cur] !== last) sawProgress = true;
    last = mem[RAM.st_cur];
  }
  return { mem, frames, sawProgress };
}

function assertStripDrained({ mem, frames, sawProgress }) {
  assert.ok(frames < 40, 'PENDING must resolve: the strip has to finish draining, not be cancelled');
  assert.ok(sawProgress, 'st_cur must advance across the PENDING frames -- the strip really drained');
  assert.equal(mem[RAM.st_cur], mem[RAM.st_len], 'the strip must complete all of its blocks (an overlay entry must not cancel it)');
  assert.equal(mem[RAM.st_active], 0);
  assert.notEqual(mem[BOX_STATE], 0, 'the box must open once the strip finished');
}

test('B5: a strip in flight when the box opens drains to completion through the banked PENDING entry (call_banks skips the cancel for BE_DLG_*)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  assertStripDrained(await pendingWithRealStrip());
});

// ---------------------------------------------------------------------------------------------
// Sabotage: each mutant is a project.code override of a stock engine file (never edited on disk)
// and the check above must fail on it.
// ---------------------------------------------------------------------------------------------

function mutateOnce(text, needle, replacement, label) {
  const parts = text.split(needle);
  assert.equal(parts.length - 1, 1, `sabotage setup: ${JSON.stringify(needle)} must appear exactly once (${label})`);
  return parts.join(replacement);
}

const override = (name, text) => (project) => {
  project.code = { overrides: [{ name, text }], files: [] };
};

const TERRAIN_RESELECT = 'sw_dlg_terrain_read:\n  jsr sw_terrain_or_fill\n  pha\n  lda #BATTLE_BANK\n  jsr switch_prg_bank\n  pla\n  rts\n';

/** Sabotage 4a/4b/4c: `mutate`/`romPatch` build a wrong terrain re-select; the run must die at the
 * banked-return assertion -- a BankedReturnError thrown at the first fetch after the routine's rts
 * -- and nowhere else (no catch-all: an emulator crash or any other exception fails the test).
 * The error must name the stock run's own return address and the bank the mutant left selected. */
async function assertDiesAtBankedReturn({ mutate, romPatch = null, expectBank }) {
  const stock = await runBanked('nosave');
  assert.ok(stock.stats.returnPcs.length > 0, 'precondition: the stock run checked at least one terrain return');
  await assert.rejects(runHooked('nosave', { mutate, romPatch }), (err) => {
    assert.ok(err instanceof BankedReturnError, `must fail at the banked-return assertion, not elsewhere: ${err?.stack ?? err}`);
    assert.equal(err.tag, 'banked-return');
    assert.equal(err.pc, stock.stats.returnPcs[0], `the failing instruction must be the first one after the FIRST terrain read's rts ($${stock.stats.returnPcs[0].toString(16)})`);
    assert.ok(err.inBanked, 'that address is inside the banked overlay (the return address is overlay code)');
    assert.notEqual(err.bank, stock.battleBank, 'the selected bank is not the battle bank');
    assert.equal(err.bank, expectBank(stock), 'the error must report the bank the mutant left selected');
    assert.match(err.message, new RegExp(`\\$${err.pc.toString(16)}\\b.*PRG bank ${err.bank} selected`), 'the message must quote the address and the selected bank');
    return true;
  });
}

// The unused bank the benign-bank control fills with a copy of the battle bank.
const BENIGN_BANK_OFFSET = 16;
function copyBattleBankIntoUnusedBank(rom, { battleBank }) {
  const size = 16384;
  const src = 16 + battleBank * size;
  const dst = 16 + (battleBank + BENIGN_BANK_OFFSET) * size;
  assert.ok(dst + size <= rom.length, `the ROM must contain bank ${battleBank + BENIGN_BANK_OFFSET}`);
  assert.ok(rom.subarray(dst, dst + size).every((b) => b === rom[dst]), `precondition: bank ${battleBank + BENIGN_BANK_OFFSET} must be unused (uniform fill)`);
  rom.set(rom.slice(src, src + size), dst);
}

test('sabotage 4a: a terrain routine that skips its re-select dies at the banked-return assertion, naming the next instruction and the field bank', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const mutant = mutateOnce(engine('streamworld.asm'), TERRAIN_RESELECT, 'sw_dlg_terrain_read:\n  jsr sw_terrain_or_fill\n  pha\n  pla\n  rts\n', '4a');
  await assertDiesAtBankedReturn({ mutate: override('streamworld.asm', mutant), expectBank: (stock) => stock.before.bank });
});

test('sabotage 4b: a terrain routine that re-selects the wrong bank dies at the banked-return assertion, naming the next instruction and that bank', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const mutant = mutateOnce(engine('streamworld.asm'), TERRAIN_RESELECT, TERRAIN_RESELECT.replace('lda #BATTLE_BANK', 'lda #BATTLE_BANK+1'), '4b');
  await assertDiesAtBankedReturn({ mutate: override('streamworld.asm', mutant), expectBank: (stock) => stock.battleBank + 1 });
});

test('sabotage 4c: a re-select of a benign wrong bank (a copy of the battle bank, so it would not crash) still dies at the banked-return assertion', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const mutant = mutateOnce(engine('streamworld.asm'), TERRAIN_RESELECT, TERRAIN_RESELECT.replace('lda #BATTLE_BANK', `lda #BATTLE_BANK+${BENIGN_BANK_OFFSET}`), '4c');
  await assertDiesAtBankedReturn({
    mutate: override('streamworld.asm', mutant),
    romPatch: copyBattleBankIntoUnusedBank,
    expectBank: (stock) => stock.battleBank + BENIGN_BANK_OFFSET
  });
});

test('sabotage 4c (control): with the battle bank copied into the unused bank and the STOCK routine, the conversation runs clean', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const run = await runHooked('nosave', { romPatch: copyBattleBankIntoUnusedBank });
  assert.deepEqual(run.stats.badReturns, []);
  assert.ok(run.stats.terrainReturns > 0);
});

test('sabotage B5: call_battle cancelling the strip on a BE_DLG_* entry kills the strip PENDING waits on', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const banks = engine('banks.asm');
  const mutant = mutateOnce(banks, '  cmp #BE_DLG_FIRST\n  bcs call_battle_strip_cancel_done\n', '  cmp #BE_DLG_FIRST\n  nop\n  nop\n', 'B5');
  await assert.rejects(
    async () => assertStripDrained(await pendingWithRealStrip(override('banks.asm', mutant))),
    /PENDING must hold while the strip drains|PENDING must resolve|st_cur must advance|must complete all of its blocks/
  );
});

test('sabotage B7: a bt_arg carrier clobbered across the trampoline yields wrong glyphs, caught at runtime', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const banks = engine('banks.asm');
  const mutant = mutateOnce(banks, 'call_battle_strip_cancel_done:\n  .endif\n  lda #BATTLE_BANK\n', 'call_battle_strip_cancel_done:\n  .endif\n  lda #0\n  sta <bt_arg\n  lda #BATTLE_BANK\n', 'B7');
  const run = await runHooked('nosave', { mutate: override('banks.asm', mutant) });
  assert.equal(rowContains(run.checkpoints[0].nt, 'Hello'), false, 'with the glyph carrier clobbered the word must not render');
});

test('sabotage B6: dropping the region refusal lets an overflowing relocated overlay through', { skip: !hasNesasm && 'nesasm not found on PATH' }, () => {
  // The refusal is one branch of generate.js; the check that pins it is refusedForRegion above.
  // This case only proves the precondition the mutant would exploit: without the refusal nothing
  // else stops the project (its content fits the relocated ceiling and every other capacity).
  const { project } = buildPinching('nosave');
  withSpells(project, 115);
  const others = checkCapacity(project).problems.filter((x) => x.severity === 'error' && !/dialogue code moves into/.test(x.message));
  assert.deepEqual(others, [], 'the region refusal must be the only thing standing between this project and a broken build');
});
