// SFX: item 6's own sound-effect slice, the second half after Sting.
// [OP_SFX, effect id or NO_SFX, duration in frames] -- steals the noise
// channel for a short, fixed-volume burst, then hands it back (to a live
// song, if one was playing) or silences it, exactly one frame after the
// effect's own last authored note. Does not suspend the script -- the same
// instant shape Sting/Turn/Wait/Shake/Visible/Flash already have. See
// handoff-sfx/design-sfx.md for the full design; this file is its §7 test
// plan, items 1-8 (the golden-trace/behavioral cases), 13, 14, 14a (whole-ROM
// identity), 18 (validateProject) and 19 (renumberSfxDeletion). Item 9's own
// per-board allowance measurements and item 15's documented-limitation
// refusals live in test/unit/kernelbytes.test.js; item 16's ordinal/route-leg
// cases live in test/unit/project.test.js; item 17's pure compiler unit tests
// live in test/unit/music.test.js alongside compileSong's own.
//
// Everything builds its own project rather than touching `sample/`, which is
// a checked-in fixture -- the same shape sting.test.js already uses.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { compileText, opIndex, OP_SFX } from '../../main/build/textcompile.js';
import { compileSfx, sfxTables } from '../../main/build/songcompile.js';
import { checkCapacity } from '../../main/build/generate.js';
import {
  createProject,
  projectUsesSfx,
  validateProject,
  renumberSfxDeletion,
  LIMITS
} from '../../shared/project.js';
import { sfxFrameLength, normalizeSfx, NO_SFX, SFX_MAX_STEPS } from '../../shared/audio.js';
import { SfxReplayer } from '../../renderer/forges/sound/replayer.js';
import { parseEquates } from '../../shared/enginesyms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM (engine/constants.asm).
const GAME_STATE = 0x25;
const CUR_SONG = 0x8b;
const MUS_ENABLED = 0x2d;
const ST_GAMEPLAY = 0;
const ST_GAMEOVER = 4;
const B = 1;
const SFX_STATE = 0x0568; // engine/constants.asm
const SFX_LEFT = 0x056e;
const MUS_DUR = 0x0348; // engine/constants.asm, @size=MUS_CHANNELS
const MUS_DUR_NOISE = MUS_DUR + 3; // channel index 3 -- SFX_CHANNEL
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

/**
 * A short, unmistakable effect: fixed volume 12, three steps (note 8 for 5
 * frames, note 12 for 5 frames, a rest for 3 frames) -- 13 authored frames
 * total (sfxFrameLength), comfortably inside the 255-frame ceiling
 * validateProject enforces, with a rest in the middle so the golden trace
 * exercises both the sounding and the resting branch of sfx_apply, not just
 * one.
 */
function effectA() {
  return { name: 'Blip', volume: 12, steps: [{ note: 8, duration: 5 }, { note: 12, duration: 5 }, { note: null, duration: 3 }] };
}
const EFFECT_A_FRAMES = 13; // sanity-checked below

/** A second, distinct effect for the replacement test -- different notes, shorter. */
function effectB() {
  return { name: 'Zap', volume: 5, steps: [{ note: 2, duration: 4 }] };
}
const EFFECT_B_FRAMES = 4;

/** A field song with one note held long enough that nothing in it naturally retriggers. */
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
 * Code review round 1, finding 5: fieldSong() above authors only pulse1, so
 * no test built on it can prove anything about the noise channel SFX
 * actually steals -- its own baseline comparison proves the *other* three
 * channels are untouched, never that the stolen one pauses and resumes. A
 * long held note (240 frames, comfortably longer than any single test run
 * below) on the noise channel too, so mus_dur/mus_note for channel 3 have
 * real, checkable state to pause and resume.
 */
function fieldSongWithNoise() {
  return {
    name: 'Field (with noise)',
    tempo: { framesPerRow: 6 },
    instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
    patterns: [{
      id: 0,
      rows: 40,
      channels: {
        pulse1: [{ note: 40, inst: 0 }, ...Array(39).fill(null)],
        noise: [{ note: 9, inst: 0 }, ...Array(39).fill(null)]
      }
    }],
    order: [0],
    loop: 0
  };
}

test('sanity: the fixture effects are exactly as long as the tests below assume', () => {
  assert.equal(sfxFrameLength(effectA()), EFFECT_A_FRAMES);
  assert.equal(sfxFrameLength(effectB()), EFFECT_B_FRAMES);
});

/**
 * A one-screen project with one talkable NPC carrying `commands`, 16px above
 * the player's own start position -- the identical placement sting.test.js
 * already uses. project.sfx defaults to [effectA(), effectB()] unless tweak
 * overrides it. project.songs[0] is left as the sample's own by default
 * (tweak can replace it or set songId to null for Silence).
 */
async function buildWith(t, commands, tweak = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.sfx = [effectA(), effectB()];
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
const REG_4015 = 0x4015;

/**
 * Records every $4000-$400F write, every $4015 write, and every cur_song
 * write, frame by frame -- the identical shape music.test.js's and
 * sting.test.js's own recordRomActivity/trace already use, widened to also
 * intercept $4015 (design-sfx.md §7 test 2's own "this test needs its own,
 * wider interception" finding: $4015 is a status register on read, so it
 * cannot be asserted by reading it back afterward -- only by intercepting
 * the write itself, at write-time).
 */
function trace(nes, frames, onFrame = () => {}) {
  const writesPerFrame = [];
  const reg4015WritesPerFrame = [];
  let current = [];
  let current4015 = [];
  const originalMmapWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address >= APU_LOW && address <= APU_HIGH) current.push([address, value & 0xff]);
    if (address === REG_4015) current4015.push(value & 0xff);
    return originalMmapWrite(address, value);
  };
  const songWrites = [];
  let frame = -1;
  const originalCpuWrite = nes.cpu.write.bind(nes.cpu);
  nes.cpu.write = (address, value) => {
    if (address === CUR_SONG) songWrites.push({ frame, value: value & 0xff });
    return originalCpuWrite(address, value);
  };
  for (let i = 0; i < frames; i++) {
    frame = i;
    current = [];
    current4015 = [];
    onFrame(i, nes);
    nes.frame();
    writesPerFrame.push(current);
    reg4015WritesPerFrame.push(current4015);
  }
  return { writesPerFrame, reg4015WritesPerFrame, songWrites };
}

/** onFrame callback for trace(): hold `button` on frame `at`, release on frame `at + 1`. */
const tapAt = (button, at) => (i, nes) => {
  if (i === at) nes.buttonDown(1, button);
  if (i === at + 1) nes.buttonUp(1, button);
};

const sfxRegisters = (writes) => writes.filter(([address]) => address === 0x400c || address === 0x400e || address === 0x400f);

// ------------------------------------------------------ format (§7 test 17)

test('sfxFrameLength sums step durations, including a null-note rest', () => {
  assert.equal(sfxFrameLength({ steps: [{ note: 5, duration: 3 }, { note: null, duration: 4 }, { note: 0, duration: 1 }] }), 8);
  assert.equal(sfxFrameLength({ steps: [] }), 1, 'an empty steps array normalizes to one rest step of duration 1');
});

