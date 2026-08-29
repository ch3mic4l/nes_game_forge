// Screen Shake: item 6's second slice. [OP_SHAKE, frames], the same instant,
// non-suspending shape OP_TURN already has -- the world keeps running while
// the screen shakes, which is why the counter has to tick in NMI rather than
// the frozen-world tick ui_tick runs (see the ticking test below for why that
// matters, not just that it is so).
//
// Everything builds its own project rather than touching `sample/`, which is
// a checked-in fixture.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { compileText, opIndex } from '../../main/build/textcompile.js';
import { createProject, normalizeProject, projectUsesShake } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));
const hasRpgRom = fs.existsSync(path.join(SAMPLE_RPG, 'build/game.nes'));

// Engine RAM. shake_left is a computed expression in engine/constants.asm
// (`shake_left = wt_left+1`), not a plain literal, so it cannot be read back
// by shared/enginesyms.js's parseEquates -- confirmed at $9B by tracing
// wt_left ($9A, already confirmed the same way by turnwait.test.js) one byte
// further along the same chain, and by observing it actually count down at
// this address in the runs below.
const GAME_STATE = 0x25;
const SHAKE_LEFT = 0x9b;
const FRAME_CNT = 0x1b;
const BOX_STATE = 0x40;
const BOX_ENDWAIT = 6; // engine/text.asm's BOX_ENDWAIT -- the message is over, confirm resumes the script

const ST_GAMEPLAY = 0;
const A = 0;
const B = 1;

const START_X = 112;
const START_Y = 112;
const NPC = 4; // appended by buildWith, after the sample's four actors

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

/** Run until the conversation is over, or give up and say so. */
function settle(nes, frames = 400) {
  for (let i = 0; i < frames; i++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    nes.frame();
  }
  return false;
}

/**
 * The PPU's own live background X scroll, composed from the three internal
 * fields the vendored core actually stores a $2005/$2000 write into --
 * regH (PPUCTRL bit 0, the 9th bit), regHT (coarse X, 0-31) and regFH (fine
 * X, 0-7) -- rather than a debug byte this engine writes for the test's
 * benefit. Reading real emulator state here is what actually proves
 * nmi_scroll composed the 9-bit coordinate correctly, the same reason the
 * PPUCTRL-bit-0 composition is the whole point of the bug this file guards.
 */
const scrollX = (nes) => nes.ppu.regH * 256 + nes.ppu.regHT * 8 + nes.ppu.regFH;

/** The PPU's own live background Y scroll, composed the same way scrollX is. */
const scrollY = (nes) => nes.ppu.regV * 240 + nes.ppu.regVT * 8 + nes.ppu.regFV;

/**
 * The PPUMASK byte actually in effect, reconstructed from the same fields
 * the vendored core's own $2001 write handler (updateControlReg2) sets --
 * real emulator state, not a value this engine writes for the test's
 * benefit. Rejected variant (e) would have shown $1C here (bit 1 cleared,
 * clipping the BG left column) while a shake was running.
 */
const ppuMask = (nes) =>
  nes.ppu.f_dispType |
  (nes.ppu.f_bgClipping << 1) |
  (nes.ppu.f_spClipping << 2) |
  (nes.ppu.f_bgVisibility << 3) |
  (nes.ppu.f_spVisibility << 4) |
  (nes.ppu.f_color << 5);

/**
 * A one-screen project with one talkable actor carrying `commands`, 16px
 * above the player's own start position -- the identical placement
 * turnwait.test.js's own buildWith uses.
 */
async function buildWith(t, commands, tweak = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-shake-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const slime = project.sprites.actors[0];
  project.sprites.actors.push({ ...structuredClone(slime), id: NPC, name: 'Walker', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: NPC,
      x: START_X,
      y: START_Y - 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    }
  ];
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, dir, romPath: built.romPath, nes: boot(built.romPath) };
}

// --------------------------------------------------------------- the wire

