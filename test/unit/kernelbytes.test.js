// kernelCodeBytes (main/build/generate.js) is a hand-measured over-estimate
// of the engine code that shares the fixed kernel's low bank with the lookup
// tables, and checkCapacity() trusts it to leave room for both. It is a
// function of the project and mapper: save/load (engine/save.asm) only
// assembles where the project has a live Save command on a battery-capable
// board, Move only where the project has a live Move command, the title
// screen (engine/title.asm) only where the project has one that resolves
// (projectUsesEffectiveTitle), and the base itself is now per mapper rather
// than one flat number shared by every board
// -- see the long comment beside kernelCodeBytes for why a shared base
// overcharged every board but the one it was measured on. A measurement
// taken on only one configuration, or on only one of the RPG-capable boards,
// is not the worst case, and the gap between the guess and reality only
// shows up as the assembler's own "Bank overflow" once a project actually
// turns on what this test did not look at, which is exactly the
// raw-assembler-output failure this codebase otherwise refuses to ship. This
// builds the real worst case for every configuration, on every board that
// configuration applies to, and asserts kernelCodeBytes still covers each —
// so the next regression, in either direction, is a failing test here rather
// than a bug report from someone else's project.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import {
  kernelCodeBytes,
  baseKernelCodeBytes,
  titleKernelAllowance,
  checkCapacity,
  BASE_KERNEL_CODE_BYTES_BY_MAPPER,
  TITLE_KERNEL_ALLOWANCE_BY_MAPPER,
  KERNEL_SLACK,
  SAVE_KERNEL_ALLOWANCE_BY_MAPPER,
  MOVE_KERNEL_ALLOWANCE,
  FACE_KERNEL_ALLOWANCE,
  TURN_KERNEL_ALLOWANCE,
  WAIT_KERNEL_ALLOWANCE,
  SPLIT_LOCK_KERNEL_ALLOWANCE,
  ITEM_KERNEL_ALLOWANCE,
  ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE,
  itemEffectKernelAllowance
} from '../../main/build/generate.js';
import { SUPPORTED_MAPPERS, rpgCapable, saveMediaImplemented, prgLayout } from '../../shared/cartridge.js';
import { createTileset, createProject, projectUsesItems } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const SAMPLE = path.join(ROOT, 'sample');
// This test builds its own temporary ROMs from scratch rather than reading
// sample-rpg/build/game.nes, so it must not gate on that file the way the
// tests that actually read it do — this is the one thing standing between a
// kernel-overflow regression and a clean checkout silently skipping the test
// built to catch it. It depends on nothing but nesasm itself.
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// rpgCapable() (shared/cartridge.js) is the single writer for which boards an
// RPG may target at all -- and, since sample-rpg needs both switchable PRG
// and switchable CHR to build at all, it is also the complete list of boards
// BASE_KERNEL_CODE_BYTES_BY_MAPPER can ever hold a measured entry for.
// Asserting the ceiling on only one of them assumes today's ordering holds
// forever, and a margin over the runner-up is not a margin a future change
// need respect.
const CAPABLE_MAPPERS = SUPPORTED_MAPPERS.filter(rpgCapable);

/**
 * Builds sample-rpg on `mapper` with every conditionally-assembled block
 * heal/damage's own measurement already covered (dialogue, action combat,
 * the RPG battle system, branches, questions, common-event calls, Play
 * music, Start a battle, Heal/Damage), plus a live Save and/or Move command
 * per `withSave`/`withMove`, and a title screen per `withTitle` -- the whole
 * point is nothing conditional is left out of whichever configuration is
 * being measured. The baseline is title-*off*: `withTitle` defaults to
 * false, because a title screen is no longer baked unconditionally into
 * BASE_KERNEL_CODE_BYTES_BY_MAPPER (see the long comment in generate.js) and
 * sample-rpg as checked in has none. `withSave` forces a title on
 * regardless of `withTitle`, because validateProject refuses a live Save
 * command with no title screen ("Continue has nowhere to appear without
 * one") -- there is no way to measure Save without one. Returns the real
 * kernel code size: nesasm's own usage for the kernel-lo bank, minus
 * everything before `reset` in it (the lookup tables — kernel_lo.inc,
 * palettes, metatiles, sprites, input, maps, chrtables — `reset` being the
 * first label of boot.asm, the first file of engine code included after
 * them), measured off the real assembly rather than recomputed by hand here.
 */
async function measureCodeBytes(
  t,
  mapper,
  { withSave = false, withMove = false, withTurn = false, withWait = false, withTitle = false, withItems = true } = {}
) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelbytes-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = mapper.id;
  // sample-rpg carries one live item by default; withItems: false strips it
  // so a caller can isolate ITEM_KERNEL_ALLOWANCE's own delta the same way
  // withSave/withMove/withTitle isolate theirs.
  if (!withItems) project.items = [];
  if (withTitle || withSave) {
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
  } else {
    project.project.titleMap = null;
  }
  const commands = [];
  if (withSave) commands.push({ op: 'save' });
  if (withMove) commands.push({ op: 'move', who: 'self', dir: 'up', dist: 16 });
  if (withTurn) commands.push({ op: 'turn', who: 'self', dir: 'up' });
  if (withWait) commands.push({ op: 'wait', frames: 30 });
  if (commands.length) {
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    });
  }
  await saveProject(dir, project);
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });

  const { kernelLoBank } = prgLayout(mapper);
  // nesasm's own "segment usage" table, one row per bank: "BANK  62   7182/1010"
  // — right-aligned, so the free half can carry a leading space the used
  // half never does ("7235/ 957").
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  assert.ok(Number.isFinite(used) && used > 0, `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`);

  assert.ok(built.symbolPath, `${mapper.name}: nesasm should have written a symbol file`);
  const symbols = await fsp.readFile(built.symbolPath, 'utf8');
  const resetMatch = symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m);
  assert.ok(resetMatch, `${mapper.name}: reset should be a named symbol in game.fns`);
  const resetAddr = parseInt(resetMatch[1], 16);

  return { project, codeBytes: used - (resetAddr - 0xc000) };
}

/**
 * The direct check, per board and per configuration: kernelCodeBytes must
 * cover what nesasm actually used, and the margin it leaves must sit between
 * KERNEL_SLACK (any less and the reservation has fallen behind the engine)
 * and KERNEL_SLACK * 2 (any more and the term has stopped tracking the
 * engine closely enough to catch the next regression — the same "too loose
 * to mean anything" failure mode as too tight, just silent instead of loud).
 * A per-mapper base measured directly off this board's own build should
 * leave *exactly* KERNEL_SLACK once every conditional term is accounted
 * for; the ceiling exists for the day that stops being true rather than to
 * license slack that was never supposed to be there.
 */
function assertCovers(entry, budget, label) {
  const margin = budget - entry.codeBytes;
  assert.ok(
    entry.codeBytes <= budget,
    `${label} on ${entry.mapper.name}: nesasm used ${entry.codeBytes} bytes of kernel code but ` +
      `kernelCodeBytes only reserves ${budget} — checkCapacity() is promising table room the assembler will ` +
      'refuse. Re-measure and raise the relevant term (see the comment beside kernelCodeBytes).'
  );
  assert.ok(
    margin >= KERNEL_SLACK,
    `${label} on ${entry.mapper.name}: kernelCodeBytes reserves ${budget} but the real usage is ` +
      `${entry.codeBytes} bytes — only a ${margin}-byte margin, under the ${KERNEL_SLACK}-byte KERNEL_SLACK ` +
      'this reservation is supposed to leave untouched. Re-measure and raise the relevant term (see the ' +
      'comment beside kernelCodeBytes).'
  );
  assert.ok(
    margin <= KERNEL_SLACK * 2,
    `${label} on ${entry.mapper.name}: kernelCodeBytes reserves ${budget}, far more than the real usage of ` +
      `${entry.codeBytes} bytes — a ${margin}-byte margin is more than twice KERNEL_SLACK can explain; confirm ` +
      'this measurement is still the actual worst case rather than a stale, overly generous guess.'
  );
}

