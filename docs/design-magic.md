# Design: the Magic Forge — extraction, settled scope, and the spell-id renumber

Scope, restated from the brief: the Forge extraction plus item 13's already-settled scope
(damage/heal ranges, the element-list append, the "where" strings). **Not** spell animation
(item 13's own least-designed part, shared with item 14, decides which bank pays and stays open
until that shared design happens) and **not** generalizing status effects beyond poison (its own
slice, storage already has the spare bits but the logic doesn't generalize yet). §13 states in one
place what this extraction must not foreclose for either excluded thread. No source code was
written for this design; every claim below was checked against the tree as it stands (post
name-stride, `afc20d4`), not against the brief's own line numbers where those have drifted — the
brief's amendment already flagged the post-~300 shift, and one further correction turned up during
this pass (§8.0) that the amendment did not know about.

## §0. What I read

`ROADMAP.md` item 13 in full and item 14's opening paragraph and point 3 (shared animation
question); `handoff-roadmap-magic/roadmap-magic-report.md`; CLAUDE.md's battle-system section (the
banked region, `battleRegionBytes`, `BASE_BATTLE_CODE_BYTES_BY_MAPPER`, `BATTLE_SLACK`, the
Forge-registry paragraph); `handoff-maporg/design-maporg.md` §6.1
(`remapScreenReferences`/`DROPPED_SCREEN`/canonicalization); `shared/project.js`'s
`renumberActorDeletion` and `renumberItemDeletion` (the closer precedent — same shape, one id
space over); `renderer/forges/items/items.js` (the Items Forge itself, as the extraction and
per-edit-commit precedent) and `renderer/forges/sprite/battle.js` (today's spell/party UI, in
full); `main/build/battletables.js`'s spell/party table emission, `checkBattleTables`,
`battleShortfallAdvice`, `battleRegionBytes`/`battleRegionCeiling`; `engine/battleturn.asm`'s
`cast_heal`/`cast_heal_mon`/`spell_damage`/`spell_damage_weak`/`spell_damage_strong`/`cast_all`;
`engine/rpg.asm`'s `rng_next`; `engine/save.asm`'s `load_apply_body`/`continue_game`;
`shared/save.js`'s `SAVE_FIELDS`/`SAVE_LAYOUT_VERSION`/`saveIdentity`; `renderer/app.js` in full
(rail render, `selectForge`, `app.forgeIds`, the `store.subscribe` open/close handling); the
relevant slice of `main/smoke.js` (project creation defaults, the "all forges mount" step, the
later `sample-rpg` open).

## §1. Inventory — what already exists and moves losslessly

This is a UI reorganization of machinery that already compiles and runs; the move must be lossless,
so every piece is named with its current address:

| Piece | Lives at | Notes |
|---|---|---|
| `project.spells` schema | `shared/project.js:325-349` (`ELEMENTS`, `SPELL_KINDS`, `SPELL_SCOPES`), `:970-980` (`RPG_LIMITS.spells = 32`), `:2485-2487` (`createSpell`), `:3341-3352` (`normalizeSpell`) | `{id, name, mpCost, kind, amount, element, scope}` |
| Spell authoring UI | `renderer/forges/sprite/battle.js:366-451` (`editSpells`, a `showModal`) | Reached from a `Spells…` button on the party tab, `:360` |
| Learned-spells UI | `renderer/forges/sprite/battle.js:195-363` (`partyPanel`), the `Learns` block at `:297-343` | Per party member, one checkbox row per spell, disabled past index 7 unless already learned |
| Compilation | `main/build/battletables.js:205-212` (`NUM_SPELLS`, `spell_cost`/`spell_kind`/`spell_amount`/`spell_element`/`spell_scope`/`spell_name`), `:156-159` (`mon_spell`), `:120-121` (`mon_weak`/`mon_strong`), `:239-250` (`pc_spells_at`) | `elementIndex`/`kindIndex`/`scopeIndex` at `:50-52` |
| Engine consumers | `engine/battleturn.asm`: `cast_spell`/`cast_all`/`cast_heal`/`cast_heal_mon`/`spell_damage`/`monster_turn` | Both sides cast the same spells; `other_side` decides reach |
| Party learn-privilege cap | `engine/battleui.asm:884` (`bit_mask`, 8 entries) | One bitmask byte per member per level — the reason only positions 0-7 are learnable |
| Extraction precedent | `renderer/app.js:9-75` (`FORGES`), `:126-128` (`app.forgeIds`), `renderer/forges/items/items.js` | One Forge module, one registry entry, visited by `main/smoke.js`'s `forgeIds` loop |

Moving cleanly means: the `Spells…` modal's body becomes a Magic Forge page; the party tab's
`Learns` block either moves with it or stays and cross-links (§7.2 decides); every compiled table
and every engine routine is untouched by the move itself (only by §8's min-max change and §7's
compile-time fix, both scoped separately below); `checkBattleTables`/`battleShortfallAdvice`'s
spell-related strings move their `where:` to `Magic Forge` (§9).

## §2. The defect (established; not re-litigated)

Deleting a spell today (`battle.js:440-451`) renumbers `project.spells` by array position and then
"repairs" every party member's learned list by **filtering on surviving id** — which discards
whichever entry happens to reference an id no longer present, and does nothing at all to
`actor.battle.spellId`, so a monster's cast spell silently falls past `NUM_SPELLS` and compiles to
`$FF` (swing-only). Reproduced and confirmed exactly as the brief states (three spells, a member
learning two of them, a monster casting one, deleting the first spell): the survivor's own level
attaches to a spell it never learned, the actually-cast spell is dropped by the filter, and the
monster stops casting with no error anywhere. `normalizePartyMember`'s own load-time filter
(`shared/project.js:3377-3384`, `.filter((entry) => spellCount > 0 && Number(entry?.spellId) <
spellCount)`) is positional in the identical way, so reloading the project does not recover
anything — it just re-derives the same wrong state from the same wrong array.

This is item 7's bug class (a numeric position is not an identity) in `project.spells`. §3 is the
fix.

## §3. The spell-reference primitive

### §3.1 The census (closed; both fields, five cases)

Exactly two fields hold a spell reference — verified by grepping the schema for `spellId` and for
anything indexed against `project.spells`; no event condition, common event, or map structure names
a spell (`ACTOR_CONDITIONS`/`ITEM_CONDITIONS`, `shared/project.js:2148-2157`, have no spell-typed
entry, and nothing else in the condition/command vocabulary reaches `project.spells` at all):

- `party[].spells[].spellId` — one entry per `{spellId, level}` a member has learned.
- `actors[].battle.spellId` — the one spell a hostile actor may cast; `null` means "casts nothing."

They do **not** share a sentinel discipline, and this is the one place a design lifted mechanically
from `renumberActorDeletion` would be wrong:

| Case | `party[].spells[].spellId` | `actors[].battle.spellId` |
|---|---|---|
| Deleted entry (the id being removed) | **Drop the whole `{spellId, level}` entry** — a learn record with no spell to learn is not a record, it is stale data | **Set to `null`** — "casts nothing," the field's own existing sentinel for that state |
| Later entry (id above the deleted one) | Decrement `spellId` by one | Decrement `spellId` by one |
| Existing "nothing" | N/A — there is no such state; an unlearned spell has no entry at all | `null` is a fixed point, left untouched (same reason `NO_ACTOR`/`NO_ITEM` are fixed points in the two precedent functions: walking it down would let it decay back into range as the catalog shrinks further) |

`RPG_LIMITS.spells = 32` means nothing near `$FF` is ever a live id, so unlike actors/items there is
no compiled sentinel value (`NO_ACTOR`/`NO_ITEM`) to collide with in the **project JSON** — the
`null`/dropped-entry discipline above is the whole story at this layer. `$FF` only appears once this
reaches the compiler (`mon_spell`'s own `b.spellId >= spells.length ? 0xff : b.spellId`,
`battletables.js:158`, unchanged by this design — it already treats a stale id past the table the
same as "no spell," which is exactly the belt this primitive is the suspenders for).

### §3.2 Where it lives, and which shape

**`renumberSpellDeletion(project, index)`, beside `renumberActorDeletion`/`renumberItemDeletion` in
`shared/project.js`** — the sibling shape, not the general `remapSpellReferences(project,
translate)` primitive `remapScreenReferences` uses. The brief's own tie-breaker decides it: spells
have no reorder operation today (grepped the Items Forge and the spell/party UI for anything
resembling "move up"/"move down"; neither has one), and the only structural edit that exists or is
planned in this slice is delete-one. `remapScreenReferences`-style generality pays for itself when a
*bijection* (reorder) or a *multi-delete* needs the same walk with a different permutation; a lone
delete is exactly the case the brief names for the simpler sibling, and `renumberItemDeletion` is
the closer precedent regardless — same two-branch sentinel discipline (id-space-local "missing"
value vs. shift), same call shape, already shipped and tested.

```js
export function renumberSpellDeletion(project, index) {
  const shift = (id) => (id > index ? id - 1 : id);
  for (const actor of project.sprites?.actors ?? []) {
    const spellId = actor.battle?.spellId;
    if (typeof spellId !== 'number') continue; // already null -- "casts nothing," a fixed point
    actor.battle.spellId = spellId === index ? null : shift(spellId);
  }
  for (const member of project.party ?? []) {
    member.spells = (member.spells ?? [])
      .filter((entry) => entry.spellId !== index)
      .map((entry) => ({ ...entry, spellId: shift(entry.spellId) }));
  }
  return project;
}
```

No `NO_SPELL`-shaped fixed point is needed for `shift` itself the way `NO_ACTOR`/`NO_ITEM` need one
in the actor/item siblings, because `actor.battle.spellId` is only ever a number *or* `null` at this
layer (never a project-JSON sentinel number) — the `typeof spellId !== 'number'` guard is the whole
fixed-point story. Caller contract matches the two precedents exactly: mutates `project`, returns
it, does not itself splice `project.spells[index]` or re-stamp ids.

