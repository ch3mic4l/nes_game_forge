# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Shared agent workflow rules (focused tool output, batching, test logs) are in `AGENTS.md`; follow
them as well.

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
npm run sample            # (re)write the demo project to ./sample -- OVERWRITES the checked-in fixture: never run it over one
npm run build:sample      # assemble sample/build/game.nes headlessly
npm run [build:]sample:<rpg|mmc1|mmc3|u512>   # the same pair as above, for ./sample-<name> -- the sample: half OVERWRITES a checked-in fixture; build: is the safe half

node --test test/unit/music.test.js                          # one test file
node --test --test-name-pattern "door warps" test/unit/*.test.js   # one test
node main/build/cli.js <projectDir>                          # build any project headlessly
```

The Mesen/Lua check commands and the per-fixture `npm run` scripts: `docs/reference-fixtures.md`, "Commands".


**Keep tool turns few.** Every turn re-reads the whole conversation, so a session's cost is turns
× context size, not tool output. Batch independent greps and reads into one parallel turn, fold
related greps into one command, read one generous range rather than walking a file in `sed -n`
windows, and apply several edits to a file in one pass where that is practical. Read only the
`docs/reference-*.md` file the task touches, not all of them.

Several tests **skip** unless `sample/build/game.nes` exists — run `npm run build:sample` first, and
`npm run build:sample:rpg` for `rpg.test.js`. Prepare these ROMs with the `build:` scripts only, never the
`npm run sample*` generators, which overwrite the checked-in fixtures.
A skipped test is not a passing test; check the skip count.

`test/unit/docs.test.js` checks CLAUDE.md itself: every `docs/*.md` pointer it names must
exist on disk *and* be tracked by git, and the file must stay under a 40,000-character budget
(`fs.readFileSync(..., 'utf8').length`, not byte length — Claude Code's own limit is on
characters). **This file is an index of rules, loaded into every turn of every session.**
Mechanism depth, measured figures and the story of how a rule was found belong in the matching
`docs/reference-*.md` (current state) or `docs/design-*.md` (design record), with one sentence and
a pointer here — a docs pass that needs more room than that moves text out, never raises the
budget.

`test/unit/docclaims.test.js` checks what the docs say against the tree (every backticked path and identifier resolves,
the deleted Map Forge warning stays deleted, every streamed-map refusal still fires); its header holds the policy.

There are **six checked-in fixtures**: `sample/` (action-adventure; every engine test is written
against it), `sample-rpg/` (`rpg.test.js`), and four save-check fixtures — `sample-mmc1/`,
`sample-mmc3/`, `sample-u512/`, `sample-rpg-mmc1/` — that only the Mesen save checks consume.
**No test may mutate any of the six** — variants go to `mkdtemp` directories — and **none is ever
regenerated in place**: each is hand-edited JSON once written, and running an `npm run sample*`
script over a checked-in fixture is data loss, not a refresh. Why there are six, which carry
in-game naming, why the saver pages are switch-guarded and how the SRAM and flash checks differ:
`docs/reference-fixtures.md`.

Screenshots from `npm run smoke` (`FORGE_SHOT`, `FORGE_SHOT_FORGE`): `docs/reference-electron-layout.md`, "Smoke screenshots".

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

`main/build/cli.js` runs exactly this without Electron. The build gate, and how tests bypass it: `docs/reference-electron-layout.md`, "The build gate".

### The single-writer rule

Anything the 6502 engine and the JavaScript tooling both depend on has **one** definition. Full
text, with every trap each entry has already caused: `docs/reference-single-writer.md` — read it
before touching any of these.

- Engine/generator constants → generated into `build/assets/config.inc`. Never hardcode a value
  in both `engine/*.asm` and `main/build/*`.
- Cartridge/mapper facts → `shared/cartridge.js`. The iNES header is *generated* into
  `build/assets/cartridge.inc`; never write `.ines*` directives in `engine/main.asm`.
- The music format, and the separate smaller Sfx format → `shared/audio.js`. Each is implemented
  three times (`engine/music.asm`, `main/build/songcompile.js`,
  `renderer/forges/sound/replayer.js`) and held byte-identical by `test/unit/music.test.js` /
  `test/unit/sfx.test.js` — change one implementation, change all three.
- The NES palette → `shared/nespalette.js`, shared by the editors *and* the emulator.
- The message font, its conditional `$A0-$FF` reservation, `projectUsesText` /
  `projectUsesCombat` and MMC3's `fontBankSplit` → `shared/font.js`. Glyphs are stamped into the
  **build-time** CHR copies only, never into project data.
- Actions and game states → `ACTIONS` and `INPUT_STATES` in `shared/project.js`. Their *order* is
  the wire format; `ACT_*` and `ST_*` in `engine/constants.asm` are those orders written down, so
  adding one means editing both ends in the same change.
- Describing and resolving a test scenario → `shared/playscenario.js`: resolve by current name at
  call time, never cache a raw index.
- Rewriting every stored flat-screen reference after a map/screen structural edit →
  `remapScreenReferences(project, translate)` in `shared/project.js`.
- Engine RAM addresses → `engine/constants.asm`. Shipping tooling *parses* them (`parseEquates`,
  `shared/enginesyms.js`) out of the `constants.asm` in `build/`; tests hardcode addresses with a
  `; from engine/constants.asm` comment, because a test that reads the file it is checking proves
  nothing.

`shared/` modules must stay free of DOM and Node APIs: they are imported by the main process, the
renderer, and `node:test` alike.

### Electron layout

- **Unsaved changes are guarded in main, never by `beforeunload`** — vetoing `beforeunload` from
  the renderer cancels the close with no dialog and silently kills the title-bar X.
- **A pixel canvas is sized from its stage, never from a constant**: `fitZoom()` and
  `observeSize()` in `renderer/ui.js`.
- **A Forge selection must check it is still current after its own `await`** — `selectForge`'s
  `selectionToken` (`renderer/app.js`), which also bounds a `goTo` navigation context's lifetime.

Each Forge is a module exporting `mount(container, app)` and returning `{ destroy?,
onProjectChange? }`; `renderer/app.js`'s `FORGES` array is the single writer for which Forges
exist, and `isForgeAvailable(entry, project)` the single predicate for whether one applies to the
open project. `renderer/store.js` is the single project state: `commit()` for a discrete edit,
`beginStroke()`/`touch()`/`endStroke()` so a drag is one undo entry. Undo is whole-project
`structuredClone` snapshots. The rest — the selection race, navigation contexts, the
Monster Forge's catalog predicate and level field, map organization — is in
`docs/reference-electron-layout.md`.

### The engine

`engine/` is 6502 assembly in **nesasm v3.1** dialect. The cartridge type is per project
(`project.cartridge.mapper`, default NROM-256) and drives a generated header. A **tileset is one
8 KB CHR bank**. **Every cartridge uses one PRG layout**:

```
$8000-$BFFF  switchable window -- screen data (and an RPG's battle bank), one 16 KB bank at a time
$C000-$DFFF  fixed kernel      -- lookup tables, then engine code
$E000-$FFFF  fixed kernel      -- music and text data, streaming code (if any), then the CPU vectors
```

Supported: NROM, CNROM, GxROM, Color Dreams, UxROM, MMC1, MMC3, UNROM 512. Read
`docs/reference-engine.md` before changing engine code; the rules it holds, in brief:

- Mapper bank registers are written only in `engine/banks.asm` — `switch_prg_bank`/`switch_chr_bank`
  (one routine per mapper *family*, selected by generated flags) and `write_mapper_reg` for
  initialization and whole-register restores — plus two outside subsystems: MMC3's font split
  (`engine/split.asm`) and flash save's RAM-resident driver. A new discrete CHR mapper is a data
  entry in `shared/cartridge.js`. `set_screen_ptr` selects the current screen's PRG bank and
  `redraw_screen` its CHR bank; the other callers are listed in `docs/reference-engine.md`.
- `reconcileCartridge()` (`shared/project.js`) must be called in the same commit as any UI change
  to mapper or mirroring, because `store.commit()` never runs `normalizeProject`.
- `engine/constants.asm` is the single allocation map for zero page and the `$0300+` RAM arrays.
  New engine state goes there; a collision is silent and will present as an unrelated bug.
- MMC3's scanline IRQ gives the font its own CHR bank (`engine/split.asm`): interrupt-time code
  only ever selects MMC3 register 1, mapper-register pairs run only under forced blank or
  `switch_prg_bank`'s own critical section, and the split follows state, not events.
- **Nothing but `text.asm` may write to the nametable while rendering is on**; everything else
  queues packets in `vram_buf`. A packet that is opened must be pushed to at least once (a count of
  zero drains as 256), and NMI rewrites `$2000` after draining. `flip_tick`, `flash_tick` and one
  frozen-world tick are the three producers that can share a frame (worst case 88 of 256 bytes) —
  a fourth independent producer must re-open that accounting.

### The event system

`docs/reference-event-system.md` — read it before touching `engine/script.asm`,
`main/build/textcompile.js`, `shared/eventrules.js`, triggers, items, saves or the renumber
helpers. In brief:

- Touch and enter events only arm `pending_ent`; `main_loop` is the single place it becomes a
  conversation. **A frame that draws a screen or decides a warp belongs to that transition, not to
  the player** — `settle_owed`, `screen_fresh` and the `dispatch_input` stop are that one rule.
- `EVENT_COMMANDS` array position is the wire opcode: a contiguous real prefix, then the virtual
  tail (`route`). A command that holds commands is a `nests: true` entry. Anything asking a
  question of a whole event walks `allCommands` ("what is mentioned") or `liveCommands` ("what
  compiles") in `shared/eventrules.js`, never a page's own top-level list.
- Deleting an actor, item, spell, party member or animation goes through its
  `renumber*Deletion` helper in `shared/project.js`.
- `SAVE_LAYOUT_VERSION` is 3; a bump invalidates every prior save. `saveCompatToken` invalidates
  saves only for a project that reorders, deletes or resizes maps.
- `switch_test`/`switch_set`/`switch_clear` preserve X and Y.

### The starter library

`shared/library/` ships CC0-1.0 content (terrain, monster, pickup, sfx, song) in one flat
`LIBRARY_ENTRIES` (`shared/library/index.js`). `planLibraryImport` is pure; `applyPlannedProject =
Object.assign` is the one apply, called inside one `store.commit` with no `await` between plan and
apply, so a refused plan never reaches `commit`. `suggestedPaletteSlot` is the single writer for
both the picker's suggestion and the headless default — the two can never disagree. The Forges must pass
`options.tilesetId`, else a core defaults to tileset 0. See `docs/design-starter-library.md`. Also see `docs/reference-starters.md`.

### Starter projects

`STARTERS` in `shared/starters/index.js` is the single writer for which starters exist; the picker
(`chooseStarter`, `renderer/app.js`) renders one button per entry and `project:create` takes
`starterId`, resolved before `fs.mkdir` so an unknown id creates nothing. The two blank entries are
pinned byte-identical to `createProject`.

Content-starter construction, the `hideSwitch`-at-spawn trap and the `acorn` test-only devDependency: `docs/reference-starters.md`.

See `docs/design-starter-projects.md`.

### The kernel budget

The kernel-lo bank is a fixed 8,192-byte region shared by engine code and every project's lookup
tables, and `checkCapacity` must know both halves exactly. `docs/reference-kernel-budget.md` has
the seven rules in full and every current allowance figure — read it before adding engine code or
a conditional feature. In brief:

- A conditional feature's cost is its own named `*_KERNEL_ALLOWANCE` in `main/build/generate.js`,
  gated on the predicate that turns the feature on; a project not using it assembles
  byte-for-byte as if it did not exist.
- A term that varies by mapper is measured per mapper (`*_BY_MAPPER`); a term stays flat until
  real variance is measured; a term is measured on every game type and condition it is charged to.

### The Code Forge

The user's own 6502 lives in `project.code` (`overrides` of engine files, new `files`), on disk
as raw `.asm` under `code/engine/` and `code/user/`. `docs/reference-code-forge.md` has the full
text. Hand-written code is **deliberately outside `checkCapacity`'s byte math** — the assembler is the
capacity check. nesasm v3.1 reports errors across three lines and **exits 0 anyway**
(`parseNesasmErrors`, `main/build/nesasm.js`), and crashes outright on a label of 31 or more
characters.

### The battle system

An RPG's battle system lives in a **switchable PRG bank**, which is why an RPG needs a mapper with
PRG *and* CHR switching (`rpgCapable()`, `shared/cartridge.js`). Read
`docs/reference-battle-system.md` before touching `engine/battle*.asm`, `engine/rpg.asm`,
`engine/nameentry.asm` or `main/build/battletables.js`. In brief:

- **`call_battle` in `engine/banks.asm` is the only cross-bank call there may be**, and it ends
  `jmp set_screen_ptr` — the restore *is* the return (`banked.test.js`).
- Combatants are one index space (0-3 party, 4-7 monsters). The `combatant_*` lookups preserve X
  and Y and return through `bt_ret`. `bt_tmp2` is `cast_all`'s end-of-side sentinel and must
  survive the whole `spell_damage` chain.

### The emulator

`renderer/emulator/core/` is a vendored jsnes. **Read `renderer/emulator/core/FORGE-PATCHES.md`
before touching or upgrading it.** Run control is layered *outside* the core in `runcontrol.js`;
`Emulator.stepInstruction()` mirrors the body of `nes.frame()` and must be updated in step with
it; `Emulator.reset()` goes through the core's own `reloadROM()`.
`test/lib/eventdecoder.js` decodes the compiled event wire format for tests and must be kept in
step with it. Full text: `docs/reference-emulator.md`.

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

ROM-booting tests must get past the in-game naming grid; shared `nes` helpers and the Emulator-driven exception are in `docs/reference-fixtures.md`, "In-game naming in tests".

## 6502 traps this codebase has already hit

Each cost real debugging time and has a regression test; the full stories are in
`docs/reference-6502-traps.md`.

- A routine returning a value must set the flags from that value — `cmp` leaves `Z` describing
  the comparison, not the accumulator.
- Branches are ±128 bytes. Long dispatch chains need `jmp`.
- `tya`/`txa` clobber A inside a loop that relied on a value loaded before it.
- Deciding a state inside several branches lets the last one win. Decide once, before acting.
- Apply before advancing an envelope/animation step, or the first entry is never used.
- A helper called from a loop must hand back the registers the loop owns — and `ldx`/`ldy` set
  the flags, so a routine that answers with the Z flag reloads A *after* restoring them.
- A guard copied from another routine may not mean the same thing (`oam_idx == 0`).
- A `$2006` write moves the screen: any mid-frame VRAM write must be followed by a `$2000` rewrite
  as well as the `$2005` pair.
- What holds for registers holds for scratch bytes (`bt_tmp2`, above).
- A backward `.org` silently splices bytes into whatever already assembled there, exit code 0.
- An 8-bit multiply used as a table offset silently wraps; add into a 16-bit pointer instead.
- A column-0 `.if` is read by nesasm v3.1 as a label. Every `.if` in `engine/` is indented and
  must stay so.
- nesasm v3.1 assembles a bare zero-page operand as 3-byte absolute unless it carries a `<`
  prefix, and a `<` on a name at `$100` or above is an error that still exits 0.
  `test/unit/zeropage.test.js` guards all three directions.

## Conventions

- Generated output (`build/`, `sample/build/`) is never hand-edited; change the generator or the
  authored source instead.
- When the UI offers something the engine does not implement, label it as such rather than letting
  it look functional. No such case remains; the surviving, narrower form is an action bound in a
  state it means nothing in (confirm while walking around), labelled "ignored here", not
  silently doing nothing.
- Capacity limits are enforced in the generator with messages naming the Forge responsible, so
  users never see raw assembler output.
- Re-render a node with `fill(node, ...)` from `renderer/ui.js`, never `clear(node).append(...)`.
  `el()` skips nulls and flattens arrays; the DOM's `append` stringifies both, so a conditional
  child renders as "null" and a list of rows as "[object HTMLDivElement]". Bare `clear()` is still right for the
  clear-then-append-in-a-loop case.
- `showModal` (`renderer/ui.js`) resolves `null` for every dismissal, and an action's `onClick` must do nothing fallible. Full text: `docs/reference-electron-layout.md`.
