// The starter library import flow (design-starter-library.md §10), shared by
// the Tile, Sprite and Sound Forges. "One body, not two": the candidate-slot
// step (§7.3) in particular is a single implementation here, never a copy
// per Forge.
//
// A Forge never talks to planLibraryImport/applyPlannedProject/store.commit
// directly for a library import -- it calls runLibraryImport() with a small
// set of kind-specific rendering callbacks, and gets back the accepted plan
// (or null on cancellation/refusal) to sync its own selection/render state.

import { store } from '../store.js';
import { el, showModal, toast, fitZoom, observeSize } from '../ui.js';
import { tileFromString, flipTile } from '../../shared/chr.js';
import { NES_PALETTE } from '../../shared/nespalette.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { planLibraryImport, applyPlannedProject, suggestedPaletteSlot, paletteCandidates } from '../../shared/project.js';

/**
 * Paint an entry's own art (an entry-local `tiles`/`spriteTiles` pool plus a
 * list of `{x, y, tile, hflip, vflip}` placements) into `imageData`, using
 * `colours` (a real 4-entry NES palette-index array) rather than the entry's
 * own declared placeholder palette -- what makes the SAME painter usable for
 * both a plain preview (the entry's own colours) and a palette-candidate
 * cell (a candidate slot's actual current colours, §7.3).
 */
export function paintLibraryArt(imageData, width, tiles, placements, colours, { transparentZero = false } = {}) {
  const decoded = tiles.map((tile) => tileFromString(tile));
  const rgb = colours.map((index) => NES_PALETTE[index & 0x3f]);
  const data = imageData.data;
  const height = imageData.height;
  for (const placement of placements) {
    let pixels = decoded[placement.tile];
    if (!pixels) continue;
    if (placement.hflip || placement.vflip) pixels = flipTile(pixels, !!placement.hflip, !!placement.vflip);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const slot = pixels[y * 8 + x];
        if (transparentZero && slot === 0) continue;
        const px = placement.x + x;
        const py = placement.y + y;
        // Bounded on each axis by its own dimension -- the art canvases are
        // wider than tall (a two-metatile terrain candidate is 32x16), so
        // bounding py by `width` let a y >= 16 placement write past the
        // buffer's own rows.
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const color = rgb[slot];
        const offset = (py * width + px) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = 255;
      }
    }
  }
  return imageData;
}

// The base height every art-stage's own CSS box is sized to (48px, matching
// .library-art-stage's own prior fixed square) -- width now scales to match
// the art's real aspect ratio instead, since a fixed 48x48 square clips
// anything wider than it is tall. Every terrain entry's own candidate cell
// is 32x16 (two metatiles, §8.1: "each set exactly 2 metatiles"), so this
// is not a hypothetical: an unscaled square box cut both ends off every
// terrain candidate at zoom 2 or more.
const ART_STAGE_HEIGHT = 48;

/**
 * A small canvas matching the art's own aspect ratio, sized via fitZoom/
 * observeSize -- never a fixed pixel size (§10), and (as of this fix) never
 * a fixed *square* either, so art wider than it is tall (a multi-metatile
 * or multi-pose candidate) is never clipped. Returns `{ node, stop, repaint
 * }`; `stop` disconnects the size observer and MUST be called once the
 * modal that hosts it closes (CLAUDE.md: "the observer must be disconnected
 * when the modal closes" -- every caller of this function inside this
 * module tracks and calls every `stop` it creates once its own `showModal`
 * resolves, on every resolution path, and a Forge using this directly in
 * its own `renderPreview` callback must do the same).
 */
export function artCanvas(width, height, draw) {
  const stage = el('div.library-art-stage');
  stage.style.height = `${ART_STAGE_HEIGHT}px`;
  stage.style.width = `${(ART_STAGE_HEIGHT * width) / height}px`;
  const canvas = el('canvas.pixels', { width, height });
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  stage.append(canvas);
  function repaint() {
    // The stage's own box now matches the art's aspect ratio (set above),
    // so fitZoom's min(across/width, down/height) picks the identical zoom
    // on both axes -- the canvas fills the stage exactly, with nothing left
    // to clip.
    const zoom = fitZoom(stage, width, height, { min: 1, max: 8 });
    canvas.style.width = `${width * zoom}px`;
    canvas.style.height = `${height * zoom}px`;
    draw(context);
  }
  const stop = observeSize(stage, repaint);
  return { node: stage, stop, repaint };
}

// --- Step 1: the entry list -------------------------------------------------

