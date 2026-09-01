# Report: battle-side saturation fixes (brief-battlemath.md)

## Plan

Read the field-side idiom (`gain_hearts` in `engine/combat.asm`, `party_heal` in
`engine/rpg.asm`), apply the same `bcs`-to-the-existing-clamp guard to the three battle-side
heals, saturate the two no-maximum sites (`spell_damage_weak`, and — after assessing it as a
real, reachable member of the class — `physical_damage_noise`) to 255, census every other
additive site in the battle region and both health models, re-measure
`BASE_BATTLE_CODE_BYTES_BY_MAPPER` per board from nesasm's own usage table, write one
emulator-backed test per fixed site proven to fail before the fix, and run all three test
layers. Nothing committed.

## What changed

All five fixes are in `engine/battleturn.asm`; nothing else in `engine/` was touched.

1. **`item_chosen`** — `bcs item_chosen_max` between the `adc` and the `cmp pc_hp_max,x`,
   branching to the existing `lda pc_hp_max,x` clamp, now labelled. Diffs one-to-one against
   `party_heal`'s shape, comment included.
2. **`cast_heal` (party branch)** — identical guard, `bcs cast_heal_max`.
3. **`cast_heal_mon` (monster branch)** — identical guard against `mon_slot_max,x`,
   `bcs cast_heal_mon_max`.
4. **`spell_damage_weak`** — no maximum exists to clamp to, so it saturates:
   `bcc spell_damage_weak_store / lda #$FF` before the store. The comment records why
   `bt_dmg_hi` was not promoted into (it doubles as the XP accumulator's high byte, and `$FF`
   there means "no number on this line" to `battleui.asm`).
5. **`physical_damage_noise`** — same saturating shape, `bcc physical_damage_store / lda #$FF`.
   Assessed rather than assumed, per the brief: `bt_tmp` holds `max(1, attack − defence)`,
   attack comes from `pc_atk_at` (clamped to 0–255 by `statAt` in `main/build/battletables.js`)
   or `mon_atk` (an authored byte), and defence can be authored 0 — so `bt_tmp` reaches 253–255
   with ordinary authored stats, and the 0–3 noise roll then wrapped the hardest possible hit
   into a 0–2 scratch three rolls out of four. Real, reachable, same class; fixed.

Supporting changes:

- `main/build/battletables.js` — `BASE_BATTLE_CODE_BYTES_BY_MAPPER` re-measured (below).
- `test/unit/rpg.test.js` — five new tests plus two RAM-address constants
  (`MON_SLOT_MAX = 0x3c4`, `RNG = 0x62`, both from `engine/constants.asm`).
