// S0 of streamed worlds phase 3a (handoff-next/streamed-worlds-phase3a-plan.md §7 S0): move_face
// (engine/entities.asm) brings ent_frame/ent_timer back into range of the NEW facing's animation,
// the rule entity_animate applies. Both callers -- script_op_turn and script_op_move -- reach a
// draw before entity_animate ever runs (a Turn, and a Move blocked on its first tick, draw the
// whole following Say with whatever frame they were left holding), so before this the frame could
// be one past the end of the animation: the draw then read the NEXT animation's first frame.
//
// Every scene is generated (test/lib/faceframescene.js), built to a real ROM in mkdtemp and driven
// in the built-in emulator; nothing here touches a checked-in fixture. The art is chosen so the
// defect is visible as a *different pose*, not merely an out-of-range index: frame 1 of the 1-frame
// `up` animation is the first frame of the animation emitted right after it, whose only tile sits
// at X offset +16 -- at X = 250 that wraps to 10 on an ordinary map and parks off screen on a
// streamed one. Expected OAM comes from an independent resolver over the project's own JSON
// (never from the ROM's tables), and the test also builds the shipped 9f0136e move_face (a Code
// Forge override of entities.asm) and asserts *it* shows the defect, so the discriminator is known
// to discriminate.
//
// Every Say is observed to its END, not for a fixed number of frames: drive(..., {say: true}) runs the
// event through the Say's opening, typing and end-wait, presses A at the end-wait, and stops on the frame
// the box is closed and the game is back in play; a frame cap is only the bound on a failure. On every one
// of those frames the WHOLE 256-byte shadow OAM is compared with expectedOam(), built without reading the
// ROM's tables: the player's four tiles from player state (tile = (dir*2 + frame)*4 + corner, generate.js
// numbers player_tiles 0..31), the actor's group from the project JSON (resolveGroup), the dialogue
// portrait from the project JSON plus PORTRAIT_X/Y/LIFT and frame_cnt (engine/ui.asm draw_dialog: drawn
// only while a box is not open), and every remaining slot parked (Y = $FF; the engine writes only the Y
// byte of a parked slot, so that is the only byte of such a slot that is defined).
//
// Addresses are transcribed from engine/constants.asm.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUTTON } from '../../renderer/emulator/runcontrol.js';
import {
  buildFaceScene, buildRom, bootRom,
  GAME_STATE, PENDING_ENT, ENT_X, ENT_Y, ENT_DIR, ENT_FRAME, ENT_TIMER, OAM, ST_DIALOG, ST_GAMEPLAY, MAX_ENTITIES, ENT_ACTIVE,
  DIR_DOWN, DIR_UP
} from '../lib/faceframescene.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const SHIPPED_REV = '9f0136e';

const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const PLAYER_DIR = 0x12;
const ANIM_FRAME = 0x13;
const FRAME_CNT = 0x1b;
const TALK_ENT = 0x3a;
const PLAYER_IFRAMES = 0x4f;
const BOX_STATE = 0x40;
const BOX_CLOSED = 0;
const BOX_TYPING = 2;
const BOX_CLOSING = 5;
const BOX_ENDWAIT = 6;
const PORTRAIT_X = 116;
const PORTRAIT_Y = 40;
const PORTRAIT_LIFT = 2;
const MV_LEFT = 0x96;
const NO_ENTITY = 0xff;
const SW_CAM = 0x035c; // sw_cam_origin_x_lo..y_hi, four bytes
const SAY_CAP = 400; // failure bound for a Say that never ends; never the success condition
const PARKED = 255;

const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };

// ------------------------------------------------------------------ the shipped move_face

