// AudioWorklet processor for the embedded emulator.
//
// The emulator produces samples in bursts (one burst per emulated frame), so
// they land in a ring buffer here and drain at the audio thread's own pace.

const CAPACITY = 16384;

class NesAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(CAPACITY);
    this.right = new Float32Array(CAPACITY);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.muted = false;
    // Output holds silent until a small cushion builds, so startup and the
    // occasional late frame cost one clean gap instead of a spray of clicks.
    this.primed = false;
    this.sincePost = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'mute') {
        this.muted = data.value;
        if (data.value) this.available = this.readIndex = this.writeIndex = 0;
        return;
      }
      if (data.type !== 'samples') return;
      const { left, right } = data;
      for (let i = 0; i < left.length; i++) {
        if (this.available >= CAPACITY) break; // overrun: drop the tail
        this.left[this.writeIndex] = left[i];
        this.right[this.writeIndex] = right[i];
        this.writeIndex = (this.writeIndex + 1) % CAPACITY;
        this.available++;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] ?? output[0];
    if (!this.primed && this.available >= 1024) this.primed = true;
    for (let i = 0; i < outL.length; i++) {
      if (this.muted || !this.primed || this.available === 0) {
        if (this.available === 0) this.primed = false;
        outL[i] = 0;
        outR[i] = 0;
        continue;
      }
      outL[i] = this.left[this.readIndex];
      outR[i] = this.right[this.readIndex];
      this.readIndex = (this.readIndex + 1) % CAPACITY;
      this.available--;
    }
    // Report the fill level now and then; the run loop trims its pace with it.
    if (++this.sincePost >= 32) {
      this.sincePost = 0;
      this.port.postMessage({ type: 'level', value: this.available });
    }
    return true;
  }
}

registerProcessor('nes-audio', NesAudioProcessor);
