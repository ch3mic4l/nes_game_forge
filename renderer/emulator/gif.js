// Incremental GIF89a encoder for the emulator panel's Record button
// (renderer/emulator/capture.js is the recorder policy that drives this).
//
// DOM-free and Node-free -- test/unit/gif.test.js imports it directly, the same
// way several renderer/ modules already let node:test exercise them without a
// browser. Not shared/: nothing outside the renderer and its tests needs to
// agree on this format (see CLAUDE.md's single-writer rule for what shared/ is
// actually for).
//
// createGifEncoder({width, height, delayCs}) -> {addFrame(rgb), finish(), frameCount}
//
// addFrame() does the real work -- diffing against the previously kept frame,
// growing the colour table, and running LZW -- the moment it is called, rather
// than buffering raw frames for finish() to chew through. A 300-frame, 15-second
// recording encoded all at once at Stop is a multi-second freeze; spreading the
// identical work across the recording at capture time is what makes the Record
// button usable at all, and it is why finish() below is only assembling bytes
// already sitting in `frameChunks`, not still compressing anything.

const MIN_CODE_SIZE = 8; // fixed: the code size is written into each frame's
// image block before the final colour count is known, and 8 with a 256-entry
// table is what ordinary encoders emit and every decoder handles. Nothing
// about a growing table needs a matching code size -- indices are only ever
// appended, never renumbered.
const CLEAR_CODE = 1 << MIN_CODE_SIZE; // 256
const EOI_CODE = CLEAR_CODE + 1; // 257
const MAX_TABLE_SIZE = 256; // the global colour table holds at most this many

/** Packs variable-width LZW codes LSB-first into byte-aligned sub-blocks. */
class BitWriter {
  constructor() {
    this.bytes = [];
    this.buffer = 0;
    this.bitCount = 0;
  }

  writeCode(code, size) {
    this.buffer |= code << this.bitCount;
    this.bitCount += size;
    while (this.bitCount >= 8) {
      this.bytes.push(this.buffer & 0xff);
      this.buffer >>= 8;
      this.bitCount -= 8;
    }
  }

