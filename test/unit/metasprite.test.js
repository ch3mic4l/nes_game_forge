import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tileFromString } from '../../shared/chr.js';
import { paintMetasprite } from '../../renderer/widgets/metasprite.js';

// The golden below was produced by a throwaway script (not checked in) that
// copied sprite.js's own paintMetasprite body verbatim, before the
// extraction, with `decoded`/`palettes()` turned into explicit parameters --
// see the Character Forge phase 2 report for the script's full text. This
// test proves the extracted function reproduces that pre-extraction output
// exactly: a parameter-passing mistake would change the hash, a drawing-logic
// change would too.

const WIDTH = 64;
const ORIGIN = 16;

function buildFixture() {
  // tile 0: every palette slot 0-3 appears, cycling by (x+y)%4 -- asymmetric,
  // so hflip/vflip/hflip+vflip each produce a genuinely different pattern.
  let tile0 = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) tile0 += String((x + y) % 4);
  // tile 1: uniform slot 1.
  const tile1 = '1'.repeat(64);
  const decoded = [tileFromString(tile0), tileFromString(tile1)];

  const spritePalettes = [
    [0x0f, 0x16, 0x27, 0x30],
    [0x0f, 0x02, 0x12, 0x22],
    [0x0f, 0x08, 0x18, 0x28],
    [0x0f, 0x04, 0x14, 0x24]
  ];

  // Round 2 (reviewer finding 4, fix round 1): both hflip:true entries used
  // to be tile 1 (uniform), so disabling hflip entirely still passed this
  // golden -- confirmed by the reviewer with an in-memory mutation. Every
  // flip combination now uses the asymmetric tile 0; the uniform tile 1 is
  // kept once, unflipped, for plain-tile-reference coverage.
  const metasprite = {
    tiles: [
      { x: 0, y: 0, tile: 0, palette: 0, hflip: false, vflip: false }, // baseline, no flip
      { x: 8, y: 0, tile: 0, palette: 1, hflip: true, vflip: false }, // hflip only
      { x: -4, y: -4, tile: 0, palette: 2, hflip: false, vflip: true }, // vflip only, negative offset
      { x: 40, y: 40, tile: 0, palette: 3, hflip: true, vflip: true }, // hflip+vflip, positive offset
      { x: 16, y: 40, tile: 1, palette: 1, hflip: false, vflip: false } // uniform tile, unflipped
    ]
  };

  return { decoded, spritePalettes, metasprite };
}

test('paintMetasprite reproduces the pre-extraction golden byte-for-byte', () => {
  const { decoded, spritePalettes, metasprite } = buildFixture();
  const data = new Uint8ClampedArray(WIDTH * WIDTH * 4);
  paintMetasprite(data, WIDTH, metasprite, ORIGIN, ORIGIN, decoded, spritePalettes);

  const hex = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('hex');
  const sha = createHash('sha256').update(hex).digest('hex');
  assert.equal(sha, '45d48ba4c624c2279d401d7b05bdeb5a4f340690da2ba94dc9b98c0c895c7566');
});

test('paintMetasprite leaves a slot-0 (transparent) pixel at its prior value', () => {
  const opaque = tileFromString('1'.repeat(64));
  const transparent = tileFromString('0'.repeat(64));
  const decoded = [opaque, transparent];
  const spritePalettes = [[0x0f, 0x16, 0x27, 0x30]];

  const data = new Uint8ClampedArray(WIDTH * WIDTH * 4);
  // Prime one pixel with a sentinel value that no real color would produce.
  const idx = (ORIGIN * WIDTH + ORIGIN) * 4;
  data[idx] = 9;
  data[idx + 1] = 9;
  data[idx + 2] = 9;
  data[idx + 3] = 9;

  // Paint an all-transparent tile directly over that pixel.
  paintMetasprite(
    data,
    WIDTH,
    { tiles: [{ x: 0, y: 0, tile: 1, palette: 0, hflip: false, vflip: false }] },
    ORIGIN,
    ORIGIN,
    decoded,
    spritePalettes
  );

  assert.deepEqual([data[idx], data[idx + 1], data[idx + 2], data[idx + 3]], [9, 9, 9, 9]);
});
