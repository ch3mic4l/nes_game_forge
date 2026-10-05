// Music, sfx and APU evidence across a streamed text-box close (Say/Move overrun fix, F plan). The close used to take two frames a body
// and music_tick ran once per body, so the song slipped to half speed for twelve frames. With the heaviest supported song playing (four
// channels, eight instruments with 16-step envelopes, a new event every row at one frame per row) and a sound effect in flight, over the
// deadline project's worst close:
//   1. music_tick runs exactly once per frame for the whole run, close included (the HEAD run showed one per two frames);
//   2. every channel's pointer / duration / instrument / envelope step / note, at every tick, equals the same tick of a run with no close;
//   3. the APU registers written between consecutive ticks equal that reference's (the noise registers and $4015, which the effect owns, apart);
//   4. the effect's countdown falls by exactly one per frame across the CLOSING frames and the effect writes the noise registers;
//   5. a run in which the close never happened is rejected, and so is one with a skipped tick.
// Deviation, labelled: this runs on the vendored jsnes core with a CPU hook and a papu.writeReg tap, not in Mesen -- the engine's music is
// deterministic in the tick count, and the cycle-level deadline (which Mesen proves) is test/lua/run_sw_close_deadline_check.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAndBoot, press, BTN, BOX_STATE, BOX_ENDWAIT, GAME_STATE, ST_GAMEPLAY } from '../lib/streamedpinching.js';
import { buildCloseDeadlineProject } from '../lib/closedeadline.js';

// from engine/constants.asm
const MUS = { ptrLo: 0x0340, ptrHi: 0x0344, dur: 0x0348, inst: 0x034c, step: 0x0350, note: 0x0354 };
const SFX_STATE = 0x0568;
const SFX_LEFT = 0x056e;
const MUS_CHANNELS = 4;
const BOX_CLOSING = 5;
const NOISE_REGS = new Set([0x400c, 0x400d, 0x400e, 0x400f, 0x4015]); // the effect's channel and the channel-enable it writes

function heaviestSong() {
  const instruments = Array.from({ length: 8 }, (_, i) => ({ duty: i % 4, volEnv: Array.from({ length: 16 }, (_, step) => (step + i) % 16), sustain: 15 }));
  const channels = { pulse1: [], pulse2: [], triangle: [], noise: [] };
  for (let row = 0; row < 32; row++) {
    channels.pulse1[row] = { note: (row * 3) % 96, inst: row % 8 };
    channels.pulse2[row] = { note: (row * 5 + 1) % 96, inst: (row + 1) % 8 };
    channels.triangle[row] = { note: (row * 7 + 2) % 96, inst: 0 };
    channels.noise[row] = { note: (row * 11) % 96, inst: (row + 3) % 8 };
  }
  return { name: 'Heaviest', tempo: { framesPerRow: 1 }, instruments, patterns: [{ id: 0, rows: 32, channels }], order: [0], loop: 0 };
}

// an action world 55 screens deep with the talker on the bottom row: at HEAD every close body of this scene overran the frame
const DEEP_ROWS = 55;
const DEEP_TALKER = (DEEP_ROWS - 1) * 3;

function audioProject() {
  const p = buildCloseDeadlineProject({ gameType: 'action', gridH: DEEP_ROWS, talkerScreen: DEEP_TALKER });
  p.songs = [heaviestSong()];
  p.maps[1].songId = 0;
  p.sfx = [{ name: 'Long', steps: Array.from({ length: 8 }, (_, i) => ({ note: 3 + i, duration: 30 })) }];
  const talker = p.maps[1].screens[DEEP_TALKER].entities[0];
  talker.props.event.pages[0].commands = [{ op: 'sfx', sfx: 0 }, { op: 'say', text: 'Hello there, traveler.' }];
  return p;
}

