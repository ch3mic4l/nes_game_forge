// Starter song: a short title-screen fanfare. One pattern, ascending, with
// no melodic repeat inside it -- and short enough (48 frames) to stay well
// under the 255-frame ceiling a Sting command imposes, so this entry is
// usable as a Sting as well as ordinary music (design-starter-library.md
// §8.1). Modelled on tools/make-sample.js's own "Greenwood" song literal.
const ROWS = 8;
const emptyChannel = () => new Array(ROWS).fill(null);
const place = (channel, entries, inst) => {
  for (const [row, note] of entries) channel[row] = { note, inst };
  return channel;
};

export default {
  kind: 'song',
  name: 'Title Jingle',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  song: {
    name: 'Title Jingle',
    tempo: { framesPerRow: 6 },
    instruments: [{ id: 0, name: 'Lead', duty: 2, volEnv: [15, 12, 9, 6], sustain: 3 }],
    patterns: [
      {
        id: 0,
        rows: ROWS,
        channels: {
          pulse1: place(emptyChannel(), [[0, 48], [2, 52], [4, 55], [6, 59]], 0),
          pulse2: emptyChannel(),
          triangle: emptyChannel(),
          noise: emptyChannel()
        }
      }
    ],
    order: [0],
    loop: 0
  }
};
