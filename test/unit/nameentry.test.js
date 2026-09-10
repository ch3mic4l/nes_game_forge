// In-game party-member name entry (docs/design-name-entry.md), phase 1 --
// the save migration alone. This phase adds no engine code, no predicate and
// no UI: it only grows the save record (SAVE_FIELDS gains pc_name_ram) and
// bumps SAVE_LAYOUT_VERSION 2 -> 3, both unconditional. Every later phase's
// naming-off ROM has to compare byte-for-byte against a pinned baseline, and
// this phase is that baseline: the six fixture ROMs, hashed here, are what
// phase 2 and beyond re-hash against with the feature fully present but
// still universally disabled.
//
// `sample/` and `sample-rpg/` carry no Save command, so their two hashes are
// untouched by this phase (SAVE_FIELDS/SAVE_LAYOUT_VERSION only reach a
// project's ROM through engine/save.asm's own `.if SAVE_ENABLED` block) --
// pinned here anyway, so a later phase's re-hash has a same-file diff to
// read rather than a silent omission.
//
// Builds happen into a fresh mkdtemp directory via buildProject
// (main/build/pipeline.js), never into any of the six checked-in build/
// directories -- CLAUDE.md: "No test may mutate any of the six."
// generateAssets only ever reads its `dir` argument to know where to write,
// never to read project data back off disk (see main/build/generate.js's
// own generateAssets/ENGINE_DIR), so a project loaded once with loadProject
// is a complete, self-contained object and can be built into any directory.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import NES from '../../renderer/emulator/core/nes.js';
import { BUTTON } from '../../renderer/emulator/runcontrol.js';
import { nameTiles } from '../../main/build/battletables.js';
import { createProject } from '../../shared/project.js';
import { charToTile, FONT_TILES, FONT_BASE, fontBankSplit, textToTiles } from '../../shared/font.js';
import { encodeTiles, decodeChr, TILE_BYTES } from '../../shared/chr.js';
import { resolveMapper } from '../../shared/cartridge.js';
import {
  GAME_STATE,
  BOX_STATE,
  NM_LEN,
  ST_NAMEENTRY,
  tap,
  waitForNamingReady,
  gotoCell,
  clearName,
  clearNameViaCancel,
  nametableRow,
  BOX_ROW_UPPER,
  BOX_ROW_LOWER,
  BOX_ROW_CONTROLS,
  typeNameAndFinish,
  nameBytes
} from '../lib/naming.js';
import { SOLID_TILE, PROBE_TILE, probe, probeKind } from '../lib/framebuffer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// Phase-1 name-entry baselines: SHA-256 of each fixture's ROM, built from the
// checked-in project (loadProject) with SAVE_FIELDS carrying pc_name_ram and
// SAVE_LAYOUT_VERSION at 3, naming code not yet existing at all. sample/ and
// sample-rpg/ are unchanged from their pre-phase-1 hashes (no Save command);
// the other four moved (they all carry a live Save). If this is a deliberate
// re-pin, rebuild the six fixtures on the exact tree the re-pin is for
// (`npm run build:sample`, `build:sample:rpg`, `build:sample:mmc1`,
// `build:sample:mmc3`, `build:sample:u512`, and `node main/build/cli.js
// sample-rpg-mmc1`), hash each `<fixture>/build/game.nes` with sha256sum,
// and say in the commit which engine change moved which hashes.
// Re-pinned for the Character Forge phase 2 (docs/design-character-forge.md
// §2): sample-mmc1/sample-mmc3/sample-u512 moved. They are action projects
// with a live Save, and saveIdentity (shared/save.js) folds partyCount,
// which goes 0 -> 1 for every action project under this phase (a project
// always has someone to play as, per createPartyMember/normalizeProject) --
// so SAVE_IDENTITY_0..3 in each fixture's own build/assets/config.inc
// changed, and only those four lines (confirmed by diffing config.inc
// against a HEAD-3949316 build of the same fixture). sample/, sample-rpg/
// and sample-rpg-mmc1/ are unchanged: sample has no live Save at all, and
// both RPG fixtures already had a 1+ member party.
const BASELINES = {
  sample: '471562e528e8ad08a44c9211bd0784b8e6b5e9811e9793ebf21f02e2143bcd82',
  'sample-rpg': 'c7bc3dc326996831e488b929d238f19b71095dd02a8e2c24c37f5612f6f251be',
  'sample-mmc1': 'f24816f2bd35c7e4df6974823409db384b92cb90bea263b08bdc05fa4d4e2b76',
  'sample-mmc3': '689bf6cc813dc21870be606d7eac2e892b1fdeb6c33be4238db61d24ad79bf97',
  'sample-u512': '2a2f9d63a30cde781e34951dff595f777f7beba65472014c881cb525691da3ae',
  'sample-rpg-mmc1': 'f24658ab023a888df23722cd6da0a94f85ba1480b9267ef1906df58ebbceeba8'
};