- `test/unit/items.test.js` — `PINNED_RPG_BASELINE_HASH` re-pinned. The pinned no-items RPG
  baseline includes the banked battle region, and these fixes are unconditional battle code, so
  the hash moves for every RPG build by design. The comment above the constant records the
  provenance: the only file in this change that reaches the ROM is `engine/battleturn.asm`
  (the constants feed `checkCapacity`'s refusal math, not emitted bytes), so the tree the new
  hash was pinned from is master plus that one diff and nothing else ROM-visible. Size
  unchanged at 147472 — bytes inserted mid-bank shift labels, they do not grow the padded ROM.
- `CLAUDE.md` — the one line citing the three base figures updated (the repo's own
  docs-go-stale rule; the historical handoff files that cite the old figures were left as the
  history they are).

## Byte figures, measured not computed

Per board, from nesasm's own segment-usage table via `test/unit/bankedbytes.test.js`'s
re-measure procedure (update one constant, re-run, read the real figure it prints):

| board | before | after | delta |
|---|---|---|---|
| UNROM 512 (30) | 3821 | 3835 | +14 |
| MMC1 (1) | 3821 | 3835 | +14 |
| MMC3 (4) | 3867 | 3881 | +14 |

The +14 is uniform (3 × 2-byte `bcs` + 2 × 4-byte `bcc`/`lda #$FF`) because none of the five
fixes branches on `SPLIT_ENABLED` or anything board-specific; MMC3 stays exactly 46 bytes above
the other two, the pre-existing split delta, undisturbed. All five fixes are unconditional
battle-region code (the `.if ITEMS_ENABLED` inside `item_chosen` only selects which heal table
is read, not whether the routine assembles), so the cost lands in the base rather than in
`ITEM_LIST_FILTER_BATTLE_ALLOWANCE`, which did not move.

**Kernel-lo is untouched on every board**, as the brief predicted: `test/unit/kernelbytes.test.js`
passes unmodified, all 51 tests — every per-board base, allowance and documented-limitation
refusal exactly where it was. `bankedbytes.test.js` is green with the new constants (13/13),
including the equality assertion that base + tables equals nesasm's usage to the byte, across
all fifteen builds.

## The census

Every `adc` in the battle region (`battleturn.asm`, `battle.asm`, `battleui.asm`), plus the two
health models (`combat.asm`, `rpg.asm`, `ui.asm`'s `use_item_apply` path) and `rpg.asm`'s
kernel half. Verdicts:

**Fixed (the five above).**

**Already correct — add-then-clamp class, guard present:**
- `gain_hearts` (`combat.asm`) — the guard this fix copies. Field side, in scope as evidence only.
- `party_heal` (`rpg.asm`) — same.

**Already correct — subtraction with the underflow clamped:**
- `apply_damage` both branches (`battleturn.asm`) — the brief's own evidence of specificity.
- `party_damage` (`rpg.asm`), `roll_hit`'s accuracy−evasion, `physical_damage`'s
  attack−defence floor, `spell_chosen`/`monster_turn` MP spends (both `cmp`/branch-guarded
  before the `sbc`).

**Already correct — bounded index or address arithmetic that can never carry:**
- `battleturn.asm`: `cast_all`/`cast_poison_all` (`other_side` + `MAX_PARTY` ≤ 8),
  `wipe_monster`'s row math (slot ≤ 3), `roll_drop`'s scaled percentage (`lsr lsr` then `cmp`),
  `try_level_up`'s 16-bit threshold compare (correct `cmp`/`sbc` chain).
- `battle.asm`: `level_row` (member ≤ 3, `MAX_LEVEL` clamped to `RPG_LIMITS.maxLevel` = 15 by
  `normalizeProject`, so the index tops out at 60), `queue_at`/`seek_at` row/column splits,
  attribute-address math (≤ $C0 + 33), and `name_offset_cmd` (`asl`-based, index ≤ 3).
  **`name_offset_pc` was wrongly listed here in the first version of this report** — see the
  found-but-deferred entry below. The misclassification is the reusable lesson: the verdict
  reasoned from the *length of the lists* the routine serves (≤ 8 rows drawn, ≤ 4 party
  members) when what the routine multiplies is the *id stored in the list entry* — a raw actor
  or item id, which ranges to 254. Bounding a census entry means bounding the operand actually
  fed to the arithmetic, not the loop that visits it.
- `battleui.asm`: all VRAM addressing, `TILE_ZERO` digit conversion (digit ≤ 9), sprite Y
  placement, `push_battle_string`'s `MSG_COLS` stride, list-row scroll adds (list length ≤ 8).
- `rpg.asm`: `start_encounter`'s `map*4 + slot` add (the add itself cannot carry: the shifted
  map index is ≤ 252 and the slot ≤ 3 — but see the adjacent observation below),
  `check_encounter`'s step counter (`cmp` against the rate each frame).
- `combat.asm`/`ui.asm`: knockback's absolute-value negation (`eor`/`adc #1`), heart-HUD and
  item-row screen positions — all position math over bounded values.

**Found and deliberately not changed:**

- **`award_spoils`' XP and gold accumulators** (`battleturn.asm` ~836–850). Both are *correct*
  16-bit adds — the low byte's carry is chained into the high byte — but neither saturates at
  65535, so a full 16-bit accumulator wraps. This is a different class from the brief's (no
  byte-level compare is being defeated; the carry is handled, the *width* runs out), and the
  fix would be widening or a 16-bit clamp. (The first version of this report said the brief
  rules 16-bit surgery out of scope; it does not — it rules out *widening damage* to 16 bits,
  a narrower statement. The deferral stands on the different-class grounds alone.) `xpCurve`
  clamps every threshold to 0xffff, so a member near the wrap has met or is one fight from
  every threshold that exists.
- **`start_encounter`'s `asl a / asl a` of the map index** (`rpg.asm` ~75). For a project with
  64+ maps, the shift discards the map's top bits before the add, so an encounter formation
  would be read from the wrong map's rows. Truncation-before-index, not carry-after-add — the
  fix is 16-bit indexing or an authoring-side cap, not a `bcs` — and no current limit appears
  to bound the map count below 64 (flat screens cap at 255, so it is reachable in principle).
  Reported here as an adjacent latent issue for a future slice; touching it is outside this
  brief.
- **`draw_mon_block`'s `adc #16` row walk** (`battle.asm` ~375). A monster's `battleTile`
  authored at 208+ with 4 rows wraps the tile index past 255. On a non-split board
  `validateProject` refuses the block before it reaches `$A0`, so it is unreachable there; on
  MMC3 (split font) that check is skipped and the wrap can happen — but the consequence is
  cosmetically wrong *art* (tile indices wrap within the same pattern table), no game state is
  touched, and the right fix is an authoring-side bounds check in `validateProject`, not engine
  arithmetic. Not changed.
