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

The vocabulary is the constraint. There are four page conditions (`EVENT_CONDITIONS`) and seven
commands (`EVENT_COMMANDS`, minus `end`) in `shared/project.js:147`. Every one of them is
implemented end to end — that invariant holds and must keep holding — but seven verbs is a small
language, and quests, shops, puzzles, cutscenes and boss fights are all currently reachable only
through the Code Forge.

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
- **Triggers**: interact (today's behaviour), player-touch, autorun-on-entry
- **Common events**: one event body callable from many places, so a chest or a shop is authored once
- Commands for starting a **battle**, changing **music**, **moving an actor**, and
  **healing/damaging** the party

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

## 4. Cartridge save/load

Progression is impractical for anything substantial that cannot survive power-off, and the RPG mode
needs it most. Nothing in the codebase touches battery-backed PRG-RAM today.

- Battery-backed SRAM where the mapper permits it — which makes it a `shared/cartridge.js` question
  first (which entries can declare it, what the iNES header byte 6 bit 1 and NES 2.0 PRG-RAM fields
  must say), and `headerPatch()`'s problem after that
- **Continue** on the title screen
- One or a small fixed number of **slots**
- **Autosave** at explicit event checkpoints, rather than anywhere
- A compact **save record**: location, switches, variables, inventory, party, levels, HP/MP, XP, gold
- **Checksum** plus a project/version identifier, so a stale or corrupt save is refused rather than
  loaded as garbage

The save record is a wire format between the engine and nothing else, but the single-writer rule
still applies: its layout belongs in one generated header, not spelled out in both `engine/` and
whatever writes it.

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
- **Starter projects** — action, dungeon crawl, RPG — beyond today's two fixtures

Anything shipped here needs its license recorded in the repo, and the two existing fixtures
(`sample/`, `sample-rpg/`) stay exactly as they are: tests are written against them and they may
not be mutated.

---

## Suggested order

1. ~~Event names, list and search; duplication; templates; play-from-here — item 2 plus the first
   piece of item 3~~ — **done**
2. Variables, branching, choices, triggers, common events — item 1 — **in progress**: variables,
   branching and choices are done; triggers and common events are what is left
3. SRAM save/load — item 4
4. Items, equipment, status effects, battle testing — item 5 plus the rest of item 3
5. Movement routes and the audiovisual cutscene commands — item 6

Stages 1 and 2 are the ones that change what the app *is*: together they move Forge from a capable
NES construction toolkit toward building a complete game mostly through data and menus — with the
Code Forge still there as the escape hatch, which is the point of having it.