for (const name of Object.keys(BASELINES)) {
  test(
    `${name}/ builds to the phase-1 name-entry baseline`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async (t) => {
      const fixtureDir = path.join(ROOT, name);
      const project = await loadProject(fixtureDir);

      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-nameentry-'));
      t.after(() => fs.rm(dir, { recursive: true, force: true }));

      const built = await buildProject({ dir, project, log: () => {} });
      const rom = await fs.readFile(built.romPath);
      const hash = crypto.createHash('sha256').update(rom).digest('hex');

      assert.equal(
        hash,
        BASELINES[name],
        `${name}/ must assemble byte-for-byte identically to the phase-1 name-entry baseline -- if this is a ` +
          'deliberate change, re-pin the hash by building this exact fixture on the tree the re-pin is for and ' +
          'say why in the commit'
      );
    }
  );
}

// ---------------------------------------------------------------------------
// The action, kernel-lo placement's own typed-name behavior
// (docs/design-name-entry.md §5/§14, phase 3). Every test above this line
// only ever builds sample-rpg/sample-mmc1/sample-mmc3/sample-u512/
// sample-rpg-mmc1 -- an RPG project, reaching the naming grid only through
// the BANKED placement via call_battle. None of it ever exercises the five
// kernel-lo shims (name_begin/tick/draw/select/cancel, engine/ui.asm) an
// action project reaches by plain jsr/jmp instead, or reads pc_name_ram on
// that placement. These tests build sample (NROM, action) variants instead.
//
// P2 hygiene (phase 3 fix round 2): rpg.test.js now imports the same grid
// helpers from test/lib/naming.js too -- no more duplicated copy there.

const SAMPLE = path.join(ROOT, 'sample');
const ST_TITLE = 3;
const ST_GAMEPLAY = 0;
const ST_GAMEOVER = 4;

async function buildActionNamingVariant(t, mutate) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-nameentry-action-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  mutate(project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, built };
}

function bootRom(romPath, frames = 40) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fsSync.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

/** Like bootRom, but captures the real rendered framebuffer every frame
 *  (nes.lastFrame()) -- the split.test.js `boot` idiom, needed only by the
 *  P1-B rendered-pixel checks below; every other test in this file has no
 *  use for the frame buffer and keeps the cheaper bootRom. */
function bootRomCapturing(romPath, frames = 40) {
  const state = { frame: null };
  const nes = new NES({ onFrame: (buffer) => (state.frame = buffer), emulateSound: false });
  nes.loadROM(new Uint8Array(fsSync.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  nes.lastFrame = () => state.frame;
  return nes;
}

/** The 16 raw CHR bytes nesasm actually wrote for `tileIndex` in CHR bank
 *  `bankIndex`'s background half, read straight out of the built .nes file
 *  -- not the emulator's live pattern-table decode, so this cannot be fooled
 *  by a runtime bank-switch bug (that is what the rendered-pixel checks
 *  below are for). iNES header convention (main/build/pipeline.js's own
 *  inspectRom): byte 4 is PRG size in 16 KB units, CHR data follows
 *  immediately after; each CHR bank (main/build/generate.js's chrIncludes)
 *  is a contiguous 8 KB, background table then sprite table. */
function romChrTileBytes(romPath, bankIndex, tileIndex) {
  const rom = fsSync.readFileSync(romPath);
  const prgBanks = rom[4];
  const bankStart = 16 + prgBanks * 16384 + bankIndex * 8192;
  const tileStart = bankStart + tileIndex * TILE_BYTES;
  return [...rom.slice(tileStart, tileStart + TILE_BYTES)];
}

/** Press through the title, if there is one, landing on hero naming (or
 *  straight gameplay if naming is off) -- mirrors start_game's own
 *  HERO_NAMING_ENABLED arm, the action placement's real arrival. */
function bootToNaming(romPath, frames = 40) {
  const nes = bootRom(romPath, frames);
  if (nes.cpu.mem[GAME_STATE] === ST_TITLE) tap(nes, BUTTON.START, 20);
  return nes;
}

test(
  'action placement: a typed name lands in pc_name_ram slot 0 at the right bytes, nm_len matches, the pad is spaces, and game_state reaches gameplay after END',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.party[0].renamable = true;
    });
    const nes = bootToNaming(built.romPath);
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_NAMEENTRY,
      'hero naming should open at the start of a new game on the kernel-lo placement -- catches NAME_ENTRY_BANKED ' +
        'miscomputed true for NROM (an undefined-symbol build would already have failed above this line)'
    );
    typeNameAndFinish(nes, 'Zed');
    for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_GAMEPLAY,
      'the action-placement session never handed off to gameplay -- catches a shim tail-jumping to a label never ' +
        '.include\'d because NAME_ENTRY_ENABLED && !NAME_ENTRY_BANKED was miscomputed'
    );
    assert.equal(nes.cpu.mem[NM_LEN], 3, 'nm_len should read 3 after typing a 3-letter name');
    const expected = nameTiles('Zed');
    assert.deepEqual(
      nameBytes(nes, 0),
      expected,
      'the typed name should land at pc_name_ram slot 0, blank-padded -- catches nameentry_write_cell writing to ' +
        'the wrong stride offset on this placement'
    );
  }
);

