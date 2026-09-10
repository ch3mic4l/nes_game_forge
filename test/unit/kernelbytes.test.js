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
  BATTLE_KERNEL_ALLOWANCE_BY_MAPPER,
  TITLE_KERNEL_ALLOWANCE_BY_MAPPER,
  KERNEL_SLACK,
  SAVE_KERNEL_ALLOWANCE_BY_MAPPER,
  SAVE_BATTLE_KERNEL_ALLOWANCE,
  MOVE_KERNEL_ALLOWANCE,
  FACE_KERNEL_ALLOWANCE,
  TURN_KERNEL_ALLOWANCE,
  WAIT_KERNEL_ALLOWANCE,
  SHAKE_KERNEL_ALLOWANCE,
  VISIBLE_KERNEL_ALLOWANCE,
  FADE_KERNEL_ALLOWANCE,
  FLASH_KERNEL_ALLOWANCE,
  PALETTE_FX_KERNEL_ALLOWANCE,
  SPLIT_KERNEL_ALLOWANCE,
  ITEM_KERNEL_ALLOWANCE,
  ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE,
  itemEffectKernelAllowance,
  STING_KERNEL_ALLOWANCE_STANDALONE,
  AUDIO_FX_KERNEL_ALLOWANCE,
  STING_SFX_INTERACTION_ALLOWANCE,
  SFX_KERNEL_ALLOWANCE_STANDALONE,
  BOUND_TILE_KERNEL_ALLOWANCE,
  BOUND_TILE_RECORD,
  screenCapacityFor,
  flattenScreens,
  kernelTableBytes,
  NAME_ENTRY_KERNEL_ALLOWANCE,
  JOIN_NAMING_KERNEL_ALLOWANCE,
  HERO_NAMING_KERNEL_ALLOWANCE,
  HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE,
  NAME_ENTRY_ACTION_KERNEL_ALLOWANCE,
  HERO_DEFAULT_KERNEL_ALLOWANCE,
  NAME_TOKEN_KERNEL_ALLOWANCE
} from '../../main/build/generate.js';
import { SUPPORTED_MAPPERS, rpgCapable, saveMediaImplemented, prgLayout, resolveMapper } from '../../shared/cartridge.js';
import {
  createTileset,
  createProject,
  createPartyMember,
  projectUsesItems,
  projectUsesBoundTiles,
  projectUsesTurn,
  projectUsesHeroNaming,
  projectUsesJoinNaming,
  projectWithoutHeroNaming,
  projectWithoutJoinNaming,
  projectUsesNameToken,
  projectWithoutNameToken,
  metaspriteKernelBytes,
  RPG_LIMITS,
  BUTTONS
} from '../../shared/project.js';
import { fontBankSplit, projectUsesText } from '../../shared/font.js';
import { createSong } from '../../shared/audio.js';

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
 * Builds `fixture` (sample-rpg by default) on `mapper` with every
 * conditionally-assembled block heal/damage's own measurement already
 * covered (dialogue, action combat, the RPG battle system, branches,
 * questions, common-event calls, Play music, Start a battle, Heal/Damage),
 * plus a live Save and/or Move command per `withSave`/`withMove`, and a
 * title screen per `withTitle` -- the whole point is nothing conditional is
 * left out of whichever configuration is being measured. The baseline is
 * title-*off*: `withTitle` defaults to false, because a title screen is no
 * longer baked unconditionally into BASE_KERNEL_CODE_BYTES_BY_MAPPER (see
 * the long comment in generate.js) and sample-rpg as checked in has none.
 * `withSave` forces a title on regardless of `withTitle`, because
 * validateProject refuses a live Save command with no title screen
 * ("Continue has nowhere to appear without one") -- there is no way to
 * measure Save without one. `fixture` defaults to SAMPLE_RPG rather than
 * being required, so every existing call site keeps measuring the identical
 * project it always has -- only the SAVE_KERNEL_ALLOWANCE_BY_MAPPER prose
 * census's own action-side measurement below passes SAMPLE explicitly, to
 * isolate the RPG-only supplement's own cost (SAVE_BATTLE_KERNEL_ALLOWANCE,
 * main/build/generate.js) rather than duplicate this whole helper for one
 * different `loadProject` argument. Returns the real kernel code size:
 * nesasm's own usage for the kernel-lo bank, minus everything before
 * `reset` in it (the lookup tables — kernel_lo.inc, palettes, metatiles,
 * sprites, input, maps, chrtables — `reset` being the first label of
 * boot.asm, the first file of engine code included after them), measured
 * off the real assembly rather than recomputed by hand here.
 */
async function measureCodeBytes(
  t,
  mapper,
  {
    fixture = SAMPLE_RPG,
    withSave = false,
    withMove = false,
    withTurn = false,
    // A route whose only leg is Turn -- kept separate from withTurn, never
    // combined with it in the same call, so this measures a route-wrapped
    // Turn in total isolation the same way withTurn alone measures a bare
    // one. See design-routes.md §13 test 6: this must cost identically.
    withRouteTurn = false,
    withWait = false,
    withShake = false,
    withVisible = false,
    withFade = false,
    withFlash = false,
    withSting = false,
    withSfx = false,
    withTitle = false,
    withItems = true,
    withBoundTiles = false,
    // In-game party-member naming (docs/design-name-entry.md §11, X3).
    // withHeroNaming sets party[0].renamable; withJoinNaming sets party[1].renamable
    // when the fixture has a second member (sample-rpg does; SAMPLE, the action
    // fixture, does not carry a second party slot to name, so withJoinNaming is a
    // no-op there -- matching D6/D8's own "Join naming is RPG-only" rule).
    withHeroNaming = false,
    withJoinNaming = false,
    // The Say token (docs/design-name-entry.md §9a, §11): a live Say command
    // carrying the literal {name}. Added as its own command, the same shape
    // withSave/withMove/etc. already use here -- unlike the banked-region
    // isolation matrix (bankedbytes.test.js rows 19-21), a brand-new entity
    // and event add no kernel-lo bytes of their own (screen/event data lives
    // in the switchable window and the $E000 text bank, neither of which
    // measureCodeBytes' post-reset delta can see), so this is safe to add
    // rather than mutate.
    withNameToken = false
  } = {}
) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelbytes-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  let project = await loadProject(fixture);
  // Phase 5 (docs/design-name-entry.md v16.4 §17 item 5) turned naming and
  // the token on for real fixture content, so "off" can no longer mean
  // "whatever this fixture happens to carry" -- it has to mean explicitly
  // off, in both directions, regardless of which fixture is loaded. Strip
  // the token from the fixture's own content first (SAMPLE's slime dialogue
  // carries one now); the two renamable flags are set explicitly, both ways,
  // below.
  if (!withNameToken) project = projectWithoutNameToken(project);
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
  if (withRouteTurn) commands.push({ op: 'route', who: 'self', legs: [{ op: 'turn', dir: 'up' }] });
  if (withWait) commands.push({ op: 'wait', frames: 30 });
  if (withShake) commands.push({ op: 'shake', frames: 30 });
  if (withVisible) commands.push({ op: 'visible', state: 'hidden' });
  if (withFade) commands.push({ op: 'fade', dir: 'out' });
  if (withFlash) commands.push({ op: 'flash' });
  if (withSting) {
    // sample-rpg carries no songs by default -- add one only if none exists,
    // so a caller that also wants withItems-style isolation against a
    // project that already has songs is not surprised by an extra one.
    if (!project.songs?.length) project.songs = [createSong('Sting Song')];
    commands.push({ op: 'sting', song: 0 });
  }
  if (withSfx) {
    // Mirrors withSting's own shape: seed one short effect only if the
    // project does not already carry one, so a caller combining withSfx with
    // some other isolation (withItems: false, say) is not surprised by an
    // extra effect appearing in project.sfx.
    if (!project.sfx?.length) project.sfx = [{ name: 'Boop', volume: 10, steps: [{ note: 5, duration: 4 }] }];
    commands.push({ op: 'sfx', sfx: 0 });
  }
  if (withNameToken) commands.push({ op: 'say', text: 'Hello {name}.' });
  if (commands.length) {
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    });
  }
  // Screen data, not a command -- reuses whatever is already painted at (0,0)
  // as its own substitute, which trivially shares the painted cell's palette
  // (validateProject's own range->duplicate->palette rule), so this needs no
  // second metatile slot of its own.
  if (withBoundTiles) {
    const screen = project.maps[0].screens[0];
    const paintedId = screen.metatiles[0];
    screen.boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: paintedId }];
  }
  // Explicit both ways (phase 5 finding): SAMPLE and SAMPLE_RPG now carry
  // renamable: true for real, so a bare `if (withHeroNaming) ... = true`
  // would leave "off" silently meaning "on" whenever fixture already opts
  // in -- every isolation delta above would then measure 0 instead of the
  // named allowance.
  project.party[0].renamable = Boolean(withHeroNaming);
  if (project.party[1]) project.party[1].renamable = Boolean(withJoinNaming);
  await saveProject(dir, project);
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });

  const { kernelLoBank } = prgLayout(mapper);
  // nesasm's own "segment usage" table, one row per bank: "BANK  62   7182/1010"
  // — right-aligned, so the free half can carry a leading space the used
  // half never does ("7235/ 957").
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
  const bankMatch = bankLine.match(/(\d+)\/\s*(\d+)\s*$/);
  const used = Number(bankMatch?.[1]);
  const bankFree = Number(bankMatch?.[2]); // nesasm's own real free-byte count for the WHOLE kernel-lo bank
  assert.ok(Number.isFinite(used) && used > 0, `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`);

  assert.ok(built.symbolPath, `${mapper.name}: nesasm should have written a symbol file`);
  const symbols = await fsp.readFile(built.symbolPath, 'utf8');
  const resetMatch = symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m);
  assert.ok(resetMatch, `${mapper.name}: reset should be a named symbol in game.fns`);
  const resetAddr = parseInt(resetMatch[1], 16);

  return { project, codeBytes: used - (resetAddr - 0xc000), symbols, bankFree };
}

/** The address a label was assembled at, straight out of nesasm's own game.fns. */
function symbolAddr(symbols, label) {
  const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
  assert.ok(m, `label ${label} not found in game.fns`);
  return parseInt(m[1], 16);
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

test('every rpgCapable() board has a finite BATTLE_KERNEL_ALLOWANCE_BY_MAPPER entry', () => {
  for (const mapper of SUPPORTED_MAPPERS) {
    if (!rpgCapable(mapper)) continue;
    assert.ok(
      Number.isFinite(BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]),
      `${mapper.name}: rpgCapable() is true but BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[${mapper.id}] is ` +
        `${BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]} -- battleKernelAllowance would throw, and a caller ` +
        'that does not pre-check (kernelCodeBytes included) would surface that as an uncaught exception, for ' +
        'an RPG project on this board. Add a measured entry before shipping this combination.'
    );
  }
});

test(
  'checkCapacity reports a named problem, not a silent NaN pass, for an RPG project on a non-rpgCapable mapper',
  () => {
    // UxROM (mapper 2) has switchable PRG with no switchable CHR:
    // battleEnabledFor comes back true for an RPG project on it even though
    // rpgCapable(mapper) is false (codeRegions only requires PRG switching;
    // rpgCapable requires PRG and CHR), so this reaches
    // BATTLE_KERNEL_ALLOWANCE_BY_MAPPER with a mapper id it has no entry for
    // -- the exact case a round-1 review found silently produced NaN,
    // making checkCapacity's own `kernelFree < 0` check false and the
    // capacity refusal disappear. resolveMapper reads project.cartridge.mapper
    // with no reconciling step, so this is reachable through checkCapacity
    // itself, not just kernelCodeBytes called directly.
    const project = createProject('Repro', 'rpg');
    project.cartridge.mapper = 2;
    const { problems } = checkCapacity(project);
    const battleAllowanceProblem = problems.find((p) =>
      p.message.includes('no measured kernel-lo battle allowance')
    );
    assert.ok(
      battleAllowanceProblem,
      'checkCapacity should report a named problem for a mapper with no measured battle allowance, not ' +
        'silently skip the kernel-lo check'
    );
    assert.equal(battleAllowanceProblem.severity, 'error');
  }
);

