// A legitimate streamed save at local y 225-239 must be Continue-able (handoff-next/brief-fix-continue-y.md).
//
// Before the fix `save_check_valid` (engine/save.asm) refused every record whose player_y was above
// MAX_Y (224), a bound that holds an ORDINARY screen (`probe_type` indexes a 240-byte record at
// player_y + BODY_B) but not a streamed one: `sw_pstep_down` crosses to the row below only at the true
// 240 boundary, so the player stands at local y 225-239 beside a lower seam, and its probes go through
// `sw_hazard_probe_type`, which normalizes a straddle. A Save there wrote a checksum-valid record the
// title then refused: no Continue, progress lost. The fix accepts y 225-239 on a screen the build's own
// stream_type_bits says is streamed (`sw_save_streamed_screen`, engine/streamworld.asm) and keeps MAX_Y
// everywhere else, in a mixed project too.
//
// Every real save below is produced by walking the real ROM and running the real Save command; only
// the negative controls (which ordinary play cannot produce) hand-patch a record, and they patch a
// REAL record, recomputing the checksum, so each refusal is the y/identity gate's and not the checksum's.
//
// Which implementation each test catches is named in its own comment.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { saveBodySize } from '../../shared/save.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import NES from '../../renderer/emulator/core/nes.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// engine/constants.asm -- hardcoded, per CLAUDE.md's rule that a test reading the file it checks proves nothing.
const GAME_STATE = 0x25;
const ST_GAMEPLAY = 0;
const ST_TITLE = 3;
const MAP_IS_STREAMED = 0xfe;
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const SELECT = 2;
const START = 3;
const UP = 4;
const DOWN = 5;
const LEFT = 6;

// UNROM 512 flash sector (test/unit/flashsave.test.js's own figures): bank 30, offset $3000.
const SAVE_BANK = 30;
const SECTOR_OFFSET = 0x3000;
const BODY_LEN = saveBodySize();
const RECORD_LEN = BODY_LEN + 2 + 4 + 1; // body, checksum, identity, marker
const MARKER_VALID = 0xa5;
const INES_HEADER = 16;
const BANK_SIZE = 0x4000;
// The first three body fields (shared/save.js SAVE_FIELDS order): flat_screen, player_x, player_y.
const REC_FLAT = 0;
const REC_X = 1;
const REC_Y = 2;
const REC_CHECKSUM_LO = BODY_LEN;
const REC_IDENTITY = BODY_LEN + 2;
// TOUCH_RANGE leaves the player at npc_y - 11 when it walks down into a touch actor (observed, asserted below).
const NPC_Y_FOR_PLAYER_224 = 235;
const NPC_Y_FOR_PLAYER_225 = 236;

// ---------------------------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------------------------

function newNes(bytes) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(bytes));
  return nes;
}
const frames = (nes, n) => {
  for (let i = 0; i < n; i++) nes.frame();
};
const tap = (nes, button, idle = 10) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  frames(nes, idle);
};
/** Frame until the title is up (game_state reads 0 transiently while reset clears RAM), then let its draw finish. */
function waitForTitle(nes) {
  const mem = nes.cpu.mem;
  let n = 0;
  do {
    nes.frame();
    n++;
  } while (mem[GAME_STATE] !== ST_TITLE && n < 200);
  assert.ok(n < 200, 'boot reaches the title');
  frames(nes, 40);
}
/** Cold boot to the title, then Start into gameplay. Every project here has a live Save, so a title. */
function bootToGameplay(nes) {
  const mem = nes.cpu.mem;
  waitForTitle(nes);
  tap(nes, START, 0);
  let n = 0;
  while (mem[GAME_STATE] !== ST_GAMEPLAY && n < 200) {
    nes.frame();
    n++;
  }
  frames(nes, 100);
}
const sector = (nes) => nes.rom.rom[SAVE_BANK].subarray(SECTOR_OFFSET, SECTOR_OFFSET + RECORD_LEN);
const markerValid = (nes) => sector(nes)[RECORD_LEN - 1] === MARKER_VALID;

