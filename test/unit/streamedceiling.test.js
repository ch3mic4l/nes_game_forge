// Streamed worlds phase 2, slice 10: the kernel-hi content ceiling.
//
// Music, sound effects, text and (streaming only) the resident streamed-worlds package share the
// $E000 half of the fixed kernel. streamworldHiBytesFor/contentCeilingBytes (main/build/generate.js)
// are the single writer of the resident cost and the one shared ceiling content must fit under
// (docs/design-streamed-worlds.md, orchestrator ruling R1) -- this file measures that ceiling for a
// representative project, proves checkCapacity's refusal names every category correctly (R2), and
// proves the predicted kernel-hi occupancy really is what nesasm reports (R5).
//
// Every byte count an assertion below depends on is read back from checkCapacity/contentCeilingBytes
// at run time, never a literal copied out of a console log -- R1's own self-check (case 4) asserts
// this file's own source never hardcodes one of the historical or current ceiling figures.
//
// FIX 1 (handoff-next/brief-streamed-worlds-phase2-s10-fix1.md, 2026-09-28) closed review round 1's
// five blocking items: case 1 and buildR4Sample now carry the full committed content inventory
// (handoff-next/progress-phase2-s10-fix1.md's dated section, Chris's ruling option B) instead of a
// placeholder/shrunk sample; a new "item 1" test reports the FITS/PINCH result honestly; a new
// "item 2" test derives the text/vectors relationship independently and asserts it by name on
// several varied builds; case 12's post-battle check now uses a completed-landing return-PC hook,
// locator-derived expectations and a deep-copied, per-screen-distinct nametable comparison (item 3);
// cases 6/8/10 parse every field of the refusal message (item 4), and the sfx case's dialogue
// parity fudge is gone, replaced with a fixed rule (spare parity goes to music, never dialogue).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProject,
  createMap,
  createScreen,
  createSpell,
  planLibraryImport,
  applyPlannedProject
} from '../../shared/project.js';
import { createSong } from '../../shared/audio.js';
import { checkCapacity, contentCeilingBytes, streamworldDialogueBanked, streamworldHiBytesFor } from '../../main/build/generate.js';
import { encodeString, systemStrings, TITLE_LINE_LIMIT, compileText } from '../../main/build/textcompile.js';
import { LIBRARY_ENTRIES } from '../../shared/library/index.js';
import { buildProject } from '../../main/build/pipeline.js';
import { resolveMapper, codeRegions, prgLayout } from '../../shared/cartridge.js';
import { battleRegionBytes } from '../../main/build/battletables.js';
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
import { applyBattleTest } from '../../renderer/emulator/battletest.js';
import { finishNamingIfOpen } from '../lib/naming.js';
import { growTextExactlyBy, parseCeilingMessage } from '../lib/exactcontent.js';
import { parseEquates } from '../../shared/enginesyms.js';
import { parseSymbolFile } from '../../main/build/symbols.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

const MAPPER = resolveMapper(30); // UNROM 512 -- the only streamCapableFourScreen board

// ---------------------------------------------------------------------------------------------
// Item 2 (R5 exact relationship): an INDEPENDENT derivation of the gap between textSize()'s own
// modeled system-string cost (textcompile.js:650-653: each of the 4 system strings, encoded with
// the PLACEHOLDER title 'UNTITLED', plus a flat TITLE_LINE_LIMIT(28)-byte pad) and what textTables()
// actually emits (textcompile.js:700-701: the REAL title, with no padding at all). This function
// never calls textSize() or checkCapacity's own textBytes correction -- it recomputes the same
// arithmetic from the lower-level, non-buggy primitives (encodeString, systemStrings, the
// TITLE_LINE_LIMIT constant) so it cannot simply echo back whatever textSize() already computed.
//
// Only sys_title differs between the placeholder and real string sets -- sys_press_start,
// sys_press_start_continue and sys_game_over never depend on the project's title -- so the gap
// collapses to one term: (bytes of 'UNTITLED' + 4*28) - (bytes of the real title).
function textOverestimateBytes(project) {
  const real = systemStrings(project);
  const placeholder = systemStrings(null);
  const realTitleBytes = encodeString(real.sys_title).bytes.length;
  const placeholderTitleBytes = encodeString(placeholder.sys_title).bytes.length;
  return placeholderTitleBytes + 4 * TITLE_LINE_LIMIT - realTitleBytes;
}

// engine/main.asm:134-137 -- `.org $FFFA` / `.dw nmi` / `.dw reset` / `.dw irq`: 3 vectors, 2 bytes
// each. This is NOT "the CPU vector table" on its own (docs/reference-kernel-budget.md's own prior
// text conflated the two) -- it is the fixed 6-byte piece of the 64-byte reserved margin that the
// vectors themselves actually cost; the other 58 bytes of that margin are headroom, unrelated to
// this relationship.
const CPU_VECTOR_BYTES = 6;

// A second, independent gap in the same textSize()-vs-textTables() pair (textcompile.js:648-661
// vs 698-713): when a table is EMPTY, textTables() still emits one placeholder data byte per empty
// table (`str_data_0:\n  .db $00` / `event_data_0:\n  .db $00`, textcompile.js:707) so the pointer
// table's single Math.max(1,...) slot has something to point at -- but textSize()'s own
// `total(list)` is 0 for an empty list and never adds that placeholder byte back in. A project with
// zero dialogue strings and/or zero compiled events therefore costs 1 real byte MORE per empty
// table than the model predicts. `strings`/`events` here are read from compileText's own compiled
// output -- structural facts about the project (how many dialogue strings/events exist), not a
// second call into the buggy correction itself.
function emptyTableStubBytes(project) {
  const { strings, events } = compileText(project);
  return (strings.length ? 0 : 1) + (events.length ? 0 : 1);
}

/**
 * The independent, named R5 relationship: nesasm's real kernel-hi usage equals checkCapacity's own
 * modeled music+sfx+text totals, plus the resident streaming package, plus the 6 CPU vector bytes,
 * minus the text model's own title-padding overestimate, plus the empty-table stub gap above. No
 * term here is computed by calling textSize()/textcompile's own correction, or by reading nesasm's
 * usage back into itself.
 */
function predictedRealKernelHiBytes(cap, project) {
  return (
    cap.musicBytes +
    cap.sfxBytes +
    cap.textBytes +
    streamworldHiBytesFor(project) +
    CPU_VECTOR_BYTES -
    textOverestimateBytes(project) +
    emptyTableStubBytes(project)
  );
}

// Every exact-fit (or, for case 12, realistically-sized) build asserts the named relationship above
// AND records `realUsed - predictedRealKernelHiBytes(cap, project)` here, which must be exactly 0
// every time -- kept as a second, redundant cross-build check (a residual that drifted between
// builds would mean the named formula is right for some builds and wrong for others).
const kernelHiOverheadSamples = [];

function recordKernelHiOverhead(label, realUsed, cap, project) {
  const predicted = predictedRealKernelHiBytes(cap, project);
  const overhead = realUsed - predicted;
  kernelHiOverheadSamples.push({ label, overhead });
  console.log(`${label}: real kernel-hi usage ${realUsed}, predicted ${predicted}, residual ${overhead}`);
  assert.equal(
    realUsed,
    predicted,
    `${label}: nesasm's real kernel-hi usage (${realUsed}) must equal the named prediction (${predicted}) -- ` +
      `music ${cap.musicBytes} + sfx ${cap.sfxBytes} + text ${cap.textBytes} + streaming ${streamworldHiBytesFor(project)} + ` +
      `vectors ${CPU_VECTOR_BYTES} - textOverestimate ${textOverestimateBytes(project)}`
  );
  return overhead;
}

// ---------------------------------------------------------------------------------------------
// Shared project construction. base() is the streamed-map skeleton every case grows content on;
// importLibraryContent adds the library's own real songs/sfx (not synthetic filler) per R3/R4.
//
// FIX 1 / item 3: each of the 6 screens now carries a distinct, non-uniform metatile pattern
// (the same period-3, position-and-offset-dependent scheme test/lib/streamedproject.js's own
// streamedScreen() uses, duplicated here rather than imported -- this file's screens are 1x1
// createScreen() shells, not that module's saved-project fixture shape). A flat fillMetatileId=0
// screen cannot discriminate "the right screen's data was read" from "a neighbour's was" after a
// battle; a per-screen-distinct pattern can, and case 12's post-battle check below depends on it.
// ---------------------------------------------------------------------------------------------

// Slice 10b: a streamed RPG (a project with a battle bank) whose content outgrows the resident
// ceiling now relocates the dialogue overlay into that bank instead of being refused
// (generate.js streamworldDialogueBanked), so "one byte over the resident ceiling is refused"
// is no longer true of it -- test/unit/streamworlddialoguebanked.test.js owns that step and
// its own refusal ceiling. It remains true, unchanged, of the game types with no battle bank,
// which keep the overlay resident and today's refusal; the boundary cases 3 and 5-10 below
// exercise exactly that, so they build an action project.
const RESIDENT_CEILING_GAME_TYPE = 'action';

function distinctScreen(col, row) {
  const screen = createScreen();
  const variedCount = Math.floor(screen.metatiles.length / 3);
  for (let i = 0; i < screen.metatiles.length; i++) {
    screen.metatiles[i] = i < variedCount ? 1 + ((col + row + i) % 3) : 0;
  }
  return screen;
}

