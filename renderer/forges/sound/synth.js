// Turns APU register writes into sound through Web Audio.
//
// Pitch, rhythm and volume are exact — they come from the same replayer the ROM
// agrees with. The timbre is an approximation: real duty-cycle pulses and a
// filtered noise source, rather than a cycle-accurate APU.

import { CPU_CLOCK } from '../../../shared/audio.js';

// NTSC noise period table, indexed by the low nibble of $400E.
const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const DUTY_CYCLES = [0.125, 0.25, 0.5, 0.75];
const MASTER = 0.18;

/** Fourier series for a pulse wave of the given duty cycle. */
function pulseWave(context, duty, harmonics = 32) {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  return context.createPeriodicWave(real, imag, { disableNormalization: false });
}

function noiseBuffer(context) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  let shift = 1;
  // A 15-bit LFSR, like the APU's, so the texture is in the right family.
  for (let i = 0; i < data.length; i++) {
    const bit = (shift ^ (shift >> 1)) & 1;
    shift = (shift >> 1) | (bit << 14);
    data[i] = (shift & 1) * 2 - 1;
  }
  return buffer;
}

export class Synth {
  constructor() {
    this.context = null;
    this.ready = false;
    this.failed = null;
  }

  async start() {
    if (this.ready) return true;
    try {
      const context = new AudioContext();
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = MASTER;
      this.master.connect(context.destination);

      this.waves = DUTY_CYCLES.map((duty) => pulseWave(context, duty));

      this.pulses = [0, 1].map(() => {
        const gain = context.createGain();
        gain.gain.value = 0;
        gain.connect(this.master);
        const oscillator = context.createOscillator();
        oscillator.setPeriodicWave(this.waves[2]);
        oscillator.frequency.value = 440;
        oscillator.connect(gain);
        oscillator.start();
        return { oscillator, gain, duty: 2 };
      });

      const triangleGain = context.createGain();
      triangleGain.gain.value = 0;
      triangleGain.connect(this.master);
      const triangleOsc = context.createOscillator();
      triangleOsc.type = 'triangle';
      triangleOsc.frequency.value = 220;
      triangleOsc.connect(triangleGain);
      triangleOsc.start();
      this.triangle = { oscillator: triangleOsc, gain: triangleGain };

      const noiseGain = context.createGain();
      noiseGain.gain.value = 0;
      noiseGain.connect(this.master);
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.8;
      filter.frequency.value = 4000;
      filter.connect(noiseGain);
      const noiseSource = context.createBufferSource();
      noiseSource.buffer = noiseBuffer(context);
      noiseSource.loop = true;
      noiseSource.connect(filter);
      noiseSource.start();
      this.noise = { filter, gain: noiseGain };

      this.ready = true;
    } catch (error) {
      this.failed = error.message;
      this.ready = false;
    }
    return this.ready;
  }

  resume() {
    if (this.context?.state === 'suspended') this.context.resume();
  }

  /** Apply one frame's worth of APU writes. */
  apply(writes) {
    if (!this.ready) return;
    const now = this.context.currentTime;
    for (const [address, value] of writes) {
      switch (address) {
        case 0x4000:
        case 0x4004: {
          const pulse = this.pulses[address === 0x4000 ? 0 : 1];
          const duty = (value >> 6) & 3;
          if (duty !== pulse.duty) {
            pulse.duty = duty;
            pulse.oscillator.setPeriodicWave(this.waves[duty]);
          }
          pulse.gain.gain.setTargetAtTime((value & 15) / 15, now, 0.004);
          break;
        }
        case 0x4002:
        case 0x4006: {
          const index = address === 0x4002 ? 0 : 1;
          this.pulses[index].pendingLow = value;
          break;
        }
        case 0x4003:
        case 0x4007: {
          const index = address === 0x4003 ? 0 : 1;
          const pulse = this.pulses[index];
          const period = ((value & 7) << 8) | (pulse.pendingLow ?? 0);
          if (period > 7) pulse.oscillator.frequency.setValueAtTime(CPU_CLOCK / (16 * (period + 1)), now);
          break;
        }
        case 0x4008:
          this.triangle.gain.gain.setTargetAtTime(value === 0 ? 0 : 0.7, now, 0.004);
          break;
        case 0x400a:
          this.triangle.pendingLow = value;
          break;
        case 0x400b: {
          const period = ((value & 7) << 8) | (this.triangle.pendingLow ?? 0);
          if (period > 3) this.triangle.oscillator.frequency.setValueAtTime(CPU_CLOCK / (32 * (period + 1)), now);
          break;
        }
        case 0x400c:
          this.noise.gain.gain.setTargetAtTime(((value & 15) / 15) * 0.5, now, 0.004);
          break;
        case 0x400e: {
          const period = NOISE_PERIODS[value & 15] ?? 64;
          this.noise.filter.frequency.setValueAtTime(Math.min(12000, CPU_CLOCK / period), now);
          break;
        }
        default:
          break;
      }
    }
  }

  silence() {
    if (!this.ready) return;
    const now = this.context.currentTime;
    for (const pulse of this.pulses) pulse.gain.gain.setTargetAtTime(0, now, 0.01);
    this.triangle.gain.gain.setTargetAtTime(0, now, 0.01);
    this.noise.gain.gain.setTargetAtTime(0, now, 0.01);
  }

  destroy() {
    try {
      this.context?.close();
    } catch {
      // already closed
    }
    this.context = null;
    this.ready = false;
  }
}
