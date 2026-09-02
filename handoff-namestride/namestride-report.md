# Report: the name-stride wrap at index 26

## Plan (stated up front, then executed)

1. Change `name_offset_pc` (`engine/battle.asm`) from "index → 8-bit offset the
   caller adds to a table array reference" to "index → 16-bit address the
   caller dereferences": the caller loads the table's base into `ptr_lo`/
   `ptr_hi` before calling, the routine adds `index * NAME_LEN` into that pair
   as a 16-bit quantity, every consumer's read loop becomes `lda [ptr_lo],y`.
2. Update all four call sites (`draw_panel`; `push_combatant_name`'s two
   branches; `draw_list_name`'s spell/item/legacy branches) to load the right
   base and dereference through the pointer, including the three that are
   unreachable today — the shared routine gets one contract, not two.
3. Re-measure `BASE_BATTLE_CODE_BYTES_BY_MAPPER` on all three RPG-capable
   boards from a real build (never adjusted by arithmetic).
4. Add a generator-side guard (`checkBattleStringsCapacity`) for
   `push_battle_string`'s identical, still-safe-today 8-bit stride, per the
   brief's explicit call to leave that routine itself unchanged.
5. Write emulator-backed, nametable-reading tests that fail on the unfixed
   tree and pass on the fixed one; re-pin the golden ROM hash `items.test.js`
   pins; recalibrate the two `kernelbytes.test.js` tests whose own fixture
   depended on the banked region's now-larger base.

## Per-path reachability, restated from the code (not from the brief)

| Consumer | Table | Bound in the code | Reachable past 25? |
|---|---|---|---|
| `draw_panel` (`engine/battle.asm:482-506`) | `pc_name` | `draw_panel_slot`'s own `cpx #MAX_PARTY` (`MAX_PARTY = 4`, `engine/constants.asm:480`) | **No** — max offset `(4-1)*10=30` |
| `push_combatant_name` PC branch (`engine/battleui.asm:618-628`) | `pc_name` | `cmp #MAX_PARTY / bcs push_combatant_monster` gates entry to this branch on `A < 4` | **No** |
| `push_combatant_name` monster branch (`:629-654`) | `mon_name` | `lda mon_slot_actor,x` — the *actor id* stored in that slot, unbounded by anything in this routine; actor ids run 0-254 (`LIMITS.actors`, `shared/project.js`) | **Yes** |
| `draw_list_name` spell branch (`:479-515`, via `build_spell_list`) | `spell_name` | Two independent bounds: the engine's own `cpy #8` back-edge (`battleui.asm:376`, "one bitmask byte, so eight spells a member") and the generator's own `if (slot < 0 \|\| slot > 7) continue` (`battletables.js:242`) | **No**, doubly bounded at 7 |
| `draw_list_name` item branch (`ITEMS_ENABLED`) | `item_name` | `bt_list` built by `build_item_list` from `inv_items` (the bag), which holds item ids up to `LIMITS.items = 254` | **Yes** |
| `draw_list_name` legacy branch (`!ITEMS_ENABLED`) | `mon_name` | Same bag, read as legacy actor ids when a project has no `items[]` at all; up to `LIMITS.actors = 254` | **Yes, in principle** — a project with no items and 26+ actors |

Confirmed directly: `mon_slot_actor,x` is written from `MON_SLOT_ACTOR + <slot>`
by `spawn_entities`/`setup_monsters`/the touch-encounter/formation code with no
clamp of its own past the actor id itself, and `build_item_list`'s own loop
bound is `cpy #MAX_ITEMS` over the *bag*, not a spell-list-style small
constant — so both really are actor/item ids, unbounded below 255.

## The `ptr_lo` census

`ptr_lo`/`ptr_hi` (`$00`/`$01`, "generic 16-bit pointer", `engine/constants.asm:6-7`).
Checked every mainline user and the NMI handler itself:

- **NMI (`engine/boot.asm:327-451`) never touches `ptr_lo`/`ptr_hi` at all.**
  `vram_drain` (`engine/text.asm:150-170`), the only thing NMI calls that
  moves bytes into VRAM, indexes `vram_buf` with `X` directly — no zero-page
  pointer involved. Grepped the whole `nmi:`...`nmi_rti:` block for
  `ptr_lo`/`ptr_hi`: zero hits.
- **The other users are `chr_ram_init` (`engine/banks.asm:352`, boot-only,
  called once from `boot.asm:45`), `draw_metasprite` (`engine/entities.asm:602`,
  called from `battleui.asm:797` and `ui.asm:442/465`, all mainline), and
  `music_tick`/the SFX pointer swap (`engine/music.asm`, `script.asm:822-837`,
  called from `main_loop`/`ui_tick`, mainline).** None of these run in NMI.
- **Inside the four read loops themselves**, nothing touches `ptr_lo`/`ptr_hi`:
  `draw_panel_char` does a bare `sta $2007` with no calls; `push_pc_char`/
  `push_mon_char`/`draw_list_name_char` each call only `vram_push`
  (`engine/text.asm:128-136`), whose own comment says "Preserves X and Y" and
  which — checked — never references `ptr_lo`/`ptr_hi`, `seek_at`
  (`battle.asm:306-325`, used before `draw_panel`'s own call) writes `$2006`/
  bit-tests `$2002` only, and `queue_at` (`battleui.asm:24-44`, used before
  `draw_list_name`'s own call) touches only `bt_row`/`bt_col`/`vram_open`.

So `ptr_lo` set up before a call and read through during the loop is safe:
nothing between the load and the last read can move it, and no interrupt
handler has an opinion about it at all.

## The multiply

**Chosen: add `NAME_LEN` into `ptr_lo`/`ptr_hi` (16-bit, carry propagated),
`index` times** — not the shift-add the brief also offered. Reason: a
shift-add decomposition (`index<<3 + index<<1`) is a structural fact about
`NAME_LEN` happening to equal 10 today; nothing in that code shape *reads*
the `NAME_LEN` symbol, so a future change to `RPG_LIMITS.nameLength` would
assemble cleanly and compute a silently wrong offset. The loop version's body
is `adc #NAME_LEN` — it literally is parameterized by the symbol, the
brief's own instruction ("use `NAME_LEN` from config.inc ... don't hardcode
10"), and it costs nothing to get wrong later because there is nothing
value-specific to get wrong.

```
name_offset_pc:
  tay
  beq name_offset_pc_len
name_offset_pc_stride:
  clc
  lda ptr_lo
  adc #NAME_LEN
  sta ptr_lo
  bcc name_offset_pc_nocarry
  inc ptr_hi
name_offset_pc_nocarry:
  dey
  bne name_offset_pc_stride
name_offset_pc_len:
  ldy #0
  lda #NAME_LEN
  sta bt_tmp2
  rts
```

**Cycle bound**, worst case `index = 254` (`LIMITS.actors`/`LIMITS.items`):
per-iteration cost is `clc(2) + lda zp(3) + adc #imm(2) + sta zp(3) + bcc(2/3)
+ [inc zp(5) on carry] + dey(2) + bne(2/3)` — 18 cycles on the ~9-in-10
no-carry iterations, 22 on the ~1-in-10 that carry (`NAME_LEN=10` means a
carry roughly every 25.6 iterations; 254 iterations carry 9 times). Worst
case: `245*18 + 9*22 ≈ 4,608` cycles, plus ~10 cycles of fixed overhead —
**under 4,700 cycles**. `draw_list` calls this up to four times in one tick
(**under 18,800 cycles**), `push_combatant_name` once per message. Both are
comfortably inside a frame's ~29,780-cycle NTSC budget (`1,789,773 / 60.0988`),
and neither runs during battle's other per-frame work (the field's own
movement/collision systems do not tick while `game_state` is `ST_BATTLE`).

## Real byte figures, per board (re-measured, not computed)

| Board | Old `BASE_BATTLE_CODE_BYTES_BY_MAPPER` | New (real nesasm usage minus table bytes) | Delta |
|---|---|---|---|
| UNROM 512 (30) | 3835 | **3885** | +50 |
| MMC1 (1) | 3835 | **3885** | +50 |
| MMC3 (4) | 3881 | **3931** | +50 |

Same +50 on all three boards — no board-specific branch in any of the changed
code, so the fix costs the same everywhere. Table bytes (464) and
`ITEM_LIST_FILTER_BATTLE_ALLOWANCE` (17) are unchanged, since the name
*tables'* own contents never moved, only the code that reads them.

**Kernel-lo is untouched on every board.** `kernelbytes.test.js`'s 49
byte-equality tests all pass unmodified — none of the changed files
(`engine/battle.asm`, `engine/battleui.asm`) are kernel-lo files. Two
*mapper-suggestion* tests in that file needed recalibrating (below), but that
is the banked-region math cascading into a different check, not a kernel-lo
figure moving.

## `kernelbytes.test.js` recalibration (banked-region growth, not kernel-lo)

Two tests build `sample-rpg` on UNROM 512, inflated with 128 filler actors,
and assert `switchableMappers` still offers MMC1 as a kernel-lo-shortfall fix.
MMC1's own banked battle region had exactly 30 bytes free at 128 fillers
before this fix; the fix's +50-byte base cost applies to MMC1 too, so at 128
fillers MMC1's battle region now overflows by 4 bytes and stops being offered.
Re-measured directly (`battleRegionBytes`/`battleRegionCeiling`): 126 fillers
leaves MMC1's battle region 26 bytes free (fits), 127 overflows by 4. Both
tests now use `inflate(project, 126)`; comments rewritten with the real
before/after numbers rather than adjusted by arithmetic. Both pass.

## The golden hash re-pin (`items.test.js`)

`PINNED_RPG_BASELINE_HASH` (the "an RPG with no items and no Save is
byte-identical to the pre-round-4 master build" test) moved:

- Old: `5180bfc7a74f1e07c98573a29c7e6f358cc8d30aa277c4c6835b374e2d72d723`
- New: `11ae1dc40badcf8d317692cc75c5423fac2506bfec8d9a8670f23ebe68bfa572`
- Size unchanged: 147472 bytes (bytes inserted mid-bank shift every label
  after them; the padded ROM's own size does not move).

Why it moved despite the fixture having no items: `draw_list_name`'s
item/legacy branch is unconditional battle-region code — it also draws the
spell list, and under `!ITEMS_ENABLED` it draws the legacy actor-id list — so
it assembles (and changed) regardless of whether the project has any items.
Comment in the test explains this so the re-pin doesn't read as hiding a
regression.

## Generator guard (`push_battle_string`, out of scope for an engine change)

`push_battle_string` (`engine/battleui.asm:637`) does the identical 8-bit
`index * MSG_COLS` stride `name_offset_pc` used to. Safe today —
`BATTLE_STRINGS` has 11 entries, max offset 120 of 256 — but nothing stopped
a 22nd from reintroducing the same bug. Per the brief, this is a generator
guard, not an engine change: `checkBattleStringsCapacity(list = BATTLE_STRINGS)`
(`main/build/battletables.js`) throws when `list.length * MSG_COLS > 256`,
called unconditionally at the top of `battleTables(project)` so every build
hits it. Tested directly with a fabricated 22-entry list (throws) and a
21-entry list (does not) — not by mutating the real, 11-entry constant, since
the guard is exported and testable with an injected list.

## Tests, their before-fix failures, and the wrong-implementation sentence

All four live in `test/unit/rpg.test.js` (1, 2, 3 combined into the two
emulator tests below) and `test/unit/bankedbytes.test.js` (4). Each was run
against the unfixed tree (`git stash push -- engine/battle.asm
engine/battleui.asm`, run, `git stash pop`) and confirmed to fail there.

### 1 & 3. Monster at actor id 26, with a low-index control in the same fight

`'a monster at actor id 26 draws its own name when it attacks, and a
low-index monster in the same fight still draws correctly'` — builds
`sample-rpg` with 23 filler actors (ids 4-25) plus actor 26 ("GHOUL", very
high speed/accuracy so it reliably gets an early attack), placed on the map
as a touch encounter. Seats a second monster, actor 3 ("Snake", the low-index
control), into the same formation via the one-frame formation-edit window the
existing `twomon` test already established as safe. Waits for each
monster's own `BS_HITS`/`BS_MISSES` message (`BT_PHASE == BP_MESSAGE`,
`BT_ACTOR >= MAX_PARTY`), reads the nametable row `push_combatant_name`
wrote, and compares it to `nameTiles(...)` for the real name.

**Before-fix failure** (`git stash`'d engine files, tests unchanged):

```
actor 26 must draw its own name -- a wrong implementation would draw
"e     Poti" here instead (actor 0's own chars 4-9, "Slime" padded, followed
by actor 1's chars 0-3, "Poti" from "Potion")
+ actual - expected
  [
+   229,                    (= 'e')
    160, 160, 160, 160, 160,
+   208, 239, 244, 233      (= 'P','o','t','i')
-   199, 200, 207, 213, 204 (= 'G','H','O','U','L')
-   160, 160, 160, 160, 160
  ]
```

This is *exactly* the predicted wrapped read (actor 0's chars 4-9 = `"e" +
5 spaces`, then actor 1's chars 0-3 = `"Poti"`), confirming both the
diagnosis and the fixture's design. After the fix, both assertions pass.

**Wrong-implementation sentence:** an implementation that fixed only the
*reachable* paths (`push_combatant_name`'s monster branch, `draw_list_name`'s
item branch) and left `draw_panel`/the PC branch of `push_combatant_name`
untouched would still pass this test, since neither of those is exercised
here — which is exactly why the brief requires fixing all four call sites,
not just the two reachable ones, and why this test's own low-index control
(actor 3, via the monster branch, not the party branch) cannot substitute for
testing `draw_panel` or the PC branch directly. It does not claim to.

### 2. Item at id 26, with a low-index control in the same bag

`'an item at id 26 draws its own name in the battle ITEM list, and a
low-index item in the same bag still draws correctly'` — pushes 25 filler
items (ids 1-25, `kind: 'heal'`) plus item 26 ("ELIXIR26"), pokes `inv_items`
with `[0 (Potion), 26]`, opens the ITEM menu, and reads both list rows.

**Before-fix failure:**

```
item 26 must draw its own name -- a wrong implementation would draw
"on    I1  " here instead (item 0's own chars 4-9, "Potion" padded, followed
by item 1's chars 0-3, "I1  ")
+ actual - expected
  [
+   239, 238,                (= 'o','n')
    160, 160, 160, 160,
+   201, 177                 (= 'I','1')
-   197, 204, 201, 216, 201, 210 (= 'E','L','I','X','I','R')
    160, 160
  ]
```

Again exactly the predicted wrap. Passes after the fix.

**Wrong-implementation sentence:** an implementation that filtered
`build_item_list` correctly but left `draw_list_name`'s own item branch
unfixed would still fail this test correctly (it is testing the drawing
routine, not the filter) — but an implementation that "fixed" the bug by
special-casing item ids specifically (rather than fixing the shared
`name_offset_pc`) would pass this test while leaving the monster test above
failing, which is why both tests exist rather than one standing in for both.

### 4. The generator guard boundary

`'checkBattleStringsCapacity refuses a BATTLE_STRINGS list past the
256-byte range push_battle_string can address'` (`bankedbytes.test.js`) —
asserts a fabricated 22-entry list throws (`22*12=264 > 256`) and a 21-entry
list does not (`21*12=252`), plus that the real, shipped 11-entry list never
throws.

**Wrong-implementation sentence:** an implementation checking
`list.length > 256` (conflating entries with bytes) would never throw for
any realistic list size and would pass a looser test asserting only "throws
somewhere"; this test's boundary is the exact entry count (22, not e.g. 256)
where `entries * MSG_COLS` first exceeds 256, which such an implementation
gets wrong.

## What was found and not changed, and why

- **`push_battle_string` itself** — per the brief, left as an 8-bit stride;
  the generator guard is the fix.
- **`CLAUDE.md`'s own `BASE_BATTLE_CODE_BYTES_BY_MAPPER` figures**
  (`UNROM 512 3835, MMC1 3835, MMC3 3881`, around line 1185) are now stale —
  they should read 3885/3885/3931. Left untouched: this codebase's own
  convention (visible in the git history — `6a44850`, `3a151c4`, `0e53150`,
  `f0413f4`, all separate "docs pass" commits landing after their slice's own
  implementation commit) is to ship the code slice first and correct
  CLAUDE.md's prose in a following, separate commit. Flagging it here rather
  than silently leaving it for someone to notice as a stale claim later.
- **Nothing about the Magic Forge, spell-catalog sizing, or anything outside
  name drawing was touched.**

## Full test run

`npm test`: 931/931 pass (928 before this slice's 3 new tests), 0 skipped, 0
failed. `test/unit/bankedbytes.test.js` (13 tests, +1 new), `kernelbytes.test.js`
(51, 2 recalibrated), `items.test.js` (18, 1 hash re-pinned), `rpg.test.js`
(48, +2 new) all pass individually. `node main/build/cli.js sample-rpg` builds
clean on its default board (MMC1) with the new figures.

Not committed, per the brief.
