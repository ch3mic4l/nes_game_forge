// Screen-authoring helpers for the starter projects (ROADMAP item 8, fifth
// sub-bullet, docs/design-starter-projects.md §3.3). `screenFromArt` moved
// here verbatim from tools/sample-common.js, which now only re-exports it:
// every content starter authors its own interior rooms and overworld screens
// as ASCII-art legends, the identical idiom every tools/make-*-sample.js
// generator already uses, and this is exactly as much a starter concern as
// a fixture-authoring one -- no DOM, no Node API, nothing imported.

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