/** Hold `button` until `done()` or the budget runs out; returns the frame count, -1 if the budget ran out. */
function walk(nes, button, done, budget = 600) {
  for (let i = 0; i < budget; i++) {
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
    if (done()) return i + 1;
  }
  return -1;
}

async function buildRom(project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamsavey-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    return { bytes: fs.readFileSync(built.romPath), symbols: fs.readFileSync(built.symbolPath, 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The save-checksum of engine/save.asm's save_checksum, restated: sum1 running total, sum2 running total of sum1. */
function checksumOf(body) {
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < BODY_LEN; i++) {
    s1 = (s1 + body[i]) & 255;
    s2 = (s2 + s1) & 255;
  }
  return [s1, s2];
}
/** A real record with some body fields replaced and the checksum recomputed (unless asked not to). */
function patchedRecord(real, { flat, x, y, fixChecksum = true, identityByte = null } = {}) {
  const rec = Uint8Array.from(real);
  if (flat !== undefined) rec[REC_FLAT] = flat;
  if (x !== undefined) rec[REC_X] = x;
  if (y !== undefined) rec[REC_Y] = y;
  if (fixChecksum) [rec[REC_CHECKSUM_LO], rec[REC_CHECKSUM_LO + 1]] = checksumOf(rec);
  if (identityByte !== null) rec[REC_IDENTITY + identityByte] ^= 0x5a;
  return rec;
}
/** The pristine ROM image with `record` written into the flash sector -- what a cartridge dump of that save would hold. */
function romWithRecord(romBytes, record) {
  const copy = Uint8Array.from(romBytes);
  const at = INES_HEADER + SAVE_BANK * BANK_SIZE + SECTOR_OFFSET;
  assert.ok(copy.subarray(at, at + RECORD_LEN).every((b) => b === 0xff), 'the shipped sector must be blank before a record is patched in');
  copy.set(record, at);
  return copy;
}
/** Fresh power-on from `romBytes`, then the title's Continue. */
function continueFrom(romBytes) {
  const nes = newNes(romBytes);
  const mem = nes.cpu.mem;
  waitForTitle(nes);
  tap(nes, SELECT);
  frames(nes, 120);
  return { nes, state: mem[GAME_STATE], flat: mem[FLAT_SCREEN], x: mem[PLAYER_X], y: mem[PLAYER_Y], streamed: mem[MAP_IS_STREAMED] };
}

// ---------------------------------------------------------------------------------------------
// worlds
// ---------------------------------------------------------------------------------------------

function npc(project, map, screen, x, y, trigger, commands) {
  const id = project.sprites.actors.length;
  project.sprites.actors.push({ name: `Saver ${id}`, behavior: 'npc', hp: 1, damage: 0 });
  map.screens[screen].entities = [
    ...(map.screens[screen].entities ?? []),
    { actorId: id, x, y, props: { trigger, event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
  ];
}
/**
 * A U512 four-screen streamed world, one screen wide and four tall (vertical seams only), with a title.
 * 'touch': a Save actor on screen 0 at (120, touchY), reached by walking straight down from the start.
 * 'enter': a Save actor on screen 1 whose event fires on entering it -- an upward crossing lands the
 *          player at local y 239, a downward one at the top, so walking down to screen 2 and back up saves at 239.
 */
function verticalWorld(gameType, { touchY = null, enterOnScreen1 = false } = {}) {
  const project = createStreamedProject({ gameType, gridW: 1, gridH: 4 });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const map = project.maps.find((m) => m.streamed);
  if (touchY !== null) npc(project, map, 0, 120, touchY, 'touch', [{ op: 'save' }]);
  if (enterOnScreen1) npc(project, map, 1, 120, 100, 'enter', [{ op: 'save' }]);
  return project;
}

/** Walk the real ROM to a real Save at the wanted spot; returns the booted instance, its pristine image and the record. */
async function realSave(gameType, wanted) {
  const project =
    wanted.kind === 'touch'
      ? verticalWorld(gameType, { touchY: wanted.touchY })
      : verticalWorld(gameType, { enterOnScreen1: true });
  const { bytes, symbols } = await buildRom(project);
  const nes = newNes(bytes);
  const mem = nes.cpu.mem;
  bootToGameplay(nes);
  assert.equal(mem[MAP_IS_STREAMED], 1, 'the start screen is streamed');
  assert.equal(markerValid(nes), false, 'the shipped sector holds no save yet');
  if (wanted.kind === 'touch') {
    assert.ok(walk(nes, DOWN, () => markerValid(nes)) > 0, 'walking down into the Save actor commits a save');
  } else {
    assert.ok(walk(nes, DOWN, () => mem[FLAT_SCREEN] === 2) > 0, 'walk down to screen 2');
    frames(nes, 80);
    assert.ok(walk(nes, UP, () => mem[FLAT_SCREEN] === 1 && mem[PLAYER_Y] > 200) > 0, 'walk back up into screen 1');
  }
  frames(nes, 120); // the streamed commit's redraw/resync tail
  assert.equal(markerValid(nes), true, 'a save is committed');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'play resumes after the save');
  return { nes, bytes, symbols, record: Uint8Array.from(sector(nes)) };
}

const GAME_TYPES = ['action', 'rpg'];

// ---------------------------------------------------------------------------------------------
// 1. the coordinate contract: 239 is the true maximum a streamed walk produces
// ---------------------------------------------------------------------------------------------

// Catches: a validator ceiling that is merely "higher than 224" but short of what play reaches (e.g. 230),
// and an engine whose crossing moves (sw_pstep_down/up cross at 240) so the real maximum is not 239.
for (const gameType of GAME_TYPES) {
  test(
    `streamed local y: a held walk down and back up across three seams reaches exactly 239 and never 240 [${gameType}]`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const { bytes } = await buildRom(verticalWorld(gameType));
      const nes = newNes(bytes);
      const mem = nes.cpu.mem;
      bootToGameplay(nes);
      let max = 0;
      let crossings = 0;
      let last = mem[FLAT_SCREEN];
      const sample = () => {
        max = Math.max(max, mem[PLAYER_Y]);
        if (mem[FLAT_SCREEN] !== last) {
          crossings++;
          last = mem[FLAT_SCREEN];
        }
      };
      assert.ok(walk(nes, DOWN, () => (sample(), mem[FLAT_SCREEN] === 3), 1500) > 0, 'reaches the bottom screen');
      assert.ok(walk(nes, UP, () => (sample(), mem[FLAT_SCREEN] === 0 && mem[PLAYER_Y] < 100), 1500) > 0, 'and back to the top');
      assert.equal(crossings, 6, 'three seams down, three up');
      assert.equal(max, 239, 'the highest local y a streamed walk stands at is 239 -- 240 or more crosses to the next row');
    }
  );
}

// ---------------------------------------------------------------------------------------------
// 2. real saves at y = 224, 225 and 239 -> flash power cycle -> Continue -> the world still walks
// ---------------------------------------------------------------------------------------------

const REAL_CASES = [
  { y: 224, kind: 'touch', touchY: NPC_Y_FOR_PLAYER_224, screen: 0 },
  { y: 225, kind: 'touch', touchY: NPC_Y_FOR_PLAYER_225, screen: 0 },
  { y: 239, kind: 'enter', screen: 1 }
];

for (const gameType of GAME_TYPES) {
  for (const c of REAL_CASES) {
    // Catches: the unfixed `cmp #MAX_Y+1 / bcs` (y = 225 and 239 refuse: Continue never leaves the title);
    // an off-by-one that also refuses the inclusive 224; a validator that accepts the record but a landing that
    // moves the player (y or screen differs after Continue); and a landing that leaves the world unwalkable (the
    // walk down and back up across the seam below).
    test(
      `a real streamed save at local y ${c.y} Continues to the same screen/x/y and walks across the seam both ways [${gameType}]`,
      { skip: !hasNesasm && 'nesasm not found on PATH' },
      async () => {
        const { nes, record } = await realSave(gameType, c);
        let mem = nes.cpu.mem;
        assert.deepEqual([record[REC_FLAT], record[REC_Y]], [c.screen, c.y], `the real save records screen ${c.screen}, y ${c.y}`);
        // walk away so the live position differs from the saved one -- Continue must restore, not merely keep
        walk(nes, LEFT, () => false, 25);
        // In-session reset with flash preserved: the console losing power with the cartridge seated (flashsave.test.js).
        nes.reloadROM();
        mem = nes.cpu.mem; // reloadROM builds a fresh RAM array
        waitForTitle(nes);
        assert.equal(mem[GAME_STATE], ST_TITLE, 'the power cycle boots back to the title');
        tap(nes, SELECT);
        frames(nes, 120);
        assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'Continue loaded the save');
        assert.equal(mem[MAP_IS_STREAMED], 1, 'on a streamed screen');
        assert.equal(mem[FLAT_SCREEN], c.screen, 'on the saved screen');
        assert.equal(mem[PLAYER_X], record[REC_X], 'at the saved x');
        assert.equal(mem[PLAYER_Y], c.y, `at the saved y ${c.y}`);

        // step off the Save actor's column (a touch actor would otherwise re-arm), then cross the lower seam and come back
        walk(nes, LEFT, () => false, 25);
        assert.ok(walk(nes, DOWN, () => mem[FLAT_SCREEN] === c.screen + 1, 300) > 0, 'walks down across the lower seam');
        frames(nes, 40);
        assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
        assert.ok(mem[PLAYER_Y] < 16, `lands at the top of the next row (y ${mem[PLAYER_Y]})`);
        assert.ok(walk(nes, UP, () => mem[FLAT_SCREEN] === c.screen && mem[PLAYER_Y] > 200, 300) > 0, 'walks back up across it');
        frames(nes, 40);
        assert.ok(mem[PLAYER_Y] >= 237, `an upward crossing lands at the bottom of the row (y ${mem[PLAYER_Y]})`);
        const before = mem[PLAYER_Y];
        walk(nes, UP, () => false, 10);
        assert.ok(mem[PLAYER_Y] < before, 'and keeps walking up');
        assert.equal(mem[MAP_IS_STREAMED], 1);
        assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
      }
    );
  }
}

// ---------------------------------------------------------------------------------------------
// 3. battery persistence
// ---------------------------------------------------------------------------------------------
// No shipped streamed board carries a battery: streamed worlds are refused everywhere but UNROM 512 four-screen
// (streamCapableFourScreen, shared/cartridge.js), whose save medium is the flash sector exercised above, and
// MMC1/MMC3 -- the boards with battery SRAM -- are refused by validateProject. save_check_valid addresses the record
// only through SAVE_BASE, so the y gate is the same code on both media; the battery path is covered by
// test/lua/ring_gate/repro_continue_y.mjs on the ring prototype's MMC1 streamed world (reported in
// handoff-next/fix-continue-y-report.md), not by a unit test that would need to bypass the validator.

// ---------------------------------------------------------------------------------------------
// 4. ordinary screens keep MAX_Y; streamed screens take 225-239; the owner walk is right at every map boundary
// ---------------------------------------------------------------------------------------------

/** The flat-id ranges each map owns, derived from map order and screen counts (not from the engine's table). */
function flatRanges(project) {
  let next = 0;
  return project.maps.map((map) => {
    const range = { streamed: map.streamed === true, first: next, last: next + map.screens.length - 1 };
    next += map.screens.length;
    return range;
  });
}

/** An ordinary project with a Save: the mixed shape with every map forced ordinary (kernelbytes.test.js's own idiom). */
function ordinaryWorld(gameType, { mixed }) {
  const project = createStreamedProject({ gameType, mixed });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const first = project.maps[0];
  for (const map of project.maps) map.streamed = false;
  npc(project, first, 0, 120, 140, 'touch', [{ op: 'save' }]);
  return project;
}
async function realOrdinarySave(project) {
  const { bytes, symbols } = await buildRom(project);
  const nes = newNes(bytes);
  const mem = nes.cpu.mem;
  bootToGameplay(nes);
  assert.ok(walk(nes, DOWN, () => markerValid(nes)) > 0, 'walking into the Save actor commits a save');
  frames(nes, 120);
  assert.equal(markerValid(nes), true);
  return { bytes, symbols, record: Uint8Array.from(sector(nes)), liveY: mem[PLAYER_Y] };
}

for (const gameType of GAME_TYPES) {
  // Catches: a validator that relaxes the bound for every project (a pure ordinary project accepts 225), and a
  // non-gated engine change (the ordinary build must not even contain the streamed helper).
  test(
    `ordinary project: a saved y of 224 Continues, 225 is refused, and the build has no streamed save code [${gameType}]`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const { bytes, symbols, record } = await realOrdinarySave(ordinaryWorld(gameType, { mixed: false }));
      assert.ok(!/^sw_save_streamed_screen/m.test(symbols), 'a non-streaming build assembles no sw_save_streamed_screen');
      assert.ok(!/^save_check_y_stream/m.test(symbols), 'nor the streamed y gate');
      const ok = continueFrom(romWithRecord(bytes, patchedRecord(record, { y: 224 })));
      assert.deepEqual([ok.state, ok.y], [ST_GAMEPLAY, 224], 'y = 224 is the ordinary maximum and Continues');
      const refused = continueFrom(romWithRecord(bytes, patchedRecord(record, { y: 225 })));
      assert.equal(refused.state, ST_TITLE, 'y = 225 cannot come from an ordinary walk and is refused');
    }
  );

  // The mixed project is where "which identity decides" matters: flat ids 0-3 ordinary (Before), 4-9 streamed,
  // 10-13 ordinary (After). The ordinary maps on BOTH sides of the streamed one keep MAX_Y, and the first and last
  // streamed screen take 239.
  // Catches: deciding from ord_screen/cur_map/map_is_streamed (the live current screen, not the SAVED one: the record
  // is loaded from the title where nothing is resolved yet), an owner walk that is off by one at either edge of the
  // streamed map (flat 3 vs 4, 9 vs 10), a gate that treats "the project has a streamed map" as "every screen is
  // streamed", and a ceiling of 240 or more.
  test(
    `mixed project: y above 224 is accepted exactly on the streamed map's screens, at both of its edges [${gameType}]`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const project = ordinaryWorld(gameType, { mixed: true });
      // restore the streamed middle map the ordinary builder switched off
      project.maps[1].streamed = true;
      const ranges = flatRanges(project);
      assert.deepEqual(ranges.map((r) => [r.streamed, r.first, r.last]), [[false, 0, 3], [true, 4, 9], [false, 10, 13]]);
      const { bytes, symbols, record } = await realOrdinarySave(project);
      assert.ok(/^sw_save_streamed_screen\s/m.test(symbols), 'the mixed project assembles the streamed save helper');
      const verdict = (flat, y) => continueFrom(romWithRecord(bytes, patchedRecord(record, { flat, y })));
      for (let flat = 0; flat <= 13; flat++) {
        const streamed = flat >= 4 && flat <= 9;
        for (const y of [224, 225, 239, 240]) {
          const expectAccepted = y === 224 || (streamed && (y === 225 || y === 239));
          const got = verdict(flat, y);
          assert.equal(
            got.state === ST_GAMEPLAY,
            expectAccepted,
            `flat screen ${flat} (${streamed ? 'streamed' : 'ordinary'}), saved y ${y}: ${expectAccepted ? 'accepted' : 'refused'}`
          );
          if (expectAccepted) assert.deepEqual([got.flat, got.y], [flat, y], `flat ${flat}, y ${y}: Continue lands where it was saved`);
        }
      }
    }
  );
}

