# Report: namestride round 1 — two test-strength fixes

Both findings were about test strength, not the 6502 or the generator's own
byte math. Neither `engine/` nor any generator *logic* (the byte-computation
paths, `BASE_BATTLE_CODE_BYTES_BY_MAPPER`, the emitted table contents for the
real project) changed. Confirmed at the end of this report.

## 1. The guard test never went through `battleTables`

**Fix, shape chosen:** the first of the two offered shapes — an injectable
strings list. `battleTables(project, battleStrings = BATTLE_STRINGS)`
(`main/build/battletables.js`) now takes a second, optional parameter that
both `checkBattleStringsCapacity(battleStrings)` (the guard call) and the two
emission sites (`BS_${name}` constants, `bs_text`) read, in place of the
module constant `BATTLE_STRINGS` directly. Default is `BATTLE_STRINGS`, so
every existing call site (`generate.js`, `battletables.js`'s own
`battleTableBytes`, every test that calls `battleTables(project)` with one
argument) is unaffected and the default path — including `items.test.js`'s
golden ROM hash — stays byte-identical.

Why this shape over the "mutate the exported array in a `finally`" one: the
mutable-array approach still tests the module-level default, not the call
site's own argument-passing, and would require the emitter and the guard to
genuinely be reading the *same* live array reference rather than a copy —
true today, but a fact about the current implementation the test would then
be depending on rather than asserting. An injectable parameter makes the
call site itself the thing under test, which is exactly what finding 1 asked
for, and needs no cleanup/`finally` to avoid leaking mutated global state
into other tests running in the same process.

