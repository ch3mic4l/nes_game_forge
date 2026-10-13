// Large streamed worlds (ROADMAP item 15), phase 3b slice S2, commit C2: the vertical ring engine's SELECTION and CONFIGURATION.
//
// What this file pins (the behaviour of the ring itself is test/unit/streamringoracle.test.js, streamringredraw.test.js,
// streamringstrip.test.js; the byte cost is test/unit/kernelbytes.test.js; the four-screen byte identity is streamringidentity.test.js):
//   * streamRingMode (shared/cartridge.js) is the single writer of the ring mode and gives the documented value for every
//     board x mirroring;
//   * validateProject still refuses MMC1 and UNROM 512 on a two-nametable board (S4a admitted MMC3 action; the real build path rejects the rest); the generator itself
//     no longer refuses mode 2 (phase 3b S3, C1: the horizontal engine exists) and builds it through the bypass copy;
//   * config.inc carries STREAM_RING / SW_RING_COL_LEN / SW_RING_ROW_LEN / SW_RW_NT_STEP / SW_RW_NT_END on every build, with the torus values on a
//     four-screen or non-streamed build (the horizontal ring's values are pinned in streamringh.test.js);
//   * the assembled fork operands ARE those constants (read back from the ROM through the ring labels), which a generator edit or an
//     engine edit that left one immediate at 30 / 4 cannot satisfy;
//   * the allowance is charged to the content ceiling exactly once, and only on a ring.
// A two-nametable streamed board that S4a did not admit is built only through test/lib/ringbypass.js (a mkdtemp copy with the one validate refusal
// neutralized); no shipped flag exists, and the real tree still refuses (asserted below).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SUPPORTED_MAPPERS, MIRRORING, resolveMapper, streamRingMode, streamCapableTwoNametable } from '../../shared/cartridge.js';
import { validateProject } from '../../shared/project.js';
import { buildProject } from '../../main/build/pipeline.js';
import { saveProject } from '../../main/project-io.js';
import { checkCapacity, contentCeilingBytes } from '../../main/build/generate.js';
import { STREAMWORLD_RING_KERNEL_HI_ALLOWANCE, projectStreamRing } from '../../main/build/streamplacement.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { makeBypassTree, loadBypassTree, buildThrough } from '../lib/ringbypass.js';
import { buildSymbols, readFns } from '../lib/ringrun.js';
import os from 'node:os';
import path from 'node:path';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
const STREAMABLE = [1, 4, 30]; // MMC1, MMC3, UNROM 512 -- stated here, then checked against the registry below
const ringProjectOf = (mapper, mirroring, over = {}) =>
  createStreamedProject({ mapper, mirroring, gridW: mirroring === 'vertical' ? 4 : 1, gridH: mirroring === 'vertical' ? 1 : 4, camera: true, ...over });

test('streamRingMode: 0 for a four-screen or unstreamable board, 1 for vertical mirroring, 2 for horizontal -- every board x mirroring', () => {
  assert.deepEqual(SUPPORTED_MAPPERS.filter((m) => m.streamable).map((m) => m.id).sort((a, b) => a - b), STREAMABLE);
  for (const mapper of SUPPORTED_MAPPERS) {
    for (const mirroring of MIRRORING) {
      const want = !STREAMABLE.includes(mapper.id) || mirroring.id === 'fourscreen' ? 0 : mirroring.id === 'vertical' ? 1 : 2;
      assert.equal(streamRingMode(mapper, mirroring.id), want, `${mapper.name} ${mirroring.id}`);
      assert.equal(streamCapableTwoNametable(mapper, mirroring.id), want !== 0, `${mapper.name} ${mirroring.id}: the ring modes are exactly the two-nametable ring`);
    }
  }
});

