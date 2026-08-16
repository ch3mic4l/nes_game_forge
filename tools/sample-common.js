// Small art/screen helpers shared by tools/make-mmc1-sample.js and
// tools/make-mmc3-sample.js — the same handful of functions tools/make-sample.js
// and tools/make-rpg-sample.js each already carry their own copy of. Factored
// out for these two only, not retrofitted into the other two: sample/ and
// sample-rpg/ are what every existing engine test is written against, and
// pulling them into a shared module would put both in the blast radius of a
// change that only needs to touch the new pair.

/** Join 8 rows of 8 palette-index characters into one 64-character tile string. */
export const tile = (rows) => rows.join('');

/** Split a 16x16 grid of rows into its four 8x8 quadrant tile strings (TL, TR, BL, BR). */
export function split16(rows) {
  const out = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const originX = (quadrant % 2) * 8;
    const originY = Math.floor(quadrant / 2) * 8;
    let text = '';
    for (let y = 0; y < 8; y++) text += rows[originY + y].slice(originX, originX + 8);
    out.push(text);
  }
  return out;
}

/**
 * Turn a screen's worth of legend characters into `{ metatiles, entities: [] }`.
 * `legend` maps each character to a metatile id; an unmapped character throws
 * rather than silently becoming metatile 0, the same guard tools/make-sample.js
 * uses, because a typo in the art should fail the build, not draw the wrong tile.
 */
export function screenFromArt(rows, legend, { cols, screenRows } = {}) {
  const expectRows = screenRows ?? rows.length;
  if (rows.length !== expectRows) throw new Error(`screen needs ${expectRows} rows, got ${rows.length}`);
  const metatiles = [];
  rows.forEach((row, index) => {
    const expectCols = cols ?? row.length;
    if (row.length !== expectCols) throw new Error(`row ${index} is ${row.length} characters, expected ${expectCols}`);
    for (const character of row) {
      const id = legend[character];
      if (id === undefined) throw new Error(`unknown map character "${character}"`);
      metatiles.push(id);
    }
  });
  return { metatiles, entities: [] };
}

/** A four-tile metasprite, unrotated, from four consecutive sprite tiles. */
export const metasprite = (id, name, firstTile, palette) => ({
  id,
  name,
  tiles: [
    { x: 0, y: 0, tile: firstTile, palette, hflip: false, vflip: false },
    { x: 8, y: 0, tile: firstTile + 1, palette, hflip: false, vflip: false },
    { x: 0, y: 8, tile: firstTile + 2, palette, hflip: false, vflip: false },
    { x: 8, y: 8, tile: firstTile + 3, palette, hflip: false, vflip: false }
  ]
});
