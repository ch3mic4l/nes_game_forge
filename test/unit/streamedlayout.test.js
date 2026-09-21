// Streamed worlds, phase 1 slice B1: the emitted layout (docs/design-streamed-worlds.md §3),
// round-tripped through test/lib/streamdecoder.js, which is written from the contract and never
// reads the layout table. Every test names the wrong implementation it would catch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createMap, createScreen } from '../../shared/project.js';
import { flattenScreens } from '../../main/build/generate.js';
import { emitStreamedLayout, emitStreamedScreenRecord, resolveGlobalScreen } from '../../main/build/streamed.js';
import {
  STREAM_RECORD_BYTES,
  STREAM_SCREENS_PER_REGION,
  STREAM_OFFSETS,
  STREAM_MAP_COLUMN_BYTES,
  STREAM_ENTITY_FIELDS,
  STREAM_BOUND_FIELDS,
  STREAM_HIGH_PAGE
} from '../../shared/streamlayout.js';
import { decodeStreamedLayout } from '../lib/streamdecoder.js';

// A map of the given grid; every screen's terrain is distinct (id-derived), so a screen read
// from the wrong offset, region or map can never coincide with the right one.
let serial = 0;
const makeMap = (project, name, w, h, streamed, extra = {}) => {
  const map = createMap(project.maps.length, name);
  map.gridW = w;
  map.gridH = h;
  map.screens = Array.from({ length: w * h }, () => {
    const s = createScreen();
    const k = serial++;
    s.metatiles = s.metatiles.map((_, i) => (i * 3 + k * 5 + (i >> 4)) & 255);
    return s;
  });
  if (streamed) map.streamed = true;
  Object.assign(map, extra);
  project.maps.push(map);
  return map;
};
const blank = () => {
  const p = createProject('Layout');
  p.maps = [];
  return p;
};
const ent = (actorId, x, y, props = {}) => ({ actorId, x, y, props });

test('the record layout is pinned by literal offsets from the contract', () => {
  // A layout table edited without the contract (a 9-slot entity block, a bound block before the
  // entities) fails here, because these numbers are the contract's, not the table's.
  assert.equal(STREAM_RECORD_BYTES, 338); // §3: 240 + 73 + 25
  assert.equal(STREAM_SCREENS_PER_REGION, 24); // §3: floor(8176/338)
  assert.equal(STREAM_MAP_COLUMN_BYTES, 6);
  assert.deepEqual(
    { ...STREAM_OFFSETS },
    { terrain: 0, entityCount: 240, entities: 241, boundCount: 313, bounds: 314 }
  );
});

test('the exported field orders are pinned literally: they are a future engine ABI', () => {
  // Catches two names swapped in either table; the emitter serializes through these orders, so a
  // swap would otherwise change the wire silently while the decoder (literal offsets) is the only judge.
  assert.deepEqual([...STREAM_ENTITY_FIELDS], ['actor', 'x', 'y', 'target', 'toX', 'toY', 'event', 'trigger', 'hideSwitch']);
  assert.deepEqual([...STREAM_BOUND_FIELDS], ['switchId', 'cell', 'metatileId']);
  // This proves only the constant. Phase 2's engine tests must exercise the real pointer rebase.
  assert.equal(STREAM_HIGH_PAGE, 256);
});

test('a streamed map with a NONZERO base: a door to a screen of its own map keeps its global id', () => {
  // Catches subtracting the map base from door targets (right only when the base is 0).
  const p = blank();
  makeMap(p, 'A', 2, 1, false); // ids 0,1
  const m = makeMap(p, 'S', 3, 1, true); // ids 2-4, base 2
  m.screens[0].entities.push(ent(1, 5, 6, { toScreen: 4 }));
  const layout = emitStreamedLayout(p);
  assert.equal(layout.mapBase[1], 2);
  assert.equal(decodeStreamedLayout(layout).screen(1, 0, 0).entities[0].target, 4);
});