function base(gameType = 'rpg') {
  const p = createProject('Ceiling probe', gameType);
  p.cartridge.mapper = 30;
  p.cartridge.mirroring = 'fourscreen';
  p.cartridge.camera = true;
  const map = createMap(0, 'Streamed');
  const gridW = 3,
    gridH = 2;
  map.gridW = gridW;
  map.gridH = gridH;
  map.streamed = true;
  map.fillMetatileId = 0;
  map.screens = [];
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) map.screens.push(distinctScreen(col, row));
  }
  p.maps = [map];
  return p;
}

function importLibraryContent(p) {
  for (const entry of LIBRARY_ENTRIES.filter((e) => e.kind === 'song')) {
    const plan = planLibraryImport(p, entry, {});
    if (!plan.ok) throw new Error(`song import refused: ${plan.reason}`);
    applyPlannedProject(p, plan.project);
  }
  for (const entry of LIBRARY_ENTRIES.filter((e) => e.kind === 'sfx')) {
    const plan = planLibraryImport(p, entry, {});
    if (!plan.ok) throw new Error(`sfx import refused: ${plan.reason}`);
    applyPlannedProject(p, plan.project);
  }
  // planLibraryImport's clone resets cartridge to createProject's own default -- restore this
  // module's own streamed board settings every caller needs.
  p.cartridge.mapper = 30;
  p.cartridge.mirroring = 'fourscreen';
  p.cartridge.camera = true;
}

function importLibraryMonsters(p) {
  const ids = [];
  for (const entry of LIBRARY_ENTRIES.filter((e) => e.kind === 'monster')) {
    const plan = planLibraryImport(p, entry, {});
    if (!plan.ok) throw new Error(`monster import refused: ${plan.reason}`);
    applyPlannedProject(p, plan.project);
    ids.push(p.sprites.actors.length - 1);
  }
  p.cartridge.mapper = 30;
  p.cartridge.mirroring = 'fourscreen';
  p.cartridge.camera = true;
  return ids; // in LIBRARY_ENTRIES order: [Slime, Bat, Skeleton]
}

function addFillerDialogue(project, screen, text, { save = false } = {}) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: `Talker${actorId}`, behavior: 'npc', hp: 1, damage: 0 });
  screen.entities = screen.entities ?? [];
  // A Save command needs a title screen for Continue to appear on (Map Forge validation) -- the
  // Save boundary configuration must set one, exactly as buildR4Sample's own real Save build does.
  if (save) {
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
  }
  const commands = save ? [{ op: 'say', text }, { op: 'save' }] : [{ op: 'say', text }];
  screen.entities.push({
    actorId,
    x: 32,
    y: 32,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
  });
  return screen.entities[screen.entities.length - 1].props.event.pages[0].commands[0];
}

/** A live event that only ever Moves -- no `say` at all -- for item 2's Move-predicate build. */
function addMoveOnlyEntity(project, screen) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: `Mover${actorId}`, behavior: 'npc', hp: 1, damage: 0 });
  screen.entities = screen.entities ?? [];
  screen.entities.push({
    actorId,
    x: 32,
    y: 32,
    props: {
      trigger: 'interact',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'self', dir: 'right', dist: 1 }] }] }
    }
  });
}

