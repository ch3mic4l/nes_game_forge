// The text-box CLOSE frame's queue on a ring build, captured headlessly under jsnes (phase 3b S3, C1).
//
// The close-deadline harness (test/lua/sw_close_deadline.lua.template, ring sections; scene: test/lua/ring_gate/ringclose.mjs) proves the frame
// finishes inside vblank under Mesen. The part of it a unit test needs is the QUEUE: the packets main_loop leaves in vram_buf on the frame that
// consumes the B press dismissing the last page -- Flip top, Flip bottom, Flash, arrow hide, the first close row (one packet, or two across the
// nametable seam), terminator. This file replays that scene's timeline under jsnes with the same synthetic Flip + Flash poke the template makes (a
// streamed screen with boundTiles is refused, so the Flip cannot be authored) and snapshots vram_len / vram_buf at main_loop_ready on the armed frame.
import fs from 'node:fs';
import { ringCloseProject, closeShape, TALKER } from '../lua/ring_gate/ringclose.mjs';
import { bootRom } from '../lua/ring_gate/ringrun_jsnes.mjs';
import { buildThrough } from './ringbypass.js';
import { buildSymbols, readFns } from './ringrun.js';

const BTN = { B: 1, START: 3 };
export { closeShape, TALKER };

/** vram_buf[0..len] as packets: [{ hi, lo, cnt, at }]; throws a message naming the first malformed header. */
export function parsePackets(buf, len) {
  const packets = [];
  let i = 0;
  while (i < len) {
    if (buf[i] === 0) throw new Error(`terminator at ${i}, before vram_len ${len}`);
    packets.push({ hi: buf[i], lo: buf[i + 1], cnt: buf[i + 2], at: i });
    i += 3 + buf[i + 2];
  }
  if (i !== len) throw new Error(`packets end at ${i}, vram_len ${len}`);
  if (buf[len] !== 0) throw new Error(`vram_buf[${len}] is not the terminator`);
  return packets;
}

/**
 * Builds the ring close scene for `cell` through `loaded` (a ringbypass tree; `tree` its root holder) and replays the dismissing press.
 * `project` (S5 C1) replaces the gate's scene with a caller-built one (test/lib/ringrpg.js's ceiling scenes); `flip: false` is for a scene that has no ordinary map and so
 * no bound tile, hence no flip_tick: only the Flash is armed then and the queue is Flash, arrow hide and the close row.
 * Returns { vramLen, packets, buf, ring }. Throws (never returns a partial result) if the scene does not reach the armed frame.
 */
export async function captureCloseFrame({ loaded, tree, cell, gameType = 'action', placement = 'resident', n = 4, project: given = null, flip = true }) {
  const project = given ?? (await ringCloseProject({ tree, cell, gt: gameType, placement, n })).project;
  const built = await buildThrough(loaded, project);
  try {
    const sym = buildSymbols(built.dir);
    const fns = readFns(built.symbolPath);
    for (const n of [flip ? 'flip_tick' : 'flash_tick', 'main_loop_ready']) if (!Number.isFinite(fns[n])) throw new Error(`${n} is not a symbol of this build`);
    // the instruction the press-consuming frame is armed at: one before flip_tick reads the queued Flip, or (no Flip in this scene) before flash_tick reads flash_left
    const armPc = flip ? fns.flip_tick : fns.flash_tick;
    const R = (n) => sym.get(n);
    const nes = bootRom(built.romPath);
    let phase = 1;
    let armed = false;
    let snap = null;
    const emulate = nes.cpu.emulate.bind(nes.cpu);
    nes.cpu.emulate = () => {
      const pc = nes.cpu.REG_PC + 1;
      const m = nes.cpu.mem;
      if (pc === armPc && !armed && phase === 5) {
        // the template's poke: queue the Flip and arm Flash one instruction before flip_tick reads them, on the frame that consumes the press
        armed = true;
        if (flip) {
          m[R('flip_pending_idx')] = 0;
          m[R('flip_pending_count')] = 1;
        }
        m[R('flash_left')] = R('FLASH_ARM_VALUE');
      } else if (pc === fns.main_loop_ready && armed && !snap) {
        const len = m[R('vram_len')];
        snap = { vramLen: len, buf: Array.from(m.slice(R('vram_buf'), R('vram_buf') + Math.min(len + 1, 120))) };
      }
      return emulate();
    };
    const m = () => nes.cpu.mem;
    const frame = () => nes.frame();
    const run = (n) => { for (let i = 0; i < n; i++) frame(); };
    const tap = (btn, hold = 6) => { nes.buttonDown(1, btn); run(hold); nes.buttonUp(1, btn); };
    // 1: title -> Start; the streamed map live and settled for 100 frames
    run(30);
    for (let i = 0; i < 40 && m()[R('game_state')] === R('ST_TITLE'); i++) { tap(BTN.START); run(15); }
    for (let i = 0; i < 900 && !(m()[R('game_state')] === 0 && m()[R('map_is_streamed')] === 1); i++) frame();
    if (!(m()[R('game_state')] === 0 && m()[R('map_is_streamed')] === 1)) throw new Error('the streamed map never went live');
    run(100);
    // 2: B opens the talker's Say (the player starts on the talker)
    tap(BTN.B, 3);
    // 3: wait for the last page's end wait, let it sit 4 frames, then press B for the dismissing frame
    let wait = 0;
    for (; wait < 600 && m()[R('box_state')] !== R('BOX_ENDWAIT'); wait++) frame();
    if (m()[R('box_state')] !== R('BOX_ENDWAIT')) throw new Error('the box never reached BOX_ENDWAIT');
    run(4);
    phase = 5;
    nes.buttonDown(1, BTN.B);
    for (let i = 0; i < 12 && !snap; i++) { frame(); if (i === 3) nes.buttonUp(1, BTN.B); }
    nes.buttonUp(1, BTN.B);
    if (!armed) throw new Error(`${flip ? 'flip_tick' : 'flash_tick'} never ran with the press pending`);
    if (!snap) throw new Error('main_loop_ready never reached after arming');
    return { ...snap, packets: parsePackets(snap.buf, snap.vramLen), ring: cell.ring, n, overlayAddr: fns.sw_dlg_single ?? null, row: m()[R('sw_row')], col: m()[R('sw_col')] };
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
}