test(
  'action placement: DEL via the grid cell and DEL via the Cancel action produce identical pc_name_ram contents',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.party[0].renamable = true;
    });

    const viaGrid = bootToNaming(built.romPath);
    waitForNamingReady(viaGrid);
    clearName(viaGrid); // wipe the seeded default ("Hero") before this test starts
    gotoCell(viaGrid, 0, 0); // 'A'
    tap(viaGrid, BUTTON.A);
    assert.equal(viaGrid.cpu.mem[NM_LEN], 1, 'typing must have advanced nm_len before DEL is asserted meaningfully');
    clearName(viaGrid); // DEL via the grid cell -> nameentry_select's own ctrl arm

    const viaCancel = bootToNaming(built.romPath);
    waitForNamingReady(viaCancel);
    clearName(viaCancel); // wipe the seeded default the same way, before either path is tested
    gotoCell(viaCancel, 0, 0);
    tap(viaCancel, BUTTON.A);
    assert.equal(viaCancel.cpu.mem[NM_LEN], 1, 'typing must have advanced nm_len before Cancel is asserted meaningfully');
    clearNameViaCancel(viaCancel); // the Cancel action -> nameentry_cancel

    assert.deepEqual(
      nameBytes(viaGrid, 0),
      nameBytes(viaCancel, 0),
      'DEL via either path must leave identical bytes -- catches the two paths reaching different, or a copied, ' +
        'implementation of nameentry_delete on the kernel-lo placement'
    );
  }
);

test(
  "action placement: END with no edits round-trips the seeded default (hero_name_default = party[0].name normalized), byte-exact",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.party[0].renamable = true;
    });
    const nes = bootToNaming(built.romPath);
    waitForNamingReady(nes);
    const expected = nameTiles('Hero'); // sample's own party[0].name
    assert.deepEqual(
      nameBytes(nes, 0),
      expected,
      'the grid must have seeded pc_name_ram from hero_name_default before this test proves anything about a ' +
        'round trip -- a still-zeroed slot would trivially "round-trip" empty'
    );
    gotoCell(nes, 2, 1); // END, no edits
    tap(nes, BUTTON.A);
    for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the untouched default should still hand off to gameplay');
    assert.deepEqual(
      nameBytes(nes, 0),
      expected,
      'the seeded default must round-trip unchanged when END is pressed with no edits -- catches the seed scan ' +
        '(nameentry_seed_len) or the write-back corrupting an untouched name'
    );
  }
);

test(
  "action placement: the starting screen's own entry event fires exactly once, after naming, never before and never twice",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const VARIABLES = 0x0500; // engine/constants.asm
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.party[0].renamable = true;
      const screen = project.maps[project.project.startMap].screens[project.project.startScreen];
      // A counter, not a switch: a switch reads identically whether it fired
      // once or twice (setSwitch is idempotent), so it cannot rule out the
      // double-fire this test exists to catch. addVar does: 0 means the
      // entry event never ran at all, 1 means it ran exactly once, 2+ means
      // settle_owed let it run both before and after naming closed.
      screen.entities[0].props.trigger = 'enter';
      screen.entities[0].props.event = {
        pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }]
      };
    });
    const nes = bootToNaming(built.romPath);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should be open');
    waitForNamingReady(nes);
    assert.equal(
      nes.cpu.mem[VARIABLES],
      0,
      'the entry event must not have run yet while the naming session is still open -- proves this assertion is ' +
        'checking a byte that could actually be nonzero, not one structurally stuck at 0'
    );
    gotoCell(nes, 2, 1);
    tap(nes, BUTTON.A);
    for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'naming should have handed off to gameplay');
    for (let i = 0; i < 20; i++) nes.frame(); // let a same-frame-armed entry event actually run
    assert.equal(
      nes.cpu.mem[VARIABLES],
      1,
      'the entry event must fire exactly once -- 0 would mean it never ran (settle_owed swallowed it), 2 would ' +
        'mean it ran once before naming and again after (the starting screen redrawn out from under a still-open ' +
        'session)'
    );
  }
);

