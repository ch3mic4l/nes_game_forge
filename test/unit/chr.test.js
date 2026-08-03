import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  encodeTile,
  decodeTile,
  encodeTiles,
  decodeChr,
  tileToString,
  tileFromString,
  flipTile,
  BLANK_TILE
} from '../../shared/chr.js';

test('encodeTile produces the documented planar layout', () => {
  // Row 0 = 0,1,2,3,0,0,0,0 -> plane0 bits 01010000b, plane1 bits 00110000b
  const pixels = new Uint8Array(64);
  pixels[0] = 0;
  pixels[1] = 1;
  pixels[2] = 2;
  pixels[3] = 3;
  const bytes = encodeTile(pixels);
  assert.equal(bytes.length, 16);
  assert.equal(bytes[0], 0b01010000);
  assert.equal(bytes[8], 0b00110000);
});

test('decodeTile inverts encodeTile for random tiles', () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pixels = new Uint8Array(64);
    for (let i = 0; i < 64; i++) pixels[i] = (i * 7 + attempt * 13) % 4;
    assert.deepEqual(decodeTile(encodeTile(pixels)), pixels);
  }
});

test('string form round-trips', () => {
  const pixels = new Uint8Array(64);
  for (let i = 0; i < 64; i++) pixels[i] = i % 4;
  const text = tileToString(pixels);
  assert.equal(text.length, 64);
  assert.deepEqual(tileFromString(text), pixels);
});

test('tileFromString rejects out-of-range characters without throwing', () => {
  assert.deepEqual(tileFromString('9'.repeat(64)), new Uint8Array(64));
  assert.equal(tileFromString('').length, 64);
});

test('BLANK_TILE decodes to all zeroes', () => {
  assert.deepEqual(tileFromString(BLANK_TILE), new Uint8Array(64));
});

test('flipTile mirrors correctly', () => {
  const pixels = new Uint8Array(64);
  pixels[0] = 3; // top-left
  const horizontal = flipTile(pixels, true, false);
  assert.equal(horizontal[7], 3);
  const vertical = flipTile(pixels, false, true);
  assert.equal(vertical[56], 3);
  const both = flipTile(pixels, true, true);
  assert.equal(both[63], 3);
});

test('encodeTiles accepts strings and pixel arrays alike', () => {
  const pixels = new Uint8Array(64).fill(2);
  const fromPixels = encodeTiles([pixels]);
  const fromString = encodeTiles([tileToString(pixels)]);
  assert.deepEqual(fromPixels, fromString);
});

test('decodeChr rejects truncated data', () => {
  assert.throws(() => decodeChr(new Uint8Array(15)), /whole number of 16-byte tiles/);
  assert.throws(() => decodeChr(new Uint8Array(0)), /whole number of 16-byte tiles/);
});

// Fallen Star ships a real CHR blob; if it is present, use it as a fixture to
// prove the codec agrees with data produced by an independent toolchain.
const FALLEN_STAR_CHR = `${process.env.HOME}/claude_nes_test/assets/tiles.chr`;
test('round-trips a real CHR file byte for byte', { skip: !fs.existsSync(FALLEN_STAR_CHR) }, () => {
  const original = new Uint8Array(fs.readFileSync(FALLEN_STAR_CHR));
  const usable = original.subarray(0, original.length - (original.length % 16));
  assert.deepEqual(encodeTiles(decodeChr(usable)), usable);
});
