// Switch-bound tiles: authored per-screen data where a cell reads as a
// different metatile while a chosen switch is set (a bridge appearing, a
// chest opening) -- design-tile.md, released to implementation after six
// review rounds. See handoff-tile/tile-implementation-report.md for the
// full accounting; this file follows its own §12 testing plan.
//
// No new opcode: the mechanism hooks the existing Turn switch on/off
// commands (script_op_set/script_op_clear -> tile_switch_changed) and a
// shared bound_tile_lookup primitive draw_screen/probe_type/text_close_step
// all call instead of reading [mtptr_lo],y directly. A flip that cannot land
// immediately (the message box owns the cell, or the frame's one-flip budget
// is spent) waits in a deduped FIFO queue (flip_pending_idx/count) that
// flip_tick drains, one entry per frame, from main_loop.
//
// Everything here builds its own project rather than touching `sample`,
// which is a checked-in fixture -- except the two pure-JS predicate/schema
// tests, which need no ROM at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import {
  createProject,
  createScreen,
  normalizeProject,
  validateProject,
  projectUsesBoundTiles,
  LIMITS,
  RPG_LIMITS
} from '../../shared/project.js';
import { checkCapacity, kernelCodeBytes, kernelTableBytes, BOUND_TILE_KERNEL_ALLOWANCE } from '../../main/build/generate.js';
import { mapperById } from '../../shared/cartridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const BOX_STATE = 0x40;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const SWITCHES = 0x390;
const BIND_IDX = 0x547; // @size=8
const BIND_MT = 0x54f; // @size=8
const BIND_COUNT = 0x557;
const FLIP_BUDGET = 0x55e;
const FLIP_PENDING_IDX = 0x55f; // @size=8
const FLIP_PENDING_COUNT = 0x567;

const ST_GAMEPLAY = 0;
const B = 1;

const switchOn = (nes, n) => Boolean(nes.cpu.mem[SWITCHES + (n >> 3)] & (1 << (n & 7)));

function boot(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  if (nes.cpu.mem[GAME_STATE] === 3) {
    nes.buttonDown(1, 3);
    nes.frame();
    nes.buttonUp(1, 3);
    for (let i = 0; i < 12; i++) nes.frame();
  }
  return nes;
}

const tap = (nes, button, frames = 2) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

const run = (nes, frames) => {
  for (let i = 0; i < frames; i++) nes.frame();
};

function settle(nes, frames = 400) {
  for (let i = 0; i < frames; i++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    nes.frame();
  }
  return false;
}

/** The four CHR tile ids of the metatile drawn at (row, col), straight off the PPU nametable. */
function cell(nes, row, col) {
  const at = (tr, tc) => nes.ppu.vramMem[0x2000 + tr * 32 + tc];
  return [at(row * 2, col * 2), at(row * 2, col * 2 + 1), at(row * 2 + 1, col * 2), at(row * 2 + 1, col * 2 + 1)];
}

/**
 * A one-screen project (built on `sample`) wiped to metatile 0 (open, per
 * move.test.js's own convention), with metatile 1 given a distinct,
 * fingerprintable art pattern sharing metatile 0's palette (so a bound tile
 * substituting it is a legal, same-palette binding by construction), plus
 * one talkable NPC carrying `commands`. `bind` is an array of
 * {switchId, row, col, metatileId} pushed onto the screen directly.
 */
async function buildWith(t, commands, { bind = [], npcX = 128, npcY = 96, tweak = () => {} } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const slime = project.sprites.actors[0];
  const npcId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'Switcher', behavior: 'npc' });
  project.metatiles[1].tiles = [5, 6, 7, 8];
  project.metatiles[1].palette = project.metatiles[0].palette;
  const screen = project.maps[0].screens[0];
  screen.metatiles = new Array(240).fill(0);
  screen.boundTiles = bind;
  screen.entities = [
    {
      actorId: npcId,
      x: npcX,
      y: npcY,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    }
  ];
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, dir, romPath: built.romPath, symbolPath: built.symbolPath, nes: boot(built.romPath) };
}

// ------------------------------------------------------------------- wire

test('projectUsesBoundTiles is true only once a screen carries a live bound tile', () => {
  const project = createProject('Predicate');
  assert.equal(projectUsesBoundTiles(project), false, 'a fresh project authors none');

  project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 0 }];
  assert.equal(projectUsesBoundTiles(project), true, 'one authored binding counts');

  project.maps[0].screens[0].boundTiles = [];
  assert.equal(projectUsesBoundTiles(project), false, 'clearing them back out turns it back off');

  // A second map, a second screen -- the predicate has to walk every map, not
  // just the first.
  project.maps.push({ ...structuredClone(project.maps[0]), id: 1 });
  project.maps[1].screens[0].boundTiles = [{ switchId: 3, row: 2, col: 2, metatileId: 0 }];
  assert.equal(projectUsesBoundTiles(project), true, 'a binding on a later map still counts');
});

