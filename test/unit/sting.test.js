// Sting: item 6's sound-effect slice. [OP_STING, song index or NO_SONG, duration in frames] --
// pauses whatever song is playing, plays the named one alone through the unmodified driver, and
// resumes the original exactly where it left off once the duration elapses, provided nothing else
// asked the driver to play a song in the meantime. Does not suspend the script -- the same instant
// shape OP_TURN/OP_SHAKE/OP_VISIBLE/OP_FLASH already have. See handoff-sting/design-sting.md for
// the full design; this file is its §12 test plan, items 1, 2, and 5-17 (item 3, the per-board
// allowance and its dependent-term case, and item 9's own §9 documented-limitation, live in
// test/unit/kernelbytes.test.js; item 4 and item 13's eight validation cases live in
// test/unit/project.test.js).
//
// Everything builds its own project rather than touching `sample/`, which is a checked-in fixture
// -- except the ROM itself is built from a mutated in-memory clone of `sample`'s own project, the
// same shape shake.test.js/turnwait.test.js already use, so this reuses the real Sound Forge song
// format instead of hand-rolling a second one.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { compileText, opIndex, OP_STING } from '../../main/build/textcompile.js';
import { createProject, projectUsesSting } from '../../shared/project.js';
import { songFrameLength } from '../../shared/audio.js';
import { parseEquates } from '../../shared/enginesyms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasRpgRom = fs.existsSync(path.join(SAMPLE_RPG, 'build/game.nes'));
const ST_BATTLE = 5; // engine/constants.asm

// Engine RAM (engine/constants.asm). cur_song/mus_enabled are computed expressions there
// (`cur_map+1`, chained off ptr_lo), the same shape music.test.js's own header comment already
// explains parseEquates cannot evaluate -- hardcoded with a comment, this codebase's stated
// convention: a test that reads the file it is checking proves nothing. sting_shadow and its
// neighbors ARE plain literals (design-sting.md §6) and are cross-checked against the real
// constants.asm directly in the opcode-agreement test below, so those four are not hand-trusted
// the same way.
const GAME_STATE = 0x25;
const CUR_SONG = 0x8b;
const MUS_ENABLED = 0x2d;
const ST_GAMEPLAY = 0;
const B = 1;
const START_X = 112;
const START_Y = 112;
const NPC = 4; // appended by buildWith, after the sample's four actors
const FIELD_SONG = 0; // the sample project's own song, replaced with a long held note below
const STING_SONG = 1; // appended after it

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

/**
 * A field song with one note held for 40 rows (240 frames at the default framesPerRow of 6) --
 * comfortably under compileSong's own 255-frame retrigger-split ceiling, so it is one single,
 * uninterrupted (note, duration) pair with no natural retrigger anywhere a test's own observation
 * window could land on by coincidence. Every timing test below depends on this: the field song
 * must not naturally retrigger near a sting's own resume point, or a broken force_trig
 * implementation could pass by accident (a natural note-boundary standing in for the retrigger it
 * failed to force).
 */
function fieldSong() {
  return {
    name: 'Field',
    tempo: { framesPerRow: 6 },
    instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
    patterns: [{ id: 0, rows: 40, channels: { pulse1: [{ note: 40, inst: 0 }, ...Array(39).fill(null)] } }],
    order: [0],
    loop: 0
  };
}

/**
 * The sting itself: 3 rows at the same framesPerRow (6), so its own first-pass duration --
 * songFrameLength, design-sting.md §4 -- is exactly 18 frames, short enough to resolve well
 * inside fieldSong's own 240-frame held note. A distinct note (60, two octaves above the field
 * song's 40) so the sting's own playback is unmistakable in the APU trace.
 */
function stingSong() {
  return {
    name: 'Fanfare',
    tempo: { framesPerRow: 6 },
    instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
    patterns: [{ id: 0, rows: 3, channels: { pulse1: [{ note: 60, inst: 0 }, null, null] } }],
    order: [0],
    loop: 0
  };
}
const STING_FRAMES = 18; // sanity-checked against songFrameLength(stingSong()) below

test('sanity: the fixture songs are exactly as long as the tests below assume', () => {
  assert.equal(songFrameLength(fieldSong()), 240);
  assert.equal(songFrameLength(stingSong()), STING_FRAMES);
});

/**
 * A one-screen project with one talkable NPC carrying `commands`, 16px above the player's own
 * start position -- the identical placement shake.test.js/turnwait.test.js already use for a
 * non-suspending verb. project.songs[0] is replaced with fieldSong() (the map's own songId is
 * left at 0, so this is still what plays on boot) and stingSong() is appended at index 1.
 */