test(
  'action placement: restart_game after a real game over re-seeds the default name, not the typed one',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.party[0].renamable = true;
      project.project.titleMap = null; // titleless: restart_game goes straight back into a new game
      // A real, scripted killing hit, not a poked game_state or a routine
      // called out of context: an 'enter' trigger with a live Damage command
      // for MAX_HEARTS reaches player_died (engine/combat.asm) through the
      // ordinary field path (script_op_damage -> lose_hearts -> jmp
      // player_died) the instant gameplay begins, right after naming ends.
      const screen = project.maps[project.project.startMap].screens[project.project.startScreen];
      screen.entities[0].props.trigger = 'enter';
      screen.entities[0].props.event = {
        pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'damage', value: project.project.maxHearts ?? 3 }] }]
      };
    });
    const nes = bootToNaming(built.romPath);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'titleless cold boot should reach naming directly');
    const seededDefault = nameBytes(nes, 0);
    assert.deepEqual(nameBytes(nes, 0), nameTiles('Hero'), 'the grid should still hold the compiled default before it is typed over');
    typeNameAndFinish(nes, 'Zed');
    assert.deepEqual(
      nameBytes(nes, 0).slice(0, 3),
      nameTiles('Zed').slice(0, 3),
      'the typed name should have landed the instant naming ends -- before checking for the game over below, ' +
        'since the entry event\'s own killing Damage command can reach ST_GAMEOVER within the same handful of ' +
        'frames gameplay begins in'
    );

    // Not a separate "still ST_GAMEPLAY" checkpoint: the entry event's own
    // killing Damage command can (and does) reach ST_GAMEOVER within the
    // same short frame budget naming's own handoff uses, so gameplay is
    // real but may already be over again by the time this next poll runs.
    const BOX_ENDWAIT = 6;
    for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] !== ST_GAMEOVER; i++) nes.frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'the entry event\'s own killing Damage command never reached game over');
    for (let i = 0; i < 200 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
    assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the game-over message never reached BOX_ENDWAIT');
    tap(nes, BUTTON.START, 20); // ui_tick_dead's own hardwired restart
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_NAMEENTRY,
      'restart_game should reopen hero naming, titleless -- catches init_session\'s own re-seed not running, or ' +
        'running before pc_name_ram is the byte it is supposed to overwrite'
    );
    waitForNamingReady(nes);
    assert.deepEqual(
      nameBytes(nes, 0),
      seededDefault,
      "the fresh session's own seeded preview must be the compiled default, not the previous session's typed name"
    );
  }
);

test(
  'action placement, titleless: reset reaches the grid directly, and a typed name lands correctly there too',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.party[0].renamable = true;
      project.project.titleMap = null; // titleless -- reset's own !TITLE_ENABLED arm
    });
    const nes = bootRom(built.romPath); // no title to press through
    assert.equal(
      nes.cpu.mem[GAME_STATE],
      ST_NAMEENTRY,
      'a titleless cold boot must reach naming straight out of reset -- catches reset\'s own ' +
        '!TITLE_ENABLED/HERO_NAMING_ENABLED arm never running or running with the wrong box_state'
    );
    typeNameAndFinish(nes, 'Zed');
    for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the titleless session never handed off to gameplay');
    assert.deepEqual(
      nameBytes(nes, 0),
      nameTiles('Zed'),
      'the typed name should land correctly on the titleless arrival too, not just the titled one'
    );
  }
);

