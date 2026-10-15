// Phase 3b S5, C1, obligation (c): MMC3's font split and PRG/CHR bank registers across a battle's entry and return, Continue, and a warp -- on an MMC3
// RING RPG (vertical and horizontal), dialogue resident and banked. Run through the bypass copy: production engine and generator.
//
// jsnes clocks the MMC3 scanline counter once per rendered scanline, an APPROXIMATION of the chip (hardware clocks at dot 260); this file therefore asserts the
// REGISTER STATE the engine leaves (a shadow of R0-R7 kept from every $8000/$8001 write, interrupt-issued ones included) rather than any scanline timing.
// The Mesen half of (c) is not here: the ring gate's row-8 harness has no battle/Continue/warp stimulus (handoff-next/s5-c1-r1-report.md names the edit).
//
// The contract (engine/banks.asm, engine/split.asm):
//   - $8000 selects, $8001 writes; the interrupts select only R1; switch_prg_bank writes R6 = 2*bank and R7 = 2*bank+1 under sei + split_lock;
//   - R0..R5 are the live tileset's eight 1 KB banks (offsets 0,2,4,5,6,7); chr_r1 = R1's tileset value; the split writes FONT_R1 into R1 and NMI's
//     split_arm puts chr_r1 back, so at a frame boundary R1 is one of the two and every other CHR register is the tileset's;
//   - split_lock is 0 outside switch_prg_bank; the split follows STATE: a battle frame carries the font split, an idle field frame carries none.
//
// Frames observed: see frameViolations. (Wording corrected in S5 C1 fix 1: an earlier header said "every frame boundary" for all three tests.)
//
// Wrong implementations these catch (handoff-next/s5-c1/sabotage.mjs): switch_prg_bank writing R7 != R6+1 ('pair incoherent'); split_arm leaving R1 on the
// font after a battle ('R1 stuck'); a battle return that does not put the field's PRG bank back ('bank not restored').
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree } from '../lib/ringbypass.js';
import { cellById } from '../lib/ringrun.js';
import { runSteps } from '../lua/ring_gate/ringrun_jsnes.mjs';
import { BTN, buildRing, bootToField, chooseCommand } from '../lib/ringrpg.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
let tree;
let loaded;
before(async () => {
  if (skip) return;
  tree = makeBypassTree();
  loaded = await loadBypassTree(tree);
});
after(() => tree?.dispose());

const START = { x: 120, y: 120 };
const OFFSETS = [0, 2, 4, 5, 6, 7]; // mmc3_chr_offsets
const enterEvent = (commands) => ({ trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } });

/** Shadows the MMC3 register file from every $8000/$8001 write; follows a power cycle (the mapper object is replaced). */
function watchMmc3(nes, at) {
  const w = { regs: new Array(8).fill(0), cmd: 0, fontWrites: 0, r1Writes: 0, badPair: 0 };
  const install = () => {
    const orig = nes.mmap.write.bind(nes.mmap);
    nes.mmap.write = (address, value) => {
      if (address === 0x8000) w.cmd = value & 7;
      else if (address === 0x8001) {
        w.regs[w.cmd] = value;
        if (w.cmd === 1) { w.r1Writes++; if (value === at('FONT_R1')) w.fontWrites++; }
      }
      return orig(address, value);
    };
  };
  install();
  const reload = nes.reloadROM.bind(nes);
  nes.reloadROM = () => { reload(); install(); };
  return w;
}