async function buildWith(t, commands, tweak = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sting-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.songs[0] = fieldSong();
  project.songs[1] = stingSong();
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

const APU_LOW = 0x4000;
const APU_HIGH = 0x400f;

/**
 * Records every $4000-$400F write and every cur_song write, frame by frame, the identical shape
 * music.test.js's own recordRomActivity uses and for the identical reason: cur_song is read at
 * write-time (cpu.write), not sampled once per frame, so a same-frame settle-then-decide sequence
 * stays distinguishable.
 */
function trace(nes, frames, onFrame = () => {}) {
  const writesPerFrame = [];
  let current = [];
  const originalMmapWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address >= APU_LOW && address <= APU_HIGH) current.push([address, value & 0xff]);
    return originalMmapWrite(address, value);
  };
  const songWrites = [];
  let frame = -1;
  const originalCpuWrite = nes.cpu.write.bind(nes.cpu);
  nes.cpu.write = (address, value) => {
    if (address === CUR_SONG) songWrites.push({ frame, value: value & 0xff });
    return originalCpuWrite(address, value);
  };
  // onFrame(i) runs immediately before frame i itself, so a caller can drive button presses
  // (buttonDown on the frame it wants held, buttonUp on the one after, the identical shape tap()
  // uses) from inside the very loop that is also recording writes -- tracing first and pressing
  // buttons afterward, as an earlier draft of this file did, records forty frames of nothing but
  // boot settling and never sees the interaction at all.
  for (let i = 0; i < frames; i++) {
    frame = i;
    current = [];
    onFrame(i, nes);
    nes.frame();
    writesPerFrame.push(current);
  }
  return { writesPerFrame, songWrites };
}

/** onFrame callback for trace(): hold `button` on frame `at`, release on frame `at + 1`. */
const tapAt = (button, at) => (i, nes) => {
  if (i === at) nes.buttonDown(1, button);
  if (i === at + 1) nes.buttonUp(1, button);
};

const periodWrite = (writes) => writes.some(([address]) => address === 0x4002 || address === 0x4003);

// --------------------------------------------------------------------- §12 test 1: byte identity

test('a switched-off Sting costs a project nothing -- not one byte of ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const withOff = await buildWith(t, [
    { op: 'sting', song: STING_SONG, off: true },
    { op: 'setSwitch', switch: 5 }
  ]);
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);
  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a disabled Sting must leave the ROM identical to one with no Sting at all'
  );
});

// --------------------------------------------------------------- §12 test 2: the predicate

test('projectUsesSting ignores a Sting the compiler would drop', () => {
  const project = createProject('Predicate');
  const pages = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'sting', song: 0 }]) }];
  assert.equal(projectUsesSting(project), true, 'a live Sting counts');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'sting', song: 0, off: true }]) }];
  assert.equal(projectUsesSting(project), false, 'a switched-off one does not');

  // Inside a branch, the same usedSwitches-shaped gap CLAUDE.md already documents once for
  // switches: the predicate must walk the same recursive liveCommands every other whole-event
  // question does, not just a page's own top-level array.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        { op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'sting', song: 0 }], else: [] }
      ])
    }
  ];
  assert.equal(projectUsesSting(project), true, 'a Sting nested inside a branch still counts');
});

// -------------------------------------------------------------------------- the wire, and §12 15

test('a Sting compiles to its opcode plus a song index and a duration byte, and the opcode agrees with the engine', async () => {
  // OP_STING appended after OP_FLASH ($19), so $1A -- design-sting.md §10, round-1 finding 10.
  // Parsed out of the real engine/constants.asm rather than trusted from the design doc, the
  // established parseEquates discipline CLAUDE.md names as the single way tooling is meant to
  // know an engine value.
  const constants = parseEquates(await fs.promises.readFile(path.join(ROOT, 'engine/constants.asm'), 'utf8'));
  assert.equal(constants.OP_STING, 0x1a, "engine/constants.asm's own OP_STING must read $1A");
  assert.equal(
    OP_STING,
    constants.OP_STING,
    "main/build/textcompile.js's exported OP_STING must agree with engine/constants.asm's numeric definition -- " +
      'a later verb inserted between them without renumbering both would silently miscompile every Sting'
  );
  assert.equal(opIndex('sting'), OP_STING, "OP_STING should equal opIndex('sting') exactly");

  const project = createProject('Sting wire');
  project.songs = [{ name: 'A' }, stingSong()];
  project.commonEvents = [
    { id: 0, name: 'Cue', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 1 }] }] } }
  ];
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(OP_STING);
  assert.ok(at >= 0, 'the compiled events should contain an OP_STING');
  assert.deepEqual(
    bytes.slice(at, at + 3),
    [OP_STING, 1, STING_FRAMES],
    'a Sting is exactly three bytes -- opcode, song index, and the compiler-computed duration'
  );
});

