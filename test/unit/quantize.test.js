import test from 'node:test';
import assert from 'node:assert/strict';
import { quantizeImage, indexedToRgba, sliceToTiles, DITHER_MODES } from '../../shared/quantize.js';
import { perceptualPaletteFor, nearestNesColor, NES_PALETTE, NES_CHOICES } from '../../shared/nespalette.js';

function solidImage(width, height, [r, g, b], alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = alpha;
  }
  return { data, width, height };
}

test('the NES palette has 64 entries and safe choices exclude $xD', () => {
  assert.equal(NES_PALETTE.length, 64);
  assert.ok(NES_CHOICES.length > 40);
  assert.ok(!NES_CHOICES.some((index) => index % 16 === 0x0d));
});

test('nearestNesColor finds exact matches', () => {
  for (const index of [0x21, 0x30, 0x16, 0x0f]) {
    const [r, g, b] = NES_PALETTE[index];
    assert.equal(nearestNesColor(r, g, b), index);
  }
});

test('perceptualPaletteFor always returns four colours, darkest first', () => {
  const palette = perceptualPaletteFor([
    [0, 0, 0],
    [255, 255, 255],
    [248, 56, 0]
  ]);
  assert.equal(palette.length, 4);
  assert.equal(new Set(palette).size, 4);
  assert.ok(palette.every((index) => index >= 0 && index < 64));
});

test('perceptualPaletteFor copes with an empty pixel list', () => {
  const palette = perceptualPaletteFor([]);
  assert.equal(palette.length, 4);
});

test('every dither mode runs and stays within palette slots', () => {
  const image = solidImage(16, 16, [120, 60, 200]);
  const palette = [0x0f, 0x12, 0x22, 0x30];
  for (const mode of DITHER_MODES) {
    const indexed = quantizeImage(image, palette, { mode: mode.id, strength: 0.6 });
    assert.equal(indexed.length, 256, mode.id);
    assert.ok(
      indexed.every((slot) => slot >= 0 && slot < 4),
      `${mode.id} produced an out-of-range slot`
    );
  }
});

test('a flat image with no dithering maps to one slot', () => {
  const palette = [0x0f, 0x16, 0x27, 0x30];
  const image = solidImage(8, 8, NES_PALETTE[0x27]);
  const indexed = quantizeImage(image, palette, { mode: 'none' });
  assert.deepEqual([...new Set(indexed)], [2]);
});

test('transparent pixels collapse to slot 0 when asked', () => {
  const image = solidImage(8, 8, [255, 255, 255], 0);
  const indexed = quantizeImage(image, [0x0f, 0x16, 0x27, 0x30], { mode: 'none', alphaToZero: true });
  assert.ok(indexed.every((slot) => slot === 0));
});

test('indexedToRgba renders opaque pixels from the palette', () => {
  const rgba = indexedToRgba(Uint8Array.from([0, 1, 2, 3]), [0x0f, 0x16, 0x27, 0x30]);
  assert.equal(rgba.length, 16);
  assert.deepEqual([...rgba.slice(4, 7)], NES_PALETTE[0x16]);
  assert.equal(rgba[7], 255);
});

test('sliceToTiles de-duplicates identical tiles', () => {
  // Two 8x8 tiles side by side, both identical -> one unique tile, map [0, 0].
  const indexed = new Uint8Array(16 * 8).fill(1);
  const result = sliceToTiles(indexed, 16, 8);
  assert.equal(result.columns, 2);
  assert.equal(result.rows, 1);
  assert.equal(result.tiles.length, 1);
  assert.deepEqual(result.map, [0, 0]);
});

test('sliceToTiles keeps distinct tiles apart and preserves order', () => {
  const width = 16;
  const height = 8;
  const indexed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 8; x < 16; x++) indexed[y * width + x] = 2;
  }
  const result = sliceToTiles(indexed, width, height);
  assert.equal(result.tiles.length, 2);
  assert.deepEqual(result.map, [0, 1]);
  assert.ok(result.tiles[0].every((slot) => slot === 0));
  assert.ok(result.tiles[1].every((slot) => slot === 2));
});
