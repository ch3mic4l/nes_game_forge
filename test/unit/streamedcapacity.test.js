// Streamed worlds, phase 1 slice B2: the aggregate capacity check, region allocation and the
// mapper-switch preflight (docs/design-streamed-worlds.md §3 "Charge, resolved", §4). Every test
// names the wrong implementation it would catch. Nothing here touches a checked-in fixture; every
// project is built in memory from createProject.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  createMap,
  createScreen,
  createTileset,
  reconcileCartridge,
  metaspriteKernelBytes,
  projectUsesSave
} from '../../shared/project.js';
import { MAPPERS, mapperById, prgLayout } from '../../shared/cartridge.js';
import { STREAM_SCREENS_PER_REGION, STREAM_MAP_COLUMNS, STREAM_MAP_COLUMN_BYTES } from '../../shared/streamlayout.js';
import {
  checkCapacity,
  checkStreamedMapperSwitch,
  fitsCapacity,
  flattenScreens,
  kernelTableBytes,
  planStreamedRegions,
  switchableMappers,
  assignScreenBanks
} from '../../main/build/generate.js';
import { emitStreamedLayout } from '../../main/build/streamed.js';

const MMC1 = 1;
const MMC3 = 4;
const UNROM512 = 30;

const blank = (mapperId, mirroring) => {
  const p = createProject('Capacity');
  p.maps = [];
  p.cartridge.mapper = mapperId;
  p.cartridge.mirroring = mirroring;
  return p;
};
const addMap = (p, w, h, streamed = false) => {
  const map = createMap(p.maps.length, `M${p.maps.length}`);
  map.gridW = w;
  map.gridH = h;
  map.screens = Array.from({ length: w * h }, () => createScreen());
  if (streamed) map.streamed = true;
  p.maps.push(map);
  return map;
};
// Ordinary maps totalling at least `screens` screens (the grid limit is 4 per axis).
const addOrdinary = (p, screens) => {
  for (let left = screens; left > 0; left -= 16) addMap(p, 4, Math.min(4, Math.ceil(Math.min(left, 16) / 4)));
};
const usableFor = (p) => planStreamedRegions(p, mapperById(p.cartridge.mapper)).usable;
const messages = (p) => checkCapacity(p).problems.map((x) => x.message);
const streamedFailures = (p) => messages(p).filter((m) => /streamed maps need|no longer fit beside/.test(m));

test('the contract false-pass: ordinary content that only fits while counting streamed-reserved regions', () => {
  // The wrong implementation is a fitsCapacity that stops at seven parameters and drops
  // regionsOverride: it then checks the full region list and answers "fits" for a project the
  // streamed reservation exists to refuse.
  const p = blank(MMC1, 'vertical');
  addOrdinary(p, 64); // three regions of empty screens
  const total = usableFor(p).length;
  addMap(p, 1, total - 1, true); // leaves ONE region
  const mapper = mapperById(MMC1);
  const plan = planStreamedRegions(p, mapper);
  assert.equal(plan.remainingRegions.length, 1);
  const args = [mapper, 1, 0, false, plan.ordinaryFlat, p.sprites.actors.length, false];
  assert.equal(fitsCapacity(...args, { regionsOverride: plan.remainingRegions }), false);
  assert.equal(fitsCapacity(...args), true, 'without the override the same content fits: the false pass');
  assert.equal(streamedFailures(p).length, 1);
  assert.match(streamedFailures(p)[0], /no longer fit beside the streamed maps/);
  assert.equal(checkCapacity(p).problems.find((x) => /no longer fit/.test(x.message)).where, 'Map Forge');
  // Leave three regions and the same ordinary content fits.
  const roomy = blank(MMC1, 'vertical');
  addOrdinary(roomy, 64);
  addMap(roomy, 1, total - 3, true);
  assert.deepEqual(streamedFailures(roomy), []);
});

test('fitsCapacity with no override is byte-for-byte the packer it wraps', () => {
  // Catches a fitsCapacity that always injects an override (e.g. an empty list when none is given).
  const p = blank(MMC1, 'vertical');
  addOrdinary(p, 20);
  const { flat } = flattenScreens(p);
  const mapper = mapperById(MMC1);
  assert.equal(fitsCapacity(mapper, 1, 0, false, flat, 0, false), true);
  assert.equal(fitsCapacity(mapper, 1, 0, false, flat, 0, false, undefined), true);
  assert.deepEqual(
    assignScreenBanks(mapper, 1, 0, false, flat, 0, false),
    assignScreenBanks(mapper, 1, 0, false, flat, 0, false, {})
  );
});

