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
- **Battle-test** a selected encounter without walking into it
- A runtime **switch/variable inspector** (the debugger already reads engine RAM; this is a labelled
  view of it, and item 1's variables make it much more useful)
- Toggles for **invincibility**, **encounters off**, **collision off**
- **Reload the ROM** while keeping the selected test scenario
- **Screenshot / GIF capture** from the emulator panel

The honesty rule applies here: a test-play override must not be able to end up in a built ROM. Play
from here settled the shape the rest of these should follow — `renderer/emulator/testplay.js` pokes
engine RAM once the ROM is running and the build knows nothing about it, so the ROM is unpatched by
construction rather than by a flag somebody has to clear. It also settled where the addresses come
from: `shared/enginesyms.js` parses them out of the `constants.asm` the build assembled, so engine
RAM keeps exactly one definition.

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
kind of reason it is cheap: it costs no ROM at all. Item 1 made 64 switches and 16 variables the
backbone of every condition, branch and question, and the only way to watch one at runtime is
unlabelled bytes in the memory editor — which is exactly what item 3's switch/variable inspector is.

Stages 1 and 2 are the ones that change what the app *is*: together they move Forge from a capable
NES construction toolkit toward building a complete game mostly through data and menus — with the
Code Forge still there as the escape hatch, which is the point of having it.
