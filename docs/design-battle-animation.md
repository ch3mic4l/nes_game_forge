# Design: battle-side animation (ROADMAP item 14 point 3 + item 13 point 2), v4.1

What an animation is on the battle screen, and the one engine mechanism that plays a monster's own
attack/cast visual and a spell's own cast visual through it.

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

Together, both real, cheap, and now both reviewable. Shipping both together would share the
arm/tick infrastructure (one `bt_hurt_slot`/`bt_hurt_left` pair), a real but unmeasured saving
relative to summing the two standalone figures.

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

**Phase 2 — hit/miss feedback (§2(e)), independently gated and independently ROM-neutral.** The
sprite hit-blink and the block-art attribute flash, each its own small addition (Appendix B/C),
sharing one `bt_hurt_slot`/`bt_hurt_left` pair if both ship together. Deciding between the
packet-every-tick shape measured here and an edge-only shape is this phase's own design question,
not settled by this document.

**Phase 3 — UI polish.** The Magic Forge preview canvas, gated on a frame-for-frame trace test
existing first.

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
- **The exact combined byte cost of shipping both phase-2 halves together** is reasoned from the
  shared-state argument (less than 50 + 76 = 126), not itself built as a third prototype.
- **Whether an edge-only (two-packets-per-hit) shipped version of the attribute flash would cost more,
  fewer, or the same code bytes as the measured packet-every-tick prototype** is genuinely unknown —
  the EDGE-ONLY shape specifically was not built, and this document makes no claim about it either
  way (round 3, finding 6; corrected wording round 4, finding 1 — the packet-every-tick shape *was*
  built, and, as of round 4, correctly, so only one of the two shapes is actually unmeasured here).

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
