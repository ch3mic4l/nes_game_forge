# Design: the monster spell list

A hostile actor carries several spells it picks among in battle, instead of the single
`battle.spellId` it has today.

## §0. What was read to write this document (HEAD `70f2db8`)

Every citation below is `file:line` at this commit unless marked "reasoned" (§17). Every citation
was re-read at the time of writing, not assumed from memory or copied from an earlier note.

- `engine/battleturn.asm:968-1027` — the whole monster's-turn block: the header comment (970-972),
  `monster_turn` (973-997), `monster_turn_attack`/`monster_missed` (998-1013), `pick_party_target`
  (1015-1027, its own comment 1013-1014, quoted verbatim in §3 rather than paraphrased — it argues
  against randomness for *targeting*, and must not be read as endorsing random spell selection).
- `engine/battleturn.asm:117-171` — `battle_first_turn`/`battle_next`/`battle_take_turn`: how a
  monster's turn is dispatched (134-170), proving it runs to completion in one call with no
  suspension across it.
- `engine/battleturn.asm:1-172` — `battle_round`/`order_insert`/`combatant_speed`/`combatant_alive`
  (12-116): the `combatant_*` register-preservation convention (`bt_x`/`bt_y`/`bt_ret`).
- `engine/battleturn.asm:174-325` — `battle_act`/`spell_chosen` (184-215: `ldx bt_sel / lda
  bt_list,x` at 185-186 — `bt_list` is read by **position**, `bt_sel` naming the row directly: list
  order already carries real meaning in this codebase, not something introduced by this design),
  `item_chosen` (221-260), `attack_target` (263-275), `cast_spell` (280-301), `cast_all` (305-324:
  `bt_tmp2` is initialized by `cast_all` itself at 306-310 — not something a caller must have
  prepared beforehand; §6's own contract note relies on this).
- `engine/battleturn.asm:760-806` — `roll_spell_amount` (767-783) and `mod8` (792-806): the
  existing rejection-sampling uniform-draw machinery, called from *inside* `cast_all`'s own loop
  (via `spell_damage`) — which is the actual reason `mod8`'s own contract comment forbids touching
  `bt_tmp2`, and which does **not** apply to this design's own mod routine (§6's own note).
- `engine/rpg.asm:1-24` — `rng_next` (14-24), an 8-bit Galois LFSR: `lda rng / bne rng_shift / lda
  #$A5 [zero repair] / rng_shift: asl a / bcc rng_store / eor #$71 / rng_store: sta rng / rts`.
  `rng_next` is called "once per frame *and* once per roll" (11-12) — advancement is **not**
  confined to whichever roll a test is trying to isolate, which is why §12's own RNG-identity test
  must compare at explicit, stalled turn-entry/turn-exit boundaries rather than "after N rounds."
- `engine/constants.asm:131-181` — the battle RAM block: `bt_tmp`/`bt_tmp2` (149-150), `bt_len`
  (164), `bt_arg` (166), `bt_x`/`bt_y`/`bt_ret` (170-172).
- `engine/constants.asm:554-583` — `pc_spells` (554), `mon_slot_actor` (556), `bt_list` (571),
  `mon_slot_mp` (583).
- `engine/constants.asm:543-545` — `MAX_PARTY = 4`, `MAX_MONSTERS = 4`, `NUM_COMBATANTS = 8`.
- `engine/constants.asm:823-844` — the `NO_*` sentinel block, all `$FF`, hand-defined, each a
  compile-time engine constant rather than a project-derived limit.
- `engine/constants.asm:1-8` — the file's own opening: separates project-derived, *generated*
  configuration (`config.inc`, included elsewhere) from hand-written engine constants defined here
  — the distinction `MONSTER_SPELLS` (generated) and `NO_SPELL` (hand-defined) must keep separate
  (finding 7, §6).
- `engine/constants.asm:6-7` — `ptr_lo`/`ptr_hi = $00/$01`, "generic 16-bit pointer" — **assembled
  as 3-byte absolute operands throughout this engine**, confirmed empirically below.
- `docs/design-magic-power.md:1460-1475` — the reconciliation note this design's whole byte/cycle
  methodology now follows: "no operand anywhere in `engine/*.asm` uses the `<` prefix that would
  force true zero-page addressing, so every apparently-zero-page-range scratch byte… actually costs
  an absolute operand's 3 bytes and 4 cycles, not a zero-page operand's 2 bytes and 3 cycles."
  §6's own byte and cycle accounting follows this convention throughout — every scratch-byte
  operand under `$100` costs an absolute instruction's bytes and cycles, never a true zero-page
  instruction's, since nothing in `engine/*.asm` ever uses the `<` prefix that would force it.
- `engine/battleui.asm:157-198` — `battle_menu_magic` (157-167), and the `bt_len`/`inv_count`
  comment (171-184): **`bt_len == inv_count` holds only on the unfiltered (`ITEMS_ENABLED`-false)
  path**; the comment explicitly describes their possible mismatch on the filtered path — it is not
  an unconditional identity, and must not be cited as one.