test('compileSfx emits the leading volume byte, note/rest/duration pairs in order, and a defensive trailing rest', () => {
  const compiled = compileSfx({ volume: 20, steps: [{ note: 8, duration: 5 }, { note: null, duration: 3 }] });
  // Volume clamped 0-15 (20 -> 15 via normalizeSfx's own clamp).
  assert.equal(compiled.bytes[0], 15, 'volume must be clamped into 0-15');
  assert.deepEqual(
    compiled.bytes,
    [15, 8, 5, 0xfe, 3, 0xfe, 0],
    'a real note, then a rest (0xFE, the shared OP_REST byte), then the defensive trailing rest/0 terminator'
  );
});

test('compileSfx clamps an out-of-range note into 0-15, per finding 7', () => {
  const compiled = compileSfx({ volume: 10, steps: [{ note: 40, duration: 2 }] });
  // normalizeSfx clamps note into 0-15 before compileSfx ever sees it.
  assert.equal(compiled.bytes[1], 15, 'a note above 15 must clamp to 15, not silently wrap or overflow into an opcode byte');
});

test('normalizeSfx truncates steps to SFX_MAX_STEPS and clamps every field into range', () => {
  const raw = {
    name: 'Long',
    volume: 99,
    steps: Array.from({ length: SFX_MAX_STEPS + 5 }, (_, i) => ({ note: 100 + i, duration: 999 }))
  };
  const normalized = normalizeSfx(raw);
  assert.equal(normalized.steps.length, SFX_MAX_STEPS, `must truncate to exactly ${SFX_MAX_STEPS} steps, not fewer or more`);
  for (const step of normalized.steps) {
    assert.ok(step.note >= 0 && step.note <= 15, `note ${step.note} must clamp into 0-15`);
    assert.ok(step.duration >= 1 && step.duration <= 255, `duration ${step.duration} must clamp into 1-255`);
  }
  assert.ok(normalized.volume >= 0 && normalized.volume <= 15, 'volume must clamp into 0-15');
});

test('normalizeSfx falls back to one rest step when raw.steps is empty', () => {
  const normalized = normalizeSfx({ steps: [] });
  assert.deepEqual(normalized.steps, [{ note: null, duration: 1 }]);
});

test('sfxTables([]) emits both pointer-table labels with zero data bytes', () => {
  const emitted = sfxTables([]);
  assert.match(emitted, /sfx_ptr_table_lo:/);
  assert.match(emitted, /sfx_ptr_table_hi:/);
  // No .db line for either table's own data row, and no per-effect sfxN:
  // label at all -- an empty catalog costs nothing, per §3.10.
  assert.doesNotMatch(emitted, /sfx0:/);
  assert.equal(
    (emitted.match(/\.db/g) ?? []).length,
    0,
    'an empty catalog must emit no .db data rows at all, only the two empty pointer-table labels'
  );
});

// ------------------------------------------------------------------- wire

test('an SFX compiles to its opcode plus an effect index and a duration byte, and the opcode agrees with the engine', async () => {
  const constants = parseEquates(await fs.promises.readFile(path.join(ROOT, 'engine/constants.asm'), 'utf8'));
  assert.equal(constants.OP_SFX, 0x1b, "engine/constants.asm's own OP_SFX must read $1B");
  assert.equal(
    OP_SFX,
    constants.OP_SFX,
    "main/build/textcompile.js's exported OP_SFX must agree with engine/constants.asm's numeric definition"
  );
  assert.equal(opIndex('sfx'), OP_SFX, "OP_SFX should equal opIndex('sfx') exactly");

  const project = createProject('SFX wire');
  project.sfx = [{ name: 'A' }, effectA()];
  project.commonEvents = [
    { id: 0, name: 'Cue', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: 1 }] }] } }
  ];
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(OP_SFX);
  assert.ok(at >= 0, 'the compiled events should contain an OP_SFX');
  assert.deepEqual(
    bytes.slice(at, at + 3),
    [OP_SFX, 1, EFFECT_A_FRAMES],
    'an SFX is exactly three bytes -- opcode, effect index, and the compiler-computed duration'
  );
});

test('projectUsesSfx ignores an SFX the compiler would drop', () => {
  const project = createProject('Predicate');
  project.sfx = [effectA()];
  const pages = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'sfx', sfx: 0 }]) }];
  assert.equal(projectUsesSfx(project), true, 'a live SFX counts');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'sfx', sfx: 0, off: true }]) }];
  assert.equal(projectUsesSfx(project), false, 'a switched-off one does not');

  project.commonEvents = [
    { id: 0, name: 'E', event: pages([{ op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'sfx', sfx: 0 }], else: [] }]) }
  ];
  assert.equal(projectUsesSfx(project), true, 'an SFX nested inside a branch still counts');
});

// ---------------------------------------------------------- byte identity

test('a switched-off SFX costs a project nothing -- not one byte of ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // The same authored catalog on both sides (design-sfx.md §7 test 13's own
  // correction): pinning project.sfx identically on both builds is what
  // isolates the `off` flag's own cost, rather than the narrower and now-false
  // claim that an unreferenced effect costs nothing at all (test 14a below).
  const withOff = await buildWith(t, [
    { op: 'sfx', sfx: 0, off: true },
    { op: 'setSwitch', switch: 5 }
  ]);
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);
  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a disabled SFX must leave the ROM identical to a build with no live SFX command, given the same authored catalog'
  );
});

test('no authored effects and no live SFX command assembles byte-for-byte identical to a build from before SFX existed', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const withSfxEmpty = await buildWith(t, [{ op: 'setSwitch', switch: 5 }], (project) => {
    project.sfx = [];
  });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-noop-'));
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
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 5 }] }] } }
    }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  assert.deepEqual(
    [...fs.readFileSync(withSfxEmpty.romPath)],
    [...fs.readFileSync(built.romPath)],
    'a project with project.sfx === [] and no live sfx command must build byte-identically to one with no sfx field touched at all'
  );
});

test('an authored-but-unreferenced effect costs exactly sfxSize(project.sfx) of kernel-hi, with SFX_ENABLED left off', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // The .nes file itself is bank-padded to a fixed size regardless of how
  // full the music/sfx bank actually is, so file length cannot show this --
  // checkCapacity's own sfxBytes (main/build/generate.js's sfxSize, the same
  // figure the Build panel's own capacity meter reads) is the real content
  // cost, the same reasoning kernelbytes.test.js already applies to kernel-lo
  // via nesasm's own usage table rather than file size.
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }], (project) => {
    project.sfx = [];
  });
  const withUnreferenced = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]); // project.sfx = [effectA(), effectB()] by default, never named by a command

  const capacityWithout = checkCapacity(without.project);
  const capacityWith = checkCapacity(withUnreferenced.project);
  const sfxTablesBytes =
    compileSfx(effectA()).bytes.length + 2 + (compileSfx(effectB()).bytes.length + 2); // + 2 pointer-table bytes per effect, per sfxSize
  assert.equal(capacityWithout.sfxBytes, 0, 'an empty catalog must cost nothing');
  assert.equal(
    capacityWith.sfxBytes,
    sfxTablesBytes,
    'an authored-but-unreferenced catalog must cost exactly sfxSize(project.sfx) of kernel-hi'
  );

  // project.songs mirrors this exactly for an authored-but-unreferenced song
  // (songTables' own pre-existing behavior) -- both formats agree on this
  // point, per design-sfx.md §7 test 14a's own doubled assertion.
  const songCapacityWithout = checkCapacity({ ...without.project, songs: [] });
  const songCapacityWith = checkCapacity({ ...without.project, songs: without.project.songs });
  assert.ok(
    songCapacityWith.musicBytes > songCapacityWithout.musicBytes,
    'an authored-but-unreferenced song must likewise cost real kernel-hi bytes, the same shape sfx now mirrors'
  );

  assert.equal(
    projectUsesSfx(withUnreferenced.project),
    false,
    'SFX_ENABLED must stay off -- an authored-but-unreferenced effect names no live command'
  );
  assert.equal(withUnreferenced.nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
});