// ------------------------------------------------------------------------- §12 test 17 (round 2)

test('songByte/NO_SONG stay importable from textcompile.js after their shared/audio.js move', async () => {
  const textcompile = await import('../../main/build/textcompile.js');
  assert.equal(
    typeof textcompile.songByte,
    'function',
    'main/build/generate.js:37 imports songByte from here'
  );
  assert.equal(textcompile.NO_SONG, 0xff, 'test/unit/script.test.js imports NO_SONG from here');
  const audio = await import('../../shared/audio.js');
  assert.equal(
    textcompile.songByte,
    audio.songByte,
    'must be the re-exported SAME function, not a second, stale implementation'
  );
  assert.equal(textcompile.NO_SONG, audio.NO_SONG);
  // generate.js itself, not just the shape: it actually loads without a module-graph error, the
  // concrete thing round-2 finding 1 said would break (main/build/generate.js:37's own import of
  // songByte from textcompile.js). test/unit/script.test.js's own NO_SONG import is proven the
  // identical way every other test file's own imports are -- by that file loading and running at
  // all in the same `npm test` run, not by re-importing (and so re-registering and re-running) an
  // entire second test file's worth of tests from inside this one.
  const generate = await import('../../main/build/generate.js');
  assert.equal(typeof generate.checkCapacity, 'function', 'generate.js itself must still load');
});

// ------------------------------------------------------------------------------- the engine

test('a Sting does not suspend the event -- the next command runs the same frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'sting', song: STING_SONG },
    { op: 'setSwitch', switch: 5 }
  ]);
  tap(nes, B, 0); // talk: the page runs Sting then the next command, all before this frame ends
  const on = (n) => Boolean(nes.cpu.mem[0x390 + (n >> 3)] & (1 << (n & 7)));
  assert.equal(on(5), true, 'the command after Sting must already have run -- Sting does not suspend the event');
  assert.equal(
    nes.cpu.mem[GAME_STATE],
    ST_GAMEPLAY,
    'with nothing left to suspend on, the conversation ends the same frame it started'
  );
});

// §12 test 5: fires, resumes, and the resume is audibly correct -- not just the shadow bytes.
test('a live Sting fires, resumes, and real APU writes accompany both transitions', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [{ op: 'sting', song: STING_SONG }]);
  const { writesPerFrame, songWrites } = trace(nes, 40, tapAt(B, 0));

  // The trigger frame: the first (and, since cancellation never applies here, only) write of the
  // sting's own index to cur_song.
  const triggerFrame = songWrites.find((w) => w.value === STING_SONG)?.frame;
  assert.ok(triggerFrame !== undefined, 'cur_song never took the sting index -- did the sting ever trigger?');

  // The sting's own first note: script_op_sting runs after that frame's own music_tick already
  // ticked the *old* song (main_loop's own ordering, design-sting.md §3/§7), so the sting's first
  // audible frame is the one immediately after the trigger frame, not the trigger frame itself.
  assert.ok(
    periodWrite(writesPerFrame[triggerFrame + 1]),
    `frame ${triggerFrame + 1} (the sting's own first tick) should have written a pulse period -- ` +
      'mechanism 1 (force_trig) missing would still let a freshly-loaded channel trigger its own ' +
      'first note normally, so this alone would pass even without it; the resume assertion below is ' +
      'the one that actually needs it'
  );

  // Resume: sting_left counts down for STING_FRAMES frames starting the frame after the trigger,
  // reaching zero (and calling sting_restore) on triggerFrame + STING_FRAMES. music_tick on that
  // same frame already applied the sting's own final frame of audio (the load-bearing ordering
  // §12 test 14 checks directly) -- the resumed field song's own state is not applied until the
  // NEXT frame.
  const resumeFrame = triggerFrame + STING_FRAMES + 1;
  assert.ok(
    periodWrite(writesPerFrame[resumeFrame]),
    `frame ${resumeFrame} (the first frame after the resume) should have written a pulse period -- an ` +
      'implementation missing mechanism 1 (force_trig) would restore the shadow bytes correctly ' +
      '(cur_song, mus_ptr_lo/hi, etc.) but mus_trig would read 0, so music_apply\'s own ' +
      '"retuning every frame would restart the phase" skip would suppress this write entirely: the ' +
      'field song\'s single held note (fieldSong(), 240 frames, no natural retrigger anywhere near ' +
      'this window) would stay silent-but-technically-playing rather than audibly resuming'
  );
  assert.equal(
    nes.cpu.mem[CUR_SONG],
    FIELD_SONG,
    'cur_song should read the field song again once the resume has happened'
  );
  assert.equal(nes.cpu.mem[MUS_ENABLED], 1, 'the field song should be audible again after the resume');
});

