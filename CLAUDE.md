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


**Keep tool turns few.** Every turn re-reads the whole conversation, so a session's cost is turns
× context size, not tool output. Batch independent greps and reads into one parallel turn, fold
related greps into one command, read one generous range rather than walking a file in `sed -n`
windows, and apply several edits to a file in one pass where that is practical. Read only the
`docs/reference-*.md` file the task touches, not all of them.

Several tests **skip** unless `sample/build/game.nes` exists — run `npm run sample && npm run
build:sample` first, and `npm run sample:rpg && npm run build:sample:rpg` for `rpg.test.js`.
A skipped test is not a passing test; check the skip count.

`test/unit/docs.test.js` checks CLAUDE.md itself: every `docs/*.md` pointer it names must
exist on disk *and* be tracked by git, and the file must stay under a 40,000-character budget
(`fs.readFileSync(..., 'utf8').length`, not byte length — Claude Code's own limit is on
characters). **This file is an index of rules, loaded into every turn of every session.**
Mechanism depth, measured figures and the story of how a rule was found belong in the matching
`docs/reference-*.md` (current state) or `docs/design-*.md` (design record), with one sentence and
a pointer here — a docs pass that needs more room than that moves text out, never raises the
budget.

There are **six checked-in fixtures**: `sample/` (action-adventure; every engine test is written
against it), `sample-rpg/` (`rpg.test.js`), and four save-check fixtures — `sample-mmc1/`,
`sample-mmc3/`, `sample-u512/`, `sample-rpg-mmc1/` — that only the Mesen save checks consume.
**No test may mutate any of the six** — variants go to `mkdtemp` directories — and **none is ever
regenerated in place**: each is hand-edited JSON once written, and running an `npm run sample*`
script over a checked-in fixture is data loss, not a refresh. Why there are six, which carry
in-game naming, why the saver pages are switch-guarded and how the SRAM and flash checks differ:
`docs/reference-fixtures.md`.

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

`main/build/buildgate.js` allows exactly one in-flight `build:run` IPC call per project directory,
refusing a second rather than queuing it; unit and Lua tests import `buildProject` directly and
bypass it (`docs/reference-electron-layout.md`, "The build gate").

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

- **Main** (`main/`) owns all filesystem access, the build pipeline, and settings.
- **Renderer** (`renderer/`) is sandboxed with `contextIsolation` — it has no `fs`. Everything it
  can reach is enumerated in `main/preload.cjs`.
- The app is served over a custom `forge://` scheme registered in `main/main.js`, **not**
  `file://`, because ES modules cannot be fetched from an opaque `file://` origin.
- Every `ipcMain.handle` (`main/ipc.js`) is wrapped through one `guardedHandle` refusing a call
  whose `event.senderFrame` isn't this app's own `forge://app/` origin. Saves queue one chain per
  canonicalized directory (`main/savequeue.js`/`main/paths.js`), so concurrent saves serialize
  rather than interleave, each file landing via a sibling temp file and atomic rename.
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
`structuredClone` snapshots. Every map/screen restructuring operation is a commit-free core in
`shared/project.js`, called by both `renderer/forges/map/map.js` (wrapped in one
`store.commit()`) and the unit tests. The rest — the selection race, navigation contexts, the
Monster Forge's catalog predicate and level field, map organization — is in
`docs/reference-electron-layout.md`.

### The engine

`engine/` is 6502 assembly in **nesasm v3.1** dialect. The cartridge type is per project
(`project.cartridge.mapper`, default NROM-256) and drives a generated header. A **tileset is one
8 KB CHR bank**. **Every cartridge uses one PRG layout**:

```
$8000-$BFFF  switchable window -- screen data only, one 16 KB bank at a time
$C000-$DFFF  fixed kernel      -- lookup tables, then engine code
$E000-$FFFF  fixed kernel      -- music and text data, then the CPU vectors
```

Supported: NROM, CNROM, GxROM, Color Dreams, UxROM, MMC1, MMC3, UNROM 512. Read
`docs/reference-engine.md` before changing engine code; the rules it holds, in brief:

