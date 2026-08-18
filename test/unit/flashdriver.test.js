// engine/flash.asm's own reason for existing: a driver that runs from RAM
// survives a real program/erase operation, and the identical logic left
// running from ROM does not. mapper30.test.js already proves the busy
// model itself toggles the whole $8000-$FFFF window, fixed bank included
// (test: "the busy model, once opted into, toggles reads across the whole
// $8000-$FFFF window") -- this file is the other half: proving that
// property actually bites the *real*, shipped driver, not just a
// hand-built fixture.
//
// The two cases here build the exact same ROM and drive the exact same
// save. They differ in exactly one patched byte pair: the operand of
// save_media_commit's `jsr flash_driver`. Left alone, that JSR reaches the
// RAM copy at $0600 (flash_driver, engine/constants.asm) and the save
// completes. Retargeted at flash_commit_driver's own ROM address (read
// out of the build's own game.fns -- an assembler-decided fact, not
// something to hardcode), the CPU runs the driver's main loop straight out
// of the fixed bank instead, and the first instruction fetched from there
// after the erase command arms the busy window reads back toggling status
// as an opcode. Everything else about the two runs -- the project, the
// walk, the copy loop that seeded the RAM copy in the first place -- is
// identical, so a difference in outcome can only be the residency of the
// code that executes after that point.
//
// Patching only the entry JSR (not, say, skipping the RAM copy entirely)
// matters: flash_commit_driver's own internal calls are all
// `JSR $0600+(label-flash_commit_driver)` (see flash.asm's own header
// comment on why), which still correctly reach the RAM copy regardless of
// where the *caller* runs from. Skipping the copy would make the driver
// fail for the unrelated reason that $0600 holds nothing at all --
// conflating "never copied" with "copied, but the entry point runs from
// the wrong place." Retargeting only the entry point isolates the one
// property this file exists to prove.
//
// The two tests above prove residency matters at runtime -- they do not
// prove the driver's own code obeys flash.asm's actual rule, which is
// broader: *no absolute reference to its own internal labels*, not merely
// "the entry point must be reached via the RAM copy". `fd_unlock` and
// `fd_cmd5555` only ever run while the chip is idle (before the erase/
// program command that arms the busy window, or between one poll and the
// next unlock), so a regression from `jsr $0600+(fd_unlock-...)` to a
// plain `jsr fd_unlock` -- shorter, and what anyone would write without
// thinking about relocation -- would assemble straight to fd_unlock's ROM
// address and run correctly every single time, because idle reads of
// $8000-$FFFF are never corrupted regardless of where the JSR that reached
// them executed from. Neither test above calls fd_unlock or fd_cmd5555
// from ROM under a busy chip, so neither would notice. That leaves the
// real invariant as "absolute self-references are fine as long as they
// happen to only ever run while the chip is idle" -- true of the driver
// today by construction, not by any check, and false the moment a helper
// this reasoning does not already cover is added.
//
// Testing the rule itself, not a consequence of it that depends on when
// each helper happens to be called, means testing position-independence
// directly: assemble the driver twice, at two different ROM addresses, and
// require byte-for-byte identical output. Relative branches encode offsets
// from themselves, and `$0600+(label-flash_commit_driver)` is a compile-
// time constant independent of where flash_commit_driver itself lands --
// both survive relocation by construction, so both builds emit the same
// bytes regardless of address. An absolute reference to an internal label
// encodes that label's *ROM* address as an operand, which is exactly the
// one thing guaranteed to differ between two builds that place the driver
// at two different addresses -- whether or not the reference happens to be
// safe to execute at the moment anything calls it. Getting two different
// addresses needs no synthetic assembly harness: sample-rpg's own filler
// actors (the same device kernelbytes.test.js's own `inflate` uses) add
// bytes to kernel-lo's lookup-table region ahead of the code, which shifts
// every label after it, `flash_commit_driver` included, without changing
// what the driver itself assembles to.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const INES_HEADER = 16;

// From engine/constants.asm -- the RAM address save_media_commit copies the
// driver to and then JSRs. Not read out of game.fns: nesasm only emits
// labels there, not plain equates, and this one is a literal the driver's
// own JSR encodes at compile time (see flash.asm's header), so hardcoding
// it here is checking the same fact the engine relies on, not guessing it.
const FLASH_DRIVER_RAM_ADDR = 0x0600;

