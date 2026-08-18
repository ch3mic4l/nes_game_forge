// The whole build: project data -> assembly -> nesasm -> a verified .nes ROM.

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateAssets } from './generate.js';
import { runNesasm } from './nesasm.js';
import { applyHeaderPatch, headerPatch, resolveMapper } from '../../shared/cartridge.js';
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
