// Streamed worlds, phase 1 slice B1: the emitted layout (docs/design-streamed-worlds.md §3),
// round-tripped through test/lib/streamdecoder.js, which is written from the contract and never
// reads the layout table. Every test names the wrong implementation it would catch.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject, createMap, createScreen, createTileset, projectUsesBoundTiles } from '../../shared/project.js';
import { mapperById, prgLayout } from '../../shared/cartridge.js';
import { buildProject } from '../../main/build/pipeline.js';
import {
  flattenScreens,
  ordinaryScreenView,
  checkCapacity,
  generateAssets,
  assignScreenBanks,
  codeRegionCount,
  ENTITY_RECORD
} from '../../main/build/generate.js';
import { emitStreamedLayout, emitStreamedScreenRecord, resolveGlobalScreen } from '../../main/build/streamed.js';
import {
  STREAM_RECORD_BYTES,
  STREAM_TERRAIN_BYTES,
  STREAM_SCREENS_PER_REGION,
  STREAM_OFFSETS,
  STREAM_MAP_COLUMN_BYTES,
  STREAM_MAP_COLUMNS,
  STREAM_ENTITY_FIELDS,
  STREAM_ENTITY_RECORD,
  STREAM_BOUND_FIELDS,
  STREAM_BOUND_RECORD,
  STREAM_HIGH_PAGE
} from '../../shared/streamlayout.js';
import { decodeStreamedLayout } from '../lib/streamdecoder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROVENANCE_FIXTURE = path.join(ROOT, 'test/lib/streamedprovenance.mockfixture.js');

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

/**
 * Phase 2 slice 1 fix round 1, finding 4: emitStreamedScreenRecord no longer has a default
 * entityFields resolution (that was a second, unexercised implementation of generate.js's real
 * one). Several phase-1 tests below pass a PARTIAL callback (only `event`/`trigger`) and rely on
 * the old default's target fallback; this test-local adapter reproduces exactly that fallback
 * (`target` from `toScreen`, clamped to `total - 1`) without restoring it to production.
 */
const withDefaults =
  (fields = () => ({})) =>
  (entity, total) => ({
    target: Math.min(entity.props?.toScreen ?? 0, Math.max(0, total - 1)),
    event: 255,
    trigger: 0,
    ...fields(entity, total)
  });

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
  const layout = emitStreamedLayout(p, { entityFields: withDefaults() });
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
  const layout = emitStreamedLayout(p, { entityFields: withDefaults() });
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
    entityFields: withDefaults((e) => ({ event: events.get(e) ?? 255, trigger: e.actorId === 9 ? 2 : 1 }))
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
  const layout = emitStreamedLayout(p, { entityFields: withDefaults() });
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
  const r = emitStreamedScreenRecord(m.screens[0], m, 1, withDefaults());
  assert.equal(r.length, 338);
  assert.deepEqual(r.slice(0, 240), m.screens[0].metatiles);
  assert.deepEqual(r.slice(240, 250), [1, 7, 30, 40, 0, 1, 2, 255, 0, 255]);
  assert.deepEqual(r.slice(313, 317), [1, 5, 18, 9]);
});

// -----------------------------------------------------------------------------------------------
// Phase 2 slice 1 (emitter wiring): generateAssets itself, not emitStreamedLayout called directly.
// Every project here uses MMC1 + horizontal mirroring -- a streamed-capable board
// (checkStreamedMapperSwitch's own capability gate would otherwise refuse before the "no engine
// yet" refusal this slice's own test seam bypasses is even reached). bypassStreamedRefusal is the
// test-only seam generate.js's generateAssets exposes; buildProject/cli.js never pass it, and a
// dedicated test below confirms the public path still refuses with no seam.
// -----------------------------------------------------------------------------------------------

/** One generated `.db $xx,...` (or plain-decimal, for config.inc's `NAME = N` lines) table or
 * value, read back out of a `.inc` file by label -- test/unit/music.test.js's own dbBytesAt. */
function dbBytesAt(inc, label) {
  const match = inc.match(new RegExp(`${label}:\\n((?:  \\.db [^\\n]*\\n?)+)`));
  assert.ok(match, `label ${label} not found in the generated .inc text`);
  return match[1]
    .trim()
    .split('\n')
    .flatMap((line) => line.replace(/^ *\.db /, '').split(','))
    .map((token) => parseInt(token.replace('$', ''), 16));
}