// Same sector geometry flashsave.test.js hardcodes, for the same reason
// (reading it back out of the build under test would prove nothing).
const SAVE_BANK = 30;
const SECTOR_OFFSET = 0x3000;
const SAVE_RECORD_LEN = 87;
const SAVE_MARKER_OFFSET = SAVE_RECORD_LEN - 1;
const SAVE_MARKER_VALID = 0xa5;

const START = 3;
const RIGHT = 7;
const LEFT = 6;
const DOWN = 5;
const UP = 4;

function sectorMarker(nes) {
  return nes.rom.rom[SAVE_BANK][SECTOR_OFFSET + SAVE_MARKER_OFFSET];
}

/**
 * Same shape as flashsave.test.js's own buildFlashSaveable: sample-rpg on
 * UNROM 512, one touch-triggered Save. `fillerActors` pads kernel-lo's
 * lookup-table region with harmless dummy actors (the same device
 * kernelbytes.test.js's own `inflate` uses), which shifts every label after
 * it in the fixed bank -- flash_commit_driver included -- without changing
 * a single byte of the driver's own code. That is what the relocation test
 * below uses to get two builds with the driver at two different ROM
 * addresses, with no synthetic assembly harness needed.
 */
async function buildFlashSaveable(t, fillerActors = 0) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flashdriver-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 30; // UNROM 512
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  const saverId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  project.maps[0].screens[0].entities.push({
    actorId: saverId,
    x: 64,
    y: 96,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] }
    }
  });
  const template = project.sprites.actors[0];
  for (let i = 0; i < fillerActors; i++) {
    project.sprites.actors.push({ ...structuredClone(template), id: 2000 + i, name: `Filler${i}` });
  }
  await saveProject(dir, project);
  return buildProject({ dir, project, log: () => {} });
}

/**
 * The file offset of save_media_commit's `jsr flash_driver` (bytes
 * $20 $00 $06), found by scanning forward from the routine's own address
 * rather than assumed at a fixed distance -- the exact instructions ahead
 * of it are an implementation detail this test has no business pinning.
 */
function findEntryJsrOffset(romBytes, symbols) {
  const romCount = romBytes[4];
  const fixedBankFileBase = INES_HEADER + (romCount - 1) * 16384;
  const start = fixedBankFileBase + (symbols.save_media_commit - 0xc000);
  for (let offset = start; offset < start + 64; offset++) {
    if (romBytes[offset] === 0x20 && romBytes[offset + 1] === (FLASH_DRIVER_RAM_ADDR & 0xff) && romBytes[offset + 2] === (FLASH_DRIVER_RAM_ADDR >> 8)) {
      return offset;
    }
  }
  throw new Error("did not find save_media_commit's jsr flash_driver within 64 bytes of its own start");
}

/** Walk toward the saver, no early exit, so the caller can decide for itself whether the marker ever validated. */
function walkTowardSaver(nes, budget) {
  for (let i = 0; i < budget; i++) {
    if (sectorMarker(nes) === SAVE_MARKER_VALID) return;
    const dx = 64 - nes.cpu.mem[PLAYER_X];
    const dy = 96 - nes.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) return;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
}

function bootToGameplay(romBytes) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(romBytes));
  for (let i = 0; i < 60; i++) nes.frame();
  nes.buttonDown(1, START);
  nes.frame();
  nes.buttonUp(1, START);
  for (let i = 0; i < 10; i++) nes.frame();
  return nes;
}

test(
  'the shipped driver commits a flash save while the chip is genuinely busy',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const built = await buildFlashSaveable(t);
    const romBytes = fs.readFileSync(built.romPath);

    const nes = bootToGameplay(romBytes);
    nes.mmap.flash.emulateBusy = true;
    nes.mmap.flash.busyReadCycles = 8;

    walkTowardSaver(nes, 400);
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the RAM-resident driver should survive a genuinely busy chip');
  }
);

