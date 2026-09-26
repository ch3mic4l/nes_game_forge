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
import { runNesasm } from '../../main/build/nesasm.js';
import {
  generateAssets,
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
  CAMERA_KERNEL_ALLOWANCE,
  CAMERA_SHAKE_INTERACTION_ALLOWANCE,
  CAMERA_SLIDE_KERNEL_ALLOWANCE,
  CAMERA_AXIS_KERNEL_ALLOWANCE,
  CAMERA_SPLIT_INTERACTION_ALLOWANCE,
  BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE,
  switchableMappers,
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
  STREAMWORLD_NAMEENTRY_ACTION_KERNEL_ALLOWANCE,
  HERO_DEFAULT_KERNEL_ALLOWANCE,
  NAME_TOKEN_KERNEL_ALLOWANCE,
  STREAMWORLD_KERNEL_HI_ALLOWANCE,
  STREAMWORLD_MT_PAL_KERNEL_HI_BYTES,
  STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE,
  STREAMWORLD_REDRAW_KERNEL_ALLOWANCE,
  STREAMWORLD_SET_SCREEN_PTR_KERNEL_ALLOWANCE,
  STREAMWORLD_SPAWN_KERNEL_ALLOWANCE,
  STREAMWORLD_MUSIC_KERNEL_ALLOWANCE,
  STREAMWORLD_ENCOUNTER_KERNEL_ALLOWANCE,
  STREAMWORLD_BATTLE_STRIP_CANCEL_KERNEL_ALLOWANCE,
  STREAMWORLD_BOUND_CACHE_KERNEL_ALLOWANCE,
  STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE,
  STREAMWORLD_INIT_SESSION_KERNEL_ALLOWANCE,
  STREAMWORLD_HURT_PLAYER_KERNEL_ALLOWANCE,
  STREAMWORLD_KB_INIT_KERNEL_ALLOWANCE,
  STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_ALLOWANCE,
  STREAMWORLD_ORDINARY_CAM_RESET_KERNEL_ALLOWANCE,
  STREAMWORLD_TILE_SWITCH_KERNEL_ALLOWANCE,
  STREAMWORLD_MOVE_KERNEL_ALLOWANCE,
  STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE,
  STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE,
  STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE,
  streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance,
  STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE,
  STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_BOX_BEGIN_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_TICK_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_OPEN_ROW_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_OPEN_ATTR_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_PUT_CHAR_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_ARROW_WRITE_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_CLEAR_STEP_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_CHOICE_STEP_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_CHOICE_CURSOR_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_CLOSE_STEP_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_CLOSE_ATTR_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_TEXT_CLOSE_ATTR_TAIL_KERNEL_ALLOWANCE,
  STREAMWORLD_DIALOGUE_CAMRELEASE_KERNEL_ALLOWANCE,
  STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE,
  STREAMWORLD_NMI_KERNEL_ALLOWANCE,
  STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE,
  STREAMWORLD_PROJECT_KERNEL_ALLOWANCE,
  STREAMWORLD_UPDATE_PLAYER_DISPATCH_KERNEL_ALLOWANCE,
  STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE,
  STREAMWORLD_HAZARD_KERNEL_ALLOWANCE,
  STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE,
  STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE,
  STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE,
  STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE,
  streamworldUpdatePlayerKernelHiAllowance
} from '../../main/build/generate.js';
import { SUPPORTED_MAPPERS, cameraAxes, rpgCapable, saveMediaImplemented, prgLayout, resolveMapper } from '../../shared/cartridge.js';
import {
  createTileset,
  createProject,
  normalizeProject,
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
  projectUsesCamera,
  projectWithoutCamera,
  metaspriteKernelBytes,
  RPG_LIMITS,
  LIMITS,
  BUTTONS,
  validateProject
} from '../../shared/project.js';
import { fontBankSplit, projectUsesText } from '../../shared/font.js';
import { createSong } from '../../shared/audio.js';
import { createStreamedProject } from '../lib/streamedproject.js';

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
    // docs/design-camera.md §8, phase 1: a plain cartridge-flag set, not a
    // command -- the same shape withHeroNaming below sets a plain field
    // rather than pushing a command.
    withCamera = false,
    // Phase 2, Decision 8: isolates the register alone (CAMERA_ENABLED=1)
    // with NO consumer assembled at all, by patching the one generated
    // CAMERA_SLIDE_ENABLED line back to 0 in a mkdtemp build directory
    // between generateAssets and nesasm -- a test-only patch, never a
    // shipping env var, the identical "patch a generated file" technique
    // the tileset-mismatch camera.test.js row uses. Only meaningful with
    // withCamera: true.
    registerOnly = false,
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
  project.cartridge.camera = Boolean(withCamera);
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
  let symbolPath;
  if (registerOnly) {
    const { buildDir } = await generateAssets({ dir, project, log: (line) => lines.push(line) });
    const configPath = path.join(buildDir, 'assets', 'config.inc');
    let config = await fsp.readFile(configPath, 'utf8');
    const before = config;
    config = config.replace(/^CAMERA_SLIDE_ENABLED = 1$/m, 'CAMERA_SLIDE_ENABLED = 0');
    assert.notEqual(config, before, `${mapper.name}: CAMERA_SLIDE_ENABLED = 1 not found in generated config.inc -- registerOnly needs camera on`);
    await fsp.writeFile(configPath, config);
    const result = await runNesasm({ cwd: buildDir, source: 'main.asm', log: (line) => lines.push(line) });
    assert.ok(result.ok, `${mapper.name}: register-only patched build failed to assemble: ${JSON.stringify(result.errors)}`);
    symbolPath = path.join(buildDir, 'main.fns');
  } else {
    const built = await buildProject({ dir, project, log: (line) => lines.push(line) });
    symbolPath = built.symbolPath;
  }

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

  assert.ok(symbolPath, `${mapper.name}: nesasm should have written a symbol file`);
  const symbols = await fsp.readFile(symbolPath, 'utf8');
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
    // MMC3 and UNROM 512 used to be excluded here: sample-rpg's own Save +
    // Move + one live item combination was a real, documented shortfall on
    // both boards (167 bytes short on UNROM 512, 90 on MMC3 at last
    // measurement before this diet). The zero-page kernel diet
    // (docs/design-kernel-diet.md) re-measured every kernel-lo term this
    // combination pays and closed both for real, with real margin rather
    // than a single spare byte -- confirmed directly by this very loop now
    // covering all three boards with the standard assertCovers band, and by
    // "sample-rpg with Save and Move on UNROM 512 builds" / "sample-rpg with
    // Save, Move and its one live item does not build on MMC1 [padded]"
    // below, which keep the pre-diet history and the still-refusing padded
    // controls on record. Round 1 review finding 4b: this exclusion had
    // gone stale (design §4b already calls for both boards to be included)
    // and nothing else in the suite replaced this loop's own upper/lower
    // calibration check for either board.
    for (const mapper of saveMappers) {
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

// Round 1 review finding 3: several fixtures below call inflate() with a
// count that, added to the fixture's own starting actors, exceeds
// LIMITS.actors (255) -- a real, separate "This project has N actors" error
// that the tests only ever selected the lookup-tables error away from,
// leaving each one's own "removing X frees Y and fits" claim untested
// against a project that could not legally hold that many actors at all.
// This is the drop-in replacement: it fills up to the real actor ceiling
// first, then makes up the rest of the identical kernel-lo byte total with
// zero-frame animations -- kernelTableBytes' own per-animation term is
// exactly 4 bytes (half a filler actor's 8, verified empirically, the same
// measurement inflateMetasprites' own header comment above already leans
// on), so two animations per actor this function could not legally add
// reproduce the same table-byte contribution a (now illegal) count-many
// actor-only inflate() would have. Same signature and same total byte cost
// as inflate() -- every call site below keeps its own already-calibrated
// count unchanged, only the padding's own composition (never its total)
// changes when count would otherwise cross the actor ceiling.
function inflateLegal(project, count) {
  const maxFillerActors = Math.max(0, LIMITS.actors - project.sprites.actors.length);
  const actorCount = Math.min(count, maxFillerActors);
  inflate(project, actorCount);
  const remainingUnits = count - actorCount; // each unit is one filler actor's own 8-byte cost
  for (let i = 0; i < remainingUnits * 2; i++) {
    project.sprites.animations.push({ id: 4000 + i, name: `FillerAnim${i}`, frames: [] });
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
  // 160, not the earlier 80: the zero-page kernel diet (docs/design-kernel-diet.md)
  // dropped MMC3's own base by roughly 590 bytes, so the old count no longer
  // produces any deficit at all; re-derived against a real checkCapacity()
  // run, not assumed from the base delta alone.
  inflate(project, 160);
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
test(
  'a kernel-lo shortfall Move alone would not close by its own allowance can still close when dropping it also turns off the split term',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
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
    // 275, not the earlier 210: the zero-page kernel diet (docs/design-kernel-diet.md)
    // re-measured MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE to 337 (from
    // 395) and SPLIT_KERNEL_ALLOWANCE to 151 (from 165); phase 2 slice 3's
    // ruling 7 identity fix (mv_ent, engine/entities.asm and script.asm) then
    // added another 11 to MOVE_KERNEL_ALLOWANCE, narrowing this test's own
    // band to (348, 499]. Re-derived against a real checkCapacity() run: 275
    // lands the deficit at 415, comfortably inside the new band (423.5 is the
    // midpoint).
    inflateLegal(project, 275); // deficit 415, strictly above 348 and at or below 499
    // The band a deficit has to sit in for the split term's own extra bytes to
    // be the thing making the difference is strictly above Move's own
    // allowance alone (348) and at or below the combined figure (499) -- below
    // 348 and Move alone already covers it without the split term in the
    // picture at all, and above 499 neither figure would close the gap.
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
    assert.match(message, /removing every Move command \(frees 499 bytes\)/);
    await assertDropFits(t, project, ['move'], 'Move alone would not close but with the split term freed too');
  }
);

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
  // 170, not the earlier 100: the zero-page kernel diet (docs/design-kernel-diet.md)
  // dropped MMC1's own base enough that the old count no longer opens any
  // deficit at all; re-derived against a real checkCapacity() run.
  inflate(project, 170);
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
  // banked region at all -- see inflateMetasprites' own comment above.
  // 85, not the earlier 52: the zero-page kernel diet
  // (docs/design-kernel-diet.md) dropped every board's own kernel-lo base,
  // widening the window this test needs; re-measured against a real
  // checkCapacity() run, not derived by arithmetic, per this file's own
  // rule on why that matters.
  inflateMetasprites(project, 85);
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
    // reproduction depends on long before the deficit reaches the target
    // band. Combined with zero-frame animations (the identical table-only,
    // no-code-cost shape, LIMITS.metasprites also being 255): the zero-page
    // kernel diet (docs/design-kernel-diet.md) narrowed the code-only gap
    // from 195 to 189 and freed hundreds of extra bytes of headroom on every
    // board, so 220 metasprites alone no longer reaches ANY deficit at all
    // (confirmed directly: even 252, the most metasprites this project can
    // hold, leaves 182 bytes free) -- animations fill the rest. 252
    // metasprites (the cap, 3 already shipped) plus 129 animations lands the
    // deficit at 194, inside the new (189, 198] band; re-derived against a
    // real checkCapacity() run, not assumed from the old proportions.
    for (let i = 0; i < 252; i++) project.sprites.metasprites.push({ id: 1000 + i, name: `FillerMS${i}`, tiles: [] });
    for (let i = 0; i < 129; i++) project.sprites.animations.push({ id: 2000 + i, name: `FillerAnim${i}`, frames: [] });

    const mapper30 = SUPPORTED_MAPPERS.find((m) => m.id === 30);
    const mapper1 = SUPPORTED_MAPPERS.find((m) => m.id === 1);
    const occupancyOn = (m) => {
      const { fixedBytes, tableBytes } = kernelTableBytes(project, m);
      return kernelCodeBytes(project, m) + fixedBytes + tableBytes;
    };
    const codeSaved = kernelCodeBytes(project, mapper30) - kernelCodeBytes(project, mapper1);
    const tableSaved = occupancyOn(mapper30) - occupancyOn(mapper1) - codeSaved;
    assert.equal(codeSaved, 189, 'the reproduction must still isolate to exactly 189 code-only bytes saved by MMC1, or this is testing a different shape');
    assert.equal(tableSaved, 9, 'the reproduction must still isolate to exactly 9 table-only bytes saved by MMC1 (the CHR-RAM streaming tables), or this is testing a different shape');

    const { problems } = checkCapacity(project);
    const error = problems.find((p) => p.severity === 'error' && /lookup tables/.test(p.message));
    assert.ok(error, 'expected checkCapacity to refuse this project on UNROM 512');
    const deficit = Number(error.message.match(/need (\d+) bytes but only (-?\d+) are free/)?.[1]) - Number(error.message.match(/need (\d+) bytes but only (-?\d+) are free/)?.[2]);
    assert.equal(deficit, 194, 'the reproduction must still isolate to exactly a 194-byte deficit, or this is testing a different shape');
    assert.ok(
      deficit > codeSaved,
      `this case only exercises the bug if the code-only savings (${codeSaved}) alone would NOT cover the deficit (${deficit})`
    );

    assert.match(
      error.message,
      /Try MMC1 in the Build panel — it reserves 198 fewer bytes for the same features\.$/,
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
  inflateMetasprites(base, 85); // see the identical recalibration note on the case above

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
  // 200, not the earlier 126: the zero-page kernel diet
  // (docs/design-kernel-diet.md) dropped MMC3's own base by roughly 590
  // bytes, so 126 no longer produces a deficit at all. Re-derived against a
  // real checkCapacity() run: 200 lands a real deficit MMC1's own savings
  // would otherwise "cover" were it not for the 17-tileset ceiling below.
  inflate(project, 200); // forces a kernel-lo shortfall MMC1's own savings would otherwise "cover"
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

/**
 * Round 1 review finding 3: a test claiming "removing X frees Y and fits"
 * used to stop at the advice message's own text -- never confirming the
 * counterfactual (X, and only X, actually dropped) is itself free of every
 * OTHER validation or capacity error, or that it genuinely assembles. This
 * drops every named op in turn (dropCommand, above), asserts
 * validateProject and checkCapacity both come back clean of errors, then
 * does a real nesasm build and asserts the ROM exists -- the same
 * discipline the file's own assertSfxRefusal/documented-limitation tests
 * already hold themselves to, generalized so the many single- and
 * two-verb kernel-lo cases below can share it rather than repeat it.
 */
async function assertDropFits(t, project, ops, label) {
  let dropped = project;
  for (const op of ops) dropped = dropCommand(dropped, op);
  assert.deepEqual(
    validateProject(dropped).filter((p) => p.severity === 'error'),
    [],
    `${label}: dropping ${ops.join('+')} should leave the project free of validation errors`
  );
  assert.deepEqual(
    checkCapacity(dropped).problems.filter((p) => p.severity === 'error'),
    [],
    `${label}: dropping ${ops.join('+')} should leave the project free of capacity errors`
  );
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-counterfactual-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, dropped);
  const built = await buildProject({ dir, project: dropped, log: () => {} });
  assert.ok(built.romPath, `${label}: dropping ${ops.join('+')} should be a real, buildable fix`);
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
// measured on all three RPG-capable boards) is exactly what it costs.
//
// The zero-page kernel diet (docs/design-kernel-diet.md) closed the gap a
// third time -- for real this time, confirmed by an actual build, not
// merely a checkCapacity() pass: MMC3's own kernel-lo base dropped by
// roughly 590 bytes, leaving 675 bytes free for this exact combination.
// This was CLAUDE.md's own first documented-limitation row (§5 of the
// design), and the design's own real-build proof is reproduced here as a
// permanent regression test -- if a future kernel-lo growth ever reopens
// this gap a fourth time, this test must fail and force a conscious
// decision, the same way the gap's first two closures and reopenings were
// each a deliberate, noticed event rather than a silent drift.
test(
  'sample-rpg with Save, Move and its one live item builds on MMC3 -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    // Naming off explicitly (phase 5): this is CLAUDE.md's own pinned clean
    // baseline for Save+Move+item alone.
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    assert.ok(project.items.length > 0, 'this case needs sample-rpg\'s own live item still in play');

    assert.deepEqual(checkCapacity(project).problems.filter((p) => p.severity === 'error'), [], 'this combination must fit on MMC3 now');

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-savemove-mmc3-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const lines = [];
    const built = await buildProject({ dir, project, log: (line) => lines.push(line) });
    assert.ok(built.romPath, 'nesasm should have assembled a ROM on MMC3');
    const bankLine = lines.find((line) => /^BANK\s+30\s/.test(line));
    assert.ok(bankLine, "MMC3's own kernel-lo bank (30) should appear in nesasm's usage table");
    const free = Number(bankLine.match(/\d+\/\s*(\d+)\s*$/)?.[1]);
    assert.ok(free >= KERNEL_SLACK, `expected at least KERNEL_SLACK (${KERNEL_SLACK}) free, got ${free}`);
  }
);

// design-kernel-diet.md §5's own second row: the identical scenario with
// naming left AS sample-rpg ships (hero+Join both live, phase 5's own real
// fixture content) rather than stripped -- round 1 of the design wrongly
// attributed this variant to the naming-off constructor; this is the actual
// as-shipped-naming build the design's own table cites (7701/8192 used, 491
// free). Round 1 review finding 4c: implementation had the naming-off
// baseline covered but never this one, which the design explicitly lists as
// its own separate row.
test(
  'sample-rpg with Save, Move and its one live item builds on MMC3 with naming left AS SHIPPED -- design-kernel-diet.md §5\'s own second row',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    // Naming deliberately left untouched here -- sample-rpg ships hero+Join
    // naming live for real (phase 5), and this row is specifically about
    // that as-shipped state, not the naming-off baseline the test above
    // already covers.
    assert.ok(project.party[0].renamable, 'this row needs sample-rpg\'s own as-shipped hero naming to still be live');
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    assert.ok(project.items.length > 0, 'this case needs sample-rpg\'s own live item still in play');

    assert.deepEqual(checkCapacity(project).problems.filter((p) => p.severity === 'error'), [], 'this combination must fit on MMC3 with naming left live too');

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-savemove-mmc3-naming-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'nesasm should have assembled a ROM on MMC3 with naming left live');
  }
);