// P1-1 (docs/design-name-entry.md phase 3 fix round 2): "a naming grid
// containing blank or authored tiles instead of letters" -- the reviewer's
// own phrase for the wrong ROM this rules out. Read the real drawn
// nametable, not engine RAM: a wrong base-tile arithmetic in
// nameentry_draw_letters, or a font page that never got switched in because
// fontBankSplit stayed false, would leave game_state correctly at
// ST_NAMEENTRY while the grid rows themselves are blank ($A0) or whatever
// art the tileset happened to have at that index -- no RAM assertion can
// see that. Built from createProject, not sample: sample already carries
// dialogue, so its own naming grid was never the project's ONLY text
// source, and P1-1's bug (projectUsesText never turning on for naming
// alone) would have been invisible against it.
for (const [label, mapperId] of [
  ['NROM', 0],
  ['MMC3', 4]
]) {
  test(
    `action placement, ${label}: a project whose ONLY text source is hero naming draws real glyph tiles in the grid, not blank or authored ones`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async (t) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-nameentry-glyph-'));
      t.after(() => fs.rm(dir, { recursive: true, force: true }));
      const project = createProject('Naming-only text');
      project.cartridge.mapper = mapperId;
      project.party[0].renamable = true;
      // Confirmed no other text source: no dialogue, no title (createProject's
      // own default), no combat (no damaging actor/metatile/item).
      const built = await buildProject({ dir, project, log: () => {} });
      const nes = bootRom(built.romPath); // titleless -- straight to naming
      assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, `${label}: hero naming should open at boot`);
      waitForNamingReady(nes);

      // Row 1 (nm_row 0, A-Z): sequential glyph tiles starting at 'A', not a
      // uniform blank/authored run.
      const upperRow = nametableRow(nes, BOX_ROW_UPPER, 3, 26);
      const expectedUpper = Array.from({ length: 26 }, (_, i) => charToTile(String.fromCharCode(65 + i)));
      assert.deepEqual(
        upperRow,
        expectedUpper,
        `${label}: the A-Z row should hold sequential glyph tiles $${expectedUpper[0].toString(16)}-` +
          `$${expectedUpper[25].toString(16)}, not blank or authored tiles`
      );

      // Row 2 (nm_row 1, a-z), same shape, lowercase base.
      const lowerRow = nametableRow(nes, BOX_ROW_LOWER, 3, 26);
      const expectedLower = Array.from({ length: 26 }, (_, i) => charToTile(String.fromCharCode(97 + i)));
      assert.deepEqual(lowerRow, expectedLower, `${label}: the a-z row should hold sequential lowercase glyph tiles`);

      // Controls row: "DEL" and "END" spelled out in real glyph tiles.
      const del = nametableRow(nes, BOX_ROW_CONTROLS, 4, 3);
      assert.deepEqual(
        del,
        [charToTile('D'), charToTile('E'), charToTile('L')],
        `${label}: the controls row should spell "DEL" in real glyph tiles`
      );
      const end = nametableRow(nes, BOX_ROW_CONTROLS, 24, 3);
      assert.deepEqual(
        end,
        [charToTile('E'), charToTile('N'), charToTile('D')],
        `${label}: the controls row should spell "END" in real glyph tiles`
      );

      // Explicitly not the failure mode this test rules out: every tile
      // above must differ from TILE_SPACE ($A0) and must not all read as one
      // single repeated (authored) tile.
      const allDrawn = [...upperRow, ...lowerRow, ...del, ...end];
      assert.ok(allDrawn.every((tile) => tile !== 0xa0), `${label}: no drawn glyph cell should be blank ($A0)`);
      assert.ok(new Set(allDrawn).size > 1, `${label}: the drawn cells must not all be one repeated authored tile`);
    }
  );
}

// P1-B (docs/design-name-entry.md phase 3 fix round 3): the P1-1 test above
// only reads *tile indices* out of the nametable -- it cannot see whether
// those indices' own CHR bytes are real font art. Removing the stamp
// outright ("no stamp") or, on a split board, stamping it into the wrong
// CHR bank ("wrong bank") both leave every P1-1 assertion passing unchanged:
// the nametable still names index $C1 for 'A' regardless of what bytes bank
// $C1 actually holds, or which bank is live when that scanline renders.
// Two independent checks close that gap: the ROM's own CHR bytes (this
// block) prove the right bank *contains* the right art; the framebuffer
// probes further down prove the right bank is *selected* at render time --
// a runtime bank-switch bug could leave the first check green while still
// drawing the wrong page on screen.
const GLYPH_CELLS = [
  ['A', BOX_ROW_UPPER, 3],
  ['Z', BOX_ROW_UPPER, 28],
  ['a', BOX_ROW_LOWER, 3],
  ['D', BOX_ROW_CONTROLS, 4],
  ['E', BOX_ROW_CONTROLS, 5],
  ['L', BOX_ROW_CONTROLS, 6],
  ['N', BOX_ROW_CONTROLS, 25]
];

