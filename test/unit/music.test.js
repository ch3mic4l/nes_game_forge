import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import NES from '../../renderer/emulator/core/nes.js';
import { Replayer } from '../../renderer/forges/sound/replayer.js';
import { compileSong, songTables, songTableBytes } from '../../main/build/songcompile.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { flattenScreens, checkCapacity } from '../../main/build/generate.js';
import { createMap, createProject, validateProject, LIMITS } from '../../shared/project.js';
import {
  PERIOD_TABLE,
  CPU_CLOCK,
  noteFrequency,
  noteName,
  envelopeVolume,
  normalizeSong,
  createSong,
  MAX_TOTAL_INSTRUMENTS,
  OP_REST,
  OP_INSTRUMENT
} from '../../shared/audio.js';
import { finishNamingIfOpen } from '../lib/naming.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// engine/constants.asm. Not parsed out of build/constants.asm the way
// shared/enginesyms.js reads other engine addresses: cur_map and cur_song are
// defined there as expressions (`call_ret_hi+CALL_STACK_DEPTH`, `cur_map+1`)
// rather than a plain `= $HH`/`= 12` literal, which is exactly the shape
// parseEquates skips rather than evaluates, so it comes back undefined for
// both. Hardcoded with a comment is also this codebase's stated convention
// for tests regardless: a test that reads the file it is checking proves
// nothing.
const FLAT_SCREEN = 0x16;
const CUR_MAP = 0x8a;  // NO_MAP until a screen decides
const CUR_SONG = 0x8b; // NO_SONG until set_music runs

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

// -------------------------------------------------------------------------
// Item 12 (review-fixes slice C): songTables concatenates every song's own
// instruments, in song order, into one flat set rather than only song 0's,
// and emits song_inst_base, one byte per song, naming the offset of that
// song's own first instrument.
// -------------------------------------------------------------------------

/** Pulls the numeric values out of one dbBlock-emitted label's own .db line(s). */
function dbBytesAt(inc, label) {
  const match = inc.match(new RegExp(`${label}:\\n((?:  \\.db [^\\n]*\\n?)+)`));
  assert.ok(match, `label ${label} not found in the generated .inc text`);
  return match[1]
    .trim()
    .split('\n')
    .flatMap((line) => line.replace(/^ *\.db /, '').split(','))
    .map((token) => parseInt(token.replace('$', ''), 16));
}

test('songTables concatenates every song\'s own instruments in song order, and song_inst_base names each song\'s own offset', () => {
  const songA = {
    instruments: [
      { duty: 0, volEnv: [1] },
      { duty: 1, volEnv: [2] },
      { duty: 2, volEnv: [3] }
    ],
    patterns: [{ id: 0, rows: 1, channels: {} }],
    order: [0]
  };
  const songB = {
    instruments: [
      { duty: 3, volEnv: [4] },
      { duty: 0, volEnv: [5] }
    ],
    patterns: [{ id: 0, rows: 1, channels: {} }],
    order: [0]
  };
  const inc = songTables([songA, songB]);

  assert.deepEqual(
    dbBytesAt(inc, 'inst_duty'),
    [0, 1, 2, 3, 0],
    'two songs with 3 and 2 instruments should emit 5 table rows total, in song order'
  );
  assert.deepEqual(
    dbBytesAt(inc, 'song_inst_base'),
    [0, 3],
    "song A's own base is 0; song B's is 3, right after song A's own three instruments"
  );
});

test('songTables with no songs at all still emits the SILENT instrument, and song_inst_base still advances', () => {
  const inc = songTables([]);
  assert.deepEqual(dbBytesAt(inc, 'inst_duty'), [2], "the SILENT fallback's own single instrument (duty 2)");
  assert.deepEqual(
    dbBytesAt(inc, 'song_inst_base'),
    [0],
    'one entry (the silent placeholder standing in for the whole project), base 0'
  );
});

/** A raw song with exactly `n` instruments -- MAX_INSTRUMENTS (8) slices anything past its own cap. */
function songWithInstruments(n) {
  return {
    name: 'Song',
    tempo: { framesPerRow: 6 },
    instruments: Array.from({ length: n }, (_, i) => ({ duty: i % 4, volEnv: [15], sustain: 0 })),
    patterns: [{ id: 0, rows: 1, channels: {} }],
    order: [0]
  };
}