- `engine/battleui.asm:354-419` — `build_spell_list` (354-379) has **no conditional portion at
  all** — it is unconditional code, not a two-body precedent of any kind; `build_item_list`
  (394-419) is the one with a conditional portion inside it, and even that is a single routine
  definition with an `.if ITEMS_ENABLED` block inside it, not two complete alternative bodies
  under one label (finding 19; finding 10 corrects the earlier, wrong claim that both had a
  conditional portion). `draw_list_name` (488-522, the `LOW()`/`HIGH()` + `[ptr_lo],y` idiom this
  design's own pointer arithmetic copies).
- `engine/combat.asm:312-354` — `player_hazard`: also **not** a two-body precedent for the same
  reason (one label, a conditional block inside it).
- `engine/text.asm:368-403` — **the real two-body precedent**: `text_type_page`/`text_type_name`/
  `text_type_glyph`. `text_type_name` is defined **twice**, the label itself appearing once inside
  `.if NAME_TOKEN_ENABLED` (368-399: the label at 369, the full real body running through the
  `rts` at 398, `.endif` at 399) and once inside `.if !NAME_TOKEN_ENABLED` (400-402: the label
  alone, immediately falling through to `text_type_glyph`) — the exact shape §6's
  `monster_turn` gating copies: the *label* repeats under opposite conditionals, not merely a block
  inside one shared body.
- `engine/battle.asm:715-736` — `name_offset_pc`: **A holds the index on entry**, then `tay`
  transfers it to Y (719-720). Adds `index * NAME_LEN` onto `ptr_lo`/`ptr_hi` by repeated addition
  (a runtime, non-power-of-two stride); this design's own `actor_id * MONSTER_SPELLS` uses a shift
  instead, since `MONSTER_SPELLS` is a compile-time power of two.
- `engine/split.asm:51-144` — `split_progs`/`split_prog_start`, `split_arm` (112-144,
  `split_prog_start-1,x` at 127): confirms `label±N,x` offset addressing is valid nesasm v3.1
  syntax, and that an ASM-authored data table living inline beside code is established.
- `main/build/battletables.js:1-33` — file header: parallel-arrays-by-actor-id shape.
- `main/build/battletables.js:76-89` — `hex` (80, `value & 0xff` — trap, §11), `dbRows` (82-89).
- `main/build/battletables.js:123-306` — `battleTables`: `mon_spell` (192-198), `mon_name` (202,
  the flat-array-per-actor precedent), `NUM_SPELLS`/`spell_cost` (244-245), and the `known` builder
  for `pc_spells_at` (298-311: `spells.findIndex((spell) => spell.id === entry.spellId)` gives
  `slot`, then `1 << slot` — **`project.spells`' own array order is a real bit-position dependency,
  not position-insensitive** (finding 16); a reorder of `project.spells` would change which bit
  every party member's learned spell occupies).
- `main/build/battletables.js:485-1010` — `BASE_BATTLE_CODE_BYTES_BY_MAPPER` (530),
  `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` (569), `MAGIC_POWER_BATTLE_ALLOWANCE` (578),
  `MAGIC_DEFENCE_BATTLE_ALLOWANCE` (588), `BATTLE_SLACK` (608), `battleTableBytes` (648),
  `battleRegionBytes` (867-878), `battleRegionCeiling` (887), `battleShortfallAdvice` (936-1010:
  the `levers` array 938-963, the `nameFeatures`/`nameBudget`/`nameFreed` block 977-1010 — every
  entry and comment there is naming-specific today; §7 generalizes the *variable names and doc
  comments*, not the mechanism, per finding 17).
- `main/build/generate.js:1347-1502, 1600-1660` — `switchableMappers` (1347): its own fit check at
  1469, `if (checkBattleRegion && bankedCode && battleRegionBytes(moved, candidate) >
  battleRegionCeiling(candidate))` — **`switchableMappers` reads the banked region's own byte
  count**, called by `kernelShortfallAdvice` at 1636 (default `checkBattleRegion: true`, i.e. the
  banked-region check is live on that call) *and* by `battleShortfallAdvice`'s own caller at 2263.
  `battleShortfallAdvice` is **not** "the only advice function" reading the banked region (finding
  17) — `kernelShortfallAdvice`, a kernel-lo advisor, also consults it indirectly, to avoid ever
  recommending a mapper switch that would fix a kernel-lo shortfall while silently breaking the
  banked region.
- `main/build/generate.js:2200-2212` — the Build panel's capacity-math attribution comment: "a
  monster's own battle stats (attack, drops, weak/resist, spellId, battle artwork)" (2206-2207) —
  a plain-English comment naming `spellId`; classified in §5 as needing a wording update, not a
  behavioural change (finding 12).
- `shared/project.js:1116-1135` — `RPG_LIMITS`: `party: 4`, `monstersPerBattle: 4` (1118), `spells:
  32` (1125) — the sibling location `RPG_LIMITS.monsterSpells` would join.
- `shared/project.js:238-268` — `LIMITS`: `actors: NO_ACTOR` (263); `NO_ACTOR = 0xff` (89) — a real
  actor id can reach 254, and `254 × 4 = 1016` overflows a byte.
- `shared/project.js:4960-5013` — the actor `battle` normalizer: `mp: clamp(…, 0, 255, 0)` (4969),
  `spellId: null-or-clamp(0, 255, 0)` (4995-4998).
- `shared/project.js:2526-2568` — `renumberSpellDeletion`, doc comment in full (2526-2554): the two
  fields' differing disciplines — `battle.spellId` is a fixed point, `member.spells` entries are
  dropped. The shift rule itself, `const shift = (id) => (id > index ? id - 1 : id)` (2556): an id
  **equal to** the deleted index maps specially (to `null`/dropped); an id **greater than** it
  shifts down by one; an id **less than** it is untouched — the rule §11's `[1, 3, 1]` example must
  follow exactly (finding 14).
- `shared/project.js:5944-5975` — `projectUsesMagicPower`/`projectUsesMagicDefence`, the gating
  precedent §7 copies; `validateProject`'s opening (5976-5978) — grepped, confirmed no `spellId`
  check on an actor today.
- `shared/project.js:1187` — `monsterActorIds` (signature only).
- `shared/save.js:68, 126, 224-271` — `SAVE_LAYOUT_VERSION = 3`; `{ ram: 'pc_spells', size:
  RPG_LIMITS.party }` (126, the party's own learned-spell bitmask); `saveIdentity` (224-271). No
  `mon_spell`/monster-spell content anywhere in `shared/save.js`.
- `renderer/forges/monster/monster.js:86-152` — `itemPickerOptions`' own comment (90-94): "how the
  currently-named one is represented if it does **not** resolve… `missing` is only rendered below
  when `battle.drop` is not null: this field's own 'Nothing' already covers that case as a
  deliberate choice, **not a broken reference**." `itemPickerOptions` **distinguishes** a stale
  reference from an authored `Nothing` (a `missing` flag); it is not a precedent for silently
  rendering both the same way (finding 19). `battleSection` (76-152), the `Casts` select (138-151):
  exact tooltip text at 143, `'Cast about half the time while the MP above lasts; otherwise it
  attacks'` — quoted verbatim in §8, not paraphrased.
- `renderer/forges/character/character.js:195-235` — the `Learns` checkbox list: `spellIndex >= 8`
  disable (215).
- `main/smoke.js:6591-6702` — the phase-1 `renumberSpellDeletion` reproduction scenario.
- `main/smoke.js:7385-7611` — the real Monster Forge smoke section; no direct coverage of the
  `Casts` select today (grepped, confirmed again this round).
- `test/unit/rpg.test.js` — `bootPastNaming` (253); `battle = {…, spellId: …}` assignments at
  `:1855, 2356, 2880` (the last, `atk: 0, spellId: 1`, the existing "zero the attack to isolate a
  spell hit" idiom this design's own §9 variant copies). The existing test at `:3821-3860` ("a
  monster with a spell casts it, spending its own MP, and poison ticks") — re-read in full: it
  asserts eventual poisoning, some MP expenditure, and later HP loss. **It does not measure cast
  frequency or exact per-round MP accounting** — it cannot stand as evidence for "about half the
  time" (finding 11); recorded honestly as off-path migration/regression coverage only in §12.
- `test/unit/bankedbytes.test.js:1-176, 410-437` — `measureRegion` (124-151); the
  `MAGIC_POWER_BATTLE_ALLOWANCE` isolation test (417-437), the shape §12's own new test copies.
- `test/unit/nameentry.test.js:73-124` — the six-fixture SHA-256 `BASELINES` gate.
- `test/unit/project.test.js:1810-1956` — **five** monster-side `renumberSpellDeletion` tests (not
  four — §5's own table enumerates all five: the shift test at 1810, then 1866, 1885, 1924, and
  1947). **The null-preservation test ends at line 1945** (`assert.equal(project.sprites.actors[0]
  .battle.spellId, null, …)` plus its trailing wrong-implementation comment, closing at 1945);
  lines 1947-1956 are a **separate** test ("deleting the last of a 32-entry catalog…") whose own
  setup at line 1950 **seeds** `battle: { spellId: 30 }` on a fresh actor, and whose assertion at
  line 1956 — not 1950 — reads `project.sprites.actors[0].battle.spellId` back and checks it is
  still `30` — this fifth reader is added to §5's table (finding 12).
- `test/lua/build_sram_roms.mjs:75-90`, `test/unit/save.test.js:930-945` — both define a local
  `spellMaskAtLevel`/`expectedSpellMask` helper reading `entry.spellId` where `entry` is a
  **`member.spells[]` element** (a party member's own learned-spell record), not `actor.battle
  .spellId` — party-only, unrelated to this design, **unchanged** (finding 12/13 classification).
- `main/build/battletables.js:298-311` — the `known` builder for `pc_spells_at`, same file: also
  reads `entry.spellId` off `member.spells[]` — party-only, unchanged (the second grep hit finding
  12 named at `:306`).
- `sample-rpg/sprites.json`, `sample-rpg/spells.json`, `sample-rpg/party.json` — 4 actors (Slime,
  Potion, Iris, Snake), Snake (`actors[3]`) `battle.spellId: 2` (Venom), `atk: 5`; spell catalog
  `[Ember (dmg, 10, fire, mpCost 3), Mend (heal, 18, mpCost 4), Venom (poison, 1, mpCost 2)]`; Rian
  (party member 0) `baseDef: 4`, `defPerLevel: 1`, no `weak`/`strong` field.
- `shared/starters/rpg.js:92-93, 223` — neither starter monster casts (Hero's own `spells: [{
  spellId: 0, level: 1 }]` at 223 is the party member's own learned spells, unrelated).
- `ROADMAP.md:1391` (item 13), `:1513` (item 14) — section headers, read for placement.
- `docs/design-magic-power.md:2295-2306, 2371-2387` — the "queued as its own later slice" scoping.
- **Two real, measured prototypes were built for this round and both reverted** (not left in the
  tree — `git status --short` before writing this file and after showed nothing both times). See
  §6's own measurement note; the saved diff is at
  `/tmp/claude-1000/-home-chris-nes-game-forge/fe597aab-a1c2-47c3-945c-db28d3c7fe4d/scratchpad/msl-v2-prototype.diff`
  and the measurement script at
  `/tmp/claude-1000/-home-chris-nes-game-forge/5ca42714-1c77-40f7-bcaf-cb2b86e1a1cc/scratchpad/msl-v2-measure.mjs`.
- `/tmp/claude-1000/-home-chris-nes-game-forge/5ca42714-1c77-40f7-bcaf-cb2b86e1a1cc/scratchpad/lfsr-sim.mjs`
  — the original exhaustive LFSR simulation (its own `maxd` statistic counts only casting paths,
  which is why it reads "never more than 1" for pick-first at K=2/4 — a real limitation of that
  script, not of pick-first itself). Re-run this round, output reproduced exactly (§2/§6).
- `/tmp/claude-1000/-home-chris-nes-game-forge/5ca42714-1c77-40f7-bcaf-cb2b86e1a1cc/scratchpad/lfsr-sim2.mjs`
  — a second script, extending the first to (a) count draws over *every* entry state including
  coin declines, and (b) check whether a wrong `monster_pick_limit` table survives test 8's own
  aggregate cast-count assertion. Re-run this round; its full output is reproduced in the report
  and cited in §6/§12.

## §1. Recommendation at a glance

**Algorithm: pick-first** (§2) — the pick is drawn before the coin, using rejection-sampling
arithmetic unbiased for a truly independent draw, ordered so its input is no longer the LFSR's very
next output after a coin whose own low bit was just constrained to zero. The resulting cast counts
are balanced to within one over the enumerated 255-state domain, at K = 2, 3, 4 (§2, §6) — evidence
from exhaustive enumeration, not a proof of exact, equal-probability unbiasedness (64/63 and
32/32/32/31 are not themselves equal). Table shape: **(b)** a
fixed-stride list, `RPG_LIMITS.monsterSpells = 4`, `mon_spell` widened from 1 to 4 bytes/actor.
Selection: uniform draw among the affordable entries, duplicates meaning weight, the existing 50%
coin's own instructions unchanged (only its position in the sequence moves). Schema:
`battle.spellIds: number[]` replaces `battle.spellId`, migrated once, old key removed. Engine:
`monster_turn` rewritten under `.if MONSTER_SPELL_LIST_ENABLED`, the old body kept byte-for-byte
under `.if !` — **and its two new helpers (`mod_monster_len`/`monster_pick_limit`) are gated too**
(closing finding 2). Measured banked-region allowance: **`MONSTER_SPELL_LIST_BATTLE_ALLOWANCE =
153`** (flat, all three boards) — this is the only figure that stands; any earlier arithmetic based
on the biased algorithm's own byte count is dead (finding 1 changed the algorithm; the table delta
of `12` is unaffected by which algorithm picks the spell). Phase 1 now includes the Monster Forge's
existing `Casts` select migrated to bind `spellIds[0]`, preserving entries 1-3 of a hand-edited list
(closing finding 3) — the full four-select UI still lands in phase 2. `battleShortfallAdvice` gains
a lever, using its own existing (now feature-neutral, not naming-specific) mechanism.

## §2. Q1 — the table shape

Three options, priced on `sample-rpg` (4 actors):

- **(a) A bitmask byte per actor**, `pc_spells`' own shape. 1 byte/actor — cheapest possible table
  — but caps a monster at catalog spells 0-7, a real regression from today's single id, which
  reaches all 32 (`RPG_LIMITS.spells = 32`, `shared/project.js:1125`). Rejected: a monster whose
  one spell is catalog index 12 or higher cannot even keep casting only that one spell under this
  shape, let alone gain more. Not priced further.
- **(b) A fixed-stride list of N ids per actor.** `mon_spell` becomes N bytes per actor, `$FF`
  (`NO_SPELL`, a new sentinel — none exists today; the engine spells the literal `$FF` inline)
  padded, `dbRows(values, N)` the way `mon_name` already uses `NAME_LIMIT` as its stride
  (`battletables.js:202`) — `dbRows`' `perLine` argument only wraps `.db` lines for readability, it
  does not itself establish the stride; the stride is the flat-array shape (`actors.flatMap(actor
  => …N entries…)`), and `dbRows(…, N)` is chosen only so each actor's own row prints on one line.
  Every actor pays N bytes, non-monster actors (Potion, Iris in `sample-rpg`) included — the table
  is keyed by actor id across the whole roster today (`battletables.js:134`, `column`), and this
  design does not change that keying. Indexing is `actor_id * N`, which needs a multiply; N a
  power of two turns that into `N`'s own `log2(N)` shift-pairs — see §6.
- **(c) A per-actor count/offset into a packed list.** Fewest bytes when few monsters cast many
  spells or many cast few, at the cost of a second table (the offsets) and an extra indirection on
  every read. Priced in full below (finding 16).

**Recommendation: (b), N = `RPG_LIMITS.monsterSpells = 4`.** Table cost, measured for N = 4 and
computed by the same formula for N = 2/8 (the formula is measurement-backed — see §6's own note on
why the N = 2/8 figures below are exact, not estimated, for the *table* half):

| N | table bytes on `sample-rpg` (4 actors) | formula |
|---|---|---|
| 2 | 4 | (N−1) × 4 |
| 4 | **12 (measured)** | (N−1) × 4 |
| 8 | 28 | (N−1) × 4 |

Table cost is independent of the picking algorithm (§6's finding-1 fix changes *code* bytes, not
table bytes) — the 12-byte figure for N=4 was re-confirmed in this round's own remeasurement (§6),
unaffected by the algorithm swap.

### Alternatives priced in full (finding 16)

| Alternative | Table/pool bytes on `sample-rpg` | Extra code vs. option (b) | Draws (2+ affordable) | Notes |
|---|---|---|---|---|
| **(b) fixed-stride, N=4 (recommended)** | 12 | — (baseline) | pick + coin (§2/§6) | |
| **(c) packed, count+offset per actor, 1-byte offset, 255-entry pool cap** | overhead 8 (2 bytes/actor: 1 count + 1 offset) + 1 byte per *real* authored entry (1 today, on `sample-rpg`) = **total 9**, vs. fixed-stride's own **total 16** (N=4 × 4 actors — comparing totals with totals, not this table's own incremental deltas against each other, per finding 6) | +1 indirection: an extra `lda mon_spell_off,y` and its use as a base before the existing pointer math — estimated **+8-12 bytes** of code over (b) | same as (b) | **Cheaper on a typical, sparse project** (most actors cast 0-1 spells) since the pool scales with authored content, not `N × actors`. **A 1-byte offset can only address 256 pool slots**, so the real design needs an explicit refusal once the *whole roster's* combined real-entry count would exceed 255 — a generous but real cap (comparable to every other named capacity ceiling this codebase already refuses past, CLAUDE.md), not silently wrong. Estimate, not built. |
| **(c) packed, count+offset per actor, 2-byte offset, no pool cap** | overhead 12 (3 bytes/actor: 1 count + 2-byte offset) + 1 byte per real entry = **total 13** on `sample-rpg`, still cheaper than fixed-stride's 16 but by less | a 16-bit offset needs pointer arithmetic akin to `ptr_lo`/`ptr_hi`'s own construction in §6's listing (not a plain 1-byte add) — estimated **+16-20 bytes** of code over (b), more than the 1-byte-offset variant | same as (b) | Addresses the full 1,020-entry theoretical pool (255 actors × up to 4 real entries) with no cap, at a real code cost the 1-byte variant does not pay. |
| **Explicit per-entry weight byte** | a second N-byte table: `N × actors.length` = **16** on `sample-rpg` (a fresh table has no 1-byte-per-actor baseline to net against, unlike (b)'s own incremental delta) | a weighted-draw routine (cumulative-sum + compare) instead of a flat mod-K — estimated **+15-25 bytes** over `mod_monster_len` | pick + coin, same shape | Expresses weighting explicitly rather than through duplicate ids; strictly more expressive (non-integer-ish ratios), strictly more expensive in both bytes and Forge surface (a number input beside each select). Not recommended: duplicate-entries-as-weight (§3) gets the same effect at zero extra table cost. |
| **Ordered-first-affordable** (no uniform pick at all) | 0 extra (no `monster_pick_limit`, no `mod_monster_len`) | Removing the 26-byte helper/table pair alone (an earlier pass's own estimate) is not the whole saving (finding 6): the whole selection block from `monster_turn_have_list`'s own `lda bt_len` through `monster_turn_only`'s own `ldy #0` (§6's listing — not the pick-retry loop alone, and not a label named `monster_turn_picked`, which does not exist in the real listing; corrected this round, finding 9) is also gone, replaced by a single `ldy #0` that always selects the sub-list's first entry: `lda bt_len`(3) + `cmp #1`(2) + `beq`(2) + `ldx bt_len`(3) + `jsr rng_next`(3) + `sec`(1) + `sbc #1`(2) + `cmp monster_pick_limit-2,x`(3) + `bcs`(2) + `jsr mod_monster_len`(3) + `tay`(1) + `jmp monster_turn_coin`(3) + `monster_turn_only:`'s own `ldy #0`(2) = 30 bytes removed, replaced by one `ldy #0`(2) = a net 28-byte saving on top of the 26-byte helper/table removal — `153 − 26 − 28 = ` estimated **~99 bytes**, not ~127. An early-exit scan (stopping at the first affordable match instead of building the whole `bt_list` sub-list first) would reduce this further still, but restructures the scan loop itself and is not separately costed to the byte here — labelled a rougher estimate on top of the ~99 figure, not a second measured number. | coin only, never a second draw | The scan (or an early-exit version of it) replaces the whole pick mechanism, not just its helpers — genuinely cheaper than the ~127 an earlier pass claimed. Priced as an alternative to §3's recommended (i); see §3 for why (i) is still preferred. |
| **high-bits** (the coin-first bias fix, the alternative to pick-first — §6) | 12 (same table shape) | Estimated **~146 bytes** — cheaper than pick-first by roughly the `sty bt_arg`/`ldy bt_arg` park/recover pair (6 bytes) it does not need, offset by a slightly different draw instruction; not built this round | coin, then (only if casting) up to 2 pick draws at K=3, 1 at K=2/4 | See §6's own algorithm-choice writeup for the full trade-off — over *all* entry states, not just casting ones, both algorithms can need a second draw (pick-first: up to 2, on decline paths, at K=2/4; high-bits: up to 2, on a casting path, at K=3); pick-first is chosen on reason 2 there (reused, already-correct arithmetic), not on draw count alone. |

`RPG_LIMITS.monsterSpells = 4` joins `RPG_LIMITS` beside `monstersPerBattle: 4`
(`shared/project.js:1118`) as a new, single-writer entry — the Forge's own field count (§8) and the
engine's own `MONSTER_SPELLS` equate (`config.inc`, generated the same way `NUM_VARIABLES` is from
`RPG_LIMITS.variables` — `NO_SPELL` is hand-defined separately, finding 7, §6) both read it, so the
count can never drift between the three. Open question for Chris: N (§14).

## §3. Q2 — the selection rule

Today: if the one spell is affordable, a 50% coin; otherwise attack. Options:

- **(i) Keep the coin; pick uniformly among the affordable listed spells** (with the finding-1 fix
  applied to *how* "uniformly" is drawn — §6). Build the affordable sub-list, attack if empty (no
  draw at all), otherwise proceed to the coin and the pick (§6's own ordering). A monster with one
  cheap and one dear spell keeps casting the cheap one after the dear one is out of reach.
- **(ii) Draw a slot 0..N−1 first; attack if it is `$FF` or unaffordable, no coin.** Rejected, and
  for a corrected reason this round (finding 15): **under (ii), four identical copies of the same
  spell in every slot make the monster cast every single turn** — there is no coin at all under
  (ii), so a non-`$FF` draw always casts, so duplicating a spell into all four slots does **not**
  "hold" a single-spell monster's existing 50% rate the way it might first seem to (the arithmetic
  says 100%, not 50%). The migration that *would* approximate the old ~50% rate under (ii) is
  filling **two of four** slots with the spell and leaving the other two `$FF` — a real, working
  fix to the compensating-migration idea, priced here only to show it exists, since (ii) is still
  rejected on
  its central objection: any *other* actor in the same project gaining a second spell would flip
  `MONSTER_SPELL_LIST_ENABLED` project-wide and silently change every existing single-caster's
  cast rate from 50% to 25% (one real slot in four) unless that migration is separately, manually
  applied to every one of them.
- **Weighting and order.** Duplicates in the affordable sub-list are a weighting at zero engine
  cost under (i) — `[Venom, Ember, Ember]` casts Ember two-thirds of the time it casts at all —
  provided the normalizer does not dedupe (§5). This is **not** a departure from how this schema
  already treats order: `project.spells`' own array position is a real bit index
  (`battletables.js:298-306`, §0) and `bt_list`'s own position is a real UI row
  (`battleturn.asm:185-186`, §0) — list order already carries meaning throughout this codebase, so
  choosing uniform-among-affordable over ordered-first is not "introducing" order-sensitivity, it
  is choosing *not* to make the list's order into a priority ranking, which is a real design
  choice on its own terms, not a novelty this schema has never seen.

**Why random selection at all, argued on its own merits (finding 19 — `pick_party_target`'s own
comment does *not* support this).** `pick_party_target`'s comment reads: "A monster with a choice
would need an opinion, and a random one reads as arbitrary rather than clever" — an argument
**against** randomness for spatial *targeting*, where "attack whoever is weakest/nearest" has an
obvious, legible answer a human designer would recognise as "clever." A monster's *spell* choice
has no equivalently obvious answer even in principle — there is no general rule for "which of my
three known spells is objectively correct to cast this turn" the way "attack the wounded one" is
for targeting. More directly: **this engine already ships genuine randomness in exactly this
decision** — the existing 50% coin (`monster_turn:989-991` today) already makes whether a monster
casts at all a coin flip, not an opinion, and has done so since before this design. Extending that
same, already-shipped randomness to *which* spell, rather than inventing a new deterministic
priority scheme this codebase has never used for a monster's own behaviour, is the smaller,
more consistent change — not an appeal to `pick_party_target`'s own, unrelated reasoning about
targets.

**Recommendation: (i), duplicates allowed and meaning weight, the coin's own comparison unchanged.**
Open questions for Chris (§14): uniform-among-affordable vs ordered-first-affordable (priced in
§2's table above); whether duplicates should be the weighting primitive or a monster's list should
be a deduplicated set.

## §4. Q3 — the coin

Out of scope. The 50% coin's own two instructions (`jsr rng_next / and #1`, today at
`battleturn.asm:989-990`, moved but not edited in §6's own listing) are not changed by this design
in any recommended branch — the coin decides cast-vs-attack exactly as it does today; only its
*position* relative to the pick moves (§6, the finding-1 fix). Even under option (ii) from §3
(rejected), the coin's own comparison is simply absent rather than altered. A per-monster cast
rate — a byte column per actor compared against `rng_next` instead of the fixed `and #1`, so a
monster could cast more or less than half the time it can afford to — is a real, separate later
slice: it would need its own table (1 byte/actor, 4 more bytes on `sample-rpg`), its own Forge
control, and its own migration story for every monster that has never set one. **A default of
`$80` (`rng_next() >= $80` instead of `and #1 == 0`) gives a *similar distribution* to today's
coin — both are roughly 50% — but not *identical per-seed behaviour* (finding 13): `engine/
battleturn.asm:989-991` tests parity (bit 0), and comparing a whole byte against `$80` is a
different test on the same byte, so the two disagree on which specific seeds cast for any seed
where bit 0 and the top-bit comparison land on opposite sides. A migration that wants byte-exact
identity for every already-authored monster would need to special-case "the old code path" rather
than merely default the new column to `$80`; not designed further here.** Recording it here only so
this design does not foreclose it — nothing in §2's or §6's engine listing, and nothing in the
pick-first-vs-high-bits choice, assumes the coin stays a fixed `and #1` forever.

## §5. Q4 — schema

`battle.spellIds: number[]` replaces `battle.spellId`. Named `spellIds`, not `spells`: a party
member's own `spells` field is an array of `{spellId, level}` **objects** ("what's learned, at
what level") — reusing the bare name `spells` for a flat array of bare numbers on a different
object shape, on an adjacent concept `renumberSpellDeletion` already reasons about both halves of
in one function (`shared/project.js:2526-2568`), invites exactly the confusion that function's own
doc comment goes out of its way to head off. `spellIds` matches this codebase's existing
id-array-suffix convention (`encounterActors`/`map.encounters.actorIds`,
`shared/project.js:1168-1169`).

**Migration**, in the actor battle normalizer (`shared/project.js:4995-4998` today), the identical
shape `normalizeSpell`'s `amount → amountMin/amountMax` and `normalizeItem`'s `effect` migrations
already use (CLAUDE.md, "The single-writer rule"): `spellId: n` → `[n]`; `null`/`undefined` → `[]`.
**The old key is removed on normalization, not kept as a mirror** — two fields naming one fact is
the drift CLAUDE.md's own "single-writer rule" exists to refuse, and every **consumer of the
monster field** (`actor.battle.spellId`/`spellIds`) is a `shared/`, `main/`, or `renderer/` site
this migration updates in the same change, reclassified this round (finding 12/13). This table is
scoped to that one field, not to every occurrence of the substring `spellId` anywhere in the
codebase (finding 8) — `member.spells[].spellId`, a party member's own learned-spell record, is a
different field with its own, unrelated set of readers, listed in one place below rather than
individually, so the scope is reproducible by grep rather than merely asserted:

| Reader | Classification | What changes |
|---|---|---|
| `shared/project.js:4995-4998` (normalizer) | **changed** | becomes the migration + `spellIds: array.slice(0, RPG_LIMITS.monsterSpells).map(id => clamp(id, 0, 255, 0))` |
| `shared/project.js:2555-2568` (`renumberSpellDeletion`) | **changed** | walks `battle.spellIds`, drops the deleted id and shifts higher ones (§11's corrected `[1, 3, 1]` example) |
| `renderer/forges/monster/monster.js:138-151` (`Casts` select) | **changed** | phase 1: bound to `spellIds[0]`, preserving `spellIds[1..]` (§8/§13); phase 2: four selects |
| `main/build/battletables.js:192-198` (`mon_spell`) | **changed** | N bytes/actor from `b.spellIds`, `$FF`-padded |
| `main/build/generate.js:2206-2207` (Build panel attribution comment) | **comment, wording only** | "spellId" → "spell list" in the plain-English list of Monster-Forge-edited fields; no behavioural change |
| `main/smoke.js:6638, 6697-6699` | **changed** | `actors[0].battle.spellIds` |
| `main/smoke.js:8028` (round-trip fixture) | **changed** | `spellIds: []` |
| `test/unit/library.test.js:1232` (fixture) | **changed** | `spellIds: []` |
| `test/unit/rpg.test.js:1855, 2356, 2880` | **changed** | `battle = {…, spellIds: [N]}` |
| `test/unit/project.test.js:1810-1843` (the shift test — monster's cast spell **and** the party member's own learned entries, one test covering both fields at once) | **changed, monster half only** | the monster assertion at `:1837` becomes `battle.spellIds`; the party-side assertions in the same test are untouched, a different field |
| `test/unit/project.test.js:1866-1884` (naming exactly the deleted spell becomes null) | **changed** | becomes "…is dropped from `battle.spellIds`, and the list closes up" (§5's own discipline-change note) |
| `test/unit/project.test.js:1885-1904` (naming a spell above the deleted one is decremented) | **changed** | asserts `battle.spellIds` |
| `test/unit/project.test.js:1905-1923` (a party member's own learned entry naming the deleted spell is removed) | **party-only, unchanged** | `member.spells`, not `battle.spellId` — this test is not part of the discipline change at all, despite sitting between the monster-side tests above and below it in the file |
| `test/unit/project.test.js:1924-1945` (`battle.spellId === null` before deletion stays `null` after — the null-preservation test) | **changed** | asserts `battle.spellIds` stays `[]` |
| `test/unit/project.test.js:1947-1956` ("deleting the last of a 32-entry catalog…", the fifth monster-side reader, finding 12) | **changed** | `battle: { spellIds: [30] }`, assert `actors[0].battle.spellIds[0] === 30` |
| `tools/make-rpg-sample.js:265` (Snake's own authored data) | **changed** | `spellId: 2` → `spellIds: [2]` — new code should not keep writing a legacy key (orchestrator's own recommendation, adopted) |
| `main/build/battletables.js:298-311` (`known` builder, `pc_spells_at`) | **party-only, unchanged** | reads `member.spells[].spellId`, a different field entirely |
| `test/lua/build_sram_roms.mjs:75-90` | **party-only, unchanged** | same, `spellMaskAtLevel` |
| `test/unit/save.test.js:930-945` | **party-only, unchanged** | same, `expectedSpellMask` |
| `shared/starters/rpg.js:223` | **party-only, unchanged** | Hero's own learned spells |
| `shared/project.js:5078-5083` (party member normalizer) | **party-only, unchanged** | `entry.spellId` on `raw.spells`, the same field the migration above never touches |
| `renderer/forges/character/character.js:205-235` (`Learns` checkbox list) | **party-only, unchanged** | `member.spells.find((entry) => entry.spellId === spell.id)` |
| `tools/make-rpg-save-sample.js:288` | **party-only, unchanged** | Rian's own `spells: [{ spellId: 0, level: 1 }]` |
| `test/unit/starters.test.js:1760` | **party-only, unchanged** | `hero.spells.map((s) => s.spellId)` |

Reproducible, with one caveat honestly stated: `grep -rn spellId shared/ main/ renderer/ test/
tools/` finds every hit above (both tables), but a single further `grep -v` cannot cleanly split
them — `renderer/forges/monster/monster.js:144`'s own `set('spellId', …)` call, for one, shares no
literal substring with "battle" on its own line, so a text filter alone would misfile it as
party-only. Splitting the two tables requires reading each hit's own surrounding context (which
object — `actor.battle` vs `member`/`project.party` — owns the field on that line), which is what
both tables above already record; the raw grep is offered as the starting point, not as a
self-sorting command.

**`battle.spellId` is a fixed point today**; `battle.spellIds` is not — it is a list, and a list
has no single sentinel value to hold as a fixed point the way `null` was for a scalar. The correct
discipline is the one `member.spells` already uses for the identical reason
(`renumberSpellDeletion`'s own doc comment, `shared/project.js:2539-2543`, "there is no 'learned
nothing' entry sitting in the array to fall back to"): the deleted id is **dropped** from the
list, and every higher id in the list shifts down by one, same as today's `member.spells` walk.
This is a real change in discipline for the monster side (from fixed-point-`null` to
drop-and-shift), and every test that pins the *old* fixed-point discipline on a monster's own
field must change:

- `test/unit/project.test.js:1866-1884` ("a monster's battle.spellId naming exactly the deleted
  spell becomes null") — becomes "…the deleted spell is dropped from `battle.spellIds`, and the
  list closes up" (an assertion on array length and contents, not a `null` check).
- `test/unit/project.test.js:1924-1945` ("battle.spellId === null before deletion stays null
  after," the null-preservation test — confirmed this round to end at line 1945, not 1956, which
  belongs to the separate test below) — becomes an assertion that `battle.spellIds` (now genuinely
  empty, `[]`) stays `[]` — still a meaningful test (an empty array must not somehow gain an
  entry), but no longer testing a fixed point, since lists have none, and **not** a test that can
  exercise a missing `Array.isArray` guard: `[]` is already an array, so a walk with no guard at
  all reaches the same `.filter`/`.map` calls without throwing and this fixture alone cannot tell
  the two implementations apart (round-1 implementation review, finding 1 — corrected here; an
  earlier pass of this bullet conflated the two). **Two fixtures are needed, not one**: the
  `[]`-stays-`[]` assertion above, unchanged, plus a second, sibling fixture whose actor's
  `battle` record has **no `spellIds` key at all** (`battle: {}`) — only that second fixture can
  exercise the guard, since `undefined.filter`/`undefined.map` throws a `TypeError` the moment an
  unguarded walk reaches it, a *louder* wrong implementation than the old scalar field's silent-`0`
  failure mode, and worth keeping as its own regression case for exactly that contrast. The
  wrong-implementation note at 1939-1943 (treating a missing `spellId` as the numeric sentinel `0`)
  becomes, on the second fixture: dropping the `!Array.isArray(actor.battle.spellIds)` half of the
  guard and reading `actor.battle.spellIds` unconditionally.
- `test/unit/project.test.js:1819-1843` (the shift test — spellId 2 shifts to 1 when spell 0 is
  deleted) carries over in spirit: `battle.spellIds: [2]` → `[1]`.
- `test/unit/project.test.js:1947-1956` ("deleting the last of a 32-entry catalog…") — a fifth
  monster-side reader, distinct from the null-preservation test above and asserting a reference
  below the deleted last entry does not move: `battle.spellIds: [30]` stays `[30]`.
- `main/smoke.js:6628-6702` (the phase-1 reproduction) carries over in spirit: `actors[0].battle =
  {…, spellIds: [2]}` casting Bolt, and after deleting Fire (index 0),
  `spellsAfterFire[rpgStore.project.sprites.actors[0].battle.spellIds[0]].name` must read `'Bolt'`.

**Bounds.** Each entry `clamp(0, 255, 0)` as today; the array sliced to `RPG_LIMITS.monsterSpells`
on normalization (an author-side authoring cap, the same role `RPG_LIMITS.spells` plays for
`project.spells` itself). Duplicates are **kept**, never deduplicated — §2/§3's own weighting
primitive depends on this; the normalizer must not run the array through a `Set`. An entry `≥
spells.length` (a stale id after the *catalog* shrinks, as opposed to `renumberSpellDeletion`
actively shifting it) is left alone by the normalizer (it does not know the catalog is about to
grow or shrink independently of a delete) and dropped to `$FF` by the **generator** exactly as
`mon_spell` already does today (`battletables.js:196`, "a stale id past the spell table is treated
the same rather than compiled") — the same discipline, now applied per-entry instead of once.

**Migration story, stated once and applied consistently everywhere (finding 13).** The six
checked-in fixtures stay pre-migration on disk, unchanged, never regenerated (CLAUDE.md) —
`sample-rpg/sprites.json`'s Snake keeps `spellId: 2` literally, forever, as JSON. The **generator**
script (`tools/make-rpg-sample.js`), which produces a fresh in-memory project object rather than
reading pre-migration JSON, moves to the new key: `spellIds: [2]`. Both paths normalize to the
identical `spellIds: [2]`, so `samplegen.test.js`'s own load-equality assertion holds with no
change to the fixture file. Every test that mutates a **loaded** project (`rpg.test.js:1855, 2356,
2880`) sets `spellIds` directly, since a loaded project has already passed through the normalizer
and no longer has a `spellId` key to set.

## §6. Q5 — the engine, complete

### The picker: which algorithm, and why (finding 1)

Drawing the pick *after* the coin — `draw = rng_next() − 1` over 0-254, reject `≥ floor(255/K)*K`,
`mod K` — is biased, exhaustively confirmed by re-running `lfsr-sim.mjs` (§0) against the real
`rng_next`:

```
coin-then-pick  K=2  cast paths 127  idx counts 64/63      max draws (cast paths only) 1
coin-then-pick  K=3  cast paths 127  idx counts 43/42/42   max draws (cast paths only) 1
coin-then-pick  K=4  cast paths 127  idx counts 63/0/1/63  max draws (cast paths only) 2
```

The mechanism: once the coin's own `and #1 == 0` check has passed, bit 0 of that LFSR output is
known to be 0, and the very next `rng_next()` call is that same byte shifted left one bit (XOR a
constant on carry-out) — so **bit 1 of the very next draw is always 0**, because it came directly
from bit 0 of the byte the coin just examined. The rejection thresholds are correct for an
*independently* uniform 0-254 draw; two consecutive LFSR outputs are not independent, and drawing
the pick immediately after the coin is exactly the case where that matters. Two fixes were
verified, both re-run this round, output reproduced exactly against `lfsr-sim.mjs`:

```
high-bits   K=2 63/64        K=3 41/44/42 (max draws, cast paths, 2)   K=4 31/32/32/32 (max draws, cast paths, 1)
pick-first  K=2 64/63        K=3 43/42/42 (max draws, cast paths, 1)   K=4 32/32/32/31 (max draws, cast paths, 1)
```

**These figures count only casting paths — the original simulator discards a coin decline before
updating its own draw-count maximum.** Counting every entry state, including declines, changes the
picture: `lfsr-sim2.mjs` (a second script, written this round specifically to check this — §0)
re-runs both algorithms over all 255 nonzero seeds without filtering by outcome. Pick-first needs
up to **2 / 1 / 2** pick draws at K = 2 / 3 / 4 — not "never more than 1" as the cast-paths-only
figures above would suggest. The extra draws happen on **decline paths**: at K=4, seed 198 draws
`$FD` (rejected — `$FD − 1 = $FC = 252`, at the rejection limit), then `$8B` (accepted, index 2),
then the coin draw `$67` (odd — declines, discarding the accepted pick). high-bits' own second
draw, by contrast, happens on a **casting** path at K=3 (the coin already passed before the pick's
own rejection can occur). Both algorithms can need two draws; which paths they occur on differs,
not whether they occur at all.

- **high-bits**: keep the coin first (matching today's own order); take the pick draw's HIGH six
  bits (`rng_next()`, then `lsr a / lsr a`, a value 0-63), reject `≥ floor(64/K)*K` (64, 63, 64 for
  K = 2, 3, 4), `mod K`. Bits 7..2 of the post-coin draw are bits 6..1 of the coin byte itself
  (shifted, XOR a constant on carry), which the coin's own `and #1` check never constrained. Never
  wastes a draw on a decline (the pick only runs once the coin has already said "cast").
- **pick-first**: draw the pick **before** the coin, using the identical rejection-sampling
  arithmetic (`draw = rng − 1` over 0-254, reject `≥ floor(255/K)*K`, `mod K`), park the result,
  then flip the coin on the following draw. The coin's own bit 0 is now the *previous* byte's bit
  7, because `$71` (the LFSR's own XOR constant) has bit 0 set, so a carry-out toggles the next
  byte's own bit 0 depending on the previous byte's top bit — a real, sound reason the two draws are
  not the same kind of dependency the coin-then-pick ordering had (finding 9 — an earlier pass's own
  further claim, that "mod-K only reads the low bits" and therefore never determines the next
  byte's high bit, is true for the power-of-two divisors K=2/4 but **false for K=3**, where a mod-3
  reduction genuinely depends on the whole byte's value, not merely its low bits, since 3 does not
  divide 256 evenly — that stronger sentence is dropped rather than kept alongside a caveat). What
  the exhaustive simulation actually shows, and the only claim made here, is that the resulting
  cast counts are **balanced to within one over the enumerated 255-state domain** at every K (64/63,
  43/42/42, 32/32/32/31) — evidence from full enumeration, not a proof of independence or exact
  unbiasedness for every possible LFSR state space. A one-entry list still draws the coin only (RNG
  identity holds, §6 below); a 2+-entry list draws the pick even when the coin then declines,
  wasting that draw's own RNG consumption — real, but harmless (no other system depends on the
  *value* the pick lands on when the cast never happens).

**Chosen: pick-first.** The honest trade-off, corrected this round: **draw count alone does not
favour either algorithm** — both can need a second draw over the full 255-state domain (pick-first
at K=2/4, on decline paths; high-bits at K=3, on a casting path), so "pick-first never needs more
than one draw" is not the reason to prefer it, and this design no longer claims it. The real
reasons, each weighed:

1. **Reuses already-correct arithmetic, only reordered — the decisive reason.** The rejection
   threshold table, the mod routine, and the draw technique are the identical rejection-sampling
   machinery `roll_spell_amount`/`mod8` already establish elsewhere in this file — only their
   position relative to the coin moves, and a small parking step (`sty bt_arg` / `ldy bt_arg`, 6
   bytes, §6's own listing) is added to carry the chosen index across the coin's own draw.
   high-bits needs a genuinely different draw technique (`lsr a / lsr a` instead of `sec / sbc #1`)
   and a different rejection-limit table (64, 63, 64 rather than 254, 255, 252) — **not**, on
   reflection, a shorter mod routine (finding 8, corrected this round): `lsr a / lsr a` leaves the
   six-bit dividend sitting in the *low* bits (0-63, with bits 6-7 forced to zero), and
   `mod_monster_len`'s own loop is MSB-first — it shifts the dividend's *top* bit into the
   remainder on every iteration. Running it for only six iterations on a value already sitting in
   the low bits would process bits 5..0 as though they were bits 7..2, the wrong bit positions
   entirely, unless the dividend were first left-shifted two more places to re-align it — an extra
   cost, not a saving. The existing eight-iteration routine already handles any 0-63 dividend
   correctly unmodified (the two leading iterations simply shift in the two known-zero high bits,
   contributing nothing incorrect), so high-bits would reuse `mod_monster_len`'s own shape exactly
   as written, at its own already-measured cost, not a smaller one. This is the lower-risk change to
   re-verify, and the one this round's real rebuild-and-measure (below) actually checked; it is why
   pick-first, not high-bits, has a real, measured banked-region allowance in this document and
   high-bits has only an estimate (§2).
2. **The RNG-consumption cost is real but honestly stated, not hidden.** A 2+-entry monster whose
   coin then declines burns one extra `rng_next` call (the discarded pick) that today's engine, and
   high-bits, never spend. This perturbs whatever RNG draw happens next (an encounter roll, another
   monster's own turn, physical-damage noise) — harmless, since every new source of `rng_next`
   calls already perturbs downstream draws the instant it is added (that is what a shared LFSR
   means), but real, and recorded here rather than glossed over.

`high-bits` remains the recommended alternative if Chris would rather never waste a draw on a
decline (§14) — priced as an estimate in §2's own table, not built this round.

**A one-entry list still draws the coin only.** `bt_len == 1` short-circuits straight to
`monster_turn_only` (§6's listing below), skipping the whole pick-retry block — the single
`rng_next` call for the coin lands at the same point in the sequence as today's engine, so the
resulting `rng` byte is bit-for-bit identical to today's, given the same starting state — true
regardless of which algorithm surrounds it, since the short-circuit is what matters here, not the
pick's own arithmetic.

### Register/scratch contract (corrected, findings 18)

- **X** holds the monster slot only transiently at entry, parked in `bt_x`; free afterward to hold
  a spell-id index into `spell_cost`, or the affordable count `bt_len` for the pick-retry loop's
  own table index.
- **Y** holds the actor id briefly, becomes the 0..3 scan index, then the chosen list index.
- **`bt_x`** holds the monster slot for the whole routine (proven free below).
- **`ptr_lo`/`ptr_hi`** hold this actor's own `mon_spell` row address, set once, read four times via
  `[ptr_lo],y`.
- **`bt_tmp`** holds, in sequence: the actor id being doubled, each scanned spell's MP cost, the
  finally-chosen spell's MP cost.
- **`bt_arg`** holds the scanned entry's spell id transiently in the scan loop, **then the chosen
  list index (0-3) parked across the coin's own `rng_next` call**, then — recovered and overwritten
  — the final chosen spell id, exactly as `cast_spell` expects. Three sequential roles, never two at
  once.
- **`bt_list`/`bt_len`** hold the affordable sub-list and its count. **They are actively in use from
  the scan through the picker's own last read (`lda bt_list,y`, after the coin has passed) — they
  are not dead beforehand, and must not be treated as free scratch at any earlier point in the
  routine (finding 18). They become dead only after that final read**, the same proof of liveness
  §0 already establishes for the whole turn (no frame boundary crosses a monster's turn, and the
  next party-menu open rebuilds both from zero before reading either as authoritative).
- **`bt_tmp2`** is never touched by `monster_turn` or `mod_monster_len` — **for a different, correct
  reason this round (finding 18): not because `cast_all` needs it preserved on entry (it does not —
  `cast_all` initializes its own end-of-side sentinel itself, `battleturn.asm:306-310`, the instant
  it starts), but because `mod_monster_len`'s own scratch needs (`bt_tmp` + Y) simply do not require
  `bt_tmp2`, and because `mod_monster_len` is never nested inside `cast_all`'s own loop the way
  `mod8` genuinely is** (via `spell_damage`, called once per target while `cast_all`'s loop is
  actively counting down in `bt_tmp2`). `monster_turn`'s whole pick-and-coin sequence completes
  strictly before the `jmp cast_spell` tail call — there is no nesting here to protect against, so
  this is a coincidence of implementation, not a load-bearing contract the way it is for `mod8`.

### Proof: `bt_list`/`bt_len` are dead at the start of a monster's turn

`battle_take_turn` (`battleturn.asm:134-170`) dispatches each `bt_round` entry to exactly one of
two paths: a party member gets `BP_MENU` and `draw_commands_queued`/`show_cursor` (`:153-159`) and
**returns**, waiting across many frames of `ui_tick` for the player to act; a monster gets `jmp
monster_turn` (`:161`) and runs to completion — attack or cast — in that one call, with no
suspension. `bt_list`/`bt_len` are written only by `build_spell_list`/`build_item_list`
(`battleui.asm:354-419`), both reached only from the MAGIC/ITEM window a party member's own menu
opens, and read only by `spell_chosen`/`item_chosen` (`battleturn.asm:184-231`), both reached only
from that same party member's own selection. Since a monster's entire turn begins and ends inside
one synchronous call with no frame boundary crossed, and the *previous* owner of `bt_list`/`bt_len`
— whichever combatant's turn most recently opened a menu — already consumed them via
`spell_chosen`/`item_chosen` before its own turn ended and `battle_next` advanced `bt_round`,
nothing is ever mid-flight in `bt_list`/`bt_len` at the moment `monster_turn` begins. The next time
either byte is read as authoritative is the next party member's own menu-open, which rebuilds both
from `bt_len = 0` first (`battleui.asm:359, 396`) — so a monster's own writes here are guaranteed
overwritten before anyone reads them expecting the party's list.

### The listing

```asm6502
; A monster with an affordable spell in its list casts one about half the
; time. Up to MONSTER_SPELLS spell ids per actor, $FF-padded; a stale id
; past the spell table is dropped to $FF by the generator, never compiled.
; MONSTER_SPELLS is generated into config.inc from RPG_LIMITS.monsterSpells
; (the NUM_VARIABLES precedent); NO_SPELL = $FF is hand-defined here, an
; engine sentinel, not project-derived (finding 7 -- these are NOT the same
; kind of constant and must not share one declaration).
;
; The pick is drawn BEFORE the coin (finding 1 -- see this file's own design
; doc §6 for why): rejection-sampling two consecutive LFSR outputs by
; drawing the pick right after the coin is biased, exhaustively confirmed.
; Drawing the pick first and parking it in bt_arg across the coin's own draw
; avoids conditioning the pick's input on the coin's low bit.
;
; Entry: bt_actor = this combatant's index (>= MAX_PARTY). Exit: either
; falls into monster_turn_attack, or spends MP and tail-calls cast_spell
; with bt_arg/bt_target set. Clobbers A/X/Y and bt_tmp/bt_arg/bt_x/bt_list/
; bt_len/ptr_lo/ptr_hi. Never touches bt_tmp2 (see contract above -- not
; because cast_all requires it, but because nothing here needs it and
; nothing here nests inside cast_all's own loop).
  .if MONSTER_SPELL_LIST_ENABLED
monster_turn:
  lda bt_actor
  sec
  sbc #MAX_PARTY
  sta bt_x                     ; slot parked for the whole turn
  tax
  ldy mon_slot_actor,x         ; Y = this monster's actor id
  ; ptr_lo/ptr_hi = &mon_spell[actor_id * MONSTER_SPELLS]. MONSTER_SPELLS=4
  ; is a compile-time power of two: two asl/rol pairs are exact and O(1).
  ; LIMITS.actors = 255, so actor_id can reach 254 and 254*4 = 1016
  ; overflows a byte -- the 16-bit product is not optional.
  tya
  sta bt_tmp
  lda #0
  sta ptr_hi
  asl bt_tmp
  rol ptr_hi
  asl bt_tmp
  rol ptr_hi                   ; bt_tmp/ptr_hi = actor_id * 4, 16-bit
  lda bt_tmp
  clc
  adc #LOW(mon_spell)
  sta ptr_lo
  lda ptr_hi
  adc #HIGH(mon_spell)
  sta ptr_hi
  ; Scan the 4 slots, building the affordable sub-list into bt_list/bt_len.
  lda #0
  sta bt_len
  ldy #0
monster_turn_scan:
  lda [ptr_lo],y
  cmp #NO_SPELL
  beq monster_turn_scan_next
  sta bt_arg                   ; park the scanned id -- X is about to hold it
  tax
  lda spell_cost,x
  sta bt_tmp                   ; this spell's MP cost
  ldx bt_x
  lda mon_slot_mp,x
  cmp bt_tmp
  bcc monster_turn_scan_next   ; can't afford it -- leave it out
  ldx bt_len
  lda bt_arg
  sta bt_list,x
  inc bt_len
monster_turn_scan_next:
  iny
  cpy #MONSTER_SPELLS
  bne monster_turn_scan
  lda bt_len
  bne monster_turn_have_list
  jmp monster_turn_attack       ; nothing affordable: attack, NO draw at all
monster_turn_have_list:
  lda bt_len
  cmp #1
  beq monster_turn_only
  ; Uniform pick among bt_len (2-4) affordable entries, drawn BEFORE the
  ; coin. monster_pick_limit holds floor(255/K)*K for K=2,3,4 (indexed K-2).
  ldx bt_len
monster_turn_pick_retry:
  jsr rng_next
  sec
  sbc #1                        ; draw = rng_next() - 1, uniform over 0-254
  cmp monster_pick_limit-2,x
  bcs monster_turn_pick_retry   ; rejected: redraw. Terminates a.s.
  jsr mod_monster_len           ; A (draw) -> A (draw mod bt_len)
  tay
  jmp monster_turn_coin
monster_turn_only:
  ldy #0
monster_turn_coin:
  sty bt_arg                   ; park the chosen index across the coin draw
  jsr rng_next
  and #1
  bne monster_turn_attack      ; a parked pick (2+ entries) is simply discarded
  ldy bt_arg                   ; recover the chosen index
  lda bt_list,y
  sta bt_arg                   ; bt_arg now becomes the spell id
  tax
  lda spell_cost,x
  sta bt_tmp
  ldx bt_x
  lda mon_slot_mp,x
  sec
  sbc bt_tmp
  sta mon_slot_mp,x
  jsr pick_party_target
  jmp cast_spell
  .endif
  .if !MONSTER_SPELL_LIST_ENABLED
monster_turn:
  lda bt_actor
  sec
  sbc #MAX_PARTY
  tax
  ldy mon_slot_actor,x
  lda mon_spell,y
  cmp #$FF
  beq monster_turn_attack
  sta bt_arg
  tay
  lda spell_cost,y
  sta bt_tmp
  lda mon_slot_mp,x
  cmp bt_tmp
  bcc monster_turn_attack
  jsr rng_next
  and #1
  bne monster_turn_attack
  lda mon_slot_mp,x
  sec
  sbc bt_tmp
  sta mon_slot_mp,x
  jsr pick_party_target
  jmp cast_spell
  .endif
monster_turn_attack:
  jsr pick_party_target
  jsr roll_hit
  bne monster_missed
  jsr physical_damage
  jsr apply_damage
  jsr print_num
  lda #BS_HITS
  jmp battle_say_actor
monster_missed:
  lda #$FF
  sta bt_dmg_hi
  lda #BS_MISSES
  jmp battle_say_actor
```

`mod_monster_len` and `monster_pick_limit` are **guarded** (finding 2 — leaving either
unconditional would add 26 bytes to every feature-off build, 23 for `mod_monster_len` and 3 for
`monster_pick_limit`):

```asm6502
  .if MONSTER_SPELL_LIST_ENABLED
; A = dividend (0-254) in. bt_len = divisor (2-4). Returns A = dividend mod
; bt_len. Clobbers Y and bt_tmp; never touches bt_tmp2 (see contract above).
mod_monster_len:
  sta bt_tmp
  lda #0
  ldy #8
mod_monster_len_loop:
  asl bt_tmp
  rol a
  cmp bt_len
  bcc mod_monster_len_no_sub
  sbc bt_len
mod_monster_len_no_sub:
  dey
  bne mod_monster_len_loop
  rts

; floor(255/K)*K for K=2,3,4, indexed by K-2.
monster_pick_limit:
  .db 254, 255, 252
  .endif
```

### Termination and RNG-consumption identity

`monster_turn_pick_retry` is entered only when `bt_len >= 2` (the `cmp #1 / beq
monster_turn_only` guard above it), so `monster_pick_limit-2,x` always indexes a real table entry
(K−2 ∈ {0,1,2} for K ∈ {2,3,4}) — no possibility of reading past the 3-byte table. It never
executes when `bt_len` is 0 (the empty-list `jmp monster_turn_attack` above it) or 1 (the
`monster_turn_only` branch, taken before the coin under pick-first's own ordering), which is what
closes trap 3 (§11): a rejection loop is only ever entered with a real, positive rejection
*probability that is strictly less than 1* — the maximum rejection rate at K = 4 is 3/255 (draws
252-254 rejected out of 0-254), so the loop terminates almost surely, exactly as
`roll_spell_amount`'s own existing rejection loop already does for any `spell_amount_n,x > 1`, and
by the identical argument. A single-affordable-entry monster draws the coin only (§6, above).

### Measurement (real prototype, rebuilt and remeasured this round)

A working prototype implementing exactly the listing above — pick-first algorithm, both helpers
guarded under `.if MONSTER_SPELL_LIST_ENABLED` — was assembled via `buildProject` against `mkdtemp`
copies of `sample-rpg` (naming forced off), on all three RPG-capable boards, in **three** separate
passes: (1) the flag set to 1 with the widened `mon_spell` table (the "on" figure), (2) the flag
set to 0 with the widened table reverted to the original 1-byte-per-actor emission (the "true off"
figure, proving the guard actually removes the 26 bytes rather than merely making them
unreachable), and (3) a direct re-run of the untouched HEAD engine as the baseline cross-check.
Every prototype file was reverted (`git checkout --`) before this document was written; the diff
was saved first to
`/tmp/claude-1000/-home-chris-nes-game-forge/fe597aab-a1c2-47c3-945c-db28d3c7fe4d/scratchpad/msl-v2-prototype.diff`
and the exact measurement script (real, reproducible, run via `node <script>` against a repository
with that diff applied, with `nesasm` on `PATH`) is saved at
`/tmp/claude-1000/-home-chris-nes-game-forge/5ca42714-1c77-40f7-bcaf-cb2b86e1a1cc/scratchpad/msl-v2-measure.mjs`
— its full text:

```js
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadProject, saveProject } from '/home/chris/nes_game_forge/main/project-io.js';
import { buildProject } from '/home/chris/nes_game_forge/main/build/pipeline.js';
import { codeRegions, SUPPORTED_MAPPERS, rpgCapable } from '/home/chris/nes_game_forge/shared/cartridge.js';
import { battleTableBytes, battleRegionBytes, battleRegionCeiling, BATTLE_SLACK } from '/home/chris/nes_game_forge/main/build/battletables.js';

const ROOT = '/home/chris/nes_game_forge';
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const CAPABLE_MAPPERS = SUPPORTED_MAPPERS.filter(rpgCapable);

async function measureRegion(mapper, mutate = () => {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-measure-'));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = mapper.id;
  project.party[0].renamable = false;
  if (project.party[1]) project.party[1].renamable = false;
  mutate(project);
  await saveProject(dir, project);
  const lines = [];
  await buildProject({ dir, project, log: (line) => lines.push(line) });
  const slot = codeRegions(mapper, project.tilesets.length, 1)[0];
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${slot.nesasmBank}\\s`).test(line));
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  await fsp.rm(dir, { recursive: true, force: true });
  return { project, used, predicted: battleRegionBytes(project, mapper), dir, bankLine };
}

for (const mapper of CAPABLE_MAPPERS) {
  const r = await measureRegion(mapper);
  const tableBytes = battleTableBytes(r.project);
  const codeBytes = r.used - tableBytes;
  const ceiling = battleRegionCeiling(mapper);
  console.log(`${mapper.name} (id ${mapper.id}): used=${r.used} tableBytes=${tableBytes} codeBytes=${codeBytes} predicted=${r.predicted} ceiling=${ceiling} headroom=${ceiling - r.used} bankLine="${r.bankLine}"`);
}
```

Run as `node msl-v2-measure.mjs` with `nesasm` on `PATH`, once per prototype state (edit the
engine/`battletables.js` files per the saved diff, run, `git checkout --` to revert, repeat).

| Board | HEAD baseline `used`/`codeBytes` | "true off" (guarded, flag=0) `used`/`codeBytes` | "on" (flag=1) `used`/`codeBytes` | code Δ (on − baseline) | table Δ | headroom off → on |
|---|---|---|---|---|---|---|
| MMC1 (id 1) | 4731 / 4237 | 4731 / 4237 (**exact match**) | 4896 / 4390 | **153** | 12 | 3441 → 3276 |
| MMC3 (id 4) | 4777 / 4283 | 4777 / 4283 (**exact match**) | 4942 / 4436 | **153** | 12 | 3395 → 3230 |
| UNROM 512 (id 30) | 4731 / 4237 | 4731 / 4237 (**exact match**) | 4896 / 4390 | **153** | 12 | 3441 → 3276 |

The "true off" row is byte-for-byte identical to the untouched HEAD baseline on every board,
closing finding 2: the guard genuinely removes both helpers, not merely their caller. **`147` is
dead. `MONSTER_SPELL_LIST_BATTLE_ALLOWANCE = 153`**, flat across all three RPG-capable boards (no
`SPLIT_ENABLED` branch — confirmed by measurement, not assumed). Ceiling `8172` on all three boards
(`NESASM_BANK_BYTES(8192) - BATTLE_SLACK(20)`); headroom (`ceiling − used`) is the table's own last
column, computed once, quoted nowhere else in this document at a different value.

**A byte-level hand count of the new enabled body, cross-checked against the measured delta.**
Counting every instruction in the enabled `monster_turn` body above (absolute addressing throughout
— every operand under $100 costs 3 bytes for a two-operand instruction, 1 for implied, 2 for
immediate, per `docs/design-magic-power.md:1466-1474`, §0) gives the new body **185 bytes** on its
own (excluding the shared `monster_turn_attack`/`monster_missed` tail, unchanged). Reconciling
against the measured delta: `new_body(185) − old_body(58, the reviewer's own confirmed figure) +
mod_monster_len(23) + monster_pick_limit(3) = 153`, matching the measured delta exactly — the same
reconciliation discipline `design-magic-power.md`'s own §0-cited passage uses to cross-check a
hand tally against a real build.

**N=2/N=8, code cost, for absolute addressing (finding 4 — every `asl`/`rol` pair on a scratch byte
costs 6 bytes under this engine's convention, since each instruction assembles as a 3-byte absolute
form, not the 2-byte zero-page form a naive count would assume).** N=2 needs one
shift pair instead of two (saves 6 bytes) and shrinks `monster_pick_limit` from 3 entries (K=2,3,4)
to 1 (K=2 only, saves 2 bytes) — **145** (153 − 8), estimate. N=8 needs three shift pairs (costs 6
more) and grows the table to 7 entries (K=2-8, costs 4 more) — **163** (153 + 10), estimate. Both
are hand-reasoned from the specific differing opcodes, not built, consistent with the pattern the
reviewer's own sanity-check figures (139/157, for the pre-finding-1-fix 147-byte baseline)
independently established for the same N deltas.

### Cycle cost — genuine instruction-level count (finding 5)

Every timing below uses this engine's real assembled form: implied 2 cyc/1B, immediate 2 cyc/2B,
absolute read 4 cyc/3B, absolute store 4 cyc/3B, absolute indexed read/store (`,x`/`,y`) 4-5 cyc/3B
(5 for an indexed *store*, e.g. `sta bt_list,x`), absolute read-modify-write (`asl`/`rol`/`inc` on a
memory operand) 6 cyc/3B, accumulator-mode `asl a`/`rol a` 2 cyc/1B, `[zp],y` indirect-indexed
(`ptr_lo` is a genuine zero-page address, `$00` — this addressing mode has no absolute equivalent on
6502, so it is unaffected by the absolute-addressing convention) 5 cyc/2B, branch not-taken 2 cyc,
taken 3 cyc, `jsr` 6 cyc/3B, `rts` 6 cyc/1B, `jmp` 3 cyc/3B — matching the reviewer's own stated
figures for absolute reads (4), absolute RMW (6), and indexed stores (5).

`rng_next`'s own body is counted (23 cycles for its costlier, carry-taken branch: `lda rng`(4) +
`bne`(3) + `asl a`(2) + `bcc not-taken`(2) + `eor #$71`(2) + `sta rng`(4) + `rts`(6) = 23, plus the
`jsr` itself = 6, so **29 cycles per `rng_next` call** throughout).

**`mod_monster_len`'s real maximum is 200 cycles including the `jsr`, not 203 (finding 2) — its
first iteration cannot subtract.** `A` (the remainder) starts at 0; after the first iteration's
`asl bt_tmp / rol a`, `A` holds a single shifted-in bit (0 or 1), which is always less than
`bt_len` (the divisor, at least 2 whenever this routine is called at all — §6's own guard), so
`bcc mod_monster_len_no_sub` is **always taken on iteration 1**, skipping the `sbc`. Only
iterations 2-8 can subtract. Recomputed: setup `sta bt_tmp`(4) + `lda #0`(2) + `ldy #8`(2) = 8;
iteration 1 (no subtract) `asl bt_tmp`(6) + `rol a`(2) + `cmp bt_len`(4) + `bcc taken`(3) + `dey`(2)
+ `bne taken`(3) = 20; iterations 2-7, worst case subtract-every-time, 6 × [`asl`(6) + `rol a`(2) +
`cmp`(4) + `bcc not-taken`(2) + `sbc`(4) + `dey`(2) + `bne taken`(3)] = 6 × 23 = 138; iteration 8
(subtract, `bne` **not** taken — loop ends) = 6+2+4+2+4+2+2 = 22; plus `rts`(6). Total body:
8 + 20 + 138 + 22 + 6 = **194 cycles**, plus the `jsr` (6) = **200 cycles for the call** — matching
the reviewer's own independently-stated maximum exactly.

**The "one rejected pick draw, then the coin passes" path used in an earlier estimate is
unreachable at K=4 for this LFSR, and the 728-cycle figure that assumed it must not stand as
"worst case" (finding 2).** `lfsr-sim2.mjs` (finding 1, re-run this round) reports, at K=4,
`maxDraws(all paths)=2` but `maxDraws(cast paths)=1` — over every one of the 255 entry states, a
pick that needed a second (retried) draw **always** went on to have its coin decline; none of them
casts. The two-draws-then-casts combination this design's own listing could in principle execute
never actually occurs for the real `rng_next` sequence, so summing each segment's own local maximum
independently (as an earlier pass here did) double-counts a combination that cannot happen
together — a genuine but *unreachable* conservative bound, not a real path.

**An accepted pick draw costs 38-39 cycles, not the bare 29-cycle `rng_next` call alone — an
earlier pass here miscounted this (finding 4).** The pick-retry loop's own accept path is `jsr
rng_next`(29) + `sec`(2) + `sbc #1`(2) + `cmp monster_pick_limit-2,x`(4, absolute indexed read) +
`bcs …` **not taken**(2) = **39 cycles**, not the `rng_next` call's own 29 alone — the four
instructions that turn the raw draw into a checked, accepted value are real cost that was dropped
from the earlier total.

**The real reachable worst case is the four-affordable casting path, and `mod_monster_len`'s own
global 200-cycle maximum does not occur on it — 675 was inside the correct range but is not itself
the maximum (finding 4).** Every K's own `maxDraws(cast paths)` is 1 (§6, finding 1), so the most
expensive path that actually casts never retries the *pick* itself — but `mod_monster_len`'s own
worst-case 200-cycle figure (§6, above) is a separate, general maximum over every dividend/divisor
pair, not a figure tied to this specific path; a real seed reaching this exact casting path can
still drive `mod_monster_len` through most, but not necessarily all, of its own worst-case
subtract-every-iteration pattern. Seed `135` at K=4 is such a case: pointer/setup (84) + scan (251)
+ checks (19) + one accepted pick draw (39, corrected above) + `mod_monster_len` for this seed's
own dividend/divisor (194) + `tay`/`jmp` (5) + coin-passes/recover/finalize/spend-MP tail (86) =
**678 cycles**, at the top of the previously-established 662-678 range — the real reachable
maximum for this path, not 675 (675 was only *inside* the range, not its edge). A decline path
that does retry the pick is cheaper still, since its own coin decline short-circuits the long
finalize/spend-MP tail into a plain `jmp monster_turn_attack`. **A naive sum of every segment's own
independent local maximum — a rejected pick draw (40: `jsr rng_next`(29) + `sec`(2) + `sbc`(2) +
`cmp`(4) + `bcs` **taken**(3)) *and* an accepted one (39), since the pick-retry loop's own maximum
draw count is 2 at K=4, plus `mod_monster_len`'s own general 200-cycle maximum — combines a retry
with a cast, the exact combination just shown to be unreachable together for this LFSR, which is
what makes this a *conservative*, not a real, bound: `84 + 251 + 19 + 40 + 39 + 200 + 5 + 87 =
725`**, kept here only as an explicitly conservative bound no single real path reaches, never
restated as "worst case." A battle turn runs at most
once per combatant per round — against an NTSC frame budget of 29,780 cycles, even the
conservative 725-cycle bound (≈2.4%) is not a performance concern at any list length this design
proposes.

## §7. Q6 — gating and the ledger

`projectUsesMonsterSpellList(project)` in `shared/project.js`, beside `projectUsesMagicPower`/
`projectUsesMagicDefence` (`:5944-5974`, the gating precedent copied exactly): **true iff some
actor's `battle.spellIds` has two or more entries** — a one-entry list is today's feature exactly,
so a project that has never authored a second spell must assemble byte-identical to today, which
is what the six-fixture SHA-256 gate proves (below). Emitted as `MONSTER_SPELL_LIST_ENABLED` in
`config.inc`, the same `generate.js:3027-3028` mechanism.

**When OFF**: the old one-byte `mon_spell` table (first entry, or `$FF` if the list is empty) and
the old `monster_turn` body assemble, both literally unchanged from today's committed source (the
`.if !MONSTER_SPELL_LIST_ENABLED` block in §6's listing is a verbatim copy) — **and now the guarded
helpers assemble to nothing at all too** (§6, measured and confirmed byte-identical to HEAD on all
three boards, closing finding 2). Every one of the six checked-in fixtures stays off:
`sample`/`sample-mmc1`/`sample-mmc3`/`sample-u512` carry no RPG data at all (`gameType` is action,
`battle.spellIds` has no meaning — every actor there carries `spellId: null`, migrating to `[]`);
`sample-rpg` has exactly one caster, Snake, with one entry (`[2]`); `sample-rpg-mmc1` — read
directly — has no monster with any `battle.spellId` set at all. **`sample-rpg` would be the first
fixture to break** if this predicate or the off-path body ever drifted, since it is the only one of
the six with a live monster spell at all; the six-fixture SHA-256 gate
(`test/unit/nameentry.test.js:73-124`) is the proof, re-pinned (unchanged hashes expected) the same
way every prior phase's byte-identity claim was checked — by building all six and comparing.

**When ON**: the N-stride table under the **same label**, `mon_spell` — not renamed, since the
off-path body (byte-identical, per the rule above) must keep reading a label called `mon_spell`,
and giving the two build states two different table names for the same logical concept ("this
monster's spell(s)") would be the two-fields-for-one-fact drift CLAUDE.md's single-writer rule
already refuses elsewhere. **`MONSTER_SPELL_LIST_BATTLE_ALLOWANCE = 153`** (re-measured, §6,
flat — no `SPLIT_ENABLED` branch, confirmed by measurement on all three RPG-capable boards) wires
into `battleRegionBytes` (`battletables.js:867-878`) the same way
`ITEM_LIST_FILTER_BATTLE_ALLOWANCE` already does, gated on `projectUsesMonsterSpellList(project)`.
Its own isolation test in `bankedbytes.test.js` follows the `MAGIC_POWER_BATTLE_ALLOWANCE` shape
exactly (`:417-437`, §12).

**Table bytes**: `(N−1) × actors.length` extra when on — 12 on `sample-rpg`, counted automatically
by `battleTableBytes` reading `battleTables`' own emitted output, needing no separate constant
(§6).

**No kernel-lo term.** Every file this design touches — `engine/battleturn.asm` (banked),
`engine/constants.asm` (equates, no RAM allocation change), `main/build/battletables.js`
(banked-region table emission) — lives in the banked battle bank or is a compile-time equate with
no runtime footprint. `engine/main.asm`, `engine/ui.asm`, `engine/script.asm` and every other
kernel-lo file are untouched. The test that would catch a violation is `kernelbytes.test.js`'s own
equality/margin `assertCovers` assertions on `kernelCodeBytes` (CLAUDE.md, "The kernel budget"):
any accidental kernel-lo growth from this feature would show up there as an unexplained delta the
moment a kernel-lo isolation test for it was added, and no such test is added here because none is
needed.

**`battleShortfallAdvice` should gain a lever — and the exclusivity claim behind that
recommendation does not hold (finding 17).** `battleShortfallAdvice` is not "the only advice
function" reading the banked region. `kernelShortfallAdvice` (`generate.js:1502-1648`) —
a *kernel-lo* advisor — calls `switchableMappers` (1636, default `checkBattleRegion: true`), which
itself reads `battleRegionBytes` at its own fit check (1469), specifically so a mapper swap
recommended to fix a kernel-lo shortfall is never one that would silently break the banked region.
Both advisors already depend on `battleRegionBytes` correctly accounting for this feature's own
cost, which the wiring above already achieves — the *additional* recommendation (a strip-style
lever a user can act on directly) is still worth adding, on its own merits: `battletables.js:
977-1010`'s `nameFeatures`/`nameBudget`/`nameFreed` block already has the exact `{label, strip}`
shape needed, diffed through `battleRegionBytes` before/after. **Recommendation**: generalize the
variable names — `nameFeatures` → `bankedFeatures`, `nameBudget` → `bankedBudget`, `nameFreed` →
`bankedFreed` — since the array will no longer hold only naming entries (each existing entry's own
comment, which genuinely is about naming, stays as-is; only the *array's* name and any comment
describing the block as a whole need to generalize), add `projectWithoutMonsterSpellList(project)`
(truncates every actor's `battle.spellIds` to its first entry — **not the exact inverse of the
schema migration**: it is a same-shaped-array truncation sufficient to flip
`MONSTER_SPELL_LIST_ENABLED` off for that actor, not a reintroduction of the scalar `spellId`
field the migration removed), and add `{label: 'every monster's extra spells',
strip: projectWithoutMonsterSpellList}` to the generalized array.

## §8. Q7 — UI

**Phase 1 (the minimal migration, closing finding 3).** The Monster Forge's existing `Casts` select
(`renderer/forges/monster/monster.js:138-151`) stays a single select, but is rebound from
`battle.spellId` to `battle.spellIds[0]`: choosing a spell writes `[chosenId, ...spellIds.slice(1)]`
so any entries 1-3 already present on a hand-edited project's list are **preserved**, not
truncated; choosing "Nothing" writes `spellIds.slice(1)` — the list closes up from the front rather
than leaving a leading gap, the same collapse discipline phase 2's own four selects use (below).
This is the whole of phase 1's UI change — see §12 test 13 for the exact assertions and §13 for why
this ships alongside the schema and engine rather than waiting for phase 2.

**Phase 2.** The single `Casts` select becomes four, backed by `battle.spellIds[0..3]`: the first
labelled `Casts`, the remaining three `Also`/`or`/`or`, each offering the identical `Nothing` +
catalog-spell option list the current one does. **Recommendation: yes to collapsing empty slots on
commit** — `[Nothing, Ember, Nothing, Nothing]` normalizes to `[Ember]` the instant any select
changes, the same "commit derives the canonical shape, the UI shows whatever is there" discipline
the rest of this codebase already holds to (e.g. `remapScreenReferences`' total `translate`,
CLAUDE.md). Leaving gaps uncollapsed would let `[Nothing, Ember]` and `[Ember]` describe the same
list two different ways on disk, which is exactly the "reference the function does not resolve is
a reference it is wrong about" drift `remapScreenReferences`'s own doc comment refuses.

Tooltip on all four (both phases — phase 1's single select gets the real tooltip immediately, not
just phase 2's four): **"Cast about half the time while the MP above lasts, choosing at random
among the affordable ones; otherwise it attacks."** — replacing today's exact text, `'Cast about
half the time while the MP above lasts; otherwise it attacks'` (`monster.js:143`, quoted verbatim,
not paraphrased).

**Alternative considered and rejected: a `Learns`-style checkbox list.** The Character Forge's own
`Learns` list (`character.js:195-235`) is the closest existing precedent for "several spells,
picked from a catalog," but it cannot express duplicates — a checkbox is boolean per spell, checked
or not, no repeat — and duplicate entries are exactly this design's own weighting primitive (§2/§3,
the recommended option (i)); that alone is sufficient to reject it, with no separate ordering
argument needed (option (i) itself does not depend on list order at all — only the *rejected*
ordered-first alternative would, and this design does not recommend it). A monster's list is not
"which of these does it know" (the Character Forge's question) but "how many times" (this design's
question) — a fundamentally different shape, not a smaller version of the same one.

**A stale id in `battle.spellIds`** — `itemPickerOptions` is **not** a precedent for silently
showing "Nothing" for a missing reference: its own comment (`monster.js:90-94`) distinguishes a
genuinely missing reference (flagged via its own `missing` return) from an authored, intentional
`Nothing`. The `Casts` select (either phase) does **not** use `itemPickerOptions` at all — it is a
plain `<select>` built from `store.project.spells.map(...)`, so a stale id with no matching
`<option selected>` falls back to whatever the browser renders as the first option (`Nothing`)
purely as a DOM default, with **no distinction rendered** between "authored Nothing" and "stale
id."

**Smoke coverage.** `main/smoke.js`'s Monster Forge section (`:7385-7611`) drives a generic
per-label edit/undo/redo/reload loop today (`:7547-7610`), but that loop calls `findFieldInput`,
which targets `<input>` elements — the existing `Casts` select has **no direct smoke coverage
today** (grepped, §0: no `"Casts"` hit anywhere in `main/smoke.js`). The four-select replacement
(phase 2) needs its own smoke block, following the existing loop's shape but against `<select>`
elements: pick a value on each of the four selects for Snake, assert
`store.project.sprites.actors[snakeId].battle.spellIds` reflects it (with the trailing-`Nothing`-
collapse rule above applied), undo, redo, save, reopen, reassert — the "commit, undo, reload"
sequence CLAUDE.md's own conventions require. Phase 1's own single-select migration gets its own,
smaller smoke/test coverage (§12 test 13) rather than waiting for phase 2's block.

## §9. Q8 — starters and fixtures

**Recommendation: no checked-in fixture opts in.** The six-fixture SHA-256
byte-identity gate (`test/unit/nameentry.test.js`) is what `MONSTER_SPELL_LIST_ENABLED` being
off-by-default protects. `sample-rpg`'s own exact-damage tests' **scenarios and expected outcomes
stay unchanged**; only their field assignments migrate the way §5's reader table already requires
— the three loaded-project mutations at `rpg.test.js:1855, 2356, 2880` move from `battle.spellId`
to `battle.spellIds`, with the same scenario (which spell, which actor, which magnitude) and the
same expected result, not a rewritten test. §6's own measurement confirms the off-path is
genuinely byte-identical to HEAD on every board, so nothing about these tests' own build output
changes either.

Tests build `mkdtemp` variants of `sample-rpg` instead, following the same non-mutation discipline
`bankedbytes.test.js`'s `measureRegion` already holds to. The variant: Snake (`actors[3]`,
`spellIds: [2]` today, Venom) gains Ember (id 0, `kind: 'damage'`, `amountMin: amountMax: 10`) as a
second entry — `spellIds: [2, 0]` — with `atk: 0` (a test-only override, following the exact
existing idiom at `rpg.test.js:2880`, `atk: 0, spellId: 1`) so a physical hit and an Ember cast are
distinguishable by magnitude alone.

**Verified on the real numbers, not assumed** (§0's own read of `physical_damage`,
`engine/battleturn.asm:623-651`, and Rian's `party.json` fields, re-checked this round): with
Snake's `atk` forced to 0 against Rian's `def` (4 at level 1, `baseDef: 4`, `defPerLevel: 1`),
`physical_damage`'s own floor-then-noise formula (`atk − def` clamped to 0, floored to 1 if the
result is exactly 0, plus `rng_next() & 3`) gives a physical hit a range of **1-4**. Ember is
`amountMin == amountMax == 10` (`spell_amount_n,x == 1`, no roll) — and `spell_damage`'s own
element modifier is skipped entirely for a hit landing on the party side (`battleturn.asm:857`,
"elements only describe monsters" — party members carry no `weak`/`strong` field at all, confirmed
directly from `sample-rpg/party.json`), and `sample-rpg` has neither `MAGIC_POWER_ENABLED` nor
`MAGIC_DEFENCE_ENABLED` live, so an Ember cast against Rian deals **exactly 10**, unconditionally.
1-4 vs exactly 10 is a clean, always-distinguishable pair **at the boundary of one resolved
action** — the HP delta measured immediately after the single `callRoutine` call that ran the
action (§12's own harness protocol), not a round total, which can include a poison tick or a
missed attack (`bt_dmg_hi = $FF`, no HP change at all) alongside or instead of the hit being
measured. Any test in §12 that needs to tell a physical hit from an Ember cast reads the target's
`pc_hp` immediately before and after that one `callRoutine` call and takes the delta — "1-4" proves
a physical attack landed, "exactly 10" proves Ember landed, and "0" proves a miss, never a
multi-action sum that could conflate them.

**The RPG starter (`shared/starters/rpg.js`)**: neither Slime nor Bat casts a spell today (§0,
grepped again this round, unchanged finding). **Recommendation: leave the starter off** — giving a
starter monster a two-entry list would be new authored content in a shipped starter, not a
mechanical consequence of this design, and belongs to Chris's own taste the same way the
magic-power design's own starter `mdef` values did (`design-magic-power.md` §16). Recorded as an
open question for Chris (§14): give Bat a two-spell list, or leave the starter as-is.

## §10. Q9 — where recorded

ROADMAP item 14 (`ROADMAP.md:1513`, the Monster Forge) already states it owns `battle.*` — this
design's own schema change (`battle.spellIds`) and engine change (`monster_turn`) both live inside
that ownership. **Recommendation**: one new sub-item under item 14 ("A monster's own spell list —
several spells, weighted by duplicate entries, picked uniformly among the affordable ones —
replacing the single `battle.spellId` it has today; see `docs/design-monster-spell-list.md`"),
with a one-line cross-reference from item 13 (`ROADMAP.md:1391`, the spell-math home) pointing at
item 14's own sub-item — the identical cross-reference shape item 13's existing text already uses
for the Monster-Forge-owned fields it lists but does not itself implement. Added in the docs phase
(§13), not this design round.

## §11. What could go wrong

1. **`bt_list`/`bt_len` reused while something still needs the party's list.** Closed by the proof
   in §6: a monster's turn runs to completion in one synchronous call, and `bt_list`/`bt_len` are
   only ever live between a party member's own menu-open and that same member's own selection, both
   inside that member's own turn — they are live from the scan through the picker's own last read,
   dead only after it (the corrected timing, finding 18). The mechanism that would resurrect this
   trap is a future change that makes a monster's turn suspend across a frame boundary (the way
   `Move`/`Say` do for the field/script layer) — if that ever happens, this proof needs re-doing,
   not assuming.
2. **`actor_id × N` overflowing eight bits** (the `name_offset_pc` trap, CLAUDE.md "6502 traps").
   Closed by using a genuine 16-bit product (`ptr_lo`/`ptr_hi`, two `asl`/`rol` pairs) rather than
   an 8-bit `A`-only multiply — `LIMITS.actors = 255` means actor ids reach 254, and `254 × 4 =
   1016` would silently wrap to `1016 mod 256 = 248` under an 8-bit multiply, aliasing a completely
   wrong actor's row.
3. **A rejection loop entered with an empty list** (never terminates). Closed structurally: the
   empty-list check (`lda bt_len / bne … / jmp monster_turn_attack`) runs *before* the coin and
   *before* the pick-retry block, so the pick-retry loop's own entry is gated on `bt_len >= 2`
   (§6's own "Termination" note) — it can never be reached with `bt_len` at 0, and `bt_len == 1`
   is diverted around it entirely by `monster_turn_only`.
4. **`$FF` padding vs a stale id — both must be skipped by the same comparison, and the generator
   must never emit a real id ≥ `NUM_SPELLS`.** Closed: the scan's only comparison is `cmp #NO_SPELL
   / beq …`, and the generator (§5) folds any entry `≥ spells.length` to `$FF` during table
   emission, the identical rule `mon_spell` already applies today for the single-id case
   (`battletables.js:196`) — the engine never distinguishes "authored nothing here" from "authored
   something that no longer exists," by design, matching every other stale-reference sentinel in
   this codebase (`NO_ACTOR`/`NO_ITEM`/`NO_METASPRITE`).
5. **The normalizer deduping a list and silently destroying authored weighting** (or the reverse:
   the design chooses "set" and the UI lets a duplicate in). Closed by an explicit rule in §5: the
   normalizer must not run `spellIds` through a `Set` or any other dedup step — duplicates are
   kept, on purpose, as the weighting primitive §2/§3 depend on. A test asserting
   `normalizeActor({…, battle: {spellIds: [0, 0, 1]}})` keeps all three entries (not two) is part
   of §12.
6. **`renumberSpellDeletion` changing discipline** (fixed-point `null` → dropped entry) breaking
   the tests that pin the old one. Addressed in full in §5: every test that pinned the old
   fixed-point discipline is rewritten to assert drop-and-shift, and the smoke scenario's own final
   assertion is updated to read `battle.spellIds[0]` instead of `battle.spellId` — the corrected
   `[1, 3, 1]` example (finding 14) is in §12's own test 10, not test 9 — test 9 is RNG identity
   and asserts nothing about damage or deletion (finding 11).
7. **A migration that leaves `spellId` readable somewhere the list is not.** §5's own reader table
   is the exhaustive answer for every consumer of the monster field (`actor.battle.spellId` — not
   every occurrence of the substring `spellId` anywhere in the codebase, which also includes
   `member.spells[]`'s own, unrelated readers, listed separately in §5 and out of scope for this
   trap), and the old key is removed on normalization rather than mirrored, so nothing can read a
   stale `spellId` after a project has passed through `loadProject` once.
8. **The off-path table/label/body not byte-identical.** Closed by measurement this round, not
   merely by construction — the "true off" build in §6 matches HEAD on all three boards exactly.
9. **`hex()`'s `& 0xff` masking an `undefined` list entry into `$00`.** `battletables.js:80`:
   `(value & 0xff)` — in JavaScript, `undefined & 0xff` evaluates to `0`, not `NaN` and not a
   thrown error, so a sparse or short-padded `spellIds` array (one whose slots past the real
   entries are left as holes rather than explicitly filled with `0xff`) would silently compile a
   **real spell id, 0**, into every empty slot — not "no spell," but "always cast spell 0, free."
   Closed by construction in the generator: the padding step must build a full N-length array with
   every slot explicitly assigned (`Array.from({length: N}, (_, i) => spellIds[i] ?? 0xff)` or
   equivalent), never a `.length = N` truncation/extension (which leaves genuine holes in a sparse
   array) or a bare `.slice(0, N)` on a shorter-than-N array (which leaves the array short, not
   padded — `dbRows` would then emit fewer than N bytes for that actor, desynchronizing every later
   actor's own row). A test building a project with a one-entry `spellIds` and asserting the
   emitted `mon_spell` bytes for that actor are exactly `[id, $FF, $FF, $FF]` (never `[id, $00,
   $00, $00]`) is part of §12.
10. **Branch range.** Recomputed for the actual listing, not estimated (finding 6): every branch's
    real displacement, byte-counted from the listing above — `beq monster_turn_scan_next` +33,
    `bcc monster_turn_scan_next` +12, `bne monster_turn_scan` (back-edge) −44, `bne
    monster_turn_have_list` +3, `beq monster_turn_only` +21, `bcs monster_turn_pick_retry`
    (back-edge) −11, `bne monster_turn_attack` +35 — every one comfortably inside ±127; nothing in
    this listing needs `jmp` for range reasons. The one `jmp monster_turn_attack` present (the
    empty-list fallthrough) is kept as a plain `jmp` for the "keep going past a not-taken branch"
    idiom rather than restructured into a direct `beq`, which would save 3 bytes but was not
    separately re-measured — noted as a possible tightening, not claimed as the measured figure.
11. **nesasm's 31-character label limit.** Recounted against the actual listing: longest new label
    is `monster_turn_pick_retry` at **23 characters** (finding 6's own correction), well under the
    crash limit.
12. **Two RNG draws where there was one — which existing exact-outcome tests in `rpg.test.js` run
    against a project that would turn the feature on?** None: `MONSTER_SPELL_LIST_ENABLED` is keyed
    on any actor's `spellIds` having 2+ entries, and every fixture `rpg.test.js` loads —
    `sample-rpg` itself, and every `mkdtemp` variant those tests build — carries exactly one entry
    per caster unless a test explicitly opts a variant in (§9's own new tests, which are new tests,
    not existing ones being silently changed). Verified by grep (§0): no existing `battle = {…,
    spellId: …}` assignment in `rpg.test.js` sets more than one id. **Pick-first adds a second
    reason this matters (§6): a 2+-entry monster consumes RNG differently from a 1-entry one *even
    on a coin decline***, since the pick is drawn before the coin can decline it — no existing test
    exercises a 2+-entry project, so this remains unobserved by anything currently in the suite,
    closing the gap §12's own new tests (8, 9) are built to cover.
13. **The column-0 `.if` trap** (CLAUDE.md "6502 traps," pinned in `codebuild.test.js`). Every `.if`
    in §6's listing (`MONSTER_SPELL_LIST_ENABLED`, both arms) is indented, matching every `.if`
    already in `engine/` — re-verified against the actual prototype source this round.
14. **The Monster Forge showing N selects for a project whose `spells` catalog is empty.** Today's
    single `Casts` select already handles this — `store.project.spells.map(…)` over an empty array
    renders no spell options, leaving only `Nothing` (`monster.js:146-149`) — and both phase 1's
    single select and phase 2's four-select replacement inherit it unchanged, since each is the
    identical control repeated. No project can author a non-`Nothing` entry in any slot until at
    least one spell exists in the catalog, exactly as today.

## §12. Test plan

Every test rewritten per the specific findings that named it; each states the wrong implementation
it rules out.

1. **Table shape, off-path byte-identity.** Build all six checked-in fixtures, hash each ROM,
   compare against `nameentry.test.js`'s `BASELINES` (unchanged hashes expected). *Rules out*: any
   accidental always-on wiring.
2. **`MONSTER_SPELL_LIST_BATTLE_ALLOWANCE` is exact, on every RPG-capable board** — the
   `MAGIC_POWER_BATTLE_ALLOWANCE` isolation shape, updated to assert `153` (not `147`). *Rules
   out*: a stale allowance once the real listing's byte count drifts.
3. **Table bytes grow by exactly `(N−1) × actors.length`.** Build a `mkdtemp` variant with an extra
   actor added (no battle content) and assert `battleTableBytes` grows by `N−1` more than the
   base-fixture delta. *Rules out*: a table emission that keys off `monsterActorIds` (hostile-only)
   instead of every actor, silently under-charging a project with non-monster actors.
4. **Duplicates are kept, not deduplicated, by the normalizer.**
   `normalizeActor({…, battle: {spellIds: [0, 0, 1]}})` → `battle.spellIds` has length 3, values
   `[0, 0, 1]` in order. *Rules out*: a normalizer that runs the array through a `Set` or an
   order-losing dedup, silently destroying §2/§3's weighting primitive the first time an author
   relies on it.

### The engine harness (round-2 findings 3, 4; round-3 findings 1-3 — the mechanism every
engine-level test below uses)

`test/unit/rpg.test.js` has two families of test helper, and they are not interchangeable.
`boot`/`tap`/`chooseCommand`/`walkIntoEncounter` (`:134-166`) each advance one or more **whole
frames** through the real NMI/main-loop cycle — there is no instruction-level boundary inside a
frame these helpers expose, and the switchable battle bank is only mapped for the duration of one
`call_battle` trampoline call and is switched back to whatever screen bank the field was showing
the instant that call returns (CLAUDE.md, "The battle system": "the restore *is* the return"). So
"poke `rng` at monster-turn entry" is not an operation these helpers can perform: there is no frame
boundary that lands exactly there, and even if there were, the battle bank would not reliably still
be mapped to read or write anything in it.

The existing `selectBattleBank` + `callRoutine` harness (`rpg.test.js:352-397`) is built for
exactly this: `callRoutine(nes, address)` writes a `JSR address / NOP` stub into RAM at `$0700`
(mirrored, executable regardless of which PRG bank is mapped), sets `PC` one byte before it, and
steps the CPU until `PC` reaches the byte after the stub — i.e. until *something* executes `rts`
back to the stub's own return address. `selectBattleBank(nes, built)` calls `switch_prg_bank`
(fixed-kernel, always reachable) once to map the battle bank in, and it **stays mapped** for every
subsequent `callRoutine` call in the same test, since nothing between calls triggers another bank
switch (`callRoutine` disables NMI generation and masks IRQ for its own duration, and no
`nes.frame()` call happens between trials) — so `selectBattleBank` is called once per test, not
once per trial.

**`monster_turn` ends in `jmp`, not `rts` — `callRoutine` still returns correctly, and this needs
no trampoline or breakpoint.** `jmp` never pushes a return address, so the original `JSR` our stub
issued leaves its own return address sitting on the stack, untouched, through every `jmp` in the
chain — `monster_turn` → `cast_spell` (or `monster_turn_attack`) → … → `battle_say_actor` (`jmp
battle_say`) → `battle_say`, which ends in a real `rts` (`engine/battleui.asm:614`) that pops *our*
stub's return address, since nothing else claimed the stack in between. This is the identical "tail
call" invariant CLAUDE.md's own "The battle system" section states for `call_battle` itself,
applied one level deeper.

**But `callRoutine`'s own return boundary is *after the whole action*, not right after the coin —
and that gap is exactly what defeats a naive RNG-identity comparison (round-3 finding 1, VERIFIED
by the orchestrator against `sample-rpg`'s own stats).** The `pickFirst` oracle (§6, `lfsr-sim2.mjs`)
stops advancing `rng` the instant the coin resolves; `callRoutine(nes, addrOf('monster_turn'))`
keeps running through whatever the coin's own outcome reaches next — on a decline,
`monster_turn_attack` → `roll_hit` → possibly `physical_damage`; on a cast, `cast_spell` and
whichever spell-kind routine it dispatches to — and several of those can call `rng_next` again
(`engine/battleturn.asm:571, 640, 772`, classified in full below). Comparing "`rng` at
`callRoutine`'s return" against the oracle's post-coin value is simply comparing two different
boundaries, and under `sample-rpg`'s own stock stats the named rejection-threshold witnesses go
invisible at the full-action boundary even though they are real at the post-coin one (K=2 seed 199:
correct/mutated `rng` after the coin `111`/`143`, but after the full action both reach `222`; K=4
seeds 127/198/199 collapse to `214`/`214`, `206`/`206`, `222`/`222` the same way) — the two paths
draw a different number of times downstream, so they can converge on the same final byte even
though they genuinely disagreed right after the coin.

**The fix: make the downstream draw nothing, so `callRoutine`'s return boundary *is* the post-coin
boundary — the recommended protocol.** Every `rng_next` call site in the whole battle system was
read and classified (the full table is in the report); of the eight total, only three sit on a path
`monster_turn`'s own tail can structurally reach at all (`battleui.asm:209`'s flee roll is
party-menu-only, `rpg.asm:32`/`46`'s encounter roll is field-only, `battleturn.asm:1125`'s drop
roll only fires when the monster itself is defeated — none of these three are reachable from a
monster's own turn resolving). The three that are reachable are each individually closable under a
specific, checkable condition:

- **`roll_hit`'s own draw (`battleturn.asm:571`)** is guarded by an accuracy/evasion underflow
  check that runs *before* it (`:566-569`): `acc − eva`, and `bcc roll_hit_miss` branches away
  **before** `jsr rng_next` on any underflow. Setting the tested monster's `acc` to `0` against a
  target whose `eva` is greater than zero (`sample-rpg/party.json`: Rian's `eva` is `8`) makes this
  branch taken on every single trial — `roll_hit` always misses, and never reaches its own draw.
  This is the identical idiom `rpg.test.js:3869-3871` already uses ("Four hit points is two poison
  ticks, and it can never hit back," `battle: {…, acc: 0}`), not new to this design.
- **`physical_damage`'s own noise draw (`battleturn.asm:640`)** is only reached from
  `monster_turn_attack` after `roll_hit` returns a hit (`bne monster_missed` skips it on a miss) —
  the `acc: 0` guard above closes this one too, transitively, without a separate condition.
- **`roll_spell_amount`'s own draw (`battleturn.asm:772`)** is skipped whenever the chosen spell's
  `spell_amount_n,x == 1` — a flat (`amountMin == amountMax`) spell (`roll_spell_amount_flat`,
  `:781-783`). Every spell in `sample-rpg/spells.json` is already flat (Ember `10`/`10`, Mend
  `18`/`18`, Venom `1`/`1` — read directly, not assumed), so any list built only from this
  fixture's own catalog never reaches this draw either. `cast_poison` (`:395-421`, its own callee
  `poison_target` at `:425-433`) draws nothing at all — it only sets a status bit — so Venom's own
  cast path is doubly clear. With `MAGIC_POWER_ENABLED`/`MAGIC_DEFENCE_ENABLED` both off in
  `sample-rpg` (no actor or party member sets `mag`/`mdef` above 0), `spell_damage`/`cast_heal` add
  no draw of their own either — confirmed by the same exhaustive `rng_next` grep, not merely
  assumed.

Under `acc: 0` and an all-flat-spell list, **zero** `rng_next` calls happen between the coin and
`callRoutine`'s own return, on either path — so `rng` at return equals the `pickFirst` oracle's
post-coin value, for every seed, and the named witnesses (K=2: 199 → 111 vs 143; K=4: 127/198/199)
are visible again exactly as the oracle predicts. **This is the protocol for tests 6, 8 and 9
below**: the tested monster's `acc` is set to `0`; every list under test is built only from
distinct flat spells, **never a duplicate id** (round-3 finding 2 — the picker's own listing
overwrites the chosen *index* with the resolved *spell id* the instant it picks (`bt_arg`,
`:706`), so a list with a repeated id, e.g. `[Ember, Mend, Venom, Ember]`, cannot tell index 0 from
index 3 apart from the outside: same id, same MP spend, same effect, no surviving observation
distinguishes them). `sample-rpg`'s own catalog has only three flat spells (Ember/Mend/Venom, MP
cost 3/4/2), so the K=4 configuration needs a fourth, added to the `mkdtemp` variant:
`project.spells.push({id: 3, name: 'Frost', kind: 'damage', amountMin: 6, amountMax: 6, element:
'none', scope: 'one', mpCost: 1})` — flat (`amountMin === amountMax`), and deliberately given the
one MP cost (1) none of the fixture's own three spells already uses, so **all four list positions
now have distinct MP costs (Venom 2, Ember 3, Mend 4, Frost 1)** — the spend itself identifies the
index chosen, independent of and in addition to the (now also distinct) spell id. `mon_slot_mp` is
seeded to **`4`** before every trial in every one of the K=2/3/4 configurations below (not `2`/`3`
matching K's own number, which was the earlier error: Mend alone costs 4, so any list containing it
needs at least that much to make every entry affordable) — the expected value at every seed is
`pickFirst(seed, K)` verbatim, un-adjusted.

**Alternative, priced but not chosen: extend the harness with a stop address.** `callRoutine`
already steps one instruction at a time and identifies "the next instruction" as `REG_PC + 1`, not
raw `REG_PC` (`while ((nes.cpu.REG_PC + 1) !== 0x703) { cycles += nes.cpu.emulate(); … }`,
`rpg.test.js:361-364`, the same offset the existing `0x703` stub-return check already uses) — a
`callRoutine(nes, address, stopPc)` variant must stop the identical loop on `(nes.cpu.REG_PC + 1)
=== stopPc`, matching that convention, **not** a raw `nes.cpu.REG_PC === stopPc` comparison, which
would not stop at the target instruction's own entry (round-4 finding 3, corrected that round).
`pick_party_target` (`battleturn.asm:996, 999` — both the cast tail and `monster_turn_attack`'s own
first instruction call it) is reached on *both* paths with zero draws after the coin and before any
message is queued, so stopping there would make the boundary correct without needing `acc: 0` or an
all-flat-spell restriction at all. **Stopping there also means stopping *inside* a nested call —
`pick_party_target` was reached via its own `jsr`, so its own return address sits on the stack
above our stub's original one, and neither is popped.** The next trial cannot simply reissue the
stub call on top of that: two per-trial options close it out, and they are not interchangeable —
**either** let the suspended call run to completion first (resume single-stepping, now back to the
*original* `0x703` stop condition, before setting up the next trial's stub) — this keeps `rng`
observable at the earlier, post-coin stop point while still letting the action itself finish
naturally, which is a genuine advantage the recommended `acc: 0` protocol does not have: nothing
about *this* option constrains the tested monster's own `acc` or the spell list to flat amounts, so
it would work unmodified for a future test that needs arbitrary accuracy or a variable-amount
spell, where `acc: 0` cannot (round-5 finding 1, replacing an earlier, wrong claim that resuming
"gains nothing" — it gains exactly that generality; the reason the recommendation below still
stands is reuse of already-measured, zero-harness-change machinery, not that this option has no
upside) — **or** snapshot `REG_SP` immediately after writing the stub and before starting the step
loop, and restore that exact snapshotted value (discarding both pending return addresses at once,
rather than unwinding them one `rts` at a time). **This discards the pending calls, not any RAM
write already made before the stop point — on a casting trial, `mon_slot_mp` has already been
spent** (§6's own listing writes it, `:711-714`, before `jsr pick_party_target` at `:715`; today's
committed engine has the identical ordering, `battleturn.asm:992-996`), since restoring `REG_SP`
only unwinds the stack, never reverts a store that already executed — the per-trial `mon_slot_mp`
reset (above) is required for **both** alternatives, not only the recommended `acc: 0` protocol, to
correct an earlier, wrong claim that this option spent nothing at all (round-6 finding 1). **No
message has been queued at the stop point; both the casting and the attack paths reach message
queuing afterward** — `monster_turn_attack`'s own hit and miss paths both `jmp battle_say_actor`
too (`battleturn.asm:998-1011`), not only the cast path through `cast_spell`, correcting a narrower
claim here that named `cast_spell` alone (round-7 finding 2). Both are new,
unverified harness code this document has not built or
tested, on top of a shared parameter and stopping condition to verify against every other
`callRoutine` caller in the file — where the `acc: 0` protocol needs no harness change whatsoever,
only a controlled fixture variant — the lower-risk choice, consistent with this document's own
preference (§6, finding 1) for reusing what is already measured and verified over introducing
something new. If Chris would rather generalize the harness once instead of constraining every
future test built on it to `acc: 0`/flat spells, the stop-address variant is
the one to build (§14).

**The VRAM-queue reset below becomes unnecessary only under the `REG_SP`-restore-and-discard
option, not the resume-to-completion one (round-5 finding 1, corrected — an earlier pass here
exempted both without distinguishing them).** Discarding the unfinished action means `battle_say`
never runs at all, so nothing is ever queued — that option alone needs no VRAM reset. Resuming to
completion, by contrast, lets the suspended call carry on exactly as the recommended `acc: 0`
protocol's own full action does: it still reaches `battle_say` (`engine/battleui.asm:590`) and
still queues both message packets, with no frames or NMI running to drain them between trials
either way — so the resume option **keeps** the VRAM-queue reset, on the identical grounds §12
already gives for the recommended protocol below.

**RAM addresses are resolved with `resolveEngineAddress`, not `addrOf` — `addrOf` only knows
routine labels (round-2 finding 2, VERIFIED).** `addrOf` (`rpg.test.js:388-392`) searches
`game.fns` for an assembled symbol; `game.fns` holds code labels (`monster_turn`,
`mod_monster_len`, `switch_prg_bank`), not `engine/constants.asm`'s own RAM equates — `addrOf('rng')`
would fail its own `assert.ok` immediately, since `rng` is never a `game.fns` label. `rng`,
`mon_slot_mp`, `bt_arg`, `bt_len`, `bt_actor`, `mon_slot_actor`, `vram_len` and every other RAM
byte these tests poke or read are resolved with `resolveEngineAddress(constantsText, name)`
(`rpg.test.js:410` onward, reading `build/constants.asm` — the identical established call pattern
`resolveEngineAddress(constantsText, 'bt_wipe_mask')` already uses at `:3683-3684`), against the
one build's own `build/constants.asm` text, read once per test. `addrOf` stays reserved for
routine labels (`monster_turn`, `mod_monster_len`); `selectBattleBank`'s own `REG_ACC`/`callRoutine`
pattern is at `rpg.test.js:393-394` (not `:379-380`, corrected this round).

**VRAM-queue reset (round-2 finding 3; round-3 finding 3, VERIFIED — the reset was missing the VRAM
queue entirely).** `battle_say` (reached from both `monster_turn_attack` and every cast path)
queues **two** message packets every single trial via `vram_open`/`vram_push`/`vram_end`
(`engine/battleui.asm:590-608`), and `vram_open`/`vram_push` (`engine/text.asm:111-136`) append
through `vram_len` — a plain byte index into the 256-byte `vram_buf` (`engine/constants.asm:97,
780`) — with **no capacity check anywhere in either routine**. `vram_len` is normally reset by
`vram_drain` running in NMI once a frame; this harness runs no frames and no NMI (`callRoutine`
disables both for its own duration), so nothing else ever resets it, and hundreds of trials queuing
two packets each will keep incrementing it until it wraps and starts overwriting earlier, undrained
packets. `vram_len` is reset to `0` before every trial (`vram_cnt`, the *open* packet's own count-byte
index, is fully re-set by `vram_open` itself at the start of each packet and needs no separate
pre-trial reset). **`bt_phase` and `bt_timer` are overwritten by `battle_say` itself every trial
(`engine/battleui.asm:610-613` — the message-queuing at `:606-608` is a separate few lines earlier
in the same routine, not the same citation) and must never be relied on to carry a value across
trials** — reading either one *after* a call reflects only that trial's own outcome, never a prior
one's. `bt_target` needs no explicit pre-trial set: `pick_party_target` (called from both paths
before any message is queued) recomputes it fresh every trial regardless of its prior value.

**Full per-trial initialisation and reset (round-3 finding 1, round-4 finding 1, VERIFIED — `acc:
0` closes the *physical-hit* path's own draw and damage, not the *cast* path's**: Ember still
reaches `spell_damage` → `apply_damage` (`battleturn.asm:297-298`) regardless of `acc`, since
`roll_hit`'s own underflow guard is never on Ember's call path at all — only `monster_turn_attack`
calls `roll_hit`; `cast_spell` never does. Venom still writes `pc_status` via `poison_target`
(`:425-433`) the identical way. Repeated Ember casts across a 255-seed sweep would exhaust Rian's
`pc_hp` for real, and nothing in the `acc: 0` guard prevents it — the earlier claim that it did was
wrong and is corrected here in place, not appended beside.**

Setup, done **once** per test, immediately after `selectBattleBank`, in this order (every routine
called is in the already-selected battle bank; none of them touches `rng_next`, confirmed by the
same exhaustive grep §0 records):

1. `callRoutine(nes, addrOf('party_init'))` (`engine/battle.asm:87-109`, and the `party_join`/
   `party_apply_level` chain it calls for every member with `startsInParty` true — Rian, in
   `sample-rpg`). This is the real engine routine a battle already runs; calling it once gives
   `pc_in_party` (needed by `combatant_alive`'s own party branch, `battleturn.asm:98-99`, which
   `pick_party_target` depends on to find a target at all), `pc_level`, and — via `party_join` —
   `pc_hp`/`pc_hp_max` at their real, level-derived starting values, without this document having
   to hand-compute or separately state what those values should be.
2. `mon_slot_actor` (`resolveEngineAddress`) poked directly: the tested actor's own id in its own
   slot, `NO_ACTOR` (`$FF`) in the other three — `setup_monsters` (next) reads this table, it does
   not build it. `callRoutine(nes, addrOf('setup_monsters'))` (`engine/battle.asm:341-368`) then
   derives `mon_slot_hp`/`mon_slot_max`/`mon_slot_mp` from the ROM's own `mon_hp`/`mon_mp` tables —
   but **only for the occupied slot** (round-5 finding 2, corrected — an earlier pass here
   overstated this as "every slot"): the per-slot block checks `mon_slot_actor,x` against `$FF`
   and branches past exactly those three assignments for an empty slot (`:349-354`), leaving
   whatever bytes an empty slot's own `mon_slot_hp`/`mon_slot_max`/`mon_slot_mp` already held —
   never read by anything this harness's own reachable paths touch, so harmless, but not
   "initialised" in the sense the other two bytes are. `mon_slot_alive`/`mon_slot_status`, by
   contrast, genuinely are zeroed **for every slot** unconditionally, before that same branch runs
   (`:349-351`) — `mon_slot_alive` is then set back to `1` only for the occupied slot, immediately
   after the HP/MP fill. This is the identical real routine a battle already runs to fill a
   formation's own state in from `mon_slot_actor`.
3. `bt_actor` (`resolveEngineAddress`) poked once to the tested monster's own combatant index
   (`MAX_PARTY` + its slot).

**`combatant_eva` does *not* read a level table, and `pc_level` does not matter for the `acc: 0`
guard at all** — corrected here against an assumption in an earlier pass that it might
(`combatant_eva`, `battleturn.asm:601-608`, reads `pc_eva,x` directly for a party member; `pc_eva`
is a flat, build-time table (`main/build/battletables.js:279`, one byte per member straight from
`member.eva`), never scaled by level the way `pc_atk_at`/`pc_def_at` are (`:290-291`) — `eva` and
`acc` are both level-independent stats in this engine. Rian's `eva: 8` is already baked into the
ROM the instant `sample-rpg` is built; nothing about it needs poking or resetting at runtime.

Per trial, in this order:

1. `mon_slot_mp` for the tested slot reset to the test's own controlled starting value
   (`resolveEngineAddress`) — a cast spends it, so the next trial must not inherit that spend.
2. `pc_hp` for the target (Rian, party slot 0 — the first, and in every variant this design needs,
   only, living party member `pick_party_target`'s own "first still standing" walk can ever find)
   reset to `pc_hp_max` (both `resolveEngineAddress`), **unconditionally, on every trial, whether or
   not that trial's own outcome happens to cast Ember** — the reset must run before the outcome is
   known, not conditionally after it.
3. `pc_status` for the same target reset to `0` (`resolveEngineAddress`) — the same unconditional
   reason; a Venom cast `ora`s `STATUS_POISON` in, so leaving it set is not itself incorrect
   (idempotent), but resetting it keeps every trial starting from an identical, documented state
   rather than one that depends on what the previous trial happened to cast.
4. `vram_len` reset to `0`, as established above.
5. `rng` poked to the trial's own seed — a precondition, not a reset, listed last only because it
   is the last thing set before the `callRoutine` call itself.

`mon_slot_actor`, `mon_slot_alive`, `mon_slot_status` (the tested monster's own, never targeted by
anything on this protocol's reachable paths — Venom always lands on the party, never the caster),
and `bt_actor` are stable for the whole sweep and are not part of the per-trial list.

5. **Off-path migration/regression coverage only (finding 11 — demoted from a behavioural proof).**
   `rpg.test.js:3821-3860` ("a monster with a spell casts it…") re-run unchanged against a
   `spellIds: [2]` single-entry actor on the **off** path. This test proves eventual poisoning,
   some MP spend, and later HP loss survive the migration and the off-path routing — **it does
   not, and is not claimed here to, prove a 50% cast rate or exact per-round MP accounting**; that
   evidence comes from tests 6-9 below instead.
6. **Distinguishing (i) from (ii) at a controlled MP value, by a per-seed outcome that provably
   diverges between them, not by rate or by "Ember never appears" (finding 8).** Snake with
   `spellIds: [Venom (cost 2), Ember (cost 3)]` (padded to N=4 with `$FF`), `mon_slot_mp` reset to
   exactly **2** before every trial (reachable in play from 8 MP via two Ember casts — `8 − 3 − 3 =
   2` — the two Ember casts alone reach exactly 2; a further Venom cast, cost 2, would zero it out
   rather than "exhaust it to 2," so the test sets MP directly to 2 rather than describing a third
   cast that does not land on that value — finding 12). At MP = 2, Ember is **never** affordable
   and Venom **always** is, so under this design's own scan (§6) exactly one entry (Venom) ever
   reaches the affordable sub-list, `bt_len == 1` on every trial, and the whole turn reduces to the
   coin alone (`jsr rng_next / and #1`) — the identical single-entry short-circuit test 9
   exercises for RNG identity.
   The test builds **two** real prototypes for this one comparison: the recommended engine (option
   i) and a literal implementation of option (ii) — an unconditional draw of `rng_next() & 3`
   indexing straight into the monster's own 4-byte `mon_spell` row (no affordability pre-filter,
   no coin), attacking if the drawn slot is `$FF` or unaffordable. Using the engine harness above
   (`selectBattleBank` once, then per seed 1-255: reset `mon_slot_mp` to 2, poke `rng` to the seed,
   `callRoutine(nes, addrOf('monster_turn'))`, read `mon_slot_mp` afterward — unchanged means the
   coin declined and the turn attacked, decreased-by-2 means Venom was cast), record cast-Venom vs.
   attack on both prototypes. **The exact assertion**: for every seed where option (i)'s own coin
   passes (`rng_next(seed)
   & 1 == 0` — 127 of the 255 seeds, the identical count test 8 already establishes), option (i)
   casts Venom; option (ii) casts Venom on only 63 of the 255 seeds (`rng_next(seed) & 3 == 0`,
   since two of its four raw slot values are `$FF` padding and one is Ember, now unaffordable) —
   the two algorithms disagree on cast-vs-attack for **64 of the 255 seeds**, computed exhaustively,
   not sampled. A concrete, named witness: seed `1` gives `rng_next(1) = 2` — bit 0 is 0, so
   option (i)'s coin passes and it casts Venom; the same byte's low two bits are `2`, an empty
   `$FF` slot under option (ii), so option (ii) attacks on the identical seed. *Rules out*: any
   implementation — including a superficially-affordability-aware one — whose per-seed decision
   matches option (ii)'s 64-seed divergence pattern rather than option (i)'s, which "Venom or
   attack never Ember" alone cannot catch, since both algorithms satisfy that weaker property at
   this MP value.
7. **Exhaustive modulus check, standalone (finding 9, part 1).** `mod_monster_len` takes its
   dividend in `A` on entry (§6's own listing) — `callRoutine(nes, addrOf('mod_monster_len'))`
   with `nes.cpu.REG_ACC` set to the dividend and `bt_len` (resolved via `resolveEngineAddress`,
   above) poked to the divisor beforehand (the identical `REG_ACC`-then-`callRoutine` pattern
   `selectBattleBank` itself already uses, `rpg.test.js:393-394`), reading `nes.cpu.REG_ACC` after
   return for the result — for every dividend 0-254 at every divisor 2, 3, 4, asserts `result ===
   dividend % divisor` for all 3×255 cases. This routine itself draws no `rng_next` and calls
   nothing downstream, so it needs none of the `acc: 0`/flat-spell protocol below — its own
   boundary (`callRoutine`'s return) already coincides with "the answer is ready." *Rules out*: an
   off-by-one in the shift-subtract loop invisible to a handful of hand-picked seeds.
8. **Exhaustive end-to-end coin+picker check, per-seed, not aggregate, under the `acc: 0`/
   flat-spell protocol above (round-2 finding 3, round-3 finding 1 — without that protocol,
   `callRoutine`'s own return boundary sits *after* the coin, past a possible `roll_hit`/
   `physical_damage`/`roll_spell_amount` draw, and a wrong rejection threshold's own effect on
   `rng` can vanish by the time the action finishes resolving).** Replacing `monster_pick_limit`'s
   real values (`254, 255, 252`) with `255, 255, 255` reproduces the **identical** aggregate cast
   counts at every K (64/63, 43/42/42, 32/32/32/31 — verified by re-running `lfsr-sim2.mjs` this
   round, full output in the report) while leaving the *post-coin* `rng` different on 1 of 255
   seeds at K=2, 0 at K=3 (the correct limit is already 255 there, so this mutation is invisible at
   K=3 by construction — worth stating, not hiding), and 3 of 255 at K=4. **Named
   rejection-witness seeds, the exact ones a threshold bug flips, at the post-coin boundary**: K=2,
   seed 199 (`rng` exits 111 under the correct table, 143 under the mutation); K=4, seeds 127, 198,
   199 (e.g. 199 again exits at 111 vs 143) — **the same seeds collapse to an identical `rng` under
   both the correct and mutated tables at the full-action boundary** (222/222, 214/214, 206/206
   respectively) if the monster's `acc` is not forced to 0 and its list is not restricted to flat
   spells, which is exactly why that protocol is a precondition here, not an optional tightening.
   With it applied, test 8 must assert, **per seed, not in aggregate**: the cast/decline decision,
   the chosen list index when it casts, and the `rng` byte at `callRoutine`'s own return — for
   every one of the 255 nonzero seeds, at K = 2, 3, and 4 separately, **three configurations of
   distinct spell ids, never a repeated one (round-3 finding 2 — the picker's own listing
   overwrites the chosen index with the resolved spell id, `:706`, so a duplicate id leaves no
   surviving way to tell which position was chosen)**: K=2 `spellIds: [Venom, Ember]`; K=3
   `spellIds: [Venom, Ember, Mend]`; K=4 `spellIds: [Venom, Ember, Mend, Frost]` (the fourth spell
   the harness intro above adds to the `mkdtemp` variant). `mon_slot_mp` is reset to **`4`** before
   every trial in **all three** configurations — not `2`/`3` matching K's own number, which was the
   earlier error: Mend alone costs 4 MP, so a K=3 or K=4 list that includes it needs at least that
   much for every entry to be affordable, and `4` affords all four fixture-plus-Frost spells at
   once (costs 2/3/4/1), so one seeded value serves every configuration. Since every list's own ids
   are already pairwise distinct, `bt_arg`'s own final value (the cast spell id) already identifies
   the chosen index uniquely with no further instrumentation — and, because the four costs are
   pairwise distinct too, the MP spend alone would identify it a second, independent way. Using the
   engine harness above, the expected per-seed table (`{idx, draws, cast, rng}` for every seed) is
   generated by the identical simulation `lfsr-sim2.mjs`'s own `pickFirst` function computes, not
   hand-picked — the same discipline test 7 already holds `mod_monster_len` to, applied to the whole
   coin+picker sequence. *Rules out*: a correct-in-isolation `mod_monster_len` combined with an
   incorrectly-reordered
   coin/pick sequence (test 7 alone cannot see this, since it never exercises the coin), **and** a
   wrong rejection threshold that happens to preserve every aggregate cast count while silently
   drawing an extra rejected roll on the three named witness seeds — the specific gap an
   aggregate-only version of this test, or one compared at the wrong (full-action) boundary, leaves
   open.
9. **RNG-consumption identity for a single-affordable-entry monster, at `callRoutine`'s own exit
   boundary under the same `acc: 0`/flat-spell protocol, with a second actor enabling the feature
   project-wide (findings 4, 8, 10; round-3 finding 1).** The `mkdtemp` variant needs a **second**
   monster actor with a 2+-entry list (so `MONSTER_SPELL_LIST_ENABLED` is true project-wide) while
   the *tested* actor (Snake) keeps exactly one entry, `acc: 0`, and a flat spell (any of
   `sample-rpg`'s own three). `rng` is the *only* RNG state, but it also advances once per frame
   outside any single roll (`engine/rpg.asm:11-12`), which is why a frame-based "after N rounds"
   comparison cannot isolate this and the direct `callRoutine` boundary is required instead — and,
   per finding 1, why the monster's own downstream draws (attack or cast) must be closed off first,
   or the comparison below would be observing the wrong boundary the same way test 8's own aggregate
   version was: read `rng` immediately before the call (the poked seed) and immediately after it
   returns (`callRoutine`'s own exit, defined above), for a seed known (from test 8's own per-seed
   table) to make the coin pass; assert two builds — one with the feature off entirely, one on with
   only Snake exercising the single-entry short-circuit — leave `rng` in the identical byte after
   that one call. *Rules out*: a version of the listing that draws the pick unconditionally,
   skipping the `bt_len == 1` short-circuit, which would still cast the correct (only) spell but
   silently consume an extra draw.
10. **`renumberSpellDeletion` on a monster's list: drop-and-shift.** Rewritten per §5, plus the
    corrected `[1, 3, 1]` case (finding 14) — deleting spell id 2 from `spellIds: [1, 3, 1]`
    leaves `[1, 2, 1]`: the two entries valued 1 are **untouched** (1 < 2, `shift` leaves them
    alone), the entry valued 3 shifts to 2 (3 > 2). *Rules out*: a rewrite that moves every entry
    regardless of its own value relative to the deleted index, rather than applying
    `shared/project.js:2556`'s own `id > index ? id - 1 : id` rule per-entry.
11. **The exact padding assertion, restored as its own test (finding 5 — test 12 below checks
    table *size*, which cannot see `$00` substituted for `$FF`).** A project where one actor has a
    single-entry `spellIds` (so the feature predicate needs a *second* actor with a 2+-entry list
    to be true project-wide — the identical two-actor shape test 9 uses) — assert
    `battleTables(project)`'s own emitted `mon_spell` chunk for the single-entry actor is
    **exactly** `[id, $FF, $FF, $FF]`, never `[id, $00, $00, $00]`. *Rules out*: the
    `hex()`-masking bug in §11 finding 9 — a padding construction that leaves array holes
    (`undefined & 0xff === 0` in JavaScript) rather than explicitly filling every slot to `N` — in
    the generator itself, which a size-only check (test 12) cannot distinguish from correct
    padding, since both emit the same *number* of bytes.
12. **A second actor with two entries, feature on, tested actor with two entries too — the general
    (not single-entry) case (finding 10).** `spellIds`-widened `mon_spell` emits N bytes/actor for
    every actor including the second; assert `battleTableBytes` reflects both actors' own widened
    rows, not just the tested one's.
13. **Monster Forge phase-1 migration: the single `Casts` select preserves entries 1-3 of a
    hand-edited list (finding 3).** A project with `battle.spellIds: [2, 5, 7]` (hand-authored,
    3 entries) opened in the Forge: the select shows entry 0 (spell 2); changing it to spell 9
    commits `spellIds: [9, 5, 7]` — entries 1 and 2 untouched; changing it to "Nothing" commits
    `spellIds: [5, 7]` (the list closes up, no gap). *Rules out*: a phase-1 migration that
    discards entries 1..3 the moment slot 0 is edited through the old single-select control.
14. **Monster Forge phase 2: four selects, commit/undo/redo/reload, trailing-`Nothing` collapse.**
    `main/smoke.js`, following the existing per-label loop's shape (`:7547-7610`) but against
    `<select>` elements: set slots 0 and 2 (`Ember`, `Venom`), leave 1 and 3 at `Nothing`; assert
    `battle.spellIds` reads `[Ember, Venom]` (collapsed, slot 1's gap removed) after commit; undo
    restores the prior list; redo reapplies; save/reopen round-trips it. *Rules out*: a Forge
    commit that stores `[Ember, Nothing, Venom, Nothing]` verbatim (four raw slots, `Nothing`
    encoded as some sentinel rather than simply absent), which would silently change
    `battle.spellIds`' own schema shape from "a list of real ids" to "a list of four nullable
    slots" — a different, larger on-disk shape than §5 specifies.
15. **`battleShortfallAdvice` offers "removing every monster's extra spells" when that alone closes
    a deficit**, and does not offer it when it does not, using the generalized `bankedFeatures`
    mechanism (§7). Following the existing (pre-generalization) `nameFeatures` solo-winner logic's
    own shape (`battletables.js:1000-1010`) — a direct unit test on `battleShortfallAdvice`'s
    return value for a project engineered to be exactly this close to the ceiling. *Rules out*: the
    lever added in §7 either never firing (dead code) or firing when it would not actually close
    the deficit (bad advice, worse than none).

## §13. Phasing

Every phase is independently shippable — nothing offers UI the engine does not yet honour
(CLAUDE.md, "Conventions") — and schema + engine land together in phase 1, not schema first, the
same reasoning `design-magic-power.md` §15 already records for the identical shape: a schema field
with no engine reader is either silently ignored (worse than not existing — an author can set it
and see nothing happen) or the UI has to be held back a phase for no reason, since there is no
intermediate state where `battle.spellIds` means something partial.

1. **Schema, engine, ledger, tests, AND the minimal Forge migration (findings 3, 7, expanded this
   round).** The migration, `monster_turn`'s pick-first rewrite with both helpers gated, the
   `MONSTER_SPELL_LIST_ENABLED`/`MONSTER_SPELL_LIST_BATTLE_ALLOWANCE = 153` wiring, the
   `bankedbytes.test.js` isolation test, the rewritten `renumberSpellDeletion` tests, the
   six-fixture SHA-256 re-pin (unchanged hashes — a passing re-run, not a re-pin at all, unless
   something in this phase is wrong), **and the Monster Forge's existing `Casts` select migrated to
   read and write `spellIds[0]`, preserving `spellIds[1..]` untouched (test 13, §12)**. This is the
   decision finding 3 forced: engine capability preceding *full* UI exposure is fine (CLAUDE.md
   does not require every capability to have its complete authoring surface in the same phase that
   adds it) — but leaving the *existing* control reading a field that no longer exists is not
   "preceding," it is *breaking*, so the minimal single-select migration ships in phase 1 alongside
   the schema and engine change, and the phase is genuinely shippable: an author with a
   single-spell monster sees no change at all; an author who hand-edits a multi-entry list keeps
   entries 1-3 intact even though only entry 0 is reachable from the Forge until phase 2.
2. **Monster Forge: the remaining three selects, the tooltip, the trailing-`Nothing` collapse (§8,
   smoke test 14).** The only phase with a visible multi-select Forge change (phase 1 already
   changed the Forge's single select's own binding, but not its shape). Shippable alone because
   phase 1 already compiles `battle.spellIds` correctly regardless of how many entries a project
   has — this phase only adds the authoring surface for entries 1-3.
3. **`battleShortfallAdvice`'s generalized lever and ROADMAP/CLAUDE.md docs (§7, §10).**
   Deliberately last: the advice lever is a quality-of-life addition (better refusal messages), not
   something any test in phase 1 or 2 depends on, and the docs sweep records the shipped shape
   rather than a planned one.

## §14. Open questions for Chris

The primary path above follows the recommendation in every case below.

1. **N (§2).** Recommend 4 — priced at 2/4/8 in §2.
2. **Uniform-among-affordable vs ordered-first-affordable (§3).** Recommend uniform; ordered-first
   is cheaper (~99 bytes vs pick-first's 153, §2 — an early-exit scan could cut it further, not
   separately costed) if Chris prefers a clear priority list over a weighted lottery.
3. **Duplicates as weighting, or a deduplicated set (§3, §5).** Recommend duplicates.
4. **pick-first vs high-bits (§6, new this round).** Recommend pick-first: it reuses the
   already-correct rejection-sampling arithmetic unchanged, only reordered, rather than a genuinely
   new draw technique — not because it needs fewer draws (both can need a second draw over the
   full 255-state domain: pick-first at K=2/4 on decline paths, high-bits at K=3 on a casting
   path). high-bits (estimated ~146 bytes, §2) never wastes a draw on a coin decline, if that
   matters more to Chris than reusing measured arithmetic.
5. **`spellIds` as the field name (§5, new this round — an explicit naming question, not only a
   recommendation buried in prose).** Recommend `spellIds`, distinguishing it from `member.spells`'
   own `{spellId, level}` object-array shape.
6. **The `battleShortfallAdvice` generalization (§7, new this round).** Recommend renaming
   `nameFeatures`/`nameBudget`/`nameFreed` to `bankedFeatures`/`bankedBudget`/`bankedFreed` and
   adding the new lever — a naming/structure change to existing, shipped code, worth Chris's
   explicit sign-off since it touches a file no other in-flight design is editing concurrently.
7. **The four-select UI shape (§8, new this round — explicit).** Recommend one `Casts` label plus
   three `Also`/`or`/`or` labels, trailing-`Nothing` collapse on commit; alternative label wording
   is a taste call with no cost difference.
8. **Should the RPG starter's Bat gain a two-spell list (§9)?** Recommend leaving it as-is.
9. **The `acc: 0`/flat-spell test protocol vs. a `callRoutine` stop-address extension (§12, new
   this round).** Recommend the `acc: 0` protocol — no harness change, reuses `rpg.test.js`'s own
   established idiom (`:3869-3871`). The stop-address alternative (`callRoutine(nes, address,
   stopPc)`, stopping at `pick_party_target` on `(REG_PC + 1) === stopPc`) is more general — any
   future test on this harness would not need to be constrained to `acc: 0` and flat spells — at a
   real cost this round repriced honestly, not as one single cost but as **two distinct per-trial
   options with two distinct costs (round-6 finding 2, correcting an earlier pass here that named
   only one, as though it were mandatory for every trial)**: resume the suspended call to
   completion — the stack unwinds normally through its own `rts` chain, no `REG_SP` surgery needed,
   but the action finishes for real, so the VRAM-queue reset (§12) is still required every trial;
   or restore a snapshotted `REG_SP` and discard the call — no VRAM reset needed, since `battle_say`
   never runs, but this is the untested stack surgery, and `mon_slot_mp` still needs its own
   per-trial reset either way, since a casting trial has already spent it before the stop point
   (§12's own correction, round-6 finding 1) — restoring `REG_SP` undoes pending calls, not RAM
   writes already made. Worth Chris's sign-off if more engine-level battle tests are expected
   to follow this one's own shape.

Chris answered all nine of the above on 2026-09-11, accepting every recommendation as written:
N = 4; uniform-among-affordable; duplicates as weighting, never deduplicated; pick-first;
`spellIds`; the `battleShortfallAdvice` generalization approved but deferred to phase 3;
`Casts`/`Also`/`or`/`or` labels with trailing-`Nothing` collapse on commit; the RPG starter's Bat
stays single-spell; the `acc: 0`/flat-spell test protocol, not the `callRoutine` stop-address
extension. The primary path throughout this document already follows every one of these, so
nothing above needed re-deriving.

## §15. Out of scope, explicitly

- **A per-monster cast rate** replacing the fixed 50% coin (§4) — a real, separate later slice,
  costed in outline only, not designed here.
- **A per-entry explicit weight byte** as an alternative to duplicate-entries-as-weighting (§3) —
  now priced in full in §2's own alternatives table (16 bytes plus a weighted-draw routine), not
  designed; duplicates remain the recommended primitive.
- **Spell animations of any kind** — unrelated to this design and untouched by it, the same
  carve-out `design-magic-power.md` §17 already states for the identical reason.
- **Any change to `pick_party_target`'s own targeting rule** ("first member still standing") — a
  monster's spell *choice* is this design's whole subject; who it aims at is untouched, and
  `pick_party_target` is called unmodified from the new `monster_turn` exactly as it is from the
  old one. §3's own reasoning for randomising the spell choice is argued independently of this
  routine's comment, which argues the opposite for targeting (finding 19, §3).
- **Any change to the party's own multi-spell shape** (`pc_spells`, the bitmask, `build_spell_list`)
  — the precedent this design compares against in §2, never modified by it.
- **A slot ring, journal, or any other atomicity mechanism** — not applicable; nothing here touches
  save data at all (confirmed in §0: `mon_spell`/`battle.spellIds` never reach `shared/save.js`).
- **Any change to `SAVE_LAYOUT_VERSION` or `saveIdentity`.** A monster's spell list is compiled
  into the ROM's own banked battle region, never into the save record, so nothing about a save's
  own layout or identity changes. No test needs to prove a save round-trip for this feature.
- **Equipment, items, or any other source of spell access beyond an actor's own authored
  `battle.spellIds`** — matching the identical carve-out `design-magic-power.md` §17 already
  states for magic power/defence's own stat sources.

## §16. Changelog

- **v2 (this round).** Every one of the 20 review findings addressed; none appended beside a stale
  v1 sentence — every flagged passage rewritten in place. By finding:
  - **1 (P1)**: v1's coin-then-pick algorithm is LFSR-biased (exhaustively confirmed, K=4 idx 1
    never cast). Replaced with **pick-first**, re-verified bias-free by the identical exhaustive
    method. §1, §2 (new pricing table), §3, §6 (algorithm-choice writeup, full listing rewritten,
    new measurement), §7, §11, §12, §14 all changed.
  - **2 (P1)**: `mod_monster_len`/`monster_pick_limit` now gated under `.if
    MONSTER_SPELL_LIST_ENABLED`; the "true off" build measured byte-identical to HEAD. §6, §7.
  - **3 (P1)**: phase 1 now includes the minimal Monster Forge migration (bind `spellIds[0]`,
    preserve `spellIds[1..]`). §8, §12 (test 13), §13.
  - **4**: N=2/N=8 estimates redone for absolute addressing (6 bytes/shift-pair, not 4): 145/163.
    §6.
  - **5**: cycle table redone as a genuine instruction-level count (728 cycles worst case — this
    figure itself did not survive; see the round-2 and round-3 entries below for what replaced
    it). §6.
  - **6**: branch distances and label length recounted for the actual v2 listing (all within ±44
    of a branch; `monster_turn_pick_retry` is 23 characters). §11.
  - **7**: `MONSTER_SPELLS` is config.inc-generated (not hand-defined); `NO_SPELL` is hand-defined,
    separately. §6's listing header comment, the prototype note.
  - **8, 9, 10, 11**: tests 6, 7 (split into two), 9 (renamed from old "8"), 5 rewritten exactly
    per each finding's own correction. §12.
  - **12, 13**: every `grep -rn spellId` hit reclassified (changed / party-only-unchanged /
    comment); the migration story stated once (fixtures stay pre-migration, the generator script
    moves to the new key, loaded-project test mutations use `spellIds`) and applied consistently
    across §5, §9. A fifth monster-side reader (`project.test.js:1947-1956`) added to the table.
  - **14**: the `[1, 3, 1]` example's own explanation corrected (the 1s do not move; only the 3
    shifts). §11, §12.
  - **15**: option (ii)'s "duplicate into all four slots holds the rate" claim corrected — under
    (ii), four copies cast *every* turn; two occupied slots approximate the old rate. §3.
  - **16**: full pricing table added for packed storage, ordered-first, an explicit weight table
    (corrected to 16 bytes, not 12), and the unchosen picking algorithm (high-bits, ~146 bytes).
    The "position-insensitive" claim about `project.spells`/`bt_list` removed and corrected —
    both are genuinely position-sensitive, cited with evidence. §2, §3.
  - **17**: the "only advice function" exclusivity claim corrected — `kernelShortfallAdvice` also
    reads the banked region via `switchableMappers`. `nameFeatures`/etc. generalization specified
    by name; "exact inverse" language removed. §7.
  - **18**: the `bt_tmp2`/`cast_all` contract note corrected — `cast_all` initializes its own
    sentinel; preservation matters during its loop, not before entry, and this design's own
    routine never nests inside that loop. `bt_list`/`bt_len` "dead" timing corrected to after the
    picker's last read, not before it. §6's contract section.
  - **19**: every citation corrected — the item-menu `bt_len`/`inv_count` comment's real
    conditionality; `build_item_list`/`player_hazard` replaced with the genuine two-body precedent
    (`engine/text.asm`'s `text_type_name`); `name_offset_pc` takes its index in A, not X; the
    null-preservation test's real end line (1945, with the omitted reader added separately); the
    tooltip's exact quoted text; `itemPickerOptions`' real distinction (missing vs. intentional
    Nothing); `pick_party_target`'s comment no longer cited as supporting random spell selection —
    §3 now argues the choice on its own merits. §0, §3, §5, §6, §8.
  - **20**: the measurement command is now real, reproducible, and saved (script path + full text
    inline, §6); §14 gained four new explicit questions (pick-first vs high-bits, the `spellIds`
    name, the `battleShortfallAdvice` generalization, the four-select UI shape) that v1 left
    implicit in prose rather than presented as questions.
  - **§0 shrank (182 → 173 raw lines) and this is the one deliberate cut, stated explicitly per
    the "no section shrinks without saying what was cut and why" rule.** Three kinds of v1 §0
    content were dropped rather than carried forward: (1) a paragraph confirming
    `renderer/forges/magic/magic.js` as `renumberSpellDeletion`'s real caller, which added nothing
    a fresh grep this round didn't already re-establish via the `renumberSpellDeletion` citation
    itself; (2) longer inline excerpts of `ROADMAP.md` items 13/14's own surrounding prose,
    replaced with bare line citations since §10 already quotes the operative sentences in full;
    (3) a "grepped, no hits" summary paragraph that finding 12 proved was itself inaccurate (it
    excluded real hits) and whose replacement — the per-hit classification table in §5 — is more
    precise and lives in §5 rather than §0, since that is where a reader needs it. Nothing cited by
    the review findings was cut; every citation the findings named is present and corrected.
  - **§4/§9/§10/§15 were expanded back to at least v1's own length and content in this pass** (the
    coin's own migration-slice pricing, the starters/fixtures verification paragraph, the ROADMAP
    placement recommendation, and the seven out-of-scope bullets respectively). **§2, §5, §7, §8,
    §11 and §13, by contrast, were left as terse back-references to v1 ("unchanged from v1,"
    "unchanged shape," and similar) rather than genuinely restored** — a real defect this v2
    changelog entry should have caught and did not; it is what the v2.1 entry below corrects.
- **v9.2.** Round-1 implementation review (phase 1, post-v9.1), 1 P1 + 2 P2, all in the test plan
  itself — no production defect, byte-identity break, or ledger error. By finding:
  - **1 (P1)**: §5's null-preservation bullet (`:411-420` at the time) proposed rewriting the old
    fixed-point test into a single `[]`-stays-`[]` fixture *and* claimed it would catch a missing
    `!Array.isArray` guard throwing on a missing `spellIds` key — but `[]` is already an array, so
    that fixture can never reach the throw. The bullet is corrected in place to say two fixtures are
    needed: the `[]`-stays-`[]` assertion (kept, tests nothing about the guard) and a second,
    sibling fixture with no `spellIds` key at all (`battle: {}`), which is the only one that can
    exercise it. `test/unit/project.test.js` gained the missing-key test as this finding's own fix.
  - **2 (P2)**: test 9's `rngOn === rngOff` comparison alone cannot distinguish "both consumed one
    draw" from "both consumed two" — a symmetric extra-draw mutation on both sides would satisfy it.
    Fixed by pinning each side to `rngNext(seed)` directly, in addition to (not instead of) the
    existing comparison.
  - **3 (P2)**: tests 3 and 12 checked `mon_spell`'s own emitted bytes but never called
    `battleTableBytes` itself, leaving §12's own OFF-to-ON accounting delta unverified as its own
    assertion. Fixed by adding a paired OFF/ON `battleTableBytes` delta assertion to each.
  - No section's content changed beyond §5's corrected bullet and this entry.
- **v9.1.** Chris answered all nine of §14's open questions on 2026-09-11, accepting every
  recommendation as written. No section's content changed beyond §14's own trailing paragraph
  recording the decision.
- **v9.** Round-8 review, 1 P3: the "both hit and miss paths reach `battle_say_actor`" citation,
  `battleturn.asm:998-1009`, stopped short of the miss path's own `jmp battle_say_actor` at `:1011`
  (`:1009` only stores `bt_dmg_hi`) — corrected to `:998-1011` in all three places it appeared
  (§12's body prose and both the v7 and v8 Changelog entries' own descriptions of that fix); no
  protocol or figure changed.
- **v8.** Round-7 review, 2 P3, both confined to the stop-address paragraph and its own repetition
  in v7's own Changelog entry; no protocol or figure changed. By finding:
  - **1 (P3)**: the MP-spend-before-target citation `battleturn.asm:988-992` was wrong — those
    lines are the affordability branch, the coin, and the initial (pre-subtraction) MP load, not
    the actual subtract/store; the real sequence, and the `jsr pick_party_target` that follows it,
    are at `:992-996`. Fixed in both places this citation appeared: §12's own body prose and v7's
    own Changelog description of that fix.
  - **2 (P3)**: "message queuing only happens inside `cast_spell`" was wrong — a declined cast still
    queues a message: both the hit and miss paths of `monster_turn_attack` reach `battle_say_actor`
    too (`battleturn.asm:998-1011`). Corrected to "no message has been queued at the stop point;
    both the casting and the attack paths reach message queuing afterward," in both places this
    claim appeared. The discard/resume reset rules themselves are unchanged.
  - No section's real content shrank this round; §12, §16 grew from the corrections above.
- **v7.** Round-6 review, 1 P2 + 2 P3 — all three confined to the stop-address alternative's own
  prose and the Changelog's own labeling of it; no protocol or figure changed. Closes round-4
  finding 3. By finding:
  - **1 (P2)**: "the tested monster's own MP is never spent" was wrong for the `REG_SP`-restore
    option — the listing spends `mon_slot_mp` (`:711-714`) before `jsr pick_party_target` (`:715`),
    the identical ordering today's committed engine already has (`battleturn.asm:992-996`, the
    subtract/store and the call itself — corrected again in v8 below, round-7 finding 1: this entry
    first cited `:988-992`, the affordability branch, coin and initial MP load, not the actual
    spend), and restoring `REG_SP` only discards pending calls on the stack, never a RAM write
    already made. Corrected to state a casting trial has already spent MP at that stop point, and
    that the per-trial `mon_slot_mp` reset is required for both alternatives, not only `acc: 0` —
    **no message has been queued at the stop point; both the casting and the attack paths reach
    message queuing afterward** (round-7 finding 2 corrects this entry's own first attempt, which
    said message-queuing "only happens inside `cast_spell`" — `monster_turn_attack`'s own hit and
    miss paths both reach `battle_say_actor` too, `battleturn.asm:998-1011`). §12.
  - **2 (P3)**: §14 stated "every trial also needs a snapshot-and-restore of `REG_SP`" as though it
    were the alternative's one cost, when §12 already specifies two distinct per-trial options with
    two distinct costs — resume to completion (stack unwinds normally, no `REG_SP` surgery, but the
    VRAM reset is still required) or restore a snapshotted `REG_SP` and discard the call (no VRAM
    reset, but the untested stack surgery, and `mon_slot_mp`'s own reset either way per finding 1).
    §14 rewritten to describe both, not one. §14.
  - **3 (P3)**: the stop-address alternative's own fix was mislabeled "round-3 finding 3" in three
    places (§12's own body prose, and twice in §16's v5/v6 entries) — round-3's finding 3 was
    genuinely about the VRAM-queue and formation-initialisation reset (correctly cited elsewhere,
    e.g. §12's own "VRAM-queue reset" paragraph, and left unchanged) and was closed in round 5; the
    stop-address `(REG_PC + 1)` comparison fix was round-**4**'s finding 3, still open through round
    5 and, per finding 1/2 above, still open through round 6 as well. Every wrong "round-3 finding
    3" citation about the stop-address alternative specifically is now "round-4 finding 3"; every
    correct one about VRAM/formation-init is untouched. §12, §16 (the v5 and v6 entries' own text).
  - No section's real content shrank this round; §12, §14, §16 grew from the corrections above.
- **v6.** Round-5 review, 1 P2 + 1 P3, both addressed — **but not completely: round-4 finding 3
  (the stop-address alternative) remained open into the next round too, corrected in v7 below,
  where its own claim here of being fully resolved is retracted.** By finding:
  - **1 (P2)**: the stop-address alternative's two per-trial options are not interchangeable, and
    an earlier pass exempted both from the VRAM-queue reset without distinguishing them — only the
    `REG_SP`-restore-and-discard option (the unfinished action is thrown away, `battle_say` never
    runs) needs no reset; the resume-to-completion option still reaches `battle_say`
    (`engine/battleui.asm:590`) and still queues both packets, so it keeps the reset on the
    identical grounds the recommended `acc: 0` protocol already has one. Also replaced "gains
    nothing" for the resume option with its real, honest advantage: observing `rng` at the
    post-coin stop point while still letting the action finish naturally works for arbitrary
    accuracy and variable-amount spells, which `acc: 0` cannot — the recommendation stands on reuse
    of already-measured, zero-harness-change machinery, not on the resume option having no upside.
    §12.
  - **2 (P3)**: `setup_monsters` clears `mon_slot_alive`/`mon_slot_status` for every slot
    unconditionally, but branches past the `mon_slot_hp`/`mon_slot_max`/`mon_slot_mp` assignments
    for an empty slot (`engine/battle.asm:349-354`) — corrected from "derives … for every slot" to
    naming which three bytes are occupied-slot-only, and which two are unconditional; the empty
    slots' own stale HP/max/MP bytes are never read on any path this harness reaches, so the
    recommended setup itself needed no change, only the description of it. §12.
  - §16's own v5 entry corrected in place: its "all addressed" opening and its inclusion of
    round-4 finding 3 in the closed list were both premature, given finding 1 above — and its own
    round label for that same finding was itself wrong (round-3 instead of round-4), fixed here too
    (round-6 finding 3).
  - No section's real content shrank this round; §12, §16 grew from the corrections above.
- **v5.** Round-4 review, 4 P2 + 1 P3, a fix attempted for each; the harness *protocol* itself
  (comparing at the post-coin boundary) is now accepted — this round is five narrower test-protocol
  defects, not a further protocol change. Closes round-3 finding 4; round-2 findings 2, 4;
  round-1 findings 5, 10, 19. **Round-4 finding 3 (the stop-address alternative — mislabeled
  "round-3" at the time this entry was first written, itself corrected in v6, round-6 finding 3)
  is *not* fully closed here, corrected in v6 below: this entry originally claimed it, but the
  alternative's own VRAM-reset exemption and its "resuming gains nothing" framing were both still
  wrong, caught by the next round's own review.** By finding:
  - **1**: `acc: 0` only closes the *physical-hit* path's own draw and damage — Ember's own cast
    still reaches `apply_damage` (`battleturn.asm:297-298`) and Venom's own cast still writes
    `pc_status` (`:425-433`) regardless of `acc`, so the earlier "structurally cannot" reset
    exemption was wrong and is replaced with a full per-trial initialisation and reset list: a
    one-time setup calling the real `party_init` (`battle.asm:87-109`) and `setup_monsters`
    (`:341-368`) through the harness itself rather than hand-listing derived values, plus a
    corrected note that `combatant_eva` reads a flat, non-level-scaled table
    (`main/build/battletables.js:279`), not a level table as an earlier pass assumed. §12.
  - **2**: `[Ember, Mend, Venom, Ember]` cannot distinguish index 0 from index 3 once the picker's
    own listing overwrites the chosen index with the resolved spell id (`:706`) — replaced with
    four *distinct* flat spells (a new fixture spell, Frost, added to the `mkdtemp` variant, MP
    cost 1) and `mon_slot_mp` corrected to a uniform `4` per trial (not `2`/`3` matching K's own
    number, which does not afford Mend's real cost of 4). §12 (harness intro, test 8).
  - **3**: the stop-address alternative's stopping condition corrected to `(REG_PC + 1) === stopPc`,
    matching the harness's own established convention, not raw `REG_PC`; the nested-call stack
    state it leaves behind (`pick_party_target`'s own return address on top of the stub's) and the
    two ways to close it out (run the suspended call to completion, or snapshot-and-restore
    `REG_SP`) are now specified, and the alternative's own cost in §14 repriced to name that stack
    surgery explicitly rather than calling it "a real, if small, change." §12, §14.
  - **4**: §17 still presented 728 as the operative cross-checked total, contradicting §6's own
    corrected 678/725 a few sections earlier — replaced with the current figures and an honest
    account of which are independently re-derived by a reviewer and which remain this document's
    own reasoning. The v4 changelog entry's own "closes round-2 findings 2, 4 and round-1 finding 5"
    claim is corrected in place, since neither had actually closed. §17, §16 (the v4 entry above).
  - **5**: the `acc: 0` idiom is at `rpg.test.js:3869-3871`, not `:3866` (fixed in the harness
    section and in §14); `battle_say`'s own `bt_timer`/`bt_phase` writes are at
    `engine/battleui.asm:610-613`, not `:606-608`, which is the message-queuing a few lines earlier
    in the same routine. §12.
  - No section's real content shrank this round; §12, §14, §16, §17 all grew from the corrections
    above.
- **v4.** Round-3 review, 9 P2 findings, all addressed in the sense of a fix attempted for each —
  **corrected in v5 below: this entry originally claimed closure of round-2 findings 2 and 4 and
  round-1 findings 5, 10 and 19 that the next round's own review found still open** (round-2
  finding 4 / round-1 finding 5: a stale 728-cycle figure survived in §17, below the corrected
  678/725 this same v4 pass had already landed in §6 — the methodology section was never updated to
  match; round-1 finding 10 / round-3 finding 3: the per-trial reset still omitted party/monster HP
  and status initialisation; round-1 finding 19: the `rpg.test.js:3866` citation, among others,
  was still one line off). What v4 genuinely closed: round-3 findings 1, 2, 5, 6, 7, 8, 9; round-2
  findings 3, 8, 9, 10; round-1 findings 9 (the rejection-threshold half — index observability was
  a separate, later-found defect) and 12, 16. By finding:
  - **1-3 (the harness protocol, one problem)**: `callRoutine`'s own return boundary sits *after*
    the whole action, not right after the coin — `roll_hit`/`physical_damage`/`roll_spell_amount`
    can each draw again downstream, so comparing "`rng` at `callRoutine`'s return" against the
    `pickFirst` oracle's post-coin value was comparing two different boundaries, and the named
    rejection-threshold witnesses (K=2: 199; K=4: 127/198/199) collapse to identical `rng` at the
    full-action boundary even though they genuinely differ post-coin. Fixed with the `acc: 0` +
    flat-spell protocol (every reachable downstream `rng_next` site closed off structurally, all
    eight call sites in the battle system classified — report), an alternative stop-address
    harness extension priced but not chosen, `resolveEngineAddress` (not `addrOf`, which only
    resolves routine labels) specified for every RAM byte these tests touch, and the VRAM message
    queue (`vram_len`, uncapped, never drained without NMI) added to the per-trial reset. §12
    ("The engine harness" rewritten in full), tests 6, 8, 9.
  - **4**: an accepted pick draw costs 38-39 cycles, not the bare 29-cycle `rng_next` call (the
    `sec`/`sbc`/`cmp`/untaken-`bcs` sequence around it was dropped from the earlier count); `mod_
    monster_len`'s general 200-cycle maximum does not occur on the specific K=4 casting path; the
    real reachable maximum there is **678** (seed 135), not 675 (675 was only inside the range, not
    its edge) — 725 remains, explicitly, a conservative bound assuming an unreachable
    retry-then-cast combination. §6, and the v2/v3 changelog entries' own stale 728/675 figures.
  - **5**: §0 still said "four" `renumberSpellDeletion` tests and that line 1950 asserts — corrected
    to five tests, 1950 seeds/1956 asserts (matching §5's own table); the `REG_ACC`/`callRoutine`
    citation corrected to `rpg.test.js:393-394`. §0, §12.
  - **6**: §11's trap 7 restored the "every hit from a whole-codebase grep" overclaim §5 had already
    narrowed — both now say "every consumer of the monster field." §11.
  - **7**: §1 said "verified bias-free"; matched to §6's own "balanced to within one over the
    enumerated states" wording, since 64/63 and 32/32/32/31 are not equal probabilities. §1.
  - **8**: high-bits does not get a shorter mod routine — `lsr a / lsr a` leaves the six-bit
    dividend in the *low* bits, so a six-iteration MSB-first loop would process the wrong bit
    positions; the existing eight-iteration `mod_monster_len` shape already handles any 0-63
    dividend correctly unmodified. §6.
  - **9**: the ordered-first removal range cited a label (`monster_turn_picked`) that does not
    exist in the real listing and started too late — corrected to the true block,
    `monster_turn_have_list`'s own `lda bt_len` through `monster_turn_only`'s own `ldy #0` (30
    bytes, byte-counted), replaced by one `ldy #0`; the checkbox-rejection argument no longer
    invokes priority ordering (option (i), the recommendation, does not depend on list order at
    all) — checkboxes are rejected solely because they cannot represent duplicates. §2, §8.
  - A new §14 question (9) records the stop-address harness alternative for Chris's own sign-off.
  - No section's real content shrank this round; §0, §1, §2, §6, §8, §11, §12, §14, §16 all grew
    from the corrections above.
- **v3.** Round-2 review, 13 P2 findings, all addressed; closes round-1 findings 5, 9, 10, 12, 13,
  16, 19 (the seven that stayed open after v2.1). By finding:
  - **1**: the saved simulator's `maxd` statistic counted only casting paths. Re-run with
    `lfsr-sim2.mjs`, which counts every entry state: pick-first needs up to 2/1/2 pick draws at
    K=2/3/4 (K=4 seed 198: `$FD` rejected, `$8B` accepted, `$67` declines), not "never more than
    1." Both algorithms can need two draws; pick-first's own retries land on decline paths, not
    casting ones — the corrected trade-off (reason 2, reused arithmetic, is now the decisive
    reason, not draw count). §2 (pricing table), §3, §6 (algorithm-choice section rewritten), §14
    Q4. Closes round-1 finding 9's remaining half together with finding 9 below.
  - **2**: `mod_monster_len`'s real maximum is 200 cycles including `jsr`, not 203 — its first
    iteration cannot subtract (the remainder is 0 or 1 after one shift, always less than a divisor
    ≥ 2). The "one rejected pick draw, then the coin passes" path is unreachable at K=4 for this
    LFSR (every retry-needing state's coin declines, per `lfsr-sim2.mjs`), so 728 no longer stands
    as "worst case" — replaced with a reachable-casting-path figure this round computed as 675
    (falling inside the reviewer's own independently-computed 662-678 range, but — corrected the
    following round, round-3 finding 4 — not itself the maximum: an accepted pick draw is 38-39
    cycles, not the bare 29-cycle `rng_next` call, and the real reachable maximum on this path is
    **678**, at the top of the range, not 675 inside it), with the naive unreachable-combination
    sum (725) kept only as an explicitly-labelled conservative bound. §6.
  - **3**: test 8 asserted only aggregate cast counts, which a wrong `monster_pick_limit` (`255,
    255, 255`) survives identically at every K while changing `rng` on exit for real seeds (K=2:
    199; K=4: 127, 198, 199 — named explicitly). Test 8 rewritten to assert per-seed
    cast/decline, chosen index, and exit `rng`, for all 255 seeds at each K, against a table
    generated the same way `lfsr-sim2.mjs` computes it. §12 test 8. Closes round-1 finding 9.
  - **4**: `boot`/`tap`/`chooseCommand` advance whole frames and cannot expose an instruction
    boundary inside the battle bank's own brief mapping window. A new "The engine harness"
    subsection specifies the existing `selectBattleBank` + `callRoutine` harness precisely: why
    `monster_turn`'s own `jmp`-chain still returns correctly through `callRoutine` (no trampoline
    needed, verified by reading `battle_say`'s own `rts` at `battleui.asm:614`), what "exit" means,
    and what must be reset per trial. Tests 6, 7, 8, 9 rewritten against it. §12. Closes round-1
    finding 10's boundary-protocol half.
  - **5**: the exact `[id, $FF, $FF, $FF]` padding assertion, dropped somewhere between v1 and v2,
    restored as its own test (11), since the table-size check (now test 12) cannot see `$00`
    substituted for `$FF`. §12. Closes round-1 finding 10's remaining half.
  - **6**: packed storage repriced comparing totals with totals (fixed-stride 16 vs packed 9), with
    a 1-byte-offset pool cap and a priced 2-byte-offset alternative for the uncapped case.
    Ordered-first repriced from ~127 to ~99 bytes (the pick-retry/mod-call selection block itself
    also goes, not only the 26-byte helper pair), carried into §14 Q2. §2, §14. Closes round-1
    finding 16.
  - **7**: §9 no longer says the exact-damage tests "stay written exactly as they are" (which
    contradicted §5's own migration requirement) — their scenarios and expected outcomes are
    unchanged, only their field assignments migrate to `spellIds`. §9.
  - **8**: the reader table's "every reader" claim narrowed to "every consumer of the monster
    field," with the omitted party-only hits (`shared/project.js:5078-5083`, `character.js:
    205-235`, `tools/make-rpg-save-sample.js:288`, `test/unit/starters.test.js:1760`) added and a
    reproducible (if not self-sorting) grep command given. §5. Closes round-1 finding 12.
  - **9**: "mod-K only reads the low bits" is false for K=3 — dropped; the correct bit-7/bit-0
    explanation (via `$71`'s own bit 0) is kept, and the exhaustive counts are now described as
    "balanced to within one over the enumerated states," not as a proof of independence. §6.
    Closes round-1 finding 9's explanatory half (the mechanism itself was already fixed at v2).
  - **10**: `build_spell_list` has no conditional portion at all (only `build_item_list` does);
    `text_type_name`'s enabled body runs 369-398, `.endif` at 399, the opposite `.if` at 400, not
    399; the `project.test.js` reader table split into its real five monster-side tests plus the
    party-only test (1905-1923) that sits between them and is not part of this migration at all.
    §0, §5.
  - **11**: the `[1, 3, 1]` example is test 10, not test 9 (test 9 is RNG identity and asserts
    nothing about deletion or damage); §9's own damage-distinguishing technique is now described
    as an action-boundary HP delta any test can use, not a round-total claim attached to a
    specific test number. §6 (register contract's own trap-6 cross-reference), §9, §12.
  - **12**: "two Ember casts, since one subsequent Venom cast then exhausts it to 2" was backwards
    arithmetic (`8 − 3 − 3 = 2`; a further Venom cast would zero it, not land on 2) — fixed to
    state the two Ember casts alone reach 2. §12 test 6.
  - **13**: a future `$80`-threshold cast rate would give a *similar distribution* to today's
    parity coin, not *identical per-seed behaviour* — `battleturn.asm:989-991` tests bit 0, not a
    byte-vs-threshold comparison, and the two tests disagree on specific seeds. §4.
  - No section's real content shrank this round; §2, §3, §5, §6, §9, §12, §14 all grew from the
    restorations and corrections above; every renumbered test cross-reference (§8, §13, and this
    Changelog's own v2.1 entry) was updated to match §12's new numbering (a new test 11 inserted,
    shifting the former 11-14 to 12-15).
- **v2.1.** Restored the passages v2 had replaced with back-references to v1 in §2 (the three
  option descriptions in full, the `RPG_LIMITS.monsterSpells` single-writer paragraph), §5 (the
  `spellIds` naming rationale, the migration precedent sentence, the `renumberSpellDeletion`
  doc-comment quote, the four test-rewrite bullets), §6 (the `bt_list`/`bt_len` liveness proof's
  full form, the termination note's full mechanism), §7 (the gating-predicate precedent, the
  per-fixture "When OFF" enumeration, the "When ON" same-label argument, the `kernelbytes.test.js`
  citation for the no-kernel-lo-term claim), §8 (the four-select collapse example, the `Learns`
  rejection in full, the smoke-block assertions — plus the phase-1 minimal-migration behaviour,
  which §8 now owns alongside §13), §11 (every trap's own closing mechanism, not just its
  finding-number), and §13 (the phasing intro's "silently ignored, worse than not existing"
  reasoning and phase 2/3's own bodies). Also rewrote test 6 (§12) so its assertion genuinely
  distinguishes option (i) from option (ii) by a per-seed outcome (64 of 255 seeds diverge; seed 1
  is a named witness), rather than by an observed outcome set both algorithms satisfy. No figure or
  finding changed from v2: `MONSTER_SPELL_LIST_BATTLE_ALLOWANCE = 153` stands, and the headroom
  contradiction (`3282` quoted then immediately corrected to `3276` in the same sentence) is fixed
  to read `3441 → 3276` (MMC1/UNROM512) and `3395 → 3230` (MMC3) in one place, §6's own measurement
  table, not restated at a different value anywhere else in the document. Every remaining "v1"/
  "v2"/"unchanged" reference outside this Changelog and §0's one-line note that `lfsr-sim.mjs` was
  re-run has been removed or rewritten so the document stands on its own.
- **v1.** Nothing to record — the first round.

## §17. Places a claim could not be pinned to a line and was reasoned instead

- **§6's cycle-cost table** is a hand-counted estimate against this engine's real (absolute-
  addressing) opcode timings, not an emulator-measured trace. The scan-loop figure (251) was
  cross-checked against the reviewer's own independently-computed figure (exact match) from the
  round this cycle table was first built; the corrected reachable maximum, **678** (seed 135, the
  K=4 casting path), and the conservative bound, **725**, are both figures the reviewer
  independently re-derived and confirmed in the round that fixed them (not merely accepted from
  this document) — `mod_monster_len`'s own 200-cycle maximum is independently confirmed the same
  way. The 728-cycle figure an earlier pass in this document's own history used is dead; it is not
  restated here as even an estimate, only in the Changelog's own historical entries, explicitly
  marked superseded.
- **§6's N=2/N=8 code-byte estimates (145/163)** are reasoned from the exact opcodes that differ by
  N, cross-checked against the pattern the reviewer's own sanity-check figures established for the
  pre-finding-1-fix baseline (139/147/157), not built and measured directly.
- **The packed-storage (c) and ordered-first-affordable extra-code estimates (§2)** are reasoned
  from counting which existing instructions/tables a simpler or differently-shaped routine would
  and would not need, not built.
- **The high-bits alternative's ~146-byte estimate (§2, §6)** is reasoned from the specific
  instructions it would add or remove relative to the measured pick-first prototype (one fewer
  park/recover pair, a cheaper draw instruction), not built and measured directly this round.
- **The claim that a party member carries no `weak`/`strong` field at all (§9)** is drawn from
  reading `sample-rpg/party.json` directly and from `spell_damage`'s own comment "elements only
  describe monsters" — not from a schema file stating this as a rule in so many words.