// -------------------------------------------------------------- validation

test('validateProject refuses a live SFX naming nothing, an overlong effect, and too many effects', () => {
  const missing = createProject('Missing', 'action');
  missing.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: null }] }] } }
  });
  const missingErrors = validateProject(missing).filter((p) => p.severity === 'error');
  assert.ok(
    missingErrors.some((p) => /do not name a real effect/.test(p.message)),
    'a live SFX naming nothing should be refused'
  );

  const overlong = createProject('Overlong', 'action');
  overlong.sfx = [{ name: 'Long', volume: 15, steps: Array.from({ length: 8 }, () => ({ note: 0, duration: 255 })) }];
  overlong.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: 0 }] }] } }
  });
  const overlongErrors = validateProject(overlong).filter((p) => p.severity === 'error');
  assert.ok(
    overlongErrors.some((p) => /takes longer than 255 frames/.test(p.message)),
    'an effect over 255 frames should be refused'
  );

  const overCap = createProject('Over cap', 'action');
  overCap.sfx = Array.from({ length: LIMITS.sfx + 1 }, (_, index) => ({ name: `E${index}`, volume: 10, steps: [{ note: 0, duration: 1 }] }));
  const overCapErrors = validateProject(overCap).filter((p) => p.severity === 'error');
  assert.ok(
    overCapErrors.some((p) => new RegExp(`${LIMITS.sfx + 1} sound effects`).test(p.message)),
    'a project with more effects than LIMITS.sfx should be refused, naming the real over-count'
  );
});

// -------------------------------------------------------- renumbering

test('deleting an effect renumbers every reference, including one nested inside a branch', () => {
  const project = createProject('Renumber', 'action');
  project.sfx = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [
              {
                op: 'branch',
                cond: { type: 'none', arg: 0 },
                then: [{ op: 'sfx', sfx: 2 }],
                else: [{ op: 'sfx', sfx: 0 }]
              },
              { op: 'sfx', sfx: 1 } // the one being deleted
            ]
          }
        ]
      }
    }
  });
  renumberSfxDeletion(project, 1);
  const page = project.maps[0].screens[0].entities[0].props.event.pages[0];
  assert.equal(page.commands[0].then[0].sfx, 1, 'a reference above the deleted index renumbers down by one');
  assert.equal(page.commands[0].else[0].sfx, 0, 'a reference below the deleted index is untouched');
  assert.equal(page.commands[1].sfx, null, 'a reference to the deleted effect itself becomes null');
});

// ------------------------------------------------------------------ engine

test('an SFX does not suspend the event -- the next command runs the same frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'sfx', sfx: 0 },
    { op: 'setSwitch', switch: 5 }
  ]);
  tap(nes, B, 0);
  const on = (n) => Boolean(nes.cpu.mem[0x390 + (n >> 3)] & (1 << (n & 7)));
  assert.equal(on(5), true, 'the command after SFX must already have run -- SFX does not suspend the event');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
});

// §7 test 1: the golden trace. §7 test 3 (the final-frame drop and cleanup
// timing) is subsumed here: SfxReplayer models sfx_state's own two-phase
// cleanup exactly, so a frame-for-frame match across the whole effect PLUS
// one cleanup frame is a stronger claim than test 3's own narrower one and
// implies it. Built with the map's own song set to Silence (project.maps[0]
// .songId = null), so no other channel-3 writes from a live song can cross
// into the noise channel this test is comparing -- test 4 below is what
// isolates the "does an underlying song survive" question instead.
test('the ROM driver and SfxReplayer agree on every frame of a full effect, plus its cleanup frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [{ op: 'sfx', sfx: 0 }], (proj) => {
    proj.maps[0].songId = null; // Silence -- isolate the SFX's own writes completely
  });
  const { writesPerFrame, reg4015WritesPerFrame } = trace(nes, 30, tapAt(B, 0));

  // §7 test 2: a $4015 <- $0F write happened before the first SFX period/
  // length write, intercepted at write-time (not read back afterward -- see
  // trace()'s own header comment for why that would be unsound).
  const reg4015Frame = reg4015WritesPerFrame.findIndex((writes) => writes.includes(0x0f));
  assert.ok(reg4015Frame >= 0, '$4015 was never written $0F -- did the effect ever trigger?');

  const triggerFrame = reg4015Frame; // script_op_sfx writes $4015 on the same frame it arms the effect
  const start = triggerFrame + 1; // one frame past the decision -- music_tick already ran this frame

  const lengthWriteFrame = writesPerFrame.findIndex((writes) => writes.some(([address]) => address === 0x400e));
  assert.ok(
    lengthWriteFrame > reg4015Frame,
    `the first $400E (length) write landed on frame ${lengthWriteFrame}, not after the $4015 <- $0F write on frame ${reg4015Frame}`
  );

  // §7 test 1: the golden trace itself. Assert all four channel register
  // groups, not only $400C/$400E/$400F -- with the map silenced, $4000/
  // $4004/$4008 must never be written by anything servicing this effect.
  const replayer = new SfxReplayer(compileSfx(project.sfx[0]));
  replayer.trigger(EFFECT_A_FRAMES);
  for (let i = 0; i < EFFECT_A_FRAMES + 1; i++) {
    const expected = replayer.tick();
    const actual = writesPerFrame[start + i];
    assert.deepEqual(
      actual,
      expected,
      `APU writes differ on frame ${i} (ROM frame ${start + i}):\n` +
        `  ROM:      ${JSON.stringify(actual)}\n` +
        `  replayer: ${JSON.stringify(expected)}`
    );
    assert.ok(
      actual.every(([address]) => address === 0x400c || address === 0x400e || address === 0x400f),
      `frame ${i} wrote an unrelated channel register while servicing SFX: ${JSON.stringify(actual)}`
    );
  }

  // §7 test 3, restated directly rather than only implied by the frame-for-
  // frame match above: the last authored note's real value appears on its
  // own frame, and the channel is silenced on the frame immediately after --
  // never the same frame, never later. Effect A's own last step is a rest
  // (note: null), so its "last note" is silence at $30 -- confirmed by the
  // replayer trace already having asserted this exactly; this block adds the
  // ROM-side sanity check that the cleanup frame's own $400C write is $30
  // and that no further write happens the frame after that.
  const cleanupFrame = start + EFFECT_A_FRAMES;
  assert.deepEqual(writesPerFrame[cleanupFrame], [[0x400c, 0x30]], 'the cleanup frame must silence $400C and nothing else');
  assert.deepEqual(writesPerFrame[cleanupFrame + 1], [], 'the frame after cleanup must be completely silent -- the effect is idle');
});

