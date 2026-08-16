// KERNEL_CODE_BYTES (main/build/generate.js) is a hand-measured over-estimate
// of the engine code that shares the fixed kernel's low bank with the lookup
// tables, and checkCapacity() trusts it to leave room for both. A measurement
// taken on a project that leaves a conditionally-assembled feature off, or on
// only one of several RPG-capable boards, is not the worst case — and the gap
// between the guess and reality only shows up as the assembler's own "Bank
// overflow" once a project actually turns everything on somewhere this test
// did not look, which is exactly the raw-assembler-output failure this
// codebase otherwise refuses to ship. This builds the real worst case, on
// every RPG-capable board, and asserts the constant still covers the largest
// of them — so the next regression is a failing test here rather than a bug
// report from someone else's project.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { KERNEL_CODE_BYTES } from '../../main/build/generate.js';
import { SUPPORTED_MAPPERS, rpgCapable, prgLayout } from '../../shared/cartridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
// This test builds its own temporary ROMs from scratch rather than reading
// sample-rpg/build/game.nes, so it must not gate on that file the way the
// tests that actually read it do — this is the one thing standing between a
// kernel-overflow regression and a clean checkout silently skipping the test
// built to catch it. It depends on nothing but nesasm itself.
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// rpgCapable() (shared/cartridge.js) is the single writer for which boards an
// RPG may target at all — asserting the ceiling on only one of them assumes
// today's ordering (UNROM 512 highest) holds forever, and an eight-byte
// margin over the runner-up (MMC3) is not a margin a future change need
// respect. Measured: UNROM 512 6780, MMC3 6772, MMC1 6583 — three boards,
// each build well under 50ms, so iterating all of them costs nothing worth
// trimming for.
const CAPABLE_MAPPERS = SUPPORTED_MAPPERS.filter(rpgCapable);

test(
  'KERNEL_CODE_BYTES covers the real engine, on every RPG-capable board, with every conditional feature on',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    assert.ok(CAPABLE_MAPPERS.length > 0, 'no RPG-capable mapper is registered — rpgCapable() found nothing');

    const measurements = [];
    for (const mapper of CAPABLE_MAPPERS) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelbytes-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const project = await loadProject(SAMPLE_RPG);

      // sample-rpg already has dialogue (TEXT_ENABLED), action combat
      // (COMBAT_ENABLED) and the battle system (BATTLE_ENABLED); only its
      // title is off, so switch that on too and put it on this board — the
      // whole point is nothing conditional is left out anywhere in the sweep.
      project.cartridge.mapper = mapper.id;
      project.project.titleMap = 0;
      project.project.titleScreen = 0;

      await saveProject(dir, project);
      const lines = [];
      const built = await buildProject({ dir, project, log: (line) => lines.push(line) });

      const { kernelLoBank } = prgLayout(mapper);
      // nesasm's own "segment usage" table, one row per bank: "BANK  62   7182/1010"
      // — right-aligned, so the free half can carry a leading space the used
      // half never does ("7235/ 957").
      const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
      assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
      const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
      assert.ok(Number.isFinite(used) && used > 0, `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`);

      assert.ok(built.symbolPath, `${mapper.name}: nesasm should have written a symbol file`);
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const resetMatch = symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m);
      assert.ok(resetMatch, `${mapper.name}: reset should be a named symbol in game.fns`);
      const resetAddr = parseInt(resetMatch[1], 16);

      // Everything before `reset` in the kernel-lo bank is the lookup tables
      // (kernel_lo.inc, palettes, metatiles, sprites, input, maps, chrtables);
      // `reset` is the first label of boot.asm, the first file of engine code
      // included after them. So reset - $C000 is exactly fixedBytes +
      // tableBytes, measured off the real assembly rather than recomputed by
      // hand here — and the remainder is the real engine code size.
      measurements.push({ mapper: mapper.name, codeBytes: used - (resetAddr - 0xc000) });
    }

    const worst = measurements.reduce((max, entry) => (entry.codeBytes > max.codeBytes ? entry : max));
    const summary = measurements.map((entry) => `${entry.mapper}: ${entry.codeBytes}`).join(', ');

    assert.ok(
      worst.codeBytes <= KERNEL_CODE_BYTES,
      `the real engine measures up to ${worst.codeBytes} bytes of kernel code, on ${worst.mapper}, but ` +
        `KERNEL_CODE_BYTES only reserves ${KERNEL_CODE_BYTES} [${summary}] — checkCapacity() is promising ` +
        'table room the assembler will refuse. Re-measure and raise it (see the comment beside KERNEL_CODE_BYTES).'
    );
    // Not just an upper bound: a constant so much larger than reality that it
    // stopped tracking the engine would hide the next regression exactly the
    // way a too-low one causes one, just silently instead of loudly.
    assert.ok(
      worst.codeBytes > KERNEL_CODE_BYTES - 500,
      `KERNEL_CODE_BYTES (${KERNEL_CODE_BYTES}) reserves far more than the worst measured ${worst.codeBytes} ` +
        `bytes, on ${worst.mapper} [${summary}] — confirm this measurement is still the actual worst case ` +
        'rather than a stale, overly generous guess.'
    );
  }
);
