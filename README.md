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
| **Map Forge** | Done — metatile editor, screen painting, multi-screen maps, collision overlay, actor placement, player start, dialogue and events; reorder and duplicate maps and screens, and organize maps with folder labels once a project outgrows one screenful (see below) |
| **Sprite Forge** | Done — metasprite assembly, animation timeline with live preview, actors bound to behaviours |
| **Items Forge** | Done — name, effect (None for a key item, or Heals/Damages with an amount) and, optionally, the linked Pickup actor; also reachable via a scripted Give item command or a monster's drop |
| **Magic Forge** | Done — name, kind, a min/max damage or heal range, MP cost, element and scope, for turn-based RPG projects only; a party member's own learned spells stay on the Sprite Forge's Party tab |
| **Sound Forge** | Done — tracker for all four channels, instruments, order list, preview through the same replayer the ROM agrees with |
| **Controller Forge** | Done — buttons bound to engine actions per game state, plus keyboard bindings for the player |
| **Code Forge** | Done — the engine's 6502 source in a tabbed editor with syntax highlighting; edits are kept per project, and you can add your own `.asm` files |
| **Build & Play** | Done — generates assembly, assembles with `nesasm`, verifies the ROM, plays it in-app |
| **Emulator + debugger** | Done — breakpoints, step/over/out, scanline & frame step, disassembly with symbols, memory editor, a labelled switch/variable inspector, PPU viewers, invincibility/encounters-off/collision-off test toggles (collision-off is terrain only — screen transitions, damage tiles and door triggers still work; invincibility covers floor hazards only in an RPG, not battle damage), and a "↻ Reload Test" control that rebuilds the project and resumes whichever play-from-here or battle-test scenario is running — a named map, screen or actor is found again by that name even after other changes elsewhere, but renaming the one actually being tracked makes it refuse rather than guess, and an unnamed screen has no name to follow at all, so it's found again by its position within its map instead, which resizing that map can retarget or lose, plus 📷 Shot and ⏺ Record, which write a PNG of the screen at its native 256×240 and an animated GIF of what plays out (every third emulated frame, 20 fps, up to 300 frames / ~15 s) (ordinary ▶ Build & Play always starts fresh from the project's own start instead; a build that fails leaves whatever was already running untouched) |
| **Turn-based RPG mode** | Done — party, spells, monster stats, encounters, FF-style menu battles with XP, gold, levels, elements and drops |
| **Tutorial** | Done — a guided tour of every Forge under 🎓 Learn in the rail, with jumps into the Forge each topic explains |

All eight Forges are built. The engine behind them is a top-down adventure; other
genres would need new engine modules rather than new UI — or the Code Forge, which
is the escape hatch when the UI does not offer what you want.

Where this could go next is written down in [ROADMAP.md](ROADMAP.md), which is also
where the reasoning behind what has already been built out of it lives — authoring
tools for large projects, most of the event vocabulary, and cartridge saves have
landed since it was written. This table is the account of what is.

### The Code Forge

Every source file that goes into the ROM, in a file tree with tabbed editors.

Editing an engine file does not change the app: the edit is saved into your
project as an override, and the build lays it over the original. So one project's
custom code cannot leak into another, an untouched project builds exactly as it
always did, and **Revert** puts the original back. Overridden files are badged
*edited* in the tree.

You can also add files of your own. They are assembled into the fixed bank at
`$C000`, which every mapper leaves permanently mapped, so a label you define is
callable from anywhere:

```asm
; my_hooks.asm — your own file
my_routine:
  lda #$01
  sta some_engine_variable
  rts
```

then, in an engine file you have edited, `jsr my_routine`.

Hand-written code is the one thing the capacity check cannot measure — how much a
source file assembles to is not knowable from its text — so the assembler enforces
the bank limits instead. When it refuses, the Build panel's error line is
clickable and opens the file at the line that caused it.

The generated `.inc` files are listed too, read-only: they are rewritten from your
project on every build.

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
| Pickup | Disappears when touched and counts up either way; goes into the inventory too, unless the project has items authored and none of them names this actor, or the bag is already full |
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
| Item | Opens the inventory — the items you are carrying, however they were collected — and closes it again |
| Confirm | Spends the highlighted item and applies its effect (a key item is kept, not spent), or turns the page of a conversation — or answers the question it is asking |
| Cancel | Closes the inventory, or turns the page of a conversation — or answers the question it is asking |