// The still-refusing case: padded past the diet's own real headroom, so the
// advice path this whole family exists to prove -- "name both commands and
// both real byte figures, never a mapper the switch itself would still fail
// on" -- stays under real test coverage even though the un-padded row no
// longer exercises it.
test('sample-rpg with Save, Move, its one live item, AND enough padding still does not build on MMC3 -- keeps the advice path covered', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.party[0].renamable = false;
  if (project.party[1]) project.party[1].renamable = false;
  project.cartridge.mapper = 4; // MMC3
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push(saveAndMoveEvent());
  assert.ok(project.items.length > 0, 'this case needs sample-rpg\'s own live item still in play');
  inflate(project, 115); // pads past the diet's own real headroom for this combination

  const message = kernelShortfallMessage(project);
  assert.match(
    message,
    new RegExp(
      `removing every Move command \\(frees ${MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} bytes\\) or every Save command ` +
        `\\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[4] + SAVE_BATTLE_KERNEL_ALLOWANCE} bytes\\)`
    ),
    'the refusal should name both commands and both of their real byte figures, not just report the deficit'
  );

  // The design's own mitigations (drop Move; switch to MMC1) still work.
  const droppedMove = structuredClone(project);
  droppedMove.maps[0].screens[0].entities.at(-1).props.event.pages[0].commands =
    droppedMove.maps[0].screens[0].entities.at(-1).props.event.pages[0].commands.filter((c) => c.op !== 'move');
  assert.deepEqual(
    checkCapacity(droppedMove).problems.filter((p) => p.severity === 'error'),
    [],
    'dropping Move should still be a real fix'
  );

  // Switching board is checked against the UNPADDED combination -- the
  // padding above exists only to keep this row's own advice message under
  // test, not to claim a heavily-padded project also fits elsewhere.
  const onMmc1 = await loadProject(SAMPLE_RPG);
  onMmc1.party[0].renamable = false;
  if (onMmc1.party[1]) onMmc1.party[1].renamable = false;
  onMmc1.cartridge.mapper = 1;
  onMmc1.project.titleMap = 0;
  onMmc1.project.titleScreen = 0;
  onMmc1.maps[0].screens[0].entities.push(saveAndMoveEvent());
  assert.deepEqual(
    checkCapacity(onMmc1).problems.filter((p) => p.severity === 'error'),
    [],
    'the same (unpadded) combination should still fit comfortably on MMC1'
  );
});

// design-kernel-diet.md §10's own "still-refuses control": the synthetic
// maximal-stress scenario -- a titled MMC3 sample-rpg, naming left live,
// every measured conditional feature stacked at once (Save/Move/Turn/Wait/
// Shake/Visible/Fade/Flash/Sting/Sfx/a bound tile/its one item) -- genuinely
// still refuses under the patched ledger, not vacuously: the seven real
// builds above (and their own naming-live/naming-off siblings) already
// prove the diet does not simply refuse everything. Round 1 review finding
// 4c: this control was named in the design (§5's own closing paragraph,
// §10 item 5) but never implemented.
test(
  'sample-rpg with every measured conditional feature stacked at once, naming left live, still does not build on MMC3 -- design-kernel-diet.md §10\'s own still-refuses control',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    // Naming deliberately left untouched -- the design's own control is
    // explicit that naming stays live here, the harder of the two states.
    assert.ok(project.party[0].renamable, 'this control needs sample-rpg\'s own as-shipped hero naming to still be live');
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.songs = [createSong('Fanfare')];
    project.sfx = [{ name: 'Boop', volume: 10, steps: [{ note: 5, duration: 4 }] }];
    const paintedId = project.maps[0].screens[0].metatiles[0];
    project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: paintedId }];
    assert.ok(project.items.length > 0, 'this control needs sample-rpg\'s own live item still in play');
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
                { op: 'wait', frames: 10 },
                { op: 'shake', frames: 10 },
                { op: 'visible', state: 'hidden' },
                { op: 'visible', state: 'shown' },
                { op: 'fade', dir: 'out' },
                { op: 'flash' },
                { op: 'sting', song: 0 },
                { op: 'sfx', sfx: 0 }
              ]
            }
          ]
        }
      }
    });

    const kernelLoProblem = checkCapacity(project).problems.find(
      (p) => p.severity === 'error' && /lookup tables/.test(p.message)
    );
    assert.ok(kernelLoProblem, 'this maximal-stress combination should still be refused, by name, over kernel-lo capacity');

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-maxstress-mmc3-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    await assert.rejects(
      buildProject({ dir, project, log: () => {} }),
      'this maximal-stress combination should still fail a real nesasm build, not merely checkCapacity\'s own preflight'
    );
  }
);

// The UNROM 512 mirror of the MMC3 story above -- except this combination
// used to be refused unconditionally and is not any more: the zero-page
// kernel diet (docs/design-kernel-diet.md) closed it for real, the same way
// it closed the MMC3 Save+Move+item row (see the converted test above this
// one). Save alone and Move alone both already fit and assemble; what
// changed is that the combination now does too, with real room to spare --
// so this test is rewritten to prove the build, both with sample-rpg's
// default item and with it stripped (the two configurations the old test
// distinguished), and a new, padded sibling below keeps the refusal-message
// advice path covered.
test(
  'sample-rpg with Save and Move on UNROM 512 builds -- the zero-page kernel diet closed this documented limitation for real',
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
    assert.deepEqual(
      checkCapacity(both).problems.filter((p) => p.severity === 'error'),
      [],
      'sample-rpg with its default item, Save and Move together should now fit on UNROM 512'
    );
    const bothDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-unrom512-both-'));
    t.after(() => fsp.rm(bothDir, { recursive: true, force: true }));
    await saveProject(bothDir, both);
    const bothBuilt = await buildProject({ dir: bothDir, project: both, log: () => {} });
    assert.ok(bothBuilt.romPath, 'Save and Move together should now fit and assemble on UNROM 512, with the default item');

    // sample-rpg carries one live item by default, so `both` above exercises
    // the item-bearing reservation (ITEM_KERNEL_ALLOWANCE included) -- not
    // the item-free one ROADMAP.md's own "Suggested order" section used to
    // cite this test for. Both configurations are checked here since the
    // diet's own margin easily covers the 17-byte gap between them.
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
    assert.deepEqual(
      checkCapacity(bothItemFree).problems.filter((p) => p.severity === 'error'),
      [],
      'the item-free configuration should also now fit on UNROM 512'
    );
    const itemFreeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-unrom512-itemfree-'));
    t.after(() => fsp.rm(itemFreeDir, { recursive: true, force: true }));
    await saveProject(itemFreeDir, bothItemFree);
    const itemFreeBuilt = await buildProject({ dir: itemFreeDir, project: bothItemFree, log: () => {} });
    assert.ok(itemFreeBuilt.romPath, 'the item-free configuration should now assemble on UNROM 512 too');
  }
);

// The padded sibling of the row just closed: with enough filler content to
// force the deficit back open, the combination still refuses, and the
// advice still names both commands and both of their real byte figures --
// this is what keeps the refusal-message assertion (and its "either alone
// would close it" arithmetic) under test now that the unpadded row itself
// builds.
test('sample-rpg with Save and Move on UNROM 512, padded, still does not build -- keeps the advice path covered', async () => {
  const project = await loadProject(SAMPLE_RPG);
  project.party[0].renamable = false; // naming off explicitly, phase 5
  if (project.party[1]) project.party[1].renamable = false;
  project.cartridge.mapper = 30; // UNROM 512
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].screens[0].entities.push(saveAndMoveEvent());
  inflate(project, 70); // deficit 74, comfortably short of both allowances
  const message = kernelShortfallMessage(project);
  assert.match(
    message,
    new RegExp(
      `removing every Move command \\(frees ${MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE} bytes\\) or every Save command ` +
        `\\(frees ${SAVE_KERNEL_ALLOWANCE_BY_MAPPER[30] + SAVE_BATTLE_KERNEL_ALLOWANCE} bytes\\)`
    ),
    'the padded refusal should still name both commands and both of their real byte figures'
  );
});

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
  inflate(project, 100); // recalibrated for phase 2 slice 3's ruling 7 (+11 to MOVE_KERNEL_ALLOWANCE) -- deficit 156, within (0, 348]
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command \(frees 348 bytes\) or every Save command \(frees 516 bytes\)/);
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
  inflate(project, 150); // recalibrated for phase 2 slice 3's ruling 7 (+11 to MOVE_KERNEL_ALLOWANCE) -- deficit 556, above 516 and within 864
  const message = kernelShortfallMessage(project);
  assert.match(message, /removing every Move command and every Save command together \(frees 864 bytes\)/);
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
test(
  'a kernel-lo shortfall a live Wait command alone would close names Wait',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = createProject('Action', 'action');
    project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'wait', frames: 30 }] }] } }
    });
    // 286, not the earlier 213: the zero-page kernel diet (docs/design-kernel-diet.md)
    // dropped MMC1's own action-side base, so the old count no longer opens
    // any deficit at all; re-derived against a real checkCapacity() run.
    inflateLegal(project, 286);
    const deficit = kernelShortfallDeficit(project);
    assert.ok(deficit <= WAIT_KERNEL_ALLOWANCE, `deficit ${deficit} must not exceed WAIT_KERNEL_ALLOWANCE (${WAIT_KERNEL_ALLOWANCE}) or this case does not exercise Wait alone closing the gap`);
    const message = kernelShortfallMessage(project);
    assert.match(message, new RegExp(`removing every Wait command \\(frees ${WAIT_KERNEL_ALLOWANCE} bytes\\)`));
    assert.doesNotMatch(message, /Turn command/, 'this project never turns Turn on, so it must not be offered as a fix');
    assert.doesNotMatch(message, /Move command/, 'this project never turns Move on, so it must not be offered as a fix');
    await assertDropFits(t, project, ['wait'], 'Wait alone would close it');
  }
);

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
test(
  'a kernel-lo shortfall neither Turn nor Wait alone would close, but both together would, names the combination',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
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
    // 284, not the earlier 213: the zero-page kernel diet dropped MMC1's own
    // action-side base; re-derived against a real checkCapacity() run.
    inflateLegal(project, 284);
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
    await assertDropFits(t, project, ['turn', 'wait'], 'Turn+Wait together would close it');
  }
);

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
test(
  'a kernel-lo shortfall a live Shake command alone would close names Shake',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
  const project = createProject('Action', 'action');
  project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 16,
    y: 16,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 30 }] }] } }
  });
  // 286, not the earlier 212: the zero-page kernel diet dropped MMC1's own
  // action-side base; re-derived against a real checkCapacity() run.
  inflateLegal(project, 286);
  const deficit = kernelShortfallDeficit(project);
  assert.ok(deficit <= SHAKE_KERNEL_ALLOWANCE, `deficit ${deficit} must not exceed SHAKE_KERNEL_ALLOWANCE (${SHAKE_KERNEL_ALLOWANCE}) or this case does not exercise Shake alone closing the gap`);
  const message = kernelShortfallMessage(project);
  assert.match(message, new RegExp(`removing every Shake command \\(frees ${SHAKE_KERNEL_ALLOWANCE} bytes\\)`));
  assert.doesNotMatch(message, /Turn command/, 'this project never turns Turn on, so it must not be offered as a fix');
  assert.doesNotMatch(message, /Wait command/, 'this project never turns Wait on, so it must not be offered as a fix');
    await assertDropFits(t, project, ['shake'], 'Shake alone would close it');
  }
);

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
test(
  'a kernel-lo shortfall neither Shake nor Wait alone would close, but both together would, names the combination',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
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
    inflateLegal(project, 284); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
    const deficit = kernelShortfallDeficit(project);
    const combined = SHAKE_KERNEL_ALLOWANCE + WAIT_KERNEL_ALLOWANCE;
    assert.ok(
      deficit > SHAKE_KERNEL_ALLOWANCE && deficit > WAIT_KERNEL_ALLOWANCE,
      `deficit ${deficit} must exceed both Shake alone (${SHAKE_KERNEL_ALLOWANCE}) and Wait alone (${WAIT_KERNEL_ALLOWANCE}), or this case does not exercise the combination at all`
    );
    assert.ok(deficit <= combined, `deficit ${deficit} must not exceed the combined figure (${combined}), or dropping both would not close the gap either`);
    const message = kernelShortfallMessage(project);
    assert.match(message, new RegExp(`removing every Wait command and every Shake command together \\(frees ${combined} bytes\\)`));
    await assertDropFits(t, project, ['shake', 'wait'], 'Shake+Wait together would close it');
  }
);

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
test(
  'a kernel-lo shortfall a live Show/Hide command alone would close names Show/Hide',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
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
    inflateLegal(project, 286); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
    const deficit = kernelShortfallDeficit(project);
    assert.ok(
      deficit <= VISIBLE_KERNEL_ALLOWANCE,
      `deficit ${deficit} must not exceed VISIBLE_KERNEL_ALLOWANCE (${VISIBLE_KERNEL_ALLOWANCE}) or this case does not exercise Show/Hide alone closing the gap`
    );
    const message = kernelShortfallMessage(project);
    assert.match(message, new RegExp(`removing every Show/Hide command \\(frees ${VISIBLE_KERNEL_ALLOWANCE} bytes\\)`));
    assert.doesNotMatch(message, /Shake command/, 'this project never turns Shake on, so it must not be offered as a fix');
    assert.doesNotMatch(message, /Wait command/, 'this project never turns Wait on, so it must not be offered as a fix');
    await assertDropFits(t, project, ['visible'], 'Show/Hide alone would close it');
  }
);

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
test(
  'a kernel-lo shortfall neither Shake nor Show/Hide alone would close, but both together would, names the combination',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
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
    inflateLegal(project, 284); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
    const deficit = kernelShortfallDeficit(project);
    const combined = SHAKE_KERNEL_ALLOWANCE + VISIBLE_KERNEL_ALLOWANCE;
    assert.ok(
      deficit > SHAKE_KERNEL_ALLOWANCE && deficit > VISIBLE_KERNEL_ALLOWANCE,
      `deficit ${deficit} must exceed both Shake alone (${SHAKE_KERNEL_ALLOWANCE}) and Show/Hide alone (${VISIBLE_KERNEL_ALLOWANCE}), or this case does not exercise the combination at all`
    );
    assert.ok(deficit <= combined, `deficit ${deficit} must not exceed the combined figure (${combined}), or dropping both would not close the gap either`);
    const message = kernelShortfallMessage(project);
    assert.match(message, new RegExp(`removing every Shake command and every Show/Hide command together \\(frees ${combined} bytes\\)`));
    await assertDropFits(t, project, ['shake', 'visible'], 'Shake+Show/Hide together would close it');
  }
);

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
test(
  'a kernel-lo shortfall a live Fade command alone would close names Fade',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = createProject('Action', 'action');
    project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'fade', dir: 'out' }] }] } }
    });
    inflateLegal(project, 284); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
    const deficit = kernelShortfallDeficit(project);
    const freed = FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE;
    assert.ok(deficit <= freed, `deficit ${deficit} must not exceed FADE_KERNEL_ALLOWANCE + PALETTE_FX_KERNEL_ALLOWANCE (${freed}) or this case does not exercise Fade alone closing the gap`);
    const message = kernelShortfallMessage(project);
    assert.match(message, new RegExp(`removing every Fade command \\(frees ${freed} bytes\\)`));
    assert.doesNotMatch(message, /Turn command/, 'this project never turns Turn on, so it must not be offered as a fix');
    assert.doesNotMatch(message, /Shake command/, 'this project never turns Shake on, so it must not be offered as a fix');
    assert.doesNotMatch(message, /Flash command/, 'this project never turns Flash on, so it must not be offered as a fix');
    await assertDropFits(t, project, ['fade'], 'Fade alone would close it');
  }
);

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
test(
  'a kernel-lo shortfall neither Shake nor Fade alone would close, but both together would, names the combination',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
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
    inflateLegal(project, 286); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
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
    await assertDropFits(t, project, ['shake', 'fade'], 'Shake+Fade together would close it');
  }
);

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
test(
  'a kernel-lo shortfall with both Flash and Fade live: dropping Fade alone frees only FADE_KERNEL_ALLOWANCE, not the shared term',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
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
    inflateLegal(project, 270); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md -- deficit 122, above FLASH_KERNEL_ALLOWANCE and at or below FADE_KERNEL_ALLOWANCE
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
    await assertDropFits(t, project, ['fade'], 'Fade alone (Flash still live) would close it');
  }
);

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
test(
  'a kernel-lo shortfall with no live Fade command never names Fade as droppable advice',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = createProject('Action', 'action');
    project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 30 }] }] } }
    });
    inflateLegal(project, 286); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
    const deficit = kernelShortfallDeficit(project);
    assert.ok(deficit <= SHAKE_KERNEL_ALLOWANCE, `deficit ${deficit} must not exceed SHAKE_KERNEL_ALLOWANCE (${SHAKE_KERNEL_ALLOWANCE}) or this case does not exercise Shake alone closing the gap`);
    const message = kernelShortfallMessage(project);
    assert.match(message, new RegExp(`removing every Shake command \\(frees ${SHAKE_KERNEL_ALLOWANCE} bytes\\)`));
    assert.doesNotMatch(
      message,
      /Fade command/,
      'this project never turns Fade on, so it must never be offered as a fix -- neither solo nor as part of a combination'
    );
    await assertDropFits(t, project, ['shake'], 'Shake alone would close it (no Fade anywhere in this project)');
  }
);

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
test(
  'a kernel-lo shortfall with no live Flash command never names Flash as droppable advice',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = createProject('Action', 'action');
    project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 30 }] }] } }
    });
    inflateLegal(project, 286); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
    const deficit = kernelShortfallDeficit(project);
    assert.ok(deficit <= SHAKE_KERNEL_ALLOWANCE, `deficit ${deficit} must not exceed SHAKE_KERNEL_ALLOWANCE (${SHAKE_KERNEL_ALLOWANCE}) or this case does not exercise Shake alone closing the gap`);
    const message = kernelShortfallMessage(project);
    assert.match(message, new RegExp(`removing every Shake command \\(frees ${SHAKE_KERNEL_ALLOWANCE} bytes\\)`));
    assert.doesNotMatch(
      message,
      /Flash command/,
      'this project never turns Flash on, so it must never be offered as a fix -- neither solo nor as part of a combination'
    );
    await assertDropFits(t, project, ['shake'], 'Shake alone would close it (no Flash anywhere in this project)');
  }
);

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
test(
  'a kernel-lo shortfall Sting alone would not close by its own allowance can still close when dropping it also turns off the split term',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
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
    inflateLegal(project, 270); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md -- deficit 208, strictly above 181 and at or below 332
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
    await assertDropFits(t, project, ['sting'], 'Sting alone would close it (with the split term freed too)');
  }
);

// design-sting.md §9's documented limitation, closed for real by the
// zero-page kernel diet (docs/design-kernel-diet.md): MMC3 Save+Move-no-item
// with a live Sting now fits with real room to spare. The padded sibling
// test right below keeps the refusal-message advice path (Move and Save
// offered, Sting correctly left out) and both mitigation checks (dropping
// Sting alone is not enough; dropping Move alone, with Sting still live, is
// a real fix) under test.
test(
  'sample-rpg with Save, Move (no item) and a live Sting builds on MMC3 -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.items = []; // isolate the no-item row this refusal used to land on
    project.songs = [createSong('Fanfare')];
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 32,
      y: 32,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'sting', song: 0 }] }] } }
    });
    assert.deepEqual(
      checkCapacity(project).problems.filter((p) => p.severity === 'error'),
      [],
      'sample-rpg with Save, Move (no item) and a live Sting should now fit on MMC3'
    );
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sting-limitation-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'Save, Move (no item) and a live Sting should now assemble on MMC3');
  }
);

