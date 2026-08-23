// A PNG decoder for main/smoke.js's own use: it has to prove the bytes the
// Shot button actually wrote reconstruct into the exact pixels the canvas
// was showing, not merely that the file starts with a PNG signature. Node's
// zlib does the actual decompression -- this is only the container format
// (chunk framing, IHDR) and the per-scanline defilter, which zlib has no
// opinion about.
//
// Handles what canvas.toBlob('image/png') actually produces (8-bit RGBA or
// RGB, non-interlaced) and nothing else -- this is not a general-purpose PNG
// library.

import zlib from 'node:zlib';

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

/** The standard PNG chunk CRC-32, over the chunk's type + data bytes. */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * @param {Uint8Array|Buffer} bytes
 * @returns {{width: number, height: number, pixels: Uint8ClampedArray}}
 *   `pixels` is always RGBA, width*height*4 bytes, regardless of the source
 *   colour type -- an RGB source gets alpha 255 filled in.
 */
export function decodePng(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('pngdecode: not a PNG (bad signature)');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawIEND = false;
  const idatChunks = [];
  const KNOWN_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    const storedCrc = buf.readUInt32BE(offset + 8 + length);
    const computedCrc = crc32(buf.subarray(offset + 4, offset + 8 + length)); // type + data
    if (storedCrc !== computedCrc) {
      throw new Error(
        `pngdecode: CRC mismatch in "${type}" chunk (stored 0x${storedCrc.toString(16)}, computed 0x${computedCrc.toString(16)})`
      );
    }
    // Bit 5 of a chunk type's first byte is PNG's own ancillary/critical
    // flag (lowercase first letter = ancillary, safe to skip unread;
    // uppercase = critical, and a critical chunk this decoder does not
    // understand may change how the rest of the file must be read -- it is
    // not safe to silently step over the way an unrecognised ancillary one
    // is.
    const isAncillary = (type.charCodeAt(0) & 0x20) !== 0;
    if (!isAncillary && !KNOWN_CHUNKS.has(type)) {
      throw new Error(`pngdecode: unrecognised critical chunk "${type}"`);
    }
    if (type === 'IHDR') {
      if (length !== 13) throw new Error(`pngdecode: IHDR chunk must be exactly 13 bytes, got ${length}`);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const compressionMethod = data.readUInt8(10);
      const filterMethod = data.readUInt8(11);
      if (compressionMethod !== 0) throw new Error(`pngdecode: unsupported IHDR compression method ${compressionMethod}`);
      if (filterMethod !== 0) throw new Error(`pngdecode: unsupported IHDR filter method ${filterMethod}`);
      if (data.readUInt8(12) !== 0) throw new Error('pngdecode: interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      sawIEND = true;
      break;
    }
    offset += 8 + length + 4; // length + type + data + crc
  }
  if (!sawIEND) throw new Error('pngdecode: missing IEND chunk');
  if (!width || !height) throw new Error('pngdecode: no IHDR chunk found');
  if (bitDepth !== 8) throw new Error(`pngdecode: unsupported bit depth ${bitDepth}`);

  let channels;
  if (colorType === 6) channels = 4; // truecolour + alpha
  else if (colorType === 2) channels = 3; // truecolour
  else throw new Error(`pngdecode: unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const expectedRawLength = height * (1 + stride); // one filter-type byte + one scanline per row
  if (raw.length !== expectedRawLength) {
    throw new Error(`pngdecode: inflated stream is ${raw.length} bytes, expected exactly ${expectedRawLength} (height * (1 + stride))`);
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  let prevRow = new Uint8Array(stride);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filterType = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prevRow[x];
      const c = x >= channels ? prevRow[x - channels] : 0;
      let value = row[x];
      switch (filterType) {
        case 0:
          break;
        case 1:
          value = (value + a) & 0xff;
          break;
        case 2:
          value = (value + b) & 0xff;
          break;
        case 3:
          value = (value + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          value = (value + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`pngdecode: unknown filter type ${filterType}`);
      }
      out[x] = value;
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      pixels[dst] = out[src];
      pixels[dst + 1] = out[src + 1];
      pixels[dst + 2] = out[src + 2];
      pixels[dst + 3] = channels === 4 ? out[src + 3] : 255;
    }
    prevRow = out;
  }

  return { width, height, pixels };
}