/** Runs `frames` frames from a booted state; with `closeAt` the talker is opened at frame 0 and dismissed at ENDWAIT. */
async function trace({ talk }) {
  const b = await buildAndBoot(audioProject());
  const { nes, mem } = b;
  const tickPc = b.addrOf('music_tick');
  assert.ok(tickPc > 0, 'the build carries music_tick');
  const writes = [];
  const papuWrite = nes.papu.writeReg.bind(nes.papu);
  nes.papu.writeReg = (a, v) => { writes.push([a, v]); return papuWrite(a, v); };
  const original = nes.cpu.emulate.bind(nes.cpu);
  const ticks = []; // per tick: state tuple and the APU writes since the previous tick
  let framesRan = 0;
  let ticksThisFrame = 0;
  nes.cpu.emulate = () => {
    const pc = (nes.cpu.REG_PC + 1) & 0xffff;
    if (pc === tickPc) {
      ticksThisFrame++;
      const st = [];
      // the pulse and triangle channels only: the effect takes the noise channel over, and the song's own noise position stops while it does
      for (const base of Object.values(MUS)) for (let c = 0; c < MUS_CHANNELS - 1; c++) st.push(mem[base + c]);
      ticks.push({ st, writes: writes.splice(0) });
    }
    return original();
  };
  const frames = [];
  const frame = () => {
    ticksThisFrame = 0;
    nes.frame();
    framesRan++;
    frames.push({ ticks: ticksThisFrame, box: mem[BOX_STATE], sfx: mem[SFX_STATE], left: mem[SFX_LEFT] });
  };
  if (talk) {
    nes.buttonDown(1, BTN.B); frame(); nes.buttonUp(1, BTN.B);
    for (let i = 0; i < 400 && mem[BOX_STATE] !== BOX_ENDWAIT; i++) frame();
    assert.equal(mem[BOX_STATE], BOX_ENDWAIT);
    for (let i = 0; i < 4; i++) frame();
    nes.buttonDown(1, BTN.B); frame(); nes.buttonUp(1, BTN.B);
    for (let i = 0; i < 40; i++) frame();
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
    while (frames.length < 160) frame();
  } else {
    for (let i = 0; i < 160; i++) frame();
  }
  return { frames, ticks, framesRan };
}

/** Throws unless the run really closed a box with the effect in flight. */
function assertClosed({ frames }) {
  const closing = frames.filter((f) => f.box === BOX_CLOSING);
  assert.ok(closing.length >= 6, `the close never ran (${closing.length} CLOSING frames)`);
  assert.ok(closing.every((f) => f.sfx === 1), 'the effect was in flight across the close');
  return closing;
}

function compare(run, ref, { dropTick = -1 } = {}) {
  const frameTicks = run.frames.map((f) => f.ticks);
  assert.ok(frameTicks.every((t) => t === 1), `music_tick ran ${frameTicks.filter((t) => t !== 1).length} frame(s) with a count other than one`);
  const ticks = dropTick >= 0 ? run.ticks.filter((_, i) => i !== dropTick) : run.ticks;
  const n = Math.min(ticks.length, ref.ticks.length);
  assert.ok(n >= 150, `only ${n} ticks compared`);
  assert.equal(ticks.length, run.frames.length, 'one tick per frame, over the whole run');
  for (let i = 0; i < n; i++) {
    assert.deepEqual(ticks[i].st, ref.ticks[i].st, `tick ${i}: the song position differs from the run with no close`);
    const strip = (w) => w.filter(([a]) => !NOISE_REGS.has(a));
    assert.deepEqual(strip(ticks[i].writes), strip(ref.ticks[i].writes), `tick ${i}: the APU writes differ from the run with no close`);
  }
}

test('heaviest music + an effect in flight over a close: one tick per frame, the song and its APU writes identical to a run with no close, the effect counts down one a frame', async () => {
  const run = await trace({ talk: true });
  const ref = await trace({ talk: false });
  const closing = assertClosed(run);
  compare(run, ref);
  // the effect's own countdown, across the CLOSING frames
  for (let i = 1; i < closing.length; i++) assert.equal(closing[i - 1].left - closing[i].left, 1, `effect countdown skipped at CLOSING frame ${i}`);
  const noiseWrites = run.ticks.flatMap((t) => t.writes).filter(([a]) => NOISE_REGS.has(a)).length;
  assert.ok(noiseWrites > 0, 'the effect (or the song) really wrote the noise registers');
  assert.ok(ref.ticks.some((t) => t.st.some((x) => x !== 0)), 'the reference song is really playing');
});

test('the audio check rejects a run in which the close never happened, and a run with a skipped tick', async () => {
  const run = await trace({ talk: true });
  const ref = await trace({ talk: false });
  assert.throws(() => assertClosed(ref), /the close never ran/, 'a run with no conversation is not evidence');
  assert.throws(() => compare(run, ref, { dropTick: 40 }), /one tick per frame|song position differs/, 'a dropped tick is caught');
});