/** A live event that only ever Saves -- no `say` at all -- for item 2's Save-predicate build. */
function addSaveOnlyEntity(project, screen) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: `Saver${actorId}`, behavior: 'npc', hp: 1, damage: 0 });
  screen.entities = screen.entities ?? [];
  screen.entities.push({
    actorId,
    x: 32,
    y: 32,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
}

// ---------------------------------------------------------------------------------------------
// The committed content inventory (handoff-next/progress-phase2-s10-fix1.md, 2026-09-28, Chris's
// ruling option B): every song/sfx the starter library has, and 24 pairwise-distinct dialogue
// lines by kind (14 NPC, 4 sign, 3 shop, 3 story-beat) -- sized against a small, complete NES-era
// RPG: two towns, one dungeon, a shop, a three-beat story. Changing a line here without updating
// that dated section is exactly what the case-1/case-12 shrink-pinning mutants must catch.
// ---------------------------------------------------------------------------------------------

const COMMITTED_DIALOGUE = {
  npc: [
    "Riverside's mill hasn't stopped turning in forty years.",
    'My grandmother remembers when the bridge still had a toll.',
    'The old well out back runs dry every summer now.',
    "Have you seen the miller's cat? She wanders into the flour again.",
    'Travelers say the mine past the ridge swallowed a whole crew once.',
    "I traded my father's sword for a plow years ago. No regrets.",
    'The chapel bell cracked last winter. We still ring it anyway.',
    'Millhaven used to be twice this size before the fever came through.',
    "The blacksmith's forge hasn't cooled since his son took over.",
    'Watch your step near the old quarry, the fence rotted through.',
    'They say a hermit lives past the northern gate now.',
    'Our well water tastes of iron since the earthquake.',
    "The innkeeper waters down the ale, but don't tell her I said so.",
    "Millhaven's founder is buried under that crooked oak."
  ],
  sign: ['RIVERSIDE - POPULATION 62', 'MILLHAVEN - MIND THE QUARRY', 'SHOP - POTIONS AND SUPPLIES', 'DANGER: MINE ENTRANCE AHEAD'],
  shop: [
    'Welcome, traveler. Care to see my wares?',
    "That'll cost you, but it's fair coin for fair goods.",
    'Come back if you need more. The road is long.'
  ],
  story: [
    'Something stirs beneath the old mine. The elders are afraid.',
    'You have reached the heart of the mine. The air grows cold.',
    'The tremors have stopped. Riverside and Millhaven are safe again.'
  ]
};

const COMMITTED_DIALOGUE_ALL = [...COMMITTED_DIALOGUE.npc, ...COMMITTED_DIALOGUE.sign, ...COMMITTED_DIALOGUE.shop, ...COMMITTED_DIALOGUE.story];
const COMMITTED_SONG_COUNT = 2;
const COMMITTED_SFX_COUNT = 8;
const COMMITTED_DIALOGUE_COUNT = 24;

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Item 1 closure (review round 2): an INDEPENDENTLY preserved anchor for the committed inventory,
// pinned as literals below -- never recomputed from COMMITTED_DIALOGUE/COMMITTED_DIALOGUE_ALL
// themselves, so editing that object (a shortened line, a dropped category) changes what gets read
// back from the built project without moving these literals, and the comparison fails. The digest
// was computed once (2026-09-28) from the 24 committed lines, SORTED before hashing so extraction
// order -- round-robin across streamed screens for case 1, chunked for case 12 -- can never itself
// look like content drift.
const COMMITTED_DIALOGUE_SORTED_SHA256 = '7c528b975beadd5adb56ffef253bb72ac546849d6038067d5e27807715952826';
const COMMITTED_NPC_COUNT = 14;
const COMMITTED_SIGN_COUNT = 4;
const COMMITTED_SHOP_COUNT = 3;
const COMMITTED_STORY_COUNT = 3;
// shared/library/index.js's own real entries, literal -- independent of LIBRARY_ENTRIES itself, so
// a build that silently drops or renames one is still caught reading the actual project back.
const REAL_SONG_NAMES = ['Title Jingle', 'Ambient Loop'];
const REAL_SFX_NAMES = ['Hit', 'Pickup', 'Menu', 'Door', 'Hurt', 'Heal', 'Error', 'Jump'];
const REAL_MONSTER_NAMES = ['Slime', 'Bat', 'Skeleton'];
const COMMITTED_MONSTER_COUNT = 3;

/**
 * Places all 24 committed dialogue lines round-robin across `project`'s own streamed-map screens.
 * Split out from buildCommittedInventory so buildR4Sample can import its monsters FIRST and place
 * dialogue LAST -- planLibraryImport/applyPlannedProject clone-and-reassign `project.maps` on
 * every import (see importLibraryContent's own comment), which would silently orphan any
 * `sayCommand` object captured before a later import call.
 *
 * `linesPerEntity` groups consecutive committed lines onto ONE entity as consecutive `say`
 * commands in a single page -- a short conversation, not padding: the 24 lines and their content
 * are identical either way, only how many distinct placed actors carry them changes. Default 1
 * (one NPC/sign per line) for the kernel-hi-only measurement (item 1/case 1, which never calls
 * buildProject and so never meets kernel-lo's own, unrelated entity-table budget). buildR4Sample
 * uses a larger grouping because it DOES build for real: 24 distinct placed actors plus a full
 * monster/item/spell/battle roster overflows kernel-lo's entity tables on this board, a genuinely
 * separate capacity ceiling from the kernel-hi content ceiling this whole slice is about.
 */
function placeCommittedDialogue(project, { linesPerEntity = 1 } = {}) {
  const screens = project.maps[0].screens;
  const sayCommands = [];
  for (let i = 0; i < COMMITTED_DIALOGUE_ALL.length; i += linesPerEntity) {
    const chunk = COMMITTED_DIALOGUE_ALL.slice(i, i + linesPerEntity);
    const screen = screens[Math.floor(i / linesPerEntity) % screens.length];
    const actorId = project.sprites.actors.length;
    project.sprites.actors.push({ name: `Talker${actorId}`, behavior: 'npc', hp: 1, damage: 0 });
    screen.entities = screen.entities ?? [];
    const commands = chunk.map((text) => ({ op: 'say', text }));
    screen.entities.push({
      actorId,
      x: 32,
      y: 32,
      props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    });
    const page = screen.entities[screen.entities.length - 1].props.event.pages[0];
    sayCommands.push(...page.commands);
  }
  return sayCommands;
}

/**
 * base(gameType) + the full committed inventory above, every line placed round-robin across the
 * streamed map's own screens. The one project shape item 1's measurement, case 1's pin and
 * buildR4Sample() all build from, so they can never silently disagree about what "the committed
 * inventory" contains.
 */
function buildCommittedInventory(gameType = 'rpg') {
  const p = base(gameType);
  importLibraryContent(p);
  // FIX 3 (2026-09-28): the full three-monster roster case 12 already imports is part of the
  // committed inventory too, so case 1's measurement path carries it and pins it. Imported BEFORE
  // the dialogue is placed for the reason placeCommittedDialogue's own comment gives.
  const monsterIds = importLibraryMonsters(p);
  const sayCommands = placeCommittedDialogue(p);
  return { project: p, sayCommands, monsterIds };
}

// ---------------------------------------------------------------------------------------------
// Exact-target growth helpers. Each category's real per-step byte cost was measured empirically
// (never assumed) against checkCapacity's own musicBytes/sfxBytes/textBytes (R6):
//   music: a volEnv push on an already-open filler instrument costs exactly 1 byte, but only
//     across 15 of its 16 slots -- normalizeSong (shared/audio.js) silently treats an empty
//     volEnv as a 1-entry default, so a true 0-entry starting point does not exist; every filler
//     instrument here starts pre-seeded with one entry for that reason.
//   sfx: a step push on an already-open filler entry costs exactly 2 bytes; there is no real
//     1-byte sfx step, so R6 uses k=2, the smallest real one. A brand-new filler sfx *entry*
//     costs its own, larger, ODD 7-byte overhead for its pointer-table slot -- odd overhead
//     mixed with even fine-tuning steps means filler entries must be added one at a time with a
//     parity check after each, or an even target can become unreachable.
//   text: a character appended to a word already open costs exactly 1 byte; the character that
//     *starts* a new word (right after a space) costs 2, and the space itself costs 0 -- so
//     growth is word-boundary aware, never one long unbroken run (nesasm's own word-wrap silently
//     drops an unbroken run past BOX_COLS=28 chars).
// ---------------------------------------------------------------------------------------------

const PUSHABLE_PER_INSTRUMENT = 15; // 16 slots, minus the 1 every filler instrument starts with

function growMusicExactly(project, target) {
  const cur0 = checkCapacity(project).musicBytes;
  const needed = target - cur0;
  assert.ok(needed >= 0, `music baseline ${cur0} already exceeds target ${target}`);
  // +1 so at least one pushable slot always remains after reaching `target` exactly -- a caller
  // growing "one more byte" past an exact fit never has to fall back to a whole new, much more
  // expensive filler instrument just because the arithmetic happened to divide evenly.
  const slotsNeeded = Math.ceil((needed + 1) / PUSHABLE_PER_INSTRUMENT);
  const fillers = [];
  let song = createSong(`Filler music ${project.songs.length}`);
  song.instruments = [];
  project.songs.push(song);
  for (let i = 0; i < slotsNeeded; i++) {
    if (song.instruments.length >= 8) {
      song = createSong(`Filler music ${project.songs.length}`);
      song.instruments = [];
      project.songs.push(song);
    }
    const inst = { id: song.instruments.length, name: `F${song.instruments.length}`, duty: 2, volEnv: [8], sustain: 0 };
    song.instruments.push(inst);
    fillers.push(inst);
  }
  let cur = checkCapacity(project).musicBytes;
  assert.ok(cur <= target, `pre-allocating room overshot: ${cur} > ${target} (needed ${needed}, slots ${slotsNeeded})`);
  let f = 0;
  while (cur < target) {
    assert.ok(f < fillers.length, 'ran out of pre-allocated room before reaching target');
    if (fillers[f].volEnv.length >= 16) {
      f++;
      continue;
    }
    fillers[f].volEnv.push(8);
    const next = checkCapacity(project).musicBytes;
    assert.equal(next, cur + 1, `a single volEnv push must cost exactly 1 byte (was ${next - cur})`);
    cur = next;
  }
  assert.equal(cur, target);
  return fillers; // every filler instrument created, in creation order, for a caller that needs slack to grow or pop
}

/** The last-created filler with room for one more volEnv push, or `null` if every one is full. */
function growableFiller(fillers) {
  for (let i = fillers.length - 1; i >= 0; i--) {
    if (fillers[i].volEnv.length < 16) return fillers[i];
  }
  return null;
}

/** The last-created filler with a poppable entry beyond its own 1-entry seed. */
function poppableFiller(fillers) {
  for (let i = fillers.length - 1; i >= 0; i--) {
    if (fillers[i].volEnv.length > 1) return fillers[i];
  }
  return null;
}

function growSfxExactlyByEvenDelta(project, delta) {
  assert.ok(delta % 2 === 0, `sfx grows in steps of 2; delta ${delta} is odd`);
  const cur0 = checkCapacity(project).sfxBytes;
  const target = cur0 + delta;
  let cur = cur0;
  const spareCapacity = () => project.sfx.reduce((sum, f) => sum + Math.max(0, 8 - f.steps.length) * 2, 0);
  while (!(cur <= target && (target - cur) % 2 === 0 && spareCapacity() >= target - cur)) {
    project.sfx.push({ name: `Filler sfx ${project.sfx.length}`, volume: 10, steps: [{ note: 5, duration: 4 }] });
    cur = checkCapacity(project).sfxBytes;
    assert.ok(cur <= target, `sfx filler creation overshot: ${cur} > ${target}`);
  }
  let fi = 0;
  while (cur < target) {
    assert.ok(fi < project.sfx.length, 'ran out of spare sfx room before reaching target');
    if (project.sfx[fi].steps.length >= 8) {
      fi++;
      continue;
    }
    project.sfx[fi].steps.push({ note: 5 + (project.sfx[fi].steps.length % 10), duration: 4 });
    const next = checkCapacity(project).sfxBytes;
    assert.equal(next, cur + 2, `a single sfx step must cost exactly 2 bytes (was ${next - cur})`);
    cur = next;
  }
  assert.equal(cur, target);
}

// ---------------------------------------------------------------------------------------------
// R5: real-measurement techniques, kernelbytes.test.js's/bankedbytes.test.js's own (duplicated
// here rather than imported -- neither is exported, both files are test files, not modules).
// ---------------------------------------------------------------------------------------------

async function measureKernelHiBank(t, mapper, project) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-s10-kernelhi-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const lines = [];
  await buildProject({ dir, project, log: (line) => lines.push(line) });
  const { kernelHiBank } = prgLayout(mapper);
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelHiBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelHiBank} (kernel-hi)`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  assert.ok(Number.isFinite(used) && used > 0, `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`);
  return used;
}

async function measureBattleRegion(t, mapper, project) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-s10-battleregion-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const lines = [];
  await buildProject({ dir, project, log: (line) => lines.push(line) });
  const slot = codeRegions(mapper, project.tilesets.length, 1)[0];
  assert.ok(slot, `${mapper.name}: codeRegions() reserved no region for an RPG`);
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${slot.nesasmBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${slot.nesasmBank}`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  assert.ok(Number.isFinite(used) && used > 0, `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`);
  return { dir, used, predicted: battleRegionBytes(project, mapper, { streamDialogueBanked: streamworldDialogueBanked(project, mapper) }) };
}

function errorMessage(cap, pattern) {
  return cap.problems.find((x) => x.severity === 'error' && pattern.test(x.message));
}

/** Cross-checks every parsed field of a ceiling refusal against ground truth for `project`. */
function assertCeilingMessageFields(message, project, cap, { grown, baseline, where } = {}) {
  const parsed = parseCeilingMessage(message);
  assert.equal(parsed.musicBytes, cap.musicBytes, 'printed music bytes must match checkCapacity');
  assert.equal(parsed.sfxBytes, cap.sfxBytes, 'printed sfx bytes must match checkCapacity');
  assert.equal(parsed.textBytes, cap.textBytes, 'printed dialogue bytes must match checkCapacity');
  assert.equal(parsed.streamworldHiBytes, streamworldHiBytesFor(project), 'printed streaming reservation must match streamworldHiBytesFor');
  assert.equal(parsed.ceiling, contentCeilingBytes(project), 'printed ceiling must match contentCeilingBytes');
  assert.equal(parsed.bankSize, 8192, 'the printed bank size is the fixed 8 KB kernel-hi bank (generate.js:231 BANK_SIZE)');
  assert.equal(
    parsed.overBy,
    cap.musicBytes + cap.sfxBytes + cap.textBytes - parsed.ceiling,
    'printed overage must equal (music+sfx+text) - ceiling'
  );
  if (grown && baseline) {
    for (const key of ['musicBytes', 'sfxBytes', 'textBytes']) {
      if (key === grown) continue;
      assert.equal(parsed[key], baseline[key], `unchanged category ${key} must print its unchanged baseline figure`);
    }
    assert.equal(parsed[grown] - baseline[grown], parsed.overBy, `the grown category's +k must equal the printed overage (k=${parsed.overBy})`);
    // Item 4: report the separate exact/over contributions per boundary case, from this real run
    // (never a hand-copied literal) -- the report's own table is reproduced from this line.
    console.log(
      `BOUNDARY ${grown}: exact music ${baseline.musicBytes} sfx ${baseline.sfxBytes} text ${baseline.textBytes}, ` +
        `over music ${parsed.musicBytes} sfx ${parsed.sfxBytes} text ${parsed.textBytes}, k=${parsed.overBy}, ` +
        `ceiling ${parsed.ceiling}, reservation ${parsed.streamworldHiBytes}, where ${where}`
    );
  }
  return parsed;
}

