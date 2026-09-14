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

**Phase 2, superseded by the shippable design below — recommended as ONE phase, not settled by
Chris as one.** Attribution, precisely: Chris's own answer 1 (§10) says the two HIT-FEEDBACK halves
(sprite blink, attribute flash) ship together, sharing one `bt_hurt_slot`/`bt_hurt_left` pair — it
says nothing about whether MISS (answer 3, a separate, new requirement) joins them in the same
release. Whether hit feedback and MISS ship as one phase or two is this document's own
recommendation, not a recorded Chris decision, and §8 still lists it as an open question for that
reason.

Splitting into 2a (hit feedback) / 2b (MISS) was considered and rejected as the DEFAULT, not ruled
out: the two share no code (hit feedback's `bt_hurt_*` pair and MISS's `bt_miss_*` pair are
independent state, per §12/§13 — see §13.2's own "why not merge with `bt_hurt_*`" note), so
splitting would not simplify either side's own review, and MISS alone is a materially smaller and
lower-risk change (134 of the combined 367 banked bytes, no attribute-cell/`wipe_tick` interaction
to get right) that could ship first if Chris would rather de-risk in two steps — a real option,
still open in §8, since nothing about the mechanism forces one order. **Recommendation: one phase**,
because the two together are still a small, ROM-neutral (gated) addition, and reviewing the shared
arm-point discipline (§12.3) once, against both halves at once, is more likely to catch a real
interaction bug than reviewing it twice against each half in isolation — round 1's own review, which
found real bugs in exactly that shared arm-point discipline, is itself evidence for this.

- Gated the identical shape phase 1 already established — see §12.7 for the gating options and the
  recommendation, an open question for Chris (§8).
- All six checked-in fixtures stay off; every test needing the feature builds its own `mkdtemp`
  variant, the identical policy phase 1b already holds to.
- No save-format change: none of `bt_hurt_slot`/`bt_hurt_left`/`bt_miss_slot`/`bt_miss_left` is
  session state — all four are battle-local, reset every fresh battle (§12.2, §13.2) the same way
  `bt_fx_anim` already is, never written to a save record.
- The MISS glyph art (§13.5) and the `spriteReservedRanges`/`BATTLE_FX_OAM_ROOM` generator changes
  (§13.6) ship in the same commit as the engine routines — a MISS overlay with no tiles stamped for
  it, or an OAM budget that does not yet know about it, is not a partial feature, it is a silent
  garbage-tile bug the moment the first attack misses.

**Phase 3 — UI polish.** The Magic Forge preview canvas, gated on a frame-for-frame trace test
existing first. Unaffected by phase 2 — no shared code with either hit feedback or MISS.

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

### Phase 2's own open questions (unanswered as of this writing)

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

## §9. Out of scope, explicitly

- Party-member attack animations of their own (§8).
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
  `LDA #$00`, not noise.
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

gated on a new `projectUsesHitMiss`-shaped predicate (§8's own open gating question) and wired into
`battleRegionBytes` the identical no-`&& banked` shape `BATTLE_ANIM_BATTLE_ALLOWANCE` already uses.
**No kernel-lo term at all** — every routine in §12.3 lives entirely in the banked battle region;
nothing here is reachable from the field. No OAM cost at all (the sprite-blink half only ever
*skips* drawing an icon already counted in `battleCombatantOamMax`, never adds one — unlike MISS,
§13.6); the `vram_buf` cost is bounded in §12.6, not zero as the pre-fix design claimed.

See §13.6 for the combined figure (367) and the isolated MISS figure (134), and §11's own bullet for
the exact, now-identified 2-byte gap between the two isolated deltas summed and the real combined
delta.

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

**Round 1 finding 8's own re-chaining note.** `bt_miss_slot`'s own definition (`= bt_hurt_left+1`)
depends on `bt_hurt_left` existing — if hit feedback (§12) is ever stripped out on its own (the
isolated-measurement variant this design's own figures are built from, or a future project that
ships MISS without hit feedback), `bt_miss_slot` must be re-chained to `bt_fx_timer+1` directly, or
it is left referencing an undefined equate and the build fails outright. Both isolated variants
Appendix D's own figures come from do this re-chaining as part of stripping the other half; it is
not automatic and must be done by hand each time, since nesasm has no notion of "chain to whichever
of these two symbols happens to exist."

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

**Battle-entry reset**: `setup_monsters` clears `bt_miss_left` to 0 alongside `bt_hurt_left` (§12.4),
same `lda #0` store (round 1 finding 8's own explanation of the 2-byte measurement gap).
`bt_miss_left`'s own lifetime across `battle_end`/`player_died` is identical to `bt_hurt_left`'s
(§12.4): neither routine clears it, and the `BP_INTRO` guard above is what makes that safe.

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
the identical shape as the new `HIT_MISS_ENABLED` flag (§12.7/§8's own gating question):

```js
// shared/project.js -- spriteReservedRanges
if (projectUsesHitMiss(project)) {
  ranges.push({ start: MISS_TILE_M, end: MISS_TILE_S + 1, label: 'the MISS overlay' });
}
```

**Stamping**, the `SPRITE_ARROW_ART` precedent (`main/build/generate.js:2672-2673`), applied to all
three MISS glyphs, into every tileset (a project can set ANY tileset as its `battleTilesetId`, so
every one keeps the slots free, the identical reasoning the arrow tile's own stamping already
uses):

```js
// main/build/generate.js
if (projectUsesHitMiss(project)) {
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

gated the same way as the rest of §13 (only when `projectUsesHitMiss`, §12.7/§8) — a project that
never opts in pays nothing here either, the identical byte-identity discipline `fxTiles` itself
already holds to when no battle animation is authored. `validateProject`'s own gate is
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
  const missTiles = projectUsesHitMiss(project) ? MISS_OAM_TILES : 0;
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

## §14. Phase 2 test plan

The identical §6-style table — shape, and the wrong implementation each row catches. Rows marked
**round 1** are new or rewritten in response to round 1's review; rows marked **round 2** are new
or rewritten in response to round 2's; the rest are carried over unchanged.

| Test | Shape | Wrong implementation it catches |
|---|---|---|
| Off-path byte-identity | `monsterlevel.test.js`-shape, `HIT_MISS_ENABLED` off | A gate that assembles even one byte of §12/§13's own code unconditionally |
| Ledger isolation, hit feedback alone | `bankedbytes.test.js`-shape, `assert.equal` on the measured 235-byte delta, all three boards | A stale allowance figure drifting from the real assembled cost |
| Ledger isolation, MISS alone | Identical shape, the measured 134-byte delta | Same, for the independently-measured MISS figure |
| Combined equality | Both live together, the measured 367-byte delta — NOT the sum of the two isolated deltas (369), the real combined figure, 2 bytes different for the identified reason (§11) | A ledger that sums two allowances instead of measuring the real combined cost, silently 2 bytes wrong |
| **round 2 — Multi-target sentinel integrity, corrected observation point (finding 4, P2, supersedes round 1's own row)** | Drive a real all-target spell through `cast_all` with a controlled formation of 4 living block-art monsters at LOW actor id (0) AND, in a second case, HIGH actor id (31, the reviewer's own reproduction, genuinely in range and above the loop boundary for a real 32-actor project); observe `bt_tmp2` with a breakpoint/trace AT `cast_all_next`, immediately after EACH `apply_damage` call — never after `cast_all` returns, since `battle_say_actor`'s own name lookup (`push_combatant_name`, `engine/battleui.asm:639-666`) legitimately reuses `bt_tmp2` as its own character-countdown scratch once the loop has finished, so a post-return read is 0 by design and proves nothing about the loop's own integrity; assert (a) `bt_tmp2` reads exactly `cast_all`'s own end-of-side sentinel at every one of those in-loop observations, (b) every intended target's own HP dropped by the rolled amount, and (c) no combatant OUTSIDE the intended side took damage | The stated design (§12.3) is already correct — this row exists to make sure the TEST oracle observes the right moment; a test written as "call `cast_all`, then check `bt_tmp2`" would reject the correct engine (round 2's own reproduction: sentinel 8 at every in-loop observation, 0 on return, both expected) |
| mon_tile guard | Arm hit feedback on a metasprite-fallback monster's slot; assert no attribute packet is ever queued for it, only the icon-skip draws | The missing guard §2(e) recorded against Appendix C, reopened |
| **round 1 — Dead-monster restoration, not abandonment (finding 2, P2, replaces the old "Dead-monster abandon" row)** | Arm the flash on a block-art monster with another monster ALSO alive; land a lethal hit on the flashing one (setting `bt_wipe_mask`'s own bit) at both blink parities (mid-flash-tint and mid-authored-tint) in separate cases; let `wipe_tick` run to completion (4 ticks, full row erase); assert the PPU attribute byte for that cell reads `BT_GROUND_ATTR` ($55) once the dead-check has fired, not the flash tint and not the monster's own `mon_attr` — and assert the STILL-ALIVE monster's own cell is untouched throughout | The design's own previous policy ("abandon, no restore") passing this exact scenario with a permanently stranded `$FF` — round 1's own review reproduced this directly against the assembled prototype |
| **round 1 — Arm-time death restoration (finding 2's second path)** | An all-target spell's own `cast_all` loop kills a flashing block-art monster on an early iteration, then re-arms onto a different target on a later iteration in the SAME tick; assert the killed monster's own cell reads `BT_GROUND_ATTR`, not stranded, even though `battle_hurt_tick` never gets another chance to see that slot | `battle_hurt_restore_slot` skipping the dead old slot entirely (its pre-fix behavior), stranding the tint the tick-based fix alone cannot reach once the shared pair has moved on |
| Multi-target hit-feedback policy | An all-target spell hitting 3 living monsters in one tick; assert only the LAST-processed slot ends up blinking, and that each EARLIER slot's own arm-then-supersede never left a visible blink (one tick, per the stranding fix) | A partial fix that blinks the first target instead of the last, or leaves an earlier target visibly blinking for a stray tick |
| **round 2 — vram_buf queue-length, corrected schedules (finding 1, P2, supersedes round 1's own row, which requested 5 block-art monsters — one more than `MAX_MONSTERS = 4` allows)** | Two cases, both driven through real dispatcher transitions: (a) the 20-byte feedback maximum — an already-armed hurt slot 7 (the 4th monster, block-art, already flashing from an earlier hit) superseded by an all-target spell hitting all 4 LIVING block-art monster slots 4-7 in turn, never a fifth monster; assert exactly 5 feedback packets (1 tick + 4 re-arms, 20 bytes) queued, distinct from `cast_all`'s own 28-byte message; (b) the 127-byte whole-frame maximum — the six-`battle_tick` sequence in §12.6 (an all-target spell kills 3 monsters and leaves the 4th flashing, A dismisses the message, the next actor's own menu opens, Down selects MAGIC, A opens the spell list, B closes it); assert the queue length/packet count on the LAST tick is exactly 11 (wipe) + 4 (flash) + 112 (`battle_list_back`) = 127 bytes — not merely that a sampled PPU byte looks stable, which cannot distinguish "no packet queued" from "the same value queued twice" | The round-1 test's own impossible 5-monster construction (silently vacuous, since no real project can reach it); a reachable-schedule claim that stops at the wrong (too-small, wrong-chain) 112-byte figure instead of the real, larger 127-byte one. This row exercises only the two DEMONSTRATED cases (20/48 bytes and 127 bytes, §12.6); the 111- and 59-byte rows are upper-bound arithmetic only, not independently tested here or anywhere else in this plan (round 3 finding 3) |
| **round 2 — MISS OAM overflow, corrected boundary and oracle (finding 2, P2, supersedes round 1's own row, which wrongly called 64-without-MISS "already overflowing")** | Four projects, each with `battleCombatantOamMax` values of exactly 60, 61, 64, and 65 (multiple icons, no `attackAnim` authored anywhere), each built both with MISS off and MISS on, asserted through `validateProject`'s own warning array (`used > limit`, `shared/project.js:7402`), never through calling `describeBattleSpriteWarning` directly (an unconditional formatter, not a gate): (a) at 60, MISS off or on, no warning (60, then 64, neither exceeds 64); (b) at 61, no warning MISS off, a NEW warning MISS on (65 > 64) — the case MISS itself causes; (c) at 64, no warning MISS off (exactly at the limit, not over it — round 1's own row wrongly assumed this already warned), a NEW warning MISS on (68 > 64); (d) at 65, a warning already fires MISS off (genuine pre-existing overflow, unrelated to MISS), and still fires MISS on, unchanged in cause | Round 1's own row's false premise that 64-without-MISS already warns, which would have let a test pass while asserting the wrong thing at the exact boundary that matters; asserting via `describeBattleSpriteWarning` instead of the real gate, which can be called and formatted without ever having actually fired |
| **round 2 — MISS OAM overflow, exact-fit boundary restored (finding 5, P2, IN ADDITION to the row above, not a replacement)** | A project where `battleCombatantOamMax` + the worst authored `attackAnim`/`spell.anim` frame + `MISS_OAM_TILES` sums to EXACTLY 64; assert the flipbook's own fit check (`battle_fx_draw`'s `cmp #BATTLE_FX_OAM_ROOM+1`, `engine/battleui.asm:1013`) still admits that frame. A second case: increase the animation's own worst frame by one tile (total 65); assert the WHOLE frame is now rejected (never a partial draw) | A generated `BATTLE_FX_OAM_ROOM` formula missing its own `- MISS_OAM_TILES` term (§13.6) — the row above (no flipbook authored) cannot catch this at all, since it never exercises `battle_fx_draw`'s own runtime fit check; small animations and icons would still render "correctly" with the subtraction missing, silently narrowing the room every future flipbook frame actually gets |
| **round 3 — describeBattleAnimationOamWarning accounts for MISS, corrected off-path oracle (finding 3, P2 from round 2, corrected by round 3 finding 2)** | The reviewer's own reproduction: 60 combatants, one referenced playable `battle.attackAnim`/`spell.anim` animation at 1 tile, MISS enabled (total 60+1+4=65, over the limit); assert the warning text names MISS's own 4 sprites as part of what pushed the total over, not just the animation and the combatants (whose own sum, 61, does not itself exceed 64 and so cannot be the stated reason on its own), AND that every other character of the returned string matches the committed text exactly (the em dash, and the full "Use a smaller animation, or reduce the party/formation/cursor cost elsewhere." advice suffix). **Corrected**: the SAME 60-combatant/1-tile layout does NOT overflow with MISS off (61 ≤ 64), so `validateProject` never calls the helper at all in that case — two off-path assertions instead of one: (i) call `describeBattleAnimationOamWarning` directly with MISS disabled and assert its output is byte-for-byte identical to the committed string (`shared/project.js:3865-3871`); (ii) separately, a layout that still overflows with MISS OFF (e.g. combatants at 65 alone), asserted through `validateProject`, to confirm the real end-to-end off-path warning text is unaffected by this change | The pre-fix warning text citing only the animation and combatants (61) as if that explained an overflow past 64 — a maintainer reading the message would have no way to see that MISS was the actual cause; round 2's own "MISS disabled" case asserted through `validateProject` at a layout (61 total) that never calls the helper at all, silently passing without exercising the off-path code path |
| **round 1 — Real attack-path miss coverage (finding 6, P2, replaces the old "Sole-miss invariant" row)** | Drive `attack_target` (party) and `monster_turn_attack` (monster) through `roll_hit` with a controlled RNG forcing a miss on each path in turn; assert `battle_miss_arm` fires, `bt_miss_slot`/`bt_miss_left` are set to the real dodging target, the overlay renders at that target's own anchor, the message ("X misses") and the overlay both appear, and the overlay disappears exactly at `BT_MISS_FRAMES` ticks (30) OR at message dismissal, whichever comes first. A second case: dismiss the message EARLY (before 30 ticks), then immediately force a SECOND miss on the next turn; assert the first overlay is gone and the second one starts clean, never overlapping | The impossible-construction row it replaces would still pass if a future engine change made a spell or status path call `roll_hit` — it asserted nothing about either real call site ever invoking the overlay at all |
| **round 1 — Non-miss negative coverage (finding 6)** | Drive `item_chosen_none` (a non-healing item — round 2 finding 6: the item is never consumed either, since `item_chosen`'s own `beq item_chosen_none` branches around `remove_item` before it runs, §13.1), `battle_menu_failed` (a failed flee roll), a damage spell, a status-effect spell, and a status tick (poison/burn); assert `battle_miss_arm` is never called and `bt_miss_left` never becomes nonzero from any of these five paths | A future call site wired to `battle_miss_arm` by mistake, or a broadened `roll_hit` call reaching one of these paths without the design noticing |
| **round 1 — Hit-flash trace, both bands and cessation (finding 6, corrected per round 2's own remaining note)** | Arm the flash on a living block-art monster; sample the real PPU attribute byte every tick across the full `BT_HURT_FRAMES` (20) countdown; assert both the authored-tint band and the flash-tint band are each visible for two consecutive ticks (the `and #2` cadence, §12.1/round 1 finding 9), the terminal tick forces the authored tint regardless of which band it would otherwise be in, and that cessation past the terminal tick is confirmed by a DIRECT queue observation (no packet appended to `vram_buf` on any tick after the terminal one) — not source inspection alone, which the round-1 design leaned on for this exact claim | A cadence that silently reverts to single-tick alternation, or a terminal tick that lands mid-band and leaves the wrong tint; a queue that keeps appending duplicate packets past cessation, invisible to a PPU-byte-only check the same way finding 1's own reachability claim was |
| BP_INTRO guard (round 1 finding 7) | Leave `bt_hurt_left`/`bt_miss_left` nonzero (simulating a stale value from a previous battle or uninitialized RAM), start a fresh battle, and inspect `vram_buf`/OAM writes specifically on the FIRST tick, while `bt_phase` still reads `BP_INTRO` — not just the timer values after `setup_monsters` has run; assert neither tick routine decrements or queues anything on that tick | The guard's own absence (round 1's own review reproduced a stale timer of 20 becoming 19 and queuing a real packet during `BP_INTRO`, before reset) |
| Battle-entry reset | Leave `bt_hurt_left`/`bt_miss_left` nonzero at the end of one battle (a hit or miss still counting down when the fight ends, and NOT cleared by `battle_end`/`player_died` — §12.4's own accurate lifetime statement), start a fresh battle, assert both read 0 once `setup_monsters` has run (post-`BP_INTRO`) | Appendix B/C's own recorded limitation, reopened |
| Message-cap asymmetry | Land a hit AND draw a miss in close succession, dismiss the miss's own message early; assert `bt_miss_left` is force-cleared at dismissal while a separately-still-counting `bt_hurt_left` (from an earlier, unrelated hit) is NOT | A blanket cap that treats both timers the same, contradicting §12.4/§13.4's own stated asymmetry |
| Rendered-pixel MISS overlay | Real `nes.ppu` frame-buffer read, arm MISS over a combatant, assert the M/I/S/S tiles are visible at the expected offset | A draw-order or coordinate regression |
| Rendered-pixel priority | Arm both a flipbook AND MISS in the same tick (a monster's own missed attack, §12.4); assert both are visible, neither silently dropped by an OAM-budget miscalculation | The combined-frame OAM interaction (§13.6) going untested until a real project hits it |
| **round 3 — Reservation integration, on/off, corrected blank-reference oracle (finding 5, P2 from round 2, corrected by round 3 finding 1)** | Eight cases against a project with `HIT_MISS_ENABLED` on, mirroring `SPRITE_ARROW_TILE`'s own existing test coverage: (a) artwork painted at `$FA`-`$FC` in a tileset is refused, naming "the MISS overlay" and the real `$FA`-`$FC` range, never the cursor's own `$FD` wording; (b) **corrected** — a metasprite that REFERENCES a blank `$FA`-`$FC` tile IS refused (`shared/project.js:6577-6590`'s own existing, generic reference-collision check: stamping would replace that blank with a MISS glyph, so a metasprite pointing at it would unexpectedly display one), naming "the MISS overlay" and the tileset — the identical mechanism `SPRITE_ARROW_TILE`/the HUD hearts already inherit, extended automatically once `spriteReservedRanges` carries the MISS range; (b2) a genuinely blank, UNREFERENCED `$FA`-`$FC` tile (no metasprite points at it) is ALLOWED, not refused — the distinct, permitted case (b) used to conflate with the refused one; (b3) the SAME blank-reference scenario from (b), in an otherwise-clean project (no other applicable reservation or unrelated validation error) with `HIT_MISS_ENABLED` OFF, produces no error at all — confirming the refusal is genuinely gated on the feature, not a pre-existing check that happened to already cover `$FA`-`$FC`; (c) the Tile Forge's own shading hint names the MISS range and reason, not the cursor's; (d) the Tile Forge's own tile shading covers `$FA`-`$FC` when `HIT_MISS_ENABLED`; (e) `MISS_TILE_M`/`I`/`S` art is stamped into EVERY tileset, on all three RPG-capable boards, not only the currently-selected battle tileset; (f) with `HIT_MISS_ENABLED` off, none of the above fires and no tileset gains the stamped art — off-path byte-identity for the reservation itself | No existing §14 row exercised the range-aware refusal/hint changes at all (round 1's own finding 5 was a design-only fix, unverified); off-path ROM identity and a rendered MISS overlay cannot themselves catch a wrong warning label or a reservation that silently fails to refuse occupied artwork; round 2's own (b) row asserted the OPPOSITE of `shared/project.js:6577-6590`'s own existing contract — it would have rejected the correctly integrated implementation, or encouraged removing an existing protection to make the (wrong) test pass |

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
§12.7 (hit feedback alone, 235, up from 204) and §13.6 (MISS alone, 134, up from 128) are measured
against this same rebuilt diff. See §11's own bullet for the exact, now-identified 2-byte gap
between 235+134=369 and this real combined figure (round 1 finding 8: the shared `lda #0` in
`setup_monsters`). Unconditional (no `.if` gate) throughout, the identical measurement-only shape
Appendix A/B/C already used — a real shipped version gates all of it on `HIT_MISS_ENABLED` (§12.7/
§13.5/§8's own open gating question).

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
