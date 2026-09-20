# Reference: The six fixtures

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

## The six fixtures

There are **six fixtures, deliberately**. `sample/` is the action-adventure one every engine test is
written against; `sample-rpg/` is the turn-based one `rpg.test.js` drives; `sample-mmc1/`,
`sample-mmc3/`, `sample-u512/` and `sample-rpg-mmc1/` are small save-check fixtures — one per
save-capable board, plus a second MMC1 one for an RPG's own extra save-adjacent bank switches
(`docs/design-rpg-save-fixture.md`) — that exist to cover a board rather than to demonstrate a game.
They are separate projects, not variants of the other two, because `sample/` and `sample-rpg/` are
mapper-agnostic by design — pinning either to a specific mapper to reach one of these four would
narrow a fixture every other engine test depends on, for a concern (a specific board's own save
behaviour) only the Mesen save checks have. Those checks — `test/lua/run_sram_check.sh` and
`test/lua/run_flash_check.sh`, driving `save_sram.lua` and `save_flash.lua` — are what these four
exist to feed, and the only things that consume them. No test may mutate any of the six — variants
go to `mkdtemp` directories — and no existing test is repointed at any of the new ones: every
engine test stays written against `sample/`. None of the six is ever regenerated in place, either:
each is hand-edited JSON once written, and the no-regeneration policy is what keeps them
pre-migration on disk — `samplegen.test.js` only asserts load-equality (its output loads deepEqual
to the checked-in fixture) and non-mutation, never on-disk shape. Running one of the
`npm run sample*` scripts over a checked-in fixture is data loss, not a refresh. Three of the six
carry in-game naming for
real: `sample/` has hero naming plus a `{name}` token in the slime's plain dialogue (screen 0);
`sample-rpg/` has hero and Join naming, on a titleless build; `sample-rpg-mmc1/` has Join naming
for Iris alone, hero naming off, so `save_sram.lua` can assert a typed name survives Continue. No
fixture or starter carries the token except `sample/`; the RPG starter names its two members Hero
and Ally.

`sample-mmc1/` and `sample-mmc3/` are **the same walk on two boards**: same 2x1 world, same saver
at the same coordinates running the same page, differing only in mapper and in the `Say` the MMC3
one opens with (that board is the scanline-IRQ one, and a message box puts the font split to work
during real gameplay, not just the title) — so only the board's own register behaviour can make one
pass and the other fail. `sample-u512/` is the same walk again, on a third board, mapper swapped
and no opening `Say` (see `tools/make-u512-sample.js`'s own header for why not), but for a
different reason: MMC1/MMC3 differ only in *register encoding* for the same battery-WRAM medium;
UNROM 512 differs in the *save medium itself* — no battery-backed WRAM at all, saving instead by
reflashing its own PRG-ROM (`engine/flash.asm`). `run_sram_check.sh` and `run_flash_check.sh` are
consequently not one check with two runners; they exercise different engine code
(`engine/save.asm`'s battery path vs its flash path) against different Mesen models (WRAM
enable/write-protect gating vs a JEDEC flash state machine) and, for `run_flash_check.sh`, a form
of persistence (`Core/NES/Mappers/Homebrew/FlashSST39SF040.h`'s own write-through, saved as an
`.ips` patch keyed off the ROM's basename) the SRAM check has no equivalent of at all.

All four save-check fixtures' saver pages are guarded on the switch they set — `Save` records
where the player is standing, which for a `touch` trigger is on top of the actor that fired it, so
Continue restores the player mid-contact and `spawn_entities` arms the trigger again during the
load's own redraw. Without the guard the page re-runs a frame later and hands out a second gem —
the engine behaving as specified, but making the restored bag impossible to assert exactly, since a
load that came back empty and one that came back correctly both read as "something in the bag" once
the re-run has refilled it.