// The fail-closed half of kernelCodeBytes's own usesSave gate
// (`projectUsesSave(project) && saveMediaImplemented(mapper)`, see its
// comment): if a board's saveMediaImplemented() ever answers true without a
// matching SAVE_KERNEL_ALLOWANCE_BY_MAPPER entry, kernelCodeBytes indexes
// the table with `undefined`, the whole budget silently becomes NaN, and
// every capacity comparison against it (`kernelFree < 0`, assertCovers's own
// `<=`) reads as false -- a capacity check that always "passes" is worse
// than one that fails loudly. This is live for all three of today's
// saveMediaImplemented() boards -- MMC1 and MMC3 on battery,
// SAVE_FLASH_IMPLEMENTED now true so UNROM 512 on flash as well, each with
// its own measured entry checked below -- and it stands guard against a
// fourth: the day some future save medium's saveMediaImplemented() answers
// true before this table has a matching measured entry for it, this is what
// stops kernelCodeBytes from silently computing NaN for that board instead.
// A titleless project with a live Save command is not a build
// validateProject will ever pass -- "A project with a Save command needs a
// title screen" fires regardless of the mapper -- so kernelCodeBytes must
// price it as the only thing it can legally become, not as the invalid
// thing it currently is. Charging only on whether titleMap happened to be
// set yet (dropped in the phase4a round-2 review) undercharged a titleless
// Save project by exactly
// TITLE_KERNEL_ALLOWANCE_BY_MAPPER, which let a mapper be recommended and
// the Build panel's own meter show room for a project that both stops
// fitting and stops being buildable the moment the author adds the title
// screen they are already required to. Pure JS, no nesasm build needed --
// this is a claim about kernelCodeBytes's own arithmetic, not about what
// nesasm assembles.
test('a live Save command charges the title allowance even while titleMap is still null', () => {
  for (const mapper of CAPABLE_MAPPERS) {
    const titleless = createProject('RPG', 'rpg');
    titleless.cartridge.mapper = mapper.id;
    titleless.project.titleMap = null;
    titleless.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
    });
    const titled = structuredClone(titleless);
    titled.project.titleMap = 0;
    titled.project.titleScreen = 0;

    assert.equal(
      kernelCodeBytes(titleless, mapper),
      kernelCodeBytes(titled, mapper),
      `${mapper.name}: a live Save command should charge the same kernel-lo budget whether or not titleMap is ` +
        'set yet -- the valid form of this project always carries a title screen'
    );
  }
});

test('every saveMediaImplemented() board has a finite SAVE_KERNEL_ALLOWANCE_BY_MAPPER entry', () => {
  for (const mapper of SUPPORTED_MAPPERS) {
    if (!saveMediaImplemented(mapper)) continue;
    assert.ok(
      Number.isFinite(SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]),
      `${mapper.name}: saveMediaImplemented() is true but SAVE_KERNEL_ALLOWANCE_BY_MAPPER[${mapper.id}] is ` +
        `${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]} -- kernelCodeBytes would silently compute NaN for a ` +
        'live Save command on this board. Add a measured entry before shipping this combination.'
    );
  }
});

