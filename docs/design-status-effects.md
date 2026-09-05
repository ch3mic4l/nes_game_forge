# Design: generalizing status effects beyond poison (ROADMAP item 13.4)

Status: shipped. Adds exactly one new status, Burn, to prove the generalization holds for more
than one simultaneous status — not a speculative framework with no second user.

## The storage: independent bits, not a single-status byte

`pc_status`/`mon_slot_status` (`engine/constants.asm`) were always one byte per combatant with
only bit 0 defined. What was single-status was the *logic*, not the storage: `poison_target`
wrote the whole byte to `1` rather than setting a bit, and `combatant_status` treated any nonzero
result as "poisoned" — true only because nothing else could ever set a bit.

`STATUS_POISON = 1` (bit 0, unchanged value — a project's in-progress battle carries over
identically, and nothing serializes this byte to a save, so there is no compatibility concern to
begin with) and `STATUS_BURN = 2` (bit 1, new) are now independent. `poison_target`/`burn_target`
each `ora` their own bit into the byte rather than storing a literal, so casting one never erases
the other. `combatant_status` needed no signature change: it already returned the raw byte in `A`;
what changed is what a caller does with a nonzero result, not what the function returns.

## The dispatch: a pending mask, not a single flag

`battle_message_done` (`engine/battleui.asm`) used to ask one question after the acting
combatant's own message was dismissed — "is `combatant_status` nonzero?" — and, if so, run
`poison_tick` once and set `bt_ptick` so the *next* dismiss advanced the turn instead of ticking
again. That shape hard-codes "at most one status."

The generalization is a snapshot-and-drain: `status_pending` (a new zero-page byte,
`engine/constants.asm`, chained after `flash_left` — zero page had room past it, up to the stack
at `$0100`, so no ordinary-RAM fallback was needed) captures `combatant_status(bt_actor)` the
first time through, the same point `bt_ptick` used to gate the single check. From there,
`battle_message_done` repeatedly picks the lowest set bit still in `status_pending`, clears it, and
jumps to that status's own tick routine — poison before burn, because poison is bit 0. `bt_ptick`
keeps its old meaning unchanged ("the line on screen is a status tick, not the action's own"); it
just now gates a loop instead of a single branch. Once `status_pending` reaches zero, the turn
advances exactly as before.

`poison_tick`/`burn_tick` (`engine/battleturn.asm`) no longer set `bt_ptick` themselves — the
dispatcher in `battleui.asm` owns that now, since it is the thing deciding whether another line is
coming. Each tick routine only does its own amount (`POISON_DMG` = 2, `BURN_DMG` = 3 — deliberately
different, so the two statuses read as distinct in play, not palette-swapped copies of one number)
and its own message (`BS_SUFFERS`/'poisoned' for poison, `BS_SCORCHED`/'burned' for burn, both in
`BATTLE_STRINGS`, `main/build/battletables.js`).

`status_pending`/`bt_tmp`/`bt_tmp2` were deliberately kept apart: `bt_tmp` and `bt_tmp2` are each
already load-bearing for other call chains that run inside this same message flow (`bt_tmp2` in
particular is `cast_all`'s own end-of-side sentinel across its `spell_damage`/`roll_spell_amount`/
`mod8` chain — see CLAUDE.md's 6502-traps entry on it) and reusing either for the pending mask would
have been exactly the kind of scratch-byte collision that entry already documents one instance of.

## Casting: the identical shape, twice

`cast_spell` (`engine/battleturn.asm`) gained one more `cmp`/`jmp` pair ahead of the heal check, for
`SK_BURN` (`= 3`, appended after `SK_POISON = 2` — `SPELL_KINDS` in `shared/project.js` is
append-only, so Burn is the new last entry, `{ id: 'burn', label: 'Burn' }`). `cast_burn`/
`cast_burn_all`/`burn_target` are `cast_poison`/`cast_poison_all`/`poison_target` verbatim, with
their own bit and their own landing message (`BS_BURNS`/'burns'). Both ignore `amountMin`/
`amountMax` the same way poison always has — a status effect's cost is fixed, not rolled — and the
Magic Forge's own `current.kind === 'poison'` special-case (`renderer/forges/magic/magic.js`) is now
`current.kind in STATUS_KIND_DAMAGE`, a small local table (`{ poison: 2, burn: 3 }`) mirroring
`POISON_DMG`/`BURN_DMG` so the Amount-field hint can name the right number for whichever kind is
selected instead of a hardcoded literal that only happened to be right for one of the two.

## Cure is unchanged, and that is the point

Every existing cure site — `item_chosen`'s potion, `cast_heal`'s party and monster branches — does
`lda #0 / sta pc_status,x` (or `mon_slot_status,x`). Clearing the whole byte already cures every
bit, poison and burn alike, with no code change: the generalization only had to touch how a status
is *set* and *ticked*, because "a heal cures everything" was already the right behavior for a byte
of independent flags, not an accident that happened to work for one bit. A burn-specific (or
poison-specific) partial cure was deliberately not built — nothing in the roadmap item asked for
one, and it would be exactly the kind of speculative branch this slice's own "no framework without
a second user" rule argues against.

## What a third status would need

The shape scales past two without changing the dispatch mechanism itself:

- A free bit in `pc_status`/`mon_slot_status` (bits 2–7 are still unused).
- A `cast_<name>`/`<name>_target` pair, identical in shape to poison/burn's.
- A `<name>_tick` routine, identical in shape to `poison_tick`/`burn_tick`.
- One more `and #BIT` / `beq` / `jmp` rung in `battle_message_done`'s dispatch chain, in whatever
  bit order the design wants ticked.
- Two `BATTLE_STRINGS` entries (a landing message, a tick message) — `checkBattleStringsCapacity`
  (`main/build/battletables.js`) already refuses a list that would overflow `push_battle_string`'s
  256-byte addressable range, so a fourth status is safe to add for exactly as long as that check
  keeps passing, with no separate accounting needed.

Nothing about the byte budget changes shape either: `BASE_BATTLE_CODE_BYTES_BY_MAPPER`
(`main/build/battletables.js`) absorbed this slice's cost (164 bytes on every RPG-capable board
alike, measured — not derived — the same way every prior battle-region slice's own delta was) as
an unconditional addition to the stock banked-region base, because the dispatch mechanism itself,
like poison before it, is not gated behind any project-level predicate: an RPG either has the
battle system compiled in or it does not, and if it does, this is now part of it.