// §7 test 4: an underlying song survives an active SFX unchanged, and its
// own paused note resumes correctly once the SFX hands back.
//
// Code review round 1, finding 5: fieldSong() authors only pulse1, so the
// old version of this test could not actually prove anything about the
// noise channel SFX steals -- its baseline comparison correctly proved the
// *other* three channels stay untouched, and its only post-cleanup
// assertion was MUS_ENABLED == 1 (a flag that is already true for the whole
// SFX and proves nothing about the noise channel specifically). Rebuilt
// with fieldSongWithNoise(): a real, held noise note the underlying song
// itself owns, so this test can assert directly that mus_dur for channel 3
// does not advance while SFX owns it (proving a genuine pause, not merely
// "nothing was heard") and that the cleanup frame's own hand-back produces a
// real $400E/$400F retrigger for that paused note.
test('an underlying song\'s own noise-channel note pauses while SFX owns the channel, and resumes with a real retrigger on the cleanup frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const baseline = await buildWith(t, [], (project) => {
    project.songs[0] = fieldSongWithNoise();
  });
  const { writesPerFrame: baselineWrites } = trace(baseline.nes, 30);

  const { nes, project } = await buildWith(t, [{ op: 'sfx', sfx: 0 }], (proj) => {
    proj.songs[0] = fieldSongWithNoise();
  });
  const { writesPerFrame, reg4015WritesPerFrame } = trace(nes, 30, tapAt(B, 0));
  const triggerFrame = reg4015WritesPerFrame.findIndex((writes) => writes.includes(0x0f));
  assert.ok(triggerFrame >= 0, 'the effect never triggered');

  // Every pulse/triangle write across the run must match the no-SFX baseline
  // for the identical frame -- "unchanged", not "absent" (design-sfx.md §7
  // test 4's own correction: music_apply writes every active channel's
  // volume/control register every frame, active-note or not).
  for (let i = 0; i < 30; i++) {
    const nonNoise = (writes) => writes.filter(([address]) => address !== 0x400c && address !== 0x400e && address !== 0x400f);
    assert.deepEqual(
      nonNoise(writesPerFrame[i]),
      nonNoise(baselineWrites[i]),
      `frame ${i}: the song's other three channels must match the no-SFX baseline exactly while SFX is active`
    );
  }

  const start = triggerFrame + 1;
  const cleanupFrame = start + EFFECT_A_FRAMES;

  // No progress/retrigger of the underlying song's own noise note while SFX
  // owns the channel -- mus_dur for channel 3 (the frames-left counter
  // music_channel would otherwise decrement every visit) must sit frozen
  // for the whole steal, not merely "produce no APU writes" (which a
  // channel silently ticking down to its own next, still-unheard note would
  // also satisfy).
  // A fresh, separately instrumented run (nes has already run past this
  // point via trace() above) so mus_dur can be sampled at every step.
  const dur2 = await buildWith(t, [{ op: 'sfx', sfx: 0 }], (proj) => {
    proj.songs[0] = fieldSongWithNoise();
  });
  const durSamples = [];
  for (let i = 0; i < cleanupFrame + 1; i++) {
    if (i === 0) dur2.nes.buttonDown(1, B);
    if (i === 1) dur2.nes.buttonUp(1, B);
    dur2.nes.frame();
    durSamples.push(dur2.nes.cpu.mem[MUS_DUR_NOISE]);
  }
  const duringSteal = durSamples.slice(start, cleanupFrame);
  assert.ok(
    duringSteal.every((value) => value === duringSteal[0]),
    `mus_dur for the noise channel changed while SFX owned it -- the underlying song's own note must be frozen, not ticking: ${JSON.stringify(duringSteal)}`
  );

  // The cleanup frame's own hand-back must be a real retrigger -- $400E/
  // $400F written, not merely a $400C volume byte.
  const cleanupWrites = writesPerFrame[cleanupFrame];
  assert.ok(
    cleanupWrites.some(([address]) => address === 0x400e) && cleanupWrites.some(([address]) => address === 0x400f),
    `frame ${cleanupFrame}: expected a real $400E/$400F retrigger on the cleanup/hand-back frame, got ${JSON.stringify(cleanupWrites)}`
  );
  assert.equal(nes.cpu.mem[MUS_ENABLED], 1, 'the field song must still be enabled once the SFX has cleaned up');
});