test('normalizeProject clamps an out-of-range bound tile and caps the count at LIMITS.boundTilesPerScreen', () => {
  const raw = {
    ...createProject('Clamp'),
    maps: [
      {
        ...createProject('Clamp').maps[0],
        screens: [
          {
            ...createScreen(),
            boundTiles: [
              { switchId: 999, row: -1, col: 999, metatileId: -5 },
              ...Array.from({ length: LIMITS.boundTilesPerScreen + 5 }, (_, i) => ({
                switchId: i % RPG_LIMITS.switches,
                row: 0,
                col: i % LIMITS.screenCols,
                metatileId: 0
              }))
            ]
          }
        ]
      }
    ]
  };
  const project = normalizeProject(raw);
  const bound = project.maps[0].screens[0].boundTiles;
  assert.equal(bound.length, LIMITS.boundTilesPerScreen, 'a screen with more entries than the engine allows is truncated, not refused');
  assert.equal(bound[0].switchId, RPG_LIMITS.switches - 1, 'an out-of-range switchId clamps into range rather than being dropped');
  assert.equal(bound[0].row, 0, 'a negative row clamps to 0');
  assert.equal(bound[0].col, LIMITS.screenCols - 1, 'an out-of-range col clamps into range');
  assert.equal(bound[0].metatileId, 0, 'a negative metatileId clamps to 0');
});

// -------------------------------------------------------- validateProject

function screenWith(boundTiles, tweakMetatiles = () => {}) {
  const project = createProject('Validate');
  tweakMetatiles(project.metatiles);
  project.maps[0].screens[0].boundTiles = boundTiles;
  return project;
}

function errorsFor(project) {
  return validateProject(project).filter((p) => p.severity === 'error');
}

test('validateProject refuses more bound tiles than the engine allows', () => {
  const project = screenWith(
    Array.from({ length: LIMITS.boundTilesPerScreen + 1 }, (_, i) => ({ switchId: 0, row: 0, col: i, metatileId: 0 }))
  );
  const errors = errorsFor(project);
  assert.ok(errors.some((e) => /switch-bound tiles/.test(e.message) && /engine allows/.test(e.message)));
});

test('validateProject refuses an out-of-range binding, and range checking runs before duplicate/palette checks', () => {
  // An out-of-range entry sharing its (row, col) with an in-range one must
  // not also trigger the duplicate-cell error -- range-failed entries are
  // excluded from that check entirely (design-tile.md §10's own ordering).
  const project = screenWith([
    { switchId: 999, row: 0, col: 0, metatileId: 0 },
    { switchId: 1, row: 0, col: 0, metatileId: 0 }
  ]);
  const errors = errorsFor(project);
  assert.ok(errors.some((e) => /invalid switch-bound tile/.test(e.message)));
  assert.ok(!errors.some((e) => /two switch-bound tiles/.test(e.message)), 'the out-of-range entry must not also be counted as a duplicate');
});

test('validateProject refuses two bindings at the same cell', () => {
  const project = screenWith([
    { switchId: 1, row: 3, col: 4, metatileId: 0 },
    { switchId: 2, row: 3, col: 4, metatileId: 0 }
  ]);
  const errors = errorsFor(project);
  assert.ok(errors.some((e) => /two switch-bound tiles at row 3, col 4/.test(e.message)));
});

test('validateProject refuses a substitute whose palette does not match what is painted, and accepts one that does', () => {
  const withMismatch = screenWith([{ switchId: 1, row: 0, col: 0, metatileId: 1 }], (metatiles) => {
    metatiles[0].palette = 0; // whatever is painted at (0,0) -- metatile id 0
    metatiles[1].palette = 1; // the substitute -- a different group
  });
  const mismatchErrors = errorsFor(withMismatch);
  assert.ok(mismatchErrors.some((e) => /different palette group/.test(e.message)));

  const matching = screenWith([{ switchId: 1, row: 0, col: 0, metatileId: 1 }], (metatiles) => {
    metatiles[0].palette = 2;
    metatiles[1].palette = 2;
  });
  const matchingErrors = errorsFor(matching);
  assert.ok(!matchingErrors.some((e) => /palette group/.test(e.message)), 'a same-palette substitute must not be refused');
});

// --------------------------------------------------------- generator/JS

test('BOUND_TILE_ENABLED and BOUND_CAP appear in config.inc only when a project uses the feature', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-config-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const without = await loadProject(SAMPLE);
  const withDir = path.join(dir, 'with');
  const withoutDir = path.join(dir, 'without');
  await saveProject(withoutDir, without);
  await buildProject({ dir: withoutDir, project: without, log: () => {} });
  const withoutConfig = await fs.promises.readFile(path.join(withoutDir, 'build/assets/config.inc'), 'utf8');
  assert.match(withoutConfig, /BOUND_TILE_ENABLED\s*=\s*0/);

  const withProject = await loadProject(SAMPLE);
  const paintedId = withProject.maps[0].screens[0].metatiles[0];
  withProject.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: paintedId }];
  await saveProject(withDir, withProject);
  await buildProject({ dir: withDir, project: withProject, log: () => {} });
  const withConfig = await fs.promises.readFile(path.join(withDir, 'build/assets/config.inc'), 'utf8');
  assert.match(withConfig, /BOUND_TILE_ENABLED\s*=\s*1/);
  assert.match(withConfig, new RegExp(`BOUND_CAP\\s*=\\s*${LIMITS.boundTilesPerScreen}`));
});

