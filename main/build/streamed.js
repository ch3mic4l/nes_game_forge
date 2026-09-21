// The build-time emitter for a streamed map's data (docs/design-streamed-worlds.md §3): pure
// functions over a normalized project returning bytes plus a structured description. Imports
// only from shared/, the same rule battletables.js follows, so the renderer can use it later.
//
// Phase 1 refuses to build any streamed project (checkCapacity), so nothing here reaches a ROM
// yet and generate.js does not call it; it is exported for the phase 2 engine and pinned by
// test/unit/streamedlayout.test.js against the independent test/lib/streamdecoder.js.

import { LIMITS } from '../../shared/project.js';
import {
  STREAM_TERRAIN_BYTES,
  STREAM_ENTITY_FIELDS,
  STREAM_ENTITY_RECORD,
  STREAM_BOUND_FIELDS,
  STREAM_BOUND_RECORD,
  STREAM_MAX_ENTITIES,
  STREAM_MAX_BOUNDS,
  STREAM_OFFSETS,
  STREAM_RECORD_BYTES,
  STREAM_SCREENS_PER_REGION,
  STREAM_MAP_COLUMNS,
  STREAM_MAP_COLUMN_BYTES,
  streamRegionsPerRow,
  mapTypeTableBytes
} from '../../shared/streamlayout.js';

const NO_EVENT = 0xff; // main/build/textcompile.js's own value; that module is not importable from here.

function byteOf(value, what) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`streamed layout: ${what} is ${value}, which is not a byte`);
  }
  return value;
}

/**
 * The default entity field resolution; generate.js's own resolution (the item-id byte, the
 * compiled event, the effective trigger) is passed in as `entityFields` when it is wired.
 * `total` is the project's final screen total, the clamp the ordinary door byte already uses.
 */
function defaultEntityFields(entity, total) {
  return {
    target: Math.min(entity.props?.toScreen ?? 0, Math.max(0, total - 1)),
    event: NO_EVENT,
    trigger: 0,
    hideSwitch: entity.props?.hideSwitch ?? 0xff
  };
}

/** One streamed screen's record: exactly STREAM_RECORD_BYTES, unused entity/bound slots zero. */
export function emitStreamedScreenRecord(screen, map, total, entityFields = defaultEntityFields) {
  if (screen.metatiles.length !== STREAM_TERRAIN_BYTES) {
    throw new RangeError(`streamed layout: a screen holds ${screen.metatiles.length} metatiles, not ${STREAM_TERRAIN_BYTES}`);
  }
  const entities = screen.entities ?? [];
  const bound = screen.boundTiles ?? [];
  if (entities.length > STREAM_MAX_ENTITIES) {
    throw new RangeError(`streamed layout: ${entities.length} actors on one screen, the record holds ${STREAM_MAX_ENTITIES}`);
  }
  if (bound.length > STREAM_MAX_BOUNDS) {
    throw new RangeError(`streamed layout: ${bound.length} bound tiles on one screen, the record holds ${STREAM_MAX_BOUNDS}`);
  }
  const bytes = new Array(STREAM_RECORD_BYTES).fill(0);
  screen.metatiles.forEach((id, i) => {
    bytes[STREAM_OFFSETS.terrain + i] = byteOf(id, 'a metatile id');
  });
  bytes[STREAM_OFFSETS.entityCount] = entities.length;
  entities.forEach((entity, i) => {
    const f = { ...defaultEntityFields(entity, total), ...entityFields(entity, total) };
    const at = STREAM_OFFSETS.entities + i * STREAM_ENTITY_RECORD;
    const values = {
      actor: entity.actorId,
      x: entity.x,
      y: entity.y,
      target: f.target,
      toX: entity.props?.toX ?? 0,
      toY: entity.props?.toY ?? 0,
      event: f.event,
      trigger: f.trigger,
      hideSwitch: f.hideSwitch
    };
    STREAM_ENTITY_FIELDS.forEach((name, k) => {
      bytes[at + k] = byteOf(values[name], `an entity ${name}`);
    });
  });
  bytes[STREAM_OFFSETS.boundCount] = bound.length;
  bound.forEach((entry, i) => {
    const at = STREAM_OFFSETS.bounds + i * STREAM_BOUND_RECORD;
    const values = {
      switchId: entry.switchId,
      cell: entry.row * LIMITS.screenCols + entry.col,
      metatileId: entry.metatileId
    };
    STREAM_BOUND_FIELDS.forEach((name, k) => {
      bytes[at + k] = byteOf(values[name], `a bound tile ${name}`);
    });
  });
  return bytes;
}

/**
 * Walks the maps in project order with the contract's three counters and returns:
 *   mapBase      one global id base per map (the single base-id field either map type uses)
 *   total        the final screen total, the generated constant the id walk ends on
 *   typeBits     the packed 1-bit-per-map type table, indexed by raw map index
 *   streamedColumns  the 6 streamed-only bytes per streamed map, in streamedMapIndex order
 *   maps         per map: { mapIndex, streamed, base, count, ordinaryStart, streamedMapIndex,
 *                  regions: [{ row, chunk, region, bytes }] } (regions only for a streamed map)
 * `options.firstRegion` is the region index the first streamed map's locator starts at
 * (placement is slice B2's; a caller with a real allocator passes its own `baseBanks`, one per
 * streamed map). Region indices otherwise run consecutively from `firstRegion`.
 */
