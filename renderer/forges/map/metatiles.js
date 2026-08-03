// Metatile browser and editor: the 16x16 building blocks screens are painted with.

import { store } from '../../store.js';
import { el, fill, field } from '../../ui.js';
import { LIMITS, COLLISION_TYPES, tilesetAt } from '../../../shared/project.js';
import { pickTile } from '../../widgets/tilepicker.js';
import { METATILE_PX } from './render.js';

const BROWSER_COLS = 8;

export function createMetatilePanel({ renderer, getSelected, onSelect, onChange, getTilesetId = () => 0 }) {
  const browser = el('canvas.sheet', { style: { cursor: 'crosshair' } });
  const editorCanvas = el('canvas.pixels', {
    style: { width: '128px', height: '128px', cursor: 'pointer', border: '1px solid var(--line)' },
    width: METATILE_PX,
    height: METATILE_PX
  });
  const quadrantInfo = el('div.hint');
  const details = el('div');
  let zoom = 2;

  function renderBrowser() {
    const rows = Math.ceil(LIMITS.metatiles / BROWSER_COLS);
    const cell = METATILE_PX * zoom;
    browser.width = BROWSER_COLS * cell;
    browser.height = rows * cell;
    const context = browser.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#000';
    context.fillRect(0, 0, browser.width, browser.height);
    for (let id = 0; id < LIMITS.metatiles; id++) {
      renderer.draw(context, id, (id % BROWSER_COLS) * cell, Math.floor(id / BROWSER_COLS) * cell, cell);
    }
    context.strokeStyle = 'rgba(255,255,255,0.10)';
    context.lineWidth = 1;
    context.beginPath();
    for (let col = 1; col < BROWSER_COLS; col++) {
      context.moveTo(col * cell + 0.5, 0);
      context.lineTo(col * cell + 0.5, browser.height);
    }
    for (let row = 1; row < rows; row++) {
      context.moveTo(0, row * cell + 0.5);
      context.lineTo(browser.width, row * cell + 0.5);
    }
    context.stroke();

    const selected = getSelected();
    context.strokeStyle = '#ff9d3c';
    context.lineWidth = 2;
    context.strokeRect(
      (selected % BROWSER_COLS) * cell + 1,
      Math.floor(selected / BROWSER_COLS) * cell + 1,
      cell - 2,
      cell - 2
    );
  }

  async function editQuadrant(quadrant) {
    const metatile = store.project.metatiles[getSelected()];
    const chosen = await pickTile({
      tiles: tilesetAt(store.project, getTilesetId()).background.tiles,
      palette: store.project.palettes.bg[metatile.palette],
      selected: metatile.tiles[quadrant],
      title: `Metatile ${metatile.id} — ${['top-left', 'top-right', 'bottom-left', 'bottom-right'][quadrant]} tile`
    });
    if (chosen === null) return;
    const id = getSelected();
    store.commit('Change metatile tile', (project) => {
      project.metatiles[id].tiles[quadrant] = chosen;
    });
    onChange();
  }

  editorCanvas.addEventListener('pointerdown', (event) => {
    const rect = editorCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    editQuadrant((y < 0.5 ? 0 : 2) + (x < 0.5 ? 0 : 1));
  });

  browser.addEventListener('pointerdown', (event) => {
    const rect = browser.getBoundingClientRect();
    const cell = rect.width / BROWSER_COLS;
    const col = Math.max(0, Math.min(BROWSER_COLS - 1, Math.floor((event.clientX - rect.left) / cell)));
    const row = Math.floor((event.clientY - rect.top) / cell);
    const id = row * BROWSER_COLS + col;
    if (id >= 0 && id < LIMITS.metatiles) {
      onSelect(id);
      render();
    }
  });

  function renderEditor() {
    const metatile = store.project.metatiles[getSelected()];
    const context = editorCanvas.getContext('2d');
    context.clearRect(0, 0, METATILE_PX, METATILE_PX);
    renderer.draw(context, metatile.id, 0, 0, METATILE_PX);
    quadrantInfo.textContent = `Tiles ${metatile.tiles
      .map((tile) => `$${tile.toString(16).padStart(2, '0').toUpperCase()}`)
      .join(' ')} — click a quadrant to change it`;

    fill(details,
      field(
        'Name',
        el('input', {
          type: 'text',
          value: metatile.name,
          onchange: (event) => {
            const id = getSelected();
            const value = event.target.value.trim() || `Metatile ${id}`;
            store.commit('Rename metatile', (project) => {
              project.metatiles[id].name = value;
            });
            onChange();
          }
        })
      ),
      field(
        'Palette',
        el(
          'select',
          {
            onchange: (event) => {
              const id = getSelected();
              const value = Number(event.target.value);
              store.commit('Change metatile palette', (project) => {
                project.metatiles[id].palette = value;
              });
              onChange();
            }
          },
          [0, 1, 2, 3].map((index) =>
            el('option', { value: index, selected: index === metatile.palette }, `Background palette ${index}`)
          )
        )
      ),
      field(
        'Collision',
        el(
          'select',
          {
            onchange: (event) => {
              const id = getSelected();
              const value = event.target.value;
              store.commit('Change metatile collision', (project) => {
                project.metatiles[id].collision = value;
              });
              onChange();
            }
          },
          COLLISION_TYPES.map((type) =>
            el('option', { value: type.id, selected: type.id === metatile.collision }, type.label)
          )
        )
      ),
      el(
        'p.hint',
        null,
        'A 16x16 metatile lines up exactly with one NES attribute square, so each one can carry its own palette.'
      )
    );
  }

  function render() {
    renderBrowser();
    renderEditor();
  }

  const node = el(
    'div.panel',
    null,
    el('div.panel-head', null, 'Metatiles'),
    el(
      'div.panel-body.tight',
      null,
      el('div.sheet-wrap', null, browser),
      el(
        'div.field-row',
        { style: { marginTop: '8px' } },
        el('span.field-label', null, 'Size'),
        el('input', {
          type: 'range',
          min: 2,
          max: 4,
          value: zoom,
          oninput: (event) => {
            zoom = Number(event.target.value);
            renderBrowser();
          }
        })
      ),
      el('div.panel-head', { style: { marginTop: '10px', paddingLeft: '0' } }, 'Selected metatile'),
      el('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } }, editorCanvas, el('div', { style: { flex: '1' } }, quadrantInfo)),
      el('div', { style: { marginTop: '12px' } }, details)
    )
  );

  return { node, render };
}