test('a Shake compiles to its opcode plus one frame-count byte', () => {
  // Pinned against the literal in engine/constants.asm (OP_SHAKE = $16),
  // not just opIndex('shake') read back from the same table the assertion
  // below also reads its expected byte from -- reordering EVENT_COMMANDS
  // and updating OP_* in lockstep would stay green forever without this.
  assert.equal(opIndex('shake'), 0x16, "opIndex('shake') must match engine/constants.asm's OP_SHAKE literally, not just internally");
  const project = normalizeProject({
    ...createProject('Shake wire'),
    commonEvents: [
      { id: 0, name: 'Rumble', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 45 }] }] } }
    ]
  });
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(opIndex('shake'));
  assert.ok(at >= 0, 'the compiled events should contain an OP_SHAKE');
  assert.deepEqual(bytes.slice(at, at + 2), [opIndex('shake'), 45], 'a Shake is exactly two bytes -- opcode and frame count');
});

// ------------------------------------------------------------- the engine

test('a Shake does not suspend the event -- the next command runs the same frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'shake', frames: 10 },
    { op: 'setSwitch', switch: 5 }
  ]);
  tap(nes, B, 0); // talk: the page runs Shake then the next command, all before this frame ends
  const on = (n) => Boolean(nes.cpu.mem[0x390 + (n >> 3)] & (1 << (n & 7)));
  assert.equal(on(5), true, 'the command after Shake must already have run -- Shake does not suspend the event');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'with nothing left to suspend on, the conversation ends the same frame it started');
});

test('every active frame of a Shake displaces the background by exactly 2 pixels, alternating sides', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [{ op: 'shake', frames: 3 }]);
  tap(nes, B, 0);
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 3, 'shake_left is set the instant Shake runs, before any NMI has ticked it');
  assert.equal(scrollX(nes), 0, 'and nothing has moved yet -- the trigger frame itself is not a shaken frame');

  // Y and PPUMASK are checked on every frame below, not just once: a wrong
  // implementation writing a nonzero Y (a vertical component alongside the
  // correct X) or manipulating PPUMASK the way rejected option (e) would
  // have (clipping the BG left column while shaking) would only show up on
  // an active frame, not the settled ones either side of it.
  assert.equal(scrollY(nes), 0, 'Y must stay 0 -- this shake is horizontal only');
  assert.equal(ppuMask(nes), 0x1e, 'PPUMASK must stay PPUMASK_ON -- rejected option (e) is not what shipped');

  run(nes, 1);
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 2);
  assert.equal(scrollX(nes), 2, 'the first active frame is +2, deterministically -- see the duration-1 test for why');
  assert.equal(scrollY(nes), 0, 'Y must stay 0 on an active frame too');
  assert.equal(ppuMask(nes), 0x1e, 'PPUMASK must stay PPUMASK_ON on an active frame too');

  run(nes, 1);
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 1);
  assert.equal(scrollX(nes), 510, 'the second active frame is the 9-bit wrapped -2 (PPUCTRL bit 0 set, $2005=$FE), not a positive 254');
  assert.equal(scrollY(nes), 0, 'Y must stay 0 on the wrapped -2 frame too');
  assert.equal(ppuMask(nes), 0x1e, 'PPUMASK must stay PPUMASK_ON on the wrapped -2 frame too');

  run(nes, 1);
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 0);
  assert.equal(scrollX(nes), 2, 'the third and last active frame alternates back to +2');

  run(nes, 1);
  assert.equal(scrollX(nes), 0, 'once shake_left reaches 0, the very next frame returns the scroll to exactly 0 -- no residual offset');
  assert.equal(scrollY(nes), 0);
  assert.equal(ppuMask(nes), 0x1e);
});