test(
  'sample-rpg with Save, Move (no item) and a live Sting, padded, still does not build on MMC3 -- keeps the advice path covered',
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
    inflate(project, 75); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md -- deficit 232, above STING but at or below MOVE

    const message = kernelShortfallMessage(project);
    // Move and Save, not Sting: dropping Sting alone does not close this
    // padded row's own deficit, so kernelShortfallAdvice's solo pass
    // correctly leaves it out.
    assert.match(message, /every Move command \(frees \d+ bytes\)/, 'the refusal should offer dropping Move');
    assert.match(message, /every Save command \(frees \d+ bytes\)/, 'the refusal should offer dropping Save');
    assert.doesNotMatch(
      message,
      /Sting/,
      'Sting alone does not close this padded row -- offering it here would be advice that does not actually work'
    );

    // Dropping Sting alone is NOT a real fix -- confirms the deficit above
    // is genuine, not an artifact of kernelShortfallMessage's own
    // arithmetic.
    const droppedSting = structuredClone(project);
    droppedSting.maps[0].screens[0].entities.pop();
    const dirSting = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sting-limitation-padded-'));
    t.after(() => fsp.rm(dirSting, { recursive: true, force: true }));
    await saveProject(dirSting, droppedSting);
    await assert.rejects(
      buildProject({ dir: dirSting, project: droppedSting, log: () => {} }),
      'dropping only the Sting command should still fail to build on this padded row'
    );

    // Confirm the design's own stated mitigation still holds: dropping Move
    // ALONE -- Save stays live -- (one of the two fixes the message above
    // actually offers) is a real fix, with Sting still live too.
    const droppedMove = dropCommand(project, 'move');
    const dirMove = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sting-limitation-padded-move-'));
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
      assert.equal(delta, 181, `${mapper.name}: the Sting-only figure (re-measured after the zero-page kernel diet, docs/design-kernel-diet.md) must not have moved`);
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
 * Builds the same `sample-rpg`-on-`mapper` project both assertSfxRefusal and
 * assertSfxFits construct: `rowCommands` on one placed actor, plus a live
 * SFX command on a second (and, if `withSting`, a live Sting on a third).
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
async function buildSfxRow(mapperId, rowCommands, { noItem = false, withSting = false, noTitle = false, pad = 0 } = {}) {
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
  if (pad) inflate(project, pad);
  return project;
}

/**
 * The zero-page kernel diet (docs/design-kernel-diet.md) closed every one of
 * this section's former documented-limitation rows for real -- confirms the
 * unpadded row now fits checkCapacity and actually assembles.
 */
async function assertSfxFits(t, mapperId, rowCommands, opts = {}) {
  const project = await buildSfxRow(mapperId, rowCommands, opts);
  assert.deepEqual(
    checkCapacity(project).problems.filter((p) => p.severity === 'error'),
    [],
    `${opts.mapperLabel}: this row should now fit on the real, unpadded project`
  );
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-fits-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  assert.ok(built.romPath, `${opts.mapperLabel}: this row should now assemble for real`);
}

/**
 * The padded sibling of assertSfxFits: with enough filler content to force
 * the deficit back open, confirms checkCapacity() still refuses it, that the
 * refusal names "Play a sound effect" with its real freed-byte figure, and
 * that dropping just the SFX command is a real, buildable fix (an actual
 * nesasm build, not only the JS-side prediction) -- the identical discipline
 * the existing Sting/bound-tile documented-limitation tests already hold
 * themselves to. This is what keeps the advice-path assertion under test now
 * that the unpadded row itself builds.
 */
async function assertSfxRefusal(t, mapperId, rowCommands, { noItem = false, withSting = false, noTitle = false, mapperLabel, pad = 100 } = {}) {
  const project = await buildSfxRow(mapperId, rowCommands, { noItem, withSting, noTitle, pad });

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

// The zero-page kernel diet (docs/design-kernel-diet.md) closed this row for
// real too: MMC3 Save+Move-no-item with a live SFX now fits with real room
// to spare. The padded sibling test right below keeps the refusal-message
// advice path (Move and Save offered, SFX correctly left out) and both
// mitigation checks under test.
test(
  'sample-rpg with Save, Move (no item) and a live SFX builds on MMC3 -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
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
    assert.deepEqual(
      checkCapacity(project).problems.filter((p) => p.severity === 'error'),
      [],
      'sample-rpg with Save, Move (no item) and a live SFX should now fit on MMC3'
    );
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-limitation-mmc3-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'Save, Move (no item) and a live SFX should now assemble on MMC3');
  }
);

test(
  'sample-rpg with Save, Move (no item) and a live SFX, padded, still does not build on MMC3 -- keeps the advice path covered',
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
    inflate(project, 92); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md -- deficit 301, above SFX's own allowance but at or below Move's

    const message = kernelShortfallMessage(project);
    assert.match(message, /every Move command \(frees \d+ bytes\)/, 'the refusal should offer dropping Move');
    assert.match(message, /every Save command \(frees \d+ bytes\)/, 'the refusal should offer dropping Save');
    assert.doesNotMatch(
      message,
      /sound effect/,
      'SFX alone does not close this padded row -- the baseline is already over budget without it, so ' +
        'offering it here would be advice that does not actually work'
    );

    // Dropping SFX alone is NOT a real fix.
    const droppedSfx = structuredClone(project);
    droppedSfx.maps[0].screens[0].entities.pop();
    const dirSfx = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-limitation-mmc3-padded-'));
    t.after(() => fsp.rm(dirSfx, { recursive: true, force: true }));
    await saveProject(dirSfx, droppedSfx);
    await assert.rejects(
      buildProject({ dir: dirSfx, project: droppedSfx, log: () => {} }),
      'dropping only the SFX command should still fail to build on this padded row'
    );

    // Move ALONE -- Save stays live -- (one of the two fixes actually
    // offered above) is a real fix.
    const droppedMove = dropCommand(project, 'move');
    const dirMove = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-limitation-padded-move-'));
    t.after(() => fsp.rm(dirMove, { recursive: true, force: true }));
    await saveProject(dirMove, droppedMove);
    const built = await buildProject({ dir: dirMove, project: droppedMove, log: () => {} });
    assert.ok(built.romPath, 'dropping Move (with SFX still live) should be a real fix');
  }
);

// The zero-page kernel diet (docs/design-kernel-diet.md) closed this row for
// real; the padded sibling call keeps SFX_KERNEL_ALLOWANCE_STANDALONE's own
// refusal-advice path under test.
test(
  'sample-rpg with Save, Move and its one live item builds on MMC1 once a live SFX is added -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxFits(t, 1, [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }], { mapperLabel: 'MMC1' });
  }
);

test(
  'sample-rpg with Save, Move and its one live item, padded, still does not build on MMC1 once a live SFX is added -- keeps the advice path covered',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 1, [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }], { mapperLabel: 'MMC1' });
  }
);

// DECLARED DEVIATION history (see the section comment above): the design
// predicted MMC1 Save+Move-no-item as a razor-thin FIT control; the real,
// measured SFX allowance instead refused it, until the zero-page kernel diet
// (docs/design-kernel-diet.md) closed it for real, with room to spare. The
// padded sibling call keeps the refusal-advice path under test.
test(
  'sample-rpg with Save and Move, no item, builds on MMC1 once a live SFX is added -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxFits(t, 1, [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noItem: true,
      mapperLabel: 'MMC1'
    });
  }
);

test(
  'sample-rpg with Save and Move, no item, padded, still does not build on MMC1 once a live SFX is added -- keeps the advice path covered',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 1, [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noItem: true,
      mapperLabel: 'MMC1'
    });
  }
);

test(
  'sample-rpg with every shipped verb, Move and its one live item, no Save, builds on MMC3 once a live SFX is added -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxFits(t, 4, [...allSevenVerbsCommands(), { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noTitle: true,
      mapperLabel: 'MMC3'
    });
  }
);

test(
  'sample-rpg with every shipped verb, Move and its one live item, no Save, padded, still does not build on MMC3 once a live SFX is added -- keeps the advice path covered',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 4, [...allSevenVerbsCommands(), { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noTitle: true,
      mapperLabel: 'MMC3'
    });
  }
);

test(
  'sample-rpg with a live Save command and its one live item builds on UNROM 512 once a live SFX is added -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxFits(t, 30, [{ op: 'save' }], { mapperLabel: 'UNROM 512' });
  }
);

test(
  'sample-rpg with a live Save command and its one live item, padded, still does not build on UNROM 512 once a live SFX is added -- keeps the advice path covered',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 30, [{ op: 'save' }], { mapperLabel: 'UNROM 512' });
  }
);

test(
  'sample-rpg with every shipped verb, Move and its one live item, no Save, builds on UNROM 512 once a live SFX is added -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxFits(t, 30, [...allSevenVerbsCommands(), { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noTitle: true,
      mapperLabel: 'UNROM 512'
    });
  }
);

test(
  'sample-rpg with every shipped verb, Move and its one live item, no Save, padded, still does not build on UNROM 512 once a live SFX is added -- keeps the advice path covered',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    await assertSfxRefusal(t, 30, [...allSevenVerbsCommands(), { op: 'move', who: 'self', dir: 'up', dist: 16 }], {
      noTitle: true,
      mapperLabel: 'UNROM 512'
    });
  }
);

// The zero-page kernel diet (docs/design-kernel-diet.md) closed this row for
// real too, with real room to spare. The padded sibling test right below
// keeps the refusal-message advice path (Move or Save offered, neither
// Sting nor SFX) and the "dropping Move alone is a real fix" mitigation
// check under test.
test(
  'sample-rpg with Save, Move and its one live item builds on MMC1 with a live Sting AND a live SFX together -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
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
    assert.deepEqual(
      checkCapacity(project).problems.filter((p) => p.severity === 'error'),
      [],
      'sample-rpg with Save, Move, its one live item, a live Sting and a live SFX should now fit on MMC1'
    );
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-sting-limitation-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'MMC1: this combination should now assemble for real');
  }
);

test(
  'sample-rpg with Save, Move and its one live item, padded, still does not build on MMC1 with a live Sting AND a live SFX together -- keeps the advice path covered',
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
    inflate(project, 85); // recalibrated for phase 2 slice 3's ruling 7 (+11 to MOVE_KERNEL_ALLOWANCE) -- deficit 306, above Sting/SFX but at or below Move/Save

    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      /removing every Move command \(frees 348 bytes\) or every Save command \(frees 511 bytes\)/,
      `MMC1: dropping Move or Save, not SFX, should be the offered fix once the deficit exceeds what SFX alone frees -- got: ${message}`
    );
    assert.doesNotMatch(
      message,
      /Play a sound effect/,
      'SFX alone does not free enough to close this padded deficit, so it must not be offered as a solo fix'
    );

    // Dropping Move alone (Save's own command stays in the same event) is
    // still a real, buildable fix -- the refusal is accurate, not merely
    // differently worded.
    const droppedMove = structuredClone(project);
    const saveMoveEntity = droppedMove.maps[0].screens[0].entities.at(-3); // pushed first of the three appended above
    saveMoveEntity.props.event.pages[0].commands = saveMoveEntity.props.event.pages[0].commands.filter((c) => c.op !== 'move');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-sfx-sting-limitation-padded-'));
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

// The zero-page kernel diet (docs/design-kernel-diet.md) closed this row for
// real too, with real room to spare. The padded sibling test right below
// keeps the refusal-message advice path (Save offered, neither the bound
// tile's own allowance nor Move) and the "dropping Save alone is a real
// fix" mitigation check under test.
test(
  'sample-rpg with Save, Move (no item) and a live bound tile builds on MMC3 -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.items = []; // isolate the no-item row this refusal used to land on
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    const paintedId = project.maps[0].screens[0].metatiles[0];
    project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: paintedId }];
    assert.deepEqual(
      checkCapacity(project).problems.filter((p) => p.severity === 'error'),
      [],
      'sample-rpg with Save, Move (no item) and a live bound tile should now fit on MMC3'
    );
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-limitation-mmc3-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'Save, Move (no item) and a live bound tile should now assemble on MMC3');
  }
);

test(
  'sample-rpg with Save, Move (no item) and a live bound tile, padded, still does not build on MMC3 -- keeps the advice path covered',
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
    inflate(project, 100); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md -- deficit 480, above bound tile/Move but at or below Save

    const message = kernelShortfallMessage(project);
    // Save only: neither the bound tile's own allowance nor Move alone
    // clears this padded deficit.
    assert.match(message, /every Save command \(frees \d+ bytes\)/, 'the refusal should offer dropping Save');
    assert.doesNotMatch(
      message,
      /switch-bound tile/,
      'the bound tile\'s own allowance does not close this padded row alone -- offering it here would be ' +
        'advice that does not actually work'
    );
    assert.doesNotMatch(
      message,
      /every Move command/,
      'Move alone does not close this padded row either, once the bound tile\'s own real occupancy is added on top'
    );

    // Dropping the bound tile alone is NOT a real fix.
    const droppedBound = structuredClone(project);
    droppedBound.maps[0].screens[0].boundTiles = [];
    const dirBound = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-limitation-mmc3-padded-'));
    t.after(() => fsp.rm(dirBound, { recursive: true, force: true }));
    await saveProject(dirBound, droppedBound);
    await assert.rejects(
      buildProject({ dir: dirBound, project: droppedBound, log: () => {} }),
      'dropping only the bound tile should still fail to build on this padded row'
    );

    // Save (the one fix the message above actually offers) is a real fix.
    const droppedSave = dropCommand(project, 'save');
    const dirSave = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-limitation-save-padded-'));
    t.after(() => fsp.rm(dirSave, { recursive: true, force: true }));
    await saveProject(dirSave, droppedSave);
    const built = await buildProject({ dir: dirSave, project: droppedSave, log: () => {} });
    assert.ok(built.romPath, 'dropping Save (with the bound tile still live) should be a real fix');
  }
);

// The zero-page kernel diet (docs/design-kernel-diet.md) closed this row for
// real too. The padded sibling test right below keeps the "switch-bound
// tile is a named droppable fix" advice-path assertion under test.
test(
  'sample-rpg with Save, Move and its one live item builds on MMC1 once a bound tile is added -- the zero-page kernel diet closed this documented limitation for real',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    project.party[0].renamable = false;
    if (project.party[1]) project.party[1].renamable = false;
    project.cartridge.mapper = 1; // MMC1
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    const paintedId = project.maps[0].screens[0].metatiles[0];
    project.maps[0].screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: paintedId }];
    assert.deepEqual(
      checkCapacity(project).problems.filter((p) => p.severity === 'error'),
      [],
      'sample-rpg with Save, Move, its one live item and a live bound tile should now fit on MMC1'
    );
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-limitation-mmc1-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(built.romPath, 'Save, Move, its one live item and a live bound tile should now assemble on MMC1');
  }
);

test(
  'sample-rpg with Save, Move and its one live item, padded, still does not build on MMC1 once a bound tile is added -- keeps the advice path covered',
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
    inflate(project, 60); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md

    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      new RegExp(`every switch-bound tile \\(frees \\d+ bytes\\)`),
      'the refusal should name switch-bound tiles as one of its droppable fixes'
    );

    const droppedBound = structuredClone(project);
    droppedBound.maps[0].screens[0].boundTiles = [];
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-limitation-mmc1-padded-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, droppedBound);
    const built = await buildProject({ dir, project: droppedBound, log: () => {} });
    assert.ok(built.romPath, 'dropping the bound tile should still be a real fix, leaving the padded Save+Move+item row to build');
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
    // MMC1 and MMC3 fit. UNROM 512 used to be a real, documented limitation
    // (its own SAVE_KERNEL_ALLOWANCE_BY_MAPPER entry, the largest of the
    // three, the identical reason every other Save-adjacent shortfall in
    // this ledger already singles UNROM 512 out) -- the zero-page kernel
    // diet (docs/design-kernel-diet.md) closed it for real, so this row now
    // also just asserts a clean assertCovers pass; a padded sibling below
    // keeps the "every named Join" advice-path assertion under test.
    for (const mapper of CAPABLE_MAPPERS) {
      const entry = await measureCodeBytes(t, mapper, {
        withTitle: true,
        withSave: true,
        withHeroNaming: true,
        withJoinNaming: true
      });
      assertCovers({ mapper, codeBytes: entry.codeBytes }, kernelCodeBytes(entry.project, mapper), 'naming + title + Save (worst case)');
    }
  }
);

test(
  'in-game naming: rows 16-18, padded, still does not build on UNROM 512 -- keeps the advice path covered',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
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
    inflate(project, 85); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      /every named Join \(frees \d+ bytes\)/,
      `${u512.name}: naming + title + Save should refuse when padded, offering "every named Join" as one real fix`
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
      5367, // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
      'BASE_KERNEL_CODE_BYTES_BY_MAPPER should have a real, measured NROM entry now, not the UNROM 512 fallback'
    );

    // sample (NROM, titled) with hero naming: the one action board with real
    // margin -- assertCovers is meaningful here because checkCapacity does
    // not refuse this build.
    const entry = await measureCodeBytes(t, nrom, { fixture: SAMPLE, withHeroNaming: true });
    assertCovers({ mapper: nrom, codeBytes: entry.codeBytes }, kernelCodeBytes(entry.project, nrom), 'hero naming on sample, NROM');

    // The three small, save-capable action fixtures (each already carries a
    // live Save command, unlike sample itself) with hero naming added used
    // to be a real, documented limitation on all three boards -- the
    // zero-page kernel diet (docs/design-kernel-diet.md) closed all three
    // for real. The padded sibling test below keeps the "hero naming is a
    // named droppable fix" advice-path assertion under test.
    for (const [fixtureName, mapperId] of [
      ['sample-mmc1', 1],
      ['sample-mmc3', 4],
      ['sample-u512', 30]
    ]) {
      const project = await loadProject(path.join(ROOT, fixtureName));
      project.party[0].renamable = true;
      assert.deepEqual(
        checkCapacity(project).problems.filter((p) => p.severity === 'error'),
        [],
        `${fixtureName} (mapper ${mapperId}): hero naming should now fit`
      );
      // Round 1 review finding 4a: checkCapacity alone does not prove this
      // -- the six-hash fixture tests build these exact fixtures unmutated
      // (naming still off), so nothing else in the suite ever actually
      // assembled any of them with hero naming live. Never save back into
      // the checked-in fixture directory itself (CLAUDE.md's own
      // no-regeneration rule) -- the mutated project is saved to a scratch
      // copy instead.
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `forge-heroname-${fixtureName}-`));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      assert.ok(built.romPath, `${fixtureName} (mapper ${mapperId}): hero naming should now actually assemble`);
    }
  }
);

