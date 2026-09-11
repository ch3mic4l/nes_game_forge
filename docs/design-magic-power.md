# Design: magic power and magic defence — caster and target stats for spell damage and healing — v7

Chris asked for a "magic power" stat by name when the Character Forge was designed.
`docs/design-character-forge.md` §5 (`:392-419` at HEAD) records that no such stat exists anywhere
in the compiled battle math — `roll_spell_amount`/`spell_damage` roll strictly from the *spell's*
own `amountMin`/`amountMax`, never from a caster stat — and defers a real one to later, sketching in
one paragraph what it would need. Chris then decided (2026-09-09) that it is a later engine slice of
its own, after in-game name entry ships. Name entry shipped in full (phases 1-6, HEAD `eab9eb0`), so
this is that slice's design round.

This document specifies: a new per-party-member stat (`baseMag`/`magPerLevel`, the identical shape
`baseAtk`/`atkPerLevel` already has) and a new per-actor `battle.mag`; a new `combatant_mag` routine
in the banked battle region, mirroring `combatant_atk`/`combatant_def` exactly; a saturating add of
that stat into a spell's rolled damage or heal amount, before the elemental modifier; the capacity
ledger's own new banked-region term for it, measured — not estimated — as `nesasm`'s own real
assembled-size output from an actual build, rather than a hand-counted byte guess; and the UI, starter
and test-plan consequences of all of the above.

## §0. What was read to write this document (HEAD `eab9eb0`; magic defence added at HEAD `14e9cbc`)

**Where the request and the gap are recorded.** `docs/design-character-forge.md` §5 (`:392-419`):
"No such stat exists anywhere in the compiled battle math" — checked there directly against
`engine/battleturn.asm`, not inferred from the schema; its own one-paragraph sketch names
`baseMagic`/`magicPerLevel` and "a new multiplier term... a multiply-by-stat the 6502 cannot do
natively, so it would need a table." This document departs from that sketch's multiplier framing —
§2 below explains why a per-spell × per-caster product genuinely cannot be a table the way a
per-level curve can, and recommends an add instead.