// =================================================================================================
// Case 1 -- the representative sample carries the full committed inventory (progress-phase2-
// s10-fix1.md, 2026-09-28), not a placeholder or a shrunk subset (item 1's pinning requirement).
// =================================================================================================

test('slice 10 case 1: the representative sample carries the full committed inventory, not a placeholder or a shrunk subset', () => {
  const { project: p, monsterIds } = buildCommittedInventory();

  // Item 1: songs/sfx pinned against literal, independently-preserved names -- never against
  // LIBRARY_ENTRIES filtered at runtime, which is the same source importLibraryContent itself reads,
  // so a silently-dropped entry (E2's drop-song/drop-sfx mutants) is caught reading the built
  // project back, not by re-deriving the very list that built it.
  assert.deepEqual(p.songs.map((s) => s.name), REAL_SONG_NAMES, "the sample must import exactly the library's own real songs, not synthetic ones");
  assert.deepEqual(p.sfx.map((s) => s.name), REAL_SFX_NAMES, "the sample must import exactly the library's own real sfx, not synthetic ones");
  assert.equal(REAL_SONG_NAMES.length, COMMITTED_SONG_COUNT);
  assert.equal(REAL_SFX_NAMES.length, COMMITTED_SFX_COUNT);

  // FIX 3: the full three-monster roster (Slime, Bat, Skeleton), pinned against literal names read
  // back from the constructed project -- once through the ids the import returned, and once by
  // scanning every actor, so neither a shrunk import list nor a stale id list can pass. Never
  // compared against LIBRARY_ENTRIES itself.
  assert.equal(monsterIds.length, COMMITTED_MONSTER_COUNT, `case 1 must import ${COMMITTED_MONSTER_COUNT} monsters; imported ${monsterIds.length}`);
  assert.deepEqual(
    monsterIds.map((id) => p.sprites.actors[id].name),
    REAL_MONSTER_NAMES,
    'case 1 must carry the full three-monster roster, in library order'
  );
  assert.deepEqual(
    p.sprites.actors.filter((a) => REAL_MONSTER_NAMES.includes(a.name)).map((a) => a.name),
    REAL_MONSTER_NAMES,
    'exactly the three real monsters must exist in the constructed project'
  );

  // Category counts, independently literal (catches a category shrunk while another grows, which
  // a bare total-count check below would miss).
  assert.equal(COMMITTED_DIALOGUE.npc.length, COMMITTED_NPC_COUNT);
  assert.equal(COMMITTED_DIALOGUE.sign.length, COMMITTED_SIGN_COUNT);
  assert.equal(COMMITTED_DIALOGUE.shop.length, COMMITTED_SHOP_COUNT);
  assert.equal(COMMITTED_DIALOGUE.story.length, COMMITTED_STORY_COUNT);

  // Pin the full 24-line dialogue set against the independently preserved digest (item 1's
  // shrink-pinning requirement) -- read back from the BUILT project, never compared against
  // COMMITTED_DIALOGUE_ALL itself, so shortening a committed line changes only the computed side
  // of this equality and the mutant dies here.
  const sayTexts = [];
  for (const screen of p.maps[0].screens) {
    for (const entity of screen.entities ?? []) {
      for (const cmd of entity.props?.event?.pages?.[0]?.commands ?? []) {
        if (cmd.op === 'say') sayTexts.push(cmd.text);
      }
    }
  }
  assert.equal(sayTexts.length, COMMITTED_DIALOGUE_COUNT, `the committed inventory has ${COMMITTED_DIALOGUE_COUNT} dialogue lines; found ${sayTexts.length}`);
  assert.equal(
    sha256Hex([...sayTexts].sort().join('\n')),
    COMMITTED_DIALOGUE_SORTED_SHA256,
    'the placed dialogue must hash to the pinned digest of the committed inventory (independently preserved, never recomputed from COMMITTED_DIALOGUE_ALL)'
  );
  assert.equal(new Set(sayTexts).size, sayTexts.length, 'every committed line must be pairwise distinct (no padding/repetition)');
  for (const line of sayTexts) {
    assert.ok(!/^(.)\1{4,}/.test(line), `dialogue must not be one repeated character: "${line}"`);
  }
});

// =================================================================================================
// Item 1 -- the representative measurement (R3): FITS/PINCH reported honestly against the FULL
// committed inventory above, never trimmed. Reports both the streamed and ordinary-board figures,
// and the cost of one more NPC line, freshly re-measured against THIS inventory's own baseline
// (never the round-1 review's own 53-byte figure, measured against a different, 5-line sample).
// =================================================================================================

test("slice 10 item 1: the committed inventory's content ceiling is measured and reported honestly (FITS or PINCH)", () => {
  const { project: p } = buildCommittedInventory();
  const cap = checkCapacity(p);
  const ceiling = contentCeilingBytes(p);
  const sum = cap.musicBytes + cap.sfxBytes + cap.textBytes;
  const spareOrOver = ceiling - sum;

  // Freshly re-measure the cost of one more representative (41-character) NPC line, against this
  // inventory's own baseline.
  const probeProject = structuredClone(p);
  const before = checkCapacity(probeProject).textBytes;
  addFillerDialogue(probeProject, probeProject.maps[0].screens[0], 'One more traveler passes through at dusk.');
  const after = checkCapacity(probeProject).textBytes;
  const perLineCost = after - before;
  assert.ok(perLineCost > 0, 'adding a representative NPC line must cost a positive number of bytes');

  // The ordinary-board comparison: the identical inventory, unstreamed, on the same board.
  const ordinary = structuredClone(p);
  ordinary.maps[0].streamed = false;
  const ordinaryCap = checkCapacity(ordinary);
  const ordinaryCeiling = contentCeilingBytes(ordinary);
  assert.equal(streamworldHiBytesFor(ordinary), 0, 'the ordinary comparison project must not be streaming');
  const ordinarySum = ordinaryCap.musicBytes + ordinaryCap.sfxBytes + ordinaryCap.textBytes;
  const ordinarySpare = ordinaryCeiling - ordinarySum;

  const equivalentLines = Math.floor(Math.abs(spareOrOver) / perLineCost);
  const line1 = spareOrOver >= 0 ? `FITS: ${spareOrOver} bytes spare` : `PINCH: ${-spareOrOver} bytes over`;
  console.log(line1);
  console.log(
    `item 1 measurement (2026-09-28): streamed ceiling ${ceiling} (music ${cap.musicBytes}, sfx ${cap.sfxBytes}, text ${cap.textBytes}, ` +
      `streaming reserve ${streamworldHiBytesFor(p)}), ${spareOrOver >= 0 ? 'spare' : 'over'} ${Math.abs(spareOrOver)} bytes, ` +
      `equivalent to ${equivalentLines} unique NPC lines at a freshly measured ${perLineCost} bytes/line. ` +
      `Ordinary (unstreamed) board: ceiling ${ordinaryCeiling}, spare ${ordinarySpare} bytes.`
  );

  const refused = cap.problems.filter((x) => x.severity === 'error' && /Music compiles/.test(x.message)).length;
  assert.equal(
    refused,
    spareOrOver < 0 ? 1 : 0,
    "checkCapacity's own refusal must agree with the FITS/PINCH figure computed here"
  );
});

// =================================================================================================
// Case 2 (R8) -- an ordinary UNSTREAMED project over its kernel-hi budget must be refused with a
// message that never mentions streaming.
// =================================================================================================

test('slice 10 case 2 (R8): an unstreamed project over kernel-hi budget is refused without ever mentioning streaming', () => {
  const p = createProject('Unstreamed overflow', 'action');
  p.cartridge.mapper = 30;
  const screen = p.maps[0].screens[0];
  const sayCmd = addFillerDialogue(p, screen, 'x');
  assert.equal(streamworldHiBytesFor(p), 0, 'this project must not be streaming at all');
  const ceiling = contentCeilingBytes(p); // == BANK_SIZE - 64, since streamworldHiBytesFor is 0 here
  const cur = checkCapacity(p).textBytes;
  growTextExactlyBy(p, sayCmd, ceiling - cur + 50);
  const cap = checkCapacity(p);
  const err = errorMessage(cap, /Music compiles/);
  assert.ok(err, 'an unstreamed project 50 bytes over its own kernel-hi budget must still be refused');
  assert.doesNotMatch(err.message, /stream/i, "an unstreamed project's refusal must never mention streaming");
});

// =================================================================================================
// Case 3 (R5) -- content alone (music+sfx+text) fits under BANK_SIZE-64, but the real ceiling
// (which also reserves the resident streamed-worlds package) is smaller, and checkCapacity must
// still refuse. This is the same project shape case 5 uses (streamed), grown just past the real
// ceiling while staying comfortably under the streaming-blind BANK_SIZE-64 figure.
// =================================================================================================

