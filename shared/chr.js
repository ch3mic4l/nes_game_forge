// NES 2bpp planar CHR encoding/decoding.
//
// A tile is 8x8 pixels, each pixel a palette slot 0-3. On the NES it is stored as
// 16 bytes: 8 bytes of bit-plane 0 (one byte per row) followed by 8 bytes of
// bit-plane 1. Internally the Forge keeps tiles as 64-character strings of the
// digits 0-3 so projects stay diffable in git.

export const TILE_PIXELS = 64;
export const TILE_BYTES = 16;

/** Encode 64 palette slots into 16 planar bytes. */
export function encodeTile(pixels, out = new Uint8Array(TILE_BYTES), offset = 0) {
  for (let plane = 0; plane < 2; plane++) {
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) {
        byte |= ((pixels[y * 8 + x] >> plane) & 1) << (7 - x);
      }
      out[offset + plane * 8 + y] = byte;
    }
  }
  return out;
}

/** Decode 16 planar bytes at `offset` into 64 palette slots. */
export function decodeTile(bytes, offset = 0) {
  const tile = new Uint8Array(TILE_PIXELS);
  for (let y = 0; y < 8; y++) {
    const low = bytes[offset + y];
    const high = bytes[offset + 8 + y];
    for (let x = 0; x < 8; x++) {
      tile[y * 8 + x] = ((low >> (7 - x)) & 1) | (((high >> (7 - x)) & 1) << 1);
    }
  }
  return tile;
}

/** Encode an array of tiles (pixel arrays or 64-char strings) into a CHR blob. */
export function encodeTiles(tiles) {
  const out = new Uint8Array(tiles.length * TILE_BYTES);
  tiles.forEach((tile, index) => {
    encodeTile(typeof tile === 'string' ? tileFromString(tile) : tile, out, index * TILE_BYTES);
  });
  return out;
}

/** Decode a CHR blob into an array of 64-entry pixel arrays. */
export function decodeChr(bytes) {
  if (!bytes.length || bytes.length % TILE_BYTES !== 0) {
    throw new Error('CHR data must be a whole number of 16-byte tiles.');
  }
  const tiles = [];
  for (let offset = 0; offset < bytes.length; offset += TILE_BYTES) {
    tiles.push(decodeTile(bytes, offset));
  }
  return tiles;
}

/** 64 palette slots -> the 64-character storage form. */
export function tileToString(pixels) {
  let out = '';
  for (let i = 0; i < TILE_PIXELS; i++) out += (pixels[i] & 3).toString();
  return out;
}

/** The 64-character storage form -> 64 palette slots. */
export function tileFromString(text) {
  const tile = new Uint8Array(TILE_PIXELS);
  if (typeof text !== 'string') return tile;
  for (let i = 0; i < TILE_PIXELS && i < text.length; i++) {
    const value = text.charCodeAt(i) - 48;
    tile[i] = value >= 0 && value <= 3 ? value : 0;
  }
  return tile;
}

export const BLANK_TILE = '0'.repeat(TILE_PIXELS);

export function isBlank(tile) {
  return tile === BLANK_TILE;
}

/** Flip a 64-slot tile horizontally and/or vertically. */
export function flipTile(pixels, horizontal, vertical) {
  const out = new Uint8Array(TILE_PIXELS);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sx = horizontal ? 7 - x : x;
      const sy = vertical ? 7 - y : y;
      out[y * 8 + x] = pixels[sy * 8 + sx];
    }
  }
  return out;
}