The table has one row per **game state**, and the state decides which row the
engine reads. There are three, and the two beyond `gameplay` are what `Item`,
`Cancel` and `Confirm` exist for:

| State | Entered by | While it is open |
|---|---|---|
| Walking around | — | The world runs |
| In a menu | The `Item` action | The world freezes; your items are laid out along the top and the D-pad picks one |
| Reading dialogue | Interacting with an actor that is not a pickup | The world freezes and the actor speaks; if it asks something, the D-pad moves the cursor between the answers |

The menu draws no box and no text: all 256 background tiles of a tileset belong
to the Tile Forge, and the engine will not take tiles for a menu. It is drawn
with sprites made of art the project already has — the items you are carrying,
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
condition holds. A page can show text, ask the player a question, give or take an
item, turn one of 64 **switches** on or off, count with one of 16 **variables**,
warp the player, or change the music with **Play music…** — the same choice of
songs, plus Silence, the Map Forge's own Music field offers.

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

A switch answers yes or no. When you need to *count* — three gems handed over,
what stage a quest has reached, how many times somebody has been asked — that is
a **variable**: sixteen bytes holding 0 to 255, named with **Variables…** and
living exactly as long as the switches do. A page can set one, add to it or
subtract from it, and a page condition can ask whether one *is*, *is at least* or
*is under* a number:

| Page | Condition | Does |
|---|---|---|
| 1 | `Gems` is at least 3 | Say "that will do — take this", give the Sword |
| 2 | Always | Say "bring me three gems", add 1 to `Gems` |

Adding and subtracting stop at 255 and 0 rather than wrapping round, because a
counter that rolls over is a quest that silently starts again.

A page condition decides which page runs *before* it runs. **If…** decides in the
middle of one: it takes the same conditions a page does, and holds two lists of
commands — **Then** and **Else** — either of which can hold another If. So "say
hello, then hand over the reward but only if they are carrying the key, then say
goodbye" is one page rather than two that both repeat the hello and the goodbye.

**Ask a question…** puts that decision to the *player* instead. It holds up to
four answers — one per row of the message box — each with its own list of
commands, and the message box lists them with a cursor the D-pad moves:

| | |
|---|---|
| Say | "Ten gold for the lantern. Well?" |
| Ask | **Pay up** → subtract 10 from `Gold`, give the Lantern, say "pleasure doing business"<br>**Not today** → say "suit yourself" |

An answer holds anything a page holds, including another question or an If, and
whatever the player picks, the page carries on underneath it. Either button
answers with whatever the cursor is on — to this box both have always meant "go
on", and a question is it asking which way rather than a second thing to back
out of.

**When** an event runs is set on the placed actor, beside the event itself:

| Trigger | When it runs |
|---|---|
| When talked to | The player walks up and presses interact — what every event did before there were triggers |
| When touched | The player walks into it. It happens again only after walking away and back, so standing on it does not restart the conversation forever |
| When the screen loads | Straight away, every time that screen is entered — the opening of a scene. Guard it with a switch if it should only happen once |

A trigger is a choice, not a set: an actor set to *When touched* does not also answer the interact
button. *When touched* is offered only where nothing else already owns being walked into — a pickup
is collected, a door is gone through, and in an RPG anything that deals damage starts a battle. Only
one actor per screen can run its event as the screen loads; the Map Forge says which one it is.

A chest, a shop and a recurring cutscene often say the same thing. **Common events…**, beside
Switches and Variables, is a list of event bodies with names instead of a place — written once and
reached from anywhere with **Run common event…**, which runs the named one's own pages exactly as
an actor's own event would and comes back to the command after it once the common event runs out of
pages. Common events are free to call each other, and the engine bounds how deep that can nest, so a
pair that call one another back and forth unwind instead of freezing the game.

**Move actor** walks somebody — the actor whose event it is, or the player — a set distance in one
direction, and the event *waits* while it happens, so the command after it does not run until the
walk is done. That is what makes a small cutscene possible: a guard steps aside, then says
something. Distance is in pixels, 16 to the metatile. A walk that runs into a wall or the edge of
the screen stops where it is and the event carries on rather than waiting forever — you cannot
always tell from the editor what will be standing there when the scene actually plays.

Move is the most expensive command in the engine, and it is only built into cartridges that use one.
A project with no Move — or whose only Move is switched off — is exactly the ROM it would have been
before the command existed. If a project cannot afford it, the Build panel says so in plain language
rather than letting the assembler refuse it.