test(
  'checkCapacity refuses a project whose songs use more than 256 instruments combined, and fits at exactly 256',
  () => {
    // Control: 32 songs x 8 instruments (MAX_INSTRUMENTS) each = exactly MAX_TOTAL_INSTRUMENTS.
    const control = createProject('Instrument cap control');
    control.songs = Array.from({ length: MAX_TOTAL_INSTRUMENTS / 8 }, () => songWithInstruments(8));
    const { problems: controlProblems } = checkCapacity(control);
    assert.deepEqual(
      controlProblems.filter((p) => p.severity === 'error' && /instrument/i.test(p.message)),
      [],
      `exactly ${MAX_TOTAL_INSTRUMENTS} total instruments must not be refused`
    );

    // Over: the same 32 songs, plus one more instrument on a 33rd song -- 257 total.
    const over = createProject('Instrument cap over');
    over.songs = [...Array.from({ length: MAX_TOTAL_INSTRUMENTS / 8 }, () => songWithInstruments(8)), songWithInstruments(1)];
    const { problems: overProblems } = checkCapacity(over);
    const found = overProblems.find((p) => p.severity === 'error' && /instrument/i.test(p.message));
    assert.ok(found, `${MAX_TOTAL_INSTRUMENTS + 1} total instruments should be refused`);
    assert.equal(found.where, 'Sound Forge', 'the refusal should point at the Sound Forge');
    assert.match(found.message, /257/, "the refusal should name the project's own real total");
  }
);

// ---------------------------------------------------------------------------
// Item 14 (review-fixes slice C): song_ptr_lo/song_ptr_hi used to be one
// unwrapped .db line each -- nesasm truncates a long input line, so a
// project with enough small songs passed checkCapacity and then failed
// assembly with a syntax error inside music.inc. songTables now chunks them
// through dbExprBlock (main/build/songcompile.js), the same dbBlock-style
// wrapping every numeric table here already uses, at 16 entries per line.
//
// Measured, not guessed: a single nesasm .db line built the same way this
// project's own song_ptr_lo is (LOW(songN_channel) expressions, real
// generated label lengths) assembles cleanly up to 1553 characters and fails
// with a syntax error at 1555 -- see the binary search behind this comment
// for the exact method. dbExprBlock's own 16-per-line chunking keeps every
// emitted line under roughly 360 characters even at song index 23 (the
// longest label, "triangle" being the longest channel name) -- comfortably
// under a third of the real limit, not merely under it.
// ---------------------------------------------------------------------------

test(
  'a project with 24 small songs builds cleanly, and no emitted line in music.inc is anywhere near nesasm\'s real line-length limit',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-manysongs-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE);
    // 24 blank songs on top of whatever the sample already carries -- the
    // exact shape item 14's own report reproduced the bug with (song_ptr_lo/
    // hi have 4 entries per song, so 24+ songs is comfortably past the old
    // unwrapped line's real breaking point, measured above).
    for (let i = 0; i < 24; i++) project.songs.push(createSong(`Song ${i}`));

    const { problems } = checkCapacity(project);
    assert.deepEqual(
      problems.filter((p) => p.severity === 'error'),
      [],
      'checkCapacity should report zero errors for 24 small songs'
    );

    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'a project with 24 small songs should build cleanly');

    const inc = await fs.promises.readFile(path.join(dir, 'build/assets/music.inc'), 'utf8');
    const longest = inc.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
    assert.ok(
      longest < 500,
      `the longest line in music.inc is ${longest} characters -- expected well under nesasm's real ~1553-1555 ` +
        'character limit (measured directly, see the section comment above), not just barely under it'
    );
  }
);

// ---------------------------------------------------------------------------
// Review-fixes slice C round 2, finding 1: music_play (engine/music.asm)
// forms `song index * 4` in a single 8-bit accumulator to index
// song_ptr_lo/hi with Y, so an index at or past 64 wraps (64*4=256=0 mod
// 256) and silently plays a lower-numbered song's own pointers instead --
// reachable, since songs otherwise had no ceiling below NO_SONG (255).
// LIMITS.songs = 64 (shared/project.js) is the real ceiling, enforced by
// validateProject and, defense in depth, checkCapacity too.
// ---------------------------------------------------------------------------