// §7 test 5: a second SFX replaces the first mid-flight.
test('a second SFX replaces the first mid-flight, with no trace of the first effect\'s remaining steps', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [{ op: 'sfx', sfx: 0 }], (proj) => {
    proj.maps[0].songId = null;
  });
  // Fire effect A, then walk far enough down that the first NPC (16px above
  // the player's start) falls outside REACH_RANGE (20px, engine/constants.asm)
  // while a second NPC (16px below start) comes into reach -- entity_in_reach
  // is a pure proximity check with no facing test, so without moving both
  // NPCs are simultaneously in reach from the player's start position and a
  // second bare interact would silently re-trigger effect A instead of ever
  // reaching effect B. PLAYER_SPEED is 2px/frame, so 6 frames of holding
  // down covers 12px -- comfortably placing A (28px away) out of reach and B
  // (4px away) still in it.
  const secondId = project.sprites.actors.length;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-replace-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: secondId, name: 'Zapper', behavior: 'npc' });
  project.maps[0].screens[0].entities.push({
    actorId: secondId,
    x: START_X,
    y: START_Y + 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: 1 }] }] } }
  });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const replayNes = boot(built.romPath);

  const DOWN = 5; // jsnes controller bit index (A,B,Select,Start,Up,Down,Left,Right)
  const { writesPerFrame, reg4015WritesPerFrame } = trace(replayNes, 30, (i, n) => {
    if (i === 0) n.buttonDown(1, B);
    if (i === 1) { n.buttonUp(1, B); n.buttonDown(1, DOWN); }
    if (i === 7) { n.buttonUp(1, DOWN); n.buttonDown(1, B); }
    if (i === 8) n.buttonUp(1, B);
  });

  const triggerFrames = [];
  reg4015WritesPerFrame.forEach((writes, index) => {
    if (writes.includes(0x0f)) triggerFrames.push(index);
  });
  assert.equal(triggerFrames.length, 2, `expected exactly two SFX triggers, got ${triggerFrames.length} at frames ${triggerFrames}`);
  const [, secondTrigger] = triggerFrames;
  assert.ok(
    secondTrigger < triggerFrames[0] + EFFECT_A_FRAMES,
    'the second trigger must land inside effect A\'s own still-playing window, or this is not testing a mid-flight replacement'
  );

  // From the frame after the second trigger onward, effect B's own replayer
  // trace should match exactly, with no residue of effect A's remaining
  // steps (which would have continued past note 12 into its own rest).
  const replayer = new SfxReplayer(compileSfx(project.sfx[1]));
  replayer.trigger(EFFECT_B_FRAMES);
  const start = secondTrigger + 1;
  for (let i = 0; i < EFFECT_B_FRAMES; i++) {
    const expected = replayer.tick();
    const actual = writesPerFrame[start + i];
    assert.deepEqual(
      actual,
      expected,
      `frame ${start + i}: effect B's own trace must replace effect A's completely -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    );
  }
});

// §7 test 6a: an ordinary song change survives an active SFX -- the effect's
// own trace continues uninterrupted. (§7 test 6b, the change-to-Silence
// case, follows immediately below.)
test('a Play music command survives an active SFX', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [{ op: 'sfx', sfx: 0 }], (proj) => {
    proj.songs[0] = fieldSong();
    proj.songs.push(fieldSong()); // song 1, a distinct target for the mid-SFX Play music
  });
  const secondId = project.sprites.actors.length;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-songchange-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: secondId, name: 'Jukebox', behavior: 'npc' });
  project.maps[0].screens[0].entities.push({
    actorId: secondId,
    x: START_X,
    y: START_Y + 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'music', song: 1 }] }] } }
  });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const replayNes = boot(built.romPath);

  // Walk away from the SFX NPC's own reach before interacting with the
  // Jukebox -- both are placed 16px from the player's start, and
  // entity_in_reach is a pure proximity check with no facing test, so
  // without moving a second bare interact would silently re-trigger the SFX
  // NPC again instead of ever reaching the Jukebox. See the identical fix in
  // the second-SFX-replacement test above for the full reasoning.
  const DOWN = 5; // jsnes controller bit index (A,B,Select,Start,Up,Down,Left,Right)
  const { writesPerFrame, reg4015WritesPerFrame } = trace(replayNes, 20, (i, n) => {
    if (i === 0) n.buttonDown(1, B);
    if (i === 1) { n.buttonUp(1, B); n.buttonDown(1, DOWN); }
    if (i === 7) { n.buttonUp(1, DOWN); n.buttonDown(1, B); } // change the song mid-SFX, well inside effect A's 13-frame run
    if (i === 8) n.buttonUp(1, B);
  });

  // $4015 <- $0F is written both by script_op_sfx's own trigger and by
  // music_play's success path (engine/music.asm) -- the Jukebox's own Play
  // music command legitimately writes it a second time when the new song
  // starts, so the *first* occurrence is the SFX's own trigger frame, not
  // "the only" one.
  const triggerFrame = reg4015WritesPerFrame.findIndex((writes) => writes.includes(0x0f));
  assert.ok(triggerFrame >= 0, 'the effect never triggered');

  const replayer = new SfxReplayer(compileSfx(project.sfx[0]));
  replayer.trigger(EFFECT_A_FRAMES);
  const start = triggerFrame + 1;
  for (let i = 0; i < EFFECT_A_FRAMES; i++) {
    const expected = replayer.tick();
    const actual = sfxRegisters(writesPerFrame[start + i]);
    assert.deepEqual(
      actual,
      expected,
      `frame ${i}: the SFX's own $400C/$400E/$400F trace must continue uninterrupted across the song change -- ` +
        `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    );
  }
  assert.equal(replayNes.cpu.mem[CUR_SONG], 1, 'the song change should have taken effect on the other three channels');
});

// §7 test 6b: a change to Silence (music_stop's own NO_SONG branch) survives
// an active SFX too -- music_stop's own ownership guard (§3.3, finding 4) is
// what this exercises directly: without it, an ordinary Play-Silence while
// an SFX is active would silence $400C out from under the effect.
test('a change to Silence survives an active SFX', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [{ op: 'sfx', sfx: 0 }], (proj) => {
    proj.songs[0] = fieldSong();
  });
  const secondId = project.sprites.actors.length;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-silence-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: secondId, name: 'Off switch', behavior: 'npc' });
  project.maps[0].screens[0].entities.push({
    actorId: secondId,
    x: START_X,
    y: START_Y + 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'music', song: null }] }] } }
  });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const replayNes = boot(built.romPath);

  const DOWN = 5;
  const { writesPerFrame, reg4015WritesPerFrame, songWrites } = trace(replayNes, 20, (i, n) => {
    if (i === 0) n.buttonDown(1, B);
    if (i === 1) { n.buttonUp(1, B); n.buttonDown(1, DOWN); }
    if (i === 7) { n.buttonUp(1, DOWN); n.buttonDown(1, B); }
    if (i === 8) n.buttonUp(1, B);
  });

  const triggerFrame = reg4015WritesPerFrame.findIndex((writes) => writes.includes(0x0f));
  assert.ok(triggerFrame >= 0, 'the effect never triggered');

  const replayer = new SfxReplayer(compileSfx(project.sfx[0]));
  replayer.trigger(EFFECT_A_FRAMES);
  const start = triggerFrame + 1;
  for (let i = 0; i < EFFECT_A_FRAMES; i++) {
    const expected = replayer.tick();
    const actual = sfxRegisters(writesPerFrame[start + i]);
    assert.deepEqual(
      actual,
      expected,
      `frame ${i}: the SFX's own $400C/$400E/$400F trace must continue uninterrupted across the change to Silence -- ` +
        `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    );
  }
  assert.equal(replayNes.cpu.mem[MUS_ENABLED], 0, 'the field song should have gone silent on the other three channels');

  // The direct proof of music_tick_loop's own mus_enabled re-check (design-
  // sfx.md §7's own sabotage note): once the field song has gone silent,
  // music_channel must never be called again for the other three channels --
  // an implementation missing that re-check would keep replaying the stale
  // song state there for as long as SFX kept music_tick's own top-level gate
  // (mus_enabled | sfx_state) open. music_stop's own one-time silencing
  // write ($30 to $4000/$4004, $00 to $4008) is legitimate and excluded by
  // starting the window one frame after the transition.
  const silenceFrame = songWrites.find((entry) => entry.value === 0xff)?.frame; // NO_SONG
  assert.ok(silenceFrame !== undefined, 'cur_song never took NO_SONG -- did the Silence change ever happen?');
  const otherChannelRegisters = new Set([0x4000, 0x4001, 0x4002, 0x4003, 0x4004, 0x4005, 0x4006, 0x4007, 0x4008, 0x4009, 0x400a, 0x400b]);
  for (let frame = silenceFrame + 1; frame < writesPerFrame.length; frame++) {
    const stale = writesPerFrame[frame].filter(([address]) => otherChannelRegisters.has(address));
    assert.deepEqual(
      stale,
      [],
      `frame ${frame}: a write to a non-SFX channel register happened after the field song went silent -- ` +
        `${JSON.stringify(stale)} -- music_tick_loop's own mus_enabled re-check must be missing`
    );
  }
});

