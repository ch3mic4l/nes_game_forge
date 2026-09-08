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
  songTimeline,
  normalizeSfx
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

/**
 * The dbBlock-style chunking above, but for a list of nesasm expressions
 * (LOW(x)/HIGH(x)) rather than numeric bytes -- those cannot go through
 * dbBlock's own hex() map, so song_ptr_lo/song_ptr_hi chunk here instead.
 * Item 14: with every song's pointer pair on one unwrapped .db line, nesasm
 * truncates the line past its own input-line limit once a project has enough
 * songs, which passed checkCapacity and then failed assembly with a syntax
 * error inside music.inc. perLine matches dbBlock's own default so both
 * tables read the same width in the generated file.
 */
function dbExprBlock(exprs, perLine = 16) {
  const lines = [];
  for (let i = 0; i < exprs.length; i += perLine) {
    lines.push(`  .db ${exprs.slice(i, i + perLine).join(',')}`);
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
 *
 * Item 12: every song's own instruments are concatenated, in song order, into
 * the one flat set of inst_* tables -- not just song 0's, which the schema,
 * the editor and the preview all already treat as one instrument set per
 * song. song_inst_base carries one byte per song, the offset of that song's
 * own first instrument in the flat tables; the driver ($F0-$F7 in
 * engine/music.asm) adds it onto the stream's own local 0-7 select to reach
 * the right absolute slot. A song with no instruments (only possible for the
 * project-wide SILENT fallback below -- normalizeSong always leaves a real
 * song with at least one) gets SILENT's own single entry, and the base still
 * advances past it.
 */
export function songTables(songs) {
  const compiled = songs.length ? songs.map((song) => compileSong(song)) : [SILENT];

  const instrumentBases = [];
  const instruments = [];
  for (const song of compiled) {
    instrumentBases.push(instruments.length);
    const list = song.instruments.length ? song.instruments : SILENT.instruments;
    instruments.push(...list);
  }

  const chunks = [
    '; Generated -- note periods, instruments and song streams.',
    `period_lo:\n${dbBlock(PERIOD_TABLE.map((period) => period & 0xff))}`,
    `period_hi:\n${dbBlock(PERIOD_TABLE.map((period) => (period >> 8) & 0x07))}`,
    `inst_duty:\n${dbBlock(instruments.map((entry) => entry.duty & 3))}`,
    `inst_env_len:\n${dbBlock(instruments.map((entry) => entry.volEnv.length))}`,
    `inst_sustain:\n${dbBlock(
      instruments.map((entry) => Math.min(entry.sustain ?? entry.volEnv.length - 1, entry.volEnv.length - 1))
    )}`,
    `inst_env_lo:\n${dbExprBlock(instruments.map((_, index) => `LOW(inst_env_${index})`))}`,
    `inst_env_hi:\n${dbExprBlock(instruments.map((_, index) => `HIGH(inst_env_${index})`))}`,
    `song_inst_base:\n${dbBlock(instrumentBases)}`,
    ...instruments.map((entry, index) => `inst_env_${index}:\n${dbBlock(entry.volEnv.map((value) => value & 15))}`)
  ];

  const label = (songIndex, channelId) => `song${songIndex}_${channelId}`;
  chunks.push(
    `song_ptr_lo:\n${dbExprBlock(
      compiled.flatMap((song, index) => song.channels.map((channel) => `LOW(${label(index, channel.id)})`))
    )}`
  );
  chunks.push(
    `song_ptr_hi:\n${dbExprBlock(
      compiled.flatMap((song, index) => song.channels.map((channel) => `HIGH(${label(index, channel.id)})`))
    )}`
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

/**
 * Total bytes songTables' own emitted text will occupy in the ROM -- review-
 * fixes slice C round 2, finding 2: musicSize (main/build/generate.js) used
 * to charge a flat, hand-guessed 32 bytes for every instrument's own
 * envelope regardless of its real length, so a project whose envelopes were
 * genuinely large (16 steps, several instruments, several songs) could pass
 * checkCapacity and then overflow the assembled bank for real. This measures
 * songTables' own output directly instead -- the identical "count what the
 * generator actually emits" discipline battleTableBytes (main/build/
 * battletables.js) already holds battleTables to, so musicSize and
 * songTables cannot drift apart the way the flat guess could.
 *
 * Walks every non-blank, non-label, non-equate line of songTables' output:
 * `.db` is one byte per comma-separated operand, `.dw` is two (the loop
 * pointer each channel stream ends with). Throws on anything else -- an
 * unrecognized directive here means this function is undercounting, not
 * that it is safe to skip, the identical fail-loud shape emittedBytes
 * already holds itself to.
 */
export function songTableBytes(songs) {
  const source = songTables(songs);
  let bytes = 0;
  for (const [index, raw] of source.split('\n').entries()) {
    const text = raw
      .replace(/;.*$/, '')
      .trim()
      .replace(/^[A-Za-z_][A-Za-z0-9_]*:\s*/, '');
    if (!text) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text)) continue; // an equate stores nothing
    if (/^\.db\b/i.test(text)) {
      const operands = text.slice(3).trim();
      if (!operands) throw new Error(`internal: songTables emitted a .db with no operands on line ${index + 1}`);
      bytes += operands.split(',').length; // nesasm stores one byte per .db operand
      continue;
    }
    if (/^\.dw\b/i.test(text)) {
      const operands = text.slice(3).trim();
      if (!operands) throw new Error(`internal: songTables emitted a .dw with no operands on line ${index + 1}`);
      bytes += operands.split(',').length * 2; // nesasm stores two bytes per .dw operand
      continue;
    }
    throw new Error(
      `internal: songTableBytes cannot size "${text}" (line ${index + 1} of songTables' own output). ` +
        'Teach songTableBytes how many bytes this directive stores before emitting it, or musicSize will ' +
        'undercount and promise room the assembler refuses.'
    );
  }
  return bytes;
}

// ------------------------------------------------------------------- sfx

/**
 * A genuinely separate, smaller format from compileSong's -- one channel, fixed
 * volume, no instrument/envelope, no loop opcode. [volume][note-or-REST, duration]...
 * plus a defensive trailing REST,0 (see design-sfx.md §3.2). Pure; sfxSize/sfxTables
 * (main/build/generate.js) and SfxReplayer (renderer/forges/sound/) both read this
 * same output, so the ROM, the capacity meter and the preview cannot drift.
 */
export function compileSfx(rawSfx) {
  const sfx = normalizeSfx(rawSfx);
  const bytes = [sfx.volume & 0x0f];
  for (const step of sfx.steps) {
    bytes.push(step.note === null ? OP_REST : step.note, step.duration);
  }
  bytes.push(OP_REST, 0); // defensive terminator, see design-sfx.md §3.2
  return { bytes };
}

/**
 * Emit the pointer table (one 2-byte entry per effect, not per channel -- there is
 * exactly one channel, fixed at assemble time) and every effect's own compiled
 * stream. Unconditional, the same as songTables above: an authored-but-unreferenced
 * effect still compiles, mirroring songs' own existing behavior (design-sfx.md §3.10).
 * Emits both labels with zero .db bytes for an empty list -- script_op_sfx's own
 * source can reference them even when no effect is authored (a live command naming a
 * deleted effect), and nesasm needs the symbols to resolve regardless of whether that
 * path is ever reached at runtime.
 */
export function sfxTables(sfxList) {
  const list = sfxList?.length ? sfxList : [];
  const compiled = list.map((sfx) => compileSfx(sfx));
  const label = (index) => `sfx${index}`;

  // Review-fixes slice C round 2, finding 3: both pointer tables now chunk
  // through dbExprBlock the same way song_ptr_lo/hi (songTables above)
  // already do, one nesasm .db line per 16 entries -- a permitted 255-effect
  // project (LIMITS.sfx) used to emit each as one unwrapped line, long
  // enough (3,210 characters) to pass every LIMITS/checkCapacity check and
  // then fail assembly with a syntax error inside music.inc.
  const chunks = ['; Generated -- sound effect streams.'];
  chunks.push(
    compiled.length
      ? `sfx_ptr_table_lo:\n${dbExprBlock(compiled.map((_, index) => `LOW(${label(index)})`))}`
      : 'sfx_ptr_table_lo:'
  );
  chunks.push(
    compiled.length
      ? `sfx_ptr_table_hi:\n${dbExprBlock(compiled.map((_, index) => `HIGH(${label(index)})`))}`
      : 'sfx_ptr_table_hi:'
  );

  compiled.forEach((sfx, index) => {
    chunks.push(`${label(index)}:\n${dbBlock(sfx.bytes)}`);
  });

  return `${chunks.join('\n')}\n`;
}
