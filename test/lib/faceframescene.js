// A generated scene for the move_face pose-clamp tests (test/unit/faceframe.test.js,
// test/lua/build_face_frame_roms.mjs): one NPC whose art is chosen so that a stale
// ent_frame after a change of facing draws a *different, wrong* pose instead of a
// merely out-of-range one.
//
// Art (animations are emitted in this order, so "next after `up`" is `next`):
//   long  = 2 frames of metasprite 0 (narrow, tile X offset 0)      -- facing down
//   short = 1 frame  of metasprite 0                                 -- facing up
//   next  = 1 frame  of metasprite 1 (wide, tile X offset +16)       -- facing left/right
// Frame 1 of `short` is the byte pair after it in the animation data: `next`'s own
// frame 0, i.e. metasprite 1, whose tile sits at +16. At X = 250 that wraps to 10.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import NES from '../../renderer/emulator/core/nes.js';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createProject } from '../../shared/project.js';
import { createStreamedProject } from './streamedproject.js';
import { finishNamingIfOpen } from './naming.js';

// from engine/constants.asm
export const GAME_STATE = 0x25;
export const PENDING_ENT = 0x7c;
export const MAP_IS_STREAMED = 0xfe;
export const ENT_X = 0x0310;
export const ENT_Y = 0x0318;
export const ENT_DIR = 0x0320;
export const ENT_FRAME = 0x0328;
export const ENT_TIMER = 0x0330;
export const ST_GAMEPLAY = 0;
export const ST_DIALOG = 2;
export const DIR_DOWN = 0;
export const DIR_UP = 1;
export const DIR_LEFT = 2;
export const OAM = 0x0200;
export const MAX_ENTITIES = 8;
export const ENT_ACTIVE = 0x0300;

const tile = (x) => ({ x, y: 0, tile: 32, palette: 1, hflip: false, vflip: false });

/**
 * options.streamed: a streamed map (UNROM 512, four-screen) instead of an ordinary one.
 * options.commands: the event page's commands (the page has no trigger of its own that
 *   fires by itself: the test pokes pending_ent to start it).
 * options.x/y: the NPC's origin. options.art: overrides for the three animations'
 *   frame counts, {down, up, next} (default 2/1/1); options.upAnim: 'short' (default) or
 *   null to leave the up facing empty (falls back to idle, which is also null -> NO_ANIM).
 * options.solidRow: a metatile row (or an array of rows) painted solid so a Move is refused
 *   on its first tick (row 6 for a Move up from y = 100, row 7 for a Move down).
 */
export function buildFaceScene({ streamed = false, commands, x = 250, y = 100, art = {}, upFrames, upNoAnim = false, solidRow, entitiesText } = {}) {
  const project = streamed ? createStreamedProject({ moveCommands: commands }) : createProject('Face Frame', 'action');
  const s = project.sprites;
  const msA = s.metasprites.length;
  s.metasprites.push({ id: msA, name: 'narrow', tiles: [tile(0)] }, { id: msA + 1, name: 'wide+16', tiles: [tile(16)] });
  const a0 = s.animations.length;
  const frames = (ms, n) => Array.from({ length: n }, () => ({ metaspriteId: ms, duration: 200 }));
  s.animations.push(
    { id: a0, name: 'long', loop: true, frames: frames(msA, art.down ?? 2) },
    { id: a0 + 1, name: 'short', loop: true, frames: (typeof upFrames === 'function' ? upFrames(msA) : upFrames) ?? frames(msA, art.up ?? 1) },
    { id: a0 + 2, name: 'next', loop: true, frames: frames(msA + 1, art.next ?? 1) }
  );
  const anims = { walkDown: a0, walkUp: upNoAnim ? null : a0 + 1, walkSide: a0 + 2 };
  let actor;
  if (streamed) {
    actor = s.actors[s.actors.length - 1];
    actor.anims = anims;
    const entity = project.maps[0].screens[0].entities[0];
    entity.x = x;
    entity.y = y;
    entity.props = { event: entity.props.event };
  } else {
    actor = { name: 'Walker', behavior: 'npc', hp: 1, damage: 0, speed: 1, anims };
    s.actors.push(actor);
    project.maps[0].screens[0].entities = [
      { actorId: s.actors.length - 1, x, y, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }
    ];
  }
  if (solidRow !== undefined) {
    const screen = project.maps[0].screens[0];
    // metatile 1 becomes solid; stamp it across one metatile row.
    project.metatiles[1].collision = 'solid';
    for (const row of [solidRow].flat()) for (let col = 0; col < 16; col++) screen.metatiles[row * 16 + col] = 1;
  }
  if (entitiesText) project.code.overrides.push({ name: 'entities.asm', text: entitiesText });
  return { project, msA, a0, actorIndex: s.actors.indexOf(actor) };
}

export function symbols(fnsText) {
  const out = {};
  for (const m of fnsText.matchAll(/^(\w+)\s*=\s*\$([0-9A-Fa-f]+)/gm)) out[m[1]] = parseInt(m[2], 16);
  return out;
}

/** Builds the ROM in a mkdtemp directory; returns its bytes and symbol table. */
export async function buildRom(project) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-faceframe-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    return {
      rom: new Uint8Array(fs.readFileSync(built.romPath)),
      syms: symbols(fs.readFileSync(path.join(dir, 'build/game.fns'), 'utf8'))
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** A fresh emulator on `rom`, run to gameplay with the NPC spawned and settled. `hook(nes)`, if given, runs before the first frame (so it sees the whole boot from power-on). */
export function bootRom(rom, { streamed = false, hook } = {}) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(rom);
  if (hook) hook(nes);
  const mem = nes.cpu.mem;
  let n = 0;
  while ((mem[GAME_STATE] !== ST_GAMEPLAY || (streamed && mem[MAP_IS_STREAMED] !== 1)) && n++ < 200) nes.frame();
  if (mem[GAME_STATE] !== ST_GAMEPLAY) throw new Error('scene never reached gameplay');
  finishNamingIfOpen(nes);
  // a streamed window fills over a few dozen frames; the NPC is not in RAM before that
  for (let i = 0; i < 300 && mem[ENT_ACTIVE] !== 1; i++) nes.frame();
  if (mem[ENT_ACTIVE] !== 1) throw new Error('the NPC never spawned');
  for (let i = 0; i < 5; i++) nes.frame();
  return { nes, mem };
}