/** A `NAME = N` config.inc equate, decimal. */
function configEquate(inc, name) {
  const match = inc.match(new RegExp(`^${name}\\s*=\\s*(\\d+)$`, 'm'));
  assert.ok(match, `equate ${name} not found in config.inc`);
  return Number(match[1]);
}

/** A pointer table's raw `LOW(...)`/`HIGH(...)` label tokens, in order -- dbBytesAt's sibling for
 * a table whose rows are asm expressions, not literal bytes. */
function pointerLabelsAt(inc, label) {
  const match = inc.match(new RegExp(`${label}:\\n((?:  \\.db [^\\n]*\\n?)+)`));
  assert.ok(match, `label ${label} not found in the generated .inc text`);
  return match[1]
    .trim()
    .split('\n')
    .flatMap((line) => line.replace(/^ *\.db /, '').split(','));
}

/** The `.bank N` / `.org $XXXX` header in force at the point `label:` appears in `inc` -- proves
 * the enclosing bank/origin header only, which reading the bytes underneath it cannot. */
function labelBankOrg(inc, label) {
  let bank = null;
  let org = null;
  for (const line of inc.split('\n')) {
    const bankMatch = line.match(/^\s*\.bank (\d+)/);
    if (bankMatch) bank = Number(bankMatch[1]);
    const orgMatch = line.match(/^\s*\.org \$([0-9A-Fa-f]+)/);
    if (orgMatch) org = Number.parseInt(orgMatch[1], 16);
    if (line.startsWith(`${label}:`)) return { bank, org };
  }
  assert.fail(`label ${label} not found in the generated .inc text`);
}