test(
  'kernelCodeBytes covers the real engine, on every RPG-capable board, in every conditional combination',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    assert.ok(CAPABLE_MAPPERS.length > 0, 'no RPG-capable mapper is registered — rpgCapable() found nothing');
    // saveMediaImplemented, not batteryCapable: UNROM 512 saves too, by
    // flashing its own PRG-ROM rather than battery RAM, and its own two Save
    // terms need the same exact-delta measurements every battery board
    // already gets below, or a stale flash figure could drift for as long as
    // assertCovers's own ceiling (which only ever judges the *worst* board)
    // happened not to notice. Two separate measurements, not one, since the
    // Save allowance split (main/build/generate.js): the RPG-project loop
    // below pins SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper] +
    // SAVE_BATTLE_KERNEL_ALLOWANCE (the RPG *total*), and the action-project
    // loop after it pins SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper] alone (the
    // *base* term) -- each establishes a different half of the split, and
    // neither on its own would catch the other drifting.
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
    // noSaveNoItems is captured, not discarded, for reuse below: it is
    // sample-rpg's own real usage with title off *and* items stripped -- the
    // cleanest available RPG baseline for isolating
    // BATTLE_KERNEL_ALLOWANCE_BY_MAPPER (only SPLIT_KERNEL_ALLOWANCE, on
    // MMC3 alone, stands between this and base+battleSupplement, rather than
    // both that and an item allowance to subtract by hand).
    const noSaveNoItems = [];
    for (const mapper of CAPABLE_MAPPERS) {
      const { codeBytes } = await measureCodeBytes(t, mapper, { withItems: false });
      noSaveNoItems.push({ mapper, codeBytes });
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

    // `docs/kernel-base-overcharge-report.md`: the action-side twin of the
    // `noSave` loop above, title off, nothing conditional -- `sample`, not
    // `sample-rpg`. This is the measurement that never existed before that
    // report: every prior absolute assertCovers check in this file ran only
    // against `sample-rpg`, and BASE_KERNEL_CODE_BYTES_BY_MAPPER was measured
    // exclusively against it too, so an action project's own real "nothing
    // conditional" cost had never once been compared against what
    // kernelCodeBytes actually reserves for it, on any board. `sample`
    // cannot have its own default item stripped the way `noSaveNoItems`
    // strips sample-rpg's (its Give/Take command names that item, so an
    // empty items[] fails validateProject) -- both the equality checks below
    // account for that by hand, matching the shape the MMC3 split-term check
    // further down already established for exactly this reason.
    const actionNoSave = [];
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { fixture: SAMPLE });
      actionNoSave.push({ mapper, project, codeBytes });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'an action project, no Save, no Move, no title');
    }

    // BASE_KERNEL_CODE_BYTES_BY_MAPPER and BATTLE_KERNEL_ALLOWANCE_BY_MAPPER,
    // equality-asserted per board -- the direct measurement both terms are
    // supposed to equal, not merely covered by assertCovers' own
    // worst-board-only margin. `sample`'s own default item and (on MMC3)
    // its own real dialogue are subtracted out by hand from the raw action
    // figure, since they cannot be stripped by rebuilding without them (see
    // the comment above); `noSaveNoItems`, sample-rpg's own items-already-
    // stripped measurement, only ever needs the split term subtracted
    // on top, since RPG items were already removed by rebuilding without
    // them. `fontBankSplit`, not a hardcoded MMC3 check, so this generalizes
    // correctly if a second scanline-IRQ board is ever added.
    for (const mapper of CAPABLE_MAPPERS) {
      const actionEntry = actionNoSave.find((entry) => entry.mapper.id === mapper.id);
      const splitCost = fontBankSplit(actionEntry.project, mapper) ? SPLIT_KERNEL_ALLOWANCE : 0;
      const actionResidual =
        actionEntry.codeBytes - ITEM_KERNEL_ALLOWANCE - ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.action - splitCost;
      assert.equal(
        actionResidual,
        BASE_KERNEL_CODE_BYTES_BY_MAPPER[mapper.id],
        `${mapper.name}: an action project with nothing conditional turned on, its own default item and (if this ` +
          `board splits the font) its own text removed by hand, measures ${actionResidual} bytes of kernel code, ` +
          `but BASE_KERNEL_CODE_BYTES_BY_MAPPER[${mapper.id}] reserves ` +
          `${BASE_KERNEL_CODE_BYTES_BY_MAPPER[mapper.id]} — the base must equal an action project's own real, ` +
          'unconditional cost exactly, with no RPG-only byte folded in. Re-measure and correct it (see the ' +
          'comment beside BASE_KERNEL_CODE_BYTES_BY_MAPPER in generate.js).'
      );

      const rpgNoItemsEntry = noSaveNoItems.find((entry) => entry.mapper.id === mapper.id);
      const rpgSplitCost = fontBankSplit(noSave.find((entry) => entry.mapper.id === mapper.id).project, mapper)
        ? SPLIT_KERNEL_ALLOWANCE
        : 0;
      const battleResidual = rpgNoItemsEntry.codeBytes - baseKernelCodeBytes(mapper) - rpgSplitCost;
      assert.equal(
        battleResidual,
        BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id],
        `${mapper.name}: sample-rpg with nothing conditional turned on and its own default item stripped, minus ` +
          `the action-side base and (if this board splits the font) the split term, measures ${battleResidual} bytes ` +
          `of RPG-only kernel code, but BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[${mapper.id}] reserves ` +
          `${BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]} — this supplement must equal the RPG-only byte count ` +
          'exactly. Re-measure and correct it (see the comment beside BATTLE_KERNEL_ALLOWANCE_BY_MAPPER in ' +
          'generate.js).'
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

    // Only the save-capable boards, a live Save command and nothing else, on
    // sample-rpg (an RPG project) -- diffed against the title-*on* baseline
    // just above, not the title-off one, because validateProject requires a
    // title screen alongside any live Save command: both sides of this
    // subtraction carry the same title cost, so it cancels out and this
    // delta is save/load's own cost alone, exactly as it was before the
    // title term existed to conflate it with. This is the RPG *total*:
    // save_check_valid (engine/save.asm) assembles an extra `.if
    // BATTLE_ENABLED` range-check block for an RPG that an action project's
    // build does not, so the real delta here is
    // SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper] + SAVE_BATTLE_KERNEL_ALLOWANCE,
    // not the base term alone (see the action-only loop below for the other
    // half of that split, and the long comment beside
    // SAVE_KERNEL_ALLOWANCE_BY_MAPPER in generate.js for why the split exists
    // at all).
    const withSave = [];
    for (const mapper of saveMappers) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withSave: true });
      withSave.push({ mapper, project, codeBytes });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Save command');
      const noSaveTitleEntry = noSaveTitle.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveTitleEntry.codeBytes;
      const expected = SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id] + SAVE_BATTLE_KERNEL_ALLOWANCE;
      // Equality, not <=: the two allowances together are supposed to equal
      // this board's own exact measured RPG-total delta, not merely cover it
      // -- a <= check alone lets a stale, over-large figure (say, MMC1 left
      // at the old shared 552 instead of its own true 547) pass silently
      // with a wider margin than KERNEL_SLACK was ever meant to leave, which
      // is exactly the drift assertCovers's own ceiling exists to catch but,
      // per mapper, does not: assertCovers only ever judges the *worst*
      // board's margin, so a non-worst board's allowance can sit wrong
      // indefinitely underneath it.
      assert.equal(
        delta,
        expected,
        `${mapper.name}: save/load costs ${delta} bytes of kernel code on an RPG project ` +
          `(${noSaveTitleEntry.codeBytes} -> ${codeBytes}), but SAVE_KERNEL_ALLOWANCE_BY_MAPPER[${mapper.id}] + ` +
          `SAVE_BATTLE_KERNEL_ALLOWANCE reserves ${expected} — the RPG total must equal this board's own measured ` +
          'delta exactly. Re-measure and correct it (see the comment beside SAVE_KERNEL_ALLOWANCE_BY_MAPPER in ' +
          'generate.js).'
      );
    }

    // The action-project half of the same split: an action project pays only
    // SAVE_KERNEL_ALLOWANCE_BY_MAPPER's own base figure, never the RPG
    // supplement above, because save_check_valid's `.if BATTLE_ENABLED`
    // range-check block does not assemble outside an RPG at all. This is the
    // measurement that was missing entirely before this change -- the RPG
    // loop above was the only one ever run against SAVE_KERNEL_ALLOWANCE_BY_MAPPER,
    // so an action project's real, smaller Save cost had never actually been
    // checked against what kernelCodeBytes charges it. Same methodology as
    // the RPG loop (title-on baseline subtracted on both sides), against
    // `sample`, the action fixture, instead of `sample-rpg`.
    const actionNoSaveTitle = [];
    for (const mapper of saveMappers) {
      const { codeBytes } = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withTitle: true });
      actionNoSaveTitle.push({ mapper, codeBytes });
    }
    // assertCovers is back, per `docs/kernel-base-overcharge-report.md`: it
    // was deliberately withheld here by the Save-allowance split, because
    // building this exact project (action, on an RPG-capable board) and
    // comparing the *absolute* kernelCodeBytes(project, mapper) against real
    // usage surfaced a real, pre-existing, unrelated overcharge in
    // baseKernelCodeBytes itself (270-282 bytes, entirely independent of
    // Save) that calling it would have conflated with the Save split's own
    // correctness. That defect is what this change fixes -- base is now
    // measured against `sample`, not `sample-rpg` (see its own comment in
    // generate.js) -- so the withholding no longer applies, and leaving it
    // out would now hide a real regression in either term instead of
    // avoiding a false one.
    const actionWithSave = [];
    for (const mapper of saveMappers) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withSave: true });
      actionWithSave.push({ mapper, codeBytes });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Save command on an action project');
      const baselineEntry = actionNoSaveTitle.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - baselineEntry.codeBytes;
      assert.equal(
        delta,
        SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id],
        `${mapper.name}: save/load costs ${delta} bytes of kernel code on an action project ` +
          `(${baselineEntry.codeBytes} -> ${codeBytes}), but SAVE_KERNEL_ALLOWANCE_BY_MAPPER[${mapper.id}] reserves ` +
          `${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]} — the base term alone must equal an action project's own ` +
          'measured delta exactly, with no RPG supplement folded in. Re-measure and correct it (see the comment ' +
          'beside SAVE_KERNEL_ALLOWANCE_BY_MAPPER in generate.js).'
      );
    }

    // SAVE_BATTLE_KERNEL_ALLOWANCE's own flatness claim, proven rather than
    // assumed: its comment in generate.js argues the RPG-only supplement is
    // identical on every board because the `.if BATTLE_ENABLED` block it
    // charges for has no mapper-specific instruction in it -- this is the
    // assertion that would catch it if that ever stopped being true. Derived
    // from the two loops just above (RPG total minus action base, per board)
    // rather than hardcoded, so a change to either underlying measurement
    // re-proves flatness against the same real numbers rather than a second,
    // independently-drifting copy of them.
    const supplements = saveMappers.map((mapper) => {
      const rpgEntry = withSave.find((entry) => entry.mapper.id === mapper.id);
      const actionEntry = actionWithSave.find((entry) => entry.mapper.id === mapper.id);
      const actionBaselineEntry = actionNoSaveTitle.find((entry) => entry.mapper.id === mapper.id);
      const rpgBaselineEntry = noSaveTitle.find((entry) => entry.mapper.id === mapper.id);
      return {
        mapper,
        supplement:
          rpgEntry.codeBytes - rpgBaselineEntry.codeBytes - (actionEntry.codeBytes - actionBaselineEntry.codeBytes)
      };
    });
    for (const entry of supplements) {
      assert.equal(
        entry.supplement,
        SAVE_BATTLE_KERNEL_ALLOWANCE,
        `${entry.mapper.name}: the RPG-only Save supplement measures ${entry.supplement} bytes, but ` +
          `SAVE_BATTLE_KERNEL_ALLOWANCE reserves ${SAVE_BATTLE_KERNEL_ALLOWANCE} — this term claims to be flat ` +
          'across every board; re-measure all three and confirm before assuming a single board drifted.'
      );
    }
    assert.ok(
      supplements.every((entry) => entry.supplement === supplements[0].supplement),
      `SAVE_BATTLE_KERNEL_ALLOWANCE is supposed to be flat across boards, but measured ` +
        `${supplements.map((entry) => `${entry.mapper.name}=${entry.supplement}`).join(', ')} — if these genuinely ` +
        'disagree, the term needs to become SAVE_BATTLE_KERNEL_ALLOWANCE_BY_MAPPER instead (see its own comment ' +
        'in generate.js for why it is flat today and what would change that).'
    );

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

    // Every RPG-capable board, a live Shake command and nothing else. Shake
    // shares no dependent term with Move/Turn/Face the way Wait does not
    // either -- nothing else calls into Shake's own code -- so this delta
    // should be SHAKE_KERNEL_ALLOWANCE and nothing else, the identical shape
    // the Wait-only block above already asserts.
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withShake: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Shake command');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        SHAKE_KERNEL_ALLOWANCE,
        `${mapper.name}: Shake-only costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but SHAKE_KERNEL_ALLOWANCE reserves ${SHAKE_KERNEL_ALLOWANCE} — this allowance must equal Shake's real ` +
          'cost exactly, on every board.'
      );
    }

    // Every RPG-capable board, live Shake and Wait together. Review finding:
    // the two isolated deltas just measured (Shake-only, Wait-only) cannot by
    // themselves rule out an implementation that shares conditional code
    // between the two commands -- both would still measure correctly in
    // isolation while the real combined build cost less than their sum. Shake
    // touches no code Wait also touches (no dependent term the way Turn+Move
    // share FACE_KERNEL_ALLOWANCE), so this delta should be exactly
    // SHAKE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE, the identical
    // "purely additive" shape the Turn+Wait combination below already proves.
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withShake: true, withWait: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'live Shake and Wait commands together');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        SHAKE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE,
        `${mapper.name}: Shake+Wait costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but SHAKE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE reserves ${SHAKE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE} ` +
          '— the two must be purely additive, since Shake shares no code with Wait.'
      );
    }

    // Every RPG-capable board, a live Show/Hide command and nothing else.
    // Show/Hide shares no dependent term with Move/Turn/Wait/Shake/Face --
    // no other command calls script_op_visible or reads ENT_HIDDEN -- so
    // this delta should be VISIBLE_KERNEL_ALLOWANCE and nothing else, the
    // identical shape the Shake-only block above already asserts.
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withVisible: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Show/Hide command');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        VISIBLE_KERNEL_ALLOWANCE,
        `${mapper.name}: Show/Hide-only costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but VISIBLE_KERNEL_ALLOWANCE reserves ${VISIBLE_KERNEL_ALLOWANCE} — this allowance must equal Show/Hide's ` +
          'real cost exactly, on every board.'
      );
    }

    // Every RPG-capable board, live Shake and Show/Hide together. The same
    // "cannot rule out shared conditional code from two isolated deltas
    // alone" review finding the Shake+Wait block above already answers,
    // applied to this pair: Show/Hide touches no code Shake also touches, so
    // this delta should be exactly SHAKE_KERNEL_ALLOWANCE +
    // VISIBLE_KERNEL_ALLOWANCE, purely additive.
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withShake: true, withVisible: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'live Shake and Show/Hide commands together');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        SHAKE_KERNEL_ALLOWANCE + VISIBLE_KERNEL_ALLOWANCE,
        `${mapper.name}: Shake+Show/Hide costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but SHAKE_KERNEL_ALLOWANCE + VISIBLE_KERNEL_ALLOWANCE reserves ${SHAKE_KERNEL_ALLOWANCE + VISIBLE_KERNEL_ALLOWANCE} ` +
          '— the two must be purely additive, since Show/Hide shares no code with Shake.'
      );
    }

    // Every RPG-capable board, a live Fade command and nothing else.
    // fade_apply_palette and the NMI PPUADDR fix are now gated on the
    // derived PALETTE_FX_ENABLED (handoff-flash/design-flash.md §4), shared
    // with Flash, so a Fade-only build's real delta is
    // FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE, not
    // FADE_KERNEL_ALLOWANCE alone -- the ROM is unchanged from before Flash
    // existed (the re-gate moved which named constant a byte is counted
    // under, never which bytes assemble), but the expression this test
    // checks against has to move with it.
    // Captures D_fade/D_flash/D_both per mapper as they are measured below,
    // for the explicit three-equation solve + non-tautology check
    // (design-flash.md §4/§9 test 12) after the loops finish -- reusing
    // these real deltas rather than rebuilding the same four ROMs again.
    const paletteFxSolveData = [];
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withFade: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'a live Fade command');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        delta,
        FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE,
        `${mapper.name}: Fade-only costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE reserves ` +
          `${FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE} — this allowance must equal Fade's real ` +
          'cost exactly, on every board.'
      );
      paletteFxSolveData.push({ mapper, dFade: delta });
    }

    // Every RPG-capable board, live Shake and Fade together -- a real build,
    // not a sum of constants (design-fade.md's own §14 test 13). Shake
    // touches no code Fade also touches, so this delta should be exactly
    // SHAKE_KERNEL_ALLOWANCE + FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE
    // (the shared term Fade alone still pays, per the Fade-only assertion
    // just above), the identical "purely additive" shape the Shake+Wait and
    // Shake+Show/Hide combinations above already prove.
    for (const mapper of CAPABLE_MAPPERS) {
      const { project, codeBytes } = await measureCodeBytes(t, mapper, { withShake: true, withFade: true });
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'live Shake and Fade commands together');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const delta = codeBytes - noSaveEntry.codeBytes;
      const combined = SHAKE_KERNEL_ALLOWANCE + FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE;
      assert.equal(
        delta,
        combined,
        `${mapper.name}: Shake+Fade costs ${delta} bytes of kernel code (${noSaveEntry.codeBytes} -> ${codeBytes}), ` +
          `but SHAKE_KERNEL_ALLOWANCE + FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE reserves ${combined} ` +
          '— the two must be purely additive, since Shake shares no code with Fade or with Flash\'s own shared term.'
      );
    }

    // Every RPG-capable board, a live Flash command and nothing else, then
    // Flash and Fade together -- the three-equation measurement
    // handoff-flash/design-flash.md §4 specifies. D_fade (above, ==
    // FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE), D_flash and
    // D_both are three real, independent deltas; PALETTE_FX_KERNEL_ALLOWANCE
    // = D_fade + D_flash - D_both, FADE_KERNEL_ALLOWANCE = D_fade -
    // PALETTE_FX_KERNEL_ALLOWANCE, FLASH_KERNEL_ALLOWANCE = D_flash -
    // PALETTE_FX_KERNEL_ALLOWANCE. This block asserts D_flash and D_both
    // directly against the shipped constants' own combinations, and a
    // separate test below (the non-tautology requirement, design-flash.md
    // §9 test 12) re-solves the system from these same three deltas and
    // asserts the *exported* constants equal the solved values, not merely
    // that some self-consistent triple exists.
    for (const mapper of CAPABLE_MAPPERS) {
      const flashOnly = await measureCodeBytes(t, mapper, { withFlash: true });
      assertCovers({ mapper, codeBytes: flashOnly.codeBytes }, kernelCodeBytes(flashOnly.project, mapper), 'a live Flash command');
      const noSaveEntry = noSave.find((entry) => entry.mapper.id === mapper.id);
      const flashDelta = flashOnly.codeBytes - noSaveEntry.codeBytes;
      assert.equal(
        flashDelta,
        FLASH_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE,
        `${mapper.name}: Flash-only costs ${flashDelta} bytes of kernel code (${noSaveEntry.codeBytes} -> ` +
          `${flashOnly.codeBytes}), but FLASH_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE reserves ` +
          `${FLASH_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE} — this allowance must equal Flash's real ` +
          'cost exactly, on every board.'
      );

      const both = await measureCodeBytes(t, mapper, { withFade: true, withFlash: true });
      assertCovers({ mapper, codeBytes: both.codeBytes }, kernelCodeBytes(both.project, mapper), 'live Flash and Fade commands together');
      const bothDelta = both.codeBytes - noSaveEntry.codeBytes;
      const combined = FADE_KERNEL_ALLOWANCE + FLASH_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE;
      assert.equal(
        bothDelta,
        combined,
        `${mapper.name}: Flash+Fade costs ${bothDelta} bytes of kernel code (${noSaveEntry.codeBytes} -> ` +
          `${both.codeBytes}), but FADE_KERNEL_ALLOWANCE + FLASH_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE ` +
          `reserves ${combined} — this is NOT the sum of two independently-measured "alone" figures ` +
          '(that would double-count the shared PALETTE_FX_KERNEL_ALLOWANCE term); the shared routine assembles ' +
          'exactly once regardless of how many of Fade/Flash are live.'
      );

      const entry = paletteFxSolveData.find((e) => e.mapper.id === mapper.id);
      entry.dFlash = flashDelta;
      entry.dBoth = bothDelta;
    }

    // The explicit three-equation solve, and the non-tautology requirement
    // (design-flash.md §4/§9 test 12): compute PALETTE_FX_KERNEL_ALLOWANCE/
    // FADE_KERNEL_ALLOWANCE/FLASH_KERNEL_ALLOWANCE purely from the three real
    // measured deltas above -- no reference to the exported constants at
    // all in this arithmetic -- then assert the *exported* constants equal
    // what was just solved for, on every board, and that the solved values
    // are themselves identical across boards (the "flat, not per-mapper"
    // claim, checked rather than assumed). Re-substituting solved values
    // back into the same three equations they came from would be
    // tautological; comparing against the real exports is what catches a
    // shipped constant that has drifted from the solve.
    let solvedPaletteFx = null;
    let solvedFadeOwn = null;
    let solvedFlashOwn = null;
    for (const { mapper, dFade, dFlash, dBoth } of paletteFxSolveData) {
      const paletteFx = dFade + dFlash - dBoth;
      const fadeOwn = dFade - paletteFx;
      const flashOwn = dFlash - paletteFx;
      assert.equal(
        paletteFx + fadeOwn,
        dFade,
        `${mapper.name}: the solved PALETTE_FX_KERNEL_ALLOWANCE (${paletteFx}) + FADE_KERNEL_ALLOWANCE (${fadeOwn}) ` +
          `must reproduce the real measured Fade-only delta (${dFade})`
      );
      assert.equal(
        paletteFx + flashOwn,
        dFlash,
        `${mapper.name}: the solved PALETTE_FX_KERNEL_ALLOWANCE (${paletteFx}) + FLASH_KERNEL_ALLOWANCE (${flashOwn}) ` +
          `must reproduce the real measured Flash-only delta (${dFlash})`
      );
      assert.equal(
        paletteFx,
        PALETTE_FX_KERNEL_ALLOWANCE,
        `${mapper.name}: the exported PALETTE_FX_KERNEL_ALLOWANCE (${PALETTE_FX_KERNEL_ALLOWANCE}) must equal the ` +
          `value solved from real measurements (${paletteFx}), not merely satisfy the equations it came from`
      );
      assert.equal(
        fadeOwn,
        FADE_KERNEL_ALLOWANCE,
        `${mapper.name}: the exported FADE_KERNEL_ALLOWANCE (${FADE_KERNEL_ALLOWANCE}) must equal the value solved ` +
          `from real measurements (${fadeOwn})`
      );
      assert.equal(
        flashOwn,
        FLASH_KERNEL_ALLOWANCE,
        `${mapper.name}: the exported FLASH_KERNEL_ALLOWANCE (${FLASH_KERNEL_ALLOWANCE}) must equal the value ` +
          `solved from real measurements (${flashOwn})`
      );
      if (solvedPaletteFx === null) {
        solvedPaletteFx = paletteFx;
        solvedFadeOwn = fadeOwn;
        solvedFlashOwn = flashOwn;
      } else {
        assert.equal(paletteFx, solvedPaletteFx, `${mapper.name}: PALETTE_FX_KERNEL_ALLOWANCE must solve to the identical figure on every board (flat, not per-mapper)`);
        assert.equal(fadeOwn, solvedFadeOwn, `${mapper.name}: FADE_KERNEL_ALLOWANCE must solve to the identical figure on every board (flat, not per-mapper)`);
        assert.equal(flashOwn, solvedFlashOwn, `${mapper.name}: FLASH_KERNEL_ALLOWANCE must solve to the identical figure on every board (flat, not per-mapper)`);
      }
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
    // every MMC3 measurement above already carries SPLIT_KERNEL_ALLOWANCE
    // baked into its own real usage. NOT an independent proof that the term
    // is right, despite reading like one -- docs/split-lock-not-pinned-
    // report.md §3 traced this exact equation algebraically and found it is
    // a consequence of the action residual (above, which pins base given
    // SPLIT_KERNEL_ALLOWANCE's own stored value) and the battle residual
    // (which pins BATTLE_KERNEL_ALLOWANCE_BY_MAPPER given base and
    // SPLIT_KERNEL_ALLOWANCE, both already trusted from the first): once
    // those two hold, this reduces to SPLIT_KERNEL_ALLOWANCE ==
    // SPLIT_KERNEL_ALLOWANCE by substitution, true for whatever value the
    // constant happens to hold. Kept as a cross-check -- it still catches a
    // single constant edited alone -- but the real, independent measurement
    // is the text-on/text-off isolation below this function
    // ('SPLIT_KERNEL_ALLOWANCE is pinned by an isolated text-on/text-off
    // delta...'), added by handoff-magic/brief-split-term-1.md once the gap
    // this comment used to overclaim past was found and closed. MMC3's own
    // battle supplement already carries split_select's other BATTLE_ENABLED
    // arm, engine/split.asm, so it and the split term are two different terms
    // sitting on top of the same base, not one absorbed into the other --
    // not folded into the base itself (see the comment beside kernelCodeBytes
    // for why it stays a separate term).
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
        mmc3.codeBytes -
          baseKernelCodeBytes(mmc3.mapper) -
          BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[mmc3.mapper.id] -
          ITEM_KERNEL_ALLOWANCE -
          ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg,
        SPLIT_KERNEL_ALLOWANCE,
        "MMC3's own no-Save measurement should exceed its per-mapper base plus BATTLE_KERNEL_ALLOWANCE_BY_MAPPER " +
          'by exactly SPLIT_KERNEL_ALLOWANCE plus ITEM_KERNEL_ALLOWANCE plus ' +
          'ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg (every RPG shows text, so every MMC3 RPG pays the ' +
          'font-bank split machinery, and sample-rpg always carries a live item)'
      );
    }
  }
);

/**
 * A fresh, minimal action project, its only content the choice of whether an
 * entity carries dialogue -- built and measured exactly the way
 * measureCodeBytes measures `sample`/`sample-rpg`, but starting from
 * createProject() rather than loadProject(fixture), so `projectUsesText` can
 * be forced independently of every other conditional term this file tracks
 * (no Move, no Turn, no Save, no items, no combat, no title -- see
 * docs/split-lock-not-pinned-report.md §6 item 1 for why a naive strip of
 * one of the five checked-in fixtures would not hold that constant). This is
 * the isolation that document's own sketch asked for, built for real by
 * handoff-magic/brief-split-term-1.md.
 */
async function measureSplitProbe(t, mapper, textOn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-splitprobe-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const project = createProject('Probe', 'action');
  project.cartridge.mapper = mapper.id;
  project.project.titleMap = null;
  if (textOn) {
    project.maps[0].screens[0].entities.push({ actorId: 0, x: 96, y: 96, props: { dialogue: 'Hi.' } });
  }
  await saveProject(dir, project);
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });

  const { kernelLoBank } = prgLayout(mapper);
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

test(
  'SPLIT_KERNEL_ALLOWANCE is pinned by an isolated text-on/text-off delta, not a residual -- and is exactly 0 off a scanline-IRQ board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of SUPPORTED_MAPPERS) {
      const off = await measureSplitProbe(t, mapper, false);
      const on = await measureSplitProbe(t, mapper, true);
      assert.equal(
        projectUsesText(off.project),
        false,
        `${mapper.name}: the text-off probe must not use text, or this isolation proves nothing`
      );
      assert.equal(
        projectUsesText(on.project),
        true,
        `${mapper.name}: the text-on probe must use text, or this isolation proves nothing`
      );
      const delta = on.codeBytes - off.codeBytes;
      if (mapper.scanlineIrq) {
        assert.equal(
          delta,
          SPLIT_KERNEL_ALLOWANCE,
          `${mapper.name}: a fresh action project's own text-on/text-off kernel-lo delta is ${delta} bytes ` +
            `(${off.codeBytes} -> ${on.codeBytes}), but SPLIT_KERNEL_ALLOWANCE reserves ${SPLIT_KERNEL_ALLOWANCE} ` +
            '-- this must equal the real cost of the entire font-bank split machinery exactly, measured in ' +
            'isolation rather than assumed from a residual. Re-measure and correct it (see the comment beside ' +
            'kernelCodeBytes).'
        );
      } else {
        // The control: no board without a scanline IRQ may show any kernel-lo
        // delta between text off and text on, because nothing outside
        // split.asm/boot.asm/screens.asm/banks.asm's own `.if SPLIT_ENABLED`
        // blocks reads TEXT_ENABLED -- it is emitted into config.inc but no
        // .asm file consults it (checked: grep TEXT_ENABLED engine/ finds
        // only the generator's own emit). A future .asm file that starts
        // reading TEXT_ENABLED directly, on a board with no scanline IRQ,
        // would fail exactly this assertion.
        assert.equal(
          delta,
          0,
          `${mapper.name}: a board with no scanline IRQ must show zero kernel-lo difference between text off ` +
            `and text on, but this project's own build differs by ${delta} bytes (${off.codeBytes} -> ` +
            `${on.codeBytes}) -- something outside the font-bank split machinery is now reading TEXT_ENABLED ` +
            'or otherwise varying with projectUsesText on a board that should not care.'
        );
      }
    }
  }
);

test(
  'kernelCodeBytes covers a fresh, text-off action project on MMC3 with real margin -- the configuration SPLIT_KERNEL_ALLOWANCE used to overcharge by 146 bytes',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = SUPPORTED_MAPPERS.find((m) => m.id === 4);
    assert.ok(mapper, 'MMC3 (mapper 4) should be registered');
    const off = await measureSplitProbe(t, mapper, false);
    assert.equal(projectUsesText(off.project), false, 'the text-off probe must not use text');
    assert.equal(fontBankSplit(off.project, mapper), false, 'the text-off probe must not trigger the font split');
    assertCovers({ mapper, codeBytes: off.codeBytes }, kernelCodeBytes(off.project, mapper), 'a fresh, text-off action project on MMC3');
  }
);