**The delete handler is the full Items Forge async identity flow, not a bare `index`** (round 1
review, Medium 7 — the sketch below was previously oversimplified to `store.commit` on a raw
`index` with no capture/re-resolution around the `confirmModal` await, which is exactly the "delete
a different spell after undo/redo or a project change while the modal is open" hazard
`items.js:127-140`'s own comment documents and was itself once a real, fixed bug there — round 1d/1e
findings D2/E4, per that file's own comments). The Magic Forge's delete button reproduces that flow
exactly, one id space over: capture the target *object* before the confirmation `await` (never an
index — an index can point at something else by the time the await resolves), re-resolve its
*current* index by identity afterward, and abort rather than guess if it is no longer found:

```js
onclick: async () => {
  const target = current; // captured before the await, the spell's own identity
  if (!(await confirmModal(
    'Delete spell',
    `Delete "${target.name}"? Anything that casts or has learned it will name nothing instead.`,
    'Delete'
  ))) {
    return;
  }
  const index = store.project.spells.indexOf(target);
  if (index === -1) {
    // Same general phrasing items.js:152-163 settled on after its own round
    // 1e finding E4: an undo/redo restoring a structuredClone and an actual
    // deletion both fail this identity check, and only the second one is a
    // claim this message may honestly make.
    toast('The project changed while that confirmation was open — nothing was deleted. Try again.', 'error');
    render();
    return;
  }
  store.commit('Delete spell', (project) => {
    renumberSpellDeletion(project, index);
    project.spells.splice(index, 1);
    project.spells.forEach((entry, id) => (entry.id = id));
  });
  render();
}
```

Only the re-resolved `index` — never the pre-await one, since there is no pre-await one — reaches
`renumberSpellDeletion`, the splice, and the restamp, in the same one `store.commit` `items.js:167-
171` already establishes as the atomic unit.

**Tests call `renumberSpellDeletion` directly**, the same body the renderer calls — no test-file
mirror. This closes the "a fix that lives only in the editor's Save handler is not acceptable"
requirement: the handler above is real, independently-testable orchestration around a primitive
that is itself independently tested, not the bug's own filter-by-surviving-id logic relocated. The
async capture/re-resolve/abort shell above is Forge-module wiring, not part of the primitive itself
— nothing about it is specific to spells, and an implementer copying `items.js`'s own structure
verbatim (renaming `items`/`item` to `spells`/`spell`) reproduces it correctly by construction.

### §3.3 Ids stay positional

Deliberately **not** stable ids with a compile-time index (the shape `commonEventSeq`/
`resolveCommonEventIds` already establishes for common events, CLAUDE.md's own "The event system"
section). Both shapes exist in this codebase today; the choice between them tracks whether the
collection supports reordering. Common events need stability because the Map/Script tooling
reorders and reuses them across many placements; spells have no reorder feature and, per §3.2, this
slice does not add one. Every id-adjacent collection that *doesn't* reorder in this codebase —
actors, items, party members — stays positional and repairs by renumbering on delete, and spells
join that majority rather than the one outlier. This also means no migration is needed for
`project.spells` itself: ids were already positional (`.map(normalizeSpell)` passes the array index
as `id` on every load, `shared/project.js:3781-3783`), and nothing about this design changes that —
only the *repair on delete* is new. `normalizeSpell`, `normalizePartyMember` and `normalizeActor`
therefore see no format they don't already handle: a project written by the pre-fix code round-trips
through the same clamps they already apply (`normalizePartyMember`'s positional filter,
`normalizeActor`'s plain-byte clamp on `battle.spellId`) — those clamps stay exactly as they are;
they are the load-time backstop for a hand-edited or foreign-tool project, not the mechanism this
design changes. What changes is that the **editor's own delete** no longer produces the broken state
those clamps are backstopping in the first place.

## §4. Schema changes

### §4.1 Damage/heal ranges (`amount` → `amountMin`/`amountMax`)

`spell.amount` (one byte, `normalizeSpell` clamps 1-255) becomes `amountMin`/`amountMax`, both
1-255, `amountMin <= amountMax` enforced by normalization (swap rather than reject, if authored
backwards — matching this codebase's general "fix, don't refuse" normalization stance elsewhere).
One-time migration in `normalizeSpell`, the same idiom `deriveItemEffect`
(`shared/project.js:3497-3501`) already establishes for a different field: a project that has
`amountMin` is read as-is; one that only has the legacy `amount` gets `amountMin = amountMax =
clamp(raw.amount, 1, 255, ...)` once, on load. After the first save under this design, `amount`
itself is no longer written — `amountMin`/`amountMax` are the schema from that point on, the same
one-way migration item 5's own item-effect derivation already shipped.

`min === max` is the byte-for-byte-compatible case, and it is load-bearing, not incidental: every
spell migrated from a flat `amount` starts with `amountMin === amountMax`, and §8's engine change
special-cases that exact condition to skip the roll entirely — no `rng_next` call, no LFSR state
consumed, the identical `spell_amount,x`-read-and-go compiled behavior a pre-migration ROM already
had. Skipping the RNG call (not merely producing the same numeric result) is the part that matters:
`rng_next` advances a single persistent `rng` byte shared by every roll in the battle system (hit
chance, flee chance, a monster's own cast-or-swing coin flip, drop percent), so a roll that
*consumed* a tick even while returning the deterministic answer would shift every later roll in the
same battle relative to today's build — a change existing `test/unit/rpg.test.js` fixtures that
assert specific outcomes would see even though no author-visible number changed. Widening the range
on any spell (making `min !== max`) is what starts consuming `rng_next` for that spell specifically,
and only that spell.

### §4.2 `ELEMENTS` grows by two

Append `{id: 'water', label: 'Water'}, {id: 'holy', label: 'Holy'}` after `dark`
(`shared/project.js:325-333`) — user-settled 31 Aug 2026, not reopened here. Confirmed zero-cost
past the two new dropdown entries themselves: `elementIndex` (`battletables.js:50`) is a
`findIndex`, and every consumer of an element value (`mon_weak`/`mon_strong`/`spell_element`
emission, and `engine/battleturn.asm:628-633`'s `spell_damage`) compares two element **indices**
directly (`cmp mon_weak,y` / `cmp mon_strong,y`) — there is no table anywhere sized `ELEMENTS.length`
and indexed *by* an element value (grepped every reference to `ELEMENTS.length` and to
`elementIndex` in `main/build/` and `engine/`; the three call sites above are the complete set).
Appending costs zero table bytes and zero engine bytes; a monster or spell not yet using `water`/
`holy` compiles identically to before.

### §4.3 `mpCost`: 0-255, not 0-99

**Correction (round 1 review, Medium 6): the previous draft of this section had the direction
backwards.** `normalizeSpell` clamps `mpCost` to 0-99 (`:3346`); the editor's own number field
offers 0-255 (`battle.js:400`) — an author can type 150 and have it silently become something else
on the next reload. The earlier design tightened the editor down to 99 to match the normalizer, on
the claim that 99 is "the largest base MP any party member's own stat block can represent" and so
one system-wide MP ceiling. Checked against the tree and it does not hold: a party member's *actual*
maximum MP is base **plus per-level growth**, computed by `statAt` (`battletables.js:83-85`,
`Math.max(0, Math.min(255, base + perLevel * (level - 1)))`) and compiled into `pc_mp_at`
(`:232-234`) — capped at a full byte, 255, not 99. A leveled member can genuinely need to cast a
spell costing more than 99. A monster's own `battle.mp` is likewise a plain byte, clamped 0-255
(`shared/project.js:3295-3298`), with no 99 ceiling anywhere on that side either. **99 is not the
engine's castability ceiling; it is a normalizer bound that disagrees with both the party's own
compiled maximum and the monster domain, and this design should not have treated the mismatch
itself as proof of which side was correct.**

**Widen `normalizeSpell`'s `mpCost` clamp to 0-255**, matching the editor field exactly as it
already stands — no UI change is needed at all, only the normalizer's own bound. This costs nothing
extra at the byte level (`spell_cost` is one byte per spell either way, `battletables.js:207`;
clamping to 99 vs. 255 changes which *values* are legal, not how many bytes represent one), so there
is no capacity argument for the narrower bound either. `baseMp`'s own separate 0-99 clamp
(`normalizePartyMember`, `:3368`) is untouched by this — it bounds a different field (a member's
*starting* MP, before growth) for what may be a deliberate authoring-economy reason of its own, but
it does not generalize into "no spell may cost more than a fresh level-1 member's MP," which is the
claim this section previously made and is retracting.

## §5. The save record — recompute `pc_spells` on load

`shared/save.js:114` serializes `pc_spells` (`RPG_LIMITS.party` bytes, the per-member learned-spells
bitmask) whose **bits are catalog positions**. So a spell delete does not only retarget project
JSON — it retargets what an already-written cartridge save remembers, independent of §3 entirely: a
save written before the delete restores a party that (per bit position) knows a different spell than
before, or a spell that no longer exists at that position at all.

Three options, per the brief; the third is the one this design picks.

- **A `SAVE_LAYOUT_VERSION` bump.** Breaks every prior save from every project, unconditionally, the
  moment this ships — the heaviest tool for the narrowest problem: most projects never touch their
  spell list after a player has a save file in hand.
- **A `saveCompatToken`-shaped nonce**, item 7's own answer to the identical "some structural edits
  need to break compat, most don't" shape (CLAUDE.md's own passage on it). Breaks a save only for a
  project that performed a qualifying edit (here: any spell delete). Real, and cheaper than a version
  bump — but still throws away hit points, level, gold and inventory along with the spells mask,
  the moment *any* spell is ever deleted, even one no saved party member had learned.
- **Recompute the mask on load and invalidate nothing.** `pc_spells`'s only *derived* writer anywhere
  in the engine is `party_apply_level` (`engine/battle.asm`), which reads `pc_spells_at` indexed by
  `member * MAX_LEVEL + level - 1` — nothing else in the engine grants or removes a spell
  independently, and `load_apply_body`'s own raw restore of the saved bytes is a *copy*, not a
  derivation, so it is the one this design has to override, not a second source to reconcile with.
  Restore the saved `pc_level`, rebuild the mask against the *current* build's own
  table, and a renumber (or a maxLevel change, or anything else that moves the table) cannot
  retarget anything, because the restored value is never trusted as an index into a table that might
  have moved — it is recomputed from a value (`pc_level`) that means the same thing before and after
  any edit.

**Chosen: recompute.** It is not free, and the design prices it rather than assuming it away, per
the brief:

- `party_apply_level` lives in `battle.asm` (**banked**); `save.asm`'s `continue_game` (**kernel**)
  is where the recompute has to run *after* `load_apply_body` overwrites RAM with the saved bytes
  (today `continue_game` runs `init_session` — which already calls `party_apply_level` once, via
  `BE_INIT` — *before* `load_apply_body`, so the freshly-derived mask is immediately clobbered by
  the raw saved one; the fix has to run its own recompute *after* the load, not rely on the one
  `init_session` already does before it).
- Two ways to reach banked code from kernel, and CLAUDE.md is explicit that the trampoline's own
  `jmp set_screen_ptr` restore is what makes any of them safe: a **fourth `call_battle` entry
  point** (today exactly three — `BE_INIT`/`BE_TICK`/`BE_JOIN`, `engine/constants.asm:780-782`), or
  a **kernel-side copy** of the level-row lookup. The copy is refused outright: it is either a
  second, drifting implementation of `level_row`/`pc_spells_at` indexing (a single-writer violation
  this codebase's own house rules forbid) or the literal same bytes assembled into both banks (real
  ROM cost paid twice for one routine, and still two places to keep in sync by hand). A fourth entry
  point reuses the existing routine's own bytes once, from one more call site.
- **`BE_RESTORE`**: a new `battle_entry` branch (`engine/battle.asm`) that loops `PARTY_SIZE`
  members and calls `party_apply_level` for each, exactly the same call `BE_INIT`'s own party-build
  loop already makes. `continue_game` (`engine/save.asm`) calls it once, after `load_apply_body`,
  before `jmp redraw_screen`. One implementation wrinkle worth pricing precisely rather than waving
  at: `battle_entry`'s own dispatch (`engine/battle.asm:20-30`) does not currently compare against
  `BE_JOIN` at all — `bt_call == 0` reaches `party_init`, `bt_call == BE_TICK` reaches `battle_tick`,
  and the trailing `battle_entry_join` label is an unconditional *else*, reached by anything that is
  neither of the first two. A fourth value cannot be added by appending a label; the chain needs an
  explicit `cmp #BE_JOIN` inserted before the current else-branch becomes `BE_RESTORE`'s own
  else-branch — a few bytes, not zero, and the reason this is called out rather than assumed away.
  Estimated cost (no code written; both pieces are small, well inside the ~3.8 KB of measured
  headroom §10 totals): a few bytes of kernel-lo for the new `call_battle` call site (matching the
  existing `BE_INIT`/`BE_TICK`/`BE_JOIN` sites' own overhead, `lda #BE_x / ldx # / jsr call_battle`-
  shaped), plus the dispatch-chain restructuring and loop wrapper above, in the banked region,
  around a routine (`party_apply_level`) that already exists.
- **Documented side effect, not a bug**: `party_apply_level` also rewrites `pc_hp_max`/`pc_mp_max`
  from the current level tables — both are *also* separately serialized
  (`shared/save.js:107,109`) and, today, restored as-is with no recompute at all, so a save already
  goes stale relative to a hand-edited level-progression table between saves; this design does not
  change that for `pc_hp_max`/`pc_mp_max` on its own initiative, it inherits it as an incidental
  consequence of reusing `party_apply_level` wholesale rather than writing a spells-only duplicate
  of its indexing math (the single-writer argument above, applied a second time, one bank over).
  Concretely: after this ships, loading a save also *silently resyncs* `pc_hp_max`/`pc_mp_max` to
  whatever the current build's level tables say for that member's restored level — a strict
  improvement over today's staleness, not a regression, and the test plan (§11) asserts it rather
  than treating it as a side effect nobody checks. If a restored `pc_hp`/`pc_mp` (also raw-restored,
  unchanged) now exceeds a *newly lower* recomputed max because a level table shrank between saves,
  nothing clamps it down — the engine has never guarded a passively-stale HP/MP against a smaller
  max anywhere outside an actual damage/heal application, and this design does not add that guard
  either; it is the same shape of pre-existing, accepted looseness, not a new one this slice
  introduces.

## §6. The 32-spell catalog versus eight learnable slots — preserved, not widened

**Preserved.** `pc_spells_at` stays one byte per member per level (`battletables.js:250`), `bit_mask`
stays eight entries (`battleui.asm:884`), and only catalog positions 0-7 are ever learnable by a
party member — monsters may still cast any of the 32, unchanged. Widening (a 4-byte mask to cover
32 positions, or a per-member slot list keyed by stable id) was costed at a glance and set aside:
even the cheap version (a wider `pc_spells_at` row) is real, new per-member-per-level table growth
(`RPG_LIMITS.maxLevel * RPG_LIMITS.party` entries × the wider row) plus a matching widening of every
engine read of the mask (`build_spell_list`/wherever else `bit_mask` is walked) — genuinely new
engine surface item 13's own scope list never calls out as settled, unlike the three items this
design does implement. It stays a live option for a future slice, not a foreclosed one (§13).

**Correction (round 1 review, Medium 4): what this section originally called "silent drift" through
*ordinary* deletion cannot happen, and the fixture below was describing an impossible case.**
`renumberSpellDeletion`'s own `shift` (§3.2) only ever **decrements** an id above the deleted one, or
removes the deleted entry outright — it never increases one. A member can only have *learned* a
spell whose id was already `< 8` at the moment it was learned (`battle.js:313`'s
`disabled: !learned && spellIndex >= 8` refuses a *new* check past position 7 in the first place), so
across any sequence of ordinary deletions that already-learned id can only stay the same or move
*further down*, never cross upward into `>= 8`. The direction this section previously described
(learn at `<8`, delete earlier spells, watch it drift to `>=8`) is therefore not reachable through
the editor's own delete path at all — confirmed by re-reading `renumberSpellDeletion` rather than
assumed.

**What *can* happen, and is worth its own test, is the opposite direction**: deleting an *earlier*
spell moves a later one **down** across the boundary, e.g. the spell that used to sit at catalog
position 8 (unlearnable) moves to position 7 (learnable) once one spell ahead of it is removed. This
is not a bug to guard against — it is `renumberSpellDeletion` and the position-based privilege model
both working correctly together — but it is a real, positive-direction behavior change (a spell that
was greyed out becomes choosable) that deserves its own assertion rather than being assumed to fall
out of the delete fixture for free.

**A genuine `>= 8` learned entry is still real and still worth guarding, just not as a consequence of
this design's own delete flow.** `normalizePartyMember`'s own load-time filter accepts *any* id below
the current catalog length (`shared/project.js:3377-3383`), not only ids under 8 — so a hand-edited
project, a project written by a foreign or future tool, or simply a project saved by a version of
this codebase from before this design shipped, can arrive with `member.spells` already naming an id
`>= 8`. `pc_spells_at`'s own generator loop (`battletables.js:243`, `if (slot < 0 || slot > 7)
continue;`, unchanged by this design) silently drops such an entry from the compiled bitmask exactly
as before, while the party tab's own checkbox (`battle.js:313`) shows it checked regardless, because
its disable condition only ever gates a *new* click and never re-evaluates an already-learned entry
against its current position. An author who inherits such a project sees a member who still "knows"
the spell and gets a ROM where that member silently cannot cast it — CLAUDE.md's own "looks
functional, does something else" case, reached through imported or legacy data, not through this
design's own repaired delete.

Two-part fix, both new, both small, both now scoped correctly to what actually reaches this state:

**Three fixtures share the same seeded-`>= 8`-data construction below, but land in three different
test destinations, named explicitly here rather than left to the test-plan sections alone (round 4
review, Low 2): the generator warning → §11.2 (`bankedbytes.test.js`); the rendered checkbox/marker →
§11.3 (`main/smoke.js`); the compiled `pc_spells_at` bitmask/castability effect → §11.4
(`rpg.test.js`).**

1. **`checkBattleTables` gains a per-member, per-learned-spell warning**: for each `member.spells`
   entry whose `spellId` is currently `>= 8`, a warning naming the member and the spell ("Rian knows
   Meteor, but only the first 8 spells in the list can be learned — Meteor is #12, so this will
   never be castable"), `where: 'Magic Forge'`. Same shape as the existing per-member level-overflow
   warning two lines below it (`:346-357`), which already walks `member.spells` — this is one more
   condition in the same loop, not a new walk. **Its own test seeds the `>= 8` id directly into a
   party member's `spells` array** (standing in for imported/hand-edited/legacy data), never via a
   delete sequence, since §11.1/§11.4 no longer claim a delete sequence can produce it.
   `checkBattleTables` is a pure JS function with no DOM involvement, so this one is a genuine
   `node:test` unit test, in **§11.2** (`bankedbytes.test.js` — the existing home for a
   `battletables.js`-exported check, `checkBattleStringsCapacity`'s own precedent from round 1), not
   left unnamed.
2. **The party tab's own checkbox** (wherever it ends up living, §7.2) gets the identical live
   check: an already-learned entry at position `>= 8` renders with a visible "won't be castable"
   marker rather than looking indistinguishable from a genuinely learnable one — the render-time
   twin of the build-time warning above, for a project that arrives in this state rather than one
   this design's own editing flow can create. Same seeded-`>= 8`-data fixture *construction* as (1),
   but **not the same test environment**: `partyPanel` is renderer code built through `ui.js`'s
   `el()`, which needs a real `document` — round 2 review, Medium 2 — so this assertion lives in
   **§11.3** (`main/smoke.js`), the only environment with one, not `node:test`. The same fixture's
   *compiled* effect — does the ROM's own `pc_spells_at` bitmask actually grant the spell — is a
   third, separate assertion in **§11.4** (`rpg.test.js`, booting the ROM), neither a generator check
   nor a DOM one.

## §7. The Forge module

### §7.1 Rail gating — one predicate, three consumers

Spells are RPG-only; Items stays unconditional in the rail (an action game still has a bag — the
precedent item 13's own "already exists" paragraph and this design's §1 both cite is deliberately
*not* followed here, because it does not apply: nothing in `project.spells`/`project.party` means
anything in an action project, where `BATTLE_ENABLED` is off and no code path ever reads either).
**The Magic Forge is conditional**, appearing only for `project.project.gameType === 'rpg'`.

One predicate, `isForgeAvailable(entry, project)` in `renderer/app.js` (new, small):

```js
const isForgeAvailable = (entry, project) =>
  !entry.gameTypes || entry.gameTypes.includes(project?.project?.gameType);
```

`FORGES`' Magic entry carries `gameTypes: ['rpg']`; every other entry carries nothing, so the
predicate is `true` for all of them unchanged — this is additive to the registry shape, not a
rewrite of it. Three call sites, all currently reading `FORGES` directly, all switched to read
through this one predicate instead:

- **`renderRail()`** (`:170-189`): skip an unavailable entry when building the rail buttons, rather
  than rendering a button for a Forge the project cannot open.
- **`app.forgeIds`** (`:126-128`): filter by `isForgeAvailable(entry, store.project)` — the getter
  already re-evaluates on every read against live `store` state, so this needs no signature change;
  `main/smoke.js`'s existing call site is untouched.
- **`selectForge(id)`** (`:191-218`): if the resolved entry is unavailable for `store.project`,
  redirect to the first available entry (`'tile'`, unconditionally available, the same id
  `activeForgeId`'s own module-level default already starts at) instead of mounting it.

**Two consequences the brief calls out by name, both closed by the third bullet above:**

- **Switching project types while Magic is active.** `activeForgeId` is a bare module-level
  variable (`:89`), never reset on project open/close — `store.subscribe`'s own `'open'` handler
  (`:387-391`) calls `selectForge(activeForgeId)` with whatever the *previous* project left it at.
  Open an RPG project, navigate to Magic, close it, open an action project: without the guard above,
  `selectForge('magic')` would still resolve the registry entry (the array itself is unfiltered) and
  attempt to mount a Forge against a project with no `spells`/`party` in the shape it expects. The
  guard in `selectForge` is what stops this — it is the one call site that has to defend itself,
  since the rail can never *offer* a click into a Forge it did not render a button for, but a stale
  `activeForgeId` reaches `selectForge` by a path the rail never sees.
- **`npm run smoke`'s "all forges mount" step never seeing Magic.** Confirmed by reading the
  scenario: `window.forge.project.create({dir, name})` (no `gameType`) defaults to `'action'`
  (`createProject`'s own default parameter), and the single "visit every Forge" loop
  (`main/smoke.js:84-95`) runs immediately after, against that action project — `forgeIds` would
  correctly *exclude* Magic there, so that loop proves nothing about it, by design, not by omission.
  §11.3 adds a second, small "visit every Forge" pass right after `sample-rpg` is opened later in the
  same script (`smoke.js:4074`, already present for the Battle-system-meter check) — the identical
  `forgeIds` loop, reused rather than duplicated, at a point where an RPG project actually is open,
  which is the only point in the whole script where a Magic Forge mount is possible to observe at
  all.

### §7.2 What moves, what stays

**Spell authoring moves in full.** **Learned-spells editing stays on the party tab** (Sprite Forge),
cross-linked rather than moved. Reasoning: a party member's learned spells are edited *per member*,
on a page that already exists to edit that member (name, sprite, base stats, starts-in-party) —
moving it to the Magic Forge would mean either the Magic Forge re-implementing a party-member
picker it does not otherwise need, or the Sprite Forge's party tab losing a field that is
unmistakably "about this member" the moment it is asked. The cross-link: the party tab's own
`Spells…` button (`:360`) is replaced with a plain `goTo('magic')` link ("Manage spells in the Magic
Forge →"), and the `Learns` checkbox block (`:297-343`) stays exactly where it is, reading
`store.project.spells` live (as it already does) rather than through a draft. `battleSection`
(`:44`, an actor's own combat stats) stays on the Sprite Forge's battle sub-page — item 14's own
territory, untouched here, per the brief.

### §7.3 The modal becomes a page; delete gets a confirm, everything else commits per edit

`editSpells` today clones a draft, edits it in place, and commits everything (add/rename/reorder/
delete, all of it) in one `store.commit` on Save — Cancel discards the whole session. The Magic
Forge page drops the draft entirely: name, MP cost, kind, amount range, element and scope each
commit through `store.commit` the moment they change, the same granularity every other Forge already
uses (and the same granularity Items Forge already established as this codebase's precedent for
exactly this kind of record-list editor). This is a real, stated behavior change, not a silent one:
**undo/redo is now the safety net a field-level edit gets, not a modal Cancel button** — an author
who changes an MP cost and regrets it presses Ctrl+Z, the same as changing a tile or renaming an
actor, rather than reopening a lost draft. **Delete is the one destructive action that keeps an
explicit confirmation**, via `confirmModal` — Items Forge's own precedent exactly
(`items.js:143-146`), for the same reason: undo covers it too, but a delete that also touches every
reference through it (§3) reads as consequential enough to ask first, the same judgment call this
codebase already made once for items. §3.2 spells out the full handler, not only the confirmation
step: capture-before-await, re-resolve-by-identity-after, abort-with-a-toast-on-`-1` — the whole
Items Forge shape, not a truncated version of it.

## §8. The min-max roll — engine work

Answering each sub-question the brief poses, in order.

- **Bounds are inclusive** on both ends, `[amountMin, amountMax]`, matching the single-bound
  `clamp(raw?.amount, 1, 255, ...)` this replaces (§4.1) — an inclusive bound is what "1 to 255"
  already meant for the flat byte.
- **`min === max` reproduces today's behavior byte-for-byte**, RNG consumption included, not merely
  the numeric result (§4.1's own paragraph on why that distinction matters for every *other* roll in
  the same battle).
- **A biased reduction is not acceptable, and the round-1 draft of this section shipped one — round
  1 review, High 1, corrected below.** The masked-`AND` construction was analyzed against a source
  domain of 0-255; the real source is 1-255, because `rng_next` (`engine/rpg.asm:14-23`) swaps a
  zero state for `$A5` before ever advancing, so its maximal 255-value cycle never produces a raw 0.
  Against that real domain, masking is not merely imprecise, it is provably biased for *every* mask
  width (each masked outcome other than 0 has one more raw preimage than masked outcome 0 does,
  since only the single excluded value, raw 0, would have mapped to masked 0), and for the specific,
  legal, maximal-range case `amountMin = 1, amountMax = 255` (`range = 254`, mask `$FF`) the masking
  is a complete no-op on a domain that never contains 0 at all — so `amountMin` was **provably
  unreachable**, not merely underrepresented, on that spell. This is corrected below, not patched:
  the reduction is rebuilt around the actual 1-255 domain from scratch.

  **Corrected construction — reject to the largest exact multiple, then reduce by an exact
  remainder, both against the true domain.** Let `draw = rng_next() - 1`: since `rng_next` is
  uniform over the 255 values 1-255, `draw` is uniform over the 255 values 0-254 — a real, complete,
  zero-based domain to reduce from, with no excluded value distorting it. Let `n = amountMax -
  amountMin + 1` (the number of legal outcomes, 1-255) and `limit = floor(255 / n) * n` (the largest
  multiple of `n` that fits in the 255-value domain) — both precomputed per spell, in JS, at build
  time, the same "let the tool do the arithmetic the 6502 can't" rule this codebase already applies
  everywhere else a multiply or a division would otherwise land in the ROM. At runtime: **reject**
  any `draw >= limit` (redraw), then **reduce** the accepted `draw` to `draw mod n`, then `+
  amountMin`. This is exact, not merely closer: conditioning a uniform draw over `[0, 254]` on `draw
  < limit` is uniform over `[0, limit - 1]` by definition (rejection sampling changes nothing about
  the *relative* probabilities among the values it keeps), and `[0, limit - 1]` is exactly `n`
  copies of `[0, n - 1]` laid end to end (`limit` is a multiple of `n` by construction), so `draw mod
  n` is uniform over `[0, n - 1]` with no residual bias at all — unlike the masked construction, this
  has no per-outcome preimage-count difference to correct for, because every outcome's preimage
  count within `[0, limit - 1]` is identically `limit / n`.

  The one runtime cost this adds over the round-1 draft is the modulo step, since `n` is not
  generally a power of two: **reduce via a fixed 8-iteration shift-and-subtract binary division**
  (the standard 6502 technique for "remainder of an 8-bit division," e.g. shifting the dividend
  left through carry into a work byte and conditionally subtracting the divisor once per bit),
  never a repeated-subtraction loop whose trip count depends on the quotient — the whole reason to
  pick shift-subtract over repeated subtraction is that its cost is **exactly 8 iterations, always**,
  regardless of how small `n` is, where a naive "keep subtracting `n` until below it" loop could run
  up to roughly `limit / n - 1` times (over 100 iterations for a small `n`).

  **Round 1 review left this a hand-wave ("the implementer pins the exact opcodes") with no register
  contract; round 2 review, Medium 1, correctly refused that as not exact enough to build against.**
  The battle bank has exactly two scratch bytes, `bt_tmp`/`bt_tmp2` (`engine/constants.asm:144-145`),
  and they are not interchangeable here: `cast_all` (`engine/battleturn.asm:301-317`) stores its own
  end-of-side loop sentinel in `bt_tmp2` *before* its per-target loop begins, and that loop's own body
  calls `jsr spell_damage` — one of `roll_spell_amount`'s two call sites — so `bt_tmp2` must survive
  completely untouched across the *entire* `spell_damage` → `roll_spell_amount` → `mod8` call chain,
  or `cast_all`'s own loop bound corrupts mid-cast. `bt_tmp` has no such live value across this call
  from either caller (`cast_heal`/`cast_heal_mon` only write it *after* the roll returns), so it is
  free to use as internal scratch. The full routine, with every register/scratch effect stated rather
  than implied — this is the actual eight-step helper, not a sketch of one:

  ```
  ; X = spell index (bt_arg, at both call sites). Returns A = the rolled
  ; amount. spell_amount_n,x == 1 means min == max: no roll, no RNG
  ; consumed, byte-for-byte the old flat-amount read. X is preserved
  ; throughout (both roll_spell_amount and mod8 need it for spell_amount_*,x
  ; reads); Y and bt_tmp are both clobbered; bt_tmp2 is NEVER touched by
  ; either routine -- cast_all's own end-of-side sentinel lives there across
  ; this entire call chain and must survive it untouched.
  roll_spell_amount:
    lda spell_amount_n,x
    cmp #1
    beq roll_spell_amount_flat
  roll_spell_amount_retry:
    jsr rng_next                  ; 1-255
    sec
    sbc #1                        ; draw = rng_next() - 1, uniform over 0-254
    cmp spell_amount_limit,x
    bcs roll_spell_amount_retry   ; draw >= limit: reject, roll again
    jsr mod8                      ; A (draw) -> A (draw mod spell_amount_n,x)
    clc
    adc spell_amount_min,x
    rts
  roll_spell_amount_flat:
    lda spell_amount_min,x
    rts

  ; A = dividend (0-254) on entry. X = spell index, preserved (spell_amount_n,x
  ; is the divisor). Returns A = dividend mod spell_amount_n,x. Clobbers Y (the
  ; eight-count) and bt_tmp (the shifting copy of the dividend). Never touches
  ; bt_tmp2 -- see the caller-contract comment above. No carry-catching branch
  ; after `rol a`: an 8-bit accumulator fed by exactly eight shift-in steps
  ; cannot exceed 2^i - 1 after i steps for any divisor or dividend, so the
  ; ordinary compare/subtract below is already exact on the whole byte domain
  ; -- see the paragraph after this block for why an earlier draft carried an
  ; extra branch here and why it was removed rather than kept.
  mod8:
    sta bt_tmp                    ; the dividend, shifted left one bit per iteration
    lda #0                        ; the remainder, built up one bit per iteration
    ldy #8
  mod8_loop:
    asl bt_tmp                    ; dividend's next MSB -> carry
    rol a                         ; carry -> remainder's LSB
    cmp spell_amount_n,x
    bcc mod8_no_sub                ; remainder < n: nothing to subtract
    sbc spell_amount_n,x           ; carry is 1 from the cmp above, so this
                                    ; subtracts exactly, no borrow
  mod8_no_sub:
    dey
    bne mod8_loop
    rts
  ```

  **Correction (round 3 review, Medium 1; sharpened round 4, Low 1): `mod8` originally carried a
  `bcs mod8_sub` branch after `rol a`, meant to catch a carry out of the 8-bit remainder. It is
  unreachable, and — round 4's own correction of round 3's own reasoning — not merely for the
  specific 0-254 `draw` values `roll_spell_amount` happens to hand it.** Round 3 argued the branch
  was dead only *given* that `mod8` is never called with an arbitrary dividend, tying its safety to
  `roll_spell_amount`'s own rejection construction. That framing was itself too narrow: the branch is
  unreachable for **every** byte dividend 0-255 and every divisor 1-255, a property of the routine's
  own eight-shift structure and nothing else. Before the eighth (final) iteration, the accumulator has
  been built from at most seven shifted-in bits, so it is bounded by `2^7 - 1 = 127` regardless of `n`
  or the dividend, regardless of whether any conditional subtraction fired along the way (a subtract
  only ever reduces the running value, never raises the bit count it was built from); the eighth
  iteration doubles that and adds one more bit, `2 x 127 + 1 = 255` at most — exactly fits in eight
  bits, never carries. (For `n <= 128` specifically, the ordinary long-division invariant gives the
  same conclusion a second way: post-subtract remainder `< n` bounds the next pre-subtract value at
  `2n - 1 <= 255`.) So widening `roll_spell_amount`'s own rejection loop to admit a fuller range of
  draws — the only kind of "future edit" round 3 imagined the branch guarding against — could never
  make it reachable either; only changing `mod8`'s own byte width or its eight-iteration structure
  could, and neither is a plausible incremental edit to this routine. Exhaustive simulation over all
  65,025 `(n, draw)` pairs (round 3) already confirmed zero reachability on the narrower, accepted-
  draws domain; the argument above is the reason it is unreachable on the *entire* byte domain, a
  strictly stronger claim.

  **Given that, this design removes the branch rather than keep it as "defensive."** Round 3's own
  framing — "cheap insurance... against a future edit... widening `mod8`'s effective input domain,"
  and "the boundary tests below prove it is inert" — is retracted along with the reasoning it rested
  on: there is no realistic edit within this routine's own shape that the branch would ever catch,
  so it defended nothing, and no test can "prove inertness" for a branch whose non-reachability is
  already an arithmetic fact about every possible input, not an empirical property a finite set of
  fixtures could establish or fail to establish. The code block above already reflects the routine
  without it — a plain eight-iteration shift/compare/conditional-subtract, exact on the whole byte
  domain by the argument just given. This trades away 16 cycles per call (2 per iteration, 8
  iterations) for a routine with no code that can never execute; the pricing paragraph below is
  repriced accordingly, and §11.4's own boundary-test bullet no longer mentions a branch that is not
  in the routine to begin with.

  No overflow guard is needed on `roll_spell_amount`'s own final `adc`: `draw mod n` is at most
  `n - 1 = amountMax - amountMin`, so `amountMin + (draw mod n) <= amountMax <= 255` by construction,
  and the add can never carry.

  **Bounded in practice, and priced per roll, from the instructions as actually written — round 3
  review, Low 2, corrected the round-2 draft's own cycle arithmetic, which undercounted several of
  them.** `cast_all` (`engine/battleturn.asm:307-312`) invokes `spell_damage` — hence
  `roll_spell_amount` — once per *living target*, not once per cast, so an all-target spell against a
  full four-slot side (`MAX_PARTY` in the engine, `RPG_LIMITS.party`/`monstersPerBattle` in the
  schema — all four are 4) rolls up to four times in one turn.

  **Per-attempt cost of the rejection loop.** `rng_next` (`engine/rpg.asm:14-24`) is `jsr`(6) +
  `lda rng`(3) + `bne`(3, taken on every call but the rare zero-state one) + `asl a`(2) +
  `bcc`(2 or 3) + `[eor #imm`(2) on the branch not taken`]` + `sta rng`(3) + `rts`(6) — about 26-27
  cycles, not the ~20 the round-2 draft implicitly assumed. The caller's own per-attempt overhead
  around it — `sec`(2) + `sbc #1`(2) + `cmp spell_amount_limit,x`(4, absolute-indexed) + taken
  `bcs`(3) — adds 11 more. **A rejected attempt is therefore ~37-38 cycles, not ~30.**

  **Cost of `mod8` itself, without the removed branch (round 4, Low 1).** Setup (`sta bt_tmp`(3) +
  `lda #0`(2) + `ldy #8`(2) = 7) plus eight iterations, each `asl bt_tmp`(5, zero page) + `rol a`(2)
  + `cmp spell_amount_n,x`(4, absolute-indexed) + `bcc`(2 or 3) + [`sbc spell_amount_n,x`(4) on the
  branch not taken] + `dey`(2) + `bne`(2 or 3) — **~19 cycles on a no-subtract iteration, ~22 on a
  subtract iteration** (2 cycles less each than the version with the now-removed branch). Setup,
  eight iterations, and `rts`(6) put the whole routine at **roughly 170-191 cycles**, 16 cycles
  (8 iterations x 2) less than the ~186-207 the kept-branch version cost.

  **Expected cost per roll, worst `n`.** The rejection loop's acceptance probability is `limit / 255
  = 1 - (255 mod n) / 255`, never worse than roughly 50% (worst case `n` just over half of 255, e.g.
  `n = 128`, `limit = 128`, acceptance ≈ 50.2%) and 100% whenever `n` divides 255 exactly (`n` a
  factor of `3 × 5 × 17`) — so the loop's *expected* trip count is small, at most about 2, for every
  legal `n`: roughly `2 × 37.5 ≈ 75` expected cycles for the rejection phase at the worst `n`, plus
  `mod8`'s own ~170-191, plus the final `clc`/`adc`/`rts` (~12). **Expected cost per roll at the
  worst `n`: roughly 265 cycles**, not 280 (round 3) or 200-250 (round 2). For a full four-target
  all-scope cast in the expected case: roughly 1,050-1,100 cycles total, still a small fraction of
  one frame's ~29,780-cycle NTSC budget.

  **Worst case, stated honestly rather than rounded away, and recomputed for the branch-free `mod8`
  (round 4).** The rejection loop is bounded at 255 attempts by `rng_next`'s own maximal-length
  Galois LFSR cycle (every accepting output is guaranteed within one full period, astronomically
  unlikely to be needed but a real, finite bound): `255 × ~38 ≈ 9,690` cycles, plus `mod8`'s own
  worst-case ~191 (was ~207 with the removed branch), plus the final add/return (~12) — **roughly
  9,900 cycles for one roll at the theoretical limit**. This worst-case figure barely moves from
  round 3's own ~9,800 despite `mod8` itself getting 16 cycles cheaper, because the 255-attempt
  rejection loop (~9,690 of the ~9,900) dominates the total; `mod8`'s own contribution was always a
  small fraction of this particular figure, even though it dominates the *expected*-case number
  above. **Four such rolls in the same turn: roughly 39,600 cycles (was ~39,000) — labelled here, as
  round 3 review asked, as a *conservative product of four independent per-call bounds*, not four
  independently attainable full-period stalls** (the LFSR has exactly one state at a time, so a
  single battle tick cannot actually hit the 255-attempt bound four separate times with four
  unrelated draws behaving that badly in genuine independence; the product is a safe over-count, not
  a claim that this exact joint event is itself reachable).

  This design does not need to argue the joint bound down further, because the real safety property
  is structural, not statistical: `main_loop` (`engine/boot.asm:102-103`) waits for vblank before any
  mainline work runs, `vram_ready` is published only as the very last store of that mainline pass
  (`engine/boot.asm:254`), and NMI skips draining an unpublished queue rather than reading a
  half-written one (`engine/boot.asm:339-340`) — the identical handshake CLAUDE.md's own `vram_buf`
  accounting already documents for every other producer in this file. Even the loose, quadrupled
  worst-case bound above (~39,600 cycles) is **under two full frame periods** (`2 × 29,780 =
  59,560`), so the mechanism this handshake already provides is exactly what this case needs: a
  battle tick that runs unusually long simply leaves `vram_ready` clear for one extra frame, NMI
  skips draining it that frame, and the result appears one frame later than usual — never a partial
  drain, never a corrupted frame, the same guarantee this engine already gives every ordinary slow
  frame. This runs inline on the mainline turn-resolution path the same way every existing roll in
  this file already does.
- **Once per target**, not once per cast. `cast_all` (`engine/battleturn.asm:301-320`) already loops
  per living target calling `spell_damage` inside the loop; each iteration calling
  `roll_spell_amount` independently is the natural per-target roll and costs nothing extra — caching
  a single roll and reusing it across the loop would need *more* code (a temp byte, a branch to skip
  re-rolling) for a less interesting result (every target taking identical damage from one shared
  spell).
- **Before the elemental modifier**, matching today's ordering exactly: `spell_damage` currently
  reads the flat `spell_amount,x` first, *then* applies the weak/strong multiply
  (`spell_damage_weak`/`spell_damage_strong`, `:635-655`). The only change at either of `spell_damage`
  (`:616`) and `cast_heal`/`cast_heal_mon` (`:326`) is swapping `lda spell_amount,x` for
  `jsr roll_spell_amount` — the rolled value lands in `bt_dmg_lo`/`bt_tmp` exactly where the flat
  read used to, and every line after it (weak/strong multiply, `apply_damage`, the `bcs`-guarded
  heal-and-clamp) is untouched. Unaffected by the High 1 correction — only the roll's own internal
  construction changed, not what it hands off or when.
- **Saturation is inherited, not re-derived — and this is the one place this design corrects a stale
  claim in its own brief.** §8.0 below.

### §8.0 A correction: the two cited "pre-existing defects" are already fixed

The brief cites `spell_damage_weak` (as "computes one-and-a-half times in eight bits and discards
the carry") and `cast_heal` (as "adds into `pc_hp` with `clc`/`adc` and compares the wrapped low
byte") as pre-existing engine defects this slice must not extend. **Reading the current tree, both
are already fixed.** `spell_damage_weak` (`engine/battleturn.asm:635-646`) saturates to `$FF` on
carry (`bcc spell_damage_weak_store` / `lda #$FF`) rather than storing the wrapped low byte; `
cast_heal`/`cast_heal_mon` (`:324-360`) both carry a `bcs cast_heal_max`/`bcs cast_heal_mon_max`
guard immediately after the `adc`, before the max-comparison, so a carry is caught before the
(otherwise-wrapped) compare ever runs. This is exactly CLAUDE.md's own battle-math passage —
`item_chosen`/`cast_heal`/`cast_heal_mon`/`spell_damage_weak`/`physical_damage_noise` all gained the
`bcs`-before-`cmp` saturation guard as part of the battle-math slice (`handoff-battlemath/
battlemath-report.md`, shipped `8e93c8c`) — which landed after this brief was written and before
this design pass; the brief's own citation went stale in the interim, the same silent-drift shape
CLAUDE.md's own docs-maintenance discipline exists to catch, just in a design brief instead of
CLAUDE.md itself.

This does not remove any real requirement, it relocates it. The new roll (§8's own sketch) hands its
result to `spell_damage_weak`/`spell_damage_strong`/`cast_heal`/`cast_heal_mon` **completely
unchanged**, and those routines are now provably safe against anything `roll_spell_amount` can hand
them (a byte in `[amountMin, amountMax] ⊆ [1, 255]`, the identical domain the flat `spell_amount`
byte already occupied) — so no *new* saturation work is owed downstream of the roll. What is still
owed, and is met by construction in the sketch above, not by inheritance: the roll's **own**
arithmetic (`amountMin + (draw mod n)`) must not wrap, which §8's "no overflow guard is needed"
paragraph already establishes cannot happen (`draw mod n` is bounded by `n - 1 = amountMax -
amountMin`, so the sum is bounded by `amountMax <= 255`). Stated plainly for review: the standard
this design holds itself to is the
one the battle-math slice already set for the rest of this file, and the reason no new saturation
code appears in the sketch is that the new code sits entirely upstream of code that is already
correct, not that saturation was skipped.

## §9. The user-facing "where" strings

Every `checkBattleTables`/`battleShortfallAdvice` message that is actually about a **spell**
switches `where: 'Sprite Forge'` to `where: 'Magic Forge'`:

- `battletables.js`'s `checkBattleTables` — the "N spells, only 8 learnable" warning.
- `battletables.js`'s `battleShortfallAdvice` — the "removing k spells" lever description (the
  `reduce` callback itself, which splices a *local probe clone* purely to measure bytes and is
  never applied to `store.project`, needs no change — nothing it touches is ever seen by a party
  member's own learned-spell reference).
- §6's new per-member/per-learned-spell warning is born `where: 'Magic Forge'`.

**Left as `'Sprite Forge'`, because they are not about a spell**: no party member starts; a learned
spell's *level* exceeds `maxLevel` (about the party member's own level cap, not the spell); no
hostile actor; party size over the limit; `battleShortfallAdvice`'s actor/party-member levers.

**The battle-region overflow error** (`generate.js`'s `regionBytes > regionCeiling` check,
`where: 'Sprite Forge'` today) genuinely cannot stay Sprite-owned or become Magic-owned once this
slice ships: the 8 KB region is now fed by Sprite (actors, party), Magic (spells) and Items at once,
plus the mapper choice itself (a Build-panel decision, `reconcileCartridge`) that decides the
region's *ceiling*. **It becomes `where: 'Build & Play'`** — the one existing Forge title
(`renderer/app.js`'s `FORGES` array) that already names the page showing this exact number
(CLAUDE.md's own "the Build panel's meter would need a second copy of the arithmetic" passage is
describing this same meter), and the one place a mapper change — itself a real lever on this same
error — is made. No other content Forge is uniquely responsible for a shared-region overflow the way
each of the four other `where:` strings in this codebase names a Forge that owns the *entirety* of
what it is reporting on.

## §10. Byte budget rollup — every figure an estimate unless labelled measured

No code was written for this design; nothing below is measured. All figures are against the current
banked-region base (`BASE_BATTLE_CODE_BYTES_BY_MAPPER = {30: 3938, 1: 3938, 4: 3984}`, post-§8's own
spell-amount roll landing — corrected against the tree at HEAD; an earlier draft of this section
cited the pre-§8 `{3885, 3885, 3931}` instead — a base 53 bytes too small, which *overstates* the
real headroom by that same 53 bytes/board, not understates it as an earlier draft of this very
correction had it backwards [round 2 review, finding 6]) and
ceiling (`NESASM_BANK_BYTES - BATTLE_SLACK = 8192 - 20 = 8172`). `sample-rpg`'s
own measured table bytes today are 464 (from the namestride slice's own re-measurement). **Round 2
review, Low 3: corrected below** — this design adds table rows *and* new banked base code
(`roll_spell_amount`/`mod8` in `engine/battleturn.asm`, and `BE_RESTORE`'s own loop and dispatch-chain
change in `engine/battle.asm` — both banked, both in the table immediately below); the one piece of
this design that is **not** banked is `BE_RESTORE`'s own `call_battle` call site inside
`continue_game` (`engine/save.asm`, kernel), priced in the separate kernel-lo table that follows.

**Banked region** (all four content sources share the one 8 KB region; `BE_RESTORE`'s own loop and
dispatch-chain work lands here like everything else in this table — only its *call site*, in kernel
`continue_game`, is the row that does not, and that row is in the kernel-lo table below instead):

| Item | Where it lands | Estimate |
|---|---|---|
| `spell_amount_min`/`spell_amount_n`/`spell_amount_limit` replacing `spell_amount` (§8's corrected construction) | Table bytes, `battletables.js` | +2 bytes/spell (3 rows instead of 1), so +2 to +64 bytes across a project's whole catalog (RPG_LIMITS.spells = 32 worst case) — unchanged from the round-1 estimate: three per-spell bytes either way, only the derived values differ |
| `roll_spell_amount` + `mod8` (the fixed 8-iteration shift-subtract division §8 now needs) | Banked code, `engine/battleturn.asm` | Two dozen-odd instructions total, once; two call-site swaps (`lda spell_amount,x` → `jsr roll_spell_amount`) cost nothing extra. Larger than the round-1 estimate (which had no division routine at all), still small next to the region's headroom |
| §6's per-member learn-privilege warning | Generator only (`checkBattleTables`) | Zero ROM cost — a JS-side problem report, not compiled |
| `renumberSpellDeletion` | Editor/`shared/project.js` | Zero ROM cost — never reaches the compiler |
| §5's `BE_RESTORE` loop wrapper (reusing `party_apply_level`) and the `battle_entry` dispatch-chain restructuring (§5's own priced wrinkle) | Banked code, `engine/battle.asm` | A small loop plus one more `cmp`/`bne` pair in the dispatch chain — a handful of bytes |
| `ELEMENTS` +2 | Nowhere (§4.2) | 0 |
| Rail gating, Forge module itself | Renderer only | 0 ROM cost |

**Kernel-lo** (round 1 review, High 3 — omitted from the round-1 draft entirely). The new
`call_battle` call site §5 adds lives in `continue_game` (`engine/save.asm`), which is **kernel**
code, not banked, and — like every other save/load-only code path — is gated on save being live at
all.

**The ledger this section prices against has since split into two terms, landed as a prerequisite to
this design before any of the runtime work below existed** (`handoff-magic/phase4-design.md`'s own
"Phase sequencing" — an implementation report, not part of this shipped design, but the change it
describes is real and already in the tree). `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` (`main/build/generate.js`)
was measured exclusively against `sample-rpg` and charged in full to action projects too — a real,
pre-existing, independently-discovered overcharge unrelated to this design, now corrected: the
constant holds only the action-side base (`{1: 511, 4: 516, 30: 683}`), and a new flat term,
`SAVE_BATTLE_KERNEL_ALLOWANCE` (currently `36`), carries the RPG-only supplement — the `.if
BATTLE_ENABLED` range-check block in `save_check_valid` that only an RPG assembles. Flat, not
`*_BY_MAPPER`, because the 36-byte gap measures identical on all three boards and the block it charges
for has no mapper-specific instruction in it; `test/unit/kernelbytes.test.js` equality-pins both the
base (per mapper) and the supplement (once, proven flat across all three) independently. Together they
still sum to the same `{1: 547, 4: 552, 30: 719}` this section's own estimates below were already
written against — nothing about that total, or the conclusion it supports, changes.

`BE_RESTORE`'s own call site (`lda #BE_RESTORE / jsr call_battle`-shaped, matching the existing three
entry points' own per-site cost) is itself `.if BATTLE_ENABLED`-gated — it can only ever call a
routine that does not assemble outside an RPG — which is exactly `SAVE_BATTLE_KERNEL_ALLOWANCE`'s own
predicate, not `SAVE_KERNEL_ALLOWANCE_BY_MAPPER`'s. So it is `SAVE_BATTLE_KERNEL_ALLOWANCE` that grows
once `BE_RESTORE` ships (from `36` to its own real post-call-site figure), **not**
`SAVE_KERNEL_ALLOWANCE_BY_MAPPER`, and **not** the banked-region base or `bankedbytes.test.js` either.
This is a genuinely separate ledger from the banked-region table above, priced separately because
`kernelbytes.test.js`'s own discipline (equality per mapper, not a margin) is what would catch a stale
figure here, the same way `bankedbytes.test.js`'s equality catches one in the banked base.

**Addendum, `BE_RESTORE` implementation (`handoff-magic/phase4-impl-1-report.md`): the real post-call-site
figure is `41`, not the ~5-byte estimate this section priced against — measured, a uniform +5 on all
three boards, matching the estimate's own order of magnitude exactly.** `SAVE_BATTLE_KERNEL_ALLOWANCE`
is `41`; the RPG totals `{1: 547, 4: 552, 30: 719}` this section's own estimates were written against
are now `{1: 552, 4: 557, 30: 724}`. No documented-limitation row moved by more than that same 5 bytes,
and only rows carrying `Save` on an RPG moved at all (CLAUDE.md, "The kernel budget").

| Item | Where it lands | Estimate |
|---|---|---|
| `BE_RESTORE`'s own `call_battle` call site in `continue_game` | Kernel-lo, `engine/save.asm`, save-and-`BATTLE_ENABLED`-conditional | A handful of bytes, matching `BE_INIT`/`BE_TICK`/`BE_JOIN`'s own known-small per-call-site cost, added to `SAVE_BATTLE_KERNEL_ALLOWANCE` (flat, not per-mapper) once `BE_RESTORE` ships |

**Total estimated banked-region growth: well under 200 bytes in the worst case.** Round 1 review,
Low 8: the previous draft named MMC1/UNROM 512 as the tightest board at 3806 bytes free before this
slice — backwards. `BASE_BATTLE_CODE_BYTES_BY_MAPPER`'s own measured figures put **MMC3** 46 bytes
higher than the other two (3984 vs. 3938, per the corrected §10 baseline above), so MMC3 is the
tightest of the three: `3984 + 464 (table) + 17 (item allowance) = 4465` used of `8172`,
**3707 bytes free**. The conclusion — that this slice's own estimated growth fits with
real margin to spare — is unaffected by the correction; only which board and which headroom figure
back it. **`bankedbytes.test.js` rows this is expected to move**: `BASE_BATTLE_CODE_BYTES_BY_MAPPER`
(re-measure after `roll_spell_amount`/`mod8`/`BE_RESTORE`'s banked loop land — a real, small,
all-three-boards-alike delta the same way the name-stride slice's own +50 was), and the equality
assertion that pins it. **`kernelbytes.test.js` rows this is separately expected to move**:
`SAVE_BATTLE_KERNEL_ALLOWANCE`'s own equality (and flatness) assertions, on every save-capable board,
per the kernel-lo table above — not `SAVE_KERNEL_ALLOWANCE_BY_MAPPER`'s, which is unaffected by
`BE_RESTORE` and already re-measured as part of the prerequisite split described above. No existing
`bankedbytes.test.js`/`kernelbytes.test.js` "documented
limitation" row is expected to flip in either direction, given the size of both ledgers' headroom
relative to these estimates, but the implementer re-measures both rather than assumes (house rule,
restated: only nesasm's own output is ever called measured).

**Addendum, `BE_RESTORE` implementation (`handoff-magic/phase4-impl-1-report.md`): the real
banked-region growth is a uniform +18 bytes on all three boards** — `BASE_BATTLE_CODE_BYTES_BY_MAPPER`
is now `{30: 3956, 1: 3956, 4: 4002}` — comfortably inside the "well under 200 bytes" estimate above.
No `bankedbytes.test.js`/`kernelbytes.test.js` documented-limitation row flipped.

## §11. Test plan

### §11.1 Unit (`shared/project.js` / `renumberSpellDeletion`)

Per the house rule ("derive expected positions from object identity, never scan for the first
plausible match, and pin a fixture whose correct answer does not coincide with a plausible wrong
one"): the brief's own reproduction (three spells, a member learning two, a monster casting one,
delete index 0) as the base fixture, plus:

- Delete index 0 specifically (the coincidence the bug's own filter-by-surviving-id masked): assert
  by spell **identity** (name, not index) that the survivor keeps the *level it was authored at* for
  the *spell it actually learned* — the exact case where the old code silently attached a level to
  the wrong spell.
- A monster's `battle.spellId` naming the deleted spell → `null`, not a shifted number.
- A monster's `battle.spellId` naming a later spell → shifted down by one, unchanged level of
  indirection.
- A party member's learned entry naming the deleted spell → the whole `{spellId, level}` entry gone
  from the array, not present-with-a-wrong-id.
- `battle.spellId === null` before the delete → still `null` after (the fixed-point case).
- Deleting the *last* spell in a 32-entry catalog → no shift needed anywhere, confirms `shift`'s own
  `id > index` boundary.

### §11.2 `bankedbytes.test.js`

- Re-measure `BASE_BATTLE_CODE_BYTES_BY_MAPPER` on all three RPG-capable boards, equality-asserted
  (not margin), the same discipline the name-stride and battle-math slices already established.
- A `spell_amount_min`/`_n`/`_limit`-shaped table-byte-count assertion, the same shape
  `battleTableBytes`'s existing equality check already applies to every other emitted table.
- A fits-control build with a maximal (32-entry) spell catalog and a real min-max range on at least
  one spell, on **MMC3** (the tightest of the three boards — round 1 review, Low 8; §10's own
  correction), confirming the region still fits with real margin (not merely the estimate in §10).
- **`checkBattleTables`'s new per-member, per-learned-spell warning (§6) — round 3 review, Low 3:
  named here explicitly, not left as "a `node:test` unit test" with no file.** `checkBattleTables`
  lives in `main/build/battletables.js` (`:325`), not `shared/project.js` — a different file from
  §11.1's own `renumberSpellDeletion` — and this design's own round-1 addition of
  `checkBattleStringsCapacity` (another `battletables.js`-exported check) already landed in this
  same file, `bankedbytes.test.js`, which is the existing, natural home for a `battletables.js`
  function's own unit coverage rather than a new file or a widened §11.1. For the seeded-`spellId >=
  8`-entry fixture (§6, §11.4's own emulator-side twin of this same fixture), assert the warning's
  exact text names the right member and spell.

### §11.2a `kernelbytes.test.js` (round 1 review, High 3 — new; the save change is kernel, not banked)

- **Corrected**: the term this re-measures is `SAVE_BATTLE_KERNEL_ALLOWANCE`, not
  `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` — the Save allowance split as its own prerequisite before any of
  this phase's runtime code existed (see §10's own updated kernel-lo passage above), and
  `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` is the action-side base, which `BE_RESTORE` never touches.
  Re-measure `SAVE_BATTLE_KERNEL_ALLOWANCE` on every save-capable RPG board (MMC1, MMC3, UNROM 512 —
  all three), equality-asserted once for the (already-proven-flat) term rather than per mapper,
  matching `kernelbytes.test.js`'s existing "title-on-with-Save minus title-on-without-Save" delta
  technique exactly — `BE_RESTORE`'s own call site is unconditionally part of that same delta (it is
  `.if BATTLE_ENABLED`-gated, the identical predicate the supplement itself is charged under), so no
  new measurement *technique* is needed, only a re-run of the existing one now that the delta itself
  has grown. This claim is narrower than it originally was and is worth restating precisely: it was
  never true that a single, undivided `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` figure could be re-measured
  this way and remain correct for both game types at once — that was a real, separate defect the
  prerequisite fixed — but restricted to the term `BE_RESTORE` actually grows, the "no new technique"
  claim holds.
- Extend `kernelbytes.test.js`'s existing conditional-combination coverage (the "documented
  limitation" rows for Save+Move and similar tight combinations, on the boards where they already
  bite) to confirm none of them silently gets worse purely from `BE_RESTORE`'s own added bytes —
  the same "does a small, real addition tip an already-tight combination" question those rows exist
  to keep answered, extended to cover this slice's own new kernel-lo cost specifically.

### §11.3 `main/smoke.js`

- After `sample-rpg` is opened (`:4074`, already present for the Battle-system-meter check), a
  second `forgeIds` loop — the identical loop `main/smoke.js:84-95` already runs against the action
  project, reused rather than duplicated — asserting the Magic Forge mounts something now that an
  RPG project is open, closing the exact gap §7.1 names.
- A rail-gating assertion around the *action* sample already open earlier in the script: `magic` is
  absent from `window.__app.forgeIds` there, and clicking through the rendered rail buttons (not
  `goTo` directly, which bypasses the same guard the rail's own render already enforces) never
  offers a Magic button — the negative case, since the positive case above only proves it appears
  for an RPG, not that it correctly disappears for an action project.
- Reuse the existing "close a project while a Forge is active, open a different one" pattern (if one
  already exists in the script for another cross-project-type case; if not, add the minimal one this
  slice actually needs) with Magic active going into an action-project open — asserting the app
  lands on `'tile'` rather than throwing or mounting Magic against the wrong project shape, per
  §7.1's `selectForge` guard.
- **§6's two DOM-rendered assertions live here, not in `rpg.test.js` (round 2 review, Medium 2).**
  `test/unit/banked.test.js:136-144` already documents why: the Build panel's own meter "cannot be
  driven from a node:test process -- it needs a real `document`... renderer coverage lives in the
  real-Electron smoke test instead," and `partyPanel` (`renderer/forges/sprite/battle.js:195`
  onward) is exactly the same shape of renderer code, built through the same `ui.js` `el()`
  helpers — `test/unit/rpg.test.js` boots ROMs through the jsnes core directly and never touches the
  renderer at all, so it cannot observe either assertion. After mounting the RPG sample's Sprite
  Forge party tab (the same `window.__app.goTo(...)` plus `#stage` query pattern the rest of this
  section already uses):
  - **§6's positive-direction boundary case**: build a catalog where a spell sits at position 8
    (unlearnable), delete an earlier spell so it shifts to position 7, and assert the checkbox for
    it in the rendered party tab is now enabled.
  - **§6's guard against imported/hand-edited data**: with a `spellId >= 8` seeded directly into a
    party member's `spells` (never via a delete sequence, since none can produce it — §6, Medium 4),
    assert the rendered party tab shows the "won't be castable" marker for that row.

### §11.4 `test/unit/rpg.test.js` (emulator-backed)

Per the brief's explicit requirement — schema/table/bank/mount tests are not enough for the engine
half of this slice:

- **A fixed range (`min === max`) reproduces a known, currently-passing damage/heal number exactly,
  and consumes no `rng_next` tick.** Round 1 review, Medium 5: the numeric outcome alone is not the
  load-bearing assertion here, since a wrong implementation could consume a roll and still,
  coincidentally, return the identical flat number — the design's own §4.1 already argues *why* the
  RNG-consumption question matters (every later roll in the same battle shifts), but the original
  test list never actually asserted it. Seed `rng`, cast, assert the damage/heal number as before,
  **and separately assert `rng`'s own RAM byte is bit-for-bit unchanged afterward** — the byte-for-
  byte migration guarantee, checked against the running ROM, not only against the compiled table,
  and checked as a state assertion, not only a numeric one.
- **A maximal range reaches the endpoint the old masked construction could never reach at all —
  this is the control that distinguishes the two constructions, not a separate one.** Round 1
  review, High 1: with `amountMin = 1`, `amountMax = 255` (`range = 254`), the previous masked-`AND`
  construction could **never** produce `amountMin`, on *any* `rng` seed whatsoever — masking with
  `$FF` is a no-op on `rng_next`'s own 1-255 domain, so the byte 0 (the offset `amountMin` needs)
  never occurs no matter how the LFSR is driven. So the fixture needs no side-by-side comparison
  against a second, deliberately-wrong implementation: force `rng` to whatever seed makes §8's
  corrected construction land on `draw mod n == 0` (`n = 255` here), cast, and assert the result is
  exactly `amountMin`. Any implementation that reaches this assertion at all — for this specific,
  maximal-range fixture — is provably not the masked construction, because no seed could ever make
  the masked construction pass it. This is the "control that distinguishes the correct mapping from
  the masked one" the review calls for: the maximal-range fixture *is* the control, by construction,
  not an assertion that additionally needs a second scenario alongside it.
- **A real, non-maximal range**, both endpoints reachable: force `rng_next`'s own RAM byte (already
  how existing RPG tests control rolls, e.g. `roll_hit`-adjacent fixtures) to values that must land
  the roll at `amountMin` and, separately, at `amountMax`, asserting the actual HP/MP delta on each.
- **`mod8` itself, at its divisor boundaries — round 2 review, Medium 1; corrected round 3, Medium 1;
  routine simplified round 4, Low 1 (the `bcs mod8_sub` branch this bullet originally targeted was
  unreachable on the whole byte domain, not only `mod8`'s accepted-draw subset, per §8's own
  correction above, and is no longer part of the routine at all — no fixture below mentions it).**
  Force `rng` so the rejection loop accepts a chosen `draw`, and cover: `n = 2` (the smallest legal
  divisor, the ordinary `cmp`/`bcc` compare/subtract path exercised at its narrowest); `n = 128` (the
  rejection loop's own worst acceptance-probability case, §8's own ~50.2% figure — exercised
  end-to-end, including a realistic number of rejected attempts before acceptance); `n = 255` (the
  maximal-divisor, no-subtract-possible case — every accepted `draw` here already satisfies
  `draw < n`, so `mod8` must return `draw` unchanged on every iteration, the single-target twin of
  §8's own "reaches `amountMin`" maximal-range fixture); `n = 127, draw = 253` (a real, reachable
  high-dividend compare/subtract case — `limit = 254` for this `n`, so `draw = 253` is the largest
  value the rejection loop can accept, and `253 mod 127 = 126` requires an actual subtraction inside
  `mod8`, not the trivial no-op `n = 255` case above); and `draw = limit - 1` for at least one other
  non-trivial `n` (the boundary value immediately below rejection, proving the accept/reject line
  itself sits exactly where `spell_amount_limit` says it does, not one off in either direction — `n =
  127, draw = 253` above already doubles as this case, since `253 = limit - 1` for that `n`). Each
  fixture asserts the resulting HP/MP delta against the *known* correct `amountMin + (draw mod n)`
  for its own chosen `draw`, not merely that some value in range came out — an implementation with an
  off-by-one in the accept/reject compare, or in the ordinary `cmp`/`bcc`/`sbc` remainder loop itself,
  would still produce *a* legal-looking amount for most draws, so the assertion has to name the exact
  expected value per fixture, the same "far apart and obviously different" discipline this design's
  own earlier test sections already hold to, not merely "did it land in range."
- **Damage into a weakness/strength**, range live: confirms the roll's output still feeds
  `spell_damage_weak`/`spell_damage_strong` correctly, and that the already-saturating `$FF` clamp
  (§8.0) still holds when a rolled *maximum* amount lands in a weakness.
- **Healing near a member's max**, range live: same saturation check, heal side, mirroring the
  existing "near the top of a byte" fixtures this file already has for the flat-amount case.
- **All-target scope, range live**: two or more living targets, asserting each one's damage was
  rolled independently (not one shared roll broadcast to all) — the concrete way to catch a
  cached-and-reused-roll implementation, which would show identical damage on every target where an
  independent roll on each would not (barring the rare `rng_next` coincidence, which the fixture
  should choose `rng` values to avoid).
- **§5's save-restore recompute — corrected file assignment (`handoff-magic/phase4-design.md`, Q6):
  `test/unit/save.test.js`, not this file.** `rpg.test.js` has real battle/casting helpers but no
  `Save` command, no SRAM record, no power-cycle, no checksum-reseal and no cross-ROM
  battery-transplant machinery at all — the identical class of error as this section's own §6
  fixtures above (a design written before anyone checked which file could actually run the test).
  `save.test.js` already owns all of that; see phase4-design.md's own Q6 for the fixture rebuilt on
  top of it (a cross-build transplant, not a single-project save/load), and
  `handoff-magic/phase4-impl-1-report.md` for its implementation. The claim itself is unchanged: a
  save written with a party member who has since had a spell deleted out from under their learned
  list (via `renumberSpellDeletion`, so the JSON reference is already correct) restores a `pc_spells`
  mask that matches the *current* build's table, not a stale restored byte — and, per §5's documented
  side effect, `pc_hp_max`/`pc_mp_max` after Continue match a freshly recomputed value rather than
  whatever was literally saved.
- **§6's real, positive-direction boundary case, the emulator-observable half.** Build a catalog
  where a spell sits at position 8 (unlearnable), delete an earlier spell so it shifts to position 7,
  have a member learn it in its new position, and assert the *compiled* `pc_spells_at` bitmask
  actually grants it — booting the ROM and confirming the member can cast it in battle — confirming
  the privilege model and `renumberSpellDeletion` agree with each other in the direction deletion can
  actually move an id (downward), replacing the round-1 design's own impossible upward-drift fixture
  (Medium 4: the deletion primitive only ever decrements, so it cannot produce the case that fixture
  described). The rendered checkbox for the same fixture is §11.3's assertion, not this one (round 2
  review, Medium 2: this file has no DOM to render it into).
- **§6's guard against imported/hand-edited data, the emulator-observable half.** For a fixture whose
  learned entry names a `spellId >= 8` **seeded directly** into `member.spells` (standing in for a
  hand-edited or pre-this-design project, per Medium 4's own correction — not reached via any delete
  sequence, since none can produce it), boot the compiled ROM and confirm the member genuinely cannot
  cast that spell — `pc_spells_at`'s own generator-side drop (`battletables.js:243`, unchanged by
  this design) reaching the actual build, not only the JSON. `checkBattleTables`'s warning for the
  same fixture is a `node:test` unit test in **§11.2** (`bankedbytes.test.js`, not §11.1 — round 3
  review, Low 3); the party tab's rendered "won't be castable" marker for it is §11.3's assertion —
  neither belongs here.

## §12. Phase breakdown

**Round 1 review, High 2 — the previous phase 3 was never actually shippable, and this is corrected
by merging rather than by adding a bridge.** The earlier breakdown put "Schema" (phase 2, which
included `normalizeSpell` no longer writing a flat `amount`) two phases ahead of "The engine" (phase
4, the only phase that changes `battletables.js` to read `amountMin`/`amountMax` instead of
`amount`), and called the phase-3 midpoint between them — Forge extraction, still described as
resting on "the flat-`amount` engine still underneath it" — a real, shippable increment. It is not:
`battletables.js` would still be reading `spell.amount` at that point, which is `undefined` the
moment phase 2's migration stops writing it, and `hex()`'s own `& 0xff` masking
(`battletables.js:54`) turns `undefined` into `$00` with no error, no warning, silently compiling
every migrated spell's damage/heal to zero. The brief's own two offered corrections were an atomic
merge or an explicit flat-amount bridge kept alive until the engine lands; a bridge is real, working
extra machinery (a second, temporary code path in the compiler, a UI restriction keeping range
authoring unavailable until it can be honored, and its own eventual removal) for a gap this phase
list does not need to create in the first place — **merging is simpler and is what this design now
does.**

1. **The primitive and the repair.** `renumberSpellDeletion` (§3.2), its unit tests (§11.1). No UI,
   no engine change — this can land and be reviewed entirely on its own, the same way the analogous
   actor/item siblings did.
2. **Schema and engine, atomically — one phase, not two.** `amountMin`/`amountMax` migration, the
   `mpCost` bound fix (§4.1, §4.3), `roll_spell_amount` and `mod8`, the two call-site swaps,
   `spell_amount_min`/`_n`/`_limit` table emission, and the `bankedbytes.test.js` re-measurement
   (§8, §10, §11.2, §11.4's roll-specific fixtures) all land in one change. Neither half is safe
   alone: the schema half with no engine half silently zeroes every migrated spell (High 2, above);
   the engine half with no schema half reads table fields that do not exist yet. This phase has no
   kernel-side call site at all — `kernelbytes.test.js`/§11.2a's own remeasurement belongs to phase 4
   below, where `BE_RESTORE`'s `continue_game` call site actually lands (round 2 review, Low 3:
   removed from here, where the round-1 draft wrongly listed it too). `ELEMENTS` append (§4.2) has no
   such coupling to either half and can ride along in this same phase or land as its own trivial
   one — noted separately because, unlike the rest of this phase, it is genuinely independent.
3. **The Forge module and registry entry**: extraction (§7.2, §7.3), rail gating (§7.1), smoke
   coverage (§11.3). Only *now* is this a real, shippable increment with nothing silently broken
   underneath it: by the end of phase 2 the full min-max range pipeline already works end to end,
   so phase 3 gives it a home rather than exposing a UI for a table the compiler cannot yet fill in
   correctly.
4. **The save-record recompute**: `BE_RESTORE`, `continue_game`'s own change, `battle_entry`'s
   dispatch-chain restructuring (§5's own priced wrinkle), its emulator tests (§5, §11.4's
   save-restore fixture) and its kernel-lo remeasurement (§11.2a). Independent of phase 2 — could
   ship before it, since the bitmask-retargeting hazard exists the moment `renumberSpellDeletion`
   (phase 1) ships, not only once ranges exist.
5. **The learn-privilege gap fix**: `checkBattleTables`'s new warning, the party tab's live marker,
   and §6's own positive-direction boundary test (old slot 8 → slot 7) (§6, three fixtures mapped to
   three different test environments by what each can actually observe — round 3 review, Low 3,
   corrected below after the round-2 draft's own summary conflated two of the three: the
   `checkBattleTables` generator warning is a `node:test` unit test in **§11.2**
   (`bankedbytes.test.js`, the existing home for `battletables.js`-exported checks — not §11.1, which
   is specifically `shared/project.js`/`renumberSpellDeletion`); the rendered checkbox and "won't be
   castable" marker are **§11.3** (`main/smoke.js`, the only environment with a real `document`); the
   compiled `pc_spells_at` bitmask/castability effect is **§11.4** (`rpg.test.js`, booting the ROM)).
   Depends only on phase 1 (the primitive it is downstream of) and phase 3 (a Magic Forge `where:` to
   point the warning at, and a real party tab for smoke to inspect) — could land as early as directly
   after phase 3.
6. **The "where" string sweep** (§9) — depends on phase 3 existing (`'Magic Forge'` has to be a
   real Forge title before anything can name it) and is otherwise a pure string change with no
   engine or schema dependency; natural to fold into phase 3's own commit rather than stand alone.

## §13. What animation will need from this design, and what this slice must not foreclose

One section, not a design, per the brief. Both item 13's own animation thread and item 14's
battle-side-animation thread (explicitly the same open question, ROADMAP.md's own "Shared with item
13" note) will need:

- **A per-spell field to hang an animation reference on** — this design's `spell` schema shape
  (`{id, name, mpCost, kind, amountMin, amountMax, element, scope}`) has no animation field and adds
  none; nothing here should be read as having decided animation is *scoped to the spell record*
  rather than, say, the element or the kind. Whichever the shared design picks, `normalizeSpell`'s
  own one-time-migration idiom (§4.1) is the pattern to reuse for introducing the field later, not a
  new one.
- **A stable place in the banked region's byte budget to grow into.** §10's rollup leaves roughly
  3.6 KB of headroom even after this slice's own additions — this design deliberately spends none of
  it on speculative animation-table space, so whichever mechanism the shared design picks
  (`draw_metasprite` flipbook vs. `PALETTE_FX` reuse) starts from the real, re-measured base §10
  produces, not a padded one.
- **The Forge boundary must not harden around "no animation" as a permanent assumption.** The Magic
  Forge page (§7.3) is a plain per-field-commit editor with no reserved layout slot for an animation
  picker — this is fine as a starting shape (Items Forge itself grew fields across several phases
  without the first phase reserving UI space for the later ones) and is explicitly *not* a claim that
  animation authoring belongs somewhere else; §7.2's Forge-boundary reasoning (spell authoring lives
  where the spell record lives) applies to an animation reference the same way it applies to every
  other spell field.
- **This slice's own §6 fix must survive whichever catalog model animation settles on.** If item 14's
  parallel monster-animation work or a future widening of the 8-slot privilege model (§6) ever
  changes what "position in the catalog" means, `checkBattleTables`'s new warning (§6) is reading
  `member.spells[].spellId` position *at build time*, off the same live array animation work would
  also read — no separate index this design introduces would need to be kept in sync with it.

## §14. Changelog

*(For review rounds to append to.)*

### Round 1 (`handoff-magic/magic-design-review1.md`) — eight findings, all fixed

- **High 1 — biased sampler, unreachable minimum (§8).** `rng_next` never yields 0
  (`engine/rpg.asm:14-23` swaps a zero state for `$A5`), so the round-0 masked-`AND` construction was
  analyzed against the wrong source domain: masking is biased against every outcome for any mask
  width, and for the legal maximal range (`amountMin=1, amountMax=255`, mask `$FF`) `amountMin` was
  provably unreachable from any seed. Replaced with an exact construction over the real 1-255 domain:
  `draw = rng_next() - 1` (uniform 0-254), reject `draw >= limit` (`limit` the largest multiple of
  `n = amountMax - amountMin + 1` that fits in 255), reduce the accepted `draw mod n` via a fixed
  8-iteration shift-subtract division (not a data-dependent repeated-subtraction loop), `+
  amountMin`. Both loops are bounded and priced: the rejection loop's expected trip count is at most
  ~2 for any legal `n` and is guaranteed to terminate within one 255-value LFSR period in the
  absolute worst case; the division is a fixed, luck-independent 8 iterations. Neither is a
  frame-budget concern — a cast happens once per turn, not once per frame. §11.4 gained a maximal
  1-255 fixture that reaches `amountMin` (impossible under the old construction from any seed, so
  reaching it at all is itself the distinguishing control) and an explicit RNG-state assertion
  alongside the existing fixed-range numeric one.
- **High 2 — phase boundary shipped `amount=0` (§12).** The round-0 phase list put schema migration
  (which stops writing `amount`) two phases ahead of the engine change (the only phase reading
  `amountMin`/`amountMax` instead), and called the midpoint — Forge extraction over "the flat-amount
  engine still underneath it" — shippable. It was not: `battletables.js`'s `hex()` (`:54`) masks with
  `& 0xff`, silently compiling every migrated spell's damage/heal to zero the moment schema outran
  engine. Schema and engine now land as one atomic phase (§12, phase 2); Forge extraction moved to
  phase 3, after a complete, working range pipeline already exists to give a home to.
- **High 3 — kernel-lo accounting omitted (§10, §11).** `continue_game`'s new `call_battle` call site
  is kernel, not banked, and save-conditional — its cost belongs to
  `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` (`generate.js:491`, `{1: 547, 4: 552, 30: 719}`), equality-pinned
  per board by `kernelbytes.test.js:411-440`, not to the banked-region base the round-0 draft named
  as the only thing expected to move. Added a separate kernel-lo budget row (§10) and a
  `kernelbytes.test.js` remeasurement subsection (§11.2a), kept distinct from the banked `BE_RESTORE`
  loop-wrapper cost.
- **Medium 4 — impossible fixture (§6, §11.4).** `renumberSpellDeletion`'s `shift` only ever
  decrements or removes an id, never increases one, and the party tab's checkbox already refuses a
  *new* check past position 7 — so a learned entry can never drift from `<8` to `>=8` through
  ordinary deletion, the direction the round-0 fixture assumed. Corrected §6 to describe the real
  reachable case (deletion can move a later spell *down* across the boundary, making it newly
  learnable) and reframed the warning/marker as a guard against imported/hand-edited/legacy data
  (which normalization's own id-below-catalog-length filter does admit at `>=8`), not against this
  design's own repaired delete flow. §11.4 replaced the impossible upward-drift fixture with the real
  positive-direction boundary case (old slot 8 → slot 7 becomes learnable) plus a separate fixture
  that seeds a `>=8` learned entry directly, never via a delete sequence.
- **Medium 5 — fixed-range test didn't test the RNG guarantee (§11.4).** The design's own §4.1
  already argues that a fixed-range cast consuming an RNG tick (even while returning the right
  number) would shift every later roll in the battle — but the original test list only asserted the
  numeric outcome, which a buggy implementation could pass by coincidence. Added an explicit
  RNG-state-unchanged assertion alongside the existing numeric one.
- **Medium 6 — `mpCost` bound direction reversed (§4.3).** The round-0 draft narrowed the editor to
  0-99 to match `normalizeSpell`, on the claim that 99 is the engine's own castability ceiling. It is
  not: `statAt` (`battletables.js:83-85`) caps a party member's actual compiled max MP at a full byte,
  255, and a monster's `battle.mp` is likewise an unclamped byte — a leveled member can need to cast
  a spell costing more than 99. Reversed the fix: `normalizeSpell`'s clamp widens to 0-255, matching
  the editor field (already 0-255) and the byte-sized engine domain on both sides; the false
  single-ceiling rationale is retracted.
- **Medium 7 — async identity flow unspecified (§3.2, §7.3).** The delete handler sketch used a bare
  `index` with nothing around the `confirmModal` await, missing the exact hazard Items Forge's own
  history (`items.js`'s round 1d finding D2 / round 1e finding E4 comments) already fixed once:
  an index resolved before an `await` can name something else by the time it resolves. §3.2 now spells
  out the complete flow — capture the target object before the await, re-resolve its index by
  identity afterward, abort with a toast on `-1` — and only the re-resolved index reaches
  `renumberSpellDeletion`/splice/restamp.
- **Low 8 — wrong tightest board, headroom overstated by 46 bytes (§10, §11.2).** MMC3's measured
  banked base (3931) is 46 bytes higher than MMC1/UNROM 512's (3885,
  `battletables.js:416-433`), making MMC3 the tightest board at 3760 bytes free before this slice,
  not MMC1/UNROM 512 at 3806. Corrected the figure and the board named in §10, and pointed §11.2's
  fits-control fixture at MMC3. The conclusion (this slice's estimated growth fits with real margin)
  is unaffected.

### Round 2 (`handoff-magic/magic-design-review2.md`) — three findings, all fixed

- **Medium 1 — `mod8` had no register/scratch contract, and the cycle claim priced a roll as a cast
  (§8).** `cast_all` (`engine/battleturn.asm:301-317`) keeps its own end-of-side loop sentinel in
  `bt_tmp2` across `jsr spell_damage` — one of `roll_spell_amount`'s two call paths — so `bt_tmp2`
  must survive the entire `roll_spell_amount`/`mod8` call chain untouched; `bt_tmp` is free. Wrote
  out the actual eight-step `mod8` routine (shifting dividend in `bt_tmp`, remainder built up in A,
  eight-count in Y, X preserved, `bt_tmp2` never touched, every clobber stated), including the
  `bcs mod8_sub` branch after `rol a`. **Correction, round 3: this entry's own claim that the branch
  is "required for correctness once `n > 128`" was wrong — round 3's Medium 1 found it unreachable on
  `mod8`'s real domain (0-254 dividends only) for every legal `n`, confirmed by exhaustive simulation
  of all 65,025 `(n, draw)` pairs; see the round 3 entry below.** Corrected the cycle pricing to be
  per roll (~200-250 cycles expected, ~7,850 worst-case) and separately priced a full four-target
  all-scope cast (~800-1,000 expected; ~31,000 in the joint, astronomically-improbable worst case,
  stated honestly rather than rounded away, with the actual consequence named — extra
  turn-resolution latency, not a corrupted frame) — **these cycle figures were themselves
  undercounts, also corrected in round 3 (Low 2); see below.** Added a §11.4 test item exercising
  `mod8`'s own divisor boundaries (`n=2`, `n=128`, `n=255`, `draw=limit-1`) against named expected
  values, not merely "landed in range" — the specific claim that `n=255`/`n=129` exercise the
  overflow branch was also removed in round 3, per the same correction.
- **Medium 2 — a rendered-marker assertion was placed in a test environment with no DOM (§6, §11.3,
  §11.4).** `test/unit/banked.test.js:136-144` already documents that renderer panels needing a real
  `document` cannot be driven from `node:test` and that renderer coverage belongs in the real-Electron
  smoke test; `partyPanel` is exactly that kind of renderer code. Moved both DOM-observable
  assertions — the shifted-spell checkbox becoming enabled, and the seeded-`>=8`-entry "won't be
  castable" marker — to a new §11.3 bullet (after mounting the RPG sample's Sprite Forge party tab),
  and left only the emulator-observable halves (the compiled `pc_spells_at` bitmask's own effect,
  checked by booting the ROM and casting) in §11.4. Also corrected §6's own item 2, which described
  the marker fixture as "the same test shape" as the (correctly unit-testable) generator warning in
  a way that could be read as claiming the same environment; it now says explicitly that the fixture
  construction is shared but the test environment is not. While in there, also moved the identical
  DOM-observable "checkbox becomes enabled" claim in §11.4's positive-direction boundary fixture
  (immediately adjacent to the marker fixture the review named, and the same category of error) — not
  separately named by the review, but the same defect, and leaving it uncorrected next to the one
  that was fixed would have been inconsistent.
- **Low 3 — §10/§12 contradicted themselves about which bank and phase pay for what.** Confirmed
  `engine/battle.asm` (`BE_RESTORE`'s own loop/dispatch work) and `engine/battleturn.asm`
  (`roll_spell_amount`/`mod8`) are both the banked, switchable region, while only the new
  `continue_game` call site in `engine/save.asm` is kernel. §10's introductory sentence and the banked
  table's own header previously said the design adds "table rows, not base code, everywhere except
  §5's `BE_RESTORE`" and called `BE_RESTORE` "the one row... that does *not* land here" — both false;
  the table two lines down already correctly listed `BE_RESTORE`'s loop as banked. Rewrote both
  sentences to name `roll_spell_amount`/`mod8` and `BE_RESTORE`'s loop/dispatch work as banked-base
  growth and the `continue_game` call site alone as the kernel-lo item. In §12, removed
  `kernelbytes.test.js`/§11.2a from phase 2's list (phase 2 — schema and engine — has no kernel call
  site to remeasure) and left it only in phase 4 (the save-recompute phase), which already listed it.

### Round 3 (`handoff-magic/magic-design-review3.md`) — three findings, all fixed

- **Medium 1 — the `bcs mod8_sub` overflow branch is unreachable, and §8/§11.4/§14 claimed it was
  load-bearing (§8, §11.4, and the round-2 §14 entry above).** The round-2 claim ("the doubled
  remainder can reach `2n - 1`, which exceeds 255 for any `n > 128`") reasoned about the divisor in
  isolation and missed that `mod8` is only ever called with an accepted `draw` in 0-254: for `n <=
  128` the ordinary long-division invariant bounds the pre-subtract value at `2n - 1 <= 255`; for `n
  > 128`, `limit = n`, so every accepted `draw` is already `< n` before the loop starts, and each
  partial prefix extracted from it stays bounded by `draw` itself. Confirmed by exhaustive simulation
  of all 65,025 `(n, draw)` pairs: correct remainder every time, the branch taken zero times. Rewrote
  §8's paragraph after the code block to state the branch is unreachable on this real domain, and
  chose to **keep it as harmless, explicitly-labelled defensive code** (rather than delete it) —
  reasoning that the unreachability is a property of `roll_spell_amount`'s own rejection
  construction, not of `mod8` in isolation, so the guard is cheap insurance (16 cycles total) against
  a future edit to that construction silently widening `mod8`'s effective input domain. Removed the
  "`n = 255` reaches the overflow branch" and "`n = 129` minimal reachability" claims from §11.4's
  test bullet and corrected the round-2 §14 entry above; kept `n = 2` and `n = 128` as originally
  named (smallest divisor, worst rejection-probability case) and added `n = 127, draw = 253` as a
  real, reachable high-dividend compare/subtract case (`limit = 254` for that `n`, so `253` is the
  largest acceptable draw, and `253 mod 127 = 126` forces an actual subtraction) — which also doubles
  as the required `draw = limit - 1` boundary case. **Correction, round 4: this entry's own "keep it
  as harmless, explicitly-labelled defensive code" reasoning was itself overstated — the branch
  defends against no realistic edit, since it is unreachable on the *entire* byte domain (any
  dividend, any divisor), not only the accepted-draw subset this entry's own argument was scoped to;
  see the round 4 entry below, where the branch is removed rather than kept.**
- **Low 2 — the corrected cycle totals still undercounted the written instructions (§8).** Recomputed
  from the actual instruction sequences: `rng_next` (`engine/rpg.asm:14-24`) is `jsr` + body + `rts`
  ≈ 26-27 cycles, so a rejected attempt (plus the caller's `sec`/`sbc`/absolute-indexed `cmp`/taken
  `bcs`) is ≈37-38 cycles, not ≈30. `mod8`'s own loop body is ≈21 cycles on a no-subtract iteration
  and ≈24 on a subtract iteration (`asl zp` 5, `rol a` 2, `bcs` 2, `cmp abs,x` 4, `bcc` 2/3, `[sbc
  abs,x` 4`]`, `dey` 2, `bne` 3), putting the whole routine (setup, eight iterations, `rts`) at
  ≈186-207 cycles, not 150-190. Expected cost per roll at the worst `n` is therefore ≈280 cycles, not
  200-250; the loose 255-attempt worst-case bound is ≈9,800 per roll (not 7,850) and ≈39,000 for a
  four-target cast (not 31,000) — labelled explicitly, per the review's own instruction, as a
  conservative product of four independent per-call bounds rather than a claim that four genuinely
  independent full-period stalls can co-occur (the LFSR has exactly one state at a time). Kept the
  conclusion, strengthened with the actual mechanism rather than only a probability argument:
  `main_loop` (`engine/boot.asm:102-103`) waits for vblank before any mainline work, `vram_ready` is
  published only as the last store of that pass (`engine/boot.asm:254`), and NMI skips draining an
  unpublished queue (`engine/boot.asm:339-340`) — so even the corrected, quadrupled worst-case bound
  (≈39,000 cycles) stays under two full frame periods (59,560), and the real consequence of an
  unusually long tick is exactly one extra frame of latency, never a partial VRAM drain.
  **Correction, round 4: these figures were computed for `mod8` with the (round 3) `bcs mod8_sub`
  branch kept; round 4 removes that branch as genuinely pointless rather than merely unreachable on a
  narrower domain, which lowers `mod8` to ≈170-191 cycles, expected-per-roll to ≈265, and (barely, the
  255-attempt rejection loop dominates the total either way) the worst-case bounds to ≈9,900/≈39,600 —
  see the round 4 entry below for the updated arithmetic. The conclusion (well under two frame
  periods, one extra frame of latency at worst) is unchanged by any of these adjustments.**
- **Low 3 — §12 phase 5 mapped the three learnability assertions to the wrong subsections.** The
  round-2 wording said "the generator warning and compiled-table effects in the first two [§11.1,
  §11.3]," but §11.3 *is* `main/smoke.js` (the rendered checkbox/marker's own home), not a compiled-
  table-effects location — the sentence had two of the three destinations tangled together. Stated
  the mapping explicitly instead: the `checkBattleTables` generator warning is a `node:test` unit
  test, named to **§11.2** (`bankedbytes.test.js`) rather than left as "§11.1-adjacent" with no real
  file — `checkBattleTables` lives in `main/build/battletables.js`, a different file from §11.1's own
  `shared/project.js`/`renumberSpellDeletion`, and `bankedbytes.test.js` is already this design's own
  precedent for a `battletables.js`-exported check (`checkBattleStringsCapacity`, round 1); the
  rendered checkbox and marker are §11.3 (`main/smoke.js`); the compiled `pc_spells_at` bitmask/
  castability effect is §11.4 (`rpg.test.js`). Fixed both §12 phase 5 and the "§11.1-adjacent" phrase
  in §11.4 to name §11.2 explicitly, and added the same explicit mapping to §11.2 itself as a new
  bullet, so the test plan states its own destination rather than requiring a reader to infer it from
  the phase list.

### Round 4 (`handoff-magic/magic-design-review4.md`) — two findings, both fixed

- **Low 1 — the retained `bcs mod8_sub` was not "defensive" against anything (§8, §11.4, and the
  round-3 §14 entries).** Round 3 kept the branch reasoning it guarded `mod8` against a future edit
  to `roll_spell_amount`'s own rejection construction widening the dividends `mod8` could see. That
  framing does not survive scrutiny: the branch is unreachable for *every* byte dividend 0-255 and
  *every* divisor 1-255, not only the narrower 0-254 accepted-draw subset round 3's own argument was
  scoped to — an 8-bit accumulator built from exactly eight shift-in steps cannot exceed `2^i - 1`
  after `i` steps regardless of `n`, dividend, or whether a conditional subtraction fired along the
  way, so before the final iteration it is bounded at 127 and the last shift-in can reach at most
  255, never carrying. No incremental widening of the rejection loop could ever make the branch
  reachable; only changing `mod8`'s own byte width or iteration count would, and neither is a
  plausible edit to this routine's own shape. **Chose to delete the branch** rather than keep it
  relabelled: with no realistic edit it defends against, and with non-reachability now an arithmetic
  fact about the routine's structure rather than a property of its caller, there is nothing left for
  "defensive" to mean. Removed `bcs mod8_sub` from the §8 code block, rewrote the paragraph after it
  to state the stronger (whole-byte-domain) unreachability argument and the deletion decision,
  re-priced every downstream cycle figure (`mod8` alone ≈170-191 not 186-207; expected cost per roll
  ≈265 not 280; four-target expected ≈1,050-1,100 not 1,100-1,150; worst-case single roll ≈9,900,
  barely moved from ≈9,800 since the 255-attempt rejection loop dominates that particular figure;
  four-roll worst case ≈39,600 not ≈39,000 — the "under two frame periods" conclusion unaffected by
  any of these adjustments), fixed §11.4's boundary-test bullet to stop mentioning a branch no longer
  in the routine, and added correction notes to both the round-2 and round-3 §14 entries above
  (neither entry's own numbers were rewritten in place, to keep each round's own historical record
  intact — each now points at where the corrected figures actually live).
- **Low 2 — §6 still did not state the three-way test mapping (§6).** Item 1 ended "a genuine
  `node:test` unit test" with no file named; item 2 said "§11.3/§11.4 place this assertion
  accordingly" without saying which of the two gets which half. Added one explicit sentence above
  both items naming all three destinations at once (§11.2 `bankedbytes.test.js` for the generator
  warning, §11.3 `main/smoke.js` for the rendered checkbox/marker, §11.4 `rpg.test.js` for the
  compiled bitmask/castability effect — matching what §11.2, §11.4, and §12 phase 5 already stated),
  then named §11.2 directly in item 1's own closing sentence and split item 2's closing sentence into
  its DOM half (§11.3) and its compiled-effect half (§11.4), so §6 is no longer the one place in the
  document that left this mapping to be inferred.
