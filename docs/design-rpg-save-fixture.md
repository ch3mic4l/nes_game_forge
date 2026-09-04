# Design: the RPG battery-save fixture (`sample-rpg-mmc1/`)

## Why a sixth fixture, not a variant of an existing one

`test/lua/run_sram_check.sh` proves `engine/save.asm`'s battery path against Mesen's real
MMC1/MMC3 WRAM-enable and write-protect gating, and it has driven two fixtures --
`sample-mmc1/` and `sample-mmc3/` -- since the SRAM check was written. Both are action projects.
On an RPG build the load path is different in a board-relevant way: `continue_game`
(`engine/save.asm`, the `.if BATTLE_ENABLED` block) calls `call_battle` with `BE_RESTORE` between
reading the record out of WRAM and `redraw_screen` -- a real PRG bank switch, and on MMC1
`switch_prg_bank`'s written byte carries bit 4, the WRAM-disable bit, in every value it writes
(`engine/banks.asm`). The same is true in the other direction, before a save is even written: a
Join run on the field (`script_op_join` -> `call_battle BE_JOIN`) is the identical bank switch,
and neither `sample-mmc1/` nor `sample-mmc3/` can ever reach it, because neither has a battle
system to switch into. `test/unit/save.test.js` already proves the RPG save record's own logic
and `BE_RESTORE`'s recompute against the vendored jsnes core -- but that core does not model
MMC1/MMC3 WRAM gating at all (`save_sram.lua`'s own header comment), so it cannot prove those two
particular bank switches don't quietly take the chip away out from under a save. That is this
fixture's one job.

The obvious alternative -- give `sample-rpg/` a Save command and a saver, and point
`run_sram_check.sh` at it -- was rejected for the reason CLAUDE.md's "five fixtures,
deliberately" passage (now six) already gives for not pinning `sample/` or `sample-rpg/` to a
specific board: both are mapper-agnostic by design, and every other RPG engine test
(`rpg.test.js`, the kernel/battle-region ledger tests) is written against `sample-rpg/` staying
exactly that. Pinning it to MMC1 to reach this one Mesen check would narrow a fixture every other
RPG test already depends on, for the sake of a concern -- one board's own register behaviour
around two specific bank switches -- that only this Mesen check has. So `sample-rpg-mmc1/` exists
instead, the same shape `sample-mmc1/`/`sample-mmc3/`/`sample-u512/` already are: a small,
separate project built to feed one Mesen check, not to demonstrate a game.

## Why MMC1 alone, not a second board

`sample-mmc1/` and `sample-mmc3/` already cover the *register-encoding* difference between the two
battery-capable boards -- MMC1's serial shift port versus MMC3's select/value register pair --
for the save write and read themselves. What is new in this fixture is not another register
encoding; it is the *game type*, and specifically the two additional bank switches
(`BE_JOIN`/`BE_RESTORE`) an RPG's field code makes that an action build's never does. Proving that
those two switches don't corrupt WRAM only needs one board that can take WRAM away on a bad PRG
bank write -- MMC1 is exactly that (bit 4 of the $E000 shift register), and it is also the board
`test/lua/build_sram_roms.mjs`'s own `--break=mmc1-disable` negative control already exercises,
so extending that control to this fixture (see below) costs nothing new. MMC3 gates WRAM through
`$A001` rather than through the same register that carries the PRG bank, so an RPG-on-MMC3
fixture would be testing a *different* claim (does an unrelated register write ever clobber
`$A001`?) that nothing in `engine/banks.asm`'s MMC3 path does or has ever been suspected of doing.
One board, chosen because it is the one where the new bank switches are actually a hazard, is
what "cover a board rather than demonstrate a game" (CLAUDE.md) means applied to this specific
gap.

## What each run proves

The fixture is `tools/make-rpg-save-sample.js` -> `sample-rpg-mmc1/`: the identical 2x1 world,
doorway rows 5-8, title map, saver actor at (128, 96) on `touch`, and start position (112, 112) as
`sample-mmc1/`, on `gameType: 'rpg'` and mapper 1. The saver's one page is
`setSwitch 0, setVar 0 = 7, give item 0, join member 1, save` -- one command longer than
`sample-mmc1/`'s own page, and the added command is the entire point: `join member 1` recruits the
second party member (Iris, `startsInParty: false`) through `call_battle(BE_JOIN)`, immediately
before the `save` that follows it on the same page. That is a real MMC1 PRG bank switch sitting
between "the state worth saving now exists" and "the state gets written to the chip," on the exact
walk `save_sram.lua` already drives.

**Round 2 revision.** Round 1's own design and implementation were reviewed (BLOCK; 8 findings, all
accepted) before this fixture was considered done. The headline defect (finding 1) was that phase 6
never actually read WRAM *after* `BE_RESTORE`'s own bank switch -- `load_apply_body`
(`engine/save.asm`) copies the save record into internal RAM *before* `call_battle(BE_RESTORE)`
runs, and every value phase 6 checked was internal RAM, so a `BE_RESTORE` that took WRAM away
could have left every existing assertion passing. What follows is the corrected account; see
"Negative controls" below for finding 1, the one that needed an actual broken build to close --
finding 2 (below) was closed differently, by making one party member's spell slot nonzero and
deriving the printed masks from the fixture's own data, not by a broken build.

