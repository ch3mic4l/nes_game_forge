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
  hardware cannot show. Better map *organization* (item 7, now shipped) bought far more per unit of
  work than layers would have.
- **A full character generator.** RPG Maker's is enormous and assumes arbitrary bitmaps. The
  NES-shaped version of the same idea is item 8, and it is much smaller.

Ordering: items 1 and 2 are where the leverage is. 2 is cheap and touches no ROM; 1 is the one that
changes what a non-programmer can build.

---

## 1. Event system 2.0

The vocabulary was the constraint. When this was written there were four page conditions
(`EVENT_CONDITIONS`) and seven commands (`EVENT_COMMANDS`, minus `end`) in `shared/project.js`, and
quests, shops, puzzles, cutscenes and boss fights were all reachable only through the Code Forge.
There are now seven conditions and 21 commands, and every one of them is implemented end to
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

## 3. Test-play tools — **done**

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
  decision above is recorded here, in this roadmap, not there. **The revisit has since happened:**
  item 7's design (`handoff-maporg/design-maporg.md` §5) considered a persistent opaque id per
  map/screen/actor again, for exactly this reordering, and declined it a second time — reorder,
  duplicate, delete and resize are all a pure renumber over the flat/map/per-map index spaces, no new
  identity field on `project.maps[]`/`map.screens[]`. `saveCompatToken` (§6.10) is explicitly not
  such an id: a project-wide, independently-redrawn nonce for the save record's own compatibility
  check, not a per-map or per-screen identity. Ordinary
  ▶ Build & Play still means only the project's own
  authored start, deliberately and unconditionally — Map Forge's play-from-here and battle-test
  buttons go through a separate entry point, so the ordinary button can never start meaning something
  else depending on session history nothing on it shows. The three toggles above are re-armed against
  the new build the same way; whichever one the new build cannot support is reported by name —
  reusing `toggleUnavailableReason`'s own sentence, not a second vocabulary for it — and cleared from
  the remembered scenario rather than silently retried on every later reload or silently re-enabled
  the moment a later build happens to support it again
- ~~**Screenshot / GIF capture** from the emulator panel~~ — **done**: 📷 Shot and ⏺ Record in the
  player's own toolbar, both unconditional — unlike ↻ Reload Test above, neither has anything to do
  with a test scenario — saving through the same `files:writeBinary` IPC the Tile Forge's CHR and
  palette export already used, so there is no new IPC channel and no capture-specific main-process
  code (that file did gain a try/catch — see the defects fixed on the way, below). The honesty rule
  is satisfied trivially here and worth saying anyway: both capture what the player already drew,
  nothing is poked, nothing is compiled, and the ROM is never read. Shot writes the canvas at its
  native 256×240 through `canvas.toBlob`, deliberately unscaled: the zoom control is a viewing
  choice and *Fit* depends on the window's size, so scaling by it would make one button produce a
  different file depending on how big the window happened to be. Record needs a GIF encoder, and the
  same constraint the Code Forge's editor hit applies — no runtime dependencies, no bundler — so
  `renderer/emulator/gif.js` is one, about 300 lines of LZW and block framing, with
  `renderer/emulator/capture.js` holding the recorder's own policy beside it. Neither is in
  `shared/`: both are DOM-free and Node-free and `node:test` imports them directly, but `shared/` is
  for facts the main process, the renderer and the tests must all agree on, and neither of these is
  one — calling them shared would claim a constraint that does not exist. **The encoding is
  incremental, and that is the load-bearing decision**: encoding 300 buffered frames at Stop is a
  multi-second freeze, while encoding each frame as it is captured spreads the identical work across
  the recording at 20 Hz and makes the recorder's memory the compressed output rather than 300 raw
  frames (74 MB). Everything else follows from doing it live — the global colour table is built as
  colours are discovered and written at the end (indices are only ever appended, so a table that is
  still growing cannot invalidate anything already encoded), the table is always emitted at its full
  256 entries and every image declares LZW minimum code size 8, because the code size is written
  into each image block long before the final table size is known; each frame is its own LZW stream,
  Clear first and EOI last, with a Clear whenever the code table reaches 4096; and a colour arriving
  after the table is full maps to the nearest one already in it by squared RGB distance, cached by
  colour so a repeated arrival costs a lookup rather than a 256-entry scan. That fallback is
  defensive rather than reachable: the eight emphasis tables the vendored PPU builds over the
  64-colour palette collapse to 233 distinct RGB values once the emphasis factors round, so nothing
  this emulator can put on screen fills a 256-entry table, and only synthetic test input exercises
  the substitution at all. It is written and tested anyway because "fewer than 256" is a property of
  the current palette tables rather than of the format, and the alternative to substituting is
  refusing a recording after fifteen seconds of it. Frames are diffed to a bounding box with
  disposal method 1; **transparency was deliberately not used**, though it would compress better,
  because it needs a permanently reserved index that nearest-colour matching must never return and
  getting that wrong punches holes in the picture — bounding boxes carry most of the benefit with
  none of that failure mode. A frame identical to its predecessor still writes a 1×1 sub-image of
  that pixel's own colour, a visual no-op, because dropping it would silently shorten the
  recording's own clock. The rate is a compatibility choice, not an arithmetic one: GIF's delay unit
  is 1/100 s, so 60.0988 fps has no uniform delay at all, and while alternating 1 and 2 cs would
  approximate its average on paper, short delays are exactly where decoders disagree — Chromium's
  own treats 2 cs as its floor and other implementations pick different thresholds. Every third
  frame is 20.03 emulated frames a second, and a uniform delay of 5 plays them back at 20 — 0.16%
  slow, at a delay comfortably clear of the short-delay thresholds decoders disagree about. What
  gets kept is *emulated* frames, however they were produced: Record keeps the frame already on
  screen immediately, so a recording stopped at once is a one-frame GIF rather than an empty file;
  pausing records no gap; and `stepAnd`'s own `writeFrame` — the presentation-only push that makes
  single-stepping visible — is excluded by a flag, or the Frame button would record a duplicate and
  an instruction step would record a *partial* frame. `onFrame` itself only copies a due frame onto
  a queue and encodes nothing: it runs inside `emulator.runFrame()`, possibly several times per
  animation callback, and an exception thrown there is caught by the run loop and shown as
  `Crashed:` — a recorder bug wearing an emulator crash's clothes. `drainCapture()`, called after
  the frame loop and after a step, does the indexing and the LZW inside its own try/catch, so a
  capture failure stops the recording and says so while the game keeps running. The queue is bounded
  at eight frames rather than the four `tick()` can owe, because `stepOver`/`stepOut` can complete
  many frames before returning, and overflowing it **stops the recording with its own reason**
  rather than dropping frames (which corrupts the clock) or holding 74 MB. The 300-frame cap is
  named in the toast for the same reason: a cap nobody mentions looks like a bug when the recording
  ends by itself, and either reason is now toasted *before* the save is attempted, not after it
  succeeds — a cancelled dialog left the recording stopped with no explanation at all. A recording
  in flight is discarded, with a toast, on teardown and explicitly at the top of ↻ Reload Test's own
  handler before it awaits anything, because a *failed* reload keeps the existing player alive and
  teardown alone would leave a recording running across a rebuild it cannot represent. **The most
  useful thing this bullet produced is a test, not a feature.** `test/lib/gifdecode.js` is a GIF
  decoder written against the spec, and the unit tests decode what the encoder produced and assert
  every composited frame is pixel-identical to what went in — except the one case that cannot be, a
  frame carrying more colours than the table holds, where the nearest-colour substitution is
  asserted against an independently computed expectation instead — but the encoder and that decoder
  were written by the same agent in the same sitting, and the LZW code-width growth rule had to be
  changed in *both at once* to make the round trip pass. That is a bug shape a round trip cannot
  see: a pair wrong in the same direction passes every round-trip test of ours while producing a
  file no decoder but ours has any reason to accept. So the smoke test decodes the recording a
  second time with **Chromium's own `ImageDecoder`**, and the planted proof is exact — the
  code-width rule was deliberately shifted one step early on both sides, the then-current 562-test
  unit suite and the round-trip smoke check both passed straight through it, and Chromium's decoder
  rejected the file outright. Node has no image decoder so this cannot be a unit test, but the smoke
  test is already a real Chromium, and a decoder written by nobody in this repository is worth more
  here than any number of round trips through our own. Two real pre-existing defects were fixed on
  the way: `files:writeBinary` and `files:readBinary` had no try/catch, so a dialog or filesystem
  throw rejected the invoke instead of returning `{ok:false}` — an unhandled rejection and a lost
  capture — and the Tile Forge's own CHR and palette export, which only ever looked at the success
  case, had to learn to show the error that conversion now hands it; and `main/smoke.js` had been
  finding the *hidden* one of the two "↻ Reload Test" buttons that exist in the DOM at once (the
  Build panel's and the player's). That still reached the reload itself, so the step looked like it
  worked — what it silently skipped was everything the visible player button's own handler wraps
  around it, which is now where the recording is discarded. One limit is disclosed rather than
  closed: the `fail(error)` conversion in `main/ipc.js` is not covered by any test, because reaching
  the real handler means opening a real native dialog — the smoke test replaces that handler in the
  main process precisely so the bytes the real button sent can be decoded and compared, which is the
  trade that made every other assertion here possible.

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

Staged in six phases. Phases 1 and 2 landed in the opposite order to their numbering — the
renumbering defects were found while scoping the rest and fixed first, so phase 2's commit precedes
phase 1's. Phases 1 through 5 are now built; phase 6 (docs) is current for the developer-facing half
and still owes an author-facing sentence.

- ~~**1. A capacity check for the banked battle region**~~ — **done** (`f7f3f28`). The 8 KB region
  `codeRegions()` takes off the switchable window had no bound on it at all: overflowing it was
  reported by nesasm against whatever line fell past the end, which is exactly the raw assembler
  output this project's capacity checks exist so nobody sees. `battleRegionBytes`/
  `battleRegionCeiling` (`main/build/battletables.js`) bound it, with per-board base constants, a
  Build-panel meter, a generated `.fail` backstop and a warning for the relocating override neither
  can catch. It comes first because everything below adds tables to that region, and adding to an
  unbounded bank is how the overflow arrives unexplained. CLAUDE.md's *The battle system* section
  carries the reasoning; it is not repeated here.