**The spell damage and heal path.** `engine/battleturn.asm`: `cast_spell` (`:280-301`, dispatches on
`spell_kind,x` — `SK_POISON`/`SK_BURN`/`SK_HEAL`/anything else falls to the single-target damage
case, `spell_scope,x` non-zero routes to `cast_all`), `cast_all` (`:305-324`, loops every living
combatant on the caster's other side, `bt_tmp2` holding its own end-of-side loop bound across the
whole `spell_damage`/`apply_damage` call chain), `cast_heal` (`:328-372`, `ldx bt_arg / jsr
roll_spell_amount / sta bt_tmp`, then adds `bt_tmp` into `pc_hp,x` or `mon_slot_hp,x` with a
`bcs`-then-`cmp` clamp to the max, curing the caster's own status on the way), `cast_poison`/
`cast_burn` (`:379-…`, confirmed this round to call `poison_target`/a flat `#POISON_DMG`/`#BURN_DMG`
store — never `roll_spell_amount`, never a caster stat; `grep -n "POISON_DMG\|BURN_DMG"` on this file
finds exactly two hits, at `:510` and `:524`, both flat `lda #CONST`), `physical_damage` (`:607-635`,
`combatant_atk(bt_actor) - combatant_def(bt_target)`, floored at 1, plus a 0-3 noise roll, saturating
at `$FF` — the shape a caster stat mirrors), `combatant_atk`/`combatant_def` (`:637-658`, `:660-681`
— A = combatant index in, A = the stat out, X/Y saved to `bt_x`/`bt_y` and restored, answer staged in
`bt_ret` and reloaded last so the flags describe the answer, not the register reload — the "a routine
returning a value must set the flags from that value" trap, CLAUDE.md), `roll_spell_amount`/`mod8`
(`:690-729`, comment at `:683-689` — X = spell index, preserved; Y and `bt_tmp` clobbered; `bt_tmp2`
never touched, because `cast_all`'s own sentinel lives there across this entire call chain),
`spell_damage` (`:733-774` — rolls into `bt_dmg_lo`/`bt_dmg_hi`, then, only for a monster target,
applies the weak/strong element multiply; reloads `X` from `bt_arg` at `:746` because the monster-slot
lookup at `:744` (`tax`) clobbered it — an existing reload this design's own insertion sits ahead of,
not one it has to add).

**The scratch bytes and register contract.** `engine/constants.asm:140-181`: `bt_actor = $54`,
`bt_target = $56`, `bt_dmg_lo = $58`/`bt_dmg_hi = $59`, `bt_tmp = $5C`, `bt_tmp2 = $5D`, `bt_arg =
$6D`, `bt_x = $6E`/`bt_y = $6F`/`bt_ret = $70` (`:167-172`: "The `combatant_*` lookups are all called
from inside loops that own X or Y, so they save both here and hand them back untouched — and return
through `bt_ret` so the flags describe the answer rather than the register reload"). Every one of
these is a bare zero-page-range *address*, not a zero-page-mode operand — see §7's own trap for what
that means for every byte/cycle figure below. `level_row` (`engine/battle.asm:209-225`: `sta bt_tmp`
is its first instruction — every `combatant_*` call that reaches the party side clobbers `bt_tmp`,
confirmed by reading the routine, not assumed), `party_apply_level` (`:164-173`: `pc_hp_at,y ->
pc_hp_max,x`, `pc_mp_at,y -> pc_mp_max,x`, `pc_spells_at,y -> pc_spells,x` — **and nothing else**;
`pc_atk`/`pc_def` have no RAM-cached counterpart here at all, because `combatant_atk`/`combatant_def`
read `pc_atk_at`/`pc_def_at` live through `level_row` every time, never through a cached byte —
confirmed by reading the whole routine body, not inferred from its name), `party_restore`
(`:199-206`, the `BE_RESTORE` entry point's target, looping `party_apply_level` over `PARTY_SIZE`
slots), `continue_game` (`engine/save.asm:540-559`, its own comment at `:543-556` explaining why
`BE_RESTORE` recomputes `pc_spells`/`pc_hp_max`/`pc_mp_max` from the just-restored `pc_level` against
the *current* build's tables — a spell-catalog-position hazard `pc_atk`/`pc_def`, having no cached
byte, were never exposed to, and `pc_mag`, following the identical no-cache shape, will not be
either).

**The tables.** `main/build/battletables.js`: header (`:1-32`, "roughly 3870 free bytes, measured"),
`statAt` (`:107-109`), `battleTables` (`:121-…`), the monster column helper `battle` (`:132-133`,
`column((actor) => pick(actor.battle ?? {}, actor))` — over **every** actor, hostile or not, the
identical shape `mon_atk`/`mon_def` already use), `mon_atk`/`mon_def` (`:137-138`), the item-table
conditional-emission comment (`:198-205`: `dbRows([])` still emits a one-byte `.db $00` stub for an
empty array, so an unconditional emission would cost every magic-power-off RPG real banked bytes it
never uses — the exact shape this design's own `pc_mag_at`/`mon_mag` gating must follow),
`pc_atk_at`/`pc_def_at` (`:276-277`, the `levelTable` helper at `:270-273`: `member * MAX_LEVEL +
level - 1`), `BASE_BATTLE_CODE_BYTES_BY_MAPPER = { 30: 4220, 1: 4220, 4: 4266 }` (`:508`, its own
comment block `:463-507` explaining the per-mapper-not-flat lesson and the MMC3 `SPLIT_ENABLED`
46-byte gap), `ITEM_LIST_FILTER_BATTLE_ALLOWANCE = 17` (`:547`, its own comment on why a real,
gated-off code delta must not be folded into the unconditional base), `NAME_ENTRY_BATTLE_ALLOWANCE =
765`/`NAME_COPY_BATTLE_ALLOWANCE = 47` (`:557-558`), `BATTLE_SLACK = 20` (`:567`, "purely a buffer
against the stock code growing a byte or two... not a job KERNEL_SLACK does"), `baseBattleCodeBytes`
(`:584-586`), `battleTableBytes` (`:607-609`, counts *emitted* bytes off `battleTables`' own output —
"no drift between the count and the emit is possible" — so a new table is counted automatically with
no separate accounting needed), `battleRegionBytes` (`:826-835`, the exact sum this design's own new
term is added to), `battleRegionCeiling` (`:843-845`, `NESASM_BANK_BYTES - BATTLE_SLACK`),
`battleShortfallAdvice` (`:893-1010`, its own `levers` array `:895-920`, the name-feature removal
block `:939-967`, the board-suggestion block `:969-1010`).

**The schema.** `shared/project.js`: `createPartyMember` (`:3981-4001` — `baseAtk: 6, atkPerLevel: 1,
baseDef: 4, defPerLevel: 1, speed, acc, eva, spells`), `normalizePartyMember` (`:5044-5076` — `num(key,
min, max)` at `:5046` falls back to `createPartyMember`'s own default for a missing key via
`clamp(raw?.[key], min, max, base[key])`; `atkPerLevel`/`defPerLevel` clamp to 0-16 at `:5062`/`:5064`
while `renderer/forges/character/character.js:182`/`:184` offer 0-32 in the UI — a real,
pre-existing mismatch, confirmed this round by reading both sides directly; noted, not fixed, not
copied for the new field), `RPG_LIMITS` (`:1116-1136` — `party: 4`, `maxLevel: 15`), `createSpell`
(`:4003-4005`), `normalizeActor` — the actor battle normalizer, named explicitly this round
(`:4940-4967`, `atk: clamp(battle.atk, 0, 255, 4)` at `:4958`, `def: clamp(battle.def, 0, 255, 2)` at
`:4959` — the insertion point for `mag`),
`projectUsesItems` (`:5930-5932`, the exact shape `projectUsesMagicPower` below follows). `shared/
save.js`: `saveIdentity` (`:224-269` — folds `RPG_LIMITS.variables`/`party`, `MAX_ITEMS`,
`screenCount`, `mapCount`, `actorCount`, `maxLevel`, `partyCount`, `battleEnabled`, `itemsEnabled`,
`itemCount`, and conditionally `saveCompatToken` — **no stat value, ever**, confirmed by reading the
full `values` array at `:256-268`).

**The Forges.** `renderer/forges/character/character.js`: `renderStats` (`:169-190` — three rows,
`HP`/`+ / level`/`MP`/`+ / level` at `:174-179`, `Attack`/`+ / level`/`Defence`/`+ / level` at
`:180-185`, `Speed`/`Accuracy`/`Evasion` with no growth companion at `:186-190`). `renderer/forges/
monster/monster.js`: `:107-149` — the `Attack`/`Defence`/`Speed` row (`:119-123`), the
`Accuracy`/`Evasion`/`Magic points` row (`:124-128`, "Magic points" here is `battle.mp`, the mana
pool — **not** this design's new stat; confirmed by reading the `set('mp', ...)` call directly, so
this design's own field needs a different label — "Magic" — to avoid colliding with the existing one
in the same Forge).

**What the battle screen draws.** `grep -n "pc_atk\|pc_def" engine/battleui.asm engine/battle.asm`
returns zero hits in either file — `combatant_atk`/`combatant_def` are read only inside
`physical_damage`/`combatant_atk`/`combatant_def` themselves (`engine/battleturn.asm`), never by any
draw or print routine. `draw_panel` (`engine/battle.asm:656-696`) draws only each living member's
name, letter by letter, out of `pc_name_ram` or `pc_name` (`:669-683`) — no numeric stat of any kind.
Attack and Defence are therefore never shown on the battle screen today, and a new Magic stat
inherits that identical absence with no engine change needed to keep it that way.

**Gating precedent.** `main/build/generate.js`: the local booleans immediately above the config.inc
block — `itemsEnabled` (`:2492`, distinct from `usesItems` at `:1208` inside `kernelCodeBytes`, a
different local in a different function; the design's own new local sits beside `:2492`, not
`:1208`), `ITEMS_ENABLED = ${itemsEnabled ? 1 : 0}` (`:2834`), `BATTLE_ENABLED = ${codeSlots.length ?
1 : 0}` (`:2890`) — the exact shape a project-conditional flag takes on its way into `config.inc`.
`kernelCodeBytes` (`:1144-…`, read through its full `usesX`-boolean block `:1157-1230` and its return
expression `:1231-…`): **no term here reads a caster/physical stat at all** — `combatant_atk`/
`combatant_def`/`level_row` are banked-region code (`battleturn.asm`/`battle.asm`), folded into
`BASE_BATTLE_CODE_BYTES_BY_MAPPER`/`BATTLE_KERNEL_ALLOWANCE_BY_MAPPER`, never into `kernelCodeBytes`
— confirming by direct reading, not inference, that a `combatant_mag` living beside them needs no
kernel-lo term either. `checkCapacity` (`:2087-…`): `battleCodeOverridden` (`:2229`),
`battleRegionCeiling` (`:2230`), `regionBytes = overridden ? battleTableBytes(project) :
battleRegionBytes(project, mapper)` (`:2239`), `battleShortfallAdvice(...)` call (`:2258`) — since
`battleRegionBytes` already sums every gated banked-region term, wiring this design's new term into
*that* function (not into `checkCapacity` itself) is sufficient; `checkCapacity` needs no edit.

**Ledger tests.** `test/unit/bankedbytes.test.js`: `CAPABLE_MAPPERS` (`:106`, `SUPPORTED_MAPPERS.
filter(rpgCapable)` — MMC1/MMC3/UNROM 512, the complete and only list `BASE_BATTLE_CODE_BYTES_BY_
MAPPER` can ever hold an entry for), `measureRegion` (`:121-148` — builds `sample-rpg` on a mapper
into a fresh `mkdtemp` dir via `buildProject`, forcing `project.party[0].renamable = false` and
`party[1].renamable = false` at `:131-132` *before* the caller's own `mutate` runs, so naming never
leaks live into a measurement it was not asked for), the per-board base equality test (`:315-376`,
`assert.equal`, not `<=` — "no estimation error here for it to absorb"), the `ITEM_LIST_FILTER_
BATTLE_ALLOWANCE` isolation test (`:386-404` — with-items vs. without-items, `assert.equal` against
the named constant directly, the exact shape this design's own `MAGIC_POWER_BATTLE_ALLOWANCE` test
takes in §12 below).

**The six-fixture byte-identity gate — corrected from the brief that started this round.** The brief
cited `test/unit/project.test.js:~1021` and a hash table at `~:305-315`; both are wrong at HEAD.
`test/unit/project.test.js:1021-1028` is an unrelated missing-`items.json` fallback test. The real
gate is **`test/unit/nameentry.test.js:91-124`**: `BASELINES` (`:91-98`, one SHA-256 per fixture,
including the phase-5-name-entry-opt-in re-pin note at `:85-90`), the `for (const name of
Object.keys(BASELINES))` loop (`:100-124`) that builds each of the six checked-in fixtures into a
fresh `mkdtemp` dir and asserts byte-identity. Every naming-off, magic-power-off build must continue
to hash identically to these six baselines, because none of the six fixtures opts into magic power
(§10 below) and the stat compiles to nothing when off (§12).

**Emulator tests.** `test/unit/rpg.test.js`: `boot` (`:134-139`)/`tap` (`:141-146`) — corrected in
round 2 (v1 wrongly cited `:115-127`, which holds the battle-phase/command/button constants
immediately above both functions, not the functions themselves), `'MAGIC spends MP and does
more to something the spell is strong against'` (`:516`), `'a heal spell restores HP, cures poison,
and costs its MP'` (`:1794`), `'a flat-range spell (amountMin === amountMax) consumes no RNG at
all'` (`:1834`), `'an all-target spell rolls independently per target'` (`:2125`, the `bt_tmp2`
RNG-state guard this design must not disturb), `'a monster with a spell casts it, spending its own
MP, and poison ticks'` (`:3235`), `bootPastNaming` (`:253`, local to this file).

**Starters.** `shared/starters/rpg.js`: `project.party[0] = { ...project.party[0], renamable: true,
spells: [{ spellId: 0, level: 1 }], metaspriteId: heroMetaspriteId }` (`:206`), `project.party.push({
...createPartyMember(1, 'Ally'), startsInParty: false, renamable: true, metaspriteId:
heroMetaspriteId, spells: [] })` (`:207`) — Hero (member 0) casts spell 0; Ally (member 1) has no
spells at all. `importEntry(project, 'monster', 'Slime')`/`'Bat'` (`:92-96`) — confirmed this round,
by grepping the whole file for `spellId`, that **neither starter monster casts a spell**: only
`project.party[0]` has one. `shared/library/monster/skeleton.js:46-49` (a *library* entry, not part
of the RPG starter's own encounter table) is the shape a monster's `battle` block takes.

**Smoke coverage.** `main/smoke.js`: the Monster Forge Attack-field edit/undo/redo sequence
(`:7488-7527` — edit reaches the store, undo restores the *rendered* value from the live store
rather than a cached object, redo reapplies, cleanup undoes once more) is the exact pattern a new
Magic field inherits on that Forge. Grepping the file for `baseAtk`/`'Attack'` inside the Character
Forge's own section (`:6855-7298`) finds **no existing per-stat-field edit test there** — only
Add/Remove, the Renamable checkbox (`:7147-7162`), and the starts-in-party checkbox (`:7171-7188`)
are covered. A Magic field on the Character Forge therefore needs genuinely new smoke coverage, not
an extension of an existing one; the Monster Forge's Magic field can reuse the Attack-field shape
almost verbatim.

**Magic defence — what was additionally read at HEAD `14e9cbc` (the tree is unchanged from `eab9eb0`
in every file this document cites; no magic-power code has landed, so v6's own citations above are
re-confirmed, not stale).** `physical_damage` re-read in full (`engine/battleturn.asm:607-635`):
its own floor idiom, `sec / sbc bt_tmp2 / bcs physical_damage_floor / lda #0` fallthrough into
`physical_damage_floor: bne physical_damage_noise / lda #1` at `:617-621` — the exact "force 0 on
underflow, then floor a zero result to 1" shape this design's own `spell_damage_mdef_floor` mirrors.
`rng_next` (`engine/rpg.asm:14-24`, `lda rng / bne … / asl a / bcc … / eor #$71 / sta rng / rts`)
read in full to confirm it touches only `A` and `rng`, never `bt_dmg_lo` or `bt_ret`. `roll_spell_
amount`/`mod8` (`engine/battleturn.asm:690-729`) re-read in full, not merely cited, to confirm
neither references `bt_dmg_lo` anywhere in either routine's body — the direct proof (not the
existing contract comment at `:683-689`, which names `bt_tmp2` and `bt_tmp` explicitly but never
`bt_dmg_lo` by name) that magic defence's own value can be parked there across the roll. `shared/
project.js`'s `createPartyMember`/`normalizeActor`/`normalizePartyMember`/`projectUsesItems`
(`:3981-4001`, `:4940-4967`, `:5044-5076`, `:5930-5932`), `main/build/battletables.js`'s `mon_atk`/
`mon_def`/`pc_atk_at`/`pc_def_at`/`BASE_BATTLE_CODE_BYTES_BY_MAPPER`/`ITEM_LIST_FILTER_BATTLE_
ALLOWANCE`/`NAME_ENTRY_BATTLE_ALLOWANCE`/`BATTLE_SLACK`/`battleTableBytes`/`battleRegionBytes`
(`:137-138`, `:276-277`, `:508`, `:547`, `:557`, `:567`, `:607`, `:826`), `renderer/forges/monster/
monster.js`'s Attack/Defence/Speed and Accuracy/Evasion/Magic-points rows (`:120-127`), `renderer/
forges/character/character.js`'s Attack/Defence and Speed/Accuracy/Evasion rows (`:181-189`), and
`ROADMAP.md`'s item 13 sub-item 5/`---`/item 14 boundaries (`:1480-1496`) were all re-read this
round and confirmed identical to v6's own citations, byte-for-byte and line-for-line — no code
implementing any part of this design exists in the tree at either HEAD.

**Measured, not estimated, this round: a full prototype of both stats together** — schema
(`baseMag`/`magPerLevel`/`baseMdef`/`mdefPerLevel` on a party member, `battle.mag`/`battle.mdef` on
an actor), `projectUsesMagicPower`/`projectUsesMagicDefence`, `MAGIC_POWER_ENABLED`/`MAGIC_DEFENCE_
ENABLED` in `config.inc`, `pc_mag_at`/`mon_mag`/`pc_mdef_at`/`mon_mdef` table emission, and
`combatant_mag`/`combatant_mdef`/the rewritten `spell_damage`/`cast_heal` in `engine/battleturn.asm`
— built with real `nesasm` in an isolated `git worktree` at HEAD `14e9cbc` (discarded after
measuring, no change to the working repository), against `mkdtemp` copies of `sample-rpg` on all
three RPG-capable boards, in four configurations: both stats off (the byte-identical-to-`sample-rpg`
baseline), magic power alone, magic defence alone, and both live. §7 and §9 report the results.

## §1. Recommendation at a glance

**v7 rewrite: Chris decided (2026-09-10 evening) on seven of this document's own questions, listed
in full at the top of §16 — magic defence is now IN, the one decision against v6's own
recommendation, and the reason this round exists.** Additive (§2), both sides for both stats (§3),
damage and heal both for magic power (§4), **magic defence IN, damage only, subtracted from `(roll +
mag)` before the elemental modifier, floored at 1** (§5), schema default `0`/`0` for every new field
(§6), magic power's own add sequenced through `bt_ret` before the roll, magic defence's own subtract
staged through `bt_dmg_lo` before both (§7), each gated on its **own separate** flag —
`MAGIC_POWER_ENABLED` (`MAGIC_POWER_BATTLE_ALLOWANCE = 72`, measured) and `MAGIC_DEFENCE_ENABLED`
(`MAGIC_DEFENCE_BATTLE_ALLOWANCE = 65`, measured, `137` combined, exactly `72 + 65` on every
RPG-capable board — §8-§9), Magic and Magic defence fields on both Forges with no battle-screen
display (§10), the RPG starter's Hero gets real `baseMag`/`magPerLevel` values and no `mdef` (a
monster's own `mdef` is the only one ever exercised there — §11), one new sub-item under ROADMAP
item 13 (§12), a monster spell *list* recorded as an explicitly queued, separate later slice (§17).
§16 lists what remains open — the starter `mdef` numbers, chiefly — each with a recommendation; the
rest of this document builds the recommended path for both stats in full.

## §2. Q1 — additive or multiplicative

The 6502 has no multiply instruction, and CLAUDE.md's own rule — "Anything the engine would need a
multiply for is a table instead" — is how this codebase avoids that everywhere else a per-level or
per-instance number is needed (`xpCurve`, `statAt`, `spell_amount_*`). But a magic-power scale is a
**product of two authored numbers**, a spell's own roll and a caster's own stat, and neither one is
fixed at build time the way a level curve is: `statAt` precomputes `base + perLevel * (level - 1)`
into a 15-entry table because `level` has 15 possible values total, but a `roll x scale` table would
need one entry per `(roll, mag)` pair — up to 255 x 255 entries, not a "handful of bytes" the way
`design-character-forge.md` §5's own one-paragraph sketch assumed when it reached for "a multiplier
term."

**Additive: `amount = min(255, roll + mag(caster))`, added after `roll_spell_amount` returns and
before the elemental modifier.** Zero mag is the identity by construction — no clamp, no branch, no
special case — so a magic-power-off project's *rolled numbers* are unaffected the instant the add
of literal `0` is skipped by the `.if MAGIC_POWER_ENABLED` gate (§7), and RNG consumption is
byte-identical to today in every case, because the add sits entirely outside `roll_spell_amount`'s
own body. This is `physical_damage`'s own shape (`atk - def`, engine/battleturn.asm:607-635) applied
to the spell side, needing no new arithmetic primitive the engine does not already have.

**Multiplicative (priced, not built, corrected in round 2): `amount = min(255, roll +
((roll × mag) >> 4))`** — `mag` stays a plain 0-255 byte with no fixed-point offset of its own
(`mag = 0` gives `roll + 0 = roll`, the identity), rather than v1's own `roll * (16 + mag) >> 4`,
which round 2 review found genuinely broken: `16 + mag` ranges up to 271, which does not fit an
8-bit multiplier register at all, and the sketch's own `asl bt_tmp` doubled only the *low* byte of
the multiplicand every iteration, silently discarding the overflow the moment it grew past 255 —
concretely, `roll = 16, mag = 0` (multiplier `16`, binary `00010000`, a single set bit at position
4) loses the multiplicand to that discarded overflow before bit 4 is ever tested, so the sketch
computed `0`, not `16` — the exact zero-is-identity property it claimed to have. **Estimate, not
measured**, priced the same instruction-by-instruction way `docs/design-magic.md` §8 priced
`roll_spell_amount`/`mod8`, because this alternative is not being built; hand-verified against a
worked example (`3 × 5 = 15`) rather than merely inspected, since v1's own sketch was inspected and
still wrong:

```
; A = roll on entry -- the already-rolled spell amount, corrected in round 4
; to 1-255, not 0-254: that narrower range is the RNG *draw* roll_spell_
; amount consumes internally, before amountMin is added on, not the rolled
; *result* it hands back, which can itself reach 255 whenever a spell's own
; amountMax is authored that high -- test/unit/rpg.test.js:1862-1869
; exercises exactly that (`amountMin: 1, amountMax: 255`). mulscale already
; handles 255 correctly: the multiply loop's own arithmetic bakes in no
; assumption that the multiplicand stays under 255.
;
; Corrected in round 3: the previous version of this comment claimed roll
; "must already be parked in bt_tmp by the caller," which is not true anywhere in this
; codebase: spell_damage stores its roll into bt_dmg_lo, cast_heal stores
; its own into bt_tmp, and a *ranged* roll uses bt_tmp destructively as
; mod8's own internal scratch (`:715-729`) before roll_spell_amount even
; returns (`:733-736` for spell_damage's own call site, `:328-331` for
; cast_heal's). mulscale needs no pre-parked copy of anything: its own very
; first instruction, `sta bt_tmp`, already saves whatever roll_spell_amount
; just returned in A. The real, complete entry contract is simply: A = roll,
; bt_ret = mag (left there by combatant_mag's own return convention, §7,
; called before the roll the identical way the additive design already
; does). On return, A holds min(255, roll + ((roll * mag) >> 4)).
;
; Standard MSB-first shift-and-add multiply, hand-verified against 3*5=15
; (round 2 review found v1's own sketch wrong by inspection alone, so this
; one is verified by simulation, not merely read): the 16-bit product is
; built in prod_hi:bt_ret by shifting it left one bit per iteration and
; conditionally adding the (unchanging) multiplicand into the low byte,
; carrying into the high byte, while the multiplier is independently peeled
; from its own MSB via a second, unrelated `asl` into the same carry flag.
;
; Needs two scratch locations beyond bt_tmp/bt_ret -- corrected in round 3
; to distinguish "needs two scratch locations" from "must allocate two new
; RAM bytes," which are not the same claim. `bt_x`/`bt_y` are free to reuse
; the moment mulscale runs, because it is only ever called *after*
; combatant_mag has already returned (§7's own call-site ordering) --
; combatant_mag's own return sequence has already restored the caller's
; X/Y from bt_x/bt_y by then, so those two bytes hold nothing live any
; caller still needs. Using them costs no new equate at all, the identical
; free-scratch shape combatant_mag itself already relies on. The remaining
; alternative is two genuinely new equates (`mag_copy`, `prod_hi`) in
; `engine/constants.asm` if a future reviewer would rather not couple this
; routine to combatant_mag's own calling convention. `bt_tmp2` -- cast_all's
; own end-of-side sentinel across this entire call chain -- is never a
; candidate for either, the identical reason the additive design (§7) never
; touches it. The hardware stack is not a real third option here, dropped
; in round 3: two simultaneously-live values (the shrinking multiplier and
; the growing product's own high byte) pushed onto one LIFO stack cannot
; each be read and written independently mid-loop without repeatedly
; popping one to get at the other -- awkward and slow enough that it is not
; a genuine alternative to a dedicated byte, unlike bt_x/bt_y above.
mulscale:
  sta bt_tmp              ; multiplicand copy (roll), fixed all 8 iters   (abs, 4)
  lda bt_ret               ; the multiplier (mag), before bt_ret is        (abs, 4)
  sta mag_copy               ; repurposed below                            (abs, 4)
  lda #0
  sta bt_ret                  ; product lo                            (imm 2, abs 4)
  sta prod_hi                   ; product hi                                (abs 4)
  ldx #8                                                                       (2)
mulscale_loop:
  asl bt_ret                     ; product <<= 1 (16-bit), lo first     (abs-rmw, 6)
  rol prod_hi                      ; carry from lo's shift -> hi's bit0 (abs-rmw, 6)
  asl mag_copy                       ; multiplier's next (MSB-first)    (abs-rmw, 6)
                                        ; bit -> carry
  bcc mulscale_skip                                                          (2/3)
  clc
  lda bt_ret
  adc bt_tmp                                                                 (abs, 4)
  sta bt_ret                                                                 (abs, 4)
  bcc mulscale_skip
  inc prod_hi                                                          (abs-rmw, 6)
mulscale_skip:
  dex                                                                          (2)
  bne mulscale_loop                                                          (2/3)
  ; 16-bit product now in prod_hi:bt_ret. >>4, four ordinary 16-bit right
  ; shifts -- an unsigned shift, so prod_hi's vacated top bit is always 0.
  ldy #4                                                                       (2)
mulscale_shift4:
  lsr prod_hi                                                          (abs-rmw, 6)
  ror bt_ret                                                           (abs-rmw, 6)
  dey                                                                          (2)
  bne mulscale_shift4                                                       (2/3)
  ; Any surviving bit in prod_hi means the >>4 term alone already exceeds
  ; 255 -- saturate immediately, before the add, the same "no high byte to
  ; promote into" reasoning §7's own additive saturation already uses.
  lda prod_hi
  beq mulscale_add                                                            (3)
  lda #$FF
  rts
mulscale_add:
  lda bt_tmp                ; roll, unchanged since the very first store    (abs, 4)
  clc
  adc bt_ret                  ; + the scaled term's own low byte              (abs, 4)
  bcc mulscale_done
  lda #$FF
mulscale_done:
  rts
```

**79 bytes** (every operand above counted at its real addressing-mode cost: 3 bytes for an absolute
load/store/compare/`adc`, 3 bytes *and* 6 cycles for an absolute read-modify-write — `asl`/`rol`/
`lsr`/`ror`/`inc` on a memory operand, not the 4-cycle figure a load/store gets, per F15's own
correction below) — not the 31 v1 claimed (an undercount from the broken algorithm's shorter,
wrong body) nor the 43 a naive byte-recount of that same wrong body gives (still short, because the
wrong body never included the `>>4` shift or the final clamp at all).

**Cycles — corrected in round 3 (an ordinary clear-bit iteration is 26, not 25) and again in round 4
(the explanation for the one-cycle gap against the simulation was itself wrong).** The routine's real
range was confirmed by simulating all 65,536 `(roll, mag)` input pairs rather than trusted from
hand-multiplied per-iteration bounds, which overstate the true maximum (no single `(roll, mag)` pair
drives every one of the eight iterations to its own individual worst case at once). Setup: 24 (the
seven instructions before the loop). **Per-iteration cost in the multiply loop, for any iteration
*except the last*** (`bne mulscale_loop` taken, continuing the loop): a clear bit costs `asl`(6) +
`rol`(6) + `asl`(6) + `bcc` taken(3) + `dex`(2) + `bne` taken(3) = **26**; a set bit with no overflow
into `prod_hi` costs the same three shifts (18) + `bcc` not taken(2) + `clc`(2) + `lda`(4) + `adc`(4)
+ `sta`(4) + `bcc` taken(3) + `dex`(2) + `bne` taken(3) = **42**; a set bit *with* overflow replaces
that last `bcc` with not-taken(2) + `inc prod_hi`(6) = **47**. **The *final* (eighth) iteration costs
one less than each of these**, because `dex` brings X to 0 and `bne` is *not* taken there — loop exit,
2 cycles instead of 3 — giving 25/41/46 respectively for whichever shape the last iteration happens to
take. The `>>4` shift is a flat, input-independent 4 iterations: `ldy #4`(2) + 4x[`lsr`(6) + `ror`(6) +
`dey`(2) + `bne`(2 or 3)] = **69** exactly (confirmed against the simulation; its own final iteration
gets the identical one-cycle-less treatment, already folded into this figure). The saturate-check-and-
add tail ranges from **14** (the `>>4` term alone already exceeds 255, an early `rts`) to **27** (it
fits, but the final add to `roll` still overflows) to **26** (the ordinary case, no saturation at
all). **Simulated over every input pair: 326-477 cycles total** — the low end (`mag = 0`: every one of
the eight iterations is clear-bit, so seven pay the non-final 26 and the eighth pays the final-
iteration 25: `24 + (7x26 + 25) + 69 + 26 = 24 + 207 + 69 + 26 = 326`, an exact match, not the
one-cycle-off approximation an earlier round wrongly attributed to "a boundary case elsewhere in the
tail" when it was simply this same final-iteration discount, unaccounted for) — and the high end
genuinely depends on which bits of `mag` are set and in what order relative to the growing product,
not simply "every iteration at its own worst case" (`24 + (7x47 + 46) + 69 + 27 = 495` still overstates
it, because a real `mag`'s eight bits cannot all individually trigger the 47-cycle path in the same
draw) — the exhaustive count, 477, is the number this document reports.

**Comparing complete paths, like-for-like — corrected in round 3: v1's own "24-38 total" byte figure
contradicted §9's real, measured 72, and its "roughly 20x" cycle claim was not a like-for-like
comparison.** Both designs share the identical `combatant_mag` routine unchanged (44 bytes; 49 cycles
for a monster caster, 82-107 for a party caster by level — §7's own figures, reused verbatim here
since nothing about the lookup itself differs between the two designs). What differs is what each
call site does with the result:

- **Additive, complete: 72 bytes** (44 shared + 14 + 14, §9's own measured figure) — **19-20 cycles
  of call-site overhead** per resolution (`lda bt_actor` + `jsr combatant_mag` + `clc` + `adc bt_ret`
  + `bcc` [+ `lda #$FF` on the rare saturating path], §7's own corrected figures).
- **Multiplicative, complete: 141 bytes** (44 shared + 79 for `mulscale` + 9 + 9 for the two call
  sites — each call site now needs only `lda bt_actor`(3) + `jsr combatant_mag`(3) + `jsr mulscale`(3)
  = 9 bytes, since `mulscale` itself performs the whole scale-and-saturate and needs no separate
  `clc`/`adc`/`bcc` sequence at the call site the way the additive add does) — **342-493 cycles** of
  call-site overhead per resolution (`lda bt_actor`(4) + `jsr combatant_mag`(6) + `jsr mulscale`(6) +
  `mulscale`'s own simulated 326-477-cycle body).

**Total per spell resolution, both designs, combatant_mag included: additive 68-69 (monster) /
101-127 (party); multiplicative 391-542 (monster) / 424-600 (party).** That is roughly **4-8x** the
additive design's own total, not the "roughly 20x" v1 claimed — the 20x figure came from comparing
only the *call-site* overhead in isolation (342-493 vs. 19-20 is indeed close to 17-25x), which is
not the number a caster actually pays once the identical, shared `combatant_mag` lookup both designs
need is counted on both sides of the comparison.

**Recommendation: additive.** Cheaper in bytes (72 vs. 141, complete paths), cheaper in cycles by
roughly 4-8x per spell resolution, needs no new scratch byte at all (vs. `mulscale`'s own two, above
— reusable from `bt_x`/`bt_y` at zero new-equate cost, or two new equates if a future reviewer
prefers not to couple the routine to `combatant_mag`'s own calling convention), and its "mag 0 is the
identity" guarantee falls out of the design rather than needing a correct 16-bit multiply and a
fixed-point shift to establish it — a correctness bar v1's own first attempt at this very sketch
failed to clear. **Decided: additive (§16)** — had Chris chosen multiplicative instead, the
consequence would have been committing `mulscale` for real (`bt_x`/`bt_y` reused, or `mag_copy`/
`prod_hi` newly equated in `engine/constants.asm`, above), re-measuring §9's ledger term against the
real routine rather than this estimate (141 bytes projected, against `combatant_mag`'s own
44-byte-alone measured baseline), and accepting the roughly 4-8x total cycle cost this section now
prices like-for-like.

## §3. Q2 — party only, or both sides

Monsters cast the same spells the party does. **Round 2 correction: v1 claimed `spell_damage`/
`cast_heal` do not branch on which side is involved, which is false, and the "first side-conditional
branch" framing built on it was false with it.** `cast_heal` already branches on `bt_actor` vs.
`MAX_PARTY` (`engine/battleturn.asm:332-334` — `lda bt_actor / cmp #MAX_PARTY / bcs cast_heal_mon`,
choosing `pc_hp,x`/`pc_status,x` or `mon_slot_hp,x`/`mon_slot_status,x`), and `spell_damage` already
branches on `bt_target` for the identical reason, skipping the elemental step outright for a party
target (`:739-741` — `lda bt_target / cmp #MAX_PARTY / bcc spell_damage_done ; elements only describe
monsters`). `mon_spell,y` (`main/build/battletables.js:180-184`) is a monster's own compiled spell
choice, read by `monster_turn` (`engine/battleturn.asm`, not re-read this round — its existence and
call shape are already established by `rpg.test.js`'s own `'a monster with a spell casts it'` test at
`:3235`).

**Round 3 correction: the "no precedent" framing was self-contradicting and is dropped outright.**
The previous paragraph claimed every existing branch in this chain picks which table a side reads
and "never whether a step runs at all" — in the very same breath as its own citation of `spell_
damage`'s `:739-741` branch, which **does** skip the elemental step entirely for a party target
(`bcc spell_damage_done`). That branch is real, and it is exactly the "run this for one side, skip it
for the other" shape the dropped paragraph claimed had no precedent. There is no clean categorical
distinction to be drawn here between "table-select" and "step-skip" branches; both shapes already
exist in this call chain today, so neither is a reason to prefer one design over the other.

**Recommendation: both, on the grounds that hold up — corrected again in round 4, both the
"caster-side" framing and the byte-saving claim were still wrong.** `cast_heal` genuinely does branch
on the *caster's* own side, not only the target's: `lda bt_actor / cmp #MAX_PARTY / bcs cast_heal_mon`
(`:332-334`, cited above) selects `pc_hp,x`/`pc_status,x` vs. `mon_slot_hp,x`/`mon_slot_status,x`
depending on who is *casting*, so "no caster-side special-casing anywhere in these routines" was
false — one of them already has exactly that shape. What is true, restated precisely: neither
`spell_damage` nor `cast_heal` has a branch that decides *whether to call `combatant_mag` at all* —
`cast_heal`'s own caster-side branch exists for a completely different reason (which RAM array to
touch) and runs *after* `combatant_mag` has already returned, not as a gate on calling it.

**The self-contradiction in the previous "gate lives in the caller, not in them" sentence: `spell_
damage` and `cast_heal` *are* `combatant_mag`'s only callers — there is no third routine for such a
gate to live in instead.** A party-only design has exactly two honest shapes, and both were priced
vaguely last round; here is one, concretely, complete and counted:

```asm
; Party-only variant (not recommended, priced for comparison only). Same
; entry/exit contract as the both-sides combatant_mag (§7): A = combatant
; index in, A = mag out (0 for any monster), X/Y preserved, bt_ret staged
; the same way -- so spell_damage/cast_heal need NO change either way; the
; whole question is contained inside this one routine.
combatant_mag:
  cmp #MAX_PARTY
  bcs combatant_mag_mon    ; a monster never reaches the table lookup at all
  stx bt_x
  sty bt_y
  tax
  txa
  jsr level_row
  lda pc_mag_at,y
  sta bt_ret
  ldx bt_x
  ldy bt_y
  lda bt_ret
  rts
combatant_mag_mon:
  lda #0
  sta bt_ret                ; the call site still reads bt_ret, unchanged
  rts
```

Byte count: `cmp`(2) + `bcs`(2) + `stx`(3) + `sty`(3) + `tax`(1) + `txa`(1) + `jsr`(3) + `lda abs,y`(3)
+ `sta`(3) + `ldx`(3) + `ldy`(3) + `lda`(3) + `rts`(1) = 31 for the party path, + `lda #0`(2) +
`sta bt_ret`(3) + `rts`(1) = 6 for the monster arm — **37 bytes total**, against the both-sides
`combatant_mag`'s own measured 44 (§9). **Net saving: 7 bytes of code — the simple reconciliation,
stated plainly rather than re-derived from a wrong retrospective:** starting from the both-sides
routine, remove its 10-byte monster arm (`sec`/`sbc #MAX_PARTY`/`tax`/`ldy mon_slot_actor,x`/
`lda mon_mag,y`) and its 3-byte `jmp combatant_mag_ret` (the merge back to the shared return code,
needed only because the both-sides routine has two paths to reunite — this one does not), then add
the 6-byte zero-return arm this routine uses instead (`lda #0` / `sta bt_ret` / `rts`): `10 + 3 − 6 =
7`. `spell_damage`/`cast_heal` are unchanged
either way, exactly as claimed; the asymmetry this alternative buys is in the schema and the Monster
Forge, not the call sites. On top of the 7 code bytes, a party-only design also drops `mon_mag`'s own
table bytes (one per actor — `sample-rpg`'s own 4 actors would drop 4 of §9's measured 20 table
bytes; this scales with a project's actor count, not a fixed figure) and the Monster Forge's own
`battle.mag` field and its normalizer/schema code (not engine bytes, not priced here).

**Against that small, now-honestly-priced saving, both sides is still the recommendation**: `battle.
mag` on an actor (0-255, default 0, `shared/project.js:4958`'s `atk`/`def` neighbors), a `mon_mag`
byte column (`main/build/battletables.js`, beside `mon_atk`/`mon_def`), and `combatant_mag` mirroring
`combatant_atk`/`combatant_def` exactly (§7's own listing), including the monster-side `ldy
mon_slot_actor,x` indirection (§7's own trap 10) — no asymmetry on the Monster Forge, for a real but
small (7 code bytes plus a handful of table bytes) cost. **Decided: both (§16).**

## §4. Q3 — which spell kinds

`roll_spell_amount` is called from exactly two places: `spell_damage` (the single-target and
`cast_all`-driven damage path) and `cast_heal`. `cast_poison`/`cast_burn` never call it — confirmed
this round by reading both routines directly (§0) — they apply a flat `#POISON_DMG`/`#BURN_DMG`
constant with no roll at all, so there is no "amount" for a caster stat to scale in the first place.

**Recommendation: damage and heal, both.** A stronger caster's own heal spells restore more, the
identical shape a stronger caster's own damage spells hit harder — there is no asymmetry in the
underlying mechanism (§7's add sits at both of `spell_damage`'s and `cast_heal`'s own roll sites,
identically) that would justify excluding one. Poison and burn are untouched: `MAGIC_POWER_ENABLED`
gates nothing in either routine, because neither reads `roll_spell_amount` or any `combatant_*`
lookup. **Decided: both, heal in (§16).** Excluding heal would remove only `cast_heal`'s own
call-site addition from §7's listing, **none of `combatant_mag` itself**, since `spell_damage`
still needs the shared routine — **not "half" of §9's measured allowance.** §9's own measurement
found `combatant_mag` at 44 bytes (shared, one copy) and each call site at 14; excluding heal drops
one 14-byte call site, leaving a projected **58 bytes**, subject to re-measurement, not the 36 a
naive halving of 72 would suggest.

## §5. Q4 — magic defence

**Decided (2026-09-10 evening): magic defence is IN — the one answer against this document's own
v6 recommendation, and the reason this round exists.** v6 recorded, correctly, that a real magic
defence needs a second stat, a second table, a second `combatant_*` lookup, and a decision about how
it interacts with the existing weak/strong elemental multiply and with healing. Those are no longer
open questions this document defers — they are decided below, at the same depth §2 gave the
additive/multiplicative question, with the concrete mechanics (schema, engine listing, gating,
ledger measurement, UI, starter, tests, phasing) folded into §6 through §15 alongside magic power's
own, rather than crammed into this one section. §5's own job is the three decisions that are
specific to *defence* and do not already follow from magic power's own design: which spell kinds it
touches, where in the calculation it lands, and how low it can drive the result.

**Damage only, never `cast_heal` — a heal has no defending target.** Magic power (§4) applies to
both damage and heal because a stronger caster is a stronger caster either way. Defence is not
symmetric the same way: `cast_heal` **heals only the caster, `bt_actor`, never a separately chosen
ally — corrected this round, `bt_target` is never read anywhere in `cast_heal`'s own body**
(`engine/battleturn.asm:328-372`, re-read in full: every `lda`/branch in the routine reads `bt_actor`,
none reads `bt_target`). "The caster healing themselves, or an ally" overstated what the engine does;
the accurate claim is narrower and still enough to make the point — whoever `bt_actor` names is
always on the *caster's own side* by construction (it is the caster), never an adversary resisting an
incoming effect. There is no "defence" concept for a heal to subtract in the first place; a target's
own `mdef` reducing the healing *they* receive would be actively backwards (a well-defended tank
would end up healed *less*), not merely unnecessary. `cast_heal` is therefore untouched by this
design in every
sense `MAGIC_DEFENCE_ENABLED` gates — no call to `combatant_mdef`, no subtraction, no new label —
the identical "poison and burn are untouched" shape §4 already established for a different pair of
routines.

**Applied to `(roll + mag)`, before the elemental modifier — the same point magic power's own add
already lands at, and the same shape `physical_damage`'s `atk - def` already has on the physical
side.** `physical_damage` (`engine/battleturn.asm:607-635`) computes `atk - def` once, as the
*base* number — **narrowed this round: `physical_damage` is not free of everything after that
subtraction, only of an elemental one.** Its own floor (`physical_damage_floor`), a `0-3` RNG noise
roll added on, and a final saturation check all run *after* `atk - def` (`:617-630`) — real
processing this design does not claim is absent. What genuinely is absent is an *elemental*
multiply: nothing on the physical side scales the number up or down based on a target's own
weakness or resistance, because physical hits carry no element at all. The spell side's own multiply
(`spell_damage_weak`/`_strong`) exists specifically to scale a spell's *base* number up or down
depending on what it is fighting — so mdef has to be part of computing that base, not something
applied to an already-scaled result, or the multiplier would be scaling a number defence never had a
chance to touch. Subtracting `mdef` from `roll + mag` first, then letting the unchanged weak/strong
step run on whatever survives, keeps the elemental multiply's own meaning intact — "half again
against a weakness, half against a resistance" describes the *net* hit either way, exactly as it
already does for a magic-power-off spell today.

**Floor of 1, matching both `physical_damage_floor`'s "even a hopeless attack scratches"
(`engine/battleturn.asm:619-621`) and `spell_damage_strong`'s own "never less than one"
(`:766-770`).** Every existing damage source in this engine's compiled battle math — a physical hit,
a strong-element spell halved down — is already floored at 1; nothing here can currently deal
literal zero damage. A magic-defence subtraction that could reach 0 would be the *first* such case,
and would read as a bug (a spell that visibly "hits" for nothing) rather than a deliberate design
choice, unless it were clearly signposted as one — which this document is not asked to design.
Flooring at 1 keeps every damage source in this codebase behaviorally consistent with every other
one.

**The two alternatives, priced against the actual listing, not built:**

- **Subtracting `mdef` *after* the elemental modifier instead** (`amount = max(1, (roll + mag) *
  weak/strong − mdef)`) does not strictly need the naive three-duplicated-blocks shape — the three
  live exits (`spell_damage`'s own "matched neither" bare `rts`, `spell_damage_weak_store`'s own
  `rts`, and `spell_damage_done`'s own `rts`, already shared by the party-target exit, the elementless
  exit, and `spell_damage_strong`'s own fallthrough) could converge on one shared epilogue instead,
  rerouting the two standalone `rts`s into `jmp spell_damage_done` and putting the subtract-and-floor
  logic there once. **Priced correctly this round, after an earlier draft overstated the cost by
  reaching for the stack where the routine's own timing already gives a free byte:** calling
  `combatant_mdef` is only awkward *early*, before the multiply, because `bt_dmg_lo` is the routine's
  own running value across that whole span. It is not awkward at the *epilogue*, because by the time
  every exit path reaches `spell_damage_done`, the multiply has already run (or been skipped, for the
  party-target and elementless exits, which never had one to run) and `bt_dmg_lo` holds nothing but
  the final number about to be returned — free to overwrite with a fresh `combatant_mdef` result the
  moment it is read once. So the shared epilogue reads: `lda bt_target`(3) + `jsr combatant_mdef`(3) —
  `A` = `mdef`, and `bt_ret` too (`combatant_mdef`'s own convention), *not* `bt_dmg_lo`, so nothing
  about the value in flight is disturbed by the call — then `lda bt_dmg_lo`(3) + `sec`(1) + `sbc
  bt_ret`(3) + the identical 12-byte subtract/floor sequence's own two branches (`bcs`(2)+`lda #0`(2)
  the underflow arm, `bne`(2)+`lda #1`(2) the exact-zero arm — both arms assemble unconditionally, 8
  bytes for the pair; the branch only decides which one *runs*, the identical shape this document's own
  12-byte figure already prices) + `sta bt_dmg_lo`(3) = `3+3+3+1+3+8+3 = 24` bytes for the epilogue
  itself, no stack, no `bt_dmg_hi` detour of any kind. The two standalone `rts`s each become `jmp
  spell_damage_done` — `+2` bytes apiece (`rts` is 1 byte, `jmp abs` is 3) — for `4` more. **Total: `24
  + 4 = 28` bytes**, against this design's own measured `21` — real, but a third smaller than an
  earlier draft's `38`-byte estimate, which reached for `pha`/`pla` and a `bt_dmg_hi` detour to solve a
  problem (recovering a stack-popped value into memory for `sbc` to read) this shape never has, because
  it never puts `mdef` on the stack in the first place. It still changes what `mdef` *means*: a
  strong-element hit (already halved) would lose the identical flat `mdef` a weak-element hit (already
  amplified 1.5x) loses, so defence would bite proportionally harder against a resistance than against
  a weakness — arguably the opposite of how a "defence" stat should feel, on top of costing 7 more
  bytes for it.
- **A floor of 0 instead of 1** (a magic defence high enough to fully negate a spell outright) is a
  genuine, playable design in other games, but it would be the first zero-damage hit this compiled
  battle math has ever produced — every other floor in this codebase (`physical_damage_floor`,
  `spell_damage_strong`) already commits to "never less than one," and departing from that here,
  silently, is a worse choice than either keeping the precedent (recommended) or deciding to break it
  everywhere at once, which this document does not propose. **Priced correctly this round, after an
  earlier draft overstated the cost by inventing a flag where the existing zero/nonzero distinction
  already does the job:** the earlier draft's own gap still holds —
  `spell_damage_strong`'s own, unconditional `lda bt_dmg_lo`/`lsr a`/`bne`/`lda #1` floors *any* zero
  reaching the halving step back to `1`, so simply dropping `spell_damage_mdef_floor`'s own `lda #1`
  does not give a resistant target a true zero — but distinguishing "zero because defence already
  produced it" from "zero because a small positive number halved down to it" needs no new state at
  all, because the two cases are already distinguishable *before* the `lsr` runs: a value magic defence
  drove to exactly `0` arrives at `spell_damage_strong` as a literal `0`; the only other way to reach
  `spell_damage_strong` with a post-halving zero is an incoming `1` (halving anything `2` or above
  leaves a nonzero result), and `1` is not `0`. So the fix is one conditional branch, gated on the
  identical `MAGIC_DEFENCE_ENABLED` flag magic defence's own code already checks throughout, reading
  the incoming value *before* it is touched: `lda bt_dmg_lo` / `.if MAGIC_DEFENCE_ENABLED` / `beq
  spell_damage_done` / `.endif` / `lsr a` / ... — an incoming literal `0` (defence's own doing) takes
  the branch and returns `0` untouched; an incoming `1` (today's own ordinary small-roll case) does not
  take it, falls through to the unchanged `lsr`/`bne`/`lda #1`, and still floors to `1` exactly as it
  does today. **Two bytes** (`beq`, a relative branch), assembled only under `MAGIC_DEFENCE_ENABLED` so
  mag-only bytes are unaffected. The other half of the change — letting `spell_damage_mdef_floor` (§7's
  own listing) actually produce a literal `0` instead of flooring to `1` — is not an addition but a
  *removal*: dropping its own `bne spell_damage_mdef_floor` / `lda #1` pair (the floor-to-1 arm) leaves
  `sec`/`sbc bt_dmg_lo`/`bcs spell_damage_mdef_done`/`lda #0` — `8` bytes where the recommended design's
  block costs `12`, `4` bytes cheaper. Net over the recommended floor-1 design: `-4 + 2 = -2` — **floor
  0 costs 2 bytes less than floor 1, no new scratch byte, mag-only bytes unaffected either way** — not
  the "4-6 more bytes and a new flag" an earlier draft of this passage claimed. Still not free of
  consequence — `spell_damage_strong`'s own unmodified floor stays
  in place for every other zero-adjacent case (an incoming `1`), so the change is genuinely scoped to
  "a value magic defence itself drove to exactly zero," not a wider change to resistance behaviour —
  and a floor-0 build would need its own test (a resistant-target hit with `mdef` exactly equal to
  `roll + mag`, asserting a true `0` rather than the `1` today's floor would produce), which this
  document does not add since floor 1 remains the recommendation.

Both alternatives are real, playable choices — recorded here, priced, and left for Chris precisely
because the codebase's own established precedent (§13's own traps 1/6, and `physical_damage`'s
shape) already answers them the same way magic power's own additive-vs-multiplicative question was
answered in §2: match what already exists unless there is a reason not to, and there is not one
here. §6 onward builds the recommended path — before-the-modifier, floor 1, damage only — in full.

## §6. Q5 — schema

**Party member:** `baseMag: 0, magPerLevel: 0` added to `createPartyMember` (`shared/project.js:
3981-4001`), immediately after `defPerLevel`. **Default zero, not `baseAtk`'s `6`/`atkPerLevel`'s
`1`.** `normalizePartyMember`'s own `num(key, min, max)` helper (`:5046`) falls back to
`createPartyMember`'s default for any *missing* key — so a non-zero default here would silently give
every already-saved project's existing party members nonzero magic power the instant their project
is next opened, changing every exact-damage assertion in `rpg.test.js` and `sample-rpg`'s own
gameplay balance with no author action at all. Clamped the same range `atkPerLevel`/`defPerLevel`
already use: `baseMag` 0-255, `magPerLevel` 0-16 (not `character.js`'s own already-wrong 0-32 for the
existing fields — §0's own citation of that mismatch; this design's new field must not copy it).

**Actor:** `mag: clamp(battle.mag, 0, 255, 0)` added to the actor battle normalizer
(`shared/project.js:4957-4967`), beside `atk`/`def`. Default zero for the identical migration-safety
reason.

**Magic defence — the identical shape, added this round, beside each of the above.** Party member:
`baseMdef: 0, mdefPerLevel: 0` added to `createPartyMember` immediately after `magPerLevel` (so the
finished object literal reads `..., baseDef, defPerLevel, baseMag, magPerLevel, baseMdef,
mdefPerLevel, speed, ...`), clamped identically — `baseMdef` 0-255, `mdefPerLevel` 0-16 — default
zero for the identical migration-safety reason `baseMag` already has: a nonzero default would
silently arm every existing project's party members with defence they never authored. Actor: `mdef:
clamp(battle.mdef, 0, 255, 0)` added to the actor battle normalizer beside `mag`. Default zero for
the same reason.

**`projectUsesMagicPower(project)`:** true when any party member has `baseMag > 0 || magPerLevel > 0`,
or any actor has `battle.mag > 0` — the exact shape `projectUsesItems` (`:5930-5932`) already takes
for "an author's authored choice, taken at face value," not a resolved-reachability question. This is
the single predicate `MAGIC_POWER_ENABLED` (§8), the table-emission gate (§9), and
`battleRegionBytes`'s own new term (§9) all read — one writer, the same discipline `fontBankSplit`/
`projectUsesText` already hold each other to (CLAUDE.md, "The message font").

**`projectUsesMagicDefence(project)` — the identical shape, its own separate predicate, deliberately
not folded into `projectUsesMagicPower`.** True when any party member has `baseMdef > 0 ||
mdefPerLevel > 0`, or any actor has `battle.mdef > 0`. A project can author one stat and not the
other (a monster with `mdef` but no `mag`, say), and the two predicates have to disagree in that
case for `MAGIC_POWER_ENABLED`/`MAGIC_DEFENCE_ENABLED` (§8) to gate each stat's own code
independently — folding them into one predicate would make either stat alone turn *both* flags on,
assembling `combatant_mag` into a build that never uses it. §8 states the CLAUDE.md rule this follows
and the delta-measurement trap that makes it worth stating twice.

**Save-record consequence: none, for either stat.** `saveIdentity` (`shared/save.js:224-269`) folds
counts, never a stat value, and `baseAtk`/`atkPerLevel` changing today already does not invalidate a
save — `pc_atk`/`pc_def` have no cached RAM byte at all (§0's own `party_apply_level` citation), so
nothing about them is ever serialized to begin with. `combatant_mag`/`combatant_mdef` both follow the
identical no-cache shape (§7): a save stores `pc_level` and `party_restore`/`party_apply_level`
recompute everything level-dependent against the *current* build's own tables on load, `BE_RESTORE`'s
own reason for existing (`engine/save.asm:543-550`). `SAVE_LAYOUT_VERSION` does not move for either
addition.

**`samplegen.test.js` consequence — corrected in round 2, the v1 claim had the mechanism backwards.**
The RPG generators do not omit `baseAtk`/`atkPerLevel` and rely on a runtime fallback — they **spread
`createPartyMember`'s own return value literally into the generated JSON**: `tools/make-rpg-
sample.js:283-288` and `tools/make-rpg-save-sample.js:288-289` both write `{ ...createPartyMember(id,
name), ... }`, so the checked-in fixture's own `party.json` already carries `baseAtk: 6`,
`atkPerLevel: 1`, etc. as literal values written at the moment the fixture was last generated, not
values a normalizer fills in later. **No generator edit is needed for a `0`/`0` `baseMag`/
`magPerLevel` default — true — but this is not because a nonzero default would break
`samplegen.test.js`'s own load-equality check.** It would not: `samplegen.test.js` compares a fresh,
in-memory run of the generator against the checked-in fixture loaded through `normalizeProject` (never
regenerating the fixture on disk, per CLAUDE.md's "Fixtures never regenerate in place"), and *both*
sides resolve a new field to whatever `createPartyMember`'s **current** default is — the fresh run via
the literal spread, the checked-in fixture (which predates the field and so lacks the key entirely)
via `normalizePartyMember`'s own fallback — so the two would agree regardless of what that default
is, zero or not. **The zero default is necessary for a different reason, already stated above and
restated here for the generator question specifically: unchanged gameplay on every already-saved
project, and a working feature gate** — `projectUsesMagicPower` (below) has to read `0` as "this
project never authored the stat," which only holds if `0` is what every pre-existing project's party
members already have. The identical reasoning holds for `baseMdef`/`mdefPerLevel` and
`projectUsesMagicDefence` — no generator edit needed, same zero-default requirement, same mechanism.

## §7. Q6 — the engine, complete

**`combatant_mag`, immediately after `combatant_def` (`engine/battleturn.asm:660-681`).** Mirrors
`combatant_atk`/`combatant_def` exactly — same register contract, same save/restore shape, same
monster-side indirection:

```asm
; A = combatant index in (0-3 party, 4-7 monster -- the one shared index space
; every combatant_* lookup already uses). Returns A = mag(combatant), and
; leaves it staged in bt_ret too (used by both call sites below, which need
; the value to survive a second jsr that would otherwise clobber A).
; Preserves X and Y (saved to bt_x/bt_y, restored before the final reload),
; flags described by the reloaded A per CLAUDE.md's own "a routine returning
; a value must set the flags from that value" trap. Clobbers bt_tmp via
; level_row on the party path (never on the monster path). Never touches
; bt_tmp2. Assembled only under MAGIC_POWER_ENABLED.
  .if MAGIC_POWER_ENABLED
combatant_mag:
  stx bt_x                  ; abs, 4
  sty bt_y                  ; abs, 4
  cmp #MAX_PARTY             ; imm, 2
  bcs combatant_mag_mon       ; 2/3
  tax                          ; 2
  txa                          ; 2
  jsr level_row                 ; 6 (+ level_row's own body, 31-56 cyc by member)
  lda pc_mag_at,y                ; abs,y 4
  jmp combatant_mag_ret            ; abs 3
combatant_mag_mon:
  sec                           ; 2
  sbc #MAX_PARTY                 ; imm 2
  tax                             ; 2
  ldy mon_slot_actor,x              ; abs,x 4
  lda mon_mag,y                      ; abs,y 4
combatant_mag_ret:
  sta bt_ret                          ; abs 4
  ldx bt_x                             ; abs 4
  ldy bt_y                              ; abs 4
  lda bt_ret                             ; abs 4
  rts                                     ; 6
  .endif
```

**Trap 10, closed in the listing above, not merely in prose.** The monster path reads `mon_mag`
through `mon_slot_actor,x` — a battle *slot* (0-3 within the 4-7 combined range) is not an *actor
id*: two formation slots can name the same actor (two of the same monster type in one battle), so
`mon_mag,x` (indexing the table with the raw slot number) would either read a different actor's own
stat entirely or, once the formation has more live slots than the project has distinct actors, index
past the table outright. `ldy mon_slot_actor,x` first resolves the slot to its actor id, exactly the
indirection `combatant_atk_mon`/`combatant_def_mon` already use — `mon_mag` is keyed by actor id, the
same as `mon_atk`/`mon_def`.

**`combatant_mdef`, immediately after `combatant_mag`.** Byte-for-byte the identical shape — same
register contract, same save/restore, same monster-side indirection — reading `pc_mdef_at`/`mon_mdef`
instead of `pc_mag_at`/`mon_mag`, gated on its own, separate `MAGIC_DEFENCE_ENABLED` (§8):

```asm
; A = combatant index in. Returns A = mdef(combatant), staged in bt_ret too
; (the identical convention combatant_atk/def/mag already use, kept even
; though spell_damage's own call site below parks the result in bt_dmg_lo
; instead, immediately after the call -- bt_ret would otherwise be clobbered
; by the combatant_mag call that follows it). Preserves X and Y. Clobbers
; bt_tmp via level_row on the party path. Never touches bt_tmp2, bt_dmg_lo
; or bt_dmg_hi anywhere in its own body. Assembled only under
; MAGIC_DEFENCE_ENABLED.
  .if MAGIC_DEFENCE_ENABLED
combatant_mdef:
  stx bt_x                    ; abs, 4
  sty bt_y                    ; abs, 4
  cmp #MAX_PARTY               ; imm, 2
  bcs combatant_mdef_mon         ; 2/3
  tax                            ; 2
  txa                            ; 2
  jsr level_row                   ; 6 (+ level_row's own body, 31-56 cyc by member)
  lda pc_mdef_at,y                  ; abs,y 4
  jmp combatant_mdef_ret              ; abs 3
combatant_mdef_mon:
  sec                             ; 2
  sbc #MAX_PARTY                   ; imm 2
  tax                               ; 2
  ldy mon_slot_actor,x                ; abs,x 4
  lda mon_mdef,y                        ; abs,y 4
combatant_mdef_ret:
  sta bt_ret                            ; abs 4
  ldx bt_x                               ; abs 4
  ldy bt_y                                ; abs 4
  lda bt_ret                               ; abs 4
  rts                                       ; 6
  .endif
```

The identical Trap 10 shape applies here too: `ldy mon_slot_actor,x` resolves the battle slot to its
actor id before indexing `mon_mdef`, for the identical reason `combatant_mag_mon`/`combatant_
atk_mon`/`combatant_def_mon` all already need it.

**Measured: `combatant_mdef` alone assembles to exactly 44 bytes on every RPG-capable board** —
identical to `combatant_mag`'s own measured 44 (§9), confirmed by isolating the routine (temporarily
reverting `spell_damage`'s own call-site addition, rebuilding) rather than assumed from the two
routines' identical shape. The two routines cost the same because they *are* the same shape, byte
for byte, down to every operand's addressing mode — only the table names differ, and a table name
costs nothing at assembly time.

**The call sites.** Both `spell_damage` and `cast_heal` insert the identical magic-power shape: call
`combatant_mag` with `bt_actor` — the caster's own index, on **either** side — before rolling, then
add the staged `bt_ret` into the roll after it returns, saturating at `$FF`. Magic defence touches
only `spell_damage` (§5: `cast_heal` has no defending target), calling `combatant_mdef` with
`bt_target` — the one being hit — *before* the magic-power call, so its own result can be parked
somewhere that survives both the `combatant_mag` call and the roll.

**Where magic defence parks its own value, verified rather than assumed.** Magic power already
established the pattern: stage the value in a byte nothing in `roll_spell_amount`/`mod8` touches, so
it survives the roll untouched (Trap 1, below). Magic defence needs a *second* such byte live at the
same time — `bt_ret` is already spoken for by `combatant_mag`'s own staged answer, and re-using it
for `mdef` too would mean one of the two values gets clobbered the moment the other's own call runs.
`bt_tmp2` is `cast_all`'s own end-of-side sentinel across this entire call chain (Trap 2) and is never
a candidate. `bt_tmp` is clobbered by `level_row` on `combatant_mag`/`combatant_mdef`'s own party
path (Trap 1) and separately used by `mod8` — also not a candidate. **The byte that works: `bt_dmg_lo`
— dead at the top of `spell_damage`, because the routine's own first write to it (`sta bt_dmg_lo`, the
existing `:736`) is what stores the rolled amount, and nothing before that point in the routine, or
in either of `spell_damage`'s own two callers (`cast_spell_dmg`'s `jsr spell_damage`, `cast_all_
loop`'s identical call), reads `bt_dmg_lo` first.** Confirmed by reading `roll_spell_amount`/`mod8`
in full this round (`engine/battleturn.asm:690-729`) rather than trusting the pair's own existing
contract comment, which names `bt_tmp`/`bt_tmp2`/`Y` explicitly but never `bt_dmg_lo` by name: neither
routine's body references `bt_dmg_lo` anywhere, and neither does `rng_next` (`engine/rpg.asm:14-24`,
also re-read in full, touching only `A` and `rng`). The sequence is therefore: `combatant_mdef` into
`bt_dmg_lo` first, `combatant_mag` into `bt_ret` second (neither call touches the other's byte), the
roll third (touches neither), then add `bt_ret`, then subtract `bt_dmg_lo`, floor, and *only then*
does `spell_damage` make its own first write to `bt_dmg_lo` — overwriting the now-consumed `mdef`
value with the final result, exactly where the unmodified routine already wrote its own answer. No
new equate needed.

**Complete, both routines — F13's own round-2 correction: v1 truncated both with a trailing `...`,
which the brief's own convention #3 refuses ("the whole routine... never a sketch of one"). Every
line below, including the entire unchanged tail, is re-read from `engine/battleturn.asm` at HEAD
`eab9eb0` as it stands today — `spell_damage`'s own listing rewritten again this round to carry both
stats:**

```asm
; A/X/Y contract, stated honestly for the whole call chain -- corrected in
; round 3, after review found the previous version wrong on both counts it
; tried to make; extended this round for magic defence's own two new
; blocks, which change nothing about the contract already established for
; magic power's own two. Entry: none required (bt_arg, bt_actor, bt_target
; are read from RAM, not passed in registers). What this design's own
; insertions preserve is narrower than what the routine as a whole does:
; combatant_mag and combatant_mdef (above) both preserve X and Y across
; their own calls and stage their answers in bt_ret (mag) and bt_dmg_lo
; (mdef, via the call site's own immediate `sta`, not combatant_mdef's own
; internal staging -- see "Where magic defence parks its own value," above),
; so all four new `.if` blocks at the top of spell_damage disturb neither
; register -- but spell_damage's own very next line after them, `ldx
; bt_arg`, already overwrites X immediately afterward regardless, the
; identical assignment that ran there before either design existed, so X's
; value on entry to spell_damage was never something the rest of the
; routine preserved anyway. `roll_spell_amount`/`mod8` (`:683-729`) clobber
; Y on a *ranged* roll -- `mod8`'s own `ldy #8` counting down to 0 -- but
; not on a *flat* one (`spell_amount_n == 1` takes the no-roll branch,
; touching neither RNG nor Y at all); a party target's own `ldy mon_slot_
; actor,x` (at today's `:745`) never runs at all (skipped by `bcc spell_
; damage_done`), so Y on exit for a party target is 0 after a ranged roll,
; or whatever it held on entry after a flat one -- neither of which any
; caller reads. For a monster target, the unconditional `ldy mon_slot_
; actor,x` overwrites whatever the roll left in Y regardless, so Y on exit
; there is always the resolved monster's own actor id. X ends up wherever
; the pre-existing `tax`/reload sequence at `:744-746` (unchanged, below)
; leaves it -- the monster-slot index, then immediately reloaded from
; `bt_arg` for `spell_element,x` at `:747`, for a reason wholly unrelated
; to either design. A is whatever the last touched instruction leaves it;
; nothing downstream reads it back from either exit path.
spell_damage:
  .if MAGIC_DEFENCE_ENABLED
  lda bt_target
  jsr combatant_mdef         ; A = mdef(bt_target); X/Y untouched
  sta bt_dmg_lo               ; park it -- dead here (see above); the roll's
                               ; own first write to bt_dmg_lo is below, well
                               ; after this value has been consumed
  .endif
  .if MAGIC_POWER_ENABLED
  lda bt_actor
  jsr combatant_mag          ; bt_ret = mag(bt_actor); X/Y untouched;
                              ; bt_dmg_lo untouched
  .endif
  ldx bt_arg
  jsr roll_spell_amount
  .if MAGIC_POWER_ENABLED
  clc
  adc bt_ret
  bcc spell_damage_mag_ok
  lda #$FF                    ; saturate: no high byte to promote into --
                               ; bt_dmg_hi doubles as the XP accumulator and
                               ; $FF already means "no number" (:760-762's own
                               ; comment, unchanged, gives the same reason)
spell_damage_mag_ok:
  .endif
  .if MAGIC_DEFENCE_ENABLED
  sec
  sbc bt_dmg_lo                ; (roll [+ mag]) - mdef; bt_dmg_lo still
                                ; holds the parked mdef value from above
  bcs spell_damage_mdef_floor   ; no underflow: A is the real difference
  lda #0                         ; mdef exceeded the roll: force 0, the
                                  ; identical idiom physical_damage_floor
                                  ; (engine/battleturn.asm:617-619) already
                                  ; uses for atk-def
spell_damage_mdef_floor:
  bne spell_damage_mdef_done      ; nonzero: the subtraction already stands
  lda #1                           ; zero, whether forced above or exact:
                                    ; floor at 1, "even a hopeless attack
                                    ; scratches" (physical_damage_floor,
                                    ; :620-621) applied to the spell side
spell_damage_mdef_done:
  .endif
  sta bt_dmg_lo
  lda #0
  sta bt_dmg_hi
  lda bt_target
  cmp #MAX_PARTY
  bcc spell_damage_done     ; elements only describe monsters -- unchanged
  sec
  sbc #MAX_PARTY
  tax                        ; X clobbered here -- unchanged from today, and
                              ; the reason the next line already reloads it
  ldy mon_slot_actor,x
  ldx bt_arg                  ; X reloaded from bt_arg -- this line already
                               ; existed at today's :746 for a reason wholly
                               ; unrelated to either design's own insertion
                               ; (spell_element,x needs it back); untouched
  lda spell_element,x
  beq spell_damage_done     ; an elementless spell has nothing to match
  cmp mon_weak,y
  beq spell_damage_weak
  cmp mon_strong,y
  beq spell_damage_strong
  rts
spell_damage_weak:
  lda bt_dmg_lo             ; one and a half times
  lsr a
  clc
  adc bt_dmg_lo
  bcc spell_damage_weak_store
  lda #$FF                  ; carried past 255: saturate rather than wrap --
                             ; there is no high byte to promote into
                             ; (bt_dmg_hi doubles as the XP accumulator and
                             ; $FF means "no number")
spell_damage_weak_store:
  sta bt_dmg_lo
  rts
spell_damage_strong:
  lda bt_dmg_lo
  lsr a
  bne spell_damage_store
  lda #1
spell_damage_store:
  sta bt_dmg_lo
spell_damage_done:
  rts
```

**`cast_heal` carries no `MAGIC_DEFENCE_ENABLED` block anywhere — deliberately, per §5.** A heal has
no defending target, so magic defence adds nothing here; the listing below is `cast_heal` with only
magic power's own two blocks, unchanged from what §7 already established, re-read in full again this
round to confirm nothing about it needed to change:

```asm
; A/X/Y contract, corrected a third time in round 5 -- round 4's own fix
; still skipped a real frame in the chain and so still landed `battle_say`'s
; `rts` one hop too far downstream. cast_heal has no `rts` of its own, but
; that does NOT mean there is no return address to protect: a tail call
; preserves the *existing* one, it does not eliminate it. `grep -n cast_spell
; engine/battleturn.asm` finds exactly two call sites, `:181` and `:881`, and
; BOTH are `jmp cast_spell`, never `jsr` -- there is no `jsr cast_spell`
; anywhere in the engine.
;
; The real chain, every hop read and cited, not assumed: `call_battle`
; (`engine/banks.asm:410-415`) does `jsr battle_entry` (`:414`) -- return
; address #1, consumed only at the very end of this trace. `battle_entry`'s
; own `BE_TICK` dispatch reaches `battle_tick` by `jmp` (`engine/battle.asm`
; `battle_entry_tick:24-27`), so no new return address yet. `battle_tick`
; itself (`engine/battle.asm:233-236`) is `jsr wipe_tick / jsr battle_dispatch
; / jmp battle_draw_sprites` -- `jsr battle_dispatch` at `:235` is return
; address #2, the one every hop below actually answers to, NOT return
; address #1; missing this exact `jsr` is what round 4's own trace still got
; wrong. `battle_dispatch` (`:288-…`) reaches its phases by `jmp`, down
; through `battle_act`/`cast_spell`/`cast_heal` exactly as before -- still no
; new return address anywhere in that whole descent. cast_heal's own tail,
; `cast_heal_say`, ends `jsr print_num` (a self-contained call, resolved
; before the next line runs, so it never touches this outer chain) then
; `lda #BS_HEALS / jmp battle_say_actor`, into `engine/battleui.asm`.
; `battle_say_actor` (`:584-587`) stores A into `bt_str` and falls into
; `battle_say` (`:590-614`), which calls `queue_at`, `push_combatant_name`
; and `push_battle_string` -- both of the latter (`:618-664`, `:668-704`)
; use X and Y freely with no save/restore discipline -- before `battle_say`'s
; own `rts` (`:614`), which consumes return address #2 and lands back in
; `battle_tick` at `:236`, `jmp battle_draw_sprites` -- NOT in `call_battle`,
; and the A it carries there (`BP_MESSAGE`, loaded at `:612` immediately
; before the `rts`) is never read: `:236` is an unconditional `jmp`, and
; `battle_draw_sprites`'s own very first instruction, `lda #$FF`
; (`engine/battleui.asm:833`), overwrites A before anything else runs.
; `battle_draw_sprites` freely uses X/Y throughout its own body and ends
; with its own `rts` (`:931`), which is what finally consumes return address
; #1 and lands back in `call_battle`, whose own next line is
; `jmp set_screen_ptr` (`engine/banks.asm:415`), unconditional -- reading
; none of A, X or Y from that return either. No caller anywhere in this
; entire chain ever sees `cast_heal`'s own A. Two claims this design can
; make about its own insertion, no more: `combatant_mag` preserves X and Y
; across its own call (above), and neither `spell_damage` nor `cast_heal` was
; changed to clobber X or Y any differently than they
; already did before this design existed.
cast_heal:
  .if MAGIC_POWER_ENABLED
  lda bt_actor
  jsr combatant_mag          ; bt_ret = mag(bt_actor); X/Y untouched
  .endif
  ldx bt_arg
  jsr roll_spell_amount
  .if MAGIC_POWER_ENABLED
  clc
  adc bt_ret
  bcc cast_heal_mag_ok
  lda #$FF
cast_heal_mag_ok:
  .endif
  sta bt_tmp
  lda bt_actor
  cmp #MAX_PARTY
  bcs cast_heal_mon
  tax                        ; X clobbered here -- unchanged from today; this
                              ; is the "later tax on bt_actor" F13 asked to be
                              ; stated explicitly, and it runs well after the
                              ; combatant_mag call above has already returned
                              ; and restored X to whatever it held on entry
  lda #0
  sta pc_status,x
  lda pc_hp,x
  clc
  adc bt_tmp
  bcs cast_heal_max         ; wrapped past 255: certainly over this member's max
  cmp pc_hp_max,x
  bcc cast_heal_store
cast_heal_max:
  lda pc_hp_max,x
cast_heal_store:
  sta pc_hp,x
  jmp cast_heal_say
cast_heal_mon:
  sec
  sbc #MAX_PARTY
  tax
  lda #0
  sta mon_slot_status,x
  lda mon_slot_hp,x
  clc
  adc bt_tmp
  bcs cast_heal_mon_max     ; wrapped past 255: certainly over this slot's max
  cmp mon_slot_max,x
  bcc cast_heal_mon_store
cast_heal_mon_max:
  lda mon_slot_max,x
cast_heal_mon_store:
  sta mon_slot_hp,x
cast_heal_say:
  lda bt_tmp
  sta bt_dmg_lo
  lda #0
  sta bt_dmg_hi
  jsr print_num
  lda #BS_HEALS
  jmp battle_say_actor
```

**Trap 1, closed by ordering, not by finding a new scratch byte.** `cast_heal` today parks its rolled
amount directly in `bt_tmp` (`sta bt_tmp`) the instant `roll_spell_amount` returns — and `bt_tmp` is
exactly what `level_row`, reached through `combatant_mag`'s own party-side branch, clobbers first
(`engine/battle.asm:210`). Calling `combatant_mag` *before* `roll_spell_amount`, rather than after,
avoids the conflict entirely rather than working around it: `combatant_mag`'s own answer is staged in
`bt_ret`, a byte `roll_spell_amount`/`mod8` never touch (their own contract comment, `:683-689`, says
so explicitly), so it survives untouched across the roll and is still valid when the add reads it —
`bt_tmp` is not written until *after* the add, by which point `combatant_mag`'s own use of it is long
finished. No stack push/pop is needed, and no new scratch byte is claimed.

**Trap 2, verified rather than merely asserted.** `bt_tmp2` is `cast_all`'s own end-of-side sentinel,
live across the entire `spell_damage` call it makes once per surviving target (`:305-324`). Neither
`combatant_mag` nor either call-site addition above reads or writes `bt_tmp2` anywhere — confirmed by
reading every line of the listing, not merely reasoning about it — so `rpg.test.js`'s existing
`'an all-target spell rolls independently per target'` test (`:2125`) remains the correct regression
guard with no change: it already proves `bt_tmp2` survives the *existing* call chain, and this design
adds nothing to that chain that could disturb it.

**Trap (magic defence), `bt_dmg_lo` clobbered by `spell_damage`'s own first write — closed by parking
`mdef` there *before* that write happens, the identical shape Trap 1 already uses for `bt_tmp`.**
`spell_damage`'s own unmodified body first writes `bt_dmg_lo` only after the roll (and, when magic
power is live, after the add) resolve — "Where magic defence parks its own value," above, is the
full derivation; restated here as its own trap because it is the mirror image of Trap 1, not a
restatement of it: Trap 1 is about a byte magic power's own add must avoid clobbering (`bt_tmp`,
owned by `level_row`/`cast_heal`'s own parked roll); this one is about a byte magic defence's own
subtraction *deliberately* writes into, on a timeline verified to never collide with anything that
still needs the old value.

**Trap 6, the "reload A last" flag rule, closed identically to `combatant_atk`/`combatant_def`.**
`combatant_mag_ret`'s own `sta bt_ret / ldx bt_x / ldy bt_y / lda bt_ret / rts` is character-for-
character the shape `combatant_atk_ret`/`combatant_def_ret` already use — the restores of `bt_x`/
`bt_y` happen *before* the final `lda bt_ret`, so the flags callers see on return describe the mag
value, not the register restore.

**Trap 5, the flat-spell (`spell_amount_n == 1`) path stays RNG-free.** `combatant_mag` never calls
`rng_next` anywhere in its body — `level_row` is pure arithmetic over `pc_level`/`pc_mag_at`, and the
monster path is a pair of table reads. The add wraps *around* `roll_spell_amount`, never modifies its
internals, so `roll_spell_amount_flat`'s own `lda spell_amount_min,x / rts` (unchanged) still consumes
no RNG regardless of whether magic power is live — `rpg.test.js:1834`'s existing guard remains valid
with no change needed to it. `combatant_mdef` is the identical shape (`level_row`/table reads only,
no `rng_next` anywhere in its own body either) and sits entirely outside `roll_spell_amount` too, so
the flat-spell path stays RNG-free with magic defence live, or both stats live, exactly as it does
with magic power alone.

**X/Y contract at every call site, stated rather than left implicit.** `combatant_mag`/`combatant_
mdef` both preserve X and Y across their own calls (saves to `bt_x`/`bt_y`, restores before
returning), so whatever a call site's X held *before* the `jsr` is exactly what it holds *after* —
and every site immediately discards that prior value anyway (`spell_damage`'s very next line after
either or both new blocks is `ldx bt_arg`; `cast_heal`'s is the same), so neither call's placement
before `roll_spell_amount` costs anything in either routine's own X-register needs. `combatant_mdef`
runs *before* `combatant_mag` in `spell_damage` (§7's own listing), and the same reasoning applies
between the two: `combatant_mag`'s own call is unaffected by whatever X/Y `combatant_mdef` leaves
behind, since `combatant_mag` saves and restores its own copy regardless of what it inherits.
`spell_damage`'s own pre-existing reload of X from `bt_arg` at its unchanged `:746` (after the
monster-slot `tax` at `:744` clobbers it) is untouched by either insertion — it already reloads X
for a completely unrelated reason, further down in the same routine.

**Trap 8, branch range — confirmed by successful assembly, not merely argued.** A prototype of this
exact listing, gated on `MAGIC_POWER_ENABLED`, was built with `nesasm v3.1` against `sample-rpg` on
all three RPG-capable boards (§9's own measurement); nesasm reported zero "branch out of range"
errors on any of them. This round's own prototype — `combatant_mdef` and `spell_damage`'s full,
four-`.if`-block listing above, `MAGIC_DEFENCE_ENABLED` on alone, `MAGIC_POWER_ENABLED` on alone, and
both together — was built the identical way on the identical three boards (§9), and also reported
zero "branch out of range" errors in any configuration. nesasm's own branch-range check is a hard
assembler error, not a silent truncation (unlike the backward-`.org` trap CLAUDE.md's own "6502
traps" list records elsewhere), so a future engine change that moves either insertion point relative
to a tight existing branch will fail loudly at build time rather than corrupting anything — this
design does not need to hand-audit every nearby branch's own distance, only note that the assembler
is the actual check, and that it already passed against the real insertion points above, in every
combination this document builds.

**Trap 9, nesasm's 31-character label limit.** Every new label introduced above: `combatant_mag`
(13), `combatant_mag_mon` (17), `combatant_mag_ret` (17), `spell_damage_mag_ok` (19), `cast_heal_
mag_ok` (16), and, added this round, `combatant_mdef` (14), `combatant_mdef_mon` (18),
`combatant_mdef_ret` (18), `spell_damage_mdef_floor` (23), `spell_damage_mdef_done` (22). The
longest across both stats is 23 characters (`spell_damage_mdef_floor`), still clear of the
30-character cliff CLAUDE.md's own "The Code Forge" section records (nesasm v3.1 aborts with a
glibc buffer-overflow crash, exit 134, at 31+ characters).

**Trap 7, `hex()`'s own `& 0xff` masking an `undefined` field to `$00` silently.** `battle.mag`/
`battle.mdef` are never `undefined` on the compiled path: `normalizeActor` (§6) always writes a
clamped number for both, falling back to `0` via `clamp(battle.mag, 0, 255, 0)`/`clamp(battle.mdef,
0, 255, 0)` exactly the way `atk`/`def` already do — there is no
migration step here (unlike `design-magic.md` §12's own `amountMin`/`amountMax` migration, which
briefly left `spell.amount` read by code that no longer wrote it) that could leave the field absent
on an in-memory project between one version's schema and the next, because this is a **new** field
with a **build-time-computed** default, not a renamed or restructured existing one. **The direction
that is actually guaranteed, stated precisely after round 2 correction: an older project reopened by
a new app migrates cleanly, not the reverse.** A project saved *before* this field existed genuinely
lacks `baseMag` in its own JSON, so `raw?.baseMag` really is `undefined` there, and
`normalizePartyMember`'s own `num()` helper (`clamp(undefined, min, max, base[key])`,
`shared/project.js:5044-5076`) falls back to `createPartyMember`'s `0` default exactly as intended —
the zero-default migration this design relies on. The *other* direction is not a safe round-trip and
this document does not claim it is: a project saved by a version of the app that knows `baseMag`, then
**reopened by an older app that predates this field**, has `baseMag` genuinely present in `raw` — the
old `normalizePartyMember` simply never reads or returns it, since its own return object has no such
key, so re-saving from that older app silently **drops the field**, the ordinary "an old build cannot
round-trip a newer project's own new fields" consequence every schema addition already has, not
something specific to `baseMag`. The identical reasoning, unchanged, covers `baseMdef`/`mdefPerLevel`
and `battle.mdef` — new fields with the same build-time-computed default, the same guaranteed
direction, the same non-hazard.

**Cycle cost, from the instructions actually written above, priced the `design-magic.md` §8 way**
(NTSC frame budget ≈ 29,780 cycles). **Every `bt_*`/`pc_*`/`mon_*` operand below is absolute
addressing, never zero-page mode — this codebase's engine files never use the `<` prefix nesasm needs
to force zero-page addressing on an operand whose address happens to be under `$100`, confirmed
empirically this round (§9's own measurement reconciliation) and consistent with the existing
`nesasm-zero-page-is-absolute` finding from an earlier slice — but "absolute" is not one uniform
cost, and round 2 review found v1's own blanket "3 bytes, 4 cycles" wrong to state as if it covered
every instruction shape: a plain absolute load or store (`lda`/`sta`/`cmp`/`adc`/`sbc` on a bare
operand) is 3 bytes and 4 cycles, exactly as stated below wherever that shape appears; a
read-modify-write on an absolute operand (`asl`/`lsr`/`rol`/`ror`/`inc` — `mod8`'s own `asl bt_tmp`
at `engine/battleturn.asm:720` is the existing, stock example) is 3 bytes but **6 cycles**, always
labeled `abs-rmw` below and in §2's `mulscale` listing, never conflated with the 4-cycle figure; an
absolute-indexed **store** (`sta foo,x`/`sta foo,y`) is **5 cycles**, one more than an indexed load —
corrected in round 3: the completed `cast_heal` listing below does contain several (`sta pc_status,x`,
`sta pc_hp,x`, `sta mon_slot_status,x`, `sta mon_slot_hp,x`), all unchanged stock instructions this
design does not add or touch, so they cost nothing new — but neither this design's own added lines nor
`mulscale` (§2) contains a new one; and an absolute-indexed **load**
(`lda pc_mag_at,y`, `ldy mon_slot_actor,x`, `lda mon_mag,y` below) is 4 cycles *unless* the indexed
access crosses a 256-byte page boundary, in which case it costs 5 — not accounted for below, since
whether `pc_mag_at`/`mon_mag`'s own table layout ever places a live index across such a boundary
depends on the generated table's real address, not on anything this listing alone can state; every
figure below is therefore a same-page lower bound, not an unconditional exact count.**

- `combatant_mag`'s party path (excluding `level_row`): `stx`(4) + `sty`(4) + `cmp#`(2) +
  `bcs` not taken(2) + `tax`(2) + `txa`(2) + `jsr`(6) + `lda abs,y`(4) + `jmp`(3) = 29, plus the
  return path `sta`(4)+`ldx`(4)+`ldy`(4)+`lda`(4)+`rts`(6) = 22 — **51 cycles outside `level_row`**.
- `level_row` itself (`engine/battle.asm:209-225`), for member index `m` (0-based): setup `sta
  bt_tmp`(4)+`lda#0`(2)+`ldy bt_tmp`(4) = 10, then either the `beq` branch taken (member 0: `+3`,
  skip the stride loop) or not (`+2`, run the loop `m` times at `clc`(2)+`adc#`(2)+`dey`(2)+`bne`(3
  taken/2 not — corrected in round 3, the label had taken/not-taken backwards though the totals
  already used the right numbers — only the last iteration not-taken) = `9(m-1)+8` for `m`
  iterations), then
  `level_row_add`: `clc`(2)+`adc abs,x`(4)+`sec`(2)+`sbc#1`(2)+`tay`(2)+`rts`(6) = 18. Member 0: 10 +
  3 + 18 = **31**. Member 1: 10 + 2 + 8 + 18 = **38**. Member 2: **47**. Member 3: **56**.
- `combatant_mag`, party path total: member 0 = 82, member 1 = 89, member 2 = 98, **member 3 = 107**
  cycles (the RPG's own `MAX_PARTY = 4` ceiling — `RPG_LIMITS.party = 4` bounds this at member index
  3, never higher).
- `combatant_mag`, monster path (flat, no level scaling): `stx`(4)+`sty`(4)+`cmp#`(2)+`bcs`
  taken(3)+`sec`(2)+`sbc#`(2)+`tax`(2)+`ldy abs,x`(4)+`lda abs,y`(4) = 27, plus the identical 22-cycle
  return path = **49 cycles**.
- **Call-site overhead, excluding `combatant_mag` itself — corrected in round 2: `bcc` was reversed.**
  `bcc spell_damage_mag_ok` (and `cast_heal`'s identical `bcc cast_heal_mag_ok`) branches when carry
  is *clear*, which `adc` leaves clear on the ordinary, no-overflow path — so the branch is **taken**
  (3 cycles) on the common path, not the rare one, and **not taken** (2 cycles, falling through to
  `lda #$FF`, +2 more) only on the rare saturating path: `lda bt_actor`(4) + `jsr`(6) + `clc`(2) +
  `adc bt_ret`(4) + `bcc` taken(3) = **19 cycles** typical; the same four instructions with `bcc` not
  taken(2) + `lda#$FF`(2) = **20 cycles** on saturation — the reverse of v1's own 18/21 split, which
  had the branch's likely and unlikely cases backwards.
- **Total added per spell resolution — recomputed with the corrected 19/20 overhead.** A party caster
  costs 82-107 + 19/20 = **101-126 cycles** typical, **102-127** on saturation; a monster caster costs
  49 + 19/20 = **68 cycles** typical, **69** on saturation. A full four-target `cast_all` (§0's own
  citation: `spell_damage` runs once per living target, `bt_actor` — the caster — unchanged across the
  loop, so this re-derives the identical mag value up to four times rather than caching it once;
  accepted for the same reason `roll_spell_amount`'s own per-target re-roll is accepted,
  `design-magic.md` §8's own "caching... would need more code... for a less interesting result," which
  for a *repeated identical* lookup like this one is a smaller win than it is for a fresh roll, but the
  absolute cost is small enough — see below — that the simpler, uncached shape is still the right
  trade): worst case roughly **4 x 127 = 508 cycles**, under 2% of one frame's budget, and nowhere
  near `roll_spell_amount`'s own already-accepted worst case (`design-magic.md` §8: ~9,900 cycles for
  one roll at the theoretical rejection-loop limit).

**Magic defence, priced the identical way.** `combatant_mdef` is the byte-for-byte same shape as
`combatant_mag`, so its own cycle figures are identical: party path total 82/89/98/107 by member
index (the *target's* own level this time, not the caster's), monster path a flat 49.

- **The "park" block** (`lda bt_target`(4) + `jsr combatant_mdef`(6) + `sta bt_dmg_lo`(4)) is a flat
  **14 cycles**, no branch, always taken in full.
- **The subtract/floor block** ranges over three real paths: `roll [+ mag]` still positive and
  nonzero after subtracting `mdef` — `sec`(2) + `sbc bt_dmg_lo`(4) + `bcs` taken(3) + `bne` taken(3)
  = **12 cycles**, the common case; exactly zero after subtracting — the same four instructions with
  `bne` *not* taken(2) + `lda #1`(2) = **13 cycles**; `mdef` exceeds the roll (underflow) — `bcs` not
  taken(2) + `lda #0`(2) + `bne` not taken(2) + `lda #1`(2) = **14 cycles**. Every path is 12-14
  cycles, never more.
- **Total call-site overhead for magic defence: 26-28 cycles** (14 park + 12-14 subtract/floor),
  against magic power's own 19-20 — magic defence costs slightly more per call because it runs two
  small blocks (park, then subtract/floor) rather than one.
- **Total added per spell resolution, magic defence alone:** a party target costs 82-107 + 26-28 =
  **108-135 cycles**; a monster target costs 49 + 26-28 = **75-77 cycles**. **Unlike magic power's
  own caster lookup, this one is not redundant work inside `cast_all`'s own four-target loop**: `bt_
  target` genuinely changes on every iteration (a different combatant on the opposing side each
  time), so recomputing `mdef` per target is not merely accepted the way re-deriving the same `mag`
  value four times over is (§0's own citation of `design-magic.md` §8's "caching... for a less
  interesting result") — it is the *correct* behavior, since two different targets can carry two
  different `mdef` values, and caching the first target's own reading across the other three would be
  a real defect, not a missed optimization.
- **Both stats live together, worst case — corrected this round: `cast_all` cannot produce a
  same-side caster and target at all.** `cast_all` (§0) always reaches the caster's *opposing* side —
  a party caster's own `cast_all` hits every living monster, a monster caster's hits every living
  party member — so "a caster and a target that are each the highest-index party member" describes a
  configuration this engine cannot reach. The real, reachable worst case is the higher of the two
  directions: the **highest-index (slot 3) party caster** — a matter of which of the four party
  *slots* the caster occupies, not which character *level* they have reached, corrected this round
  after an earlier pass wrote "level-3" for it: `level_row`'s own cost (`engine/battle.asm:209-225`)
  loops once per slot index below the combatant's own (`level_row_stride`, driven by `Y` counting down
  from the member index), and adds the member's actual level only once, as a single O(1) table read
  (`adc pc_level,x`) that costs the same regardless of what that level is — so it is slot 3 specifically
  that is expensive, at any level at all, never "level 3" — against four **monster** targets pays `4 x
  (127 + 77) = 508 + 308 = 816` cycles as an independent per-block bound (`127` is `combatant_mag`'s own
  party-path worst case, saturating, from §7's own figure above; `77` is `combatant_mdef`'s own
  monster-path worst case, `49 + 28`, from this section's own figure above). **Corrected again this
  round: `816`/`764` (below) each assume both blocks hit their own independent worst case on the same
  call, which the reviewer correctly points out cannot happen together — re-derived here, not copied.**
  `mdef` is clamped `0`-`255` (§6) the same as every other byte-sized stat, so it can never exceed
  `255`; the `28`-cycle figure is the subtract/floor block's *underflow* path (`mdef` exceeding the
  value being subtracted from), which requires that value to be *less* than `mdef`'s own maximum of
  `255` — but the same call's magic-power add having just taken its saturating branch means that value
  is *exactly* `255` (the `lda #$FF` store), which `mdef` can at most equal, never exceed: the
  subtract's worst reachable path on a saturated input is *exact zero* (`13` cycles, `sec`(2)+`sbc`(4)+
  `bcs` taken(3)+`bne` not taken(2)+`lda #1`(2)), one cycle cheaper than the `14`-cycle underflow path
  the `77`/`28` figures assumed. That one cycle is lost on every one of the four targets, since every
  target in this worst-case scenario is defined by the caster's own saturating add (unchanged across
  the loop) landing on each of them: `812` (forward), not `816`. **The reverse direction — a monster
  caster against four party targets does not pay `49 + 135` four times over either, because a real
  party has exactly one member at each index 0-3, not four members simultaneously at index 3's own
  cost.** The caster side is a flat `49`-cycle body regardless of level (no `level_row` lookup), so its
  own per-target total is the identical `49 + 20 = 69` cycles (saturating) the caster-side figure above
  already gives; that is what is owed once per target, four times, since `cast_all`'s own loop
  re-derives the unchanged caster's `mag` on every iteration the same way the forward direction does.
  The *target* side varies genuinely by member index across the four iterations — `combatant_mdef`'s
  own party-path body costs `82`/`89`/`98`/`107` for members 0/1/2/3 respectively (identical to
  `combatant_mag`'s own figures, §7, since the two routines are the same shape). The identical
  saturation-vs-underflow constraint applies here too — the caster's own add saturating to `255` on a
  given target caps that target's own subtract at the `13`-cycle exact-zero path, not the `14`-cycle
  underflow path — so the call-site overhead per target is `27` (`14` park `+ 13`), not `28`: `4 x 69 +
  (82 + 89 + 98 + 107) + 4 x 27 = 276 + 376 + 108 = 760`, not `764`. Summed correctly member-by-member
  rather than repeating the highest single index four times, and with the saturation/underflow
  exclusion applied: not the `736` a version of this passage previously computed by using `135`
  (`107 + 28`, member 3's own total) for every one of the four targets and `49` (the caster's raw body
  alone, omitting its own `19`/`20`-cycle call-site overhead) for the caster. `812` is therefore the
  real, exhaustively-checked worst case (`760` reverse, smaller), still under 3% of one frame's budget,
  and still nowhere near `roll_spell_amount`'s own theoretical worst case.

## §8. Q7a — gating

`projectUsesMagicPower(project)` (§6) is emitted as `MAGIC_POWER_ENABLED` in `config.inc`, the exact
shape `ITEMS_ENABLED` already takes (`main/build/generate.js:2834`): a new local `const
magicPowerEnabled = projectUsesMagicPower(project);` beside `itemsEnabled` (`:2492`), and one new
`.push`-equivalent line beside `ITEMS_ENABLED`'s own (`:2834`). `.if MAGIC_POWER_ENABLED` wraps
`combatant_mag`'s whole body and both call-site additions (§7) — **indented**, never at column 0:
nesasm v3.1 requires `.if`/`.endif` to sit in from the left margin the same way every existing
conditional in this file already does (`:226-231`'s own `.if ITEMS_ENABLED`/`.if !ITEMS_ENABLED`) —
confirmed empirically this round: a column-0 `.if MAGIC_POWER_ENABLED` produces `Unknown
instruction!`/`Label multiply defined!` from nesasm, a real, reproducible dialect quirk this design
had to discover by building, not one documented anywhere before this round (worth adding to
CLAUDE.md's own "6502 traps" list alongside the backward-`.org` and branch-range entries, in the
implementation phase, not this design round).

`pc_mag_at`/`mon_mag` (`main/build/battletables.js`, beside `pc_atk_at`/`mon_atk`) are emitted only
`if (projectUsesMagicPower(project))`, following the exact `:198-205` stub-avoidance rule
`items`/`item_heal` already established: `dbRows([])` still emits a one-byte `.db $00` for an empty
array, so an unconditional emission would cost every magic-power-off RPG real banked bytes for two
tables nothing in that build ever reads.

**Magic defence: a separate `MAGIC_DEFENCE_ENABLED`, deliberately not folded into `MAGIC_POWER_
ENABLED`.** `projectUsesMagicDefence(project)` (§6) is emitted the identical way, one line beside
`MAGIC_POWER_ENABLED`'s own; `.if MAGIC_DEFENCE_ENABLED` wraps `combatant_mdef`'s whole body and
`spell_damage`'s own two new blocks (§7), indented the same way, for the identical nesasm reason.
`pc_mdef_at`/`mon_mdef` are emitted only `if (projectUsesMagicDefence(project))`, the identical
`:198-205` stub-avoidance shape.

**Two reasons this is a second flag, not a shared one — stated because folding them together was a
real, tempting shortcut, and would have been wrong twice over.** First, CLAUDE.md's own rule: "A
conditional feature's cost is a separate generated allowance, never folded into a base" — magic power
and magic defence are two *separate* authoring choices (a project can give a monster `mdef` without
ever giving anyone `mag`, or the reverse), so they need two separate conditionals for the identical
reason `ITEMS_ENABLED` is not folded into some larger "battle features" flag: a project using only one
must not pay for, or assemble, the other. Second, **the delta-measurement trap this round's own
handoff recorded, worth naming explicitly so it is not rediscovered the hard way**: if the two stats
shared one gate, measuring either allowance in isolation — "build with the stat off, build with it on,
subtract" — would have to remove *both* stats at once to reach the true "off" baseline, since a single
shared flag cannot be off for one stat while on for the other; a test that tried to isolate just
`mag`'s own cost by toggling only `mag`-shaped fields while the shared flag stayed on regardless (its
own predicate would still see `mdef` fields elsewhere) would measure a **delta of 0** for the stat it
thought it was removing, because nothing about the gate itself changed. Two independent predicates,
two independent flags, closes this before it can happen: `MAGIC_POWER_BATTLE_ALLOWANCE`/`MAGIC_
DEFENCE_BATTLE_ALLOWANCE` (§9) are each measured by toggling *only* their own stat's fields, with the
other's gate free to be on or off independently, exactly what §9's own three-configuration
measurement (mag-only, mdef-only, both) does.

**A mag-only project must assemble byte-identically to v6's own mag-only listing — measured by
comparing actual assembled bytes, not merely a matching region size.** Equal *size* cannot rule out a
changed *operand* (two different instruction sequences can total the same byte count), so §9's own
72-byte-delta match by itself was not proof; this round's own fix built two full ROMs on all three
boards — one from a tree carrying only magic power's own code (no `MAGIC_DEFENCE_ENABLED`, no
`combatant_mdef`, no `spell_damage` mdef blocks anywhere in source, the literal v6 shape), the other
from this document's own full v7 prototype with `MAGIC_DEFENCE_ENABLED = 0` — and hashed each with
SHA-256, the identical mechanism `nameentry.test.js`'s own six-fixture gate (`:91-124`) already uses.
**Measured: identical SHA-256 on MMC1, MMC3 and UNROM 512** (`sample-rpg`, `baseMag = 5`/
`magPerLevel = 1`, naming forced off): `2fec9959…` (MMC1, 163856-byte ROM), `6c3edd4d…` (MMC3,
294928-byte ROM), `1f37c3ae…` (UNROM 512, 524304-byte ROM) — the whole ROM, not just the banked
region, byte-for-byte identical between the two trees on every board. With `MAGIC_DEFENCE_ENABLED =
0`, every line this round added to `spell_damage` (the `.if MAGIC_DEFENCE_ENABLED` park block and the
`.if MAGIC_DEFENCE_ENABLED` subtract/floor block) does strip to nothing, exactly as the size-only
comparison suggested — now confirmed at the byte level, not merely consistent with it.

**When only magic defence is live and magic power is not: `combatant_mdef` assembles, `combatant_
mag` does not exist at all, and the subtraction runs against the bare roll.** With `MAGIC_POWER_
ENABLED = 0`, `spell_damage`'s own magic-power blocks strip to nothing, so the sequence reduces to:
park `mdef` in `bt_dmg_lo`, roll, subtract `bt_dmg_lo` from the unmodified roll, floor, store — `roll
- mdef`, floored at 1, exactly the same subtraction magic power's own presence or absence never
changes, since the two stats' own `.if` blocks never read or depend on each other's gate.

## §9. Q7b — the ledger, measured

**`MAGIC_POWER_BATTLE_ALLOWANCE`, measured (not estimated), on all three RPG-capable boards.**
Prototyped exactly as §7 specifies — `combatant_mag`, both call-site additions, the two conditional
table emissions, `MAGIC_POWER_ENABLED` gating — in an isolated `git worktree` at HEAD `eab9eb0` (no
change to the working repository; the worktree was discarded after measuring), then built via
`buildProject` (`main/build/pipeline.js`) into fresh `mkdtemp` directories, mirroring `bankedbytes.
test.js`'s own `measureRegion` (`:121-148`) exactly — including forcing `party[0].renamable = false`/
`party[1].renamable = false` before the mutation under test, so naming never leaks into the figure.
`nesasm -s`'s own segment-usage table (`BANK  N   used/free`) was parsed the identical way `measure
Region` already does.

| board | magic-power off (baseline) | magic-power on | code delta | table delta |
|---|---|---|---|---|
| MMC1 | used 4731 (code 4237, tables 494) | used 4823 (code 4309, tables 514) | **72** | **20** |
| MMC3 | used 4777 (code 4283, tables 494) | used 4869 (code 4355, tables 514) | **72** | **20** |
| UNROM 512 | used 4731 (code 4237, tables 494) | used 4823 (code 4309, tables 514) | **72** | **20** |

(`sample-rpg`'s own one live item already contributes the constant +17 baked into every "off" figure
above via `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` — confirmed by the baseline matching `baseBattleCode
Bytes(mapper) + battleTableBytes(project) + 17` exactly on all three boards before any magic-power
change was applied.)

**`MAGIC_POWER_BATTLE_ALLOWANCE = 72`, flat across all three boards** — the identical reasoning
`ITEM_LIST_FILTER_BATTLE_ALLOWANCE`'s own comment already gives for why it is flat rather than
`_BY_MAPPER`: nothing in `combatant_mag` or either call site branches on `SPLIT_ENABLED` or anything
else board-specific, so MMC3's own extra 46-byte `BASE_BATTLE_CODE_BYTES_BY_MAPPER` gap (unrelated,
pre-existing) is unchanged by this addition on every board alike.

**The table delta reconciles exactly against the formula `party.length * maxLevel + actors.length`**
(when on; `0` when off), the shape Q7 predicted: `sample-rpg` has `party.length = 2`, `rpg.maxLevel =
8`, `sprites.actors.length = 4` (confirmed by direct `loadProject` inspection this round) — `pc_mag_at`
contributes `2 x 8 = 16` bytes, `mon_mag` contributes `4` bytes, summing to the measured 20 exactly on
all three boards, independent of mapper (table sizes never vary by board).

**Reconciling the 72-byte code delta against a hand tally of the listing in §7, and the finding that
produced it.** A naive byte count of §7's listing, assuming every `bt_*` operand is 2-byte zero-page
mode, totals 62 bytes (38 for `combatant_mag`, 12 per call site x 2) — 10 bytes short of the measured
72. Isolating `combatant_mag` alone (temporarily reverting both call-site additions, rebuilding)
measured a **44-byte** delta for the routine by itself, not the 38 a zero-page tally predicts; the
gap is exactly the six `bt_x`/`bt_y`/`bt_ret`-referencing instructions in the routine (`stx bt_x`,
`sty bt_y`, `sta bt_ret`, `ldx bt_x`, `ldy bt_y`, `lda bt_ret`), each one byte larger under absolute
addressing than a zero-page tally assumes. Recomputing every operand at its real absolute-addressing
size — the correction §7's own cycle table already applies — predicts `combatant_mag` at 44 bytes and
each call site at 14 (not 12), totaling `44 + 14 + 14 = 72`, matching the full measurement exactly.
This reconciliation is the empirical confirmation, not merely the citation, of the "nesasm zero page
is absolute" convention this engine's `.asm` files hold to throughout — no operand anywhere in
`engine/*.asm` uses the `<` prefix that would force true zero-page addressing, so every apparently-
zero-page-range scratch byte (`bt_tmp` at `$5C`, `bt_ret` at `$70`, and every other equate under
`$100` in `engine/constants.asm`) actually costs an absolute operand's 3 bytes and 4 cycles, not a
zero-page operand's 2 bytes and 3 cycles. This is worth recording as a trap in its own right (§13).

**Wired into `battleRegionBytes`** (`main/build/battletables.js:826-835`): one new term, `+
(projectUsesMagicPower(project) ? MAGIC_POWER_BATTLE_ALLOWANCE : 0)`, the identical shape every
other conditional term there already takes. `checkCapacity` (`main/build/generate.js:2229-2258`)
needs no edit — it already reads `battleRegionBytes`'s combined figure, not the individual terms.

**Headroom, measured against `battleRegionCeiling` = `NESASM_BANK_BYTES(8192) - BATTLE_SLACK(20) =
8172`:**

| board | off | on |
|---|---|---|
| MMC1 | 3441 free | 3349 free |
| MMC3 | 3395 free | 3303 free |
| UNROM 512 | 3441 free | 3349 free |

Ample margin on `sample-rpg` either way; the 72-byte cost is small relative to the ~4 KB of headroom
this region already has (matching `battletables.js`'s own header comment, "~3870 free bytes,
measured," from an earlier baseline).

**No kernel-lo term.** `kernelCodeBytes` (`main/build/generate.js:1144-…`) was not touched by the
prototype and needs no new term: every byte this design adds lives in `engine/battleturn.asm`, which
is entirely inside the banked battle region (`BATTLE_REGION_SOURCES`), never in a kernel-lo file
(`engine/rpg.asm`, `engine/combat.asm`, `engine/ui.asm`'s `use_item_apply`, or the field `Heal`/
`Damage` commands' own `party_heal`/`party_damage`, none of which this design touches at all — a
field-side `Heal`/`Damage` command routes through those RPG-kernel routines, not through
`cast_heal`/`spell_damage`, so magic power never reaches them).

**The limitation, stated honestly after round 2 correction rather than over-promised: no existing
kernel-lo test would actually catch a future kernel-lo dependency here.** `kernelbytes.test.js`'s own
board measurement is `assertCovers` (`:295-316`, called at `:443-457` and elsewhere) — a **margin
band** (`entry.codeBytes <= budget` and `KERNEL_SLACK <= margin <= KERNEL_SLACK * 2`), not the banked
region's exact-equality assertion (`bankedbytes.test.js:315-376`'s own `assert.equal`); a small,
unbudgeted kernel-lo addition could silently eat into `KERNEL_SLACK`'s own margin without failing this
particular check at all, only the *ceiling* half of it, and only once the margin shrank far enough.
Worse, **all six checked-in fixtures are magic-power-off** (§11) — every kernel-lo measurement this
codebase runs today builds with `MAGIC_POWER_ENABLED = 0`, so a future change that routed magic power
through a kernel-lo file would assemble identically in every existing measurement regardless of
whether that change was correct, safe, or budgeted at all. **If a kernel-lo dependency is ever added
to this feature, a magic-power-on/off kernel-lo measurement has to be added alongside it** — the exact
shape `bankedbytes.test.js`'s own `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` isolation test already
demonstrates for the banked side (§9, below) — not assumed to already exist.

**`battleShortfallAdvice` does not gain a "turn magic power off" lever.** Recommendation: no —
**with the limitation named honestly, corrected in round 2, rather than implying the existing levers
are guaranteed to close any given shortfall.** `battleShortfallAdvice`'s own `levers` loop
(`main/build/battletables.js:923-935`) only ever pushes a description into `options` when some `k`
within that lever's own unit count actually brings `battleTableBytes(draft)` under the target
(`if (battleTableBytes(draft) <= target) { options.push(...); break; }`); a lever whose full range
still cannot close the deficit contributes nothing, and if every lever comes up empty the function
falls back to a generic, unverified "no single change closes this... some combination..." sentence
(`:1013-1018`) — **the code offers a lever only when it actually works, it never guarantees one
exists.** A 72-byte `MAGIC_POWER_BATTLE_ALLOWANCE` is small next to `sample-rpg`'s own measured
headroom (§9's own table), so in practice the existing actor/spell/party/max-level levers are very
likely to close a shortfall of this size the same way they already do for
`ITEM_LIST_FILTER_BATTLE_ALLOWANCE`'s own 17 bytes (which has no bespoke removal lever either) — but
that is an observation about the *size* of this term, not a property `battleShortfallAdvice` itself
enforces. Adding a bespoke "turn magic power off" lever for every small conditional term would make
the `levers` array grow without bound for a marginal benefit this term's own small size does not
justify; the recommendation stands, on that narrower basis.

**Byte-identity when off.** `nameentry.test.js`'s six-fixture SHA-256 gate (`:91-124`, §0) is the
proof: none of the six carries magic power live (§11), and `MAGIC_POWER_ENABLED = 0` on every one of
them makes every line this design touches assemble to nothing — the measured "off" figures in the
table above are, byte-for-byte, `sample-rpg`'s own pre-existing baseline, confirmed directly rather
than merely argued: the "off" row's `used` figures (4731/4777/4731) match the pre-prototype baseline
measurement exactly, taken before any magic-power code existed in the tree at all.

**`MAGIC_DEFENCE_BATTLE_ALLOWANCE`, measured (not estimated) the identical way, in three
configurations rather than two — the delta-measurement trap named in §8 is exactly why a third
build (magic power alone) is part of this table, not an afterthought.** The same `git worktree`
prototype (§0) built `sample-rpg` on all three boards in four states: both stats off (the baseline,
already reported above), magic power alone, magic defence alone, and both stats live together —
each build's own gate reads only that build's own party/actor fields, so no configuration's own
allowance could hide behind the other's flag the way a shared gate would let it.

| board | mag alone | mdef alone | both | mag-alone code delta | mdef-alone code delta | both code delta |
|---|---|---|---|---|---|---|
| MMC1 | used 4823 (tables 514) | used 4816 (tables 514) | used 4908 (tables 534) | **72** | **65** | **137** |
| MMC3 | used 4869 (tables 514) | used 4862 (tables 514) | used 4954 (tables 534) | **72** | **65** | **137** |
| UNROM 512 | used 4823 (tables 514) | used 4816 (tables 514) | used 4908 (tables 534) | **72** | **65** | **137** |

(Every code delta above is against the same `baseBattleCodeBytes(mapper) + battleTableBytes(project)
+ 17` baseline the mag-only table already established; the mag-alone column reproduces v6's own 72
exactly, confirming the mag-only path is unaffected by magic defence's own code existing in the tree
but gated off, per §8's own byte-identity claim.)

**`MAGIC_DEFENCE_BATTLE_ALLOWANCE = 65`, flat across all three boards, for the identical reason
`MAGIC_POWER_BATTLE_ALLOWANCE` is: nothing in `combatant_mdef` or its one call site branches on
`SPLIT_ENABLED` or anything else board-specific.** `137 = 72 + 65` exactly, on every board, confirmed
directly by the "both" column rather than assumed from additivity: the marginal cost of adding magic
defence on top of an already-mag-live build (`137 − 72 = 65`) and the marginal cost of adding magic
power on top of an already-mdef-live build (`137 − 65 = 72`) both equal each stat's own standalone
allowance exactly, with no cross-term — the two features' own code never shares an instruction, so
there is nothing for a cross-term to come from.

**The table delta for magic defence is the identical `party.length * maxLevel + actors.length =
2*8 + 4 = 20` formula, measured**, not merely assumed from the shape being identical to `pc_mag_at`/
`mon_mag`: `pc_mdef_at`/`mon_mdef` together add exactly 20 bytes (514 − 494) in the mdef-alone
column, and 40 (534 − 494, `20 + 20`) when both stats are live, on every board.

**Reconciling `65` against §7's own listing.** `combatant_mdef` alone measures **44 bytes** (§7,
isolated the identical way `combatant_mag` was in v6 — reverting `spell_damage`'s own call-site
addition and rebuilding), byte-identical to `combatant_mag`'s own 44, since the two routines are the
same shape. The one call site's own two blocks — `lda bt_target`(3) + `jsr combatant_mdef`(3) +
`sta bt_dmg_lo`(3) = 9 bytes for the park block, `sec`(1) + `sbc bt_dmg_lo`(3) + `bcs`(2) +
`lda #0`(2) + `bne`(2) + `lda #1`(2) = 12 bytes for the subtract/floor block, 21 bytes total — sum to
`44 + 21 = 65`, matching the measurement exactly. Magic defence has only **one** call site (`cast_
heal` carries none, §5), against magic power's two (`spell_damage` and `cast_heal`), which is the
whole reason `65` is not simply "the same shape, so the same 72": the combined-routine cost (44) is
identical, but the call-site cost differs both in count (one site, not two) and in shape (21 bytes
for the park-then-subtract-and-floor sequence, against magic power's 14 bytes per site for the
add-and-saturate sequence).

**Wired into `battleRegionBytes`, beside magic power's own term, both terms independent:** `+
(projectUsesMagicPower(project) ? MAGIC_POWER_BATTLE_ALLOWANCE : 0) + (projectUsesMagicDefence
(project) ? MAGIC_DEFENCE_BATTLE_ALLOWANCE : 0)`. `checkCapacity` needs no edit for the identical
reason it needed none for magic power alone — it already reads `battleRegionBytes`'s combined
figure.

**Headroom, both stats live, measured against the identical `battleRegionCeiling = 8172`:**

| board | both off | mag alone | mdef alone | both live |
|---|---|---|---|---|
| MMC1 | 3441 free | 3349 free | 3356 free | 3264 free |
| MMC3 | 3395 free | 3303 free | 3310 free | 3218 free |
| UNROM 512 | 3441 free | 3349 free | 3356 free | 3264 free |

Still ample margin on `sample-rpg` with both stats live — the combined 137-byte cost is a small
fraction of the region's own ~4 KB of headroom.

**No kernel-lo term, for the identical reason magic power needs none.** Every byte magic defence
adds lives in `engine/battleturn.asm`, entirely inside the banked battle region — `combatant_mdef`
beside `combatant_mag`, `spell_damage`'s own new blocks beside its existing ones — never in a
kernel-lo file. The identical limitation §9 already states for magic power applies here without
change: no existing kernel-lo test would catch a future kernel-lo dependency for magic defence
either, and all six checked-in fixtures are magic-defence-off (§11) for the identical reason they are
magic-power-off.

**`battleShortfallAdvice` does not gain a "turn magic defence off" lever either, for the identical
reason** — a 65-byte term, like magic power's own 72-byte one, is small enough that the existing
actor/spell/party/max-level levers are very likely to close a shortfall of this size without a
bespoke one, and the function's own `levers` loop still only ever offers a reduction that actually
works, never guarantees one exists (§9, above).

**Byte-identity when off, for magic defence, on the identical six fixtures.** None of the six
carries magic defence live (§11), and `MAGIC_DEFENCE_ENABLED = 0` on every one of them makes every
line this round's own addition assembles to nothing — the same `nameentry.test.js` gate (`:91-124`)
already proves this for magic power and needs no separate proof for magic defence, since it is the
identical mechanism (a build-time gate reading a predicate that is false on every fixture) applied to
a second flag.

## §10. Q8 — UI

**Character Forge** (`renderer/forges/character/character.js`): a new row after the existing
Attack/Defence row (`:180-185`) and before Speed/Accuracy/Evasion (`:186-190`), grouping every
growth-bearing stat together the way the existing two rows already do:

```js
row(
  field('Magic', number(member.baseMag, 0, 255, (v) => setMember(index, 'baseMag', v))),
  field('+ / level', number(member.magPerLevel, 0, 16, (v) => setMember(index, 'magPerLevel', v)))
)
```

Bounds match the *normalizer's* real clamp (0-255 / 0-16), not `:182`/`:184`'s own pre-existing 0-32
mismatch on the neighboring Attack/Defence fields (§0/§6) — this new field does not copy that defect.

**Magic defence, beside Magic — a second new row, added this round, immediately after it:**

```js
row(
  field('Magic defence', number(member.baseMdef, 0, 255, (v) => setMember(index, 'baseMdef', v))),
  field('+ / level', number(member.mdefPerLevel, 0, 16, (v) => setMember(index, 'mdefPerLevel', v)))
)
```

The same growth-bearing-stats-together grouping the Magic row itself joined (§0/§6); bounds match the
normalizer's own clamp (0-255 / 0-16), the identical reasoning as Magic's own field.

**Monster Forge** (`renderer/forges/monster/monster.js`): a fourth field in the existing Attack/
Defence/Speed row (`:119-123`), beside Attack per the brief's own placement call, and — added this
round — a fifth, Magic defence, directly beside it:

```js
row(
  field('Attack', number(battle.atk ?? 4, 0, 255, (value) => set('atk', value))),
  field('Defence', number(battle.def ?? 2, 0, 255, (value) => set('def', value))),
  field('Speed', number(battle.speed ?? 4, 0, 255, (value) => set('speed', value))),
  field('Magic', number(battle.mag ?? 0, 0, 255, (value) => set('mag', value))),
  field('Magic defence', number(battle.mdef ?? 0, 0, 255, (value) => set('mdef', value)))
)
```

Labeled "Magic," not "Magic power" or "Magic points" — the existing Accuracy/Evasion row (`:124-128`)
already uses "Magic points" for `battle.mp` (the mana pool this stat is unrelated to), and reusing
that label on a second, different field in the same Forge would be a real, confusing collision (§0).
"Magic defence," not "Magic resist" or reusing "Defence" — the existing `Defence` field is `battle.
def`, the physical-damage stat; a second field also called "Defence" in the same row would be the
identical kind of collision Magic's own label had to avoid.

**Nothing on the battle screen, for either stat.** §0 confirmed by direct grep that `pc_atk`/`pc_def`
are read only inside the routines that compute physical damage, never by any draw routine — `draw_
panel` shows only names. `combatant_mag`/`pc_mag_at`/`mon_mag` and `combatant_mdef`/`pc_mdef_at`/
`mon_mdef` all inherit the identical absence with no engine change required to keep it that way; no
new draw code is part of either stat's own design.

**Smoke coverage — commit, undo, and reload (round 2: v1's own plan stopped at redo, short of the
brief's "reload" requirement).** The Monster Forge's Magic field reuses the existing Attack-field
edit/undo/redo sequence (`main/smoke.js:7488-7527`) nearly verbatim — edit reaches `monsterStore.
project.sprites.actors[snakeId].battle.mag`, the rendered field reflects the edit, undo restores the
*rendered* value from the live store (not a cached object — the exact regression that sequence exists
to catch), redo reapplies, cleanup undoes once more. The Character Forge's Magic field needs
**genuinely new** coverage: §0 confirmed there is no existing per-stat-field smoke test on that Forge
to extend (only Add/Remove and the two checkboxes are covered today) — a new step, modeled on the
Monster Forge's own shape, editing `member.baseMag` through the rendered field and asserting the
identical edit/undo/redo contract. **Both fields also get a save/reload assertion**, the existing map
round-trip shape (`main/smoke.js:1572-1578`: `window.forge.project.save(store.dir, store.project)`
then `window.forge.project.open(store.dir)`, comparing the reloaded value) — §14's tests 10-11 give
the full detail. **Magic defence's own two fields, added this round, reuse the identical patterns
verbatim**: `battle.mdef` on the Monster Forge is the Attack-field shape again, `member.baseMdef` on
the Character Forge is the newly-written Magic-field shape again — no third pattern to invent, since
both fields are, mechanically, one more `number(...)` control wired to `set`/`setMember` the same way
every stat field on either Forge already is.

## §11. Q9 — starters and fixtures

**Recommendation: the RPG starter's Hero gets a real value; no checked-in fixture opts in.**

`shared/starters/rpg.js:206` already gives `project.party[0]` (Hero) `spells: [{ spellId: 0, level:
1 }]` — Hero is the *only* combatant in the shipped starter that casts anything at all (§0: neither
Ally nor either starter monster, Slime or Bat, has a `spellId`). Giving a monster `mag` in this
starter, as the brief that opened this round first suggested, would author a stat with **no
observable effect**, since `combatant_mag` is only ever read by a combatant that reaches `spell_damage`
or `cast_heal` — and neither Slime nor Bat ever does. This is a real correction to the brief, found by
checking rather than assuming: the recommendation moves to Hero-only, a concrete example of magic
power taking effect exactly where the starter already shows a spell in play.

**Decided (2026-09-10 evening): `baseMag: 8, magPerLevel: 2` stands as the starter default**, on
`shared/starters/rpg.js:206`'s own spread — comparable in scale to `baseAtk: 6`/`atkPerLevel: 1`, high
enough that a fresh player casting Hero's starting spell sees a visibly larger number than the
un-augmented roll. Ally (`:207`) keeps `baseMag` at the schema default (0), since Ally never casts
anything the value could affect.

**Magic defence in the starter: the inverse of magic power's own observability argument.** Hero is
the *only* combatant in the shipped starter that ever casts a spell (§0/above), so Hero's own `mdef`
would never be exercised by anything in the starter — no monster there casts a spell at Hero (or at
anyone), so nothing ever subtracts a party member's own defence. A monster's `battle.mdef`, by
contrast, is exercised the moment Hero's own `Ember` lands on one: `spell_damage`'s own subtraction
(§7) runs against `bt_target`, and the starter's own wandering encounter already puts Hero within
casting range of Slime and Bat. **Recommend: `mdef: 4` on both Slime and Bat** (`shared/starters/
rpg.js`'s own `importEntry(project, 'monster', 'Slime')`/`'Bat'` call sites, §0), **and Hero's own
`baseMdef`/`mdefPerLevel` left at the schema default** (`0`/`0`) — the identical "give the value to
whichever side can actually show it working" reasoning magic power's own Hero-only recommendation
already used, applied in the opposite direction, since it is a *monster's* own defence that a fresh
player can actually see reduce Hero's own spell damage. **A concrete worked number, corrected this
round: the shipped starter's own `Ember` is `amountMin: 6, amountMax: 6`
(`shared/starters/rpg.js:196` — `{ ...createSpell(0, 'Ember'), mpCost: 3, kind: 'damage', amountMin:
6, amountMax: 6, element: 'fire', scope: 'one' }`), not the `10` `sample-rpg`'s own, separate Ember
carries** (the two are different projects with different spells; §14's own tests build `mkdtemp`
variants of `sample-rpg`, never the starter, and correctly use that project's real `10`). Against the
starter's real `6`-damage `Ember`, with Hero's own `baseMag = 8` at level 1 and Slime's own fire
weakness, the hit becomes `(6 + 8 − 4) * 1.5 = 15`, visibly smaller than the `(6 + 8) * 1.5 = 21` an
`mdef`-less Slime would take — a real, observable difference, not merely a nonzero field sitting
unread. `4` is chosen to be visible without single-handedly making the fight a non-event; Ally and
any future starter monster stay at the schema default for the identical "nothing there could show it
working" reasoning
Hero's own `mdef` already gets.

**The starter is not a "checked-in fixture" in the sense the rule below means** — `shared/
starters/rpg.js` generates a *new* project on demand, distinct from the six pre-built `sample*/`
fixtures `rpg.test.js` and the ledger tests build against — so the starter opting both stats in
(Hero's `mag`, Slime/Bat's `mdef`) does not conflict with "no checked-in fixture opts in" at all; the
two are separate questions.

**No checked-in fixture opts in.** `sample-rpg`'s own exact-damage assertions in `rpg.test.js`
(`:516`, `:1794`, `:1834`, `:2125`, `:3235`, §0) stay byte-for-byte as they are — magic power stays
off on every one of the six checked-in fixtures. **The precedent this cites is corrected in round 2:
v1 claimed name entry's own phase 5 established a policy of "no fixture opts in," which is backwards.**
Phase 5 (`docs/design-name-entry.md` v16.4 §17 item 5) deliberately opted **three** fixtures **in** —
`sample`/`sample-rpg` got hero naming live for real, `sample-rpg-mmc1` got Join naming live on Iris
alone (`test/unit/nameentry.test.js:85-90`, confirmed this round: "all three moved," the other three
"opt into nothing new this phase") — precisely because those three fixtures needed to demonstrate the
feature actually working end to end, something a `mkdtemp` variant cannot substitute for when the
feature's own on-fixture behavior (in-game naming across a real boot, a real Join, a real save) is
itself what needs proving. **The real, correctly-stated policy is: a checked-in fixture is hand-edited
to carry a feature only when a test genuinely needs that fixture — never regenerated in place — and
`sample-rpg`'s own value here is as the *unchanged* regression control every existing exact-damage
assertion already depends on** (§0's own citation list), which magic power does not need to disturb:
every test this design's own §14 adds builds a `mkdtemp` variant instead, the identical mechanism
`bankedbytes.test.js`'s own `measureRegion` already uses, and nothing about magic power needs a real
boot/save/reload sequence against the checked-in fixture the way in-game naming's own grid did.
`nameentry.test.js`'s own six-fixture SHA-256 gate (§0) therefore needs no re-pin from this design at
all — every one of the six assembles `MAGIC_POWER_ENABLED = 0`, byte-identical to today — but that is
a consequence of magic power not needing fixture-level proof, not of a blanket "fixtures never opt in"
rule that phase 5 itself never followed. **Decided (2026-09-10 evening): no checked-in fixture opts
in** — the question this correction originally surfaced for Chris is now answered, in this document's
own favor, and is no longer open (§16 no longer carries it).

Tests exercising magic power *or* magic defence live build `mkdtemp` variants of `sample-rpg` the way
`bankedbytes.test.js`'s own `measureRegion` (`:121-148`) and this design's own §9 measurement already
do — never a checked-in fixture, for either stat.

## §12. Q10 — where recorded

**Recommendation: a new sub-item 6 under ROADMAP item 13, covering both stats together.** (`ROADMAP.md
:1445-1493`, immediately after the existing sub-item 5, "The element list," which ends at `:1492`
before the `---` separator to item 14 at `:1494-1496`.) Magic power and magic defence are one sub-item,
not two — they were designed, priced, gated and tested together in this same document, and they land
in the same implementation phase (§15) — so the ROADMAP entry records "a caster stat and a target
stat for spell damage/healing" as a single unit of work, the way this document's own title now does.
The new sub-item cross-references `docs/design-character-forge.md` §5 (where Chris's request for a
caster stat was first recorded) and ROADMAP item 14 (`:1496-…`, the Monster Forge, since `battle.mag`/
`battle.mdef` both live on the actor record that Forge owns) — added in the implementation phase's own
docs pass, not in this design round, matching how every other "Genuinely new in this item" sub-item
in that list was struck through and annotated **done** only once its own implementation landed
(`:1447-1492`'s own pattern).

## §13. What could go wrong

1. **`bt_tmp` clobbered by `level_row` under `cast_heal`'s parked roll.** Closed by reordering: call
   `combatant_mag` *before* `roll_spell_amount`, staging its answer in `bt_ret` (never touched by
   `roll_spell_amount`/`mod8`/`level_row`'s own `bt_tmp` use ends before the roll begins), so
   `bt_tmp` is never written until after the add, by which point nothing still needs its earlier
   value. §7's own listing closes this; verified by reading every intervening instruction, not
   asserted.
2. **`bt_tmp2` as `cast_all`'s sentinel across `spell_damage`.** Neither `combatant_mag` nor either
   call-site addition reads or writes `bt_tmp2` anywhere — confirmed line-by-line against §7's own
   listing. `rpg.test.js:2125`'s existing RNG-state guard remains the correct regression test with no
   change, since nothing this design adds touches the byte it guards.
3. **A non-zero schema default silently changing every existing project.** `baseMag`/`magPerLevel`/
   `battle.mag` all default to `0`, not `baseAtk`'s `6`/`atkPerLevel`'s `1` — `normalizePartyMember`'s
   own fallback-to-default rule (`:5046`) is exactly what makes a non-zero default dangerous here, so
   the schema in §6 deliberately does not follow `baseAtk`'s own numbers. `baseMdef`/`mdefPerLevel`/
   `battle.mdef` (added this round) follow the identical zero-default rule for the identical reason.
4. **A conditional table emitting a one-byte stub when off.** `pc_mag_at`/`mon_mag` are wrapped in
   `if (projectUsesMagicPower(project))` in `battleTables` (§8), the identical guard `items`/
   `item_heal` already use for the identical reason (`battletables.js:198-205`'s own comment) — and
   the §9 measurement directly confirms the "off" table-byte figure matches the pre-prototype
   baseline exactly, not baseline-plus-two-stub-bytes. `pc_mdef_at`/`mon_mdef` (added this round) are
   wrapped in the identical, separate `if (projectUsesMagicDefence(project))` guard — §9's own
   mdef-alone measurement confirms the same thing for the second pair of tables.
5. **The flat-spell (`n == 1`) path consuming RNG after the change.** `combatant_mag` never calls
   `rng_next`; the add wraps entirely outside `roll_spell_amount`'s own body, so `roll_spell_amount_
   flat`'s zero-RNG guarantee (`rpg.test.js:1834`) is unaffected regardless of whether magic power is
   live. `combatant_mdef` (added this round) is the identical shape and calls `rng_next` nowhere
   either, for the identical reason.
6. **`combatant_*`'s "reload A last" flag rule.** `combatant_mag_ret` restores `bt_x`/`bt_y` before
   its own final `lda bt_ret`, the identical order `combatant_atk_ret`/`combatant_def_ret` already
   use — verified by direct comparison in §7's own listing. `combatant_mdef_ret` (added this round)
   is character-for-character the same shape.
7. **`hex()`'s `& 0xff` masking an `undefined` field to `$00` silently.** Does not apply here the way
   it did to `design-magic.md` §12's own migration: `battle.mag`/`baseMag`/`magPerLevel` are new
   fields with a build-time-computed default (`normalizeActor`/`normalizePartyMember` always write a
   clamped number), not a renamed field briefly read by code that no longer writes it. **The
   guaranteed direction, corrected in round 2, is old project → new app**, via a genuinely-missing
   `raw?.baseMag` resolving through `num()`'s own fallback to `0`
   (`shared/project.js:5044-5076`) — not the reverse: a *newer* project's real, present `baseMag`
   reopened by an *older* app that predates this field is simply never read or re-emitted by that
   app's own `normalizePartyMember`, so a save from there drops it, the ordinary consequence of an
   old build not knowing about a new field, not a `hex()`-masking hazard. `baseMdef`/`mdefPerLevel`/
   `battle.mdef` (added this round) follow the identical guaranteed direction and the identical
   non-hazard.
8. **Branch range: existing branches pushed past ±128 bytes.** Confirmed by successful nesasm
   assembly of the exact prototype on all three boards, with zero "branch out of range" errors — the
   assembler is the actual check here, and it already passed, this round included (§7's own Trap 8).
9. **nesasm's 31-character label limit.** Longest new label from magic power alone is `spell_damage_
   mag_ok` at 19 characters; the longest across both stats, added this round, is `spell_damage_mdef_
   floor` at 23 — both well clear of the 30-character cliff.
10. **A monster's `mag` read through `mon_slot_actor,x`.** `combatant_mag_mon` resolves the battle
    *slot* to its actor id before indexing `mon_mag` — reading `mon_mag,x` directly (slot as if it
    were an actor id) would read the wrong actor's stat whenever two formation slots share an actor,
    or index past the table once live slots outnumber distinct actors. Closed identically to
    `combatant_atk_mon`/`combatant_def_mon`'s own existing indirection. `combatant_mdef_mon` (added
    this round) uses the identical indirection for the identical reason.
11. **(New, found this round.) A column-0 `.if MAGIC_POWER_ENABLED` fails to assemble.** nesasm v3.1
    requires conditional-assembly directives to be indented, matching every existing `.if`/`.endif`
    pair in this codebase; a flush-left one produces `Unknown instruction!`/`Label multiply defined!`
    — confirmed empirically, not merely by convention-following. §7's own listing is written
    correctly indented; worth adding to CLAUDE.md's own "6502 traps" list in the implementation
    phase.
12. **(New, found round 2; wording corrected round 3 — this trap's own statement of the rule still
    said "every operand is 3-byte absolute (4 cycles)," the identical over-generalization F15 already
    fixed in §7's own cycle-cost intro but had not yet been carried here.** Hand-counting bytes/cycles
    from source without accounting for this engine's absolute-only addressing convention undercounts
    real usage, and the size of that undercount depends on *which* instruction shapes are involved,
    not a single flat rate: every `bt_*`/`pc_*`/`mon_*` scratch-byte operand in `engine/*.asm`
    assembles as absolute, never 2-byte zero-page mode, because no operand anywhere in this codebase's
    engine files uses the `<` prefix nesasm needs to force zero-page addressing — but a plain absolute
    load/store (`lda`/`sta`/`cmp`/`adc`/`sbc`) is 3 bytes/4 cycles, an absolute read-modify-write
    (`asl`/`rol`/`lsr`/`ror`/`inc` on a memory operand) is 3 bytes but **6** cycles, and an
    absolute-indexed store is **5** cycles — three different corrections, not one uniform 15%. §9's
    own reconciliation (62 bytes hand-tallied at zero-page rates vs. 72 measured) is the empirical
    proof that the correction is real; §7's own cycle-cost section states which shape gets which cost,
    and every figure in §7/§9 already applies it correctly — only this trap's own summary sentence had
    fallen back to the flat, wrong version of the rule.
13. **(New, magic defence.) `bt_dmg_lo` clobbered before magic defence's own subtraction reads it
    back.** The park-then-subtract sequence (§7's own "Where magic defence parks its own value")
    relies on `bt_dmg_lo` staying untouched between `combatant_mdef`'s own `sta bt_dmg_lo` and the
    later `sec / sbc bt_dmg_lo` — verified by reading `combatant_mag`, `level_row`, `roll_spell_
    amount`, `mod8` and `rng_next` in full this round and confirming none of the five references
    `bt_dmg_lo` anywhere in its own body, not merely assumed from the existing contract comment (which
    names `bt_tmp`/`bt_tmp2`/`Y` but never `bt_dmg_lo`).
14. **(New, magic defence.) The floor-of-1 logic must collapse two distinct zero-producing paths into
    the same branch, or an exact `roll == mdef` result reads as 0, not 1.** `spell_damage_mdef_floor`
    mirrors `physical_damage_floor`'s own two-path idiom exactly: an underflow (`mdef > roll`) forces
    `A = 0` via the `bcs`-not-taken fallthrough *before* reaching the shared `bne`/`lda #1` floor
    check, so both "underflowed" and "subtracted to exactly zero" land on the identical `A == 0` test
    — a implementation that floors only the underflow case (say, an early `bcc spell_damage_mdef_
    done` right after the `sbc`, skipping the `bne` check entirely) would let an exact `roll == mdef`
    hit deal literal 0 damage, the "never less than one" guarantee §5 explicitly commits to.
15. **(New, magic defence.) A future edit symmetrically adds an `mdef` block to `cast_heal`, "to match
    magic power's own two-site shape."** §5's own decision is damage only, deliberately — a heal has
    no defending target (§5's own reasoning) — so `cast_heal` must never gain a `MAGIC_DEFENCE_
    ENABLED` block; the asymmetry (one call site for magic defence, two for magic power) is the
    design, not an oversight a "consistency" pass should later "fix." §14's own test 28 (added this
    round — an earlier draft of this trap claimed test coverage already existed here, and it did not)
    checks this directly: a heal is unaffected by `mdef` on the healed member.
16. **(New, magic defence.) The two gates sharing one predicate, "to save a flag."** §8 already states
    why this is wrong at length: a project can author one stat without the other, and a shared gate
    both assembles code a build never uses and, worse, makes either allowance impossible to isolate by
    delta-measurement (§8's own named trap — "removing one of two co-gated features measures 0"). §9's
    own three-configuration measurement (mag alone, mdef alone, both) is what a shared gate would have
    made impossible to produce honestly.

## §14. Test plan

Each test names the wrong implementation it rules out.

1. **`MAGIC_POWER_BATTLE_ALLOWANCE` is exact, on every RPG-capable board** (`test/unit/bankedbytes.
   test.js`, modeled on the existing `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` isolation test at
   `:386-404`): measure `sample-rpg` with and without a nonzero `baseMag`, `assert.equal` the delta
   against the named constant on MMC1/MMC3/UNROM 512. Rules out: the allowance drifting from the
   real cost after a future engine edit to `combatant_mag` or its call sites (the exact defect class
   `ITEM_LIST_FILTER_BATTLE_ALLOWANCE`'s own history — folded into the base, then split out —
   already demonstrates).
2. **The combined per-board base+tables equality test** (`bankedbytes.test.js:315-376`'s own variant
   list) gains a `['magic power', (p) => { p.party[0].baseMag = 5; }]` entry. Rules out: the same
   drift as (1), caught a second way — through the whole-region sum rather than an isolated delta —
   the identical belt-and-suspenders shape `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` already gets.
3. **Byte-identity when off** (`test/unit/nameentry.test.js`'s existing six-fixture SHA-256 gate,
   `:91-124` — no new test, an existing one that must keep passing unmodified). Rules out: a stray,
   unconditional emission anywhere in the change (a table stub, a mis-gated `.if`) reaching a
   fixture that never opted in.
4. **A party caster's `Ember` (fire, flat 10) against the fire-weak Slime deals exactly 90 with
   `baseMag = 50`, not an intermediate amount** — rewritten in round 2, because the test as v1 wrote
   it was not observable: `rpg.test.js` never reads the rolled amount before the elemental modifier,
   only the final HP loss (`startHp - nes.cpu.mem[MON_HP]`, the shape the existing `'MAGIC spends MP
   and does more...'` test already uses at `:531-534`, and the existing flat-spell test's own
   `assert.equal(startHp - nes.cpu.mem[MON_HP], 15, ...)` at `:1848-1851`). `sample-rpg`'s own
   `Ember` is `{amountMin: 10, amountMax: 10, element: 'fire', scope: 'one'}` (`sample-rpg/
   spells.json`), and its Slime is `{hp: 12, battle: {weak: 'fire', ...}}` (`sample-rpg/
   sprites.json`) — confirmed this round by reading both files directly. `test/unit/rpg.test.js`,
   new: a `mkdtemp` variant of `sample-rpg` that raises the Slime's `hp` to 200 (so it survives the
   hit rather than saturating at death, the identical headroom trick the existing flat-spell test
   already uses at `:1840`) and sets the caster's `baseMag = 50`; boot, walk into the encounter, cast
   `Ember` on the Slime, and assert the final damage is **exactly 90** — `(10 + 50) x 1.5`, the add
   applied *before* the weak multiply, per Q6's own ordering decision (§7). The add-after-weakness
   wrong implementation (`15 + 50`) would instead deal **65**; no add at all deals **15**, the
   existing test's own number. Ember's `amountMin === amountMax` means `spell_amount_n == 1`, so
   `roll_spell_amount` takes its no-roll branch (§7/test 8) and the result is deterministic with no
   RNG seeding needed — the identical reason the existing flat-spell test needs none. **An
   elementless spell (e.g. `Mend`) cannot distinguish the ordering by itself**, since with no
   elemental step to land before or after, `roll + mag` gives the same total either way — this test
   has to use an elemental spell specifically to tell the two orderings apart.
5. **A monster caster's spell is scaled by its own `mag`, read through the slot-to-actor-id
   indirection, not by raw slot number** — under-specified in v1, made concrete in round 2. Reuses the
   exact walked-into-encounter shape the existing `'a monster with a spell casts it...'` test already
   builds (`rpg.test.js:3235-…`, `buildVariant(t, 'monspell', ...)`, `sample-rpg`'s own Snake, actor id
   3, the only monster in its formation and therefore battle **slot 0** — the actor id (3) and the
   formation slot (0) already genuinely differ in this exact existing setup, confirmed this round by
   reading `sample-rpg/sprites.json` directly: `{id: 0, name: 'Slime'}` ... `{id: 3, name: 'Snake',
   battle: {spellId: 2}}` — id 0 is a *different* actor, Slime, not the Snake). The existing test's own
   scenario has the Snake cast `Venom` (`spellId: 2`, poison — unaffected by magic power, §4), so the
   new test's own variant additionally sets `actors[3].battle.spellId = 0` (Ember, damage) and
   `actors[3].battle.mag = 40`, **and** gives the unrelated Slime (actor id 0, never cast in this
   battle) `actors[0].battle.mag = 200` — a deliberately different, large value, so that a wrong
   reading is not just "any number" but a *specific, wrong* one. Force the Snake to cast (the existing
   test's own stall-with-RUN loop) and assert the damage reflects `mag = 40` (`mon_mag[3]`, the
   correct, resolved-actor-id reading), not `mag = 200` (`mon_mag[0]`, what a wrong implementation
   reading `mon_mag` by raw slot index 0 — treating the slot number as if it were the actor id — would
   read instead). Rules out: `combatant_mag_mon`'s own `mon_slot_actor,x` indirection being skipped or
   reading `mon_mag` by raw slot index (trap 10), and reading `pc_mag_at` unconditionally regardless of
   side.
6. **A heal spell's amount scales with `baseMag`, added before the existing clamp-to-max — made
   concrete in round 2 with two distinct starting-HP conditions, since a single uncapped case cannot
   by itself distinguish "the add is missing" from "the add runs after an already-clamped store."**
   Both extend the existing heal test's own setup (`rpg.test.js:1794-1818`, `PC_SPELLS |= 2` to grant
   `Mend`, `amountMin === amountMax === 18`) with a caster `baseMag = 50`:
   - **Condition A, uncapped:** `PC_HP = 5` (the existing test's own starting value, well under max).
     Correct result: `5 + 18 + 50 = 73` (assuming headroom — read `PC_HP_MAX` at runtime and confirm
     it exceeds 73, the way the existing test already computes `Math.min(5 + 18, PC_HP_MAX)`; raise
     `baseHp`/`hpPerLevel` in the `mkdtemp` variant if the checked-in fixture's own max does not
     clear it). Rules out: the add being skipped entirely (a wrong implementation would show `23`,
     the existing test's own unmodified number).
   - **Condition B, capped:** `PC_HP = PC_HP_MAX - 10` (read at runtime, so this does not depend on
     `sample-rpg`'s exact numbers). **Corrected in round 3: with exactly 10 HP of headroom, `roll`
     alone (`Mend`'s flat 18) already exceeds it deterministically — `18 > 10` is simply true, not a
     "may or may not."** Both `roll` alone and `roll + mag` (`68`) trip the cap in this condition;
     what distinguishes the two wrong implementations below is not *whether* a clamp fires but
     *which total* it clamps against. Correct result: exactly `PC_HP_MAX` — the existing
     `bcs`-then-`cmp` clamp (unchanged, §7) runs once, against the *combined* `roll + mag` total
     already parked in `bt_tmp`. Rules out two distinct wrong implementations at once: one that drops
     the clamp for the combined total, so it wraps or exceeds `PC_HP_MAX` outright (immediately
     visible in a byte read); and one that clamps against `roll` alone using the existing, unmodified
     downstream code and then bolts the `mag` add on *afterward* with no clamp of its own — a real,
     plausible mistake, since the existing clamp code needs no textual change if `bt_tmp` is left
     holding `roll` alone and `mag` is added somewhere later. **Said precisely, corrected in round 3:
     this second wrong implementation does not only push the stored value past `PC_HP_MAX` by up to
     `mag`** — `pc_hp,x` is a single byte, so if the already-clamped `PC_HP_MAX` plus the unclamped
     `mag` add together exceed `255` (not merely `PC_HP_MAX`), the store **wraps**, landing on some
     small value that can fall *below* `PC_HP_MAX` too, not only above it. Either outcome — a value
     strictly greater than `PC_HP_MAX`, or a wrapped one that happens to read low — is wrong and
     distinguishable from the correct implementation's own exact `PC_HP_MAX`, so the test still catches
     it either way; it is simply not guaranteed to always read as "too high."
7. **Poison and burn are unaffected by `baseMag`** (`rpg.test.js`, new — a poison/burn caster with a
   large `baseMag`, assert the fixed `POISON_DMG`/`BURN_DMG` tick amount is unchanged). Rules out: a
   future edit accidentally routing `cast_poison`/`cast_burn` through the same add, or gating them on
   `MAGIC_POWER_ENABLED` in a way that changes their fixed-amount behavior.
8. **The flat-range spell (`amountMin === amountMax`) still consumes no RNG with magic power live**
   (`rpg.test.js`, extends the existing test at `:1834` with a `baseMag > 0` variant, asserting the
   RNG state byte is unchanged by the cast). Rules out: `combatant_mag` being mistakenly wired to call
   `rng_next`, or the add being implemented as a second roll rather than a stat lookup.
9. **`cast_all`'s RNG state survives magic power the same way it survives the existing roll**
   (`rpg.test.js`, extends the existing test at `:2125` with a `baseMag > 0` party caster). Rules
   out: `combatant_mag` or either call-site addition touching `bt_tmp2` (trap 2), which this test's
   existing shape already catches for the roll alone and this variant extends to the add.
10. **Character Forge Magic field: commit reaches the store, undo restores the rendered value, redo
    reapplies, and the value survives a save/reload disk round trip** (`main/smoke.js`, new, modeled
    on the Monster Forge's existing Attack-field sequence at `:7488-7527` for the edit/undo/redo half,
    and on the existing map round-trip pattern at `:1572-1578` — `await window.forge.project.
    save(store.dir, store.project)` then `await window.forge.project.open(store.dir)`, comparing the
    reloaded `party[index].baseMag`/`magPerLevel` against what was just committed — for the reload
    half, added in round 2 per the brief's own "commit, undo, reload" requirement, which v1's plan
    covered only as far as redo). Rules out: a cached actor/member object being rendered after undo
    instead of the live store's value (the exact defect the Monster Forge's own comment at that
    citation already names), and separately, a field that reaches the in-memory store but never
    reaches `saveProject`'s own serialization (a defect edit/undo/redo alone cannot see, since it
    never touches disk).
11. **Monster Forge Magic field: the identical sequence, including reload** (`main/smoke.js`, extends
    the existing Attack-field test to also exercise the new field for edit/undo/redo, plus the same
    `project.save`/`project.open` round trip on `battle.mag`). Rules out: the same defect classes as
    (10), on the second Forge.
12. **A caster at level > 1 deals `roll + statAt(baseMag, magPerLevel, level)`, not just
    `roll + baseMag`** — added in round 2; v1's test plan never exercised `magPerLevel` at all, so an
    implementation reading `baseMag` alone (ignoring growth) would pass every other test in this
    section. `test/unit/rpg.test.js`, new: poke `PC_LEVEL` for the caster to a level > 1 the way
    existing tests already poke `pc_level`-adjacent RAM directly, or level up through the normal
    `award_xp` path: with `baseMag = 10, magPerLevel = 5` and level 3, `combatant_mag` should return
    `statAt(10, 5, 3) = 10 + 5*(3-1) = 20`, not `10`. Cast the flat `Ember` (fire, weak) against the
    Slime as in test 4 and assert the final damage matches `(10 + 20) * 1.5 = 45`, not `(10 + 10) *
    1.5 = 30` (the ignores-growth wrong implementation) or `15` (no magic power at all). Rules out:
    `combatant_mag`'s own `level_row`/`pc_mag_at` lookup being skipped in favor of a flat read of
    `battle.mag`-shaped data, or `pc_mag_at`'s own table being emitted from `baseMag` alone with
    `magPerLevel` dropped on the generator side (`main/build/battletables.js`'s `levelTable` helper,
    §9).
13. **`roll + mag` saturates at 255 rather than wrapping — corrected in round 3, the v1 setup was
    impossible to build.** `mon_slot_hp` is a one-byte-per-slot array
    (`engine/constants.asm:557`, `@size=MAX_MONSTERS`), so "a monster with enough HP to survive 255
    unclamped" cannot exist — 255 is already the byte's own ceiling, and surviving a 255-point hit
    with a meaningful remaining HP would need a starting HP past what a single byte can hold at all.
    **Worse, an elemental spell would hide the very defect this test exists to catch**: if a buggy,
    non-saturating add wraps `roll + mag` to a smaller number (say 199), casting a *weak* element on
    top would multiply that wrapped 199 by 1.5 (`298.5`), which itself overflows a byte —
    `spell_damage_weak`'s **own**, separate saturation branch (`:754-764`, unchanged by this design)
    would then clamp *that* back to 255, producing the identical final number the correct
    implementation gives for an unrelated reason, and the test would pass either way. Rewritten to
    use an **elementless** spell specifically, so neither `spell_damage_weak` nor `_strong` ever runs
    (`spell_element,x == 0` takes the `beq spell_damage_done` exit before either), isolating the
    assertion to the roll+mag add's own saturation branch alone: `test/unit/rpg.test.js`, new — a
    `mkdtemp` variant spell with `amountMin === amountMax === 200`, `element: 'none'`, a caster
    `baseMag = 255` (`roll + mag = 200 + 255 = 455`), and a monster target at exactly `mon_slot_hp =
    255` (the real byte ceiling, not an impossible "more than 255"). Read `MON_HP` (or the equivalent
    `mon_slot_hp` offset) **immediately** after the hit resolves, before any further battle activity
    (a death check, `wipe_tick`, XP/gold award) can overwrite or reinterpret the slot. Assert it reads
    **exactly `0`** — `255 - min(455, 255) = 255 - 255 = 0`, the target exactly killed by the
    correctly saturated hit — against **`56`** for a wrapping implementation (`455 mod 256 = 199`,
    `255 - 199 = 56`, a target that wrongly survives). Rules out: a plain 8-bit `adc` with no overflow
    check, which would leave the target alive with a specific, wrong HP total rather than dead —
    exactly the kind of defect that reads as "a weirdly weak hit" rather than an obvious crash, and
    the reason an elemental spell must not be used to test it.
14. **The normalizer: a missing `baseMag`/`magPerLevel`/`battle.mag` becomes exactly `0`, and an
    out-of-range one clamps** — added in round 2; v1 had no normalizer-level test for any of the three
    new fields at all, only the compiled/engine-level tests above. **Part (a) corrected in round 3: a
    party member object that merely lacks the `baseMag` key does not distinguish `raw?.[key]` from
    `raw[key]`** — `raw.baseMag` on an ordinary object with no such key evaluates to `undefined`
    exactly like `raw?.baseMag` does; a plain property read never throws just because the property is
    absent, only accessing a property *on* `null`/`undefined` itself does. The reachable path that
    genuinely distinguishes the two is a `null` **party-member entry itself**, not a missing field
    within one — confirmed this round by reading `normalizeProject`'s own `party` construction
    (`shared/project.js:5475-5477`): `(Array.isArray(raw.party) ? raw.party : []).slice(...).map((member,
    index) => normalizePartyMember(member, index, ...))` performs no filtering of `null`/`undefined`
    entries before mapping, so a hand-edited `project.party = [null, {...}]` reaches
    `normalizePartyMember` with `raw === null` for real — a live, reachable input, not a hypothetical
    one. `test/unit/project.test.js`, new, modeled on the existing coverage for `baseAtk`/`atk`:
    (a) `normalizeProject` on `project.party = [null]` does not throw, and the resulting member's
    `baseMag`/`magPerLevel` are exactly `0`/`0` (every other field also falls back to
    `createPartyMember`'s own defaults, `num`'s existing behavior for every field, not one this design
    changes) — rules out a normalizer that reads `raw.baseMag`/`raw[key]` without the `?.` guard
    `num()` already uses (`clamp(raw?.[key], ...)`, `shared/project.js:5046`), which throws a
    `TypeError` reading a property off `null` rather than defaulting, and separately rules out one
    that copies `createPartyMember`'s non-zero `baseAtk`-shaped default onto `baseMag` instead of `0`;
    (b) `baseMag: 9999`/`magPerLevel: 9999` on an otherwise-ordinary member object clamp to `255`/`16`
    — rules out a clamp call that was copy-pasted from `atkPerLevel`'s own `0-16` bound but left the
    *base* stat's upper bound at `atkPerLevel`'s `16` instead of `baseAtk`'s `255` (an easy
    off-by-neighbor mistake given the two fields sit right next to each other in
    `normalizePartyMember`, §6); (c) the identical pair of assertions for `battle.mag` on an actor via
    `normalizeActor` — including a `null` entry in `project.sprites.actors`, the same reachable path
    as (a), if `normalizeProject`'s own actor construction is confirmed at implementation time to
    leave actor entries similarly unfiltered before normalizing.
15. **`checkCapacity` refuses a project that overflows the banked region by exactly the magic-power
    delta, and `kernelShortfallAdvice`/`battleShortfallAdvice` do not name a nonexistent "turn magic
    power off" lever** (`test/unit/bankedbytes.test.js` or `generate.test.js`, new — a project sized
    to fit without magic power and overflow with it, asserting the refusal message names one of the
    *existing* levers, not a magic-power-specific one that does not exist). Rules out: Q7's own "no
    bespoke lever" recommendation being silently reversed by copy-paste from a neighboring allowance
    that does have one (`NAME_ENTRY_BATTLE_ALLOWANCE`'s own removal lever, §9's own citation of
    `battleShortfallAdvice:939-967`).

**Magic defence — added this round, in the identical numbered style, each naming the wrong
implementation it rules out.**

16. **`MAGIC_DEFENCE_BATTLE_ALLOWANCE` is exact, on every RPG-capable board** (`test/unit/
    bankedbytes.test.js`, the identical shape as test 1): measure `sample-rpg` with and without a
    nonzero `baseMdef`, `assert.equal` the delta (`65`) against the named constant on MMC1/MMC3/
    UNROM 512. Rules out the identical drift class test 1 already guards against, for the second
    allowance.
17. **The combined per-board base+tables equality test gains two more variants**
    (`bankedbytes.test.js:315-376`'s own variant list): `['magic defence', (p) => { p.party[0].
    baseMdef = 5; }]` and `['magic power + magic defence', (p) => { p.party[0].baseMag = 5;
    p.party[0].baseMdef = 5; }]`, the latter asserting the *combined* delta (`137`) rather than either
    allowance alone — this is the test that would have measured **0** for whichever stat was removed
    second, had the two shared one gate (§8's own named trap); with two independent gates, both
    variants measure their own real, nonzero cost regardless of the other stat's own state.
18. **Byte-identity when off, for magic defence** — no new test: `test/unit/nameentry.test.js`'s
    existing six-fixture SHA-256 gate (test 3, `:91-124`) already covers this, since none of the six
    fixtures carries `mdef` live any more than they carry `mag` live, and the gate asserts the whole
    ROM hashes identically regardless of which of this document's flags a stray emission might have
    tripped.
19. **A mag-only build assembles byte-identical to the mag-only listing this document already had
    before magic defence existed — asserted on the assembled bytes themselves, not on a matching
    region size, which cannot rule out a changed operand at the same total length.** (`test/unit/
    nameentry.test.js` or a new `bankedbytes.test.js` test built the identical way, reusing
    `crypto.createHash('sha256')` the way `nameentry.test.js`'s own six-fixture gate already does,
    `:91-124`) — build `sample-rpg` with only `baseMag` live, `MAGIC_DEFENCE_ENABLED` off, and
    `assert.equal` the whole ROM's own SHA-256 against a pinned pre-magic-defence baseline hash, per
    board, the same way the six-fixture gate pins a whole-ROM hash rather than a byte count. This
    round's own fix already produced the real hashes this test would pin (§9, above: identical
    SHA-256 on all three boards between a magic-power-only tree and this document's own full
    prototype with magic defence gated off). Rules out: magic defence's own new `.if` blocks in
    `spell_damage` failing to strip to nothing when off — the exact regression a shared gate (trap 16,
    §13) or a mis-placed `.endif` could cause without necessarily changing the *region size* (a
    mis-placed `.endif` could leave one instruction swapped for a different one of the same byte
    length, which a size-only check would miss entirely) — without tripping any *other* test in this
    plan, since every other magic-power test already assumes magic defence does not exist.
20. **Subtractive ordering: `mdef` subtracts before the elemental modifier, not after — an exact
    final-HP number that distinguishes all three orderings, the identical shape test 4 already uses,
    and the identical 200-HP headroom test 4 already needs, restated explicitly this round since
    `sample-rpg`'s own Slime has only 12 HP and all three damage numbers below exceed it.**
    (`test/unit/rpg.test.js`, new `mkdtemp` variant, inheriting test 4's own `hp: 200` override on the
    Slime so a lethal-looking hit does not saturate every implementation at the identical "dead, 0 HP"
    result): `Ember` (10, fire, flat) against the fire-weak, 200-HP Slime, caster `baseMag = 50`,
    target `mdef = 20`. Correct (subtract before the modifier, floored): damage `(10 + 50 − 20) * 1.5
    = 60`, **remaining HP `200 − 60 = 140`**. Subtract-after-the-modifier wrong implementation: damage
    `(10 + 50) * 1.5 − 20 = 70`, **remaining HP `130`**. No-subtract-at-all wrong implementation:
    damage `90` (test 4's own number, unaffected by `mdef`), **remaining HP `110`**. All three
    remaining-HP figures are distinct, so a single final-HP read (`140`/`130`/`110`) tells all three
    orderings apart — the identical "assert final HP, never an intermediate amount" discipline test 4
    already established, and the identical reason its own headroom trick is needed here too.
21. **Floor of 1: `mdef` cannot drive the result below 1, whether by exact-zero subtraction or by
    underflow — a single test cannot distinguish the two paths without both starting conditions, the
    identical "one condition per failure mode" shape test 6's own two conditions already use**
    (`test/unit/rpg.test.js`, new, an elementless `mkdtemp` variant spell so the weak/strong step
    cannot interact with the result either way): (a) `roll + mag == mdef` exactly (e.g. `roll = 10`,
    `mag = 0`, `mdef = 10`) — correct result `1`; a wrong implementation with no floor at all gives
    `0`. (b) `mdef > roll + mag` (underflow, e.g. `mdef = 255`) — correct result still `1`; a wrong
    implementation that forces `0` on underflow but never applies the shared `bne`/floor check (an
    early exit right after the `sbc`) also gives `0` here, the identical wrong number as (a), so both
    conditions have to be checked to rule out both shapes of the same missing-floor defect (§13's own
    trap 14).
22. **An mdef-only build subtracts against the bare roll, with no `combatant_mag` involved at all —
    a `mkdtemp` variant of `sample-rpg`, corrected this round to stop presenting its own numbers as
    the starter's own worked example: `sample-rpg`'s `Ember` is a genuinely different, separate spell
    from the starter's own (`10`-damage against the starter's `6`, §11), the two are unrelated
    projects and this test's own numbers do not need to match §11's.** (`test/unit/rpg.test.js`, new,
    `MAGIC_POWER_ENABLED` off): `sample-rpg`'s own `Ember` (`10`, fire, flat) against the fire-weak
    Slime with `mdef = 4` and no caster `mag` at all — assert the final damage is exactly `(10 − 4) *
    1.5 = 9`, not `10 * 1.5 = 15` (mdef silently not applied) and not some other number reflecting a
    stray `mag` contribution that should not exist in this build at all.
23. **Poison and burn are unaffected by a target's `mdef`, the identical shape test 7 already uses for
    a caster's `mag`** (`rpg.test.js`, new — a poison/burn target with a large `mdef`, assert the
    fixed `POISON_DMG`/`BURN_DMG` tick amount is unchanged). Rules out: a future edit accidentally
    routing `cast_poison`/`cast_burn` through the same subtraction, or gating them on `MAGIC_DEFENCE_
    ENABLED` in a way that changes their fixed-amount behavior.
24. **`cast_all`'s RNG state and `bt_tmp2` sentinel survive magic defence the same way they survive
    magic power, the identical shape test 9 already uses** (`rpg.test.js`, extends the existing
    all-target test at `:2125` with an `mdef > 0` target on the receiving side). Rules out:
    `combatant_mdef` or its call-site addition touching `bt_tmp2` (§13's own trap 2/13), which this
    test's existing shape already catches for magic power and this variant extends to magic defence.
25. **A target at level > 1 is defended by `statAt(baseMdef, mdefPerLevel, level)`, not just
    `baseMdef` — a complete monster-cast scenario ending in a per-round HP-delta assertion, corrected
    again this round after the round-2 draft's own detection was unsound.** (`test/unit/rpg.test.js`,
    new, modeled on the existing `'a monster with a spell casts it...'` test's own mechanics at
    `:3235-3265`): a `mkdtemp` variant gives the single monster in the formation (no second monster, so
    no other combatant's own attack can land on the same round and confound the reading — the same
    single-monster shape the existing test uses) a flat, elementless, `30`-damage spell (`amountMin ===
    amountMax === 30, element: 'none'`) and `battle.mag = 0` (no caster-side scaling to isolate). The
    target party member is given `baseMdef = 4, mdefPerLevel = 3`, and reaches level 3 the same direct
    way test 12 already pokes `pc_level`-adjacent RAM (not through `award_xp`, to keep the test
    independent of the XP curve). **Corrected this round: `atk = 0` does not stop the monster's own
    coin-flip physical attack from landing — `physical_damage` floors a hopeless `atk − def` at `1`
    and adds `0`-`3` RNG noise (`engine/battleturn.asm:617-630`) — so watching `PC_HP` for *any* drop,
    as an earlier draft did, can catch a physical scratch from a round before the spell is ever cast
    and assert against the wrong round's own number entirely.** The one observable that means "the
    spell was cast this round" is the monster's own `mon_slot_mp` (`MON_SLOT_MP`) dropping by the
    spell's authored MP cost — `monster_turn` spends it (`sec`/`sbc bt_tmp`/`sta mon_slot_mp,x`,
    `engine/battleturn.asm:876-879`) in the same instruction stream that then falls straight into
    `cast_spell`, before any physical-attack code path can run instead, so an MP drop and only an MP
    drop means this round's action was the spell, never a scratch. The test stalls with `RUN` for up
    to 60 rounds, the identical shape the existing test already uses, recording `hpBefore =
    PC_HP`/`mpBefore = MON_SLOT_MP` immediately before each round and comparing after it: once
    `MON_SLOT_MP < mpBefore`, the round just observed was the cast, and the assertion reads the
    **delta** of that one round (`hpBefore − PC_HP`), not a fixed final figure tied to a `100`-HP
    baseline that an earlier round's own physical scratch could already have moved — which is exactly
    why a physical scratch in an earlier round cannot change the number this test asserts: nothing
    about the delta computation depends on what `PC_HP` was doing before the round being read.
    `PC_HP`/`PC_HP_MAX` are still poked to `100` once, before the loop starts, only so the delta is
    observable rather than lethal even in the worst case (several physical scratches before the cast
    lands). Correct result, growth applied (`statAt(4, 3, 3) = 4 + 3*(3-1) = 10`): damage, and
    therefore the asserted delta, `30 − 10 = 20`. Wrong implementation, `baseMdef` alone (growth
    silently dropped, `mdef` reads as a flat `4` regardless of level): delta `30 − 4 = 26`. Rules out:
    `combatant_mdef`'s own `level_row`/`pc_mdef_at` lookup being skipped in favor of a flat read, or
    `pc_mdef_at`'s own table being emitted from `baseMdef` alone with `mdefPerLevel` dropped on the
    generator side — the identical wrong implementations the earlier drafts of this test already
    named, now caught by a number the test can actually observe, isolated from the coin flip's own
    physical-attack branch by watching the one byte that branch never touches.
26. **The normalizer: a missing `baseMdef`/`mdefPerLevel`/`battle.mdef` becomes exactly `0`, and an
    out-of-range one clamps — the identical shape and the identical `null`-entry reachable path test
    14 already establishes for `baseMag`/`battle.mag`** (`test/unit/project.test.js`, new): (a)
    `project.party = [null]` normalizes to `baseMdef: 0, mdefPerLevel: 0` without throwing, for the
    identical reason test 14(a) does; (b) `baseMdef: 9999`/`mdefPerLevel: 9999` clamp to `255`/`16`,
    ruling out the identical off-by-neighbor copy-paste mistake test 14(b) guards against, now between
    `mdefPerLevel` and `magPerLevel`'s own `0-16` bound rather than `atkPerLevel`'s; (c) the identical
    pair for `battle.mdef` on an actor via `normalizeActor`.
27. **`checkCapacity` refuses a project that overflows the banked region by exactly the magic-defence
    delta, and neither `kernelShortfallAdvice` nor `battleShortfallAdvice` names a nonexistent "turn
    magic defence off" lever — the identical shape test 15 already uses for magic power**
    (`test/unit/bankedbytes.test.js` or `generate.test.js`, new). Rules out: §9's own "no bespoke
    lever" recommendation for magic defence being silently reversed the identical way test 15 already
    guards against for magic power.
28. **A heal is unaffected by `mdef` on the healed member — added this round; §13's own trap 15
    claimed this was already covered and it was not.** (`test/unit/rpg.test.js`, new, extending the
    existing heal test's own setup at `:1794-1818`: `PC_SPELLS |= 2` to grant `Mend`, `PC_HP = 5` —
    uncapped, well below max, so the existing `pc_hp_max` clamp cannot coincidentally hide a wrong
    subtraction by saturating both the correct and the wrong result to the identical maximum): give
    the caster — `cast_heal`'s own target is always `bt_actor`, the caster, never an adversary (§5) —
    a large `baseMdef` (e.g. `50`). Correct result, `mdef` never read at all: `5 + 18 = 23`, identical
    to the existing test's own unmodified number. A wrong implementation that mistakenly reused
    `spell_damage`'s own subtract-and-floor logic for `cast_heal` too would instead read `mdef`
    against the target-that-is-also-the-caster, underflow (`18 < 50`), floor to `1`, and heal only
    `5 + 1 = 6` — a specific, distinct, wrong number, not merely "some other value."

## §15. Phasing

Learning `design-magic.md` §12's own lesson (`:1088-1145`, "the previous phase 3 was never actually
shippable" — a schema phase ahead of its engine phase silently zeroes every field `hex()`'s masking
cannot catch): **schema and engine land in one phase, not two.**

1. **Schema, engine, and the ledger, atomically — magic power and magic defence together, stated
   explicitly: this phase ships both stats in the same change, not one after the other.** Both stats'
   own schema (`baseMag`/`magPerLevel`/`battle.mag`, `baseMdef`/`mdefPerLevel`/`battle.mdef`, §6),
   both predicates (`projectUsesMagicPower`/`projectUsesMagicDefence`, §6), both flags (`MAGIC_POWER_
   ENABLED`/`MAGIC_DEFENCE_ENABLED`, §8), the engine (`combatant_mag`, `combatant_mdef`, and `spell_
   damage`'s/`cast_heal`'s own call-site additions, §7), both pairs of tables (`pc_mag_at`/`mon_mag`,
   `pc_mdef_at`/`mon_mdef`, §8), both ledger terms wired into `battleRegionBytes` (`MAGIC_POWER_
   BATTLE_ALLOWANCE`/`MAGIC_DEFENCE_BATTLE_ALLOWANCE`, §9), and **the full ledger/emulator/normalizer
   test set for both — §14 items 1-9 and 12-28: every growth, saturation, floor, ordering, normalizer
   and capacity/advice test for either stat, all engine, schema or capacity checks with nothing
   UI-shaped about any of them, test 28 (the heal-vs-`mdef` test added round 2) included alongside its
   own siblings** — all in one change. The two stats are independently gated (§8) but
   not independently *phased*: they were designed, priced and tested together in this one document,
   and splitting them into separate phases would buy nothing — magic defence's own engine and ledger
   work is a small, mechanical extension of magic power's own (§7/§9), not a separate undertaking with
   its own integration risk to isolate.

   **Landing schema normalization and engine support together is an integration choice that
   ensures enabled projects have complete, defaulted stat fields.** A test genuinely *can* attach
   `baseMag` to one party member by hand with no schema support at all —
   `bankedbytes.test.js`'s own `measureRegion` (`:121-136`) already mutates a freshly loaded project's
   plain properties (`project.party[0].renamable = false`, and the caller's own `mutate(project)`
   callback, exactly how §9's own measurement set `baseMag` on one member) before handing it straight
   to `buildProject` — so a test built the same way, against a hypothetical engine-only build with no
   normalizer support, could set `party[0].baseMag = 5` while `party[1].baseMag` stays `undefined`,
   and `projectUsesMagicPower`'s own `some(...)` predicate (§6) would see the populated member and
   answer true, turning `MAGIC_POWER_ENABLED` on for a project that is only *partially* populated —
   exactly the state that would then read `undefined` off the other member into `statAt`. The
   distinction that actually holds: an **entirely** absent set of schema fields (no test has touched
   any project's `baseMag` at all) leaves `projectUsesMagicPower` false everywhere and the feature
   fully disabled, safely; a **partially populated** project — reachable, as just shown — can enable
   the feature and needs the normalizer's own defaults (`num()`'s fallback, §6) to be safe. Landing
   the normalizer alongside the engine in one phase is therefore a sensible integration choice, not a
   technical impossibility of testing the two apart. No UI yet — the stat is real
   and testable via `rpg.test.js` and the ledger tests the moment this phase lands, with no way to
   author it from the running app, which is exactly the CLAUDE.md "Conventions" rule this phasing is
   built to satisfy: nothing here offers a control the engine does not honour, because there is no
   control yet.
2. **The Forge fields, both stats.** Character Forge's and Monster Forge's Magic *and* Magic defence
   fields (§10), their smoke coverage — **§14 items 10-11** for Magic (both including the
   round-2-added save/reload assertion), reusing the identical patterns verbatim for Magic defence
   (§10's own closing note). Only shippable *after* phase 1, because before it there is no compiled
   effect for an author to see — exposing either field earlier would be exactly the labeled-vs-real
   gap CLAUDE.md's own "Conventions" section refuses.
3. **Starters and the ROADMAP entry, both stats.** Hero's real `baseMag`/`magPerLevel` values and
   Slime/Bat's real `mdef` values on the RPG starter (§11), the new ROADMAP item 13 sub-item covering
   both stats as one unit of work (§12). Depends on phase 2 existing (an author needs both Forge
   fields to see what the starter shipped with) but is otherwise a pure content/docs change with no
   schema or engine dependency of its own — natural to fold into phase 2's own commit, or land as its
   own trivial one, the same flexibility `design-magic.md` §12 item 2's own `ELEMENTS` append is
   given.

## §16. Open questions for Chris

**Decided (2026-09-10 evening).** Every question v6 left open has an answer now; none is reopened
here. One line each, the section carrying the full reasoning:

1. **Additive amount scaling (§2).** Cheaper, no new scratch byte needed, no `bt_tmp2` conflict —
   `mulscale`'s own priced-but-unbuilt multiplicative alternative stays unbuilt.
2. **Both sides, for both stats (§3, §5).** Every `combatant_*` lookup already takes either combatant
   as a plain index; no `battle.mag`/`battle.mdef`-less asymmetry on the Monster Forge. Chris also
   asked whether a monster could carry a *list* of spells to pick among, rather than the single
   `battle.spellId` it has today — recorded as its own, separate, explicitly queued later slice
   (§17), not designed in this round.
3. **Damage and heal, both, for magic power (§4).** A stronger caster's heal spells restore more, the
   identical shape a stronger caster's damage spells hit harder.
4. **Magic defence is in (§5) — the one decision against this document's own v6 recommendation, and
   the reason this round exists.** Damage only (a heal has no defending target), subtracted from
   `(roll + mag)` before the elemental modifier, floored at 1 — designed, priced, gated, measured and
   tested in full at §5 through §15.
5. **Growth stays base + per level, precomputed into a table like every other stat (§6, §7, §9).**
   Chris was offered random per-level ranges and project-wide flat values; base+perLevel was chosen on
   cost — it is the identical, already-built `statAt`/`levelTable` machinery every other growth-bearing
   stat in this codebase already uses, needing no new precomputation shape.
6. **Hero only in the starter; no starter monster caster (§11).** Neither Slime nor Bat casts a spell
   in the shipped starter, so a monster's own `mag` would have nothing to scale — `baseMag: 8,
   magPerLevel: 2` on Hero alone stands as the default.
7. **No checked-in fixture opts in, for either stat (§11).** Nothing about magic power or magic
   defence needs a real boot/save/reload sequence against a checked-in fixture to prove it works —
   every test in §14 builds a `mkdtemp` variant instead, the identical mechanism `bankedbytes.test.js`'s
   own `measureRegion` already uses for the ledger.

**Open — what magic defence itself still leaves undecided, each with a recommendation:**

1. **Exact starter `mdef` values for Slime/Bat (§11).** Recommend `mdef: 4` on both — enough to
   visibly reduce Hero's own `Ember` cast (the starter's own real `6`-damage spell,
   `shared/starters/rpg.js:196`: `(6 + 8 − 4) * 1.5 = 15`, against `21` unmodified) without making the
   fight a non-event. Any value Chris prefers lands in the same `importEntry(project, 'monster',
   'Slime')`/`'Bat'` call sites (`shared/starters/rpg.js`, §0) with no other consequence — the worked
   number in §11 would need re-deriving against a different value, nothing structural. (§14's own
   test 22 uses `sample-rpg`'s own, separate `10`-damage `Ember` in a `mkdtemp` variant, not the
   starter's `6`-damage one — the two are unrelated numbers from two different projects, corrected
   this round after they were conflated.)
2. **Floor of 1, or floor of 0 (§5)?** Recommend floor of 1, matching every existing damage floor in
   this codebase (`physical_damage_floor`, `spell_damage_strong`) — not because floor 0 is
   prohibitively expensive (**corrected this round, again: it is not — see below**), but because it
   would be the first zero-damage hit this compiled battle math has ever produced, and departing from
   an established, unconditional "never less than one" precedent silently is a worse choice than either
   keeping it (recommended) or deciding to break it everywhere at once, which this document does not
   propose. `spell_damage_strong` (`engine/battleturn.asm:766-770`) has its own, independent floor —
   `lda bt_dmg_lo / lsr a / bne spell_damage_store / lda #1` — that fires on *any* zero result reaching
   the halving step, not only ones magic defence produced, so simply deleting `spell_damage_mdef_
   floor`'s own `lda #1` (removing only the branch this design's own listing adds) would **not** give a
   resistant target a true zero-damage hit at all: the number would already be `0` on the way in,
   `lsr a` keeps it `0`, and `spell_damage_strong`'s own, unmodified `bne`/`lda #1` would floor it right
   back to `1` regardless. **Corrected this round: distinguishing that already-zero value from an
   ordinary small positive one needs no new state, only a branch placed before the `lsr` instead of
   after it** — an earlier draft of this document priced a new "defence fired" scratch-byte flag at
   4-6 bytes to make the distinction, which was wrong: the distinction is already available for free,
   because the *only* way `spell_damage_strong` can ever be entered holding a literal `0` is a
   magic-defence subtraction that landed exactly on it (an ordinary small roll's floor is `1`, never
   `0`, on every path that does not involve magic defence at all), so testing for a literal `0` on
   entry, before the `lsr`, already means "defence produced this" without tracking anything across the
   call. `lda bt_dmg_lo` / `.if MAGIC_DEFENCE_ENABLED` `beq spell_damage_done` `.endif` / `lsr a` / ...
   — two bytes, gated so mag-only assembly is untouched — lets a literal incoming `0` return `0`
   unmolested while an incoming `1` (today's ordinary case) still falls through to the unchanged
   `lsr`/`bne`/`lda #1` and floors to `1` exactly as it does today. The other half of floor 0 — letting
   `spell_damage_mdef_floor` actually produce a `0` instead of flooring to `1` — is a **removal**, not
   an addition: dropping its own floor-to-1 arm shrinks that block from `12` bytes to `8`. **Priced in
   full: `-4` (the shrunk subtract/floor block) `+2` (the new branch in `spell_damage_strong`) = `-2` —
   floor 0 costs *two bytes less* than the recommended floor-1 design, not more, and needs no new
   scratch byte at all.** Floor 0 therefore is a small, contained, and *cheaper* change in pure byte
   terms — the recommendation stands on its original ground alone: matching every other floor this
   codebase already has, not on a cost argument that turned out to run the other way. §14's own test 21
   plan would need a floor-0 sibling (a resistant-target hit with `mdef` exactly equal to `roll + mag`,
   asserting a true `0`) if Chris chooses this path; this document does not add it since floor 1
   remains the recommendation.

## §17. Out of scope, explicitly

- **A monster's own spell choice as a LIST, rather than the single `battle.spellId` it has today —
  Chris asked for this alongside the "both sides" decision (§16), and it is recorded here as its own,
  separate, explicitly queued later slice, not designed in this round.** `shared/project.js` (`~4963`)
  and `renderer/forges/monster/monster.js:127-146` already establish a monster's own `battle.mp` (a
  mana pool) and a single `battle.spellId` it does **not** simply cast whenever it can afford to —
  corrected this round: `monster_turn`'s own dispatch (`engine/battleturn.asm:863-879`, re-read in
  full: `lda mon_spell,y / cmp #$FF / beq monster_turn_attack`, then an MP check, `bcc monster_turn_
  attack` if it cannot pay, and only then `jsr rng_next / and #1 / bne monster_turn_attack` — a coin
  flip *in addition to* affording it) casts about half the time it can afford the spell, falling back
  to a physical attack otherwise — the same 50% the Monster Forge's own "Casts" field tooltip already
  states (`monster.js:141`, "Cast about half the time while the MP above lasts; otherwise it attacks").
  Letting a monster instead carry several spells to pick among would need its own authoring surface
  (which spell, in what order or with what weighting), its own table shape, and its own selection
  logic in `monster_turn` — a real, separate design with its own capacity and gating questions, not a
  small addition to this one.
- Spell animations of any kind — ROADMAP item 13 sub-item 2's own open thread, unrelated to either
  stat and untouched by both.
- Equipment or any other source of a stat bonus beyond the four authored fields in §6 — this design
  adds exactly `baseMag`/`magPerLevel`/`baseMdef`/`mdefPerLevel` on a party member and `battle.mag`/
  `battle.mdef` on an actor, nothing else.
- Any change to `physical_damage`, `combatant_atk`, or `combatant_def` — the physical damage path is
  completely untouched by either stat; only `spell_damage` gains both the add and the subtract, and
  only `cast_heal` gains the add (§5: a heal has no defending target, so it never gains a subtract).
- Any change to poison or burn (§4/§5, confirmed neither reads `roll_spell_amount` and neither stat's
  own code touches either routine).
- A magic *defence* on the caster's own side, or any interaction between magic power and magic
  defence beyond the plain `roll + mag − mdef` this design specifies (§5) — no "counter-magic," no
  stat that reduces how much `mag` itself contributes, nothing beyond the one subtraction.
- A "turn magic power off" or "turn magic defence off" lever in `battleShortfallAdvice` (§9) —
  deliberately not added for either.
- Re-pinning any of the six checked-in fixtures' SHA-256 baselines (§11) — none of the six opts into
  either stat, so `nameentry.test.js`'s existing gate needs no change from this design.
- Adding `.if`/`.endif` indentation, the absolute-vs-zero-page addressing convention, or the
  31-character label limit to CLAUDE.md's own "6502 traps" list — noted in §13 as worth doing, left
  to the implementation phase rather than this design document.

## §18. Changelog

v1: initial design round. Nothing to record — no prior round of this specific design exists to have
changed anything from.

v2 (this round): v1 went to review and came back NO-GO, 14 P2 + 1 P3. Every finding below was fixed
in place; no section shrank (§9/§14 append, §7's two call-site listings and §2's `mulscale` sketch
grew substantially, §16 gained a new item).

- **F1 (P2):** §14 test 4 was not observable (`rpg.test.js` reads final HP loss, never an intermediate
  rolled amount). Rewritten as a concrete `mkdtemp` variant: `Ember` (10, fire, flat) against the
  fire-weak Slime with `baseMag = 50` deals exactly 90 — `(10+50)*1.5` — distinguishing add-before-
  weakness (correct, 90) from add-after-weakness (65) and no-add (15); stated why an elementless spell
  cannot distinguish the ordering, and that Ember's flat range needs no RNG seed.
- **F2 (P2):** §2's `mul16` sketch was algorithmically broken (doubled only the multiplicand's low
  byte, losing the value on overflow — `roll=16, mag=0` computed 0, not 16) and mispriced (43 bytes as
  displayed, not 31; missing the `>>4` scale and clamp entirely). Replaced with `amount = min(255,
  roll + ((roll×mag)>>4))` and a correct, hand-verified (against `3×5=15`) MSB-first shift-and-add
  `mulscale` routine: 79 bytes, roughly 315-515 cycles, needing two new `engine/constants.asm`
  equates (`mag_copy`, `prod_hi`) or the hardware stack instead.
- **F3 (P2):** the `bcc` on the additive add's saturation check was priced backwards — it is *taken*
  (3 cycles) on the common no-overflow path, not the rare one. Corrected: call-site overhead 19
  typical/20 saturating (not 18/21); party totals 101-126/102-127 (not 100-125); monster 68/69 (not
  67); four-target worst case 508 (not 500); the inline `level_row` comment's stray "29-56" corrected
  to "31-56" to match the table.
- **F4 (P2):** `boot`/`tap` re-cited to `rpg.test.js:134`/`:141` (not `:115-127`, which holds
  unrelated battle-phase/command/button constants).
- **F5 (P2):** §3's claim that `spell_damage`/`cast_heal` do not branch on side, and that party-only
  magic power would be the "first side-conditional branch," was false — both routines already branch
  on side today (`cast_heal:332-334`, `spell_damage:739-741`). Replaced with the true distinction:
  every existing branch in this chain selects a *table*, never whether a step *runs at all*; a
  party-only gate on the add itself would be the first branch of that second, different kind.
- **F6 (P2):** "excluding heal removes half the measured allowance" was wrong twice (in §4 and in
  §16's open question). Corrected in both places: `combatant_mag` (44 bytes, shared) is not removed by
  dropping heal, only `cast_heal`'s own 14-byte call site is — a projected 58-byte allowance, not 36.
- **F7 (P2):** the "forward compatibility" passages (trap 7, and §6's schema note) had the direction
  backwards — a newer project's real, present `baseMag` reopened by an older app is silently *dropped*
  on save, not "handled via `num()`"; the genuinely safe direction is an older project's *missing*
  field resolving through `num()`'s fallback in a *newer* app. Both passages rewritten; the words
  "forward compatibility" removed from both.
- **F8 (P2):** the generator claim was wrong in mechanism — `tools/make-rpg-sample.js:283-288` and
  `tools/make-rpg-save-sample.js:288-289` *spread* `createPartyMember`'s literal return value into the
  generated JSON, they do not omit `baseAtk`/`atkPerLevel`. Corrected: a nonzero default would not
  break `samplegen.test.js`'s load-equality either (both sides would resolve to the same current
  default); the zero default is required for gameplay-invariance and the feature gate, not for the
  generator/load-equality.
- **F9 (P2):** the claim that `kernelbytes.test.js` "would catch" a future kernel-lo dependency
  over-promised — its board check is `assertCovers` (`:295-316`), a margin band, not the banked
  region's exact equality, and all six fixtures are magic-power-off so no existing kernel measurement
  ever exercises `MAGIC_POWER_ENABLED = 1` at all. Rewritten to state the real limitation and require a
  new enabled/disabled kernel measurement if a kernel-lo dependency is ever added.
- **F10 (P2):** "the existing levers already cover every shortfall" is not a guarantee
  `battleShortfallAdvice` makes — its `levers` loop (`:923-935`) only offers a reduction that actually
  closes the deficit, and falls back to a generic, unverified sentence (`:1013-1018`) when none does.
  Recommendation (no bespoke lever) kept, justified on the term's small measured size instead of a
  false guarantee.
- **F11 (P2):** tests 5 and 6 under-specified which wrong implementation they ruled out. Test 5 now
  reuses the existing walked-into-Snake scenario (actor id 3, battle slot 0 — already numerically
  distinct) with a deliberately different, large `mag` on an unrelated actor (Slime, id 0) so a
  slot-as-actor-id misread produces a specific, wrong number. Test 6 now specifies two starting-HP
  conditions (uncapped and capped) so "the add is missing" and "the add runs after an already-clamped
  store" are each independently caught.
- **F12 (P2):** coverage gaps. Added: a save/reload assertion for both Forge fields (§10, §14 tests
  10-11, modeled on `main/smoke.js:1572-1578`'s existing map round-trip); a `magPerLevel` growth test
  (§14 test 12); an overflow/saturation test (§14 test 13); a normalizer test for missing/out-of-range
  `baseMag`/`magPerLevel`/`battle.mag` (§14 test 14, new). The old test 12 renumbered to 15.
- **F13 (P2):** §7's `spell_damage`/`cast_heal` listings both ended in `...`, against the brief's own
  "complete listing" convention. Both rewritten in full, re-read from `engine/battleturn.asm` at HEAD,
  with an explicit register/scratch contract stating what each routine leaves in A/X/Y on exit,
  `cast_heal`'s later `tax` on `bt_actor`, and `spell_damage`'s pre-existing `:746` reload.
- **F14 (P2):** the claim that "no fixture opts in" was name entry's own established policy was
  backwards — phase 5 opted three fixtures **in** (`nameentry.test.js:85-90`). Corrected to the real
  policy (hand-edit only when a test genuinely needs it, never regenerate), kept the recommendation on
  its own merits (magic power needs no fixture-level proof the way naming's own grid did), and added
  §16 item 7, the missing open question this correction surfaces.
- **F15 (P3):** "every operand is 3-byte absolute (4 cycles)" over-generalized — absolute-indexed
  stores are 5 cycles, indexed reads can cross a page, and read-modify-write differs again (6 cycles,
  already labeled `abs-rmw` throughout but not reconciled with the blanket sentence). Narrowed to name
  which instruction shapes get which cost. The intro's "measured... on real hardware timing" reworded
  to "measured as `nesasm`'s own real assembled-size output from an actual build" — `nesasm` measures
  size, not hardware timing.
- **[orch]:** fixed a duplicated "CLAUDE.md CLAUDE.md" (split across a line break); reworded §15
  phase 1's "engine with no schema has nothing to read" to name `battleTables` and the `NaN`/`hex()`
  masking hazard precisely rather than conflating schema with table generation; named `normalizeActor`
  explicitly in §0 rather than only "the actor battle normalizer"; the column-0 `.if` finding was
  independently reproduced and needed no further change beyond F15's wording.

v3 (this round): v2 went to review and came back NO-GO, 8 P2 + 2 P3. Round 1's fifteen findings were
all confirmed closed except where noted below; these ten are the residue. No section shrank.

- **G1 (P2):** §7's call-site register contracts were wrong — "Y … never touched … for a party
  target" ignored that `roll_spell_amount`/`mod8` clobber Y on every *ranged* roll
  (`engine/battleturn.asm:683-729`); X changes at the pre-existing `ldx bt_arg` immediately, before
  the cited `tax`; and `cast_heal` does not "return its amount in A" — it has no `rts` of its own at
  all (`cast_spell` reaches it by `jmp`, not `jsr`), and tail-calls through `print_num` into
  `battle_say_actor`/`battle_say` (`engine/battleui.asm:584-614`), whose own `rts` returns with
  `A = BP_MESSAGE`, with X/Y freely clobbered by `push_combatant_name`/`push_battle_string`
  (`:618-704`) along the way. Both contract comments rewritten to state the whole chain honestly and
  to distinguish what `combatant_mag` itself preserves from what its callers do afterward.
- **G2 (P2):** §3's replacement justification ("every existing branch picks which table, never
  whether a step runs at all") was still false, and self-contradicted its own citation of
  `spell_damage:739-741` skipping the elemental step outright for a party target. The "no precedent"
  framing is dropped; the recommendation now rests on the real grounds — every `combatant_*` lookup
  already takes either side, monsters cast through the same routines, and a party-only stat would
  need a `battle.mag`-less asymmetry on the Monster Forge for a verified-small saving
  (`combatant_mag_mon`'s own 10 bytes, ≤14 including the dispatch). Fixed in §3 and its §16 echo.
- **G3 (P2):** `mulscale`'s cycle figures were off (a clear-bit iteration is 26, not 25) and its
  overall range re-derived by exhaustive simulation (326-477, not hand-multiplied bounds, which
  overstate the true maximum). The byte/cycle comparison against the additive design now compares
  complete paths: additive 72 bytes (44+14+14) / 68-127 cycles per resolution; multiplicative 141
  bytes (44+79+9+9) / 391-600 cycles per resolution (both include the identical, shared
  `combatant_mag` cost) — roughly 4-8x, not "roughly 20x," which came from comparing only the
  call-site overhead in isolation (342-493 vs. 19-20) rather than the full resolution.
- **G4 (P2):** `mulscale`'s entry comment wrongly claimed roll is pre-parked in `bt_tmp` by the
  caller; corrected to the real contract (A = roll, `bt_ret` = mag, no pre-parked copy —
  `spell_damage`/`cast_heal` use `bt_dmg_lo`/`bt_tmp` for their rolls, never a shared convention).
  Distinguished "needs two scratch locations" (true) from "must allocate two new RAM bytes" (not
  necessarily — `bt_x`/`bt_y` are free the moment `mulscale` runs, since it is only ever called after
  `combatant_mag` has already restored them). Dropped the "pla/pha pair" alternative: two
  simultaneously-live stacked values cannot be read/written independently that way.
- **G5 (P2):** §14 test 13's setup was impossible — `mon_slot_hp` is one byte
  (`engine/constants.asm:557`), so "enough HP to survive 255 unclamped" cannot exist, and an elemental
  spell would let `spell_damage_weak`'s own downstream saturation mask a missing add-saturation branch
  entirely. Rewritten with an elementless `mkdtemp` spell (200/200/none), `baseMag = 255`, target HP
  exactly 255, asserting HP reads 0 (correct, saturated) vs. 56 (a wrapping implementation), read
  before further battle activity can obscure the slot.
- **G6 (P2):** test 14(a) named a wrong implementation (`raw.baseMag` without `?.`) that a
  missing-key object cannot distinguish — a plain property read never throws on an absent key, only
  on a `null`/`undefined` base object. Verified `normalizeProject`'s own `party` construction
  (`shared/project.js:5475-5477`) performs no filtering before mapping, so `project.party = [null]` is
  a real, reachable input; rewritten around that case, which genuinely distinguishes `raw?.[key]` from
  `raw[key]`.
- **G7 (P2):** §15 left tests 12-15 unassigned to any phase. All four (growth, saturation,
  normalizer, capacity/advice) are engine/schema/capacity checks with nothing UI-shaped about them;
  assigned explicitly to phase 1 alongside items 1-9.
- **G8 (P2):** phase 1's own rationale described a `NaN`/`hex()`-masking hazard this design's
  architecture cannot actually produce — `MAGIC_POWER_ENABLED` and every table/code emission it gates
  all derive from the identical schema-fields predicate, so an absent schema makes the gate false
  everywhere, and nothing schema-dependent is ever emitted unconditionally the way v1's historical
  `design-magic.md` §12 case was. Restated the true reason: the gate is derived from the schema, so
  engine and schema cannot be tested apart at all, not merely unsafe to ship apart.
- **G9 (P3):** F15's fix had not been carried everywhere — §13 trap 12 still stated the flat, wrong
  "3-byte absolute (4 cycles)" rule; narrowed to name which instruction shape gets which cost, same as
  §7. Also corrected §7's own claim that its listing "contains no indexed stores" — the completed
  `cast_heal` listing has several (`sta pc_status,x` and three siblings), all unchanged stock
  instructions; the sentence now says so precisely rather than claiming none exist at all.
- **G10 (P3):** two local contradictions. A `bne` was labeled "2 taken/3 not" though the totals beside
  it already used the correct 3-taken/2-not-taken numbers — fixed the label only. Test 6 condition B
  said an 18-point roll against 10 HP of headroom "may or may not" exceed it — `18 > 10` always does,
  not a maybe; and its own "pushes past `PC_HP_MAX` by up to `mag`" wrong-implementation description
  now also states the byte can wrap to a value *below* `PC_HP_MAX`, not only exceed it.

v4 (this round): v3 came back NO-GO, 4 P2 + 1 P3, all in explanatory prose — the listings, the
72-byte reconciliation, the test numbers and the fences all held. No section shrank.

- **H1 (P2):** §7's `cast_heal` contract still claimed "there is no return address here to protect"
  and cited a nonexistent `jsr cast_spell`. `grep -n cast_spell engine/battleturn.asm` finds exactly
  two call sites, `:181` and `:881`, both `jmp`, never `jsr` — a tail call preserves the *existing*
  return address, it does not eliminate the need to protect one. Rewrote the passage to trace the
  chain — **this entry corrected again in round 5 (J1): the trace below still skipped a real frame.**
  `battle_tick` (`engine/battle.asm:233-236`) is `jsr wipe_tick / jsr battle_dispatch / jmp
  battle_draw_sprites` — `jsr battle_dispatch` at `:235` is a second, closer return address that
  `battle_say`'s own `rts` actually answers to, landing back at `battle_tick:236`
  (`jmp battle_draw_sprites`, A discarded unread) rather than in `call_battle` directly;
  `battle_draw_sprites`'s own `rts` (`engine/battleui.asm:931`) is what finally reaches `call_battle`.
  See §7's own current comment for the complete, correct hop-by-hop trace.
- **H2 (P2):** §3's party-only alternative was still wrong three ways — (a) it
  overlooked `cast_heal`'s own genuine caster-side branch (`:332-334`); (b) "a gate in `combatant_
  mag`'s own caller, not in `spell_damage`/`cast_heal`" was self-contradictory, since those two
  routines are its only callers; (c) "14 bytes saved" wasn't a complete alternative's net cost.
  Rewrote the caster-side claim precisely, and priced a concrete, complete party-only `combatant_mag`
  variant in full (37 bytes, vs. the both-sides routine's measured 44) — a real 7-byte code saving,
  not 10 or 14, with `spell_damage`/`cast_heal` genuinely unchanged either way since the whole
  question is contained inside `combatant_mag` itself. Fixed in §3 and its §16 echo.
- **H3 (P2):** §15 phase 1's rationale over-claimed again — "there is no project any test could
  construct" to exercise the engine before schema support is false: JS objects aren't type-checked,
  and `bankedbytes.test.js`'s own `measureRegion` (`:121-136`) already mutates a loaded project's
  plain properties before building, the identical shape a test could use to set one member's
  `baseMag` by hand with no normalizer support at all — reproducing the exact partially-populated
  state the previous claim said was unreachable. Restated precisely: an entirely absent field set
  leaves the feature disabled safely; a partially populated one needs the normalizer's own defaults;
  atomic delivery is a sensible integration choice, not a technical impossibility of testing apart.
- **H4 (P2):** the one-cycle gap between the hand-derived low bound (327) and the simulated 326 was
  wrongly attributed to "a boundary case elsewhere in the tail." The real cause: the multiply loop's
  *final* iteration never takes its own `bne` (loop exit), costing one cycle less (25/41/46) than
  every non-final iteration (26/42/47) — `24 + (7x26 + 25) + 69 + 26 = 326` exactly, no approximation.
  Labeled the displayed 26/42/47 figures as non-final-iteration costs and corrected the "every
  iteration at its own worst case" upper estimate to `495` (was `496`, and briefly miscomputed as
  `511` mid-edit before being corrected to the true `495`).
- **H5 (P3):** `mulscale`'s entry comment described the incoming roll as "0-254," which is the RNG
  *draw*'s own range, not the rolled *result* `roll_spell_amount` can hand back — a spell's own
  `amountMax` may be authored up to 255 (`test/unit/rpg.test.js:1862-1869`, a real, tested
  `amountMin: 1, amountMax: 255` spell), so the true range is 1-255. Corrected; the routine already
  handled 255 correctly, only the comment was wrong.

v5 (this round): v4 came back NO-GO, 2 P2 + 1 P3, all prose. This round's own instruction was to
remove or correct a stale sentence in place rather than appending a correction after it, which J2
below is exactly a case of — applied throughout. **§15 shrank** (the deleted, disproved universal
claim and the layered "corrected in round 3... corrected in round 4..." archaeology around it,
replaced by one clean, currently-true explanation) — the only section to shrink this round, expected
and intentional per the brief.

- **J1 (P2):** §7's `cast_heal` return trace (and its own round-4 Changelog entry, corrected in place
  rather than left standing) was still one frame short — it skipped `battle_tick`'s own `jsr
  battle_dispatch` (`engine/battle.asm:233-236`, `jsr battle_dispatch` at `:235`), which is the *real*
  return address `battle_say`'s `rts` (`:614`) answers to, landing back at `battle_tick:236` (`jmp
  battle_draw_sprites`, A discarded unread by that unconditional jump) — not directly in
  `call_battle`. `battle_draw_sprites`'s own first instruction, `lda #$FF`
  (`engine/battleui.asm:833`), overwrites A immediately; its own `rts` (`:931`) is what finally
  reaches `call_battle`. Rewrote the trace hop by hop, citing every line, ending with "no caller
  anywhere in this entire chain ever sees `cast_heal`'s own A."
- **J2 (P2):** §15 phase 1 still stated "there is no reachable state in which `battleTables` emits …
  off an undefined field" directly before its own round-4 correction that had already demonstrated
  such a state is reachable (`bankedbytes.test.js:121-136`, mutating a loaded project before
  building). Deleted the disproved universal claim and the surrounding round-by-round archaeology
  around it entirely, replacing both with one direct explanation of the real distinction: an entirely
  absent schema disables the feature safely; a partially populated project can enable it and needs
  the normalizer's own defaults; landing the normalizer with the engine in one phase is therefore a
  sensible integration choice, not a technical impossibility of testing the two apart.
- **J3 (P3):** §3's own retrospective on why the earlier "14 bytes saved" estimate was wrong blamed a
  "double-subtracted" 3-byte jump, which is not what happened — the old estimate summed the 10-byte
  monster arm plus the 4-byte `cmp`/`bcs` dispatch, neither doubled nor involving the jump at all.
  Restated the real, simple reconciliation instead: remove the both-sides routine's 10-byte monster
  arm and its 3-byte `jmp combatant_mag_ret` merge, add the 6-byte zero-return arm this routine uses
  instead (`lda #0` / `sta bt_ret` / `rts`) — `10 + 3 − 6 = 7`, the same 7-byte net saving as before,
  now derived correctly.

v6 (this round): v5 came back NO-GO on one P2. §15 phase 1's own rationale sentence still repeated
the "cannot be tested apart" impossibility claim rounds 3 and 4 had already rejected, one bold
sentence away from its own surrounding paragraph already showing that claim false.

- **K1 (P2):** replaced the bold sentence "The rationale (rewritten in round 5 in place, not
  appended after the earlier, wrong version): engine and schema cannot be tested apart, because
  JavaScript objects are not type-checked." with "Landing schema normalization and engine support
  together is an integration choice that ensures enabled projects have complete, defaulted stat
  fields." — the rest of the paragraph, already correct, is unchanged. Re-read the whole of §15
  phase 1 afterward and found no other sentence asserting impossibility of testing the two apart;
  the one remaining use of "impossibility" in the paragraph is already negated ("not a technical
  impossibility of testing the two apart"), rejecting the claim rather than repeating it.

v7 (this round): Chris decided seven of this document's own open questions (2026-09-10 evening,
recorded in full at the top of §16). Six confirm v6's own recommendations; the seventh — **magic
defence is in** — is the one decision against v6's own "no, not this slice" recommendation, and the
reason this round exists. Title changed to name both stats. Every "magic defence: no, not this
slice" sentence was searched for and removed or rewritten wherever it appeared (§1, §5, §16, §17) —
none survives unedited, per this round's own rule against appending a correction in front of a
stale claim.

- **§0:** added what was read/verified/measured this round for magic defence specifically —
  `physical_damage`'s own floor idiom re-read in full, `rng_next` read in full, `roll_spell_amount`/
  `mod8` re-read to confirm neither references `bt_dmg_lo`, and the four-configuration `nesasm`
  measurement (both off, mag alone, mdef alone, both live) that backs every figure in §7/§9.
- **§1:** rewritten for v7 — magic defence's own decisions (damage only, before the modifier, floor
  1, its own separate `MAGIC_DEFENCE_ENABLED`/`MAGIC_DEFENCE_BATTLE_ALLOWANCE = 65`) folded in
  alongside magic power's own, at the same summary depth.
- **§5:** fully rewritten from a one-paragraph "no, not this slice" sketch into a real design, at the
  depth §2 gave the additive/multiplicative question: the decision itself, the damage-only
  justification (a heal has no defending target), the before-the-modifier ordering (matching `physical_
  damage`'s own `atk - def` shape), the floor-of-1 justification (matching `physical_damage_floor`/
  `spell_damage_strong`'s own "never less than one"), and the two named alternatives (after-the-
  modifier; floor 0) priced in a sentence or two each, not built.
- **§6:** `baseMdef`/`mdefPerLevel` added to `createPartyMember` beside `baseMag`/`magPerLevel`,
  `battle.mdef` added beside `battle.mag`, `projectUsesMagicDefence` added as its own predicate
  (deliberately not folded into `projectUsesMagicPower` — §8 states why), the save-record and
  `samplegen.test.js` consequences extended to cover it.
- **§7:** `combatant_mdef` added immediately after `combatant_mag`, byte-for-byte the identical shape
  (measured: 44 bytes, identical to `combatant_mag`'s own); a new "Where magic defence parks its own
  value" passage derives and verifies the `bt_dmg_lo` scratch-byte choice by direct reading, not
  assumption; `spell_damage`'s own listing rewritten a fourth time to carry both stats in the correct
  order (mdef parked first, mag staged second, roll, add, subtract, floor); `cast_heal`'s own listing
  explicitly confirmed to carry no magic-defence block at all; every existing trap (1, 2, 5, 6, 7, 8,
  9, 10) extended to cover the new routine and call site, one new trap added for the `bt_dmg_lo`
  parking itself; cycle costs for `combatant_mdef` and its call site priced the identical way.
- **§8:** `MAGIC_DEFENCE_ENABLED` added as its own flag, with the two reasons it is not folded into
  `MAGIC_POWER_ENABLED` stated explicitly (CLAUDE.md's own conditional-allowance rule, and the
  delta-measurement trap a shared gate would create); the mag-only-byte-identical-to-v6 and
  mdef-only-subtracts-the-bare-roll consequences stated directly.
- **§9:** `MAGIC_DEFENCE_BATTLE_ALLOWANCE = 65`, measured (not estimated) on all three RPG-capable
  boards in a four-configuration `nesasm` prototype (both off, mag alone, mdef alone, both live) —
  `137` combined, exactly `72 + 65` on every board, confirmed directly from the "both" column rather
  than assumed from additivity; the table-byte formula, the byte reconciliation against §7's own
  listing, headroom, the no-kernel-lo-term reasoning, and the byte-identity-when-off proof all
  extended to the second stat.
- **§10:** a Magic defence row added to the Character Forge (beside the Magic row) and a Magic
  defence field added to the Monster Forge (beside Magic, in the same row); the "nothing on the
  battle screen" and smoke-coverage passages extended to cover it.
- **§11:** the Hero `baseMag`/`magPerLevel` recommendation restated as **decided**, not open; a new
  passage recommends `mdef: 4` on both Slime and Bat (the only combatants a magic-defence value could
  ever be observed against in the shipped starter, since Hero is the only caster), with a worked
  damage number; clarified that the starter opting in and the six checked-in fixtures staying out are
  two separate questions.
- **§12:** the ROADMAP sub-item recommendation restated to cover both stats as one unit of work.
- **§13:** four new traps for magic defence (the `bt_dmg_lo` parking safety, the floor-of-1 two-path
  collapse, `cast_heal` never gaining a block, the two gates never sharing a predicate); items 3, 4,
  5, 6, 7, 9, 10 each extended with a one-sentence mdef equivalent.
- **§14:** twelve new tests (16-27) for magic defence, each modeled explicitly on an existing magic-
  power test's own shape and naming which wrong implementation it rules out; the subtractive-ordering
  test (20) and the mdef-only test (22) reuse the exact worked numbers §11's own starter
  recommendation already established.
- **§15:** phase 1 restated to ship both stats' schema, engine, ledger and tests together, explicitly,
  with the reasoning for why they are not split into separate phases; phases 2 and 3 extended to cover
  both stats' own Forge fields and starter values.
- **§16:** fully rewritten — the seven questions v6 left open replaced with a "Decided" list carrying
  Chris's own answers, one line each; a new, short "Open" list carries only what magic defence itself
  still leaves undecided (the starter `mdef` values; floor 0 vs. 1), each with a recommendation.
- **§17:** the "magic defence: future extension" bullet removed (it is no longer a future extension);
  a new bullet records the monster spell-*list* idea Chris raised alongside the both-sides decision,
  as its own explicitly queued, separate later slice; the equipment/physical-damage/poison-or-burn/
  shortfall-lever/fixture-repin bullets extended to name both stats.

v7 round 2 (this round): reviewer round 1 came back NO-GO, 8 P2 + 3 P3 — three stale "open question
for Chris" sentences for already-decided questions (§2/§3/§4) fixed in place; test 19's byte-identity
claim re-measured for real (whole-ROM SHA-256 on all three boards, identical between a magic-power-
only tree and this document's own full v7 prototype with magic defence gated off, not merely a
matching region size); test 20 corrected to inherit test 4's own 200-HP Slime and assert remaining HP
rather than a damage number that would kill `sample-rpg`'s real 12-HP Slime in every implementation
alike; test 25 rewritten from an unobservable "`combatant_mdef` returns" claim into a complete
monster-cast scenario ending in a final-HP assertion, with the `rng_next & 1` coin flip in `monster_
turn` stalled out the same way the existing monster-spell test already does; a genuinely missing
heal-unaffected-by-`mdef` test added (28) and trap 15's own false claim of existing coverage corrected
to point at it; the starter's own `Ember` corrected from an assumed `10` to its real `6`
(`shared/starters/rpg.js:196`), with test 22's own, separate `sample-rpg`-based numbers no longer
presented as matching it; §16's floor-0 question and §5's own alternatives both re-priced honestly —
floor 0 still reopens `spell_damage_strong`'s own independent floor (its unmodified `bne`/`lda #1`
would still turn a defence-zeroed hit against a resistant target back into `1`), but closing that gap
needs a two-byte conditional branch reading the value before it is halved, not a new scratch-byte
"defence fired" flag, and costs two bytes *less* than the recommended floor-1 design overall, not the
4-6 more an earlier round-2 pass claimed; and the after-the-modifier alternative is priced correctly at
28 bytes (`combatant_mdef` called at the shared epilogue itself, once the multiply no longer needs
`bt_dmg_lo`'s own running value, so no stack and no `bt_dmg_hi` detour are needed), not the 38-byte
stack-and-`bt_dmg_hi` shape an earlier round-2 pass priced against a problem this shape does not have;
the combined worst-case cycle figure corrected to the one `cast_all` can
actually reach (a party caster against four monster targets, `816`, not a same-side pairing the engine
cannot produce); `physical_damage`'s own claim narrowed to "no elemental multiplier," not "nothing
after the subtraction," since it still has a floor, RNG noise and saturation; and two overstatements
of existing behaviour corrected — `cast_heal` heals only `bt_actor`, never a separately chosen ally,
and a monster casts about half the time it can afford to, not whenever it can.

v7 round 3 (this round): reviewer round 2 came back NO-GO, 4 P2 + 1 P3 — test 25's own detection
mechanism was unsound (watching `PC_HP` for *any* drop cannot tell a coin-flip physical scratch from
the spell itself, since `atk = 0` still floors to a 1-4-damage hit; rewritten to watch the caster's own
`mon_slot_mp` for the spell's MP cost being spent — the one observable a physical attack never touches
— and to assert the HP delta of that specific round rather than a fixed final figure a prior round's
scratch could already have disturbed); the floor-0 alternative's own price was wrong twice over —
round 2 invented a new "defence fired" scratch-byte flag where the existing zero/nonzero distinction,
read one instruction earlier (before the halving `lsr` rather than after it), already tells "defence
produced this zero" apart from "a small roll halved down to it," at two bytes under `MAGIC_DEFENCE_
ENABLED`, not four to six; combined with the floor-1 subtract/floor block's own four-byte shrink once
its floor-to-1 arm is no longer needed, floor 0 prices out two bytes *cheaper* than the recommended
floor-1 design, not more expensive, in both §5 and §16; the after-the-modifier alternative was
similarly overpriced — `combatant_mdef` called at the shared epilogue, after the multiply has already
consumed `bt_dmg_lo`'s own running value, needs no stack and no `bt_dmg_hi` detour, 28 bytes against
the earlier 38; §15's phase-1 test range corrected to include test 28 (`1-9 and 12-28`, not `12-27`),
the heal-vs-`mdef` test round 2 itself added; and the reverse-direction worst-case cycle figure
recomputed after two compounding errors — treating a monster caster's own magic-power cost as its raw
49-cycle body rather than the 69-cycle total with call-site overhead, and treating all four party
targets as if each were member index 3 rather than summing the four distinct per-index costs — from
`736` to the correct `764`, still under the `816` forward-direction bound, which stands unchanged.

v7 round 4 (this round): reviewer round 3 returned GO with three nonblocking P3s — "level-3
(highest-index) party caster" corrected to state plainly that the worst case is about which party
*slot* the caster occupies, not which character *level* they have reached (`level_row`'s own cost
scales with slot index alone, `engine/battle.asm:209-225` — a single, level-independent table read is
the only place the actual level enters); round 3's own `816`/`764` figures corrected again, to `812`/
`760`, after re-deriving rather than copying the reviewer's own numbers — a byte-sized `mdef` can never
exceed `255`, so on the same call where the caster's own magic-power add has just saturated to `255`
the subsequent `mdef` subtraction can reach at most the `13`-cycle exact-zero path, never the
`14`-cycle underflow path the `77`/`28`/`135` figures assumed, one cycle cheaper per target, four
targets, in both directions; a wrong explanation in the after-the-modifier alternative's own byte
pricing removed — the `beq`/`bne` pair's two `lda` arms both assemble unconditionally (the branch only
decides which one *runs*), not one-or-the-other at assembly time, though the 8-byte subtotal and
28-byte total both already were right; and the floor-0 alternative's own proposed sibling test
recited to §14's actual floor test (21), not the heal test (28) a copy-paste had named instead.

## §19. Places a claim could not be pinned to a line and was reasoned instead

- **§9's cycle-cost table for a party caster at member index 3 (107 cycles) assumes `RPG_LIMITS.party
  = 4` is the real ceiling `MAX_PARTY` enforces at runtime**, rather than citing a line that states
  "no party member index ever exceeds 3" directly — this is `engine/constants.asm:543`'s
  `MAX_PARTY = 4` combined with `combatant_mag`'s own `cmp #MAX_PARTY` branch (§7), reasoned rather
  than found as a single stated invariant.
- **§2's multiplicative-alternative pricing (`mulscale`) is a genuine estimate, explicitly not
  measured** — it was never built or assembled, per this document's own "measure or label estimate"
  discipline; its byte/cycle figures are derived from the same instruction-cost reasoning §7/§9 apply
  to the real, measured listing (and, unlike v1's own broken sketch, hand-verified against a worked
  multiplication example), not from a build.
- **§13 trap 11's characterization of the column-0 `.if` failure as "nesasm v3.1 requires conditional-
  assembly directives to be indented"** is reasoned from the empirical failure (a flush-left `.if`
  fails; every existing indented one in the whole engine tree succeeds) rather than from any nesasm
  documentation, which was not consulted — no such documentation is checked into this repository or
  was read for this round.