- `set_screen_ptr` is the *single* place a PRG bank is selected and `redraw_screen` the single
  place a CHR bank is. `engine/banks.asm` holds one switch routine per mapper *family*, selected by
  generated flags; a new discrete CHR mapper is a data entry in `shared/cartridge.js`.
- `reconcileCartridge()` (`shared/project.js`) must be called in the same commit as any UI change
  to mapper or mirroring, because `store.commit()` never runs `normalizeProject`.
- `engine/constants.asm` is the single allocation map for zero page and the `$0300+` RAM arrays.
  New engine state goes there; a collision is silent and will present as an unrelated bug.
- A streamed world's current screen has a third identity (`flat_screen` global id, `ord_screen`
  compacted table row, `cur_map`) alongside the ordinary one; `sw_resolve_screen` is the single
  place a landing resolves it (`docs/reference-engine.md`).
- `generate.js`'s `checkCapacity()` reports overflow in plain language *before* the assembler
  runs. Adding per-screen or per-actor data means updating the byte math there too.
- **Nothing but `text.asm` may write to the nametable while rendering is on**; everything else
  queues packets in `vram_buf`. A packet that is opened must be pushed to at least once (a count of
  zero drains as 256), and NMI rewrites `$2000` after draining. `flip_tick`, `flash_tick` and one
  frozen-world tick are the three producers that can share a frame (worst case 81 of 256 bytes) —
  a fourth independent producer must re-open that accounting.
- MMC3's scanline IRQ gives the font its own CHR bank (`engine/split.asm`): interrupt-time code
  only ever selects MMC3 register 1, mapper-register pairs run only under forced blank or
  `switch_prg_bank`'s own critical section, and the split follows state, not events.
- The camera is gated on `project.cartridge.camera`; `cameraAxes(mapper, cartridge)` is the single
  writer for which axis slides. Camera off, every fixture is byte-identical.
- `Heal`/`Damage` — commands, metatiles and items alike — mean whichever health model
  `BATTLE_ENABLED` selected. A killing hit must `jmp player_died` from the routine that was itself
  reached by `jmp`; a callee reached by `jsr` answers with `rts` and lets its caller decide.
- `init_session` is the single definition of "new game"; `do_action` (`input.asm`) the single
  place that decides what an action means in the current state.

Also there: UNROM 512's CHR-RAM and flash save, four-screen mirroring, `headerPatch()`, the
mappers deliberately left out, the nesasm bank table, `box_close`, validate-as-you-draw.

### The event system

`docs/reference-event-system.md` — read it before touching `engine/script.asm`,
`main/build/textcompile.js`, `shared/eventrules.js`, triggers, items, saves or the renumber
helpers. In brief:

- What makes an event run is a byte of the entity record: `EVENT_TRIGGERS` (`shared/project.js`)
  in wire order, `TRIG_*` in `engine/constants.asm`. `availableTriggers` is the single writer for
  which triggers are real for a placement and `effectiveTrigger(entity, actor, project)` what
  everything then asks; the stored choice is deliberately never rewritten.
- Touch and enter events only arm `pending_ent`; `main_loop` is the single place it becomes a
  conversation. **A frame that draws a screen or decides a warp belongs to that transition, not to
  the player** — `settle_owed`, `screen_fresh` and the `dispatch_input` stop are that one rule.
