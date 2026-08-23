// test/lib/pngdecode.js is what main/smoke.js trusts to prove the bytes a
// screenshot PNG actually holds -- but smoke only ever feeds it valid
// Chromium-generated PNGs, so its own strictness (CRC, IHDR method fields,
// exact inflated length) and the holes a review found beyond that
// (oversized IHDR, an unrecognised critical chunk, a missing IEND) have no
// smoke-reachable bug that would exercise them. This file builds
// deliberately corrupted PNGs by hand -- the decoder's own defenses are only
// as real as a test that actually breaks each one.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng } from '../lib/pngdecode.js';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The standard PNG chunk CRC-32 -- a from-scratch reimplementation, not an
 * import from pngdecode.js, so a bug shared between the two could not hide a
 * test failure. */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One length-prefixed, CRC-suffixed PNG chunk. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** A row-major RGB(A) checkerboard, filtered with type 0 (None) throughout --
 * enough to round-trip through decodePng without exercising the other four
 * filter types, which is not this file's concern (smoke's real, varied
 * screenshots already exercise those). */
function checkerboardRaw(width, height, channels) {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (1 + stride));
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const v = (x * 37 + y * 91) & 0xff;
      raw[pos++] = v;
      raw[pos++] = (v + 50) & 0xff;
      raw[pos++] = (v + 100) & 0xff;
      if (channels === 4) raw[pos++] = 255;
    }
  }
  return raw;
}

/**
 * Builds a PNG byte buffer with every knob a corruption test needs to turn.
 * Defaults describe a small, valid, 8-bit RGBA image -- each test overrides
 * exactly the one thing it means to break.
 */
function buildPng({
  width = 2,
  height = 2,
  bitDepth = 8,
  colorType = 6,
  compressionMethod = 0,
  filterMethod = 0,
  interlace = 0,
  ihdrLength = 13,
  raw = null,
  corruptIdatCrc = false,
  extraCriticalChunk = null,
  extraAncillaryChunk = null,
  omitIEND = false
} = {}) {
  const channels = colorType === 6 ? 4 : 3;
  const rawBytes = raw ?? checkerboardRaw(width, height, channels);
  const deflated = zlib.deflateSync(rawBytes);

  const ihdrData = Buffer.alloc(Math.max(13, ihdrLength));
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(bitDepth, 8);
  ihdrData.writeUInt8(colorType, 9);
  ihdrData.writeUInt8(compressionMethod, 10);
  ihdrData.writeUInt8(filterMethod, 11);
  ihdrData.writeUInt8(interlace, 12);

  const chunks = [chunk('IHDR', ihdrData.subarray(0, ihdrLength))];
  if (extraAncillaryChunk) chunks.push(chunk(extraAncillaryChunk.type, extraAncillaryChunk.data));
  if (extraCriticalChunk) chunks.push(chunk(extraCriticalChunk.type, extraCriticalChunk.data));

  let idatChunk = chunk('IDAT', deflated);
  if (corruptIdatCrc) {
    idatChunk = Buffer.from(idatChunk);
    idatChunk[idatChunk.length - 1] ^= 0xff; // flip a byte inside the stored CRC
  }
  chunks.push(idatChunk);
  if (!omitIEND) chunks.push(chunk('IEND', Buffer.alloc(0)));

  return Buffer.concat([SIGNATURE, ...chunks]);
}

test('decodes a valid RGBA PNG back to the source pixels', () => {
  const width = 3;
  const height = 2;
  const raw = checkerboardRaw(width, height, 4);
  const png = buildPng({ width, height, colorType: 6, raw });
  const decoded = decodePng(png);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  // raw is [filter, r,g,b,a, r,g,b,a, ...] per row; decoded.pixels drops the
  // filter bytes but is otherwise the same RGBA stream.
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    rawPos++; // skip the filter-type byte
    for (let x = 0; x < width * 4; x++) {
      const dst = y * width * 4 + x;
      assert.equal(decoded.pixels[dst], raw[rawPos + x], `byte ${x} of row ${y}`);
    }
    rawPos += width * 4;
  }
});

test('an RGB (no alpha) PNG decodes with alpha filled to 255', () => {
  const width = 2;
  const height = 2;
  const png = buildPng({ width, height, colorType: 2 });
  const decoded = decodePng(png);
  for (let i = 0; i < width * height; i++) {
    assert.equal(decoded.pixels[i * 4 + 3], 255, `pixel ${i} alpha`);
  }
});

test('rejects a chunk whose stored CRC does not match its bytes', () => {
  const png = buildPng({ corruptIdatCrc: true });
  assert.throws(() => decodePng(png), /CRC mismatch/);
});

test('rejects an IHDR compression method other than 0', () => {
  const png = buildPng({ compressionMethod: 1 });
  assert.throws(() => decodePng(png), /compression method/);
});

test('rejects an IHDR filter method other than 0', () => {
  const png = buildPng({ filterMethod: 1 });
  assert.throws(() => decodePng(png), /filter method/);
});

test('rejects an inflated stream shorter than height * (1 + stride)', () => {
  const width = 2;
  const height = 2;
  // One byte short of a full 2x2 RGBA raw stream.
  const shortRaw = checkerboardRaw(width, height, 4).subarray(0, -1);
  const png = buildPng({ width, height, colorType: 6, raw: shortRaw });
  assert.throws(() => decodePng(png), /inflated stream is \d+ bytes, expected exactly \d+/);
});

test('rejects an IHDR chunk that is not exactly 13 bytes', () => {
  const png = buildPng({ ihdrLength: 14 });
  assert.throws(() => decodePng(png), /IHDR chunk must be exactly 13 bytes/);
});

test('rejects an unrecognised critical chunk', () => {
  // 'TEST': every letter's first byte has bit 0x20 clear (uppercase), so
  // this reads as critical under PNG's own ancillary-bit convention -- and
  // it names nothing decodePng knows how to interpret.
  const png = buildPng({ extraCriticalChunk: { type: 'TEST', data: Buffer.from([1, 2, 3]) } });
  assert.throws(() => decodePng(png), /unrecognised critical chunk "TEST"/);
});

test('silently skips an unrecognised ancillary chunk', () => {
  // 'tEXt': lowercase first letter -- ancillary by the same bit, and a real
  // PNG encoder is free to add chunks like this one that decodePng has no
  // reason to understand.
  const png = buildPng({ extraAncillaryChunk: { type: 'tEXt', data: Buffer.from('hello') } });
  assert.doesNotThrow(() => decodePng(png));
});

test('rejects a PNG with no IEND chunk', () => {
  const png = buildPng({ omitIEND: true });
  assert.throws(() => decodePng(png), /missing IEND/);
});
