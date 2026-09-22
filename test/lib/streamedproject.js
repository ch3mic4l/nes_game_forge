// A deterministic streamed-world test project, built the same way
// test/lib/streamedprovenance.mockfixture.js already does: createProject/createMap/createScreen,
// with `streamed`/gridW/gridH/fillMetatileId set directly on the objects those return. This never
// runs normalizeProject -- not because it has to avoid one (phase 2 slice 2b, Part E, fixed
// normalizeMap's own pre-existing gap that used to drop fillMetatileId entirely; see that
// function's own comment and test/unit/project.test.js's round-trip test), but because createMap
// already returns an object in normalizeMap's own output shape, so a normalizeProject pass over it
// would be a no-op. generateAssets/buildProject accept this shape directly either way.
//
// Board/mirroring/tileset facts match the prototype's own minimal-u512-fix23-move-clean/
// project.json exactly (mapper 30, mirroring "fourscreen", camera false, tilesetId 0) -- verified
// by reading that file directly, not from the design contract's summary. That file's own "maps"
// array, however, is a single ordinary-shaped 1x1 map with no `streamed` key at all: it predates
// (or never used) the current `map.streamed`/gridW/gridH/fillMetatileId schema, so its grid and
// fill cannot be carried over literally -- there is nothing there to carry. The grid below is
// this module's own choice, sized to what Part F's tests actually need: sw_render_window and
// sw_cross_right/left/down/up are resident routines this slice migrates, and a 1x1 grid could
// never exercise a cross-screen read in either axis. fillMetatileId is left at 0, the prototype's
// implicit default (main/build/streamed.js's own `?? 0` fallback).
//
// UNROM 512 (mapper 30) + four-screen mirroring is also the only streamed-capable combination
// (streamCapableFourScreen, shared/cartridge.js) that keeps both axes live under validateProject
// regardless of the grid's shape, so a mixed-shape project never trips its "map is one screen
// wide/tall" dead-axis problem.
//
// CLI: `node test/lib/streamedproject.js <dir> [--rpg] [--mixed]` writes project.json into <dir>.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, createMap, createScreen } from '../../shared/project.js';
import { saveProject } from '../../main/project-io.js';

const GRID_W = 3;
const GRID_H = 2;
const FILL_METATILE_ID = 0; // the prototype's own implicit default (streamed.js: `map.fillMetatileId ?? 0`)

/**
 * One streamed map's screens: a deterministic, non-uniform pattern so the terrain is not one long
 * run of the fill tile everywhere, nor one long run of a single repeated byte within the varied
 * region itself -- sw_read_run (engine/streamworld.asm) copies a caller-chosen byte RANGE out of
 * a screen's record, and fix round 1, finding 5 found that a flat `1 + ((col + row) % 3)` value
 * across the whole varied region cannot distinguish a correct copy from one that read the wrong
 * offset, the wrong length, or even the wrong screen whenever two screens share a (col+row) phase.
 * Metatile id at position `i` within the first third is `1 + ((col + row + i) % 3)` (never 0, so
 * it never collides with the fill tile) -- a period-3 cycle, so consecutive bytes differ from
 * their neighbours and a screen's own byte-for-byte identity depends on both its position and the
 * offset read, not merely on which of 3 values the whole screen happened to share. Fill for the
 * rest. Deterministic in map position, not random, so a SHA-256 of the generated JSON stays stable
 * across runs.
 */
function streamedScreen(col, row) {
  const screen = createScreen();
  const variedCount = Math.floor(screen.metatiles.length / 3);
  for (let i = 0; i < screen.metatiles.length; i++) {
    screen.metatiles[i] = i < variedCount ? 1 + ((col + row + i) % 3) : FILL_METATILE_ID;
  }
  return screen;
}

/**
 * Builds the streamed map itself: gridW x gridH screens in row-major order, matching
 * emitStreamedLayout's own `map.screens[row * map.gridW + col]` indexing exactly.
 */