function mkbuild(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamed-wiring-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A mixed project, streamed map first: map S (streamed, 2x1, global ids 0-1) carries one live
 * entity (real actor, dialogue, an 'enter' trigger, a door target) and one entity naming a
 * DELETED actor (actorId 5, only one actor -- id 0 -- exists); map A (ordinary, 2x1, global ids
 * 2-3, compacted ordinary indices 0-1) is placed AFTER the streamed map specifically so a global
 * id and a compacted ordinary index disagree (2 vs 0, 3 vs 1) -- a neighbour or table reference
 * that used the wrong one is directly observable, not moot by coincidence.
 */
function wiredMixedProject() {
  const p = blank();
  p.cartridge.mapper = 1; // MMC1
  // vertical mirroring: MMC1 streams side to side (N wide, 1 tall) only under vertical
  // mirroring -- shared/project.js's own dead-axis restriction (validateProject).
  p.cartridge.mirroring = 'vertical';
  // actorId 1 is a pickup: itemsEnabled + canBackItem routes its own entity's `target` through
  // resolveEntityByte's ITEM branch (itemIdForActor), never the screen-target branch the removed
  // withDefaults fallback used unconditionally -- a pickup's item id (7) and that fallback's
  // Math.min(toScreen ?? 0, total-1) can never coincide by construction, so wiring the real
  // production callback back to the old fallback is directly observable, not moot by coincidence
  // (slice 1 review 2 nit b).
  p.sprites.actors = [
    { name: 'Guide', behavior: 'npc' },
    { name: 'Berry', behavior: 'pickup' }
  ]; // actorCount = 2: actorId 5 below is still deleted
  p.items = [{ id: 7, name: 'Berry', actorId: 1 }];
  const s = makeMap(p, 'S', 2, 1, true); // ids 0,1
  // makeMap's own distinct-terrain generator can exceed LIMITS.metatiles (64); masked here so
  // validateProject's "maps reference N metatiles" check does not itself refuse the build, while
  // staying distinct screen to screen (the property these tests actually need it for).
  for (const screen of s.screens) screen.metatiles = screen.metatiles.map((v) => v & 63);
  s.screens[0].entities.push(ent(0, 10, 20, { dialogue: 'Hi', trigger: 'enter', toScreen: 1 }));
  s.screens[0].entities.push(ent(1, 12, 20)); // the pickup: target must be its own item id, 7
  s.screens[0].entities.push(ent(5, 1, 1)); // deleted actor: must not reach the emitted record
  const a = makeMap(p, 'A', 2, 1, false); // ids 2,3 -> ordinary compacted 0,1
  for (const screen of a.screens) screen.metatiles = screen.metatiles.map((v) => v & 63);
  return { p, s, a };
}

test('generateAssets wires emitStreamedLayout into a real build: streamed.inc and streamed_regions.inc', async (t) => {
  // Catches: emitStreamedLayout never called (files absent); baseBanks not threaded from
  // checkCapacity's own streamedPlan (bank/columns disagree with the independently-read plan);
  // the streamed entity's target/event/trigger falling back to defaultEntityFields' own NO_EVENT/0
  // instead of resolveEntityByte/text.eventFor/triggerIndex (sabotage 1 and 2); a deleted actor's
  // entity record still emitted (sabotage 3).
  const { p, s } = wiredMixedProject();
  const streamedPlan = checkCapacity(p).streamedPlan;
  const dir = mkbuild(t);
  await generateAssets({ dir, project: p, bypassStreamedRefusal: true });

  const streamedInc = fs.readFileSync(path.join(dir, 'build/assets/streamed.inc'), 'utf8');
  const configInc = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');

  // typeBits: 2 raw maps, map index 0 (S) streamed -> bit 0 set, map index 1 (A) not.
  assert.deepEqual(dbBytesAt(streamedInc, 'stream_type_bits'), [0b1]);
  const baseBank = streamedPlan.baseBanks[0];
  assert.equal(typeof baseBank, 'number');
  // columns: tileset, fill, baseBank (from checkCapacity's own already-computed plan, read
  // independently here -- not recomputed by this slice), regionsPerRow, gridW, gridH.
  assert.deepEqual(dbBytesAt(streamedInc, 'stream_columns'), [0, 0, baseBank, 1, 2, 1]);

  const regionsInc = fs.readFileSync(path.join(dir, 'build/assets/streamed_regions.inc'), 'utf8');
  const region = dbBytesAt(regionsInc, `stream_region_${baseBank}`);
  assert.equal(region.length, 2 * STREAM_RECORD_BYTES); // both of S's screens share one region (perRow 1)

  // Screen (0,0): terrain, then the live entity's literal target/event/trigger/hideSwitch, then
  // the deleted actor's absence.
  const screen0 = region.slice(0, STREAM_RECORD_BYTES);
  assert.deepEqual(screen0.slice(0, STREAM_TERRAIN_BYTES), s.screens[0].metatiles);
  assert.equal(screen0[STREAM_OFFSETS.entityCount], 2, 'the deleted actor (id 5) must not be counted');
  const entityAt = (i) => screen0.slice(STREAM_OFFSETS.entities + i * STREAM_ENTITY_RECORD, STREAM_OFFSETS.entities + (i + 1) * STREAM_ENTITY_RECORD);
  const e = entityAt(0);
  const field = (name) => e[STREAM_ENTITY_FIELDS.indexOf(name)];
  assert.equal(field('actor'), 0);
  assert.equal(field('x'), 10);
  assert.equal(field('y'), 20);
  // Guide (actorId 0) is not a pickup, so itemsEnabled being true (this project now carries one
  // item, actorId 1's Berry) does not move it off resolveEntityByte's screen-target branch:
  // min(toScreen, total - 1) = min(1, 3) = 1 -- NOT the streamed entity's own global id (1 would
  // also be the global id here by coincidence of this project's shape; the "streamed doors keep
  // their global id" property is pinned above, by the existing "NONZERO base" test).
  assert.equal(field('target'), 1);
  // the FIRST (and only) compiled dialogue event in the whole project -> event index 0. Sabotage 1
  // (event always NO_EVENT) turns this into 255.
  assert.equal(field('event'), 0);
  // 'enter' is EVENT_TRIGGERS index 2. Sabotage 2 (trigger always 0) turns this into 0 (== 'interact').
  assert.equal(field('trigger'), 2);
  // hideSwitch was not set by the live entity's props: defaultEntityFields' own fallback (0xff),
  // which generate.js's real entityFields callback deliberately leaves unreturned (see
  // handoff-next/progress-phase2-s1.md's "Decisions").
  assert.equal(field('hideSwitch'), 255);

  // Berry (actorId 1) IS a pickup: itemsEnabled && canBackItem routes it through
  // resolveEntityByte's 'item' branch, never the screen-target branch entity 0 above took --
  // target must be its own item id (7), which the removed withDefaults fallback (screen-target
  // only, no item concept at all) could never produce for an entity with no `toScreen` prop
  // (it would read 0). This is the nit the wiring test's own top-level comment used to lack: a
  // partial callback slipping back to that old fallback showed no observable difference before.
  const e1 = entityAt(1);
  const field1 = (name) => e1[STREAM_ENTITY_FIELDS.indexOf(name)];
  assert.equal(field1('actor'), 1);
  assert.equal(field1('target'), 7, "a pickup's target is its own item id, not a screen index");

  const screen1 = region.slice(STREAM_RECORD_BYTES, 2 * STREAM_RECORD_BYTES);
  assert.deepEqual(screen1.slice(0, STREAM_TERRAIN_BYTES), s.screens[1].metatiles);
  assert.equal(screen1[STREAM_OFFSETS.entityCount], 0);

  // config.inc's streamed constants: gated on hasStreamed, and every one of them the live import
  // from shared/streamlayout.js, not a second hand-typed copy (sabotage 4's positive baseline --
  // the negative/provenance half is the child-process mock test below).
  assert.equal(configEquate(configInc, 'STREAM_RECORD_BYTES'), STREAM_RECORD_BYTES);
  assert.equal(configEquate(configInc, 'STREAM_TERRAIN_BYTES'), STREAM_TERRAIN_BYTES);
  assert.equal(configEquate(configInc, 'STREAM_HIGH_PAGE'), STREAM_HIGH_PAGE);
  assert.equal(configEquate(configInc, 'STREAM_SCREENS_PER_REGION'), STREAM_SCREENS_PER_REGION);
  assert.equal(configEquate(configInc, 'STREAM_MAP_COLUMN_BYTES'), STREAM_MAP_COLUMN_BYTES);
  assert.equal(configEquate(configInc, 'STREAM_OFF_TERRAIN'), STREAM_OFFSETS.terrain);
  assert.equal(configEquate(configInc, 'STREAM_OFF_ENTITY_COUNT'), STREAM_OFFSETS.entityCount);
  assert.equal(configEquate(configInc, 'STREAM_OFF_ENTITIES'), STREAM_OFFSETS.entities);
  assert.equal(configEquate(configInc, 'STREAM_OFF_BOUND_COUNT'), STREAM_OFFSETS.boundCount);
  assert.equal(configEquate(configInc, 'STREAM_OFF_BOUNDS'), STREAM_OFFSETS.bounds);
  assert.equal(configEquate(configInc, 'STREAM_COL_TILESET'), STREAM_MAP_COLUMNS.tileset);
  assert.equal(configEquate(configInc, 'STREAM_COL_FILL'), STREAM_MAP_COLUMNS.fill);
  assert.equal(configEquate(configInc, 'STREAM_COL_BASE_BANK'), STREAM_MAP_COLUMNS.baseBank);
  assert.equal(configEquate(configInc, 'STREAM_COL_REGIONS_PER_ROW'), STREAM_MAP_COLUMNS.regionsPerRow);
  assert.equal(configEquate(configInc, 'STREAM_COL_GRID_W'), STREAM_MAP_COLUMNS.gridW);
  assert.equal(configEquate(configInc, 'STREAM_COL_GRID_H'), STREAM_MAP_COLUMNS.gridH);
  assert.equal(configEquate(configInc, 'STREAM_ENTITY_RECORD'), STREAM_ENTITY_RECORD);
  assert.equal(configEquate(configInc, 'STREAM_BOUND_RECORD'), STREAM_BOUND_RECORD);
});

test('the public build path still refuses a streamed project, with no test seam', async (t) => {
  // Catches bypassStreamedRefusal defaulting to true, or the "no engine yet" refusal being
  // weakened for every caller instead of only the test-only seam. buildProject
  // (main/build/pipeline.js) -- what main/build/cli.js and the Electron IPC handler actually call
  // -- is exercised directly here, not generateAssets alone: that only proves the seam's own
  // default, not that the real build path never threads a bypass through.
  const { p } = wiredMixedProject();
  const dir = mkbuild(t);
  await assert.rejects(buildProject({ dir, project: p }), (error) => {
    assert.match(error.message, /no engine yet/);
    assert.ok(
      error.problems?.some((problem) => problem.code === 'streamed-no-engine'),
      "checkCapacity's own coded problem must still be present, not swallowed"
    );
    return true;
  });
});

test('bypassStreamedRefusal silences only the streamed-no-engine problem, never an unrelated error', async (t) => {
  // Catches the seam widened to swallow every error (a project that also fails an unrelated check
  // would then wrongly proceed to write real asset files under test) instead of exactly the one
  // coded problem. checkCapacity's "no engine yet" problem is the ONLY problem object carrying a
  // `code` field at all, so a genuinely different error (a tileset overflow: MMC1 holds 16, this
  // project has 20) must still throw, and its message, even with the seam on.
  const { p } = wiredMixedProject();
  for (let i = p.tilesets.length; i < 20; i++) p.tilesets.push(createTileset(i));
  const dir = mkbuild(t);
  await assert.rejects(generateAssets({ dir, project: p, bypassStreamedRefusal: true }), (error) => {
    assert.match(error.message, /tilesets/);
    assert.doesNotMatch(error.message, /no engine yet/, 'the coded problem was filtered from the throw...');
    assert.ok(
      error.problems.some((problem) => problem.code === 'streamed-no-engine'),
      '...but checkCapacity still reported it -- only the throw filter narrowed, not checkCapacity itself'
    );
    return true;
  });
});

test('the ordinary tables are emitted from the compacted ordinaryFlat, never the raw global flat', async (t) => {
  // Catches the phase-1 debt reappearing: maps.inc built from flattenScreens' own flat (row count
  // == flat.length, a streamed screen's own row present, and a neighbour stored as a GLOBAL id --
  // which this project's own map order makes numerically distinct from the correct compacted
  // index, not coincidentally equal).
  const { p, a } = wiredMixedProject();
  const dir = mkbuild(t);
  await generateAssets({ dir, project: p, bypassStreamedRefusal: true });
  const configInc = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
  const mapsInc = fs.readFileSync(path.join(dir, 'build/assets/maps.inc'), 'utf8');

  const { ordinaryFlat } = ordinaryScreenView(p);
  assert.equal(ordinaryFlat.length, 2, "sanity: only map A's two screens are ordinary");
  const { flat } = flattenScreens(p);
  assert.equal(flat.length, 4, 'sanity: 4 screens globally (2 streamed + 2 ordinary)');
  // NUM_SCREENS is the GLOBAL count (finding 1, fix round 1): engine/boot.asm:290/engine/save.asm:301
  // compare a GLOBAL id against it, so it must never be the compacted ordinary count.
  assert.equal(configEquate(configInc, 'NUM_SCREENS'), flat.length);

  const screenMap = dbBytesAt(mapsInc, 'screen_map');
  assert.equal(screenMap.length, ordinaryFlat.length, 'one row per ORDINARY screen, never one per global screen');
  assert.deepEqual(screenMap, [p.maps.indexOf(a), p.maps.indexOf(a)], 'every row names map A; no streamed screen appears here');
  assert.deepEqual(dbBytesAt(mapsInc, 'screen_tileset'), [a.tilesetId, a.tilesetId]);

  // Neighbours recomputed against the COMPACTED numbering (0, 1), not the global ids (2, 3) map A
  // actually holds -- observable only because map A sits after the streamed map in project.maps.
  assert.deepEqual(dbBytesAt(mapsInc, 'screen_left'), [0xff, 0]);
  assert.deepEqual(dbBytesAt(mapsInc, 'screen_right'), [1, 0xff]);
  assert.deepEqual(dbBytesAt(mapsInc, 'screen_up'), [0xff, 0xff]);
  assert.deepEqual(dbBytesAt(mapsInc, 'screen_down'), [0xff, 0xff]);

  // The pointer tables reference the COMPACT labels (screen_0, screen_1), never a global index --
  // finding 5's coverage gap: the earlier version of this test never looked at these six rows.
  assert.deepEqual(pointerLabelsAt(mapsInc, 'screen_mt_lo'), ['LOW(screen_0)', 'LOW(screen_1)']);
  assert.deepEqual(pointerLabelsAt(mapsInc, 'screen_mt_hi'), ['HIGH(screen_0)', 'HIGH(screen_1)']);
  assert.deepEqual(pointerLabelsAt(mapsInc, 'screen_at_lo'), ['LOW(screen_0_attr)', 'LOW(screen_1_attr)']);
  assert.deepEqual(pointerLabelsAt(mapsInc, 'screen_at_hi'), ['HIGH(screen_0_attr)', 'HIGH(screen_1_attr)']);
  assert.deepEqual(pointerLabelsAt(mapsInc, 'screen_ent_lo'), ['LOW(screen_0_ent)', 'LOW(screen_1_ent)']);
  assert.deepEqual(pointerLabelsAt(mapsInc, 'screen_ent_hi'), ['HIGH(screen_0_ent)', 'HIGH(screen_1_ent)']);

  // Bank placement: an independent call to the same (untouched) assignScreenBanks generateAssets
  // itself calls, fed the same ordinaryFlat -- proves the row order/length threaded through
  // matches, not a second bank-packing algorithm.
  const { reserveFlashSave, streamedPlan } = checkCapacity(p);
  const mapper = mapperById(p.cartridge.mapper);
  const { screenBank: wantBank, regionRanges } = assignScreenBanks(
    mapper,
    p.tilesets.length,
    codeRegionCount(p),
    reserveFlashSave,
    ordinaryFlat,
    p.sprites.actors.length,
    projectUsesBoundTiles(p),
    { regionsOverride: streamedPlan.remainingRegions }
  );
  assert.deepEqual(dbBytesAt(mapsInc, 'screen_bank'), wantBank);

  // Record offsets: each ordinary screen's own terrain, read from screens.inc by its own
  // screen_<compacted index> label, matches that exact screen object -- never another one, never
  // shifted by the streamed map's own screen count. And the labels' pointer-table references above
  // actually occupy the bank/origin assignScreenBanks assigned them, not merely bytes under a
  // matching name (finding 5: "reading bytes under a label does not prove where they assemble").
  const screensInc = fs.readFileSync(path.join(dir, 'build/assets/screens.inc'), 'utf8');
  assert.deepEqual(dbBytesAt(screensInc, 'screen_0'), a.screens[0].metatiles);
  assert.deepEqual(dbBytesAt(screensInc, 'screen_1'), a.screens[1].metatiles);
  for (let i = 0; i < ordinaryFlat.length; i++) {
    const range = regionRanges.find((r) => i >= r.from && i < r.to);
    assert.ok(range, `screen_${i} sanity: assigned to some region`);
    assert.deepEqual(
      labelBankOrg(screensInc, `screen_${i}`),
      { bank: range.region.nesasmBank, org: range.region.org },
      `screen_${i}'s literal .bank/.org header`
    );
  }
});

test('NUM_SCREENS/START_SCREEN/TITLE_FLAT_SCREEN stay GLOBAL identities, never the compacted ordinary count', async (t) => {
  // Catches all three reverting to ordinaryFlat.length/its clamp (finding 1, fix round 1):
  // engine/boot.asm:290 (take_door) compares the GLOBAL warp_scr against NUM_SCREENS, and
  // engine/save.asm:301 (save_check_range) compares the GLOBAL SAVE_FLAT_SCREEN against it too --
  // a value already truncated to the ordinary-only count here can never be recovered at runtime.
  const dir = mkbuild(t);
  const build = async (project) => {
    await generateAssets({ dir, project, bypassStreamedRefusal: true });
    return fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
  };

  // The reviewer's own fixture: streamed 2-screen map (ids 0,1), then ordinary 2-screen map
  // (ids 2,3); ordinaryFlat.length is 2, the old buggy bound.
  let p = wiredMixedProject().p;
  p.project.startMap = 1;
  p.project.startScreen = 1; // global id 2 + 1 = 3, on the LATER ordinary map
  p.project.titleMap = 1;
  p.project.titleScreen = 1; // same global id, for the title screen
  let configInc = await build(p);
  assert.equal(configEquate(configInc, 'NUM_SCREENS'), 4, 'the GLOBAL screen count, not ordinaryFlat.length (2)');
  assert.equal(configEquate(configInc, 'START_SCREEN'), 3, 'a GLOBAL id, not clamped to ordinaryFlat.length - 1 (1)');
  assert.equal(configEquate(configInc, 'TITLE_FLAT_SCREEN'), 3, 'the same GLOBAL clamp for the title screen');

  // Start/title on the STREAMED map itself: global id 1, which the old ordinaryFlat.length - 1
  // bound (1) happened to also produce here by coincidence -- this project's own numbers, not that
  // one, are what the assertion checks.
  p = wiredMixedProject().p;
  p.project.startMap = 0;
  p.project.startScreen = 1;
  p.project.titleMap = 0;
  p.project.titleScreen = 1;
  configInc = await build(p);
  assert.equal(configEquate(configInc, 'START_SCREEN'), 1);
  assert.equal(configEquate(configInc, 'TITLE_FLAT_SCREEN'), 1);

  // An all-streamed project: the old bug's own Math.min(x, ordinaryFlat.length - 1) with
  // ordinaryFlat.length 0 produced NUM_SCREENS 0 and START_SCREEN -1 here.
  p = blank();
  p.cartridge.mapper = 1;
  p.cartridge.mirroring = 'vertical';
  const onlyStreamed = makeMap(p, 'S', 2, 1, true);
  for (const screen of onlyStreamed.screens) screen.metatiles = screen.metatiles.map((v) => v & 63);
  p.project.startScreen = 1;
  configInc = await build(p);
  assert.equal(configEquate(configInc, 'NUM_SCREENS'), 2, "not 0 (the old bug's ordinaryFlat.length for an all-streamed project)");
  assert.equal(configEquate(configInc, 'START_SCREEN'), 1, "not -1 (Math.min(x, -1) with ordinaryFlat.length 0)");
});

test('ordinary door targets stay GLOBAL, including across ordinary maps and into a streamed map beyond the compact count', async (t) => {
  // Catches resolveEntityByte's ordinary bound reverting to ordinaryFlat.length (finding 2, fix
  // round 1): on this fixture (streamed map ids 0-3, ordinary map ids 4-5, ordinaryFlat.length 2)
  // that bound would corrupt BOTH an ordinary door to a later ordinary screen (5 -> wrongly clamped
  // to 1) and an ordinary door into the streamed map, whose global id (3) exceeds the compact
  // count entirely -- the report's claimed ordinary/streamed asymmetry was wrong; both keep GLOBAL
  // targets.
  const p = blank();
  p.cartridge.mapper = 1;
  p.cartridge.mirroring = 'vertical';
  const s = makeMap(p, 'S', 4, 1, true); // ids 0-3
  for (const screen of s.screens) screen.metatiles = screen.metatiles.map((v) => v & 63);
  const a = makeMap(p, 'A', 2, 1, false); // ids 4,5, compacted ordinary indices 0,1
  for (const screen of a.screens) screen.metatiles = screen.metatiles.map((v) => v & 63);
  p.sprites.actors = [
    { name: 'X', behavior: 'npc' },
    { name: 'Y', behavior: 'npc' }
  ];
  a.screens[0].entities.push(ent(0, 1, 1, { toScreen: 5 })); // ordinary -> later ordinary (global 5)
  a.screens[0].entities.push(ent(1, 2, 2, { toScreen: 3 })); // ordinary -> streamed (global 3, > compact count 2)

  const dir = mkbuild(t);
  await generateAssets({ dir, project: p, bypassStreamedRefusal: true });
  const screensInc = fs.readFileSync(path.join(dir, 'build/assets/screens.inc'), 'utf8');
  const rec = dbBytesAt(screensInc, 'screen_0_ent');
  assert.equal(rec[0], 2, 'both entities placed');
  assert.equal(rec[1 + 0 * ENTITY_RECORD + 3], 5, 'ordinary -> later ordinary keeps the GLOBAL id 5, not the compacted index 1');
  assert.equal(rec[1 + 1 * ENTITY_RECORD + 3], 3, 'ordinary -> streamed keeps the GLOBAL id 3, not clamped to the compact count');
});

test('two streamed maps of different sizes: every record in every allocated region lands at its own checkCapacity-assigned bank/offset, distinguishable content', async (t) => {
  // Catches: baseBanks not threaded through at all (emitStreamedLayout's own default numbering,
  // which only agrees with the real plan by coincidence), the two maps' own banks swapped or
  // collapsed onto one, a middle or tail region silently dropped or shared, and finding 3's `.org`
  // bug (a byte-content check alone cannot see a missing `$` or a wrong hex value -- only a
  // literal text match on the header can).
  // Each map's per-screen terrain is unique (makeMap's own id-derived pattern, masked to 6 bits),
  // so content arriving under the wrong map's bank/offset is directly visible, not inferred.
  const p = blank();
  p.cartridge.mapper = 1; // MMC1
  p.cartridge.mirroring = 'vertical';
  const s1 = makeMap(p, 'Small', 1, 1, true); // 1 region
  const s2 = makeMap(p, 'Big', 25, 1, true); // vertical mirroring streams side to side: N wide, 1 tall; 2 regions
  for (const m of [s1, s2]) for (const screen of m.screens) screen.metatiles = screen.metatiles.map((v) => v & 63);

  const { streamedPlan } = checkCapacity(p);
  assert.equal(streamedPlan.baseBanks.length, 2);
  assert.notEqual(streamedPlan.baseBanks[0], streamedPlan.baseBanks[1], 'sanity: the two maps get distinct banks');

  const dir = mkbuild(t);
  await generateAssets({ dir, project: p, bypassStreamedRefusal: true });
  const regionsInc = fs.readFileSync(path.join(dir, 'build/assets/streamed_regions.inc'), 'utf8');
  const streamedInc = fs.readFileSync(path.join(dir, 'build/assets/streamed.inc'), 'utf8');

  const mapper = mapperById(p.cartridge.mapper);
  const orgOf = (nesasmBank) => {
    const region = prgLayout(mapper).regions.find((r) => r.nesasmBank === nesasmBank);
    assert.ok(region, `bank ${nesasmBank} is not one of ${mapper.name}'s switchable-window regions`);
    return region.org;
  };
  const headerFor = (region) => {
    const match = regionsInc.match(new RegExp(`  \\.bank ${region}\\n  \\.org (\\$[0-9A-F]+)\\nstream_region_${region}:`));
    assert.ok(match, `region ${region}'s .bank/.org header not found verbatim`);
    return match[1];
  };
  const asHex = (n) => `$${n.toString(16).toUpperCase()}`;

  // The columns this build actually emitted (stream_columns), not a second recomputation of
  // regionsPerRow/gridW: streamedMapIndex order is project order, both maps streamed here.
  const columns = dbBytesAt(streamedInc, 'stream_columns');
  const columnFor = (streamedMapIndex, field) => columns[streamedMapIndex * STREAM_MAP_COLUMN_BYTES + field];

  const total = flattenScreens(p).flat.length; // this project is entirely streamed maps
  const maps = [
    { map: s1, streamedMapIndex: 0, baseBank: streamedPlan.baseBanks[0] },
    { map: s2, streamedMapIndex: 1, baseBank: streamedPlan.baseBanks[1] }
  ];
  const seenParities = new Set();
  for (const { map, streamedMapIndex, baseBank } of maps) {
    assert.equal(columnFor(streamedMapIndex, STREAM_MAP_COLUMNS.gridW), map.gridW, `sanity: ${map.name}'s own emitted gridW`);
    const perRow = columnFor(streamedMapIndex, STREAM_MAP_COLUMNS.regionsPerRow);
    for (let chunk = 0; chunk < perRow; chunk++) {
      const region = baseBank + chunk;
      seenParities.add(region % 2);
      assert.equal(headerFor(region), asHex(orgOf(region)), `region ${region}'s literal .org, from prgLayout, not bank parity`);
      const from = chunk * STREAM_SCREENS_PER_REGION;
      const to = Math.min(map.gridW, from + STREAM_SCREENS_PER_REGION);
      const bytes = dbBytesAt(regionsInc, `stream_region_${region}`);
      assert.equal(bytes.length, (to - from) * STREAM_RECORD_BYTES, `region ${region}'s own screen count`);
      for (let col = from; col < to; col++) {
        const at = (col - from) * STREAM_RECORD_BYTES;
        const want = emitStreamedScreenRecord(map.screens[col], map, total);
        assert.deepEqual(bytes.slice(at, at + STREAM_RECORD_BYTES), want, `${map.name} col ${col}, region ${region}`);
      }
    }
  }
  assert.deepEqual(seenParities, new Set([0, 1]), 'sanity: both an even and an odd allocated bank were exercised');
});

test('config.inc\'s STREAM_RECORD_BYTES tracks a live shared/streamlayout.js import (provenance), not a value that merely happens to match', async () => {
  // The real mechanism: a module-loading-seam substitution (Node's t.mock.module), run in an
  // isolated child process with --experimental-test-module-mocks -- the plain `node --test` this
  // suite runs under (package.json's own script) has no mock.module at all. Never reassigns an ESM
  // binding, never mutates generate.js on disk; a hand-typed-but-numerically-correct 338 would
  // pass a value check and fail only this one, which is the entire reason this mechanism exists
  // instead of a second `assert.equal(…, 338)`.
  // NODE_TEST_CONTEXT is set by the node:test runner running THIS file, and a child node:test
  // process inherits env by default -- seeing it, the child assumes it is a recursive run() call
  // and silently skips its own files (a real, easy-to-hit trap: it does not fail, it produces no
  // output at all). Stripped here so the child genuinely runs as its own top-level process.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;

  const withFlag = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', PROVENANCE_FIXTURE], {
    encoding: 'utf8',
    env: childEnv
  });
  assert.equal(withFlag.status, 0, `provenance fixture should pass under the flag:\n${withFlag.stdout}\n${withFlag.stderr}`);
  assert.match(withFlag.stdout, /# pass 1/);
  assert.match(withFlag.stdout, /# fail 0/);

  // And the mandated property: missing the flag is a hard FAILURE (mock.module absent), never a
  // silently-skipped-but-green test.
  const withoutFlag = spawnSync(process.execPath, ['--test', PROVENANCE_FIXTURE], { encoding: 'utf8', env: childEnv });
  assert.notEqual(withoutFlag.status, 0);
  assert.match(withoutFlag.stdout, /# fail 1/);
  assert.doesNotMatch(withoutFlag.stdout, /# skipped 1/);
});
