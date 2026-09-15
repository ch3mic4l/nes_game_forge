# Design: battle-side animation (ROADMAP item 14 point 3 + item 13 point 2), v5

What an animation is on the battle screen, and the one engine mechanism that plays a monster's own
attack/cast visual and a spell's own cast visual through it. v5 adds phase 2 in full: hit/miss
feedback (§2(e)'s own candidate, turned into a shippable design in §12) and a new MISS indicator
(§13), both real, measured prototypes (Appendix D).

## §0. What was read

HEAD `38627b7` (clean, `master`), unchanged since round 1 — no engine, generator, renderer, schema
or test file in the real tree has ever been touched by this slice; every change lives in this
document or in the scratch prototype. Every citation below is `file:line` at that commit, re-checked
against the real tree, never against the scratch prototype's own shifted line numbers.

Round 3 read `handoff-next/battle-anim-design-2-review1.md` in full (1 P1, 6 P2, 1 P3, verdict FIX,
plus a per-finding round-1 disposition table) and the round-3 brief's own eight decisions. Per the
brief's own instruction, two things were re-verified independently before being treated as true
rather than merely relayed: the P1 itself — `normalizeAnimation` only byte-clamps a frame's own
`metaspriteId` (`shared/project.js:4954-4963`) with no check against `project.sprites.metasprites.
length`, and `spriteTables` emits exactly `max(1, metasprites.length)` `ms_count`/`ms_ptr_lo`/
`ms_ptr_hi` rows (`main/build/generate.js:3555-3582`), confirmed by direct read, not assumed — and
finding 4's own residues (the v2 document's inline excerpts putting `.if`/instructions at column
zero, and a "Preserves X" header contradicted by the very next `tax`), confirmed by re-reading the
v2 document itself.

Round 4 (this round, small) read `handoff-next/battle-anim-design-3-review1.md` in full (1 P2, 4
P3, verdict FIX — no phase-1 blocker; every phase-1 mechanism item closed) and the round-4 brief's
own six decisions. The one substantive fix is Appendix C's own attribute-flash prototype, confirmed
broken by direct re-read before being fixed (round 3's own version never decremented its own
countdown byte at all); every other change this round is a mechanical, precision, or scope-labelling
correction, none touching the phase-1 mechanism's own assembled bytes.

### Findings fixed, round 2 → round 3 (all eight, verified independently)

1. **P1 — the frame-to-metasprite "second hop" was never closed.** A battle reference could name a
   real, in-range animation whose own frame named a metasprite that does not exist —
   `draw_metasprite` (`engine/entities.asm:621-658`) checks nothing before dereferencing
   `ms_count`/`ms_ptr_lo`/`ms_ptr_hi` at whatever a frame says. Closed by a second, exported
   predicate (`isPlayableBattleAnimation`) checked wherever the top-level id already was: the
   generator's own defense (disables the whole reference, never fabricates a metasprite id),
   `validateProject`'s own refusal, and the OAM budget. §3.1, §5, §6 (the reviewer's own worked
   example is now a real, run test).
2. **P2 — one generated constant, not a duplicated engine-side equate plus a runtime add.** Dropped
   the round-2 `MAX_OAM_ENTRIES` engine equate entirely (`shared/project.js:185` already owns the
   JS-side constant); `BATTLE_FX_OAM_ROOM = max(0, MAX_OAM_ENTRIES − battleCombatantOamMax(...))` is
   now the one figure `battle_fx_draw` compares against, with no addition at all in the hot path.
   Re-measured on all three boards. §2, §3.3, §3.5, §3.6.
3. **P2 — the fit check's own conservative-skip policy was understated.** A frame larger than
   `BATTLE_FX_OAM_ROOM` is skipped on **every** tick it is current, the timer still advancing
   normally — so an animation whose every frame is oversized is never visible at all, even in a real
   battle with genuine room, because the bound is a project-wide static maximum, not the current
   formation's own live count. Stated explicitly, and paired with a second, distinct
   `validateProject` warning naming the animation — `describeBattleSpriteWarning`'s own existing
   text and trigger stay byte-identical for a project with no battle animation. §3.3, §3.6, §5, §6.
4. **P2 — mechanical: excerpts, contracts, and one over-strong claim.** Every inline listing is
   re-indented to match Appendix A's own real indentation; the "Preserves X" headers are corrected
   (`battle_fx_arm_at` clobbers X; `battle_fx_arm_attack` also clobbers Y, not just X — a residue the
   contract table missed); §1's own "arming always overwrites whatever was running" sentence is
   deleted (an `NO_ANIM` arm call is a genuine no-op that leaves whatever was already there,
   correctly, per the caller invariant now stated explicitly instead); the "reload after the
   `.endif`" sentence is corrected to "inside/before it." §1, §3.3.
5. **P2 — one exported predicate, and the sentinel ceiling stated precisely.** `isValidAnimationRef`
   is now the single exported rule (integer, in range, **and** `< NO_ANIM` independently of catalog
   length), consumed by validation, the generator, and the budget alike; `validateProject` also
   refuses an over-cap animation catalog, the `LIMITS.actors`/`LIMITS.items`/`LIMITS.metasprites`
   sibling. `renumberAnimationDeletion` now shifts only a reference that is *already valid* against
   the pre-splice catalog — an invalid one (255, or anything past an over-cap catalog) is left
   untouched rather than silently decremented into a real, wrong id — and must be called *before*
   the splice, a real new contract this version's own validity check introduces. §3.1, §6.
6. **P2 — stale prose and unreviewable prototype claims.** The MMC3 split correction no longer
   states-then-retracts in a parenthetical; the block-swap candidate's own background-row
   qualification is kept without contradiction. The attribute flash's 72-byte figure is now labelled
   "measured, packet-every-tick prototype," and the unsupported claim that an edge-only version
   would cost the identical bytes is removed — that shape was never itself measured. Appendix A's
   own stale `attack_target` comment and the spell-normalizer's stale caster-only comment are both
   fixed. **Appendix B and Appendix C are new**: the real, complete diffs for both candidate-(e)
   prototypes, rebuilt on top of the round-3 checkpoint and measured again (unchanged at 50 and 72
   bytes), so the 50/72 figures are reviewable rather than asserted. §0, §2(b)/(e), Appendix
   A/B/C.
7. **P2 — the test plan's duration-255 case could never actually observe 255 ticks.** An ordinary
   battle message caps at `MSG_HOLD = 45` (`engine/constants.asm:927`), long before a 255-tick
   animation would end on its own — so that test needs an isolated routine call or a controlled
   hold, not a normal battle. Duration 2, a multi-frame sequence, and post-arm dispatch-integrity
   assertions (the intended `spell_kind`/amount still read correctly, the chosen target slot
   survives) added, timed against the reviewer's own worked timeline. §6.
8. **P3 — two lifecycle-prose errors and the traversal's own claimed scope.** Only `battle_fx_tick`
   runs before `battle_dispatch`; `battle_fx_draw` runs *after* it, which is safe (an intro handing a
   monster an immediate first turn has already moved `bt_phase` off `BP_INTRO` by the time draw's own
   guard checks it). `battle_first_turn` → `check_over` can reach victory with **no** action message
   at all (an empty formation) — safe only because `setup_monsters` already cleared the effect, not
   because "every outcome follows a message." The shared traversal is stated as the location
   authority for deletion/validation/battle-id collection, not as something every existing semantic
   reader (`animFor`, `reachablePoses`, palette-swap cloning) now calls — none of them do, and
   shouldn't. Palette-swap's own clone leaves the new actor's `attackAnim` **shared** with the
   source's animation, never remapped — stated as an accepted limitation, not silently true by
   omission. `battle.drop` is removed from the error-severity precedent list — its own stale-reference
   diagnostic is a warning, not the same severity. §3.1, §5, §8, §9.

**Round 1's own three corrections and round 2's own twelve fixes both stand**, restated where this
round's own fixes touch the same prose (§0's disposition table below), not repeated in full a third
time.

### Round-1/round-2 finding disposition, carried forward from the review

For traceability: round 1's F1/F2/F4/F7/F8/F10 were only partially closed after round 2 (this
round's own findings 1/2/4/6/7 above are exactly what closes each the rest of the way); F3/F5/F6/F9/
F11/F12 were fully closed by round 2 and stay closed (F12's own wording is refined once more here —
"saves the kind/scope selection sequence," not "one fewer branch," since the real saving is a
sequence of instructions, not literally a single 6502 branch).

## §1. Recommendation at a glance

**One primitive serves both items: an authored *action visual* — a short sprite flipbook, drawn by
the existing `draw_metasprite` (`engine/entities.asm:621`), played over a combatant's own slot from
`battle_draw_sprites` (`engine/battleui.asm:829`), armed the moment the action is decided.** A
monster's own `battle.attackAnim` plays over its own slot when it swings or, absent a spell's own
visual, when it casts. A spell's own `spell.anim`, when authored, plays over the target's own slot
for a single-target damage or status spell (an impact) and over the caster's own slot for a heal or
an all-target spell (a casting flourish). No `spell.anim` falls back to the caster's own
`attackAnim`. Both fields reference the *existing* `project.sprites.animations` catalog.

**Arming is a single scalar write (`bt_fx_anim`/`bt_fx_slot`/`bt_fx_frame`/`bt_fx_timer`), not a
guaranteed overwrite of "whatever was running."** Every real call site arms *after* either
`setup_monsters` (a fresh battle) or `battle_message_done`'s own unconditional clear (every prior
action's own message dismissal) — so in practice nothing is ever "running" at the moment a new arm
call executes, and an `NO_ANIM` input (no visual authored for this specific action) is a genuine
no-op that correctly leaves the ZP bytes exactly as that same invariant already left them. This
caller invariant, not a blanket "always overwrites" claim, is what §3.3 documents precisely.

**A reference is safe to compile and to play only when it clears *two* hops, not one**: the
animation id itself must be real and in range (`isValidAnimationRef`), **and** every one of that
animation's own frames must name a real metasprite (`isPlayableBattleAnimation`) — `draw_metasprite`
checks neither on its own. Both hops are enforced by one exported predicate pair in
`shared/project.js`, consumed identically by `validateProject`, the generator's own defense in
depth, and the OAM budget.

**Real, measured cost of the corrected mechanism: 243 bytes of banked battle-region code, flat
across all three RPG-capable boards**, plus 1 byte per actor and 1 byte per spell in two new banked
tables — down from round 2's 246, the difference being a genuine simplification (one compiled
`BATTLE_FX_OAM_ROOM` constant compared directly, replacing a duplicated engine equate plus a runtime
`adc`), not a scope change.

**Phase 2's two hit/miss-feedback halves stay measured, not estimated, and are now reviewable**: a
sprite hit-blink costs 50 bytes; a block-art attribute flash — a real, working timed flash (round 4
fixed a missing countdown in the prototype that measured it, §2(e)), measured as a packet-every-tick
prototype, not claimed to be identical in size to an edge-only version that was never itself built —
costs 76 bytes, both flat across all three boards. Their real, complete diffs are Appendix B and
Appendix C.

## §2. Q1 — the candidates, costed

### (a) Sprite flipbook over a combatant slot — recommended

Mechanism and bank are unchanged from round 1/2: `battle_draw_sprites` already rebuilds the whole
OAM shadow from scratch every tick, reusing the kernel-lo `ms_data_N`/`anim_data_N`/`draw_metasprite`
machinery the Sprite Forge already authors. Entirely banked-region code; no kernel-lo change.

**Measured, round-3-corrected prototype.** Rebuilt with every round-2 review fix from before, plus:
the frame-to-metasprite second hop closed at validation/generation/budget time; the `MAX_OAM_ENTRIES`
engine equate removed in favour of one generated `BATTLE_FX_OAM_ROOM`; `battle_fx_draw`'s own fit
check now a direct `cmp #BATTLE_FX_OAM_ROOM+1` with no `adc` at all. Measured the identical way on
`sample-rpg` (4 actors, 3 spells):

| board (RPG-capable) | region used, off | region used, on | delta |
|---|---|---|---|
| MMC1 (mapper 1) | 4294 | 4544 | 250 |
| MMC3 (mapper 4) | 4334 | 4584 | 250 |
| UNROM 512 (mapper 30) | 4294 | 4544 | 250 |

Table delta unchanged at 7 (4 actors + 3 spells). **Code-only delta: 250 − 7 = 243 bytes, flat, on
all three boards** — 3 bytes fewer than round 2's 246, the `clc`/`adc #BATTLE_COMBATANT_OAM_MAX`
pair (3 bytes) no longer needed now that the comparison is against a single, pre-subtracted
constant. Full corrected listing in Appendix A.

**The reviewer's own worked example, run for real**: `spell.anim = 0`, animation 0 containing a
single frame naming `metaspriteId: 1`, and a catalog holding only metasprite 0. `validateProject`
refuses the build (`error`, Sprite Forge: "1 battle animation ... names an animation with a frame
that does not name a real metasprite"), and — independently, as defense in depth — calling
`battleTables(project)` directly (bypassing validation entirely, the same way a stale hand-edited
project would reach the generator) emits `spell_anim: .db $FF,$FF,$FF` for that project's three
spells: `NO_ANIM`, never metasprite 1's own bogus bytes. Both confirmed by direct execution against
the corrected prototype, not reasoned from the code alone.

### (b) A palette effect

Unchanged reasoning for the whole-screen form (estimated, not measured, rejected on the ground that
it cannot distinguish which combatant was hit). The per-monster attribute-cell form's own corrected
description (round 2, finding 8) stands: `draw_battle_attr`'s `mon_attr` write selects among the
*existing* four background palettes, it does not rewrite palette RAM itself — a genuine BG
palette-RAM rewrite would recolour every other user of that palette too. This mechanism is measured
as part of candidate (e)'s own attribute-flash half below (76 bytes, §2(e)) — as a
**packet-every-tick prototype**, not as evidence for any other emission shape.

### (c) Block-art frame swap

Unchanged: real schema growth, several frames of `vram_buf` writes to swap a whole block. Estimated,
not measured, rejected on the vram_buf-cost and multi-frame-visible-redraw grounds alone.

### (d) Cycling the existing idle animation for metasprite-fallback monsters

Unchanged: a genuinely different feature (ambient idle motion), estimated, not measured, rejected on
scope grounds — neither item 13 nor 14 asked for it.

### (e) Cheaper minimum-viable reactions — measured, reviewable, recommended as phase 2

Both halves were rebuilt as real, standalone prototypes on top of the round-3 corrected checkpoint,
measured, and reverted — neither is part of Appendix A. **Their own complete diffs are now Appendix
B and Appendix C**, so the two figures below are reviewable rather than merely asserted (round 2's
own gap, per finding 6).

- **Sprite hit blink** (`ent_hurt`'s own trick, `engine/entities.asm:590-593`, extended to
  combatants): two new ZP bytes, one tick routine, a skip-on-alternate-frames check added to
  `battle_sprite_pc`/`battle_sprite_mon`, armed from `apply_damage` (every landed hit). **Measured:
  50 bytes, flat on all three boards** (Appendix B) — unchanged from round 2's own figure, since
  nothing in round 3's phase-1 fixes touches this candidate's own mechanism.
- **Block-art attribute flash**: the corrected attribute-cell mechanism from (b), toggled while the
  same `bt_hurt_left` counts down, queued through `vram_buf` the way `wipe_monster` already queues
  its own writes. **Round 4, finding 1: round 3's own 72-byte prototype never actually counted
  anything down** (`bt_hurt_left` was loaded and stored but never `dec`remented, so `20 & 2 = 0`
  selected the authored tint on every tick and the flash branch was dead code — it re-queued the
  original attribute forever, which is a real bug in the prototype, not merely an unmeasured
  detail). **Corrected and re-measured: 76 bytes, flat on all three boards, as a packet-every-tick
  prototype** (Appendix C) — 4 bytes more than the broken version, for a real `dec` plus the
  terminal-tick restoration check. Pinned with a real trace (§2(e)'s own closing note below), not
  merely re-derived from the instruction count. This figure remains a **packet-every-tick**
  measurement: an edge-only (two-packets-per-hit) shipped version was not built, and this document
  makes no claim about whether it would cost more, fewer, or the same code bytes — only that its own
  `vram_buf` traffic would differ, a separate, runtime fact.

**Trace confirming the corrected Appendix C prototype actually flashes and restores** (round 4,
finding 1's own requirement; call-numbering corrected round 4's own nits pass): built the corrected
prototype, forced a real battle, armed the blink directly over a block-art monster's own combatant
slot at `bt_hurt_left = 20` (bypassing hit RNG, which is irrelevant to what this trace checks), and
read the real PPU attribute byte after each of 25 calls to `battle_attr_blink_tick`. Numbering calls
from 0 (call 0 is the first tick after arming): call 0 decrements to 19 and emits the flash tint;
call 1 decrements to 18 and also emits the flash tint (`and #2` gives two-tick bands, the same
cadence noted as a limitation below); call 2 decrements to 17 and emits the authored tint; the
pattern continues until call 19 decrements to 0 and forces the restoration write regardless of
parity; calls 20 through 24 (five further calls) find `bt_hurt_left` already 0 and return before
queuing anything. Reading the byte back after each call therefore shows the authored/restored tint
continuously across calls 19 through 24 — six samples, counting the terminal write itself.

**What the trace itself proves, and what it does not.** The PPU reads demonstrate two of the three
things this fix needed to show: the byte actually changes to the flash tint (calls 0, 1, 4, 5, ... —
real motion, not the dead branch round 3 shipped), and the terminal write actually restores the
authored tint (call 19). **The PPU trace alone cannot distinguish "no packet was queued" from "the
same value was queued again"** — both read back identically once drained. Cessation of packets past
call 19 is established by source inspection instead: `battle_attr_blink_tick`'s own idle check
(`lda <bt_hurt_left / beq battle_attr_blink_rts`, Appendix C) returns before `vram_open` is ever
reached once the counter is 0, so calls 20-24 provably queue nothing at all, not merely "queue the
same byte again" — a fact about the code, not something the stable sample by itself demonstrates.

**Phase-2 prototype limitations, recorded rather than fixed (round 4, finding 5) — both B and C are
measurement prototypes, not shippable as-is, and their own gaps are phase-2 design inputs, not
phase-1 work:**

- **B's `and #2` blink cadence is two-tick bands, not per-tick alternation** — the byte flips every
  *other* tick, not every tick, a specific visual cadence a real implementation might want to tune,
  not the only possible one.
- **Both B and C arm from every `apply_damage` call and keep only the single most recent target** —
  an all-target spell hitting four combatants in one tick leaves only the *last* one armed; the
  other three never blink. A real implementation needs its own policy for a multi-target hit (queue
  several, or accept that only one flashes), not decided by either prototype.
- **Neither prototype resets `bt_hurt_left` at battle entry** — `setup_monsters` (§3.3's own phase-1
  reset for `bt_fx_anim`) is not extended to either candidate's own state, so a value left over from
  a previous battle could, in principle, still be counting down into a fresh one. Phase 1 does not
  need this fixed since neither candidate ships in phase 1; a real phase-2 implementation would add
  the identical reset `setup_monsters` already gives `bt_fx_anim`.
- **C has no `mon_tile != $FF` guard** — it writes the attribute cell for whichever combatant slot
  `bt_hurt_slot` names regardless of whether that monster has block art at all; for a
  metasprite-fallback monster (`mon_tile == $FF`, drawn as a sprite, not background art) this tints
  an attribute cell that is not visually anchored to anything the player associates with that
  monster (`draw_battle_attr`'s own per-monster write, `engine/battle.asm:584-611`, only makes sense
  for a monster that actually has a background block there).
- **C's one attribute byte covers the anchored 4×4-tile cell, not a larger authored block** — battle
  art can be up to 12 tiles wide or tall (`shared/project.js:1133`, `RPG_LIMITS.battleArtTiles`), and
  `draw_battle_attr` already only tints the anchored 4×4 region regardless (CLAUDE.md's own "Battle
  art" passage), so a block drawn larger than 4×4 would only ever have its own anchor corner flash,
  the identical partial-coverage fact the stock engine already has, not something this candidate
  makes worse.

Together, both real, cheap, and now both reviewable. Shipping both together shares the arm/tick
infrastructure (one `bt_hurt_slot`/`bt_hurt_left` pair) — no longer an unmeasured estimate: §12.7
measures the real, unified, round-1-corrected mechanism at 235 bytes flat. That is MORE than the
naive 50 + 76 = 126 sum of the two standalone prototypes' own figures, not less — sharing the arm
point saves nothing on its own; the real cost is dominated by the correctness fixes neither
standalone prototype needed to make (§12.3): the stranded-tint restore, the dead-monster
ground-default restore, and the register-preservation rework that replaced `bt_tmp2` parking. The
old "a real but unmeasured saving" claim here was wrong in direction, not just unverified.

## §3. The recommended shape in full

### §3.1 Schema, migration, and the reference-integrity fix

**On the spell** (design-magic.md §13's own placement, settled here):

```js
// shared/project.js, normalizeSpell — appended, no other field's shape changed
//
// An animation id played when this spell is cast -- over the target or the
// caster, decided by cast_spell (engine/battleturn.asm) from the spell's
// own kind/scope, not by this field. null = no visual.
anim: Number.isInteger(raw?.anim) && raw.anim >= 0 && raw.anim <= 255 ? raw.anim : null
```

**On the actor's battle record** (design-monster.md §2's boundary):

```js
// shared/project.js, normalizeActor's battle object — appended after battlePalette
attackAnim:
  Number.isInteger(battle.attackAnim) && battle.attackAnim >= 0 && battle.attackAnim <= 255
    ? battle.attackAnim
    : null,
```

Both follow `battle.spellIds`' own precedent: clamp to a byte range at normalize time, with no
validation against `project.sprites.animations.length` — `normalizeActor`/`normalizeSpell` have no
access to that array. `null` is "no visual." **The normalizers PRESERVE an imported `255`, they do
not reject it**: `Number.isInteger(raw?.anim) && raw.anim >= 0 && raw.anim <= 255 ? raw.anim : null`
passes `255` straight through unchanged, the identical byte-range clamp `battle.spellIds` already
uses — so a project loaded with a pre-existing `255` reference (foreign data, or hand-edited) keeps
it exactly as `255` after normalization. The Magic/Monster Forge pickers (§4) are what never
*author* a `255` in ordinary use — they only ever offer a real animation from the catalog or
"None" (`null`) — so the two facts are different claims: normalization preserves what it is given;
authoring cannot produce the invalid value in the first place.

**The validity rule is now two hops, each its own exported predicate, neither re-derived by any of
its three consumers (round 3, findings 1 + 5):**

```js
// shared/project.js — the ONE top-level rule
export function isValidAnimationRef(id, project) {
  return Number.isInteger(id) && id >= 0 && id < project.sprites.animations.length && id < NO_ANIM;
}
```

The `id < NO_ANIM` clause matters independently of catalog length: `LIMITS.animations = NO_ANIM =
255` is a *ceiling*, so a catalog can genuinely hold up to 255 real entries (ids 0-254) — a
hand-edited or foreign project could carry more, or a reference could simply be `255` on a much
smaller catalog. `id < animations.length` alone would treat a `255` reference as "the last real
entry" whenever a catalog happened to have exactly 256+ rows; the second clause refuses `255` as a
reference unconditionally, matching what `spriteTables`/`anim_count` actually have a row for.

```js
// shared/project.js — the "second hop" round 1 named and round 2 left open
export function isPlayableBattleAnimation(id, project) {
  if (!isValidAnimationRef(id, project)) return false;
  const frames = project.sprites.animations[id].frames ?? [];
  return frames.every(
    (frame) =>
      Number.isInteger(frame.metaspriteId) &&
      frame.metaspriteId >= 0 &&
      frame.metaspriteId < project.sprites.metasprites.length
  );
}
```

A real, in-range animation is not yet safe to play: `draw_metasprite` (`engine/entities.asm:621-658`)
dereferences `ms_count`/`ms_ptr_lo`/`ms_ptr_hi` at whatever `metaspriteId` a frame names, with no
bounds check of its own, and `normalizeAnimation` only clamps a frame's `metaspriteId` to a byte
(`shared/project.js:4954-4963`), never to the metasprite catalog. An animation with zero frames is
vacuously "playable" by this predicate (`.every()` on an empty array is `true`) — that is correct:
`battle_fx_arm_at`'s own `anim_count = 0` check is what actually turns "playable but empty" into
"arms nothing," and this predicate does not duplicate that separate decision.

**Deliberately scoped to a battle reference's own animation, not to every overworld `anims` slot's
own animation, and this is a scope decision stated once rather than left to be discovered**: the
overworld's own `actor_anim_dir` (`main/build/generate.js:3602-3608`) and `entity_animate`/
`draw_one_entity` (`engine/entities.asm:492-616`) already carry the *identical* frame-to-metasprite
exposure today, entirely independent of this slice and not made one byte worse by it — a stale
overworld pose was already able to reference a missing metasprite before this design existed, and
still can after it ships. Closing that pre-existing hop is real, valuable work, but it is a different
slice's own scope (the same "Delete animation" pre-existing-defect argument round 2's own §3.1 makes
for the renumbering side, applied here to the validation side instead): widening
`isPlayableBattleAnimation` to also police every `anims` slot would be free to write but would
silently make this design responsible for fixing something item 13/14 never asked it to fix, on a
schedule this document does not control.

**One shared traversal is the location authority for deletion, validation, and battle-id
collection** — not a claim that every existing semantic reader of an animation id now goes through
it (round 3, finding 8's own correction: `animFor`, `reachablePoses`, and palette-swap's own cloning
all still read/write actor `anims` directly, answering their own directional-pose or
worst-case-tile-count questions, and should keep doing so):

```js
// shared/project.js
export function* animationReferenceLocations(project) {
  const actors = project.sprites?.actors ?? [];
  for (let actorIndex = 0; actorIndex < actors.length; actorIndex++) {
    const actor = actors[actorIndex];
    for (const { id: slot, label } of ANIM_SLOTS) {
      yield {
        get: () => actor.anims[slot],
        set: (id) => { actor.anims[slot] = id; },
        battleOnly: false,
        describe: () => `Actor ${actorIndex} ("${actor.name}")'s ${label}`
      };
    }
    if (actor.battle) {
      yield {
        get: () => actor.battle.attackAnim,
        set: (id) => { actor.battle.attackAnim = id; },
        battleOnly: true,
        describe: () => `Actor ${actorIndex} ("${actor.name}")'s attack animation`
      };
    }
  }
  const spells = project.spells ?? [];
  for (let spellIndex = 0; spellIndex < spells.length; spellIndex++) {
    const spell = spells[spellIndex];
    yield {
      get: () => spell.anim,
      set: (id) => { spell.anim = id; },
      battleOnly: true,
      describe: () => `Spell ${spellIndex} ("${spell.name}")'s cast animation`
    };
  }
}
```

**`renumberAnimationDeletion` must be called BEFORE `project.sprites.animations[index]` is spliced
out** — a real, new contract this round's own validity rule introduces (`renumberMetaspriteDeletion`
above never queries the metasprite array's own length, so either call order works for it;
`isValidAnimationRef` does query `animations.length`, so calling this after the splice would
validate every reference against the wrong, already-shrunk catalog). Only a reference that is
*already valid* against the pre-splice catalog is ever touched; an invalid one (`255`, or an id past
an already over-cap catalog) is left exactly as it is — visibly invalid, never silently decremented
into a real, wrong id:

```js
export function renumberAnimationDeletion(project, index) {
  for (const location of animationReferenceLocations(project)) {
    const id = location.get();
    if (id === null || id === undefined) continue;
    if (!isValidAnimationRef(id, project)) continue;
    if (id === index) location.set(null);
    else if (id > index) location.set(id - 1);
  }
  return project;
}
```

Called from the Sprite Forge's "Delete animation" handler (`sprite.js:539-543`), before the splice,
in the same `store.commit`.

**`validateProject`'s refusals**, the `missingGiveTake` shape (`shared/project.js:6818-6838`) applied
twice — once per hop — plus the animation catalog's own ceiling. **All three are independent
`add()` calls with no early return between them, so all diagnostics that apply are collected, not
just the first that matches** — a 256-entry catalog whose reference 255 is also present reports
*both* the cap error and the bad-reference error, in that order (confirmed directly, round 4). The
cap check runs first, deliberately: it is a fact about the project as a whole, independent of any
one reference, and reads better named before either reference-specific list:

```js
// The animation catalog's own ceiling — the LIMITS.actors/items/metasprites sibling — checked
// FIRST, since it is a fact about the project as a whole, not about any one reference.
if (project.sprites.animations.length > LIMITS.animations) {
  add('error', 'Sprite Forge',
    `This project has ${project.sprites.animations.length} animations but the Forge holds ` +
      `${LIMITS.animations} (ids 0-${LIMITS.animations - 1}) — id $FF is reserved to mean “no ` +
      `animation”. Delete ${project.sprites.animations.length - LIMITS.animations} of them before ` +
      'this can build.');
}

// Hop 1: is the reference itself valid?
const badAnimationRefs = [];
for (const location of animationReferenceLocations(project)) {
  const id = location.get();
  if (id === null || id === undefined) continue;
  if (!isValidAnimationRef(id, project)) badAnimationRefs.push(location.describe());
}
if (badAnimationRefs.length) {
  add('error', 'Sprite Forge',
    `${badAnimationRefs.length} animation reference(s) (${badAnimationRefs.join(', ')}) do not ` +
      'name a real animation. Pick one or clear it.');
}

// Hop 2: for a battle-only reference, are the animation's own frames valid?
const unplayableBattleAnims = [];
for (const location of animationReferenceLocations(project)) {
  if (!location.battleOnly) continue;
  const id = location.get();
  if (id === null || id === undefined) continue;
  if (isValidAnimationRef(id, project) && !isPlayableBattleAnimation(id, project)) {
    unplayableBattleAnims.push(location.describe());
  }
}
if (unplayableBattleAnims.length) {
  add('error', 'Sprite Forge',
    `${unplayableBattleAnims.length} battle animation(s) (${unplayableBattleAnims.join(', ')}) ` +
      'name an animation with a frame that does not name a real metasprite. Fix the animation in ' +
      'the Sprite Forge or pick a different one.');
}
```

Both reference-integrity refusals are `error` severity — the same severity `missingGiveTake` already
uses for a genuinely stale, repairable compiled reference, correctly *not* the same precedent as
`battle.drop`'s own stale-reference diagnostic, which is a `warning` (round 3, finding 8's own
correction — `battle.drop` is removed from the error-precedent list it was wrongly grouped with in
an earlier draft).

**The generator's own defense in depth**, now a one-line call to the same exported predicate rather
than a locally repeated rule:

```js
// main/build/battletables.js
function validAnimId(id, project) {
  return isPlayableBattleAnimation(id, project) ? id : NO_ANIM;
}
```

used by both `mon_anim_attack` and `spell_anim`'s own emitters (§3.5). A reference whose animation
exists but whose frames do not compiles to `NO_ANIM` here exactly as an out-of-range top-level id
already did — never a fake metasprite id `draw_metasprite` would dereference unchecked.

**Phase 1a is exactly this section, and it is ROM-neutral on its own**: the traversal, both
predicates, the renumberer, the actor-`anims` fix, and `validateProject`'s new refusals touch no
engine file and no generator emission for a project that authors neither new field.

**Accepted limitation, stated rather than left silent (round 3, finding 8): a palette-swapped
actor's own clone shares its `attackAnim` with the source, unremapped.**
`duplicateActorPaletteSwapCore` (`shared/project.js:3954-3958`) clones the whole actor via
`structuredClone`, then remaps only `newActor.anims[slot]` through its own `animationIdMap` (built
for the actor's *overworld* poses) — `battle.attackAnim` is never touched, so the clone's own attack
visual keeps pointing at the exact same animation entry the source does, not a palette-swapped copy
of it. This is coherent (a palette swap changes what an actor *looks like standing still and
walking*, and a shared attack visual is not obviously wrong for two palette-variant monsters to
share), but it is a real, deliberate scope boundary this design draws rather than a case the palette
swap machinery already handled — recorded as an open question for Chris in §8.

### §3.2 RAM

Unchanged from round 1/2: four new zero-page bytes, chained unconditionally after `mus_inst_base`
(`engine/constants.asm:454`):

```asm
bt_fx_anim  = mus_inst_base+1   ; the running action visual's animation id, or NO_ANIM (idle)
bt_fx_slot  = bt_fx_anim+1      ; which combatant (0-7) it plays over
bt_fx_frame = bt_fx_slot+1      ; entity_animate-shaped progress
bt_fx_timer = bt_fx_frame+1
```

A fixed, always-paid 4-byte cost, on every board, regardless of whether any project uses the
feature. `test/unit/rammap.test.js`'s own `auditRamMap` confirmed to pass unmodified against the
round-3 corrected prototype. **No engine-side `MAX_OAM_ENTRIES` equate exists** (round 3, finding
2) — the hardware's own 64-entry OAM size is a JS-side fact (`shared/project.js:185`) folded into the
single generated `BATTLE_FX_OAM_ROOM` constant (§3.6) at build time; the engine never needs to name
64 itself. Phase 2's own `bt_hurt_slot`/`bt_hurt_left` (Appendix B/C) are not part of this figure.

### §3.3 The engine, complete

**The register/scratch contract, per routine, complete and corrected (round 3, finding 4):**

| Routine | Clobbers | Preserves | Notes |
|---|---|---|---|
| `battle_fx_arm_at` | A, X | Y | Takes A=animation id, Y=target slot. Condition flags are not preserved by any routine in this table — none of their callers depend on flags surviving a call. `NO_ANIM` is a genuine no-op: it returns having stored nothing at all, relying on the caller invariant below, not on an unconditional clear the routine itself does not perform. An empty animation (`anim_count = 0`) *does* explicitly clear `bt_fx_anim` to `NO_ANIM` — a different, deliberate path from the `NO_ANIM`-in no-op, both converging on the same result. |
| `battle_fx_arm_attack` | A, X, Y | — | `ldy <bt_actor` clobbers Y (round 2's own contract table omitted this); tail-calls `battle_fx_arm_at`. Callers must not rely on X or Y afterward. |
| `battle_fx_tick` | A, X, Y | — | Owns `ptr_lo`/`ptr_hi` for the duration of the call (loaded fresh every tick, not live across calls). Called once per tick from `battle_tick`; no caller needs any register back afterward. |
| `battle_fx_draw` | A, X, Y | — | Owns `ptr_lo`/`ptr_hi` and `de_ex`/`de_ey` (the `draw_metasprite` input pair); inherits `msptr_lo`/`msptr_hi`/`de_left`/`oam_idx` as read/write from its own tail call into `draw_metasprite` (`engine/entities.asm:621-658`), which itself preserves X but clobbers A and Y. Called once per tick from `battle_draw_sprites`; no caller needs any register back afterward. |

**The caller invariant, documented once rather than assumed from a blanket claim (round 3, finding
4 — §1's own "arming always overwrites whatever was running" sentence is deleted, replaced by this
precise statement)**: every real arm call site is reached either right after `setup_monsters` has
just cleared `bt_fx_anim` for a fresh battle, or right after `battle_message_done`'s own
unconditional clear has just run for the previous action's own message dismissal. No call site can
legitimately arrive at an arm call with a *different* effect still genuinely running — so an
`NO_ANIM` arm (no visual authored for this specific action) correctly leaves the ZP bytes at exactly
what that same invariant already left them at, not at some other action's stale state. This is a
property of *where* arming is called from, not a property the arm routine itself has to enforce.

**Arming — three call sites, unchanged in shape from round 2, corrected in contract only.**
`attack_target` (party-only) arms nothing. `monster_turn_attack`
(`engine/battleturn.asm:1108-1121`, shared by both spell-list gates) arms `battle.attackAnim` before
`pick_party_target`/`roll_hit`:

```asm
; engine/battleturn.asm
monster_turn_attack:
  .if BATTLE_ANIM_ENABLED
  jsr battle_fx_arm_attack
  .endif
  jsr pick_party_target
  jsr roll_hit
  ...
```

`cast_spell` decides target vs. caster from the spell's own kind/scope, with `battle.attackAnim` as
the fallback:

```asm
; engine/battleturn.asm
cast_spell:
  ldx <bt_arg
  .if BATTLE_ANIM_ENABLED
  lda spell_anim,x
  cmp #NO_ANIM
  bne cast_spell_fx_spell
  jsr battle_fx_arm_attack        ; no spell visual authored -- fall back
  jmp cast_spell_fx_done
cast_spell_fx_spell:
  ldy <bt_actor                   ; default: the caster (heal / all-scope)
  lda spell_kind,x
  cmp #SK_HEAL
  beq cast_spell_fx_go
  lda spell_scope,x
  bne cast_spell_fx_go            ; scope != one ("all") -- stays the caster
  ldy <bt_target                  ; single-target damage/status -- the target
cast_spell_fx_go:
  lda spell_anim,x
  jsr battle_fx_arm_at
cast_spell_fx_done:
  ldx <bt_arg                     ; reload -- INSIDE the .if, before the dispatch below
  .endif
  lda spell_kind,x
  ...
```

(`.endif` correction, round 3 finding 4: the `ldx <bt_arg` reload is the *last* line inside the
`.if BATTLE_ANIM_ENABLED` block, immediately before `.endif` — not a statement added after it. This
matters because the reload only needs to exist at all when the block above it might have clobbered
X, which is only true when the feature is compiled in.)

```asm
; engine/battleturn.asm — A = animation id (or NO_ANIM, no-op), Y = the
; combatant slot (0-7) to play it over. Clobbers A and X; preserves Y.
;
; An empty animation (anim_count = 0) is treated exactly like NO_ANIM: staged
; into bt_fx_anim first, then reverted -- the one and only place this check
; needs to live, since both arming paths below funnel through here.
  .if BATTLE_ANIM_ENABLED
battle_fx_arm_at:
  cmp #NO_ANIM
  beq battle_fx_arm_at_rts
  sta <bt_fx_anim
  tax
  lda anim_count,x
  beq battle_fx_arm_at_empty
  sty <bt_fx_slot
  lda #0
  sta <bt_fx_frame
  sta <bt_fx_timer
battle_fx_arm_at_rts:
  rts
battle_fx_arm_at_empty:
  lda #NO_ANIM
  sta <bt_fx_anim
  rts

; Arms whoever is acting's own mon_anim_attack over their own slot (bt_actor),
; if bt_actor is a monster with one authored. A party member has no authored
; attack visual (yet, §9) and is left alone. Clobbers A, X and Y (the
; `ldy <bt_actor` below).
battle_fx_arm_attack:
  lda <bt_actor
  cmp #MAX_PARTY
  bcc battle_fx_arm_attack_rts
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_actor,x
  tax
  lda mon_anim_attack,x
  ldy <bt_actor
  jmp battle_fx_arm_at
battle_fx_arm_attack_rts:
  rts
  .endif
```

**Ticking**, unchanged in shape, guarded on `BP_INTRO` — and here the round-3 review's own
clarification matters (finding 8): this guard protects `battle_fx_tick` specifically, because *tick*
runs before `battle_dispatch` on every tick, including the very first one, where `bt_phase` is still
genuinely `BP_INTRO` and `bt_fx_anim` has not yet been reset for this battle:

```asm
; engine/battle.asm
battle_tick:
  jsr wipe_tick
  .if BATTLE_ANIM_ENABLED
  jsr battle_fx_tick
  .endif
  jsr battle_dispatch
  jmp battle_draw_sprites
```

```asm
; engine/battleturn.asm
  .if BATTLE_ANIM_ENABLED
battle_fx_tick:
  lda <bt_phase
  cmp #BP_INTRO
  beq battle_fx_tick_rts
  lda <bt_fx_anim
  cmp #NO_ANIM
  beq battle_fx_tick_rts
  tax
  inc <bt_fx_timer
  lda anim_ptr_lo,x
  sta <ptr_lo
  lda anim_ptr_hi,x
  sta <ptr_hi
  lda <bt_fx_frame
  asl a
  tay
  iny                        ; offset to the current frame's duration byte
  lda <bt_fx_timer
  cmp [ptr_lo],y             ; holds for EXACTLY `duration` ticks: timer <
  bcc battle_fx_tick_rts     ; duration stays, timer >= duration advances --
                              ; correct even at duration 255
  lda #0
  sta <bt_fx_timer
  inc <bt_fx_frame
  lda <bt_fx_frame
  cmp anim_count,x
  bcc battle_fx_tick_rts
  lda #NO_ANIM               ; one pass through the flipbook: done
  sta <bt_fx_anim
battle_fx_tick_rts:
  rts
  .endif
```

**Drawing runs AFTER `battle_dispatch`, not before it — a real, different position from tick's, and
this is why `battle_fx_draw`'s own `BP_INTRO` guard never blocks a legitimate same-tick draw (round
3, finding 8).** `battle_intro` (`engine/battle.asm:330-338`) sets `bt_phase` to `BP_MENU` *before*
calling `battle_first_turn` — so by the time `battle_dispatch` returns and `battle_draw_sprites`
runs, later in the *same* tick, `bt_phase` already reads `BP_MENU` or (if a monster's own immediate
first turn resolved into a message) `BP_MESSAGE`, never still `BP_INTRO`. An intro that hands a
monster the very first turn — an authored `attackAnim` armed and ready — therefore draws its own
frame 0 correctly on that same tick, exactly as any other action would; the guard exists only to
stop `battle_fx_tick`'s own *earlier* read this same tick, before dispatch has had the chance to move
`bt_phase` off `BP_INTRO` at all.

```asm
; engine/battleui.asm
  lda #0
  sta <oam_idx
  .if BATTLE_ANIM_ENABLED
  jsr battle_fx_draw
  .endif
  ldx #0
battle_sprite_pc:
  ...
```

Drawing first (while `oam_idx` is still zero) is what makes the effect a foreground overlay: this
codebase's own PPU implements "lower OAM index wins" priority
(`renderer/emulator/core/ppu/index.js:1700`). **Park-first (`battle_sprite_clear`, which zeroes the
whole shadow before anything is drawn) remains correct and necessary and is unaffected by this
change** — it is what lets the empty/full ambiguity `battle_draw_sprites`'s own header comment
already names be resolved by a fresh start each tick, not something drawing the effect first
disturbs.

```asm
; engine/battleui.asm — the fit check, round 3 finding 2: one compiled
; constant, one direct compare, no addition.
;
; BATTLE_FX_OAM_ROOM (main/build/generate.js) is `max(0, MAX_OAM_ENTRIES -
; battleCombatantOamMax(project, mapper))` -- the room left for the running
; effect once the worst-case combatant icons and the split-only cursor have
; taken their own share, computed once at build time. Comparing a frame's own
; ms_count directly against this single figure needs no clc/adc pair and so
; cannot raise a byte-overflow question the way adding two byte-sized figures
; together first could.
;
; This bound is a project-wide STATIC maximum, not the current formation's
; own live count (round 3, finding 3): it can reject a frame that would
; genuinely have fit this particular, smaller-than-worst-case battle, and it
; rejects that SAME oversized frame on every tick it is current, never only
; once -- an animation whose every frame exceeds its own room is simply
; never drawn, in any battle, ever. If it does not fit, the WHOLE frame's
; draw is skipped, never a partial one, because draw_metasprite itself has
; no notion of "how much room is left downstream": it only wraps oam_idx
; back to zero on overflow (engine/entities.asm), which would silently let a
; later combatant's own sprites overwrite this frame's tail instead.
;
; This guard protects only the new effect against corrupting what draws
; after it. It does NOT retroactively repair a project whose combatants
; alone (with no effect at all) already exceed 64 OAM entries --
; draw_metasprite's own wrap-to-zero and the split cursor's own unguarded
; write (battle_sprite_cursor_done, and the stale comment at
; engine/battleui.asm:899-902 promising the cursor is always safely dropped,
; which this slice neither wrote nor repairs) are pre-existing exposure.
  .if BATTLE_ANIM_ENABLED
battle_fx_draw:
  lda <bt_phase
  cmp #BP_INTRO
  beq battle_fx_draw_rts
  lda <bt_fx_anim
  cmp #NO_ANIM
  beq battle_fx_draw_rts
  tax
  lda <bt_fx_frame
  asl a
  tay
  lda anim_ptr_lo,x
  sta <ptr_lo
  lda anim_ptr_hi,x
  sta <ptr_hi
  lda [ptr_lo],y             ; this frame's metasprite id
  tax                        ; park it -- the animation id in X is done with
  lda ms_count,x
  cmp #BATTLE_FX_OAM_ROOM+1
  bcs battle_fx_draw_rts     ; does not fit alongside what draws after it
  lda <bt_fx_slot
  cmp #MAX_PARTY
  bcs battle_fx_draw_mon
  lda #BT_PARTY_X
  sta <de_ex
  lda <bt_fx_slot
  asl a
  asl a
  asl a
  asl a
  asl a                     ; slot * BT_PARTY_STEP
  clc
  adc #BT_PARTY_Y
  sta <de_ey
  jmp battle_fx_draw_go
battle_fx_draw_mon:
  lda #BT_MON_COL*8
  sta <de_ex
  lda <bt_fx_slot
  sec
  sbc #MAX_PARTY
  asl a
  asl a
  asl a
  asl a
  asl a                     ; monster slot * 32 pixels
  clc
  adc #BT_MON_ROW*8
  sta <de_ey
battle_fx_draw_go:
  txa                       ; recover the metasprite id
  jmp draw_metasprite        ; tail call -- its own rts returns to our caller
battle_fx_draw_rts:
  rts
  .endif
```

**When the combined admitted total is exactly `MAX_OAM_ENTRIES`, the last nonempty draw may wrap
safely, because there is no later nonempty draw within the reserved maximum to corrupt** — the
exact-fit case the fit check's own worst-case arithmetic already accounts for, not a separate edge
case needing its own guard.

**8-sprites-per-scanline, stated honestly**: the fit check above is a *total OAM budget* guard; the
NES's own separate per-scanline limit (`renderer/emulator/core/ppu/index.js:1585-1629`, at most 8
sprites per scanline, hardware-enforced) is independent of it. A 16-tile effect drawn over a 16-tile
icon on shared rows *can* put more than 8 sprites' worth of pixels on one scanline even though both
individually fit the 64-total budget — whether it actually does depends on the real per-row layout,
not merely the two totals. This is an authoring constraint, not something this design's own fit
check can or should try to also enforce.

**One setup line**, unchanged, so no effect survives from a previous battle:

```asm
; engine/battle.asm, setup_monsters — beside its own bt_wipe_* clears
  .if BATTLE_ANIM_ENABLED
  lda #NO_ANIM
  sta <bt_fx_anim
  .endif
```

### §3.4 vram_buf accounting

Unchanged arithmetic from round 2 (112 bytes for the `battle_list_back` → `show_cursor` →
`cursor_write` chain; 92 bytes for the `battle_message_done` → status-tick → `battle_say` chain),
with one wording correction the round-3 review's own "sound" section asked for: **the 123-byte
figure (112 plus an 11-byte concurrent `wipe_tick` row) is a conservative bound, not a demonstrated
reachable maximum** — the parenthetical example round 2 gave ("a monster dying the same frame the
list closes") is not actually a schedule where both can co-occur, since `battle_list_back` itself
does no damage. The 112-byte figure alone remains a genuine, unconditionally reachable maximum: every
call in that chain runs once its own entry condition is met. This distinction does not change
either number, only which one is asserted to be reachable versus merely bounded. **This design adds
zero vram_buf bytes either way** — no `vram_open`/`vram_push`/`queue_at` call anywhere in Appendix
A.

### §3.5 Gating and the ledger

```js
// shared/project.js
export function projectUsesBattleAnimation(project) {
  if ((project.spells ?? []).some((spell) => spell.anim !== null && spell.anim !== undefined)) return true;
  return (project.sprites?.actors ?? []).some(
    (actor) => actor.battle?.attackAnim !== null && actor.battle?.attackAnim !== undefined
  );
}

export function projectWithoutBattleAnimation(project) {
  const clone = structuredClone(project);
  for (const spell of clone.spells ?? []) spell.anim = null;
  for (const actor of clone.sprites?.actors ?? []) {
    if (actor.battle) actor.battle.attackAnim = null;
  }
  return clone;
}
```

`BATTLE_ANIM_ENABLED` in config.inc, the `MONSTER_SPELL_LIST_ENABLED` shape. The corrected banked
allowance:

```js
// main/build/battletables.js
export const BATTLE_ANIM_BATTLE_ALLOWANCE = 243; // measured, §2(a) — flat, all three boards
```

wired into `battleRegionBytes` the `MONSTER_SPELL_LIST_BATTLE_ALLOWANCE` no-`&& banked` shape. The
two new tables, both applying `validAnimId` (§3.1, now a one-line call):

```js
// main/build/battletables.js, battleTables() — after mon_attr and after spell_scope/spell_name
if (projectUsesBattleAnimation(project)) {
  chunks.push(`mon_anim_attack:\n${dbRows(battle((b) => validAnimId(b.attackAnim, project)))}`);
}
...
if (projectUsesBattleAnimation(project)) {
  chunks.push(`spell_anim:\n${dbRows(spells.map((spell) => validAnimId(spell.anim, project)))}`);
}
```

Table costing, the general figure: `max(1, actors.length) + max(1, spells.length)` while the gate is
on (`sample-rpg`'s own 7 = 4 + 3, neither list empty, is that project's specific case, not a
universal constant).

**No kernel-lo term at all**, confirmed unmoved by the six-fixture identity gate. `battleShortfall
Advice`'s own `bankedFeatures` lever is unchanged from round 2:

```js
if (battleBankEnabled(project, mapper) && projectUsesBattleAnimation(project)) {
  bankedFeatures.push({ label: 'every battle animation reference', strip: projectWithoutBattleAnimation });
}
```

**`BATTLE_COMBATANT_OAM_MAX` is no longer emitted at all (round 3, finding 2)** — it exists only as
`battleCombatantOamMax`, a plain JS function, an internal input to `BATTLE_FX_OAM_ROOM`'s own single
computation (§3.6). The engine never sees the combatant figure directly, only the room left over.

**Off-path byte-identity, re-proven against the round-3 corrected prototype.** All six checked-in
fixtures rebuilt and hashed identically against the same pristine baseline round 1 recorded, on all
six, unchanged. `npm test`'s `rpg.test.js` (103/103), `rammap.test.js` (2/2) and `zeropage.test.js`
(8/8) all pass unmodified.

### §3.6 OAM accounting

```js
// shared/project.js
export function battleCombatantOamMax(project, mapper) {
  if (project.project?.gameType !== 'rpg') return 0;
  const actorCount = project.sprites.actors.length;
  const party = project.party.reduce((total, member) => {
    const metasprite = project.sprites.metasprites[member.metaspriteId];
    return total + (metasprite?.tiles.length ?? 0);
  }, 0);
  const formations = battleFormations(project, actorCount);
  const monsters = Math.max(0, ...formations.map((formation) => formationSpriteCost(formation, project)));
  const cursor = fontBankSplit(project, mapper) ? 1 : 0;
  return party + monsters + cursor;
}

export function battleSpriteBudget(project, mapper) {
  if (project.project?.gameType !== 'rpg') return { used: 0, limit: MAX_OAM_ENTRIES };
  // Round 3, finding 1: only a PLAYABLE reference contributes -- an invalid
  // one (a stale id, or one whose own frames name a missing metasprite)
  // costs exactly 0 here, the same "won't actually play" fact the engine's
  // own arm-time guard and generator defense already act on.
  const fxTiles = Math.max(
    0,
    ...[...allBattleAnimationIds(project)]
      .filter((animId) => isPlayableBattleAnimation(animId, project))
      .flatMap((animId) =>
        project.sprites.animations[animId].frames.map(
          (frame) => project.sprites.metasprites[frame.metaspriteId].tiles.length
        )
      )
  );
  return { used: battleCombatantOamMax(project, mapper) + fxTiles, limit: MAX_OAM_ENTRIES };
}
```

**One generated constant, computed from `battleCombatantOamMax` but never emitting that figure
itself (round 3, finding 2):**

```js
// main/build/generate.js
const battleFxOamRoom = Math.max(0, MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper));
...
`BATTLE_FX_OAM_ROOM = ${battleFxOamRoom}`,
```

**The bounded guarantee, stated exactly**: a valid, admitted effect (one whose current frame fits
`BATTLE_FX_OAM_ROOM`) leaves room for the conservative combatant/cursor maximum this project could
ever draw in one tick. **A project whose combatants alone already overflow 64 keeps its pre-existing
overflow — this mechanism neither causes nor repairs that**, and no claim in this document says
otherwise. `draw_metasprite`'s own wrap-to-zero and the split cursor's own unguarded write
(`engine/battleui.asm:899-902`, whose own comment already, independently, over-promises that a full
shadow always costs the cursor rather than a combatant) are pre-existing facts about this engine,
unrelated to and unrepaired by this slice.

**A second, distinct warning, paired with the existing one rather than replacing it (round 3,
finding 3):**

```js
// shared/project.js — unchanged text/trigger for a project with no battle animation
export function describeBattleSpriteWarning(budget) {
  return `A battle could need ${budget.used} sprites at once; the NES can only show ${budget.limit}.`;
}

// New: names which animation is large enough to be skipped, and says so
export function describeBattleAnimationOamWarning(project, mapper) {
  const combatantMax = battleCombatantOamMax(project, mapper);
  let worstId = null;
  let worstTiles = 0;
  for (const animId of allBattleAnimationIds(project)) {
    if (!isPlayableBattleAnimation(animId, project)) continue;
    const tiles = Math.max(
      0,
      ...project.sprites.animations[animId].frames.map(
        (frame) => project.sprites.metasprites[frame.metaspriteId].tiles.length
      )
    );
    if (tiles > worstTiles) { worstTiles = tiles; worstId = animId; }
  }
  if (worstId === null) return null;
  const name = project.sprites.animations[worstId].name;
  return `"${name}" (${worstTiles} sprite tiles) plus this project's own worst-case combatants and ` +
    `cursor (${combatantMax}) would need more than the NES's ${MAX_OAM_ENTRIES} sprites at once, so ` +
    "it will be skipped in-game whenever it does not fit — even in a battle with real room, since " +
    "the check is a project-wide worst case, not this battle's own.";
}
```

```js
// shared/project.js, validateProject
const battleBudget = battleSpriteBudget(project, artworkMapper);
if (battleBudget.used > battleBudget.limit) {
  add('warning', 'Build', describeBattleSpriteWarning(battleBudget));
  const animWarning = describeBattleAnimationOamWarning(project, artworkMapper);
  if (animWarning) add('warning', 'Monster Forge', animWarning);
}
```

A project with `fxTiles = 0` (no battle animation authored at all) triggers only the first warning,
its own text and trigger byte-for-byte unchanged from before this slice existed — confirmed directly
(the round-1/round-2 six-fixture identity gate exercises exactly this path). The second warning
fires only when a real, playable battle animation is part of a project whose combined worst case
exceeds 64.

**This ships in phase 1**, not a later release: a valid, admitted effect leaves room for the
conservative combatant/cursor maximum this project could ever draw in one tick, and the warning is
what tells an author, before they ship, that their own flipbook may sometimes be silently skipped
in-game.

## §4. Q5 — the UI

Unchanged from round 2: the Magic Forge gains an "Animation" picker; the compositor correction
(`paintMetasprite` is DOM-free, `drawMetaspritePreview` a canvas wrapper) stands; no preview ships in
phase 1. The Monster Forge gains the matching "Attack animation" field. `main/smoke.js` needs one
more round-trip assertion inside the existing Forge visits, no new Forge-visit special case.

## §5. What could go wrong

- **The frame-to-metasprite second hop, closed at all three consumers, not one.** Found only by
  tracing what `draw_metasprite` actually dereferences, not by reading the top-level id check in
  isolation — a reference that passes "is this id real" can still name an animation whose own frame
  is garbage. Closed by `isPlayableBattleAnimation`, checked identically by validation, the
  generator, and the OAM budget (§3.1, §3.6).
- **A duplicated engine equate plus a runtime addition, where one compiled constant and a direct
  compare would do.** `MAX_OAM_ENTRIES` already existed on the JS side (`shared/project.js:185`);
  adding a second, engine-side equate of the identical value was unnecessary duplication, and
  computing the fit check via `clc`/`adc` against it raised a byte-overflow question a
  pre-subtracted `BATTLE_FX_OAM_ROOM` avoids entirely. Closed by moving the subtraction to build
  time (§3.3, §3.6).
- **A conservative, project-wide fit check silently reads as "this project is always safe in every
  battle."** It is not: the bound is the *worst-case* combatant/cursor draw, not the current
  formation's own live count, so a frame can be skipped in a real battle that had genuine room, and
  an animation whose every frame is oversized is never visible at all, in any battle. Stated
  explicitly (§3.3/§3.6) rather than left to be inferred from "the effect is safe."
- **Believing this slice repairs every pre-existing OAM-safety gap it touches.** It does not: a
  project whose combatants alone already overflow 64 keeps that overflow, and the split cursor's own
  unguarded write (with its own already-wrong comment, `engine/battleui.asm:899-902`) is untouched —
  both stated as pre-existing, separate facts, not silently implied to be fixed as a side effect.
- **The intro/outcome lifecycle prose over-generalizing from a true special case.** "Setup clears the
  effect" is true and sufficient for the very first tick; "every outcome follows an action message"
  is not — `battle_first_turn` → `check_over` can reach `BP_VICTORY` with no action message at all
  (an empty formation), safe only because `setup_monsters`'s own clear already ran. Stated as "setup
  OR message dismissal," not "always a message" (§0, finding 8).
- **`battle_fx_draw`'s own `BP_INTRO` guard looking like it could block a legitimate same-tick
  draw.** It cannot: `battle_intro` moves `bt_phase` off `BP_INTRO` before `battle_first_turn` ever
  runs, so by the time draw's own check executes (after dispatch, same tick), the phase has already
  changed. Verified by tracing the exact write order in `battle_intro`, not assumed from tick's own,
  earlier guard being correct (§3.3, finding 8).
- **A killing hit's own ordering, re-checked once more and still untouched.** No arm call changes
  when `apply_damage`/`apply_damage_mon` run or what they see; `battle_message_done` clears the
  effect before `battle_message_advance` sets `BP_NEXT`, and only the next tick's `battle_take_turn`
  calls `check_over`.

## §6. Test plan

| Test | Shape | Wrong implementation it catches |
|---|---|---|
| Off-path byte-identity | `monsterlevel.test.js`-shape, both fields at `null` | A gate that assembles even one byte of the new code/tables unconditionally |
| Ledger isolation | `bankedbytes.test.js`-shape, `assert.equal` on the corrected 243-byte delta, all three boards | A stale allowance figure drifting from the real assembled cost |
| **The reviewer's own worked example** | `spell.anim = 0`; animation 0 has one frame naming a metasprite that does not exist; assert `validateProject` refuses (error, Sprite Forge) AND, independently, `battleTables(project)` called directly emits `NO_ANIM` for that spell, never the bogus metasprite id | The exact defect finding 1 named: a "valid" top-level reference whose own frame is garbage, reaching `draw_metasprite` unchecked |
| Invalid-frame variants | An animation with a frame whose `metaspriteId` is negative, non-integer, or exactly the metasprite catalog's own length | An off-by-one or type-coercion gap in `isPlayableBattleAnimation` |
| Conservative fit, case 1 | A project whose *worst* formation would overflow `BATTLE_FX_OAM_ROOM` but whose *current*, smaller formation has real room; assert the effect is still skipped | A fit check that reads live formation state instead of the compiled worst case (would falsely draw when the design says it must not, or vice versa) |
| Conservative fit, case 2 | An animation whose every frame exceeds the room; assert it is never drawn across several ticks, not merely delayed | A "skip once, then allow" bug — the design requires per-tick re-evaluation, always failing the same way |
| Conservative fit, case 3 | An animation with one small frame and one oversized frame; assert the small frame draws and the oversized one is skipped, independently, frame by frame | A whole-animation skip decision made once at arm time instead of per-frame at draw time |
| Warning policy | A project with no battle animation triggers only `describeBattleSpriteWarning`, byte-identical text; a project whose animation pushes `used` over the limit triggers both, the second naming the animation | A warning rewrite that changes existing wording/trigger for every project, not only ones that added a battle animation |
| Real monster physical hit/miss | Drive a monster's own attack through `rpg.test.js`'s helpers with an authored `attackAnim`; assert the flipbook plays on hit and on a forced miss | Round 1's own defect: arming a helper (`attack_target`) that can never fire for a monster |
| Cast precedence, both spell-list gates | Four cases (neither/spell-only/attack-only/both) under both `MONSTER_SPELL_LIST_ENABLED` and the flat variant | A fallback reading the wrong field, or only exercising one gate |
| Target vs. caster policy | Single-target damage (target), single-target status (target), heal (caster), all-target (caster) | A policy defaulting to the caster always, or reading `bt_target` before it is set |
| Post-arm dispatch integrity | After both `cast_spell` arming branches (the spell-visual branch and the attackAnim-fallback branch), assert the subsequent `spell_kind`/`spell_amount_*` reads are still correct and the previously-selected target slot is unchanged | The `.if`-block `ldx <bt_arg` reload silently missing, corrupting the dispatch beneath it |
| Duration timing, isolated | `selectBattleBank`/`callRoutine`-style isolated calls to `battle_fx_tick`, not a normal battle message (which caps at `MSG_HOLD = 45` and would end a long animation early): duration 1 ends after exactly 1 tick, duration 2 after exactly 2 (drawn on ticks 0 and 1, per the reviewer's own worked timeline), duration 255 ends at the compare on tick 255 without ever needing the byte to exceed it | The pre-round-2 compare direction bug, or a harness that can't distinguish natural termination from message capping |
| Message-cap termination, separate | An animation authored at duration 255, played through a REAL battle message under its normal `MSG_HOLD = 45` hold (not the isolated-routine harness above); assert the effect ends when the message is dismissed (well before tick 255 — the message caps it first), not at its own natural end. An optional second case: the player presses A early, ending the message (and the effect) sooner still | Conflating "a duration-255 animation ends on its own after 255 ticks in isolation" with "it also reaches tick 255 inside a normal battle," which `MSG_HOLD` alone already rules out |
| Multi-frame sequence | A 3+ frame animation with distinct durations; assert `bt_fx_frame` advances in the documented order, timed from the arm tick | An off-by-one in frame advancement invisible to a 1- or 2-frame test |
| Deletion below/at/above; shared references; null/255; invalid references in an over-cap catalog | `renumberMetaspriteDeletion`'s own test shape, extended: on an over-cap (256-entry) catalog, an INVALID reference (`255`, or any id that fails `isValidAnimationRef`) is asserted UNTOUCHED by deletion; a VALID, in-range reference (e.g. id 5) in that same over-cap catalog is asserted to shift NORMALLY, exactly as it would on a normal-size catalog — being over-cap does not itself make a low, real id invalid | The blind `id > k → id - 1` shift silently decrementing an already-invalid value into a real, wrong id; or, in the opposite direction, a check that wrongly refuses to shift every reference just because the catalog happens to be over-cap |
| Register/scratch contract | `selectBattleBank`'s own isolated-call harness, asserting `bt_tmp`/`bt_tmp2`/`bt_digits`/`bt_list` are bit-for-bit unchanged across a call to each routine | A future edit reaching for shared scratch |
| Rendered-pixel overlap | Real `nes.ppu` frame-buffer read, arm an effect over a combatant with a real icon, assert the effect's opaque pixels are visible at the overlap | A draw-order regression silently reverting to "behind" |

## §7. Phasing

**Phase 1a — reference integrity, ROM-neutral, ships alone.** The shared traversal, both exported
predicates, `renumberAnimationDeletion` (called before the splice), the Sprite Forge's own
delete-handler fix, and `validateProject`'s three new refusals (§3.1). Fixes a real pre-existing
defect with no engine or generator change.

**Phase 1b — both references, the corrected engine mechanism, minimal pickers, the OAM term and its
paired warning, together.** Schema fields, `BATTLE_ANIM_ENABLED`, `BATTLE_FX_OAM_ROOM`, both new
tables, the four engine routines wired at all real call sites, `battleSpriteBudget`'s corrected math
and `describeBattleAnimationOamWarning` shipped in the same phase, the minimal Magic/Monster Forge
picker fields. ROM-neutral for every project that authors neither field — the six-fixture hash gate
is the acceptance proof.

- No save-format change (`SAVE_FIELDS`, `shared/save.js:101` onward, holds nothing this slice adds).
- All six checked-in fixtures stay off; every test needing the feature builds its own `mkdtemp`
  variant.
- The RPG starter does not opt in during this phase — a later, separately reviewed content change.
- The CLAUDE.md docs pass must pair its own addition with a trim (76-character budget as of this
  writing) — a concrete candidate: compressing the "Documented limitations" sentences the zero-page
  kernel diet closed into one summary sentence pointing at `docs/design-kernel-diet.md` §4b.

**Phase 2a — hit feedback, ships first (Chris's own decision, §10, v5.1).** The sprite hit-blink and
the block-art attribute flash, sharing one `bt_hurt_slot`/`bt_hurt_left` pair (Chris's phase-2-round-1
answer 1, unaffected by this split), gated on its own `project.rpg.hitFeedback` field and generated
`HIT_FEEDBACK_ENABLED` flag (schema and ledger in §12.7). This document's own recommendation was ONE
combined phase behind ONE shared toggle (§8); Chris chose two independently-gated phases instead, so
this is what ships:

- Gated on `HIT_FEEDBACK_ENABLED` alone (§12.7) — nothing MISS-specific may key off this flag, and
  §12's own engine code (§12.3-§12.6) never reads or writes anything §13 defines.
- ROM-neutral with the toggle off: all six checked-in fixtures stay off and byte-identical, since
  `normalizeRpg` defaults `hitFeedback` to `false` and none authors it (§12.7).
- No save-format change: `bt_hurt_slot`/`bt_hurt_left` are battle-local, reset every fresh battle
  (§12.2/§12.4) the same way `bt_fx_anim` already is, never written to a save record.
- Ships with no MISS code, art, or OAM term existing anywhere in the tree yet — §13 does not exist
  until phase 2b.

**Phase 2b — MISS, ships after phase 2a (Chris's own decision, §10, v5.1).** The floating MISS
overlay, gated on its own `project.rpg.miss` field and generated `MISS_ENABLED` flag (schema and
ledger in §13.9), independent of hit feedback's own gate.

- Gated on `MISS_ENABLED` alone (§13.9) — nothing hit-feedback-specific may key off this flag. §13's
  own engine code (§13.4) already reads and writes only `bt_miss_slot`/`bt_miss_left`, never
  `bt_hurt_*` — the runtime independence §12.4 already states ("different zero-page bytes, different
  arm points... can be live on DIFFERENT slots at the same time with no interference") extends
  cleanly to independent GATES, not merely independent runtime state, with one exception spelled out
  below (the RAM chain).
- ROM-neutral with the toggle off, the identical fixture-neutrality phase 2a holds to.
- The MISS glyph art (§13.5) and the `spriteReservedRanges`/`BATTLE_FX_OAM_ROOM` generator changes
  (§13.6) ship in the same commit as the engine routines — a MISS overlay with no tiles stamped for
  it, or an OAM budget that does not yet know about it, is not a partial feature, it is a silent
  garbage-tile bug the moment the first attack misses.

**What phase 2b depends on from phase 2a, stated exactly.** Not code — §12 and §13's own routines
share no call and no drawing/tick code (previous paragraph). The one real dependency is the RAM
chain §13.2 designs around: `bt_miss_slot = bt_hurt_left+1`, chained onto hit feedback's own last
equate rather than onto `bt_fx_timer+1` directly. Chris's chosen order (hit feedback first) is the
one order that needs no rework of that chain: by the time phase 2b is implemented, `bt_hurt_left`
already exists as a real, shipped equate from phase 2a, so phase 2b's own diff simply extends the
existing chain exactly as §13.2 already designs it. The reverse order would have needed phase 2a
(MISS) to chain onto `bt_fx_timer+1` directly and phase 2b (hit feedback) to either insert itself
before `bt_miss_*` in the chain or renumber it — real rework this order avoids.

**Equates stay unconditional, so the RAM chain works in every toggle combination, including MISS
alone with hit feedback off.** `bt_hurt_slot`/`bt_hurt_left`/`bt_miss_slot`/`bt_miss_left` are
declared exactly the way `bt_fx_anim`/`bt_fx_slot`/`bt_fx_frame`/`bt_fx_timer` already are
(`engine/constants.asm:463-466`) — plain `label = address` equates with no `.if` around the
declaration itself, costing zero ROM bytes regardless of whether `HIT_FEEDBACK_ENABLED`/
`MISS_ENABLED` gate any CODE that reads or writes them (CLAUDE.md's own battle-animation passage:
"the unconditionally-appended RAM equates... need no gate of their own to stay fixture-neutral," the
identical rule §12.2/§13.2 already state for this exact pair). So a project shipping
`MISS_ENABLED = 1` with `HIT_FEEDBACK_ENABLED = 0` still assembles `bt_hurt_slot`/`bt_hurt_left` as
real zero-page addresses — unread and unwritten by any gated code, but present — and
`bt_miss_slot = bt_hurt_left+1` resolves exactly as designed, with no special case and no build
failure. **This corrects §13.2's own prior wording**, which warned that stripping hit feedback out
"or a future project that ships MISS without hit feedback" would leave `bt_miss_slot` "referencing
an undefined equate" unless re-chained by hand — true only of the ISOLATED MEASUREMENT copies §11
describes (a scratch build with hit feedback's own equate LINES physically deleted from the source,
used solely to measure MISS's own allowance in isolation), never of a real toggle-gated project,
where the equate line is never deleted, only the code around it gated. §13.2 is corrected below to
say so plainly.

**All four toggle combinations are legal, real, buildable projects once both phases have shipped:**

| `hitFeedback` | `miss` | What it means | Ledger (§12.7/§13.9) |
|---|---|---|---|
| off | off | Neither feature; byte-identical to before phase 2 existed | +0 |
| on | off | Phase 2a alone | +235 |
| off | on | Phase 2b alone — the floating MISS text with no sprite-blink/attribute-flash reaction | +134 |
| on | on | Both | +369 (§12.7's own ledger decision) |

The off/on row (MISS alone) is not merely theoretical: §12 and §13's own engine code was already
written as independent mechanisms before this split existed (§12.4), so nothing in either §12 or §13
needs to change to make it buildable — only the two flags need to be independently readable in
`config.inc`, which the schema in §12.7/§13.9 already provides.

**Phase 3 — UI polish, designed in full in §15.** The Magic Forge preview canvas, gated on a
frame-for-frame trace test existing first — stated exactly, in order: (i) `renderer/widgets/
battlefx.js`'s DOM-free stepper (§15.2) and its own no-ROM unit tests (§15.7) ship and pass; (ii)
the golden-trace test (§15.6) — the ROM is the oracle, the stepper is what is under test, the
`sfx.test.js` shape — ships and passes on `sample-rpg` (or an equivalent `mkdtemp` RPG variant)
before a single line of `renderer/forges/magic/magic.js`'s own canvas/controls is written; only
then does the UI (§15.5) land. Unaffected by phase 2a/2b — no shared code, RAM, or generated flag
with either hit feedback or MISS (§15.9). Adds no engine code, no generated byte, no schema field
and no save-format change (§15.9) — **the acceptance proof is §15.7's own board × live-feature
matrix (corrected round 1, P2-7), not the bare six-fixture hash gate alone (corrected this round,
P3-8: an earlier version of this paragraph named only the six-fixture gate, which is real but
insufficient on its own — the six fixtures never author a live battle-animation reference, so they
cannot exercise the mapper-dependent room arithmetic §15.3's extraction actually touches; the
matrix's own `sample-rpg`-on-every-board, both-configurations rows are what closes that gap)**.

**Phase 4 — a party member's own attack visual, designed in full in §16 (ROADMAP item 14 point 5),
this round's own new work.** Independent of phases 1-3: its own gate
(`PARTY_ATTACK_ANIM_ENABLED`/`projectUsesPartyAttackAnim`, §16.6), unaffected by hit feedback or
MISS (neither reads or writes `pc_anim_attack` or the new party branch, §16.7), and its own banked
allowance (`PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE = 11`, measured, §16.9) layered on top of
`BATTLE_ANIM_BATTLE_ALLOWANCE`'s own base — a project already using phase 1b (monster/spell
animation) pays no new bytes for phase 4 unless it also authors a party member's own `attackAnim`
(§16.6's own byte-identity proof). Depends on phase 1b's own `bt_fx_*` mechanism existing at all
(the shared flipbook, §16.1) but shares no toggle, RAM byte, or table with phases 2a/2b/3. Ships
after an implementation brief is assembled from §16 alone, per this round's own scope (a design
round only — Appendix E is the measured prototype, not shipped code).

## §8. Open questions for Chris

- **Target-vs-caster remains the recommendation** (target for single-target damage/status, caster
  for heal/all-target), implemented in §3.3. The caster-only alternative is cheaper — it saves the
  `spell_kind`/`spell_scope` selection sequence in `cast_spell`'s own arming block, not merely "one
  fewer branch" (round 3's own wording correction) — if Chris prefers a single, uniform behaviour
  over the impact/flourish distinction.
- **Should a palette-swapped actor's own clone get an independently remapped `attackAnim`, or stay
  shared with the source (§3.1's own accepted limitation)?** Recommendation: leave it shared — a
  palette variant of a monster plausibly reusing the identical attack visual is not obviously wrong,
  and remapping it would need the palette-swap's own tile-repaint machinery extended to a second,
  unrelated animation slot for a benefit that has not been asked for.
- **A stale animation reference now refuses to build rather than resolving silently** (both hops) —
  recommended to ship anyway, the same policy `missingGiveTake` already holds to.
- **Should a party member ever get an authored attack visual of its own?** Left out of this shared
  slice (§9) — a Character Forge question. Recommendation: leave it out.
- **No new duration knob** — an animation's own authored per-frame durations already decide,
  capped at whatever the message hold leaves.

Chris answered all five of the above on 2026-09-13, accepting every recommendation as written:
target-vs-caster as §3.3 implements it (target for single-target damage/status, caster for heal
and all-target — confirmed explicitly against the two alternatives, always-the-target and
every-target-at-once, neither wanted); a palette-swapped clone keeps sharing the source's
`attackAnim`; a stale animation reference refuses to build, both hops; no party-member attack
visual in this slice — a deferral, not a dismissal: Chris asked for it to be on the roadmap, so
ROADMAP item 14 now carries it as its own later slice (point 5), a Character Forge question as §9
already says; and no duration knob. The primary path throughout this document already follows
every one of these, so nothing above needed re-deriving.

### Phase 2's own open questions, answered by Chris on 2026-09-14

The three bullets immediately below are kept exactly as originally written — including their own
recommendations — as the historical record of what was proposed. A fourth matter, whether hit
feedback and MISS ship as one phase or two, was raised in §7's own prose rather than bulleted here;
§7 pointed here for it ("an open question for Chris (§8)") without a literal bullet existing — noted
for accuracy, not corrected, since the question itself was real and is answered below regardless of
which section literally listed it. The paragraph after the three bullets records what Chris actually
decided on all four matters, which disagrees with the recommendation on two of them.

- **Gating.** Phase 2 has no authored field today — the three answers in §10's own phase-2 entry
  decided the *shape*, not whether a project can opt out. Three options, costed, each now stating
  its own fixture/test consequence explicitly rather than leaving it implied (round 1's own "other
  conclusions" note: "These are consequences, not a new gating decision on Chris's behalf"):
  - **(A) Always on for every RPG, no new field.** Every RPG-capable board's own
    `BASE_BATTLE_CODE_BYTES_BY_MAPPER` would absorb 367 bytes unconditionally — the one thing every
    other battle-region feature in this document (`MONSTER_SPELL_LIST_BATTLE_ALLOWANCE`,
    `BATTLE_ANIM_BATTLE_ALLOWANCE` itself) deliberately does NOT do, precisely so a project that
    does not use a feature does not pay its base cost (CLAUDE.md's own kernel-budget rule, "a
    conditional feature's cost is a separate generated allowance, never folded into a base," applied
    here by the identical logic). **Fixture consequence**: changes `sample-rpg` and
    `sample-rpg-mmc1`'s own ROM bytes specifically — the two RPG fixtures, not the other four action
    fixtures, which never reach the battle region at all — forcing a re-pin of
    `test/unit/nameentry.test.js`'s own six-fixture SHA-256 gate (`:92-119`) and of
    `test/unit/playerparts.test.js`'s duplicate literal hash. Beyond the literal hash references,
    it also requires retuning `BASE_BATTLE_CODE_BYTES_BY_MAPPER`'s own equality assertions and every
    capacity-refusal test whose padding was calibrated to the pre-phase-2 base — the identical
    re-pinning cost every past feature that touched those fixtures has paid, but here for a feature
    an author cannot turn off.
  - **(B) A new authored toggle, `projectUsesHitMiss`-shaped** (recommended). One field —
    `project.rpg.hitFeedback: boolean`, say — gates a new `HIT_MISS_ENABLED` flag and a new
    `HIT_MISS_BATTLE_ALLOWANCE = 367` banked ledger term (§12.7), the identical shape
    `BATTLE_ANIM_ENABLED`/`BATTLE_ANIM_BATTLE_ALLOWANCE` already established. **Fixture consequence**:
    can preserve all six fixture ROMs byte-for-byte, PROVIDED every one of the engine call sites,
    the glyph stamping (§13.5), the OAM adjustments (§13.6) and the allowance itself are ALL gated on
    the one flag with no exception — none has ever authored the field, since it does not exist yet,
    so absent unconditionally means false. The unconditionally-appended RAM equates (§12.2/§13.2)
    alone emit no ROM bytes and do not shift any existing RAM address, so they need no gate of their
    own to stay fixture-neutral. A Build-panel or RPG-settings checkbox, not a per-actor or
    per-spell field, since neither half is tied to specific content the way `attackAnim`/`anim` are.
  - **(C) Piggyback on `projectUsesBattleAnimation`** (considered, not recommended): a project that
    has authored any `attackAnim`/`spell.anim` gets hit feedback and MISS "for free," no new field.
    Rejected because it conflates two genuinely separate authoring decisions — a project can
    reasonably want the universal hit-blink/MISS reaction without ever authoring a single custom
    attack visual (or vice versa) — and ties a feature's presence to unrelated content in a way this
    document's own single-writer discipline elsewhere refuses to do. **Fixture consequence**: also
    leaves all six checked-in fixtures off (none authors `attackAnim`/`spell.anim` today either), but
    unlike (B) it changes the EXISTING opt-in battle-animation test variants and their own exact
    allowance expectations (`test/unit/bankedbytes.test.js:501`, the `BATTLE_ANIM_BATTLE_ALLOWANCE`
    equality test) — any test that already turns `projectUsesBattleAnimation` on to measure phase 1b
    in isolation would now ALSO pull in phase 2's own bytes, entangling two allowances a reader would
    reasonably expect to vary independently.

  **Recommendation: (B).** It is the only option that keeps every existing fixture AND every
  existing test's own isolation byte-identical without an author's own choice, and it is the shape
  every other battle-region feature in this codebase already uses.
- **One toggle for both halves, or two independent ones?** §7 recommends shipping hit feedback and
  MISS as one phase; a single `hitFeedback` flag covering both is the natural extension of that and
  the smaller UI/ledger surface (one flag, one allowance term). Two independent flags would give an
  author finer control (hit blink without MISS, say) at the cost of a second field, a second
  generated flag, and a second ledger term to keep isolated from the first (the identical
  `MONSTER_SPELL_LIST_BATTLE_ALLOWANCE` vs `BATTLE_ANIM_BATTLE_ALLOWANCE` precedent — two independent
  gates, never one gate covering two costs, is how this document's own §7 finding for magic
  power/defence was decided; the same argument could cut the other way here). **Recommendation: one
  flag**, since — unlike magic power and magic defence, which are independently authorable stats — 
  nothing about hit feedback and MISS is separately *authored* content an author would want on its
  own; they are both universal reactions to the same event class (a resolved physical/spell hit or
  miss), so splitting the toggle buys configurability nobody has asked for.
- **The MISS glyph art itself, and its exact timing/placement constants** (`BT_MISS_FRAMES = 30`,
  the 8-pixel upward offset, §12/§13's own reasoned, not measured, choices) — genuine taste calls,
  not determinable from the code. Recommendation: ship the values in §13 as a starting point, tune
  after a real playtest; none of them affects the measured byte cost (§12.7), only the visual.

**Chris answered all four of the above on 2026-09-14** (recorded verbatim in §10's own new
changelog entry). Two match this document's own recommendation; two go against it:

1. **Gating: option (B), a new authored project toggle.** Matches the recommendation's own SHAPE —
   not always-on (A), not piggybacked on `projectUsesBattleAnimation` (C) — but not its illustrative
   ONE-field example, superseded by answer 2 immediately below.
2. **TWO independent toggles, one for hit feedback, one for MISS — AGAINST the "one flag"
   recommendation.** `project.rpg.hitFeedback: boolean` and `project.rpg.miss: boolean`, each its
   own generated flag (`HIT_FEEDBACK_ENABLED`/`MISS_ENABLED`) and its own banked ledger term
   (§12.7/§13.9) — not the single combined field/flag/term the recommendation illustrated. Every
   `projectUsesHitMiss`/`HIT_MISS_ENABLED`/`HIT_MISS_BATTLE_ALLOWANCE` reference elsewhere in this
   document (before this answer) named the now-superseded single-toggle shape; §12/§13 below are
   corrected to the two-flag shape this answer settles on.
3. **Phasing: hit feedback ships FIRST as its own phase (2a); MISS ships AFTER as a separate phase
   (2b) — AGAINST the "one phase" recommendation.** §7 is rewritten around this split; see its own
   "what phase 2b depends on from phase 2a" paragraph for the one real (RAM-chain) consequence.
4. **MISS art, timing and placement: ship the v5 values as starting points, tune after playtest —
   matches the recommendation exactly.** `MISS_TILE_M/I/S`, `BT_MISS_FRAMES = 30`, the 8-pixel
   upward offset, and message-dismissal clearing (§13.4) ship unchanged; none of these affects the
   measured byte cost (§12.7/§13.9), only the visual, so this answer required no further design work
   beyond marking it settled.

### Phase 3's own open questions

Everything else phase 3 needed was decided in §15 with a stated recommendation, not left open —
this document's own rule (§10's repeated pattern above) that an open question is only one that is
genuinely Chris's to make, taste or scope, not a technical call this document can settle itself.
Two are genuinely his:

- **Does the Monster Forge get the identical preview in phase 3, or does phase 3 ship Magic-Forge-
  only and the Monster Forge picks it up later?** §15.8 designs the preview as a shared widget for
  exactly this reason. **Cost, corrected this round (P2-6/P3-11 — the original estimate of "one more
  `field()` call" was wrong: a bare `field()` insertion inside `battleSection`, `monster.js:282-291`,
  would be destroyed and rebuilt every time `monster.js`'s own `render()` calls `fill(...)`, the
  identical defect the widget's own persistent-host design exists to avoid for Magic):** the same
  persistent-host restructuring of `monster.js`'s own `body` §15.5 designs for Magic (splitting it
  into a replaceable fields host and a persistent preview host, created once at mount), one
  `mountBattleFxPreview` call passing Monster's own `getAnimationId` (`battle.attackAnim` on the
  selected actor) closure, `stepPreview` forwarded on Monster's own mount contract alongside its
  existing `destroy`/`onProjectChange`, no new stepper, no new trace test (the gate in §15.6 proves
  the engine contract once, not once per Forge that happens to call the same widget), and one more
  smoke-test step verifying the canvas mounts and steps there too. **Recommendation: yes, same
  phase.** §7 names only the Magic Forge because that is where the
  round-2 brief that seeded this whole family (`handoff-next/brief-battle-anim-design-2.md`) asked
  for it, not because the Monster Forge was considered and excluded — its own `attackAnim` field
  (monster.js:288) is authored through the identical `animationSelect` and answers the identical
  question ("what does this look like"), so shipping the widget in one Forge and not the other
  would be an arbitrary asymmetry, not a scope decision anyone made on purpose.
- **Should `animationSelect` itself (magic.js:49-60, monster.js:88-99, byte-for-byte duplicated)
  be deduplicated into the same shared module the preview widget lives in, in this phase?**
  Recommendation: **no, leave it alone this phase.** It is a real drift hazard — two copies of a
  stale-id/missing-option select with no test pinning them to agree — but it predates phase 3
  entirely (item 13/14 phase 3's own Magic/Monster Forge work introduced the duplication, not this
  slice), phase 3's own gate (§15.6) does not depend on it being fixed, and folding an unrelated
  cleanup into a UI-polish phase is exactly the kind of scope creep §9's own "explicitly out of
  scope" list exists to name. A future slice can move `animationSelect` beside the shared preview
  widget (§15.8) with no coupling to anything phase 3 ships.

**Chris answered both of the above on 2026-09-14** (recorded verbatim in §10's own new changelog
entry). Both match this document's own recommendation:

1. **Does the Monster Forge get the identical preview in phase 3? YES** — matches the
   recommendation. The Monster Forge ships the same persistent-host `mountBattleFxPreview` split as
   the Magic Forge, in this same phase, with no separate stepper or trace test of its own (§15.6's
   gate proves the engine contract once, not once per Forge).
2. **Deduplicate `animationSelect` into the shared widget module in this phase? NO** — matches the
   recommendation. It stays byte-for-byte duplicated in `magic.js`/`monster.js` for now; a future
   slice can move it beside the shared preview widget with no coupling to anything phase 3 ships.

### §16's own open questions

Round 1 (this document's own first draft of §16) wrongly treated one of the two questions below as
already settled by the code's own shape rather than putting it to Chris — corrected in review round
1 (P2 finding 1). Both were then put to him and answered on 2026-09-15 — recorded here verbatim,
per amendment round 1 (`handoff-next/brief-battle-anim-party-attack-design-amend1.md`):

- **Should a party member's own `attackAnim` also play when they cast a spell with no `spell.anim`
  of its own?** **Chris's answer, verbatim: "Just have the player walk forward then have the spell
  animation play."** This is **neither of the two options this document offered** — not (i)
  symmetric (attackAnim substituting for an unanimated spell) and not (ii) physical-only (no visual
  at all for an unanimated spell) — it replaces the whole FALLBACK CONCEPT with a THIRD mechanism: a
  party caster's own battle sprite steps forward toward the monsters, THEN the spell's own `anim`
  (if authored) plays with its existing §3.3 target/caster anchoring. **Both options (i) and (ii)
  above are superseded, not deleted** — kept as the historical record of what was proposed, since
  neither is what shipped.
- **A third copy of `animationSelect` (`character.js`), or fold all three Forges' own copies into
  the shared module now?** **Chris's answer, verbatim: "Dedupe all three now."** Supersedes this
  document's own "a third copy" recommendation (which matched his EARLIER 2026-09-14 decision not
  to dedupe Magic/Monster's pair — a different question, about only TWO consumers, that he has now
  decided differently for three). §16.8 is rewritten to design the shared module instead of a third
  copy.

**Amendment round 1 itself then raised two further questions — the physical-Attack-also-walks
question, and the unanimated-spell-default question — designed as real, costed options and put to
Chris with a recommendation each (recorded above at the time: spell-only, walk-alone). Chris
answered THREE more questions on 2026-09-15, fix round 1 (`handoff-next/brief-battle-anim-party-
attack-design-amend1-fix1.md`) — one of them the SAME question amendment round 1 already put to
him, decided the OTHER way from the recommendation; the other two are genuinely new. Recorded here
verbatim, each with what it supersedes:**

- **Is the walk gated (`project.rpg.castWalk`, opt-in) or always on for every RPG?** Neither option
  amendment round 1's own §16.6 offered was quite what shipped — that round costed and BUILT gating,
  recommending it "so existing ROMs stay byte-identical unless a strong reason exists." The reviewer
  (`handoff-next/battle-anim-party-attack-design-amend1-review1.md`, P2 finding 1) pushed back: the
  default-off toggle was "a product choice, not a technical necessity," and Chris's own original
  answer ("walk forward then the spell animation") named no opt-in condition. Put back to Chris with
  the reviewer's own three costed alternatives (always-on, implied-by-authored-content, explicit
  opt-in). **Chris's answer, verbatim: "Always on for RPGs."** No `project.rpg.castWalk` field, no
  Build Forge checkbox, no `PARTY_CAST_WALK_ENABLED`-shaped predicate on an authored flag — every RPG
  project's own battle bank carries the walk unconditionally, new and existing projects alike.
  **Supersedes amendment round 1's own gated design in full**: §16.6's own `PARTY_CAST_WALK_ENABLED`/
  `PARTY_CAST_WALK_BATTLE_ALLOWANCE` toggle design, the Build Forge checkbox paragraph in §16.8, and
  the schema/ledger machinery built for it are all superseded history now, not the shipped shape —
  marked as such in place (§16.6, §16.8), not deleted, the same "superseded, not deleted" policy
  this section already holds to. Chris explicitly accepted the consequence when asked: the
  `sample-rpg`/`sample-rpg-mmc1` fixture ROMs change, and their pinned hashes are deliberately
  re-pinned this round (§16.9).
- **Does a party member's own physical Attack also walk forward, or only a spell cast?**
  Amendment round 1's own recommendation (spell-only, matching Chris's literal words and genre
  convention) is **overturned. Chris's answer, verbatim: "Attacks walk too."** A party member's own
  physical Attack now walks forward before it resolves (and before its own `attackAnim` plays, when
  one is authored), the identical mechanism a spell cast already gets — `battle_target`'s own
  routing (§16.3b) no longer needs the `bt_cmd == BC_MAGIC` check that made FIGHT and MAGIC diverge,
  since both now walk identically; that check's removal was Amendment round 1's OWN "genuinely free
  to extend" costing turning out to be exactly right, now measured for real (§16.9).
- **What does an unanimated spell show: the walk alone, or the walk plus some default visual?**
  **Chris's answer, verbatim: "The walk alone."** Matches amendment round 1's own recommendation
  exactly — no project-wide default animation, no new catalog entry class, nothing beyond what
  `cast_spell`'s own suppressed fallback (§16.3) already shows. The reviewer's own P2-6 finding
  additionally corrected the REASONING behind that recommendation (not its conclusion): a default
  visual does not inherently need a whole new catalog-entry architecture the way amendment round 1's
  own prose overstated — an ordinary existing animation reference, reusing the EXISTING picker/
  reference machinery, was always a real, cheaper alternative; it was simply never the one Chris
  wanted. Recorded as history below, not repeated as a live architecture claim.

## §9. Out of scope, explicitly

- ~~Party-member attack animations of their own~~ — no longer out of scope: designed in full in §16
  (ROADMAP item 14 point 5), a deferral from §8's own 2026-09-13 answers, not a dismissal.
- Screen shake in battle (a separate, already-real field-side mechanism, untouched here).
- A per-element default visual — every visual here is per-spell/per-actor authored.
- Ambient idle-cycling for metasprite-fallback monsters (§2(d)).
- Phase 2's hit/miss feedback mechanisms (§2(e)) beyond costing and specifying their own arm point.
- A live, continuously-varying flipbook driven by battle state.
- A second, distinct hit-visual authored per actor, as opposed to the universal blink in §2(e).
- **The pre-existing overworld `anims`-to-metasprite frame hop** (`actor_anim_dir`'s own exposure,
  `main/build/generate.js:3602-3608`; `entity_animate`/`draw_one_entity`, `engine/entities.asm:
  492-616`) — real, but unrelated to and not worsened by this slice (§3.1).
- **Remapping a palette-swapped clone's own `attackAnim`** — an accepted limitation (§3.1, §8), not
  a bug this slice fixes.

## §10. Changelog

### Round 1 (`handoff-next/battle-anim-design-1-review1.md`) — 12 findings, all fixed

Recorded in the v2 document; carried forward unchanged.

### Round 2 (`handoff-next/battle-anim-design-2-review1.md`) — 1 P1, 6 P2, 1 P3, all eight fixed

1. Frame-to-metasprite "second hop" unclosed → `isPlayableBattleAnimation`, checked by validation,
   generator, and OAM budget alike (§3.1, §3.6).
2. Duplicated `MAX_OAM_ENTRIES` engine equate plus a runtime `adc` → dropped the equate; one
   generated `BATTLE_FX_OAM_ROOM`, compared directly (§3.3, §3.6).
3. Fit check's conservative-skip policy understated → stated explicitly (project-wide static bound,
   every tick, no partial visibility even with real formation room); paired with a second, distinct
   warning (§3.3, §3.6).
4. Excerpt indentation, "Preserves X" header errors, missing Y clobber, over-strong "always
   overwrites" claim, ".endif" placement → all corrected; caller invariant documented in place of
   the deleted claim (§1, §3.3).
5. Duplicated validity rule, sentinel ceiling not independent of catalog length → one exported
   `isValidAnimationRef`; over-cap catalog refusal added; `renumberAnimationDeletion`'s own
   pre-splice-only contract stated and enforced (§3.1).
6. Stale split/background-row prose, unreviewable 50/72-byte claims, stale Appendix A comments →
   prose corrected without retraction-in-parens; Appendix B and Appendix C added with real diffs;
   `attack_target`/spell-normalizer comments fixed (§0, §2, Appendix A/B/C).
7. Duration-255 test could not actually observe 255 ticks in a normal battle → isolated-routine test
   plus a separate message-cap test; duration 2, multi-frame, and post-arm dispatch-integrity tests
   added (§6).
8. Intro/outcome lifecycle prose overstated; traversal scope overstated → corrected to "setup OR
   message dismissal," "tick precedes dispatch, draw follows it (safely)"; traversal restated as a
   location authority, not a universal reader; palette-swap sharing and `battle.drop`'s own severity
   both corrected (§0, §3.1, §5, §8, §9).

### Round 3 (`handoff-next/battle-anim-design-3-review1.md`) — 1 P2, 4 P3, all five fixed

1. **P2 — Appendix C's attribute flash never counted down.** `bt_hurt_left` was loaded and stored
   but never `dec`remented, so `20 & 2 = 0` picked the authored tint every tick and the flash branch
   was dead code — it re-queued the original attribute forever, a real behavioural bug in the
   prototype the 72-byte figure priced, not merely an unmeasured detail. Fixed: the countdown now
   actually runs, unconditionally, whether the current target is a party member or a monster (a
   second, related gap — round 3's own version also skipped the decrement entirely for a party
   target); the terminal tick forces a restoration write regardless of blink parity. Re-measured at
   76 bytes (up from the broken 72), pinned with a real trace (at least one changed attribute byte,
   the restoration, cessation of packets afterward) rather than re-derived from the corrected
   instruction list alone. The stale "edge-only is cheaper in packets but not code size" sentence is
   removed; §11 now says the edge-only shape specifically was not built, not "neither" (§2(e),
   Appendix C, §11).
2. Two mechanical residues: the setup excerpt's own column-zero `.if`/instructions indented to match
   Appendix A's real convention; the stale "Preserves X" header on `battle_fx_arm_at` fixed in the
   prototype file itself, then Appendix A refreshed from the real diff (§3.3, Appendix A).
3. The blanket "makes any real project safe from OAM corruption regardless of whether the warning is
   heeded" sentence — replaced with the bounded admission guarantee already stated correctly
   elsewhere, no qualifier appended after it (§3.6).
4. Precision: the animation-catalog-cap diagnostic now runs first in `validateProject`, with all
   three diagnostics collected (no early return) — confirmed directly, a 256-entry catalog with a
   `255` reference reports both errors, in that order; the normalizers are now stated to *preserve*
   an imported `255` rather than merely "never write" one, distinct from the pickers never
   *authoring* one; §6's cap test corrected to a duration-255 animation under a **normal** 45-tick
   message hold (not the self-contradictory "shorter-than-`MSG_HOLD`... at duration 255"); the
   deletion test's "reference into an over-cap catalog" now means an invalid id specifically — a
   valid, in-range id in that same catalog still shifts normally; the palette-swap citation corrected
   to the real tree's `shared/project.js:3954-3958` (§3.1, §6).
5. Phase-2 prototype limitations recorded beside Appendices B/C and in §2(e): B's two-tick blink
   cadence, both prototypes arming from every `apply_damage` and keeping only the last target, no
   battle-entry reset in either, C's missing `mon_tile != $FF` guard, C's single byte covering only
   the anchored 4×4 cell rather than a larger authored block — explicitly phase-2 design inputs, not
   phase-1 work (§2(e)).

### Round 4 (GO-with-nits) (`handoff-next/battle-anim-design-4-review1.md`) — 2 P3, both fixed

Distinguished what the PPU trace proves (flashing, restoration) from what source inspection proves
(cessation of packets); relabelled the trace's tick/call numbering consistently (§2(e)); added a
one-line "Prototype limitations: see §2(e)" cross-reference to each of Appendix B's and Appendix C's
own introductions, without duplicating the list.

### Phase 2 round 1 (2026-09-13) — Chris's own answers, and the shippable design they authorize

Phases 1a (`b65144a`) and 1b (`c4e67c8`) shipped. Chris then answered §7's own open phase-2
question and one new requirement, both recorded here verbatim as the brief that authorized v5:

1. **The two hit halves ship together**, sharing one `bt_hurt_slot`/`bt_hurt_left` pair: the sprite
   hit-blink (Appendix B) for party icons and metasprite-drawn monsters, and the block-art
   attribute flash (Appendix C) for block-art monsters.
2. **The attribute flash is a BLINK**, emitted as a packet every tick while armed — the measured
   Appendix C shape. Not edge-only, not a solid tint.
3. **NEW: when an attack misses, the text MISS must appear next to the monster or party sprite that
   was missed.**

§12 turns (1) and (2) into a shippable design, fixing every §2(e) prototype limitation. §13 is the
new MISS design. Appendix D is the real, measured, complete prototype diff for both together — see
§12.7 for the measured figures and how they were obtained (a `git worktree add --detach` scratch
copy of the tree at this commit, `buildProject` against `sample-rpg` on all three RPG-capable
boards, then removed; the main tree and `git worktree list` were both checked clean afterward).

### Phase 2 round 2 — review round 1 (`handoff-next/battle-anim-phase2-design-review1.md`), verdict
FIX: 1 P1, 5 P2, 3 P3, all nine fixed

1. **P1 — `battle_hurt_attr_open` corrupted `cast_all`'s own end-of-side sentinel** (`bt_tmp2`).
   Fixed by removing the scratch-byte parking entirely — the attribute address is a pure function of
   the monster slot (`X`), which survives the whole call untouched, so callers needing the actor id
   just re-read `mon_slot_actor,x` themselves (§12.3).
2. **P2 — a killing hit during a flash could permanently strand the tint**, since `wipe_monster`
   rewrites tiles only, never the attribute byte. Fixed on two paths (the tick routine's own
   dead-check, and the arm-time restore when a different target supersedes the shared pair first),
   both restoring `BT_GROUND_ATTR` ($55, `draw_battle_attr`'s own ground-row fill), never the dead
   monster's own now-meaningless `mon_attr` (§12.3, §12.5).
3. **P2 — the `vram_buf` bound omitted re-arm restoration packets.** Recomputed: up to 5 packets/20
   bytes in the worst reachable tick (an all-target spell's own volley), not "at most one" — a real
   reachable schedule of 112 bytes and a fully conservative combination of 143 bytes, both well
   inside the 256-byte buffer (§12.6).
4. **P2 — MISS's fixed OAM charge was not protected against pre-existing combatant overflow.**
   Specified as an explicitly accepted limitation, matching §3.6's own established precedent for the
   flipbook's combatant/cursor figure exactly — not a new runtime check or a stricter refusal (§13.6).
5. **P2 — the sprite reservation had no single JS authority and two UI consumers were not
   range-aware.** Redesigned to mirror `SPRITE_ARROW_TILE`'s own precedent exactly: one JS authority
   in `shared/font.js`, engine equates generated from it, and both `validateProject`'s
   occupied-artwork message and the Tile Forge's shading hint made range-aware instead of assuming
   every non-heart reservation is the cursor (§13.5).
6. **P2 — the sole-miss test row was not an executable regression oracle**, and the exclusions it
   implicitly relied on were never stated. Replaced with real attack-path coverage (controlled hits
   and misses through both real call sites), explicit non-miss negative coverage (item/flee/spell/
   status), and a hit-flash trace proving both cadence bands, terminal restoration, and cessation
   (§13.1, §14).
7. **P3 — the new tick helpers ran before `setup_monsters` reset them during `BP_INTRO`.** Both
   gained the identical guard `battle_fx_tick` already has; `battle_end`/`player_died`'s own timer
   lifetime (never cleared there, same as `bt_fx_anim`) is now stated accurately rather than assumed
   safe (§12.4).
8. **P3 — the 2-byte measurement gap was speculative.** Identified exactly: one shared `lda #0` in
   `setup_monsters` between the two stores, needed independently by each isolated variant. The
   `bt_miss_slot` re-chaining an isolated-MISS build needs is now documented (§11, §12.7, §13.2).
9. **P3 — the cadence prose contradicted the code.** Corrected to the real two-tick-band shape (a
   packet every tick, a colour change every other tick), not single-tick alternation (§12.1).

Also fixed: §2(e)'s own stale "unmeasured saving" claim (now points at the real 235-byte measured
figure, and corrects the direction of the comparison — MORE than the naive 126-byte sum, not less);
§7's over-attribution of one-phase shipping to Chris (only the two hit halves are his own decision;
shipping MISS in the same phase is this document's recommendation, restated as still-open in §8);
and §8's gating options now each state their own fixture/test consequence explicitly. Every prototype
figure in §12.7/§13.6/Appendix D was rebuilt and remeasured against the round-1-fixed code, not
patched onto the old numbers.

### Phase 2 round 3 — review round 2 (`handoff-next/battle-anim-phase2-design-review2.md`), verdict
FIX: 5 P2, 2 P3, all seven fixed; round-1 engine fixes independently reconfirmed (367/235/134)

Documentation and test-plan only — no engine code changed, so Appendix D is untouched this round
(all three figures independently reconfirmed by the reviewer's own rebuild).

1. **P2 — the "reachable" vram_buf schedule combined the wrong two chains, and a larger real one
   exists.** `cast_all` ends by calling `battle_say_actor` directly (28 bytes: a 13-byte name packet
   plus a 15-byte string packet) — it never reaches the 92-byte `battle_message_done` →
   status-tick → `battle_say` chain, which only runs on a LATER tick, when a previous message is
   dismissed. Corrected reachable total for that path: 48 bytes (20 feedback + 28 message), not 112.
   A genuinely larger reachable schedule was found by driving real dispatcher transitions: 127 bytes
   (11-byte wipe + 4-byte flash + 112-byte `battle_list_back`, via a six-tick sequence). The existing
   143-byte conservative bound still safely covers both — this was a reachability/accounting error,
   not a newly discovered overflow (§12.6). The queue-length test was rewritten to stop requesting a
   5th block-art monster (above `MAX_MONSTERS = 4`) and to cover both the 20-byte and 127-byte real
   schedules (§14).
2. **P2 — the OAM policy claimed MISS "does not make overflow worse," which is false for the
   61-64-combatant range** (65-68 once MISS's own 4 tiles are added — a NEW overflow MISS itself
   causes, not merely alongside a pre-existing one). Restated honestly: the advisory-warning POLICY
   is unchanged (still the explicit, accepted choice), but the claim about what MISS causes is
   corrected. The test's own 64-combatant row was wrong (64 without MISS does NOT warn — `used >
   limit` is strict, and 64 is exactly the limit); rebuilt with a genuine 60/61/64/65 boundary,
   asserted through `validateProject`'s own warning array, not `describeBattleSpriteWarning` (an
   unconditional formatter, not a gate) (§13.6, §14).
3. **P2 — `describeBattleAnimationOamWarning` never accounted for MISS's own 4 entries in its own
   text**, so its stated reasoning stopped adding up the moment MISS was what pushed a project over
   (reproduced: 60 combatants + a 1-tile animation = 61, which does not itself exceed 64 — MISS's
   own 4 is the missing term). Fixed to add a MISS clause to the same explanation, gated on
   `projectUsesHitMiss`, with the off-path (MISS disabled) text unchanged (§13.6, §14).
4. **P2 — the sentinel test asked to observe `bt_tmp2` after `cast_all` returns**, which is the
   wrong moment: `battle_say_actor`'s own name lookup legitimately reuses `bt_tmp2` as scratch once
   the loop has finished, reading 0 by design. Corrected to observe at `cast_all_next`, immediately
   after each `apply_damage` call, with both a low (0) and a high (31) actor id (§14).
5. **P2 — replacing the combined OAM boundary test with the no-flipbook row lost the oracle for the
   simultaneous flipbook+MISS reservation.** The no-flipbook row cannot catch a `BATTLE_FX_OAM_ROOM`
   formula missing its own `- MISS_OAM_TILES` term. Restored the exact-fit/one-over boundary test
   (combatants + effect + MISS = 64, admitted; +1, the whole frame rejected) IN ADDITION to the new
   advisory-overflow row, not instead of it. Also added the missing §13.5 reservation on/off
   integration rows (occupied-artwork refusal wording, blank referenced tiles, Tile Forge hint and
   shading, glyph stamping in every tileset on each board) round 1's own finding 5 designed but never
   got test coverage for (§14).
6. **P3 — the item-failure explanation said the item "is simply spent on nothing."** Wrong:
   `item_chosen`'s own `beq item_chosen_none` branches around `remove_item` before it ever runs, so
   the item is never consumed at all, only the message differs. Fixed in §13.1.
7. **P3 — §11 still compared the old 50+76=126 estimate against 367 (which includes MISS), not
   235 (hit-only, the actual comparable scope).** Already fixed correctly in §2(e) from round 1;
   §11's own bullet had the stale comparison and is now aligned with it. Also fixed the "BP_INTRO
   guard (2 routines)" attribution in §12.7's own hit-only paragraph — that variant contains only
   `battle_hurt_tick`'s own guard; `battle_miss_tick`'s guard belongs to MISS-only's own +6, since
   the hit-only variant has no MISS code at all.

Also acted on the review's own remaining note: the hit-flash trace test row (§14) now requires a
direct `vram_buf` queue observation for cessation past the terminal tick, not source inspection
alone.

### Phase 2 answers round (2026-09-14) — v5.1, Chris's own §8 answers recorded

`docs/design-battle-animation.md` v5 (`f071d8d`, reviewer GO) left four questions open in §8's own
"Phase 2's own open questions" passage (three bulleted there, one raised in §7's prose). Chris
answered all four on 2026-09-14, recorded verbatim:

1. Gating: option (B), a new authored project toggle. Not always-on, not piggybacked.
2. TWO independent toggles: one for hit feedback (the sprite hit-blink plus the block-art attribute
   flash, together), one for MISS. Not one shared toggle.
3. Phasing: hit feedback ships FIRST as its own phase; MISS ships AFTER as a separate phase.
   Not one phase.
4. MISS art, timing and placement: ship the v5 values ($FA-$FC sprite tiles, `BT_MISS_FRAMES = 30`,
   8 px above the combatant, cleared by message dismissal) as starting values, tune after playtest.

Answers 1 and 4 match this document's own recommendations; answers 2 and 3 do not, and are real
design changes, not a note — every `projectUsesHitMiss`/`HIT_MISS_ENABLED`/`HIT_MISS_BATTLE_
ALLOWANCE` reference in v5 named a single combined toggle/flag/term, superseded here by two
independent ones (`hitFeedback`/`HIT_FEEDBACK_ENABLED`/`HIT_FEEDBACK_BATTLE_ALLOWANCE` and
`miss`/`MISS_ENABLED`/`MISS_BATTLE_ALLOWANCE`, §12.7/§13.9), and every "one phase" framing in v5's §7
is superseded by an explicit 2a (hit feedback) / 2b (MISS) split, in that release order. Changed:

- **§7** rewritten around the 2a/2b split: what each phase gates, ships, and stays ROM-neutral on;
  the one real dependency 2b has on 2a (the `bt_miss_slot = bt_hurt_left+1` RAM chain, which the
  chosen ship order needs no rework of); confirmation that equates stay unconditional so the chain
  and every toggle combination (including MISS alone) work with no special case; a table of all four
  legal toggle combinations and their ledger cost.
- **§8** marks all four questions answered, keeping the three original bulleted recommendations (and
  a note about the fourth, unbulleted one) as history.
- **§12.7** renamed from the single combined predicate/flag/term to `project.rpg.hitFeedback` /
  `projectUsesHitFeedback` / `HIT_FEEDBACK_ENABLED` / `HIT_FEEDBACK_BATTLE_ALLOWANCE = 235`, with a
  new Schema passage (field, default, `normalizeRpg`, UI location) and a `bankedFeatures` entry for
  `battleShortfallAdvice`.
- **§13.2** corrected: the prior "or a future project that ships MISS without hit feedback... must
  be re-chained... or the build fails outright" sentence conflated the isolated-measurement variant
  (equate lines hand-deleted) with a real toggle-gated project (equate lines always present, only the
  surrounding code gated) — the real case needs no re-chaining at all. See §7's own corrected
  treatment.
- **§13.5/§13.6** renamed `projectUsesHitMiss`/`HIT_MISS_ENABLED` to `projectUsesMiss`/`MISS_ENABLED`
  throughout — the MISS-only gate these sections' own reservation, stamping, OAM terms and warning
  text always belonged to, never hit feedback's.
- **New §13.9** ("Gating and the ledger," MISS's own, mirroring §12.7's shape): `project.rpg.miss` /
  `projectUsesMiss` / `MISS_ENABLED` / `MISS_BATTLE_ALLOWANCE = 134`, Schema passage, a
  `battleShortfallAdvice` entry, and the ledger decision below.
- **Ledger decision**: with two independent gates, `setup_monsters`' own shared `lda #0` (the exact
  2-byte gap §11's own bullet already identifies between 235+134=369 and Appendix D's measured 367)
  cannot be kept as a single unconditional load once either half can be off while the other is on —
  it must itself be gated somehow. Decided: **separate the two resets under their own `.if` blocks**
  (each pays its own `lda #0`/`sta`, 235 and 134 stay exactly as measured, and the combined figure
  becomes a clean sum, 369) rather than keep one shared load behind a negative interaction term
  (`STING_SFX_INTERACTION_ALLOWANCE`, `main/build/generate.js:1075`, is this codebase's only
  interaction-term precedent, and it is positive — real glue code that only exists when both features
  are live, not a hand-tuned micro-optimization's accounting artifact). See §13.9 for the full
  reasoning; §12.7's own combined-figure cross-reference and Appendix D's own intro prose (outside
  its frozen fence) are both corrected to state that a real two-gate implementation pays 369 for
  "both on," not the single-build prototype's 367, and that the implementation phases must re-measure
  `HIT_FEEDBACK_BATTLE_ALLOWANCE`/`MISS_BATTLE_ALLOWANCE`/the combined total with
  `bankedbytes.test.js` equality assertions on MMC1, MMC3 and UNROM 512, including the both-on case.
- **§14** rows assigned to phase 2a or 2b; the off-path/ledger rows rewritten into four rows — one
  per toggle combination (neither, hit-feedback alone, MISS alone, both) — each asserting ROM
  neutrality or the correct ledger delta AND that the flag NOT under test leaked no bytes of its own
  code into the build (a cross-gating leak: e.g. MISS alone must not silently pull in any
  `bt_hurt_*`-touching code, and vice versa).
- Appendix D's fenced diff is untouched (still the single, unconditional, no-`.if` measurement
  build); a new paragraph before the fence explains it must now be read as measuring the SUM of the
  two real allowances plus the shared-load saving the real implementation deliberately gives up, not
  as a preview of the real gated code's own combined byte count.

### Phase 2 design review, round 5 fixes (2026-09-14) — v5.1

Round 5 review (`handoff-next/battle-anim-phase2-design-review5.md`) found three issues in the
answers round above, all fixed here; no design decision changed, only its documentation.

1. **P2 — `projectUsesMiss` gated action projects into MISS reservation/stamping.** The
   round-5 review confirmed `spriteReservedRanges` is called by `validateProject`
   (`shared/project.js:6556`, `:6577`) BEFORE its `gameType === 'rpg'` block (`:6593`) and by the
   Tile Forge unconditionally (`renderer/forges/tile/tile.js:231`, `:410`) — so the prior claim that
   it has "battle-only callers" an action project could never reach was false, and a boolean-only
   `projectUsesMiss` would reserve $FA-$FC and stamp MISS art on an action project carrying
   `rpg.miss: true`. Fixed: `projectUsesMiss` now returns `project.project.gameType === 'rpg' &&
   Boolean(project.rpg?.miss)` (§13.5, §13.9, both copies of the snippet), with the reasoning
   rewritten in place of the old shared "battle-only callers" citation. `projectUsesHitFeedback` was
   judged NOT to need an equivalent change here, reasoning that its only battle-region consumer,
   `battleRegionBytes`, is unreachable from an action project since `codeRegions()` allocates that
   region only when `rpgCapable()` already holds — **a judgment round 6 found incomplete: see the
   round-6 entry below.** §14 gains a dedicated round-5 row proving an action project with `rpg.miss`
   true vs. false builds byte-identical, with no reservation and no refusal on painted `$FA` artwork.
2. **P2 — the phase-2a acceptance plan deferred §12.4's own initialization checks to `both`.** The
   BP_INTRO guard and battle-entry reset rows were tagged `both` outright, so a phase-2a brief built
   strictly from `2a`-tagged rows never got a runtime check that a stale hurt timer is actually
   ignored during `BP_INTRO`, or actually reset to 0 afterward — the cross-gating ledger rows check
   byte counts and code presence, not that behavior. Fixed: both rows split into a hurt-timer `2a`
   row, a MISS-timer `2b` row, and a lighter `both`-tagged integration row kept beside each pair; the
   six-fixture off-path identity row is likewise split into its own `2a` and `2b` rows instead of one
   `both` row. Message-cap asymmetry and the combined 369-byte ledger equality genuinely exercise an
   interaction between the two timers/allowances and stay tagged `both`, per the brief.
3. **P3 — Appendix D's own v5.1 note called 367 an "upper bound" on 369.** 367 is two bytes smaller
   than 369, so it cannot bound it from above; the direction was simply backwards. Fixed: reworded to
   "the frozen shared-load prototype measurement, two bytes below the selected independently-gated
   layout." Appendix D's own fenced diff is untouched.

### Phase 2 design review, round 6 nit (2026-09-14) — v5.1

Round 6 review (`handoff-next/battle-anim-phase2-design-review6.md`, verdict GO-with-nits) found one
P3: round 5's own reasoning for leaving `projectUsesHitFeedback` ungated by game type (§12.7,
changelog above) only checked `battleRegionBytes`, missing that `HIT_FEEDBACK_ENABLED` is also
generated into `config.inc` (§12.7's own "Generated flag and gates" passage), which
`main/build/generate.js` writes for every project (`:3168`, `:3172`) and `engine/main.asm:32`
includes unconditionally — action projects included. The reviewer reproduced an action project with
`rpg.hitFeedback: true` generating `HIT_FEEDBACK_ENABLED = 1`. No ROM or artwork consequence (the
gated routines all live in battle source an action build never assembles regardless of the config
flag), but the generated flag and this document's own claim about it were wrong.

Fixed: `projectUsesHitFeedback` now returns `project.project.gameType === 'rpg' &&
Boolean(project.rpg?.hitFeedback)`, the identical shape `projectUsesMiss` already took (§12.7's own
predicate and rationale, rewritten). §13.9's own comparison of the two predicates is corrected to
state the real, shared reason both are RPG-gated (both reach `config.inc`, which an action build
evaluates), rather than treating hit feedback as needing no check at all. §14 gains a phase-2a row
asserting an action project generates `HIT_FEEDBACK_ENABLED = 0` for either stored value of
`rpg.hitFeedback` and builds byte-identical ROMs either way. `normalizeRpg` stays non-destructive,
no new `validateProject` refusal is added, and `HIT_FEEDBACK_BATTLE_ALLOWANCE` (235) is unchanged —
this predicate's RPG-only battle-region consumer was never reachable from an action project either
way; only the generated config flag was.

### Phase 3 design round (2026-09-14)

`handoff-next/brief-battle-anim-phase3-design.md` briefed the last phase of this family: the Magic
Forge preview canvas §7 (v5, phase 1) already named but deferred to "a later phase" until a
frame-for-frame trace test existed first (§4). §15 is the resulting design, in full: the tick
contract as a table (§15.1); a new DOM-free stepper, `renderer/widgets/battlefx.js`, deliberately
not a parameterization of the Sprite Forge's own `advancePreviewFrame` (§15.2); a single-writer fix
this round found while tracing the OAM fit figure — `main/build/generate.js:2646-2649`'s own
`BATTLE_FX_OAM_ROOM` arithmetic has never lived in `shared/`, only its inputs have, so §15.3 moves
it into a new `battleFxOamRoom(project, mapper)` export the generator is changed to call, rather
than let the preview duplicate a four-line expression; wall-clock pacing at `NES_FPS`, matching the
emulator's own `tick()` rather than the Sprite Forge's display-rate stepping, because unlike the
Sprite Forge's authoring scrubber this preview's entire purpose is to show the engine's real timing
(§15.4); the concrete UI, including where a running preview's canvas has to live outside `fill()`'s
own rebuilt subtree so `onProjectChange` cannot tear it down mid-flipbook (§15.5); the golden-trace
gate itself, `sfx.test.js`'s own shape applied to `battle_fx_tick`/`battle_fx_draw` (§15.6); the
rest of the test plan (§15.7); the Monster Forge question, answered in §8 above (§15.8); the ledger
proof that phase 3 is renderer-only (§15.9); and what could go wrong (§15.10). No code was written
this round — `docs/design-battle-animation.md` is the only file this round touches, per the brief's
own scope rule.

### Phase 3 design review, round 1 (2026-09-14)

Round 1 review (`handoff-next/battle-anim-phase3-design-review1.md`, verdict FIX) found no P1, eight
P2 and three P3, all design-precision findings — none disputing the phasing, the gate-before-canvas
order, or the scope already settled in §7/§8/§9. `handoff-next/brief-battle-anim-phase3-design-
fix1.md` dispositioned all eleven; every disposition below was accepted as directed:

1. **P2-1, canonicalize inactive ROM state (§15.6).** Accepted. The gate now compares a
   canonicalized `{live, frame, timer, drawn}` triple on both sides — raw ROM bytes converted to
   `null` only when `live` is false, `drawn` read independently via OAM — rather than comparing raw
   ROM bytes against the JS stepper's own `null` directly, which would have rejected a correct
   stepper at every termination (the ROM leaves `bt_fx_frame` at the frame count and `bt_fx_timer`
   at `0`, never `null`, after a natural end). `timer` is now compared on every live observation,
   not "where meaningful." The observation bound is now the fixture's own stated sum of authored
   durations (0 for empty/`NO_ANIM`), through bound + 2, never derived from the stepper under test.
2. **P2-2, `NO_ANIM` arming is a no-op on a live effect, not a clear (§15.1, §15.2, §15.6).**
   Accepted, per the disposition's own decision: `armBattleFx` is documented as restricted to
   fresh-preview construction, with selecting `None` stated as a separate UI clear policy (§15.5)
   outside the engine arming contract. The trace test's `NO_ANIM` case now genuinely calls
   `battle_fx_arm_at` with `A = NO_ANIM` on a clean, seeded state ("or skip arming entirely"
   removed). Two new ROM-only cases pin the real arm-over-live-effect behaviour directly, without
   claiming stepper equivalence for either.
3. **P2-3, the draw answer for a zero-tile metasprite, and top-level-only validity (§15.1, §15.2,
   §15.5, §15.6).** Accepted, both halves. `drawnBattleFx` now answers "nothing drawn" explicitly
   for a zero-tile frame (`draw_metasprite` itself returns at once for `ms_count == 0`), with a new
   trace case pinning it. The widget's own arm guard now checks `isPlayableBattleAnimation` (the
   same two-hop predicate the generator's own `validAnimId` uses), not the shallower
   `isValidAnimationRef` — an animation whose frames reference a missing metasprite is treated the
   same as `None`, with its own explanation string. The stepper's documented input contract is now
   explicitly the *normalized* animation (every frame's own duration always present).
4. **P2-4, pacing cannot be driven or verified (§15.2, §15.4, §15.7).** Accepted. A new, named,
   DOM-free `createBattleFxPacer` (beside the stepper in `battlefx.js`) replaces the original draft's
   unspecified in-DOM timing arithmetic — `advanceTo(now)` returns whole ticks owed, `reset()`
   zeroes debt on every fresh arm/Replay, no first-callback credit (this preview has already painted
   observation 0, unlike the emulator `player.js:209`'s own credit models), a 4-tick cap. `stepPreview()`
   stays exactly one synchronous model tick, independent of the pacer entirely. Four new unit tests
   (§15.7) drive it with injected timestamps, no real clock.
5. **P2-5, fixed zoom and unproven viewport (§15.5, §15.7, §15.10).** Accepted. The claim that
   sixteen tiles proved spatial bounds is deleted — false, since tile offsets independently clamp to
   `-128..127`. The preview now computes a per-animation logical viewport from the union of every
   frame's own tile extents, sizes its stage with `fitZoom`/`observeSize` (with disposal in
   `destroy()`), and crops with a labeled caption when the bounds still exceed the stage at `zoom =
   1`. `drawMetaspritePreview`'s own sizing interface is widened with backward-compatible defaults
   so `character.js:72` is unchanged. A resize smoke check and an `x = 64` offset-art case are added.
6. **P2-6, the widget API is incomplete (§15.5, §15.8, §15.10).** Accepted. The full interface —
   `mountBattleFxPreview(host, {getProject, getAnimationId}) -> {sync, stepPreview, destroy}` — is
   specified, with `sync()` resolving the id to the current animation object *before* any identity
   comparison (the original draft compared a raw id against an object, which could never match), and
   refreshing room/tiles/palettes on every call regardless of whether the armed object's own
   identity changed (an `undo()` replaces the whole project via `structuredClone`, `renderer/
   store.js:233-241`, while `commit()` mutates in place, `:180-196`). Both Forges' own call sites are
   specified concretely: a persistent fields-host/preview-host split inside each Forge's own single
   `panel-body`, not a `field()` row rebuilt on every render (the original draft's own mistake for
   Monster specifically).
7. **P2-7, the ROM-neutrality matrix (§15.7, §15.9, §15.10).** Accepted. The acceptance proof is now
   an explicit board × configuration matrix — `sample-rpg` on MMC1, MMC3 and UNROM 512, each with
   flipbook-alone and flipbook+hit-feedback+MISS-together configurations, baselines held fixed from a
   clean `227ccb1` worktree, compared by both whole-ROM SHA-256 and the `BATTLE_FX_OAM_ROOM` equate —
   rather than the six untouched fixtures alone, which never reach the battle region and so cannot
   exercise the mapper-dependent cursor term or the MISS term the moved arithmetic actually varies on.
8. **P2-8, frozen terminal pixels and undefined skip behaviour (§15.1, §15.5, §15.7, §15.10).**
   Accepted, per the disposition's own decision: the canvas now **clears** on termination, matching
   the engine's own no-draw answer exactly — §15.1's table now has only one divergence from the
   engine (`BP_INTRO`), not two. A skipped (oversized or zero-tile) frame also clears the canvas for
   that tick specifically. The smoke fixture is now concrete: two frames with distinct visible art,
   known durations, fitting tile counts, asserted at observation 0, the frame boundary, termination,
   two ticks past termination, and after Replay — plus a fitting-then-oversized-then-end case so a
   skip cannot be mistaken for stale-but-stable pixels.
9. **P3-9, the parameterization argument overstated (§15.2).** Accepted, reword only, decision
   unchanged. The "not `advancePreviewFrame`" reasoning now states three costs (re-proving two
   pinned smoke assertions, `advancePreviewFrame` never reading `loop` today, low code-reduction
   relative to the risk) rather than claiming a shared transition was technically impossible — it
   is not; a `{frame, time, ended, changed}` shape is sketched explicitly as what a shared version
   could look like, and rejected on cost grounds instead.
10. **P3-10, fixture signatures and construction (§15.6).** Accepted. A real defect in the original
    draft's own citation is corrected, not merely reworded: `ExactFit` and `OneOver`
    (`rpg.test.js:6023`, `:6032`) both start their own tile range at `150`, and `Sequence`'s three
    frames (`:5747-5750`) all use metasprite `1` — the "every metasprite has a distinct signature"
    claim was false as written. The trace test now specifies one fixture builder (extending
    `buildFxFitFixture`'s own shape) authoring every frame's duration explicitly and assigning every
    admitted metasprite its own disjoint tile-id block. The existing `ExactFit`/`OneOver` pair is
    kept as the exact-room/room+1 boundary case, its own collision fixed. The never-ending-255
    wrong-implementation row is corrected: first divergence at observation 255, not 256.
11. **P3-11, §8 and §15.8 disagreed on which scope question is pending (§8, §15.8).** Accepted, per
    the disposition's own decision: both the Monster Forge adoption question and the
    `animationSelect` deduplication question stay open for Chris in §8, consistently, each with its
    own unchanged recommendation (yes; no) — §15.8 no longer declares one of them settled on its own.
    The Monster Forge's own scope estimate (§8, §15.8) now includes the persistent-host split and
    `stepPreview` forwarding, not only one field and a smoke step.

The review's own "Checks that hold" list (the post-increment compare, the single-frame hold, the
ignored `loop` flag, the per-draw (not per-arm) fit check, the observation-0 finding itself, the
`BP_INTRO` omission's own reasoning, the golden-trace direction, the extraction's own formula, and
the gate-before-canvas phasing) is left as confirmed and unchanged, per the disposition's own
instruction not to re-argue it — except where a finding above corrected what it was confirming
(the `BP_INTRO`-is-the-only-divergence framing, corrected by P2-8's fix to the terminal-pixels row
it was never checking in the first place).

### Phase 3 design review, round 2 (2026-09-14)

Round 2 review (`handoff-next/battle-anim-phase3-design-review2.md`, verdict FIX) found no P1, five
P2 and three P3 — six of round 1's own eleven fixes it called fully resolved (P2-1, P2-2, P2-7,
P2-8, P3-11, and P2-6's structural half), five partly resolved, each gap becoming one of the eight
findings below. `handoff-next/brief-battle-anim-phase3-design-fix2.md` dispositioned all eight;
every disposition was accepted as directed:

1. **P2-1, rectangular viewport needs a compositor change (§15.5, §15.7, §15.9).** Accepted. The
   round-1 draft's claim that `paintMetasprite` "needs no change at all" was false — its own clip
   test compares `py` against `width`, never a separate `height` (`renderer/widgets/
   metasprite.js:24`), confirmed by a direct read-only probe (an 8×72 buffer with a tile at `y = 64`
   painting zero opaque pixels). `paintMetasprite` gains a new, trailing, optional `height`
   parameter defaulting to `width`, so both existing call sites stay byte-for-byte unchanged;
   `drawMetaspritePreview`'s own widened interface passes it through. `originX = -minX`/`originY =
   -minY` and a named `64 × 64` blank fallback for an all-zero-tile union are now specified
   explicitly. Four new compositor test cases (tall, wide, negative-offset, all-zero-tile) added.
2. **P2-2, identity-only sync can retain stale state (§15.5, §15.7, §15.10).** Accepted. `sync()` is
   rewritten as explicit transitions comparing a content SIGNATURE (`(metaspriteId, duration)` per
   frame) rather than an object reference — the round-1 draft's own identity-only check missed both
   an in-place duration edit (`sprite.js:607`) and an in-place frame deletion (`.frames.splice`,
   `:618`), either of which leaves the animation OBJECT's own reference unchanged while its content
   changes underneath a running stepper, reaching an unhandled `tickBattleFx` destructure of
   `undefined`. §15.10's own "undo-vs-commit" entry had the cause backwards — `undo()`'s whole-project
   replacement always changes the reference and so was never the gap; in-place `commit()` edits are —
   corrected and renamed. Four new `sync()` test cases added (frame-deleted-during-playback,
   duration edit, in-place art movement, A→None→A).
3. **P2-3, empty animations fall through to Replay (§15.5, §15.7).** Accepted. `sync()` gained its
   own explicit branch for `frames.length === 0` (which `isPlayableBattleAnimation` deliberately
   still calls playable) — cleared canvas, disabled control, "This animation has no frames.", never
   describable as a completed pass — distinct from a non-empty animation whose frames are all
   zero-tile metasprites, which stays live and times normally. New control test added.
4. **P2-4, the pacer's origin is never established at arm time (§15.4, §15.5, §15.7).** Accepted.
   The arm sequence is now stated exactly: reset → arm → paint observation 0 → an explicit
   `advanceTo(now())` call at that same instant (establishing the origin immediately, not waiting
   for whatever `requestAnimationFrame` callback happens to run next) → schedule callbacks in that
   same time domain. Cadence tests now use common endpoints and exact totals (60 ticks for both a 60
   Hz and a 120 Hz sequence), not a one-tick tolerance; the reset test is strengthened with a
   second, fractional-boundary post-reset call that a `reset()` forgetting to zero `owed` (while
   still clearing `lastTime`) could not pass. Smoke assertions are now stated to run synchronously
   within one browser evaluation, so no scheduled callback can interleave with them.
5. **P2-5, the fixture imports private normalization functions (§15.6).** Accepted.
   `normalizeAnimation`/`normalizeMetasprite` are confirmed NOT exported (bare `function`s,
   `shared/project.js:5138`, `:5203`); the fixture builder now calls the exported
   `normalizeProject(project)` once, explicitly, before building, and uses that SAME returned,
   normalized project for both the ROM build and the JS trace's own data — one normalization
   boundary, never two independently-normalized copies. `buildVariantFull`'s own no-reload behavior
   and `generate.js`'s own deliberate non-normalization on every build are both stated as the reason
   this step is required, not redundant. The exact-room/room+1 relationship is re-tuned against
   `LIMITS.metaspriteTiles = 16`'s own slice (`shared/project.js:5143`) — the filler formation must
   keep `room ≤ 14` so `OneOver`'s own `room + 1` tiles survive normalization intact, with the
   fallback stated for if that relationship cannot be held.
6. **P3-6, the zero-tile explanation reverses the engine's call order (§15.1, §15.2, §15.6, §15.10).**
   Accepted. Every occurrence corrected to state the true order: `battle_fx_draw`'s own room compare
   (`engine/battleui.asm:1059-1061`) runs and PASSES for a zero-tile frame (0 is never greater than
   room), falling through to the tail call into `draw_metasprite` (`:1092-1093`), whose own separate,
   LATER `ms_count == 0` return (`engine/entities.asm:621-624`) is what actually stops the draw — not
   the room compare, which several passages had wrongly said "never runs" for this case. Code and
   golden answer unchanged; this was a prose-only defect.
7. **P3-7, one parameterization argument asserts an unnecessary behavior change (§15.2).** Accepted.
   The claim that a shared, parameterized transition would force the Sprite Forge to start reading
   `animation.loop` is removed — an explicit wrap option with the Sprite Forge's own adapter passing
   `true` at both call sites preserves `sprite.js:1223-1231`'s own unconditional wrapping exactly,
   with no behavior change at all. The separate-module decision stands on its remaining two costs
   (verification cost, low code-reduction-versus-risk) alone.
8. **P3-8, §7 still names the six-fixture-only proof (§7, §15.7, §15.9).** Accepted. §7's own phase-3
   paragraph now points at §15.7's complete board × live-feature matrix as the acceptance proof, not
   the bare six-fixture hash gate. §15.9's own "never reach the battle region" claim is corrected —
   two of the six fixtures (`sample-rpg`, `sample-rpg-mmc1`) ARE real RPGs with real battle code
   (`test/unit/nameentry.test.js:95-101`); the real, narrower distinction is that none of the six
   authors a LIVE battle animation reference, which is what actually matters for exercising the
   moved arithmetic. Gate-before-canvas order unchanged.

The review's own "Confirmed portions and review limits" section is left unchanged except where a
finding above corrected what it was confirming; its own two added constraints — Monster's existing
`destroyed = true` assignment must be kept alongside the widget's own `destroy()` call, and crop
detection must use `fitZoom`'s own padding-subtracted content box — are folded into §15.5 in one
sentence each, per its own instruction.

### Phase 3 design review, round 3 (2026-09-14)

Round 3 review (`handoff-next/battle-anim-phase3-design-review3.md`, verdict FIX) found no P1, three
P2 and one P3 — five of round 2's own eight fixes it called fully resolved (P2-3, P3-6, P3-7, P3-8,
and P2-1's own structural half), three partly resolved, each gap becoming one of the four findings
below. `handoff-next/brief-battle-anim-phase3-design-fix3.md` dispositioned all four; every
disposition was accepted as directed:

1. **P2-1, `sync()` paints before its own bounds/resources are ready (§15.5, §15.7).** Accepted.
   Step 3's own four sub-steps are reordered: read/validate and compute the signature AND fresh
   art/room/bounds/origin/zoom together, THEN reconcile/re-arm state, THEN paint exactly once with
   those fresh inputs, THEN (only if re-armed) establish the pacer origin and schedule. A new
   paragraph explains why `observeSize` cannot repair a stale paint after the fact — it watches the
   stage's own border box, which an in-place art move does not itself change, and which this design's
   own persistent-stage rule deliberately keeps independent of the art being shown. §15.7's own
   `sync()` test row gained two new cases (first mount, in-place art movement while playback is
   finished) and now states every assertion runs immediately when `sync()` returns, with no `rAF` and
   no `ResizeObserver` involved.
2. **P2-2, the arm-time explanation was backwards, and no test could reject an omitted call
   (§15.4, §15.5, §15.7, §15.10).** Accepted, both halves. The explanation is corrected throughout
   (§15.4's own arm-sequence passage, §15.10's display-rate entry): omitting the arm-time
   `advanceTo(now())` call DISCARDS the elapsed interval before the first real scheduled callback
   (that callback becomes the pacer's own "first call, no credit" case instead), it does not credit
   phantom ticks — the previous text had the direction of the failure exactly backwards. The widget's
   own mount options gain an injectable `{ now, schedule }` pair, defaulting to `performance.now`/
   `requestAnimationFrame`, and §15.7 gained a new widget-level integration test arming at `t=0` and
   invoking the first scheduled callback at `t=1000` with a fake clock, asserting exactly four ticks
   — the one test in this plan that actually exercises the mounted arm-and-scheduled-tick path rather
   than the pacer's own arithmetic or `stepPreview()`'s own pacer-bypassing shortcut.
3. **P2-3, the normalized fixture does not preserve every claimed count (§15.6, §15.11).** Accepted,
   per the disposition's own decision. The fixture's four filler icons are retuned from 12 to 13
   tiles each, giving room `4`/`3`/`4` on MMC1/MMC3/UNROM 512 — inside a tightened `3 <= room <= 6`
   sanity bound that preserves BOTH `OneOver` (`room + 1`) and `Oversized` (`room + 10`, `14`/`13`/
   `14`) intact under the 16-tile normalization slice, plus an explicit post-normalization assertion
   that every fixture metasprite's own tile count is unchanged. "More filler combatants" is removed
   as a tuning lever — `battleFormationSlice` caps a formation at `RPG_LIMITS.monstersPerBattle = 4`
   unconditionally, and `battleCombatantOamMax` takes the MAX over formations, not a sum, so neither
   a fifth entry in the same formation nor a same-shaped separate one changes anything; raising each
   existing icon's own tile count is the only lever that works. The trace fixture is now stated to
   run MISS-off unconditionally — the same tuning with MISS on leaves the actual, clamped room `0`
   on every board (the unclamped subtraction is `0`/`-1`/`0`, but `battleFxOamRoom` itself floors at
   `0`), no fitting frame authorable at all either way — with the MISS-on/hit-feedback-on `sample-rpg`
   variants confirmed to
   belong to §15.7's own ROM-identity matrix alone, never to the trace fixture.
4. **P3-4, the all-zero-tile fallback test proves nothing about viewport construction, and two
   passages describe the superseded design (§15.5, §15.7).** Accepted. The all-zero-tile case moves
   off `paintMetasprite` (which never constructs a viewport itself, only paints into a buffer it is
   given) and onto the bounds/viewport computation and the mounted widget instead, asserting computed
   width/height `64`, finite origins, and a cleared image — kept as a separate row from
   `paintMetasprite`'s own three genuinely-rectangular test cases, no longer grouped under a "height
   distinct from width" description that never applied to it, and with the false "a zero canvas width
   throws" claim removed. `drawMetaspritePreview`'s own INTERNAL call to `paintMetasprite` is now
   correctly stated to change (forwarding `height`) — what actually stays unchanged is narrower: the
   default behaviour, and the genuinely external callers (`character.js:72`,
   `metasprite.test.js:55,77`). Two stale cross-references are fixed: the destructure citation now
   points at `tickBattleFx` itself (§15.2), not this design's own contract-table header; and the
   controls passage now describes `None` as `sync()`'s own step 1 and re-arm as keyed on id/signature,
   not "a new object."

Per the review's own closing note, this entry does not restate the reversed arm-time timing example
or round 2's own superseded `room <= 14` bound — both are stated correctly, once, in §15.4/§15.10 and
§15.6 respectively, not duplicated here. The review's own "Explicit checks and conclusion" section
is left unchanged except where a finding above corrected what it was confirming; its own tightened
synchronous-reconciliation claim (successful `commit()`/undo/redo only, never a throwing mutator or a
filtered live stroke notification) is folded into §15.5's own reasoning in place.

### Phase 3 design review, round 4 (2026-09-14)

Round 4 review (`handoff-next/battle-anim-phase3-design-review4.md`, verdict FIX) found no P1, two
P2 and two P3 — three of round 3's own four fixes it called fully resolved (P2-3, and P3-4's own
operative specification), one partly resolved, each remaining gap becoming one of the four findings
below. The review's own readiness assessment named exactly two genuine blockers (an explicit forced
Replay transition; an executable widget-level timing test with a named observation and a runtime
that can actually run it) and called the rest prose corrections.
`handoff-next/brief-battle-anim-phase3-design-fix4.md` dispositioned all four; every disposition was
accepted as directed:

1. **P2-1, Replay was routed through a condition that prevents replay (§15.1, §15.5).** Accepted.
   Replay is now defined as its own explicit, FORCED re-arm transition (§15.5's own new bullet,
   4089-4102) — a shared read/validate/compute-fresh-inputs/paint sequence with ordinary `sync()`,
   but forcing `armBattleFx` regardless of whether id/signature match, an internal
   `sync({ forceReplay: true })`-shaped call the public interface need not expose. The previous text
   routed Replay through step 3(ii)'s own ORDINARY, conditional reconciliation, which never re-arms
   on unchanged id/signature — exactly what Replay always presents, since it never changes the
   selection. Ordinary `sync()` itself is unchanged: a finished preview's own terminal state (and its
   own already-specified art-refresh-without-restart behaviour) is still preserved across an
   unrelated render. §15.1's own contract-table row ("How the user replays") is corrected to describe
   the forced call explicitly.
2. **P2-2, the widget-level timing test specified an unavailable runtime and no named observation
   (§15.5, §15.7).** Accepted, decided per the disposition's own instruction: the mounted-widget
   integration case moves to the Electron smoke environment (`main/smoke.js`), not `node:test` —
   `mountBattleFxPreview` constructs real DOM, a real canvas context, and uses
   `getComputedStyle`/`ResizeObserver`, none of which exist under plain `node --test`
   (`package.json:11-12,26-28`'s own script/devDependency list has no DOM emulation library at all).
   The smoke step's own observation is now named explicitly: pixels — eight distinct visible frames
   of duration 1, arm at fake `t=0`, invoke the first queued fake-`schedule` callback at fake
   `t=1000`, assert the canvas shows frame 4's own expected pixels with playback still live (an
   omitted arm-time call still shows frame 0 and fails); finish synchronously via `stepPreview()`,
   click Replay at a new fake time, repeat. Teardown (dropped queued callbacks on `destroy()`) and
   the one-callback-chain-per-mount rule are both stated explicitly. The "observable frame/timer"/
   "injected tick-counting hook" wording is removed — no new API, pixels only. Direct pacer/stepper
   tests stay under `node:test`, unchanged.
3. **P3-3, "no edit reached the project" was false for a throwing commit (§15.5).** Accepted.
   Reworded: `commit()`'s own comment (`renderer/store.js:183-190`) describes a mutator that
   splices/restamps and then throws, already having changed the project with no rollback — a
   throwing mutator may leave partial changes and simply emits no notification, which is why it sits
   outside the successful-notification guarantee, not because no edit occurred. No exception-recovery
   work is added to this design's own scope.
4. **P3-4, two summary statements still overstated or misnamed the corrected behaviour (§15.6, §10,
   §15.9).** Accepted, both. The MISS-on room figures are corrected from the unclamped `0`/`-1`/`0`
   to the actual, clamped `0`/`0`/`0` `battleFxOamRoom` itself returns (`Math.max(0, ...)`,
   `generate.js:2646-2649` — this design's own extracted function copies the identical clamp), in
   both §15.6 and this changelog's own round-3 entry (above); the conclusion (no positive-tile frame
   fits under MISS-on) is unchanged. §15.9's own scope summary is corrected from "four new cases"
   (implying one uniform group) to state plainly that three compositor cases exercise
   height/origin behaviour on `paintMetasprite` itself, while the separate fallback test exercises
   the bounds/viewport computation's own computed blank bounds — a different function under test, not
   a fourth case of the same sweep.

### Phase 3 design review, round 5 (2026-09-14)

Round 5 review (`handoff-next/battle-anim-phase3-design-review5.md`, verdict **GO-with-nits**) found
all four round-4 findings resolved and §15 sufficient to brief phase 3 from; its two P3 nits are
applied — the smoke row's post-`destroy()` assertion now also requires zero newly queued callbacks,
with the disposed check stated to run before both rescheduling and stepping (§15.5, §15.7), and
§15.9's own scope summary no longer implies `paintMetasprite`'s origin arguments are new (§15.9).

### Phase 3 answers round (2026-09-14) — Chris's own §8 answers recorded

`docs/design-battle-animation.md` (5e34722, reviewer GO-with-nits) left two questions open in §8's
own "Phase 3's own open questions" passage. Chris answered both on 2026-09-14, recorded verbatim:

1. Does the Monster Forge get the identical preview in phase 3? YES — matches the recommendation.
2. Deduplicate `animationSelect` into the shared widget module in this phase? NO — matches the
   recommendation.

Both match this document's own recommendation, so no design decision changes: §15.8's own "Both
scope questions stay open for Chris in §8" paragraph is amended with one sentence recording the
answers; phase 3 ships the widget in both Forges (§15.5's persistent-host split, applied to both
`magic.js` and `monster.js`) and leaves `animationSelect` untouched in both files.

### §16 design round (2026-09-15) — a party member's own attack visual, ROADMAP item 14 point 5

HEAD `8cb76fc` at the start of this round (unchanged since the CLAUDE.md docs pass, per §0). Design
only — no code, test, fixture, CLAUDE.md or ROADMAP.md change in the real tree; every change lives
in this document (§16, a new §7 phasing paragraph, a new §8 subsection, §9's first bullet amended,
this entry) or in a throwaway `git worktree` prototype (Appendix E), built, measured, regression-run
against the full suite (1736/1736 passing, six fixtures byte-identical), and torn down.

Settled: the ROADMAP's own sketch (§16, opening paragraph) held on both its claims, confirmed by a
real, executed prototype rather than relayed — "no new engine primitive" (the existing `bt_fx_*`
flipbook, reused via a grown `battle_fx_arm_attack`) and "indexed by party member" (no mapping at
all: a `project.party` index and a party combatant slot are the same number because every hand-off
that carries one — Join's own `bt_arg`, `party_join`'s own direct RAM write, `party_restore`'s own
in-place recomputation, save/restore's own positional copy, `turn_order`'s own list-of-identifiers
— indexes directly with no translation step, corrected in fix round 2 from an earlier "equal
capacities" framing that stated the cause backwards; `RPG_LIMITS.party === MAX_PARTY` is a
necessary BOUND on this holding, not itself the reason it holds, §16.4). One real design hazard was
found only by attempting the naive "fold into
the existing gate" shape and building it: a party-only project would leave `battle_fx_arm_attack`'s
existing monster branch referencing a `mon_anim_attack` table that does not exist, an
undefined-symbol assembly failure rather than a byte-count error — closed by a broadened
`projectUsesAnyBattleAnimation` gating the shared base and both existing tables, while the NEW party
branch and table stay on their own narrower `PARTY_ATTACK_ANIM_ENABLED` (§16.6). A second real bug
was found by the SAME measurement discipline that closed the first: `attack_target`'s own new arm
call, first gated on the broadened flag, cost 3 dead bytes on every monster/spell-only project;
found by the regression measurement failing by exactly 3 bytes, fixed by re-gating to the narrower
flag, re-measured to exact equality with the pre-existing 250-byte figure.

Measured (Appendix E, §16.9): `PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE = 11`, flat on MMC1/MMC3/UNROM
512, on top of the unchanged `BATTLE_ANIM_BATTLE_ALLOWANCE = 243` base (now charged on the
broadened gate). Two functional SCRATCH probes (arm-on-miss, spell-caster fallback) were built, run
against the real assembled ROM, and passed, then reverted before the diff was taken. One open
question for Chris (§8's own new "§16's own open questions" subsection): whether `animationSelect`
stays a third byte-for-byte copy in `character.js` (recommended, matching his own 2026-09-14
decision not to dedupe Magic/Monster's pair) or gets folded now that a third consumer exists.

### §16 fix round 1 (2026-09-15) — review verdict FIX, 5 P2 + 2 P3, no P1, all seven dispositioned

`handoff-next/battle-anim-party-attack-design-review1.md`. Every finding checked against the code
independently before being accepted, per the fix brief's own instruction; none was found wrong.

1. **P2 — spell fallback was wrongly settled, not put to Chris.** Fixed: moved to §8's own new
   subsection with a recommendation (symmetric), the concrete healer/sword-swing case illustrated,
   and the physical-only alternative reasoned at ~17 code bytes total (vs. symmetric's measured 11)
   — a real, not merely asserted, cost difference. §16.3, §16.9's own table and §16.10's own test
   rows are now conditioned on this answer rather than written as settled.
2. **P2 — candidate (b)'s rejection rested on a false claim.** Withdrawn: `cast_spell`'s own
   single-target damage/status branch already arms the flipbook AND hit feedback on the identical
   `bt_target` slot, in the same tick, today — real, shipped precedent for two effects sharing a
   slot. (b) is now costed properly (identical code/OAM/author cost to (a); a genuine
   semantic/visual choice, not a technical one); (c)'s zero cost is stated explicitly; the "gating
   option not picked" comparison now separates code bytes from `pc_anim_attack`'s own `party.length`
   table bytes. Recommendation stays (a), now grounded in the ROADMAP's own explicit words rather
   than the withdrawn "no precedent" claim. §16.1, §16.6.
3. **P2 — the removal-lever label overpromised.** Fixed in Appendix E itself (rebuilt, not
   hand-edited): `projectWithoutBattleAnimation`'s own pre-existing label renamed from `'every
   battle animation reference'` to `'every monster attack or spell animation reference'` (fix round
   2, review round 2 P3-1, corrects fix round 1's own first attempt, `'every monster or spell attack
   animation reference'`, which still read as though both halves meant "attack" — misleading for an
   authored Heal or other caster-anchored spell visual, which this same strip also clears); the
   party lever stays independent; `battleShortfallAdvice`'s own existing solo/combined solver needs
   no third lever. Proven by a real, executed mixed-reference probe (§16.9, probe G): stripping
   monster/spell alone frees 0 when a party reference remains, party alone frees 13, both free 263,
   and the combined advice text now names both scopes correctly. §16.5, §16.6, §16.9.
4. **P2 — the test plan was not yet a reproducible specification.** Fixed: every row now names its
   isolated helper(s) and exact `rpg.test.js` line numbers, the RNG-rigged hit case (probe A) is new
   and proves the successful-attack path arms correctly (the forced-miss case, probe B, is what
   actually rejects hit-only arming — corrected in round 3, P3-1, this summary previously said A
   itself distinguished arm-before-roll from arm-after-a-successful-roll, which it cannot: both
   placements produce the identical result whenever the roll happens to succeed), a four-member
   Join-with-holes probe (C), an explicit `projectWithoutBattleAnimation` contract probe (F), a
   party-member-deletion-preserves-a-survivor probe (E), and the null-attack case (B) now keeps a
   DIFFERENT member's animation authored so the gate stays live. The blanket "every row proven"
   claim is replaced with an EXECUTED/PLANNED column, honest about what remains unbuilt (hop-2 for a
   party reference specifically, the whole UI, item 1's physical-only alternative, and — narrowed
   again in round 3 — a genuine save/load regression test, since probe C's own `party_restore` call
   proves only that arming member index 3 still works after recomputation, not that any index is
   preserved).
   §16.9, §16.10.
5. **P2 — regression provenance.** Fixed: the regeneration-reading recipe is removed from §16.9 and
   this changelog; the reviewer's own independent, clean six-fixture result (`59/59`,
   `nameentry.test.js` + `bankedbytes.test.js`, checked-in fixtures untouched) is recorded as the
   fixture-identity evidence, and the full suite was re-run in a fresh rebuilt worktree using ONLY
   `build:sample*`/`cli.js` (assembly of the checked-in projects, never `npm run sample*`
   regeneration) — `1736/1736` passing, `0` failed, `0` skipped, no skip reason named anywhere.
   §16.9.
6. **P3 — the index-space proof and two register claims.** Fixed: replaced the "equal capacities"
   inference with the Join/`bt_arg`/`party_join`, `party_restore`, save/restore positional-copy, and
   `turn_order`-is-a-list-of-identifiers evidence chain the review named, each citation re-verified
   directly. Corrected "none of the downstream routines accepts A/X/Y" to the precise claim
   (`battle_say_actor` does take A; safe because `attack_target` reloads it after, `:273-274`).
   Corrected the "first time" party-anchor claim (`cast_spell`'s own heal/all-target and
   single-target-at-a-party-member cases already reach it). Added an explicit, diff-verified
   statement that neither arm branch nor `battle_fx_arm_at` touches `bt_tmp`/`bt_tmp2`/`bt_arg`/
   `bt_actor`/`bt_target`. §16.2, §16.4, §16.7.
7. **P3 — the preview's user-visible contract was unstated.** Fixed: §16.8 now states explicitly
   that the Character Forge mounts the identical shared, effect-only preview (animation-local
   bounds, no character backdrop, no battle-position simulation), and that selecting a different
   member with the SAME animation id retains playback rather than restarting it
   (`battlefxpreview.js:254`'s own re-arm check, unchanged). A same-id/stale-id/undo smoke
   assertion is added to §16.10's own test plan, PLANNED (no `renderer/` file touched this round).
   The `animationSelect` copy-vs-dedupe question stays with Chris, unchanged. §16.8.

Re-measured (Appendix E rebuilt with items 1 and 3 applied): `PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE`
unchanged at 11 (the label rename is a pure string change, no ROM byte moved), confirmed on all
three boards, code and table bytes now reported separately (§16.9's own table). Off/monster-only/
spell-only ROMs confirmed byte-identical to a clean `8cb76fc` build by full-ROM SHA-256, not merely
by usage-figure equality — nine comparisons, all identical.

### §16 fix round 2 (2026-09-15) — review verdict FIX, 2 P2 + 2 P3, no P1, no engine defect, all four dispositioned

`handoff-next/battle-anim-party-attack-design-review2.md`. Round 1's own findings 1, 2, 3 (by
accepted alternative), 5 and 7 confirmed resolved; findings 4 and 6 partly resolved, closed by this
round's own P2-1/P2-2/P3-2. Every finding re-checked against the code before being accepted; none
was found wrong.

1. **P2-1 — the hit-test claim and the restore row both overclaimed.** Fixed: the hit probe (A) is
   now described as proving the successful-attack path specifically, not as distinguishing
   before-roll arming from hit-only arming — that distinction belongs to the forced-miss probe (B),
   corrected to say so explicitly (both the prose and the §16.10 wrong-implementation column). The
   restore row is narrowed to what it actually tests — `party_restore` never touches `pc_in_party`,
   so re-arming after calling it proves only that in-place stat recomputation does not disturb which
   ROM row a slot reaches, not that a real save/load preserves membership. A genuine save-load
   regression test (save a party with holes and distinct state, disturb RAM, run the real
   `load_apply_body`/`continue_game` path, assert membership `[1,0,0,1]` and member 3's own state
   BEFORE its animation) is added to §16.10, marked PLANNED, not claimed as proven by probe C.
   §16.9, §16.10.
2. **P2-2 — a false counterfactual about clobbering scratch/identity bytes.** Fixed: deleted the
   claim that touching `bt_tmp`/`bt_tmp2`/`bt_arg`/`bt_actor`/`bt_target` would have needed no
   caller change. `bt_arg`/`bt_actor`/`bt_target` all have live downstream readers that trust their
   contents as identity (`cast_spell`'s own `X` reload only works because `bt_arg` itself was never
   touched; `roll_hit`/`physical_damage` read `bt_actor`/`bt_target` directly) — corrupting any of
   the three would be a real, silent misdirection, not a harmless no-op. Only `bt_tmp`/`bt_tmp2` are
   genuinely free to clobber on this path, since `roll_hit`/`physical_damage` overwrite them fresh
   before reading either back. The verified preservation statement and the X-reload explanation are
   kept, the false "would need no change" sentence is not. §16.2.
3. **P3-1 — the renamed label still read as though every spell reference were an "attack."** Fixed
   in Appendix E itself (rebuilt again, in a fresh throwaway worktree, not hand-edited): relabeled
   to `'every monster attack or spell animation reference'`, correctly covering a caster-anchored
   Heal or other non-attack spell visual, which this same strip has always cleared. A string-only
   change — no byte figures moved (`PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE` still 11), reconfirmed by
   re-running probe G's own numeric checks (`0`/`13`/`263`, unchanged) and
   `node --test test/unit/nameentry.test.js test/unit/bankedbytes.test.js` (`59/59`, never `npm run
   sample*`). §16.5, §16.6, §16.9, Appendix E.
4. **P3-2 — surviving "equal capacities" wording stated the proof backwards.** Fixed in this
   changelog's own round-1 entry and in §16.11: both now state that the index spaces agree because
   every hand-off (Join's own `bt_arg`, `party_join`, `party_restore`, save/restore, `turn_order`)
   indexes directly, with `RPG_LIMITS.party === MAX_PARTY` kept only as the BOUND this depends on,
   not the reason. §16.11's own future-risk bullet is corrected further: raising party capacity is
   not merely "a fifth boot member stays unreachable" — `battle_entry_join`'s own guard is bounded
   by `PARTY_SIZE` (a JS-controlled ceiling), not `MAX_PARTY`, so raising `RPG_LIMITS.party` without
   a matching engine change could let a Join write out of bounds into the fixed `pc_in_party`/
   `pc_spells` RAM layout — a real corruption risk, not an inert one. Auditing both boot AND
   Join/restore against the fixed RAM layout is now the stated requirement.

### §16 design review, round 3 (2026-09-15) — GO-with-nits, both nits applied

`handoff-next/battle-anim-party-attack-design-review3.md`: all four round-2 findings resolved, §16
sufficient to brief implementation from. Two P3 prose nits, both fixed: the isolated
`party_restore` check's own claim is narrowed to exactly what it demonstrates (arming still works
after recomputation, not index preservation) and its redundant §16.10 row is dropped in favor of
the already-PLANNED real save/load test; the expanded-party Join risk (§16.11) is corrected to say
raising `RPG_LIMITS.party` alone changes nothing until a project actually authors a longer party.

### §16 amendment round 1 (2026-09-15) — Chris's §8 answers recorded, the fallback replaced

HEAD `71cfa84` at the start of this round (§16 as it landed after review round 3's nits, per the
prior entry). Chris answered both of §16's own open questions (§8) the same day: on the spell-cast
fallback, "Just have the player walk forward then have the spell animation play" — neither of the
two offered options (symmetric arm-on-cast vs. physical-only), so both are marked superseded, not
deleted, and the fallback concept for a party caster is replaced outright; on the third
`animationSelect` copy, "Dedupe all three now." §8 records both verbatim, with what each means for
§16.

Confirmed against the engine, not assumed: the orchestrator's own reading of answer 1 — a party
caster's battle sprite steps forward, then the spell's own §3.3-anchored anim plays — holds with no
impossibility found. Two new §16 subsections carry the design: §16.3a (the walk forward, costed:
candidate (a) instant jump considered and rejected as not reading as a walk; candidate (b), an
8-tick animated slide, `WALK_TICKS = 8`/`WALK_STEP_PX = 16`, recommended and built, 72 code bytes
flat, 0 table bytes; `battle_fx_draw`'s own party anchor follows the offset, a genuine, separately
measured 21-byte interaction term only paid when `PARTY_CAST_WALK_ENABLED` and
`BATTLE_ANIM_ENABLED` are both live, found by measuring the combination for real rather than
assumed additive) and §16.3b (sequencing: a new `BP_WALK` phase, held by an up-counting
`bt_walk_step` the same way `BP_MESSAGE`/`battle_message_wait` already holds a phase for N ticks;
exactly two insertion points, `spell_chosen_all` and `battle_target`; the sprite resets
unconditionally at message dismissal, on the same path already clearing `bt_fx_anim`/`bt_miss_left`
— no separate walk-back phase; monster casts and attacks confirmed unaffected by direct read, no
shared code path with either insertion point). Two new open questions were put back to Chris (§8),
both genuine taste calls, each with a recommendation: whether a physical Attack also walks forward
(recommended: yes, spell-only would need its own extra check `battle_target` doesn't otherwise
need, so extending to Attack is marginally cheaper, not more expensive); and what an un-animated
spell shows (recommended: the walk alone, no default flipbook, since inventing an unauthored visual
contradicts §16.2's existing fallback philosophy).

`cast_spell`'s fallback for a party caster changes — a 6-byte guard now suppresses the existing
`battle_fx_arm_attack` call for a party caster, folded into `PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE`
rather than a new term, since the guard only has an observable effect once a party `attackAnim`
exists — so every downstream figure was re-derived, not hand-edited: §16.2 (the guard's own shape
and rationale), §16.3/§16.3a/§16.3b (replaced/added, above), §16.6 (`PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE`
11 → 17; new `PARTY_CAST_WALK_ENABLED`/`PARTY_CAST_WALK_BATTLE_ALLOWANCE = 72`/
`PARTY_CAST_WALK_FX_INTERACTION_ALLOWANCE = 21`, gated independently of
`PARTY_ATTACK_ANIM_ENABLED`, flat on MMC1/MMC3/UNROM 512; existing projects with no `castWalk`
authored confirmed byte-identical, §16.9), §16.9 (re-measured 6×6 table across
off/monster-only/spell-only/party-only/walk-only/walk+party × MMC1/MMC3/UNROM 512, all
`predictedMatchesReal`, plus a 9-way full-ROM SHA-256 identity proof for off/monster-only/spell-only
against a clean `71cfa84` build), §16.10 (new test rows for the walk's own probes, W1-W3), and
§16.11 (new reasoned-not-read entries for the walk: a status tick firing mid-walk-message, the
second independently-gated-feature interaction hazard checked by building both combinations, cycle
cost not measured against a cycle-accurate tool, and mid-walk status ticks argued unreachable by
direct read of the dispatch rather than built). §16.8's dedupe design was written for the first
time (module `renderer/widgets/battlefxpreview.js`, `export function animationSelect(project,
selectedId, onChange)`, all three call sites named, a new PLANNED cross-Forge smoke test) since it
had no prior design at all — Chris's answer replaced a "recommend not deduping" default, it did not
amend an existing plan.

Rebuilt and re-measured in a fresh throwaway `git worktree` off `71cfa84` (Appendix E replaced in
full with this round's 649-line, 7-file diff — `engine/battle.asm`, `engine/battleturn.asm`,
`engine/battleui.asm`, `engine/constants.asm`, `main/build/battletables.js`,
`main/build/generate.js`, `shared/project.js`). `node --test test/unit/nameentry.test.js
test/unit/bankedbytes.test.js` passed `59/59` against the untouched checked-in fixtures (never any
`npm run sample*` script). Nothing found this round contradicted the orchestrator's own reading of
answer 1 — the engine supported the described mechanism with no impossibility, only the two
genuinely-untold design choices named above.

### §16 amendment round 1, fix round 1 (2026-09-15) — always-on, attacks walk too, P2-4's leaner arm shape

HEAD `71cfa84` throughout (unchanged — every round in this whole family stays a design-only slice
against the same pinned tree). Review of amendment round 1
(`handoff-next/battle-anim-party-attack-design-amend1-review1.md`): verdict FIX, six P2 and two P3,
all eight dispositioned. The reviewer independently confirmed the walk mechanism, the registers and
scratch, the `$AE` allocation, and the 72/17/21 figures were correctly measured for what amendment
round 1 actually built — the findings are about the DESIGN's own default-off policy and two
overstated/understated claims, not about measurement error.

Separately, and materially reshaping this round beyond the review's own eight findings, Chris
answered three more questions the same day (§8): **"Always on for RPGs"** (no `project.rpg.castWalk`
field, no toggle — every RPG project's own battle bank carries the walk unconditionally, overturning
amendment round 1's own gated recommendation the reviewer's P2-1 finding had already flagged as a
product choice rather than a technical necessity); **"Attacks walk too"** (a physical Attack now
walks forward before it resolves, not only a spell cast — overturning amendment round 1's own
spell-only recommendation); and **"The walk alone"** (confirms amendment round 1's own recommendation
for an unanimated spell, unchanged). §16.3/§16.3a/§16.3b were rewritten to match: the walk forward
is no longer a separate authored feature (no schema field, no Build Forge checkbox, §16.8) but an
unconditional property of every RPG project's own battle bank, and both `spell_chosen_all` and
`battle_target`'s own routing now start it identically for MAGIC and FIGHT alike, with
`battle_target`'s own `bt_cmd == BC_MAGIC` check removed entirely rather than made unconditional.

Review P2-4 asked for the arm-point shape itself to be reconsidered under the answered fallback
policy: with `attackAnim` never substituting for an unanimated spell under any circumstance,
`battle_fx_arm_attack` no longer needs to know about party members at all, so `attack_target` now
arms `pc_anim_attack` directly (10 measured code bytes) rather than growing the shared routine (11
bytes) plus a separate `cast_spell` guard (6 bytes, 17 total) — a real simplification found by
re-examining the ORIGINAL "bespoke call site" alternative amendment round 1 itself had costed and
set aside, once the policy that made the shared-routine shape attractive no longer held (§16.2).
`battle_fx_arm_attack` itself is now completely untouched by this whole feature. The walk's own
base cost (re-measured +56 bytes flat, was +72 conditionally) folds directly into
`BASE_BATTLE_CODE_BYTES_BY_MAPPER`, correctly, since CLAUDE.md's own "never fold a conditional
feature into a base" rule does not apply to a feature with no condition; the one surviving named
allowance, `WALK_FX_FOLLOW_BATTLE_ALLOWANCE = 21` (renamed from `PARTY_CAST_WALK_FX_INTERACTION_
ALLOWANCE`, unchanged in size), is no longer a `STING_SFX`-shaped two-predicate interaction term
(§16.3a records the resulting ledger-honesty limitation: it can no longer be independently verified
apart from `BATTLE_ANIM_BATTLE_ALLOWANCE`, only their sum can).

Rebuilt from scratch (not incrementally) in a fresh throwaway `git worktree` off `71cfa84`. Appendix
E is now an ELEVEN-file, 844-line diff — the same seven engine/generator/schema files as before,
plus four test files (`test/unit/bankedbytes.test.js`, `test/unit/items.test.js`,
`test/unit/nameentry.test.js`, `test/unit/rpg.test.js`) this round genuinely needed to touch, since
the walk's own new timing changes what several pre-existing regression tests must assert — unlike
every prior round, these are real, permanent updates, not reverted SCRATCH probes. `node --test
test/unit/nameentry.test.js test/unit/bankedbytes.test.js` passes `60/60`. The four non-RPG
fixtures stay byte-identical to a clean `71cfa84` build; `sample-rpg`/`sample-rpg-mmc1` deliberately
change (Chris accepted this explicitly when asked) and are re-pinned. Full `npm test`: `1736/1737`
— six pre-existing tests were fixed (not merely found broken) to drive past the new walk phase
before their own assertions run, and the ONE remaining failure was investigated exhaustively and
found to be a genuine, PRE-EXISTING, address-layout-sensitive defect wholly independent of this
design — proven by reproducing the identical failure via eight semantically-inert `nop`
instructions inserted into a completely unrelated routine on a freshly checked-out, unmodified
`71cfa84` tree (§16.9, §16.11). Three SCRATCH probes (W1/W2/W3, re-derived from amendment round 1's
own for a physical Attack specifically) were written, run, confirmed passing against the final
unmodified design, and reverted before the diff was taken.

### §16 amendment round 1, fix round 2 (2026-09-15) — the harness root-caused and fixed, the ledger consolidated

HEAD `71cfa84` throughout. Review of fix round 1
(`handoff-next/battle-anim-party-attack-design-amend1-review2.md`): verdict FIX, four P2 and one
P3, no product question for Chris. The reviewer's own section 1 instrumented and root-caused fix
round 1's one remaining failure, and found four further places where operative prose or the ledger
still contradicted what Appendix E actually built.

**P2-1 (the harness fix, the biggest single finding): resolved.** `rpg.test.js`'s own "multi-target
hit-feedback policy" test calls `battle_tick`/`vram_drain` directly through `callRoutine`, which
masks NMI (`$2000`) but leaves rendering ON (`$2001`) — `vram_drain` is an NMI-only routine
everywhere else in this codebase, so the test's own manual call can run on a visible scanline, where
rendering itself moves the PPU's own address between the `$2006` pair and the `$2007` write. Fixed
with one line, `nes.mmap.write(0x2001, 0)`, in that isolated test only — never inside `callRoutine`
itself, since other callers assert real rendered pixels. §16.9/§16.11 rewritten to state the root
cause, the fix, and that no player-facing engine defect is established; fix round 1's own
`1736/1737` run is relabeled historical prototype evidence, and this round's own `1737/1737` — every
test passing, 0 skipped — is the current result and the implementation's own requirement.

**P2-2 (stale operative prose): resolved.** §16.1's own "swings or casts... symmetric" claim is
corrected to physical-Attack-only, direct-armed, explicitly asymmetric with a monster's own
surviving fallback. §16.6's own "byte-identical, still 250 = 243 + 7" claim — stale since fix round
1 made the walk's own 56 bytes unconditional — is corrected to state plainly that monster/spell-only
projects gain 77 code bytes relative to the OLD, pre-feature build, and measure a real, current,
equality-checked 271 = 264 + 7 relative to THIS round's own baseline. §16.3's own W2 citation is
corrected: W2 was re-derived for a physical Attack in fix round 1, not re-proving spell timing. The
bare "castWalk" name at §16.2 is replaced with "the walk."

**P2-3 (the ledger split): resolved by consolidation, the reviewer's own preferred option.**
`WALK_FX_FOLLOW_BATTLE_ALLOWANCE` is deleted; its 21 bytes fold into `BATTLE_ANIM_BATTLE_ALLOWANCE`
itself (243 → 264), with the `243 + 21` provenance kept in a source comment, not a second exported
name — since the two terms shared one gate and could never be independently verified, keeping two
names bought no checkable claim, only its appearance. `bankedbytes.test.js`'s own isolation test now
checks the single, equality-checkable 264-byte figure directly. Probe G — stale since amendment
round 1, never actually replaced with a real mixed-reference case — is replaced with a real
mixed-removal row (actor AND party `attackAnim` both set, naming off): stripping monster/spell alone
frees 0, party alone frees 12, both free 283, on every board — re-run against this round's own
rebuilt worktree and matching the reviewer's own independently-computed figures exactly.

**P2-4 (lifecycle assertions, the item/flee boundary): resolved.** The poisoned/burned regression
now asserts `bt_walk_step` directly — full and stepped-forward with the action's own message up,
reset to 0 before EACH status line — genuine positional proof, not merely HP/message/order proof.
**Correction (review round 3, P2-2): this covers only the SURVIVED case — both status ticks in that
regression are non-lethal.** It does not exercise a status tick that actually kills the combatant; a
separate PLANNED row for that case is added this round (§16.10). Three new PLANNED rows cover a
single-target damage spell, a heal, and an unanimated party cast with
a LIVE party `attackAnim`, each through the real UI routing, asserting no early resolution through
ticks 1-9. The timeout test-plan row is corrected to a genuine `battle_message_wait` auto-advance
case (`bt_timer = 1`, no A-press), losing its confusing "EARLY-dismissal branch" wording; W3's own
direct `battle_message_done` call is now labeled a local reset probe, not timeout coverage. §16.3b
states explicitly that Item and Run bypass the walk entirely, resolving directly from their own
menu-level phases with no reference to either `BP_ACT` entry point (`item_chosen`,
`engine/battleturn.asm:222-259`; `battle_menu_run`/`battle_menu_flee`, `engine/battleui.asm:203-219`
— both confirmed by direct read).

**P3-1 (the live re-pin checklist, a stray comment): resolved.** `CLAUDE.md:1292` (the published
`3783/3783/3823` base) is named explicitly as the one remaining live re-pin an implementation must
make — not edited here, per this document's own standing rule; historical figures elsewhere stay as
measurement records. The stub-address comment in `rpg.test.js`, accidentally changed from `$0700` to
`$0680` during fix round 1's own debugging, is restored — `callRoutine` still writes its stub at
`$0700`.

Rebuilt from fix round 1's own diff, not from scratch, in a fresh throwaway `git worktree` off
`71cfa84`. Appendix E remains eleven files (no new file this round). `node --test
test/unit/nameentry.test.js test/unit/bankedbytes.test.js` still passes `60/60`. The four non-RPG
fixtures confirmed byte-identical to a clean `71cfa84` build; the two RPG hashes are UNCHANGED from
fix round 1 (this round's diff touches no assembled byte, only test wording and JS bookkeeping).
**Full `npm test`: `1737/1737` — every test passes, 0 skipped**, the review's own stated requirement,
met exactly.

**Amendment round 1, fix round 3 (review round 3: FIX, two P2 + one P3, no product question).** A
TEXT-ONLY round — the reviewer independently re-ran the exact saved Appendix E diff in a fresh
worktree and confirmed `1737/1737, 0 failed, 0 skipped`, accepting the harness fix and the 264-byte
consolidation as sound; no prototype change was made or is needed this round, and Appendix E is
untouched.

- **P2-1 (the ledger and advisor acceptance rows): the existing isolation tests were evidence of a
  CODE DELTA between two variants, never of `battleRegionBytes`'s own ABSOLUTE prediction for
  spell-only or party-only builds, and the action-project exclusion had no dedicated test at all.**
  §16.9's "off code = base" sentence corrected to show the 17-byte item-allowance subtraction
  explicitly. §16.10's mixed-removal row split into an EXECUTED arithmetic row (0/12/283, unchanged)
  and a new PLANNED `battleShortfallAdvice` labels-and-savings row — the prior row's own "catches"
  column named the advisor without ever calling it. Two new PLANNED rows added: absolute
  `battleRegionBytes == nesasm usage` for all five variants on all three mappers, with explicit
  7-shared/2-party table-byte assertions; and the action-project exclusion, through the REAL
  region/capacity gate (`codeRegions` returning `[]` on falsy `bankedCode`, `shared/cartridge.js`),
  explicitly NOT through the raw `battleRegionBytes(actionProject, mapper)` helper, which returns a
  hypothetical figure regardless of `gameType` (`main/build/battletables.js:1000-1014`).
- **P2-2 (status KO and spell timing): the strengthened poisoned/burned regression only ever proved
  the SURVIVED case, and the three PLANNED spell rows under-specified what "no early resolution"
  actually requires tick by tick.** A new PLANNED row added for a lethal status tick, as its own
  regression so the existing dual-status-ORDER test keeps its original purpose. The §10 entry above
  for fix round 2 is corrected to say so explicitly rather than implying full coverage. The three
  PLANNED spell rows (single-target damage, heal, unanimated party cast) rewritten to a uniform
  snapshot-then-assert-unchanged-through-tick-8, phase-only-on-tick-9, resolve-on-tick-10 shape; the
  damage row no longer relies on `bt_dmg_hi` alone, the heal row gained an explicit message
  assertion, and the unanimated-cast row now requires BOTH real resolution (HP and message) AND
  `bt_fx_anim` staying `NO_ANIM`, on the same tick 10.
- **P3-1 (four stale operative sentences): all four corrected in place, each verified against
  Appendix E's own diff rather than against a prior draft's claim.** The "neither arm branch inside
  `battle_fx_arm_attack`" sentence (§16.2, describing amendment round 1's design) replaced with the
  real direct `ldx`/`lda`/`ldy`/`jsr battle_fx_arm_at` block fix round 1 actually shipped in
  `attack_target`. "Shared 243-byte mechanism" (§16.6's advisor-history bullet) corrected to 264. W3's
  direct `battle_message_done` call (§16.9) relabeled a local reset probe, consistent with its own
  test-plan row. §16.11's closing "250-byte delta" claim corrected to the current 271-byte delta
  against `off` and 77 added code bytes against a genuinely pre-feature build (`21 + 56 = 77`: the
  21 bytes folded into the 243→264 consolidation, plus the walk's own 56 unconditional base bytes).
- **Implementation checklist**: the four re-pin destinations (`nameentry.test.js` `BASELINES`, the
  three per-mapper RPG hashes in `bankedbytes.test.js`, `items.test.js`
  `PINNED_RPG_BASELINE_HASH`, `CLAUDE.md:1292`) are now listed together in one place (§16.9), with
  an explicit statement that a green suite proves only that these four re-pins match the ROM — not
  that any PLANNED row in §16.10 has been implemented.

**Amendment round 1, fix round 4 (a regressed label, found by the orchestrator after fix round 3 —
no review round caught it across three rounds).** `projectWithoutBattleAnimation`'s own
`bankedFeatures` label had regressed to the pre-existing, overpromising `'every battle animation
reference'`, silently undoing a rename that was already accepted once, in the ORIGINAL (pre-
amendment) §16 review cycle's own fix round 2 (design fix round 2, review P3-1, §10 above) — the
version of Appendix E committed into `71cfa84` itself carried the correct rename.

- **Cause, confirmed against the saved scratchpad diffs**: amendment round 1's own first prototype
  (`battleanim-party-prototype-amend1.diff`) still had the correct rename, carried forward from the
  original cycle's own accepted `fix2.diff`. The rename was lost specifically when amendment fix
  round 1 rebuilt the prototype (`battleanim-party-prototype-fix1-round1.diff`) from a base that
  predated it — that diff carries the label as an unchanged CONTEXT line, no rename applied. Every
  later rebuild (fix round 2's own `fix2-round2.diff`, unchanged through fix round 3) inherited the
  loss, and it silently regressed through three full review rounds (fix rounds 1-3) because no
  review's own test-plan or Appendix-E read happened to name the label string.
- **Audit result**: `battleanim-party-prototype-fix2.diff` (the ORIGINAL cycle's own accepted fix
  round 2 diff — 4 files, no walk machinery, since the walk did not exist until amendment round 1)
  was diffed against the current Appendix E for every one of its four touched files
  (`engine/battleturn.asm`, `main/build/battletables.js`, `main/build/generate.js`,
  `shared/project.js`). **This is a SOURCE-code audit scope only — corrected in fix round 5 (review
  round 4, P2-1): it does not cover the DESIGN TEXT's own test-plan tables, where a separate loss of
  the same class was found (four accepted test specifications deleted from §16.9/§16.10 by an
  earlier rewrite, with §10 still recording them as accepted — see the fix round 5 entry below).**
  Nothing else was lost from the SOURCE, specifically: the `attack_target` arm mechanism changed from
  growing `battle_fx_arm_attack` (that diff's own shape) to arming directly (fix round 1's own
  P2-4, reversing that choice deliberately, per reviewer preference) — a documented supersession,
  not a loss; `BASE_BATTLE_CODE_BYTES_BY_MAPPER`'s +56 and `BATTLE_ANIM_BATTLE_ALLOWANCE`'s 243→264
  both postdate that diff entirely (the walk and its follow-fx snippet did not exist yet); and the
  remaining differences (`PARTY_ATTACK_ANIM_ENABLED`/`BATTLE_FX_OAM_ROOM` line reordering in
  `generate.js`, comment rewording throughout to describe the new arm mechanism, a docblock on
  `projectUsesPartyAttackAnim` trimming one sentence of rationale that is otherwise covered by
  §16.6's own current advisor prose) are cosmetic or a direct, harmless consequence of the arm-point
  redesign, not independent regressions.
- **Fix**: rebuilt in a fresh throwaway worktree off `71cfa84` (`git apply` of fix round 2/3's own
  saved diff, then ONE change: the label restored to `'every monster attack or spell animation
  reference'`, with a short comment giving the reason). This is Appendix E's own diff now
  (`main/build/battletables.js`, the `bankedFeatures.push` for `projectWithoutBattleAnimation`,
  §16.9's `battleShortfallAdvice`'s own LABELS row (§16.10) corrected to match, and §16.5's own
  prose corrected to describe the restoration honestly rather than re-asserting the stale "fixed in
  Appendix E itself" claim as still current). Verified: grepping `test/` and `main/` for both label
  strings found no test asserting either one, so nothing breaks; the mixed-removal advisor probe on
  `sample-rpg` (actor and party `attackAnim` both set, naming off) on MMC1/MMC3/UNROM 512 confirms
  unchanged `0`/`12`/`283` savings and the corrected label appears in the real advice text; `npm
  test` is `1737/1737`, 0 failed, 0 skipped; the two RPG hashes
  (`6944a5a3c80cfe15ab8f044f0c8520b53351d649195f41f2b6ef0a3c07525623`,
  `bd51f3d6be9e5459754afcf9b5620a794225e57a33339f7c8b4e28de7255021d`) are UNCHANGED — a string-only
  change moves no ROM byte.

**Amendment round 1, fix round 5 (review round 4: FIX, two P2 and two P3, no question for Chris).
Scope rule for this round, because rewrites have now lost accepted text twice: only the sites the
brief named were edited — no other paragraph, table row or section was rewritten or reflowed.**

- **P2-1 — a second loss of the same class, this time in the design TEXT, not the source.** The
  independent historical audit (review round 4, comparing the original cycle's own accepted
  probes against the current §16.9/§16.10) found that four accepted test specifications from the
  original §16 cycle — deterministic party hit + forced miss (probes A/B), a null `attackAnim`
  with another member's gate live (probe B's second case), a four-member Join-with-holes case
  (probe C), and the genuine save/load regression (originally PLANNED, never executed, never
  intentionally superseded) — had been silently dropped when §16.9/§16.10 were rewritten in earlier fix
  rounds, even though §10 kept recording them as accepted. Worse, §16.9's own "what remains
  PLANNED" paragraph claimed the save/load case was "carried unchanged from earlier rounds," which
  was false — its concrete specification no longer existed anywhere in the operative text. All four
  are restored as PLANNED rows in §16.10, adapted to the current direct arm in `attack_target`
  (calling the now-monster-only `battle_fx_arm_attack` for the null-visual case would be vacuous,
  so that row now exercises the direct arm block itself instead); the false "carried unchanged"
  claim is corrected; the old symmetric-fallback probe (probe D) is explicitly NOT restored, since
  it is legitimately superseded by the current un-animated-cast row under §8's physical-only
  answer; and fix round 4's own "nothing else lost" audit statement is qualified as a SOURCE-code
  audit only, distinct from this document-coverage loss.
- **P2-2 — the lethal-status row tested the wrong combatant.** Status dispatch acts on `bt_actor`,
  never the attacked target (`poison_tick`/`burn_tick`, `engine/battleturn.asm:621-646`, copy
  `bt_actor` into `bt_target` before applying damage, per `engine/battleui.asm:740-778`), so the
  prior recipe — seeding the ATTACKED MONSTER with a lethal tick — could never have exercised the
  walking party member's own lethal-status reset at all. Rewritten to seed the ACTING party member
  instead, attacking a healthy monster, with the correct offset-then-apply_damage-then-message
  ordering; the "party death uses monster `bt_wipe_mask`" language is removed, since party death
  does not go through that mechanism.
- **P3-1 — attribution.** The advisor-labels row and the Appendix E header both wrongly credited
  "review round 4" for a fix made in fix round 4, before review round 4 existed; both now say
  "amendment fix round 4, orchestrator finding." The advisor-labels row's own status is corrected
  from an implied "nothing done" to "permanent test PLANNED; scratch advisor probe executed in fix
  round 4" — the scratch probe genuinely was run and reproduced independently by the reviewer.
  §16.11's own capacity paragraph citing "review round 3, P3-2" is qualified as the ORIGINAL §16
  cycle's own review 3 — amendment review 3 had no P3-2 of its own.
- **P3-2 — two comments that contradicted the shipped design.** §16.7's "needs no change at all"
  claim about `battle_fx_draw` is narrowed to the party-versus-monster anchor SELECTION only, with
  an explicit pointer to §16.3a's own follow-the-walker offset snippet, which does change that same
  routine. Appendix E's own `createPartyMember` comment ("a physical swing or an unanimated cast" —
  introduced by an earlier rebuild, present in neither older prototype, and contradicting Chris's
  physical-only answer) is corrected to "this member's flipbook on a physical attack," via a genuine
  rebuild (fresh worktree, `fix2-round3.diff` applied, one comment changed, diff saved as
  `fix2-round4.diff`) — confirmed by direct diff against `fix2-round3.diff` to be the ONLY line
  changed; fixtures build cleanly, `nameentry.test.js` + `bankedbytes.test.js` still `60/60`.

**§16 amendment review 5 (2026-09-15): GO-with-nits.** Three P3 nits applied: table formatting
after the restored-rows paragraph, the deterministic hit/miss setup, and splitting the save/load
correction from the unreachable mid-walk case.

## §11. Places a claim could not be pinned to a line and was reasoned instead

- **The exact vblank/mainline cycle cost of the new call sites, including `draw_metasprite`'s own
  tile-copy loop reached by the tail call in `battle_fx_draw`**, is not measured against a
  cycle-accurate tool. The defensible claim is that the added work is **bounded** (a fixed number of
  frames' worth of 4-byte OAM writes, never an unbounded loop) — not that it runs "comfortably"
  within any particular budget, a word this document no longer uses for anything it has not actually
  measured.
- **Whether an authored animation meant for this feature should be hidden from the overworld
  animation pickers** remains a UI judgment call, reasoned as "no, one shared catalog" for
  consistency with other reused-catalog precedents, not verified against any existing UI-filtering
  convention.
- **The exact combined byte cost of shipping the two hit-feedback halves together — superseded, now
  measured, not reasoned (§12.7).** This bullet previously reasoned "less than 50 + 76 = 126" from a
  shared-state argument, before either half had been unified into a real shippable mechanism — an
  estimate for the TWO HIT-FEEDBACK HALVES alone, never MISS. That estimate is now moot in both
  directions: the *shippable* hit-feedback design (§12) is a real, built, measured prototype at
  **235 bytes** (§12.7, Appendix D's own hit-only isolation) — far more than 126, because it adds
  real new logic neither standalone prototype had (the stranded-tint fix, the dead-monster
  ground-default restore on both the tick and arm-time paths, the register-preservation rework that
  dropped `bt_tmp2` parking, and the `BP_INTRO` guard) on top of unifying the two. **367 bytes is a
  separate figure** — hit feedback PLUS MISS combined (§13.6, Appendix D's own exact-diff
  measurement) — and is not what the 126-byte estimate was ever about; comparing 126 against 367
  compares two different scopes (two halves vs. three) and was corrected in round 3 after round 2's
  own fix report incorrectly claimed this bullet was already aligned with §2(e)'s (correct) one.
  Kept here only as a record of what earlier-round reasoning got wrong, not as a live claim.
- **Whether an edge-only (two-packets-per-hit) shipped version of the attribute flash would cost more,
  fewer, or the same code bytes as the measured packet-every-tick prototype** is genuinely unknown —
  the EDGE-ONLY shape specifically was not built, and this document makes no claim about it either
  way (round 3, finding 6; corrected wording round 4, finding 1 — the packet-every-tick shape *was*
  built, and, as of round 4, correctly, so only one of the two shapes is actually unmeasured here).
  Chris's own phase-2 answer 2 (§10) settles this for the shippable design regardless: blink, not
  edge-only.
- **The 2-byte gap between the two isolated deltas summed (235 + 134 = 369) and the real combined
  delta (367, §12.7) — superseded, now identified, not reasoned (round 1 finding 8).** This bullet
  previously reasoned the gap as "bank-alignment or branch-offset noise," explicitly stating nothing
  in the design shares bytes between the two halves. That was wrong: `setup_monsters`'s own reset
  (§12.4/§13.4) shares ONE `lda #0` immediate load between `sta <bt_hurt_left` and
  `sta <bt_miss_left` — a 2-byte instruction, paid once in the combined build but once EACH
  (independently, since each isolated variant still needs the load for its own single store) in the
  two isolated builds used to derive 235 and 134. `2 = 235 + 134 - 367` is exactly that one shared
  `LDA #$00`, not noise. **v5.1 note**: this shared load is exactly what the two-independent-gate
  design (Chris's own answer 2, §10) can no longer keep — §12.7's own ledger decision separates it
  into two independently-gated resets, so the real shipped combined figure becomes 369, not this
  diff's own 367; this bullet still correctly explains why Appendix D's OWN frozen measurement shows
  367, it is just no longer the real shipped combined figure.
- **The MISS overlay's own cycle cost and vblank headroom** (§12/§13's new tick/draw routines,
  `battle_hurt_attr_open`'s shared addressing math) is bounded the identical way the phase-1
  flipbook's is (§11's own first bullet, above) — a fixed, small number of OAM writes per tick, and
  `vram_buf` traffic bounded in §12.6 (up to 5 packets/20 bytes in the worst reachable tick, not "at
  most one" as an earlier draft of this section claimed) — not measured against a cycle-accurate
  tool.
- **The exact pixel offset (8px up) and duration (`BT_MISS_FRAMES = 30`) for the MISS overlay** are
  reasoned placement/timing choices (§13.4), not verified against a real playtest or against every
  possible author-painted metasprite/block-art size — stated as tunable in §8's own new open
  question, not claimed correct by construction.

## §12. Phase 2a — hit feedback, the shippable design

Turns Appendix B (sprite hit-blink) and Appendix C (block-art attribute flash) into one unified,
shippable mechanism, fixing every limitation §2(e) recorded against the two standalone prototypes
**and** every correctness defect round 1's review found in this design's own first draft (P1
finding 1, P2 findings 2 and 3, P3 finding 7 below). Chris's own answers 1-2 (§10) fixed the shape
— one shared `bt_hurt_slot`/`bt_hurt_left` pair, packet-every-tick — so this section designs the
*correctness* the prototypes left open, not the shape itself.

### §12.1 What changes, and why one pair can mean two different things

`bt_hurt_slot` names a combatant (0-7); `bt_hurt_left` counts down from `BT_HURT_FRAMES` (20,
unchanged from both prototypes). Which of the two hit-feedback halves applies is decided **at read
time**, every time, from what `bt_hurt_slot` currently names — never stored as its own flag,
because it is always recoverable from data that already exists:

- `bt_hurt_slot < MAX_PARTY` (a party member), or `bt_hurt_slot >= MAX_PARTY` and that monster's
  `mon_tile == $FF` (drawn as a sprite, no block art): the **sprite blink** — `battle_sprite_pc`/
  `battle_sprite_mon` skip the icon on alternate frames while `bt_hurt_left` is nonzero and the slot
  matches, `ent_hurt`'s own trick (`engine/entities.asm:590-593`) extended to combatants. Unchanged
  from Appendix B.
- `bt_hurt_slot >= MAX_PARTY` and that monster's `mon_tile != $FF` (has block art): the
  **attribute flash** — a vram_buf packet queued every tick. **Round 1 finding 9: this is a
  packet EVERY tick, but a colour change every OTHER tick** — the `and #2` test on `bt_hurt_left`
  produces two-tick bands (tint held for two consecutive ticks, then the other tint for two more),
  not single-tick alternation; §2(e)'s own round-3 trace already recorded this exact cadence for
  Appendix C, and this design's first draft mis-described it as "odd ticks... even ticks" as if the
  colour itself changed every tick. It does not: only the packet does. The terminal tick forces the
  authored tint back regardless of which band it lands in. The missing `mon_tile != $FF` guard
  (§2(e)'s own limitation 4) is now checked, so a metasprite-fallback monster's slot never queues a
  background write for art that does not exist.

A monster can never be named by `bt_hurt_slot` under both conditions at once — `mon_tile` does not
change mid-battle — so there is no case where both halves fire for the same slot; picking one is not
a priority rule, it is which one is even *possible* for that slot.

### §12.2 RAM

Two zero-page bytes, chained unconditionally after `bt_fx_timer` (`engine/constants.asm:463-466`,
phase 1b), the identical cost either standalone prototype already had — sharing the pair, per
Chris's own answer 1, is what keeps this at 2 bytes rather than 4:

```asm
bt_hurt_slot = bt_fx_timer+1    ; the combatant most recently hit (0-7)
bt_hurt_left = bt_hurt_slot+1   ; shared countdown, from BT_HURT_FRAMES
BT_HURT_FRAMES = 20
```

One more constant, not RAM — `BT_GROUND_ATTR = $55`, `draw_battle_attr`'s own ground-row fill
(`engine/battle.asm:581`, rows 1-4 of the attribute table, written before any live monster's own
`mon_attr` is stamped over the top). Round 1 finding 2 needs this value by name: see §12.5.

Reset unconditionally in `setup_monsters`, beside `bt_fx_anim`'s own existing clear (§12.4) — the
one Appendix B/C limitation (§2(e), "neither prototype resets `bt_hurt_left` at battle entry") this
design closes outright rather than accepting.

### §12.3 The engine, complete

**The arm point — one routine, called from `apply_damage`'s own single choke point** (every landed
physical hit, spell hit, and status tick, `engine/battleturn.asm:974`). This is also where the
multi-target policy and the stranded-tint fix both live:

```asm
; The single arm point for the shared bt_hurt_slot/bt_hurt_left pair, called
; from apply_damage's own single choke point. Fixes the "stranded tint"
; limitation (§2(e)): if the slot this call is about to steal was a
; block-art monster whose flash was still counting down, its cell is
; force-restored NOW, rather than left to a countdown that will never
; reach zero for that slot again once bt_hurt_slot points elsewhere.
battle_hurt_arm:
  lda <bt_hurt_left
  beq battle_hurt_arm_set        ; nothing live to strand
  lda <bt_hurt_slot
  cmp <bt_target
  beq battle_hurt_arm_set        ; same slot re-hit -- just restart the timer
  cmp #MAX_PARTY
  bcc battle_hurt_arm_set        ; stolen slot was a party member -- sprite
                                  ; blink only, nothing was ever queued to strand
  jsr battle_hurt_restore_slot   ; stolen slot was a monster -- restore its
                                  ; cell now if it had block art
battle_hurt_arm_set:
  lda <bt_target
  sta <bt_hurt_slot
  lda #BT_HURT_FRAMES
  sta <bt_hurt_left
  rts
```

**The multi-target policy, stated exactly**: an all-target spell's own `cast_all` loop
(`engine/battleturn.asm:387-406`) calls `apply_damage`, and so this arm point, once per living
target in one tick. Only the LAST target processed ends up blinking/flashing — every earlier target
in the same volley is armed and then immediately superseded (via the stranding fix above) before a
single tick of feedback is ever visible for it. This follows directly from the single shared pair
(Chris's own answer 1): extending coverage to every target in a volley would need either a per-slot
RAM array (8 bytes instead of 2) or a bitmask-plus-loop, neither of which the "one pair" decision
leaves room for. Accepted as the shippable policy — a visual gap for what is a bonus reaction, not
a core information channel; the damage numbers and HP bars, both untouched by this design, are what
actually tell the player what happened to every target.

**Round 1 P1 finding 1, in full — the previous draft corrupted `cast_all`'s own loop.** `apply_damage`
is called FROM WITHIN `cast_all`'s own loop, which stores its end-of-side sentinel (`MAX_PARTY` or
`NUM_COMBATANTS`) in `bt_tmp2` and compares against it after every `apply_damage` call
(`engine/battleturn.asm:387`, `:392`, `:398`, `:402` — CLAUDE.md's own "6502 traps" section names
`bt_tmp2` as the one scratch byte this exact chain may not pick). The first draft's own
`battle_hurt_attr_open` parked the restore target's actor id in `bt_tmp2` to read `mon_attr,y`
after `vram_open` returned — silently overwriting the sentinel `cast_all` was still relying on for
every remaining iteration of the SAME call. Reproduced directly against the assembled prototype:
old hurt slot 4, a re-arm onto slot 5, actor id 0 at slot 4 — `battle_hurt_arm` left `bt_tmp2 = 0`
where `cast_all` needed `8`, silently truncating or extending the volley depending on which
direction the corruption ran.

**The fix does not park anything in shared scratch at all.** The attribute address `X` (the monster
slot) maps to is a pure function of `X` alone — it never depends on the actor id — so `X` itself,
which is never touched by the address math and is separately preserved by `vram_open` internally
(`stx`/`ldx` around its own body), survives the whole call untouched. A caller that needs the actor
id for `mon_attr,y` just re-reads `mon_slot_actor,x` itself once the call returns, at the cost of
one extra `lda`/`tay`, rather than trust a value parked in scratch it does not own:

```asm
; X = monster slot. Opens vram_buf at that monster's own anchored
; attribute cell (draw_battle_attr's own per-monster offset). The address
; math is a pure function of the slot number (X), never the actor id, so
; this never needs to park anything in shared scratch to do its own job.
; X itself survives the call (never touched here after the address math
; begins, and vram_open's own body saves/restores X internally) --
; callers that need the actor id re-read mon_slot_actor,x themselves once
; this returns. Clobbers A, Y.
battle_hurt_attr_open:
  txa
  clc
  adc #1
  asl a
  asl a
  asl a
  clc
  adc #1
  clc
  adc #$C0
  tay
  lda #$23
  jmp vram_open
```

**Round 1 P2 finding 2, in full — a killing hit could strand the flash tint forever.** `wipe_monster`
(`engine/battleturn.asm:1021-1048`, unchanged) rewrites only the eight *tile* bytes of one row a
tick; it never touches the *attribute* byte at all — `draw_battle_attr` (`engine/battle.asm:566-...`)
is the only routine that ever initializes attributes, and it runs once, at battle draw time, never
again. The first draft's own dead-check abandoned the countdown on a killing hit with no restore at
all, reasoning "`wipe_tick` owns its cell" — false: whatever the flash last queued (very possibly
`$FF`, the flash tint, mid-band) is the LAST write that cell will ever receive, sitting there for
the rest of the battle, on top of the wiped ground. Reproduced against the assembled prototype: an
alive flash queues its normal 4-byte packet; the following tick, once `mon_slot_alive` reads 0, the
prototype's first draft cleared the timer and queued NOTHING — leaving the previous tick's `$FF`
stranded.

**The fix restores the ground default, `BT_GROUND_ATTR`, not the dead monster's own (now
meaningless) `mon_attr`** — that monster's own tiles are being wiped to ground either this tick or
imminently, so the cell should read as ground, the same value `draw_battle_attr` itself paints
everywhere a monster's own art does not cover:

```asm
; Ticks the shared hit-feedback pair. Guarded on BP_INTRO the identical
; reason battle_fx_tick already is (round 1 finding 7, §12.4): this runs
; before battle_dispatch on every tick, including the very first one of a
; fresh battle, where neither byte has been reset yet.
battle_hurt_tick:
  lda <bt_phase
  cmp #BP_INTRO
  beq battle_hurt_tick_rts
  lda <bt_hurt_left
  beq battle_hurt_tick_rts
  lda <bt_hurt_slot
  cmp #MAX_PARTY
  bcc battle_hurt_tick_dec       ; a party member -- nothing to queue, just tick
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_alive,x
  bne battle_hurt_tick_dec
  lda #0
  sta <bt_hurt_left               ; stop ticking regardless of block art
  lda mon_slot_actor,x
  tay
  lda mon_tile,y
  cmp #$FF
  beq battle_hurt_tick_rts        ; no block art -- nothing to restore
  jsr battle_hurt_attr_open       ; X = monster slot, preserved
  lda #BT_GROUND_ATTR
  jsr vram_push
  jmp vram_end
battle_hurt_tick_dec:
  dec <bt_hurt_left
  lda <bt_hurt_slot
  cmp #MAX_PARTY
  bcc battle_hurt_tick_rts        ; party member: sprite blink only, done
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_actor,x
  tay
  lda mon_tile,y
  cmp #$FF
  beq battle_hurt_tick_rts        ; metasprite fallback -- sprite blink only
  jsr battle_hurt_attr_open       ; X = monster slot, preserved
  lda mon_slot_actor,x            ; re-read (X survives the call); Y was
  tay                             ; clobbered by battle_hurt_attr_open itself
  lda <bt_hurt_left
  beq battle_hurt_attr_restore
  and #2
  bne battle_hurt_attr_flash
battle_hurt_attr_restore:
  lda mon_attr,y
  jmp battle_hurt_attr_push
battle_hurt_attr_flash:
  lda #$FF
battle_hurt_attr_push:
  jsr vram_push
  jmp vram_end
battle_hurt_tick_rts:
  rts
```

**A second death path, found by tracing what happens to the OLD slot at arm time, not only at tick
time.** `cast_all`'s own loop can kill the combatant `bt_hurt_slot` currently names and, on the VERY
NEXT iteration, re-arm onto a different target — all inside one call to `battle_dispatch`, before
`battle_hurt_tick` ever runs again for that now-abandoned slot (the shared pair has already moved on
to the new target by then, so the tick routine above can never see the old one again). The arm-time
restore therefore needs the identical ground-default fallback, or this second path strands the tint
exactly as finding 2 originally described, just reached a different way:

```asm
; The OLD bt_hurt_slot (still in <bt_hurt_slot on entry) is a monster --
; force-queue its own attribute cell back if it has block art. A no-op for
; a metasprite-fallback monster.
;
; If that monster has ALREADY died since it was armed (mon_slot_alive ==
; 0) -- possible because THIS very apply_damage call is what is about to
; re-arm a different target, and a previous call in the same cast_all
; volley already killed it -- this is the LAST chance to fix its cell
; before the shared pair forgets it forever. Restores BT_GROUND_ATTR in
; that case, the identical policy battle_hurt_tick's own dead-check uses.
battle_hurt_restore_slot:
  lda <bt_hurt_slot
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_actor,x
  tay
  lda mon_tile,y
  cmp #$FF
  beq battle_hurt_restore_slot_rts   ; no block art -- nothing to restore
  jsr battle_hurt_attr_open          ; X = monster slot, preserved
  lda mon_slot_alive,x
  bne battle_hurt_restore_slot_alive
  lda #BT_GROUND_ATTR
  jmp battle_hurt_restore_slot_push
battle_hurt_restore_slot_alive:
  lda mon_slot_actor,x                ; re-read (X survives the call); Y was
  tay                                  ; clobbered by battle_hurt_attr_open
  lda mon_attr,y
battle_hurt_restore_slot_push:
  jsr vram_push
  jmp vram_end
battle_hurt_restore_slot_rts:
  rts
```

**Drawing** needs no new code at all beyond Appendix B's own two skip-checks (`battle_sprite_pc`/
`battle_sprite_mon`, unchanged from Appendix B except reading the shared pair's real names) — the
attribute flash has no draw-time component; its packets are queued entirely from the tick and arm
routines above.

### §12.4 Battle-entry reset, the BP_INTRO guard, and the flipbook interaction

**Battle-entry reset** — the one Appendix B/C limitation this design does not merely record, it
closes: `setup_monsters` (`engine/battle.asm:441-456`, phase 1b's own `bt_fx_anim` reset site) also
clears `bt_hurt_left` to 0. `bt_hurt_slot` needs no reset of its own — every reader gates on
`bt_hurt_left` first, the identical discipline `bt_fx_anim`/`bt_fx_slot` already use. One correction
against Appendix B/C's own text: `A` cannot be assumed to still be 0 at that point the way a first
draft of this design assumed — the `.if BATTLE_ANIM_ENABLED` block immediately above leaves
`NO_ANIM` ($FF) in `A` when it runs, not 0, so the reset reloads `lda #0` explicitly rather than
relying on a stale register.

**Round 1 P3 finding 7 — the reset above runs too late to protect the tick routines on the very
first tick of a battle.** `battle_hurt_tick`/`battle_miss_tick` (§12.3, §13.4) both run from
`battle_tick`, which calls them BEFORE `battle_dispatch` — and `setup_monsters` is reached only
*inside* `battle_dispatch`, via `battle_intro`, on the tick `bt_phase` still reads `BP_INTRO`
(`engine/battle.asm:233`, `:291-295`, `:333`). So on that exact tick, both new tick routines would
run against whatever `bt_hurt_left`/`bt_miss_left` held BEFORE reset — reproduced directly:
a stale hit-feedback timer of 20, left over from a previous battle, decremented to 19 and queued a
real packet while `bt_phase` was still `BP_INTRO`, before `setup_monsters` had run at all. The
shipped flipbook (`battle_fx_tick`, phase 1b) already guards exactly this ordering; both new tick
routines above now carry the identical guard (`lda <bt_phase / cmp #BP_INTRO / beq ...rts`) —
visible in the code blocks in §12.3 and §13.4.

**This ordering hazard is real but was never a visible bug**, and the design should not overstate
what it would have caused: `draw_battle_screen` calls `vram_reset` on every battle entry
(`engine/battle.asm:387`), which discards any stale queued packet before it is ever displayed, and
returning to the field afterward goes through `redraw_screen`
(`engine/screens.asm:116`), which discards whatever is still queued the same way. The guard closes
a real correctness gap (the packet WAS queued, the timer WAS decremented against stale data) without
it ever having been the source of a visible on-screen glitch — worth fixing regardless, since a
future change to either discard path could turn it into one.

**Timer lifetime across `battle_end` and `player_died`, stated accurately rather than assumed.**
Neither routine clears `bt_hurt_left`/`bt_miss_left` — `battle_end` (`engine/rpg.asm:153-...`)
clears `pc_status`/`game_state`/`enc_step` but not either timer; `player_died`
(`engine/combat.asm:386-...`, reached from a party wipe via `battle_finish`'s own
`jmp player_died`) clears `player_iframes`/`kb_timer`/`script_active`/`talk_ent`/`game_state` but
not either timer either. This is not a gap this design needs to close: it is the IDENTICAL lifetime
`bt_fx_anim` already has (phase 1b, never cleared at `battle_end` or `player_died` either), and the
BP_INTRO guard above is exactly what makes that lifetime safe — whatever either timer holds when a
battle ends (win, flee, or a wipe) sits untouched until the next `setup_monsters` runs, and the new
guard means neither tick routine can act on that stale value in the one-tick window before the reset
lands.

**Interaction with `bt_fx_*` (phase 1b's own flipbook), stated exactly**: the two are independent
state — different zero-page bytes, different arm points (`battle_fx_arm_attack`/`battle_fx_arm_at`
vs `battle_hurt_arm`), different tick and draw routines — and can be live on DIFFERENT slots at the
same time with no interference: a monster's own `attackAnim` flipbook plays over the ATTACKER's
slot (armed before `roll_hit`, so it plays whether the hit lands or misses, per §3.3), while hit
feedback plays over the TARGET's slot once `apply_damage` runs. The one shared concern is `oam_idx`
budget, not correctness — see §13.6.

### §12.5 The wipe_tick / attribute-flash interaction, restated after the round 1 fix

Superseded by §12.3's own dead-check and arm-time fixes above; kept here as the one-paragraph
summary of WHAT is now guaranteed, since §2(e)'s own limitations list and round 1's review both
pointed at this exact interaction.

A lethal hit sets `bt_wipe_mask`'s own bit for that slot (`apply_damage_mon`,
`engine/battleturn.asm:988-1019`), and `wipe_tick` (`engine/battle.asm`, unchanged) starts erasing
that monster's block art one row a tick, via its own `vram_buf` packets, starting the NEXT tick
(`wipe_tick` runs before `apply_damage_mon` could ever set the bit on the SAME tick, since
`battle_tick` calls `wipe_tick` first, before `battle_dispatch` — so the wipe always starts a tick
after death, never the same one). **The attribute cell for a monster that dies while flashing is now
always left at `BT_GROUND_ATTR`**, restored either by `battle_hurt_tick`'s own dead-check (the
common case: nothing else touches the shared pair before its next tick) or by
`battle_hurt_restore_slot` (the less common case: something else re-arms the shared pair onto a
different target before the tick routine gets another chance) — never left holding a stale flash or
authored tint. See §12.6 for the `vram_buf` byte cost this adds.

### §12.6 vram_buf accounting

**Round 1 P2 finding 3 — the first draft's own "at most one packet a tick" claim was false for the
real design.** Every restore this section can queue (the tick routine's own terminal/dead-monster
restore, AND `battle_hurt_restore_slot`'s own arm-time restore) is a real, separate `vram_buf`
producer, and `cast_all`'s own loop (`engine/battleturn.asm:387`) can call `apply_damage`, and so
`battle_hurt_arm`, up to four times in one tick — once per living target of an all-target spell.
Recomputed exactly, distinguishing what is *reachable* from what is merely *conservative*:

- **The tick routine's own packet**: at most one a tick (the flash/restore/dead-restore branches in
  §12.3 are mutually exclusive with each other) — 4 bytes.
- **Arm-time restores**: `cast_all`'s own loop can supersede the shared pair up to 4 times in one
  tick (living targets 1 through 4, each potentially restoring the PREVIOUS target's own cell) — up
  to 4 × 4 = 16 bytes.
- **Combined hit-feedback worst case this tick: 5 packets, 20 bytes** — matching round 1's own
  independently-derived figure exactly. This part was already correct.

**Round 2 P2 finding 1 — the "reachable schedule" combined the WRONG two chains, and a larger real
schedule exists.** The first-fix draft claimed hit feedback's own 20 bytes combines with "the
92-byte `battle_message_done` → status-tick → `battle_say` chain (§3.4)" because `cast_all` "always
ends by calling `battle_say_actor`... in the SAME tick." That premise conflated two different
things: `cast_all` ends by calling `battle_say_actor` directly (`engine/battleturn.asm:404-406`) —
it never reaches `battle_message_done`, `clear_message`, or the status-tick dispatch at all, since
those only run when a PREVIOUS message is being dismissed, on whatever LATER tick that dismissal
happens, not the tick `cast_all` itself queues its own message. The two chains cannot coincide the
way the first draft claimed.

**`cast_all`'s own message costs 28 bytes, not 92** — `battle_say`'s two packets
(`engine/battleui.asm:589-608`): the name row (3-byte header + `NAME_LEN` = 10 data bytes = 13) and
the string row (3-byte header + `MSG_COLS` = 12 data bytes = 15), 13 + 15 = 28. Reproduced directly
against the assembled prototype: an already-armed hurt slot 7, superseded by an all-target spell
over slots 4-7, queued five 4-byte feedback packets (20 bytes) plus the 13- and 15-byte message
packets — **48 bytes**, not the previously claimed 112.

**A genuinely larger reachable schedule exists, found by driving real dispatcher transitions rather
than assuming the largest single chain is the largest reachable total.** Six consecutive
`battle_tick` calls: an all-target spell kills three monsters and leaves the fourth alive and
flashing; A dismisses the resulting message; the next party member's own turn opens the menu; Down
selects MAGIC; A opens the spell list; B closes it (`battle_list_back`,
`engine/battleui.asm:325-330`). On that LAST tick, three real producers queue in the same frame:
the still-owed wipe row for one of the three dead monsters (11 bytes, `wipe_tick`, which runs before
`battle_dispatch` every tick — `engine/battle.asm:233`), the still-live flash on the fourth monster
(4 bytes), and `battle_list_back`'s own 112-byte chain (§3.4, unchanged) — **11 + 4 + 112 = 127
bytes**, using only real, ordinary dispatch transitions, no impossible fifth monster or
simultaneous-menu-and-damage-loop assumption. This design deliberately does not cap hit feedback on
message dismissal (§12.4), which is exactly why a still-flashing monster can survive long enough to
coincide with a LATER, unrelated menu action.

**Per-dispatcher-case UPPER BOUNDS, replacing the single (wrong) 112-byte figure** — round 3 finding
3: these are arithmetic sums of each case's own worst-case terms, not all four independently shown
to be constructible game states; only the first two rows below are DEMONSTRATED reachable (§12.6's
own repro above, and §14's own test rows), the last two are conservative sums only:

| Dispatcher case | Producers | Bytes | Reachability |
|---|---|---|---|
| Menu/list-back, a wipe and a flash still owed | `battle_list_back` (112) + wipe (11) + flash tick (4) | **127** | **Demonstrated** — the six-tick sequence above |
| An all-target spell's own message, its own worst feedback | `cast_all`'s own message (28) + tick (4) + four re-arm restores (16) | **48** | **Demonstrated** — the old-slot-7/targets-4-7 repro above |
| A dismissed message's own status-tick chain, one re-arm, a wipe | status chain (92) + tick (4) + one re-arm restore (4) + wipe (11) | **111** | Upper bound only, not shown reachable |
| An all-target spell's own message, its own worst feedback, a wipe | `cast_all`'s own message (28) + tick (4) + four re-arm restores (16) + wipe (11) | **59** | Upper bound only, **not constructible as stated** |

**The 59-byte row cannot actually happen the way it is summed.** Four re-arm restores need four
DISTINCT, LIVING monster targets in the same `cast_all` volley (`cast_all` skips dead targets via
`combatant_alive_x`, `engine/battleturn.asm:393-398`) — but there are only `MAX_MONSTERS = 4` monster
slots total (`engine/constants.asm:556`). A pending wipe row needs a DIFFERENT monster that already
died on an EARLIER tick (`wipe_tick` runs before `battle_dispatch`, `engine/battle.asm:233`, so a
kill from THIS SAME volley cannot supply THIS SAME tick's own wipe row — that death's wipe only
starts NEXT tick). With only four monster slots, "four living targets for the re-arms" and "a fifth,
already-dead monster mid-wipe" cannot both be true at once — the two terms this row sums are
mutually exclusive states of the same fixed-size monster roster, not two things that can coincide.
The 111-byte row is not similarly disproven, but is likewise not independently demonstrated — it is
kept as a conservative upper bound only, the identical epistemic status the 143-byte combination
below already has.

**127 bytes is the largest DEMONSTRATED reachable total**; the 143-byte conservative combination
below still bounds it with room to spare, so the correction changes which schedule is cited as
reachable, not the safety conclusion:

**The fully conservative combination**, matching §3.4's own existing discipline (which already
states the menu-chain-plus-wipe combination as "conservative, not demonstrated reachable" rather
than asserting it cannot happen): the existing 123-byte figure (112-byte menu chain + 11-byte
`wipe_monster` row, §3.4) plus this section's own 20 bytes gives **143 bytes** — comfortably inside
`vram_buf`'s 256-byte capacity before the shared `$00` terminator. **143 bytes still safely bounds
the largest reachable schedule found (127)**, so neither establishes an overflow; the correction is
a reachability/accounting fix, not a newly discovered risk.

A test observing queue length/packet count directly at the real dispatcher transitions above (not
just a stable PPU byte, which cannot by itself distinguish "no packet queued" from "the same value
queued twice") is in §14.

### §12.7 Gating and the ledger

**Measured, real prototype** (Appendix D; methodology below). Built on top of the phase 1b
checkpoint (`c4e67c8`) in a `git worktree add --detach` scratch copy, unconditional (no `.if` gate,
the identical measurement-only shape Appendix A/B/C already used), against `sample-rpg` on all three
RPG-capable boards, with both `renamable` flags forced off (`test/unit/bankedbytes.test.js`'s own
`measureRegion` convention):

| board | off (phase 1b baseline) | on (hit feedback alone, round 1 fixes) | delta |
|---|---|---|---|
| MMC1 (mapper 1) | 4294 | 4529 | 235 |
| MMC3 (mapper 4) | 4334 | 4569 | 235 |
| UNROM 512 (mapper 30) | 4294 | 4529 | 235 |

**235 bytes, flat, on all three boards** — up from the pre-fix design's own 204, the +31 bytes being
exactly the round 1 correctness fixes above: `battle_hurt_tick`'s own `BP_INTRO` guard (one
routine — `battle_miss_tick`'s own guard is the OTHER routine, and belongs to MISS's own +6, §13.6,
since this variant has no MISS code at all to carry it), the ground-default restore path in both
the tick routine and the arm-time restore, and the register-preservation rework that replaced
`bt_tmp2` parking with a re-read. Measured in isolation by building a second copy of the prototype
with every MISS-specific addition removed (§13 has no code in this variant at all), so this figure
is hit feedback's own cost, not a share of the combined total. The banked-region
ledger entry this becomes, the identical shape `BATTLE_ANIM_BATTLE_ALLOWANCE` already established:

```js
// main/build/battletables.js
export const HIT_FEEDBACK_BATTLE_ALLOWANCE = 235; // measured, §12.7 -- flat, all three boards
```

**Schema (Chris's own §8 answers 1 and 2, v5.1).** `project.rpg.hitFeedback: boolean`, defaulting to
`false` — `defaultRpg()` (`shared/project.js:4223-4231`) gains the field, and `normalizeRpg`
(`shared/project.js:5490-5499`) normalizes it as `Boolean(raw?.hitFeedback)`, the identical shape
`renamable`'s own boolean normalization already takes elsewhere in this schema. No reconciliation
and no new `validateProject` refusal: unlike `battleTilesetId` (clamped against `tilesetCount`) or
the cartridge fields `reconcileCartridge` exists for, a plain boolean with two always-legal states
needs neither — the same reason `BATTLE_ANIM_ENABLED`'s own gate (driven by `attackAnim`/`spell.anim`
content, not a toggle field, but equally reconciliation-free) needs none either. **UI**: the Build
Forge's own "RPG progression" panel, `rpgProgression(project)`
(`renderer/forges/build/build.js:54-103`) — the panel this document's own comparable project-level
RPG settings (`xpBase`, `xpGrow`, `maxLevel`, `battleTilesetId`) are already edited in, using its
existing `number()`/`select` field helpers for those; this field is the panel's first BOOLEAN one,
so it follows the `label.check` + `input[type=checkbox]` idiom the Character Forge's own
`renamable` checkbox already uses (`renderer/forges/character/character.js:278-302`) rather than
inventing a second checkbox shape. The predicate:

```js
// shared/project.js, beside projectUsesBattleAnimation
export function projectUsesHitFeedback(project) {
  return project.project.gameType === 'rpg' && Boolean(project.rpg?.hitFeedback);
}
```

**A `gameType === 'rpg'` check IS required here — round 6's own finding, correcting round 5's own
mistake below.** Round 5 argued this predicate needed no gating because `battleRegionBytes` (its
only battle-region consumer) is only ever reached for an RPG project with an allocated battle
region (`codeRegions().length > 0` implies `rpgCapable`) — true as far as it goes, but incomplete:
`HIT_FEEDBACK_ENABLED` is not only wired into `battleRegionBytes`, it is also generated straight
into `config.inc` (below, "Generated flag and gates") the identical `FLAG = predicate(project) ? 1
: 0` shape every other feature flag in this codebase uses — and `config.inc` is written for every
project (`main/build/generate.js:3168`, `:3172`) and `.include`d by `engine/main.asm:32`
unconditionally, action projects included. A boolean-only `projectUsesHitFeedback` therefore made an
action project carrying `rpg.hitFeedback: true` generate `HIT_FEEDBACK_ENABLED = 1` in its own
`config.inc` — reproduced directly by the round-6 review against the real generator. This has no
runtime or artwork consequence (every routine `HIT_FEEDBACK_ENABLED` gates lives entirely inside the
battle source, which stays excluded from an action build's own assembled sources regardless of the
config flag's value, per `main/build/generate.js:2757`, `:2865`), but the generated flag and this
document's own prior claim about it were still wrong. Gating the predicate on `gameType === 'rpg'`,
the identical shape `projectUsesMiss` (§13.9) now takes, closes it at the same single point:
`HIT_FEEDBACK_ENABLED`'s own emission, `battleRegionBytes` (below), and `battleShortfallAdvice`
(below) all call `projectUsesHitFeedback`, none of them reads `project.rpg.hitFeedback` directly.
`normalizeRpg` keeps storing the boolean exactly as written on every project — no destructive
rewrite, no new `validateProject` refusal, and the 235-byte `HIT_FEEDBACK_BATTLE_ALLOWANCE` is
unchanged (this predicate's RPG-only consumer, `battleRegionBytes`, was never reachable from an
action project either way; only the generated config flag was).

Gated on `projectUsesHitFeedback` and wired into `battleRegionBytes`
(`main/build/battletables.js:974-987`) the identical no-`&& banked` shape
`BATTLE_ANIM_BATTLE_ALLOWANCE` already uses. **No kernel-lo term at all** — every routine in §12.3
lives entirely in the banked battle region; nothing here is reachable from the field. No OAM cost at
all (the sprite-blink half only ever *skips* drawing an icon already counted in
`battleCombatantOamMax`, never adds one — unlike MISS, §13.6, whose OAM terms are entirely
`MISS_ENABLED`'s own territory; `HIT_FEEDBACK_ENABLED` gates nothing in §13.6 at all. The `vram_buf`
cost is bounded in §12.6, not zero as the pre-fix design claimed.

**Shortfall advice.** `battleShortfallAdvice`'s own `bankedFeatures` list
(`main/build/battletables.js:1101-1137`) gains:

```js
// main/build/battletables.js -- battleShortfallAdvice, beside the battle-animation entry
if (battleBankEnabled(project, mapper) && projectUsesHitFeedback(project)) {
  bankedFeatures.push({ label: 'hit feedback', strip: projectWithoutHitFeedback });
}
```

`projectWithoutHitFeedback` (`shared/project.js`, beside `projectWithoutBattleAnimation`) clones the
project and sets `rpg.hitFeedback = false`, the identical shape every other strip helper in that
family already takes.

**Generated flag and gates, stated exhaustively — nothing MISS-specific may key off this one.**
`HIT_FEEDBACK_ENABLED` (`main/build/generate.js`, emitted into `config.inc` the identical
`FLAG = predicate(project) ? 1 : 0` shape `BATTLE_ANIM_ENABLED` already is) gates, and ONLY gates:
`battle_hurt_arm`/`battle_hurt_attr_open`/`battle_hurt_tick`/`battle_hurt_restore_slot` and their
call sites (`apply_damage`, `battle_tick`, §12.3); `battle_sprite_pc`/`battle_sprite_mon`'s own
blink-skip checks (§3.3/Appendix B's mechanism, existing routines gaining a new gated branch); and
its own half of `setup_monsters`' reset (§12.4, and see the ledger decision below for why this half
gets its OWN `lda #0` rather than sharing one with MISS's). It gates NOTHING in §13 — no MISS art,
no MISS tick/draw/arm routine, no reservation range, no OAM term, no warning-text clause. The
equates themselves (`bt_hurt_slot`/`bt_hurt_left`/`BT_HURT_FRAMES`) are NOT gated by it at all —
they stay unconditional, per §7's own corrected treatment.

**Ledger decision (v5.1) — two independent gates cannot keep the single shared `lda #0` that
produced the measured 367.** §11's own bullet already identifies the 2-byte gap: `setup_monsters`'
combined reset shares one `lda #0` between `sta <bt_hurt_left` and `sta <bt_miss_left`, which a
single unconditional (or single-flag-gated) build can do freely, but two INDEPENDENT flags cannot —
if `HIT_FEEDBACK_ENABLED` alone is on, only `bt_hurt_left`'s own store may assemble, and the shared
`lda #0` immediately before it either has to be duplicated (paid by whichever flag is on) or kept
behind some OTHER conditional that reasons about both flags at once. Two ways to resolve this,
decided here:

- **(i) Separate the two resets under their own `.if` blocks — chosen.** Each half pays its own
  `lda #0`/`sta` (4 bytes each), so `HIT_FEEDBACK_BATTLE_ALLOWANCE` (235) and `MISS_BATTLE_ALLOWANCE`
  (134, §13.9) stay exactly as measured in isolation, and the combined, both-on figure becomes a
  clean sum — **369**, not 367. This costs 2 more ROM bytes than the single-flag design when both
  are live, in exchange for the two ledger terms being genuinely independent: no interaction term to
  keep in sync, and `battleShortfallAdvice`'s own `bankedFreed` (which recomputes `battleRegionBytes`
  before/after a strip, never sums named constants) frees EXACTLY 235 or EXACTLY 134 when either
  toggle is removed, matching its own named allowance with no asterisk.
- **(ii) Keep the shared `lda #0`, guarded on `HIT_FEEDBACK_ENABLED || MISS_ENABLED`, with a negative
  interaction term** (`HIT_MISS_SHARED_RESET_ALLOWANCE = -2` or similar, applied only when both
  flags are live) — considered, not chosen. `STING_SFX_INTERACTION_ALLOWANCE`
  (`main/build/generate.js:1075`) is this codebase's only existing interaction-term precedent, and it
  is POSITIVE: real glue code (`sting_restore_silence`'s own ownership guard) that only exists,
  functionally, when both Sting and Sfx are live — not an accounting correction for a hand-tuned
  byte-saving optimization. A negative interaction term here would be a different kind of thing: it
  exists purely because the reset was WRITTEN to share an instruction, not because sharing it is
  functionally required (each `sta` clobbers nothing the other needs, so nothing stops them from
  being independent stores). It would also make `bankedFreed([hitFeedback])` free 233, not 235, when
  MISS is also live — correct by construction (it recomputes the real total either way) but a real
  reader-facing subtlety this document would then have to explain, which option (i) has no need of.

**Recommendation, and why: option (i).** Two bytes of ROM is a rounding error next to either
allowance; genuine gate independence — each term measured, named, and freed in isolation with no
interaction correction anywhere in this ledger — is worth more than the 2-byte saving, and matches
Chris's own answer 2: choosing two INDEPENDENT toggles is itself a signal that independence is the
property being asked for here, not an optimized-but-coupled combination. **The implementation phases
for 2a and 2b must each re-measure their own term, and phase 2b must additionally re-measure the
combined both-on total, with `bankedbytes.test.js` equality assertions (`assert.equal`, not a margin
check, the identical discipline every other banked-region term in this ledger already holds to) on
MMC1, MMC3 and UNROM 512** — this section states the DECISION and its expected consequence (369, not
367), not a substitute for building and measuring the real `.if`-separated code once phase 2b exists.
Appendix D's own diff (frozen, unconditional, single-build) is not proof of this figure — see its own
intro paragraph, corrected below, for how to read it now.

See §13.9 for MISS's own schema, gate, ledger term (134) and shortfall-advice entry, and the ledger
decision above for why the combined figure is 369, not the single-flag prototype's 367.

## §13. Phase 2b — MISS, a new design

Chris's own answer 3 (§10): when an attack misses, the text MISS must appear next to the monster or
party sprite that was missed. Unlike hit feedback (§12), phase 1 shipped nothing for this — every
piece below is new.

### §13.1 Where a miss can happen — evidence from the code

Searched every `roll_hit` call site and every damage-application path (`engine/battleturn.asm`) for
anywhere a hit can fail to land:

- **`attack_target`** (`:267-274`) — a party member's own plain attack. `roll_hit`, `bne
  attack_missed`.
- **`monster_turn_attack`** (`:1255-1266`) — a monster's own plain attack, the "real, and only,
  physical-attack path" per its own comment. `roll_hit`, `bne monster_missed`.
- **`spell_damage`** (`:897-...`), reached from `cast_spell_dmg`/`cast_all` — **never calls
  `roll_hit`**. A spell's own damage always lands; only its *amount* varies (magic power/defence,
  the element modifier). Confirmed by reading the routine in full: the roll it performs is
  `roll_spell_amount`, not `roll_hit`.
- **`cast_heal`** (`:415-...`) — no `roll_hit`; a heal always lands.
- **`poison_target`/`cast_poison`, `burn_target`/`cast_burn`** (`:472-...`) — no `roll_hit`; a
  status effect always lands.
- **`poison_tick`/`burn_tick`** (`engine/battleui.asm`'s own status dispatch calls these,
  `battleturn.asm:605-629`) — self-damage (`bt_target` is set to `bt_actor`, the afflicted
  combatant itself), no `roll_hit`. A status tick cannot miss because it has no target to evade.

**Round 1 finding 6 — the non-miss exclusions, named explicitly rather than left implicit.** Two
more failure paths exist that superficially resemble a miss (an action that does not do what it
normally would) but are NOT attack-evasion misses and must not trigger the MISS overlay:

- **`item_chosen_none`** (`engine/battleturn.asm:257-260`) — using an item with no heal effect
  (`kind != heal` or `amount == 0`, under `ITEMS_ENABLED`) or, under the flat economy, an actor with
  no `mon_heal`. Prints `BS_NOTHING`. No `bt_target` evasion is involved, and — round 2 finding
  6 — the item is not consumed either: `item_chosen`'s own `beq item_chosen_none` branches around
  `jsr remove_item` (`:232-235`) before it ever runs, so the failure path only clears the message
  and prints the "no effect" line; the inventory is untouched.
- **`battle_menu_failed`** (`engine/battleui.asm:216-218`) — a prohibited or failed flee attempt
  (`battle_menu_flee`'s own `rng_next` roll, `:209-211`). Prints `BS_NORUN`. There is no dodging
  combatant at all; running away is a property of the whole encounter, not an attack on a target.

Neither path calls `roll_hit`, sets `bt_target` to a combatant being evaded, or reaches
`attack_missed`/`monster_missed`; neither should ever arm `battle_miss_arm`, and this design does
not wire either one to it.

**Conclusion: exactly two miss paths exist, both physical attacks, both party-vs-monster or
monster-vs-party — never a spell, never a status tick, never an item or flee failure.** This has a
real consequence for the design below: because this is a turn-based system where exactly one
combatant acts per turn, and only a physical attack (a single-target action) can ever miss, **at
most one MISS can ever be live at a time** — the "two misses landing close together" question the
brief raised cannot actually arise from the ENGINE's own turn structure. (Round 1's own "other
conclusions" note is more precise than this document's first draft was: consecutive turns CAN each
produce their own miss, one after another; it is specifically the message-dismissal cap in §13.4,
not turn-based scheduling by itself, that keeps one miss's own overlay from ever overlapping the
next one's.) No queueing or multi-slot policy is needed for MISS at all, unlike hit feedback's own
multi-target question (§12.3), which arises specifically because an all-target *spell* can hit
several combatants in one tick and spells never miss.

### §13.2 RAM

Two more zero-page bytes, chained after hit feedback's own pair:

```asm
bt_miss_slot = bt_hurt_left+1   ; the single most recent miss's target
bt_miss_left = bt_miss_slot+1   ; countdown, from BT_MISS_FRAMES
BT_MISS_FRAMES = 30
```

**Why not merge with `bt_hurt_*`?** A miss and a landed hit are mutually exclusive per action
(`apply_damage` is never reached on the miss paths, §13.1), so at first glance one shared pair could
cover both. Rejected: `bt_hurt_left` is deliberately NOT capped at message dismissal (§12.4's own
reasoning — it is purely time-based and short enough that letting it run past an early dismissal is
harmless), while MISS specifically must be capped there (§13.4) or a stale "MISS" label would still
be reading a target from the turn before. Two different lifetime rules cannot share one timer
without either compromise; two bytes is a small price for keeping both rules exact.

**Round 1 finding 8's own re-chaining note, corrected by v5.1 §7 now that the real project has two
independent gates.** `bt_miss_slot`'s own definition (`= bt_hurt_left+1`) depends on `bt_hurt_left`
existing as a declared equate — true always, in the real shipped engine, regardless of
`HIT_FEEDBACK_ENABLED`/`MISS_ENABLED`, since §12.2/§7 both establish that this equate DECLARATION
carries no `.if` of its own (the identical unconditional shape `bt_fx_anim` already has) and costs
zero ROM bytes whether or not any gated code ever reads or writes it. So a real project shipping
`MISS_ENABLED = 1` with `HIT_FEEDBACK_ENABLED = 0` — a legal, real combination now that the two
gates are independent, §7's own toggle-combination table — needs NO re-chaining: `bt_hurt_left`
is still there to chain onto, unread and unwritten but present. Re-chaining `bt_miss_slot` to
`bt_fx_timer+1` directly is needed ONLY for the ISOLATED MEASUREMENT variants §11 describes and
Appendix D's own figures come from — scratch copies where hit feedback's own equate LINES are
physically deleted from the source (not merely gated) purely to measure MISS's allowance in
isolation; deleting a source line is not the same as gating the code around it, and no real shipped
project ever does the former. Both isolated variants Appendix D's own figures come from do this
re-chaining as part of stripping the other half's own lines out; it is not automatic and must be
done by hand each time such a measurement copy is built, since nesasm has no notion of "chain to
whichever of these two symbols happens to exist" — but this is a measurement-methodology detail,
never a real toggle-combination's own concern.

### §13.3 Where the glyphs come from — costed, recommended

Two real candidates, both traced against real constraints rather than assumed:

- **(a) Background tiles, reusing the resident font (`$A0-$FF`, `shared/font.js`)** — the same
  mechanism every other piece of battle text already uses (`battle_say`, `print_num`). Rejected for
  the field (the monster/party rows, `BT_MON_ROW`/`BT_PARTY_Y`): on a split-font board
  (`fontBankSplit`, MMC3), the font lives in a *separate* CHR page that `split_select` maps in only
  below the split rows — the message box (row 24), the battle box (row 20), the title's two text
  bands (CLAUDE.md's own "MMC3's scanline IRQ" passage). The field rows (4-19, where every combatant
  stands) are OUTSIDE that window, painted from the *combatant* tileset's own CHR page instead — the
  identical reason `SPRITE_ARROW_TILE`/`engine/battleui.asm:65-93`'s own targeting cursor is a
  BACKGROUND tile everywhere except a split-font RPG board, where it becomes a sprite specifically
  because it points at a monster above the box. Writing an `$A0-$FF` tile id into the field on MMC3
  would display whatever art the *combatant* tileset happens to have at that index, not a letter —
  silent garbage, not a build error. Genuinely safe on the other two boards (MMC1, UNROM 512 have no
  separate font page at all — the font is co-resident everywhere), but not board-uniform, so shipping
  it would mean two different mechanisms gated on `fontBankSplit`, mirroring the cursor's own
  precedent exactly.
- **(b) Sprite tiles — recommended.** Sidesteps the whole font-page question: sprites are drawn from
  their own, separately-mapped pattern table, so where the BG CHR page happens to be pointed is
  irrelevant. Also sidesteps restoration entirely — a sprite that stops being drawn (timer reaches 0)
  needs no "put back what was there," unlike a background write, which would need to know the exact
  tile that was under it (trivial over the flat `map_battle_ground`/`map_battle_sky` fill
  `draw_battle_screen` paints everywhere except a monster's own block art, but NOT trivial over that
  block art itself — `draw_mon_block`, `engine/battle.asm:625-...`, grows an author's own tiles down
  and right from each monster's anchor, up to `RPG_LIMITS.battleArtTiles` = 12 tiles either
  dimension, so there is no single, uniform "restore" tile the way the attribute flash's own
  `mon_attr,y` byte is). Costs: 3 new sprite tiles (M, I, S — the second S in "MISS" reuses the
  first), reserved the identical way `SPRITE_ARROW_TILE` already is (§13.5), and OAM room for 4
  sprites while armed (§13.6). **Recommendation: (b), uniformly on every board** — not (a)'s
  per-board split — because a floating "MISS" specifically wants consistent, board-independent
  behaviour (it is new content every project would see, not an internal mechanism like the cursor
  that already has an established board-split precedent), and sprites-over-anything (block art,
  ground, another sprite) need no placement-avoidance logic at all, since the NES's own
  lower-OAM-index-wins priority makes MISS legible regardless of what is underneath it — subject to
  the OAM-budget limitation §13.6 states honestly.

The live battle sprite patterns for either option come from `BATTLE_TILESET`
(`engine/battle.asm:391`); MMC3 maps that tileset's own sprite pages independently of the BG split
(`engine/banks.asm:64`), and MMC1/UNROM 512 select or load the identical tileset the same way — so
option (b)'s own reservation applies uniformly to the one tileset a battle actually draws from, on
every board, with no split-specific exception of its own (unlike option (a)).

### §13.4 The engine, complete

**Arming**, from both miss branches, since `bt_target` already names who dodged at both call sites
(`roll_hit`'s own comment: "an underflow is a miss"):

```asm
; engine/battleturn.asm
attack_missed:
  jsr battle_miss_arm
  lda #$FF
  sta <bt_dmg_hi             ; no number on this line
  lda #BS_MISSES
  jmp battle_say_actor

battle_miss_arm:
  lda <bt_target
  sta <bt_miss_slot
  lda #BT_MISS_FRAMES
  sta <bt_miss_left
  rts
```

(`monster_missed` gets the identical `jsr battle_miss_arm` inserted the same way.)

**Ticking**, from `battle_tick` alongside `battle_hurt_tick` — no `vram_buf` work at all, since MISS
is sprite-drawn. Guarded on `BP_INTRO` for the identical reason `battle_hurt_tick` is (round 1
finding 7, §12.4):

```asm
battle_miss_tick:
  lda <bt_phase
  cmp #BP_INTRO
  beq battle_miss_tick_rts
  lda <bt_miss_left
  beq battle_miss_tick_rts
  dec <bt_miss_left
battle_miss_tick_rts:
  rts
```

**Drawing**, from `battle_draw_sprites` right after the flipbook (`battle_fx_draw`, §3.3) and before
the combatant-icon loops — the identical "draw first, while `oam_idx` is still low, for foreground
priority" rule §3.3 already established, so MISS is never hidden behind the icon it names:

```asm
; engine/battleui.asm
battle_miss_draw:
  lda <bt_miss_left
  beq battle_miss_draw_rts
  lda <bt_miss_slot
  cmp #MAX_PARTY
  bcs battle_miss_draw_mon
  lda <bt_miss_slot
  asl a
  asl a
  asl a
  asl a
  asl a                     ; slot * BT_PARTY_STEP
  clc
  adc #BT_PARTY_Y-8         ; one tile above the icon's own anchor row
  sta <bt_tmp
  lda #BT_PARTY_X
  jmp battle_miss_draw_go
battle_miss_draw_mon:
  lda <bt_miss_slot
  sec
  sbc #MAX_PARTY
  asl a
  asl a
  asl a
  asl a
  asl a                     ; monster slot * 32 pixels
  clc
  adc #BT_MON_ROW*8-8
  sta <bt_tmp
  lda #BT_MON_COL*8
battle_miss_draw_go:
  sta <bt_tmp2
  ldy <oam_idx
  ldx #0
battle_miss_draw_cell:
  lda <bt_tmp
  sta OAM,y
  iny
  lda miss_tiles,x
  sta OAM,y
  iny
  lda #0
  sta OAM,y
  iny
  lda <bt_tmp2
  sta OAM,y
  iny
  clc
  adc #8
  sta <bt_tmp2
  inx
  cpx #4
  bne battle_miss_draw_cell
  sty <oam_idx
battle_miss_draw_rts:
  rts

miss_tiles:
  .db MISS_TILE_M, MISS_TILE_I, MISS_TILE_S, MISS_TILE_S
```

**Placement, reasoned rather than measured (§8's own open question, §11's own bullet)**: the
identical per-slot anchor math `battle_fx_draw` already uses (`BT_PARTY_X`/`BT_PARTY_Y`/
`BT_PARTY_STEP` for a party slot, `BT_MON_COL*8`/`BT_MON_ROW*8` + slot × 32 for a monster slot),
duplicated rather than factored out of that already-shipped phase-1b routine — a deliberate choice
to keep this addition purely additive against reviewed, shipped code rather than risk regressing it
for a small byte saving. Offset 8 pixels up from the icon's own anchor row, so the glyphs read as
"next to" the sprite Chris asked for rather than dead-centered on it. `draw_mon_block`'s own art
grows DOWN and RIGHT from a monster's anchor (§13.3), never up, so this offset is clear of THAT
monster's own art by construction; a taller PRECEDING monster's block art growing down into a LATER
slot's own row band is a real, accepted possibility at the largest authored sizes — the identical
"accepted limitation" class the attribute flash's own anchored-cell coverage already has (§2(e)),
not something this design tries to solve, since sprites drawn over background art (whatever it is)
remain legible regardless via priority — subject, again, to §13.6's own OAM-budget limitation.

**Message-hold interaction**: `battle_message_done` (`engine/battleui.asm:713-...`, phase 1b's own
`bt_fx_anim` clear site) also clears `bt_miss_left` to 0, unconditionally — the identical cap the
flipbook already gets, and the reason MISS needs its own timer rather than sharing `bt_hurt_left`
(§13.2). `bt_hurt_left` is deliberately NOT capped the same way (§12.4) — a real, stated asymmetry,
not an oversight. This is also the mechanism that makes a SECOND miss, on the very next turn, never
overlap the first one's own overlay: the first miss's own message is dismissed (by timeout or an
early A press) before the next actor's own turn can ever begin, and dismissal is exactly where
`bt_miss_left` is forced to 0 — so `battle_miss_arm`'s own fresh write always starts from a clean
slate, never stacking on top of a still-counting-down previous miss.

**Battle-entry reset**: `setup_monsters` clears `bt_miss_left` to 0 alongside `bt_hurt_left` (§12.4)
— in Appendix D's own single-build measurement prototype, via one shared `lda #0` store (round 1
finding 8's own explanation of the 2-byte measurement gap); in the real, independently-gated
implementation, under its OWN `.if MISS_ENABLED` block with its own `lda #0` (§12.7/§13.9's own v5.1
ledger decision, option (i) — each gate pays for its own reset, so the two stay genuinely
independent). `bt_miss_left`'s own lifetime across `battle_end`/`player_died` is identical to
`bt_hurt_left`'s (§12.4): neither routine clears it, and the `BP_INTRO` guard above is what makes
that safe.

### §13.5 Sprite-table reservation and the generator

**Round 1 finding 5 — the previous draft named the tile IDs in `engine/constants.asm` with no
single JS authority, and the two existing consumers of `spriteReservedRanges` were not range-aware.**
Fixed by mirroring the `SPRITE_ARROW_TILE` precedent exactly, at every point it touches:

**One JS authority.** `shared/font.js` gains the three IDs and their pixel art, beside
`SPRITE_ARROW_TILE`/`SPRITE_ARROW_ART` (`:36`, `:194-197`) rather than in a second module — this is
sprite-table reservation bookkeeping, the identical category the arrow tile already lives in:

```js
// shared/font.js
export const MISS_TILE_M = 0xfa;
export const MISS_TILE_I = 0xfb;
export const MISS_TILE_S = 0xfc;
export const MISS_TILE_M_ART = rowsToTile([...], '1');
export const MISS_TILE_I_ART = rowsToTile([...], '1');
export const MISS_TILE_S_ART = rowsToTile([...], '1');
```

placed to sit beside the existing reservations without colliding: `SPRITE_ARROW_TILE` ($FD, the
battle targeting cursor / naming grid) and the HUD hearts (`$FE`/`$FF`, action-projects-only, never
reserved on an RPG at all — `projectUsesHeartArt` always answers false for an RPG regardless of
`projectUsesCombat`, per CLAUDE.md's own "The engine" passage). The actual pixel art (the `[...]`
row data) does not exist yet — drawing it is implementation work, the identical shape
`SPRITE_ARROW_ART` already is, not a design question.

**Engine equates generated FROM that authority**, the identical shape
`SPRITE_ARROW_TILE = ${hex(SPRITE_ARROW_TILE)}` already is (`main/build/generate.js:3008`) — NOT
hand-typed literals in `engine/constants.asm`:

```js
// main/build/generate.js, beside the existing SPRITE_ARROW_TILE line
`MISS_TILE_M = ${hex(MISS_TILE_M)}`,
`MISS_TILE_I = ${hex(MISS_TILE_I)}`,
`MISS_TILE_S = ${hex(MISS_TILE_S)}`,
```

**The reservation itself**, the `spriteReservedRanges` precedent extended with a third range, gated
on MISS's own `projectUsesMiss`/`MISS_ENABLED` (§13.9, v5.1, RPG-gated as of round 5 — never
`HIT_FEEDBACK_ENABLED`, which gates nothing in this section):

```js
// shared/project.js -- spriteReservedRanges
export function projectUsesMiss(project) {
  return project.project.gameType === 'rpg' && Boolean(project.rpg?.miss);
}
// ...
if (projectUsesMiss(project)) {
  ranges.push({ start: MISS_TILE_M, end: MISS_TILE_S + 1, label: 'the MISS overlay' });
}
```

The `gameType === 'rpg'` check matters specifically for THIS call site: `spriteReservedRanges` is
called from `validateProject` before its own RPG-gate block and from the Tile Forge unconditionally
(§13.9's own v5.1 note has the full round-5 finding and file:line evidence) — an action project must
never reserve or refuse against these three tiles no matter what `project.rpg.miss` holds.

**Stamping**, the `SPRITE_ARROW_ART` precedent (`main/build/generate.js:2672-2673`), applied to all
three MISS glyphs, into every tileset (a project can set ANY tileset as its `battleTilesetId`, so
every one keeps the slots free, the identical reasoning the arrow tile's own stamping already
uses):

```js
// main/build/generate.js
if (projectUsesMiss(project)) {
  for (const tileset of tilesets) {
    tileset.sprites[MISS_TILE_M] = MISS_TILE_M_ART;
    tileset.sprites[MISS_TILE_I] = MISS_TILE_I_ART;
    tileset.sprites[MISS_TILE_S] = MISS_TILE_S_ART;
  }
}
```

**The two EXISTING consumers of `spriteReservedRanges` must become range-aware, not just
range-counting.** Both currently branch on a literal string equality against `'the HUD hearts'` and
otherwise assume the range IS the cursor — true today (only two ranges ever coexist, per
CLAUDE.md's own "Never more than two ranges at once" note), false the moment a third range exists:

```js
// shared/project.js:6563-6567 -- validateProject's occupied-artwork refusal, TODAY
const message =
  range.label === 'the HUD hearts'
    ? `Tileset "${tileset.name}" has artwork in the last two sprite tiles, which the HUD hearts reserve ` +
      'while anything in the project can hurt the player.'
    : `Tileset "${tileset.name}" has artwork in sprite tile $${range.start.toString(16).toUpperCase()}, ` +
      'which the battle targeting cursor reserves on this cartridge.'; // WRONG for the MISS range
```

```js
// renderer/forges/tile/tile.js:415-419 -- the Tile Forge shading hint, TODAY
range.label === 'the HUD hearts'
  ? `Tiles $${HEART_FULL_TILE...}–$FF are shaded because this project can hurt the player: ...`
  : `Tile $${SPRITE_ARROW_TILE...} is shaded because this project's battle system reserves it ` +
    'for the targeting cursor, ...'; // WRONG tile id AND wrong reason for the MISS range
```

Both need a real per-label message (or a small label→message map keyed by `range.label`, since
`spriteReservedRanges` already emits a distinct label per range) rather than a binary "hearts or
cursor" branch, so an author with MISS-slot artwork sees "the MISS overlay reserves" naming the
RIGHT tiles ($FA-$FC) and the RIGHT reason, not a stale claim about the cursor at the wrong address.
This is implementation work with a clear shape (the branch becomes a lookup on `range.label`, one
more arm), not a further design decision.

**The author cost, stated honestly**: three sprite indices unavailable in **every** tileset of an
opted-in project — not merely the currently-selected battle tileset, since `battleTilesetId` can
change later and every tileset must keep the slots free regardless (the identical reasoning
`SPRITE_ARROW_TILE`'s own stamping already applies). 48 bytes of CHR art (3 tiles × 16 bytes) inside
already-allocated tileset payloads, not additional payload size.

### §13.6 OAM accounting

**MISS costs a FIXED 4 tiles when armed, never variable** — unlike the flipbook (§3.6), whose own
frame size depends on what an author painted, MISS is always exactly `M`+`I`+`S`+`S`:

```js
// shared/project.js
export const MISS_OAM_TILES = 4;
```

**Both MISS and a playing `attackAnim` flipbook can need room in the same tick — confirmed, not
assumed**: `monster_turn_attack` arms the flipbook (`battle_fx_arm_attack`) BEFORE `roll_hit`
(`engine/battleturn.asm:1255-1266`, phase 1b's own comment: "the swing plays whether the hit lands
or misses") — so on a miss, the ATTACKER's own flipbook is still ticking/drawing on the exact same
tick MISS arms over the TARGET. `BATTLE_FX_OAM_ROOM`'s own formula reserves room for both, not just
the combatant/cursor worst case:

```js
// main/build/generate.js -- was: MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper)
const battleFxOamRoom = Math.max(
  0,
  MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper) - MISS_OAM_TILES
);
```

`battle_fx_draw`'s own fit check (`cmp #BATTLE_FX_OAM_ROOM+1`, §3.3) needs no code change —
pre-subtracting `MISS_OAM_TILES` at the SAME point `battleCombatantOamMax` is already subtracted
means the flipbook's existing check automatically leaves MISS its own reserved room too, whenever
the flipbook and MISS both need to fit alongside the SAME worst-case combatant total.
`battleSpriteBudget`'s own `used` figure (§3.6) gains the identical flat addition:

```js
// shared/project.js -- battleSpriteBudget, was: battleCombatantOamMax(...) + fxTiles
return { used: battleCombatantOamMax(project, mapper) + fxTiles + MISS_OAM_TILES, limit: MAX_OAM_ENTRIES };
```

gated the same way as the rest of §13 (only when `projectUsesMiss`, §13.9, v5.1 — never
`HIT_FEEDBACK_ENABLED`, which has no OAM term of its own at all, §12.7) — a project that never opts
into MISS pays nothing here either, the identical byte-identity discipline `fxTiles` itself already
holds to when no battle animation is authored. `validateProject`'s own gate is
`battleBudget.used > battleBudget.limit` (`shared/project.js:7402`, strictly greater — `used == 64`
does not warn), which is what §14's own test rows below assert through, not the raw formatted string
`describeBattleSpriteWarning` returns (`shared/project.js:3750`) — that function is an unconditional
formatter, not a gate, and can be called on a budget that never triggers a warning at all.

**Round 1 P2 finding 4, corrected by round 2 finding 2, and corrected again by round 3 finding 5 —
MISS's fixed cost is a real, additional OAM consumer with no exception.** The first fix draft
claimed "MISS does not make a project's pre-existing combatant overflow worse," and round 2's own
fix narrowed that claim to "true only for a project whose combatants ALONE already exceed 64" —
still false. `MISS_OAM_TILES` (4) is added to `battleSpriteBudget`'s own total unconditionally once
the feature is enabled, so it changes the total in EVERY case, with two genuinely different
consequences that must not be conflated:

- **Newly introduced overflow** — a project whose combatants alone sit in **61-64** fits today (no
  warning); adding MISS's own 4 tiles pushes the total to **65-68**, a warning that did not exist
  before this feature. `MISS_OAM_TILES` is the entire cause here, not merely present alongside a
  pre-existing problem.
- **Increased existing overcommitment** — a project whose combatants alone ALREADY exceed 64 (say,
  65) still warns either way (warning PRESENCE is unchanged, true), but the real total grows from 65
  to **69** once MISS is added — MORE OAM entries are actually competing for the same 64 hardware
  slots, a larger real exposure even though the boolean "does it warn" answer does not change.
  Warning presence staying the same is not the same claim as the underlying budget or runtime risk
  staying the same, and this document must not conflate the two.

`battle_miss_draw` (§13.4) always writes its four entries unconditionally, at the LOW end of
`oam_idx` (drawn first, for priority) — but `draw_metasprite`'s own tile-copy loop stops only when
the byte-sized `oam_idx` itself wraps past 255 back to 0 (`engine/entities.asm:635`, `:655`), and a
LATER combatant draw call (`battle_sprite_pc`/`battle_sprite_mon`, `engine/battleui.asm:875`,
`:897`) always starts its own count from wherever `oam_idx` currently sits — so once total OAM usage
this tick reaches 64 entries (256 bytes) and wraps, whatever draws AFTER the wrap overwrites
whatever was written at the START. MISS's own four entries are exactly as exposed to this as any
other combatant's, in every case above — never more protected, never less.

**Policy: an explicitly accepted limitation, stated honestly rather than minimized** — advisory, not
a new runtime admission/skip check or a stricter build refusal. A project that opts into MISS and
whose combatants alone sit in 61-64 can newly see `battleSpriteBudget`'s own warning
(`describeBattleSpriteWarning`, gated through `validateProject`'s `used > limit` check) where none
fired before, and — whether the overflow is newly caused by MISS or was already there without it —
the response is identical: a build-time warning, never a refusal, and MISS itself costs the
identical, fixed 16 bytes of OAM every time it draws, never more, regardless of which case applies.
A stricter refusal or a new runtime check would make this phase-2 cosmetic feature the FIRST
mechanism in this codebase to actually solve a class of OAM overflow every other battle-region
feature (the flipbook included) has already, deliberately, left to the same advisory warning. Test
coverage for the exact 60/61/64/65-combatant boundary (no flipbook authored) is in §14, asserted
through `validateProject`'s own warning array.

**Round 2 P2 finding 3 — `describeBattleAnimationOamWarning` must also account for MISS's own 4
entries, or its own explanation stops adding up the moment MISS is what pushes a project over.**
`validateProject` calls this helper whenever `battleSpriteBudget`'s own revised total (now including
`MISS_OAM_TILES`) overflows — but the helper's own text (§3.6) sums only the worst playable
animation's tiles and `battleCombatantOamMax`, with no term for MISS at all. Reproduced: combatants
60, one referenced playable animation at 1 tile, MISS enabled — the real total is 60 + 1 + 4 = 65,
over the limit, so the warning fires; the OLD text would say `"X" (1 sprite tile) plus this
project's own worst-case combatants and cursor (60) would need more than the NES's 64 sprites at
once` — 1 + 60 = 61, which does NOT exceed 64, so the stated reasoning does not itself explain why
the warning fired at all. Fixed by adding MISS's own term to the SAME explanation, present only
when the project has opted in (the off-path text, MISS disabled, is unchanged byte-for-byte):

**Round 3 finding 2 — the pseudocode above did not actually preserve the committed off-path text**:
it changed the committed em dash (`—`) to a plain `--` and dropped the entire trailing advice
sentence ("Use a smaller animation, or reduce the party/formation/cursor cost elsewhere."), so the
claim that MISS-disabled output stays byte-for-byte unchanged was false the moment it was checked
against the real string (`shared/project.js:3865-3871`). Corrected below to change only what the
`missClause` insertion requires, character-for-character identical to the committed string
otherwise:

```js
// shared/project.js -- describeBattleAnimationOamWarning, was: no MISS term at all.
// Every character outside the inserted ${missClause} matches the committed string exactly
// (shared/project.js:3865-3871) -- when missClause is '' (MISS disabled), the output is
// byte-for-byte identical to what ships today.
export function describeBattleAnimationOamWarning(project, mapper) {
  const combatantMax = battleCombatantOamMax(project, mapper);
  const missTiles = projectUsesMiss(project) ? MISS_OAM_TILES : 0;
  let worstId = null;
  let worstTiles = 0;
  for (const animId of allBattleAnimationIds(project)) {
    if (!isPlayableBattleAnimation(animId, project)) continue;
    const tiles = Math.max(
      0,
      ...project.sprites.animations[animId].frames.map((frame) => project.sprites.metasprites[frame.metaspriteId].tiles.length)
    );
    if (tiles > worstTiles) { worstTiles = tiles; worstId = animId; }
  }
  if (worstId === null) return null;
  const name = project.sprites.animations[worstId].name;
  const missClause = missTiles ? ` plus MISS's own ${missTiles} sprites` : '';
  return (
    `"${name}" (${worstTiles} sprite tiles) plus this project's own worst-case combatants and cursor ` +
    `(${combatantMax})${missClause} would need more than the NES's ${MAX_OAM_ENTRIES} sprites at once, so it will be ` +
    'skipped in-game whenever it does not fit — even in a battle with real room, since the check is a ' +
    "project-wide worst case, not this battle's own. Use a smaller animation, or reduce the party/" +
    'formation/cursor cost elsewhere.'
  );
}
```

so the reproduced case above now reads `"X" (1 sprite tile) plus this project's own worst-case
combatants and cursor (60) plus MISS's own 4 sprites would need more than the NES's 64 sprites at
once` — a total (1 + 60 + 4 = 65) that actually matches why `validateProject` called the helper in
the first place. Test coverage for this exact reproduction (60 combatants, a referenced 1-tile
animation, MISS on) is in §14.

### §13.7 vram_buf accounting

**Zero.** MISS is entirely sprite-drawn (§13.3's own recommendation); no `vram_open`/`vram_push`/
`queue_at` call anywhere in §13.4. The only phase-2 `vram_buf` traffic at all is hit feedback's own
attribute-flash and restore packets (§12.6).

### §13.8 Interaction with the existing "misses" text message

**Additive, not a replacement.** `battle_say_actor`/`battle_say` (`engine/battleui.asm:580-614`,
unchanged) already prints the acting combatant's own name and "misses" as a two-line text message,
held for `MSG_HOLD` (45 ticks) or until dismissed — this design adds a SECOND, independent signal
(the floating overlay, naming the TARGET rather than the attacker) that reinforces rather than
duplicates it: the text says who missed, the overlay says who dodged. Both fire from the same two
call sites (`attack_missed`/`monster_missed`) in the same tick; neither reads or depends on the
other's own state.

### §13.9 Gating and the ledger

MISS's own gate (Chris's own answer 2, §10, v5.1) — independent of hit feedback's own (§12.7),
mirroring its structure exactly.

**Schema.** `project.rpg.miss: boolean`, defaulting to `false` — `defaultRpg()`
(`shared/project.js:4223-4231`) gains the field beside `hitFeedback`, and `normalizeRpg`
(`shared/project.js:5490-5499`) normalizes it as `Boolean(raw?.miss)`, the identical shape
`hitFeedback`'s own normalization takes. No reconciliation and no new `validateProject` refusal, for
the identical reasons §12.7 states for `hitFeedback` — a plain, always-legal boolean with no
mapper/tileset dependency. **UI**: the Build Forge's own "RPG progression" panel,
`rpgProgression(project)` (`renderer/forges/build/build.js:54-103`), a second `label.check` +
`input[type=checkbox]` row beside `hitFeedback`'s own (Character Forge's `renamable` idiom,
`renderer/forges/character/character.js:278-302`), in the same panel this document's own comparable
project-level RPG settings are already edited in.

```js
// shared/project.js -- beside projectUsesHitFeedback
export function projectUsesMiss(project) {
  return project.project.gameType === 'rpg' && Boolean(project.rpg?.miss);
}
```

**A `gameType === 'rpg'` check IS required here, the identical shape `projectUsesHitFeedback` now
takes (§12.7) — round 5 found this predicate's own leak, round 6 found the same leak in
`projectUsesHitFeedback` too, for a reason round 5 had not yet traced.** Every prior draft of this
document (through round 4) justified omitting the check on either predicate by claiming their only
consumers — `spriteReservedRanges` here, `battleRegionBytes` for hit feedback — are battle-only and
therefore unreachable from an action project regardless of gating. Both predicates ended up wrongly
gated, but for two different reasons: `spriteReservedRanges`'s own reachability claim was simply
false, while `battleRegionBytes`'s reachability claim was true — it is genuinely unreachable — and
the mistake was calling it hit feedback's ONLY consumer, when a second, reachable one existed all
along (below). `spriteReservedRanges` is false because `validateProject` calls it
directly, twice, BEFORE the `gameType === 'rpg'` block that begins at `shared/project.js:6593` — the
occupied-artwork refusal at `:6556` and the blank-reference collision check at `:6577` — and the
Tile Forge's own shading calls it unconditionally too (`renderer/forges/tile/tile.js:231`, `:410`).
`normalizeRpg` preserves `project.rpg.miss` verbatim regardless of game type (no per-field gameType
guard on it), so an action project carrying `rpg.miss: true` — unreachable through
`rpgProgression`'s own checkbox, which only renders when `isRpg`, but not unreachable full stop: a
project saved by a later version, or one hand-edited outside the UI, keeps the field exactly as
stored — would reserve $FA-$FC and stamp MISS artwork into every tileset with no battle overlay ever
drawn there to justify it. Hiding the checkbox makes the value unreachable from the UI, not
unreachable from the data the schema already round-trips.

Gating the predicate itself, rather than patching each caller, closes this at the one point every
MISS consumer already reads through instead of the stored field directly: the reservation
(`spriteReservedRanges`, above), the stamping loop (`main/build/generate.js`), the two OAM terms
(§13.6), the warning clause (`describeBattleAnimationOamWarning`), the ledger term and
`battleShortfallAdvice` entry (below), `MISS_ENABLED`'s own generated-flag emission, and
`MISS_ENABLED` itself all call `projectUsesMiss` — none of them reads `project.rpg.miss` directly.
`normalizeRpg` keeps storing the boolean exactly as written on every project, action or RPG — no
destructive rewrite, and no new `validateProject` refusal for setting it on an action project; the
predicate alone decides whether the value does anything.

**`battleRegionBytes` genuinely IS unreachable from an action project — that half of the old claim
was correct — but it is not `projectUsesHitFeedback`'s only consumer, and round 5 stopped looking
once it had confirmed that half.** `HIT_FEEDBACK_ENABLED` is not only wired into `battleRegionBytes`
(§12.7's own banked-region gate); it is also emitted straight into `config.inc` the same
`FLAG = predicate(project) ? 1 : 0` shape every generated flag in this codebase takes (§12.7's own
"Generated flag and gates" passage), and `config.inc` is written for every project
(`main/build/generate.js:3168`, `:3172`) and `.include`d by `engine/main.asm:32` unconditionally —
action projects included. So a boolean-only `projectUsesHitFeedback` generated
`HIT_FEEDBACK_ENABLED = 1` for an action project carrying `rpg.hitFeedback: true`, reproduced
directly by round 6's own review against the real generator: no runtime or artwork consequence,
since every routine the flag gates lives entirely inside battle source excluded from an action
build's own assembled sources regardless of the config flag (`main/build/generate.js:2757`,
`:2865`), but a wrong generated value and a wrong claim in this document either way. Both
predicates are RPG-gated for the same underlying reason as of round 6 — both reach `config.inc`,
which an action project's own build evaluates — and MISS is additionally gated for the further
reasons above (reservation, stamping, OAM). No sentence in this document may say
`battleRegionBytes` is `projectUsesHitFeedback`'s only consumer, or that its generated flag is
unreachable from an action project, except as the round-5 mistake corrected history now is.

**Ledger.** Measured in isolation against the same Appendix D diff (a second scratch copy with every
hit-feedback-specific addition removed, §12.7's own methodology mirrored):

```js
// main/build/battletables.js
export const MISS_BATTLE_ALLOWANCE = 134; // measured, §13 -- flat, all three boards
```

gated on `projectUsesMiss` and wired into `battleRegionBytes` (`main/build/battletables.js:974-987`)
the identical no-`&& banked` shape `HIT_FEEDBACK_BATTLE_ALLOWANCE`/`BATTLE_ANIM_BATTLE_ALLOWANCE`
already use. No kernel-lo term (§13.4's own routines live entirely in the banked battle region);
`vram_buf` cost is zero (§13.7).

**Shortfall advice.** `battleShortfallAdvice`'s own `bankedFeatures` list
(`main/build/battletables.js:1101-1137`) gains:

```js
// main/build/battletables.js -- battleShortfallAdvice, beside the hit-feedback entry
if (battleBankEnabled(project, mapper) && projectUsesMiss(project)) {
  bankedFeatures.push({ label: 'the MISS overlay', strip: projectWithoutMiss });
}
```

`projectWithoutMiss` (`shared/project.js`, beside `projectWithoutHitFeedback`) clones the project
and sets `rpg.miss = false`.

**Generated flag and gates, stated exhaustively — nothing hit-feedback-specific may key off this
one.** `MISS_ENABLED` (`main/build/generate.js`, the identical `FLAG = predicate(project) ? 1 : 0`
shape) gates, and ONLY gates: `battle_miss_arm`/`battle_miss_tick`/`battle_miss_draw` and their call
sites (`attack_missed`/`monster_missed`, `battle_tick`, `battle_draw_sprites`, §13.4); MISS's own
half of `setup_monsters`' reset and `battle_message_done`'s own `bt_miss_left` clear (§13.4); the
`MISS_TILE_M/I/S` generator stamping loop and the `spriteReservedRanges` MISS range push (§13.5);
`BATTLE_FX_OAM_ROOM`'s own `- MISS_OAM_TILES` term, `battleSpriteBudget`'s own `+ MISS_OAM_TILES`
term, and `describeBattleAnimationOamWarning`'s own `missClause` (§13.6); and `MISS_BATTLE_ALLOWANCE`
itself. It gates NOTHING in §12 — no hit-blink skip-check, no attribute-flash tick/arm/restore
routine, no OAM term (hit feedback has none, §12.7), no ledger term of hit feedback's own. The
equates (`bt_miss_slot`/`bt_miss_left`/`BT_MISS_FRAMES`) are NOT gated by it — unconditional, per
§7's own corrected treatment.

**The ledger decision itself — separating `setup_monsters`' shared `lda #0` — is recorded once, in
§12.7, since it is a single decision about ONE shared instruction both flags' own resets used to
share; see §12.7 for the full reasoning (options (i)/(ii), the recommendation, and the
`bankedbytes.test.js` re-measurement requirement for both 2a and 2b's own implementation phases,
including the both-on combination).**

## §14. Phase 2 test plan

The identical §6-style table — shape, and the wrong implementation each row catches. Rows marked
**round 1** are new or rewritten in response to round 1's review; rows marked **round 2** are new
or rewritten in response to round 2's; the rest are carried over unchanged. Each row is now tagged
with which phase it belongs to — **(2a)** hit feedback, **(2b)** MISS, or **(both)** for a row that
inherently needs both flags live to exercise what it tests — per the brief's own v5.1 instruction to
assign every row to a phase. **Round 5 correction**: the phase-2a acceptance plan built from rows
tagged `2a` alone must be complete on its own — a reader assembling a phase-2a brief should never
have to reach into a `both`-tagged row to get a check phase 2a actually needs. Two consequences: the
six-fixture off-path identity check is now its own `2a` row, repeated (re-run once MISS's own code
exists) as its own `2b` row, rather than one `both` row covering both toggles being off at once; and
the BP_INTRO guard and battle-entry reset rows — §12.4's own initialization-regression checks, which
a phase-2a brief needs regardless of whether MISS exists yet — are each split into a hurt-timer `2a`
row and a MISS-timer `2b` row, neither of which inherently needs the other flag live, with a lighter
`both`-tagged integration row kept beside each pair. Message-cap asymmetry and the combined 369-byte
ledger genuinely test an interaction between the two timers/allowances and stay tagged `both`. The
five rows immediately below replace the single-toggle "off-path/ledger" rows v5 had, since a single
off-path row and three ledger rows no longer cover what two INDEPENDENT gates need: every one of the
four legal toggle combinations (§7's own table) needs both its own ROM-neutrality/ledger claim AND a
check that the flag NOT under test contributed no bytes and no behavior of its own — a cross-gating
leak neither flag is allowed to have into the other's code.

| Test | Phase | Shape | Wrong implementation it catches |
|---|---|---|---|
| **round 5 — Off-path byte-identity, phase 2a (split from the old "Neither toggle" row, finding 2)** | 2a | `monsterlevel.test.js`-shape: build all six checked-in fixtures with `HIT_FEEDBACK_ENABLED` off (every fixture's own default, before MISS's code exists in the tree); assert every ROM is byte-identical to its pre-phase-2 build | `HIT_FEEDBACK_ENABLED`'s own gate assembling even one byte of §12's code unconditionally |
| **round 5 — Off-path byte-identity, phase 2b (split from the old "Neither toggle" row, finding 2)** | 2b | Identical shape, re-run once MISS's own code and the v5.1 reset split (§12.7/§13.9) both exist: build all six fixtures with `HIT_FEEDBACK_ENABLED` and `MISS_ENABLED` both off; assert every ROM is still byte-identical to its pre-phase-2 build — confirming MISS's own addition, including splitting `setup_monsters`' reset into two separate `.if` blocks, introduced no unconditional byte on either side | Either gate assembling even one byte of §12 or §13's own code unconditionally; specifically, the reset split leaking a byte into the off path once a second `.if` block sits beside hit feedback's already-shipped one |
| Hit feedback alone — ledger and cross-gating | 2a | `bankedbytes.test.js`-shape: `assert.equal` on the measured 235-byte delta (`HIT_FEEDBACK_ENABLED` on, `MISS_ENABLED` off), all three boards; PLUS a source/symbol-table check that no `bt_miss_*`-touching routine (`battle_miss_arm`/`tick`/`draw`), no MISS art, and no MISS reservation range is present in the build | A stale `HIT_FEEDBACK_BATTLE_ALLOWANCE` drifting from the real assembled cost; a `HIT_FEEDBACK_ENABLED`-gated block that accidentally also assembles MISS's own code (a cross-gating leak in the direction §7 says must never happen) |
| **round 6 — Action-project hit-feedback gating (finding 1, P3)** | 2a | An action project (`project.project.gameType !== 'rpg'`) with `project.rpg.hitFeedback` set `true` by hand-editing the saved JSON (never reachable through the UI, since `rpgProgression`'s own progression panel is RPG-only — `renderer/forges/build/build.js:621`, `:656`) built two ways, `hitFeedback` `true` and `hitFeedback` `false`; assert `config.inc` reads `HIT_FEEDBACK_ENABLED = 0` in BOTH builds, and that the two ROMs are byte-identical | The predicate reading `project.rpg.hitFeedback` alone with no game-type check (the shape this document carried through round 5): an action project generates `HIT_FEEDBACK_ENABLED = 1` in its own `config.inc` purely because a stored boolean survived a game-type switch or a hand edit, even though nothing in the ROM or its artwork actually changes as a result |
| MISS alone — ledger and cross-gating | 2b | Identical shape, the measured 134-byte delta (`MISS_ENABLED` on, `HIT_FEEDBACK_ENABLED` off); PLUS a check that no `bt_hurt_*`-touching routine (`battle_hurt_arm`/`attr_open`/`tick`/`restore_slot`) and no blink-skip branch in `battle_sprite_pc`/`battle_sprite_mon` is present | Same, for the independently-measured MISS figure; the leak in the OTHER direction — MISS-only code accidentally pulling in hit-feedback's own routines |
| Both toggles — combined ledger | both | Both live together, `assert.equal` on the real assembled combined delta — **369**, the clean sum of 235+134 under the v5.1 ledger decision (§12.7/§13.9, option (i): each toggle's own reset pays its own `lda #0`, so there is no 2-byte shared-load saving to measure here, unlike Appendix D's own frozen single-build prototype, which measured 367) | A ledger that reuses Appendix D's own 367 figure for the real two-gate implementation instead of re-measuring the actual `.if`-separated code; a shared-load "optimization" that crept back in despite the decision against it, silently making the two terms non-additive again |
| **round 2 — Multi-target sentinel integrity, corrected observation point (finding 4, P2, supersedes round 1's own row)** | 2a | Drive a real all-target spell through `cast_all` with a controlled formation of 4 living block-art monsters at LOW actor id (0) AND, in a second case, HIGH actor id (31, the reviewer's own reproduction, genuinely in range and above the loop boundary for a real 32-actor project); observe `bt_tmp2` with a breakpoint/trace AT `cast_all_next`, immediately after EACH `apply_damage` call — never after `cast_all` returns, since `battle_say_actor`'s own name lookup (`push_combatant_name`, `engine/battleui.asm:639-666`) legitimately reuses `bt_tmp2` as its own character-countdown scratch once the loop has finished, so a post-return read is 0 by design and proves nothing about the loop's own integrity; assert (a) `bt_tmp2` reads exactly `cast_all`'s own end-of-side sentinel at every one of those in-loop observations, (b) every intended target's own HP dropped by the rolled amount, and (c) no combatant OUTSIDE the intended side took damage | The stated design (§12.3) is already correct — this row exists to make sure the TEST oracle observes the right moment; a test written as "call `cast_all`, then check `bt_tmp2`" would reject the correct engine (round 2's own reproduction: sentinel 8 at every in-loop observation, 0 on return, both expected) |
| mon_tile guard | 2a | Arm hit feedback on a metasprite-fallback monster's slot; assert no attribute packet is ever queued for it, only the icon-skip draws | The missing guard §2(e) recorded against Appendix C, reopened |
| **round 1 — Dead-monster restoration, not abandonment (finding 2, P2, replaces the old "Dead-monster abandon" row)** | 2a | Arm the flash on a block-art monster with another monster ALSO alive; land a lethal hit on the flashing one (setting `bt_wipe_mask`'s own bit) at both blink parities (mid-flash-tint and mid-authored-tint) in separate cases; let `wipe_tick` run to completion (4 ticks, full row erase); assert the PPU attribute byte for that cell reads `BT_GROUND_ATTR` ($55) once the dead-check has fired, not the flash tint and not the monster's own `mon_attr` — and assert the STILL-ALIVE monster's own cell is untouched throughout | The design's own previous policy ("abandon, no restore") passing this exact scenario with a permanently stranded `$FF` — round 1's own review reproduced this directly against the assembled prototype |
| **round 1 — Arm-time death restoration (finding 2's second path)** | 2a | An all-target spell's own `cast_all` loop kills a flashing block-art monster on an early iteration, then re-arms onto a different target on a later iteration in the SAME tick; assert the killed monster's own cell reads `BT_GROUND_ATTR`, not stranded, even though `battle_hurt_tick` never gets another chance to see that slot | `battle_hurt_restore_slot` skipping the dead old slot entirely (its pre-fix behavior), stranding the tint the tick-based fix alone cannot reach once the shared pair has moved on |
| Multi-target hit-feedback policy | 2a | An all-target spell hitting 3 living monsters in one tick; assert only the LAST-processed slot ends up blinking, and that each EARLIER slot's own arm-then-supersede never left a visible blink (one tick, per the stranding fix) | A partial fix that blinks the first target instead of the last, or leaves an earlier target visibly blinking for a stray tick |
| **round 2 — vram_buf queue-length, corrected schedules (finding 1, P2, supersedes round 1's own row, which requested 5 block-art monsters — one more than `MAX_MONSTERS = 4` allows)** | 2a | Two cases, both driven through real dispatcher transitions: (a) the 20-byte feedback maximum — an already-armed hurt slot 7 (the 4th monster, block-art, already flashing from an earlier hit) superseded by an all-target spell hitting all 4 LIVING block-art monster slots 4-7 in turn, never a fifth monster; assert exactly 5 feedback packets (1 tick + 4 re-arms, 20 bytes) queued, distinct from `cast_all`'s own 28-byte message; (b) the 127-byte whole-frame maximum — the six-`battle_tick` sequence in §12.6 (an all-target spell kills 3 monsters and leaves the 4th flashing, A dismisses the message, the next actor's own menu opens, Down selects MAGIC, A opens the spell list, B closes it); assert the queue length/packet count on the LAST tick is exactly 11 (wipe) + 4 (flash) + 112 (`battle_list_back`) = 127 bytes — not merely that a sampled PPU byte looks stable, which cannot distinguish "no packet queued" from "the same value queued twice" | The round-1 test's own impossible 5-monster construction (silently vacuous, since no real project can reach it); a reachable-schedule claim that stops at the wrong (too-small, wrong-chain) 112-byte figure instead of the real, larger 127-byte one. This row exercises only the two DEMONSTRATED cases (20/48 bytes and 127 bytes, §12.6); the 111- and 59-byte rows are upper-bound arithmetic only, not independently tested here or anywhere else in this plan (round 3 finding 3) |
| **round 2 — MISS OAM overflow, corrected boundary and oracle (finding 2, P2, supersedes round 1's own row, which wrongly called 64-without-MISS "already overflowing")** | 2b | Four projects, each with `battleCombatantOamMax` values of exactly 60, 61, 64, and 65 (multiple icons, no `attackAnim` authored anywhere), each built both with MISS off and MISS on, asserted through `validateProject`'s own warning array (`used > limit`, `shared/project.js:7402`), never through calling `describeBattleSpriteWarning` directly (an unconditional formatter, not a gate): (a) at 60, MISS off or on, no warning (60, then 64, neither exceeds 64); (b) at 61, no warning MISS off, a NEW warning MISS on (65 > 64) — the case MISS itself causes; (c) at 64, no warning MISS off (exactly at the limit, not over it — round 1's own row wrongly assumed this already warned), a NEW warning MISS on (68 > 64); (d) at 65, a warning already fires MISS off (genuine pre-existing overflow, unrelated to MISS), and still fires MISS on, unchanged in cause | Round 1's own row's false premise that 64-without-MISS already warns, which would have let a test pass while asserting the wrong thing at the exact boundary that matters; asserting via `describeBattleSpriteWarning` instead of the real gate, which can be called and formatted without ever having actually fired |
| **round 2 — MISS OAM overflow, exact-fit boundary restored (finding 5, P2, IN ADDITION to the row above, not a replacement)** | 2b | A project where `battleCombatantOamMax` + the worst authored `attackAnim`/`spell.anim` frame + `MISS_OAM_TILES` sums to EXACTLY 64; assert the flipbook's own fit check (`battle_fx_draw`'s `cmp #BATTLE_FX_OAM_ROOM+1`, `engine/battleui.asm:1013`) still admits that frame. A second case: increase the animation's own worst frame by one tile (total 65); assert the WHOLE frame is now rejected (never a partial draw) | A generated `BATTLE_FX_OAM_ROOM` formula missing its own `- MISS_OAM_TILES` term (§13.6) — the row above (no flipbook authored) cannot catch this at all, since it never exercises `battle_fx_draw`'s own runtime fit check; small animations and icons would still render "correctly" with the subtraction missing, silently narrowing the room every future flipbook frame actually gets |
| **round 3 — describeBattleAnimationOamWarning accounts for MISS, corrected off-path oracle (finding 3, P2 from round 2, corrected by round 3 finding 2)** | 2b | The reviewer's own reproduction: 60 combatants, one referenced playable `battle.attackAnim`/`spell.anim` animation at 1 tile, MISS enabled (total 60+1+4=65, over the limit); assert the warning text names MISS's own 4 sprites as part of what pushed the total over, not just the animation and the combatants (whose own sum, 61, does not itself exceed 64 and so cannot be the stated reason on its own), AND that every other character of the returned string matches the committed text exactly (the em dash, and the full "Use a smaller animation, or reduce the party/formation/cursor cost elsewhere." advice suffix). **Corrected**: the SAME 60-combatant/1-tile layout does NOT overflow with MISS off (61 ≤ 64), so `validateProject` never calls the helper at all in that case — two off-path assertions instead of one: (i) call `describeBattleAnimationOamWarning` directly with MISS disabled and assert its output is byte-for-byte identical to the committed string (`shared/project.js:3865-3871`); (ii) separately, a layout that still overflows with MISS OFF (e.g. combatants at 65 alone), asserted through `validateProject`, to confirm the real end-to-end off-path warning text is unaffected by this change | The pre-fix warning text citing only the animation and combatants (61) as if that explained an overflow past 64 — a maintainer reading the message would have no way to see that MISS was the actual cause; round 2's own "MISS disabled" case asserted through `validateProject` at a layout (61 total) that never calls the helper at all, silently passing without exercising the off-path code path |
| **round 1 — Real attack-path miss coverage (finding 6, P2, replaces the old "Sole-miss invariant" row)** | 2b | Drive `attack_target` (party) and `monster_turn_attack` (monster) through `roll_hit` with a controlled RNG forcing a miss on each path in turn; assert `battle_miss_arm` fires, `bt_miss_slot`/`bt_miss_left` are set to the real dodging target, the overlay renders at that target's own anchor, the message ("X misses") and the overlay both appear, and the overlay disappears exactly at `BT_MISS_FRAMES` ticks (30) OR at message dismissal, whichever comes first. A second case: dismiss the message EARLY (before 30 ticks), then immediately force a SECOND miss on the next turn; assert the first overlay is gone and the second one starts clean, never overlapping | The impossible-construction row it replaces would still pass if a future engine change made a spell or status path call `roll_hit` — it asserted nothing about either real call site ever invoking the overlay at all |
| **round 1 — Non-miss negative coverage (finding 6)** | 2b | Drive `item_chosen_none` (a non-healing item — round 2 finding 6: the item is never consumed either, since `item_chosen`'s own `beq item_chosen_none` branches around `remove_item` before it runs, §13.1), `battle_menu_failed` (a failed flee roll), a damage spell, a status-effect spell, and a status tick (poison/burn); assert `battle_miss_arm` is never called and `bt_miss_left` never becomes nonzero from any of these five paths | A future call site wired to `battle_miss_arm` by mistake, or a broadened `roll_hit` call reaching one of these paths without the design noticing |
| **round 1 — Hit-flash trace, both bands and cessation (finding 6, corrected per round 2's own remaining note)** | 2a | Arm the flash on a living block-art monster; sample the real PPU attribute byte every tick across the full `BT_HURT_FRAMES` (20) countdown; assert both the authored-tint band and the flash-tint band are each visible for two consecutive ticks (the `and #2` cadence, §12.1/round 1 finding 9), the terminal tick forces the authored tint regardless of which band it would otherwise be in, and that cessation past the terminal tick is confirmed by a DIRECT queue observation (no packet appended to `vram_buf` on any tick after the terminal one) — not source inspection alone, which the round-1 design leaned on for this exact claim | A cadence that silently reverts to single-tick alternation, or a terminal tick that lands mid-band and leaves the wrong tint; a queue that keeps appending duplicate packets past cessation, invisible to a PPU-byte-only check the same way finding 1's own reachability claim was |
| **round 5 — BP_INTRO guard, hurt timer (split from the old combined row, finding 2)** | 2a | Build with `HIT_FEEDBACK_ENABLED` on, `MISS_ENABLED` off. Leave `bt_hurt_left` nonzero (simulating a stale value from a previous battle or uninitialized RAM), start a fresh battle, and inspect `vram_buf`/OAM writes specifically on the FIRST tick, while `bt_phase` still reads `BP_INTRO` — not just the timer value after `setup_monsters` has run; assert `battle_hurt_tick` does not decrement or queue anything on that tick | The guard's own absence on the hurt side (round 1's own review reproduced a stale timer of 20 becoming 19 and queuing a real packet during `BP_INTRO`, before reset); a hurt-only build cannot rely on a `both`-tagged row to catch this |
| **round 5 — BP_INTRO guard, MISS timer (split from the old combined row, finding 2)** | 2b | Identical shape with `MISS_ENABLED` on, `HIT_FEEDBACK_ENABLED` off, `bt_miss_left` left stale from a previous battle; assert `battle_miss_tick` does not decrement or queue anything on the first `BP_INTRO` tick | The guard's own absence on the MISS side — the same reproduction mirrored onto the independent timer |
| **round 5 — BP_INTRO guard, both live (integration)** | both | With both flags on and both timers left stale, confirm the two checks above hold simultaneously in the same battle entry — that neither tick routine's own guard is conditioned on the other flag's state, and that running both ticks against `BP_INTRO` in the same frame surfaces no interaction the two isolated checks above cannot see | Either guard implemented so it depends on the other flag also being on, or a shared scratch byte between the two tick routines that only misbehaves when both run in the same frame |
| **round 5 — Battle-entry reset, hurt timer (split from the old combined row, finding 2)** | 2a | Build with `HIT_FEEDBACK_ENABLED` on, `MISS_ENABLED` off. Leave `bt_hurt_left` nonzero at the end of one battle (a hit still counting down when the fight ends, and NOT cleared by `battle_end`/`player_died` — §12.4's own accurate lifetime statement), start a fresh battle, assert it reads 0 once `setup_monsters` has run (post-`BP_INTRO`) — under the v5.1 ledger decision (§12.7) this half resets under its own `.if HIT_FEEDBACK_ENABLED` block | Appendix B's own recorded limitation, reopened on the hurt side alone; a `.if`-separated reset whose hurt half never runs when MISS is not also live in the same build |
| **round 5 — Battle-entry reset, MISS timer (split from the old combined row, finding 2)** | 2b | Identical shape with `MISS_ENABLED` on, `HIT_FEEDBACK_ENABLED` off, `bt_miss_left` left stale at the end of one battle; assert it reads 0 once `setup_monsters` has run, under its own `.if MISS_ENABLED` block (§13.9) | Appendix C's own recorded limitation, reopened on the MISS side alone; a `.if`-separated reset whose MISS half never runs when hit feedback is not also live in the same build |
| **round 5 — Battle-entry reset, both live (integration)** | both | Run with both flags on, both timers left stale; assert both read 0 once `setup_monsters` has run — confirming the split under the v5.1 ledger decision (§12.7/§13.9) kept BOTH `.if` blocks rather than one silently replacing the other when both are compiled into the same build | A `.if`-separated reset that drops one half specifically when both flags coexist — a failure mode the two single-flag rows above cannot see, since each only ever assembles its own half |
| Message-cap asymmetry | both | Requires both flags live (the asymmetry is between the two timers). Land a hit AND draw a miss in close succession, dismiss the miss's own message early; assert `bt_miss_left` is force-cleared at dismissal while a separately-still-counting `bt_hurt_left` (from an earlier, unrelated hit) is NOT | A blanket cap that treats both timers the same, contradicting §12.4/§13.4's own stated asymmetry |
| Rendered-pixel MISS overlay | 2b | Real `nes.ppu` frame-buffer read, arm MISS over a combatant, assert the M/I/S/S tiles are visible at the expected offset | A draw-order or coordinate regression |
| Rendered-pixel priority | 2b | Requires `BATTLE_ANIM_ENABLED` (phase 1b's own flipbook, unconditional content-driven gate) and `MISS_ENABLED` together — not `HIT_FEEDBACK_ENABLED`, which this scenario does not touch at all. Arm both a flipbook AND MISS in the same tick (a monster's own missed attack, §12.4); assert both are visible, neither silently dropped by an OAM-budget miscalculation | The combined-frame OAM interaction (§13.6) going untested until a real project hits it |
| **round 3 — Reservation integration, on/off, corrected blank-reference oracle (finding 5, P2 from round 2, corrected by round 3 finding 1)** | 2b | Eight cases against a project with `MISS_ENABLED` on, mirroring `SPRITE_ARROW_TILE`'s own existing test coverage: (a) artwork painted at `$FA`-`$FC` in a tileset is refused, naming "the MISS overlay" and the real `$FA`-`$FC` range, never the cursor's own `$FD` wording; (b) **corrected** — a metasprite that REFERENCES a blank `$FA`-`$FC` tile IS refused (`shared/project.js:6577-6590`'s own existing, generic reference-collision check: stamping would replace that blank with a MISS glyph, so a metasprite pointing at it would unexpectedly display one), naming "the MISS overlay" and the tileset — the identical mechanism `SPRITE_ARROW_TILE`/the HUD hearts already inherit, extended automatically once `spriteReservedRanges` carries the MISS range; (b2) a genuinely blank, UNREFERENCED `$FA`-`$FC` tile (no metasprite points at it) is ALLOWED, not refused — the distinct, permitted case (b) used to conflate with the refused one; (b3) the SAME blank-reference scenario from (b), in an otherwise-clean project (no other applicable reservation or unrelated validation error) with `MISS_ENABLED` OFF, produces no error at all — confirming the refusal is genuinely gated on the feature, not a pre-existing check that happened to already cover `$FA`-`$FC`; (c) the Tile Forge's own shading hint names the MISS range and reason, not the cursor's; (d) the Tile Forge's own tile shading covers `$FA`-`$FC` when `MISS_ENABLED`; (e) `MISS_TILE_M`/`I`/`S` art is stamped into EVERY tileset, on all three RPG-capable boards, not only the currently-selected battle tileset; (f) with `MISS_ENABLED` off, none of the above fires and no tileset gains the stamped art — off-path byte-identity for the reservation itself; (g) `HIT_FEEDBACK_ENABLED` on with `MISS_ENABLED` off produces the identical off-path result as (f) — confirming the reservation is genuinely MISS's own gate, never hit feedback's | No existing §14 row exercised the range-aware refusal/hint changes at all (round 1's own finding 5 was a design-only fix, unverified); off-path ROM identity and a rendered MISS overlay cannot themselves catch a wrong warning label or a reservation that silently fails to refuse occupied artwork; round 2's own (b) row asserted the OPPOSITE of `shared/project.js:6577-6590`'s own existing contract — it would have rejected the correctly integrated implementation, or encouraged removing an existing protection to make the (wrong) test pass; case (g) specifically catches the reservation being wired to the wrong flag entirely |
| **round 5 — Action-project MISS gating (finding 1, P2)** | 2b | An action project (`project.project.gameType !== 'rpg'`) with `project.rpg.miss` set `true` by hand-editing the saved JSON (never reachable through the UI, since `rpgProgression`'s own checkbox row only renders when `isRpg`) built two ways, `miss` `true` and `miss` `false`; assert the two ROMs are byte-identical — no `$FA`-`$FC` reservation, no stamped MISS art, no `spriteReservedRanges` entry either way — confirming `projectUsesMiss`'s own `gameType === 'rpg'` check, not the checkbox's visibility, is what keeps an action build MISS-free. A second case: the SAME action project, `miss: true`, with artwork painted at `$FA` in a tileset; assert `validateProject` raises no error | The predicate reading `project.rpg.miss` alone with no game-type check (the shape this document carried through round 4): an action project either surfaces a real occupied-artwork refusal over ordinary artwork, or silently ships stamped MISS art with no battle overlay ever drawn to justify it, purely because a stored boolean survived a game-type switch or a hand edit that the UI's own hidden checkbox never prevents |

## §15. Phase 3 — the Magic Forge preview canvas

Everything below is new design, written against HEAD `227ccb1` (phases 1a/1b/2a/2b all shipped and
pushed). Phase 3 touches no engine code, no generator output and no schema — it is a renderer-only
addition that has to *reproduce*, in JavaScript, the one-shot playback contract `battle_fx_tick`
(`engine/battleturn.asm:1162-1203`) and `battle_fx_draw` (`engine/battleui.asm:1038-1096`) already
implement in 6502, so an author previewing an animation in the Magic (and, per §8, Monster) Forge
sees what a real battle will actually show — not the Sprite Forge's own looping scrubber (§2, below)
wearing a different label.

**Corrected across four review rounds (round 1, `handoff-next/battle-anim-phase3-design-review1.md`,
verdict FIX, eight P2/three P3; round 2, `handoff-next/battle-anim-phase3-design-review2.md`,
verdict FIX, five P2/three P3; round 3, `handoff-next/battle-anim-phase3-design-review3.md`, verdict
FIX, three P2/one P3; round 4, `handoff-next/battle-anim-phase3-design-review4.md`, verdict FIX, two
P2/two P3 — no round disputed the phasing or scope decisions already made in §7/§8/§9; §10's own four
changelog entries list all twenty-seven findings with their dispositions).** The corrected sections
below are self-sufficient on their own — an implementation brief can still be assembled from §15
alone, without reaching into §6 or §14, the same rule that held before any of these four rounds.

### §15.1 The contract, as a table

**Corrected in round 1 (§10's own new changelog entry has the full findings list): two rows are new
below — a `NO_ANIM`-over-a-live-effect row and a zero-tile-metasprite row, both missing entirely
from the original draft (review findings P2-2/P2-3) — and the terminal-pixels row was wrong (P2-8:
the canvas clears on termination, matching the engine, rather than freezing the last frame as
originally designed) — so `BP_INTRO` is now the *only* row where the preview deliberately diverges
from the engine, not one of two.**

| Engine rule | Cited at | What the preview does | Matches the engine? |
|---|---|---|---|
| `NO_ANIM` (`$FF`) arms nothing **from a clean/inactive state** | `battle_fx_arm_at`, `engine/battleturn.asm:310-311` (`cmp #NO_ANIM` / `beq`) | `armBattleFx(null)` (the Magic/Monster Forge's own "None" option, `magic.js:54`/`monster.js:93`) produces stepper state `null` — no ticking, nothing ever drawn. `armBattleFx` is scoped to fresh-preview construction only (§15.2) — it takes no prior-state argument, so it cannot model the OTHER thing this same ROM call does | Yes, for the case it models |
| `NO_ANIM` arming an **already-live** effect is a no-op that leaves the existing effect running — the early `cmp #NO_ANIM`/`beq` (above) returns before any state is written, so the previous animation, frame and timer are untouched | Same citation, `:310-311` | **Not modeled by `armBattleFx`** — the preview only ever arms fresh (a selection change or Replay always starts a new stepper state from frame 0, §15.5); there is no UI path that "re-arms with None over a running effect" the way the ROM's own live-effect-then-NO_ANIM case can occur. Two ROM-only trace cases in §15.6 pin this engine behaviour directly, without claiming the stepper reproduces it | No — genuinely not modeled, not merely unexercised; stated here so a future caller of `armBattleFx` cannot assume it means "clear," which is a UI policy (§15.5), not this function's job |
| An empty animation (`frames.length === 0`) is staged then immediately reverted to `NO_ANIM`, never dereferenced, clearing `bt_fx_anim` outright (distinct from the row above — arming empty is not a no-op) | `battle_fx_arm_at_empty`, `:312-325` | Arming with `animation.frames.length === 0` also produces `null` directly — the JS layer has no equivalent of "stage then revert" to model, since there is no table row to accidentally dereference in JS the way `anim_ptr_lo/hi,x` would be in ASM; the observable *outcome* (arms nothing) is identical | Yes (by construction, not by re-running the same staging steps) |
| A frame holds for **exactly** `duration` ticks, `1` through `255`, checked as `timer < duration` on the **post-increment** timer, never pre-increment and never `<=` | `engine/battleturn.asm:1179` (`inc <bt_fx_timer`), `:1188-1190` (`cmp [ptr_lo],y` / `bcc`) | Same compare, same operand order: `timer = state.timer + 1; if (timer < duration) hold` (§15.2) | Yes — proven per-duration by §15.6, not merely stated |
| A single-frame animation ends after its **own** duration, unlike the overworld's `entity_animate` (which never advances a lone frame at all) | `:1150-1153` (comment), `:1196-1200` (`inc <bt_fx_frame` / `cmp anim_count,x` / no exemption for count = 1) | The stepper's frame-advance step runs unconditionally once `timer >= duration`, regardless of `animation.frames.length`; there is no "frames.length === 1, don't advance" branch to accidentally add | Yes |
| `loop` is never read; one pass, then `NO_ANIM` | `:1153-1155` (comment), `:1196-1200` (no read of any loop flag) | The stepper never reads `animation.loop` either — the field exists on the catalog entry (it is the Sprite Forge's own field) but `renderer/widgets/battlefx.js` never imports or inspects it | Yes — and this is the one rule that most directly separates the new stepper from `advancePreviewFrame` (§15.2), which *always* wraps regardless of `loop` |
| `battle_fx_draw`'s own per-tick fit check: a frame whose `ms_count` exceeds `BATTLE_FX_OAM_ROOM` is skipped **that tick only**, the tick still counts, the effect is not ended by being skipped | `engine/battleui.asm:1058-1061` (`cmp #BATTLE_FX_OAM_ROOM+1` / `bcs battle_fx_draw_rts`) — note `battle_fx_tick` and `battle_fx_draw` are two separate routines with no shared state beyond `bt_fx_anim/slot/frame/timer`; skipping the *draw* never touches the *tick* | The stepper mirrors this as two separate functions too (§15.2): `tickBattleFx` never looks at room/tile counts, `drawnBattleFx` (called after every tick, exactly as `battle_fx_draw` runs after `battle_fx_tick` in the same NES frame — `engine/battle.asm:233-245`) re-checks the fit **every time it is called**, never caching a "does this whole animation fit" verdict | Yes — proven by §15.6's fit fixtures |
| **A frame whose metasprite has zero tiles never draws, regardless of room — corrected this round (P3-6): the room compare runs and PASSES for a zero-tile frame, it is not skipped** — `battle_fx_draw` reads `ms_count` and executes the room compare first (`:1059-1061`, `cmp #BATTLE_FX_OAM_ROOM+1`/`bcs`); `0` is never greater than `BATTLE_FX_OAM_ROOM+1`, so the `bcs` never takes and execution falls through to the tail call at `:1092-1093`. Only THEN does `draw_metasprite` itself return immediately on `ms_count == 0`, before touching OAM — the room check is not what stops a zero-tile frame from drawing; the downstream compositor's own separate, later zero-count check is | `draw_metasprite`, `engine/entities.asm:621-624` (`lda ms_count,y` / `beq draw_metasprite_done`), reached only after `battle_fx_draw`'s own room compare at `engine/battleui.asm:1059-1061` has already passed | `drawnBattleFx` treats a zero-tile frame as "not drawn" explicitly (`tiles === 0`), never merely relying on `0 > room` being false (§15.2) — a genuinely legal input, since `normalizeMetasprite` enforces no minimum tile count (`shared/project.js:5138-5150`) | Yes — a real gap in the first draft of this design, fixed this round (P2-3) |
| What is shown after the pass ends | `battle_fx_draw_rts` on `bt_fx_anim == NO_ANIM` (`:1046-1048`): nothing — the routine returns before touching OAM | **The canvas is cleared** — no pixels, matching the engine's own no-draw answer exactly (§15.5 has the corrected UI design; this round's own P2-8 finding is what corrected it from an earlier, wrong "freeze the last frame" design) | Yes |
| How the user replays | N/A — the engine has no "replay," each cast/attack re-arms | A "Replay" button FORCES a fresh `armBattleFx(animation)` call (§15.2) regardless of whether the selected id/signature actually changed — a deliberately distinct transition from `sync()`'s own ordinary, conditional re-arm (§15.5's own corrected Replay passage, P2-1) — this is Magic/Monster Forge UI, not an engine mechanism, so it needs no engine citation | N/A |
| `BP_INTRO`'s own guard: neither routine runs before `setup_monsters` has reset the effect for the current battle | `battle_fx_tick:1164-1174`, `battle_fx_draw:1043-1045` | **Deliberately not reproduced — the one remaining divergence.** The preview never enters a `bt_phase` at all — there is no battle, no `setup_monsters`, no prior battle's leftover state to guard against; the guard exists solely to protect a shared zero-page pair across battles, which a preview's own local, per-mount `state` variable cannot leak into in the first place (`engine/battleturn.asm:1164-1174`'s own comment states the reason directly: "whatever the previous battle... left behind") | No — and correctly so; see §15.10 for why this is not a gap |

### §15.2 A DOM-free stepper: `renderer/widgets/battlefx.js`

**Placement.** Beside `renderer/widgets/metasprite.js`, not `shared/`. The single-writer rule
(CLAUDE.md's own "The single-writer rule" passage) reserves `shared/` for anything `main/` also
reads — the generator, the CLI, a `node:test` file that imports build-time code. Nothing in
`main/build/` needs a playback stepper; `generate.js` never simulates a running animation, it only
ever asks "does this frame's tile count fit" (§15.3, a *separate*, already-existing figure). The
stepper is exactly `metasprite.js`'s own shape: DOM- and Node-free, imported directly by
`node:test` for the gate (§15.6), and by `renderer/forges/magic/magic.js` (and, per §8, the Monster
Forge) for the canvas. That is the precedent CLAUDE.md's own passage on `metasprite.js` names
("`renderer/widgets/` beside `metasprite.js` is the precedent for DOM-free renderer code `node:test`
imports"), applied here without amendment.

**Signature and state.** The engine's own running-effect state is three bytes: `bt_fx_frame`,
`bt_fx_timer`, and whether `bt_fx_anim` is still `NO_ANIM` or a real id (`engine/constants.asm`'s
own equates, chained beside `bt_fx_slot`, §12.2). The JS layer holds an object reference to the
animation instead of re-deriving it from a numeric id every tick (nothing forces a JS stepper to
re-index a catalog array the way 6502 must), so three exported functions carry the equivalent
three facts — `animation` standing in for "is `bt_fx_anim` still live, and which one":

```js
// renderer/widgets/battlefx.js
//
// A pure, DOM-free model of battle_fx_arm_at/battle_fx_tick/battle_fx_draw
// (engine/battleturn.asm, engine/battleui.asm; docs/design-battle-animation.md
// §15.1). Input is always a NORMALIZED animation object -- shared/project.js's
// own normalizeAnimation (:5203-5213) clamps every frame's duration to
// 1-255 (defaulted to 8) unconditionally, so the stepper never has to
// special-case a missing one. A hand-built test fixture that omits a
// frame's own duration (the existing buildFxFitFixture rows do this --
// test/unit/rpg.test.js:6004, :6011) is not a legal stepper input on its
// own and must be normalized (or authored with an explicit duration) first
// -- §15.6 restates this for the trace test's own fixture.
//
// `state` is `null` when the effect is not running -- the JS equivalent of
// bt_fx_anim == NO_ANIM -- or `{ animation, frame, timer }` otherwise,
// mirroring bt_fx_frame/bt_fx_timer/"which animation" (bt_fx_anim itself,
// but held as an object reference rather than re-derived from an id every
// tick). loop is never read, on purpose (§15.1).

/**
 * battle_fx_arm_at, restricted to arming a FRESH preview -- it takes no
 * prior-state argument, so it cannot model the ROM's own "already live"
 * branch (the early `cmp #NO_ANIM`/`beq`, engine/battleturn.asm:310-311,
 * which leaves an existing effect running rather than clearing it -- §15.1's
 * own two NO_ANIM rows). Selecting "None" in the UI is a separate CLEAR
 * policy (§15.5), never a call to this function with `animation = null`.
 * Returns null (NO_ANIM) for a missing animation or one with zero frames
 * (battle_fx_arm_at_empty, :322-325).
 */
export function armBattleFx(animation) {
  if (!animation || animation.frames.length === 0) return null;
  return { animation, frame: 0, timer: 0 };
}

/** battle_fx_tick. `state` is a prior armBattleFx/tickBattleFx result; null is a no-op. */
export function tickBattleFx(state) {
  if (!state) return null;
  const timer = state.timer + 1;
  const { duration } = state.animation.frames[state.frame];
  if (timer < duration) return { animation: state.animation, frame: state.frame, timer };
  const frame = state.frame + 1;
  if (frame >= state.animation.frames.length) return null; // one pass; loop never read
  return { animation: state.animation, frame, timer: 0 };
}

/**
 * battle_fx_draw's own fit check, re-evaluated fresh every call -- never
 * cached from arm time (§15.1). `tileCount(metaspriteId)` is the caller's
 * own lookup (§15.3); `room` is battleFxOamRoom(project, mapper). A
 * zero-tile metasprite is legal (normalizeMetasprite enforces no minimum
 * length, shared/project.js:5138-5150). Zero PASSES the room check itself
 * (0 is never > room) -- what actually stops the draw is the downstream
 * compositor's own separate zero-count return (draw_metasprite,
 * engine/entities.asm:621-624, reached only after battle_fx_draw's own
 * room compare, engine/battleui.asm:1059-1061, has already let it through).
 * So `tiles === 0` must be checked explicitly here rather than folded into
 * `tiles > room` (round-1 finding P2-3: `0 > room` is false, which would
 * have wrongly reported a draw).
 * Returns the frame's metaspriteId if it would draw this tick, else null.
 */
export function drawnBattleFx(state, room, tileCount) {
  if (!state) return null;
  const frame = state.animation.frames[state.frame];
  const tiles = tileCount(frame.metaspriteId);
  return tiles === 0 || tiles > room ? null : frame.metaspriteId;
}

/**
 * A DOM-free wall-clock pacer, paired with the stepper above (§15.4). Kept
 * in this same module rather than a separate file: it is three lines of
 * closure state with no DOM dependency either, and the two are always
 * consumed together by the same mount.
 */
export function createBattleFxPacer(nesFps = 60.0988) {
  let lastTime = null;
  let owed = 0;
  return {
    /** Zero accrued debt and forget the time origin -- called on every re-arm (§15.4). */
    reset() {
      lastTime = null;
      owed = 0;
    },
    /** How many whole ticks have accrued since the last call, capped and fractional-carrying (§15.4). */
    advanceTo(now) {
      if (lastTime === null) {
        lastTime = now;
        return 0; // no first-callback credit -- observation 0 is already painted at arm (§15.4)
      }
      owed += ((now - lastTime) / 1000) * nesFps;
      lastTime = now;
      if (owed > 4) owed = 4; // a stall or a hidden window never fast-forwards (player.js:211's rule)
      const ticks = Math.floor(owed);
      owed -= ticks;
      return ticks;
    }
  };
}
```

**Not `sprite.js`'s `advancePreviewFrame` (`:1223-1231`) — a scope and risk decision, not a
technical impossibility (corrected this round, P3-9; the original draft overstated this as
"cannot").** A shared, parameterized pure transition is genuinely possible: `advancePreviewFrame`
could be reshaped to return `{frame, time, ended, changed}` with an explicit `loop` option, and its
two existing callers (`stepPreview`'s two branches, `:1247-1258`) could assign the returned fields
back onto their own `clock` objects and invoke `onFrameChange()` only when `changed` is true,
preserving today's observable Sprite Forge behaviour — the Sprite Forge's own adapter would simply
pass `loop: true` at both call sites, so `sprite.js:1223-1231`'s own unconditional wrapping stays
exactly as it is today; **no behaviour change to the Sprite Forge would be required at all**
(corrected this round, P3-7 — the original draft's own second point claimed otherwise, wrongly).
This document chooses **not** to build that shared transition anyway, for two reasons stated as
costs weighed against a zero benefit, not as proof the sharing is impossible or as a behaviour-risk
to the Sprite Forge:

1. **It would touch a function two already-shipped, pinned smoke assertions depend on**
   (`main/smoke.js:4922`, `:4963` — the Actors/Animations tab preview-stepping checks). Re-proving
   those two assertions hold after reshaping `advancePreviewFrame`'s own return contract is real
   verification work a UI-polish phase for a *different* Forge gains nothing from.
2. **The two functions are conceptually adjacent (both step a frame/duration pair) but serve
   different call shapes** — mutate-a-caller-owned-clock-and-callback vs.
   return-next-state-or-null — and unifying them buys no code reduction proportional to the risk:
   `battlefx.js`'s own four exports (above) are under 40 lines total including comments.

`renderer/widgets/battlefx.js` is therefore a new, small module — a deliberate choice to keep the
Sprite Forge's own well-tested preview untouched, not a claim that sharing it was infeasible.

### §15.3 The fit figure, moved to `shared/` under the single-writer rule

`battle_fx_draw`'s own compare is against `BATTLE_FX_OAM_ROOM`, a generated equate. Its arithmetic
lives at `main/build/generate.js:2646-2649`:

```js
const battleFxOamRoom = Math.max(
  0,
  MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper) - (missEnabled ? MISS_OAM_TILES : 0)
);
```

Every *input* to that expression is already exported from `shared/project.js` and imported into
`generate.js` (`:87-88`, `:3204-3207`): `battleCombatantOamMax` (`shared/project.js:3794-3805`),
`MAX_OAM_ENTRIES` (`:187`), `MISS_OAM_TILES` (`:6475`), `projectUsesMiss`. What is **not** already
in `shared/` is the four-line subtraction itself — `battleSpriteBudget` (`:3825-3839`) is a
different figure (`battleCombatantOamMax` **plus** the worst authored flipbook frame **plus** MISS,
the validation-time "how much do we actually use" number) built for a different question ("does
this project overflow 64 sprites") than `BATTLE_FX_OAM_ROOM` answers ("how much room is left for
the effect to draw into" — the room minus the combatants and MISS, with no flipbook term at all,
since the flipbook is the very thing being asked whether it fits). So the preview cannot call an
existing shared function for this number; duplicating the four lines into the renderer would be
exactly the second copy of the arithmetic the brief and the single-writer rule both forbid.

**Decision: extract it.** Add `battleFxOamRoom(project, mapper)` to `shared/project.js`, beside
`battleCombatantOamMax`/`battleSpriteBudget` (the same neighbourhood, the same inputs):

```js
export function battleFxOamRoom(project, mapper) {
  return Math.max(
    0,
    MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper) - (projectUsesMiss(project) ? MISS_OAM_TILES : 0)
  );
}
```

`generate.js:2646-2649`'s own local `battleFxOamRoom` binding is replaced by a call to this export
(one import added to its existing `shared/project.js` import block, `:87-88`'s neighbourhood).
**Implementation caution, not a design change (review round 1's own "Checks that hold" note):** the
generator's local variable keeps the name `battleFxOamRoom` today, and the new import shares that
exact name — `const battleFxOamRoom = battleFxOamRoom(project, mapper);` would shadow the import in
its own initializer and throw (`ReferenceError`, temporal dead zone) at build time for every
project. The implementation must either rename the generator's local binding (e.g. `battleFxRoom`)
or import the export under an alias (`import { battleFxOamRoom as computeBattleFxOamRoom } from
'../../shared/project.js'`) — either is fine, but one of them is required; every downstream
reference in `generate.js` — the `assets/config.inc` emission at `:3204-3207`, which reads the
local binding by whatever name it ends up with, not by the string `"battleFxOamRoom"` — is
otherwise untouched. **Acceptance proof, not assertion**: a test builds every RPG-capable board
(MMC1, MMC3, UNROM 512) both before and after the move and asserts the generated
`BATTLE_FX_OAM_ROOM` value in `config.inc` is byte-identical — the same "prove the refactor is
inert" shape `kernelbytes.test.js`/`bankedbytes.test.js` already hold every allowance figure to,
applied here to a pure data move rather than a byte-cost change (§15.9 restates this as the scope
claim it backs; §15.7's own ROM-neutrality matrix, corrected this round per P2-7, is the full
acceptance check).

The preview widget then calls `battleFxOamRoom(project, mapper)` every time it needs the figure —
`project`/`mapper` supplied fresh by the widget's own `getProject()` callback (§15.5's corrected
widget API, P2-6), never a value captured once at mount — the identical pattern `sprite.js:1205`'s
own `spriteReservedRanges(store.project, resolveMapper(...))` call already uses for a different
generator-adjacent figure, so this is not a new access pattern for either Forge to learn, only a
new function to call it on.

**The preview mirrors the skip, and labels it.** Recommendation: yes. `drawnBattleFx` (§15.2)
already returns `null` for a tile count over room; when a running effect's *current* frame is
skipped this way, the canvas shows nothing for that frame's pixels (matching what a real battle
would show — nothing) but a caption beneath the canvas reads exactly:

> **This frame won't draw in-game** ({tiles} tiles, only {room} available) — reduce the party,
> formation, or the frame's own tile count.

reusing `describeBattleAnimationOamWarning`'s own vocabulary (`shared/project.js:3841-3883`, the
existing OAM-overflow warning's "Use a smaller animation, or reduce the party/formation/cursor cost
elsewhere" wording) rather than inventing a second phrasing for the identical underlying fact. This
is exactly the brief's own stated reason a preview is worth shipping at all: an author cannot see
from the Magic Forge alone that a frame will be silently skipped in a real battle, the same
information gap `describeBattleAnimationOamWarning` already exists to close at validation time —
the preview closes it at authoring time instead, per-frame rather than as a project-wide warning.

### §15.4 Pacing

**Decision unchanged: wall-clock, owed-frames pacing at `NES_FPS`, not one tick per
`requestAnimationFrame` callback.** The Sprite Forge's own preview (`advancePreviewFrame`, dissected
in §15.2) is a display-rate scrubber with no claim to make about real engine timing — nothing in
the Sprite Forge ever asserts "this is what the game will actually look like." The battle preview's
entire reason to exist (§0/§4/round-2 brief origin) is the opposite claim: reproduce the engine's
own contract closely enough that a frame-for-frame trace test can hold it to that claim (§15.6).
Running one tick per `requestAnimationFrame` on a 120 Hz display would play every duration at 2×
real speed — exactly the failure mode CLAUDE.md's own emulator section names ("this shipped, and
presented as 'the music sounds garbled towards the end'") for the *audio* run loop.

**Named and fully specified round 1 (P2-4 finding: the original draft put the timing arithmetic
somewhere no test could drive it) — `createBattleFxPacer` (§15.2), a DOM-free wall-clock pacer
beside the stepper, not inside `magic.js`.** It is not a bare copy of `renderer/emulator/player.js`'s
own `tick(now)` (`:184-211`) — two deliberate differences, both because a *preview* starts from a
different state than the *emulator* does:

- **No first-callback credit of one frame.** `player.js:209`'s own `lastTick === null ? 1 :
  ((now - lastTick) / 1000) * NES_FPS * audio.driftRatio()` exists because the emulator has drawn
  *nothing* on its very first callback and needs to credit exactly one frame to get the picture on
  screen at all. This preview already paints observation 0 — the armed effect's own frame 0 — at
  arm time. `createBattleFxPacer`'s own first call to `advanceTo(now)` therefore returns `0`
  unconditionally and only records the time origin.
- **No audio-drift multiplier.** `player.js:209`'s own `audio.driftRatio()` term exists to hold the
  emulator's frame rate against a live sound-card buffer's own fill level (CLAUDE.md's emulator
  section). A silent preview canvas has no buffer to drift against, so the term is dropped entirely
  rather than carried in and hardcoded to `1`.

**The arm sequence, stated exactly and corrected this round (P2-4: the round-1 draft established
the "no first-callback credit" rule above but never actually said WHEN the pacer's own first call
happens, leaving the origin to whatever the next scheduled `requestAnimationFrame` callback
happened to be — which loses every millisecond of real elapsed time between arm and that callback,
and makes the preview's own initial hold display-rate-dependent again, the exact class of bug this
whole section exists to rule out):**

```
reset()                          // zero debt, forget any prior time origin
armBattleFx(animation)           // state = observation 0
paint(observe())                 // draw observation 0's own pixels
advanceTo(now())                 // <-- establishes the time origin AT THIS MOMENT, returns 0
scheduleNextCallback()           // requestAnimationFrame(loop), in the SAME time domain `now()` uses
```

`§15.5`'s own rewritten `sync()` (step 3(iv)) calls this exact sequence on every re-arm.
**The effect of skipping the explicit `advanceTo(now())` call, stated correctly this round (P2-2 —
the previous text here had this exactly backwards, confirmed by a direct read-only execution of the
proposed pacer's own code):**

| Arm at `t = 0` | First scheduled callback at `t = 1000` |
|---|---:|
| Omit the arm-time `advanceTo(0)` call | `0` ticks |
| Call the arm-time `advanceTo(0)` call | `4` ticks (the capped elapsed second) |

`createBattleFxPacer`'s own `advanceTo` (§15.2) treats its OWN first call — whichever call that
happens to be — as the "no credit, just record `lastTime`" case (`lastTime === null`). **Omitting
the arm-time call does not "jump ahead"; it makes the first REAL scheduled callback silently become
that first, no-credit call instead**, so the entire second of real elapsed time between arm and that
callback is DISCARDED, not credited — the preview would appear frozen at observation 0 through the
whole interval, then resume ticking normally only from that point on. **Calling `advanceTo(now())`
explicitly at arm time is what correctly CREDITS that elapsed interval** (subject to the 4-tick cap)
to the first real scheduled callback, which is the entire reason this step exists in the sequence
above — not to prevent a "jump ahead" (the pacer already caps that on its own, at every call,
regardless of arm-time behaviour), but to prevent losing real elapsed time to a preview that has
already painted a real frame and should not read as stalled.

**Reset semantics, stated exactly — `reset()` is called at every point a fresh playback begins:**
a new animation is selected, the user presses Replay, and nowhere else (completion and a manual
`stepPreview()` call do **not** reset the pacer — completion simply stops the mounted loop from
consuming further ticks, since `tickBattleFx(null)` is already a no-op, and `stepPreview()` bypasses
the pacer entirely, below — in ordinary synchronous JavaScript execution, nothing can interleave
with a callback's own return-and-consume of a tick count, so neither of these needs a reset guard of
its own). `reset()` zeroes both `lastTime` and the accrued fractional debt, so the very next
`advanceTo` call after a reset is guaranteed to be the "first callback, no credit" case above — the
arm sequence's own explicit `advanceTo(now())` call, immediately following, then re-establishes the
origin at that instant.

**The 4-tick cap, unchanged in spirit from `player.js:211`'s own "a stall or a hidden window never
fast-forwards" rule**, but expressed as a cap on the *raw accrued value* before it is floored into
whole ticks (`createBattleFxPacer`'s own `advanceTo`, §15.2) — a returning backgrounded tab gets at
most 4 ticks credited on its first callback back, with the (now-bounded) remainder discarded, never
carried forward as debt to "catch up" later.

**Unit tests, `node:test`, no real clock anywhere — `createBattleFxPacer` is called directly with
hand-constructed timestamps, using EXACT expected totals throughout, not a tolerance band
(corrected this round, P2-4 — consistent with §15.6's own canonical worked-example table, which
already asserts exact tick counts, never "within one"):**

- **Cadence, exact totals at common endpoints.** Two injected sequences over one simulated NES
  second, `t = 0` through `t = 1000 ms`: 60 Hz (`i * 1000/60` for `i = 0..60`) and 120 Hz (`i *
  1000/120` for `i = 0..120`) — both sequences share the exact endpoints `t = 0` and `t = 1000`.
  Summing every `advanceTo` call's own returned tick count across each full sequence must equal
  exactly `60` for BOTH — the same expected total regardless of how many callbacks it took to reach
  `t = 1000`, since `NES_FPS ≈ 60.0988` ticks accrue per real second of elapsed time, not per
  callback.
- **Fractional debt carries across calls, exact count.** A sequence of several small `advanceTo`
  calls whose *individual* elapsed times each floor to zero ticks, but whose cumulative elapsed time
  crosses one whole tick's own boundary partway through, must return that tick on the exact call
  where the boundary is crossed, and zero on every call before it — not "eventually returns a
  nonzero tick somewhere," a precise per-call expectation.
- **A single call with a multi-second gap** (a real stall, or a backgrounded tab's callback
  throttled to once every several seconds) returns exactly `4`, never more.
- **Reset, strengthened this round (P2-4: the round-1 test was too weak — a broken `reset()` that
  clears `lastTime` but forgets to zero `owed` would still pass a bare "returns 0" check, since the
  very next call after ANY reset always returns 0 as the "first callback" case regardless of whether
  debt was actually cleared).** Accrue real, nonzero fractional debt before calling `reset()`; the
  immediate next `advanceTo` call after `reset()` returns `0` (this alone does not distinguish a
  correct reset from the broken one above); THEN call `advanceTo` a second time, at an elapsed
  interval chosen so that if the pre-reset debt had NOT actually been cleared, the stale debt would
  push the returned tick count past what the fresh interval alone owes — assert the SECOND
  post-reset call returns exactly what a truly zero-origin pacer would owe for that interval alone,
  catching the specific broken implementation a bare "first call returns 0" check cannot.

**Smoke assertions run synchronously — stated explicitly this round (P2-4).** Every smoke-test
sequence that arms, captures a canvas frame, and calls `stepPreview()` (§15.7) executes within one
synchronous browser-side evaluation (the identical style every existing `main/smoke.js` step already
uses — no `await` between the arm and the assertions that follow it in the same block), so no
scheduled `requestAnimationFrame` callback can interleave with — and thereby silently add an extra
tick to — a sequence of exact, manually-driven observations. This is what makes the pacer's own
internal loop irrelevant to the smoke test's own correctness (below).

**`stepPreview()` never touches the pacer at all — it is exactly one synchronous `tickBattleFx` call
plus a repaint, unchanged from the original design.** The mount contract's own `stepPreview()`
export (§15.5's widget API) calls `tickBattleFx`/`drawnBattleFx` directly, the identical
`main/smoke.js:4850-4963` idiom the Sprite Forge's own export already establishes, so the smoke
test's stepping is independent of `requestAnimationFrame`, the pacer, and real elapsed time
entirely — a backgrounded or throttled window (the exact flakiness `main/smoke.js`'s own comment at
`:4850-4857` already names for the Sprite Forge) cannot affect it.

### §15.5 The UI

**Rewritten in full this round (P2-6): the original draft's `mountBattleFxPreview(container,
{getAnimation, tileset, palettes})` did not carry the metasprite catalog, mapper/room, or a
lifecycle return contract, and its own re-arm check compared a number (`current.anim`) against an
object, which can never be equal — a real bug in the prior text, not merely an omission.**

**The widget's full interface, gaining an injectable clock/scheduler pair this round (P2-2 — the
round-2 draft's own pacer tests only ever called `advanceTo` directly, so nothing exercised the
mounted widget's own arm-and-scheduled-tick integration; an implementation could omit the arm-time
`advanceTo(now())` call entirely and every specified test would still pass):**

```
mountBattleFxPreview(host, { getProject, getAnimationId, now, schedule }) -> { sync, stepPreview, destroy }
```

- `host`: a DOM element the widget owns completely — it builds its own canvas, Play/Replay button,
  and caption inside `host` once, at mount, and never expects the caller to touch `host`'s children
  again.
- `getProject()`: called fresh every time the widget needs project data — never cached across calls,
  never captured once at mount — returning the current `store.project`. From it the widget derives
  everything §15.3's fit figure, the tileset decode, and the palettes need: the resolved mapper
  (`resolveMapper(project.cartridge.mapper)`), `battleFxOamRoom(project, mapper)`, the metasprite
  catalog (`project.sprites.metasprites`), the battle tileset's own decoded tiles
  (`tilesetAt(project, project.rpg.battleTilesetId)`, `tileFromString`, the identical pair
  `character.js:69-73` already calls), and `project.palettes.sprite`.
- `getAnimationId()`: called fresh alongside `getProject()`, returning the currently-selected
  animation id or `null`. The widget never reaches into `spell.anim`/`battle.attackAnim` itself —
  which field holds the id is each Forge's own business (a spell's `anim`, an actor's
  `battle.attackAnim`), and routing that through a callback is what makes one widget usable by both
  (§15.8).
- **`now`** (default `performance.now`): a monotonic clock function, called exactly where
  `createBattleFxPacer`'s own `advanceTo` needs a timestamp — at the arm-time call in step 3(iv)
  above, and once per invocation of `schedule`'s own callback (below).
- **`schedule`** (default `requestAnimationFrame`): `schedule(fn)` registers `fn` to run on the next
  animation callback, called once after mount and once again from inside its own callback (the
  identical self-rescheduling `sprite.js:1260-1263`'s own `loop()` already does) — never called
  directly by anything in `sync()` itself.

**Injecting a fake `now`/`schedule` is what lets the Electron smoke test (`main/smoke.js`) drive the
arm-and-scheduled-tick integration deterministically, with no real timers and no real display
refresh rate involved — corrected this round to name the actual environment (P2-2: this widget
constructs real DOM (`host.appendChild`, `document.createElement`, `renderer/ui.js:8`), a real
canvas 2D context (`renderer/widgets/metasprite.js:40-49`), and uses `getComputedStyle`/
`ResizeObserver` for sizing (`renderer/ui.js:183-207`) — none of which exist under plain `node
--test` (`package.json:11-12`'s own test script, `:26-28`'s own devDependencies list no DOM
emulation library at all, `acorn` being test-only and unrelated). A mounted-widget integration test
is therefore an Electron smoke-test case, not a `node:test` case — §15.7's own corrected test row
states this explicitly.** A fake `schedule` the smoke test invokes by hand, synchronously, whenever
it chooses, is what lets the smoke test control exactly when "the next tick" runs, independent of
Electron's own real animation-frame cadence.
- Returns `{ sync, stepPreview, destroy }` — see below for each.

**`sync()` — called from the host Forge's own `render()`, after that render's own field rebuild,
and rewritten in full this round as explicit transitions (P2-2/P2-3: the original draft's own
identity-only re-arm check missed real, reachable inputs, and had no branch at all for an empty
animation).** Reads `getAnimationId()` and `getProject()` fresh, every call. The widget's own
internal state carries three things across calls, all cleared together: the stepper `state`
(§15.2), the armed selection's own `armedId`, and the armed selection's own `armedSignature` (below)
— never a bare object reference compared by identity, for the reason step 2 states.

1. **Unplayable (`id` is `null`/`None`, or `isPlayableBattleAnimation(id, project)` is false —
   `shared/project.js:3366-3374`, the same two-hop predicate `battletables.js:133-144`'s own
   `validAnimId` uses to resolve a compiled reference to `NO_ANIM`):** clear the stepper state
   (`state = null`), clear `armedId`/`armedSignature` (**both** — not just the stepper — so a later
   re-selection of the identical animation is correctly treated as a fresh arm, never as "unchanged
   from before None," covering A→None→A explicitly), stop consuming ticks (the pacer's own internal
   loop has nothing to advance), clear the canvas, disable Play/Replay, show one of three captions
   ("No animation selected," "This animation no longer exists," "This animation references missing
   artwork"), **set `bounds` to the named `64 × 64` blank fallback (§15.5's own dynamic-viewport
   passage) so a later `observeSize` callback has a defined viewport to size against rather than
   whatever the previous animation's own bounds happened to be**, and return. `animationSelect`'s
   own stale-id handling (`animationPickerOptions`, `shared/project.js:3471-3479`) is untouched; the
   widget adds no new substitution of its own, it only refuses to preview what the select itself
   already flags as not fully real.
2. **Empty (`isPlayableBattleAnimation` is true — it deliberately accepts `frames: []`,
   `shared/project.js:3366-3374`'s own comment: "vacuously playable... a separate, later check is
   what turns 'playable but empty' into 'arms nothing'" — but `animation.frames.length === 0`):**
   new this round (P2-3), handled as its own branch, distinct from step 1 and checked before step 3
   — clear state/`armedId`/`armedSignature` the identical way, clear the canvas, disable Play/Replay,
   set `bounds` to the identical named `64 × 64` blank fallback (above), and show a fourth, distinct
   caption: **"This animation has no frames."** Never described as a completed pass, and never falls
   through to `armBattleFx` at all (which would return `null` for it anyway, §15.1 — the point of
   this branch is the EXPLANATION, not the stepper outcome). Kept distinct from a *non-empty*
   animation whose every frame's own metasprite has zero tiles (§15.1's own zero-tile row) — that
   one stays live and times normally; only a genuinely empty `frames` array gets this branch.
3. **Otherwise (playable and non-empty) — reordered in full this round (P2-1: the original draft
   painted before its own inputs were ready).** Four sub-steps, strictly in this order, because
   `observeSize` cannot repair a paint made with stale inputs (below) — there is no "paint now,
   fix it later" available here:
   1. **Read and validate**, then **compute the frame signature** — `signature =
      animation.frames.map(f => \`${f.metaspriteId}:${f.duration}\`).join(',')`, the
      `(metaspriteId, duration)` pair per frame, never a check on the animation OBJECT's own
      reference (why, below) — **and, in the SAME pass, compute fresh art (the decoded battle
      tileset), fresh `room` (`battleFxOamRoom(project, mapper)`), fresh `bounds` (the logical
      viewport, §15.5's own dynamic-viewport passage — the union of every frame's own tile extents),
      and the fresh integer `zoom`/origin `fitZoom` derives from those bounds against the stage's
      own current layout size.** Nothing is painted yet.
   2. **Reconcile/re-arm state**, using only the signature/id computed above: if `id !== armedId ||
      signature !== armedSignature`, re-arm — `state = armBattleFx(animation)`, `armedId = id`,
      `armedSignature = signature`; otherwise preserve `state` exactly as it is (frame/timer
      untouched) — the identical distinction the original draft already drew, unchanged in
      substance, only reordered to run before painting rather than interleaved with it.
   3. **Paint exactly once**, using the fresh art/room/bounds/zoom/origin from step (i) and whichever
      `state` step (ii) left in place (freshly armed, or preserved) — never a paint using the
      PREVIOUS call's own bounds or art, and never two paints in the same `sync()` call.
   4. **Only if step (ii) actually re-armed**: `pacer.reset()`, paint having already happened in
      (iii), **then `pacer.advanceTo(now())` at this same moment** (§15.4's own arm-time fix —
      establishing the pacer's time origin the instant the fresh observation was painted, not
      waiting for whatever `requestAnimationFrame` callback happens to run next), then start
      auto-playing. If step (ii) did NOT re-arm, the pacer and the schedule are both left exactly as
      they were — an unchanged signature never resets or restarts anything about timing.

   **Why the destructure is genuinely unreachable, not merely made rarer** (unaffected by this
   round's own reordering — the reasoning is about WHEN `sync()` runs relative to an edit, not about
   the order of operations inside one `sync()` call): a duration edit writes `frames[index].duration`
   directly (`sprite.js:607`) and a frame deletion calls `frames.splice(index, 1)` on the SAME array
   (`:618`) — **the animation object's own identity never changes for either edit**, which is why an
   identity-only check (the original draft's real bug) would silently keep running the OLD stepper
   state against the NOW-DIFFERENT frames array, reaching a `tickBattleFx` destructure of
   `state.animation.frames[state.frame]` (`battlefx.js`'s own `tickBattleFx`, §15.2 — not this
   contract table's own header, which an earlier citation here wrongly pointed at) as `undefined`.
   **Limited to what the review actually confirmed, not every store event (corrected this round):** a
   SUCCESSFUL `store.commit()` mutates and then emits synchronously (`renderer/store.js:180-196`,
   `emit()` itself a plain synchronous loop over listeners, `:74-75`); `undo()`/`redo()` emit
   synchronously the identical way (`:233-253`); and `renderer/app.js:600-613`'s own `store.subscribe`
   handler calls the mounted Forge's `onProjectChange` directly for every one of those events, with
   `magic.js:261`'s own `onProjectChange: render` reaching `sync()` from inside that same call. A
   `requestAnimationFrame` callback cannot run until that synchronous chain (and any microtasks)
   finishes, so the earliest a mounted preview's own tick could run after any of these edits is
   strictly after `sync()` has already reconciled the signature against it — for a SUCCESSFUL
   `commit()`/`undo()`/`redo()`, which is the guarantee this claim is scoped to. **Two things this
   claim deliberately does NOT cover, restated correctly this round (P3-3 — the previous text's own
   reasoning for the first one was false):** a mutator that THROWS inside `commit()` skips `emit()`
   entirely (the `finally` block only bumps `_revision`, `emit()` sits after it and never runs) —
   but `commit()`'s own comment (`renderer/store.js:183-190`) describes exactly the failure mode
   this claim must NOT be read as excluding: "a mutator that splices/restamps the actor array and
   then THROWS has already changed actor identity" — a throwing mutator can leave the project
   PARTIALLY edited, with no rollback, and simply never notify anyone it happened. This is outside
   the successful-notification guarantee above (no `onProjectChange`, so no `sync()` call either),
   not because "no edit reached the project" (false — one may have), but because a throwing edit is
   a build/authoring-time bug this preview design has no obligation to reconcile against; no
   exception-recovery work belongs to this design. A live stroke notification (`store.touch()`,
   `{ live: true }`) is filtered out by `renderer/app.js`'s own `!detail.live` check and never
   reaches `onProjectChange` at all — this one genuinely is not a counter-example, since `touch()`
   never mutates an animation's own frames at all. The one caller that bypasses the internal
   `requestAnimationFrame` loop, `stepPreview()` (below), is the smoke test's own explicit,
   synchronous call — a test driving it correctly triggers `render()`/`sync()` itself after any edit,
   the same ordering a real user's own UI interaction already enforces.

   **Why the stage must be sized by layout alone, never by the art — and why `observeSize` cannot
   repair a stale paint (P2-1's own central finding).** The wrapper sets the canvas's own pixel
   dimensions and paints using whatever `width`/`height`/`originX`/`originY` it is given
   (`renderer/widgets/metasprite.js:42-49`), and the compositor clips exactly at those bounds
   (`:22-26`) — so a paint call made with the PREVIOUS selection's own dimensions is wrong the moment
   the selection or its art changes, regardless of what runs afterward. `observeSize` watches the
   *stage's* own border box (`renderer/ui.js:199-208`), not the canvas or its logical viewport — and
   §15.5's own persistent-stage design deliberately keeps that stage's own layout size independent of
   the art it happens to be showing, so moving a tile within a metasprite (an in-place art edit) does
   not itself change the stage's border box at all, meaning `observeSize` would never even FIRE to
   "repair" a paint made with stale bounds — there is no later event to catch this on. This is also
   why a fresh mount (no previous viewport to fall back to) cannot be handled by "paint now, size
   later": step 3(i)'s own bounds computation must already be correct before step 3(iii) ever paints,
   the first time exactly like every time after. The stage's own pixel size is therefore driven by
   its surrounding layout ALONE (the panel's own CSS, `fitZoom`'s own `min`/`max`/`reserve` options)
   — never by `bounds`; the canvas's own dimensions and CSS scale are what follow `bounds` and `zoom`
   instead, recomputed fresh every `sync()` call per step 3(i) above.

**`stepPreview()`** — exactly one synchronous `tickBattleFx` call plus a repaint, bypassing the
pacer and any `requestAnimationFrame` loop entirely (§15.4). The smoke test's own deterministic
hook, the identical `main/smoke.js:4850-4963` idiom the Sprite Forge's own export already
establishes.

**`destroy()`** — cancels the widget's own `requestAnimationFrame` handle (the `sprite.js:1302`
`cancelAnimationFrame` precedent, §15.10) and its own `observeSize` disposer (below).

**Both call sites, concretely — the persistent-DOM split, not a `field()` row:**

- **Magic** (`magic.js:247-252`'s existing single-panel structure): `body` — today a bare
  `el('div.panel-body')` that `render()` calls `fill(body, ...)` on directly (`:92-245`) — is
  restructured, once at mount, into `el('div.panel-body', null, fieldsHost, previewHost)`, where
  `fieldsHost` and `previewHost` are both plain `el('div')`s created at that same point.
  `render()`'s own final `fill(body, ...)` call becomes `fill(fieldsHost, ...)` — every existing
  field (`:92-245`, the `Animation` picker included, still beside its own `field()` call) is
  otherwise unchanged — and `render()` gains one line at its own end, `preview.sync()`.
  `previewHost` is passed to `mountBattleFxPreview` once, at mount, and is never touched by `fill()`
  again — the exact `clear(node).append(...)`/`fill()` distinction CLAUDE.md's own Conventions
  section calls out, and the same failure `sprite.js`'s own comment at `:1233-1247` describes for
  its two tabs, applied here as one panel-body split into a replaceable half and a persistent half
  rather than several persistent siblings (`tabsHost`/`editStage`/`listHost`/`detailHost`,
  `:1265-1289`) the way the original draft modeled it on — Magic's own DOM shape is one panel, not
  Sprite Forge's three, so the split happens one level deeper, inside the one `panel-body` the
  `.panel-body { overflow-y: auto }` rule (`renderer/styles/app.css:316-348`) already makes the
  single scrollable region.
- **Monster** (`monster.js:432-448`'s own `render()`/`body`, the identical `fill(body, ...)`
  shape as Magic's, confirmed by reading the function directly): the identical restructuring —
  `body` becomes `el('div.panel-body', null, fieldsHost, previewHost)`, `render()`'s own
  `fill(body, ...)` (`:447`) becomes `fill(fieldsHost, ...)`, and `preview.sync()` is called at
  `render()`'s own end regardless of whether an actor is currently selected. The `battleSection`
  helper (`:136-291`, called conditionally at `:526` only when `actor` is truthy) needs no change of
  its own for this — `sync()`'s own `getAnimationId()` callback simply returns `null` when there is
  no selected actor (`state.selectedActorId === null`, `:445`), which resolves through
  `isPlayableBattleAnimation`'s own `None` handling for free, the same cleared/disabled state a real
  `None` selection produces. A single `field()` insertion inside `battleSection` (the original
  draft's own mistake) would have been rebuilt and lost on every render, exactly as P2-6 found.
  **Monster's own `destroy()` must keep its existing `destroyed = true` assignment**
  (`monster.js:549`, read by an existing async guard at `:407`) **alongside the new
  `preview.destroy()` call, not in place of it** — named explicitly this round, per the review's own
  "Confirmed portions" note, since the two guard genuinely different things (an in-flight async
  callback checking `destroyed`, versus the widget's own `requestAnimationFrame`/`observeSize`
  cleanup) and dropping either would reopen the hazard the other already closes.

Both mount contracts forward the widget's lifecycle: `return { destroy() { preview.destroy(); ...
}, onProjectChange: render, stepPreview: () => preview.stepPreview() }` — `stepPreview` newly
exported by both Forges' own mount contracts, not only Magic's; Monster's own `destroy()` keeps its
existing `destroyed = true` line too (above), so its full shape is `destroy() { destroyed = true;
preview.destroy(); app.setMeta(''); }`.

**Dynamic viewport, computed per animation, sized from the stage — corrected in full this round
(P2-5).** The original draft reused `metasprite.js`'s own fixed `VIEW = 64`, `ORIGIN = 16`, `zoom =
4` (`:36-37`, `:41`) and claimed `LIMITS.metaspriteTiles = 16` (`shared/project.js:250`) proved this
was big enough for any battle metasprite. **That claim is deleted — it was false.** A metasprite's
own tile offsets are independently clamped to `-128..127` on both axes
(`normalizeMetasprite`, `shared/project.js:5144-5145`), sixteen tiles wide apart from each other if
an author places them that way, and `paintMetasprite` silently clips anything outside the buffer it
is given (`renderer/widgets/metasprite.js:23-25`) rather than erroring — a single tile authored at
`x = 64` is already entirely outside a 64-pixel canvas with origin 16, and would simply vanish with
no visual indication anything was wrong. `character.js:69-73`'s own identical fixed-size call is an
**older consumer this document does not claim as an exception, not a precedent phase 3 extends** —
CLAUDE.md's own rule ("a pixel canvas is sized from its stage, never from a constant") and the
source brief's own read-first item 8 both bind this specific preview to `fitZoom`/`observeSize`
(`renderer/ui.js:183-192`, `:199-209`), the same pair `map.js:282`/`:2261` and `tile.js:264`/`:1696`
already use for a sized, resizable canvas.

- **Logical viewport = the bounding box of every frame in the SELECTED animation**, not a
  fixed constant and not the worst case across the whole catalog: for each frame, resolve its
  metasprite and take the union, over every tile entry, of `[tile.x, tile.x + 8) × [tile.y, tile.y +
  8)` (each tile is 8×8 at its own signed offset); the viewport is that union's own width and
  height, recomputed on every re-arm (§15.5's `sync()`, above) so a small effect gets a bigger zoom
  than a spread-out one, rather than every animation sharing one fixed frame regardless of its own
  extent. **`originX = -minX`, `originY = -minY`** (the union's own top-left corner becomes canvas
  `(0, 0)`, tight, no wasted margin) — named exactly this round (P2-1) since the original draft left
  the origin computation implicit. **A finite, positive, blank fallback viewport, `64 × 64`, when the
  union is empty** — a non-empty, live, ticking animation whose every frame's own metasprite has
  zero tiles (§15.1's own zero-tile row; a real, legal case, distinct from an empty `frames: []`
  animation, which never arms at all — §15.5's own corrected `sync()`) has no tile extents to union
  at all; `64 × 64` is named explicitly (reusing the size the original, now-deleted fixed frame
  used) rather than left as an unstated edge case, so the canvas has a real, sized, blank area to
  clear on every tick instead of collapsing to `0 × 0`.
- **Zoom = `fitZoom(previewStage, boundsWidth, boundsHeight, { min: 1 })`**, recomputed both on
  every re-arm and from an `observeSize(previewStage, redraw)` callback (`renderer/ui.js:199-209`) —
  `previewStage` a fixed-size element inside `previewHost` that the canvas and its CSS scaling live
  inside, the identical `stage`/canvas split `tile.js`/`map.js` already use. `observeSize`'s own
  disposer is called from the widget's own `destroy()` (above), the same rule every other consumer
  of it already follows.
- **When the stage is too small for the bounds even at `zoom = 1`** (a stage narrower or shorter
  than the widest/tallest authored frame — `fitZoom`'s own `min: 1` floors the zoom there rather
  than letting it go to `0`), the canvas would overflow the stage's own box at its full logical
  size. `previewStage` is given a fixed size (from its own layout, not the canvas) and `overflow:
  hidden`, so the overflow is cropped rather than blowing out the panel's layout, and a caption
  reads **"Art extends beyond the preview area"** whenever this condition holds. **Crop detection
  uses the identical padding-subtracted content box `fitZoom` itself measures from** (`renderer/
  ui.js:184-188`: `stage.clientWidth`/`clientHeight` minus the stage's own computed padding, and
  `reserve` where one is passed) — named exactly this round, per the review's own "Confirmed
  portions" note — never the stage's raw `clientWidth`/`clientHeight` on their own, which would
  disagree with `fitZoom`'s own zoom decision by exactly the padding `fitZoom` already subtracts.
- **The compositor itself needs a real, backward-compatible change — corrected this round (P2-1):
  the original draft's claim that `paintMetasprite` "needs no change at all" was false.** Its own
  clipping test reads `px >= width || py >= width` — **`width` twice, never `height`**
  (`renderer/widgets/metasprite.js:24`) — so any viewport taller than it is wide (or any tile placed
  below `y = width`) is silently clipped regardless of a caller's own intended height; an 8×72
  viewport with a tile at `y = 64` loses that tile outright, confirmed by a direct read-only probe
  of the shipped function. `paintMetasprite` gains one new, optional, trailing parameter:
  `paintMetasprite(data, width, metasprite, originX, originY, decodedTiles, spritePalettes, height =
  width)`, appended at the end (not inserted into the middle). The clip test becomes `px >= width ||
  py >= height`.
- **`drawMetaspritePreview` (`renderer/widgets/metasprite.js:40-50`)'s own sizing interface is
  widened with defaults, and its own INTERNAL call to `paintMetasprite` (`:48`) DOES change —
  corrected wording this round (P3-4): the original draft's claim that this specific call site stays
  "byte-for-byte unchanged" was wrong; `drawMetaspritePreview` must now forward its own `height`
  option through to `paintMetasprite`'s newly widened signature, an eighth argument that line did
  not pass before.** `drawMetaspritePreview(canvas, metasprite, decodedTiles, spritePalettes, {
  width = VIEW, height = VIEW, originX = ORIGIN, originY = ORIGIN, zoom = 4 } = {})` — only its own
  hardcoded locals become defaulted parameters, forwarded straight through. **What actually stays
  unchanged is narrower and stated precisely: the DEFAULT BEHAVIOUR (no options passed → identical
  `64/16/4` square output) and the genuinely EXTERNAL callers** — `character.js:72`'s own call to
  `drawMetaspritePreview` (passes none of the new options, textually unchanged) and
  `test/unit/metasprite.test.js:55`/`:77`'s own DIRECT calls to `paintMetasprite` itself (call the
  compositor, never the wrapper, so they never see the wrapper's own internal change at all and stay
  literally byte-for-byte unchanged, with `height` defaulting to `width`). The battle preview calls
  `drawMetaspritePreview` with its own computed `width`/`height`/`originX`/`originY`/`zoom` every
  repaint.

**Tiles and palettes.** Unchanged in substance from the original draft, now sourced through
`getProject()` (above) rather than `store.project` directly: the battle tileset,
`project.rpg.battleTilesetId`, decoded the identical way `character.js:69-73` already does
(`tilesetAt`, `tileFromString`, `project.palettes.sprite` passed through unchanged) — because a
battle animation only ever plays during a real battle, which only ever shows the battle tileset;
previewing against the currently-selected Tile Forge tileset (whatever that happens to be) would
show tiles the effect will never actually be drawn from.

**What is drawn under the effect.** Unchanged: **nothing — a bare canvas, effect only, on the
page's own background.** The engine anchors the effect over a combatant slot
(`battle_fx_draw_go`/`battle_fx_draw_mon`, `engine/battleui.asm:1062-1093`), so a bare effect is a
defensible minimum, and drawing a placeholder party icon or "the first party member's own
metasprite" would be inventing combatant identity neither Forge has any business asserting — a
spell's own `anim` plays over whichever target or caster a real cast resolves to (§3.3,
target-vs-caster policy), which the Magic Forge does not know and should not guess at preview time;
an actor's own `attackAnim` plays over the caster's own slot, which the Monster Forge already knows
(it is editing that actor) but still has no business drawing a second, undeclared combatant under
it. Nothing under the effect keeps the preview honest about what it actually knows.

**Controls and canvas state, corrected this round for termination and skipped frames (P2-8); stale
cross-references to `sync()`'s own step numbers fixed this round (P3-4).** Play/Replay, one button
whose label switches with state: "Play" while idle (nothing armed, or a `None`/unplayable selection
per `sync()`'s own step 1 — corrected from "step 2," the original draft's own miscount once the
empty-animation branch was inserted ahead of it as step 2), "Replay" once the stepper has reached
its terminal `null`. **Auto-plays on a genuine re-arm** (`sync()`'s own step 3(ii): the id or the
content SIGNATURE changed — corrected from "resolving to a new... object," which described re-arming
by object identity, not this design's own actual signature-keyed rule) — the entire point of a
preview is "does this look right the moment I pick it," and a preview that sits inert until a second
click is a worse authoring loop than the Sprite Forge's own always-playing Actors-tab idle preview it
is modeled on.

- **`None` or an unplayable/stale selection**: the canvas is cleared and the control is disabled,
  with the caption naming which of the three reasons applies (`sync()`'s own step 1, above).
- **A frame skipped for exceeding room, or naming a zero-tile metasprite (§15.1's own two rows)**:
  the canvas is cleared for that tick specifically — matching the engine's own no-draw answer — and
  §15.3's own fit-skip caption (unchanged) explains the over-room case; a zero-tile frame draws
  nothing with no caption at all, since an author authoring a genuinely empty frame on purpose (a
  deliberate held beat with no art) is not a mistake to flag the way an oversized one is.
- **On natural termination**: the canvas is cleared, matching `battle_fx_draw_rts`'s own no-draw
  answer on `bt_fx_anim == NO_ANIM` exactly (§15.1's own corrected row) — this round's own P2-8
  finding replaces the original draft's "freeze the last frame" design, which both diverged from the
  engine for no stated reason beyond taste and had no defined behaviour for a sequence that ends on
  an already-skipped (oversized) frame (freezing would have shown either stale art from an earlier
  frame or nothing, undefined either way). §15.7's own smoke fixture is what proves the terminal
  state is genuinely cleared, not merely unchanged from whatever the last visible frame happened to
  leave on the canvas.
- **Replay is an explicit, FORCED re-arm — a distinct transition from ordinary `sync()`, corrected
  this round (P2-1: the previous text routed it through step 3(ii)'s own ORDINARY reconciliation,
  which only re-arms when the id or signature changed — Replay changes neither, so that routing
  would have left the button permanently unable to do anything).** Clicking Replay runs the identical
  read/validate → compute-fresh-inputs → paint sequence as an ordinary sync, but FORCES the
  `armBattleFx` call regardless of whether `id`/`signature` match `armedId`/`armedSignature` — an
  internal `sync({ forceReplay: true })`-shaped call is sufficient; the widget's own public interface
  (§15.5's own `{ sync, stepPreview, destroy }`) does not need to expose this option, since only the
  Replay button's own click handler ever needs it. Replay resets and re-establishes the pacer's own
  origin exactly as any other re-arm does (§15.4's own arm sequence), never a live-effect-then-re-arm
  case (§15.1's own NO_ANIM-over-live-effect row is explicitly not modeled by `armBattleFx`, and
  Replay is only ever enabled once playback has already reached its terminal `null`, so there is
  never a live effect to interrupt). **Ordinary `sync()` itself is UNCHANGED by this — it still only
  re-arms on an actual id/signature change**, which is exactly what keeps a finished preview's own
  terminal state intact across an unrelated render (an in-place art edit on an already-finished
  preview, §15.7's own test case, must still show `state = null`/a cleared canvas, never restart
  playback on its own).

### §15.6 The gate: the frame-for-frame trace test, designed exactly

**This test must exist and pass before any canvas code is written** (§7, as amended above). Golden-
trace shape, `sfx.test.js`'s own direction (`test/unit/sfx.test.js:521-576`, "the ROM driver and
SfxReplayer agree on every frame"): the ROM is the oracle, the JS stepper is what is under test.

**One fixture builder, an extension of `buildFxFitFixture`'s own shape (`rpg.test.js:5943-6048`),
not the four separate un-combined builders the original draft cited (`:5687`, `:5741`, `:5943-5950`)
— corrected this round (P3-10).** The single builder authors every frame's `duration` explicitly (no
frame is ever left to `normalizeAnimation`'s own default the way the existing `buildFxFitFixture`
rows do today — `frames: [{ metaspriteId: oversizedMetaId }]` at `:6004`, `frames: [{
metaspriteId: smallMetaId }, { metaspriteId: oversizedMetaId }]` at `:6011`, neither carrying a
`duration` — those are legal PROJECT authoring shapes, since `normalizeAnimation` defaults a missing
duration to 8 (`shared/project.js:5203-5213`), but not a legal STEPPER input on its own, per
`battlefx.js`'s own documented contract, §15.2) and returns the **normalized** animation/metasprite
data both sides of the trace consume.

**The normalization boundary, corrected this round (P2-5) — `normalizeProject`, never a private
import.** The round-1 draft's own instruction to import `normalizeAnimation`/`normalizeMetasprite`
"directly" cannot be implemented: neither is exported — both are bare `function`s in
`shared/project.js` (`:5138`, `:5203`), not `export function`s; only `normalizeProject` (`:5799`) is
a public entry point, and it is what calls both internally (`:5922-5923`,
`.map(normalizeMetasprite)`/`.map(normalizeAnimation)`). The fixture builder therefore: constructs
the whole variant project (the raw `mutate()` step every `buildVariantFull`-shaped helper already
does), then calls the exported `normalizeProject(project)` **once**, explicitly, before building —
and uses THAT SAME returned, normalized project both to build the ROM and to read the JS trace's own
animation/metasprite data, one normalization boundary for both sides rather than two independently
normalized copies that could disagree. This step is not optional or redundant with anything
`buildVariantFull` already does: `buildVariantFull` (`rpg.test.js:326-340`) calls `mutate(project)`
directly on the object `loadProject` returned (already normalized once, at load) and hands that SAME
in-memory object straight to `buildProject` with no reload and no re-normalization in between — and
`generate.js` itself deliberately does not normalize on every build (its own comment: "not on every
read"), reading `frame.duration & 0xff` (`generate.js:3649`) straight off whatever is in
`project.sprites.animations[...].frames[...]`. A `mutate()` step that pushes a raw, unnormalized
frame object with no `duration` therefore compiles to `undefined & 0xff = 0` in the ROM, not
`normalizeAnimation`'s own default of `8` — a genuinely different, silently wrong byte a fixture
that skips the explicit `normalizeProject` call (or that authors every duration by hand and assumes
that alone is enough) could ship without ever noticing, since nothing between `mutate()` and
`buildProject` ever normalizes on its own.

**The 16-tile ceiling and the exact-room/room+1/room+10 relationship, RE-TUNED this round (P2-3):
round 2's own `room >= 3 && room <= 14` bound did not actually preserve everything the fixture
claims.** `normalizeMetasprite` slices every metasprite's own `tiles` array to
`LIMITS.metaspriteTiles = 16` (`shared/project.js:5143`, `250`) — so a metasprite authored with MORE
than 16 tiles is silently truncated to 16 the moment `normalizeProject` runs. `OneOver`'s own
defining property is "exactly `room + 1` tiles," and the fixture separately KEEPS `Oversized = room +
10` (§15.6's own fit-fixture list, case 7's own `Oversized`/`Small` pair) — round 2's own `room <=
14` bound preserves `OneOver` (`room + 1 ≤ 15`) but NOT `Oversized`: at `room = 14`, `room + 10 = 24`,
already 8 tiles past the ceiling, silently sliced back to 16 by normalization — a DIFFERENT count
than the fixture claims to author, for any `room` above `6`. This round tightens the bound to
**`room >= 3 && room <= 6`** (so `room + 10 ≤ 16` as well as `room + 1 ≤ 16`, preserving both
`OneOver` and `Oversized` intact through normalization) and adds an explicit assertion, run
immediately AFTER `normalizeProject`, that every fixture metasprite's own normalized `tiles.length`
equals its authored count — a direct check that nothing the fixture built was silently sliced,
rather than trusting the room arithmetic alone to imply it.

**The concrete tuning: four filler combatants at 13 tiles per icon each (not `buildFxFitFixture`'s
own existing 12), verified against `sample-rpg` through `normalizeProject` on all three RPG-capable
boards** — `room` comes out `4` (MMC1), `3` (MMC3), `4` (UNROM 512), each inside `3 <= room <= 6`;
`Oversized = room + 10` is then `14`/`13`/`14`, each authorable intact under the 16-tile ceiling.
12-tile fillers (today's `buildFxFitFixture` shape) give `room` `8`/`7`/`8` — outside the tightened
bound, and `Oversized = room + 10` would be `18`/`17`/`18`, already over 16 before normalization even
runs.

**"More filler combatants" is REMOVED as a tuning lever this round — it does not work, and the
reason is structural, not a matter of degree.** `battleFormations` (`shared/project.js:3890-3906`)
calls `battleFormationSlice(command.monsters)` on a `battle` command's own monster list, and
`battleFormationSlice` (`:1156-1157`) truncates to `RPG_LIMITS.monstersPerBattle = 4` (`:1120`)
UNCONDITIONALLY — a fifth entry added to the SAME formation is simply never read at all.
`battleCombatantOamMax` (`:3794-3806`) computes its own `monsters` term as `Math.max(0,
...formations.map(formationSpriteCost))` — the MAXIMUM across every formation the project can
reach, not a sum — so even a genuinely SEPARATE, additional formation only moves the figure if its
own cost exceeds the existing maximum, which a same-shaped filler formation never does. **Raising
each existing filler icon's own tile count is the only lever this fixture has**, which is exactly
what the 12→13 retuning above does.

**The fit trace runs with MISS OFF, stated plainly this round (P2-3) — this is not an oversight, it
is a real constraint the tuning above is scoped to.** `battleFxOamRoom` subtracts `MISS_OAM_TILES =
4` (`shared/project.js:6475`) from room whenever `projectUsesMiss` is true (`main/build/
generate.js:2636`'s own gate), then clamps the whole result at `0` (`Math.max(0, ...)`,
`generate.js:2646-2649` — this design's own `battleFxOamRoom` export, §15.3, copies the identical
clamp) — so the identical four-filler-at-13-tiles fixture, built with MISS on, has the UNCLAMPED
subtraction `0`/`-1`/`0` (four fewer than the MISS-off figures above), which `battleFxOamRoom`
itself actually RETURNS as the clamped `0`/`0`/`0` — **corrected this round (P3-4): the unclamped
intermediate value was stated as if it were the real room figure, which it is not; the actual
returned room is `0` on every board, never negative.** Either way, room is `0` or less on every
board — leaving NO positive room at all, and no fitting frame at all could be authored for a MISS-on
trace under this tuning; the conclusion is unchanged, only the intermediate arithmetic was
mislabeled. The trace fixture is therefore built MISS-off, unconditionally — §15.7's own
ROM-identity matrix is the ONLY place a MISS-on (or hit-feedback-on) `sample-rpg` variant exists in
this design; the frame-for-frame trace itself never builds one. If a future mapper or formation
change ever made `3 <= room <= 6` impossible to reach with a reasonably-sized filler formation, the
fixture must fail loudly with its own named assertion rather than silently authoring (or silently
skipping) a fit case normalization would then corrupt — the identical "fail, never skip" policy
already stated for every other case in this fixture.

**Every admitted metasprite gets an unambiguous OAM tile signature — a real fix, not a restated
assumption.** The *existing* `buildFxFitFixture` does **not** already have this property (P3-10
finding, verified directly against 227ccb1) — `ExactFit` and `OneOver` both start their own tile
range at `150` (`rpg.test.js:6023`, `:6032`), and the unrelated `Sequence` fixture (`:5737-5779`)
uses metasprite `1` for all three of its own frames (`:5747-5750`, so a trace could never tell its
frames apart by drawn tile alone). The single builder this round instead assigns each admitted
metasprite its own disjoint tile-id block (following the *pattern* `buildFxFitFixture` already uses
for its OTHER entries, `64+i`/`90-91`/`100+i`, just fixed to never collide): `Dur1`, `Dur255`, the
three `Sequence` frames, `ZeroTile` (no entries at all — see below), `Small`, `Oversized`, `ExactFit`
(re-keyed off its own block, not `150+i` shared with `OneOver`), and `OneOver`, each a distinct,
non-overlapping range — so reading the drawn OAM shadow's own tile byte after a `battle_fx_draw`
call identifies *which* metasprite frame just drew, never ambiguous between two candidates. The
ROM's own draw answer continues to come exclusively from the OAM shadow it actually wrote (below),
never from re-running the JS side's own fit arithmetic to guess which signature "should" have drawn.

**Every case, in one catalog so one build serves all of them:**

1. One frame, duration 1.
2. One frame, duration 255.
3. Three-plus frames, distinct durations, one at 255 (extends the existing `Sequence` shape,
   `:5737-5779`, with a fourth frame at duration 255 and its own distinct metasprite instead of
   reusing metasprite 1 for all four).
4. An empty animation (`frames: []`) — arms and immediately reverts (`battle_fx_arm_at_empty`,
   `:322-325`).
5. **A single frame whose metasprite has zero tiles** (new this round, P2-3) — a legal, live,
   ticking animation (`animation.frames.length === 1`, so `armBattleFx` arms it and `tickBattleFx`
   times it normally) whose one frame never draws, at any tick — but NOT because the room compare
   skips it (corrected this round, P3-6): `battle_fx_draw`'s own room compare (`:1059-1061`) runs
   and PASSES for it (`0 <= BATTLE_FX_OAM_ROOM`, the `bcs` never takes), so execution falls through
   to the tail call (`:1092-1093`) exactly as a real, fitting frame's would. It is
   `draw_metasprite`'s own SEPARATE, LATER `ms_count == 0` return (`engine/entities.asm:621-624`)
   that stops it — distinct from case 4 (which never arms at all, `battle_fx_arm_at_empty` itself,
   not `battle_fx_draw`) and from the oversized fit cases below (case 7), which fail the room
   compare OUTRIGHT and so never even reach the tail call into `draw_metasprite` at all — the
   opposite order from a zero-tile frame, which passes the room compare and is stopped one call
   layer deeper instead.
6. Exact-room and room+1 fit cases — `buildFxFitFixture`'s own `ExactFit`/`OneOver` shape
   (`:6019-6035`) already builds exactly this pair; the single builder keeps both, fixes their tile
   collision (above), and is what pins the fit boundary itself, not only "far too big" (which case 7
   below, whose own `Oversized` metasprite is `room + 10` per `buildFxFitFixture`'s existing shape,
   still separately covers).
7. One frame that exceeds `BATTLE_FX_OAM_ROOM`, one that fits, **in both orders** — the existing
   `mixedAnimId` shape (`:6006-6012`, small-then-oversized) plus one new animation in the same
   builder, oversized-then-small, reusing the identical `Small`/`Oversized` metasprites (their own
   distinct signatures, above) rather than a second near-duplicate pair.
8. `NO_ANIM` itself, from a clean state — genuinely armed (`battle_fx_arm_at` called with `REG_ACC
   = NO_ANIM`), not skipped (below); a related but distinct pair of ROM-only cases immediately
   below exercises the same operand starting from a LIVE state instead, which this case does not.

**Canonicalizing the ROM's own inactive state before comparing — corrected this round (P2-1): the
original draft's assertion compared raw ROM bytes against an abstracted JS `null` and would have
failed for a CORRECT stepper at every termination.** On natural completion the ROM leaves real,
non-abstract values behind: `bt_fx_frame` is left at the frame count (the very `inc <bt_fx_frame`/
`cmp anim_count,x` that ends the effect, `engine/battleturn.asm:1193-1200`, increments the byte
*before* deciding to end, and nothing resets it afterward) and `bt_fx_timer` is left at `0`; only
`bt_fx_anim` itself becomes `NO_ANIM`. An empty arm (case 4) leaves whatever `bt_fx_frame`/
`bt_fx_timer` held *before* that call entirely untouched (`:312-325` writes only `bt_fx_anim`). A
JS stepper's own `null` state, by contrast, carries no frame/timer at all. Comparing these directly
is comparing two different representations of the same fact, not the fact itself. **The ROM
adapter, specified exactly:**

```
live = romAnim !== NO_ANIM
frame = live ? romFrame : null   // raw romFrame kept separately, for diagnostics only
timer = live ? romTimer : null   // raw romTimer kept separately, for diagnostics only
drawn = <independently read via the OAM shadow, battle_fx_draw, below — never derived from frame/timer>
```

`null` is stated explicitly as **an observational abstraction the adapter imposes, not a
one-to-one reading of every inactive engine byte** — the raw bytes are retained in the trace's own
diagnostic output (so a failing assertion still shows what the ROM actually left behind) but never
compared once `live` is false. `timer` is compared on **every** live observation, not "where the
fixture's own duration values make it meaningful" (the original draft's own hedge, removed this
round) — the corrected adapter makes every live `timer` comparison meaningful by construction, so
there is no longer a case where it would not be.

**Observation bound, computed from the fixture, never from the stepper under test (P2-1's own
second half — deriving a loop bound from the implementation being tested would let a broken stepper
choose its own bound and hide a wrong termination point entirely):** the sum of the fixture's own
*authored* durations for a non-empty animation (e.g. `1` for case 1, `255` for case 2, `2+3+4+255 =
264` for case 3), `0` for the empty animation and for `NO_ANIM` itself, observed through that bound
**plus 2** in every case — the same "+2 past natural end" the original draft already specified,
now anchored to a bound the fixture states up front rather than one read back off `bt_fx_frame`
after the fact.

**Two ROM-only cases pinning the ROM's own arm-over-live-state behaviour directly — new this round
(P2-2), asserting the ENGINE's contract with no claim of stepper equivalence, since `armBattleFx`
is deliberately restricted to fresh construction (§15.1, §15.2) and models neither case:**

| ROM-only case | Setup | Assertion | Wrong implementation it catches |
|---|---|---|---|
| Live effect, then armed with `NO_ANIM` | Arm a real, multi-tick animation (case 3); let it run a few ticks so it is genuinely mid-flight; call `battle_fx_arm_at` again with `REG_ACC = NO_ANIM` | `bt_fx_anim`/`bt_fx_frame`/`bt_fx_timer` are **unchanged** by the second arm call — the effect is still live, at the same frame/timer it was before | "An arm that clears on `NO_ANIM`" — a `battle_fx_arm_at` that treats every call as a fresh write regardless of the operand, rather than the real early `cmp #NO_ANIM`/`beq` (`:310-311`) that returns before touching any state |
| Live effect, then armed with a real, empty animation | Same mid-flight setup; call `battle_fx_arm_at` again with `REG_ACC` = an empty animation's id | `bt_fx_anim` becomes `NO_ANIM`, `bt_fx_frame`/`bt_fx_timer` are whatever the previous effect left them at (untouched, per `:322-325`, not reset to 0) | "An arm that leaves an empty animation live" — a `battle_fx_arm_at_empty` that forgets to write `NO_ANIM`, or one that also clears `bt_fx_frame`/`bt_fx_timer` when the real routine does not touch them at all |

Every OTHER fixture case (1-3, 5-7) seeds a known **clean, inactive** ROM state first — `bt_fx_anim
= NO_ANIM`, freshly booted or explicitly reset — before its own arm call, so the two cases above are
the only place "arm over a live effect" is exercised at all; case 8 (`NO_ANIM` itself) also seeds a
clean state and then genuinely **calls** `battle_fx_arm_at` with `REG_ACC = NO_ANIM` on it (never
"skip arming entirely," the original draft's own hedge, removed this round) — the identical operand
the table's first row above uses, just from a clean rather than a live starting state, so the same
call site is exercised both ways.

**The canonical worked example — duration 1 and duration 2, for one fitting, non-empty metasprite
`M`, folded in verbatim from round 1's own review (`handoff-next/battle-anim-phase3-design-
review1.md`, "Observation 0: explicitly confirmed"), since it is the precise shape every fixture
case above follows:**

| Duration | Observation 0 | Observation 1 | Observation 2 | Observation 3 | Observation 4 |
|---|---|---|---|---|---|
| 1 | `(true,0,M)` | `(false,null,null)` — termination | `(false,null,null)` — +1 | `(false,null,null)` — +2 | — |
| 2 | `(true,0,M)` | `(true,0,M)` | `(false,null,null)` — termination | `(false,null,null)` — +1 | `(false,null,null)` — +2 |

Live timers are `0` at arm (observation 0) and `1` at the duration-2 fixture's own observation 1 —
the one live tick the frame holds past arm before its own boundary compare ends it. The RAW ROM
frame/timer bytes after either completion are `1`/`0` (frame incremented to the one-frame catalog's
own count, timer reset), and stay so through the two extra observations — the exact fact the
canonicalizing adapter above exists to keep out of the comparison. Duration 255 terminates at
observation 255 (**not 256** — the original draft's own wrong-implementation table below had this
off by one; corrected). Case 4 (empty) and case 8 (`NO_ANIM` from a clean state) both read inactive
at observations 0, 1, and 2 — there is no "observation 0 is live" for either, since neither ever
arms anything.

**The trace loop, index 0 taken before any `battle_fx_tick` call — unchanged reasoning from the
original draft, confirmed correct by round 1's own review.** A real battle's own per-frame order
(`battle_tick`, `engine/battle.asm:233-245`) runs `battle_fx_tick` **before** `battle_dispatch` —
and it is `battle_dispatch` that reaches `apply_damage` → `battle_fx_arm_at` on the frame an effect
is newly armed. So the very first frame an armed effect is ever visible, it has already been drawn
once (via `battle_draw_sprites` → `battle_fx_draw`, later the same frame) with **no
`battle_fx_tick` call having touched it yet**. The trace therefore records observation 0
**immediately after arming, before the first `battle_fx_tick` call**, then ticks-then-observes for
every subsequent index, using the canonicalizing adapter above at every step:

```
observations[0] = adapt(bt_fx_anim, bt_fx_frame, bt_fx_timer, <battle_fx_draw, read via OAM>)
for i in 1 .. (bound + 2):
  callRoutine(nes, battle_fx_tick)
  observations[i] = adapt(bt_fx_anim, bt_fx_frame, bt_fx_timer, <battle_fx_draw, read via OAM>)
```

where `adapt(anim, frame, timer, drawn) = { live: anim !== NO_ANIM, frame: live ? frame : null,
timer: live ? timer : null, drawn }` and `bound` is the fixture's own stated bound (above, never
derived from `bt_fx_frame`/`bt_fx_anim` mid-loop). `drawn` is read the `:5386-5429`/`:6050-6079`
way: fill the OAM shadow (`$0200-$02FF`) with `$FF`, zero `oam_idx`, `callRoutine(nes,
battle_fx_draw)`, then read `oam_idx` (nonzero ⇒ something drew) and the drawn tile byte —
identifying which admitted metasprite just drew via its own disjoint tile-id block (above), read
from the full emitted tile sequence, never selected by re-running the JS side's own fit arithmetic
(a round-1 finding, P3-10: the ROM's answer must come from what the ROM itself wrote to OAM, or the
comparison silently degrades into the JS fit logic checking itself).

**Arming and per-tick observation, reusing the existing isolated harness by name — unchanged:**

- `callRoutine(nes, address)` (`:356-370`) — the stub-JSR mechanism every isolated call runs
  through.
- `selectBattleBank(nes, built)` (`:385-400`) — maps in the battle bank before any of the routines
  below are reachable at all.
- Arm through `battle_fx_arm_at` directly (`REG_ACC = animId`, `REG_Y` = an arbitrary combatant
  slot), the identical call shape `:5705-5712`'s own `arm` helper already uses — never by poking
  `bt_fx_anim`/`bt_fx_frame`/`bt_fx_timer` by hand, since arming *is* one of the three routines this
  test exists to hold to its contract.
- `bt_phase` pinned to `BP_MENU` (`:5703`, `:5758`) — the identical "not `BP_INTRO`" sidestep the
  duration and sequence tests already use, since the trace test is proving the tick/draw *contract*,
  not the `BP_INTRO` guard (already covered on its own, `:5386-5429`, and deliberately not
  reproduced by the stepper at all — §15.1, §15.10).

**The JS side of the same loop**, using `armBattleFx`/`tickBattleFx`/`drawnBattleFx` against
`normalizeProject(project).sprites.animations[id]` (the single normalization boundary above), never
a raw authored animation object and never a private `normalizeAnimation`/`normalizeMetasprite`
import:

```
let state = armBattleFx(normalizedAnimation); // = normalizeProject(project).sprites.animations[id]
const observe = () => ({
  live: state !== null,
  frame: state?.frame ?? null,
  timer: state?.timer ?? null,
  drawn: drawnBattleFx(state, room, tileCount)
});
const jsObservations = [observe()];
for (let i = 1; i <= bound + 2; i++) {
  state = tickBattleFx(state);
  jsObservations.push(observe());
}
```

**Assertion.** For every index, `assert.deepEqual` between the canonicalized ROM triple
(`{live, frame, timer, drawn}`) and the JS triple — `timer` compared on every live observation,
unconditionally (P2-1, above), the same "not through message capping" isolation the existing
duration test already applies (`:5671-5680`'s own header comment: never through a real battle
message, whose `MSG_HOLD = 45` would cap a long animation before this test could observe its
natural end).

**Wrong implementations this catches**, corrected this round where the review found an error:

| Wrong implementation | What it gets right that hides the bug | What the trace catches |
|---|---|---|
| Wraps (`frame = (frame + 1) % frames.length`, `advancePreviewFrame`'s own rule) | Looks correct on a short manual scrub | Diverges from the ROM the tick immediately after the ROM's own last frame ends (ROM: `live = false`; wrapped stepper: `live = true`, `frame = 0`) |
| Skips a single-frame animation's own hold (treats `frames.length === 1` as "no timing, end immediately on arm") | Passes every multi-frame case | Diverges at observation 0 or 1 for the `dur1`/`dur255` fixtures — a duration-255 single-frame animation would end after 0 or 1 ticks instead of 255 |
| Compares `timer <= duration` (or pre-increment `timer < duration`) instead of post-increment `<` | Off by exactly one tick per frame, easy to miss on a single manual check | Diverges by one index on **every** frame boundary in the 3(+)-frame fixture, not just the first — a single manual spot-check at frame 0 could miss a one-tick error that a full per-tick trace cannot |
| Treats duration 255 as "never ends" (plausible under this codebase's own `$FF`-as-sentinel convention — `NO_ANIM`, `NO_ACTOR`, `NO_ITEM` are all `$FF`, `shared/project.js:162`; a duration byte sharing that value is a different field with no sentinel meaning at all, but the confusion is an easy one to make by analogy) | Passes every duration below 255 | **Corrected this round (P3-10): diverges at observation 255 itself, not 256** — the duration-255 fixture's own worked-example row (above) terminates AT observation 255 (`engine/battleturn.asm:1179-1200`: the 255th tick's own post-increment compare is what ends it), so a "never ends" stepper is already wrong by observation 255, not one tick later |
| Decides fit once at arm time, caches it, never re-checks per frame | Passes a single-frame fit test | Diverges on the mixed-order fixtures (case 7) — the small frame must draw and the oversized one must not, independently, regardless of authored order |
| Reports a draw for a zero-tile frame (`0 > room` is false, so an implementation that folds the zero-tile check into the room compare alone reports "fits") | Passes every case with a real, non-empty metasprite | **New this round (P2-3): diverges on case 5** — the ROM never draws it, even though its own room compare passes exactly as a real frame's would (P3-6: `draw_metasprite`'s own separate, later `ms_count == 0` return is what stops it, not the room compare); the buggy stepper reports a draw every live tick |
| Keeps drawing the last frame after the pass ends (forgets to gate `drawnBattleFx` on `state === null`) | Passes every mid-animation observation | Diverges at the `+2`-past-termination observations — the ROM is silent, the buggy stepper keeps returning the final frame's `metaspriteId` |
| Compares raw ROM bytes against the JS stepper's `null` with no canonicalizing adapter (the original draft's own bug, P2-1) | Passes for a genuinely wrong stepper that happens to also leave frame/timer at 0 after ending | **Would reject a CORRECT stepper** at every termination, since the real ROM leaves `frame = count`, `timer = 0` behind, never `null` — this is why the adapter (above) is specified as part of the gate itself, not left to each implementation to improvise |

### §15.7 The remaining test plan

Round 1 corrected or added four rows (the smoke step, P2-8; the ROM-identity matrix, P2-7; the
pacer, P2-4; the dynamic viewport, P2-5). Round 2 adds a `sync()` synchronization row (P2-2), an
empty-animation control row (P2-3), the compositor `height`-parameter row (P2-1, immediately after
the golden-unchanged row below), and corrects the pacer row's own cadence assertions (P2-4).

| Test | Shape | Wrong implementation it catches |
|---|---|---|
| Stepper unit tests, no ROM | `node:test` calling `armBattleFx`/`tickBattleFx`/`drawnBattleFx` directly against small, hand-built, already-**normalized** animation objects (§15.2's own input contract) — fast, DOM-free, no `buildVariantFull`. Covers the same duration/sequence/empty/`NO_ANIM`/zero-tile/fit shapes as §15.6's fixture, but as pure-function assertions rather than a ROM trace | Any of §15.6's own wrong implementations, caught faster and without a build — these are the tests a phase-3 implementation runs on every save; §15.6's own gate is the acceptance proof that the fast tests agree with the real engine, not a replacement for them |
| **`sync()` synchronization cases (round 2's P2-2; two cases added round 3, P2-1)** | Six cases against a mounted widget with a fake `getProject`/`getAnimationId` pair a test can mutate between `sync()` calls, asserting pixels/viewport IMMEDIATELY when the `sync()` call itself returns — no `requestAnimationFrame`, no waiting on `ResizeObserver` — since §15.5's own reordered procedure makes this synchronously true by construction: (a) **frame deleted during playback** — arm a 3+-frame animation, advance a couple of ticks via `stepPreview()`, then mutate the underlying project so the currently-armed animation's own `frames` array is spliced shorter than `state.frame` (the identical in-place `sprite.js:618` shape), call `sync()` again, and assert playback restarted cleanly at observation 0 with no thrown exception — proving the signature-based re-arm catches this before any further `tickBattleFx` call can destructure the now-missing frame; (b) **duration edit** — arm, advance partway into a frame, mutate that frame's own `duration` in place (`sprite.js:607`'s own shape), `sync()`, assert a clean re-arm to observation 0 (the deliberate "duration changes are an identity change" policy, §15.5); (c) **in-place art movement** — arm, advance a couple of ticks, mutate a referenced metasprite's own tile x/y (not its frame's `metaspriteId`/`duration`, so the signature is UNCHANGED), `sync()`, and assert IMMEDIATELY, in the same synchronous turn, BOTH that playback position/timer are preserved (no re-arm) AND that the repainted pixels/viewport reflect the moved tile's own new extents — no intervening tick, no `ResizeObserver` callback; (d) **A→None→A** — arm a real animation, advance a few ticks, switch `getAnimationId()` to return `null` (`sync()`, assert cleared/disabled per step 1), then switch it back to the SAME id (`sync()` again), and assert a fresh re-arm at observation 0, not "no change"; (e) **new round 3 — first mount** — mount the widget fresh with `getAnimationId()` already returning a real, playable id (no prior `sync()` call, no prior viewport to fall back on) and assert the FIRST `sync()` call alone produces correct pixels and a correctly-sized viewport, with no separate "warm-up" call needed; (f) **new round 3 — in-place art movement while playback is finished** — let an animation run to natural termination (state is `null`, canvas cleared), then mutate a referenced metasprite's own tile extents in place and call `sync()`; assert the (still-cleared) canvas's own viewport reflects the new bounds immediately, proving bounds refresh does not depend on a live, ticking `state` to reach | (a) a `tickBattleFx` reaching the destructure-of-`undefined` `sync()`'s own re-arm exists to prevent (§15.5); (b) a stepper left holding a `timer` that no longer makes sense against the edited frame's own new duration; (c) a re-arm that fires on every unrelated in-place edit, OR a paint using the previous call's own stale bounds/origin (P2-1's own central finding — the case this row exists to catch directly); (d) a "same id, no re-arm" bug that leaves the canvas cleared/disabled after returning from `None`, or that resumes mid-animation instead of restarting fresh; (e) a widget whose first paint relies on a viewport computed on some earlier call that never happened, producing wrong dimensions or a crash on cold mount; (f) a bounds refresh implemented as "recompute only while a stepper tick is running," which would silently skip a terminated preview's own resize entirely |
| **New this round — empty-animation control test (P2-3)** | Select an animation with `frames: []` (a real, in-range, `isPlayableBattleAnimation`-true catalog entry — deliberately, per `shared/project.js:3366-3374`'s own comment); assert the canvas is cleared, Play/Replay is disabled, and the caption reads exactly "This animation has no frames." — never the terminal/"Finished, press Replay" state a completed pass would show. A second case switches from a real, playable animation TO this one and asserts the transition clears cleanly (no stale frame left on screen) | A `sync()` that falls through the unplayable check (true for this shape) and lets `armBattleFx` return `null` reach the SAME code path as a completed pass — the control would read "Replay" and clicking it would re-arm an animation with nothing to show, a confusing dead end distinct from every other cleared/disabled state |
| **Pacer unit tests (P2-4, cadence/reset corrected round 2 to exact totals — §15.4's own full specification)** | `node:test` calling `createBattleFxPacer` (§15.2/§15.4) directly with hand-constructed timestamp sequences, no real clock: (a) a 60 Hz and a 120 Hz injected sequence, common endpoints `t = 0`/`t = 1000 ms`, each sums to EXACTLY `60` total ticks across the full second — not "within one"; (b) fractional debt crosses a whole-tick boundary on an exact, predetermined call, asserted at that specific call, zero before it; (c) a single large gap returns exactly `4`; (d) `reset()` then a first post-reset call returning `0` (necessary but not sufficient on its own), THEN a second post-reset call at a chosen interval, asserted against exactly what a truly zero-debt pacer owes for that interval alone — catching a `reset()` that clears `lastTime` but forgets to zero `owed`, which the first-call-alone check cannot | A pacer that credits a tick on its own first callback (would immediately consume a duration-1 frame with zero elapsed time — the exact `player.js:209` mistake this design explicitly does not copy); one that drops fractional debt every call (would run measurably slow — caught at the exact call the corrected test (b) names, not merely "eventually"); one with no cap (a backgrounded tab "catches up" by playing many ticks at once on return); one whose `reset()` clears the time origin but leaks accrued debt across a Replay (the specific gap case (d)'s own two-call shape exists to catch) |
| **Widget-level arm-and-scheduled-tick integration test — moved to the Electron smoke environment this round (P2-2: the round-3 draft specified this as a `node:test` case mounting the "real widget," which is unrunnable there — `mountBattleFxPreview` builds real DOM (`document.createElement`, `renderer/ui.js:8`), a real canvas 2D context (`renderer/widgets/metasprite.js:40-49`), and calls `getComputedStyle`/uses a `ResizeObserver` for sizing (`renderer/ui.js:183-207`), none of which exist under plain `node --test`; `package.json:11-12,26-28`'s own script and devDependency list confirm no DOM emulation library is present at all)** | A `main/smoke.js` step: mount the widget with a fake `now()` the smoke step controls directly and a fake `schedule(fn)` that QUEUES `fn` without calling it, so the step decides exactly when "the next callback" fires. Select an eight-frame animation, every frame a DISTINCT visible tile and duration `1`. Set the fake clock to `t = 0` and select it (arming — observation 0, frame 0's own pixels visible); set the fake clock to `t = 1000` and invoke the queued callback by hand; assert the canvas now shows frame **4**'s own expected pixels (`toDataURL()` compared against that frame's known art) and that playback is still live (not yet terminated — 4 of 8 frames consumed) — the capped four-tick credit for one elapsed second, landing squarely inside the animation rather than at its very end or past it. A widget that never calls the arm-time `advanceTo(now())` (§15.4) still shows FRAME 0's own pixels at this point and fails. Finish the pass synchronously via `stepPreview()` (bypassing the pacer entirely, §15.4/§15.5); click Replay at a new fake `t`; repeat the delayed-callback assertion (advance the fake clock by `1000` again, invoke the newly-queued callback, assert frame 4's pixels again) — proving the arm sequence's own `advanceTo` call fires on every re-arm, including a FORCED Replay re-arm (§15.5's own P2-1 fix), not merely the widget's first-ever mount. **Teardown, stated explicitly and sharpened this round (P3-1: a callback can leave pixels untouched while still keeping a detached callback chain alive, which a pixels-and-no-exception check alone cannot catch)**: after the test calls the widget's own `destroy()`, invoke the RETAINED (still-queued, never-yet-called) callback once by hand and assert THREE things together — the canvas is unchanged, no exception is thrown, AND zero newly queued callbacks result (the fake `schedule` records nothing further) — not merely the first two. This requires the widget's own disposed check to run BEFORE both rescheduling and stepping, the opposite order from the Sprite Forge's own precedent (`sprite.js:1260-1263`'s own `loop()` calls `schedule(loop)` — scheduling its own successor — before `stepPreview()`, since that loop is never explicitly torn down and has no disposed check to order against at all): a battle preview's own post-`destroy()` callback that reschedules itself before checking disposal would requeue a new callback even though it correctly leaves pixels alone, passing a pixels-only assertion while leaking a callback chain forever. Real rAF cancellation and size-observer disposal are unchanged (§15.5's own `destroy()`, cancelling the real handle and the `observeSize` disposer) — this teardown check is about the INJECTED fake scheduler's own queue specifically, the one thing a real-rAF cancellation check cannot observe in a `node:test`-free way. And, unchanged from before: across every re-arm in this test (the mid-test Replay included) only ONE callback is ever queued at a time — a widget queuing a second, independent callback chain on re-arm (rather than the identical single self-rescheduling loop persisting across re-arms) would leave a stray queued callback this step's own single-queue bookkeeping would catch as an assertion failure (more than one pending callback where at most one is ever expected) | **The exact gap this row exists to close**: every OTHER test in this plan either calls `createBattleFxPacer` directly (bypassing the widget's own integration entirely) or bypasses the pacer entirely via `stepPreview()` — so a widget that never actually calls `advanceTo(now())` at arm time (§15.4's own fix) would pass every other specified test in this document while silently reading as frozen for a full second after every real selection or Replay, exactly the bug the corrected explanation (§15.4) describes; a widget that starts a second callback chain on re-arm rather than reusing its own single loop, invisible to any test that never checks how many callbacks are pending at once |
| **New this round — dynamic viewport unit/trace cases (P2-5)** | A unit case: an animation whose sole frame's metasprite has a tile at `x = 64` (well outside the OLD fixed 64-pixel/16-origin frame the original draft reused, `metasprite.js:36-49`) — assert the computed logical viewport (§15.5) includes that tile's own full `8×8` extent, not merely that "some" viewport was returned. A smoke case: resize the Magic Forge's own window/panel narrower than a wide animation's computed bounds and assert the "Art extends beyond the preview area" caption appears and the visible canvas is cropped rather than the panel's own layout overflowing | A preview reusing the old fixed frame silently clipping (`paintMetasprite`'s own out-of-bounds pixels are dropped with no error, `metasprite.js:23-25`) an animation whose art genuinely extends past `x = 64` with no indication anything is missing; a `fitZoom`/`observeSize` wiring that computes a zoom once at mount and never on resize |
| A renderer-side canvas test under `node:test` | **Not feasible, the same way `character.js`'s own `drawBattleSprite` has none** — both are thin canvas wrappers over `drawMetaspritePreview`/`paintMetasprite`, and `paintMetasprite` itself is already pinned byte-for-byte by `test/unit/metasprite.test.js`. A `node:test` process has no `HTMLCanvasElement`/`CanvasRenderingContext2D`, so nothing beyond the pure functions (`armBattleFx`/`tickBattleFx`/`drawnBattleFx`/`createBattleFxPacer`/`paintMetasprite`) can run there; the smoke step (below) is what actually exercises the canvas | N/A — states what is and is not covered, per the brief's own item 7 |
| **Smoke step — a concrete fixture, corrected this round (P2-8: the original draft's own step could pass for a trivially wrong preview)** | A two-frame animation, both frames referencing metasprites with genuinely **distinct visible art** (different tiles, not merely different ids), known durations, and both within `BATTLE_FX_OAM_ROOM` (fitting — no skip to confound the pixel comparison). Select it in the Magic Forge; capture the canvas via `toDataURL()` at: observation 0 (frame 0's own art visible, matching `toDataURL()` against a golden capture of frame 0 alone would over-specify implementation, so instead assert it differs from a blank/cleared canvas); the frame boundary (assert the canvas now differs from observation 0's own capture — frame 1's distinct art is visible); termination (assert the canvas equals a blank/cleared capture — §15.1/§15.5's corrected terminal state, P2-8 — and the control now reads "Replay"); exactly two ticks past termination (assert the canvas is still the identical blank/cleared capture, proving no stray redraw); after clicking Replay (assert the canvas matches observation 0's own earlier capture again, byte-for-byte, proving playback genuinely restarted rather than merely un-disabling the control). A second case, fitting-then-oversized-then-end: the first frame fits, the second exceeds room; assert the canvas clears for the SECOND frame's own tick specifically (the skip, distinct from termination) and then stays cleared through natural termination two frames later — proving a skip cannot be mistaken for a "stale but stable" pixel state the original draft's underspecified step could not rule out | A preview that never actually renders anything (a blank canvas at every observation would have passed the original draft's own "changed at least once" check only by accident, if at all); one that keeps animating past its own end; a Replay control that does nothing, or that resumes mid-animation instead of restarting; a skip that leaves stale pixels on screen rather than clearing, which could otherwise be mistaken for "the preview correctly held the previous frame" |
| **ROM-identity proof — an explicit board × live-feature matrix, corrected this round (P2-7: the original draft's "six fixtures plus two `sample-rpg` variants" never said which boards the variants covered; P3-8 further corrects the reason — two of the six, `sample-rpg`/`sample-rpg-mmc1`, ARE real RPGs with real battle code, `test/unit/nameentry.test.js:95-101`, so "cannot exercise RPG battle code" is false — the real gap is narrower: none of the six authors a LIVE battle animation reference, so none exercises the mapper-dependent cursor/MISS terms the moved arithmetic actually varies on)** | The matrix: the six checked-in fixture projects, untouched (none authors a live `attackAnim`/`spell.anim`, so this half only proves the extraction adds no byte to a project with no live reference to preview at all) — **plus** `sample-rpg`, built as an `mkdtemp` variant on each of MMC1, MMC3, and UNROM 512 (the three `rpgCapable()` boards `battleFxOamRoom`'s own inputs, `battleCombatantOamMax`'s mapper-dependent cursor term (`shared/project.js:3803`) and `projectUsesMiss`'s own independent `MISS_OAM_TILES` term (`:6475`, `main/build/generate.js:2636`) can actually vary across — in **two configurations each**: flipbook references live alone (`attackAnim`/`spell.anim` authored, phase 1b), and flipbook + `hitFeedback` + `miss` all live together (phase 2a/2b, the configuration that actually exercises the nonzero MISS term in the room formula). Baseline ROMs are built once, from a clean `227ccb1` worktree, and held fixed on disk; candidate ROMs are built from the implementation tree (post-extraction) against the SAME project JSON. Every matched pair is compared two ways: whole-ROM SHA-256, **and** the `BATTLE_FX_OAM_ROOM` equate's own value read out of `config.inc` directly — never fixture regeneration in place (CLAUDE.md's own "fixtures never regenerate in place" rule; `npm run sample*` is never invoked as part of this proof, only fresh `mkdtemp` project builds) | A `battleFxOamRoom` extraction that changes evaluation order relative to `projectUsesMiss`/`battleCombatantOamMax` (e.g. reading `mapper` before `reconcileCartridge` has run) and silently produces a different generated constant on exactly the boards/configurations where the room formula's own MISS or cursor term is nonzero — invisible to the six untouched fixtures alone, and invisible to a matrix that checked only the room equate without also confirming the whole ROM, or vice versa |
| `metasprite.test.js`'s existing square golden, byte-identical | Re-run as-is, no edit — `paintMetasprite`'s new `height` parameter defaults to `width` (§15.5), so neither of the two existing calls (`:55`, `:77`, neither passing an eighth argument) changes behaviour | A compositor change that accidentally alters square-viewport output for existing callers |
| **`paintMetasprite`'s own new `height` parameter (round 2's own P2-1)** | Three cases, all calling `paintMetasprite` directly with an explicit `height` distinct from `width` — a genuinely RECTANGULAR viewport in every case, deliberately not grouped with the square all-zero-tile case below (P3-4: the original draft wrongly grouped a square case into a set described as "all... height distinct from width"): (a) a TALL viewport (`height > width`) with a tile placed near the bottom (`y` close to `height`, well past the old bare `width` bound) — assert it paints; (b) a WIDE viewport (`width > height`) with a tile placed near the bottom of the SHORTER `height` — assert it is correctly clipped there, not merely at the old `width` bound; (c) a negative-offset case — a tile at a negative `x`/`y` composed with a non-zero `originX`/`originY` (the `originX = -minX`/`originY = -minY` shape §15.5 specifies) — assert it lands at the expected positive canvas coordinate | The exact bug this round's own read-only probe found: a clip test comparing `py` against `width` instead of `height` (`renderer/widgets/metasprite.js:24`, pre-fix) silently drops any tile at or past `y = width` regardless of the viewport's own real `height` — case (a) is the direct reproduction (an 8×72 viewport, tile at `y = 64`, zero opaque pixels painted); case (b) is the same bug from the other direction (a viewport shorter than it is wide, where the old code would have UNDER-clipped, painting past the real bottom edge) |
| **The all-zero-tile blank-viewport fallback — moved onto the BOUNDS computation this round (P3-4: `paintMetasprite` alone cannot prove this at all — it accepts a buffer and a width/height it is GIVEN, `renderer/widgets/metasprite.js:12-14`; it never constructs a viewport itself, so handing it a hardcoded 64×64 buffer proves nothing about whether the bounds FUNCTION would have returned `0 × 0` for this exact case, since that function is never called in such a test)** | Call the bounds/viewport computation (§15.5's own dynamic-viewport logic) directly with an animation whose every frame's metasprite has zero tiles; assert it returns width `64`, height `64`, and finite (`0`) origins — the named fallback (§15.5), not a `0 × 0`/`NaN`/undefined result. A second, end-to-end case mounts the widget with such an animation selected and asserts the resulting canvas is a `64 × 64` cleared/blank image | A bounds function whose all-zero-tile branch returns `0 × 0` (or throws, or returns `undefined`) instead of the named `64 × 64` fallback — invisible to any test that only ever calls `paintMetasprite` directly with a pre-chosen buffer size, since that size was never actually produced by the bounds function under test |

### §15.8 The Monster Forge question

**Design the preview as a shared widget so adoption is zero marginal engine/stepper cost.**
`renderer/widgets/battlefx.js` (§15.2) already has no Forge-specific code in it — it takes a
normalized `animation` object and returns state, nothing about "Magic" or "Monster" appears
anywhere in it. The canvas wrapper (§15.5's now-fully-specified `mountBattleFxPreview(host,
{getProject, getAnimationId}) -> {sync, stepPreview, destroy}`) is the part worth sharing too,
rather than writing it twice: a `renderer/widgets/battlefxpreview.js` (name chosen to sit beside
`battlefx.js` the way `metasprite.js`'s `drawMetaspritePreview` sits beside `paintMetasprite` — the
pure model and its DOM wrapper as neighbours, not one file) that both `magic.js` and `monster.js`
call, each supplying its own `getProject`/`getAnimationId` closures and its own persistent-host
split (§15.5's identical restructuring of each Forge's own `body`, applied to both). This is the
identical "extracted because two consumers need the identical drawing rules" move `metasprite.js`'s
own header comment already documents for `paintMetasprite`/`drawMetaspritePreview`'s own extraction
out of the Sprite Forge — applied one level up, to the preview widget as a whole rather than only
its pixel-painting core.

**Both scope questions stay open for Chris in §8, consistently — corrected this round (P3-11: the
original draft had §8 asking about `animationSelect` deduplication while this section separately
declared it settled "no," which is a real disagreement between the two, not two views of the same
answer).** Neither is a technical blocker; both are legitimate scope calls with a stated
recommendation each, exactly the shape every other §8 entry already takes:

- **Does the Monster Forge get the identical preview in phase 3?** Recommendation: yes, same
  phase — cost updated this round to match the corrected widget API (P2-6): one persistent-host
  restructuring of `monster.js`'s own `body` (the identical split §15.5 designs for Magic, not a
  bare `field()` insertion inside `battleSection`, `:282-291`, which P2-6 found would be rebuilt and
  lost on every render), one `mountBattleFxPreview` call, `stepPreview` forwarded on Monster's own
  mount contract alongside Magic's, and one more smoke step exercising it.
- **Should `animationSelect` itself (`magic.js:49-60`, `monster.js:88-99`, byte-for-byte
  duplicated) be deduplicated into the same shared module in this same phase?** Recommendation:
  no — real drift hazard, but not what a UI-polish phase is for; a future slice can move it beside
  the shared preview widget with no coupling to anything phase 3 ships.

Both were answered by Chris on 2026-09-14 (§10's own new changelog entry): yes to the Monster
Forge, no to deduplicating `animationSelect` — so phase 3 ships the widget in both Forges and
leaves `animationSelect` alone.

§8's own "Phase 3's own open questions" subsection is the one place both are actually put to
Chris; this section states the design and the recommendation, §8 asks.

### §15.9 Scope and ledger

Phase 3 adds no engine code, no generated byte, no schema field, and no save-format change, and
therefore earns no new `*_KERNEL_ALLOWANCE`/`*_BATTLE_ALLOWANCE` term (CLAUDE.md's own kernel-budget
section). This is not merely stated — it is what §15.7's own ROM-identity row (its matrix corrected
this round, P2-7) exists to prove, on every path this phase touches: the six untouched fixtures,
plus `sample-rpg` on each of MMC1, MMC3 and UNROM 512 in two configurations (flipbook alone;
flipbook + hit feedback + MISS together), each pair built once from a clean `227ccb1` baseline and
once from the implementation tree, compared by whole-ROM SHA-256 **and** the `BATTLE_FX_OAM_ROOM`
equate independently — not the six fixtures alone. **Corrected this round (P3-8): the six fixtures
are not projects with no battle code at all — two of the six (`sample-rpg`, `sample-rpg-mmc1`) are
real RPGs that DO reach the battle region** (`test/unit/nameentry.test.js:95-101`'s own baseline
list). The real gap is narrower and stated precisely: none of the six authors a LIVE battle
animation reference (`attackAnim`/`spell.anim`), so none of them exercises the mapper-dependent
cursor term or the MISS term the extraction's own arithmetic actually varies on — only a project
with a live reference, on every board the room formula's inputs can vary across, can prove that.
A pure relocation of existing arithmetic from `generate.js` into
`shared/project.js`, never a recomputation — §15.3's own one-line shadowing caution (this round's
addition) is an implementation-detail risk to name there, not a scope risk that belongs here.

**§15.5's own new `paintMetasprite`/`drawMetaspritePreview` widening (P2-1, this round) is
renderer-only, the same as everything else in this phase** — a widened function signature with
backward-compatible defaults, never a generated byte, a schema field, or anything a ROM build reads.
`metasprite.test.js`'s own existing golden (§15.7) is the acceptance proof for it specifically: the
two existing call sites are byte-for-byte unchanged. **Corrected this round (P3-4): the new test
coverage is not one uniform group of "four new cases" all exercising the same parameter.** Three new
`paintMetasprite` cases (tall, wide, negative-offset — §15.7) exercise the additive `height`
parameter and the existing origin arguments with negative-offset artwork (`originX`/`originY` are
not new — `paintMetasprite` already takes them and the wrapper already supplies `ORIGIN` twice,
`renderer/widgets/metasprite.js:12,48`; the existing golden already exercises them,
`test/unit/metasprite.test.js:55` — corrected this round, P3-2, from wording that could be read as
claiming origins themselves were a new argument); a SEPARATE new test, on the
bounds/viewport computation and the mounted widget rather than on `paintMetasprite` itself, exercises
the all-zero-tile fallback's own computed blank bounds (§15.7's own P3-4 fix) — a different function
under test, not a fourth case of the same parameter sweep.

### §15.10 What could go wrong

- **The stale/unplayable-id case (§15.5), widened this round (P2-3).** A preview that resolves
  `getAnimationId()`'s own return against the live catalog by numeric coincidence, or checks only
  `isValidAnimationRef` (in-range, not `NO_ANIM`) rather than the full two-hop
  `isPlayableBattleAnimation`, would draw animation N's *real* frames either for a stale id the
  select itself already refuses to substitute (`animationPickerOptions`, `shared/project.js:3471-
  3479`), or — the gap the original draft missed — for a real, in-range animation whose own frames
  name a missing metasprite, which the generator already silently resolves to `NO_ANIM`
  (`battletables.js:133-144`). Either way, silently undermines a refusal this document's own §8 ("a
  stale animation reference now refuses to build rather than resolving silently") already settled
  the policy on. Guarded by gating arm on `isPlayableBattleAnimation` specifically, in `sync()`
  (§15.5).
- **The render-tear case (§15.5), now stated for BOTH Forges, not only Magic.** A running preview
  living inside `magic.js`'s or `monster.js`'s own `fill(body, ...)` subtree would be destroyed and
  recreated on every unrelated project change (a rename elsewhere, an undo, another Forge's edit
  propagating through `onProjectChange`) — the exact defect class `sprite.js:1233-1247`'s own
  comment documents fixing for the Sprite Forge, and the exact mistake the original draft's own
  Monster Forge estimate made (a bare `field()` row inside `battleSection`, §15.8's own corrected
  cost). Guarded by the identical persistent fields-host/preview-host split in both Forges' own
  `body` (§15.5).
- **The in-place-edit staleness case (§15.5, new this round P2-6, corrected round 2 P2-2) — a real
  bug in the original draft, not a hypothetical, and the original draft named the WRONG cause.**
  The round-1 draft compared a raw numeric id (`current.anim`) directly against an object reference
  the preview was armed on, which can never be equal — a genuine bug — but then attributed the
  *stale-pixel* risk to `undo()` specifically, framing `commit()` as safe because it "mutates in
  place." **Backwards**: `store.undo()` replaces the whole project via `structuredClone`
  (`renderer/store.js:233-241`), so the selected animation's own object reference always CHANGES on
  undo — a reference-identity check would have caught that correctly. The actual gap is
  `store.commit()`'s own in-place mutation (`:180-196`): the Sprite Forge edits a selected
  animation's frames IN PLACE — a duration write (`sprite.js:607`) and a frame deletion
  (`.frames.splice`, `:618`) both mutate the SAME animation object's SAME `frames` array, so its own
  reference never changes at all, even though playback should restart (a deleted frame can leave a
  running stepper's own `state.frame` pointing past the array's new, shorter length, reaching an
  unhandled `undefined` destructure in `tickBattleFx` on the very next tick). Guarded by comparing a
  content SIGNATURE — every frame's own `(metaspriteId, duration)` pair — rather than an object
  reference at all (§15.5's own rewritten `sync()`), which catches an in-place edit correctly and
  treats a content-unchanged undo as correctly unchanged, closing both directions at once; art,
  palettes and room are refreshed from a fresh `getProject()` read on every `sync()` call regardless
  of whether the signature itself changed.
- **The inactive-state comparison case (§15.6, new this round, P2-1) — would have rejected a
  correct stepper, not merely admitted a wrong one.** A trace test comparing raw ROM bytes
  (`bt_fx_frame`/`bt_fx_timer`, left at the frame count and `0` respectively after natural
  completion, `engine/battleturn.asm:1193-1200`) directly against the JS stepper's abstracted `null`
  would fail for EVERY correct implementation at EVERY termination, the opposite failure mode from
  every other row here — a gate that rejects the right answer is worse than one that admits a wrong
  one, since the latter is at least discoverable by a real bug surfacing later. Guarded by the
  canonicalizing ROM adapter specified in §15.6, converting raw bytes to `null` only when `live` is
  false, applied identically on both sides of every comparison.
- **The zero-tile-metasprite case (§15.1/§15.2, new this round, P2-3; call-order corrected P3-6).**
  A `drawnBattleFx` that folds the zero-tile check into `tiles > room` alone (`0 > room` is always
  false) would report a draw for a legal, live, ticking frame the ROM never actually draws.
  `battle_fx_draw`'s own room compare (`engine/battleui.asm:1059-1061`) runs and PASSES for it —
  `0` is never greater than the room — so it is `draw_metasprite`'s own separate, LATER
  `ms_count == 0` return (`engine/entities.asm:621-624`), reached only after the room compare has
  already let it through, that actually stops the draw. Guarded by `drawnBattleFx`'s own explicit
  `tiles === 0` check (§15.2), and by §15.6's own dedicated zero-tile trace case.
- **The empty-animation-as-completed-pass case (§15.5, round 2's own P2-3).** A `sync()` with no
  explicit `frames.length === 0` branch would let a real, in-range, `isPlayableBattleAnimation`-true
  animation with zero frames fall through to `armBattleFx`, which returns `null` for it — the
  IDENTICAL outcome a genuinely COMPLETED pass produces — so the widget would show "Finished, press
  Replay" for an animation that never played a single frame, and clicking Replay would re-arm
  something with nothing to show, a confusing dead end. Guarded by an explicit branch checked before
  arming at all, with its own distinct "This animation has no frames." caption (§15.5).
- **The private-import case (§15.6, round 2's own P2-5) — would have failed to compile, not merely
  drifted.** A trace fixture builder that imports `normalizeAnimation`/`normalizeMetasprite`
  "directly," as the round-1 draft's own text instructed, cannot be written at all — both are bare,
  unexported `function`s (`shared/project.js:5138`, `:5203`), confirmed by a direct module-import
  probe. A less obvious risk survives even once the exported `normalizeProject` is used correctly:
  skipping the explicit normalization call and trusting hand-authored durations alone would still
  leave the ROM reading whatever raw, possibly-truncated tile counts an unnormalized `mutate()` step
  produced (the 16-tile ceiling case, above), since `generate.js` itself never normalizes on a
  build. Guarded by one explicit `normalizeProject(project)` call before building, whose SAME
  returned object feeds both the ROM build and the JS trace (§15.6).
- **The fit-figure duplication case (§15.3).** A preview computing its own `MAX_OAM_ENTRIES -
  battleCombatantOamMax(...) - ...` inline, agreeing with `generate.js` today and silently drifting
  the next time either side changes independently — the single-writer rule's own stated failure
  mode. Guarded by extracting `battleFxOamRoom` into `shared/project.js` as the one place either
  side calls, and by naming the local-variable-shadowing implementation trap explicitly (§15.3) so
  the extraction itself does not introduce a fresh bug while closing this one.
- **The display-rate case (§15.4), and its own three implementation traps (round 1's P2-4; a third
  added round 2's own P2-4, corrected this round, P2-2 — the risk itself was real, the stated
  DIRECTION of the failure was backwards).** One tick per `requestAnimationFrame` plays every
  duration at up to 2× speed on common high-refresh displays, defeating the entire reason this phase
  reproduces the engine's contract in the first place. Copying `player.js`'s own first-callback
  credit of one frame blindly would consume a duration-1 animation's entire hold with zero elapsed
  wall-clock time, since this preview (unlike the emulator) has already painted observation 0 before
  any tick has run. An unbounded catch-up on a returning backgrounded tab would fast-forward through
  many ticks at once instead of pacing normally. **Never actually calling `advanceTo` at arm time**
  makes the pacer's OWN first real call — whichever call that ends up being — silently become "the
  first call, no credit," so the first scheduled callback after a real arm returns `0` ticks and the
  entire elapsed interval before it is DISCARDED, not credited (confirmed by a direct execution of
  the proposed pacer: omitting the arm-time call yields `0` ticks at a `t=1000` callback after an
  arm at `t=0`; calling it yields the correctly-capped `4`) — the preview reads as frozen at
  observation 0 for that whole interval, the opposite symptom from "plays too fast." Guarded by
  `createBattleFxPacer` (§15.2/§15.4): no first-callback credit, a 4-tick cap on accrued debt,
  `reset()` called on every fresh arm so Replay cannot inherit stale debt, and an explicit
  `advanceTo(now())` call in the arm sequence itself — now made testable by an injectable `{ now,
  schedule }` pair on the widget's own mount options (§15.5), so an implementation that omits this
  call fails the widget-level integration test (§15.7) directly rather than merely being asserted
  correct by inspection.
- **A preview that is correct but decodes the wrong tileset.** Reading whatever tileset the Tile
  Forge currently has selected, or the project's first tileset, instead of
  `project.rpg.battleTilesetId` specifically, would show real, correctly-timed frames drawn from art
  that never actually appears in a battle — a subtler failure than a crash, since the animation
  timing (the thing §15.6 gates on) would look perfect while the pixels are simply wrong. Guarded by
  decoding `project.rpg.battleTilesetId` unconditionally, the identical source `character.js:69-73`
  already reads for the same reason.
- **The fixed-frame cropping case (§15.5, round 1's own P2-5) — a real gap in the original
  design, not merely a missed nicety.** A preview reusing `metasprite.js`'s own fixed `VIEW =
  64`/`ORIGIN = 16` would silently clip any authored tile outside that box — `paintMetasprite`'s own
  out-of-bounds check (`:23-25`) drops such a pixel with no error at all, and a legal metasprite tile
  offset can reach `x = 64` outright (`normalizeMetasprite`'s own `-128..127` clamp,
  `shared/project.js:5144-5145`) — so an author would see an incomplete, silently-wrong picture with
  no indication anything was cropped. Guarded by computing the logical viewport from the selected
  animation's own bounds every re-arm and sizing the stage with `fitZoom`/`observeSize`. **Round 1's
  own fix for this was itself incomplete** (round 2's own P2-1): a rectangular bounding box painted
  through the unmodified square `paintMetasprite` would still clip any tile past `y = width` on a
  viewport taller than it is wide — closed by `paintMetasprite`'s own new `height` parameter
  (§15.5). The genuinely-too-large-even-at-`zoom=1` case is labeled explicitly rather than clipped
  silently (§15.5).
- **A `requestAnimationFrame` loop that survives `destroy()`.** `sprite.js`'s own `destroy()`
  cancels its raf handle explicitly (`if (raf) cancelAnimationFrame(raf)`, `:1302`) precisely because
  navigating away from a Forge does not, on its own, stop a loop that keeps calling
  `requestAnimationFrame(loop)` from inside itself — an uncancelled preview loop, in either Forge,
  would keep ticking a detached `state` object and scheduling callbacks forever after the user has
  left it, a leak `main/smoke.js`'s own "visit every Forge" step (CLAUDE.md's own passage on
  `FORGES` as the single registry) would eventually surface as accumulating background work across
  a long session, if not caught directly. Guarded the identical way: the widget's own `destroy()`
  (§15.5) cancels its raf handle and its `observeSize` disposer before returning, and both Forges'
  own mount contracts call it from their own `destroy()`.

### §15.11 Reasoned rather than read

- **The exact wording of the fit-skip caption (§15.3)** is a new string this round invents, styled
  on `describeBattleAnimationOamWarning`'s own committed text (`shared/project.js:3855-3883`, the
  return template at `:3876-3882`) rather than quoted from it — no existing string says this, since
  nothing before phase 3 ever needed a per-frame, per-tick UI label.
- **The `$FF`-sentinel-confusion framing for "duration 255 treated as never-ending"** (§15.6's own
  wrong-implementation table) is this document's own inference from the codebase's *established*
  convention (`NO_ANIM`/`NO_ACTOR`/`NO_ITEM` all `= $FF`, cited), not a defect anyone has actually
  written — offered as the most plausible *shape* of that mistake, not a claim it was found anywhere.
- **The exact shared-widget module name, `battlefxpreview.js` (§15.8),** is a proposal, chosen only
  for consistency with `metasprite.js`'s own naming of its DOM wrapper; a phase-3 implementation
  brief is free to name it differently as long as the split (pure stepper vs. DOM wrapper, one file
  each) is kept.
- **`battle_tick`'s own per-frame ordering of `battle_fx_tick` before `battle_dispatch`**
  (`engine/battle.asm:233-245`, cited directly) is read, not inferred — but the conclusion drawn from
  it in §15.6 (that an isolated tick-then-observe loop under-counts a real frame's own first,
  free-drawn tick unless observation 0 is taken before any `tick` call) is this document's own
  reasoning about what that ordering implies for a trace harness, not a claim traced against a real
  multi-frame battle recording.
- **New this round: the dynamic-viewport bounding-box computation (§15.5, P2-5's own fix) has no
  precedent anywhere in this codebase to cite.** Every existing consumer of `fitZoom` (`map.js:282`,
  `tile.js:264`/`:1281`/`:971`) sizes its stage from a fixed, known content size (a screen, a
  16×16/8×8 sprite frame), never from a per-selection bounding box computed across a variable set of
  tiles at variable signed offsets. The "union of every frame's tile extents" rule and the
  "cropped + labeled" fallback are this document's own design for a genuinely new shape of problem,
  not an existing pattern being reapplied.
- **Round 1's own pacer unit-test tolerance ("within one tick, from flooring") is superseded, not
  merely restated** — round 2's own review ran a real, read-only execution of the proposed pacer
  arithmetic against exact injected 60 Hz/120 Hz sequences and confirmed both sum to exactly `60`
  ticks; §15.4/§15.7 now assert that exact total rather than a tolerance band, so this entry is
  removed as no longer describing the current design (kept here as a note of the correction itself,
  per this section's own "left an inference, now confirmed or replaced" role).
- **Every UI caption string** — the four "why nothing is showing" explanations in `sync()` (§15.5:
  "No animation selected," "This animation no longer exists," "This animation references missing
  artwork," and round 2's own new "This animation has no frames.") and "Art extends beyond the
  preview area" (§15.5's own viewport overflow case) — are this document's own invented strings,
  none quoted from existing UI text.
- **The `64 × 64` blank fallback viewport for an all-zero-tile animation (§15.5)** reuses the OLD,
  now-deleted fixed frame's own size only for lack of a more principled number to pick — nothing in
  the engine or the schema constrains what a "reasonable blank preview size" is, so this is a taste
  call a future implementation brief is free to change.
- **The 13-tiles-per-filler fixture tuning (§15.6), re-checked this round.** This round's own
  read-only probe measuring the ACTUAL `battleCombatantOamMax` figure a 13-tile, four-filler
  `sample-rpg` variant produces on each board (`4`/`3`/`4`) is a real measurement, not a guess — but
  the choice of 13 tiles specifically (rather than, say, 14, which would also satisfy `3 <= room <=
  6` on at least some boards) is this document's own pick, made for real margin below the ceiling
  rather than the tightest value that happens to work.

## §16. A party member's own attack visual (ROADMAP item 14 point 5)

Design round, `8cb76fc` (clean, `master`). §8 (2026-09-13) deferred this rather than dismissing it
and asked for it on the roadmap; ROADMAP item 14 point 5 is the result, with a sketch (quoted in
full in the brief that seeded this round): "authoring it belongs on the Character Forge, beside the
member's other battle fields, and playing it needs no new engine primitive — the same `bt_fx_*`
flipbook, armed from `attack_target`'s party-side call site over the attacker's own slot, plus one
more banked table indexed by party member." **Both halves of that sketch held** — the "no new
primitive" claim and the "indexed by party member" claim, item 4 below — confirmed by direct read
and by a real, measured, executed prototype (Appendix E), not merely relayed.

### §16.1 The candidates, costed (item 1)

- **(a) A flipbook over the ATTACKER's own party slot — recommended, and the one built.** The
  ROADMAP's own sketch: reuse `battle_fx_arm_at`/`battle_fx_tick`/`battle_fx_draw`
  (`engine/battleturn.asm:308-345`, `engine/battleui.asm:1039-1094` at `8cb76fc`) exactly as a
  monster's own `mon_anim_attack` already does, arming from the party's own physical-attack call
  site (`attack_target`, `engine/battleturn.asm:267-282`) the identical way `monster_turn_attack`
  (`:1350-1361`) already arms a monster's. **Corrected this round (fix round 2, review round 2,
  P2-2): the flipbook plays ONLY on a physical Attack, never as a spell-cast fallback — the design
  this document ships explicitly forbids the "swings or casts with no `spell.anim`" symmetric
  shape §1's own sketch first described.** What the player sees: the acting party member's own
  slot (`BT_PARTY_X`/`BT_PARTY_Y` + `slot * BT_PARTY_STEP`, `engine/battleui.asm:1065-1076`) plays
  a short flipbook when that member SWINGS, armed directly in `attack_target` (§16.2) — a spell
  cast with no `spell.anim` of its own shows the walk alone instead, never this flipbook (§16.3).
  This is deliberately NOT symmetric with a monster's own fallback (`battle_fx_arm_attack`'s
  monster branch, unchanged, still substitutes `attackAnim` for an unauthored spell) — Chris's own
  answer draws that asymmetry on purpose (§8). **Re-measured, fix round 1: 10 code bytes** (was 11, amendment
  round 1; was 17, amendment round 1's own party-caster-fallback-guard revision — both superseded
  figures, §16.2/§16.6 record why) on top of the already-paid `BATTLE_ANIM_BATTLE_ALLOWANCE` base,
  plus 1 table byte per party member (`party.length` bytes, never more than `RPG_LIMITS.party` = 4,
  §16.4). OAM consequence: none beyond what
  `allBattleAnimationIds`/`battleSpriteBudget` already account for (§16.7) — a party member's own
  flipbook is the SAME shared `bt_fx_*` effect a monster's already is, so it costs no second OAM
  budget line, only a possibly-larger worst-case frame if the party's own animation happens to be
  the largest one authored. Authoring cost: one more animation picker per party member, on the
  Character Forge (§16.8).
- **(b) A flipbook over the TARGET monster's own slot (an impact) — costed properly this round;
  round 1's own rejection reason was false and is withdrawn.** Round 1 rejected this on the ground
  that no two independent visual effects had ever targeted the same slot on the same tick before —
  **false, confirmed by direct read.** `cast_spell`'s own single-target damage/status branch
  already arms the shared `bt_fx_*` flipbook on `bt_target`, not the caster
  (`cast_spell_fx_go`, `engine/battleturn.asm:373-376`), and whatever routine then applies that
  spell's damage reaches `apply_damage` (`:1067-1070` at `8cb76fc`), which — when
  `HIT_FEEDBACK_ENABLED` — arms hit feedback (`battle_hurt_arm`) on the exact same `bt_target` in
  the same tick, before the damage itself lands. This composition already ships today for a
  monster casting a single-target spell at a party member, or a party member casting one at a
  monster: both the flipbook and hit feedback target the identical slot, and the two effects
  already have a real, working answer for which one is visible — `battle_fx_draw` runs BEFORE the
  combatant-icon draw calls (`engine/battleui.asm:864-877`, `oam_idx` still zero), so the flipbook
  wins sprite priority over an icon `battle_sprite_pc`/`battle_sprite_mon` might otherwise skip via
  the hit-blink check; hit feedback's OTHER half (the block-art attribute flash) is a background
  attribute write, not sprite OAM at all, so it never competes for priority with the flipbook in
  the first place. So candidate (b) is technically viable, and would reuse this exact,
  already-shipped composition with no new interaction rule to invent.
  **Costed**: anchor and call-site choice — no new anchor math at all, since `battle_fx_draw`'s
  existing `bt_fx_slot < MAX_PARTY` branch (`engine/battleui.asm:1063-1064`) already resolves
  either a party or a monster slot; arming would swap one register load at the party's own call
  site, `ldy <bt_target` in place of `ldy <bt_actor` — the same 2-byte zero-page load either way, so
  **the code-byte cost is identical to (a)'s, not a distinguishing factor**. OAM cost: identical to
  (a) — `allBattleAnimationIds`/`battleSpriteBudget` (§16.7) account for the single largest
  playable frame regardless of which slot it draws over. Author cost: identical (one animation
  field, the same authoring surface). What changes is purely what the field MEANS for a party
  member specifically: (a) reads as "my own flourish, over my own slot," matching what
  `battle.attackAnim` and `spell.anim`'s own heal/all-target case already mean; (b) reads as "an
  impact on whoever I hit," matching what `spell.anim`'s own single-target-damage case already
  means. Both meanings are real, already-shipped precedents in this same document — the choice
  between them is genuinely a visual/semantic one, not a technical one.
- **(c) Doing nothing new — the honest baseline, its own zero cost stated explicitly.** Hit
  feedback (§12) already blinks or flashes whichever monster a party member's physical attack lands
  on, and MISS (§13) already floats "MISS" over whichever monster dodged. So "a party member's own
  attack visual" is not, today, visually silent — the REACTION side already exists. **Incremental
  cost: exactly 0** — 0 code bytes (no new routine, no new call site), 0 table bytes (no new
  `pc_anim_attack` table), 0 OAM change (nothing new to budget for), 0 schema field. What it costs
  an author: nothing, since nothing changes. What the player sees: exactly today's game. This is
  not what ROADMAP item 14 point 5 asks for — it asks for an AUTHORED visual belonging to the
  attacker, the same authoring surface a monster's `battle.attackAnim` already is — so (c) is
  recorded here as the honest baseline this design must justify shipping something more than, not
  as a real candidate.

**Recommendation: (a), on the ROADMAP's own explicit words** ("armed from `attack_target`'s
party-side call site over THE ATTACKER'S OWN SLOT" — the brief that seeded this whole slice, quoted
in full at the top of §16), not on the withdrawn "no precedent for (b)" argument. Since (a) and (b)
cost the identical number of bytes (above), this is a textual/aesthetic call the ROADMAP's own
sketch already makes, not a byte-driven or OAM-driven one — I do not believe a genuine aesthetic
question remains open past what the ROADMAP's own words already settle, but if Chris reads it
differently, (b) is now costed well enough (this paragraph) to decide from directly rather than
needing another design pass.

**Scope note, corrected in fix round 1: this whole §16.1 is about `attackAnim`'s own role, which
stays candidate (a) regardless of what walks — the walk forward and the `attackAnim` flipbook are
two independent mechanisms that happen to compose.** Amendment round 1's own version of this note
claimed a physical Attack was "unchanged" by Chris's answer; that was true only for that round's own
spell-only shape. Fix round 1's "Attacks walk too" answer (§8) means `attack_target` now ALSO walks
before its own `attackAnim` arms — but candidate (a) itself (the flipbook plays over the attacker's
own slot) is exactly as designed here either way; the walk is a NEW, separate mechanism composing
with it (§16.3a), not a different candidate in this list. What changed on the SPELL-CAST side of the
fallback this section's own framing (§1, "swings or casts with no `spell.anim` of its own") used to
describe is the same as before: that fallback is replaced entirely by the walk-forward, designed in
§16.3/§16.3a/§16.3b.

### §16.2 The arm point (item 2)

**Before `roll_hit`, at the very start of `attack_target`** (`engine/battleturn.asm:267` at
`8cb76fc`) — the identical placement `monster_turn_attack` (`:1350-1353`) already uses, and for the
identical reason its own comment states: "the swing plays whether the hit lands or misses." Proven,
not merely argued: Appendix E's own SCRATCH probe (run and passed, §16.9) armed a party member's
attack with a forced miss (`acc: 0`, no RNG dependency, the identical trick
`fx-monster-miss` already uses at `test/unit/rpg.test.js:5228-5230`) and confirmed `bt_fx_anim`/
`bt_fx_slot` are set correctly even though the hit itself missed.

**Which registers are live there — corrected this round: the claim is that nothing needs the
PRE-arm-call register values, not that no downstream routine ever takes a register as an input at
all.** `attack_target` is reached by `jsr` from whatever dispatched the party's own physical Attack;
the very NEXT instruction after the new arm call is `jsr roll_hit`
(`engine/battleturn.asm:267-268` at `8cb76fc`, unshifted by this slice), which reads its own inputs
fresh from `bt_actor`/`bt_target` (ZP state, not A/X/Y) — so nothing `battle_fx_arm_attack`'s
documented clobber (A, X, Y, its own existing header comment) leaves behind is ever read. Further
downstream, `battle_say_actor` DOES take an argument in A (the message id) — `lda #BS_HITS` /
`jmp battle_say_actor` (`:273-274`) and `lda #BS_MISSES` (`:281`) — but this is safe for the
identical reason every earlier call already made it safe before this slice existed: `attack_target`
loads A explicitly, immediately before that jump, every time, several instructions and two
register-clobbering calls (`roll_hit`, then `physical_damage`/`apply_damage`/`print_num` on the hit
path) after the new arm call ever ran. The precise claim is: no register value that exists AT THE
MOMENT the arm call runs is read again anywhere in `attack_target` afterward — every later consumer
of A, X or Y loads its own value first. This matches `monster_turn_attack`'s own identical
placement, which clobbers the same three registers before its own `jsr pick_party_target` with no
issue today.

**Scratch preservation, stated explicitly and verified against the REBUILT diff (Appendix E), not
copied from a prior claim.** **Corrected this round (review round 3, P3-1): the design this
paragraph describes predates fix round 1's own arm-point redesign (§16.2 below), which removed the
party branch from `battle_fx_arm_attack` entirely — there is no such branch to speak of any more.**
The real, current code (Appendix E's `engine/battleturn.asm` hunk, `attack_target`, fix round 1) is
a direct four-instruction block — `ldx <bt_actor` / `lda pc_anim_attack,x` / `ldy <bt_actor` / `jsr
battle_fx_arm_at` — inserted at the top of `attack_target` itself, plus the unchanged monster helper
`battle_fx_arm_attack` (still reached only from `monster_turn_attack` and `cast_spell`'s own
no-`anim` fallback). Neither this direct block nor the unchanged `battle_fx_arm_at`
(`engine/battleturn.asm:308-325`) writes to `bt_tmp`, `bt_tmp2`, `bt_arg`, `bt_actor` or
`bt_target` — re-read line by line against Appendix E's own diff: the direct block only ever
`ldx`s/`lda`s/`ldy`s (register-only) before `jsr battle_fx_arm_at`, which itself only writes
`bt_fx_anim`/`bt_fx_slot`/`bt_fx_frame`/`bt_fx_timer`. The preservation conclusion below is
unchanged by this correction — only the source code it was proven against was stale.

**Corrected this round (review round 2, P2-2): that preservation is required, not merely harmless
to violate — the two are different claims, and the prior text conflated them.** `bt_arg`,
`bt_actor` and `bt_target` all have LIVE readers immediately downstream that treat their contents
as the identity of who is acting, who is targeted, or which spell is being resolved — a corrupted
value in any of the three would be wrong, not merely stale. `cast_spell`'s own dispatch
(`engine/battleturn.asm:358-380`) reloads `X` from `bt_arg` after its arming block (`:378`)
precisely because reloading recovers the correct spell index ONLY IF `bt_arg` itself was never
touched — a reload cannot repair a `bt_arg` the arm call had actually clobbered, it can only
re-read whatever is there. `roll_hit` (`:657-666`) and `physical_damage` (`:721-730`) both read
`bt_actor`/`bt_target` directly (`lda <bt_actor`/`lda <bt_target`) to look up accuracy, evasion,
attack and defence — a corrupted `bt_actor` there would silently redirect the roll and the damage
to a different combatant, and a corrupted `bt_target` would silently damage the wrong one. Only
`bt_tmp`/`bt_tmp2` are genuinely free to clobber on this specific path, because `roll_hit` and
`physical_damage` both overwrite them with fresh values of their own before reading either back
(`:658-663`, `:723-727`) — nothing on this path ever reads a STALE `bt_tmp`/`bt_tmp2` left over
from before either call runs. The verified fact stands (none of the five is actually touched); the
withdrawn claim is that touching the other three would have been safe.

**Fix round 1 (P2-4): `attack_target` arms directly, and `battle_fx_arm_attack` is left completely
untouched — reversing amendment round 1's own choice, once the policy behind that choice no longer
held.** Both shapes were considered again, this round, under the NOW-answered policy (§8: the walk
is unconditional, and the fallback is suppressed for a party caster with no exception — Chris never
wanted an attackAnim-substitutes-for-spell path at all):

- **A bespoke call site in `attack_target` reading `pc_anim_attack` directly (chosen this round).**
  `attack_target` gains a self-contained, gated block —
  `.if PARTY_ATTACK_ANIM_ENABLED / ldx <bt_actor / lda pc_anim_attack,x / ldy <bt_actor / jsr
  battle_fx_arm_at / .endif` — **measured 10 code bytes** (Appendix E, §16.9), and
  `battle_fx_arm_attack` (`:331-345` at `71cfa84`) is left **byte-for-byte as it already was**, no
  `.if`/`.else` split, no party branch added to it at all. Since `attack_target` is ALWAYS the
  party's own path (its own comment already states `bt_actor` is always `< MAX_PARTY` there), no
  `cmp #MAX_PARTY` branch is needed at this call site either — the party's own combatant slot IS
  their own `project.party` index (§16.4), so `ldx <bt_actor`/`ldy <bt_actor` reach `pc_anim_attack`
  and `battle_fx_arm_at` directly, with no `sec`/`sbc` detour a monster's own arm needs.
- **Growing `battle_fx_arm_attack` with a party branch** (amendment round 1's own chosen shape;
  superseded, not deleted). Cost 11 bytes at `attack_target`'s own call site, plus growing the
  shared routine itself, plus — once `cast_spell`'s existing fallback call reached that same growing
  routine — a SEPARATE, newly-needed 6-byte guard in `cast_spell` to suppress it for a party caster
  (17 bytes total, §16.6's own prior figure). That guard existed for exactly one reason: once
  `battle_fx_arm_attack` gained a REAL party branch, `cast_spell`'s own pre-existing, UNCHANGED call
  to it (`jsr battle_fx_arm_attack`, reached whenever a spell has no `anim`) would have reached that
  new branch too, arming `attackAnim` as a live fallback again — exactly what Chris's answer
  replaced. **Why this round rejects it**: with the fallback design settled (never wanted, no
  exception), there is no reason left to route a party member's own physical-attack arm THROUGH the
  same shared routine cast_spell also calls — doing so only re-created a hazard (the guard) that a
  bespoke call site never has in the first place, since `battle_fx_arm_attack` never learns about
  party members at all.

**Why `cast_spell` needs no guard under the chosen shape — verified, not assumed.**
`battle_fx_arm_attack` (`71cfa84:331-345`, UNCHANGED) already opens with `lda <bt_actor / cmp
#MAX_PARTY / bcc battle_fx_arm_attack_rts` — for ANY `bt_actor < MAX_PARTY` (every party caster), it
branches straight to `rts`, a pure no-op, before the monster-only `sec`/`sbc`/`mon_anim_attack`
computation ever runs. This guard already existed, unconditionally, before this whole feature — it
is what made the routine SAFE (if pointless) to call for a party actor at all. `cast_spell`'s own
existing fallback call (`:364`, `jsr battle_fx_arm_attack`, itself untouched by this round) therefore
ALREADY does nothing for a party caster, with zero new code, exactly the behaviour Chris's answer
wants — the walk shows and nothing substitutes. This is the entire reason the P2-4 shape needs no
guard: it never grows the one routine that would have needed suppressing.

**The "would be dead code" comment is corrected — for a different reason than amendment round 1's
own version claimed.** `attack_target`'s own header comment (`71cfa84:262-266`) said arming there
"would be dead code" because `bt_actor` is always `< MAX_PARTY` on this path. Appendix E rewrites the
comment to say a party member's own arm is now real, direct code at this exact call site — not
because `battle_fx_arm_attack` grew a branch reachable from here (amendment round 1's own framing),
but because `attack_target` now arms `pc_anim_attack` itself, with no detour through that shared
routine at all.

### §16.3 The spell-fallback consequence — answered (item 3, amendment round 1, extended fix round 1)

**Chris answered this on 2026-09-15** (§8, recorded verbatim): "Just have the player walk forward
then have the spell animation play." This is neither of the two options round 1's own §8 put to
him — it REPLACES the fallback concept for a party caster entirely, rather than choosing between
"attackAnim substitutes" (i) and "nothing substitutes" (ii). What this means for the engine,
decided technically here (not a further taste call): a party caster's own `cast_spell` call no
longer reaches `battle_fx_arm_attack`'s fallback branch AT ALL — that branch stays monster-only, and
needs no guard to stay that way (§16.2's own corrected paragraph, fix round 1). In its place: the
caster's own battle sprite steps forward (§16.3a), held by a new phase before `cast_spell` runs at
all (§16.3b), and once it runs, the spell's own `anim` (if authored) plays with the EXISTING,
unchanged §3.3 target/caster anchoring — no change to `cast_spell`'s own spell-visual branch
(`cast_spell_fx_spell` onward, §3.3) at all. An unanimated spell shows the walk alone — no longer a
recommendation, **Chris's own second-round answer, verbatim: "The walk alone"** (§8). §16.9's own
probe D proves the OLD fallback mechanism is gone (a party caster's un-animated spell no longer
arms `attackAnim`). **Corrected this round (fix round 2, review round 2, P2-2): the NEW mechanism's
own arming-timing claim ("one tick late, never early") is no longer proven for the SPELL case by a
current probe** — amendment round 1's own W2 probe drove this through `cast_spell` directly; fix
round 1 re-derived W2 to drive the identical claim through `attack_target` instead, once "Attacks
walk too" made a physical Attack the round's own new focus (§16.9). The spell-case timing claim
rests on §16.3b's own tick-by-tick account (read against the shared `battle_walk_wait`/
`battle_dispatch` mechanism both action types use identically) and the real poisoned/burned
regression's own attack-timing assertions, not a spell-specific isolated probe this round.

**Fix round 1: the walk is no longer spell-only, and no longer gated.** Two of Chris's own
second-round answers change this section's own scope, both recorded in full in §8: "Always on for
RPGs" (no `project.rpg.castWalk` field, no toggle — every RPG project's own battle bank carries the
walk unconditionally) and "Attacks walk too" (a physical Attack now walks forward before it resolves
too, not only a spell cast). Both are designed in full in §16.3a (the walk itself, re-costed) and
§16.3b (sequencing, now covering both action types) — this section's own account of the spell-cast
case above is otherwise unchanged by either answer: a spell still walks, then plays its own `anim`
or nothing, exactly as designed.

### §16.3a The walk forward, costed (item 2, amendment round 1; re-costed for always-on, fix round 1)

**What the player sees**: the acting party member's own battle sprite (the SAME static
`pc_metasprite,x` art `battle_sprite_pc` already draws, no new frames or art authored) slides
forward, toward the monsters (decreasing X from `BT_PARTY_X` = 200, since "the party stands on the
right," `engine/battleui.asm:846`, and the monster area starts near `BT_MON_COL*8` = 32,
`engine/constants.asm:958`), holds at the forward position through the action and its own message,
then snaps back the instant the message is dismissed (§16.3b). **Fix round 1: "the action," not
"the cast" — Chris's own "Attacks walk too" answer (§8) means a physical Attack walks identically to
a spell cast now**, both routed through the same mechanism (§16.3b).

- **(a) A fixed pixel step, held by a timer — an instant jump, no slide.** The sprite's own X would
  change in ONE step (0 to the full offset) rather than ramping, held for a fixed number of ticks
  before `BP_ACT` runs. Structurally near-identical to (b) below (both need a phase/timer to make
  the step VISIBLE for a few frames before the action proceeds, §16.3b) — the only difference is
  whether the draw-time offset is a flat `beq`/`bne`-selected constant or a per-tick ramp, a
  handful of bytes either way. Not built: it does not read as an actual WALK (a single-frame
  teleport, not motion), which is not what "walk forward" was asked for.
- **(b) An animated walk of several ticks — recommended, and the one built.** The SAME static art,
  drawn at an X that increments 2 pixels per tick over `WALK_TICKS` = 8 ticks (a plain `asl`
  doubling `bt_walk_step`, `engine/battleui.asm`) — a genuine slide, not a teleport, at zero
  new-art cost (still the single existing battle metasprite). **Corrected this round (review P3-7):
  the total distance is derived from `WALK_TICKS` and the `asl`'s own implicit ×2, not a separate
  `WALK_STEP_PX` constant** — amendment round 1's own version declared `WALK_STEP_PX = 16` beside
  `WALK_TICKS` but never actually read it anywhere in the compiled code (both draw-time offset
  computations used a literal `asl` on `bt_walk_step`, not the constant), an independently-editable
  value that could drift from what the code actually does with no test able to catch it. Dropped
  entirely this round; the total distance (16 pixels, `WALK_TICKS × 2`) is stated in prose, not as a
  spare constant nothing reads. The anchor moves `BT_PARTY_X` (200) to `200 − 16 = 184` at full
  walk, with no arithmetic underflow at any step (§16.9's own probe W1 samples the real OAM byte
  through the full ramp) — but this is a fixed FRAME anchor, not a bound on authored art: a
  metasprite's own tile offsets are added on top of it (`engine/entities.asm:641-650`), so an
  unusually wide or off-center authored `attackAnim`/battle-sprite metasprite could still overlap or
  wrap at the walked-forward position, the identical authoring responsibility every other anchor in
  this document already places on the art, not the engine.
- **Re-measured, fix round 1: 56 code bytes, folded into `BASE_BATTLE_CODE_BYTES_BY_MAPPER`
  itself, not a separate conditional allowance — the CORRECT accounting once the walk is
  unconditional.** Amendment round 1 measured this mechanism's own delta (`PARTY_CAST_WALK_BATTLE_
  ALLOWANCE = 72`) as a term charged only when an authored `project.rpg.castWalk` flag was live.
  Chris's own "Always on for RPGs" answer (§8) removes that flag entirely — every RPG project's own
  battle bank carries `BP_WALK`, `bt_walk_step`, `battle_walk_wait`, and both `bt_phase`-routing
  insertions (`spell_chosen_all`, `battle_target`, §16.3b) unconditionally, with no `.if` of any
  kind beyond what already assembles only for an RPG's own battle bank. CLAUDE.md's own kernel-
  budget rule ("a conditional feature's cost is a separate generated allowance, never folded into a
  base") does not apply here for the same reason it does not apply to `BE_RESTORE`'s own uniform
  +18 or the join-guard's own uniform +5 (both folded into this same base already, "The battle
  system" section) — there is no author who does not pay this cost, so charging it as a base
  increase is the correct model, not an evasion of the rule. **Measured directly**: a real "off"
  build's own code usage (items stripped out of the comparison, the same isolation the join-guard's
  own paragraph already uses) rose from `3783/3783/3823` to `3839/3839/3879` on MMC1/UNROM 512/MMC3
  — the identical +56 on every board, since nothing in the walk branches on `SPLIT_ENABLED` or
  anything else mapper-specific. **0 table bytes** — no new ROM table, confirmed directly
  (`battleTableBytes` unaffected).

**The 56-byte figure, broken down per insertion and reconciled against the OLD 72-byte gated
prototype — re-derived against this round's own rebuilt diff, not copied from the review.**

| Insertion | Bytes |
|---|---:|
| `battle_dispatch`: `cmp #BP_WALK` / `bne battle_tick_end` / `jmp battle_walk_wait` | 7 |
| `setup_monsters`: `lda #0` / `sta <bt_walk_step` | 4 |
| `spell_chosen_all`: add the zero/reset pair, replace the phase immediate | 4 |
| `battle_target`: add the zero/reset pair, replace the phase immediate | 4 |
| `battle_message_done`: `lda #0` / `sta <bt_walk_step` | 4 |
| `battle_walk_wait`: load/compare/branch/increment/return, plus the phase-transition/return tail | 14 |
| `battle_sprite_pc`'s own party X-offset block | 19 |
| **Total** | **56** |

Every row counted directly against the diff's own instructions (§16.9); the `battle_walk_wait` row
(14) and the party X-offset row (19) both match exactly, byte for byte, confirming the table is not
merely additive bookkeeping. **Reconciled against the OLD, amendment-round-1 gated prototype's own
72-byte figure**: that design paid `battle_target`'s own `bt_cmd == BC_MAGIC` filter
(`lda <bt_cmd` / `cmp #BC_MAGIC` / `bne ...`, 6 bytes, needed then because only a spell cast walked)
AND kept TWO separate fallback tails (`lda #BP_ACT` / `sta <bt_phase` / `rts`, 5 bytes each) inside
`spell_chosen_all` and `battle_target`'s own `.if PARTY_CAST_WALK_ENABLED` / ... / `.else` splits,
for the gate-off case. Fix round 1's always-on design needs neither: the filter has nothing left to
decide (both action types walk identically), and the walk code REPLACES the old unconditional tail
directly rather than sitting beside a kept fallback. `72 − 6 − 5 − 5 = 56`, exactly the total
above — confirming the 72→56 reduction is real removed work, not merely `.if`/`.endif` directives
disappearing (which emit zero bytes on their own either way).

**RAM: 1 new byte, `bt_walk_step`** (`engine/constants.asm`, chained after `bt_miss_left`,
unconditionally — the walk has no gate at all now, so this is simply the ordinary per-battle
allocation every other `bt_*` byte gets, not a "switched-off feature must not move any other
symbol's address" concern), zero-page (needs the `<` prefix, confirmed by `zeropage.test.js` passing
unmodified against the rebuilt diff). Counts UP from 0, saturating at `WALK_TICKS`, doubling as the
draw-time offset's own input directly (no separate "how far along" byte) — reset to 0 only at
message dismissal (§16.3b) and at `setup_monsters` (a fresh battle must not inherit a stepped
sprite), never mid-walk, so the same value that drives the slide also IS "is anyone currently
walking" (0 = no). Which slot is walking is never stored separately either — only the
CURRENTLY-ACTING party member (`bt_actor`) ever walks, so the draw-time check is `cpx <bt_actor` (in
`battle_sprite_pc`) or `cmp <bt_actor` against `bt_fx_slot` (in `battle_fx_draw`), not a second byte.

**`battle_fx_draw`'s own party anchor: follows the offset — recommended, and the one built, at a
measured, separately-named cost.** A caster-anchored effect (heal/all-target spell, §3.3, OR a
party member's own `attackAnim` armed over their own slot, §16.2) plays over wherever the acting
member CURRENTLY is, not their pre-walk position, so the visual effect stays anchored to the
sprite's own real, current position rather than appearing to hang in empty space behind it.
**Corrected this round (review P3-7): "heal/all-target is the only case a party slot holds an
effect" was false** — a MONSTER's own single-target spell aimed at a party member, and (new this
round) a party member's own physical-attack `attackAnim`, both also reach a party slot; the
implemented check (`bt_fx_slot` compared against `bt_actor`, not merely "is this slot < MAX_PARTY")
already handles all of these correctly, since it only follows the CURRENTLY-ACTING member's own
effect, never a monster's spell landing on some OTHER, non-acting party member. **Measured: 21 code
bytes** (unchanged in size since amendment round 1's own original figure — the snippet's own shape
never needed to change, only its gating did), **charged whenever `BATTLE_ANIM_ENABLED` is live,
with no second predicate to AND against** — amendment round 1's own version gated this on
`projectUsesCastWalk && projectUsesAnyBattleAnimation`, the `STING_SFX_INTERACTION_ALLOWANCE` shape
(two independently-authored features, charged only when both coexist). **That shape stopped
applying in fix round 1**: since the walk has no predicate of its own any more, this snippet's only
remaining condition is `BATTLE_ANIM_ENABLED` — the SAME single predicate `BATTLE_ANIM_BATTLE_
ALLOWANCE`'s own base 243 bytes already uses. **Fix round 2 (review round 2, P2-3): consolidated
into `BATTLE_ANIM_BATTLE_ALLOWANCE` itself (243 → 264), not kept as a separate
`WALK_FX_FOLLOW_BATTLE_ALLOWANCE` name.** Fix round 1's own choice to keep this snippet as its own
named constant "for traceability" turned out to buy no independently checkable claim: because both
terms shared the IDENTICAL single gate, no delta measurement could ever isolate them from each
other — every build that turned `BATTLE_ANIM_ENABLED` on assembled both at once, so
`bankedbytes.test.js`'s own equality test could only ever check their SUM, never either term alone,
and an opposite drift between the two halves that held the sum at 264 would have passed undetected.
One name, one measured, equality-checkable 264-byte allowance closes that gap; the `243 + 21`
provenance is kept in a source comment (§16.6) for the traceability fix round 1's own separate name
was actually after, with none of the false independent-verifiability it implied.

**OAM: none — confirmed, not merely asserted.** The walk redraws the SAME single sprite
(`pc_metasprite,x`) at a different X; no new OAM entries, no change to `battleCombatantOamMax`/
`battleSpriteBudget`/`battleFxOamRoom` (unaffected, confirmed by the measured table showing 0 table
bytes and no change to any OAM-budget figure across the six-fixture/regression run).

**`vram_buf`: none — confirmed.** Every walk-related write (`bt_walk_step`, `de_ex`/`de_ey`,
OAM) is sprite-side; no `vram_open`/`vram_push`/`queue_at` call anywhere in the walk's own code.

**Interaction with hit feedback's blink and the MISS overlay: none, for the identical reason §16.7
already establishes for the flipbook.** Hit feedback/MISS both react on `bt_target` (a MONSTER
slot) when a PARTY member is the one attacking or casting — the walk only ever offsets the
ACTING party member's OWN slot (0-3), never a monster's, so the two mechanisms never touch the
same OAM entries or the same tick's own budget in a way the walk changes.

**The MMC3 split: none, confirmed — sprites only.** The split (CLAUDE.md's own "MMC3's scanline IRQ
gives the font its own CHR bank" passage) concerns BACKGROUND CHR banking for text windows; the
walk touches only `de_ex`/`de_ey` (sprite draw parameters, `battle_sprite_pc`) and one new RAM
byte — no CHR bank switch anywhere in its own code, so no interaction with the split at all.

**Early message dismissal, an acting combatant "KO'd mid-walk," and the battle ending mid-walk —
all resolve to the SAME mechanism (§16.3b): the walk offset is capped at message dismissal,
unconditionally, with no alive-check and no separate revert phase.** An early A-press dismissal
reaches `battle_message_done` through `battle_message_wait`'s own existing branch (unchanged code)
exactly as a timeout does. A combatant genuinely dying WHILE walking cannot happen under this
engine's own synchronous, turn-exclusive design (nothing else runs concurrently with the acting
combatant's own turn resolution, confirmed by reading `battle_take_turn`'s own guard) — the closest
reachable proxy, the actor already showing 0 HP by the time the message dismisses, is proven to
still reset correctly, since the reset in `battle_message_done` has no alive-check of its own to
skip. The battle ending mid-walk is similarly unreachable (nothing can resolve a victory/defeat
condition during `BP_WALK`, since no damage has been dealt yet — the walk runs strictly BEFORE
`attack_target`/`cast_spell` ever executes); if this assumption were ever violated by a future
feature, the walk's own state would simply sit unreverted until whatever eventually reaches a
message dismissal, the identical "capped at the next message, not sooner" lifetime `bt_fx_anim`/
`bt_miss_left` already have (§12.4).

### §16.3b Sequencing (item 3, amendment round 1; extended to physical Attack, fix round 1)

**Reading list item 4's own question — does the battle dispatcher already support holding a phase
for N ticks?** Yes: `BP_MESSAGE`'s own `battle_message_wait` (`engine/battleui.asm:707-712`)
already holds a phase by decrementing `bt_timer` each tick until it (or an A-press) ends the hold,
returning without advancing `bt_phase` on every tick but the last — the IDENTICAL shape `Move`
waits on `move_tick` in the field (CLAUDE.md's own "The event system" passage). A NEW phase,
`BP_WALK = 12` (`engine/constants.asm`, appended after `BP_DONE`), reuses this exact shape with an
UP-counter (`bt_walk_step`) instead of `bt_timer`'s own down-counter, since the counter doubles as
the draw-time offset's own input (§16.3a) — no separate "how far along" byte, unlike
`battle_message_wait`, which has nothing analogous to reuse `bt_timer` for.

**Where the walk is armed — two insertion points, both already the SOLE places `bt_phase` becomes
`BP_ACT` at all (`grep BP_ACT` finds exactly two sites, both re-verified against `71cfa84`
directly) — both now UNCONDITIONALLY route through `BP_WALK`, per Chris's own "Attacks walk too"
answer (§8):**

- **`spell_chosen_all`** (`engine/battleturn.asm:212-215`), the all-target spell path (no separate
  targeting step) — ALWAYS a party member's own cast (`spell_chosen`, this routine's own caller,
  has exactly one caller of its own, `engine/battleui.asm:319`, the SPELLS list's "A pressed"
  handler — no monster-AI caller exists at all), so no `bt_cmd` check was ever needed here:
  unconditionally routed to `BP_WALK` instead of `BP_ACT`, with no flag of any kind (the walk has
  none).
- **`battle_target`** (`engine/battleui.asm:222-239`), reached from `BP_TARGET` once the player
  confirms a target — SHARED between a physical Attack's own targeting and a single-target spell's
  own targeting (both go through the identical player-driven UI). **Corrected this round: the
  `bt_cmd == BC_MAGIC` check amendment round 1 designed here is GONE, not merely unconditional.**
  Since both FIGHT and MAGIC now walk identically, the check that used to tell them apart has
  nothing left to decide — removing it, rather than making it always-true, is what the reviewer's
  own P2-6 finding costed as "about six bytes," now measured for real: the routing block dropped
  from needing a `bt_cmd`/`BC_MAGIC` compare-and-branch (6 bytes) plus the walk-start sequence, to
  just the walk-start sequence alone, replacing the OLD unconditional `lda #BP_ACT / sta <bt_phase`
  (4 bytes) with `lda #0 / sta <bt_walk_step / lda #BP_WALK / sta <bt_phase` (8 bytes) — a net +4 at
  this call site, folded into the same measured +56 base delta above (§16.3a), not itemized
  separately, since nothing here is conditional any more.

**Tick-by-tick — traced for a single-target damage spell, a heal, an all-target spell, a spell with
no `anim` of its own, AND (new this round) a plain physical Attack, since all five now share the
identical walk mechanism:**

- **A single-target damage spell** (or status): player picks MAGIC, aims via `battle_target`
  (routed to `BP_WALK` unconditionally) — ticks 1-8: the sprite slides forward, `bt_walk_step` 1→8,
  `bt_phase` stays `BP_WALK`; tick 9: `bt_walk_step` is already 8, `battle_walk_wait`'s own `bcs`
  fires, `bt_phase` becomes `BP_ACT` — `cast_spell` has NOT run yet this same tick; tick 10:
  `battle_dispatch` now sees `BP_ACT`, calls `battle_act` → `cast_spell`, which arms the spell's own
  `anim` over the TARGET (a monster slot, unaffected by the walk) and applies damage; the message
  then holds (`BP_MESSAGE`) until dismissed, at which point `bt_walk_step` resets to 0 and the
  sprite snaps back.
- **A heal** (self or ally, single-target or all — both anchor on the CASTER, §3.3): identical
  timing, except the spell's own `anim` (if authored) plays over the CASTER's own slot — which,
  per §16.3a's own "follows the offset" decision, is drawn at the STEPPED-FORWARD position, so the
  heal's own effect appears where the character visually is, not behind them.
- **An all-target spell**: identical timing via `spell_chosen_all`'s own direct `BP_WALK` routing
  (no `BP_TARGET` step at all, since there is no one target to aim at) — the caster-anchored
  effect (if authored) again follows the walk.
- **A spell with no `anim` of its own**: identical timing through tick 10, except `cast_spell`'s
  own existing fallback call to `battle_fx_arm_attack` is a no-op for a party caster (§16.2/§16.3,
  a pre-existing property of that routine, not a new guard) — nothing arms; the player sees the
  walk, then the spell's own damage/heal number and message, with no additional visual — the walk
  itself IS the visual, per Chris's own second-round answer ("The walk alone," §8).
- **A plain physical Attack (new this round, "Attacks walk too"):** player picks FIGHT, aims via
  `battle_target` (the identical routing site a spell's own single-target aim uses, now unconditional
  either way) — ticks 1-9 identical to the spell case above; tick 10: `battle_dispatch` sees `BP_ACT`,
  calls `battle_act` → `attack_target` (`bt_cmd != BC_MAGIC` routes here, §16.2), which arms the
  attacker's own `attackAnim` (if authored, over their OWN walked-forward slot — `battle_fx_draw`'s
  own follow-code applies here identically to the spell case, §16.3a), rolls the hit, and applies
  damage or a miss; the message then holds until dismissed, at which point the sprite snaps back
  the identical way. An unanimated physical Attack shows the walk, then the swing's own damage/miss
  message, with no additional visual — the same "walk alone" shape a spell with no `anim` gets.

**Does the damage number/message wait for the walk, or only the flipbook?** Both — there is nothing
in this engine that could show a damage number or a message BEFORE `cast_spell`/`attack_target`
itself runs, and neither runs until `BP_ACT` is reached (tick 10 above), so the walk necessarily
precedes the number and the message together, not merely the visual effect, for a spell OR a
physical Attack alike.

**Whether the sprite returns to its place, when, decided technically (not for Chris).** INSTANTLY,
at message dismissal (`battle_message_done`, `engine/battleui.asm`) — the identical place
`bt_fx_anim`/`bt_miss_left` are ALREADY unconditionally cleared there (`:718-732`, unchanged code),
now joined by one more `lda #0 / sta <bt_walk_step`, unconditional (the walk has no flag to nest
this reset under). No separate walk-BACK phase or timer: the return is a snap, not a reverse slide,
since the player is already looking at whatever comes next (the next line of a status tick, or the
next actor's own turn) by the time a message clears, and a whole second multi-tick phase (with its
own early-dismissal/actor-state edge cases to re-derive) would roughly DOUBLE this mechanism's own
cost for a return trip nobody is watching closely.

**Whether a monster's own cast or attack is affected at all: no, unchanged, confirmed by direct
read, not merely asserted.** `monster_turn_attack`/`cast_spell`'s own monster-caster path never
touches `bt_phase = BP_WALK` anywhere — `spell_chosen`/`spell_chosen_all` have no monster-AI caller
(above), and `battle_target` is reached only through PLAYER input (`pad_new`), never a monster's
own AI, so `bt_actor` is always `< MAX_PARTY` whenever either routing check runs. Symmetry was
considered and rejected: making the engine free for a monster to also walk would need `battle_menu`/
`monster_turn`'s own AI dispatch to ALSO route through `BP_WALK`, which shares no code with the
player-driven insertion points above and was not costed, since Chris's own answer only ever speaks
to "the player."

**Stated explicitly this round (review P2-4): the walk applies to Attack and spell casts ONLY —
Item and Run keep their own direct resolution, and never go through either `BP_ACT` entry point at
all.** `item_chosen` (`engine/battleturn.asm:222-259`, reached from `BP_ITEMS`, its own menu-level
phase, never `BP_ACT`) spends the item, heals, and messages directly in one pass, with no reference
to `bt_phase = BP_WALK`/`BP_ACT` anywhere in its own body. `battle_menu_run`/`battle_menu_flee`
(`engine/battleui.asm:203-219`, reached from `BP_MENU` itself, the instant RUN is pressed) resolves
flee directly the same way. Neither command was ever routed through `spell_chosen_all` or
`battle_target` — the two insertion points this section names are not "every party action," only
the two that already shared the `BP_ACT` transition before this slice existed (§16.3a's own "two
insertion points, both already the SOLE places `bt_phase` becomes `BP_ACT`" claim). An Item or a
flee attempt resolves on the same tick it is chosen, exactly as before this whole feature existed.
### §16.4 The table and the index space (item 4)

**The index space question (reading-list item 4) resolves to "no mapping at all" — corrected this
round to a direct proof from how a member's own index reaches and stays in that slot, not an
"equal capacities" inference.** Round 1's own version of this proof leaned on `RPG_LIMITS.party = 4`
(`shared/project.js:1119`) equalling `MAX_PARTY = 4` (`engine/constants.asm:585`) plus
`party_init`'s own boot loop bound — true, but equal CAPACITIES do not by themselves prove the SAME
NUMBER is used as the index everywhere; a real mapping could still exist between two equally-sized
spaces. The real proof is that every place a party member's own index is EVER carried — recruitment,
save/restore, and turn order — carries the SAME number through, with no translation step anywhere:

- **A Join names the member by the identical index the whole party array already uses, and nothing
  translates it.** `script_op_join` (`engine/script.asm:391-417`) writes the compiled member index
  straight into `bt_arg` (`:397`, `sta <bt_arg`) and calls `call_battle`; `battle_entry_join`
  (`engine/battle.asm:31-42`) loads that SAME value into `X` (`ldx <bt_arg`, `:31`) and, after only a
  range guard (`cpx #PARTY_SIZE`), jumps to `party_join` WITH IT. `party_join`
  (`:112-117`) uses that `X` directly as the RAM combatant-slot index (`sta pc_in_party,x`, `:116`)
  — so recruiting `project.party[3]` via a Join lands that member at RAM slot 3 directly, with no
  intermediate lookup anywhere in the chain.
- **Recomputing a member's own stats never moves them.** `party_restore` (`engine/battle.asm:199-205`)
  loops `X` over every slot in place (`ldx #0` / `jsr party_apply_level` / `inx` / `cpx #PARTY_SIZE`)
  and `party_apply_level` (`:151-157`, called from `party_join` too) reads/writes `pc_hp_max,x`/
  `pc_mp_max,x`/`pc_spells,x` at that SAME `X` — recomputation is always in-place, never a resort.
- **A save/restore is a positional copy, not a permutation.** `load_apply_body`
  (`engine/save.asm:500-530`) walks `SAVE_FIELD_COUNT` fields in a fixed order and copies each one's
  bytes straight from the save record into the SAME RAM addresses (`sta [save_ptr_lo],y`, `:515`) —
  `continue_game` (`:540-559`) calls it after `init_session`, with no step anywhere that could move a
  restored member's own array position.
- **Turn order sorts a LIST of combatant identifiers; it never renumbers the identifiers
  themselves.** `battle_round`/`order_insert` (`engine/battleturn.asm:20-43`) build `turn_order` as a
  list of real combatant ids (0-7) reordered by speed — the LIST POSITION is the turn sequence, never
  the combatant's own identity. `battle_take_turn` (`:145-150`) reads `turn_order,y` (list position
  `y`) and stores the VALUE found there into `bt_actor` (`:147`) — so `bt_actor` always holds a real
  combatant id, exactly the same number Join/`party_init` originally assigned that member, regardless
  of where they land in this round's own turn sequence.

Together: a party member's `project.party` array index, the RAM combatant-slot index every `pc_*`
RAM array uses, the ROM table index every `pc_*` ROM table (`pc_metasprite`/`pc_speed`/`pc_acc`/
`pc_eva`, `main/build/battletables.js:357-360`) uses, and what `bt_actor` holds during that member's
own turn are the SAME number at every one of these hand-offs, with no translation step anywhere in
the chain — not merely two equally-sized spaces that happen to agree by capacity. This is WHY
`battle_fx_arm_attack`'s new party arm (§16.2) needs no arithmetic at all beyond `tax` on `bt_actor`
— `lda <bt_actor / cmp #MAX_PARTY / [party branch] tax / lda pc_anim_attack,x` (Appendix E) —
genuinely simpler than the monster branch's own `sec / sbc #MAX_PARTY / tax / lda mon_slot_actor,x /
tax` detour through `mon_slot_actor` (needed because a MONSTER'S combatant slot and its ACTOR id are
two different numbers; a party member's combatant slot and its `project.party` index never are).

**The table: `pc_anim_attack`**, `mon_anim_attack`'s own shape applied to the party
(`main/build/battletables.js`, beside `pc_eva`, Appendix E), one byte per `project.party` entry
(`party.length`, never more than `RPG_LIMITS.party` = 4), indexed by the SAME number `bt_actor`
already holds — no second table, no lookup. **An unset or stale/unplayable reference emits
`NO_ANIM`** (`$FF`), the identical `validAnimId(id, project)` defense-in-depth call
(`main/build/battletables.js:143-145`) `mon_anim_attack`/`spell_anim` already use — `validAnimId`
resolves through `isPlayableBattleAnimation` (§16.5), so a reference whose animation exists but
whose own frame names a missing metasprite compiles to `NO_ANIM` here exactly as it already does for
an actor or a spell, never a fake metasprite id `draw_metasprite` would dereference unchecked.

**It sits AFTER `pc_eva` and BEFORE `pc_name`** in `battleTables()`'s own emission order
(`main/build/battletables.js:357-361` at `8cb76fc`, Appendix E) — grouped with the party's own
per-member numeric fields, not with `pc_starts`/`pc_metasprite` (identity/drawing fields) or
`pc_spells_at` (the per-level table further down). No particular ordering is load-bearing (nesasm
resolves every label regardless of source order within the bank); this is purely for a human reader
scanning the file to find one more per-member field beside its siblings.

**`battleTableBytes` needs no ledger change at all** — it counts `battleTables()`'s own emitted
output directly (CLAUDE.md's own "battleTableBytes counts emitted output... so that half can't
drift" rule; `main/build/battletables.js`'s own `battleTableBytes` export), so `pc_anim_attack`'s
`party.length` bytes are automatically counted the moment the table exists, with no separate byte
count anywhere in this document to keep in sync. Only the CODE portion (§16.2's new party branch)
needed a named allowance constant (§16.6).

### §16.5 Schema and reference integrity (item 5)

**Field name: `attackAnim`, flat on the party member object** — `project.party[i].attackAnim`, not
nested under a `battle` sub-object the way an actor's is (`actor.battle.attackAnim`). Justified by
the existing shape: `createPartyMember`/`normalizePartyMember` (`shared/project.js:4278-4302`,
`:5488-5524` at `8cb76fc`) already keep every per-member field flat (`baseHp`, `speed`, `acc`,
`eva`, …, no `battle` sub-object anywhere on a party member) — nesting a NEW field under a `battle`
key that does not otherwise exist on this object would be the one field breaking that shape, not
matching it. `normalizePartyMember` gains the identical byte-range clamp `normalizeActor`'s own
`battle.attackAnim` already uses (`raw.attackAnim >= 0 && raw.attackAnim <= 255 ? raw.attackAnim :
null`, Appendix E) — preserves a foreign or hand-edited `255` exactly as the actor/spell fields
already do, for the identical reason (§3.1: normalization preserves, authoring cannot produce it).
`createPartyMember` gains `attackAnim: null` (Appendix E).

**Every traversal that must learn about it, each verified by direct execution against a real
project (§16.9), not merely read:**

- **`animationReferenceLocations`** (`shared/project.js:3387-3424` at `8cb76fc`) gains one more
  yield loop, over `project.party`, `battleOnly: true` (Appendix E) — the SAME shape the actor's
  `battle.attackAnim` block already has, four lines up. **The wrong implementation this catches**:
  omitting this loop leaves the shared traversal — "the single location authority for deletion,
  validation, and battle-id collection" (its own header comment) — blind to the one new reference
  kind, so every consumer below silently mis-handles it despite each of THEM doing nothing wrong on
  their own.
  - **`battleSpriteBudget`/`describeBattleAnimationOamWarning`** (via `allBattleAnimationIds`,
    `shared/project.js:3453-3460`, unchanged): confirmed live — a party `attackAnim` of `1` on a
    project with animation `1` playable makes `allBattleAnimationIds` yield `1` (verified,
    §16.9). **Wrong implementation it catches**: a party attack visual authored large enough to
    overflow 64 OAM entries would silently NOT be counted, so the warning (§3.6) would under-report
    — an author ships a project the engine then skips the effect in, with no warning ever having
    fired.
  - **`renumberAnimationDeletion`** (`shared/project.js:3435-3444`, unchanged): confirmed live — with
    animations `[0, 1]` and `party[0].attackAnim = 1`, deleting animation `0` (called BEFORE the
    splice, the existing contract) shifts `party[0].attackAnim` to `0` (verified, §16.9). **Wrong
    implementation it catches**: the Sprite Forge's "Delete animation" handler
    (`sprite.js:539-543`) would silently corrupt every party member's own attack visual reference
    into pointing at the wrong (or a stale) animation on every deletion below it, with no error and
    no warning — the exact defect class `renumberAnimationDeletion` exists to prevent for actors and
    spells already.
  - **`validateProject`'s two-hop refusal** (`shared/project.js:7076-7120` at `8cb76fc`, unchanged
    code, now reachable for a party reference through the broadened traversal): confirmed live — a
    party member's `attackAnim` set to a stale id (`99`, no catalog entry at all) produces the exact
    `error`/`Sprite Forge` diagnostic naming `Party member 0 ("Hero")'s attack animation` (verified,
    §16.9, literal output captured). **Wrong implementation it catches**: a stale party reference
    would resolve silently at build time (`validAnimId`'s own defense-in-depth, §16.4) with no
    author-visible error at all — the project builds, the effect just never plays, and nothing tells
    the author why.
- **`projectUsesBattleAnimation`/`projectWithoutBattleAnimation`** (`shared/project.js:6452-6467`)
  keep their EXISTING CODE unchanged (actor/spell only) — but round 1's own patch left the
  PRE-EXISTING label, `'every battle animation reference'`
  (`main/build/battletables.js:1163-1165` at `8cb76fc`), attached to that narrow helper, which is
  exactly the "wrong implementation" round 1's own prose warned against and then shipped anyway
  (review round 1, P2 finding 3) — a mixed project (a monster's own `attackAnim` AND a party
  member's own) offered that advice would see its party effect, and the shared 264-byte mechanism
  (corrected this round, review round 3, P3-1 — was 243 before fix round 2's own ledger
  consolidation, §16.6), survive the "removal," with nothing in the label saying so. **Fixed in the
  ORIGINAL (pre-amendment) §16 review cycle's own Appendix, the label renamed to `'every monster
  attack or spell animation reference'`** (design fix round 2, review P3-1 — that cycle's own first
  rename, `'every monster or spell attack animation reference'`, still read as though both halves
  meant "attack," misleading for an authored Heal or other caster-anchored spell visual this same
  strip also clears, `engine/battleturn.asm:347-355,367-370`), scope-accurate for what
  `projectWithoutBattleAnimation` has always actually stripped, both before and after this slice.
  **The rename regressed silently when amendment fix round 1 rebuilt this prototype from a base that
  predated it — Appendix E carried the OLD, un-renamed label as an unchanged context line for three
  full rounds (fix rounds 1 through 3) with no review catching it — and is restored, with the
  identical current text, in fix round 4 (§10).** A SIBLING lever,
  `projectUsesPartyAttackAnim`/`projectWithoutPartyAttackAnim` (unchanged from round 1, labeled
  `'every party member's own attack animation'`), stays independent — the identical shape
  `HIT_FEEDBACK`/`MISS` already established for their own independent strip levers
  (`projectWithoutHitFeedback`/`projectWithoutMiss`). **A genuinely combined "strip everything"
  lever needs no THIRD entry**: `battleShortfallAdvice`'s own solver already tries every single
  lever alone (`soloWinners`) AND all of `bankedFeatures` combined
  (`main/build/battletables.js:1176-1198`, the `bankedFreed(bankedFeatures) >= deficit` branch) — with
  both correctly-scoped, correctly-labeled levers present, "all combined" already IS "strip
  monster/spell AND party," computed by the SAME before/after recomputation this document already
  relies on, so a third, redundant lever would duplicate what the solver's own "all combined" step
  already answers. **Wrong implementation this closes**: an author reading "every battle animation
  reference" and believing it means what it says, when it silently excluded an entire authoring
  surface this same document introduced — a real, shipped defect in round 1's own patch, not a
  hypothetical. **Proven by a real, executed mixed-reference probe** (§16.9): a project with both a
  monster's own `attackAnim` and a party member's own produces `bankedFeatures` entries whose
  labels now match what each one's own `strip` function actually removes, and whose combined
  removal frees the full total.
- **A third, broader predicate, `projectUsesAnyBattleAnimation`** (Appendix E, `shared/project.js`)
  is new — NOT requested by the reading list directly, but required by §16.6's own gating finding:
  `projectUsesBattleAnimation(project) || projectUsesPartyAttackAnim(project)`, the one predicate
  that decides whether the SHARED `bt_fx_*` mechanism (`battle_fx_arm_at`/`tick`/`draw`, the
  `mon_anim_attack`/`spell_anim` tables) assembles at all. See §16.6 for why this exists and why it
  is not merely `projectUsesBattleAnimation` broadened in place.

**No save-format change follows — checked against `shared/save.js`'s own inputs directly, not
asserted.** `SAVE_FIELDS` (`shared/save.js:102-132` at `8cb76fc`) names every RAM array a save
record carries; `pc_anim_attack` is a ROM table (`main/build/battletables.js`), never RAM, and
appears in neither `SAVE_FIELDS` nor any of `saveIdentity`'s own folded inputs
(`shared/save.js:224-230` — `screenCount`/`mapCount`/`actorCount`/`maxLevel`/`partyCount`/
`battleEnabled`/`itemsEnabled`/`itemCount`, none of them animation-related). Adding a field to
`project.party[i]` changes neither list.

**`samplegen.test.js`'s load-equality pin (`test/unit/samplegen.test.js:74-98`) and
`starters.test.js`'s byte-identical-to-`createProject` pin (`test/unit/starters.test.js:52-62`)
both survive unaffected, for the SAME underlying reason, checked against each mechanism
directly.** `samplegen.test.js` compares `loadProject(checkedIn)` against `loadProject(regenerated)`
— both paths call the SAME (now-broadened) `normalizePartyMember`, so both sides gain
`attackAnim: null` identically; `assert.deepEqual` still holds because the field is IDENTICAL on
both sides, not because it is absent from either. `starters.test.js`'s own pin
(`assert.deepStrictEqual(blankAction.build('X'), createProject('X', 'action'))`,
`:61-62`) compares two LIVE calls to the same `createProject`/`createPartyMember` chain, never a
hardcoded literal — so a new field added to `createPartyMember` changes both sides of the comparison
together, by construction, and cannot desync them. Neither test needed a single line changed; both
were re-run against the real prototype and pass (§16.9's own regression run, `test/unit/
samplegen.test.js` and `test/unit/starters.test.js` included in the six-fixture/full-suite pass).

**Fix round 1: there is no `project.rpg.castWalk` field at all any more, superseded history.**
Amendment round 1 designed a plain project-wide boolean here (`defaultRpg`/`normalizeRpg`, the
identical shape `hitFeedback`/`miss` already take). Chris's own "Always on for RPGs" answer (§8)
removes the field entirely — the walk needs no schema entry, no normalization, no default, since
every RPG project carries it unconditionally. Nothing in this section's own machinery
(`animationReferenceLocations`, `renumberAnimationDeletion`, `validateProject`'s two-hop refusal)
was ever built to know about it, and now never will need to.

### §16.6 Gating and the ledger (item 6; re-costed for always-on and P2-4's leaner arm shape, fix round 1)

**Decision: an independent gate and allowance term, `PARTY_ATTACK_ANIM_ENABLED`/
`PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE = 10`** (re-measured this round from 17, itself re-measured from
11 in amendment round 1 — §16.2 records why the figure DROPPED this round rather than growing
again: fix round 1's own P2-4 shape arms `pc_anim_attack` directly in `attack_target`, never
touching `battle_fx_arm_attack`, so the 6-byte `cast_spell` guard amendment round 1 needed no longer
exists at all — there is nothing left to suppress, since the routine it would have suppressed a
fallback in never learns about party members in the first place) — CLAUDE.md's own rule ("a
conditional feature's cost is a separate generated allowance, never folded into a base"), applied
here by the identical logic every other battle-region feature in this document already follows.
**But this needed one real correction along the way, found only by trying to fold it in first and
hitting an assembly-time hazard, not reasoned in the abstract:**

- **A naive "fold party into the existing `projectUsesBattleAnimation`/`BATTLE_ANIM_ENABLED` gate,
  with no separate flag at all" was tried first and rejected — not merely considered, actually
  attempted and found to under-charge, then found to risk a dangling symbol.** `battle_fx_arm_attack`
  (§16.2) is called UNCONDITIONALLY from `monster_turn_attack` whenever `BATTLE_ANIM_ENABLED` is
  live, for ANY reason — so if `BATTLE_ANIM_ENABLED` turned on for a PARTY-only project (no actor or
  spell ever authors a reference) while the `mon_anim_attack`/`spell_anim` TABLE emission gates
  stayed on the NARROW `projectUsesBattleAnimation` check, `battle_fx_arm_attack`'s own existing
  monster branch would reference a `mon_anim_attack` table THAT DOES NOT EXIST in that build — an
  undefined-symbol assembly failure, not a silent byte-count error. This is exactly the kind of
  interaction a delta-based measurement alone cannot see (CLAUDE.md's own kernel-ledger game-type
  trap lesson, applied here to a table-existence hazard rather than a byte-count one) — found only
  by building the party-only case for real (Appendix E, §16.9) and watching what `battle_fx_arm_attack`
  actually references.
- **The fix: `projectUsesAnyBattleAnimation` (§16.5) — the broadened OR — gates the FLAG
  (`BATTLE_ANIM_ENABLED`) and BOTH existing table emissions (`mon_anim_attack`, `spell_anim`,
  `main/build/battletables.js:265`, `:347` at `8cb76fc`, Appendix E), so whenever
  `battle_fx_arm_attack`'s monster branch can be reached (which is whenever `BATTLE_ANIM_ENABLED` is
  live, unconditionally), the table it references is guaranteed to exist.** The NEW
  `pc_anim_attack` table stays on the NARROWER `PARTY_ATTACK_ANIM_ENABLED`/
  `projectUsesPartyAttackAnim` — nothing references `pc_anim_attack` at all unless that narrower
  flag is live, so gating it any broader would be pure waste for a monster/spell-only project.
- **`BATTLE_ANIM_BATTLE_ALLOWANCE` (264, fix round 2's own consolidated figure — see below) stays
  charged whenever the BROADENED flag is live, not only when the NARROW one is** —
  `battleRegionBytes`'s own wiring is `projectUsesAnyBattleAnimation(project) ? BATTLE_ANIM_BATTLE_
  ALLOWANCE : 0` (Appendix E) — a party-only project needs the WHOLE shared base mechanism
  (`battle_fx_arm_at`/`tick`/`draw`, `cast_spell`'s wiring, `monster_turn_attack`'s call site, AND
  `battle_fx_draw`'s own follow-the-walker snippet, §16.3a), the identical machinery a monster/
  spell-only project already pays for, so it must pay the SAME figure — this is not double-charging,
  it is the SAME base cost attributed correctly to whichever predicate actually turned the flag on.

**Corrected this round (fix round 2, review round 2, P2-2): monster/spell-only projects are NOT
byte-identical to any pre-§16 shape any more — that claim is retired, not merely re-derived.**
Amendment round 1's own version of this paragraph (and fix round 1's, uncorrected) claimed a
monster-only `sample-rpg` variant assembles to "the pre-existing 250-byte delta (243 code + 7
table)," matching an EARLIER phase's own pinned figure to the byte. That comparison is now
apples-to-oranges: fix round 1 made the walk's own +56 code bytes UNCONDITIONAL, present in every
RPG project's own battle bank regardless of whether it authors any battle animation at all — so a
monster-only project's own battle code no longer matches ANY pre-`§16` or pre-fix-round-1 baseline;
relative to the OLD, pre-this-whole-feature build, it gains `56 (the walk) + 21 (the follow snippet,
now folded into the 264 figure) = 77` code bytes, not zero. What DOES still hold, verified by
measurement (§16.9): relative to THIS round's own "off" baseline (which already includes the walk),
a monster-only or spell-only `sample-rpg` variant measures **271 = 264 code + 7 table** — a real,
current, equality-checked isolation of `BATTLE_ANIM_BATTLE_ALLOWANCE` alone, just not a claim of
"unchanged from before this feature existed." `battle_fx_arm_attack` (`71cfa84:331-345`) is left
completely untouched this round (§16.2's own P2-4 shape), and `attack_target`'s own new arm block
is gated on `PARTY_ATTACK_ANIM_ENABLED` specifically, so with party off, `attack_target` itself
assembles exactly as it did before — but "the routine's own bytes are unchanged" is a narrower,
still-true claim than "the whole project's own ROM is unchanged," which is what the retired
250-byte comparison implied.

**Only the four NON-RPG fixtures stay byte-identical to a clean `71cfa84` build this round —
`sample-rpg`/`sample-rpg-mmc1` genuinely change, deliberately, and their hashes are re-pinned.**
Amendment round 1's own version of this paragraph claimed all SIX checked-in fixtures stayed
byte-identical, because the whole feature was opt-in then. Chris's own "Always on for RPGs" answer
(§8) makes that claim false for the two RPG fixtures specifically — `sample-rpg` and
`sample-rpg-mmc1` neither author `attackAnim` anywhere (unaffected by `PARTY_ATTACK_ANIM_ENABLED`),
but they ARE RPG projects, so the walk's own now-unconditional cost reaches them regardless. Both
hashes are re-pinned this round (`test/unit/nameentry.test.js`'s own `BASELINES`, §16.9) with a
comment recording why, the same discipline every OTHER unconditional battle-bank change in this
codebase's own history already follows (`BE_RESTORE`'s own +18, the join-guard's own +5, "The
battle system" section). `sample/`, `sample-mmc1/`, `sample-mmc3/` and `sample-u512/` — action
projects, which never reach the battle region at all — stay byte-identical, confirmed directly:
full-ROM SHA-256 against a clean `71cfa84` build, all four IDENTICAL (§16.9).

**The gating option not picked, costed — re-measured this round.** Folding the party-attackAnim
branch permanently into `BATTLE_ANIM_BATTLE_ALLOWANCE` (no `PARTY_ATTACK_ANIM_ENABLED` flag at all,
and no gate on `pc_anim_attack`'s own table emission either) would cost EVERY `BATTLE_ANIM_ENABLED`
project two independent things, not one: **10 CODE bytes** (`PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE`'s
own re-measured figure, §16.9) unconditionally, PLUS **`party.length` TABLE bytes** (never more than
`RPG_LIMITS.party` = 4) for a `pc_anim_attack` table that would exist but never be read by anything
a monster/spell-only project's own code paths reach — pure waste for that project, since
`battleTableBytes` counts whatever `battleTables()` actually emits (§16.4) regardless of whether the
gate that controls it is narrow or absent. Neither figure was separately built: the code figure is
exactly the isolated 10-byte delta already measured; the table figure is exactly `party.length`,
the same arithmetic `pc_anim_attack`'s own gated emission already uses (§16.4) — folding vs. gating
changes only whether either cost is conditional, not either one's size. This lever is NOT the
walk's own — the walk itself is already unconditional (below), so this paragraph is specifically
about `PARTY_ATTACK_ANIM_ENABLED`, which remains a real, content-driven gate.

**The walk's own gate and ledger — fix round 1, superseding amendment round 1's own design in
full; the follow-snippet's own separate name consolidated again in fix round 2.** Amendment round 1
designed an independent `PARTY_CAST_WALK_ENABLED`/`PARTY_CAST_WALK_BATTLE_ALLOWANCE = 72` toggle
here, plus a third interaction term (`PARTY_CAST_WALK_FX_INTERACTION_ALLOWANCE = 21`) charged only
when BOTH a `castWalk` flag AND `projectUsesAnyBattleAnimation` were true. **Chris's own "Always on
for RPGs" answer (§8) removes the toggle entirely**: there is no `project.rpg.castWalk` field, no
`PARTY_CAST_WALK_ENABLED` flag, no Build Forge checkbox (§16.8), and consequently no independent
allowance term for the walk's own base cost at all — it is folded straight into
`BASE_BATTLE_CODE_BYTES_BY_MAPPER` itself (§16.3a), re-measured to `{1: 3839, 4: 3879, 30: 3839}`
(was `{1: 3783, 4: 3823, 30: 3783}`, a flat +56 on every board). **Fix round 1 kept the
follow-the-walk snippet inside `battle_fx_draw` as its OWN named constant
(`WALK_FX_FOLLOW_BATTLE_ALLOWANCE = 21`); fix round 2 (review round 2, P2-3) folds it back into
`BATTLE_ANIM_BATTLE_ALLOWANCE` instead (243 → 264), deleting the separate name.** The reviewer's
own finding: once the snippet's only remaining condition is `projectUsesAnyBattleAnimation` — the
IDENTICAL single predicate `BATTLE_ANIM_BATTLE_ALLOWANCE` already used — no build variant can ever
isolate 21 from 243 by delta measurement, so keeping two names bought no independently checkable
claim, only the appearance of one; an opposite drift in the two halves that kept their SUM at 264
would have passed the old two-name equality test undetected. One gate, one measured, equality-
checkable allowance (`BATTLE_ANIM_BATTLE_ALLOWANCE = 264`, `main/build/battletables.js`), with the
`243 + 21 = 264` provenance kept in a source comment, not in a second exported name.

**`battleShortfallAdvice` can no longer offer "remove the walk" as a shortfall fix — correctly, and
this needed no new code to be true.** Amendment round 1's own design added a
`{ label: "the party caster's own walk forward", strip: projectWithoutCastWalk }` lever to
`bankedFeatures`; that lever, and the `projectWithoutCastWalk`/`projectUsesCastWalk` predicates it
depended on, are gone along with the schema field, since the walk cannot be stripped from an RPG
project at all any more — it is not authored content, it is a property of the battle bank itself.
`battleShortfallAdvice`'s existing solver needs no special-casing to reflect this: it only ever
offers levers that are actually registered in `bankedFeatures` (§16.5's own `projectWithoutBattle
Animation`/`projectWithoutPartyAttackAnim`, `projectWithoutHitFeedback`/`projectWithoutMiss`, and
the pre-existing naming/monster-spell-list levers), and none of those was ever the walk's own —
there is simply nothing left in the advisor's own list that could name it, which is the correct
absence, not a gap needing a guard.

**Existing projects stay byte-identical only where the walk genuinely cannot reach them — the four
non-RPG fixtures, not all six.** Every walk-related insertion (`spell_chosen_all`, `battle_target`,
`battle_sprite_pc`, `battle_fx_draw`, `battle_dispatch`, `setup_monsters`, `battle_message_done`) is
now UNCONDITIONAL, present in every RPG project's own battle bank — so `sample-rpg`/
`sample-rpg-mmc1` genuinely change (§16.9's own re-pinned hashes), and off/monster-only/spell-only
`sample-rpg` variants (relative to EACH OTHER, on the walk's own new base) still measure
consistent, equality-checked deltas for `PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE`/`BATTLE_ANIM_BATTLE_
ALLOWANCE` (re-derived to 10/264, fix round 2's own consolidated figure, §16.9) — but none of the
three matches a CLEAN `71cfa84` build any more, since the walk's own +56 base delta is present in
all three. Only
the four action fixtures (`sample`, `sample-mmc1`, `sample-mmc3`, `sample-u512`), which never reach
the battle region at all, are confirmed byte-identical to a clean `71cfa84` build — full-ROM
SHA-256, all four IDENTICAL (§16.9).

### §16.7 OAM and vram_buf (item 7)

**`battle_fx_draw`'s own per-slot anchor SELECTION (`engine/battleui.asm:1039-1094`) — WHICH
anchor, party or monster — needs no change at all** — **narrowed this round (review round 4,
P3-2: the prior wording claimed no change to `battle_fx_draw` at all, which is false — the walk
itself adds its own offset inside this same routine; see §16.3a's own follow-the-walker snippet
for that change; only the party-versus-monster SLOT SELECTION below is what needs none)** — it
already branches on `bt_fx_slot < MAX_PARTY` (`:1063-1064`) to choose the party anchor
(`BT_PARTY_X`/`BT_PARTY_Y` + `slot * BT_PARTY_STEP`) versus the monster anchor (`BT_MON_COL`/
`BT_MON_ROW`), and a party member's own attack visual is armed with exactly its own combatant slot
(`ldy <bt_actor`, §16.2) — the SAME `bt_fx_slot` a monster's own arm already writes, just now
sometimes `< MAX_PARTY`. **Corrected this round: the party side of this branch is not newly
reachable — a monster's own single-target spell aimed at a party member, and a party member's own
heal/all-target cast, already reach it.** `cast_spell_fx_go` (`engine/battleturn.asm:367-376`)
already arms `Y = bt_target` for a single-target spell (which is a party slot when a MONSTER casts
one at a party member) and `Y = bt_actor` for a heal or all-target cast (already a party slot when
a PARTY member casts one) — both existing, shipped paths already drive `bt_fx_slot < MAX_PARTY`
before this round. What §16 actually adds is a NEW ARM POINT (`attack_target`, a physical swing)
that can reach the SAME, already-proven branch — not a new branch.

**`battleCombatantOamMax`/`battleSpriteBudget`/`battleFxOamRoom` need no change beyond seeing the
new references — confirmed by direct execution, not by code inspection alone.** `battleSpriteBudget`
(`shared/project.js:3825-3839`) already derives `fxTiles` from `allBattleAnimationIds(project)`
filtered through `isPlayableBattleAnimation`, and `allBattleAnimationIds` already walks
`animationReferenceLocations`'s `battleOnly` entries (§16.5) — so the moment the traversal gained a
party yield, `battleSpriteBudget`'s own `fxTiles` figure automatically includes a party member's own
worst frame, with zero lines changed in either `battleSpriteBudget` or `battleFxOamRoom`
(`shared/project.js:3857-3862`, both unchanged). Verified directly (§16.9): `allBattleAnimationIds`
on a project with `party[0].attackAnim = 1` yields `1`, the identical id a monster or spell
reference would.

**Concurrency with MISS and hit feedback, worked through explicitly, not merely asserted safe.**
`BATTLE_FX_OAM_ROOM`'s own formula (`MAX_OAM_ENTRIES - battleCombatantOamMax - MISS_OAM_TILES`
when `MISS_ENABLED`, §13.6) already reserves room for "whatever the ONE running `bt_fx_*` effect is,
PLUS MISS" without caring which side owns the effect — a party member's own flipbook competing with
MISS on a miss is the IDENTICAL interaction §13.6 already measured and reserved room for, just with
the attacker and target sides swapped from the monster case (§13.6's own worked example has a
monster's flipbook on the ATTACKER's slot 4-7 and MISS on the TARGET's slot 0-3 at the same tick;
here it is the party's own flipbook on slot 0-3 and MISS on a MONSTER's slot 4-7 — different slots
either way, so no new same-slot collision, and the SAME total-budget arithmetic covers it). Hit
feedback (`bt_hurt_slot`, §12) reacts on `bt_target` — for a party member's OWN attack, that is
always a MONSTER slot (4-7), never the attacking party member's own slot (0-3) — so a party
member's own flipbook and the hit-feedback reaction to their OWN swing landing are, by construction,
never on the same slot in the same tick, the identical non-interference §12.4 already states for
the monster case. The one scenario worth naming explicitly: could a party member's own JUST-ARMED
flipbook (from their own attack) still be "running" when, on a LATER tick, an enemy hits that SAME
party member (`bt_hurt_slot` now naming the SAME slot)? No — the caller invariant (§3.3: every real
arm call site is reached right after a clear) means the party's own flipbook is cleared the moment
THAT action's own message is dismissed, well before any later enemy turn reaches the same slot
again, the identical reasoning that already makes a monster's own attacker-slot flipbook safe from a
later hit-feedback reaction on the SAME monster.

**Confirmed: no new `vram_buf` packet appears (§3.4, §12.6).** Appendix E adds no
`vram_open`/`vram_push`/`queue_at` call anywhere — `attack_target`'s own new direct arm block
(§16.2, fix round 1) only writes ZP scratch (`bt_fx_anim`/`bt_fx_slot`/`bt_fx_frame`/`bt_fx_timer`,
via the unchanged `battle_fx_arm_at`) and `battle_fx_draw` draws via `draw_metasprite` (sprite OAM,
not the nametable), the identical `vram_buf`-free shape the existing monster/spell path already
has. `battle_fx_arm_attack` itself is untouched this round (§16.2), so this paragraph's own claim
needs no revisiting there at all.

### §16.8 The UI (item 8)

**Where the field goes, RPG only.** The Character Forge's `renderDetail` (`renderer/forges/
character/character.js:250-355` at `8cb76fc`) already has one `isRpg`-only block for the "Battle
sprite" picker (`:326-349`) — the new "Attack animation" picker is a sibling field in that SAME
block, beside the battle-sprite `<select>`, since both answer "how does this member fight," not
inside `renderStats` (`:169-248`, numeric stats and learned spells, a different concern). Wired
through the existing generic `setMember(index, 'attackAnim', value)` helper (`:81-86`), no new
commit path needed.

**The preview: yes, the shipped widget, following the SAME persistent-host restructuring Magic and
Monster already needed (§15.5) — with one real difference from both, worked through explicitly.**
Magic and Monster each mount their preview ONCE, unconditionally, because both Forges are
`isForgeAvailable`-gated to RPG projects only (`renderer/app.js`'s own `FORGES` array; Magic/Monster
`gameTypes` entries) — the preview widget's own "no animation selected" caption (§15.5 step 1) is
never shown to an action project because the Forge itself never mounts there. The Character Forge
is DIFFERENT: it mounts on BOTH game types (the hero always has a character card), so mounting the
preview unconditionally would show a battle-animation caption on an action project's Character Forge
visit — noise for a concept that project can never use. **Decision: mount `mountBattleFxPreview`
ONCE at `mount()` time regardless of game type (the same "never call it fresh per render" rule
§15.5's own P2-6 finding establishes), but restructure the RIGHT panel's own `panel-body`
(`character.js:377-382`) into the `fieldsHost`/`previewHost` split (`magic.js:71-75`,
`monster.js:439-442`), and toggle `previewHost`'s own `style.display` — never its children —
between `isRpg` states inside `render()`.** This keeps the widget's own internal state (canvas,
armed/playing flipbook) untouched across a game-type check, uses no `fill()` call on `previewHost`
itself (the stale-id/lost-state trap §15.5's own P2-6 finding already names), and shows nothing at
all on an action project — a style toggle, not a mount/unmount cycle. `getAnimationId` returns
`party[state.selected]?.attackAnim ?? null` when `isRpg`, else `null` — the identical "return null
when there is nothing to preview" shape Monster's own `getAnimationId` already takes
(`monster.js:446-450`) for `state.selectedActorId === null`, which `sync()`'s own None-handling
branch (§15.5 step 1) already resolves correctly with no new widget code. `destroy()` gains
`preview.destroy()` (`character.js:390-393`, alongside the existing `app.setMeta('')`), and
`onProjectChange: render` needs no change (it already calls `render()`, which gains one
`preview.sync()` call at its own end, the identical placement `magic.js:261`/`monster.js:555`
already use). `stepPreview: () => preview.stepPreview()` is added to the mount contract, matching
both existing Forges.

**What the preview actually shows — stated explicitly this round, per review round 1's own finding
7.** The Character Forge uses the IDENTICAL shared widget Magic/Monster already mount
(`renderer/widgets/battlefxpreview.js`), with no member-specific or battle-position rendering of
any kind: it draws the selected animation's OWN artwork inside the animation's OWN local
bounding box (`battleFxBounds`, the union of every frame's own tile extents, `battlefxpreview.js:
234-243`, `:16` for the `64×64` blank fallback) — never the selected party member's own field or
battle sprite, never a simulated combatant icon or battle-screen background behind the effect. This
is the identical "effect-only" contract Magic (previewing a spell's own `anim`) and Monster
(previewing an actor's own `attackAnim`) already have; nothing about mounting it a third time, for
a party member's own `attackAnim`, changes what it draws.

**Selecting a different party member with the SAME animation id: playback is retained, not
restarted — the widget's own existing behaviour, unchanged by this slice.** `sync()`'s own re-arm
check (`battlefxpreview.js:254`, `id !== armedId || signature !== armedSignature`) re-arms only when
the id OR the animation's own frame signature actually changes — switching from a member whose
`attackAnim` is `1` to another member whose `attackAnim` is ALSO `1` leaves `id`/`signature`
unchanged, so the SAME running flipbook keeps playing through the switch with no restart, the
identical behaviour the widget already has for two spells sharing one `anim` id today. This needs no
new code in the widget; §16.8's own `getAnimationId` closure is the only thing that changes per
Forge.

**`animationSelect`: deduped, per Chris's own 2026-09-15 answer ("Dedupe all three now") — supersedes
this document's own earlier "a third copy" recommendation.** Round 1's own recommendation matched
Chris's EARLIER (2026-09-14) decision not to dedupe Magic/Monster's own pair — a different, narrower
question (two consumers) he has now answered differently for three. Designed here, not built (the
brief's own scope rule for this amendment: engine and generator only).

- **Module and export**: `renderer/widgets/battlefxpreview.js` — the reading list's own "natural
  shared home," already the shared preview widget's own module, already imported by all three
  Forges (Magic/Monster today, Character per §16.8's own preview design above). Gains
  `export function animationSelect(project, selectedId, onChange)`, moved verbatim from `magic.js`'s
  own current body (`:50-61`) with ONE signature change: `project` becomes an explicit parameter
  instead of a closed-over `store.project` reference.
- **Why `project` is a parameter, not a `store` import inside the widget module.**
  `mountBattleFxPreview` itself (this same module) is deliberately `store`-free — its own
  `getProject`/`getAnimationId` callbacks exist specifically so the widget never assumes a global
  (§15.5's own design). Importing `store` directly into `animationSelect` would be the ONE thing in
  this module that breaks that precedent; taking `project` as a parameter instead keeps the module
  itself STORE-INDEPENDENT and matches its own existing philosophy. **Corrected this round (review
  P3-8): `battlefxpreview.js` is a store-independent DOM module, not a DOM-free one** — amendment
  round 1's own wording called it "DOM/state-free," which is inaccurate: the module owns real
  playback state (armed/playing flipbook) and calls DOM APIs (`el()`, `document.createElement`)
  directly; `battlefx.js`, the pure stepper this module wraps, is the one that stays genuinely
  DOM-free, and that distinction is what makes it independently unit-testable under plain
  `node:test` in the first place (§15.5). `animationSelect` fits this same "store-independent DOM"
  shape exactly: real DOM, no `store` import. Each call site passes `store.project` explicitly, a
  one-argument, mechanical change at all three (see below).
- **Call sites, all three mechanical**: `magic.js` — `animationSelect(current.anim ?? null, (v) =>
  ...)` becomes `animationSelect(store.project, current.anim ?? null, (v) => ...)`, and its own local
  `animationSelect` definition (`:50-61`) is deleted, replaced by the import. `monster.js` — the
  identical change at its own call site (`:89-99`'s definition deleted; its own call passes
  `store.project` first). `character.js` — no local copy to delete (this Forge never had one); the
  NEW "Attack animation" picker (this section, above) calls the shared import directly:
  `animationSelect(store.project, member.attackAnim ?? null, (v) => setMember(index, 'attackAnim',
  v))`.
- **`animationPickerOptions`/the stale-id rule stay the single writer, unchanged.**
  `animationSelect`'s own body is UNCHANGED beyond the signature (still calls
  `animationPickerOptions(project, selectedId)` internally, just reading the parameter instead of
  `store.project`) — the "Missing animation N" synthetic option and every other picker behaviour
  this section's own closing paragraph already describes is identical, now from ONE function instead
  of two independent copies plus whatever a third copy would have been.
- **A test that pins the shared behaviour — corrected this round (review P3-8): the OPTION DATA
  already has a real unit test; what is missing is a test of the three Forges' own rendered
  `<select>` elements agreeing with each other and with it.** `animationPickerOptions` itself —
  `animationSelect`'s own internal source of truth for every option it renders, including the
  "Missing animation N" synthetic entry — already has a pure unit test,
  `test/unit/project.test.js:3514-3543`, covering the healthy/missing/null-id cases directly under
  plain `node:test` (no DOM needed, since `animationPickerOptions` returns plain data, not DOM
  nodes). That test is KEPT, unchanged, as the option-data authority's own regression guard.
  `animationSelect` itself DOES return real DOM (`el('select', ...)`, `renderer/ui.js`'s own
  `document.createElement`), which plain `node --test` cannot exercise directly (no DOM emulation
  library, the identical reason `battlefxpreview.js`'s own widget-level tests already live in
  `main/smoke.js` rather than `node:test`, §15.5) — so the NEW coverage this dedupe needs is a
  smoke-test step, not a second unit test of the same option data: mount Magic, Monster and
  Character against the SAME project (an animation catalog with a real entry, one stale reference,
  and one `None`/unset field) and assert their own three rendered `<select>` elements — reached via
  each Forge's own field — produce IDENTICAL `<option>` text, `value`s and `selected` state for
  equivalent input; additionally assert the callback correctly converts a chosen `<option>`'s string
  `value` back to `null` (the "None"/blank sentinel) or a numeric id, and that the choice persists
  across a re-render. PLANNED (§16.10) — no `renderer/` file was touched this round. Deletion of the
  two existing local copies (`magic.js`, `monster.js`) is verified by CODE REVIEW at implementation
  time, not by this smoke test — the test can only prove the three Forges currently agree, not that
  no fourth, stale copy is lurking unreferenced elsewhere.
- **The two existing Forges must behave identically afterward, and the smoke test is what proves
  it**: Magic's and Monster's own EXISTING smoke coverage (visiting each Forge, picking an animation,
  confirming the field persists) already exercises `animationSelect` through its own call site;
  since the shared function's own body is unchanged (only its signature), that existing coverage
  continues to pass unmodified — the NEW cross-Forge identity assertion above is additive, not a
  replacement for it.

**The stale-id rule holds here too, with no new code.** `animationSelect` already renders a
synthetic "Missing animation N" option whenever the stored id does not resolve
(`animationPickerOptions`, §4) — a party member's stale `attackAnim` reaches the IDENTICAL picker
function, so it gets the IDENTICAL treatment, never a silent rewrite. Confirmed by the SAME
`validateProject` refusal already proven live for a stale party reference (§16.5, §16.9) — the
picker and the build refusal read the same stored value the same way an actor's or a spell's
already do.

**Superseded, fix round 1: there is no walk toggle to place anywhere.** Amendment round 1 designed
a Build Forge "RPG progression" checkbox here, following `hitFeedback`/`miss`'s own precedent.
Chris's own "Always on for RPGs" answer (§8) removes the field this checkbox would have controlled
entirely (§16.6) — no `project.rpg.castWalk`, so no UI surface for it either, on the Build Forge or
anywhere else. Kept here as the historical record of what amendment round 1 proposed, not a live
UI item this round's own implementation needs to build.

### §16.9 A measured prototype (item 9, re-measured for the ledger consolidation and the harness fix, fix round 2)

Rebuilt from scratch, not incrementally, in a FRESH `git worktree add --detach` scratch copy off
`71cfa84` (`node_modules` symlinked from the main tree) — the identical `bankedbytes.test.js`'s own
`measureRegion` methodology, code/table bytes separated via `battleTableBytes(project)` directly.
This round's own diff applies fix round 1's own diff first, then this round's own harness fix
(§16.9 below), ledger consolidation (§16.6), stub-comment restore (P3-1), and the strengthened
poisoned/burned regression (§16.10). Full diff is still ELEVEN files: the seven engine/generator/
schema files amendment round 1 already touched (`engine/battle.asm`, `engine/battleturn.asm`,
`engine/battleui.asm`, `engine/constants.asm`, `main/build/battletables.js`,
`main/build/generate.js`, `shared/project.js`), plus FOUR test files —
`test/unit/bankedbytes.test.js` (two pinned hashes, the ledger consolidation's own two isolation
tests re-shaped), `test/unit/items.test.js` and `test/unit/nameentry.test.js` (one pinned RPG hash
re-derived each, unchanged from fix round 1), and `test/unit/rpg.test.js` (the harness fix, the
stub-comment restore, the strengthened poisoned/burned regression, plus fix round 1's own six fixed
tests and two shared helpers, all carried forward). **Corrected this round (review round 2, P3-1):
these test-file changes are proposed implementation candidates and prototype evidence, subject to
implementation review, not already-accepted permanent coverage** — amendment round 1's/fix round
1's own "genuine, permanent updates" framing overstated what a design-round Appendix E can settle;
this document's own role is to measure the blast radius accurately, which it does, not to pre-approve
the exact test code an implementation ships.

| board (RPG-capable) | off | monster-only | spell-only | party-only | mixed (monster + party) |
|---|---|---|---|---|---|
| MMC1 (mapper 1) | 4350 | 4621 (Δ271) | 4621 (Δ271) | 4633 (Δ283) | 4633 (Δ283) |
| MMC3 (mapper 4) | 4390 | 4661 (Δ271) | 4661 (Δ271) | 4673 (Δ283) | 4673 (Δ283) |
| UNROM 512 (mapper 30) | 4350 | 4621 (Δ271) | 4621 (Δ271) | 4633 (Δ283) | 4633 (Δ283) |

Table bytes (identical shape on all three boards): off 494; monster/spell/mixed 501/501/503;
party-only/mixed 503 — unchanged in shape from every prior round (the walk itself contributes 0
table bytes, confirmed: off's own table count is unaffected by the walk's own presence). Code
bytes, separated: off = `{1: 3839, 4: 3879, 30: 3839}` (the base, walk included — this IS the
walk's own cost now, not a delta against anything); monster/spell = off + 264; party-only/mixed =
off + 274. **Corrected this round (review round 3, P2-1): the "off = base" figure omitted its own
subtraction — the sample's real `off` build ALSO pays the pre-existing, unconditional 17-byte item
allowance (`ITEM_LIST_FILTER_BATTLE_ALLOWANCE`, `sample-rpg` carries a live item), so `off`'s own
code figure is not the base directly.** The real, measured `off` code usage is `3856` on MMC1/UNROM
512 and `3896` on MMC3 (`4350 − 494 = 3856`, `4390 − 494 = 3896`, subtracting table bytes from the
row above); subtracting the 17-byte item term gives the base itself, `3856 − 17 = 3839` and
`3896 − 17 = 3879` — the figures this document's own `BASE_BATTLE_CODE_BYTES_BY_MAPPER` constant
holds. `predictedMatchesReal` (`battleRegionBytes` vs. nesasm's own real usage) is `true` on EVERY
cell of this table, all three boards, all five variants — confirmed only after fixing the constants
below to their measured values, not asserted from a first guess. `mixed` (a monster's own
`attackAnim` AND a party member's own, both set) measures IDENTICAL to `party-only` — the shared
`BATTLE_ANIM_BATTLE_ALLOWANCE` base is paid once regardless of how many independent references turn
it on, exactly as designed.

**Code and table bytes, separated, for every figure this round re-derives:**

- **`BASE_BATTLE_CODE_BYTES_BY_MAPPER`: unchanged from fix round 1 — `{1: 3839, 4: 3879, 30:
  3839}`** (a flat +56 on every board over the pre-`§16` `{1: 3783, 4: 3823, 30: 3783}`), folded
  into the base unconditionally (§16.3a, §16.6). Re-confirmed by this round's own rebuild, not
  re-derived (nothing in this round's own diff touches the walk's own base cost).
- **`PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE`: unchanged from fix round 1 — `10`** — party-only vs.
  monster-only is **283 − 271 = 12 total = 10 code + 2 table** (`pc_anim_attack`'s own
  `party.length` = 2). Re-confirmed by this round's own rebuild.
- **`BATTLE_ANIM_BATTLE_ALLOWANCE`: CONSOLIDATED this round (review round 2, P2-3) from `243` alone
  to `264`, folding in the follow-the-walk snippet's own 21 bytes as part of the SAME named
  constant, not a second one.** monster-only vs. off is **271 total = 264 code + 7 table**; the
  264 is now the WHOLE isolated cost of turning `BATTLE_ANIM_ENABLED` on — the shared `bt_fx_*`
  machinery (243) PLUS `battle_fx_draw`'s own follow-the-walker snippet (21, §16.3a), which can
  only ever assemble under the identical `BATTLE_ANIM_ENABLED` condition the base already uses, so
  there is no longer a second predicate for a second name to track. Table: `7 = mon_anim_attack +
  spell_anim` (unchanged from every prior round). `bankedbytes.test.js`'s own isolation test now
  asserts this single, equality-checkable 264-byte figure directly (§16.6).

**The mixed-removal case, executed against this round's own rebuilt worktree, matching the
reviewer's own independently-computed figures exactly (0 / 12 / 283 on every board) — replacing
amendment round 1's own stale probe G (review round 2, P2-3).** A `sample-rpg` variant with BOTH
an actor's own `attackAnim` AND a party member's own set, `renamable` off: stripping the
monster/spell reference alone (`projectWithoutBattleAnimation`) frees **0** bytes (the party
reference alone still needs the whole shared 264-byte mechanism, so nothing is freed); stripping
the party reference alone (`projectWithoutPartyAttackAnim`) frees **12** bytes (`10` code + `2`
table, `PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE` in full); stripping BOTH frees **283** bytes (`264 + 10`
code, `7 + 2` table) — identical on MMC1, MMC3 and UNROM 512. Re-run directly against this round's
own rebuilt prototype rather than copied from the review — the reviewer's own 0/12/283 figures are
confirmed correct, not merely trusted.

**The gating option not picked** (folding the party-attackAnim branch permanently into
`BATTLE_ANIM_BATTLE_ALLOWANCE`, no independent flag) costs the identical isolated 10/2 figures above
on every `BATTLE_ANIM_ENABLED` project regardless of whether it authors a party `attackAnim` (§16.6)
— not separately built, since folding changes only whether the cost is conditional, never its size.

**Only the four non-RPG fixtures confirmed byte-identical to a clean `71cfa84` build —
full-ROM SHA-256, all four IDENTICAL** (`sample`, `sample-mmc1`, `sample-mmc3`, `sample-u512`; never
reach the battle region at all, so the walk cannot touch them). Built each twice — once from the
unmodified main tree, once from this round's own worktree — and compared complete `.nes` file
hashes directly. **The two RPG fixtures deliberately change, and their hashes are re-pinned,
UNCHANGED from fix round 1** (this round's own diff touches no assembled byte, only test wording
and JS bookkeeping): `sample-rpg` → `6944a5a3c80cfe15ab8f044f0c8520b53351d649195f41f2b6ef0a3c07525623`,
`sample-rpg-mmc1` → `bd51f3d6be9e5459754afcf9b5620a794225e57a33339f7c8b4e28de7255021d`, both computed
by building the checked-in fixture through this round's own worktree, the identical mechanism
`test/unit/nameentry.test.js`'s own gate already uses.

**Live-documentation re-pin checklist, named explicitly this round (review round 2, P3-1) —
`CLAUDE.md:1292` is the one remaining place the OLD `3783/3783/3823` base is still published as
current, and needs updating at implementation time, not now (this document never edits CLAUDE.md,
per every round's own standing rule).** Historical figures elsewhere — `docs/design-kernel-diet.md`
and older measurement reports — are measurement RECORDS of what was true when they were written and
stay exactly as they are; only CLAUDE.md's own "The battle system" passage asserts the base as
CURRENT prose, which is what makes it the one live re-pin.

**Consolidated implementation checklist, all four re-pin destinations named together this round
(review round 3, P3-1: the brief asked that these not be scattered) — an implementation MUST touch
all four, in the same change that changes any assembled RPG byte, or the test suite and CLAUDE.md
fall out of agreement with the ROM they describe:**

1. `test/unit/nameentry.test.js`'s own `BASELINES` object — the two RPG fixture hashes
   (`sample-rpg`, `sample-rpg-mmc1`); the four action-fixture entries stay untouched, since they
   never reach the battle region.
2. `test/unit/bankedbytes.test.js`'s three per-mapper RPG hashes (MMC1/MMC3/UNROM 512) in its own
   monster/spell-only isolation fixture.
3. `test/unit/items.test.js`'s `PINNED_RPG_BASELINE_HASH` (its own items-free, spell-free baseline
   — `PINNED_RPG_BASELINE_SIZE` itself is unaffected, since the walk adds no new PRG bank).
4. `CLAUDE.md:1292` (the published `3783/3783/3823` base), the one live-prose re-pin named above.

**A green `npm test` at implementation time does NOT mean every PLANNED row in §16.10 has been
implemented.** The four re-pins above only prove the ASSEMBLED ROM changed the way this round's own
measurements predict; every row still marked PLANNED in §16.10 (the absolute per-variant assembly
checks, the advisor-label test, the lethal-status-KO case, the three rewritten spell-timing cases,
and the others) is a separate, unmet implementation requirement, not something a passing suite
already covers. This round's own five-variant measurement table (§16.9) is real evidence the
absolute figures agree TODAY, on this hand-run scratch script — it is not a permanent `assert.equal`
in the checked-in suite, and must not be treated as coverage until it actually is one.

**`test/unit/nameentry.test.js` + `test/unit/bankedbytes.test.js`: `60/60`, 0 failed, 0 skipped**
(unchanged from fix round 1 — this round's own diff re-shapes two existing isolation tests and
their own hash comment but does not change the pass count). `zeropage.test.js`'s own three
directions all still pass unmodified (`6/6`).

**Full regression: `npm test` inside the worktree, `1737/1737` passing, 0 failed, 0 skipped —
EVERY test now passes, correctly labeled as the requirement, not an aspiration.** `npm run
build:sample`, `build:sample:mmc1`, `build:sample:mmc3`, `build:sample:u512`, `build:sample:rpg`,
plus `node main/build/cli.js sample-rpg-mmc1` all ran cleanly first. **Fix round 1's own `1736/1737`
run is HISTORICAL PROTOTYPE EVIDENCE, recorded for what it was — the harness defect existed but had
not yet been assigned a fix or an owner in that round's own scope. This round's own `1737/1737` run
is the current, correct result, and the implementation requirement going forward.**

**The root cause, established this round (review round 2, section 1) — a test-harness rendering-
contract violation, not a player-facing phase-2a engine defect.** `rpg.test.js`'s own "multi-target
hit-feedback policy" test calls `battle_tick` and `vram_drain` directly through `callRoutine`, which
masks NMI via PPUCTRL `$2000` but leaves RENDERING ON via PPUMASK `$2001`. `vram_drain`
(`engine/text.asm:150-176`) is an NMI-ONLY routine, normally reached only from
`engine/boot.asm:351-353` during vblank — this test's own direct call runs it OUTSIDE that contract,
while rendering is still active, so the manual drain can land on a VISIBLE scanline, where rendering
itself moves the PPU's own address counters between the `$2006` address-write pair and the `$2007`
data write. Instrumented reproduction (review round 2): the engine queued the CORRECT packets
(`$23C9 ← $00`, then `$23D1 ← $AA`); the second packet's own `$2006=$23`/`$2006=$D1` writes landed
correctly, but by the time `$2007=$AA` executed, rendering had already advanced the PPU address to
`$37D1` — the write landed there instead, and `$23D1` kept its own stale field value. Confirmed
address-layout-sensitive (not merely a fluke of THIS specific code shape) via a control on a
completely clean, unmodified `71cfa84` tree: inserting eight semantically-inert `nop` instructions
at the top of `battle_target` (a routine this specific test never calls) reproduces the identical
FAILING TEST — though, corrected this round (review P3-1's own honesty check), **NOT the identical
failing ASSERTION**: the NOP control failed on slot 1's own attribute check (`68 !== 170`,
`rpg.test.js:7280`-area) while this round's own Appendix E failed on slot 2's flash-tint check
(`85 !== 255`) — both are the SAME underlying rendering-contract violation, landing on a different
victim byte depending on the exact code layout, which is consistent with (not proof against) a
single root cause. Calling the two failures "IDENTICAL" would overstate the evidence; "the same
class of failure, reproduced independently" is the accurate claim.

**The verified fix — forced blank for this one test's own manual drains, never inside `callRoutine`
itself.** Immediately after resolving `battleTickAddr` in this test only: `nes.mmap.write(0x2001,
0)` (PPUMASK forced blank), with a comment recording why. This preserves every attribute, timer,
target and 20-tick assertion the test already made, fixes both the NOP control and Appendix E, and
is what brings the full suite to `1737/1737`. **Deliberately NOT applied inside `callRoutine` itself
— other callers assert real rendered pixels** (the MISS-overlay pixel tests, §16.10) and depend on
rendering staying on; blanket-disabling it there would break them. A real NMI-driven drain would
also honor the contract, but would need unnecessary frame/timer coordination for what is otherwise a
simple isolated-routine test.

**No player-facing engine severity is established by this failure — stated explicitly, per the
review's own requirement.** The defect is in how ONE test drives the engine, not in anything a real
game ever does: `vram_drain` is always, in every real build, called from NMI (`engine/boot.asm:
351-353`), where rendering-time address drift cannot occur by construction (NMI runs during vblank,
when rendering has already stopped advancing the PPU's own address). §16.11 records the full
investigation and its own honestly-bounded scope (the WHY of the timing threshold itself was not
further chased, only the WHAT and the fix).

**Three functional SCRATCH probes, unchanged from fix round 1 (this round's own diff does not touch
the walk mechanism itself) — re-derived from amendment round 1's own W1/W2/W3, covering a physical
Attack (not only a spell cast), since that is what "Attacks walk too" changes:**

- **W1 — the acting party member's own sprite X ramps forward with `bt_walk_step`, matching the
  formula exactly, driven through the REAL `battle_target` routing point (a physical FIGHT
  confirm), not an isolated phase-only setup.** `battle_target` called with `bt_cmd = BC_FIGHT`,
  `pad_new = BTN_A`, confirming `bt_phase` becomes `BP_WALK`; `battle_draw_sprites`, then called at
  `bt_walk_step` = 0/2/4/8 (every OTHER party slot explicitly cleared from `pc_in_party` first, so
  only the acting member draws — the one real correction this round's own probe needed over
  amendment round 1's, since an uninitialized RAM byte can read non-zero and a phantom "party
  member" would otherwise draw over the real one at the same OAM index), reading the real OAM byte
  for party slot 0's own first tile (`$0203`, `OAM+3`): X = 200, 196, 192, 184 — exactly
  `BT_PARTY_X − walk_step × 2` at every sampled point, real hardware-shaped OAM data, not the
  isolated arithmetic alone.
- **W2 — neither `attack_target` nor `cast_spell` arms until `bt_walk_step` reaches `WALK_TICKS`,
  one tick late, never early — re-run for a physical Attack specifically.** `battle_target`
  confirms a FIGHT target (starts the walk); `battle_tick`, called in isolation 10 times: calls
  1-8 leave `bt_fx_anim` at `NO_ANIM` while `bt_walk_step` ramps 1→8; call 9 transitions `bt_phase`
  to `BP_ACT` but `bt_fx_anim` is STILL `NO_ANIM` on that same tick (proving `attack_target` has not
  run yet even though the phase already changed); only call 10 — the first tick `battle_dispatch`
  actually sees `BP_ACT` — moves the phase past `BP_ACT`. Confirms §16.3b's own tick-by-tick account
  exactly for a physical Attack, not merely the spell case amendment round 1 already proved.
- **W3 — `bt_walk_step` resets to 0 at message dismissal, on every path §16.3a claims: a direct
  reset probe, an early A-press, and with the acting member already at 0 HP.** Three sub-cases, all
  executed: `battle_message_done` called directly — **corrected this round (review round 3, P3-1):
  this is a LOCAL RESET PROBE, not the ordinary timeout path itself (that is the genuine
  `battle_message_wait`-with-`bt_timer` auto-advance case, a separate PLANNED row below) — worded
  consistently now with the corrected rows above** — resets it; `battle_message_wait` called with
  `pad_new = BTN_A` (the early-dismissal branch, a DIFFERENT code path from the direct call) also
  resets it; `battle_message_done` called with the acting member's own `pc_hp = 0` (the closest
  reachable proxy for "the actor died mid-sequence" this synchronous engine allows, §16.3a) STILL
  resets it, confirming the reset has no alive-check of its own to skip.

**Real regression coverage, beyond the three SCRATCH probes above — six pre-existing `rpg.test.js`
tests, fixed and re-verified against the real UI-driven battle loop, not merely isolated routine
calls:** a real physical Attack against a poisoned/burned combatant (status-tick ordering);
formation-wide wipe budgeting under a real all-target cast; a real MISS dismissal-and-rearm
lifecycle; message-cap asymmetry between hit feedback and MISS; the real M/I/S/S glyph's own pixel
render; and MISS-plus-battle-animation drawn in the same frame. Each needed the identical fix —
driving PAST the new `BP_WALK` phase (via two new shared test helpers, `stepPastWalk`/
`callThroughWalk`, the same "drive past a mechanism every battle-driving test must get through
first" shape `bootPastNaming` already established for the naming grid) — before the test's own
pre-existing assertions could run at all. This is STRONGER evidence than isolated SCRATCH probes
alone: these six tests exercise the real, player-facing UI dispatch (`nes.frame()`/button presses,
or `battle_tick` driven through the actual routing points), not a hand-assembled RAM state, and all
six now pass. **Strengthened this round (review round 2, P2-4): the poisoned/burned test now
asserts `bt_walk_step` DIRECTLY, not just HP/message/order** — the acting combatant's own walk
offset is confirmed still at its full, stepped-forward value (`WALK_TICKS`) the instant the
attack's own message is up, and confirmed already reset to 0 before BOTH status lines show (§16.10
has the exact assertions). Amendment round 1's own claim that this test "verifies position" was
false until these assertions existed; it is executed, passing, positional proof now.

**Reference-integrity traversal (non-probe items, still checked by direct execution, unchanged from
every prior round — the walk needs none of this machinery, §16.5)**: `animationReferenceLocations`
yields the party location; `allBattleAnimationIds` includes it; `isValidAnimationRef`/
`isPlayableBattleAnimation` answer correctly for a real and a stale id; `renumberAnimationDeletion`
shifts the party reference; `validateProject` produces the expected error for a stale one.

**What remains PLANNED, not executed this round:** hop-2 validation for a party reference
specifically (unchanged from prior rounds — the identical, already-proven actor/spell code path);
the whole Character Forge UI and the `animationSelect` dedupe (§16.8) — no `renderer/` file was
touched this round, the brief's own explicit scope boundary; the genuine save-load regression test
— **corrected this round (review round 4, P2-1): this was FALSE. The original cycle's own genuine
save/load specification (membership `[1,0,0,1]` plus member 3's own state, checked BEFORE its
animation) was never carried forward; it was deleted when §16.9/§16.10 were rewritten and is
restored below as its own PLANNED row, not carried from anywhere.** Separately — **corrected this
round (review round 5, nit 3): this is a DIFFERENT case from the restored row above, which requires
only an ORDINARY save/load with membership holes, not a mid-walk save** — a REAL save-load-ORDER
check that a mid-walk load (a save
made while `bt_phase == BP_WALK`, if one were ever reachable — not believed to be, §16.3a) restores
sanely — not built, since no reachable path was found that could produce such a save in the first
place; single-target damage spell, heal, and unanimated-party-cast lifecycle tests through the real
UI routing (§16.10's own new PLANNED rows); and A/B-during-walk, the real `battle_message_wait`
timeout path, and a fresh-battle stale-byte case (§16.10, still PLANNED). The exact WHY of the
harness's own rendering-time address-drift threshold — beyond confirming its existence, its fix,
and that it is pre-existing and design-independent (§16.11) — is a separate investigation this
round's own scope does not cover.

Worktree removed after the diff was saved to the session scratchpad; `git status --short` and
`git worktree list` on the main tree, both confirming a clean return, are in the session report
(`handoff-next/battle-anim-party-attack-design-amend1-fix2-report.md`).

### §16.10 Test plan (item 10)

The identical §6/§14-style table — setup, assertions, and the wrong implementation each row
catches. Status categories, unchanged in shape from fix round 1, updated in content this round:
**EXECUTED — W1-W3** (SCRATCH probes, §16.9, unchanged this round); **EXECUTED — real regression**
(an EXISTING `rpg.test.js` test driving the real player-facing UI dispatch, not an isolated routine
call); **CARRIED, not re-executed this round** (a claim amendment round 1's own probes A-G proved,
still structurally true, not independently re-run as a fresh isolated script this round); or
**PLANNED** (designed, not yet built). **Fix round 2 (review round 2, P2-4): the poisoned/burned
regression row and the mixed-removal row both move from "claimed" or "PLANNED" to genuinely
EXECUTED this round** — see their own rows below for what changed. Three new PLANNED rows are added
for a single-target damage spell, a heal, and an unanimated party cast (with a live party
`attackAnim`), each through the real UI routing, asserting no early HP/message/effect change
through ticks 1-9 and resolution only on tick 10 — the review's own P2-4 finding that the prior
round's entry-path row named only FIGHT/MAGIC-all-target without covering these three variants
explicitly.

| Test | Setup and assertions | Wrong implementation it catches | Status |
|---|---|---|---|
| The acting party member's own sprite X ramps with `bt_walk_step`, matching the formula, through the REAL `battle_target` routing point (a physical FIGHT confirm) | `battle_target` (`bt_cmd = BC_FIGHT`, `pad_new = BTN_A`) starts the walk; `battle_draw_sprites`, isolated calls at `bt_walk_step` = 0/2/4/8, real OAM read at `$0203` (party slot 0's own first tile X), every other party slot's `pc_in_party` explicitly cleared | The offset math applied to the wrong slot, computed backward (walking AWAY from monsters), not applied at all, or a phantom uninitialized "party member" masking the real one at the same OAM index | EXECUTED — W1 this round |
| Neither `attack_target` nor `cast_spell` arms until the walk completes, one tick late, never early, for a PHYSICAL ATTACK specifically | `battle_target` starts a FIGHT's own walk; `battle_tick`, isolated, called 10 times; assert `bt_fx_anim == NO_ANIM` through call 9 (even the tick `bt_phase` becomes `BP_ACT`), changes only from call 10 | The walk and the swing racing (arming before the walk visually finishes), or the phase transition itself being one tick early/late relative to `battle_dispatch`'s own re-entry | EXECUTED — W2 this round |
| `bt_walk_step` resets to 0 at message dismissal — a direct call, an early A-press, and actor-at-0-HP all reset it | Three isolated calls: `battle_message_done` directly (a LOCAL reset probe, not itself an execution of the ordinary timeout path — see the row below for that); `battle_message_wait` with `pad_new = BTN_A`; `battle_message_done` with `pc_hp = 0` | A reset that only fires on the direct-call path (leaving an early-dismissed or KO'd actor stepped-forward permanently), or one gated on the actor still being alive | EXECUTED — W3 this round (three sub-cases) |
| A real physical Attack against a poisoned/burned combatant: the walk delays the swing, holds the offset through the action's own message, resets it before EACH status line, and each status tick runs at the ORIGINAL (post-snap-back) position, in order | `rpg.test.js`, real `nes.frame()`-driven FIGHT: confirm target, `stepPastWalk`, one more frame for `battle_act`; assert `bt_walk_step == WALK_TICKS` the instant the attack's own message is up; dismiss, assert `bt_walk_step == 0` BEFORE poison's own line; dismiss again, assert `bt_walk_step == 0` BEFORE burn's own line too; HP/message/order assertions as before | The walk racing a status tick, a status tick firing DURING `BP_WALK` (§16.11), or (what an HP/message-only test could not catch) an implementation that leaves the walk offset live through a status line by accident | EXECUTED — real regression, STRENGTHENED this round (`a combatant poisoned and burned on its own turn...`) — genuinely positional proof now, but survived-only: BOTH ticks in this test are non-lethal, so this row alone does not prove anything about a LETHAL status tick (see the new row below, review round 3, P2-2) |
| A LETHAL status tick (poison or burn) that kills the ACTING party member, through the SAME real action/dismissal route — corrected this round (review round 4, P2-2: the original recipe had the status tick applying to the attacked MONSTER, but status dispatch acts on `bt_actor`, never the target — `poison_tick`/`burn_tick`, `engine/battleturn.asm:621-646`, copy `bt_actor` INTO `bt_target`, apply damage, then print, per `engine/battleui.asm:740-778`'s own dispatch — so the original recipe could not have verified the walking party member's own lethal-status reset at all; a genuinely separate regression from the row above, so that row keeps its own non-lethal, dual-status-ORDER purpose intact rather than being overloaded to also prove a death case) | `rpg.test.js`, real `nes.frame()`-driven FIGHT: seed the ACTING party member with one status bit (poison or burn alone, not both) and HP at or below that tick's own damage, attacking a HEALTHY monster (not the other way around); confirm target, `stepPastWalk`, one more frame for `battle_act`; assert `bt_walk_step == WALK_TICKS` (the full offset) while the action's own message is up. At dismissal, assert `bt_walk_step == 0` at entry to the lethal status routine, BEFORE `apply_damage` runs; after the tick, assert `bt_walk_step == 0`, the acting member's own HP is 0, and the status line printed is the correct one (not a generic hit message). On dismissing THAT line, assert no further status ticks run for the now-dead actor, and that battle progression reaches the correct next-turn or party-defeat flow | An implementation that only ever exercised a survived-target case, so a status tick that is actually lethal to the ACTOR takes a different, untested code path — e.g. one that leaves `bt_walk_step` nonzero because the KO branch returns before the reset runs, one that lets a dead actor's status bit still tick on a later turn, or one whose status-line-then-KO message ordering differs from a physical-attack KO's own already-tested ordering. Party death does not go through monster `bt_wipe_mask` bookkeeping at all — a recipe that checked for it would be checking the wrong mechanism entirely | PLANNED — not built this round |
| Formation-wide wipe budgeting still holds under a REAL all-target cast, now delayed by the walk | `rpg.test.js`, real MAGIC cast against four monsters at 1 HP each; budget extended by `WALK_TICKS + 4` frames to cover the walk before the kill/wipe sequence begins | A wipe-budget test whose own frame window was calibrated before the walk existed, silently passing for the wrong reason (nothing yet resolved) once the walk is added | EXECUTED — real regression (`killing a whole formation in one tick...`) |
| A real MISS dismissal-and-rearm lifecycle survives the walk delaying BOTH the first and the second miss | `rpg.test.js`, real FIGHT confirm → walk → miss → dismiss → next turn's own walk → miss again, driven through `battle_tick`/`callThroughWalk` | A second miss racing the first's own dismissal-triggered reset, or the walk's own reset interacting badly with `bt_miss_left`'s independent countdown | EXECUTED — real regression (`real dismissal and next-turn lifecycle...`) |
| Message-cap asymmetry (hit feedback keeps counting across an early MISS dismissal) still holds with the walk in the sequence | `rpg.test.js`, real FIGHT confirm → walk → resolve, `RNG` seeded for a real landed hit | The walk consuming ticks that were implicitly part of `bt_hurt_left`'s own countdown budget, corrupting the asymmetry the pre-existing test proves | EXECUTED — real regression (`message-cap asymmetry, real lifecycle...`) |
| The real M/I/S/S glyph's own pixel render still appears after the walk delays the miss that arms it | `rpg.test.js`, real frame-driven FIGHT confirm (forced miss, `acc: 0`) → `stepPastWalk` → six more frames for the OAM-DMA lag → pixel-level PPU read of the MISS glyph's own anchor | An OAM-DMA lag assumption calibrated before the walk existed, now sampling the frame buffer before the (now-later) miss has actually drawn | EXECUTED — real regression (`MISS overlay: the real M/I/S/S glyph shape renders...`) |
| MISS and a monster's own battle-animation flipbook still render in the SAME frame, at their own disjoint anchors, with the walk in the party's own preceding turn | `rpg.test.js`, real FIGHT confirm (guaranteed landed hit) → walk → resolve → monster's own turn (unaffected by the walk, §16.3b) → miss + flipbook in the same tick | The walk changing which frame the two draws land in relative to each other, or leaking the party's own walked-forward X into the unrelated monster-side check | EXECUTED — real regression (`MISS overlay + battle animation...`) |
| Both real entry paths (a FIGHT's own `battle_target` confirm, and a MAGIC all-target's own `spell_chosen_all`) start `BP_WALK`, and no damage/message/effect appears until it completes | For each: confirm/cast, assert `bt_phase == BP_WALK` immediately, assert `bt_dmg_hi`/`bt_fx_anim` unchanged through `WALK_TICKS` ticks, only changing once `BP_ACT` is reached | Either insertion point silently keeping the OLD direct-to-`BP_ACT` transition, or resolving the action's own effect one tick early (mid-walk) | PLANNED — covered indirectly by the real regression rows above (which exercise both paths already, via the FIGHT and MAGIC scenarios respectively) and by W1/W2 above for FIGHT specifically; a MAGIC-specific isolated version of W1/W2 (rather than the real regression coverage) is not separately built |
| A/B pressed during `BP_WALK` leave the command, selection and phase intact — the walk does not read input | `battle_walk_wait`, isolated, called with `pad_new = BTN_A` then `BTN_B` mid-ramp; assert `bt_phase` stays `BP_WALK` (does not skip ahead or reroute to `BP_MENU`), `bt_cmd`/`bt_sel` unchanged | A stray `pad_new` read inside `battle_walk_wait` (there is none in the design, §16.3b) letting a mistimed press skip or cancel the walk | PLANNED — not built; `battle_walk_wait`'s own design (§16.3b) reads no input at all, so this is expected to pass trivially, but was not separately isolated and run |
| The real auto-advance TIMEOUT path through `battle_message_wait` (no A-press at all) resets the walk | `battle_message_wait`, isolated, `bt_timer = 1` and `pad_new = 0` (a genuine one-tick-to-zero countdown, no button read at all — distinct from W3's own explicit A-press sub-case, which is a different code path through the same routine) | A reset that only fires on the DIRECT `battle_message_done` entry point or the A-press branch, missing the auto-advance path that reaches the identical clearing code via `bt_timer` reaching 0 on its own | PLANNED — W3 above covers the direct call (a local reset probe) and the A-press branch; the pure auto-advance-via-timeout path specifically was not isolated as its own case |
| A fresh battle started with a stale `bt_walk_step` from a PRIOR battle starts clean | `setup_monsters`, isolated, `bt_walk_step` pre-set to a nonzero sentinel before the call; assert it reads 0 immediately after | A battle-to-battle carryover leaving the FIRST party member's own icon visibly stepped-forward for no reason at the start of a new fight | PLANNED — the reset itself is a one-line, unconditional `lda #0 / sta <bt_walk_step` inside `setup_monsters` (§16.3a), reasoned safe by direct read, not separately isolated and run |
| A real save/load mid-battle still restores correctly with the walk always present | Not built — `bt_walk_step`'s own lifetime is capped at message dismissal (§16.3a), well before any save point a player could reach, so this needs no NEW coverage beyond the existing save/restore test surface | A save/restore path that, for some reason specific to this RAM byte, behaves differently now that it is unconditional | PLANNED — reasoned safe, not executed |
| Deleting an earlier party member preserves a surviving member's own `attackAnim` | Pure JS, no ROM: two members, `renumberPartyMemberDeletion(project, 0)` + `splice` + re-id (`character.js:108-119`'s own shape). Assert the survivor's own `attackAnim` is unchanged | A future removeMember rewrite that keys attack visuals by array position instead of letting them travel with the member object | CARRIED, not re-executed this round — probe E (amendment round 1); unaffected by this round's own P2-4/always-on changes, since it is pure JS unrelated to either |
| `projectWithoutBattleAnimation`'s own scope boundary | Pure JS: actor/spell/party all set, strip, assert actor/spell become `null`, party UNCHANGED, and the original project is not mutated | This lever silently widening to strip party content too (or vice versa, the party lever silently touching actor/spell) | CARRIED, not re-executed this round — probe F; the predicate itself is untouched by fix round 1 |
| Deterministic party hit AND a forced miss with an authored party `attackAnim` — restored this round (review round 4, P2-1: the original cycle's own probes A/B, adapted to the direct arm; deleted from the operative test plan when §16.9/§16.10 were rewritten, though §10 kept recording them as accepted) — **corrected this round (review round 5, nit 2): named the concrete setup; `RNG = 0` alone does not force a hit** | `sample-rpg`, `attack_target`, isolated `callRoutine`, `bt_actor = 0`, `bt_target = MAX_PARTY` (the first monster slot), the acting party member's own `attackAnim` set to a real, authored playable animation. Hit case: explicit `acc = 255`, `eva = 0` (a guaranteed hit regardless of the RNG draw, since `roll_hit` compares its next value against accuracy minus evasion, `engine/rpg.asm:14-24`, `engine/battleturn.asm:657-679`), assert the armed effect id (`bt_fx_anim == pc_anim_attack[bt_actor]`), the acting party's own slot (`bt_fx_slot == bt_actor`), and that the attack actually landed (`bt_dmg_hi != 0xFF`). Miss case: `acc = 0` against `eva = 0` — a GUARANTEED miss (the zero threshold, not a subtraction underflow), assert the SAME effect/slot arm STILL happens, `bt_dmg_hi == 0xFF` | The hit case alone cannot distinguish "armed before the roll" from "armed only because the roll happened to succeed" — both placements produce an identical result whenever the roll succeeds. The miss case is what actually rejects hit-only arming: if the arm call lived inside `roll_hit`'s own hit branch instead of before it, a guaranteed-fail roll would leave the effect un-armed | PLANNED — not built this round |
| Member 0 with a `null` `attackAnim`, WITH another member's own `attackAnim` keeping `PARTY_ATTACK_ANIM_ENABLED` live, leaves the flipbook untouched — restored this round (review round 4, P2-1: the original cycle's own probe B, adapted — the original called `battle_fx_arm_attack`, which is now monster-only and untouched by the direct-arm redesign (§16.2); calling it here would be vacuous, since it no longer has a party branch to exercise at all) | The NEW `attack_target` arm block itself (`ldx <bt_actor` / `lda pc_anim_attack,x` / `ldy <bt_actor` / `jsr battle_fx_arm_at`), isolated, `party[0].attackAnim = null` but `party[1].attackAnim` set (keeps the gate live), `bt_actor = 0`, `bt_fx_anim` pre-set to a sentinel (not `NO_ANIM`). Assert the sentinel is unchanged | `battle_fx_arm_at`'s own `NO_ANIM` no-op path reached with the wrong operand, or a gate check that wrongly assumes "the party feature is off" instead of "THIS member's own entry is `NO_ANIM`" | PLANNED — not built this round |
| A later, non-starting member reaches their own `pc_anim_attack` entry, with membership holes at earlier indices — restored this round (review round 4, P2-1: the original cycle's own probe C) | Four-member project (two pushed as `startsInParty: false`, one already non-starting), member 0 `attackAnim = 0`, member 3 `attackAnim = 1` — distinct. Recruit member 3 via the REAL Join mechanism (`battle_entry`, isolated, `bt_call = BE_JOIN`, `bt_arg = 3`). Assert `pc_in_party[1..3] == 0` before, `pc_in_party[3] == 1` after; arm with `bt_actor = 3` through the direct `attack_target` block, assert `bt_fx_anim == 1` (member 3's own), never `0` | The index-space claim (§16.4) holding only for member 0 (always recruited at boot) and silently failing for anyone recruited later, or Join recruiting into the wrong RAM slot | PLANNED — not built this round |
| A real save/load or Continue restores membership AND per-member animation identity correctly — restored this round (review round 4, P2-1: the genuine save/load regression the original cycle's own review 3 left PLANNED and never executed; §10's own record of its acceptance as a requirement was correct, but the operative row itself had been deleted, and the paragraph above falsely called it "carried unchanged" — corrected there too) | Save a party with holes and distinct per-member state (members 0 and 3 recruited, 1 and 2 not, each with its own `pc_level`/`attackAnim`), disturb RAM afterward, run the REAL load path (`load_apply_body`/`continue_game`, `engine/save.asm`). Assert membership `[1, 0, 0, 1]` and member 3's own distinct state (e.g. `pc_level[3]`) at index 3 FIRST, BEFORE checking that member 3's own animation still arms correctly | A load that compacts or renumbers recruited members — nothing else in this test plan catches it, since `pc_anim_attack` is a build-time ROM table the direct arm block reads by raw index with no membership check, so a compaction bug leaves an index-only re-arm check passing regardless | PLANNED — not built this round; the old isolated `party_restore`-then-re-arm recomputation (probe C's own aside) is kept only as historical narrow evidence that arming member index 3 still works after recomputation — it is NOT save/load coverage, since it never actually restores from a save at all |

The original cycle's own spell-fallback probe (a party caster's own `attackAnim` substituting for an
un-animated spell cast, probe D) is NOT restored here — it is legitimately superseded, not lost: §8's
own "physical-only" answer means no such fallback exists any more, and the current un-animated-cast
row (§16.10, `rpg.test.js`, corrected review round 3 P2-2) already asserts the opposite of what probe
D checked.

**Corrected this round (review round 5, nit 1): the paragraph above ended the preceding Markdown
table, leaving the rows below with no header/delimiter of their own — a fresh header restores a
valid table for the remaining rows without moving any row's own content.**

| Test | Setup and assertions | Wrong implementation it catches | Status |
|---|---|---|---|
| Mixed-reference removal ARITHMETIC (corrected this round, review round 3, P2-1: split from the advisor-output row below, which this row's own evidence never actually covered) | `sample-rpg`, actor `attackAnim` AND party `attackAnim` both set, `renamable` off. Assert `battleRegionBytes` recomputed after `projectWithoutBattleAnimation` alone frees `0`, after `projectWithoutPartyAttackAnim` alone frees `12`, after both frees `283` — identical on MMC1/MMC3/UNROM 512 | A scope-inaccurate strip helper, or a before/after recomputation silently under/over-freeing when both references coexist | EXECUTED — §16.9's own mixed-removal paragraph, re-derived against this round's own rebuilt worktree and matching the reviewer's own independently-computed 0/12/283; this row is arithmetic ONLY, no advisor call |
| `battleShortfallAdvice`'s own LABELS and recomputed savings, for the same mixed project — corrected this round (**amendment fix round 4, orchestrator finding**: the label itself was wrong, a regression traced to amendment fix round 1's own rebuild, §10) | `sample-rpg`, same project as the row above. Call `battleShortfallAdvice(project, mapper, deficit, ...)` with a deficit that ONLY the party-only strip closes, and again with a deficit only the COMBINED strip closes; assert the monster/spell-scoped label (`'every monster attack or spell animation reference'`) and the party-scoped label (`"every party member's own attack animation"`) both appear with their own correct recomputed savings; assert the zero-saving monster/spell-only strip is NEVER offered as sufficient relief on its own; assert no walk-removal advice appears anywhere (there is no such lever any more, §16.6) | An advisor offering a lever that frees nothing as if it were sufficient, mislabeling which scope a lever strips (including the pre-existing, un-renamed `'every battle animation reference'` string, which overpromises — it strips only actor/spell references, never a party member's own), or (a regression of the walk's own always-on design) resurrecting a walk-removal suggestion | permanent test PLANNED; scratch advisor probe executed in fix round 4 — the "catches" column above named `battleShortfallAdvice` without ever calling it in a PERMANENT test, which review round 3 (P2-1) found overstated the arithmetic-only evidence actually recorded |
| `animationReferenceLocations` yields the party location; `allBattleAnimationIds`/OAM budget sees it; `renumberAnimationDeletion` shifts it; `validateProject` refuses a stale one (hop 1) | Direct execution against a real (non-ROM) project — see §16.9's own "reference-integrity traversal" paragraph for the exact values checked | The traversal silently missing the one new reference kind — every consumer downstream inherits the miss | CARRIED, not re-executed this round — none of these traversal predicates changed in fix round 1 |
| `validateProject` hop 2 for a party reference (a real animation whose own frame names a missing metasprite) | Not separately built — follows the identical, already-proven actor/spell code path (`isPlayableBattleAnimation`, one shared predicate, no party-specific branch) | An off-by-one or type-coercion gap specific to how the party traversal computes its own `isPlayableBattleAnimation` call | PLANNED — same predicate as an existing, already-tested actor/spell case |
| Ledger equality, all three boards, code and table bytes separately, for the RE-DERIVED and CONSOLIDATED figures | §16.9's own measured table; `bankedbytes.test.js`'s own two isolation tests, `BATTLE_ANIM_BATTLE_ALLOWANCE` (264, consolidated, fix round 2) and `PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE` (10), each an `assert.equal` CODE delta with table bytes subtracted first, plus the pre-existing absolute base-equality case (stock and no-items variants) | A stale `BATTLE_ANIM_BATTLE_ALLOWANCE`/`PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE`/base figure drifting from the real assembled cost | EXECUTED — `bankedbytes.test.js`'s own two isolation tests plus the existing base-equality case, §16.9 |
| Absolute `battleRegionBytes(project, mapper) == nesasm usage`, per mapper, for ALL FIVE variants (off, monster-only, spell-only, party-only, mixed) — corrected this round (review round 3, P2-1): the existing isolation tests only ever check a CODE DELTA between two variants (discarding `predicted`), never the absolute predicted figure for spell-only or party-only on their own | For each of MMC1/MMC3/UNROM 512 and each of the five variants: actually assemble the project, `assert.equal(usedFromNesasm, battleRegionBytes(project, mapper))` directly (not a delta against another variant); additionally assert the two table-byte deltas explicitly for this sample — `7` shared table bytes (monster-only or spell-only vs. off) and `2` party table bytes (party-only or mixed vs. monster-only) | A `battleRegionBytes` prediction that happens to match on the two variants the isolation tests already build (off, monster-only) while silently drifting on spell-only or party-only specifically, invisible to a delta-only test suite | PLANNED — this round's own SCRATCH measurement (§16.9's own 5-variant table) is real evidence the absolute figures agree today, but it is a scratch script's own output, not a permanent `assert.equal` in `bankedbytes.test.js` — an implementation must add the permanent version, not treat the scratch table as coverage |
| Action projects reach zero effective battle-region contribution, INCLUDING one that authors a battle-animation reference — corrected this round (review round 3, P2-1): must NOT be checked by asserting the raw `battleRegionBytes(actionProject, mapper)` helper returns 0 | `battleRegionBytes(project, mapper)` (`main/build/battletables.js:1000-1014`) is a pure function of `project`'s own content — it never reads `project.project.gameType` and returns a real, nonzero HYPOTHETICAL figure for an action project carrying, say, an actor's own `attackAnim`, exactly as it would for an RPG. The real exclusion happens one layer up, through `codeRegions(mapper, tilesetCount, bankedCode)` (`shared/cartridge.js:587-592`): `bankedCode` is 0 for an action project (only an RPG-capable, `gameType === 'rpg'` project ever requests a battle region at all), and `codeRegions` returns `[]` whenever `bankedCode` is falsy — no region, no bank, no code emitted, regardless of what `battleRegionBytes` alone would compute. Assert `codeRegions(mapper, tilesetCount, 0)` (or however `checkCapacity` derives `bankedCode` for an action project) is empty for an action project that DOES author an actor's own `attackAnim`, and that the built ROM itself carries no walk-related code (already proven for the four checked-in action fixtures by full-ROM SHA-256 identity, §16.9 — but those four never author a battle-animation reference in the first place, so this is a genuinely NEW case, not already covered) | An implementation that gates the battle region on `battleRegionBytes(project, mapper) > 0` instead of on `gameType === 'rpg'`, letting an action project with an authored `attackAnim` (a legal, if pointless, authoring state — nothing currently refuses it) silently acquire a real battle-code bank it can never reach | PLANNED — not built this round; the four checked-in action fixtures' own SHA-256 identity (§16.9) proves the untouched case, not this one |
| Single-target damage spell, through the real MAGIC → `battle_target` routing — corrected this round (review round 3, P2-2): no `bt_dmg_hi` as the damage assertion, no ambiguity about which tick does what | `rpg.test.js`, real MAGIC confirm on a single target. Immediately after confirmation, snapshot the TARGET's own real HP, the current message-box state (e.g. `box_state`/whatever text is on screen), and `bt_fx_anim`. Ticks 1-8: assert all three snapshots UNCHANGED. Tick 9: assert ONLY the phase transition (`bt_phase == BP_ACT`) — explicitly assert the three snapshots are STILL unchanged on this same tick, since the phase changing is not resolution. Tick 10: assert the target's own HP has DROPPED by the spell's own real damage amount (never `bt_dmg_hi` alone, which proves nothing about the actual HP moving), and the message state has changed to the resolved line | An implementation resolving damage one tick early (mid-walk), resolving it ON tick 9 instead of tick 10 (conflating the phase transition with `battle_act` actually running), or `bt_dmg_hi` alone being treated as sufficient proof of "no damage yet" when it could simply be stale from a PRIOR action | PLANNED — not built this round |
| A heal, through the real MAGIC routing — corrected this round (review round 3, P2-2): adds the message assertion the prior round's row omitted | `rpg.test.js`, real MAGIC confirm on a heal spell with a real `anim`. Snapshot caster HP, message state, and `bt_fx_anim` after confirmation. Ticks 1-8: all three unchanged. Tick 9: only the phase transition, snapshots still unchanged. Tick 10: caster HP has RISEN by the heal's own real amount, the message state has changed to the resolved line, and the caster-anchored effect (§16.3a's own follow-the-walker snippet) is drawn at the STEPPED-FORWARD position, not the pre-walk one | A heal resolving early, resolving on tick 9, omitting the message check entirely (silently passing an implementation that heals with no message), or its own caster-anchored effect arming at the PRE-walk position instead of the stepped-forward one | PLANNED — not built this round |
| An unanimated party cast with a LIVE party `attackAnim` authored — corrected this round (review round 3, P2-2): must assert REAL resolution happens on tick 10, not merely that `attackAnim` never substitutes | `rpg.test.js`, real MAGIC confirm on a spell with no `anim`, the casting member's own `attackAnim` set to a real id. Snapshot target/caster HP (per the spell's own kind), message state, and `bt_fx_anim` after confirmation. Ticks 1-8: all unchanged. Tick 9: only the phase transition. Tick 10: assert the spell's own REAL HP change and message DID land (resolution genuinely happened, not merely "nothing armed"), AND `bt_fx_anim` is STILL `NO_ANIM` on this same tick 10 — never arms the party member's own `attackAnim` as a fallback, even once real resolution has occurred | An implementation that lets a LIVE party `attackAnim` leak into the spell-cast path as a fallback (reintroducing the symmetric shape Chris's answer explicitly forbade, §16.1), OR one that passes this row vacuously by never resolving the spell at all (an "always NO_ANIM" implementation that also never applies damage/healing would wrongly pass a test that checks `bt_fx_anim` alone) | PLANNED — not built this round |
| Fixture ROM identity — four non-RPG fixtures byte-identical, two RPG fixtures deliberately re-pinned | `test/unit/nameentry.test.js` against the checked-in fixtures | A gate that assembles even one byte unconditionally for an action project, or an RPG hash left stale after the walk's own base change | EXECUTED — `60/60`, §16.9 |
| Off/monster-only/spell-only full-ROM identity to a clean `71cfa84` build (action fixtures only) | Full-ROM SHA-256 against an unmodified `71cfa84` build, both directions, all three boards | A change to the SHARED base mechanism reaching an action project that never authors battle content | EXECUTED — §16.9 |
| `animationSelect`'s shared behaviour across all three Forges (§16.8) | Smoke test: mount Magic/Monster/Character against the same project, assert identical `<option>` sets, correct `null`/numeric conversion, and persistence after selection | Three copies (or two plus a shared one) drifting from each other after the dedupe, or the dedupe changing behaviour for the two EXISTING Forges | PLANNED — no `renderer/` file touched this round |
| Character Forge field + preview smoke step | `main/smoke.js`'s existing Character Forge coverage gains: pick an animation, confirm the field persists across a re-render and an undo; select a DIFFERENT party member whose own `attackAnim` is the SAME id, assert playback is retained (not restarted); select a member with a STALE `attackAnim`, assert the "Missing animation N" caption; undo back across a selection change | A field that does not survive `fill()`'s own children-replacement; a same-id switch that wrongly restarts playback; a stale-id switch that silently substitutes a real animation | PLANNED — no `renderer/` file was touched this round |

### §16.11 What could go wrong, and places reasoned rather than read (item 11)

- **Corrected this round (review P2-2): a status tick fires at the ACTOR'S ORIGINAL position, not
  the stepped-forward one — amendment round 1's own version of this bullet stated the opposite, and
  was wrong.** `battle_message_done`'s own reset (`lda #0 / sta <bt_walk_step`) runs
  UNCONDITIONALLY, at the START of the routine, BEFORE `clear_message`,
  `combatant_status`/`battle_status_dispatch` are ever reached (`engine/battleui.asm:713-780`) — so
  by the time ANY status tick's own line shows, `bt_walk_step` has already snapped to 0. Every
  status line for the acting combatant — poison, burn, or any future status bit — is shown at the
  ORIGINAL, pre-walk position, exactly like every OTHER combatant's own icon. §16.3a/§16.3b state
  this consistently now; this bullet exists to record that the amendment-round-1 version of THIS
  section did not, and why. Confirmed this round by real regression, not merely reasoned: the
  poisoned/burned combatant test (§16.9, §16.10) drives a real FIGHT through the walk, the attack's
  own message, and both status ticks, and passes with this exact lifetime.
- **Superseded, fix round 1: there is no second party gate to interact with `PARTY_ATTACK_ANIM_
  ENABLED` any more.** Amendment round 1's own version of this bullet checked whether
  `PARTY_ATTACK_ANIM_ENABLED` and `PARTY_CAST_WALK_ENABLED` — two independently-gated features both
  touching `battle_sprite_pc`/`battle_fx_draw` — could reproduce the dangling-`mon_anim_attack`
  hazard §16.6 already found once. `PARTY_CAST_WALK_ENABLED` no longer exists (§8, §16.6): the walk
  is unconditional, so `battle_sprite_pc`'s and `battle_fx_draw`'s own walk-offset code has no gate
  of its own to interact with anything — only `PARTY_ATTACK_ANIM_ENABLED` remains a real, checkable
  gate, and it interacts with nothing else new this round.
- **Reasoned, not read: the exact vblank/mainline cycle cost of the `BP_WALK` phase's own tick and
  draw-time offset work was not measured against a cycle-accurate tool** — bounded (a fixed, small
  instruction sequence per tick, no loop) the identical §11 discipline this document already holds
  every other addition to.
- **Reasoned, not read: whether a status effect (poison/burn) applied to the WALKING actor mid-walk
  — as opposed to mid-message, above — needs its own consideration was not investigated**, since
  status ticks only ever fire from `battle_message_done` (after `BP_ACT`, after the walk has already
  completed) — `BP_WALK` itself has no status-tick dispatch of any kind, so this is believed
  unreachable rather than merely unexamined, but was not built to confirm.
- **Resolved this round (fix round 2, review round 2, section 1): `rpg.test.js`'s own "multi-target
  hit-feedback policy" test's own code-size fragility is ROOT-CAUSED, fixed, and assigned — no
  longer an open investigation.** Fix round 1's own version of this bullet found the defect was
  pre-existing and address-layout-sensitive (the eight-`nop` control on a clean `71cfa84` tree,
  reproduced again this round) but left its own WHY and its own disposition unresolved. The
  reviewer's own instrumented reproduction supplies both: the test's own `callRoutine` masks NMI
  (PPUCTRL `$2000`) but leaves rendering ON (PPUMASK `$2001`), so its own manual `vram_drain` call —
  an NMI-only routine everywhere else in this codebase (`engine/text.asm:150-176`, `engine/boot.asm:
  351-353`) — can run on a visible scanline, where rendering itself moves the PPU's own address
  counters between the `$2006` pair and the `$2007` write. Fixed with a one-line forced-blank
  (`nes.mmap.write(0x2001, 0)`) in that one test only, now part of this slice's own Appendix E
  (§16.9). **What remains genuinely unresolved, named honestly rather than left implicit**: WHY this
  specific rendering-time address drift crosses its own threshold at a particular code-size offset
  was not further diagnosed — the fix does not depend on understanding that, but a reader should not
  assume the mechanism is fully characterized, only that it is contained and the affected test is
  fixed.
- **Superseded, fix round 2 (review round 2, P2-3): `BATTLE_ANIM_BATTLE_ALLOWANCE` and
  `WALK_FX_FOLLOW_BATTLE_ALLOWANCE` no longer exist as two separately-named terms, so the
  ledger-honesty limitation fix round 1's own version of this bullet named is moot.** That bullet
  observed that the two terms could only ever be verified as a SUM, never independently, since they
  shared one gate — and that an opposite drift between them, holding the sum at 264, would pass
  undetected. Fix round 2 resolves this by CONSOLIDATION rather than by living with the limitation:
  one constant, `BATTLE_ANIM_BATTLE_ALLOWANCE = 264`, with the `243 + 21` provenance kept in a
  source comment (§16.6) — there is no longer a second name for anything to drift relative TO, so
  the limitation this bullet described cannot recur under the current design. Kept here, superseded
  rather than deleted, as the record of why the consolidation happened.
- **The multi-target case has no analogue here worth naming, and this document should not invent
  one.** A party member's own physical attack (`attack_target`) is always single-target — there is
  no all-target party attack in this engine at all, so §12.3's own "only the LAST target ends up
  visible" caveat for `cast_all` simply does not apply to a party member's own SWING. A party
  CASTER's own all-target spell (`AllCaster`, cast on the OTHER side) already plays over the
  CASTER's own slot (§3.3's own scope rule, unchanged by this slice) — so it is not "hitting several
  targets and losing all but one," it was never target-anchored at all.
- **A party member's own `attackAnim` interacting with a FUTURE party-side status effect or a
  future party-side MISS reaction was not explored** — §13 (MISS) and §12 (hit feedback) both
  already react on whichever slot was HIT, regardless of which side did the hitting, so nothing
  about THIS slice changes their own reach; a future feature that reacts specifically to the
  ATTACKING party member (rather than whoever was hit) would need its own review of this
  interaction, not assumed safe by extension from what is checked here.
- **Reasoned, not read, and corrected in shape this round: the exact vblank/mainline cycle cost of
  `attack_target`'s own new direct-arm block was not measured against a cycle-accurate tool** —
  amendment round 1's own version of this bullet named a party branch inside `battle_fx_arm_attack`,
  which no longer exists (§16.2, P2-4); the equivalent instructions now live directly in
  `attack_target` instead, a handful of extra instructions, the defensible claim being the same one
  every prior round's version made: bounded (a fixed, small instruction sequence, not a loop), the
  identical §11 discipline this document already holds every other addition to.
- **Reasoned, not read**: whether an author would want a party member's own `attackAnim` to also be
  offered in the overworld animation pickers was not investigated — `animationReferenceLocations`'s
  own party yield is `battleOnly: true` (§16.5), the identical scope boundary `battle.attackAnim`
  already draws for an actor, so this slice does not widen that question, only answers it
  consistently for the new field.
- **Reasoned, not read**: the Character Forge's own `previewHost` visibility toggle (§16.8, `style.
  display`) was designed and reasoned through in detail but not built — no worktree change touched
  `renderer/` at all this round (a DESIGN round, per the brief's own scope rule), so its own
  behaviour under a live game-type change (an undo that crosses from an RPG project back to... this
  cannot actually happen, since `gameType` is fixed at project creation and never changes in place,
  confirmed by grep — `project.project.gameType` is written only by `createProject`, never by any
  Forge) was reasoned from that fact, not exercised.
- **What could go wrong, §5-style — corrected again this round (the ORIGINAL §16 cycle's own review
  3, P3-2 — corrected here, review round 4, P3-1: amendment review 3 had no P3-2 of its own, so the
  unqualified citation was ambiguous): raising
  `RPG_LIMITS.party` alone changes nothing for any existing project; the risk needs an actual
  longer party authored, and the write it enables is conditional, not automatic.** `party_init`'s
  own loop (`engine/battle.asm:87-109`) IS bounded at `MAX_PARTY` (`cpx #MAX_PARTY`, `:107`), so a
  fifth-or-later member genuinely cannot be reached at boot regardless of `RPG_LIMITS.party`'s own
  value — that half is safe, inert. `battle_entry_join` (`:31-42`) guards Join with
  `cpx #PARTY_SIZE` (`:40`), NOT `cpx #MAX_PARTY` — but `PARTY_SIZE` is NOT `RPG_LIMITS.party`
  itself; it is the AUTHORED `project.party.length` for the specific project being built
  (`main/build/battletables.js:154,347`; `RPG_LIMITS.party` is only the ceiling `normalizeProject`
  clamps that length against, `shared/project.js:4274-4276,5925-5927` — raising the ceiling
  permits a LONGER project, it does not retroactively lengthen any existing one). So: **if the cap
  is raised AND a project actually authors five members, Join member 4 passes `PARTY_SIZE = 5`. It
  then reads `pc_in_party+4`, which aliases `pc_spells[0]` (`engine/constants.asm:595-596`,
  `pc_in_party = $03B4` sized 4, `pc_spells = $03B8` immediately after); if that byte happens to be
  zero, `party_join` (`:113-116`, `lda pc_in_party,x` / `bne party_join_done` / ... / `sta
  pc_in_party,x`) writes `1` there and continues, corrupting `pc_spells[0]` outside the intended
  array — if that byte is already nonzero, `party_join` instead treats member 4 as "already
  recruited" and returns without writing anything, so the corruption is conditional on RAM state
  at that moment, not automatic. Member 5 needs an actual authored length of at least six to reach
  the equivalent write one byte further in.** Raising `RPG_LIMITS.party` alone, on projects that
  stay at 4 members or fewer, changes `PARTY_SIZE` for none of them and is exactly as safe as
  today. **Raising party capacity for real (both the ceiling AND an actual longer authored party)
  therefore needs auditing BOTH boot (`party_init`, safe by construction, bounded at `MAX_PARTY`)
  AND Join/restore (`battle_entry_join`'s own `PARTY_SIZE` guard, genuinely unsafe past
  `MAX_PARTY` once a project's own length exceeds it) against the fixed RAM layout — not merely
  widening `MAX_PARTY`/`NUM_COMBATANTS` and assuming Join follows.**
  Capacity equality (`RPG_LIMITS.party === MAX_PARTY`, true today) is what keeps this latent, as a
  bound this document depends on holding — not, as an earlier draft of this section stated, the
  REASON the index spaces agree (§16.4's own corrected proof rests on direct indexing, not on the
  two constants happening to match).
- **Superseded, fix round 1: `battle_fx_arm_attack` has no `.else` branch to worry about any more.**
  Amendment round 1's own version of this bullet warned against trusting an `.if`/`.else` split's two
  branches to be byte-identical to the pre-feature routine just because they LOOK identical, rather
  than because it was measured. Fix round 1's own P2-4 shape (§16.2) leaves `battle_fx_arm_attack`
  completely untouched — there is no `.else` branch, no conditional split of any kind inside that
  routine — so this specific hazard cannot recur there. The GENERAL discipline it illustrates still
  holds and is still applied, but the FIGURE it was originally checked against is historical and
  must not be quoted as current: **corrected this round (review round 3, P3-1)** — the 250-byte
  delta (243 code + 7 table bytes) was amendment round 1's own pinned figure, stale since fix round
  1 made the walk's own 56 bytes unconditional (folded into `BASE_BATTLE_CODE_BYTES_BY_MAPPER`,
  §16.3b) rather than gated the way this passage still assumed. Fix round 2's ledger consolidation
  and this round's own five-variant measurement (§16.9) supersede it with the CURRENT figures — a
  271-byte delta for a monster-only or spell-only variant against the sample's own `off` build (264
  code + 7 table bytes, `off` itself already carrying the walk's unconditional 56 bytes in its base),
  and 77 added code bytes for that same variant against a genuinely OLD pre-feature build that
  predates the walk entirely (the 21 bytes folded into the 243→264 consolidation plus the walk's own
  56 base bytes, `21 + 56 = 77`, §16.6). Either figure, current or historical, is only ever
  established by a REAL measured delta matching a pinned prediction to the byte (§16.6, §16.9),
  never by source text looking unchanged.

## Appendix A — the prototype's full diff (phase 1, corrected)

Built and measured in the same `cp -r` scratch copy of the real tree at `38627b7`
(`/tmp/claude-1000/-home-chris-nes-game-forge/07c28a22-1cf5-4d8c-9dd7-e2e1174cac85/scratchpad/
proto`), never a `git worktree`. This is the round-3 mechanism, refreshed for round 4's own two
fixes (the stale "Preserves X" comment on `battle_fx_arm_at`, and `validateProject`'s catalog-cap
diagnostic moved to run first) — round 2's own Appendix A is superseded in full, not appended to,
and this refresh supersedes round 3's own copy the identical way. **No instruction changed**: the
comment fix is prose-only, and the diagnostic reorder is pure JS with no engine or generator effect
at all — confirmed by re-measurement, still 250/243 on all three boards, byte-for-byte identical to
round 3's own figures. Every line here was actually assembled by nesasm to produce those figures.

```diff
diff --git a/engine/battle.asm b/engine/battle.asm
index 58dc539..93546bf 100644
--- a/engine/battle.asm
+++ b/engine/battle.asm
@@ -232,6 +232,9 @@ level_row_add:
 ; shadow rather than appending to it.
 battle_tick:
   jsr wipe_tick
+  .if BATTLE_ANIM_ENABLED
+  jsr battle_fx_tick
+  .endif
   jsr battle_dispatch
   jmp battle_draw_sprites
 
@@ -344,6 +347,10 @@ setup_monsters:
   sta <bt_wipe_mask
   sta <bt_wipe_row
   sta <bt_wipe_slot
+  .if BATTLE_ANIM_ENABLED
+  lda #NO_ANIM
+  sta <bt_fx_anim           ; no effect carries in from a previous battle
+  .endif
   ldx #0
 setup_monsters_slot:
   lda #0
diff --git a/engine/battleturn.asm b/engine/battleturn.asm
index 2f9c5b0..6dbc0f1 100644
--- a/engine/battleturn.asm
+++ b/engine/battleturn.asm
@@ -259,7 +259,12 @@ item_chosen_none:
   lda #BS_NOTHING
   jmp battle_say_actor
 
-; A plain attack from whoever is acting on to bt_target.
+; A plain attack from whoever is acting on to bt_target. Never a monster's own
+; attack (round 2, finding 3): monsters swing through monster_turn_attack
+; below, which is the real, and only, physical-attack path that needs to arm
+; battle.attackAnim. Arming here as well would be dead code -- bt_actor is
+; always < MAX_PARTY on this path -- so round 2 removes it rather than leaving
+; a call that can never fire.
 attack_target:
   jsr roll_hit
   bne attack_missed
@@ -274,11 +279,93 @@ attack_missed:
   lda #BS_MISSES
   jmp battle_say_actor
 
+; PROTOTYPE (battle-anim design slice), round 4 (comment fix only -- no
+; instruction changed; round 3's own header was wrong, contradicted by the
+; very next `tax`).
+;
+; A = an animation id (or NO_ANIM -- does nothing), Y = the combatant slot
+; (0-7) to play it over. Arms the flipbook from frame 0. Clobbers A and X;
+; preserves Y.
+;
+; An empty animation (anim_count = 0, the legal "no metasprite yet" shape,
+; round 2 finding 6) is treated exactly like NO_ANIM: staged into bt_fx_anim
+; first, then reverted, rather than left to reach battle_fx_tick/
+; battle_fx_draw and dereference a table row with nothing in it. This is the
+; one and only place that check needs to live, since every arming path (both
+; below) funnels through here.
+  .if BATTLE_ANIM_ENABLED
+battle_fx_arm_at:
+  cmp #NO_ANIM
+  beq battle_fx_arm_at_rts
+  sta <bt_fx_anim
+  tax
+  lda anim_count,x
+  beq battle_fx_arm_at_empty
+  sty <bt_fx_slot
+  lda #0
+  sta <bt_fx_frame
+  sta <bt_fx_timer
+battle_fx_arm_at_rts:
+  rts
+battle_fx_arm_at_empty:
+  lda #NO_ANIM
+  sta <bt_fx_anim
+  rts
+
+; Arms whoever is acting's own mon_anim_attack over their own slot (bt_actor),
+; if bt_actor is a monster with one authored -- the caster's own swing or
+; cast, never a target. A party member has no authored attack visual (yet)
+; and is left alone. Clobbers X; does not rely on the caller's X afterward
+; (both call sites below reload what they need).
+battle_fx_arm_attack:
+  lda <bt_actor
+  cmp #MAX_PARTY
+  bcc battle_fx_arm_attack_rts
+  sec
+  sbc #MAX_PARTY
+  tax
+  lda mon_slot_actor,x
+  tax
+  lda mon_anim_attack,x
+  ldy <bt_actor
+  jmp battle_fx_arm_at
+battle_fx_arm_attack_rts:
+  rts
+  .endif
+
 ; The spell in bt_arg: damage on bt_target or the whole other side, a heal on
 ; whoever is casting, or a status effect (poison, burn). The kind numbers
 ; index SPELL_KINDS in shared/project.js -- that order is the wire format.
+;
+; Round 2's own cast policy (finding 12): a spell's own `anim`, when authored,
+; plays over the TARGET for a single-target damage/status spell (kind !=
+; SK_HEAL and scope = one) -- an impact -- and over the CASTER for a heal or
+; an all-target spell, where there is no one target to point at and the
+; visual reads as a casting flourish instead. No `spell.anim` at all falls
+; back to the caster's own `attackAnim`, the identical policy a physical
+; attack already uses (finding 3's own decision).
 cast_spell:
   ldx <bt_arg
+  .if BATTLE_ANIM_ENABLED
+  lda spell_anim,x
+  cmp #NO_ANIM
+  bne cast_spell_fx_spell
+  jsr battle_fx_arm_attack        ; no spell visual authored -- fall back
+  jmp cast_spell_fx_done
+cast_spell_fx_spell:
+  ldy <bt_actor                   ; default: the caster (heal / all-scope)
+  lda spell_kind,x
+  cmp #SK_HEAL
+  beq cast_spell_fx_go
+  lda spell_scope,x
+  bne cast_spell_fx_go            ; scope != one ("all") -- stays the caster
+  ldy <bt_target                  ; single-target damage/status -- the target
+cast_spell_fx_go:
+  lda spell_anim,x
+  jsr battle_fx_arm_at
+cast_spell_fx_done:
+  ldx <bt_arg                     ; reload -- the dispatch below needs it back
+  .endif
   lda spell_kind,x
   cmp #SK_POISON
   bne cast_spell_burn_chk
@@ -965,6 +1052,69 @@ wipe_monster_cell:
   bne wipe_monster_cell
   jmp vram_end
 
+; PROTOTYPE (battle-anim design slice), round 2. Advances the running action
+; visual, if any, one frame at a time -- entity_animate's own shape (engine/
+; entities.asm), reimplemented here rather than shared, because that routine
+; is indexed by an entity slot (ent_frame,x/ent_timer,x) and this state is a
+; single running effect, not one array entry per combatant. Ends the effect
+; (bt_fx_anim = NO_ANIM) once the flipbook has played through once -- a
+; single-frame animation ends too, after its own duration, unlike
+; entity_animate's own "a single frame never advances" rule, which is right
+; for an idle overworld pose (nothing needs it to end) and wrong for a
+; one-shot reaction (round 2, finding 6). `loop` is deliberately never read:
+; the battle bank plays every flipbook one-shot regardless of the catalog's
+; own loop flag, a policy, not an oversight -- generate.js never emits `loop`
+; at all (round 1 finding 6's own evidence), so there is nothing to read even
+; if this wanted to. Nothing here waits for the message box to close, so an
+; animation shorter than MSG_HOLD finishes on its own, and
+; battle_message_done's own unconditional clear (engine/battleui.asm) is what
+; caps a longer one at the message hold. Runs from battle_tick, ahead of
+; battle_dispatch, so it never executes nested inside cast_all's own
+; bt_tmp2-owning loop -- both are separate, sequential jsr calls within the
+; same tick, never concurrent.
+  .if BATTLE_ANIM_ENABLED
+battle_fx_tick:
+  ; Round 2, finding 7: on the very first tick of a battle, this runs BEFORE
+  ; battle_dispatch has had a chance to reach battle_intro -> setup_monsters,
+  ; which is the only place bt_fx_anim is reset for a fresh battle -- reading
+  ; it here on that one tick would see whatever the previous battle (or,
+  ; before the first battle of a session, uninitialized RAM) left behind.
+  ; Skipping the whole routine during BP_INTRO is cheaper than moving the
+  ; reset earlier and just as correct, since nothing is ever drawn or ticked
+  ; before the first real phase runs anyway.
+  lda <bt_phase
+  cmp #BP_INTRO
+  beq battle_fx_tick_rts
+  lda <bt_fx_anim
+  cmp #NO_ANIM
+  beq battle_fx_tick_rts
+  tax
+  inc <bt_fx_timer
+  lda anim_ptr_lo,x
+  sta <ptr_lo
+  lda anim_ptr_hi,x
+  sta <ptr_hi
+  lda <bt_fx_frame
+  asl a
+  tay
+  iny                        ; offset to the current frame's duration byte
+  lda <bt_fx_timer
+  cmp [ptr_lo],y             ; holds for EXACTLY `duration` ticks: timer <
+  bcc battle_fx_tick_rts     ; duration stays, timer >= duration advances --
+                              ; correct even at duration 255, since the byte
+                              ; never has to exceed it to detect the boundary
+  lda #0
+  sta <bt_fx_timer
+  inc <bt_fx_frame
+  lda <bt_fx_frame
+  cmp anim_count,x
+  bcc battle_fx_tick_rts
+  lda #NO_ANIM               ; one pass through the flipbook: done, whether it
+  sta <bt_fx_anim             ; had one frame or several
+battle_fx_tick_rts:
+  rts
+  .endif
+
 ; ---------------------------------------------------------- monsters' turn
 
 ; A monster with an affordable spell in its list casts one about half the
@@ -1105,7 +1255,16 @@ monster_turn:
   jsr pick_party_target
   jmp cast_spell
   .endif
+; Round 2, finding 3: this -- not attack_target above -- is the real monster
+; physical-attack path (both MONSTER_SPELL_LIST_ENABLED and the flat single-
+; spell variant fall through to this same shared label), so this is where
+; battle.attackAnim actually has to arm. Before pick_party_target/roll_hit,
+; matching attack_target's own former position: the swing plays whether the
+; hit lands or misses.
 monster_turn_attack:
+  .if BATTLE_ANIM_ENABLED
+  jsr battle_fx_arm_attack
+  .endif
   jsr pick_party_target
   jsr roll_hit
   bne monster_missed
diff --git a/engine/battleui.asm b/engine/battleui.asm
index 934b9dd..b527946 100644
--- a/engine/battleui.asm
+++ b/engine/battleui.asm
@@ -711,6 +711,14 @@ battle_message_wait:
   dec <bt_timer
   bne battle_message_hold
 battle_message_done:
+  ; PROTOTYPE (battle-anim design slice): a running action visual is capped
+  ; at the message hold it was armed alongside -- dismissing the line (by
+  ; timeout or by pressing A early) ends it unconditionally, whether or not
+  ; its own flipbook had finished on its own.
+  .if BATTLE_ANIM_ENABLED
+  lda #NO_ANIM
+  sta <bt_fx_anim
+  .endif
   jsr clear_message
   ; After the acting combatant's own line, every status it carries gets a
   ; word in, one tick and one line per bit, lowest first: status_pending
@@ -841,6 +849,21 @@ battle_sprite_clear:
   bne battle_sprite_clear
   lda #0
   sta <oam_idx
+  ; PROTOTYPE (battle-anim design slice), round 2, findings 4+5: the running
+  ; action visual is drawn FIRST, while oam_idx is still zero, so it always
+  ; lands at the lowest OAM indices -- on this hardware (and the vendored PPU
+  ; agrees, renderer/emulator/core/ppu/index.js's own "priority: lower index
+  ; in secondary OAM = higher priority") that is what makes it a true
+  ; foreground overlay in front of whichever combatant icon it plays over,
+  ; not a layer buried behind it. battle_fx_draw's own fit check is what
+  ; keeps this admission safe: it knows, from BATTLE_FX_OAM_ROOM (a compiled
+  ; constant, main/build/generate.js -- the room left after the combatant
+  ; loops below and the cursor take their own worst-case share), and skips
+  ; the WHOLE effect frame rather than let it eat into that room. It does
+  ; not, by itself, fix a project whose combatants alone already overflow.
+  .if BATTLE_ANIM_ENABLED
+  jsr battle_fx_draw
+  .endif
   ldx #0
 battle_sprite_pc:
   lda pc_in_party,x
@@ -930,5 +953,100 @@ battle_sprite_cursor_done:
 
   rts
 
+; PROTOTYPE (battle-anim design slice), round 2, findings 4+5+7. Draws the
+; current frame of the running action visual, if any, over its own combatant
+; slot -- the same ex/ey formulas battle_sprite_pc/battle_sprite_mon use.
+; Called from battle_draw_sprites while oam_idx is still zero (see that
+; routine's own comment for why that is what makes this a foreground
+; overlay, not a layer buried behind the icon it plays over).
+;
+; The fit check, round 3 finding 2: this frame's own ms_count must not
+; exceed BATTLE_FX_OAM_ROOM -- a single compiled constant (main/build/
+; generate.js) already computed as `max(0, MAX_OAM_ENTRIES -
+; battleCombatantOamMax(project, mapper))`, i.e. the room left over once the
+; worst-case combatant/cursor draw that follows this one is accounted for.
+; No addition happens here at all -- comparing directly against a
+; pre-subtracted room is simpler and cannot overflow a byte the way adding
+; two byte-sized figures together first could. If the frame does not fit,
+; the WHOLE frame's draw is skipped -- never a partial one -- because
+; draw_metasprite itself has no notion of "how much room is left
+; downstream"; it only wraps oam_idx back to zero on overflow (engine/
+; entities.asm), which would silently let a later combatant's own sprites
+; overwrite this frame's tail instead.
+;
+; This is a real, project-wide STATIC bound, not the current formation's own
+; live count -- it can reject a frame that would actually have fit this
+; particular battle (a smaller-than-worst-case formation), and it rejects
+; that SAME oversized frame on every tick it is current, never only once:
+; an animation whose every frame is too large for its own room is simply
+; never drawn, in any battle, ever, not merely delayed. See §3.6 for the
+; build-time half and the warning this is paired with.
+;
+; This guard protects only the new effect against corrupting what draws
+; after it. It does not retroactively fix a project whose combatants alone
+; (with no effect at all) already exceed 64 -- draw_metasprite's own
+; wrap-to-zero (engine/entities.asm) and the split cursor's own unguarded
+; write (battle_sprite_cursor_done, above) are pre-existing exposure this
+; slice neither created nor repairs.
+  .if BATTLE_ANIM_ENABLED
+battle_fx_draw:
+  ; Round 2, finding 7: the same first-tick reasoning as battle_fx_tick's own
+  ; guard -- bt_fx_anim is not reset for THIS battle until battle_intro's own
+  ; setup_monsters runs, later in this same tick.
+  lda <bt_phase
+  cmp #BP_INTRO
+  beq battle_fx_draw_rts
+  lda <bt_fx_anim
+  cmp #NO_ANIM
+  beq battle_fx_draw_rts
+  tax
+  lda <bt_fx_frame
+  asl a
+  tay
+  lda anim_ptr_lo,x
+  sta <ptr_lo
+  lda anim_ptr_hi,x
+  sta <ptr_hi
+  lda [ptr_lo],y             ; this frame's metasprite id
+  tax                        ; park it -- the animation id in X is done with
+  lda ms_count,x
+  cmp #BATTLE_FX_OAM_ROOM+1
+  bcs battle_fx_draw_rts     ; does not fit alongside what draws after it
+  lda <bt_fx_slot
+  cmp #MAX_PARTY
+  bcs battle_fx_draw_mon
+  lda #BT_PARTY_X
+  sta <de_ex
+  lda <bt_fx_slot
+  asl a
+  asl a
+  asl a
+  asl a
+  asl a                     ; slot * BT_PARTY_STEP
+  clc
+  adc #BT_PARTY_Y
+  sta <de_ey
+  jmp battle_fx_draw_go
+battle_fx_draw_mon:
+  lda #BT_MON_COL*8
+  sta <de_ex
+  lda <bt_fx_slot
+  sec
+  sbc #MAX_PARTY
+  asl a
+  asl a
+  asl a
+  asl a
+  asl a                     ; monster slot * 32 pixels
+  clc
+  adc #BT_MON_ROW*8
+  sta <de_ey
+battle_fx_draw_go:
+  txa                       ; recover the metasprite id
+  jmp draw_metasprite        ; tail call -- its own rts returns to our caller
+battle_fx_draw_rts:
+  rts
+  .endif
+
 bit_mask:
   .db $01,$02,$04,$08,$10,$20,$40,$80
diff --git a/engine/constants.asm b/engine/constants.asm
index f0c08dc..0232247 100644
--- a/engine/constants.asm
+++ b/engine/constants.asm
@@ -453,6 +453,17 @@ bt_wipe_slot = bt_wipe_row+1
 ; chained after bt_wipe_row: this must not move any other symbol's address.
 mus_inst_base = bt_wipe_slot+1
 
+; PROTOTYPE (battle-anim design slice): the one running action visual --
+; bt_fx_anim is an animation id or NO_ANIM (idle), bt_fx_slot the combatant
+; index (0-7) it plays over, bt_fx_frame/bt_fx_timer its own entity_animate-
+; shaped progress. Chained after mus_inst_base, unconditionally, for the
+; identical reason mus_inst_base itself was chained after bt_wipe_slot: a
+; switched-off feature must not move any other symbol's address.
+bt_fx_anim  = mus_inst_base+1
+bt_fx_slot  = bt_fx_anim+1
+bt_fx_frame = bt_fx_slot+1
+bt_fx_timer = bt_fx_frame+1
+
 ; The $10-per-row darken trick reaches solid black in at most this many
 ; subtractions from any starting row; the hold between steps is an engine
 ; constant, not authored -- see OP_FADE below and shared/project.js's
diff --git a/main/build/battletables.js b/main/build/battletables.js
index 94609e0..386dd6f 100644
--- a/main/build/battletables.js
+++ b/main/build/battletables.js
@@ -53,6 +53,10 @@ import {
   projectUsesNameToken,
   projectWithoutNameToken,
   projectWithoutMonsterSpellList,
+  projectUsesBattleAnimation,
+  isPlayableBattleAnimation,
+  projectWithoutBattleAnimation,
+  NO_ANIM,
   statAt,
   ACTOR_BATTLE_DEFAULTS
 } from '../../shared/project.js';
@@ -122,6 +126,21 @@ export function nameTiles(name) {
   return textToTiles(text).tiles;
 }
 
+/**
+ * PROTOTYPE (battle-anim design slice), round 3, finding 5: a one-line call
+ * to the single exported predicate (`isPlayableBattleAnimation`,
+ * shared/project.js) -- not a second, locally-repeated validity rule. That
+ * predicate is itself two hops: `isValidAnimationRef` (in range, not
+ * `NO_ANIM`) AND every frame's own `metaspriteId` also in range (round 3
+ * finding 1's own "second hop" fix) -- so a reference whose animation exists
+ * but whose frames do not compiles to `NO_ANIM` here exactly as an
+ * out-of-range top-level id already did, never a fake metasprite id
+ * `draw_metasprite` (engine/entities.asm) would dereference unchecked.
+ */
+function validAnimId(id, project) {
+  return isPlayableBattleAnimation(id, project) ? id : NO_ANIM;
+}
+
 /**
  * Every table the battle bank needs. Returns assembly source; the caller decides
  * which `.bank` it lands in.
@@ -230,6 +249,18 @@ export function battleTables(project, battleStrings = BATTLE_STRINGS) {
   // One attribute byte tints the monster's whole block, which is why the art is
   // anchored to a 4x4 grid: a block that size lies inside one attribute cell.
   chunks.push(`mon_attr:\n${dbRows(battle((b) => (b.battlePalette ?? ACTOR_BATTLE_DEFAULTS.battlePalette) * 0x55))}`);
+  // PROTOTYPE (battle-anim design slice), round 2 finding 1: which animation
+  // this monster plays over its own combatant slot when it acts. NO_ANIM
+  // when unset OR when the id is stale/out of range -- defense in depth
+  // beside validateProject's own refusal (shared/project.js), since
+  // buildProject compiles whatever project is in hand, not one that has
+  // necessarily passed validation. Same stub-avoidance rule mon_mag/mon_mdef
+  // use above -- emitted only when projectUsesBattleAnimation is true.
+  if (projectUsesBattleAnimation(project)) {
+    chunks.push(
+      `mon_anim_attack:\n${dbRows(battle((b) => validAnimId(b.attackAnim, project)))}`
+    );
+  }
   chunks.push(`mon_name:\n${dbRows(actors.flatMap((actor) => nameTiles(actor.name)), NAME_LIMIT)}`);
 
   // --- items (ITEMS_ENABLED path only) ---------------------------------------
@@ -297,6 +328,15 @@ export function battleTables(project, battleStrings = BATTLE_STRINGS) {
   chunks.push(`spell_element:\n${dbRows(spells.map((spell) => elementIndex(spell.element)))}`);
   chunks.push(`spell_scope:\n${dbRows(spells.map((spell) => scopeIndex(spell.scope)))}`);
   chunks.push(`spell_name:\n${dbRows(spells.flatMap((spell) => nameTiles(spell.name)), NAME_LIMIT)}`);
+  // PROTOTYPE (battle-anim design slice), round 2: which animation this
+  // spell plays when cast -- over the target for a single-target
+  // damage/status spell, over the caster for a heal or an all-target spell
+  // (cast_spell, engine/battleturn.asm, decides which). NO_ANIM when unset
+  // or stale/out of range (round 2 finding 1's own defense-in-depth rule).
+  // Same stub-avoidance rule as mon_anim_attack above.
+  if (projectUsesBattleAnimation(project)) {
+    chunks.push(`spell_anim:\n${dbRows(spells.map((spell) => validAnimId(spell.anim, project)))}`);
+  }
 
   // --- the party ------------------------------------------------------------
   // Stats are pre-computed per level rather than derived at runtime: the engine
@@ -656,6 +696,10 @@ export const NAME_COPY_BATTLE_ALLOWANCE = 43;
 // Re-measured for the zero-page kernel diet: 125 (down from 153).
 export const MONSTER_SPELL_LIST_BATTLE_ALLOWANCE = 125;
 
+// PROTOTYPE (battle-anim design slice): battle_fx_tick/arm/draw plus the two
+// call-site insertions in attack_target and cast_spell -- measured below.
+export const BATTLE_ANIM_BATTLE_ALLOWANCE = 0; // filled in after measurement
+
 // Deliberate headroom, and its job is NOT the job KERNEL_SLACK does. There is
 // no estimation error here for it to absorb -- see the exactness note above --
 // so this is purely a buffer against the stock code growing a byte or two
@@ -932,7 +976,8 @@ export function battleRegionBytes(project, mapper) {
     (projectNeedsNameSeed(project) && banked ? NAME_COPY_BATTLE_ALLOWANCE : 0) +
     (projectUsesMagicPower(project) ? MAGIC_POWER_BATTLE_ALLOWANCE : 0) +
     (projectUsesMagicDefence(project) ? MAGIC_DEFENCE_BATTLE_ALLOWANCE : 0) +
-    (projectUsesMonsterSpellList(project) ? MONSTER_SPELL_LIST_BATTLE_ALLOWANCE : 0)
+    (projectUsesMonsterSpellList(project) ? MONSTER_SPELL_LIST_BATTLE_ALLOWANCE : 0) +
+    (projectUsesBattleAnimation(project) ? BATTLE_ANIM_BATTLE_ALLOWANCE : 0)
   );
 }
 
@@ -1081,6 +1126,10 @@ export function battleShortfallAdvice(project, mapper, deficit, { alternatives =
     if (battleBankEnabled(project, mapper) && projectUsesMonsterSpellList(project)) {
       bankedFeatures.push({ label: "every monster's extra spells", strip: projectWithoutMonsterSpellList });
     }
+    // PROTOTYPE (battle-anim design slice).
+    if (battleBankEnabled(project, mapper) && projectUsesBattleAnimation(project)) {
+      bankedFeatures.push({ label: 'every battle animation reference', strip: projectWithoutBattleAnimation });
+    }
   }
   if (bankedFeatures.length) {
     const bankedBudget = battleRegionBytes(project, mapper);
diff --git a/main/build/generate.js b/main/build/generate.js
index 09027c6..f3554f7 100644
--- a/main/build/generate.js
+++ b/main/build/generate.js
@@ -74,6 +74,9 @@ import {
   projectUsesMagicPower,
   projectUsesMagicDefence,
   projectUsesMonsterSpellList,
+  projectUsesBattleAnimation,
+  battleCombatantOamMax,
+  MAX_OAM_ENTRIES,
   projectUsesSting,
   projectUsesSfx,
   projectUsesAudioFx,
@@ -2611,6 +2614,18 @@ export async function generateAssets({ dir, project, log = () => {} }) {
   // monster_turn's pick-first rewrite (docs/design-monster-spell-list.md
   // §6/§7) -- true iff some actor's battle.spellIds has two or more entries.
   const monsterSpellListEnabled = projectUsesMonsterSpellList(project);
+  // PROTOTYPE (battle-anim design slice): battle_fx_tick/arm/draw.
+  const battleAnimEnabled = projectUsesBattleAnimation(project);
+  // Round 3, finding 2: one generated constant, not a duplicated engine-side
+  // MAX_OAM_ENTRIES equate plus a runtime add. BATTLE_FX_OAM_ROOM is the
+  // room left for the running effect once the worst-case combatant icons
+  // and the split-only cursor have taken their own share --
+  // battle_fx_draw's own fit check (engine/battleui.asm) compares a frame's
+  // ms_count against this single figure directly (`cmp
+  // #BATTLE_FX_OAM_ROOM+1`), no addition and so no byte-overflow question.
+  // Emitted unconditionally (an equate costs nothing unless used, and it is
+  // only ever read inside .if BATTLE_ANIM_ENABLED code).
+  const battleFxOamRoom = Math.max(0, MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper));
 
   // The HUD hearts, stamped after the placeholder check so an empty sprite table
   // is still recognised as empty. Two tiles, and only for a game that can hurt
@@ -3145,6 +3160,9 @@ export async function generateAssets({ dir, project, log = () => {} }) {
     // engine sentinel rather than a project-derived limit.
     `MONSTER_SPELLS = ${RPG_LIMITS.monsterSpells}`,
     `MONSTER_SPELL_LIST_ENABLED = ${monsterSpellListEnabled ? 1 : 0}`,
+    // PROTOTYPE (battle-anim design slice), round 3.
+    `BATTLE_ANIM_ENABLED = ${battleAnimEnabled ? 1 : 0}`,
+    `BATTLE_FX_OAM_ROOM = ${battleFxOamRoom}`,
     ''
   ].join('\n');
   await fs.writeFile(path.join(assetsDir, 'config.inc'), config);
diff --git a/shared/project.js b/shared/project.js
index f90942e..2527e7e 100644
--- a/shared/project.js
+++ b/shared/project.js
@@ -3327,6 +3327,195 @@ export function renumberMetaspriteDeletion(project, index) {
   return project;
 }
 
+/**
+ * PROTOTYPE (battle-anim design slice), round 3, finding 5: the ONE animation
+ * reference validity rule, exported so validation, the generator and the OAM
+ * budget all call the identical predicate rather than each restating it.
+ * Integer, `0 <= id < animations.length`, AND `id < NO_ANIM` -- the last
+ * clause matters independently of catalog length: at exactly 256 authored
+ * animations (LIMITS.animations = NO_ANIM = 255 is the CEILING, so a
+ * catalog can still reach 255 real entries, ids 0-254, but a hand-edited or
+ * foreign project can carry more), `id < animations.length` alone would
+ * treat a reference of 255 as "the last real entry" when the engine's own
+ * `anim_count`/`anim_ptr_lo`/`anim_ptr_hi` tables have no row for it at all
+ * once `NO_ANIM` intervenes -- `spriteTables` (main/build/generate.js) is
+ * generated FROM the same catalog, but nothing enforces the two facts stay
+ * in the same order without this second clause spelled out. `null` is the
+ * only value normalizeSpell/normalizeActor ever write for "no reference";
+ * a numeric 255 can still be *present* as invalid imported or hand-edited
+ * data, and this predicate is what tells that apart from a real id rather
+ * than silently accepting or renumbering it.
+ */
+export function isValidAnimationRef(id, project) {
+  return Number.isInteger(id) && id >= 0 && id < project.sprites.animations.length && id < NO_ANIM;
+}
+
+/**
+ * PROTOTYPE (battle-anim design slice), round 3, finding 1: the "second hop"
+ * round 1 named and round 2 left open. A battle reference (spell.anim,
+ * battle.attackAnim) naming a real, in-range animation is not yet safe to
+ * play -- `draw_metasprite` (engine/entities.asm) dereferences
+ * `ms_count`/`ms_ptr_lo`/`ms_ptr_hi` at whatever `metaspriteId` a frame
+ * names with NO bounds check of its own, and `normalizeAnimation` only
+ * clamps a frame's `metaspriteId` to a byte (0-255), never to
+ * `project.sprites.metasprites.length` (the identical shape `battle.
+ * spellIds`/`battle.attackAnim` are clamped in, left for a second-hop
+ * consumer to police). So a battle reference is only PLAYABLE when every
+ * one of its own frames also names a real metasprite -- checked here, once,
+ * rather than separately by validateProject, the generator and the OAM
+ * budget. An animation with no frames at all (the Sprite Forge's own
+ * no-metasprite-yet shape) is vacuously playable: `battle_fx_arm_at`'s own
+ * `anim_count = 0` check (engine/battleturn.asm) is what actually turns
+ * "playable but empty" into "arms nothing," and this predicate does not
+ * duplicate that decision.
+ *
+ * Deliberately scoped to a BATTLE reference's own animation, not to every
+ * overworld `anims` slot's own animation: `actor_anim_dir`
+ * (main/build/generate.js) and `entity_animate`/`draw_one_entity`
+ * (engine/entities.asm) already carry the identical frame-to-metasprite
+ * exposure today, unrelated to and unwidened by this slice -- see §3.1 for
+ * why that pre-existing hop stays out of scope here rather than being
+ * "fixed" as a side effect of this one.
+ */
+export function isPlayableBattleAnimation(id, project) {
+  if (!isValidAnimationRef(id, project)) return false;
+  const frames = project.sprites.animations[id].frames ?? [];
+  return frames.every(
+    (frame) =>
+      Number.isInteger(frame.metaspriteId) &&
+      frame.metaspriteId >= 0 &&
+      frame.metaspriteId < project.sprites.metasprites.length
+  );
+}
+
+/**
+ * PROTOTYPE (battle-anim design slice), round 2, findings 1+2. Every location
+ * in the project that holds an animation reference -- the single writer for
+ * "which fields hold one," the remapScreenReferences idea (CLAUDE.md's own
+ * "Map organization and reuse" passage) applied to animations. Yields one
+ * `{ get, set, battleOnly, describe }` per field: `get()` reads the current
+ * value (an id, or null for "no reference"), `set(id)` writes it back,
+ * `battleOnly` is true for a field this slice adds (spell.anim,
+ * battle.attackAnim) and false for the pre-existing overworld `anims` slots,
+ * and `describe()` names the field for a validateProject message.
+ *
+ * `renumberAnimationDeletion` and validateProject's own missing-reference
+ * refusal (below) both walk every location regardless of `battleOnly` --
+ * both defects (a silent retarget, a stale reference) are real for an
+ * overworld pose exactly as they are for a battle visual, and this is the
+ * fix for a genuinely pre-existing gap (round 1's own §0 correction 3 named
+ * the schema shape but not this consequence): "Delete animation"
+ * (renderer/forges/sprite/sprite.js:539-543) splices the array and renumbers
+ * `.id` with no fixup at all, acknowledged as a known defect at
+ * shared/project.js:3871-3881 (duplicateActorPaletteSwapCore's own refusal)
+ * and sprite.js:706-710 (paletteSwapDisabledReason). `allBattleAnimationIds`
+ * (battleSpriteBudget's own OAM term) filters this same traversal to
+ * `battleOnly` alone, since an overworld pose's own worst-case tile count is
+ * `reachablePoses`'/`metaspriteScanlineDensity`'s question, not the battle
+ * OAM budget's.
+ *
+ * No field here ever stores a numeric sentinel for "no reference" -- both
+ * new fields and the pre-existing `anims` slots all use `null` -- so unlike
+ * `renumberMetaspriteDeletion`'s own `preserveSentinel` case (an item's
+ * `NO_METASPRITE`), there is nothing here that must NOT shift when a lower
+ * id is deleted: every reference is either `null` or a real, shiftable id.
+ */
+export function* animationReferenceLocations(project) {
+  const actors = project.sprites?.actors ?? [];
+  // Plain indexed for-loops, not .forEach: `yield` cannot cross into a
+  // nested non-generator callback, only through an enclosing loop.
+  for (let actorIndex = 0; actorIndex < actors.length; actorIndex++) {
+    const actor = actors[actorIndex];
+    for (const { id: slot, label } of ANIM_SLOTS) {
+      yield {
+        get: () => actor.anims[slot],
+        set: (id) => {
+          actor.anims[slot] = id;
+        },
+        battleOnly: false,
+        describe: () => `Actor ${actorIndex} ("${actor.name}")'s ${label}`
+      };
+    }
+    if (actor.battle) {
+      yield {
+        get: () => actor.battle.attackAnim,
+        set: (id) => {
+          actor.battle.attackAnim = id;
+        },
+        battleOnly: true,
+        describe: () => `Actor ${actorIndex} ("${actor.name}")'s attack animation`
+      };
+    }
+  }
+  const spells = project.spells ?? [];
+  for (let spellIndex = 0; spellIndex < spells.length; spellIndex++) {
+    const spell = spells[spellIndex];
+    yield {
+      get: () => spell.anim,
+      set: (id) => {
+        spell.anim = id;
+      },
+      battleOnly: true,
+      describe: () => `Spell ${spellIndex} ("${spell.name}")'s cast animation`
+    };
+  }
+}
+
+/**
+ * The single deletion writer for every animation reference, the
+ * `renumberMetaspriteDeletion` shape above applied via the shared traversal:
+ * an exact match becomes `null` ("no reference," the only meaning every one
+ * of these fields has for it), a reference above the deleted index shifts
+ * down by one, `null` is left alone. The caller removes
+ * `project.sprites.animations[index]` itself, before or after calling this --
+ * the same contract `renumberMetaspriteDeletion` documents for its own
+ * caller.
+ */
+/**
+ * MUST be called BEFORE `project.sprites.animations[index]` is spliced out --
+ * unlike `renumberMetaspriteDeletion` above (which never queries the
+ * metasprite array's own length, so either order works), this function's own
+ * validity check (`isValidAnimationRef`) reads `project.sprites.animations.
+ * length`, so calling it after the splice would validate every reference
+ * against the wrong, already-shrunk catalog.
+ *
+ * Round 3, finding 5's own policy: only a reference that is ALREADY valid
+ * against the pre-splice catalog is ever touched. An invalid one (255, an id
+ * past an already over-cap catalog, or anything else `isValidAnimationRef`
+ * rejects) is left exactly as it is -- it stays visibly invalid rather than
+ * being silently decremented into a real, wrong id the way a blind `id > k
+ * -> id - 1` shift would. This is a deliberate behaviour choice for
+ * malformed input, not an oversight: an invalid reference was never
+ * something this function could have made correct by shifting it.
+ */
+export function renumberAnimationDeletion(project, index) {
+  for (const location of animationReferenceLocations(project)) {
+    const id = location.get();
+    if (id === null || id === undefined) continue;
+    if (!isValidAnimationRef(id, project)) continue;
+    if (id === index) location.set(null);
+    else if (id > index) location.set(id - 1);
+  }
+  return project;
+}
+
+/**
+ * PROTOTYPE (battle-anim design slice): every distinct animation id any live
+ * `spell.anim` or `battle.attackAnim` names -- `battleSpriteBudget`'s own
+ * input for the flipbook's worst-case OAM cost (§3.6). Filters
+ * `animationReferenceLocations` to `battleOnly`, never the overworld `anims`
+ * slots, which answer a different question (`reachablePoses`).
+ */
+export function allBattleAnimationIds(project) {
+  const ids = new Set();
+  for (const location of animationReferenceLocations(project)) {
+    if (!location.battleOnly) continue;
+    const id = location.get();
+    if (id !== null && id !== undefined) ids.add(id);
+  }
+  return ids;
+}
+
 // ---------------------------------------------------------------------------
 // Palette-swap an existing sprite (ROADMAP item 8): duplicate an actor with
 // every tile currently painted in one sprite palette slot repainted into
@@ -3605,6 +3794,55 @@ export function describeBattleSpriteWarning(budget) {
   return `A battle could need ${budget.used} sprites at once; the NES can only show ${budget.limit}.`;
 }
 
+/**
+ * PROTOTYPE (battle-anim design slice), round 3, finding 3: a second,
+ * distinct warning from `describeBattleSpriteWarning`'s own -- that one says
+ * the PROJECT as a whole may need more sprites than the NES can show; this
+ * one names WHICH authored battle animation's own frames are large enough
+ * that `battle_fx_draw`'s own conservative fit check (engine/battleui.asm)
+ * will sometimes -- or, for a frame this large on every one of its frames,
+ * ALWAYS -- skip it rather than risk corrupting what draws after it. That
+ * fit check is a project-wide STATIC bound (the worst-case combatant/cursor
+ * figure), not the current formation's own live count, so it can skip a
+ * frame that would genuinely have fit a smaller, real formation, and it
+ * skips that same oversized frame on every tick it is current, not merely
+ * the first. `describeBattleSpriteWarning`'s own text says none of this, so
+ * it is a separate warning rather than a rewritten one -- a project that
+ * authors no battle animation at all triggers only the first, byte-for-byte
+ * unchanged from before this slice existed.
+ *
+ * Returns `null` when no playable battle animation is part of the picture
+ * (a pure combatant/cursor overflow, unrelated to this feature) -- the
+ * caller adds nothing in that case.
+ */
+export function describeBattleAnimationOamWarning(project, mapper) {
+  const combatantMax = battleCombatantOamMax(project, mapper);
+  let worstId = null;
+  let worstTiles = 0;
+  for (const animId of allBattleAnimationIds(project)) {
+    if (!isPlayableBattleAnimation(animId, project)) continue;
+    const tiles = Math.max(
+      0,
+      ...project.sprites.animations[animId].frames.map(
+        (frame) => project.sprites.metasprites[frame.metaspriteId].tiles.length
+      )
+    );
+    if (tiles > worstTiles) {
+      worstTiles = tiles;
+      worstId = animId;
+    }
+  }
+  if (worstId === null) return null;
+  const name = project.sprites.animations[worstId].name;
+  return (
+    `"${name}" (${worstTiles} sprite tiles) plus this project's own worst-case combatants and cursor ` +
+    `(${combatantMax}) would need more than the NES's ${MAX_OAM_ENTRIES} sprites at once, so it will be ` +
+    'skipped in-game whenever it does not fit — even in a battle with real room, since the check is a ' +
+    "project-wide worst case, not this battle's own. Use a smaller animation, or reduce the party/" +
+    'formation/cursor cost elsewhere.'
+  );
+}
+
 /**
  * The project-wide battle OAM figure: party (an RPG's own live members, drawn
  * via each member's explicit `pc_metasprite`), the worst monster formation
@@ -3627,8 +3865,19 @@ export function describeBattleSpriteWarning(budget) {
  * by `checkCapacity` on its own, so computing a battle figure for that
  * project anyway is harmless -- game type alone is the real, single gate.
  */
-export function battleSpriteBudget(project, mapper) {
-  if (project.project?.gameType !== 'rpg') return { used: 0, limit: MAX_OAM_ENTRIES };
+/**
+ * PROTOTYPE (battle-anim design slice), round 2, finding 4: the worst-case
+ * OAM cost of every combatant icon and the split-only targeting cursor --
+ * exactly what `battleSpriteBudget` computed before this slice existed.
+ * Split out because the engine's own `battle_fx_draw` (§3.3) needs this same
+ * figure as a compiled constant (`BATTLE_COMBATANT_OAM_MAX`, generate.js) to
+ * decide, at the moment it draws the running effect FIRST (so it wins sprite
+ * priority over whatever combatant icon it overlaps), whether the effect's
+ * own frame will still leave room for every combatant that draws after it --
+ * the build-time half of the runtime fit check §3.3 performs.
+ */
+export function battleCombatantOamMax(project, mapper) {
+  if (project.project?.gameType !== 'rpg') return 0;
   const actorCount = project.sprites.actors.length;
   const party = project.party.reduce((total, member) => {
     const metasprite = project.sprites.metasprites[member.metaspriteId];
@@ -3637,7 +3886,32 @@ export function battleSpriteBudget(project, mapper) {
   const formations = battleFormations(project, actorCount);
   const monsters = Math.max(0, ...formations.map((formation) => formationSpriteCost(formation, project)));
   const cursor = fontBankSplit(project, mapper) ? 1 : 0;
-  return { used: party + monsters + cursor, limit: MAX_OAM_ENTRIES };
+  return party + monsters + cursor;
+}
+
+export function battleSpriteBudget(project, mapper) {
+  if (project.project?.gameType !== 'rpg') return { used: 0, limit: MAX_OAM_ENTRIES };
+  // PROTOTYPE (battle-anim design slice), round 2, finding 4, corrected round
+  // 3, finding 1: the flipbook's own worst-case frame -- the largest
+  // metasprite any live, PLAYABLE spell.anim/battle.attackAnim reference
+  // ever draws, added once (only one effect plays at a time, never per
+  // formation slot). `isPlayableBattleAnimation` is the identical predicate
+  // the generator and validateProject use, so an invalid reference (a stale
+  // id, or one whose own frames name a missing metasprite) contributes
+  // exactly 0 here -- the same "won't actually play" fact the engine's own
+  // arm-time guard and generator defense already act on, not a separate
+  // guess about what an invalid reference might cost.
+  const fxTiles = Math.max(
+    0,
+    ...[...allBattleAnimationIds(project)]
+      .filter((animId) => isPlayableBattleAnimation(animId, project))
+      .flatMap((animId) =>
+        project.sprites.animations[animId].frames.map(
+          (frame) => project.sprites.metasprites[frame.metaspriteId].tiles.length
+        )
+      )
+  );
+  return { used: battleCombatantOamMax(project, mapper) + fxTiles, limit: MAX_OAM_ENTRIES };
 }
 
 // Every formation the project can reach, from all three sources the engine
@@ -5073,6 +5347,17 @@ function normalizeActor(raw, id, itemCtx = EMPTY_ITEM_CTX) {
       battleW: clamp(battle.battleW, 1, RPG_LIMITS.battleArtTiles, ACTOR_BATTLE_DEFAULTS.battleW),
       battleH: clamp(battle.battleH, 1, RPG_LIMITS.battleArtTiles, ACTOR_BATTLE_DEFAULTS.battleH),
       battlePalette: clamp(battle.battlePalette, 0, LIMITS.palettes - 1, ACTOR_BATTLE_DEFAULTS.battlePalette),
+      // PROTOTYPE (battle-anim design slice): an animation id this monster
+      // plays over its own combatant slot when it attacks or casts. null =
+      // no visual. Not validated against project.sprites.animations.length
+      // here -- normalizeActor has no access to that array, the identical
+      // reason battle.spellIds is clamped to a byte range alone and left for
+      // the generator to drop a stale id to NO_SPELL. mon_anim_attack
+      // (main/build/battletables.js) is the generator-side twin check.
+      attackAnim:
+        Number.isInteger(battle.attackAnim) && battle.attackAnim >= 0 && battle.attackAnim <= 255
+          ? battle.attackAnim
+          : null,
       // Display-only, no compiled reader; clamped to the fixed
       // RPG_LIMITS.maxLevel, not project.rpg.maxLevel -- see docs/design-monster.md §3.
       level: battle.level === null || battle.level === undefined
@@ -5185,7 +5470,13 @@ function normalizeSpell(raw, id) {
     amountMin,
     amountMax,
     element: elementId(raw?.element),
-    scope: SPELL_SCOPES.some((s) => s.id === raw?.scope) ? raw.scope : base.scope
+    scope: SPELL_SCOPES.some((s) => s.id === raw?.scope) ? raw.scope : base.scope,
+    // PROTOTYPE (battle-anim design slice): an animation id played when this
+    // spell is cast -- over the target or the caster, decided by cast_spell
+    // (engine/battleturn.asm) from the spell's own kind/scope, not by this
+    // field. null = no visual. Same clamp-to-byte-range-only discipline as
+    // battle.attackAnim above.
+    anim: Number.isInteger(raw?.anim) && raw.anim >= 0 && raw.anim <= 255 ? raw.anim : null
   };
 }
 
@@ -6129,6 +6420,30 @@ export function projectUsesMonsterSpellList(project) {
   return (project.sprites?.actors ?? []).some((actor) => (actor.battle?.spellIds?.length ?? 0) >= 2);
 }
 
+/**
+ * PROTOTYPE (battle-anim design slice): whether any monster's own attack
+ * visual or any spell's own cast visual is authored at all -- true iff some
+ * actor's battle.attackAnim or some spell's own anim field is set. Off on
+ * every project that has never authored one, the identical shape
+ * projectUsesMonsterSpellList already takes for BATTLE_ANIM_ENABLED.
+ */
+export function projectUsesBattleAnimation(project) {
+  if ((project.spells ?? []).some((spell) => spell.anim !== null && spell.anim !== undefined)) return true;
+  return (project.sprites?.actors ?? []).some(
+    (actor) => actor.battle?.attackAnim !== null && actor.battle?.attackAnim !== undefined
+  );
+}
+
+/** The battleShortfallAdvice removal candidate for the battle-anim slice. */
+export function projectWithoutBattleAnimation(project) {
+  const clone = structuredClone(project);
+  for (const spell of clone.spells ?? []) spell.anim = null;
+  for (const actor of clone.sprites?.actors ?? []) {
+    if (actor.battle) actor.battle.attackAnim = null;
+  }
+  return clone;
+}
+
 export function validateProject(project) {
   const problems = [];
   const add = (severity, where, message) => problems.push({ severity, where, message });
@@ -6837,6 +7152,83 @@ export function validateProject(project) {
     );
   }
 
+  // PROTOTYPE (battle-anim design slice), round 4: checked FIRST, before
+  // either reference-specific list below -- a fact about the project as a
+  // whole, not about any one reference, and there is no early return, so a
+  // 256-entry catalog whose reference 255 is ALSO present reports both this
+  // error and the bad-reference error below, in that order. The
+  // `LIMITS.actors`/`LIMITS.items`/`LIMITS.metasprites` sibling above
+  // applied to `LIMITS.animations` -- ordinarily unreachable (the Sprite
+  // Forge's own Add button stops at the ceiling), but a project written by
+  // a later version, or a hand-edited one, can still carry more.
+  if (project.sprites.animations.length > LIMITS.animations) {
+    add(
+      'error',
+      'Sprite Forge',
+      `This project has ${project.sprites.animations.length} animations but the Forge holds ` +
+        `${LIMITS.animations} (ids 0-${LIMITS.animations - 1}) — id $FF is reserved to mean “no ` +
+        `animation”. Delete ${project.sprites.animations.length - LIMITS.animations} of them before this ` +
+        'can build.'
+    );
+  }
+
+  // PROTOTYPE (battle-anim design slice), round 2 finding 1, round 3 finding
+  // 5: the identical fatal-reference precedent applied to an animation id --
+  // `spriteTables` (main/build/generate.js) emits `max(1, animations.length)`
+  // count/pointer entries, not one per possible byte value, so an id at or
+  // past `animations.length`, or the `NO_ANIM` sentinel itself, is a real
+  // out-of-bounds table read at runtime, not a harmless stub. Walks the
+  // single shared traversal so this refusal and `renumberAnimationDeletion`
+  // can never disagree about which fields hold a reference; the validity
+  // rule itself is `isValidAnimationRef`, the one exported predicate the
+  // generator and the OAM budget also call, so none of the three can drift.
+  const badAnimationRefs = [];
+  for (const location of animationReferenceLocations(project)) {
+    const id = location.get();
+    if (id === null || id === undefined) continue;
+    if (!isValidAnimationRef(id, project)) {
+      badAnimationRefs.push(location.describe());
+    }
+  }
+  if (badAnimationRefs.length) {
+    add(
+      'error',
+      'Sprite Forge',
+      `${badAnimationRefs.length} animation reference${badAnimationRefs.length === 1 ? '' : 's'} ` +
+        `(${badAnimationRefs.join(', ')}) do${badAnimationRefs.length === 1 ? 'es' : ''} not name a real ` +
+        'animation. Pick one or clear it.'
+    );
+  }
+
+  // PROTOTYPE (battle-anim design slice), round 3, finding 1: the "second
+  // hop" -- a battle reference (spell.anim/battle.attackAnim) may name a
+  // real, in-range animation whose own frames name a metasprite that does
+  // not exist. draw_metasprite (engine/entities.asm) checks nothing before
+  // dereferencing ms_count/ms_ptr_lo/ms_ptr_hi at whatever a frame names, so
+  // this is the identical severity the top-level check above already uses,
+  // not a softer warning. Scoped to `battleOnly` locations alone -- the
+  // pre-existing overworld `anims` exposure is real but out of scope for
+  // this slice (§3.1 states why).
+  const unplayableBattleAnims = [];
+  for (const location of animationReferenceLocations(project)) {
+    if (!location.battleOnly) continue;
+    const id = location.get();
+    if (id === null || id === undefined) continue;
+    if (isValidAnimationRef(id, project) && !isPlayableBattleAnimation(id, project)) {
+      unplayableBattleAnims.push(location.describe());
+    }
+  }
+  if (unplayableBattleAnims.length) {
+    add(
+      'error',
+      'Sprite Forge',
+      `${unplayableBattleAnims.length} battle animation${unplayableBattleAnims.length === 1 ? '' : 's'} ` +
+        `(${unplayableBattleAnims.join(', ')}) ${unplayableBattleAnims.length === 1 ? 'names' : 'name'} an ` +
+        'animation with a frame that does not name a real metasprite. Fix the animation in the Sprite Forge ' +
+        'or pick a different one.'
+    );
+  }
+
   // A Sting naming nothing, or a song since deleted, is the Give/Take shape (itemMissing above),
   // not music's own silent-NO_SONG-for-Silence shape -- Silence is a legitimate `music` choice,
   // but there is no silence-equivalent sting, so NO_SONG here can only mean "never picked" or
@@ -7067,6 +7459,11 @@ export function validateProject(project) {
   const battleBudget = battleSpriteBudget(project, artworkMapper);
   if (battleBudget.used > battleBudget.limit) {
     add('warning', 'Build', describeBattleSpriteWarning(battleBudget));
+    // PROTOTYPE (battle-anim design slice), round 3, finding 3: a second,
+    // distinct warning -- see describeBattleAnimationOamWarning's own
+    // comment for why this is not folded into the one above.
+    const animWarning = describeBattleAnimationOamWarning(project, artworkMapper);
+    if (animWarning) add('warning', 'Monster Forge', animWarning);
   }
 
   return problems;
```

`BATTLE_ANIM_BATTLE_ALLOWANCE`'s own placeholder value in this diff (`0`, unless already updated by
a prior round's own hand-edit still present in the scratch copy) is disclosed, not an undisclosed
measurement error — §3.5 states the real measured figure (243) a real implementation would write
there instead; the measurement itself comes from nesasm's own bank-usage line, never from reading
this constant back.

**This is the measured prototype, not evidence that the complete phase-1a integration was
exercised** (round 3, finding 6's own correction to round 2's own Appendix A framing): the Sprite
Forge's "Delete animation" handler calling `renumberAnimationDeletion` before its own splice is
specified in full in §3.1, but this diff — being an engine/generator/schema prototype built to
measure banked-region bytes — does not itself touch `renderer/forges/sprite/sprite.js`, so that
particular wiring is not exercised by anything reported in this appendix.

## Appendix B — sprite hit-blink prototype (phase 2, candidate (e), measured)

Rebuilt on top of the round-3 phase-1 checkpoint (i.e. this diff is *in addition to* Appendix A's
own changes, not a replacement for them), measured, then reverted — not part of the phase-1
mechanism this design ships. This is the real, complete diff that produced §2(e)'s own 50-byte
figure. Prototype limitations: see §2(e).

```diff
diff --git a/engine/battle.asm b/engine/battle.asm
index 93546bf..1956392 100644
--- a/engine/battle.asm
+++ b/engine/battle.asm
@@ -235,9 +235,20 @@ battle_tick:
   .if BATTLE_ANIM_ENABLED
   jsr battle_fx_tick
   .endif
+  jsr battle_hurt_tick      ; PROTOTYPE, phase-2 candidate (e) measurement only
   jsr battle_dispatch
   jmp battle_draw_sprites
 
+; PROTOTYPE, phase-2 candidate (e) measurement ONLY (Appendix B) -- ticks the
+; sprite hit-blink's own countdown. Unconditional (no feature gate) since
+; this is a throwaway cost measurement, never shipped as-is.
+battle_hurt_tick:
+  lda <bt_hurt_left
+  beq battle_hurt_tick_rts
+  dec <bt_hurt_left
+battle_hurt_tick_rts:
+  rts
+
 ; A dying monster's own block wipe is budgeted at one row a frame (see
 ; bt_wipe_mask/bt_wipe_row/bt_wipe_slot, engine/constants.asm): four dead
 ; monsters in the same tick used to queue wipe_monster's whole four-row sweep
diff --git a/engine/battleturn.asm b/engine/battleturn.asm
index 231dc9f..b174578 100644
--- a/engine/battleturn.asm
+++ b/engine/battleturn.asm
@@ -975,6 +975,14 @@ spell_damage_done:
 
 ; Take bt_dmg_lo off bt_target, and note if that finished it.
 apply_damage:
+  ; PROTOTYPE, phase-2 candidate (e) measurement ONLY (Appendix B) -- not
+  ; part of the phase-1 mechanism this design ships. One choke point arms
+  ; the blink for every landed hit, since apply_damage is the single place
+  ; both a physical attack and a spell's own damage roll converge.
+  lda <bt_target
+  sta <bt_hurt_slot
+  lda #BT_HURT_FRAMES
+  sta <bt_hurt_left
   lda <bt_target
   cmp #MAX_PARTY
   bcs apply_damage_mon
diff --git a/engine/battleui.asm b/engine/battleui.asm
index b527946..b289c92 100644
--- a/engine/battleui.asm
+++ b/engine/battleui.asm
@@ -870,6 +870,18 @@ battle_sprite_pc:
   beq battle_sprite_pc_next
   lda pc_hp,x
   beq battle_sprite_pc_next ; a fallen member is not drawn
+  ; PROTOTYPE, phase-2 candidate (e) measurement ONLY (Appendix B): skip the
+  ; icon on alternate frames while this combatant is blinking from a landed
+  ; hit -- ent_hurt's own trick (engine/entities.asm), extended to
+  ; combatants.
+  lda <bt_hurt_left
+  beq battle_sprite_pc_draw
+  cpx <bt_hurt_slot
+  bne battle_sprite_pc_draw
+  lda <bt_hurt_left
+  and #2
+  bne battle_sprite_pc_next
+battle_sprite_pc_draw:
   lda pc_metasprite,x
   cmp #$FF
   beq battle_sprite_pc_next
@@ -900,6 +912,19 @@ battle_sprite_mon:
   lda mon_tile,y
   cmp #$FF
   bne battle_sprite_mon_next ; it has block art, already on the background
+  ; PROTOTYPE, phase-2 candidate (e) measurement ONLY (Appendix B): the
+  ; identical skip, combatant index = monster slot + MAX_PARTY.
+  lda <bt_hurt_left
+  beq battle_sprite_mon_draw
+  txa
+  clc
+  adc #MAX_PARTY
+  cmp <bt_hurt_slot
+  bne battle_sprite_mon_draw
+  lda <bt_hurt_left
+  and #2
+  bne battle_sprite_mon_next
+battle_sprite_mon_draw:
   lda #BT_MON_COL*8
   sta <de_ex
   txa
diff --git a/engine/constants.asm b/engine/constants.asm
index 0232247..fbaee78 100644
--- a/engine/constants.asm
+++ b/engine/constants.asm
@@ -464,6 +464,14 @@ bt_fx_slot  = bt_fx_anim+1
 bt_fx_frame = bt_fx_slot+1
 bt_fx_timer = bt_fx_frame+1
 
+; PROTOTYPE, phase-2 candidate (e) measurement ONLY (Appendix B) -- not part
+; of the phase-1 mechanism this design ships. bt_hurt_slot/bt_hurt_left are
+; the sprite hit-blink's own state, chained after bt_fx_timer the identical
+; way.
+bt_hurt_slot = bt_fx_timer+1
+bt_hurt_left = bt_hurt_slot+1
+BT_HURT_FRAMES = 20
+
 ; The $10-per-row darken trick reaches solid black in at most this many
 ; subtractions from any starting row; the hold between steps is an engine
 ; constant, not authored -- see OP_FADE below and shared/project.js's
```

## Appendix C — block-art attribute-flash prototype (phase 2, candidate (e), measured)

**Round 4, finding 1: this supersedes round 3's own Appendix C in full, not appended to.** Round
3's own version loaded and stored `bt_hurt_left` but never decremented it, so `20 & 2 = 0` selected
the authored `mon_attr` on every tick and the flash branch was dead code — it re-queued the original
attribute forever rather than flashing, and never terminated. This version fixes both: the countdown
now actually runs (unconditionally, every tick it is armed, whether the current target is a party
member or a monster — round 3's own version also returned before decrementing at all for a party
target, a second, related gap), and the terminal tick forces a restoration write of the authored
tint regardless of blink parity, so the cell is left correctly restored, not wherever the parity
last happened to land, and no further packets are ever queued once the count reaches zero.

Rebuilt on top of the identical round-3/round-4 phase-1 checkpoint (independently of Appendix B —
the two were never built together, so their combined cost is reasoned, not measured; see §2(e)'s
own closing paragraph and §11), measured, then reverted. This is the real, complete diff that
produced §2(e)'s own 76-byte figure, fired as a packet every tick while armed (§2(e)'s own
"packet-every-tick prototype" label) — 4 bytes more than round 3's own broken 72-byte figure, for a
real `dec` plus the terminal-tick restoration check. §2(e)'s own closing note has the real trace
(a run, not a re-derivation) confirming this version actually flashes and restores. Prototype
limitations: see §2(e).

```diff
diff --git a/engine/battle.asm b/engine/battle.asm
index 93546bf..e30fae5 100644
--- a/engine/battle.asm
+++ b/engine/battle.asm
@@ -235,9 +235,73 @@ battle_tick:
   .if BATTLE_ANIM_ENABLED
   jsr battle_fx_tick
   .endif
+  jsr battle_attr_blink_tick ; PROTOTYPE, phase-2 candidate (e) measurement only
   jsr battle_dispatch
   jmp battle_draw_sprites
 
+; PROTOTYPE, phase-2 candidate (e) measurement ONLY (Appendix C), round 4
+; (fixes review-3's own finding 1: round 3's version loaded and stored
+; bt_hurt_left but never counted it down, so `20 & 2 = 0` picked the
+; authored tint every tick and the flash branch was dead code -- this
+; version is a genuine standalone timed flash).
+;
+; Ticks bt_hurt_left down unconditionally, every frame it is armed,
+; regardless of whether the current target is a party member or a monster
+; (round 4's own second fix -- the round-3 version returned BEFORE
+; decrementing for a party target, so the timer never advanced at all for
+; as long as the last-hit combatant was a party member). Only a monster
+; target has an attribute cell to write; a party target still counts down,
+; it simply has nothing to queue.
+;
+; The terminal tick (the one on which the countdown reaches exactly 0) is
+; a forced restoration: it queues the AUTHORED mon_attr byte regardless of
+; the blink parity, guaranteeing the cell is left in its authored state
+; when the effect ends, not wherever the parity last happened to land.
+; Every tick after that, bt_hurt_left reads 0 and the routine returns
+; immediately -- no further packets are ever queued until the next hit
+; re-arms it.
+battle_attr_blink_tick:
+  lda <bt_hurt_left
+  beq battle_attr_blink_rts
+  dec <bt_hurt_left
+  lda <bt_hurt_slot
+  cmp #MAX_PARTY
+  bcc battle_attr_blink_rts    ; a party member has no attribute cell --
+                                ; still counts down, nothing to draw
+  sec
+  sbc #MAX_PARTY
+  tax
+  lda mon_slot_actor,x
+  sta <bt_tmp2                 ; the actor id, while the offset is computed
+  txa
+  clc
+  adc #1
+  asl a
+  asl a
+  asl a
+  clc
+  adc #1                        ; draw_battle_attr's own per-monster offset
+  clc
+  adc #$C0
+  tay
+  lda #$23
+  jsr vram_open
+  lda <bt_hurt_left
+  beq battle_attr_blink_restore ; the terminal tick -- force the authored tint
+  and #2
+  bne battle_attr_blink_flash
+battle_attr_blink_restore:
+  ldy <bt_tmp2
+  lda mon_attr,y
+  jmp battle_attr_blink_push
+battle_attr_blink_flash:
+  lda #$FF
+battle_attr_blink_push:
+  jsr vram_push
+  jmp vram_end
+battle_attr_blink_rts:
+  rts
+
 ; A dying monster's own block wipe is budgeted at one row a frame (see
 ; bt_wipe_mask/bt_wipe_row/bt_wipe_slot, engine/constants.asm): four dead
 ; monsters in the same tick used to queue wipe_monster's whole four-row sweep
diff --git a/engine/battleturn.asm b/engine/battleturn.asm
index 6dbc0f1..230377d 100644
--- a/engine/battleturn.asm
+++ b/engine/battleturn.asm
@@ -978,6 +978,14 @@ spell_damage_done:
 
 ; Take bt_dmg_lo off bt_target, and note if that finished it.
 apply_damage:
+  ; PROTOTYPE, phase-2 candidate (e) measurement ONLY (Appendix C) -- not
+  ; part of the phase-1 mechanism this design ships. One choke point arms
+  ; the blink for every landed hit. Round 4: this is a real, TIMED arm --
+  ; battle_attr_blink_tick (below) now actually counts this down.
+  lda <bt_target
+  sta <bt_hurt_slot
+  lda #BT_HURT_FRAMES
+  sta <bt_hurt_left
   lda <bt_target
   cmp #MAX_PARTY
   bcs apply_damage_mon
diff --git a/engine/constants.asm b/engine/constants.asm
index 0232247..ace53ab 100644
--- a/engine/constants.asm
+++ b/engine/constants.asm
@@ -464,6 +464,14 @@ bt_fx_slot  = bt_fx_anim+1
 bt_fx_frame = bt_fx_slot+1
 bt_fx_timer = bt_fx_frame+1
 
+; PROTOTYPE, phase-2 candidate (e) measurement ONLY (Appendix C) -- not part
+; of the phase-1 mechanism this design ships. bt_hurt_slot/bt_hurt_left are
+; the block-art attribute-flash's own state, chained after bt_fx_timer the
+; identical way.
+bt_hurt_slot = bt_fx_timer+1
+bt_hurt_left = bt_hurt_slot+1
+BT_HURT_FRAMES = 20
+
 ; The $10-per-row darken trick reaches solid black in at most this many
 ; subtractions from any starting row; the hold between steps is an engine
 ; constant, not authored -- see OP_FADE below and shared/project.js's
```

## Appendix D — the phase-2 shippable prototype's full diff (hit feedback + MISS, measured, round 1 fixes applied)

Supersedes the round-1-reviewed version of this appendix in full — this is the SAME measurement
methodology (a `git worktree add --detach` scratch copy on top of the phase 1b checkpoint,
`c4e67c8`, unconditional, no `.if` gate), rebuilt with every round-1 correctness fix (findings 1, 2,
7) applied, and remeasured. Appendix B and Appendix C remain in this document as the historical
record of the two standalone, never-shipped measurement prototypes §2(e) originally costed, and as
the source of the limitations list this design closes; they are not what ships.

Built at `/tmp/claude-1000/-home-chris-nes-game-forge/d294e3d1-9b11-4aa3-ad94-a9ae53720915/scratchpad/
phase2-fix1`, measured with `buildProject` against `sample-rpg` on all three RPG-capable boards
(both `renamable` flags forced off, `test/unit/bankedbytes.test.js`'s own `measureRegion`
convention) via the identical methodology `test/unit/bankedbytes.test.js` itself uses (parsing
nesasm's own `BANK N used/free` line for the banked battle region). The diff below was saved
(`git diff -- engine/`) BEFORE the worktree was removed, so it is exactly the code that produced
every figure in this appendix and in §12.7/§13.6 — not reconstructed afterward. The worktree and its
two isolated-measurement copies (`phase2-fix1-hurtonly`, `phase2-fix1-missonly`, each built by
mechanically stripping the other half's own lines from a copy of this exact diff, verified by
`grep`ing each stripped copy for the removed symbols before building) were all removed afterward;
`git worktree list`/`git status --short` on the main tree confirmed clean.

| board (RPG-capable) | region used, off | region used, on (combined) | delta |
|---|---|---|---|
| MMC1 (mapper 1) | 4294 | 4661 | 367 |
| MMC3 (mapper 4) | 4334 | 4701 | 367 |
| UNROM 512 (mapper 30) | 4294 | 4661 | 367 |

**367 bytes, flat, on all three boards** — up from the pre-round-1 combined figure of 330; both
§12.7 (hit feedback alone, 235, up from 204) and §13.9 (MISS alone, 134, up from 128) are measured
against this same rebuilt diff. See §11's own bullet for the exact, now-identified 2-byte gap
between 235+134=369 and this real combined figure (round 1 finding 8: the shared `lda #0` in
`setup_monsters`). Unconditional (no `.if` gate) throughout, the identical measurement-only shape
Appendix A/B/C already used.

**v5.1 note — read this 367 figure as the frozen shared-load prototype measurement, two bytes below
the selected independently-gated layout, not as its combined ledger figure.** (Round 5 correction:
367 is smaller than 369, so it cannot be described as an upper bound on it — the prior wording here
had the direction backwards.) This diff still measures ONE unconditional
build sharing a single `lda #0` between both timer resets, the shape a single combined toggle would
have kept. Chris's own answer 2 (§10) chose two INDEPENDENT toggles instead
(`HIT_FEEDBACK_ENABLED`/`MISS_ENABLED`, §12.7/§13.9), and the v5.1 ledger decision (§12.7/§13.9,
option (i)) is to separate that shared load into two independently-gated resets rather than keep it
behind an interaction term — so the real shipped both-on total is **369**, not this diff's own 367;
the 2-byte difference is exactly the shared-load saving this diff still contains and the real
implementation deliberately gives up for gate independence. Hit-feedback-alone (235) and MISS-alone
(134) are UNAFFECTED by this — each isolated variant already paid its own full `lda #0` (§11's own
bullet), so only the combined figure moves. The implementation phases for 2a and 2b must each build
and measure their own `.if`-gated code for real, with `bankedbytes.test.js` equality assertions on
MMC1, MMC3 and UNROM 512 (including the both-on case) — this diff is not a substitute for that
measurement once two real, independent flags exist, only for the single-flag design this document
no longer recommends.

Round 1 findings this diff fixes, restated as a checklist against the code below:

- **P1 finding 1** — `battle_hurt_attr_open` no longer writes `bt_tmp2` (or any shared scratch byte)
  at all; callers that need the actor id re-read `mon_slot_actor,x` themselves, since `X` (the
  monster slot) survives the call untouched. `cast_all`'s own end-of-side sentinel is never touched
  by any routine in this diff.
- **P2 finding 2** — a monster that dies while flashing has its attribute cell force-restored to
  `BT_GROUND_ATTR` ($55), on two paths: `battle_hurt_tick`'s own dead-check (the common case), and
  `battle_hurt_restore_slot`'s own arm-time check (the case where a different target supersedes the
  shared pair before the tick routine gets another chance at the dead one).
- **P2 finding 3** — no code change was needed; §12.6 recomputes the `vram_buf` bound analytically
  against this same diff's own packet-producing call sites (the tick routine's one packet, and up to
  four arm-time restores from an all-target spell's own `cast_all` loop).
- **P2 finding 4** — no code change; §13.6 states the MISS OAM-overflow policy as an accepted
  limitation, matching §3.6's own established precedent for the flipbook's combatant/cursor figure.
- **P2 finding 5** — no engine code change; §13.5 redesigns the JS-side single authority and the two
  UI consumers that need to become range-aware, neither of which is part of this ASM prototype.
- **P2 finding 6** — no code change; §13.1/§14 record the exclusions and the real test coverage.
- **P3 finding 7** — `battle_hurt_tick`/`battle_miss_tick` both gained a `BP_INTRO` guard, matching
  `battle_fx_tick`'s own existing one.
- **P3 finding 8** — no code change; §11/§12.7/§13.4 now explain the 2-byte measurement gap exactly
  (the shared `lda #0` in `setup_monsters`) instead of attributing it to alignment noise, and §13.2
  documents the `bt_miss_slot` re-chaining every isolated-MISS measurement needs.
- **P3 finding 9** — no code change (the `and #2` cadence was already correct); §12.1 corrects the
  PROSE that mis-described it as single-tick alternation.

**Round 3 finding 5 — a note on this frozen diff's own prototype comment.** `battle_miss_draw`'s own
header comment below still reads "This mechanism neither causes nor repairs that pre-existing
exposure" (round 1's own wording, when the design believed MISS made no genuine difference to a
combatant-only overflow either way). This diff is the exact, byte-identical patch that produced
every figure in §12.7/§13.6, and is kept frozen rather than hand-edited to match later prose
corrections — so that comment is NOT touched here. **It is superseded by §13.6's own corrected
explanation** (round 3 finding 5): MISS's own fixed cost is a real, additional OAM consumer in
every case, not one that "neither causes nor repairs" anything — it can newly introduce overflow in
a project whose combatants alone sit at 61-64, and it increases the real exposure of a project
already past 64 (65 becomes 69), even though the boolean warning-fires/does-not-fire answer differs
between those two cases. Treat §13.6, not this comment, as the current statement of the policy.

```diff
diff --git a/engine/battle.asm b/engine/battle.asm
index 93546bf..efec7f6 100644
--- a/engine/battle.asm
+++ b/engine/battle.asm
@@ -235,9 +235,137 @@ battle_tick:
   .if BATTLE_ANIM_ENABLED
   jsr battle_fx_tick
   .endif
+  jsr battle_hurt_tick      ; PROTOTYPE, phase-2 measurement only
+  jsr battle_miss_tick      ; PROTOTYPE, phase-2 measurement only
   jsr battle_dispatch
   jmp battle_draw_sprites
 
+; PROTOTYPE, phase-2 design measurement ONLY (docs/design-battle-animation.md
+; v6) -- ticks the shared hit-feedback pair. Guarded on BP_INTRO the
+; identical reason battle_fx_tick already is (round 1 finding 7): this runs
+; before battle_dispatch on every tick, including the very first one of a
+; fresh battle, where bt_phase is still genuinely BP_INTRO and neither
+; bt_hurt_left nor bt_miss_left has been reset yet for this battle --
+; setup_monsters (below) is reached only through battle_dispatch ->
+; battle_intro, later the same tick.
+;
+; Which of the two hit-feedback halves applies is decided here, every
+; tick, from what bt_hurt_slot currently names:
+;   - a party member, or a metasprite-fallback monster (mon_tile == $FF):
+;     nothing to queue -- battle_sprite_pc/battle_sprite_mon read
+;     bt_hurt_slot/bt_hurt_left directly at draw time and skip the icon on
+;     alternate frames.
+;   - a block-art monster (mon_tile != $FF): the attribute-flash half.
+;
+; Round 1 finding 2: if the named monster has died since it was armed
+; (mon_slot_alive == 0), this is the LAST chance to fix its attribute cell
+; before the shared state moves on to a different slot -- wipe_tick
+; (engine/battleturn.asm) only ever rewrites that monster's own TILES, one
+; row a frame; it never touches the attribute byte at all, so whatever
+; this mechanism last queued for that cell (the flash tint, $FF, or the
+; monster's own authored tint) would otherwise sit there, uncorrected, on
+; top of the wiped ground, for the rest of the battle. Fixed by forcing one
+; last packet: BT_GROUND_ATTR ($55, draw_battle_attr's own ground-row
+; fill), never the dead monster's own now-meaningless mon_attr.
+battle_hurt_tick:
+  lda <bt_phase
+  cmp #BP_INTRO
+  beq battle_hurt_tick_rts
+  lda <bt_hurt_left
+  beq battle_hurt_tick_rts
+  lda <bt_hurt_slot
+  cmp #MAX_PARTY
+  bcc battle_hurt_tick_dec       ; a party member -- nothing to queue, just tick
+  sec
+  sbc #MAX_PARTY
+  tax
+  lda mon_slot_alive,x
+  bne battle_hurt_tick_dec
+  lda #0
+  sta <bt_hurt_left               ; stop ticking regardless of block art
+  lda mon_slot_actor,x
+  tay
+  lda mon_tile,y
+  cmp #$FF
+  beq battle_hurt_tick_rts        ; no block art -- nothing to restore
+  jsr battle_hurt_attr_open        ; X = monster slot, preserved
+  lda #BT_GROUND_ATTR
+  jsr vram_push
+  jmp vram_end
+battle_hurt_tick_dec:
+  dec <bt_hurt_left
+  lda <bt_hurt_slot
+  cmp #MAX_PARTY
+  bcc battle_hurt_tick_rts        ; party member: sprite blink only, done
+  sec
+  sbc #MAX_PARTY
+  tax
+  lda mon_slot_actor,x
+  tay
+  lda mon_tile,y
+  cmp #$FF
+  beq battle_hurt_tick_rts        ; metasprite fallback -- sprite blink only
+  jsr battle_hurt_attr_open       ; X = monster slot, preserved
+  lda mon_slot_actor,x            ; re-read (X survives the call); Y was
+  tay                             ; clobbered by battle_hurt_attr_open itself
+  lda <bt_hurt_left
+  beq battle_hurt_attr_restore
+  and #2
+  bne battle_hurt_attr_flash
+battle_hurt_attr_restore:
+  lda mon_attr,y
+  jmp battle_hurt_attr_push
+battle_hurt_attr_flash:
+  lda #$FF
+battle_hurt_attr_push:
+  jsr vram_push
+  jmp vram_end
+battle_hurt_tick_rts:
+  rts
+
+; X = monster slot. Opens vram_buf at that monster's own anchored
+; attribute cell (draw_battle_attr's own per-monster offset). The address
+; math is a pure function of the slot number (X), never the actor id, so
+; this never needs to park anything in shared scratch to do its own job --
+; round 1 finding 1's fix: the previous version stashed the actor id in
+; bt_tmp2 so its caller could read mon_attr,y afterward, but bt_tmp2 is
+; cast_all's own end-of-side sentinel across the whole apply_damage call
+; this chain is nested inside, and cast_all is UNAWARE this routine ever
+; runs. X itself survives the call (never touched here after the address
+; math begins, and vram_open its own self saves/restores X internally) --
+; callers that need the actor id re-read mon_slot_actor,x themselves once
+; this returns, at no cost, rather than trust a value parked here. Clobbers
+; A, Y.
+battle_hurt_attr_open:
+  txa
+  clc
+  adc #1
+  asl a
+  asl a
+  asl a
+  clc
+  adc #1
+  clc
+  adc #$C0
+  tay
+  lda #$23
+  jmp vram_open
+
+; PROTOTYPE, phase-2 design measurement ONLY -- ticks the independent MISS
+; overlay's own countdown. Guarded on BP_INTRO for the identical reason
+; battle_hurt_tick is (round 1 finding 7). No vram_buf work: MISS is
+; sprite-drawn (see battle_miss_draw, engine/battleui.asm), so ticking it
+; costs nothing but the countdown itself.
+battle_miss_tick:
+  lda <bt_phase
+  cmp #BP_INTRO
+  beq battle_miss_tick_rts
+  lda <bt_miss_left
+  beq battle_miss_tick_rts
+  dec <bt_miss_left
+battle_miss_tick_rts:
+  rts
+
 ; A dying monster's own block wipe is budgeted at one row a frame (see
 ; bt_wipe_mask/bt_wipe_row/bt_wipe_slot, engine/constants.asm): four dead
 ; monsters in the same tick used to queue wipe_monster's whole four-row sweep
@@ -351,6 +479,19 @@ setup_monsters:
   lda #NO_ANIM
   sta <bt_fx_anim           ; no effect carries in from a previous battle
   .endif
+  ; PROTOTYPE, phase-2 measurement only -- a fresh battle must not inherit
+  ; a countdown, or a slot, left over from the previous one (neither is
+  ; cleared by battle_end or player_died -- see the design's own §12.4/
+  ; §13.4 for why that is safe now that battle_hurt_tick/battle_miss_tick
+  ; both guard on BP_INTRO). A cannot be trusted to still be 0 here: the
+  ; block above only runs .if BATTLE_ANIM_ENABLED, and when it does it
+  ; leaves NO_ANIM ($FF) in A, not 0. Round 1 finding 8: this ONE lda #0
+  ; is shared between both stores below -- stripping either byte in
+  ; isolation still needs it, so it is not itself evidence of a designed
+  ; saving, only of amortizing one shared load over two stores.
+  lda #0
+  sta <bt_hurt_left
+  sta <bt_miss_left
   ldx #0
 setup_monsters_slot:
   lda #0
diff --git a/engine/battleturn.asm b/engine/battleturn.asm
index 4289aa9..3fe1573 100644
--- a/engine/battleturn.asm
+++ b/engine/battleturn.asm
@@ -273,11 +273,24 @@ attack_target:
   lda #BS_HITS
   jmp battle_say_actor
 attack_missed:
+  jsr battle_miss_arm        ; PROTOTYPE, phase-2 measurement only
   lda #$FF
   sta <bt_dmg_hi             ; no number on this line
   lda #BS_MISSES
   jmp battle_say_actor
 
+; PROTOTYPE, phase-2 design measurement ONLY -- the MISS overlay's own arm
+; point, called from both miss branches (attack_missed above,
+; monster_missed below). bt_target already names who dodged at both call
+; sites -- roll_hit's own comment: "an underflow is a miss" -- so this
+; needs no argument.
+battle_miss_arm:
+  lda <bt_target
+  sta <bt_miss_slot
+  lda #BT_MISS_FRAMES
+  sta <bt_miss_left
+  rts
+
 ; Battle-side animation (docs/design-battle-animation.md §3.3).
 ;
 ; A = an animation id (or NO_ANIM -- does nothing), Y = the combatant slot
@@ -971,8 +984,84 @@ spell_damage_store:
 spell_damage_done:
   rts
 
+; PROTOTYPE, phase-2 design measurement ONLY (docs/design-battle-animation.md
+; v6) -- the single arm point for the shared bt_hurt_slot/bt_hurt_left pair,
+; called from apply_damage's own single choke point (every landed physical
+; hit, spell hit, and status tick). Fixes the "stranded tint" limitation: if
+; the slot this call is about to steal was a block-art monster whose flash
+; was still counting down, its cell is force-restored NOW, rather than left
+; to a countdown that will never reach zero for that slot again once
+; bt_hurt_slot points elsewhere.
+;
+; The multi-target hit policy this bakes in (an all-target spell's own
+; cast_all loop calls apply_damage, and so this, several times in one
+; tick): only the LAST target processed ends up blinking/flashing -- each
+; earlier target in the same volley is armed and then immediately
+; superseded before a single tick of feedback is ever drawn for it. This
+; follows directly from Chris's own decision to share one slot/timer pair
+; rather than a per-slot array or bitmask.
+battle_hurt_arm:
+  lda <bt_hurt_left
+  beq battle_hurt_arm_set        ; nothing live to strand
+  lda <bt_hurt_slot
+  cmp <bt_target
+  beq battle_hurt_arm_set        ; same slot re-hit -- just restart the timer
+  cmp #MAX_PARTY
+  bcc battle_hurt_arm_set        ; stolen slot was a party member -- sprite
+                                  ; blink only, nothing was ever queued to strand
+  jsr battle_hurt_restore_slot   ; stolen slot was a monster -- restore its
+                                  ; cell now if it had block art
+battle_hurt_arm_set:
+  lda <bt_target
+  sta <bt_hurt_slot
+  lda #BT_HURT_FRAMES
+  sta <bt_hurt_left
+  rts
+
+; The OLD bt_hurt_slot (still in <bt_hurt_slot on entry) is a monster --
+; force-queue its own attribute cell back if it has block art. A no-op for
+; a metasprite-fallback monster (mon_tile == $FF).
+;
+; Round 1 finding 2's second half: if that monster has ALREADY died since
+; it was armed (mon_slot_alive == 0), this call -- happening because a
+; DIFFERENT target is about to steal the shared pair -- is the LAST chance
+; to fix its cell before bt_hurt_slot forgets it entirely; battle_hurt_tick
+; (engine/battle.asm) will never check this slot again once a new one is
+; armed. Restores BT_GROUND_ATTR in that case, never the dead monster's
+; own now-meaningless mon_attr -- the identical policy battle_hurt_tick's
+; own dead-check uses.
+;
+; Round 1 finding 1's fix: this and battle_hurt_attr_open (engine/battle.asm)
+; between them replace the previous version's own bt_tmp2 parking -- see
+; that routine's own header for why. Clobbers A, X, Y.
+battle_hurt_restore_slot:
+  lda <bt_hurt_slot
+  sec
+  sbc #MAX_PARTY
+  tax
+  lda mon_slot_actor,x
+  tay
+  lda mon_tile,y
+  cmp #$FF
+  beq battle_hurt_restore_slot_rts   ; no block art -- nothing to restore
+  jsr battle_hurt_attr_open          ; X = monster slot, preserved
+  lda mon_slot_alive,x
+  bne battle_hurt_restore_slot_alive
+  lda #BT_GROUND_ATTR
+  jmp battle_hurt_restore_slot_push
+battle_hurt_restore_slot_alive:
+  lda mon_slot_actor,x                ; re-read (X survives the call); Y was
+  tay                                  ; clobbered by battle_hurt_attr_open
+  lda mon_attr,y
+battle_hurt_restore_slot_push:
+  jsr vram_push
+  jmp vram_end
+battle_hurt_restore_slot_rts:
+  rts
+
 ; Take bt_dmg_lo off bt_target, and note if that finished it.
 apply_damage:
+  jsr battle_hurt_arm          ; PROTOTYPE, phase-2 measurement only
   lda <bt_target
   cmp #MAX_PARTY
   bcs apply_damage_mon
@@ -1265,6 +1354,7 @@ monster_turn_attack:
   lda #BS_HITS
   jmp battle_say_actor
 monster_missed:
+  jsr battle_miss_arm        ; PROTOTYPE, phase-2 measurement only
   lda #$FF
   sta <bt_dmg_hi
   lda #BS_MISSES
diff --git a/engine/battleui.asm b/engine/battleui.asm
index 9aa5b5b..f542597 100644
--- a/engine/battleui.asm
+++ b/engine/battleui.asm
@@ -719,6 +719,15 @@ battle_message_done:
   lda #NO_ANIM
   sta <bt_fx_anim
   .endif
+  ; PROTOTYPE, phase-2 measurement only -- the MISS overlay is capped the
+  ; identical way: it must not survive into the NEXT action's own message,
+  ; naming a target that already had its turn. Hit feedback (bt_hurt_left)
+  ; is deliberately NOT capped here -- it is purely time-based (20 ticks,
+  ; under MSG_HOLD's 45), so letting it run past an early dismissal into
+  ; the next tick or two is harmless and simpler than adding a second
+  ; unconditional clear for state that already self-terminates.
+  lda #0
+  sta <bt_miss_left
   jsr clear_message
   ; After the acting combatant's own line, every status it carries gets a
   ; word in, one tick and one line per bit, lowest first: status_pending
@@ -864,12 +873,25 @@ battle_sprite_clear:
   .if BATTLE_ANIM_ENABLED
   jsr battle_fx_draw
   .endif
+  jsr battle_miss_draw      ; PROTOTYPE, phase-2 measurement only
   ldx #0
 battle_sprite_pc:
   lda pc_in_party,x
   beq battle_sprite_pc_next
   lda pc_hp,x
   beq battle_sprite_pc_next ; a fallen member is not drawn
+  ; PROTOTYPE, phase-2 measurement only (docs/design-battle-animation.md
+  ; v6): skip the icon on alternate frames while this combatant is the one
+  ; named by the shared bt_hurt_slot/bt_hurt_left pair -- ent_hurt's own
+  ; trick (engine/entities.asm), extended to combatants.
+  lda <bt_hurt_left
+  beq battle_sprite_pc_draw
+  cpx <bt_hurt_slot
+  bne battle_sprite_pc_draw
+  lda <bt_hurt_left
+  and #2
+  bne battle_sprite_pc_next
+battle_sprite_pc_draw:
   lda pc_metasprite,x
   cmp #$FF
   beq battle_sprite_pc_next
@@ -900,6 +922,19 @@ battle_sprite_mon:
   lda mon_tile,y
   cmp #$FF
   bne battle_sprite_mon_next ; it has block art, already on the background
+  ; PROTOTYPE, phase-2 measurement only -- the identical skip, combatant
+  ; index = monster slot + MAX_PARTY.
+  lda <bt_hurt_left
+  beq battle_sprite_mon_draw
+  txa
+  clc
+  adc #MAX_PARTY
+  cmp <bt_hurt_slot
+  bne battle_sprite_mon_draw
+  lda <bt_hurt_left
+  and #2
+  bne battle_sprite_mon_next
+battle_sprite_mon_draw:
   lda #BT_MON_COL*8
   sta <de_ex
   txa
@@ -1048,5 +1083,81 @@ battle_fx_draw_rts:
   rts
   .endif
 
+; PROTOTYPE, phase-2 design measurement ONLY (docs/design-battle-animation.md
+; v6) -- draws the MISS overlay while bt_miss_left is counting down. Reuses
+; the identical per-slot anchor math battle_fx_draw already uses, offset 8
+; pixels up from the icon's own anchor row so the glyphs read as "next to"
+; the sprite rather than dead-centered on it.
+;
+; Round 1 finding 4: this is a FIXED, unconditional 4-sprite write, drawn
+; first (oam_idx still low) for foreground priority over the icon it
+; names -- the identical "accepted limitation" §3.6 already states for the
+; flipbook's own worst-case combatant/cursor figure: a project whose
+; combatants ALONE already need more than 60 OAM entries (permitted, with
+; only a warning -- describeBattleSpriteWarning, shared/project.js) can
+; still see a LATER combatant draw wrap oam_idx back to 0 and overwrite
+; these four entries, or vice versa. This mechanism neither causes nor
+; repairs that pre-existing exposure; it costs the identical fixed 16 bytes
+; of OAM every time it draws, never more.
+battle_miss_draw:
+  lda <bt_miss_left
+  beq battle_miss_draw_rts
+  lda <bt_miss_slot
+  cmp #MAX_PARTY
+  bcs battle_miss_draw_mon
+  lda <bt_miss_slot
+  asl a
+  asl a
+  asl a
+  asl a
+  asl a                     ; slot * BT_PARTY_STEP
+  clc
+  adc #BT_PARTY_Y-8         ; one tile above the icon's own anchor row
+  sta <bt_tmp
+  lda #BT_PARTY_X
+  jmp battle_miss_draw_go
+battle_miss_draw_mon:
+  lda <bt_miss_slot
+  sec
+  sbc #MAX_PARTY
+  asl a
+  asl a
+  asl a
+  asl a
+  asl a                     ; monster slot * 32 pixels
+  clc
+  adc #BT_MON_ROW*8-8
+  sta <bt_tmp
+  lda #BT_MON_COL*8
+battle_miss_draw_go:
+  sta <bt_tmp2
+  ldy <oam_idx
+  ldx #0
+battle_miss_draw_cell:
+  lda <bt_tmp
+  sta OAM,y
+  iny
+  lda miss_tiles,x
+  sta OAM,y
+  iny
+  lda #0
+  sta OAM,y
+  iny
+  lda <bt_tmp2
+  sta OAM,y
+  iny
+  clc
+  adc #8
+  sta <bt_tmp2
+  inx
+  cpx #4
+  bne battle_miss_draw_cell
+  sty <oam_idx
+battle_miss_draw_rts:
+  rts
+
+miss_tiles:
+  .db MISS_TILE_M, MISS_TILE_I, MISS_TILE_S, MISS_TILE_S
+
 bit_mask:
   .db $01,$02,$04,$08,$10,$20,$40,$80
diff --git a/engine/constants.asm b/engine/constants.asm
index 1644a00..0537e45 100644
--- a/engine/constants.asm
+++ b/engine/constants.asm
@@ -465,6 +465,32 @@ bt_fx_slot  = bt_fx_anim+1
 bt_fx_frame = bt_fx_slot+1
 bt_fx_timer = bt_fx_frame+1
 
+; PROTOTYPE, phase-2 design v6 (docs/design-battle-animation.md, hit
+; feedback + MISS) -- measurement only, unconditional (no feature gate),
+; not shipped as-is. bt_hurt_slot/bt_hurt_left are the ONE shared pair for
+; both hit-feedback halves (sprite blink for a metasprite-drawn combatant,
+; attribute flash for a block-art monster) -- which mechanism applies is
+; decided at read time from what bt_hurt_slot currently names, never both.
+; bt_miss_slot/bt_miss_left are the independent MISS overlay's own state.
+bt_hurt_slot = bt_fx_timer+1
+bt_hurt_left = bt_hurt_slot+1
+bt_miss_slot = bt_hurt_left+1
+bt_miss_left = bt_miss_slot+1
+BT_HURT_FRAMES = 20
+BT_MISS_FRAMES = 30
+; Sprite-table reservation for the MISS glyphs -- 3 unique tiles (M, I, S;
+; the second S reuses the first), placed beside SPRITE_ARROW_TILE ($FD) and
+; the heart tiles ($FE/$FF) without colliding with either.
+MISS_TILE_M = $FA
+MISS_TILE_I = $FB
+MISS_TILE_S = $FC
+; draw_battle_attr's own ground-row fill (engine/battle.asm) -- rows 1-4 of
+; the attribute table get $55 before any live monster's own mon_attr is
+; written over the top. This is what a dead monster's own cell must be
+; restored to, not its own (now-meaningless) authored tint -- round 1
+; finding 2.
+BT_GROUND_ATTR = $55
+
 ; The $10-per-row darken trick reaches solid black in at most this many
 ; subtractions from any starting row; the hold between steps is an engine
 ; constant, not authored -- see OP_FADE below and shared/project.js's

```

## Appendix E — the party-attack-visual prototype's full diff (§16, measured, fix round 4)

Fix round 4 (**amendment fix round 4, orchestrator finding**: a regressed label, found by the
orchestrator, not by a reviewer round — §10): applied fix round 2's own diff (the
`fix2-round2.diff` this Appendix has carried since fix
round 2, unchanged through fix rounds 2 and 3) in a fresh throwaway `git worktree` off `71cfa84`,
then made ONE change on top — restored the `bankedFeatures` removal-lever label,
`projectWithoutBattleAnimation`'s own entry, from `'every battle animation reference'` back to
`'every monster attack or spell animation reference'`, with a short comment explaining the scope
(actor and spell references only, never a party member's own). **This rename was already accepted
once, in the ORIGINAL (pre-amendment) §16 review cycle's own fix round 2 (design fix round 2,
review P3-1, §10) — the version of Appendix E committed into `71cfa84` itself carried it.** It was
lost, silently, when amendment fix round 1 rebuilt this prototype from a base that predated that
rename (confirmed this round against the saved `battleanim-party-prototype-fix1-round1.diff`, which
carries the old label as an unchanged context line — `battleanim-party-prototype-amend1.diff`, the
step immediately before it, still has the correct rename, so the loss is isolated to that one
rebuild), and stayed lost through fix rounds 1 through 3 with no review round catching it. A full
audit this round (comparing the accepted `battleanim-party-prototype-fix2.diff` — the ORIGINAL
cycle's own fix round 2 diff, 4 files, no walk machinery — against the current Appendix E for every
one of its four touched files) found nothing else lost: every other difference between that diff and
this Appendix is a DELIBERATE later supersession (the `attack_target` direct-arm redesign, fix round
1's own P2-4, reversing that diff's "grow `battle_fx_arm_attack`" shape; the walk's own unconditional
+56 base-byte fold-in and the 243→264 consolidation, both new mechanisms this diff predates entirely;
and cosmetic comment/ordering changes that track those two redesigns) — none is a second regression.
This is otherwise BYTE-IDENTICAL to fix round 2/3's own diff: still eleven files, same seven
engine/generator/schema files, same four test files, no new file, no other line touched. Measured:
`BASE_BATTLE_CODE_BYTES_BY_MAPPER`, `PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE` (`10`) and
`BATTLE_ANIM_BATTLE_ALLOWANCE` (`264`) all unchanged from fix round 2/3 — a string-only change moves
no ROM byte. `node --test test/unit/nameentry.test.js test/unit/bankedbytes.test.js` still passes
`60/60`; grepping `test/` and `main/` for both label strings found no test asserting either one (the
old label appears only inside my own new source comment, quoting it historically) — this change
breaks nothing. The mixed-removal advisor probe (actor and party `attackAnim` both set, naming off,
`sample-rpg`) on all three RPG-capable boards confirms the savings are unchanged (`0`/`12`/`283`)
and the advice text now correctly reads "...removing every monster attack or spell animation
reference and every party member's own attack animation" for the combined case, with the
zero-saving monster/spell-only strip never offered alone. The four non-RPG fixtures build cleanly;
`sample-rpg`/`sample-rpg-mmc1` hashes UNCHANGED from fix round 1's own re-pinned values
(`6944a5a3c80cfe15ab8f044f0c8520b53351d649195f41f2b6ef0a3c07525623`,
`bd51f3d6be9e5459754afcf9b5620a794225e57a33339f7c8b4e28de7255021d`). **Full `npm test`:
`1737/1737` — every test passes, 0 skipped.**

```diff
diff --git a/engine/battle.asm b/engine/battle.asm
index f552d14..d89c9e0 100644
--- a/engine/battle.asm
+++ b/engine/battle.asm
@@ -456,8 +456,12 @@ battle_tick_next:
   jmp battle_next
 battle_tick_over:
   cmp #BP_DONE
-  bne battle_tick_end
+  bne battle_tick_walk
   jmp battle_finish
+battle_tick_walk:
+  cmp #BP_WALK
+  bne battle_tick_end
+  jmp battle_walk_wait
 battle_tick_end:
   jmp battle_outcome        ; victory, defeat and running away all wait here
 
@@ -505,6 +509,14 @@ setup_monsters:
   lda #0
   sta <bt_miss_left
   .endif
+  ; §16 (docs/design-battle-animation.md, fix round 1): a fresh battle must
+  ; not inherit a stepped-forward sprite from whatever battle came before --
+  ; unconditional, the identical "a switched-off feature must not move any
+  ; other symbol's address" chain reasoning does not apply here since the
+  ; walk has no gate at all; this is just the ordinary per-battle reset every
+  ; other bt_* countdown above already gets.
+  lda #0
+  sta <bt_walk_step
   ldx #0
 setup_monsters_slot:
   lda #0
diff --git a/engine/battleturn.asm b/engine/battleturn.asm
index 1b611f7..d54af86 100644
--- a/engine/battleturn.asm
+++ b/engine/battleturn.asm
@@ -210,7 +210,13 @@ spell_affordable:
   sta <bt_phase
   jmp show_target
 spell_chosen_all:
-  lda #BP_ACT
+  ; §16 (docs/design-battle-animation.md, fix round 1): always a party
+  ; member's own cast (spell_chosen's one caller, the SPELLS list's own "A
+  ; pressed" handler) -- unconditionally routed to BP_WALK instead of
+  ; BP_ACT, the walk having no gate of its own.
+  lda #0
+  sta <bt_walk_step
+  lda #BP_WALK
   sta <bt_phase
   rts
 
@@ -260,11 +266,23 @@ item_chosen_none:
   jmp battle_say_actor
 
 ; A plain attack from whoever is acting on to bt_target. Never a monster's own
-; attack: monsters swing through monster_turn_attack below, which is the
-; real, and only, physical-attack path that needs to arm battle.attackAnim --
-; bt_actor is always < MAX_PARTY on this path, so arming here would be dead
-; code.
+; attack: monsters swing through monster_turn_attack below. bt_actor is
+; always < MAX_PARTY on this path, which is the real, and only,
+; physical-attack path that arms a PARTY member's own attack visual (§16,
+; docs/design-battle-animation.md, fix round 1) -- before roll_hit, the
+; identical monster_turn_attack placement below, so the swing plays whether
+; the hit lands or misses. Armed directly here, not through
+; battle_fx_arm_attack (a party member's own combatant slot IS their own
+; project.party index, §16.4, so no sec/sbc detour is needed the way a
+; monster's own arm needs) -- leaving battle_fx_arm_attack itself untouched,
+; monster-only, exactly as it already was before this slice existed.
 attack_target:
+  .if PARTY_ATTACK_ANIM_ENABLED
+  ldx <bt_actor
+  lda pc_anim_attack,x
+  ldy <bt_actor
+  jsr battle_fx_arm_at
+  .endif
   jsr roll_hit
   bne attack_missed
   jsr physical_damage
diff --git a/engine/battleui.asm b/engine/battleui.asm
index 8be224d..0a00991 100644
--- a/engine/battleui.asm
+++ b/engine/battleui.asm
@@ -233,7 +233,15 @@ battle_target:
   and #BTN_A
   beq battle_target_done
   jsr hide_target
-  lda #BP_ACT
+  ; §16 (docs/design-battle-animation.md, fix round 1): both a physical
+  ; Attack's own targeting and a single-target spell's own targeting share
+  ; this routine, and both now walk first -- no bt_cmd check needed, since
+  ; the walk applies identically either way (the earlier design's own
+  ; BC_MAGIC-only check is gone with it, per Chris's own "Attacks walk too"
+  ; answer, §8).
+  lda #0
+  sta <bt_walk_step
+  lda #BP_WALK
   sta <bt_phase
 battle_target_done:
   rts
@@ -730,6 +738,13 @@ battle_message_done:
   lda #0
   sta <bt_miss_left
   .endif
+  ; §16 (docs/design-battle-animation.md, fix round 1): the acting member's
+  ; own forward step is capped here too, unconditionally -- the identical
+  ; "ends at message dismissal, whether or not it finished on its own" rule
+  ; bt_fx_anim/bt_miss_left already follow above, joined by one more
+  ; unconditional reset since the walk has no gate to nest this under.
+  lda #0
+  sta <bt_walk_step
   jsr clear_message
   ; After the acting combatant's own line, every status it carries gets a
   ; word in, one tick and one line per bit, lowest first: status_pending
@@ -786,6 +801,24 @@ battle_message_advance:
 battle_message_hold:
   rts
 
+; §16 (docs/design-battle-animation.md, fix round 1): hold BP_WALK for
+; WALK_TICKS ticks, the identical "hold a phase for N ticks" shape
+; battle_message_wait above already uses for bt_timer -- an UP-counter here
+; instead, since bt_walk_step doubles as the draw-time offset's own input
+; (battle_sprite_pc/battle_fx_draw), so there is nothing else to reuse
+; bt_timer's own down-counter for. Unconditional: every RPG project's own
+; battle bank reaches this the moment a party member's own turn begins.
+battle_walk_wait:
+  lda <bt_walk_step
+  cmp #WALK_TICKS
+  bcs battle_walk_done
+  inc <bt_walk_step
+  rts
+battle_walk_done:
+  lda #BP_ACT
+  sta <bt_phase
+  rts
+
 ; bt_dmg_lo/hi -> three glyphs in bt_digits, leading zeros blanked. Repeated
 ; subtraction, on the main thread: division inside NMI is what overran vblank in
 ; the game this is modelled on.
@@ -906,7 +939,24 @@ battle_sprite_pc_draw:
   cmp #$FF
   beq battle_sprite_pc_next
   sta <bt_tmp
+  ; §16 (docs/design-battle-animation.md, fix round 1): the acting member's
+  ; own icon draws stepped-forward while bt_walk_step is nonzero -- bt_tmp2
+  ; is free here (battle_dispatch has already finished for this tick by the
+  ; time battle_draw_sprites runs, so cast_all's own end-of-side sentinel use
+  ; of it is long over).
+  cpx <bt_actor
+  bne battle_sprite_pc_x_plain
+  lda <bt_walk_step
+  beq battle_sprite_pc_x_plain
+  asl a
+  sta <bt_tmp2
+  lda #BT_PARTY_X
+  sec
+  sbc <bt_tmp2
+  jmp battle_sprite_pc_x_set
+battle_sprite_pc_x_plain:
   lda #BT_PARTY_X
+battle_sprite_pc_x_set:
   sta <de_ex
   txa
   asl a
@@ -1062,7 +1112,26 @@ battle_fx_draw:
   lda <bt_fx_slot
   cmp #MAX_PARTY
   bcs battle_fx_draw_mon
+  ; §16 (docs/design-battle-animation.md, fix round 1): a caster-anchored
+  ; effect (heal/all-target, or a party member's own attackAnim) follows the
+  ; walk when it is armed on the CURRENTLY-acting member's own slot -- so it
+  ; plays where the sprite visually is, not behind it. Only reachable when
+  ; BATTLE_ANIM_ENABLED is live at all (this whole routine is), so this stays
+  ; a named cost of THAT flag, not the walk itself, which has no flag.
+  lda <bt_fx_slot
+  cmp <bt_actor
+  bne battle_fx_draw_x_plain
+  lda <bt_walk_step
+  beq battle_fx_draw_x_plain
+  asl a
+  sta <bt_tmp2
+  lda #BT_PARTY_X
+  sec
+  sbc <bt_tmp2
+  jmp battle_fx_draw_x_set
+battle_fx_draw_x_plain:
   lda #BT_PARTY_X
+battle_fx_draw_x_set:
   sta <de_ex
   lda <bt_fx_slot
   asl a
diff --git a/engine/constants.asm b/engine/constants.asm
index 103ec30..c756761 100644
--- a/engine/constants.asm
+++ b/engine/constants.asm
@@ -489,6 +489,17 @@ BT_HURT_FRAMES = 20
 bt_miss_slot = bt_hurt_left+1
 bt_miss_left = bt_miss_slot+1
 BT_MISS_FRAMES = 30
+
+; §16 (docs/design-battle-animation.md, fix round 1): the acting party
+; member's own forward step, held by BP_WALK -- counts UP from 0 to
+; WALK_TICKS, doubling as the draw-time X-offset input directly (2 pixels
+; per tick, the asl in battle_sprite_pc/battle_fx_draw, so the total
+; distance is WALK_TICKS * 2 = 16 pixels; no separate distance constant,
+; since nothing else would ever read one independently of that shift).
+; Chained after bt_miss_left, unconditionally -- true for every RPG project,
+; not merely one authoring an attackAnim, since the walk itself has no gate.
+bt_walk_step = bt_miss_left+1
+WALK_TICKS = 8
 ; draw_battle_attr's own ground-row fill (engine/battle.asm) -- rows 1-4 of
 ; the attribute table get this value before any live monster's own mon_attr
 ; is written over the top. This is what a dead monster's own cell must be
@@ -932,6 +943,12 @@ BP_VICTORY  = 8
 BP_DEFEAT   = 9
 BP_FLEE     = 10
 BP_DONE     = 11            ; leave the battle on the next tick
+; §16 (docs/design-battle-animation.md, fix round 1): a party member's own
+; step forward, before BP_ACT resolves either a physical Attack or a spell
+; cast -- held for WALK_TICKS the same way BP_MESSAGE holds for bt_timer
+; ticks. Unconditional: every RPG project's own battle bank gets this phase,
+; not merely one that authors an attackAnim.
+BP_WALK     = 12
 
 ; What the trampoline is being asked for. One entry point, because every extra
 ; one is another place the bank could be left switched in.
diff --git a/main/build/battletables.js b/main/build/battletables.js
index ad0582a..1279336 100644
--- a/main/build/battletables.js
+++ b/main/build/battletables.js
@@ -54,6 +54,9 @@ import {
   projectWithoutNameToken,
   projectWithoutMonsterSpellList,
   projectUsesBattleAnimation,
+  projectUsesAnyBattleAnimation,
+  projectUsesPartyAttackAnim,
+  projectWithoutPartyAttackAnim,
   isPlayableBattleAnimation,
   projectWithoutBattleAnimation,
   projectUsesHitFeedback,
@@ -258,8 +261,12 @@ export function battleTables(project, battleStrings = BATTLE_STRINGS) {
   // depth beside validateProject's own refusal (shared/project.js), since
   // buildProject compiles whatever project is in hand, not one that has
   // necessarily passed validation. Same stub-avoidance rule mon_mag/mon_mdef
-  // use above -- emitted only when projectUsesBattleAnimation is true.
-  if (projectUsesBattleAnimation(project)) {
+  // use above -- emitted whenever projectUsesAnyBattleAnimation is true
+  // (§16, fix round 1: broadened from the narrow projectUsesBattleAnimation,
+  // since battle_fx_arm_attack's own monster branch, and cast_spell's
+  // fallback call to it, are reached whenever BATTLE_ANIM_ENABLED is live
+  // for ANY reason, including a party-only project).
+  if (projectUsesAnyBattleAnimation(project)) {
     chunks.push(
       `mon_anim_attack:\n${dbRows(battle((b) => validAnimId(b.attackAnim, project)))}`
     );
@@ -337,7 +344,7 @@ export function battleTables(project, battleStrings = BATTLE_STRINGS) {
   // all-target spell (cast_spell, engine/battleturn.asm, decides which).
   // NO_ANIM when unset or stale/out of range (defense in depth, the same
   // rule as mon_anim_attack above). Same stub-avoidance rule.
-  if (projectUsesBattleAnimation(project)) {
+  if (projectUsesAnyBattleAnimation(project)) {
     chunks.push(`spell_anim:\n${dbRows(spells.map((spell) => validAnimId(spell.anim, project)))}`);
   }
 
@@ -351,6 +358,16 @@ export function battleTables(project, battleStrings = BATTLE_STRINGS) {
   chunks.push(`pc_speed:\n${dbRows(party.map((member) => member.speed))}`);
   chunks.push(`pc_acc:\n${dbRows(party.map((member) => member.acc))}`);
   chunks.push(`pc_eva:\n${dbRows(party.map((member) => member.eva))}`);
+  // §16 (docs/design-battle-animation.md, fix round 1): which animation this
+  // party member plays on a physical swing, or -- with no spell.anim of its
+  // own authored -- shows nothing extra beyond the walk (attack_target,
+  // engine/battleturn.asm). NO_ANIM when unset or stale/out of range, the
+  // identical defense-in-depth mon_anim_attack/spell_anim above already use.
+  // Emitted only when projectUsesPartyAttackAnim is true -- the independent,
+  // narrower gate attack_target's own new arm block reads.
+  if (projectUsesPartyAttackAnim(project)) {
+    chunks.push(`pc_anim_attack:\n${dbRows(party.map((member) => validAnimId(member.attackAnim, project)))}`);
+  }
   chunks.push(`pc_name:\n${dbRows(party.flatMap((member) => nameTiles(member.name)), NAME_LIMIT)}`);
 
   // One row of maxLevel entries per member, so `member * MAX_LEVEL + level - 1`
@@ -605,7 +622,29 @@ export function checkBattleTables(project) {
 // { 30: 3783, 1: 3783, 4: 3823 } -- the MMC3-vs-other-two SPLIT_ENABLED gap
 // narrows from 46 to 40 bytes (3823 - 3783 = 40); bankedbytes.test.js's own
 // asserted constant and CLAUDE.md's own prose both need the same update.
-export const BASE_BATTLE_CODE_BYTES_BY_MAPPER = { 30: 3783, 1: 3783, 4: 3823 };
+//
+// §16 (docs/design-battle-animation.md, fix round 1): +56 on every board,
+// folded straight in rather than a conditional allowance -- unlike every
+// other term this file names, the party-caster walk forward (BP_WALK,
+// battle_walk_wait, and the two BP_WALK routing insertions in
+// spell_chosen_all/battle_target) is UNCONDITIONAL for every RPG project,
+// per Chris's own "always on for RPGs" answer (no project.rpg field, no
+// PARTY_ATTACK_ANIM_ENABLED-style flag) -- so this is not the "folded a
+// conditional feature into a base" mistake CLAUDE.md's own kernel-budget
+// rule warns against; there is no author who does not pay it, the identical
+// reasoning BE_RESTORE's own +18 and the join-guard's own +5 above already
+// establish for unconditional battle-bank growth. Measured directly, with
+// items stripped out of the comparison the same way the join-guard's own
+// paragraph above isolates its delta (sample-rpg carries a live item, whose
+// own ITEM_LIST_FILTER_BATTLE_ALLOWANCE = 17 code bytes is a SEPARATE,
+// already-existing term battleRegionBytes adds on top of this base, not
+// part of it): a real "off" build's own code usage rose from 3800/3800/3840
+// (base 3783/3783/3823 + the pre-existing 17-byte item term) to
+// 3856/3856/3896 -- 3856 - 17 = 3839, 3896 - 17 = 3879, the identical +56
+// on every board since nothing in the walk branches on SPLIT_ENABLED or
+// anything else mapper-specific -- battle_sprite_pc's and battle_fx_draw's
+// own draw-time offset math is sprite-side only, no CHR-bank interaction.
+export const BASE_BATTLE_CODE_BYTES_BY_MAPPER = { 30: 3839, 1: 3839, 4: 3879 };
 
 // Phase 4c round 3, finding 6 (phase4-design.md §9), corrected round 3b
 // (review K1): the two-menu-consistency filter (build_item_list's kind/
@@ -701,13 +740,36 @@ export const MONSTER_SPELL_LIST_BATTLE_ALLOWANCE = 125;
 
 // Battle-side animation (docs/design-battle-animation.md §3.5, Appendix A):
 // battle_fx_arm_at/battle_fx_arm_attack/battle_fx_tick/battle_fx_draw plus
-// the arming call-site insertions in monster_turn_attack and cast_spell.
-// Measured flat across all three RPG-capable boards. Gated on
-// projectUsesBattleAnimation, with NO `&& banked` guard -- the identical
-// shape MONSTER_SPELL_LIST_BATTLE_ALLOWANCE above uses, since
-// projectUsesBattleAnimation alone is what the table emitters above gate on
-// too.
-export const BATTLE_ANIM_BATTLE_ALLOWANCE = 243;
+// the arming call-site insertions in monster_turn_attack and cast_spell,
+// PLUS (§16, fix round 2) battle_fx_draw's own follow-the-walker snippet --
+// 243 (the pre-existing shared machinery) + 21 (the follow snippet) = 264.
+// Consolidated into ONE constant, fix round 2 (review round 2, P2-3):
+// amendment round 1/fix round 1 kept the follow snippet as a separately
+// NAMED `WALK_FX_FOLLOW_BATTLE_ALLOWANCE`, but since fix round 1 made the
+// walk unconditional, that snippet's only remaining gate is
+// projectUsesAnyBattleAnimation -- the IDENTICAL single predicate this
+// constant already uses -- so no build variant can ever isolate 21 from 243
+// by delta measurement; keeping them as two names bought no independently
+// checkable claim, only the appearance of one (an opposite drift in the two
+// halves that kept their SUM at 264 would have passed the old two-name
+// equality test undetected). One gate, one measured, equality-checkable
+// allowance. Gated on projectUsesAnyBattleAnimation (§16, fix round 1:
+// broadened from the narrow projectUsesBattleAnimation, since a party-only
+// project needs the WHOLE shared base mechanism too), with NO `&& banked`
+// guard -- the identical shape MONSTER_SPELL_LIST_BATTLE_ALLOWANCE above
+// uses. Measured flat across all three RPG-capable boards.
+export const BATTLE_ANIM_BATTLE_ALLOWANCE = 264;
+
+// §16 (docs/design-battle-animation.md, fix round 1): attack_target's own
+// direct arm of a party member's attackAnim (ldx/lda pc_anim_attack,x/
+// ldy/jsr battle_fx_arm_at) -- battle_fx_arm_attack itself is UNTOUCHED,
+// monster-only, exactly as it already was before this slice existed (P2-4:
+// the reviewer's own leaner alternative to growing that shared routine,
+// chosen and measured this round). Independent of PARTY_CAST_WALK -- there
+// is no such flag any more, since the walk is unconditional for every RPG
+// (Chris's own "always on for RPGs" answer). Gated on
+// projectUsesPartyAttackAnim, flat across all three RPG-capable boards.
+export const PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE = 10;
 
 // Phase 2a hit feedback (docs/design-battle-animation.md §12.7):
 // battle_hurt_arm/battle_hurt_attr_open/battle_hurt_tick/
@@ -1008,7 +1070,8 @@ export function battleRegionBytes(project, mapper) {
     (projectUsesMagicPower(project) ? MAGIC_POWER_BATTLE_ALLOWANCE : 0) +
     (projectUsesMagicDefence(project) ? MAGIC_DEFENCE_BATTLE_ALLOWANCE : 0) +
     (projectUsesMonsterSpellList(project) ? MONSTER_SPELL_LIST_BATTLE_ALLOWANCE : 0) +
-    (projectUsesBattleAnimation(project) ? BATTLE_ANIM_BATTLE_ALLOWANCE : 0) +
+    (projectUsesAnyBattleAnimation(project) ? BATTLE_ANIM_BATTLE_ALLOWANCE : 0) +
+    (projectUsesPartyAttackAnim(project) ? PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE : 0) +
     (projectUsesHitFeedback(project) ? HIT_FEEDBACK_BATTLE_ALLOWANCE : 0) +
     (projectUsesMiss(project) ? MISS_BATTLE_ALLOWANCE : 0)
   );
@@ -1159,9 +1222,31 @@ export function battleShortfallAdvice(project, mapper, deficit, { alternatives =
     if (battleBankEnabled(project, mapper) && projectUsesMonsterSpellList(project)) {
       bankedFeatures.push({ label: "every monster's extra spells", strip: projectWithoutMonsterSpellList });
     }
-    // docs/design-battle-animation.md §3.5.
+    // docs/design-battle-animation.md §3.5. Renamed from the pre-existing
+    // 'every battle animation reference' (fix round 4, restoring a rename
+    // accepted in the ORIGINAL §16 review cycle and lost in amendment fix
+    // round 1's own rebuild): projectWithoutBattleAnimation strips only
+    // actor and spell references, never a party member's own, so the old
+    // label overpromised once a party attackAnim authoring surface existed.
     if (battleBankEnabled(project, mapper) && projectUsesBattleAnimation(project)) {
-      bankedFeatures.push({ label: 'every battle animation reference', strip: projectWithoutBattleAnimation });
+      bankedFeatures.push({
+        label: 'every monster attack or spell animation reference',
+        strip: projectWithoutBattleAnimation
+      });
+    }
+    // §16 (docs/design-battle-animation.md, fix round 1): a party member's
+    // own attackAnim is a separate, independent lever from the monster/spell
+    // one above -- stripping it alone frees PARTY_ATTACK_ANIM_BATTLE_
+    // ALLOWANCE, and (if no monster/spell reference remains either) the
+    // whole shared BATTLE_ANIM_BATTLE_ALLOWANCE base too (264, fix round 2's
+    // own consolidated figure), via battleRegionBytes' own before/after
+    // recomputation -- no separate lever needed for the walk itself, since
+    // the walk cannot be stripped at all (it is unconditional).
+    if (battleBankEnabled(project, mapper) && projectUsesPartyAttackAnim(project)) {
+      bankedFeatures.push({
+        label: "every party member's own attack animation",
+        strip: projectWithoutPartyAttackAnim
+      });
     }
     // docs/design-battle-animation.md §12.7.
     if (battleBankEnabled(project, mapper) && projectUsesHitFeedback(project)) {
diff --git a/main/build/generate.js b/main/build/generate.js
index ac41ee0..48e46dd 100644
--- a/main/build/generate.js
+++ b/main/build/generate.js
@@ -80,7 +80,8 @@ import {
   projectUsesMagicPower,
   projectUsesMagicDefence,
   projectUsesMonsterSpellList,
-  projectUsesBattleAnimation,
+  projectUsesAnyBattleAnimation,
+  projectUsesPartyAttackAnim,
   projectUsesHitFeedback,
   projectUsesMiss,
   MISS_OAM_TILES,
@@ -2625,8 +2626,19 @@ export async function generateAssets({ dir, project, log = () => {} }) {
   // §6/§7) -- true iff some actor's battle.spellIds has two or more entries.
   const monsterSpellListEnabled = projectUsesMonsterSpellList(project);
   // Battle-side animation (docs/design-battle-animation.md §3.5):
-  // battle_fx_tick/arm/draw.
-  const battleAnimEnabled = projectUsesBattleAnimation(project);
+  // battle_fx_tick/arm/draw. Broadened (§16, fix round 1) to
+  // projectUsesAnyBattleAnimation -- battle_fx_arm_attack's own monster
+  // branch and cast_spell's fallback call to it are reached whenever this
+  // flag is live for ANY reason, including a party-only project, so the
+  // shared mon_anim_attack/spell_anim tables must exist whenever a party
+  // member's own attackAnim alone turns this flag on.
+  const battleAnimEnabled = projectUsesAnyBattleAnimation(project);
+  // §16 (docs/design-battle-animation.md, fix round 1): a party member's own
+  // attackAnim, armed directly in attack_target (never through
+  // battle_fx_arm_attack, which stays monster-only and untouched) -- an
+  // independent gate from battleAnimEnabled above, since a project can want
+  // either without the other.
+  const partyAttackAnimEnabled = projectUsesPartyAttackAnim(project);
   // Phase 2a hit feedback (docs/design-battle-animation.md §12.7):
   // battle_hurt_arm/tick/attr_open/restore_slot, gated independently of
   // BATTLE_ANIM_ENABLED.
@@ -3208,6 +3220,13 @@ export async function generateAssets({ dir, project, log = () => {} }) {
     // reads (engine/battleui.asm); BATTLE_COMBATANT_OAM_MAX is never emitted.
     `BATTLE_ANIM_ENABLED = ${battleAnimEnabled ? 1 : 0}`,
     `BATTLE_FX_OAM_ROOM = ${battleFxRoom}`,
+    // §16 (docs/design-battle-animation.md, fix round 1): attack_target's
+    // own direct arm of a party member's attackAnim (pc_anim_attack),
+    // independent of BATTLE_ANIM_ENABLED above -- a project can want either
+    // without the other. The walk itself (BP_WALK) has no flag: it is
+    // unconditional for every RPG project, per Chris's own "always on for
+    // RPGs" answer, so it needs no generated equate at all.
+    `PARTY_ATTACK_ANIM_ENABLED = ${partyAttackAnimEnabled ? 1 : 0}`,
     // Phase 2a hit feedback (docs/design-battle-animation.md §12.7):
     // battle_hurt_arm/tick/attr_open/restore_slot, and the blink-skip checks
     // in battle_sprite_pc/battle_sprite_mon. Independent of BATTLE_ANIM_ENABLED.
diff --git a/shared/project.js b/shared/project.js
index 1080708..8385e2b 100644
--- a/shared/project.js
+++ b/shared/project.js
@@ -3421,6 +3421,16 @@ export function* animationReferenceLocations(project) {
       describe: () => `Spell ${spellIndex} ("${spell.name}")'s cast animation`
     };
   }
+  const party = project.party ?? [];
+  for (let memberIndex = 0; memberIndex < party.length; memberIndex++) {
+    const member = party[memberIndex];
+    yield {
+      get: () => member.attackAnim,
+      set: (id) => { member.attackAnim = id; },
+      battleOnly: true,
+      describe: () => `Party member ${memberIndex} ("${member.name}")'s attack animation`
+    };
+  }
 }
 
 /**
@@ -4297,6 +4307,7 @@ export function createPartyMember(id, name = DEFAULT_MEMBER_NAME(id)) {
     speed: 4,
     acc: 200,
     eva: 8,
+    attackAnim: null, // this member's flipbook on a physical attack (§16)
     spells: [] // { spellId, level } — learned on reaching that level
   };
 }
@@ -5513,6 +5524,13 @@ function normalizePartyMember(raw, id, spellCount, maxLevel) {
     speed: num('speed', 0, 255),
     acc: num('acc', 0, 255),
     eva: num('eva', 0, 255),
+    // Not validated against project.sprites.animations.length here, the
+    // identical reason actor.battle.attackAnim isn't either -- the generator
+    // drops a stale id to NO_ANIM (pc_anim_attack, main/build/battletables.js).
+    attackAnim:
+      Number.isInteger(raw?.attackAnim) && raw.attackAnim >= 0 && raw.attackAnim <= 255
+        ? raw.attackAnim
+        : null,
     spells: (Array.isArray(raw?.spells) ? raw.spells : [])
       .filter((entry) => spellCount > 0 && Number(entry?.spellId) < spellCount)
       .slice(0, RPG_LIMITS.spells)
@@ -6441,7 +6459,9 @@ export function projectUsesBattleAnimation(project) {
   );
 }
 
-/** The battleShortfallAdvice removal candidate for the battle-anim slice. */
+/** The battleShortfallAdvice removal candidate for the battle-anim slice --
+ * monster and spell references only; a party member's own attackAnim is a
+ * separate, independent lever (projectWithoutPartyAttackAnim, below). */
 export function projectWithoutBattleAnimation(project) {
   const clone = structuredClone(project);
   for (const spell of clone.spells ?? []) spell.anim = null;
@@ -6451,6 +6471,41 @@ export function projectWithoutBattleAnimation(project) {
   return clone;
 }
 
+/**
+ * §16 (docs/design-battle-animation.md): whether any party member's own
+ * `attackAnim` is authored -- the same shape projectUsesBattleAnimation
+ * takes for actor/spell references, kept independent since a party member's
+ * own attack visual is a separate authoring surface from a monster's or a
+ * spell's.
+ */
+export function projectUsesPartyAttackAnim(project) {
+  return (project.party ?? []).some((member) => member.attackAnim !== null && member.attackAnim !== undefined);
+}
+
+/** The battleShortfallAdvice removal candidate for a party member's own attackAnim. */
+export function projectWithoutPartyAttackAnim(project) {
+  const clone = structuredClone(project);
+  for (const member of clone.party ?? []) member.attackAnim = null;
+  return clone;
+}
+
+/**
+ * §16: the broadened OR that gates BATTLE_ANIM_ENABLED and the shared
+ * mon_anim_attack/spell_anim table emission. Needed because
+ * battle_fx_arm_attack's own monster branch, and cast_spell's fallback call
+ * to it, are reached unconditionally whenever BATTLE_ANIM_ENABLED is live at
+ * all, for ANY reason -- including a party-only project whose only reference
+ * is a party member's own attackAnim (armed directly in attack_target, never
+ * through battle_fx_arm_attack, but still needing battle_fx_arm_at/tick/draw
+ * to exist). Gating those on the narrow projectUsesBattleAnimation alone
+ * would leave a party-only build's battle_fx_arm_attack referencing a
+ * mon_anim_attack table that does not exist -- an undefined-symbol assembly
+ * failure, not a byte-count error.
+ */
+export function projectUsesAnyBattleAnimation(project) {
+  return projectUsesBattleAnimation(project) || projectUsesPartyAttackAnim(project);
+}
+
 /**
  * Phase 2a hit feedback (docs/design-battle-animation.md §12.7): whether
  * `HIT_FEEDBACK_ENABLED` should be live. A `gameType === 'rpg'` check is
diff --git a/test/unit/bankedbytes.test.js b/test/unit/bankedbytes.test.js
index d0e492a..ea100c2 100644
--- a/test/unit/bankedbytes.test.js
+++ b/test/unit/bankedbytes.test.js
@@ -72,6 +72,7 @@ import {
   MAGIC_DEFENCE_BATTLE_ALLOWANCE,
   MONSTER_SPELL_LIST_BATTLE_ALLOWANCE,
   BATTLE_ANIM_BATTLE_ALLOWANCE,
+  PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE,
   HIT_FEEDBACK_BATTLE_ALLOWANCE,
   MISS_BATTLE_ALLOWANCE
 } from '../../main/build/battletables.js';
@@ -504,6 +505,19 @@ test('MONSTER_SPELL_LIST_BATTLE_ALLOWANCE is exact, on every RPG-capable board',
 // project-wide. Wrong implementation this catches: a stale allowance
 // drifting from the real assembled cost (measured directly against nesasm's
 // own bank-usage line, not re-derived from the instruction listing).
+//
+// §16 (docs/design-battle-animation.md, fix round 2, P2-3): consolidated
+// back into ONE constant. Fix round 1's own two-name split (243 +
+// WALK_FX_FOLLOW_BATTLE_ALLOWANCE = 21) could never be independently
+// verified by any delta measurement -- the follow snippet lives inside
+// battle_fx_draw's own `.if BATTLE_ANIM_ENABLED` block with no further
+// condition of its own (the walk itself has no flag to gate it on), so
+// every build that turns BATTLE_ANIM_ENABLED on assembles both parts at
+// once; there was no third build variant where one existed without the
+// other. Folding them into one 264-byte constant makes this test what it
+// always effectively was: a real, equality-checkable isolation of the
+// WHOLE shared battle-animation mechanism, not an approximation of two
+// unverifiable halves.
 test('BATTLE_ANIM_BATTLE_ALLOWANCE is exact, on every RPG-capable board', {
   skip: !hasNesasm && 'nesasm not found on PATH'
 }, async (t) => {
@@ -525,6 +539,40 @@ test('BATTLE_ANIM_BATTLE_ALLOWANCE is exact, on every RPG-capable board', {
   }
 });
 
+// §16 (docs/design-battle-animation.md, fix round 1): PARTY_ATTACK_ANIM_
+// BATTLE_ALLOWANCE isolated from BATTLE_ANIM_BATTLE_ALLOWANCE (264, fix
+// round 2's own consolidated figure) by starting from a monster-only
+// baseline (which already pays the shared base) rather than "off" --
+// attack_target's own
+// direct arm (ldx/lda pc_anim_attack,x/ldy/jsr battle_fx_arm_at) is what
+// this isolates, not battle_fx_arm_attack itself, which stays untouched.
+// Wrong implementation this catches: a stale PARTY_ATTACK_ANIM_BATTLE_
+// ALLOWANCE, or attack_target's own new block silently pulling in more of
+// the shared base than it should.
+test('PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE is exact, on every RPG-capable board', {
+  skip: !hasNesasm && 'nesasm not found on PATH'
+}, async (t) => {
+  for (const mapper of CAPABLE_MAPPERS) {
+    const monsterOnly = await measureRegion(t, mapper, (p) => {
+      p.sprites.actors[0].battle.attackAnim = 1;
+    });
+    const monsterAndParty = await measureRegion(t, mapper, (p) => {
+      p.sprites.actors[0].battle.attackAnim = 1;
+      p.party[0].attackAnim = 0; // Hero's own animation
+    });
+    const codeOff = monsterOnly.used - battleTableBytes(monsterOnly.project);
+    const codeOn = monsterAndParty.used - battleTableBytes(monsterAndParty.project);
+    const delta = codeOn - codeOff;
+    assert.equal(
+      delta,
+      PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE,
+      `${mapper.name}: a party member's own attackAnim costs ${delta} bytes of banked code (${codeOff} -> ` +
+        `${codeOn}), but PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE reserves ${PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE} -- ` +
+        'this allowance must equal the real cost exactly, on every board.'
+    );
+  }
+});
+
 // Phase 2a hit feedback (docs/design-battle-animation.md §12.7, §14 "Hit
 // feedback alone -- ledger and cross-gating"). The identical isolation
 // shape as BATTLE_ANIM_BATTLE_ALLOWANCE just above, plus a source/symbol
@@ -780,10 +828,16 @@ test('a mag-only build assembles byte-identical whether or not magic defence exi
   // blocks assemble to nothing when off -- is untouched by the diet (it is a
   // property of conditional assembly, not of which addressing mode a
   // surviving instruction uses).
+  // Re-pinned again (§16, docs/design-battle-animation.md, fix round 1): the
+  // party-caster walk forward (BP_WALK) is unconditional code in the RPG
+  // battle bank, per Chris's own "always on for RPGs" answer -- it moves
+  // every RPG-capable board's own hash the same way BE_RESTORE's +18 and the
+  // join-guard's own +5 above already did, unrelated to magic power/defence
+  // themselves.
   const HASHES = {
-    1: '8ba6e4b3b6df1cf98b6b3b351d4dbab0594f467cc7e97dc2f0625c98e959521a', // MMC1
-    4: '9b3eae678572ed33fbaced014fd621b96c4df5fe1bb957465e4f6d3df3db5e36', // MMC3
-    30: 'f94f6c2cfcb4f04b336e628bc99ece76254fae051ea379286ed68a3ab033e418' // UNROM 512
+    1: '7e29c9a1f3cd8e702c1c5d172755c24f54a79fca5315faae842102dfbffee32d', // MMC1
+    4: 'ce04db38e68a75c30a7cb5c54c9de5ab08cbf6bc66bc0a6de3c42c3467f63bd9', // MMC3
+    30: 'aa0a8b318ac4983476dabe4cf7ff7040c3448e8efd3f1f8129caa68eba75a130' // UNROM 512
   };
   for (const mapper of CAPABLE_MAPPERS) {
     const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-magonly-hash-'));
diff --git a/test/unit/items.test.js b/test/unit/items.test.js
index e404e91..e959353 100644
--- a/test/unit/items.test.js
+++ b/test/unit/items.test.js
@@ -556,7 +556,14 @@ test('a project with no items and no Save is byte-identical to the pre-phase-4b
 // every operand's own encoding changed (2 bytes instead of 3 for a surviving
 // zero-page access), reflowing the whole ROM's contents without changing its
 // size.
-const PINNED_RPG_BASELINE_HASH = '6e5db72887cd78fceaa51ce3e360bb5fd878ad871e586bb4a4fe2af12048d637';
+//
+// Re-pinned again (§16, docs/design-battle-animation.md, fix round 1): the
+// party-caster walk forward (BP_WALK) is unconditional code in the RPG
+// battle bank, per Chris's own "always on for RPGs" answer -- present even
+// on this items-free, spell-free baseline. Size still unchanged (still
+// 147472): the walk added no new PRG bank, only spare room already inside
+// the existing battle-region bank.
+const PINNED_RPG_BASELINE_HASH = 'f8ba3cd039e5e16823495ef09c03043d524e79c2e4f95e7761e2440868110392';
 const PINNED_RPG_BASELINE_SIZE = 147472;
 
 test('an RPG with no items and no Save is byte-identical to the pre-round-4 master build', async (t) => {
diff --git a/test/unit/nameentry.test.js b/test/unit/nameentry.test.js
index 0562870..f6f0c0a 100644
--- a/test/unit/nameentry.test.js
+++ b/test/unit/nameentry.test.js
@@ -92,13 +92,18 @@ const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== '
 // every operand's own encoding changed (2 bytes instead of 3 for a
 // surviving zero-page access), reflowing every fixture's ROM without
 // changing any of their sizes.
+// Re-pinned again (§16, docs/design-battle-animation.md, fix round 1): the
+// party-caster walk forward (BP_WALK) is unconditional code in the RPG
+// battle bank, per Chris's own "always on for RPGs" answer -- both RPG
+// fixtures move; the four action fixtures (sample, sample-mmc1, sample-mmc3,
+// sample-u512), which never reach the battle region at all, stay unchanged.
 const BASELINES = {
   sample: '442565369e9da7011901b459317adb4d3c07d9c24fd8f388bcf92b731829e846',
-  'sample-rpg': '9c679d1a231a79e21ace5327e4ba69f8d78bf7ef772ab080b41bcaa3445f89c2',
+  'sample-rpg': '6944a5a3c80cfe15ab8f044f0c8520b53351d649195f41f2b6ef0a3c07525623',
   'sample-mmc1': '54150a3dc8bc958c56a08b7105423046c8d2503e2c9986210be61387109e9833',
   'sample-mmc3': '7069a6341ae75c5ed1187981a8a1486cf1e61c4ccb3cdc6b208acec5017362ec',
   'sample-u512': '44b4d10952d4ce7da7c7113f8bf186fa19b5558ad1cc12caf7a1ee8472547525',
-  'sample-rpg-mmc1': '2d8ad7deb0d24f1ff370d21890e2b0d315dec5a14ef2a1720aeb1427cb5b9a62'
+  'sample-rpg-mmc1': 'bd51f3d6be9e5459754afcf9b5620a794225e57a33339f7c8b4e28de7255021d'
 };
 
 for (const name of Object.keys(BASELINES)) {
diff --git a/test/unit/rpg.test.js b/test/unit/rpg.test.js
index 4f7ba47..069af9c 100644
--- a/test/unit/rpg.test.js
+++ b/test/unit/rpg.test.js
@@ -60,6 +60,7 @@ const ITEMS_USED = 0x39;
 const BOX_STATE = 0x40;
 const BT_PHASE = 0x53;
 const BT_ACTOR = 0x54;
+const BT_WALK_STEP = 0xae; // engine/constants.asm -- chained after bt_miss_left, unconditionally
 const BT_SEL = 0x55;
 const BT_TARGET = 0x56;
 const BT_DMG_LO = 0x58;
@@ -120,6 +121,8 @@ const BP_SPELLS = 3;
 const BP_ITEMS = 4;
 const BP_MESSAGE = 6;
 const BP_DONE = 11;
+const BP_WALK = 12; // engine/constants.asm -- §16, fix round 1: the party caster's own step forward
+const WALK_TICKS = 8; // engine/constants.asm -- §16, fix round 1
 
 const BC_FIGHT = 0;
 const BC_MAGIC = 1;
@@ -277,6 +280,29 @@ function waitForMenu(nes, budget = 900) {
   assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'the menu never came round');
 }
 
+/** §16 (docs/design-battle-animation.md, fix round 1): a party caster's own
+ *  step forward now sits between confirming a physical Attack's target or an
+ *  all-target spell cast, and BP_ACT actually resolving it -- WALK_TICKS
+ *  frames of BP_WALK, plus one more for the phase transition itself, before
+ *  battle_act ever runs. Every test that used to assert on BP_ACT/BP_MESSAGE
+ *  the frame right after confirming a FIGHT target or a MAGIC cast now needs
+ *  to run past BP_WALK first, the identical "drive past a mechanism every
+ *  battle-driving test must get through before its own assertions can run"
+ *  shape bootPastNaming already established for the naming grid. */
+function stepPastWalk(nes, budget = WALK_TICKS + 4) {
+  for (let i = 0; i < budget && nes.cpu.mem[BT_PHASE] === BP_WALK; i++) nes.frame();
+}
+
+/** The identical shape as stepPastWalk, for a test driving battle_tick
+ *  directly through callRoutine (an isolated-routine harness, no real input
+ *  polling) rather than nes.frame()'s own button/PPU-driven loop. Lands on
+ *  BP_ACT, the tick battle_walk_wait's own bcs branch sets it on -- one
+ *  more real tick (the caller's own, not this helper's) is what actually
+ *  runs battle_act and moves past it. */
+function callThroughWalk(nes, battleTickAddr, budget = WALK_TICKS + 4) {
+  for (let i = 0; i < budget && nes.cpu.mem[BT_PHASE] === BP_WALK; i++) callRoutine(nes, battleTickAddr);
+}
+
 /**
  * `count` tiles of the nametable at $2000, starting at (row, col) -- the raw
  * tile ids battle.asm/battleui.asm actually wrote, comparable directly to
@@ -3611,17 +3637,19 @@ test('killing a whole formation in one tick queues at most one wipe row a frame,
     return originalWrite(address, value);
   };
 
-  nes.buttonDown(1, A); // Ember, scope "all" -- resolves immediately, killing all four
+  nes.buttonDown(1, A); // Ember, scope "all" -- walks forward, THEN resolves, killing all four
   current = 0;
   nes.frame();
   writesPerFrame.push(current);
   nes.buttonUp(1, A);
-  // Just long enough to cover the cast's own message and the full wipe
-  // drain (measured at 16 frames for four monsters' four rows each) --
-  // deliberately short of MSG_HOLD (45 frames), past which the message
-  // auto-advances on its own and queues unrelated post-battle traffic
-  // (the victory line, and so on) that has nothing to do with this fix.
-  for (let i = 0; i < 25; i++) {
+  // §16 (docs/design-battle-animation.md, fix round 1): the walk (WALK_TICKS
+  // frames of BP_WALK, plus one more for the phase transition) now sits
+  // between this A-press and the cast actually resolving -- push the budget
+  // out by that much on top of the original "cast's own message and the
+  // full wipe drain" window (still deliberately short of MSG_HOLD, 45
+  // frames, past which the message auto-advances and queues unrelated
+  // post-battle traffic that has nothing to do with this fix).
+  for (let i = 0; i < 25 + WALK_TICKS + 4; i++) {
     current = 0;
     nes.frame();
     writesPerFrame.push(current);
@@ -4219,12 +4247,25 @@ test('a combatant poisoned and burned on its own turn takes both ticks, in order
   const actorAtStart = nes.cpu.mem[BT_ACTOR];
   chooseCommand(nes, BC_FIGHT);
   assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should ask who to hit');
-  tap(nes, A, 5); // confirm the target -- the attack lands and its own line shows
+  tap(nes, A, 5); // confirm the target -- walks forward, then the attack lands and its own line shows
+  stepPastWalk(nes);
+  nes.frame(); // the tick that lands on BP_ACT does not itself run battle_act
   assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, "the attack's own line should be up");
+  // §16 (docs/design-battle-animation.md, fix round 2, P2-4): the walk offset
+  // is still held at its full, stepped-forward value while the action's own
+  // message is up -- the reset only fires at message DISMISSAL
+  // (battle_message_done), not before.
+  assert.equal(nes.cpu.mem[BT_WALK_STEP], WALK_TICKS, "the actor's own walk offset should still be at its full, stepped-forward value with the attack's own line up");
   const startHp = nes.cpu.mem[PC_HP];
 
   tap(nes, A, 5); // dismiss the attack's own line -- poison should go first, lowest bit
   assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'a status tick should have raised its own line');
+  // §16 (fix round 2, P2-4): dismissing the action's own message resets the
+  // walk offset BEFORE the status tick's own line ever shows -- every status
+  // line is drawn at the actor's ORIGINAL position, never the walked-forward
+  // one (§16.3a/§16.3b, corrected from amendment round 1's own wrong claim
+  // that it stayed stepped-forward through status ticks too).
+  assert.equal(nes.cpu.mem[BT_WALK_STEP], 0, "the walk offset must already be reset before poison's own line shows");
   assert.equal(startHp - nes.cpu.mem[PC_HP], POISON_DMG, "the first tick should be poison's own amount");
   assert.deepEqual(
     nametableRow(nes, MSG_ROW + 1, MSG_COL, 9),
@@ -4234,6 +4275,7 @@ test('a combatant poisoned and burned on its own turn takes both ticks, in order
 
   tap(nes, A, 5); // dismiss the poison tick -- burn should follow, on the same turn
   assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the second status tick should have raised its own line');
+  assert.equal(nes.cpu.mem[BT_WALK_STEP], 0, "the walk offset must stay reset before burn's own line shows too");
   assert.equal(startHp - nes.cpu.mem[PC_HP], POISON_DMG + BURN_DMG, "the second tick should add burn's own amount, not repeat poison's");
   assert.deepEqual(
     nametableRow(nes, MSG_ROW + 1, MSG_COL, 9),
@@ -7239,6 +7281,17 @@ test('multi-target hit-feedback policy: an all-target spell hitting 3 living mon
   const addrOf = selectBattleBank(nes, built);
   const { BT_HURT_SLOT, BT_HURT_LEFT } = resolveHurtAddrs(built);
   const battleTickAddr = addrOf('battle_tick');
+  // Root-caused, review round 2 of the amendment: this test's own callRoutine
+  // masks NMI via $2000 but leaves rendering ON via $2001, so a manual
+  // vram_drain (an NMI-only routine, engine/text.asm:150-176) can run on a
+  // visible scanline, where rendering itself moves the PPU address between
+  // the $2006 pair and the $2007 write -- not a phase-2a engine defect, a
+  // test-harness contract violation (vram_drain assumes it only ever runs
+  // during NMI, exactly as engine/boot.asm:351-353 calls it). Forced blank
+  // for manual VRAM drains outside NMI, in this isolated test only -- never
+  // inside callRoutine itself, since other callers assert real rendered
+  // pixels and depend on rendering staying on.
+  nes.mmap.write(0x2001, 0);
   const ATTR0 = 0x00;
   const ATTR1 = 0xaa;
   const ATTR2 = 0x55;
@@ -8478,10 +8531,16 @@ test('real dismissal and next-turn lifecycle: a real miss dismisses cleanly thro
   callRoutine(nes, battleTickAddr);
   assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should have asked who to hit');
 
-  // Tick 2: BP_TARGET + A -- confirm the target.
+  // Tick 2: BP_TARGET + A -- confirm the target. §16 (docs/design-battle-
+  // animation.md, fix round 1): this now walks first (BP_WALK) before
+  // BP_ACT -- callThroughWalk drives past it, the identical mechanism
+  // stepPastWalk uses for a frame-paced test.
   nes.cpu.mem[PAD_NEW] = BTN_A;
   callRoutine(nes, battleTickAddr);
-  assert.equal(nes.cpu.mem[BT_PHASE], BP_ACT, 'confirming the target should have moved to BP_ACT');
+  assert.equal(nes.cpu.mem[BT_PHASE], BP_WALK, 'confirming the target should have started the walk forward');
+  nes.cpu.mem[PAD_NEW] = 0;
+  callThroughWalk(nes, battleTickAddr);
+  assert.equal(nes.cpu.mem[BT_PHASE], BP_ACT, 'the walk should have moved on to BP_ACT');
 
   // Tick 3: BP_ACT -- the real attack resolves this tick, forced to miss
   // (underflow) -- attack_target -> attack_missed -> battle_miss_arm, all
@@ -8610,12 +8669,16 @@ test('message-cap asymmetry, real lifecycle: a real landed hit keeps counting on
   for (let slot = 2; slot < 8; slot++) nes.cpu.mem[TURN_ORDER + slot] = 0xff;
   nes.cpu.mem[BT_PHASE] = BP_MENU;
 
-  // Tick 1-2: FIGHT, confirm the target.
+  // Tick 1-2: FIGHT, confirm the target. §16 (docs/design-battle-animation.md,
+  // fix round 1): confirming now starts the walk (BP_WALK) before BP_ACT.
   nes.cpu.mem[PAD_NEW] = BTN_A;
   callRoutine(nes, battleTickAddr);
   assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET);
   nes.cpu.mem[PAD_NEW] = BTN_A;
   callRoutine(nes, battleTickAddr);
+  assert.equal(nes.cpu.mem[BT_PHASE], BP_WALK);
+  nes.cpu.mem[PAD_NEW] = 0;
+  callThroughWalk(nes, battleTickAddr);
   assert.equal(nes.cpu.mem[BT_PHASE], BP_ACT);
 
   // Tick 3: the real attack resolves, forced to land -- RNG seeded to a
@@ -8891,12 +8954,18 @@ test('MISS overlay: the real M/I/S/S glyph shape renders at the dodging monster
     for (let px = 0; px < 32; px++) before.push(pixelAt(anchorX + px, anchorY + py));
   }
 
-  // Confirm the target: the attack resolves the very same tick, forced to
+  // Confirm the target: §16 (docs/design-battle-animation.md, fix round 1)
+  // walks forward first (BP_WALK), THEN the attack resolves, forced to
   // miss (party acc: 0), arming the overlay for real through
-  // attack_missed -> battle_miss_arm. A modest frame budget lands well
-  // inside the 30-tick countdown and past the one-frame OAM-DMA lag the
-  // phase 1b pixel test above already documents.
+  // attack_missed -> battle_miss_arm. A modest frame budget past the walk
+  // lands well inside the 30-tick countdown and past the one-frame OAM-DMA
+  // lag the phase 1b pixel test above already documents.
   tap(nes, A, 5);
+  stepPastWalk(nes);
+  // The tick that lands on BP_ACT does not itself run battle_act; a few
+  // more for the OAM-DMA lag, the identical slack the pre-walk
+  // tap(nes, A, 5) budget already gave this same assertion.
+  for (let i = 0; i < 6; i++) nes.frame();
   assert.notEqual(nes.cpu.mem[BT_DMG_HI], 0, 'sanity: this must have been a miss, not a landed hit');
 
   const after = [];
@@ -9003,7 +9072,11 @@ test('MISS overlay + battle animation: both the flipbook’s own frame and the M
   // party's own physical attack never arms either.
   chooseCommand(nes, BC_FIGHT);
   assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should ask who to hit');
+  // §16 (docs/design-battle-animation.md, fix round 1): confirming now
+  // walks forward (BP_WALK) before the attack resolves.
   tap(nes, A, 3);
+  stepPastWalk(nes);
+  nes.frame(); // the tick that lands on BP_ACT does not itself run battle_act
   assert.equal(nes.cpu.mem[BT_DMG_HI], 0, 'sanity: the party’s own attack must have landed (acc: 255, eva: 0)');
   assert.equal(nes.cpu.mem[BT_PHASE], BP_MESSAGE, 'the party’s own message should still be up, not yet dismissed');
 
```