// §12 test 6: Silence-restore -- the actual re-silencing writes, not merely their absence
// downstream (round-1 finding 5; sabotage claim narrowed in round-2 finding 6 to not claim an
// ordering it cannot prove).
test('a sting resolving while the field song is Silence actually re-silences the hardware', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [{ op: 'sting', song: STING_SONG }], (project) => {
    project.maps[0].songId = null; // the field itself is Silence
  });
  const { writesPerFrame, songWrites } = trace(nes, 40, tapAt(B, 0));

  const triggerFrame = songWrites.find((w) => w.value === STING_SONG)?.frame;
  assert.ok(triggerFrame !== undefined, 'the sting never triggered');
  const restoreFrame = triggerFrame + STING_FRAMES; // sting_tick's own dec-to-zero frame

  // sting_restore's silence branch: $30 to $4000/$4004/$400C, 0 to $4008 -- music_stop's own
  // identical four writes. Asserted as the actual values that frame produces, not "no further
  // writes downstream" (which mus_enabled=0 alone would already guarantee, correct driver or not
  // -- that broken implementation produces identical silence to a correct one, which is exactly
  // why this has to check the writes themselves).
  const writes = writesPerFrame[restoreFrame];
  assert.ok(writes.some(([a, v]) => a === 0x4000 && v === 0x30), `frame ${restoreFrame} should write $30 to $4000`);
  assert.ok(writes.some(([a, v]) => a === 0x4004 && v === 0x30), `frame ${restoreFrame} should write $30 to $4004`);
  assert.ok(writes.some(([a, v]) => a === 0x400c && v === 0x30), `frame ${restoreFrame} should write $30 to $400C`);
  assert.ok(writes.some(([a, v]) => a === 0x4008 && v === 0), `frame ${restoreFrame} should write $0 to $4008`);
  assert.equal(nes.cpu.mem[MUS_ENABLED], 0, 'mus_enabled should read Silence again after the resume');

  // Corroborating, not load-bearing on its own (per the finding above): confirm the silence is
  // real by also checking nothing further touches either period register.
  let periodWrites = 0;
  for (let i = restoreFrame + 1; i < writesPerFrame.length; i++) {
    if (periodWrite(writesPerFrame[i])) periodWrites++;
  }
  assert.equal(periodWrites, 0, 'nothing should start a note after the resume into Silence');
});

// §12 test 7: mechanism 5, demoted to a RAM-invariant hygiene check (round 1, finding 7) -- no
// longer a behavioral APU claim, since a stale force_trig surviving into an unrelated later song
// is consumed inertly on that song's own first tick either way (walked through directly against
// the driver in design-sting.md §5). What survives is the state fact this design still chooses to
// hold: force_trig is never left armed through a stretch of silence.
test('a sting resolving into Silence leaves force_trig clear, not armed through the silence', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [{ op: 'sting', song: STING_SONG }], (project) => {
    project.maps[0].songId = null;
  });
  const { songWrites } = trace(nes, 40, tapAt(B, 0));
  const triggerFrame = songWrites.find((w) => w.value === STING_SONG)?.frame;
  const restoreFrame = triggerFrame + STING_FRAMES;
  // force_trig is $0543, @size=MUS_CHANNELS (4) -- design-sting.md §6.
  for (let channel = 0; channel < 4; channel++) {
    assert.equal(
      nes.cpu.mem[0x0543 + channel],
      0,
      `force_trig channel ${channel} should read 0 after a resolve into Silence, restore frame ${restoreFrame}`
    );
  }
});

// §12 test 8: second sting replaces the first, without re-snapshotting over it (mechanism 4).
test('a second sting arriving before the first resolves replaces it, restoring the real field song', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'sting', song: STING_SONG },
    { op: 'wait', frames: 3 },
    { op: 'sting', song: STING_SONG }
  ]);
  const { writesPerFrame, songWrites } = trace(nes, 60, tapAt(B, 0));

  // Two triggers, not one -- confirms both script_op_sting calls actually ran (the second armed
  // after the Wait, mid-first-sting).
  const triggers = songWrites.filter((w) => w.value === STING_SONG).map((w) => w.frame);
  assert.ok(triggers.length >= 2, `expected at least two sting triggers, saw cur_song=STING_SONG at frames ${JSON.stringify(triggers)}`);
  const secondTrigger = triggers[1];

  // The eventual resume must land back on the *field* song, not a snapshot of the first sting's
  // own in-flight playback -- an implementation missing the sting_left==0 guard would have
  // snapshotted the first sting's own state on the second trigger instead of the real field song,
  // so cur_song would read STING_SONG again (or something is otherwise wrong) rather than resuming
  // FIELD_SONG.
  const resumeFrame = secondTrigger + STING_FRAMES + 1;
  assert.ok(resumeFrame < writesPerFrame.length, 'trace window too short for this scenario');
  assert.equal(
    nes.cpu.mem[CUR_SONG],
    FIELD_SONG,
    'the eventual resume should restore the real field song, not the first sting\'s own shadowed state'
  );
  assert.ok(periodWrite(writesPerFrame[resumeFrame]), `frame ${resumeFrame} should show the resumed field song\'s own retriggered note`);
});

