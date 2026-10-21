// Shared helpers for the encounter-groups generator, engine and capacity tests (handoff-next/encgroups, commit C2).
// Variants of the checked-in sample-rpg fixture are built into mkdtemp directories; the fixture is only ever read.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createMap } from '../../shared/project.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { callRoutine } from './callroutine.js';
import { finishNamingIfOpen } from './naming.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');

// Engine RAM, from engine/constants.asm.
export const RAM = {
  moving: 0x15,
  flatScreen: 0x16,
  gameState: 0x25,
  encStep: 0x61,
  rng: 0x62,
  curMap: 0x8a, // cur_map = bt_owner_rec+1
  mapIsStreamed: 0xfe,
  ordScreen: 0xff,
  monSlotActor: 0x3bc
};
export const ST_BATTLE = 5; // engine/constants.asm

export async function rpgBase(mapperId = 1) {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = mapperId;
  return project;
}

/** Appends `count` monsters cloned from actor 0; returns their ids. */
export function addMonsters(project, count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = project.sprites.actors.length;
    project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id, name: `Mon${id}` });
    ids.push(id);
  }
  return ids;
}

export function addMap(project, name = `M${project.maps.length}`) {
  project.maps.push(createMap(project.maps.length, name));
  return project.maps.length - 1;
}

export function pushGroup(project, name, monsters) {
  project.encounterGroups ??= [];
  project.encounterGroups.push({ name, monsters });
  return project.encounterGroups.length - 1;
}

/** Puts a map in group mode (retaining `actorIds`, dormant). */
export function groupMap(map, rate, table, actorIds = []) {
  map.encounters = { rate, actorIds, mode: 'groups', table: table.map(([group, weight]) => ({ group, weight })) };
}

export function legacyMap(map, rate, actorIds) {
  map.encounters = { rate, actorIds };
}

/** First flat-screen index of every map (ordinary maps only). */
export function firstScreens(project) {
  const out = [];
  let next = 0;
  for (const map of project.maps) {
    out.push(next);
    next += map.screens.length;
  }
  return out;
}

export async function buildTo(t, project, name = 'encgroups') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `forge-${name}-`));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });
  const assets = (file) => fs.readFileSync(path.join(dir, 'build', 'assets', file), 'utf8');
  return {
    dir,
    built,
    lines,
    romPath: built.romPath,
    maps: assets('maps.inc'),
    config: assets('config.inc'),
    symbols: parseSymbolFile(fs.readFileSync(built.symbolPath, 'utf8'))
  };
}

/** The bytes of one `label:` block of a generated include, as numbers. */
export function dbBytes(text, label) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${label}:`);
  if (start < 0) return null;
  const bytes = [];
  for (let i = start + 1; i < lines.length && /^\s+\.db\b/.test(lines[i]); i++) {
    for (const token of lines[i].replace(/^\s+\.db\s+/, '').split(',')) bytes.push(parseInt(token.trim().slice(1), 16));
  }
  return bytes;
}

export function bootRom(romPath) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < 40; i++) nes.frame();
  return finishNamingIfOpen(nes);
}

export function referenceRngNext(v) {
  if (v === 0) v = 0xa5;
  const carry = (v & 0x80) !== 0;
  v = (v << 1) & 0xff;
  if (carry) v ^= 0x71;
  return v & 0xff;
}

/** The roll check_encounter makes from `seed`: its unconditional rng_next, then the one inside the rate gate. */
export const rollOf = (seed) => referenceRngNext(referenceRngNext(seed));

/**
 * One wandering-encounter attempt through the ROM's own check_encounter (a player step: moving set, the step counter
 * primed so the rate gate fires for rate <= 1... or `steps` more), against the map owning `where`.
 * `where` is {flat} for an ordinary screen or {streamedMap} for a streamed one. Returns the filled slots and the RAM
 * the attempt left behind. game_state is restored so the next attempt starts clean.
 */
export function attempt(nes, symbols, seed, where, { encStep = 0 } = {}) {
  const mem = nes.cpu.mem;
  const state = mem[RAM.gameState];
  mem[RAM.rng] = seed;
  mem[RAM.moving] = 1;
  mem[RAM.encStep] = encStep;
  if (where.streamedMap !== undefined) {
    mem[RAM.mapIsStreamed] = 1;
    mem[RAM.curMap] = where.streamedMap;
  } else {
    mem[RAM.mapIsStreamed] = 0;
    mem[RAM.flatScreen] = where.flat;
    mem[RAM.ordScreen] = where.flat;
  }
  for (let i = 0; i < 4; i++) mem[RAM.monSlotActor + i] = 0xee; // untouched is visible
  callRoutine(nes, symbols.check_encounter);
  const slots = [0, 1, 2, 3].map((i) => mem[RAM.monSlotActor + i]);
  const result = { slots, fought: mem[RAM.gameState] === ST_BATTLE, encStep: mem[RAM.encStep], rng: mem[RAM.rng] };
  mem[RAM.gameState] = state;
  return result;
}
