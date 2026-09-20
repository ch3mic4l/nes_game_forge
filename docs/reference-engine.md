# Reference: The engine

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

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
engine may touch at an arbitrary moment — tables, music, code — lives there; only bulk screen
data is banked. That is why `set_screen_ptr` is the *single* place a PRG bank is selected, and
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
`chrRegisterShift`. That routine writes a table entry back over itself, both selecting the bank and
avoiding a bus conflict on real hardware. `chrRegisterShift: null` means the mapper needs its own
block: MMC1 shifts bits into a serial port, MMC3 uses a select/value register pair.

MMC1 and MMC3 ignore the header's mirroring bit and take mirroring from their own registers, in
their own encodings — hence `mapper_init` and the generated `MAPPER_MIRROR`.

UNROM 512 is also the only board offering **four-screen mirroring**, which needs header byte 6 bit 3
*and* bit 0 (bit 3 alone means one-screen on this mapper). nesasm has no directive for bit 3, so
`headerPatch()` supplies it. Four-screen costs a tileset because the extra nametables are backed by
the last CHR-RAM page — `tilesetLimit(mapper, cartridge)` is the single writer for that,
consulted by the schema, the Tile Forge's Add button and the Build panel. Without the camera the
engine draws only nametable 0, so the extra nametables buy nothing; with it they are what lets
crossings slide on both axes — the Build panel says which, rather than letting a tileset quietly
vanish.

`reconcileCartridge()` in `shared/project.js` exists because `store.commit()` mutates the project
directly and never runs `normalizeProject`. Changing mapper or mirroring in the UI must call it in
the same commit, or the in-memory project keeps a combination the UI has already stopped offering.
It performs exactly the reconciliation `normalizeProject` does on load, and a test asserts the two
agree.

**UNROM 512 (mapper 30) is the CHR-RAM case** and the only one that bends two rules. It ships no
CHR-ROM: `chrPayloadRegions()` reserves one 8 KB region of the *switchable window* per tileset, and
`chr_ram_init` streams each into a pattern page at boot, so tilesets consume screen capacity there.
Its single register carries the PRG bank in bits 0-4 and the CHR page in bits 5-6, so neither can
be set without the other — `mapper_shadow` holds the last value written and both switch routines
rewrite the whole byte. Because iNES cannot declare CHR-RAM, `applyHeaderPatch()` in `pipeline.js`
rewrites the 16-byte header to NES 2.0 after assembly; `headerPatch()` returns `{}` for every
mapper needing neither that nor a plain byte-6 bit set (battery on a project that never saves,
four-screen on a board without the nametable RAM for it), so "nesasm writes a correct header with
no post-processing" still holds for them. Battery-backed save (below) is the other bit-set case:
iNES byte 6 bit 1, applied the same way as four-screen's bit 3, rather than dragging MMC1/MMC3
into the NES 2.0 path only UNROM 512 needs.

**A slot ring for flash save was designed, costed and rejected**, not never considered. UNROM 512's
flash commit is not power-loss atomic. A single-sector ring and a two-sector A/B journal (genuinely
atomic) were both costed; neither was built. See `docs/design-flash-slot-ring.md` — the journal, not
the ring, is where to start if atomicity ever becomes a real requirement.

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
  pairs. `switch_prg_bank` does not get that guarantee for free: `call_battle` (`engine/banks.asm`)
  calls it with rendering on and the picture live, every tick of a battle, so it carries its own
  critical section — `php`/`sei` mask the scanline IRQ (restoring the caller's interrupt state
  exactly, since this also runs during boot), and `split_lock`, a flag `split_arm` checks before
  touching R1, stands in for masking NMI, which `sei` cannot do. A stray NMI there costs at most one
  frame of the wrong CHR bank on the split, never a half-selected PRG or CHR register.
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