- **`name_offset_pc`'s repeated-addition multiply** (`engine/battle.asm:510–523`). Review
  round 1 upheld this against the first version of this report, which had misfiled it as
  "already correct" (see the census note above for how); **the user has decided the fix is
  deferred to its own slice** — recorded here, not fixed, by that decision rather than by this
  report's own judgement. The defect: the routine computes `id * NAME_LEN` by looping
  `clc / adc #NAME_LEN` with the carry discarded, and `NAME_LEN` is 10
  (`RPG_LIMITS.nameLength`), so an id of 26 gives 260 and the offset wraps to 4 — the name
  drawn is another entry's. It is the same discarded-carry family as this slice's five fixes
  but a different *shape*: there is no maximum to clamp to and nothing sensible to saturate to
  — the result is an index that must be correct, so the fix is 16-bit base addressing
  (compute `table + id * NAME_LEN` into a zero-page pointer pair and move the four call sites'
  read loops — `draw_panel` in `battle.asm`, `push_combatant_name`'s party and monster halves,
  and `draw_list_name`'s per-phase loops in `battleui.asm` — from `absolute,y` to `[ptr],y`),
  which is why it is its own slice and not a `bcs`. Two paths are
  cleanly reachable, both re-verified against the source this round: `push_combatant_monster`
  (`engine/battleui.asm`) passes `mon_slot_actor,x`, a raw actor id (`LIMITS.actors` = 255, so
  ids to 254), and `draw_list_name`'s ITEM phase passes a bag item id straight out of
  `bt_list` (`build_item_list` stores the raw `inv_items` id; `LIMITS.items` = 255).
  Reachability verified dynamically too: a normalized 27-actor `sample-rpg` variant with actor
  26 in an encounter table validates with **zero errors** and occupies 5,052 of the region's
  8,192 bytes (review's own minimal fixture measured 4,933 — different fixture, same
  conclusion: legal, fits, reachable). The spell path is the one that *cannot* reach it, and
  the guarantee is doubled: `build_spell_list` (`engine/battleui.asm:357–378`) has **two**
  bounds, either sufficient alone. The loop's real terminator is its back edge — `iny` /
  `cpy #8` / `bne build_spell_slot`, with the comment "one bitmask byte, so eight spells a
  member" — so `y` at `lda bit_mask,y` only ever takes the values 0–7, for *any* value of
  `NUM_SPELLS` including the 32 `RPG_LIMITS.spells` allows; the head's `cpy #NUM_SPELLS` /
  `bcs` is an early exit for projects with fewer than eight spells, not the terminator.
  Independently, the generator's bitmask builder skips any spell past slot 7
  (`main/build/battletables.js`, `if (slot < 0 || slot > 7) continue`), so authored spell
  membership can only ever set bits 0–7 in `pc_spells_at` in the first place. Spell ids in
  `bt_list` therefore stay 0–7, well below the wrap threshold of 26, and `bit_mask`'s eight
  entries are never read past. (Round 1 of this report claimed otherwise — that the bound was
  `cpy #NUM_SPELLS` "not a literal `cpy #8`", and that a >8-spell project over-reads
  `bit_mask` into adjacent code bytes, injecting phantom spell ids. Both claims were wrong and
  are withdrawn: they came from reading the loop's head without its back edge — the grep that
  round was truncated before line 376 — and there is no over-read, no phantom id, and no
  adjacent latent issue on the spell path to hand to any future slice.)

## The tests

Five, in `test/unit/rpg.test.js`, all emulator-backed against engine RAM, all verified to fail
before the fix by stashing only `engine/battleturn.asm`, rebuilding `sample-rpg`, and running
them: they failed with exactly the predicted wrapped values (14, 12, 12, 211, 254), then passed
after restoring the fix.

Every fixture keeps the correct and the wrapped answer far apart, and the heal tests pin the
maximum at 253 — deliberately below 255 — so a "saturate to 255 instead of the member's own
max" wrong fix fails them too.

1. **`a potion used near the top of a byte clamps to the max instead of wrapping`** —
   HP 250 + 20-heal against max 253; expects 253, buggy build stored 14. *A wrong
   implementation that would still pass it:* one that skips the add and stores `pc_hp_max`
   unconditionally whenever a potion is used — caught by the pre-existing
   `'ITEM heals from the bag…'` test, whose 5 + 20 = 25 must land exactly.
2. **`a heal spell cast near the top of a byte clamps to the max instead of wrapping`** —
   Mend at HP 250, max 253; expects 253 and MP 20 → 16, buggy stored 12. *Wrong implementation
   that still passes:* the same store-max-unconditionally shape — caught by the pre-existing
   `'a heal spell restores HP…'` test (5 + 18 = 23 exact); saturating to 255 fails on the
   253 max.
3. **`a monster healing itself near the top of a byte clamps to its own max`** — the snake
   given Mend (`spellId: 1`) and zero attack, its slot poked to HP 250 / max 253, stalled with
   refused RUNs until it casts on itself; expects 253, buggy stored 12. Only its own Mend ever
   touches its HP in this fixture. *Wrong implementation that still passes:* one that clamps
   the *party* branch's target (`pc_hp_max`) in the monster branch too — 253 was chosen for
   both maxima here, so this specific vacuity is closed instead by test 2 and this one sharing
   only the value, not the array: this test pokes `mon_slot_max`, and a monster-branch read of
   `pc_hp_max,x` would find member 0's untouched real max (200, from the variant's own
   `baseHp`) and store that, failing.
