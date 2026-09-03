# Flash save power-loss atomicity: two designs costed, neither built

**Status: not implemented, by design.** This is a real design worked out and rejected on a real
budget, not a feature nobody ever considered — the same shape as the AxROM and MMC5 mappers
CLAUDE.md's own "The engine" section documents as considered and deliberately left out. Referenced
from CLAUDE.md as "a note, not something to do now."

## The gap

UNROM 512's flash commit (`engine/flash.asm`) is not power-loss atomic: it erases the whole 4 KB
sector before writing anything, so a save interrupted mid-commit can leave neither the old record
nor a valid new one.

## Two designs, costed against the real remaining headroom

Both were costed against the real remaining kernel-lo headroom on `sample-rpg` with a live Save —
roughly 240 budgetable bytes once engine code, fixed tables and project tables are accounted for
(the same bank `kernelbytes.test.js` arbitrates everywhere else in CLAUDE.md).

**A 47-slot append-only ring** (`floor(4096/87)`, treating the marker as an allocation state) costs
an estimated 170-265 bytes — most of the remaining headroom — and is still not atomic at rollover:
a one-sector design has nowhere to put slot zero's replacement without erasing every slot first, so
the hazard is reduced, not removed.

**A two-sector A/B journal** is the design that actually closes the gap: the *adjacent* 4 KB sector
is already reserved by `chrPayloadRegions()`/`screenRegions()` (CLAUDE.md's own note on why a flash
build gives up a whole 8 KB region for a driver that uses only the top 4 KB of it) but currently
unused, and a one-byte generation counter is safe across wraparound because each generation is
written into a sector that was just erased to `$FF` — no value needs a bit to go 0 → 1 without an
erase in between, so there is no counter value clear-only programming cannot express. That design
is genuinely atomic and still costs an estimated 155-225 bytes — 65-94% of the same headroom — and
would push the already-refused `sample-rpg` + Save + Move combination (currently 167 bytes short on
this board — re-measured against the current tree, not the ~155 this document previously estimated;
`battle_end`'s own talk_ent fix, item 6's Turn/Wait slice, added 3 more unconditional kernel-lo
bytes to every RPG build, on top of whatever else moved it before) to roughly 322-392 bytes short.

## Conclusion

Neither was built. If atomic flash saving becomes a real requirement, the A/B journal is where to
start — not the ring — and the adjacent sector is already sitting there reserved for exactly it.