test(
  "the same driver, entered straight from ROM instead of the RAM copy, does not survive a busy chip",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const built = await buildFlashSaveable(t);
    const originalBytes = fs.readFileSync(built.romPath);
    const symbols = parseSymbolFile(await fs.promises.readFile(built.symbolPath, 'utf8'));
    assert.equal(typeof symbols.flash_commit_driver, 'number', "game.fns should name flash_commit_driver's ROM address");
    assert.equal(typeof symbols.save_media_commit, 'number', "game.fns should name save_media_commit's own address");

    const patched = Buffer.from(originalBytes);
    const entryJsrOffset = findEntryJsrOffset(patched, symbols);
    const romTarget = symbols.flash_commit_driver;
    patched[entryJsrOffset + 1] = romTarget & 0xff;
    patched[entryJsrOffset + 2] = (romTarget >> 8) & 0xff;

    // Sanity: prove the patch actually retargets the call, not merely that
    // some byte somewhere changed.
    assert.notEqual(romTarget, FLASH_DRIVER_RAM_ADDR, 'the ROM address must actually differ from the RAM copy for this patch to mean anything');

    const nes = bootToGameplay(patched);
    nes.mmap.flash.emulateBusy = true;
    nes.mmap.flash.busyReadCycles = 8;

    let threw = null;
    try {
      walkTowardSaver(nes, 400);
    } catch (error) {
      threw = error;
    }

    // A busy read returning status as an opcode does not read as "wrong
    // data" -- it derails the CPU outright (an invalid opcode, or a jump
    // through whatever garbage address the corrupted stream produces), so
    // the two honest outcomes are a hard failure or a save that silently
    // never completes. Either is proof the entry point's residency
    // mattered; a validated marker would be the one outcome that could not
    // happen if the property this file exists to prove were false.
    assert.ok(
      threw || sectorMarker(nes) !== SAVE_MARKER_VALID,
      'running the driver from ROM during a busy chip should not produce a validated save'
    );
  }
);

/**
 * The driver's exact byte span in a build's fixed bank, `flash_commit_driver`
 * through (not including) `flash_commit_driver_end` -- a real label flash.asm
 * places immediately after the driver's own last byte, and the same one its
 * own `flash_commit_driver_len` equate (the copy loop's bound) is computed
 * from. One boundary, not "whatever assembles next": `save_media_fetch`
 * (save.asm) used to stand in for it, but save_checksum actually sits
 * between the driver's true end and that label, so that span silently
 * covered 111 bytes of unrelated save.asm code alongside the real 97-byte
 * driver -- comparing bytes this test has no business comparing, and ready
 * to report a diff in save.asm as a relocation violation the day either
 * file changes. Reading the boundary out of game.fns rather than
 * hardcoding it is the same reasoning findEntryJsrOffset above already
 * applies: an assembler-decided fact, not something to guess at from
 * source and risk drifting from.
 */
function driverBytes(romBytes, symbols) {
  const romCount = romBytes[4];
  const fixedBankFileBase = INES_HEADER + (romCount - 1) * 16384;
  const start = fixedBankFileBase + (symbols.flash_commit_driver - 0xc000);
  const length = symbols.flash_commit_driver_end - symbols.flash_commit_driver;
  assert.ok(length > 0 && length < 4096, `flash_commit_driver..flash_commit_driver_end span (${length}) looks implausible`);
  return romBytes.subarray(start, start + length);
}