test('streamedNeed exactly equal to, and one over, usable.length on every streamable board', () => {
  // Catches >= instead of > (refusing the exact fit) and > usable.length + 1 (accepting one over).
  const boards = MAPPERS.filter((m) => m.streamable);
  assert.ok(boards.length >= 3);
  for (const mapper of boards) {
    const mirroring = mapper.supportsFourScreen ? 'fourscreen' : 'horizontal';
    const probe = blank(mapper.id, mirroring);
    addMap(probe, 1, 1, true);
    const n = usableFor(probe).length;
    const exact = blank(mapper.id, mirroring);
    addMap(exact, 1, n, true);
    assert.deepEqual(streamedFailures(exact), [], `${mapper.name}: ${n} of ${n} fits`);
    const over = blank(mapper.id, mirroring);
    addMap(over, 1, n + 1, true);
    const failures = streamedFailures(over);
    assert.equal(failures.length, 1, `${mapper.name}: ${n + 1} of ${n} is refused`);
    assert.match(failures[0], new RegExp(`need ${n + 1} of the ${n} `));
    assert.match(failures[0], new RegExp(mapper.name));
    assert.equal(checkCapacity(over).problems.find((x) => /streamed maps need/.test(x.message)).where, 'Map Forge');
  }
});

test('a row wider than 24 screens takes a second region per row', () => {
  // Catches Math.floor / a bare divide for the chunk count, and a per-map rather than per-row count.
  const per = (w, h) => {
    const p = blank(UNROM512, 'fourscreen');
    addMap(p, w, h, true);
    return planStreamedRegions(p, mapperById(UNROM512)).streamedNeed;
  };
  assert.equal(STREAM_SCREENS_PER_REGION, 24);
  assert.equal(per(24, 3), 3);
  assert.equal(per(25, 3), 6);
  assert.equal(per(48, 3), 6);
  assert.equal(per(49, 3), 9);
});

test('flash-save reservation on UNROM 512, both ways', () => {
  // Catches reserving the flash region unconditionally (a project with no Save pays for it) and
  // never reserving it (a Save project's streamed maps overlap the sector).
  const saving = () => {
    const p = blank(UNROM512, 'fourscreen');
    const actor = p.sprites.actors.length;
    p.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
    const map = addMap(p, 1, 1, true);
    map.screens[0].entities.push({
      actorId: actor,
      x: 64,
      y: 96,
      props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
    });
    return p;
  };
  const p = saving();
  assert.equal(projectUsesSave(p), true);
  const mapper = mapperById(UNROM512);
  const withSave = planStreamedRegions(p, mapper);
  const without = planStreamedRegions(p, mapper, { reserveFlashSave: false });
  assert.equal(withSave.reserveFlashSave, true);
  assert.equal(without.usable.length, withSave.usable.length + 1);
  const n = withSave.usable.length;
  const grow = (rows) => {
    p.maps[0].gridH = rows;
    while (p.maps[0].screens.length < rows) p.maps[0].screens.push(createScreen()); // screen 0 keeps the Save
  };
  grow(n);
  assert.deepEqual(streamedFailures(p), [], 'fits exactly beside the reserved sector');
  grow(n + 1);
  assert.equal(streamedFailures(p).length, 1, 'one more region would sit on the flash sector');
  // The same map with no Save command gets the region back.
  const plain = blank(UNROM512, 'fourscreen');
  addMap(plain, 1, n + 1, true);
  assert.deepEqual(streamedFailures(plain), []);
});

