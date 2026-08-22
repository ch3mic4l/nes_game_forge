# Roadmap

Where this project could go next, and why. Nothing here is committed work — `README.md`'s "What
works today" is the honest account of the present, and stays that way.

The framing came from comparing NES Game Forge against [RPG Maker
MZ](https://www.rpgmakerweb.com/products/rpg-maker-mz), which is the closest thing to a peer for
what this app is trying to be. The comparison is useful in one specific direction: Forge already
matches RPG Maker on the *editors* — tiles, sprites, maps, music, controls, event pages, animation
— and does something RPG Maker cannot, in that the output is a real `.nes` ROM with a debugger
attached. Where RPG Maker is ahead is **authoring workflow** and the **breadth of what a game can
express without writing code**. That is what this list is about.

Two things are deliberately *not* on it:

- **Visual map layers.** The NES has one background tile per cell. Arbitrary layers would mean
  build-time compositing, duplicate CHR tiles and palette-conflict resolution, for something the
  hardware cannot show. Better map *organization* (item 7) buys far more per unit of work.
- **A full character generator.** RPG Maker's is enormous and assumes arbitrary bitmaps. The
  NES-shaped version of the same idea is item 8, and it is much smaller.

Ordering: items 1 and 2 are where the leverage is. 2 is cheap and touches no ROM; 1 is the one that
changes what a non-programmer can build.

---

## 1. Event system 2.0

The vocabulary was the constraint. When this was written there were four page conditions
(`EVENT_CONDITIONS`) and seven commands (`EVENT_COMMANDS`, minus `end`) in `shared/project.js`, and
quests, shops, puzzles, cutscenes and boss fights were all reachable only through the Code Forge.
There are now seven conditions and eighteen commands, and every one of them is implemented end to
end — that invariant holds and must keep holding.

- ~~Named 8-bit **variables** alongside the existing 64 switches (counters, quest stages, flags with
  more than two states)~~ — **done**: 16 of them, with Set/Add/Subtract commands and *is* / *is at
  least* / *is under* page conditions. The page header gained a fourth byte to carry the number a
  condition compares against, which is what the rest of this list will want as well
- ~~**Conditional branch** with an else block, so a page can decide mid-run rather than only at the
  point it is chosen~~ — **done**: `If…` takes the same conditions a page does and nests, because
  past its opcode a branch *is* a page header, so the engine reads one with the routine it reads
  the other with
- ~~**Player choices** in dialogue — the message box already has the state machine for a prompt~~
  — **done**: `Ask a question…` holds up to four answers, one per row of the box, each with its own
  list of commands. It is the branch with the condition replaced by somebody at the controller,
  down to ending every answer with the same `OP_JUMP` a then-branch ends with
- ~~**Triggers**: interact (today's behaviour), player-touch, autorun-on-entry~~ — **done**: one
  byte of the entity record, so what makes an event run is a property of the placement rather than
  of the event. Entry triggers are what make an opening scene possible at all: until now nothing
  could happen *to* the player
- ~~**Common events**: one event body callable from many places, so a chest or a shop is authored
  once~~ — **done**: `Run common event…` calls one of the project's own events by name and returns
  to the command after it when the callee runs out of pages. It is the first addition to this list
  that needed the script runner to remember something rather than only where `script_ptr` is
  pointing — a small fixed-depth stack (`call_ret_lo/hi`, `CALL_STACK_DEPTH` in
  `engine/constants.asm`) of return addresses, because two common events are free to call each
  other and a cycle between them is only visible once both bodies exist, not while either is being
  authored. Past the bound a call is skipped rather than pushed, so a cycle unwinds instead of
  hanging. Common events are compiled into the same table a placement's own event is, ahead of it,
  so a call's one-byte argument is just the table slot the callee landed in
- ~~A command for changing **music**~~ — **done**: `Play music…` sets the song directly, through
  the same `set_music` a map arriving at its own song goes through — so the two cannot disagree
  about what is sounding, and an event's choice survives a screen edge inside the map it ran on but
  not a change to a different one. The map itself no longer stops deciding after boot either: every
  map already had its own Music field, but only the start map's took effect: `apply_map_music`
  (`engine/music.asm`), called once from boot and once from `redraw_screen`, is now the single place
  that decides
- ~~A command for starting a **battle**~~ — **done**: `Start a battle…` names a formation of up to
  `RPG_LIMITS.monstersPerBattle` monsters directly, never the map's own (random) encounter table,
  which already has a path of its own. It suspends the script exactly as `Say` does —
  `script_op_battle` advances `script_ptr` past the whole command before handing over to
  `battle_begin`, the same routine a placed monster's contact and the step counter already use — and
  `battle_end` resumes it once the fight is won, through the same `script_resume` a dismissed message
  box calls. Cannot be run from, the same as walking into a placed monster; losing is not authored at
  all, since it is already a game over from `player_died`, so control only ever comes back here on a
  win, and whatever follows the command (turning on a switch, say) is the win case with no new
  vocabulary. The dangerous part was never starting the fight, it was coming back from it without
  disturbing what a *different* redraw already has to do: `battle_end`'s own `redraw_screen` both
  re-arms the screen's entry event (which it already had to put back down) and clears every entity's
  `ent_touched` (which a resumed script's own touch trigger needs put back, since the world never
  moved during the fight) — two redraw side effects a scripted battle now has to settle before it
  decides whether to resume anything, not two chances to get the ordering wrong.
- ~~A command for **healing/damaging** the party~~ — **done**: `Heal` and `Damage`, each taking a
  single 0-255 value, two commands rather than one signed one because `Damage 250` reads as an
  author's intent in a way `Change HP by -250` does not. Which of the engine's two health models
  either one touches is decided at assemble time by `BATTLE_ENABLED` — `player_hp` in an action
  project, every recruited member's `pc_hp` in an RPG — rather than a third model invented for the
  command, and `Heal 255` is the inn with no separate vocabulary of its own
- ~~Commands for **moving an actor**~~ — **done**: `Move actor` walks the event's own actor or the
  player a set distance in one direction, and suspends the script the way `Say` does, because a walk
  the event did not wait for would read as a teleport. A move blocked by a wall or the screen edge
  abandons what it still owed and lets the event carry on, rather than waiting for something that is
  never going to move — nothing else in the world is running. This is the piece item 6's movement
  routes are built out of: a route is this with a list of steps instead of one.

  It is also where this list ran into the wall it was always going to: **Move is ~395 bytes and the
  kernel bank had 161 free.** Measured on a clean tree, `sample-rpg` with one Save command leaves 161
  free bytes in the kernel-lo bank on MMC3, 353 on MMC1. Assembling Move unconditionally did not
  tighten the capacity check, it overflowed the bank and failed the assembler for projects that never
  use the command. So it is gated on `MOVE_ENABLED` the way save.asm is on `SAVE_ENABLED`, and
  `kernelCodeBytes` gained a third term. A project with no live Move is byte-for-byte what it was
  before the command existed.

Every addition here lands in four places at once — `EVENT_COMMANDS`, the schema and normalizer, the
compiler in `main/build/generate.js`, and `engine/script.asm` — and each one costs kernel bytes,
which `KERNEL_CODE_BYTES` in `generate.js` has to account for. Variables also need a home in
`engine/constants.asm` and a slot in whatever save record item 4 defines.

## 2. Event-authoring productivity — **done**

The cheapest genuinely large win on this list: pure editor work, no engine change, no ROM cost, no
capacity math. All of it is now in the Map Forge (README's *Working on a project with a lot in it*),
and it is kept here for the reasoning below rather than as outstanding work.

- ~~**Names** for placed events, and **named screens** (today both are identified by index)~~
- ~~A searchable **event list** for the current map~~
- ~~**Find uses** of a switch, an actor, an item or a destination~~
- ~~**Duplicate and copy/paste** for actors, event pages and individual commands~~
- ~~**Templates**: chest, locked door, NPC, pickup, party recruit, boss encounter~~
- ~~**Reorder** commands, and **disable** one temporarily instead of deleting it to test~~

RPG Maker added exactly these — event list, event search, easy-event templates, copy/paste, command
skipping — specifically to make larger projects survivable
([event list](https://www.rpgmakerweb.com/blog/rpg-maker-mz-preview-4-event-list-system-options-new-ui-release-date-price),
[1.5 update](https://www.rpgmakerweb.com/blog/rpg-maker-mz-1-5-0-update)).

Note that names cost ROM if they reach the build, and they should not: they are authoring metadata,
so they belong in the project JSON and nowhere in `assets/`.

## 3. Test-play tools

Build-and-play and the debugger are already strong. What is missing is the *creator* half — getting
to the thing under test without playing up to it.

- ~~**Play from here**: boot at the currently selected screen and position~~ — **done**, as the Map
  Forge's ▶ Test tool
- ~~**Battle-test** a selected encounter without walking into it~~ — **done**: a Battle-test
  section in the Map Forge's Battles panel, two entry points (the map's own wandering-encounter
  table, or a hand-picked formation), firing straight into `battle_begin` (`engine/rpg.asm`) via a
  redirect through a real `jsr` target (`check_encounter`) rather than a fabricated call, with a
  two-stage completion boundary checked against real results (`stepOut()`'s own return, then a
  program-address rendezvous with the next `main_loop`) and postconditions covering the *durable*
  mutations the entity pass that boundary waits through can make without touching the formation at
  all: the fight's own metadata (`bt_esc`/`bt_from_ent`), the field (`flat_screen` *and*
  `player_x`/`player_y` — a door back to the same screen still relocates the player without changing
  `flat_screen`), a newly armed event (`pending_ent`), and the bag (`inv_count`/`inv_items` *and*
  `pickups` — a pickup against an already-full bag leaves the first two unchanged while `pickups`
  still counts it and the entity still vanishes). Deliberately not among them: `ent_hurt`, an
  entity's position/direction/animation frame, `ent_touched`, and the scratch bytes patrol/chase/
  contact routines use, all of which the entity pass can genuinely still change — and, on a door,
  `screen_fresh` and the destination screen's own freshly `spawn_entities`-built arrays. None of
  those are checked because every one of them is transient on both ways a fight can end: on victory
  or flee, `battle_end` (`engine/rpg.asm`) redraws the screen itself, and that redraw's own
  `spawn_entities` rebuilds the whole entity array from the map data fresh; on defeat, `battle_finish`
  (`engine/battleturn.asm`) jumps straight to `player_died` instead, bypassing `battle_end` entirely,
  and the array is rebuilt only later, when `restart_game` (`engine/title.asm`) redraws after the
  game-over screen — the same distinction CLAUDE.md's own battle-statuses passage already draws for
  `pc_status`, cleared at `battle_end` for the two normal exits and at `init_session` for defeat
  precisely because `battle_finish` skips `battle_end` there. Either way the state this cares about
  is discarded before the player is back in control, regardless of what the entity pass did to it on
  the way in. A postcondition here would be asserting on a value already scheduled
  to be thrown away before the player ever sees it — checking it would not catch a real defect, only
  add a false one the moment some other change nudges a scratch byte. The map-table entry point
  itself is read through the same `mapEncounterFormation` (`shared/project.js`) the compiler calls,
  not filtered by whether an actor currently deals contact damage the way the hand-picked entry
  point's own candidate list is — an actor already sitting in a map's table keeps compiling into
  real wandering encounters after its damage is edited to zero, so the button that tests it must
  not disagree with the ROM about that
- ~~A runtime **switch/variable inspector** (the debugger already reads engine RAM; this is a labelled
  view of it, and item 1's variables make it much more useful)~~ — **done**: a Switches tab in the
  emulator's debugger, listing all 64 switches and the project's variables by their project names —
  an unnamed one still shows by its index rather than being unwatchable — with values read live from
  engine RAM and each row editable as a debug poke, the same as the Memory tab's own click-to-edit
  byte. The switch address, the variable address and the switch count come from the build's own
  `constants.asm`; the variable count comes from the generated `config.inc` (`NUM_VARIABLES`, which
  `constants.asm` deliberately does not define). `RPG_LIMITS.switches`/`.variables` in
  `shared/project.js` are still a second copy of those counts, unrelated to this change — the
  inspector's own contribution is simply that it reads the build's equate rather than adding a third.
  The honesty rule holds the same way play from here's does: nothing is compiled into the ROM, and a
  reset restores whatever the game itself set.
- ~~Toggles for **invincibility**, **encounters off**, **collision off**~~ — **done**: a Toggles tab
  beside Switches, three checkboxes over one mechanism rather than three — a per-instruction PC trap
  table (`Emulator.configureTestOverrides`/`applyTestIntercept`, `renderer/emulator/runcontrol.js`) that
  either pokes a RAM byte at the trapped PC (invincibility, at `update_player`'s own entry, so it can
  only ever coincide with a gameplay frame that was already going to decrement `player_iframes`) or
  redirects execution past a routine onto its own real exit tail (collision, at `probe_solid`'s entry;
  encounters, at `check_encounter`'s), never fabricating the flags or the `rts` that tail would have
  produced anyway. Collision off is deliberately global — every `probe_solid` caller, not just the
  player — since restricting it to the player would mean sniffing the return address off the stack.
  `shared/testoverrides.js` resolves and validates every target — a build missing a required symbol; a
  poke address outside internal CPU RAM or a trap/target outside cartridge PRG space (nothing else is
  something the 6502 or `Emulator.poke` can safely land on); a redirect that aliases its own trap (the
  one case that can never advance — a *distinct* target, forward or backward, still executes with real
  cycles, so nothing beyond that self-alias is rejected on address order); two toggles sharing a trap; or
  a redirect landing on *any* toggle's own trap symbol, checked before any of those toggles are
  invalidated for a different reason, which would otherwise re-enter that toggle's routine with the wrong
  return address still on the stack — refusing every one of those rather than arming it. `toggleProblem`
  and `resolveOverrideTargets` are both thin views onto that one resolution, not two separate
  implementations of it, so there is no second place for them to disagree.
  Same honesty rule as the inspector above: the toggle is debugger configuration and survives a Reset
  like a breakpoint would, but the RAM itself is exactly what a fresh boot sets.
- ~~**Reload the ROM** while keeping the selected test scenario~~ — **done**: a "↻ Reload Test"
  control, in the running player's own toolbar and, once no player is showing, on the Build panel
  too, that rebuilds the project and relaunches whichever scenario last actually built
  successfully — a scenario the tester picked but whose own build then failed or was refused is
  never recorded over the one before it, only a completed build's own scenario replaces it. The
  scenario is a **description, not a reference** — "the map named World, screen 5, at x,y", "the
  actors currently named Slime, Slime, Bat" — resolved fresh, every time, against the exact project
  the ROM in hand was actually built from (the build's own returned payload, never a second, later
  read of the live project: `store.commit` mutates in place, so an actor deleted mid-build can shift
  every later one's id out from under a resolution that read the project a moment too late). Once
  reloaded, every label a control shows is rendered from that same resolved answer, never a string
  cached at the moment the scenario was chosen — a rename that happens to land back on the
  remembered name reads as "follows the name," not as staleness, and two things sharing a name
  refuses rather than guesses. The very first play is the one exception: it still shows Map Forge's
  own label, computed once when the scenario was picked, since nothing has had a chance to go stale
  yet — narrowing the claim to reload rather than making the first play re-resolve too, since the
  latter would be a code change with its own review to go through, not a documentation fix.
  A persistent, opaque id per map/screen/actor — the alternative that would make identity provable
  instead of merely followed — was considered and declined: a project-schema migration, carried by
  every saved project forever, to serve a feature whose entire state is thrown away the moment the
  project closes. `shared/playscenario.js` owns describing a chosen scenario and resolving a
  remembered one back — not the stored record itself, which is `renderer/app.js`'s own
  `playScenario`/`rememberPlayScenario`, and not which toggles exist, which is
  `shared/testoverrides.js`'s `TOGGLE_NAMES`. That file explains why a numeric position isn't
  identity (`createScreen()`'s own comment; `sprites.actors` renumbering on delete); the declined-ids
  decision above is recorded here, in this roadmap, not there — item 7's map reordering is the likely
  place to revisit it, being exactly the kind of structural edit a rename can't survive. Ordinary
  ▶ Build & Play still means only the project's own
  authored start, deliberately and unconditionally — Map Forge's play-from-here and battle-test
  buttons go through a separate entry point, so the ordinary button can never start meaning something
  else depending on session history nothing on it shows. The three toggles above are re-armed against
  the new build the same way; whichever one the new build cannot support is reported by name —
  reusing `toggleUnavailableReason`'s own sentence, not a second vocabulary for it — and cleared from
  the remembered scenario rather than silently retried on every later reload or silently re-enabled
  the moment a later build happens to support it again
- **Screenshot / GIF capture** from the emulator panel

The honesty rule applies here: a test-play override must not be able to end up in a built ROM. Play
from here settled the shape the rest of these should follow — `renderer/emulator/testplay.js` pokes
engine RAM once the ROM is running and the build knows nothing about it, so the ROM is unpatched by
construction rather than by a flag somebody has to clear. It also settled where the addresses come
from: `shared/enginesyms.js` parses them out of the `constants.asm` the build assembled, so engine
RAM keeps exactly one definition.

The switch/variable inspector settled the honesty pattern a second time, for a labelled RAM view with
a write path rather than a one-way read: values are read and poked straight through
`emulator.peek`/`emulator.poke`, nothing about that reaches the ROM, and a reset restores whatever the
game itself set — the same shape play from here already settled, applied to a control the user can
leave toggled rather than a one-shot warp. What the invincibility/encounters-off/collision-off toggles
actually had to touch in the engine was not settled by this and differed per toggle — see item 3's own
entry above for how each one landed. Battle-test needed a third shape rather than either of those two:
assembling a formation and calling into `battle_begin` (`engine/rpg.asm`) safely is orchestration, not
a byte to poke or a PC to trap. The honesty rule still holds — nothing here is compiled into the ROM,
and the redirect reuses a real `jsr` target (`check_encounter`) so the stack already holds the return
address `battle_begin`'s own `rts` needs, rather than fabricating a call frame — but "safely" turned out
to mean checking the completion boundary against real results instead of inferred ones (`stepOut()`'s
own return value, then a program-address rendezvous with the next `main_loop` rather than a bare
`runFrame()`, since a single PPU frame edge does not reliably land after `update_entities` has run), and
treating the entity pass main_loop still runs afterward as a real hazard rather than something to dodge:
an overlapping monster, door or pickup can mutate the fight's own metadata, the field, or the bag out
from under it exactly as it could for a real wandering encounter, and battle-test now detects each of
those rather than reporting success on top of a corrupted world.

Reload Test needed a fourth shape again: not a byte to poke, a PC to trap, or a formation to
assemble, but the exact rebuild-and-remount `play()` already does for an ordinary Play, called a
second time. Two things had to be closed for calling it a second time to be honest. First, whether
the world a reload started in survived its own `await`s — Close, or a Forge navigation, can land
while the rebuild or the remount's own reads are still in flight, and a check only right before
mounting missed that; the fix is one predicate, checked after every `await` on both the coordinator's
own side and inside `play()`'s read sequence, not a lock on anything. Second, one concurrent
`build:run` per project directory, refused rather than queued, in the main process — the only thing
that survives the Forge that started a build being destroyed mid-flight, and the only place
`generate.js`'s own `fs.rm(buildDir)` can actually be protected. Three limits were disclosed rather
than closed, all
pre-existing and none of this feature's making, and not all the same shape of problem: a build's own
status line is renderer-local, set directly by whichever call to `app.setStatus` happens to run
last, and `build:log`'s own broadcast (`main/ipc.js`, the one thing here that actually crosses the
IPC boundary) carries no request identity at all — either can still be overwritten or interleaved by
a later, unrelated build, and a project can still be edited while a build is running, exactly as it
always could. Only the last of those needs the heavy fix: closing it for real is an app-wide
operation lock across Save, project open/close and every editing surface — designed, costed and
rejected as a test-tool feature wearing an app-wide concurrency feature's clothes, not a gap left by
oversight. The first two are narrower and simply were not built: a request id threaded through
`build:log`'s own messages, and a status write that checks it is still the build that mattered
before landing, would close both without locking anything. Two real, pre-existing defects turned up
on the way
and are fixed alongside this rather than left for later: the status line could read "Playing from
`<screen>`" after a battle-test's own fallback discarded that landing and reloaded to the authored
start instead (`startedFrom` was never cleared on that path); and, before the directory gate above,
nothing stopped two builds targeting the same project from racing each other's `fs.rm(buildDir)`.

## 4. Cartridge save/load — **done**

Progression is impractical for anything substantial that cannot survive power-off, and the RPG mode
needs it most. Kept here for the reasoning rather than as outstanding work.

- ~~Battery-backed SRAM where the mapper permits it — which makes it a `shared/cartridge.js`
  question first, and `headerPatch()`'s problem after that~~ — **done**: a `battery` flag in the
  registry, which MMC1 and MMC3 carry, and iNES byte 6 bit 1 set the same way four-screen's bit 3
  already was, in preference to dragging either board into the NES 2.0 path UNROM 512 alone needs
- ~~**Continue** on the title screen~~ — **done**, as a Controller Forge binding in the title state
- ~~**Autosave** at explicit event checkpoints, rather than anywhere~~ — **done** in the form that
  matters: `Save the game` is an event command, so a checkpoint is wherever an author puts one, and
  there is no second "autosave" vocabulary to keep in agreement with it
- ~~A compact **save record**: location, switches, variables, inventory, party, levels, HP/MP, XP,
  gold~~ — **done**, and generated into `assets/save.inc` from `shared/save.js` rather than spelled
  out at both ends
- ~~**Checksum** plus a project/version identifier~~ — **done**, with the caveat that the identity
  is what makes loading a foreign save *unlikely*; the range checks on every loaded field are the
  actual guard, and every one of them is bounded by `NUM_*` rather than `MAX_*`
- One or a small fixed number of **slots** — still one. The only bullet here not built

The save record is a wire format between the engine and nothing else, but the single-writer rule
still applies: its layout belongs in one generated header, not spelled out in both `engine/` and
whatever writes it. Two things learned building it are worth carrying forward. Writing is ordered
marker-invalidate, body, checksum, marker-revalidate, so an interrupted write is always caught on
the next load — at the deliberate cost that it also takes out whatever save was already in the slot.
And the unit suite cannot prove any of the board-level part: the vendored jsnes core models no WRAM
enable or write-protect at all, so `test/lua/run_sram_check.sh` drives two real Mesen invocations
over a real power cycle against `sample-mmc1/` and `sample-mmc3/`, with `--break` modes that prove
the check can still fail.

## 5. An RPG Database Forge

Reusing actors as monsters and items is a genuinely clever economy, and it will not scale as the
system grows. Distinct compact records for:

- Items and key items
- Weapons and armor, and equipment slots
- Skills and their effects
- Status conditions (poison is already a status bit; this generalizes it)
- Enemy groups / encounter tables
- Classes, or selectable growth profiles

Start with **items, equipment and a few general status effects**. Not RPG Maker's whole database —
its size is a feature of a PC engine with no ROM budget, and `battletables.js` has to precompute
anything the 6502 would otherwise need a multiply for.

## 6. Cutscene and presentation commands

Event pages become dramatically more capable with a handful of presentation verbs, none of which
need anything the PPU cannot do:

- Move / turn / wait **routes** for an actor, with a preview in the Map Forge
- **Fade** in and out (palette ramp)
- **Screen shake** and **palette flash**
- Play a **sound effect** or music sting
- **Show / hide** an actor
- **Change a tile or metatile** on the current screen
- Basic **camera / scroll** control

Two engine constraints shape all of these: nothing but `text.asm` may write to the nametable while
rendering is on, so a tile change is a `vram_buf` packet capped at one row per frame; and a fade or
a flash is a palette write, which is a vblank job.

## 7. Map organization and reuse

The Map Forge already has stamp, rectangle, fill, picker, start and actor tools
(`renderer/forges/map/map.js:31`). What it lacks is everything about handling *many* maps:

- **Duplicate** a screen or a whole map
- **Copy/paste** a rectangular region
- Map **folders** or a tree
- **Reorder** maps safely, updating every warp and event reference
- **Named screens** (shared with item 2)
- A **world overview** showing starts, warps and event markers

Reordering is the one with teeth: screen indices are referenced by warps, doors and compiled event
bytecode, so the rename has to be a single operation over the project, and a test should assert no
reference survives pointing at the wrong screen.

## 8. NES-constrained asset assistance

The blank-page problem is real, and RPG Maker solves it mostly by shipping content.

- Generate four directions and two walk frames from modular parts
- **Palette-swap** an existing sprite into a new one
- **Validate** sprite size, palette count and tile budget as you draw
- A small **MIT/CC0 starter library**: terrain, UI, monsters, effects, sound effects
- **Starter projects** — action, dungeon crawl, RPG — beyond today's demo fixtures

Anything shipped here needs its license recorded in the repo, and the four existing fixtures stay
exactly as they are: tests are written against them and they may not be mutated. Only two of them
are demos worth starting from — `sample/` and `sample-rpg/`; `sample-mmc1/` and `sample-mmc3/` exist
to cover a board rather than to show a game, and are not what this item means.

## 9. Split-pane editing in the Code Forge

Hand-written 6502 in the Code Forge nearly always needs a second file in view.
`engine/constants.asm` is the single allocation map for zero page and the `$0300+` RAM arrays, so
it is the file you are reading while you edit any other one; a user file in `code/user/` wants the
engine routine it calls. Today the Forge is one editor behind a tab strip, so that is a tab flip
per address rather than a glance.

What already exists narrows most of this to a layout and active-selection problem rather than a
second editor implementation: the Forge already builds a separate editor instance per opened file
— `openFile()` and the `createEditor()` call in `renderer/forges/code/code.js` (around line 172),
with each instance kept on its own tab object — and only one is shown at a time, chosen by
`activeKey`. Showing two existing tabs' editors at once, side by side, is mostly deciding which two
and wiring a divider between them. One case does not fall out of that for free: an override and the
stock file it replaces are the same tab. `tabKey()`/`openFile()` key every engine file's tab as
`engine:<name>` regardless of whether it has an override, and `loadText()` resolves that one buffer
to the override text if one exists, stock otherwise (`findFile('overrides', name)?.text ?? (await
readStock(name))`) — so there is only ever one buffer for that name, and opening it twice does not
produce a stock pane and an override pane. Showing an override beside the stock it diverges from
needs a second identity for the same file (a read-only stock-reference buffer, say), which is extra
work this item would have to take on, not something the split delivers on its own.

- The editor is hand-rolled on purpose: no bundler and no runtime dependencies is the constraint
  that rules out Monaco and CodeMirror, not the CSP — CodeMirror 6 needs no `unsafe-eval` at all
  (`EditorView.cspNonce` only adds a nonce to its generated stylesheets), so the missing
  `unsafe-eval` is not even a supporting reason to exclude it. A split view gets built inside this
  zero-dependency architecture rather than imported.
- `editor.js`'s metric rule is per pane: the gutter, the highlight layer and the textarea must
  agree on every font and spacing value or the caret drifts off its character. Two panes means two
  sets of metrics that each have to hold, and a draggable divider changes the width under both.
- `flushPendingEdits()` already iterates every open tab, not only the active one, so
  `renderer/app.js`'s `saveProject` calling it before a save already captures whatever is typed in
  a pane that is not focused — that part does not need new work. What does: the debounce timer
  that schedules a tab's commit (`pendingCommit` in `code.js`) is a single shared timeout, not one
  per tab, so a keystroke in one pane cancels the other pane's pending commit before it fires. A
  save still catches both through the flush, but two live panes make it worth giving each its own
  timer rather than relying on flush to paper over the shared one.
- Undo has two layers, and the split has to keep their ordering sane, not just decide where the
  cursor lands. `undoInFocusedEditor` in `renderer/app.js` (around lines 345-380) sends Ctrl+Z to
  the focused textarea's own native undo stack first (`document.execCommand('undo')`), and only
  falls back to the shared project stack (`store.js`'s whole-project `structuredClone` snapshots)
  once that textarea's native history is empty. This ordering already exists today — an editor's
  DOM node and its native undo history survive a tab switch, so edit tab A, edit tab B, switch back
  to A and Ctrl+Z already undoes A's older native edit ahead of B's newer project commit — but one
  pane visible at a time keeps it out of sight, since you are never watching both files change at
  once. Two panes visible and being typed into make it obvious: undo in the focused pane exhausts
  *that pane's* own older keystrokes before it ever reaches the project stack, regardless of which
  pane made the most recent project-level commit, so a Ctrl+Z that looks like it should undo the
  change you just watched happen in the other pane instead undoes your own earlier typing in this
  one. The item needs an answer for that ordering, not only for where the cursor lands once a
  project-level undo does fire.
- The Build panel's error deep-link opens a file at a line (`openFile(kind, name, line)` and the
  app-level `openFile` at the bottom of `code.js`), which calls both `gotoLine` and `markLine` on
  the tab's editor. For an editable file `gotoLine` sets the selection before scrolling, because
  focusing a textarea scrolls it on the browser's terms; a generated `.inc` file is read-only, so
  `gotoLine` only scrolls, and the error stripe comes entirely from the separate `markLine` call.
  With two panes, something has to decide which pane a deep-link lands in either way, and the
  answer should not be "whichever was focused last" by accident.
- `renderer/ui.js`'s `observeSize()`/`fitZoom()` — the machinery the Tile, Sprite and Map Forges
  and the emulator use to recompute an integer zoom when their stage resizes — has no reason to
  reach the Code Forge. The editor's panes are ordinary flex/CSS-sized boxes, not integer-zoomed
  pixel canvases, so a divider can resize them with plain CSS and no resize handler at all. This
  only becomes a real constraint if the split's own design adds measured redraw work — reflowing
  the highlight layer against a pane's new pixel width, say — and even then it is a new instance of
  the rule, not a reason to route through `observeSize()` itself.

This is pure editor work — no engine change, no assembly, no kernel bytes, no capacity math,
exactly like item 2 was. That matters because the kernel-lo bank is the binding constraint on item
6's remaining cutscene commands — items 7 and 8 are editor and asset work with no kernel cost of
their own, same as this one — and this item is not subject to it at all.

## 10. The Map Forge's settings pane scrolls sideways — **done**

This is a bug the user hit, not a capability gap: the right-hand panel in the Map Forge — the one
holding the map's name, size, music, screen name and the "Actors on this screen" list — grows a
horizontal scrollbar, and everything in it should simply fit the column.

**The diagnosis below describes the code as it stood before the fix** — kept as the record of why,
not as a description of what ships today; see "Fixed" below for the current shape.

The cause was one specific row, not the panel in general. `renderEntities()`
(`renderer/forges/map/map.js:851-912`) builds a single `.field-row` (line 856) that packs the
"Actors on this screen (N/8)" heading and four buttons — `Find…`, `Switches…`, `Variables…`,
`Common events…` (lines 866-911) — side by side, in a `display: flex` row with no `flex-wrap`
(`app.css:370-374`). Only the four buttons are unable to wrap — `.btn` sets `white-space: nowrap`
(`app.css:160`) — the heading itself is ordinary wrapping text. Measured live via computed styles
against the 272px-wide right column (`gridTemplateColumns: '300px 1fr 272px'`, `map.js:1366`):
`.panel-body`'s own content box, after its 12px-a-side padding (`app.css:344-349`) and the ~16px
Chromium reserves for its vertical scrollbar once `overflow-y: auto` has something to scroll, comes
to 232px, not the ~248px a padding-only estimate would suggest. Against that 232px, the row itself
measures a 411px `scrollWidth` — an excess of about 179px — and that number is fully accounted for
by its five children's own rendered widths plus the row's `6px` gaps: the four buttons come to
53+77+79+118 = 327px of un-shrinkable `white-space: nowrap` content, the heading — `white-space:
normal`, so it wraps down to its longest unbreakable word rather than forcing width — still
contributes 60px, and 4×6px of gap adds the remaining 24px, for 327+60+24 = 411px, matching the
measurement exactly. `.panel-body` only declares `overflow-y: auto`; it never sets `overflow-x`,
but because one axis is `auto`, the CSS overflow property's own defined behavior computes the
other axis's initial `visible` value to `auto` as well — confirmed live (`getComputedStyle(body)
.overflowX` reads `"auto"`) — so the panel gets a horizontal scrollbar by that general rule, not by
any explicit choice about this content. No other row in the panel overflows — the "Screens across /
down" row's two number inputs and the "Map" row's select plus two buttons both fit; it is
specifically this one five-child row that doesn't.

The heading is not the cause, and giving it `flex: '1'` inline (`map.js:860`, overriding the
class's own `flex: none` that every other `.panel-head` in this Forge keeps — `map.js:1095`,
`1310`, `1313`, `1427`, all plain section titles as the sole child of their row) is what lets it
shrink to that 60px minimum instead of forcing its own full text width; without it, the row would
overflow by even more. The four buttons are the entire reason this row cannot fit: at 327px of
nowrap content plus the three gaps between them (18px), they alone already need 345px against a
232px budget — before the heading and the fourth gap that separates it from the first button
(60px + 6px = 66px) bring the row to its full 411px.

Re-arranging this means giving that row somewhere to put its buttons other than beside the
heading it's attached to — `flex-wrap: wrap` on the row so the buttons flow onto a second line
within the fixed-width column (the panel already scrolls vertically, so wrapped content is handled
for free), or splitting the heading onto its own line and letting the four buttons wrap as a
toolbar underneath it, which would also make it look like every other `.panel-head` in the file.
Either way the fix is contained to this one row and the panel it sits in: the right-hand column's
*width* is untouched by both options, so it does not touch `fitZoom()`/`observeSize()`
(`renderer/ui.js`) at all — those govern the *middle* column's `mapStage`, a separate grid track
from this one, and nothing about wrapping a row's height reaches across a `display: grid` root
into a sibling column. Verified live, not assumed: the map canvas's own zoom fit is driven by
`observeSize(mapStage, renderScreen)` (`map.js:1432`), which watches `mapStage` alone.

**Fixed: the second of the two shapes above** — the heading onto its own line, the buttons into a
wrapping toolbar underneath. `renderEntities()` (`map.js`) now emits the "Actors on this screen
(N/8)" heading as a standalone `.panel-head` with `{ style: { paddingLeft: '0' } }` and no `flex`
override, the sole child of its own row exactly like the other three headings in this file
(`map.js:1095`, `1310`, `1313`). The four buttons moved into a `.field-row.wrap` row underneath it,
same order, labels, `title`s and `onclick` handlers as before. The wrap behaviour is a modifier —
`.field-row.wrap { flex-wrap: wrap; margin-bottom: 12px; }` in `app.css`, next to the shared
`.field-row` rule rather than on it, so every other `.field-row` in the app keeps its un-wrapped
layout unchanged. `main/smoke.js` now asserts this holds: the settings panel body
(`#mapSettingsPanel`, an id added so the assertion can name that specific panel rather than the
first `.panel-body` the DOM happens to yield, which on this page is actually the *left* metatile
panel) measures a 271px `clientWidth` against the 272px right column, with `scrollWidth` no greater
than that — confirmed to actually catch the regression by reverting `.field-row.wrap` to a plain
`.field-row` and re-running: `scrollWidth` 357px against the same 271px `clientWidth`, the assertion
fails, and restoring the class makes it pass again.

## 11. The Sprite Forge's Actors page does not accept clicks — **done**

Also a bug, and the user's report of it is that they cannot click on anything on the Actors page.
The user's own hypothesis — that the animation preview playing is what causes it — is correct in
substance, though the actual mechanism is more specific than "an animation is running": the
preview clock is tearing down and rebuilding the exact controls the user is trying to click, on a
cadence this item works out precisely below — and, separately from clicking, destroying whatever
currently has focus every time it does.

**The diagnosis and cadence analysis below describe the code as it stood before the fix**
(`511a149^`) — kept as the record of why, not as a description of what ships today; see "Fixed"
below for the current shape. Every line number cited between here and "Fixed" is relative to that
pre-fix commit, not current code — `state.previewTime`/`state.previewFrame` in particular no longer
exist, having been split into the separate `state.actorPreview`/`state.animPreview` clocks the
"Fixed" paragraph describes.

`state.playing` defaulted to `true` (`sprite.js:36`) and there was no control to turn it off from
the Actors page — the only `Play` checkbox that touches it lives in the Animations tab's own pane
(`renderAnimationPane`, `sprite.js:569-583`). `loop()` (`sprite.js:913-929`) runs every animation
frame regardless of which tab is open; once the current frame's duration elapses it advances
`state.previewFrame` and, for any tab but `metasprites`, calls `render()` (line 927) — which
covers `actors` (and, by the same blanket condition, `party`). `render()` (`sprite.js:896-909`)
calls `renderActorPane()` for the Actors tab, and that function does not merely repaint a preview
canvas: `fill(listHost, …)` (line 606) and `fill(detailHost, …)` (line 800) rebuild the *entire*
actor picker, the `+`/`✕` buttons, the Name/Behaviour/Speed/HP/Contact-damage fields and every
animation-slot `<select>` from scratch on every one of those ticks. `fill()`
(`renderer/ui.js:52-54`) is `clear(node)` — which removes every child — followed by a fresh
`append()`; there is no diffing, so this is a literal destroy-and-recreate of the DOM nodes under
the pointer, not just a re-render of their contents. That breaks the page two independent ways.
First, clicking: a `click` needs the same element to receive both `mousedown` and `mouseup` for
*that element's own* handler to fire — if the two land on different elements the browser may still
synthesize a `click` on a common ancestor, but the button that was actually pressed is gone by
`mouseup`, so its `onclick` (the thing that would add the actor, or delete it) never runs
regardless of what bubbles where. Second, typing and selecting: rebuilding also
destroys whatever currently has focus even when a click *did* land cleanly — the Name text input
(`sprite.js:692-698`), the Behaviour/animation-slot `<select>`s (700-709, 752-778) and the
Speed/HP/Contact-damage number inputs (710-743) are all torn out and recreated by the same
`fill(listHost, …)` call, so a field the player has just focused, or a `<select>` currently showing
its open dropdown, can be yanked out from under them mid-interaction independent of whether any
click failed at all.

The cadence is real but throttling-dependent, so it is worth being precise about what is fixed and
what varies. `state.previewTime` advances once per `requestAnimationFrame` callback, not per
elapsed wall-clock time, so a frame's `duration` — authored per animation frame, clamped 1-255 with
a default of 8 (`shared/project.js:1369`) — counts *rendered frames*, not milliseconds, and the
real-world rebuild interval is `duration / callback rate` — the rate `requestAnimationFrame` is
actually delivering, not the display's physical refresh rate, which the browser is free to
throttle it below. `loop()` tracks exactly one animation at a time — whichever actor is currently
selected — so there is no scenario where several animations' rebuilds compound; the interval is
set entirely by that one animation's duration and however fast callbacks are arriving. In the
ordinary, focused, foreground case the callback rate tracks the physical refresh rate directly, so
for the sample project's own Slime idle animation (two 16-tick frames — `sample/sprites.json`),
that is ~267ms at an ordinary 60Hz display, or ~133ms at 120Hz; the shortest legal duration of 1
would rebuild on every delivered callback regardless of what that rate is. A live measurement in
this session's own automated test window caught the "+" button replaced by a new DOM node 11 times
in 1.5 seconds — about 136ms apart on average. Dividing that by the 16-tick duration gives a
callback rate of roughly 117/s, not explained by "more than one animation" (`loop()` only ever
tracks the one) but consistent with an unthrottled ~120Hz foreground window. A second attempt at
the same measurement, moments later in the same environment, caught only 0-2 replacements over as
long — the same physical display, but a collapsed callback rate — alongside `document.hasFocus()`
reading `false` while `document.visibilityState` stayed `"visible"` (not hidden), consistent with
Chromium throttling `requestAnimationFrame` for a window that has lost input focus, though this
session's own instrumentation didn't isolate the exact mechanism responsible, only the correlation.
That divergence is exactly why the formula has to be stated against the callback rate and not the
refresh rate: the physical display never changed between the two measurements, only the rate
`requestAnimationFrame` was actually delivered at. So the defensible claim is `duration / callback
rate`, with 60Hz/120Hz as what that rate equals in the unthrottled, focused case — not a single
generalized millisecond number, and not an assumption that the display's rated refresh always
applies.

Severity: this is not a roadmap nicety, but the two failure modes above are not equally severe, and
the item should not blur them together. Focus/selection loss is deterministic and unconditional:
every rebuild destroys a focused text input or an open `<select>` regardless of timing, refresh
rate, or luck, so any field edit that outlasts one rebuild interval is disrupted every time. Click
loss is probabilistic: only a click whose `mousedown`-to-`mouseup` window straddles a rebuild loses
its handler. At 60Hz with the sample project's 16-tick duration (~267ms between rebuilds), nothing
established here shows a *majority* of clicks being lost — an ordinary deliberate click is well
under 267ms, so most single clicks should land clean at that rate. That is short of what the user
actually reported: not "some clicks fail," but that they could not click on anything on the page at
all. Two things could close that gap, and this item should leave the question open rather than pick
a side to make the story tidy: a high-refresh display roughly halves the interval for every step up
(~133ms at 120Hz, proportionally less at higher rates still), which alone narrows things
considerably without fully explaining a *total* loss of interaction; or something beyond the
mechanism traced here — a shorter-duration animation on the user's actual project, repeated
rebuilds compounding with the focus/selection loss into something that reads as "nothing works" even
when individual clicks are landing, or a factor this investigation didn't find — is also doing work.
Either way, an actor with any short-duration idle animation (which the schema's own default of 8
and every actor in the sample project both make the ordinary case, not an edge case) makes its own
settings page fight the pointer and the keyboard several times a second while genuinely focused,
which is unambiguously a real defect regardless of exactly how it adds up to "unusable" — the fix
should confirm, rather than assume, which of the above accounts for the reported severity.

What fixing it costs: the loop only needs to repaint the preview surface — `drawPreview(editCanvas,
…)`, already called at the end of `renderActorPane()` (line 804) purely from canvas pixels, costs
nothing structurally. The expensive part, `fill(listHost, …)` / `fill(detailHost, …)`, has nothing
to do with which animation frame is showing and should only run when the underlying data actually
changes — an actor added, renamed, or its fields edited. That means separating "advance the clock
and repaint the canvas" from "rebuild the panel" in `renderActorPane()`, and giving `loop()` a
narrower reason than `state.tab !== 'metasprites'` to call the expensive path at all — that blanket
condition also reaches the `party` tab, but `renderPartyPane()`/`partyPanel()`
(`sprite.js:834-835`, `battle.js:186`) has no animation preview of its own to advance in the first
place, so the fix there is simply for `loop()` to stop rendering it, not to give it a pause control
it has no use for.

**Scope correction: this is not the Actors page's bug alone.** `renderAnimationPane()`
(`sprite.js:419-590`) has the identical shape — `fill(listHost, …)` rebuilds the frame list and
`fill(detailHost, …)` rebuilds the `Play` checkbox itself on the same tick, which means the one
control that could stop the churn was itself getting torn down and recreated by it. The fix covers
both tabs, with the pause control resolved the same way it is asked above: `state.playing` pauses
only the Animations tab's own preview, since that is the tab whose control it is; the Actors tab has
no pause control and its preview always runs, which is harmless once a tick only repaints a canvas.
The two tabs also keep separate clocks (`state.actorPreview` / `state.animPreview`, each its own
`{ time, frame }`), not one shared counter gated per tab — otherwise stepping the Actors preview
while Animations sat paused would still move the frame Animations shows on return, and "paused"
would only have held for as long as the user never left the tab.

**Fixed**, in two commits. `511a149` shipped the separation above — `stepPreview()` now calls
`advancePreviewFrame(animation, clock, repaintFn)`, which advances the clock every tick but calls
`repaintFn` (`repaintActorPreview()`/`repaintAnimationPreview()`) only on the tick where the clock
crosses into a new displayed frame. Those repaint helpers redraw `editCanvas` alone for the Actors
tab and both `editCanvas` and `previewCanvas` for Animations, and also carry the identity check that
resets a clock on a genuine selection change — the animation object reference currently being
previewed changing rather than a selection index merely staying in range — so they are not pure
canvas painters, but neither the tick path nor the helpers it calls reach `render()` or the `fill()`
calls anymore. `fill(listHost, …)`/`fill(detailHost, …)` still run wherever they always did outside
the tick — non-exhaustively: initial mount, a tab switch, an actor or animation selection change
(both call `render()` directly from their `<select>`'s `onchange`), a resize-driven `render()`, and
an actual project edit — they simply no longer run *on the tick itself*. `ce7e2b8` closed a gap
that identity rule left open: the Actors
tab was tracking only the resolved idle *animation*'s reference, not the actor's, so two actors that
happen to share one idle animation — Slime and Hunter both point at animation 0 in the sample
project — resolved to the same object and left the preview clock unreset when switching between
them. `repaintActorPreview()` now compares both the actor object and its resolved animation,
resetting on either changing.

---

## Suggested order

1. ~~Event names, list and search; duplication; templates; play-from-here — item 2 plus the first
   piece of item 3~~ — **done**
2. ~~Variables, branching, choices, triggers, common events — item 1~~ — **done**: `EVENT_COMMANDS`
   and `IMPLEMENTED_COMMANDS` in `shared/project.js` are now identical, eighteen commands to seven
3. ~~SRAM save/load — item 4~~ — **done**, one slot
4. Items, equipment, status effects, battle testing — item 5 plus the rest of item 3
5. Movement routes and the audiovisual cutscene commands — item 6

**The kernel bank is the constraint on everything below this line, and it is close to full.** Move
found it: ~395 bytes against 161 free on the worst battery board, and it only shipped by becoming
conditional. A project with both Save and Move reserves 7924 of 8192. Item 6 is five more verbs of
kernel code — fade, shake, sound effect, show/hide, tile change — and conditional assembly does not
compose indefinitely, because a project that wants three of them is back where it started. The next
one of them needs a decision first: a kernel diet, or a second banked region the way the battle
system got one. Item 5 is mostly tables and editor work and is not blocked on that.

The rest of item 3 also has a better claim on being next than its position suggests, for the same
kind of reason it was cheap: none of the remaining bullets cost any ROM either. Item 1 made 64
switches and 16 variables the backbone of every condition, branch and question, and item 3's
switch/variable inspector — above — is now the labelled way to watch them at runtime, rather than
unlabelled bytes in the memory editor. Battle-test and the invincibility/encounters-off/collision-off
toggles get the same outside-the-ROM honesty pattern the inspector just settled a second time — a
poke or PC redirect through `emulator.peek`/`emulator.poke`/`emulator.configureTestOverrides` that
never reaches the ROM, so a reset restores exactly the RAM the game itself set — but each is still its
own engine problem: `player_iframes` counts down every gameplay update rather than staying poked, so
invincibility traps `update_player`'s own entry rather than a fixed point in the frame; encounters and
collision have no such byte to hold at all and instead redirect execution past `check_encounter` and
`probe_solid`; and Battle-test has to invoke `battle_begin` with a prepared formation. **The toggle
itself is debugger configuration, not game state, so — like a breakpoint — it survives a reset rather
than being cleared by it**: only the RAM/ROM half of the honesty rule is what a reset restores, and the
checkbox stays visibly on so nothing is silently still active. None of that is settled by the
inspector.

Item 9 costs no ROM either, for the same reason: it is pure editor work, so it can land at any
point in this order without waiting on the kernel-bank question above. Items 10 and 11 were bug
fixes in that same ROM-free, kernel-free renderer code, which is why neither needed to wait on a
particular stage — and both are now fixed: item 10 above, item 11 in commits `511a149` and
`ce7e2b8`.

Stages 1 and 2 are the ones that change what the app *is*: together they move Forge from a capable
NES construction toolkit toward building a complete game mostly through data and menus — with the
Code Forge still there as the escape hatch, which is the point of having it.
