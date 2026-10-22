# Design record: growth profiles (ROADMAP item 5, the last remainder)

Status: **built** (2026-10-21/22; commits D1 `0c4d860` one `GROWTH_LIMITS` table, C1 `4a70d00` data model, persistence and diagnostic, C2 `7d8f748`
generator and magic gates, C3 `7ba5a29` the Character Forge UI; C4, this record and the docs). Written from the accepted design
(`handoff-next/classes/design.md`, v4, after three review rounds) and **brought up to what shipped**: where the build differs from the design, the tree
wins. Current-state rules live in the `docs/reference-*.md` files this record points at; this file is history and rationale.

Equipment (`docs/design-equipment.md`) and encounter groups (`docs/design-encounter-groups.md`) were the earlier pieces of ROADMAP item 5. This closes the
last piece that was built. **Classes** (a class's spell list and equipment restrictions, and changing class during play) **stay deferred** (section 9).

## 1. What it does, in one paragraph

An RPG project holds up to **8 named growth profiles** (`RPG_LIMITS.growthProfiles`) in the Character Forge. A profile gives each of the six party
stats (HP, MP, ATK, DEF, MAG, MDEF) a base, an average gain per level and a **curve shape**: `linear`, `early` (front-loaded) or `late` (back-loaded).
A party member may point at one profile (`member.profileId`) instead of using its own numbers. The generator resolves the reference into the **existing**
per-member, per-level `pc_*_at` tables, so there is **no new engine code, no new allowance and no save byte**. A project that uses no profile builds a
byte-identical ROM. The one new capability is the non-linear curve. It is called "growth profiles", not "classes": a class implies spells and gear, which
a profile does not carry.

## 2. Chris's rulings of 2026-10-21 (quoted from the design, section 8)

- **R1.** Scope: "Growth profiles only". B (class spell lists, equipment restrictions) and C (a runtime class change) are deferred.
- **R2.** Deleting a referenced profile: "Refuse, name members". Deletion is refused while any member references the profile, naming the members; the
  author unassigns first. There is no bake. Legacy member clamps stay unchanged.
- **R3.** Curves: "Fixed level-15 horizon". Linear / early / late over levels 1..15; changing the level cap never retunes an existing level; the UI
  labels growth as the average per level through level 15. No typed per-level table.
- **R4.** The D1 range fix is in scope as **its own small commit** (narrow the Character Forge inputs to the normalizer's ranges, no ROM change, with a
  test that fails if the two diverge again). XP speed per profile and monsters sharing profiles are **out**.

## 3. What the code did before

The engine reads only `pc_*_at` rows keyed `member*MAX_LEVEL + level - 1` (`level_row`, then `lda pc_x_at,y`) and the `pc_spells_at` masks. Nothing in
`engine/*.asm` knows where a table byte came from, and `main/build/battletables.js` `levelTable` evaluated each member's table with `statAt(base, perLevel,
level)`: strictly linear, clamped 0..255. So a non-linear curve needs no engine change, only different bytes in the same rows.

`party_restore` re-derives stats from the **current build's** tables at Continue, so a profile edited between a save and a load moves a saved member's
maximum HP exactly as editing `hpPerLevel` always has (T10 documents it).

### 3.1 The defect D1 fixed first

The Character Forge offered base MP 0-255 and MP / ATK / DEF growth 0-32 per level, but `normalizePartyMember` clamps those to 0-99 and 0-16 on load, so a
typed value was silently changed on the next open. D1 made `GROWTH_LIMITS` the one table both read and **narrowed the four inputs**; it widened nothing,
so no stored value and no ROM changed. Profiles use the same table on purpose: numbers move between a profile and a custom member without loss. The
capability given up (prospective only; no existing data is affected): a profile cannot start MP above 99 or use MP / ATK / DEF slopes 17..32.

## 4. The data model

```
project.growthProfiles = [ { id, name, hp: {base, perLevel, shape}, mp, atk, def, mag, mdef } ]      // <= 8, id == array index
member.profileId = null | integer                                                                     // null = the member's own base* / *PerLevel
```

- `GROWTH_LIMITS` (`shared/project.js`) is, per stat, `{ baseMin, baseMax, perLevelMin, perLevelMax }`: hp 1-255 / 0-32, mp 0-99 / 0-16, atk, def, mag, mdef
  0-255 / 0-16. It is read by `normalizePartyMember`, the profile normalizer, `clampGrowthValue` and the Character Forge inputs. `GROWTH_STATS` is its key
  order. `perLevelMin` is 0 for every stat, so no caller needs a numeric literal.
- `GROWTH_SHAPES = ['linear', 'early', 'late']`, persisted as strings so reordering is safe; an unknown shape normalizes to `'linear'`.
- `clampGrowthValue(stat, kind, value, fallback)` is the one rule for rounding and bounding a typed profile number. The normalizer stores through it and the
  Character Forge commits through it, so a typed 24.6 is stored as 25 at once, not after the next load (a C3 review finding).
- `normalizeGrowthProfiles` reads `raw.growthProfiles` (absent is `[]`), slices to the cap, restamps `id = index`, and builds profiles **before** the party
  so `normalizePartyMember` can null a `profileId` outside `[0, profileCount)`. Names go through `normalizeLabel` (default `Profile N`, duplicates allowed).
- `createGrowthProfile` takes `createPartyMember`'s numbers (HP 24/+5, MP 8/+2, ATK 6/+1, DEF 4/+1, MAG 0/+0, MDEF 0/+0), every stat linear.
- Persistence: `growthProfiles.json` beside `party.json`, **always written** (`[]` too), read with a `null` fallback to `[]` (`main/project-io.js`).
  `PROJECT_FORMAT` stays 1: additive, and an absent file or field normalizes to empty. **No fixture has the file and none is regenerated.**
- No save-format change: a profile is build-time data, so there is no `SAVE_LAYOUT_VERSION` bump and no `saveCompatToken` change.

### 4.1 The curve (integer arithmetic, no floats)

`profileStatAt(record, level)` with `k = level - 1` and horizon `H = 14` (`GROWTH_HORIZON_LEVEL - 1`), clamped to 0..255:

- linear: `base + perLevel * k` (it calls `statAt` itself)
- early: `base + floor((perLevel * k * (2H - k) + H/2) / H)`
- late: `base + floor((perLevel * k * k + H/2) / H)`

All three reach `min(255, base + 14 * perLevel)` at level 15 (R3), so `perLevel` is the **average per level through level 15** and a shape only moves the levels
between. Hand-computed for `perLevel 3`: early k=1,2,14 -> 6, 11, 42; late k=1,2,7,14 -> 0, 1, 11, 42. The horizon is `GROWTH_HORIZON_LEVEL` (15), **not**
`project.rpg.maxLevel`: lowering the cap never retunes an existing level, but a cap below 15 stops the curve before its endpoint, so a shape changes the
attainable maximum. At cap 8, base 24 / +3 gives at level 8: linear 45, early 56, late 35. A cap change already invalidates earlier saves
(`saveIdentity` folds `rpg.maxLevel`). A non-linear `k` is held to 0..H so a level past the horizon can never fall back down the curve.

### 4.2 Effective growth

`effectiveGrowth(project, member)` returns `{ hp: {base, perLevel, shape}, ... }`: the profile's six records when `member.profileId` indexes a live profile,
else the member's own fields with shape `linear` (a dangling id reads as no profile, never `NaN`). `memberStatAt(project, member, stat, level)` evaluates
one stat through it; the curve itself has one implementation, `profileStatAt`, which `memberStatAt` calls on the resolved record. **Every production consumer of
effective member growth reads it through `effectiveGrowth` / `memberStatAt`**: `levelTable`, `projectUsesMagicPower`, `projectUsesMagicDefence` and the
Character Forge's selected-member preview. The selected-profile preview has no member to resolve and calls `profileStatAt` on the profile's own record. The
member's stored custom fields (`baseHp` / `hpPerLevel` and their siblings) are legitimately read by the resolver itself (`growthRecord`), by default construction
(`createPartyMember`), the normalizer, the Forge's custom-number inputs (editable data, retained while a profile is assigned) and explicitly unprofiled fixture
constructors and oracles; the rule is that an effective-growth consumer must not bypass the resolver. Own numbers survive assignment, so **unassigning restores the author's previous numbers losslessly**.

## 5. Generator and engine: why no engine code, no allowance

- `levelTable` in `main/build/battletables.js` calls `memberStatAt(project, m, stat, level)` where it called `statAt(m.baseX, m.xPerLevel, l)`. The table text,
  labels, row count, row length and `.if` flags are unchanged for a member with `profileId: null`.
- Bytes: new engine code 0, kernel-lo 0, banked code 0, new tables 0, no `GROWTH_*_ALLOWANCE` (a stray one would be a bug; T11 and the `bankedbytes.test.js`
  equality guard it). Occupancy is *not* invariant for every assignment: a profile that is the only MAG (MDEF) source in the project switches on the
  **existing** magic feature at its **existing** price, exactly as a raw `baseMag` does. Measured on `sample-rpg` (two members, maxLevel 8, four actors) on all
  three RPG boards: **+82** region bytes for MAG (62 code + 20 table) and **+76** for MDEF (56 + 20). Merely having equipment in the project does not change that price: with a
  zero-bonus Wand present, a profile that becomes the sole MAG / MDEF source still adds 82 / 76. The **109 / 103** figures in `test/unit/growthgenerator.test.js` are a
  different comparison: the same equipment catalog (Potion plus one Wand), toggling only that Wand's MAG or MDEF bonus from 0 to 9, which adds 25 bytes of
  equipment-stat code and one `eq_mag` / `eq_mdef` byte per item on top of the feature price (109 / 103 region bytes, 22 table bytes). MMC3 is
  40 bytes larger in absolute occupancy by the existing `BASE_BATTLE_CODE_BYTES_BY_MAPPER`, so no new `*_BY_MAPPER` term was needed.
- Streamed worlds: kernel-lo is untouched, so the equipment-conjunction margins in `docs/reference-kernel-budget.md` do not move because of profiles.

### 5.1 Gating by reference, not existence

`projectUsesMagicPower` and `projectUsesMagicDefence` are independent gates, each with its own party column, so **both** read growth through
`effectiveGrowth` (`partyGrowsStat` is the shared helper). A gate turns on because an assigned member actually grows the stat, never because a profile merely
exists: an unreferenced profile with `mag 9` moves no gate and no byte (T4). A referenced all-zero profile overrides retained positive raw MAG / MDEF, so
the retained numbers cannot keep a gate on; and actor and equipment sources still keep their own gate on with that zero profile assigned. Getting this wrong
is silent (a profile-only mage builds with the stat off), which is why the gate matrix is the largest test block.

## 6. Deletion (R2)

`growthProfileUsers(project, index)` lists the members referencing a profile. The Delete handler, when it is non-empty, shows an info dialog naming them
("Used by Rian, Iris. Set their Growth to Custom first.") and commits nothing. An unreferenced delete is one `store.commit`:
`renumberGrowthProfileDeletion(project, index)` (shifts every higher `profileId` down; **throws** before touching anything when a member still references
`index`, so a skipped refusal can never silently null a member), `project.growthProfiles.splice(index, 1)`, then `id = index` restamped over the profiles.
The helper reads no profile data, so either order against the splice is correct; the restamp must follow it, and the normalizer restamps on every load.
There is no bake: it would have promised level-1 and level-15 endpoints the member clamps cannot keep.

## 7. The diagnostic

`checkBattleTables` (`main/build/battletables.js`) emits `growth-profile-unused` (warning, `where: 'Character Forge'`, `subject: { profile }`) for a profile
no party member references. It is RPG-only like the rest of that function. There are no errors: normalization makes the data always buildable. The id is
registered in `test/unit/diagnosticids.test.js`.

## 8. The Character Forge UI

The Character Forge mounts for both game types (no new Forge, no `FORGES` edit); the growth-profile section and each member's Growth select appear in RPG projects only. `renderer/forges/character/character.js` gains:

- A collapsible **Growth profiles (n/8)** section above the member cards: a list with `+ Profile`, `Duplicate`, `Delete` and rename; for the selected profile
  six rows of base, "Avg / level to Lv 15" and a shape select (bounds from `GROWTH_LIMITS`, commits through `clampGrowthValue`); and a stats-by-level preview
  of the selected profile, evaluated by `profileStatAt` on the profile's own record. The selected member gets a second preview, evaluated by `memberStatAt`
  (so it follows the resolver, Custom included). Both are one `previewTable`, levels 1..`rpg.maxLevel`, with cells that hit the 255 cap highlighted, and both use
  the same curve code the generator runs, so a preview cannot disagree with the ROM. A table, not a canvas, which avoids the `fitZoom` sizing rule.
- A **Growth** select on each member card: `Custom` or a profile. While a profile is assigned the twelve growth inputs are locked, styled
  (`growth-locked`), show the profile's effective numbers and are labelled "Avg / level to Lv 15"; their title names the profile. The member's own
  numbers are kept and return on Custom.
- Every edit is one `store.commit` (so one undo entry). Re-rendering uses `fill()`.

### 8.1 What review forced (C3, four rounds)

A profile edit commits, the store notifies, and the whole Forge is rebuilt, so the naive version destroyed the live control. The final shape, each part
there because a real-Electron-input reproduction failed without it:

- **Focus survives a rebuild.** Keyed controls carry `data-focus`; `focusSnapshot` notes the focused one and its text caret, `restoreFocus` focuses the
  rebuilt equivalent. Repeated Arrow Up on a number or the profile list, and a name edit followed by Tab, all keep working.
- **The rebuild is deferred** (`deferred`, `refresh`) until the event that asked for it has finished: replacing a node inside its own `change` event, which
  a Tab fires before it moves focus, strands the Tab.
- **A rebuild waits while a pointer button is down** (`pointerHeld`, `refreshWaiting`, `pointerTimer`). Leaving the name field for a button commits the
  name at mouse-down; a rebuild then removed the button before mouse-up and the click was lost. Reverse Shift-Tab to the Delete button works too.
- **Disposal.** `destroy()` sets `disposed`, cancels both timers and removes the document listeners; the release timer, `refresh`, `render` and
  `stepPreview` all respect it, so a timer queued before a Forge switch neither rebuilds a detached subtree nor reads a closed or different project
  (a null `store.project` was a real `TypeError`).

Three follow-ups were named by review and left open: the Code Forge's 900 ms menu-undo wait, a smoke click-scheduling diagnostic, and pointer-release
platform coverage.

## 9. Deferred, and out

- **B, classes as authored data**: a class = a profile reference + a spell list, plus a per-item class mask for equipment (`null` = any class), with one
  `memberMayWear` predicate replacing three readers. Engine unchanged, but a class-deletion renumber helper, a Forge column and an unresolved policy for a
  class-less member. **Not built (R1).**
- **C, a runtime class change**: class-keyed tables, a new opcode (which shifts `EVENT_COMMANDS`' virtual tail), `pc_class` RAM, a save field with a second
  flash shift, and a policy for known spells and worn gear. Estimated tens of kernel-lo bytes, and two UNROM 512 streamed conjunctions already refuse by 20
  and 8 bytes with one equipment piece. **Not built (R1).**
- **XP speed per profile**: would key the two XP arrays by member (`2*(P-1)*(maxLevel-1)` extra bytes, 84 at four members and cap 15) and change
  `try_level_up`. **Out (R4).**
- **Monsters sharing profiles**: monsters collapse growth into stored `battle.*` by "Derive from level"; sharing would make that action pick from profiles.
  **Out (R4).**

The data model is forward-compatible: `profileId` stays the growth reference, B adds `classId -> {profileId, spells}`, and no field written here is wasted.

## 10. The guarding tests

- `test/unit/growthlimits.test.js` (D1): the table equals the literal pre-D1 normalizer ranges; `normalizePartyMember` clamps min-1 / max+1; an `acorn`
  source guard requires all twelve Character Forge growth inputs to take `min` / `max` from `GROWTH_LIMITS` with no numeric literal. `main/smoke.js` reads
  the real DOM `min` / `max`.
- `test/unit/growthprofiles.test.js` (C1, C3 fix): normalization and idempotence (T-N1), the curve literals, saturation, monotonicity and the cap-independent
  horizon (T-N2), the resolver (T-N3), deletion (T-R), range parity with members (T-L), the diagnostic (T-V), persistence (T-IO) and `clampGrowthValue`.
- `test/unit/growthgenerator.test.js` (C2): **the byte-identity pin** (T1 / T2: `battleTables` text and ROM / `config.inc` hashes for six fixtures, twelve
  profile-free RPG variants on three boards x Save x naming, and a streamed + Save UNROM 512 RPG, all literals captured from the pre-change tree), a linear
  profile equal to a member's own numbers builds the identical ROM (T3), the gate matrix (T4, T5, T-G i..ix), emitted non-linear rows (T6, T7, T8, T-N2b),
  headless level-up and Continue runs (T9, T10) and the no-allowance check (T11).
- `main/smoke.js`: a mixed DOM and real-input harness: creation and deletion use `.click()` and assignment and many edits dispatch synthetic `change` events, while real `insertText` / `sendInputEvent` covers the numeric and name editing, arrow and Tab navigation, the Duplicate click and the rail-switch regressions; checks the emitted HP row of a rounded profile before and after a
  disk round trip; sees the refusal naming the member.
- Re-pinned after audit, not changed in meaning: `test/unit/worldmarkers.test.js`, `test/unit/streamworldresident.test.js` and `test/unit/diagnosticids.test.js`.

## 11. Verification boundary

The contract is that a profile-free project builds a **byte-identical** ROM. That holds by source equivalence (a member with `profileId: null` resolves to its own
linear fields, so `levelTable` and the gates produce the same bytes); the captured regression matrix checks it on a finite set: six fixture builds, twelve
profile-free board / Save / naming variants, one streamed + Save UNROM 512 build, and two `battleTables` text hashes. Those pins do not by themselves prove it for
every possible project. No Mesen cross-check beyond the one
initialization check run in review on a profile variant, and no ring-gate matrix, was rebuilt for this item.

**Three `npm test` failures are known and accepted until an end-of-item evidence renewal:** `crossevidence`, `harnesstransfer` and `streamtilebound`. Their
`generatorHash` covers every file of `shared/` and `main/build/`, which D1-C3 edited, so the stored streamed-world bound evidence no longer matches a tree it
was captured on. This is the same exception encounter groups carried through its C1-C5. **It is owed a separate later renewal commit that follows this
one**, which writes its own dated section; this record does not renew it and does not edit `docs/design-streamed-worlds-phase3b.md`. Until then no current
streamed-world bound certificate is claimed for this tree.
