// Metatile rendering for the Map Forge.
//
// Every metatile is pre-rendered once to a 16x16 offscreen canvas, so painting a
// screen is 240 drawImage calls rather than 61 440 pixel writes.

import { tileFromString } from '../../../shared/chr.js';
import { NES_PALETTE } from '../../../shared/nespalette.js';
import { LIMITS, COLLISION_TYPES, tilesetAt } from '../../../shared/project.js';

export const METATILE_PX = 16;
export const SCREEN_PX_W = LIMITS.screenCols * METATILE_PX; // 256
export const SCREEN_PX_H = LIMITS.screenRows * METATILE_PX; // 240

export class MetatileRenderer {
  constructor() {
    this.cache = [];
  }

  /**
   * Re-render every metatile. Cheap enough to call on any project change.
   * `tilesetId` is the tileset the map being edited selected: the same metatile
   * draws differently depending on which CHR bank is banked in.
   */
  rebuild(project, tilesetId = 0) {
    const tiles = tilesetAt(project, tilesetId).background.tiles.map(tileFromString);
    const palettes = project.palettes.bg;
    this.cache = project.metatiles.map((metatile) => {
      const canvas = document.createElement('canvas');
      canvas.width = METATILE_PX;
      canvas.height = METATILE_PX;
      const context = canvas.getContext('2d');
      const image = context.createImageData(METATILE_PX, METATILE_PX);
      const colors = palettes[metatile.palette].map((index) => NES_PALETTE[index & 0x3f]);
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const tile = tiles[metatile.tiles[quadrant]] ?? tiles[0];
        const originX = (quadrant % 2) * 8;
        const originY = Math.floor(quadrant / 2) * 8;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const color = colors[tile[y * 8 + x]];
            const offset = ((originY + y) * METATILE_PX + originX + x) * 4;
            image.data[offset] = color[0];
            image.data[offset + 1] = color[1];
            image.data[offset + 2] = color[2];
            image.data[offset + 3] = 255;
          }
        }
      }
      context.putImageData(image, 0, 0);
      return canvas;
    });
    return this;
  }

  draw(context, id, x, y, size = METATILE_PX) {
    const source = this.cache[id] ?? this.cache[0];
    if (source) context.drawImage(source, x, y, size, size);
  }

  /** Paint a whole screen at an integer zoom. */
  drawScreen(context, screen, zoom = 1) {
    const size = METATILE_PX * zoom;
    for (let row = 0; row < LIMITS.screenRows; row++) {
      for (let col = 0; col < LIMITS.screenCols; col++) {
        this.draw(context, screen.metatiles[row * LIMITS.screenCols + col], col * size, row * size, size);
      }
    }
  }
}

/** Collision tint overlay for a screen. */
export function drawCollisionOverlay(context, screen, metatiles, zoom) {
  const size = METATILE_PX * zoom;
  for (let row = 0; row < LIMITS.screenRows; row++) {
    for (let col = 0; col < LIMITS.screenCols; col++) {
      const metatile = metatiles[screen.metatiles[row * LIMITS.screenCols + col]];
      const type = COLLISION_TYPES.find((entry) => entry.id === metatile?.collision);
      if (!type || type.id === 'open') continue;
      context.fillStyle = type.color;
      context.fillRect(col * size, row * size, size, size);
    }
  }
}

/** 16x16 metatile grid, with the 32x32 attribute blocks drawn more strongly. */
export function drawGridOverlay(context, zoom) {
  const size = METATILE_PX * zoom;
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(255,255,255,0.10)';
  context.beginPath();
  for (let col = 1; col < LIMITS.screenCols; col++) {
    context.moveTo(col * size + 0.5, 0);
    context.lineTo(col * size + 0.5, SCREEN_PX_H * zoom);
  }
  for (let row = 1; row < LIMITS.screenRows; row++) {
    context.moveTo(0, row * size + 0.5);
    context.lineTo(SCREEN_PX_W * zoom, row * size + 0.5);
  }
  context.stroke();
}