  /** Flushes remaining bits and packs into length-prefixed sub-blocks (max 255 bytes), 0-terminated. */
  finish() {
    if (this.bitCount > 0) {
      this.bytes.push(this.buffer & 0xff);
      this.buffer = 0;
      this.bitCount = 0;
    }
    const out = [];
    for (let i = 0; i < this.bytes.length; i += 255) {
      const chunk = this.bytes.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
    return Uint8Array.from(out);
  }
}

/**
 * One independent LZW stream per frame (Rev 2, finding 9): Clear first, EOI
 * last, and a Clear -- with the dictionary reset to 256 entries + Clear + EOI
 * -- whenever the table would grow past 4095. This is the CompuServe
 * reference algorithm (also giflib's, also every other encoder's): a code is
 * only ever written for a prefix already known to be a code, so growing the
 * table can never invalidate a code already emitted.
 */
function lzwEncodeFrame(indices) {
  const writer = new BitWriter();
  let codeSize;
  let maxCode;
  let dict;
  let freeEntry;

  function resetDict() {
    codeSize = MIN_CODE_SIZE + 1;
    maxCode = (1 << codeSize) - 1;
    dict = new Map();
    freeEntry = EOI_CODE + 1;
  }

  resetDict();
  writer.writeCode(CLEAR_CODE, codeSize);

  let prefix = -1;
  for (let i = 0; i < indices.length; i++) {
    const symbol = indices[i];
    if (prefix === -1) {
      prefix = symbol;
      continue;
    }
    const key = prefix * MAX_TABLE_SIZE + symbol;
    const known = dict.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    writer.writeCode(prefix, codeSize);
    // GIF's "early change": the code size grows using the entry count as it
    // stood *before* this iteration's own addition -- one iteration earlier
    // than the naive "table just became full" point -- because the decoder
    // can only ever add the matching entry one code behind the encoder (it
    // needs to see the *next* code before it knows the first symbol of the
    // sequence it's adding). Checking after this iteration's own add, as a
    // symmetric-looking decoder would too, desyncs the two by exactly one
    // code the moment growth actually happens.
    if (freeEntry > maxCode && codeSize < 12) {
      codeSize++;
      maxCode = (1 << codeSize) - 1;
    }
    if (freeEntry < 4096) {
      dict.set(key, freeEntry);
      freeEntry++;
    } else {
      writer.writeCode(CLEAR_CODE, codeSize);
      resetDict();
    }
    prefix = symbol;
  }
  if (prefix !== -1) writer.writeCode(prefix, codeSize);
  writer.writeCode(EOI_CODE, codeSize);
  return writer.finish();
}

function concatBytes(...parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function asciiBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function u16le(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

export function createGifEncoder({ width, height, delayCs }) {
  const colorTable = []; // index -> [r, g, b], in discovery order
  const exactIndex = new Map(); // 0xRRGGBB -> index, for colours already in the table
  const nearestIndex = new Map(); // 0xRRGGBB -> index, cached nearest-colour fallback

  let previous = null; // Uint32Array/Int32Array of the last kept frame, for diffing
  const frameChunks = [];
  let frameCount = 0;

  function indexFor(rgb) {
    const exact = exactIndex.get(rgb);
    if (exact !== undefined) return exact;
    if (colorTable.length < MAX_TABLE_SIZE) {
      const index = colorTable.length;
      colorTable.push([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]);
      exactIndex.set(rgb, index);
      return index;
    }
    // Table is full: nearest colour by squared RGB distance, cached so a
    // repeated unknown colour costs one map lookup rather than a 256-entry
    // scan per pixel.
    const cached = nearestIndex.get(rgb);
    if (cached !== undefined) return cached;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < colorTable.length; i++) {
      const [cr, cg, cb] = colorTable[i];
      const dr = cr - r;
      const dg = cg - g;
      const db = cb - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    nearestIndex.set(rgb, best);
    return best;
  }

  /** Bounding box of pixels that differ from `previous`, or null if none differ. */
  function diffBox(frame) {
    if (!previous) return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        if (frame[i] !== previous[i]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 === -1 ? null : { x0, y0, x1, y1 };
  }

  function addFrame(rgb) {
    if (rgb.length !== width * height) {
      throw new Error(`addFrame: expected ${width * height} pixels, got ${rgb.length}`);
    }
    // A frame identical to its predecessor writes a 1x1 sub-image of that
    // pixel's own current colour rather than being dropped -- a dropped frame
    // would silently shorten the recording's clock (see capture.js's fixed
    // sampling rate), where this is a true visual no-op under disposal 1.
    const box = diffBox(rgb) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
    const subW = box.x1 - box.x0 + 1;
    const subH = box.y1 - box.y0 + 1;
    const indices = new Uint8Array(subW * subH);
    for (let y = 0; y < subH; y++) {
      const srcRow = (box.y0 + y) * width + box.x0;
      const dstRow = y * subW;
      for (let x = 0; x < subW; x++) {
        indices[dstRow + x] = indexFor(rgb[srcRow + x] & 0xffffff);
      }
    }

    const lzw = lzwEncodeFrame(indices);
    // Graphic Control Extension: disposal method 1 (leave in place -- what
    // makes a partial sub-image composite onto the frame before it), no
    // transparency (packed byte's low bit stays 0; there is no reserved
    // transparent index at all -- see the design's rejection of transparency).
    const graphicControl = Uint8Array.from([
      0x21, 0xf9, 0x04,
      0x04, // disposal method 1 in bits 4-2, no transparency
      ...u16le(delayCs),
      0x00, // transparent colour index, unused
      0x00
    ]);
    const imageDescriptor = Uint8Array.from([
      0x2c,
      ...u16le(box.x0),
      ...u16le(box.y0),
      ...u16le(subW),
      ...u16le(subH),
      0x00 // no local colour table, not interlaced
    ]);

    frameChunks.push(concatBytes(graphicControl, imageDescriptor, Uint8Array.of(MIN_CODE_SIZE), lzw));
    previous = rgb.slice();
    frameCount++;
  }

  function finish() {
    // The table is always the full 256 entries (size field 7), regardless of
    // how many colours were actually discovered: the minimum LZW code size
    // is fixed at 8 in every image block (MIN_CODE_SIZE above), so a decoder
    // reading those blocks is entitled to assume a 256-entry table. Sizing
    // the Global Colour Table down to whatever was discovered (2/4/8/...)
    // would desync the table depth the header declares from the code width
    // every image block actually uses -- a real defect a phase-1 review
    // caught, not merely a wasted-bytes concern (768 bytes is nothing).
    const globalColorTable = new Uint8Array(MAX_TABLE_SIZE * 3);
    for (let i = 0; i < colorTable.length; i++) {
      const [r, g, b] = colorTable[i];
      globalColorTable[i * 3] = r;
      globalColorTable[i * 3 + 1] = g;
      globalColorTable[i * 3 + 2] = b;
    }
    // Remaining entries stay zeroed padding.

    const header = asciiBytes('GIF89a');
    const logicalScreenDescriptor = Uint8Array.from([
      ...u16le(width),
      ...u16le(height),
      0xf7, // global colour table present, colour resolution 7, size field 7 (256 entries) -- pinned, not derived
      0x00, // background colour index, unused
      0x00 // no pixel aspect ratio correction
    ]);
    // NETSCAPE2.0 application extension: loop forever.
    const netscape = concatBytes(
      Uint8Array.from([0x21, 0xff, 0x0b]),
      asciiBytes('NETSCAPE2.0'),
      Uint8Array.from([0x03, 0x01, ...u16le(0), 0x00])
    );

    return concatBytes(
      header,
      logicalScreenDescriptor,
      globalColorTable,
      netscape,
      ...frameChunks,
      Uint8Array.of(0x3b)
    );
  }

  return {
    addFrame,
    finish,
    get frameCount() {
      return frameCount;
    }
  };
}
