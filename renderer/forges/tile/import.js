// Image import for the Tile Forge: convert a PNG/JPG to NES colours, slice it
// into de-duplicated 8x8 tiles, and append them to the active pattern table.

import { store } from '../../store.js';
import { el, field, showModal, toast } from '../../ui.js';
import { quantizeImage, indexedToRgba, sliceToTiles, DITHER_MODES } from '../../../shared/quantize.js';
import { perceptualPaletteFor } from '../../../shared/nespalette.js';
import { tileToString, BLANK_TILE } from '../../../shared/chr.js';
import { LIMITS, tilesetAt } from '../../../shared/project.js';

async function pickImage() {
  const result = await window.forge.files.readBinary([
    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }
  ]);
  if (!result.ok) throw new Error(result.error);
  if (!result.value) return null;
  const blob = new Blob([result.value.data]);
  const url = URL.createObjectURL(blob);
  try {
    const bitmap = await createImageBitmap(blob);
    return { bitmap, name: result.value.name, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error('That file could not be decoded as an image.');
  }
}

export async function openImportDialog(app, state, syncFromStore, renderAll) {
  let picked;
  try {
    picked = await pickImage();
  } catch (error) {
    return toast(error.message, 'error');
  }
  if (!picked) return;

  const options = {
    width: 64,
    height: 64,
    mode: 'bayer4',
    strength: 60,
    fit: 'contain',
    alphaToZero: state.table === 'sprites',
    usePalette: 'auto'
  };

  let result = null;
  const preview = el('canvas.pixels', { style: { border: '1px solid var(--line)', background: '#000' } });
  const summary = el('p.hint');

  function activePalette() {
    const set = state.table === 'background' ? store.project.palettes.bg : store.project.palettes.sprite;
    return set[state.activePalette];
  }

  function recompute() {
    const { width, height } = options;
    const scratch = new OffscreenCanvas(width, height);
    const context = scratch.getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, width, height);
    if (!options.alphaToZero) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
    }
    const scale =
      options.fit === 'cover'
        ? Math.max(width / picked.bitmap.width, height / picked.bitmap.height)
        : Math.min(width / picked.bitmap.width, height / picked.bitmap.height);
    const drawWidth = picked.bitmap.width * scale;
    const drawHeight = picked.bitmap.height * scale;
    context.imageSmoothingEnabled = drawWidth < picked.bitmap.width;
    context.drawImage(picked.bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    const raw = context.getImageData(0, 0, width, height);

    let palette;
    if (options.usePalette === 'auto') {
      const pixels = [];
      for (let i = 0; i < raw.data.length; i += 4) {
        if (!options.alphaToZero || raw.data[i + 3] >= 128) {
          pixels.push([raw.data[i], raw.data[i + 1], raw.data[i + 2]]);
        }
      }
      palette = perceptualPaletteFor(pixels);
    } else {
      palette = [...activePalette()];
    }

    const indexed = quantizeImage(raw, palette, {
      mode: options.mode,
      strength: options.strength / 100,
      alphaToZero: options.alphaToZero
    });
    const sliced = sliceToTiles(indexed, width, height);

    preview.width = width;
    preview.height = height;
    preview.style.width = `${Math.min(320, width * 4)}px`;
    preview.style.height = `${(Math.min(320, width * 4) * height) / width}px`;
    preview.getContext('2d').putImageData(new ImageData(indexedToRgba(indexed, palette), width, height), 0, 0);

    const free = tilesetAt(store.project, state.tilesetId)[state.table].tiles.filter((tile) => tile === BLANK_TILE).length;
    summary.textContent =
      `${sliced.columns}×${sliced.rows} tiles · ${sliced.tiles.length} unique after de-duplication · ` +
      `${free} empty slots available in the ${state.table} table`;

    result = { palette, sliced };
  }

  const modeSelect = el(
    'select',
    {
      value: options.mode,
      onchange: (event) => {
        options.mode = event.target.value;
        recompute();
      }
    },
    DITHER_MODES.map((mode) => el('option', { value: mode.id, selected: mode.id === options.mode }, mode.label))
  );

  const sizeInput = (key) =>
    el('input', {
      type: 'number',
      min: 8,
      max: 256,
      step: 8,
      value: options[key],
      onchange: (event) => {
        options[key] = Math.max(8, Math.min(256, Math.round(Number(event.target.value) / 8) * 8));
        event.target.value = options[key];
        recompute();
      }
    });

  const body = el(
    'div',
    { style: { display: 'grid', gridTemplateColumns: '1fr 240px', gap: '18px', minWidth: '640px' } },
    el(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' } },
      preview,
      summary
    ),
    el(
      'div',
      null,
      field('Output size (pixels)', el('div.field-row', null, sizeInput('width'), el('span', null, '×'), sizeInput('height'))),
      field('Dithering', modeSelect),
      field(
        'Dither strength',
        el('input', {
          type: 'range',
          min: 0,
          max: 100,
          value: options.strength,
          oninput: (event) => {
            options.strength = Number(event.target.value);
            recompute();
          }
        })
      ),
      field(
        'Palette',
        el(
          'select',
          {
            onchange: (event) => {
              options.usePalette = event.target.value;
              recompute();
            }
          },
          el('option', { value: 'auto' }, 'Choose the best four colours'),
          el('option', { value: 'active' }, `Use palette ${state.activePalette} as-is`)
        )
      ),
      field(
        'Scaling',
        el(
          'select',
          {
            onchange: (event) => {
              options.fit = event.target.value;
              recompute();
            }
          },
          el('option', { value: 'contain' }, 'Fit inside (letterbox)'),
          el('option', { value: 'cover' }, 'Fill and crop')
        )
      ),
      el(
        'label.check',
        null,
        el('input', {
          type: 'checkbox',
          checked: options.alphaToZero,
          onchange: (event) => {
            options.alphaToZero = event.target.checked;
            recompute();
          }
        }),
        'Transparent pixels become slot 0'
      ),
      el(
        'p.hint',
        { style: { marginTop: '10px' } },
        'Tiles are appended to the first free slots of the ',
        state.table,
        ' table. The chosen four colours replace palette ',
        String(state.activePalette),
        '.'
      )
    )
  );

  recompute();

  const confirmed = await showModal({
    title: `Import ${picked.name}`,
    body,
    actions: [
      { label: 'Cancel', value: false },
      { label: 'Import tiles', primary: true, value: true }
    ]
  });

  URL.revokeObjectURL(picked.url);
  picked.bitmap.close?.();
  if (!confirmed || !result) return;

  const table = tilesetAt(store.project, state.tilesetId)[state.table].tiles;
  const free = [];
  for (let i = 0; i < LIMITS.tilesPerTable; i++) if (table[i] === BLANK_TILE) free.push(i);
  if (result.sliced.tiles.length > free.length) {
    return toast(
      `Need ${result.sliced.tiles.length} free tile slots but only ${free.length} are empty. ` +
        'Reduce the output size or clear some tiles first.',
      'error'
    );
  }

  const kind = state.table === 'background' ? 'bg' : 'sprite';
  const paletteIndex = state.activePalette;
  store.commit('Import image', (project) => {
    result.sliced.tiles.forEach((tile, index) => {
      tilesetAt(project, state.tilesetId)[state.table].tiles[free[index]] = tileToString(tile);
    });
    if (options.usePalette === 'auto') {
      project.palettes[kind][paletteIndex] = [...result.palette];
      const backdrop = project.palettes[kind][paletteIndex][0];
      for (const set of [project.palettes.bg, project.palettes.sprite]) {
        for (const entry of set) entry[0] = backdrop;
      }
    }
  });

  syncFromStore();
  renderAll();
  toast(`${result.sliced.tiles.length} tiles imported`, 'success');
}
