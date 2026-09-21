// The streamed-world wire layout (docs/design-streamed-worlds.md §3): every offset, size and bit
// position of a streamed screen's record and of the per-map streamed columns, defined once.
// main/build/streamed.js emits from these, and phase 2's engine constants will be generated from
// them into config.inc; test/lib/streamdecoder.js deliberately spells the numbers out again,
// because a decoder that read this table would prove nothing about it.

import { LIMITS } from './project.js';

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