**The camera (ROADMAP item 12, `docs/design-camera.md`) is a register plus one consumer, both
gated on `project.cartridge.camera`.** NMI writes `$2000`/`$2005` from its own `nmi_cam_*` snapshot
of the mainline-owned `cam_x_lo`/`cam_y_lo`/`cam_nt`, refreshed only while `cam_dirty` is clear, so
a torn update is never shown; Shake composes onto it. `redraw_screen_slide` (`engine/camera.asm`,
replacing `jmp redraw_screen` in `player.asm`'s `cross_*` stubs) draws the incoming screen into the
far nametable under forced blank, slides over `CAM_SLIDE_FRAMES` (16) ticks with the world frozen
(`main_loop` skips `settle_owed`, input dispatch and world updates while ticking the slide;
controller polling, music and the enabled Sting, flip-budget and Flash ticks still run), then
redraws nametable 0 under a second forced blank; the entry event and `screen_fresh` settle on the
first ordinary frame after. `cameraAxes(mapper, cartridge)` (`shared/cartridge.js`) is the single
writer for which axis slides — the mirrored neighbour: vertical mirroring slides horizontally,
horizontal vertically, UNROM 512 four-screen both — read by the generator (`CAMERA_SLIDE_H`/`V`),
`switchableMappers` (a board that would drop an axis is never offered) and `describeCameraAxes`,
the hint under the Build panel's Camera checkbox beside Mirroring (hence the mirroring row on every
board once camera is on). A crossing onto a different tileset cuts — unreachable by authoring, since
a tileset is per map and `flattenScreens` never pairs neighbours across maps. Camera off, every
fixture is byte-identical (`test/unit/camera.test.js`, `test/lua/run_camera_check.sh`,
`main/smoke.js`'s `camera:` steps).

Every mapper in the registry is implemented, so `resolveMapper()`'s fallback to NROM now only fires
for a mapper number the registry does not list at all — a hand-edited project, or one saved by a
later version. The `supported`/`unsupportedReason` fields and the Build panel's disabled-option
rendering stay as the mechanism for adding a mapper honestly: declare it, let the UI show why it's
not selectable, then implement it. No entry currently exercises that path.

Two mappers were considered and deliberately left out rather than declared. AxROM (7) switches all
32 KB at once, leaving no fixed window for the kernel, so the engine would need duplicating into
every bank — which nesasm can't do by re-including code, since labels would collide. MMC5
(5) is the most complex NES mapper made and nothing here needs it.

nesasm banks are 8 KB, so `engine/main.asm`'s layout matters:

| bank | contents |
|---|---|
| 0 .. n-3 | screen data, packed into the switchable window ($8000 / $A000 alternating) |
| n-2 `$C000` | lookup tables, then all engine code |
| n-1 `$E000` | compiled music, then dialogue strings and events, then the CPU vectors at `$FFFA` |
| n+ | one `tilesN.chr` per tileset, emitted into `assets/chr.inc` |

where `n` is `prgUnits * 2`. `shared/cartridge.js`'s `prgLayout()` is the single writer for that
mapping; `kernelCodeBytes()` in `generate.js` is the engine-code allowance the capacity check
reserves, and must be re-measured if the engine grows — see "The kernel budget" below.

`generate.js`'s `checkCapacity()` computes that split and reports overflow as a plain-language
error *before* the assembler runs. Adding per-screen or per-actor data means updating the byte
math there too.

`engine/constants.asm` is the single allocation map for zero page and the `$0300+` RAM arrays.
New engine state goes there; a collision is silent and will present as an unrelated bug.

`engine/ui.asm` holds the two states where the world is frozen: the inventory menu and dialogue.
They exist since the Controller Forge binds buttons per state, and without them
`item`/`cancel`/`confirm` had nothing to do. `main_loop` runs `ui_tick` instead of the world
update while `game_state` is non-zero, and `do_action` in `input.asm` is the single place that
decides what an action means in the current state; an action with nothing to do there is
ignored, never reinterpreted. The menu is drawn entirely as sprites appended to the shadow *after*
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

**Flash is the first producer allowed to write `vram_buf` outside `ui_tick`'s own priority chain,
which makes "one producer per frame" a bound of two, not one.** `flash_tick`
(`engine/entities.asm`) ticks unconditionally from `main_loop`, alongside `music_tick`, so a
non-suspending Flash burst keeps counting down across the frozen/gameplay boundary; its own
packet-building code can share a frame with whichever *one* of `move_tick`/`wait_tick`/`fade_tick`/
`text_tick` `ui_tick`'s own frozen-world dispatch is running (those four stay mutually exclusive
among themselves). `main_loop` calls `flash_tick` before `settle_owed`/`dispatch_input`/`ui_tick`,
so on a frame where a Flash edge and one of the frozen-world four target the same address, Flash's
packet is queued first and the other second, landing last in that NMI's drain and winning the
screen — an author who needs the opposite has to sequence with an explicit `Wait`. Proven against
real hardware timing via the Mesen Lua layer (`test/lua/flash_nmi_timing.lua.template`,
`test/lua/run_flash_nmi_check.sh`), not jsnes, which does not enforce it. Trap this check itself
caught: its fixture is built from `sample/` and inherits whatever `sample/` turns on — hero naming
going live there (882b454) put the naming grid between the script's B press and the box, with
nothing in `npm test` able to see it.

