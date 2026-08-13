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

node --test test/unit/music.test.js                          # one test file
node --test --test-name-pattern "door warps" test/unit/*.test.js   # one test
node main/build/cli.js <projectDir>                          # build any project headlessly

Mesen --testRunner test/lua/engine_smoke.lua sample/build/game.nes   # exit 0 = pass
```

Several tests **skip** unless `sample/build/game.nes` exists — run `npm run sample && npm run
build:sample` first, and `npm run sample:rpg && npm run build:sample:rpg` for `rpg.test.js`.
A skipped test is not a passing test; check the skip count.

There are **two fixtures, deliberately**. `sample/` is the action-adventure one every engine test is
written against; `sample-rpg/` is the turn-based one `rpg.test.js` drives. Neither may be mutated by
a test — variants go to `mkdtemp` directories.

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
every other mapper, so "nesasm writes a correct header with no post-processing" still holds for them.

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
- **The mainline touches mapper registers only under forced blank with the counter disabled** —
  `redraw_screen` and `draw_battle_screen` write `$E000` the moment they blank, or an IRQ could
  land inside `switch_chr_bank`'s register pairs.
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
  page and taking the box down are each a state machine stepped once per tick rather than a loop.
- **NMI rewrites `$2000` after draining, not before.** A `$2006` write copies its high byte into
  the PPU's `t` register, nametable-select bits included, so resetting `$2005` alone leaves the
  screen scrolled to a different nametable.

`box_close` keeps no copy of what the box covered: the box is tile rows 24-29, which is exactly
metatile rows 12-14 with no half-row left over, so it rebuilds those rows straight out of
`[mtptr]` + `mt_tl/tr/bl/br` and the attributes out of `[atptr]`. Moving the box means keeping
that alignment or keeping a copy. The outer eight pixels are overscan — tile rows 0 and 29 and
columns 0 and 31 — so the frame drawn there is decoration, and nothing the player has to see
(the ▼ page prompt) goes in it.

`engine/combat.asm` and `engine/title.asm` are always assembled but conditionally *reachable*:
`COMBAT_ENABLED` and `TITLE_ENABLED` in `config.inc` gate them. Combat is on exactly when
`projectUsesCombat` is true, which is also what decides whether the heart art is stamped into
sprite tiles `$FE/$FF`. `init_session` is the single definition of "new game" — hearts, bag,
counters, all 64 switches and all 16 variables — and both boot and the game-over path go through
it. Where a game
over *lands* is `restart_game`: the title if there is one, a new game if there is not.

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
  advances the turn instead of poisoning twice. Statuses are cleared when a battle starts and
  never leave it; a heal or a potion cures the caster's own.

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
