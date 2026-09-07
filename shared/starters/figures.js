// The shared authored art every content starter uses identically
// (docs/design-starter-projects.md §5 for the player figure, §9.1 for the
// Doorway) -- original NES Game Forge pixel work. `LICENSE-ASSETS` covers
// this the same CC0-1.0 way it already covers shared/library/. No DOM, no
// Node API, nothing imported outside shared/.

import { split16 } from '../library/authoring.js';
import { PLAYER_TILES } from '../project.js';

// A small humanoid figure: idle standing and one walk step, legs shifted
// between the two so the animation is a genuine walk, not two copies of the
// same frame. Rows 13-14 are the only ones that differ between the two.
const HERO_IDLE = [
  '0000111111110000',
  '0001111111111000',
  '0011122222211100',
  '0011233223321100',
  '0011222222221100',
  '0011222222221100',
  '0001122222211000',
  '0000133333310000',
  '0001333333333100',
  '0011133333331100',
  '0011133333331100',
  '0001133333311000',
  '0000122222210000',
  '0000110000110000',
  '0001110000111000',
  '0000000000000000'
];

const HERO_WALK = [
  '0000111111110000',
  '0001111111111000',
  '0011122222211100',
  '0011233223321100',
  '0011222222221100',
  '0011222222221100',
  '0001122222211000',
  '0000133333310000',
  '0001333333333100',
  '0011133333331100',
  '0011133333331100',
  '0001133333311000',
  '0000122222210000',
  '0000011000111000',
  '0000111000011000',
  '0000000000000000'
];

// A plain dark archway: a simple frame (1), a lighter lintel highlight (2),
// and a shadowed opening (3) -- four tiles, no other pixel content.
const DOORWAY = [
  '0011111111110000',
  '0111111111111100',
  '1112222222222111',
  '1121111111112111',
  '1121333333312111',
  '1121333333312111',
  '1121333333312111',
  '1121333333312111',
  '1121333333312111',
  '1121333333312111',
  '1121333333312111',
  '1121333333312111',
  '1121333333312111',
  '1121333333312111',
  '1111111111111111',
  '0011111111110000'
];

export const HERO_IDLE_TILES = split16(HERO_IDLE);
export const HERO_WALK_TILES = split16(HERO_WALK);
export const DOORWAY_TILES = split16(DOORWAY);

/**
 * Writes the shared player figure into `tileset`'s sprite table at
 * `$00-$07` -- idle-down at `$00-$03`, one walk-down step at `$04-$07`, the
 * `PLAYER_FRAMES` layout `tools/make-rpg-sample.js`'s own `HERO` idiom
 * already uses -- and returns the 32-entry array every starter's
 * `project.sprites.playerTiles` is set to directly: the two frames just
 * written, then `null` for the 24 entries `createProject` itself would
 * leave unauthored (`up`/`left`/`right`, each two frames, plus none of
 * this).
 */
export function writePlayerFigure(tileset) {
  const sprites = tileset.sprites.tiles;
  HERO_IDLE_TILES.forEach((quadrant, index) => (sprites[index] = quadrant));
  HERO_WALK_TILES.forEach((quadrant, index) => (sprites[4 + index] = quadrant));
  // Built explicitly, not sliced from the tileset: a fresh tileset's sprite
  // table is 256 BLANK_TILE strings, not nulls, so
  // `tileset.sprites.tiles.slice(0, PLAYER_TILES)` would hand back 24 blank
  // *strings* for the unauthored frames. generateAssets (main/build/
  // generate.js) only substitutes its placeholder for `canonical !== null`
  // -- a blank string reads as "authored blank" and compiles to zero CHR
  // bytes, so the player would vanish outright facing anything but down.
  return [...HERO_IDLE_TILES, ...HERO_WALK_TILES, ...Array(PLAYER_TILES - 8).fill(null)];
}

/** Writes the shared Doorway figure's four tiles into `tileset` at `firstIndex`. */
export function writeDoorwayFigure(tileset, firstIndex) {
  const sprites = tileset.sprites.tiles;
  DOORWAY_TILES.forEach((quadrant, index) => (sprites[firstIndex + index] = quadrant));
}
