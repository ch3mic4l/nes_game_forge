# Reference: The battle system

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

### The battle system

An RPG's battle system lives in a **switchable PRG bank**, not the fixed kernel — the kernel had
about 2 KB spare and the battle system is over 3 KB of code plus its tables. `codeRegions()` in
`shared/cartridge.js` takes one 8 KB region off the front of the switchable window (after
`chrPayloadRegions()`, so the two claims on that window cannot collide), and `screenRegions()`
skips it. That is why **an RPG needs a mapper with PRG *and* CHR switching** — `rpgCapable()` is
the single writer for that, consulted by the schema, the Build panel and `reconcileCartridge`.

**`call_battle` in `engine/banks.asm` is the only cross-bank call in this codebase, and the only
one there may be.** `player.asm` dereferences `mtptr` out of the switchable window every single
frame, so the trampoline ends with `jmp set_screen_ptr` — the restore *is* the return; forgetting
it leaves the game reading its map out of the battle system's code, with no crash and no obvious
banking bug. `banked.test.js` asserts the restore. The trampoline has nine entry points: the
original four (`BE_INIT`, `BE_TICK`, `BE_JOIN`, `BE_RESTORE`) plus five more added for in-game
party-member naming (`BE_NAME_BEGIN`, `BE_NAME_TICK`, `BE_NAME_DRAW`, `BE_NAME_SELECT`,
`BE_NAME_CANCEL` — `engine/constants.asm:896-900`), below. `BE_JOIN` was the first entry point used
*on the field* (the script's Join command recruits mid-conversation, so the restore matters most
there — the frame it ran in still has a map to draw), and is no longer the only one:
`script_op_join_call` (`engine/script.asm:422`) calls `BE_NAME_BEGIN` right behind it for a named
Join, and the other four `BE_NAME_*` arms run on the field too, through the `ui.asm` shims below,
while that Join's naming session stays open. `BE_RESTORE` runs at load time
(`engine/save.asm`), recomputing `pc_spells` from the restored level, not trusting the save's
own possibly-stale bitmask. Unlike `BE_JOIN`, this restore is masked by its caller:
`continue_game` ends `jmp redraw_screen`, re-running `set_screen_ptr` regardless of whether the
trampoline exit succeeded.

