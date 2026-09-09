// Tile Forge — draw the 8x8 tiles the whole game is built from.
//
// Ports the TileForge pixel editor (codex_img_to_nes) onto the project's two
// 256-entry pattern tables. Editing works on a region of 1x1, 2x2 or 4x4 tiles
// so 16x16 and 32x32 characters can be drawn as one picture.

import { store } from '../../store.js';
import {
  el,
  clear,
  fill,
  toast,
  canvasPoint,
  line,
  confirmModal,
  promptModal,
  showModal,
  pixelCanvas,
  fitZoom,
  observeSize
} from '../../ui.js';
import { tileFromString, tileToString, encodeTiles, decodeChr, flipTile, BLANK_TILE } from '../../../shared/chr.js';
import { NES_PALETTE, cssColor, colorLabel, isUnsafeColor } from '../../../shared/nespalette.js';
import {
  LIMITS,
  tilesetAt,
  createTileset,
  PLAYER_TILES,
  DIRECTION_ORDER,
  QUADRANT_ORDER,
  PART_FRAME_SLOTS,
  storageIndex,
  renumberPlayerPartDeletion,
  chrImportOverlap,
  planPlayerSprite,
  generatePlayerSpriteCore,
  metaspriteTileCollisions,
  spriteReservedRanges,
  describePlayerSpritePlan
} from '../../../shared/project.js';
import { resolveMapper, tilesetLimit } from '../../../shared/cartridge.js';
import {
  FONT_BASE,
  HEART_FULL_TILE,
  SPRITE_ARROW_TILE,
  fontBankSplit,
  fontChrPages,
  projectUsesText
} from '../../../shared/font.js';
import { reservedRangeRects } from '../../widgets/sheetgeom.js';
import { openImportDialog } from './import.js';
import { openLibraryImportDialog } from './librarytile.js';

const SHEET_COLS = 16;
const SHEET_ROWS = LIMITS.tilesPerTable / SHEET_COLS;

/**
 * A real mouse/touch pointerdown always has a capturable pointer, but a
 * synthetically dispatched PointerEvent (browser automation, some
 * accessibility tooling) does not, and `setPointerCapture` throws
 * `NotFoundError` for one -- uncaught, that crashes the whole Forge mid-
 * drag. Losing capture only means a drag that leaves the canvas stops
 * tracking; the ordinary pointerup on the canvas itself still ends it. Same
 * shape as `trySetPointerCapture` in `renderer/forges/map/map.js`.
 */
function trySetPointerCapture(canvas, event) {
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Best-effort only -- see the comment above.
  }
}