test('slice 10 case 3 (R5): content that would fit ignoring streamworldHiBytes must still be refused once it is included', () => {
  const p = base(RESIDENT_CEILING_GAME_TYPE);
  importLibraryContent(p);
  const screen = p.maps[0].screens[0];
  addFillerDialogue(p, screen, 'Welcome, traveler. Rest well before the road ahead.');
  const streamlessCeiling = 8192 - 64; // BANK_SIZE - 64: what the budget would be with no streaming reservation at all
  const realCeiling = contentCeilingBytes(p);
  assert.ok(streamworldHiBytesFor(p) > 0, 'this project must be streaming for the two ceilings to differ');
  assert.ok(realCeiling < streamlessCeiling, 'the streaming reservation must actually shrink the ceiling');
  growMusicExactly(p, realCeiling + 100);
  const cap = checkCapacity(p);
  assert.ok(
    cap.musicBytes + cap.sfxBytes + cap.textBytes < streamlessCeiling,
    'case 3 must stay under the streaming-blind figure -- otherwise it would not isolate this bug'
  );
  const err = errorMessage(cap, /Music compiles/);
  assert.ok(err, 'content under BANK_SIZE-64 but over the real (streaming-inclusive) ceiling must still be refused');
});

// =================================================================================================
// Case 4 (R1) -- this file never hardcodes a stale or current ceiling figure; every number is
// derived from contentCeilingBytes/checkCapacity at run time. FIX 1 / item 5 adds a second
// technique alongside the literal scan: two differently-ceilinged real configurations must produce
// two different real ceilings -- a test that hardcoded the CURRENT ceiling for either one would be
// wrong for at least one of them.
// =================================================================================================

test('slice 10 case 4 (R1): this test file never hardcodes a kernel-hi ceiling figure, and every boundary is derived at run time', () => {
  const source = fs.readFileSync(THIS_FILE, 'utf8');
  // Built from digits, never written as a literal 4-digit run anywhere in this file's own source
  // (including comments) -- so this check cannot trip over its own forbidden-list line the way a
  // literal array would. Includes round 1's own historical ceiling figures, the streaming-blind
  // figure, and the round-1 review's own whole-case4.test.js mutant literal, so a regression of
  // either kind is caught.
  const stale = [
    [4, 3, 3, 6],
    [4, 4, 5, 9],
    [6, 0, 7, 5],
    [8, 1, 2, 8],
    [1, 5, 6, 0]
  ].map((digits) => digits.join(''));
  for (const literal of stale) {
    assert.ok(!source.includes(literal), `this file must not hardcode the stale/streaming-blind ceiling figure ${literal}`);
  }

  // Two configurations whose real ceilings must genuinely differ: an ordinary (non-streaming)
  // action project (streamworldHiBytesFor == 0) and a streaming RPG carrying the full committed
  // inventory plus a live scripted Move (one of the larger streamworldHiBytesFor combinations this
  // file's own cases build). A hardcoded CURRENT ceiling cannot be right for both at once.
  const ordinary = createProject('Ceiling probe ordinary', 'action');
  ordinary.cartridge.mapper = 30;
  assert.equal(streamworldHiBytesFor(ordinary), 0, 'the ordinary configuration must not be streaming');
  const ordinaryCeiling = contentCeilingBytes(ordinary);

  const { project: streamedMove } = buildCommittedInventory('rpg');
  addMoveOnlyEntity(streamedMove, streamedMove.maps[0].screens[0]);
  assert.ok(streamworldHiBytesFor(streamedMove) > 0, 'the streaming configuration must actually be streaming');
  const streamedCeiling = contentCeilingBytes(streamedMove);

  assert.notEqual(
    ordinaryCeiling,
    streamedCeiling,
    'two differently-configured real projects must have different real ceilings -- both are derived from contentCeilingBytes at run time here, never a literal'
  );
});

// =================================================================================================
// Item 2 (R5 exact relationship) -- the independent named relationship (predictedRealKernelHiBytes,
// above) holds exactly across builds that vary title length (0, 1, near the 28-char limit),
// table emptiness (no dialogue at all vs a full page), game type (action vs rpg) and the predicate
// that makes text live (plain dialogue, a Move-only event, a Save-only event, or an RPG's own
// always-on text) -- so no single shared unknown residual can pass by coincidence.
// =================================================================================================

test(
  "slice 10 item 2: the independent text/vectors relationship holds by name across varied titles, table emptiness, game types and predicates (R5)",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const builds = [];

    // V1: empty title (falls back to the placeholder itself -- textOverestimateBytes must be
    // exactly 4*TITLE_LINE_LIMIT, i.e. 0 title-length difference), action, no dialogue/Move/Save
    // at all (empty strings/events tables).
    {
      const p = createProject('', 'action');
      p.cartridge.mapper = 30;
      builds.push({ label: 'V1 empty title, empty tables, action', project: p });
    }
    // V2: a 1-character title, action, one plain dialogue line (nonempty tables).
    {
      const p = createProject('A', 'action');
      p.cartridge.mapper = 30;
      addFillerDialogue(p, p.maps[0].screens[0], 'Hello there, traveler.');
      builds.push({ label: 'V2 1-char title, nonempty tables, action, dialogue', project: p });
    }
    // V3: a title near the 28-char TITLE_LINE_LIMIT, rpg (always-on text), plain dialogue.
    {
      const title = 'A Very Long Game Title Here!'; // 28 characters exactly
      assert.equal(title.length, 28);
      const p = createProject(title, 'rpg');
      p.cartridge.mapper = 30;
      addFillerDialogue(p, p.maps[0].screens[0], 'The road ahead is long and quiet.');
      builds.push({ label: 'V3 28-char title, rpg, dialogue', project: p });
    }
    // V4: action, a Move-only event (no `say` at all) -- the Move predicate activates text on an
    // action project with no dialogue string of its own.
    {
      const p = createProject('Movers', 'action');
      p.cartridge.mapper = 30;
      addMoveOnlyEntity(p, p.maps[0].screens[0]);
      builds.push({ label: 'V4 action, Move-only predicate', project: p });
    }
    // V5: action, a Save-only event (no `say` at all) -- the Save predicate.
    {
      const p = createProject('Savers', 'action');
      p.cartridge.mapper = 30;
      p.project.titleMap = 0;
      p.project.titleScreen = 0;
      addSaveOnlyEntity(p, p.maps[0].screens[0]);
      builds.push({ label: 'V5 action, Save-only predicate', project: p });
    }

    for (const { label, project } of builds) {
      const cap = checkCapacity(project);
      assert.equal(cap.problems.filter((x) => x.severity === 'error').length, 0, `${label}: must build cleanly (${JSON.stringify(cap.problems)})`);
      const realUsed = await measureKernelHiBank(t, MAPPER, project);
      const predicted = predictedRealKernelHiBytes(cap, project);
      console.log(
        `item 2 (${label}): real ${realUsed}, predicted ${predicted} ` +
          `(music ${cap.musicBytes}, sfx ${cap.sfxBytes}, text ${cap.textBytes}, streaming ${streamworldHiBytesFor(project)}, ` +
          `vectors ${CPU_VECTOR_BYTES}, textOverestimate ${textOverestimateBytes(project)})`
      );
      assert.equal(realUsed, predicted, `${label}: the named R5 relationship must hold exactly (real ${realUsed} != predicted ${predicted})`);
    }
  }
);

// =================================================================================================
// Cases 5-11: item 5's closure. Every boundary builder below runs against TWO differently-ceilinged
// real configurations -- RPG no-Save (streamworldHiBytesFor's Save term off) and RPG+Save (a live
// `save` command on the fixed filler dialogue itself, a strictly smaller ceiling) -- rather than
// the single current value. Both ceilings are still derived from contentCeilingBytes/checkCapacity
// at run time (R1); running the identical case body against two real, independently differing
// ceilings is what lets a hand-authored expression standing in for `contentCeilingBytes(p)` (not
// just a literal digit run, which case 4 already forbids) be caught: it cannot be right for both
// configurations at once. BOUNDARY_CONFIGS deliberately carries only the withSave predicate, never
// either ceiling's numeric value.
// =================================================================================================

const BOUNDARY_CONFIGS = [
  { label: 'no-Save', withSave: false },
  { label: 'Save', withSave: true }
];

// Cases 5/6 -- grow MUSIC to the exact content ceiling (sfx/text fixed); one more byte is refused,
// naming Sound Forge. Item 4: case 6's refusal message is fully field-parsed and its printed
// exact/over contributions are logged (assertCeilingMessageFields's own BOUNDARY line).
for (const { label, withSave } of BOUNDARY_CONFIGS) {
  test(
    `slice 10 cases 5/6 [${label}]: growing music to the exact content ceiling builds; one byte more is refused naming Sound Forge`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async (t) => {
      const p = base(RESIDENT_CEILING_GAME_TYPE);
      importLibraryContent(p);
      const screen = p.maps[0].screens[0];
      addFillerDialogue(p, screen, 'Welcome, traveler. Rest well before the road ahead.', { save: withSave });
      const ceiling = contentCeilingBytes(p);
      const capFixed = checkCapacity(p);
      const target = ceiling - capFixed.sfxBytes - capFixed.textBytes;
      const fillers = growMusicExactly(p, target);

      const capFinal = checkCapacity(p);
      assert.equal(capFinal.musicBytes + capFinal.sfxBytes + capFinal.textBytes, ceiling);
      assert.equal(capFinal.problems.filter((x) => x.severity === 'error').length, 0, JSON.stringify(capFinal.problems));

      // R5: the exact-fit build really assembles, and checkCapacity's predicted kernel-hi occupancy
      // equals nesasm's own real usage of the kernel-hi bank to the byte (named relationship, item 2).
      const realUsed = await measureKernelHiBank(t, MAPPER, p);
      recordKernelHiOverhead(`case 5 [${label}]`, realUsed, capFinal, p);

      // Case 6: one more music byte (R6's own confirmed real 1-byte music step) is refused.
      let lastFiller = growableFiller(fillers);
      if (!lastFiller) {
        const song = createSong(`Filler music ${p.songs.length}`);
        song.instruments = [{ id: 0, name: 'F0', duty: 2, volEnv: [8], sustain: 0 }];
        p.songs.push(song);
        lastFiller = song.instruments[0];
      }
      lastFiller.volEnv.push(8);
      const capOver = checkCapacity(p);
      assert.equal(capOver.musicBytes, capFinal.musicBytes + 1);
      const err = errorMessage(capOver, /Music compiles/);
      assert.ok(err, 'case 6 must refuse with the content-ceiling message');
      assert.equal(err.where, 'Sound Forge', 'growing music over the ceiling must be attributed to Sound Forge');
      assertCeilingMessageFields(err.message, p, capOver, { grown: 'musicBytes', baseline: capFinal, where: err.where });
    }
  );
}

