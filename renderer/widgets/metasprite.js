// A metasprite compositor, extracted from the Sprite Forge
// (renderer/forges/sprite/sprite.js's own `paintMetasprite`/`drawPreviewOnly`)
// so the Character Forge's own read-only preview card can use the identical
// drawing rules -- a signature-widening extraction, not new drawing logic.
// `paintMetasprite` stays DOM- and Node-free so `node:test` can import it
// directly; `drawMetaspritePreview` is a thin canvas wrapper for renderer code.

import { flipTile } from '../../shared/chr.js';
import { NES_PALETTE } from '../../shared/nespalette.js';

/** Paint a metasprite into an ImageData-shaped buffer at a given origin. */
export function paintMetasprite(data, width, metasprite, originX, originY, decodedTiles, spritePalettes) {
  if (!metasprite) return;
  for (const entry of metasprite.tiles) {
    let pixels = decodedTiles[entry.tile] ?? decodedTiles[0];
    if (entry.hflip || entry.vflip) pixels = flipTile(pixels, entry.hflip, entry.vflip);
    const colors = spritePalettes[entry.palette].map((index) => NES_PALETTE[index & 0x3f]);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const slot = pixels[y * 8 + x];
        if (slot === 0) continue; // sprite slot 0 is transparent
        const px = originX + entry.x + x;
        const py = originY + entry.y + y;
        if (px < 0 || py < 0 || px >= width || py >= width) continue;
        const color = colors[slot];
        const offset = (py * width + px) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = 255;
      }
    }
  }
}

const VIEW = 64;
const ORIGIN = 16;

/** Draw a metasprite standalone onto a canvas, matching drawPreviewOnly's own shape. */
export function drawMetaspritePreview(canvas, metasprite, decodedTiles, spritePalettes) {
  const zoom = 4;
  canvas.width = VIEW;
  canvas.height = VIEW;
  canvas.style.width = `${VIEW * zoom}px`;
  canvas.style.height = `${VIEW * zoom}px`;
  const context = canvas.getContext('2d');
  const image = context.createImageData(VIEW, VIEW);
  paintMetasprite(image.data, VIEW, metasprite, ORIGIN, ORIGIN, decodedTiles, spritePalettes);
  context.putImageData(image, 0, 0);
}