**New test** (`test/unit/bankedbytes.test.js`, `'battleTables itself refuses
an over-limit strings list, not just the helper called in isolation'`):
builds `sample-rpg`'s project and asserts `battleTables(project, <22-entry
fabricated list>)` throws (matching the guard's own message) and that
`battleTables(project)` — the real, default path — does not. The original
three direct-helper assertions (21 passes, 22 throws, real list passes) are
kept, per the brief ("they are not the problem").

**Wrong-implementation sentence:** removing the `checkBattleStringsCapacity()`
call at the top of `battleTables` fails this test.

**Sabotage proof** — removed the call:

```js
export function battleTables(project, battleStrings = BATTLE_STRINGS) {
  const actors = project.sprites.actors;   // checkBattleStringsCapacity(battleStrings) deleted
```

Result:

```
# Subtest: checkBattleStringsCapacity refuses a BATTLE_STRINGS list past the 256-byte range push_battle_string can address
ok 3 - ...                                    <- the old, direct-helper test: still green, exactly as finding 1 predicted
# Subtest: battleTables itself refuses an over-limit strings list, not just the helper called in isolation
not ok 4 - battleTables itself refuses an over-limit strings list, not just the helper called in isolation
  error: 'Missing expected exception: battleTables must refuse through its own call site, not merely via the helper called directly'
```

Restored the call; both tests pass again (`node --test
test/unit/bankedbytes.test.js`: 15/15 pass).

## 2. No fixture forced a carry out of `ptr_lo`

**The gap, confirmed exactly as described.** Round 0's two low-index controls
(actor 3 "Snake", item 0 "Potion") never needed `ptr_lo`'s own carry into
`ptr_hi` at all — a hypothetical implementation that computes `index *
NAME_LEN` correctly as a real 16-bit product, but adds the product's low byte
into `ptr_lo` and its high byte into `ptr_hi` as two *independent* additions
(each with its own `clc`, rather than chaining the carry from the first add
into the second) is silently correct whenever `LOW(table) + index*NAME_LEN <
256`. Neither round-0 fixture crossed that line.

**Fix:** added `assertForcesCarry(symbolPath, label, index, stride)`
(`test/unit/rpg.test.js`), which reads `label`'s real address out of *this
build's own* `game.fns` (via `parseSymbolFile`, `main/build/symbols.js` —
never hardcoded, since a filler count or an engine edit can move where a
table lands) and asserts `(LOW(base) + index*stride) >= 256` before a single
glyph is checked. `buildVariant` was split into `buildVariantFull` (returns
`{romPath, symbolPath, ...}`) plus a one-line `buildVariant` that keeps
returning just `romPath`, so none of the other ~27 call sites in the file
needed to change.

Both tests' low-index control was repointed to an index that **also** forces
the carry, rather than adding a third combatant/item — reviewer's own
suggestion, and it works because the arithmetic allows an index that is both
`≤ 25` (round 0's own requirement) and carry-forcing:

- **Monster test:** actor 3 → **actor 23** ("IMP23"). Real address for this
  build (23 filler actors + IMP23 + GHOUL, MMC1): `mon_name = $821C`
  (`LOW = 28`). `28 + 23*10 = 258 ≥ 256` — forces the carry.
  (The stock, unmodified `sample-rpg` address, `$8050`/`LOW=80`, would have
  needed index ≥ 18 instead — the two differ because this variant's own
  extra actors/entities shift table placement, which is exactly why the
  address is read from *this* build's `game.fns` rather than assumed.)
- **Item test:** item 0 (Potion) → **item 14** ("GEM14"); Potion (id 0) is
  left in the project (still auto-migrated) but no longer put in the bag.
  Real address: `item_name = $8078` (`LOW = 120`). `120 + 14*10 = 260 ≥ 256`
  — forces the carry.

`GHOUL` (actor 26) and `ELIXIR26` (item 26) — the round-0 wrap fixtures —
are unchanged; both also happen to force an internal carry in this build (the
loop-based `name_offset_pc` accumulates `NAME_LEN` `index` times, so any
index past the point where the running sum first exceeds 255 needs at least
one carry during its own loop), so they continue to exercise the mechanism
too, but the round-1 fix does not rely on that — the low-index controls are
what the report and the fixture comments name explicitly.

**Sabotage proof** — the brief's own suggested sabotage, replacing `bcc`/
`inc ptr_hi` with nothing (`engine/battle.asm`):

```
name_offset_pc_stride:
  clc
  lda ptr_lo
  adc #NAME_LEN
  sta ptr_lo
  dey                      ; bcc name_offset_pc_nocarry / inc ptr_hi deleted
  bne name_offset_pc_stride
```

Result — both tests fail, and (verified separately, see below) the
**low-index control alone** is sufficient to catch it, not merely riding
along with the high-index one:

```
# monster test (both assertions in original order — GHOUL checked first, so
# the failure shown is on GHOUL; see the isolated check below for IMP23 alone)
not ok 47 - a monster at actor id 26 draws its own name when it attacks, and a low-index monster ...
  error: actor 26 must draw its own name -- ...
  + [229, 160,160,160,160,160, 208,239,244,233]   (the round-0-shaped wrong read)
  - [199,200,207,213,204, 160,160,160,160,160]    (GHOUL, expected)

# item test — failure IS on the low-index control (item 14), directly proving
# finding 2's own gap is closed:
not ok 48 - an item at id 26 draws its own name in the battle ITEM list, ...
  error: the low-index, carry-forcing control (item 14) must still draw correctly ...
  + [0,0,0,8,6,4,4,5,2,2]        (garbage -- 256 bytes before the correct address)
  - [199,197,205,177,180, 160,160,160,160,160]    (GEM14, expected)
```

Isolated check (temporarily made the monster test assert `seen[5]`/IMP23
*before* `seen[4]`/GHOUL, reran, then reverted both the reorder and the
sabotage — the reorder was for this proof only and is not part of the
delivered test):

```
not ok 47 - ... (IMP23 checked first)
  error: TEMP-REORDER-FOR-VERIFICATION the low-index, carry-forcing control (actor 23) must still draw correctly ...
  + [170,170,170,255,255,255,255,255,255,255]     (garbage)
  - [201,205,208,178,179, 160,160,160,160,160]    (IMP23, expected)
```

Confirms the low-index control by itself — independent of whether the
high-index one also happens to fail — now catches the carry-loss class of
bug. Restored `name_offset_pc` and the assertion order; reran: both tests
pass (`node --test test/unit/rpg.test.js`: 48/48 pass).

**Wrong-implementation sentence (both tests):** an implementation that
computes `index * NAME_LEN` as a correct 16-bit product but adds its low and
high bytes into `ptr_lo`/`ptr_hi` as two independent additions instead of
chaining the carry from the first into the second passes this test's
low-index control only if that control's own `LOW(table) + index*NAME_LEN`
stays under 256 — which is exactly why `assertForcesCarry` is asserted first,
so the fixture cannot go silently vacuous the next time something upstream
moves the table.

## Banked-region impact of this round

None — this round touched tests and the `battleTables` call signature only
(the default-argument path is untouched), never `engine/` and never the byte
math. `BASE_BATTLE_CODE_BYTES_BY_MAPPER` is unchanged from round 0's
re-measured figures (`{30: 3885, 1: 3885, 4: 3931}`). No additional filler
actors/items were needed to seat the repointed low-index controls (23 and 14
both replace an *existing* control rather than adding a new combatant/item),
so the banked-region byte counts from round 0's report still hold; verified
by rerunning `test/unit/bankedbytes.test.js` in full (15/15 pass, including
the board-by-board equality test).

## Confirmation: no engine file, no generator logic changed

- `engine/battleui.asm`: **not touched at all** in this round (`git diff` vs.
  the tree at the start of this round shows zero additional hunks beyond
  round 0's own change).
- `engine/battle.asm`: touched only for the sabotage proof above, and fully
  reverted afterward — `name_offset_pc` is byte-for-byte the same routine
  round 0 shipped (verified by re-reading the file after restoring).
- `main/build/battletables.js`: the only change is the `battleStrings`
  parameter and its two read sites (`battleTables`'s signature line and the
  two `BATTLE_STRINGS.forEach`/`.flatMap` calls, now `battleStrings.forEach`/
  `.flatMap`) — no computation changed, the default argument reproduces the
  exact prior behavior, and `BASE_BATTLE_CODE_BYTES_BY_MAPPER`,
  `checkBattleStringsCapacity`'s own logic, and every other exported function
  are untouched from round 0.

```
$ git diff --stat
 engine/battle.asm             |  39 ++-
 engine/battleui.asm           |  66 ++++---
 main/build/battletables.js    |  29 ++-
 test/unit/bankedbytes.test.js |  53 +++++
 test/unit/items.test.js       |  19 +-
 test/unit/kernelbytes.test.js |  44 ++--
 test/unit/rpg.test.js         | 271 +++++++++++++++++++++++-
 7 files changed, 462 insertions(+), 59 deletions(-)
```

(`engine/battle.asm` and `engine/battleui.asm`'s line counts are round 0's
diff against `master`, carried forward unchanged into this round; only
`main/build/battletables.js`, `test/unit/bankedbytes.test.js` and
`test/unit/rpg.test.js` gained lines in round 1.)

## `npm test` totals

**932 pass / 0 skip / 0 fail** (up from round 0's 931 — the one new
`battleTables`-call-site test). Full run:

```
1..932
# tests 932
# suites 0
# pass 932
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Not committed. `reviewer` was not contacted, per the brief.
