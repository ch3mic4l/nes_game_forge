#!/usr/bin/env node
// Builds the three ROMs the Mesen SRAM verification (save_sram.lua) runs
// against: the checked-in sample-mmc1/, sample-mmc3/ and sample-rpg-mmc1/
// fixtures. Each already carries a live Save command reachable by touch and
// enough state worth restoring that a wrong load is visible -- a switch, a
// variable, a screen that is not the start screen, and an inventory item, plus
// (on sample-rpg-mmc1/ alone) a second party member recruited by a field Join
// moments before the Save -- so this script builds them and reports, rather
// than assembling a project of its own.
//
//   node test/lua/build_sram_roms.mjs [outDir] [--break=<mode>]
//
// This replaced an earlier version that copied sample-rpg/ into /tmp and
// grafted a second screen and a saver NPC onto the copy at build time. The
// fixtures say the same thing in project JSON, where it can be opened in the
// app and looked at, so the graft is gone; what is left here is the ROM naming
// and the --break machinery, neither of which has anywhere else to live.
//
// Builds in place, into each fixture's own build/ -- the same thing
// `npm run build:sample:mmc1` does, so the ROM verified is the ROM an author
// gets. That is mutating generated output, not the fixture: build/ is
// gitignored, and sample/ and sample-rpg/ are already built in place by every
// engine test that consumes them. Nothing here writes a fixture's project JSON.
//
// Each ROM is then copied to <outDir>/sram_<board>.nes. The rename is not
// cosmetic: Mesen persists SRAM to a .sav file named after the ROM's own
// basename (confirmed empirically), and all three fixtures build as
// "game.nes", so run_sram_check.sh's boards would otherwise share one save
// slot and each would "load" another's save.
//
// Prints, per board: the ROM path and whether iNES byte 6 bit 1 (the battery
// flag) is set -- Mesen will not persist a .sav for a ROM that does not declare
// one, so this is the first thing to check before trusting any result out of
// save_sram.lua. For the rpg-mmc1 board it also prints, per party member, the
// level-1 pc_hp_max/pc_mp_max/pc_spells save_sram.lua hardcodes as
// RPG_HP_MAX/RPG_MP_MAX/RPG_SPELLS_0/RPG_SPELLS_1 -- hp_max/mp_max are
// createPartyMember() defaults with statAt(base, perLevel, 1) == base
// (main/build/battletables.js); the spell mask is computed with the identical
// catalog-position/learn-level rule battleTables' own `known` builder uses
// (this file's `spellMaskAtLevel` below reproduces it rather than hardcoding a
// literal, round 2 review finding 2), so a drift between the fixture's own
// party/spells and the Lua's copy of these numbers is visible here rather than
// only as an opaque Mesen failure.
//
// Optionally pass --break=mmc3-a001, --break=mmc1-disable,
// --break=mmc1-restore-disable or --break=mmc3-no-write to build with one of
// the register sequences this whole effort exists to verify deliberately
// broken, for the negative-control runs. --break=mmc1-disable patches
// engine/banks.asm's shared switch_prg_bank unconditionally, so it breaks BOTH
// MMC1 boards (mmc1 and rpg-mmc1) at once -- the same reason
// test/lua/run_sram_check.sh's own header says so, restated where the break is
// actually applied. --break=mmc1-restore-disable is narrower and RPG-only: it
// only sets PRG-RAM-disable while `bt_call` (engine/constants.asm) reads
// BE_RESTORE, so it exercises exactly the gap round 2 review finding 1
// describes -- WRAM goes away starting with continue_game's own
// `call_battle(BE_RESTORE)` entry switch into the battle bank (bt_call is
// already BE_RESTORE by then) and stays off through its `jmp set_screen_ptr`
// exit switch and any later PRG switch, until a later `call_battle` changes
// `bt_call` again -- and leaves mmc1 and mmc3 (whose builds never set
// `bt_call` to BE_RESTORE at all; action projects have no `call_battle`
// assembled in the first place) unaffected. Every broken
// ROM is copied out to <outDir> like any other, so Mesen still has something
// to fail against; then engine/banks.asm is restored in a `finally` and every
// fixture is rebuilt clean, so a break run leaves neither a patched source
// file nor a knowingly-broken game.nes at the path an ordinary build writes
// to.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { statAt } from '../../main/build/battletables.js';

/**
 * Reproduces battleTables' own `known` builder (main/build/battletables.js,
 * around line 257) for one member at one level, rather than hardcoding a
 * literal -- round 2 review finding 2. A spell's catalog position is its
 * index in `spells` (capped at slot 7, the same as the real table), and it is
 * known from `Math.max(1, entry.level)` onward, so it is known at `level`
 * exactly when that floor is at or below it.
 */