- ~~**2. Three references that survived an actor deletion**~~ — **done** (`5e103f4`). `battle.drop`,
  a `Carrying` condition and a map's encounter table each silently re-pointed at whichever actor
  slid into the vacated number. Fixed before the database work rather than after, because phase 3
  moves two of those references to a new id space and carrying a known repointing bug across that
  move would make it far harder to see.
- **3. `project.items[]`, and nothing else.** The schema, `normalizeProject`, the actor/item
  discriminator, the migration and its compatibility matrix, `validateProject`'s rules, and
  `renumberItemDeletion` — with `battle.drop` and Give/Take **moved out of** `renumberActorDeletion`
  rather than duplicated, since two functions renumbering the same reference is how the two answers
  drift apart. Plus the metasprite-deletion coupling and `firstPickup()` in `templates.js`.
  Deliberately **no engine change**: the ROM should assemble byte-for-byte identically at the end of
  this phase, which is a check worth actually running.
- **4. The engine side.** Turned out to need its own budget prerequisite and then a split, once real
  measurement (below) showed why — three slices, not one:
  - ~~**4a. The kernel budget prerequisite**~~ — **done** (`9eda25f`). A titleless RPG was being
    charged 212–224 bytes of kernel-lo for title-screen code it never assembled
    (`BASE_KERNEL_CODE_BYTES_BY_MAPPER` had baked in a title-on measurement unconditionally). Phase
    4 could not be designed against a budget that was wrong by that much, so this had to land first.
  - **4b. The id retarget.** — **done**. The bag holds item ids instead of actor ids; item tables
    (icon, name — the enabled-path `mon_heal`/`mon_name` siblings, `item_heal`/`item_name`, at this
    point in the history still sourced from the backing actor's own `battle.heal`, unchanged from
    the actor-reuse economy — 4c below is what later moved `item_heal`'s own source onto
    `items[].effect` directly, once that field existed to read); **both** pickup paths retargeted
    (`entity_pickup` *and* `do_interact` — the second is the one that gets forgotten); Give, Take,
    drops and Carrying compile to the item id directly; the save bound retargeted, with
    `SAVE_LAYOUT_VERSION` 1 → 2. `use_item` itself is untouched by this slice — it never read what
    the bag byte meant, only shifted and counted it, so retargeting what the byte means cost it
    nothing, which is what let this land as a self-contained slice rather than needing 4c alongside
    it. See CLAUDE.md's entity-record paragraph (`ent_to_scr`) and its
    kernel-budget section (`ITEM_KERNEL_ALLOWANCE`) for the mechanism and the real, measured cost.
  - **4c. The effects.** — **done**.
    `items[].effect` is `{kind, amount}` (`none`/`heal`/`damage`, `ITEM_EFFECT_KINDS` in
    `shared/project.js` the wire format for `EFFECT_*` in `engine/constants.asm`), migrated once at
    normalization from the backing actor's `battle.heal`. `use_item` (`engine/ui.asm`, every game
    type) now reads it before spending anything: a `none`-kind item is a key item, kept rather than
    spent; `heal`/`damage` apply through whichever health model the build has (`BATTLE_ENABLED`:
    `party_heal`/`party_damage`; otherwise `gain_hearts`/`lose_hearts`) and are spent either way, no
    third health model invented. `use_item_apply` returns a three-state result rather than `jmp
    player_died` on a lethal hit itself — the return-address trap the phase's own design review
    (§9) had already found and corrected in the design document, before any of this was written; the
    implementation never carried it, and the only time the buggy shape actually ran was a deliberate
    sabotage rebuild during review, to confirm the regression test catches it. Round 4c review found
    CLAUDE.md's own 6502-traps list crediting this to an "early version" as if it had shipped and
    been caught in testing — that section is explicitly traps that "cost real debugging time," which
    this one never did, so the entry was removed from that list rather than reworded; the mechanism
    itself (why `use_item_apply` must never `jmp player_died` and `use_item` may) is described
    accurately in CLAUDE.md's item-semantics section instead. The battle
    item list (`build_item_list`, `engine/battleui.asm`) filters to `kind == heal AND amount > 0`,
    and `battle_menu_item` decides whether to open Items from that filtered count rather than the
    raw bag count — the second thing design review flagged, also fixed before implementation, also
    never shipped broken. Two small item-conditional capacity terms came out of measuring rather
    than estimating this: `ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE` (kernel-lo, split by game type
    because `BATTLE_ENABLED` picks a differently-sized damage branch, not because any board differs)
    and `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` (17 bytes, the banked battle-code region, uniform across
    boards). See CLAUDE.md's item-semantics section for the full mechanism and the kernel-budget
    section for what this closed and reopened on MMC3. Round 4c's own review left one piece of
    verification outstanding — no test proved `item_chosen`'s own `bt_list,x` read
    (`engine/battleturn.asm`) maps a selected, filtered row back to the *correct* item id when the
    bag holds a non-contiguous mix of listed and filtered-out items, confirmed by sabotage that
    reading `inv_items,x` directly instead was caught only by the items-disabled pinned
    byte-identity hash, which fires on any ROM change at all and asserts nothing about the mapping
    itself. Round 5 closed the row and removal half: a bag whose accepted items sit
    non-contiguously in the bag (rejects interleaved between them) and in non-ascending id order,
    selecting a non-first row with real D-pad input rather than a poke, asserting the bag closed up
    over the right slot — sabotage confirmed both a `bt_list,x` → `inv_items,x` substitution and a
    build that sorted the accepted ids by value are each caught. That round's own amount-applied
    assertion did not yet earn its claim, though: the selected item was `sample-rpg`'s own item id 0
    (Potion), so `item_heal`'s unindexed byte 0 happens to be the right answer regardless of whether
    `item_heal,y` is actually indexed by the chosen item — round 6 review caught this by sabotaging
    exactly that read (`lda item_heal,y` → `lda item_heal`) and finding all tests still passed.
    Fixed by excluding item 0 from the bag entirely and using two freshly authored items with
    distinct nonzero ids and distinct amounts, so an unindexed read, a substitution, and a sort each
    produce a different, wrong, and now-caught answer. Phase 4c's own §8 test deliverables are now
    all built: the effect half of deliverable 3 (a phase-3-shaped item, no `effect` field at all,
    migrating correctly and building into a working item) was the other genuinely outstanding one
    and is now covered too — deliverable 4 (direct `NUM_ITEMS` save-bound coverage) turned out to
    already exist in `test/unit/save.test.js` from an earlier round, not outstanding as this
    paragraph once had it.
- **5. The Items Forge** — **done**, for items. A dedicated Forge (`renderer/forges/items/items.js`,
  registered in `renderer/app.js`'s `FORGES`, not a page inside a larger shell) rather than the
  multi-domain "Database Forge" the phase's own framing first imagined — name, effect (kind and
  amount) and the linked Pickup actor ("Collected from") are all authored there. Equipment, skills,
  status-condition generalization, encounter tables and classes/selectable growth profiles — the
  rest of this phase's original scope (line-for-line, above) — are not built and stay open roadmap
  items of their own if this generalizes further.
- **6. Docs** — **done**. The developer-facing half (CLAUDE.md, this file) is current as of phase
  4c's own implementation. The author-facing half now has a standing, true sentence in three places
  an author actually reaches: the Map Forge's own Save-command hint
  (`renderer/forges/map/events.js`), the README's Saving section, and a passive note in the Build
  panel's Cartridge panel that only appears on a project with a live Save command. All three say the
  same thing — a Forge update, or a structural change to the project (its maps, screens, actors, and
  so on — not its content), can make an existing save incompatible, and Continue then simply stops
  appearing with no message — which is the claim `saveIdentity()` (`shared/save.js`) actually backs:
  it folds `SAVE_LAYOUT_VERSION` and structural counts, not ROM bytes or project content, so two
  projects (or two builds of one project) that agree on every count it folds in still pass its check
  every time, by construction, regardless of how different their content is — an earlier draft of
  this sentence said "the exact build that wrote it," which is false for exactly that reason, and was
  corrected before anything shipped. None of the three names a version number, matching
  `SAVE_LAYOUT_VERSION`'s own role as an internal mechanism an author never needs to track by hand.

  `validateProject` was considered and rejected as a fourth surface — not because it is structurally
  unable to condition on anything (it already gates a validation error of its own on
  `projectUsesSave(project)`, `shared/project.js:2982` — a Save-using project on a board with no save
  medium), but because a standing, unconditional warning on every Save-using project belongs to a
  channel meant for things the author must fix, and this is neither: `validateProject` has no save
  file to look at, so it cannot say whether *this* author's *next* build will actually break *an*
  existing save, only that the capability for that exists in general — noise dressed as a finding.

  What this satisfies, and what it deliberately does not: the author is reachable, but only
  proactively — at authoring or build time, never at the moment of actual confusion, which happens
  outside the app (in Mesen, or on real hardware, after a later rebuild). The player is not reachable
  by any author-facing text at all — nothing shipped here changes the ROM. A player who loses
  Continue gets the one signal the engine already gives for free: the title's prompt differs. A
  considered, costed option to make that signal say something more specific is recorded below
  instead of built.

Two constraints shaped phases 4 to 6, and both were cheaper to know up front than to rediscover —
one is now a measured fact rather than a forecast:

