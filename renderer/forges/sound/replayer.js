// A JavaScript implementation of engine/music.asm.
//
// It consumes the very same byte streams the compiler puts in the ROM and
// produces the same APU register writes, frame by frame. The Sound Forge feeds
// those writes to a synthesiser for preview, and test/unit/music.test.js diffs
// them against what the real ROM writes, so the two cannot silently drift.
//
// The one representational difference: the ROM stream ends with an explicit
// "$FF, address" jump, while the compiled byte array ends where the loop
// begins. Wrapping to `loopOffset` here is exactly equivalent.

import { OP_REST, OP_LOOP, OP_INSTRUMENT, PERIOD_TABLE, NUM_NOTES, envelopeVolume } from '../../../shared/audio.js';

const SILENT = 0xff;

export class Replayer {
  /**
   * @param {{channels: Array<{bytes: number[], loopOffset: number}>, instruments: object[]}} song
   */
  constructor(song) {
    this.song = song;
    this.reset();
  }

  reset() {
    this.channels = this.song.channels.map((channel) => ({
      bytes: channel.bytes,
      loopOffset: channel.loopOffset,
      pointer: 0,
      duration: 0,
      instrument: 0,
      step: 0,
      note: SILENT,
      triggered: false
    }));
    this.frame = 0;
  }

  instrumentAt(index) {
    return this.song.instruments[index] ?? this.song.instruments[0] ?? { duty: 2, volEnv: [15], sustain: 0 };
  }

  read(channel) {
    // Guard against a malformed stream rather than spinning forever.
    for (let guard = 0; guard < 64; guard++) {
      if (channel.pointer >= channel.bytes.length) channel.pointer = channel.loopOffset;
      const opcode = channel.bytes[channel.pointer];

      if (opcode === OP_LOOP) {
        channel.pointer = channel.loopOffset;
        continue;
      }
      if (opcode >= OP_INSTRUMENT && opcode < OP_REST) {
        channel.instrument = opcode & 7;
        channel.pointer += 1;
        continue;
      }
      if (opcode === OP_REST) {
        channel.note = SILENT;
      } else {
        channel.note = opcode;
        channel.step = 0;
        channel.triggered = true;
      }
      channel.duration = channel.bytes[channel.pointer + 1] ?? 1;
      channel.pointer += 2;
      return;
    }
    channel.note = SILENT;
    channel.duration = 255;
  }

  /** Advance one frame. Returns the APU writes it made, as [address, value]. */
  tick() {
    const writes = [];
    this.channels.forEach((channel, index) => {
      channel.triggered = false;
      if (channel.duration === 0) this.read(channel);
      channel.duration = (channel.duration - 1) & 0xff;
      this.apply(channel, index, writes);
      if (channel.step < 31) channel.step++;
    });
    this.frame++;
    return writes;
  }

  apply(channel, index, writes) {
    const instrument = this.instrumentAt(channel.instrument);

    if (channel.note === SILENT) {
      if (index < 2) writes.push([0x4000 + index * 4, 0x30]);
      else if (index === 2) writes.push([0x4008, 0x00]);
      else writes.push([0x400c, 0x30]);
      return;
    }

    const volume = envelopeVolume(instrument, channel.step);

    if (index < 2) {
      const base = 0x4000 + index * 4;
      writes.push([base, ((instrument.duty & 3) << 6) | 0x30 | volume]);
      if (channel.triggered) {
        const period = PERIOD_TABLE[channel.note] ?? 0;
        writes.push([base + 2, period & 0xff]);
        writes.push([base + 3, ((period >> 8) & 0x07) | 0x08]);
      }
      return;
    }

    if (index === 2) {
      if (volume === 0) {
        writes.push([0x4008, 0x00]);
        return;
      }
      writes.push([0x4008, 0xff]);
      if (channel.triggered) {
        const note = Math.min(channel.note + 12, NUM_NOTES - 1);
        const period = PERIOD_TABLE[note] ?? 0;
        writes.push([0x400a, period & 0xff]);
        writes.push([0x400b, ((period >> 8) & 0x07) | 0x08]);
      }
      return;
    }

    writes.push([0x400c, 0x30 | volume]);
    if (channel.triggered) {
      writes.push([0x400e, 15 - (channel.note & 0x0f)]);
      writes.push([0x400f, 0x08]);
    }
  }
}