// §7 test 7: a session reset cancels an active SFX.
// Code review round 1, finding 2: the original version of this test traced
// only 40 frames before starting to look for game over, at which point
// effectA (13 frames) had already completed naturally -- a build with no
// init_session SFX-clear block at all could still pass, since there would be
// nothing left playing to fail to cancel. It also installed its $400C
// observer only *after* game over had already happened, so an
// implementation that cleared sfx_state/sfx_left but forgot the actual
// $400C = $30 reset write (leaving the last latched note sounding forever)
// would also pass. Rebuilt per the review: a 200-frame held effect --
// comfortably longer than however many frames it actually takes to walk
// into the lethal actor and die, confirmed empirically below rather than
// assumed -- with sfx_state polled every frame so the test can assert it
// was genuinely non-zero on the frame immediately before the reset, the
// $400C observer installed before the trigger and kept live across the
// whole transition, and a real $400C = $30 write required to actually
// appear on the reset frame (not merely "no non-silent write ever again",
// which a stuck, already-silent channel would also satisfy).
test('a game over cancels an active SFX -- $400C is silenced by the frame after the reset and stays silent', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-reset-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // One long-held note, 200 frames -- see the header comment above for why.
  project.sfx = [{ name: 'Long', volume: 12, steps: [{ note: 8, duration: 200 }] }];
  project.maps[0].songId = null;
  // restart_game lands on the title screen, not fresh silent gameplay
  // (CLAUDE.md: "the title if there is one") -- confirmed empirically
  // (game_state read 3, ST_TITLE, after the reset below). Silencing the
  // title's own map song too is what makes "no later non-silent write"
  // actually mean what it claims: without this, the title's own unrelated
  // noise-channel music (a real, declining volume envelope, nothing to do
  // with SFX at all) fires false positives on exactly this assertion.
  if (project.project.titleMap !== null && project.project.titleMap !== undefined) {
    project.maps[project.project.titleMap].songId = null;
  }
  const npc = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: npc, name: 'Walker', behavior: 'npc' });
  const doomId = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id: doomId,
    name: 'Doom',
    behavior: 'npc',
    hp: 1,
    damage: 6
  });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: npc,
      x: START_X,
      y: START_Y - 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: 0 }] }] } }
    },
    { actorId: doomId, x: START_X + 40, y: START_Y, props: {} }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = boot(built.romPath);

  const RIGHT = 7;

  // The $400C observer is installed before anything runs and stays live for
  // the whole trace -- both the trigger and the reset happen while it is
  // watching, and every write (not merely non-silent ones) is recorded so
  // the reset frame's own write can be inspected directly. $4015 is watched
  // in the same interceptor to find the trigger frame the identical way
  // every other test in this file does.
  const noiseWritesPerFrame = [];
  let currentNoiseWrites = [];
  const sfxStatePerFrame = [];
  let reg4015Triggered = false;
  let triggerFrame = -1;
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address === 0x400c) currentNoiseWrites.push(value & 0xff);
    if (address === 0x4015 && (value & 0xff) === 0x0f && !reg4015Triggered) reg4015Triggered = true;
    return originalWrite(address, value);
  };

  // player_died (engine/combat.asm) sets game_state = ST_GAMEOVER directly
  // on the death frame, but init_session -- the actual reset that clears
  // sfx_state and silences $400C -- does not run until restart_game is
  // reached, which happens later, on Start (engine/title.asm's own game-over
  // path; CLAUDE.md: "Where a game over lands is restart_game... init_session
  // is the single definition of 'new game'"). So death and reset are two
  // different frames, confirmed empirically (a probe run found them 57
  // frames apart on this exact fixture) -- the frame to inspect for the
  // $400C = $30 write is wherever sfx_state actually reaches 0, not merely
  // wherever game_state first reads ST_GAMEOVER.
  let deathFrame = -1;
  let resetFrame = -1;
  const MAX_FRAMES = 400;
  for (let i = 0; i < MAX_FRAMES && resetFrame < 0; i++) {
    currentNoiseWrites = [];
    if (i === 0) nes.buttonDown(1, B); // trigger the effect
    if (i === 1) { nes.buttonUp(1, B); nes.buttonDown(1, RIGHT); } // then walk into the lethal actor
    if (deathFrame >= 0) {
      // Once dead, walking does nothing further -- tap Start repeatedly
      // (the same tap(START, 8)-shaped cadence music.test.js's own "game
      // over into a Silence map" test already uses) until restart_game
      // actually fires.
      const sinceDeath = i - deathFrame;
      if (sinceDeath % 16 < 2) nes.buttonDown(1, 3);
      else nes.buttonUp(1, 3);
    }
    nes.frame();
    noiseWritesPerFrame.push(currentNoiseWrites);
    sfxStatePerFrame.push(nes.cpu.mem[SFX_STATE]);
    if (triggerFrame < 0 && reg4015Triggered) triggerFrame = i;
    if (deathFrame < 0 && nes.cpu.mem[GAME_STATE] === ST_GAMEOVER) deathFrame = i;
    if (deathFrame >= 0 && nes.cpu.mem[SFX_STATE] === 0) resetFrame = i;
  }
  assert.ok(triggerFrame >= 0, 'the effect never triggered');
  assert.ok(deathFrame >= 0, `never reached game over within ${MAX_FRAMES} frames`);
  assert.ok(resetFrame >= 0, `sfx_state never reached 0 within ${MAX_FRAMES} frames -- restart_game/init_session may never have run`);
  assert.ok(
    resetFrame - triggerFrame < 200,
    `the reset took ${resetFrame - triggerFrame} frames after the trigger -- the 200-frame effect is not long enough to still be mid-flight; lengthen it`
  );

  // The load-bearing assertion the original test never made: sfx_state was
  // genuinely non-zero -- the effect was actually still playing, not merely
  // "not yet observed to have stopped" -- on the frame immediately before
  // the reset.
  assert.notEqual(
    sfxStatePerFrame[resetFrame - 1],
    0,
    `sfx_state read 0 on the frame before the reset (frame ${resetFrame - 1}) -- the effect had already finished naturally, so this test cannot prove init_session's own clear block did anything`
  );

  // The reset frame itself must contain a real $400C = $30 write -- not
  // merely "the last write recorded happened to be $30 already", which a
  // channel that was already silent (or stuck at its last latched value,
  // with a clear that forgot the actual write) would also satisfy. The
  // frame's own write order (confirmed by probe: [$3C, $30]) is exactly
  // "music_tick still applies this frame's ordinary SFX output first, then
  // dispatch_input's own Start handling reaches restart_game/init_session
  // later the same frame" -- both writes are expected, and only the second
  // one is the reset; requiring $30 to be *among* this frame's writes (not
  // the only one) is the correct, non-brittle assertion.
  const resetFrameWrites = noiseWritesPerFrame[resetFrame];
  assert.ok(
    resetFrameWrites.includes(0x30),
    `frame ${resetFrame} (the reset frame) never wrote $400C = $30 -- got ${JSON.stringify(resetFrameWrites)}`
  );

  // sfx_state and sfx_left must both read 0 immediately after.
  assert.equal(nes.cpu.mem[SFX_STATE], 0, 'sfx_state should be 0 immediately after the reset');
  assert.equal(nes.cpu.mem[SFX_LEFT], 0, 'sfx_left should be 0 immediately after the reset');

  // And no later non-silent $400C write -- the channel stays cancelled, not
  // merely momentarily silenced. Start is released explicitly first: it may
  // still read held from the tap cadence above, and a held Start on the
  // title screen this lands on would start a fresh game on the very next
  // frame, which is not what this final check is about.
  nes.buttonUp(1, 3);
  let sawNonSilence = false;
  nes.mmap.write = (address, value) => {
    if (address === 0x400c && (value & 0xff) !== 0x30) sawNonSilence = true;
    return originalWrite(address, value);
  };
  for (let i = 0; i < 30; i++) nes.frame();
  assert.equal(sawNonSilence, false, 'no non-silent $400C write should occur once the session has reset -- the SFX must be cancelled outright');
});

