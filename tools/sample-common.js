// Small art/screen helpers shared by every tools/make-*-sample.js generator.
// `tile`, `split16` and `metasprite` now live in shared/library/authoring.js
// — the starter library's own entries will share them, once later phases add
// any — and are re-exported here unchanged so every generator keeps
// importing them from this file. Only `screenFromArt` actually lives here:
// it turns a screen's legend art into `{ metatiles, entities }`, which is a
// fixture-authoring concern (screens and legends) the library itself has no
// use for.
export { tile, split16, metasprite } from '../shared/library/authoring.js';

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
