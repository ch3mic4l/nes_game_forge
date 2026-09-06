// The authoring helpers the starter library's own entries and the sample
// generators share: small, pure art-shape functions with no project, DOM or
// Node dependency. Imports nothing.

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