test(
  `exactly LIMITS.songs (${LIMITS.songs}) songs validate and build; LIMITS.songs + 1 is refused by both validateProject and checkCapacity`,
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-songcap-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE);
    for (let i = project.songs.length; i < LIMITS.songs; i++) project.songs.push(createSong(`Song ${i}`));
    assert.equal(project.songs.length, LIMITS.songs);

    const isSongCapError = (p) => p.severity === 'error' && /driver can only address/.test(p.message);

    assert.deepEqual(
      validateProject(project).filter(isSongCapError),
      [],
      `exactly LIMITS.songs (${LIMITS.songs}) songs must not be refused by validateProject`
    );
    assert.deepEqual(
      checkCapacity(project).problems.filter(isSongCapError),
      [],
      `exactly LIMITS.songs (${LIMITS.songs}) songs must not be refused by checkCapacity`
    );

    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, `a project with exactly LIMITS.songs (${LIMITS.songs}) songs should build cleanly`);

    // One more: refused by both, before nesasm is ever asked.
    const over = structuredClone(project);
    over.songs.push(createSong('One too many'));
    assert.equal(over.songs.length, LIMITS.songs + 1);

    const foundValidation = validateProject(over).find(isSongCapError);
    assert.ok(foundValidation, `${LIMITS.songs + 1} songs should be refused by validateProject`);
    assert.equal(foundValidation.where, 'Sound Forge');

    const foundCapacity = checkCapacity(over).problems.find(isSongCapError);
    assert.ok(foundCapacity, `${LIMITS.songs + 1} songs should be refused by checkCapacity`);
    assert.equal(foundCapacity.where, 'Sound Forge');
  }
);

// ---------------------------------------------------------------------------
// Review-fixes slice C round 2, finding 2: musicSize (main/build/generate.js)
// used to charge a flat 32 bytes for every instrument's own envelope
// regardless of its real length (up to 16 steps each), while songTables
// emits the full envelope. A project with enough large envelopes could pass
// checkCapacity and then overflow the $E000 bank for real -- musicSize now
// measures songTableBytes (main/build/songcompile.js), the same code path
// songTables itself uses to emit the .inc text, so the two cannot drift.
// ---------------------------------------------------------------------------

/** 8 instruments, each with a real 16-step envelope -- the reviewer's own shape. */
function bigSong(index) {
  const instruments = Array.from({ length: 8 }, (_, i) => ({
    duty: i % 4,
    volEnv: Array.from({ length: 16 }, (_, step) => (step + i) % 16),
    sustain: 15
  }));
  const channels = { pulse1: [], pulse2: [] };
  for (let row = 0; row < 32; row++) {
    // A distinct note (and instrument) every row, on two channels, so
    // compileSong cannot sustain a note across rows and merge them into one
    // shorter event -- every row is its own 2-byte event, the worst case
    // for stream length as well as instrument-select churn.
    channels.pulse1[row] = { note: (row * 3 + index) % 96, inst: row % 8 };
    channels.pulse2[row] = { note: (row * 5 + index + 1) % 96, inst: (row + 1) % 8 };
  }
  return {
    name: `Big ${index}`,
    tempo: { framesPerRow: 6 },
    instruments,
    patterns: [{ id: 0, rows: 32, channels }],
    order: [0],
    loop: 0
  };
}

test(
  "checkCapacity refuses the reviewer's 32-song/8-instrument/16-step-envelope/32-row shape with a named error",
  () => {
    const project = createProject('Reviewer overflow shape');
    project.songs = Array.from({ length: 32 }, (_, index) => bigSong(index));
    // 32 x 8 = 256 instruments exactly -- at, not over, MAX_TOTAL_INSTRUMENTS
    // (item 12's own separate cap), so this exercises the music/sfx/text
    // bank-size refusal specifically, not the instrument-count one.
    assert.equal(totalInstrumentCountForTest(project.songs), MAX_TOTAL_INSTRUMENTS);

    const { problems } = checkCapacity(project);
    const found = problems.find(
      (p) => p.severity === 'error' && /music/i.test(p.message) && /music and text bank/.test(p.message)
    );
    assert.ok(
      found,
      'checkCapacity should refuse this project with a named music-bank-overflow error, but got: ' +
        JSON.stringify(problems.filter((p) => p.severity === 'error'))
    );
    assert.equal(found.where, 'Sound Forge');
  }
);

/** Mirrors totalInstrumentCount's own SILENT-fallback shape (main/build/generate.js), for the assertion above only. */
function totalInstrumentCountForTest(songs) {
  return songs.reduce((total, song) => total + song.instruments.length, 0);
}

/**
 * The same 8-instrument/16-step-envelope shape as bigSong above, but with a
 * single note total per song rather than a 32-row pattern changing notes on
 * two channels -- stream bytes stay near-minimal, so the project's real
 * size is dominated by envelope bytes specifically, not by note-stream
 * length. This is what actually isolates finding 2's own defect: verified
 * by sabotage, bigSong's own 32-song construction above is refused by
 * checkCapacity under BOTH the fixed musicSize and the old flat-32-byte
 * formula it replaced (its note-stream bytes alone already exceed the
 * bank), so it proves the fixed behavior is correct without proving the old
 * behavior was wrong. This construction does: 40 of them are refused under
 * the fix (8112 real music bytes) and silently accepted under the old flat
 * formula (which would have reported roughly a quarter of that).
 */
