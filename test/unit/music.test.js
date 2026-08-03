import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { Replayer } from '../../renderer/forges/sound/replayer.js';
import { compileSong } from '../../main/build/songcompile.js';
import { loadProject } from '../../main/project-io.js';
import {
  PERIOD_TABLE,
  CPU_CLOCK,
  noteFrequency,
  noteName,
  envelopeVolume,
  normalizeSong,
  OP_REST,
  OP_INSTRUMENT
} from '../../shared/audio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);

test('the period table tunes A-4 to 440 Hz', () => {
  const period = PERIOD_TABLE[45];
  const frequency = CPU_CLOCK / (16 * (period + 1));
  assert.ok(Math.abs(frequency - 440) < 1, `A-4 came out at ${frequency.toFixed(2)} Hz`);
  assert.equal(noteName(45), 'A-4');
  assert.equal(noteName(36), 'C-4');
});

test('an octave up halves the period', () => {
  for (const note of [36, 45, 60]) {
    const low = PERIOD_TABLE[note] + 1;
    const high = PERIOD_TABLE[note + 12] + 1;
    assert.ok(Math.abs(low / 2 - high) <= 1, `note ${note}: ${low} vs ${high}`);
  }
});

test('every period fits the APU register', () => {
  for (const period of PERIOD_TABLE) assert.ok(period >= 0 && period <= 0x7ff);
});

test('envelopes hold at their sustain entry', () => {
  const instrument = { volEnv: [15, 10, 5], sustain: 2 };
  assert.equal(envelopeVolume(instrument, 0), 15);
  assert.equal(envelopeVolume(instrument, 2), 5);
  assert.equal(envelopeVolume(instrument, 50), 5);
  // A sustain past the end clamps rather than reading undefined.
  assert.equal(envelopeVolume({ volEnv: [7], sustain: 9 }, 30), 7);
});

test('the compiler turns rows into notes with frame durations', () => {
  const song = normalizeSong({
    tempo: { framesPerRow: 6 },
    instruments: [{ duty: 2, volEnv: [15] }],
    patterns: [
      {
        id: 0,
        rows: 4,
        channels: { pulse1: [{ note: 45, inst: 0 }, null, { note: 47, inst: 0 }, null] }
      }
    ],
    order: [0],
    loop: 0
  });
  const compiled = compileSong(song);
  const pulse1 = compiled.channels.find((channel) => channel.id === 'pulse1');
  // instrument select, then two notes of two rows each.
  assert.deepEqual(pulse1.bytes, [OP_INSTRUMENT | 0, 45, 12, 47, 12]);
  assert.equal(pulse1.loopOffset, 0);

  // A channel with nothing in it still rests rather than running off the end.
  const noise = compiled.channels.find((channel) => channel.id === 'noise');
  assert.equal(noise.bytes[0], OP_REST);
});

test('a long note is split into byte-sized durations', () => {
  const song = normalizeSong({
    tempo: { framesPerRow: 31 },
    patterns: [{ id: 0, rows: 20, channels: { pulse1: [{ note: 45, inst: 0 }] } }],
    order: [0]
  });
  const pulse1 = compileSong(song).channels.find((channel) => channel.id === 'pulse1');
  const durations = [];
  for (let i = 0; i < pulse1.bytes.length; i++) {
    if (pulse1.bytes[i] === 45) durations.push(pulse1.bytes[i + 1]);
  }
  assert.ok(durations.length > 1, 'expected the note to be split');
  assert.ok(durations.every((value) => value > 0 && value <= 255));
  assert.equal(
    durations.reduce((total, value) => total + value, 0),
    20 * 31,
    'the split must preserve the total length'
  );
});

// ---------------------------------------------------------------------------
// The golden test: the ROM's driver and the preview replayer must produce
// identical APU writes, or what you hear in the Sound Forge is a lie.
// ---------------------------------------------------------------------------

const APU_LOW = 0x4000;
const APU_HIGH = 0x400f;

/** Run the ROM and collect the APU writes it makes, grouped by frame. */
function recordRomWrites(frames) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM_PATH)));

  const perFrame = [];
  let current = [];
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address >= APU_LOW && address <= APU_HIGH) current.push([address, value & 0xff]);
    return originalWrite(address, value);
  };

  for (let i = 0; i < frames; i++) {
    current = [];
    nes.frame();
    perFrame.push(current);
  }
  return perFrame;
}

test('the ROM driver and the preview replayer agree', { skip: !hasRom && 'run `npm run sample` first' }, async () => {
  const project = await loadProject(SAMPLE);
  assert.ok(project.songs.length, 'the sample project should contain a song');

  const compiled = compileSong(project.songs[0]);
  const replayer = new Replayer(compiled);

  const romFrames = recordRomWrites(200);
  // The driver starts on the first pass through the main loop, a frame or two
  // after reset, so line the two up on the first frame that writes anything.
  const start = romFrames.findIndex((writes) => writes.length > 0);
  assert.ok(start >= 0, 'the ROM never wrote to the APU — is the song playing?');

  const compare = 150;
  for (let i = 0; i < compare; i++) {
    const expected = replayer.tick();
    const actual = romFrames[start + i];
    assert.deepEqual(
      actual,
      expected,
      `APU writes differ on frame ${i} (ROM frame ${start + i}):\n` +
        `  ROM:      ${JSON.stringify(actual)}\n` +
        `  replayer: ${JSON.stringify(expected)}`
    );
  }
});

test('the song actually plays notes, not just silence', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const romFrames = recordRomWrites(200);
  const all = romFrames.flat();
  assert.ok(all.length > 100, `only ${all.length} APU writes in 200 frames`);
  // A period write to $4002 means a real note started on pulse 1.
  assert.ok(
    all.some(([address]) => address === 0x4002),
    'pulse 1 never received a period, so no note was played'
  );
  assert.ok(
    all.some(([address]) => address === 0x400a),
    'the triangle never received a period'
  );
});
