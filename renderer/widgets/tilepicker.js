// Modal for choosing one tile out of a pattern table.

import { el, showModal } from '../ui.js';
import { drawSheet, sheetIndexFromEvent } from './sheet.js';

/**
 * @param {object} options
 * @param {string[]} options.tiles pattern table (64-char strings)
 * @param {number[]} options.palette four NES colour indices
 * @param {number} options.selected currently chosen tile index
 * @returns {Promise<number|null>} the chosen index, or null if cancelled
 */
export async function pickTile({ tiles, palette, selected = 0, title = 'Choose a tile', transparentZero = false }) {
  let choice = selected;
  const canvas = el('canvas.sheet', { style: { cursor: 'crosshair' } });
  const label = el('p.hint');

  const refresh = () => {
    drawSheet(canvas, tiles, palette, 3, { selected: choice, transparentZero });
    label.textContent = `Tile $${choice.toString(16).padStart(2, '0').toUpperCase()} (${choice})`;
  };

  canvas.addEventListener('pointerdown', (event) => {
    choice = sheetIndexFromEvent(event, canvas);
    refresh();
  });
  canvas.addEventListener('dblclick', () => {
    canvas.dispatchEvent(new CustomEvent('picker:accept', { bubbles: true }));
  });

  refresh();

  const result = await showModal({
    title,
    body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' } }, canvas, label),
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Use tile', primary: true, onClick: () => choice }
    ]
  });
  return result;
}
