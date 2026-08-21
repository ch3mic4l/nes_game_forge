// Run control for the embedded emulator: stepping, breakpoints, watchpoints.
//
// jsnes exposes a per-instruction CPU loop, so this drives the same sequence
// nes.frame() does but can stop between any two instructions.

import NES from './core/nes.js';
import { resolveOverrideTargets, TOGGLE_NAMES } from '../../shared/testoverrides.js';

export const BUTTON = {
  A: 0,
  B: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7
};

export class Emulator {
  constructor({ onFrame, onAudioSample, sampleRate = 44100 } = {}) {
    this.nes = new NES({
      onFrame,
      onAudioSample,
      sampleRate,
      emulateSound: Boolean(onAudioSample)
    });
    this.breakpoints = new Set();
    this.readWatch = new Set();
    this.writeWatch = new Set();
    this.running = false;
    this.inFrame = false;
    this.frames = 0;
    this.instructions = 0;
    this.lastBreak = null;
    this.crashed = null;
    this.onBreak = null;

    // Debugger-side test overrides (invincibility, encounters off, collision
    // off) -- see shared/testoverrides.js. `testOverrides` is the tester's own
    // intent (the checkbox state); it survives loadROM/reset the same way
    // breakpoints already do, because it is the debugger's own configuration,
    // not part of the game. `overrideTargets`/`interceptsByTrap` are resolved
    // *addresses*, which are only valid for the ROM they were resolved
    // against -- loadROM invalidates them below, and the caller must call
    // configureTestOverrides() again after every load, including a reload of
    // the same ROM, or the toggles simply stay inert rather than risk running
    // against another build's addresses.
    this.testOverrides = Object.fromEntries(TOGGLE_NAMES.map((name) => [name, false]));
    this.overrideTargets = null;
    this.interceptsByTrap = new Map();
  }

  loadROM(bytes) {
    // Invalidated before the loader runs, not after: a throw partway through
    // `nes.loadROM()` (a malformed ROM, say) can still have mutated mapper/PPU
    // state on the way to throwing, and the caller is expected to treat that
    // throw as "this Emulator is done" -- but if it doesn't, the *previous*
    // ROM's resolved addresses must not still be armed against whatever this
    // one left behind.
    this.overrideTargets = null;
    this.interceptsByTrap = new Map();
    this.nes.loadROM(bytes);
    this.inFrame = false;
    this.frames = 0;
    this.instructions = 0;
    this.crashed = null;
    this.installWatchHooks();
  }

  /**
   * Resolve invincibility/encounters/collision targets against this build's
   * `ram` (parsed constants.asm) and `symbols` (parsed game.fns), and arm the
   * per-instruction intercept table. Call this after every loadROM() -- a
   * fresh load clears any previously resolved targets so a toggle can never
   * run against a stale address from a different build.
   */
  configureTestOverrides({ ram, symbols }) {
    this.overrideTargets = resolveOverrideTargets({ ram, symbols });
    this.interceptsByTrap = new Map();
    for (const [name, spec] of Object.entries(this.overrideTargets)) {
      if (spec) this.interceptsByTrap.set(spec.trap, { name, spec });
    }
  }

  /** Merge a partial update into the toggle booleans -- {collision: true} leaves the others alone. */
  setTestOverrides(partial) {
    Object.assign(this.testOverrides, partial);
  }

  /**
   * Apply an armed intercept at the current PC, if any is active here.
   * @returns {boolean} true when the trapped instruction must NOT execute
   *   this call, because the intercept already redirected past it
   */
  applyTestIntercept() {
    if (!this.interceptsByTrap.size) return false;
    const hit = this.interceptsByTrap.get(this.pc);
    if (!hit || !this.testOverrides[hit.name]) return false;
    const { spec } = hit;
    if (spec.kind === 'poke') {
      this.poke(spec.address, spec.value);
      return false; // the trapped instruction still runs this same call
    }
    // 'redirect': land on the target and stop here -- this step IS the
    // control-flow transition, observable to breakpoints, runToAddress,
    // stepOut and stepOver exactly like any other step, because nothing
    // downstream can tell it apart from one.
    if (typeof spec.setAcc === 'number') this.nes.cpu.REG_ACC = spec.setAcc;
    this.nes.cpu.REG_PC = (spec.target - 1) & 0xffff;
    return true;
  }

