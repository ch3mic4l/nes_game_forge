// Image -> NES palette quantisation with optional dithering.
// Ported from TileForge (codex_img_to_nes/app.js), with the canvas globals it
// used replaced by explicit parameters so it runs headless under node:test.

import { NES_PALETTE, nearestNesColor, clampByte } from './nespalette.js';

export const DITHER_MODES = [
  { id: 'none', label: 'Clean (no dither)' },
  { id: 'bayer2', label: 'Ordered 2x2' },
  { id: 'bayer4', label: 'Ordered 4x4' },
  { id: 'floyd', label: 'Floyd-Steinberg' },
  { id: 'atkinson', label: 'Atkinson' },
  { id: 'pattern', label: 'Checker pattern' }
];

const BAYER_2 = [
  [0, 2],
  [3, 1]
];
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function orderedBias(mode, x, y, strength) {
  if (mode === 'pattern') return ((x + y) % 2 ? 1 : -1) * 32 * strength;
  const matrix = mode === 'bayer4' ? BAYER_4 : BAYER_2;
  const size = matrix.length;
  const threshold = (matrix[y % size][x % size] + 0.5) / (size * size) - 0.5;
  return threshold * 64 * strength;
}

function quantizeOrdered(image, palette, mode, strength, alphaToZero) {
  const { data, width, height } = image;
  const indexed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const rawIndex = pixelIndex * 4;
      if (alphaToZero && data[rawIndex + 3] < 128) {
        indexed[pixelIndex] = 0;
        continue;
      }
      const bias = mode === 'none' ? 0 : orderedBias(mode, x, y, strength);
      const color = nearestNesColor(
        data[rawIndex] + bias,
        data[rawIndex + 1] + bias,
        data[rawIndex + 2] + bias,
        palette
      );
      indexed[pixelIndex] = palette.indexOf(color);
    }
  }
  return indexed;
}

function quantizeDiffusion(image, palette, mode, strength, alphaToZero) {
  const { data, width, height } = image;
  const length = width * height;
  const red = new Float32Array(length);
  const green = new Float32Array(length);
  const blue = new Float32Array(length);
  const indexed = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    red[index] = data[index * 4];
    green[index] = data[index * 4 + 1];
    blue[index] = data[index * 4 + 2];
  }
  const diffusion =
    mode === 'floyd'
      ? [
          [1, 0, 7 / 16],
          [-1, 1, 3 / 16],
          [0, 1, 5 / 16],
          [1, 1, 1 / 16]
        ]
      : [
          [1, 0, 1 / 8],
          [2, 0, 1 / 8],
          [-1, 1, 1 / 8],
          [0, 1, 1 / 8],
          [1, 1, 1 / 8],
          [0, 2, 1 / 8]
        ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (alphaToZero && data[index * 4 + 3] < 128) {
        indexed[index] = 0;
        continue;
      }
      const r = clampByte(red[index]);
      const g = clampByte(green[index]);
      const b = clampByte(blue[index]);
      const colorIndex = nearestNesColor(r, g, b, palette);
      const slot = palette.indexOf(colorIndex);
      const color = NES_PALETTE[colorIndex];
      indexed[index] = slot;
      const errorR = (r - color[0]) * strength;
      const errorG = (g - color[1]) * strength;
      const errorB = (b - color[2]) * strength;
      for (const [offsetX, offsetY, weight] of diffusion) {
        const targetX = x + offsetX;
        const targetY = y + offsetY;
        if (targetX < 0 || targetX >= width || targetY >= height) continue;
        const target = targetY * width + targetX;
        red[target] += errorR * weight;
        green[target] += errorG * weight;
        blue[target] += errorB * weight;
      }
    }
  }
  return indexed;
}

/**
 * Quantise RGBA image data to palette slots 0-3.
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} image
 * @param {number[]} palette four NES colour indices
 * @returns {Uint8Array} one slot per pixel
 */
export function quantizeImage(image, palette, options = {}) {
  const { mode = 'none', strength = 1, alphaToZero = false } = options;
  return mode === 'floyd' || mode === 'atkinson'
    ? quantizeDiffusion(image, palette, mode, strength, alphaToZero)
    : quantizeOrdered(image, palette, mode, strength, alphaToZero);
}

/** Render palette-slot indices back to RGBA for display. */
export function indexedToRgba(indexed, palette) {
  const rgba = new Uint8ClampedArray(indexed.length * 4);
  for (let index = 0; index < indexed.length; index++) {
    const color = NES_PALETTE[palette[indexed[index]] & 0x3f];
    rgba[index * 4] = color[0];
    rgba[index * 4 + 1] = color[1];
    rgba[index * 4 + 2] = color[2];
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * Slice a quantised image into 8x8 tiles, de-duplicating identical tiles.
 * @returns {{tiles: Uint8Array[], map: number[], columns: number, rows: number}}
 */
export function sliceToTiles(indexed, width, height) {
  const columns = Math.floor(width / 8);
  const rows = Math.floor(height / 8);
  const unique = new Map();
  const tiles = [];
  const map = [];
  for (let tileY = 0; tileY < rows; tileY++) {
    for (let tileX = 0; tileX < columns; tileX++) {
      const tile = new Uint8Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          tile[y * 8 + x] = indexed[(tileY * 8 + y) * width + tileX * 8 + x];
        }
      }
      const key = tile.join('');
      if (!unique.has(key)) {
        unique.set(key, tiles.length);
        tiles.push(tile);
      }
      map.push(unique.get(key));
    }
  }
  return { tiles, map, columns, rows };
}
