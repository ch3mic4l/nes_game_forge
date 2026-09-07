// Starter sfx: a two-tone buzz for an invalid action.
export default {
  kind: 'sfx',
  name: 'Error',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  sfx: {
    name: 'Error',
    volume: 13,
    steps: [
      { note: 5, duration: 4 },
      { note: 2, duration: 4 },
      { note: 5, duration: 4 },
      { note: 2, duration: 4 }
    ]
  }
};