for (const [label, mapperId] of [
  ['NROM', 0],
  ['MMC3', 4]
]) {
  test(
    `action placement, ${label}: the naming grid's tile indices hold real font pattern data in ROM, not blank bytes ("no stamp") or the wrong CHR bank ("wrong bank")`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async (t) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-nameentry-pattern-'));
      t.after(() => fs.rm(dir, { recursive: true, force: true }));
      const project = createProject('Naming-only text');
      project.cartridge.mapper = mapperId;
      project.party[0].renamable = true;
      const mapper = resolveMapper(mapperId);
      const split = fontBankSplit(project, mapper);
      // The font page is appended after every tileset's own CHR bank
      // (generate.js's own `chrPayloads.push(chr)`), so its bank index is
      // project.tilesets.length on a split board -- 1, here, since
      // createProject gives an action project exactly one tileset -- and 0
      // (the only bank there is) when the font is stamped directly instead.
      const fontBankIndex = split ? project.tilesets.length : 0;
      const built = await buildProject({ dir, project, log: () => {} });

      for (const [ch] of GLYPH_CELLS) {
        const tileIndex = charToTile(ch);
        const actual = romChrTileBytes(built.romPath, fontBankIndex, tileIndex);
        const expected = [...encodeTiles([FONT_TILES[tileIndex - FONT_BASE]])];
        assert.deepEqual(
          actual,
          expected,
          `${label}: tile $${tileIndex.toString(16)} ('${ch}') should hold shared/font.js's own glyph art in ` +
            `${split ? 'the split font page' : "the tileset's own CHR bank"} -- a blank stamp reads back as ` +
            `sixteen zero bytes ("no stamp"); got [${actual.join(',')}]`
        );
      }

      if (split) {
        // The mirror-image check: the tileset's OWN CHR bank (bank 0) must
        // NOT hold the glyph either -- createProject's own default tile at
        // this index is blank, so a "wrong bank" implementation that
        // stamps the glyphs into the tileset instead of (or as well as)
        // the dedicated font page shows up here as sixteen non-zero bytes
        // where blank is expected.
        for (const [ch] of GLYPH_CELLS) {
          const tileIndex = charToTile(ch);
          const tilesetBytes = romChrTileBytes(built.romPath, 0, tileIndex);
          assert.ok(
            tilesetBytes.every((byte) => byte === 0),
            `${label}: tile $${tileIndex.toString(16)} ('${ch}') must stay blank in the tileset's own CHR ` +
              'bank on a split board -- the glyph belongs only in the font page ("wrong bank")'
          );
        }
      }
    }
  );
}

test(
  'action placement, NROM: the naming grid renders the real glyph shape at each cell, not a blank stamp ("no stamp")',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-nameentry-pixels-nrom-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const project = createProject('Naming-only text'); // NROM is createProject's default action mapper
    project.party[0].renamable = true;
    const built = await buildProject({ dir, project, log: () => {} });
    const nes = bootRomCapturing(built.romPath);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should open at boot');
    waitForNamingReady(nes);
    // Move the cursor sprite (a real OAM sprite, not a nametable write, per
    // draw_nameentry_cursor) off of every cell this test samples -- its
    // default post-raise position is (0, 0), the 'A' cell itself, and the
    // sprite's own arrow art would otherwise corrupt exactly that cell's
    // pixel comparison below with a third, unaccounted-for colour.
    gotoCell(nes, 1, 25); // 'z', not among GLYPH_CELLS
    nes.frame();
    nes.frame();
    const frame = nes.lastFrame();

    for (const [ch, row, col] of GLYPH_CELLS) {
      const tileIndex = charToTile(ch);
      const expectedPixels = decodeChr(encodeTiles([FONT_TILES[tileIndex - FONT_BASE]]))[0];
      assert.ok(
        [...expectedPixels].some((value) => value !== 0),
        `'${ch}'’s own glyph art must have at least one foreground pixel, or this check would be vacuous`
      );
      const raw = [];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) raw.push(frame[(row * 8 + y) * 256 + col * 8 + x]);
      }
      // Background is whichever raw colour is the majority in this cell:
      // every glyph in shared/font.js is drawn inside an 8x8 cell from rows
      // at most 5 columns wide, so background pixels always outnumber
      // foreground ones (checked directly above, not assumed).
      const counts = new Map();
      for (const value of raw) counts.set(value, (counts.get(value) ?? 0) + 1);
      const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const renderedMask = raw.map((value) => value !== background);
      const expectedMask = [...expectedPixels].map((value) => value !== 0);
      assert.deepEqual(
        renderedMask,
        expectedMask,
        `NROM: the '${ch}' cell at row ${row} col ${col} should render the real glyph shape read straight off ` +
          `the framebuffer, not a uniform blank stamp ("no stamp") -- rendered raw colours ${JSON.stringify(raw)}`
      );
    }
  }
);

