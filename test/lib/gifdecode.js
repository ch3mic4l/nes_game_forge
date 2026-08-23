// An independent GIF89a decoder, written against the spec rather than
// against renderer/emulator/gif.js -- the whole point of gif.test.js is that
// a header-byte assertion alone would pass on an encoder that writes a
// valid-looking file no viewer actually reads. Plain ESM, no test-runner
// dependency: test/unit/gif.test.js uses it today, and a phase-2 smoke test
// (which runs outside node:test, inside the real Electron main process) is
// meant to reuse it unchanged.
//
// decodeGif(bytes) -> {
//   width, height, loopCount,
//   frames: [{ delayCs, disposal, clearCount, clearEvents, subImage: {x,y,width,height}, pixels }]
// }
// `clearEvents` is one entry per Clear code seen in that frame's own LZW
// stream, `{nextCodeBefore, decodedLengthBefore}` -- nextCodeBefore is the
// dictionary size the moment the Clear was read, which is how a test proves
// a Clear happened at genuine exhaustion (4096) rather than merely existing.
// `pixels` is a width*height Uint32Array of 0xRRGGBB -- the full logical
// screen composited up to and including that frame, disposal already applied
// for everything before it.

class ByteReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  u8() {
    return this.bytes[this.pos++];
  }
  u16() {
    const lo = this.u8();
    const hi = this.u8();
    return lo | (hi << 8);
  }
  take(n) {
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  ascii(n) {
    return String.fromCharCode(...this.take(n));
  }
  /** Concatenates GIF's length-prefixed data sub-blocks up to the 0-length terminator. */
  subBlocks() {
    const chunks = [];
    let total = 0;
    for (;;) {
      const size = this.u8();
      if (size === 0) break;
      const chunk = this.take(size);
      chunks.push(chunk);
      total += size;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** Unpacks LSB-first variable-width codes from GIF's LZW sub-block bytes. */
class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.buffer = 0;
    this.bitCount = 0;
  }
  readCode(size) {
    while (this.bitCount < size) {
      this.buffer |= (this.bytes[this.pos++] ?? 0) << this.bitCount;
      this.bitCount += 8;
    }
    const code = this.buffer & ((1 << size) - 1);
    this.buffer >>= size;
    this.bitCount -= size;
    return code;
  }
}

/**
 * Decodes one frame's LZW stream into palette indices, mirroring the
 * CompuServe reference algorithm's code-size growth exactly (grow when the
 * code just assigned exceeds the current width's max) -- get this out of
 * step with the encoder's own growth timing and codes silently point at the
 * wrong dictionary entries instead of failing loudly.
 */
function lzwDecodeFrame(data, minCodeSize) {
  // GIF89a Appendix F: the LZW minimum code size is 2-8 inclusive (2 is the
  // smallest that leaves room for a Clear and EOI code above the literals,
  // 8 is the largest a single byte of pixel data can need). Anything outside
  // that is not a size a conforming encoder would ever write -- accepting it
  // anyway is exactly the matched-pair hazard this decoder exists to catch.
  if (minCodeSize < 2 || minCodeSize > 8) {
    throw new Error(`gifdecode: LZW minimum code size ${minCodeSize} outside the legal 2-8 range`);
  }
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const reader = new BitReader(data);
  const output = [];
  let codeSize, maxCode, dict, nextCode, prevSeq;
  let clearCount = 0;
  const clearEvents = []; // {nextCodeBefore, decodedLengthBefore}, one per Clear seen, in order

  function reset() {
    codeSize = minCodeSize + 1;
    maxCode = (1 << codeSize) - 1;
    dict = [];
    for (let i = 0; i < clearCode; i++) dict[i] = [i];
    nextCode = eoiCode + 1;
    prevSeq = null;
  }

  reset();
  for (;;) {
    const code = reader.readCode(codeSize);
    if (code === clearCode) {
      clearEvents.push({ nextCodeBefore: nextCode, decodedLengthBefore: output.length });
      clearCount++;
      reset();
      continue;
    }
    if (code === eoiCode) break;

    let seq;
    if (code < dict.length && dict[code]) {
      seq = dict[code];
    } else if (code === nextCode && prevSeq) {
      seq = prevSeq.concat([prevSeq[0]]);
    } else {
      throw new Error(`gifdecode: invalid LZW code ${code}`);
    }
    for (const symbol of seq) output.push(symbol);

    // The decoder's own addition always lags the encoder's by exactly one
    // code (it needs this code's first symbol before it can complete the
    // entry the encoder already added when *it* emitted the previous code),
    // so nextCode here reads one lower than the encoder's own counter did at
    // the equivalent point -- the +1 below is what puts the growth check back
    // on the same entry count the encoder's "early change" checked against.
    if (nextCode + 1 > maxCode && codeSize < 12) {
      codeSize++;
      maxCode = (1 << codeSize) - 1;
    }
    if (prevSeq && nextCode < 4096) {
      dict[nextCode] = prevSeq.concat([seq[0]]);
      nextCode++;
    }
    prevSeq = seq;
  }
  // clearCount includes the stream's own mandatory leading Clear; a value
  // greater than 1 is what shows the table actually filled and was reset --
  // clearEvents[k].nextCodeBefore is what proves *where*: a Clear forced by
  // genuine exhaustion always lands with the dictionary at exactly 4096
  // entries, not merely somewhere past the first.
  return { indices: output, clearCount, clearEvents };
}

function readColorTable(reader, entryCount) {
  const table = new Array(entryCount);
  for (let i = 0; i < entryCount; i++) {
    const r = reader.u8();
    const g = reader.u8();
    const b = reader.u8();
    table[i] = (r << 16) | (g << 8) | b;
  }
  return table;
}

export function decodeGif(bytes) {
  const reader = new ByteReader(bytes);
  const signature = reader.ascii(6);
  if (signature !== 'GIF89a' && signature !== 'GIF87a') {
    throw new Error(`gifdecode: not a GIF (saw "${signature}")`);
  }

  const width = reader.u16();
  const height = reader.u16();
  const lsdPacked = reader.u8();
  const backgroundColorIndex = reader.u8();
  reader.u8(); // pixel aspect ratio, unused

  const hasGlobalTable = (lsdPacked & 0x80) !== 0;
  let globalTable = null;
  if (hasGlobalTable) {
    const globalSize = 2 << (lsdPacked & 0x07);
    globalTable = readColorTable(reader, globalSize);
  }
  // Disposal method 2 ("restore to background") restores to *this* colour,
  // not black -- a decoder that always fills black composites differently
  // from a conforming one whenever the background index isn't colour 0.
  const backgroundColor =
    hasGlobalTable && backgroundColorIndex < globalTable.length ? globalTable[backgroundColorIndex] : 0;

  const canvas = new Uint32Array(width * height);
  const frames = [];
  let loopCount = undefined;
  let pendingDelay = 0;
  let pendingDisposal = 0;
  let pendingTransparentIndex = -1;
  let restoreState = null; // {x,y,w,h,pixels} saved for disposal method 3
  let priorDisposal = 0;
  let priorRegion = null;

  for (;;) {
    const marker = reader.u8();
    if (marker === 0x3b) break; // trailer

    if (marker === 0x21) {
      const label = reader.u8();
      if (label === 0xf9) {
        const blockSize = reader.u8();
        if (blockSize !== 4) {
          throw new Error(`gifdecode: Graphic Control Extension block size ${blockSize}, expected 4`);
        }
        const packed = reader.u8();
        const delay = reader.u16();
        const transparentIndex = reader.u8();
        const terminator = reader.u8();
        if (terminator !== 0x00) {
          throw new Error(`gifdecode: Graphic Control Extension missing its 0x00 terminator, saw 0x${terminator.toString(16)}`);
        }
        pendingDisposal = (packed >> 2) & 0x07;
        pendingTransparentIndex = (packed & 0x01) !== 0 ? transparentIndex : -1;
        pendingDelay = delay;
      } else if (label === 0xff) {
        const blockSize = reader.u8(); // always 11
        const appId = reader.ascii(blockSize);
        const data = reader.subBlocks();
        if (appId === 'NETSCAPE2.0' && data.length >= 3 && data[0] === 0x01) {
          loopCount = data[1] | (data[2] << 8);
        }
      } else {
        reader.u8(); // block size of whatever comment/plain-text header follows
        reader.subBlocks();
      }
      continue;
    }

    if (marker === 0x2c) {
      const left = reader.u16();
      const top = reader.u16();
      const subW = reader.u16();
      const subH = reader.u16();
      if (left + subW > width || top + subH > height) {
        throw new Error(
          `gifdecode: sub-image at (${left},${top}) sized ${subW}x${subH} extends outside the ${width}x${height} logical screen`
        );
      }
      const idPacked = reader.u8();
      const hasLocalTable = (idPacked & 0x80) !== 0;
      const interlaced = (idPacked & 0x40) !== 0;
      if (interlaced) throw new Error('gifdecode: interlaced images are not supported');
      let palette = globalTable;
      if (hasLocalTable) {
        const localSize = 2 << (idPacked & 0x07);
        palette = readColorTable(reader, localSize);
      }

      const minCodeSize = reader.u8();
      const imageData = reader.subBlocks();
      const { indices, clearCount, clearEvents } = lzwDecodeFrame(imageData, minCodeSize);
      if (indices.length !== subW * subH) {
        throw new Error(`gifdecode: decoded ${indices.length} pixels, expected ${subW * subH}`);
      }

      // Apply the *previous* frame's disposal now, immediately before this
      // frame is drawn -- per spec that action happens after a frame has
      // been shown for its delay and before the next one is composited.
      if (priorDisposal === 2 && priorRegion) {
        for (let y = 0; y < priorRegion.h; y++) {
          const row = (priorRegion.y + y) * width + priorRegion.x;
          canvas.fill(backgroundColor, row, row + priorRegion.w);
        }
      } else if (priorDisposal === 3 && restoreState) {
        const { x, y, w, h, pixels } = restoreState;
        for (let row = 0; row < h; row++) {
          canvas.set(pixels.subarray(row * w, row * w + w), (y + row) * width + x);
        }
      }

      if (pendingDisposal === 3) {
        const saved = new Uint32Array(subW * subH);
        for (let row = 0; row < subH; row++) {
          saved.set(canvas.subarray((top + row) * width + left, (top + row) * width + left + subW), row * subW);
        }
        restoreState = { x: left, y: top, w: subW, h: subH, pixels: saved };
      }

      for (let y = 0; y < subH; y++) {
        for (let x = 0; x < subW; x++) {
          const index = indices[y * subW + x];
          if (index === pendingTransparentIndex) continue;
          if (index < 0 || index >= palette.length) {
            throw new Error(`gifdecode: colour index ${index} outside the ${palette.length}-entry palette`);
          }
          canvas[(top + y) * width + (left + x)] = palette[index];
        }
      }

      frames.push({
        delayCs: pendingDelay,
        disposal: pendingDisposal,
        clearCount,
        clearEvents,
        subImage: { x: left, y: top, width: subW, height: subH },
        pixels: canvas.slice()
      });

      priorDisposal = pendingDisposal;
      priorRegion = { x: left, y: top, w: subW, h: subH };
      pendingDisposal = 0;
      pendingTransparentIndex = -1;
      pendingDelay = 0;
      continue;
    }

    throw new Error(`gifdecode: unknown block marker 0x${marker.toString(16)}`);
  }

  return { width, height, loopCount, frames };
}