function bigEnvelopeMinimalNoteSong(index) {
  const instruments = Array.from({ length: 8 }, (_, i) => ({
    duty: i % 4,
    volEnv: Array.from({ length: 16 }, (_, step) => (step + i) % 16),
    sustain: 15
  }));
  return {
    name: `Env ${index}`,
    tempo: { framesPerRow: 6 },
    instruments,
    patterns: [{ id: 0, rows: 1, channels: { pulse1: [{ note: 40, inst: 0 }] } }],
    order: [0],
    loop: 0
  };
}

test(
  '40 songs whose size is dominated by real envelope bytes, not note-stream length, are refused by checkCapacity -- the shape that actually isolates the old flat-envelope-charge bug',
  () => {
    const project = createProject('Envelope-dominated overflow shape');
    project.songs = Array.from({ length: 40 }, (_, index) => bigEnvelopeMinimalNoteSong(index));
    assert.ok(project.songs.length <= LIMITS.songs, 'stay under the unrelated song-count cap (finding 1)');

    const { problems } = checkCapacity(project);
    const found = problems.find(
      (p) => p.severity === 'error' && /music/i.test(p.message) && /music and text bank/.test(p.message)
    );
    assert.ok(
      found,
      'checkCapacity should refuse this envelope-dominated project with a named music-bank-overflow error, ' +
        'but got: ' + JSON.stringify(problems.filter((p) => p.severity === 'error'))
    );
    assert.equal(found.where, 'Sound Forge');

    // musicSize is private to generate.js -- not exported -- so this reads
    // the exact figure it reports back out of the refusal message itself
    // ("... compile to N bytes (M music, ...)") and checks it against
    // songTableBytes computed independently, closing the one gap the
    // sabotage check found: a musicSize that stopped delegating to
    // songTableBytes (drifted back to its own guess) would not be caught by
    // the "must be refused" assertion above alone, since a large enough
    // guess still refuses -- only comparing the reported NUMBER catches
    // that the two have drifted apart.
    const reportedMusicBytes = Number(found.message.match(/\((\d+) music,/)?.[1]);
    assert.ok(Number.isFinite(reportedMusicBytes), `could not parse the reported music byte count out of: ${found.message}`);
    assert.equal(
      reportedMusicBytes,
      songTableBytes(project.songs),
      "checkCapacity's own reported music byte count must equal songTableBytes(project.songs) exactly -- " +
        'musicSize must be delegating to it, not computing its own figure'
    );
  }
);

test(
  "a project checkCapacity accepts really assembles, and musicSize's reported bytes match nesasm's own placement exactly",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-bytecount-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE);
    // Two more songs with real, differently-sized envelopes (not the
    // trivial one-step default), so this exercises the same "sum the real
    // envelope lengths" code path the reviewer's overflow shape does, just
    // at a size that still fits.
    project.songs.push({
      name: 'Extra A',
      tempo: { framesPerRow: 6 },
      instruments: [
        { duty: 1, volEnv: [15, 12, 9, 6, 3, 0], sustain: 5 },
        { duty: 2, volEnv: Array.from({ length: 16 }, (_, i) => 15 - i), sustain: 15 }
      ],
      patterns: [{ id: 0, rows: 8, channels: { pulse1: [{ note: 40, inst: 0 }, null, { note: 44, inst: 1 }, null, null, null, null, null] } }],
      order: [0],
      loop: 0
    });
    project.songs.push({
      name: 'Extra B',
      tempo: { framesPerRow: 6 },
      instruments: [{ duty: 0, volEnv: [15, 10, 5, 0], sustain: 3 }],
      patterns: [{ id: 0, rows: 4, channels: { noise: [{ note: 5, inst: 0 }, null, { note: 8, inst: 0 }, null] } }],
      order: [0],
      loop: 0
    });

    const { problems, capacity } = checkCapacity(project);
    assert.deepEqual(problems.filter((p) => p.severity === 'error'), [], 'this project should be accepted');
    void capacity;

    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'an accepted project should really assemble');
    assert.ok(built.symbolPath, 'nesasm should have written a symbol file');
    const symbols = await fs.promises.readFile(built.symbolPath, 'utf8');
    const addr = (label) => {
      const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
      assert.ok(m, `label ${label} not found in game.fns`);
      return parseInt(m[1], 16);
    };
    // period_lo is songTables' own first emitted label; sfx_ptr_table_lo is
    // sfxTables' own first (always emitted, even for zero effects -- see its
    // own comment). assets/music.inc is songTables(...) + sfxTables(...)
    // concatenated with nothing between them (main/build/generate.js), so
    // the address span between the two is the real, measured music byte
    // count nesasm actually placed -- exactly what musicSize claims.
    const realMusicBytes = addr('sfx_ptr_table_lo') - addr('period_lo');
    assert.equal(
      songTableBytes(project.songs),
      realMusicBytes,
      "musicSize (== songTableBytes) must equal nesasm's own real placement, to the byte"
    );
  }
);