test('the production resolver answers streamed owners: map, streamed index, column and row', () => {
  // Catches resolveGlobalScreen returning null / the ordinary shape for a streamed owner
  // (the earlier tests only judged streamed ids through the decoder's own resolver).
  const p = blank();
  makeMap(p, 'A', 2, 1, false);
  makeMap(p, 'S', 3, 2, true); // ids 2-7
  makeMap(p, 'S2', 2, 1, true); // ids 8-9
  const layout = emitStreamedLayout(p);
  assert.deepEqual(resolveGlobalScreen(layout, 2), { mapIndex: 1, streamed: true, streamedMapIndex: 0, screenCol: 0, screenRow: 0 });
  assert.deepEqual(resolveGlobalScreen(layout, 6), { mapIndex: 1, streamed: true, streamedMapIndex: 0, screenCol: 1, screenRow: 1 });
  assert.deepEqual(resolveGlobalScreen(layout, 9), { mapIndex: 2, streamed: true, streamedMapIndex: 1, screenCol: 1, screenRow: 0 });
});

test('a 1x1 streamed map round-trips: terrain, columns, the type bit, one 338-byte record', () => {
  // Catches a record padded to 304 (ordinary shape, baked attributes) or 340, and a locator
  // written in the wrong column order.
  const p = blank();
  const m = makeMap(p, 'One', 1, 1, true, { tilesetId: 3 });
  m.screens[0].entities.push(ent(2, 40, 50, { toScreen: 0, toX: 7, toY: 9 }));
  const layout = emitStreamedLayout(p);
  assert.equal(layout.total, 1);
  assert.deepEqual(layout.typeBits, [1]);
  assert.deepEqual(layout.streamedColumns, [3, 0, 0, 1, 1, 1]);
  assert.equal(layout.maps[0].regions.length, 1);
  assert.equal(layout.maps[0].regions[0].bytes.length, 338);
  const d = decodeStreamedLayout(layout);
  const s = d.screen(0, 0, 0);
  assert.deepEqual([...s.terrain], m.screens[0].metatiles);
  assert.deepEqual(s.entities, [{ actor: 2, x: 40, y: 50, target: 0, toX: 7, toY: 9, event: 255, trigger: 0, hideSwitch: 255 }]);
});

test('a 3x2 map: every screen decodes to its own terrain, entities, bindings and warp targets', () => {
  // Catches row-major/column-major transposition, per-screen entity lists swapped or shared, and
  // entity data only surviving on the first screen.
  const p = blank();
  const m = makeMap(p, 'Grid', 3, 2, true);
  m.screens[4].entities.push(ent(1, 10, 20, { toScreen: 5, toX: 3, toY: 4, hideSwitch: 6 }), ent(9, 200, 100));
  m.screens[5].entities.push(ent(4, 8, 8, { toScreen: 0 }));
  m.screens[4].boundTiles.push({ switchId: 3, row: 2, col: 5, metatileId: 77 });
  m.screens[2].boundTiles.push({ switchId: 9, row: 15, col: 15, metatileId: 255 });
  const events = new Map([[m.screens[4].entities[0], 42]]);
  const layout = emitStreamedLayout(p, {
    entityFields: (e) => ({ event: events.get(e) ?? 255, trigger: e.actorId === 9 ? 2 : 1 })
  });
  const d = decodeStreamedLayout(layout);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const s = d.screen(0, col, row);
      assert.deepEqual([...s.terrain], m.screens[row * 3 + col].metatiles, `terrain ${col},${row}`);
    }
  }
  assert.deepEqual(d.screen(0, 1, 1).entities, [
    { actor: 1, x: 10, y: 20, target: 5, toX: 3, toY: 4, event: 42, trigger: 1, hideSwitch: 6 },
    { actor: 9, x: 200, y: 100, target: 0, toX: 0, toY: 0, event: 255, trigger: 2, hideSwitch: 255 }
  ]);
  assert.deepEqual(d.screen(0, 2, 1).entities.map((e) => e.actor), [4]);
  assert.deepEqual(d.screen(0, 0, 0).entities, []);
  assert.deepEqual(d.screen(0, 1, 1).bound, [{ switchId: 3, cell: 2 * 16 + 5, metatileId: 77 }]);
  assert.deepEqual(d.screen(0, 2, 0).bound, [{ switchId: 9, cell: 255, metatileId: 255 }]);
});

