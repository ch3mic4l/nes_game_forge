// Large streamed worlds (ROADMAP item 15), phase 3b slice S3, commit C1 fix 1: the BEHAVIOUR of the horizontal ring's far branch.
//
// engine/player.asm's cross_left_cut tail carries `bne ring_far1` / `jmp cross_none` under .if STREAM_RING (a plain `beq cross_none` is out of range
// on a horizontal-camera ring). That arm is assembled into every build of the project, but it runs on an ORDINARY screen of a mixed project: a streamed
// screen's own edge is crossed inside sw_pstep_left (the comment above cross_left). Its flags are cross_left's `cmp #NO_SCREEN`, so the branch must
// fall through to the transition exactly when the left neighbour EXISTS and jump to cross_none exactly when there is none. streamringh.test.js only
// proves the far branch assembles; an inverted condition (`beq ring_far1`) passes every other horizontal test, which all walk streamed screens
// ('h-far-branch-inverted' in test/lib/ringbypass.js).
//
// The project is the S2 "mixed" shape (an ordinary 2 x 2 map, the horizontal streamed world, an ordinary 2 x 2 map) built through the bypass tree.
// The player boots on the first ordinary map's screen 0, which has NO left neighbour and a right neighbour, screen 1:
//   1. holding LEFT on screen 0 (no neighbour) is blocked: still screen 0, standing at x = 0, the game state unchanged;
//   2. holding RIGHT crosses to screen 1;
//   3. holding LEFT on screen 1 (a left neighbour exists) crosses back to screen 0 and puts the player at MAX_X.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import NES from '../../renderer/emulator/core/nes.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { makeBypassTree, loadBypassTree, buildThrough } from '../lib/ringbypass.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
const BOARDS = process.env.FORGE_RING_SABOTAGE ? [4] : [1, 4, 30];
// from engine/constants.asm
const PLAYER_X = 0x10;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const ST_GAMEPLAY = 0;
const MAX_X = 240; // engine/constants.asm: 256 - 16
const BTN = { LEFT: 6, RIGHT: 7 };

/** Holds `button` for up to `maxFrames`, stopping early once flat_screen leaves `from`; returns the frames spent. */
function hold(nes, button, { from = null, maxFrames = 200 } = {}) {
  const mem = () => nes.cpu.mem;
  nes.buttonDown(1, button);
  let frames = 0;
  while (frames < maxFrames && (from === null || mem()[FLAT_SCREEN] === from)) {
    nes.frame();
    frames++;
  }
  nes.buttonUp(1, button);
  for (let i = 0; i < 20; i++) nes.frame(); // let a crossing finish before the next input
  return frames;
}

for (const id of BOARDS) {
  test(`${resolveMapper(id).name} horizontal ring, mixed project: an ordinary screen's left crossing goes through when a left neighbour exists and is blocked when none does`, { skip }, async (t) => {
    const tree = makeBypassTree(); // the active FORGE_RING_SABOTAGE (if any) applies: 'h-far-branch-inverted' reverses the branch under test
    t.after(() => tree.dispose());
    const loaded = await loadBypassTree(tree);
    const project = createStreamedProject({ mapper: id, mirroring: 'horizontal', gridW: 1, gridH: 4, camera: true, mixed: true });
    const built = await buildThrough(loaded, project);
    t.after(() => fs.rmSync(built.dir, { recursive: true, force: true }));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    for (let i = 0; i < 30; i++) nes.frame();
    const m = () => nes.cpu.mem;
    assert.equal(m()[GAME_STATE], ST_GAMEPLAY, 'booted into gameplay');
    assert.equal(m()[FLAT_SCREEN], 0, 'boot lands on the first ordinary map, screen 0');

    // 1. no left neighbour: the wall path, not a transition
    hold(nes, BTN.LEFT);
    assert.equal(m()[FLAT_SCREEN], 0, 'screen 0 has no left neighbour: holding LEFT must not change screen');
    assert.equal(m()[PLAYER_X], 0, 'the player is held against the left edge');
    assert.equal(m()[GAME_STATE], ST_GAMEPLAY);

    // 2. onto screen 1 (its right neighbour)
    const toRight = hold(nes, BTN.RIGHT, { from: 0 });
    assert.ok(toRight < 200, 'holding RIGHT must cross to screen 1');
    assert.equal(m()[FLAT_SCREEN], 1);

    // 3. a left neighbour exists: the transition
    const toLeft = hold(nes, BTN.LEFT, { from: 1 });
    assert.ok(toLeft < 200, 'screen 1 has a left neighbour: holding LEFT must cross back');
    assert.equal(m()[FLAT_SCREEN], 0, 'the left crossing lands on screen 0');
    assert.equal(m()[PLAYER_X], MAX_X, 'arriving from the right, the player stands at MAX_X');
  });
}
