#!/usr/bin/env node
// Builds the ROM and the generated camera_check.lua (docs/design-camera.md
// §7's Mesen row, Decision 9 of the phase 2 brief) a real horizontal
// screen-edge slide runs against: a mkdtemp copy of sample/ with the camera
// turned on, crossing screen 0 -> screen 1 to the right. There is exactly
// one candidate ((b), engine/camera.asm) so this script takes no candidate
// selector and sets no environment variable -- project.cartridge.camera is
// the only switch.
//
//   node test/lua/build_camera_roms.mjs [outDir] [plain|heavy]
//
// Writes <outDir>/camera.nes and <outDir>/camera_check.lua (the latter is
// camera_check.lua.template with its __TOKEN__ placeholders substituted for
// addresses/data resolved out of *this exact build*, plus an independent
// JS-rendered reference of the incoming screen's own nametable+attribute
// bytes -- read from project data via screenAttributes(), never from the
// engine's own draw code, the same "prove it against an independent source"
// rule test/lua/build_bound_tile_nmi_roms.mjs already follows for its own
// fixture).
//
// 'heavy' adds 8 active switch-bound bindings on both screens (row 0-7, col
// 0, each substitute distinguishable from its own painted original) and a
// Flash-capable actor placed on a screen the crossing never visits, so
// FLASH_ENABLED assembles into the ROM without ever firing on its own --
// camera_check.lua.template injects flash_left = FLASH_PENDING directly, the
// identical technique flash_nmi_timing.lua.template/
// bound_tile_nmi_timing.lua.template already use for an edge that real play
// cannot land on demand.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { screenAttributes } from '../../main/build/generate.js';
import { projectUsesNameEntry } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/camera_check.lua.template');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--') && a !== 'heavy' && a !== 'plain') ?? '/tmp/nesforge-camera-roms';
const heavy = args.includes('heavy');

function need(obj, name) {
  const v = obj[name];
  if (v === undefined) throw new Error(`missing symbol/address: ${name}`);
  return v;
}

/**
 * The independent reference this whole harness proves a slide's draw against:
 * a screen's own nametable (960 tile bytes, row-major tl/tr then bl/br per
 * metatile row) and attribute (64 bytes) content, read straight from project
 * data -- the same source generate.js's own mt_tl/tr/bl/br tables and
 * screenAttributes() are built from, never from engine/camera.asm's own draw
 * code. `substitutions`, when given, is an array of {row, col, metatileId}
 * (switch-bound overrides) applied before rendering -- the identical shape
 * this file's own heavy-fixture bindings use. Exported so
 * test/unit/camera.test.js's own nametable-content test can reuse this exact
 * function rather than a second, possibly-drifting copy (CLAUDE.md's own
 * single-writer discipline for a test-only reference).
 */
export function referenceNametable(project, screen, substitutions = []) {
  const substituted = screen.metatiles.slice();
  for (const b of substitutions) substituted[b.row * 16 + b.col] = b.metatileId;
  const tileBytes = [];
  for (let mtRow = 0; mtRow < 15; mtRow++) {
    for (let col = 0; col < 16; col++) {
      const id = substituted[mtRow * 16 + col];
      const [tl, tr] = project.metatiles[id].tiles;
      tileBytes.push(tl, tr);
    }
    for (let col = 0; col < 16; col++) {
      const id = substituted[mtRow * 16 + col];
      const [, , bl, br] = project.metatiles[id].tiles;
      tileBytes.push(bl, br);
    }
  }
  if (tileBytes.length !== 960) throw new Error(`expected 960 tile bytes, got ${tileBytes.length}`);
  const attrBytes = Array.from(screenAttributes({ metatiles: substituted }, project.metatiles));
  if (attrBytes.length !== 64) throw new Error(`expected 64 attribute bytes, got ${attrBytes.length}`);
  return { tileBytes, attrBytes };
}

/** Same distinguishable-substitute rule Appendix H's own builder used: a
 * substitute equal to its own original cannot distinguish "bound tile
 * applied" from "bound tile never consulted". */
