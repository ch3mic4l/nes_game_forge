// Streamed worlds, phase 1 slice B2: the aggregate capacity check, region allocation and the
// mapper-switch preflight (docs/design-streamed-worlds.md §3 "Charge, resolved", §4). Every test
// names the wrong implementation it would catch. Nothing here touches a checked-in fixture; every
// project is built in memory from createProject.
//
// Phase 2 slice 2b, Part D item 1 (shared/project.js's streamedBoardProblems) later narrowed
// "capable" to exactly one board+mirroring combination (UNROM 512, four-screen), sharing its
// message's 'capability' kind with the original incapable-board message; phase 3b S4a / S4b widened it
// to MMC3 and MMC1 action rings (streamRingAdmitted, shared/cartridge.js). The mapper-switch
// preflight tests below were rewritten for each: see each test's own comment.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  createMap,
  createScreen,
  createTileset,
  reconcileCartridge,
  streamedBoardProblems,
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

test('the phase-1 "no engine yet" refusal is gone: a project clearing every Part D check builds with zero problems, alongside the aggregate checks', () => {
  // Phase 2 slice 2b, Part D/E: the blanket refusal this test used to pin is deleted outright, and
  // in its place a project that also clears every per-item authoring check (board/mirroring,
  // camera on, no bound tiles/events/encounters/naming/Save) must produce zero problems -- not
  // merely "no engine yet gone but something else silently still blocks it."
  const p = blank(UNROM512, 'fourscreen');
  p.cartridge.camera = true;
  addMap(p, 1, 2, true);
  const list = messages(p);
  assert.ok(!list.some((m) => /no engine yet/.test(m)), 'the phase-1 blanket refusal must no longer fire');
  assert.deepEqual(streamedFailures(p), []);
  assert.deepEqual(list, [], 'this project has nothing else wrong with it and must build with zero problems');
});

test('mapper-switch preflight: the checks in order, the real project untouched', () => {
  // Phase 3b S4a/S4b: the 'capability' kind covers a board/mirroring that cannot stream or has no ring yet (UNROM 512 non-fourscreen, until S4c), 'ringGame'
  // a board that has one but not for this game type (a streamed RPG on MMC3 or MMC1, until S5), and 'deadAxis' the grid shape. checkStreamedMapperSwitch
  // asks them in that order, then the aggregate region check, and returns the first failing tier's messages.
  const build = (w, h, gameType = 'action') => {
    const p = blank(UNROM512, 'fourscreen');
    if (gameType === 'rpg') p.project.gameType = 'rpg';
    addMap(p, w, h, true);
    return p;
  };
  const snapshot = (p) => structuredClone(p);

  // (1) capability, the original incapable-board message: NROM cannot stream at all.
  let p = build(1, 40);
  let before = snapshot(p);
  let refusals = checkStreamedMapperSwitch(p, 0, 'fourscreen');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /cannot stream a world/);
  assert.deepEqual(p, before);

  // (1b) capability, "no ring on this board yet" (UNROM 512 non-fourscreen until S4c): this map is also 40 screens tall, which UNROM 512 under vertical
  // mirroring could never stream up and down either way -- but the message returned is the board refusal, never a "screens tall" dead-axis message
  // (capability pre-empts deadAxis).
  p = build(4, 40);
  before = snapshot(p);
  refusals = checkStreamedMapperSwitch(p, UNROM512, 'vertical');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /only reaches the two-nametable ring -- not implemented yet on this board/);
  assert.ok(!/screens tall/.test(refusals[0]), 'the dead-axis message must not surface through this function while the board itself is refused');
  assert.deepEqual(p, before);

  // (2) ringGame: an RPG streamed map on MMC3 (admitted for action only; MMC1 answers the same). Same tier as capability, so it pre-empts the dead axis too.
  p = build(4, 40, 'rpg');
  before = snapshot(p);
  refusals = checkStreamedMapperSwitch(p, MMC3, 'vertical');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /streamed RPGs are not implemented there yet/);
  assert.ok(!/screens tall/.test(refusals[0]));
  assert.deepEqual(p, before);

  // (3) deadAxis, now reachable: an action map 40 screens tall on MMC3 vertical passes both board tiers and fails the shape.
  p = build(4, 40);
  before = snapshot(p);
  refusals = checkStreamedMapperSwitch(p, MMC3, 'vertical');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /screens tall/);
  assert.deepEqual(p, before);
  // ...and the same map as 40 x 1 on MMC3 vertical passes every tier (40 > the 30-region horizontal limit does not apply to a vertical ring).
  assert.deepEqual(checkStreamedMapperSwitch(build(40, 1), MMC3, 'vertical'), []);
  // (3b) the same on MMC1 (S4b): the RPG is the game-type refusal, the 40-tall action map is the dead-axis shape refusal
  refusals = checkStreamedMapperSwitch(build(4, 40, 'rpg'), MMC1, 'vertical');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /streamed RPGs are not implemented there yet/);
  refusals = checkStreamedMapperSwitch(build(4, 40), MMC1, 'vertical');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /screens tall/);
  assert.deepEqual(checkStreamedMapperSwitch(build(40, 1), MMC1, 'vertical'), []);

  // (4) aggregate: a UNROM 512 four-screen map one screen taller than the board's own usable region count.
  const usable = usableFor(build(1, 1)).length;
  p = build(1, usable + 1);
  before = snapshot(p);
  refusals = checkStreamedMapperSwitch(p, UNROM512, 'fourscreen');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], new RegExp(`need ${usable + 1} of the ${usable} `));
  assert.deepEqual(p, before);

  // ...and a candidate that passes all of them answers nothing.
  const small = build(1, 20);
  before = snapshot(small);
  assert.deepEqual(checkStreamedMapperSwitch(small, UNROM512, 'fourscreen'), []);
  assert.deepEqual(small, before);
  // No streamed map: nothing to object to on any board.
  assert.deepEqual(checkStreamedMapperSwitch(blank(MMC1, 'vertical'), 0, 'horizontal'), []);
});

