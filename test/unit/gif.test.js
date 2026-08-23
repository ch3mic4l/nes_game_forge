// renderer/emulator/gif.js, checked against an independent decoder
// (test/lib/gifdecode.js) rather than against its own header bytes -- a
// header-byte assertion alone would pass on an encoder that writes a
// valid-looking file no viewer actually reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGifEncoder } from '../../renderer/emulator/gif.js';
import { decodeGif } from '../lib/gifdecode.js';

const rgb = (r, g, b) => (r << 16) | (g << 8) | b;

function solidFrame(width, height, color) {
  return new Uint32Array(width * height).fill(color);
}

/** First index in `bytes` where the byte sequence `seq` occurs, or -1. */
function indexOfSequence(bytes, seq, from = 0) {
  outer: for (let i = from; i <= bytes.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Hand-built GIF89a fixtures for gifdecode.js's own validation (findings 9):
 * edge cases createGifEncoder never produces (an out-of-range colour index,
 * a sub-image past the logical screen, disposal 2) but a conforming decoder
 * still has to handle correctly or reject outright. `minCodeSize: 2` is used
 * throughout -- the smallest legal size, giving literal codes 0-3, clear
 * code 4, EOI 5 -- and every code is written as a bare literal (no LZW
 * dictionary matching attempted), which is valid GIF: codes below the clear
 * code always mean "output this single symbol," independent of any prior
 * state.
 */
function packCodesToSubBlocks(codes, codeSize) {
  let buffer = 0;
  let bitCount = 0;
  const bytes = [];
  for (const code of codes) {
    buffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(buffer & 0xff);
      buffer >>= 8;
      bitCount -= 8;
    }
  }
  if (bitCount > 0) bytes.push(buffer & 0xff);
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

/**
 * @param {{width, height, backgroundIndex, gctEntries, frames}} spec
 *   `frames`: [{left, top, imgWidth, imgHeight, disposal, minCodeSize, codes}]
 */
function buildGif({ width, height, backgroundIndex = 0, gctEntries, frames }) {
  const bytes = [];
  bytes.push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)));
  bytes.push(width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff);
  const n = Math.log2(gctEntries.length) - 1;
  bytes.push(0x80 | (n << 4) | n, backgroundIndex, 0x00);
  for (const [r, g, b] of gctEntries) bytes.push(r, g, b);
  for (const frame of frames) {
    const { left = 0, top = 0, imgWidth, imgHeight, disposal = 0, minCodeSize, codes } = frame;
    bytes.push(0x21, 0xf9, 0x04, disposal << 2, 0x05, 0x00, 0x00, 0x00);
    bytes.push(
      0x2c,
      left & 0xff,
      (left >> 8) & 0xff,
      top & 0xff,
      (top >> 8) & 0xff,
      imgWidth & 0xff,
      (imgWidth >> 8) & 0xff,
      imgHeight & 0xff,
      (imgHeight >> 8) & 0xff,
      0x00
    );
    bytes.push(minCodeSize);
    bytes.push(...packCodesToSubBlocks(codes, minCodeSize + 1));
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('a single frame round-trips pixel-identical', () => {
  const width = 5;
  const height = 4;
  const pixels = new Uint32Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = rgb((i * 10) % 256, (i * 5) % 256, (i * 3) % 256);

  const encoder = createGifEncoder({ width, height, delayCs: 5 });
  encoder.addFrame(pixels);
  assert.equal(encoder.frameCount, 1);

  const gif = decodeGif(encoder.finish());
  assert.equal(gif.width, width);
  assert.equal(gif.height, height);
  assert.equal(gif.frames.length, 1);
  assert.deepEqual(Array.from(gif.frames[0].pixels), Array.from(pixels));
});

test('the Global Colour Table is always the full 256 entries, regardless of how few colours are used', () => {
  // Only 3 colours discovered -- a table sized from the discovered count
  // would be 4 entries (2^2), not 256. Every image block still declares an
  // LZW minimum code size of 8, so a real GIF viewer that infers table depth
  // from that width (a common, if not spec-mandated, assumption -- see the
  // capture design doc's Rev 2 finding 1) must see the full table too. Our
  // own decoder reads the *declared* size field rather than assuming from
  // the code size, so this can only be checked at the byte level, not
  // through a round trip -- exactly why Rev 4's ImageDecoder smoke check
  // exists to close that gap with a decoder written by nobody in this repo.
  const width = 3;
  const height = 1;
  const pixels = new Uint32Array([rgb(1, 2, 3), rgb(4, 5, 6), rgb(7, 8, 9)]);

  const encoder = createGifEncoder({ width, height, delayCs: 5 });
  encoder.addFrame(pixels);
  const bytes = encoder.finish();

  const lsdPacked = bytes[10]; // GIF89a(6) + width(2) + height(2) = byte 10
  const sizeField = lsdPacked & 0x07;
  assert.equal(sizeField, 7, `Logical Screen Descriptor size field is ${sizeField}, expected 7 (256 entries)`);

  const gctBytes = bytes.slice(13, 13 + 256 * 3); // header(6)+LSD(7) = 13
  assert.equal(gctBytes.length, 768);
  // The first 3 entries are the real, discovered colours; the rest is padding.
  assert.deepEqual(Array.from(gctBytes.slice(0, 9)), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('the delay and the NETSCAPE loop-forever extension are written correctly', () => {
  const width = 2;
  const height = 2;
  const encoder = createGifEncoder({ width, height, delayCs: 7 });
  encoder.addFrame(solidFrame(width, height, rgb(1, 2, 3)));

  const gif = decodeGif(encoder.finish());
  assert.equal(gif.frames[0].delayCs, 7);
  assert.equal(gif.loopCount, 0); // 0 is NETSCAPE2.0's own spelling of "loop forever"
});

test('an identical consecutive frame writes a 1x1 no-op, not a dropped frame', () => {
  const width = 6;
  const height = 5;
  const pixels = solidFrame(width, height, rgb(9, 9, 9));

  const encoder = createGifEncoder({ width, height, delayCs: 5 });
  encoder.addFrame(pixels);
  encoder.addFrame(pixels.slice()); // identical content, must still be kept
  assert.equal(encoder.frameCount, 2);

  const gif = decodeGif(encoder.finish());
  assert.equal(gif.frames.length, 2);
  assert.deepEqual(gif.frames[1].subImage, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(Array.from(gif.frames[1].pixels), Array.from(pixels));
});

test('a moving block writes a sub-image smaller than the full screen', () => {
  const width = 10;
  const height = 8;
  const bg = rgb(0, 0, 0);
  const fg = rgb(200, 50, 10);
  function frameWithBlock(x, y) {
    const frame = solidFrame(width, height, bg);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) frame[(y + dy) * width + (x + dx)] = fg;
    }
    return frame;
  }
  const frame1 = frameWithBlock(1, 1);
  const frame2 = frameWithBlock(5, 4);

  const encoder = createGifEncoder({ width, height, delayCs: 5 });
  encoder.addFrame(frame1);
  encoder.addFrame(frame2);

  const gif = decodeGif(encoder.finish());
  const box = gif.frames[1].subImage;
  assert.ok(
    box.width * box.height < width * height,
    `expected a sub-image smaller than the full ${width}x${height} screen, got ${box.width}x${box.height}`
  );
  assert.deepEqual(Array.from(gif.frames[1].pixels), Array.from(frame2));
});

test('a change confined to one corner emits a tightly-bounded sub-image', () => {
  const width = 8;
  const height = 6;
  const a = rgb(30, 30, 30);
  const b = rgb(250, 10, 10);
  const frame1 = solidFrame(width, height, a);
  const frame2 = frame1.slice();
  frame2[(height - 2) * width + (width - 2)] = b;
  frame2[(height - 2) * width + (width - 1)] = b;
  frame2[(height - 1) * width + (width - 2)] = b;
  frame2[(height - 1) * width + (width - 1)] = b;

  const encoder = createGifEncoder({ width, height, delayCs: 5 });
  encoder.addFrame(frame1);
  encoder.addFrame(frame2);

  const gif = decodeGif(encoder.finish());
  assert.deepEqual(gif.frames[1].subImage, { x: width - 2, y: height - 2, width: 2, height: 2 });
  assert.deepEqual(Array.from(gif.frames[1].pixels), Array.from(frame2));
});

test('a code table that fills to 4096 forces a mid-frame Clear', () => {
  const width = 120;
  const height = 60; // 7200 pixels, comfortably past the ~3838 new entries needed to fill the table
  const rand = mulberry32(12345);
  const paletteSize = 48; // well under 256, so this stays isolated from the nearest-colour fallback
  const pixels = new Uint32Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const v = Math.floor(rand() * paletteSize);
    pixels[i] = rgb(v * 5, (v * 37) % 256, (v * 91) % 256);
  }

  const encoder = createGifEncoder({ width, height, delayCs: 5 });
  encoder.addFrame(pixels);

  const gif = decodeGif(encoder.finish());
  assert.ok(
    gif.frames[0].clearCount > 1,
    `expected a forced Clear beyond the stream's mandatory leading one, saw ${gif.frames[0].clearCount}`
  );
  // Not just "more than one Clear exists" -- prove the *second* one landed
  // exactly at genuine exhaustion (the dictionary at its 4096-entry ceiling),
  // not merely emitted somewhere early. A mutation that writes two leading
  // Clears and never clears on a full table would satisfy clearCount > 1
  // without ever proving this.
  const forced = gif.frames[0].clearEvents[1];
  assert.ok(forced, 'expected at least two Clear events in the decoded stream');
  assert.equal(
    forced.nextCodeBefore,
    4096,
    `the second Clear landed with the dictionary at ${forced.nextCodeBefore} entries, expected exactly 4096`
  );
  assert.deepEqual(Array.from(gif.frames[0].pixels), Array.from(pixels));
});

test('nearest-colour fallback uses true squared RGB distance, not a cheaper approximation', () => {
  // width 257: the first 256 pixels fill the table exactly (indices 0-255),
  // the 257th is the query that must fall back to nearest-colour. Filler
  // colours (200,200,i) are always the losing candidates here -- their
  // distance from anything near the origin dwarfs the two real candidates'.
  function buildFrame(candidateA, candidateB, query) {
    const pixels = new Uint32Array(257);
    pixels[0] = candidateA;
    pixels[1] = candidateB;
    for (let i = 2; i < 256; i++) pixels[i] = rgb(200, 200, i);
    pixels[256] = query;
    return pixels;
  }

  const cases = [
    {
      label: 'squared distance beats Manhattan (L1) distance',
      // From query (0,0,0): A=(10,0,0) has squared distance 100, Manhattan 10.
      // B=(4,4,4) has squared distance 48, Manhattan 12. True nearest is B
      // (48 < 100); an L1 implementation would pick A (10 < 12) instead.
      candidateA: rgb(10, 0, 0),
      candidateB: rgb(4, 4, 4),
      query: rgb(0, 0, 0),
      expectedWinner: rgb(4, 4, 4)
    },
    {
      label: 'squared distance beats a single-channel (R-only) metric',
      // From query (0,0,0): A=(0,10,0) has squared distance 100, |dr|=0.
      // B=(3,0,0) has squared distance 9, |dr|=3. True nearest is B (9 < 100);
      // an R-channel-only implementation would pick A (|dr| 0 < 3) instead.
      candidateA: rgb(0, 10, 0),
      candidateB: rgb(3, 0, 0),
      query: rgb(0, 0, 0),
      expectedWinner: rgb(3, 0, 0)
    }
  ];

  for (const { label, candidateA, candidateB, query, expectedWinner } of cases) {
    const encoder = createGifEncoder({ width: 257, height: 1, delayCs: 5 });
    encoder.addFrame(buildFrame(candidateA, candidateB, query));
    const gif = decodeGif(encoder.finish());
    assert.equal(gif.frames[0].pixels[256], expectedWinner, label);
  }
});

test('the decoder rejects an LZW minimum code size outside the legal 2-8 range', () => {
  const encoder = createGifEncoder({ width: 2, height: 2, delayCs: 5 });
  encoder.addFrame(solidFrame(2, 2, rgb(1, 2, 3)));
  const bytes = encoder.finish();

  // The Image Descriptor (0x2c) is 10 bytes; the LZW minimum code size is
  // the byte immediately after it, in this single-frame GIF.
  const imageDescriptorAt = bytes.indexOf(0x2c);
  assert.ok(imageDescriptorAt >= 0, 'no Image Descriptor found to locate the min-code-size byte from');
  const minCodeSizeAt = imageDescriptorAt + 10;
  assert.equal(bytes[minCodeSizeAt], 8, 'test assumption: this encoder always writes minCodeSize 8');

  const tooWide = bytes.slice();
  tooWide[minCodeSizeAt] = 9;
  assert.throws(() => decodeGif(tooWide), /outside the legal 2-8 range/);

  const tooNarrow = bytes.slice();
  tooNarrow[minCodeSizeAt] = 1;
  assert.throws(() => decodeGif(tooNarrow), /outside the legal 2-8 range/);
});

test('the decoder rejects a malformed Graphic Control Extension', () => {
  const encoder = createGifEncoder({ width: 2, height: 2, delayCs: 5 });
  encoder.addFrame(solidFrame(2, 2, rgb(1, 2, 3)));
  const bytes = encoder.finish();

  // The GCE is 0x21,0xf9,<blockSize>,packed,delayLo,delayHi,transIdx,<terminator>.
  // Searching for [0x21,0xf9] specifically, not just 0x21, because the
  // NETSCAPE loop extension earlier in the file also starts with 0x21.
  const gceAt = indexOfSequence(bytes, [0x21, 0xf9]);
  assert.ok(gceAt >= 0, 'no Graphic Control Extension found');
  const blockSizeAt = gceAt + 2;
  const terminatorAt = gceAt + 7;
  assert.equal(bytes[blockSizeAt], 4, 'test assumption: GCE block size is 4');
  assert.equal(bytes[terminatorAt], 0, 'test assumption: GCE terminator is 0x00');

  const badBlockSize = bytes.slice();
  badBlockSize[blockSizeAt] = 3;
  assert.throws(() => decodeGif(badBlockSize), /block size/);

  const badTerminator = bytes.slice();
  badTerminator[terminatorAt] = 1;
  assert.throws(() => decodeGif(badTerminator), /terminator/);
});

test('the decoder rejects a colour index past the end of the palette', () => {
  const CLEAR = 4;
  const EOI = 5;
  // A 4-entry table (minCodeSize 2 -> literal codes 0-3), but the image data
  // uses code 3 -- representable at this code width, but this table only has
  // entries 0-1 for real colours; a genuine encoder never emits this, but a
  // conforming decoder must still refuse it rather than silently reading it
  // back as black.
  const bytes = buildGif({
    width: 1,
    height: 1,
    gctEntries: [
      [0, 0, 0],
      [255, 255, 255]
    ],
    frames: [{ imgWidth: 1, imgHeight: 1, minCodeSize: 2, codes: [CLEAR, 3, EOI] }]
  });
  assert.throws(() => decodeGif(bytes), /outside the .*-entry palette/);
});

test('the decoder rejects a sub-image that extends outside the logical screen', () => {
  const CLEAR = 4;
  const EOI = 5;
  const gctEntries = [
    [0, 0, 0],
    [64, 64, 64],
    [128, 128, 128],
    [192, 192, 192]
  ];
  // A 2x2 sub-image placed at (3,3) on a 4x4 screen reaches (5,5) -- past
  // the edge on both axes.
  const bytes = buildGif({
    width: 4,
    height: 4,
    gctEntries,
    frames: [{ left: 3, top: 3, imgWidth: 2, imgHeight: 2, minCodeSize: 2, codes: [CLEAR, 0, 1, 2, 3, EOI] }]
  });
  assert.throws(() => decodeGif(bytes), /extends outside/);
});

test('disposal method 2 restores to the Logical Screen Descriptor\'s background colour, not black', () => {
  // minCodeSize 8 here, not 2 -- the decoder's dictionary genuinely grows as
  // it processes literal codes (each one still adds a dictionary entry, even
  // though its own *meaning* doesn't depend on prior state), and at
  // minCodeSize 2 the code width outgrows 3 bits after only two literals.
  // Fixed-width hand-packed bytes desync the moment that happens. 8 keeps
  // the growth threshold (511) far above the handful of codes this needs.
  const CLEAR = 256;
  const EOI = 257;
  const black = [0, 0, 0];
  const background = [200, 100, 50]; // deliberately not black, so a hardcoded-black bug is distinguishable
  const gctEntries = [black, background, [0, 0, 0], [0, 0, 0]];

  const bytes = buildGif({
    width: 2,
    height: 2,
    backgroundIndex: 1,
    gctEntries,
    frames: [
      // Frame 1 fills the whole screen with black, then disposes to the
      // background colour before frame 2 is drawn.
      { imgWidth: 2, imgHeight: 2, disposal: 2, minCodeSize: 8, codes: [CLEAR, 0, 0, 0, 0, EOI] },
      // Frame 2 redraws only the top-left pixel -- the other three must show
      // frame 1's disposal, i.e. the background colour, not leftover black.
      { imgWidth: 1, imgHeight: 1, disposal: 0, minCodeSize: 8, codes: [CLEAR, 0, EOI] }
    ]
  });

  const gif = decodeGif(bytes);
  const composited = gif.frames[1].pixels;
  const backgroundRgb = rgb(...background);
  assert.equal(composited[0], rgb(...black), 'top-left: frame 2 redrew this pixel black');
  assert.equal(composited[1], backgroundRgb, 'top-right: disposed to the background colour, not black');
  assert.equal(composited[2], backgroundRgb, 'bottom-left: disposed to the background colour, not black');
  assert.equal(composited[3], backgroundRgb, 'bottom-right: disposed to the background colour, not black');
});