test('an override of a bound-tile engine file still triggers the ordinary Code Forge capacity warning', () => {
  const project = createProject('Override', 'action');
  project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 0 }];
  project.code.overrides = [{ name: 'screens.asm', text: '; hand-edited bound_tile_lookup\n' }];
  const problems = checkCapacity(project);
  assert.ok(
    problems.problems.some((p) => p.where === 'Code Forge' && /hand-written engine code/.test(p.message)),
    'an override of the file bound_tile_lookup now lives in must still warn that capacity is unmeasured there'
  );
});

// design-tile.md §11/§12 test 18: esptr_lo/esptr_hi's own shared-scratch
// lifetime (bdptr_lo/bdptr_hi aliased onto it) is provably safe against the
// stock call graph, but an entities.asm override that stashes esptr across
// its own calls -- legal today -- is silently clobbered the instant the
// same project also has a live bound tile. Named, not just the generic
// capacity warning, so an override author has some trace of why.
test('an entities.asm override referencing esptr, with a live bound tile, warns about the aliasing specifically', () => {
  const project = createProject('Override', 'action');
  project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 0 }];
  project.code.overrides = [{ name: 'entities.asm', text: 'my_routine:\n  lda esptr_lo\n  pha\n  jsr other\n  pla\n  sta esptr_lo\n  rts\n' }];
  const problems = checkCapacity(project);
  assert.ok(
    problems.problems.some((p) => p.where === 'Code Forge' && /esptr_lo\/esptr_hi/.test(p.message) && /clobbered/.test(p.message)),
    'an entities.asm override that mentions esptr, with a live bound tile, should name the aliasing interaction specifically'
  );
  // Keeping the generic warning too -- this finding narrows nothing about it.
  assert.ok(
    problems.problems.some((p) => p.where === 'Code Forge' && /hand-written engine code/.test(p.message)),
    'the generic capacity warning must still fire alongside the esptr-specific one'
  );
});

test('the esptr-aliasing warning requires both a live bound tile and an entities.asm override that actually mentions esptr', () => {
  const espTrText = 'my_routine:\n  lda esptr_lo\n  sta $10\n  rts\n';

  const noBoundTile = createProject('Override', 'action');
  noBoundTile.code.overrides = [{ name: 'entities.asm', text: espTrText }];
  assert.ok(
    !checkCapacity(noBoundTile).problems.some((p) => /esptr_lo\/esptr_hi/.test(p.message)),
    'no live bound tile at all -- the aliasing never runs, so this must not warn'
  );

  const wrongFile = createProject('Override', 'action');
  wrongFile.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 0 }];
  wrongFile.code.overrides = [{ name: 'player.asm', text: espTrText }];
  assert.ok(
    !checkCapacity(wrongFile).problems.some((p) => /esptr_lo\/esptr_hi/.test(p.message)),
    'esptr mentioned in a different override entirely -- entities.asm is what actually owns the pointer, this must not warn'
  );

  const noEsptrMention = createProject('Override', 'action');
  noEsptrMention.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 0 }];
  noEsptrMention.code.overrides = [{ name: 'entities.asm', text: '; nothing esptr-related here\n' }];
  assert.ok(
    !checkCapacity(noEsptrMention).problems.some((p) => /esptr_lo\/esptr_hi/.test(p.message)),
    'an entities.asm override that never mentions esptr has nothing to warn about'
  );
});