// ---------------------------------------------------------------------------
// The golden test: the ROM's driver and the preview replayer must produce
// identical APU writes, or what you hear in the Sound Forge is a lie.
// ---------------------------------------------------------------------------

const APU_LOW = 0x4000;
const APU_HIGH = 0x400f;

/**
 * Run the ROM, collecting the APU writes each frame makes, and every write
 * anywhere in the run to cur_song, each as `{ frame, value }` in the order
 * they actually happened.
 *
 * cur_song is read at write-time (through cpu.write, which is what every STA
 * to RAM goes through — see renderer/emulator/core/cpu.js), not sampled once
 * at each frame boundary: boot writes it three times while it settles, and
 * not all on the same emitted frame. On the current ROM, frame 1 is
 * boot_clear zeroing it along with the rest of WRAM; frame 2 is
 * init_session's music_stop setting it to NO_SONG immediately followed, in
 * the same frame, by apply_map_music's music_play storing the real decision;
 * frame 3 is main_loop's first jsr music_tick, giving every channel its
 * initial period. A once-per-frame sample cannot tell frame 1's boot_clear
 * zero (song 0's own index) apart from frame 2's real decision landing on the
 * same value; watching every write in order can, and it is also what lets a
 * caller downstream tell the boot-settling burst apart from a write that has
 * no business happening once the song is already playing.
 */
function recordRomActivity(frames, romPath = ROM_PATH) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));

  const writesPerFrame = [];
  let current = [];
  const originalMmapWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address >= APU_LOW && address <= APU_HIGH) current.push([address, value & 0xff]);
    return originalMmapWrite(address, value);
  };

  let frame = -1;
  const songWrites = [];
  const originalCpuWrite = nes.cpu.write.bind(nes.cpu);
  nes.cpu.write = (address, value) => {
    if (address === CUR_SONG) songWrites.push({ frame, value: value & 0xff });
    return originalCpuWrite(address, value);
  };

  for (let i = 0; i < frames; i++) {
    frame = i;
    current = [];
    nes.frame();
    writesPerFrame.push(current);
  }
  return { writesPerFrame, songWrites };
}