  reset() {
    // Through the loader, not `nes.reset()`. That call builds a *new* PPU and a
    // new mapper, so everything `loadROM` does after its own reset would have to
    // be repeated here and kept in step with the core forever — and the version
    // that repeated only half of it left the nametables unallocated, so the
    // first background write after a reset threw from inside the PPU.
    // `reloadROM()` is that sequence, written down once, upstream.
    //
    // The Reset button on real hardware never touches cartridge RAM at all —
    // it pulses the CPU/PPU reset line, not the power rail, so $6000-$7FFF
    // survives whether or not the board has a battery behind it (the battery's
    // job is surviving a real power-off, not this). reloadROM() rebuilds the
    // mapper from scratch and re-runs the CPU's own power-on RAM clear
    // (boot_clear in engine/boot.asm), which only ever touches $0000-$07FF —
    // $6000-$7FFF was never in that range either, so on this core the only
    // reason to snapshot and restore it here is that `nes.mmap.loadROM()`
    // (jsnes's own reset path) may zero its backing array; matching hardware
    // means asserting that expectation rather than trusting it silently held.
    // A creator using Reset to test a save depends on this: without it,
    // Reset would look like a power cycle wiped the battery, which is not
    // what pressing Reset does on a real console.
    const battery = this.nes.cpu?.mem?.slice(0x6000, 0x8000) ?? null;
    if (this.nes.romData) this.nes.reloadROM();
    else this.nes.reset();
    if (battery) this.nes.cpu.mem.set(battery, 0x6000);
    this.inFrame = false;
    this.frames = 0;
    this.instructions = 0;
    this.crashed = null;
    this.installWatchHooks();
  }

  /**
   * Wrap the mapper's bus so memory watchpoints cost nothing until one is set:
   * the hook checks an empty Set and returns immediately.
   */
  installWatchHooks() {
    const mmap = this.nes.mmap;
    if (!mmap || mmap.__forgeHooked) return;
    const originalLoad = mmap.load.bind(mmap);
    const originalWrite = mmap.write.bind(mmap);
    mmap.load = (address) => {
      if (this.readWatch.size && this.readWatch.has(address & 0xffff)) {
        this.pendingBreak = { kind: 'read', address: address & 0xffff };
      }
      return originalLoad(address);
    };
    mmap.write = (address, value) => {
      if (this.writeWatch.size && this.writeWatch.has(address & 0xffff)) {
        this.pendingBreak = { kind: 'write', address: address & 0xffff, value };
      }
      return originalWrite(address, value);
    };
    mmap.__forgeHooked = true;
  }

  get pc() {
    return (this.nes.cpu.REG_PC + 1) & 0xffff;
  }

  /** CPU-visible byte, without disturbing PPU or controller state. */
  peek(address) {
    const cpu = this.nes.cpu;
    address &= 0xffff;
    if (address < 0x2000) return cpu.mem[address & 0x7ff];
    if (address >= 0x8000 || (address >= 0x6000 && address < 0x8000)) {
      return this.nes.mmap ? this.nes.mmap.load(address) : 0;
    }
    // $2000-$5FFF is register space; reading it for real has side effects.
    return cpu.mem[address] ?? 0;
  }

  poke(address, value) {
    address &= 0xffff;
    if (address < 0x2000) this.nes.cpu.mem[address & 0x7ff] = value & 0xff;
    else if (this.nes.mmap) this.nes.mmap.write(address, value & 0xff);
  }

  beginFrame() {
    this.nes.controllers[1].clock();
    this.nes.controllers[2].clock();
    this.nes.ppu.startFrame();
    this.inFrame = true;
  }

  /**
   * Advance by one step: ordinarily one CPU instruction (or one chunk of DMA
   * halt cycles), but a redirect intercept (shared/testoverrides.js) makes
   * the intercept itself the step instead — landing on the target PC costs no
   * CPU/PPU/APU cycles and executes no instruction at all, so that this step
   * is the observable control-flow transition breakpoints, runToAddress,
   * stepOut and stepOver all see, rather than something silently folded into
   * the next one.
   * @returns {boolean} true when the PPU finished a frame
   */
  stepInstruction() {
    if (!this.inFrame) this.beginFrame();
    const { cpu, ppu, papu } = this.nes;

    if (cpu.cyclesToHalt === 0) {
      // Checked here, not in a DMA-halt chunk, so a halt cannot re-apply the
      // same intercept several times over while it counts down.
      if (!this.applyTestIntercept()) {
        const cycles = cpu.emulate();
        papu.clockFrameCounter(cycles, cpu.apuCatchupCycles);
        cpu.apuCatchupCycles = 0;
        this.instructions++;
      }
    } else {
      const chunk = Math.min(cpu.cyclesToHalt, 8);
      for (let i = 0; i < chunk; i++) ppu.advanceDots(3);
      papu.clockFrameCounter(chunk);
      cpu.cyclesToHalt -= chunk;
      cpu._cpuCycleBase += chunk;
    }

    if (ppu.frameEnded) {
      ppu.frameEnded = false;
      this.inFrame = false;
      this.frames++;
      return true;
    }
    return false;
  }

