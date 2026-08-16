#!/usr/bin/env node
// Builds the two ROMs the Mesen SRAM verification (save_sram.lua) runs
// against: the checked-in sample-mmc1/ and sample-mmc3/ fixtures, one per
// battery-capable board. Each already carries a live Save command reachable by
// touch and enough state worth restoring that a wrong load is visible -- a
// switch, a variable, a screen that is not the start screen, and an inventory
// item -- so this script builds them and reports, rather than assembling a
// project of its own.
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
// basename (confirmed empirically), and both fixtures build as "game.nes",
// so run_sram_check.sh's two boards would otherwise share one save slot and
// each would "load" the other's save.
//
// Prints, per board: the ROM path and whether iNES byte 6 bit 1 (the battery
// flag) is set -- Mesen will not persist a .sav for a ROM that does not declare
// one, so this is the first thing to check before trusting any result out of
// save_sram.lua.
//
// Optionally pass --break=mmc3-a001, --break=mmc1-disable or
// --break=mmc3-no-write
// to build with one of the register sequences this whole effort exists to
// verify deliberately broken, for the negative-control runs. The broken ROM is
// copied out to <outDir> like any other, so Mesen still has something to fail
// against; then engine/banks.asm is restored in a `finally` and both fixtures
// are rebuilt clean, so a break run leaves neither a patched source file nor a
// knowingly-broken game.nes at the path an ordinary build writes to.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sram-roms';

const BOARDS = [
  { key: 'mmc1', dir: path.join(ROOT, 'sample-mmc1') },
  { key: 'mmc3', dir: path.join(ROOT, 'sample-mmc3') }
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
  return { key, namedPath, headerByte6: rom[6], batteryBit: (rom[6] & 0x02) !== 0 };
}

async function buildAll({ copyOut, label }) {
  await fs.promises.mkdir(outDir, { recursive: true });
  for (const board of BOARDS) {
    const result = await buildBoard(board, { copyOut });
    console.log(
      `${result.key}: ${result.namedPath ?? 'rebuilt in place'} ` +
        `header[6]=0x${result.headerByte6.toString(16).padStart(2, '0')} battery=${result.batteryBit}${label}`
    );
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