test('kernelShortfallAdvice frees the bound-tile-dependent fixed/table terms too, not kernelCodeBytes alone', async () => {
  // design-tile.md §8, finding 5: summing BOUND_TILE_KERNEL_ALLOWANCE alone
  // would under-report what dropping every bound tile actually frees, since
  // it also drops kernelTableBytes' own 30-byte row table and 2-bytes/screen
  // pointer table. Constructed the same way the Move/split-lock and
  // Sting/split-lock dependent-term tests already are: a deficit reproduced
  // strictly above BOUND_TILE_KERNEL_ALLOWANCE alone, at or below the full
  // occupancy delta, so the flat allowance alone provably would not close it
  // but the real strip does.
  const mapper = mapperById(4); // MMC3
  const project = await loadProject(path.join(ROOT, 'sample-rpg'));
  project.cartridge.mapper = mapper.id;
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const paintedId = project.maps[0].screens[0].metatiles[0];
  project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: paintedId }];

  const occupancy = (proj) => {
    const { fixedBytes, tableBytes } = kernelTableBytes(proj);
    return kernelCodeBytes(proj, mapper) + fixedBytes + tableBytes;
  };
  const before = occupancy(project);
  const dropped = structuredClone(project);
  dropped.maps[0].screens[0].boundTiles = [];
  const fullyFreed = before - occupancy(dropped);

  assert.ok(
    fullyFreed > BOUND_TILE_KERNEL_ALLOWANCE,
    `dropping every bound tile should free more than BOUND_TILE_KERNEL_ALLOWANCE (${BOUND_TILE_KERNEL_ALLOWANCE}) alone ` +
      `(the 30-byte row table and the one screen's own 2-byte pointer entry should ride along); measured ${fullyFreed}`
  );

  const inflate = (proj, count) => {
    const template = proj.sprites.actors[0];
    for (let i = 0; i < count; i++) proj.sprites.actors.push({ ...structuredClone(template), id: 1000 + i, name: `Filler${i}` });
  };
  // Inflate until the project is short by a deficit strictly between the
  // flat allowance and the full freed amount, then confirm checkCapacity's
  // advice names the real, larger figure. Each filler actor costs
  // kernelTableBytes' spriteBytes exactly 8 bytes, so a real build (measured
  // against this exact fixture) crosses BOUND_TILE_KERNEL_ALLOWANCE (388)
  // around 113 filler actors and the full freed amount (420) around 117 --
  // a narrow, real window, scanned one actor at a time rather than assumed.
  // checkCapacity itself is quadratic in actor count for reasons unrelated
  // to bound tiles, so this stays in a small range (100-130, well under
  // LIMITS.actors' own 255-actor ceiling) to stay fast.
  let deficitMessage = null;
  for (let n = 100; n <= 130 && !deficitMessage; n++) {
    const trial = structuredClone(project);
    inflate(trial, n);
    const { problems } = checkCapacity(trial);
    const error = problems.find((p) => p.severity === 'error' && /lookup tables/.test(p.message));
    if (!error) continue;
    const match = error.message.match(/need (\d+) bytes but only (-?\d+) are free/);
    const deficit = Number(match[1]) - Number(match[2]);
    if (deficit > BOUND_TILE_KERNEL_ALLOWANCE && deficit <= fullyFreed) deficitMessage = error.message;
  }
  assert.ok(deficitMessage, 'could not reproduce a deficit strictly between the flat allowance and the full freed amount');
  assert.match(
    deficitMessage,
    new RegExp(`every switch-bound tile \\(frees ${fullyFreed} bytes\\)`),
    'an implementation that summed BOUND_TILE_KERNEL_ALLOWANCE directly instead of asking kernelCodeBytes/' +
      `kernelTableBytes what a bound-tile-free version would cost would report ${BOUND_TILE_KERNEL_ALLOWANCE} alone here`
  );
});

// -------------------------------------------------------------- byte identity

// What this test can and cannot prove: it builds the SAME (bound-tile-free)
// project twice from THIS tree and compares the two ROMs, so it can only
// ever catch non-determinism or an authored-then-removed binding leaving a
// trace -- it cannot, by construction, catch an ungated instruction that
// this implementation itself introduced (present identically on both
// sides). That pre-feature property was checked once, out-of-band, by
// diffing a bound-tile-free `sample` build made from this tree against the
// same project built from a `git worktree` at 8268625 (the commit
// immediately before this feature's own first commit) -- both produced the
// identical ROM (sha256 0e638aaaecf871b0479e09513e12b47ef7d24fe433c3142fb3369cfcb53a5253),
// which is what the CLAUDE.md-style narrative can cite: bound-tile-free
// projects genuinely still assemble byte-for-byte as they did before this
// feature existed. That check is not repeatable here without pinning a
// whole-ROM hash against a fixed historical commit, which would break the
// moment any unrelated engine change lands -- see
// handoff-tile/tile-code-fixes1-report.md for the full worktree procedure
// and both hashes. What THIS test keeps proving, every run: build
// determinism, and that emission gating (BOUND_TILE_ENABLED) does not
// distinguish "never authored" from "authored, then emptied again".
test('a project with no bound tiles anywhere builds byte-identical to itself, run twice', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-identity-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const a = await loadProject(SAMPLE);
  const dirA = path.join(dir, 'a');
  await saveProject(dirA, a);
  const builtA = await buildProject({ dir: dirA, project: a, log: () => {} });

  const b = await loadProject(SAMPLE);
  b.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 0 }];
  b.maps[0].screens[0].boundTiles = []; // authored then removed -- must match "never authored"
  const dirB = path.join(dir, 'b');
  await saveProject(dirB, b);
  const builtB = await buildProject({ dir: dirB, project: b, log: () => {} });

  assert.deepEqual([...fs.readFileSync(builtA.romPath)], [...fs.readFileSync(builtB.romPath)]);
});

// ------------------------------------------------------------- the engine

