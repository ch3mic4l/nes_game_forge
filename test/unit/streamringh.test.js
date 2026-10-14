// Large streamed worlds (ROADMAP item 15), phase 3b slice S3, commit C1: the horizontal ring engine's ASSEMBLY and CONFIGURATION.
//
// A streamed world on a two-nametable board with horizontal mirroring is a 1 x N ring of 16 x 30 blocks that scrolls on Y. This file pins:
//   (a) a horizontal streamed build assembles on MMC1, MMC3 and UNROM 512, action and RPG -- engine/player.asm's cross_left_cut tail needs a far branch
//       there (the plain `beq cross_none` is out of the assembler's +-128 range once the camera slides on Y alone); an engine that kept the near branch
//       does not build at all ('h-far-branch-omitted');
//   * config.inc carries STREAM_RING = 2, SW_RING_ROW_LEN = 16, SW_RW_NT_STEP = 2, SW_RW_NT_END = 4 on a horizontal ring (the torus column length 30 stays,
//     it is a vertical-ring constant), and the assembled fork operands ARE those constants, read back from the ROM image through the ring labels
//     ('h-row-len-32', 'h-row-load-32', 'h-wrap-32', 'h-wrap-30', 'h-render-step-1' each leave one immediate at a torus or vertical value);
//   * the allowance is charged to the content ceiling exactly once and only on a horizontal ring;
//   * validateProject still refuses the horizontal board (admission is S4's), so the build is reachable only through test/lib/ringbypass.js.
// The behaviour of the ring is streamringhoracle / hredraw / hdialogue / hstrip / hclose.test.js; the byte cost is kernelbytes.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolveMapper, streamRingMode } from '../../shared/cartridge.js';
import { validateProject } from '../../shared/project.js';
import { contentCeilingBytes, kernelCodeBytes } from '../../main/build/generate.js';
import { projectStreamRing, streamworldResidentHiBytes, STREAMWORLD_RING_KERNEL_HI_ALLOWANCE, STREAMWORLD_RING_KERNEL_ALLOWANCE, STREAMWORLD_RING_H_KERNEL_ALLOWANCE, STREAMWORLD_RING_H_KERNEL_HI_ALLOWANCE } from '../../main/build/streamplacement.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { makeBypassTree, loadBypassTree, buildThrough } from '../lib/ringbypass.js';
import { buildSymbols, readFns } from '../lib/ringrun.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
const BOARDS = [1, 4, 30]; // MMC1, MMC3, UNROM 512
const horizontal = (mapper, over = {}) => createStreamedProject({ mapper, mirroring: 'horizontal', gridW: 1, gridH: 4, camera: true, ...over });
const HORIZONTAL = { STREAM_RING: 2, SW_RING_COL_LEN: 30, SW_RING_ROW_LEN: 16, SW_RW_NT_STEP: 2, SW_RW_NT_END: 4 };
const fixed = (rom, addr) => rom[16 + rom[4] * 16384 - 0x4000 + (addr - 0xc000)]; // the fixed $C000-$FFFF window is the last 16 KB of PRG on every board

test('streamRingMode: horizontal mirroring on every streamable board is mode 2, and a horizontal project selects it', () => {
  for (const id of BOARDS) {
    assert.equal(streamRingMode(resolveMapper(id), 'horizontal'), 2, resolveMapper(id).name);
    assert.equal(projectStreamRing(horizontal(id)), 2);
  }
});

test('validateProject still refuses a streamed horizontal UNROM 512 board; MMC3 (S4a) and MMC1 (S4b) action are admitted', () => {
  for (const id of BOARDS) {
    const errors = validateProject(horizontal(id)).filter((p) => p.severity === 'error');
    assert.equal(errors.some((p) => /two-nametable ring -- not implemented yet/.test(p.message)), id === 30, `${resolveMapper(id).name}: ${errors.map((p) => p.message).join(' | ') || 'no error'}`);
  }
});