test(
  'in-game naming: the three small save-capable action fixtures with hero naming, padded, still do not build -- keeps the advice path covered',
  async () => {
    for (const [fixtureName, mapperId, pad] of [
      ['sample-mmc1', 1, 80],
      ['sample-mmc3', 4, 60],
      ['sample-u512', 30, 40]
    ]) {
      const project = await loadProject(path.join(ROOT, fixtureName));
      project.party[0].renamable = true;
      inflate(project, pad); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
      const message = kernelShortfallMessage(project);
      assert.match(
        message,
        /hero naming at the start of a new game \(frees \d+ bytes\)/,
        `${fixtureName} (mapper ${mapperId}): the padded refusal should offer removing hero naming as a fix`
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
    // The zero-page kernel diet (docs/design-kernel-diet.md) gave MMC1 real
    // headroom here, so this project needs padding to force a deficit small
    // enough for the token alone to be offered as a solo fix alongside
    // Move/Turn/Wait/Save.
    const project = await loadProject(SAMPLE_RPG);
    // Hero/Join naming off explicitly (phase 5): sample-rpg's own naming is
    // now live for real, and either would already need the name seed
    // (projectNeedsNameSeed) regardless of the token -- this case is about
    // the token alone.
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
    inflate(project, 92); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
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

// Phase 1a (docs/design-battle-animation.md §3.1) made validateProject
// refuse a stale animation reference. The three tests below load SAMPLE and
// then replace project.sprites.metasprites/animations wholesale with a
// small, deliberately-controlled array to isolate one table's own byte
// cost -- leaving SAMPLE's own actors, whose anims name SAMPLE's real
// (now-replaced) animation ids, stale by construction. None of these tests
// care what an actor draws; this clears every actor's anims/attackAnim so
// the resulting project stays valid under the new check, with the same
// actor count and shape kernelCodeBytes/kernelTableBytes already assumed.
function clearActorAnimationRefs(project) {
  for (const actor of project.sprites.actors) {
    if (actor.anims) actor.anims = { idle: null, walkDown: null, walkUp: null, walkSide: null };
    if (actor.battle) actor.battle.attackAnim = null;
  }
}

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
      clearActorAnimationRefs(project);
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
      clearActorAnimationRefs(project);
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
      clearActorAnimationRefs(project);
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

/**
 * measureWholeBank's own technique (nesasm's real "BANK n used/free" usage
 * table row), aimed at the kernel-HI bank instead of kernel-lo --
 * STREAMWORLD_KERNEL_HI_ALLOWANCE and STREAMWORLD_MT_PAL_KERNEL_HI_BYTES
 * (main/build/generate.js) are the only two terms ever charged against
 * kernel-hi rather than kernelCodeBytes/kernelTableBytes, so this is a
 * standalone helper rather than a reuse of measureWholeBank, which only
 * ever looks at kernelLoBank.
 */
async function measureKernelHiBank(t, mapper, project) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelhi-'));
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

// Part F (phase 2 slice 2b): STREAMWORLD_KERNEL_HI_ALLOWANCE's own comment in
// generate.js promises this exact equality test. The real cost is isolated
// the same way every other allowance on this page is -- build the project
// once streamed, once with every map's `streamed` flag forced off (so
// STREAMING_ENABLED and the whole `.if STREAMING_ENABLED` region drop out,
// per projectUsesStreaming/shared/streamlayout.js), and take the kernel-hi
// bank's real used-byte delta. Phase 2 slice 2b's Part D item 1 narrowed the
// engine's own availability to streamCapableFourScreen: UNROM 512 is the ONLY
// board a streamed map can build on any more (MMC1/MMC3 are only
// streamCapableTwoNametable -- "phase 3, addressing only" -- and are refused
// outright by validateStreamedMaps), so the per-mapper board list this test
// used to carry drops to that one entry. Both game types plus the `mixed`
// shape (a streamed map alongside ordinary ones) per the design contract's
// own required coverage.
test(
  'phase 2 slice 2b: STREAMWORLD_KERNEL_HI_ALLOWANCE + STREAMWORLD_MT_PAL_KERNEL_HI_BYTES equals the real kernel-hi cost of streaming, on UNROM 512 (the only streamCapableFourScreen board), both game types and the mixed shape',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const cases = [
      { gameType: 'action', mixed: false, label: 'action' },
      { gameType: 'rpg', mixed: false, label: 'rpg' },
      { gameType: 'action', mixed: true, label: 'action, mixed' }
    ];
    for (const { gameType, mixed, label } of cases) {
      const streamed = createStreamedProject({ gameType, mixed });
      const baseline = structuredClone(streamed);
      for (const map of baseline.maps) map.streamed = false;

      const streamedUsed = await measureKernelHiBank(t, mapper, streamed);
      const baselineUsed = await measureKernelHiBank(t, mapper, baseline);

      const delta = streamedUsed - baselineUsed;
      // Phase 2 slice 4b added four more unconditional-under-streaming
      // kernel-hi regions to streamworld.asm -- the window/camera-window
      // block, sw_update_player itself (game-type-varying),
      // sw_knockback_step (action/mixed only, `.if !BATTLE_ENABLED`), and
      // sw_hazard_probe_type (orchestrator ruling 9's straddling probe) --
      // all four are part of this same raw bank-total delta, since baseline
      // has STREAMING_ENABLED off entirely and none of streamworld.asm
      // assembles.
      // Phase 2 slice 7a added a FIFTH conditional region, gated on projectUsesText as well as
      // streaming -- absent from baseline regardless (baseline never assembles streamworld.asm at
      // all), so it inflates this raw delta only on a shape whose own default project happens to
      // use text (RPG, unconditionally) rather than being a further confound the delta already
      // cancels the way STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE's own text.inc growth is cancelled.
      const expected =
        STREAMWORLD_KERNEL_HI_ALLOWANCE +
        STREAMWORLD_MT_PAL_KERNEL_HI_BYTES +
        STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE +
        (gameType === 'action' ? STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE : 0) +
        streamworldUpdatePlayerKernelHiAllowance(streamed) +
        STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE +
        (projectUsesText(streamed) ? STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE : 0) +
        (projectUsesText(streamed) ? streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance(streamed) : 0) +
        (projectUsesText(streamed) ? STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE : 0);
      // fix round 1, finding 7/verification: printed on every run, pass or fail, not only in an
      // assertion failure message -- an independent, per-mapper figure a report can quote.
      console.log(`${mapper.name} (${label}): real kernel-hi delta ${delta} (expected ${expected})`);
      assert.equal(
        delta,
        expected,
        `${mapper.name} (${label}): real kernel-hi delta ${delta} != STREAMWORLD_KERNEL_HI_ALLOWANCE (${STREAMWORLD_KERNEL_HI_ALLOWANCE}) + STREAMWORLD_MT_PAL_KERNEL_HI_BYTES (${STREAMWORLD_MT_PAL_KERNEL_HI_BYTES}) + STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE (${STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE}) + knockback + sw_update_player + STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE (${STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE}) = ${expected}`
      );
    }
  }
);

/**
 * measureCodeBytes' own bank-line parse, but off a createStreamedProject-shaped
 * project directly rather than SAMPLE_RPG -- the whole-bank "used" total (not
 * codeBytes - reset-offset) is exactly measureKernelHiBank's own technique,
 * reused here for kernel-lo because a Move-on/off delta never touches the
 * lookup-table half of the bank (screen/entity content is switchable-window
 * data, not a kernel-lo table), so the raw bank delta and the code-only delta
 * are identical for this isolation.
 */
async function measureKernelLoBank(t, mapper, project) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernello-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const lines = [];
  await buildProject({ dir, project, log: (line) => lines.push(line) });
  const { kernelLoBank } = prgLayout(mapper);
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
  assert.ok(bankLine, `${mapper.name}: nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  assert.ok(Number.isFinite(used) && used > 0, `${mapper.name}: could not parse a used-byte count out of "${bankLine}"`);
  return used;
}

// Phase 2 slice 3 fix round 1, finding 2: STREAMWORLD_MOVE_KERNEL_ALLOWANCE is
// the kernel-lo-only supplement a live Move command costs beyond its ordinary
// MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE cost, charged only when the
// project both streams and moves something (generate.js's own `usesStreaming
// && usesMove` gate) -- the wider-bound wall arms and the sw_move_probe call
// sites move_tick grew in engine/entities.asm. Isolating it needs FOUR builds
// per case, not two: a streamed map's own Move-on/off delta also carries the
// ordinary MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE cost every project
// pays for a live Move regardless of streaming, so that ordinary delta (built
// off the identical project with every map's `streamed` forced false, the
// STREAMWORLD_KERNEL_HI_ALLOWANCE test's own technique above) has to be
// subtracted out to leave only the streamed-specific supplement. Both game
// types plus the `mixed` shape, matching the kernel-hi test's own coverage.
test(
  'phase 2 slice 3 fix 1, finding 2: STREAMWORLD_MOVE_KERNEL_ALLOWANCE equals the real kernel-lo supplement a live Move costs on a streamed map, on UNROM 512, both game types and the mixed shape',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const moveCommands = [{ op: 'move', who: 'self', dir: 'up', dist: 16 }];
    const cases = [
      { gameType: 'action', mixed: false, label: 'action' },
      { gameType: 'rpg', mixed: false, label: 'rpg' },
      { gameType: 'action', mixed: true, label: 'action, mixed' }
    ];
    for (const { gameType, mixed, label } of cases) {
      const streamedWithMove = createStreamedProject({ gameType, mixed, moveCommands });
      const streamedNoMove = createStreamedProject({ gameType, mixed });
      const ordinaryWithMove = structuredClone(streamedWithMove);
      for (const map of ordinaryWithMove.maps) map.streamed = false;
      const ordinaryNoMove = structuredClone(streamedNoMove);
      for (const map of ordinaryNoMove.maps) map.streamed = false;

      const swMoveUsed = await measureKernelLoBank(t, mapper, streamedWithMove);
      const swNoMoveUsed = await measureKernelLoBank(t, mapper, streamedNoMove);
      const ordMoveUsed = await measureKernelLoBank(t, mapper, ordinaryWithMove);
      const ordNoMoveUsed = await measureKernelLoBank(t, mapper, ordinaryNoMove);

      const streamedDelta = swMoveUsed - swNoMoveUsed;
      const ordinaryDelta = ordMoveUsed - ordNoMoveUsed;
      const supplement = streamedDelta - ordinaryDelta;
      // Phase 2 slice 7b: the same kernel-hi dlgTerm confound below has a
      // kernel-LO twin. STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE is
      // gated on `usesStreaming && usesText`, and only ever assembles on the
      // streamed side (an ordinary project's text.asm sites are the SAME
      // twelve `.if STREAMING_ENABLED` blocks, which assemble nothing at all
      // off a non-streamed project) -- so whenever the Move event's own
      // presence is what flips projectUsesText, streamedDelta carries this
      // term's full weight but ordinaryDelta carries none of it to cancel.
      const dlgTerm =
        (projectUsesText(streamedWithMove) ? STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE : 0) -
        (projectUsesText(streamedNoMove) ? STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE : 0);
      // Fix round 1 (A5): STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE picked up the identical
      // `usesText` gate this fix round (it was `usesStreaming` alone before, so it never
      // confounded this test until now) -- the same "any event exists" projectUsesText flip
      // dlgTerm already isolates carries this term's weight too, whenever the Move event's own
      // presence is what flips it.
      const oamTerm =
        (projectUsesText(streamedWithMove) ? STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE : 0) -
        (projectUsesText(streamedNoMove) ? STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE : 0);
      const expectedSupplement = STREAMWORLD_MOVE_KERNEL_ALLOWANCE + dlgTerm + oamTerm;
      // fix round 1, finding 7/verification: printed on every run, pass or
      // fail -- an independent, per-shape figure a report can quote.
      console.log(
        `${mapper.name} (${label}): STREAMWORLD_MOVE_KERNEL_ALLOWANCE supplement ${supplement} ` +
          `(streamed Move delta ${streamedDelta}, ordinary Move delta ${ordinaryDelta}, dialogue-lifecycle term ` +
          `${dlgTerm}, oam-guard term ${oamTerm}, expected ${expectedSupplement})`
      );
      assert.equal(
        supplement,
        expectedSupplement,
        `${mapper.name} (${label}): a live Move on a streamed map costs ${supplement} bytes of kernel-lo code beyond ` +
          `an ordinary map's own Move cost (streamed delta ${streamedDelta} - ordinary delta ${ordinaryDelta}), but ` +
          `STREAMWORLD_MOVE_KERNEL_ALLOWANCE reserves ${STREAMWORLD_MOVE_KERNEL_ALLOWANCE} (expected supplement ` +
          `${expectedSupplement} with the dialogue-lifecycle and oam-guard terms) -- re-measure and correct it.`
      );
    }
  }
);

// Phase 2 slice 3 fix round 1, finding 2: STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE
// is the kernel-hi charge for sw_move_probe/sw_move_probe_solid
// (engine/streamworld.asm), gated identically to the kernel-lo term above.
//
// A naive streamed-with-Move-minus-streamed-without-Move single delta is
// NOT this term in isolation: placing any live event on a screen at all --
// regardless of which command it carries -- turns projectUsesText on
// (shared/font.js: "only an event that survives to the ROM counts"), which
// grows the compiled event/text tables text.inc emits into this same
// kernel-hi bank by an amount that depends on the compiled command's own
// wire length (main/build/textcompile.js's 'move' case emits 4 bytes,
// [op, who, dir, dist]) -- entirely unrelated to sw_move_probe. Measured
// directly (a single build's own symbolAddr('sw_read_transaction') -
// symbolAddr('sw_move_probe_solid'), the exact span the `.if MOVE_ENABLED`
// bracket in streamworld.asm opens) this term is 80; the naive single delta
// reads 89 -- the missing 9 bytes are that same "any event exists" text.inc
// growth, confirmed by comparing a Move-carrying event against a same-shaped
// Wait-carrying one (delta 82, not 80: Wait's own 2-byte wire form still
// costs 2 fewer text.inc bytes than Move's 4-byte form, the remaining gap).
// The double-difference below is what actually cancels it: subtracting the
// IDENTICAL confound measured on the ordinary-map pair (a live Move event on
// a non-streamed map assembles no streamworld.asm content at all, so its own
// kernel-hi delta is pure text.inc growth, unrelated to streaming) leaves
// only the streaming-gated remainder -- 89 - 9 = 80, matching the direct
// span measurement exactly. This is the identical technique the kernel-lo
// term above already uses, and for the identical reason.
//
// Phase 2 slice 7a added a second, INDEPENDENT confound the double-difference
// below does NOT cancel: STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE is
// gated on `hasStreamed && projectUsesText`, and streamedWithMove's own live
// Move event trips projectUsesText the identical "any event exists" way the
// text.inc confound above already does -- but unlike text.inc, this term
// assembles NOTHING on the ordinary side regardless (streamworld.asm never
// assembles off a non-streamed project), so ordinaryDelta carries none of it
// to subtract out. Whenever streamedWithMove and streamedNoMove disagree on
// projectUsesText (true only when the game type does not already force text
// on by itself, e.g. plain action, non-mixed, no default title), that
// disagreement is a real, separate addend to the expected supplement.
test(
  'phase 2 slice 3 fix 1, finding 2: STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE equals the real kernel-hi cost of sw_move_probe/sw_move_probe_solid, on UNROM 512, both game types and the mixed shape',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const moveCommands = [{ op: 'move', who: 'self', dir: 'up', dist: 16 }];
    const cases = [
      { gameType: 'action', mixed: false, label: 'action' },
      { gameType: 'rpg', mixed: false, label: 'rpg' },
      { gameType: 'action', mixed: true, label: 'action, mixed' }
    ];
    for (const { gameType, mixed, label } of cases) {
      const streamedWithMove = createStreamedProject({ gameType, mixed, moveCommands });
      const streamedNoMove = createStreamedProject({ gameType, mixed });
      const ordinaryWithMove = structuredClone(streamedWithMove);
      for (const map of ordinaryWithMove.maps) map.streamed = false;
      const ordinaryNoMove = structuredClone(streamedNoMove);
      for (const map of ordinaryNoMove.maps) map.streamed = false;

      const swMoveUsed = await measureKernelHiBank(t, mapper, streamedWithMove);
      const swNoMoveUsed = await measureKernelHiBank(t, mapper, streamedNoMove);
      const ordMoveUsed = await measureKernelHiBank(t, mapper, ordinaryWithMove);
      const ordNoMoveUsed = await measureKernelHiBank(t, mapper, ordinaryNoMove);

      const streamedDelta = swMoveUsed - swNoMoveUsed;
      const ordinaryDelta = ordMoveUsed - ordNoMoveUsed;
      const supplement = streamedDelta - ordinaryDelta;
      // The dialogue-mapper term only ever appears on the streamed side (never ordinary), so it
      // is not cancelled by the streamed/ordinary double-difference the way text.inc growth is --
      // whenever the Move event's own presence is what flips projectUsesText, that difference is
      // a real, separate addend to the expected supplement.
      const dlgMapperHiTotal =
        STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE +
        streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance(streamedWithMove) +
        STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE;
      const dlgTerm =
        (projectUsesText(streamedWithMove) ? dlgMapperHiTotal : 0) -
        (projectUsesText(streamedNoMove) ? dlgMapperHiTotal : 0);
      const expectedSupplement = STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE + dlgTerm;
      console.log(
        `${mapper.name} (${label}): STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE supplement ${supplement} ` +
          `(streamed Move delta ${streamedDelta}, ordinary Move delta ${ordinaryDelta} -- the text.inc confound, ` +
          `dialogue-mapper term ${dlgTerm}, expected ${expectedSupplement})`
      );
      assert.equal(
        supplement,
        expectedSupplement,
        `${mapper.name} (${label}): a live Move on a streamed map costs ${supplement} bytes of kernel-hi code ` +
          `beyond an ordinary map's own Move cost (streamed delta ${streamedDelta} - ordinary delta ${ordinaryDelta}), ` +
          `but STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE reserves ${STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE} -- re-measure ` +
          'and correct it.'
      );
    }
  }
);

// Phase 2 slice 7a: STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE. Unlike
// the Move term above, this one needs no double-difference -- sw_dlg_mapper_
// start/end (engine/streamworld.asm) bracket a fixed `.if TEXT_ENABLED`
// span whose own byte count cannot be inflated or shrunk by how much text.inc
// content exists elsewhere in the same kernel-hi bank, so the direct span is
// itself the real, confound-free cost (the same cross-check the Move test's
// own comment already used to corroborate its double-difference result).
// Measured on RPG (text always on), an action project with a Say reachable
// only on an ORDINARY map (mixed, so streaming and text are both live without
// tripping the D.4 streamed-dialogue refusal), and the RPG+mixed shape --
// every shape the allowance is charged on, per the plan's own "action, RPG
// and mixed" requirement.
function withOrdinaryDialogue(project) {
  const map = project.maps.find((m) => !m.streamed);
  const screen = map.screens[0];
  screen.entities = screen.entities ?? [];
  screen.entities.push({
    actorId: 0,
    x: 32,
    y: 32,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hi.' }] }] } }
  });
  return project;
}

test(
  'phase 2 slice 7b fix round 2 (A4): STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE + STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE + STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE equals the real sw_dlg_mapper_start..end span, on UNROM 512, action+mixed+text, RPG, and RPG+mixed',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const cases = [
      { project: withOrdinaryDialogue(createStreamedProject({ gameType: 'action', mixed: true })), label: 'action, mixed, with text' },
      { project: createStreamedProject({ gameType: 'rpg' }), label: 'rpg' },
      { project: createStreamedProject({ gameType: 'rpg', mixed: true }), label: 'rpg, mixed' }
    ];
    for (const { project, label } of cases) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelhi-dlg-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const span = symbolAddr(symbols, 'sw_dlg_mapper_end') - symbolAddr(symbols, 'sw_dlg_mapper_start');
      const lifecycleTerrainConsumer = streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance(project);
      const expected =
        STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE +
        lifecycleTerrainConsumer +
        STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE;
      assert.equal(
        span,
        expected,
        `${mapper.name} (${label}): sw_dlg_mapper_start..end spans ${span} bytes but ` +
          `STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE (${STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE}) + ` +
          `STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE (${lifecycleTerrainConsumer}) + ` +
          `STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE (${STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE}) ` +
          `= ${expected} -- re-measure and correct it.`
      );
    }
  }
);