/** The invariants that hold at a frame boundary; returns a list of violations. Which frames are checked is stated per test: the battle test checks EVERY frame from the first idle field frame through walk-in, entry, the command helper's press and settle frames (chooseCommand's per-frame callback), fight and return; the Continue and warp tests check every frame from the one after the boot/power-cycle helper hands back (the helper's own frames run inside runSteps/bootToField and are not observed). */
function frameViolations(nes, at, w, where) {
  const m = nes.cpu.mem;
  const bad = [];
  const [r0, r1, r2, r3, r4, r5, r6, r7] = w.regs;
  if (m[at('split_lock')] !== 0) bad.push(`${where}: split_lock is ${m[at('split_lock')]} at a frame boundary`);
  if (r6 % 2 !== 0 || r7 !== r6 + 1) bad.push(`${where}: PRG pair incoherent (R6 ${r6}, R7 ${r7})`);
  const base = r0; // R0 = tileset*8 + 0
  if (base % 8 !== 0) bad.push(`${where}: R0 ${r0} is not a tileset base`);
  [r2, r3, r4, r5].forEach((v, i) => { if (v !== base + OFFSETS[i + 2]) bad.push(`${where}: R${i + 2} = ${v}, the tileset ${base / 8} wants ${base + OFFSETS[i + 2]}`); });
  if (r1 !== base + 2 && r1 !== at('FONT_R1')) bad.push(`${where}: R1 = ${r1}, neither the tileset's ${base + 2} nor the font's ${at('FONT_R1')}`);
  if (m[at('chr_r1')] !== base + 2) bad.push(`${where}: chr_r1 = ${m[at('chr_r1')]}, R0 says tileset ${base / 8}`);
  return bad;
}

const frames = (nes, at, w, n, where, out) => { for (let i = 0; i < n; i++) { nes.frame(); out.push(...frameViolations(nes, at, w, `${where}+${i}`)); } };
const snapshot = (w) => ({ prg: [w.regs[6], w.regs[7]], chr: [w.regs[0], w.regs[2], w.regs[3], w.regs[4], w.regs[5]] });

for (const id of ['MMC3-V', 'MMC3-H']) {
  for (const placement of ['resident', 'banked']) {
    test(`(c) MMC3 split and bank registers across a battle on a ring: ${id} rpg ${placement}`, { skip }, async () => {
      const cell = cellById(id);
      const r = await buildRing({
        loaded, cell, placement, start: START, title: true,
        mutate: (p) => {
          p.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
          p.maps[0].screens[0].entities = [{ actorId: 0, x: START.x, y: START.y + 32, props: {} }];
        }
      });
      try {
        const nes = r.boot();
        const w = watchMmc3(nes, r.at);
        const bad = [];
        bootToField(nes, r.at, { title: true });
        frames(nes, r.at, w, 30, 'idle-before', bad);
        const field = snapshot(w);
        assert.equal(w.regs[1], nes.cpu.mem[r.at('chr_r1')], 'idle field: R1 is the tileset page, not the font');
        const fontBeforeIdle = w.fontWrites;
        frames(nes, r.at, w, 30, 'idle-before-2', bad);
        assert.equal(w.fontWrites, fontBeforeIdle, 'an idle field frame carries no font split');

        // into the battle: walk until game_state is ST_BATTLE, then watch it frame by frame
        const m = nes.cpu.mem;
        for (let step = 0; step < 200 && m[r.at('game_state')] === 0; step++) { nes.buttonDown(1, BTN.DOWN); nes.frame(); nes.buttonUp(1, BTN.DOWN); bad.push(...frameViolations(nes, r.at, w, `walk-in+${step}`)); }
        for (let i = 0; i < 30 && m[r.at('game_state')] !== r.at('ST_BATTLE'); i++) { nes.frame(); bad.push(...frameViolations(nes, r.at, w, `entry+${i}`)); }
        assert.equal(m[r.at('game_state')], r.at('ST_BATTLE'), 'the fight started');
        const fontAtEntry = w.fontWrites;
        frames(nes, r.at, w, 20, 'battle', bad);
        assert.equal(w.regs[6], 2 * r.at('BATTLE_BANK'), 'in battle the switchable window is the battle bank (R6)');
        assert.equal(w.regs[7], 2 * r.at('BATTLE_BANK') + 1, 'in battle the switchable window is the battle bank (R7)');
        assert.ok(w.fontWrites - fontAtEntry >= 15, `a battle frame carries the font split (${w.fontWrites - fontAtEntry} font writes in 20 frames)`);

        // fight it out, return to the field
        let commandFrames = 0;
        chooseCommand(nes, r.at, r.at('BC_FIGHT'), () => { commandFrames++; bad.push(...frameViolations(nes, r.at, w, `command+${commandFrames - 1}`)); });
        assert.ok(commandFrames >= 7, `the command helper's own frames were observed (${commandFrames})`);
        nes.buttonDown(1, BTN.A); nes.frame(); nes.buttonUp(1, BTN.A); bad.push(...frameViolations(nes, r.at, w, 'fight-start'));
        for (let round = 0; round < 80 && m[r.at('game_state')] === r.at('ST_BATTLE'); round++) { nes.buttonDown(1, BTN.A); nes.frame(); nes.buttonUp(1, BTN.A); bad.push(...frameViolations(nes, r.at, w, `fight-press+${round}`)); frames(nes, r.at, w, 12, 'fight', bad); }
        assert.equal(m[r.at('game_state')], 0, 'the battle ended');
        frames(nes, r.at, w, 10, 'return', bad);
        const fontAfterReturn = w.fontWrites;
        frames(nes, r.at, w, 60, 'idle-after', bad);
        assert.deepEqual(bad, [], 'a register invariant broke somewhere across the battle');
        assert.deepEqual(snapshot(w), field, 'after the round trip the PRG pair and the tileset registers are the field\'s again (same screen)');
        assert.equal(w.regs[1], nes.cpu.mem[r.at('chr_r1')], 'R1 is back on the tileset page once the field is idle (the split left no font behind)');
        assert.equal(w.fontWrites, fontAfterReturn, 'and the idle field carries no font split after the battle (the split follows state)');
      } finally { r.dispose(); }
    });
  }
}

