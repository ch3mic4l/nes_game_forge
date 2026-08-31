// The music driver specification.
//
// This module is the single definition of the compiled song format, the note
// period table and the envelope rules. The 6502 driver (engine/music.asm), the
// song compiler (main/build/songcompile.js) and the preview replayer
// (renderer/forges/sound/replayer.js) all implement exactly this, and the
// golden test in test/unit/music.test.js diffs the ROM against the replayer to
// prove they agree.

export const CPU_CLOCK = 1789773; // NTSC, Hz

export const CHANNELS = [
  { id: 'pulse1', label: 'Pulse 1', base: 0x4000, kind: 'pulse' },
  { id: 'pulse2', label: 'Pulse 2', base: 0x4004, kind: 'pulse' },
  { id: 'triangle', label: 'Triangle', base: 0x4008, kind: 'triangle' },
  { id: 'noise', label: 'Noise', base: 0x400c, kind: 'noise' }
];

export const NUM_NOTES = 96; // note 0 = C-1, so note 45 is A-4 = 440 Hz
export const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

/** Stream opcodes. A note is always followed by a duration byte. */
export const OP_REST = 0xfe;
export const OP_LOOP = 0xff;
export const OP_INSTRUMENT = 0xf0; // $F0 + n, no duration byte
export const MAX_INSTRUMENTS = 8;

/** Pulse periods are 11 bits, so anything longer than this cannot be played. */
export const MAX_PERIOD = 0x7ff;

export function noteFrequency(note) {
  return 440 * 2 ** ((note - 45) / 12);
}

export function noteName(note) {
  if (note === null || note === undefined) return '---';
  const octave = Math.floor(note / 12) + 1;
  return `${NOTE_NAMES[note % 12]}${octave}`;
}

/**
 * Period values for the pulse channels, one per note.
 *
 * The triangle's period register counts at half the rate, so playing note N on
 * the triangle means looking up N + 12 in this same table — one table serves
 * both, exactly as the 6502 driver does it.
 */
export const PERIOD_TABLE = Array.from({ length: NUM_NOTES }, (_, note) => {
  const period = Math.round(CPU_CLOCK / (16 * noteFrequency(note))) - 1;
  return Math.max(0, Math.min(MAX_PERIOD, period));
});

/** The lowest note a pulse channel can actually reach; below this it clamps. */
export const LOWEST_PULSE_NOTE = PERIOD_TABLE.findIndex((period) => period < MAX_PERIOD);

/** Noise has 16 tuned periods; higher notes pick shorter ones. */
export const noiseIndex = (note) => 15 - (note % 16);

/**
 * Volume for an envelope at a given step. Steps advance once per frame; past
 * the end of the list the envelope holds its sustain entry.
 */
export function envelopeVolume(instrument, step) {
  const envelope = instrument?.volEnv?.length ? instrument.volEnv : [15];
  if (step < envelope.length) return envelope[step] & 15;
  const sustain = Math.min(instrument?.sustain ?? envelope.length - 1, envelope.length - 1);
  return envelope[Math.max(0, sustain)] & 15;
}

export function createInstrument(id) {
  return { id, name: `Instrument ${id}`, duty: 2, volEnv: [15, 14, 12, 10, 9, 8], sustain: 5 };
}

export function createPattern(id, rows = 32) {
  const channels = {};
  for (const channel of CHANNELS) channels[channel.id] = new Array(rows).fill(null);
  return { id, rows, channels };
}

export function createSong(name = 'Song') {
  return {
    name,
    tempo: { framesPerRow: 6 },
    instruments: [createInstrument(0)],
    patterns: [createPattern(0)],
    order: [0],
    loop: 0
  };
}

/** Fill in defaults so a hand-edited or older song never crashes the UI. */
export function normalizeSong(raw, name = 'Song') {
  const base = createSong(raw?.name || name);
  if (!raw || typeof raw !== 'object') return base;

  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
  };

  const instruments = (Array.isArray(raw.instruments) && raw.instruments.length ? raw.instruments : base.instruments)
    .slice(0, MAX_INSTRUMENTS)
    .map((entry, id) => ({
      id,
      name: typeof entry?.name === 'string' && entry.name ? entry.name : `Instrument ${id}`,
      duty: clamp(entry?.duty, 0, 3, 2),
      volEnv: (Array.isArray(entry?.volEnv) && entry.volEnv.length ? entry.volEnv : [15])
        .slice(0, 16)
        .map((value) => clamp(value, 0, 15, 0)),
      sustain: clamp(entry?.sustain, 0, 15, 0)
    }));

  const patterns = (Array.isArray(raw.patterns) && raw.patterns.length ? raw.patterns : base.patterns).map(
    (entry, id) => {
      const rows = clamp(entry?.rows, 1, 64, 32);
      const pattern = createPattern(id, rows);
      for (const channel of CHANNELS) {
        const source = entry?.channels?.[channel.id];
        if (!Array.isArray(source)) continue;
        for (let row = 0; row < rows; row++) {
          const cell = source[row];
          if (!cell || cell.note === null || cell.note === undefined) continue;
          pattern.channels[channel.id][row] = {
            note: clamp(cell.note, 0, NUM_NOTES - 1, 45),
            inst: clamp(cell.inst, 0, instruments.length - 1, 0)
          };
        }
      }
      return pattern;
    }
  );

  const order = (Array.isArray(raw.order) && raw.order.length ? raw.order : [0]).map((value) =>
    clamp(value, 0, patterns.length - 1, 0)
  );

  return {
    name: base.name,
    tempo: { framesPerRow: clamp(raw.tempo?.framesPerRow, 1, 31, 6) },
    instruments,
    patterns,
    order,
    loop: clamp(raw.loop, 0, order.length - 1, 0)
  };
}

