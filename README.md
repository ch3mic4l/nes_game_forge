# NES Game Forge

Make NES games through a UI. Draw tiles, paint maps, build the cartridge, and
play the result — with a full debugger — without leaving the app.

Inspired by [NESmaker](https://www.thenew8bitheroes.com/). Runs on Linux today;
the stack (Electron) is cross-platform, so Windows packaging is a build step
rather than a rewrite.

```sh
npm install
npm start          # launch the app
npm test           # unit tests
npm run smoke      # end-to-end: boots the real UI and drives it
```

## What works today

| Area | State |
|---|---|
| **Tile Forge** | Done — pixel editor, 1×1/2×2/4×4 regions, palettes, image import with dithering, CHR/PAL import & export |
| **Map Forge** | Done — metatile editor, screen painting, multi-screen maps, collision overlay, actor placement, player start, dialogue and events |
| **Sprite Forge** | Done — metasprite assembly, animation timeline with live preview, actors bound to behaviours |
| **Sound Forge** | Done — tracker for all four channels, instruments, order list, preview through the same replayer the ROM agrees with |
| **Controller Forge** | Done — buttons bound to engine actions per game state, plus keyboard bindings for the player |
| **Build & Play** | Done — generates assembly, assembles with `nesasm`, verifies the ROM, plays it in-app |
| **Emulator + debugger** | Done — breakpoints, step/over/out, scanline & frame step, disassembly with symbols, memory editor, PPU viewers |
| **Turn-based RPG mode** | Done — party, spells, monster stats, encounters, FF-style menu battles with XP, gold, levels, elements and drops |
| **Tutorial** | Done — a guided tour of every Forge under 🎓 Learn in the rail, with jumps into the Forge each topic explains |

All five Forges are built. The engine behind them is a top-down adventure; other
genres would need new engine modules rather than new UI.

The player character is drawn in the **Tile Forge**, not the Sprite Forge: the
engine reads four directions × two walk frames from **sprite tiles `$00`-`$1F`**
in order (down, up, left, right — four tiles each, top-left, top-right,
bottom-left, bottom-right). Use the 4×4 region size in the *Sprites* tab. While
those tiles are all empty the build draws a placeholder player into the ROM, so a
new project is playable straight away.

Everything else on screen is an **actor**: build a metasprite in the Sprite
Forge, animate it, give it a behaviour, then place it with the Map Forge's ☗
tool. The engine runs up to eight per screen and respawns them on entry.

| Behaviour | What the engine does |
|---|---|
| Patroller | Walks in a straight line, reverses at a wall or the screen edge |
| Chaser | Steps towards the player on each axis, so walls deflect rather than stop it |
| Pickup | Disappears when touched, counts up, and goes into the inventory |
| Door | Warps the player to another screen and position, set in the Map Forge |
| NPC | Stands still. What a chest or a standing character wants: it can be talked to and never wanders out of reach |
| Player | Marks the player actor; spawned from the Map Forge start position |

Actors face where they are going, and draw the animation you assigned to that
facing — `walkDown`, `walkUp` or `walkSide`, each falling back to `idle` when
left empty. A chaser faces whichever axis the player is furthest away on.

The D-pad always walks — and moves the highlight while a menu is open. A, B,
Select and Start are bound in the **Controller Forge** and compiled into a table
the engine reads every frame, so rebinding is a data change rather than an engine
change. Every action runs:

| Action | What the engine does |
|---|---|
| Attack | Beats the nearest non-pickup actor within 20 pixels |
| Interact | Collects a nearby pickup without walking onto it, or talks to any other actor in reach — showing its dialogue if it has any |
| Dash | Doubles walking speed while held |
| Pause | Freezes the player and every actor until pressed again |
| Item | Opens the inventory — the pickups you are carrying — and closes it again |
| Confirm | Spends the highlighted item, or turns the page of a conversation |
| Cancel | Closes the inventory, or turns the page of a conversation |

The table has one row per **game state**, and the state decides which row the
engine reads. There are three, and the two beyond `gameplay` are what `Item`,
`Cancel` and `Confirm` exist for:

| State | Entered by | While it is open |
|---|---|---|
| Walking around | — | The world runs |
| In a menu | The `Item` action | The world freezes; your pickups are laid out along the top and the D-pad picks one |
| Reading dialogue | Interacting with an actor that is not a pickup | The world freezes and the actor speaks |

The menu draws no box and no text: all 256 background tiles of a tileset belong
to the Tile Forge, and the engine will not take tiles for a menu. It is drawn
with sprites made of art the project already has — the pickups you are carrying,
laid out along the top.

Dialogue is where the engine does spend tiles, and only if you ask it to. Give a
placed actor something to say in the Map Forge and it gets a **message box**: a
window along the bottom of the screen, text typed out a letter at a time, ▼ to
turn the page. That costs background tiles `$A0–$FF` of *every* tileset, which
the Tile Forge shades and refuses to build over, and the cost is only paid by a
game that shows text — one that never does keeps all 256. On **MMC3** even a
game that shows text keeps all 256: the font gets a graphics bank of its own,
and the cartridge's scanline interrupt switches it in exactly where the text
windows start (see The cartridge below). An actor with nothing to say still
gets the older behaviour: it simply appears, and any button ends the
conversation.

So an action bound in the Controller Forge does what the panel says it does. An
action that means nothing in a state (confirm while walking around, attack from
inside a menu) is ignored there rather than reinterpreted, and the panel says so.

## Events

A line of dialogue is the simple case. **Event…** in the Map Forge is the rest of
it: an actor gets a list of **pages**, and the engine runs the first page whose
condition holds. A page can show text, give or take an item, turn one of 64
**switches** on or off, or warp the player.

That is the whole trick behind a chest that opens once — page one is guarded by
*switch off*, and the last thing it does is turn that switch on, so from then on
page two answers instead:

| Page | Condition | Does |
|---|---|---|
| 1 | Switch `Chest opened` is off | Say "a gem glitters up at you", give the Gem, turn on `Chest opened` |
| 2 | Always | Say "the chest is empty now" |

Switches survive screen changes and warps, so they are also how an actor stops
being there: **Gone once …** on a placed actor means it simply does not spawn
once that switch is on. Name the switches with the **Switches…** button — the
engine only ever sees 64 bits, but the editor reads much better with words.

Only commands the engine implements are offered. Anything a newer version of the
Forge wrote is preserved through a save, so a project never loses work by being
opened here.

## Health, damage and dying

An actor with **contact damage** above zero costs the player a heart on touch; a
metatile with the **Damage** collision type does the same to anyone standing on
it. Either way the player is thrown clear, flickers, and is invincible for a
second — long enough to get out of whatever hit them.

Hearts appear along the top of the screen. Actors have **hit points** too, so an
attack takes one off and only the last one beats them; an actor left at one hit
point behaves exactly as it did before health existed.

All of this is conditional. A game where nothing does damage draws no health bar
and spends no tiles on one: `COMBAT_ENABLED` is off, and the two sprite tiles the
hearts would take stay yours.

Running out of hearts is **GAME OVER**, and Start from there goes back to the
title — or straight into a new game if the project has no title. Either way it is
a genuinely new game: hearts, bag and switches all reset.

## The title screen

Point **Title screen** in the Map Forge at any screen in the project and the
cartridge boots into it: that screen, with the game's name and a blinking
`PRESS START` written over it. The Controller Forge gains a title row while one
is set — by default A confirms, so Start or A begins play — but **Start always
works**, whatever the row says: a title you could not get past because of a
rebinding would be a trap.

The two bands the text lands in — metatile rows 4–5 and 8–9 — are recoloured to
background palette 0, because otherwise whether the title is readable would
depend on what art happens to sit underneath. Leave them clear.

## Turn-based RPGs

Choose **Turn-based RPG** when you create a project and the cartridge gains a
battle system: random encounters, a menu battle with FIGHT / MAGIC / ITEM / RUN,
experience, gold, levels, elements and drops.

That choice is made once, up front, because it decides the cartridge as well as
the engine. The battle system is far too big for the fixed part of the ROM, so it
lives in a **switchable program bank** — and its monsters are drawn from a
switchable **graphics** bank. Boards without both are greyed out in the Build
panel with the reason; new RPG projects start on **MMC1**, which is what Final
Fantasy shipped on.

| Where | What you set |
|---|---|
| Sprite Forge ▸ *Party* | Up to four members: base stats, growth per level, which spells they learn and when |
| Sprite Forge ▸ *Party* ▸ Spells… | The spell list — cost, damage or healing, element, one target or all |
| Sprite Forge ▸ *Actors* ▸ *In battle* | A monster's attack, defence, accuracy, evasion, speed, experience, gold, weakness, resistance and what it drops |
| Map Forge ▸ *Battles here* | The sky and ground a battle is fought against, how many steps between encounters, and which monsters turn up |
| Build ▸ *RPG progression* | The experience curve, the level cap, and which tileset holds the monster art |

An actor becomes a monster by having **contact damage above zero** — the same
field an action game uses for spikes. Walking into one you placed on the map
starts a fight you cannot run from; the step counter starts ones you can.

Members past the first are recruited in play with an event's **Party member
joins** command — the sample's Iris waits in a corner of the field for exactly
that. A monster given a spell under *Casts* uses its own MP pool and casts about
half the time; a **Poison** spell (either side can carry one) marks its victim,
who then loses 2 HP after each of their turns until a heal or a potion cures it
or the battle ends.

A monster can be drawn either way. Give it **battle artwork** — a block of
background tiles on the battle tileset — and it appears as a proper monster
portrait; leave it off and the engine draws its ordinary animation as sprites, so
every actor you already have can fight without being redrawn.

An **item** is just an actor with a *Heals* value: pick it up on the field and it
appears in the battle's ITEM list.

```sh
npm run sample:rpg          # write the RPG demo to ./sample-rpg
npm run build:sample:rpg    # assemble it
```

## Music

The **Sound Forge** is a tracker: rows of notes across two pulse channels, the
triangle and the noise channel, grouped into patterns and arranged by an order
list with a loop point. Instruments carry a duty cycle and a volume envelope
(the triangle ignores both, because the NES gives it neither). Assign a song to
a map in the Map Forge and the engine starts it at boot.

The format is defined once, in `shared/audio.js`, and implemented three times:
by the 6502 driver in `engine/music.asm`, by the compiler in
`main/build/songcompile.js`, and by the preview replayer in
`renderer/forges/sound/replayer.js`. A golden test runs the built ROM in the
emulator, records every write to `$4000-$400F`, and asserts it is byte-identical
to what the replayer produces for the same song — so the preview cannot drift
away from what the cartridge plays. Only the *timbre* of the preview is an
approximation; pitch, rhythm and volume are exact.

## Try it

```sh
npm run sample                        # write the demo project to ./sample
npm run build:sample                  # assemble sample/build/game.nes
npm start                             # Open… -> sample, then Build & Play
```

The sample is a 2×2-screen field with trees, a pond, a stone ruin, working edge
transitions, a chaser and collectable gems. Walk down to the patrolling slime and
press B: it has two pages to say, which is the message box. The chest on the
south-west screen is the event system — it gives a gem the first time and is
empty ever after. The north-east screen has a Wanderer who leaves for good once
spoken to (a switch hides the actor), and the pond room's corner grows a thorn
patch — a painted *damage* metatile — beside the Bramble that guards it.

**Older projects load as they are.** New fields (events, the party, spells,
battle stats, encounter tables, the title screen) are filled with defaults on
load, and a project saved by a newer version of the Forge round-trips through
this one: unknown event commands are kept, compiled, and stop the event cleanly
in the ROM rather than being reinterpreted. The one thing that cannot be
retrofitted is the game type — *Action adventure* vs *Turn-based RPG* is chosen
at creation, because it decides the cartridge.

## How a project is stored

A project is a folder of JSON, so it diffs cleanly in git:

```
MyGame.forge/
  project.json      name, engine version, cartridge/mapper, player start
  tiles/            tilesets.json plus one folder per tileset, each holding
                    background.json and sprites.json — 256 tiles each, one
                    64-character string per tile
  palettes.json     four background and four sprite palettes
  metatiles.json    64 metatiles: four tiles, a palette, a collision type
  maps/0.json       a grid of screens; each screen is 16×15 metatile ids
  sprites.json      metasprites, animations, actors
  input.json        button → action, per game state
  build/            generated — assembly, CHR, game.nes. Never hand-edit.
```

## The cartridge

The cartridge type is a per-project setting, chosen in the Build panel:

| mapper | program | graphics | tilesets | screen banks |
|---|---|---|---|---|
| **NROM-256** (default) | 32 KB | 8 KB fixed | 1 | 1 |
| **CNROM** (3) | 32 KB | 32 KB | 4 | 1 |
| **GxROM** (66) | 32 KB | 32 KB | 4 | 1 |
| **Color Dreams** (11) | 32 KB | 128 KB | 16 | 1 |
| **UxROM** (2) | 128 KB | 8 KB fixed | 1 | 7 |
| **MMC1** (1) | 128 KB | 128 KB | 16 | 7 |
| **MMC3** (4) | 256 KB | 256 KB | 32 (31 with text) | 15 |
| **UNROM 512** (30) | 512 KB | 32 KB of RAM | 4 (3 four-screen) | 31 − tilesets |

Every cartridge uses the same PRG layout, which is what lets one engine template
serve all of them: the last 16 KB is a fixed kernel holding the engine code, the
lookup tables and the music, and `$8000-$BFFF` is a switchable window holding
nothing but screen data. NROM is the degenerate case with one switchable bank, so
it never switches. A map names the tileset it draws with, and `set_screen_ptr` is
the single place a program bank is selected.

**UNROM 512** also offers **four-screen mirroring** — four independent nametables
instead of two mirrored pairs — which no other board here can provide. It is not
free: the extra nametables are backed by the last CHR-RAM page, so choosing it
drops the tileset ceiling from 4 to 3. And the engine only ever draws nametable 0,
so the extra nametables are currently unused; pick four-screen for cartridge-board
compatibility, not for anything the engine does with it today. The Build panel says
as much when it is selected.

**UNROM 512** is the odd one out in another way too: it has no graphics ROM at all. Its four pattern
pages are RAM, and the engine streams each tileset into them from program space at
boot — so on that board tilesets cost screens rather than graphics space, which is
why its screen-bank count depends on how many tilesets you author. It is also the
only board needing a NES 2.0 header, because iNES cannot declare CHR-RAM; the
build rewrites the 16-byte header after assembly for that mapper alone.

Every mapper listed is fully implemented — the Build panel offers nothing it
cannot build. **MMC3's scanline interrupt** is wired up, and the engine spends
it on the most useful split there is: a project that shows text keeps all 256
background tiles. On every other board the 96 font glyphs are stamped over
tiles `$A0–$FF` of every tileset; on MMC3 they live in one extra graphics page
of their own, and the interrupt switches that page in mid-frame exactly where
the text windows begin — the message box, the battle box, and the title's two
text lines — then hands the map its own art back at the top of the next frame.
The Tile Forge stops shading the range the moment the project's mapper is MMC3,
and the same rule frees battle artwork to use the full 256 tiles. The one thing
it costs is one CHR page (32 tilesets become 31) — and, because the battle
targeting cursor points at monsters *above* the split, that cursor becomes a
sprite on this board, reserving sprite tile `$FD` the way combat reserves the
two heart tiles.

A **tileset** is one 8 KB graphics bank: a 256-tile background table plus a
256-tile sprite table. Those two halves are what the Tile Forge's Background and
Sprites tabs edit, and the hardware switches them together — so a tileset is the
unit that gets swapped, and each map names the tileset it draws with. On NROM
there is exactly one, which is why `nesasm` can write a correct iNES header with
no post-processing.

Capacity, all enforced with plain-language errors before the assembler runs:

- 256 background tiles + 256 sprite tiles per tileset
- 64 metatiles, each 16×16 pixels with its own palette and collision type
- 52 screens per program bank (1 bank on NROM, up to 15 on MMC3)
- 8 actors per screen

A 16×16 metatile lines up exactly with one NES attribute square, which is why
every metatile can carry its own palette with no compromise.

## The engine

`engine/` is a small top-down adventure in 6502 assembly (nesasm syntax). One
screen is one nametable; walking off an edge loads the neighbour. The generator
emits every value the engine and the tooling both depend on into
`assets/config.inc`, so there is exactly one writer for each and the two cannot
drift apart.

```
engine/main.asm       header, bank layout, includes
engine/constants.asm  zero page map
engine/boot.asm       reset, main loop, NMI
engine/screens.asm    expanding metatiles into a nametable
engine/player.asm     movement, collision, edge transitions
engine/entities.asm   actor spawning, behaviour and drawing
engine/oam.asm        the player metasprite
engine/ui.asm         the inventory menu and the dialogue state
engine/text.asm       the NMI VRAM queue and the message box
engine/script.asm     running an actor's event
engine/combat.asm     hearts, contact damage and the game-over screen
engine/title.asm      the screen the cartridge boots into
engine/rpg.asm        the kernel's half of the battle system: RNG, encounters
engine/battle.asm     the battle system itself, in a switchable bank
engine/battleui.asm   its menus, lists, cursor and messages
engine/battleturn.asm its turn order, damage and outcomes
engine/input.asm      controller read and button-action dispatch
engine/music.asm      the song driver
```

## The emulator

`renderer/emulator/core/` is a vendored [jsnes](https://github.com/bfirsh/jsnes)
(MIT), patched to render with the same 64 colours the editors draw with — see
`FORGE-PATCHES.md` in that directory for why and what else changed. Run control
lives outside the core in `runcontrol.js`, so the vendored code stays close to
upstream and stays upgradeable.

"Open in Mesen" is always available for the cases a JavaScript emulator cannot
cover.

The screen defaults to **Fit** — the largest whole number of screen pixels per
NES pixel that the window has room for, recomputed when the window resizes or the
debugger opens. 1×, 2× and 3× pin it instead. The Map Forge's zoom works the same
way, and the Tile and Sprite Forge editors are always fitted, so a bigger window
is a bigger drawing area.

## Testing

- `npm test` — unit tests for the CHR codec, quantiser, project schema, the 6502
  disassembler and the music compiler, plus integration tests that boot the
  sample ROM headless and check rendering, input, actor behaviour, the button
  actions, and that the music driver matches the preview replayer write for
  write.
- `npm run smoke` — launches the real Electron window and drives it: creates a
  project, edits tiles, undoes and redoes, saves and reloads, visits every Forge,
  paints a map, builds the sample, runs it in the emulator, fires a breakpoint,
  single-steps. Fails on any console error. `FORGE_SHOT=out.png` also writes a
  screenshot.
- `Mesen --testRunner test/lua/engine_smoke.lua sample/build/game.nes` — drives
  the ROM on a second, independent emulator, so Mesen and the built-in core
  cross-check each other. Exit code 0 means every phase passed.

## Requirements

- Node 20+ (developed on 22)
- `nesasm` v3.1 on `PATH` (or set its path in settings)
- Mesen 2, optional, for "Open in Mesen"

`npm start` passes `--no-sandbox` because Ubuntu 24.04's AppArmor policy blocks
unprivileged user namespaces, so Electron cannot use its normal sandbox. To run
with the sandbox instead:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
npm run start:sandboxed
```