// Fix round 1/2 (A4): STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE is the combined span of
// the twelve sw_dlg_hi_* helper bodies the twelve named text.asm call sites now dispatch to
// instead of holding inline -- byte-for-byte the same code, moved, not new content, so it is named
// apart from both the 7a mapper term and the lifecycle/terrain/consumer term above. Fix round 1
// relocated the first six (text_open_row, text_open_attr, text_put_char, text_clear_step,
// text_choice_step, text_close_attr); fix round 2 relocated the remaining six (box_begin,
// text_tick, text_arrow_write, choice_cursor, text_close_step, text_close_attr_tail).
test(
  'phase 2 slice 7b fix round 2 (A4): STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE equals the real sw_dlg_relocated_start..end span, on UNROM 512, action+mixed+text, RPG, and RPG+mixed',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const cases = [
      { project: withOrdinaryDialogue(createStreamedProject({ gameType: 'action', mixed: true })), label: 'action, mixed, with text' },
      { project: createStreamedProject({ gameType: 'rpg' }), label: 'rpg' },
      { project: createStreamedProject({ gameType: 'rpg', mixed: true }), label: 'rpg, mixed' }
    ];
    for (const { project, label } of cases) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelhi-dlg-relocated-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const span = symbolAddr(symbols, 'sw_dlg_relocated_end') - symbolAddr(symbols, 'sw_dlg_relocated_start');
      assert.equal(
        span,
        STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE,
        `${mapper.name} (${label}): sw_dlg_relocated_start..end spans ${span} bytes but ` +
          `STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE reserves ${STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE} -- ` +
          're-measure and correct it.'
      );
    }
  }
);

// Fix round 2 (review round 2, finding A4): STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_
// KERNEL_HI_ALLOWANCE_BY_GAME_TYPE is the real sw_dlg_origin_capture..sw_dlg_relocated_start span
// -- slice 7b's own content inside sw_dlg_mapper_start..end, per Chris's 2026-09-25 ruling not to
// fold it into the 7a mapper term above (measured directly, not derived by subtracting the mapper
// and relocated terms from the combined span).
test(
  'phase 2 slice 7b fix round 2 (A4): STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE equals the real sw_dlg_origin_capture..sw_dlg_relocated_start span, on UNROM 512, action+mixed+text, RPG, and RPG+mixed',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const cases = [
      { project: withOrdinaryDialogue(createStreamedProject({ gameType: 'action', mixed: true })), label: 'action, mixed, with text' },
      { project: createStreamedProject({ gameType: 'rpg' }), label: 'rpg' },
      { project: createStreamedProject({ gameType: 'rpg', mixed: true }), label: 'rpg, mixed' }
    ];
    for (const { project, label } of cases) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelhi-dlg-lifecycle-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const span = symbolAddr(symbols, 'sw_dlg_relocated_start') - symbolAddr(symbols, 'sw_dlg_origin_capture');
      const expected = streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance(project);
      assert.equal(
        span,
        expected,
        `${mapper.name} (${label}): sw_dlg_origin_capture..sw_dlg_relocated_start spans ${span} bytes but ` +
          `STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE reserves ${expected} -- ` +
          're-measure and correct it.'
      );
    }
  }
);

// The mapper term itself: sw_dlg_mapper_start..sw_dlg_origin_capture, 7a's own content only, must
// stay at the measured 613 regardless of how much this slice's own lifecycle/terrain/consumer code
// grows beside it (the exact confusion Chris's 2026-09-25 ruling corrected).
test(
  'phase 2 slice 7b fix round 2 (A4): STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE equals the real sw_dlg_mapper_start..sw_dlg_origin_capture span, on UNROM 512, action+mixed+text, RPG, and RPG+mixed',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const cases = [
      { project: withOrdinaryDialogue(createStreamedProject({ gameType: 'action', mixed: true })), label: 'action, mixed, with text' },
      { project: createStreamedProject({ gameType: 'rpg' }), label: 'rpg' },
      { project: createStreamedProject({ gameType: 'rpg', mixed: true }), label: 'rpg, mixed' }
    ];
    for (const { project, label } of cases) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelhi-dlg-mapperonly-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const span = symbolAddr(symbols, 'sw_dlg_origin_capture') - symbolAddr(symbols, 'sw_dlg_mapper_start');
      assert.equal(
        span,
        STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE,
        `${mapper.name} (${label}): sw_dlg_mapper_start..sw_dlg_origin_capture spans ${span} bytes but ` +
          `STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE reserves ${STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE} -- ` +
          're-measure and correct it.'
      );
    }
  }
);

// Internal cross-check, not its own named allowance: the three round-1 sw_dlg_lifecycle_* brackets
// (the camera/OAM barrier's rebuild-before-release pairs at open and close, plus this fix round's
// own A1 draw_hud call inside close_b) are a SUBSET of the lifecycle/terrain/consumer lump above,
// not an addend to it -- this only confirms they still sum to what they always have (11 + 2 +
// 9-or-6, action vs rpg) and stay inside the lump's own measured span.
test(
  'phase 2 slice 7b fix round 2 (A4): the three round-1 sw_dlg_lifecycle_* brackets still sum correctly and stay inside the lifecycle/terrain/consumer span, on UNROM 512, action+mixed+text, RPG, and RPG+mixed',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const cases = [
      { project: withOrdinaryDialogue(createStreamedProject({ gameType: 'action', mixed: true })), label: 'action, mixed, with text', closeB: 9 },
      { project: createStreamedProject({ gameType: 'rpg' }), label: 'rpg', closeB: 6 },
      { project: createStreamedProject({ gameType: 'rpg', mixed: true }), label: 'rpg, mixed', closeB: 6 }
    ];
    for (const { project, label, closeB } of cases) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelhi-dlg-lifecycle-brackets-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const openSpan = symbolAddr(symbols, 'sw_dlg_lifecycle_open_end') - symbolAddr(symbols, 'sw_dlg_lifecycle_open_start');
      const closeASpan = symbolAddr(symbols, 'sw_dlg_lifecycle_close_a_end') - symbolAddr(symbols, 'sw_dlg_lifecycle_close_a_start');
      const closeBSpan = symbolAddr(symbols, 'sw_dlg_lifecycle_close_b_end') - symbolAddr(symbols, 'sw_dlg_lifecycle_close_b_start');
      const bracketSum = openSpan + closeASpan + closeBSpan;
      const lumpSpan = symbolAddr(symbols, 'sw_dlg_relocated_start') - symbolAddr(symbols, 'sw_dlg_origin_capture');
      assert.equal(openSpan, 11, `${mapper.name} (${label}): sw_dlg_lifecycle_open_start..end`);
      assert.equal(closeASpan, 2, `${mapper.name} (${label}): sw_dlg_lifecycle_close_a_start..end`);
      assert.equal(closeBSpan, closeB, `${mapper.name} (${label}): sw_dlg_lifecycle_close_b_start..end (A1's draw_hud fix, action-only)`);
      assert.ok(
        bracketSum <= lumpSpan,
        `${mapper.name} (${label}): the three brackets (${bracketSum}) must be a subset of the lifecycle/terrain/consumer span (${lumpSpan})`
      );
    }
  }
);

// The gate's off side: sw_dlg_mapper_start/end themselves are unconditional boundary labels
// (placed either side of the `.if TEXT_ENABLED` span, engine/streamworld.asm) -- they always
// exist, so "no text" is not "the symbol is absent" but "the span between them is exactly zero,"
// confirmed directly rather than assumed.
test(
  'phase 2 slice 7a: a streamed project with no text assembles zero bytes between sw_dlg_mapper_start and sw_dlg_mapper_end',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const project = createStreamedProject({ gameType: 'action' });
    project.project.titleMap = null; // the default project's own title screen is itself a text source (projectUsesEffectiveTitle) -- must be off too, or this "no text" case would not isolate the gate at all
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernelhi-dlg-off-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    const built = await buildProject({ dir, project, log: () => {} });
    const symbols = await fsp.readFile(built.symbolPath, 'utf8');
    assert.equal(
      symbolAddr(symbols, 'sw_dlg_mapper_end') - symbolAddr(symbols, 'sw_dlg_mapper_start'),
      0,
      `${mapper.name}: a text-free project must assemble zero bytes of dialogue-mapper code`
    );
  }
);

// Phase 2 slice 7b: STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE (kernel-lo). The 13 call
// sites this term covers -- 12 in engine/text.asm's box_state machine plus the boot.asm poll that
// releases the camera hold -- are each bracketed by their own pair of unconditional boundary
// labels, the same Part F technique the kernel-lo tests below use, so the direct span of each site
// on a single build is the exact, confound-free cost. Measured on the same three shapes the sibling
// kernel-hi test above uses (action+mixed+text, RPG, RPG+mixed) -- flat across all three, since
// the term is gated on `usesStreaming && usesText`, not on which content produced the text.
// Fix round 2 (review round 2, finding A4): Chris's 2026-09-25 ruling -- "Name and equality-assert
// the kernel-lo terms per site." Each site now names its OWN constant (all twelve text.asm sites
// measure 7, the boot.asm camrelease poll measures 3), asserted individually below, not only as a
// combined sum.
const STREAMWORLD_DIALOGUE_LIFECYCLE_SITES = [
  ['box_begin_guard', STREAMWORLD_DIALOGUE_BOX_BEGIN_KERNEL_ALLOWANCE],
  ['text_tick_guard', STREAMWORLD_DIALOGUE_TEXT_TICK_KERNEL_ALLOWANCE],
  ['text_open_row_guard', STREAMWORLD_DIALOGUE_TEXT_OPEN_ROW_KERNEL_ALLOWANCE],
  ['text_open_attr_guard', STREAMWORLD_DIALOGUE_TEXT_OPEN_ATTR_KERNEL_ALLOWANCE],
  ['text_put_char_guard', STREAMWORLD_DIALOGUE_TEXT_PUT_CHAR_KERNEL_ALLOWANCE],
  ['text_arrow_write_guard', STREAMWORLD_DIALOGUE_TEXT_ARROW_WRITE_KERNEL_ALLOWANCE],
  ['text_clear_step_guard', STREAMWORLD_DIALOGUE_TEXT_CLEAR_STEP_KERNEL_ALLOWANCE],
  ['text_choice_step_guard', STREAMWORLD_DIALOGUE_TEXT_CHOICE_STEP_KERNEL_ALLOWANCE],
  ['choice_cursor_guard', STREAMWORLD_DIALOGUE_CHOICE_CURSOR_KERNEL_ALLOWANCE],
  ['text_close_step_guard', STREAMWORLD_DIALOGUE_TEXT_CLOSE_STEP_KERNEL_ALLOWANCE],
  ['text_close_attr_guard', STREAMWORLD_DIALOGUE_TEXT_CLOSE_ATTR_KERNEL_ALLOWANCE],
  [['text_close_attr_tail_gs', 'text_close_attr_tail_ge'], STREAMWORLD_DIALOGUE_TEXT_CLOSE_ATTR_TAIL_KERNEL_ALLOWANCE],
  [['camrelease_call_gs', 'camrelease_call_ge'], STREAMWORLD_DIALOGUE_CAMRELEASE_KERNEL_ALLOWANCE]
];

function boundarySpan(symbols, site) {
  const [start, end] = Array.isArray(site) ? site : [`${site}_start`, `${site}_end`];
  return symbolAddr(symbols, end) - symbolAddr(symbols, start);
}

test(
  "phase 2 slice 7b fix round 2 (A4): each of the 13 kernel-lo dialogue call sites equals its own named allowance, on UNROM 512, action+mixed+text, RPG, and RPG+mixed",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const cases = [
      { project: withOrdinaryDialogue(createStreamedProject({ gameType: 'action', mixed: true })), label: 'action, mixed, with text' },
      { project: createStreamedProject({ gameType: 'rpg' }), label: 'rpg' },
      { project: createStreamedProject({ gameType: 'rpg', mixed: true }), label: 'rpg, mixed' }
    ];
    for (const { project, label } of cases) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernello-dlg-lifecycle-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      let sum = 0;
      for (const [site, expected] of STREAMWORLD_DIALOGUE_LIFECYCLE_SITES) {
        const span = boundarySpan(symbols, site);
        sum += span;
        const siteName = Array.isArray(site) ? site[0].replace(/_gs$/, '') : site;
        assert.equal(
          span,
          expected,
          `${mapper.name} (${label}): ${siteName} spans ${span} bytes but its own named allowance reserves ${expected} -- ` +
            're-measure and correct it.'
        );
      }
      assert.equal(
        sum,
        STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE,
        `${mapper.name} (${label}): the 13 lifecycle call sites sum to ${sum} bytes but ` +
          `STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE reserves ${STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE} -- ` +
          're-measure and correct it.'
      );
    }
  }
);

test(
  'phase 2 slice 7b: a streamed project with no text sums zero bytes across the 13 dialogue-lifecycle call sites',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const project = createStreamedProject({ gameType: 'action' });
    project.project.titleMap = null;
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernello-dlg-lifecycle-off-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    const built = await buildProject({ dir, project, log: () => {} });
    const symbols = await fsp.readFile(built.symbolPath, 'utf8');
    const sum = STREAMWORLD_DIALOGUE_LIFECYCLE_SITES.reduce((total, [site]) => total + boundarySpan(symbols, site), 0);
    assert.equal(
      sum,
      0,
      `${mapper.name}: a text-free project must assemble zero bytes across the dialogue-lifecycle call sites`
    );
  }
);

// Phase 2 slice 7b: STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE (kernel-lo) -- the nmi_oam_guard_
// start/end span in engine/boot.asm's nmi:. Fix round 1 (review round 1, finding A5): the only
// production writer of cam_dirty during a dialogue is text.asm's own `.if TEXT_ENABLED` lifecycle,
// so this guard is now nested `.if STREAMING_ENABLED / .if TEXT_ENABLED` too (byte-identity fix --
// it was unconditional inside just `.if STREAMING_ENABLED` before, costing a streaming-without-
// text build 4 bytes its pre-7b build never paid). Gated on usesStreaming && usesText, the
// STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE precedent -- action's own default project here
// carries no text, RPG's does, so the two cases exercise both sides of the gate directly.
test(
  'phase 2 slice 7b: STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE equals the real nmi_oam_guard_start..end span, both game types, with and without text',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    for (const gameType of ['action', 'rpg']) {
      const project = createStreamedProject({ gameType });
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernello-oamguard-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const span = symbolAddr(symbols, 'nmi_oam_guard_end') - symbolAddr(symbols, 'nmi_oam_guard_start');
      const expected = projectUsesText(project) ? STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE : 0;
      assert.equal(
        span,
        expected,
        `${mapper.name} (${gameType}): nmi_oam_guard_start..end spans ${span} bytes but expected ${expected} ` +
          `(STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE ${STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE}, gated on usesText) -- ` +
          're-measure and correct it.'
      );
    }
    // Off side: a non-streamed project still carries the unconditional boundary labels (present
    // regardless of STREAMING_ENABLED, required by the single-build span technique itself), so
    // "no streaming" is a real, direct zero rather than a missing symbol.
    const ordinary = createStreamedProject({ gameType: 'action' });
    for (const map of ordinary.maps) map.streamed = false;
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernello-oamguard-off-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    const built = await buildProject({ dir, project: ordinary, log: () => {} });
    const symbols = await fsp.readFile(built.symbolPath, 'utf8');
    assert.equal(
      symbolAddr(symbols, 'nmi_oam_guard_end') - symbolAddr(symbols, 'nmi_oam_guard_start'),
      0,
      `${mapper.name}: a non-streamed project must assemble zero bytes for the OAM guard`
    );
  }
);

// Fix round 1, finding A4/Chris's ruling 2026-09-25(b): STREAMWORLD_NAMEENTRY_ACTION_KERNEL_ALLOWANCE,
// nameentry.asm's own streamed-dispatch delta on the kernel-lo action placement -- the twin of
// STREAMWORLD_NAMEENTRY_BATTLE_ALLOWANCE (main/build/battletables.js) on the banked RPG placement.
// Unlike that whole-region delta, nameentry.asm already carries its own unconditional boundary label
// pairs around each of its three `.if STREAMING_ENABLED` sites (nameentry_raise_step_gs/_ge,
// nameentry_push_guard_start/_end, nameentry_queue_cell_gs/_ge), so a single naming-on build's own
// symbol table gives the exact combined span directly -- no on/off diff, and so no exposure to the
// projectUsesText confound generate.js's own comment on this constant found and had to control for
// (turning naming on with no other text source also flips STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_
// ALLOWANCE and STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE on, which this bracket technique never touches
// at all). Both game types, since nameentry.asm's header claims the identical source assembles to
// identical bytes regardless of placement.
test(
  "phase 2 slice 7b fix round 1 (A4/Chris's ruling (b)): STREAMWORLD_NAMEENTRY_ACTION_KERNEL_ALLOWANCE " +
    'equals the real sum of nameentry.asm\'s three streamed-dispatch brackets, both game types',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    for (const gameType of ['action', 'rpg']) {
      const project = createStreamedProject({ gameType, naming: true });
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernello-nameentry-action-'));
      t.after(() => fsp.rm(dir, { recursive: true, force: true }));
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const raiseSpan = symbolAddr(symbols, 'nameentry_raise_step_ge') - symbolAddr(symbols, 'nameentry_raise_step_gs');
      const pushSpan = symbolAddr(symbols, 'nameentry_push_guard_end') - symbolAddr(symbols, 'nameentry_push_guard_start');
      const queueSpan = symbolAddr(symbols, 'nameentry_queue_cell_ge') - symbolAddr(symbols, 'nameentry_queue_cell_gs');
      const span = raiseSpan + pushSpan + queueSpan;
      assert.equal(
        span,
        STREAMWORLD_NAMEENTRY_ACTION_KERNEL_ALLOWANCE,
        `${mapper.name} (${gameType}): nameentry.asm's three streamed-dispatch brackets sum to ${span} bytes ` +
          `but expected STREAMWORLD_NAMEENTRY_ACTION_KERNEL_ALLOWANCE (${STREAMWORLD_NAMEENTRY_ACTION_KERNEL_ALLOWANCE}) ` +
          '-- re-measure and correct it.'
      );
    }
  }
);

// A project that genuinely does not fit alongside this new term still gets checkCapacity's own
// ordinary refusal, worded for whichever bank actually overflowed -- Chris's ruling 2026-09-25(b)'s
// own requirement -- rather than silently overflowing. A large streamed grid with naming on already
// overflows the LOOKUP TABLE budget (a different ledger than kernelCodeBytes) at this project's
// default size, which is exactly the genuine-overflow case the ruling anticipated, not a bug in this
// term's accounting.
test(
  "phase 2 slice 7b fix round 1 (A4/Chris's ruling (b)): a genuinely overfull action+streamed+naming " +
    'project still gets an ordinary capacity refusal, not a silent overflow',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = createStreamedProject({ gameType: 'action', mixed: true, naming: true });
    project.maps.find((m) => m.streamed).screens[0].entities.push({
      x: 8,
      y: 8,
      actorId: 0,
      props: { dialogue: 'Hi' }
    });
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-kernello-nameentry-action-overfull-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await assert.rejects(
      () => buildProject({ dir, project, log: () => {} }),
      (err) => /lookup tables need \d+ bytes but only \d+ are free/.test(err.message),
      'an action project this large, streamed, with naming and a real dialogue string on, should refuse ' +
        'with an ordinary named-Forge capacity message, not assemble silently or throw something else'
    );
  }
);