// §12 test 9: cancellation, the corrected policy (round-1 finding 3).
test('a music command for a different song cancels an in-flight sting; the sting\'s own song is the true no-op', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // (a) A different song -- including the field song the player was already hearing -- reaches
  // music_play and cancels: sting_left reads 0 immediately, and the requested song plays from its
  // own beginning rather than seaming into where the field song had been. Checked at 8 settle
  // frames (well under the sting's own 18-frame natural completion), not a long settle that would
  // let the sting resolve on its own regardless of whether cancellation ever actually happened.
  {
    const { nes } = await buildWith(t, [
      { op: 'sting', song: STING_SONG },
      { op: 'wait', frames: 2 },
      { op: 'music', song: FIELD_SONG }
    ]);
    tap(nes, B, 8);
    assert.equal(nes.cpu.mem[0x0542], 0, 'sting_left should read 0 -- the field-song request should have cancelled the sting');
    assert.equal(nes.cpu.mem[CUR_SONG], FIELD_SONG);
    assert.equal(nes.cpu.mem[MUS_ENABLED], 1);
  }

  // (b) A request naming the sting's OWN currently-playing song is the true no-op: set_music's
  // existing dedup (cmp cur_song) catches it before music_play is ever reached, so sting_left is
  // left completely untouched -- still counting down, not cancelled. Checked well before the
  // sting's own natural 18-frame completion (12 frames: 1 trigger + 2 Wait + a handful for the
  // Wait to resume and dispatch the music command), not after a long trace that would let the
  // sting resolve on its own regardless of whether cancellation happened -- that would prove
  // nothing either way.
  {
    const { nes } = await buildWith(t, [
      { op: 'sting', song: STING_SONG },
      { op: 'wait', frames: 2 },
      { op: 'music', song: STING_SONG }
    ]);
    const { songWrites } = trace(nes, 12, tapAt(B, 0));
    const triggers = songWrites.filter((w) => w.value === STING_SONG).map((w) => w.frame);
    // set_music's own dedup means the second 'music' command, naming the identical song already
    // playing, never reaches music_play at all -- so there is only ever ONE write of STING_SONG to
    // cur_song, from the sting's own trigger. An implementation that wrongly cancels here would
    // still show one trigger write (music_play's own cancellation check does not write cur_song a
    // second time when the operand IS the sting's own index -- set_music's dedup returns before
    // music_play is even called), so this is corroborated by sting_left directly below, not by
    // the write count alone.
    assert.ok(triggers.length >= 1, 'the sting should still have triggered');
    assert.ok(
      nes.cpu.mem[0x0542] > 0,
      'sting_left should still be counting down -- a request naming the sting\'s own song must be the true no-op'
    );
  }
});