// design-routes.md §13 test 6: a route contributes no kernel-lo code of its
// own -- every byte a route-wrapped Turn costs has to be exactly what a bare
// Turn already costs (TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE, the
// identical figure the bare-Turn measured-delta block above already pins on
// every RPG-capable board), never a second, route-specific allowance. One
// board is enough here -- the bare-Turn figure is already proven per-board
// above; this test's own job is narrower, proving the wrapping itself adds
// nothing, which does not need re-proving on every board to be trustworthy.
// The sabotage this guards against: an implementation that never extends
// liveCommands/projectUsesTurn to recurse into a route's own legs at all,
// which would measure a delta of 0 here instead of TURN_KERNEL_ALLOWANCE +
// FACE_KERNEL_ALLOWANCE -- a route would then contribute nothing to the
// predicates, silently building a project that never actually enables
// TURN_ENABLED/FACE_ENABLED for a Turn the author placed inside a route.
test('a route whose only leg is Turn measures exactly TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE, identically to a standalone Turn', {
  skip: !hasNesasm && 'nesasm not found on PATH'
}, async (t) => {
  const mapper = CAPABLE_MAPPERS[0];
  const { codeBytes: baseline } = await measureCodeBytes(t, mapper, {});
  const { project, codeBytes: withRouteTurn } = await measureCodeBytes(t, mapper, { withRouteTurn: true });
  assert.equal(
    projectUsesTurn(project),
    true,
    `${mapper.name}: a route whose only leg is Turn must turn projectUsesTurn on`
  );
  const delta = withRouteTurn - baseline;
  assert.equal(
    delta,
    TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE,
    `${mapper.name}: a route-wrapped Turn-only project costs ${delta} bytes of kernel code (${baseline} -> ` +
      `${withRouteTurn}), but TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE reserves ` +
      `${TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} — a route contributes no kernel-lo code of its own, so ` +
      "this must equal the bare Turn's own measured cost exactly, not a route-specific allowance and not zero."
  );
});

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
async function measureFallbackCodeBytes(t, mapper, { titled, withMove = false, withFade = false } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-fallback-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  // Naming and the token off explicitly (phase 5, docs/design-name-entry.md
  // v16.4 §17 item 5): SAMPLE now carries hero naming and the Say token for
  // real, and this helper measures the *base* kernel-lo cost every one of
  // these fallback boards is judged against -- a base that must not include
  // an optional feature's own bytes.
  let project = projectWithoutNameToken(await loadProject(SAMPLE));
  project = projectWithoutHeroNaming(project);
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
  if (withFade) {
    const slime = project.sprites.actors[0];
    project.maps[0].screens[0].entities.push({
      actorId: slime.id,
      x: 32,
      y: 32,
      props: {
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'fade', dir: 'out' }] }] }
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

      // Round-1 review, finding 4 (accepted in reduced form): no verb since
      // Move (Turn/Wait/Shake/Visible) ever added its own fallback build, so
      // Fade did not either -- a mapper-conditional Fade block on any of
      // these five boards could pass every equality loop above (which only
      // exercises the three RPG-capable boards) while still overflowing the
      // real kernel-lo bank here. Same shape as the Move-only build just
      // above, not a new per-verb discipline: one more real build, titled
      // with both a live Move and a live Fade command together, checked
      // against kernelCodeBytes's own combined answer for that project.
      const onWithMoveAndFade = await measureFallbackCodeBytes(t, mapper, { titled: true, withMove: true, withFade: true });
      assert.ok(
        onWithMoveAndFade.codeBytes <= kernelCodeBytes(onWithMoveAndFade.project, mapper),
        `${mapper.name}: real kernel code (${onWithMoveAndFade.codeBytes} bytes, title on, with live Move and Fade ` +
          `commands) exceeds the fallback budget (${kernelCodeBytes(onWithMoveAndFade.project, mapper)})`
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

// The kernel-lo-only twin of inflate() above: a metasprite costs kernel-lo's
// own spriteBytes term (main/build/generate.js's kernelTableBytes) exactly
// the way a filler actor does, but -- unlike an actor -- it is never a row in
// battleTables' own monster tables, so it grows nothing in the banked
// battle-code region at all (main/build/battletables.js). Some of the tests
// below need a kernel-lo deficit on one board while a *second*, candidate
// board still has room in both its kernel-lo bank and its (shared,
// board-independent) banked battle-code region; inflate()'s own actors load
// both regions at once and can no longer open that window now that the
// status-effects slice grew the banked region's own stock base on every
// board alike (docs/design-status-effects.md) -- see the comment on the test
// just below for the arithmetic.
function inflateMetasprites(project, count) {
  const template = project.sprites.metasprites[0];
  for (let i = 0; i < count; i++) {
    project.sprites.metasprites.push({ ...structuredClone(template), id: 1000 + i, name: `FillerMS${i}` });
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
// action project on MMC3 whose only event is "Move" turns the split term on
// for a reason that disappears the moment that Move is gone too. Summing the
// flat allowances (395 for Move) would miss the 165 bytes SPLIT_KERNEL_ALLOWANCE
// also frees here and wrongly fall through past a deficit only just over
// what Move alone frees.
test('a kernel-lo shortfall Move alone would not close by its own allowance can still close when dropping it also turns off the split term', () => {
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
  // 210, not the earlier 201: handoff-magic/brief-split-term-1.md re-measured
  // SPLIT_KERNEL_ALLOWANCE at 165, not 19 -- the true cost of MMC3's whole
  // font-bank split machinery, not just switch_prg_bank's own critical
  // section -- which widened this test's band from (395, 414] to
  // (395, 560] (395 + 165). The combined MMC3 reservation for a project that
  // shows text is unchanged by that fix (base dropped by exactly as much as
  // the split term grew, conserving the sum), so the deficit at any given
  // inflate() count is unaffected up to this point -- what changed is how
  // much room the band itself has to be recentred in. Re-derived against a
  // real checkCapacity() run: 210 lands the deficit at 476, almost exactly
  // centred in the new band (477.5 is the midpoint).
  inflate(project, 210); // deficit 476, strictly above 395 and at or below 560
  // The band a deficit has to sit in for the split term's own extra bytes to
  // be the thing making the difference is strictly above Move's own
  // allowance alone (395) and at or below the combined figure (560) -- below
  // 395 and Move alone already covers it without the split term in the
  // picture at all, and above 560 neither figure would close the gap.
  const deficit = kernelShortfallDeficit(project);
  const moveAlone = MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE;
  assert.ok(
    deficit > moveAlone,
    `deficit ${deficit} must exceed MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE (${moveAlone}) alone, or this ` +
      'case does not exercise the split term being freed alongside Move at all'
  );
  assert.ok(
    deficit <= moveAlone + SPLIT_KERNEL_ALLOWANCE,
    'deficit ' +
      `${deficit} must not exceed MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE + SPLIT_KERNEL_ALLOWANCE ` +
      `(${moveAlone + SPLIT_KERNEL_ALLOWANCE}), or dropping Move would not close the gap either`
  );
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command \(frees 560 bytes\)/);
});

test('a kernel-lo shortfall a live Save command alone would close names Save, with that board’s own allowance', async () => {
  const project = await loadProject(SAMPLE_RPG);
  // MMC1 -- an RPG project's real Save cost here is the sum of the two Save
  // terms (511 + 36 = 547), not SAVE_KERNEL_ALLOWANCE_BY_MAPPER[1] alone
  // (511) -- MMC3's own RPG total is 552 (516 + 36).
  project.cartridge.mapper = 1;
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
  assert.match(
    message,
    new RegExp(`removing every Save command \\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[1] + SAVE_BATTLE_KERNEL_ALLOWANCE} bytes\\)`)
  );
  assert.doesNotMatch(message, /Move command/, 'this project never turns Move on, so it must not be offered as a fix');
  // Title is now its own kernelCodeBytes term, but it is content on a map,
  // not a command projectWithoutCommands can switch off -- and this project
  // could not drop it anyway (validateProject requires one alongside a live
  // Save). kernelShortfallAdvice must never suggest it.
  assert.doesNotMatch(message, /title/i, 'a title screen is not a droppable command and must never be offered as a fix');
});

test('a kernel-lo shortfall neither Save nor Move would close, but a roomier board would, names that board', async () => {
  const project = await loadProject(SAMPLE_RPG);
  // Naming off explicitly (phase 5): sample-rpg's own naming is now live for
  // real and would shift the narrow, hand-calibrated filler count below --
  // unrelated to what this case is actually about.
  project.party[0].renamable = false;
  if (project.party[1]) project.party[1].renamable = false;
  project.cartridge.mapper = 30; // UNROM 512 — the largest per-mapper base of the three, so MMC1 has headroom to spare
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  // No Save, no Move: kernelShortfallAdvice must skip straight past the
  // feature-drop branch (neither is live) to the mapper-swap one.
  //
  // inflateMetasprites, not inflate: the status-effects slice
  // (docs/design-status-effects.md) grew every board's banked battle-region
  // base by the same 164 bytes (BASE_BATTLE_CODE_BYTES_BY_MAPPER,
  // main/build/battletables.js), and inflate()'s own filler actors are also
  // monster-table rows in that region -- so by the time enough of them
  // existed to open a kernel-lo-only deficit on UNROM 512, the identical,
  // now-larger region had already overflowed on the MMC1 candidate this test
  // needs to still fit (confirmed directly: with inflate(), MMC1's banked
  // region overflows at 118 fillers while UNROM 512's kernel-lo does not
  // until 119 -- no count opens the window this test needs). A metasprite
  // costs kernel-lo's own spriteBytes term the same way a filler actor does,
  // but is never a row in battleTables' own tables, so it cannot touch the
  // banked region at all -- see inflateMetasprites' own comment above. 52
  // metasprites land a 41-byte kernel-lo deficit on UNROM 512 while leaving
  // MMC1's banked region exactly where it started (re-measured against a
  // real checkCapacity() run, not derived by arithmetic, per this file's own
  // rule on why that matters).
  inflateMetasprites(project, 52);
  const message = kernelShortfallMessage(project);
  assert.match(message, /Try MMC1 in the Build panel/);
});

// P2-1 (phase 3 fix round 4): the mapper-swap branch above used to price a
// candidate by kernelCodeBytes alone, but kernelTableBytes is itself
// mapper-dependent now (the CHR-RAM streaming tables, phase 3 fix round 3 --
// 3 bytes per tileset on a chrRam board, 0 elsewhere), so a switch off
// UNROM 512 also frees table bytes a code-only comparison never sees.
// Reviewer's own reproduction, re-derived here rather than hand-typed: a
// Join-only sample-rpg variant (hero naming off, one named Join) with its
// default 3 tilesets and enough filler metasprites to land a 196-byte
// kernel-lo deficit on UNROM 512. MMC1 saves 195 code bytes alone -- short
// of 196 -- but 204 total (195 code + 9 table, chrTableBytes going from 3
// regions x 3 bytes on UNROM 512 to 0 on MMC1), which does cover it. The
// wrong implementation this catches: pricing a candidate by kernelCodeBytes
// alone recommends dropping content (or nothing at all) instead of the
// board that actually fits.
test(
  'a mapper suggestion prices a candidate by full kernel-lo occupancy (code + table bytes), not code bytes alone -- a board that only fits once its table savings are counted is still offered, and content is not',
  async () => {
    const project = await loadProject(SAMPLE_RPG);
    // Hero naming off explicitly (phase 5): sample-rpg's own hero (party[0])
    // now opts in for real, and this reproduction needs Join naming ALONE --
    // the new Ally member pushed below carries its own renamable: true.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 30; // UNROM 512 -- the only chrRam board, so the only one with a nonzero table term to omit
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    assert.equal(project.tilesets.length, 3, 'sample-rpg ships 3 tilesets by default -- the reviewer\'s own shape');
    project.party.push({ id: project.party.length, name: 'Ally', renamable: true, startsInParty: false });
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'join', member: project.party.length - 1 }] }] } }
    });
    assert.ok(
      !projectUsesHeroNaming(project) && projectUsesJoinNaming(project),
      'this reproduction needs Join naming alone, not hero naming -- otherwise the solo-drop branch above would offer removing naming instead of exercising the mapper-swap branch'
    );
    // Zero-tile filler metasprites, not inflateMetasprites (which clones a
    // real, 4-tile template) -- a real tile costs 4 kernel-lo bytes/tile on
    // every board alike and would swamp the small, table-only gap this
    // reproduction depends on long before the deficit reaches 196.
    for (let i = 0; i < 220; i++) project.sprites.metasprites.push({ id: 1000 + i, name: `FillerMS${i}`, tiles: [] });

    const mapper30 = SUPPORTED_MAPPERS.find((m) => m.id === 30);
    const mapper1 = SUPPORTED_MAPPERS.find((m) => m.id === 1);
    const occupancyOn = (m) => {
      const { fixedBytes, tableBytes } = kernelTableBytes(project, m);
      return kernelCodeBytes(project, m) + fixedBytes + tableBytes;
    };
    const codeSaved = kernelCodeBytes(project, mapper30) - kernelCodeBytes(project, mapper1);
    const tableSaved = occupancyOn(mapper30) - occupancyOn(mapper1) - codeSaved;
    assert.equal(codeSaved, 195, 'the reproduction must still isolate to exactly 195 code-only bytes saved by MMC1, or this is testing a different shape');
    assert.equal(tableSaved, 9, 'the reproduction must still isolate to exactly 9 table-only bytes saved by MMC1 (the CHR-RAM streaming tables), or this is testing a different shape');

    const { problems } = checkCapacity(project);
    const error = problems.find((p) => p.severity === 'error' && /lookup tables/.test(p.message));
    assert.ok(error, 'expected checkCapacity to refuse this project on UNROM 512');
    const deficit = Number(error.message.match(/need (\d+) bytes but only (-?\d+) are free/)?.[1]) - Number(error.message.match(/need (\d+) bytes but only (-?\d+) are free/)?.[2]);
    assert.equal(deficit, 196, 'the reproduction must still isolate to exactly a 196-byte deficit, or this is testing a different shape');
    assert.ok(
      deficit > codeSaved,
      `this case only exercises the bug if the code-only savings (${codeSaved}) alone would NOT cover the deficit (${deficit})`
    );

    assert.match(
      error.message,
      /Try MMC1 in the Build panel — it reserves 204 fewer bytes for the same features\.$/,
      `expected the full-occupancy MMC1 suggestion; got: ${error.message}`
    );
    assert.doesNotMatch(
      error.message,
      /Reduce the number|Try removing/,
      'a board that actually fits must be offered, not content removal'
    );
  }
);

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
  // Naming off explicitly (phase 5) -- the identical recalibration note as
  // the case above, whose exact filler count this test reuses.
  base.party[0].renamable = false;
  if (base.party[1]) base.party[1].renamable = false;
  base.cartridge.mapper = 30; // UNROM 512 -- the case above proves MMC1 is offered here
  base.project.titleMap = 0;
  base.project.titleScreen = 0;
  inflateMetasprites(base, 52); // see the identical recalibration note on the case above

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

/**
 * Removes every live occurrence of one opcode from `project`, page by page,
 * across every placed entity's event -- unlike filtering out a whole entity
 * (which a project can be sharing between two commands the way
 * saveAndMoveEvent puts Save and Move on the same page), this drops exactly
 * one command and leaves any other command on the same page alone. Used by
 * the documented-limitation tests below to confirm which single command a
 * real refusal's own advice is actually naming.
 */
function dropCommand(project, op) {
  const cloned = structuredClone(project);
  for (const map of cloned.maps ?? []) {
    for (const screen of map.screens ?? []) {
      for (const entity of screen.entities ?? []) {
        for (const page of entity.props?.event?.pages ?? []) {
          page.commands = (page.commands ?? []).filter((command) => command.op !== op);
        }
      }
    }
  }
  return cloned;
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
    // Naming off explicitly (phase 5): this documented-limitation figure is
    // CLAUDE.md's own pinned number for Save+Move+item alone, computed clean
    // of sample-rpg's own naming, which now opts in for real.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
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
          `\\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[4] + SAVE_BATTLE_KERNEL_ALLOWANCE} bytes\\)`
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
    saveOnly.party[0].renamable = false; // naming off explicitly, phase 5
    if (saveOnly.party[1]) saveOnly.party[1].renamable = false;
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
    moveOnly.party[0].renamable = false; // naming off explicitly, phase 5
    if (moveOnly.party[1]) moveOnly.party[1].renamable = false;
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
    both.party[0].renamable = false; // naming off explicitly, phase 5
    if (both.party[1]) both.party[1].renamable = false;
    both.cartridge.mapper = 30;
    both.project.titleMap = 0;
    both.project.titleScreen = 0;
    both.maps[0].screens[0].entities.push(saveAndMoveEvent());
    const message = kernelShortfallMessage(both);
    assert.match(
      message,
      new RegExp(
        `removing every Move command \\(frees ${MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} bytes\\) or every Save command ` +
          `\\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[30] + SAVE_BATTLE_KERNEL_ALLOWANCE} bytes\\)`
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
    bothItemFree.party[0].renamable = false; // naming off explicitly, phase 5
    if (bothItemFree.party[1]) bothItemFree.party[1].renamable = false;
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
          `\\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[30] + SAVE_BATTLE_KERNEL_ALLOWANCE} bytes\\)`
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
// 560, not 557: name entry phase 1 (docs/design-name-entry.md §2/§10)
// appended pc_name_ram to SAVE_FIELDS unconditionally, growing every
// save-enabled board's own save_field_lo/hi/len tables by 3 real bytes
// (assets/save.inc) regardless of whether naming is ever turned on --
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER re-measured and moved 511/516/683 ->
// 514/519/686, so MMC3's own RPG total (SAVE_KERNEL_ALLOWANCE_BY_MAPPER[4] +
// SAVE_BATTLE_KERNEL_ALLOWANCE) moved 557 -> 560, and this hardcoded literal
// (395 + 560, below, the same +3) needed editing for that reason. Before
// that, Magic Forge phase 4 (BE_RESTORE) had grown SAVE_BATTLE_KERNEL_
// ALLOWANCE from 36 to 41, a +5 these two message literals absorbed the
// same way.
test('a kernel-lo shortfall either Save or Move alone would close offers both as a choice', async () => {
  const project = await loadProject(SAMPLE_RPG);
  // Naming off explicitly (phase 5) -- the inflate() filler count below is
  // hand-calibrated to a naming-off deficit band.
  project.party[0].renamable = false;
  if (project.party[1]) project.party[1].renamable = false;
  project.cartridge.mapper = 4; // MMC3
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push(saveAndMoveEvent());
  inflate(project, 25);
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command \(frees 395 bytes\) or every Save command \(frees 560 bytes\)/);
});

// Neither allowance alone covers a big enough deficit, but the two together
// do: kernelShortfallAdvice must consider the combination rather than
// falling straight through to a mapper suggestion or the generic message.
test('a kernel-lo shortfall neither Save nor Move alone would close, but both together would, names the combination', async () => {
  const project = await loadProject(SAMPLE_RPG);
  // Naming off explicitly (phase 5) -- the inflate() filler count below is
  // hand-calibrated to a naming-off deficit band.
  project.party[0].renamable = false;
  if (project.party[1]) project.party[1].renamable = false;
  project.cartridge.mapper = 4; // MMC3
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push(saveAndMoveEvent());
  inflate(project, 88);
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command and every Save command together \(frees 955 bytes\)/);
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
// suggestion or the generic "reduce content" message. n=220, not the
// earlier 190: `docs/kernel-base-overcharge-report.md` moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER to the action-side figure, giving this
// action project real headroom on MMC1 that used to be silently withheld,
// so 190's own deficit no longer exists at all. Re-derived against a real
// checkCapacity() run: 220 lands a 27-byte deficit, comfortably under
// WAIT_KERNEL_ALLOWANCE (48) and centred within the (0, 48] band this case
// only needs to sit inside -- 222 also lands inside it, at 43, only 5 bytes
// below the boundary, which left no room to catch a regression that grew
// the deficit rather than shrank it.
test('a kernel-lo shortfall a live Wait command alone would close names Wait', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'wait', frames: 30 }] }] } }
  });
  inflate(project, 213);
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
// silently also drops a dependent term" shape the Move+split case above
// already proves, applied to Turn+Face instead of Move+split. Sized so
// neither Turn alone (51) nor Wait alone (48) covers the deficit, but
// dropping both together does, because with neither command left, Face has
// no more reason to assemble either: TURN_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE
// + FACE_KERNEL_ALLOWANCE = 35 + 48 + 16 = 99. This is the test that fails if
// *either* new active.push line is missing: with only one of Turn/Wait in
// `active`, the combo loop below (which requires at least two chosen
// features) never runs, and the message falls straight through to a mapper
// suggestion or the generic one instead of naming either command. n=220, not
// the earlier 186: `docs/kernel-base-overcharge-report.md` moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER to the action-side figure, giving this
// action project real headroom on MMC1 the old base withheld. Re-derived
// against a real checkCapacity() run: 220 lands a 78-byte deficit, near the
// middle of the (51, 99] band -- strictly above both solo figures (51, 48)
// and at or below the combined one (99). 217 also lands inside the band, at
// 54, but that sits only 3 bytes above the lower boundary; inflate() moves
// in exact 8-byte steps, so 220 is the nearest centred count.
test('a kernel-lo shortfall neither Turn nor Wait alone would close, but both together would, names the combination', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
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
  inflate(project, 213);
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

// Shake's own solo case: it shares no dependent term with anything (no
// Face-like companion routine another command also calls), so this is the
// plainest possible case, the same shape Wait's own solo test above already
// is. This is the test that fails if active.push({ op: 'shake', ... }) is
// missing from kernelShortfallAdvice: without it, Shake is never considered
// at all and the message falls through to a mapper suggestion or the
// generic one instead of naming it. n=219, not the earlier 184:
// `docs/kernel-base-overcharge-report.md` moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER to the action-side figure, giving this
// action project real headroom on MMC1 the old base withheld -- re-derived
// against a real checkCapacity() run, landing a 36-byte deficit, centred
// within the (0, 65] band this case only needs to sit inside -- 222 also
// lands inside it, at 60, only 5 bytes below SHAKE_KERNEL_ALLOWANCE (65),
// which left no room to catch a regression that grew the deficit rather
// than shrank it. The two negative-control tests below reuse this
// identical count, per their own comments.
test('a kernel-lo shortfall a live Shake command alone would close names Shake', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 30 }] }] } }
  });
  inflate(project, 212);
  const deficit = kernelShortfallDeficit(project);
  assert.ok(deficit <= SHAKE_KERNEL_ALLOWANCE, `deficit ${deficit} must not exceed SHAKE_KERNEL_ALLOWANCE (${SHAKE_KERNEL_ALLOWANCE}) or this case does not exercise Shake alone closing the gap`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Shake command \\(frees ${SHAKE_KERNEL_ALLOWANCE} bytes\\)`));
  assert.doesNotMatch(message, /Turn command/, 'this project never turns Turn on, so it must not be offered as a fix');
  assert.doesNotMatch(message, /Wait command/, 'this project never turns Wait on, so it must not be offered as a fix');
});

// The combination half: Shake and Wait together, purely additive since
// neither shares a dependent term with the other (unlike Turn+Move's own
// FACE_KERNEL_ALLOWANCE) -- SHAKE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE =
// 65 + 48 = 113. Sized so neither command alone (65, 48) covers the deficit
// but dropping both together does. n=220, not the earlier 186:
// `docs/kernel-base-overcharge-report.md` moved BASE_KERNEL_CODE_BYTES_BY_MAPPER
// to the action-side figure, giving this action project real headroom on
// MMC1 the old base withheld -- re-derived against a real checkCapacity()
// run, landing a 92-byte deficit, near the middle of the (65, 113] band --
// strictly above both solo figures and at or below the combined one. 217
// also lands inside the band, at 68, only 3 bytes above the lower boundary;
// inflate() moves in exact 8-byte steps, so 220 is the nearest centred
// count.
test('a kernel-lo shortfall neither Shake nor Wait alone would close, but both together would, names the combination', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
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
              { op: 'shake', frames: 30 },
              { op: 'wait', frames: 30 }
            ]
          }
        ]
      }
    }
  });
  inflate(project, 213);
  const deficit = kernelShortfallDeficit(project);
  const combined = SHAKE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE;
  assert.ok(
    deficit > SHAKE_KERNEL_ALLOWANCE && deficit > WAIT_KERNEL_ALLOWANCE,
    `deficit ${deficit} must exceed both Shake alone (${SHAKE_KERNEL_ALLOWANCE}) and Wait alone (${WAIT_KERNEL_ALLOWANCE}), or this case does not exercise the combination at all`
  );
  assert.ok(deficit <= combined, `deficit ${deficit} must not exceed the combined figure (${combined}), or dropping both would not close the gap either`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Wait command and every Shake command together \\(frees ${combined} bytes\\)`));
});