for (const id of ['MMC3-V', 'MMC3-H']) {
  test(`(c) MMC3 bank registers across Continue on a ring: ${id} rpg`, { skip }, async () => {
    const cell = cellById(id);
    const r = await buildRing({
      loaded, cell, start: START, title: true,
      mutate: (p) => {
        p.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
        p.maps[0].screens[0].entities = [{ actorId: p.sprites.actors.length - 1, x: cell.ring === 1 ? 40 : 200, y: 40, props: enterEvent([{ op: 'save' }]) }];
      }
    });
    try {
      const nes = r.boot();
      const w = watchMmc3(nes, r.at);
      const bad = [];
      const axis = cell.ring === 1 ? 'x' : 'y';
      runSteps(nes, [{ op: 'title' }, { op: 'boot' }]);
      frames(nes, r.at, w, 20, 'before-cycle', bad);
      const before = snapshot(w);
      const [cycle] = runSteps(nes, [{ op: 'cycle', axis, target: 'c', battery: true }]);
      assert.ok(cycle.hold.reached, `Continue reached the field (${cycle.hold.why})`);
      frames(nes, r.at, w, 60, 'continue', bad);
      assert.deepEqual(bad, [], 'a register invariant broke across the power cycle and Continue');
      assert.deepEqual(snapshot(w), before, 'the Continue landing leaves the same PRG pair and tileset registers as the session that saved (same screen)');
      assert.equal(w.regs[1], nes.cpu.mem[r.at('chr_r1')], 'R1 on the tileset page');
    } finally { r.dispose(); }
  });

  test(`(c) MMC3 bank registers across a warp to another screen on a ring: ${id} rpg`, { skip }, async () => {
    const cell = cellById(id);
    const r = await buildRing({
      loaded, cell, start: START,
      mutate: (p) => {
        p.sprites.actors.push({ name: 'Door', behavior: 'npc', hp: 1, damage: 0 });
        p.maps[0].screens[0].entities = [{ actorId: p.sprites.actors.length - 1, x: START.x, y: START.y, props: enterEvent([{ op: 'warp', screen: 3, x: 60, y: 60 }]) }];
      }
    });
    try {
      const nes = r.boot();
      const w = watchMmc3(nes, r.at);
      const bad = [];
      bootToField(nes, r.at);
      frames(nes, r.at, w, 40, 'warped', bad);
      const axis = cell.ring === 1 ? 'sw_col' : 'sw_row';
      assert.equal(nes.cpu.mem[r.at(axis)], 3, 'the warp landed on screen 3');
      assert.deepEqual(bad, [], 'a register invariant broke across the warp');
      assert.equal(w.regs[1], nes.cpu.mem[r.at('chr_r1')], 'R1 on the tileset page');
      // the switchable window now holds screen 3's data: its terrain bytes are what the engine reads (the mtptr window)
      assert.ok(w.regs[6] % 2 === 0 && w.regs[7] === w.regs[6] + 1, 'a coherent PRG pair after the warp');
    } finally { r.dispose(); }
  });
}