test(
  'kernelCodeBytes covers the real engine, on every RPG-capable board, in every conditional combination',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    assert.ok(CAPABLE_MAPPERS.length > 0, 'no RPG-capable mapper is registered — rpgCapable() found nothing');
    // saveMediaImplemented, not batteryCapable: UNROM 512 saves too, by
    // flashing its own PRG-ROM rather than battery RAM, and its own
    // SAVE_KERNEL_ALLOWANCE_BY_MAPPER entry needs the same exact-delta
    // measurement every battery board already gets below, or a stale flash
    // figure could drift for as long as assertCovers's own ceiling (which
    // only ever judges the *worst* board) happened not to notice.
    const saveMappers = CAPABLE_MAPPERS.filter(saveMediaImplemented);
    assert.ok(saveMappers.length > 0, 'no save-capable board is registered — saveMediaImplemented() found nothing');

    // Every RPG-capable board, nothing conditional turned on -- title-off,
    // the new meaning of "nothing conditional" now that a title screen is
    // its own term rather than baked unconditionally into the base (see the
    // long comment beside kernelCodeBytes). This is also what
    // BASE_KERNEL_CODE_BYTES_BY_MAPPER is supposed to equal, board by board
    // — the direct form of that claim, not a consequence of it.
    const noSave = [];
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper);
      noSave.push({ mapper, project, codeBytes });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'no Save, no Move, no title');
      assert.equal(
        baseKernelCodeBytes(mapper),
        BASE_KERNEL_CODE_BYTES_BY_MAPPER[mapper.id],
        `${mapper.name}: baseKernelCodeBytes should read straight out of the per-mapper table for a measured board`
      );
    }

    // Round 4 finding (Medium 6): ITEM_KERNEL_ALLOWANCE's own comment
    // claimed this file measured its exact delta on every RPG-capable
    // board, when in fact nothing here had ever isolated it -- the only
    // equality involving it lived in the combined MMC3 Save+Move test below,
    // which cannot separate the item term from every other term in the same
    // equation. sample-rpg carries one live item by default, so "no Save, no
    // Move, no title" above is not "no items" -- this is the direct
    // isolation, the same shape as the title/save/move deltas already are:
    // measure with items stripped, diff against the noSave baseline (which
    // already has them), and assert equality, per board, not merely covered
    // by assertCovers' own worst-board-only margin.
    //
    // Round 2 (ROADMAP item 5 phase 4c): use_item_apply (engine/ui.asm) is
    // gated by the identical ITEMS_ENABLED toggle this test already strips
    // to isolate ITEM_KERNEL_ALLOWANCE, so the same delta now carries both
    // allowances together -- there is no toggle that turns one on without
    // the other. ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg (60), not
    // the flat worst case (63, action): sample-rpg is an RPG project, and
    // itemEffectKernelAllowance's whole reason to exist as a per-game-type
    // table rather than one flat number is that the two really do differ,
    // so asserting the RPG figure here and the action figure below is what
    // keeps this an equality check rather than a >= that would let either
    // side's slack hide.
    for (const mapper of CAPABLE_MAPPERS) {
      const { codeBytes } = await measureCodeBytes(t, mapper, { withItems: false });
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = noSaveEntry.codeBytes - codeBytes;
      const expected = ITEM_KERNEL_ALLOWANCE + ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg;
      assert.equal(
        delta,
        expected,
        `${mapper.name}: sample-rpg's one item costs ${delta} bytes of kernel code (${codeBytes} -> ` +
          `${noSaveEntry.codeBytes}), but ITEM_KERNEL_ALLOWANCE + ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg ` +
          `reserves ${expected} — this allowance must equal an item’s real cost exactly, on every board. ` +
          're-measure and correct it (see the comment beside kernelCodeBytes).'
      );
    }

    // Every RPG-capable board again, this time with a title screen and
    // nothing else -- the direct measurement TITLE_KERNEL_ALLOWANCE_BY_MAPPER
    // is supposed to equal, and also the correct title-on baseline the
    // Save delta below has to diff against (Save always carries a title, so
    // diffing it against the title-*off* baseline above would silently fold
    // the title's own cost into the save figure).
    const noSaveTitle = [];
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withTitle: true });
      noSaveTitle.push({ mapper, project, codeBytes });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a title screen, no Save, no Move');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      // Equality, not <=, for the same reason every other term here is: a
      // <= check would let a stale, over-large figure hide behind
      // assertCovers's own worst-board-only ceiling the same way
      // SAVE_KERNEL_ALLOWANCE_BY_MAPPER's own history (below) already warns
      // against.
      assert.equal(
        delta,
        TITLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id],
        `${mapper.name}: a title screen costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but TITLE_KERNEL_ALLOWANCE_BY_MAPPER[${mapper.id}] reserves ` +
          `${TITLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]} — a per-mapper allowance must equal this board's own ` +
          'measured delta exactly. Re-measure and correct it (see the comment beside kernelCodeBytes).'
      );
    }

    // Only the save-capable boards, a live Save command and nothing else --
    // diffed against the title-*on* baseline just above, not the title-off
    // one, because validateProject requires a title screen alongside any
    // live Save command: both sides of this subtraction carry the same
    // title cost, so it cancels out and this delta is save/load's own cost
    // alone, exactly as it was before the title term existed to conflate it
    // with.
    const withSave = [];
    for (const mapper of saveMappers) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withSave: true });
      withSave.push({ mapper, project, codeBytes });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Save command');
      const noSaveTitleEntry = noSaveTitle.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveTitleEntry.codeBytes;
      // Equality, not <=: a per-mapper allowance is supposed to equal that
      // board's own exact measured delta, not merely cover it -- a <= check
      // alone lets a stale, over-large figure (say, MMC1 left at the old
      // shared 552 instead of its own true 547) pass silently with a wider
      // margin than KERNEL_SLACK was ever meant to leave, which is exactly
      // the drift assertCovers's own ceiling exists to catch but, per
      // mapper, does not: assertCovers only ever judges the *worst* board's
      // margin, so a non-worst board's allowance can sit wrong indefinitely
      // underneath it.
      assert.equal(
        delta,
        SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id],
        `${mapper.name}: save/load costs ${delta} bytes of kernel code (${noSaveTitleEntry.codeBytes} -> ${codeBytes}), ` +
          `but SAVE_KERNEL_ALLOWANCE_BY_MAPPER[${mapper.id}] reserves ` +
          `${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]} — a per-mapper allowance must equal this board's own ` +
          'measured delta exactly. Re-measure and correct it (see the comment beside kernelCodeBytes).'
      );
    }

    // Every RPG-capable board, a live Move command and nothing else.
    // MOVE_KERNEL_ALLOWANCE is deliberately one flat number rather than a
    // per-mapper table (see its own comment) — this is what backs that claim
    // directly, board by board, rather than trusting it stayed true. A
    // Move-only project also assembles move_face (FACE_ENABLED, since
    // projectUsesFace is projectUsesMove || projectUsesTurn), so the real
    // delta is the two allowances together, not MOVE_KERNEL_ALLOWANCE alone
    // -- asserting against the sum here is what proves move_face was not
    // silently dropped by the split, the same way the Turn-only block below
    // proves it was not silently duplicated.
    const withMove = [];
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withMove: true });
      withMove.push({ mapper, project, codeBytes });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Move command');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      // Equality, not <=, the same reasoning SAVE_KERNEL_ALLOWANCE_BY_MAPPER's
      // own check above already applies: MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_
      // ALLOWANCE claim to sum to Move's exact real cost on every measured
      // board, with no margin of their own (KERNEL_SLACK is the only
      // deliberate headroom this function carries) -- a <= check would let a
      // stale, over-large figure pass by overcharging every project that
      // moves anything, the same way a stale SAVE allowance could hide
      // behind assertCovers's own ceiling.
      assert.equal(
        delta,
        MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE,
        `${mapper.name}: Move costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), but ` +
          `MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE reserves ` +
          `${MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} — this must equal Move's real cost ` +
          'exactly, on every board. Re-measure and correct it (see the comment beside kernelCodeBytes).'
      );
    }

    // Every RPG-capable board, a live Turn command and nothing else. Turn
    // also pulls in move_face (FACE_ENABLED), so this proves the opposite
    // direction from the Move block above: a Turn-only project pays for
    // TURN_KERNEL_ALLOWANCE and FACE_KERNEL_ALLOWANCE, and *not* for
    // MOVE_KERNEL_ALLOWANCE's own ~379 bytes of move_tick/move_get_x/y/
    // move_set_x/y/move_speed/move_animate, which a Turn-only project never
    // calls at all. A test that only ever built Move (or only ever built
    // Turn stacked on top of Move) could not tell "Turn-only pays the whole
    // of MOVE_ENABLED's old bundle" apart from "Turn-only pays its own
    // share" -- this is the configuration that tells them apart.
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withTurn: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Turn command');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE,
        `${mapper.name}: Turn-only costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE reserves ` +
          `${TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} — a Turn-only project must pay for exactly its own ` +
          "opcode plus move_face, never Move's own ~379-byte machinery it never calls."
      );
    }

    // Every RPG-capable board, a live Wait command and nothing else. Wait
    // touches no code Move, Turn or Face also touch, so this is the plainest
    // of the four new configurations: its delta should be WAIT_KERNEL_
    // ALLOWANCE and nothing else.
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withWait: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Wait command');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        WAIT_KERNEL_ALLOWANCE,
        `${mapper.name}: Wait-only costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but WAIT_KERNEL_ALLOWANCE reserves ${WAIT_KERNEL_ALLOWANCE} — this allowance must equal Wait's real ` +
          'cost exactly, on every board.'
      );
    }

    // Every RPG-capable board, live Turn and Wait together, no Move. Proves
    // the two commands' allowances are genuinely additive -- Wait touching
    // no code Turn or Face touch means this delta should be exactly the sum
    // of the two configurations just measured above, not something less
    // (which would mean the two share cost this model is not counting) or
    // more (which would mean one is somehow being charged twice).
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withTurn: true, withWait: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'live Turn and Wait commands together');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE,
        `${mapper.name}: Turn+Wait costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE reserves ` +
          `${TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE} — Turn and Wait must be ` +
          'purely additive, since Wait touches no code Turn or Face also touch.'
      );
    }

    // Every RPG-capable board, live Turn and Move together, no Wait. The one
    // configuration that actually exercises FACE_ENABLED's whole reason for
    // existing: both commands call move_face, so this delta must be
    // MOVE_KERNEL_ALLOWANCE + TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE
    // -- FACE_KERNEL_ALLOWANCE counted once, not twice. A gating mistake that
    // charged move_face per-command rather than per-project would show up
    // here as a delta FACE_KERNEL_ALLOWANCE too high; one that dropped it
    // when either command's own predicate alone controlled it would show up
    // as too low.
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withTurn: true, withMove: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'live Turn and Move commands together');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        MOVE_KERNEL_ALLOWANCE + TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE,
        `${mapper.name}: Turn+Move costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          'but MOVE_KERNEL_ALLOWANCE + TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE reserves ' +
          `${MOVE_KERNEL_ALLOWANCE + TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} — move_face must be charged ` +
          'exactly once when both commands that call it are live, never zero times and never twice.'
      );
    }

    // The battery boards, a live Save *and* a live Move command together --
    // the combination that overflowed by 332 bytes before the kernel diet,
    // and by 12 after it but before per-mapper budgeting. Not additive by
    // assumption: measured as its own build, the same as every other
    // configuration here.
    //
    // UNROM 512 is deliberately excluded here, not merely unmeasured: this
    // combination on that board is a real, currently unfixed shortfall --
    // sample-rpg with Save and Move together overflows kernel-lo bank 62 by
    // enough that nesasm itself refuses it (`Bank overflow, offset > $1FFF!`
    // in music.asm), confirmed by building past checkCapacity's own refusal
    // and letting the assembler answer directly, the same way this file's
    // own MMC3 story below was confirmed. That story closed by finding 12
    // bytes; this one is 167 short (checkCapacity: "the lookup tables need
    // 129 bytes but only -38 are free alongside the engine code"). This
    // comment used to record 155, but that was already stale before this
    // session touched anything: rebuilding the identical scenario at the
    // commit before item 6 (a worktree at aa8c628) gives "-35 are free",
    // a true pre-existing deficit of 164, not 155. Of the 12-byte gap
    // between the two recorded figures, only 3 are battle_end's own
    // talk_ent fix (item 6's Turn/Wait slice, unconditional kernel-lo cost
    // on every RPG build) -- the other 9 were this comment drifting from
    // reality before that fix ever existed, caught only by re-measuring
    // rather than arithmetic on the old number. Which reads as a real gap
    // rather than reservation conservatism, and closing it is not this
    // phase's own work. Bracketed precisely, not just excluded here, by
    // "sample-rpg with Save and Move on UNROM 512 does not build" below.
    //
    // MMC3 joined UNROM 512's exclusion once already, for one revision of
    // this file, for the identical reason UNROM 512 stays excluded:
    // sample-rpg carries a live item, and ITEM_KERNEL_ALLOWANCE (16 bytes,
    // measured, main/build/generate.js) plus item_metasprite's own table
    // byte was real cost the combination's 21-byte real margin (1 byte of
    // modelled headroom beyond KERNEL_SLACK) did not have. A kernel diet in
    // engine/player.asm (the four movement direction routines' identical
    // two-corner probe-and-commit tail, collapsed into one shared routine
    // per axis) recovered enough real kernel-lo headroom that this
    // combination briefly closed again, with real headroom rather than a
    // single spare byte -- and round 2 (ROADMAP item 5 phase 4c,
    // use_item_apply) spent exactly that headroom and 8 bytes more.
    // ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg (60 bytes, measured) is
    // real cost the diet's own margin did not have room for a second time,
    // the identical shape this exclusion already documents for UNROM 512 --
    // see "sample-rpg with Save, Move and its one live item does not build
    // on MMC3" below, the direct mirror of the UNROM 512 test just past it.
    for (const mapper of saveMappers.filter((m) => m.id !== 30 && m.id !== 4)) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withSave: true, withMove: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Save command and a live Move command');
    }

    // MMC3 is the only scanline-IRQ board, and an RPG always shows text, so
    // every MMC3 measurement above already carries SPLIT_LOCK_KERNEL_ALLOWANCE
    // baked into its own real usage. This is the direct check that the term
    // is exactly what MMC3's own no-Save measurement needs beyond its own
    // per-mapper base -- not a stray byte either way, and not folded into the
    // base itself (see the comment beside kernelCodeBytes for why it stays a
    // separate term).
    //
    // Phase 4b: sample-rpg (what measureCodeBytes always builds) carries one
    // live item, so "no Save, no Move, no title" is not "no items" -- every
    // measurement in this whole function unconditionally includes
    // ITEM_KERNEL_ALLOWANCE, and, since round 2, ITEM_EFFECT_KERNEL_ALLOWANCE
    // too (use_item_apply is gated by the identical ITEMS_ENABLED toggle).
    // That cancels out in every *other* delta this test computes (both
    // sides of each subtraction carry it equally), but not here:
    // baseKernelCodeBytes is a static, pre-items constant with no item cost
    // of its own to cancel against, so both have to be added back in by
    // hand on this one comparison -- sample-rpg is an RPG project, so the
    // game-type-specific figure (.rpg) is the one that applies.
    const mmc3 = noSave.find((entry) => entry.mapper.id === 4);
    if (mmc3) {
      assert.equal(
        mmc3.codeBytes - baseKernelCodeBytes(mmc3.mapper) - ITEM_KERNEL_ALLOWANCE - ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg,
        SPLIT_LOCK_KERNEL_ALLOWANCE,
        "MMC3's own no-Save measurement should exceed its per-mapper base by exactly SPLIT_LOCK_KERNEL_ALLOWANCE " +
          'plus ITEM_KERNEL_ALLOWANCE plus ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg (every RPG shows text, ' +
          'so every MMC3 RPG pays the interrupt-race fix, and sample-rpg always carries a live item)'
      );
    }
  }
);

// Mappers sample-rpg cannot target at all (rpgCapable() is false — no
// switchable PRG, or no switchable CHR) fall back to the largest measured
// per-mapper base rather than a guess of their own. This is what keeps that
// fallback pinned to a real number rather than letting it drift silently:
// a project on one of these boards must reserve exactly what it always did.
test('a mapper kernelbytes cannot measure falls back to the largest measured per-mapper base', () => {
  const unmeasured = SUPPORTED_MAPPERS.filter((mapper) => !(mapper.id in BASE_KERNEL_CODE_BYTES_BY_MAPPER));
  assert.ok(unmeasured.length > 0, 'expected at least one supported mapper outside the measured set (e.g. NROM)');
  const worst = Math.max(...Object.values(BASE_KERNEL_CODE_BYTES_BY_MAPPER));
  for (const mapper of unmeasured) {
    assert.equal(
      baseKernelCodeBytes(mapper),
      worst,
      `${mapper.name}: an unmeasured mapper should fall back to the largest measured base (${worst})`
    );
  }
});

// The same shape for the title term: an action project with a title screen
// is exactly as reachable on NROM, CNROM, GxROM, Color Dreams or UxROM as it
// is on any RPG-capable board (a title has nothing to do with rpgCapable()),
// so this term needs a safe fallback too, not just the base it sits beside.
test('a mapper the title term cannot measure falls back to the largest measured per-mapper allowance', () => {
  const unmeasured = SUPPORTED_MAPPERS.filter((mapper) => !(mapper.id in TITLE_KERNEL_ALLOWANCE_BY_MAPPER));
  assert.ok(unmeasured.length > 0, 'expected at least one supported mapper outside the measured set (e.g. NROM)');
  const worst = Math.max(...Object.values(TITLE_KERNEL_ALLOWANCE_BY_MAPPER));
  for (const mapper of unmeasured) {
    assert.equal(
      titleKernelAllowance(mapper),
      worst,
      `${mapper.name}: an unmeasured mapper should fall back to the largest measured title allowance (${worst})`
    );
  }
});

// The fallback base is known to be safe (over-reserved, never under) purely
// by construction -- it is the largest of three real measurements -- but
// nothing before this assembled a real project on any of the five mappers it
// stands in for to say so by how much, or to catch it if that ever stopped
// being true. This builds `sample` -- the action-adventure fixture every
// other engine test is already written against, itself exercising combat and
// text -- on each of them, with a live Move command too, and asserts the
// fallback still covers the real usage.
const FALLBACK_MAPPERS = SUPPORTED_MAPPERS.filter((mapper) => !(mapper.id in BASE_KERNEL_CODE_BYTES_BY_MAPPER));

/**
 * Builds `sample` -- the action-adventure fixture, not sample-rpg, since
 * these five boards cannot target an RPG at all -- on `mapper` with
 * `titleMap` forced to either present or absent, and a live Move command
 * added only when `withMove` says so, returning nesasm's own kernel-lo
 * code-byte usage the same way measureCodeBytes does for the RPG-capable
 * boards above.
 */
async function measureFallbackCodeBytes(t, mapper, { titled, withMove = false } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-fallback-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.cartridge.mapper = mapper.id;
  if (titled) {
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
  } else {
    project.project.titleMap = null;
  }
  if (withMove) {
    const slime = project.sprites.actors[0];
    project.maps[0].screens[0].entities.push({
      actorId: slime.id,
      x: 16,
      y: 16,
      props: {
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'self', dir: 'up', dist: 16 }] }] }
      }
    });
  }
  await saveProject(dir, project);
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });

  const { kernelLoBank } = prgLayout(mapper);
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  const symbols = await fsp.readFile(built.symbolPath, 'utf8');
  const resetAddr = parseInt(symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m)[1], 16);
  return { project, codeBytes: used - (resetAddr - 0xc000) };
}

// Building only a title-on sample (the fixture's own checked-in state) used
// to fold two claims into one number: the fallback base covering title-off
// usage, and the fallback title allowance covering the title delta. Either
// term could regress while the other's slack silently absorbed it and this
// test stayed green -- exactly the "a single combined figure masks a
// regression in either half" gap the phase4a round-2 review found here.
// Building both variants and asserting each term against its own real
// measurement is what closes that, the same way the RPG-capable boards'
// own per-mapper terms are checked individually above rather than only in
// combination.
//
// The base/title pair below is measured with Move switched *off*: an
// earlier version of this test always carried a live Move command (395
// bytes) yet compared the result against `baseKernelCodeBytes(mapper)`
// alone -- a term that claims nothing about Move at all. That passed only
// because the five fallback boards' shared base happens to be generous
// enough to absorb 395 bytes of code it was never charged for measuring,
// which is exactly the failure mode this codebase's own SAVE_KERNEL_ALLOWANCE
// history warns about: a comparison that happens to hold today would have
// rejected a correctly *tightened* base tomorrow, for a reason that had
// nothing to do with the base being wrong. Base and title are measured
// clean of Move so each assertion below is checking the thing its own
// constant actually claims to be; the "everything real fits" sanity check
// that used to ride along on the title-on variant now gets its own
// title-on-and-Move build instead, checked against kernelCodeBytes's own
// combined answer for that same project (base + title + Move + slack), so
// Move's own flat allowance is still exercised on these boards rather than
// silently untested here.
test(
  'the fallback base and the fallback title allowance each safely over-reserve on their own, for every mapper they stand in for',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    assert.ok(FALLBACK_MAPPERS.length > 0, 'expected at least one unmeasured mapper (e.g. NROM)');
    for (const mapper of FALLBACK_MAPPERS) {
      const off = await measureFallbackCodeBytes(t, mapper, { titled: false });
      const on = await measureFallbackCodeBytes(t, mapper, { titled: true });
      const base = baseKernelCodeBytes(mapper);
      const titleAllowance = titleKernelAllowance(mapper);
      const titleDelta = on.codeBytes - off.codeBytes;

      assert.ok(
        off.codeBytes <= base,
        `${mapper.name}: real title-off kernel code (${off.codeBytes} bytes) exceeds the fallback base (${base}) ` +
          "-- if this board's own code has grown past it, it needs its own measured entry in " +
          'BASE_KERNEL_CODE_BYTES_BY_MAPPER instead of the shared fallback.'
      );
      assert.ok(
        titleDelta <= titleAllowance,
        `${mapper.name}: a title screen really costs ${titleDelta} bytes of kernel code (${off.codeBytes} -> ` +
          `${on.codeBytes}), which exceeds the fallback title allowance (${titleAllowance}) -- if this board's ` +
          'own title cost has grown past it, it needs its own measured entry in ' +
          'TITLE_KERNEL_ALLOWANCE_BY_MAPPER instead of the shared fallback.'
      );
      // The combined claim these two terms exist to support: a real,
      // title-on, Move-carrying build still fits inside what kernelCodeBytes
      // reserves for it. A build of its own, not derived from `on` above,
      // so Move's own 395-byte allowance is genuinely exercised on these
      // boards rather than assumed from the RPG-capable boards' own coverage.
      const onWithMove = await measureFallbackCodeBytes(t, mapper, { titled: true, withMove: true });
      assert.ok(
        onWithMove.codeBytes <= kernelCodeBytes(onWithMove.project, mapper),
        `${mapper.name}: real kernel code (${onWithMove.codeBytes} bytes, title on, with a live Move command) ` +
          `exceeds the fallback budget (${kernelCodeBytes(onWithMove.project, mapper)})`
      );
    }
  }
);