test('every screen record is exactly 338 bytes: an empty screen does not shift its neighbour', () => {
  // Catches a variable-length (packed) record: screen 1's entity would land at the wrong offset.
  const p = blank();
  const m = makeMap(p, 'Stride', 3, 1, true);
  m.screens[2].entities.push(ent(5, 1, 2));
  const layout = emitStreamedLayout(p);
  assert.equal(layout.maps[0].regions[0].bytes.length, 3 * 338);
  const r = layout.maps[0].regions[0].bytes;
  assert.equal(r[2 * 338 + 240], 1);
  assert.equal(r[338 + 240], 0);
  // unused entity/bound slots are zero, not stale
  assert.ok(r.slice(338 + 241, 338 + 338).every((b) => b === 0));
});

test('a MIXED project: ordinary map ids and numbering are unchanged by the streamed map', () => {
  // Catches the "raw flat_screen is the ordinary index" exception the contract removed (§3 worked
  // example), a streamed map advancing the ordinary counter, and a compact index taken by raw map index.
  const p = blank();
  makeMap(p, 'A', 2, 1, false); // ids 0,1  ordinary 0,1
  makeMap(p, 'S', 2, 2, true); //  ids 2-5  streamed 0
  makeMap(p, 'B', 3, 1, false); // ids 6-8  ordinary 2,3,4
  makeMap(p, 'S2', 1, 1, true); // id 9     streamed 1
  const layout = emitStreamedLayout(p);
  assert.deepEqual(layout.mapBase, [0, 2, 6, 9]);
  assert.deepEqual(layout.mapBase, flattenScreens(p).mapBase); // the shipped walk agrees
  assert.equal(layout.total, 10);
  assert.deepEqual(layout.typeBits, [0b1010]);
  assert.equal(layout.streamedColumns.length, 12);
  const d = decodeStreamedLayout(layout);
  const want = [
    [0, { map: 0, ordinaryIndex: 0 }],
    [1, { map: 0, ordinaryIndex: 1 }],
    [6, { map: 2, ordinaryIndex: 2 }],
    [8, { map: 2, ordinaryIndex: 4 }]
  ];
  for (const [id, expect] of want) {
    const got = d.resolve(id);
    assert.equal(got.streamed, false);
    assert.equal(got.map, expect.map);
    assert.equal(got.ordinaryIndex, expect.ordinaryIndex, `ordinary index of id ${id}`);
    assert.deepEqual(resolveGlobalScreen(layout, id), { mapIndex: expect.map, streamed: false, ordinaryIndex: expect.ordinaryIndex });
  }
  assert.deepEqual(d.resolve(5), { map: 1, streamed: true, streamedMapIndex: 0, col: 1, row: 1 });
  assert.deepEqual(d.resolve(9), { map: 3, streamed: true, streamedMapIndex: 1, col: 0, row: 0 });
  assert.equal(d.resolve(10), null);
  assert.equal(resolveGlobalScreen(layout, 10), null);
  // the second streamed map reads ITS columns (compact index), not the first's
  assert.equal(d.streamed(3).gridW, 1);
  assert.equal(d.streamed(1).gridW, 2);
});