function buildStreamedMap(id, name, gridW, gridH) {
  const map = createMap(id, name);
  map.gridW = gridW;
  map.gridH = gridH;
  map.streamed = true;
  map.fillMetatileId = FILL_METATILE_ID;
  map.tilesetId = 0;
  map.screens = [];
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      map.screens.push(streamedScreen(col, row));
    }
  }
  return map;
}

/**
 * options.gameType: 'action' (default) or 'rpg'.
 * options.mixed: also carries one ordinary map before and after the streamed one, so a project
 * that mixes streamed and ordinary maps (emitStreamedLayout's typeBits table, the case its own
 * prefix walk exists for) is covered, not just the single-streamed-map minimum.
 * options.mapper/mirroring/gridW/gridH: fix round 1, finding 7 -- default to the original
 * UNROM-512-plus-four-screen, 3x2 shape every existing pinned hash and test relies on, so passing
 * none of the four reproduces the exact project those already assert against. A caller measuring
 * MMC1/MMC3 coverage passes `{mapper: 1 or 4, mirroring: 'vertical', gridH: 1}` --
 * streamCapableTwoNametable's board/mirroring combination, whose vertical mirroring makes the
 * vertical axis the dead one (shared/cartridge.js's cameraAxes); phase 2 slice 2b's own Part D
 * item 1 refuses that combination outright now (streamCapableFourScreen, UNROM 512 only), so a
 * caller passing a two-nametable mapper/mirroring pair here is building the NEGATIVE control for
 * that refusal, not a build that is expected to succeed.
 * options.camera: defaults to true (Part D item 8 requires the camera on for any streamed map);
 * pass `false` to build the negative control for that refusal.
 * options.naming: defaults to false (Part D item 7's positive control -- hero naming already off
 * by createPartyMember's own default); pass `true` to set party[0].renamable and build the
 * negative control for that refusal.
 */
export function createStreamedProject({
  gameType = 'action',
  mixed = false,
  mapper = 30,
  mirroring = 'fourscreen',
  gridW = GRID_W,
  gridH = GRID_H,
  camera = true,
  naming = false
} = {}) {
  const project = createProject('Streamed Test', gameType);
  project.cartridge.mapper = mapper;
  project.cartridge.mirroring = mirroring;
  project.cartridge.camera = camera;
  if (naming && project.party[0]) project.party[0].renamable = true;

  const maps = [];
  let nextId = 0;
  if (mixed) {
    // "a multi-screen ordinary map" (Part E) -- 2x2, not createMap's own 1x1 default.
    const before = createMap(nextId++, 'Before');
    before.gridW = 2;
    before.gridH = 2;
    before.screens = [createScreen(), createScreen(), createScreen(), createScreen()];
    maps.push(before);
  }
  maps.push(buildStreamedMap(nextId++, 'Streamed', gridW, gridH));
  if (mixed) {
    const after = createMap(nextId++, 'After');
    after.gridW = 2;
    after.gridH = 2;
    after.screens = [createScreen(), createScreen(), createScreen(), createScreen()];
    maps.push(after);
  }
  project.maps = maps;
  return project;
}

/** Canonical JSON (sorted keys are not needed -- object literal insertion order is already fixed
 * by this module -- but a stable stringify keeps a future edit from silently reordering the hash
 * that streamworldresident.test.js pins). */
export function canonicalJSON(project) {
  return JSON.stringify(project, null, 2);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    process.stderr.write('usage: node test/lib/streamedproject.js <dir> [--rpg] [--mixed]\n');
    process.exit(1);
  }
  const gameType = process.argv.includes('--rpg') ? 'rpg' : 'action';
  const mixed = process.argv.includes('--mixed');
  const project = createStreamedProject({ gameType, mixed });
  // fix round 1, finding 4: the real on-disk project format (main/project-io.js's saveProject),
  // maps in their own maps/N.json files -- not a single hand-rolled project.json, which
  // loadProject (and so main/build/cli.js) never reads maps back out of at all.
  await saveProject(dir, project);
  process.stdout.write(`wrote ${dir}\n`);
}