- `EVENT_COMMANDS` array position is the wire opcode: a contiguous real prefix, then the virtual
  tail (`route`). A command that holds commands is a `nests: true` entry. Anything asking a
  question of a whole event walks `allCommands` ("what is mentioned") or `liveCommands` ("what
  compiles") in `shared/eventrules.js`, never a page's own top-level list.
- `NO_ACTOR == NO_ITEM == $FF`, and `LIMITS.metasprites`/`LIMITS.animations` cap an id space at
  its sentinel's own value. A recognised command whose operand names nothing stops the event
  rather than being dropped (`NO_COMMON_EVENT_SLOT`, `NO_MEMBER`).
- Deleting an actor, item, spell, party member or animation goes through its
  `renumber*Deletion` helper in `shared/project.js`.
- `SAVE_LAYOUT_VERSION` is 3; a bump invalidates every prior save. `saveCompatToken` invalidates
  saves only for a project that reorders, deletes or resizes maps.
- An item's effect is `{kind, amount}` with `ITEM_EFFECT_KINDS` order as the wire format;
  `use_item_apply` is reached by `jsr` and must never itself `jmp player_died`.
- `{name}` in a `Say` or plain dialogue — never a choice label — compiles to `TXT_NAME`.
- `switch_test`/`switch_set`/`switch_clear` preserve X and Y.

Also there: `Move`'s three rules, questions and branches on the wire, `OP_CALL` and
`CALL_STACK_DEPTH`, `resolveEntityByte`, the player's modular parts, battle animation references.

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

The kernel-lo bank is a fixed 8,192-byte region shared by engine code and every project's lookup
tables, and `checkCapacity` must know both halves exactly. `docs/reference-kernel-budget.md` has
the seven rules in full and every current allowance figure — read it before adding engine code or
a conditional feature. In brief:

- A conditional feature's cost is its own named `*_KERNEL_ALLOWANCE` in `main/build/generate.js`,
  gated on the predicate that turns the feature on; a project not using it assembles
  byte-for-byte as if it did not exist.
- A term that varies by mapper is measured per mapper (`*_BY_MAPPER`); a term stays flat until
  real variance is measured; a term is measured on every game type and condition it is charged to.
- Each allowance is **equality-asserted** against nesasm's real usage by
  `test/unit/kernelbytes.test.js`, and the combined reservation must leave a margin between
  `KERNEL_SLACK` (20) and twice that. If the engine grows, re-measure; never pad.
- `kernelShortfallAdvice` prices a removal by full counterfactual kernel-lo occupancy, never by
  summing allowance constants, and a mapper offered as a fix must still hold every tileset, every
  screen and the project's mirroring choice.

### The Code Forge

The user's own 6502 lives in `project.code` (`overrides` of engine files, new `files`), on disk
as raw `.asm` under `code/engine/` and `code/user/`. `docs/reference-code-forge.md` has the full
text. In brief: `engineFileNames()` in `generate.js` is the single writer of what a stock file is;
overrides are copied in at their own name and line numbers, and `build/` is `rm -rf`'d every build;
`assets/usercode.inc` is always emitted, so a project with no code assembles byte-identically.
Hand-written code is **deliberately outside `checkCapacity`'s byte math** — the assembler is the
capacity check. nesasm v3.1 reports errors across three lines and **exits 0 anyway**
(`parseNesasmErrors`, `main/build/nesasm.js`), and crashes outright on a label of 31 or more
characters. The editor is hand-rolled (no runtime dependencies, no bundler); `placeInPane`/
`focusPane` end every pane reassignment and `ensureTab` is the single load-or-reuse path.

### The battle system

An RPG's battle system lives in a **switchable PRG bank**, which is why an RPG needs a mapper with
PRG *and* CHR switching (`rpgCapable()`, `shared/cartridge.js`). Read
`docs/reference-battle-system.md` before touching `engine/battle*.asm`, `engine/rpg.asm`,
`engine/nameentry.asm` or `main/build/battletables.js`. In brief:

- **`call_battle` in `engine/banks.asm` is the only cross-bank call there may be**, and it ends
  `jmp set_screen_ptr` — the restore *is* the return (`banked.test.js`). It has nine entry points
  (`BE_*`, `engine/constants.asm`). `BE_JOIN`'s operand is guarded against `NO_MEMBER` and a stale
  index.
- In-game naming (`engine/nameentry.asm`) is one source assembled in exactly one of two
  placements — banked on an RPG, kernel on an action project — behind five `name_*` shims in
  `engine/ui.asm`.
- The banked region's capacity check (`battleRegionBytes`/`battleRegionCeiling`,
  `main/build/battletables.js`) is **exact**: `test/unit/bankedbytes.test.js` asserts equality
  with nesasm's usage, per board, including every `*_BATTLE_ALLOWANCE`. `battletables.js` imports
  only from `shared/` and must stay that way — the renderer imports it.
