// The ring gate's scene and cell builder: the six mapper/mirroring cells, the world authored for the VRAM/attribute oracle, and
// `buildCell` -- patch tree -> real public build path (buildProject on the patched copy) -> a provenance record.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createStreamedProject } from '../../lib/streamedproject.js';
import { scanEquates, resolveEquates } from '../../lib/equates.js';
import { ROOT, makeTree, loadTree, sha256 } from './ringtree.mjs';
import { harnessFingerprint, projectSha256, writeAttempt, finishAttempt, nesasmStamp, hostStamp } from './ringprov.mjs';

/** The six mapper/mirroring pairs of the acceptance table (plan 2.5). `ring` is the STREAM_RING value the pair must build with. */
export const CELLS = [
  { id: 'MMC1-V', mapper: 1, mirroring: 'vertical', ring: 1, header: { mapper: 1, mirror: 'V' } },
  { id: 'MMC1-H', mapper: 1, mirroring: 'horizontal', ring: 2, header: { mapper: 1, mirror: 'H' } },
  { id: 'MMC3-V', mapper: 4, mirroring: 'vertical', ring: 1, header: { mapper: 4, mirror: 'V' } },
  { id: 'MMC3-H', mapper: 4, mirroring: 'horizontal', ring: 2, header: { mapper: 4, mirror: 'H' } },
  { id: 'U512-V', mapper: 30, mirroring: 'vertical', ring: 1, header: { mapper: 30, mirror: 'V' } },
  { id: 'U512-H', mapper: 30, mirroring: 'horizontal', ring: 2, header: { mapper: 30, mirror: 'H' } }
];
export const cellById = (id) => CELLS.find((c) => c.id === id) ?? (() => { throw new Error(`unknown ring cell ${id}`); })();
export const GAME_TYPES = ['action', 'rpg'];

const SOLID_ID = 24;
/** Metatile id of world block (screen s, col c, row r): 23 distinct ids, varying with all three, so an aliased or shifted write shows. */
export const terrainId = (s, c, r) => 1 + ((s * 5 + c * 7 + r * 3 + ((r * 16 + c) >> 4)) % 23);

/**
 * The oracle world: an N x 1 (vertical) or 1 x N (horizontal) streamed map, every block's metatile a function of (screen, col, row),
 * every metatile with its own four tiles and a palette (id & 3), plus the dialogue talkers.
 *   talkers: 'enter' (default) = one `enter`-triggered NPC per screen at the screen's far corner, so every seam crossing opens a
 *            dialogue at the camera position the crossing happens at; 'landing' = that NPC on the start screen only; 'none' = no events.
 *   start:   { screen, x, y } of the player.
 */
export function ringProject({ cell, gameType = 'action', n = 4, talkers = 'enter', start = {}, bulkText = 0, mutate } = {}) {
  const vertical = cell.ring === 1;
  const gridW = vertical ? n : 1;
  const gridH = vertical ? 1 : n;
  const project = createStreamedProject({ gameType, mapper: cell.mapper, mirroring: cell.mirroring, gridW, gridH, camera: true });
  const map = project.maps[0];
  for (let id = 1; id <= SOLID_ID; id++) {
    project.metatiles[id] = { id, name: `Ring ${id}`, tiles: [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3], palette: id & 3, collision: id === SOLID_ID ? 'solid' : 'open' };
  }
  map.screens.forEach((screen, s) => {
    for (let i = 0; i < screen.metatiles.length; i++) screen.metatiles[i] = terrainId(s, i & 15, i >> 4);
    screen.entities = [];
  });
  if (talkers === 'enter' || talkers === 'landing') {
    // 'landing' = ONE enter talker, on the start screen only: a dialogue scene's resources then do not grow with N (an actor per screen
    // would hit the text budget -- ringcapacity.mjs -- long before the grid limit).
    map.screens.forEach((screen, s) => {
      if (talkers === 'landing' && s !== (start.screen ?? 0)) return;
      const actorId = project.sprites.actors.length;
      project.sprites.actors.push({ name: `Talker ${s}`, behavior: 'npc', hp: 1, damage: 0 });
      screen.entities.push({
        actorId, x: 200, y: 40,
        props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: `RING SCREEN ${s}` }] }] } }
      });
    });
  }
  if (bulkText > 0) {
    // Never-reached text, sized to push music+sfx+text past the resident kernel-hi ceiling so the overlay is placed in the battle bank
    // (streamworldDialogueBanked). Chunks of 100 chars; the NPC sits on the last screen at its far corner behind an unset switch page.
    const actorId = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Bulk', behavior: 'npc', hp: 1, damage: 0 });
    const commands = [];
    for (let i = 0; i * 100 < bulkText; i++) commands.push({ op: 'say', text: `BULK ${i} `.padEnd(100, String.fromCharCode(65 + (i % 26))) });
    map.screens[map.screens.length - 1].entities.push({ actorId, x: 232, y: 216, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } });
  }
  project.project.startMap = 0;
  project.project.startScreen = start.screen ?? 0;
  project.project.startX = start.x ?? 120;
  project.project.startY = start.y ?? 120;
  if (mutate) mutate(project);
  return { project, gridW, gridH, vertical };
}