// Show/Hide's own solo case: it shares no dependent term with anything (no
// Face-like companion routine another command also calls), the identical
// shape Shake's own solo test above already is. This is the test that fails
// if active.push({ op: 'visible', ... }) is missing from
// kernelShortfallAdvice: without it, Show/Hide is never considered at all
// and the message falls through to a mapper suggestion or the generic one
// instead of naming it. n=221, not the earlier 188:
// `docs/kernel-base-overcharge-report.md` moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER to the action-side figure, giving this
// action project real headroom on MMC1 the old base withheld -- re-derived
// against a real checkCapacity() run, landing a 36-byte deficit, under
// VISIBLE_KERNEL_ALLOWANCE (49).
test('a kernel-lo shortfall a live Show/Hide command alone would close names Show/Hide', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'visible', state: 'hidden' }] }] } }
  });
  // 213, not 214: metaspriteKernelBytes' own empty-table placeholder fix
  // (phase 3 fix round 3b -- ms_data_0/anim_data_0's real one-byte
  // generator placeholder, previously unmodelled) adds 2 predicted bytes to
  // this project's kernelTableBytes (its metasprites and animations are
  // both empty), which at the old 214 pushed the deficit from 48 to 50 --
  // over VISIBLE_KERNEL_ALLOWANCE. Re-measured, not adjusted by hand: one
  // fewer filler actor (8 bytes/actor) lands back at 42.
  inflate(project, 213);
  const deficit = kernelShortfallDeficit(project);
  assert.ok(
    deficit <= VISIBLE_KERNEL_ALLOWANCE,
    `deficit ${deficit} must not exceed VISIBLE_KERNEL_ALLOWANCE (${VISIBLE_KERNEL_ALLOWANCE}) or this case does not exercise Show/Hide alone closing the gap`
  );
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Show/Hide command \\(frees ${VISIBLE_KERNEL_ALLOWANCE} bytes\\)`));
  assert.doesNotMatch(message, /Shake command/, 'this project never turns Shake on, so it must not be offered as a fix');
  assert.doesNotMatch(message, /Wait command/, 'this project never turns Wait on, so it must not be offered as a fix');
});

// The combination half: Shake and Show/Hide together, purely additive since
// neither shares a dependent term with the other -- SHAKE_KERNEL_ALLOWANCE +
// VISIBLE_KERNEL_ALLOWANCE = 65 + 49 = 114. Sized so neither command alone
// (65, 49) covers the deficit but dropping both together does. n=220, not
// the earlier 186: `docs/kernel-base-overcharge-report.md` moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER to the action-side figure, giving this
// action project real headroom on MMC1 the old base withheld -- re-derived
// against a real checkCapacity() run, landing a 93-byte deficit, near the
// middle of the (65, 114] band -- strictly above both solo figures and at
// or below the combined one. 217 also lands inside the band, at 69, only 4
// bytes above the lower boundary; inflate() moves in exact 8-byte steps, so
// 220 is the nearest centred count.
test('a kernel-lo shortfall neither Shake nor Show/Hide alone would close, but both together would, names the combination', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
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
              { op: 'shake', frames: 30 },
              { op: 'visible', state: 'hidden' }
            ]
          }
        ]
      }
    }
  });
  inflate(project, 213);
  const deficit = kernelShortfallDeficit(project);
  const combined = SHAKE_KERNEL_ALLOWANCE + VISIBLE_KERNEL_ALLOWANCE;
  assert.ok(
    deficit > SHAKE_KERNEL_ALLOWANCE && deficit > VISIBLE_KERNEL_ALLOWANCE,
    `deficit ${deficit} must exceed both Shake alone (${SHAKE_KERNEL_ALLOWANCE}) and Show/Hide alone (${VISIBLE_KERNEL_ALLOWANCE}), or this case does not exercise the combination at all`
  );
  assert.ok(deficit <= combined, `deficit ${deficit} must not exceed the combined figure (${combined}), or dropping both would not close the gap either`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Shake command and every Show/Hide command together \\(frees ${combined} bytes\\)`));
});

// Fade's own solo case, no Flash anywhere in the project: dropping the only
// live Fade command turns off both FADE_ENABLED and PALETTE_FX_ENABLED (no
// Flash keeps the shared term charged), so the real freed figure is
// FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE -- 146 + 55 = 201, the
// same total the bare FADE_KERNEL_ALLOWANCE used to be before the re-gate.
// n=210, not the earlier 190: `docs/kernel-base-overcharge-report.md` moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER to the action-side figure, giving this
// action project real headroom on MMC1 the old base withheld -- re-derived
// against a real checkCapacity() run, landing a 100-byte deficit, almost
// exactly centred within the (0, 201] band this case only needs to sit
// inside. 222 also lands inside it, at 196, only 5 bytes below the
// 201-byte freed figure, which left no room to catch a regression that
// grew the deficit rather than shrank it. This is the test that fails if
// active.push({ op: 'fade', ... }) is missing from kernelShortfallAdvice:
// without it, Fade is never considered at all and the message falls through
// to a mapper suggestion or the generic one instead of naming it.
test('a kernel-lo shortfall a live Fade command alone would close names Fade', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'fade', dir: 'out' }] }] } }
  });
  inflate(project, 210);
  const deficit = kernelShortfallDeficit(project);
  const freed = FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE;
  assert.ok(deficit <= freed, `deficit ${deficit} must not exceed FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE (${freed}) or this case does not exercise Fade alone closing the gap`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Fade command \\(frees ${freed} bytes\\)`));
  assert.doesNotMatch(message, /Turn command/, 'this project never turns Turn on, so it must not be offered as a fix');
  assert.doesNotMatch(message, /Shake command/, 'this project never turns Shake on, so it must not be offered as a fix');
  assert.doesNotMatch(message, /Flash command/, 'this project never turns Flash on, so it must not be offered as a fix');
});

// The combination half: Shake and Fade together, purely additive since
// neither shares a dependent term with the other -- SHAKE_KERNEL_ALLOWANCE +
// FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE = 65 + 146 + 55 = 266,
// the identical 266 this combination has always measured (no Flash anywhere
// in this project, so the shared term is charged once, for Fade alone, the
// same as the solo case just above). Sized so neither command alone (65,
// 201) covers the deficit but dropping both together does. n=220, not the
// earlier 190: `docs/kernel-base-overcharge-report.md` moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER to the action-side figure, giving this
// action project real headroom on MMC1 the old base withheld -- re-derived
// against a real checkCapacity() run, landing a 245-byte deficit -- strictly
// above both solo figures and at or below the combined one.
test('a kernel-lo shortfall neither Shake nor Fade alone would close, but both together would, names the combination', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
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
              { op: 'shake', frames: 30 },
              { op: 'fade', dir: 'out' }
            ]
          }
        ]
      }
    }
  });
  inflate(project, 213);
  const deficit = kernelShortfallDeficit(project);
  const fadeAlone = FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE;
  const combined = SHAKE_KERNEL_ALLOWANCE + fadeAlone;
  assert.ok(
    deficit > SHAKE_KERNEL_ALLOWANCE && deficit > fadeAlone,
    `deficit ${deficit} must exceed both Shake alone (${SHAKE_KERNEL_ALLOWANCE}) and Fade alone (${fadeAlone}), or this case does not exercise the combination at all`
  );
  assert.ok(deficit <= combined, `deficit ${deficit} must not exceed the combined figure (${combined}), or dropping both would not close the gap either`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Shake command and every Fade command together \\(frees ${combined} bytes\\)`));
});

// item 6's own new-slice case: dropping Fade when a live Flash is ALSO
// present frees only FADE_KERNEL_ALLOWANCE -- the shared PALETTE_FX_ENABLED
// term stays charged because Flash keeps it alive, so this is genuinely a
// smaller freed figure than the Fade-alone case above (146, not 201) despite
// both projects dropping "every Fade command." This is the non-tautology
// case design-flash.md §4 calls out explicitly: summing the bare
// FADE_KERNEL_ALLOWANCE here (as if the shared term always came along for
// free) would overstate what dropping Fade actually buys once Flash is
// also live. n=200, not the earlier 170:
// `docs/kernel-base-overcharge-report.md` moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER to the action-side figure, giving this
// action project real headroom on MMC1 the old base withheld -- re-derived
// against a real checkCapacity() run, landing a 118-byte deficit, strictly
// above FLASH_KERNEL_ALLOWANCE (98) and at or below FADE_KERNEL_ALLOWANCE
// (146).
test('a kernel-lo shortfall with both Flash and Fade live: dropping Fade alone frees only FADE_KERNEL_ALLOWANCE, not the shared term', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
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
              { op: 'flash' },
              { op: 'fade', dir: 'out' }
            ]
          }
        ]
      }
    }
  });
  inflate(project, 193);
  const deficit = kernelShortfallDeficit(project);
  assert.ok(
    deficit > FLASH_KERNEL_ALLOWANCE,
    `deficit ${deficit} must exceed FLASH_KERNEL_ALLOWANCE (${FLASH_KERNEL_ALLOWANCE}) alone, or Flash would also be offered as a solo drop, muddying what this test isolates`
  );
  assert.ok(
    deficit <= FADE_KERNEL_ALLOWANCE,
    `deficit ${deficit} must not exceed FADE_KERNEL_ALLOWANCE (${FADE_KERNEL_ALLOWANCE}) alone, or this case does not exercise "drop Fade alone" closing the gap on its own`
  );
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Fade command \\(frees ${FADE_KERNEL_ALLOWANCE} bytes\\)`));
  assert.doesNotMatch(
    message,
    new RegExp(`frees ${FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE} bytes`),
    'dropping Fade here must not claim the Fade-alone (no-Flash) figure -- Flash keeps the shared term charged'
  );
});

// Round 2, item 4e: the negative control the earlier positive-only tests
// could not provide on their own. A project with no live Fade command at
// all, but a real, similarly-sized kernel-lo deficit reached through Shake
// alone, must never have the advice mention Fade -- neither as a solo drop
// nor as part of any offered combination.
//
// Sabotage-tested (round-1 fixes, finding 29 follow-on): an ungated
// `active.push({ op: 'fade', ... })` -- dropping the `if (usesFade)` check
// entirely -- still passes this test. `freedByDropping` recomputes the
// candidate's own freed-byte count from `projectWithoutCommands` against
// this real project, not from whether it was gated onto `active` in the
// first place, and dropping a command that was never live to begin with
// frees exactly 0 bytes; `freed >= deficit` then filters it out of both
// `solo` and every combo regardless of how it got onto `active`. So this
// test's real value is narrower than "catches the missing `usesFade` gate":
// what it actually catches is a defect that bypasses that self-correcting
// filter outright -- for instance, a message-string builder that mentions
// Fade unconditionally alongside whatever real candidate closed the gap,
// rather than only a candidate that survived the `freed >= deficit` check.
test('a kernel-lo shortfall with no live Fade command never names Fade as droppable advice', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 30 }] }] } }
  });
  inflate(project, 212); // the identical Shake-solo deficit measured above
  const deficit = kernelShortfallDeficit(project);
  assert.ok(deficit <= SHAKE_KERNEL_ALLOWANCE, `deficit ${deficit} must not exceed SHAKE_KERNEL_ALLOWANCE (${SHAKE_KERNEL_ALLOWANCE}) or this case does not exercise Shake alone closing the gap`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Shake command \\(frees ${SHAKE_KERNEL_ALLOWANCE} bytes\\)`));
  assert.doesNotMatch(
    message,
    /Fade command/,
    'this project never turns Fade on, so it must never be offered as a fix -- neither solo nor as part of a combination'
  );
});

// design-flash.md §9 test 15: the identical negative control for Flash,
// mirroring Fade's own shape and its own comment's honesty above. A project
// with no live Flash command anywhere, but a real, similarly-sized kernel-lo
// deficit reached through Shake alone, must never have the advice mention
// Flash -- neither solo nor as part of any offered combination. This is a
// genuine, user-visible negative control, but -- the same class of
// overclaim Fade's own comment above was corrected to avoid -- it does NOT
// catch an active.push({ op: 'flash', ... }) left ungated on usesFlash the
// way its own earlier wording claimed: freedByDropping recomputes Flash's
// own freed-byte count from projectWithoutCommands regardless of whether it
// was gated onto `active` in the first place, and dropping a command that
// was never live frees exactly 0 bytes here (this project has no live Flash
// to drop), so `freed >= deficit` filters an ungated Flash entry out of both
// `solo` and every combo just as reliably as a correctly-gated one would --
// the real, already-valid Shake-solo candidate is found first and returned
// either way, so this fixture cannot distinguish the two implementations at
// all. What this test actually verifies is the user-visible outcome: no
// advice ever names a command the project does not use.
test('a kernel-lo shortfall with no live Flash command never names Flash as droppable advice', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 30 }] }] } }
  });
  inflate(project, 212); // the identical Shake-solo deficit measured above
  const deficit = kernelShortfallDeficit(project);
  assert.ok(deficit <= SHAKE_KERNEL_ALLOWANCE, `deficit ${deficit} must not exceed SHAKE_KERNEL_ALLOWANCE (${SHAKE_KERNEL_ALLOWANCE}) or this case does not exercise Shake alone closing the gap`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Shake command \\(frees ${SHAKE_KERNEL_ALLOWANCE} bytes\\)`));
  assert.doesNotMatch(
    message,
    /Flash command/,
    'this project never turns Flash on, so it must never be offered as a fix -- neither solo nor as part of a combination'
  );
});

// ------------------------------------------------------------------ Sting
// Item 6, sound-effect slice (handoff-sting/design-sting.md §12, tests 3/15). Two questions this
// file's own discipline already applies to every other allowance: is STING_KERNEL_ALLOWANCE flat
// across every RPG-capable board (equality, not merely covered), and does the dependent split term
// ride along with it correctly (design-sting.md §8, the identical shape projectUsesFace's own
// comment already describes for Move/Turn)?

test(
  'STING_KERNEL_ALLOWANCE covers the real, isolated cost of a live Sting exactly, on every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // withMove: true as the baseline on both sides, not a no-command baseline: a bare Sting-only
    // delta on MMC3 would also turn the split term on (any surviving event does, projectUsesText), so
    // comparing against a baseline that already has a different, surviving event (Move) isolates
    // Sting's own cost from the split term's -- the split term is already charged on both sides of this
    // diff and cancels out, the same isolation this file's own ITEM_KERNEL_ALLOWANCE measurement
    // above already uses against the noSave baseline.
    for (const mapper of CAPABLE_MAPPERS) {
      const without = await measureCodeBytes(t, mapper, { withMove: true });
      const withSting = await measureCodeBytes(t, mapper, { withMove: true, withSting: true });
      const delta = withSting.codeBytes - without.codeBytes;
      // STING_KERNEL_ALLOWANCE itself no longer exists as a single constant --
      // split into STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE
      // once SFX shipped and needed the same force_trig block (design-sfx.md
      // §3.6/§7 test 10) -- the two sum to the identical historical 175 a
      // Sting-only project has always paid, asserted directly here rather than
      // only in the dedicated force_trig re-gate test below.
      assert.equal(
        delta,
        STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE,
        `${mapper.name}: a live Sting costs ${delta} bytes of kernel code (${without.codeBytes} -> ` +
          `${withSting.codeBytes}), but STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE reserves ` +
          `${STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE} — this must equal Sting's real cost ` +
          'exactly, on every board (design-sting.md §8 claims it is flat; this is what actually proves it, not ' +
          'merely assumes it). Re-measure and correct it.'
      );
    }
  }
);

// The dependent-term case round-1 finding 11 added: on MMC3, a project whose *sole* live event is
// a Sting-only command is the project's only reason fontBankSplit (shared/font.js) turns
// SPLIT_KERNEL_ALLOWANCE on at all -- projectUsesText counts any surviving event, a
// Sting-only one included, the identical shape CLAUDE.md already documents for a Move-only event
// (and the test above it, in this file). Calibrated the same way that one was: a deficit strictly
// above STING_KERNEL_ALLOWANCE alone (175) and at or below the combined figure (340 = 175 + 165).
// handoff-magic/brief-split-term-1.md re-measured SPLIT_KERNEL_ALLOWANCE at 165, not 19 -- the true
// cost of MMC3's whole font-bank split machinery -- which widened this band from (175, 194] to
// (175, 340]; the combined MMC3 reservation for a project that shows text is unchanged by that fix
// (base dropped by exactly as much as the split term grew), so the deficit at a given inflate()
// count is unaffected -- what changed is how much room the band has to be recentred in. Re-derived
// against a real checkCapacity() run: inflate(210) lands the deficit at 256, almost exactly centred
// in the new band (257.5 is the midpoint).
test('a kernel-lo shortfall Sting alone would not close by its own allowance can still close when dropping it also turns off the split term', () => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 4; // MMC3
  project.songs = [createSong('Fanfare')];
  // The project's only event, and its only command -- the project's sole reason projectUsesText
  // (and so fontBankSplit) is true at all.
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 0 }] }] } }
  });
  inflate(project, 210); // deficit 256, strictly above 175 and at or below 340
  const deficit = kernelShortfallDeficit(project);
  assert.ok(
    deficit > (STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE),
    `deficit ${deficit} must exceed (STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE) (${(STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE)}) alone, or this case ` +
      'does not exercise the split term being freed alongside Sting at all'
  );
  assert.ok(
    deficit <= (STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE) + SPLIT_KERNEL_ALLOWANCE,
    `deficit ${deficit} must not exceed (STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE) + SPLIT_KERNEL_ALLOWANCE ` +
      `(${(STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE) + SPLIT_KERNEL_ALLOWANCE}), or dropping Sting would not close the gap either`
  );
  const message = kernelShortfallMessage(project);
  assert.match(
    message,
    new RegExp(`removing every Sting command \\(frees ${(STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE) + SPLIT_KERNEL_ALLOWANCE} bytes\\)`),
    'an implementation that sums the flat (STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE) constant directly instead of asking ' +
      'kernelCodeBytes what a Sting-free version of the project would actually cost would report ' +
      `${(STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE)} alone here, wrong by exactly the split term`
  );
});

// design-sting.md §9: the documented limitation Sting creates -- DEVIATION,
// review-fixes slice C, item 12: MMC3 Save+Move-no-item used to have enough
// margin that Sting's own allowance alone was the row's real tipping point
// (175 bytes, against a deficit just above it, matching the CLAUDE.md figure
// this comment used to cite). Item 12's own base growth (+15/board,
// unconditional -- see BASE_KERNEL_CODE_BYTES_BY_MAPPER's own comment in
// generate.js) already pushes this exact row 8 bytes over budget with NO
// Sting live at all, so Sting is no longer what tips it and dropping Sting
// alone no longer closes it (its own allowance grew too, to 187, but the
// deficit it would have to clear grew to 195) -- Move or Save, both much
// larger allowances, are the only single-command fixes left, and neither
// depends on whether Sting is live. What this test still proves is that
// Sting genuinely does not make the refusal disappear on its own now, not
// that it is what causes it.
test(
  'sample-rpg with Save, Move (no item) and a live Sting does not build on MMC3 -- a documented limitation',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.items = []; // isolate the no-item row this refusal actually lands on
    project.songs = [createSong('Fanfare')];
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 32,
      y: 32,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 0 }] }] } }
    });

    const message = kernelShortfallMessage(project);
    // Move and Save, not Sting: dropping Sting alone (187 bytes) no longer
    // closes this row's own deficit (195), so kernelShortfallAdvice's solo
    // pass correctly leaves it out -- see the header comment above.
    assert.match(message, /every Move command \(frees \d+ bytes\)/, 'the refusal should offer dropping Move');
    assert.match(message, /every Save command \(frees \d+ bytes\)/, 'the refusal should offer dropping Save');
    assert.doesNotMatch(
      message,
      /Sting/,
      'Sting alone no longer closes this row (its own allowance grew to 187, but so did the deficit, to 195) -- ' +
        'offering it here would be advice that does not actually work'
    );

    // Dropping Sting alone is NOT a real fix any more -- confirms the
    // deficit above is genuine, not an artifact of kernelShortfallMessage's
    // own arithmetic.
    const droppedSting = structuredClone(project);
    droppedSting.maps[0].screens[0].entities.pop();
    const dirSting = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sting-limitation-'));
    t.after(() => fsp.rm(dirSting, { recursive: true, force: true }));
    await saveProject(dirSting, droppedSting);
    await assert.rejects(
      buildProject({ dir: dirSting, project: droppedSting, log: () => {} }),
      'dropping only the Sting command should still fail to build -- this row is now over budget with no ' +
        'Sting live at all'
    );

    // Confirm the design's own stated mitigation still holds: dropping Move
    // ALONE -- Save stays live -- (one of the two fixes the message above
    // actually offers) is a real fix, with Sting still live too.
    const droppedMove = dropCommand(project, 'move');
    const dirMove = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sting-limitation-move-'));
    t.after(() => fsp.rm(dirMove, { recursive: true, force: true }));
    await saveProject(dirMove, droppedMove);
    const built = await buildProject({ dir: dirMove, project: droppedMove, log: () => {} });
    assert.ok(built.romPath, 'dropping Move (with Sting still live) should be a real fix');
  }
);

// -------------------------------------------------------------------- SFX
// design-sfx.md §7 tests 9-12/15. The decomposition mirrors Sting's own
// (STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE, above): a
// third, exclusive term for SFX's own standalone code, sharing the same
// AUDIO_FX_KERNEL_ALLOWANCE (force_trig's check-and-clear block in
// music_channel, now gated AUDIO_FX_ENABLED = usesSting || usesSfx rather
// than STING_ENABLED alone), plus a fourth, genuinely-both-live-only term
// (STING_SFX_INTERACTION_ALLOWANCE, sting_restore_silence's own ownership
// guard, nested inside the shipped `.if STING_ENABLED` block so it can only
// ever assemble when both flags are true).

test(
  'SFX_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE covers the real, isolated cost of a live SFX exactly (no Sting live), on every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // withMove: true as the baseline on both sides, the identical isolation
    // STING_KERNEL_ALLOWANCE's own test above already uses, for the same
    // reason: a bare no-command baseline would still leave the delta
    // uncontaminated here (SFX turns on no split-term dependency of its own
    // that a bare baseline would hide), but matching the Sting test's own
    // shape keeps the two directly comparable.
    for (const mapper of CAPABLE_MAPPERS) {
      const without = await measureCodeBytes(t, mapper, { withMove: true });
      const withSfx = await measureCodeBytes(t, mapper, { withMove: true, withSfx: true });
      const delta = withSfx.codeBytes - without.codeBytes;
      const expected = SFX_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE;
      assert.equal(
        delta,
        expected,
        `${mapper.name}: a live SFX (no Sting live) costs ${delta} bytes of kernel code (${without.codeBytes} -> ` +
          `${withSfx.codeBytes}), but SFX_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE reserves ` +
          `${expected} — this must equal SFX's real cost exactly, on every board (design-sfx.md §7 test 9). ` +
          'Re-measure and correct it.'
      );
    }
  }
);