test('baseBank: absolute nesasm bank numbers, agreeing with the emitted locator, no overlaps', () => {
  // Catches baseBank as an ordinal into the usable list (0, 4) instead of the absolute bank
  // (2, 6 here: CHR-RAM payload regions come off the front), overlapping maps, and streamed
  // regions colliding with ordinary, code or save regions.
  const p = blank(UNROM512, 'fourscreen');
  p.tilesets.push(createTileset(1)); // two tilesets: two CHR-RAM payload regions
  p.tilesets[1].name = 'Second';
  addMap(p, 25, 2, true); // 4 regions
  addMap(p, 1, 3, true); // 3 regions
  addOrdinary(p, 40);
  p.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  p.maps[3].screens[0].entities.push({
    actorId: 0,
    x: 8,
    y: 8,
    props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
  const mapper = mapperById(UNROM512);
  const plan = planStreamedRegions(p, mapper);
  assert.equal(plan.reserveFlashSave, true);
  assert.deepEqual(plan.baseBanks, [2, 6]);
  const layout = emitStreamedLayout(p, { baseBanks: plan.baseBanks });
  const columns = (k) => layout.streamedColumns.slice(k * STREAM_MAP_COLUMN_BYTES, (k + 1) * STREAM_MAP_COLUMN_BYTES);
  assert.equal(columns(0)[STREAM_MAP_COLUMNS.baseBank], 2);
  assert.equal(columns(1)[STREAM_MAP_COLUMNS.baseBank], 6);
  const streamedRegions = layout.maps.filter((m) => m.streamed).flatMap((m) => m.regions.map((r) => r.region));
  assert.deepEqual(streamedRegions, [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(streamedRegions).size, streamedRegions.length);
  assert.ok(streamedRegions.every((r) => r <= 255));
  // Ordinary screens land strictly after the streamed regions, and never in the flash sector.
  const packed = assignScreenBanks(mapper, 2, 0, true, plan.ordinaryFlat, 1, false, { regionsOverride: plan.remainingRegions });
  const ordinaryBanks = packed.regionRanges.map((r) => r.region.nesasmBank);
  assert.ok(ordinaryBanks.every((b) => b > 8), `ordinary regions ${ordinaryBanks}`);
  const flash = prgLayout(mapper).regions.at(-1).nesasmBank;
  assert.ok(!ordinaryBanks.includes(flash) && !streamedRegions.includes(flash));
  const chr = [0, 1];
  assert.ok(streamedRegions.every((r) => !chr.includes(r)));
});

test('baseBank with a banked-code region: the RPG battle bank comes off the front first', () => {
  // Catches a baseBank that forgets codeRegionCount (starting at bank 0, on top of the battle code).
  const p = blank(MMC3, 'horizontal');
  p.project.gameType = 'rpg';
  addMap(p, 1, 5, true);
  const plan = planStreamedRegions(p, mapperById(MMC3));
  assert.deepEqual(plan.baseBanks, [1]); // MMC3 has no CHR-RAM payload; region 0 is the battle code
  assert.equal(plan.usable[0].nesasmBank, 1);
  const layout = emitStreamedLayout(p, { baseBanks: plan.baseBanks });
  assert.deepEqual(layout.maps[0].regions.map((r) => r.region), [1, 2, 3, 4, 5]);
});

test('the kernel-lo table charge: 13 x ordinary + 9 x maps + 6 x streamed + ceil(maps / 8)', () => {
  // Catches charging 13 for a streamed map's own screens, paying the 9 identity bytes only on
  // ordinary maps, indexing the 6 by raw map count, and a 1-byte-per-map type table.
  const mapper = mapperById(MMC3);
  const mixed = blank(MMC3, 'vertical');
  addMap(mixed, 2, 1); // 2 ordinary screens
  addMap(mixed, 1, 40, true); // 40 streamed screens
  addMap(mixed, 1, 1); // 1 ordinary screen
  const meta = metaspriteKernelBytes(mixed);
  const literal = 13 * 3 + 9 * 3 + 6 * 1 + Math.ceil(3 / 8) + meta;
  assert.equal(kernelTableBytes(mixed, mapper).tableBytes, literal);
  // Nine maps: the type table is two bytes, not one and not nine.
  const nine = blank(MMC3, 'vertical');
  for (let i = 0; i < 8; i++) addMap(nine, 1, 1);
  addMap(nine, 1, 2, true);
  assert.equal(kernelTableBytes(nine, mapper).tableBytes, 13 * 8 + 9 * 9 + 6 + 2 + metaspriteKernelBytes(nine));
  // No streamed map: exactly today's formula, no type-table byte, nothing.
  const ordinary = blank(MMC3, 'vertical');
  addMap(ordinary, 2, 1);
  addMap(ordinary, 1, 1);
  assert.equal(kernelTableBytes(ordinary, mapper).tableBytes, 13 * 3 + 9 * 2 + metaspriteKernelBytes(ordinary));
  // A streamed flag turned off again is charged as ordinary.
  const off = structuredClone(mixed);
  off.maps[1].streamed = false;
  assert.equal(kernelTableBytes(off, mapper).tableBytes, 13 * 43 + 9 * 3 + meta);
});

test('the phase-1 "no engine yet" refusal stays, alongside the aggregate checks', () => {
  // Catches the new checks replacing the refusal: a project that fits would then build a ROM.
  const p = blank(UNROM512, 'fourscreen');
  addMap(p, 1, 2, true);
  const list = messages(p);
  assert.ok(list.some((m) => /no engine yet/.test(m)));
  assert.deepEqual(streamedFailures(p), []);
});

test('mapper-switch preflight: the three checks in order, the real project untouched', () => {
  const build = (w, h) => {
    const p = blank(UNROM512, 'fourscreen');
    addMap(p, w, h, true);
    return p;
  };
  const snapshot = (p) => structuredClone(p);

  // (1) capability first: NROM cannot stream. The map is also too big for it, and check 3 must not speak.
  let p = build(1, 40);
  let before = snapshot(p);
  let refusals = checkStreamedMapperSwitch(p, 0, 'fourscreen');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /cannot stream a world/);
  assert.deepEqual(p, before);

  // (2) dead axis second: MMC3 under vertical mirroring can only stream side to side, and this map is
  // 40 tall; it is also too big for MMC3's regions (160 > 30), and check 3 must not speak.
  p = build(4, 40);
  before = snapshot(p);
  refusals = checkStreamedMapperSwitch(p, MMC3, 'vertical');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /screens tall/);
  assert.deepEqual(p, before);

  // (3) aggregate third: MMC1 can stream a 1 x 40 map under horizontal mirroring but has too few regions.
  p = build(1, 40);
  before = snapshot(p);
  refusals = checkStreamedMapperSwitch(p, MMC1, 'horizontal');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /streamed maps need 40 of the /);
  assert.deepEqual(p, before);

  // ...and a candidate that passes all three answers nothing.
  const small = build(1, 20);
  before = snapshot(small);
  assert.deepEqual(checkStreamedMapperSwitch(small, MMC3, 'horizontal'), []);
  assert.deepEqual(small, before);
  // No streamed map: nothing to object to on any board.
  assert.deepEqual(checkStreamedMapperSwitch(blank(MMC1, 'vertical'), 0, 'horizontal'), []);
});