test(
  'the driver assembles to identical bytes at two different ROM addresses',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const short = await buildFlashSaveable(t, 0);
    // Enough filler actors to measurably move flash_commit_driver without
    // risking the kernel-lo margin -- this build already carries a touch
    // event and a Saver actor of its own on top of sample-rpg's base
    // content, so it has less headroom than kernelbytes.test.js's own
    // Save-alone measurement; 15 stays comfortably inside it.
    const long = await buildFlashSaveable(t, 15);

    const shortBytes = fs.readFileSync(short.romPath);
    const longBytes = fs.readFileSync(long.romPath);
    const shortSymbols = parseSymbolFile(await fs.promises.readFile(short.symbolPath, 'utf8'));
    const longSymbols = parseSymbolFile(await fs.promises.readFile(long.symbolPath, 'utf8'));

    const shortAddr = shortSymbols.flash_commit_driver;
    const longAddr = longSymbols.flash_commit_driver;
    assert.notEqual(shortAddr, longAddr, 'the filler actors should have moved flash_commit_driver to a different ROM address -- otherwise this proves nothing');

    // The two full addresses differing is not enough: a byte-level compare
    // only exercises whichever operand byte(s) actually change between the
    // two origins, so if the padding above ever happened to land on two
    // addresses sharing a high byte (or a low byte), a reference that only
    // encodes the *other* byte -- `lda #>fd_unlock`, say, which this file's
    // own source guard below is what actually enforces against -- could
    // still emit identical bytes at both origins and this test would report
    // "identical" while quietly having stopped checking half of what an
    // absolute reference could get wrong. Asserting both bytes differ, and
    // failing loudly naming the actual addresses if they ever don't, is
    // what keeps a future change to the filler count (or to whatever else
    // shifts this address) from silently narrowing what "identical bytes"
    // is even capable of catching.
    assert.notEqual(
      shortAddr & 0xff,
      longAddr & 0xff,
      `the two origins share a low byte ($${shortAddr.toString(16)} vs $${longAddr.toString(16)}) -- ` +
        'the byte-equality check below can no longer distinguish a low-byte-only reference from a real match; ' +
        'change the filler count until the low bytes differ too'
    );
    assert.notEqual(
      (shortAddr >> 8) & 0xff,
      (longAddr >> 8) & 0xff,
      `the two origins share a high byte ($${shortAddr.toString(16)} vs $${longAddr.toString(16)}) -- ` +
        'the byte-equality check below can no longer distinguish a high-byte-only reference (e.g. `lda #>fd_unlock`) ' +
        'from a real match; change the filler count until the high bytes differ too'
    );

    const shortDriver = driverBytes(shortBytes, shortSymbols);
    const longDriver = driverBytes(longBytes, longSymbols);
    assert.equal(
      shortDriver.length,
      longDriver.length,
      "the driver's own length should not depend on where it lands"
    );
    assert.ok(
      Buffer.from(shortDriver).equals(Buffer.from(longDriver)),
      'position-independent code emits identical bytes regardless of where it assembles -- a difference here means ' +
        'something in flash.asm now encodes an absolute reference to one of its own internal labels'
    );
  }
);

// A static complement to the relocation test above, not a replacement for
// it: byte comparison at two origins catches a full 16-bit absolute
// reference (an operand that is wrong at either origin), but a reference
// that only encodes *one* byte of a label's address -- `lda #>fd_unlock`,
// the high byte alone -- would still emit identical bytes at two origins
// that happen to share that byte, and the assertions above only fail loudly
// when that coverage has degraded; they cannot restore it. This checks the
// rule flash.asm's own header states directly, as a textual property of the
// source, so it does not depend on which two addresses this build happened
// to land the driver at.
const RELATIVE_BRANCHES = ['bne', 'beq', 'bpl', 'bmi', 'bcc', 'bcs', 'bvc', 'bvs'];

/** Escape a string for literal use inside a RegExp -- every label below is interpolated, and a local label's leading `.` is not one. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A word-boundary equivalent that also works at the edge of a local label's
 * leading `.` -- `\b` fails there, because `\b` needs one side of the
 * boundary to be a word character and both a preceding space and a leading
 * `.` are non-word, so `\bfd_unlock\b`-style patterns would silently never
 * match `.fd_unlock`-shaped names at all. Treating `.` as identifier-like
 * for boundary purposes on both ends fixes that without changing anything
 * for a plain name, where it behaves exactly like `\b`.
 */
function labelBoundaryPattern(label) {
  return `(?<![A-Za-z0-9_.])${escapeRegExp(label)}(?![A-Za-z0-9_])`;
}

/**
 * Splits the source between `flash_commit_driver:` and
 * `flash_commit_driver_end:` into logical entries -- one per source line,
 * each holding the *code* on that line with any label prefix removed --
 * and, alongside them, every label the span defines.
 *
 * A hardcoded enumeration of the driver's labels is exactly the shape of
 * bug this whole feature keeps producing (see this codebase's own review
 * history), now inside the guard meant to catch it: a new label plus an
 * unsafe reference to it would simply not be on a fixed list, and the scan
 * would report clean on the exact thing it exists to catch. So labels are
 * discovered from their definitions in the span, not named here -- and
 * discovery has to cover the syntax nesasm actually accepts, not merely the
 * one shape this file happens to use today:
 *
 *   - `fd_unlock:` alone on its line (today's only shape).
 *   - `fd_wait: lda #$00` -- a label sharing its line with an instruction.
 *     The single most likely accident: nothing about writing a label this
 *     way looks unusual, and there is no signal at the point of writing it
 *     that doing so would make a naive scan blind to the label.
 *   - `.wait:` -- nesasm's local-label syntax. Handled the same way a
 *     global label is; the leading `.` is just part of the name here.
 *
 * A colonless global label (nesasm accepts one; this codebase's own
 * convention never writes one) is the one shape this function does not
 * parse as a definition. Rather than silently miss it the way an
 * unrecognised syntax would, `entries` flags any line in the span that
 * starts at column 0 -- this codebase's own convention for exactly one
 * thing, a label definition, everything else in the span being indented --
 * without matching the colon form, as a convention violation the caller
 * must treat as a failure in its own right, not merely absorb as "not a
 * label" and move on.
 */
