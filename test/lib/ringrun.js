// Run one phase 3b ring scene end to end under jsnes: build the scene's project through a bypass tree (test/lib/ringbypass.js), boot the ROM,
// drive the scene's steps with the ring gate's own interpreter and judge every record against the independent VRAM/attribute oracle
// (test/lib/ringoracle.js via the gate's ringjudge.mjs). Nothing here is a second oracle: the scenes, the interpreter and the judge are the
// certified S1 prototype's, reused unchanged; this file only adds the PPU write trace and the strip observations C2's tests need.
import fs from 'node:fs';
import { CELLS, ringProject } from '../lua/ring_gate/ringworld.mjs';
import { bootRom, runSteps } from '../lua/ring_gate/ringrun_jsnes.mjs';
import { checkAddresses } from '../lua/ring_gate/ringaddr.mjs';
import { judge, judgeCoverage } from '../lua/ring_gate/ringjudge.mjs';
import { scanEquates, resolveEquates } from './equates.js';
import { buildThrough } from './ringbypass.js';

export { CELLS };
export const cellById = (id) => CELLS.find((c) => c.id === id);
/** never-reached text that pushes music+sfx+text past the resident kernel-hi ceiling so the dialogue overlay lands in the battle bank (an RPG) */
export const BULK = 3000;