/**
 * `entries`: the candidate list (already filtered to the requested kind(s)).
 * `renderPreview(entry)`: returns `{ node, stop }` -- `node` is shown before
 * the entry's name/license (a rasterized preview canvas for terrain/monster/
 * pickup, or a ▶ Preview button for sfx/song, §10: "no palette step at
 * all"); `stop`, if given, is called once this modal closes (see
 * `artCanvas`'s own contract). Resolves to the chosen entry, or null on
 * Escape/backdrop/Cancel (§10 last paragraph: the caller does nothing
 * further).
 */
export async function pickLibraryEntry({ title, entries, renderPreview }) {
  const stops = [];
  const result = await showModal({
    title,
    width: 560,
    body: (close) =>
      el(
        'div.library-entry-list',
        null,
        entries.length
          ? entries.map((entry) => {
              const preview = renderPreview(entry);
              if (preview.stop) stops.push(preview.stop);
              return el(
                'div.library-entry-row',
                { dataset: { libraryEntry: entry.name } },
                preview.node,
                el(
                  'div.library-entry-info',
                  null,
                  el(
                    'div.library-entry-name',
                    null,
                    entry.name,
                    // Labels each row with its kind (§10, Sprite Forge:
                    // monster and pickup entries share one list) -- shown
                    // for every kind, not just when a list mixes two, since
                    // it costs nothing and is never wrong.
                    el('span.hint', { style: { marginLeft: '6px' } }, `(${entry.kind})`)
                  ),
                  el('div.hint', null, `${entry.license.type} · ${entry.license.author}`)
                ),
                el('button.btn.btn-sm.btn-accent', { onclick: () => close(entry) }, 'Choose')
              );
            })
          : el('p.hint', null, 'Nothing in the library for this kind yet.')
      ),
    actions: [{ label: 'Cancel', value: null }]
  });
  for (const stop of stops) stop();
  return result;
}

// --- Step 2: the palette-candidate picker (§7.3) -- ONE shared implementation

function candidateCaption(candidate, claimedByIndex) {
  if (candidate.excluded) {
    return `Claimed by this entry's own palette ${claimedByIndex + 1}`;
  }
  if (candidate.reserved) return candidate.reservedReason;
  return candidate.unused ? 'Free — will be written with this set’s own colours' : 'In use — its existing colours are kept';
}

async function pickOneCandidate({ project, mapper, tileTable, colors, excluded, claimedBy, renderArt, stepLabel, artWidth, artHeight }) {
  const paletteKey = tileTable === 'background' ? 'bg' : 'sprite';
  const candidates = paletteCandidates(project, colors, tileTable, mapper, excluded);
  const suggested = suggestedPaletteSlot(project, paletteKey, colors, excluded, mapper);

  const stops = [];
  const result = await showModal({
    title: `Choose a palette slot${stepLabel ? ` (${stepLabel})` : ''}`,
    width: 520,
    body: (close) =>
      el(
        'div.library-candidate-grid',
        null,
        candidates.map((candidate) => {
          const isSuggested = candidate.index === suggested;
          const { node, stop } = artCanvas(artWidth, artHeight, (context) => {
            const image = context.createImageData(artWidth, artHeight);
            renderArt(image, candidate.colours);
            context.putImageData(image, 0, 0);
          });
          stops.push(stop);
          return el(
            'button.library-candidate',
            {
              class: [isSuggested ? 'suggested' : '', candidate.excluded ? 'excluded' : ''].filter(Boolean).join(' '),
              disabled: candidate.excluded,
              dataset: {
                slot: String(candidate.index),
                suggested: String(isSuggested),
                unused: String(candidate.unused),
                reserved: String(candidate.reserved),
                excluded: String(candidate.excluded)
              },
              onclick: candidate.excluded ? null : () => close(candidate.index)
            },
            node,
            el('div.hint', null, `Slot ${candidate.index}${isSuggested ? ' (suggested)' : ''}`),
            el('div.hint.library-candidate-caption', null, candidateCaption(candidate, claimedBy.get(candidate.index)))
          );
        })
      ),
    actions: [{ label: 'Cancel', value: null }]
  });
  for (const stop of stops) stop();
  return result;
}

/**
 * Runs §7.3's own candidate picker once per entry-local palette in
 * `colorsList` order (§10: "never all at once in one combined picker"),
 * threading `excluded` through every step so a later palette can never land
 * on a slot an earlier one in this same import already claimed. Returns an
 * array of chosen slots (same length/order as `colorsList`), or null the
 * moment any step is cancelled. `renderArt(image, paletteIndex, colours)`
 * paints one candidate cell. `revisionAtOpen`, when given, is re-checked
 * against `store.revision` after EVERY one of the P candidate steps
 * resolves -- not only once after the whole sequence -- so a project change
 * during, say, the second of three palette steps aborts before the third
 * ever opens, rather than being caught only just before the final commit.
 */