  /** Step one instruction, stepping over a JSR so the whole call runs. */
  stepOver() {
    const opcode = this.peek(this.pc);
    if (opcode !== 0x20) return this.stepInstruction(); // not JSR
    const returnTo = (this.pc + 3) & 0xffff;
    const limit = 2_000_000;
    for (let i = 0; i < limit; i++) {
      this.stepInstruction();
      if (this.pc === returnTo) return false;
      if (this.checkBreak()) return false;
    }
    return false;
  }

  /** Run until the current subroutine returns. */
  stepOut() {
    const startDepth = this.nes.cpu.REG_SP;
    const limit = 2_000_000;
    for (let i = 0; i < limit; i++) {
      const opcode = this.peek(this.pc);
      this.stepInstruction();
      if (opcode === 0x60 && this.nes.cpu.REG_SP > startDepth) return;
      if (this.checkBreak()) return;
    }
  }

  stepScanline() {
    const start = this.nes.ppu.scanline;
    const limit = 200000;
    for (let i = 0; i < limit; i++) {
      if (this.stepInstruction()) return;
      if (this.nes.ppu.scanline !== start) return;
    }
  }

  /** Run to the end of the current frame, stopping early on a breakpoint. */
  runFrame() {
    const limit = 500000;
    for (let i = 0; i < limit; i++) {
      if (this.stepInstruction()) return { frameEnded: true };
      const hit = this.checkBreak();
      if (hit) return { frameEnded: false, hit };
    }
    return { frameEnded: false, exhausted: true };
  }

  /**
   * Run until the program counter reaches `address`, and answer whether it did.
   *
   * The budget is in frames rather than instructions because every caller is
   * really asking a question about frames — "has this ROM finished booting
   * yet?" — and a boot that draws a screen under forced blank is a very
   * different number of instructions on one cartridge than on another.
   */
  runToAddress(address, { frames = 60 } = {}) {
    let left = frames;
    const limit = 500000 * frames;
    for (let i = 0; i < limit && left > 0; i++) {
      if (this.pc === address) return true;
      if (this.stepInstruction()) left--;
    }
    return false;
  }

  checkBreak() {
    if (this.pendingBreak) {
      const hit = this.pendingBreak;
      this.pendingBreak = null;
      this.lastBreak = hit;
      this.running = false;
      this.onBreak?.(hit);
      return hit;
    }
    if (this.breakpoints.size && this.breakpoints.has(this.pc)) {
      const hit = { kind: 'pc', address: this.pc };
      this.lastBreak = hit;
      this.running = false;
      this.onBreak?.(hit);
      return hit;
    }
    return null;
  }

  toggleBreakpoint(address) {
    const value = address & 0xffff;
    if (this.breakpoints.has(value)) this.breakpoints.delete(value);
    else this.breakpoints.add(value);
    return this.breakpoints.has(value);
  }

  setButton(button, down) {
    if (down) this.nes.buttonDown(1, button);
    else this.nes.buttonUp(1, button);
  }

  /** Snapshot of everything the debugger panels display. */
  state() {
    const cpu = this.nes.cpu;
    const ppu = this.nes.ppu;
    return {
      pc: this.pc,
      a: cpu.REG_ACC,
      x: cpu.REG_X,
      y: cpu.REG_Y,
      sp: cpu.REG_SP & 0xff,
      flags: {
        n: cpu.F_SIGN,
        v: cpu.F_OVERFLOW,
        d: cpu.F_DECIMAL,
        i: cpu.F_INTERRUPT,
        z: cpu.F_ZERO,
        c: cpu.F_CARRY
      },
      scanline: ppu.scanline,
      frames: this.frames,
      instructions: this.instructions
    };
  }
}