// ROADMAP item 5 phase 4c round 2: ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE's
// own direct isolation, on every registered board -- not just the three
// RPG-capable ones the sample-rpg-based test above already covers. An action
// project needs this measured too: use_item_apply's damage branch differs in
// size between BATTLE_ENABLED (party_damage) and !BATTLE_ENABLED
// (lose_hearts plus a zero-page read of player_hp), so the action-side figure
// is a real, independent measurement, not assumed from the RPG one.
async function measureItemEffectCodeBytes(t, mapper, withItems) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-itemeffect-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const project = createProject('Effect', 'action');
  project.cartridge.mapper = mapper.id;
  project.sprites.actors.push({ id: 0, name: 'Potion', behavior: 'pickup', speed: 1, hp: 1, anims: {} });
  project.items = withItems
    ? [{ id: 0, name: 'Potion', actorId: 0, metaspriteId: null, effect: { kind: 'heal', amount: 30 } }]
    : [];
  project.maps[0].screens[0].entities.push({ actorId: 0, x: 16, y: 16, props: {} });
  await saveProject(dir, project);
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });
  const { kernelLoBank } = prgLayout(mapper);
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  const symbols = await fsp.readFile(built.symbolPath, 'utf8');
  const resetAddr = parseInt(symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m)[1], 16);
  return { project, codeBytes: used - (resetAddr - 0xc000) };
}