export function emitStreamedLayout(project, options = {}) {
  const { firstRegion = 0, baseBanks = null, entityFields } = options;
  const total = project.maps.reduce(
    (sum, map) => sum + (map.streamed === true ? map.gridW * map.gridH : map.screens.length),
    0
  );
  if (total > LIMITS.projectScreens) {
    throw new RangeError(`streamed layout: ${total} screens exceeds the ${LIMITS.projectScreens}-screen ceiling`);
  }
  const mapBase = [];
  const typeBits = new Array(mapTypeTableBytes(project.maps.length)).fill(0);
  const streamedColumns = [];
  const maps = [];
  let nextGlobalId = 0;
  let ordinaryIndex = 0;
  let streamedMapIndex = 0;
  let nextRegion = firstRegion;
  project.maps.forEach((map, mapIndex) => {
    const base = nextGlobalId;
    mapBase.push(base);
    if (!map.streamed) {
      maps.push({ mapIndex, streamed: false, base, count: map.screens.length, ordinaryStart: ordinaryIndex });
      ordinaryIndex += map.screens.length;
      nextGlobalId += map.screens.length;
      return;
    }
    typeBits[mapIndex >> 3] |= 1 << (mapIndex & 7);
    const perRow = streamRegionsPerRow(map.gridW);
    const baseBank = byteOf(baseBanks ? baseBanks[streamedMapIndex] : nextRegion, 'a streamed map base bank');
    nextRegion = baseBank + map.gridH * perRow;
    const columns = new Array(STREAM_MAP_COLUMN_BYTES).fill(0);
    columns[STREAM_MAP_COLUMNS.tileset] = byteOf(map.tilesetId, 'a streamed map tileset');
    columns[STREAM_MAP_COLUMNS.fill] = byteOf(map.fillMetatileId ?? 0, 'a streamed map fill metatile');
    columns[STREAM_MAP_COLUMNS.baseBank] = baseBank;
    columns[STREAM_MAP_COLUMNS.regionsPerRow] = perRow;
    columns[STREAM_MAP_COLUMNS.gridW] = byteOf(map.gridW, 'a streamed map width');
    columns[STREAM_MAP_COLUMNS.gridH] = byteOf(map.gridH, 'a streamed map height');
    streamedColumns.push(...columns);
    const regions = [];
    for (let row = 0; row < map.gridH; row++) {
      for (let chunk = 0; chunk < perRow; chunk++) {
        const bytes = [];
        const from = chunk * STREAM_SCREENS_PER_REGION;
        const to = Math.min(map.gridW, from + STREAM_SCREENS_PER_REGION);
        for (let col = from; col < to; col++) {
          bytes.push(...emitStreamedScreenRecord(map.screens[row * map.gridW + col], map, total, entityFields));
        }
        regions.push({ row, chunk, region: baseBank + row * perRow + chunk, bytes });
      }
    }
    maps.push({ mapIndex, streamed: true, base, count: map.gridW * map.gridH, streamedMapIndex, regions });
    streamedMapIndex += 1;
    nextGlobalId += map.gridW * map.gridH;
  });
  return { mapBase, total, typeBits, streamedColumns, maps };
}

/**
 * The runtime map-order prefix walk, run at generate time: the owner of a global screen id, the
 * first map whose range [base, next base) holds it. An ordinary owner answers its compacted
 * ordinaryIndex (the ordinary screens emitted before the owner, plus the offset within it); a
 * streamed owner answers its streamedMapIndex and the (screenCol, screenRow) sw_goto takes.
 * Null for an id past the total.
 */
export function resolveGlobalScreen(layout, id) {
  if (!Number.isInteger(id) || id < 0 || id >= layout.total) return null;
  let ordinaryPrefix = 0;
  let streamedPrefix = 0;
  for (let mapIndex = 0; mapIndex < layout.mapBase.length; mapIndex++) {
    const next = mapIndex + 1 < layout.mapBase.length ? layout.mapBase[mapIndex + 1] : layout.total;
    const streamed = ((layout.typeBits[mapIndex >> 3] >> (mapIndex & 7)) & 1) === 1;
    if (id < next) {
      const offset = id - layout.mapBase[mapIndex];
      if (!streamed) return { mapIndex, streamed, ordinaryIndex: ordinaryPrefix + offset };
      const gridW = layout.streamedColumns[streamedPrefix * STREAM_MAP_COLUMN_BYTES + STREAM_MAP_COLUMNS.gridW];
      return { mapIndex, streamed, streamedMapIndex: streamedPrefix, screenCol: offset % gridW, screenRow: Math.floor(offset / gridW) };
    }
    if (streamed) streamedPrefix += 1;
    else ordinaryPrefix += next - layout.mapBase[mapIndex];
  }
  return null;
}
