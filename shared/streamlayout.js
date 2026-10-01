// The streamed-world wire layout (docs/design-streamed-worlds.md §3): every offset, size and bit
// position of a streamed screen's record and of the per-map streamed columns, defined once.
// main/build/streamed.js emits from these, and phase 2's engine constants will be generated from
// them into config.inc; test/lib/streamdecoder.js deliberately spells the numbers out again,
// because a decoder that read this table would prove nothing about it.

import { LIMITS, actorPoseMetaspriteIds } from './project.js';

export { STREAM_TILE_BOUND, STREAM_TILE_BOUND_WITH_BOUND_TILES } from './streambound.js';

// §3 "The record": 240 bytes of raw terrain, then the entity block, then the bound-tile block.
export const STREAM_TERRAIN_BYTES = 240;

// actor, x, y, target (a global screen id, or an item id for a pickup), toX, toY, event,
// trigger, hideSwitch -- the ordinary entity record's own field order (ENTITY_RECORD in
// main/build/generate.js), unchanged.
export const STREAM_ENTITY_FIELDS = ['actor', 'x', 'y', 'target', 'toX', 'toY', 'event', 'trigger', 'hideSwitch'];
export const STREAM_ENTITY_RECORD = STREAM_ENTITY_FIELDS.length;
export const STREAM_BOUND_FIELDS = ['switchId', 'cell', 'metatileId'];
export const STREAM_BOUND_RECORD = STREAM_BOUND_FIELDS.length;

// The record is always emitted at the full, uncapped worst case: a fixed stride is what lets a
// streamed map pay no per-screen pointer.
export const STREAM_MAX_ENTITIES = LIMITS.entitiesPerScreen;
export const STREAM_MAX_BOUNDS = LIMITS.boundTilesPerScreen;

export const STREAM_OFFSETS = {
  terrain: 0,
  entityCount: STREAM_TERRAIN_BYTES,
  entities: STREAM_TERRAIN_BYTES + 1,
  boundCount: STREAM_TERRAIN_BYTES + 1 + STREAM_ENTITY_RECORD * STREAM_MAX_ENTITIES,
  bounds: STREAM_TERRAIN_BYTES + 2 + STREAM_ENTITY_RECORD * STREAM_MAX_ENTITIES
};
export const STREAM_METADATA_BYTES = 2 + STREAM_ENTITY_RECORD * STREAM_MAX_ENTITIES + STREAM_BOUND_RECORD * STREAM_MAX_BOUNDS;
export const STREAM_RECORD_BYTES = STREAM_TERRAIN_BYTES + STREAM_METADATA_BYTES;

// An 8-bit Y reaches record offsets 0-255; metadata past that is read after advancing the
// record's own base pointer by $0100 (§3 "Metadata addressing").
export const STREAM_HIGH_PAGE = 256;

// floor(8176/338): one region holds this many records of one grid row; a row is
// ceil(gridW / STREAM_SCREENS_PER_REGION) regions.
export const STREAM_SCREENS_PER_REGION = 24;

// The streamed-only per-map columns: 6 bytes charged only to a streamed map (§3 "Charge").
export const STREAM_MAP_COLUMNS = { tileset: 0, fill: 1, baseBank: 2, regionsPerRow: 3, gridW: 4, gridH: 5 };
export const STREAM_MAP_COLUMN_BYTES = 6;

/** Regions one grid row of a streamed map occupies. */
export function streamRegionsPerRow(gridW) {
  return Math.ceil(gridW / STREAM_SCREENS_PER_REGION);
}

/** Bytes of the packed 1-bit-per-map type table: ceil(mapCount / 8), bit (mapIndex & 7) of byte (mapIndex >> 3). */
export function mapTypeTableBytes(mapCount) {
  return Math.ceil(mapCount / 8);
}

// The single predicate for "does this project have a streamed map at all" -- phase 2 slice 2a.
// Every place in main/build/ that used to ask `map.streamed === true` itself routes through this
// instead, so STREAMING_ENABLED (config.inc), the streamed-worlds kernel-hi allowance and every
// other streaming-gated emission can never independently disagree about whether a project uses the
// feature.
export function projectUsesStreaming(project) {
  return project.maps.some((map) => map.streamed === true);
}

// Phase 3a slice S1 (a1): the engine's mover parity gate (engine/entities.asm, `mover_parity_gate`) is compiled on
// STREAMING_ENABLED, i.e. on this same predicate, so in a project with a streamed map every patroller and chaser on EVERY
// map -- ordinary maps included -- steps on half the bodies. The editor says so wherever it shows an actor's speed
// (renderer/forges/sprite/sprite.js); the wording and the behaviours it applies to are decided here, once.
export const STREAM_MOVER_SPEED_NOTE = 'Movers run at half speed in projects with a streamed map';
export function moverSpeedNote(project, actor) {
  return projectUsesStreaming(project) && (actor?.behavior === 'patroller' || actor?.behavior === 'chaser')
    ? STREAM_MOVER_SPEED_NOTE
    : null;
}

/** Every actor id placed on any screen of any streamed map, ascending. */
export function placedStreamedActorIds(project) {
  const ids = new Set();
  for (const map of project.maps) {
    if (map.streamed !== true) continue;
    for (const screen of map.screens) for (const entity of screen.entities ?? []) ids.add(entity.actorId);
  }
  return [...ids].sort((a, b) => a - b);
}

// Phase 3a slice S1: does this project place at least one actor on a streamed screen? THE
// predicate for the cheap streamed entity projection (engine/streamworld.asm,
// STREAM_PROJ_ENABLED) and its derived bounds. A streaming project with no placed actor keeps
// the shipped per-tile routine, where it is unreachable.
export function projectUsesStreamedActors(project) {
  return projectUsesStreaming(project) && placedStreamedActorIds(project).length > 0;
}

const signedByte = (value) => ((value & 0xff) << 24) >> 24;

/**
 * The inside class's four bounds: the smallest and largest signed tile X and Y offset over
 * every pose (actorPoseMetaspriteIds) of every actor placed on a streamed map. One set for the
 * whole project -- wide art anywhere removes the inside fast path project-wide, because the
 * engine draws one routine for every streamed screen. All zero when there is no art to bound.
 */
export function streamProjBounds(project) {
  let xmin = 127;
  let xmax = -128;
  let ymin = 127;
  let ymax = -128;
  let any = false;
  for (const id of placedStreamedActorIds(project)) {
    for (const metaspriteId of actorPoseMetaspriteIds(project.sprites.actors[id], project)) {
      for (const tile of project.sprites.metasprites[metaspriteId]?.tiles ?? []) {
        any = true;
        xmin = Math.min(xmin, signedByte(tile.x));
        xmax = Math.max(xmax, signedByte(tile.x));
        ymin = Math.min(ymin, signedByte(tile.y));
        ymax = Math.max(ymax, signedByte(tile.y));
      }
    }
  }
  if (!any) xmin = xmax = ymin = ymax = 0;
  return { OXMIN: xmin, OXMAX: xmax, OYMIN: ymin, OYMAX: ymax };
}