// §12 test 10: init_session/game-over path.
test('a sting live at a game over does not survive into the new session', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // A dedicated, much longer sting (song index 2, 30 rows -- 180 frames) rather than the shared
  // 18-frame STING_SONG: walking to Doom and dying takes an a-priori-unknown number of frames (up
  // to 60, per the settle loop below), and the whole point of this test is that the sting must
  // still be genuinely in-flight -- not merely still "logically playing" but past its own natural
  // 18-frame span already elapsing along the way -- at the exact moment init_session runs, or the
  // music_stop clear this test exists to guard has nothing left to prove: sting_left reading 0
  // would already be true regardless of whether that clear ever ran.
  const LONG_STING_SONG = 2;
  const { nes, project } = await buildWith(t, [{ op: 'sting', song: LONG_STING_SONG }], (project) => {
    project.songs[2] = {
      name: 'Long',
      tempo: { framesPerRow: 6 },
      instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
      patterns: [{ id: 0, rows: 30, channels: { pulse1: [{ note: 60, inst: 0 }, ...Array(29).fill(null)] } }],
      order: [0],
      loop: 0
    };
    const doomId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[0]),
      id: doomId,
      name: 'Doom',
      behavior: 'npc',
      hp: 1,
      damage: 6
    });
    // The same relative offset (+40px in x) music.test.js's own Silence-on-restart fixture uses
    // for its own Doom actor, next to an identical player start (112,112) -- a reach for RIGHT
    // alone gets there in well under 60 frames, comfortably inside this sting's own 180.
    project.maps[0].screens[0].entities.push({ actorId: doomId, x: START_X + 40, y: START_Y, props: {} });
    // The title map Silence, not merely absent: restart_game's own redraw_screen calls
    // apply_map_music for the title map right after init_session runs, and if that map had a real
    // song, set_music would see cur_song no longer matching (NO_SONG, from music_stop's own
    // unconditional lines) and call music_play -- whose OWN cancellation check (mechanism 2's
    // other half, not sabotaged by this test) would independently clear sting_left as a side
    // effect, masking a music_stop-specific bug entirely. Silence here means set_music's own dedup
    // (cur_song already NO_SONG) returns before music_play is ever reached again, so music_stop's
    // own clear -- called once, directly, from inside init_session -- is the only thing left that
    // could possibly have cleared sting_left by the time this test checks it.
    project.maps[project.project.titleMap].songId = null;
  });
  assert.equal(songFrameLength(project.songs[2]), 180, 'sanity: this test\'s own long sting should be exactly 180 frames');

  tap(nes, B, 5); // trigger the sting, leave it mid-flight
  assert.ok(nes.cpu.mem[0x0542] > 0, 'the sting should still be counting down before the player dies');

  // Walk into Doom. RIGHT is button 7 (renderer/emulator/core/controller.js: A=0, B=1, SELECT=2,
  // START=3, UP=4, DOWN=5, LEFT=6, RIGHT=7).
  const RIGHT = 7;
  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  assert.notEqual(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'never died');

  const START = 3;
  const ST_TITLE = 3;
  for (let i = 0; i < 600 && nes.cpu.mem[GAME_STATE] !== ST_TITLE; i++) {
    nes.buttonDown(1, START);
    nes.frame();
    nes.buttonUp(1, START);
    for (let j = 0; j < 8; j++) nes.frame();
  }
  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'a game over should lead back to the title');

  // init_session's own music_stop call is what clears sting_left -- an implementation missing that
  // line would leave the old session's own countdown running, eventually splicing its shadowed
  // song state over the fresh session's.
  assert.equal(
    nes.cpu.mem[0x0542],
    0,
    'sting_left should read 0 immediately after init_session runs, not merely once the stale countdown happens to reach it'
  );
});

