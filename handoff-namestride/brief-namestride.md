# Brief: the name stride wraps at index 26, and draws another entry's name

You are the coder. This is a small, self-contained bug-fix slice in the banked battle region,
taken before the Magic Forge design round because that round is a spell-id renumber, and landing
a renumber on top of an unfixed name-addressing bug means any misdrawn name during that work
reads ambiguously — renumber fault or stride fault. There is no design round. State your plan in
one short section at the top of your report, then do the work. Do not contact `reviewer`; report
back to me and I will send the diff on.

## The bug

`name_offset_pc` (`engine/battle.asm:510-524`) takes an index in A and answers "Y = the first
glyph of that entry, `bt_tmp2` = `NAME_LEN`". It computes `index × NAME_LEN` by repeated 8-bit
`adc #NAME_LEN` and **discards the carry**, and every consumer then reads `lda <table>,y` —
absolute,Y — so even a correct 16-bit offset could not be used as things stand. `NAME_LEN` is 10
(`RPG_LIMITS.nameLength`, `shared/project.js:985`), so index 26 → 260 → offset 4: the engine
draws the last six glyphs of entry 0 followed by the first four of entry 1, and calls it entry 26.

This was found during the battle-math slice (`handoff-battlemath/battlemath-report.md`) and
deferred to its own slice by decision, not missed: it is not a `bcs` fix like the five sites that
slice closed — it is 16-bit base addressing, which is why it gets its own brief.

## The consumers, and which are actually reachable

All four call sites go through the one routine. They are **not** equally exposed, and the report
must say so per path rather than treating them as one:

| Consumer | Table | Index space | Reachable past 25? |
|---|---|---|---|
| `draw_panel` (`engine/battle.asm:496`) | `pc_name` | party slot, `MAX_PARTY = 4` | **No** — max offset 30 |
| `push_combatant_name`, PC branch (`engine/battleui.asm:613`) | `pc_name` | party slot | **No** |
| `push_combatant_name`, monster branch (`:626`) | `mon_name` | **actor id** via `mon_slot_actor,x` | **Yes** — `mon_name` is one row per actor (`main/build/battletables.js:163`), `LIMITS.actors = 254` |
| `draw_list_name` (`:486`), spell branch (`:493`) | `spell_name` | catalog index | **No**, by two independent bounds: `build_spell_list`'s `cpy #8` back edge (`battleui.asm:376`) and `battletables.js:242`'s slot filter |
| `draw_list_name`, item branch (`:505`, `ITEMS_ENABLED`) | `item_name` | **item id** | **Yes** — one row per item (`battletables.js:187`), `LIMITS.items = 254` |
| `draw_list_name`, legacy branch (`:508`, `!ITEMS_ENABLED`) | `mon_name` | legacy actor id | Yes in principle, for a project with no items and 26+ actors |

So an ordinary RPG with 26 actors whose 27th is a monster, or a bag holding item id 26 or above,
draws the wrong name in the battle box. No error, no capacity refusal.

**Fix the shared routine and every consumer, including the three that are unreachable today.**
The spell path is the one worth being explicit about: it is unreachable *now* because a member's
knowledge is one bitmask byte, and the Magic Forge brief (`handoff-magic/brief-magic-design.md`,
"The 32-spell catalog versus eight learnable slots") is exactly where that bound may move. A fix
that only covered the two reachable paths would leave the shared routine with two contracts.

## The shape of the fix

The routine's answer has to become a 16-bit address the consumer dereferences, not an 8-bit
offset the consumer adds. The obvious shape, which you should use unless you find a reason not to
and say what it was:

- The caller loads the table's base into the zero-page pair `ptr_lo`/`ptr_hi` (`$00`/`$01`,
  "generic 16-bit pointer", `engine/constants.asm:6-7`), then `jsr name_offset_pc` with A = index.
- The routine computes `index × NAME_LEN` in 16 bits and adds it into that pair; it returns
  Y = 0 and `bt_tmp2 = NAME_LEN` as before, so every consumer's loop becomes `lda [ptr_lo],y` /
  `iny` / `dec bt_tmp2` / `bne` with nothing else changed.
- `draw_list_name` currently calls the routine *before* branching on `bt_phase` to choose a
  table. Under this shape the base has to be chosen first, so the branch moves above the call.
  Keep the `.if ITEMS_ENABLED` / `.if !ITEMS_ENABLED` split; only the table it selects changes.

Two things to census and state before you write it, because they are what makes `ptr_lo` safe
here rather than assumed safe:

1. **Nothing inside any of the four loops may touch `ptr_lo`/`ptr_hi`.** `vram_push`
   (`engine/text.asm:128`) does not. Confirm `seek_at`, `queue_at` and anything else on the path
   between the load and the last read do not either, and confirm no NMI-time code writes the pair
   (`draw_metasprite` in `engine/entities.asm` and `chr_ram_init` in `engine/banks.asm` are the
   current users; both are mainline, but check rather than take that from me).
2. **How you multiply.** `NAME_LEN` is 10 = 8 + 2, so a shift-add (`index << 3` + `index << 1`,
   carrying into the high byte) is bounded and small; a loop adding 10 with carry is simpler and
   costs up to ~254 iterations. Either is acceptable. Say which you chose and give a cycle bound
   for the worst case, because `draw_list` runs this up to four times in one tick and
   `push_combatant_name` runs it per message — the bound must stay trivially inside a frame.
   Do not hardcode 10: use `NAME_LEN` from `config.inc`, which is the single writer for it.

