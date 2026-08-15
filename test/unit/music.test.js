import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { Replayer } from '../../renderer/forges/sound/replayer.js';
import { compileSong } from '../../main/build/songcompile.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { flattenScreens } from '../../main/build/generate.js';
import { createMap } from '../../shared/project.js';
import {
  PERIOD_TABLE,
  CPU_CLOCK,
  noteFrequency,
  noteName,
  envelopeVolume,
  normalizeSong,
  OP_REST,
  OP_INSTRUMENT
} from '../../shared/audio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);

// engine/constants.asm. Not parsed out of build/constants.asm the way
// shared/enginesyms.js reads other engine addresses: cur_map and cur_song are
// defined there as expressions (`call_ret_hi+CALL_STACK_DEPTH`, `cur_map+1`)
// rather than a plain `= $HH`/`= 12` literal, which is exactly the shape
// parseEquates skips rather than evaluates, so it comes back undefined for
// both. Hardcoded with a comment is also this codebase's stated convention
// for tests regardless: a test that reads the file it is checking proves
// nothing.
const FLAT_SCREEN = 0x16;
const CUR_MAP = 0x87;  // NO_MAP until a screen decides
const CUR_SONG = 0x88; // NO_SONG until set_music runs

test('the period table tunes A-4 to 440 Hz', () => {
  const period = PERIOD_TABLE[45];
  const frequency = CPU_CLOCK / (16 * (period + 1));
  assert.ok(Math.abs(frequency - 440) < 1, `A-4 came out at ${frequency.toFixed(2)} Hz`);
  assert.equal(noteName(45), 'A-4');
  assert.equal(noteName(36), 'C-4');
});

test('an octave up halves the period', () => {
  for (const note of [36, 45, 60]) {
    const low = PERIOD_TABLE[note] + 1;
    const high = PERIOD_TABLE[note + 12] + 1;
    assert.ok(Math.abs(low / 2 - high) <= 1, `note ${note}: ${low} vs ${high}`);
  }
});

test('every period fits the APU register', () => {
  for (const period of PERIOD_TABLE) assert.ok(period >= 0 && period <= 0x7ff);
});

test('envelopes hold at their sustain entry', () => {
  const instrument = { volEnv: [15, 10, 5], sustain: 2 };
  assert.equal(envelopeVolume(instrument, 0), 15);
  assert.equal(envelopeVolume(instrument, 2), 5);
  assert.equal(envelopeVolume(instrument, 50), 5);
  // A sustain past the end clamps rather than reading undefined.
  assert.equal(envelopeVolume({ volEnv: [7], sustain: 9 }, 30), 7);
});

test('the compiler turns rows into notes with frame durations', () => {
  const song = normalizeSong({
    tempo: { framesPerRow: 6 },
    instruments: [{ duty: 2, volEnv: [15] }],
    patterns: [
      {
        id: 0,
        rows: 4,
        channels: { pulse1: [{ note: 45, inst: 0 }, null, { note: 47, inst: 0 }, null] }
      }
    ],
    order: [0],
    loop: 0
  });
  const compiled = compileSong(song);
  const pulse1 = compiled.channels.find((channel) => channel.id === 'pulse1');
  // instrument select, then two notes of two rows each.
  assert.deepEqual(pulse1.bytes, [OP_INSTRUMENT | 0, 45, 12, 47, 12]);
  assert.equal(pulse1.loopOffset, 0);

  // A channel with nothing in it still rests rather than running off the end.
  const noise = compiled.channels.find((channel) => channel.id === 'noise');
  assert.equal(noise.bytes[0], OP_REST);
});

test('a long note is split into byte-sized durations', () => {
  const song = normalizeSong({
    tempo: { framesPerRow: 31 },
    patterns: [{ id: 0, rows: 20, channels: { pulse1: [{ note: 45, inst: 0 }] } }],
    order: [0]
  });
  const pulse1 = compileSong(song).channels.find((channel) => channel.id === 'pulse1');
  const durations = [];
  for (let i = 0; i < pulse1.bytes.length; i++) {
    if (pulse1.bytes[i] === 45) durations.push(pulse1.bytes[i + 1]);
  }
  assert.ok(durations.length > 1, 'expected the note to be split');
  assert.ok(durations.every((value) => value > 0 && value <= 255));
  assert.equal(
    durations.reduce((total, value) => total + value, 0),
    20 * 31,
    'the split must preserve the total length'
  );
});

// ---------------------------------------------------------------------------
// The golden test: the ROM's driver and the preview replayer must produce
// identical APU writes, or what you hear in the Sound Forge is a lie.
// ---------------------------------------------------------------------------

const APU_LOW = 0x4000;
const APU_HIGH = 0x400f;