test('a streamed map ahead of an ordinary one: the worked example, global id 2 is ordinary index 0', () => {
  // Catches using the global id directly as the ordinary column index (§3: "agree only by coincidence").
  const p = blank();
  makeMap(p, 'A', 2, 1, true);
  makeMap(p, 'B', 1, 1, false);
  const layout = emitStreamedLayout(p);
  assert.equal(decodeStreamedLayout(layout).resolve(2).ordinaryIndex, 0);
  assert.equal(resolveGlobalScreen(layout, 2).ordinaryIndex, 0);
});

test('the type table is packed: one bit per raw map index, ceil(maps/8) bytes', () => {
  // Catches one byte per map and a bit taken by compact index.
  const p = blank();
  for (let i = 0; i < 9; i++) makeMap(p, `M${i}`, 1, 1, i === 0 || i === 7 || i === 8);
  const layout = emitStreamedLayout(p);
  assert.deepEqual(layout.typeBits, [0b10000001, 0b1]);
  assert.equal(layout.typeBits.length, 2);
});

test('the 255-screen ceiling: a 255x1 map emits, its last screen decodes; 256 throws', () => {
  // Catches a ceiling of 256 (the NO_SCREEN sentinel) and a region chunker that drops the tail.
  const p = blank();
  const m = makeMap(p, 'Wide', 255, 1, true);
  const layout = emitStreamedLayout(p);
  assert.equal(layout.total, 255);
  assert.deepEqual(layout.streamedColumns.slice(2), [0, 11, 255, 1]); // ceil(255/24) = 11
  const d = decodeStreamedLayout(layout);
  assert.deepEqual([...d.screen(0, 254, 0).terrain], m.screens[254].metatiles);
  // an interior region too (col 100 is chunk 4, record 4): catches a dropped or corrupted middle region
  for (const col of [24, 100, 239]) {
    assert.deepEqual([...d.screen(0, col, 0).terrain], m.screens[col].metatiles, `col ${col}`);
  }
  assert.deepEqual(d.resolve(254), { map: 0, streamed: true, streamedMapIndex: 0, col: 254, row: 0 });
  const over = blank();
  makeMap(over, 'Big', 16, 16, true);
  assert.throws(() => emitStreamedLayout(over), /255-screen ceiling/);
  const split = blank();
  makeMap(split, 'A', 200, 1, false);
  makeMap(split, 'B', 56, 1, true);
  assert.throws(() => emitStreamedLayout(split), /255-screen ceiling/);
});

test('region grouping: 24 screens per region, rows never share a region', () => {
  // Catches chunking by 25/23, a row spilling into the next row's region, and a short tail padded.
  const p = blank();
  const m = makeMap(p, 'R', 25, 2, true);
  const layout = emitStreamedLayout(p);
  const regions = layout.maps[0].regions;
  assert.deepEqual(regions.map((r) => r.bytes.length / 338), [24, 1, 24, 1]);
  assert.deepEqual(regions.map((r) => r.region), [0, 1, 2, 3]);
  const d = decodeStreamedLayout(layout);
  for (const [col, row] of [[23, 0], [24, 0], [0, 1], [24, 1]]) {
    assert.deepEqual([...d.screen(0, col, row).terrain], m.screens[row * 25 + col].metatiles, `${col},${row}`);
  }
});

test('locators run on through consecutive regions across streamed maps, with baseBanks overriding', () => {
  // Catches every map's baseBank restarting at 0 and an override being ignored.
  const p = blank();
  makeMap(p, 'S1', 25, 2, true); // 4 regions
  makeMap(p, 'O', 1, 1, false);
  makeMap(p, 'S2', 1, 3, true); // 3 regions
  const a = emitStreamedLayout(p, { firstRegion: 5 });
  assert.equal(a.streamedColumns[2], 5);
  assert.equal(a.streamedColumns[6 + 2], 9);
  const b = emitStreamedLayout(p, { baseBanks: [1, 40] });
  assert.equal(b.streamedColumns[2], 1);
  assert.equal(b.streamedColumns[8], 40);
  assert.deepEqual(b.maps[2].regions.map((r) => r.region), [40, 41, 42]);
});