test('the ROM driver and the preview replayer agree', { skip: !hasRom && 'run `npm run sample` first' }, async () => {
  const project = await loadProject(SAMPLE);
  assert.ok(project.songs.length, 'the sample project should contain a song');

  const compiled = compileSong(project.songs[0]);
  const replayer = new Replayer(compiled);

  const { writesPerFrame, songWrites } = recordRomActivity(200);

  // Real ticking begins on the first frame that gives a channel a period —
  // $4002 (pulse 1) or $400a (triangle) — which only music_apply's own
  // note-start code ever writes. music_stop's silence stamp, part of boot's
  // own settling (init_session calls it too), never touches either register,
  // so it cannot be mistaken for a note and this is not the same proxy the
  // old $4002-only alignment was: it is used below only to draw the boundary
  // of boot's legitimate settling burst, never as the comparison anchor
  // itself, so a driver that started ticking late still has its silence
  // compared frame for frame rather than skipped past.
  const tickStart = writesPerFrame.findIndex((writes) =>
    writes.some(([address]) => address === 0x4002 || address === 0x400a)
  );
  assert.ok(tickStart >= 0, 'the ROM never gave a channel a period — is the song playing?');

  // Everything cur_song legitimately does happens before that first tick:
  // music_play must run, and run to completion, before music_tick can ever
  // produce output, because mus_enabled only becomes true inside music_play
  // itself. The *last* write before tickStart is therefore the real boot
  // decision, regardless of how many times boot touched cur_song settling
  // into it.
  const settling = songWrites.filter((entry) => entry.frame < tickStart);
  assert.ok(settling.length > 0, 'cur_song was never written before the song started ticking');
  const decision = settling[settling.length - 1];
  assert.equal(decision.value, 0, 'cur_song never settled on song 0 before the song started ticking');

  // Nothing in this project changes map or runs a Play music command, so
  // once the real song has started, cur_song must never be written again.
  // Anchoring on the *last* write anywhere in the whole run — rather than the
  // last one before ticking starts — would silently re-sync to a later,
  // unwanted restart instead of catching it: comparing from one frame past
  // that spurious write would find a fresh replayer and a freshly-restarted
  // ROM agreeing from tick 0, discarding the restart along with everything
  // that led up to it. So a write at or after tickStart fails the test by
  // name instead.
  const restart = songWrites.find((entry) => entry.frame >= tickStart);
  assert.equal(
    restart,
    undefined,
    `cur_song was written again on frame ${restart?.frame} (value ${restart?.value}) after the song had ` +
      'already started ticking on frame ' +
      `${tickStart} — an unintended restart, since nothing in this project changes map or runs Play music`
  );

  // One frame *past* the decision, not the decision's own frame: music_play
  // only sets up the channels (pointers, durations, cur_song) — it writes no
  // APU register itself. The first real tick is main_loop's own next
  // jsr music_tick, which cannot run before that main_loop iteration's
  // jsr wait_vblank yields to the next frame boundary, so it lands one frame
  // later than the decision every time a song starts, whether from boot or
  // from a mid-game redraw.
  const start = decision.frame + 1;

  const compare = 150;
  for (let i = 0; i < compare; i++) {
    const expected = replayer.tick();
    const actual = writesPerFrame[start + i];
    assert.deepEqual(
      actual,
      expected,
      `APU writes differ on frame ${i} (ROM frame ${start + i}):\n` +
        `  ROM:      ${JSON.stringify(actual)}\n` +
        `  replayer: ${JSON.stringify(expected)}`
    );
  }
});

// Item 12 (review-fixes slice C): every song's own instruments now reach the ROM, not just song
// 0's -- songTables (main/build/songcompile.js) concatenates them in song order and the driver
// (engine/music.asm) looks up a per-song BASE. The test above is this claim's own mirror control:
// it is unchanged, still exercises song 0 (whose base is trivially zero either way), and still
// passes. This is the one that can actually fail if the per-song BASE is wrong: a second song,
// its own instrument 0 given a duty and envelope distinct from the sample's own song 0, set as the
// start map's song -- the ROM driver and the preview replayer must still agree frame-for-frame.
test(
  'a second song -- not song 0 -- still gets its own real instrument in the ROM, frame-for-frame against the replayer',
  { skip: !hasRom && 'run `npm run sample` first' },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-song2-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE);
    assert.ok(project.songs.length, 'the sample project should contain a song');
    // Boot straight into gameplay -- nothing here is about the title screen, and the sample's own
    // title map would otherwise decide (and settle cur_song on) ITS OWN song first, before the
    // start map's choice is ever reached.
    project.project.titleMap = null;

    // Same notes as song 0 (structuredClone of it), but a distinct instrument 0 -- duty and
    // envelope both different from the sample's own -- so a driver that mis-resolved this song's
    // own $F0-$F7 select against song 0's base (or against the wrong absolute slot entirely)
    // would produce APU writes the replayer's own correct resolution does not match.
    const second = structuredClone(project.songs[0]);
    second.name = 'Second';
    second.instruments = [{ duty: (project.songs[0].instruments?.[0]?.duty ?? 0) === 1 ? 3 : 1, volEnv: [10, 6, 2, 0], sustain: 1 }];
    const SONG_B = project.songs.length;
    project.songs.push(second);
    project.maps[0].songId = SONG_B;

    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });

    const compiled = compileSong(project.songs[SONG_B]);
    const replayer = new Replayer(compiled);

    const { writesPerFrame, songWrites } = recordRomActivity(200, built.romPath);

    const tickStart = writesPerFrame.findIndex((writes) =>
      writes.some(([address]) => address === 0x4002 || address === 0x400a)
    );
    assert.ok(tickStart >= 0, 'the ROM never gave a channel a period -- is the song playing?');

    const settling = songWrites.filter((entry) => entry.frame < tickStart);
    assert.ok(settling.length > 0, 'cur_song was never written before the song started ticking');
    const decision = settling[settling.length - 1];
    assert.equal(decision.value, SONG_B, `cur_song never settled on song ${SONG_B} before the song started ticking`);

    const restart = songWrites.find((entry) => entry.frame >= tickStart);
    assert.equal(
      restart,
      undefined,
      `cur_song was written again on frame ${restart?.frame} (value ${restart?.value}) after the song had ` +
        'already started ticking'
    );

    const start = decision.frame + 1;
    const compare = 150;
    for (let i = 0; i < compare; i++) {
      const expected = replayer.tick();
      const actual = writesPerFrame[start + i];
      assert.deepEqual(
        actual,
        expected,
        `APU writes differ on frame ${i} (ROM frame ${start + i}):\n` +
          `  ROM:      ${JSON.stringify(actual)}\n` +
          `  replayer: ${JSON.stringify(expected)}`
      );
    }
  }
);