// Test 7 (design-tile.md §12): a switch already set BEFORE the screen is
// drawn must show its substitute the instant draw_screen runs -- not only
// once flip_tick later catches up. Sabotage evidence: unwiring
// bound_tile_lookup from draw_screen (while leaving rebuild_bound_cache and
// the RAM cache itself correct) must fail this exact assertion, because the
// cache being right is not enough if draw_screen never consults it.
test('a switch set before a screen loads shows its substitute the instant draw_screen runs, not only after flip_tick catches up', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [{ op: 'setSwitch', switch: 5 }, { op: 'warp', screen: 1, x: 100, y: 100 }], {
    bind: [{ switchId: 5, row: 0, col: 0, metatileId: 1 }],
    tweak: (proj) => {
      // Screen 1 is a plain, empty corridor with a door back to screen 0 --
      // forcing a real redraw_screen on the way back, not a flip_tick
      // catching up mid-frame. Placed away from the warp's own landing spot
      // (100,100), or the player would land on the door and bounce straight
      // back before this test ever gets to look at screen 1.
      proj.maps[0].screens[1].metatiles = new Array(240).fill(0);
      const doorId = proj.sprites.actors.length;
      proj.sprites.actors.push({ ...structuredClone(proj.sprites.actors[0]), id: doorId, name: 'Door', behavior: 'door' });
      proj.maps[0].screens[1].entities.push({ actorId: doorId, x: 40, y: 40, props: { toScreen: 0, toX: 128, toY: 112 } });
    }
  });

  // Screen 0 loads first, switch off: the cell must show the original art.
  assert.deepEqual(cell(nes, 0, 0), [0, 0, 0, 0], 'unswitched, the cell should show metatile 0’s own (blank) art');

  // Set the switch via the scripted event, then leave to screen 1.
  tap(nes, B);
  run(nes, 4);
  assert.equal(switchOn(nes, 5), true, 'the switch should already be set before the warp runs');
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the warp should have actually landed on screen 1');

  // Walk onto the door back to screen 0. draw_screen runs once, synchronously,
  // for the whole screen -- there is no flip_tick opportunity in between.
  nes.cpu.mem[PLAYER_X] = 40;
  nes.cpu.mem[PLAYER_Y] = 40;
  run(nes, 20);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 0, 'the door should have brought the player back to screen 0');
  assert.deepEqual(
    cell(nes, 0, 0),
    [5, 6, 7, 8],
    'the redrawn screen must already show the substitute -- draw_screen itself must consult bound_tile_lookup'
  );
});

// Companion positive check: the *other* path (flip_tick, no redraw at all)
// also works, so test 7's sabotage is specifically about draw_screen and not
// a coincidence of the cache being correct.
test('a switch set while already looking at the screen flips live via flip_tick, with no redraw', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [{ op: 'setSwitch', switch: 5 }], {
    bind: [{ switchId: 5, row: 0, col: 0, metatileId: 1 }]
  });
  assert.deepEqual(cell(nes, 0, 0), [0, 0, 0, 0]);
  tap(nes, B);
  run(nes, 6);
  assert.equal(switchOn(nes, 5), true);
  assert.deepEqual(cell(nes, 0, 0), [5, 6, 7, 8], 'flip_tick should have flipped the cell live, off the main loop');
});