// design-sfx.md §7 test 10: the force_trig re-gate (.if STING_ENABLED -> .if
// AUDIO_FX_ENABLED in music_channel) must not change a Sting-only project's
// own measured cost -- the direct, checked form of §3.6's "the re-gate is a
// no-op for a Sting-only project" claim. STING_KERNEL_ALLOWANCE_STANDALONE +
// AUDIO_FX_KERNEL_ALLOWANCE summing to exactly 175 was the historical flat
// STING_KERNEL_ALLOWANCE every Sting-only project paid before SFX existed;
// review-fixes slice C, item 12 moved that to 187 -- sting_snapshot/
// sting_restore (engine/music.asm) now also save/restore mus_inst_base
// alongside cur_song/mus_enabled, 12 bytes entirely inside the outer `.if
// STING_ENABLED` block (see STING_KERNEL_ALLOWANCE_STANDALONE's own comment
// in generate.js), so this is a real, legitimate move of the baseline this
// test pins, not a regression the re-gate introduced. What this test still
// checks is a real nesasm build against the implementation as shipped, not
// merely an arithmetic identity between two constants. Also confirms
// STING_SFX_INTERACTION_ALLOWANCE costs a Sting-only project nothing: the
// nested `.if SFX_ENABLED` guard inside sting_restore_silence collapses away
// identically to any other SFX_ENABLED-gated block when SFX is not live, and
// this same before/after-style comparison (against the current historical
// figure) already exercises that.
test(
  'the force_trig re-gate does not change a Sting-only project\'s own measured kernel-lo cost, on every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAPABLE_MAPPERS) {
      const without = await measureCodeBytes(t, mapper, { withMove: true });
      const withSting = await measureCodeBytes(t, mapper, { withMove: true, withSting: true });
      const delta = withSting.codeBytes - without.codeBytes;
      assert.equal(
        delta,
        STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE,
        `${mapper.name}: a live Sting (no SFX live) costs ${delta} bytes, but ` +
          `STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE reserves ` +
          `${STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE} -- the historical flat 187 a ` +
          'Sting-only project has always paid must not move now that force_trig\'s own gate reads ' +
          'AUDIO_FX_ENABLED instead of STING_ENABLED alone (design-sfx.md §7 test 10).'
      );
      assert.equal(delta, 187, `${mapper.name}: the historical Sting-only figure itself must not have moved`);
    }
  }
);

// design-sfx.md §7 test 11: AUDIO_FX_KERNEL_ALLOWANCE and
// STING_SFX_INTERACTION_ALLOWANCE measured directly off nesasm's own symbol
// table, by label-address span, rather than derived from subtracting two
// larger kernel-total deltas -- the "game.fns lists labels, not individual
// instructions" correction (design-sfx.md §7 test 11's own round-4 finding)
// means a subtraction-based measurement here would have to assume no other
// term shifted between the two builds it diffs, which a direct span
// measurement does not need to assume at all. One board is enough: neither
// span depends on anything board-specific (no mapper branches inside
// music_channel or sting_restore_silence), so this is a property of the
// source text nesasm assembles identically everywhere, not a per-board fact.
test(
  'AUDIO_FX_KERNEL_ALLOWANCE and STING_SFX_INTERACTION_ALLOWANCE match their own real, isolated code spans in game.fns',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = CAPABLE_MAPPERS[0];

    // AUDIO_FX_KERNEL_ALLOWANCE: the music_channel..music_channel_tick span
    // (the force_trig check-and-clear block plus the two instructions ahead
    // of it that exist either way) grows by exactly this much once the
    // block assembles -- confirmed identical whether Sting alone, SFX alone,
    // or both turn AUDIO_FX_ENABLED on, since the guard reads that one
    // combined flag rather than either feature's own.
    const neither = await measureCodeBytes(t, mapper, { withMove: true });
    const stingOnly = await measureCodeBytes(t, mapper, { withMove: true, withSting: true });
    const sfxOnly = await measureCodeBytes(t, mapper, { withMove: true, withSfx: true });
    const both = await measureCodeBytes(t, mapper, { withMove: true, withSting: true, withSfx: true });

    const spanNeither = symbolAddr(neither.symbols, 'music_channel_tick') - symbolAddr(neither.symbols, 'music_channel');
    const spanStingOnly = symbolAddr(stingOnly.symbols, 'music_channel_tick') - symbolAddr(stingOnly.symbols, 'music_channel');
    const spanSfxOnly = symbolAddr(sfxOnly.symbols, 'music_channel_tick') - symbolAddr(sfxOnly.symbols, 'music_channel');
    const spanBoth = symbolAddr(both.symbols, 'music_channel_tick') - symbolAddr(both.symbols, 'music_channel');

    assert.equal(spanStingOnly, spanSfxOnly, 'the force_trig block must assemble identically whether Sting or SFX is what turned AUDIO_FX_ENABLED on');
    assert.equal(spanStingOnly, spanBoth, 'the force_trig block must assemble exactly once, not once per feature, when both are live');
    assert.equal(
      spanStingOnly - spanNeither,
      AUDIO_FX_KERNEL_ALLOWANCE,
      `music_channel's own force_trig block spans ${spanStingOnly - spanNeither} bytes, but AUDIO_FX_KERNEL_ALLOWANCE reserves ${AUDIO_FX_KERNEL_ALLOWANCE}`
    );

    // STING_SFX_INTERACTION_ALLOWANCE: the sting_restore_silence..sting_tick
    // span (which only exists at all on a Sting-live build) grows by exactly
    // this much once SFX is also live and the nested ownership guard
    // assembles.
    const spanStingOnlyRestore = symbolAddr(stingOnly.symbols, 'sting_tick') - symbolAddr(stingOnly.symbols, 'sting_restore_silence');
    const spanBothRestore = symbolAddr(both.symbols, 'sting_tick') - symbolAddr(both.symbols, 'sting_restore_silence');
    assert.equal(
      spanBothRestore - spanStingOnlyRestore,
      STING_SFX_INTERACTION_ALLOWANCE,
      `sting_restore_silence's own span grows by ${spanBothRestore - spanStingOnlyRestore} bytes once SFX joins Sting, but STING_SFX_INTERACTION_ALLOWANCE reserves ${STING_SFX_INTERACTION_ALLOWANCE}`
    );
  }
);

// design-sfx.md §7 test 12: both live at once -- the combined delta must
// equal all four terms, the shared term charged once and the interaction
// term charged once, mirroring the existing 'a route whose only leg is
// Turn...' test's shape for a different dependent pair. A companion test
// drops only Sting from the same both-live project and asserts the freed
// byte count is STING_KERNEL_ALLOWANCE_STANDALONE + STING_SFX_INTERACTION_
// ALLOWANCE exactly -- not also AUDIO_FX_KERNEL_ALLOWANCE, since SFX is
// still live and the shared term must still be charged.
test(
  'a live Sting and a live SFX together cost exactly the sum of all four allowance terms, on every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAPABLE_MAPPERS) {
      const without = await measureCodeBytes(t, mapper, { withMove: true });
      const both = await measureCodeBytes(t, mapper, { withMove: true, withSting: true, withSfx: true });
      const delta = both.codeBytes - without.codeBytes;
      const expected =
        STING_KERNEL_ALLOWANCE_STANDALONE + SFX_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE + STING_SFX_INTERACTION_ALLOWANCE;
      assert.equal(
        delta,
        expected,
        `${mapper.name}: a live Sting and a live SFX together cost ${delta} bytes (${without.codeBytes} -> ` +
          `${both.codeBytes}), but the sum of all four terms reserves ${expected} — the shared term must be ` +
          'charged exactly once and the interaction term exactly once, never zero times and never twice.'
      );
    }
  }
);

test(
  'dropping only Sting from a project with both live frees STING_KERNEL_ALLOWANCE_STANDALONE + STING_SFX_INTERACTION_ALLOWANCE, not AUDIO_FX_KERNEL_ALLOWANCE too',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = CAPABLE_MAPPERS[0];
    const both = await measureCodeBytes(t, mapper, { withMove: true, withSting: true, withSfx: true });
    const sfxOnly = await measureCodeBytes(t, mapper, { withMove: true, withSfx: true });
    const delta = both.codeBytes - sfxOnly.codeBytes;
    assert.equal(
      delta,
      STING_KERNEL_ALLOWANCE_STANDALONE + STING_SFX_INTERACTION_ALLOWANCE,
      `${mapper.name}: dropping only Sting from a both-live project frees ${delta} bytes, but ` +
        `STING_KERNEL_ALLOWANCE_STANDALONE + STING_SFX_INTERACTION_ALLOWANCE is ` +
        `${STING_KERNEL_ALLOWANCE_STANDALONE + STING_SFX_INTERACTION_ALLOWANCE} — SFX is still live, so the ` +
        'shared AUDIO_FX_KERNEL_ALLOWANCE term must still be charged and must not appear in this delta.'
    );
  }
);

// design-sfx.md §3.12/§7 test 15 -- DECLARED DEVIATION from the design's own
// matrix (see sfx-implementation-report.md for the full account, including
// its own code-review-round-1 correction note). The design estimated
// SFX_KERNEL_ALLOWANCE_STANDALONE at 283 and predicted two rows as FIT
// controls on that estimate: MMC1 Save+Move-no-item (a razor-thin +1 free)
// and MMC3 ALL-7-verbs-only-no-Save/Move-w/-item with Sting already live
// (+205 free). The real, measured figure is 295 (12 bytes higher --
// main/build/generate.js's own comment on SFX_KERNEL_ALLOWANCE_STANDALONE
// has the full measurement). That correctly moves ONE of the design's two
// predicted fit controls into a real refusal: MMC1 Save+Move-no-item, a
// genuine 31-byte deficit with SFX alone (this row legitimately carries a
// title screen, since it has a live Save command).
//
// **The other one — MMC3's own ALL-7-only-w/-item row with both Sting and
// SFX live — does not actually flip, and code review round 1's finding 3
// caught why: the fixture below used to force a title screen onto every
// row unconditionally, including this one and the two ALL-7+Move+item-no-
// Save refusals just below, none of which has a live Save command or any
// other reason to carry a title at all** (handoff-costing/costing-
// report.md's own Part 1 table is a set of deltas from its "no Save/Move,
// no title, w/ item" baseline). A forced title costs a real, uncredited
// ~224 bytes (TITLE_KERNEL_ALLOWANCE_BY_MAPPER on MMC3) that has nothing to
// do with SFX. Corrected: `assertSfxRefusal` now takes a `noTitle` option,
// passed for every row whose own name does not include Save. With it, the
// two ALL-7+Move+item-no-Save rows (MMC3, UNROM 512) remain genuinely
// refused -- smaller, real deficits (41 and 42 bytes short, not the
// previous inflated figures) -- but the both-live control now FITS, exactly
// as the design originally predicted, restored below as its own dedicated
// test rather than kept as a wrong refusal.
//
// Construction note: each remaining refusal row below combines its
// row-defining commands (Save/Move/the seven shipped verbs) onto one placed
// actor's own event page -- mirroring saveAndMoveEvent's existing precedent
// -- with SFX (and Sting, where the row calls for it) authored onto a
// second, separate placed actor -- mirroring the existing Sting
// documented-limitation test's own convention of pushing a second entity
// beside saveAndMoveEvent(). This does not reproduce handoff-costing/
// costing-report.md's Part 1 rows byte-for-byte (an extra placed entity
// costs its own few bytes of screen table data a single-entity construction
// would not -- though empirically, for the both-live row, this difference
// turned out to be negligible: both constructions produced identical
// need/free figures once the title bug above was the only thing actually
// separating them from Part 1's own row), so the exact "need N / free M"
// figures asserted below are this construction's own real, measured
// numbers, not Part 1's -- what is being confirmed is the verdict (refused,
// and why) against a real checkCapacity() run, not a reproduction of an
// unrelated report's own byte count.

function allSevenVerbsCommands() {
  return [
    { op: 'turn', who: 'self', dir: 'up' },
    { op: 'wait', frames: 10 },
    { op: 'shake', frames: 10 },
    { op: 'visible', state: 'hidden' },
    { op: 'visible', state: 'shown' },
    { op: 'fade', dir: 'out' },
    { op: 'flash' }
  ];
}

function commandsEvent(commands, x = 16, y = 16) {
  return { actorId: 0, x, y, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } };
}

function sfxCommandEvent(project, x = 80, y = 80) {
  if (!project.sfx?.length) project.sfx = [{ name: 'Boop', volume: 10, steps: [{ note: 5, duration: 4 }] }];
  return commandsEvent([{ op: 'sfx', sfx: 0 }], x, y);
}

/**
 * Builds `sample-rpg` on `mapper` with `rowCommands` on one placed actor,
 * plus a live SFX command on a second (and, if `withSting`, a live Sting on
 * a third) -- confirms checkCapacity() refuses it, that the refusal names
 * "Play a sound effect" with its real freed-byte figure, and that dropping
 * just the SFX command is a real, buildable fix (an actual nesasm build,
 * not only the JS-side prediction), the identical discipline the existing
 * Sting/bound-tile documented-limitation tests already hold themselves to.
 *
 * `noTitle` (code review round 1, finding 3): a title screen used to be
 * forced on unconditionally here, for every row, including ones whose own
 * named `handoff-costing/costing-report.md` Part 1 baseline never carried
 * one -- every row in that report is a delta from its own "no Save/Move, no
 * title, w/ item" baseline, and only a live Save command actually requires
 * one (validateProject). Forcing a title onto a title-free row adds a real,
 * uncredited ~224-byte cost (TITLE_KERNEL_ALLOWANCE_BY_MAPPER on MMC3) that
 * has nothing to do with SFX at all -- pass `noTitle: true` for any row
 * whose name does not include Save.
 */
async function assertSfxRefusal(t, mapperId, rowCommands, { noItem = false, withSting = false, noTitle = false, mapperLabel } = {}) {
  const project = await loadProject(SAMPLE_RPG);
  // Naming off explicitly (phase 5): these documented-limitation rows are
  // CLAUDE.md's own pinned figures, computed clean of sample-rpg's own
  // naming, which now opts in for real.
  project.party[0].renamable = false;
  if (project.party[1]) project.party[1].renamable = false;
  project.cartridge.mapper = mapperId;
  if (noTitle) {
    project.project.titleMap = null;
  } else {
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
  }
  if (noItem) project.items = [];
  if (rowCommands.length) project.maps[0].screens[0].entities.push(commandsEvent(rowCommands));
  if (withSting) {
    project.songs = [createSong('Fanfare')];
    project.maps[0].screens[0].entities.push(commandsEvent([{ op: 'sting', song: 0 }], 96, 96));
  }
  project.maps[0].screens[0].entities.push(sfxCommandEvent(project));

  const message = kernelShortfallMessage(project);
  assert.match(
    message,
    new RegExp(`every Play a sound effect command \\(frees ${SFX_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE + (withSting ? STING_SFX_INTERACTION_ALLOWANCE - AUDIO_FX_KERNEL_ALLOWANCE : 0)} bytes\\)`),
    `${mapperLabel}: the refusal should name Play a sound effect and its real freed-byte figure -- got: ${message}`
  );

  const droppedSfx = structuredClone(project);
  droppedSfx.maps[0].screens[0].entities.pop();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-limitation-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, droppedSfx);
  const built = await buildProject({ dir, project: droppedSfx, log: () => {} });
  assert.ok(built.romPath, `${mapperLabel}: dropping the SFX command alone should still be a real fix`);
}

// DEVIATION, review-fixes slice C, item 12: this row does not go through
// assertSfxRefusal any more. Item 12's own base growth (+15/board,
// unconditional) already pushes MMC3 Save+Move-no-item 8 bytes over budget
// with no SFX live at all (the identical finding the Sting documented-
// limitation test above now records) -- so SFX no longer "reaches" a
// previously-fitting row, it lands on one that was already refused, and
// SFX_KERNEL_ALLOWANCE_STANDALONE's own 295-byte allowance is not what the
// message names any more (Move/Save, both larger, are). Kept as its own
// test, inline rather than through the shared helper, because the helper's
// assertion (SFX must be named) is still correct for every other row that
// calls it (45-49 below) and must not be weakened for all of them to
// accommodate this one row's own now-different reality.
test(
  'sample-rpg with Save, Move (no item) and a live SFX does not build on MMC3 -- the already-known documented limitation, now also reached by SFX',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    // Naming off explicitly (phase 5): this documented-limitation figure is
    // CLAUDE.md's own pinned number, computed clean of sample-rpg's own
    // naming, which now opts in for real.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.items = [];
    project.maps[0].screens[0].entities.push(
      commandsEvent([{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }])
    );
    project.maps[0].screens[0].entities.push(sfxCommandEvent(project));

    const message = kernelShortfallMessage(project);
    assert.match(message, /every Move command \(frees \d+ bytes\)/, 'the refusal should offer dropping Move');
    assert.match(message, /every Save command \(frees \d+ bytes\)/, 'the refusal should offer dropping Save');
    assert.doesNotMatch(
      message,
      /sound effect/,
      'SFX alone no longer closes this row -- the baseline is already over budget without it, so offering ' +
        'it here would be advice that does not actually work'
    );

    // Dropping SFX alone is NOT a real fix any more.
    const droppedSfx = structuredClone(project);
    droppedSfx.maps[0].screens[0].entities.pop();
    const dirSfx = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-limitation-mmc3-'));
    t.after(() => fsp.rm(dirSfx, { recursive: true, force: true }));
    await saveProject(dirSfx, droppedSfx);
    await assert.rejects(
      buildProject({ dir: dirSfx, project: droppedSfx, log: () => {} }),
      'dropping only the SFX command should still fail to build -- this row is now over budget with no SFX ' +
        'live at all'
    );

    // Move ALONE -- Save stays live -- (one of the two fixes actually
    // offered above) is a real fix.
    const droppedMove = dropCommand(project, 'move');
    const dirMove = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-limitation-move-'));
    t.after(() => fsp.rm(dirMove, { recursive: true, force: true }));
    await saveProject(dirMove, droppedMove);
    const built = await buildProject({ dir: dirMove, project: droppedMove, log: () => {} });
    assert.ok(built.romPath, 'dropping Move (with SFX still live) should be a real fix');
  }
);

test(
  'sample-rpg with Save, Move and its one live item does not build on MMC1 once a live SFX is added -- newly refused, per SFX_KERNEL_ALLOWANCE_STANDALONE\'s own real measurement',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 1, [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }], { mapperLabel: 'MMC1' });
  }
);

// DECLARED DEVIATION (see the section comment above): the design predicted
// this exact row -- MMC1 Save+Move-no-item -- as a razor-thin FIT control at
// its own 298-byte estimate (+1 free). The real, measured
// SFX_KERNEL_ALLOWANCE_STANDALONE (295, not 283) moves the real marginal
// cost to 310, which refuses this row too (a real, measured 31-byte
// deficit) -- so this test asserts the real outcome, a sixth refusal, in
// place of the design's own now-superseded fit-control test.
test(
  'sample-rpg with Save and Move, no item, does not build on MMC1 once a live SFX is added -- DEVIATION: the design predicted this row as a +1 fit control at its own 283-byte SFX estimate; the real, measured 295-byte figure refuses it instead',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 1, [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noItem: true,
      mapperLabel: 'MMC1'
    });
  }
);

test(
  'sample-rpg with every shipped verb, Move and its one live item, no Save, does not build on MMC3 once a live SFX is added',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 4, [...allSevenVerbsCommands(), { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noTitle: true,
      mapperLabel: 'MMC3'
    });
  }
);

test(
  'sample-rpg with a live Save command and its one live item does not build on UNROM 512 once a live SFX is added',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 30, [{ op: 'save' }], { mapperLabel: 'UNROM 512' });
  }
);

test(
  'sample-rpg with every shipped verb, Move and its one live item, no Save, does not build on UNROM 512 once a live SFX is added',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 30, [...allSevenVerbsCommands(), { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noTitle: true,
      mapperLabel: 'UNROM 512'
    });
  }
);

// DECLARED DEVIATION (see the section comment above): assertSfxRefusal's own
// contract -- dropping SFX alone is always a real, buildable fix -- no longer
// holds for this one row. Item 11's re-measurement moved
// BASE_KERNEL_CODE_BYTES_BY_MAPPER[1] from 5954 to 6007 (entity_animation and
// draw_actor_icon both needed a 16-bit pointer where an 8-bit actor*4 used to
// silently wrap at actor id 64), which raises this row's real deficit from
// 283 to 336 -- 36 bytes past what dropping SFX alone frees here (300:
// SFX_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE +
// STING_SFX_INTERACTION_ALLOWANCE - AUDIO_FX_KERNEL_ALLOWANCE, unchanged by
// this slice). Verified against a real checkCapacity() run, not a re-derived
// formula: the refusal now names Move (395) or Save (555 -- 552 before name
// entry phase 1's own +3 to SAVE_KERNEL_ALLOWANCE_BY_MAPPER[1], see the
// comment above the two message tests near this file's Save/Move choice
// tests), never SFX, and dropping Move alone (Save's own event keeps its
// `save` command) is confirmed as a real, buildable fix in its place.
test(
  'sample-rpg with Save, Move and its one live item does not build on MMC1 with a live Sting AND a live SFX together -- DEVIATION: item 11\'s base re-measurement means dropping SFX alone no longer closes this one, only Move or Save does',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    // Naming off explicitly (phase 5): this documented-limitation figure is
    // CLAUDE.md's own pinned number, computed clean of sample-rpg's own
    // naming, which now opts in for real.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 1;
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.maps[0].screens[0].entities.push(
      commandsEvent([{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }])
    );
    project.songs = [createSong('Fanfare')];
    project.maps[0].screens[0].entities.push(commandsEvent([{ op: 'sting', song: 0 }], 96, 96));
    project.maps[0].screens[0].entities.push(sfxCommandEvent(project));

    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      /removing every Move command \(frees 395 bytes\) or every Save command \(frees 555 bytes\)/,
      `MMC1: dropping Move or Save, not SFX, should be the offered fix once the deficit exceeds what SFX alone frees -- got: ${message}`
    );
    assert.doesNotMatch(
      message,
      /Play a sound effect/,
      'SFX alone no longer frees enough to close this particular deficit, so it must not be offered as a solo fix'
    );

    // Dropping Move alone (Save's own command stays in the same event) is
    // still a real, buildable fix -- the refusal is accurate, not merely
    // differently worded.
    const droppedMove = structuredClone(project);
    const saveMoveEntity = droppedMove.maps[0].screens[0].entities.at(-3); // pushed first of the three appended above
    saveMoveEntity.props.event.pages[0].commands = saveMoveEntity.props.event.pages[0].commands.filter((c) => c.op !== 'move');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-sting-limitation-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, droppedMove);
    const built = await buildProject({ dir, project: droppedMove, log: () => {} });
    assert.ok(built.romPath, 'MMC1: dropping Move should be a real fix once SFX alone no longer is');
  }
);

