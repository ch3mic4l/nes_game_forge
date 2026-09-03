# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Electron app for building NES games through a UI (seven "Forges": Tile, Sprite, Items, Magic (RPG
projects only), Map, Sound, Controller — plus the Code Forge, the escape hatch for hand-written
6502), which compiles a
project into a real `.nes` ROM with `nesasm` and plays it in a built-in emulator with a debugger. See `README.md` for the user-facing description and the
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

There are **five fixtures, deliberately**. `sample/` is the action-adventure one every engine test is
written against; `sample-rpg/` is the turn-based one `rpg.test.js` drives; `sample-mmc1/`,
`sample-mmc3/` and `sample-u512/` are small save-check fixtures, one per save-capable board, that exist
to cover a board rather than to demonstrate a game. They are separate projects, not variants of the
other two, because `sample/` and `sample-rpg/` are mapper-agnostic by design — nothing about what they
exercise depends on which board they happen to be built for — so pinning any of them to a specific
mapper to reach it would narrow a fixture every other engine test already depends on, for the sake of a
concern (a specific board's own save behaviour) that only the Mesen save checks have. Those checks —
`test/lua/run_sram_check.sh` and `test/lua/run_flash_check.sh`, driving `save_sram.lua` and
`save_flash.lua` — are what these three exist to feed, and are the only things that consume them. No
test may mutate any of the five — variants go to `mkdtemp` directories — and no existing test is
repointed at any of the new ones: every engine test stays written against `sample/`.

`sample-mmc1/` and `sample-mmc3/` are **the same walk on two boards**: same 2x1 world, same saver at the
same coordinates running the same page, differing only in mapper and in the `Say` the MMC3 one opens
with (that board is the scanline-IRQ one, and a message box is what puts the font split to work during
real gameplay rather than only on the title). So the only thing that can make one pass and the other
fail is the board's own register behaviour, which is the entire point of having two. `sample-u512/` is
the same walk again, on a third board, mapper swapped and no opening `Say` (see
`tools/make-u512-sample.js`'s own header for why not) — but it exists for a genuinely different reason
than the first two: MMC1 and MMC3 differ only in *register encoding* for the same battery-WRAM medium,
while UNROM 512 differs in the *save medium itself* — it has no battery-backed WRAM at all, and saves by
reflashing its own PRG-ROM (`engine/flash.asm`) instead. `run_sram_check.sh` and `run_flash_check.sh`
are consequently not one check with two runners; they exercise different engine code (`engine/save.asm`'s
battery path vs its flash path) against different Mesen models (WRAM enable/write-protect gating vs a
JEDEC flash state machine) and, for `run_flash_check.sh`, a form of persistence
(`Core/NES/Mappers/Homebrew/FlashSST39SF040.h`'s own write-through, saved as an `.ips` patch keyed off
the ROM's basename) that the SRAM check has no equivalent of at all.

All three save-check fixtures' saver pages are guarded on the switch they set — `Save` records where the
player is standing, which for a `touch` trigger is on top of the actor that fired it, so Continue
restores the player mid-contact and `spawn_entities` arms the trigger again during the load's own
redraw. Without the guard the page re-runs a frame later and hands out a second gem, which is the
engine behaving as specified but makes the restored bag impossible to assert exactly: a load that came
back empty and a load that came back
correctly both read as "something in the bag" once the re-run has refilled it.

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

The renderer already refuses a second, reentrant call to its own `build()` from the same Build Forge
mount (a plain `building` boolean, checked before it ever dispatches) — but that only protects one
mount against itself, and resets the moment a fresh mount replaces it, which is exactly the case a
genuinely concurrent build needs protecting against. `main/build/buildgate.js`'s `createBuildGate()`
is what actually closes that: it allows exactly one in-flight **`build:run` IPC call** per project
directory (canonicalized with `realpathSync`, so a symlink and its target count as the same one),
refusing a second request outright rather than queuing it. Queuing would not mean re-reading the
project when the queued request's turn finally came — `build()` (`renderer/forges/build/build.js`)
clones the project *before* dispatching, and `ipcRenderer.invoke` serializes that clone again on the
way over, so a queued request already carries a fixed snapshot from the moment it was made. The risk
is the opposite one: the longer that snapshot sits waiting its turn, the more likely it no longer
matches what the user is actually looking at by the time it finally builds, silently reintroducing
the staleness a scenario resolves against (below) one layer further out. This has to live in the
main process rather than the renderer: the renderer is exactly what gets destroyed if the user
navigates away mid-build, so a per-mount flag there cannot stop a second, concurrent caller from
racing `generate.js`'s own `fs.rm(buildDir)` the way a main-process gate on the IPC channel can. It
only covers that one channel, though: unit and Lua tests import `buildProject`
(`main/build/pipeline.js`) directly, bypassing both this gate and `main/build/cli.js` entirely, and
`npm run smoke` is the only thing that actually goes through `build:run` and is covered by it. There
is no CI configuration in this repository — `main/build/cli.js`'s own bypass, regenerating the
checked-in fixtures' ROMs by hand, is the same one described above.

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
  replayer's. If you change one implementation, change all three or that test fails. `songByte`,
  `NO_SONG`, `songTimeline` and `songFrameLength` (a song's own length in frames, one full pass
  through its authored order) live here too, not in `main/build/textcompile.js`, because
  `shared/project.js`'s `validateProject` needs the identical resolution and cannot import
  upward from `main/build/` — `textcompile.js` re-exports `NO_SONG`/`songByte` verbatim so its
  existing importers (`main/build/generate.js`, `test/unit/script.test.js`) keep working
  unmodified. The `Sting` scripted command (item 6) is not a fourth implementation of the format:
  it plays an existing song through the same unmodified driver, pausing and resuming whichever
  song was already playing — see `docs/design-sting.md` for the full design and
  `engine/music.asm`'s own `sting_snapshot`/`sting_restore`/`sting_tick` comments for the
  mechanisms. The `Sfx` scripted command (item 6's last verb) is a genuinely separate, smaller
  format beside the music one, not a variant of it, with its own single-writer contract:
  `shared/audio.js` owns it (`NO_SFX`, `SFX_MAX_STEPS`, `sfxByte`, `normalizeSfx`,
  `sfxFrameLength`), and it is implemented three times the same way the music format is — the
  6502 driver's `sfx_*` routines in `engine/music.asm`, `compileSfx`/`sfxTables` in
  `main/build/songcompile.js`, and `SfxReplayer` in `renderer/forges/sound/replayer.js` — held
  byte-identical by `test/unit/sfx.test.js`'s own golden trace, 25 tests covering the ROM's APU
  writes diffed against the replayer frame-by-frame, all four channel groups, the cleanup frame,
  and `$4015` write interception. See `docs/design-sfx.md` for the full design.
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
  itself, which is `renderer/app.js`'s own `playScenario`/`rememberPlayScenario` (the record shape
  `{startAt, battleTest, toggles}` and its merge semantics), and not which toggles exist, which is
  `shared/testoverrides.js`'s `TOGGLE_NAMES`. `describePlayScenario` turns Map Forge's raw numeric
  choice (a flat screen index, actor ids) into a name/position description at the moment a scenario
  is picked ("the map named World, screen 5", "the actors named Slime, Bat");
  `resolveStartAt`/`resolveFormation` turn a remembered description back into a live target later,
  against whatever project is actually in hand then — an unnamed screen has no name to resolve by
  and falls back to its remembered position within its map instead, unaffected by whether that
  screen is later given one; renaming the map, a *named* screen, or the actor actually being
  tracked, though, makes resolution refuse rather than follow it. Only a *different* one renamed
  onto the old name is what "follows the name" describes. Never keep the raw indices
  themselves across that gap and re-use them directly — a screen or an actor's numeric position is
  not its identity (`createScreen()`'s own comment says so for screens; `sprites.actors` renumbers
  every later actor on a delete for the identical reason, and item 7's map/screen reorder,
  duplicate and delete operations are a second, larger family of renumbering behind the identical
  fact). This subsystem needed no reorder-awareness of its own to survive that family: `mapsNamed`
  and `screensNamed` (`shared/playscenario.js`) resolve by current name at call time, and an unnamed
  screen resolves by its position within its *own* map's `screens` array — a value item 7's map
  reorder never touches, since reordering `project.maps` moves a map's slot in that outer array, not
  a screen's slot within its own map — so name-resolution already treated "the map or screen moved"
  as an ordinary edit it was built to survive, before item 7 ever existed. So anything that
  round-trips through a cached index instead of this file's own name-based lookup will silently
  point at different content the moment the project is edited in between.
- Rewriting every stored flat-screen reference after a map/screen structural edit →
  `remapScreenReferences(project, translate)` in `shared/project.js` (item 7, "Map organization and
  reuse"). It is the single place that knows *which fields* hold a flat screen reference; it does
  not know how any operation computes its own permutation, which each caller supplies as `translate`.
  See the fuller passage below, near `renderer/store.js`.
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
  Two rules keep the observer from chasing itself — it watches the *border* box (a scrollbar
  changes the content box, and the redraw changes the scrollbar), and it calls the redraw
  synchronously from the callback rather than deferring it a frame (deferring would only trade
  "ResizeObserver loop completed" — which the smoke test counts as a renderer error — for a redraw
  that never arrives in a window whose frames are being throttled). The smoke test resizes the real
  window and asserts the map screen grew, because a hardcoded zoom looks perfectly correct at
  whatever size it was written for.
- **A Forge selection must check it is still the current one after its own `await`.**
  `selectForge(id)` (`renderer/app.js`) is called unawaited from `store.subscribe`'s `'open'`
  handler, so two selections can be in flight at once and the *earlier* one can finish last. A
  module-level `selectionToken` counter is bumped once by every call that gets past its own guards
  (an open project, a known and available id) and re-checked after `await entry.load()` and again in
  the `catch`; a call that finds itself superseded returns before it mounts anything or sets the
  status bar. It has still torn the stage down: the token is taken *before* `mounted` is destroyed
  and `dom.stage` cleared, so a superseded call has already run that teardown by the time it learns
  it lost. That is safe only because the winner took its own token later, tears down again, and
  mounts after both. Missing the token check looks like a screenshot or harness
  artefact rather than a bug: the second Forge mounts, then the first one's late import mounts over
  it, leaving two `.forge` elements in `#stage` — which is exactly what `main/smoke.js`'s own
  same-tick selection race step asserts against.

Each Forge is a module exporting `mount(container, app)` and returning
`{ destroy?, onProjectChange? }`; `renderer/app.js`'s `FORGES` array is the single writer for which
Forges exist and lazily imports them — the Items Forge (`renderer/forges/items/items.js`, item 5's
own place to author an item's name, effect and backing Pickup actor) is one of these, not a special
case. `app.forgeIds` is that registry's own derived getter (`FORGES.filter(...).map((f) => f.id)`),
not a second writer of its own — it exists so `main/smoke.js`'s "visit every Forge" step can read
`FORGES` without a hand-maintained list of its own agreeing with it by hand, which is exactly the
kind of drift that let the Items Forge almost ship unvisited by that very test. The Magic Forge
(`renderer/forges/magic/magic.js`, item 13's own spell catalog — turn-based RPG projects only) is
`FORGES`' first entry to carry a `gameTypes` field; every other entry is unconditional, so the field
is additive. `isForgeAvailable(entry, project)` is the single predicate for whether an entry applies
to the open project, read by exactly three call sites — `renderRail()`, the `app.forgeIds` getter
(which is why "visit every Forge" stays correct on an action project without special-casing Magic
itself), and `selectForge`, which has to guard itself a second way: `activeForgeId` is a bare
module-level variable that outlives a project close, so a stale `'magic'` can reach `selectForge` on
a path the rail never rendered a button for, and it falls back to `'tile'`. `main/smoke.js`'s own
negative case for this reads the rendered `.rail-item` titles rather than `forgeIds` — the wrong
implementation it exists to catch is a `renderRail()` that filters differently from the getter,
which would offer a real, clickable button into a Forge `forgeIds` already excludes.
`renderer/store.js` is the single project state:
`commit()` for a discrete edit, `beginStroke()`/`touch()`/`endStroke()` so a drag is one undo entry.
Undo is whole-project `structuredClone` snapshots.

**Map organization and reuse (ROADMAP item 7) is what makes a store commit that restructures the
map list safe.** `remapScreenReferences(project,
translate)` in `shared/project.js` is the one new primitive: the single place that knows *which
fields* hold a flat screen reference — every placed entity's `props.toScreen`, and every `warp`
command's `screen` operand, reached through `allCommands` so a warp nested inside a branch or a
choice option is not missed (the identical defect `usedSwitches` once had against a switch set
inside a branch). It does not know how any operation computes its own permutation — the caller
supplies `translate`, and `translate` must be **total** over every raw stored value it can
encounter: there is deliberately no third "leave it alone" answer, because a reference the function
does not resolve is a reference it is wrong about, not one safe to skip. It mutates `project` in
place and returns `{ project, droppedTargets }` for the callers that need to report what got
redirected. `canonicalizeFlat(value, flatLengthBefore)` resolves a raw stored operand against the
flat count as it stood *before* the edit, so a stale out-of-range operand keeps the target the
compiler already gave it rather than being re-clamped onto whatever the edit just appended.
`titleMap`/`titleScreen` and `startMap`/`startScreen` are deliberately **not** handled by
`remapScreenReferences` — they are map-space, not flat-space, and how they move depends on which
operation is running, so each operation (reorder's direct map-space lookup, delete/resize's own
per-map fixup) fixes them itself.

**One body, not two.** Every operation — `reorderMapsCore`, `addMapCore`, `duplicateMapCore`,
`deleteMapCore`, `growOrShrinkMap`, `duplicateScreenViaGrowthCore`,
`duplicateScreenIntoNewMapCore`, `pasteRegionCore` — is a commit-free core in `shared/project.js`
that both the renderer's one `store.commit` and the unit tests call directly, alongside translate
builders (`buildReorderTranslate`, `buildAppendCanonicalizeTranslate`, `buildDeleteMapTranslate`,
`buildResizeTranslate`, `buildPerMapTranslate`, `buildCloneTranslate`) and the audit helper
`auditDroppedReferences`. `renderer/forges/map/map.js` wraps each core in exactly one
`store.commit()`, so restructuring the map list and repairing every reference it holds is one undo
entry, never two.

A same-count reorder is the case `screenCount`/`mapCount` cannot see: it leaves both untouched, so a
cartridge save would still pass `saveIdentity`'s checks (`shared/save.js`, below) while its own
`flat_screen` byte named a different room. `saveCompatToken`, drawn by `drawSaveCompatToken` and
folded into `saveIdentity` only when nonzero, closes that gap — see the `SAVE_LAYOUT_VERSION`
passage below for how it differs from a layout-version bump.

Mechanism depth — the map-space fixups, the duplicated-map/screen self/external target split
(`rewriteClonedRange` for a duplicated map or a screen promoted into a new map, `buildCloneTranslate`
for a growth-routed screen clone; region copy/paste has no such split at all — `pasteRegionCore`
copies metatiles, bound tiles and already-positioned entities verbatim, calling neither), `map.folder`,
the world overview this design deliberately sliced out — is `docs/design-maporg.md`, not
here.

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
`chr_ram_init` streams each into a pattern page at boot, so on that board tilesets consume screen
capacity. Its single register carries the PRG bank in bits 0-4 and the CHR page in bits 5-6, so
neither can be set without the other — `mapper_shadow` holds the last value written and both switch
routines rewrite the whole byte. And because iNES cannot declare CHR-RAM, `applyHeaderPatch()` in
`pipeline.js` rewrites the 16-byte header to NES 2.0 after assembly. `headerPatch()` returns `{}` for
every mapper that needs neither that nor a plain byte-6 bit set — battery on a project that never
saves, four-screen on a board without the nametable RAM for it — so "nesasm writes a correct header
with no post-processing" still holds for them. Battery-backed save (below) is the other bit-set case:
iNES byte 6 bit 1, applied the same way four-screen's bit 3 already was, in preference to dragging
MMC1 and MMC3 into the NES 2.0 path UNROM 512 alone needs for a size neither board's ordinary 8 KB of
WRAM requires declaring precisely.

**A slot ring for flash save was designed, costed and deliberately left out — the same shape as AxROM
and MMC5 above, a real design worked out and rejected on a real budget rather than never
considered.** UNROM 512's flash commit (below) is not power-loss atomic: it erases the whole 4 KB
sector before writing anything, so a save interrupted mid-commit can leave neither the old record nor
a valid new one. Two designs were costed against the real remaining kernel-lo headroom on
`sample-rpg` with a live Save: a single-sector append-only ring, which is still not atomic at
rollover, and a two-sector A/B journal that genuinely is, using the adjacent 4 KB sector
`chrPayloadRegions()`/`screenRegions()` already reserves but leaves unused — but even the journal
would push the already-refused `sample-rpg` + Save + Move combination further out of reach. Neither
was built; see `docs/design-flash-slot-ring.md` for both designs, their exact costs, and why the
journal — not the ring — is where to start if atomic flash saving becomes a real requirement, since
the sector it needs is already sitting there reserved for exactly it.

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
  pairs at all. `switch_prg_bank` does not get that guarantee for free: `call_battle`
  (`engine/banks.asm`) calls it with rendering on and the picture live, every tick of a battle, so
  it carries its own critical section — `php`/`sei` mask the scanline IRQ (restoring the caller's
  interrupt state exactly, since this also runs during boot, before boot's own `cli`), and
  `split_lock`, a flag `split_arm` checks before touching R1, stands in for masking NMI, which
  `sei` cannot do. A stray NMI there costs at most one frame of the wrong CHR bank on the split,
  never a half-selected PRG or CHR register.
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

**Flash is the first producer allowed to write `vram_buf` outside `ui_tick`'s own priority
chain, which makes "one producer per frame" a bound of two, not one, and it has to be counted
rather than assumed.** `flash_tick` (`engine/entities.asm`) ticks unconditionally from
`main_loop`, alongside `music_tick`, specifically so a non-suspending Flash burst keeps
counting down across the frozen/gameplay boundary the way Shake's own countdown already does —
but unlike Shake (a pure PPUSCROLL trick with no producer at all), Flash's own packet-building
code runs on the mainline and can share a frame with whichever *one* of `move_tick`/`wait_tick`/
`fade_tick`/`text_tick` `ui_tick`'s own frozen-world dispatch is running that frame (those four
remain mutually exclusive among themselves, unchanged). The bound is therefore at most two
packets per frame, not one: `2 * (3-byte header + 32-byte body) + 1` shared terminator = 71 of
`vram_buf`'s 256 bytes, and roughly 1670-1740 cycles of full NMI time in the worst case (two
32-byte packets, the OAM DMA, both register save/restore and the PPUADDR fix) against the
~2273-cycle vblank window — measured against real hardware timing via the Mesen Lua layer, not
jsnes, which does not enforce this deadline the way a deliberately slow drain would need to be
caught. Ordering matters and is deterministic, not incidental: `main_loop` calls `flash_tick`
before `settle_owed`/`dispatch_input`/`ui_tick`, so on a frame where both a Flash edge and one
of the frozen-world four target the same address (Flash and a coincident Fade step, both
`$3F00`), Flash's packet is queued first and Fade's second, so Fade's write lands last in that
NMI's drain and is what the screen shows — an author who needs the opposite has to sequence
with an explicit `Wait`. A third independent producer must re-open both the byte-count and
cycle-budget arithmetic above, not assume either bound still holds.

**A live switch-bound tile is that third producer, and the prediction above is what it cashes
in.** `flip_tick` (`engine/entities.asm`) ticks unconditionally from `main_loop`, exactly the way
`flash_tick` already does, and `main_loop` calls it *before* `flash_tick` — so on a frame where a
flip, a Flash edge and one of the frozen-world four all land together, the flip's own packets are
queued first, Flash's second, and whichever of `move_tick`/`wait_tick`/`fade_tick`/`text_tick` is
running third. A flip's own packet pair is small — `flip_emit_packet` writes the bound cell's top
row (`mt_tl`/`mt_tr`) and bottom row (`mt_bl`/`mt_br`) as two separate `vram_open`/`vram_push`/
`vram_end` calls, each a 3-byte header plus a 2-byte body — so the worst case is now
`2 * (3 + 2) + 2 * (3 + 32) + 1` shared terminator = 81 bytes including the terminator, up from
71, of `vram_buf`'s 256 bytes. The cycle bound is not re-derived here by hand — nesasm's own instruction timing for two more small
packets is a few dozen cycles at most against a ~2273-cycle vblank window that already had slack
to spare at 71/256 bytes — but it is not assumed either:
`test/lua/bound_tile_nmi_timing.lua.template` (built and run by
`test/lua/build_bound_tile_nmi_roms.mjs`, driven by `test/lua/run_bound_tile_nmi_check.sh`) proves
this exact three-producer frame — a flip queued via a real, already-cached switch toggle, re-armed
at the instant `flip_tick`'s own drain reads it so it lands on the identical frame as a Flash edge
and the message box's own raise row — against real Mesen timing, the same "prove the workload,
then trust the deadline" two-phase shape `flash_nmi_timing.lua.template` already established. A
fourth independent producer must re-open this accounting again, not assume it still holds.

`box_close` keeps no copy of what the box covered: the box is tile rows 24-29, which is exactly
metatile rows 12-14 with no half-row left over, so it rebuilds those rows straight out of
`[mtptr]` + `mt_tl/tr/bl/br` and the attributes out of `[atptr]`. Moving the box means keeping
that alignment or keeping a copy. The outer eight pixels are overscan — tile rows 0 and 29 and
columns 0 and 31 — so the frame drawn there is decoration, and nothing the player has to see
(the ▼ page prompt) goes in it.

`engine/combat.asm` and `engine/title.asm` are conditionally *reachable* either way, but only
`title.asm` is still always assembled. `COMBAT_ENABLED` and `TITLE_ENABLED` in `config.inc` gate what
runs; `BATTLE_ENABLED` now also gates what *assembles* in `combat.asm` — the same conditional-
allowance discipline the kernel-lo capacity ledger below applies to every optional feature (an
RPG's action-only health code has no call site once combat routes through the battle bank, so
keeping it assembled would burn kernel-lo space for dead code) — and `projectUsesHeartArt`
(`shared/font.js`), not
`projectUsesCombat`, for what decides the heart art stamped into sprite tiles `$FE/$FF`: an RPG's
monsters can still carry contact damage (`COMBAT_ENABLED` on, driven by `projectUsesCombat` as
before), but an RPG never draws the hearts that art is for. `init_session` is the single definition
of "new game" — hearts, bag, counters, all 64 switches and all 16 variables — and both boot and the
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
  after `player_hazard` in `update_player`, and a wandering encounter reaching its threshold on the
  very same step would overwrite the `ST_GAMEOVER` a party wipe just set with `ST_BATTLE` — so
  `update_player` reads `game_state` back after `player_hazard` and stops there, the same "the rest
  of this frame belongs to the transition" rule a screen edge or a fresh screen already apply above
  it.
- **A killing hit must `jmp player_died`, not return into it.** `party_damage` and `lose_hearts` both
  only ever saturate and answer whether the hit was lethal; *deciding* the game is over is each
  caller's own `jmp`, for the same reason `lose_hearts`' own header already explains a few lines
  below and `script_op_call`'s `NO_COMMON_EVENT_SLOT` stop needed too — a callee that jumped there on
  a caller's behalf would leave that caller's own return address sitting unpopped on the stack for
  some unrelated `rts` to mis-pop later.
- **`player_iframes` is the floor hazard's cooldown, not a general "the player was just hurt" flag,
  and only `player_hazard` may gate on it.** `entity_contact` (below) shared the same read at first —
  a Damage metatile setting `player_iframes` then silently suppressed every contact battle for the
  rest of `IFRAME_TIME`, since `entity_contact`'s check ran before the branch that tells
  `touch_encounter` and `hurt_player` apart, so an RPG's monsters became briefly walk-through. Fixed
  by moving the read inside `entity_contact`'s own `.if !BATTLE_ENABLED` block, where it belongs: an
  RPG encounter has no invincible window to respect, only the action side's knockback does. See
  `rpg.test.js`.

The scripted `Damage` command follows the same `jmp player_died` rule for its own killing hit, and
deliberately does not route through `hurt_player` either: a trap has no attacker for the knockback
and must land regardless of the invincible window a physical hit would still be honouring. `Heal 255`
is a full
heal with no separate "inn" vocabulary, and — the one place the two models genuinely diverge —
revives a fallen RPG party member the way an inn would, where `cast_heal` in battle never has to ask
the question because it only ever heals whoever is already taking their turn. `projectUsesCombat`
(`shared/font.js`) counts a live `Damage` command in an action project the same way it counts a
damage actor or a painted metatile, because an author whose only damage source is this command still
needs the hearts drawn — but not in an RPG, where `Damage` never reaches `player_hp` and, now, where
nothing about combat reaches the hearts at all: `projectUsesHeartArt` answers false for every RPG
regardless of what `projectUsesCombat` says, because `draw_hud` and `hurt_player` do not assemble
there to draw them. Item 5's own phase 4c added a fourth source to that same list: an action-project
item whose `effect` is `{kind: 'damage', amount > 0}` reaches `player_hp` too, through
`use_item_apply` (below), the moment it is ever spent — and unlike the scripted command, an item's
effect has no live/dead branch to hide inside, since every item in `project.items` is compiled
unconditionally, so `projectUsesCombat` counts any such item regardless of whether a pickup or a
`Give` currently makes it reachable, the same policy `projectUsesItems` already holds for turning
`ITEMS_ENABLED` on at all. An RPG's own damage-kind items are excluded from this count the same way
its `Damage` command already is — they land on party HP through `party_damage` (`engine/rpg.asm`)
instead, and need no heart-HUD reservation.

An internal movement-code dedup's `move_right_inside`/`move_down_inside` (`engine/player.asm`)
deliberately `jmp` to their shared tail on the very next line rather than falling through into it,
even though a fallthrough would reclaim a few more bytes: fallthrough would make physical adjacency
between an entry routine and its tail load-bearing and invisible, so inserting anything between
`move_down_inside` and `move_vertical_probe` would silently break `move_down` with no assembler
error.

### The event system

**What makes an event run is a byte of the entity record**, `EVENT_TRIGGERS` in
`shared/project.js` in wire order, `TRIG_*` in `engine/constants.asm` at the other end. `interact`
is index 0 because it is what every event did before the byte existed, and **a trigger is a choice
rather than a set** — `do_talk` requires `TRIG_INTERACT`, or an entry event could be replayed by
walking up to whatever carried it and pressing the button.

**A placed entity's own record has a second field whose meaning depends on the actor's
behaviour, not just its trigger.** `ent_to_scr` (`engine/constants.asm`) is written unconditionally
for every placement (`spawn_entities`). `entity_door` (`engine/entities.asm`) reads it as a
flat-screen target; under `ITEMS_ENABLED`, both `entity_pickup` (`engine/entities.asm`) and the
interact-button pickup path in `do_interact` (`engine/input.asm`) instead read it as the item id a
pickup actor's placement grants — so for a pickup actor, item 5's own id retarget (phase 4)
repurposes the same byte to carry that item id instead of a meaningless door target. Behaviour is
exclusive (never both `door` and `pickup`), so the two meanings never collide, and
`resolveEntityByte(entity, actor,
itemsEnabled, itemIdForActor, flatLength)` (`main/build/generate.js`) is the single place that
decides which one a given placement's byte is — a verbatim extraction of the inline ternary
`emitScreens` used to carry, with no ROM-visible change, so the same question resolves identically
for `emitScreens` and for `test/lib/eventdecoder.js`'s consumer (below). The one trap in the reuse:
the door-target clamp (`Math.min(entity.props?.toScreen ?? 0, Math.max(0, flatLength - 1))`, now
inside `resolveEntityByte`) must never run for a pickup actor's byte — an item id above the current
screen count would be silently corrupted into a real, wrong screen number by a clamp meant for the
other meaning entirely.

`NO_ACTOR == NO_ITEM == $FF` is what let most of that retarget reach the ROM with **no engine code
change at all**: Give, Take, a monster's drop, and a Carrying condition all used to resolve an item
id to the actor byte it backed (`itemByte`, since deleted) before compiling it; once the compiler
stops resolving and hands over the item id directly, every sentinel comparison already in the
engine — `script_op_give`'s `cmp #NO_ITEM` (renamed from `NO_ACTOR` for clarity; both are `$FF`,
so the rename cost nothing), `roll_drop`'s identical compare — keeps working unexamined, because
both sentinels were always the same byte. Only the compiler's choice of *which* function resolves
an authored reference changed, never what the engine compares it against.

The same id-space-capping shape `NO_ACTOR`/`NO_ITEM` already use closed a second, unrelated
collision the retarget's own icon table (`item_metasprite`) surfaced: before `LIMITS.metasprites`
existed, a metasprite array was genuinely uncapped, so a project could reach a real metasprite 255 —
byte-identical to `NO_METASPRITE`, an item's own "explicitly no icon". `LIMITS.metasprites =
NO_METASPRITE` (`shared/project.js`) closes it the same way `LIMITS.actors`/`LIMITS.items` already
do: the cap *is* the sentinel's own value, not a literal 255 that could drift from it. An
already-over-cap project (a later version's, or hand-edited) is refused by `validateProject` with a
named error and left intact rather than silently sliced — a 256th metasprite is real, drawable
content, the identical policy the actor and item ceilings already hold to.

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

**`SAVE_LAYOUT_VERSION` is 2**, bumped from 1 when `inv_items`' own bytes started meaning an item
id rather than an actor id — a change to what the bytes mean, not how many
there are, precisely the case `saveIdentity`'s own derived sizes cannot catch and what the
version byte exists for. Such a bump is unconditional and engine-wide: *any*
save from the prior engine version fails `save_check_valid`'s very first identity compare,
regardless of whether that particular project uses items. What an author sees is nothing special —
the old save is treated exactly like a foreign or corrupted one, which is to say the title screen
simply does not offer Continue. No message, no crash: the existing "this record does not belong to
this build" path doing the job it already did for every other case.

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
`item_effect_kind`/`item_effect_amount` and answers
one of three states in `A` — `USE_ITEM_NONE`, `USE_ITEM_ALIVE`, `USE_ITEM_DIED` — because a two-state
carry protocol cannot say "applied, and lethal" as a third thing distinct from "applied" and "not
applied" without a second flag riding beside it. A `none`-kind item makes `use_item` skip the
shift/`items_used` step entirely: it is kept, not spent, regardless of `amount` (a positive amount on
a `none`-kind record is a legal, if inert, thing to author — kind alone decides). `heal` and `damage`
both apply, through whichever health model the build has — `BATTLE_ENABLED`: `party_heal`/
`party_damage`; otherwise `gain_hearts`/`lose_hearts` — and are spent either way, no third model
invented for the field the way `Heal`/`Damage` already refuse one for a metatile. **`use_item_apply`
is reached by `jsr` and must never itself `jmp player_died`** — the identical shape "a killing hit
must `jmp player_died`, not return into it" already documents a few paragraphs up. The constraint is
about whose return address is at stake, not about whether one exists on the
stack at all — those are different claims, and only the first is what makes the `jmp` safe.
`dispatch_input`'s own `dispatch_loop` reaches `use_item` by `jsr do_action` (`engine/input.asm`),
which then falls to `do_action_confirm` and `do_action_use` by ordinary same-subroutine branches
(`cmp`/`beq`), not by `jmp` — `do_action_use` is what actually does `jmp use_item`. That `jsr`'s own
return address is genuinely still sitting on the stack the entire time `use_item`, `use_item_apply`
and `player_died` run: nothing between them ever resets the stack pointer (`txs` appears exactly
once in this codebase, in `boot.asm`, at boot), and `player_died` itself ends `jmp box_say`, one more
tail call rather than a fresh push. So there *is* an outstanding return address underneath all of
this — `do_action`'s — and it is not stranded: it is exactly what some later `rts`, once the whole
chain of tail calls finally unwinds, correctly returns through, back into `dispatch_loop` to continue
reading buttons. What `use_item_apply` must never do is add a *second*, real return address of its
own (the one its own `jsr` pushed) and then abandon that one with a `jmp` — `use_item` may safely
`jmp player_died` only because `use_item` itself was reached by `jmp`, so it never had a return
address of its own to begin with; `use_item_apply` was reached by `jsr`, so it does, and returning
its three-state result with `rts` is what keeps that address matched to the call that pushed it.
`use_item` itself performs the `jmp player_died` after `pla`-ing that result back across the
shift/highlight-repair it runs in between (a `pha` at the top of the routine, popped once at the
very end, is what carries the decision across code that clobbers `A`).

**Neither of the other two starts a conversation itself.** Both arm `pending_ent`, and `main_loop`
is the single place it becomes one. Touch fires from inside `update_entities`, which is still
walking the other seven slots — starting there leaves the pickups, doors and contact damage below
it acting on a world that has just frozen, and a door on the same square redraws the screen out
from under the conversation. Enter is armed by `spawn_entities`, inside the redraw that spawned it,
against a screen still being drawn. So both wait for a frame boundary, and the rules below are all
one rule seen from different sides: **a frame that draws a screen or decides a warp belongs to that
transition, not to the player.**

- **First claim wins**, for both triggers through one `arm_event`. Two actors cannot each own the
  moment a screen loads, and a touch must not push aside the entry event of the screen it happened
  on. The Map Forge says which actor has the moment, on the ones that do not.
- **`pending_ent` is disarmed before the event runs, not after**, so an event that warps hands the
  moment on to whatever the next screen owes rather than swallowing it.
- **Work owed is settled before `dispatch_input`, not merely before the world**, and the frame ends
  there because it belongs to the transition rather than to the player. `settle_owed` is the one
  routine for it, carrying its own `paused`/`game_state` gate — buttons are read in every state,
  but a warp and a pending event are gameplay's alone. Before the world, because an event finishes
  while the box is still up, so the frame that reads `warp_ready` after `update_entities` never
  runs. Before the *buttons*, because an interact reaches `start_dialog` and an event is free to
  warp: a press on that frame could otherwise overwrite the destination of a warp already owed, or
  warp away from a screen whose opening was armed and never spoken.
- **`dispatch_input` stops once a button has drawn a screen or decided a warp.** It looks
  `game_state` up again for every button, so two pressed together are read in two different states
  the moment the first one changes it: confirm and interact on the same frame begin the game and
  then talk to whatever the first screen spawned — on a screen the player has not seen a frame of,
  and if that conversation warps, the opening goes with it. A is read first, which is why this is
  reachable at all; Start is read last and never could be.
- **`screen_fresh` means a screen has been drawn and the world has not run since**, cleared once
  per frame *before* `dispatch_input` and checked at every point the world could start on a screen
  that has only just arrived. There are three ways one arrives mid-frame, and each needed its own
  check: `dispatch_input` draws one outright (Start, on the title); `update_player` crosses an edge
  — and that **does not unwind it**, because `cross_*` is reached with a `jmp` and ends in
  `redraw_screen`, whose `rts` lands back mid-routine with a different screen under the player, so
  `update_player` stops at the flag twice as well (before the second axis of movement, and before
  the hazard and encounter checks); and the input can leave a warp for the next frame. Miss one and
  the new screen charges for its spikes, counts a step towards its wandering monsters, or moves the
  player against its collision before it has said a word.
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
path calls `script_resume`. Plain dialogue is compiled into an event of one unconditional page, so
"talking to somebody" has a single path through the engine rather than a special case beside the
scripted one. `IMPLEMENTED_COMMANDS` in `shared/project.js` is what the Map Forge offers; the
schema, `normalizeEntity` and the compiler handle every command in `EVENT_COMMANDS`, so a project
written by a later version round-trips through this one, and an opcode the engine cannot run stops
the event rather than being reinterpreted as another one. Every command is now implemented; `join`
is additionally hidden by the event editor unless the project has a party, because in an action
build `OP_JOIN` is exactly such an opcode — the battle bank it calls into is not assembled.

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
`virtual: true` entry and the array's final one.
Array position is the wire opcode for every real, `OP_*`-backed entry (`opIndex(id)`,
`main/build/textcompile.js`); the catalog is a contiguous real prefix followed by a contiguous
virtual tail, and a unit test (`'EVENT_COMMANDS: every real-opcode entry keeps its engine constant
value; the virtual tail is contiguous and last'`, `test/unit/project.test.js`) pins both halves
directly, so a future engine-backed command has to insert immediately before the virtual tail and a
future virtual one has to append after it. `route` holds one `who` and an ordered list of legs, each
a real `move`/`turn`/`wait` record; `routeLegs`/`ROUTE_LEG_OPS` (`shared/eventrules.js`) is the
single admission filter shared by the seven consumers that actually admit or reject a leg by it: the
normalizer, `isLive`, `liveCommands`' own recursion, the compiler, the Map Forge editor's own row
canonicalization, its summary line, and the preview's trace model — so none of *those* can disagree
about what a route may hold. `allCommands` is the deliberate exception: its own route branch walks
`command.legs` raw, unfiltered, because it answers "what is mentioned" (for renumbering and
content-wide scans) rather than "what compiles," the same way it already walks a switched-off
branch's contents. `liveCommands` recurses into a route's admitted legs
*instead of* yielding the route command itself, because `encodeCommand`'s own `'route'` case
(`main/build/textcompile.js`) writes no opcode of its own, only its legs' bytes, through the same
`move`/`turn`/`wait` cases a standalone command already uses — so an authored route and the same
commands hand-chained compile byte-identical, at zero engine cost. See
`docs/design-routes.md` for the full design.

Anything asking a question of a
whole event walks `allCommands` in `shared/eventrules.js` rather than a page's own list, and
anything asking how deep it may go asks `nests`. Both rules are there because the same defect
happened twice: `usedSwitches` in `templates.js` read only the top level, so a switch set inside a
branch was invisible to the free-switch scan and got handed out again — which presents as two
unrelated events firing together, and reads as an engine bug.

**A question is a branch the player takes.** `[OP_CHOICE, count, a string id per option]` and then
one record per option, `[length, commands…, OP_JUMP, what is left of the question]` — the same
`OP_JUMP` a then-branch ends with, doing the same job. The string ids are contiguous and up front
because `script_ptr` **stays on the command** until it is answered: `text_choice_step` draws row *n*
from the *n*'th byte after the count, so nothing has to be remembered but `choice_sel`, and
`script_choose` walks that into a body exactly once. That is what lets a `Say` inside an option
suspend and resume through `script_resume`, which knows nothing about questions. `CHOICE_LIMITS` in
`shared/project.js` is the single writer for what one holds, and both numbers come from the box —
four options because `BOX_ROWS` is four, and a label as wide as `BOX_COLS` — so the schema, the
editor and the compiler's clamp cannot offer an option the box has no row for. The cursor is
`ARROW_TILE` in the padding column (`BOX_TEXT_LO-1`), which is inside the frame and outside the
text, so moving it cannot disturb a label and wiping the labels cannot rub it out. `box_after`
carries which phase the box was raised for, so raising the frame and wiping a page stay one
implementation each rather than asking what they are being done for — and `box_handover` is the
single end of both, because **a phase must leave `box_row` at zero for the next one**. Typing
counts in `msg_line`, so for as long as the box only ever typed, every phase could leave that
counter wherever it had finished and nothing noticed; listing options reads it, and read the 4 the
wipe left, which drew no labels at all while every RAM assertion still passed. That is why
`script.test.js` reads the *nametable* for this one.

A page is `[cond, arg, value, body length, commands…]`, and **a branch is that same header inline
in a body**: `[OP_IF, cond, arg, value, then-length]`, the then-branch, `[OP_JUMP, else-length]`,
the else-branch. Past the opcode the shapes are identical, so `script_cond` and the skip that
declines a page are the ones a branch uses too — and because nothing is remembered but where
`script_ptr` points, nesting costs the engine nothing and a `Say` can suspend inside a branch with
`script_resume` knowing nothing about it. The `OP_JUMP` pair is emitted even for an empty else, so
both arrivals at the end of a then-branch look the same. The header is a fixed four bytes on every
page even though only the variable comparisons read `value`, because `script_skip` steps over a
page it has declined *without* decoding the condition that declined it; `EVT_PAGE_HEAD` in
`engine/constants.asm` and the header written by `main/build/textcompile.js` are the two ends of
that. The variables themselves are 16 bytes at `variables` in `constants.asm`, but **how many
there are is generated** — `NUM_VARIABLES` in `config.inc`, from `RPG_LIMITS.variables`, which is
also what clamps a variable index as it is compiled. The engine therefore range-checks nothing:
the compiler is the only thing that can know how big the array is, so it is the only thing that
guards it.

**`Run common event…` compiles to `[OP_CALL, table slot]`**, the slot a `call`'s target resolved to
in `main/build/textcompile.js`'s own events table — common events are compiled into it ahead of
every placement's, so a call's one-byte argument is the position it landed in, nothing more.
`shared/project.js`'s `liveCommonEvents(project)` is the single definition of which
`project.commonEvents` entries get a slot at all — one with at least one live page
(`compiledPages(entry.event).length > 0`), carrying the id `resolveCommonEventIds` gives it — and
both the compiler's slot assignment and `validateProject`'s own "does this call's target still
resolve" check consume that one function rather than two implementations of the same admission rule
that could disagree about which id a deleted or emptied-out common event leaves behind.

A `call` naming nothing live — deleted since, never live to begin with, or never given a target —
still compiles to `[OP_CALL, NO_COMMON_EVENT_SLOT]` rather than being dropped: `script_op_call`
(`engine/script.asm`) reads the operand and, finding the sentinel, stops the event exactly as
`script_run_bad` stops one on an opcode it does not recognise at all, and exactly as
`script_op_give`/`script_op_take` already do on `NO_ACTOR` — a recognised command whose operand
names nothing is that family's shape of bug regardless of which opcode carries it. Dropping the
command silently instead — which is what this engine did until the gap was found — let the page
carry on to whatever the author wrote to run *after* the call, having silently not run the thing
the call was there for. `validateProject` also refuses a build over a *live* `call` like that, the
same way it refuses a missing Give/Take actor or an empty battle formation, so this is defense in
depth for a hand-edited project or one written by a later version, not the only thing standing
between a broken reference and a shipped ROM.

**Exceeding `CALL_STACK_DEPTH` is a different failure from `NO_COMMON_EVENT_SLOT` and gets a different
answer.** The callee there is perfectly real — there is just nowhere left on the small fixed
`call_ret_lo/hi` stack (`CALL_STACK_DEPTH` in `engine/constants.asm`) to remember the way back — so
`script_op_call` skips the call and runs the next command, on purpose: two common events are free to
call each other, and a cycle between them is only visible once both bodies exist, not while either
is being authored, so past the bound a call has to unwind rather than hang the game on an
author-invisible cycle. The two checks do not share a branch: `script_op_call` tests the operand
against `NO_COMMON_EVENT_SLOT` first and stops there before the depth is even read, so a fix to one
cannot quietly change the other's behaviour.

The 64 switches and the 16 variables are the only state that outlives a screen change, which is
what makes "this happened already" expressible. `switch_test` / `switch_set` / `switch_clear`
**preserve X and Y**,
and `switch_split` builds its mask by shifting rather than indexing a table for exactly that
reason: `spawn_entities` calls `switch_test` with the entity slot in X and the record cursor in Y,
and reloading Y after the test would set the flags from the reload rather than from the switch.

### The kernel budget

Move's mechanism is described under "The event system" above. The conditional part is the interesting one: Move is measured, not guessed, because hand-written
code that assembles to an unknown size is exactly what the Code Forge's own capacity philosophy
(below, under "The Code Forge") refuses to model — the kernel-lo bank is a fixed 8,192-byte region
shared by engine code
and every project's own lookup tables, and `checkCapacity` (`main/build/generate.js`) has to know
both halves exactly. Six rules hold that model together, and they are the ones any change to this
ledger has to keep:

- **A conditional feature's cost is a separate generated allowance, never folded into a base.**
  `kernelCodeBytes` charges Move, Turn, Wait, Save, Sting, Sfx, switch-bound tiles, Fade/Flash and
  the MMC3-only font-bank split as their own named `*_KERNEL_ALLOWANCE` terms, each gated on the
  predicate that turns the feature on (`projectUsesMove`, `projectUsesSave`, …) — a project that
  never uses a feature assembles byte-for-byte as if the feature did not exist, which
  `move.test.js`, `codebuild.test.js` and their neighbours assert by comparing whole ROMs.
- **A term that varies by mapper is measured per mapper**, in a `*_BY_MAPPER` table
  (`BASE_KERNEL_CODE_BYTES_BY_MAPPER`, `TITLE_KERNEL_ALLOWANCE_BY_MAPPER`,
  `SAVE_KERNEL_ALLOWANCE_BY_MAPPER`), not charged to every board at whichever board's figure is
  largest. Base and title fall back to the largest measured figure for a mapper their table has no
  entry for (`?? FALLBACK_...`), and `kernelbytes.test.js` builds real ROMs on those boards to
  confirm the fallback still leaves real margin. **Save has no fallback** — it indexes
  `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]` directly, deliberately: a newly implemented save
  medium with no measured entry must fail loudly rather than silently inherit another board's
  figure. The converse rule matters as much: **a term stays flat until real variance is measured**,
  which is why Save's own RPG supplement is a bare `SAVE_BATTLE_KERNEL_ALLOWANCE` and not a fourth
  table — the same standard `TITLE_KERNEL_ALLOWANCE_BY_MAPPER` met in the opposite direction, its
  MMC3 entry earning per-mapper shape on a measured 12-byte difference.
- **A term measured against one game type and charged to both is wrong for the one it was not
  measured on, and no delta-based test can see it.** `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` was measured
  only against `sample-rpg` and overcharged every action project 36 bytes until it was split;
  `BASE_KERNEL_CODE_BYTES_BY_MAPPER` had the identical defect, overcharging action projects 270 bytes
  on MMC1 and UNROM 512 and 282 on MMC3 (`docs/kernel-base-overcharge-report.md` — the write-up, cause
  and fix), fixed the same way: the base now holds the action-side figure, and
  `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER` (below) carries the RPG-only remainder. A third instance shared
  the blind spot without the game-type mismatch: `SPLIT_KERNEL_ALLOWANCE` was never measured as its
  own delta, only as a residual already containing its own bytes, and 146 of its true 165 had been
  hiding inside that same MMC3 base (`docs/split-lock-not-pinned-report.md` §8). The reason none of
  the three was caught is worth keeping even after all are fixed: every absolute `assertCovers` check
  used to run against `sample-rpg` only, and every action-side check was a *delta* between two action
  builds, which cancels the base term out. A new allowance needs at least one absolute check on each
  game type — and each condition — it can be charged to.
- **Individual allowance deltas are equality-asserted against nesasm's real usage, per board, not
  margin-checked.** `kernelbytes.test.js` measures each named constant's own isolated delta with
  `assert.equal`, not `<=` — a margin check would let a stale, too-generous figure sit undetected
  until the day a project actually needed the bytes it silently claimed. The *combined*
  reservation is checked differently: `assertCovers` requires the real margin to sit between
  `KERNEL_SLACK` and `KERNEL_SLACK * 2` — under it, the reservation has fallen behind the engine;
  over it, the term has stopped tracking closely enough to catch the next regression.
  (`bankedbytes.test.js` holds the same discipline for the separate banked battle-region ledger,
  not for these kernel-lo allowances.)
- **`kernelShortfallAdvice` (`main/build/generate.js`) prices a removal by disabling every live
  occurrence of a command — nested inside a branch or a choice option, and inside a common event,
  not just top-level — and asking what the resulting project's full kernel-lo occupancy
  (`kernelCodeBytes + fixedBytes + tableBytes`) would be (`projectWithoutCommands`), never by
  summing the flat allowance constants.** Summing under-counts: on MMC3, a project whose only live
  event is a Move (or a Sting) is that project's only reason `SPLIT_KERNEL_ALLOWANCE` is paid
  at all, so removing it has to free the term *and* the split term together, and only the
  counterfactual-occupancy approach knows that.
- **A mapper offered as a fix must still hold every tileset, every screen and the project's
  mirroring choice** — a smaller kernel-lo reservation alone is not a valid suggestion if
  `reconcileCartridge` would silently truncate one of those the moment the author switched.

Current allowance figures (`main/build/generate.js` unless noted; each named code allowance is a
delta `kernelbytes.test.js` measures exactly, on every board named — the base, the derived table
sizes, the route zero-cost proof and `KERNEL_SLACK` itself are each checked their own way, below):

- `BASE_KERNEL_CODE_BYTES_BY_MAPPER = { 1 (MMC1): 5954, 4 (MMC3): 5971, 30 (UNROM 512): 6149 }` plus
  `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 250, 4: 262, 30: 250 }` — the base is now the action-side
  kernel with nothing conditional turned on, on every RPG-capable board; a non-RPG-capable mapper
  falls back to the largest of the three (the game-type overcharge above; see
  `docs/kernel-base-overcharge-report.md`). The supplement is
  `*_BY_MAPPER`, not flat like `SAVE_BATTLE_KERNEL_ALLOWANCE`: MMC3 genuinely differs by 12 bytes,
  `split_select`'s own second `.if BATTLE_ENABLED` arm (`engine/split.asm`), separate from the arm
  `TITLE_KERNEL_ALLOWANCE_BY_MAPPER`'s own MMC3 entry already charges for — measured variance earns
  the table, per this file's own rule above. No fallback, deliberately, the same reason Save's table
  has none -- but its own gate, `battleEnabledFor` (`codeRegions(...).length > 0`), does not by itself
  imply `rpgCapable(mapper)` (round 1 wrongly assumed it did): `battleKernelAllowance(mapper)` throws
  on a missing entry instead of returning `undefined`-then-`NaN`, `checkCapacity` pre-checks the
  project's own mapper and reports a named problem instead of a broken budget, and `switchableMappers`
  filters out any candidate that would hit the throw.
- `TITLE_KERNEL_ALLOWANCE_BY_MAPPER = { 30: 212, 1: 212, 4: 224 }`, charged whenever a project has
  a title screen — MMC3 costs 12 bytes more because it is the only board with `SPLIT_ENABLED`, and
  `split_select` carries an extra `.if TITLE_ENABLED` branch neither other board assembles. A
  project with a live `Save` command pays this term even if `titleMap` is currently unset, because
  `validateProject` requires a title wherever Save is live.
- `SAVE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 511, 4: 516, 30: 683 }` plus
  `SAVE_BATTLE_KERNEL_ALLOWANCE = 41` — Save's cost is **two** terms: the table is the
  action-side base every save-capable board pays regardless of game type (UNROM 512 costs more —
  flash-rewrite, not battery-WRAM; see the flash-save passage under "The engine"); the flat
  supplement is the RPG-only extra:
  `save_check_valid`'s own `.if BATTLE_ENABLED` range-check block, plus phase 4's `BE_RESTORE`
  call site; together they sum to the RPG totals `{1: 552, 4: 557, 30: 724}`. The
  supplement is flat rather than `*_BY_MAPPER` because the gap measures
  identical on all three boards — the block is a plain RAM range check with no mapper-specific
  instruction in it — and `kernelbytes.test.js` equality-asserts it per board, keeping the flatness
  measured, not assumed. Its gate is **not**
  `gameType === 'rpg'`: `kernelCodeBytes` recomputes `codeRegions(...).length > 0`, the real
  predicate `BATTLE_ENABLED` is emitted from, strictly narrower for a CHR-RAM board whose tileset
  payloads have claimed every switchable region.
- `MOVE_KERNEL_ALLOWANCE = 379` plus `FACE_KERNEL_ALLOWANCE = 16` (the facing-set routine Move and
  `Turn` share, charged once whenever either is live) — 395 total for a Move-only project.
- `SPLIT_KERNEL_ALLOWANCE = 165`, MMC3-only, charged whenever `projectUsesText` is true on that
  board — which includes a project whose only live event is a Move or a Sting command, not just
  dialogue. Renamed from `SPLIT_LOCK_KERNEL_ALLOWANCE`: pinned by a real text-on/text-off isolation
  on a fresh action project, plus a zero-delta control on every non-`scanlineIrq` board, not the
  19-byte residual guess it used to be — see `docs/split-lock-not-pinned-report.md` §8.
- `ITEM_KERNEL_ALLOWANCE = 16` (flat across boards) plus 3 `kernelTableBytes` bytes *per item*
  (`item_metasprite`, `item_effect_kind`, `item_effect_amount`, one byte each in
  `assets/items.inc`); `ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE = { action: 63, rpg: 60 }` for
  `use_item_apply`.
- `STING_KERNEL_ALLOWANCE_STANDALONE = 160` plus the shared `AUDIO_FX_KERNEL_ALLOWANCE = 15`
  (paid by Sting or Sfx, either one); `SFX_KERNEL_ALLOWANCE_STANDALONE = 295`;
  `STING_SFX_INTERACTION_ALLOWANCE = 5` more when both are live at once. Aggregate cost: Sting-only
  175, Sfx-only 310, both live 475.
- `BOUND_TILE_KERNEL_ALLOWANCE = 388`, plus a 30-byte fixed table (`bound_row_lo`/`bound_row_hi`)
  and 2 `kernelTableBytes` bytes per screen (`screen_bound_lo`/`hi`) — not the only allowance with
  a table cost (items have one too, above), but the first `kernelShortfallAdvice` offers to drop
  whose removal changes both code and table occupancy at once, which is why its advice compares
  full kernel-lo occupancy (`kernelCodeBytes + fixedBytes + tableBytes`), not `kernelCodeBytes`
  alone.
- `TURN_KERNEL_ALLOWANCE = 35` composes with the shared `FACE_KERNEL_ALLOWANCE` above (Move+Turn
  together cost 379+35+16=430, the shared facing routine charged once); `WAIT_KERNEL_ALLOWANCE =
  48` shares no code with Turn beyond that same facing routine (35+16+48=99 for Turn+Wait both
  live, neither Move).
  `SHAKE_KERNEL_ALLOWANCE = 65` and `VISIBLE_KERNEL_ALLOWANCE = 49` (Show/Hide) are each flat, with
  no dependent term of their own.
- `FADE_KERNEL_ALLOWANCE = 146` and `FLASH_KERNEL_ALLOWANCE = 98` each name their own routine's
  cost; both share `PALETTE_FX_KERNEL_ALLOWANCE = 55` (`fade_apply_palette` plus the NMI PPUADDR
  fix, charged once whenever either Fade or Flash is live, never twice when both are) — 201 total
  for a Fade-only project, the unchanged shipped figure from before the two were split apart.
- A `route` (`docs/design-routes.md`) compiles to the identical bytes as hand-chaining
  the same `move`/`turn`/`wait` commands — zero additional kernel cost, proven by
  `test/unit/routes.test.js`'s byte-identical-ROM comparison and confirmed with a cross-tree
  SHA-256 gate.
- `KERNEL_SLACK = 20` — the floor `assertCovers` (`kernelbytes.test.js`) holds every measured
  configuration's real margin to (`margin >= KERNEL_SLACK`), not a target to merely clear: a
  correctly measured per-mapper base should leave *exactly* `KERNEL_SLACK` once every conditional
  term is accounted for. `assertCovers` also enforces a ceiling at `KERNEL_SLACK * 2` — not more
  headroom to spend, but a drift alarm: a margin that wide means some term has stopped tracking
  the engine closely enough to catch the next regression.

**Documented limitations — combinations `checkCapacity` refuses today, each with its own named
test rather than a silent gap. Every Save-on-RPG row moved 5 bytes with `BE_RESTORE` (above):**

- MMC3, `Save` + `Move` + one live item: 16 bytes short. Test:
  `'sample-rpg with Save, Move and its one live item does not build on MMC3 -- round 2 reopened the
  gap the kernel diet had closed, a documented limitation'` (`kernelbytes.test.js`). The identical
  combination fits on MMC1 with 195 bytes free.
- UNROM 512, `Save` + `Move`, no item: 93 bytes short (need 126, only 33 free) — genuinely
  unrelated to items; dropping an item does not close this one the way it closes MMC3's.
- MMC3, `Save` + `Move` (no item) + a live `Sting`: documented limitation. Test:
  `'sample-rpg with Save, Move (no item) and a live Sting does not build on MMC3 -- a documented
  limitation'`.
- A live switch-bound tile (marginal cost `388 + 30 + 2 × screen count` — 420 bytes on this
  project's one screen, the largest single feature cost in this ledger) reopens two different
  rows: MMC3's `Save` + `Move`, no item (already 63-free without the tile) and MMC1's `Save` +
  `Move` + one live item (previously comfortable at 195 free). Documented limitation on both
  boards, but two different configurations, not the same one. Tests: `'sample-rpg with Save, Move
  (no item) and a live bound tile does not build on MMC3'` / `'sample-rpg with Save, Move and its
  one live item does not build on MMC1 once a bound tile is added'`.
- A live `Sfx` command adds five more refusal rows on its own: MMC1 Save+Move+item; MMC1
  Save+Move-no-item (36 short); MMC3 ALL-7-verbs+Move+item-no-Save (41 short); UNROM 512
  Save-only-with-item (87 short); UNROM 512 ALL-7-verbs+Move+item-no-Save (42 short); and it
  reopens MMC3's Save+Move-no-item row a second, independent way (alongside Sting), and MMC1's
  Save+Move+item row a second way (with Sting and Sfx both live).
- Two fits controls confirm the boundary is real, not over-drawn: `sample-rpg`'s one live item plus
  a live Sfx alone still builds on MMC3 (the tightest of the three boards), and the seven item-6
  commands (Turn, Wait, Shake, both Show/Hide, Fade, Flash) plus that item with Sting *and* Sfx
  both live still builds on MMC3 too — no Save, Move or title live on that row, load-bearing since
  every refusal row above carries Save and/or Move.

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

**nesasm v3.1 also crashes outright on a long label**, an undocumented limit found while building the
SFX feature: a label of 31 or more characters aborts the assembler with a glibc `_FORTIFY_SOURCE`
buffer-overflow error (exit 134) rather than reporting a normal error line; 30 characters assembles
cleanly. Found by binary search after two new engine labels reached 32 characters
(`docs/sfx-implementation-report.md` §2); both were renamed to 24 characters or fewer and no
other change was needed. Unlike the "6502 traps" list below, this one has no regression test — it is
recorded here as a known assembler limit to keep new labels under, not a claim this codebase actively
guards against.

The editor (`renderer/forges/code/`) is hand-rolled — no runtime dependencies and no bundler rule
out Monaco and CodeMirror, not the CSP; CodeMirror 6 needs no `unsafe-eval` at all. `highlight.js`
is a pure per-line tokenizer (nesasm has no multi-line construct), and its one invariant is that
joining the tokens reproduces the line; a test asserts that over every line of the engine. Two
metric rules in `editor.js`: the gutter, the highlight layer and the textarea must agree on every
font and spacing value or the caret drifts off its character, and for an editable file `gotoLine`
sets the selection *before* the scroll because focusing a textarea scrolls it on the browser's
terms and discards anything set first — a read-only generated file's `gotoLine` does not set a
selection at all, so it only scrolls.
Typing commits to the store on a pause rather than per keystroke (an unusable undo stack) or on
blur (a commit that may never come), so `saveProject` in `app.js` calls the mount contract's
optional `flushPendingEdits()` first.

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
frame, so the trampoline ends with `jmp set_screen_ptr` — the restore *is* the return. Anything
that forgets it leaves the game reading its map out of the battle system's code — no crash, no
obvious banking bug. `banked.test.js` asserts the restore. The trampoline
has four entry points (`BE_INIT`, `BE_TICK`, `BE_JOIN`, `BE_RESTORE`), and `BE_JOIN` is the one used
*on the field*: the script's Join command recruits a party member mid-conversation, so the restore
matters most there — the frame it ran in still has a map to draw. `BE_RESTORE` runs at
load time (`engine/save.asm`), recomputing `pc_spells` from the restored level, not trusting the
save's own possibly-stale bitmask. Unlike `BE_JOIN`, this restore is masked by its caller:
`continue_game` ends `jmp redraw_screen`, re-running `set_screen_ptr` regardless of whether the
trampoline exit succeeded.

The split is: `engine/rpg.asm` in the kernel (the RNG, the step counter, assembling a formation),
everything else in `engine/battle.asm` + `battleui.asm` + `battleturn.asm` on the far side.
Calling *out* of the bank is free — the kernel is permanently mapped — so the battle system uses
`vram_open`/`vram_push`, `draw_metasprite` and `add_item` directly.

**That region has a capacity check, and unlike the kernel's it is exact.** Nothing bounded it until
`battleRegionBytes`/`battleRegionCeiling` (`main/build/battletables.js`) — overflowing it surfaced
as raw nesasm output attributed to whatever line happened to fall past the end, which is the thing
this codebase's own convention refuses to show a user. The budget lives beside the tables it sizes
rather than beside `kernelCodeBytes`, for a hard reason: `generate.js` reaches for `node:fs`, so the
renderer cannot import it, and the Build panel's meter would need a second copy of the arithmetic —
the drift the check exists to prevent, one layer out. `battletables.js` imports only from `shared/`
and must stay that way; `renderer/forges/build/build.js` importing it is the same move
`renderer/forges/sound/sound.js` already makes with `main/build/songcompile.js`.

`BASE_BATTLE_CODE_BYTES_BY_MAPPER` is per board from the outset (UNROM 512 3956, MMC1 3956, MMC3
4002 — each +14 from the battle-side saturation fixes, the `bcs`-before-`cmp` guard `gain_hearts`
and `party_heal` already had, applied to `item_chosen`/`cast_heal`/`cast_heal_mon` plus a
saturate-to-255 in `spell_damage_weak` and `physical_damage_noise`; see
`docs/battlemath-report.md` — plus a further +50 on every board alike from the
name-stride fix: `name_offset_pc` (`engine/battle.asm`) traded the 8-bit offset that silently
wrapped past entry 25 for a 16-bit `ptr_lo`/`ptr_hi` add its four callers now dereference through;
see `docs/namestride-report.md` — plus a further +53 on every board alike from the Magic Forge's
own spell-amount roll, `roll_spell_amount`/`mod8` (`engine/battleturn.asm`); see
`docs/design-magic.md` §8 — plus +18 from `BE_RESTORE` below) rather
than one flat number split later — the mistake `BASE_KERNEL_CODE_BYTES` made and
`BASE_KERNEL_CODE_BYTES_BY_MAPPER` had to undo. MMC3's extra 46 bytes are the `.if SPLIT_ENABLED`
blocks inside the region itself (`battle.asm`'s split arm, `battleui.asm`'s sprite targeting
cursor), and they need **no** separate conditional term the way `SPLIT_KERNEL_ALLOWANCE` does:
`SPLIT_ENABLED` is `fontBankSplit`, `projectUsesText` is true for `gameType === 'rpg'` on the game
type alone, and this region exists only for an RPG — so there is no MMC3-RPG-without-the-split to
overcharge. Every board that can reach the region has its own measured entry, because `codeRegions()`
hands back nothing unless the project is an RPG and an RPG needs `rpgCapable()`; the fallback in
`baseBattleCodeBytes` stands in for no real board and exists only so an unmeasured one cannot make
the budget `NaN` and silently stop the refusal firing. `test/unit/bankedbytes.test.js` asserts it is
unreachable.

**A different board can help here, which is the opposite of how it first reads.** The ceiling never
moves — every RPG-capable board gives this region the same 8 KB — but the stock code inside it does,
and MMC3 spends 46 more bytes of it. So an MMC3 project over by 1 to 46 bytes fits unchanged on MMC1
or UNROM 512, and a flat "changing mapper does not help" is false advice in exactly the band where
advice matters. `battleShortfallAdvice` therefore *computes* the claim and only makes it when no
candidate fits.

Which boards are candidates is `switchableMappers` (`main/build/generate.js`), extracted from
`kernelShortfallAdvice` so both answers to "would a different mapper fix this?" come from one place.
**It asks the authorities rather than restating their rules**, and that shape was arrived at the
hard way: as a hand-written filter chain it was already missing three rules when reviewed — art in
the tilesets' `$A0-$FF` (only a scanline-IRQ board leaves that range to the author), sprite tile
`$FD` (a split-font board reserves it for the battle targeting cursor, so *entering* MMC3 can break
a project too), and a monster's battle-art block running past `$A0` (an error off MMC3 even when the
tileset's own upper slots are empty). Three misses in one pass is the sign of a rule that should not
be a list. So there are two questions instead: does `reconcileCartridge` change the project (if it
does, the switch silently costs a tileset or a mirroring choice — and the *result* validates
cleanly, which is what makes that case invisible to every other check), and would the result still
build — `validateProject` for every content rule at once, plus the three capacity questions it does
not own: screens, kernel-lo and the banked code region. Errors are compared before against after,
not merely counted: a project being advised may carry unrelated errors every board shares, and
rejecting a candidate for one it merely inherited would cost the author every suggestion over a
mistake that has nothing to do with the switch.

**No board is offered at all to a project carrying hand-written 6502.** Two of the three fit checks
read models of stock code — `kernelCodeBytes` measures the stock kernel, `battleRegionBytes` the
stock battle system — and a Code Forge override replaces one of those files, while even a plain user
file lands in kernel-lo through `assets/usercode.inc`. A candidate can therefore save enough
*modelled* bytes to pass while the real code still overflows, which is the same guess this codebase
refuses to make about user code anywhere else, aimed at the mapper select instead of at a byte
count. Withholding degrades gracefully: the feature- and content-removal advice stays true either
way. Note this also closes the same overclaim in `kernelShortfallAdvice`, which had it first.

The exactness is the part worth keeping, with one qualification. `kernelCodeBytes` must
over-estimate — it shares its bank with lookup tables it models by hand — but this region has two
occupants, and `battleTableBytes` counts the second off `battleTables`' own emitted output rather
than modelling it, so that half cannot drift. The other half, the stock engine code, is a
hand-measured constant like any other: **exact today, and held there by the equality assertion in
`bankedbytes.test.js` rather than by construction.** Across five table-varying variants on all three
boards — fifteen builds — `base + battleTableBytes` equals nesasm's reported usage **to the byte**,
which is why the test asserts equality rather than a margin band, and why `BATTLE_SLACK` is buffer
against stock-code growth rather than headroom for an estimate to be wrong in.

**`battleTables(project, battleStrings = BATTLE_STRINGS)` and `battleTableBytes(project,
battleStrings = BATTLE_STRINGS)` both take an optional, test-only injected strings list, and both
must** — round 2 of the name-stride slice's own review found `battleTableBytes` still calling
`battleTables(project)` with the *default* even after `battleTables` had been given the parameter,
so an injected list's real emission and the counter naming its size could disagree, exactly the
failure this region's whole exactness discipline exists to prevent, one call site closer in than
the board-level check above. The default path is byte-identical to before either parameter existed.
See `docs/namestride-report.md` for `checkBattleStringsCapacity`, the generator guard this
parameter lets be exercised through `battleTables`' own call site rather than only in isolation
(`test/unit/bankedbytes.test.js`).

**Exact for the *stock* battle code, and that qualifier is load-bearing.** A Code Forge override of
`battle.asm` — or of `battleui.asm`/`battleturn.asm`, which it includes — is hand-written 6502 whose
assembled size cannot be known from its text, so the base term becomes a measurement of a file that
is no longer being assembled. `battleCodeOverridden` is the single predicate for that. The rule
about hand-written code cuts **both** ways: a guess would "either refuse a project that fits or
promise room the assembler then denies". So an override project is not refused on the stock base at
all — that would turn away someone's *smaller* battle system for the engine's larger one — it is
checked against the one bound an override cannot move, the generated tables alone. Past that the
assembler answers, with the `.fail` below as the backstop. The advice changes with it: a reduction
that would close an exact deficit is only "the least that could fit" when the base is unknown, and
no board can be said to fit either.

**Overriding `main.asm` is a weaker guarantee again, and gets its own predicate,**
`battleRegionPlacementOverridden` / `BATTLE_REGION_PLACEMENT_SOURCES`: an override of `battle.asm`
leaves the tables where they are, so "the tables alone must fit" survives it, but a custom
`main.asm` can put those tables somewhere else entirely, or nowhere. **No capacity refusal is
raised at all in that case** — the tables-only bound assumes exactly the placement the author has
taken over, and refusing on it would turn away a project that fits. The meter still shows the
stock-based figure, under a hint saying which number it is, since the tables half is as real as
ever. See `docs/design-battle-region-guard.md` for why this is the one case neither the JS check nor
the assembler backstop covers, and how `battleTableBytes` handles a directive it cannot size.

**The `.fail` in the generated `assets/code.inc` bounds where an override of `battle.asm` ends up,
not whether nesasm accepted it — and even together with `checkCapacity`'s own text-scan warning, it
cannot close every escape.** nesasm's own per-byte bank check already catches an override that is
simply too big; the `.fail` exists for the one thing that check cannot see — an override that
*relocates* with its own `.bank`/`.org` and finishes outside the region, which nesasm accepts with
exit 0 while battle code is silently written over screen data or the kernel. `checkCapacity`
separately *warns* when an override's text contains anything **shaped like** a `.bank`/`.org`
relocation (`battleRegionRelocates`) — a text scan, not a size guess, so it is deliberately weaker
than "contains a directive" and can both miss a relocation reached through `.include`/a macro and
flag one that is not real. Neither mechanism alone is complete, and — confirmed on a real build —
two specific relocations get past both together: see `docs/design-battle-region-guard.md` for both,
for the empirical proof behind the `.fail`'s own boundary condition ("did the counter finish inside
this region", not "is the content too big"), and for why the guard is emitted into the generated
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
- **Poison is a status bit, ticked by the message flow.** `pc_status`/`mon_slot_status` carry it,
  and the bite lands in `battle_message_done`: after the victim's own line is dismissed, one tick
  of damage and one more line, with `bt_ptick` marking that second line so dismissing *it*
  advances the turn instead of poisoning twice. A status never survives past the battle that gave
  it to a party member, on any of the three ways a battle can stop mattering: `battle_begin` and
  `battle_end` (`engine/rpg.asm`) each zero `pc_status` for every party slot, covering a fight
  entered and a fight left normally — including a fight the party won. A loss is the third
  way and does not go through `battle_end` at all: `battle_finish` (`engine/battleturn.asm`) jumps
  straight to `player_died` on defeat, so the clear for that path lives in `init_session`
  (`engine/combat.asm`) instead — the single definition of "new game" every game over already
  runs through via `restart_game`, rather than a clear bolted onto the defeat path on its own.
  Nothing currently depends on any of this — nothing on the field reads `pc_status` — but a
  stale-but-harmless byte stops being harmless the day a save record starts serializing this
  array, so the invariant is enforced at every exit rather than merely documented at one of them.
  A heal or a potion cures the caster's own, mid-battle.
- **A spell's amount is a range, not a fixed number**: `amountMin`/`amountMax` in the schema,
  `spell_amount_min`/`spell_amount_n`/`spell_amount_limit` (`main/build/battletables.js`) in ROM,
  rolled by `roll_spell_amount` + `mod8` (`engine/battleturn.asm`) — a draw rejected at or above
  `spell_amount_limit,x` keeps the accepted range uniform rather than masked-and-biased.
  `spell_amount_n,x == 1` is byte-for-byte the old flat `spell_amount,x` read and draws nothing
  from the RNG at all, which is what lets a project migrated from the old schema replay its
  battles identically. Both routines run inside `cast_all`'s own per-target loop, so `bt_tmp2` —
  that loop's own end-of-side sentinel — must survive untouched across the whole `spell_damage`
  → `roll_spell_amount` → `mod8` chain; the regression guard is an RNG-state assertion in
  `test/unit/rpg.test.js`'s `'an all-target spell rolls independently per target -- two living
  monsters take different damage from one cast'`, and it is narrower than it looks: a mutation
  that *replaces* `mod8`'s own `bt_tmp` write with a `bt_tmp2` one corrupts the roll itself and is
  already caught by that test's damage numbers, but one that *adds* a stray `bt_tmp2` write
  beside the real one leaves those numbers looking right and only the RNG assertion catches it.

Anything the engine would need a multiply for is a table instead: `main/build/battletables.js`
precomputes per-level stats and the experience curve, and pads every name to `RPG_LIMITS.nameLength`
so the engine needs no length byte.

**The RPG battle ITEM menu does not list everything `use_item` can spend.** `build_item_list`
(`engine/battleui.asm`) filters the bag to `kind == heal AND amount > 0` — exactly what `item_chosen`
can apply consistently — so a `damage`-kind item or a `heal`-kind item left at `Amount` 0 is a real,
valid item on the field and for Give/Take/Carrying/drops; it simply never appears as a selectable row
in that one menu, so no row there is ever a silent no-op. The filter can leave the list empty while
the bag itself is not (every carried item is field-only-kind), which raised a second problem the
filter alone does not solve: `battle_menu_item` decides whether to open the Items page from the
*filtered* list length, not raw `inv_count`, building the list first so the gate sees the real count
— deciding from `inv_count` alone would open onto an empty list whose row-select code indexes a stale
entry left over from whatever was drawn last, and whose Up press underflows the selection to `$FF`.
`build_spell_list` never needed this ordering, and it is worth knowing why rather than assuming the
two menus share it: a spell's own membership test (`pc_spells`, a bitmask) already is what building
the list applies, so gating on it before building can never disagree with what building produces.
Items introduce a second, independent filter `inv_count` knows nothing about, which is what makes the
build-before-deciding ordering a genuinely new requirement here, not a precedent already proven
elsewhere. The `ITEMS_ENABLED`-false path keeps both routines exactly as they were — an unfiltered
`build_item_list`, and `battle_menu_item`'s original `inv_count` check — because that economy has no
`effect` field to filter on at all, and preserving it byte-for-byte is the same promise every other
`ITEMS_ENABLED`-false path in this document already holds to.

**Two capacity terms follow the item's own kind/amount reader into their respective banks, both
item-conditional and both flat across boards** (see "The kernel budget" above for why a term
earns its own name only once real variance is measured). `ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE`
(`main/build/generate.js`) is `use_item_apply`'s own kernel-lo cost, split by *game type* rather than
by board — the first allowance in this file split that way — because `BATTLE_ENABLED` picks a
genuinely differently-sized damage branch (`party_damage` vs `lose_hearts` plus a zero-page read of
`player_hp`), not because any board differs: 63 bytes for an action project, 60 for an RPG, each
measured on every board of its own type. `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` (17 bytes,
`main/build/battletables.js`) is `build_item_list`'s and `battle_menu_item`'s combined cost in the
banked battle-code region, uniform across all three RPG-capable boards because neither routine
branches on `SPLIT_ENABLED` or anything else board-specific — `BASE_BATTLE_CODE_BYTES_BY_MAPPER`
itself did not move for this: the term is its own line beside the base, not folded into it, the fix
for exactly the mistake `TITLE_KERNEL_ALLOWANCE_BY_MAPPER` already had to undo on the kernel side —
charging every project a cost that only `ITEMS_ENABLED` builds actually pay.

### The emulator

`renderer/emulator/core/` is a vendored jsnes. **Read `renderer/emulator/core/FORGE-PATCHES.md`
before touching or upgrading it** — it lists the deliberate divergences from upstream. Run control
(stepping, breakpoints, watchpoints) is layered *outside* the core in `runcontrol.js` to keep the
vendored code close to upstream; `Emulator.stepInstruction()` mirrors the body of `nes.frame()`
and must be updated in step with it. `Emulator.reset()` goes through the core's own `reloadROM()`
rather than `nes.reset()` for the mirror image of that reason: `nes.reset()` builds a *new* PPU and
mapper, and re-doing by hand what `loadROM` does after its own reset is a second copy of that
sequence — the version that re-did only half of it left the nametables unallocated, so the first
background write after a reset threw from inside the PPU.

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
DOM-free and Node-free and `node:test` imports them directly, but nothing outside the renderer
has to agree with them. Two rules hold the recorder together. `onFrame` **copies and queues,
nothing more** — it runs inside `emulator.runFrame()`, which `tick()` can call four times in one
animation callback and `stepOut()` far more, so encoding there is unbounded work in the run
loop, and an exception there is caught by `tick()` and displayed as `Crashed:`, which is a
recorder bug wearing an emulator crash's clothes; `drainCapture()` encodes afterwards inside its
own try/catch. And the copy is not defensive style: jsnes hands `onFrame` its **one reused PPU
buffer**, whose pre-render lookahead writes row 0 before the next frame, so a stored reference
turns into a frame that was correct on the canvas and wrong in the file. `stepAnd`'s own
`writeFrame` — presentation only, so single-stepping is visible — is excluded from sampling by a
flag, or the Frame button records a duplicate and an instruction step records a partial frame.
**And the GIF's real test is Chromium's, not ours.** `test/lib/gifdecode.js` decodes what `gif.js`
produced and the unit tests assert pixel-identity, except in the one case that cannot be exact — a
frame carrying more colours than the table holds, where the nearest-colour substitution is asserted
against an independently computed expectation instead. But both files were written together and
their LZW code-width rule had to be fixed in both at once, and a matched-pair error there passes
every round trip of ours while producing a file nothing else need accept. The smoke test therefore
decodes the same bytes with the platform's own `ImageDecoder`; a deliberate one-step shift of that
rule in both files passed the then-current 562-test unit suite and was caught only there. Any
change to `gif.js` has to keep that check, and a new format written the same way should get one
like it.

**Item 7's `test/lib/eventdecoder.js` is a comparable test-only layer for a different wire format.**
It walks the actual bytes `encodeCommand`/`encodeEvent` (`main/build/textcompile.js`) produce,
opcode by opcode: `decodeCommand` handles `branch`, `choice`, `warp` and `say` explicitly (each has
its own compiled shape a generic width can't express), gives `sting`/`sfx`/`battle` their real
exceptional widths, and falls back to `EVENT_COMMANDS[opcode].args.length` for every other, generic
command — deliberately schema-driven for that remainder, not independent of `EVENT_COMMANDS.args`.
An exhaustive corpus in `test/unit/project.test.js` exercises every real `encodeCommand` case against
it. It resolves a warp's raw screen operand to a real screen *object* (out of a flattened project,
the same shape `flatScreens` returns), so two builds can be compared by object identity rather than
by an index a reorder/duplicate/delete/resize is required to change. Like `gif.js`/`gifdecode.js`
above, it lives beside the tests that use it — never exported from `main/build/`, and never imported
by it (design §7 item 2) — so a change to the wire format has to keep this decoder in step, not the
other way around.

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
  two hung the whole game in the redraw loop. A counter that lives across a `jsr` needs a byte
  nothing downstream owns (`bt_vrow`), and the bug reached `main` because no test ever opened a
  list with two entries — the untested path was the broken one. `bt_tmp2` is load-bearing a second
  time for the identical reason: it is `cast_all`'s own end-of-side sentinel for its whole
  `spell_damage`/`roll_spell_amount`/`mod8` call chain, so a new routine reaching for scratch space
  in that chain has exactly one byte it may not pick.
- **A backward `.org` silently splices bytes into whatever already assembled there.** nesasm
  places a bank's contents at file offset `address & (bank size - 1)`, with no check that the
  address is actually inside the bank currently being assembled. Given an address *behind* the
  bank's own base — `.org $0600` inside a `$C000`-based kernel bank, say — that arithmetic still
  produces a valid, low, in-range offset, so nesasm overwrites whatever code already landed there
  instead of refusing the file. Nothing about the exit code says so either: like the "exits 0
  anyway" `.fail`/error-line quirk `parseNesasmErrors` (`main/build/nesasm.js`) already has to work
  around, this one produces a ROM that assembled cleanly and runs wrong. Proved empirically before
  `engine/flash.asm` was written — a real `.org` behind a bank's base measurably corrupts a
  neighboring label's bytes, with nesasm reporting nothing — which is why that file's own driver is
  position-independent (assembled at an ordinary address, copied to its real address at runtime)
  rather than ever reserving a fixed low address for itself via `.org`. See `flash.asm`'s own
  header comment for the relocation rules that position-independence requires.
- **An 8-bit multiply used as a table offset silently wraps.** `name_offset_pc`
  (`engine/battle.asm`) computed `index * NAME_LEN` in a single accumulator with the carry
  discarded, so index 26 (`26 * 10 = 260`) came back as offset 4 — `table + 4`, four glyphs into
  the table's first entry (entry 0), so the ten-glyph read returned the last six glyphs of entry 0
  followed by the first four of entry 1, not entry 26's own name; `table,y` addressed that offset
  correctly, only `y` itself was wrong. The fix adds the product
  into a 16-bit `ptr_lo`/`ptr_hi` in place and reads `[ptr_lo],y` instead. Regression tests:
  `'a monster at actor id 26 draws its own name when it attacks, and a low-index monster (one that
  also forces a carry out of ptr_lo) in the same fight still draws correctly'` and `'an item at id
  26 draws its own name in the battle ITEM list, and a low-index item in the same bag still draws
  correctly'` (both `test/unit/rpg.test.js`) read the nametable rather than engine RAM, because the
  bug was in what a consumer was told to point at, not in any table's own contents; `assertForcesCarry`
  (same file) proves each fixture's low-index control also forces a carry out of `ptr_lo`, not just
  the high-index one, so a fixture that stopped needing the carry could not go silently vacuous.

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