/** The build's own equates (constants.asm + the generated config.inc), resolved. */
export function buildSymbols(dir) {
  const pending = new Map();
  scanEquates(fs.readFileSync(`${dir}/build/constants.asm`, 'utf8'), pending);
  scanEquates(fs.readFileSync(`${dir}/build/assets/config.inc`, 'utf8'), pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  return symbols;
}
/** The assembled labels (game.fns): name -> address. */
export function readFns(symbolPath) {
  const fns = {};
  if (symbolPath) for (const m of fs.readFileSync(symbolPath, 'utf8').matchAll(/^(\w+)\s*=\s*\$([0-9A-Fa-f]+)/gm)) fns[m[1]] = parseInt(m[2], 16);
  return fns;
}

/** The scene's project: { project, gridW, gridH } -- `scene` is a ringscene/ringredraw/ringdialogue scene ({ start, world, steps, expect }). */
export function sceneProject({ cell, gameType, scene, placement = 'resident', talkers = scene.world?.talkers ?? 'enter' }) {
  return ringProject({ cell, gameType, n: scene.world?.n ?? 4, talkers, start: scene.start ?? {}, bulkText: placement === 'banked' ? BULK : 0, mutate: scene.world?.mutate });
}

/**
 * Counts every PPU write ($2007) by canonical bus address, and the writes that land on a MIRROR ALIAS of a live nametable.
 * The count is the WHOLE scene's: a power cycle (`nes.reloadROM()` -> `nes.reset()`) replaces the PPU object, so the wrapper follows `nes.reset`
 * and is put on each replacement PPU before it runs a frame or takes a write. `trace.epochs` has one entry per PPU (the first, then one per
 * power cycle) with that PPU's own writes, so what is drawn AFTER a Continue is witnessed on its own and not through counters from before it.
 */
export function installPpuTrace(nes, { aliasRange }) {
  const trace = { writes: 0, alias: [], byNt: { 0x2000: 0, 0x2400: 0, 0x2800: 0, 0x2c00: 0 }, epochs: [], resets: 0 };
  const attach = (ppu) => {
    const epoch = { writes: 0, byNt: { 0x2000: 0, 0x2400: 0, 0x2800: 0, 0x2c00: 0 } };
    trace.epochs.push(epoch);
    const orig = ppu.mirroredWrite.bind(ppu);
    ppu.mirroredWrite = (address, value) => {
      trace.writes++;
      epoch.writes++;
      const nt = address & 0x2c00;
      if (address >= 0x2000 && address < 0x3000) { trace.byNt[nt]++; epoch.byNt[nt]++; }
      if (aliasRange(address)) trace.alias.push(address);
      return orig(address, value);
    };
  };
  attach(nes.ppu);
  // FORGE_RING_TRACE_SABOTAGE=attach-once puts back the defect the fix removed (test/lua/run_ring_sabotage.mjs): the trace stays on the first PPU
  if (process.env.FORGE_RING_TRACE_SABOTAGE === 'attach-once') return trace;
  const reset = nes.reset.bind(nes);
  nes.reset = () => {
    reset();
    trace.resets++;
    attach(nes.ppu);
  };
  return trace;
}

/**
 * Builds and runs a scene. Returns { recs, verdicts, bad, cov, trace, stActiveSeen, symbols, fns, dir, romPath }.
 * `trace` is the PPU write trace (the canonical-address check the judge says it cannot make); `stActiveSeen` the set of strip modes observed.
 * The build directory is removed unless `keepDir`.
 */
export async function runScene({ loaded, cell, gameType = 'action', scene, placement = 'resident', talkers, keepDir = false, onNes = null }) {
  const { project, gridW, gridH } = sceneProject({ cell, gameType, scene, placement, talkers });
  const built = await buildThrough(loaded, project);
  try {
    const symbols = buildSymbols(built.dir);
    const addrBad = checkAddresses(symbols);
    if (addrBad.length) throw new Error(`transcribed RAM addresses disagree with the build: ${addrBad.join('; ')}`);
    const fns = readFns(built.symbolPath);
    const nes = bootRom(built.romPath);
    const stActive = symbols.get('st_active');
    const stActiveSeen = new Set();
    // vertical mirroring: $2800/$2C00 are the aliases of $2000/$2400; no write may ever be addressed there
    const trace = installPpuTrace(nes, { aliasRange: (a) => (a >= 0x2800 && a < 0x3000) || (a >= 0x3800 && a < 0x3f00) });
    onNes?.(nes, { symbols, fns });
    const recs = runSteps(nes, scene.steps, { onFrame: (n) => stActiveSeen.add(n.cpu.mem[stActive]) });
    const ctx = { project, ring: cell.ring, gridW, gridH, typing: scene.expect.typing };
    const verdicts = recs.map((r) => judge(r, ctx));
    const bad = verdicts.filter((v) => !v.ok);
    const cov = judgeCoverage(recs, scene.expect, ctx);
    return { recs, verdicts, bad, cov, trace, stActiveSeen, symbols, fns, project, built, nes };
  } finally {
    if (!keepDir) fs.rmSync(built.dir, { recursive: true, force: true });
  }
}

/** Which boards a ring test file runs: the full vertical matrix normally, MMC3 alone under a sabotage run (the catch matrix of test/lua/run_ring_sabotage.mjs). */
export const RING_BOARDS = process.env.FORGE_RING_SABOTAGE ? ['MMC3-V'] : ['MMC3-V', 'MMC1-V', 'U512-V'];
export const RING_FULL = !process.env.FORGE_RING_SABOTAGE;

/**
 * The assertions every ring run owes, in ONE place: the oracle verdict of every record (terrain + attributes of both live nametables, the
 * camera registers, the displayed nametable, the dialogue box), the scenario's coverage verdict, no PPU write addressed to a mirror alias
 * ($28xx/$2Cxx on vertical mirroring -- the judge reads through the mirror and cannot see this) on ANY PPU of the run, both live nametables really
 * written by every PPU of the run, including each one a power cycle creates (so an empty trace cannot pass), and the strip mode never 2 (no row strip exists on a vertical ring).
 */
export function assertRingRun(assert, r, label) {
  assert.equal(r.bad.length, 0, `${label}: ${r.bad.length} bad record(s): ${r.bad.slice(0, 3).map((v) => `${v.label}: ${v.fails.slice(0, 2).join(' | ')}`).join(' // ')}`);
  assert.equal(r.cov.ok, true, `${label}: coverage: ${r.cov.fails.slice(0, 4).join(' | ')}`);
  assert.equal(r.trace.alias.length, 0, `${label}: ${r.trace.alias.length} PPU write(s) addressed to a mirror alias, e.g. $${(r.trace.alias[0] ?? 0).toString(16)}`);
  assert.ok(r.trace.byNt[0x2000] > 0 && r.trace.byNt[0x2400] > 0, `${label}: both live nametables must have been written (${JSON.stringify(r.trace.byNt)})`);
  // every PPU the run used -- the first and the one each power cycle (Continue) makes -- must itself have written both live nametables
  r.trace.epochs.forEach((e, i) => assert.ok(e.byNt[0x2000] > 0 && e.byNt[0x2400] > 0, `${label}: PPU ${i} of ${r.trace.epochs.length} (${i ? 'after a power cycle' : 'first boot'}) did not write both live nametables (${JSON.stringify(e.byNt)})`));
  assert.ok(!r.stActiveSeen.has(2), `${label}: a row strip (st_active = 2) ran on a vertical ring`);
}