// CORRECTED, code review round 1 finding 3 (annotates, does not silently
// replace, the "DECLARED DEVIATION" this test used to be -- see
// sfx-implementation-report.md's own §3 correction note for the full
// account). The previous version of this test built its "both-live" row
// with a title screen forced on unconditionally -- the same shape every
// other assertSfxRefusal-based row in this file uses -- but
// handoff-costing/costing-report.md's own MMC3 "ALL 7 shipped verbs only,
// no Save/Move, w/ item" row (+668 signed-free, the row this control is
// named after) is a delta from that report's own "no Save/Move, no title,
// w/ item" baseline: no live Save command means no title is required
// (validateProject) and none was ever part of the row being measured.
// Forcing one on added a real, uncredited ~224-byte cost
// (TITLE_KERNEL_ALLOWANCE_BY_MAPPER on MMC3) that produced the previous
// "51-byte deficit" — a real number, but for a different, title-bearing
// project than the one named.
//
// Verified directly, both ways the review asked for (per the brief's own
// item 3): a title-free reconstruction FITS regardless of whether the row's
// commands sit on one placed actor (the shape the named Part 1 row
// describes) or split across separate ones (assertSfxRefusal's own shape,
// used everywhere else in this file) -- real checkCapacity() output:
//
//   single event,   titleMap=0:    need 129, free  78  -- REFUSED (the old, title-inflated figure)
//   single event,   titleMap=null: FITS
//   separate actors, titleMap=0:    need 129, free  78  -- REFUSED (identical to the single-event figure --
//                                                           confirms entity placement was never the variable)
//   separate actors, titleMap=null: FITS
//
// So the reviewer's conclusion (the both-live control fits) is confirmed,
// but its proposed mechanism (single-event vs. separate-actor placement)
// is not what actually explains the previous refusal -- the title screen
// is. There is consequently no separate, valid "additional documented
// limitation" to keep from the old separate-actor construction (the brief's
// own fallback, item 3): once the title bug is fixed, that shape fits too,
// confirmed above, so nothing about placing these commands on separate
// actors is itself a real capacity limitation in this row. The old refusal
// test is replaced outright rather than kept and relabeled.
test(
  'sample-rpg with every shipped verb and its one live item, no Save/Move, still builds on MMC3 with a live Sting AND a live SFX together, single event -- restores the named both-live fit control',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    // Naming off explicitly (phase 5): this fit control is CLAUDE.md's own
    // pinned figure, computed clean of sample-rpg's own naming, which now
    // opts in for real.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = null; // no Save live -- matches the named row's own Part 1 baseline exactly
    project.songs = [createSong('Fanfare')];
    project.sfx = [{ name: 'Boop', volume: 10, steps: [{ note: 5, duration: 4 }] }];
    // Single event, per the review's own "one event carrying the live
    // command set" reconstruction -- every command on one placed actor.
    project.maps[0].screens[0].entities.push(
      commandsEvent([...allSevenVerbsCommands(), { op: 'sting', song: 0 }, { op: 'sfx', sfx: 0 }])
    );

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-bothlive-fits-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'the named both-live fit control must still build once the title-screen fixture bug is corrected');
  }
);

// A real fits-with-SFX-live control, replacing the two the design's own
// estimate predicted but real measurement refused (above): sample-rpg as
// checked in -- no Save, no Move, no title, its one live item still in
// place -- plus a live SFX command and nothing else. This is the baseline
// isolation test 9 above already measures the delta against, so it is
// already known to fit (assertCovers passes there); this test additionally
// confirms it as a real, buildable ROM rather than only a kernelCodeBytes
// prediction, on the board with the least headroom of the three
// (MMC3, per BASE_KERNEL_CODE_BYTES_BY_MAPPER).
test(
  'sample-rpg with its one live item and a live SFX and nothing else still builds on MMC3 -- a fits control',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = null;
    project.maps[0].screens[0].entities.push(sfxCommandEvent(project));

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-fits-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'a comfortably margined row must still build once a live SFX is added');
  }
);

// ------------------------------------------------------------- Bound tiles
// design-tile.md §7/§8/§9. Unlike Move/Sting, a bound tile is authored screen
// data, not an event command -- it adds no dialogue, event or title content
// of its own, so it never turns projectUsesText (and so fontBankSplit) on by
// itself: on sample-rpg, projectUsesText is already true unconditionally
// (gameType === 'rpg'), and on a fresh action project a bound tile alone
// still leaves it false. There is therefore no split-term dependency to
// isolate against here the way Move/Sting both need -- a bare baseline is
// the correct isolation, the same one ITEM_KERNEL_ALLOWANCE's own
// measurement already uses.
//
// bound_row_lo/bound_row_hi (the 15+15-entry table BOUND_TILE_ENABLED emits
// into metatiles.inc) live in the *pre-reset* portion of the kernel-lo bank
// -- the lookup tables measureCodeBytes deliberately strips out via the
// reset symbol's own address -- so they are counted by kernelTableBytes'
// own fixedBytes term, not by this delta at all; only code from
// bound_tile_lookup/rebuild_bound_cache/tile_switch_changed/
// queue_or_defer_flip/flip_cell_blocked/flip_emit/flip_emit_packet/flip_tick
// and their .if BOUND_TILE_ENABLED call sites shows up here.
test(
  'BOUND_TILE_KERNEL_ALLOWANCE covers the real, isolated cost of a live bound tile exactly, on every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAPABLE_MAPPERS) {
      const without = await measureCodeBytes(t, mapper, {});
      const withBound = await measureCodeBytes(t, mapper, { withBoundTiles: true });
      const delta = withBound.codeBytes - without.codeBytes;
      assert.equal(
        delta,
        BOUND_TILE_KERNEL_ALLOWANCE,
        `${mapper.name}: a live bound tile costs ${delta} bytes of kernel code (${without.codeBytes} -> ` +
          `${withBound.codeBytes}), but BOUND_TILE_KERNEL_ALLOWANCE reserves ${BOUND_TILE_KERNEL_ALLOWANCE} — ` +
          'this allowance must equal the real cost exactly, on every board. Re-measure and correct it.'
      );
    }
  }
);

// design-tile.md §9's own new documented-limitation ledger paragraph: MMC3
// Save+Move-no-item used to have 88 bytes free (CLAUDE.md's own documented
// figure, the row Sting's own documented limitation already lands on) --
// BOUND_TILE_KERNEL_ALLOWANCE plus the fixed/table terms a bound tile also
// carries (design-tile.md §8's own occupancy accounting) exceeded that by a
// wide margin, so a live bound tile on this exact configuration was a clean
// NO FIT, the same shape as Sting's own refusal a few tests up.
//
// DEVIATION, review-fixes slice C, item 12: the baseline itself moved.
// Item 12's own base growth (+15/board, unconditional) already pushes this
// exact row 8 bytes over budget with no bound tile live at all (the
// identical finding the Sting and SFX documented-limitation tests above now
// record) -- so a live bound tile here is landing on an already-refused row,
// not creating one. Its own allowance (420 bytes) is no longer even the
// dominant single-command fix, and does not clear the deficit alone: only
// Save (557 bytes) does. Dropping Move alone (with the bound tile still
// live) does not fix it either -- 395 bytes is short of what this
// particular deficit needs once the bound tile's own real occupancy cost
// (code, the fixed row table and the per-screen pointer table together,
// design-tile.md §8) is added on top.
test(
  'sample-rpg with Save, Move (no item) and a live bound tile does not build on MMC3 -- a documented limitation',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    // Naming off explicitly (phase 5): this documented-limitation figure is
    // CLAUDE.md's own pinned number, computed clean of sample-rpg's own
    // naming, which now opts in for real.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.items = []; // isolate the no-item row this refusal actually lands on
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    const paintedId = project.maps[0].screens[0].metatiles[0];
    project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: paintedId }];

    const message = kernelShortfallMessage(project);
    // Save only: neither the bound tile's own allowance nor Move alone
    // clears this deficit any more -- see the header comment above.
    assert.match(message, /every Save command \(frees \d+ bytes\)/, 'the refusal should offer dropping Save');
    assert.doesNotMatch(
      message,
      /switch-bound tile/,
      'the bound tile\'s own allowance no longer closes this row alone -- offering it here would be advice ' +
        'that does not actually work'
    );
    assert.doesNotMatch(
      message,
      /every Move command/,
      'Move alone does not close this row either, once the bound tile\'s own real occupancy is added on top'
    );

    // Dropping the bound tile alone is NOT a real fix any more.
    const droppedBound = structuredClone(project);
    droppedBound.maps[0].screens[0].boundTiles = [];
    const dirBound = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-limitation-mmc3-'));
    t.after(() => fsp.rm(dirBound, { recursive: true, force: true }));
    await saveProject(dirBound, droppedBound);
    await assert.rejects(
      buildProject({ dir: dirBound, project: droppedBound, log: () => {} }),
      'dropping only the bound tile should still fail to build -- this row is now over budget with no bound ' +
        'tile live at all'
    );

    // Save (the one fix the message above actually offers) is a real fix.
    const droppedSave = dropCommand(project, 'save');
    const dirSave = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-limitation-save-'));
    t.after(() => fsp.rm(dirSave, { recursive: true, force: true }));
    await saveProject(dirSave, droppedSave);
    const built = await buildProject({ dir: dirSave, project: droppedSave, log: () => {} });
    assert.ok(built.romPath, 'dropping Save (with the bound tile still live) should be a real fix');
  }
);

// design-tile.md §9: MMC1 Save+Move+item is the one RPG-capable-board
// configuration comfortable enough (195 bytes free, per this file's own
// Save+Move+item narrative) to absorb everything else measured against it --
// until a bound tile is added on top, per the design's own occupancy
// accounting.
test(
  'sample-rpg with Save, Move and its one live item does not build on MMC1 once a bound tile is added -- a documented limitation',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    // Naming off explicitly (phase 5): this documented-limitation figure is
    // CLAUDE.md's own pinned number, computed clean of sample-rpg's own
    // naming, which now opts in for real.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 1; // MMC1
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    const paintedId = project.maps[0].screens[0].metatiles[0];
    project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: paintedId }];

    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      new RegExp(`every switch-bound tile \\(frees \\d+ bytes\\)`),
      'the refusal should name switch-bound tiles as one of its droppable fixes'
    );

    const droppedBound = structuredClone(project);
    droppedBound.maps[0].screens[0].boundTiles = [];
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-limitation-mmc1-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, droppedBound);
    const built = await buildProject({ dir, project: droppedBound, log: () => {} });
    assert.ok(built.romPath, 'dropping the bound tile should still be a real fix, leaving Save+Move+item to build as before');
  }
);

// ---------------------------------------------------------------------------
// In-game party-member naming (docs/design-name-entry.md §4/§8/§11 -- phase 3,
// "the gated engine core"). The kernel-lo half of the 21-point isolation
// matrix (§11): rows 4-15 (RPG, per-board deltas), the RPG half of 16-18
// (the worst-case build), and the action-side deltas D8 adds. The banked half
// (rows 1-3, 19-21, the banked half of 16-18) lives in bankedbytes.test.js.

// Every supported board hosts an action project -- there is no gameType
// restriction on the action side the way rpgCapable() restricts the RPG
// side, so this is simply every registered mapper (P2, phase 3 fix round 3):
// NROM 0, UxROM 2, CNROM 3, MMC1 1, MMC3 4, GxROM 66, Color Dreams 11, UNROM
// 512 30. switchableMappers will offer any of the four previously omitted
// here (UxROM, CNROM, GxROM, Color Dreams) to a naming-only action project,
// so leaving them out of this suite would leave real, offered boards
// unchecked.
const ACTION_CAPABLE_MAPPERS = SUPPORTED_MAPPERS;
// The measured/fallback split BASE_KERNEL_CODE_BYTES_BY_MAPPER itself
// already makes (mirrors FALLBACK_MAPPERS above): only NROM, MMC1, MMC3 and
// UNROM 512 have a real measured base entry. The other four fall back to the
// largest measured figure (6217) -- known safe by construction, but not by
// how much, so the whole-bank absolute check below holds them to the
// "margin >= KERNEL_SLACK, no upper band" idiom the existing fallback-base
// test above already uses, not the full [KERNEL_SLACK, 2*KERNEL_SLACK] band
// a real measured base earns.
const ACTION_MEASURED_MAPPERS = ACTION_CAPABLE_MAPPERS.filter((m) => m.id in BASE_KERNEL_CODE_BYTES_BY_MAPPER);
const ACTION_FALLBACK_MAPPERS = ACTION_CAPABLE_MAPPERS.filter((m) => !(m.id in BASE_KERNEL_CODE_BYTES_BY_MAPPER));

test(
  'in-game naming: rows 4-15 -- N, H, J and HT triangulated from real nesasm deltas on every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAPABLE_MAPPERS) {
      const off = await measureCodeBytes(t, mapper, { withTitle: true });
      const join = await measureCodeBytes(t, mapper, { withTitle: true, withJoinNaming: true });
      const hero = await measureCodeBytes(t, mapper, { withTitle: true, withHeroNaming: true });
      const both = await measureCodeBytes(t, mapper, { withTitle: true, withHeroNaming: true, withJoinNaming: true });
      const heroTitleless = await measureCodeBytes(t, mapper, { withTitle: false, withHeroNaming: true });
      const offTitleless = await measureCodeBytes(t, mapper, { withTitle: false });

      const deltaJoin = join.codeBytes - off.codeBytes; // N + J
      const deltaHero = hero.codeBytes - off.codeBytes; // N + H
      const deltaBoth = both.codeBytes - off.codeBytes; // N + H + J
      const n = deltaJoin + deltaHero - deltaBoth;
      const h = deltaHero - n;
      const j = deltaJoin - n;
      const deltaHeroTitleless = heroTitleless.codeBytes - offTitleless.codeBytes; // N + H + HT
      const ht = deltaHeroTitleless - deltaHero;

      assert.equal(n, NAME_ENTRY_KERNEL_ALLOWANCE, `${mapper.name}: NAME_ENTRY_KERNEL_ALLOWANCE triangulated to ${n}`);
      assert.equal(h, HERO_NAMING_KERNEL_ALLOWANCE, `${mapper.name}: HERO_NAMING_KERNEL_ALLOWANCE triangulated to ${h}`);
      assert.equal(j, JOIN_NAMING_KERNEL_ALLOWANCE, `${mapper.name}: JOIN_NAMING_KERNEL_ALLOWANCE triangulated to ${j}`);
      assert.equal(
        ht,
        HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE,
        `${mapper.name}: HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE triangulated to ${ht}`
      );

      assertCovers({ mapper, codeBytes: both.codeBytes }, kernelCodeBytes(both.project, mapper), 'hero+join naming, titled');
    }
  }
);

/**
 * Builds `project` exactly as given -- no fixture defaults, no forced title,
 * no toggle normalization -- into a fresh mkdtemp directory on `mapper`, and
 * returns the real kernel-lo code-byte usage the same way measureCodeBytes
 * does. Unlike measureCodeBytes, this takes a project object directly (not a
 * fixture path plus a set of `with*` flags) so a caller can hand it the
 * checked-in fixture completely unmodified, or a real `projectWithout*`
 * helper's own output, and know nothing else about the project changed.
 */
async function measureProjectCodeBytes(t, project, mapper) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelbytes-real-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const variant = { ...project, cartridge: { ...project.cartridge, mapper: mapper.id } };
  await saveProject(dir, variant);
  const lines = [];
  const built = await buildProject({ dir, project: variant, log: (line) => lines.push(line) });

  const { kernelLoBank } = prgLayout(mapper);
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  assert.ok(Number.isFinite(used) && used > 0, `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`);

  assert.ok(built.symbolPath, `${mapper.name}: nesasm should have written a symbol file`);
  const symbols = await fsp.readFile(built.symbolPath, 'utf8');
  const resetMatch = symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m);
  assert.ok(resetMatch, `${mapper.name}: reset should be a named symbol in game.fns`);
  const resetAddr = parseInt(resetMatch[1], 16);
  return used - (resetAddr - 0xc000);
}

// Item 5 (phase 5, docs/design-name-entry.md v16.4 §17 item 5) closes the
// design's own §15 phase-4 delta test: the real fixture AS SHIPPED (naming
// live for real, not a synthetic measureCodeBytes toggle) against the real
// exported projectWithoutHeroNaming/projectWithoutJoinNaming helpers applied
// to it, on real assembled ROMs -- not the static kernelCodeBytes() formula,
// and not measureCodeBytes' own flag-driven reconstruction, which this test
// exists to cross-check rather than duplicate.
test(
  'phase 5: sample-rpg as shipped (hero+Join naming both live for real) vs. projectWithoutHeroNaming/' +
    'projectWithoutJoinNaming applied to it -- real assembled ROMs, every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const shipped = await loadProject(SAMPLE_RPG);
    assert.ok(projectUsesHeroNaming(shipped), 'sample-rpg should carry hero naming live as shipped');
    assert.ok(projectUsesJoinNaming(shipped), 'sample-rpg should carry Join naming live as shipped');

    for (const mapper of CAPABLE_MAPPERS) {
      const shippedBytes = await measureProjectCodeBytes(t, shipped, mapper);
      const withoutHero = await measureProjectCodeBytes(t, projectWithoutHeroNaming(shipped), mapper);
      const withoutJoin = await measureProjectCodeBytes(t, projectWithoutJoinNaming(shipped), mapper);

      // sample-rpg ships titleless (project.project.titleMap === null), so
      // removing hero naming from it pays HERO_NAMING_TITLELESS_KERNEL_
      // ALLOWANCE too (§11's own titleless surcharge) -- not
      // HERO_NAMING_KERNEL_ALLOWANCE alone, which is the titled-only figure
      // the "rows 4-15" test above measures against a synthetic titled
      // variant.
      assert.equal(
        shippedBytes - withoutHero,
        HERO_NAMING_KERNEL_ALLOWANCE + HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE,
        `${mapper.name}: removing hero naming from the real (titleless) shipped fixture should free exactly ` +
          'HERO_NAMING_KERNEL_ALLOWANCE + HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE'
      );
      assert.equal(
        shippedBytes - withoutJoin,
        JOIN_NAMING_KERNEL_ALLOWANCE,
        `${mapper.name}: removing Join naming from the real shipped fixture should free exactly JOIN_NAMING_KERNEL_ALLOWANCE`
      );
    }
  }
);

// The action-side twin, against sample/ as shipped: hero naming AND the Say
// token are both live for real (the slime's own plain dialogue). Dropping
// the token alone (projectWithoutNameToken) should free the token term plus
// HERO_DEFAULT_KERNEL_ALLOWANCE's own two homes -- the 11-byte copy loop
// (kernelCodeBytes) and the 10-byte table (kernelTableBytes' fixedBytes) --
// UNLESS hero naming is also live, in which case projectNeedsHeroDefault
// stays true regardless and only the flat token allowance is freed. sample's
// own real shipped state has hero naming ON, so this is the latter case --
// verified directly rather than assumed, per the phase-4 handoff's own "58 +
// 11 + 10" figure, which only applies once hero naming is off too.
test(
  'phase 5: sample as shipped (hero naming AND the token both live for real) -- dropping the token alone frees only NAME_TOKEN_KERNEL_ALLOWANCE, because hero naming still needs the default table+loop',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const shipped = await loadProject(SAMPLE);
    assert.ok(projectUsesHeroNaming(shipped), 'sample should carry hero naming live as shipped');
    assert.ok(projectUsesNameToken(shipped), 'sample should carry the {name} token live as shipped');

    const mapper = resolveMapper(shipped.cartridge.mapper);
    const shippedBytes = await measureProjectCodeBytes(t, shipped, mapper);
    const withoutToken = await measureProjectCodeBytes(t, projectWithoutNameToken(shipped), mapper);
    assert.equal(
      shippedBytes - withoutToken,
      NAME_TOKEN_KERNEL_ALLOWANCE,
      `${mapper.name}: with hero naming still live, dropping the token alone should free exactly ` +
        'NAME_TOKEN_KERNEL_ALLOWANCE -- HERO_DEFAULT_KERNEL_ALLOWANCE and its table stay paid for by hero naming'
    );

    // The full "token was the only reason for either" figure DOES apply once
    // hero naming is off too -- confirmed here against the real fixture,
    // composing both strips, rather than only against the synthetic action
    // project kernelbytes.test.js's own counterfactual test already covers.
    const withoutHeroAndToken = await measureProjectCodeBytes(
      t,
      projectWithoutNameToken(projectWithoutHeroNaming(shipped)),
      mapper
    );
    const withoutHeroOnly = await measureProjectCodeBytes(t, projectWithoutHeroNaming(shipped), mapper);
    assert.equal(
      withoutHeroOnly - withoutHeroAndToken,
      NAME_TOKEN_KERNEL_ALLOWANCE + HERO_DEFAULT_KERNEL_ALLOWANCE,
      `${mapper.name}: with hero naming already off, dropping the token too should additionally free ` +
        'HERO_DEFAULT_KERNEL_ALLOWANCE\'s own copy loop (the 10-byte table lives in kernelTableBytes, not this delta)'
    );

    // P2-3 (fix round 2): the hero-only removal above was built but its own
    // delta from the shipped fixture was never equality-asserted. sample
    // ships titled (project.project.titleMap !== null), an action project
    // with no Join to keep projectUsesNameEntry true once hero naming is
    // gone, so removing it drops all three action-side naming terms at
    // once: NAME_ENTRY_ACTION_KERNEL_ALLOWANCE (the grid's own body, banked
    // on an RPG but kernel-lo here), NAME_ENTRY_KERNEL_ALLOWANCE (the hook
    // glue every naming feature shares) and HERO_NAMING_KERNEL_ALLOWANCE
    // (start_game's own naming arm) -- not HERO_NAMING_TITLELESS_KERNEL_
    // ALLOWANCE, which sample's own title screen never pays.
    assert.equal(
      shippedBytes - withoutHeroOnly,
      NAME_ENTRY_ACTION_KERNEL_ALLOWANCE + NAME_ENTRY_KERNEL_ALLOWANCE + HERO_NAMING_KERNEL_ALLOWANCE,
      `${mapper.name}: removing hero naming from the real (titled) shipped action fixture should free exactly ` +
        'NAME_ENTRY_ACTION_KERNEL_ALLOWANCE + NAME_ENTRY_KERNEL_ALLOWANCE + HERO_NAMING_KERNEL_ALLOWANCE'
    );

    // The other half of the same finding: measureProjectCodeBytes only ever
    // sees code AFTER the reset label (CLAUDE.md's own "a code term and a
    // table term stay in the ledgers they each belong to" rule) -- every
    // fixedBytes term (kernelTableBytes, main/build/generate.js) lives
    // BEFORE reset and so is excluded from every delta above by
    // construction, not merely by coincidence, and the reviewer's own
    // finding was that this exclusion was never verified, only assumed.
    // Direct against kernelTableBytes rather than another nesasm build:
    // dropping hero naming alone (the token still keeps projectUsesNameEntry
    // OFF but projectNeedsHeroDefault ON) frees only the nameentry row of
    // input_actions (BUTTONS.length bytes -- projectUsesNameEntry's own
    // gate); hero_name_default's own table (RPG_LIMITS.nameLength bytes,
    // projectNeedsHeroDefault's gate) is untouched until the token goes too.
    const fixedBytesOf = (project) => kernelTableBytes(project, mapper).fixedBytes;
    const shippedFixed = fixedBytesOf(shipped);
    const withoutHeroOnlyFixed = fixedBytesOf(projectWithoutHeroNaming(shipped));
    const withoutHeroAndTokenFixed = fixedBytesOf(projectWithoutNameToken(projectWithoutHeroNaming(shipped)));
    assert.equal(
      shippedFixed - withoutHeroOnlyFixed,
      BUTTONS.length,
      `${mapper.name}: dropping hero naming alone should free only the nameentry row of input_actions ` +
        '(BUTTONS.length bytes) -- hero_name_default\'s own table stays reserved, since the token still needs it ' +
        '(projectNeedsHeroDefault stays true)'
    );
    assert.equal(
      withoutHeroOnlyFixed - withoutHeroAndTokenFixed,
      RPG_LIMITS.nameLength,
      `${mapper.name}: dropping the token too (hero naming already off) should free hero_name_default's own ` +
        `${RPG_LIMITS.nameLength}-byte table, the one home measureProjectCodeBytes' post-reset delta above ` +
        'cannot see at all'
    );
  }
);