test('projectStreamRing: 0 for a project that streams nothing, whatever its board', () => {
  const plain = createStreamedProject({ mapper: 4, mirroring: 'vertical', gridW: 4, gridH: 1, camera: true });
  assert.equal(projectStreamRing(plain), 1);
  for (const map of plain.maps) map.streamed = false;
  assert.equal(projectStreamRing(plain), 0, 'no streamed map -> no ring, even on a vertical-mirroring streamable board');
});

test('validateProject still refuses MMC1 and UNROM 512 on a two-nametable board (their ring is bypass-only until S4b/S4c); MMC3 action is admitted since S4a', () => {
  for (const mapper of STREAMABLE) {
    for (const mirroring of ['vertical', 'horizontal']) {
      const problems = validateProject(ringProjectOf(mapper, mirroring)).filter((p) => p.severity === 'error');
      const refused = problems.some((p) => /two-nametable ring -- not implemented yet/.test(p.message));
      assert.equal(refused, mapper !== 4, `${resolveMapper(mapper).name} ${mirroring}: ${problems.map((p) => p.message).join(' | ') || 'no error at all'}`);
    }
  }
  // and the real tree's build path refuses it too, not merely validate
  const real = ringProjectOf(1, 'vertical');
  assert.ok(checkCapacity(real).problems.some((p) => p.severity === 'error' && /not implemented yet/.test(p.message)));
  assert.ok(!checkCapacity(ringProjectOf(4, 'vertical')).problems.some((p) => p.severity === 'error'), 'MMC3 vertical action is admitted through the real path');
});

test('the real build path rejects a vertical streamed MMC1 board (no flag, no bypass in the shipped tree)', { skip }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-real-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = ringProjectOf(1, 'vertical');
  await saveProject(dir, project);
  await assert.rejects(() => buildProject({ dir, project, log: () => {} }), /not implemented yet/);
});

test('the real build path rejects a horizontal streamed MMC1 / UNROM 512 board too, and the generator no longer carries its own mode-2 refusal', { skip }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-real-h-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const mapper of STREAMABLE.filter((id) => id !== 4)) {
    const project = ringProjectOf(mapper, 'horizontal');
    await saveProject(dir, project);
    await assert.rejects(() => buildProject({ dir, project, log: () => {} }), /not implemented yet/, resolveMapper(mapper).name);
  }
  // the generator's S2 stop-gap (a thrown 'Build panel: ... horizontal mirroring' for mode 2) is gone: validate is the one refusal, and S4 lifts it board by board
  assert.ok(!/horizontal mirroring, which needs the horizontal two-nametable/.test(fs.readFileSync(new URL('../../main/build/generate.js', import.meta.url), 'utf8')));
});

// ---- the generated constants and the assembled fork -------------------------------------------------------------------------------------

const TORUS = { STREAM_RING: 0, SW_RING_COL_LEN: 30, SW_RING_ROW_LEN: 32, SW_RW_NT_STEP: 1, SW_RW_NT_END: 4 };
const VERTICAL = { STREAM_RING: 1, SW_RING_COL_LEN: 15, SW_RING_ROW_LEN: 32, SW_RW_NT_STEP: 1, SW_RW_NT_END: 2 };
const RING_LABELS = ['sw_ring_col_cmp', 'sw_ring_col_len', 'sw_ring_wrap_col', 'sw_ring_row_cmp', 'sw_ring_row_len', 'sw_ring_wrap_row', 'sw_ring_nt_step', 'sw_ring_nt_end'];
const fixed = (rom, addr) => rom[16 + rom[4] * 16384 - 0x4000 + (addr - 0xc000)]; // the fixed $C000-$FFFF window is the last 16 KB of PRG on every board
const constantsOf = (symbols) => Object.fromEntries(Object.keys(TORUS).map((k) => [k, symbols.get(k)]));