Only commands the engine implements are offered. Anything a newer version of the
Forge wrote is preserved through a save, so a project never loses work by being
opened here.

### Working on a project with a lot in it

Things worth knowing about the Map Forge once a project is more than a screenful:

- **Template…** writes the two-page pattern above for you — a chest, a one-off
  greeting, a gate that opens for whoever carries the key, or (in an RPG) a
  recruit. It picks the lowest switch nothing else is using and opens in the
  editor, so it is a draft rather than a decision.
- **Find…** searches every placed actor in the project — names, dialogue, and
  what each event does. Because the rows read with the names resolved, searching
  a switch's name finds everything that sets, clears or tests it, and searching a
  screen's name finds every warp that leads there. Picking a result takes you to it.
- **Name a screen** and **name a placed actor**, and they read that way
  everywhere: warp targets, door targets, the title-screen picker, search results.
  Both are for you — neither reaches the ROM.
- **▲ ▼** next to the map picker move the current map earlier or later in the
  list — every door, warp and title/start setting anywhere in the project
  still points at the same room afterward, in one undo. **⧉** beside them
  duplicates the whole map under an auto-suffixed name: a door or warp inside
  the copied map that pointed *within* it now points at the corresponding
  screen in the copy, and one that pointed elsewhere in the project still
  points at that same original screen — the project's own title and start
  stay on the originals, never on a copy.
- **Folder**, in a map's own settings, groups it under a label of your choosing —
  the map picker then reads `[Dungeons] Cave 1` instead of just `Cave 1`. It's
  a flat label, not a tree, and it's for you: it never reaches the ROM.
- **⧉** next to a screen's own name duplicates just that screen. It grows the
  current map to fit if there's room; if not, it offers a picker of another map
  with room; if every map is already full (4×4), it promotes the screen straight
  to a brand-new map of its own. On the copy, a door or warp that pointed back
  at the screen being duplicated now points at the copy itself instead; one
  that pointed anywhere else still points at that same original screen.
  Duplicating across two maps with different tilesets warns that the art may
  not look the same on the copy.
- **▦ Select** drags out a rectangle of metatiles — and, with **Include actors**
  checked, whatever is placed inside it — to **Copy**, then **Paste region**
  drops it anywhere: the same screen, a different screen, even a different map.
  Pasting into a map with a different tileset warns the art may not match;
  pasting more switch-bound tiles or actors than a screen can hold is refused
  outright, with the exact count, rather than silently dropping some of them.
- **Deleting a map** always asks you to confirm first, and now says how many
  doors and warps elsewhere in the project point at a screen it's about to
  remove, if any do. **Shrinking one** small enough to drop screens off its
  grid asks the same way, but only when a door or warp actually points at a
  screen the resize would remove — shrinking off only unreferenced screens
  commits with no prompt, and growing never prompts at all. Say yes to either
  and every reference is repaired in the same step, not left pointing at
  whatever now happens to sit
  at the old number.
- **⧉** copies an actor with its dialogue and its event, **+⧉** drops another one
  beside it, and inside an event, ↑ ↓ ⧉ reorder and duplicate pages and commands.
  The checkbox on a command switches it **off** without deleting it: it stays in
  the project and leaves the ROM. Switch off everything on a page and the page
  leaves too, because a page that matches and does nothing would swallow every
  page below it — the editor says so before you save.
- **▶ Test** builds the project and plays it from the spot you click, so trying
  out a screen does not mean walking there first. The cartridge is not changed to
  do it: it still starts where ⚑ Start says, and the player is moved once the ROM
  is already running — which is why ⟳ Reset in the player drops you back at the
  real start, and why nothing you could ship can carry a test position.
- **↻ Reload Test**, next to ⟳ Reset once ▶ Test or a battle-test has one running,
  rebuilds the project and puts you back in the same test. A named map, screen
  or actor is found again by that name even after other changes elsewhere — but
  renaming the one actually being tracked makes it refuse rather than guess, and
  two things sharing a name it can no longer tell apart refuses too. An unnamed
  screen has no name to follow at all, so it's found again by its position
  within its map instead, which resizing that map can retarget or lose.
  Elsewhere, ▶ Build & Play always starts from the
  project's own ⚑ Start instead, whether or not a test is running — only this
  button resumes one.