Three assertion points, all additions to the existing phases rather than replacements:

- **Run 1, before the cycle back across the screen edge (phase 4).** `party_size`, `pc_in_party`
  slots 0/1 and `pc_level` slots 0/1 are internal-RAM writes -- they confirm the saver's own
  `join member 1` (through `call_battle(BE_JOIN)`, a real MMC1 PRG bank switch, immediately before
  the `save` that follows it on the same page) actually executed. Being internal RAM, they would
  read correctly even if that bank switch had disabled WRAM. Only `saveWritten()` -- the marker
  read at $6000+, checked a few lines above -- is real SRAM-chip state; it alone is what proves the
  Save that immediately follows `BE_JOIN` on the same page could still reach WRAM. The
  switch/variable/`inv_count` fields checked alongside it are internal RAM too, and verify what was
  *written* by that Save, not the mapper gating around it.
- **Run 2, after Continue restores the save, on every board (phase 6).** The SRAM marker
  (`SAVE_MARKER_OFFSET`), read through the CPU-mapped view at the first phase-2 observation after
  Continue leaves the title (phase 2 waits eight frames before that observation) -- i.e. *after*
  `continue_game`'s own `call_battle(BE_RESTORE)` has run and returned -- must still read
  `SAVE_MARKER_VALID`. This is the check round 1 was missing entirely, and it is what actually
  observes whether `BE_RESTORE`'s bank switches (the trampoline's entry switch into the battle
  bank, and its `jmp set_screen_ptr` exit switch back to the screen bank) took WRAM away at either
  point. It runs on every board, not only `rpg-mmc1` -- on the two action boards there is no
  `BE_RESTORE` at all, so it is a free extra observation that ordinary gameplay still leaves WRAM
  exactly as accessible as it always was.
- **Run 2, RPG-only (phase 6).** `party_size`/`pc_in_party`/`pc_level` are the save record's own
  raw bytes (`shared/save.js`'s `SAVE_FIELDS` carries every `pc_*` array unconditionally, RPG or
  not); `pc_hp_max`/`pc_mp_max`/`pc_spells` are what `BE_RESTORE` recomputes from the restored
  `pc_level` against the current build's own tables (`engine/battle.asm`'s `party_apply_level`).