// Part F: each kernel-LO streaming term, measured individually off a real
// build's own symbol table rather than the bank-total delta the kernel-hi
// test above uses -- these sites are call-site additions inside existing
// (or new) kernel-lo routines, each bracketed by its own pair of
// unconditional boundary labels (see STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE's
// own comment in generate.js for why), so `symbolAddr(after) -
// symbolAddr(before)` on a single streamed build gives the exact byte count
// directly -- no ON/OFF diff needed, because the `.if STREAMING_ENABLED`
// bracket itself is the only thing between those two labels. Only UNROM 512
// can ever assemble this code (Part D item 1); both game types plus the
// `mixed` shape are checked since kernelCodeBytes' own formula must hold for
// all three, matching the kernel-hi test just above.
async function measureStreamedSpan(mapper, project, startLabel, endLabel) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-streamlo-'));
  try {
    const built = await buildProject({ dir, project, log: () => {} });
    const symbols = await fsp.readFile(built.symbolPath, 'utf8');
    return symbolAddr(symbols, endLabel) - symbolAddr(symbols, startLabel);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test(
  'phase 2 slice 2b, Part F: every kernel-lo streaming term equals the real span nesasm assembled, on UNROM 512, both game types and the mixed shape',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const mapper = resolveMapper(30);
    const SITES = [
      ['STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE', STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE, 'boot_streamed_landing', 'boot_draw_ordinary'],
      ['STREAMWORLD_REDRAW_KERNEL_ALLOWANCE', STREAMWORLD_REDRAW_KERNEL_ALLOWANCE, 'redraw_screen_dispatch', 'redraw_screen_ordinary'],
      [
        'STREAMWORLD_SET_SCREEN_PTR_KERNEL_ALLOWANCE',
        STREAMWORLD_SET_SCREEN_PTR_KERNEL_ALLOWANCE,
        'set_screen_ptr',
        'set_screen_ptr_ordinary'
      ],
      // Fix round 1 (finding 1) moved the real crossing entirely into
      // sw_pstep_left/right/up/down (engine/streamworld.asm); cross_left/
      // right/up/down reverted to pure ordinary-screen code with no
      // sub-span of their own to bracket (no more cross_left_ord etc.), so
      // there is no per-direction site left to measure here -- only the
      // cross_left..cross_none region delta below, which still covers
      // cross_set_screen's own call sites inside these four routines.
      [
        'STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE (helper)',
        13,
        'cross_set_screen',
        'cross_none'
      ],
      [
        'STREAMWORLD_INIT_SESSION_KERNEL_ALLOWANCE',
        STREAMWORLD_INIT_SESSION_KERNEL_ALLOWANCE,
        'init_session_streamed_dispatch',
        'init_session_streamed_done'
      ],
      [
        'STREAMWORLD_ORDINARY_CAM_RESET_KERNEL_ALLOWANCE',
        STREAMWORLD_ORDINARY_CAM_RESET_KERNEL_ALLOWANCE,
        'redraw_screen_cam_reset',
        'redraw_screen_cam_reset_done'
      ],
      [
        'STREAMWORLD_UPDATE_PLAYER_DISPATCH_KERNEL_ALLOWANCE',
        STREAMWORLD_UPDATE_PLAYER_DISPATCH_KERNEL_ALLOWANCE,
        'update_player_knock',
        'update_player_knock_ord'
      ]
    ];
    for (const gameType of ['action', 'rpg']) {
      const project = createStreamedProject({ gameType });
      project.cartridge.mapper = mapper.id;
      for (const [label, expected, start, end] of SITES) {
        const real = await measureStreamedSpan(mapper, project, start, end);
        assert.equal(real, expected, `${label} on ${gameType}: real span ${real} != ${expected}`);
      }
      // STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE's 8-call-site half: not a
      // single bracketed span (the 8 sites are scattered two-per-direction
      // across cross_left/right/up/down), so measured as the real delta the
      // full cross_left..cross_none region grows by when STREAMING_ENABLED
      // flips on, same mapper/mirroring (and so identical CAMERA_SLIDE_H/V)
      // both sides -- same technique the kernel-hi test above uses. Fix
      // round 1 (finding 1) moved the real crossing out of cross_left/right/
      // up/down entirely (generate.js's own STREAMWORLD_CROSS_TRANSLATE_
      // KERNEL_ALLOWANCE comment), so this region's only remaining
      // streaming-on cost is this term's own 21 (the cross_set_screen
      // helper plus its 8 call-site deltas) -- the old +96 dead-dispatch
      // term is gone, not merely relabeled.
      const baseline = structuredClone(project);
      for (const map of baseline.maps) map.streamed = false;
      const streamedCrossRegion = await measureStreamedSpan(mapper, project, 'cross_left', 'cross_none');
      const baselineCrossRegion = await measureStreamedSpan(mapper, baseline, 'cross_left', 'cross_none');
      const crossRegionDelta = streamedCrossRegion - baselineCrossRegion;
      const expectedCrossRegionDelta = STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE;
      assert.equal(
        crossRegionDelta,
        expectedCrossRegionDelta,
        `cross_left..cross_none region on ${gameType}: real streaming-on delta ${crossRegionDelta} != ` +
          `STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE (${STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE})`
      );
      // spawn_entities: dispatch preamble + spawn_streamed's own body, two
      // spans summed into the one named allowance (generate.js's own comment).
      const dispatch = await measureStreamedSpan(mapper, project, 'spawn_clear_dispatch', 'spawn_clear_ord');
      const body = await measureStreamedSpan(mapper, project, 'spawn_streamed', 'update_entities');
      assert.equal(
        dispatch + body,
        STREAMWORLD_SPAWN_KERNEL_ALLOWANCE,
        `STREAMWORLD_SPAWN_KERNEL_ALLOWANCE on ${gameType}: real span ${dispatch + body} != ${STREAMWORLD_SPAWN_KERNEL_ALLOWANCE}`
      );
      // apply_map_music: named at 0 (generate.js's own comment) -- the span
      // measured here is NOT the delta (it includes the shared, unconditional
      // `lda screen_map,y` after the branch too), only a regression guard that
      // it stays the same fixed size the ldy-swap alone predicts.
      assert.equal(STREAMWORLD_MUSIC_KERNEL_ALLOWANCE, 0, 'apply_map_music: ldy <ord_screen and ldy <flat_screen are equal length');
      const musicSpan = await measureStreamedSpan(mapper, project, 'apply_map_music', 'apply_map_music_direct');
      assert.equal(musicSpan, 5, `apply_map_music span on ${gameType}: ${musicSpan} != 5 (a 2-byte ldy + 3-byte lda screen_map,y)`);
      // Phase 2 slice 4b: sw_event_freeze's own two call sites, summed into
      // one named term -- the STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_
      // ALLOWANCE precedent for a two-call-site sum.
      const doTalkFreeze = await measureStreamedSpan(mapper, project, 'do_talk_freeze_dispatch', 'do_talk_freeze_done');
      const idleFreeze = await measureStreamedSpan(mapper, project, 'main_loop_idle_freeze_dispatch', 'main_loop_idle_freeze_done');
      assert.equal(
        doTalkFreeze + idleFreeze,
        STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE,
        `STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE on ${gameType}: real span ${doTalkFreeze + idleFreeze} != ${STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE}`
      );
      // Phase 2 slice 4b, orchestrator ruling 9: player_hazard's own dx-
      // capture (5 bytes) plus its map_is_streamed dispatch into
      // sw_hazard_probe_type (10 bytes), summed into one named term the
      // same way as the event-freeze pair just above.
      const hazardDxCapture = await measureStreamedSpan(
        mapper,
        project,
        'player_hazard_dx_capture',
        'player_hazard_dx_capture_end'
      );
      const hazardDispatch = await measureStreamedSpan(mapper, project, 'player_hazard_dispatch', 'player_hazard_dispatch_end');
      assert.equal(
        hazardDxCapture + hazardDispatch,
        STREAMWORLD_HAZARD_KERNEL_ALLOWANCE,
        `STREAMWORLD_HAZARD_KERNEL_ALLOWANCE on ${gameType}: real span ${hazardDxCapture + hazardDispatch} != ${STREAMWORLD_HAZARD_KERNEL_ALLOWANCE}`
      );
      // Phase 2 slice 4b, orchestrator ruling 9: sw_hazard_probe_type itself
      // -- kernel-hi, unconditional, measured the same single-build
      // bracketed-span technique as sw_win_col_inc/sw_win_arm_region_end
      // just below.
      const hazardProbeSpan = await measureStreamedSpan(mapper, project, 'sw_hazard_probe_type', 'sw_hazard_probe_type_end');
      assert.equal(
        hazardProbeSpan,
        STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE,
        `STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE on ${gameType}: real span ${hazardProbeSpan} != ${STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE}`
      );
      // Phase 2 slice 4b: the kernel-hi window/camera-window region -- same
      // single-build bracketed-span technique as the kernel-lo sites above,
      // just landing in the $E000 half instead of $C000.
      const windowSpan = await measureStreamedSpan(mapper, project, 'sw_win_col_inc', 'sw_win_arm_region_end');
      assert.equal(
        windowSpan,
        STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE,
        `STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE on ${gameType}: real span ${windowSpan} != ${STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE}`
      );
      // Phase 2 slice 4b: sw_update_player itself, game-type-varying (two
      // internal blocks are each gated on BATTLE_ENABLED in opposite
      // directions -- see streamworldUpdatePlayerKernelHiAllowance's own
      // comment).
      const updatePlayerSpan = await measureStreamedSpan(mapper, project, 'sw_update_player', 'sw_update_player_end');
      const expectedUpdatePlayer = streamworldUpdatePlayerKernelHiAllowance(project);
      assert.equal(
        updatePlayerSpan,
        expectedUpdatePlayer,
        `sw_update_player span on ${gameType}: real span ${updatePlayerSpan} != ${expectedUpdatePlayer}`
      );
      // Phase 2 slice 4b: sw_knockback_step is gated `.if !BATTLE_ENABLED`
      // (action/mixed only) -- an RPG build assembles no symbol for it at
      // all, confirmed here as a real rejection rather than assumed, not
      // skipped.
      if (gameType === 'action') {
        const knockbackSpan = await measureStreamedSpan(mapper, project, 'sw_knockback_step', 'sw_knockback_step_end');
        assert.equal(
          knockbackSpan,
          STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE,
          `STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE on ${gameType}: real span ${knockbackSpan} != ${STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE}`
        );
      } else {
        await assert.rejects(
          () => measureStreamedSpan(mapper, project, 'sw_knockback_step', 'sw_knockback_step_end'),
          `sw_knockback_step must assemble no symbol at all on ${gameType} (.if !BATTLE_ENABLED is false)`
        );
      }
      // Phase 2 slice 5: hurt_player's own map_is_streamed dispatch
      // (engine/combat.asm) and init_session's own sw_kb_timer/sw_kb_acc
      // clear -- both kernel-lo, both gated identically to sw_knockback_step
      // above (`.if !BATTLE_ENABLED`, action/mixed only). hurt_player itself
      // does not exist on an RPG build at all (the whole routine is wrapped
      // in that same `.if`), so its bracket rejects there the same way
      // sw_knockback_step's own lookup does, above; init_session_kb_dispatch/
      // init_session_kb_done DO both exist on every game type (init_session
      // itself is unconditional), collapsing to a real 0-byte span on RPG
      // rather than throwing.
      if (gameType === 'action') {
        const hurtPlayerKbSpan = await measureStreamedSpan(mapper, project, 'hurt_player_kb_sw_dispatch', 'hurt_player_kb_sw_done');
        assert.equal(
          hurtPlayerKbSpan,
          STREAMWORLD_HURT_PLAYER_KERNEL_ALLOWANCE,
          `STREAMWORLD_HURT_PLAYER_KERNEL_ALLOWANCE on ${gameType}: real span ${hurtPlayerKbSpan} != ${STREAMWORLD_HURT_PLAYER_KERNEL_ALLOWANCE}`
        );
      } else {
        await assert.rejects(
          () => measureStreamedSpan(mapper, project, 'hurt_player_kb_sw_dispatch', 'hurt_player_kb_sw_done'),
          `hurt_player must assemble no symbol at all on ${gameType} (.if !BATTLE_ENABLED is false)`
        );
      }
      const initKbSpan = await measureStreamedSpan(mapper, project, 'init_session_kb_dispatch', 'init_session_kb_done');
      const expectedInitKbSpan = gameType === 'action' ? STREAMWORLD_KB_INIT_KERNEL_ALLOWANCE : 0;
      assert.equal(
        initKbSpan,
        expectedInitKbSpan,
        `STREAMWORLD_KB_INIT_KERNEL_ALLOWANCE on ${gameType}: real span ${initKbSpan} != ${expectedInitKbSpan}`
      );
    }
    // sw_update_player is flat across the mixed shape too, matching
    // STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE's own
    // comment -- checked directly here, not assumed from the action figure.
    const mixedProject = createStreamedProject({ gameType: 'action', mixed: true });
    mixedProject.cartridge.mapper = mapper.id;
    const mixedUpdatePlayerSpan = await measureStreamedSpan(mapper, mixedProject, 'sw_update_player', 'sw_update_player_end');
    assert.equal(
      mixedUpdatePlayerSpan,
      STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE.action,
      `sw_update_player span on mixed: real span ${mixedUpdatePlayerSpan} != ${STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE.action}`
    );
    // Phase 2 slice 5: the three new knockback terms are flat across the
    // mixed shape too, checked directly the same way as sw_update_player
    // just above.
    const mixedKnockbackSpan = await measureStreamedSpan(mapper, mixedProject, 'sw_knockback_step', 'sw_knockback_step_end');
    assert.equal(
      mixedKnockbackSpan,
      STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE,
      `sw_knockback_step span on mixed: real span ${mixedKnockbackSpan} != ${STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE}`
    );
    const mixedHurtPlayerKbSpan = await measureStreamedSpan(mapper, mixedProject, 'hurt_player_kb_sw_dispatch', 'hurt_player_kb_sw_done');
    assert.equal(
      mixedHurtPlayerKbSpan,
      STREAMWORLD_HURT_PLAYER_KERNEL_ALLOWANCE,
      `hurt_player_kb span on mixed: real span ${mixedHurtPlayerKbSpan} != ${STREAMWORLD_HURT_PLAYER_KERNEL_ALLOWANCE}`
    );
    const mixedInitKbSpan = await measureStreamedSpan(mapper, mixedProject, 'init_session_kb_dispatch', 'init_session_kb_done');
    assert.equal(
      mixedInitKbSpan,
      STREAMWORLD_KB_INIT_KERNEL_ALLOWANCE,
      `init_session_kb span on mixed: real span ${mixedInitKbSpan} != ${STREAMWORLD_KB_INIT_KERNEL_ALLOWANCE}`
    );
    // RPG-only: check_encounter's own guard (rpg.asm assembles entirely
    // inside `.if BATTLE_ENABLED`).
    const rpgProject = createStreamedProject({ gameType: 'rpg' });
    rpgProject.cartridge.mapper = mapper.id;
    const encounterSpan = await measureStreamedSpan(mapper, rpgProject, 'check_encounter_dispatch', 'check_encounter_ord');
    // start_encounter's own half of the brief's combined "check_encounter/
    // start_encounter" term: the identical cur_map-shortcut addition, same
    // 9-byte shape (lda/beq/lda-or-ldy/jmp).
    const startEncounterSpan = await measureStreamedSpan(mapper, rpgProject, 'start_encounter_dispatch', 'start_encounter_ord_screen');
    assert.equal(
      encounterSpan + startEncounterSpan,
      STREAMWORLD_ENCOUNTER_KERNEL_ALLOWANCE,
      `check_encounter+start_encounter span: ${encounterSpan}+${startEncounterSpan} != ${STREAMWORLD_ENCOUNTER_KERNEL_ALLOWANCE}`
    );
    // Fix round 1, finding 8: call_battle's own strip-cancel (engine/banks.asm)
    // only exists inside `.if STREAMING_ENABLED` nested inside `.if
    // BATTLE_ENABLED`, i.e. gated on usesStreaming && usesBattleBase
    // (main/build/generate.js) exactly the way rpgProject (streamed, RPG,
    // rpgCapable mapper 30) satisfies both.
    const stripCancelSpan = await measureStreamedSpan(
      mapper,
      rpgProject,
      'call_battle_strip_cancel',
      'call_battle_strip_cancel_done'
    );
    assert.equal(
      stripCancelSpan,
      STREAMWORLD_BATTLE_STRIP_CANCEL_KERNEL_ALLOWANCE,
      `call_battle_strip_cancel span: ${stripCancelSpan} != STREAMWORLD_BATTLE_STRIP_CANCEL_KERNEL_ALLOWANCE (${STREAMWORLD_BATTLE_STRIP_CANCEL_KERNEL_ALLOWANCE})`
    );
    // Zero cost on an uncharged shape: an action project has usesBattleBase
    // false, so call_battle (and both its labels) never assembles at all --
    // BATTLE_ENABLED gates the whole routine, not merely this term's own
    // STREAMING_ENABLED sub-block.
    const actionProject = createStreamedProject({ gameType: 'action' });
    actionProject.cartridge.mapper = mapper.id;
    await assert.rejects(
      () => measureStreamedSpan(mapper, actionProject, 'call_battle_strip_cancel', 'call_battle_strip_cancel_done'),
      'call_battle_strip_cancel must not assemble at all on an action project (usesBattleBase false) -- zero cost on this uncharged shape'
    );
    // A8 (fix round 2): the OTHER half of `usesStreaming && usesBattleBase` -- an ordinary
    // (non-streamed) RPG has usesBattleBase true but usesStreaming false, a shape the two checks
    // above never exercise (the action project above is usesBattleBase false regardless of
    // streaming; rpgProject above is usesStreaming true). engine/banks.asm nests
    // call_battle_strip_cancel inside `.if BATTLE_ENABLED` / `.if STREAMING_ENABLED`, so on this
    // shape the label never assembles either, same as the action project, but reached through the
    // inner gate rather than the outer one -- genuinely the untested half of the AND.
    const ordinaryRpgProject = createProject('RPG', 'rpg');
    ordinaryRpgProject.cartridge.mapper = mapper.id;
    await assert.rejects(
      () => measureStreamedSpan(mapper, ordinaryRpgProject, 'call_battle_strip_cancel', 'call_battle_strip_cancel_done'),
      'call_battle_strip_cancel must not assemble at all on an ordinary non-streamed RPG (usesStreaming false) -- zero cost on this uncharged shape too'
    );
    // Bound tiles only exist inside `.if BOUND_TILE_ENABLED`: authored on the
    // mixed project's ordinary "before" map, never the streamed one (Part D
    // item 2 refuses a bound tile there).
    const boundProject = createStreamedProject({ gameType: 'action', mixed: true });
    boundProject.cartridge.mapper = mapper.id;
    const beforeScreen = boundProject.maps[0].screens[0];
    beforeScreen.boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: beforeScreen.metatiles[0] }];
    const boundSpan = await measureStreamedSpan(mapper, boundProject, 'rebuild_bound_cache_dispatch', 'rebuild_bound_cache_ordinary');
    assert.equal(boundSpan, STREAMWORLD_BOUND_CACHE_KERNEL_ALLOWANCE);
    // F3 (phase 2 slice 2b fix round 1): both streamed-landing copies now
    // call rebuild_bound_cache under BOUND_TILE_ENABLED, so the resolver/
    // redraw spans measured above (on the no-bound-tile `project`) grow by
    // STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_ALLOWANCE once a project also
    // authors a bound tile -- measured here as the marginal delta on the
    // same boundProject already built above, not a fresh guess.
    const resolverWithBound = await measureStreamedSpan(mapper, boundProject, 'boot_streamed_landing', 'boot_draw_ordinary');
    const redrawWithBound = await measureStreamedSpan(mapper, boundProject, 'redraw_screen_dispatch', 'redraw_screen_ordinary');
    const resolverDelta = resolverWithBound - STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE;
    const redrawDelta = redrawWithBound - STREAMWORLD_REDRAW_KERNEL_ALLOWANCE;
    // Both call sites cost the same fixed `jsr rebuild_bound_cache` (3 bytes
    // each); the combined constant (2*3) is what the kernel-lo formula
    // actually charges once, covering both sites in the same bank.
    assert.equal(resolverDelta, 3, `boot_streamed_landing..boot_draw_ordinary with a bound tile: delta ${resolverDelta} != 3`);
    assert.equal(redrawDelta, 3, `redraw_screen_dispatch..redraw_screen_ordinary with a bound tile: delta ${redrawDelta} != 3`);
    assert.equal(
      resolverDelta + redrawDelta,
      STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_ALLOWANCE,
      `combined landing bound-cache delta ${resolverDelta + redrawDelta} != STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_ALLOWANCE (${STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_ALLOWANCE})`
    );
    // F5: tile_switch_changed's second (streaming) guard only exists inside
    // `.if BOUND_TILE_ENABLED` (engine/script.asm), so it can only be
    // measured on a project that authors a bound tile.
    const tileSwitchSpan = await measureStreamedSpan(mapper, boundProject, 'tile_switch_changed_dispatch', 'tile_switch_changed_ordinary');
    assert.equal(
      tileSwitchSpan,
      STREAMWORLD_TILE_SWITCH_KERNEL_ALLOWANCE,
      `tile_switch_changed_dispatch..tile_switch_changed_ordinary: ${tileSwitchSpan} != STREAMWORLD_TILE_SWITCH_KERNEL_ALLOWANCE (${STREAMWORLD_TILE_SWITCH_KERNEL_ALLOWANCE})`
    );
  }
);