**A live switch-bound tile is a third producer.** `flip_tick` (`engine/entities.asm`) ticks
unconditionally from `main_loop`, called *before* `flash_tick` — so on a frame where a flip, a
Flash edge and one of the frozen-world four all land together, the flip's own packets are queued
first, Flash's second, and whichever frozen-world tick is running third. The worst-case bound is
now 81 of `vram_buf`'s 256 bytes, up from 71 with Flash alone.
`test/lua/bound_tile_nmi_timing.lua.template` (built by `test/lua/build_bound_tile_nmi_roms.mjs`,
run by `test/lua/run_bound_tile_nmi_check.sh`) proves this exact three-producer frame against real
Mesen timing, the same "prove the workload, then trust the deadline" shape
`flash_nmi_timing.lua.template` established. **A fourth independent producer must re-open this
accounting again, not assume it still holds.**

`box_close` keeps no copy of what the box covered: the box is tile rows 24-29, which is exactly
metatile rows 12-14 with no half-row left over, so it rebuilds those rows straight out of
`[mtptr]` + `mt_tl/tr/bl/br` and the attributes out of `[atptr]`. Moving the box means keeping
that alignment or keeping a copy. The outer eight pixels are overscan — tile rows 0 and 29 and
columns 0 and 31 — so the frame drawn there is decoration, and nothing the player has to see
(the ▼ page prompt) goes in it.

`engine/combat.asm` and `engine/title.asm` are conditionally *reachable* either way, but only
`title.asm` is always assembled. `COMBAT_ENABLED` and `TITLE_ENABLED` in `config.inc` gate what
runs; `BATTLE_ENABLED` also gates what *assembles* in `combat.asm` (an RPG's action-only health
code has no call site once combat routes through the battle bank, so keeping it assembled would
burn kernel-lo space for dead code) — and `projectUsesHeartArt` (`shared/font.js`), not
`projectUsesCombat`, decides the heart art stamped into sprite tiles `$FE/$FF`: an RPG's monsters
can still carry contact damage (`COMBAT_ENABLED` on, driven by `projectUsesCombat` as before), but
an RPG never draws the hearts that art is for. `init_session` is the single definition of "new
game" — hearts, bag, counters, all 64 switches and all 16 variables — and both boot and the
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
  after `player_hazard` in `update_player`, and a wandering encounter reaching its threshold the
  same step would overwrite the `ST_GAMEOVER` a party wipe just set with `ST_BATTLE` — so
  `update_player` reads `game_state` back after `player_hazard` and stops there, the same "the rest
  of this frame belongs to the transition" rule a screen edge or a fresh screen already apply above
  it.