test(
  'ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.action is exact, on every registered board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of SUPPORTED_MAPPERS) {
      const without = await measureItemEffectCodeBytes(t, mapper, false);
      const withItems = await measureItemEffectCodeBytes(t, mapper, true);
      const delta = withItems.codeBytes - without.codeBytes;
      const expected = ITEM_KERNEL_ALLOWANCE + ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.action;
      assert.equal(
        delta,
        expected,
        `${mapper.name}: an action project's one item costs ${delta} bytes of kernel code (${without.codeBytes} -> ` +
          `${withItems.codeBytes}), but ITEM_KERNEL_ALLOWANCE + ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.action ` +
          `reserves ${expected} — re-measure and correct it (see the comment beside kernelCodeBytes).`
      );
      assert.equal(
        itemEffectKernelAllowance(withItems.project),
        ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.action,
        `${mapper.name}: itemEffectKernelAllowance should read the action figure straight out of the table for an action project`
      );
    }
  }
);

test('itemEffectKernelAllowance falls back to the larger measured figure for a gameType the table has no entry for', () => {
  const bogus = { project: { gameType: 'not-a-real-game-type' } };
  const worst = Math.max(...Object.values(ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE));
  assert.equal(itemEffectKernelAllowance(bogus), worst, 'an unrecognized gameType must fall back to the larger of the two measured figures, never undercharge');
});

// --- feature-aware capacity errors -----------------------------------------
//
// checkCapacity() naming a droppable feature or a roomier board, rather than
// only reporting the byte shortfall, is the user-facing payoff of a
// per-mapper budget: computed from kernelCodeBytes's own terms
// (kernelShortfallAdvice in main/build/generate.js), not guessed. These
// build no ROM — checkCapacity is a pure function of the project — so they
// need neither nesasm nor a temp directory, and they inflate the project
// with plain dummy actors (8 bytes of tableBytes each, nothing any
// conditionally-assembled code path reads) purely to control the size of the
// shortfall.
//
// Any specific deficit figure named in a comment below is descriptive, not
// asserted -- these tests check the recommendation checkCapacity gives
// (which feature, which board, or the fallback), not the literal byte count
// that provoked it. That is exactly why such a figure can rot unnoticed: a
// kernel-lo change moves the number, the assertions never touch it, and the
// suite stays green while the comment quietly goes stale. Re-measure rather
// than adjust by arithmetic when correcting one.

function kernelShortfallMessage(project) {
  const { problems } = checkCapacity(project);
  const error = problems.find((p) => p.severity === 'error' && /lookup tables/.test(p.message));
  assert.ok(error, 'expected checkCapacity to refuse this project over kernel-lo capacity');
  return error.message;
}

// The deficit checkCapacity's own refusal names -- "need {tableBytes} bytes
// but only {free} are free" -- pulled from the same message
// kernelShortfallMessage returns rather than recomputed by hand here, so a
// test asserting a specific deficit band is asserting the real refusal, not
// a parallel calculation of it that could drift from what checkCapacity
// actually decided.
function kernelShortfallDeficit(project) {
  const message = kernelShortfallMessage(project);
  const match = message.match(/need (\d+) bytes but only (-?\d+) are free/);
  assert.ok(match, `could not parse a deficit out of: ${message}`);
  return Number(match[1]) - Number(match[2]);
}

function inflate(project, count) {
  const template = project.sprites.actors[0];
  for (let i = 0; i < count; i++) {
    project.sprites.actors.push({ ...structuredClone(template), id: 1000 + i, name: `Filler${i}` });
  }
}

test('a kernel-lo shortfall a live Move command alone would close names Move', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 4; // MMC3
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'self', dir: 'up', dist: 16 }] }] } }
  });
  // 80, not the original 70: MMC3's own base dropped 70 bytes with the
  // kernel diet's movement-tail dedup (engine/player.asm), so the old count
  // no longer produces any deficit at all; re-derived against a real
  // checkCapacity() run, not assumed from the base delta alone.
  inflate(project, 80);
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command/);
  assert.doesNotMatch(message, /Save command/, 'this project never turns Save on, so it must not be offered as a fix');
});