// Review finding: every assertion above happens with the box fully closed --
// none of them prove the decided "Shake shakes everything including the
// message box, no box_state gating" behaviour, so an implementation that
// silently suppressed the offset (while still decrementing shake_left, the
// specific bad shape the review called out) would pass every test in this
// file up to here. Say does not suspend past its own dismissal the way Wait
// does, so a second Say after the Shake is what keeps the box up long
// enough to observe: dismissing the first message runs straight into Shake
// (does not suspend) and then straight into the second Say, which finds
// box_state already non-zero and wipes the frame in place (box_begin_clear)
// rather than closing it -- box_state cycles CLEARING/TYPING/ENDWAIT but
// never drops to 0 (closed) for the whole exchange, traced directly against
// a real build before writing this down.
//
// Round 3 review finding: a 10-frame shake is not long enough. Traced
// directly: with frames=10, box_state does not return to BOX_ENDWAIT until 7
// frames after the dismiss, by which point shake_left is already down to 1
// and reaches 0 the very next frame -- so nothing here ever checked
// displacement at BOX_ENDWAIT itself, only at CLEARING/TYPING in between. An
// implementation that suppressed the offset specifically when
// box_state == BOX_ENDWAIT (leaving CLEARING/TYPING alone) would have passed
// every assertion below unchanged, which is exactly backwards: BOX_ENDWAIT
// -- a finished message sitting there waiting for input -- is the case the
// "no box gating" decision most needs to hold for, since it is the state a
// player actually spends time looking at. Fixed with a 200-frame shake,
// comfortably longer than the 7-frame trip back to the second BOX_ENDWAIT,
// and an explicit check of shake_left and displacement at that exact state.
test('a Shake displaces the background while a message box is still open, including through it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'say', text: 'Hi.' },
    { op: 'shake', frames: 200 },
    { op: 'say', text: 'Bye.' }
  ]);
  tap(nes, B);
  for (let i = 0; i < 400 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the first message should have finished typing and be waiting to be dismissed');

  tap(nes, A); // dismiss: script_resume runs Shake (arms it), then the second Say (reopens the box) -- all this same frame
  assert.notEqual(nes.cpu.mem[BOX_STATE], 0, 'the box must still be open -- reused for the second message, not closed');
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 198, 'the shake should already be counting down (tap()\'s 3 frames -- button-down plus 2 follow-on)');
  assert.notEqual(scrollX(nes), 0, 'and it must actually be displacing the background on this very frame, box open or not');

  run(nes, 4);
  assert.notEqual(nes.cpu.mem[BOX_STATE], 0, 'the box is still open partway through the shake, retyping the second message');
  assert.notEqual(scrollX(nes), 0, 'the shake is still running and still displacing the background through it');

  for (let i = 0; i < 400 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the second message should also finish typing and wait to be dismissed');
  // One more frame before checking scrollX: box_state is a CPU-side value
  // text_tick sets during the main loop, read here immediately after it
  // settles, but nmi_scroll's own read of box_state happens inside the NMI
  // that already ran *before* this frame's main-loop code -- so the shake
  // calculation for the very frame box_state first reads BOX_ENDWAIT was
  // still computed against the *previous* state. Confirmed directly: without
  // this extra frame, a real box_state==BOX_ENDWAIT-only suppression bug
  // passed here by accident, one frame ahead of where nmi_scroll actually
  // caught up.
  run(nes, 1);
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'still at BOX_ENDWAIT one frame later -- this is not a page turn in disguise');
  // The assertion this test exists for: displacement at BOX_ENDWAIT itself,
  // not merely somewhere during CLEARING/TYPING -- and shake_left still
  // comfortably nonzero, so this is a real mid-shake sample, not one that
  // happened to land on the shake's own last frame by chance.
  assert.ok(nes.cpu.mem[SHAKE_LEFT] > 100, `shake_left is ${nes.cpu.mem[SHAKE_LEFT]} -- too low for this to prove displacement at a genuinely mid-shake BOX_ENDWAIT`);
  assert.notEqual(scrollX(nes), 0, 'the shake must still be displacing the background with the box back at BOX_ENDWAIT, not suppressed there specifically');
  tap(nes, A);
  assert.ok(settle(nes, 400), 'the conversation ends normally as soon as both messages are dismissed -- Shake never suspends the script, so the box closes with well over 100 shake frames still running independently');
});

