// The whole build: project data -> assembly -> nesasm -> a verified .nes ROM.

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateAssets } from './generate.js';
import { runNesasm } from './nesasm.js';
import { applyHeaderPatch, flashSaveSectorBank, headerPatch, resolveMapper } from '../../shared/cartridge.js';
import { projectUsesSave } from '../../shared/project.js';

const INES_HEADER = 16;

/**
 * Sanity-check the assembled ROM instead of trusting the assembler's exit code.
 * A short file or a bad header means something went wrong upstream.
 */
export function inspectRom(bytes) {
  const problems = [];
  if (bytes.length < INES_HEADER + 1024) problems.push('The assembled ROM is implausibly small.');
  if (!(bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a)) {
    problems.push('The ROM does not start with an iNES header.');
  }
  const prgBanks = bytes[4];
  const chrBanks = bytes[5];
  const expected = INES_HEADER + prgBanks * 16384 + chrBanks * 8192;
  if (bytes.length !== expected) {
    problems.push(`ROM is ${bytes.length} bytes but its header describes ${expected}.`);
  }

  // The reset vector must point into the fixed bank; a $0000 vector is the
  // classic symptom of the vectors having been overwritten.
  const resetVector = bytes[bytes.length - 8192 * chrBanks - 4] | (bytes[bytes.length - 8192 * chrBanks - 3] << 8);
  if (resetVector < 0x8000) {
    problems.push(`The reset vector is $${resetVector.toString(16).padStart(4, '0')}, which is not in ROM.`);
  }

  return {
    ok: problems.length === 0,
    problems,
    prgBanks,
    chrBanks,
    mapper: (bytes[6] >> 4) | (bytes[7] & 0xf0),
    resetVector
  };
}

/**
 * The flash medium's own promise, checked against the assembled bytes
 * rather than trusted from the region math alone: engine/flash.asm's
 * driver erases before it programs, on the assumption that whatever is
 * already in bank SAVE_BANK's $B000-$BFFF is safe to destroy. If the
 * region reservation (shared/cartridge.js's reserveFlashSaveRegion) ever
 * failed to keep screen data out of that region, this is what would catch
 * it -- before the ROM ships, not the first time a player's save silently
 * erases part of their own game. A pure function of the assembled bytes,
 * not folded into buildProject's own body, so a test can hand it a
 * deliberately non-blank sector without needing a project large enough to
 * actually pack real screen data into bank 30 by accident.
 *
 * This *is* the exact region/byte overlap assertion, not a stand-in for
 * one: it reads the literal bytes at `16 + SAVE_BANK*16384 + $3000`
 * through `+$3FFF` out of the real assembled ROM, so anything that landed
 * there -- a screen, a tileset payload, bank-count arithmetic gone wrong,
 * anything -- fails this check by not being $FF, regardless of which
 * upstream computation put it there. A bank-number check (does something
 * claim bank 30) would be the wrong shape here on purpose: bank 30's own
 * $8000-$9FFF stays legitimately available for screens (only its own
 * $3000-$3FFF, $B000-$BFFF in CPU terms, is reserved), so "is bank 30 used"
 * and "is the sector blank" are different questions, and only the second
 * one is true both before the first save and false the moment anything
 * collides with it. There is deliberately no separate overlap assertion
 * anywhere else in the pipeline -- adding one would just be a second, less
 * precise way of asking what this already answers byte-exactly.
 *
 * Throws the same shape buildProject's other checks do (`error.errors`, an
 * array nesasm's own failures use too) rather than returning a verdict, so
 * a caller cannot forget to check one.
 */
export function checkFlashSectorBlank(bytes, mapper) {
  const sectorBank = flashSaveSectorBank(mapper);
  const sectorOffset = INES_HEADER + sectorBank * 16384 + 0x3000;
  const sector = bytes.subarray(sectorOffset, sectorOffset + 4096);
  if (sector.length !== 4096 || !sector.every((byte) => byte === 0xff)) {
    const message =
      `The flash save sector (bank ${sectorBank}, $B000-$BFFF) did not ship blank -- something else ` +
      'assembled into the region the flash driver erases on the first save.';
    const error = new Error(message);
    error.errors = [{ message }];
    throw error;
  }
}

export async function buildProject({ dir, project, log = () => {}, settings = {} }) {
  const started = Date.now();
  log(`Building ${project.project.name}…`);

  const { buildDir, warnings, stats } = await generateAssets({ dir, project, log });
  for (const warning of warnings) log(`warning: ${warning.where}: ${warning.message}`);

  const result = await runNesasm({
    cwd: buildDir,
    source: 'main.asm',
    binary: settings.nesasmPath || 'nesasm',
    log
  });

  if (!result.ok) {
    const error = new Error(
      result.errors.map((entry) => (entry.file ? `${entry.file}:${entry.line}: ${entry.message}` : entry.message)).join('\n')
    );
    error.errors = result.errors;
    error.output = result.output;
    throw error;
  }

  const romPath = path.join(dir, 'build', 'game.nes');
  await fs.rename(result.romPath, romPath);

  const symbolSource = path.join(buildDir, 'main.fns');
  const symbolPath = path.join(buildDir, 'game.fns');
  let hasSymbols = false;
  try {
    await fs.rename(symbolSource, symbolPath);
    hasSymbols = true;
  } catch {
    // nesasm only writes .fns when it has symbols to write; not fatal.
  }

  const bytes = new Uint8Array(await fs.readFile(romPath));

  // nesasm only speaks iNES 1.0, which cannot declare CHR-RAM or its size. A
  // CHR-RAM board therefore needs its 16-byte header upgraded to NES 2.0 here.
  // applyHeaderPatch is a no-op for every mapper nesasm can already describe, so
  // "the assembler writes a correct header" still holds for all of them.
  const mapper = resolveMapper(project.cartridge.mapper);
  const saveEnabled = projectUsesSave(project);
  if (Object.keys(headerPatch(mapper, project.cartridge, saveEnabled)).length) {
    applyHeaderPatch(bytes, mapper, project.cartridge, saveEnabled);
    await fs.writeFile(romPath, bytes);
    const notes = [
      mapper.nes2 ? `NES 2.0, ${mapper.nes2.chrRamSize / 1024} KB CHR-RAM` : null,
      project.cartridge.mirroring === 'fourscreen' ? 'four-screen mirroring' : null,
      // The wording depends on which medium the header bit actually selected
      // on this board -- battery RAM on MMC1/MMC3, the flashable
      // configuration on UNROM 512 -- so it cannot be one fixed string once
      // a second medium exists.
      saveEnabled ? (mapper.saveMedia === 'flash' ? 'flash save' : 'battery-backed save') : null
    ].filter(Boolean);
    log(`Rewrote the header for ${mapper.name} (${notes.join(', ')}).`);
  }

  if (saveEnabled && mapper.saveMedia === 'flash') {
    checkFlashSectorBlank(bytes, mapper);
  }

  const inspection = inspectRom(bytes);
  if (!inspection.ok) {
    const error = new Error(inspection.problems.join('\n'));
    error.errors = inspection.problems.map((message) => ({ message }));
    throw error;
  }

  const elapsed = Date.now() - started;
  log(
    `Built game.nes — ${bytes.length} bytes, mapper ${inspection.mapper}, ` +
      `${inspection.prgBanks * 16}KB PRG + ${inspection.chrBanks * 8}KB CHR (${elapsed} ms)`
  );

  return {
    romPath,
    symbolPath: hasSymbols ? symbolPath : null,
    size: bytes.length,
    mapper: inspection.mapper,
    warnings,
    stats,
    elapsed
  };
}