// Cases 7/8 -- grow SFX to the exact ceiling (music/text fixed); one more real sfx step (k=2, R6)
// is refused, naming Sound Forge/sfx. Item 4's closure: the target sfx delta's parity is ASSERTED
// up front (a chosen fixed representative input), never silently fudged by growing a second
// category when it comes out odd -- so a future input change that breaks the parity fails loudly.
for (const { label, withSave } of BOUNDARY_CONFIGS) {
  test(
    `slice 10 cases 7/8 [${label}]: growing sfx to the exact content ceiling builds; one more real sfx step is refused naming Sound Forge`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async (t) => {
      const p = base(RESIDENT_CEILING_GAME_TYPE);
      importLibraryContent(p);
      const screen = p.maps[0].screens[0];
      // An action project's dialogue compiles to different byte counts than an RPG's, so the string
      // that gave an exactly-reachable sfx delta for an RPG does not here (odd delta without Save;
      // a delta the 2-byte filler quantum overshoots with it). The assertions below say to pick
      // another string, never to fudge a category, so each configuration carries the shortest
      // suffix that makes its delta reachable.
      addFillerDialogue(p, screen, withSave ? 'Welcome traveler rest well before the road ahead!!' : 'Welcome traveler rest well before the road ahead!', { save: withSave });
      const ceiling = contentCeilingBytes(p);
      const capFixed = checkCapacity(p);
      const targetSfxDelta = ceiling - capFixed.musicBytes - capFixed.textBytes - capFixed.sfxBytes;
      assert.equal(
        targetSfxDelta % 2,
        0,
        `these fixed music/sfx/text inputs [${label}] must leave an even sfx delta to grow exactly (was ${targetSfxDelta}); ` +
          'choose a different fixed dialogue string if this ever fails -- never fudge a second category to force parity'
      );
      growSfxExactlyByEvenDelta(p, targetSfxDelta);

      const capFinal = checkCapacity(p);
      assert.equal(capFinal.musicBytes + capFinal.sfxBytes + capFinal.textBytes, ceiling);
      assert.equal(capFinal.problems.filter((x) => x.severity === 'error').length, 0, JSON.stringify(capFinal.problems));

      const realUsed = await measureKernelHiBank(t, MAPPER, p);
      recordKernelHiOverhead(`case 7 [${label}]`, realUsed, capFinal, p);

      // Case 8: the smallest real sfx step (k=2, R6) is refused.
      growSfxExactlyByEvenDelta(p, 2);
      const capOver = checkCapacity(p);
      assert.equal(capOver.sfxBytes, capFinal.sfxBytes + 2);
      const err = errorMessage(capOver, /Music compiles/);
      assert.ok(err, 'case 8 must refuse with the content-ceiling message');
      assert.equal(err.where, 'Sound Forge', 'growing sfx over the ceiling must be attributed to Sound Forge');
      assertCeilingMessageFields(err.message, p, capOver, { grown: 'sfxBytes', baseline: capFinal, where: err.where });
    }
  );
}

// Cases 9/10 -- grow TEXT to the exact ceiling (music/sfx fixed); one more character is refused,
// naming Map Forge/dialogue. Item 4: case 10's refusal message is fully field-parsed.
for (const { label, withSave } of BOUNDARY_CONFIGS) {
  test(
    `slice 10 cases 9/10 [${label}]: growing text to the exact content ceiling builds; one more character is refused naming Map Forge`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async (t) => {
      const p = base(RESIDENT_CEILING_GAME_TYPE);
      importLibraryContent(p);
      const screen = p.maps[0].screens[0];
      const sayCmd = addFillerDialogue(p, screen, 'Welcome traveler', { save: withSave });
      const ceiling = contentCeilingBytes(p);
      const capFixed = checkCapacity(p);
      const targetText = ceiling - capFixed.musicBytes - capFixed.sfxBytes;
      growTextExactlyBy(p, sayCmd, targetText - capFixed.textBytes);

      const capFinal = checkCapacity(p);
      assert.equal(capFinal.musicBytes + capFinal.sfxBytes + capFinal.textBytes, ceiling);
      assert.equal(capFinal.problems.filter((x) => x.severity === 'error').length, 0, JSON.stringify(capFinal.problems));

      const realUsed = await measureKernelHiBank(t, MAPPER, p);
      recordKernelHiOverhead(`case 9 [${label}]`, realUsed, capFinal, p);

      // Case 10: one more character (R6's confirmed real 1-byte mid-word text step) is refused.
      growTextExactlyBy(p, sayCmd, 1);
      const capOver = checkCapacity(p);
      assert.equal(capOver.textBytes, capFinal.textBytes + 1);
      const err = errorMessage(capOver, /Music compiles/);
      assert.ok(err, 'case 10 must refuse with the content-ceiling message');
      assert.equal(err.where, 'Map Forge', 'growing text over the ceiling must be attributed to Map Forge');
      assertCeilingMessageFields(err.message, p, capOver, { grown: 'textBytes', baseline: capFinal, where: err.where });
    }
  );
}

// Case 11 (R7) -- a byte traded BETWEEN categories at a constant three-way total must still build:
// this discriminates a genuinely shared ceiling from three independent per-category ceilings
// merely summed for display. Also an exact-fit point (R5): predicted kernel-hi occupancy must
// equal nesasm's real usage here too.
for (const { label, withSave } of BOUNDARY_CONFIGS) {
  test(
    `slice 10 case 11 [${label}] (R7): trading one music byte for one text byte at a constant total still builds, and stays exact (R5)`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async (t) => {
      const p = base();
      importLibraryContent(p);
      const screen = p.maps[0].screens[0];
      const sayCmd = addFillerDialogue(p, screen, 'Welcome, traveler. Rest well before the road ahead.', { save: withSave });
      const ceiling = contentCeilingBytes(p);
      const capFixed = checkCapacity(p);
      const target = ceiling - capFixed.sfxBytes - capFixed.textBytes;
      const fillers = growMusicExactly(p, target);
      assert.equal(checkCapacity(p).musicBytes + checkCapacity(p).sfxBytes + checkCapacity(p).textBytes, ceiling);

      // Pop one music byte, add one text byte: net zero.
      const lastFiller = poppableFiller(fillers);
      assert.ok(lastFiller, 'at least one filler instrument must have a poppable entry beyond its seed');
      lastFiller.volEnv.pop();
      const afterPop = checkCapacity(p);
      assert.equal(afterPop.musicBytes, target - 1);
      growTextExactlyBy(p, sayCmd, 1);

      const capFinal = checkCapacity(p);
      assert.equal(capFinal.musicBytes + capFinal.sfxBytes + capFinal.textBytes, ceiling, 'the traded total must still equal the ceiling');
      assert.equal(capFinal.problems.filter((x) => x.severity === 'error').length, 0, JSON.stringify(capFinal.problems));

      const realUsed = await measureKernelHiBank(t, MAPPER, p);
      recordKernelHiOverhead(`case 11 [${label}]`, realUsed, capFinal, p);
    }
  );
}

// =================================================================================================
// Case 12 (R4/R9) -- the RPG+streaming coexistence sample: the FULL committed inventory (item 1),
// sized realistically in both the kernel-hi bank AND the banked battle region at once, built once,
// checked against both R5's kernel-hi equality and R9's battleRegionBytes equality in the same
// build, then a REAL battle driven in and back out of a live streamed map.
// =================================================================================================