// P1-1's own consequence: the naming grid IS text (shared/font.js's own
// projectUsesText now answers true whenever projectUsesNameEntry does), so a
// naming-only MMC3 action project -- no title, no dialogue, no combat, no
// text source but the grid itself -- must pay SPLIT_KERNEL_ALLOWANCE too.
// createProject, not sample: sample already has dialogue, so its own
// naming-on/off delta never had to include this term (it was already true
// on both sides, cancelling out) -- this is the one isolation that actually
// needs a text-free baseline.
test(
  'in-game naming: SPLIT_KERNEL_ALLOWANCE is charged to a naming-only MMC3 action project (the naming grid IS text)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    async function measure(hero) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-naming-split-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const project = createProject('Naming only MMC3');
      project.cartridge.mapper = 4; // MMC3, the scanline-IRQ board
      if (hero) project.party[0].renamable = true;
      const lines = [];
      const built = await buildProject({ dir, project, log: (line) => lines.push(line) });
      const { kernelLoBank } = prgLayout(SUPPORTED_MAPPERS.find((m) => m.id === 4));
      const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
      const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const resetAddr = parseInt(symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m)[1], 16);
      return { project, codeBytes: used - (resetAddr - 0xc000) };
    }
    const off = await measure(false);
    const on = await measure(true);
    const mapper = SUPPORTED_MAPPERS.find((m) => m.id === 4);
    assert.equal(
      off.codeBytes,
      BASE_KERNEL_CODE_BYTES_BY_MAPPER[4],
      'a text-free, naming-off project should measure exactly the MMC3 base -- nothing else conditional'
    );
    const delta = on.codeBytes - off.codeBytes;
    const expected =
      NAME_ENTRY_KERNEL_ALLOWANCE +
      HERO_NAMING_KERNEL_ALLOWANCE +
      HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE + // createProject's own default has no title
      NAME_ENTRY_ACTION_KERNEL_ALLOWANCE +
      HERO_DEFAULT_KERNEL_ALLOWANCE +
      SPLIT_KERNEL_ALLOWANCE;
    assert.equal(
      delta,
      expected,
      `hero naming on a text-free MMC3 action project should cost every naming term PLUS SPLIT_KERNEL_ALLOWANCE ` +
        `(165) -- got a delta of ${delta}, expected ${expected}. A delta missing exactly 165 would mean ` +
        'projectUsesText never turned on for this project.'
    );
    assertCovers({ mapper, codeBytes: on.codeBytes }, kernelCodeBytes(on.project, mapper), 'naming-only text on MMC3, titleless action');
  }
);

test(
  'in-game naming: rows 16-18 -- naming (hero+join) + title + Save all live, real assembly on the boards it fits',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // MMC1 and MMC3 fit; UNROM 512 does not -- a new, real, documented
    // limitation (its own SAVE_KERNEL_ALLOWANCE_BY_MAPPER entry, 686, is the
    // largest of the three, the identical reason every other Save-adjacent
    // shortfall in this ledger already singles UNROM 512 out), confirmed
    // below rather than silently skipped.
    for (const mapper of CAPABLE_MAPPERS.filter((m) => m.id !== 30)) {
      const entry = await measureCodeBytes(t, mapper, {
        withTitle: true,
        withSave: true,
        withHeroNaming: true,
        withJoinNaming: true
      });
      assertCovers({ mapper, codeBytes: entry.codeBytes }, kernelCodeBytes(entry.project, mapper), 'naming + title + Save (worst case)');
    }

    const u512 = CAPABLE_MAPPERS.find((m) => m.id === 30);
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = 30;
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.party[0].renamable = true;
    if (project.party[1]) project.party[1].renamable = true;
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
    });
    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      /every named Join \(frees \d+ bytes\)/,
      `${u512.name}: naming + title + Save should refuse, offering "every named Join" as one real fix`
    );
  }
);

test(
  'in-game naming: NROM base (durable fix) and the action-side absolute check on sample',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const nrom = ACTION_CAPABLE_MAPPERS.find((m) => m.id === 0);
    assert.ok(nrom, 'NROM should be a supported mapper');
    assert.equal(
      baseKernelCodeBytes(nrom),
      5952,
      'BASE_KERNEL_CODE_BYTES_BY_MAPPER should have a real, measured NROM entry now, not the UNROM 512 fallback'
    );

    // sample (NROM, titled) with hero naming: the one action board with real
    // margin -- assertCovers is meaningful here because checkCapacity does
    // not refuse this build.
    const entry = await measureCodeBytes(t, nrom, { fixture: SAMPLE, withHeroNaming: true });
    assertCovers({ mapper: nrom, codeBytes: entry.codeBytes }, kernelCodeBytes(entry.project, nrom), 'hero naming on sample, NROM');

    // The three small, save-capable action fixtures (each already carries a
    // live Save command, unlike sample itself) with hero naming added do not
    // fit at all -- the documented limitation §11 predicts (mmc1 -45, mmc3
    // -244, u512 -412 against the design's own static count; real, measured
    // figures differ slightly but the refusal itself is exact and real).
    // checkCapacity refuses with real advice rather than measureCodeBytes
    // ever reaching nesasm.
    for (const [fixtureName, mapperId] of [
      ['sample-mmc1', 1],
      ['sample-mmc3', 4],
      ['sample-u512', 30]
    ]) {
      const project = await loadProject(path.join(ROOT, fixtureName));
      project.party[0].renamable = true;
      const message = kernelShortfallMessage(project);
      assert.match(
        message,
        /hero naming at the start of a new game \(frees \d+ bytes\)/,
        `${fixtureName} (mapper ${mapperId}): the refusal should offer removing hero naming as a fix`
      );
    }
  }
);

test(
  'in-game naming: the action-side allowance triangulated from sample, identical on every action-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // sample carries a title by default; titled and titleless both isolate
    // the identical NAME_ENTRY_ACTION_KERNEL_ALLOWANCE once N, H, HT (all
    // shared with the RPG placement, measured above) and HERO_DEFAULT_KERNEL_
    // ALLOWANCE (exact by construction -- see its own comment in generate.js)
    // are subtracted out -- there is no toggle, in this phase, that turns any
    // of those on for an action project without also turning the others on.
    for (const mapper of ACTION_CAPABLE_MAPPERS) {
      const off = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withTitle: false });
      const heroTitled = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withTitle: true, withHeroNaming: true });
      const offTitled = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withTitle: true });
      const heroTitleless = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withTitle: false, withHeroNaming: true });

      const deltaTitled = heroTitled.codeBytes - offTitled.codeBytes;
      const deltaTitleless = heroTitleless.codeBytes - off.codeBytes;
      const actionFromTitled = deltaTitled - NAME_ENTRY_KERNEL_ALLOWANCE - HERO_NAMING_KERNEL_ALLOWANCE - HERO_DEFAULT_KERNEL_ALLOWANCE;
      const actionFromTitleless =
        deltaTitleless -
        NAME_ENTRY_KERNEL_ALLOWANCE -
        HERO_NAMING_KERNEL_ALLOWANCE -
        HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE -
        HERO_DEFAULT_KERNEL_ALLOWANCE;
      assert.equal(
        actionFromTitled,
        NAME_ENTRY_ACTION_KERNEL_ALLOWANCE,
        `${mapper.name}: NAME_ENTRY_ACTION_KERNEL_ALLOWANCE (titled path) triangulated to ${actionFromTitled}`
      );
      assert.equal(
        actionFromTitleless,
        NAME_ENTRY_ACTION_KERNEL_ALLOWANCE,
        `${mapper.name}: NAME_ENTRY_ACTION_KERNEL_ALLOWANCE (titleless path) triangulated to ${actionFromTitleless}`
      );
    }
  }
);

// Phase 4 (the Say token, docs/design-name-entry.md §9a/§11): NAME_TOKEN_
// KERNEL_ALLOWANCE isolated on the RPG placement, every RPG-capable board.
// The token's own source on an RPG is party_init's unconditional pc_name
// seed (§8) -- no hero naming needed -- so this isolates cleanly with no
// HERO_DEFAULT_KERNEL_ALLOWANCE riding along, unlike the action-side
// isolation below.
test(
  'phase 4 (Say token): NAME_TOKEN_KERNEL_ALLOWANCE isolated on the RPG placement, every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAPABLE_MAPPERS) {
      const off = await measureCodeBytes(t, mapper, {});
      const on = await measureCodeBytes(t, mapper, { withNameToken: true });
      const delta = on.codeBytes - off.codeBytes;
      assert.equal(
        delta,
        NAME_TOKEN_KERNEL_ALLOWANCE,
        `${mapper.name}: NAME_TOKEN_KERNEL_ALLOWANCE triangulated to ${delta} on the RPG placement (expected ` +
          `NAME_TOKEN_KERNEL_ALLOWANCE alone, ${NAME_TOKEN_KERNEL_ALLOWANCE} -- an RPG needs no ` +
          'HERO_DEFAULT_KERNEL_ALLOWANCE, its own seed is unconditional party_init)'
      );
      assert.ok(on.project && projectUsesNameToken(on.project), 'the mutated fixture should read as token-live');
      assertCovers({ mapper, codeBytes: on.codeBytes }, kernelCodeBytes(on.project, mapper), 'name token live, RPG placement');
    }
  }
);

// The action-side cost: turning the token on for an action project also
// turns projectNeedsHeroDefault on (it is one of that predicate's own two
// disjuncts, docs/design-name-entry.md §8), so the real, measured delta here
// is NAME_TOKEN_KERNEL_ALLOWANCE + HERO_DEFAULT_KERNEL_ALLOWANCE (the
// post-reset copy-loop half of it -- the table's own 10 bytes live in
// kernelTableBytes' fixedBytes, before reset, outside what this delta can
// see), not NAME_TOKEN_KERNEL_ALLOWANCE alone. Written out explicitly so the
// two terms this sum is made of are visible at the assertion itself.
test(
  'phase 4 (Say token): the action-side cost (token + its own hero-default copy loop) triangulated, every action-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const expected = NAME_TOKEN_KERNEL_ALLOWANCE + HERO_DEFAULT_KERNEL_ALLOWANCE;
    for (const mapper of ACTION_CAPABLE_MAPPERS) {
      const off = await measureCodeBytes(t, mapper, { fixture: SAMPLE });
      const on = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withNameToken: true });
      const delta = on.codeBytes - off.codeBytes;
      assert.equal(
        delta,
        expected,
        `${mapper.name}: token-on delta triangulated to ${delta}, expected NAME_TOKEN_KERNEL_ALLOWANCE ` +
          `(${NAME_TOKEN_KERNEL_ALLOWANCE}) + HERO_DEFAULT_KERNEL_ALLOWANCE (${HERO_DEFAULT_KERNEL_ALLOWANCE}) ` +
          `= ${expected}`
      );
    }
  }
);

test(
  'phase 4 (Say token): projectUsesNameToken predicate cases -- live/dead, and the plain-dialogue path (P1-1 round 2)',
  async () => {
    const project = await loadProject(SAMPLE_RPG);
    assert.equal(projectUsesNameToken(project), false, 'the unmutated fixture carries no token');

    // entities[2] on the fixture's first screen is the one entity carrying a
    // real, live Say-bearing event (the recruit's own "I have waited for
    // you..." page).
    const withLive = structuredClone(project);
    withLive.maps[0].screens[0].entities[2].props.event.pages[0].commands.push({ op: 'say', text: 'Hi {name}.' });
    assert.equal(projectUsesNameToken(withLive), true, 'a live Say carrying the token should be detected');

    const withDisabled = structuredClone(withLive);
    const page = withDisabled.maps[0].screens[0].entities[2].props.event.pages[0];
    page.commands[page.commands.length - 1].off = true;
    assert.equal(
      projectUsesNameToken(withDisabled),
      false,
      'a switched-off Say carrying the token must not count -- it is scaffolding the compiler drops'
    );

    // projectWithoutNameToken must clear the token even off allCommands, not
    // only liveCommands -- the removal-candidate discipline kernelShortfallAdvice
    // needs (a later edit could re-enable a currently-dead branch).
    const stripped = projectWithoutNameToken(withDisabled);
    const strippedText = stripped.maps[0].screens[0].entities[2].props.event.pages[0].commands.at(-1).text;
    assert.equal(strippedText.includes('{name}'), false, 'projectWithoutNameToken must strip a token inside a disabled command too');

    // P1-1 round 2: plain dialogue carrying the token, with no authored
    // event to supersede it, must also be detected -- entities[0] on the
    // same screen has no event at all.
    const withDialogue = structuredClone(project);
    withDialogue.maps[0].screens[0].entities[0].props.dialogue = 'Hello {name}.';
    assert.equal(projectUsesNameToken(withDialogue), true, 'plain dialogue carrying the token should be detected');

    // And the identical token in a dialogue field the compiler will never
    // reach (superseded by that same entity's own compiling event) must NOT
    // be detected -- effectiveDialogue's own precedence check.
    const withSupersededDialogue = structuredClone(withLive);
    withSupersededDialogue.maps[0].screens[0].entities[2].props.dialogue = 'Hello {name}.';
    assert.equal(
      projectUsesNameToken(withSupersededDialogue),
      true, // still true -- the entity's own live Say (pushed above) carries it
      'sanity: the entity already has a live token in its event'
    );
    const withOnlySupersededDialogue = structuredClone(project);
    withOnlySupersededDialogue.maps[0].screens[0].entities[2].props.dialogue = 'Hello {name}.';
    assert.equal(
      projectUsesNameToken(withOnlySupersededDialogue),
      false,
      "a token sitting only in a dialogue field the compiler will never reach (this entity's own event already " +
        'compiles a live page) must not count'
    );

    // A token sitting inside a switched-off branch's own then-side is
    // scaffolding the compiler already drops -- the identical liveCommands
    // discipline projectUsesMove already holds to.
    const withBranchedOffToken = structuredClone(project);
    withBranchedOffToken.maps[0].screens[0].entities[2].props.event.pages[0].commands.push({
      op: 'branch',
      cond: { type: 'switchOn', arg: 0, value: 0 },
      off: true,
      then: [{ op: 'say', text: 'Hi {name}.' }],
      else: []
    });
    assert.equal(
      projectUsesNameToken(withBranchedOffToken),
      false,
      'a token inside a switched-off branch must not count'
    );
    withBranchedOffToken.maps[0].screens[0].entities[2].props.event.pages[0].commands.at(-1).off = false;
    assert.equal(
      projectUsesNameToken(withBranchedOffToken),
      true,
      'the identical token becomes live once its branch is switched back on'
    );
  }
);

test(
  'phase 4 (Say token): kernelShortfallAdvice offers "the name token" as a removal candidate',
  async () => {
    // MMC1, Save + Move + Turn + Wait: 38 bytes free before the token (real,
    // nesasm-independent -- checked via kernelCodeBytes/kernelTableBytes
    // directly). Adding a live token deepens that to a 20-byte deficit
    // (58 - 38), and the token alone frees the full 58, so it must be
    // offered as one real solo fix alongside Move/Turn/Wait/Save.
    const project = await loadProject(SAMPLE_RPG);
    // Hero/Join naming off explicitly (phase 5): sample-rpg's own naming is
    // now live for real, and either would already need the name seed
    // (projectNeedsNameSeed) regardless of the token -- this case is about
    // the token alone, and the "38 bytes free" calibration in the comment
    // above assumes a naming-off baseline.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 1;
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
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
                { op: 'save' },
                { op: 'move', who: 'self', dir: 'up', dist: 16 },
                { op: 'turn', who: 'self', dir: 'up' },
                { op: 'wait', frames: 5 },
                { op: 'say', text: 'Hi {name}.' }
              ]
            }
          ]
        }
      }
    });
    const message = kernelShortfallMessage(project);
    assert.match(message, /the name token \(frees \d+ bytes\)/, 'the token should be offered as one real fix');
  }
);

test(
  'phase 4 (Say token): sample (NROM) with hero naming AND the token both live -- the combination §11 asked to have measured, TITLED (sample\'s own real configuration)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const nrom = ACTION_CAPABLE_MAPPERS.find((m) => m.id === 0);
    // withTitle defaults false in measureCodeBytes -- sample itself carries a
    // title, so leaving this implicit measures a project that is NOT the one
    // §11 asked about (round-1 finding). Both configurations are measured and
    // reported; only the titled one is sample's own real shape.
    const titled = await measureCodeBytes(t, nrom, { fixture: SAMPLE, withTitle: true, withHeroNaming: true, withNameToken: true });
    const titleless = await measureCodeBytes(t, nrom, { fixture: SAMPLE, withTitle: false, withHeroNaming: true, withNameToken: true });
    const budget = kernelCodeBytes(titled.project, nrom); // the ledger's own reservation for this exact configuration
    const titlelessBudget = kernelCodeBytes(titleless.project, nrom);
    // bankFree is nesasm's own real free-byte count for the WHOLE kernel-lo
    // bank (pre-reset tables plus post-reset code) -- the "free bank bytes"
    // figure, a different quantity from budget - codeBytes (which compares
    // only the post-reset code half against the ledger's own reservation for
    // that half).
    console.log(
      `sample (NROM), hero naming + token, TITLED: nesasm used ${titled.codeBytes} post-reset bytes, ledger budget ` +
        `${budget}, real free bank bytes ${titled.bankFree}`
    );
    console.log(
      `sample (NROM), hero naming + token, TITLELESS: nesasm used ${titleless.codeBytes} post-reset bytes, ledger ` +
        `budget ${titlelessBudget}, real free bank bytes ${titleless.bankFree}`
    );

    // The real "FITS" check: assertCovers (the real band) AND checkCapacity
    // itself reporting no problem for sample's own real, titled shape --
    // not a bare Number.isFinite on an unlabelled delta.
    assertCovers({ mapper: nrom, codeBytes: titled.codeBytes }, budget, 'hero naming + token, sample, titled (NROM)');
    const { problems } = checkCapacity(titled.project);
    assert.deepEqual(
      problems.filter((p) => p.severity === 'error'),
      [],
      'sample (NROM), hero naming + token, titled -- checkCapacity must report no error: this is the real FITS'
    );
  }
);

// P1-C: the action token isolation (the "triangulated" test above) only ever
// checks nesasm DELTAS, never whether kernelCodeBytes still actually covers
// real usage with the requested per-board margin. This adds that absolute
// coverage, the same measured/fallback split every other whole-board check
// in this file already uses (kernelbytes.test.js's own ACTION_MEASURED_
// MAPPERS/ACTION_FALLBACK_MAPPERS idiom): a full [KERNEL_SLACK, 2*KERNEL_SLACK]
// band on a board with a real measured base, and a bare margin >= KERNEL_SLACK
// (no upper bound) on a board falling back to the largest measured base.
test(
  'phase 4 (Say token): absolute assertCovers with the token live (hero naming off), every action-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of ACTION_MEASURED_MAPPERS) {
      const entry = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withNameToken: true });
      assertCovers({ mapper, codeBytes: entry.codeBytes }, kernelCodeBytes(entry.project, mapper), 'name token live, sample');
    }
    for (const mapper of ACTION_FALLBACK_MAPPERS) {
      const entry = await measureCodeBytes(t, mapper, { fixture: SAMPLE, withNameToken: true });
      const budget = kernelCodeBytes(entry.project, mapper);
      const margin = budget - entry.codeBytes;
      assert.ok(
        margin >= KERNEL_SLACK,
        `${mapper.name} (fallback base), name token live: margin ${margin} is under KERNEL_SLACK`
      );
    }
  }
);

test('phase 4 (Say token): kernelShortfallAdvice\'s counterfactual frees the token term AND the hero-default table+loop, on an action project where the token was the only reason for either', async () => {
  // Pure occupancy arithmetic, no nesasm required -- kernelShortfallAdvice's
  // own `occupancy` helper (kernelCodeBytes + kernelTableBytes' fixedBytes +
  // tableBytes), computed directly here the same way that private function
  // does internally. On sample (action), with the token as the only naming
  // feature live, dropping it must free NAME_TOKEN_KERNEL_ALLOWANCE (58, the
  // code arm) AND all of HERO_DEFAULT_KERNEL_ALLOWANCE's own two homes --
  // the 11-byte copy loop (kernelCodeBytes) and the 10-byte table
  // (kernelTableBytes' fixedBytes) -- because projectNeedsHeroDefault
  // reduces to false once the token is gone too, never summing constants by
  // hand (CLAUDE.md: "Advice prices removals by full counterfactual
  // occupancy... never by summing constants").
  const mapper = ACTION_CAPABLE_MAPPERS.find((m) => m.id === 4); // MMC3
  const project = await loadProject(SAMPLE);
  // Hero naming off explicitly (phase 5): SAMPLE now carries hero naming on
  // for real, which alone already needs projectNeedsHeroDefault regardless
  // of the token -- this test's own premise is "the token was the only
  // reason for either", which requires hero naming to be off.
  project.party[0].renamable = false;
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hi {name}.' }] }] } }
  });
  const occupancy = (proj) => {
    const { fixedBytes, tableBytes } = kernelTableBytes(proj, mapper);
    return kernelCodeBytes(proj, mapper) + fixedBytes + tableBytes;
  };
  const before = occupancy(project);
  const after = occupancy(projectWithoutNameToken(project));
  const expected = NAME_TOKEN_KERNEL_ALLOWANCE + HERO_DEFAULT_KERNEL_ALLOWANCE + RPG_LIMITS.nameLength;
  assert.equal(
    before - after,
    expected,
    `dropping the token should free ${NAME_TOKEN_KERNEL_ALLOWANCE} (token) + ${HERO_DEFAULT_KERNEL_ALLOWANCE} ` +
      `(copy loop) + ${RPG_LIMITS.nameLength} (hero_name_default table, one byte per name-length column) = ` +
      `${expected} bytes total`
  );
});

