# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Electron app for building NES games through a UI (nine "Forges": Tile, Sprite, Character, Items,
Magic and Monster (RPG projects only), Map, Sound, Controller — plus the Code Forge,
the escape hatch for hand-written 6502), which compiles a
project into a real `.nes` ROM with `nesasm` and plays it in a built-in emulator with a debugger. See `README.md` for the user-facing description and
current feature status table.

## Commands

```sh
npm start                 # run the app
npm test                  # unit + headless integration tests
npm run smoke             # boot the real Electron window and drive the whole workflow
npm run sample            # (re)write the demo project to ./sample
npm run build:sample      # assemble sample/build/game.nes headlessly
npm run sample:rpg        # (re)write the RPG demo to ./sample-rpg
npm run build:sample:rpg  # assemble sample-rpg/build/game.nes
npm run sample:mmc1       # (re)write the MMC1 fixture to ./sample-mmc1
npm run build:sample:mmc1 # assemble sample-mmc1/build/game.nes
npm run sample:mmc3       # (re)write the MMC3 fixture to ./sample-mmc3
npm run build:sample:mmc3 # assemble sample-mmc3/build/game.nes
npm run sample:u512       # (re)write the UNROM 512 fixture to ./sample-u512
npm run build:sample:u512 # assemble sample-u512/build/game.nes

node --test test/unit/music.test.js                          # one test file
node --test --test-name-pattern "door warps" test/unit/*.test.js   # one test
node main/build/cli.js <projectDir>                          # build any project headlessly

Mesen --testRunner test/lua/engine_smoke.lua sample/build/game.nes   # exit 0 = pass
test/lua/run_sram_check.sh [mesen-path]                             # battery save, both boards
test/lua/run_sram_check.sh [mesen-path] --break=mmc3-a001            # ...and its negative control
test/lua/run_flash_check.sh [mesen-path]                            # flash save, UNROM 512
test/lua/run_flash_check.sh [mesen-path] --break=u512-no-erase       # ...and its negative controls
```

Several tests **skip** unless `sample/build/game.nes` exists — run `npm run sample && npm run
build:sample` first, and `npm run sample:rpg && npm run build:sample:rpg` for `rpg.test.js`.
A skipped test is not a passing test; check the skip count.

`test/unit/docs.test.js` checks CLAUDE.md itself: every `docs/*.md` pointer it names must
exist on disk *and* be tracked by git, and the file must stay under a 135,000-character budget
(`fs.readFileSync(..., 'utf8').length`, not byte length — Claude Code's own limit is on
characters) kept below the tool's 150,000-character hard limit for margin.

There are **six fixtures, deliberately**. `sample/` is the action-adventure one every engine test is
written against; `sample-rpg/` is the turn-based one `rpg.test.js` drives; `sample-mmc1/`,
`sample-mmc3/`, `sample-u512/` and `sample-rpg-mmc1/` are small save-check fixtures — one per
save-capable board, plus a second MMC1 one for an RPG's own extra save-adjacent bank switches
(`docs/design-rpg-save-fixture.md`) — that exist to cover a board rather than to demonstrate a game.
They are separate projects, not variants of the other two, because `sample/` and `sample-rpg/` are
mapper-agnostic by design — pinning either to a specific mapper to reach one of these four would
narrow a fixture every other engine test depends on, for a concern (a specific board's own save
behaviour) only the Mesen save checks have. Those checks — `test/lua/run_sram_check.sh` and
`test/lua/run_flash_check.sh`, driving `save_sram.lua` and `save_flash.lua` — are what these four
exist to feed, and the only things that consume them. No test may mutate any of the six — variants
go to `mkdtemp` directories — and no existing test is repointed at any of the new ones: every
engine test stays written against `sample/`.

