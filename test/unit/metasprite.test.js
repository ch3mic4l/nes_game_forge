import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tileFromString } from '../../shared/chr.js';
import { paintMetasprite, drawMetaspritePreview } from '../../renderer/widgets/metasprite.js';
import { NES_PALETTE } from '../../shared/nespalette.js';

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

// Phase 3 (docs/design-battle-animation.md §15.5, §15.7): paintMetasprite's
// new, trailing `height` parameter. Three genuinely RECTANGULAR cases,
// deliberately not grouped with a square all-zero-tile case (that one
// exercises the bounds/viewport computation instead, test/unit/battlefx.test.js).

test('paintMetasprite: a TALL viewport (height > width) paints a tile near the bottom, past the old bare width bound', () => {
  // Wrong implementation this catches: the pre-fix clip test `py >= width`
  // instead of `py >= height` -- an 8x72 viewport with a tile at y=64 would
  // have silently painted zero opaque pixels (64 >= 64, the old width bound).
  const width = 8;
  const height = 72;
  const opaque = tileFromString('1'.repeat(64));
  const decoded = [opaque];
  const spritePalettes = [[0x0f, 0x16, 0x27, 0x30]];
  const data = new Uint8ClampedArray(width * height * 4);
  paintMetasprite(
    data,
    width,
    { tiles: [{ x: 0, y: 64, tile: 0, palette: 0, hflip: false, vflip: false }] },
    0,
    0,
    decoded,
    spritePalettes,
    height
  );
  // The tile occupies rows 64-71, columns 0-7 -- assert at least the
  // top-left pixel of that tile actually painted (a real color, not the
  // buffer's initial zero).
  const offset = (64 * width + 0) * 4;
  assert.notEqual(data[offset + 3], 0, 'the tile at y=64 must have painted -- alpha must be opaque, not left at 0');
  assert.deepEqual([data[offset], data[offset + 1], data[offset + 2]], NES_PALETTE[0x16]);
});

test('paintMetasprite: a WIDE viewport (width > height) clips a tile past the SHORTER real height, in a sentinel-backed buffer that proves nothing lands past it', () => {
  // P3-8 fix: the prior version of this test allocated exactly
  // width*height*4 bytes, so an under-clipping write (py >= width instead of
  // py >= height -- the old bug) landed past the end of the typed array and
  // JavaScript silently discarded it, indistinguishable from a correctly
  // clipped write. Reverting the clip condition to `py >= width` still
  // passed the prior version of this test. Fixed by over-allocating the
  // buffer well past the real, logical height and filling it with a
  // sentinel: `py >= width` (72) would ADMIT py = 64 (64 < 72), landing a
  // real write inside the sentinel region below, which this test can now
  // see disturbed. The tile spans rows 64-71 (y=64, an 8px-tall tile), so
  // the sentinel region has to actually extend PAST row 71 -- an
  // insufficient over-allocation (e.g. only 16 extra rows, covering rows
  // 8-23) leaves the buggy write landing past the END of the buffer again,
  // silently discarded exactly as before and just as unable to catch it.
  const width = 72;
  const height = 8;
  const extraRows = 72; // sentinel region past the real, logical height -- comfortably past row 71
  const totalRows = height + extraRows;
  const opaque = tileFromString('1'.repeat(64));
  const decoded = [opaque];
  const spritePalettes = [[0x0f, 0x16, 0x27, 0x30]];
  const data = new Uint8ClampedArray(width * totalRows * 4);
  const SENTINEL = 77;
  data.fill(SENTINEL);
  paintMetasprite(
    data,
    width,
    { tiles: [{ x: 0, y: 64, tile: 0, palette: 0, hflip: false, vflip: false }] },
    0,
    0,
    decoded,
    spritePalettes,
    height
  );
  // The tile's own y (64) is well past the real height (8) -- every byte in
  // this over-allocated buffer, sentinel region included, must stay
  // untouched.
  for (let i = 0; i < data.length; i++) {
    assert.equal(
      data[i],
      SENTINEL,
      `byte ${i} (row ${Math.floor(i / 4 / width)}): must stay the sentinel -- a tile past the real height must never write there, even when the buffer has room`
    );
  }
});