Keep the routine's name. The comment at `battleui.asm:434-437` (why `draw_list` counts rows in
`bt_vrow`, not `bt_tmp2`) depends on `bt_tmp2` still being the routine's length answer; if you
change that contract, change that comment, and check `name_offset_pc`'s other documented
dependants (`engine/constants.asm:172`). nesasm v3.1 aborts on any label of 31 or more
characters; keep new labels well under that.

## Constraints

- **This is banked-region cost, not kernel-lo.** `battle.asm` and `battleui.asm` are both on the
  far side of `call_battle`. `BASE_BATTLE_CODE_BYTES_BY_MAPPER` (`main/build/battletables.js`,
  currently UNROM 512 3835 / MMC1 3835 / MMC3 3881) must be re-measured per board and updated,
  because `test/unit/bankedbytes.test.js` asserts base plus tables equals nesasm's reported usage
  **to the byte**. Do not adjust those constants by arithmetic; rebuild and read the real
  figures. Confirm in the report that kernel-lo is untouched on every board — if any kernel
  figure moves, stop and say so, because the change would not be where this brief thinks it is.
- **The `ITEMS_ENABLED`-false path changes bytes too, and that is intended here.** CLAUDE.md's
  promise that the item phases leave that path byte-identical is a promise about *those phases*;
  a bug in a routine both paths share is fixed in both. `test/unit/items.test.js` pins a golden
  SHA-256 of a ROM (`:368`, `:429`) that will need re-pinning — re-pin it, and say in the report
  which test and why the hash moved, so nobody reads the re-pin as hiding a regression.
- **Every name at index 25 or below must draw byte-identically to before.** The nametable
  contents for an unaffected name are the regression surface, not engine RAM.
- Nothing about behaviour outside name drawing may change. Do not touch the Magic Forge work.

## A neighbour with the same shape — a guard, not a fix

`push_battle_string` (`engine/battleui.asm:637`) accumulates `index × MSG_COLS` the identical
8-bit way, with `MSG_COLS = 12`. It is safe today — `BATTLE_STRINGS` (`battletables.js:284`) has
11 engine-authored entries, max offset 120 — and is **out of scope for a code change**. Instead,
make the bound explicit in the generator where the list lives: throw from `battleTables` (or
wherever `BATTLE_STRINGS` is emitted) if `BATTLE_STRINGS.length * MSG_COLS > 256`, with a message
naming `push_battle_string` and this bug. A one-line guard that fails the build at the 22nd
string is worth more than a comment the 22nd string's author will not read.

## Tests

Emulator-backed, in `test/unit/rpg.test.js`, using `buildVariant` and reading the **nametable**
(`nes.ppu.vramMem[0x2000 + row * 32 + col]`, the way `test/unit/script.test.js:2061` does), not
engine RAM — the bug is in what reaches the screen, and RAM is correct throughout. Each must
**fail before the fix**; run them against the unfixed tree and put the failing output in the
report.

1. **A monster at actor id ≥ 26 draws its own name.** Build a variant with at least 27 actors, the
   last a battle-capable monster in a formation `walkIntoEncounter` (or a touch encounter) can
   reach, with a name whose glyphs differ obviously from what the wrapped read would produce —
   offset 4 lands inside actor 0's name, so choose actor 0's and actor 1's names such that
   "chars 4-9 of actor 0 then chars 0-3 of actor 1" is visibly a different string. Get the
   battle to the message that names the monster (`push_combatant_name`'s monster branch — find
   the phase and the frame the packet has drained on), and assert the message row's tiles equal
   `nameTiles(<its name>)` (`main/build/battletables.js:88`, or `textToTiles`). Filler actors are
   cheap (30 banked bytes each) but check the banked region still fits on all three boards.
2. **An item at id ≥ 26 draws its own name in the ITEM list.** A variant with at least 27 items,
   the last `{kind: 'heal', amount > 0}` so `build_item_list` admits it; poke it into `inv_items`
   after boot the way the test at `rpg.test.js:1097-1118` does; open ITEM; assert the list row's
   tiles. Same wrapped-string construction as test 1.
3. **A low-index control in each of those same builds**: an actor and an item at an index ≤ 25
   still draw correctly in the same battle, so a fix that moved the table base for everyone is
   caught.
4. **The generator guard**: a unit test that a `BATTLE_STRINGS` list of 22 entries makes
   `battleTables` throw, and 21 does not. Keep it in whichever test file already covers
   `battletables.js` output.

The house rule applies with full force: for every test, **name the wrong implementation that
would still pass it**, and put that sentence in the report. The specific trap here: a fixture
whose wrapped read happens to produce the right glyphs — a name that is all spaces, actor 0 and
actor 26 sharing a name, an index whose wrapped offset lands on a padded tail — passes
vacuously. Pick fixtures where correct and wrong are far apart and obviously different, and
prove the "before" failure by running them.

## Deliverable

The fix, the tests, the re-measured constants, the re-pinned hash, the generator guard, and
`handoff-namestride/namestride-report.md`: your plan, the per-path reachability verdicts (with
the two unreachability bounds for the spell path restated from the code, not from this brief),
the `ptr_lo` census, the multiply you chose and its cycle bound, the real before/after byte
figures per board, the before-fix failing output of each test, the wrong-implementation sentence
for each test, and anything you found that you did **not** change with the reason. Do not commit.
Do not contact `reviewer`.
