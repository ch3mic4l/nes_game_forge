// Shared pattern-table rendering used by the Tile Forge, tile pickers and the
// Sprite Forge. A pattern table is 256 tiles laid out 16 across.

import { tileFromString } from '../../shared/chr.js';
import { NES_PALETTE } from '../../shared/nespalette.js';

export const SHEET_COLS = 16;
export const SHEET_ROWS = 16;
export const SHEET_W = SHEET_COLS * 8;
export const SHEET_H = SHEET_ROWS * 8;

/** Build a 128x128 ImageData of a whole pattern table. */
export function sheetImageData(context, tiles, palette, transparentZero = false) {
  const decoded = tiles.map((tile) => (typeof tile === 'string' ? tileFromString(tile) : tile));
  const colors = palette.map((index) => NES_PALETTE[index & 0x3f]);
  const image = context.createImageData(SHEET_W, SHEET_H);
  const data = image.data;
  for (let y = 0; y < SHEET_H; y++) {
    for (let x = 0; x < SHEET_W; x++) {
      const tile = decoded[Math.floor(y / 8) * SHEET_COLS + Math.floor(x / 8)];
      const slot = tile ? tile[(y % 8) * 8 + (x % 8)] : 0;
      const color = colors[slot];
      const offset = (y * SHEET_W + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = transparentZero && slot === 0 ? 0 : 255;
    }
  }
  return image;
}

/** Draw a pattern table into `canvas` at an integer zoom, with an 8x8 grid. */
export function drawSheet(canvas, tiles, palette, zoom, options = {}) {
  const { transparentZero = false, selected = null, grid = true } = options;
  const context = canvas.getContext('2d');
  const buffer = document.createElement('canvas');
  buffer.width = SHEET_W;
  buffer.height = SHEET_H;
  buffer.getContext('2d').putImageData(sheetImageData(context, tiles, palette, transparentZero), 0, 0);

  canvas.width = SHEET_W * zoom;
  canvas.height = SHEET_H * zoom;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(buffer, 0, 0, canvas.width, canvas.height);

  const cell = 8 * zoom;
  if (grid) {
    context.strokeStyle = 'rgba(255,255,255,0.08)';
    context.lineWidth = 1;
    context.beginPath();
    for (let i = 1; i < SHEET_COLS; i++) {
      context.moveTo(i * cell + 0.5, 0);
      context.lineTo(i * cell + 0.5, canvas.height);
      context.moveTo(0, i * cell + 0.5);
      context.lineTo(canvas.width, i * cell + 0.5);
    }
    context.stroke();
  }
  if (selected !== null && selected >= 0) {
    context.strokeStyle = '#ff9d3c';
    context.lineWidth = 2;
    context.strokeRect((selected % SHEET_COLS) * cell + 1, Math.floor(selected / SHEET_COLS) * cell + 1, cell - 2, cell - 2);
  }
}

/** Translate a pointer event on a sheet canvas into a tile index. */
export function sheetIndexFromEvent(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const col = Math.max(0, Math.min(SHEET_COLS - 1, Math.floor(((event.clientX - rect.left) / rect.width) * SHEET_COLS)));
  const row = Math.max(0, Math.min(SHEET_ROWS - 1, Math.floor(((event.clientY - rect.top) / rect.height) * SHEET_ROWS)));
  return row * SHEET_COLS + col;
}