// A dependent term, not just Move's own allowance: fontBankSplit
// (shared/font.js) reads projectUsesText, and projectUsesText counts *any*
// event that survives to the ROM, live Move-only ones included -- so an
// action project on MMC3 whose only event is "Move" turns split-lock on for
// a reason that disappears the moment that Move is gone too. Summing the
// flat allowances (395 for Move) would miss the 19 bytes SPLIT_LOCK_KERNEL_ALLOWANCE
// also frees here and wrongly fall through past a deficit only 2 bytes over
// what Move alone frees. Reproduction from review: a 397-byte deficit: 395
// alone does not cover it, 395 + 19 = 414 does.
test('a kernel-lo shortfall Move alone would not close by its own allowance can still close when dropping it also turns off split-lock', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 4; // MMC3
  // The project's only event, and its only command -- the project's sole
  // reason projectUsesText (and so fontBankSplit) is true at all.
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'self', dir: 'up', dist: 16 }] }] } }
  });
  // 169, not the original 159: the kernel diet's movement-tail dedup
  // (engine/player.asm) dropped MMC3's own base by a further 70 bytes, so
  // 159's own deficit (397 before the diet) fell to 327 -- under
  // MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE (what dropping this
  // project's only Move, and so its only reason to assemble move_face,
  // actually frees), which no longer exercises split-lock being freed
  // alongside it at all. Re-derived against a real checkCapacity() run, not
  // assumed from the base delta alone: 169 lands the deficit at 407, inside
  // the (395, 414] band this case exists to reproduce -- 395 = 379 + 16,
  // unchanged by the Turn/Wait first slice's move_face split, since a
  // project with a live Move and no Turn still pays both terms together.
  inflate(project, 169); // deficit 407, strictly above 395 and at or below 414
  // The message assertion below would still pass if drift ever dropped the
  // deficit to, say, 200 bytes -- solo's own freed figure (414, Move's own
  // cost plus the split-lock it also turns off) covers any deficit up to
  // 414, not only the one this case is calibrated for. That is not what
  // this test is supposed to demonstrate: the band a deficit has to sit in
  // for split-lock's own extra 19 bytes to be the thing making the
  // difference is strictly above Move's own allowance alone (395) and at
  // or below the combined figure (414) -- below 395 and Move alone already
  // covers it without split-lock in the picture at all, and above 414
  // neither figure would close the gap. Asserted directly, per the phase4a
  // round-2 review, rather than left implicit in the message match below.
  const deficit = kernelShortfallDeficit(project);
  const moveAlone = MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE;
  assert.ok(
    deficit > moveAlone,
    `deficit ${deficit} must exceed MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE (${moveAlone}) alone, or this ` +
      'case does not exercise split-lock being freed alongside Move at all'
  );
  assert.ok(
    deficit <= moveAlone + SPLIT_LOCK_KERNEL_ALLOWANCE,
    'deficit ' +
      `${deficit} must not exceed MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE + SPLIT_LOCK_KERNEL_ALLOWANCE ` +
      `(${moveAlone + SPLIT_LOCK_KERNEL_ALLOWANCE}), or dropping Move would not close the gap either`
  );
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command \(frees 414 bytes\)/);
});