// The parity bug review found: deriving the sign from the wall clock
// (frame_cnt) rather than the effect's own remaining-frame count means a
// short Shake's displacement depends on when it happened to be triggered,
// not just how long it runs. Note this is not "sometimes shows literally
// zero" for this variant -- every active frame shows +2 or -2, there is no
// zero phase (see the previous test) -- so the property worth pinning is
// determinism, not merely non-zero: a duration-1 Shake's one active frame
// must show the identical displacement every time, regardless of when the
// wall clock says it happened. Confirmed this is the real, provable
// difference by first reproducing the frame_cnt-driven version by hand: it
// passes a bare "shows some nonzero displacement" check on every one of
// these idle counts (every active frame is nonzero in this variant
// regardless of which clock drives the sign), and only an equality check
// against every other run actually catches it -- it alternates 2, 510, 2,
// 510... as the idle count (and so frame_cnt's parity at trigger) changes.
test('a duration-1 Shake always displaces the background the same way, regardless of frame_cnt parity when it was triggered', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const displacements = [];
  for (const idleFrames of [0, 1, 2, 3, 4, 5]) {
    const { nes } = await buildWith(t, [{ op: 'shake', frames: 1 }]);
    run(nes, idleFrames);
    const parityAtTrigger = nes.cpu.mem[FRAME_CNT] & 1;
    tap(nes, B, 0);
    assert.equal(scrollX(nes), 0, `idle=${idleFrames}: the trigger frame itself shows nothing yet`);
    run(nes, 1);
    displacements.push({ idleFrames, parityAtTrigger, scrollX: scrollX(nes) });
    run(nes, 1);
    assert.equal(scrollX(nes), 0, `idle=${idleFrames}: and it is over after exactly one displaced frame`);
  }
  // Review finding: the equality check above only proves something if the
  // six idle counts actually landed on both frame_cnt parities -- otherwise
  // it would stay green even against the frame_cnt-driven bug this test
  // exists to catch, for the uninteresting reason that every run happened to
  // share one parity. idleFrames 0..5 are six consecutive integers, so they
  // cannot all share a parity, but the harness's own boot()/tap() framing
  // could in principle shift which absolute frame_cnt each one lands on --
  // asserted directly rather than trusted from the loop's own shape.
  const parities = new Set(displacements.map((d) => d.parityAtTrigger));
  assert.equal(
    parities.size,
    2,
    'this test only proves determinism if both frame_cnt parities were actually exercised at trigger time: got ' +
      JSON.stringify(displacements)
  );

  const distinct = new Set(displacements.map((d) => d.scrollX));
  assert.equal(
    distinct.size,
    1,
    'a duration-1 Shake must show the same displacement every time, independent of frame_cnt: got ' + JSON.stringify(displacements)
  );
});

// Review finding: script_op_shake used to store its operand unconditionally,
// so a later Shake 0 -- in the same event or a different one entirely --
// would stomp shake_left to 0 and silently cancel whatever Shake was already
// running. Every other command in this engine treats a zero operand as
// "nothing happens" (Wait 0 does not suspend, Heal 0/Damage 0 do nothing),
// and the event editor's own hint already promised the same for Shake, so
// this is the test that pins the fix: a zero-frame Shake must be a true
// no-op, not a way to cancel one already in flight.
test('a Shake of 0 does not cancel a Shake already running', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'shake', frames: 30 },
    { op: 'shake', frames: 0 },
    { op: 'setSwitch', switch: 5 }
  ]);
  tap(nes, B, 0); // talk: both Shakes and the switch all run this same frame, none suspend
  const on = (n) => Boolean(nes.cpu.mem[0x390 + (n >> 3)] & (1 << (n & 7)));
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 30, 'the Shake 0 right after it must not have touched shake_left at all');
  assert.equal(on(5), true, 'and the command after it still ran -- Shake 0 does not suspend either');

  run(nes, 1);
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 29, 'the original 30-frame shake keeps counting down normally');
  assert.notEqual(scrollX(nes), 0, 'and is still actually displacing the background');
});

test('a Shake still running survives a screen it left, but not the redraw a Warp gives it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'shake', frames: 30 },
    { op: 'warp', screen: 0, x: START_X, y: START_Y }
  ]);
  tap(nes, B, 0); // talk: Shake arms 30 frames, then the Warp fires -- both instant, same frame
  // The Warp does not suspend either (script_op_warp goes straight to
  // script_finish), and for an interact-triggered event dispatch_input runs
  // before main_loop's own warp_ready check -- so take_door's redraw, and the
  // vram_reset clear inside it, happen this same frame, before any NMI has
  // had a chance to tick shake_left even once.
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 0, 'the redraw must clear the stale shake before the new screen is ever shown');
  run(nes, 5);
  assert.equal(scrollX(nes), 0, 'and it must stay at 0 -- nothing left to resume, unlike a suspended Move or Wait');
});