**In-game party-member naming (`engine/nameentry.asm`, docs/design-name-entry.md) is one source
assembled in exactly one of two placements, never both.** On an RPG (`NAME_ENTRY_BANKED` true, the
same `battleBankEnabled` fact `BATTLE_ENABLED` itself reads) it is `.include`d from `battle.asm`
and reached through the five `BE_NAME_*` arms above; on an action project it is `.include`d from
`engine/main.asm` instead and reached by a plain `jsr`, since there is no battle bank to hold it
in. Five kernel-lo shims in `engine/ui.asm` — `name_begin`/`name_tick`/`name_draw`/
`name_select`/`name_cancel`, each an `.if NAME_ENTRY_BANKED` / `.if !NAME_ENTRY_BANKED` pair —
keep every real call site (from `boot.asm`/`title.asm`, `text.asm`'s naming arm, `input.asm`'s
confirm/cancel actions, and `ui.asm`'s own `draw_ui`) textually identical regardless of
placement — the same shape `switch_prg_bank`'s own mapper-family dispatch uses to keep call
sites mapper-agnostic; `docs/design-name-entry.md` has every shim's exact call site.
A live `{name}` Say token pays no placement cost of its own: `text_type_name`
(`engine/text.asm`) is kernel-lo on every board and both game types, reading `pc_name_ram` slot 0
directly.

**`BE_JOIN`'s operand is guarded**, matching `party_init`'s own twin guard on the same access:
`battle_entry_join` (`engine/battle.asm`) does `cpx #PARTY_SIZE` / `bcs battle_entry_join_skip` —
`rts` back to `call_battle`. `NO_MEMBER = $FF` is defined once per side, beside `NO_ACTOR`/
`NO_ITEM`; the compiler emits it for `null` since `byte(null, 3)` coerces `null` to member 0. One
compare refuses both the sentinel and a stale index; `rpg.test.js` patches a built ROM's operand to
`$FF` and to exactly `PARTY_SIZE`, with a seeded `pc_hp_max` byte catching a mis-branch into
`party_restore`.

The split is: `engine/rpg.asm` in the kernel (the RNG, the step counter, assembling a formation),
everything else in `engine/battle.asm` + `battleui.asm` + `battleturn.asm` on the far side.
Calling *out* of the bank is free — the kernel is permanently mapped — so the battle system uses
`vram_open`/`vram_push`, `draw_metasprite` and `add_item` directly.

**That region has a capacity check, and unlike the kernel's it is exact.** Nothing bounded it
until `battleRegionBytes`/`battleRegionCeiling` (`main/build/battletables.js`) — overflowing it
used to surface as raw nesasm output attributed to whatever line fell past the end, which this
codebase refuses to show a user. The budget lives beside the tables it sizes
rather than beside `kernelCodeBytes`: `generate.js` reaches for `node:fs`, so the renderer can't
import it, and the Build panel's meter would need a second copy of the arithmetic — the drift this
check exists to prevent, one layer out. `battletables.js` imports only from `shared/` and must stay
that way; `renderer/forges/build/build.js` importing it is the same move
`renderer/forges/sound/sound.js` already makes with `main/build/songcompile.js`.

`BASE_BATTLE_CODE_BYTES_BY_MAPPER` is per board (UNROM 512 3839, MMC1 3839, MMC3 3879), measured
directly rather than reconstructed from a running fix history — the same mistake
`BASE_KERNEL_CODE_BYTES_BY_MAPPER` had to undo, and re-measured again by the zero-page kernel diet
(`docs/design-kernel-diet.md`) for the same `<`-prefix reason every other figure in this file moved.
`battle_status_dispatch`'s `combatant_alive` guard and `bt_wipe_mask`'s staggered-death queueing
(see that array's own comment in `engine/constants.asm`) are folded into this figure. MMC3's extra
40 bytes are the `.if SPLIT_ENABLED` blocks inside the region itself (`battle.asm`'s split arm,
`battleui.asm`'s sprite targeting cursor), and need **no** separate conditional term the way
`SPLIT_KERNEL_ALLOWANCE` does: this region exists only for an RPG, so there is no MMC3-RPG-without-
the-split to overcharge. Every board that can reach the region has its own measured entry, because
`codeRegions()` hands back nothing unless the project is an RPG and needs `rpgCapable()`; the
fallback in `baseBattleCodeBytes` stands in for no real board, existing only so an unmeasured one
can't make the budget `NaN` and silently stop the refusal firing. `test/unit/bankedbytes.test.js`
asserts it is unreachable.

**A different board can help here, which is the opposite of how it first reads.** The ceiling never
moves — every RPG-capable board gives this region the same 8 KB — but the stock code inside it does,
and MMC3 spends 40 more bytes of it. So an MMC3 project over by 1 to 40 bytes fits unchanged on MMC1
or UNROM 512, and a flat "changing mapper does not help" is false advice in exactly the band where
advice matters. `battleShortfallAdvice` *computes* the claim and only makes it when no candidate
fits.

Which boards are candidates is `switchableMappers` (`main/build/generate.js`), extracted from
`kernelShortfallAdvice` so both answers to "would a different mapper fix this?" share one place.
**It asks the authorities rather than restating their rules** — a hand-written filter chain would
have to independently track art in the tilesets' `$A0-$FF` (only a scanline-IRQ board leaves that
range to the author), sprite tile `$FD` (a split-font board reserves it for the battle targeting
cursor, so *entering* MMC3 can break a project too), and a monster's battle-art block running past
`$A0` (an error off MMC3 even when the tileset's own upper slots are empty) — the sign of a rule
that should not be a list. So there are two questions instead: does `reconcileCartridge` change
the project (if so, the switch silently costs a tileset or a mirroring choice, invisible to every
other check), and would the result still build — `validateProject` for every content rule at
once, plus the three capacity questions it does not own: screens, kernel-lo and the banked code
region. Errors are compared before against after, not merely counted, so a candidate is never
rejected for an error it merely inherited, unrelated to the switch.

**No board is offered at all to a project carrying hand-written 6502.** Two of the three fit
checks read models of stock code — `kernelCodeBytes` measures the stock kernel, `battleRegionBytes`
the stock battle system — and a Code Forge override replaces one of those files, while even a
plain user file lands in kernel-lo through `assets/usercode.inc`. A candidate could save
enough *modelled* bytes to pass while the real code still overflows — the same guess this codebase
refuses to make about user code, here aimed at the mapper select instead of a byte count.
Withholding degrades gracefully — the feature- and content-removal advice stays true either way —
and closes the same overclaim `kernelShortfallAdvice` had first.

The exactness is worth keeping, with one qualification. `kernelCodeBytes` must over-estimate — it
shares its bank with lookup tables it models by hand — but this region has two occupants, and
`battleTableBytes` counts the second off `battleTables`' own emitted output rather than modelling
it, so that half can't drift. The other half — the stock engine code — is a
hand-measured constant like any other: **exact today, held so by the equality assertion in
`bankedbytes.test.js`, not by construction.** Across five table-varying variants on all three
boards, `base + battleTableBytes` equals nesasm's reported usage **to the byte** — why the test
asserts equality, not a margin band, and why `BATTLE_SLACK` buffers stock-code growth rather than
an estimate's own error.

**`battleTables(project, battleStrings = BATTLE_STRINGS)` and `battleTableBytes(project,
battleStrings = BATTLE_STRINGS)` both must accept the injected list, and `battleTableBytes` must
forward it into `battleTables`** (`main/build/battletables.js:608`) rather than calling it with the
default — the defect round 2 of the name-stride review found: a version still calling
`battleTables(project)` with the default let an injected list's real emission and its size
counter disagree, exactly what this region's exactness discipline exists to prevent. The default
path is byte-identical to before either parameter existed. See `docs/namestride-report.md` for
`checkBattleStringsCapacity`, the generator guard this parameter lets be exercised through
`battleTables`' own call site (`test/unit/bankedbytes.test.js`).

**Exact for the *stock* battle code, and that qualifier is load-bearing.** A Code Forge override
of `battle.asm` — or of `battleui.asm`/`battleturn.asm`, which it includes — is hand-written 6502
whose assembled size can't be known from its text, so the base term becomes a measurement of
a file no longer assembled. `battleCodeOverridden` is the single predicate for that. The Code
Forge's own hand-written-code rule (above) cuts **both** ways here too. So an override project is
not refused on the stock base at all — that would turn away someone's *smaller* battle system for
the engine's larger one — it is
checked against the one bound an override cannot move, the generated tables alone; past that the
assembler answers, with the `.fail` below as the backstop. The advice changes with it: a reduction
that would close an exact deficit is only "the least that could fit" when the base is unknown, and
no board can be said to fit either.

**Overriding `main.asm` is a weaker guarantee again**, its own predicate
`battleRegionPlacementOverridden` / `BATTLE_REGION_PLACEMENT_SOURCES`: a custom `main.asm` can put
the tables `battle.asm`'s override leaves in place somewhere else entirely, or nowhere, so **no
capacity refusal is raised at all** in that case — the meter still shows the stock-based figure,
under a hint saying which number it is.

**The `.fail` in the generated `assets/code.inc` bounds where an override of `battle.asm` ends up,
not whether nesasm accepted it, and cannot close every escape even together with
`checkCapacity`'s own text-scan warning (`battleRegionRelocates`).** nesasm's per-byte bank check
already catches an override simply too big; the `.fail` exists for what that check can't see — an
override that *relocates* with its own `.bank`/`.org` and finishes outside the region, which
nesasm accepts with exit 0 while battle code is silently written over screen data or the kernel.
`battleRegionRelocates` is a text scan for a relocation-shaped pattern, not a size guess,
so it can both miss one reached through `.include`/a macro and flag one that isn't real.
See `docs/design-battle-region-guard.md` for the empirical proof two specific relocations get past
both mechanisms together, and why the guard is emitted into the generated file, not
`engine/main.asm`.

**When 8 KB genuinely runs out — a note, not something to do now.**
`codeRegions(mapper, tilesetCount, bankedCode)` already hands back two adjacent regions for
`bankedCode = 2`. Regions alternate `{prgBank, org:$8000}`, `{prgBank, org:$A000}`, so the two are
**co-mapped** — both live at once, one 16 KB switch — only when the slice starts on an even index:
`chrPayloadRegions().length`, 0 on the CHR-ROM boards but `max(1, tilesetCount)` on UNROM 512 —
the `max` makes a zero-tileset project *not* co-map despite zero being even. Checked rather than
reasoned: UNROM 512 co-maps at tileset counts 2 and 4, not at 0, 1 or 3; MMC1/MMC3 always co-map.
Anything relying on this must check, not assume.

Not everything the battle bank writes needs the bank switched in to *read*: `pc_hp`, `pc_hp_max`
and `pc_in_party` (`$0398+`) are plain kernel RAM like any other engine array, so `rpg.asm`'s
`party_heal`/`party_damage` — the field's `Heal`/`Damage` commands, on an RPG build — touch them
directly rather than growing `call_battle` a fourth entry point for what is, on this side, only a
saturating loop over four bytes.

Three shapes worth keeping:

- **Combatants are one index space**: 0-3 party, 4-7 monsters. `turn_order`, targeting, the cursor
  and "is this one still standing" are each one routine, not two that must agree — letting a
  monster cast the same spells the party does: `cast_spell`, `cast_heal` and `cast_all` all take
  either side, `other_side` deciding who a group spell reaches.
- **The `combatant_*` lookups preserve X and Y and return through `bt_ret`**, since they're
  called from loops that own those registers, and restoring a
  register sets the flags, so the answer must be reloaded last.
- **Status effects are independent bits, ticked by the message flow.** `pc_status`/`mon_slot_status`
  carry them — `STATUS_POISON`/`STATUS_BURN` (`engine/constants.asm`), set by `ora` so casting one
  never erases the other. Once the actor's own line is dismissed, `battle_message_done` dispatches
  the tick via `status_pending`, lowest bit first, one tick and line per bit, before the turn
  advances. No status survives past the battle that gave it: `battle_begin`/`battle_end`
  (`engine/rpg.asm`) zero the array on entry and on a normal exit, and `init_session`
  (`engine/combat.asm`) covers the loss path, since `battle_finish` jumps straight to `player_died`
  and skips `battle_end`. A heal or potion cures everything at once, mid-battle. See
  `docs/design-status-effects.md` for the dispatch mechanism and what a third status would need.
- **A spell's amount is a range, not a fixed number**: `amountMin`/`amountMax` in the schema,
  `spell_amount_min`/`spell_amount_n`/`spell_amount_limit` (`main/build/battletables.js`) in ROM,
  rolled by `roll_spell_amount` + `mod8` (`engine/battleturn.asm`) — a draw rejected at or above
  `spell_amount_limit,x` keeps the accepted range uniform, not masked-and-biased.
  `spell_amount_n,x == 1` reads byte-for-byte as the old flat `spell_amount,x` and draws no RNG, so
  a migrated project replays identically. Both routines run inside `cast_all`'s own per-target
  loop, so `bt_tmp2` — that loop's own end-of-side sentinel — must survive untouched across the
  whole `spell_damage` → `roll_spell_amount` → `mod8` chain; the regression guard is an
  RNG-state assertion in `test/unit/rpg.test.js` (two living monsters must take different damage
  from one all-target spell), narrower than it looks: it catches a stray extra `bt_tmp2` write a
  pure damage-number check would miss.

Anything the engine would need a multiply for is a table instead: `main/build/battletables.js`
precomputes per-level stats and the experience curve, and pads every name to `RPG_LIMITS.nameLength`
so the engine needs no length byte. `ACTOR_BATTLE_DEFAULTS` (`shared/project.js`) is the single
writer for every plain-number default in an actor's battle record, read by `normalizeActor`,
`battleTables` and the Monster Forge alike -- because a never-saved actor built in-session must
compile identically to the same project reopened.

**The RPG battle ITEM menu does not list everything `use_item` can spend.** `build_item_list`
(`engine/battleui.asm`) filters the bag to `kind == heal AND amount > 0` — exactly what
`item_chosen` can apply consistently — so a `damage`-kind item, or a `heal`-kind item at `Amount`
0, is a real, valid item for Give/Take/Carrying/drops but never a selectable row here.
`battle_menu_item` gates on the *filtered* list length, not raw `inv_count`, building the list
first so the gate sees the real count: gating from `inv_count` alone would open an empty list
whose row-select code indexes a stale entry and whose Up press underflows to `$FF`.
`build_spell_list` needs no such ordering — a spell's own membership test (`pc_spells`, a
bitmask) already is what building the list applies, so gating before building can never disagree
with it; items introduce a second, independent filter `inv_count` knows nothing about. The
`ITEMS_ENABLED`-false path keeps both routines byte-for-byte as they were, since that
economy has no `effect` field to filter on.

**Two capacity terms follow the item's own kind/amount reader into their respective banks, both
item-conditional and both flat across boards** (see "The kernel budget" above for why a term earns
its own name only once real variance is measured). `ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE`
(`main/build/generate.js`) is `use_item_apply`'s own kernel-lo cost, split by *game type*, not
board — because `BATTLE_ENABLED` picks a differently-sized damage branch
(`party_damage` vs `lose_hearts`), not because any board differs: 61 bytes for an action project,
59 for an RPG. `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` (17 bytes, `main/build/battletables.js`) is
`build_item_list`'s and `battle_menu_item`'s combined cost in the banked battle-code region,
uniform across all three RPG-capable boards since neither routine branches on `SPLIT_ENABLED` — its
own line beside the base, not folded into it — avoiding the mistake
`TITLE_KERNEL_ALLOWANCE_BY_MAPPER` already had to undo, charging every project a cost only
`ITEMS_ENABLED` builds pay.

**A monster's own spell list** replaces the old single `mon_spell` byte with an N-stride table,
gated on `projectUsesMonsterSpellList` (some actor's `battle.spellIds` has two or more entries — a
one-entry list assembles byte-identical to before, why all six fixtures stay off; `sample-rpg`'s
Snake carries exactly one). `MONSTER_SPELL_LIST_BATTLE_ALLOWANCE` (125, flat on every RPG-capable
board, `main/build/battletables.js`) is the banked-region cost; the table keeps the old `mon_spell`
label so the off-path `monster_turn` body (`engine/battleturn.asm`) reads it unchanged. On,
`monster_turn` picks uniformly among affordable entries, duplicates weighting them, before the
existing cast-or-attack coin flip — pick-first (`docs/design-monster-spell-list.md` §6). The
Monster Forge's four selects collapse to `spellIds` from the store's own array, never the other
selects' DOM values, since a stale id renders as `Nothing` and reading it back would drop it.

`BATTLE_ANIM_BATTLE_ALLOWANCE = 264` (`main/build/battletables.js`; 243 plus the 21-byte
follow-the-walker block in `battle_fx_draw`, one name because both share one gate) charges
`battle_fx_arm_at`/`arm_attack`/`tick`/`draw`, gated on `projectUsesAnyBattleAnimation`
(`BATTLE_ANIM_ENABLED` — an actor, spell OR party reference; the same broad predicate gates the
`mon_anim_attack`/`spell_anim` tables, or a party-only build would reference a table that does
not exist), flat on MMC1/MMC3/UNROM 512, per `bankedbytes.test.js`.
`bt_fx_anim`/`slot`/`frame`/`timer` (`engine/constants.asm`) hold the effect; `setup_monsters`/
`battle_message_done` reset only `bt_fx_anim`, to `NO_ANIM` (both gated) — `battle_fx_arm_at` sets
the slot and zeroes frame/timer on arm. `battleFxOamRoom`
(`shared/project.js`, below) is the complement: room left for the effect, not the overflow check.

**Phases 2a (hit feedback) and 2b (MISS)** are independent RPG-only toggles. `bt_hurt_slot`/
`bt_hurt_left` (`BT_HURT_FRAMES = 20`) and `bt_miss_slot`/`bt_miss_left` (`BT_MISS_FRAMES = 30`)
chain unconditionally after `bt_fx_timer` (`engine/constants.asm`); only their countdowns, not the
slot bytes, are reset in `setup_monsters` (`engine/battle.asm`) — which half of hit feedback
applies, sprite blink or attribute flash, is decided at read time from `bt_hurt_slot`.
`project.rpg.hitFeedback`/ `project.rpg.miss` gate `HIT_FEEDBACK_ENABLED`/`MISS_ENABLED`
(`generate.js`) via `projectUsesHitFeedback`/`projectUsesMiss` (`shared/project.js`,
`gameType === 'rpg'`), each independent of `BATTLE_ANIM_ENABLED` and
of each other. `HIT_FEEDBACK_BATTLE_ALLOWANCE = 235` charges
`battle_hurt_arm`/`battle_hurt_attr_open`/`battle_hurt_tick`/`battle_hurt_restore_slot` plus the
blink-skip checks in `battle_sprite_pc`/`battle_sprite_mon` and their call-site insertions;
`MISS_BATTLE_ALLOWANCE = 134` charges `battle_miss_arm`/`battle_miss_tick`/ `battle_miss_draw` plus
their call-site insertions (`main/build/battletables.js`). Both are flat on MMC1/MMC3/UNROM 512,
equality-asserted by `bankedbytes.test.js` (which also proves neither pulls in the other's
symbols); both live sum to 369, each toggle's own reset paying its own load. `MISS_TILE_M/I/S =
$FA-$FC` (`shared/font.js`) have two independent consumers of `projectUsesMiss`: `generate.js`
stamps the art into every tileset's build-time sprite table, and `shared/project.js`'s
`spriteReservedRanges` reserves the same range — neither runs on `HIT_FEEDBACK_ENABLED` alone.
`battle_miss_draw` (`engine/battleui.asm`) reads `miss_tiles` to draw M I S S as four OAM entries,
`MISS_OAM_TILES = 4`, charged to `battleSpriteBudget` and subtracted from `battleFxOamRoom`.

**Phase 3, the Magic/Monster Forge preview canvas, is renderer-only** — no engine code, generated
byte, schema field or save-format change; the six-fixture ROM gate plus a six-variant `sample-rpg`
matrix on MMC1/MMC3/UNROM 512 (`docs/design-battle-animation.md` §15.7) prove it. `battleFxOamRoom`
(`shared/project.js`) is the single writer of the fit figure `battle_fx_draw` checks against — the
complement of `battleSpriteBudget` (which asks whether the project overflows 64 sprites; this asks
how much room the flipbook has left). `generate.js` calls it as the local `battleFxRoom` to avoid a
same-named-import TDZ `ReferenceError`; the preview widget (`renderer/widgets/battlefxpreview.js`)
calls the identical export, and `battleanim.test.js` pins both to hardcoded, pre-extraction
figures. `renderer/widgets/battlefx.js` is the pure, DOM-free model; `battlefxpreview.js`'s
`mountBattleFxPreview` is its DOM wrapper, shared by the Magic, Monster and Character
Forges. `battleFxBounds`
lives in the DOM-free file, not the wrapper, since its own unit tests (§15.7) run under plain
`node:test`.

**A party member's attack visual** (ROADMAP 14.5,
`docs/design-battle-animation.md` §16) adds `project.party[i].attackAnim`, compiled to
`pc_anim_attack` behind `PARTY_ATTACK_ANIM_ENABLED`
(`PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE = 10`); the acting party member walks forward (both RPG fixtures
re-pinned).