- **📷 Shot** writes a PNG of the screen exactly as the NES produced it —
  256×240, whatever zoom you are viewing at, since the zoom is how *you*
  are looking at it rather than what the console drew. It saves exactly
  what is on screen: running or paused that is the last complete frame,
  but after an instruction or scanline step it is the half-drawn frame
  the debugger is showing you, which is the point of looking at it.
- **⏺ Record** captures an animated GIF of what plays out and turns into
  **⏹ Stop**, counting the seconds it has. It records *emulated* frames,
  not wall-clock time: pausing adds nothing, and stepping adds only the
  frames actually stepped. GIF's timing unit is a hundredth of a second,
  which cannot express 60 frames a second evenly, so every third frame
  is kept and the file plays at 20 fps — 0.16% slower than the game
  itself, and slow enough that viewers do not disagree about how to time
  it. It stops on its own after 300 frames (about 15 seconds) and says
  so. Closing the player, leaving the Forge or hitting ↻ Reload Test
  ends a recording without saving it, and says that too.

## Health, damage and dying

An actor with **contact damage** above zero hurts the player on touch; a metatile
with the **Damage** collision type does the same to anyone standing on it. Which
health that means is whichever one the cartridge actually has. In an action game
it costs a heart, throws the player clear, and starts a second of flicker and
invincibility — long enough to get out of whatever hit them. In a turn-based RPG,
walking into a damaging actor starts a fight instead of taking a hit directly, and
a Damage metatile costs the whole party HP on the spot — no knockback, just a
short cooldown so standing on it does not drain the party every frame.

Hearts appear along the top of the screen in an action game; a turn-based RPG
shows HP in the battle box instead. Actors have **hit points** too, so an attack
takes one off and only the last one beats them; an actor left at one hit point
behaves exactly as it did before health existed.

All of this is conditional. A game where nothing does damage draws no health bar
and spends no tiles on one: `COMBAT_ENABLED` is off, and the two sprite tiles the
hearts would take stay yours. A turn-based RPG never draws hearts at all, whatever
deals damage — it shows HP in the battle box instead, so those two tiles are
always free there, and the engine code that would have drawn them is not even
assembled into the cartridge.

Running out of hearts is **GAME OVER** — in a turn-based RPG, that is every
recruited party member reaching zero HP instead — and Start from there goes back
to the title, or straight into a new game if the project has no title. Either way
it is a genuinely new game: hearts (or the party), bag and switches all reset.

An event can change health directly, without anything having to hit anybody:
**Heal** and **Damage** each take a number from 0 to 255, so a trap that costs two
hearts and a spring that gives them back are both a single command. Which health
they mean is whichever one the cartridge actually has — the player's hearts in an
action game, every recruited party member's HP in an RPG — so the same command
means the obvious thing in either, and a painted Damage metatile now means exactly
the same thing the command does. **Heal 255** is a full heal, and in an RPG it
revives a fallen member the way an inn would. Damage that empties the bar ends the
game exactly as walking into a spike would.

## Saving

Give the player a **Save the game** command anywhere in an event — at a checkpoint,
in a bed, from a question with *Save* as one of the answers — and the cartridge
keeps one slot of progress: where they were standing, the switches, the variables,
the bag, and in an RPG the whole party's levels, HP and spells. **Continue** appears
on the title screen as a Controller Forge binding, and loads it back.

This needs a cartridge with somewhere to keep that slot: battery-backed memory on
**MMC1** or **MMC3**, or, on **UNROM 512**, the cartridge's own program ROM, saved
into directly the way a USB flash drive is — no battery required. The Build panel
says which boards qualify rather than letting the command look like it works on one
that does not. A save carries a checksum, which catches a write the power cut off
partway through, and a fingerprint — a small hash fold of the save format itself and
the project's own counted facts (its screens, maps, actors and the rest of what a save
trusts as an index), not a literal record of each one. A save whose fingerprint doesn't
match the build trying to load it is always refused. A matching fingerprint is not
enough on its own, though: the save still has to pass its own checksum, and then a
further set of checks that range-bound every value it is about to be trusted as — a
screen number, a party size, a direction — before it actually loads; those later checks
are what keep a save that gets this far from crashing the game, not what make it
correct, so a save that passes every one of them can still hand back a project state
nothing in that playthrough actually earned. Two projects share a fingerprint for
certain when they agree on the save format and every one of those counted facts — that
case passes every time, by construction, whatever their content differs on — and, more
rarely, even when they do not agree on all of them, because folding many facts into a
small fingerprint is a compact summary rather than an exact one, and a small chance of
two different shapes folding to the same value is the cost of keeping the fingerprint
that small; the range checks above are what stand behind it either way, not this fold alone.
An ordinary Forge update that changes neither the save format nor any counted fact
leaves an existing save's fingerprint exactly as it was. One slot, and one risk window: an interrupted
write takes out whatever was already in the slot, not only the save being made.