export async function pickPaletteSlots({ project, mapper, tileTable, colorsList, renderArt, artWidth = 16, artHeight = 16, revisionAtOpen }) {
  const excluded = new Set();
  const claimedBy = new Map();
  const chosen = [];
  for (let i = 0; i < colorsList.length; i++) {
    const stepLabel = colorsList.length > 1 ? `palette ${i + 1} of ${colorsList.length}` : '';
    const slot = await pickOneCandidate({
      project,
      mapper,
      tileTable,
      colors: colorsList[i],
      excluded,
      claimedBy,
      renderArt: (image, colours) => renderArt(image, i, colours),
      stepLabel,
      artWidth,
      artHeight
    });
    if (slot === null) return null;
    if (revisionAtOpen !== undefined && store.revision !== revisionAtOpen) {
      toast('The project changed while this dialog was open — try again.', 'error');
      return null;
    }
    excluded.add(slot);
    claimedBy.set(slot, i);
    chosen.push(slot);
  }
  return chosen;
}

// --- Orchestration: list, candidates, plan, commit -------------------------

/**
 * `tileTable`: `'background'` | `'sprites'` | `null` (sfx/song skip the
 * candidate step entirely -- §10). `renderListPreview(entry)`: step 1's
 * per-row preview (see pickLibraryEntry). `renderCandidateArt(entry,
 * paletteIndex, candidateColours, image)`: paints the entry's own art into
 * `image` using `candidateColours` -- called once per candidate cell in step
 * 2, `paletteIndex` naming which of `entry.palettes ?? [entry.palette]` is
 * being resolved (always 0 for every v1 entry, which declares exactly one).
 * `candidateArtSize(entry)`, optional: `{ width, height }` for the candidate
 * cell's own canvas (default 16x16 -- one metasprite/metatile's worth); a
 * terrain entry with more than one metatile needs more room to show all of
 * them, so the Tile Forge supplies its own.
 *
 * Captures `store.revision` before the first modal opens and re-checks it
 * after EVERY await (the `openGeneratePlayerSpriteModal`/`openPaletteSwapModal`
 * idiom, renderer/forges/tile/tile.js and sprite.js): on any change, toasts
 * and abandons without committing. `planLibraryImport`/`applyPlannedProject`
 * then run back-to-back with no further await between them (§7.1).
 *
 * Returns the accepted plan (`{ project, report }`) on success, or null on
 * cancellation/refusal -- the caller uses `plan.report` to sync its own
 * selection and re-render.
 */
export async function runLibraryImport({
  title,
  entries,
  tileTable,
  renderListPreview,
  renderCandidateArt,
  candidateArtSize,
  planOptions = {},
  commitLabel = 'Import from library'
}) {
  const revisionAtOpen = store.revision;

  const entry = await pickLibraryEntry({ title, entries, renderPreview: renderListPreview });
  if (!entry) return null;
  if (store.revision !== revisionAtOpen) {
    toast('The project changed while this dialog was open — try again.', 'error');
    return null;
  }

  let options = { ...planOptions };
  if (tileTable) {
    const mapper = resolveMapper(store.project.cartridge.mapper);
    const colorsList = entry.palettes ?? [entry.palette];
    const { width: artWidth, height: artHeight } = candidateArtSize ? candidateArtSize(entry) : { width: 16, height: 16 };
    const slots = await pickPaletteSlots({
      project: store.project,
      mapper,
      tileTable,
      colorsList,
      renderArt: (image, paletteIndex, candidateColours) => renderCandidateArt(entry, paletteIndex, candidateColours, image),
      artWidth,
      artHeight,
      // Checked after EVERY palette's own candidate step resolves, not only
      // once after the whole (possibly P>1) sequence -- a project change
      // during the second of two palette steps must abort before the third
      // ever opens, not merely before the final commit.
      revisionAtOpen
    });
    if (!slots) return null;
    if (store.revision !== revisionAtOpen) {
      toast('The project changed while this dialog was open — try again.', 'error');
      return null;
    }
    options = { ...options, ...(colorsList.length > 1 ? { paletteSlots: slots } : { paletteSlot: slots[0] }) };
  }

  const plan = planLibraryImport(store.project, entry, options);
  if (!plan.ok) {
    toast(plan.reason, 'error');
    return null;
  }
  store.commit(commitLabel, (project) => applyPlannedProject(project, plan.project));
  toast(plan.report.lines.join(' '), 'success');
  return plan;
}