function parseDriverSpan(lines, startIndex, endIndex) {
  const labels = [];
  const entries = [];
  const conventionViolations = [];
  const definitionPattern = /^(\.?[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/;

  for (let i = startIndex; i < endIndex; i++) {
    const rawLine = lines[i];
    const stripped = rawLine.replace(/;.*/, '');
    if (/^\s*$/.test(stripped)) continue; // blank or comment-only

    if (/^\s/.test(stripped)) {
      // Indented: never a label by this codebase's convention, so this is
      // ordinary code (or a directive) with no prefix to strip.
      entries.push({ line: i + 1, rawLine, code: stripped });
      continue;
    }

    const match = definitionPattern.exec(stripped);
    if (match) {
      labels.push(match[1]);
      if (match[2].trim().length) entries.push({ line: i + 1, rawLine, code: match[2] });
      continue;
    }

    // Column 0, but not a recognised label definition -- most likely a
    // colonless label this codebase's own convention does not use, but
    // flagged rather than guessed at either way.
    conventionViolations.push({ line: i + 1, text: rawLine.trim() });
  }

  return { labels, entries, conventionViolations };
}

/**
 * Every logical code entry that references one of the driver's own internal
 * labels outside the two forms flash.asm's own header names as
 * relocation-safe: a relative branch (`bne fd_program_loop`) or
 * `$0600+(label-flash_commit_driver)` -- matched tolerant of whitespace
 * around the operators, so a harmless reformat is not a failure. Anything
 * else naming one of these labels -- `jsr fd_unlock`, `jmp fd_poll`, `lda
 * #>fd_unlock`, a bare `.dw fd_unlock`, whatever shape it takes -- bakes in
 * that label's ROM address, which is exactly the failure this whole file
 * exists to avoid.
 */
function findAbsoluteReferences(entries, labels) {
  const violations = [];
  for (const entry of entries) {
    let code = entry.code;
    // Remove every approved $0600+(label-flash_commit_driver) occurrence,
    // whitespace around the operators and all -- this both reaches a driver
    // label as the JSR target and mentions flash_commit_driver itself as
    // the anchor, so it has to come out before anything else is checked or
    // the anchor mention alone would read as an unapproved reference to
    // flash_commit_driver.
    code = code.replace(/\$0600\s*\+\s*\(\s*\.?[A-Za-z_][A-Za-z0-9_]*\s*-\s*flash_commit_driver\s*\)/g, '');
    // Remove every approved relative-branch operand.
    for (const label of labels) {
      code = code.replace(new RegExp(`\\b(${RELATIVE_BRANCHES.join('|')})\\s+${labelBoundaryPattern(label)}`, 'g'), '');
    }
    // Whatever mentions of a driver label remain are unapproved.
    for (const label of labels) {
      if (new RegExp(labelBoundaryPattern(label)).test(code)) {
        violations.push({ line: entry.line, text: entry.rawLine.trim() });
        break;
      }
    }
  }
  return violations;
}

function parseFlashDriverSource() {
  const source = fs.readFileSync(path.join(ROOT, 'engine', 'flash.asm'), 'utf8');
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => /^flash_commit_driver:/.test(line.trim()));
  const endIndex = lines.findIndex((line) => /^flash_commit_driver_end:/.test(line.trim()));
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'could not locate flash_commit_driver..flash_commit_driver_end in flash.asm');
  return parseDriverSpan(lines, startIndex, endIndex);
}

test('flash.asm defines every driver label with this codebase\'s own colon convention', () => {
  const { labels, conventionViolations } = parseFlashDriverSource();
  assert.ok(labels.includes('flash_commit_driver'), 'the driver label scan should at least find flash_commit_driver itself');
  assert.ok(
    conventionViolations.length === 0,
    conventionViolations.map((v) => `flash.asm:${v.line}: ${v.text}`).join('\n') +
      '\n-- starts at column 0 without a colon-terminated label definition. This codebase writes every label ' +
      "that way and indents everything else in this span, so this line is either a colonless label the guard " +
      "does not parse (add a colon) or a directive that needs indenting to read as code rather than a definition."
  );
});