// Phase 2 slice 4a, case 13: STREAMWORLD_PROJECT_KERNEL_ALLOWANCE is the combined ADDITIVE span
// of the five purely-additive brackets the projection wiring adds (oam.asm's
// build_oam_draw_dispatch/build_oam_draw_dispatch_done branch + build_oam_draw_sw/
// build_oam_draw_sw_end routine, entities.asm's draw_one_entity_hurt_dispatch/draw_one_entity_show
// fork (round 1 review fix: only a streaming build's own much larger draw_one_entity_show_sw pushes
// draw_one_entity_none out of bne's +-128 range) + draw_one_entity_show/de_show_dispatch_done
// branch + draw_one_entity_ordinary_join/draw_one_entity_animate routine) -- each label pair's
// own comment (engine/entities.asm:702-707) names this the identical "single streaming build's
// own span" technique Part F's SITES list above already uses, so a single streamed build per
// shape is enough; no ON/OFF diff needed (unlike the NMI splice below, which REPLACES rather than
// adds).
test(
  'phase 2 slice 4a, case 13: STREAMWORLD_PROJECT_KERNEL_ALLOWANCE equals the real combined span of the five additive projection-wiring brackets, on UNROM 512, both game types and the mixed shape',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const mapper = resolveMapper(30);
    const cases = [
      { gameType: 'action', mixed: false, label: 'action' },
      { gameType: 'rpg', mixed: false, label: 'rpg' },
      { gameType: 'action', mixed: true, label: 'action, mixed' }
    ];
    for (const { gameType, mixed, label } of cases) {
      const project = createStreamedProject({ gameType, mixed });
      const ordinaryProject = structuredClone(project);
      for (const map of ordinaryProject.maps) map.streamed = false;
      const dispatchSpan = await measureStreamedSpan(mapper, project, 'build_oam_draw_dispatch', 'build_oam_draw_dispatch_done');
      const swDrawSpan = await measureStreamedSpan(mapper, project, 'build_oam_draw_sw', 'build_oam_draw_sw_end');
      // draw_one_entity_hurt_dispatch/draw_one_entity_show is a REPLACE, not a purely-additive
      // bracket (round 1 review fix: only a streaming build needs the extra jmp, so an ordinary
      // build keeps its original 2-byte bne there too) -- streamed-minus-ordinary isolates the
      // real supplement, the same double-difference technique the NMI splice case below uses.
      const entityHurtStreamed = await measureStreamedSpan(mapper, project, 'draw_one_entity_hurt_dispatch', 'draw_one_entity_show');
      const entityHurtOrdinary = await measureStreamedSpan(mapper, ordinaryProject, 'draw_one_entity_hurt_dispatch', 'draw_one_entity_show');
      const entityHurtSpan = entityHurtStreamed - entityHurtOrdinary;
      const entityDispatchSpan = await measureStreamedSpan(mapper, project, 'draw_one_entity_show', 'de_show_dispatch_done');
      const entityJoinSpan = await measureStreamedSpan(mapper, project, 'draw_one_entity_ordinary_join', 'draw_one_entity_animate');
      const total = dispatchSpan + swDrawSpan + entityHurtSpan + entityDispatchSpan + entityJoinSpan;
      console.log(
        `${mapper.name} (${label}): STREAMWORLD_PROJECT_KERNEL_ALLOWANCE total ${total} ` +
          `(oam dispatch ${dispatchSpan}, oam sw ${swDrawSpan}, entity hurt ${entityHurtSpan} [streamed ${entityHurtStreamed}, ordinary ${entityHurtOrdinary}], entity dispatch ${entityDispatchSpan}, entity join ${entityJoinSpan}, expected ${STREAMWORLD_PROJECT_KERNEL_ALLOWANCE})`
      );
      assert.equal(
        total,
        STREAMWORLD_PROJECT_KERNEL_ALLOWANCE,
        `${mapper.name} (${label}): the five projection-wiring spans sum to ${total}, but STREAMWORLD_PROJECT_KERNEL_ALLOWANCE reserves ${STREAMWORLD_PROJECT_KERNEL_ALLOWANCE} -- re-measure and correct it.`
      );
    }
  }
);

// Phase 2 slice 4a, case 13: STREAMWORLD_NMI_KERNEL_ALLOWANCE/STREAMWORLD_NMI_PALETTE_FX_KERNEL_
// ALLOWANCE are the ONE exception to the additive-span technique above: engine/boot.asm's own
// comment on nmi_vram_dispatch/nmi_scroll is explicit that this splice REPLACES the ordinary
// six-line drain rather than adding a branch in front of it, so a single-build span would count
// the surviving `.else` arm's own bytes as if the streaming build had to pay for them too. Both
// labels exist unconditionally on every build (streamed or not), so streamed-span-minus-ordinary-
// span isolates the real supplement -- the identical double-difference technique
// STREAMWORLD_MOVE_KERNEL_ALLOWANCE above already uses for the PALETTE_FX-gated portion
// specifically (a Flash command alone, on an ORDINARY map, already assembles its own identical
// `.if PALETTE_FX_ENABLED` block inside the `.else` arm -- engine/boot.asm:499-505 -- so a naive
// single streamed-vs-ordinary delta with Flash on both sides would NOT isolate the streaming-
// specific supplement without this same subtraction).
test(
  'phase 2 slice 4a, case 13: STREAMWORLD_NMI_KERNEL_ALLOWANCE and STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE equal the real net replacement cost of the NMI splice, on UNROM 512, both game types, the mixed shape, and both PALETTE_FX conditions',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const mapper = resolveMapper(30);
    const cases = [
      { gameType: 'action', mixed: false, label: 'action' },
      { gameType: 'rpg', mixed: false, label: 'rpg' },
      { gameType: 'action', mixed: true, label: 'action, mixed' }
    ];
    for (const { gameType, mixed, label } of cases) {
      const streamedNoPfx = createStreamedProject({ gameType, mixed });
      const streamedPfx = createStreamedProject({ gameType, mixed, moveCommands: [{ op: 'flash' }] });
      const ordinaryNoPfx = structuredClone(streamedNoPfx);
      for (const map of ordinaryNoPfx.maps) map.streamed = false;
      const ordinaryPfx = structuredClone(streamedPfx);
      for (const map of ordinaryPfx.maps) map.streamed = false;

      const spanStreamedNoPfx = await measureStreamedSpan(mapper, streamedNoPfx, 'nmi_vram_dispatch', 'nmi_scroll');
      const spanOrdinaryNoPfx = await measureStreamedSpan(mapper, ordinaryNoPfx, 'nmi_vram_dispatch', 'nmi_scroll');
      const spanStreamedPfx = await measureStreamedSpan(mapper, streamedPfx, 'nmi_vram_dispatch', 'nmi_scroll');
      const spanOrdinaryPfx = await measureStreamedSpan(mapper, ordinaryPfx, 'nmi_vram_dispatch', 'nmi_scroll');

      const nmiAllowance = spanStreamedNoPfx - spanOrdinaryNoPfx;
      const pfxSupplement = (spanStreamedPfx - spanOrdinaryPfx) - nmiAllowance;
      console.log(
        `${mapper.name} (${label}): STREAMWORLD_NMI_KERNEL_ALLOWANCE ${nmiAllowance}, ` +
          `STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE supplement ${pfxSupplement} ` +
          `(streamed no-PFX ${spanStreamedNoPfx}, ordinary no-PFX ${spanOrdinaryNoPfx}, ` +
          `streamed PFX ${spanStreamedPfx}, ordinary PFX ${spanOrdinaryPfx})`
      );
      assert.equal(
        nmiAllowance,
        STREAMWORLD_NMI_KERNEL_ALLOWANCE,
        `${mapper.name} (${label}): the NMI splice's own net replacement cost is ${nmiAllowance}, but STREAMWORLD_NMI_KERNEL_ALLOWANCE reserves ${STREAMWORLD_NMI_KERNEL_ALLOWANCE} -- re-measure and correct it.`
      );
      assert.equal(
        pfxSupplement,
        STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE,
        `${mapper.name} (${label}): the PALETTE_FX-gated portion of the NMI splice's own net replacement cost is ${pfxSupplement}, but STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE reserves ${STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE} -- re-measure and correct it.`
      );
    }
  }
);

test(
  'phase 2 slice 2b, Part F: kernelCodeBytes still covers a worst-case streamed project, margin in band',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // Streaming is refused alongside Save, hero/Join naming (Part D items 5
    // and 7) anywhere in the project, and Move/Say/Fight/a nonzero encounter
    // rate specifically on the streamed map's own entities -- so the widest
    // legal combination is every OTHER conditional term, authored on the
    // mixed shape's ordinary "before" map, alongside a real streamed map.
    // Not the full "every conditional combination" matrix the RPG-capable
    // test above runs (Save/naming make that combination illegal here), and
    // not literally everything else either: camera is REQUIRED here (Part D
    // item 8), and camera + every other term below already leaves no room
    // for switch-bound tiles too (checkCapacity refuses that fourth
    // combination outright -- a real, working limit, not a test bug) --
    // this is the real worst case UNROM 512's kernel-lo can actually hold
    // alongside a streamed map, not an arbitrary subset.
    const mapper = resolveMapper(30);
    const project = createStreamedProject({ gameType: 'action', mixed: true });
    project.project.titleMap = 1;
    project.project.titleScreen = 0;
    project.items = [{ name: 'Potion', description: '', effect: { kind: 'heal', amount: 10 } }];
    project.songs = [createSong('Sting Song')];
    project.sfx = [{ name: 'Boop', volume: 10, steps: [{ note: 5, duration: 4 }] }];
    const before = project.maps[0].screens[0];
    // Not every compatible command at once -- each distinct command kind
    // used anywhere in the project pays for its own lookup table, and that
    // budget lives in the SAME kernel-lo bank as the code this test is
    // measuring, so stacking all ten (as an earlier version of this test
    // did) overflows the bank outright before assertCovers ever runs. Five
    // kinds spanning the different subsystems (movement, timing, visual,
    // dialogue) used to be a real multi-feature mix this board could hold
    // alongside a streamed map, and phase 2 slice 4a's own new NMI-
    // arbitration and per-tile projection code (STREAMWORLD_NMI_KERNEL_
    // ALLOWANCE, STREAMWORLD_PROJECT_KERNEL_ALLOWANCE, main/build/generate.js)
    // already narrowed the margin enough that the sixth kind, Sting, stopped
    // fitting alongside the other five (the project's own audio subsystem is
    // still exercised -- `songs`/`sfx` above still compile -- just not via
    // this event's own command list). The round 1 review fix (real per-tile
    // clipping for entities, finding 2) grew STREAMWORLD_PROJECT_KERNEL_
    // ALLOWANCE again, past what even those five now leave room for:
    // measured directly, dropping Shake (frees CAMERA_SHAKE_INTERACTION_
    // ALLOWANCE too, since Shake and the required camera interact) and the
    // `{name}` token out of the Say text (frees NAME_TOKEN_KERNEL_ALLOWANCE)
    // is the cheapest combination that clears that shortfall -- move, wait,
    // visible and Say (still spanning movement, timing and dialogue) is what
    // this board could hold alongside a streamed map at that point. Phase 2
    // slice 4b's own two new kernel-lo terms (STREAMWORLD_UPDATE_PLAYER_
    // DISPATCH_KERNEL_ALLOWANCE + STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE,
    // 15 bytes combined, unconditional under streaming, main/build/
    // generate.js) narrowed the margin again, past what even those four now
    // leave room for: measured directly, dropping Wait (the cheapest
    // remaining term, WAIT_KERNEL_ALLOWANCE 43) is what clears this
    // shortfall -- move, visible and Say (movement, visual and dialogue) is
    // what this board can now actually hold alongside a streamed map. Slice
    // 4b's later "clamp edges" containment fix (the cross_* grid-boundary
    // guards, STREAMWORLD_CROSS_KERNEL_ALLOWANCE 60 -> 96) narrowed it once
    // more, past what even move+visible+Say now leave room for: measured
    // directly, dropping Visible (the cheapest remaining term,
    // VISIBLE_KERNEL_ALLOWANCE 47) is what clears this shortfall -- move and
    // Say (movement and dialogue) is what this board can now actually hold
    // alongside a streamed map. Phase 2 slice 7b (dialogue lifecycle,
    // STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE 226 + STREAMWORLD_
    // OAM_GUARD_KERNEL_ALLOWANCE 4, both unconditional once a streamed
    // project uses text, main/build/generate.js) narrowed it once more,
    // past what even move+Say now leave room for (the table budget came up
    // 126 bytes short with both commands live): measured directly, dropping
    // Move (the only remaining term -- Say cannot go, this is the dialogue
    // slice's own worst case) is what clears this shortfall -- Say alone
    // (dialogue only) is what this board can now actually hold alongside a
    // streamed map; margin lands at exactly 20, the tight end of the band.
    before.entities.push({
      actorId: 0,
      x: 32,
      y: 32,
      props: {
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [{ op: 'say', text: 'Hello.' }]
            }
          ]
        }
      }
    });
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-streamworst-'));
    try {
      const lines = [];
      const built = await buildProject({ dir, project, log: (l) => lines.push(l) });
      const { kernelLoBank } = prgLayout(mapper);
      const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
      assert.ok(bankLine, `nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
      const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
      const symbols = await fsp.readFile(built.symbolPath, 'utf8');
      const resetAddr = symbolAddr(symbols, 'reset');
      const codeBytes = used - (resetAddr - 0xc000);
      assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), 'worst-case streamed (mixed, items, audio, event commands, title)');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  'phase 2 slice 2b fix round 1, F5: kernelCodeBytes still covers streaming + an ordinary bound tile, both game types, margin in band',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // The worst-case test just above already documents that camera + every
    // other conditional term leaves no room for a bound tile too (a real
    // checkCapacity refusal, not a test bug) -- so this is a separate,
    // narrower worst case: streaming plus an authored ordinary bound tile
    // alone, on both game types, since STREAMWORLD_LANDING_BOUND_CACHE_
    // KERNEL_ALLOWANCE and STREAMWORLD_TILE_SWITCH_KERNEL_ALLOWANCE (F3/F5)
    // are the two new terms this fix round adds and neither was covered by
    // any pre-existing combined-margin test.
    const mapper = resolveMapper(30);
    for (const gameType of ['action', 'rpg']) {
      const project = createStreamedProject({ gameType, mixed: true });
      project.cartridge.mapper = mapper.id;
      const before = project.maps[0].screens[0];
      before.boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: before.metatiles[0] }];
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-streamboundworst-'));
      try {
        const lines = [];
        const built = await buildProject({ dir, project, log: (l) => lines.push(l) });
        const { kernelLoBank } = prgLayout(mapper);
        const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${kernelLoBank}\\s`).test(line));
        assert.ok(bankLine, `nesasm's usage table never mentioned bank ${kernelLoBank} (kernel-lo)`);
        const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
        const symbols = await fsp.readFile(built.symbolPath, 'utf8');
        const resetAddr = symbolAddr(symbols, 'reset');
        const codeBytes = used - (resetAddr - 0xc000);
        assertCovers({ mapper, codeBytes }, kernelCodeBytes(project, mapper), `streaming + ordinary bound tile (${gameType})`);
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
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
  // UNROM 512: naming + title + Save all live used to not fit unpadded; the
  // zero-page kernel diet (docs/design-kernel-diet.md) closed that (see the
  // "rows 16-18" test above), so this project is padded back into a real
  // deficit -- JOIN_NAMING_KERNEL_ALLOWANCE alone (64 bytes) still exceeds
  // the padded deficit here, so the generic solo search finds it without
  // ever reaching the combination search (hero naming alone frees less than
  // the deficit on this exact project, so it is correctly absent from this
  // particular message -- the combination-search test above covers
  // "neither alone, both together").
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
  inflate(project, 85); // recalibrated for the zero-page kernel diet, docs/design-kernel-diet.md
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

// ---------------------------------------------------------------------------
// Camera register + slide, phases 1-2 (docs/design-camera.md §8):
// CAMERA_KERNEL_ALLOWANCE / CAMERA_SHAKE_INTERACTION_ALLOWANCE are the
// REGISTER gate's own terms (charged whenever CAMERA_ENABLED is live,
// consumer or not); CAMERA_SLIDE_KERNEL_ALLOWANCE / CAMERA_AXIS_KERNEL_
// ALLOWANCE / CAMERA_SPLIT_INTERACTION_ALLOWANCE / BOUND_TILE_CAMERA_
// INTERACTION_ALLOWANCE are the CONSUMER's own incremental delta over a
// register-only build (never over camera-off, which would silently
// re-absorb the register's own 20 bytes a second time -- Decision 8). A
// real project always builds with both flags on (CAMERA_SLIDE_ENABLED is
// generated from the identical projectUsesCamera flag CAMERA_ENABLED is),
// so the register-only isolation below exists purely to keep the two
// disjoint terms honest, via measureCodeBytes' own registerOnly option
// (Decision 8: a test-only patch of a mkdtemp build directory's generated
// config.inc, rewriting CAMERA_SLIDE_ENABLED = 1 back to 0 between
// generateAssets and nesasm -- never a shipping env var).
// ---------------------------------------------------------------------------

const CAMERA_LEDGER_MAPPERS = SUPPORTED_MAPPERS.filter((mapper) => [0, 1, 4, 30].includes(mapper.id));

