# Design: magic power — a caster stat for spell damage and healing — v6

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

## §0. What was read to write this document (HEAD `eab9eb0`)

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

## §1. Recommendation at a glance

Additive (§2), both sides (§3), damage and heal only (§4), no magic defence this slice (§5), schema
default 0/0 (§6), the add sequenced through `bt_ret` before the roll rather than through `bt_tmp`
(§7), gated on `MAGIC_POWER_ENABLED` with its own measured `MAGIC_POWER_BATTLE_ALLOWANCE = 72`
(§8-§9), Magic fields on both Forges with no battle-screen display (§10), the RPG starter's Hero
gets a real value and no checked-in fixture opts in (§11), one new sub-item under ROADMAP item 13
(§12). §16 lists every open question with its recommendation; the rest of this document builds the
recommended path in full and prices the alternative honestly where one exists.

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
failed to clear. This is also an open question for Chris (§16) — the consequence of picking
multiplicative is committing `mulscale` for real (`bt_x`/`bt_y` reused, or `mag_copy`/`prod_hi` newly
equated in `engine/constants.asm`, above), re-measuring §9's ledger term against the real routine
rather than this estimate (141 bytes projected, against `combatant_mag`'s own 44-byte-alone measured
baseline), and accepting the roughly 4-8x total cycle cost this section now prices like-for-like.

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
small (7 code bytes plus a handful of table bytes) cost. Open question for Chris (§16).

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
lookup. Open question for Chris (§16) — heal in or out; excluding heal removes `cast_heal`'s own
call-site addition from §7's listing **and none of `combatant_mag` itself**, since `spell_damage`
still needs the shared routine — **not "half" of §9's measured allowance.** §9's own measurement
found `combatant_mag` at 44 bytes (shared, one copy) and each call site at 14; excluding heal drops
one 14-byte call site, leaving a projected **58 bytes**, subject to re-measurement, not the 36 a
naive halving of 72 would suggest.

## §5. Q4 — a magic defence

**Recommendation: no, not this slice.** One new stat, both sides, damage and heal — adding a magic
*defence* on the target's side would need a second stat (`battle.mdef`/`baseMdef`), a second table
column, a second `combatant_*` lookup, and a decision about how it interacts with the existing
weak/strong elemental multiply (does resistance apply before or after mdef? does mdef apply to a
heal spell's own amount, which currently has no "target defends" concept at all since a heal always
targets a willing ally?) — real design questions this document is not forcing an answer to now.
Nothing here forecloses adding one later: `combatant_mag`'s own shape (§7) is exactly the template a
future `combatant_mdef` would follow, and `spell_damage`'s insertion point (before the elemental
modifier) is exactly where a `- combatant_mdef(bt_target)` term would slot in beside the mag add,
the same way `physical_damage` already does `atk - def` on the physical side today. This is the
identical "record what a real one would need, so Chris can decide later rather than this being
silently dropped" discipline `design-character-forge.md` §5 already applied to magic power itself.

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

**`projectUsesMagicPower(project)`:** true when any party member has `baseMag > 0 || magPerLevel > 0`,
or any actor has `battle.mag > 0` — the exact shape `projectUsesItems` (`:5930-5932`) already takes
for "an author's authored choice, taken at face value," not a resolved-reachability question. This is
the single predicate `MAGIC_POWER_ENABLED` (§8), the table-emission gate (§9), and
`battleRegionBytes`'s own new term (§9) all read — one writer, the same discipline `fontBankSplit`/
`projectUsesText` already hold each other to (CLAUDE.md, "The message font").

