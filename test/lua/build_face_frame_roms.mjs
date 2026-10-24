#!/usr/bin/env node
// Streamed worlds phase 3a, slice S0: builds the four move_face pose-clamp scenes for
// face_frame_check.lua.template -- D1 (Turn) and D2 (Move blocked on its first tick), each on an
// ordinary map and on a streamed one -- through the real public path (buildFaceScene + buildProject).
//
//   node test/lua/build_face_frame_roms.mjs [outDir] [--break=shipped]
//
// --break=shipped builds every scene on the move_face 9f0136e shipped -- set ent_dir and return, no clamp of ent_frame
// or ent_timer -- as a Code Forge override of the CURRENT engine/entities.asm with only that routine's body put back,
// while the lua keeps expecting the clamped result, so every scene must fail (exit 5): the negative control that shows
// the check can fail. (An earlier version overrode the whole 9f0136e entities.asm; that file calls sw_move_probe, which
// 846cd78 retired, so the streamed scenes stopped assembling and the control died of an assembler error, not of its claim.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { buildFaceScene } from '../lib/faceframescene.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-face-frame';
const breakShipped = args.includes('--break=shipped');

/**
 * The current entities.asm with only move_face's body put back to 9f0136e's: `sta ent_dir,x` then `rts`. Everything from
 * the store through the clamp (the `entity_animation` / `anim_count` comparison and the two zeroing stores, ending at
 * `move_face_done:` / `rts`) goes; the player branch, the label before it and every other routine stay current. Throws
 * when the routine no longer has that shape, so a rewritten move_face cannot silently turn the control into a no-op.
 */
function shippedMoveFace(text) {
  const start = text.indexOf('move_face:\n  ldx <mv_who\n  bne move_face_player\n  ldx <talk_ent\n  sta ent_dir,x\n');
  const end = text.indexOf('move_face_player:\n', start);
  if (start < 0 || end < 0 || text.indexOf('move_face:\n', start + 1) >= 0) throw new Error('engine/entities.asm move_face no longer has the shape --break=shipped replaces');
  const head = text.indexOf('  sta ent_dir,x\n', start) + '  sta ent_dir,x\n'.length;
  const clamp = text.slice(head, end);
  if (!/ent_frame,x/.test(clamp) || !/ent_timer,x/.test(clamp) || !clamp.endsWith('move_face_done:\n  rts\n')) throw new Error('move_face\'s clamp is not the ent_frame/ent_timer clamp --break=shipped removes');
  return text.slice(0, head) + '  rts\n' + text.slice(end);
}
const shipped = breakShipped ? shippedMoveFace(fs.readFileSync(path.join(ROOT, 'engine/entities.asm'), 'utf8')) : undefined;
const template = fs.readFileSync(path.join(ROOT, 'test/lua/face_frame_check.lua.template'), 'utf8');

const TURN_UP = [{ op: 'turn', who: 'self', dir: 'up' }, { op: 'say', text: 'Hi' }];
const MOVE_UP = [{ op: 'move', who: 'self', dir: 'up', dist: 8 }, { op: 'say', text: 'Hi' }];
const SCENES = [
  { name: 'd1_ordinary', streamed: false, commands: TURN_UP },
  { name: 'd1_streamed', streamed: true, commands: TURN_UP },
  { name: 'd2_ordinary', streamed: false, commands: MOVE_UP, solidRow: 6 },
  { name: 'd2_streamed', streamed: true, commands: MOVE_UP, solidRow: 6 }
];

fs.mkdirSync(outDir, { recursive: true });
for (const scene of SCENES) {
  const { project } = buildFaceScene({ streamed: scene.streamed, commands: scene.commands, x: 250, y: 100, solidRow: scene.solidRow, entitiesText: shipped });
  const dir = fs.mkdtempSync(path.join(outDir, `${scene.name}-build-`));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = new Map();
  const pending = new Map();
  scanEquates(fs.readFileSync(path.join(dir, 'build/constants.asm'), 'utf8'), pending);
  scanEquates(fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8'), pending);
  scanEquates(fs.readFileSync(path.join(dir, 'build/assets/cartridge.inc'), 'utf8'), pending);
  resolveEquates(pending, symbols);
  const sym = (name) => {
    if (!symbols.has(name)) throw new Error(`${name} did not resolve out of this build's constants.asm`);
    return `0x${symbols.get(name).toString(16)}`;
  };
  // the group a correct engine draws: metasprite 0's one tile, (ey - 1, tile, palette attr, ex)
  const tile = project.sprites.metasprites.find((m) => m.name === 'narrow').tiles[0];
  const group = [100 - 1 + tile.y, tile.tile, tile.palette & 3, 250 + tile.x];
  // the dialogue portrait (engine/ui.asm draw_dialog): the actor's facing-down first frame, whose
  // metasprite is the `narrow` one here; the lua adds PORTRAIT_X/Y (and the lift) itself
  const portraitTile = [tile.y, tile.tile, tile.palette & 3, tile.x];
  const lua = template
    .replaceAll('__GAME_STATE__', sym('game_state'))
    .replaceAll('__ST_DIALOG__', sym('ST_DIALOG'))
    .replaceAll('__PENDING_ENT__', sym('pending_ent'))
    .replaceAll('__ENT_ACTIVE__', sym('ent_active'))
    .replaceAll('__ENT_DIR__', sym('ent_dir'))
    .replaceAll('__ENT_FRAME__', sym('ent_frame'))
    .replaceAll('__ENT_TIMER__', sym('ent_timer'))
    .replaceAll('__MAP_IS_STREAMED__', sym('map_is_streamed'))
    .replaceAll('__STREAMED__', scene.streamed ? '1' : '0')
    .replaceAll('__ST_GAMEPLAY__', sym('ST_GAMEPLAY'))
    .replaceAll('__BOX_STATE__', sym('box_state'))
    .replaceAll('__BOX_CLOSED__', sym('BOX_CLOSED'))
    .replaceAll('__BOX_TYPING__', sym('BOX_TYPING'))
    .replaceAll('__BOX_CLOSING__', sym('BOX_CLOSING'))
    .replaceAll('__BOX_ENDWAIT__', sym('BOX_ENDWAIT'))
    .replaceAll('__TALK_ENT__', sym('talk_ent'))
    .replaceAll('__MAX_ENTITIES__', sym('MAX_ENTITIES'))
    .replaceAll('__PLAYER_X__', sym('player_x'))
    .replaceAll('__PLAYER_Y__', sym('player_y'))
    .replaceAll('__PLAYER_DIR__', sym('player_dir'))
    .replaceAll('__ANIM_FRAME__', sym('anim_frame'))
    .replaceAll('__FRAME_CNT__', sym('frame_cnt'))
    .replaceAll('__PLAYER_IFRAMES__', sym('player_iframes'))
    .replaceAll('__PORTRAIT_X__', sym('PORTRAIT_X'))
    .replaceAll('__PORTRAIT_Y__', sym('PORTRAIT_Y'))
    .replaceAll('__PORTRAIT_LIFT__', sym('PORTRAIT_LIFT'))
    .replaceAll('__PORTRAIT_TILE__', portraitTile.join(', '))
    .replaceAll('__EXPECTED_GROUP__', group.join(', '));
  if (/__[A-Z_]+__/.test(lua)) throw new Error('an unsubstituted placeholder is left in the lua');
  fs.copyFileSync(built.romPath, path.join(outDir, `${scene.name}.nes`));
  fs.writeFileSync(path.join(outDir, `${scene.name}.lua`), lua);
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`built ${scene.name}\n`);
}