export function mount(container, app) {
  const state = {
    // Which tileset (CHR bank) is open, and which of its two tables. Only
    // meaningful in 'tileset' mode -- 'player' mode reads/writes
    // project.sprites.playerTiles/playerParts directly, which are neither
    // tileset- nor table-scoped (design-modular-parts.md §6.2).
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
    clipboard: null,
    // Not a third `state.table` value (design-modular-parts.md §6.2:
    // tilesetAt(...)[state.table] assumes a per-tileset property, and
    // neither playerParts nor playerTiles is one) -- a separate mode
    // switched by its own third tab, alongside Background/Sprites.
    mode: 'tileset', // 'tileset' | 'player'
    playerView: 'frames', // 'frames' | 'parts'
    playerFrame: 0, // which of the 8 View-1 frames is highlighted as active
    playerPaint: null // in-progress drag: { lastPoint, slot, paint(x, y, slot) }
  };
  // A cross-link from the Character Forge (app.goTo('tile', { mode: 'player' })).
  // Set before the first render, matching sprite.js's own consumeContext
  // placement, so the Tile Forge lands directly on the Player view rather
  // than flashing whatever tab/mode it was last in.
  const context = app.consumeContext();
  if (context?.mode === 'player') state.mode = 'player';

  // ------------------------------------------------------------- helpers

  // Player art is always sprite-shaped, in either mode -- the player's own
  // compiled sprite is what View 1/View 2 edit, so the shared Palettes panel
  // (activePalette/activeSlot) follows sprite palettes and transparent slot 0
  // the moment Player mode is open, regardless of which tileset tab was last
  // showing. This is the single place that decision is made -- every read
  // (paletteSet/transparentZero) and every write (setColor, importPal,
  // exportPal) goes through it, so a palette edit made while Player is open
  // can never land on the wrong table's palette.
  const paletteKind = () => (state.mode === 'player' || state.table === 'sprites' ? 'sprite' : 'bg');
  const paletteSet = () => store.project.palettes[paletteKind()];
  const palette = () => paletteSet()[state.activePalette];
  const transparentZero = () => state.mode === 'player' || state.table === 'sprites';
  // Only the background table loses tiles to the font, only while something in
  // the project actually puts text on screen — and never on a scanline-IRQ
  // board, where the font rides in its own CHR bank and every tile stays yours.
  const fontReserved = () =>
    state.table === 'background' &&
    projectUsesText(store.project) &&
    !fontBankSplit(store.project, resolveMapper(store.project.cartridge.mapper));
  // Unconditional, unlike fontReserved above: every game has a player, so the
  // stamp always lands here at build time (design-modular-parts.md §3.2/§6.2)
  // -- simpler than fontReserved's own conditional predicate, deliberately.
  const playerReserved = () => state.table === 'sprites';

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

    // Reserved-range shading (design-draw-validation.md §3.4/§6.3): a
    // table-specific range list, built from the identical playerReserved()/
    // fontReserved() gates the two predicates above already use, never a
    // fresh state.table comparison of its own -- so a background sheet can
    // never be handed a sprite-only reservation (the player, the HUD hearts,
    // the battle cursor) and a sprite sheet never the background-only font
    // band. validateProject refuses artwork in these same ranges from the
    // same predicates.
    const reservedRanges = playerReserved()
      ? spriteReservedRanges(store.project, resolveMapper(store.project.cartridge.mapper))
      : fontReserved()
        ? [{ start: FONT_BASE, end: LIMITS.tilesPerTable, label: 'the message font' }]
        : [];
    for (const range of reservedRanges) {
      for (const rect of reservedRangeRects(range.start, range.end, SHEET_COLS)) {
        const x = rect.col * cell;
        const y = rect.row * cell;
        const w = rect.cols * cell;
        const h = rect.rows * cell;
        sheetContext.fillStyle = 'rgba(255, 157, 60, 0.16)';
        sheetContext.fillRect(x, y, w, h);
        sheetContext.strokeStyle = 'rgba(255, 157, 60, 0.7)';
        sheetContext.lineWidth = 1;
        sheetContext.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
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
            redrawActive();
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
              redrawActive();
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
    const kind = paletteKind();
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
      playerReserved()
        ? el(
            'p.hint',
            { style: { color: 'var(--accent)' } },
            `Tiles $00–$${(PLAYER_TILES - 1).toString(16).toUpperCase().padStart(2, '0')} are reserved for the player ` +
              'character and are replaced at build time; edit them from the Player view instead.'
          )
        : null,
      // One more hint per non-player sprite range this project currently
      // reserves (design-draw-validation.md §6.3) -- never on the background
      // table, since playerReserved() gates it exactly as the shading above
      // does.
      playerReserved()
        ? spriteReservedRanges(store.project, resolveMapper(store.project.cartridge.mapper))
            .slice(1)
            .map((range) =>
              el(
                'p.hint',
                { style: { color: 'var(--accent)' } },
                range.label === 'the HUD hearts'
                  ? `Tiles $${HEART_FULL_TILE.toString(16).toUpperCase()}–$FF are shaded because this project can hurt ` +
                    'the player: the HUD hearts are stamped over them when the ROM is built.'
                  : `Tile $${SPRITE_ARROW_TILE.toString(16).toUpperCase()} is shaded because this project’s battle ` +
                    'system reserves it for the targeting cursor, stamped over it when the ROM is built.'
              )
            )
        : null,
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
    tilesetLeftBody.hidden = state.mode !== 'tileset';
    playerLeftHint.hidden = state.mode !== 'player';
    tilesetMiddleBody.hidden = state.mode !== 'tileset';
    playerViewBody.hidden = state.mode !== 'player';
    importSection.hidden = state.mode !== 'tileset';
    exportSection.hidden = state.mode !== 'tileset';
    if (state.mode === 'tileset') {
      renderSheet();
      renderEditor();
      renderStats();
    } else {
      renderPlayerPanel();
    }
    renderPalettes();
    updateTabs();
  }

  // Redraws whichever mode is actually showing, without touching visibility,
  // tabs or stats -- for a change that only affects what the picture looks
  // like (the active palette/slot), never which data exists (F1). Tileset
  // mode's own canvases have no persistent "redraw" handle of their own the
  // way the Player panel's cells/rows do, so this calls the same pair
  // renderAll() does for that branch.
  function redrawActive() {
    if (state.mode === 'tileset') {
      renderSheet();
      renderEditor();
    } else {
      redrawPlayerCanvases();
    }
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
    // Raw CHR import overwrites a contiguous run unconditionally, unlike the
    // image-import path's own free-slot exclusion (design-modular-parts.md
    // §4.1) -- there is no "free slot" concept here to exclude from, so the
    // fix is a confirmation naming the overlap rather than a silent skip. A
    // background-table import never touches the player's reserved range and
    // never prompts.
    if (state.table === 'sprites') {
      const overlap = chrImportOverlap(start, count);
      if (overlap > 0) {
        const confirmed = await confirmModal(
          'Import CHR',
          `${overlap} of these tiles fall inside the player's reserved range ($00-$1F). The next build ` +
            'will replace them with the generated player regardless of what this import writes.',
          'Import anyway'
        );
        if (!confirmed) return;
      }
    }
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
    if (!result.ok) return toast(result.error, 'error');
    if (result.value) toast(`Wrote ${bytes.length} bytes`, 'success');
  }

  async function importPal() {
    const result = await window.forge.files.readBinary([{ name: 'NES palette', extensions: ['pal', 'bin'] }]);
    if (!result.ok) return toast(result.error, 'error');
    if (!result.value) return;
    const bytes = new Uint8Array(result.value.data);
    if (bytes.length < 4) return toast('Palette files need at least four bytes.', 'error');
    const kind = paletteKind();
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
    if (!result.ok) return toast(result.error, 'error');
    if (result.value) toast('Palette written', 'success');
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
        class: state.mode === 'tileset' && state.table === id ? 'active' : '',
        dataset: { tab: id },
        onclick: () => {
          state.mode = 'tileset';
          state.table = id;
          state.activePalette = 0;
          syncFromStore();
          renderAll();
        }
      },
      label
    );
  }

  function playerModeTab() {
    return el(
      'button.tab',
      {
        class: state.mode === 'player' ? 'active' : '',
        dataset: { tab: 'player' },
        onclick: () => {
          state.mode = 'player';
          renderAll();
        }
      },
      'Player'
    );
  }

  function updateTabs() {
    root.querySelectorAll('[data-tab]').forEach((button) => {
      const id = button.dataset.tab;
      const active = id === 'player' ? state.mode === 'player' : state.mode === 'tileset' && state.table === id;
      button.classList.toggle('active', active);
    });
  }

  // ------------------------------------------------------- Player view (§6.2)
  //
  // Two real, separately-sourced views (design-modular-parts.md §6.2), never a
  // third `state.table` entry: View 1 reads/writes `project.sprites.playerTiles`
  // directly via the new `storageIndex` mapping (§1.5), never `regionTiles()`/
  // `writeTile()`/`writeRegion()`, which assume the sheet's mismatched
  // 16-column grid. View 2 reads/writes `project.sprites.playerParts`. Neither
  // needs `state.tilesetId` -- both arrays are project-level, not per-tileset.

  /** One of the 8 always-visible, always-paintable 16x16 frame canvases. */
  function createPlayerFrameCell(frame) {
    const direction = Math.floor(frame / 2);
    const frameIndex = frame % 2;
    const canvas = el('canvas.pixels');
    const marker = el('span.player-frame-marker', { hidden: true }, 'not generated');
    const stage = el('div.player-canvas-box', null, el('div', null, canvas, marker));
    const node = el(
      'div.player-frame-cell',
      null,
      el('div.field-label', null, `${DIRECTION_ORDER[direction]} ${frameIndex + 1}`),
      stage
    );

    const rawTile = (row, col) => store.project.sprites.playerTiles[storageIndex(frame, row, col)];
    const pixelsAt = (x, y) => tileFromString(rawTile(Math.floor(y / 8), Math.floor(x / 8)) ?? BLANK_TILE);
    function paintPixel(x, y, slot) {
      const index = storageIndex(frame, Math.floor(y / 8), Math.floor(x / 8));
      const pixels = tileFromString(store.project.sprites.playerTiles[index] ?? BLANK_TILE);
      pixels[(y % 8) * 8 + (x % 8)] = slot;
      // A dedicated mutation, never writeTile()/writeRegion() (design-modular-
      // parts.md §6.2) -- those are hard-wired to tilesetAt(...)[state.table].
      store.project.sprites.playerTiles[index] = tileToString(pixels);
    }

    function redraw() {
      const zoom = fitZoom(stage, 16, 16, { min: 3, max: 16 });
      canvas.width = 16;
      canvas.height = 16;
      canvas.style.width = `${16 * zoom}px`;
      canvas.style.height = `${16 * zoom}px`;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      const image = context.createImageData(16, 16);
      paintImageData(image, (x, y) => pixelsAt(x, y)[(y % 8) * 8 + (x % 8)], 16, 16);
      context.putImageData(image, 0, 0);
      const missing = [0, 1].some((row) => [0, 1].some((col) => rawTile(row, col) === null));
      marker.hidden = !missing;
      node.classList.toggle('active', frame === state.playerFrame);
    }

    function beginPaint(event) {
      if (event.button > 2) return;
      event.preventDefault();
      state.playerFrame = frame;
      const point = canvasPoint(event, canvas, 16, 16);
      const slot = event.button === 2 ? 0 : state.activeSlot;
      store.beginStroke('Edit player tile');
      paintPixel(point.x, point.y, slot);
      state.playerPaint = { lastPoint: point, slot, paint: paintPixel };
      redraw();
      trySetPointerCapture(canvas, event);
    }
    function movePaint(event) {
      if (!state.playerPaint || state.playerPaint.paint !== paintPixel) return;
      const point = canvasPoint(event, canvas, 16, 16);
      line(state.playerPaint.lastPoint, point, (x, y) => paintPixel(x, y, state.playerPaint.slot));
      state.playerPaint.lastPoint = point;
      redraw();
    }
    function endPaint() {
      if (!state.playerPaint || state.playerPaint.paint !== paintPixel) return;
      store.endStroke();
      state.playerPaint = null;
    }

    canvas.addEventListener('pointerdown', beginPaint);
    canvas.addEventListener('pointermove', movePaint);
    canvas.addEventListener('pointerup', endPaint);
    canvas.addEventListener('pointercancel', endPaint);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    // No observeSize() of its own: one shared observer on playerViewBody
    // (below, beside stopWatchingStage) redraws every mounted cell/row, so
    // opening the Player tab constructs exactly one more ResizeObserver for
    // the whole panel rather than one per cell -- main/smoke.js's own
    // token-check probe pins Tile Forge's mount() to a fixed observer count.
    return { node, redraw };
  }

  const playerFrameCells = Array.from({ length: PLAYER_TILES / 4 }, (_, frame) => createPlayerFrameCell(frame));
  const playerFramesGrid = el('div.player-frames-grid', null, ...playerFrameCells.map((cell) => cell.node));

  function renderPlayerFrames() {
    playerFrameCells.forEach((cell) => cell.redraw());
    const empty = store.project.sprites.playerParts.length === 0;
    generatePlayerSpriteButton.disabled = empty;
    generatePlayerSpriteButton.title = empty
      ? 'Add at least one part in the Parts tab first.'
      : 'Open the Generate Player Sprite dialog';
    generatePlayerSpriteHint.hidden = !empty;
  }

  /**
   * The Generate Player Sprite modal (design-modular-parts.md §6.3, ROADMAP
   * item 8 phase 3). Captures store.revision before opening (the
   * openPaletteSwapModal idiom, sprite.js's own openPaletteSwapModal) and
   * refuses on ANY intervening change once the modal resolves, not merely a
   * change to something this modal happened to touch. Commits at most once,
   * through generatePlayerSpriteCore -- the same pure core planPlayerSprite
   * already previews live, so what this modal shows is exactly what it
   * writes.
   */
  async function openGeneratePlayerSpriteModal() {
    if (store.project.sprites.playerParts.length === 0) return;
    const revisionAtOpen = store.revision;

    const pickKey = (direction, frameIndex, quadrant) => `${direction}|${frameIndex}|${quadrant}`;
    const NONE = null;

    // Every part whose direction/frameSlot qualify it for this frame --
    // deliberately not filtered by the part's own `quadrant` tag (§6.3: "one
    // per quadrant -- populated with every part whose direction matches and
    // whose frameSlot is that column's frame index or 'both'"). A part's own
    // `quadrant` field is descriptive for the parts library, not a placement
    // restriction the modal enforces.
    function qualifyingParts(direction, frameIndex) {
      return store.project.sprites.playerParts.filter(
        (candidate) => candidate.direction === direction && (candidate.frameSlot === String(frameIndex) || candidate.frameSlot === 'both')
      );
    }

    // Each quadrant selector's own default is the FIRST qualifying part
    // (same direction/frameSlot rule as qualifyingParts above) whose own
    // `quadrant` tag equals that selector's quadrant, in library order --
    // the part's tag is what a fully-tagged library uses to say which of
    // its 4 pieces belongs where, so the default should follow it. Falls
    // back to "(none)" when no qualifying part carries that tag, even if
    // other qualifying parts exist for a different quadrant of this same
    // frame -- ungating the option list (below) is what still lets an
    // author pick one of those anyway.
    function tagMatchingPart(options, quadrant) {
      return options.find((candidate) => candidate.quadrant === quadrant) ?? null;
    }
    const picks = {};
    for (const direction of DIRECTION_ORDER) {
      for (const frameIndex of [0, 1]) {
        const options = qualifyingParts(direction, frameIndex);
        for (const quadrant of QUADRANT_ORDER) {
          const tagMatch = tagMatchingPart(options, quadrant);
          picks[pickKey(direction, frameIndex, quadrant)] = tagMatch ? tagMatch.id : NONE;
        }
      }
    }

    function currentPicks() {
      const list = [];
      for (const direction of DIRECTION_ORDER) {
        for (const frameIndex of [0, 1]) {
          for (const quadrant of QUADRANT_ORDER) {
            const partId = picks[pickKey(direction, frameIndex, quadrant)];
            if (partId !== NONE) list.push({ direction, frameIndex, quadrant, partId });
          }
        }
      }
      return list;
    }

    // "disambiguate duplicates by index" (brief): only parts sharing another
    // qualifying part's own name in this same selector's option list get the
    // "(#id)" suffix -- an unambiguous name stays plain.
    function partOptionLabel(options, candidate) {
      const sharesName = options.filter((entry) => entry.name === candidate.name).length > 1;
      return sharesName ? `${candidate.name} (#${candidate.id})` : candidate.name;
    }

    function previewPixelAt(direction, frameIndex, x, y) {
      const quadrant = QUADRANT_ORDER[Math.floor(y / 8) * 2 + Math.floor(x / 8)];
      const partId = picks[pickKey(direction, frameIndex, quadrant)];
      if (partId === NONE) return 0;
      const partEntry = store.project.sprites.playerParts.find((candidate) => candidate.id === partId);
      if (!partEntry) return 0;
      return tileFromString(partEntry.tile)[(y % 8) * 8 + (x % 8)];
    }

    function drawPreview(direction, frameIndex, canvas, context) {
      const image = context.createImageData(16, 16);
      paintImageData(image, (x, y) => previewPixelAt(direction, frameIndex, x, y), 16, 16);
      context.putImageData(image, 0, 0);
    }

    let closeModal = () => {};
    const rowsHost = el('div');
    const summaryHost = el('div', { style: { marginTop: '10px' } });
    const cancelButton = el('button.btn', { onclick: () => closeModal(null) }, 'Cancel');
    const generateButton = el('button.btn.btn-accent', { onclick: () => closeModal(currentPicks()) }, 'Generate');

    function frameStatusText(direction, frameIndex, plan) {
      const pickedCount = QUADRANT_ORDER.filter((quadrant) => picks[pickKey(direction, frameIndex, quadrant)] !== NONE).length;
      if (pickedCount === 0) return 'Left as is — no parts picked.';
      if (plan.written.some((entry) => entry.direction === direction && entry.frameIndex === frameIndex)) {
        return 'Will be generated.';
      }
      const skippedEntry = plan.skipped.find((entry) => entry.direction === direction && entry.frameIndex === frameIndex);
      const missing = skippedEntry?.quadrants?.length ? skippedEntry.quadrants.join(', ') : 'one or more quadrants';
      return `Incomplete — missing ${missing}.`;
    }

    function frameColumn(direction, frameIndex, plan) {
      const { canvas, context } = pixelCanvas(16, 16, 6);
      drawPreview(direction, frameIndex, canvas, context);
      canvas.dataset.direction = direction;
      canvas.dataset.frameIndex = String(frameIndex);
      const status = el('p.hint', null, frameStatusText(direction, frameIndex, plan));
      const complete = plan.written.some((entry) => entry.direction === direction && entry.frameIndex === frameIndex);
      const selects = QUADRANT_ORDER.map((quadrant) => {
        const options = qualifyingParts(direction, frameIndex);
        // The option list itself stays unfiltered (§6.3's literal wording --
        // the core permits any qualifying part in any quadrant), but a
        // tag-matching part is listed first, each of the two groups in its
        // own library order, so the obvious choice is easy to find even
        // though nothing stops picking a differently-tagged part instead.
        const tagMatching = options.filter((candidate) => candidate.quadrant === quadrant);
        const rest = options.filter((candidate) => candidate.quadrant !== quadrant);
        const orderedOptions = [...tagMatching, ...rest];
        const value = picks[pickKey(direction, frameIndex, quadrant)];
        return el(
          'div.field',
          null,
          el('span.field-label', null, quadrant),
          el(
            'select',
            {
              dataset: { direction, frameIndex: String(frameIndex), quadrant },
              onchange: (event) => {
                const raw = event.target.value;
                picks[pickKey(direction, frameIndex, quadrant)] = raw === '' ? NONE : Number(raw);
                render();
              }
            },
            [
              el('option', { value: '', selected: value === NONE }, '(none)'),
              orderedOptions.map((option) =>
                el(
                  'option',
                  { value: String(option.id), selected: option.id === value },
                  partOptionLabel(options, option)
                )
              )
            ]
          )
        );
      });
      return el(
        'div.player-generate-frame',
        { class: complete ? 'complete' : null, dataset: { direction, frameIndex: String(frameIndex) } },
        el('div.field-label', null, `Frame ${frameIndex + 1}`),
        canvas,
        status,
        ...selects
      );
    }

    function render() {
      const plan = planPlayerSprite(store.project, currentPicks());
      const collisions = metaspriteTileCollisions(store.project, plan.indices);
      const described = describePlayerSpritePlan(store.project, plan, collisions);

      fill(
        rowsHost,
        DIRECTION_ORDER.map((direction) =>
          el(
            'div.player-generate-row',
            null,
            el('div.field-label', null, direction),
            el('div.player-generate-columns', null, frameColumn(direction, 0, plan), frameColumn(direction, 1, plan))
          )
        )
      );

      fill(
        summaryHost,
        el('p.player-generate-changes', null, described.changes),
        described.placeholder ? el('p.hint.player-generate-placeholder', null, described.placeholder) : null,
        described.collisions
          ? el('p.hint.player-generate-collisions', { style: { color: 'var(--accent)' } }, described.collisions)
          : null
      );

      generateButton.disabled = plan.written.length === 0;
      generateButton.title = plan.written.length === 0 ? 'Nothing is complete enough to generate yet.' : 'Generate';
    }

    render();

    const picksResult = await showModal({
      title: 'Generate Player Sprite',
      width: 640,
      body: (close) => {
        closeModal = close;
        return el(
          'div.player-generate-modal',
          { style: { minWidth: '600px' } },
          rowsHost,
          summaryHost,
          el(
            'div.field-row',
            { style: { justifyContent: 'flex-end', gap: '8px', marginTop: '14px' } },
            cancelButton,
            generateButton
          )
        );
      },
      actions: []
    });

    if (!picksResult) return;

    if (store.revision !== revisionAtOpen) {
      toast('The project changed while this dialog was open — try again.', 'error');
      return;
    }

    const finalPlan = planPlayerSprite(store.project, picksResult);
    if (finalPlan.written.length === 0) return;
    const finalCollisions = metaspriteTileCollisions(store.project, finalPlan.indices);
    const described = describePlayerSpritePlan(store.project, finalPlan, finalCollisions);

    store.commit('Generate player sprite', (project) => generatePlayerSpriteCore(project, picksResult));
    toast(described.toast, 'success');
    renderPlayerFrames();
  }

  /** One player-part row: its fields plus its own single-tile 8x8 canvas. */
  function createPlayerPartRow(part) {
    const canvas = el('canvas.pixels');
    const stage = el('div.player-canvas-box', null, el('div', null, canvas));

    const current = () => store.project.sprites.playerParts.find((entry) => entry.id === part.id) ?? part;
    function paintPixel(x, y, slot) {
      const target = current();
      const pixels = tileFromString(target.tile);
      pixels[y * 8 + x] = slot;
      target.tile = tileToString(pixels);
    }
    function redraw() {
      const zoom = fitZoom(stage, 8, 8, { min: 4, max: 16 });
      canvas.width = 8;
      canvas.height = 8;
      canvas.style.width = `${8 * zoom}px`;
      canvas.style.height = `${8 * zoom}px`;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      const pixels = tileFromString(current().tile);
      const image = context.createImageData(8, 8);
      paintImageData(image, (x, y) => pixels[y * 8 + x], 8, 8);
      context.putImageData(image, 0, 0);
    }
    function beginPaint(event) {
      if (event.button > 2) return;
      event.preventDefault();
      const point = canvasPoint(event, canvas, 8, 8);
      const slot = event.button === 2 ? 0 : state.activeSlot;
      store.beginStroke('Edit part tile');
      paintPixel(point.x, point.y, slot);
      state.playerPaint = { lastPoint: point, slot, paint: paintPixel };
      redraw();
      trySetPointerCapture(canvas, event);
    }
    function movePaint(event) {
      if (!state.playerPaint || state.playerPaint.paint !== paintPixel) return;
      const point = canvasPoint(event, canvas, 8, 8);
      line(state.playerPaint.lastPoint, point, (x, y) => paintPixel(x, y, state.playerPaint.slot));
      state.playerPaint.lastPoint = point;
      redraw();
    }
    function endPaint() {
      if (!state.playerPaint || state.playerPaint.paint !== paintPixel) return;
      store.endStroke();
      state.playerPaint = null;
    }
    canvas.addEventListener('pointerdown', beginPaint);
    canvas.addEventListener('pointermove', movePaint);
    canvas.addEventListener('pointerup', endPaint);
    canvas.addEventListener('pointercancel', endPaint);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    // No observeSize() of its own -- see createPlayerFrameCell's own comment.

    const enumSelect = (options, value, onChange) =>
      el(
        'select',
        { onchange: (event) => onChange(event.target.value) },
        options.map((option) => el('option', { value: option, selected: option === value }, option))
      );

    const node = el(
      'div.player-part-row',
      { dataset: { partId: String(part.id) } },
      stage,
      el('div.player-part-fields', null,
        el('input', {
          type: 'text',
          value: part.name,
          title: 'Part name',
          dataset: { partField: 'name' },
          onchange: (event) => updatePlayerPart(part.id, 'Rename player part', (entry) => applyPartName(entry, event.target.value))
        }),
        el('input', {
          type: 'text',
          value: part.category,
          placeholder: 'Category',
          dataset: { partField: 'category' },
          onchange: (event) => updatePlayerPart(part.id, 'Set player part category', (entry) => applyPartCategory(entry, event.target.value))
        }),
        enumSelect(DIRECTION_ORDER, part.direction, (value) =>
          updatePlayerPart(part.id, 'Set player part direction', (entry) => (entry.direction = value))
        ),
        enumSelect(PART_FRAME_SLOTS, part.frameSlot, (value) =>
          updatePlayerPart(part.id, 'Set player part frame', (entry) => (entry.frameSlot = value))
        ),
        enumSelect(QUADRANT_ORDER, part.quadrant, (value) =>
          updatePlayerPart(part.id, 'Set player part quadrant', (entry) => (entry.quadrant = value))
        )
      ),
      el(
        'button.btn.btn-icon',
        {
          title: 'Delete this part',
          onclick: async () => {
            const target = part;
            if (!(await confirmModal('Delete part', `Delete "${target.name}"?`, 'Delete'))) return;
            const index = store.project.sprites.playerParts.indexOf(target);
            if (index === -1) {
              toast('The project changed while that confirmation was open — nothing was deleted. Try again.', 'error');
              rebuildPlayerParts();
              return;
            }
            store.commit('Delete player part', (project) => renumberPlayerPartDeletion(project, index));
            rebuildPlayerParts();
          }
        },
        '×'
      )
    );

    return { node, redraw };
  }

  // Shared by a part row's own onchange handlers and flushPendingEdits()
  // below (F5), so a value committed at blur and one flushed ahead of a
  // save apply the identical trim/fallback rule under the identical undo
  // label -- never two slightly different ideas of what "renaming a part"
  // means.
  const applyPartName = (entry, rawValue) => {
    entry.name = rawValue.trim() || `Part ${entry.id}`;
  };
  const applyPartCategory = (entry, rawValue) => {
    entry.category = rawValue;
  };

  function updatePlayerPart(partId, label, mutate) {
    store.commit(label, (project) => {
      const target = project.sprites.playerParts.find((entry) => entry.id === partId);
      if (target) mutate(target);
    });
    rebuildPlayerParts();
  }

  /**
   * A part row's name/category inputs commit on blur (`change`), same as
   * every other free-text field in this Forge -- deliberately not per
   * keystroke, or the undo stack would fill with one entry per character.
   * But `saveProject()` (`renderer/app.js`) calls this *before* reading
   * `store.project`, specifically so a save while still focused inside one
   * of these inputs writes what's on screen, not the last blurred value --
   * matching the Code Forge's own `flushPendingEdits` precedent
   * (`renderer/forges/code/code.js`). Reading `document.activeElement`
   * rather than tracking "the currently open row" separately is what keeps
   * this correct across a rebuild: rebuildPlayerParts() replaces every row's
   * DOM on almost every edit, so any handle to "the row being edited" kept
   * here would already be stale by the time a flush needs it.
   */
  function flushPendingEdits() {
    const active = document.activeElement;
    const field = active?.dataset?.partField;
    if (!field) return;
    const row = active.closest('.player-part-row');
    const partId = row ? Number(row.dataset.partId) : NaN;
    if (Number.isNaN(partId)) return;
    const current = store.project.sprites.playerParts.find((entry) => entry.id === partId);
    if (!current) return;
    if (field === 'name') {
      const next = active.value.trim() || `Part ${partId}`;
      if (next !== current.name) updatePlayerPart(partId, 'Rename player part', (entry) => applyPartName(entry, active.value));
    } else if (field === 'category') {
      if (active.value !== current.category) {
        updatePlayerPart(partId, 'Set player part category', (entry) => applyPartCategory(entry, active.value));
      }
    }
  }

  const playerPartsAddButton = el('button.btn', { onclick: () => addPlayerPart() }, '+ Add part');
  const playerPartsList = el('div.player-parts-list');
  const playerPartsBody = el(
    'div',
    null,
    el(
      'div.field-row',
      { style: { marginBottom: '6px' } },
      el('span.field-label', null, 'Parts'),
      playerPartsAddButton
    ),
    playerPartsList,
    el('p.hint', null, `${LIMITS.playerParts} parts is the ceiling. A part is never tileset-scoped.`)
  );

  function addPlayerPart() {
    if (store.project.sprites.playerParts.length >= LIMITS.playerParts) return;
    store.commit('Add player part', (project) => {
      const id = project.sprites.playerParts.length;
      if (id >= LIMITS.playerParts) return;
      project.sprites.playerParts.push({
        id,
        name: `Part ${id}`,
        category: '',
        direction: 'down',
        frameSlot: 'both',
        quadrant: 'TL',
        tile: BLANK_TILE
      });
    });
    rebuildPlayerParts();
  }

  // Rebuilds the row DOM because the *data* changed (add/delete/field edit,
  // or a project change from elsewhere) -- kept in playerPartRows so
  // redrawPlayerParts() below can redraw those same canvases without
  // rebuilding them. Every existing row is torn down and recreated here
  // (matching this codebase's other list-rebuild Forges), which is why the
  // rebuild must call each new row's own redraw() too -- a freshly created
  // canvas.pixels has no width/height/content until something draws it, and
  // the row that painted a stroke is exactly the row about to be rebuilt out
  // from under itself the moment its own edit reaches the store (F2).
  let playerPartRows = [];
  function rebuildPlayerParts() {
    const parts = store.project.sprites.playerParts;
    playerPartRows = parts.map((part) => createPlayerPartRow(part));
    fill(playerPartsList, ...playerPartRows.map((row) => row.node));
    playerPartRows.forEach((row) => row.redraw());
    const atLimit = parts.length >= LIMITS.playerParts;
    playerPartsAddButton.disabled = atLimit;
    playerPartsAddButton.title = atLimit ? `${LIMITS.playerParts} parts is the ceiling.` : 'Add a part';
  }

  // Redraws the currently-mounted part rows in place -- no rebuild, so a
  // resize tick can never drop focus from a text input mid-typing (F2).
  function redrawPlayerParts() {
    playerPartRows.forEach((row) => row.redraw());
  }

  function playerViewTab(id, label) {
    return el(
      'button.tab',
      {
        class: state.playerView === id ? 'active' : '',
        dataset: { playerView: id },
        onclick: () => {
          state.playerView = id;
          renderPlayerPanel();
        }
      },
      label
    );
  }

  const generatePlayerSpriteButton = el('button.btn', { onclick: () => openGeneratePlayerSpriteModal() }, 'Generate…');
  const generatePlayerSpriteHint = el(
    'p.hint',
    { hidden: true },
    'Add at least one part in the Parts tab before generating.'
  );
  const playerFramesBody = el(
    'div',
    null,
    el('div.field-row', { style: { marginBottom: '10px' } }, generatePlayerSpriteButton),
    generatePlayerSpriteHint,
    playerFramesGrid
  );
  const playerViewBody = el(
    'div',
    { hidden: true, style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
    el('div.tabs', null, playerViewTab('frames', 'Frames'), playerViewTab('parts', 'Parts')),
    el('div.panel-body.tight', null, playerFramesBody, playerPartsBody)
  );

  // The "data changed" path -- shows the right sub-view and rebuilds it.
  // Never wired to the resize observer directly (F2): a resize is a "redraw
  // what's there," not a "the parts list changed" event, and rebuilding on
  // every tick would tear a part row's text input out from under a typing
  // author. See redrawPlayerCanvases() below for that path.
  function renderPlayerPanel() {
    playerFramesBody.hidden = state.playerView !== 'frames';
    playerPartsBody.hidden = state.playerView !== 'parts';
    playerViewBody.querySelectorAll('[data-player-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.playerView === state.playerView);
    });
    if (state.playerView === 'frames') renderPlayerFrames();
    else rebuildPlayerParts();
  }

  // The "just redraw what's already there" path -- used by the shared
  // ResizeObserver and by a palette change (F1's redrawActive()), neither of
  // which touches which parts exist or which fields they hold.
  function redrawPlayerCanvases() {
    if (state.playerView === 'frames') renderPlayerFrames();
    else redrawPlayerParts();
  }

  const tilesetLeftBody = el(
    'div',
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
  );

  const playerLeftHint = el(
    'div',
    { hidden: true },
    el(
      'p.hint',
      null,
      'Compose the player’s walk cycle out of tagged parts, or hand-edit each frame directly. ' +
        'Nothing here reaches the ROM until Generate Player Sprite lands in a later phase.'
    )
  );

  const tilesetMiddleBody = el(
    'div',
    { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
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
  );

  // Tileset-only: both act on the hidden state.table, so both are hidden in
  // Player mode (F3) rather than left visible and silently acting on
  // whichever tileset tab was last showing.
  const importSection = el(
    'div',
    null,
    el('div.field-label', { style: { marginTop: '16px' } }, 'Import'),
    el(
      'div.button-row',
      null,
      el('button.btn.btn-sm', { onclick: () => openImportDialog(app, state, syncFromStore, renderAll) }, '🖼 Image…'),
      el(
        'button.btn.btn-sm',
        { title: 'Import from library', onclick: () => openLibraryImportDialog(app, state, syncFromStore, renderAll) },
        '📚 Library…'
      ),
      el('button.btn.btn-sm', { onclick: importChr }, 'CHR'),
      el('button.btn.btn-sm', { onclick: importPal }, 'PAL')
    )
  );
  const exportSection = el(
    'div',
    null,
    el('div.field-label', { style: { marginTop: '12px' } }, 'Export'),
    el('div.button-row', null, el('button.btn.btn-sm', { onclick: exportChr }, 'CHR'), el('button.btn.btn-sm', { onclick: exportPal }, 'PAL'))
  );

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '286px 1fr 268px' } },
    el(
      'div.panel',
      null,
      el(
        'div.tabs',
        null,
        tableTab('background', 'Background'),
        tableTab('sprites', 'Sprites'),
        playerModeTab()
      ),
      el('div.panel-body.tight', null, tilesetLeftBody, playerLeftHint)
    ),
    el('div.panel', { style: { borderRight: 'none' } }, tilesetMiddleBody, playerViewBody),
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
        importSection,
        exportSection
      )
    )
  );

  container.append(root);
  syncFromStore();
  renderAll();
  const stopWatchingStage = observeSize(editStage, renderEditor);
  // One shared observer for the whole Player panel (view 1's 8 cells and
  // view 2's part rows all redraw off it) rather than one per cell/row --
  // see createPlayerFrameCell's own comment on why.
  const stopWatchingPlayer = observeSize(playerViewBody, () => {
    if (state.mode === 'player') redrawPlayerCanvases();
  });
  app.setMeta('Tile Forge');

  return {
    destroy() {
      stopWatchingStage();
      stopWatchingPlayer();
      app.setMeta('');
    },
    onProjectChange() {
      syncFromStore();
      renderAll();
    },
    flushPendingEdits
  };
}
