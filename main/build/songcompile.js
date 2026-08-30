// Compiles songs into the byte streams engine/music.asm plays.
//
// compileSong() is pure and returns the exact bytes that end up in the ROM, so
// the preview replayer can interpret the same data the 6502 driver does and the
// golden test can diff the two.

import {
  CHANNELS,
  OP_REST,
  OP_LOOP,
  OP_INSTRUMENT,
  PERIOD_TABLE,
  normalizeSong,
  songTimeline
} from '../../shared/audio.js';

const MAX_DURATION = 255;

/**
 * One channel's events. A cell starts a new event; anything after it sustains
 * until the next cell. The loop row is always forced to be an event boundary so
 * the loop target lands somewhere well defined — a note held across the loop
 * point restarts there.
 */
function channelEvents(song, channelId) {
  const { rows, loopRow } = songTimeline(song);
  const events = [];
  let current = null;
  let loopEventIndex = 0;

  const flush = () => {
    if (current) events.push(current);
    current = null;
  };

  rows.forEach((entry, index) => {
    const cell = entry.pattern.channels[channelId]?.[entry.row] ?? null;
    if (index === loopRow) {
      flush();
      loopEventIndex = events.length;
      // Keep a sustaining note audible across the loop by restarting it.
      if (!cell && current === null && events.length) {
        const previous = events[events.length - 1];
        if (previous.type === 'note') current = { type: 'note', note: previous.note, inst: previous.inst, rows: 0 };
      }
    } else if (cell) {
      flush();
    }
    if (cell) current = { type: 'note', note: cell.note, inst: cell.inst, rows: 0 };
    else if (!current) current = { type: 'rest', rows: 0 };
    current.rows++;
  });
  flush();

  return { events, loopEventIndex };
}

/**
 * @returns {{channels: Array<{id: string, bytes: number[], loopOffset: number}>}}
 */
export function compileSong(rawSong) {
  const song = normalizeSong(rawSong);
  const framesPerRow = song.tempo.framesPerRow;

  const channels = CHANNELS.map((channel) => {
    const { events, loopEventIndex } = channelEvents(song, channel.id);
    const bytes = [];
    let loopOffset = 0;
    let instrument = -1;

    events.forEach((event, index) => {
      if (index === loopEventIndex) loopOffset = bytes.length;

      if (event.type === 'note' && event.inst !== instrument) {
        instrument = event.inst;
        bytes.push(OP_INSTRUMENT | (instrument & 7));
      }

      // Durations are a single byte, so a very long note is emitted as several
      // consecutive events. It retriggers every 255 frames, which only shows up
      // on notes longer than about four seconds.
      let frames = event.rows * framesPerRow;
      const opcode = event.type === 'note' ? event.note : OP_REST;
      while (frames > 0) {
        const chunk = Math.min(frames, MAX_DURATION);
        bytes.push(opcode, chunk);
        frames -= chunk;
      }
    });

    if (!bytes.length) {
      // A completely empty channel still needs something to play.
      loopOffset = 0;
      bytes.push(OP_REST, MAX_DURATION);
    }
    return { id: channel.id, bytes, loopOffset };
  });

  return { channels, instruments: song.instruments, framesPerRow };
}

// ---------------------------------------------------------------- assembly

const hex = (value) => `$${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;

function dbBlock(values, perLine = 16) {
  const lines = [];
  for (let i = 0; i < values.length; i += perLine) {
    lines.push(`  .db ${values.slice(i, i + perLine).map(hex).join(',')}`);
  }
  return lines.join('\n');
}

/** The silent song used when a project has no music yet. */
const SILENT = {
  channels: CHANNELS.map((channel) => ({ id: channel.id, bytes: [OP_REST, MAX_DURATION], loopOffset: 0 })),
  instruments: [{ duty: 2, volEnv: [0], sustain: 0 }]
};

/**
 * Emit the period table, instrument tables and every song stream.
 * Instruments are shared across songs: the first song's set wins, which keeps
 * the driver's lookup a single flat table.
 */
export function songTables(songs) {
  const compiled = songs.length ? songs.map((song) => compileSong(song)) : [SILENT];
  const instruments = compiled[0].instruments.length ? compiled[0].instruments : SILENT.instruments;

  const chunks = [
    '; Generated -- note periods, instruments and song streams.',
    `period_lo:\n${dbBlock(PERIOD_TABLE.map((period) => period & 0xff))}`,
    `period_hi:\n${dbBlock(PERIOD_TABLE.map((period) => (period >> 8) & 0x07))}`,
    `inst_duty:\n${dbBlock(instruments.map((entry) => entry.duty & 3))}`,
    `inst_env_len:\n${dbBlock(instruments.map((entry) => entry.volEnv.length))}`,
    `inst_sustain:\n${dbBlock(
      instruments.map((entry) => Math.min(entry.sustain ?? entry.volEnv.length - 1, entry.volEnv.length - 1))
    )}`,
    `inst_env_lo:\n  .db ${instruments.map((_, index) => `LOW(inst_env_${index})`).join(',')}`,
    `inst_env_hi:\n  .db ${instruments.map((_, index) => `HIGH(inst_env_${index})`).join(',')}`,
    ...instruments.map((entry, index) => `inst_env_${index}:\n${dbBlock(entry.volEnv.map((value) => value & 15))}`)
  ];

  const label = (songIndex, channelId) => `song${songIndex}_${channelId}`;
  chunks.push(
    `song_ptr_lo:\n  .db ${compiled
      .flatMap((song, index) => song.channels.map((channel) => `LOW(${label(index, channel.id)})`))
      .join(',')}`
  );
  chunks.push(
    `song_ptr_hi:\n  .db ${compiled
      .flatMap((song, index) => song.channels.map((channel) => `HIGH(${label(index, channel.id)})`))
      .join(',')}`
  );

  compiled.forEach((song, index) => {
    for (const channel of song.channels) {
      const name = label(index, channel.id);
      const head = channel.bytes.slice(0, channel.loopOffset);
      const tail = channel.bytes.slice(channel.loopOffset);
      const body = [`${name}:`];
      if (head.length) body.push(dbBlock(head));
      body.push(`${name}_loop:`);
      body.push(dbBlock(tail));
      body.push(`  .db ${hex(OP_LOOP)}`);
      body.push(`  .dw ${name}_loop`);
      chunks.push(body.join('\n'));
    }
  });

  return `${chunks.join('\n')}\n`;
}