**Save-record consequence: none.** `saveIdentity` (`shared/save.js:224-269`) folds counts, never a
stat value, and `baseAtk`/`atkPerLevel` changing today already does not invalidate a save — `pc_atk`/
`pc_def` have no cached RAM byte at all (§0's own `party_apply_level` citation), so nothing about
them is ever serialized to begin with. `combatant_mag` follows the identical no-cache shape (§7): a
save stores `pc_level` and `party_restore`/`party_apply_level` recompute everything level-dependent
against the *current* build's own tables on load, `BE_RESTORE`'s own reason for existing
(`engine/save.asm:543-550`). `SAVE_LAYOUT_VERSION` does not move.

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
members already have.

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

**The call sites.** Both insert the identical shape: call `combatant_mag` with `bt_actor` — the
caster's own index, on **either** side — before rolling, then add the staged `bt_ret` into the roll
after it returns, saturating at `$FF`:

**Complete, both routines — F13's own round-2 correction: v1 truncated both with a trailing `...`,
which the brief's own convention #3 refuses ("the whole routine... never a sketch of one"). Every
line below, including the entire unchanged tail, is re-read from `engine/battleturn.asm` at HEAD
`eab9eb0` as it stands today:**

```asm
; A/X/Y contract, stated honestly for the whole call chain -- corrected in
; round 3, after review found the previous version wrong on both counts it
; tried to make. Entry: none required (bt_arg, bt_actor, bt_target are read
; from RAM, not passed in registers). What this design's own insertion
; preserves is narrower than what the routine as a whole does: combatant_mag
; (above) preserves X and Y across its own call and stages its answer in
; bt_ret, so the new `.if MAGIC_POWER_ENABLED` block at the top of
; spell_damage disturbs neither register -- but spell_damage's own very next
; line, `ldx bt_arg`, already overwrites X immediately afterward regardless,
; the identical assignment that ran there before this design existed, so X's
; value on entry to spell_damage was never something the rest of the routine
; preserved anyway. `roll_spell_amount`/`mod8` (`:683-729`) clobber Y on a
; *ranged* roll -- `mod8`'s own `ldy #8` counting down to 0 -- but not on a
; *flat* one (`spell_amount_n == 1` takes the no-roll branch, touching
; neither RNG nor Y at all); a party target's own `ldy mon_slot_actor,x` (at
; today's `:745`) never runs at all (skipped by `bcc spell_damage_done`), so
; Y on exit for a party target is 0 after a ranged roll, or whatever it held
; on entry after a flat one -- neither of which any caller reads. For a
; monster target, the unconditional `ldy mon_slot_actor,x` overwrites
; whatever the roll left in Y regardless, so Y on exit there is always the
; resolved monster's own actor id. X ends up wherever the pre-existing
; `tax`/reload sequence at `:744-746` (unchanged, below) leaves it -- the
; monster-slot index, then immediately reloaded from `bt_arg` for
; `spell_element,x` at `:747`, for a reason wholly unrelated to this
; design. A is whatever the last touched instruction leaves it; nothing
; downstream reads it back from either exit path.
spell_damage:
  .if MAGIC_POWER_ENABLED
  lda bt_actor
  jsr combatant_mag          ; bt_ret = mag(bt_actor); X/Y untouched
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
                               ; unrelated to this design's own insertion
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
with no change needed to it.

**X/Y contract at both call sites, stated rather than left implicit.** `combatant_mag` preserves X and
Y across its own call (saves to `bt_x`/`bt_y`, restores before returning), so whatever either call
site's X held *before* the `jsr combatant_mag` is exactly what it holds *after* — and both sites
immediately discard that prior value anyway (`spell_damage`'s very next line is `ldx bt_arg`;
`cast_heal`'s is the same), so the call's placement before `roll_spell_amount` costs nothing in
either routine's own X-register needs. `spell_damage`'s own pre-existing reload of X from `bt_arg`
at its unchanged `:746` (after the monster-slot `tax` at `:744` clobbers it) is untouched by this
insertion — it already reloads X for a completely unrelated reason, further down in the same
routine.

**Trap 8, branch range — confirmed by successful assembly, not merely argued.** A prototype of this
exact listing, gated on `MAGIC_POWER_ENABLED`, was built with `nesasm v3.1` against `sample-rpg` on
all three RPG-capable boards (§9's own measurement); nesasm reported zero "branch out of range"
errors on any of them. nesasm's own branch-range check is a hard assembler error, not a silent
truncation (unlike the backward-`.org` trap CLAUDE.md's own "6502 traps" list records elsewhere), so
a future engine change that moves this insertion point relative to a tight existing branch will fail
loudly at build time rather than corrupting anything — this design does not need to hand-audit every
nearby branch's own distance, only note that the assembler is the actual check, and that it already
passed against the real insertion points above.

**Trap 9, nesasm's 31-character label limit.** Every new label introduced above: `combatant_mag`
(13), `combatant_mag_mon` (17), `combatant_mag_ret` (17), `spell_damage_mag_ok` (19), `cast_heal_
mag_ok` (16). The longest is 19 characters, well under the 30-character cliff CLAUDE.md's own "The
Code Forge" section records (nesasm v3.1 aborts with a glibc buffer-overflow crash, exit 134, at 31+
characters).

**Trap 7, `hex()`'s own `& 0xff` masking an `undefined` field to `$00` silently.** `battle.mag` is
never `undefined` on the compiled path: `normalizeActor` (§6) always writes a clamped number, falling
back to `0` via `clamp(battle.mag, 0, 255, 0)` exactly the way `atk`/`def` already do — there is no
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
something specific to `baseMag`.

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

**Monster Forge** (`renderer/forges/monster/monster.js`): a fourth field in the existing Attack/
Defence/Speed row (`:119-123`), beside Attack per the brief's own placement call:

```js
row(
  field('Attack', number(battle.atk ?? 4, 0, 255, (value) => set('atk', value))),
  field('Defence', number(battle.def ?? 2, 0, 255, (value) => set('def', value))),
  field('Speed', number(battle.speed ?? 4, 0, 255, (value) => set('speed', value))),
  field('Magic', number(battle.mag ?? 0, 0, 255, (value) => set('mag', value)))
)
```

Labeled "Magic," not "Magic power" or "Magic points" — the existing Accuracy/Evasion row (`:124-128`)
already uses "Magic points" for `battle.mp` (the mana pool this stat is unrelated to), and reusing
that label on a second, different field in the same Forge would be a real, confusing collision (§0).

**Nothing on the battle screen.** §0 confirmed by direct grep that `pc_atk`/`pc_def` are read only
inside the routines that compute physical damage, never by any draw routine — `draw_panel` shows only
names. `combatant_mag`/`pc_mag_at`/`mon_mag` inherit the identical absence with no engine change
required to keep it that way; no new draw code is part of this design.

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
the full detail.

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

Concrete proposed values, open for Chris to adjust (§16): `baseMag: 8, magPerLevel: 2` on
`shared/starters/rpg.js:206`'s own spread — comparable in scale to `baseAtk: 6`/`atkPerLevel: 1`, high
enough that a fresh player casting Hero's starting spell sees a visibly larger number than the
un-augmented roll. Ally (`:207`) and both starter monsters keep `baseMag`/`mag` at the schema default
(0), since none of them casts anything the value could affect; a future author decision to give a
monster its own spell and matching `mag` is a starter-content change this design does not make.

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
rule that phase 5 itself never followed. See §16 for the open question this correction surfaces:
whether Chris wants any fixture to carry magic power live, the same choice phase 5 made for naming.

Tests exercising magic power live build `mkdtemp` variants of `sample-rpg` the way `bankedbytes.
test.js`'s own `measureRegion` (`:121-148`) and this design's own §9 measurement already do — never a
checked-in fixture.

## §12. Q10 — where recorded

**Recommendation: a new sub-item 6 under ROADMAP item 13** (`ROADMAP.md:1445-1493`, immediately after
the existing sub-item 5, "The element list," which ends at `:1492` before the `---` separator to item
14 at `:1494-1496`). The new sub-item cross-references `docs/design-character-forge.md` §5 (where
Chris's request was first recorded) and ROADMAP item 14 (`:1496-…`, the Monster Forge, since
`battle.mag` lives on the actor record that Forge owns) — added in the implementation phase's own
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
   the schema in §6 deliberately does not follow `baseAtk`'s own numbers.
4. **A conditional table emitting a one-byte stub when off.** `pc_mag_at`/`mon_mag` are wrapped in
   `if (projectUsesMagicPower(project))` in `battleTables` (§8), the identical guard `items`/
   `item_heal` already use for the identical reason (`battletables.js:198-205`'s own comment) — and
   the §9 measurement directly confirms the "off" table-byte figure matches the pre-prototype
   baseline exactly, not baseline-plus-two-stub-bytes.
5. **The flat-spell (`n == 1`) path consuming RNG after the change.** `combatant_mag` never calls
   `rng_next`; the add wraps entirely outside `roll_spell_amount`'s own body, so `roll_spell_amount_
   flat`'s zero-RNG guarantee (`rpg.test.js:1834`) is unaffected regardless of whether magic power is
   live.
6. **`combatant_*`'s "reload A last" flag rule.** `combatant_mag_ret` restores `bt_x`/`bt_y` before
   its own final `lda bt_ret`, the identical order `combatant_atk_ret`/`combatant_def_ret` already
   use — verified by direct comparison in §7's own listing.
7. **`hex()`'s `& 0xff` masking an `undefined` field to `$00` silently.** Does not apply here the way
   it did to `design-magic.md` §12's own migration: `battle.mag`/`baseMag`/`magPerLevel` are new
   fields with a build-time-computed default (`normalizeActor`/`normalizePartyMember` always write a
   clamped number), not a renamed field briefly read by code that no longer writes it. **The
   guaranteed direction, corrected in round 2, is old project → new app**, via a genuinely-missing
   `raw?.baseMag` resolving through `num()`'s own fallback to `0`
   (`shared/project.js:5044-5076`) — not the reverse: a *newer* project's real, present `baseMag`
   reopened by an *older* app that predates this field is simply never read or re-emitted by that
   app's own `normalizePartyMember`, so a save from there drops it, the ordinary consequence of an
   old build not knowing about a new field, not a `hex()`-masking hazard.
8. **Branch range: existing branches pushed past ±128 bytes.** Confirmed by successful nesasm
   assembly of the exact prototype on all three boards, with zero "branch out of range" errors — the
   assembler is the actual check here, and it already passed.
9. **nesasm's 31-character label limit.** Longest new label is `spell_damage_mag_ok` at 19
   characters — well clear of the 30-character cliff.
10. **A monster's `mag` read through `mon_slot_actor,x`.** `combatant_mag_mon` resolves the battle
    *slot* to its actor id before indexing `mon_mag` — reading `mon_mag,x` directly (slot as if it
    were an actor id) would read the wrong actor's stat whenever two formation slots share an actor,
    or index past the table once live slots outnumber distinct actors. Closed identically to
    `combatant_atk_mon`/`combatant_def_mon`'s own existing indirection.
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

## §15. Phasing

Learning `design-magic.md` §12's own lesson (`:1088-1145`, "the previous phase 3 was never actually
shippable" — a schema phase ahead of its engine phase silently zeroes every field `hex()`'s masking
cannot catch): **schema and engine land in one phase, not two.**

1. **Schema, engine, and the ledger, atomically.** `baseMag`/`magPerLevel`/`battle.mag` (§6),
   `projectUsesMagicPower` (§6), `MAGIC_POWER_ENABLED` (§8), `combatant_mag` and both call-site
   additions (§7), `pc_mag_at`/`mon_mag` emission (§8), `MAGIC_POWER_BATTLE_ALLOWANCE` wired into
   `battleRegionBytes` (§9), and **the full ledger/emulator/normalizer test set — §14 items 1-9 and
   items 12-15 too: the `magPerLevel` growth test, the saturation test, the normalizer test, and the
   capacity/advice test — all engine, schema or capacity checks with nothing UI-shaped about any of
   them** — all in one change.

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
2. **The Forge fields.** Character Forge's and Monster Forge's Magic fields (§10), their smoke
   coverage — **§14 items 10-11**, both including the round-2-added save/reload assertion. Only
   shippable *after* phase 1, because before it there is no compiled effect for an author to see —
   exposing the field earlier would be exactly the labeled-vs-real gap CLAUDE.md's own "Conventions"
   section refuses.
3. **Starters and the ROADMAP entry.** Hero's real `baseMag`/`magPerLevel` values on the RPG starter
   (§11), the new ROADMAP item 13 sub-item (§12). Depends on phase 2 existing (an author needs the
   Forge field to see what the starter shipped with) but is otherwise a pure content/docs change with
   no schema or engine dependency of its own — natural to fold into phase 2's own commit, or land as
   its own trivial one, the same flexibility `design-magic.md` §12 item 2's own `ELEMENTS` append is
   given.

## §16. Open questions for Chris

The primary path below follows every recommendation stated in this document; each answer's
consequence is the section it would reopen.

1. **Additive or multiplicative amount scaling (§2)?** Recommend additive — cheaper, no new scratch
   byte needed, no `bt_tmp2` conflict. Picking multiplicative reopens §2's own priced-but-unbuilt
   `mulscale` sketch into a real, measured routine (reusing `bt_x`/`bt_y`, free after `combatant_mag`
   returns, or committing two new equates — `mag_copy`/`prod_hi` — to `engine/constants.asm` instead),
   and re-derives §7's listing, §9's measurement, and §14's test 4/6
   assertions against it.
2. **Party only, or both sides (§3)?** Recommend both — matches every existing `combatant_*` lookup's
   own either-side shape, and no `battle.mag`-less asymmetry on the Monster Forge. Party-only removes
   `mon_mag`/the Monster Forge field/test 5 entirely, for a concretely priced, complete-routine saving
   of 7 code bytes (37 vs. 44, §3's own round-4 listing) plus `mon_mag`'s own table bytes (one per
   actor) — `spell_damage`/`cast_heal` unchanged either way, since the whole question is contained
   inside `combatant_mag` itself.
3. **Damage and heal, or damage only (§4)?** Recommend both. Heal-out removes `cast_heal`'s own
   14-byte call-site addition from §7's listing (`combatant_mag` itself stays, since `spell_damage`
   still needs it) — a projected 58-byte allowance, not half of 72 — and removes test 6.
4. **A magic defence this slice (§5)?** Recommend no. Saying yes reopens this document at §5's own
   sketch level — a second stat, a second table, a decision about interaction with the elemental
   multiply — effectively a v2 design round, not an addition to this one.
5. **Exact starter values for Hero's `baseMag`/`magPerLevel` (§11)?** Recommend `8`/`2`, proportionate
   to `baseAtk: 6`/`atkPerLevel: 1`. Any values Chris prefers land in the same one line
   (`shared/starters/rpg.js:206`) with no other consequence.
6. **Should any starter monster (Slime/Bat) also get a spell and matching `mag`, to show a monster
   caster in the shipped starter?** Recommend no, out of scope for this design — it is a starter-
   content authoring decision (which spell, what MP cost, what the encounter balance becomes), not a
   magic-power engine question, and neither monster casts anything today for magic power to have
   scaled in the first place (§11's own correction of the brief that opened this round).
7. **Added in round 2 — should any checked-in fixture carry magic power live, the way name entry's
   own phase 5 opted `sample`/`sample-rpg`/`sample-rpg-mmc1` into naming (§11's own corrected
   precedent)?** Recommend no — unlike naming, nothing about magic power needs a real boot/save/reload
   sequence against a checked-in fixture to prove it works; every test in §14 builds a `mkdtemp`
   variant instead, the same mechanism `bankedbytes.test.js`'s own `measureRegion` already uses for
   the ledger. Saying yes means hand-editing `sample-rpg`'s own `party.json`/`sprites.json` (never
   regenerating it), re-tuning every exact-damage assertion this document's own §0 lists
   (`rpg.test.js:516`, `:1794`, `:1834`, `:2125`, `:3235`) to account for the now-live stat, and
   re-pinning that fixture's own SHA-256 in `nameentry.test.js`'s `BASELINES` (`:91-98`) — real,
   avoidable cost for no test this design's own plan actually needs.

## §17. Out of scope, explicitly

- A magic *defence* stat (§5) — recorded as a future extension this design does not foreclose, not
  designed here.
- Spell animations of any kind — ROADMAP item 13 sub-item 2's own open thread, unrelated to this
  stat and untouched by it.
- Equipment or any other source of a stat bonus beyond the two authored fields in §6 — this design
  adds exactly `baseMag`/`magPerLevel` on a party member and `battle.mag` on an actor, nothing else.
- Any change to `physical_damage`, `combatant_atk`, or `combatant_def` — the physical damage path is
  completely untouched by this design; only the spell-damage and heal paths gain the new add.
- Any change to poison or burn (§4, confirmed neither reads `roll_spell_amount` and neither is
  touched).
- A "turn magic power off" lever in `battleShortfallAdvice` (§9) — deliberately not added.
- Re-pinning any of the six checked-in fixtures' SHA-256 baselines (§11) — none of the six opts in,
  so `nameentry.test.js`'s existing gate needs no change from this design.
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