- **A killing hit must `jmp player_died`, not return into it.** `party_damage` and `lose_hearts`
  both only ever saturate and answer whether the hit was lethal; *deciding* the game is over is
  each caller's own `jmp` — a callee that jumped there on a caller's behalf would leave that
  caller's own return address sitting unpopped on the stack for some unrelated `rts` to mis-pop
  later.
- **`player_iframes` is the floor hazard's cooldown, not a general "the player was just hurt" flag,
  and only `player_hazard` may gate on it.** `entity_contact` shared the same read at first — a
  Damage metatile setting `player_iframes` then silently suppressed every contact battle for the
  rest of `IFRAME_TIME`, since `entity_contact`'s check ran before the branch that tells
  `touch_encounter` and `hurt_player` apart, making an RPG's monsters briefly walk-through. Fixed by
  moving the read inside `entity_contact`'s own `.if !BATTLE_ENABLED` block: an RPG encounter has no
  invincible window to respect, only the action side's knockback does. See `rpg.test.js`.

The scripted `Damage` command follows the same `jmp player_died` rule for its own killing hit, and
deliberately does not route through `hurt_player` either: a trap has no attacker for the knockback
and must land regardless of the invincible window a physical hit would still be honouring.
`Heal 255` is a full heal with no separate "inn" vocabulary — the one place the two
models genuinely diverge — and revives a fallen RPG party member the way an inn would, whereas
battle's `cast_heal` only heals the acting combatant. `projectUsesCombat`
(`shared/font.js`) counts a live `Damage` command in an action project the same way it counts a
damage actor or a painted metatile, since an author whose only damage source is this command still
needs the hearts drawn — but not in an RPG, where `Damage` never reaches `player_hp`, and where
nothing about combat reaches the hearts at all: `projectUsesHeartArt` answers false for every RPG
regardless of `projectUsesCombat`, since `draw_hud`/`hurt_player` do not assemble there. Item 5's
own phase 4c added a fourth source: an action-project item whose `effect` is `{kind: 'damage',
amount > 0}` reaches `player_hp` too, through `use_item_apply` (below) — and since every item in
`project.items` compiles unconditionally, `projectUsesCombat` counts it regardless of reachability,
the same policy `projectUsesItems` holds for `ITEMS_ENABLED`. An RPG's own damage-kind items are
excluded the same way its `Damage` command is — they land on party HP through `party_damage`
(`engine/rpg.asm`) instead, needing no heart-HUD reservation.

An internal movement-code dedup's `move_right_inside`/`move_down_inside` (`engine/player.asm`)
deliberately `jmp` to their shared tail on the very next line rather than falling through into it,
even though a fallthrough would reclaim a few more bytes: it would make physical adjacency
between an entry routine and its tail load-bearing and invisible, so inserting anything between
`move_down_inside` and `move_vertical_probe` would silently break `move_down` with no assembler
error.

**Validate-as-you-draw (ROADMAP item 8)** is five `validateProject` warnings — metasprite density,
reserved-tile reference, per-screen OAM, field density, battle OAM — plus a kernel-lo figure and
reserved-range shading (not checks), each backed by one predicate in `shared/project.js`:
`metaspriteScanlineDensity`, `fieldScanlineRows`/`fieldScanlineDensity` (wraps before clipping at
row 239), `screenSpriteBudget`/`overlaySpriteBudget` (two figures, never combined),
`battleSpriteBudget` (gated on `gameType === 'rpg'` alone, charging every wandering encounter its
full four-monster formation), `spriteReservedRanges`/`reservedRangeRects`, and
`metaspriteKernelBytes` (extracted from `kernelTableBytes`). No ROM byte changed (six-fixture
SHA-256 gate). Two traps: prove a delegation structural by reading `generate.js`'s source, not
its output; probe a game-type gate on the *other* game type — `battleSpriteBudget`'s own gate
went missing for several review rounds, caught only on an action build. See
`docs/design-draw-validation.md` for the full depth.