Neither party member ever battles or levels on this walk (every map's `encounters.rate` is left
at `createMap()`'s own default of 0, so the walk stays exactly as deterministic as
`sample-mmc1/`'s), so both stay at level 1 throughout. At level 1, `statAt(base, perLevel, 1) ==
base` (`main/build/battletables.js`), so `pc_hp_max = 24` (`baseHp`) and `pc_mp_max = 8`
(`baseMp`) are plain `createPartyMember()` defaults for both members, with no migration math.
`pc_spells` is **per member**, not shared, as of round 2 (finding 2): round 1 gave neither member
any spell, which made the assertion pass vacuously regardless of whether `BE_RESTORE`, the raw
save byte, or nothing at all produced the zero it read. Rian (member 0) now knows one spell
(`project.spells[0]`, `createSpell(0, 'Spark')`) from level 1, so `pc_spells` slot 0 is `1` (bit 0
of the catalog-position bitmask) and slot 1 (Iris, no spells) is `0` -- a stuck `0`, a stuck
`0xFF`, or a swapped slot is now a real failure either bit could catch. This still does not
distinguish "the raw saved byte survived" from "`BE_RESTORE` recomputed it": at level 1 both land
on the same value, and only `test/unit/save.test.js` (against a build where they differ) proves
the recomputation itself. These are hardcoded in `save_sram.lua` as
`RPG_HP_MAX`/`RPG_MP_MAX`/`RPG_SPELLS_0`/`RPG_SPELLS_1`, the same way `SAVED_X`/`SAVED_Y` already
are, and `test/lua/build_sram_roms.mjs` prints the same numbers per member for the `rpg-mmc1`
board on every run -- computed with the identical catalog-position/learn-level rule
`battleTables`' own `known` builder uses, not a literal -- so a drift between the fixture's own
party/spells and the Lua's copy of these constants is visible by eye rather than only as an opaque
Mesen failure.

The fixture's mapper-gating claim rests specifically on the marker reads -- `saveWritten()` (for
`BE_JOIN`) and the new post-Continue marker read (for `BE_RESTORE`) -- the only two things this
fixture reads that are real SRAM-chip state, and the only things a bank switch disabling WRAM
would visibly corrupt. Everything else -- the switch/variable/`inv_count` fields, and the RPG
party/level/spell numbers -- is internal RAM: they verify the *content* that was written to or
restored from the record, not the mapper gating around it, on real MMC1 hardware behaviour neither
the unit suite's vendored core nor an action fixture can exercise the surrounding bank switches for
at all.

No monster actor and no party battle art are authored. Two warnings are the expected,
non-blocking result: `validateProject`'s "No actor deals damage, so no battle can ever start"
(`shared/project.js`) and `checkBattleTables`'s own separate "No actor is hostile, so no battle
can start. Give a monster some contact damage." (`main/build/battletables.js`). Neither blocks the
build (`main/build/generate.js`'s `checkCapacity` only fails on `severity === 'error'`), and
nothing on this walk ever opens a battle screen for either to be drawn on, so both stay omitted to
keep the fixture small, the same way `sample-mmc1/` itself carries no player sprite art of its
own. `createProject(name, 'rpg')` supplies an RPG-capable mapper and a second Battle tileset by
default; palettes are project-global, so no extra palette authoring is needed.

## The detection rule

`save_sram.lua` is one script, not a copy per board -- it already had to determine, on its own,
which half of a power cycle a given invocation is (its own header comment, unchanged by this
fixture); it now also determines, on its own, whether the ROM it is running is an RPG build,
using a signal independent of the save it is about to test.

**Round 2 revision (finding 3).** Round 1's signal was `pc_in_party` slot 0, which turned out to
be a fail-open *fixture assumption* rather than a real detector: a valid RPG only needs *some*
member to start in the party, so a project where member 0 in particular does not would silently
read as an action build and skip every RPG assertion with no failure anywhere. The current fixture
was safe by construction (`createPartyMember(0)` starts in the party), which is exactly what made
the gap invisible without the review.

The signal is now `pc_level` slot 0 (`$03A8`, `engine/constants.asm`), read in phase 1, on the
title screen, before any input. Boot runs `init_session`, which on an RPG build reaches
`party_init` (`engine/battle.asm`) via `call_battle(BE_INIT)`; `party_init_slot` writes `#1` to
`pc_level,x` for *every* slot, unconditionally, *before* it ever branches on `pc_starts,x` -- so
this reads 1 for every RPG build regardless of which member(s) actually start in the party, and
cannot fail open the way `pc_in_party` could. Verified in `engine/boot.asm`: `reset`'s own
RAM-clear loop (`lda #0` then `sta $0300,x` through `sta $0700,x`, `bne boot_clear`) zeroes the
`$0300-$03FF` page -- `pc_level` at `$03A8` included -- before `init_session` ever runs, and an
action build has no `BATTLE_ENABLED` code to write there afterward, so it reads exactly 0. (The
loop skips `$0200-$02FF`, which the later `boot_clear_oam` loop fills with `$FF` for the sprite
shadow -- an earlier draft of this document claimed the whole `$0000-$07FF` range was zeroed,
which is wrong for that one page; nothing this fixture reads lives in it.) This is what makes the
signal safe to decide the RPG branch on before `SELECT` is ever pressed, rather than inferring it
from how the save behaves -- the same reasoning the existing marker-on-the-chip detection already
uses one level up. Any value the detector reads that is neither 0 nor 1 is now a test failure in
its own right (`EXIT_DETECTOR_AMBIGUOUS`), not a silent misclassification either way.

`pc_in_party[0] == 1` is still asserted, in phases 4 and 6 -- not as the detector any more, but as
this fixture's own *authored invariant*: if member 0 is ever changed to not start in the party,
this now fails loudly instead of quietly disabling the RPG branch that would otherwise have caught
it.

## Negative controls

`--break=mmc1-disable` (pre-existing, extended to this fixture for free) patches
`engine/banks.asm`'s `switch_prg_bank` unconditionally, so it makes *both* MMC1 fixtures
(`mmc1` and `rpg-mmc1`) fail, not just one -- read by eye, the same convention the script's header
already documents for a targeted break. `--break=mmc3-a001` and `--break=mmc3-no-write` are
unaffected: neither MMC1 board has an `$A001` register to break.

`--break=mmc1-restore-disable` is new, RPG-only, and exists specifically to give finding 1's own
gap a real negative control rather than only a corrected comment. It patches the same
`switch_prg_bank`, but narrower: PRG-RAM-disable is set while `bt_call`
(`engine/constants.asm`, written only by `call_battle`, `engine/banks.asm`) reads `BE_RESTORE`.
`continue_game`'s own `call_battle(BE_RESTORE)` writes `bt_call` *before* its first
`switch_prg_bank` call, so WRAM goes away starting with that very entry switch into the battle
bank, stays off through the trampoline's own `jmp set_screen_ptr` exit switch back to the screen
bank, and through any later PRG switch (`redraw_screen`'s own, on this walk) for as long as
`bt_call` still reads `BE_RESTORE` -- i.e. until a later `call_battle` changes it, which does not
happen again on this run. An action build never sets `bt_call` to `BE_RESTORE` -- it has no
`call_battle` assembled at all (`.if BATTLE_ENABLED`) -- so `mmc1` and `mmc3` are both unaffected.

The negative-control runs produced the expected discriminating results: **with** the phase-6
marker check from finding 1's fix, `rpg-mmc1` FAILs (`run1=1 run2=13`,
`EXIT_WRAM_LOST_AFTER_RESTORE`) while `mmc1`/`mmc3` PASS; **without** it (the Lua change
temporarily removed, the break still applied, then restored), `rpg-mmc1` PASSes -- reproducing the
exact hole finding 1 described, empirically, rather than only by code inspection.

## What is shared, what is new

`test/lua/build_sram_roms.mjs` gained a third `BOARDS` entry (`{ key: 'rpg-mmc1', dir:
sample-rpg-mmc1 }`) and prints the level-1 stat constants above for it, per party member; the
per-member spell mask is computed with `battleTables`' own catalog-position/learn-level rule
(`main/build/battletables.js`, its `known` builder), not hardcoded, so the printed numbers cannot
drift from what the fixture would actually compile to. `test/lua/run_sram_check.sh` iterates a
third board key in its existing loop.