test('config.inc: the ring constants on a vertical ring, a four-screen torus and a non-streamed build; the fork labels exist only on a ring', { skip }, async (t) => {
  const tree = makeBypassTree();
  t.after(() => tree.dispose());
  const loaded = await loadBypassTree(tree);
  const cases = [
    { label: 'MMC3 vertical ring', project: ringProjectOf(4, 'vertical'), want: VERTICAL, ring: true },
    { label: 'MMC1 vertical ring', project: ringProjectOf(1, 'vertical'), want: VERTICAL, ring: true },
    { label: 'U512 vertical ring', project: ringProjectOf(30, 'vertical'), want: VERTICAL, ring: true },
    { label: 'U512 four-screen torus', project: createStreamedProject({}), want: TORUS, ring: false },
    { label: 'MMC3 non-streamed', project: (() => { const p = ringProjectOf(4, 'vertical'); for (const m of p.maps) m.streamed = false; return p; })(), want: TORUS, ring: false }
  ];
  for (const { label, project, want, ring } of cases) {
    const built = await buildThrough(loaded, project);
    try {
      assert.deepEqual(constantsOf(buildSymbols(built.dir)), want, label);
      const fns = readFns(built.symbolPath);
      const rom = fs.readFileSync(built.romPath);
      for (const name of RING_LABELS) assert.equal(name in fns, ring, `${label}: ${name} ${ring ? 'must' : 'must not'} be assembled`);
      if (ring) {
        // each fork immediate IS its constant: opcode, then operand, read from the ROM image at the label (not from the engine source)
        const at = (name) => [fixed(rom, fns[name]), fixed(rom, fns[name] + 1)];
        assert.deepEqual(at('sw_ring_col_cmp'), [0xc9, VERTICAL.SW_RING_COL_LEN], `${label}: strip builder compare is cmp #15`);
        assert.deepEqual(at('sw_ring_col_len'), [0xa9, VERTICAL.SW_RING_COL_LEN], `${label}: st_len load is lda #15`);
        assert.deepEqual(at('sw_ring_wrap_col'), [0xc9, VERTICAL.SW_RING_COL_LEN], `${label}: wrap compare is cmp #15`);
        // the row fork is present on a vertical ring but keeps the torus row length: its operands are the literals the fork replaced (the byte-identity argument)
        assert.deepEqual(at('sw_ring_row_cmp'), [0xc9, 32], `${label}: row strip builder compare is cmp #32`);
        assert.deepEqual(at('sw_ring_row_len'), [0xa9, 32], `${label}: row st_len load is lda #32`);
        assert.deepEqual(at('sw_ring_wrap_row'), [0xc9, 32], `${label}: row wrap compare is cmp #32`);
        assert.deepEqual(at('sw_ring_nt_step'), [0x69, VERTICAL.SW_RW_NT_STEP], `${label}: render index step is adc #1`);
        assert.deepEqual(at('sw_ring_nt_end'), [0xc9, VERTICAL.SW_RW_NT_END], `${label}: render index end is cmp #2`);
      }
    } finally {
      fs.rmSync(built.dir, { recursive: true, force: true });
    }
  }
});

// ---- the allowance is charged, once, on a ring -------------------------------------------------------------------------------------------

test('the ring allowance is charged to the shared content ceiling exactly once and only on a ring (U512 vertical vs the same project four-screen, both game types)', () => {
  assert.equal(STREAMWORLD_RING_KERNEL_HI_ALLOWANCE > 0, true);
  for (const gameType of ['action', 'rpg']) {
    const torus = createStreamedProject({ gameType, mapper: 30, mirroring: 'fourscreen', gridW: 4, gridH: 1, camera: true });
    const ring = createStreamedProject({ gameType, mapper: 30, mirroring: 'vertical', gridW: 4, gridH: 1, camera: true });
    assert.equal(projectStreamRing(torus), 0);
    assert.equal(projectStreamRing(ring), 1);
    assert.equal(contentCeilingBytes(torus) - contentCeilingBytes(ring), STREAMWORLD_RING_KERNEL_HI_ALLOWANCE, `${gameType}: the ring build's ceiling is lower by exactly the ring allowance`);
  }
});
