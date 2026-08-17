# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Electron app for building NES games through a UI (five "Forges": Tile, Sprite, Map, Sound,
Controller — plus the Code Forge, the escape hatch for hand-written 6502), which compiles a
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

node --test test/unit/music.test.js                          # one test file
node --test --test-name-pattern "door warps" test/unit/*.test.js   # one test
node main/build/cli.js <projectDir>                          # build any project headlessly

Mesen --testRunner test/lua/engine_smoke.lua sample/build/game.nes   # exit 0 = pass
test/lua/run_sram_check.sh [mesen-path]                             # battery save, both boards
test/lua/run_sram_check.sh [mesen-path] --break=mmc3-a001            # ...and its negative control
```

Several tests **skip** unless `sample/build/game.nes` exists — run `npm run sample && npm run
build:sample` first, and `npm run sample:rpg && npm run build:sample:rpg` for `rpg.test.js`.
A skipped test is not a passing test; check the skip count.

There are **four fixtures, deliberately**. `sample/` is the action-adventure one every engine test is
written against; `sample-rpg/` is the turn-based one `rpg.test.js` drives; `sample-mmc1/` and
`sample-mmc3/` are small battery-save fixtures, one per battery-capable board, that exist to cover a
board rather than to demonstrate a game. They are separate projects, not variants of the other two,
because `sample/` and `sample-rpg/` are mapper-agnostic by design — nothing about what they exercise
depends on which board they happen to be built for — so pinning either of them to a specific mapper
to reach it would narrow a fixture every other engine test already depends on, for the sake of a
concern (a specific board's own register behaviour) that only the Mesen SRAM check has. That check —
`test/lua/run_sram_check.sh`, driving `save_sram.lua` — is what these two exist to feed, and it is
the only thing that consumes them. No test may mutate any of the four — variants go to `mkdtemp`
directories — and no existing test is repointed at either new one: every engine test stays written
against `sample/`.

The two battery fixtures are **the same walk on two boards**: same 2x1 world, same saver at the same
coordinates running the same page, differing only in mapper and in the `Say` the MMC3 one opens with
(that board is the scanline-IRQ one, and a message box is what puts the font split to work during
real gameplay rather than only on the title). So the only thing that can make one pass and the other
fail is the board's own register behaviour, which is the entire point of having two. Their saver page
is guarded on the switch it sets — `Save` records where the player is standing, which for a `touch`
trigger is on top of the actor that fired it, so Continue restores the player mid-contact and
`spawn_entities` arms the trigger again during the load's own redraw. Without the guard the page
re-runs a frame later and hands out a second gem, which is the engine behaving as specified but makes
the restored bag impossible to assert exactly: a load that came back empty and a load that came back
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

`main/build/cli.js` runs exactly this without Electron, which is how the tests build ROMs.

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
  replayer's. If you change one implementation, change all three or that test fails.
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
  changes the content box, and the redraw changes the scrollbar), and it defers the redraw to the
  next frame (a synchronous one raises "ResizeObserver loop completed", which the smoke test
  counts as a renderer error). The smoke test resizes the real window and asserts the map screen
  grew, because a hardcoded zoom looks perfectly correct at whatever size it was written for.

Each Forge is a module exporting `mount(container, app)` and returning
`{ destroy?, onProjectChange? }`; `renderer/app.js` holds the registry and lazily imports them.
`renderer/store.js` is the single project state: `commit()` for a discrete edit,
`beginStroke()`/`touch()`/`endStroke()` so a drag is one undo entry. Undo is whole-project
`structuredClone` snapshots.

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
mapping; `KERNEL_CODE_BYTES` in `generate.js` is the engine-code allowance the capacity check
reserves, and must be raised if the engine grows.

`generate.js`'s `checkCapacity()` computes that split and reports overflow as a plain-language
error *before* the assembler runs. Adding per-screen or per-actor data means updating the byte
math there too.

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

The editor (`renderer/forges/code/`) is hand-rolled — no runtime dependencies, no bundler, and a
CSP with no `unsafe-eval` rules out Monaco and CodeMirror. `highlight.js` is a pure per-line
tokenizer (nesasm has no multi-line construct), and its one invariant is that joining the tokens
reproduces the line; a test asserts that over every line of the engine. Two metric rules in
`editor.js`: the gutter, the highlight layer and the textarea must agree on every font and spacing
value or the caret drifts off its character, and `gotoLine` sets the selection *before* the scroll
because focusing a textarea scrolls it on the browser's terms and discards anything set first.
Typing commits to the store on a pause rather than per keystroke (an unusable undo stack) or on
blur (a commit that may never come), so `saveProject` in `app.js` calls the mount contract's
optional `flushPendingEdits()` first.

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

`box_close` keeps no copy of what the box covered: the box is tile rows 24-29, which is exactly
metatile rows 12-14 with no half-row left over, so it rebuilds those rows straight out of
`[mtptr]` + `mt_tl/tr/bl/br` and the attributes out of `[atptr]`. Moving the box means keeping
that alignment or keeping a copy. The outer eight pixels are overscan — tile rows 0 and 29 and
columns 0 and 31 — so the frame drawn there is decoration, and nothing the player has to see
(the ▼ page prompt) goes in it.

`engine/combat.asm` and `engine/title.asm` are conditionally *reachable* either way, but only
`title.asm` is still always assembled. `COMBAT_ENABLED` and `TITLE_ENABLED` in `config.inc` gate what
runs; `BATTLE_ENABLED` now also gates what *assembles* in `combat.asm` — see the kernel diet under
"`Move` is the first command..." below for why, and `projectUsesHeartArt` (`shared/font.js`), not
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
there to draw them.

**What makes an event run is a byte of the entity record**, `EVENT_TRIGGERS` in
`shared/project.js` in wire order, `TRIG_*` in `engine/constants.asm` at the other end. `interact`
is index 0 because it is what every event did before the byte existed, and **a trigger is a choice
rather than a set** — `do_talk` requires `TRIG_INTERACT`, or an entry event could be replayed by
walking up to whatever carried it and pressing the button.

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

The conditional part is the interesting one. Move is ~395 bytes and **the kernel bank has no room to
carry it unconditionally**: measured on a clean tree, `sample-rpg` with one `Save` command leaves
**411 free bytes** in the kernel-lo bank on MMC3 (142 before the kernel diet below freed 269 more;
161 before that, `switch_prg_bank`'s own interrupt-race fix cost every MMC3 build with
`SPLIT_ENABLED` 19 of those) and 622 on MMC1 (353 before the diet). Assembling Move into every ROM
did not tighten the capacity check, it overflowed the bank and failed nesasm outright, for projects
that never move anything. So `projectUsesMove` (`shared/project.js`) drives a generated
`MOVE_ENABLED` the way `projectUsesSave` drives `SAVE_ENABLED`, and `kernelCodeBytes` gained a term,
`MOVE_KERNEL_ALLOWANCE`. A project with no live Move — including one whose only Move is switched off,
since the predicate reads `liveCommands` — assembles byte-for-byte as it did before the command
existed, which `move.test.js` asserts by comparing two whole ROMs.

**That makes the kernel bank's remaining headroom the constraint on item 1 and item 6 both, and the
269 bytes came from a kernel diet on item 1's own side of the ledger.** `engine/combat.asm`'s action-
mode health model — `hurt_player`, `lose_hearts`, `gain_hearts`, the knockback, and `draw_hud` — is
gated `.if !BATTLE_ENABLED`: an RPG never draws hearts or knocks the player back, it shows HP in the
battle box and starts a fight instead, so none of that code has anything to do there. `player.asm`'s
`knockback_step` call and `boot.asm`'s `draw_hud` call move with their targets, under the same gate.
`projectUsesHeartArt` (`shared/font.js`) is a narrower predicate than `projectUsesCombat` for exactly
this reason: an RPG whose monsters carry contact damage still needs `COMBAT_ENABLED` (that predicate
still drives it), but never draws the hearts or reserves their two sprite tiles, so stamping and
validating that reservation now asks the narrower question instead — a project could paint real
party art over `$FE/$FF` in an RPG tileset that `projectUsesCombat` alone would still have refused.
`kernelCodeBytes`'s own `BASE_KERNEL_CODE_BYTES` dropped by exactly those 269 bytes, on every
RPG-capable board alike, which is what made room for Move at all: a project with Save *and* Move on
MMC3 with text also carries `SPLIT_LOCK_KERNEL_ALLOWANCE` (19 bytes, `switch_prg_bank`'s own
interrupt-race fix — conditional the same way, since it costs nothing on a board or a project that
never shows text on MMC3) and reserves 7669 of the 8192 byte bank against a real measured 7641 — a
28-byte margin, 8 of which is not slack at all but `BASE_KERNEL_CODE_BYTES`'s own cross-board
conservatism (MMC3's own true base, with none of these terms, measures 6675 — eight less than the
UNROM 512 figure this function charges every board). Getting this far needed a second fix alongside
the diet: `checkCapacity`'s own `tableBytes` had been double-charging kernel-lo for every placed
entity's *record*, which actually lives in the switchable window's own screen data (`emitScreens`)
and was already correctly charged against screen capacity there — harmless while kernel-lo had room
to spare, but exactly the kind of stale slop this codebase's own six-plus-revision history under
`SAVE_KERNEL_ALLOWANCE` already warns about, caught the same way: by diffing the formula's claim
against nesasm's real kernel-lo usage rather than trusting either number alone. Between the diet and
that fix, the same combination went from **332 bytes** short of the kernel-lo bank to **12** — real
progress, and not the pass/fail case closed: `checkCapacity` still refuses `sample-rpg` with a `Save`
command *and* a `Move` command on MMC3, correctly, because the reservation genuinely does not fit
without either giving MMC3 its own base (the per-mapper budgeting mentioned above, not done yet) or
loosening the 20-byte `KERNEL_SLACK` floor `kernelbytes.test.js` enforces globally — and this is not
the change to do either of those in. The rest of the roadmap's cutscene verbs (fade, shake, sound
effects, movement routes) are all kernel code with nowhere left to go until one of those two happens;
a second kernel diet (the already-conditional blocks in `engine/title.asm` are worth measuring, though
they cost `sample-rpg` nothing today — it has no title screen) or a second banked region the way the
battle system got one are the other options, and conditional assembly does not compose indefinitely
regardless, because a project that wants three of these is back where it started.

**A command that holds commands is not a special case to be named, it is a `nests: true` entry.**
Two of them exist (`branch`, `choice`) and the third will be along. Anything asking a question of a
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
that forgets it leaves the game reading its map out of the battle system's code, which does not
crash and does not look like a banking bug. `banked.test.js` asserts the restore. The trampoline
has three entry points (`BE_INIT`, `BE_TICK`, `BE_JOIN`), and `BE_JOIN` is the one used *on the
field*: the script's Join command recruits a party member mid-conversation, so the restore matters
there more than anywhere — the frame it ran in still has a map to draw.

The split is: `engine/rpg.asm` in the kernel (the RNG, the step counter, assembling a formation),
everything else in `engine/battle.asm` + `battleui.asm` + `battleturn.asm` on the far side.
Calling *out* of the bank is free — the kernel is permanently mapped — so the battle system uses
`vram_open`/`vram_push`, `draw_metasprite` and `add_item` directly.

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
  entered and a fight left normally — including a fight the party won, where `battle_end` not
  clearing it used to leave a winning member's poison sitting on the field, inert only because
  nothing out there reads it, until the next battle's own reset overwrote it. A loss is the third
  way and does not go through `battle_end` at all: `battle_finish` (`engine/battleturn.asm`) jumps
  straight to `player_died` on defeat, so the clear for that path lives in `init_session`
  (`engine/combat.asm`) instead — the single definition of "new game" every game over already
  runs through via `restart_game`, rather than a clear bolted onto the defeat path on its own.
  Nothing currently depends on any of this — nothing on the field reads `pc_status` — but a
  stale-but-harmless byte stops being harmless the day a save record starts serializing this
  array, so the invariant is enforced at every exit rather than merely documented at one of them.
  A heal or a potion cures the caster's own, mid-battle.

Anything the engine would need a multiply for is a table instead: `main/build/battletables.js`
precomputes per-level stats and the experience curve, and pads every name to `RPG_LIMITS.nameLength`
so the engine needs no length byte.

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
  list with two entries — the untested path was the broken one.

## Conventions

- Generated output (`build/`, `sample/build/`) is never hand-edited; change the generator or the
  authored source instead.
- When the UI offers something the engine does not implement, label it as such in the UI rather
  than letting it look functional. There is no such case left: the Controller Forge's
  `Item`/`Cancel`/`Confirm` were the last one, and `engine/ui.asm` now implements them. The
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