`sample-mmc1/` and `sample-mmc3/` are **the same walk on two boards**: same 2x1 world, same saver
at the same coordinates running the same page, differing only in mapper and in the `Say` the MMC3
one opens with (that board is the scanline-IRQ one, and a message box puts the font split to work
during real gameplay, not just the title) — so the only thing that can make one pass and the other
fail is the board's own register behaviour. `sample-u512/` is the same walk again, on a third
board, mapper swapped and no opening `Say` (see `tools/make-u512-sample.js`'s own header for why
not), but for a genuinely different reason: MMC1 and MMC3 differ only in *register encoding* for
the same battery-WRAM medium, while UNROM 512 differs in the *save medium itself* — no
battery-backed WRAM at all, saving instead by reflashing its own PRG-ROM (`engine/flash.asm`).
`run_sram_check.sh` and `run_flash_check.sh` are consequently not one check with two runners; they
exercise different engine code (`engine/save.asm`'s battery path vs its flash path) against
different Mesen models (WRAM enable/write-protect gating vs a JEDEC flash state machine) and, for
`run_flash_check.sh`, a form of persistence (`Core/NES/Mappers/Homebrew/FlashSST39SF040.h`'s own
write-through, saved as an `.ips` patch keyed off the ROM's basename) the SRAM check has no
equivalent of at all.

All four save-check fixtures' saver pages are guarded on the switch they set — `Save` records
where the player is standing, which for a `touch` trigger is on top of the actor that fired it, so
Continue restores the player mid-contact and `spawn_entities` arms the trigger again during the
load's own redraw. Without the guard the page re-runs a frame later and hands out a second gem —
the engine behaving as specified, but making the restored bag impossible to assert exactly, since a
load that came back empty and one that came back correctly both read as "something in the bag" once
the re-run has refilled it.

`FORGE_SHOT=out.png` (optionally with `FORGE_SHOT_FORGE=map`) makes `npm run smoke` write a
screenshot, which is the practical way to see the UI without a human at the keyboard.

`npm start` passes `--no-sandbox` because Ubuntu 24.04's AppArmor policy blocks unprivileged user
namespaces. `npm run start:sandboxed` works after a one-time `chown root` of
`node_modules/electron/dist/chrome-sandbox` (see README).

Requires `nesasm` v3.1 on `PATH`. Mesen is optional (used by "Open in Mesen" and the Lua tests).

## Architecture

### The pipeline

A project is a folder of JSON (`shared/project.js` owns the schema). Building it means:

```
project JSON
  → main/build/generate.js   emits build/assets/*.inc and tilesN.chr
  → engine/*.asm copied into build/
  → nesasm main.asm          (main/build/nesasm.js)
  → inspectRom()             (main/build/pipeline.js) verifies header, size, reset vector
  → build/game.nes + game.fns
```

`main/build/cli.js` runs exactly this without Electron, which is what the package's own
`build:sample`/`build:sample:rpg`/etc. scripts use it for — not the tests, which call `buildProject`
directly (below).

The renderer already refuses a second, reentrant `build()` call from the same Build Forge mount (a
plain `building` boolean, checked before dispatch) — but that only protects one mount against
itself, not a concurrent build after a fresh mount replaces it. `main/build/buildgate.js`'s
`createBuildGate()` closes that: it allows exactly one in-flight **`build:run` IPC call** per
project directory (canonicalized with `realpathSync`), refusing a second request outright rather
than queuing it — queuing would not re-read the project when its turn came, since `build()`
(`renderer/forges/build/build.js`) clones it before dispatching, and the longer a queued snapshot
waited, the more stale it would get. This has to live in the main process, not the renderer: the
renderer is exactly what gets destroyed if the user navigates away mid-build, so a per-mount flag
there cannot stop a second, concurrent caller from racing `generate.js`'s own `fs.rm(buildDir)`. It
only covers that one channel — unit and Lua tests import `buildProject` (`main/build/pipeline.js`)
directly, bypassing both this gate and `main/build/cli.js` entirely, and `npm run smoke` is the
only thing that goes through `build:run` and is covered by it. There is no CI configuration in this
repository — `main/build/cli.js`'s own bypass, regenerating the checked-in fixtures' ROMs by hand,
is the same one described above.

### The single-writer rule

Anything the 6502 engine and the JavaScript tooling both depend on has **one** definition:

- Engine/generator constants → generated into `build/assets/config.inc`. Never hardcode a value
  in both `engine/*.asm` and `main/build/*`.
- Cartridge/mapper facts → `shared/cartridge.js`. It is the only place that knows a mapper's PRG
  size, legal CHR sizes, tileset ceiling and whether the engine supports it yet. The iNES header
  is *generated* into `build/assets/cartridge.inc`; never write `.ines*` directives in
  `engine/main.asm`, or the UI, the capacity math and the header end up with three answers.
- The music format → `shared/audio.js`. It is implemented three times (the 6502 driver in
  `engine/music.asm`, the compiler in `main/build/songcompile.js`, the preview replayer in
  `renderer/forges/sound/replayer.js`). `test/unit/music.test.js` runs the built ROM in the
  emulator, records every write to `$4000-$400F`, and asserts it is byte-identical to the
  replayer's — change one implementation, change all three or that test fails. Every song's own
  instruments reach the ROM: `songTables` concatenates them in song order, `song_inst_base` names
  each song's offset, and the driver adds it into `mus_inst_base` (256 entries combined,
  `MAX_TOTAL_INSTRUMENTS`). `songByte`, `NO_SONG`, `songTimeline` and `songFrameLength` (a song's
  own length in frames, one full pass through its authored order) live here too, not in
  `main/build/textcompile.js`, because `shared/project.js`'s `validateProject` needs the identical
  resolution and cannot import upward from `main/build/` — `textcompile.js` re-exports
  `NO_SONG`/`songByte` verbatim for its existing importers (`main/build/generate.js`,
  `test/unit/script.test.js`). The `Sting` scripted command (item 6) is not a fourth implementation of the format:
  it plays an existing song through the same unmodified driver, pausing and resuming whichever
  song was already playing — see `docs/design-sting.md` for the full design and
  `engine/music.asm`'s own `sting_snapshot`/`sting_restore`/`sting_tick` comments for the
  mechanisms. The `Sfx` scripted command (item 6's last verb) is a genuinely separate, smaller
  format beside the music one, with its own single-writer contract in `shared/audio.js` (`NO_SFX`,
  `SFX_MAX_STEPS`, `sfxByte`, `normalizeSfx`, `sfxFrameLength`), implemented three times the same
  way — `engine/music.asm`'s `sfx_*` routines, `compileSfx`/`sfxTables` in
  `main/build/songcompile.js`, and `SfxReplayer` in `renderer/forges/sound/replayer.js` — held
  byte-identical by `test/unit/sfx.test.js`'s own golden trace. See `docs/design-sfx.md` for the
  full design.
- The NES palette → `shared/nespalette.js`, shared by the editors *and* the emulator, so the
  in-app preview matches the editors by construction.
- The message font → `shared/font.js`: the glyph art, the character-to-tile mapping, the window
  furniture aliases (`BORDER_H`, `ARROW_TILE`, …), `wrapText`, and the `projectUsesText` /
  `projectUsesCombat` predicates that decide whether a project pays for any of it. **The
  reservation is conditional**: a project that never shows text keeps all 256 background tiles,
  and one that does loses `$A0-$FF` in *every* tileset — except on MMC3, where `fontBankSplit`
  (also here) moves the font into its own CHR page and the scanline IRQ pays instead; see the
  split section under The engine. The generator stamps the glyphs into the
  **build-time** CHR copies only — never into project data, or the font would turn up in the Tile
  Forge as something the user drew. The same predicate drives the Tile Forge's shading, the
  `validateProject` error, and the stamp, so the three cannot disagree. The glyph *indices* reach
  the engine through `config.inc`, so no `.asm` file spells one out.
- Actions and game states → `ACTIONS` and `INPUT_STATES` in `shared/project.js`. Their *order* is
  the wire format: `generate.js` emits `input_actions` as one row per state of one byte per
  button, and the engine indexes it with `game_state * NUM_BUTTONS`. `ACT_*` and `ST_*` in
  `engine/constants.asm` are those orders written down, so adding an action or a state means
  editing both ends in the same change.
- Describing and resolving a test scenario → `shared/playscenario.js` — not the stored scenario
  itself (`renderer/app.js`'s own `playScenario`/`rememberPlayScenario`), and not which toggles
  exist (`shared/testoverrides.js`'s `TOGGLE_NAMES`). The rule, stated in full in the file's own
  header comment: resolve by current name at call time, never cache a raw index — a screen or
  actor's numeric position is not its identity (`createScreen()`'s own comment says so for screens;
  `sprites.actors` renumbers every later actor on a delete for the same reason, item 7's own
  reorder/duplicate/delete family included). `describePlayScenario` turns Map Forge's raw numeric
  choice into a name/position description when a scenario is picked;
  `resolveStartAt`/`resolveFormation` (via `mapsNamed`/`screensNamed`) resolve it back later
  against whatever project is then in hand, refusing rather than following a rename of the map, a
  *named* screen, or the tracked actor — an unnamed screen instead falls back to its position
  within its own map, a value item 7's map reorder never touches.
- Rewriting every stored flat-screen reference after a map/screen structural edit →
  `remapScreenReferences(project, translate)` in `shared/project.js` (item 7, "Map organization and
  reuse"). It is the single place that knows *which fields* hold a flat screen reference — the
  fuller passage below, near `renderer/store.js`, has the rest.
- Engine RAM addresses → `engine/constants.asm`. Tooling that has to know where a byte lives
  *parses* them (`parseEquates` in `shared/enginesyms.js`) out of the `constants.asm` in `build/`,
  which is the copy that assembled the ROM in hand — a Code Forge override of it included. The
  Map Forge's ▶ Test tool is the caller: `renderer/emulator/testplay.js` pokes the engine's own
  `warp_*` bytes after boot, synchronizing on `main_loop_warp` — a label that exists in
  `engine/boot.asm` purely to be that point, and emits no bytes, so the ROM is identical with and
  without it. The same goes for the *labels* generally: `game.fns` is how the tooling names an
  address, so a label is cheaper than an assumption about which instruction follows which. Tests hardcode addresses with a `; from engine/constants.asm` comment
  because a test that reads the file it is checking proves nothing; shipping code must not.

`shared/` modules must stay free of DOM and Node APIs: they are imported by the main process, the
renderer, and `node:test` alike.

### Electron layout

- **Main** (`main/`) owns all filesystem access, the build pipeline, and settings.
- **Renderer** (`renderer/`) is sandboxed with `contextIsolation` — it has no `fs`. Everything it
  can reach is enumerated in `main/preload.cjs`.
- The app is served over a custom `forge://` scheme registered in `main/main.js`, **not**
  `file://`, because ES modules cannot be fetched from an opaque `file://` origin.
- Every `ipcMain.handle` (`main/ipc.js`) is wrapped through one `guardedHandle` refusing a call
  whose `event.senderFrame` is not this app's own `forge://app/` origin. Saves queue one chain per
  canonicalized directory (`main/savequeue.js`/`main/paths.js`), so concurrent saves to a project
  serialize rather than interleave, and each file lands via a sibling temp file and atomic rename.
- **Unsaved changes are guarded in main, never by `beforeunload`.** The renderer pushes its dirty
  state to main (`project:dirty`) whenever it changes, and the window's `close` handler — plus the
  View ▸ Reload item, which discards just as thoroughly — asks there. Vetoing `beforeunload` from
  the renderer *looks* like it works and is a trap: Electron cancels the close with no dialog, so
  the title-bar X silently stops working for the rest of the session. The smoke test asserts the
  report reaches main, because nothing in the renderer-side scenario can see this.
- **A pixel canvas is sized from its stage, never from a constant.** The shell is CSS grid and
  reflows on its own, but the drawing surfaces are integer-zoomed pixel art, so they only follow
  the window if something recomputes the zoom: `fitZoom()` and `observeSize()` in `renderer/ui.js`
  are that something, and the Tile, Sprite and Map Forges plus the emulator all go through them.
  Two rules keep the observer from chasing itself — it watches the *border* box, not the content
  box a scrollbar changes and the redraw affects, and it calls the redraw synchronously from the
  callback rather than deferring it a frame (which would trade a "ResizeObserver loop completed"
  renderer error for a redraw that never arrives in a throttled window). The smoke test resizes the
  real window and asserts the map screen grew, since a hardcoded zoom looks correct at whatever
  size it was written for.
- **A Forge selection must check it is still the current one after its own `await`.**
  `selectForge(id)` (`renderer/app.js`) is called unawaited from `store.subscribe`'s `'open'`
  handler, so two selections can be in flight and the *earlier* one can finish last. A module-level
  `selectionToken` counter is bumped once by every call that gets past its own guards and re-checked
  after `await entry.load()` and again in the `catch`; a superseded call returns before it mounts
  anything or sets the status bar, but has still torn the stage down — the token is taken *before*
  `mounted` is destroyed and `dom.stage` cleared — safe only because the winner took its own token
  later and tears down again, mounting after both. Missing the check looks like a screenshot or
  harness artefact rather than a bug: the second Forge mounts, then the first one's late import
  mounts over it, leaving two `.forge` elements in `#stage`, exactly what `main/smoke.js`'s own
  same-tick selection race step asserts against.
- **The same token also bounds a navigation context's lifetime**, added for the Monster ↔ Sprite deep
  link. `app.goTo(id, context)` writes `pendingRequest = { targetId, context, atRevision:
  store.revision }` and calls `selectForge(id)`, which claims `pendingRequest` unconditionally as
  its first statement, before either of its own early returns. `activeContext = { token, context }`
  is bound only after `await entry.load()`, and only if `store.revision` has not moved since the
  request was made — a bounds check on a captured actor id cannot see a delete that renumbered
  everything in between, only the revision check can. `app.consumeContext()` hands the context to
  the mounting Forge at most once, only when `activeContext.token === selectionToken`, so a
  superseded navigation's context never reaches the winner. `main/smoke.js` exercises this contract
  end-to-end; see `docs/design-monster.md` §2 for the full mechanism and race analysis.

Each Forge is a module exporting `mount(container, app)` and returning
`{ destroy?, onProjectChange? }`; `renderer/app.js`'s `FORGES` array is the single writer for
which Forges exist and lazily imports them — the Items Forge (`renderer/forges/items/items.js`,
item 5's own place to author an item's name, effect and backing Pickup actor) is one of these, not
a special case. `app.forgeIds` is that registry's own derived getter
(`FORGES.filter(...).map((f) => f.id)`), not a second writer — it exists so `main/smoke.js`'s
"visit every Forge" step can read `FORGES` without a hand-maintained list of its own, the drift
that let the Items Forge almost ship unvisited by that very test. The Magic Forge
(`renderer/forges/magic/magic.js`, item 13's own spell catalog — turn-based RPG projects only) is
`FORGES`' first entry to carry a `gameTypes` field, and the Monster Forge
(`renderer/forges/monster/monster.js`, item 14's own module) is the second; every other entry is
unconditional, so the field is additive.
`monsterActorIds(project)` (`shared/project.js`) is the Monster Forge's single catalog predicate:
it reads `allCommands` (mentioned, disabled branches included) rather than `liveCommands`
(compiles), and raw `command.monsters`/`map.encounters.actorIds` rather than
`battleFormationSlice`/`mapEncounterFormation`, so an over-cap or rate-zero monster still appears —
the concern is never hiding an actor an author is looking at. `battle.level` is the one
Monster-Forge-only field with no compiled reader: it normalizes to `null` or
`clamp(1, RPG_LIMITS.maxLevel)`, the fixed constant and never `project.rpg.maxLevel`, so lowering
the Build panel's own level cap as a capacity lever cannot silently reclamp an already-authored
bestiary. See `docs/design-monster.md` §2 for the Forge-boundary argument and
`test/unit/monsterlevel.test.js` for the level field's byte-identity proof.
`isForgeAvailable(entry, project)` is the single predicate for whether an entry applies to the
open project, read by exactly three call sites — `renderRail()`, the `app.forgeIds` getter (why
"visit every Forge" stays correct on an action project without special-casing Magic), and
`selectForge`, which guards itself a second way: `activeForgeId` is a bare module-level variable
that outlives a project close, so a stale `'magic'` can reach `selectForge` on a path the rail
never rendered a button for, falling back to `'tile'`. `main/smoke.js`'s own negative case reads
the rendered `.rail-item` titles rather than `forgeIds` — the wrong implementation it catches is a
`renderRail()` that filters differently from the getter, offering a real, clickable button into a
Forge `forgeIds` already excludes.
`renderer/store.js` is the single project state:
`commit()` for a discrete edit, `beginStroke()`/`touch()`/`endStroke()` so a drag is one undo entry.
Undo is whole-project `structuredClone` snapshots.

**Map organization and reuse (ROADMAP item 7)** is what makes a store commit that restructures the
map list safe. `remapScreenReferences(project, translate)` in `shared/project.js` is the single
place that knows *which fields* hold a flat screen reference — every placed entity's
`props.toScreen`, every `warp` command's `screen` operand, reached through `allCommands` so a
nested one is not missed — and rewrites them under a caller-supplied `translate`, which must be
**total**: there is deliberately no "leave it alone" answer, because a reference the function does
not resolve is a reference it is wrong about. `titleMap`/`titleScreen`/`startMap`/`startScreen` are
map-space, not flat-space, and are left to each operation's own fixup instead. Every restructuring
operation — `reorderMapsCore`, `addMapCore`, `duplicateMapCore`, `deleteMapCore`,
`growOrShrinkMap`, `duplicateScreenViaGrowthCore`, `duplicateScreenIntoNewMapCore`,
`pasteRegionCore` — is a commit-free core in `shared/project.js`, called by both
`renderer/forges/map/map.js` (wrapped in exactly one `store.commit()`) and the unit tests directly:
one body, not two. A same-count reorder leaves `screenCount`/`mapCount` untouched, which is what
`saveCompatToken` (below, under `SAVE_LAYOUT_VERSION`) exists to catch. See `docs/design-maporg.md`
for the full mechanism — the `translate` builders, the duplicated-map/screen self/external target
split, `map.folder`, and the world overview.

### The engine

`engine/` is 6502 assembly in **nesasm v3.1** dialect. The cartridge type is per project
(`project.cartridge.mapper`, default NROM-256) and drives a generated header, so nesasm writes a
correct iNES file with no post-processing.

A **tileset is one 8 KB CHR bank**: a 256-tile background table plus a 256-tile sprite table, which
the hardware switches together. Each map names the tileset it draws with (`map.tilesetId`),
flattened into the generated `screen_tileset` table and applied in `redraw_screen`.

**Every cartridge uses one PRG layout**, which is what lets a single engine template serve all of
them:

```
$8000-$BFFF  switchable window -- screen data only, one 16 KB bank at a time
$C000-$DFFF  fixed kernel      -- lookup tables, then engine code
$E000-$FFFF  fixed kernel      -- music and text data, then the CPU vectors
```

The kernel is the last 16 KB, which every supported mapper leaves permanently mapped. Anything the
engine may touch at an arbitrary moment — tables, music, code — therefore lives there, and only bulk
screen data is banked. That is why `set_screen_ptr` is the *single* place a PRG bank is selected, and
why `redraw_screen` is the single place a CHR bank is. NROM is the degenerate case: one switchable
bank, so `screen_bank` is all zeroes and both switch routines are `rts`. The `.bank`/`.org`
directives are generated (`assets/kernel_*.inc`, `assets/screens.inc`) because which nesasm bank is
"last" depends on the mapper's PRG size.

Supported: NROM, CNROM, GxROM, Color Dreams, UxROM, MMC1, MMC3, UNROM 512. `engine/banks.asm` holds one
`switch_chr_bank` and one `switch_prg_bank` per *family*, selected by generated flags rather than a
comparison on the mapper id, so adding a family is additive.

For the discrete boards (CNROM, GxROM, Color Dreams) CHR selection is one write to `$8000-$FFFF`
differing only in which bits carry the bank, so they share a table-driven routine and **adding
another discrete CHR mapper is a data entry in `shared/cartridge.js` with no assembly change** — set
`chrRegisterShift`. That routine writes a table entry back over itself, which both selects the bank
and avoids a bus conflict on real hardware. `chrRegisterShift: null` means the mapper needs its own
block: MMC1 shifts bits into a serial port, MMC3 uses a select/value register pair.

MMC1 and MMC3 ignore the header's mirroring bit and take mirroring from their own registers, in
their own encodings — hence `mapper_init` and the generated `MAPPER_MIRROR`.

UNROM 512 is also the only board offering **four-screen mirroring**, which needs header byte 6 bit 3
*and* bit 0 (bit 3 alone means one-screen on this mapper). nesasm has no directive for bit 3, so
`headerPatch()` supplies it. Four-screen costs a tileset because the extra nametables are backed by
the last CHR-RAM page — `tilesetLimit(mapper, cartridge)` is the single writer for that, and it is
what the schema, the Tile Forge's Add button and the Build panel all consult. The engine only draws
nametable 0, so the extra nametables buy nothing yet; the Build panel says so rather than letting a
tileset quietly vanish.

`reconcileCartridge()` in `shared/project.js` exists because `store.commit()` mutates the project
directly and never runs `normalizeProject`. Changing mapper or mirroring in the UI must call it in
the same commit, or the in-memory project keeps a combination the UI has already stopped offering.
It performs exactly the reconciliation `normalizeProject` does on load, and a test asserts the two
agree.

**UNROM 512 (mapper 30) is the CHR-RAM case** and the only one that bends two rules. It ships no
CHR-ROM: `chrPayloadRegions()` reserves one 8 KB region of the *switchable window* per tileset, and
`chr_ram_init` streams each into a pattern page at boot, so tilesets consume screen capacity there.
Its single register carries the PRG bank in bits 0-4 and the CHR page in bits 5-6, so neither can
be set without the other — `mapper_shadow` holds the last value written and both switch routines
rewrite the whole byte. Because iNES cannot declare CHR-RAM, `applyHeaderPatch()` in `pipeline.js`
rewrites the 16-byte header to NES 2.0 after assembly; `headerPatch()` returns `{}` for every
mapper needing neither that nor a plain byte-6 bit set (battery on a project that never saves,
four-screen on a board without the nametable RAM for it), so "nesasm writes a correct header with
no post-processing" still holds for them. Battery-backed save (below) is the other bit-set case:
iNES byte 6 bit 1, applied the same way four-screen's bit 3 already was, rather than dragging MMC1
and MMC3 into the NES 2.0 path only UNROM 512 needs.

**A slot ring for flash save was designed, costed and rejected**, not never considered. UNROM 512's
flash commit is not power-loss atomic. A single-sector ring and a two-sector A/B journal (genuinely
atomic) were both costed; neither was built. See `docs/design-flash-slot-ring.md` — the journal, not
the ring, is where to start if atomicity ever becomes a real requirement.

**MMC3's scanline IRQ gives the font its own CHR bank** (`engine/split.asm`). On a board whose
registry entry has `scanlineIrq: true` — only MMC3 — a project that shows text does *not* get the
glyphs stamped into its tilesets: the generator appends one font CHR page after them, and the IRQ
switches MMC3's R1 register (background tiles `$80-$FF`) to that page exactly where the text
windows start — the message box (row 24), the battle box (row 20), and the title's two text bands.
`fontBankSplit(project, mapper)` in `shared/font.js` is the single writer for the whole rule: the
generator's stamping, the Tile Forge's shading, and `validateProject`'s collision check all consult
it, so on MMC3 the `$A0-$FF` reservation simply disappears (and the font page costs one CHR page —
`fontChrPages` feeds `tilesetLimit`'s `reservedChrPages`). The machinery has three invariants:

- **Interrupt-time code only ever selects MMC3 register 1.** NMI restores the tileset's R1 (from
  the `chr_r1` shadow `switch_chr_bank` keeps) and arms the frame's split program; each IRQ applies
  one entry and arms the next. Because both interrupts only touch R1, one landing inside the
  other's `$8000/$8001` pair re-selects the register the interrupted write wanted anyway.
- **`switch_chr_bank`'s mapper-register pairs run only under forced blank with the counter
  disabled** — `redraw_screen` and `draw_battle_screen` clear `$2000` (NMI off, not merely masked)
  and write `$E000` the moment they blank, so neither interrupt source can land inside its register
  pairs. `switch_prg_bank` does not get that guarantee for free: `call_battle` (`engine/banks.asm`)
  calls it with rendering on and the picture live, every tick of a battle, so it carries its own
  critical section — `php`/`sei` mask the scanline IRQ (restoring the caller's interrupt state
  exactly, since this also runs during boot), and `split_lock`, a flag `split_arm` checks before
  touching R1, stands in for masking NMI, which `sei` cannot do. A stray NMI there costs at most one
  frame of the wrong CHR bank on the split, never a half-selected PRG or CHR register.
- **The split follows state, not events**: `split_select` recomputes `split_mode` from
  `game_state`/`box_state` every frame in one store, so no transition can leave a stale program
  armed. The split programs live in ROM, built from the same row constants that draw the windows.

The counts in `split.asm` are calibrated to the vendored core (asserted per scanline by
`split.test.js`); real hardware clocks at dot 260 and runs one scanline ahead, which puts a
one-line sliver of the other bank on the last line of the row above each window for tiles ≥ `$80`
— decoration, and only there. Two knock-ons: the battle *targeting* cursor is a sprite on split
builds (the arrow glyph's bank is only mapped below the box, and monsters live above it), which
reserves sprite tile `$FD` via `SPRITE_ARROW_TILE`; and the vendored jsnes `mapper4.js` was patched
to nesdev-correct IRQ semantics — upstream had `$C000`/`$C001` backwards — so the in-app player
and Mesen count the same way (see `FORGE-PATCHES.md`).

Every mapper in the registry is implemented, so `resolveMapper()`'s fallback to NROM now only fires
for a mapper number the registry does not list at all — a hand-edited project, or one saved by a
later version. The `supported` / `unsupportedReason` fields and the Build panel's disabled-option
rendering are kept because they are the mechanism for adding a mapper honestly: declare it, let the
UI show why it is not selectable, then implement it. No entry currently exercises that path.

Two mappers were considered and deliberately left out rather than declared. AxROM (7) switches all
32 KB at once, so there is no fixed window for the kernel and the engine would have to be duplicated
into every bank — which nesasm cannot do by re-including code, since the labels would collide. MMC5
(5) is the most complex NES mapper made and nothing here needs it.

nesasm banks are 8 KB, so `engine/main.asm`'s layout matters:

| bank | contents |
|---|---|
| 0 .. n-3 | screen data, packed into the switchable window ($8000 / $A000 alternating) |
| n-2 `$C000` | lookup tables, then all engine code |
| n-1 `$E000` | compiled music, then dialogue strings and events, then the CPU vectors at `$FFFA` |
| n+ | one `tilesN.chr` per tileset, emitted into `assets/chr.inc` |

where `n` is `prgUnits * 2`. `shared/cartridge.js`'s `prgLayout()` is the single writer for that
mapping; `kernelCodeBytes()` in `generate.js` is the engine-code allowance the capacity check
reserves, and must be re-measured if the engine grows — see "The kernel budget" below.

`generate.js`'s `checkCapacity()` computes that split and reports overflow as a plain-language
error *before* the assembler runs. Adding per-screen or per-actor data means updating the byte
math there too.

`engine/constants.asm` is the single allocation map for zero page and the `$0300+` RAM arrays.
New engine state goes there; a collision is silent and will present as an unrelated bug.

`engine/ui.asm` holds the two states where the world is frozen: the inventory menu and dialogue.
They exist because the Controller Forge binds buttons per state, so without them `item`, `cancel`
and `confirm` had nothing to do. `main_loop` runs `ui_tick` instead of the world update while
`game_state` is non-zero, and `do_action` in `input.asm` is the single place that decides what an
action means in the current state; an action with nothing to do there is ignored, never
reinterpreted. The menu is drawn entirely as sprites appended to the shadow *after*
`draw_entities` has parked the unused slots, out of art the project already has — the engine takes
no background tiles for it.

**Nothing but `text.asm` may write to the nametable while rendering is on.** The engine draws a
screen once under forced blank and then leaves it alone, so a message box needs a queue:
`vram_buf` holds `[addr_hi, addr_lo, count, bytes…]` packets terminated by `$00`, the main loop
appends during the frame, and `main_loop_draw`'s **last** store sets `vram_ready` for NMI to drain
after the OAM DMA. Three rules hold it together:

- A frame that ran long leaves `vram_ready` clear, so NMI skips it and the writes land next
  vblank — late, never torn.
- Producers cap themselves at one 32-byte row per frame, which is why raising the box, wiping a
  page, listing a question's options and taking the box down are each a state machine stepped once
  per tick rather than a loop.
- **A packet that is opened must be pushed to at least once.** `vram_drain_byte` tests its counter
  after decrementing it, so a count of zero is 256 — a page of whatever the queue held, written
  into the nametable well past the end of vblank. A producer has to *know* it has a byte before
  `vram_open`: either it always does (fixed-width rows, one-tile writes, the engine's own strings)
  or it looked first. Listing a question's options is the one that has to look, because an answer
  whose label has not been typed yet is an ordinary thing to be holding. The drain is deliberately
  not defended against it, because it runs in NMI every frame.
- **NMI rewrites `$2000` after draining, not before.** A `$2006` write copies its high byte into
  the PPU's `t` register, nametable-select bits included, so resetting `$2005` alone leaves the
  screen scrolled to a different nametable.

**Flash is the first producer allowed to write `vram_buf` outside `ui_tick`'s own priority chain,
which makes "one producer per frame" a bound of two, not one.** `flash_tick`
(`engine/entities.asm`) ticks unconditionally from `main_loop`, alongside `music_tick`, so a
non-suspending Flash burst keeps counting down across the frozen/gameplay boundary; its own
packet-building code can share a frame with whichever *one* of `move_tick`/`wait_tick`/`fade_tick`/
`text_tick` `ui_tick`'s own frozen-world dispatch is running (those four stay mutually exclusive
among themselves). `main_loop` calls `flash_tick` before `settle_owed`/`dispatch_input`/`ui_tick`,
so on a frame where a Flash edge and one of the frozen-world four target the same address, Flash's
packet is queued first and the other second, landing last in that NMI's drain and winning the
screen — an author who needs the opposite has to sequence with an explicit `Wait`. Measured against
real hardware timing via the Mesen Lua layer (`flash_nmi_timing.lua.template`), not jsnes, which
does not enforce this deadline.

**A live switch-bound tile is a third producer.** `flip_tick` (`engine/entities.asm`) ticks
unconditionally from `main_loop`, called *before* `flash_tick` — so on a frame where a flip, a
Flash edge and one of the frozen-world four all land together, the flip's own packets are queued
first, Flash's second, and whichever frozen-world tick is running third. The worst-case bound is
now 81 of `vram_buf`'s 256 bytes, up from 71 with Flash alone.
`test/lua/bound_tile_nmi_timing.lua.template` (built by `test/lua/build_bound_tile_nmi_roms.mjs`,
run by `test/lua/run_bound_tile_nmi_check.sh`) proves this exact three-producer frame against real
Mesen timing, the same "prove the workload, then trust the deadline" shape
`flash_nmi_timing.lua.template` established. **A fourth independent producer must re-open this
accounting again, not assume it still holds.**

`box_close` keeps no copy of what the box covered: the box is tile rows 24-29, which is exactly
metatile rows 12-14 with no half-row left over, so it rebuilds those rows straight out of
`[mtptr]` + `mt_tl/tr/bl/br` and the attributes out of `[atptr]`. Moving the box means keeping
that alignment or keeping a copy. The outer eight pixels are overscan — tile rows 0 and 29 and
columns 0 and 31 — so the frame drawn there is decoration, and nothing the player has to see
(the ▼ page prompt) goes in it.

`engine/combat.asm` and `engine/title.asm` are conditionally *reachable* either way, but only
`title.asm` is always assembled. `COMBAT_ENABLED` and `TITLE_ENABLED` in `config.inc` gate what
runs; `BATTLE_ENABLED` also gates what *assembles* in `combat.asm` (an RPG's action-only health
code has no call site once combat routes through the battle bank, so keeping it assembled would
burn kernel-lo space for dead code) — and `projectUsesHeartArt` (`shared/font.js`), not
`projectUsesCombat`, decides the heart art stamped into sprite tiles `$FE/$FF`: an RPG's monsters
can still carry contact damage (`COMBAT_ENABLED` on, driven by `projectUsesCombat` as before), but
an RPG never draws the hearts that art is for. `init_session` is the single definition of "new
game" — hearts, bag, counters, all 64 switches and all 16 variables — and both boot and the
game-over path go through it. Where a game over *lands* is `restart_game`: the title if there is
one, a new game if there is not.

**`Heal`/`Damage` mean whichever of the engine's two health models the build actually has**,
decided once, at assemble time, by `BATTLE_ENABLED` — never a third model invented for the
command, and never a third model for a *metatile* either. In an action project that is `player_hp`,
through `combat.asm`'s `gain_hearts`/`lose_hearts`; in an RPG it is every recruited member's `pc_hp`
(`$0398+`, plain kernel RAM, no `call_battle` needed to reach it — see "The battle system" below),
through `rpg.asm`'s `party_heal`/`party_damage`. A Damage metatile now agrees with the scripted
command about which model it means: `player_hazard` takes a heart off `player_hp` in an action
project and a party-wide hit through `party_damage` in an RPG, the same `BATTLE_ENABLED` split
`script_op_heal`/`script_op_damage` already made for the authored commands, applied to what a
painted tile does instead of what an event says. Getting there took three traps, all in
`player_hazard`/`update_player`, not just the routing:

- **The RPG side needed its own cooldown**, not the knockback that comes with the action side's.
  `player_iframes` already counts down once a frame in `update_player`, action or RPG alike, so
  `player_hazard`'s `BATTLE_ENABLED` branch reuses it — set on a hit, read at the top of the routine
  — rather than draining every recruited member at close to 60 Hz for as long as the player stands
  on the tile.
- **A lethal hit must stop the frame**, not merely end the game. `check_encounter` runs immediately
  after `player_hazard` in `update_player`, and a wandering encounter reaching its threshold the
  same step would overwrite the `ST_GAMEOVER` a party wipe just set with `ST_BATTLE` — so
  `update_player` reads `game_state` back after `player_hazard` and stops there, the same "the rest
  of this frame belongs to the transition" rule a screen edge or a fresh screen already apply above
  it.
- **A killing hit must `jmp player_died`, not return into it.** `party_damage` and `lose_hearts`
  both only ever saturate and answer whether the hit was lethal; *deciding* the game is over is
  each caller's own `jmp` — a callee that jumped there on a caller's behalf would leave that
  caller's own return address sitting unpopped on the stack for some unrelated `rts` to mis-pop
  later.
- **`player_iframes` is the floor hazard's cooldown, not a general "the player was just hurt" flag,
  and only `player_hazard` may gate on it.** `entity_contact` shared the same read at first — a
  Damage metatile setting `player_iframes` then silently suppressed every contact battle for the
  rest of `IFRAME_TIME`, since `entity_contact`'s check ran before the branch that tells
  `touch_encounter` and `hurt_player` apart, making an RPG's monsters briefly walk-through. Fixed by
  moving the read inside `entity_contact`'s own `.if !BATTLE_ENABLED` block: an RPG encounter has no
  invincible window to respect, only the action side's knockback does. See `rpg.test.js`.

The scripted `Damage` command follows the same `jmp player_died` rule for its own killing hit, and
deliberately does not route through `hurt_player` either: a trap has no attacker for the knockback
and must land regardless of the invincible window a physical hit would still be honouring. `Heal 255`
is a full
heal with no separate "inn" vocabulary, and — the one place the two models genuinely diverge —
revives a fallen RPG party member the way an inn would, where `cast_heal` in battle never has to ask
the question because it only ever heals whoever is already taking their turn. `projectUsesCombat`
(`shared/font.js`) counts a live `Damage` command in an action project the same way it counts a
damage actor or a painted metatile, since an author whose only damage source is this command still
needs the hearts drawn — but not in an RPG, where `Damage` never reaches `player_hp`, and where
nothing about combat reaches the hearts at all: `projectUsesHeartArt` answers false for every RPG
regardless of `projectUsesCombat`, since `draw_hud`/`hurt_player` do not assemble there. Item 5's
own phase 4c added a fourth source: an action-project item whose `effect` is `{kind: 'damage',
amount > 0}` reaches `player_hp` too, through `use_item_apply` (below) — and since every item in
`project.items` compiles unconditionally, `projectUsesCombat` counts it regardless of reachability,
the same policy `projectUsesItems` holds for `ITEMS_ENABLED`. An RPG's own damage-kind items are
excluded the same way its `Damage` command is — they land on party HP through `party_damage`
(`engine/rpg.asm`) instead, needing no heart-HUD reservation.

An internal movement-code dedup's `move_right_inside`/`move_down_inside` (`engine/player.asm`)
deliberately `jmp` to their shared tail on the very next line rather than falling through into it,
even though a fallthrough would reclaim a few more bytes: fallthrough would make physical adjacency
between an entry routine and its tail load-bearing and invisible, so inserting anything between
`move_down_inside` and `move_vertical_probe` would silently break `move_down` with no assembler
error.

**Validate-as-you-draw (ROADMAP item 8)** is five `validateProject` warnings — metasprite density,
reserved-tile reference, per-screen OAM, field density, battle OAM — plus a kernel-lo figure and
reserved-range shading (not checks), each backed by one predicate in `shared/project.js`:
`metaspriteScanlineDensity`, `fieldScanlineRows`/`fieldScanlineDensity` (wraps before clipping at
row 239), `screenSpriteBudget`/`overlaySpriteBudget` (two figures, never combined),
`battleSpriteBudget` (gated on `gameType === 'rpg'` alone, charging every wandering encounter its
full four-monster formation), `spriteReservedRanges`/`reservedRangeRects`, and
`metaspriteKernelBytes` (extracted from `kernelTableBytes`). No ROM byte changed (six-fixture
SHA-256 gate). Two traps worth remembering: a delegation must be proven structural by reading
`generate.js`'s source, not its output; and a game-type gate must be probed on the *other* game
type — `battleSpriteBudget`'s own gate went missing for several review rounds, caught only on an
action build. See `docs/design-draw-validation.md` for the full depth.

### The event system

**What makes an event run is a byte of the entity record**, `EVENT_TRIGGERS` in
`shared/project.js` in wire order, `TRIG_*` in `engine/constants.asm` at the other end. `interact`
is index 0 because it is what every event did before the byte existed, and **a trigger is a choice
rather than a set** — `do_talk` requires `TRIG_INTERACT`, or an entry event could be replayed by
walking up to whatever carried it and pressing the button.

**A placed entity's own record has a second field whose meaning depends on the actor's
behaviour, not just its trigger.** `ent_to_scr` (`engine/constants.asm`) is written unconditionally
for every placement. `entity_door` (`engine/entities.asm`) reads it as a flat-screen target; under
`ITEMS_ENABLED`, `entity_pickup` and the interact-button pickup path in `do_interact`
(`engine/input.asm`) instead read it as the item id a pickup actor's placement grants. Behaviour is
exclusive (never both `door` and `pickup`), so the two meanings never collide, and
`resolveEntityByte(entity, actor, itemsEnabled, itemIdForActor, flatLength)`
(`main/build/generate.js`) is the single place that decides which one a given placement's byte is
— the same question resolves identically for `emitScreens` and for `test/lib/eventdecoder.js`'s
consumer (below). The trap: the door-target clamp inside `resolveEntityByte` must never run for a
pickup actor's byte — an item id above the current screen count would be silently corrupted into a
real, wrong screen number by a clamp meant for the other meaning entirely.

`NO_ACTOR == NO_ITEM == $FF` is what let most of that retarget reach the ROM with **no engine code
change at all**: Give, Take, a monster's drop, and a Carrying condition used to resolve an item id to the
actor byte it backed before compiling it; once the compiler hands over the item id directly, every
sentinel comparison already in the engine — `script_op_give`'s `cmp #NO_ITEM` (renamed from
`NO_ACTOR` for clarity, both `$FF`), `roll_drop`'s identical compare — keeps working unexamined,
since both sentinels were always the same byte. Only the compiler's choice of *which* function
resolves an authored reference changed, never what the engine compares it against.

The same id-space-capping shape `NO_ACTOR`/`NO_ITEM` use closed a second, unrelated collision the
retarget's own icon table (`item_metasprite`) surfaced: before `LIMITS.metasprites` existed, a
metasprite array was genuinely uncapped, so a project could reach a real metasprite 255 —
byte-identical to `NO_METASPRITE`, an item's own "explicitly no icon". `LIMITS.metasprites =
NO_METASPRITE` (`shared/project.js`) closes it the same way `LIMITS.actors`/`LIMITS.items` already
do: the cap *is* the sentinel's own value. An already-over-cap project is refused by
`validateProject` with a named error and left intact rather than silently sliced, the identical
policy the actor and item ceilings hold to.

ROADMAP item 8's modular-parts targets the player, not a Sprite Forge actor:
`PLAYER_FRAMES`/`PLAYER_TILES` (`shared/project.js`) name the player's 32 sprite-table slots.
`playerTiles` is the single canonical source — `generatePlayerSpriteCore`/`planPlayerSprite` write
only there, sharing one decision path: a frame is written whole or not at all, `BLANK_TILE`
staying the literal string, never `null`. The trap is separate: an out-of-range `frameIndex` grew
the array past 32, aliasing another frame. `generateAssets` stamps every tileset's `$00-$1F` from
it every build, into build-time copies only.
`openGeneratePlayerSpriteModal` (`renderer/forges/tile/tile.js`) is the only caller of
`generatePlayerSpriteCore`, using the `openPaletteSwapModal` revision-guard idiom, and
`describePlayerSpritePlan` (`shared/project.js`) writes every string the modal shows, pinned by
`playersprite.test.js`. See `docs/design-modular-parts.md` for the mechanism.

`renumberSpellDeletion` (`shared/project.js`) exists beside `renumberActorDeletion`/
`renumberItemDeletion`, the same shape applied to `project.spells` — the Magic Forge's own delete
handler (`renderer/forges/magic/magic.js`) is its real caller, as of Magic Forge phase 3. The
`Spells…` modal it was written against is gone; `test/unit/project.test.js`'s tests still call the
export directly, the same shape the actor/item siblings' tests use, because the real handler is
renderer code (`confirmModal`, `store`, a toast) a `node:test` process cannot drive — `main/smoke.js`
is what exercises it for real. The `wrongImplementation` closure beside those tests still models the
old modal's own filter-without-shift bug on purpose — a deliberate regression fixture for a handler
that no longer exists, not a stale one — with a sanity assertion that the model really does get the
fixture wrong.

**A fourth sibling, `renumberPartyMemberDeletion(project, index)`, exists for `project.party`**: a
Join's `member` above the deleted index shifts down, the hole becomes `null`. The Character Forge's
own party Remove handler calls it in its one `store.commit`. The normalizer keeps `null` `null`;
`validateProject` refuses a live Join naming `null` or an index ≥ `project.party.length`, via
`liveCommands` not `allCommands`.

**`SAVE_LAYOUT_VERSION` is 3**, bumped 1→2 when `inv_items`' own bytes started meaning an item
id rather than an actor id, then 2→3 when name entry (phase 1) added `pc_name_ram` to the body —
both cases `saveIdentity`'s own derived sizes cannot catch and what the version byte exists for. A
bump is unconditional and engine-wide: *any* save from the prior engine version fails
`save_check_valid`'s very first identity compare, regardless of whether that particular project uses
items or naming. What an author sees is nothing special — the old save is treated exactly like a
foreign or corrupted one, which is to say the title screen simply does not offer Continue. No
message, no crash: the existing "this record does not belong to this build" path doing the job it
already did for every other case.

**Item 7's `saveCompatToken` (`shared/save.js`'s `saveIdentity`, drawn by `drawSaveCompatToken` in
`shared/project.js`) closes a narrower hole the same way, and is deliberately not a second
`SAVE_LAYOUT_VERSION` bump.** A structural edit that reorders, deletes or resizes maps can leave
`screenCount`/`mapCount` — the only order-adjacent facts `saveIdentity` already folds in —
completely unchanged, which would otherwise let `save_check_valid` accept a cartridge record whose
`flat_screen` byte no longer names the room it was saved in. A version bump breaks *every* prior
save unconditionally, the instant it ships, whether or not a given project's screens ever moved;
`saveCompatToken` breaks a save only for a project that actually performed one of the five
qualifying structural edits (reorder, delete map, grow-resize, shrink-resize, growth-routed
duplicate screen — `reorderMapsCore`/`deleteMapCore`/`growOrShrinkMap` are the three call sites,
`growOrShrinkMap` shared by grow, shrink and the growth-routed duplicate). It is a random nonce in
`[1, 0xffff]`, folded into `saveIdentity`'s hash only when nonzero, so a project that never performs
a qualifying edit computes byte-identically to what it did before the field existed.

**An item's own effect is `{kind, amount}`, `kind` one of `none`/`heal`/`damage`.**
`ITEM_EFFECT_KINDS` (`shared/project.js`) is the wire format the same way `BEHAVIORS`/`ACTIONS`
already are: its array order is `EFFECT_NONE`/`EFFECT_HEAL`/`EFFECT_DAMAGE` in
`engine/constants.asm` written down by hand, so a kind's number is spelled in exactly one of those
two places. `none` stays index 0 because it is what every item meant before this field existed, and
`normalizeItem`'s own one-time migration — at normalization, not re-derived on every build — falls
back to it whenever an item's backing actor never had a positive `battle.heal` to derive a `heal`
from. `item_heal` (`main/build/battletables.js`, the RPG battle ITEM menu's own table) now reads
`item.effect.amount` (when `kind` is `heal`, else 0) straight off the item, the migration having
already moved that number onto the item once. The table's existence, size and only reader (`item_chosen`,
`engine/battleturn.asm`) are unchanged — only where each row's number comes from moved.

**`use_item` (`engine/ui.asm`) is the field/menu "spend an item" action, in every game type, and it
is the only place `none` genuinely means *key item*.** It calls `use_item_apply` first, which reads
`item_effect_kind`/`item_effect_amount` and answers one of three states in `A` —
`USE_ITEM_NONE`, `USE_ITEM_ALIVE`, `USE_ITEM_DIED` — since a two-state carry protocol cannot say
"applied, and lethal" without a second flag. A `none`-kind item makes `use_item` skip the
shift/`items_used` step entirely: it is kept, not spent, regardless of `amount` (kind alone
decides). `heal` and `damage` both apply through whichever health model the build has
(`BATTLE_ENABLED`: `party_heal`/`party_damage`; otherwise `gain_hearts`/`lose_hearts`), spent
either way. **`use_item_apply` is reached by `jsr` and must never itself `jmp player_died`** — the
same return-address constraint as a killing hit, but from the callee's side. The chain is
`dispatch_input`'s `dispatch_loop` → `jsr do_action` (`engine/input.asm`) → `do_action_use`'s own
`jmp use_item`, so that first `jsr`'s return address sits live on the stack through `use_item`,
`use_item_apply` and `player_died` alike, unstranded until some later `rts` unwinds the whole
tail-call chain back to `dispatch_loop`. `use_item` may safely `jmp player_died` only because
`use_item` itself was reached by `jmp` and so never had a return address of its own;
`use_item_apply` has one, so it must answer with `rts` rather than add a second return address and
abandon it with a `jmp`. `use_item` `pla`s that three-state result back (a `pha` at the top of the
routine, carrying the decision across the shift and highlight repair, which clobber `A`) before
performing its own `jmp player_died`.

**Neither of the other two starts a conversation itself.** Both arm `pending_ent`, and `main_loop`
is the single place it becomes one. Touch fires from inside `update_entities`, still walking the
other seven slots — starting there would leave the pickups, doors and contact damage below it
acting on a world that has just frozen, and a door on the same square would redraw the screen out
from under the conversation. Enter is armed by `spawn_entities`, inside the redraw that spawned it,
against a screen still being drawn. So both wait for a frame boundary — the rules below are all one
rule seen from different sides: **a frame that draws a screen or decides a warp belongs to that
transition, not to the player.**

- **First claim wins**, for both triggers through one `arm_event`. Two actors cannot each own the
  moment a screen loads, and a touch must not push aside the entry event of the screen it happened
  on. The Map Forge says which actor has the moment, on the ones that do not.
- **`pending_ent` is disarmed before the event runs, not after**, so an event that warps hands the
  moment on to whatever the next screen owes rather than swallowing it.
- **Work owed is settled before `dispatch_input`, not merely before the world**, since the frame
  ends there — it belongs to the transition, not the player. `settle_owed` carries its own
  `paused`/`game_state` gate: buttons are read in every state, but a warp and a pending event are
  gameplay's alone. Before the world, because an event can finish while the box is still up and the
  frame reading `warp_ready` after `update_entities` never runs; before the *buttons*, because an
  interact reaching `start_dialog` leaves an event free to warp, so a press that frame could
  overwrite a warp already owed, or warp away from a screen whose opening was armed and never
  spoken.
- **`dispatch_input` stops once a button has drawn a screen or decided a warp.** It re-reads
  `game_state` for every button, so two pressed together land in different states the moment the
  first changes it: confirm and interact on the same frame begin the game, then talk to whatever it
  spawned — on a screen never seen, and if that conversation warps, the opening goes with it. A is
  read first, which is why this is reachable at all; Start is read last and never could be.
- **`screen_fresh` means a screen has been drawn and the world has not run since**, cleared once
  per frame *before* `dispatch_input` and checked everywhere the world could start on a screen that
  has only just arrived — three ways one can: `dispatch_input` draws one outright (Start, on the
  title); `update_player` crosses an edge, which **does not unwind it** since `cross_*` is reached
  with a `jmp` ending in `redraw_screen`, whose `rts` lands back mid-routine with a different screen
  under the player, so `update_player` stops at the flag twice more (before the second axis of
  movement, and before the hazard and encounter checks); and the input can leave a warp for the next
  frame. Miss one and the new screen charges for its spikes, counts a step towards its wandering
  monsters, or moves the player against its collision before it has said a word.
- **A pending event is checked against `ent_active` before it runs.** With the settle ahead of the
  buttons nothing known can empty that slot in between, so this is a guard rather than a fix: the
  index is remembered across a frame boundary, and a stale one would speak for something that is
  not there without saying so.
- **`ent_touched` is cleared by walking off, not by the event ending.** The conversation ends with
  the player standing exactly where they started it.

Coming back from a battle is not entering a screen: `battle_end` redraws the field it never left,
so it puts down the entry event that redraw just armed — otherwise every fight replays whatever the
screen says on arrival.

`availableTriggers(actor, project)` is the single writer for which triggers are real for a
placement. `touch` is the only one that can be spoken for: walking into a pickup collects it,
walking into a door goes through it, and in an *RPG* walking into anything that deals damage starts
a battle, which freezes the world before the event could run — the same contact in an action game
costs a heart and the event still runs, which is why it asks the project and not only the actor.

**`effectiveTrigger(entity, actor, project)` is what everything then asks**, because an actor is
edited in a different Forge to the one that places it: a placement set to `touch` can find itself
on an actor that has since been given contact damage. The stored choice is deliberately *not*
rewritten — put the damage back and it is still there, since a change to an actor must not destroy
work on a placement — so the select, the hint under it and the compiler all derive the same answer
from it instead, and the Map Forge says out loud when the two differ. Three places deciding this
separately is exactly how the editor comes to show one trigger, the hint describe another and the
ROM run a third.

`engine/script.asm` runs an actor's event: a list of pages, first passing page wins, commands run
straight through until one has to wait for the player. `Say` is such a command, so the box's close
path calls `script_resume`. Plain dialogue compiles into an event of one unconditional page, so
"talking to somebody" has a single path through the engine rather than a special case beside the
scripted one. `IMPLEMENTED_COMMANDS` in `shared/project.js` is what the Map Forge offers; the
schema, `normalizeEntity` and the compiler handle every command in `EVENT_COMMANDS`, so a project
written by a later version round-trips through this one, and an opcode the engine cannot run stops
the event rather than being reinterpreted. `join` is hidden by the event editor unless the project
is a turn-based RPG (`map.js`), because in an action build `OP_JOIN`'s battle bank is not
assembled.

**`Move` is the first command conditionally assembled for a capacity reason rather than a hardware
one.** `Say` waits for the player; `Move` waits for the *world*, which is the thing this engine had
no shape for: `[OP_MOVE, who, DIR_*, distance]` suspends the script exactly as `OP_SAY` does, and
`move_tick` (`engine/entities.asm`) steps the mover one frame at a time out of `ui_tick`, ahead of
whatever state it is running inside, until the distance is paid off and it calls `script_resume`.
`mv_left` is the whole state machine — non-zero *is* "a move is running" — so there is no separate
flag to keep in step with the counter. Three rules hold it together:

- **A move that cannot finish must end, not hang.** Walking into a wall or the screen edge abandons
  the distance still owed and resumes the script, the same answer `script_op_call` gives a call
  stack that has run out, and for the same reason: an author cannot see from the Map Forge that a
  patroller will be standing in the way at the moment the cutscene runs.
- **A distance of zero does not suspend at all.** The only thing that ever resumes a Move is
  `move_tick` watching `mv_left` reach zero, so suspending with it already zero is a wait nothing
  could ever end.
- **The facing is set once, before the first step**, not per step — the "decide once, before
  acting" trap below, and it is what makes a blocked move still turn to look the way it tried to go.

**A command that holds commands is not a special case to be named, it is a `nests: true` entry.**
Three exist — `branch`, `choice` and `route`, the last of which is also `EVENT_COMMANDS`' only
`virtual: true` entry and the array's final one. Array position is the wire opcode for every real,
`OP_*`-backed entry (`opIndex(id)`, `main/build/textcompile.js`); the catalog is a contiguous real
prefix followed by a contiguous virtual tail, pinned by a unit test in `test/unit/project.test.js`,
so a future engine-backed command inserts before the virtual tail and a future virtual one appends
after it. `route` holds one `who` and an ordered list of `move`/`turn`/`wait` legs, admitted by the
single filter `routeLegs`/`ROUTE_LEG_OPS` (`shared/eventrules.js`) shared by every consumer that
decides what a route may hold — `allCommands` is the deliberate exception, walking `command.legs`
raw because it answers "what is mentioned," not "what compiles." `liveCommands` recurses into a
route's admitted legs instead of yielding the route command itself, and `encodeCommand`'s own
`'route'` case writes no opcode of its own, only its legs' bytes — so an authored route and the
same commands hand-chained compile byte-identical, at zero engine cost. See `docs/design-routes.md`
for the full design.

Anything asking a question of a
whole event walks `allCommands` in `shared/eventrules.js` rather than a page's own list, and
anything asking how deep it may go asks `nests`. Both rules are there because the same defect
happened twice: `usedSwitches` in `templates.js` read only the top level, so a switch set inside a
branch was invisible to the free-switch scan and got handed out again — which presents as two
unrelated events firing together, and reads as an engine bug.

**A question is a branch the player takes.** `[OP_CHOICE, count, a string id per option]` and then
one record per option, `[length, commands…, OP_JUMP, what is left of the question]` — the same
`OP_JUMP` a then-branch ends with. The string ids are contiguous and up front because `script_ptr`
**stays on the command** until it is answered: `text_choice_step` draws row *n* from the *n*'th
byte after the count, so nothing has to be remembered but `choice_sel`, and `script_choose` walks
that into a body exactly once — which is what lets a `Say` inside an option suspend and resume
through `script_resume`, which knows nothing about questions. `CHOICE_LIMITS` in
`shared/project.js` is the single writer for what one holds — four options because `BOX_ROWS` is
four, a label as wide as `BOX_COLS` — so the schema, the editor and the compiler's clamp cannot
offer an option the box has no row for. The cursor is `ARROW_TILE` in the padding column
(`BOX_TEXT_LO-1`), inside the frame and outside the text, so moving it cannot disturb a label and
wiping the labels cannot rub it out. `box_after` carries which phase the box was raised for, so
raising the frame and wiping a page stay one implementation each, and `box_handover` is the single
end of both, because **a phase must leave `box_row` at zero for the next one**. Typing counts in
`msg_line`, so for as long as the box only ever typed, `box_row` could be left wherever it had
finished and nothing noticed. Listing options is what actually reads `box_row`, and read the 4 the
wipe left, drawing no labels at all while every RAM assertion still passed — why `script.test.js`
reads the *nametable* for this one.

A page is `[cond, arg, value, body length, commands…]`, and **a branch is that same header inline
in a body**: `[OP_IF, cond, arg, value, then-length]`, the then-branch, `[OP_JUMP, else-length]`,
the else-branch. Past the opcode the shapes are identical, so `script_cond` and the skip that
declines a page are the ones a branch uses too, and nesting costs the engine nothing since nothing
is remembered but where `script_ptr` points — a `Say` can suspend inside a branch with
`script_resume` knowing nothing about it. The `OP_JUMP` pair is emitted even for an empty else, so
both arrivals at the end of a then-branch look the same. The header is a fixed four bytes on every
page even though only the variable comparisons read `value`, because `script_skip` steps over a
declined page without decoding its condition; `EVT_PAGE_HEAD` in `engine/constants.asm` and the
header written by `main/build/textcompile.js` are the two ends of that. The variables themselves
are 16 bytes at `variables` in `constants.asm`, but **how many there are is generated** —
`NUM_VARIABLES` in `config.inc`, from `RPG_LIMITS.variables`, which also clamps a variable index as
it is compiled — the engine range-checks nothing, since the compiler is the only thing that knows
how big the array is.

**`Run common event…` compiles to `[OP_CALL, table slot]`**, the slot a `call`'s target resolved to
in `main/build/textcompile.js`'s own events table — common events compile into it ahead of every
placement's, so a call's one-byte argument is just the position it landed in.
`shared/project.js`'s `liveCommonEvents(project)` is the single definition of which
`project.commonEvents` entries get a slot at all — one with at least one live page, carrying the id
`resolveCommonEventIds` gives it — consumed by both the compiler's slot assignment and
`validateProject`'s own "does this call's target still resolve" check, rather than two
implementations of the same admission rule that could disagree.

A `call` naming nothing live — deleted since, never live to begin with, or never given a target —
still compiles to `[OP_CALL, NO_COMMON_EVENT_SLOT]` rather than being dropped: `script_op_call`
(`engine/script.asm`) reads the operand and, finding the sentinel, stops the event exactly as
`script_run_bad` stops one on an opcode it does not recognise, and exactly as
`script_op_give`/`script_op_take` already do on `NO_ACTOR` — a recognised command whose operand
names nothing is that family's shape of bug. Dropping the command silently instead would let the
page carry on to whatever the author wrote to run *after* the call, having silently not run the
thing the call was there for. `validateProject` also refuses a build over a *live* `call` like
that, the same way it refuses a missing Give/Take actor or an empty battle formation — defense in
depth for a hand-edited project or one written by a later version.

**Exceeding `CALL_STACK_DEPTH` is a different failure from `NO_COMMON_EVENT_SLOT` and gets a different
answer.** The callee there is perfectly real — there is just nowhere left on the small fixed
`call_ret_lo/hi` stack (`CALL_STACK_DEPTH` in `engine/constants.asm`) to remember the way back — so
`script_op_call` skips the call and runs the next command, on purpose: two common events are free to
call each other, and a cycle between them is only visible once both bodies exist, so past the bound
a call has to unwind rather than hang the game on an author-invisible cycle. The two checks do not
share a branch: `script_op_call` tests the operand against `NO_COMMON_EVENT_SLOT` first and stops
there before the depth is even read, so a fix to one cannot quietly change the other's behaviour.

The 64 switches and the 16 variables are the only state that outlives a screen change, which is
what makes "this happened already" expressible. `switch_test` / `switch_set` / `switch_clear`
**preserve X and Y**,
and `switch_split` builds its mask by shifting rather than indexing a table for exactly that
reason: `spawn_entities` calls `switch_test` with the entity slot in X and the record cursor in Y,
and reloading Y after the test would set the flags from the reload rather than from the switch.

### The starter library

`shared/library/` ships CC0-1.0 content (terrain, monster, pickup, sfx, song) in one flat
`LIBRARY_ENTRIES` (`shared/library/index.js`). `planLibraryImport` is pure; `applyPlannedProject =
Object.assign` is the one apply, called inside one `store.commit` with no `await` between plan and
apply, so a refused plan never reaches `commit`. `suggestedPaletteSlot` is the single writer for
both the picker's suggestion and the headless default — the two can never disagree. A reserved
palette slot is always selectable; only writing fresh colours is refused. The Forges must pass
`options.tilesetId`, else a core defaults to tileset 0. `renderer/widgets/librarypicker.js` is the
one picker shared by all three Forges. See `docs/design-starter-library.md`.

### Starter projects

`STARTERS` in `shared/starters/index.js` is the single writer for which starters exist; the picker
(`chooseStarter`, `renderer/app.js`) renders one button per entry and `project:create` takes
`starterId`, resolved before `fs.mkdir` so an unknown id creates nothing. The two blank entries are
pinned byte-identical to `createProject`.

Every content starter is `planLibraryImport` in a fixed order, then the shared player figure and
Doorway from `shared/starters/figures.js`, then hand-authored content; tile indices are probed at
build time, never assumed, because a starter pointing at the player's reserved tiles trips a
`validateProject` warning. `writePlayerFigure` returns 24 explicit `null`s, never `BLANK_TILE`
strings, or the placeholder is never substituted.

The `hideSwitch`-at-spawn trap, as a one-sentence rule: a one-shot interact page needs a switch
guard and a fallback page, `hideSwitch` alone repeats until the screen reloads.

`acorn` is an exact-pinned, test-only devDependency, imported by `test/lib/sourcescan.js` and
`test/unit/project.test.js`, never by anything under `main/`, `renderer/` or `shared/`.

See `docs/design-starter-projects.md`.

### The kernel budget

Move's mechanism is described under "The event system" above. Its cost is measured, not guessed,
because hand-written code that assembles to an unknown size is exactly what the Code Forge's own
capacity philosophy (below, under "The Code Forge") refuses to model — the kernel-lo bank is a
fixed 8,192-byte region shared by engine code and every project's own lookup tables, and
`checkCapacity` (`main/build/generate.js`) has to know both halves exactly. Six rules hold that
model together, and they are the ones any change to this ledger has to keep:

- **A conditional feature's cost is a separate generated allowance, never folded into a base.**
  `kernelCodeBytes` charges Move, Turn, Wait, Save, Sting, Sfx, switch-bound tiles, Fade/Flash and
  the MMC3-only font-bank split as their own named `*_KERNEL_ALLOWANCE` terms, gated on the
  predicate that turns the feature on (`projectUsesMove`, `projectUsesSave`, …) — a project that
  never uses a feature assembles byte-for-byte as if it did not exist, asserted by `move.test.js`,
  `codebuild.test.js` and their neighbours comparing whole ROMs.
- **A term that varies by mapper is measured per mapper**, in a `*_BY_MAPPER` table
  (`BASE_KERNEL_CODE_BYTES_BY_MAPPER`, `TITLE_KERNEL_ALLOWANCE_BY_MAPPER`,
  `SAVE_KERNEL_ALLOWANCE_BY_MAPPER`), not charged to every board at whichever figure is largest.
  Base and title fall back to the largest measured figure for an unmeasured mapper (`??
  FALLBACK_...`), confirmed to leave real margin by `kernelbytes.test.js`. **Save has no
  fallback** — it indexes `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]` directly, deliberately: a
  newly implemented save medium with no measured entry must fail loudly rather than silently
  inherit another board's figure. The converse matters as much: **a term stays flat until real
  variance is measured**, which is why Save's own RPG supplement is a bare
  `SAVE_BATTLE_KERNEL_ALLOWANCE` and not a fourth table — the same standard
  `TITLE_KERNEL_ALLOWANCE_BY_MAPPER` met in the opposite direction, its MMC3 entry earning
  per-mapper shape on a measured 12-byte difference.
- **A term measured against one game type and charged to both is wrong for the one it was not
  measured on, and no delta-based test can see it.** `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` and
  `BASE_KERNEL_CODE_BYTES_BY_MAPPER` both overcharged action projects this way until each was split
  into its action-side per-mapper base plus an RPG-only supplement — `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER`
  for the base, and the flat `SAVE_BATTLE_KERNEL_ALLOWANCE` for Save
  (`docs/kernel-base-overcharge-report.md`); `SPLIT_KERNEL_ALLOWANCE` had the same blind spot
  without the game-type mismatch, measured only as a residual rather than its own delta
  (`docs/split-lock-not-pinned-report.md` §8). All three escaped detection for the same reason:
  every absolute `assertCovers` check ran against `sample-rpg` only, and every action-side check was
  a *delta* between two action builds, cancelling the base term out. A new allowance needs at least
  one absolute check on each game type — and each condition — it can be charged to.
- **Individual allowance deltas are equality-asserted against nesasm's real usage, per board, not
  margin-checked.** `kernelbytes.test.js` measures each named constant's own isolated delta with
  `assert.equal`, not `<=` — a margin check would let a stale, too-generous figure sit undetected
  until a project actually needed the bytes it silently claimed. The *combined* reservation is
  checked differently: `assertCovers` requires the real margin to sit between `KERNEL_SLACK` and
  `KERNEL_SLACK * 2` — under it, the reservation has fallen behind the engine; over it, the term
  has stopped tracking closely enough to catch the next regression. (`bankedbytes.test.js` holds
  the same discipline for the separate banked battle-region ledger, not these kernel-lo
  allowances.)
- **`kernelShortfallAdvice` (`main/build/generate.js`) prices a removal by disabling every live
  occurrence of a command — nested inside a branch, a choice option, or a common event — and asking
  what the resulting project's full kernel-lo occupancy (`kernelCodeBytes + fixedBytes +
  tableBytes`) would be (`projectWithoutCommands`), never by summing the flat allowance
  constants.** Summing under-counts: on MMC3, a project whose only live event is a Move (or a
  Sting) is that project's only reason `SPLIT_KERNEL_ALLOWANCE` is paid at all, so removing it has
  to free the term *and* the split term together, which only the counterfactual-occupancy approach
  knows.
- **A mapper offered as a fix must still hold every tileset, every screen and the project's
  mirroring choice** — a smaller kernel-lo reservation alone is not a valid suggestion if
  `reconcileCartridge` would silently truncate one of those the moment the author switched.

Current allowance figures (`main/build/generate.js` unless noted; each named code allowance is a
delta `kernelbytes.test.js` measures exactly, on every board named — the base, the derived table
sizes, the route zero-cost proof and `KERNEL_SLACK` itself are each checked their own way, below):

- `BASE_KERNEL_CODE_BYTES_BY_MAPPER = { 1 (MMC1): 6022, 4 (MMC3): 6039, 30 (UNROM 512): 6217 }` —
  action-side, nothing conditional on, falling back to the largest of the three for an unmeasured
  mapper (`docs/kernel-base-overcharge-report.md`). `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 253,
  4: 265, 30: 253 }` is its RPG-only supplement — no fallback, deliberately, the same reason Save's
  table has none; MMC3's extra 12 bytes are `split_select`'s second `.if BATTLE_ENABLED` arm
  (`engine/split.asm`). Its gate, `battleEnabledFor` (`codeRegions(...).length > 0`), does not
  imply `rpgCapable(mapper)`, so `battleKernelAllowance(mapper)` THROWS on a missing entry rather
  than `undefined`-then-`NaN`; `checkCapacity` pre-checks the project's own mapper and reports a
  named problem, and `switchableMappers` filters out any candidate that would hit the throw.
- `TITLE_KERNEL_ALLOWANCE_BY_MAPPER = { 30: 212, 1: 212, 4: 224 }`, charged whenever a project has
  a title screen — MMC3's extra 12 bytes are its own `.if TITLE_ENABLED` branch in `split_select`.
  A live `Save` command pays this term even with `titleMap` currently unset, because
  `validateProject` requires a title wherever Save is live.
- `SAVE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 514, 4: 519, 30: 686 }` plus flat
  `SAVE_BATTLE_KERNEL_ALLOWANCE = 41` — two terms: the table is the action-side base every
  save-capable board pays (UNROM 512 costs more — flash-rewrite, not battery-WRAM); the flat
  RPG-only supplement is `save_check_valid`'s own `.if BATTLE_ENABLED` range-check block plus
  `BE_RESTORE`'s call site, summing to RPG totals `{1: 555, 4: 560, 30: 727}`, flat because the gap
  measures identical on all three boards. Its gate is NOT `gameType === 'rpg'`: `kernelCodeBytes`
  recomputes `codeRegions(...).length > 0`, the real predicate `BATTLE_ENABLED` is emitted from,
  strictly narrower on a CHR-RAM board whose tileset payloads have claimed every switchable region.
- `MOVE_KERNEL_ALLOWANCE = 379` plus `FACE_KERNEL_ALLOWANCE = 16` (the facing routine Move and
  `Turn` share, charged once) — 395 total for a Move-only project.
- `SPLIT_KERNEL_ALLOWANCE = 165`, MMC3-only, charged whenever `projectUsesText` is true on that
  board — including a project whose only live event is a Move or a Sting, not just dialogue.
  Pinned by a text-on/off isolation on a fresh action project plus a zero-delta control on every
  non-`scanlineIrq` board, not an old residual guess — `docs/split-lock-not-pinned-report.md` §8.
- `ITEM_KERNEL_ALLOWANCE = 16` (flat) plus 3 `kernelTableBytes` bytes *per item*
  (`item_metasprite`, `item_effect_kind`, `item_effect_amount`, one byte each in
  `assets/items.inc`); `ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE = { action: 63, rpg: 60 }` for
  `use_item_apply`.
- `STING_KERNEL_ALLOWANCE_STANDALONE = 172` (+12: `sting_snapshot`/`restore` now also shadow
  `mus_inst_base`) plus the shared `AUDIO_FX_KERNEL_ALLOWANCE = 15` (paid by either);
  `SFX_KERNEL_ALLOWANCE_STANDALONE = 295`; `STING_SFX_INTERACTION_ALLOWANCE = 5` more when both
  live. Aggregate: Sting-only 187, Sfx-only 310, both live 487.
- `BOUND_TILE_KERNEL_ALLOWANCE = 388`, plus a 30-byte fixed table (`bound_row_lo`/`bound_row_hi`)
  and 2 `kernelTableBytes` bytes per screen (`screen_bound_lo`/`hi`) — the first allowance whose
  removal `kernelShortfallAdvice` has to price by full kernel-lo occupancy (code and table
  together), the rule above.
- `TURN_KERNEL_ALLOWANCE = 35` composes with `FACE_KERNEL_ALLOWANCE` above (Move+Turn cost
  379+35+16=430, facing routine charged once); `WAIT_KERNEL_ALLOWANCE = 48` shares no other code
  with Turn (35+16+48=99 for Turn+Wait, no Move). `SHAKE_KERNEL_ALLOWANCE = 65` and
  `VISIBLE_KERNEL_ALLOWANCE = 49` (Show/Hide) are each flat, with no dependent term.
- `FADE_KERNEL_ALLOWANCE = 146` and `FLASH_KERNEL_ALLOWANCE = 98` name each routine's own cost;
  both share `PALETTE_FX_KERNEL_ALLOWANCE = 55` (`fade_apply_palette` plus the NMI PPUADDR fix,
  charged once whether Fade or Flash or both are live) — 201 total for Fade-only, the unchanged
  shipped figure from before the two were split apart.
- A `route` (`docs/design-routes.md`) compiles to the identical bytes as hand-chaining
  the same `move`/`turn`/`wait` commands — zero additional kernel cost, proven by
  `test/unit/routes.test.js`'s byte-identical-ROM comparison and confirmed with a cross-tree
  SHA-256 gate.
- `KERNEL_SLACK = 20` — the floor `assertCovers` (`kernelbytes.test.js`) holds every measured
  margin to (`margin >= KERNEL_SLACK`): a correctly measured base should leave *exactly* this once
  every conditional term is counted. It also enforces a ceiling at `KERNEL_SLACK * 2` — a drift
  alarm, not spare headroom: too wide a margin means some term stopped tracking the engine closely.

**Documented limitations** — combinations `checkCapacity` refuses today, each backed by its own
named test in `kernelbytes.test.js` rather than a silent gap; the figures below are current, as the
tests measure them:

- MMC3, `Save` + `Move` + one live item: 90 bytes short (fits on MMC1 with 121 free).
- UNROM 512, `Save` + `Move`, no item: 167 bytes short — unrelated to items; dropping one does not
  close this the way it closes MMC3's.
- MMC3, `Save` + `Move`, no item: 11 bytes short alone. A live `Sting` deepens it to 198 short,
  closed by `Move` (395) or `Save` (560). A live bound tile deepens it to 431 short instead, where
  `Move` (395) alone is 36 short — only `Save` (560) closes it.
- The same bound tile (marginal cost `388 + 30 + 2 × screen count` = 420 bytes, this ledger's
  largest single feature cost) also reopens MMC1's `Save` + `Move` + one live item row, to 299
  short (was 121 free).
- A live `Sfx` command adds five more refusal rows: MMC1 Save+Move+item (189 short); MMC1
  Save+Move-no-item (110 short); MMC3 ALL-7-verbs+Move+item-no-Save (112 short); UNROM 512
  Save-only-with-item (161 short); UNROM 512 ALL-7-verbs+Move+item-no-Save (113 short); and it
  reopens MMC1's Save+Move+item row a second way, to 366 short (Sting live).
- Two fits controls confirm the boundary is real: `sample-rpg`'s one live item plus a live Sfx
  alone still builds on MMC3 (the tightest board), and the seven item-6 commands plus that item
  with Sting *and* Sfx both live still builds on MMC3 too — no Save/Move/title live on that row.

`kernelShortfallAdvice` names a real, buildable fix for every refusal above (which live command(s)
to drop, or occasionally a different mapper) — a refusal here is `checkCapacity` doing its job on a
bank that is, by design, allowed to run out, not a bug in the mechanism.

### The Code Forge

The user's own 6502, in `project.code`: `overrides` are edited copies of engine files, `files` are
new sources. It lives in the project — not beside it — so undo, the dirty dot and saving are the
ones every other Forge already uses, and a per-project override cannot leak into another project.
On disk it is raw `.asm` under `code/engine/` and `code/user/`, two folders rather than one so
which kind a file is never depends on the engine's current file list.

Three rules hold it together:

- **The engine folder is the single writer of what a stock file is.** `engineFileNames()` in
  `generate.js` is that list; `checkCapacity` uses it to refuse a user file that would collide
  with an engine name, and to *warn* rather than fail on an override naming a file this version
  does not ship — a project saved by a later version still has to build.
- **Overrides are copied in at their own name and their own line numbers.** The generator writes
  the stock engine in first and the overrides over the top, so nesasm's `file:line` refers to
  exactly what the editor shows, and the Build panel's error line can open it. `build/` is
  `rm -rf`'d every build, so editing files *there* is not a feature — it is data loss.
- **`assets/usercode.inc` is always emitted**, empty or not, and `engine/main.asm` includes it
  unconditionally in the kernel-lo bank. A project with no code of its own therefore assembles
  byte-for-byte identically to one built before the Forge existed, which `codebuild.test.js`
  asserts directly. $C000 is permanently mapped on every supported mapper, so a user label is
  callable from anywhere with no banking to think about.

Hand-written code is **deliberately outside `checkCapacity`'s byte math**: how much a source file
assembles to cannot be known from its text, and a guess would either refuse a project that fits
or promise room the assembler then denies. The assembler is the capacity check, which is why
`parseNesasmErrors` in `nesasm.js` matters — nesasm v3.1 reports errors across three lines
(`#[2] file`, then `line bank:addr source`, then the message) and **exits 0 anyway**. A message
shape it fails to recognise reads as a successful build until the ROM that was never written
fails to rename, so it also falls back on nesasm's own `# N error(s)` count. `build:run` is the
one IPC channel that does not flatten its error through `fail()`, because the `{file, line}` array
is what the deep-link needs.

**nesasm v3.1 also crashes outright on a long label**, an undocumented limit found while building
the SFX feature: a label of 31 or more characters aborts the assembler with a glibc
`_FORTIFY_SOURCE` buffer-overflow error (exit 134) rather than a normal error line; 30 characters
assembles cleanly (`docs/sfx-implementation-report.md` §2). Unlike the "6502 traps" list below,
this has no regression test — recorded here as a known assembler limit to keep new labels under,
not a claim this codebase actively guards against.

The editor (`renderer/forges/code/`) is hand-rolled — no runtime dependencies and no bundler rule
out Monaco and CodeMirror, not the CSP; CodeMirror 6 needs no `unsafe-eval` at all. `highlight.js`
is a pure per-line tokenizer (nesasm has no multi-line construct), and its one invariant — joining
the tokens reproduces the line — is asserted over every line of the engine. Two metric rules in
`editor.js`: the gutter, the highlight layer and the textarea must agree on every font and spacing
value or the caret drifts off its character, and for an editable file `gotoLine` sets the selection
*before* the scroll, since focusing a textarea scrolls it on the browser's terms and discards
anything set first — a read-only generated file's `gotoLine` only scrolls. Typing commits to the
store on a pause rather than per keystroke (an unusable undo stack) or on blur (a commit that may
never come), so `saveProject` in `app.js` calls the mount contract's optional
`flushPendingEdits()` first.

- Stock label stability: an internal movement-code dedup removed
  `move_left_done`/`move_right_done`/`move_up_done`/`move_down_done` as standalone labels, but they
  survive as zero-byte aliases on `move_horizontal_done`/`move_vertical_done` — a Code Forge user
  file that references any of the four by name still assembles.

### The battle system

An RPG's battle system lives in a **switchable PRG bank**, not the fixed kernel — the kernel had
about 2 KB spare and the battle system is over 3 KB of code plus its tables. `codeRegions()` in
`shared/cartridge.js` takes one 8 KB region off the front of the switchable window (after
`chrPayloadRegions()`, so the two claims on that window cannot collide), and `screenRegions()`
skips it. That is why **an RPG needs a mapper with PRG *and* CHR switching** — `rpgCapable()` is
the single writer for that, consulted by the schema, the Build panel and `reconcileCartridge`.

**`call_battle` in `engine/banks.asm` is the only cross-bank call in this codebase, and the only
one there may be.** `player.asm` dereferences `mtptr` out of the switchable window every single
frame, so the trampoline ends with `jmp set_screen_ptr` — the restore *is* the return; forgetting
it leaves the game reading its map out of the battle system's code, with no crash and no obvious
banking bug. `banked.test.js` asserts the restore. The trampoline has four entry points
(`BE_INIT`, `BE_TICK`, `BE_JOIN`, `BE_RESTORE`), and `BE_JOIN` is the one used *on the field*: the
script's Join command recruits a party member mid-conversation, so the restore matters most there
— the frame it ran in still has a map to draw. `BE_RESTORE` runs at load time (`engine/save.asm`),
recomputing `pc_spells` from the restored level rather than trusting the save's own possibly-stale
bitmask. Unlike `BE_JOIN`, this restore is masked by its caller: `continue_game` ends `jmp
redraw_screen`, re-running `set_screen_ptr` regardless of whether the trampoline exit succeeded.

**`BE_JOIN`'s operand is guarded**, matching `party_init`'s own twin guard on the same access:
`battle_entry_join` (`engine/battle.asm`) does `cpx #PARTY_SIZE` / `bcs battle_entry_join_skip` —
`rts` back to `call_battle`. `NO_MEMBER = $FF` is defined once per side, beside `NO_ACTOR`/
`NO_ITEM`; the compiler emits it for `null` since `byte(null, 3)` coerces `null` to member 0. One
compare refuses both the sentinel and a stale index; `rpg.test.js` patches a built ROM's operand to
`$FF` and to exactly `PARTY_SIZE`, with a seeded `pc_hp_max` byte catching a mis-branch into
`party_restore`.

The split is: `engine/rpg.asm` in the kernel (the RNG, the step counter, assembling a formation),
everything else in `engine/battle.asm` + `battleui.asm` + `battleturn.asm` on the far side.
Calling *out* of the bank is free — the kernel is permanently mapped — so the battle system uses
`vram_open`/`vram_push`, `draw_metasprite` and `add_item` directly.

**That region has a capacity check, and unlike the kernel's it is exact.** Nothing bounded it
until `battleRegionBytes`/`battleRegionCeiling` (`main/build/battletables.js`) — overflowing it
used to surface as raw nesasm output attributed to whatever line fell past the end, which this
codebase's own convention refuses to show a user. The budget lives beside the tables it sizes
rather than beside `kernelCodeBytes`: `generate.js` reaches for `node:fs`, so the renderer cannot
import it, and the Build panel's meter would need a second copy of the arithmetic — the drift the
check exists to prevent, one layer out. `battletables.js` imports only from `shared/` and must stay
that way; `renderer/forges/build/build.js` importing it is the same move
`renderer/forges/sound/sound.js` already makes with `main/build/songcompile.js`.

`BASE_BATTLE_CODE_BYTES_BY_MAPPER` is per board (UNROM 512 4220, MMC1 4220, MMC3 4266), measured
directly rather than reconstructed from a running fix history — the same mistake
`BASE_KERNEL_CODE_BYTES_BY_MAPPER` had to undo. `battle_status_dispatch`'s `combatant_alive` guard
and `bt_wipe_mask`'s staggered-death queueing (see that array's own comment in
`engine/constants.asm`) are folded into this figure. MMC3's extra 46 bytes are the `.if
SPLIT_ENABLED` blocks inside the region itself (`battle.asm`'s split arm, `battleui.asm`'s sprite
targeting cursor), and need **no** separate conditional term the way `SPLIT_KERNEL_ALLOWANCE` does:
this region exists only for an RPG, so there is no MMC3-RPG-without-the-split to overcharge. Every
board that can reach the region has its own measured entry, because `codeRegions()` hands back
nothing unless the project is an RPG and needs `rpgCapable()`; the fallback in
`baseBattleCodeBytes` stands in for no real board and exists only so an unmeasured one cannot make
the budget `NaN` and silently stop the refusal firing. `test/unit/bankedbytes.test.js` asserts it is
unreachable.

**A different board can help here, which is the opposite of how it first reads.** The ceiling never
moves — every RPG-capable board gives this region the same 8 KB — but the stock code inside it does,
and MMC3 spends 46 more bytes of it. So an MMC3 project over by 1 to 46 bytes fits unchanged on MMC1
or UNROM 512, and a flat "changing mapper does not help" is false advice in exactly the band where
advice matters. `battleShortfallAdvice` *computes* the claim and only makes it when no candidate
fits.

Which boards are candidates is `switchableMappers` (`main/build/generate.js`), extracted from
`kernelShortfallAdvice` so both answers to "would a different mapper fix this?" share one place.
**It asks the authorities rather than restating their rules** — a hand-written filter chain would
have to independently track art in the tilesets' `$A0-$FF` (only a scanline-IRQ board leaves that
range to the author), sprite tile `$FD` (a split-font board reserves it for the battle targeting
cursor, so *entering* MMC3 can break a project too), and a monster's battle-art block running past
`$A0` (an error off MMC3 even when the tileset's own upper slots are empty) — the sign of a rule
that should not be a list. So there are two questions instead: does `reconcileCartridge` change the
project (if so, the switch silently costs a tileset or a mirroring choice, invisible to every other
check), and would the result still build — `validateProject` for every content rule at once, plus
the three capacity questions it does not own: screens, kernel-lo and the banked code region. Errors
are compared before against after, not merely counted, so a candidate is never rejected for an
error it merely inherited, unrelated to the switch.

**No board is offered at all to a project carrying hand-written 6502.** Two of the three fit
checks read models of stock code — `kernelCodeBytes` measures the stock kernel, `battleRegionBytes`
the stock battle system — and a Code Forge override replaces one of those files, while even a
plain user file lands in kernel-lo through `assets/usercode.inc`. A candidate could therefore save
enough *modelled* bytes to pass while the real code still overflows, the same guess this codebase
refuses to make about user code anywhere else, aimed at the mapper select instead of a byte count.
Withholding degrades gracefully — the feature- and content-removal advice stays true either way —
and closes the same overclaim `kernelShortfallAdvice` had first.

The exactness is worth keeping, with one qualification. `kernelCodeBytes` must over-estimate — it
shares its bank with lookup tables it models by hand — but this region has two occupants, and
`battleTableBytes` counts the second off `battleTables`' own emitted output rather than modelling
it, so that half cannot drift. The other half, the stock engine code, is a
hand-measured constant like any other: **exact today, held there by the equality assertion in
`bankedbytes.test.js` rather than by construction.** Across five table-varying variants on all
three boards, `base + battleTableBytes` equals nesasm's reported usage **to the byte**, why the
test asserts equality rather than a margin band, and why `BATTLE_SLACK` is buffer against
stock-code growth rather than headroom for an estimate to be wrong in.

**`battleTables(project, battleStrings = BATTLE_STRINGS)` and `battleTableBytes(project,
battleStrings = BATTLE_STRINGS)` both must accept the injected list, and `battleTableBytes` must
forward it into `battleTables`** (`main/build/battletables.js:608`) rather than calling it with the
default — the defect round 2 of the name-stride review found: a version where `battleTableBytes`
still called `battleTables(project)` with the default let an injected list's real emission and the
counter naming its size disagree, exactly what this region's exactness discipline exists to
prevent. The
default path is byte-identical to before either parameter existed. See `docs/namestride-report.md`
for `checkBattleStringsCapacity`, the generator guard this parameter lets be exercised through
`battleTables`' own call site (`test/unit/bankedbytes.test.js`).

**Exact for the *stock* battle code, and that qualifier is load-bearing.** A Code Forge override
of `battle.asm` — or of `battleui.asm`/`battleturn.asm`, which it includes — is hand-written 6502
whose assembled size cannot be known from its text, so the base term becomes a measurement of a
file no longer being assembled. `battleCodeOverridden` is the single predicate for that. The rule
about hand-written code cuts **both** ways: a guess would either refuse a project that fits or
promise room the assembler then denies. So an override project is not refused on the stock base at
all — that would turn away someone's *smaller* battle system for the engine's larger one — it is
checked against the one bound an override cannot move, the generated tables alone; past that the
assembler answers, with the `.fail` below as the backstop. The advice changes with it: a reduction
that would close an exact deficit is only "the least that could fit" when the base is unknown, and
no board can be said to fit either.

**Overriding `main.asm` is a weaker guarantee again**, its own predicate
`battleRegionPlacementOverridden` / `BATTLE_REGION_PLACEMENT_SOURCES`: a custom `main.asm` can put
the tables `battle.asm`'s override leaves in place somewhere else entirely, or nowhere, so **no
capacity refusal is raised at all** in that case — the meter still shows the stock-based figure,
under a hint saying which number it is.

**The `.fail` in the generated `assets/code.inc` bounds where an override of `battle.asm` ends up,
not whether nesasm accepted it, and cannot close every escape even together with
`checkCapacity`'s own text-scan warning (`battleRegionRelocates`).** nesasm's per-byte bank check
already catches an override that is simply too big; the `.fail` exists for what that check cannot
see — an override that *relocates* with its own `.bank`/`.org` and finishes outside the region,
which nesasm accepts with exit 0 while battle code is silently written over screen data or the
kernel. `battleRegionRelocates` is a text scan for anything shaped like such a relocation, not a
size guess, so it can both miss one reached through `.include`/a macro and flag one that is not
real. See `docs/design-battle-region-guard.md` for the empirical proof that two specific
relocations get past both mechanisms together, and for why the guard is emitted into the generated
file rather than `engine/main.asm`.

**When 8 KB genuinely runs out — a note, not something to do now.**
`codeRegions(mapper, tilesetCount, bankedCode)` already takes a `bankedCode` count and hands back
two adjacent regions for `bankedCode = 2`. Regions alternate `{prgBank, org:$8000}`,
`{prgBank, org:$A000}`, so the two are **co-mapped** — both live at once, one 16 KB switch — only
when the slice starts on an even index. That index is `chrPayloadRegions().length`: 0 on the CHR-ROM
boards, but `max(1, tilesetCount)` on UNROM 512, so on that board co-mapping holds only when
`max(1, tilesetCount)` is even. Note the `max`, which is what makes a zero-tileset project *not*
co-map despite zero being even. Checked rather than reasoned: UNROM 512 co-maps at tileset counts 2
and 4, and not at 0, 1 or 3; MMC1 and MMC3 always co-map. Anything relying on this must check, not
assume.

Not everything the battle bank writes needs the bank switched in to *read*: `pc_hp`, `pc_hp_max`
and `pc_in_party` (`$0398+`) are plain kernel RAM like any other engine array, so `rpg.asm`'s
`party_heal`/`party_damage` — the field's `Heal`/`Damage` commands, on an RPG build — touch them
directly rather than growing `call_battle` a fourth entry point for what is, on this side, only a
saturating loop over four bytes.

Three shapes worth keeping:

- **Combatants are one index space**: 0-3 party, 4-7 monsters. `turn_order`, targeting, the cursor
  and "is this one still standing" are each one routine rather than two that have to agree — and
  it is what lets a monster cast the same spells the party does: `cast_spell`, `cast_heal` and
  `cast_all` all take either side, with `other_side` deciding who a group spell reaches.
- **The `combatant_*` lookups preserve X and Y and return through `bt_ret`**, because they are
  called from loops that own those registers — and restoring a register sets the flags, so the
  answer has to be reloaded last.
- **Status effects are independent bits, ticked by the message flow.** `pc_status`/`mon_slot_status`
  carry them — `STATUS_POISON`/`STATUS_BURN` (`engine/constants.asm`), set by `ora` rather than a
  plain store, so casting one never erases the other. `battle_message_done` dispatches the tick:
  once the actor's own line is dismissed, `status_pending` walks every set bit lowest-first, one
  tick and one line per bit, before the turn advances. No status survives past the battle that gave
  it — `battle_begin`/`battle_end` (`engine/rpg.asm`) zero the array on entry and on a normal exit
  (won included); a loss skips `battle_end` (`battle_finish` jumps straight to `player_died`), so
  that clear lives in `init_session` (`engine/combat.asm`) instead, enforced at every exit rather
  than documented at one. A heal or a potion cures everything at once, mid-battle. See
  `docs/design-status-effects.md` for the dispatch mechanism and what a third status would need.
- **A spell's amount is a range, not a fixed number**: `amountMin`/`amountMax` in the schema,
  `spell_amount_min`/`spell_amount_n`/`spell_amount_limit` (`main/build/battletables.js`) in ROM,
  rolled by `roll_spell_amount` + `mod8` (`engine/battleturn.asm`) — a draw rejected at or above
  `spell_amount_limit,x` keeps the accepted range uniform rather than masked-and-biased.
  `spell_amount_n,x == 1` is byte-for-byte the old flat `spell_amount,x` read and draws nothing
  from the RNG, letting a project migrated from the old schema replay its battles identically. Both
  routines run inside `cast_all`'s own per-target loop, so `bt_tmp2` — that loop's own end-of-side
  sentinel — must survive untouched across the whole `spell_damage` → `roll_spell_amount` → `mod8`
  chain; the regression guard is an RNG-state assertion in `test/unit/rpg.test.js`'s `'an
  all-target spell rolls independently per target -- two living monsters take different damage from
  one cast'`, narrower than it looks: it catches a stray extra `bt_tmp2` write that a pure
  damage-number check would miss.

Anything the engine would need a multiply for is a table instead: `main/build/battletables.js`
precomputes per-level stats and the experience curve, and pads every name to `RPG_LIMITS.nameLength`
so the engine needs no length byte.

**The RPG battle ITEM menu does not list everything `use_item` can spend.** `build_item_list`
(`engine/battleui.asm`) filters the bag to `kind == heal AND amount > 0` — exactly what
`item_chosen` can apply consistently — so a `damage`-kind item, or a `heal`-kind item at `Amount`
0, is a real, valid item for Give/Take/Carrying/drops but never a selectable row here.
`battle_menu_item` gates on the *filtered* list length, not raw `inv_count`, building the list
first so the gate sees the real count: deciding from `inv_count` alone would open onto an empty
list whose row-select code indexes a stale entry and whose Up press underflows the selection to
`$FF`. `build_spell_list` needs no such ordering — a spell's own membership test (`pc_spells`, a
bitmask) already is what building the list applies, so gating before building can never disagree
with it; items introduce a second, independent filter `inv_count` knows nothing about. The
`ITEMS_ENABLED`-false path keeps both routines exactly as they were, byte-for-byte, since that
economy has no `effect` field to filter on.

**Two capacity terms follow the item's own kind/amount reader into their respective banks, both
item-conditional and both flat across boards** (see "The kernel budget" above for why a term earns
its own name only once real variance is measured). `ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE`
(`main/build/generate.js`) is `use_item_apply`'s own kernel-lo cost, split by *game type* rather
than by board — because `BATTLE_ENABLED` picks a genuinely differently-sized damage branch
(`party_damage` vs `lose_hearts`), not because any board differs: 63 bytes for an action project,
60 for an RPG. `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` (17 bytes, `main/build/battletables.js`) is
`build_item_list`'s and `battle_menu_item`'s combined cost in the banked battle-code region,
uniform across all three RPG-capable boards since neither routine branches on `SPLIT_ENABLED` — its
own line beside the base rather than folded into it, avoiding the mistake
`TITLE_KERNEL_ALLOWANCE_BY_MAPPER` already had to undo on the kernel side, charging every project a
cost only `ITEMS_ENABLED` builds actually pay.

### The emulator

`renderer/emulator/core/` is a vendored jsnes. **Read `renderer/emulator/core/FORGE-PATCHES.md`
before touching or upgrading it** — it lists the deliberate divergences from upstream. Run control
(stepping, breakpoints, watchpoints) is layered *outside* the core in `runcontrol.js` to keep the
vendored code close to upstream; `Emulator.stepInstruction()` mirrors the body of `nes.frame()`
and must be updated in step with it. `Emulator.reset()` goes through the core's own `reloadROM()`
rather than `nes.reset()` for the mirror image of that reason: `nes.reset()` builds a *new* PPU and
mapper, and hand-reimplementing only part of what `loadROM` does after its own reset can leave
state like the nametables unallocated, throwing from inside the PPU on the first background write
after a reset.

**The run loop paces itself by wall-clock time, never one-frame-per-rAF.** `requestAnimationFrame`
fires at the display's refresh rate; on a 120 Hz monitor a frame-per-callback loop runs the game at
2× and produces audio twice as fast as the sound card drains it, which fills the worklet's ring
buffer and then garbles everything after (this shipped, and presented as "the music sounds garbled
towards the end"). `tick()` in `player.js` owes frames to elapsed time at 60.0988 fps, and the
worklet reports its buffer depth back so `AudioOut.driftRatio()` can trim the pace ±2% to hold a
~93 ms cushion — that feedback, not the ring buffer's size, is what absorbs the residual clock skew
between `performance.now()` and the audio hardware.

**Capture is read-only of what was already drawn, and the encoder never runs inside the
emulator.** 📷 Shot is `canvas.toBlob` on the player's own canvas; ⏺ Record drives
`renderer/emulator/capture.js` (the recorder's policy: keep the frame on screen at Record, then
every third one, a pending queue bounded at 8, a 300-frame cap) over `renderer/emulator/gif.js`
(the GIF format itself — always a full 256-entry global colour table with LZW minimum code size
8, one independent LZW stream per frame, bounding-box diffs with disposal 1 and no transparent
index, nearest-colour substitution once the table fills). Neither belongs in `shared/`: both are
DOM- and Node-free and `node:test` imports them directly, but nothing outside the renderer has to
agree with them. Two rules hold the recorder together. `onFrame` **copies and queues, nothing
more** — it runs inside `emulator.runFrame()`, which `tick()` can call four times in one animation
callback and `stepOut()` far more, so encoding there would be unbounded work in the run loop, and
an exception there would be caught by `tick()` and displayed as `Crashed:`, a recorder bug wearing
an emulator crash's clothes; `drainCapture()` encodes afterwards inside its own try/catch. The copy
is not defensive style: jsnes hands `onFrame` its **one reused PPU buffer**, whose pre-render
lookahead writes row 0 before the next frame, so a stored reference turns into a frame correct on
the canvas but wrong in the file. `stepAnd`'s own `writeFrame` is excluded from sampling by a flag,
or the Frame button records a duplicate and an instruction step records a partial frame. **And the GIF's real test is Chromium's,
not ours.** `test/lib/gifdecode.js` decodes what `gif.js` produced and the unit tests assert
pixel-identity, except in the one case that cannot be exact — a frame carrying more colours than
the table holds, where the nearest-colour substitution is asserted against an independently
computed expectation instead. But both files were written together, so a matched-pair error in
their shared LZW code-width rule can pass every round trip of ours while producing a file nothing
else accepts — only the smoke test, which decodes the same bytes with the platform's own
`ImageDecoder`, has ever caught one. Any change to `gif.js` has to keep that check, and a new
format written the same way should get one like it.

**Item 7's `test/lib/eventdecoder.js` is a comparable test-only layer for a different wire format.**
It walks the actual bytes `encodeCommand`/`encodeEvent` (`main/build/textcompile.js`) produce,
opcode by opcode: `decodeCommand` handles `branch`, `choice`, `warp` and `say` explicitly (each has
its own compiled shape a generic width can't express), gives `sting`/`sfx`/`battle` their real
exceptional widths, and falls back to `EVENT_COMMANDS[opcode].args.length` for every other
command — schema-driven for that remainder, not independent of `EVENT_COMMANDS.args`. An
exhaustive corpus in `test/unit/project.test.js` exercises every real `encodeCommand` case against
it. It resolves a warp's raw screen operand to a real screen *object* (the same shape
`flatScreens` returns), so two builds compare by object identity rather than by an index a
reorder/duplicate/delete/resize would change. Like `gif.js`/`gifdecode.js` above, it lives beside
the tests that use it — never exported from `main/build/`, never imported by it — so a change to
the wire format has to keep this decoder in step, not the other way around.

## Testing

Three independent layers, all of which should pass before calling a change done:

1. `npm test` — pure unit tests plus integration tests that boot the built ROM headlessly under
   `node` and assert on engine RAM (addresses come from `engine/constants.asm`).
2. `npm run smoke` — launches the real window and drives it: creates a project, edits, undoes,
   saves and reloads, visits every Forge, builds, runs the ROM, fires a breakpoint, single-steps.
   Fails on any renderer console error.
3. The Mesen Lua runner — a second, independent emulator, so it and the built-in core cross-check
   each other.

**Tests must not mutate `sample/`.** It is a checked-in fixture; `main/smoke.js` copies it to a
temp directory precisely because an earlier version saved edits back into it and left the two
suites fighting over the ROM. If a test seems flaky, suspect shared state before adding retries.

## 6502 traps this codebase has already hit

Each of these cost real debugging time and now has a regression test. They are easy to reintroduce.

- **A routine returning a value must set the flags from that value.** `cmp` used for a range check
  leaves `Z` describing the comparison, not the accumulator. `probe_solid` returning after
  `cmp #3` made every movement read as blocked.
- **Branches are ±128 bytes.** Long dispatch chains need `jmp`; `music.asm` failed to assemble
  until two branches were inverted into jumps.
- **`tya`/`txa` clobber A inside a loop** that relied on a value loaded before it. The
  sprite-parking loop wrote each sprite's own offset instead of `$FF`, leaving 59 stray sprites.
- **Deciding a state inside several branches lets the last one win.** Setting a chaser's facing in
  both the horizontal and vertical movement branches meant vertical always overwrote horizontal,
  so the sideways animation was unreachable. Decide once, before acting.
- **Apply before advancing an envelope/animation step**, or the first entry is never used.
- **A helper called from a loop must hand back the registers the loop owns.** `combatant_alive`
  clobbering X made `battle_round` skip half the party — and the fix has a trap of its own, because
  `ldx`/`ldy` set the flags, so a routine that answers with the Z flag has to reload A *after*
  restoring them.
- **A guard copied from another routine may not mean the same thing.** `draw_entities` reads
  `oam_idx == 0` as "the shadow filled up"; `battle_draw_sprites` starts at zero, so the same test
  meant "nothing drawn" and silently skipped parking, leaving the field's HUD on the battle screen.
- **A `$2006` write moves the screen.** Its high byte lands in the PPU's `t` register,
  nametable-select bits and all, so any mid-frame VRAM write must be followed by a `$2000` rewrite
  as well as the `$2005` pair. Writing only `$2005` leaves the picture scrolled to a nametable
  nothing was drawn into, which presents as the screen going blank the first time a box opens.
- **What holds for registers holds for scratch bytes.** `draw_list` kept its row counter in
  `bt_tmp2` while `name_offset_pc` — called for every named row — hands its answer back *in*
  `bt_tmp2` and counts it down to zero. One list entry hid it (blank rows never touch the byte);
  two hung the whole game in the redraw loop, untested because no test ever opened a list with two
  entries. Fixed with a byte nothing downstream owns (`bt_vrow`). `bt_tmp2` is load-bearing a
  second time for the identical reason: it is `cast_all`'s own end-of-side sentinel for its whole
  `spell_damage`/`roll_spell_amount`/`mod8` call chain, so a new routine reaching for scratch space
  in that chain has exactly one byte it may not pick.
- **A backward `.org` silently splices bytes into whatever already assembled there.** nesasm
  places a bank's contents at file offset `address & (bank size - 1)`, with no check that the
  address is actually inside the bank currently being assembled — an address *behind* the bank's
  own base (`.org $0600` inside a `$C000`-based kernel bank) still produces a valid, in-range
  offset, so nesasm silently overwrites whatever code already landed there, exit code 0 regardless.
  Proved empirically before `engine/flash.asm` was written, which is why that file's own driver is
  position-independent (assembled at an ordinary address, copied to its real address at runtime)
  rather than ever reserving a fixed low address via `.org`. See `flash.asm`'s own header comment
  for the relocation rules that requires.
- **An 8-bit multiply used as a table offset silently wraps.** `name_offset_pc`
  (`engine/battle.asm`) computed `index * NAME_LEN` in a single accumulator with the carry
  discarded, so index 26 landed four bytes into entry 0 instead of entry 26's own name —
  `table,y` addressed the offset correctly, only `y` itself was wrong. Fixed by adding the product
  into a 16-bit `ptr_lo`/`ptr_hi` and reading `[ptr_lo],y` instead. Regression tests
  (`test/unit/rpg.test.js`) read the nametable rather than engine RAM for a high-index monster and
  item, each paired with a low-index control that also forces the carry (`assertForcesCarry`), so a
  fixture that stopped needing the carry could not go silently vacuous.

## Conventions

- Generated output (`build/`, `sample/build/`) is never hand-edited; change the generator or the
  authored source instead.
- When the UI offers something the engine does not implement, label it as such in the UI rather
  than letting it look functional. No such case remains; the
  surviving form of the same idea is narrower — an action bound in a state it means nothing in
  (confirm while walking around) is labelled "ignored here" rather than silently doing nothing.
- Capacity limits are enforced in the generator with messages naming the Forge responsible, so
  users never see raw assembler output.
- Re-render a node with `fill(node, ...)` from `renderer/ui.js`, never `clear(node).append(...)`.
  `el()` skips nulls and flattens arrays; the DOM's `append` stringifies both, so a conditional
  child renders as the word "null" and a list of rows as "[object HTMLDivElement]" — which reads
  as bad data rather than the wrong append, and cost the Map Forge its whole placed-actor list
  (remove buttons included) until it was noticed in a screenshot. Bare `clear()` is still right
  for the clear-then-append-in-a-loop cases.
- `showModal` (`renderer/ui.js`) resolves `null` for Escape, a backdrop click, a bare `close()`,
  and an action with `value: undefined` — a caller can't tell "dismissed" from a chosen `null`
  through the promise alone. A caller needing that brings its own sentinel: `editEvent`
  (`renderer/forges/map/events.js`) resolves Clear event and an emptied-draft Save through a
  private `CLEAR_EVENT` Symbol, folded by `resolveEventEditorResult` (pinned by
  `events.test.js`).
