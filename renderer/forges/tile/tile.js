// Tile Forge — draw the 8x8 tiles the whole game is built from.
//
// Ports the TileForge pixel editor (codex_img_to_nes) onto the project's two
// 256-entry pattern tables. Editing works on a region of 1x1, 2x2 or 4x4 tiles
// so 16x16 and 32x32 characters can be drawn as one picture.

import { store } from '../../store.js';
import { el, clear, fill, toast, canvasPoint, line, confirmModal, promptModal, fitZoom, observeSize } from '../../ui.js';
import { tileFromString, tileToString, encodeTiles, decodeChr, flipTile, BLANK_TILE } from '../../../shared/chr.js';
import { NES_PALETTE, cssColor, colorLabel, isUnsafeColor } from '../../../shared/nespalette.js';
import { LIMITS, tilesetAt, createTileset } from '../../../shared/project.js';
import { resolveMapper, tilesetLimit } from '../../../shared/cartridge.js';
import { FONT_BASE, fontBankSplit, fontChrPages, projectUsesText } from '../../../shared/font.js';
import { openImportDialog } from './import.js';

const SHEET_COLS = 16;
const SHEET_ROWS = LIMITS.tilesPerTable / SHEET_COLS;

export function mount(container, app) {
  const state = {
    // Which tileset (CHR bank) is open, and which of its two tables.
    tilesetId: 0,
    table: 'background',
    tiles: [],
    selected: 0,
    regionSize: 1,
    activePalette: 0,
    activeSlot: 1,
    tool: 'pencil',
    sheetZoom: 2,
    painting: false,
    lastPoint: null,
    clipboard: null
  };

  // ------------------------------------------------------------- helpers

  const paletteSet = () => (state.table === 'background' ? store.project.palettes.bg : store.project.palettes.sprite);
  const palette = () => paletteSet()[state.activePalette];
  const transparentZero = () => state.table === 'sprites';
  // Only the background table loses tiles to the font, only while something in
  // the project actually puts text on screen — and never on a scanline-IRQ
  // board, where the font rides in its own CHR bank and every tile stays yours.
  const fontReserved = () =>
    state.table === 'background' &&
    projectUsesText(store.project) &&
    !fontBankSplit(store.project, resolveMapper(store.project.cartridge.mapper));

  function syncFromStore() {
    state.tiles = tilesetAt(store.project, state.tilesetId)[state.table].tiles.map(tileFromString);
  }

  function regionOrigin() {
    const size = state.regionSize;
    const col = Math.floor((state.selected % SHEET_COLS) / size) * size;
    const row = Math.floor(Math.floor(state.selected / SHEET_COLS) / size) * size;
    return { col, row };
  }

  function regionTiles() {
    const { col, row } = regionOrigin();
    const out = [];
    for (let ry = 0; ry < state.regionSize; ry++) {
      for (let rx = 0; rx < state.regionSize; rx++) {
        out.push((row + ry) * SHEET_COLS + col + rx);
      }
    }
    return out;
  }

  function writeTile(index) {
    tilesetAt(store.project, state.tilesetId)[state.table].tiles[index] = tileToString(state.tiles[index]);
  }

  function writeRegion() {
    for (const index of regionTiles()) writeTile(index);
  }

  // ------------------------------------------------------------- rendering

  function paintImageData(imageData, readSlot, width, height) {
    const colors = palette().map((index) => NES_PALETTE[index & 0x3f]);
    const data = imageData.data;
    const hideZero = transparentZero();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const slot = readSlot(x, y);
        const offset = (y * width + x) * 4;
        const color = colors[slot];
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = hideZero && slot === 0 ? 0 : 255;
      }
    }
    return imageData;
  }

  function renderSheet() {
    const width = SHEET_COLS * 8;
    const height = SHEET_ROWS * 8;
    const image = sheetContext.createImageData(width, height);
    paintImageData(
      image,
      (x, y) => {
        const tile = state.tiles[Math.floor(y / 8) * SHEET_COLS + Math.floor(x / 8)];
        return tile[(y % 8) * 8 + (x % 8)];
      },
      width,
      height
    );
    sheetBuffer.width = width;
    sheetBuffer.height = height;
    sheetBuffer.getContext('2d').putImageData(image, 0, 0);

    sheetCanvas.width = width * state.sheetZoom;
    sheetCanvas.height = height * state.sheetZoom;
    sheetContext.imageSmoothingEnabled = false;
    sheetContext.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height);
    sheetContext.drawImage(sheetBuffer, 0, 0, sheetCanvas.width, sheetCanvas.height);

    // 8x8 grid, then the selection box.
    const cell = 8 * state.sheetZoom;
    sheetContext.strokeStyle = 'rgba(255,255,255,0.08)';
    sheetContext.lineWidth = 1;
    sheetContext.beginPath();
    for (let i = 1; i < SHEET_COLS; i++) {
      sheetContext.moveTo(i * cell + 0.5, 0);
      sheetContext.lineTo(i * cell + 0.5, sheetCanvas.height);
    }
    for (let i = 1; i < SHEET_ROWS; i++) {
      sheetContext.moveTo(0, i * cell + 0.5);
      sheetContext.lineTo(sheetCanvas.width, i * cell + 0.5);
    }
    sheetContext.stroke();

    // The message font is stamped over the top of $A0-$FF at build time, so
    // anything drawn there will not survive into the ROM. Shading it is cheaper
    // than letting someone find that out from a screenshot; validateProject
    // refuses artwork here from the same predicate.
    if (fontReserved()) {
      const top = Math.floor(FONT_BASE / SHEET_COLS) * cell;
      sheetContext.fillStyle = 'rgba(255, 157, 60, 0.16)';
      sheetContext.fillRect(0, top, sheetCanvas.width, sheetCanvas.height - top);
      sheetContext.strokeStyle = 'rgba(255, 157, 60, 0.7)';
      sheetContext.lineWidth = 1;
      sheetContext.beginPath();
      sheetContext.moveTo(0, top + 0.5);
      sheetContext.lineTo(sheetCanvas.width, top + 0.5);
      sheetContext.stroke();
    }

    const { col, row } = regionOrigin();
    sheetContext.strokeStyle = '#ff9d3c';
    sheetContext.lineWidth = 2;
    sheetContext.strokeRect(
      col * cell + 1,
      row * cell + 1,
      state.regionSize * cell - 2,
      state.regionSize * cell - 2
    );
  }

  // The editor has no zoom control: it is always as large as the stage allows,
  // so resizing the window (or going full screen) grows the drawing area.
  function editorZoom() {
    const span = 8 * state.regionSize;
    return fitZoom(editStage, span, span, { min: 4 });
  }

  function renderEditor() {
    const span = 8 * state.regionSize;
    const zoom = editorZoom();
    const indices = regionTiles();

    editorCanvas.width = span;
    editorCanvas.height = span;
    editorCanvas.style.width = `${span * zoom}px`;
    editorCanvas.style.height = `${span * zoom}px`;
    const context = editorCanvas.getContext('2d');
    const image = context.createImageData(span, span);
    paintImageData(
      image,
      (x, y) => {
        const tile = state.tiles[indices[Math.floor(y / 8) * state.regionSize + Math.floor(x / 8)]];
        return tile[(y % 8) * 8 + (x % 8)];
      },
      span,
      span
    );
    context.putImageData(image, 0, 0);

    overlay.width = span * zoom;
    overlay.height = span * zoom;
    overlay.style.width = `${span * zoom}px`;
    overlay.style.height = `${span * zoom}px`;
    const grid = overlay.getContext('2d');
    grid.clearRect(0, 0, overlay.width, overlay.height);
    if (zoom >= 6) {
      grid.strokeStyle = 'rgba(255,255,255,0.10)';
      grid.lineWidth = 1;
      grid.beginPath();
      for (let i = 1; i < span; i++) {
        grid.moveTo(i * zoom + 0.5, 0);
        grid.lineTo(i * zoom + 0.5, overlay.height);
        grid.moveTo(0, i * zoom + 0.5);
        grid.lineTo(overlay.width, i * zoom + 0.5);
      }
      grid.stroke();
    }
    grid.strokeStyle = 'rgba(255,157,60,0.55)';
    grid.lineWidth = 1;
    grid.beginPath();
    for (let i = 1; i < state.regionSize; i++) {
      grid.moveTo(i * 8 * zoom + 0.5, 0);
      grid.lineTo(i * 8 * zoom + 0.5, overlay.height);
      grid.moveTo(0, i * 8 * zoom + 0.5);
      grid.lineTo(overlay.width, i * 8 * zoom + 0.5);
    }
    grid.stroke();

    editorInfo.textContent = indices.map((i) => `$${i.toString(16).padStart(2, '0').toUpperCase()}`).join(' ');
  }

  function renderPalettes() {
    clear(paletteList);
    paletteSet().forEach((entry, paletteIndex) => {
      const row = el(
        'div.palette-row',
        {
          class: paletteIndex === state.activePalette ? 'active' : '',
          onclick: () => {
            state.activePalette = paletteIndex;
            renderPalettes();
            renderSheet();
            renderEditor();
          }
        },
        el('span.palette-index', null, paletteIndex),
        entry.map((color, slot) =>
          el('button.swatch', {
            class: `${paletteIndex === state.activePalette && slot === state.activeSlot ? 'selected' : ''} ${
              transparentZero() && slot === 0 ? 'transparent' : ''
            }`,
            style: { background: cssColor(color) },
            title: `Slot ${slot} — ${colorLabel(color)}`,
            onclick: (event) => {
              event.stopPropagation();
              state.activePalette = paletteIndex;
              state.activeSlot = slot;
              renderPalettes();
              renderSheet();
              renderEditor();
            }
          })
        )
      );
      paletteList.append(row);
    });
    renderPicker();
  }

  function renderPicker() {
    clear(picker);
    const current = palette()[state.activeSlot];
    NES_PALETTE.forEach((color, index) => {
      const unsafe = isUnsafeColor(index);
      picker.append(
        el('button.color-chip', {
          class: `${index === current ? 'selected' : ''} ${unsafe ? 'unsafe' : ''}`,
          style: { background: `rgb(${color.join(',')})` },
          title: unsafe ? `${colorLabel(index)} — unsafe on real hardware` : colorLabel(index),
          disabled: unsafe,
          onclick: () => setColor(index)
        })
      );
    });
    pickerLabel.textContent = `Palette ${state.activePalette}, slot ${state.activeSlot} — ${colorLabel(current)}`;
  }

  function setColor(colorIndex) {
    const slot = state.activeSlot;
    const paletteIndex = state.activePalette;
    const kind = state.table === 'background' ? 'bg' : 'sprite';
    store.commit('Change palette colour', (project) => {
      if (slot === 0) {
        // The NES has a single backdrop colour shared by every palette.
        for (const set of [project.palettes.bg, project.palettes.sprite]) {
          for (const entry of set) entry[0] = colorIndex;
        }
      } else {
        project.palettes[kind][paletteIndex][slot] = colorIndex;
      }
    });
  }

  function renderStats() {
    const used = state.tiles.filter((tile) => tileToString(tile) !== BLANK_TILE).length;
    fill(stats,
      el('div.kv', null, el('span', null, 'Tiles used'), el('span', null, `${used} / ${LIMITS.tilesPerTable}`)),
      el('div.meter', null, el('div.meter-fill', { style: { width: `${(used / LIMITS.tilesPerTable) * 100}%` } })),
      el('p.hint', null, 'One pattern table holds 256 tiles. Background and sprite tables are separate.'),
      fontReserved()
        ? el(
            'p.hint',
            { style: { color: 'var(--accent)' } },
            `Tiles $${FONT_BASE.toString(16).toUpperCase()}–$FF are shaded because this game shows text: ` +
              'the message font is stamped over them when the ROM is built.'
          )
        : null,
      state.table === 'background' &&
      projectUsesText(store.project) &&
      fontBankSplit(store.project, resolveMapper(store.project.cartridge.mapper))
        ? el(
            'p.hint',
            null,
            'This cartridge gives the message font its own graphics bank via its scanline interrupt, ' +
              'so showing text reserves no background tiles here.'
          )
        : null,
      renderTilesetList()
    );
  }

  /**
   * The tileset list. One tileset is one 8 KB CHR bank -- a background table and
   * a sprite table the hardware switches together -- so how many a project may
   * have is a property of the mapper, not a UI choice.
   */
  function renderTilesetList() {
    const mapper = resolveMapper(store.project.cartridge.mapper);
    const tilesets = store.project.tilesets;
    // The configured limit, not the mapper's raw ceiling: four-screen mirroring
    // spends a CHR-RAM page on nametables, and a split-font board spends one
    // CHR page on the message font.
    const limit = tilesetLimit(mapper, store.project.cartridge, fontChrPages(store.project, mapper));
    const atLimit = tilesets.length >= limit;

    const rows = tilesets.map((tileset, index) =>
      el(
        'div.tileset-row',
        {
          class: index === state.tilesetId ? 'active' : '',
          onclick: () => {
            if (index === state.tilesetId) return;
            state.tilesetId = index;
            syncFromStore();
            renderAll();
          }
        },
        el('span.tileset-name', { title: tileset.name }, tileset.name),
        el('span.tileset-meta', null, `bank ${index}`),
        el(
          'button.btn.btn-icon',
          {
            title: 'Rename this tileset',
            onclick: async (event) => {
              event.stopPropagation();
              await renameTileset(index);
            }
          },
          '✎'
        ),
        tilesets.length > 1
          ? el(
              'button.btn.btn-icon',
              {
                title: 'Delete this tileset',
                onclick: async (event) => {
                  event.stopPropagation();
                  await deleteTileset(index);
                }
              },
              '×'
            )
          : null
      )
    );

    return el(
      'div',
      { style: { marginTop: '14px' } },
      el(
        'div.field-row',
        { style: { marginBottom: '6px' } },
        el('span.field-label', null, 'Tilesets'),
        el(
          'button.btn',
          {
            style: { marginLeft: 'auto' },
            disabled: atLimit,
            // Say why rather than presenting a button that silently does nothing.
            title: atLimit
              ? `${mapper.name} addresses ${limit} tileset${limit === 1 ? '' : 's'} as configured. ` +
                'Choose a mapper with more graphics banks in the Build panel.'
              : 'Add a tileset',
            onclick: addTileset
          },
          '+ Add'
        )
      ),
      el('div.tileset-list', null, ...rows),
      el(
        'p.hint',
        null,
        atLimit
          ? `${mapper.name} holds ${limit} tileset${limit === 1 ? '' : 's'} as configured. ` +
            'Change the mapper in the Build panel to add more.'
          : `${mapper.name} holds up to ${limit}. A map chooses its tileset in the Map Forge.`
      )
    );
  }

  async function addTileset() {
    const mapper = resolveMapper(store.project.cartridge.mapper);
    const limit = tilesetLimit(mapper, store.project.cartridge, fontChrPages(store.project, mapper));
    if (store.project.tilesets.length >= limit) return;
    const name = await promptModal('Add tileset', 'Name', `Tileset ${store.project.tilesets.length}`);
    if (name === null) return;
    const index = store.project.tilesets.length;
    store.commit('Add tileset', (project) => {
      project.tilesets.push(createTileset(index, name));
    });
    state.tilesetId = index;
    syncFromStore();
    renderAll();
    toast(`Added "${name}" as bank ${index}.`);
  }

  async function renameTileset(index) {
    const current = store.project.tilesets[index];
    const name = await promptModal('Rename tileset', 'Name', current.name);
    if (name === null || name === current.name) return;
    store.commit('Rename tileset', (project) => {
      project.tilesets[index].name = name;
    });
    renderAll();
  }

  async function deleteTileset(index) {
    const tileset = store.project.tilesets[index];
    const usedBy = store.project.maps.filter((map) => map.tilesetId === index);
    const warning = usedBy.length
      ? ` ${usedBy.map((map) => map.name).join(', ')} ${usedBy.length === 1 ? 'uses' : 'use'} it and will fall back to the first tileset.`
      : '';
    if (!(await confirmModal('Delete tileset', `Delete "${tileset.name}" and its 512 tiles?${warning}`, 'Delete'))) {
      return;
    }
    store.commit('Delete tileset', (project) => {
      project.tilesets.splice(index, 1);
      project.tilesets.forEach((entry, position) => {
        entry.id = position;
      });
      // Banks after the removed one shift down, so every map's reference has to
      // move with them or maps would silently repoint at a different tileset.
      for (const map of project.maps) {
        if (map.tilesetId === index) map.tilesetId = 0;
        else if (map.tilesetId > index) map.tilesetId -= 1;
      }
    });
    state.tilesetId = Math.min(state.tilesetId, store.project.tilesets.length - 1);
    syncFromStore();
    renderAll();
  }

  function renderAll() {
    renderSheet();
    renderEditor();
    renderPalettes();
    renderStats();
  }

  // ---------------------------------------------------------------- tools

  function pixelAt(x, y) {
    const indices = regionTiles();
    const tile = state.tiles[indices[Math.floor(y / 8) * state.regionSize + Math.floor(x / 8)]];
    return tile[(y % 8) * 8 + (x % 8)];
  }

  function setPixel(x, y, slot) {
    const span = 8 * state.regionSize;
    if (x < 0 || y < 0 || x >= span || y >= span) return;
    const indices = regionTiles();
    const tile = state.tiles[indices[Math.floor(y / 8) * state.regionSize + Math.floor(x / 8)]];
    tile[(y % 8) * 8 + (x % 8)] = slot;
  }

  function floodFill(startX, startY, slot) {
    const span = 8 * state.regionSize;
    const target = pixelAt(startX, startY);
    if (target === slot) return false;
    const queue = [[startX, startY]];
    setPixel(startX, startY, slot);
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ]) {
        if (nx < 0 || ny < 0 || nx >= span || ny >= span) continue;
        if (pixelAt(nx, ny) !== target) continue;
        setPixel(nx, ny, slot);
        queue.push([nx, ny]);
      }
    }
    return true;
  }

  function onPointerDown(event) {
    if (event.button > 2) return;
    event.preventDefault();
    const span = 8 * state.regionSize;
    const point = canvasPoint(event, editorCanvas, span, span);

    if (state.tool === 'eyedropper') {
      state.activeSlot = pixelAt(point.x, point.y);
      renderPalettes();
      return;
    }

    const slot = event.button === 2 ? 0 : state.activeSlot;
    if (state.tool === 'fill') {
      store.beginStroke('Fill');
      if (floodFill(point.x, point.y, slot)) {
        writeRegion();
        store.endStroke();
        renderAll();
      } else {
        store.cancelStroke();
      }
      return;
    }

    store.beginStroke('Draw');
    state.painting = true;
    state.paintSlot = slot;
    state.lastPoint = point;
    setPixel(point.x, point.y, slot);
    writeRegion();
    renderEditor();
    renderSheet();
    editorCanvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    const span = 8 * state.regionSize;
    const point = canvasPoint(event, editorCanvas, span, span);
    cursorInfo.textContent = `x${point.x} y${point.y} · slot ${pixelAt(point.x, point.y)}`;
    if (!state.painting) return;
    line(state.lastPoint, point, (x, y) => setPixel(x, y, state.paintSlot));
    state.lastPoint = point;
    writeRegion();
    renderEditor();
    renderSheet();
  }

  function onPointerUp() {
    if (!state.painting) return;
    state.painting = false;
    state.lastPoint = null;
    store.endStroke();
    renderStats();
  }

  function transformRegion(label, transform) {
    store.commit(label, () => {
      const indices = regionTiles();
      const size = state.regionSize;
      const source = indices.map((index) => Uint8Array.from(state.tiles[index]));
      transform(source, size).forEach((tile, position) => {
        state.tiles[indices[position]].set(tile);
      });
      for (const index of indices) writeTile(index);
    });
    renderAll();
  }

  const flipHorizontal = (source, size) => {
    const out = [];
    for (let ry = 0; ry < size; ry++) {
      for (let rx = 0; rx < size; rx++) {
        out.push(flipTile(source[ry * size + (size - 1 - rx)], true, false));
      }
    }
    return out;
  };

  const flipVertical = (source, size) => {
    const out = [];
    for (let ry = 0; ry < size; ry++) {
      for (let rx = 0; rx < size; rx++) {
        out.push(flipTile(source[(size - 1 - ry) * size + rx], false, true));
      }
    }
    return out;
  };

  // ------------------------------------------------------------ file I/O

  async function importChr() {
    const result = await window.forge.files.readBinary([{ name: 'CHR pattern data', extensions: ['chr', 'bin'] }]);
    if (!result.ok) return toast(result.error, 'error');
    if (!result.value) return;
    let tiles;
    try {
      tiles = decodeChr(new Uint8Array(result.value.data));
    } catch (error) {
      return toast(error.message, 'error');
    }
    const start = state.selected;
    const count = Math.min(tiles.length, LIMITS.tilesPerTable - start);
    store.commit('Import CHR', (project) => {
      for (let i = 0; i < count; i++) {
        tilesetAt(project, state.tilesetId)[state.table].tiles[start + i] = tileToString(tiles[i]);
      }
    });
    toast(
      `${result.value.name}: ${count} tiles loaded at $${start.toString(16).padStart(2, '0')}` +
        (count < tiles.length ? ` (${tiles.length - count} did not fit)` : ''),
      'success'
    );
  }

  async function exportChr() {
    const bytes = encodeTiles(tilesetAt(store.project, state.tilesetId)[state.table].tiles);
    const result = await window.forge.files.writeBinary(`${state.table}.chr`, bytes);
    if (result.ok && result.value) toast(`Wrote ${bytes.length} bytes`, 'success');
  }

  async function importPal() {
    const result = await window.forge.files.readBinary([{ name: 'NES palette', extensions: ['pal', 'bin'] }]);
    if (!result.ok) return toast(result.error, 'error');
    if (!result.value) return;
    const bytes = new Uint8Array(result.value.data);
    if (bytes.length < 4) return toast('Palette files need at least four bytes.', 'error');
    const kind = state.table === 'background' ? 'bg' : 'sprite';
    store.commit('Import palette', (project) => {
      for (let slot = 0; slot < 4; slot++) {
        project.palettes[kind][state.activePalette][slot] = bytes[slot] & 0x3f;
      }
      const backdrop = project.palettes[kind][state.activePalette][0];
      for (const set of [project.palettes.bg, project.palettes.sprite]) {
        for (const entry of set) entry[0] = backdrop;
      }
    });
    toast('Palette applied', 'success');
  }

  async function exportPal() {
    const bytes = Uint8Array.from(palette());
    const result = await window.forge.files.writeBinary(`palette${state.activePalette}.pal`, bytes);
    if (result.ok && result.value) toast('Palette written', 'success');
  }

  async function clearRegion() {
    if (!(await confirmModal('Clear tiles', 'Clear every pixel in the selected region?', 'Clear'))) return;
    store.commit('Clear tiles', (project) => {
      for (const index of regionTiles()) {
        state.tiles[index].fill(0);
        tilesetAt(project, state.tilesetId)[state.table].tiles[index] = BLANK_TILE;
      }
    });
    renderAll();
  }

  // ----------------------------------------------------------------- DOM

  const sheetBuffer = document.createElement('canvas');
  const sheetCanvas = el('canvas.sheet');
  const sheetContext = sheetCanvas.getContext('2d');
  const editorCanvas = el('canvas.pixels');
  const overlay = el('canvas', {
    style: { position: 'absolute', inset: '0', pointerEvents: 'none' }
  });
  const editStage = el(
    'div.canvas-stage',
    null,
    el('div', { style: { position: 'relative', lineHeight: '0' } }, editorCanvas, overlay)
  );
  const editorInfo = el('span.status-meta');
  const cursorInfo = el('span.status-meta');
  const paletteList = el('div');
  const picker = el('div.color-picker');
  const pickerLabel = el('p.hint');
  const stats = el('div');

  sheetCanvas.addEventListener('pointerdown', (event) => {
    const rect = sheetCanvas.getBoundingClientRect();
    const cell = (8 * state.sheetZoom * rect.width) / sheetCanvas.width;
    const col = Math.max(0, Math.min(SHEET_COLS - 1, Math.floor((event.clientX - rect.left) / cell)));
    const row = Math.max(0, Math.min(SHEET_ROWS - 1, Math.floor((event.clientY - rect.top) / cell)));
    state.selected = row * SHEET_COLS + col;
    renderSheet();
    renderEditor();
  });

  editorCanvas.addEventListener('pointerdown', onPointerDown);
  editorCanvas.addEventListener('pointermove', onPointerMove);
  editorCanvas.addEventListener('pointerup', onPointerUp);
  editorCanvas.addEventListener('pointercancel', onPointerUp);
  editorCanvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function toolButton(id, label, title) {
    return el(
      'button.btn.btn-sm',
      {
        class: state.tool === id ? 'active' : '',
        title,
        dataset: { tool: id },
        onclick: () => {
          state.tool = id;
          root.querySelectorAll('[data-tool]').forEach((button) => {
            button.classList.toggle('active', button.dataset.tool === id);
          });
        }
      },
      label
    );
  }

  function tableTab(id, label) {
    return el(
      'button.tab',
      {
        class: state.table === id ? 'active' : '',
        dataset: { table: id },
        onclick: () => {
          state.table = id;
          state.activePalette = 0;
          root.querySelectorAll('[data-table]').forEach((button) => {
            button.classList.toggle('active', button.dataset.table === id);
          });
          syncFromStore();
          renderAll();
        }
      },
      label
    );
  }

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '286px 1fr 268px' } },
    el(
      'div.panel',
      null,
      el('div.tabs', null, tableTab('background', 'Background'), tableTab('sprites', 'Sprites')),
      el(
        'div.panel-body.tight',
        null,
        el('div.sheet-wrap', null, sheetCanvas),
        el(
          'div.field-row',
          { style: { marginTop: '10px' } },
          el('span.field-label', null, 'Zoom'),
          el('input', {
            type: 'range',
            min: 1,
            max: 4,
            value: state.sheetZoom,
            oninput: (event) => {
              state.sheetZoom = Number(event.target.value);
              renderSheet();
            }
          })
        ),
        stats
      )
    ),
    el(
      'div.panel',
      { style: { borderRight: 'none' } },
      el(
        'div.toolbar',
        null,
        toolButton('pencil', '✏ Pencil', 'Draw pixels (right-click draws slot 0)'),
        toolButton('fill', '🪣 Fill', 'Flood fill'),
        toolButton('eyedropper', '💧 Pick', 'Pick a palette slot from the canvas'),
        el('span.sep'),
        el('span.field-label', null, 'Region'),
        ...[1, 2, 4].map((size) =>
          el(
            'button.btn.btn-sm',
            {
              class: state.regionSize === size ? 'active' : '',
              dataset: { region: size },
              title: `Edit ${size}x${size} tiles (${size * 8}x${size * 8} pixels)`,
              onclick: () => {
                state.regionSize = size;
                root.querySelectorAll('[data-region]').forEach((button) => {
                  button.classList.toggle('active', Number(button.dataset.region) === size);
                });
                renderSheet();
                renderEditor();
              }
            },
            `${size}×${size}`
          )
        ),
        el('span.sep'),
        el('button.btn.btn-sm', { onclick: () => transformRegion('Flip horizontally', flipHorizontal) }, '↔ Flip'),
        el('button.btn.btn-sm', { onclick: () => transformRegion('Flip vertically', flipVertical) }, '↕ Flip'),
        el('button.btn.btn-sm', { onclick: clearRegion }, '⌫ Clear'),
        el('span.spacer'),
        editorInfo,
        el('span.sep'),
        cursorInfo
      ),
      editStage
    ),
    el(
      'div.panel',
      null,
      el('div.panel-head', null, 'Palettes'),
      el(
        'div.panel-body',
        null,
        paletteList,
        pickerLabel,
        picker,
        el(
          'p.hint',
          { style: { marginTop: '10px' } },
          'Slot 0 is the shared backdrop colour — changing it updates every palette. ',
          'Sprites treat slot 0 as transparent.'
        ),
        el('div.field-label', { style: { marginTop: '16px' } }, 'Import'),
        el(
          'div.button-row',
          null,
          el('button.btn.btn-sm', { onclick: () => openImportDialog(app, state, syncFromStore, renderAll) }, '🖼 Image…'),
          el('button.btn.btn-sm', { onclick: importChr }, 'CHR'),
          el('button.btn.btn-sm', { onclick: importPal }, 'PAL')
        ),
        el('div.field-label', { style: { marginTop: '12px' } }, 'Export'),
        el(
          'div.button-row',
          null,
          el('button.btn.btn-sm', { onclick: exportChr }, 'CHR'),
          el('button.btn.btn-sm', { onclick: exportPal }, 'PAL')
        )
      )
    )
  );

  container.append(root);
  syncFromStore();
  renderAll();
  const stopWatchingStage = observeSize(editStage, renderEditor);
  app.setMeta('Tile Forge');

  return {
    destroy() {
      stopWatchingStage();
      app.setMeta('');
    },
    onProjectChange() {
      syncFromStore();
      renderAll();
    }
  };
}