// R9's precondition: the RPG+Move+Save combination on this board was already confirmed refused by
// kernel-LO capacity (content-independent) in an earlier slice-10 session -- so this sample
// carries Save (live, via the last story-beat line's own `save` command) but never Move.
function buildR4Sample() {
  const p = base('rpg');
  p.project.titleMap = 0;
  p.project.titleScreen = 0;
  importLibraryContent(p);
  const monsterIds = importLibraryMonsters(p); // [Slime, Bat, Skeleton], in that order
  // Grouped 3 lines/entity (8 placed actors, not 24) -- see placeCommittedDialogue's own comment:
  // this build DOES call buildProject for real, and 24 distinct actors plus a full battle roster
  // overflows kernel-lo's entity tables on this board, a separate ceiling from kernel-hi content.
  const sayCommands = placeCommittedDialogue(p, { linesPerEntity: 3 }); // placed LAST

  // Two real spells, within Hero's own baseMp (8).
  p.spells = [createSpell(0, 'Spark'), createSpell(1, 'Mend')];
  p.spells[1].kind = 'heal';
  p.spells[1].amountMin = 10;
  p.spells[1].amountMax = 10;
  p.party[0].spells = [0, 1];

  // Two real items.
  p.items = [
    { id: 0, name: 'Potion', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 20 } },
    { id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 10 } }
  ];

  // A realistic wandering formation: all three imported monsters.
  p.maps[0].encounters = { rate: 40, actorIds: monsterIds };

  // The last committed line (the story's resolution beat) also saves the game live.
  const lastSay = sayCommands[sayCommands.length - 1];
  const lastEntity = p.maps[0].screens.flatMap((s) => s.entities ?? []).find((e) => e.props?.event?.pages?.[0]?.commands?.includes(lastSay));
  lastEntity.props.event.pages[0].commands.push({ op: 'save' });

  return { project: p, monsterIds, sayCommands };
}