/** A brand-new, unsaved project written to its own temp directory -- for an
 * isolation delta that must not carry any of a checked-in fixture's own
 * content (an existing dialogue string, a pre-authored event) into the
 * measurement. */
async function freshProjectDir(t, gameType) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-camera-fresh-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, createProject(gameType === 'rpg' ? 'Fresh RPG' : 'Fresh Action', gameType));
  return dir;
}

test(
  'CAMERA_KERNEL_ALLOWANCE covers the real, isolated cost of the camera register ALONE (no consumer assembled), on every measured board, action game type',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // A fresh project with no events at all: camera alone assembles no event
    // of its own, so there is no live-text side effect (fontBankSplit) to
    // isolate away the way withMove:true isolates it for the interaction
    // test below.
    for (const mapper of CAMERA_LEDGER_MAPPERS) {
      const dir = await freshProjectDir(t, 'action');
      const off = await measureCodeBytes(t, mapper, { fixture: dir });
      const registerOnly = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true, registerOnly: true });
      assertCovers({ mapper, codeBytes: off.codeBytes }, kernelCodeBytes(off.project, mapper), 'camera off, fresh action project');
      const delta = registerOnly.codeBytes - off.codeBytes;
      assert.equal(
        delta,
        CAMERA_KERNEL_ALLOWANCE,
        `${mapper.name}: the camera register ALONE (no consumer) costs ${delta} bytes of kernel code ` +
          `(${off.codeBytes} -> ${registerOnly.codeBytes}), but CAMERA_KERNEL_ALLOWANCE reserves ${CAMERA_KERNEL_ALLOWANCE} -- ` +
          'this allowance must equal the register gate\'s real cost exactly, on every board.'
      );
    }
  }
);

test(
  'CAMERA_KERNEL_ALLOWANCE covers the real, isolated cost of the camera register ALONE, on every RPG-capable board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAPABLE_MAPPERS) {
      const dir = await freshProjectDir(t, 'rpg');
      const off = await measureCodeBytes(t, mapper, { fixture: dir });
      const registerOnly = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true, registerOnly: true });
      assertCovers({ mapper, codeBytes: off.codeBytes }, kernelCodeBytes(off.project, mapper), 'camera off, fresh RPG project');
      const delta = registerOnly.codeBytes - off.codeBytes;
      assert.equal(
        delta,
        CAMERA_KERNEL_ALLOWANCE,
        `${mapper.name}: the camera register ALONE costs ${delta} bytes of kernel code (${off.codeBytes} -> ` +
          `${registerOnly.codeBytes}) on an RPG, but CAMERA_KERNEL_ALLOWANCE reserves ${CAMERA_KERNEL_ALLOWANCE} -- ` +
          'the design measured this flat across game type, and this is the RPG half of that claim.'
      );
    }
  }
);

test(
  'CAMERA_SHAKE_INTERACTION_ALLOWANCE: camera (register alone) and Shake compose, isolated on every measured board',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // withMove: true as the baseline on every leg -- the identical isolation
    // the Sting/Sfx tests above use (see their own comment): a bare
    // Shake-or-camera-only delta on MMC3 would also turn the split term on
    // (any surviving event does, projectUsesText), so comparing against a
    // baseline that already has a different, surviving event (Move) charges
    // the split term equally on both sides of every subtraction below,
    // cancelling it out.
    for (const mapper of CAMERA_LEDGER_MAPPERS) {
      const dir = await freshProjectDir(t, 'action');
      const shakeOnly = await measureCodeBytes(t, mapper, { fixture: dir, withMove: true, withShake: true });
      const cameraOnly = await measureCodeBytes(t, mapper, { fixture: dir, withMove: true, withCamera: true, registerOnly: true });
      const both = await measureCodeBytes(t, mapper, { fixture: dir, withMove: true, withShake: true, withCamera: true, registerOnly: true });

      const deltaFromShake = both.codeBytes - shakeOnly.codeBytes;
      assert.equal(
        deltaFromShake,
        CAMERA_KERNEL_ALLOWANCE + CAMERA_SHAKE_INTERACTION_ALLOWANCE,
        `${mapper.name}: adding the camera register to a Shake-only build costs ${deltaFromShake} bytes ` +
          `(${shakeOnly.codeBytes} -> ${both.codeBytes}), but CAMERA_KERNEL_ALLOWANCE + ` +
          `CAMERA_SHAKE_INTERACTION_ALLOWANCE reserves ${CAMERA_KERNEL_ALLOWANCE + CAMERA_SHAKE_INTERACTION_ALLOWANCE}.`
      );

      const deltaFromCamera = both.codeBytes - cameraOnly.codeBytes;
      assert.equal(
        deltaFromCamera,
        SHAKE_KERNEL_ALLOWANCE + CAMERA_SHAKE_INTERACTION_ALLOWANCE,
        `${mapper.name}: adding Shake to a camera-register-only build costs ${deltaFromCamera} bytes ` +
          `(${cameraOnly.codeBytes} -> ${both.codeBytes}), but SHAKE_KERNEL_ALLOWANCE + ` +
          `CAMERA_SHAKE_INTERACTION_ALLOWANCE reserves ${SHAKE_KERNEL_ALLOWANCE + CAMERA_SHAKE_INTERACTION_ALLOWANCE}.`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Phase 2's own consumer terms, measured incrementally against a
// register-only build (never camera-off) -- CAMERA_SLIDE_KERNEL_ALLOWANCE +
// CAMERA_AXIS_KERNEL_ALLOWANCE * axisCount, plus the split/bound-tile
// interactions.
// ---------------------------------------------------------------------------

test(
  'CAMERA_SLIDE_KERNEL_ALLOWANCE + one axis: camera on vs register-only, on NROM/MMC1/MMC3 (textless)/UNROM 512',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAMERA_LEDGER_MAPPERS) {
      const dir = await freshProjectDir(t, 'action'); // default vertical mirroring -> one axis (H)
      const registerOnly = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true, registerOnly: true });
      const full = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true });
      assertCovers({ mapper, codeBytes: full.codeBytes }, kernelCodeBytes(full.project, mapper), 'full camera on, one axis, fresh action project');
      const delta = full.codeBytes - registerOnly.codeBytes;
      const expected = CAMERA_SLIDE_KERNEL_ALLOWANCE + CAMERA_AXIS_KERNEL_ALLOWANCE;
      assert.equal(
        delta,
        expected,
        `${mapper.name}: the consumer's own delta over register-only, one axis, is ${delta} bytes ` +
          `(${registerOnly.codeBytes} -> ${full.codeBytes}), but CAMERA_SLIDE_KERNEL_ALLOWANCE + ` +
          `CAMERA_AXIS_KERNEL_ALLOWANCE reserves ${expected}.`
      );
    }
  }
);

test(
  'CAMERA_AXIS_KERNEL_ALLOWANCE: two axes vs one, UNROM 512 four-screen',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(30);
    const dir = await freshProjectDir(t, 'action');
    const project = await loadProject(dir);
    // The mapper must already be 30 before saving, or normalizeProject's own
    // mirroringOptions(mapper) check (run at save/load) sees the project's
    // still-NROM mapper, finds fourscreen illegal for it, and silently
    // resets mirroring back to 'vertical' before measureCodeBytes ever gets
    // a chance to force mapper=30 itself.
    project.cartridge.mapper = 30;
    project.cartridge.mirroring = 'fourscreen';
    await saveProject(dir, project);
    const oneAxisDir = await freshProjectDir(t, 'action'); // default vertical -> one axis
    const oneAxis = await measureCodeBytes(t, mapper, { fixture: oneAxisDir, withCamera: true });
    const twoAxes = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true });
    assertCovers({ mapper, codeBytes: twoAxes.codeBytes }, kernelCodeBytes(twoAxes.project, mapper), 'full camera on, two axes, fresh action project');
    const delta = twoAxes.codeBytes - oneAxis.codeBytes;
    assert.equal(
      delta,
      CAMERA_AXIS_KERNEL_ALLOWANCE,
      `UNROM 512 four-screen: two axes cost ${delta} bytes more than one (${oneAxis.codeBytes} -> ${twoAxes.codeBytes}), ` +
        `but CAMERA_AXIS_KERNEL_ALLOWANCE reserves ${CAMERA_AXIS_KERNEL_ALLOWANCE} for the second axis alone.`
    );
  }
);

test(
  'CAMERA_SPLIT_INTERACTION_ALLOWANCE: camera + MMC3 text (SPLIT_ENABLED)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(4);
    const dir = await freshProjectDir(t, 'action');
    const registerOnly = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true, registerOnly: true });
    const textless = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true });

    // A PLAIN Say (no {name} token) -- withNameToken's own commands push
    // turns on NAME_TOKEN_ENABLED and its own kernel-lo terms too, which
    // would contaminate this isolation with costs unrelated to SPLIT_ENABLED.
    // The SAME baseline event must be present in BOTH the register-only and
    // the full measurement below (not compared against the textless
    // project's own register-only), so SPLIT_KERNEL_ALLOWANCE's own 151-byte
    // base cost -- present either way once text is live at all -- cancels
    // out of the delta, leaving only the camera-consumer's own interaction
    // term (the same baseline-event trick phase 1's own report used for the
    // identical reason).
    const textDir = await freshProjectDir(t, 'action');
    const textProject = await loadProject(textDir);
    textProject.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hello there.' }] }] } }
    });
    await saveProject(textDir, textProject);
    const textRegisterOnly = await measureCodeBytes(t, mapper, { fixture: textDir, withCamera: true, registerOnly: true });
    const withText = await measureCodeBytes(t, mapper, { fixture: textDir, withCamera: true });
    assertCovers({ mapper, codeBytes: withText.codeBytes }, kernelCodeBytes(withText.project, mapper), 'full camera on, one axis, MMC3 with text');
    const textlessDelta = textless.codeBytes - registerOnly.codeBytes;
    assert.equal(
      textlessDelta,
      CAMERA_SLIDE_KERNEL_ALLOWANCE + CAMERA_AXIS_KERNEL_ALLOWANCE,
      `MMC3 textless: consumer delta is ${textlessDelta}, expected ${CAMERA_SLIDE_KERNEL_ALLOWANCE + CAMERA_AXIS_KERNEL_ALLOWANCE}`
    );
    const withTextDelta = withText.codeBytes - textRegisterOnly.codeBytes;
    const expected = CAMERA_SLIDE_KERNEL_ALLOWANCE + CAMERA_AXIS_KERNEL_ALLOWANCE + CAMERA_SPLIT_INTERACTION_ALLOWANCE;
    assert.equal(
      withTextDelta,
      expected,
      `MMC3 with text: consumer delta over register-only is ${withTextDelta} bytes (${registerOnly.codeBytes} -> ` +
        `${withText.codeBytes}), but slide + axis + CAMERA_SPLIT_INTERACTION_ALLOWANCE reserves ${expected}.`
    );
  }
);

test(
  'BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE: camera + a live switch-bound tile',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const mapper = resolveMapper(0);
    const dir = await freshProjectDir(t, 'action');
    const registerOnly = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true, registerOnly: true });
    const withBoundTile = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true, withBoundTiles: true });
    assertCovers({ mapper, codeBytes: withBoundTile.codeBytes }, kernelCodeBytes(withBoundTile.project, mapper), 'full camera on, one axis, one bound tile');
    const delta = withBoundTile.codeBytes - registerOnly.codeBytes;
    const expected = CAMERA_SLIDE_KERNEL_ALLOWANCE + CAMERA_AXIS_KERNEL_ALLOWANCE + BOUND_TILE_KERNEL_ALLOWANCE + BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE;
    assert.equal(
      delta,
      expected,
      `NROM: camera + a live bound tile costs ${delta} bytes over register-only (${registerOnly.codeBytes} -> ` +
        `${withBoundTile.codeBytes}), but slide + axis + BOUND_TILE_KERNEL_ALLOWANCE + ` +
        `BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE reserves ${expected}.`
    );
  }
);

test(
  'camera + Shake vs camera alone still costs SHAKE_KERNEL_ALLOWANCE + CAMERA_SHAKE_INTERACTION_ALLOWANCE with the consumer live too',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAMERA_LEDGER_MAPPERS) {
      const dir = await freshProjectDir(t, 'action');
      const cameraOnly = await measureCodeBytes(t, mapper, { fixture: dir, withMove: true, withCamera: true });
      const both = await measureCodeBytes(t, mapper, { fixture: dir, withMove: true, withShake: true, withCamera: true });
      assertCovers({ mapper, codeBytes: both.codeBytes }, kernelCodeBytes(both.project, mapper), 'full camera + Shake, one axis');
      const delta = both.codeBytes - cameraOnly.codeBytes;
      const expected = SHAKE_KERNEL_ALLOWANCE + CAMERA_SHAKE_INTERACTION_ALLOWANCE;
      assert.equal(
        delta,
        expected,
        `${mapper.name}: adding Shake to a full-camera (consumer live) build costs ${delta} bytes ` +
          `(${cameraOnly.codeBytes} -> ${both.codeBytes}), but SHAKE_KERNEL_ALLOWANCE + ` +
          `CAMERA_SHAKE_INTERACTION_ALLOWANCE reserves ${expected} -- the interaction is entirely the register gate's ` +
          "own, the consumer contributes nothing to it, so this must equal phase 1's own figure unchanged."
      );
    }
  }
);

test(
  'assertCovers holds for the full camera build (register + consumer, one axis) on both game types, every board this file covers',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    for (const mapper of CAMERA_LEDGER_MAPPERS) {
      const dir = await freshProjectDir(t, 'action');
      const action = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true });
      assertCovers({ mapper, codeBytes: action.codeBytes }, kernelCodeBytes(action.project, mapper), `full camera on, action, ${mapper.name}`);
    }
    for (const mapper of CAPABLE_MAPPERS) {
      const dir = await freshProjectDir(t, 'rpg');
      const rpg = await measureCodeBytes(t, mapper, { fixture: dir, withCamera: true });
      assertCovers({ mapper, codeBytes: rpg.codeBytes }, kernelCodeBytes(rpg.project, mapper), `full camera on, RPG, ${mapper.name}`);
    }
  }
);

// docs/design-camera.md §5/Q3: switchableMappers excludes a candidate that
// would drop an axis the project's CURRENT mapper provides.
test('switchableMappers: a four-screen UNROM 512 camera project offers no board that drops the vertical axis', () => {
  const project = normalizeProject(createProject('Fresh', 'action'));
  project.cartridge.mapper = 30;
  project.cartridge.mirroring = 'fourscreen';
  project.cartridge.camera = true;
  const candidates = switchableMappers(project, resolveMapper(30));
  for (const candidate of candidates) {
    assert.ok(
      cameraAxes(candidate, project.cartridge).vertical,
      `${candidate.name} was offered but would drop the vertical axis this four-screen project currently has`
    );
  }
});

test('switchableMappers: a vertical-mirroring NROM camera project still offers MMC1', () => {
  const project = normalizeProject(createProject('Fresh', 'action'));
  project.cartridge.mapper = 0;
  project.cartridge.camera = true; // default mirroring: vertical
  const candidates = switchableMappers(project, resolveMapper(0));
  assert.ok(
    candidates.some((c) => c.id === 1),
    'MMC1 provides the identical H axis a vertical-mirroring project already has, so it must still be offered'
  );
});

test(
  'a kernel-lo shortfall the camera alone would close names the camera',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = createProject('Action', 'action');
    project.cartridge.mapper = 1; // MMC1 -- no split term to complicate the arithmetic
    project.cartridge.camera = true;
    // The full camera figure is now the register (20) + the consumer's own
    // base + one axis (298 + 52 = 350) = 370, not merely 20 -- Decision 8's
    // own disjoint formula. Re-measured (not assumed) with the same
    // inflateLegal count phase 1 used: the deficit moved from 15 to 369
    // purely because kernelCodeBytes now charges 350 bytes more for the
    // camera than phase 1 did, the same "camera off" baseline unchanged.
    inflateLegal(project, 288); // measured: lands a 369-byte deficit, inside (0, 370]
    const deficit = kernelShortfallDeficit(project);
    const full = CAMERA_KERNEL_ALLOWANCE + CAMERA_SLIDE_KERNEL_ALLOWANCE + CAMERA_AXIS_KERNEL_ALLOWANCE;
    assert.ok(
      deficit > 0 && deficit <= full,
      `deficit ${deficit} must sit in (0, ${full}] (register + consumer base + one axis) or this case does ` +
        'not exercise the camera alone closing the gap'
    );
    const message = kernelShortfallMessage(project);
    assert.match(message, new RegExp(`the camera \\(frees ${full} bytes\\)`));
    const dropped = structuredClone(project);
    dropped.cartridge.camera = false;
    assert.deepEqual(
      validateProject(dropped).filter((p) => p.severity === 'error'),
      [],
      'dropping the camera should leave the project free of validation errors'
    );
    assert.deepEqual(
      checkCapacity(dropped).problems.filter((p) => p.severity === 'error'),
      [],
      'dropping the camera should leave the project free of capacity errors'
    );
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-camera-shortfall-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, dropped);
    const built = await buildProject({ dir, project: dropped, log: () => {} });
    assert.ok(built.romPath, 'dropping the camera should be a real, buildable fix');
  }
);

// docs/design-camera.md §8: with Shake also live, dropping the camera must
// free the REGISTER (20) + its own Shake interaction (19) + the CONSUMER's
// own base + one axis (298 + 52) = 389 together, not any subset -- Decision
// 8's own disjoint formula, all freed at once since projectWithoutCamera
// clears the one project-level flag both the register and the consumer are
// generated from. Sized so the deficit exceeds the register-alone figure
// (20) but not the full combined one (389), so a regression that dropped
// any one term from this lever's own freedByDropping computation would fail
// this test even though the camera-alone test above still passes.
test(
  'a kernel-lo shortfall the camera and Shake interaction closes: dropping the camera frees register + consumer + Shake interaction together, not any subset',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = createProject('Action', 'action');
    project.cartridge.mapper = 1; // MMC1
    project.cartridge.camera = true;
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: 30 }] }] } }
    });
    inflateLegal(project, 280); // measured: lands a 384-byte deficit
    const deficit = kernelShortfallDeficit(project);
    const combined = CAMERA_KERNEL_ALLOWANCE + CAMERA_SHAKE_INTERACTION_ALLOWANCE + CAMERA_SLIDE_KERNEL_ALLOWANCE + CAMERA_AXIS_KERNEL_ALLOWANCE;
    assert.ok(
      deficit > CAMERA_KERNEL_ALLOWANCE && deficit <= combined,
      `deficit ${deficit} must exceed the camera's own register cost alone (${CAMERA_KERNEL_ALLOWANCE}) but not the ` +
        `combined figure (${combined}), or this case does not exercise the interaction term`
    );
    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      new RegExp(`the camera \\(frees ${combined} bytes\\)`),
      'dropping the camera while Shake stays live must free the register cost, its own Shake interaction, and the ' +
        'whole consumer together, not any subset of them'
    );
    const dropped = structuredClone(project);
    dropped.cartridge.camera = false;
    assert.deepEqual(validateProject(dropped).filter((p) => p.severity === 'error'), []);
    assert.deepEqual(checkCapacity(dropped).problems.filter((p) => p.severity === 'error'), []);
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-camera-shortfall-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await saveProject(dir, dropped);
    const built = await buildProject({ dir, project: dropped, log: () => {} });
    assert.ok(built.romPath, 'dropping the camera, with Shake still live, should be a real, buildable fix');
  }
);
