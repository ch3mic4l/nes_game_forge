// Phase 3b S2 (C2), test (b): STREAM_RING = 0 builds are byte-identical to the engine before the ring existed.
//
// "Equates emit no bytes" is the argument; this is the proof. The CONTROL tree is a copy of engine/ main/ shared/ whose streamworld.asm has
// every `.if STREAM_RING ... .else <original> .endif` collapsed to its `.else` body (test/lib/ringbypass.js collapseRingFork), i.e. the
// engine as it read before C2, and whose generator is unsabotaged. The CURRENT tree is the product as it stands. Every one of the six
// checked-in fixtures and the four-screen streamed shapes (UNROM 512 four-screen, action / RPG / mixed) is built through both and the ROM
// images must be equal. The streamed shapes are the ones that actually assemble streamworld.asm: the six fixtures stream nothing, so for
// them the proof is that the new equates and the allowance plumbing change nothing at all.
//
// The `.else` bodies themselves are pinned as literal text below (they ARE the pre-C2 lines), so the control cannot drift into agreeing with a
// changed fork by construction.
//
// Phase 3b S3 (C1) adds the horizontal fork to engine/streamworld.asm (the row strip's compare, length and wrap) and one gated far branch to
// engine/player.asm; the CONTROL collapses both files, so it is still the engine as it read before any ring existed.
//
// Wrong implementation caught ('torus-leak'): the fork leaking into a four-screen build -- any ring-only value or branch (a 29 where the torus
// reads 30, an unconditional change to the render-window step, a generated constant that differs from the literal it replaced) that reaches STREAM_RING = 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree, buildThrough, collapseRingFork, ROOT } from '../lib/ringbypass.js';
import { createStreamedProject } from '../lib/streamedproject.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
const FIXTURES = ['sample', 'sample-rpg', 'sample-mmc1', 'sample-mmc3', 'sample-u512', 'sample-rpg-mmc1'];

test('the collapsed (STREAM_RING = 0) arms of the fork are exactly the pre-ring engine lines', () => {
  const text = collapseRingFork(fs.readFileSync(path.join(ROOT, 'engine/streamworld.asm'), 'utf8'));
  const has = (s) => assert.equal(text.split(s).length - 1, 1, `exactly one occurrence of:\n${s}`);
  has('sw_ssc_noadv:\n  lda ss_i\n  cmp #30\n  bne sw_ssc_loop\n  jsr sw_locate_current        ; restore the CURRENT (player) screen\n  lda #30\n  sta st_len\n');
  has('  lda st_vary\n  cmp #30\n  bne sw_ns_wrapdone\n  lda #0\n  sta st_vary\n  jmp sw_ns_wrapdone\n');
  has('  bne sw_rw_arow_loop\n  inc sw_rw_nt\n  lda sw_rw_nt\n  cmp #4\n  beq sw_rw_done\n  jmp sw_rw_nt_loop\n');
  has('sw_ssr_noadv:\n  lda ss_i\n  cmp #32\n  bne sw_ssr_loop\n  jsr sw_locate_current\n  lda #32\n  sta st_len\n');
  has('sw_ns_wrap32:\n  lda st_vary\n  cmp #32\n  bne sw_ns_wrapdone\n');
  assert.ok(!/\bsw_ring_/.test(text) && !/STREAM_RING|SW_RING_(COL|ROW)_LEN|SW_RW_NT_(STEP|END)/.test(text), 'no ring symbol survives the collapse');
});

test('the collapsed (STREAM_RING = 0) arm of the player.asm far branch is the plain pre-ring beq', () => {
  const text = collapseRingFork(fs.readFileSync(path.join(ROOT, 'engine/player.asm'), 'utf8'));
  assert.equal(text.split('cross_left_cut:\n  pla\n  .endif\n  .if !CAMERA_SLIDE_H\n  beq cross_none\n  .endif\n  .endif\n  .if !CAMERA_SLIDE_ENABLED\n').length - 1, 1, 'the pre-ring cross_left_cut tail');
  assert.ok(!/ring_far1|STREAM_RING/.test(text), 'no ring symbol survives the collapse');
});

test('collapseRingFork refuses a shape it cannot resolve', () => {
  assert.throws(() => collapseRingFork('  .if STREAM_RING\n  nop\n  .endif\n'), /without \.else/);
  assert.throws(() => collapseRingFork('  .if STREAM_RING\n  .if STREAM_RING\n'), /nested/);
  assert.throws(() => collapseRingFork('  .if STREAM_RING\n  nop\n  .else\n  rts\n'), /unterminated/);
  assert.equal(collapseRingFork('a\n  .if STREAM_RING\nl:\n  x\n  .else\n  y\n  .endif\nb'), 'a\n  y\nb');
});

test('STREAM_RING = 0: every fixture and every four-screen streamed shape assembles a ROM byte-identical to the pre-ring engine', { skip }, async (t) => {
  const current = makeBypassTree({ bypass: false });
  const control = makeBypassTree({ bypass: false, sabotage: null, transforms: { 'engine/streamworld.asm': collapseRingFork, 'engine/player.asm': collapseRingFork } });
  t.after(() => { current.dispose(); control.dispose(); });
  const [now, before] = await Promise.all([loadBypassTree(current), loadBypassTree(control)]);
  const shapes = [
    ...FIXTURES.map((name) => ({ label: name, load: (L) => L.loadProject(path.join(ROOT, name)) })),
    ...[{ gameType: 'action' }, { gameType: 'rpg' }, { gameType: 'action', mixed: true }].map((o) => ({ label: `streamed U512 four-screen ${o.gameType}${o.mixed ? ' mixed' : ''}`, load: async () => createStreamedProject(o) }))
  ];
  for (const { label, load } of shapes) {
    const a = await buildThrough(now, await load(now));
    const b = await buildThrough(before, await load(before));
    try {
      const romA = fs.readFileSync(a.romPath);
      const romB = fs.readFileSync(b.romPath);
      assert.equal(romA.length, romB.length, `${label}: ROM size`);
      assert.ok(romA.equals(romB), `${label}: the STREAM_RING = 0 ROM differs from the pre-ring engine's`);
      const cfg = fs.readFileSync(path.join(a.dir, 'build/assets/config.inc'), 'utf8');
      assert.match(cfg, /^STREAM_RING = 0$/m, `${label}: built with the torus selection`);
    } finally {
      fs.rmSync(a.dir, { recursive: true, force: true });
      fs.rmSync(b.dir, { recursive: true, force: true });
    }
  }
});