test(
  'slice 10 case 12 (R4/R9): the committed RPG+streaming coexistence sample fits (or is honestly trimmed) and a real battle round-trips',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { project: p, monsterIds, sayCommands } = buildR4Sample();

    // Pin the full committed inventory here too (item 1's shrink requirement covers both the
    // measurement, case 1, AND this coexistence build): a shrunk dialogue set would otherwise
    // just trim less below and never fail on its own. Same independently preserved anchor as case
    // 1 -- the sorted-lines sha256 -- checked BEFORE any trimming below, plus the song, sfx and
    // full three-monster roster, all read back from the built project, never from
    // COMMITTED_DIALOGUE_ALL/LIBRARY_ENTRIES themselves.
    assert.equal(
      sayCommands.length,
      COMMITTED_DIALOGUE_COUNT,
      `case 12 must carry the full committed inventory; found ${sayCommands.length} lines, expected ${COMMITTED_DIALOGUE_COUNT}`
    );
    const case12Texts = sayCommands.map((c) => c.text);
    assert.equal(
      sha256Hex([...case12Texts].sort().join('\n')),
      COMMITTED_DIALOGUE_SORTED_SHA256,
      'case 12 committed dialogue must match the independently preserved anchor before any trim'
    );
    assert.deepEqual(p.songs.map((s) => s.name), REAL_SONG_NAMES, 'case 12 must carry every real song, untouched');
    assert.deepEqual(p.sfx.map((s) => s.name), REAL_SFX_NAMES, 'case 12 must carry every real sfx, untouched');
    assert.deepEqual(
      monsterIds.map((id) => p.sprites.actors[id].name),
      REAL_MONSTER_NAMES,
      'case 12 must carry the full three-monster roster (imported and charged, even though only Slime is fought below)'
    );

    // R4: report FITS/PINCH honestly. If the full committed draft overflows, trim dialogue ONLY
    // (never music/sfx, never monsters/spells/items) until it fits, and record by how many bytes
    // AND how many lines were shortened -- the R9 coexistence build's own dialogue-trim fallback,
    // never applied to item 1's own untrimmed measurement above.
    let cap = checkCapacity(p);
    let ceiling = contentCeilingBytes(p);
    let sum = cap.musicBytes + cap.sfxBytes + cap.textBytes;
    let trimmedBytes = 0;
    const trimmedLineIndices = new Set();
    const originalSum = sum;
    // Trim from the longest line down, stopping at a 10-character floor, never touching the Save
    // command itself (a separate event command from the text this loop shortens).
    while (sum > ceiling) {
      let longest = -1;
      let longestLen = 10;
      for (let i = 0; i < sayCommands.length; i++) {
        if (sayCommands[i].text.length > longestLen) {
          longest = i;
          longestLen = sayCommands[i].text.length;
        }
      }
      assert.ok(longest >= 0, `case 12: content cannot be trimmed further and still overflows by ${sum - ceiling} bytes`);
      const before = checkCapacity(p).textBytes;
      sayCommands[longest].text = sayCommands[longest].text.slice(0, -1).trimEnd();
      const after = checkCapacity(p).textBytes;
      trimmedBytes += before - after;
      trimmedLineIndices.add(longest);
      cap = checkCapacity(p);
      ceiling = contentCeilingBytes(p);
      sum = cap.musicBytes + cap.sfxBytes + cap.textBytes;
    }
    const spare = ceiling - sum;
    if (trimmedBytes > 0) {
      console.log(
        `R4 case 12: PINCH -- full committed draft was ${originalSum - ceiling} bytes over; trimmed ${trimmedBytes} bytes across ${trimmedLineIndices.size} line(s) of dialogue to fit (spare now ${spare})`
      );
    } else {
      console.log(
        `R4 case 12: FITS -- ${spare} bytes spare, no trimming needed (music ${cap.musicBytes}, sfx ${cap.sfxBytes}, text ${cap.textBytes}, ceiling ${ceiling})`
      );
    }
    assert.equal(cap.problems.filter((x) => x.severity === 'error').length, 0, JSON.stringify(cap.problems));

    // R9 (kernel-hi half): recorded into the same R5 consistency check as cases 5/7/9/11, and
    // asserted against the named relationship (item 2) even though this coexistence build's
    // content is not necessarily an exact fit and its RPG/save flags differ from the plainer cases.
    const realKernelHi = await measureKernelHiBank(t, MAPPER, p);
    recordKernelHiOverhead('case 12', realKernelHi, cap, p);

    // R9 (banked battle region half): battleRegionBytes equals nesasm's real banked-region usage,
    // in a SEPARATE build of the identical project (measureBattleRegion builds its own copy) --
    // both equalities are asserted against the same `p`, i.e. the same coexistence content.
    const region = await measureBattleRegion(t, MAPPER, p);
    assert.equal(region.used, region.predicted, "case 12: battleRegionBytes must equal nesasm's real banked-region usage");

    // R9: boot headlessly past naming to the streamed map, drive a REAL battle in (via
    // applyBattleTest, the shipped no-walk battle-start mechanism) against a single low-HP real
    // monster (Slime) for a reliable one-encounter win, then win it and assert the streamed map
    // resumes with its window/bank/locator state intact.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-s10-case12-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    const built = await buildProject({ dir, project: p, log: () => {} });
    const ram = parseEquates(await fsp.readFile(path.join(dir, 'build/constants.asm'), 'utf8'));
    const symbols = parseSymbolFile(await fsp.readFile(path.join(dir, 'build/game.fns'), 'utf8'));

    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(new Uint8Array(await fsp.readFile(built.romPath)));
    const nes = emulator.nes;
    for (let i = 0; i < 10; i++) emulator.runFrame();
    finishNamingIfOpen(nes);
    // The title screen's own fade-in does not accept Start immediately -- measured empirically,
    // a press inside the first ~30 frames after naming is silently dropped (pad_new never sets the
    // Start bit) even though game_state already reads ST_TITLE. 60 idle frames is a safe margin.
    for (let i = 0; i < 60; i++) emulator.runFrame();
    if (nes.cpu.mem[ram.game_state] === 3) {
      // ST_TITLE -- this sample carries a title screen (Save requires one). Press START once, the
      // same idiom banked.test.js's own MMC3 bank-race test uses.
      emulator.setButton(BUTTON.START, true);
      for (let i = 0; i < 3; i++) emulator.runFrame();
      emulator.setButton(BUTTON.START, false);
      for (let i = 0; i < 12; i++) emulator.runFrame();
    }
    for (let i = 0; i < 30 && nes.cpu.mem[ram.game_state] !== 0; i++) emulator.runFrame();
    assert.equal(nes.cpu.mem[ram.game_state], 0, 'case 12: must reach ST_GAMEPLAY before the battle-test can run');
    assert.equal(nes.cpu.mem[ram.map_is_streamed], 1, 'case 12: the player must be on the streamed map before the battle-test runs');

    // Item 3: a completed-landing boundary and a return-PC hook. `call_battle` (engine/banks.asm)
    // ends with `jmp set_screen_ptr` -- a tail call, not a return -- so the ORIGINAL caller's own
    // return address is still on the stack when set_screen_ptr begins. Hooking cpu.emulate to fire
    // when the PC first reaches set_screen_ptr captures that return address (read off the stack,
    // never off a live register being checked); hooking it again to fire when the PC reaches that
    // exact address is "the completed landing" -- set_screen_ptr's own `rts` has now fired and
    // control is back with call_battle's original caller. At THAT instant the locator RAM
    // (sw_row_bank_base/sw_col_region/sw_base_bank/sw_col_byte_hi/lo) independently derives what
    // the PRG bank and metatile pointer OUGHT to be for the current screen -- never read back from
    // nes.mmap.prgBank/mtptr_lo/hi themselves, which are the live values being checked.
    let badReturns = 0;
    let returns = 0;
    let pendingReturn;
    const originalEmulate = nes.cpu.emulate.bind(nes.cpu);
    nes.cpu.emulate = () => {
      const pc = (nes.cpu.REG_PC + 1) & 0xffff;
      const mem = nes.cpu.mem;
      if (pc === symbols.set_screen_ptr) {
        pendingReturn = (mem[0x100 | ((nes.cpu.REG_SP + 1) & 0xff)] + (mem[0x100 | ((nes.cpu.REG_SP + 2) & 0xff)] << 8) + 1) & 0xffff;
      } else if (pc === pendingReturn) {
        const region = mem[ram.sw_row_bank_base] + mem[ram.sw_col_region] + mem[ram.sw_base_bank];
        const expectedBank = region >> 1;
        const expectedPtr = ((region & 1 ? 0xa000 : 0x8000) + (mem[ram.sw_col_byte_hi] << 8) + mem[ram.sw_col_byte_lo]) & 0xffff;
        const actualPtr = mem[ram.mtptr_lo] + (mem[ram.mtptr_hi] << 8);
        // Item 3: the shadow byte itself (engine/banks.asm's switch_prg_bank ORs the bank into bits
        // 0-4 of mapper_shadow) must independently agree with the same locator-derived expectation --
        // a mismatch here is a real hardware-register desync distinct from jsnes's own nes.mmap.prgBank
        // bookkeeping, which a shadow-corrupt mutant that only breaks the RAM byte would otherwise miss.
        const actualShadowBank = mem[ram.mapper_shadow] & 0x1f;
        returns++;
        if (nes.mmap.prgBank !== expectedBank || actualPtr !== expectedPtr || actualShadowBank !== expectedBank) {
          badReturns++;
          console.log(
            `case 12 item 3: bad return #${returns} -- expected bank ${expectedBank} ptr ${expectedPtr}, ` +
              `actual bank ${nes.mmap.prgBank} ptr ${actualPtr} shadow-bank ${actualShadowBank}`
          );
        }
        pendingReturn = undefined;
      }
      return originalEmulate();
    };

    // A discriminating terrain read: every screen carries a distinct metatile pattern (distinctScreen,
    // above), so a deep-copied snapshot of the rendered nametable taken before the battle must be
    // byte-identical to one taken after it settles -- reading the WRONG screen's staged data (a
    // wrong PRG bank) would show a visibly different pattern, not merely a stale mirroring flag.
    // Item 3: real copies, not wrapper objects sharing the live typed arrays -- .slice() each
    // Uint8Array so a later in-place mutation of the live nameTable cannot silently make a stale
    // "before" snapshot equal a corrupted "after" one.
    const snapshotNametable = () => nes.ppu.nameTable.map((tile) => ({ tile: tile.tile.slice(), attrib: tile.attrib.slice() }));

    const before = {
      locator: [...Array(8)].map((_, i) => nes.cpu.mem[ram.sw_col + i]),
      mapperShadow: nes.cpu.mem[ram.mapper_shadow],
      chrPage: nes.mmap.chrPage,
      ntable1: [...nes.ppu.ntable1],
      window: snapshotNametable()
    };

    const slimeId = monsterIds[0];
    applyBattleTest(emulator, [slimeId], { ram, symbols });
    assert.equal(nes.cpu.mem[ram.game_state], 5, 'case 12: applyBattleTest must have started ST_BATTLE');
    assert.equal(nes.cpu.mem[ram.mon_slot_actor], slimeId);

    // Drive the fight to a win: FIGHT, confirm the default target, repeat until gameplay resumes.
    const A = 0;
    const tap = (button, frames = 14) => {
      emulator.setButton(button, true);
      nes.frame();
      emulator.setButton(button, false);
      for (let i = 0; i < frames; i++) nes.frame();
    };
    let rounds = 0;
    while (nes.cpu.mem[ram.game_state] === 5 && rounds < 20) {
      // bt_phase 1 (BP_MENU): FIGHT is command 0 -- already selected, just confirm.
      if (nes.cpu.mem[ram.bt_phase] === 1) {
        tap(A, 6);
      } else {
        tap(A, 12);
      }
      rounds++;
    }
    assert.equal(nes.cpu.mem[ram.game_state], 0, `case 12: the battle against a single Slime never resolved back to gameplay (stuck after ${rounds} rounds)`);

    // Item 3: an explicit completed-render boundary, not a fixed N-frame allowance -- wait for
    // frame_cnt to actually advance twice (as E1's battle-settled.test.js did), which is real
    // evidence that gameplay rendering has resumed and the return-PC hook has had the chance to
    // fire for every set_screen_ptr crossing the win triggers, rather than assuming any fixed
    // number of frames was enough.
    {
      let ticks = 0;
      let prev = nes.cpu.mem[ram.frame_cnt];
      for (let i = 0; i < 300 && ticks < 2; i++) {
        emulator.runFrame();
        const now = nes.cpu.mem[ram.frame_cnt];
        if (now !== prev) {
          ticks++;
          prev = now;
        }
      }
      assert.equal(ticks, 2, 'case 12: frame_cnt must advance twice after the battle to prove the completed-render boundary was really reached');
    }
    nes.cpu.emulate = originalEmulate;

    assert.ok(returns > 0, 'case 12: the completed-landing boundary hook must have fired at least once during the battle round-trip');
    assert.equal(badReturns, 0, `case 12: ${badReturns}/${returns} completed-landing boundaries left the wrong PRG bank/metatile pointer selected`);

    assert.equal(nes.cpu.mem[ram.map_is_streamed], 1, 'case 12: the streamed map must still be current after the battle');
    const after = {
      locator: [...Array(8)].map((_, i) => nes.cpu.mem[ram.sw_col + i]),
      mapperShadow: nes.cpu.mem[ram.mapper_shadow],
      chrPage: nes.mmap.chrPage,
      ntable1: [...nes.ppu.ntable1],
      window: snapshotNametable()
    };
    assert.deepEqual(after.locator, before.locator, 'case 12: the streamed locator (screen identity) must be restored exactly after the battle');
    assert.equal(after.chrPage, before.chrPage, 'case 12: the CHR page must be restored exactly');
    assert.deepEqual(after.ntable1, before.ntable1, 'case 12: the nametable mirroring state must be restored exactly');
    assert.deepEqual(
      after.window,
      before.window,
      "case 12: the rendered nametable window (deep-copied tile/attrib data, not the ntable1 mapping reference) must be restored exactly -- each screen's distinct terrain pattern makes this a discriminating check, not merely a config comparison"
    );

    // Item 3: a discriminating post-battle entity read, authored from the fixture itself rather
    // than from a before/after comparison -- so a mutant that corrupts both the "before" and
    // "after" snapshots identically (which a pure equality check cannot see) still fails here. The
    // round-robin chunk 0 dialogue NPC is placed on screens[0] at a fixed (actorId, x, y); the
    // player fights and resumes on that same physical screen, so this triple is the expected
    // answer a wrong-bank landing (reading a different physical screen's entity table) would get
    // wrong -- either a different actorId/position in the matching slot, or no match at all.
    const landmarkEntity = p.maps[0].screens[0].entities[0];
    let foundLandmark = false;
    for (let slot = 0; slot < 8; slot++) {
      if (!(nes.cpu.mem[ram.ent_active + slot] & 0x01)) continue;
      if (
        nes.cpu.mem[ram.ent_actor + slot] === landmarkEntity.actorId &&
        nes.cpu.mem[ram.ent_x + slot] === landmarkEntity.x &&
        nes.cpu.mem[ram.ent_y + slot] === landmarkEntity.y
      ) {
        foundLandmark = true;
        break;
      }
    }
    assert.ok(
      foundLandmark,
      `case 12: after the battle, the known landmark NPC (actorId ${landmarkEntity.actorId} at x=${landmarkEntity.x} y=${landmarkEntity.y}) must be present in entity RAM on the resumed screen`
    );

    // Functional liveness: the player can actually move, proving the world is really interactive
    // again, not merely reporting ST_GAMEPLAY while the screen or input is silently stuck.
    const xBefore = nes.cpu.mem[ram.player_x];
    const yBefore = nes.cpu.mem[ram.player_y];
    const RIGHT = 7;
    for (let i = 0; i < 20 && nes.cpu.mem[ram.game_state] === 0; i++) {
      emulator.setButton(RIGHT, true);
      emulator.runFrame();
    }
    emulator.setButton(RIGHT, false);
    for (let i = 0; i < 4; i++) emulator.runFrame();
    assert.equal(nes.cpu.mem[ram.game_state], 0, 'case 12: the world must still be in ST_GAMEPLAY after the battle');
    const moved = nes.cpu.mem[ram.player_x] !== xBefore || nes.cpu.mem[ram.player_y] !== yBefore;
    assert.ok(moved, 'case 12: the player must actually be able to move after the battle (world must not be stuck)');
  }
);

// =================================================================================================
// R5 (final): the real, content-independent residual recorded by every case above (5, 7, 9, 11 in
// both the no-Save and Save configurations, plus 12 -- nine differently-mixed builds) must be the
// identical constant (0, given the named relationship is asserted directly at each recording site
// now). node:test runs a file's top-level tests in declaration order, so this always runs last,
// after every recording.
// =================================================================================================

test(
  'slice 10 R5: the named kernel-hi relationship leaves a zero residual, identically, across every differently-mixed build',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  () => {
    assert.equal(
      kernelHiOverheadSamples.length,
      9,
      `expected 9 recorded builds (cases 5, 7, 9, 11 x [no-Save, Save], plus 12), got ${kernelHiOverheadSamples.length}: ${JSON.stringify(kernelHiOverheadSamples)}`
    );
    for (const sample of kernelHiOverheadSamples) {
      assert.equal(sample.overhead, 0, `${sample.label}'s residual must be exactly 0 (was ${sample.overhead})`);
    }
    console.log(`R5: the named relationship's residual is 0 across all ${kernelHiOverheadSamples.length} builds`);
  }
);
