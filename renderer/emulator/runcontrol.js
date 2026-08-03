// Run control for the embedded emulator: stepping, breakpoints, watchpoints.
//
// jsnes exposes a per-instruction CPU loop, so this drives the same sequence
// nes.frame() does but can stop between any two instructions.

import NES from './core/nes.js';

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
  }

  loadROM(bytes) {
    this.nes.loadROM(bytes);
    this.inFrame = false;
    this.frames = 0;
    this.instructions = 0;
    this.crashed = null;
    this.installWatchHooks();
  }

  reset() {
    this.nes.reset();
    if (this.nes.mmap) this.nes.mmap.loadROM();
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
   * Execute exactly one CPU instruction (or one chunk of DMA halt cycles).
   * @returns {boolean} true when the PPU finished a frame
   */
  stepInstruction() {
    if (!this.inFrame) this.beginFrame();
    const { cpu, ppu, papu } = this.nes;

    if (cpu.cyclesToHalt === 0) {
      const cycles = cpu.emulate();
      papu.clockFrameCounter(cycles, cpu.apuCatchupCycles);
      cpu.apuCatchupCycles = 0;
      this.instructions++;
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