// §12 test 11: RPG battle interaction -- confirmed directly (design-sting.md §5) that neither
// battle_begin nor battle_end touches music at all, so a sting keeps counting down straight
// through a battle exactly as it does outside one, and mid-battle behaves identically to outside
// one. Round-1 code review finding 2: the first draft of this test only proved the *mechanism* on
// the action side (ST_DIALOG, a real frozen-world state, but not ST_BATTLE) -- a wrong
// implementation that special-cases ST_BATTLE specifically (gating sting_tick on game_state, or
// clearing sting_left in battle_begin) would have passed it while breaking the design's own
// stated battle behavior. This is the real thing: a real RPG fixture, a real contact battle, and a
// sting timed to still be mid-flight when the battle starts and to resolve while the battle is
// still frozen open (the battle intro/menu never advances without player input, so waiting inside
// it is deterministic -- no combat is ever actually fought).
test('sting_left keeps counting down through a real RPG battle, and a mid-battle restore resumes the field song', {
  skip: !hasRpgRom && 'run `npm run sample:rpg && npm run build:sample:rpg` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sting-battle-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.songs[0] = fieldSong(); // the same 240-frame held note as the action-side fixtures
  // A dedicated, longer sting (12 rows -- 72 frames): the fixture's own contact is a handful of
  // frames away (see the relocated Slime below), and the battle's own intro/menu phase, once
  // reached, holds indefinitely without player input -- 72 frames comfortably spans "still
  // in-flight at battle start" and "resolves well inside the still-frozen battle," with room to
  // spare either way.
  project.songs[1] = {
    name: 'Fanfare',
    tempo: { framesPerRow: 6 },
    instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
    patterns: [{ id: 0, rows: 12, channels: { pulse1: [{ note: 60, inst: 0 }, ...Array(11).fill(null)] } }],
    order: [0],
    loop: 0
  };
  assert.equal(songFrameLength(project.songs[1]), 72, 'sanity: this test\'s own sting should be exactly 72 frames');
  project.maps[0].songId = 0; // Silence by default in sample-rpg; give it the field song
  // Wandering encounters off: the only battle this test's own walk can reach must be the one
  // placement below, or a random roll along the way would make the timing this test depends on
  // (contact within a handful of frames) unpredictable.
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  // The sting's own trigger, right next to the player's own start (112,112) -- fires the instant
  // the screen loads, well before the walk toward the monster below even begins.
  const stingerId = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id: stingerId,
    name: 'Stinger',
    behavior: 'npc'
  });
  project.maps[0].screens[0].entities.push({
    actorId: stingerId,
    x: 96,
    y: 96,
    props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 1 }] }] } }
  });
  // The sample's own "Slime" (actor 0, real battle stats already) relocated from its usual
  // bottom-right corner to right next to the player start, so a single directional tap makes
  // contact in a small, known number of frames instead of the long, timing-uncertain walk
  // rpg.test.js's own equivalent fixture uses.
  const slimeEntity = project.maps[0].screens[0].entities.find((entity) => entity.actorId === 0);
  assert.ok(slimeEntity, 'expected sample-rpg to already place the Slime actor on screen 0');
  slimeEntity.x = 136;
  slimeEntity.y = 112;

  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 30; i++) nes.frame(); // boot settle + the 'enter' trigger firing

  const STING_LEFT = 0x0542;
  assert.ok(nes.cpu.mem[STING_LEFT] > 0, 'the sting should already be counting down before the walk toward the Slime begins');

  const RIGHT = 7;
  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 40 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking toward the relocated Slime did not start a battle');

  const leftAtBattleStart = nes.cpu.mem[STING_LEFT];
  assert.ok(leftAtBattleStart > 0, 'the sting should still be mid-flight the moment the battle starts');

  // Still counting down a few frames into the battle -- not gated on game_state, not cleared by
  // battle_begin.
  for (let i = 0; i < 10; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'the battle should still be open (no input has advanced it)');
  const leftMidBattle = nes.cpu.mem[STING_LEFT];
  assert.ok(
    leftMidBattle < leftAtBattleStart,
    `sting_left should keep counting down through the battle (${leftAtBattleStart} -> ${leftMidBattle}) -- an ` +
      'implementation gating sting_tick on game_state, or clearing sting_left in battle_begin, would stall or ' +
      'zero it here instead'
  );

  // Run out the rest of the sting's own duration, still inside the same still-open battle, and
  // confirm the restore actually happens -- not merely that the counter reached 0, but that the
  // field song is genuinely resumed (cur_song/mus_enabled correct, and a real APU period write
  // accompanies it, the same standard test 5 holds the field-side resume to).
  const APU_LOW = 0x4000;
  const APU_HIGH = 0x400f;
  let sawPeriodWrite = false;
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address === 0x4002 || address === 0x4003) sawPeriodWrite = true;
    return originalWrite(address, value);
  };
  for (let i = 0; i < leftMidBattle + 5 && nes.cpu.mem[STING_LEFT] > 0; i++) nes.frame();
  assert.equal(nes.cpu.mem[STING_LEFT], 0, 'the sting should have resolved to 0 well before this budget ran out');
  // The retrigger write itself lands one frame after sting_left reaches 0 -- sting_restore (called
  // by sting_tick, right after that same frame's own music_tick already ran) is what sets
  // force_trig; music_channel only checks force_trig on the FOLLOWING frame's music_tick, the
  // same one-frame relationship test 5 and test 14 already establish for the field-song case
  // outside battle. Keep observing for a few more frames rather than checking on the exact frame
  // sting_left hit 0, or this would miss the write entirely.
  for (let i = 0; i < 3; i++) nes.frame();
  assert.equal(
    nes.cpu.mem[GAME_STATE],
    ST_BATTLE,
    'the battle must still be open when the sting resolves -- this is the "mid-battle" the test is about, ' +
      'not a resume that happened to land after the battle already ended'
  );
  assert.equal(nes.cpu.mem[CUR_SONG], FIELD_SONG, 'cur_song should read the field song again once the mid-battle resume has happened');
  assert.equal(nes.cpu.mem[MUS_ENABLED], 1, 'the field song should be audible again after the mid-battle resume');
  assert.ok(sawPeriodWrite, 'a real pulse period write should accompany the mid-battle resume, not just the shadow bytes');
});