// P1-A (phase 3 fix round 3, fixed round 4 P2-2): kernelTableBytes' own new
// chrTableBytes term (main/build/generate.js) -- tileset_bank/tileset_lo/
// tileset_hi (assets/chrtables.inc), 3 bytes per chrPayloadRegions() region,
// only on a chrRam board (UNROM 512 today). The original version of this
// test only ever compared nesasm's real delta against a hardcoded literal
// 3/0 -- it never once called kernelTableBytes itself, so a broken MODEL
// (a flat `chrTableBytes = 3` regardless of region count, or a `3 *
// Math.max(1, regions)` floor) could mispredict while nesasm's own real
// output, produced by a different code path entirely, still happened to
// read 3 for a single 1->2 step -- passing the old test outright. Fixed:
// compare the MODEL's own 1->2 AND 2->3 deltas against nesasm's real deltas
// directly. A flat charge predicts a 2->3 model delta of 0 against a real
// delta of 3 and fails here; a `max(1, regions)`-style floor is
// indistinguishable from the correct per-region charge once regions >= 1 on
// every step this test takes, so it is not a distinguishable case for THIS
// term (chrPayloadRegions never returns 0 regions for a chrRam board with
// >=1 tileset) -- the real defect that name describes is caught by the
// flat-charge check above instead. Zero-delta controls on every non-chrRam
// board stay, now checked against the model too.
test(
  "in-game naming: kernelTableBytes' own CHR-RAM streaming-table term -- its own 1->2 AND 2->3 tileset delta matches nesasm's real pre-reset delta exactly, on every board",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    async function measure(mapper, tilesetCount) {
      const project = await loadProject(SAMPLE);
      project.cartridge.mapper = mapper.id;
      while (project.tilesets.length < tilesetCount) project.tilesets.push(createTileset(`Extra ${project.tilesets.length}`));
      project.tilesets.length = tilesetCount;
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-chrtable-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const resetAddr = parseInt(symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m)[1], 16);
      const { fixedBytes, tableBytes } = kernelTableBytes(project, mapper);
      return { real: resetAddr - 0xc000, model: fixedBytes + tableBytes };
    }
    for (const mapper of [SUPPORTED_MAPPERS.find((m) => m.id === 30), ...CAPABLE_MAPPERS]) {
      const one = await measure(mapper, 1);
      const two = await measure(mapper, 2);
      const three = await measure(mapper, 3);
      const expected = mapper.chrRam ? 3 : 0;
      for (const [label, before, after] of [
        ['1->2', one, two],
        ['2->3', two, three]
      ]) {
        const realDelta = after.real - before.real;
        const modelDelta = after.model - before.model;
        assert.equal(
          modelDelta,
          realDelta,
          `${mapper.name}, ${label} tilesets: kernelTableBytes' own predicted delta (${modelDelta}) must equal ` +
            `nesasm's real pre-reset delta (${realDelta}) -- a flat charge or a model that stops tracking real ` +
            'per-tileset region count would mispredict here even while an earlier step happened to match'
        );
        assert.equal(
          realDelta,
          expected,
          `${mapper.name}, ${label} tilesets: adding a tileset should cost ${expected} real pre-reset bytes` +
            (mapper.chrRam ? ' (tileset_bank/tileset_lo/tileset_hi, one more region)' : ' (no CHR-RAM streaming tables on this board)')
        );
      }
    }
  }
);

// P1-A2 fix (phase 3 fix round 3b): metaspriteKernelBytes' own new
// placeholder terms -- going from zero metasprites (or zero animations) to
// one real one (non-empty tiles/frames, so this stays clear of the
// separate, narrower "one entry with an empty tiles/frames array" case --
// see the report) must cost exactly what generateAssets' spriteTables
// really emits. The wrong implementation this catches: "predicts 0 bytes
// for an empty table the generator still emits one byte for" -- the bug
// this round fixed, on every board a naming-only action project can use.
test(
  "in-game naming: metaspriteKernelBytes' own ms_data_0/anim_data_0 placeholder terms -- going from zero metasprites (or zero animations) to one real one costs exactly the real generator bytes, on every action-capable board",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    async function measurePreReset(mapper, { metasprite, animation }) {
      const project = await loadProject(SAMPLE);
      project.cartridge.mapper = mapper.id;
      project.sprites.metasprites = metasprite ? [{ id: 0, name: 'MS', tiles: [{ tile: 1 }] }] : [];
      project.sprites.animations = animation ? [{ id: 0, name: 'Anim', loop: true, frames: [{ metaspriteId: 0 }] }] : [];
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-msplaceholder-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const resetAddr = parseInt(symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m)[1], 16);
      return resetAddr - 0xc000;
    }
    for (const mapper of ACTION_CAPABLE_MAPPERS) {
      const neither = await measurePreReset(mapper, { metasprite: false, animation: false });
      const msOnly = await measurePreReset(mapper, { metasprite: true, animation: false });
      const animOnly = await measurePreReset(mapper, { metasprite: false, animation: true });
      const predictedMsDelta =
        metaspriteKernelBytes({ sprites: { metasprites: [{ id: 0, name: 'MS', tiles: [{ tile: 1 }] }], animations: [], actors: [] } }) -
        metaspriteKernelBytes({ sprites: { metasprites: [], animations: [], actors: [] } });
      const predictedAnimDelta =
        metaspriteKernelBytes({ sprites: { metasprites: [], animations: [{ id: 0, name: 'Anim', loop: true, frames: [{ metaspriteId: 0 }] }], actors: [] } }) -
        metaspriteKernelBytes({ sprites: { metasprites: [], animations: [], actors: [] } });
      assert.equal(
        msOnly - neither,
        predictedMsDelta,
        `${mapper.name}: going from 0 to 1 real metasprite should cost exactly metaspriteKernelBytes' own predicted ${predictedMsDelta} real pre-reset bytes`
      );
      assert.equal(
        animOnly - neither,
        predictedAnimDelta,
        `${mapper.name}: going from 0 to 1 real animation should cost exactly metaspriteKernelBytes' own predicted ${predictedAnimDelta} real pre-reset bytes`
      );
    }
  }
);

// P1-A2 sibling fix (phase 3 fix round 3c): metaspriteKernelBytes' own new
// per-entry floor terms -- an entry that EXISTS but carries an empty tiles
// (or frames) array still costs 1 real byte (spriteTables' own
// `bytes.length ? dbBlock(...) : '  .db $00'` per ms_data_N/anim_data_N),
// the same defect class round 3b already fixed for the whole-array-empty
// case. The wrong implementation this catches: "predicts 0 bytes for a
// per-entry table the generator still emits one byte for".
test(
  "in-game naming: metaspriteKernelBytes' own per-entry ms_data_N/anim_data_N placeholder terms -- a zero-tile metasprite (or a zero-frame animation) costs exactly the real generator bytes when a tile/frame is added, on every action-capable board",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    async function measurePreReset(mapper, tiles, frames) {
      const project = await loadProject(SAMPLE);
      project.cartridge.mapper = mapper.id;
      project.sprites.metasprites = [{ id: 0, name: 'MS', tiles }];
      project.sprites.animations = [{ id: 0, name: 'Anim', loop: true, frames }];
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-msperentry-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const resetAddr = parseInt(symbols.match(/^reset\s*=\s*\$([0-9A-Fa-f]+)/m)[1], 16);
      return resetAddr - 0xc000;
    }
    function predicted(tiles, frames) {
      return metaspriteKernelBytes({
        sprites: { metasprites: [{ id: 0, name: 'MS', tiles }], animations: [{ id: 0, name: 'Anim', loop: true, frames }], actors: [] }
      });
    }
    const oneFrame = [{ metaspriteId: 0 }];
    const oneTile = [{ tile: 1 }];
    for (const mapper of ACTION_CAPABLE_MAPPERS) {
      // Tiles delta: 0 -> 1 tile, frames held at 1 throughout so only the
      // metasprite's own per-entry term moves.
      const zeroTilesAddr = await measurePreReset(mapper, [], oneFrame);
      const oneTileAddr = await measurePreReset(mapper, oneTile, oneFrame);
      const realTilesDelta = oneTileAddr - zeroTilesAddr;
      const predictedTilesDelta = predicted(oneTile, oneFrame) - predicted([], oneFrame);
      assert.equal(
        realTilesDelta,
        predictedTilesDelta,
        `${mapper.name}: a zero-tile metasprite gaining its first tile should cost exactly metaspriteKernelBytes' own predicted ${predictedTilesDelta} real pre-reset bytes, got ${realTilesDelta}`
      );

      // Frames delta: 0 -> 1 frame, tiles held at 1 throughout so only the
      // animation's own per-entry term moves.
      const zeroFramesAddr = await measurePreReset(mapper, oneTile, []);
      const oneFrameAddr = await measurePreReset(mapper, oneTile, oneFrame);
      const realFramesDelta = oneFrameAddr - zeroFramesAddr;
      const predictedFramesDelta = predicted(oneTile, oneFrame) - predicted(oneTile, []);
      assert.equal(
        realFramesDelta,
        predictedFramesDelta,
        `${mapper.name}: a zero-frame animation gaining its first frame should cost exactly metaspriteKernelBytes' own predicted ${predictedFramesDelta} real pre-reset bytes, got ${realFramesDelta}`
      );
    }
  }
);

// The whole-bank control for the same fix: a project with TWO zero-tile
// metasprites (not one, and not the whole array empty -- the shape neither
// round 3b's nor 3c's own delta tests above individually exercise) must
// still predict exactly what nesasm uses, on every measured board.
test(
  'in-game naming: the whole kernel-lo bank with two zero-tile metasprites (and two zero-frame animations) still holds the normal KERNEL_SLACK band, every measured board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of ACTION_MEASURED_MAPPERS) {
      const project = await loadProject(SAMPLE);
      project.cartridge.mapper = mapper.id;
      project.sprites.metasprites = [
        { id: 0, name: 'A', tiles: [] },
        { id: 1, name: 'B', tiles: [] }
      ];
      project.sprites.animations = [
        { id: 0, name: 'A', loop: true, frames: [] },
        { id: 1, name: 'B', loop: true, frames: [] }
      ];
      const margin = await measureWholeBank(t, mapper, project);
      assert.ok(margin >= KERNEL_SLACK, `${mapper.name}: whole-bank margin ${margin} is under KERNEL_SLACK`);
      assert.ok(margin <= KERNEL_SLACK * 2, `${mapper.name}: whole-bank margin ${margin} is over 2*KERNEL_SLACK`);
    }
  }
);

// P1-2/P1-A's own whole-bank check: assertCovers (above) only ever compares
// post-reset usage, so hero_name_default's own 10-byte table and the
// CHR-RAM streaming tables -- both emitted BEFORE reset, in
// kernelTableBytes' fixedBytes -- have no absolute check of their own
// without this. nesasm's REAL, full kernel-lo usage (both the pre-reset
// lookup tables and the post-reset code) against kernelCodeBytes +
// kernelTableBytes' own combined prediction (the identical arithmetic
// checkCapacity runs), naming ON and OFF (P1-A: the "pre-existing, unrelated
// to naming" claim demonstrated by a real control, not a comment), on every
// action-capable board -- the four with a real measured
// BASE_KERNEL_CODE_BYTES_BY_MAPPER entry held to the full
// [KERNEL_SLACK, 2*KERNEL_SLACK] band, the four falling back to the largest
// measured base held to the weaker "margin >= KERNEL_SLACK, no upper bound"
// idiom the existing fallback-base test above already uses (P2).
async function measureWholeBank(t, mapper, project) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-wholebank-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const lines = [];
  await buildProject({ dir, project, log: (line) => lines.push(line) });
  const { kernelLoBank } = prgLayout(mapper);
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank}`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  const { fixedBytes, tableBytes } = kernelTableBytes(project, mapper);
  const budget = kernelCodeBytes(project, mapper) + fixedBytes + tableBytes;
  return budget - used;
}

test(
  'in-game naming: the whole kernel-lo bank -- nesasm real usage vs. kernelCodeBytes + kernelTableBytes, sample, naming on AND off, every action-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of ACTION_MEASURED_MAPPERS) {
      for (const namingOn of [false, true]) {
        const project = await loadProject(SAMPLE);
        project.cartridge.mapper = mapper.id;
        if (namingOn) project.party[0].renamable = true;
        const margin = await measureWholeBank(t, mapper, project);
        const label = `${mapper.name}, naming ${namingOn ? 'ON' : 'OFF'}`;
        assert.ok(margin >= KERNEL_SLACK, `${label}: whole-bank margin ${margin} is under KERNEL_SLACK`);
        assert.ok(margin <= KERNEL_SLACK * 2, `${label}: whole-bank margin ${margin} is over 2*KERNEL_SLACK`);
      }
    }
    for (const mapper of ACTION_FALLBACK_MAPPERS) {
      for (const namingOn of [false, true]) {
        const project = await loadProject(SAMPLE);
        project.cartridge.mapper = mapper.id;
        if (namingOn) project.party[0].renamable = true;
        const margin = await measureWholeBank(t, mapper, project);
        const label = `${mapper.name} (fallback base), naming ${namingOn ? 'ON' : 'OFF'}`;
        assert.ok(
          margin >= KERNEL_SLACK,
          `${label}: whole-bank margin ${margin} is under KERNEL_SLACK -- the fallback base no longer covers real usage`
        );
      }
    }
  }
);

// P1-A2 (phase 3 fix round 3, fixed in round 3b): the whole-bank checks
// above only ever build `sample`, a rich, real fixture -- the shape the
// checked-in fixtures never exercise is a minimal, near-empty project (0
// metasprites, 0 animations, 0 items, 1 screen), which is what surfaced a
// real 2-byte gap: metaspriteKernelBytes (shared/project.js) predicted 0
// bytes for ms_data_0/anim_data_0 when a project has zero metasprites/
// animations, but generateAssets (main/build/generate.js's spriteTables)
// still emits a 1-byte `.db $00` placeholder for each. Round 3 pinned that
// gap with a loosened band instead of fixing it; round 3b fixed
// metaspriteKernelBytes itself (its own two `Math.max(1,…)`-shaped
// placeholder terms) and re-pinned every test that number moved --
// including this one, now held to the same full band the sample test above
// uses, on every measured board.
test(
  'in-game naming: the whole kernel-lo bank on a minimal createProject action project, naming on AND off, every action-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of ACTION_MEASURED_MAPPERS) {
      for (const namingOn of [false, true]) {
        const project = createProject('Minimal');
        project.cartridge.mapper = mapper.id;
        if (namingOn) project.party[0].renamable = true;
        const margin = await measureWholeBank(t, mapper, project);
        const label = `${mapper.name} (minimal project), naming ${namingOn ? 'ON' : 'OFF'}`;
        assert.ok(margin >= KERNEL_SLACK, `${label}: whole-bank margin ${margin} is under KERNEL_SLACK`);
        assert.ok(margin <= KERNEL_SLACK * 2, `${label}: whole-bank margin ${margin} is over 2*KERNEL_SLACK`);
      }
    }
    for (const mapper of ACTION_FALLBACK_MAPPERS) {
      for (const namingOn of [false, true]) {
        const project = createProject('Minimal');
        project.cartridge.mapper = mapper.id;
        if (namingOn) project.party[0].renamable = true;
        const margin = await measureWholeBank(t, mapper, project);
        const label = `${mapper.name} (minimal project, fallback base), naming ${namingOn ? 'ON' : 'OFF'}`;
        assert.ok(
          margin >= KERNEL_SLACK,
          `${label}: whole-bank margin ${margin} is under KERNEL_SLACK -- the fallback base no longer covers real usage`
        );
      }
    }
  }
);

// Phase 4 (Say token): the whole-bank absolute check, one more
// configuration -- token ON, both game types, every measured action-capable
// board plus every RPG-capable board. The action side also picks up
// HERO_DEFAULT_KERNEL_ALLOWANCE's own 10-byte pre-reset table (kernelTableBytes'
// fixedBytes), which is exactly what this whole-bank check (unlike
// assertCovers) is able to see.
test(
  'phase 4 (Say token): the whole kernel-lo bank with the token live, every measured board, both game types',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of ACTION_MEASURED_MAPPERS) {
      const project = await loadProject(SAMPLE);
      project.cartridge.mapper = mapper.id;
      let mutated = false;
      for (const map of project.maps) {
        for (const screen of map.screens) {
          for (const entity of screen.entities ?? []) {
            if (typeof entity.props?.dialogue === 'string' && entity.props.dialogue && !mutated) {
              entity.props.dialogue = entity.props.dialogue.replace(/\.$/, ' {name}.');
              mutated = true;
            }
          }
        }
      }
      assert.ok(mutated, 'sample should have a live dialogue line to mutate');
      const margin = await measureWholeBank(t, mapper, project);
      const label = `${mapper.name} (sample, action), token ON`;
      assert.ok(margin >= KERNEL_SLACK, `${label}: whole-bank margin ${margin} is under KERNEL_SLACK`);
      assert.ok(margin <= KERNEL_SLACK * 2, `${label}: whole-bank margin ${margin} is over 2*KERNEL_SLACK`);
    }
    for (const mapper of CAPABLE_MAPPERS) {
      const project = await loadProject(SAMPLE_RPG);
      project.cartridge.mapper = mapper.id;
      project.maps[0].screens[0].entities[2].props.event.pages[0].commands[0].text += ' {name}';
      const margin = await measureWholeBank(t, mapper, project);
      const label = `${mapper.name} (sample-rpg, RPG), token ON`;
      assert.ok(margin >= KERNEL_SLACK, `${label}: whole-bank margin ${margin} is under KERNEL_SLACK`);
      assert.ok(margin <= KERNEL_SLACK * 2, `${label}: whole-bank margin ${margin} is over 2*KERNEL_SLACK`);
    }
  }
);

test('in-game naming: kernelTableBytes only charges the input-row 4 bytes when the project opts in', async () => {
  const project = await loadProject(SAMPLE_RPG);
  // Naming off explicitly (phase 5): sample-rpg now opts both hero and Join
  // naming in for real, so the "off" baseline below must force both off
  // itself rather than rely on the fixture's own default -- the nameentry
  // row is gated on projectUsesNameEntry (hero OR join), so leaving Join's
  // own renamable flag on would already charge this row before hero is
  // ever turned on below.
  project.party[0].renamable = false;
  if (project.party[1]) project.party[1].renamable = false;
  const off = kernelTableBytes(project);
  project.party[0].renamable = true;
  const on = kernelTableBytes(project);
  assert.equal(on.fixedBytes - off.fixedBytes, 4, 'the nameentry row should cost exactly 4 bytes once opted in');
  assert.equal(on.tableBytes, off.tableBytes, 'naming should never touch tableBytes');
});

test('in-game naming: kernelShortfallAdvice offers every named Join as a solo candidate, on a board where naming + title + Save does not fit', async () => {
  // UNROM 512: naming + title + Save all live does not fit (confirmed by
  // the real-assembly test above) -- JOIN_NAMING_KERNEL_ALLOWANCE alone
  // (64 bytes) already exceeds this project's own 44-byte deficit here, so
  // the generic solo search finds it without ever reaching the combination
  // search (hero naming alone frees less than the deficit on this exact
  // project, so it is correctly absent from this particular message --
  // the combination-search test above covers "neither alone, both
  // together").
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 30;
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.party[0].renamable = true;
  if (project.party[1]) project.party[1].renamable = true;
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
  assert.ok(projectUsesHeroNaming(project) && projectUsesJoinNaming(project), 'fixture should exercise both naming features');
  const message = kernelShortfallMessage(project);
  assert.match(message, /every named Join \(frees \d+ bytes\)/, 'advice should name Join naming as a real, solo fix');
});

test('in-game naming: removing hero naming or join naming ALONE frees only H or J (10 or 64 bytes) -- NAME_ENTRY_ENABLED stays on because the other feature is still live; removing both frees the full N+H+J', async () => {
  const project = createProject('Naming combo', 'rpg');
  project.project.titleMap = 0; // titled, so HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE stays out of this
  project.project.titleScreen = 0;
  project.party[0].renamable = true;
  project.party.push(createPartyMember(1));
  project.party[1].renamable = true;
  // A real, live Join command targeting member 1 -- projectUsesJoinNaming
  // walks compiled events, not the bare party flag, so a candidate with no
  // Join command anywhere reads as false, exactly as it should.
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'join', member: 1 }] }] } }
  });
  const mapper = SUPPORTED_MAPPERS.find((m) => m.id === 1); // MMC1

  const both = kernelCodeBytes(project, mapper);
  const withoutHero = kernelCodeBytes(projectWithoutHeroNaming(project), mapper);
  const withoutJoin = kernelCodeBytes(projectWithoutJoinNaming(project), mapper);
  const withoutBoth = kernelCodeBytes(projectWithoutJoinNaming(projectWithoutHeroNaming(project)), mapper);

  assert.equal(both - withoutHero, HERO_NAMING_KERNEL_ALLOWANCE, 'stripping hero alone frees only H -- join naming keeps NAME_ENTRY_ENABLED on');
  assert.equal(both - withoutJoin, JOIN_NAMING_KERNEL_ALLOWANCE, 'stripping join alone frees only J -- hero naming keeps NAME_ENTRY_ENABLED on');
  assert.equal(
    both - withoutBoth,
    NAME_ENTRY_KERNEL_ALLOWANCE + HERO_NAMING_KERNEL_ALLOWANCE + JOIN_NAMING_KERNEL_ALLOWANCE,
    'stripping both frees the full N+H+J -- NAME_ENTRY_ENABLED finally turns off too'
  );
});