// Review finding: Warp was the only transition this file drove, which leaves
// redraw_screen's OTHER caller of vram_reset -- crossing a screen edge from
// inside update_player, never through take_door at all -- completely
// unexercised. An implementation that moved the clear out of vram_reset and
// into take_door alone would pass every assertion above while a shake
// survived straight through a walked edge.
test('a Shake still running does not survive walking across a screen edge', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(
    t,
    [{ op: 'shake', frames: 200 }], // comfortably longer than the ~65-frame walk to the edge below
    (project) => {
      // The neighbouring screen sample's own 2x2 grid already places to the
      // right of screen 0 -- wiped open the same way buildWith already wipes
      // screen 0, so the walk is about the edge crossing, not pathfinding.
      project.maps[0].screens[1].metatiles = new Array(240).fill(0);
    }
  );
  tap(nes, B, 0); // talk: Shake arms 200 frames
  run(nes, 1);
  assert.notEqual(scrollX(nes), 0, 'the shake should already be displacing the background before the walk starts');

  // Review finding: capping the walk loop at 90 iterations and then
  // asserting `walked < 150` cannot ever fail -- walked is bounded by the
  // loop's own condition, so that assertion proved nothing. Fixed by
  // recording shake_left on the last frame *before* the crossing actually
  // happens (updated every iteration, so its final value is whatever
  // shake_left was immediately prior to the frame that flips FLAT_SCREEN)
  // and asserting real margin remained -- 135 measured directly on a real
  // build, comfortably above 0 and nowhere near natural expiry.
  const FLAT_SCREEN = 0x16;
  const RIGHT = 7;
  let walked = 0;
  let shakeLeftBeforeCross = nes.cpu.mem[SHAKE_LEFT];
  nes.buttonDown(1, RIGHT);
  for (; walked < 90 && nes.cpu.mem[FLAT_SCREEN] === 0; walked++) {
    shakeLeftBeforeCross = nes.cpu.mem[SHAKE_LEFT];
    nes.frame();
  }
  nes.buttonUp(1, RIGHT);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the walk should have crossed onto the neighbouring screen');
  assert.ok(
    shakeLeftBeforeCross > 100,
    `shake_left was ${shakeLeftBeforeCross} immediately before the crossing frame -- too low to rule out natural expiry explaining the clear rather than the fix`
  );
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 0, 'redraw_screen -- reached from update_player, never from take_door -- must have cleared the stale shake');
  run(nes, 5);
  assert.equal(scrollX(nes), 0, 'and the new screen must not be shaking either');
});

