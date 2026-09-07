// Starter-library import for the Sprite Forge (design-starter-library.md
// §10): lists every `monster` and `pickup` entry (labelled by kind, via the
// shared picker's own generic label -- renderer/widgets/librarypicker.js),
// previews each pose the entry actually declares, and runs the shared
// two-step picker over the sprite table.

import { el } from '../../ui.js';
import { runLibraryImport, artCanvas, paintLibraryArt } from '../../widgets/librarypicker.js';
import { MONSTER_ENTRIES } from '../../../shared/library/monster/index.js';
import { PICKUP_ENTRIES } from '../../../shared/library/pickup/index.js';
import { ANIM_SLOTS } from '../../../shared/project.js';

const ENTRIES = [...MONSTER_ENTRIES, ...PICKUP_ENTRIES];

/** `{ idle: {...} }` for every v1 entry (singular sugar); a future entry may declare more (§2.4). */
function posesOf(entry) {
  return entry.poses ?? { idle: entry.metasprite };
}

/** Every pose an entry actually declares, in ANIM_SLOTS order, each labelled by direction. */
function renderPosesArt(entry, colours) {
  const poses = posesOf(entry);
  const declared = ANIM_SLOTS.filter((slot) => poses[slot.id]);
  const parts = declared.map((slot) => {
    const { node, stop } = artCanvas(16, 16, (context) => {
      const image = context.createImageData(16, 16);
      paintLibraryArt(image, 16, entry.spriteTiles, poses[slot.id].tiles, colours, { transparentZero: true });
      context.putImageData(image, 0, 0);
    });
    return { slot, node, stop };
  });
  const node = el(
    'div.field-row',
    { style: { gap: '4px' } },
    parts.map((part) => el('div', null, part.node, declared.length > 1 ? el('div.hint', null, part.slot.label) : null))
  );
  return { node, stop: () => parts.forEach((part) => part.stop()) };
}

export async function openLibraryActorImport(state, render) {
  const plan = await runLibraryImport({
    title: 'Import a monster or pickup from the library',
    entries: ENTRIES,
    tileTable: 'sprites',
    renderListPreview: (entry) => renderPosesArt(entry, entry.palette ?? entry.palettes[0]),
    renderCandidateArt: (entry, paletteIndex, candidateColours, image) => {
      const poses = posesOf(entry);
      const declared = ANIM_SLOTS.filter((slot) => poses[slot.id]);
      const width = declared.length * 16;
      const placements = declared.flatMap((slot, index) =>
        poses[slot.id].tiles
          .filter((tile) => (tile.paletteIndex ?? 0) === paletteIndex)
          .map((tile) => ({ ...tile, x: tile.x + index * 16 }))
      );
      paintLibraryArt(image, width, entry.spriteTiles, placements, candidateColours, { transparentZero: true });
    },
    candidateArtSize: (entry) => {
      const declared = ANIM_SLOTS.filter((slot) => posesOf(entry)[slot.id]);
      return { width: declared.length * 16, height: 16 };
    },
    // Otherwise planActorImport defaults to tileset 0 regardless of which
    // tileset is actually selected (shared/project.js's own `options.
    // tilesetId ?? 0`) -- this Forge's own "Tileset" select (renderTabs(),
    // shown once a project has more than one) would then silently be
    // ignored by a library import.
    planOptions: { tilesetId: state.tilesetId }
  });
  if (!plan) return;

  state.actor = plan.report.actor.id;
  render();
}