test('flash.asm has no absolute reference to its own internal labels', () => {
  const { labels, entries } = parseFlashDriverSource();
  const violations = findAbsoluteReferences(entries, labels);
  assert.ok(
    violations.length === 0,
    violations.map((v) => `flash.asm:${v.line}: ${v.text}`).join('\n') +
      "\n-- reaches one of the driver's own internal labels outside a relative branch or " +
      '$0600+(label-flash_commit_driver); see this file\'s own header for why that is unsafe once relocated'
  );
});

/** The line index of the `.endif` that closes the `.if` at `ifIndex`, tracking nesting depth so a `.if`/`.endif` pair inside the block does not read as the block's own close. */
function findMatchingEndif(lines, ifIndex) {
  let depth = 1;
  for (let i = ifIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].replace(/;.*/, '').trim();
    if (/^\.if\b/.test(trimmed)) depth++;
    else if (/^\.endif\b/.test(trimmed)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Everything from just after `flash_commit_driver_end` through (not
 * including) the `.endif` that closes `.if SAVE_FLASH` must be one of a
 * short whitelist -- blank, a comment, the `flash_commit_driver_len`
 * equate, or an `.if`/`.fail`/`.endif` directive -- and nothing else.
 *
 * The assembly-time location-counter check (engine/main.asm, right after
 * `.include "flash.asm"` -- moved out of flash.asm itself so it observes
 * the file's *final* counter value rather than its value at some one line
 * inside the file, closing the plain "something got appended" case) still
 * cannot catch a backward `.org flash_commit_driver_end - 1` followed by
 * one byte, placed anywhere in this tail: that walks the counter back to
 * precisely `flash_commit_driver_end` and passes the numeric comparison
 * outright while still splicing a real byte in behind the driver's back
 * (see CLAUDE.md's own nesasm `.org` trap) -- no placement of a check that
 * only ever asks "is the counter the right number right now" can defeat a
 * construction engineered to make that number correct on purpose. This is
 * the check that actually closes it, by asking a different question: "is
 * every line here something this file is willing to name as safe," which a
 * location-counter- or bank-changing directive (`.org`, `.bank`) or any
 * instruction is not, regardless of what number it happens to leave the
 * counter at.
 */
function findForbiddenTailContent(lines, tailStart, tailEnd) {
  const violations = [];
  for (let i = tailStart; i < tailEnd; i++) {
    const stripped = lines[i].replace(/;.*/, '').trim();
    if (stripped === '') continue;
    if (/^flash_commit_driver_len\s*=\s*flash_commit_driver_end\s*-\s*flash_commit_driver$/.test(stripped)) continue;
    if (/^\.if\b/.test(stripped)) continue;
    if (stripped === '.fail') continue;
    if (stripped === '.endif') continue;
    violations.push({ line: i + 1, text: lines[i].trim() });
  }
  return violations;
}

test('flash.asm has nothing but the size/location guards after flash_commit_driver_end', () => {
  const source = fs.readFileSync(path.join(ROOT, 'engine', 'flash.asm'), 'utf8');
  const lines = source.split('\n');
  const endIndex = lines.findIndex((line) => /^flash_commit_driver_end:/.test(line.trim()));
  const saveFlashIfIndex = lines.findIndex((line) => /^\s*\.if\s+SAVE_FLASH\s*$/.test(line));
  assert.ok(endIndex >= 0, 'could not locate flash_commit_driver_end in flash.asm');
  assert.ok(saveFlashIfIndex >= 0, 'could not locate .if SAVE_FLASH in flash.asm');
  const saveFlashEndifIndex = findMatchingEndif(lines, saveFlashIfIndex);
  assert.ok(saveFlashEndifIndex > endIndex, 'could not locate the .endif that closes .if SAVE_FLASH');

  const violations = findForbiddenTailContent(lines, endIndex + 1, saveFlashEndifIndex);
  assert.ok(
    violations.length === 0,
    violations.map((v) => `flash.asm:${v.line}: ${v.text}`).join('\n') +
      '\n-- appears after flash_commit_driver_end but before the .endif that closes .if SAVE_FLASH, and is not ' +
      'one of the size/location guards this file expects there. Anything here would be excluded from both the ' +
      'copy to RAM and the source scan above, and would go on executing from ROM during the busy window.'
  );
});