// Test 8a (design-tile.md §12): the message box owns tile rows 24-29
// (metatile row BOX_MT_ROW=12 and below) while it is open. A flip queued for
// a cell under an open box must not land while the box owns it -- it would
// corrupt the box's own border/text -- and must land once the box closes,
// not be lost forever. Sabotage evidence (b): block flips but never release
// them once box_state clears -- the final assertion must fail.
//
// box_state is poked directly to simulate "the box is already open" rather
// than driven through a real Say: nothing in this engine actually sets a
// switch while a real box is genuinely open and receiving input (the world
// freezes during dialogue), so the only way to exercise flip_cell_blocked's
// own gate in isolation is the same technique the Mesen checks already use
// elsewhere in this codebase -- poke the exact byte the gate reads, at the
// exact moment that matters. Nothing else here writes to row 12 while the
// poke holds, so the cell staying at its original art is unambiguous
// evidence the flip itself was deferred, not merely overdrawn by something
// else.
test('a bound tile blocked by an open message box waits, then flips once flip_tick sees it release', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Eight bound tiles toggled on the same frame -- seven outside the box's
  // own rows, one (the last in switch order) inside them -- immediately
  // followed by a Say. FLIP_BUDGET_CAP=1 drains one entry per frame, so by
  // the several frames it takes to work through the first seven, the box's
  // own real raise sequence has genuinely opened for real (box_state !=
  // BOX_CLOSED) -- no artificial poke needed. The eighth entry then sits at
  // the front of the queue, genuinely and repeatedly blocked by
  // flip_cell_blocked's own real check every frame the real box stays open,
  // which is the natural, reachable shape of this scenario: nothing else
  // in this engine can set a switch while a box the player can see is
  // actually onscreen (the world freezes during dialogue), so the box has
  // to already be *becoming* real before the blocked entry's own turn comes
  // up, not before the switch was set.
  const outside = Array.from({ length: 7 }, (_, i) => ({ switchId: i, row: 0, col: i, metatileId: 1 }));
  const inside = { switchId: 7, row: 12, col: 0, metatileId: 1 };
  const { nes } = await buildWith(
    t,
    [...outside, inside].map((b) => ({ op: 'setSwitch', switch: b.switchId })).concat([{ op: 'say', text: 'Hi.' }]),
    { bind: [...outside, inside] }
  );

  tap(nes, B);
  run(nes, 15);
  for (const b of [...outside, inside]) assert.equal(switchOn(nes, b.switchId), true, `switch ${b.switchId} should be set`);
  assert.notEqual(nes.cpu.mem[BOX_STATE], 0, 'the box should be genuinely open by now');
  assert.equal(
    nes.cpu.mem[FLIP_PENDING_COUNT],
    1,
    'the eighth (in-box) entry should still be the one left pending, genuinely blocked by the now-real open box'
  );
  assert.equal(nes.cpu.mem[FLIP_PENDING_IDX], 12 * 16, 'the pending entry should be the in-box cell specifically, not one of the seven outside ones');

  // Let several more frames pass while the box stays open: a broken release
  // (sabotage b) would show flip_pending_count still stuck at 1 here too,
  // exactly as it is above -- the point of this second sample is that
  // staying blocked is not itself the bug; never being released once the
  // box actually closes is.
  run(nes, 10);
  assert.equal(nes.cpu.mem[FLIP_PENDING_COUNT], 1, 'still blocked -- the box has not been dismissed yet');

  // Dismiss the box (A closes/advances a Say with nothing further to wait on).
  tap(nes, 0 /* A */, 2);
  assert.ok(settle(nes), 'the conversation should end once the box is dismissed');
  assert.equal(nes.cpu.mem[BOX_STATE], 0, 'the box should be fully closed');
  run(nes, 10); // flip_tick's own one-per-frame budget catches up
  assert.deepEqual(
    cell(nes, 12, 0),
    [5, 6, 7, 8],
    'the pending flip must land once the box releases it -- it must not be lost while it was blocked'
  );
  assert.equal(nes.cpu.mem[FLIP_PENDING_COUNT], 0, 'the queue should be drained, not merely unblocked');
});

// Test 8b (design-tile.md §12): once a real box has covered a bound cell
// with its own border art and later closes, box_close's own repaint
// (text_close_cell) must show the substitute, not the stale original.
// Sabotage evidence (a): reverting text_close_step to a raw [mtptr_lo],y
// load must fail this exact assertion, because the substitute is only
// visible again once the box is dismissed and the underlying rows are
// rebuilt -- a raw load would show metatile 0’s own art regardless of the
// switch.
test('the message box’s own close repaint shows a bound cell’s substitute, not the stale original', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // The switch is set (and its flip direct-emitted, before the box has any
  // rows to cover) before the Say that covers it -- by the time the box
  // opens over row 12, its own border art overwrites what the flip already
  // wrote there. The interesting assertion is what box_close's own repaint
  // shows once the box goes away again.
  const { nes } = await buildWith(
    t,
    [
      { op: 'setSwitch', switch: 5 },
      { op: 'say', text: 'Hi.' }
    ],
    { bind: [{ switchId: 5, row: 12, col: 0, metatileId: 1 }] }
  );

  assert.deepEqual(cell(nes, 12, 0), [0, 0, 0, 0]);
  tap(nes, B);
  run(nes, 10);
  assert.equal(switchOn(nes, 5), true);
  assert.notEqual(nes.cpu.mem[BOX_STATE], 0, 'the box should be open, its own border art now covering row 12');
  assert.notDeepEqual(cell(nes, 12, 0), [5, 6, 7, 8], 'the box’s own art should currently be covering the cell, not the substitute');

  tap(nes, 0 /* A */, 2);
  assert.ok(settle(nes), 'the conversation should end once the box is dismissed');
  assert.equal(nes.cpu.mem[BOX_STATE], 0, 'the box should be fully closed');
  assert.deepEqual(
    cell(nes, 12, 0),
    [5, 6, 7, 8],
    'the box’s own close repaint must show the substitute -- text_close_cell must consult bound_tile_lookup, not a raw load'
  );
});