/**
 * Run the ROM, collecting the APU writes each frame makes, and every write
 * anywhere in the run to cur_song, each as `{ frame, value }` in the order
 * they actually happened.
 *
 * cur_song is read at write-time (through cpu.write, which is what every STA
 * to RAM goes through — see renderer/emulator/core/cpu.js), not sampled once
 * at each frame boundary: boot writes it three times while it settles, and
 * not all on the same emitted frame. On the current ROM, frame 1 is
 * boot_clear zeroing it along with the rest of WRAM; frame 2 is
 * init_session's music_stop setting it to NO_SONG immediately followed, in
 * the same frame, by apply_map_music's music_play storing the real decision;
 * frame 3 is main_loop's first jsr music_tick, giving every channel its
 * initial period. A once-per-frame sample cannot tell frame 1's boot_clear
 * zero (song 0's own index) apart from frame 2's real decision landing on the
 * same value; watching every write in order can, and it is also what lets a
 * caller downstream tell the boot-settling burst apart from a write that has
 * no business happening once the song is already playing.
 */
function recordRomActivity(frames) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM_PATH)));

  const writesPerFrame = [];
  let current = [];
  const originalMmapWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address >= APU_LOW && address <= APU_HIGH) current.push([address, value & 0xff]);
    return originalMmapWrite(address, value);
  };

  let frame = -1;
  const songWrites = [];
  const originalCpuWrite = nes.cpu.write.bind(nes.cpu);
  nes.cpu.write = (address, value) => {
    if (address === CUR_SONG) songWrites.push({ frame, value: value & 0xff });
    return originalCpuWrite(address, value);
  };

  for (let i = 0; i < frames; i++) {
    frame = i;
    current = [];
    nes.frame();
    writesPerFrame.push(current);
  }
  return { writesPerFrame, songWrites };
}

test('the ROM driver and the preview replayer agree', { skip: !hasRom && 'run `npm run sample` first' }, async () => {
  const project = await loadProject(SAMPLE);
  assert.ok(project.songs.length, 'the sample project should contain a song');

  const compiled = compileSong(project.songs[0]);
  const replayer = new Replayer(compiled);

  const { writesPerFrame, songWrites } = recordRomActivity(200);

  // Real ticking begins on the first frame that gives a channel a period —
  // $4002 (pulse 1) or $400a (triangle) — which only music_apply's own
  // note-start code ever writes. music_stop's silence stamp, part of boot's
  // own settling (init_session calls it too), never touches either register,
  // so it cannot be mistaken for a note and this is not the same proxy the
  // old $4002-only alignment was: it is used below only to draw the boundary
  // of boot's legitimate settling burst, never as the comparison anchor
  // itself, so a driver that started ticking late still has its silence
  // compared frame for frame rather than skipped past.
  const tickStart = writesPerFrame.findIndex((writes) =>
    writes.some(([address]) => address === 0x4002 || address === 0x400a)
  );
  assert.ok(tickStart >= 0, 'the ROM never gave a channel a period — is the song playing?');

  // Everything cur_song legitimately does happens before that first tick:
  // music_play must run, and run to completion, before music_tick can ever
  // produce output, because mus_enabled only becomes true inside music_play
  // itself. The *last* write before tickStart is therefore the real boot
  // decision, regardless of how many times boot touched cur_song settling
  // into it.
  const settling = songWrites.filter((entry) => entry.frame < tickStart);
  assert.ok(settling.length > 0, 'cur_song was never written before the song started ticking');
  const decision = settling[settling.length - 1];
  assert.equal(decision.value, 0, 'cur_song never settled on song 0 before the song started ticking');

  // Nothing in this project changes map or runs a Play music command, so
  // once the real song has started, cur_song must never be written again.
  // Anchoring on the *last* write anywhere in the whole run — rather than the
  // last one before ticking starts — would silently re-sync to a later,
  // unwanted restart instead of catching it: comparing from one frame past
  // that spurious write would find a fresh replayer and a freshly-restarted
  // ROM agreeing from tick 0, discarding the restart along with everything
  // that led up to it. So a write at or after tickStart fails the test by
  // name instead.
  const restart = songWrites.find((entry) => entry.frame >= tickStart);
  assert.equal(
    restart,
    undefined,
    `cur_song was written again on frame ${restart?.frame} (value ${restart?.value}) after the song had ` +
      'already started ticking on frame ' +
      `${tickStart} — an unintended restart, since nothing in this project changes map or runs Play music`
  );

  // One frame *past* the decision, not the decision's own frame: music_play
  // only sets up the channels (pointers, durations, cur_song) — it writes no
  // APU register itself. The first real tick is main_loop's own next
  // jsr music_tick, which cannot run before that main_loop iteration's
  // jsr wait_vblank yields to the next frame boundary, so it lands one frame
  // later than the decision every time a song starts, whether from boot or
  // from a mid-game redraw.
  const start = decision.frame + 1;

  const compare = 150;
  for (let i = 0; i < compare; i++) {
    const expected = replayer.tick();
    const actual = writesPerFrame[start + i];
    assert.deepEqual(
      actual,
      expected,
      `APU writes differ on frame ${i} (ROM frame ${start + i}):\n` +
        `  ROM:      ${JSON.stringify(actual)}\n` +
        `  replayer: ${JSON.stringify(expected)}`
    );
  }
});