- `switchableMappers` (`generate.js`) answers "would a different mapper fix this?" by asking
  `reconcileCartridge`, `validateProject` and the capacity checks rather than restating their
  rules, and offers no board at all to a project carrying hand-written 6502.
- Combatants are one index space (0-3 party, 4-7 monsters). The `combatant_*` lookups preserve X
  and Y and return through `bt_ret`. `bt_tmp2` is `cast_all`'s end-of-side sentinel and must
  survive the whole `spell_damage` chain.
- Anything needing a multiply is a precomputed table; `ACTOR_BATTLE_DEFAULTS`
  (`shared/project.js`) is the single writer for an actor's battle defaults.

Also there: Code Forge overrides of the battle code and the `.fail` guard, status effects, spell
amount ranges, the ITEM menu filter, monster spell lists, battle animation, hit feedback and MISS,
the preview canvas, the party attack visual, and what to do when 8 KB runs out.

### The emulator

`renderer/emulator/core/` is a vendored jsnes. **Read `renderer/emulator/core/FORGE-PATCHES.md`
before touching or upgrading it.** Run control is layered *outside* the core in `runcontrol.js`;
`Emulator.stepInstruction()` mirrors the body of `nes.frame()` and must be updated in step with
it; `Emulator.reset()` goes through the core's own `reloadROM()`. The run loop paces itself by
wall-clock time, never one-frame-per-rAF. Capture's `onFrame` copies and queues, nothing more, and
any change to `renderer/emulator/gif.js` must keep the smoke test's `ImageDecoder` check.
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

**In-game naming means `sample`/`sample-rpg` now boot into a grid, so roughly thirty ROM-booting
unit test files have to get past it before their own assertions can run.** `test/lib/naming.js`
exports the shared grid primitives (`finishNamingIfOpen`, `typeNameAndFinish`, `clearName`, …),
each operating on an already-booted `nes` instance with raw `nes.frame()` calls; each ROM-booting
suite wraps them in its own local boot helper (`rpg.test.js`'s own `bootPastNaming`, for one).
`test/unit/testoverrides.test.js` deliberately does **not** use this module — its own
`bootPast`/`gridTap` drive the grid through `Emulator`'s `runFrame()`/`setButton` instead, since
raw `nes.frame()` bypasses the `Emulator`'s own PC-intercept table, and that file's ROM-driving
tests depend on it holding every frame, naming frames included, not only ones turning
invincibility on. `npm run smoke` drives every naming grid it meets the same frame-paced way, `pressFramePaced` anchored to
`Emulator.frames` rather than `wait(ms)` — a throttled window starves a wall-clock hold. Mesen's
`save_sram.lua` gained its own naming phases for `sample-rpg-mmc1`; see
`docs/design-rpg-save-fixture.md`.

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
  child renders as "null" and a list of rows as "[object HTMLDivElement]" — reading as bad data,
  not a wrong append, and it cost the Map Forge its whole placed-actor list (remove buttons
  included) until a screenshot caught it. Bare `clear()` is still right for the
  clear-then-append-in-a-loop case.
- `showModal` (`renderer/ui.js`) resolves `null` for Escape, a backdrop click, a bare `close()`,
  and an action with `value: undefined` — a caller can't tell "dismissed" from a chosen `null`
  through the promise alone; one needing that brings its own sentinel: `editEvent`
  (`renderer/forges/map/events.js`) resolves Clear event and an emptied-draft Save through a
  private `CLEAR_EVENT` Symbol, folded by `resolveEventEditorResult` (pinned by
  `events.test.js`). One `showModal` trap: an action's `onClick` must do nothing fallible —
  `renderer/ui.js` awaits it before `close()`, so a throw leaves the dialog unresolved until a
  later dismissal settles it; the derive modal above returns only raw inputs; planning reads the
  project only after the `await` and its guards. Its overlay blocks pointer
  clicks only, not keyboard activation.