4. **`a weakness hit at 171 or more saturates instead of dealing less than the plain hit`** —
   Ember at amount 200 into the slime's fire weakness, slime poked to 255 HP; expects HP 0 and
   the slime dead (255 saturated damage), buggy dealt 44 and left 211. *Wrong implementation
   that still passes:* one that saturates every spell hit to 255, weakness or not — caught by
   the pre-existing group-spell test, whose 10 → 15 weakness hit must land exactly; a
   16-bit-correct implementation that widened into `bt_dmg_hi` also fails (apply_damage
   subtracts only the low byte, 44).
5. **`a physical attack of 253 or more survives its own noise roll instead of wrapping`** —
   party attack authored 255 against defence 0, slime poked to 255 HP, and the LFSR seeded to
   `$B8` at the target prompt so the two rolls are deterministic (`$B8 → $01`: a hit;
   `$01 → $02`: noise 2, the roll that wrapped 255 + 2 to 1). Nothing advances the LFSR in
   battle but the rolls themselves — `check_encounter`'s per-frame advance is gated on
   `moving`, which a frozen world never sets — so the seed fully determines the attack.
   Expects HP 0 and a dead slime; buggy left 254. *Wrong implementation that still passes:*
   one that drops the noise roll entirely (255 + 0 = 255 here) — caught by the fact that
   `physical_damage`'s noise is what every ordinary-stat fight in the suite rides on
   (`'FIGHT wears the monster down…'` would still pass, but the seeded sequence documents the
   roll is taken: a no-noise implementation changes every fight's damage by 0–3 and the
   existing poison test's two-tick HP budget of 4 leaves no room for it).

## Verification

- `npm test`: **919/919 pass, 0 skipped** (both fixture ROMs built first).
- `test/unit/bankedbytes.test.js`: 13/13 — base + tables equals nesasm's usage to the byte on
  all three boards; the MMC3 46-byte-band advice test green with the new figures.
- `test/unit/kernelbytes.test.js`: 51/51 **unmodified** — kernel-lo untouched on every board.
- `npm run smoke`: passed, 110 steps.
- Mesen layer: `engine_smoke.lua` exit 0; `run_sram_check.sh` PASS mmc1 + mmc3;
  `run_flash_check.sh` PASS u512. (These exercise the field engine and save paths, not the
  battle bank — run as the house's third layer, not as coverage of these fixes; the coverage
  is the five tests above.)
- Behaviour outside the overflow cases is unchanged by construction (a guard that only
  branches when the carry is set) and confirmed by the suite: every pre-existing exact-value
  heal and damage assertion passed unmodified.

## Not touched

The Magic Forge work, anything under `handoff-magic/`, `apply_damage` (correct, per the
brief), the field-side sites (already guarded), and the four found-not-changed items above.
Nothing committed; the working tree holds `engine/battleturn.asm`,
`main/build/battletables.js`, `test/unit/rpg.test.js`, `test/unit/items.test.js` and
`CLAUDE.md` modified, plus this report.

---

*Fixes round 1 (report-only, per `brief-battlemath-fixes-round1.md`): corrected the census's
wrong "already correct" verdict on `name_offset_pc` and added it as the fourth found-but-deferred
entry — deferral is the user's decision — plus fixed the `award_spoils` entry's misstatement of
the brief's 16-bit scope rule. No engine, test or constant changes; the suite and byte figures
stand exactly as the Verification section records them.*

*Fixes round 2 (report-only, per `brief-battlemath-fixes-round2.md`): round 1 got the spell-path
bound wrong twice in one paragraph — it denied the literal `cpy #8` (which is real, on
`build_spell_list`'s back edge at `engine/battleui.asm:376`, and is the loop's actual
terminator) and invented a `bit_mask` over-read with phantom spell ids that cannot occur. Both
withdrawn; the entry now states the two independent guarantees (engine back-edge cap, generator
slot filter) as they actually are. Still no engine, test or constant changes.*