test('(a) a horizontal streamed build assembles on MMC1, MMC3 and UNROM 512, action and RPG; config.inc and every fork operand carry the horizontal values', { skip }, async (t) => {
  const tree = makeBypassTree(); // the active FORGE_RING_SABOTAGE (if any) applies here: the operand readback below is what catches a wrong row length or wrap
  t.after(() => tree.dispose());
  const loaded = await loadBypassTree(tree);
  // a build without the far branch cannot assemble: the same project, same tree, with the `.if STREAM_RING` far-branch arm switched off
  const nearTree = makeBypassTree({ sabotage: null, edits: [{ file: 'engine/player.asm', from: '  .if STREAM_RING\n  bne ring_far1', to: '  .if 0\n  bne ring_far1' }] });
  t.after(() => nearTree.dispose());
  const near = await loadBypassTree(nearTree);
  await assert.rejects(() => buildThrough(near, horizontal(4)), /Branch address out of range|cross_none/i, 'the near branch cannot reach cross_none on a horizontal ring');
  for (const id of BOARDS) {
    for (const gameType of ['action', 'rpg']) {
      const label = `${resolveMapper(id).name} ${gameType}`;
      const built = await buildThrough(loaded, horizontal(id, { gameType }));
      try {
        const rom = fs.readFileSync(built.romPath);
        assert.ok(rom.length > 16, `${label}: a ROM was produced`);
        const symbols = buildSymbols(built.dir);
        assert.deepEqual(Object.fromEntries(Object.keys(HORIZONTAL).map((k) => [k, symbols.get(k)])), HORIZONTAL, label);
        const fns = readFns(built.symbolPath);
        const at = (name) => [fixed(rom, fns[name]), fixed(rom, fns[name] + 1)];
        assert.deepEqual(at('sw_ring_row_cmp'), [0xc9, 16], `${label}: row strip builder compare is cmp #16`);
        assert.deepEqual(at('sw_ring_row_len'), [0xa9, 16], `${label}: row st_len load is lda #16`);
        assert.deepEqual(at('sw_ring_wrap_row'), [0xc9, 16], `${label}: row wrap compare is cmp #16`);
        assert.deepEqual(at('sw_ring_nt_step'), [0x69, 2], `${label}: render index step is adc #2`);
        assert.deepEqual(at('sw_ring_nt_end'), [0xc9, 4], `${label}: render index end is cmp #4`);
        assert.ok(Number.isFinite(fns.ring_far1), `${label}: the far branch is assembled`);
      } finally {
        fs.rmSync(built.dir, { recursive: true, force: true });
      }
    }
  }
});

test('the horizontal ring allowance is charged exactly once and only on a horizontal ring: kernel-hi through streamworldResidentHiBytes (so off the content ceiling), kernel-lo through kernelCodeBytes (every board, both game types)', () => {
  assert.equal(STREAMWORLD_RING_H_KERNEL_ALLOWANCE, 3, 'the far branch: beq (2) -> bne + jmp (5)');
  assert.equal(STREAMWORLD_RING_H_KERNEL_HI_ALLOWANCE, 0, 'the row forks are same-size immediates: no kernel-hi beyond the shared ring fork');
  for (const id of BOARDS) {
    const mapper = resolveMapper(id);
    // the SAME project with the ring switched off by the one input projectStreamRing reads besides the project: a mapper that is not streamable.
    // Nothing else in either function reads it, so each difference is exactly the ring's own charge (a mirroring flip would also change the camera's).
    const unringed = { ...mapper, streamable: false };
    for (const gameType of ['action', 'rpg']) {
      const label = `${mapper.name} ${gameType}`;
      const ring = horizontal(id, { gameType });
      assert.equal(projectStreamRing(ring, mapper), 2, label);
      assert.equal(projectStreamRing(ring, unringed), 0, label);
      assert.equal(streamworldResidentHiBytes(ring, mapper) - streamworldResidentHiBytes(ring, unringed), STREAMWORLD_RING_KERNEL_HI_ALLOWANCE + STREAMWORLD_RING_H_KERNEL_HI_ALLOWANCE, `${label}: kernel-hi`);
      assert.equal(kernelCodeBytes(ring, mapper) - kernelCodeBytes(ring, unringed), STREAMWORLD_RING_KERNEL_ALLOWANCE + STREAMWORLD_RING_H_KERNEL_ALLOWANCE, `${label}: kernel-lo is charged the far branch`);
      // a vertical ring is charged the shared fork only: never the horizontal lane
      const vertical = createStreamedProject({ gameType, mapper: id, mirroring: 'vertical', gridW: 4, gridH: 1, camera: true });
      assert.equal(projectStreamRing(vertical, mapper), 1, label);
      assert.equal(streamworldResidentHiBytes(vertical, mapper) - streamworldResidentHiBytes(vertical, unringed), STREAMWORLD_RING_KERNEL_HI_ALLOWANCE, `${label}: vertical kernel-hi`);
      assert.equal(kernelCodeBytes(vertical, mapper) - kernelCodeBytes(vertical, unringed), STREAMWORLD_RING_KERNEL_ALLOWANCE, `${label}: a vertical ring is not charged the far branch`);
    }
  }
  // and the hi lane really is part of the shared ceiling a project's content must fit
  const ring = horizontal(30);
  const torus = createStreamedProject({ mapper: 30, mirroring: 'fourscreen', gridW: 1, gridH: 4, camera: true });
  assert.equal(contentCeilingBytes(torus) - contentCeilingBytes(ring), STREAMWORLD_RING_KERNEL_HI_ALLOWANCE + STREAMWORLD_RING_H_KERNEL_HI_ALLOWANCE);
});