test('the song actually plays notes, not just silence', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const { writesPerFrame } = recordRomActivity(200);
  const all = writesPerFrame.flat();
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

// ---------------------------------------------------------------------------
// The map decides the music -- see engine/music.asm's apply_map_music and
// set_music, and CLAUDE.md's "the music follows the map" section.
// ---------------------------------------------------------------------------

const RIGHT = 7; // engine/constants.asm's BTN_RIGHT bit position, as nes.buttonDown indexes it

function bootHeadless(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  // sample now has hero naming on (docs/design-name-entry.md v16.4 §17 item
  // 5); a titleless build cold-boots into the grid, and finishNamingIfOpen
  // is a no-op when naming is off, so this is safe unconditionally.
  finishNamingIfOpen(nes);
  return nes;
}

const hold = (nes, button, frames) => {
  nes.buttonDown(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
  nes.buttonUp(1, button);
  nes.frame();
};

/** Walk right one step at a time until `done` is true, or give up. */
function walkRightUntil(nes, done, limit = 200) {
  for (let step = 0; step < limit && !done(); step++) hold(nes, RIGHT, 1);
  return done();
}

test('the map decides its song on arrival, and a screen edge inside it does not restart', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.project.titleMap = null; // boot straight into gameplay -- nothing
                                    // here is about the title screen
  const SONG_A = 0;
  const SONG_B = project.songs.length;
  project.songs.push(structuredClone(project.songs[0]));
  project.maps[0].songId = SONG_A;

  // A wall-free 2x2 world (the sample already has one) plus a second map with
  // a different song, reached by touching a door on the screen the player
  // crosses onto.
  for (const screen of project.maps[0].screens) screen.metatiles = screen.metatiles.map(() => 0);
  const second = createMap(project.maps.length, 'Elsewhere');
  const secondMapIndex = project.maps.length; // the sample already has a title map at 1
  second.tilesetId = project.maps[0].tilesetId;
  second.songId = SONG_B;
  project.maps.push(second);
  const { mapBase } = flattenScreens(project);
  const targetFlat = mapBase[secondMapIndex];

  const doorId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: doorId, name: 'Door', behavior: 'npc' });
  // cross_right lands the player at x = 0 with y unchanged, so a door at
  // x = 8 is touched the moment the crossing settles.
  project.maps[0].screens[1].entities.push({
    actorId: doorId,
    x: 8,
    y: 112,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: targetFlat, x: 112, y: 112 }] }] }
    }
  });

  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = bootHeadless(built.romPath);

  assert.equal(nes.cpu.mem[FLAT_SCREEN], 0);
  assert.equal(nes.cpu.mem[CUR_MAP], 0, 'boot should have decided the start map');
  assert.equal(nes.cpu.mem[CUR_SONG], SONG_A, "the start map's own song should be sounding");

  // A screen edge, still inside map 0: the shadow must not move, which is
  // what stops the song from restarting.
  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[FLAT_SCREEN] === 1),
    'the player never crossed onto the next screen'
  );
  assert.equal(nes.cpu.mem[CUR_MAP], 0, 'still the same map after a screen edge');
  assert.equal(nes.cpu.mem[CUR_SONG], SONG_A, 'a screen edge inside one map must not restart its song');

  // The door on this screen is a genuine map change: the new map's own song
  // takes over.
  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[CUR_MAP] === secondMapIndex),
    'the door never took the player to the second map'
  );
  assert.equal(nes.cpu.mem[FLAT_SCREEN], targetFlat);
  assert.equal(nes.cpu.mem[CUR_SONG], SONG_B, "the second map's own song should have taken over");
});