On **UNROM 512** that risk window is longer and worth knowing about specifically: a
Save there uses a single 4 KB region of the cartridge's flash chip, and writing to
flash means erasing that whole region before the replacement record can be written
into it — there is no way to update one byte of an old save in place the way battery
memory allows. Cutting power or resetting during that roughly 24-32 ms erase-and-write
(the screen blanks briefly while it happens) can leave Continue unavailable until the
next Save. Most of that time — around 18-25 ms of it — is the erase itself, and a cut
during that part is a different risk than a cut during the shorter write that follows,
not a smaller one: erase ordering inside the flash chip isn't something this app
controls or can see, so a cut during it can leave the previous save's own completion
marker still reading as valid over a body that has already been partly wiped. The
save's internal checksum catches that in practice and refuses to load a record that
doesn't add up, but that is a strong safeguard, not a guarantee. Once the erase has
actually finished, the shorter write that follows is protected more simply: nothing
marks a save complete until its very last byte, so a cut there is read back cleanly as
*no save*, never as one that loads wrong. Either way this is a brief, occasional
window, not a routine hazard, and flash wear levelling is intentionally not
implemented — a cartridge's flash chip easily outlasts any plausible number of saves a
player would make.

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
| Magic Forge | The spell list — cost, a min/max damage or heal range, element, one target or all |
| Sprite Forge ▸ *Actors* ▸ *In battle* | A monster's attack, defence, accuracy, evasion, speed, experience, gold, weakness, resistance and what it drops |
| Map Forge ▸ *Battles here* | The sky and ground a battle is fought against, how many steps between encounters, and which monsters turn up |
| Build ▸ *RPG progression* | The experience curve, the level cap, and which tileset holds the monster art |

An actor becomes a monster by having **contact damage above zero** — the same
field an action game uses for spikes. Walking into one you placed on the map
starts a fight you cannot run from; the step counter starts ones you can. An
event can start one directly, too, with **Start a battle…** — naming up to
four monsters as its own formation, never the map's random one, for the fight
that belongs at a specific moment rather than under foot. It cannot be run
from either, the same as walking into a placed monster. Losing is not
something you author: it is already a game over, exactly like running out of
hearts, so there is no lose branch to build — whatever you put *after* the
command (turning on a switch named `Boss defeated`, say) only ever runs when
the player wins, because that is the only way control comes back to it.

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

An **item** is authored in the **Items Forge**: a name, an effect (None for a
key item that is only ever carried, or Heals/Damages, each with an amount) and,
optionally, the Pickup actor that grants it on the field — it also reaches the
bag through a scripted Give item command or a monster's drop. Spending it from
the field menu applies Heals or Damages either way, and leaves a key item in
the bag untouched; in battle, the ITEM list only ever offers a Heals item with
a real amount, since nothing in this phase implements a targeted battle attack
— a Damages item, or a Heals item left at Amount 0, is real and spendable on
the field but never appears as a choice there.

```sh
npm run sample:rpg          # write the RPG demo to ./sample-rpg
npm run build:sample:rpg    # assemble it
```

## Music

The **Sound Forge** is a tracker: rows of notes across two pulse channels, the
triangle and the noise channel, grouped into patterns and arranged by an order
list with a loop point. Instruments carry a duty cycle and a volume envelope
(the triangle ignores both, because the NES gives it neither). Assign a song to
a map in the Map Forge and the engine reasserts it whenever that map is
entered — walking across a screen edge inside the same map never touches it.
Arriving at a different map does reassert its own configured song, but that is
not the same as restarting: two maps that happen to share a song play on
without a hitch, since only an actual change to what is sounding starts
anything. Booting follows the same rule — whichever screen the cartridge lands
on decides, so a project with a title screen boots into *its* map's song, not
necessarily the start map's. An event can override the music directly with
**Play music…**, which holds until the player leaves for a different map; a
screen edge inside the one the command ran on leaves it alone.

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