test('the preflight applies reconcileCartridge first: the post-switch shape is what is checked', () => {
  // Catches a preflight that checks the pre-reconcile clone. UNROM 512 has no mirroring option
  // named "bogus" (mirroringOptions, shared/cartridge.js); reconcileCartridge's own fallback
  // rewrites an unrecognised mirroring to vertical. Item 1 now refuses every mirroring but
  // four-screen on this board anyway, so the useful thing left to prove is that the message names
  // the RECONCILED value ("vertical"), not the literal candidate string passed in.
  const p = blank(UNROM512, 'fourscreen');
  addMap(p, 5, 1, true);
  const before = structuredClone(p);
  const probe = structuredClone(p);
  probe.cartridge.mirroring = 'bogus';
  reconcileCartridge(probe);
  assert.equal(probe.cartridge.mirroring, 'vertical', 'reconcile rewrites the mirroring');
  const refusals = checkStreamedMapperSwitch(p, UNROM512, 'bogus');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /UNROM 512 with vertical mirroring/);
  assert.deepEqual(p, before);
});

test('switchableMappers never offers a board to a streamed project that then fails validate, from any starting board', () => {
  // switchableMappers checks each candidate at the project's OWN current mirroring (main/build/generate.js's streamedWorld branch), never at a
  // mirroring the candidate would itself need, and excludes the project's current mapper. Since phase 3b S4a / S4b the candidates that clear the
  // streamed tiers are MMC1 and MMC3 (action, both ring mirrorings, a shape its dead axis allows) and UNROM 512 four-screen; a project on U512 four-screen
  // therefore has no OTHER board with four-screen wiring to move to (reconcileCartridge would change the mirroring, which is not lossless).
  // What this test pins is the safety direction: whatever is offered, the moved project validates with no streamed error -- never UI drift.
  const everyOfferedValidates = (p, from) => {
    const offered = switchableMappers(p, mapperById(from));
    for (const mapper of offered) {
      const moved = structuredClone(p);
      moved.cartridge.mapper = mapper.id;
      reconcileCartridge(moved);
      assert.deepEqual(streamedBoardProblems(moved), [], `${mapper.name} was offered to a streamed project but fails validate's board rules`);
    }
    return offered.map((m) => m.id);
  };
  const p = blank(UNROM512, 'horizontal');
  addMap(p, 1, 5, true);
  assert.deepEqual(everyOfferedValidates(p, UNROM512), [MMC1, MMC3], 'a 1 x 5 horizontal map is valid on MMC1 and MMC3 horizontal, and only there');
  const onFourscreen = blank(UNROM512, 'fourscreen');
  addMap(onFourscreen, 1, 5, true);
  assert.deepEqual(everyOfferedValidates(onFourscreen, UNROM512), [], 'no OTHER board matches four-screen');
  const fromMmc3 = blank(MMC3, 'vertical');
  addMap(fromMmc3, 1, 5, true); // 1 x 5 on vertical mirroring is invalid on every board (the dead axis); nothing may be offered
  assert.deepEqual(everyOfferedValidates(fromMmc3, MMC3), []);
  const fromMmc3Ok = blank(MMC3, 'vertical');
  addMap(fromMmc3Ok, 5, 1, true); // valid on MMC3 vertical; MMC1 vertical is the other ring board (S4b) and is offered, UNROM 512 vertical has no ring yet
  assert.deepEqual(everyOfferedValidates(fromMmc3Ok, MMC3), [MMC1]);
  const fromMmc1 = blank(MMC1, 'vertical');
  addMap(fromMmc1, 5, 1, true); // valid on MMC1 (S4b); MMC3 vertical is the other ring board and is offered
  assert.deepEqual(everyOfferedValidates(fromMmc1, MMC1), [MMC3]);
  const rpg = blank(MMC1, 'vertical');
  rpg.project.gameType = 'rpg';
  addMap(rpg, 5, 1, true); // an RPG streamed map: MMC3 would be refused for it (ringGame), so it is not offered
  assert.deepEqual(everyOfferedValidates(rpg, MMC1), []);
  // Hand-written 6502 still short-circuits before any of that: unchanged.
  const coded = structuredClone(p);
  coded.code.files.push({ name: 'user_hook.asm', text: 'forge_user_hook:\n  rts\n' });
  assert.deepEqual(switchableMappers(coded, mapperById(UNROM512)), []);
  const overridden = structuredClone(p);
  overridden.code.overrides.push({ name: 'input.asm', text: 'nop\n' });
  assert.deepEqual(switchableMappers(overridden, mapperById(UNROM512)), []);
});