// §12 test 12 (round-1 finding 8): the runtime NO_SONG/zero-duration guard actually engages.
// validateProject refuses this at build time -- confirmed directly, generateAssets (which
// buildProject always calls) raises before nesasm ever runs -- so reaching the engine with this
// operand at all needs a ROM that did not go through that check, the exact hand-edited/
// later-version-project case the guard exists for. Simulated the most direct way available: build
// a real, valid ROM (a live Sting naming STING_SONG, confirmed compiling to [OP_STING, 1, 18] by
// the wire-format test above) and binary-patch that exact three-byte sequence to
// [OP_STING, NO_SONG, 0] in the assembled ROM file itself, then boot the patched copy -- closer to
// how this operand could really reach a cartridge (a hex-edited ROM, or a hand-edited compiled
// build artifact) than fabricating a second code path around validateProject would be.
test('an [OP_STING, NO_SONG, 0] operand (patched past validateProject) stops the event, not merely the sting', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // A Set switch after the Sting -- an observable command whose only job is to prove whether the
  // page kept running past the patched operand. Round-1 code review finding 3: the first draft of
  // this test had nothing after the invalid Sting, so a regression back to the rejected
  // skip-and-continue behavior (silently falling through to script_run instead of jmp
  // script_finish) would still leave sting_left == 0, cur_song == FIELD_SONG and mus_enabled == 1
  // -- passing every assertion this test had. The guard's real, shipped behavior is "stop the
  // event" (jmp script_finish, the script_op_give/NO_ITEM family shape -- see engine/script.asm,
  // engine/constants.asm, main/build/textcompile.js), which this command after it is what actually
  // distinguishes from skip-and-continue.
  const { romPath } = await buildWith(t, [
    { op: 'sting', song: STING_SONG },
    { op: 'setSwitch', switch: 5 }
  ]);
  const rom = fs.readFileSync(romPath);
  const needle = Buffer.from([OP_STING, STING_SONG, STING_FRAMES]);
  const at = rom.indexOf(needle);
  assert.ok(at >= 0, 'could not find the compiled [OP_STING, 1, 18] sequence in the built ROM to patch');
  assert.equal(
    rom.indexOf(needle, at + 1),
    -1,
    'the three-byte sequence must be unique in the ROM, or the patch below could hit the wrong occurrence'
  );
  const patched = Buffer.from(rom);
  patched[at + 1] = 0xff; // NO_SONG
  patched[at + 2] = 0; // duration
  const patchedPath = path.join(os.tmpdir(), `forge-sting-nosong-${process.pid}-${Date.now()}.nes`);
  fs.writeFileSync(patchedPath, patched);
  t.after(() => fs.promises.rm(patchedPath, { force: true }));

  const bypassNes = boot(patchedPath);
  tap(bypassNes, B, 10);
  assert.equal(bypassNes.cpu.mem[0x0542], 0, 'sting_left should never have left 0 -- the guard must stop the event before ever arming it');
  assert.equal(bypassNes.cpu.mem[CUR_SONG], FIELD_SONG, 'the field song must be untouched by the guarded-off sting');
  assert.equal(bypassNes.cpu.mem[MUS_ENABLED], 1, 'the field song must still be audible');
  // switches (engine/constants.asm) is one bit per switch, eight bytes starting $0390 -- the same
  // reading convention shake.test.js's own "on" helper uses.
  const switch5On = Boolean(bypassNes.cpu.mem[0x390 + (5 >> 3)] & (1 << (5 & 7)));
  assert.equal(
    switch5On,
    false,
    'the Set switch after the invalid Sting must never run -- script_finish stops the event outright; a ' +
      'skip-and-continue regression would let it run anyway'
  );
});

// §12 test 14 (round-1 finding 6, sabotage claim narrowed in round-2 finding 5): the load-bearing
// order is sting_tick after music_tick, not "immediately adjacent to it" -- confirmed directly
// that flash_tick touches neither music nor the APU, so this can only ever prove the former.
//
// The sting's own compiled stream (a single 18-frame sustained note) only ever sets mus_trig
// once, on its own first tick -- by its last frame it produces no further period writes on its
// own, so a period write appearing there can only come from one place: sting_restore's own
// force-retrigger of the resumed field song, fired early. That is exactly what the wrong
// (sting_tick before music_tick) order would do: sting_restore would run and force_trig the field
// song BEFORE that same frame's own music_tick, so the resume's own period write would land one
// frame early, on the sting's own last frame, instead of the frame after it.
test('sting_tick running after music_tick is what keeps the resumed song\'s own retrigger off the sting\'s last frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [{ op: 'sting', song: STING_SONG }]);
  const { writesPerFrame, songWrites } = trace(nes, 40, tapAt(B, 0));
  const triggerFrame = songWrites.find((w) => w.value === STING_SONG)?.frame;
  assert.ok(triggerFrame !== undefined, 'the sting never triggered');
  const lastStingFrame = triggerFrame + STING_FRAMES; // sting_tick's own dec-to-zero frame
  const resumeFrame = lastStingFrame + 1;

  assert.ok(
    !periodWrite(writesPerFrame[lastStingFrame]),
    `frame ${lastStingFrame} (the sting's own last frame) must not show a pulse period write -- the sting's ` +
      'own note last triggered on its first frame and never retriggers again on its own, so a write here can ' +
      'only be the resumed field song\'s own force-retrigger firing one frame early, exactly what the ' +
      'prohibited (sting_tick before music_tick) order would produce'
  );
  assert.ok(
    periodWrite(writesPerFrame[resumeFrame]),
    `frame ${resumeFrame} should show the resumed field song's own retriggered note -- confirms the resume ` +
      'actually happens, not merely that it did not happen a frame early'
  );
});