test('the song actually plays notes, not just silence', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const { writesPerFrame } = recordRomActivity(200);
  const all = writesPerFrame.flat();
  assert.ok(all.length > 100, `only ${all.length} APU writes in 200 frames`);
  // A period write to $4002 means a real note started on pulse 1.
  assert.ok(
    all.some(([address]) => address === 0x4002),
    'pulse 1 never received a period, so no note was played'
  );
  assert.ok(
    all.some(([address]) => address === 0x400a),
    'the triangle never received a period'
  );
});

// ---------------------------------------------------------------------------
// The map decides the music -- see engine/music.asm's apply_map_music and
// set_music, and CLAUDE.md's "the music follows the map" section.
// ---------------------------------------------------------------------------

const RIGHT = 7; // engine/constants.asm's BTN_RIGHT bit position, as nes.buttonDown indexes it

function bootHeadless(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const hold = (nes, button, frames) => {
  nes.buttonDown(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
  nes.buttonUp(1, button);
  nes.frame();
};

/** Walk right one step at a time until `done` is true, or give up. */
function walkRightUntil(nes, done, limit = 200) {
  for (let step = 0; step < limit && !done(); step++) hold(nes, RIGHT, 1);
  return done();
}

test('the map decides its song on arrival, and a screen edge inside it does not restart', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.project.titleMap = null; // boot straight into gameplay -- nothing
                                    // here is about the title screen
  const SONG_A = 0;
  const SONG_B = project.songs.length;
  project.songs.push(structuredClone(project.songs[0]));
  project.maps[0].songId = SONG_A;

  // A wall-free 2x2 world (the sample already has one) plus a second map with
  // a different song, reached by touching a door on the screen the player
  // crosses onto.
  for (const screen of project.maps[0].screens) screen.metatiles = screen.metatiles.map(() => 0);
  const second = createMap(project.maps.length, 'Elsewhere');
  const secondMapIndex = project.maps.length; // the sample already has a title map at 1
  second.tilesetId = project.maps[0].tilesetId;
  second.songId = SONG_B;
  project.maps.push(second);
  const { mapBase } = flattenScreens(project);
  const targetFlat = mapBase[secondMapIndex];

  const doorId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: doorId, name: 'Door', behavior: 'npc' });
  // cross_right lands the player at x = 0 with y unchanged, so a door at
  // x = 8 is touched the moment the crossing settles.
  project.maps[0].screens[1].entities.push({
    actorId: doorId,
    x: 8,
    y: 112,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: targetFlat, x: 112, y: 112 }] }] }
    }
  });

  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = bootHeadless(built.romPath);

  assert.equal(nes.cpu.mem[FLAT_SCREEN], 0);
  assert.equal(nes.cpu.mem[CUR_MAP], 0, 'boot should have decided the start map');
  assert.equal(nes.cpu.mem[CUR_SONG], SONG_A, "the start map's own song should be sounding");

  // A screen edge, still inside map 0: the shadow must not move, which is
  // what stops the song from restarting.
  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[FLAT_SCREEN] === 1),
    'the player never crossed onto the next screen'
  );
  assert.equal(nes.cpu.mem[CUR_MAP], 0, 'still the same map after a screen edge');
  assert.equal(nes.cpu.mem[CUR_SONG], SONG_A, 'a screen edge inside one map must not restart its song');

  // The door on this screen is a genuine map change: the new map's own song
  // takes over.
  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[CUR_MAP] === secondMapIndex),
    'the door never took the player to the second map'
  );
  assert.equal(nes.cpu.mem[FLAT_SCREEN], targetFlat);
  assert.equal(nes.cpu.mem[CUR_SONG], SONG_B, "the second map's own song should have taken over");
});