test('a Play music command survives a screen edge but not a map change', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-override-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.project.titleMap = null;
  const SONG_MAP = 0;
  const SONG_OVERRIDE = project.songs.length;
  project.songs.push(structuredClone(project.songs[0]));
  const SONG_ELSEWHERE = project.songs.length;
  project.songs.push(structuredClone(project.songs[0]));
  project.maps[0].songId = SONG_MAP;

  for (const screen of project.maps[0].screens) screen.metatiles = screen.metatiles.map(() => 0);
  const second = createMap(project.maps.length, 'Elsewhere');
  const secondMapIndex = project.maps.length; // the sample already has a title map at 1
  second.tilesetId = project.maps[0].tilesetId;
  second.songId = SONG_ELSEWHERE;
  project.maps.push(second);
  const { mapBase } = flattenScreens(project);
  const targetFlat = mapBase[secondMapIndex];

  const jukeboxId = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id: jukeboxId,
    name: 'Jukebox',
    behavior: 'npc'
  });
  // Well short of the screen edge, so the override is in effect before the
  // crossing rather than raced against it.
  project.maps[0].screens[0].entities.push({
    actorId: jukeboxId,
    x: 152,
    y: 112,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'music', song: SONG_OVERRIDE }] }] }
    }
  });
  const doorId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: doorId, name: 'Door', behavior: 'npc' });
  project.maps[0].screens[1].entities.push({
    actorId: doorId,
    x: 8,
    y: 112,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: targetFlat, x: 112, y: 112 }] }] }
    }
  });

  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = bootHeadless(built.romPath);

  assert.equal(nes.cpu.mem[CUR_SONG], SONG_MAP);

  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[CUR_SONG] === SONG_OVERRIDE),
    'touching the jukebox never changed the song'
  );
  assert.equal(nes.cpu.mem[CUR_MAP], 0, 'still the same map after the override');

  // Cross the edge the override was issued on: the map must not reassert its
  // own song over it -- this is the regression that proves an event's choice
  // outlives a redraw within its own map.
  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[FLAT_SCREEN] === 1),
    'the player never crossed onto the next screen'
  );
  assert.equal(
    nes.cpu.mem[CUR_SONG],
    SONG_OVERRIDE,
    "a screen edge inside the map must not reassert the map's own song over an event's choice"
  );

  // A different map, though, takes over regardless of what an event chose.
  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[CUR_MAP] === secondMapIndex),
    'the door never took the player to the second map'
  );
  assert.equal(nes.cpu.mem[CUR_SONG], SONG_ELSEWHERE, "a different map's own song should override the event's choice");
});

test('a game over into a Silence map actually silences the APU, not just cur_song', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // cur_song is bookkeeping, not the hardware. It is possible for it to read
  // NO_SONG while a song from the previous session is still audible -- which
  // is exactly the shape init_session's own bug took, so this asserts the APU
  // itself (mus_enabled, and that no further note ever starts), not the
  // shadow the earlier version of this fix trusted too far.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-silence-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  assert.ok(project.project.titleMap !== null, 'the sample should carry a title to come back to');
  project.maps[project.project.titleMap].songId = null; // the title goes quiet

  // Something lethal right next to the start, so dying does not take a
  // journey -- the same fixture title.test.js's restart test uses.
  const doomId = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id: doomId,
    name: 'Doom',
    behavior: 'npc',
    hp: 1,
    damage: 6
  });
  project.maps[0].screens[0].entities.push({ actorId: doomId, x: 152, y: 112, props: {} });

  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = bootHeadless(built.romPath);

  const START = 3;
  const GAME_STATE = 0x25;
  const ST_GAMEPLAY = 0;
  const ST_TITLE = 3;
  const MUS_ENABLED = 0x2d; // engine/constants.asm

  const tap = (button, frames = 12) => {
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
    for (let i = 0; i < frames; i++) nes.frame();
  };

  tap(START); // title into gameplay -- the start map's own real song
  finishNamingIfOpen(nes); // hero naming on (phase 5): Start opens the grid
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  assert.equal(nes.cpu.mem[MUS_ENABLED], 1, 'the start map should have started a real song');

  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  assert.notEqual(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'never died');

  for (let i = 0; i < 600 && nes.cpu.mem[GAME_STATE] !== ST_TITLE; i++) tap(START, 8);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'a game over should lead back to the title');

  // The title map is Silence: not "cur_song says NO_SONG" but genuinely no
  // sound. mus_enabled gates music_tick entirely, so 0 means the driver
  // cannot write to the APU again even on the next frame it runs.
  assert.equal(nes.cpu.mem[MUS_ENABLED], 0, "restarting into a Silence map should have stopped the previous run's song");

  let periodWrites = 0;
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address === 0x4002 || address === 0x400a) periodWrites++;
    return originalWrite(address, value);
  };
  for (let i = 0; i < 30; i++) nes.frame();
  assert.equal(periodWrites, 0, 'a note started after the restart -- the old song was never actually stopped');
});