function spellMaskAtLevel(member, spells, level) {
  let mask = 0;
  for (const entry of member.spells ?? []) {
    const slot = spells.findIndex((spell) => spell.id === entry.spellId);
    if (slot < 0 || slot > 7) continue;
    if (Math.max(1, entry.level) <= level) mask |= 1 << slot;
  }
  return mask;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sram-roms';

const BOARDS = [
  { key: 'mmc1', dir: path.join(ROOT, 'sample-mmc1') },
  { key: 'mmc3', dir: path.join(ROOT, 'sample-mmc3') },
  { key: 'rpg-mmc1', dir: path.join(ROOT, 'sample-rpg-mmc1') }
];

/** Build one fixture in place and copy its ROM out under a board-specific name. */
async function buildBoard({ key, dir }, { copyOut }) {
  const project = await loadProject(dir);
  const built = await buildProject({ dir, project, log: () => {} });
  const rom = await fs.promises.readFile(built.romPath);
  let namedPath = null;
  if (copyOut) {
    namedPath = path.join(outDir, `sram_${key}.nes`);
    await fs.promises.writeFile(namedPath, rom);
  }
  let rpgLevel1 = null;
  if (key === 'rpg-mmc1') {
    rpgLevel1 = project.party.map((member) => ({
      name: member.name,
      hpMax: statAt(member.baseHp, member.hpPerLevel, 1),
      mpMax: statAt(member.baseMp, member.mpPerLevel, 1),
      spells: spellMaskAtLevel(member, project.spells, 1)
    }));
  }
  return { key, namedPath, headerByte6: rom[6], batteryBit: (rom[6] & 0x02) !== 0, rpgLevel1 };
}

async function buildAll({ copyOut, label }) {
  await fs.promises.mkdir(outDir, { recursive: true });
  for (const board of BOARDS) {
    const result = await buildBoard(board, { copyOut });
    console.log(
      `${result.key}: ${result.namedPath ?? 'rebuilt in place'} ` +
        `header[6]=0x${result.headerByte6.toString(16).padStart(2, '0')} battery=${result.batteryBit}${label}`
    );
    if (result.rpgLevel1) {
      result.rpgLevel1.forEach((member, index) => {
        console.log(
          `  member ${index} (${member.name}) level-1 stats (save_sram.lua's RPG_HP_MAX/RPG_MP_MAX/` +
            `RPG_SPELLS_${index}): hp_max=${member.hpMax} mp_max=${member.mpMax} spells=${member.spells}`
        );
      });
    }
  }
}

const bankPath = path.join(ROOT, 'engine/banks.asm');
const originalBanks = await fs.promises.readFile(bankPath, 'utf8');

function applyBreak(source, mode) {
  if (mode === 'mmc3-a001') {
    // The WRAM-enable write mapper_init makes for MMC3 -- $80 enables and
    // leaves it writable. $00 leaves the chip disabled/read-only, which is
    // the exact failure this whole verification exists to catch.
    const needle = '  lda #$80\n  sta $A001';
    if (!source.includes(needle)) throw new Error('mmc3-a001 break: pattern not found in engine/banks.asm');
    return source.replace(needle, '  lda #$00\n  sta $A001');
  }
  if (mode === 'mmc1-disable') {
    // Set MMC1's bit-4 PRG-RAM-disable on every PRG bank write, the mirror of
    // the mask switch_prg_bank holds clear. WRAM then goes away the first time
    // the player crosses a screen edge, which the walk does well before it
    // reaches the saver -- so the Save has nowhere to land.
    //
    // This exists because the obvious break -- deleting the `and #$0F` mask --
    // is not a negative control at all: MMC1's registry entry caps prgUnits at
    // 8, so a bank index never reaches 16 and bit 4 is already clear before the
    // shift on every project this app can build, large or small. banks.asm says
    // as much where the mask is written. Removing the mask therefore changes no
    // ROM's behaviour and its "pass" would mean nothing, so it is not offered;
    // forcing the bit on is the smallest edit that actually takes the chip away
    // on this board. What the mask defends against -- a future MMC1 entry with
    // more than 16 PRG units -- has no ROM to observe it in today.
    const needle = 'switch_prg_bank:\n  and #$0F                  ; hold PRG-RAM enabled -- see the comment above\n  sta mmc_tmp';
    if (!source.includes(needle)) throw new Error('mmc1-disable break: pattern not found in engine/banks.asm');
    return source.replace(
      needle,
      'switch_prg_bank:\n  ora #$10                  ; mmc1-disable break: PRG-RAM off on every switch\n  sta mmc_tmp'
    );
  }
  if (mode === 'mmc1-restore-disable') {
    // Narrower than mmc1-disable: only sets PRG-RAM-disable while the last
    // call_battle entry point was BE_RESTORE (bt_call, engine/constants.asm --
    // only ever written by call_battle itself, engine/banks.asm, so it can
    // never read BE_RESTORE on a run where continue_game has not run yet).
    // continue_game's own call_battle(BE_RESTORE) writes bt_call *before*
    // its first switch_prg_bank call, so WRAM goes away starting with that
    // very entry switch into the battle bank, stays off through the
    // trampoline's own `jmp set_screen_ptr` exit switch back to the screen
    // bank, and through any later PRG switch (redraw_screen's own, on this
    // walk) for as long as bt_call still reads BE_RESTORE -- i.e. until some
    // later call_battle changes it, which does not happen again on this run.
    // Exercises exactly the gap round 2 review finding 1 describes: with
    // save_sram.lua's own post-BE_RESTORE marker read (added for that
    // finding), this must FAIL (run2=EXIT_WRAM_LOST_AFTER_RESTORE); without
    // that read it PASSES, which is the hole the finding described made
    // visible by an actual negative control rather than only by inspection.
    // RPG-only: mmc1 and mmc3 are unaffected -- an action build has no
    // call_battle assembled at all (.if BATTLE_ENABLED, engine/banks.asm), so
    // bt_call is never written, let alone read as BE_RESTORE.
    const needle = 'switch_prg_bank:\n  and #$0F                  ; hold PRG-RAM enabled -- see the comment above\n  sta mmc_tmp';
    if (!source.includes(needle)) throw new Error('mmc1-restore-disable break: pattern not found in engine/banks.asm');
    return source.replace(
      needle,
      'switch_prg_bank:\n' +
        '  and #$0F                  ; mmc1-restore-disable break: PRG-RAM off once bt_call was BE_RESTORE\n' +
        '  ldx bt_call\n' +
        '  cpx #BE_RESTORE\n' +
        '  bne mmc1_restore_disable_skip\n' +
        '  ora #$10\n' +
        'mmc1_restore_disable_skip:\n' +
        '  sta mmc_tmp'
    );
  }
  if (mode === 'mmc3-no-write') {
    // Remove the $A001 write outright, rather than zeroing it -- a check on
    // Mesen's own power-on default for _wramEnabled/_wramWriteProtected
    // (MMC3.h's GetPowerOnByte()), not on the write's value. If the default
    // happens to already read as "enabled", a build that never wrote $A001
    // at all would still pass save_sram.lua, which would mean the
    // mmc3-a001 negative control above is not actually exercising the
    // write -- it would only be exercising *a specific bad value* of it.
    const needle = '  .if SAVE_ENABLED\n  ; $A001 bit 7 enables the WRAM chip at $6000-$7FFF; bit 6 write-protects it.\n  ; One write, here, for the whole session -- $80 enables and leaves it\n  ; writable, and nothing after boot ever needs it any other way. The\n  ; vendored emulator core treats $6000-$7FFF as plain RAM with no enable or\n  ; protect bits at all, so a save that works in-app and fails on real\n  ; hardware is exactly the failure a missing version of this write causes.\n  lda #$80\n  sta $A001\n  .endif';
    if (!source.includes(needle)) throw new Error('mmc3-no-write break: pattern not found in engine/banks.asm');
    return source.replace(needle, '  ; mmc3-no-write break: $A001 write removed entirely');
  }
  throw new Error(`unknown --break mode: ${mode}`);
}

try {
  if (breakMode) {
    const broken = applyBreak(originalBanks, breakMode);
    await fs.promises.writeFile(bankPath, broken);
    console.log(`[build_sram_roms] engine/banks.asm patched: --break=${breakMode}`);
  }
  await buildAll({ copyOut: true, label: breakMode ? ` BROKEN(${breakMode})` : '' });
} finally {
  if (breakMode) {
    await fs.promises.writeFile(bankPath, originalBanks);
    const restored = await fs.promises.readFile(bankPath, 'utf8');
    if (restored !== originalBanks) throw new Error('engine/banks.asm failed to restore cleanly');
    // The copies in outDir stay broken -- Mesen has not run yet and they are
    // the point of the run. Only the fixtures' own build/ is put back.
    console.log('[build_sram_roms] engine/banks.asm restored; rebuilding fixture build/ clean');
    await buildAll({ copyOut: false, label: '' });
  }
}