// Review finding, continued: draw_battle_screen (entry) and battle_end's own
// return to redraw_screen (exit) are two more callers of vram_reset that
// were never driven either. Built on sample-rpg (only an RPG has a battle
// bank at all) -- an entry-triggered NPC arms a long Shake at boot, purely
// so it is already running by the time the player reaches the sample's own
// stationary Slime, the same touch-encounter setup test/unit/rpg.test.js
// itself uses.
//
// The clear does not land on the very frame game_state becomes ST_BATTLE:
// traced directly against a real build, game_state flips first and
// draw_battle_screen's own redraw -- which is what actually reaches
// vram_reset -- runs on the battle bank's first tick after that, one frame
// later. Checked two frames in, past that boundary with margin.
//
// Exit gets no independently meaningful assertion, and this says so rather
// than pretending otherwise: nothing can arm a *new* Shake while ST_BATTLE
// (script commands only ever run from the field's own script engine), and
// entry has already zeroed shake_left long before the fight ends, so there
// is no way to have one still counting down at the exact moment battle_end
// redraws the field. What this test still proves for exit is real, just
// narrower: the same redraw_screen call battle_end reaches for real, on a
// real emulated CPU, does not somehow leave the field shaking on the way
// back -- which is exactly what would break if the fix depended on
// take_door specifically rather than living in vram_reset itself.
test('a Shake running before a battle is cleared entering it, and stays cleared leaving it', {
  skip: !hasRpgRom && 'run `npm run sample:rpg && npm run build:sample:rpg` first'
}, async (t) => {
  const GAME_STATE = 0x25;
  const PLAYER_X = 0x10;
  const PLAYER_Y = 0x11;
  const BT_SEL = 0x55;
  const ST_GAMEPLAY = 0;
  const ST_BATTLE = 5;
  const RIGHT = 7;
  const DOWN = 5;
  const A = 0;
  const BC_FIGHT = 0;

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-shake-battle-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.maps[0].encounters = { rate: 0, actorIds: [] }; // only the placed Slime should start a fight
  const template = project.sprites.actors[0];
  const shakerId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(template), id: shakerId, name: 'Shaker', behavior: 'npc' });
  project.maps[0].screens[0].entities.push({
    actorId: shakerId,
    x: 16,
    y: 16,
    props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 200 }] }] } }
  });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = boot(built.romPath, 40);

  assert.notEqual(scrollX(nes), 0, 'the entry-triggered shake should already be running by the end of boot');

  // Review finding: checking scrollX at boot only proves the shake was
  // running when the ROM started, not that it still had real time left
  // immediately before the battle began -- the walk to the Slime could in
  // principle take long enough to run it out on its own. Fixed the same way
  // as the crossing test: shake_left recorded on every frame of the walk and
  // the settle-into-ST_BATTLE wait, so its final value is whatever shake_left
  // was immediately before the frame that actually enters battle. 135
  // measured directly on a real build.
  let shakeLeftBeforeBattle = nes.cpu.mem[SHAKE_LEFT];

  // The sample-rpg fixture places its Slime in the bottom-right corner --
  // the identical walk test/unit/rpg.test.js's own touch-encounter test uses.
  for (let step = 0; step < 400 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const buttons = [];
    if (nes.cpu.mem[PLAYER_X] < 168) buttons.push(RIGHT);
    if (nes.cpu.mem[PLAYER_Y] < 168) buttons.push(DOWN);
    if (!buttons.length) break;
    shakeLeftBeforeBattle = nes.cpu.mem[SHAKE_LEFT];
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) {
    shakeLeftBeforeBattle = nes.cpu.mem[SHAKE_LEFT];
    nes.frame();
  }
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the Slime did not start a fight');
  assert.ok(
    shakeLeftBeforeBattle > 100,
    `shake_left was ${shakeLeftBeforeBattle} immediately before entering battle -- too low to rule out natural expiry explaining the clear rather than the fix`
  );

  run(nes, 2); // past draw_battle_screen's own one-tick-later redraw
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 0, 'draw_battle_screen must have cleared the shake that was running on the field');
  assert.equal(scrollX(nes), 0, 'and the battle screen itself must not be shaking');

  const tap = (nes, button, frames = 12) => {
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
    for (let i = 0; i < frames; i++) nes.frame();
  };
  for (let i = 0; i < 8 && nes.cpu.mem[BT_SEL] !== BC_FIGHT; i++) tap(nes, DOWN, 4);
  tap(nes, A, 20);
  for (let i = 0; i < 80 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the fight should have ended and returned to the field');
  assert.equal(nes.cpu.mem[SHAKE_LEFT], 0, 'nothing on the way back should have reintroduced a shake');
  run(nes, 5);
  assert.equal(scrollX(nes), 0, 'and the field is not shaking either, once back');
});

// ------------------------------------------------- what a project pays for it

test('a switched-off Shake costs a project nothing — not one byte of ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const withOff = await buildWith(t, [
    { op: 'shake', frames: 10, off: true },
    { op: 'setSwitch', switch: 5 }
  ]);
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);

  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a disabled Shake must leave the ROM identical to one with no Shake at all'
  );
});

test('projectUsesShake ignores a command the compiler would drop', () => {
  const project = createProject('Predicate');
  const pages = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'shake', frames: 30 }]) }];
  assert.equal(projectUsesShake(project), true, 'a live Shake counts');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'shake', frames: 30, off: true }]) }];
  assert.equal(projectUsesShake(project), false, 'a switched-off one does not');

  // Inside a branch, the same place usedSwitches once failed to look.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        {
          op: 'branch',
          cond: { type: 'none', arg: 0 },
          then: [{ op: 'shake', frames: 5 }],
          else: []
        }
      ])
    }
  ];
  assert.equal(projectUsesShake(project), true, 'a Shake nested inside a branch still counts');

  // And inside a Choice option -- turnwait.test.js's own review found this is
  // the one place a hand-rolled walk that only knew about then/else would
  // still miss it, even though liveCommands (shared/eventrules.js) already
  // recurses into choice.options[].
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([{ op: 'choice', options: [{ text: 'Go', commands: [{ op: 'shake', frames: 5 }] }, { text: 'No', commands: [] }] }])
    }
  ];
  assert.equal(projectUsesShake(project), true, 'a Shake inside a Choice option still counts');
});