test('paintMetasprite: a negative-offset tile composed with a nonzero origin lands at a nonzero in-bounds position, in a RECTANGULAR viewport', () => {
  // P3-8 fix: the prior version of this test used a SQUARE 16x16 viewport
  // (§15.7 asks every new compositor case to be genuinely rectangular) and
  // asserted only canvas (0, 0) -- indistinguishable from a sign or
  // axis-swap error that happened to also land at the origin. This version
  // uses a rectangular 20x12 viewport and lands the tile at a specified,
  // NONZERO in-bounds position (3, 2), with an explicit check that (0, 0)
  // does NOT paint.
  const width = 20;
  const height = 12;
  const originX = 12;
  const originY = 5;
  const opaque = tileFromString('1'.repeat(64));
  const decoded = [opaque];
  const spritePalettes = [[0x0f, 0x16, 0x27, 0x30]];
  const data = new Uint8ClampedArray(width * height * 4);
  paintMetasprite(
    data,
    width,
    { tiles: [{ x: -9, y: -3, tile: 0, palette: 0, hflip: false, vflip: false }] },
    originX,
    originY,
    decoded,
    spritePalettes,
    height
  );
  // originX + entry.x = 12 + (-9) = 3; originY + entry.y = 5 + (-3) = 2 --
  // the tile's own top-left pixel must land at canvas (3, 2).
  const px = 3;
  const py = 2;
  const offset = (py * width + px) * 4;
  assert.notEqual(data[offset + 3], 0, 'the negative-offset tile must land at canvas (3, 2)');
  assert.deepEqual([data[offset], data[offset + 1], data[offset + 2]], NES_PALETTE[0x16]);
  // And (0, 0) must NOT have painted -- distinguishing a correct landing
  // from a coincidental always-(0, 0) bug.
  assert.equal(data[3], 0, 'canvas (0, 0) must stay transparent -- the tile does not land there');
});

// P2-6 fix: every case above calls paintMetasprite directly, so none of them
// can see a regression in drawMetaspritePreview's OWN call site -- the real
// wrapper renderer code actually uses (renderer/widgets/battlefxpreview.js,
// character.js). Removing only the wrapper's trailing `height` argument to
// paintMetasprite left every test above at 5 passing, 0 failing (round-1
// P2-6: the report's own "row 9: RUN, tall test fails" claim was false --
// execution contradicted it). This test drives the actual wrapper through a
// minimal canvas/2d-context double, so a wrapper-level regression is
// visible here even though the pure paintMetasprite tests above cannot see it.
test('drawMetaspritePreview forwards height to paintMetasprite through the REAL wrapper -- a TALL viewport paints past the old bare width bound', () => {
  let capturedImage = null;
  const canvasDouble = {
    width: 0,
    height: 0,
    style: {},
    getContext() {
      return {
        createImageData(w, h) {
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        },
        putImageData(image) {
          capturedImage = image;
        }
      };
    }
  };
  const width = 8;
  const height = 72;
  const opaque = tileFromString('1'.repeat(64));
  const decoded = [opaque];
  const spritePalettes = [[0x0f, 0x16, 0x27, 0x30]];
  const metasprite = { tiles: [{ x: 0, y: 64, tile: 0, palette: 0, hflip: false, vflip: false }] };

  drawMetaspritePreview(canvasDouble, metasprite, decoded, spritePalettes, { width, height, originX: 0, originY: 0, zoom: 1 });

  assert.equal(canvasDouble.width, width);
  assert.equal(canvasDouble.height, height);
  assert.ok(capturedImage, 'putImageData must have been called');
  const offset = (64 * width + 0) * 4;
  assert.notEqual(capturedImage.data[offset + 3], 0, 'the tile at y=64 must have painted through the real wrapper -- alpha must be opaque');
  assert.deepEqual(
    [capturedImage.data[offset], capturedImage.data[offset + 1], capturedImage.data[offset + 2]],
    NES_PALETTE[0x16]
  );
});