/**
 * Ten maps: ordinary maps 0-7 (one screen each, flats 0-7), the streamed map as raw map 8 (flats 8-13), an ordinary map 9
 * (flat 14). The mixed test above has only three maps, so every owner there is raw map 0-2 and reads stream_type_bits[0];
 * only a streamed map at raw index >= 8 reads the SECOND type byte, and a helper whose type-byte index is wrong for it
 * (e.g. forced to 0) still passes that test.
 */
function tenMapWorld(gameType) {
  const project = ordinaryWorld(gameType, { mixed: true });
  const [first, stream, last] = project.maps;
  stream.streamed = true;
  const before = Array.from({ length: 8 }, (_, i) => {
    const map = structuredClone(first);
    map.screens = map.screens.slice(0, 1);
    if (i) map.screens[0].entities = [];
    return map;
  });
  last.screens = last.screens.slice(0, 1);
  project.maps = [...before, stream, last];
  project.maps.forEach((map, i) => {
    map.id = i;
    map.name = `Map ${i}`;
  });
  return project;
}

for (const gameType of GAME_TYPES) {
  // Catches: a type-byte index that does not follow (map >> 3) -- forced to byte 0 or to the raw map index -- which
  // refuses legitimate streamed saves on a streamed map at raw index 8 or above (the three-map test cannot see it), and a
  // mask index that does not follow (map & 7) (map 8 is bit 0 of byte 1, so a wrong mask also misjudges flats 0-7 and 14).
  test(
    `ten-map project: a streamed map at raw index 8 owns y 239 at flats 8 and 13; ordinary maps 0-7 and 9 refuse it [${gameType}]`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const project = tenMapWorld(gameType);
      assert.deepEqual(
        flatRanges(project).map((r) => [r.streamed, r.first, r.last]),
        [...Array.from({ length: 8 }, (_, i) => [false, i, i]), [true, 8, 13], [false, 14, 14]]
      );
      const { bytes, record } = await realOrdinarySave(project);
      const verdict = (flat, y) => continueFrom(romWithRecord(bytes, patchedRecord(record, { flat, y })));
      for (const flat of [0, 7, 14]) {
        assert.equal(verdict(flat, 239).state, ST_TITLE, `ordinary flat ${flat}: y 239 is refused`);
        assert.equal(verdict(flat, 224).state, ST_GAMEPLAY, `ordinary flat ${flat}: y 224 still Continues`);
      }
      for (const flat of [8, 13]) {
        const got = verdict(flat, 239);
        assert.equal(got.state, ST_GAMEPLAY, `streamed flat ${flat}: y 239 is accepted`);
        assert.deepEqual([got.flat, got.y], [flat, 239], `streamed flat ${flat}: Continue lands where it was saved`);
      }
    }
  );
}