test('a kernel-lo shortfall a live Save command alone would close names Save, with that board’s own allowance', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 1; // MMC1 — its own SAVE_KERNEL_ALLOWANCE_BY_MAPPER entry is 547, not MMC3's 552
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
  inflate(project, 100);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Save command \\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[1]} bytes\\)`));
  assert.doesNotMatch(message, /Move command/, 'this project never turns Move on, so it must not be offered as a fix');
  // Title is now its own kernelCodeBytes term, but it is content on a map,
  // not a command projectWithoutCommands can switch off -- and this project
  // could not drop it anyway (validateProject requires one alongside a live
  // Save). kernelShortfallAdvice must never suggest it.
  assert.doesNotMatch(message, /title/i, 'a title screen is not a droppable command and must never be offered as a fix');
});

test('a kernel-lo shortfall neither Save nor Move would close, but a roomier board would, names that board', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 30; // UNROM 512 — the largest per-mapper base of the three, so MMC1 has headroom to spare
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  // No Save, no Move: kernelShortfallAdvice must skip straight past the
  // feature-drop branch (neither is live) to the mapper-swap one.
  // 128, not the original 120: the kernel diet's movement-tail dedup
  // (engine/player.asm) dropped every board's own base by 70 bytes alike, so
  // 120 no longer produces any deficit. Re-derived against a real
  // checkCapacity() run: 128 currently lands a 77-byte kernel-lo deficit (12
  // at the last measurement of this figure -- re-measured, not adjusted by
  // arithmetic, per this file's own note above on why that matters here).
  //
  // "Comfortably inside the narrow window ... out of 195 bytes MMC1 would
  // save" was never actually why 128 works, and this file's own re-check
  // found that out rather than assuming it: 77 is nowhere close to 195, yet
  // 128 is already within one filler actor of failing. The real ceiling is a
  // different bank. inflate()'s dummy actors are also monster stat entries
  // battleTables compiles into the banked battle-code region
  // (main/build/battletables.js), which MMC1 shares the identical
  // 8172-byte ceiling for regardless of kernel-lo -- each filler actor costs
  // it 30 bytes there. At 128 fillers (132 actors total) that region has
  // exactly 30 bytes free on MMC1; at 129 it is exactly full (still fits);
  // at 130 it overflows by 30, and MMC1 stops being offered a full 102
  // kernel-lo bytes before its own 195-byte saving would ever have run out
  // (confirmed directly: switchableMappers(project, u512) returns [1] at 129
  // fillers and [] at 130). So the window this test actually sits inside is
  // one filler actor's worth of headroom in the banked battle region, not a
  // kernel-lo byte band -- the two banks merely happen to both grow with the
  // same inflate() call, and the smaller one has always been the one that
  // runs out first.
  inflate(project, 128);
  const message = kernelShortfallMessage(project);
  assert.match(message, /Try MMC1 in the Build panel/);
});

// A mapper suggestion is unverifiable the moment the project carries any
// hand-written 6502, so it is withheld rather than guessed.
//
// kernelCodeBytes measures the *stock* kernel. A Code Forge override replaces
// one of the files it measured, and even a plain user file lands in this same
// bank through assets/usercode.inc -- so a candidate board can reserve enough
// *modelled* bytes to look like a fix while the real, unmeasured code still
// overflows. That is the same guess this codebase refuses to make about user
// code anywhere else (checkCode leaves it out of the byte math for exactly this
// reason), just aimed at the Build panel's mapper select instead of at a byte
// count.
//
// This is a deliberate reduction in what existing projects are told: a project
// carrying any Code Forge file stops receiving mapper suggestions it used to
// receive. The advice that remains -- drop a feature, reduce content -- is
// unaffected and stays true either way.
//
// The same project without the code is asserted first, so this cannot pass by
// the suggestion having vanished for some unrelated reason.
test('a mapper suggestion is withheld from a project carrying hand-written code', async () => {
  const base = await loadProject(SAMPLE_RPG);
  base.cartridge.mapper = 30; // UNROM 512 -- the case above proves MMC1 is offered here
  base.project.titleMap = 0;
  base.project.titleScreen = 0;
  inflate(base, 128); // see the identical recalibration note on the case above

  assert.match(
    kernelShortfallMessage(structuredClone(base)),
    /Try MMC1 in the Build panel/,
    'the control: without any Code Forge content this project is told to try MMC1'
  );

  for (const [label, code] of [
    ['an override of an engine file', { overrides: [{ name: 'player.asm', text: '; mine\n' }], files: [] }],
    ['a user file of its own', { overrides: [], files: [{ name: 'mine.asm', text: '; mine\n' }] }]
  ]) {
    const project = structuredClone(base);
    project.code = code;
    const message = kernelShortfallMessage(project);
    assert.doesNotMatch(
      message,
      /Build panel/,
      `with ${label} the kernel size is unmeasurable, so no board may be recommended — got: ${message}`
    );
    assert.match(
      message,
      /Reduce the number of screens, actors or metasprites\.$/,
      'the fallback advice still applies and stays true regardless of what the hand-written code assembles to'
    );
  }
});

// A mapper suggestion that survives the kernel-byte check alone is not
// necessarily safe: it also has to hold what the project actually has.
// Reproduction from review: an MMC3 RPG with 17 tilesets and a small kernel
// shortfall reserves 206 fewer bytes of kernel code on MMC1 -- comfortably
// enough to close a 72-byte gap -- but MMC1 holds only 16 tilesets, so
// switching would have reconcileCartridge (shared/project.js) silently
// truncate the seventeenth the moment the author actually clicked it. The
// advice must check tileset capacity (and, by the same reasoning, screen
// capacity and mirroring support) before ever naming a board, not just its
// kernel-byte cost -- and must not touch the project either way.
test('a mapper suggestion never recommends a board that cannot hold this project\'s tilesets', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 4; // MMC3 -- holds up to 32 tilesets
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  while (project.tilesets.length < 17) project.tilesets.push(createTileset(project.tilesets.length));
  // 126, not the original 120: the kernel diet's movement-tail dedup
  // (engine/player.asm) dropped MMC3's own base by 70 bytes, so 120 no
  // longer produces a deficit at all. Re-derived against a real
  // checkCapacity() run: 126 currently lands a 72-byte deficit (7 at the
  // last measurement of this figure), comfortably inside the 206 bytes
  // MMC1's own savings would otherwise "cover" -- unlike the UNROM 512 case
  // above, this project's 126 fillers leave the banked battle-code region on
  // MMC1 with 90 bytes to spare, so the tileset ceiling below is genuinely
  // the only thing ruling MMC1 out here, not a second, unnoticed capacity
  // wall.
  inflate(project, 126); // forces a kernel-lo shortfall MMC1's own savings would otherwise "cover"
  const before = structuredClone(project);
  const message = kernelShortfallMessage(project);
  assert.doesNotMatch(
    message,
    /MMC1/,
    'MMC1 holds only 16 tilesets, so it must never be offered to a 17-tileset project'
  );
  assert.match(message, /Reduce the number of screens, actors or metasprites\.$/, 'no RPG-capable board holds 17 tilesets besides MMC3 itself');
  assert.deepEqual(project, before, 'checkCapacity must not mutate the project while evaluating candidate boards');
});

test('a kernel-lo shortfall no single change would close falls back to the generic message', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 30; // UNROM 512
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  inflate(project, 300);
  const message = kernelShortfallMessage(project);
  assert.match(message, /Reduce the number of screens, actors or metasprites\.$/);
});

// A retired guard, left as a comment rather than silently vanishing: through
// phase 2.2, UNROM 512 was save-capable but not save-*implemented*
// (saveMediaImplemented, shared/cartridge.js, was false for flash), which
// made kernelCodeBytes charge it *nothing* for a live Save command --
// artificially cheap to a naive "how many kernel-lo bytes would switching
// save" comparison, and a test here (MMC3, a live Save, 119 filler actors,
// a 556-byte deficit) pinned that UNROM 512 was never recommended for it
// even though the buggy arithmetic alone would have suggested it saves 563
// bytes. Phase 2.3 gave UNROM 512 a real, measured
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER entry (engine/flash.asm), so that
// scenario no longer exists to guard against: every candidate's own
// kernelCodeBytes now charges its real save cost, UNROM 512 included, and
// whether it gets recommended is just real arithmetic like any other board.

function saveAndMoveEvent() {
  return {
    actorId: 0,
    x: 16,
    y: 16,
    props: {
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }]
          }
        ]
      }
    }
  };
}

// The outcome this whole change was scoped against, and its history in four
// parts now, not three. sample-rpg with a live Save command *and* a live
// Move command, on MMC3, used to be short of the kernel-lo bank (332 bytes
// before the kernel diet, 12 after it, 4 after per-mapper budgeting) even
// though nesasm itself could assemble the real code into the bank with room
// left over; the entity_contact fix (engine/combat.asm) closed that specific
// gap, down to a real, measured 21 bytes free (1 byte of modelled headroom
// beyond KERNEL_SLACK). Phase 4b's own ITEM_KERNEL_ALLOWANCE (16 bytes,
// measured on all three RPG-capable boards -- see main/build/generate.js)
// was real cost sample-rpg was always going to pay the moment items[]
// stopped being schema-only, and it reopened the gap: 16 (code) + 1
// (item_metasprite table) = 17 bytes the 21-byte margin did not have,
// exactly the capacity wall the phase 4 design document's §6 predicted.
//
// The kernel diet (engine/player.asm's four direction routines, an
// identical two-corner probe-and-commit tail collapsed into one shared
// routine per axis) closed it again, with real headroom rather than a
// single spare byte -- 74 real bytes free, at the time phase 4c round 1
// shipped.
//
// Round 2 (ROADMAP item 5 phase 4c, engine/ui.asm's use_item_apply) spent
// that headroom and reopened the gap a third time, by design rather than by
// accident: use_item_apply is real engine code this phase always needed,
// gated by the same ITEMS_ENABLED toggle as everything phase 4b already
// charged, and ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg (60 bytes,
// measured on all three RPG-capable boards) is exactly what it costs. The
// user decided this outcome explicitly rather than asking for another kernel
// diet: sample-rpg with Save, Move and its one live item no longer fits on
// MMC3, and that is accepted as a real, documented limitation -- the
// identical shape "sample-rpg with Save and Move on UNROM 512 does not
// build" below already holds to, not a silent gap.
test(
  'sample-rpg with Save, Move and its one live item does not build on MMC3 -- round 2 reopened the gap the kernel diet had closed, a documented limitation',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    assert.ok(project.items.length > 0, 'this case needs sample-rpg\'s own live item still in play');

    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      new RegExp(
        `removing every Move command \\(frees ${MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} bytes\\) or every Save command ` +
          `\\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[4]} bytes\\)`
      ),
      'the refusal should name both commands and both of their real byte figures, not just report the deficit'
    );

    // The design's own mitigations (drop Move; switch to MMC1) still work,
    // exactly as they did before round 2 -- this is what checkCapacity's own
    // advice above names, confirmed as a real fix rather than merely claimed.
    const droppedMove = structuredClone(project);
    droppedMove.maps[0].screens[0].entities.at(-1).props.event.pages[0].commands =
      droppedMove.maps[0].screens[0].entities.at(-1).props.event.pages[0].commands.filter((c) => c.op !== 'move');
    assert.deepEqual(
      checkCapacity(droppedMove).problems.filter((p) => p.severity === 'error'),
      [],
      'dropping Move should still be a real fix'
    );

    const onMmc1 = structuredClone(project);
    onMmc1.cartridge.mapper = 1;
    assert.deepEqual(
      checkCapacity(onMmc1).problems.filter((p) => p.severity === 'error'),
      [],
      'the same combination should still fit comfortably on MMC1'
    );
    {
      const mmc1Dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-savemove-mmc1-'));
      t.after(() => fsp.rm(mmc1Dir, { recursive: true, force: true }));
      await saveProject(mmc1Dir, onMmc1);
      const mmc1Lines = [];
      const mmc1Built = await buildProject({ dir: mmc1Dir, project: onMmc1, log: (line) => mmc1Lines.push(line) });
      assert.ok(mmc1Built.romPath, 'nesasm should have assembled a ROM on MMC1');
      const mmc1BankLine = mmc1Lines.find((line) => /^BANK\s+14\s/.test(line));
      assert.ok(mmc1BankLine, "MMC1's own kernel-lo bank (14) should appear in nesasm's usage table");
      const mmc1Free = Number(mmc1BankLine.match(/\d+\/\s*(\d+)\s*$/)?.[1]);
      assert.ok(mmc1Free >= KERNEL_SLACK, `expected at least KERNEL_SLACK (${KERNEL_SLACK}) free, got ${mmc1Free}`);
    }
  }
);

// The UNROM 512 mirror of the MMC3 story just above -- except this
// combination does not close, and is not expected to (see the comment
// excluding mapper 30 from the Save+Move loop earlier in this file, and the
// flash-save landing report). Bracketed precisely rather than left as a
// silent exclusion from that loop: Save alone fits and genuinely assembles,
// Move alone fits and genuinely assembles, and only the combination is
// refused -- by checkCapacity itself, before nesasm ever runs, exactly the
// "the assembler is the capacity check" property this file's own header
// comment describes for the case where the reservation actually is
// accurate. kernelShortfallAdvice must name both commands and both of their
// real byte figures, because at this exact deficit either alone would close
// it (see the "offers both as a choice" test below for that same shape).
// The deficit itself is deliberately not asserted: it will drift with any
// unrelated change to kernel-lo, and pinning it would fail on a harmless
// change elsewhere the same way a literal free-byte count would (see the
// comment a few tests up). What must not drift silently is the *fact* of
// the refusal and which two things it blames -- if a future kernel diet on
// this board ever closes the gap, this test should fail and force a
// conscious update, the same way flipping SAVE_FLASH_IMPLEMENTED itself
// was a single flag someone had to notice and change.
test(
  'sample-rpg with Save and Move on UNROM 512 does not build -- a documented limitation, not a silent gap',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const saveOnly = await loadProject(SAMPLE_RPG);
    saveOnly.cartridge.mapper = 30; // UNROM 512
    saveOnly.project.titleMap = 0;
    saveOnly.project.titleScreen = 0;
    saveOnly.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
    });
    const saveDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-unrom512-save-'));
    t.after(() => fsp.rm(saveDir, { recursive: true, force: true }));
    await saveProject(saveDir, saveOnly);
    const saveBuilt = await buildProject({ dir: saveDir, project: saveOnly, log: () => {} });
    assert.ok(saveBuilt.romPath, 'Save alone should fit and assemble on UNROM 512');

    const moveOnly = await loadProject(SAMPLE_RPG);
    moveOnly.cartridge.mapper = 30;
    moveOnly.project.titleMap = 0;
    moveOnly.project.titleScreen = 0;
    moveOnly.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: {
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'self', dir: 'up', dist: 16 }] }] }
      }
    });
    const moveDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-unrom512-move-'));
    t.after(() => fsp.rm(moveDir, { recursive: true, force: true }));
    await saveProject(moveDir, moveOnly);
    const moveBuilt = await buildProject({ dir: moveDir, project: moveOnly, log: () => {} });
    assert.ok(moveBuilt.romPath, 'Move alone should fit and assemble on UNROM 512');

    const both = await loadProject(SAMPLE_RPG);
    both.cartridge.mapper = 30;
    both.project.titleMap = 0;
    both.project.titleScreen = 0;
    both.maps[0].screens[0].entities.push(saveAndMoveEvent());
    const message = kernelShortfallMessage(both);
    assert.match(
      message,
      new RegExp(
        `removing every Move command \\(frees ${MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} bytes\\) or every Save command ` +
          `\\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[30]} bytes\\)`
      ),
      'the refusal should name both commands and both of their real byte figures, not just report the deficit'
    );

    // sample-rpg carries one live item by default, so `both` above exercises
    // the item-bearing reservation (ITEM_KERNEL_ALLOWANCE included) -- not
    // the item-free one ROADMAP.md's own "Suggested order" section cites this
    // test for. The two are close enough (17 bytes apart at last measurement:
    // ITEM_KERNEL_ALLOWANCE plus item_metasprite's own one-byte table entry)
    // that a future saving landing between them would let the item-free
    // configuration fit while `both` above kept refusing and kept passing --
    // the exact silent-drift failure this file's header comment describes,
    // just relocated to a sentence in ROADMAP.md instead of a constant here.
    // Isolated the same way withItems does in measureCodeBytes above, rather
    // than reused from a shared helper, because this is the one place that
    // needs the *refusal* to survive the strip, not the code-byte count.
    const bothItemFree = await loadProject(SAMPLE_RPG);
    bothItemFree.cartridge.mapper = 30;
    bothItemFree.project.titleMap = 0;
    bothItemFree.project.titleScreen = 0;
    bothItemFree.items = [];
    assert.equal(
      projectUsesItems(bothItemFree),
      false,
      'this case exists to isolate the item-free reservation -- confirm the strip actually turned usesItems off'
    );
    bothItemFree.maps[0].screens[0].entities.push(saveAndMoveEvent());
    const itemFreeMessage = kernelShortfallMessage(bothItemFree);
    assert.match(
      itemFreeMessage,
      new RegExp(
        `removing every Move command \\(frees ${MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} bytes\\) or every Save command ` +
          `\\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[30]} bytes\\)`
      ),
      'the item-free configuration must still be refused on UNROM 512 -- if this ever fits, ROADMAP.md\'s ' +
        '"Suggested order" section is citing a test that no longer backs its claim'
    );
  }
);

// Both drops individually clearing the gap is still a real code path — a
// project short by less than either allowance should be offered a choice
// between them, not just one. sample-rpg's own Save+Move combination on
// MMC3 no longer triggers this (see above), so this inflates the project's
// table content to force a deficit comfortably under both allowances.
test('a kernel-lo shortfall either Save or Move alone would close offers both as a choice', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 4; // MMC3
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push(saveAndMoveEvent());
  inflate(project, 25);
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command \(frees 395 bytes\) or every Save command \(frees 552 bytes\)/);
});

// Neither allowance alone covers a big enough deficit, but the two together
// do: kernelShortfallAdvice must consider the combination rather than
// falling straight through to a mapper suggestion or the generic message.
test('a kernel-lo shortfall neither Save nor Move alone would close, but both together would, names the combination', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 4; // MMC3
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push(saveAndMoveEvent());
  inflate(project, 88);
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command and every Save command together \(frees 947 bytes\)/);
});

// Turn and Wait were added to kernelShortfallAdvice's own active-feature list
// alongside Move and Save, but every advice test above only ever exercises
// Move and Save -- dropping either new active.push (op: 'turn' or op:
// 'wait') would leave every one of them green. This is the solo half of
// closing that gap: a project with a live Wait and nothing else active
// (no Move, no Turn, no Save), sized so dropping Wait alone -- and nothing
// else, since Wait never touches move_face -- covers the deficit. If the
// 'wait' push were missing, kernelShortfallAdvice would never consider
// dropping Wait at all and this project would instead get a mapper
// suggestion or the generic "reduce content" message. n=190 measured
// directly against a real checkCapacity() run, not assumed: it lands a
// 37-byte deficit, comfortably under WAIT_KERNEL_ALLOWANCE (48) alone.
test('a kernel-lo shortfall a live Wait command alone would close names Wait', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split-lock to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'wait', frames: 30 }] }] } }
  });
  inflate(project, 190);
  const deficit = kernelShortfallDeficit(project);
  assert.ok(deficit <= WAIT_KERNEL_ALLOWANCE, `deficit ${deficit} must not exceed WAIT_KERNEL_ALLOWANCE (${WAIT_KERNEL_ALLOWANCE}) or this case does not exercise Wait alone closing the gap`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Wait command \\(frees ${WAIT_KERNEL_ALLOWANCE} bytes\\)`));
  assert.doesNotMatch(message, /Turn command/, 'this project never turns Turn on, so it must not be offered as a fix');
  assert.doesNotMatch(message, /Move command/, 'this project never turns Move on, so it must not be offered as a fix');
});

