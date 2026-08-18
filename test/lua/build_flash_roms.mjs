#!/usr/bin/env node
// Builds the ROM the Mesen flash verification (save_flash.lua) runs against:
// the checked-in sample-u512/ fixture, UNROM 512's own entry in the
// save-check family (CLAUDE.md's "fixtures, deliberately") -- flash-backed,
// not battery, which is exactly why it needs its own harness rather than
// sharing build_sram_roms.mjs's. One board, unlike build_sram_roms.mjs's two
// -- kept as the same loop-over-BOARDS
// shape anyway, rather than inlined straight-line code, because a shape that
// only works for exactly one entry is not actually simpler than one that
// works for any number: the day a second flash-capable board exists, this
// degenerates back into build_sram_roms.mjs's own shape for free.
//
//   node test/lua/build_flash_roms.mjs [outDir] [--break=<mode>]
//
// Builds in place, into sample-u512/'s own build/ -- the same thing
// `npm run build:sample:u512` does -- then copies the ROM to
// <outDir>/flash_u512.nes. The rename mirrors build_sram_roms.mjs's own for
// the same reason: Mesen's flash artifact is a `<romBasename>.ips` file
// (Core/Shared/BatteryManager.cpp's GetBasePath, confirmed by parsing one
// directly during phase 2.5's step A), keyed off the ROM's basename exactly
// like a .sav, so a bare "game.nes" here would share Mesen's Saves directory
// with whatever else was last built under that name -- including, on this
// machine, the SRAM fixtures' own leftover .sav files, which are a different
// artifact but the same directory.
//
// --break=<mode> builds one of four variants, three real breaks and one
// positive control -- "break" stays the flag name because all four reuse the
// same machinery below (MODES, applyBreak, stripSaverGuard), not because all
// four are breaks:
//
//   u512-no-unlock          engine/flash.asm's JEDEC unlock write dropped
//   u512-bad-cmd-addr       engine/flash.asm's command byte misaddressed
//   u512-no-erase           engine/flash.asm's sector erase removed, and the
//                           saver's guard relaxed so a second commit happens
//                           to actually exercise it
//   u512-second-commit-ok   the saver's guard relaxed the same way, but
//                           engine/flash.asm is left untouched -- see
//                           test/lua/run_flash_check.sh's own header for why
//                           this positive control exists and what it proves
//                           that u512-no-erase alone cannot
//
// engine/flash.asm is restored in a `finally` and the fixture rebuilt clean
// whenever it was patched at all, the same discipline build_sram_roms.mjs
// already holds itself to, for the same reason: a break run must not leave a
// patched source file or a knowingly-broken game.nes sitting where an
// ordinary build writes to.
//
// u512-no-erase and u512-second-commit-ok both need a *second* commit to the
// same sector to be observable at all (see save_flash.lua's phase 4.4
// comment for why), which the checked-in fixture's switch-guarded saver page
// cannot produce on its own -- so, for these two only, the saver's page
// condition is relaxed from switchOff(0) to unconditional in an in-memory
// copy of the project, which is then built in a fresh `mkdtemp` directory
// rather than sample-u512/ itself -- CLAUDE.md's rule ("variants go to
// mkdtemp directories") applies to this the same as anywhere else:
// sample-u512/project.json is never touched (nothing here can write it,
// since the mutated project is only ever handed to saveProject with the temp
// directory as its target), and neither is sample-u512/build/ -- an
// interrupted run leaves a stray temp directory, never a knowingly-wrong ROM
// at the path an ordinary build writes to.
//
// Prints, per board: the ROM path and whether the header declares this a
// flash-save build (checked the same way build_sram_roms.mjs checks the
// battery bit, so a silently-non-persisting build fails loudly here rather
// than inside Mesen).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-flash-roms';

const BOARDS = [{ key: 'u512', dir: path.join(ROOT, 'sample-u512') }];

// The single table describing every --break=<mode> value: whether it needs
// the saver's guard relaxed (and so a mkdtemp build), and whether it patches
// engine/flash.asm at all. See this file's own header for what each means.
const MODES = {
  'u512-no-unlock': { stripsGuard: false, patchesEngine: true },
  'u512-bad-cmd-addr': { stripsGuard: false, patchesEngine: true },
  'u512-no-erase': { stripsGuard: true, patchesEngine: true },
  'u512-second-commit-ok': { stripsGuard: true, patchesEngine: false }
};