// ---------------------------------------------------------------------------------------------
// 5. corrupt-save controls on a streamed screen
// ---------------------------------------------------------------------------------------------

for (const gameType of GAME_TYPES) {
  // Catches: a streamed range that is "anything" (y 240 / 255 accepted), a gate that skips the checksum or identity
  // once the y is in the streamed range, and a gate placed before the screen bound.
  test(
    `streamed screen: y 240 and 255, a bad checksum, a foreign identity and an out-of-range screen are still refused [${gameType}]`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const { bytes, record } = await realSave(gameType, REAL_CASES[2]);
      const state = (rec) => continueFrom(romWithRecord(bytes, rec)).state;
      assert.equal(record[REC_Y], 239);
      assert.equal(state(patchedRecord(record, {})), ST_GAMEPLAY, 'control: the untouched real record Continues');
      assert.equal(state(patchedRecord(record, { y: 240 })), ST_TITLE, 'y 240 is past the streamed screen');
      assert.equal(state(patchedRecord(record, { y: 255 })), ST_TITLE, 'y 255 likewise');
      assert.equal(state(patchedRecord(record, { y: 238 })), ST_GAMEPLAY, 'control: 238 is fine');
      assert.equal(state(patchedRecord(record, { y: 239, fixChecksum: false })), ST_GAMEPLAY, 'control: an unchanged body keeps its checksum');
      assert.equal(state(patchedRecord(record, { y: 232, fixChecksum: false })), ST_TITLE, 'a body edited without a new checksum is refused');
      for (let b = 0; b < 4; b++) {
        assert.equal(state(patchedRecord(record, { identityByte: b })), ST_TITLE, `identity byte ${b} flipped is refused`);
      }
      assert.equal(state(patchedRecord(record, { flat: 4 })), ST_TITLE, 'a screen this world does not have is refused (the screen bound runs first)');
    }
  );
}
