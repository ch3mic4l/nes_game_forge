// Starter song: a quiet, sparse two-pattern ambient loop for exploring the
// field. Modelled on tools/make-sample.js's own "Greenwood" song literal.
const ROWS = 16;
const emptyChannel = () => new Array(ROWS).fill(null);
const place = (channel, entries, inst) => {
  for (const [row, note] of entries) channel[row] = { note, inst };
  return channel;
};

export default {
  kind: 'song',
  name: 'Ambient Loop',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  song: {
    name: 'Ambient Loop',
    tempo: { framesPerRow: 10 },
    instruments: [{ id: 0, name: 'Pad', duty: 1, volEnv: [6, 5, 4, 3], sustain: 3 }],
    patterns: [
      {
        id: 0,
        rows: ROWS,
        channels: {
          pulse1: emptyChannel(),
          pulse2: emptyChannel(),
          triangle: place(emptyChannel(), [[0, 30], [8, 33]], 0),
          noise: emptyChannel()
        }
      },
      {
        id: 1,
        rows: ROWS,
        channels: {
          pulse1: emptyChannel(),
          pulse2: emptyChannel(),
          triangle: place(emptyChannel(), [[4, 35], [12, 30]], 0),
          noise: emptyChannel()
        }
      }
    ],
    order: [0, 1],
    loop: 0
  }
};