test('every field at its maximum: 8 full entities, 8 bindings, terrain 255, metadata past byte 255', () => {
  // Catches a record sized for fewer slots, a byte narrowed to 7 bits, and offsets past 255 lost
  // (the decoder reads them through the 16-bit accessor: base + $0100, Y = offset - 256).
  const p = blank();
  const m = makeMap(p, 'Max', 1, 1, true);
  m.screens[0].metatiles.fill(255);
  for (let i = 0; i < 8; i++) {
    m.screens[0].entities.push(ent(254, 255, 255, { toScreen: 0, toX: 255, toY: 255, hideSwitch: 254 }));
    m.screens[0].boundTiles.push({ switchId: 255, row: 15, col: 15, metatileId: 255 });
  }
  const layout = emitStreamedLayout(p, { entityFields: () => ({ target: 255, event: 254, trigger: 255 }) });
  const s = decodeStreamedLayout(layout).screen(0, 0, 0);
  assert.equal(s.length, 338);
  assert.ok(s.terrain.every((b) => b === 255));
  assert.equal(s.entities.length, 8);
  for (const e of s.entities) {
    assert.deepEqual(e, { actor: 254, x: 255, y: 255, target: 255, toX: 255, toY: 255, event: 254, trigger: 255, hideSwitch: 254 });
  }
  assert.equal(s.bound.length, 8);
  assert.deepEqual(s.bound[7], { switchId: 255, cell: 255, metatileId: 255 });
  // the last bound record ends exactly at byte 337
  assert.equal(layout.maps[0].regions[0].bytes[337], 255);
  // 9 actors / 9 bindings / an out-of-byte value are refused, not truncated
  m.screens[0].entities.push(ent(1, 1, 1));
  assert.throws(() => emitStreamedLayout(p), /9 actors/);
  m.screens[0].entities.pop();
  m.screens[0].boundTiles.push({ switchId: 1, row: 0, col: 0, metatileId: 1 });
  assert.throws(() => emitStreamedLayout(p), /9 bound tiles/);
  m.screens[0].boundTiles.pop();
  m.screens[0].metatiles[0] = 256;
  assert.throws(() => emitStreamedLayout(p), /not a byte/);
});

test('the fill metatile byte: default 0, carried per streamed map, out-of-byte refused', () => {
  // Catches a fill byte read from the wrong map / hardcoded 0 / stored in the tileset column.
  const p = blank();
  makeMap(p, 'A', 1, 1, true);
  makeMap(p, 'B', 1, 1, true, { fillMetatileId: 200, tilesetId: 4 });
  const d = decodeStreamedLayout(emitStreamedLayout(p));
  assert.equal(d.streamed(0).fill, 0);
  assert.equal(d.streamed(0).tileset, 0);
  assert.equal(d.streamed(1).fill, 200);
  assert.equal(d.streamed(1).tileset, 4);
  p.maps[1].fillMetatileId = 256;
  assert.throws(() => emitStreamedLayout(p), /fill metatile/);
});

test('emitStreamedScreenRecord is the whole record for one screen', () => {
  // Catches the per-screen function emitting only the terrain.
  const p = blank();
  const m = makeMap(p, 'X', 1, 1, true);
  // Catches 338 zero bytes: content must be the terrain, the counts and the entity's fields.
  m.screens[0].entities.push(ent(7, 30, 40, { toX: 1, toY: 2 }));
  m.screens[0].boundTiles.push({ switchId: 5, row: 1, col: 2, metatileId: 9 });
  const r = emitStreamedScreenRecord(m.screens[0], m, 1);
  assert.equal(r.length, 338);
  assert.deepEqual(r.slice(0, 240), m.screens[0].metatiles);
  assert.deepEqual(r.slice(240, 250), [1, 7, 30, 40, 0, 1, 2, 255, 0, 255]);
  assert.deepEqual(r.slice(313, 317), [1, 5, 18, 9]);
});