test('the preflight applies reconcileCartridge first: the post-switch shape is what is checked', () => {
  // Catches a preflight that checks the pre-reconcile clone. MMC1 cannot hold four-screen mirroring,
  // so reconcile rewrites it (to vertical); unreconciled, MMC1-with-four-screen reads as "cannot
  // stream" and a legal 5 x 1 switch is refused. The real project's own fields never move.
  const p = blank(UNROM512, 'fourscreen');
  addMap(p, 5, 1, true);
  const before = structuredClone(p);
  const probe = structuredClone(p);
  probe.cartridge.mapper = MMC1;
  probe.cartridge.mirroring = 'fourscreen';
  reconcileCartridge(probe);
  assert.equal(probe.cartridge.mirroring, 'vertical', 'reconcile rewrites the mirroring');
  assert.deepEqual(checkStreamedMapperSwitch(p, MMC1, 'fourscreen'), []);
  assert.deepEqual(p, before);
});

test('switchableMappers asks the preflight, and offers no board to hand-written 6502', () => {
  // A UNROM 512 project with a 1 x 25 streamed map (25 regions): MMC1 cannot hold it, MMC3 can.
  // Catches restating the fit by hand (the flat count would include the streamed maps' own
  // screens) and a code-carrying project being offered a board.
  const p = blank(UNROM512, 'horizontal');
  addMap(p, 1, 25, true);
  const offered = switchableMappers(p, mapperById(UNROM512)).map((m) => m.id);
  assert.ok(offered.includes(MMC3), `offered ${offered}`);
  assert.ok(!offered.includes(MMC1), `offered ${offered}`);
  assert.ok(!offered.includes(0), 'NROM cannot stream');
  const coded = structuredClone(p);
  coded.code.files.push({ name: 'user_hook.asm', text: 'forge_user_hook:\n  rts\n' });
  assert.deepEqual(switchableMappers(coded, mapperById(UNROM512)), []);
  const overridden = structuredClone(p);
  overridden.code.overrides.push({ name: 'input.asm', text: 'nop\n' });
  assert.deepEqual(switchableMappers(overridden, mapperById(UNROM512)), []);
});