// P2-3 (phase 3 fix round 4): the original version of this test only ever
// sampled row 5 (well above the box) and row 26 (BOX_ROW_UPPER, well inside
// it) -- two rows so far from the real boundary that a split armed several
// rows early (row 10 instead of 24) still reads 'art' at row 5 and 'font' at
// row 26, and a split that switches back to the art bank early (before rows
// 27-28 render) still reads 'font' at row 26, passing either way. Fixed:
// probe row 23 (the last row above the box -- must be 'art', tight against
// the real boundary) and every row the box itself draws, 24 (its own top
// border, drawn from font-page border glyphs the same as its text) through
// 28 (BOX_ROW_CONTROLS, the last content row) -- each individually, so no
// single row's own split-timing bug can hide behind a neighbour. Row 29
// (the box's nominal bottom border) is deliberately excluded rather than
// asserted either way, but NOT because it is genuinely outside the split's
// font-page range -- P3 (round 4 review): the vendored core's own
// `endFrame()` (renderer/emulator/core/ppu/index.js) blanks the top and
// bottom 8-pixel rows of the framebuffer to zero, unconditionally, AFTER
// the whole frame has already rendered, whenever `clipToTvSize` is true
// (the default) -- simulating a real TV's overscan by clipping the picture,
// not by skipping anything the PPU actually drew. Row 29 is tile row 29,
// pixel rows 232-239, exactly the bottom band that clip zeroes. So
// `probeKind`'s own colour-count read of row 29 is always a single colour
// (0) regardless of which CHR bank the PPU used while rendering that
// scanline -- a wrong bank there is invisible to this probe technique
// specifically because of this post-render clip, not because the box's own
// bottom border is drawn from anywhere other than the font page.
test(
  `action placement, MMC3: the naming grid renders from the font's own CHR bank at runtime, not the tileset's art bank ("wrong bank"), on a project whose ONLY text source is hero naming`,
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-nameentry-pixels-mmc3-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const project = createProject('Naming-only text');
    project.cartridge.mapper = 4;
    project.party[0].renamable = true;
    project.tilesets[0].background.tiles[PROBE_TILE] = SOLID_TILE;
    const built = await buildProject({ dir, project, log: () => {} });
    const nes = bootRomCapturing(built.romPath);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should open at boot');
    waitForNamingReady(nes);

    probe(nes, 23, 2);
    assert.equal(
      probeKind(nes, 23, 2),
      'art',
      'row 23, the last row above the box, must still render from the tileset\'s own (unstamped) CHR bank -- a ' +
        'split armed too early (before row 24) would read \'font\' here'
    );
    for (let row = 24; row <= 28; row++) {
      probe(nes, row, 2);
      assert.equal(
        probeKind(nes, row, 2),
        'font',
        `row ${row} of the naming grid's own box must render from the font page, on a project whose only text ` +
          "source is naming -- a split armed too early (e.g. row 10 instead of 24) or one that switches back to " +
          `the art bank early (before rows 27-28 render) would leave row ${row} reading 'art' instead`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// The Say token (docs/design-name-entry.md §9a, phase 4) -- the action,
// kernel-lo placement. text_type_step's own new arm is identical source on
// either placement, but the action placement's own hero_name_default seed
// path (init_session's own copy loop, engine/combat.asm) is genuinely
// different code from the RPG placement's party_init seed
// (test/unit/rpg.test.js already covers that one) -- so this needs its own
// coverage rather than assuming the RPG-side proof carries over.

const BOX_TEXT_ROW = 25; // engine/constants.asm -- the field box's text starts here, column 2
const BOX_TEXT_COL = 2;

/** Talk (B), run frames until the box has finished typing (or is waiting to
 *  be dismissed), then settle a few more frames for the last queued glyph to
 *  drain into the nametable. */
function openSayAndSettle(nes, budget = 200) {
  tap(nes, BUTTON.B);
  const BOX_PAGEWAIT = 3;
  const BOX_ENDWAIT = 6;
  for (let frame = 0; frame < budget; frame++) {
    const box = nes.cpu.mem[BOX_STATE];
    if (box === BOX_PAGEWAIT || box === BOX_ENDWAIT) break;
    nes.frame();
  }
  for (let i = 0; i < 4; i++) nes.frame();
}

test(
  'action placement: the Say token renders hero_name_default ("Hero") in the nametable when naming is off -- P1-2\'s action-side equivalent',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      // Naming stays off throughout -- party[0].renamable is never set.
      project.maps[0].screens[0].entities.push({
        actorId: 0,
        x: 112,
        y: 96,
        props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hi {name}.' }] }] } }
      });
    });
    const nes = bootToNaming(built.romPath); // sample carries a title -- press through it
    assert.notEqual(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'no naming session should ever open -- hero naming is off');
    openSayAndSettle(nes);
    assert.deepEqual(
      nametableRow(nes, BOX_TEXT_ROW, BOX_TEXT_COL, 'Hi Hero.'.length),
      textToTiles('Hi Hero.').tiles,
      "init_session's own hero_name_default copy loop should have seeded pc_name_ram slot 0 with the compiled " +
        'default ("Hero", createProject\'s own default party[0].name) with no naming session ever opening'
    );
  }
);