function parseBuildLog(lines) {
  const out = {};
  for (const l of lines) {
    const m = l.match(/^BANK\s+(\d+)\s+(\d+)\/\s*(\d+)\s*$/); // BANK n  used/free
    if (m) out[Number(m[1])] = { used: Number(m[2]), size: Number(m[2]) + Number(m[3]) };
  }
  return out;
}

/**
 * Builds `project` through a patched tree and returns { dir, romPath, fnsPath, config, symbols, prov }.
 * `tree` is a makeTree() result (ring or pristine); the build runs through THAT copy's buildProject. The temp dir is the caller's to remove.
 * prov is the S1a certificate-build record (plan review 3, obligation 2).
 */
export async function buildCell({ tree, project, cell, gameType, label, provDir, requestedPlacement = null, links = {}, sabotage = null }) {
  const loaded = await loadTree(tree);
  const stampLabel = label ?? cell?.id ?? 'x';
  const map0 = project.maps[0];
  const mapperOf = () => loaded.cartridge.resolveMapper(project.cartridge.mapper);
  // The attempt stamp is written BEFORE the build (review 2 finding 3): a build that errors, or dies, still leaves one.
  const provPath = writeAttempt(provDir, stampLabel, {
    kind: 'cell-build', cell: cell?.id ?? null, gameType, requestedPlacement, sabotage,
    links: { result: links.result ?? null, log: links.log ?? null },
    head: tree.head, trackedStatus: tree.status, baseline: tree.baseline, patches: tree.patches,
    mapper: project.cartridge.mapper, mirroring: project.cartridge.mirroring, grid: `${map0.gridW}x${map0.gridH}`,
    harness: harnessFingerprint(), projectSha256: projectSha256(project), fixtureHashes: cachedFixtureHashes(), nesasm: nesasmStamp(), host: hostStamp()
  });
  const lines = [];
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `ring-cell-${stampLabel}-`));
    await loaded.saveProject(dir, project);
    const built = await loaded.buildProject({ dir, project, log: (l) => lines.push(l) });
    const config = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
    const constants = fs.readFileSync(path.join(dir, 'build/constants.asm'), 'utf8');
    const pending = new Map();
    scanEquates(constants, pending);
    scanEquates(config, pending);
    const symbols = new Map();
    resolveEquates(pending, symbols);
    const fnsPath = built.symbolPath;
    const fns = {};
    if (fnsPath) for (const m of fs.readFileSync(fnsPath, 'utf8').matchAll(/^(\w+)\s*=\s*\$([0-9A-Fa-f]+)/gm)) fns[m[1]] = parseInt(m[2], 16);
    const rom = fs.readFileSync(built.romPath);
    const mapper = mapperOf();
    const layout = loaded.cartridge.prgLayout(mapper);
    const banks = parseBuildLog(lines);
    const free = (b) => (banks[b] ? banks[b].size - banks[b].used : null);
    const placement = await import(new URL(`file://${path.join(tree.root, 'main/build/streamplacement.js')}`).href);
    let battleRegion = null;
    if (gameType === 'rpg') {
      const bt = await import(new URL(`file://${path.join(tree.root, 'main/build/battletables.js')}`).href);
      try { battleRegion = bt.battleRegionBytes(project, mapper, { streamDialogueBanked: placement.streamworldDialogueBanked(project, mapper) }); } catch (e) { battleRegion = `n/a: ${e.message}`; }
    }
    const header = { mapper: (rom[6] >> 4) | (rom[7] & 0xf0), flags6: rom[6], mirrorBit: rom[6] & 1, fourScreen: (rom[6] & 8) !== 0 };
    const cfg = (name) => (symbols.has(name) ? symbols.get(name) : null);
    const prov = {
      cell: cell?.id ?? null,
      gameType,
      head: tree.head,
      trackedStatus: tree.status,
      patches: tree.patches,
      mapper: project.cartridge.mapper,
      mirroring: project.cartridge.mirroring,
      header,
      grid: `${map0.gridW}x${map0.gridH}`,
      streamRing: cfg('STREAM_RING'),
      ringConsts: { SW_RING_COL_LEN: cfg('SW_RING_COL_LEN'), SW_RING_ROW_LEN: cfg('SW_RING_ROW_LEN'), SW_RW_NT_STEP: cfg('SW_RW_NT_STEP'), SW_RW_NT_END: cfg('SW_RW_NT_END') },
      // Row 1's placement is THREE numbers that must agree: what was requested, what the JS predicate predicts, and what the ROM assembled
      // (where sw_dlg_single landed: resident $C000+, or the switchable window $8000-$BFFF) -- never the prediction alone.
      dialogueBanked: placement.streamworldDialogueBanked(project, mapper),
      placement: {
        requested: requestedPlacement,
        predictedBanked: placement.streamworldDialogueBanked(project, mapper),
        generatedFlag: cfg('SW_DLG_BANKED'),
        overlayAddr: Number.isFinite(fns.sw_dlg_single) ? fns.sw_dlg_single : null,
        assembled: !Number.isFinite(fns.sw_dlg_single) ? 'absent' : fns.sw_dlg_single >= 0xc000 ? 'resident' : fns.sw_dlg_single >= 0x8000 ? 'switchable' : 'unmapped'
      },
      baseline: tree.baseline,
      harness: harnessFingerprint(),
      projectSha256: projectSha256(project),
      kernelLoFree: free(layout.kernelLoBank),
      kernelHiFree: free(layout.kernelHiBank),
      battleRegionBytes: battleRegion,
      resources: { kernelLoFree: free(layout.kernelLoBank), kernelHiFree: free(layout.kernelHiBank), battleRegionBytes: battleRegion, bankUsage: banks, buildLogLines: lines.length, buildLogSha256: sha256(lines.join('\n')) },
      romSha256: sha256(rom),
      ringCodeAssembled: Boolean(fns.sw_ring_col_cmp),
      fixtureHashes: cachedFixtureHashes()
    };
    finishAttempt(provPath, 'built', prov);
    return { dir, romPath: built.romPath, fnsPath, config, symbols, fns, prov, provPath, rom, project };
  } catch (e) {
    finishAttempt(provPath, 'error', { error: { firstLine: String(e.message).split('\n')[0], message: String(e.message).slice(0, 4000) }, resources: { buildLogLines: lines.length, buildLogTail: lines.slice(-12) } });
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    e.provPath = provPath;
    throw e;
  }
}

let fixtureCache = null;
const cachedFixtureHashes = () => (fixtureCache ??= fixtureHashes());

/** Fixture hashes, from fixture-hashes.mjs beside this file (builds each fixture from a mkdtemp copy). */
export function fixtureHashes() {
  const out = execFileSync('node', [path.join(ROOT, 'test/lua/ring_gate/fixture-hashes.mjs')], { encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').map((l) => l.split('\t')));
}