// §7 test 8 (one of several named orderings in design-sfx.md §3.4 -- the
// mechanically load-bearing one: fix round 3's own correction that the
// hand-back tail-call (sfx_channel_tick -> jmp music_channel) resolves on
// the *same* frame as SFX's own cleanup, not the next ordinary music_channel
// visit). SFX ends first while a Sting is still audible: the cleanup frame
// must show a real retriggered note from the sting's own paused noise
// content, not silence, and it must land on the cleanup frame itself.
//
// The other orderings §3.4 names -- ordinary hand-off with the sting ending
// first into an audible song or into Silence on a *different* frame than
// SFX's own cleanup, and the exact-co-end / sting-restores-Silence
// truncation sub-case -- are traced in the design document. The ordinary
// hand-off cases are straightforward consequences of the two ownership
// guards already covered by tests 6/7 above. The exact-co-end case (both
// sfx_left and sting_left reaching zero on the identical frame) was
// originally scoped out of this file as disproportionate to build
// deterministically; that judgment did not hold up to code review round 1's
// own deterministic construction (consecutive non-suspending SFX/Sting
// commands in one event, Sting exactly one frame longer than the SFX's
// playing duration) and is now covered directly, both the Silence-restore
// and audible-restore sub-cases, by the two exact-co-end tests further down
// this file. See handoff-sfx/sfx-implementation-report.md §7 for the
// superseded scope-reduction history and its own closure note.
test('SFX ending first hands the channel back to a still-audible Sting on the exact same frame as its own cleanup', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-sting-handback-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // A long sting (42 frames) with real, held content on the noise channel --
  // unlike sting.test.js's own stingSong() (pulse1 only), this one needs an
  // audible noise part for the hand-back to retrigger something verifiable.
  project.songs[1] = {
    name: 'Fanfare',
    tempo: { framesPerRow: 6 },
    instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
    patterns: [{ id: 0, rows: 7, channels: { pulse1: [{ note: 60, inst: 0 }, ...Array(6).fill(null)], noise: [{ note: 5, inst: 0 }, ...Array(6).fill(null)] } }],
    order: [0],
    loop: 0
  };
  project.sfx = [effectB()];
  const stingNpc = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: stingNpc, name: 'Sting', behavior: 'npc' });
  const sfxNpc = stingNpc + 1;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: sfxNpc, name: 'SFX', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: stingNpc,
      x: START_X,
      y: START_Y - 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 1 }] }] } }
    },
    {
      actorId: sfxNpc,
      x: START_X,
      y: START_Y + 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: 0 }] }] } }
    }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = boot(built.romPath);

  const DOWN = 5;
  const { writesPerFrame, reg4015WritesPerFrame } = trace(nes, 20, (i, n) => {
    if (i === 0) n.buttonDown(1, B); // trigger the sting immediately (adjacent, no walk needed)
    if (i === 1) { n.buttonUp(1, B); n.buttonDown(1, DOWN); }
    if (i === 7) { n.buttonUp(1, DOWN); n.buttonDown(1, B); } // then walk to and trigger the SFX
    if (i === 8) n.buttonUp(1, B);
  });

  // script_op_sting also routes through music_play, which writes $4015 <-
  // $0F on its own success path (engine/music.asm) -- so the sting's own
  // trigger at frame 0 writes it too, and the SFX's own trigger (frame ~7,
  // after the walk) is the *second* occurrence, not the first.
  const triggerFrames = [];
  reg4015WritesPerFrame.forEach((writes, index) => {
    if (writes.includes(0x0f)) triggerFrames.push(index);
  });
  assert.equal(triggerFrames.length, 2, `expected one $4015 write from the sting's own music_play and one from the SFX, got ${triggerFrames.length} at frames ${triggerFrames}`);
  const [, sfxTrigger] = triggerFrames;

  const cleanupFrame = sfxTrigger + 1 + EFFECT_B_FRAMES;
  const cleanupWrites = writesPerFrame[cleanupFrame];
  assert.notDeepEqual(
    cleanupWrites,
    [[0x400c, 0x30]],
    `frame ${cleanupFrame}: the cleanup frame wrote plain silence -- the hand-back into the still-audible sting never happened`
  );
  assert.ok(
    cleanupWrites.some(([address]) => address === 0x400e),
    `frame ${cleanupFrame}: the cleanup frame should have retriggered the sting's own paused noise note ($400E), on this exact frame, not a later one`
  );
  assert.equal(nes.cpu.mem[MUS_ENABLED], 1, 'the sting should still be audible at this point');
});

// A second §3.4 ordering, and the one a sabotage pass during implementation
// found this file did not yet cover: "Sting ends first into Silence, SFX
// still active." sting_restore_silence's own ownership guard (ldy sfx_state
// / bne skip) must skip its $400C write while SFX still owns the channel --
// confirmed here by inverting that one branch (bne -> beq) during
// implementation, which broke nothing in this file's own then-existing
// tests (none of them had a sting resolving into Silence while SFX was
// simultaneously active) but is caught directly by this test's own
// assertion. See sfx-implementation-report.md's own sabotage-evidence
// section.
test('a Sting resolving into Silence while an SFX is still active leaves the SFX\'s own note untouched', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-sting-silence-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].songId = null; // the field itself is Silence, so the sting restores into it
  // A short sting (3 frames) so it resolves well inside effect A's own
  // 13-frame run, specifically inside its second step (note 12, frames 6-10
  // relative to the SFX's own first playing frame) -- a real, non-rest note,
  // so an overwritten $400C is unambiguous.
  project.songs[1] = {
    name: 'Fanfare',
    tempo: { framesPerRow: 1 },
    instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
    patterns: [{ id: 0, rows: 3, channels: { pulse1: [{ note: 60, inst: 0 }, null, null] } }],
    order: [0],
    loop: 0
  };
  project.sfx = [effectA()];
  const sfxNpc = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: sfxNpc, name: 'SFX', behavior: 'npc' });
  const stingNpc = sfxNpc + 1;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: stingNpc, name: 'Sting', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: sfxNpc,
      x: START_X,
      y: START_Y - 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: 0 }] }] } }
    },
    {
      actorId: stingNpc,
      x: START_X,
      y: START_Y + 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 1 }] }] } }
    }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = boot(built.romPath);

  const DOWN = 5;
  const { writesPerFrame, reg4015WritesPerFrame, songWrites } = trace(nes, 20, (i, n) => {
    if (i === 0) n.buttonDown(1, B); // trigger the SFX immediately (adjacent, no walk needed)
    if (i === 1) { n.buttonUp(1, B); n.buttonDown(1, DOWN); }
    if (i === 7) { n.buttonUp(1, DOWN); n.buttonDown(1, B); } // then walk to and trigger the sting
    if (i === 8) n.buttonUp(1, B);
  });

  // The SFX's own trigger writes $4015; the sting's own trigger (through
  // music_play) writes it too -- the first occurrence is the SFX's.
  const triggerFrames = [];
  reg4015WritesPerFrame.forEach((writes, index) => {
    if (writes.includes(0x0f)) triggerFrames.push(index);
  });
  assert.equal(triggerFrames.length, 2, `expected one $4015 write from the SFX and one from the sting's own music_play, got ${triggerFrames.length} at frames ${triggerFrames}`);
  const [sfxTrigger] = triggerFrames;

  // The sting resolves (sting_restore_silence runs) when cur_song returns to
  // NO_SONG.
  const restoreFrame = songWrites.find((entry) => entry.value === 0xff && entry.frame > triggerFrames[1])?.frame;
  assert.ok(restoreFrame !== undefined, 'the sting never resolved back into Silence');

  // effect A's own SfxReplayer trace tells us what $400C should read on that
  // exact frame, independent of anything the sting does.
  const replayer = new SfxReplayer(compileSfx(project.sfx[0]));
  replayer.trigger(EFFECT_A_FRAMES);
  const start = sfxTrigger + 1;
  let expectedAtRestore = null;
  for (let i = 0; i <= restoreFrame - start; i++) {
    const writes = replayer.tick();
    if (start + i === restoreFrame) expectedAtRestore = writes;
  }
  assert.ok(expectedAtRestore, 'the restore frame fell outside the effect\'s own playing window -- recheck the sting duration');
  const expectedNoiseValue = expectedAtRestore.find(([address]) => address === 0x400c)?.[1];
  assert.ok(expectedNoiseValue !== undefined && expectedNoiseValue !== 0x30, 'this case needs a real, non-rest SFX note at the restore frame to be unambiguous -- recheck the sting duration');

  const actualNoiseWrites = writesPerFrame[restoreFrame].filter(([address]) => address === 0x400c);
  const lastNoiseWrite = actualNoiseWrites[actualNoiseWrites.length - 1]?.[1];
  assert.equal(
    lastNoiseWrite,
    expectedNoiseValue,
    `frame ${restoreFrame}: the sting's own resolution into Silence overwrote the SFX's own active note ` +
      `($400C ended the frame as ${lastNoiseWrite}, expected ${expectedNoiseValue}) -- sting_restore_silence's own ` +
      'ownership guard must skip its $400C write while sfx_state is non-zero'
  );
});