// P1-A (round-1 finding): the token's OTHER compile path -- plain dialogue,
// no authored event at all -- end to end, action placement. kernelbytes.
// test.js:3842 already covers the predicate half (projectUsesNameToken must
// read effectiveDialogue, not just projectEvents); this is the real build +
// nametable half, which nothing exercised before this round.
test(
  'P1-A (round-1 finding), action placement: the token in PLAIN DIALOGUE (no authored event) renders the real name after talking to the entity',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.maps[0].screens[0].entities.push({
        actorId: 0,
        x: 112,
        y: 96,
        props: { dialogue: 'Hi {name}.', event: null }
      });
    });
    const nes = bootToNaming(built.romPath);
    openSayAndSettle(nes);
    assert.deepEqual(
      nametableRow(nes, BOX_TEXT_ROW, BOX_TEXT_COL, 'Hi Hero.'.length),
      textToTiles('Hi Hero.').tiles,
      'plain dialogue carrying the token should expand it the same as a scripted Say'
    );
  }
);

test(
  'action placement: after hero naming, the Say token renders the TYPED name, not the default',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.party[0].renamable = true;
      project.maps[0].screens[0].entities.push({
        actorId: 0,
        x: 112,
        y: 96,
        props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hi {name}.' }] }] } }
      });
    });
    const nes = bootToNaming(built.romPath);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should open at the start of a new game');
    typeNameAndFinish(nes, 'Zed');
    for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'naming should have handed off to gameplay');
    openSayAndSettle(nes);
    assert.deepEqual(
      nametableRow(nes, BOX_TEXT_ROW, BOX_TEXT_COL, 'Hi Zed.'.length),
      textToTiles('Hi Zed.').tiles,
      'the token should expand to the just-typed name, not the compiled default'
    );
  }
);

// P1-1 (round-1 finding), action placement: a Say with the token TWICE,
// proving both instances draw correctly. draw_entities' own ptr_lo/ptr_hi
// write (engine/entities.asm) runs every frame regardless of a token --
// exactly why text_type_name reloads ptr_lo/ptr_hi unconditionally rather
// than only on a token's own first frame (P1-1's fix). The text between the
// two occurrences ("meet") forces several ordinary glyph frames, each
// running draw_entities in between, so the SECOND token's own first frame is
// reached only after draw_entities has already written ptr_lo/ptr_hi for
// whatever else is on screen (sample's own slime is idle-animated) -- the
// identical proof rpg.test.js already gives the banked placement, needed
// again here because this placement's own typewriter is the same source but
// a different call context (reached via ui_tick's kernel-lo dispatch, never
// through call_battle).
test(
  'P1-1 (round-1 finding), action placement: a Say with the token TWICE draws the SECOND token correctly too',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { built } = await buildActionNamingVariant(t, (project) => {
      project.maps[0].screens[0].entities.push({
        actorId: 0,
        x: 112,
        y: 96,
        props: {
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: '{name} meet {name}.' }] }] }
        }
      });
    });
    const nes = bootToNaming(built.romPath); // sample carries a title -- press through it
    openSayAndSettle(nes, 400);
    assert.deepEqual(
      nametableRow(nes, BOX_TEXT_ROW, BOX_TEXT_COL, 'Hero meet Hero.'.length),
      textToTiles('Hero meet Hero.').tiles,
      'both the first AND the second token instance must read the real name'
    );
  }
);