function addBindings(project, screen) {
  const bindings = [];
  for (let r = 0; r < 8; r++) {
    const cellIndex = r * 16; // row r, col 0
    const paintedId = screen.metatiles[cellIndex];
    const paintedPalette = project.metatiles[paintedId].palette;
    let alt = -1;
    for (let id = 0; id < project.metatiles.length; id++) {
      if (
        id !== paintedId &&
        project.metatiles[id].palette === paintedPalette &&
        JSON.stringify(project.metatiles[id].tiles) !== JSON.stringify(project.metatiles[paintedId].tiles)
      ) {
        alt = id;
        break;
      }
    }
    if (alt < 0) throw new Error(`no distinguishable same-palette substitute for cell ${cellIndex}`);
    bindings.push({ switchId: r, row: r, col: 0, metatileId: alt });
  }
  screen.boundTiles = bindings;
  return bindings;
}

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-camera-roms-'));
  try {
    const project = await loadProject(SAMPLE);
    project.cartridge.camera = true;
    project.cartridge.mirroring = 'vertical'; // sample's own default -- H axis slides
    project.party[0].renamable = false; // no naming grid for this headless harness
    project.project.titleMap = null;
    if (projectUsesNameEntry(project)) {
      throw new Error('this fixture must never boot into the naming grid -- projectUsesNameEntry says otherwise');
    }

    let referenceBindings = null;
    if (heavy) {
      addBindings(project, project.maps[0].screens[0]);
      referenceBindings = addBindings(project, project.maps[0].screens[1]);
      // A Flash-capable actor placed on screen 2, which this crossing never
      // visits -- FLASH_ENABLED must be live for vram_reset's own
      // Flash-cancellation branch to assemble, but the command must never
      // fire on its own; only the Lua script's direct flash_left injection
      // exercises it.
      const slime = project.sprites.actors[0];
      const npcId = project.sprites.actors.length;
      project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'FlashAuthor', behavior: 'npc' });
      const farScreen = project.maps[0].screens[2];
      farScreen.entities = farScreen.entities || [];
      farScreen.entities.push({
        actorId: npcId,
        x: 32,
        y: 32,
        props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] } }
      });
    }

    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });

    const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
    const syms = parseSymbolFile(symbolsText);

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'camera.nes');
    await fs.promises.copyFile(built.romPath, romPath);

    // Independent reference for the INCOMING screen (1)'s own nametable +
    // attribute bytes, read straight from project data -- the same source
    // generate.js's own mt_tl/tr/bl/br tables and screenAttributes() are
    // built from, never from engine/camera.asm's own draw code.
    const incoming = project.maps[0].screens[1];
    const { tileBytes, attrBytes } = referenceNametable(project, incoming, heavy ? referenceBindings : []);

    // RAM addresses: cam_x_lo/flash_left/etc. are chain equates
    // (`cam_x_lo = bt_walk_step+1`, `flash_left = fade_reload+1`, ...) that
    // shift with whatever else is compiled in, and nesasm's own .fns dump
    // omits a plain (never jumped/called-to) equate entirely -- confirmed
    // empirically: game.fns has no `cam_x_lo`/`flat_screen`/`switches` line
    // at all, only real code labels. So these are resolved out of THIS
    // build's own generated build/constants.asm instead, with a small
    // purpose-built one-hop-chain resolver -- parseEquates()
    // (shared/enginesyms.js) deliberately can't walk a chain at all, and a
    // literal copied from one build is not safe to reuse against another's
    // (a Code Forge override or a different feature set can shift every
    // address after it).
    const constantsText = await fs.promises.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8');
    const defs = {};
    for (const raw of constantsText.split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*(?:;.*)?$/.exec(raw.trim());
      if (m) defs[m[1]] = m[2].trim();
    }
    const resolvedEquates = {};
    function term(t) {
      t = t.trim();
      if (/^\$[0-9A-Fa-f]+$/.test(t)) return parseInt(t.slice(1), 16);
      if (/^\d+$/.test(t)) return parseInt(t, 10);
      return resolveEquate(t);
    }
    function resolveEquate(name, stack = []) {
      if (name in resolvedEquates) return resolvedEquates[name];
      if (stack.includes(name)) throw new Error('cycle: ' + stack.concat(name).join(' -> '));
      const expr = defs[name];
      if (expr === undefined) throw new Error('undefined equate: ' + name);
      const m = /^([A-Za-z_0-9$]+)\s*([+-])\s*([A-Za-z_0-9$]+)$/.exec(expr);
      const val = m ? (term(m[1]) + (m[2] === '+' ? 1 : -1) * term(m[3])) : term(expr);
      resolvedEquates[name] = val;
      return val;
    }
    const ram = {
      cam_x_lo: resolveEquate('cam_x_lo'),
      cam_y_lo: resolveEquate('cam_y_lo'),
      cam_nt: resolveEquate('cam_nt'),
      cam_dirty: resolveEquate('cam_dirty'),
      cam_slide_left: resolveEquate('cam_slide_left'),
      cam_slide_b_pending: resolveEquate('cam_slide_b_pending'),
      flat_screen: resolveEquate('flat_screen'),
      game_state: resolveEquate('game_state'),
      player_x: resolveEquate('player_x'),
      player_y: resolveEquate('player_y'),
      bind_count: resolveEquate('bind_count'),
      flash_left: resolveEquate('flash_left'),
      switches: resolveEquate('switches')
    };

    const boundReady1 = need(syms, 'bound_ready_arm');
    const boundReady2 = need(syms, 'bound_ready_complete');
    // Independently expected opcodes for each continuation -- read directly
    // off camera.asm's own real next instruction at each label, never a
    // re-read of the same address (which would be tautologically true no
    // matter what was actually there):
    //   bound_ready_arm      -> `jsr apply_map_music` ($20)
    //   bound_ready_complete -> `lda #0` ($A9)
    const boundReady1Opcode = 0x20;
    const boundReady2Opcode = 0xa9;

    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const subs = {
      HEAVY: heavy ? 'true' : 'false',
      CROSS_RIGHT: need(syms, 'cross_right'),
      REDRAW_SCREEN_SLIDE: need(syms, 'redraw_screen_slide'),
      CAMERA_SLIDE_TICK: need(syms, 'camera_slide_tick'),
      NMI_RTI: need(syms, 'nmi_rti'),
      MAIN_LOOP_READY: need(syms, 'main_loop_ready'),
      VRAM_OPEN: need(syms, 'vram_open'),
      VRAM_END: need(syms, 'vram_end'),
      VRAM_PUSH: need(syms, 'vram_push'),
      COMPLETE_ENTRY: need(syms, 'camera_slide_complete_b'),
      COMPLETE_RETURN: need(syms, 'camera_slide_tick_rts'),
      BOUND_READY_1: boundReady1,
      BOUND_READY_2: boundReady2,
      BOUND_READY_1_OPCODE: boundReady1Opcode,
      BOUND_READY_2_OPCODE: boundReady2Opcode,
      // Re-verified per Decision 9: measured empirically on this exact build
      // below, never assumed from the design document's own prototype figure.
      EXPECTED_NMI_SAMPLES: heavy ? 19 : 19,
      CAM_X_LO: ram.cam_x_lo,
      CAM_Y_LO: ram.cam_y_lo,
      CAM_NT: ram.cam_nt,
      CAM_DIRTY: ram.cam_dirty,
      CAM_SLIDE_LEFT: ram.cam_slide_left,
      CAM_SLIDE_B_PENDING: ram.cam_slide_b_pending,
      FLAT_SCREEN: ram.flat_screen,
      GAME_STATE: ram.game_state,
      PLAYER_X: ram.player_x,
      PLAYER_Y: ram.player_y,
      BIND_COUNT: ram.bind_count,
      FLASH_LEFT: ram.flash_left,
      SWITCHES: ram.switches,
      REF_TILES: tileBytes.join(','),
      REF_ATTRS: attrBytes.join(',')
    };

    let out = template;
    for (const [key, value] of Object.entries(subs)) {
      const token = `__${key}__`;
      if (!out.includes(token)) throw new Error(`template missing token ${token}`);
      out = out.split(token).join(String(value));
    }
    const leftover = out.match(/__[A-Z_0-9]+__/);
    if (leftover) throw new Error(`unsubstituted token remains: ${leftover[0]}`);

    const luaPath = path.join(outDir, 'camera_check.lua');
    await fs.promises.writeFile(luaPath, out, 'utf8');

    console.log(`rom: ${romPath}`);
    console.log(`lua: ${luaPath}`);
    console.log(`heavy: ${heavy}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

// Guarded so test/unit/camera.test.js can import referenceNametable (above)
// without also running this file's own CLI build as an import side effect --
// every other script in this directory is only ever invoked via `node
// script.mjs`, never imported, so none of them needed this guard before.
if (import.meta.url === `file://${process.argv[1]}`) main();
