// Starter-library import for the Tile Forge (design-starter-library.md §10):
// lists every `terrain` entry, previews each of its metatiles as a 16x16
// block of its own four entry-local tiles, and runs the shared two-step
// picker (renderer/widgets/librarypicker.js) over the background table.
//
// Terrain always targets the background table and 'bg' palettes, regardless
// of which sheet (state.table) the author currently has open in the Tile
// Forge -- a terrain entry has no sprite-table art at all, so there is
// nothing to target on the sprite side.

import { el } from '../../ui.js';
import { runLibraryImport, artCanvas, paintLibraryArt } from '../../widgets/librarypicker.js';
import { TERRAIN_ENTRIES } from '../../../shared/library/terrain/index.js';
import { store } from '../../store.js';

/** A terrain metatile's own 4 entry-local tile indices, laid out 2x2. */
function metatilePlacements(metatile) {
  return [
    { x: 0, y: 0, tile: metatile.tiles[0] },
    { x: 8, y: 0, tile: metatile.tiles[1] },
    { x: 0, y: 8, tile: metatile.tiles[2] },
    { x: 8, y: 8, tile: metatile.tiles[3] }
  ];
}

/** Every one of an entry's metatiles, side by side, each 16x16, in `colours`. */
function renderTerrainArt(entry, colours) {
  const parts = entry.metatiles.map((metatile) =>
    artCanvas(16, 16, (context) => {
      const image = context.createImageData(16, 16);
      paintLibraryArt(image, 16, entry.tiles, metatilePlacements(metatile), colours);
      context.putImageData(image, 0, 0);
    })
  );
  return {
    node: el('div.field-row', { style: { gap: '4px' } }, parts.map((part) => part.node)),
    stop: () => parts.forEach((part) => part.stop())
  };
}

export async function openLibraryImportDialog(app, state, syncFromStore, renderAll) {
  const plan = await runLibraryImport({
    title: 'Import terrain from the library',
    entries: TERRAIN_ENTRIES,
    tileTable: 'background',
    renderListPreview: (entry) => {
      // The entry's own placeholder backdrop (§7.3) replaced with the
      // destination project's real one, so the list preview shows the
      // colours it will actually render with -- never the entry's own
      // unresolved literal slot 0.
      const canonical = [store.project.palettes.bg[0][0], ...entry.palette.slice(1)];
      return renderTerrainArt(entry, canonical);
    },
    renderCandidateArt: (entry, paletteIndex, candidateColours, image) => {
      // One entry-local palette (v1: always exactly one), rendered across
      // every one of the entry's metatiles at once -- candidateArtSize below
      // sizes the canvas to hold them all.
      const width = entry.metatiles.length * 16;
      paintLibraryArt(
        image,
        width,
        entry.tiles,
        entry.metatiles.flatMap((metatile, index) =>
          metatilePlacements(metatile).map((placement) => ({ ...placement, x: placement.x + index * 16 }))
        ),
        candidateColours
      );
    },
    candidateArtSize: (entry) => ({ width: entry.metatiles.length * 16, height: 16 }),
    // Otherwise planTerrainImport defaults to tileset 0 regardless of which
    // tileset is actually on screen (shared/project.js's own `options.
    // tilesetId ?? 0`) -- a project with a second tileset (CNROM and up)
    // would then have its art written into the WRONG tileset while the
    // claimed metatile's own tile indices point at whichever one is
    // currently selected in the Tile Forge's own sheet.
    planOptions: { tilesetId: state.tilesetId }
  });
  if (!plan) return;

  syncFromStore();
  renderAll();
}