// Code review round 1, finding 4: the exact-co-end case, design-sfx.md §3.4's
// own "honest, narrowed contract" -- both sfx_left and sting_left reaching
// their own end on the identical frame. Built deterministically, per the
// review's own construction: a non-suspending SFX and a non-suspending
// Sting placed consecutively in one event so both arm on the same script
// frame, with the Sting's own duration set to exactly one frame longer than
// the SFX's playing duration (4-frame SFX, 5-frame Sting) -- sfx_channel_tick
// runs before sting_tick every frame (engine/boot.asm's own fixed order), so
// SFX's own cleanup phase (state 2, on frame trigger+1+4=trigger+5) always
// lands on the identical frame sting_left decrements to 0 (frame
// trigger+5), with no calibration build or two independent user
// interactions needed.
const COEND_SFX_FRAMES = 4;
const COEND_STING_FRAMES = COEND_SFX_FRAMES + 1;

function coEndSting() {
  return {
    name: 'Fanfare',
    tempo: { framesPerRow: 1 },
    instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
    patterns: [{
      id: 0,
      rows: COEND_STING_FRAMES,
      channels: {
        pulse1: [{ note: 60, inst: 0 }, ...Array(COEND_STING_FRAMES - 1).fill(null)],
        // A real, held noise note -- the co-end frame's own truncated (or,
        // in the audible-restore variant, correctly untouched) content.
        noise: [{ note: 9, inst: 0 }, ...Array(COEND_STING_FRAMES - 1).fill(null)]
      }
    }],
    order: [0],
    loop: 0
  };
}

test('the exact co-end, sting-restores-into-Silence sub-case: SFX\'s own hand-back retrigger is truncated by sting_restore_silence\'s unconditional write, same frame, in that order', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-coend-silence-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].songId = null; // the field itself is Silence -- the sting restores into it
  project.songs[1] = coEndSting();
  project.sfx = [effectB()]; // COEND_SFX_FRAMES (4) matches EFFECT_B_FRAMES exactly
  const npc = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: npc, name: 'Both', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: npc,
      x: START_X,
      y: START_Y - 16,
      // Both non-suspending: consecutive in one page, so both arm on the
      // same script frame.
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: 0 }, { op: 'sting', song: 1 }] }] } }
    }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = boot(built.romPath);

  const { writesPerFrame, reg4015WritesPerFrame } = trace(nes, 15, tapAt(B, 0));
  const triggerFrame = reg4015WritesPerFrame.findIndex((writes) => writes.includes(0x0f));
  assert.ok(triggerFrame >= 0, 'the SFX never triggered');

  const coEndFrame = triggerFrame + 1 + COEND_SFX_FRAMES;
  const coEndWrites = sfxRegisters(writesPerFrame[coEndFrame]);
  // The pinned write order design-sfx.md §3.4 itself specifies: the
  // retriggered sting content first ($400C, then its own $400E/$400F period
  // pair), then $400C = $30 second, overwriting it within the same frame.
  assert.ok(
    coEndWrites.length >= 4,
    `frame ${coEndFrame}: expected at least 4 register writes (the retrigger's own $400C/$400E/$400F, then a truncating $400C=$30), got ${JSON.stringify(coEndWrites)}`
  );
  const noiseWriteIndices = coEndWrites.map(([address], index) => (address === 0x400c ? index : -1)).filter((i) => i >= 0);
  assert.ok(noiseWriteIndices.length >= 2, `frame ${coEndFrame}: expected $400C written at least twice (retrigger, then truncation) -- got ${JSON.stringify(coEndWrites)}`);
  const [firstNoiseIndex, secondNoiseIndex] = noiseWriteIndices;
  assert.notEqual(coEndWrites[firstNoiseIndex][1], 0x30, `frame ${coEndFrame}: the first $400C write should be the sting's own real retriggered note, not silence -- got ${JSON.stringify(coEndWrites)}`);
  assert.equal(coEndWrites[secondNoiseIndex][1], 0x30, `frame ${coEndFrame}: the second $400C write should be sting_restore_silence's own truncating $30 -- got ${JSON.stringify(coEndWrites)}`);
  // And a real period pair between the two $400C writes -- the retrigger
  // genuinely reached the APU, not just an inert $400C write.
  const between = coEndWrites.slice(firstNoiseIndex + 1, secondNoiseIndex);
  assert.ok(
    between.some(([address]) => address === 0x400e) && between.some(([address]) => address === 0x400f),
    `frame ${coEndFrame}: expected $400E/$400F between the retrigger and the truncating write -- got ${JSON.stringify(coEndWrites)}`
  );
});

test('the exact co-end, sting-restores-into-an-audible-song sub-case: no truncation -- sting_retrig_loop\'s own write is inert', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-coend-audible-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.songs[0] = fieldSong(); // audible -- the sting restores into this, not Silence
  project.songs[1] = coEndSting();
  project.sfx = [effectB()];
  const npc = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: npc, name: 'Both', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: npc,
      x: START_X,
      y: START_Y - 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sfx', sfx: 0 }, { op: 'sting', song: 1 }] }] } }
    }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = boot(built.romPath);

  const { writesPerFrame, reg4015WritesPerFrame } = trace(nes, 15, tapAt(B, 0));
  const triggerFrame = reg4015WritesPerFrame.findIndex((writes) => writes.includes(0x0f));
  assert.ok(triggerFrame >= 0, 'the SFX never triggered');

  const coEndFrame = triggerFrame + 1 + COEND_SFX_FRAMES;
  const coEndWrites = sfxRegisters(writesPerFrame[coEndFrame]);
  // Exactly one $400C write this frame -- the hand-back retrigger, never
  // truncated, since sting_retrig_loop's own force_trig write is inert
  // (music_channel already consumed the SFX-owned force_trig on this same
  // channel a moment earlier the same frame, and the loop's own write does
  // not touch $400C directly at all).
  const noiseWrites = coEndWrites.filter(([address]) => address === 0x400c);
  assert.equal(
    noiseWrites.length,
    1,
    `frame ${coEndFrame}: expected exactly one $400C write (the hand-back retrigger, untruncated) -- got ${JSON.stringify(coEndWrites)}`
  );
  assert.notEqual(noiseWrites[0][1], 0x30, `frame ${coEndFrame}: the one $400C write should be the sting's own real retriggered note, not silence -- got ${JSON.stringify(coEndWrites)}`);
  assert.ok(
    coEndWrites.some(([address]) => address === 0x400e) && coEndWrites.some(([address]) => address === 0x400f),
    `frame ${coEndFrame}: expected a real $400E/$400F retrigger pair -- got ${JSON.stringify(coEndWrites)}`
  );
});