test('a Play music command survives a screen edge but not a map change', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-override-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.project.titleMap = null;
  const SONG_MAP = 0;
  const SONG_OVERRIDE = project.songs.length;
  project.songs.push(structuredClone(project.songs[0]));
  const SONG_ELSEWHERE = project.songs.length;
  project.songs.push(structuredClone(project.songs[0]));
  project.maps[0].songId = SONG_MAP;

  for (const screen of project.maps[0].screens) screen.metatiles = screen.metatiles.map(() => 0);
  const second = createMap(project.maps.length, 'Elsewhere');
  const secondMapIndex = project.maps.length; // the sample already has a title map at 1
  second.tilesetId = project.maps[0].tilesetId;
  second.songId = SONG_ELSEWHERE;
  project.maps.push(second);
  const { mapBase } = flattenScreens(project);
  const targetFlat = mapBase[secondMapIndex];

  const jukeboxId = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id: jukeboxId,
    name: 'Jukebox',
    behavior: 'npc'
  });
  // Well short of the screen edge, so the override is in effect before the
  // crossing rather than raced against it.
  project.maps[0].screens[0].entities.push({
    actorId: jukeboxId,
    x: 152,
    y: 112,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'music', song: SONG_OVERRIDE }] }] }
    }
  });
  const doorId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: doorId, name: 'Door', behavior: 'npc' });
  project.maps[0].screens[1].entities.push({
    actorId: doorId,
    x: 8,
    y: 112,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: targetFlat, x: 112, y: 112 }] }] }
    }
  });

  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = bootHeadless(built.romPath);

  assert.equal(nes.cpu.mem[CUR_SONG], SONG_MAP);

  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[CUR_SONG] === SONG_OVERRIDE),
    'touching the jukebox never changed the song'
  );
  assert.equal(nes.cpu.mem[CUR_MAP], 0, 'still the same map after the override');

  // Cross the edge the override was issued on: the map must not reassert its
  // own song over it -- this is the regression that proves an event's choice
  // outlives a redraw within its own map.
  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[FLAT_SCREEN] === 1),
    'the player never crossed onto the next screen'
  );
  assert.equal(
    nes.cpu.mem[CUR_SONG],
    SONG_OVERRIDE,
    "a screen edge inside the map must not reassert the map's own song over an event's choice"
  );

  // A different map, though, takes over regardless of what an event chose.
  assert.ok(
    walkRightUntil(nes, () => nes.cpu.mem[CUR_MAP] === secondMapIndex),
    'the door never took the player to the second map'
  );
  assert.equal(nes.cpu.mem[CUR_SONG], SONG_ELSEWHERE, "a different map's own song should override the event's choice");
});

test('a game over into a Silence map actually silences the APU, not just cur_song', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // cur_song is bookkeeping, not the hardware. It is possible for it to read
  // NO_SONG while a song from the previous session is still audible -- which
  // is exactly the shape init_session's own bug took, so this asserts the APU
  // itself (mus_enabled, and that no further note ever starts), not the
  // shadow the earlier version of this fix trusted too far.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-music-silence-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  assert.ok(project.project.titleMap !== null, 'the sample should carry a title to come back to');
  project.maps[project.project.titleMap].songId = null; // the title goes quiet

  // Something lethal right next to the start, so dying does not take a
  // journey -- the same fixture title.test.js's restart test uses.
  const doomId = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id: doomId,
    name: 'Doom',
    behavior: 'npc',
    hp: 1,
    damage: 6
  });
  project.maps[0].screens[0].entities.push({ actorId: doomId, x: 152, y: 112, props: {} });

  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = bootHeadless(built.romPath);

  const START = 3;
  const GAME_STATE = 0x25;
  const ST_GAMEPLAY = 0;
  const ST_TITLE = 3;
  const MUS_ENABLED = 0x2d; // engine/constants.asm

  const tap = (button, frames = 12) => {
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
    for (let i = 0; i < frames; i++) nes.frame();
  };

  tap(START); // title into gameplay -- the start map's own real song
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  assert.equal(nes.cpu.mem[MUS_ENABLED], 1, 'the start map should have started a real song');

  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  assert.notEqual(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'never died');

  for (let i = 0; i < 600 && nes.cpu.mem[GAME_STATE] !== ST_TITLE; i++) tap(START, 8);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'a game over should lead back to the title');

  // The title map is Silence: not "cur_song says NO_SONG" but genuinely no
  // sound. mus_enabled gates music_tick entirely, so 0 means the driver
  // cannot write to the APU again even on the next frame it runs.
  assert.equal(nes.cpu.mem[MUS_ENABLED], 0, "restarting into a Silence map should have stopped the previous run's song");

  let periodWrites = 0;
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address === 0x4002 || address === 0x400a) periodWrites++;
    return originalWrite(address, value);
  };
  for (let i = 0; i < 30; i++) nes.frame();
  assert.equal(periodWrites, 0, 'a note started after the restart -- the old song was never actually stopped');
});
