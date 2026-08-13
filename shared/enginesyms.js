// The engine's own names, read back out of the assembly that defines them.
//
// `engine/constants.asm` is the single allocation map for zero page and the
// $0300+ arrays, and the tooling occasionally has to know where one of those
// bytes lives — the test-play override pokes the engine's warp bytes to put the
// player somewhere other than the start. Copying an address into JavaScript
// would make constants.asm one of two writers of it, and moving a zero-page
// byte is exactly the change that would leave the copy pointing at somebody
// else's byte with nothing to say so. So the addresses are parsed out of the
// file instead — and the caller reads that file out of `build/`, which is the
// copy that assembled the ROM in hand, Code Forge override and all.
//
// Only plain `name = $HH` and `name = 12` lines are understood. A line with an
// expression in it is skipped rather than guessed at: no answer is a problem
// every caller already has to handle, and a wrong one is a poke into the middle
// of something unrelated.

const EQUATE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\$[0-9A-Fa-f]+|\d+)\s*(?:;.*)?$/;

/**
 * Every constant an assembly source defines, as `{ name: number }`.
 * @param {string} text the contents of a nesasm source file
 */
export function parseEquates(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = EQUATE.exec(line);
    if (!match) continue;
    const [, name, value] = match;
    out[name] = value.startsWith('$') ? parseInt(value.slice(1), 16) : Number(value);
  }
  return out;
}

/**
 * The names out of `list` that `equates` does not define, so a caller can say
 * which one is missing rather than poking `undefined`.
 */
export function missingEquates(equates, list) {
  return list.filter((name) => typeof equates?.[name] !== 'number');
}