// Test 9 (design-tile.md §12): nine switches, all bound to distinct cells on
// the same screen, all toggled on the same frame -- more than BOUND_CAP (8)
// live at once is refused by validateProject, so this drives nine *toggles*
// of switches sharing fewer than 8 distinct cells to prove the FIFO/dedupe
// queue, not the 8-slot cap. Sabotage evidence: removing dedupe would queue
// a repeat entry for a cell toggled twice before its flip lands; breaking
// FIFO order would drain them out of authored order.
test('nine same-frame switch toggles drain in FIFO order with no duplicate queued for a cell toggled twice', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const bind = Array.from({ length: 8 }, (_, i) => ({ switchId: i, row: 0, col: i, metatileId: 1 }));
  // Eleven toggles: switch 0 (direct-emits immediately -- FLIP_BUDGET_CAP=1
  // catches the very first one), switch 1 three times in a row while it is
  // genuinely still sitting in the pending queue (the real dedupe case --
  // not switch 0's own repeat, which never enters the array at all once it
  // has already direct-emitted), then switches 2-7 once each. Only 7
  // pending slots are genuinely needed (1-7), one short of BOUND_CAP (8):
  // three *real* attempts to queue switch 1 must collapse to one pending
  // entry, or the two phantom duplicates consume slots 1 and 2 early enough
  // to push the true 8th distinct cell (7, the very last attempt, 9th
  // overall) past the cap and drop it from the queue entirely, never
  // flipping -- exactly what the sabotage below is checked against. Only
  // one duplicate slot would still fit inside the 1-slot margin this
  // configuration otherwise carries and prove nothing; two is what actually
  // exhausts it. Toggling switch 0 (already direct-emitted, no longer
  // pending) a second time instead would not exercise this at all: dedupe
  // only ever needs to check the pending array, and a flipped cell was
  // never in it.
  const commands = [
    { op: 'setSwitch', switch: 0 },
    { op: 'setSwitch', switch: 1 },
    { op: 'setSwitch', switch: 1 },
    { op: 'setSwitch', switch: 1 },
    { op: 'setSwitch', switch: 2 },
    { op: 'setSwitch', switch: 3 },
    { op: 'setSwitch', switch: 4 },
    { op: 'setSwitch', switch: 5 },
    { op: 'setSwitch', switch: 6 },
    { op: 'setSwitch', switch: 7 }
  ];
  const { nes } = await buildWith(t, commands, { bind });

  for (const b of bind) assert.deepEqual(cell(nes, b.row, b.col), [0, 0, 0, 0]);
  tap(nes, B);
  run(nes, 1); // one frame: the whole page runs synchronously (no suspending command in it)

  for (const b of bind) assert.equal(switchOn(nes, b.switchId), true, `switch ${b.switchId} should be set`);

  // Budget is FLIP_BUDGET_CAP=1 per frame: cell (0,0) (queued first, and the
  // one the direct-emit budget slot may have already caught) drains before
  // (0,1), which drains before (0,2), and so on -- never out of order, and
  // never twice for cell (0,0) despite two setSwitch calls against switch 0.
  const flippedAt = new Array(8).fill(-1);
  for (let f = 0; f < 12; f++) {
    for (let i = 0; i < 8; i++) {
      if (flippedAt[i] === -1 && cell(nes, 0, i)[0] === 5) flippedAt[i] = f;
    }
    run(nes, 1);
  }
  assert.ok(flippedAt.every((f) => f >= 0), `every one of the 8 cells should eventually flip (${flippedAt})`);
  for (let i = 1; i < 8; i++) {
    assert.ok(flippedAt[i] >= flippedAt[i - 1], `cell ${i} (flipped frame ${flippedAt[i]}) must not drain before cell ${i - 1} (frame ${flippedAt[i - 1]})`);
  }
  // No duplicate queued for cell 0: once fully drained, the pending queue and
  // the FIFO bookkeeping must both be back to empty, not carrying a leftover
  // second entry for switch 0's repeat toggle.
  run(nes, 4);
  assert.equal(nes.cpu.mem[FLIP_PENDING_COUNT], 0, 'the pending queue should be fully drained with no duplicate leftover');
});

// Test 11 (design-tile.md §12): vram_reset (engine/text.asm) clears
// flip_pending_count as part of the same reset every full-screen event
// (a warp here) already runs. A flip left pending because the box was open
// must not survive across an unrelated screen transition as a stale byte
// aimed at a cell index that may mean something different on the new
// screen. Sampled directly before and after the transition via RAM, which is
// what makes the sabotage (removing the clear) fail a real assertion rather
// than merely "looking right" on screen.
test('vram_reset clears the pending flip queue across a screen transition, not just what got drawn', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Two bound tiles toggled on the same frame, both outside the box's own
  // rows, immediately followed by a scripted Warp on the very same page --
  // all three commands are non-suspending, so they run synchronously within
  // one frame, in this order: FLIP_BUDGET_CAP=1 means the first direct-
  // emits and the second is genuinely, naturally left pending (no
  // artificial poke needed); the Warp's own redraw (and vram_reset) then
  // runs in that identical frame, before flip_tick ever gets a chance -- on
  // the *next* frame, with nothing intervening -- to drain the pending
  // entry on its own. Checking one frame later would let flip_tick drain it
  // naturally regardless of whether vram_reset's own clear exists at all,
  // which is exactly the gap that would let a missing clear pass unnoticed.
  const { nes } = await buildWith(
    t,
    [
      { op: 'setSwitch', switch: 5 },
      { op: 'setSwitch', switch: 6 },
      { op: 'warp', screen: 1, x: 100, y: 100 }
    ],
    {
      bind: [
        { switchId: 5, row: 0, col: 0, metatileId: 1 },
        { switchId: 6, row: 0, col: 1, metatileId: 1 }
      ]
    }
  );

  tap(nes, B, 1);
  assert.equal(switchOn(nes, 5), true);
  assert.equal(switchOn(nes, 6), true);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the warp should have actually happened, in the same frame as both switches');
  assert.equal(
    nes.cpu.mem[FLIP_PENDING_COUNT],
    0,
    'the pending queue must be empty on the new screen -- a stale entry would aim flip_tick at whatever cell ' +
      'index that used to mean on the screen that is no longer showing'
  );
});