function modeInfo(mode) {
  if (!mode) return null;
  const info = MODES[mode];
  if (!info) throw new Error(`unknown --break mode: ${mode}`);
  return info;
}

/**
 * Relax sample-u512's saver page from switchOff(0) to unconditional, for any
 * mode whose MODES entry sets stripsGuard. In-memory only -- see this file's
 * own header.
 */
function stripSaverGuard(project, mode) {
  const page = project.maps[0].screens[1].entities[0].props.event.pages[0];
  if (page.cond?.type !== 'switchOff') {
    throw new Error(`${mode}: expected the saver page to open on switchOff(0) -- fixture shape changed`);
  }
  page.cond = { type: 'none', arg: 0 };
}

/**
 * Build one board and copy its ROM out under a board-specific name. Builds
 * in place, into the fixture's own build/ -- the same thing
 * `npm run build:sample:u512` does -- unless the guard-relaxed variant is
 * needed (MODES[mode].stripsGuard), in which case it builds in a throwaway
 * `mkdtemp` directory instead; see this file's own header for why.
 */
async function buildBoard({ key, dir }, { copyOut, breakMode: mode }) {
  const project = await loadProject(dir);
  let buildDir = dir;
  let tempDir = null;
  if (mode && MODES[mode].stripsGuard) {
    stripSaverGuard(project, mode);
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flash-guard-relaxed-'));
    await saveProject(tempDir, project);
    buildDir = tempDir;
  }
  try {
    const built = await buildProject({ dir: buildDir, project, log: () => {} });
    const rom = await fs.promises.readFile(built.romPath);
    let namedPath = null;
    if (copyOut) {
      namedPath = path.join(outDir, `flash_${key}.nes`);
      await fs.promises.writeFile(namedPath, rom);
    }
    // iNES byte 6 bit 1 is the same battery flag UNROM 512 reuses for flash
    // save (see engine/main.asm's header patch) -- flash builds set it
    // exactly as a battery build would, since it is the same "this
    // cartridge persists" signal to Mesen either way.
    return { key, namedPath, builtIn: tempDir ?? 'in place', headerByte6: rom[6], persists: (rom[6] & 0x02) !== 0 };
  } finally {
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function buildAll({ copyOut, label, breakMode: mode }) {
  await fs.promises.mkdir(outDir, { recursive: true });
  for (const board of BOARDS) {
    const result = await buildBoard(board, { copyOut, breakMode: mode });
    console.log(
      `${result.key}: built in ${result.builtIn} -> ${result.namedPath ?? '(not copied out)'} ` +
        `header[6]=0x${result.headerByte6.toString(16).padStart(2, '0')} persists=${result.persists}${label}`
    );
  }
}

const flashPath = path.join(ROOT, 'engine/flash.asm');
const originalFlash = await fs.promises.readFile(flashPath, 'utf8');

function applyBreak(source, mode) {
  if (mode === 'u512-no-unlock') {
    // Drop the first of the JEDEC unlock's two writes ($AA -> chip $5555).
    // FlashSST39SF040.h resets its own write-cycle counter to 0 the moment an
    // expected unlock byte does not land, so every operation this driver
    // ever issues after this -- both the erase and every byte program in the
    // loop, since they all route through this one fd_unlock -- becomes a
    // silent no-op: the sector never leaves its blank state and the marker
    // never validates.
    const needle =
      'fd_unlock:\n  lda #1\n  sta $C000\n  lda #$AA\n  sta $9555\n  lda #0\n  sta $C000\n  lda #$55\n  sta $AAAA\n  rts';
    if (!source.includes(needle)) throw new Error('u512-no-unlock break: pattern not found in engine/flash.asm');
    return source.replace(
      needle,
      'fd_unlock:\n  lda #1\n  sta $C000\n  ; u512-no-unlock break: first unlock write ($AA -> $9555) removed\n  lda #0\n  sta $C000\n  lda #$55\n  sta $AAAA\n  rts'
    );
  }
  if (mode === 'u512-bad-cmd-addr') {
    // Send the command byte (erase-setup $80 or program-setup $A0) to $9556
    // instead of $9555 -- one byte off, landing outside the address Mesen's
    // flash model is watching for the unlock sequence's third write. Same
    // consequence as u512-no-unlock: the cycle counter resets and the whole
    // commit silently does nothing.
    const needle = 'fd_cmd5555:\n  pha\n  lda #1\n  sta $C000\n  pla\n  sta $9555\n  rts';
    if (!source.includes(needle)) throw new Error('u512-bad-cmd-addr break: pattern not found in engine/flash.asm');
    return source.replace(
      needle,
      'fd_cmd5555:\n  pha\n  lda #1\n  sta $C000\n  pla\n  sta $9556                  ; u512-bad-cmd-addr break: off by one\n  rts'
    );
  }
  if (mode === 'u512-no-erase') {
    // Remove the sector erase entirely -- the byte-program loop still runs.
    // A byte program on this chip can only clear bits (AND), never set one,
    // so the *first* commit to a freshly-blank ($FF) sector is unaffected --
    // this only bites a *second* commit to the same sector, which is exactly
    // why this mode (and u512-second-commit-ok, its positive-control
    // counterpart) relax the fixture's switch guard (see stripSaverGuard
    // above) and save_flash.lua carries a dedicated retouch phase (4.1-4.4)
    // to produce that second commit.
    const needle =
      "flash_commit_driver:\n  ; --- erase the 4 KB sector at bank SAVE_BANK's $B000-$BFFF --------------\n" +
      '  jsr $0600+(fd_unlock-flash_commit_driver)\n' +
      '  lda #$80\n' +
      '  jsr $0600+(fd_cmd5555-flash_commit_driver)\n' +
      '  jsr $0600+(fd_unlock-flash_commit_driver)\n' +
      '  lda #SAVE_BANK\n' +
      '  sta $C000\n' +
      '  lda #$30\n' +
      '  sta $B000\n' +
      '  jsr $0600+(fd_poll-flash_commit_driver)\n' +
      '\n' +
      '  ; --- program SAVE_RECORD_LEN bytes from the RAM buffer -------------------';
    if (!source.includes(needle)) throw new Error('u512-no-erase break: pattern not found in engine/flash.asm');
    return source.replace(
      needle,
      'flash_commit_driver:\n  ; u512-no-erase break: sector erase removed entirely -- a second commit\n' +
        '  ; to this sector can only clear bits the first commit left set, never set\n' +
        '  ; one back, so it silently corrupts rather than failing outright\n' +
        '\n  ; --- program SAVE_RECORD_LEN bytes from the RAM buffer -------------------'
    );
  }
  throw new Error(`unknown --break mode: ${mode}`);
}

const info = modeInfo(breakMode);
const label = breakMode ? (info.patchesEngine ? ` BROKEN(${breakMode})` : ` CONTROL(${breakMode})`) : '';

try {
  if (breakMode && info.patchesEngine) {
    const broken = applyBreak(originalFlash, breakMode);
    await fs.promises.writeFile(flashPath, broken);
    console.log(`[build_flash_roms] engine/flash.asm patched: --break=${breakMode}`);
  }
  await buildAll({ copyOut: true, label, breakMode });
} finally {
  if (breakMode && info.patchesEngine) {
    await fs.promises.writeFile(flashPath, originalFlash);
    const restored = await fs.promises.readFile(flashPath, 'utf8');
    if (restored !== originalFlash) throw new Error('engine/flash.asm failed to restore cleanly');
    // The copy in outDir stays broken (and, for either guard-relaxed mode,
    // the project stays relaxed in memory only -- nothing was ever written
    // back to sample-u512/project.json) -- Mesen has not run yet and that
    // ROM is the point of the run. Only engine/flash.asm and the fixture's
    // own build/ are put back.
    console.log('[build_flash_roms] engine/flash.asm restored; rebuilding fixture build/ clean');
    await buildAll({ copyOut: false, label: '', breakMode: null });
  }
}