/** No song: Silence for `music`, and an unresolved/deleted reference for `sting`. */
export const NO_SONG = 0xff;

/** Resolve an authored song reference to a compiled byte, NO_SONG for anything that doesn't. */
export function songByte(songs, id) {
  if (id === null || id === undefined) return NO_SONG;
  const n = Number(id);
  return Number.isInteger(n) && n >= 0 && n < (songs?.length ?? 0) ? n : NO_SONG;
}

/**
 * Flatten the order list into a single row timeline, and note which row the loop returns to.
 * Moved from main/build/songcompile.js's own private timeline(): purely structural (song order
 * and pattern row counts, the loop index), no per-channel note/instrument data, so it has no
 * main/build dependency and can be shared by the compiler and validateProject alike. Takes an
 * ALREADY-NORMALIZED song, the same boundary compileSong's own caller always assumed --
 * songFrameLength below is the raw-song entry point every other caller should use instead.
 */
export function songTimeline(normalizedSong) {
  const rows = [];
  let loopRow = 0;
  normalizedSong.order.forEach((patternId, orderIndex) => {
    if (orderIndex === normalizedSong.loop) loopRow = rows.length;
    const pattern = normalizedSong.patterns[patternId] ?? normalizedSong.patterns[0];
    for (let row = 0; row < pattern.rows; row++) rows.push({ pattern, row });
  });
  return { rows, loopRow };
}

/**
 * A song's own duration as a Sting: one full pass through every row of song.order before the
 * first loop-back -- rows.length, not loopRow (see handoff-sting/design-sting.md §4: loopRow is
 * the loop's *target*, not the point the first loop-back happens). Normalizes its own input --
 * the single place this boundary is enforced, not duplicated at each call site -- so a direct
 * caller (the compiler, validateProject) can hand it a raw, possibly hand-edited or legacy song
 * exactly the way compileSong's own callers already can, and get the identical duration
 * compileSong itself would compute. Returns frames, uncapped; the 255-frame Sting ceiling is
 * enforced by callers, not here, so this stays a fact about the song, not a policy about Sting.
 */
export function songFrameLength(rawSong) {
  const song = normalizeSong(rawSong);
  return songTimeline(song).rows.length * song.tempo.framesPerRow;
}

/** No effect: sfx has nothing at this index -- the same role NO_SONG plays one format over. */
export const NO_SFX = 0xff;

// The step-count ceiling lives here, not in shared/project.js's LIMITS object: shared/project.js
// already imports FROM shared/audio.js (NO_SONG/songByte/songFrameLength, and now
// NO_SFX/sfxByte/sfxFrameLength/normalizeSfx too), so audio.js importing LIMITS back out of
// project.js would be the exact cycle CLAUDE.md's own single-writer discipline exists to prevent.
//
// This is an AUTHORING/product limit, not a format-addressing one, unlike NUM_NOTES/
// MAX_INSTRUMENTS/MAX_PERIOD above, which really are format/hardware ceilings (96 real notes, the
// 3-bit $F0-$F7 instrument-select range, an 11-bit APU period register). Nothing about the compiled
// stream caps step count at 8: sfx_ptr_lo/hi is a genuine 16-bit pointer, sfx_read_event has no
// fixed-size buffer to overflow, and the whole-effect duration compileSfx/script_op_sfx bake into
// the command operand is computed separately from step count (sfxFrameLength sums whatever steps
// exist). Eight is chosen purely to keep an authored effect reading as "a coin/jump/hit," not a
// melody -- SFX_MAX_STEPS is what stops the editor from offering more and what normalizeSfx
// truncates an over-cap list down to on load. See design-sfx.md §3.2.
export const SFX_MAX_STEPS = 8;

/** Resolve an authored sfx reference to a compiled byte, NO_SFX for anything that doesn't. */
export function sfxByte(sfxList, id) {
  if (id === null || id === undefined) return NO_SFX;
  const n = Number(id);
  return Number.isInteger(n) && n >= 0 && n < (sfxList?.length ?? 0) ? n : NO_SFX;
}

/** Fill in defaults so a hand-edited or older effect never crashes the UI. Truncates an over-cap
 *  steps list to SFX_MAX_STEPS -- an authoring limit with no outside reference to corrupt, the
 *  identical shape normalizeSong's own instrument-list slicing and a choice's own extra-options
 *  truncation already are, not the preserve-and-refuse shape an id space (LIMITS.sfx) needs. */
export function normalizeSfx(raw, name = 'Effect') {
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
  };

  const rawSteps = Array.isArray(raw?.steps) && raw.steps.length ? raw.steps : [{ note: null, duration: 1 }];
  const steps = rawSteps.slice(0, SFX_MAX_STEPS).map((step) => ({
    note: step?.note === null || step?.note === undefined ? null : clamp(step.note, 0, 15, 0),
    duration: clamp(step?.duration, 1, 255, 1)
  }));

  return {
    name: typeof raw?.name === 'string' && raw.name ? raw.name : name,
    volume: clamp(raw?.volume, 0, 15, 15),
    steps
  };
}

/** A raw SFX's own total length in frames -- the sum of every step's duration, uncapped; the
 *  255-frame ceiling (one countdown byte) is enforced by callers, the identical split
 *  songFrameLength already holds to. */
export function sfxFrameLength(rawSfx) {
  const sfx = normalizeSfx(rawSfx);
  return sfx.steps.reduce((total, step) => total + step.duration, 0);
}