// Test 19 (design-tile.md §12): the stack must balance across all three
// paths queue_or_defer_flip can take -- direct emit, budget-pending, and
// box-blocked -- since script_op_set/script_op_clear wrap switch_set/clear
// in a pha/pla around the call into this machinery (engine/script.asm). A
// one-byte push imbalance on any path leaks into whatever rts eventually
// pops it, corrupting an unrelated return address several calls later.
// Sampled the way rpg.test.js's own stack-invariant checks already are: SP
// read back at a frame boundary, which is deterministic build-over-build
// only if every path that ran during the frame left the stack exactly where
// it found it.
test('the stack pointer returns to the same baseline across all three queue_or_defer_flip paths', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const quiet = await buildWith(t, [], { bind: [] });
  run(quiet.nes, 30);
  const baseline = quiet.nes.cpu.REG_SP;

  // Direct emit: nothing blocking, budget available.
  const direct = await buildWith(t, [{ op: 'setSwitch', switch: 5 }], {
    bind: [{ switchId: 5, row: 0, col: 0, metatileId: 1 }]
  });
  tap(direct.nes, B);
  run(direct.nes, 30);
  assert.equal(switchOn(direct.nes, 5), true);
  assert.equal(direct.nes.cpu.REG_SP, baseline, 'the stack must balance after the direct-emit path');

  // Budget-pending: two distinct cells toggled the same frame, only one of
  // which can be emitted immediately under FLIP_BUDGET_CAP=1.
  const pending = await buildWith(
    t,
    [{ op: 'setSwitch', switch: 5 }, { op: 'setSwitch', switch: 6 }],
    { bind: [{ switchId: 5, row: 0, col: 0, metatileId: 1 }, { switchId: 6, row: 0, col: 1, metatileId: 1 }] }
  );
  tap(pending.nes, B);
  run(pending.nes, 30);
  assert.equal(switchOn(pending.nes, 5), true);
  assert.equal(switchOn(pending.nes, 6), true);
  assert.equal(pending.nes.cpu.REG_SP, baseline, 'the stack must balance after the budget-pending path');

  // Box-blocked: a Say followed by a setSwitch on the very same page. Confirm
  // (text_advance_end, engine/text.asm) jumps straight to script_resume
  // without ever clearing box_state first -- it is still BOX_ENDWAIT (a
  // real, nonzero value) at the exact instant this setSwitch's own
  // queue_or_defer_flip call reads it, which is the genuine, naturally
  // reachable shape of "a switch toggled while box_state != 0": not a
  // switch set before the box opens (the direct/budget-pending cases
  // above), but the very next command after a Say closes.
  const blocked = await buildWith(
    t,
    [{ op: 'say', text: 'Hi.' }, { op: 'setSwitch', switch: 5 }],
    { bind: [{ switchId: 5, row: 12, col: 0, metatileId: 1 }] }
  );
  tap(blocked.nes, B);
  run(blocked.nes, 10);
  assert.notEqual(blocked.nes.cpu.mem[BOX_STATE], 0, 'the box should still be open, waiting to be dismissed');
  tap(blocked.nes, 0 /* A */, 1);
  assert.equal(switchOn(blocked.nes, 5), true, 'the switch should already be set, the instant the box was dismissed');
  assert.equal(blocked.nes.cpu.mem[FLIP_PENDING_COUNT], 1, 'the flip should be genuinely queued and pending, blocked at the moment it was toggled');
  // Sampled here, not only after the drain below: a corrupted return
  // address can still let the ROM run on and drift the stack back to the
  // same byte by pure coincidence a few frames later (confirmed happening
  // for a real one-byte imbalance here), which would let a real corruption
  // hide behind a later, unrelated re-alignment. The frame right after the
  // sabotaged call is the one point closest to where the imbalance itself
  // would actually show.
  assert.equal(blocked.nes.cpu.REG_SP, baseline, 'the stack must already balance the instant queue_or_defer_flip returns from the box-blocked path');
  run(blocked.nes, 15);
  assert.equal(blocked.nes.cpu.mem[FLIP_PENDING_COUNT], 0, 'the pending entry should have drained once fully released');
  assert.equal(blocked.nes.cpu.REG_SP, baseline, 'the stack must balance after the box-blocked path, once released');
});