let shippedText;
function shippedEntities() {
  if (shippedText === undefined) {
    try {
      shippedText = execFileSync('git', ['show', `${SHIPPED_REV}:engine/entities.asm`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {
      shippedText = null;
    }
  }
  return shippedText;
}
// (the message says what a skip costs: a run that skips these has NOT verified S0)
const needsShipped = () => (shippedEntities() === null
  ? `git history for ${SHIPPED_REV} not available: S0 verification is INCOMPLETE without it (the faithfulness, shipped-engine negative-control and guard-path checks cannot run)`
  : false);

// ------------------------------------------------------------------ scene plumbing

const cache = new Map();
/** Builds (once) the ROM for a scene; `shipped` builds the same scene on the 9f0136e move_face. */
function sceneRom(key, opts, { shipped = false } = {}) {
  const full = `${shipped ? 'shipped:' : ''}${key}`;
  if (!cache.has(full)) {
    cache.set(full, (async () => {
      const scene = buildFaceScene({ ...opts, entitiesText: shipped ? shippedEntities() : undefined });
      const built = await buildRom(scene.project);
      return { ...scene, ...built, streamed: !!opts.streamed };
    })());
  }
  return cache.get(full);
}

const TURN_UP = [{ op: 'turn', who: 'self', dir: 'up' }, { op: 'say', text: 'Hi' }];
const MOVE_UP = [{ op: 'move', who: 'self', dir: 'up', dist: 8 }, { op: 'say', text: 'Hi' }];
// entity at y = 100 (metatile row 6): a solid row 6 refuses a Move up on its very first tick
const BLOCKED = { solidRow: 6 };

const SCENES = {
  turn: (streamed) => ({ streamed, commands: TURN_UP }),
  blocked: (streamed) => ({ streamed, commands: MOVE_UP, ...BLOCKED }),
  free: (streamed) => ({ streamed, commands: MOVE_UP })
};
const sceneFor = (name, streamed, extra = {}) => ({ ...SCENES[name](streamed), ...extra });

const entityArrays = (mem) => ({
  active: [...mem.slice(ENT_ACTIVE, ENT_ACTIVE + MAX_ENTITIES)],
  dir: [...mem.slice(ENT_DIR, ENT_DIR + MAX_ENTITIES)],
  frame: [...mem.slice(ENT_FRAME, ENT_FRAME + MAX_ENTITIES)],
  timer: [...mem.slice(ENT_TIMER, ENT_TIMER + MAX_ENTITIES)]
});

/**
 * A fresh emulator on the scene's ROM, state poked, the event started; returns per-frame records.
 *
 * With `say: true` the event is observed to the END of its Say: A is pressed on the first frame the box
 * waits for confirm (BOX_ENDWAIT), released after the frame that acts on it, and the run stops on the
 * frame the game is back in play with the box closed (that record has `final: true`). `done` says whether
 * that happened within SAY_CAP frames, and `boxSeen` which box states the run went through. Otherwise it
 * runs exactly `frames` frames.
 */
function drive(sc, { dir = DIR_DOWN, frame = 1, timer = 3, frames = 10, say = false, before } = {}) {
  const { nes, mem } = bootRom(sc.rom, { streamed: sc.streamed });
  if (sc.streamed) {
    assert.deepEqual([...mem.slice(SW_CAM, SW_CAM + 4)], [0, 0, 0, 0], 'the resolver below assumes the camera origin is (0, 0)');
  }
  mem[ENT_DIR] = dir;
  mem[ENT_FRAME] = frame;
  mem[ENT_TIMER] = timer;
  if (before) before({ nes, mem, sc });
  mem[PENDING_ENT] = 0;
  const initial = { ex: mem[ENT_X], ey: mem[ENT_Y] };
  const records = [];
  const boxSeen = new Set();
  let pressedAt = null;
  let released = false;
  let done = false;
  for (let i = 0; i < (say ? SAY_CAP : frames); i++) {
    nes.frame();
    const rec = {
      i, gs: mem[GAME_STATE], box: mem[BOX_STATE], dir: mem[ENT_DIR], frame: mem[ENT_FRAME], timer: mem[ENT_TIMER],
      ex: mem[ENT_X], ey: mem[ENT_Y], mvLeft: mem[MV_LEFT], fc: mem[FRAME_CNT], talk: mem[TALK_ENT], active: mem[ENT_ACTIVE],
      px: mem[PLAYER_X], py: mem[PLAYER_Y], pdir: mem[PLAYER_DIR], pframe: mem[ANIM_FRAME], piframes: mem[PLAYER_IFRAMES],
      ents: entityArrays(mem), oam: Uint8Array.from(mem.slice(OAM, OAM + 256))
    };
    records.push(rec);
    if (!say) continue;
    boxSeen.add(rec.box);
    if (pressedAt !== null && !released && i > pressedAt) {
      nes.buttonUp(1, BUTTON.A);
      released = true;
    }
    if (pressedAt === null && rec.box === BOX_ENDWAIT) {
      nes.buttonDown(1, BUTTON.A);
      pressedAt = i;
    }
    if (pressedAt !== null && rec.gs === ST_GAMEPLAY && rec.box === BOX_CLOSED) {
      rec.final = true;
      done = true;
      break;
    }
  }
  if (pressedAt !== null && !released) nes.buttonUp(1, BUTTON.A);
  return { nes, mem, records, initial, done, boxSeen };
}

/** The Say really ran through its typing, its end-wait and its closing, and the game is back in play. */
function assertSayCompleted(out, what) {
  assert.ok(out.done, `${what}: the Say must run to its end (box closed, game back in play) within ${SAY_CAP} frames`);
  for (const [name, state] of [['typing', BOX_TYPING], ['end-wait', BOX_ENDWAIT], ['closing', BOX_CLOSING]]) {
    assert.ok(out.boxSeen.has(state), `${what}: the box must have passed through ${name} (saw box states ${[...out.boxSeen]})`);
  }
  const last = out.records[out.records.length - 1];
  assert.deepEqual([last.final, last.gs, last.box], [true, ST_GAMEPLAY, BOX_CLOSED], `${what}: last record`);
}

// ------------------------------------------------------------------ the independent resolver

const SLOT_OF_DIR = ['walkDown', 'walkUp', 'walkSide', 'walkSide'];

/** The tiles the actor must be drawn as for (dir, frame) at (ex, ey), from the project's own data. */
function resolveGroup(sc, { dir, frame, ex, ey }) {
  const actor = sc.project.sprites.actors[sc.actorIndex];
  const anims = actor.anims;
  const animId = anims[SLOT_OF_DIR[dir]] ?? anims.idle ?? null;
  if (animId === null) return { group: null, count: 0 };
  const animation = sc.project.sprites.animations[animId];
  const count = animation.frames.length;
  const entry = animation.frames[frame];
  if (!entry) return { group: undefined, count };
  const group = sc.project.sprites.metasprites[entry.metaspriteId].tiles.map((t) => {
    const attr = (t.palette & 3) | (t.hflip ? 0x40 : 0) | (t.vflip ? 0x80 : 0);
    const wx = ex + t.x;
    // an ordinary map wraps into the 8-bit OAM byte; a streamed map projects and parks what falls off
    const parked = sc.streamed && (wx < 0 || wx > 255);
    return parked ? [PARKED, t.tile, attr, wx & 255] : [(ey - 1 + t.y) & 255, t.tile, attr, wx & 255];
  });
  return { group, count };
}

/** The dialogue portrait's tiles (engine/ui.asm draw_dialog): the actor's facing-down first frame, over the box-less dialogue. */
function portraitTiles(sc, rec) {
  const actor = sc.project.sprites.actors[sc.actorIndex];
  const animId = actor.anims.walkDown ?? actor.anims.idle ?? null;
  if (animId === null) return [];
  const y = PORTRAIT_Y - ((rec.fc & 0x10) ? PORTRAIT_LIFT : 0);
  const ms = sc.project.sprites.metasprites[sc.project.sprites.animations[animId].frames[0].metaspriteId];
  return ms.tiles.map((t) => [(y + t.y) & 255, t.tile, (t.palette & 3) | (t.hflip ? 0x40 : 0) | (t.vflip ? 0x80 : 0), (PORTRAIT_X + t.x) & 255]);
}

/**
 * The 256 bytes the shadow OAM must hold on this frame, null where the engine leaves a byte undefined (the
 * three bytes a parked slot is never given). Player, then the actor group, then the dialogue portrait, then
 * parked slots -- the order engine/boot.asm main_loop_draw builds them in.
 */
function expectedOam(sc, rec) {
  const want = new Array(256).fill(null);
  let slot = 0;
  const put = (tile) => {
    assert.ok(slot < 64, 'more tiles than OAM slots');
    want.splice(slot * 4, 4, ...tile);
    slot++;
  };
  const base = (rec.pdir * 2 + rec.pframe) * 4;
  for (let k = 0; k < 4; k++) {
    put([(rec.py - 1 + (k >= 2 ? 8 : 0)) & 255, base + k, 0, (rec.px + (k & 1 ? 8 : 0)) & 255]);
  }
  const { group } = resolveGroup(sc, rec);
  for (const tile of group ?? []) put(tile[0] === PARKED ? [PARKED, null, null, null] : tile);
  if (rec.gs === ST_DIALOG && rec.box === BOX_CLOSED && rec.talk < MAX_ENTITIES && rec.active === 1) portraitTiles(sc, rec).forEach(put);
  while (slot < 64) put([PARKED, null, null, null]);
  return want;
}

const OAM_FIELD = ['Y', 'tile', 'attr', 'X'];

/** Everything wrong with one frame record, as strings; [] when the frame is exactly right. */
function frameProblems(sc, rec, { expectFrame, expectTimer } = {}) {
  const problems = [];
  const { group, count } = resolveGroup(sc, rec);
  if (rec.gs !== ST_DIALOG && !rec.final) problems.push(`frame ${rec.i}: game_state ${rec.gs}, not the dialogue the event opened`);
  // the player oracle's preconditions: drawn (no invincibility flicker) and wholly on screen
  if (rec.piframes !== 0 || rec.px + 16 > 255 || rec.py + 16 > 239) problems.push(`frame ${rec.i}: the player oracle needs a visible player (iframes ${rec.piframes}, at ${rec.px},${rec.py})`);
  if (group === undefined) {
    problems.push(`frame ${rec.i}: ent_frame ${rec.frame} is past the ${count}-frame animation (actor tile in OAM: [${[...rec.oam.slice(16, 20)]}], X = ${rec.oam[19]})`);
    return problems;
  }
  if (expectFrame !== undefined && rec.frame !== expectFrame) problems.push(`frame ${rec.i}: ent_frame ${rec.frame}, expected ${expectFrame}`);
  // the frame the event ends on runs the world again, which legitimately counts the timer on
  if (expectTimer !== undefined && !rec.final && rec.timer !== expectTimer) problems.push(`frame ${rec.i}: ent_timer ${rec.timer}, expected ${expectTimer}`);
  const want = expectedOam(sc, rec);
  let shown = 0;
  for (let b = 0; b < 256; b++) {
    if (want[b] === null || rec.oam[b] === want[b]) continue;
    if (shown++ < 4) problems.push(`frame ${rec.i}: OAM slot ${b >> 2} ${OAM_FIELD[b & 3]} is ${rec.oam[b]}, expected ${want[b]}`);
  }
  if (shown > 4) problems.push(`frame ${rec.i}: ...and ${shown - 4} more OAM bytes`);
  return problems;
}

const allProblems = (sc, records, expect) => records.flatMap((rec) => frameProblems(sc, rec, expect));

// ------------------------------------------------------------------ preconditions the discriminator needs

/** The art really has the shape D1 relies on, read back from the generated ROM tables. */
function assertDiscriminatorGeometry(sc, mem) {
  const up = sc.a0 + 1;
  const next = sc.a0 + 2;
  const at = (table, i) => mem[sc.syms[table] + i];
  const ptr = (i) => at('anim_ptr_lo', i) | (at('anim_ptr_hi', i) << 8);
  assert.equal(at('anim_count', up), 1, 'the up facing must be a one-frame animation');
  assert.equal(ptr(up) + 2 * at('anim_count', up), ptr(next), 'the animation emitted after `up` must start right after it, so frame 1 of `up` reads its frame 0');
  const nextMs = mem[ptr(next)];
  assert.equal(nextMs, sc.msA + 1, "the next animation's first frame must be the wide metasprite");
  const msPtr = at('ms_ptr_lo', nextMs) | (at('ms_ptr_hi', nextMs) << 8);
  assert.equal(mem[msPtr + 3], 16, 'the wide metasprite tile must sit at X offset +16');
}

// ------------------------------------------------------------------ the shipped engine is what we say it is

test('the shipped 9f0136e move_face is the current one minus the clamp (the override the negative controls build on is faithful)', { skip: needsShipped() }, () => {
  const current = fs.readFileSync(path.join(ROOT, 'engine/entities.asm'), 'utf8');
  const clamp = /(  sta ent_dir,x\n)(?:  ;[^\n]*\n)+  jsr entity_animation\n  cmp #NO_ANIM\n  beq move_face_done\n  tay\n  lda ent_frame,x\n  cmp anim_count,y\n  bcc move_face_done\n  lda #0\n  sta ent_frame,x\n  sta ent_timer,x\nmove_face_done:\n(  rts\nmove_face_player:)/;
  assert.equal(current.match(clamp)?.length, 3, 'move_face must contain the clamp exactly as this test describes it');
  assert.equal(current.replace(clamp, '$1$2'), shippedEntities());
});

// ------------------------------------------------------------------ D1: Turn

for (const streamed of [false, true]) {
  const where = streamed ? 'streamed map' : 'ordinary map';

  test(`D1 (${where}): Turn to a shorter facing draws metasprite 0 at X = 250, frame 0 timer 0, on every frame from the Turn to the end of the Say`, boots, async () => {
    const sc = await sceneRom(`turn:${streamed}`, sceneFor('turn', streamed));
    const out = drive(sc, {
      say: true,
      before: ({ mem: m }) => assert.deepEqual([m[ENT_DIR], m[ENT_FRAME], m[ENT_TIMER], m[ENT_X], m[ENT_Y]], [DIR_DOWN, 1, 3, 250, 100]),
    });
    const { mem, records, initial } = out;
    assert.deepEqual([initial.ex, initial.ey], [250, 100]);
    assertDiscriminatorGeometry(sc, mem);
    assertSayCompleted(out, 'D1');
    assert.deepEqual(allProblems(sc, records, { expectFrame: 0, expectTimer: 0 }), []);
    assert.ok(records.every((r) => r.dir === DIR_UP && r.oam[19] === 250));
  });

  // ---------------------------------------------------------------- D2: blocked Move

  test(`D2 (${where}): a Move blocked on its first tick still draws the pose of its new facing from the Move to the end of the Say`, boots, async () => {
    const sc = await sceneRom(`blocked:${streamed}`, sceneFor('blocked', streamed));
    const out = drive(sc, { say: true });
    const { records } = out;
    assertSayCompleted(out, 'D2');
    // frame 0 is the one before the first move_tick (mv_left = 8); every later frame follows the refusal
    assert.equal(records[0].mvLeft, 8);
    assert.ok(records.every((r) => r.ey === 100 && r.dir === DIR_UP) && records.slice(1).every((r) => r.mvLeft === 0), 'the Move must have been refused on its first tick, having turned the actor');
    assert.deepEqual(allProblems(sc, records, { expectFrame: 0, expectTimer: 0 }), []);
  });

  // ---------------------------------------------------------------- D3: free Move

  test(`D3 (${where}): a free Move's very first frame is already clamped (frame 0, timer 0), and one that lands never draws an out-of-range frame through the end of the Say`, boots, async () => {
    const free = await sceneRom(`free:${streamed}`, sceneFor('free', streamed));
    const first = drive(free, { frames: 1 }).records;
    // (i) the frame right after OP_MOVE, before the first move_tick: the clamp already ran, timer included
    assert.deepEqual(frameProblems(free, first[0], { expectFrame: 0, expectTimer: 0 }), []);
    assert.equal(first[0].timer, 0, 'D3(i): ent_timer must already be 0');
    assert.equal(first[0].oam[19], 250);

    // (ii) art whose up animation alternates the narrow and wide metasprite quickly, at an X where
    // both are on screen: whichever frame the walk lands on, the tile must be that frame's.
    const alt = await sceneRom(`land:${streamed}`, {
      streamed, commands: MOVE_UP, x: 100, y: 100,
      upFrames: (ms) => [{ metaspriteId: ms, duration: 1 }, { metaspriteId: ms + 1, duration: 1 }]
    });
    const out = drive(alt, { say: true, frame: 1, timer: 0 });
    assertSayCompleted(out, 'D3(ii)');
    assert.ok(out.records.some((r) => r.ey === 92), 'the walk must have landed (8 px up from 100)');
    assert.ok(new Set(out.records.map((r) => r.frame)).size === 2, 'the walk must have shown both frames, or (ii) proves nothing');
    assert.deepEqual(allProblems(alt, out.records), []);
  });
}

// ------------------------------------------------------------------ the oracle itself can fail

test('the whole-OAM oracle rejects a corrupted player byte, a stale extra actor tile, an unparked slot and a missing portrait', boots, async () => {
  const sc = await sceneRom('free:false', sceneFor('free', false));
  const { records } = drive(sc, { say: true });
  // an honest run passes; these are the same frames with one byte damaged each
  assert.deepEqual(allProblems(sc, records), []);
  const box0 = records.find((r) => r.gs === ST_DIALOG && r.box === BOX_CLOSED);
  const boxed = records.find((r) => r.box === BOX_TYPING);
  assert.ok(box0 && boxed, 'the run must contain a portrait frame and a boxed frame');
  const damaged = (rec, edit) => {
    const oam = Uint8Array.from(rec.oam);
    edit(oam);
    return { ...rec, oam };
  };
  assert.match(frameProblems(sc, damaged(boxed, (o) => { o[5] ^= 1; }))[0], /OAM slot 1 tile/, 'a player tile');
  assert.match(frameProblems(sc, damaged(boxed, (o) => { o[3] += 1; }))[0], /OAM slot 0 X/, 'a player X');
  assert.match(frameProblems(sc, damaged(boxed, (o) => { o[6 * 4] = 90; }))[0], /OAM slot 6 Y/, 'an extra visible tile in an unused slot');
  assert.match(frameProblems(sc, damaged(boxed, (o) => { o[5 * 4] = 40; }))[0], /OAM slot 5 Y/, 'a portrait tile drawn while a box is open');
  assert.match(frameProblems(sc, damaged(box0, (o) => { o[5 * 4] = 255; }))[0], /OAM slot 5 Y/, 'a missing portrait');
});

// ------------------------------------------------------------------ the shipped engine fails D1, D2, D3(i)

for (const streamed of [false, true]) {
  const where = streamed ? 'streamed map' : 'ordinary map';

  test(`the shipped ${SHIPPED_REV} move_face fails D1, D2 and D3(i) on an ${where} (the discriminator discriminates)`, { ...boots, skip: boots.skip || needsShipped() }, async () => {
    const sc = await sceneRom(`turn:${streamed}`, sceneFor('turn', streamed), { shipped: true });
    const turn = drive(sc, { say: true });
    const blocked = drive(await sceneRom(`blocked:${streamed}`, sceneFor('blocked', streamed), { shipped: true }), { say: true });
    const free = drive(await sceneRom(`free:${streamed}`, sceneFor('free', streamed), { shipped: true }), { frames: 1 }).records;
    for (const [name, out] of [['D1', turn], ['D2', blocked]]) {
      assertSayCompleted(out, `shipped ${name}`);
      // every frame the world is frozen for (the last one runs the world, and entity_animate clamps)
      const frozen = out.records.filter((r) => !r.final);
      assert.ok(frozen.every((r) => r.frame === 1 && r.timer === 3), `${name}: shipped leaves frame 1 timer 3`);
      const bad = allProblems(sc, frozen, { expectFrame: 0, expectTimer: 0 });
      assert.ok(frozen.every((r) => frameProblems(sc, r, { expectFrame: 0, expectTimer: 0 }).length > 0), `${name}: shipped must fail on every frozen frame, got ${bad.length} problems`);
      // the visible symptom: X = 10 (266 wrapped) on an ordinary map, the tile parked (Y = 255) on a streamed one
      for (const r of frozen) {
        if (streamed) assert.equal(r.oam[16], PARKED, `${name} frame ${r.i}: parked`);
        else assert.equal(r.oam[19], 10, `${name} frame ${r.i}: X`);
      }
    }
    assert.ok(frameProblems(sc, free[0], { expectFrame: 0 }).length > 0, 'D3(i): shipped draws the first frame after OP_MOVE wrongly');
    assert.equal(streamed ? free[0].oam[16] : free[0].oam[19], streamed ? PARKED : 10);
  });
}

// ------------------------------------------------------------------ Kept vs reset

// scene A: down 2 frames, up 1 frame.  scene B: down 1 frame, up 2 frames.
const KEPT = [
  { scene: 'A', name: 'frame == count resets frame and timer', dir: DIR_DOWN, frame: 1, timer: 3, turn: 'up', expect: [0, 0] },
  { scene: 'A', name: 'frame == count-1 is kept, timer kept', dir: DIR_DOWN, frame: 0, timer: 3, turn: 'up', expect: [0, 3] },
  { scene: 'A', name: 'frame > count resets', dir: DIR_DOWN, frame: 2, timer: 3, turn: 'up', expect: [0, 0] },
  { scene: 'B', name: 'a longer new animation keeps frame 0 and the timer', dir: DIR_DOWN, frame: 0, timer: 3, turn: 'up', expect: [0, 3] },
  { scene: 'B', name: 'frame == count-1 of the longer animation is kept', dir: DIR_DOWN, frame: 1, timer: 3, turn: 'up', expect: [1, 3] },
  { scene: 'B', name: 'frame == count of the longer animation resets', dir: DIR_DOWN, frame: 2, timer: 3, turn: 'up', expect: [0, 0] }
];
const ART = { A: { down: 2, up: 1 }, B: { down: 1, up: 2 } };

const TURN_DOWN = [{ op: 'turn', who: 'self', dir: 'down' }, { op: 'say', text: 'Hi' }];
const MOVE_DOWN = [{ op: 'move', who: 'self', dir: 'down', dist: 8 }, { op: 'say', text: 'Hi' }];

for (const streamed of [false, true]) {
  for (const caller of ['turn', 'blocked']) {
    test(`Kept (${streamed ? 'streamed' : 'ordinary'}, via ${caller === 'turn' ? 'Turn' : 'a blocked Move'}): the clamp resets only a frame at or past the new facing's count`, boots, async () => {
      for (const c of KEPT) {
        const sc = await sceneRom(`kept${c.scene}:${caller}:${streamed}`, sceneFor(caller, streamed, { art: ART[c.scene] }));
        const { records } = drive(sc, { dir: c.dir, frame: c.frame, timer: c.timer, frames: 4 });
        const last = records[records.length - 1];
        assert.deepEqual([last.dir, last.frame, last.timer], [DIR_UP, ...c.expect], `${c.scene}: ${c.name}`);
      }
    });
  }

  test(`Kept (${streamed ? 'streamed' : 'ordinary'}): a Turn to the same facing keeps an in-range frame and its timer`, boots, async () => {
    const sc = await sceneRom(`turn-down:${streamed}`, { streamed, commands: TURN_DOWN });
    const { records } = drive(sc, { dir: DIR_DOWN, frame: 1, timer: 3, frames: 4 });
    const last = records[records.length - 1];
    assert.deepEqual([last.dir, last.frame, last.timer], [DIR_DOWN, 1, 3]);
  });

  test(`Kept (${streamed ? 'streamed' : 'ordinary'}): a Move to the same facing, blocked on its first tick, keeps an in-range frame and its timer`, boots, async () => {
    // a solid row 7 refuses a Move down from y = 100 (the actor's feet reach row 7)
    const sc = await sceneRom(`move-down-blocked:${streamed}`, { streamed, commands: MOVE_DOWN, solidRow: 7 });
    const out = drive(sc, { dir: DIR_DOWN, frame: 1, timer: 3, say: true });
    assertSayCompleted(out, 'same-facing blocked Move');
    const { records } = out;
    assert.equal(records[0].mvLeft, 8);
    assert.ok(records.every((r) => r.ey === 100 && r.dir === DIR_DOWN) && records.slice(1).every((r) => r.mvLeft === 0), 'the Move must have been refused on its first tick');
    // frozen frames only: the frame the event ends on runs the world, which counts the timer on
    for (const r of records.filter((x) => !x.final)) assert.deepEqual([r.frame, r.timer], [1, 3], `frame ${r.i}`);
    assert.deepEqual(allProblems(sc, records, { expectFrame: 1, expectTimer: 3 }), []);
  });

  // ---------------------------------------------------------------- NO_ANIM

  for (const caller of ['turn', 'blocked']) {
    test(`NO_ANIM (${streamed ? 'streamed' : 'ordinary'}, via ${caller === 'turn' ? 'Turn' : 'a blocked Move'}): a facing with no animation draws nothing and the clamp writes nothing`, boots, async () => {
      const sc = await sceneRom(`noanim:${caller}:${streamed}`, sceneFor(caller, streamed, { upNoAnim: true }));
      // the byte a `cmp anim_count,$FF` clamp would compare with: poke the frame just above it
      const { mem: probe } = bootRom(sc.rom, { streamed });
      const stray = probe[sc.syms.anim_count + 0xff];
      assert.ok(stray < 255, 'the ROM byte at anim_count+$FF must leave room for a frame above it');
      const { records } = drive(sc, { frame: stray + 1, timer: 3, frames: 4 });
      for (const r of records) {
        assert.deepEqual([r.dir, r.frame, r.timer], [DIR_UP, stray + 1, 3], `frame ${r.i}: nothing may be written for a NO_ANIM facing`);
      }
      // ...and the whole shadow says so: no actor tile anywhere, every unused slot parked
      assert.deepEqual(allProblems(sc, records, { expectFrame: stray + 1, expectTimer: 3 }), []);
    });
  }
}

// ------------------------------------------------------------------ the player is not the clamp's business

/**
 * Every entity slot's dir/frame/timer, inactive slots included, gets a distinguishable non-zero sentinel,
 * so a write to ANY slot (a zeroing clamp, a wrong index) shows. Slot 0 is the NPC: facing up, holding
 * frame 1 of a one-frame animation with the timer at 3 -- exactly what the clamp would rewrite.
 */
function seedSentinels({ mem }) {
  for (let slot = 0; slot < MAX_ENTITIES; slot++) {
    mem[ENT_DIR + slot] = slot === 0 ? DIR_UP : 0xa0 + slot;
    mem[ENT_FRAME + slot] = slot === 0 ? 1 : 0xb0 + slot;
    mem[ENT_TIMER + slot] = slot === 0 ? 3 : 0xc0 + slot;
  }
}

for (const streamed of [false, true]) {
  for (const [name, command] of [
    ['Turn', { op: 'turn', who: 'player', dir: 'up' }],
    ['Move', { op: 'move', who: 'player', dir: 'up', dist: 16 }]
  ]) {
    test(`player ${name} (${streamed ? 'streamed' : 'ordinary'}): every entity slot's dir, frame and timer equal a no-op control's, though the resolved animation would be out of range`, boots, async () => {
      const say = { op: 'say', text: 'Hi' };
      const sc = await sceneRom(`player-${name}:${streamed}`, { streamed, commands: [command, say] });
      // the control: the same scene, the same seeds, the same Say -- and no player command at all
      const control = await sceneRom(`player-control:${streamed}`, { streamed, commands: [say] });
      const run = (scene) => {
        const out = drive(scene, { dir: DIR_UP, frame: 1, timer: 3, say: true, before: (ctx) => { seedSentinels(ctx); assert.equal(ctx.mem[PLAYER_DIR], DIR_DOWN); } });
        assertSayCompleted(out, `player ${name} scene`);
        return out;
      };
      const now = run(sc);
      const was = run(control);
      // the command really ran: the player turned up (and, for a Move, walked up)
      assert.equal(now.mem[PLAYER_DIR], DIR_UP, 'the command must have run (the player turned)');
      assert.equal(was.mem[PLAYER_DIR], DIR_DOWN, 'the control must not have turned the player');
      const atEnd = (out) => out.records.find((r) => r.box === BOX_ENDWAIT);
      if (name === 'Move') assert.ok(atEnd(now).py < atEnd(was).py, 'the player must have walked');
      // the world is frozen for the whole event, so the arrays at the Say's end-wait are the arrays it started with
      assert.deepEqual(atEnd(now).ents, atEnd(was).ents);
      const seeded = atEnd(now).ents;
      assert.deepEqual([seeded.dir[0], seeded.frame[0], seeded.timer[0]], [DIR_UP, 1, 3]);
      assert.deepEqual([seeded.dir[1], seeded.frame[1], seeded.timer[1]], [0xa1, 0xb1, 0xc1], 'an inactive slot keeps its sentinel');
      for (const r of now.records.filter((x) => !x.final)) assert.deepEqual(r.ents, was.records[0].ents, `frame ${r.i}: no slot may change while the world is frozen`);
    });
  }
}

// ------------------------------------------------------------------ guard paths are exactly the shipped ones

/** RAM outside the stack page (return addresses legitimately move with code): $000-$0FF and $200-$7FF. */
const ramWithoutStack = (mem) => [...mem.slice(0, 0x100), ...mem.slice(0x200, 0x800)];

for (const streamed of [false, true]) {
  const where = streamed ? 'streamed' : 'ordinary';

  test(`guard path (${where}): a zero-distance Move never reaches move_face, and RAM equals the shipped engine's`, { ...boots, skip: boots.skip || needsShipped() }, async () => {
    const opts = { streamed, commands: [{ op: 'move', who: 'self', dir: 'up', dist: 0 }, { op: 'say', text: 'Hi' }] };
    const run = async (shipped) => drive(await sceneRom(`zero:${streamed}`, opts, { shipped }), { dir: DIR_UP, frame: 1, timer: 3, frames: 8 });
    const now = await run(false);
    const was = await run(true);
    // a move_face call would have reset the out-of-range frame 1 of the one-frame `up` animation
    assert.deepEqual([now.mem[ENT_DIR], now.mem[ENT_FRAME], now.mem[ENT_TIMER]], [DIR_UP, 1, 3]);
    assert.equal(now.records[0].gs, ST_DIALOG, 'the event must have run (the Say opened)');
    assert.deepEqual(ramWithoutStack(now.mem), ramWithoutStack(was.mem));
  });

  test(`guard path (${where}): a Turn with nobody to be (talk_ent = NO_ENTITY) exits as the shipped engine does, writing nothing`, { ...boots, skip: boots.skip || needsShipped() }, async () => {
    const opts = { streamed, commands: [{ op: 'say', text: 'Hi' }, { op: 'turn', who: 'self', dir: 'up' }, { op: 'say', text: 'Bye' }] };
    const run = async (shipped) => {
      const sc = await sceneRom(`nobody:${streamed}`, opts, { shipped });
      const out = drive(sc, { dir: DIR_DOWN, frame: 1, timer: 3, frames: 40 });
      const { nes, mem } = out;
      assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the first Say must be waiting for confirm');
      mem[TALK_ENT] = NO_ENTITY;
      nes.buttonDown(1, BUTTON.A);
      nes.frame();
      nes.buttonUp(1, BUTTON.A);
      for (let i = 0; i < 20; i++) nes.frame();
      return out;
    };
    const now = await run(false);
    const was = await run(true);
    // (the event ends, so the world runs again and the timer legitimately counts on; the frame does not move)
    assert.deepEqual([now.mem[ENT_DIR], now.mem[ENT_FRAME]], [DIR_DOWN, 1], 'the guarded Turn must write no slot');
    assert.deepEqual(ramWithoutStack(now.mem), ramWithoutStack(was.mem));
  });
}
