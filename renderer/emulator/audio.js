// Web Audio plumbing for the embedded emulator.

export class AudioOut {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.context = null;
    this.node = null;
    this.left = [];
    this.right = [];
    this.ready = false;
    this.failed = null;
    this.muted = false;
    this.level = null; // the worklet's buffer depth, reported back for pacing
  }

  async start() {
    if (this.context) return this.ready;
    try {
      this.context = new AudioContext({ sampleRate: this.sampleRate });
      await this.context.audioWorklet.addModule('./emulator/audio-worklet.js');
      this.node = new AudioWorkletNode(this.context, 'nes-audio', { outputChannelCount: [2] });
      this.node.port.onmessage = (event) => {
        if (event.data?.type === 'level') this.level = event.data.value;
      };
      this.node.connect(this.context.destination);
      this.ready = true;
    } catch (error) {
      this.failed = error.message;
      this.ready = false;
    }
    return this.ready;
  }

  /** Called by the emulator for every generated sample. */
  push(left, right) {
    this.left.push(left);
    this.right.push(right);
  }

  /** Hand one frame's worth of samples to the audio thread. */
  flush() {
    if (!this.ready || this.muted || !this.left.length) {
      this.left.length = 0;
      this.right.length = 0;
      return;
    }
    this.node.port.postMessage({
      type: 'samples',
      left: Float32Array.from(this.left),
      right: Float32Array.from(this.right)
    });
    this.left.length = 0;
    this.right.length = 0;
  }

  setMuted(muted) {
    this.muted = muted;
    this.level = null; // a stale depth must not steer the pace while silent
    this.left.length = 0;
    this.right.length = 0;
    this.node?.port.postMessage({ type: 'mute', value: muted });
  }

  /**
   * How fast the emulator should run relative to real time, from the worklet's
   * buffer depth: low means the sound card is draining faster than we produce,
   * so speed up a hair; high means slow down. The ±2% bound is far more than
   * any real clock skew and far less than an audible tempo change — its job is
   * to hold the cushion steady, not to chase it.
   */
  driftRatio() {
    if (!this.ready || this.muted || this.level === null) return 1;
    const target = 4096;
    return 1 + Math.max(-0.02, Math.min(0.02, ((target - this.level) / target) * 0.02));
  }

  resume() {
    if (this.context?.state === 'suspended') this.context.resume();
  }

  destroy() {
    try {
      this.node?.disconnect();
      this.context?.close();
    } catch {
      // already torn down
    }
    this.context = null;
    this.node = null;
    this.ready = false;
  }
}