- **The kernel-lo bank had almost nothing left on MMC3.** `sample-rpg` with a live `Save` and a live
  `Move` reserved exactly `KERNEL_SLACK` and no more, before phase 4 existed. It needed its headroom
  measured before phase 4 was designed, not after it failed to assemble — and the measurement said
  so precisely: `ITEM_KERNEL_ALLOWANCE` is 16 bytes, real and unconditional the moment a project has
  any item, which is more than that margin had. `sample-rpg` with a live `Save` *and* a live `Move`,
  on MMC3, was refused by items in 4b, and closed again within the same phase by a kernel diet in
  `engine/player.asm` — the four movement direction routines' identical two-corner probe-and-commit
  tail, collapsed into one shared routine per axis, recovering 70 bytes on every RPG-capable board.
  That headroom (**74 real bytes free**, not merely the single spare byte it had before items
  existed) was real but not durable, and the prediction that it wouldn't last came true within the
  same phase: 4c's own `use_item_apply` spent it, and this exact combination — `sample-rpg` with a
  live `Save` *and* a live `Move`, on MMC3 — now refuses again, by 11 bytes
  (`kernelCodeBytes` = 7665, "the lookup tables need 129 bytes but only 118 are free" — both re-measured
  against the current tree; `battle_end`'s own talk_ent fix, item 6's Turn/Wait slice, is unconditional
  kernel-lo cost on every RPG build, including this one). Unlike the
  two earlier reopenings on this board, this one was not chased with another diet: it is accepted as
  a documented limitation, the same way UNROM 512's own `Save`+`Move` shortfall already was —
  `checkCapacity`'s own advice (drop every `Move`, or every `Save`, or switch to MMC1, which still
  builds this combination with room to spare) is what an author in this exact corner is told. See
  CLAUDE.md's own kernel-budget section for the arithmetic and why each closing and reopening has
  been the mechanism working, not a hole in it.