// The dependent-combination half: a project with both a live Turn and a live
// Wait, and no Move, so Turn is the project's only reason move_face
// assembles at all -- dropping Turn alone already frees TURN_KERNEL_ALLOWANCE
// + FACE_KERNEL_ALLOWANCE together (51), the identical "dropping one command
// silently also drops a dependent term" shape the Move+split-lock case above
// already proves, applied to Turn+Face instead of Move+split-lock. Sized so
// neither Turn alone (51) nor Wait alone (48) covers the deficit, but
// dropping both together does, because with neither command left, Face has
// no more reason to assemble either: TURN_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE
// + FACE_KERNEL_ALLOWANCE = 35 + 48 + 16 = 99. This is the test that fails if
// *either* new active.push line is missing: with only one of Turn/Wait in
// `active`, the combo loop below (which requires at least two chosen
// features) never runs, and the message falls straight through to a mapper
// suggestion or the generic one instead of naming either command. n=186
// measured directly, landing a 56-byte deficit -- strictly above both solo
// figures (51, 48) and at or below the combined one (99).
test('a kernel-lo shortfall neither Turn nor Wait alone would close, but both together would, names the combination', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split-lock to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: {
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'turn', who: 'self', dir: 'left' },
              { op: 'wait', frames: 30 }
            ]
          }
        ]
      }
    }
  });
  inflate(project, 186);
  const deficit = kernelShortfallDeficit(project);
  const turnAlone = TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE;
  const combined = TURN_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE;
  assert.ok(
    deficit > turnAlone && deficit > WAIT_KERNEL_ALLOWANCE,
    `deficit ${deficit} must exceed both Turn alone (${turnAlone}) and Wait alone (${WAIT_KERNEL_ALLOWANCE}), or this case does not exercise the combination at all`
  );
  assert.ok(deficit <= combined, `deficit ${deficit} must not exceed the combined figure (${combined}), or dropping both would not close the gap either`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Turn command and every Wait command together \\(frees ${combined} bytes\\)`));
});