- **`SAVE_LAYOUT_VERSION` 1 → 2 breaks existing saves.** That was a deliberate choice, not a silent
  migration, landed in 4b rather than deferred to phase 6: the capability exists in the engine the
  moment 4b ships, so the break has to be unconditional and immediate, not phased in alongside the
  Database Forge. An old save is treated exactly like a foreign one — no message, no crash, Continue
  simply is not offered. Phase 6 closed the author-facing half of this (above): three surfaces state
  the standing rule — a Forge update or a structural project change can invalidate a save — with no
  version number anywhere an author sees it, since the number is exactly what `saveIdentity()`
  (`shared/save.js`) exists to make unnecessary for anyone to track by hand.

  A player-facing ROM string was considered for the same gap and deliberately not built, the same way
  CLAUDE.md's own AxROM/MMC5 mappers and its flash-save slot ring were each costed and declined rather
  than merely skipped. `title_pick_prompt` (`engine/title.asm`) already branches on `save_check_valid` and
  picks one of two prompt strings, so a third, generic string — something like "NO COMPATIBLE SAVE"
  in place of the plain Start prompt — would need no reason-tracking (`save_check_valid`'s own
  pass/fail has no cause to distinguish between, and a truthful generic string does not have to invent
  one) and no migration path of its own.

  The string itself is not the constraint an earlier draft of this entry claimed. It is new text data
  compiled into `assets/text.inc`, which `engine/main.asm` includes after `assets/kernel_hi.inc`'s own
  `.bank`/`.org $E000` — the kernel-**hi** bank, not the kernel-lo bank the 11-byte MMC3
  Save+Move+item shortfall (CLAUDE.md's own kernel-budget section) actually belongs to. That draft cited
  the kernel-lo shortfall as this string's cost; it is simply the wrong bank, and the error is corrected
  here rather than left standing. Measured instead: `sample-rpg` with a live `Save` and its one live
  item, titled, on MMC3, leaves kernel-hi (bank 31, `$E000`) at nesasm's own reported
  **`385/7807`** (used/free — the 8192-byte bank size is nowhere in nesasm's own line; it only ever
  reports used and free, which sum to it). Adding a live `Move` command changes kernel-hi by exactly +4 bytes (confirmed by
  building the same project with and without `Move` on MMC1, the one board this exact combination can
  still reach nesasm on: 385 → 389), because `Move`'s only kernel-hi cost is its own four-byte compiled
  event opcode (`OP_MOVE` plus three operands) — the ~395-byte engine cost that actually makes MMC3
  refuse this combination is entirely in kernel-lo, gated by `MOVE_KERNEL_ALLOWANCE`, and never touches
  kernel-hi at all. So this is not a costed deferral: kernel-hi has room for a string like this many
  times over, on every board.

  The deferral rests on one reason, not two: the player already receives the only honest signal this
  mechanism can give without it — the title's own prompt already differs between the two cases
  (`sys_press_start` vs `sys_press_start_continue`), true today and costing nothing further. A more
  specific string would be a real, cheap, buildable improvement, not one blocked by any bank's
  capacity — it simply has not been judged worth doing yet.

## 6. Cutscene and presentation commands

Event pages become dramatically more capable with a handful of presentation verbs, none of which
need anything the PPU cannot do:

- ~~**`Move`, `Turn`, `Wait`** commands~~ — shipped, individually; ~~routes for an actor (chaining
  them into one authored, previewed unit, with a preview in the Map Forge) are still open, see
  below~~ — **done** (`b36093e`): `route` shipped as `EVENT_COMMANDS`' last entry, the catalog's
  first `virtual: true` member, flattening to the same Move/Turn/Wait opcodes hand-chaining would
  emit — zero engine bytes, proven by a cross-tree ROM diff — with a Map Forge preview. See below
  and CLAUDE.md's own routes note under the `nests: true` paragraph.
- ~~**Fade** in and out (palette ramp)~~ — shipped
- ~~**Screen shake**~~ — shipped — and ~~**palette flash**~~ — shipped
- ~~Play a **sound effect** or music sting~~ — **done**: the sting shipped as `Sting`, and the true
  sound effect shipped too, as the `Sfx` command (`OP_SFX`) — see the costing below.
- ~~**Show / hide** an actor~~ — shipped
- ~~**Change a tile or metatile** on the current screen~~ — shipped
- Basic **camera / scroll** control — split into its own item, see item 12 below

Two engine constraints shape all of these: nothing but `text.asm` may write to the nametable while
rendering is on, so any tile change goes through the `vram_buf` queue — the legacy producers (a
message box's own rows, a purely visual redraw) are each capped at one 32-byte row per frame, while
switch-bound tiles' own `flip_tick` is capped differently, at `FLIP_BUDGET_CAP` (1) cell per frame,
each cell costing two small packets (`flip_emit_packet`'s top-row and bottom-row writes, a 3-byte
header plus a 2-byte body each) rather than one 32-byte row; and a fade or a flash is a palette write,
which is a vblank job.

**This item is blocked in a way items 1-5 were not, and it was measured rather than estimated before
anything was built.** All seven verbs are kernel-lo code, and that bank has almost nothing left:
`sample-rpg` with a live `Save` and a live `Move`, on MMC1, is nesasm's own measured
**`7972/220`** (used/free, bank 14) — and on MMC3 the same combination is already refused before
nesasm ever runs (`checkCapacity`: "the lookup tables need 129 bytes but only 118 are free"). 220
bytes on the board's *better* case is the entire budget item 6 has to work inside, before a single
verb is built. (Re-measured against the current tree — this was `7969/223`/"only 121 are free" before
`battle_end`'s own talk_ent fix, item 6's Turn/Wait slice, added 3 more unconditional kernel-lo bytes
to every RPG build; the "before anything was built" framing describes the methodology this section
used, not a frozen historical snapshot, and the live figure below draws its own "121 bytes left"
conclusion from this same 220, not the stale 223.)

**Per-verb costing, from reading the engine rather than guessing:**

- **Move / turn / wait routes, with a Map Forge preview.** `Move` itself already shipped (379
  measured bytes, `MOVE_KERNEL_ALLOWANCE`) — a sunk cost. ~~The "route" and "preview" are Map Forge
  authoring/compiler work with no engine cost at all, since a route compiles to a linear sequence of
  per-leg opcodes on one page and `script_resume` already chains suspending commands correctly.~~ —
  **done** (`b36093e`): the prediction held exactly, proven rather than only argued by two separate
  pieces of evidence — the full-ROM route-vs-hand-chain test (`test/unit/routes.test.js`) builds a
  route and the same legs hand-chained as two temporary projects and asserts their compiled ROMs
  byte-identical, and the one-time cross-tree gate
  (`handoff-routes/routes-implementation-report.md`) built the route-free `sample/` project from a
  clean `git worktree add` at `6a44850` and from the implementation tree, recording the identical
  SHA-256 for both; that second comparison is what actually establishes zero engine bytes, the first
  only that a route compiles the same as hand-chaining it. `route` is `EVENT_COMMANDS`'s last entry,
  the catalog's first `virtual: true` member (no `OP_*` constant, no dispatch code of its own); its
  compiler case (`main/build/textcompile.js`) flattens each admitted leg (`routeLegs`,
  `shared/eventrules.js`) straight through `encodeCommand`'s existing `move`/`turn`/`wait` cases with
  no framing byte, so an authored route and the same commands hand-chained compile byte-identical.
  The Map Forge preview draws a route's trace on a placed, self-targeting entity and refuses with an
  honest caption otherwise. See CLAUDE.md's own routes note (under the `nests: true` paragraph) and
  `handoff-routes/design-routes.md` for the mechanism. The real remaining engine cost was always the
  two small opcodes: `Turn` (store a `DIR_*` into `ent_dir,x` /
  `player_dir`) and `Wait` (a countdown ticked from `ui_tick` the same way `move_tick` already is,
  calling `script_resume` at zero — no coordinate math, no collision). Estimated ~50-80 bytes
  combined before either was built; measured since, on all three RPG-capable boards, identically:
  **`Turn`-only 51 bytes** (`TURN_KERNEL_ALLOWANCE` 35 + `FACE_KERNEL_ALLOWANCE` 16, `move_face`
  pulled out of what `MOVE_KERNEL_ALLOWANCE` charged as one combined 395-byte figure before this
  split so a Turn-only project pays for it without paying for the rest of `Move`), **`Wait`-only 48
  bytes** (`WAIT_KERNEL_ALLOWANCE`, touching no code `Turn`
  or `Face` also touch), and **`Turn`+`Wait` together 99 bytes** — exactly the sum of the two, on
  every board, confirming they cost nothing to combine. This is item 6's first slice; see below.
- ~~**Fade in/out.** Not a new vblank write path: `vram_buf`'s `vram_open`/`vram_push`/`vram_end`
  (`engine/text.asm`) take an arbitrary PPU address handed to them at the call site and write it
  straight to `$2006` in `vram_drain` — nothing about them is nametable-specific, so a fade packet
  addressed at `$3F00` drains through the exact same NMI queue a message box's own rows do, with zero
  new NMI code. `text.asm`'s own comment measures the real cost of that transport: "32 bytes is ~480
  cycles of drain," not a smaller figure guessed from write count alone. The real, new work is a
  per-tick palette-ramp *producer* (something has to compute each step's darkened palette bytes) and
  confirming the shared queue's one-vblank budget still holds when a fade packet and a text-box
  packet are both open on the same frame — bounded (513 DMA + 480 + 480 ≈ 1473 of ~2273 cycles, with
  room to spare) rather than unknown, but a real constraint, not a non-issue.~~ — **done**, with one
  correction to the prediction: the vram_buf-reuse half was right — `fade_tick`
  (`engine/entities.asm`) is a per-tick palette-ramp producer riding the identical
  `vram_open`/`vram_push`/`vram_end` transport — but "with no new NMI code" was wrong.
  `nmi_fade_ppuaddr` (`engine/boot.asm`, gated `.if PALETTE_FX_ENABLED`) is real new NMI code: two
  more `$2006` writes with no following `$2007`, run after any drain to move the PPU's internal VRAM
  address off a palette mirror, because Fade is the first producer whose own packets can end inside
  palette space (`$3F00-$3F1F`) — every earlier producer's packets end inside nametable space, so
  nobody had to think about this before Fade. Measured cost: `FADE_KERNEL_ALLOWANCE` 146 bytes
  (`script_op_fade` and `fade_tick` only, plus dispatch/init glue — explicitly *not*
  `fade_apply_palette` or the NMI fix) plus `PALETTE_FX_KERNEL_ALLOWANCE` 55 (`fade_apply_palette`'s
  own body *plus* that NMI PPUADDR fix, shared with Flash, charged once whenever either is live, the
  same dependent-term shape Move/Turn share via `FACE_KERNEL_ALLOWANCE`) — 201 total for a
  **Fade-only** build (`main/build/generate.js`'s
  own comment on the constant: "the whole, unchanged, shipped Fade-only delta"), equality-asserted in
  `test/unit/kernelbytes.test.js`. With Flash also live the combined figure is 146 + 98
  (`FLASH_KERNEL_ALLOWANCE`) + 55 = **299**, the shared 55 charged once rather than twice
  (`test/unit/kernelbytes.test.js`'s own both-live assertion). See CLAUDE.md's "Flash is the first
  producer allowed to write `vram_buf` outside `ui_tick`'s own priority chain" passage for how a Fade
  step and a Flash edge share a frame.
- **Screen shake and palette flash.** Screen shake has shipped: `boot.asm`'s NMI already wrote `$2005`
  twice every vblank -- (0,0) when nothing is shaking, a small offset for N frames when something is,
  since Shake perturbs that existing write site rather than adding a new one — measured at
  **65 bytes** (`SHAKE_KERNEL_ALLOWANCE`), identically on all three RPG-capable boards, exactly the
  cheap shape this section predicted before it was built. ~~Palette flash has not shipped: it would
  reuse Fade's own producer/transport almost entirely — a short ramp to a target color and back.
  Estimated **~50-100 bytes**, contingent on Fade landing first.~~ — **done**: it did reuse Fade's
  producer/transport, sharing `PALETTE_FX_KERNEL_ALLOWANCE` (55) the way predicted, plus its own
  `FLASH_KERNEL_ALLOWANCE` of 98 bytes (`main/build/generate.js`, equality-asserted in
  `test/unit/kernelbytes.test.js`) — inside the estimated band. The novelty the estimate didn't
  anticipate: `flash_tick` never suspends, ticking unconditionally from `main_loop` so a Flash burst
  keeps counting down across the frozen/gameplay boundary, which made "one `vram_buf` producer per
  frame" a counted bound of two packets (71 of 256 bytes) rather than one — see CLAUDE.md's "Flash is
  the first producer allowed to write `vram_buf` outside `ui_tick`'s own priority chain" passage.
- **Play a sound effect or music sting.** These are different features costed separately.
  ~~A **music sting**, checked against `engine/music.asm` directly rather than assumed, is *not* a
  small wrapper on `set_music`/`OP_MUSIC`: `set_music` only ever replaces the current song outright —
  there is no completion signal in the stream format (a song loops forever via its own `$FF jump`)
  and no memory of what was playing before. A sting that auto-restores the previous song needs either
  a real retention-and-restoration mechanism (new RAM for what to restore, and a way to detect the
  sting has finished — genuinely new, **~150-300 bytes**) or costs *nothing at all*: once `Wait`
  exists (see the first slice below), an author can already build a sting as an authored sequence —
  Play music (the sting) → Wait (its known duration) → Play music (the original) — with no new
  opcode. That second option is the one worth taking.~~ — **this corrects an earlier draft of this
  section**: the authored-Wait-sequence option was *not* taken. The real retention-and-restoration
  mechanism was built instead — `sting_snapshot`/`sting_restore`/`sting_tick` in `engine/music.asm`,
  pausing and resuming whatever song was already playing through the unmodified driver, at a measured
  175 bytes total (`main/build/generate.js`, equality-asserted in `test/unit/kernelbytes.test.js`),
  landing inside the ~150-300-byte band the rejected option's estimate carried. (`STING_KERNEL_ALLOWANCE`
  itself no longer exists as a single constant — item 6's sound-effect slice, below, decomposed it into
  `STING_KERNEL_ALLOWANCE_STANDALONE` 160, `.if STING_ENABLED`-gated so a Sting-free project pays none
  of it, plus the shared `AUDIO_FX_KERNEL_ALLOWANCE` 15, `.if AUDIO_FX_ENABLED`-gated instead so an
  SFX-only project pays it too — summing to the same 175 for a Sting-only project, so every figure in
  this paragraph still holds.) Those 175 bytes are why MMC3 now has a
  third documented-limitation refusal (`sample-rpg` with Save, Move and a live Sting, no item —
  tested in `kernelbytes.test.js`), and on an MMC3 project whose sole live event is a Sting-only
  command, `kernelShortfallAdvice` correctly frees 175 + 19 = 194 bytes together via the dependent
  `SPLIT_LOCK_KERNEL_ALLOWANCE` term. See `handoff-sting/design-sting.md` for the full design
  and CLAUDE.md's own `sting_snapshot`/`sting_restore`/`sting_tick` passage for the mechanism. ~~A true
  **sound effect** (independent of whatever song is playing, borrowing an APU channel briefly) is
  genuinely new and touches `music_tick`, which runs unconditionally every frame including during
  battle and dialogue — real, always-paid branching, not free-when-off. Estimated **~150-300 bytes**,
  and this remains open.~~ — **done**: it shipped as the `Sfx` command (`OP_SFX`), a fixed noise-channel
  (`SFX_CHANNEL = 3`) burst with its own two-phase cleanup that hands the channel back to whatever the
  music system was doing. Both predictions in the struck-through text were wrong, and this corrects
  them explicitly rather than dropping them. The estimate: standalone cost measured at
  `SFX_KERNEL_ALLOWANCE_STANDALONE` 295 bytes plus the shared `AUDIO_FX_KERNEL_ALLOWANCE` 15 — 310 for
  an SFX-free-of-Sting project, exceeding the ~150-300 band's own top; with a live Sting too the total
  is 475 (`STING_SFX_INTERACTION_ALLOWANCE` 5 more on top of both standalone terms), matched
  independently by measurement. The "always-paid branching, not free-when-off" claim: also wrong — the
  shipped feature is `.if SFX_ENABLED`-gated the same as every other verb, and a cross-tree ROM hash
  comparison (`handoff-sfx/sfx-implementation-report.md` §4) proves an SFX-free `sample/` build is
  byte-for-byte identical with and without the feature in the tree. See CLAUDE.md's own SFX passage and
  `handoff-sfx/design-sfx.md` for the mechanism.
- **Show / hide an actor.** Built. The semantic choice this bullet used to say nobody had made yet is
  made: hidden means invisible but otherwise fully alive. `draw_entities` (`engine/entities.asm`) is
  the *only* reader of the hidden bit; `update_entities`'s own AI (`entity_patrol`/`entity_chase`),
  every contact path (`entity_contact`, `entity_trigger_touch`), and the `do_talk`/`do_attack`/
  `do_interact` loops all keep testing `ent_active` for occupancy alone and never look at it — so a
  hidden actor keeps wandering, keeps dealing contact damage, and stays talkable, attackable and
  collectible. Hide-as-despawn (`ent_active = 0`, this bullet's own earlier "nearly free" option) was
  rejected on purpose, not merely costed differently: it is already indistinguishable from a collected
  pickup or a beaten enemy, and an author who wants an actor gone for good already has switches and
  page conditions for exactly that — a command that only reproduces what those already do would not be
  pulling its weight under the name "Hide". (Actors still do not block the player's own movement at
  all — `probe_solid` only ever reads `mtptr`'s metatile data, never an entity's position — so hiding
  one changes nothing about that either way.)

  The hidden bit is packed into `ent_active` itself (`ENT_PRESENT` = 1, `ENT_HIDDEN` = 2,
  `engine/constants.asm`) rather than a dedicated array, because a second array is one more thing
  `spawn_entities` and every future writer has to remember to keep in sync with the first — a packed
  bit cannot drift out of sync with itself. That reuse works only because every one of `ent_active`'s
  nine reads is a plain `beq`/`bne` on zero, never a `cmp #1` or an arithmetic use — confirmed by
  tracing every one before relying on it, not assumed — so a slot holding 3 still reads as occupied
  everywhere unchanged.

  `Show`/`Hide` compiles to one opcode with a state operand (`[OP_VISIBLE, state]`, 0 = hidden,
  1 = shown), not two opcodes, since the two are positions of one flag rather than independent
  actions — the same shape Turn's own direction picker already has. Targeting is self only, resolved
  through `talk_ent` the way Move/Turn's own `self` already is: there is exactly one entity this
  command can mean, so there is no "who" byte to spend on it. Naming a *different* placed actor by
  record — a lever hiding a gate elsewhere on the screen — is a real, wanted capability this slice
  deliberately does not build: it needs genuinely new targeting infrastructure (a linear scan of
  `ent_record` the way `battle_end_owner_loop` already does, plus a Map Forge actor picker), not a
  byte squeezed out of the self-only operand, so it is a scoped decision to leave for its own slice
  rather than an oversight here.

  Hiding does not survive a screen change: `spawn_entities` writes `ENT_PRESENT` alone on every
  redraw, so a hidden actor comes back visible the next time the screen loads, warped back to, or
  returned to from battle. This is the intended behaviour, confirmed rather than assumed — Hide is a
  this-visit-only tool, and permanence is what switches and page conditions are already for.

  Cost: **49 bytes**, measured identically on all three RPG-capable boards (`script_op_visible` and
  its dispatch-chain entry in `script.asm`, plus the `ENT_HIDDEN` check in `draw_entities`), not the
  15-60 this bullet used to estimate before either option was built.
- ~~**Change a tile or metatile on the current screen.** Two different features hiding under one
  name. A purely visual change that reverts on the next redraw reuses `vram_buf` exactly as
  `box_close` already rebuilds message-box rows out of `[mtptr]`/`mt_tl`/`mt_tr` — **~40-70 bytes**.
  A change that *persists* past a redraw (a burned bush staying burned) needs a new per-screen
  override-tracking mechanism, since screen data is ROM on every board except UNROM 512's CHR-RAM
  tilesets, which is a different kind of RAM entirely — **~150-300+ bytes**, and an open RAM-budget
  question. Which reading is meant should be settled before this verb is costed further.~~ —
  **done**, settled by a third design neither of the two readings above anticipated: a cell reads as
  a different metatile while its bound switch is set, with no new opcode — the mechanism rides the
  existing `Turn` switch on/off commands (`script_op_set`/`script_op_clear` → `tile_switch_changed`)
  through a shared `bound_tile_lookup` primitive that `draw_screen`/`probe_type`/`text_close_step`
  all call instead of reading `[mtptr_lo],y` directly, with a non-suspending `flip_tick` (one budget
  slot per frame, a deduped FIFO queue for whatever does not fit) for a switch toggled while the
  screen is already on display. Persistence falls out of deriving the tile from switch state rather
  than tracking an override — battle-return, game-over and Continue are correct by construction, with
  no save-format change. Measured cost: `BOUND_TILE_KERNEL_ALLOWANCE` 388 bytes, plus a 30-byte fixed
  table (`bound_row_lo`/`bound_row_hi`) and 2 bytes per screen (`screen_bound_lo`/`hi`) —
  `main/build/generate.js`, equality-asserted in `test/unit/kernelbytes.test.js` — landing well past
  the ~150-300+ estimate for the persistent reading, and this is authored screen data, the first
  strippable feature that isn't an event command. It closed two previously-comfortable rows: MMC3
  Save+Move-no-item and MMC1 Save+Move+item are both refused once a live bound tile is added (both
  refusals tested in `kernelbytes.test.js`). See CLAUDE.md's "Switch-bound tiles (design-tile.md)"
  passage for the full mechanism.
- ~~Basic **camera / scroll** control~~ — split out into its own roadmap entry; see item 12 below.
  This corrects an earlier draft of this section, which bundled camera/scroll into item 6's own
  costing before splitting it out was actually done.

**The structural question: a fourth kernel diet, a second banked region, or per-verb conditional
assembly that does not compose indefinitely.**

*A fourth diet is real but not sufficient.* `entity_patrol` (`engine/entities.asm:155-220`, AI
wandering) and `move_tick` (`entities.asm:670-765`, scripted `Move`) are the same shape: get a
coordinate, add or subtract a step, bounds-check with a branch to a "blocked" handler, offset for
the body, one corner probe through `probe_solid`, commit or bail — a genuinely separate duplication
from the one `player.asm`'s own diet already collapsed (that one probed two corners; these each
probe one). They differ in backing storage (`ent_x,x`/`ent_y,x` direct-indexed vs. `move_tick`'s
`move_get_x`/`move_get_y` accessors, needed because a `Move` can target the player or an entity) and
in what "blocked" means (patrol turns and keeps going; `Move` ends the walk). A merge is possible but
adds real `jsr` overhead to `entity_patrol`'s own hot path where none exists today. Estimated
**~20-50 bytes** against a calibration of the third diet's actual 70-byte yield collapsing *four*
routines rather than two — real money, worth taking whenever someone is already in that code, but an
order of magnitude short of what even the cheap verbs alone need.

*A second banked region is mechanically viable, not impossible — this corrects an earlier draft of
this section that overstated the block.* `call_battle`'s own trampoline (`engine/banks.asm`) is safe
because battle fully owns the screen and never touches `mtptr` while its bank is switched in.
Cutscene verbs are not uniformly like that: `ui_tick`'s own comment states a scripted `Move` "is
always `ST_DIALOG` in practice," and `main_loop` skips ordinary `update_player` entirely whenever
`game_state != 0` — so `update_player` is never the conflict. The real one is narrower: `move_tick`
itself calls `probe_solid`, which dereferences `[mtptr_lo],y` — the *current screen's* metatile data,
living in the same switchable window a banked cutscene region would occupy. A **nested** trampoline
closes this, not a whole-verb one: a fixed-kernel helper switches the PRG bank to screen data, calls
`probe_solid`, switches back to the cutscene bank, and `rts`s — the return address stays valid on the
stack throughout, exactly `call_battle`'s own "the restore is the return" discipline applied per
probe call instead of per verb-invocation. That costs kernel bytes for the helper plus two bank
switches on every probe call `Move` or a screen-aware tile-change makes — an expensive design, not an
impossible one. `Wait`, `Turn`, `Fade`'s own producer, `Show`/`Hide`, and shake/flash have **no**
`mtptr` conflict at all and could use the ordinary, unnested trampoline shape safely today. On board
exclusion: the earlier draft's claim that this excludes every non-`rpgCapable()` board is wrong, and
was checked rather than repeated. `rpgCapable(mapper)` is `hasSwitchablePrg(mapper) &&
mapper.switchableChr`; `codeRegions()` — the mechanism a banked region reuses — needs only
`hasSwitchablePrg` (confirmed directly: it never reads `switchableChr` or `chrRam` except through
`chrPayloadRegions`, which returns `[]` on every non-CHR-RAM board including UxROM). UxROM
(`prgUnits: 8`, `switchableChr: false`) has a switchable PRG window and could host a banked cutscene
region despite never being RPG-capable. The boards genuinely excluded are the four with
`prgSwitch: PRG_SWITCH.none` and a single fixed 32 KB image — NROM, CNROM, GxROM, Color Dreams — not
the five non-RPG-capable ones. The recommendation below is unchanged from the earlier draft, but now
rests on real cost (per-probe bank-switch overhead, and covering only a subset of the seven verbs)
rather than on an impossibility that turned out not to be real.

*Per-verb conditional assembly, checked against the measured numbers rather than left qualitative.*
**The paragraph below is now measured history, not live budget — it predates `Fade`, palette flash,
`Sting` and switch-bound tiles all shipping, and only ever costed `Turn`/`Wait`/`Show`/`Hide` against
the MMC1 worst case.** It is kept rather than deleted per this file's own convention for superseded
analysis, followed by what the fuller picture looks like now. On MMC1's worst measured case
(`Save`+`Move`, **220 bytes free** — re-measured against the current tree; 3 fewer than this section
first recorded, because `battle_end`'s own talk_ent fix above is unconditional kernel-lo cost on every
RPG build, including this one): `Turn`+`Wait` cost **99 bytes, measured**, not the ~50-80 this section
estimated before either was built — leaving **121 bytes**, not the ~140-170 the estimate implied.
`Show`/`Hide` has since shipped too, at a measured **49 bytes**, not the ~15-60 this section estimated
before it was built — leaving **72 bytes**, not enough for `Fade` (~80-150b, mostly the ramp producer,
not the transport, was the estimate at the time) alongside both. Confirmed **two of the seven** fit in
that worst case (`Turn`+`Wait`, `Show`/`Hide`), not merely "probably" any more, but the real remaining
room is tighter than the pre-implementation estimate suggested, and planning the next verb off that
estimate rather than the measured 72 would overstate how much is actually left. Without `Save`+`Move`
active, `sample-rpg` as checked in measured nesasm's own **`6818/1374`** free on the same board
(re-measured against the current tree; 3 fewer than this section first recorded, the identical
`battle_end` cost above, not an arithmetic adjustment of the old number) — comfortably fits all six
smaller verbs' combined high end (~700-900 bytes, excluding camera/scroll) with margin. MMC3's worst
case is already negative before item 6 exists at all. So "does not compose indefinitely" (CLAUDE.md)
is now a number: on this codebase's own reference scenario, kernel-lo has room for roughly a third of
the item, not all of it, and that is board- and configuration-dependent rather than a fixed ceiling.

**What actually happened once `Fade`, `Flash`, `Sting`, switch-bound tiles and the `Sfx` sound effect
were each costed and shipped: exactly the pattern this paragraph predicted — most of them fit as
ordinary conditional kernel-lo code, and the tightest combinations hit the same kind of
documented-limitation wall `Save`+`Move` already did, rather than being blocked outright.** `Fade`
alone measures 146 (`FADE_KERNEL_ALLOWANCE`) + 55 (`PALETTE_FX_KERNEL_ALLOWANCE`, shared with Flash) =
201 bytes — well past the 72 bytes this scenario's `Turn`+`Wait`+`Show`/`Hide` combination leaves,
confirming "not enough for Fade" while correcting the estimate that produced it. `Sting` (175 bytes —
`STING_KERNEL_ALLOWANCE_STANDALONE` 160 + the shared `AUDIO_FX_KERNEL_ALLOWANCE` 15, the constant's
own decomposition once `Sfx` shipped) created MMC3's third documented-limitation refusal
(`sample-rpg` with Save, Move, no item, and a live Sting — `test/unit/kernelbytes.test.js`). Switch-
bound tiles (388 bytes plus table costs) closed two previously-comfortable rows outright: MMC3
Save+Move-no-item and MMC1 Save+Move+item are both refused once a live bound tile is added (CLAUDE.md,
"Switch-bound tiles (design-tile.md)"). `Sfx` (`SFX_KERNEL_ALLOWANCE_STANDALONE` 295, plus the shared
`AUDIO_FX_KERNEL_ALLOWANCE` 15 — 310 Sting-free) closed five more rows across all three RPG-capable
boards on its own standalone cost alone, the largest set of refusals any single verb in this ledger has
produced (CLAUDE.md's own SFX passage, and item 6's own section above). And the item-6 costing pass
that measured all this also found combinations this paragraph never considered: MMC1's own
Save+Move+item row, comfortable with 220 bytes free on its own, is refused by 296 bytes once every verb
included in that earlier costing pass (`Turn`, `Wait`, Shake, `Show`/`Hide`, `Fade`, `Flash` — that
pass predates `Sting`, switch-bound tiles and `Sfx`, so it is not literally every shipped verb as of
today) is also live on the same project (CLAUDE.md, near "the item-6 costing pass"), while the same
combination with no `Save` fits with 483 bytes free — confirming again that it is `Save`+`Move`
specifically, not the verb count alone, that closes the gap. None of this needed a fourth kernel diet
or a banked region to ship, `Sfx` included; each refusal is an accepted, documented limitation the same
way `Save`+`Move` already was.

**Recommendation: do not make a banked region item 6's primary vehicle.** Ship the verbs that are
cheap and need no `mtptr` access (`Turn`, `Wait`, `Show`/`Hide`, shake) as ordinary conditional
kernel-lo code on every board — none of them need banking, and keeping them universal avoids trading
away NROM/CNROM/GxROM/Color Dreams action projects' access to cutscenes at all, which the
banked-region path would cost for no reason on the verbs that don't structurally require it. ~~Cost
`Fade` and sound-effect/sting on their own merits later — they may end up conditional kernel-lo too,
hitting the same documented-limitation wall `Save`+`Move` already does on MMC3's worst case, which is
this codebase's own precedented, acceptable outcome rather than a defect.~~ — **done**: `Fade` and
`Sting` (the music-sting half of "sound-effect/sting") were both costed and shipped, each as ordinary
conditional kernel-lo code, and each landed on MMC3's tightest rows as an accepted documented
limitation rather than a defect — exactly the outcome this recommendation predicted (see above). Their
byte figures didn't land the same way relative to their own pre-implementation estimates, though:
`Sting` (175 bytes) fit inside the ~150-300 estimate the rejected retention-mechanism option carried,
while `Fade`'s real Fade-only total (201 bytes — `FADE_KERNEL_ALLOWANCE` 146 +
`PALETTE_FX_KERNEL_ALLOWANCE` 55, above) exceeded the ~80-150 this section originally estimated for
it. The true sound effect has since shipped too (item 6's own section, above), and it is the second of
these three to miss its own estimate, by a smaller margin than `Fade`'s: `SFX_KERNEL_ALLOWANCE_STANDALONE`
measured 295 bytes against the same ~150-300 band the SFX estimate had been pinned to, so a Sting-free
SFX project's real marginal cost (310, with the shared `AUDIO_FX_KERNEL_ALLOWANCE` 15 added) clears the
band's own top by 10 bytes — a real overrun, but well inside `Fade`'s own 51-byte one (201 against its
~80-150 band's top of 150). Take the `entity_patrol`/
`move_tick` diet opportunistically rather than counting on it. ~~Split camera/scroll out of this item
entirely into its own future roadmap entry — it is a different kind of thing than the other six, not
a bigger version of the same thing.~~ — **done**: see item 12 below.

- ~~**First slice: the `Turn` and `Wait` commands**~~ — **done**. Two new opcodes, each authorable on
  their own in the Map Forge's event editor. Needs no structural decision — both are cheap enough to
  fit even MMC1's worst measured case with margin, and touch no `mtptr`-dependent code at all. See
  `test/unit/kernelbytes.test.js` for the measured, per-configuration byte cost. ~~**Not done**: the
  "Move / turn / wait routes" verb this was meant to complete also named a *route* — a sequence of
  legs authored and previewed together — and a Map Forge preview for it, at line 647 above. Neither
  is built. The individual commands exist and can already be chained by hand, one at a time, on a
  page; what is still open is the authoring convenience (one "route" tool instead of adding Move/Turn/
  Wait commands one by one) and the preview itself, both pure Map Forge/compiler work with no engine
  cost — see the costing above, which already separated this out.~~ — **done** (`b36093e`): both the
  route tool and the preview shipped, as a second, later slice on top of this one. The honest history
  stands — this first slice shipped only the individual `Turn`/`Wait` commands, chainable by hand one
  at a time; the route-authoring convenience and its Map Forge preview followed afterward, at zero
  further engine cost, exactly as the costing above already separated out. See the costing bullet
  above and CLAUDE.md's own routes note for the mechanism.

## 7. Map organization and reuse

The Map Forge already has stamp, rectangle, fill, picker, start and actor tools
(`renderer/forges/map/map.js:31`). What it lacked was everything about handling *many* maps. Five of
six items below are now complete: duplicate, copy/paste, folders and safe reorder shipped as
`de19269`, in five reviewed phases against `handoff-maporg/design-maporg.md`; named screens
predated item 7 (landing with item 2) and this commit added only their ambiguity warnings; the
sixth, the world overview, was deliberately sliced out. CLAUDE.md's own item-7 passage (near
`renderer/store.js`) carries the mechanism; it is not repeated here.

- ~~**Duplicate** a screen or a whole map~~ — **done**: a whole map (`duplicateMapCore`), and a
  single screen by three routes — grow the destination map to fit it, pick a different map with
  room, or promote it to a brand-new map of its own.
- ~~**Copy/paste** a rectangular region~~ — **done** (`pasteRegionCore`): art, bindings and
  optionally the actors placed in it.
- ~~Map **folders** or a tree~~ — **done**, as folders: `map.folder`, a display-only grouping label
  for the Map Forge's own picker (`null` meaning no folder). Not a tree — a flat label a map either
  has or does not.
- ~~**Reorder** maps safely, updating every warp and event reference~~ — **done**: see the paragraph
  below.
- ~~**Named screens** (shared with item 2)~~ — the field itself (`createScreen()`'s `name`,
  `screenLabel`) predates item 7, landing with item 2. What item 7 added is `validateProject`'s
  ambiguity warning: two maps, or two screens within one map, sharing a name is what breaks the ▶
  Test tool's remembered-scenario resolution (`shared/playscenario.js`'s `resolveStartAt`, which
  refuses rather than guesses). `validateProject` emits the warning as a nonblocking entry the Build
  Forge shows under Problems (`renderer/forges/build/build.js`'s `renderSummary`) — duplicate names
  still compile fine, the warning is just telling you why a remembered scenario touching one of them
  would refuse.
- A **world overview** showing starts, warps and event markers — **still open**, deliberately sliced
  out of the design (§12): `renderer/forges/map/eventlist.js`'s `buildEventIndex` can already supply
  searchable event/actor rows, useful input for the event-marker portion, but it reads neither
  `project.project.startMap` nor `startScreen` and folds warp targets into human-readable command
  text rather than structured marker records — a world overview still needs explicit start and
  structured warp-marker extraction of its own. Building one before folders had settled risked
  rework too. Item 7 is not wholly done; this is the remaining piece.

Reordering was the one with teeth, and the prediction held: screen indices are referenced by warps,
doors and compiled event bytecode, so the operation had to rewrite every stored reference in the
same commit, and it does. `remapScreenReferences(project, translate)` (`shared/project.js`) is that
one primitive — the single place that knows which fields hold a flat screen reference, walking
`allCommands` so a warp nested inside a branch or a choice option is not missed. The structural
map/screen edit cores use it wherever a flat reference can move (reorder, delete, grow/shrink,
growth-routed screen duplicate); region paste has its own commit-free core (`pasteRegionCore`) that
never calls it, and a folder or screen-name edit is a plain metadata write, not a remapping core at
all. It also turned out to be the fix for two already-shipped bugs, not just new work: Delete Map and
Resize Map had been restructuring `project.maps` with zero reference repair since they first shipped,
and item 7 is the retrofit that finally repairs them. The suite grew from 880 to 914 tests — 34 new
`test(...)` declarations added to `test/unit/project.test.js` and none removed (`git diff -U0
de19269^ de19269`), not the commit message's own "914 (from 891)"/"27 plus five controls," which
does not square with either the diff or the parent commit's own reported count. Reading the 34
themselves: `remapScreenReferences`/`canonicalizeFlat` mechanics, reorder's self/cross-map/branch/
choice reference preservation and its own byte-identical round trip, `saveCompatToken`/`saveIdentity`
behavior across several edits including a same-count reorder, the structural cores' own edit
contracts (naming collisions, atomic paste-capacity refusal, `map.folder` round-tripping) — a broader
set than reference preservation alone. That reorder case is guarded outside the flat-reference remap
by a project-wide `saveCompatToken`, itself stored
in project JSON (`project.project.saveCompatToken`) and folded into `saveIdentity`
(`shared/save.js`) because a reorder leaves `screenCount`/`mapCount` unchanged. The approved design
had two real bugs, found
only by implementing it, both fixed in the code and in the design document's own §15 changelog. Zero
engine bytes: `sample/` builds to an identical ROM hash before and after.

## 8. NES-constrained asset assistance

The blank-page problem is real, and RPG Maker solves it mostly by shipping content.

- Generate four directions and two walk frames from modular parts
- **Palette-swap** an existing sprite into a new one
- **Validate** sprite size, palette count and tile budget as you draw
- A small **MIT/CC0 starter library**: terrain, UI, monsters, effects, sound effects
- **Starter projects** — action, dungeon crawl, RPG — beyond today's demo fixtures

Anything shipped here needs its license recorded in the repo, and the five existing fixtures stay
exactly as they are: tests are written against them and they may not be mutated. Only two of them
are demos worth starting from — `sample/` and `sample-rpg/`; `sample-mmc1/`, `sample-mmc3/` and
`sample-u512/` exist to cover a board rather than to show a game (CLAUDE.md's own "five fixtures,
deliberately" passage), and are not what this item means.

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

## 12. Camera / scroll control

Split out of item 6, where it originally lived as one of seven cutscene/presentation bullets. Item
6's own recommendation ("Split camera/scroll out of this item entirely into its own future roadmap
entry — it is a different kind of thing than the other six, not a bigger version of the same thing")
is executed here.

**Confirmed larger than item 6's other six verbs, and not really the same *kind* of thing.**
`boot.asm`'s NMI writes `$2005` twice every vblank, resetting to (0,0) on the no-shake path — with
`SHAKE_ENABLED` and a live shake, it writes a transient ±2-pixel horizontal offset instead (`$02` or
the 9-bit `$FE` representation, `$00` vertically) for as many frames as the shake lasts, not (0,0). No
project has a persistent camera coordinate or live scrolling either way: Shake's offset is a
self-clearing perturbation of this same write site, not a camera position, and the whole rendering
model is one full 256×240 nametable per authored screen with
hard transitions (`cross_left/right/up/down`; the MMC3 split section's own note that "the engine only
draws nametable 0"). Real scrolling needs adjacent-screen data available before the camera reaches an
edge — double-buffered nametable content streamed in under the vblank budget, touching
`redraw_screen`, the mirroring model, and UNROM 512's CHR-RAM streaming path. Floor estimate
**500-1000+ bytes**, likely conservative, and it deserves its own design pass rather than being
bundled into another item's costing. Nothing about this estimate has been revisited since the split;
no design work has started.

---

## 13. The Magic Forge

Users create magic spells: set their **animations**, **damage/heal ranges**, the **type of magic**
(damage, status effect, or heal), and the **damage type** (fire, ice, wind, water, holy, dark). Part
of this is real machinery already shipped and only needs a home of its own; part is genuinely new. The
item states which is which rather than reading as one undifferentiated feature.

**Already exists.** `project.spells` (`shared/project.js`, cap `RPG_LIMITS.spells = 32`) is a real,
compiled record today — `{id, name, mpCost, kind, amount, element, scope}` (`createSpell`) — authored
inside the Sprite Forge's battle page (`renderer/forges/sprite/battle.js`: add, rename, MP cost, kind,
amount, element, scope), with which spells a party member learns at which level on that same page's
party tab — one bitmask byte per member per level, up to eight spells each (`battletables.js`).
`SPELL_KINDS` (damage / heal / poison) is already append-only wire format (`SK_*` in
`engine/constants.asm`), and poison is already a real status effect, not a placeholder: it ignores
`amount` and deals a fixed 2 HP after each of the victim's turns until cured by a heal or the battle
ends (`pc_status`/`mon_slot_status`, ticked by `battle_message_done`). `ELEMENTS` (`shared/project.js`)
is live in the engine, not decorative — `spell_element` plus per-monster `mon_weak`/`mon_strong`
tables (`battletables.js`), applied by `battleturn.asm`'s spell-damage rule: half again into a
weakness, half into a strength ("elements only describe monsters" — the party carries no weakness of
its own). `SPELL_SCOPES` (one / all) is likewise live both ways: monsters cast the same spells the
party does (`cast_spell`/`cast_heal`/`cast_all` take either side, `other_side` decides reach). Item 5's
own scope list already names "Skills and their effects" and "Status conditions (poison is already a
status bit; this generalizes it)" as bullets its shipped phases never started: item 5 itself is "done,
for items" — its Items Forge shipped, while equipment, skills and status-condition generalization
stayed unbuilt, open roadmap items of their own (item 5's own accounting, above) — this item is where
those two still-open threads pick up, not a new one.

The precedent for pulling this authoring surface out into its own Forge is item 5's own Items Forge
(`renderer/forges/items/items.js`): one `FORGES` entry in `renderer/app.js` — the single writer for
which Forges exist — visited by `npm run smoke` via `app.forgeIds`, documented in CLAUDE.md. A Magic
Forge is the same shape: move spell authoring (and the party's learned-spells tab) out from under the
Sprite Forge's battle page into its own place in the rail.

The current battle routines (`engine/battle.asm`, `battleui.asm`, `battleturn.asm` —
`BATTLE_REGION_SOURCES`, `main/build/battletables.js`) and every table `battletables.js` emits already
live in the **banked battle region**, not kernel-lo — unlike item 6's verbs, which had to fight
kernel-lo's exhausted margin (above), this region has its own separate, exact capacity check
(`battleRegionBytes`, `BASE_BATTLE_CODE_BYTES_BY_MAPPER`, `BATTLE_SLACK`,
`test/unit/bankedbytes.test.js`) and roughly 4 KB of stock code in its 8 KB ceiling today. Most
conventional battle-side additions — new fields on a spell or a monster, new table rows — are expected
to draw from that same headroom. Animation is the one exception this item cannot promise a placement
for yet: `draw_metasprite` (`engine/entities.asm`) is banked-region-adjacent code the way the rest of
the engine's entity drawing is, but `PALETTE_FX` reuse is not — `PALETTE_FX_KERNEL_ALLOWANCE`
(`main/build/generate.js`) is real kernel-lo cost, with its own gated code in `engine/entities.asm` and
`engine/boot.asm`'s NMI. Whichever mechanism the shared animation design (below) actually picks decides
which bank pays for it, and that stays open until it does. Anything the 6502 would need a multiply for
is precomputed into tables by `battletables.js` rather than computed at runtime, which is also where
this item's own new table bytes would land and grow.

**Genuinely new in this item:**

1. **The Forge itself** — moving spell authoring out of the Sprite Forge's battle page into a
   dedicated Magic Forge, the Items Forge shape above.
2. **Spell animations** — nothing exists today: casting is message lines and HP changes, with no
   per-spell visual at all. This is the least-designed part of the item, and stays that way here
   rather than being forced to a figure: what an animation even *is* on the battle screen —
   a metasprite flipbook drawn over the target (`draw_metasprite`, `engine/entities.asm`), a palette
   flash reusing the existing `PALETTE_FX` machinery (`PALETTE_FX_ENABLED`, shared by `Fade`/`Flash`),
   or something else entirely — is an open design question this item records rather than settles.
3. **Damage/heal ranges (min-max)** — `spell.amount` is one flat byte today (`normalizeSpell` clamps
   it 1-255), with no range at all. The battle engine already has a real RNG (`rng_next`,
   `engine/rpg.asm`), so rolling a range is a table-shape and engine-arithmetic question, not a
   new-mechanism one. `SAVE_LAYOUT_VERSION` (`shared/save.js`, currently 2) only matters here if some
   new per-spell state ends up serialized to a save record — flagged as a check this item owes, not
   a cost already known to be owed.
4. **Generalizing status effects beyond poison** — `SPELL_KINDS` being append-only means new kinds
   are additive by construction. The storage is not the constraint: `pc_status`/`mon_slot_status`
   already allocate one whole byte per combatant, with only bit 0 defined (`engine/constants.asm`'s
   own "Status bits" comment) — seven bits already sit spare in that byte. What is single-status
   today is the *logic*, not the storage: `poison_target` writes the whole value `1` rather than a
   bit, `combatant_status` treats any nonzero byte as poison, and heals clear the byte outright.
   Generalizing means assigning and preserving individual bits and extending the cure/tick/message
   flow to more than one condition at once — the RAM arrays themselves only need to grow past eight
   boolean statuses, or once a status needs its own payload beyond a single bit.
5. **The element list is settled scope, not an open question.** The user's ask (31 Aug 2026) is
   explicit: water and holy are distinct damage types, not relabelings of the shipped earth and
   light — both pairs exist side by side. `water` and `holy` are **appended** as two new entries to
   `ELEMENTS`, keeping every existing one (`none`, `fire`, `ice`, `wind`, `earth`, `light`, `dark`
   all stay), growing the list to `none`, `fire`, `ice`, `wind`, `earth`, `light`, `dark`, `water`,
   `holy`. Appending is also the mechanically safe direction, worth recording alongside the decision:
   element ids live in project JSON and the array's index is the wire format compiled into
   `mon_weak`/`mon_strong`/`spell_element` (`elementIndex`, `battletables.js`), so appending at the
   end only ever adds new index values and leaves every existing one untouched — additive and
   zero-break for every project already using `earth`/`light`. Renaming or replacing an existing
   entry's id would have broken those projects instead, which is why appending is the one this item
   commits to.

---

## 14. The Monster Forge

Set monsters' **animations**, **tile maps for RPG battles**, **sprites for the overworld**, **HP**,
**MP**, **magic resistances and weaknesses**, **how much damage they do**, **how much MP they have**,
**how much XP, gold and items dropped when defeated**, and **what level the monster is at**. This
Forge is an even more lopsided UI-reorganization item than item 13: almost every stat the user lists
already exists on the actor's own `battle` record, authored today in the same Sprite Forge pages. A
monster *is* an actor with a battle record — item 5's own opening sentence ("Reusing actors as
monsters and items is a genuinely clever economy, and it will not scale as the system grows",
`ROADMAP.md`'s own item 5 above) is exactly the framing, and this item is that sentence coming due for
monsters the way item 5's shipped phases were for items.

**Already exists**, per actor (`shared/project.js`'s `normalizeActor`, `actor.battle`, emitted as
`mon_*` tables keyed by actor id in `main/build/battletables.js`):

- **HP** (`actor.hp` → `mon_hp`), edited on the actor's own general panel
  (`renderer/forges/sprite/sprite.js`, "Hit points") rather than the battle sub-page — it is general
  actor data, not battle-specific, worth noting for the Forge-boundary question below. **MP**
  (`battle.mp` → `mon_mp` — what the monster's own spell-casting spends) is edited on the battle
  sub-page instead (`renderer/forges/sprite/battle.js`, "Magic points").
- **Damage dealt and the rest of the combat statline**: `atk`/`def`/`acc`/`eva`/`speed` (→
  `mon_atk`/`mon_def`/`mon_acc`/`mon_eva`/`mon_speed`), all labeled fields on the battle page today
  (Attack, Defence, Speed, Accuracy, Evasion).
- **Magic weakness and resistance**: `weak`/`strong`, one element each (→ `mon_weak`/`mon_strong`),
  consumed live by `battleturn.asm`'s spell-damage rule — the same mechanism item 13's own
  "Already exists" paragraph names for spells casting *into* it.
- **XP** (`battle.xp`, 16-bit → `mon_xp_lo`/`mon_xp_hi`), **gold** (`battle.gold` → `mon_gold`), and
  the **item drop**: `drop` (an item id, `NO_ITEM` sentinel) plus `dropPct` (→
  `mon_drop`/`mon_drop_pct`, rolled by `roll_drop` in `engine/battleturn.asm`).
- **Battle art — the user's "tile maps for RPG battles," already real**: `battleTile`/`battleW`/
  `battleH` (→ `mon_tile`/`mon_w`/`mon_h`) is a block of background tiles on the battle tileset,
  capped at `RPG_LIMITS.battleArtTiles` = 12 tiles wide or tall. One attribute byte
  (`battlePalette` → `mon_attr`) tints the monster's anchored 4x4-tile attribute cell
  (`draw_battle_attr`, `engine/battle.asm` — its own header comment: art is "anchored to a four-row,
  four-column grid precisely so that one attribute byte covers all of it"). That cell is separate from
  the 12-tile width/height cap, so it covers a block up to 4x4 exactly but not a larger one — a block
  drawn past 4x4 is real, shipped capability, but tinting all of it is not; the routine writes exactly
  one `mon_attr` byte and never reads `mon_w`/`mon_h`. `mon_tile = $FF` means no block art at all
  — `draw_monsters` (`engine/battle.asm`) falls back to drawing the actor's own metasprite instead,
  which is what lets every actor in a project fight without being redrawn for it.
- **Overworld sprites and animations**: the actor's own metasprites and animations
  (`project.sprites`), the Sprite Forge's core business already.
- The monster's own **spell**: `spellId` → `mon_spell`, `$FF` meaning it only ever swings
  (`monster_turn`, `engine/battleturn.asm` — a coin flip between casting and attacking when it can
  afford the MP) — worth naming here since item 13 is where spells themselves get their Forge.

**Genuinely new in the user's ask:**

1. **The Forge itself** — monster authoring pulled out of the Sprite Forge's battle page into a
   dedicated Monster Forge, the same Items Forge precedent item 13 already cites. Where the two
   Forges' boundary actually falls is a real design question this item should record rather than
   assume: the Sprite Forge would presumably keep the actor's overworld half (metasprites,
   animations, `behavior`, `speed`, contact `damage`), but a monster *is* an actor —
   `project.sprites.actors` is one array, and deleting an actor (`sprite.js`'s "Delete actor",
   `project.sprites.actors.splice`) deletes whatever battle record it carried with it. A Monster
   Forge cannot own a monster independently of the actor underneath it the way the Items Forge owns
   an item independently of its backing Pickup actor.
2. **Monster level** — nothing exists today. Party members have levels and a level curve
   (`battletables.js` precomputes per-level stats into `pc_hp_at`/`pc_mp_at`/`pc_atk_at`/`pc_def_at`
   and the XP curve into `xp_next_lo`/`xp_next_hi`); monsters have flat, hand-set stats with no level
   dimension at all (`mon_hp`/`mon_atk`/etc. are one value per actor). What a monster's level would
   *mean* — display metadata beside its name, a stat-scaling input that derives the rest of the
   statline, or a curve of its own — is an open design question this item records rather than
   settles. If it does settle on anything derived, the no-multiply rule already governing every other
   RPG table applies here too: a scaling level is `battletables.js` build-time cost, not new engine
   code.
3. **Battle-side animations** — battle art is a static block today, with no motion and no
   attack/cast animation on a monster at all. This shares the same open "what is an animation on the
   battle screen" question item 13 records for spells (metasprite flipbook vs. `PALETTE_FX` reuse vs.
   something else) rather than restating it — the two items would want one shared answer, not two
   separately designed ones.

**Shared with item 13, not repeated here**: which bank future engine work in either Forge would draw
from — item 13's own paragraph above, which this item's battle-side animations (point 3) are equally
subject to, not a separate claim; and item 5's scope list is where both Forges' threads originate.

---

## Suggested order

1. ~~Event names, list and search; duplication; templates; play-from-here — item 2 plus the first
   piece of item 3~~ — **done**
2. ~~Variables, branching, choices, triggers, common events — item 1~~ — **done**: `EVENT_COMMANDS`
   and `IMPLEMENTED_COMMANDS` in `shared/project.js` are now identical, 21 commands to seven
3. ~~SRAM save/load — item 4~~ — **done**, one slot
4. ~~Items, equipment, status effects, battle testing — item 5~~ — **done**
5. ~~Movement routes and the audiovisual cutscene commands — item 6~~ — **done**

Item 7 (map organization and reuse) is not part of this kernel-bank-ordered sequence: it landed
later, on its own, and costs zero engine bytes (`sample/` builds to an identical ROM hash before and
after) — pure editor and data-model work with nothing to weigh against the kernel-lo budget the rest
of this section is about.

**The kernel bank is the constraint on everything below this line, and it is close to full.** Move
found it: ~395 bytes against 161 free on the worst battery board, and it only shipped by becoming
conditional. A project with both Save and Move reserves 7745 of 8192 on UNROM 512, the worst of the
three RPG-capable boards — refused outright there, by `checkCapacity` before nesasm ever runs, once
the project's own tables are added on top (`test/unit/kernelbytes.test.js`) — and 7589 of 8192 on
MMC3, the tightest board this combination actually builds on. Item 6 turned out not to be one
undifferentiated block of kernel code once it was actually costed (see its own section below):
`Turn` and `Wait` shipped as cheap, ordinary conditional kernel-lo commands needing no structural
decision at all, and `Show`/`Hide` and screen shake have since shipped the same way too — screen
shake at a measured 65 bytes, `Show`/`Hide` at a measured 49 — fitting everywhere measured, with no
documented-limitation refusal required from either. ~~That treatment belongs to `Save`+`Move`
alone.~~ — no longer true, and this corrects an earlier draft of this section: `Sting` and
switch-bound tiles have since shipped and each added a documented-limitation refusal of its own (below
and item 6's own section, above); `Show`/`Hide` itself has not required such a refusal so far.
~~`Fade` and a sound effect are not costed to a final figure yet, but expected the same way: ordinary
conditional kernel-lo code that most projects, on most boards, can simply have — a diet or a second
banked region would only be needed to also cover the *tightest* configuration (or to guarantee every
configuration universally), not to build the verb at all, the same distinction `Save`+`Move`'s own
accepted refusal already draws. A persistent tile change and camera/scroll are the two genuinely
still open for a different reason — nobody has designed either mechanism yet (a per-screen
override-tracking scheme for the tile change, a wholly new streamed-scrolling rendering path for the
camera), so neither has a real kernel-lo cost to weigh against a diet or a banked region in the first
place; camera/scroll in particular is a different kind of thing entirely, not merely a bigger
verb.~~ — both halves of this are now false, and this corrects an earlier draft of this section.
`Fade` shipped and was costed exactly as expected — ordinary conditional kernel-lo code
(`FADE_KERNEL_ALLOWANCE` 146 + the shared `PALETTE_FX_KERNEL_ALLOWANCE` 55) that most projects, on
most boards, simply have. `Flash` shipped alongside it (`FLASH_KERNEL_ALLOWANCE` 98, sharing the same
55). The music-sting half of "sound effect or sting" also shipped — not as the authored-Wait-sequence
option this file once recommended, but as a real retention-and-restoration mechanism
(`STING_KERNEL_ALLOWANCE` 175, since decomposed into `STING_KERNEL_ALLOWANCE_STANDALONE` 160 + the
shared `AUDIO_FX_KERNEL_ALLOWANCE` 15 by the sound-effect slice below — same 175 sum for a Sting-only
project) — and, on MMC3's tightest row, landed exactly where the "diet or
banked region only needed for the tightest configuration" distinction predicted: a third accepted
documented limitation, not a blocker (item 6's own section, above). The true sound effect,
independent of `Sting`, has since shipped too, as the `Sfx` command — costed at
`SFX_KERNEL_ALLOWANCE_STANDALONE` 295 bytes (310 with the shared `AUDIO_FX_KERNEL_ALLOWANCE` 15;
475 with a live `Sting` too, `STING_SFX_INTERACTION_ALLOWANCE` 5 more) — and it landed the same way:
five new documented-limitation refusals across MMC1, MMC3 and UNROM 512, each with its own named test
in `test/unit/kernelbytes.test.js`, and two fits controls confirming the both-live combination and an
item-plus-SFX-only combination still build. See item 6's own section, above, and CLAUDE.md's SFX
passage for the full figures. The persistent-tile-change reading was settled, and shipped, as
switch-bound tiles — a third design neither of item 6's original two readings anticipated
(`BOUND_TILE_KERNEL_ALLOWANCE` 388, plus a 30-byte fixed table and 2 bytes/screen), closing two
previously-comfortable rows on its own (item 6's own section, above; CLAUDE.md's "Switch-bound tiles
(design-tile.md)" passage). Camera/scroll is the one item-6 verb that was never designed and is now
split into its own roadmap entry — item 12 — for exactly the "different kind of thing entirely"
reason given above; it has no kernel-lo cost to weigh yet because no mechanism has been designed.
~~What remains open under item 6 itself: the route-authoring/preview convenience for `Move`/`Turn`/
`Wait` (pure Map Forge/compiler work, no engine cost) and a true sound effect.~~ — **done**
(`b36093e`, `84482ef`): the route-authoring/preview convenience shipped at zero engine cost, exactly as
predicted here, and the true sound effect shipped too, as the `Sfx` command (above). Item 6 is now
complete: every verb, the routes tool, switch-bound tiles, `Sting` and the SFX. Item 5 was mostly tables
and editor work; phase 4c no longer is either — it is
**done** (round 6 closed the verification gaps round 4c left outstanding, above), and it
cost 76 real bytes of kernel-lo (`ITEM_KERNEL_ALLOWANCE` 16 +
`ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg` 60, both measured, not the 65-75 estimated here
before implementation) plus a further 17 in the separate banked battle-code region. That kernel-lo
cost is exactly what this
paragraph predicted would happen: `sample-rpg` with Save and Move on MMC3 now refuses for real, by 11
bytes (re-measured against the current tree — `battle_end`'s own talk_ent fix, item 6's Turn/Wait
slice, added 3 more unconditional bytes on top of the 8 this paragraph originally recorded) —
this one is not blocked on finding a diet or a banked region, unlike camera/scroll (item 12), which
still has no built mechanism to even measure: the refusal is accepted as a documented limitation
(`checkCapacity` still offers dropping Move, dropping Save, or switching to MMC1), not a gate on
shipping. (The persistent-tile-change comparison this sentence used to draw no longer applies: that
reading shipped as switch-bound tiles, and item 6's own section above and CLAUDE.md now measure its
cost directly rather than leaving it undesigned.)

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
