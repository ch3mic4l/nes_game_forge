# Design: the Character Forge (a scope change to the name-entry slice)

## §0. What I read

`shared/project.js`: `createPartyMember` (`:3781-3800`), `normalizePartyMember` (`:4831-4862`),
`RPG_LIMITS` (`:1111-1127`, `party: 4`, `nameLength: 10`), `createProject`'s own `party:` line
(`:3860`), `normalizeProject`'s own party-building block (`:5261-5265`), `normalizeLabel` (`:3976-3979`),
`renumberPartyMemberDeletion` (`:2593-2604`), `validateProject`'s party checks (`:5906-5941`),
`battleSpriteBudget` (`:3415-3426`). Grepped the whole tree (excluding `test/`, `docs/`,
`shared/starters/`) for every reader of `.party` and every `gameType === 'rpg'`/`!== 'rpg'` check — the
full list is §2's own evidence table, not asserted from memory.

`renderer/forges/sprite/battle.js` (`partyPanel`, the whole file, 206 lines) — today's editing surface
for name, metasprite, starts-in-party, all eight stat fields and learned spells, plus its own
Add/Remove handlers and the `renumberPartyMemberDeletion` call site. `renderer/forges/sprite/sprite.js`:
`renderPartyPane`/`renderTabs`/`render` (`:1175-1256`) — the RPG-only `party` tab's mount/dispatch.

`renderer/app.js`: `FORGES` (`:8-96`), `isForgeAvailable` (`:106`) — both re-read at HEAD, not from the
brief's own `~:10-99`/`~:106` citations, which were close but not exact.

`docs/design-name-entry.md` v15.1 (commit `d300601`) in full (5051 lines before this round's own edits)
— §7 (the packed Join operand, the X1 schema widening), §8 (the default-name mechanism,
`project.project.heroName`/`nameHeroAtStart`), §9 (the three admission predicates), §9a (the Say token's
own preview reader, `previewHeroName`), §13 (the planned Sprite Forge Player tab), §17 (phasing), §19
(open questions). A snapshot was taken to
`/tmp/claude-1000/-home-chris-nes-game-forge/cf966e55-203b-4c29-bbdf-42dc1accef5e/scratchpad/design-name-entry-v15-1-snapshot.md`
before editing that document to v16 alongside this one. **Confirmed directly, not assumed: no phase past
1 (the save migration, `af2bd07`) has landed in the working tree** — grepped for `nameHeroAtStart`, for
a `'named'` case in `normalizeEventCommand`, and for `heroName` anywhere outside the design doc itself;
none found. This is a green field, not a migration away from shipped code.

`docs/design-monster.md` and `docs/design-magic.md` in full, as the precedent for extracting a Sprite
Forge editing surface into its own Forge and for this document's own shape.

`engine/battle.asm` (`battle_entry`, `party_init`, `party_join`, `:1-91`) — what happens when a Join
names a member already in the party. `engine/battleturn.asm` (`cast_spell`, `roll_spell_amount`,
`spell_damage`, `:280-330`, `:690-733`) — confirmed no caster stat multiplies a spell's own
`amountMin`/`amountMax` roll.

`ROADMAP.md`, lines 1-25 (the intro's own "deliberately not on it" list) and the full numbered-item
index (`## 1.` through `## 16.`) — **the brief's own citation, "ROADMAP.md item 20," does not exist**:
there is no item 20; numbered items run 1-16, and "a full character generator" is a bullet in the
*intro*, at line 20 of the file, not a numbered item. Cited correctly below, §7.

`renderer/forges/monster/monster.js` (`:199-222`, the battle-tile sheet picker) and
`renderer/widgets/sheet.js` (`drawSheet`, `:35`) — **the brief's own claim that "the Monster Forge's own
preview code is the precedent" for a live metasprite preview does not hold up**: the Monster Forge
previews a *tileset region* (`drawSheet` over `tileset.background.tiles`), not an assembled metasprite.
**Corrected this round (round-3 review, P2 finding 4 — round-2's own fix to §4 was never propagated
back here, so this section kept repeating the claim §4 had already withdrawn).** The first pass here
grepped the whole renderer for a metasprite-compositing draw helper by *name*
(`drawMetasprite`/`renderMetasprite`/`previewMetasprite`) and, finding none, concluded none exists
outside the inline, unexported `renderMetaspritePane` (`sprite.js:305`) — the search was real, but the
names it searched for were guessed rather than confirmed, and the real functions are named differently:
`renderer/forges/sprite/sprite.js`'s own `paintMetasprite(data, width, metasprite, originX, originY)`
(`:117-139`) and `drawPreviewOnly(canvas, metasprite)` (`:710-720`) already are exactly this compositor
— real, existing, already-correct code with a genuine per-tile palette, not a name-search miss to be
filled with new code. §4 has the full citation and the extraction plan; this section is corrected to
match it rather than repeat the withdrawn claim.

`renderer/forges/tile/tile.js` (`:77-1030`, the Player mode/tab) and `renderer/app.js`'s `goTo`/
`consumeContext`/`pendingRequest` (`:178-189`), cross-checked against the Monster↔Sprite deep-link
precedent (`monster.js:233,273`, `sprite.js:57-70`). **Confirmed Tile Forge does not currently consume
any navigation context** — grepped `tile.js` for `consumeContext`: no match. A link to it needs a small
addition there; noted as a trap, §9.

`main/smoke.js` (`:480-501`, the generic `forgeIds`-driven "visit every Forge" step; `:6799-7002`, the
Sprite Forge party tab's own Remove-button coverage — the exact block that needs rewriting once the tab
moves). `main/project-io.js` (`:150-164`, `party.json`'s own always-written contract).
`CLAUDE.md`'s own "A fourth sibling, `renumberPartyMemberDeletion`..." passage (`:755-759`).

## §1. Inventory — every field that moves, and where it is read today

| Field (on `project.party[N]`) | Normalizer | Compiled to (RPG only, gated on `gameType`/`BATTLE_ENABLED`) | Edited today at |
|---|---|---|---|
| `name` | `normalizeLabel` (free text, 40 chars) → **becomes `normalizeCharacterName`, §5** | `pc_name` (`battletables.js`) | `battle.js:65-71` |
| `metaspriteId` | clamp 0-255 or `null` | `pc_metasprite` (`battletables.js:253`) | `battle.js:74-86` |
| `startsInParty` | `id === 0 ? true : Boolean(...)` | `pc_starts` (`party_init`, `engine/battle.asm`) | `battle.js:87-96` |
| `baseHp`/`hpPerLevel`, `baseMp`/`mpPerLevel`, `baseAtk`/`atkPerLevel`, `baseDef`/`defPerLevel`, `speed`, `acc`, `eva` | `clamp` (per-field ranges) | per-level stat tables (`battletables.js`) | `battle.js:121-136` |
| `spells` (`{spellId, level}[]`) | filtered/clamped, max `RPG_LIMITS.spells` | `pc_spells` bitmask | `battle.js:141-183` |
| **`renamable`** (new, this round) | `Boolean(raw?.renamable)` | the Join operand's bit 7 for members 1-3 (compile-time, `encodeCommand`); `HERO_NAMING_ENABLED` for member 0 | **nowhere yet — this Forge** |

Everything in the first six rows is a lossless move: the field, its normalizer and its compiled
destination are all unchanged, only the editing surface moves from `renderer/forges/sprite/battle.js`'s
`partyPanel` to the new Character Forge. `renamable` is the one genuinely new field, replacing two
fields `docs/design-name-entry.md` v15.1 had planned to add elsewhere (`project.project.nameHeroAtStart`
for the hero, a `join` command's own `named` arg for everyone else) — neither of which ever shipped
(§0), so this is a design choice between three unbuilt options, not a migration away from a built one.

**`project.project.maxHearts` is not part of this move.** It has no UI anywhere in the renderer today
(grepped — no match), is action-side HUD state unrelated to any character's own stats, and Chris's own
request does not name it. Out of scope here; flagged only because Q4 needs to say plainly it is not
touched, since a stat panel next to a health-related field invites the assumption that it is.

## §2. Q1 — one character model for both game types, or two?

**Recommendation: one. `project.party` becomes the character list for both game types. Member 0 is
always the hero/player character. An action project is normalized to exactly one member; the Add button
is disabled there, with a stated reason.**

**The alternative costed: keep `project.project.heroName`/`nameHeroAtStart` (v15.1's own plan, never
built) for an action project, and have the Character Forge merely *present* those two fields as a
one-row list rather than reading `project.party`.** This was the brief's own fallback to weigh, and it
loses on every count once the actual request is read closely: Chris asked for **stats** on every
character, hero included ("HP, MP, attack power, magic power"), a **sprite in the middle**, and one
**Add/Delete list**. `project.project.heroName` is a bare string — it has no `baseHp`, no
`metaspriteId`, nothing a stat block or a sprite preview could read for an action hero at all. Making
the alternative work would mean *also* inventing an action-only parallel stat record beside
`heroName`/`nameHeroAtStart` — two storage shapes for what the Forge presents as one row — which is
worse than the one-model answer on every axis: more schema surface, not less, and it reproduces exactly
the failure `docs/design-name-entry.md` v15.1's own P2-7 finding already hit once (a preview reading
`project.project.heroName` while the compiler read `party[0].name`, silently disagreeing) as a
*permanent* two-shape split rather than a bug fixed once. CLAUDE.md's own convention — "a field
meaningful on both game types belongs beside `titleMap`/`gameType`/`saveCompatToken` in
`project.project`" — was written for a single scalar fact like `nameHeroAtStart`; it was never written
to cover a full character record, and stretching it to cover one is the wrong generalization.

**Corrected again this round (round-3 review, P1 finding 2 — round-2's own fix was still incomplete).**
Round 2 excluded `shared/starters/` and `test/` and made a false "eleven sites, all gated" claim; that
was fixed, but the fixed version still omitted `main/smoke.js` and `tools/` entirely, and its own
`battletables.js` verdict ("every entry point returns before reading party unless `gameType ===
'rpg'`") was itself wrong for one real function. **Re-run for real this time, with the exact count
per directory stated up front so the completeness claim is checkable against a number, not against
the word "every":**

```
$ grep -rln '\.party\b' --include=*.js main/ | xargs grep -c '\.party\b' | awk -F: '{s+=$2} END{print s}'
main/: 18
renderer/: 13
shared/: 30
test/: 93
tools/: 2
```

(156 total. Each count re-derived directly from `grep -rn '\.party\b' --include=*.js <dir>/`, not
carried over from a prior round's own tally.)

**`main/`, `renderer/`, `shared/` (including `shared/starters/`), `tools/` — every hit, individually
verdicted:**

| Site | Reads | Verdict |
|---|---|---|
| `shared/save.js:118-131` | `RPG_LIMITS.party`-sized RAM arrays (`pc_hp`, `pc_name_ram`, …) | gated — sized by the **constant**, not `party.length`, on every board already. |
| `shared/save.js:229-230,264` `saveIdentity` | `(project?.party ?? []).length` folded into the save hash | **changes, deliberately** — an action project's `partyCount` term goes 0→1 the moment this migration runs; `saveIdentity`'s own existing mechanism (not a new `SAVE_LAYOUT_VERSION` bump) is exactly what exists for a shape change like this, below. |
| `shared/project.js:2553` `renumberSpellDeletion` | `for (const member of project.party ?? [])`, walking each member's own `spells` array | **ungated, but safe because**: the function is correct for whatever `spells` array it finds, regardless of game type — it filters/shifts spell-id references, nothing more. An action member's `spells` is always `[]` in practice (no UI ever adds to it — Magic Forge is RPG-gated), but the function does not depend on that; it would still be correct against a non-empty one. |
| `shared/project.js:3127` `renumberMetaspriteDeletion` | `for (const member of project.party ?? [])`, fixing up each member's own `metaspriteId` | **ungated, but safe because**: `fixedPoint(member.metaspriteId, null, false)` already tolerates `null` (an action member's own default) and is correct for a real index too — nothing here assumes RPG. |
| `main/build/battletables.js` — `checkBattleTables` (`:362`, its own internal `gameType !== 'rpg'` return) | `project.party` | gated by its own body. |
| `main/build/battletables.js:112-115` **`battleTables` itself** | `const party = project.party ?? []` (`:115`), no internal game-type check at all | **corrected this round (round-4 review, P1 finding a): the prior pass named only one production caller and missed a second, real one.** Full caller graph, traced to its root rather than to the first caller found:<br>• `main/build/generate.js:2432` calls `battleTables` directly — `codeSlots.length ? battleTables(project) : '...not an RPG...'`, `codeSlots` empty for any action project. Gated.<br>• `main/build/battletables.js:585` (`battleTableBytes`) also calls `battleTables` directly, with **no gate of its own** — `battleTableBytes` is itself the capacity path, called from: `battleRegionBytes` (`:806`, also no internal gate); `battleShortfallAdvice` (`:868,901`, also no internal gate). Tracing *those* callers: `battleRegionBytes` is called from `battleShortfallAdvice` itself (`:915-916`, the board-fit search), from `switchableMappers`'s own filter (`generate.js:1340`, gated `checkBattleRegion && bankedCode &&`), from the Build panel's own meter (`renderer/forges/build/build.js:621`, gated `isRpg ? meter(...) : null` — **the Build panel mounts on both game types, but this specific expression is never evaluated on an action project**, since `battleRegionBytes(project, mapper)` sits inside the `isRpg ?` branch of a ternary, not evaluated unless `isRpg` is true), and from `main/smoke.js` (3 hits, `:9652,9657,9666,9671`, all against `pristine`/`meter.overProject`, both traced to `sample-rpg`-derived fixtures). `battleShortfallAdvice`'s own single production call site is `generate.js:2069`, itself inside a block gated `if (bankedCode && !battleRegionPlacementOverridden(project))` (`:2030`) — `bankedCode` is `codeRegionCount(project)`, RPG-only.<br>**Every path traced to its root is gated, and none reaches an action project in production** — the gate is `bankedCode`/`codeRegionCount(project)` (RPG-only) or `isRpg`, applied at whichever call site is the first one a real build or the Build panel actually reaches, never inside `battleTables`/`battleTableBytes`/`battleRegionBytes`/`battleShortfallAdvice` themselves. Grepped `test/` for every *direct* call to `battleTables` or `battleTableBytes`, bypassing all of the above: `test/unit/bankedbytes.test.js:191,248,254,283`; `test/unit/save.test.js:862`; `test/unit/project.test.js:3602,3616,3785` (via `battleTables`) and `test/unit/bankedbytes.test.js:283` (via `battleTableBytes`, already counted). Every one of those call sites is checked to pass an RPG-typed `project` (their own surrounding fixtures are RPG-only throughout), so none is a live bug today — but the safety property this whole chain has is "every *caller*, all the way to the root, not any function's own body," and a future direct call to any of `battleTables`/`battleTableBytes`/`battleRegionBytes`/`battleShortfallAdvice` against an action project would read that project's own one-member party and emit meaningless RPG stat rows or capacity advice rather than throwing — harmless in the sense that it reads real, present data (an action member's own `baseHp` etc. are ordinary numbers, not `undefined`), not in the sense that the output would mean anything. |
| `shared/project.js:3415-3426` `battleSpriteBudget` | `project.party` | gated — `gameType !== 'rpg' → return {used: 0, ...}` at `:3416`, before the party reduce. |
| `shared/project.js:5906-5941` `validateProject` | `project.party.length` inside `if (gameType === 'rpg')` | gated — the whole block is gated; an action project never reaches it. (The error string itself says `'Sprite Forge'` — §7's own exhaustive string table, finding 11, is where this is actually fixed.) |
| `renderer/forges/map/map.js:909` | `gameType === 'rpg' ? party ?? [] : []` | gated — an explicit game-type gate on the *context object handed to the event editor*, unrelated to `project.party`'s own length; stays `[]` for action regardless, correctly, because Join is RPG-only (§3). |
| `renderer/forges/map/events.js:185,1247,1528` | `context.party` | gated — reads the gated context above, never `project.party` directly. |
| `renderer/forges/map/templates.js:73-74` | `project.party` | gated — `gameType !== 'rpg' → return -1` at `:73`, before the party slice. |
| `main/project-io.js:162` | `project.party` (write) | safe — already writes unconditionally, empty array included, for every project; now writes a 1-element array for action. No presence/absence migration semantic depends on this file the way `items.json`'s own comment (`:150-154`) describes for items. |
| `renderer/forges/sprite/battle.js` (whole file) | `project.party` throughout | **removed by this design**, not merely gated — the file is deleted, its logic moved to the Character Forge (§7). Not a "safe as-is" site; listed for completeness. |
| `renderer/forges/sprite/sprite.js:1199` | `store.project.project.gameType === 'rpg' ? [['party', 'Party']] : []` (the `party` tab's own conditional existence) | **removed by this design** — the tab itself goes away (§7), so this line is deleted, not merely re-verified safe. |
| `shared/starters/rpg.js:204-205` | `project.party[0] = {...}`, `project.party.push({...createPartyMember(1, 'Ally'), ...})` | safe — this starter only ever runs for a freshly created RPG project (`gameType: 'rpg'` throughout its own module); D9 does not change what an RPG's own `party` array looks like at all. |
| `main/build/battletables.js:883-885` | `(project.party ?? []).length - 1`, the shortfall-advice lever | gated — reached only from `battleShortfallAdvice`, itself only ever called for an RPG project (`main/build/generate.js`'s own RPG-gated call site, unchanged by this design). |
| **`main/smoke.js`, all 11 hits** (`:6495,6579,6638,6639,6809,6811,6812,6813,6814,6857,6991`) | `draft.party[0].metaspriteId`, `rpgStore.project.party[0]`/`.spells`, `project.party = [...]`, `project.party.map(...)` | **test driver, RPG fixture only — verified individually, not assumed.** `:6495` operates on `window.__app.store` right after `sampleRpg` is opened (`:6421`) into it; `:6579` onward runs inside `rpgStore.commit(...)` callbacks throughout. No hit here ever touches an action project's own party. |
| **`tools/`, both hits** (`make-rpg-sample.js:280`, `make-rpg-save-sample.js:283`) | `project.party = [...]` | safe — both files are RPG-only fixture generators by construction (their own filenames and `gameType: 'rpg'` throughout); D9 changes nothing about what an RPG fixture's own `party` array looks like. |

**`gameType === 'rpg'`/`!== 'rpg'` checks that never read `.party` at all — not part of this migration's
blast radius, listed because the instruction was to re-grep without exclusions, not to pre-filter by
relevance:** `shared/font.js:327,439,482` (`projectUsesText`/`projectUsesCombat`/`projectUsesHeartArt`
— text/heart-art reservation, no party involvement); `shared/cartridge.js:392` (`defaultMapperFor` —
picks a starting mapper at project creation, no party involvement); `shared/project.js:730,1257,2865,
5427,6606,6730` (monster-contact/`rpgCapable`/font-split/banked-code/palette-reservation predicates,
none reading `party`); `main/build/generate.js:191,1240` (`codeRegionCount`/`isRpg`); `renderer/forges/
items/items.js:34` (an item's damage-effect gate); `renderer/forges/map/map.js:2133`
(`battleSettings(map)`); `renderer/forges/build/build.js:463,641-643` (`isRpg`, and `battleSpriteBudget`
called only when `isRpg` — gated at the call site *in addition to* the function's own internal gate);
`renderer/forges/sprite/sprite.js:1092` (a Monster Forge cross-link's own visibility, unrelated to
party). Every one of these reads `gameType` and nothing about `project.party`, so D9's change to
`party.length` on an action project cannot affect any of them, by construction — verified individually,
not assumed from the pattern.

**`test/`, 93 hits across eight files, broken down per file rather than summarized — the completeness
claim the round-2 pass made ("roughly ninety... checked") without ever stating a real per-file count:**

| File | Hits | Verdict |
|---|---|---|
| `test/unit/project.test.js` | 50 | `:226`'s own `assert.deepEqual(action.party, [])` is the one assertion in this entire file — and across all of `test/` — that actually breaks (§8 has the fix and the new tests it needs). Every other hit either targets an RPG-created project or a `party` array the test body builds by hand, checked individually against `createProject(` call sites in the file (Round 2's own audit; re-confirmed this round). |
| `test/unit/drawvalidation.test.js` | 11 | Safe — re-verified this round line by line. `:574-578`'s own `project.party = [...]` follows a `createProject('Party matrix', 'rpg')` a few lines above; `:605`'s own `rpgProject.party.length` is checked *after* `project.project.gameType = 'rpg'; const rpgProject = normalizeProject(project)` (`:602-604`) explicitly re-types an action project as RPG for that one test — the assertion is about the RPG *result*, not the action project it started from; `:1443-1459` fills `project.party` to `RPG_LIMITS.party` on an RPG-created project. The file's own `battleSpriteBudget`-on-an-action-project tests (`:580-585`) never touch `.party` at all, consistent with `battleSpriteBudget`'s own internal gate above. |
| `test/unit/starters.test.js` | 9 | Safe — every hit is on a `project`/`recruit`/`ally` variable built from an RPG starter (`shared/starters/rpg.js`); no action-starter variable in this file is ever read through `.party`. |
| `test/unit/save.test.js` | 7 | Safe — **corrected this round (round-4 review, P1 finding b): `pc_hp`/`pc_name_ram` are not action-absent.** `shared/save.js:118,131` list them in `SAVE_FIELDS` **unconditionally**, every game type, the identical "reserved but inert" pattern `player_hp` already has in the other direction (`:107`, "action-mode hearts; unused but harmless in an RPG") — phase 1 shipped it that way deliberately (`:127-130`'s own comment). The real reason this file is unaffected: `SAVE_FIELDS`'s own layout and total size are a fixed list of RAM-address/size pairs, computed from constants (`RPG_LIMITS.party`, `RPG_LIMITS.nameLength`), never from a *specific project's* `party.length` — D9 changes what an action project's `party` array holds, not the save record's own fixed shape, so nothing here could be affected by it regardless of which project the file's own fixtures happen to use. This file's own `.party` hits are, separately, all on RPG-created fixtures in fact (`:1051`'s own comment, "this fixture needs sample-rpg's own 2-member party", confirms the scope directly) — but that is a fact about *this file's own test data*, not a reason grounded in what does or doesn't exist on an action build's save record. |
| `test/unit/rpg.test.js` | 7 | Safe — the whole file is RPG-only by its own name and its own `boot`/`bootPastNaming` helpers, which only ever load `sample-rpg`. |
| `test/unit/templates.test.js` | 6 | Safe — re-verified: `:154-218` builds and mutates `.party` on a `createProject('Templates', 'rpg')`/`createProject('Quest', 'rpg')` variable throughout; the file's own separate `action = createProject('Action')` variable (`:191`) is never read through `.party` anywhere. |
| `test/unit/bankedbytes.test.js` | 2 | Safe — both hits are inside `battleTables(project)`'s own call sites, on RPG-typed fixtures throughout this file (the banked-region ledger this file tests exists only for an RPG). |
| `test/unit/font.test.js` | 1 | Safe — `:225`'s own `project.party.push(...)` follows `createProject('Empty', 'rpg')` at `:224` directly. |

Total: 93, matching the directory count above. `test/` is still not part of the *source* blast radius
(§8's own phase-2 step is where the one real fix — `project.test.js:226` — and the three new tests it
needs are specified), but every hit is now individually accounted for rather than estimated.

**Every real `.party` reader is gated, safe by construction, or (three real cases, not a summarized
count) something else entirely**: `saveIdentity` (changes on purpose, its own existing mechanism
absorbs it); the Sprite Forge's own party UI (removed outright by this design, not merely re-verified);
and `battleTables` (safe today because every real and test caller happens to pass an RPG project, but
gated by convention at each call site rather than by the function's own body — the one site in this
whole sweep where "safe" and "gated" are not the same claim). `partyCount` (`shared/save.js:229`) is one of the values folded into the save-compatibility
hash; an action project's own value moves from 0 to 1 the instant this migration runs. This is not a new
problem needing a new mechanism — it is exactly what `saveIdentity`'s own hash exists to catch, the same
way it already catches a project gaining an item catalog or a screen (CLAUDE.md's own "the identity only
makes a collision... unlikely" passage). **No `SAVE_LAYOUT_VERSION` bump is needed or wanted for this**:
a version bump invalidates *every* save from every project unconditionally the instant it ships
(CLAUDE.md), which would be wrong here — this is a per-project, content-shaped change (`saveIdentity`
already computes a different hash for a differently-shaped project), not an engine-wide layout change.
The practical consequence: any save made against a ROM built *before* this migration ships, for an
action project, stops loading the moment a ROM built *after* it ships is played against it — the
identical, intended behavior `saveIdentity` already produces for any other structural change, and (§0)
there is no shipped release depending on save
continuity across this specific change yet.

**What `normalizeProject` does to an existing action project on load**, the concrete migration: today,
`normalizeProject`'s own party-building block (`:5261-5265`) is —

```js
const party = (Array.isArray(raw.party) ? raw.party : [])
  .slice(0, RPG_LIMITS.party)
  .map((member, index) => normalizePartyMember(member, index, spells.length, rpg.maxLevel));
if (project.gameType === 'rpg' && !party.length) party.push(createPartyMember(0, 'Hero'));
```

It becomes, unifying both game types under one cap and one "ensure at least one" line rather than a
second RPG-only special case:

```js
// shared/project.js, normalizeProject's own party-building block, corrected
const characterCap = project.gameType === 'rpg' ? RPG_LIMITS.party : 1;
const party = (Array.isArray(raw.party) ? raw.party : [])
  .slice(0, characterCap)
  .map((member, index) => normalizePartyMember(member, index, spells.length, rpg.maxLevel));
if (!party.length) party.push(createPartyMember(0, 'Hero'));
```

An action project that has never had a `party` field (every one saved before this ships) normalizes
`raw.party` to `[]`, then the last line pushes `createPartyMember(0, 'Hero')` — a member named `"Hero"`,
via the explicit second argument here — with every stat at `createPartyMember`'s own default
(`baseHp: 24`, etc.) and `renamable: false`. (`docs/design-name-entry.md` v16.2 §8, finding 8, fixes
`createPartyMember`'s own single-argument default too — `DEFAULT_MEMBER_NAME(0)` is also `"Hero"` now —
so this explicit call and `normalizePartyMember`'s own internal fallback path, previously a real
`"Hero"` vs. `"Member 1"` discrepancy, now agree; the explicit call here is kept for clarity at this
call site, not because the two paths would otherwise disagree any longer.) **This is a one-time
normalization, run every load,
never re-derived per build** — the same "normalize on load, trust the stored value thereafter" contract
every other migrated field in this schema already holds to (`saveCompatToken`, `heroName` itself as
v15.1 specified it). An action project that has *already* somehow acquired a `party` array longer than
1 (impossible through today's UI, but not impossible via hand-editing or a future-version file) is
silently truncated to its first member by `.slice(0, characterCap)` — the identical truncate-not-refuse
policy `RPG_LIMITS.party` already applies to an over-long RPG party, not a new one invented for this
case.

`createProject`'s own line (`:3860`) drops its ternary the same way:

```js
// shared/project.js, createProject -- was: party: rpg ? [createPartyMember(0, 'Hero')] : [],
party: [createPartyMember(0, 'Hero')],
```

## §3. Q2 — `renamable` replaces `nameHeroAtStart` and the Join command's `named` field

**Recommendation, as costed against the engine: `project.party[N].renamable` is the one flag for both
cases. The engine and the §7 packed operand stay exactly as `docs/design-name-entry.md` v15.1 designed
them — the compiler derives the operand's named bit from whether the target member is a real naming
candidate (`joinNamingCandidate`, `docs/design-name-entry.md` §9 — not `renamable` read bare, since a
member can be `renamable` and still never reachable by a Join, below), so the phase-3 engine core
(v16's own renumbering, see that document's §17) does not change at all.** Full mechanism, the predicate rewrites, and the withdrawal of v15.1's own schema-widening (X1) —
`join.args` never gains a second entry, `EXCEPTIONAL_WIDTHS` never gains a `join: 2` case, because there
is no more authored per-placement field to widen for — are in `docs/design-name-entry.md` v16 §7 and
§9, not repeated here; that document owns the engine-facing half of this decision. What belongs here is
the two questions specific to *this* Forge's own design: what `party_join` does on a second Join, and
what the Map Forge shows.

**Checked against `engine/battle.asm` directly, not assumed: a Join naming a member already in the
party is a no-op today.** `party_join` (`:79-91`) —

```
party_join:
  lda pc_in_party,x
  bne party_join_done      ; already recruited -- do nothing at all
  ...
party_join_done:
  rts
```

— so a member's *first* successful Join is the only one that ever runs `party_apply_level` or (in the
phase-3 engine, `docs/design-name-entry.md` §7) opens the naming grid; `script_op_join`'s own design
(that document's §7) checks the identical `pc_in_party,x` flag *before* it ever reads the named bit, so
a second Join targeting an already-recruited member never reaches the grid regardless of what bit the
compiler set for it. **A renamable member who both `startsInParty` and is later targeted by a Join is
therefore unremarkable: `party_init` already ran `party_join` for them at boot (`pc_starts,x` true),
`pc_in_party` is already set, and the later Join is a no-op** — this is member 0's own case whenever
`startsInParty` is true (always, for id 0, per `createPartyMember`'s own `id === 0` rule), so "is a Join
on member 0 a no-op today?" is answered directly: yes, by the same guard, with nothing special added for
it.

**Corrected this round (finding 1, round-2 review): the claim that per-placement authoring of the named
bit "never mattered in practice" was wrong, and is withdrawn — not softened, withdrawn.** `party_join`'s
own guard is keyed on `pc_in_party` alone, with no memory of *which* placement's own bit accompanied a
successful recruitment. Two different Join commands, at two different map placements, both targeting
the same not-yet-recruited member — one authored `named: true`, the other `named: false` — is a real,
legal v15.1 project, and under it the grid's own appearance was genuinely route-dependent: whichever
placement the player reached *first* decided whether the naming session opened, and the other
placement's own bit was simply never read. That is real, observable, in-game behavior, not an
unobservable one — two players taking different paths through the same map could see different naming
sessions for the same recruit, with no way for either to know why. **`renamable` (per-character, not
per-placement) is a deliberate reduction in authoring freedom, not a discovery that the freedom was
already inert.** v16 gives this capability up because Chris's own request (`docs/design-character-forge.
md`'s own §"What Chris asked for") specifies one checkbox per character, not one per placement, and
because a route-dependent naming session is not a feature anyone asked for — a single per-character
flag cannot disagree with itself across placements the way two authored bits could, which is a genuine
improvement, but the mechanism it replaces was not nothing. (One narrower, still-true fact survives
from the earlier reasoning: since there is no "leave the party" command anywhere in `EVENT_COMMANDS`, a
member can only ever be *successfully* Joined once in a given playthrough, so a *third* or later Join
attempt on an already-recruited member is always inert — this is about a second attempt on the same
member, not about the first-recruitment race above, and does not rescue the "unobservable" claim.)

**The Map Forge's own join row shows the member's `renamable` state as read-only text, not a second
checkbox** — `docs/design-name-entry.md` v16 §13 has the real code. This Forge's own contribution is the
one control that actually sets the flag: a checkbox on each character's own card, styled after
`partyPanel`'s existing "Starts in the party" row (`battle.js:87-95`, cited as the pattern rather than
invented fresh, same as that document already does).

**Corrected this round (finding 10, round-2 review): the checkbox is not always meaningful, and must be
disabled for the one real inert case.** A member with index > 0 whose `startsInParty` is `true` is
recruited by `party_init` at boot (`engine/battle.asm:69-71`, `pc_starts,x` true → `jsr party_join`
unconditionally, before any field event can run), so `pc_in_party` is already set by the time any Join
targeting them could ever fire — their own later Join, `named` bit or no, is an unconditional no-op at
`:80` (the identical guard the paragraph above already established for member 0). Toggling `renamable`
on such a member changes nothing a real build reads: `projectUsesJoinNaming` (`docs/design-name-entry.
md` v16 §9, `joinNamingCandidate`) does not even count it as a naming candidate, by the same
`!member?.startsInParty` term. **The checkbox is disabled for exactly this combination — index > 0 and
`startsInParty` true — with the stated reason "Starts in the party, so is never recruited by a Join;
only the hero is named at new game."** Toggling `startsInParty` off re-enables it immediately (the two
controls live on the same card, so this is a live, same-render state change, not a reload). The
alternative — naming every renamable starting member in sequence at new game, the way the hero already
is — is a real, coherent idea Chris did not ask for and this document does not build; noted as future
scope in `docs/design-name-entry.md` v16 §18, not decided here.

## §4. Q3 — which sprite is "in the middle"

**RPG: the existing `metaspriteId` picker (`project.sprites.metasprites`), with a live preview — real,
existing code to extract, not new code to write.** Corrected from the brief's own citation (§0), and
corrected again this round (round-2 review, finding 4) after that first correction itself cited the
wrong shape: the Monster Forge does not preview an assembled metasprite (it previews a tileset region
through `drawSheet`, `renderer/widgets/sheet.js:35` — the *background/sprite tile sheet* primitive, not
a compositor), but `renderer/forges/sprite/sprite.js` already has exactly the standalone compositor
this Forge needs, verified directly against the source rather than assumed a second time:
`paintMetasprite(data, width, metasprite, originX, originY)` (`:117-139`) walks `metasprite.tiles`
reading each entry's `hflip`/`vflip`/`palette`/`x`/`y` (**a real per-tile palette index, `entry.palette`,
`:122`** — not the flat `{tile, dx, dy, flipH, flipV}` shape a prior pass of this document invented),
and `drawPreviewOnly(canvas, metasprite)` (`:710-720`) already calls it standalone, at a fixed `VIEW`×
`VIEW` canvas and `ORIGIN` offset (`:711-718`, both module-level constants, `:36-37`), with no editing
state attached — precisely "draw one metasprite, nothing else," the exact shape a character card's own
preview needs. **The real work is extraction, not invention**: `paintMetasprite` closes over `decoded`
(the current tileset's own decoded sprite tiles, `sprite.js:107-112`) and `palettes()` (`store.project.
palettes.sprite`, `:76`) rather than taking either as a parameter, so moving it to a shared module means
widening its own signature to `paintMetasprite(data, width, metasprite, originX, originY, decodedTiles,
spritePalettes)` and updating `sprite.js`'s own two call sites to pass its existing closures explicitly
— a behavior-preserving signature change, not a rewrite of the drawing logic itself. `renderer/widgets/`
is this codebase's own precedent for shared renderer drawing code (`sheet.js`'s own `drawSheet`, already
used by both the Sprite Forge and the Monster Forge) and is where this extraction belongs — `renderer/
widgets/metasprite.js`, exporting `paintMetasprite` (and, for convenience, a `drawMetaspritePreview
(canvas, metasprite, decodedTiles, spritePalettes)` wrapper matching `drawPreviewOnly`'s own shape,
since both this Forge's card and the Sprite Forge's own editor want a canvas-in, nothing-out call).

**Action: the hero has no metasprite at all — the engine draws the player from
`project.sprites.playerTiles` (`PLAYER_TILES`, `shared/project.js`), a fixed 32-slot sprite-table region,
never a `metaspriteId`.** A metasprite picker on the action hero's card would be a control the engine
never reads (CLAUDE.md's own "label it as such... rather than letting it look functional" rule would be
violated by offering one at all). **Recommendation: a read-only preview of the player figure — the same
Player-mode canvases the Tile Forge already draws (`renderer/forges/tile/tile.js:926-1030`) — with a
link to that view, not a duplicate editor.** `app.goTo('tile', { mode: 'player' })` is the mechanism,
modeled on the Monster↔Sprite precedent (`monster.js:233,273`, `sprite.js:57-70`) exactly, **with one
real gap this design has to close, not gloss over: `tile.js` does not currently call
`app.consumeContext()` at all** (grepped, §0) — a link to it today would silently drop the navigation
context and land on whatever tab/mode the Tile Forge was last in, not the Player view. Phase 2 (§8) adds
a `consumeContext` call to `tile.js`'s own `mount()`, four lines in the identical shape `sprite.js:62-70`
already has, checking `context?.mode === 'player'` and setting `state.mode = 'player'` before the first
render.

**On an RPG, member 0's field art (`playerTiles`) and battle art (`metaspriteId`) are two different,
independently-drawn things, and the hero's own card shows both.** Recommendation, not the alternative of
showing only the battle metasprite: an RPG's own field figure is exactly as real and exactly as
frequently seen as an action hero's is (the player walks the field in both game types identically,
`update_player`/`redraw_screen` making no game-type distinction at all) — hiding it from the one card
that is *about* the player character would be a real omission an author would have to go find the Tile
Forge to notice. The card therefore always shows the read-only field-figure preview (with the Tile
Forge link) plus, for an RPG only, the metasprite picker and its own live preview beneath it, labeled
distinctly ("Field sprite" / "Battle sprite") so the two are never mistaken for one control.

## §5. Q4 — stats, exactly the compiled block, no more

**Exactly what exists and compiles today, moved losslessly from `partyPanel` (§1's inventory table):**
HP, MP, attack, defence (each base plus per-level growth), speed, accuracy, evasion, and learned spells
with the level learned. **No new stat is added.**

**Chris's own request named "magic power." No such stat exists anywhere in the compiled battle math —
checked directly against `engine/battleturn.asm`, not inferred from the schema alone.**
`roll_spell_amount`/`spell_damage` (`:690-733`) roll a spell's own damage strictly from that spell's own
`amountMin`/`amountMax`/`amountN`/`amountLimit` (`main/build/battletables.js`'s own `spell_amount_*`
tables) — no caster stat (`pc_atk_at`, `pc_def_at`, or any other) is read anywhere in that path.
`pc_atk_at`/`pc_def_at` (`:645,668`) are read only by the *physical* attack path, unrelated to spell
damage. **This Forge does not add a `magicPower` field, and does not imply the engine has one it
doesn't.** What a real one would need, in one paragraph, so Chris can decide later rather than this
being silently dropped: a new per-member stat (`baseMagic`/`magicPerLevel`, the identical shape
`baseAtk`/`atkPerLevel` already has), a new multiplier term in `roll_spell_amount` or `spell_damage`
reading it (`engine/battleturn.asm`, real 6502 changes — a multiply-by-stat the 6502 cannot do natively,
so it would need a table the same way `battletables.js` already precomputes per-level stats, per
CLAUDE.md's own "Anything the engine would need a multiply for is a table instead"), and a banked-region
capacity re-measurement (`main/build/battletables.js`'s own `BASE_BATTLE_CODE_BYTES_BY_MAPPER`,
CLAUDE.md's "The battle system"). Out of scope here — a real engine change, not a Forge layout question.

**On an action project, no stat compiles anywhere.** Recommendation: hide the whole stat block behind
one line — `"Stats are used by the turn-based battle system only."` — rather than showing eight
disabled fields, the same "don't show a control that does nothing" discipline §4 already applies to the
metasprite picker, and consistent with how this codebase already handles an inert `project.rpg` on an
action project (dormant, never surfaced as disabled UI).

**`project.project.maxHearts`** — action mode's own HUD heart count — **stays exactly where it is edited
today: nowhere.** It has no UI anywhere in the renderer (§1); this Forge does not add one for it. It is
a project-level HUD fact, not a per-character stat (an action project's single character has no `baseHp`
that compiles to anything — `player_hp` is driven by `maxHearts` alone, through `combat.asm`, never by a
party record), so it does not belong on a character card even once one exists to put it on.

## §6. Q5 — layout, the name field's alphabet, and the migration for an existing name

**Layout, from Chris's own words, verified against nothing further needed to add — the request is
explicit enough to build directly:** a left column holding the character list plus Add/Delete; the
selected character's sprite centred in the stage; the stat fields arranged around it (RPG) or hidden
behind the one-line hint (action, §5); the default-name field; the renamable checkbox. This mirrors the
Monster Forge's own list-plus-detail shape (`docs/design-monster.md`), which is why that document is
this one's own structural precedent, not merely a stylistic one.

**The name field's alphabet is `docs/design-name-entry.md`'s own — A-Z/a-z only, max
`RPG_LIMITS.nameLength` (10) — and it now applies to every character, not just the hero, because every
character's name is a possible `pc_name_ram` seed the moment `renamable` can be true for them (§3).**
That document's own §8 is the single definition of `normalizeCharacterName(value, fallback)` — cited
here, not restated, so the two documents cannot describe two different function bodies: it replaces
`normalizeHeroName` (v15.1's `heroName`-only version) and is called from `normalizePartyMember` in
place of `normalizeLabel` for the `name` field alone — every other field `normalizeLabel` still serves
(item names, spell names, and so on) is untouched.

**What `normalizeLabel` allows today, checked directly (`:3976-3979`): free text, trimmed, sliced to 40
characters — no alphabet restriction and no 10-character clamp, even though `battle.js`'s own input
already has `maxlength: NAME_LIMIT` (10, `:68`) at the UI layer alone.** This is a real, pre-existing gap
between what the UI lets an author type and what the schema would accept from a hand-edited or
format-drifted file — `sample-rpg/party.json`'s own two names ("Rian", "Iris") are already
alphabetic and well under 10 characters, so the fixtures are unaffected, but a hand-edited project with,
say, a 15-character name or one containing a digit would today normalize to a truncated-but-otherwise-
untouched 40-character string, and after this change normalizes to the alphabetic prefix of that string,
truncated to 10, or — if nothing alphabetic survives the filter — to `DEFAULT_MEMBER_NAME(id)`
(`docs/design-name-entry.md` v16.2 §8, finding 8: `"Hero"` for member 0, `"Ally"` otherwise, both
already alphabetic, replacing the non-alphabetic `"Member N"` default that used to be this fallback and
was itself not idempotent under this same filter). This is the same one-time-at-normalization migration
shape `heroName` itself was always going to need, applied to a field that already exists rather than a
new one.

## §7. Q6 — the FORGES entry, the Sprite Forge tab removal, and deletion

**A new `FORGES` entry, id `character`, no `gameTypes` gate (both game types), positioned immediately
after `sprite` in `renderer/app.js`'s own array (`:8-96`) — between the `sprite` entry (`:16-22`) and
the `items` entry (`:23-29`) — since it consumes Sprite Forge output (metasprites, player tiles) the
same way the Monster Forge consumes Sprite Forge actors just below it in the same list. Lazy import,
`mount(container, app)` returning `{ destroy?, onProjectChange? }`, the same contract every other entry
in the array already has.**

**The Sprite Forge's `party` tab is removed entirely — a lossless move, not a copy.** Two editing
surfaces for one record is exactly the drift this codebase's own single-writer discipline refuses
(CLAUDE.md, throughout); keeping a read-only or partial `party` tab "for reference" would only invite the
Item-5-almost-shipped-unvisited failure mode (CLAUDE.md's own `app.forgeIds` passage) in reverse — a
Forge nobody remembers to delete data through. `renderer/forges/sprite/sprite.js`'s own `renderTabs`
(`:1191-1212`) drops the `party` entry and its own conditional spread; `renderPartyPane`/`partyHost`
(`:1175-1187`, `:242`) and the `battle.js` import (`:30`) are deleted; `renderer/forges/sprite/battle.js`
itself is deleted in full, its 206 lines' worth of editing logic having moved to the new Forge (with the
factored-out `drawMetaspritePreview` helper, §4, as its one genuinely new piece, not a straight copy).

**Every cross-link that names the party tab has to move in the same change — found by grep, listed here
for the implementation phase, not edited by this design round (a DESIGN round touches no source under
`main/`, `renderer/`, `shared/`, `engine/`, `test/` or `tools/`, and CLAUDE.md/ROADMAP.md are project
documentation, not source, but are still left to the implementation phase since this round's own scope
is the two design documents named in the brief):**

- `CLAUDE.md:755-759` — "A fourth sibling, `renumberPartyMemberDeletion`... The Sprite Forge's own party
  Remove handler calls it..." — the sentence needs to name the Character Forge instead.
- `ROADMAP.md:1402,1425,1452` — "still on the Sprite Forge's own party tab," "that party tab," "stay on
  the Sprite Forge's party tab" (item 13, the Magic Forge's own learned-spells cross-link).
- `docs/design-magic.md` — a historical, already-shipped design document; its own party-tab references
  (`:41,48,360,417,484-489,786,984-991,1085,1130-1140,1212,1272`, found by grep) describe what was true
  when Magic Forge phase 3 shipped and are not rewritten by this round — they are a record of a past
  decision, the same convention `docs/design-name-entry.md`'s own Changelog already holds to for its
  superseded rounds. Whether to add a forward-pointer note there is an implementation-phase call, not a
  design one.
- `main/smoke.js:6842-6853` — `window.__app.goTo('sprite')` then a `button.tab` search for the text
  `'Party'` — this exact block needs rewriting to `window.__app.goTo('character')` plus whatever
  selection/list UI the new Forge renders; every assertion after it that reads `rpgStore.project.party`
  directly (`:6857,6991`, etc.) needs no change, since the underlying data model is unchanged.
- The generic "visit every Forge" step (`main/smoke.js:480-501`) needs **no change at all** — it drives
  `window.__app.forgeIds`, which already picks up any `FORGES` entry with no `gameTypes` gate
  automatically (CLAUDE.md's own point about this mechanism existing specifically so a new Forge cannot
  ship unvisited).

**Re-run again this round (round-3 review, P1 finding 11 — round-2's own "twenty sites" pass had
already missed two real ones: `battletables.js:873` and the party-tab-specific strings in
`main/smoke.js` beyond the five rail-button hits it did list).** Round 2's own search was anchored to
the literal quoted string `'Sprite Forge'`, which is exactly why it kept missing hits where the phrase
sits inside a longer string (`'Sprite Forge has no Party tab'`) or a template literal (`` `removing …
in the Sprite Forge` ``). This round's own search drops the anchor entirely:

```
$ grep -rn "Sprite Forge" main/ shared/ renderer/ test/ tools/ --include=*.js | wc -l
143
```

**Per-directory count, and a split every prior round omitted — how many of those are comment prose
(never a live string a build or a test can see) versus a real string literal (`where:`, `.title`,
`describe:`, a thrown `Error`, a `step()` label, or an assertion target):**

| Directory | Total | Comment-only lines | Live string literals |
|---|---|---|---|
| `main/` | 67 | 8 | 59 |
| `renderer/` | 28 | 14 | 14 |
| `shared/` | 24 | 14 | 10 |
| `test/` | 24 | 11 | 13 |
| `tools/` | 0 | 0 | 0 |
| **Total** | **143** | **47** | **96** |

**Corrected this round (round-4 review, P2 finding on `:531`; corrected again the round after that,
finding 2/3, for conflating "already false at HEAD" with "false once this design ships"): the blanket
exemption above was itself false — a comment describing *where a control is edited* is exactly the
kind of claim that goes stale the moment that control moves. Two of the 47 name the party tab and will
go stale the moment this design's own move lands, correct as they stand at HEAD today; a third, unrelated
one is already stale at HEAD, for reasons this design did not cause. Every one of the 47 read
individually this round, not spot-checked, with its own surrounding context, and with the two questions
— "is this true right now" and "does this design change that" — kept separate rather than merged into
one "wrong" verdict:**

| Site | Content | Verdict |
|---|---|---|
| `shared/project.js:3042` | `/* ... "Not drawn" in the Sprite Forge's battle tab, so a ... */` — describes the `metaspriteId` picker's own "Not drawn" option, `battle.js:81` | **names the party tab — moves.** This is the exact control this Forge relocates; the comment needs "Character Forge" once `battle.js`'s own metasprite picker becomes this Forge's own. |
| `renderer/forges/magic/magic.js:1-2` | `// Magic Forge — spell authoring, moved out of the Sprite Forge's Party tab (item 13, phase 3). A party member's own *learned* spells stay on that tab (they are edited per member, not per spell)...` | **Corrected this round (round-4 review, P2 finding): this is correct at HEAD, not "live-wrong today."** `battle.js:141` is genuinely where a member's own learned spells are edited right now — the comment describes the present accurately. It **MOVES with this design**, the same present/future distinction every other row in this table already has to keep straight: once the party tab is deleted (§7 above), "stay on that tab" stops being true and needs to become "stay on the Character Forge" — a consequence of this design landing, not a defect sitting in the tree today. Still a second real hit round 3's own sweep missed (found only by reading the full comment rather than the one line the grep highlighted), and still needs the rewrite at implementation time — the fix is the same; only the *reason* it needs fixing was misstated. |
| Every other one of the 47 (`main/` 6 remaining: `generate.js:3201`, `smoke.js:3187,3978,4433,4578,7898,7901`; `renderer/` 12 remaining: `panels.js:566`, `app.js:175`, `librarypicker.js:137`, `sheet.js:2`, `events.js:656`, `sprite.js:1`, `librarysprite.js:1`, `items.js:4`, `templates.js:12`, `map.js:71,83`, `monster.js:4,233`; `shared/` 13 remaining: `:265,314,411,3024,3065,3144,3373,3653,3664,3706,4702,6134,6195`; `test/` 11: `items.test.js:623`, `bankedbytes.test.js:561,1268`, `script.test.js:1135,1171,2371`, `drawvalidation.test.js:1007`, `project.test.js:2489,2952,3253,4213`) | actor placement/deletion, metasprite ceilings, item drops, animation slots, tile-sheet shading, the Forge's own file-header purpose statement, capacity-refusal attribution unrelated to party | read individually, none names the party tab or a party-authored field — **stay**, correctly this time (the round-3 exemption reached the same verdict for these, but by class rather than by reading each one, which is exactly the shortcut this round's own finding named as the defect). |

One real citation from round 3, `generate.js:2020`, was reclassified from "stays" to a fix while
re-reading it in full for this table — corrected again in round 4 (monsters and spells were already
stale at HEAD, not "genuinely" correct), corrected a third time in round 5 (a fourth contributor,
Items, missing entirely) — and **corrected a fourth time this round (round-6 review): "four different
Forges" was itself still wrong, because every round so far reasoned from the comment's own list of
names outward instead of building the list mechanically from the source.** Fixed the only way that
actually closes this: the exact command the round-6 review specified, run and read in full, its output
the inventory rather than a starting point for one:

```
$ grep -noE "project\.[a-zA-Z]+" main/build/battletables.js | sort | uniq -c
      1 114:project.sprites
      1 115:project.party
      1 116:project.spells
      1 117:project.rpg
      1 153:project.items
      1 198:project.items
      1 205:project.js        <- false positive: shared/project.js, a comment's own file reference
      1 362:project.project
      1 364:project.party
      1 372:project.spells
      1 377:project.spells
      1 383:project.rpg
      1 389:project.rpg
      1 394:project.sprites
      1 43:project.js         <- false positive: the module's own import path
      1 488:project.items
      1 675:project.code
      1 737:project.code
      1 786:project.code
      1 871:project.sprites
      1 876:project.spells
      1 883:project.party
      1 888:project.rpg
```

**Every real top-level property, one row, each sub-field read and its editing owner at HEAD, checked
against the actual line rather than inferred from the property name:**

| `project.*` property | Sub-fields `battletables.js` reads | Read at | Owner at HEAD (cited) |
|---|---|---|---|
| `.sprites.actors` | `actor.hp` | `:126` (`mon_hp`) | **Sprite Forge**'s general Actor panel (`renderer/forges/sprite/sprite.js:1025`) |
| | `actor.name` | `:179` (`mon_name`) | **Sprite Forge**'s general Actor panel (`sprite.js:992`) |
| | `actor.battle.{atk,def,speed}` | `:128-129,132` | **Monster Forge** (`monster.js:120-122`) |
| | `actor.battle.{mp,acc,eva}` | `:127,130-131` | **Monster Forge** (`monster.js:125-127`) |
| | `actor.battle.{xp,gold}` | `:133-135` | **Monster Forge** (`monster.js:130-131`) |
| | `actor.battle.{weak,strong,spellId}` | `:136-137,171-174` | **Monster Forge** (`monster.js:134-142`, the `spellId` select's own `onchange` at `:142`) |
| | `actor.battle.{drop,dropPct}` | `:152-153,155` | **Monster Forge** (`monster.js:151-164`, the drop select's own `onchange` at `:156`) |
| | `actor.battle.{battleTile,battleW,battleH,battlePalette}` | `:164-166,167-168,178` | **Monster Forge**'s own "Battle artwork" section — `battleTile` is set by `artPicker`'s own canvas click (`monster.js:216`, not a numeric field), `battleW`/`battleH`/`battlePalette` by the row beside it (`monster.js:177-179`) |
| | `actor.battle.heal` | `:161` (`mon_heal`) | **corrected this round (round-7 review, finding 1): not the Monster Forge — no current editor anywhere.** A legacy input: compiled (`battletables.js:161`) but item 5 phase 4c removed its own control from every Forge; `shared/project.js:4974`'s `deriveItemEffect` is what now reads it — a one-time normalization migration deriving an item's `effect` from its backing actor's own `battle.heal`, not a live editing surface (`docs/design-monster.md` §1 already documents this field as the roadmap's own one omission, kept alive only as that migration's source). |
| `.party` | `startsInParty,metaspriteId,speed,acc,eva,name,base{Hp,Mp,Atk,Def},{hp,mp,atk,def}PerLevel,spells[]` | `:252-283` (`battleTables`); `:364` (`checkBattleTables`, refuses an empty party); `:883` (`battleShortfallAdvice`'s own party-count lever) | **Sprite Forge**'s `battle.js` today — **moves to the Character Forge** under this design (§7 above) |
| `.spells` | `mpCost,kind,amountMin,amountMax,element,scope,name` | `:222-245`; `:372,377` (`checkBattleTables`, an 8-learnable-spell warning); `:876` (a shortfall lever) | **Magic Forge** |
| `.rpg` | `maxLevel` | `:251,265-268,273,277,283,383,389,888` | **Build panel**, "Highest level" (`renderer/forges/build/build.js:82`) |
| | `xpBase`,`xpGrow` (via `xpCurve(rpg)`, `:286`) | `:87-95` inside `xpCurve` | **Build panel**, "RPG progression" (`build.js:80-81`, the same panel section as `maxLevel`, not a separate owner) |
| `.items` | `name`,`effect.kind`,`effect.amount` | `:203,216` (`item_name`,`item_heal`); `:153` (`mon_drop`'s own `itemMissing` check); `:488` (a comment, not code — see below) | **Items Forge** |
| `.project` | `gameType` | `:362`, `checkBattleTables`'s own `!== 'rpg'` early return | not table data — a **gate**, deciding whether this whole function runs at all, not a value it emits |
| `.code` | `overrides` | `:675,737,786`, backing `battleCodeOverridden`/`battleRegionPlacementOverridden` | not table data — a **Code Forge override check**, unrelated to what `battleTables` emits |

`:488` is a comment ("stripped (`project.items = []`)..."), not a second code site — checked and not
double-counted. `:43`/`:205` are the two false positives already marked above (an import path, and a
comment naming `shared/project.js` itself) — confirmed by reading both lines directly, not assumed from
the pattern match.

**The replacement comment names every real owner and carries no numeral for how many there are — the
exact fix the round-6 review specified, since every count this document has stated across four rounds
(three, then four, now discovered to still be wrong before "four" was even written down) has been
wrong at least once:**

```js
// main/build/generate.js:2020-2029, corrected -- every real contributor
// named individually, with no count of how many there are; the
// "ATTRIBUTION WILL HAVE TO WIDEN" note this replaces is finally acted
// on rather than left as a standing TODO.
//
// Attributed to the Build panel's own capacity math for a project fed by
// every Forge listed here: a monster's own battle stats (attack, drops,
// weak/resist, spellId, battle artwork) are edited in the Monster Forge;
// hp and name are general actor fields, edited in the Sprite Forge's own
// Actor panel; a spell's own catalog entry (name, kind, damage/heal
// range, MP cost, element, scope) is edited in the Magic Forge; an
// item's own name and heal amount are edited in the Items Forge; a party
// member's own stats, growth and learned spells are edited in the
// Character Forge. "Highest level" and the two XP-curve fields beside it
// are Build panel fields in their own right, and "Highest level" is one
// of the larger levers (five bytes per party member per level), so
// battleShortfallAdvice names the panel explicitly whenever lowering it
// is one of the fixes, rather than leaving `where` to send the author to
// the wrong Forge for it.
```

**`generate.js:2056`'s own nearby comment says "three Forges" too, and needs the identical treatment,
for the identical reason: this design changes where party lives, and the comment's own list has never
matched the source even before that.** Its text: "The region is fed by three Forges (Sprite's
actors/party, Magic's spells, Items) plus the mapper choice itself." This comment is for a narrower
question than `:2020`'s own (why the *region-overflow error* is attributed to `'Build & Play'` rather
than one Forge, not why each *shortfall lever* says what it does), so it does not need the Sprite
Forge/hp/name distinction `:2020`'s own rewrite carries — but it still bundles "Sprite's actors/party"
as one name, the same staleness `:2020` had, and it never named the Build panel's own `rpg.*`
contribution at all (harmless for *this* comment's own purpose, since "Highest level" was already
named separately at `:2020`, not omitted, but worth confirming rather than assuming). Rewritten to
match, with no numeral here either:

```js
// main/build/generate.js:2056-2062, corrected -- "Sprite's actors/party"
// split into its own two real, current owners, and no numeral for how
// many Forges feed the region
//
// The region is fed by every Forge listed here: the Monster Forge's
// battle stats, the Sprite Forge's own actor hp/name, the Magic Forge's
// spells, the Items Forge, and (moving here under this design) the
// Character Forge's own party -- plus the mapper choice itself (a
// Build-panel decision, reconcileCartridge) that decides its ceiling --
// no single content Forge owns this overflow the way each of the other
// `where:` strings in this file names a Forge that owns the entirety of
// what it reports on. 'Build & Play' is the one existing Forge title
// (renderer/app.js) that already shows this exact number.
```

Grepped this document for "three Forges"/"four Forges"/"three different Forges"/"four different
Forges"/"every Forge" to check for a second count claim this rewrite could now disagree with — real
hits, not assumed absent: `:67,498` (`main/smoke.js`'s own generic "visit every Forge" smoke step,
unrelated — a different sense of "every Forge" entirely, about exercising each Forge's own mount, not
about what feeds the battle region), the two rewritten comments above, this paragraph's own citation of
them, and the historical mention inside the v6 changelog entry below (a since-corrected false claim,
already marked as struck there). None of these is a second live numeral for how many Forges feed the
battle region — the only claim that mattered for this finding — so there is nothing left in this
document for a fifth round to find disagreeing with the two comments above.

**Total: three real fixes found in the comment set, not zero — but they are not one kind of fix, and
conflating them was itself the round-4 finding.** The round-3 exemption undercounted by treating
"documentation, not a live value" as sufficient grounds to skip individual reading, when a comment
naming *where something is edited* is exactly the kind of documentation this whole design round makes
false — that much was right. What round 3 got wrong was *when* each of the three goes false, by not
separating "true at HEAD, false only once this design ships" from "already false today, for reasons
this design did not cause":

- **Consequences of this design landing — correct at HEAD, MOVE because §7 deletes the party tab**:
  `shared/project.js:3042` and `renderer/forges/magic/magic.js:1-2`. Neither is a present defect;
  both describe HEAD accurately and need their own edit as part of implementing this design, not before.
- **A present defect, independent of this design, found while auditing for it**: `generate.js:2020`'s
  own "monsters, spells and the party all live in `renderer/forges/sprite/battle.js`" is already wrong
  for two of its three names *today* — the Monster Forge and the Magic Forge each already own the
  content the comment still attributes to `battle.js`. This one is not "party-only exception, otherwise
  correct" (round 3's own framing) and not "moves with this design" either — it is stale now, for
  reasons that predate this design entirely, and would be worth fixing on its own regardless of whether
  the Character Forge ever ships. This design's own contribution to it is narrower than the other two:
  once the party tab also moves, the comment's *third* name goes stale too, which is why the rewrite
  above is dated to the implementation phase rather than proposed as an out-of-band fix — but the other
  two names were never this design's problem to begin with, and the table above should not have implied
  they were.

**The 96 live string literals, classified individually, grouped by directory. `shared/`+`main/build/`
(source `where:`/`describe:` fields — this is where a real Forge-attribution move has any effect at
all):**

| Site | What it names | Verdict |
|---|---|---|
| `shared/project.js:5816` | more than one actor marked `player` | actor-related — **stays** |
| `shared/project.js:5888` | a metasprite referencing a blank reserved tile | sprite-art-related — **stays** |
| `shared/project.js:5906` | `!project.party.length` — "a turn-based RPG needs at least one party member" | party-related — **moves** to `'Character Forge'` |
| `shared/project.js:5947` | no actor deals damage, so no battle can start | actor-related — **stays** |
| `shared/project.js:6156` | the actor-count ceiling | actor-related — **stays** |
| `shared/project.js:6205` | the metasprite-count ceiling | sprite-related — **stays** |
| `shared/project.js:6244` | two items sharing one backing actor | actor-related — **stays** |
| `shared/project.js:6282` | a Pickup actor no item names | actor-related — **stays** |
| `shared/project.js:6559` | a metasprite's own scanline density warning | sprite-art-related — **stays** |
| `shared/project.js:6566` | a metasprite referencing a reserved tile | sprite-art-related — **stays** |
| `main/build/battletables.js:368` | `checkBattleTables` — no party member starts in the party | party-related — **moves** |
| `main/build/battletables.js:386` | a party member's own learned-spell level exceeds `maxLevel` | party-member-record-related (the "Learns" field, §1's inventory table — moves with the record it describes) — **moves** |
| `main/build/battletables.js:398` | no actor is hostile, so no battle can start | actor-related — **stays** |
| `main/build/battletables.js:405` | `party.length > RPG_LIMITS.party` | party-related — **moves** |
| `main/build/battletables.js:873` (new this round — `battleShortfallAdvice`'s own actor-removal lever, "removing … actors … in the Sprite Forge") | an actor-count capacity lever, the sibling of `:885` below | actor-related — **stays** |
| `main/build/battletables.js:885` | the party-count capacity lever, "removing … party members … in the Sprite Forge" | party-related — **moves**, text becomes "…in the Character Forge" |

**Sixteen sites here, five real string changes** (`shared/project.js:5906`; `battletables.js:368,386,
405,885`), **eleven stay** — every one checked individually against what it actually describes.

**`renderer/`, all 14 live hits — one missed on first pass this round and caught re-counting against
the raw grep rather than trusting the running total: `events.js:1227`, a contact-damage hint ("give a
monster damage in the Sprite Forge") — actor-related, stays.** Full set: `app.js:20` (`title: 'Sprite
Forge'`, the `FORGES` entry itself — stays, the Sprite Forge keeps its own name and rail slot);
`monster.js:265,275,343` (Monster↔Sprite cross-link button labels and hint text, actor-related —
stays); `events.js:1227` (above); `sprite.js:1335,1343` (the Sprite Forge's own panel head and
`app.setMeta` title — stays, unaffected by the party tab's removal); `items.js:73` (a Pickup-behavior
hint pointing at the Sprite Forge's Actors panel — stays); `tutorial.js:131,200,685` (the Tutorial
Forge's own static copy naming every other Forge by its rail title, including "Sprite Forge" — stays,
describes the Sprite Forge as it exists post-move); `tutorial.js:105` ("The player character is drawn
in this Forge, not the Sprite Forge" — the Tile Forge's own tutorial copy contrasting itself with the
Sprite Forge — stays); `map.js:531,1573` (placement hints pointing an author at the Sprite Forge's
Actors panel — stays). `1+3+1+2+1+3+1+2 = 14`. Zero moves — nothing in `renderer/` outside `sprite.js`'s
own now-deleted `battle.js` (already covered in the blast-radius table, §2) ever named the party tab
specifically.**

**`test/`, all 13 live hits: `items.test.js:824,834` (2) and `drawvalidation.test.js:931,945,1318,1326,
1327,1343,1344,1366,1376` (9 — two of these, `:931` and `:1318`, are the `test(...)`'s own description
string naming "Sprite Forge" in prose about what the assertion checks, not a `where:` field itself, but
still a live string literal) — metasprite-count-ceiling and metasprite-density-warning assertions/test
names, `where === 'Sprite Forge'` — actor/sprite-related, stays; `project.test.js:2166,2853` (2 — an
animation-frame-loss test's own description and the actor-count-ceiling assertion — stays).
`2+9+2 = 13`. Zero moves.** Grepped separately for an assertion on any of
the five strings that *do* move (`"at least one party member"`, `"party holds"`, `"No party member
starts"`, a learned-spell-level message, or `checkBattleTables` itself): no match anywhere in `test/` —
none of the five real string changes above breaks an existing test's own assertion text.

**`main/smoke.js`: 59 total hits, 6 comment-only (`:3187,3978,4433,4578,7898,7901`, verified with
`grep -Fxf` against the file's own comment lines, not eyeballed), 53 live — the file this round's own
review named directly, and the one round 2 undercounted (it listed only the five rail-button hits,
`:7272,7945,7999,8045,8069`, already confirmed above as staying).** Of the 53 live hits, **five name
the party tab specifically and move** — the exact set `main/smoke.js:6842-6853`'s own rewrite (§7's
cross-link list, unchanged from round 1) already implied but had not enumerated by their own line
numbers:

| Line | String | Verdict |
|---|---|---|
| `:6845` | `'Sprite Forge has no Party tab'` | **moves** — becomes an assertion that the Character Forge exists/renders instead |
| `:6850` | `'Sprite Forge Party tab has no Doc member to find'` | **moves** |
| `:6853` | `'Sprite Forge Party tab has no Remove button for Doc'` | **moves** |
| `:6867` | `step('Sprite Forge party Remove renumbers a Join naming the removed member', ...)` | **moves** — the step label itself names the old Forge |
| `:7004` | `step('Sprite Forge party Remove is one undo entry', ...)` | **moves** |

**The remaining 48 all stay — none names party or the party tab; every one is Sprite-Forge-proper
functionality unaffected by this move**, grouped by what they actually test (line numbers, not
prose, so the grouping is checkable, and the six comment lines above are excluded here — they were
already counted once, as comments, not as live "stays"): the CNROM tileset-id selector and its own
Actors-tab/Library import flow (`:3198,3205,3220,3245,3254` — 5); the Sprite Forge's own mount/tab-
count/canvas checks (`:4173,4175` — 2); the metasprite Add-button and kernel-lo-div checks
(`:4204,4211,4218` — 3); the starter-library picker's own monster/pickup import flow
(`:4448,4459,4533,4571,4596,4601` — 6); the Monster↔Sprite cross-link round-trip
(`:7721,7734,7735,7740,7743,7754,7771,7791,7828,7838,7908,7909,7913,7917,7924` — 15); the rail-button
and superseded-navigation-race checks, including the Level-persistence remount pair and the five
already-confirmed rail-title hits (`:7272,7273,7945,7946,7952,7999,8000,8005,8011,8016,8045,8046,8050,
8069,8070,8075,8082` — 17). `5+2+3+6+15+17 = 48`, and `48 + 5 = 53`, matching the file's own live-hit
count exactly.

**Total across every directory: 96 live sites. Ten real string changes, not five or six — five
source-level (`shared/project.js:5906`; `main/build/battletables.js:368,386,405,885`, that a real
build or `validateProject` call can produce) plus five test-string changes (`main/smoke.js:6845,6850,
6853,6867,7004`, that exist only because the test asserts on the old wording and must be rewritten
alongside the code it tests, §8's own phase-2 step 8). Eighty-six of the ninety-six live sites
correctly stay** (11 in `shared/`+`main/build/`, 14 in `renderer/`, 13 in `test/`, 48 in
`main/smoke.js` — `11+14+13+48 = 86`), each checked individually rather than assumed safe because it
shares a phrase with one that moves.

**Deletion goes through `renumberPartyMemberDeletion` in one `store.commit`, exactly as today
(`battle.js:102-115`'s own handler is the pattern, moved rather than reinvented).** Deleting the last
remaining character is refused on both game types, for two different concrete reasons that happen to
produce the same UI (`party.length > 1` gating the Remove button's very existence, `battle.js:97-119`'s
own pattern, unchanged): on an RPG, `validateProject` already requires at least one party member
(`:5906`); on an action project, member 0 is *the* character — there is no game with zero player
characters to fall back to, the same reason the Add button is disabled there too (§2).

**The `validateProject` error string at `:5906` — `add('error', 'Sprite Forge', ...)` — must be updated
to name `'Character Forge'`, since that is now the Forge responsible for a project's party.** A small
but real trap: missing this leaves an accurate error pointing an author at a Forge that no longer has
the control that would fix it.

**`ROADMAP.md`'s own "a full character generator" (line 20 of the file, the intro's "deliberately not on
it" list — not "item 20," which does not exist) names RPG Maker's own generator as the rejected scope,
and this Forge is not that.** RPG Maker's generator composites arbitrary bitmap layers (hair, clothing,
accessories) into a character portrait — genuinely unbounded art-generation scope this codebase has no
hardware room for (the intro's own reasoning: "assumes arbitrary bitmaps"). This Forge generates nothing
and composites no bitmaps; it is a stats-and-name editor over sprites the author has already drawn in
the Sprite Forge, exactly the same relationship the Monster Forge already has to a monster's own battle
art (`docs/design-monster.md` §2) — an editing surface for existing content, not a content generator.

## §8. Q7 — phasing

**Recommendation: land this Forge's own schema and UI work *before* `docs/design-name-entry.md`'s own
engine core, as that document's own v16 §17 now specifies (phase 2, ahead of the renumbered phase 3).**
The reasoning is stated fully there and not repeated at length here: the engine core reads
`project.party[N].renamable` and `project.party[0]` unconditionally present, both of which this Forge's
own phase creates: landing the engine core first would mean it has nothing real to read from yet.

**This Forge's own phase 2 content, in the order it should be built (not separately reviewable
sub-phases — one Forge, one `store.commit` per user action, the same discipline every other Forge in
this codebase already holds to):**

1. Schema: `createPartyMember` gains `renamable: false` and its own alphabetic `DEFAULT_MEMBER_NAME`
   (`docs/design-name-entry.md` v16.2 §8, finding 8 — `"Hero"` for id 0, `"Ally"` otherwise, replacing
   the non-alphabetic `Member ${id + 1}` default so every default name is a fixed point of
   `normalizeCharacterName`); `createProject`'s `party:` line drops its ternary (§2); `normalizeProject`'s
   party-building block gains the unified `characterCap` (§2); `normalizePartyMember` gains `renamable`
   and switches `name` to `normalizeCharacterName` (§5, §6).
2. **The unit-test migration this schema change requires — landed in the same phase as step 1, not
   discovered after (round-2 review, finding 3).** `test/unit/project.test.js:226`'s own
   `assert.deepEqual(action.party, [])` no longer holds — `createProject('Quest')` (an action project)
   now seeds exactly one member — and becomes `assert.equal(action.party.length, 1)` plus
   `assert.equal(action.party[0].name, 'Hero')` and `assert.equal(action.party[0].renamable, false)`.
   Grepped `test/` for every other assertion on an action project's own `.party` shape or on
   `createProject()`'s own party field to confirm this is the only one that breaks: the ~90 other
   `.party` references in `test/` are either RPG-scoped (`createProject(name, 'rpg')`, `sample-rpg`-
   derived fixtures, `shared/starters/rpg.js`'s own "Ally" precedent) or operate on a `party` array
   built up by hand within a test body (`project.party = [createPartyMember(0, 'Hero'), ...]`,
   `test/unit/project.test.js` and `main/smoke.js` throughout), which construct their own fixture data
   directly and do not depend on `createProject`'s own action-side default at all — checked individually,
   not assumed from the pattern. New tests, alongside the fixed one: **legacy-action normalization** —
   `normalizeProject({ project: { name: 'Old' } })` (no `party` field at all, the pre-D9 shape every
   real saved action project has today) produces exactly one member, `"Hero"`, `renamable: false`; **the
   one-member cap** — `normalizeProject({ project: { gameType: 'action' }, party: [{name:'A'}, {name:
   'B'}] })` truncates to `party.length === 1`, keeping the first; **idempotence** — the test specified
   in `docs/design-name-entry.md` v16.2 §8 (finding 8), run here against this schema's own real
   `normalizePartyMember` rather than the normalizer function in isolation.
3. `drawMetaspritePreview`/`paintMetasprite`'s widened signature, extracted from `sprite.js` into
   `renderer/widgets/metasprite.js` (§4, round-2 review finding 4 — a signature change on real,
   existing, already-correct code, not new drawing logic) — landed first among the new renderer code,
   since the Character Forge's own card and the Sprite Forge's own metasprite editor (`sprite.js`'s two
   existing call sites, updated to pass their own closures explicitly) both need it, and the change is
   behavior-preserving and checkable in isolation (the pixel-identity test, §9) before any new UI
   consumes it.
4. `tile.js`'s own `consumeContext` addition for `{ mode: 'player' }` (§4) — four lines, the identical
   shape `sprite.js:62-70` already has, landed before the Character Forge's own link to it so the link
   has somewhere real to land the moment it exists.
5. The Character Forge itself: the list-plus-detail shell, Add/Delete (§2, §7), the sprite-in-the-middle
   layout for both game types (§4), the stat block with its action-side hint (§5), the name field and
   renamable checkbox — including the disabled-for-an-inert-starting-member case (§3, finding 10) — and
   §6's own layout.
6. The Sprite Forge `party` tab's removal (§7) — in the *same* implementation phase as step 5, not a
   separate one, since a project with two live editing surfaces for one record even briefly is the exact
   drift this whole move exists to prevent; `battle.js` deleted, `sprite.js`'s own tab list and dispatch
   trimmed.
7. The Map Forge's join row (`docs/design-name-entry.md` v16.3 §13's own real code) — read-only text
   reading `joinNamingCandidate(party[member], member)`, not `renamable` bare (finding 12), landed
   alongside step 5/6 since it reads the same field this phase
   introduces.
8. `main/smoke.js` coverage: the generic visit-every-Forge step needs nothing (§7); the Party-tab-
   specific block (`:6842-6853`) rewritten to the new Forge; new steps for Add/Delete, the renamable
   checkbox (including its disabled state on an inert starting member, finding 10), and the
   action-project one-character-only Add-disabled state.
9. CLAUDE.md/ROADMAP.md cross-link updates and the five real `'Sprite Forge'` → `'Character Forge'`
   string changes (§7's own exhaustive table, finding 11).

**`docs/design-name-entry.md`'s own phase 3 (the engine core) follows, reading `project.party[0]` and
`project.party[N].renamable` as inputs that already exist and are already tested** — that document's own
§17 v16 has the full content and is the authority for it, not restated here.

## §9. What could go wrong (the trap list)

- **The `validateProject` error string still says `'Sprite Forge'`** after the tab moves (`:5906`) — an
  accurate error pointing at a Forge with no control left to fix it. §7.
- **A stale navigation context.** `activeForgeId` (`renderer/app.js`) is a bare module-level variable
  that outlives a project close (CLAUDE.md's own passage on this) — a link into `character` from a
  closed project's leftover state needs `isForgeAvailable`/`selectForge`'s existing fallback to `'tile'`
  to keep working, which it will unchanged, since `character` carries no `gameTypes` gate to begin with.
- **`tile.js`'s missing `consumeContext` call is not automatically safe to add.** `state.mode = 'player'`
  has to be set *before* the first `render()`, mirroring `sprite.js:62-70`'s own placement exactly (right
  after `state` is constructed, before any render call) — adding it after the first render would show a
  one-frame flash of the wrong mode, the identical class of bug the selection-token discipline elsewhere
  in this renderer (CLAUDE.md, "A Forge selection must check it is still the current one after its own
  `await`") exists to prevent, though this specific case has no `await` to race.
- **`drawMetaspritePreview` must not silently diverge from `renderMetaspritePane`'s own drawing rules**
  (transparent index 0, palette source, zoom) the moment it is factored out — a test asserting the two
  render pixel-identically for the same metasprite/palette pair is the concrete guard, the same
  `gif.js`/`gifdecode.js` "written together, tested together" discipline CLAUDE.md already documents
  elsewhere in this codebase.
- **The Add button's disabled reason must say why, not just that it is disabled** — CLAUDE.md's own
  "label it as such... rather than letting it look functional" rule, applied to a *disabled* control
  this time rather than a functional-looking one: "An action game has one character; nothing in the
  engine can draw or fight a second," matching Chris's own framing rather than a generic "limit reached."
- **Corrected this round (finding 10, round-2 review): a `renamable` checkbox is not always
  meaningful, and a shown-but-inert control is exactly the failure CLAUDE.md's own "label it as such"
  rule refuses elsewhere in this same document.** A member with index > 0 whose `startsInParty` is
  `true` is always recruited at boot (`party_init`, `engine/battle.asm:69-71`), so any later Join
  targeting them is always a no-op (`:80`) and their own `renamable` flag is never read by
  `projectUsesJoinNaming` (§3, `joinNamingCandidate`'s own `!startsInParty` term) — a real inert case a
  prior pass of this document missed by only checking "does the flag mean something on some game type,"
  not "does it mean something for *this specific member's own other field values*." The checkbox is
  disabled for exactly that combination, with the stated reason (§3); toggling `startsInParty` off
  re-enables it. Checked rather than assumed a second time, since the first pass's own check (a
  game-type/member-index cross-product) was real but incomplete — it never considered a field
  interacting with another field on the *same* record.
- **`renumberPartyMemberDeletion`'s own contract — mutate before or after the splice, either order gives
  the same answer (`battle.js`'s own comment, `:104-109`) — must be preserved verbatim in the moved
  handler**, not "simplified" during the move; the comment itself is the trap-avoidance record from when
  this was first built and should move with the code, not be dropped as boilerplate.

## Places a claim could not be pinned to a line and was reasoned instead

- **Withdrawn this round (round-2 review, finding 8): the "Member 1" vs. "Hero" fallback question below
  is resolved, not merely a design choice among two live options.** `docs/design-name-entry.md` v16.2
  §8 fixes `createPartyMember`'s own default-name generator (`DEFAULT_MEMBER_NAME`, alphabetic for
  every index, fixing the idempotence bug the round found) as a byproduct makes `base.name` for member
  0 `"Hero"` unconditionally — the same fix that closes the idempotence gap also closes this one, so
  there is no longer a real choice to reason about here at all. Kept as a struck entry rather than
  silently deleted, since it was a real, correctly-reasoned entry as of v1 and the fix that retired it
  belongs to the sibling document, not this one.
- **Withdrawn this round (round-2 review, finding 4): the pixel-composition rules question below no
  longer applies.** §4 no longer describes a behavior to be *reasoned about* — `paintMetasprite`/
  `drawPreviewOnly` (`renderer/forges/sprite/sprite.js:117-139,710-720`) are real, existing, already-
  correct code being extracted verbatim (signature widened, body unchanged), not new drawing logic
  whose own pixel rules had to be inferred from a paraphrase. The pixel-identity test named in §9 is
  still the right regression guard for the extraction itself (a parameter-passing mistake, not a
  drawing-logic one, is what it would now catch), but nothing about *what* the correct pixels are was
  ever actually in question once the real function was found.
- **Whether `docs/design-magic.md`'s own historical party-tab references should gain a forward-pointer
  note** (§7) is left as an implementation-phase call rather than decided here, since this document's own
  scope is the two files the brief named, and editing a third, already-shipped design document is outside
  that scope.
- **The real, assembled kernel-lo/banked-region byte cost of anything in this document is unmeasured**,
  same as every other unbuilt figure in `docs/design-name-entry.md` — but this document adds no new
  compiled bytes at all (§2-§7: every field here is either already compiled, from the same source it
  already came from, or (for `renamable`) compiled exactly as v15.1's own `nameHeroAtStart`/`named` were
  already costed in that document's §11, unchanged in byte terms by which JS field feeds it), so there is
  no new ledger entry for this document to leave unmeasured.

## Changelog

- **v8**: round-8 reviewer finding — the last residual on the grep-built inventory table (§7): the
  Monster Forge row said it edits every listed `battle.*` field, and one of them, `heal`, has no
  editor anywhere.
  - **Finding 1: `battle.heal` split into its own row.** Confirmed by grepping `monster.js` for `.heal`
    — zero hits, no control exists. `battletables.js:161` still emits it into `mon_heal`, unchanged;
    `shared/project.js:4974`'s `deriveItemEffect` is what reads it now, a one-time normalization
    migration deriving an item's own `effect` from its backing actor's `battle.heal` at load time, not
    a live editing surface — item 5 phase 4c removed the control, `docs/design-monster.md` §1 already
    documents this as the roadmap's own one field with no compiled-reader/no-editor asymmetry the other
    direction. Row reads: "legacy input, compiled, no current editing control; migrated into item
    effects at normalization," cited to both lines.
  - **Finding 2: the Monster Forge's own `:120-164` citation covered the stat controls only, not the
    battle-artwork ones at `:177-179` and `:216`.** Split the single citation into one row per group of
    `battle.*` fields, each mapped to its own real control line rather than one range covering fields
    it does not: attack/defence/speed (`:120-122`), accuracy/evasion/MP (`:125-127`), XP/gold
    (`:130-131`), weak/resist/cast-spell (`:134-142`, the spell select's own `onchange` at `:142`),
    drop/drop-chance (`:151-164`, the drop select's own `onchange` at `:156`), and the battle-artwork
    group — `battleTile` set by `artPicker`'s own canvas click (`:216`, not a numeric field at all, a
    real distinction worth keeping since it is the one field in this whole inventory set by a pointer
    event rather than a number input), `battleW`/`battleH`/`battlePalette` by the row beside it
    (`:177-179`).
  - **The self-check the round asked for, run against every row with a specific editing-line citation
    — all confirmed, no further row needed correcting.** `sprite.js:992,1025` (`actor.name`/`hp`);
    every `monster.js` citation above, each re-read directly rather than trusted from the prior
    round's own range; `shared/project.js:4974` (`heal`'s own migration);
    `build.js:80-82` (`xpBase`/`xpGrow`/`maxLevel`, all three, confirmed in the same "RPG progression"
    section). One citation corrected in passing, not itself the finding: `xpCurve`'s own function body
    was cited as `:87-93`; re-reading it directly shows it runs `:87-95` (the closing `return
    totals; }` sits two lines past the prior citation's own end) — fixed to the real span.
  - **Per-section line counts, v7 → v8** (awk `## §`-boundary): §0 69→69, §1 23→23, §2 165→165, §3
    80→80, §4 52→52, §5 34→34, §6 33→33, §7 344→350 (+6, the `heal` row split out and the Monster
    Forge citation broken into one row per real control group), §8 70→70, §9 40→40, "Places a
    claim..." 29→29, Changelog 278→(this entry, grows). No section shrank.
  - `docs/design-name-entry.md` needed no edit this round.
  - Findings not contested: none — both citations were checked directly against the source before
    this entry was written, and the self-check found one small, unrelated citation error (`xpCurve`'s
    own line range) worth fixing alongside the two named findings rather than left for a ninth round.

- **v7**: round-7 reviewer finding — the same finding as round 6, still open, because round 6's own
  "four different Forges" was reasoned outward from the comment's own list of names one more time,
  rather than built mechanically from the source. Two more real gaps: the Sprite Forge still
  contributes (`battletables.js:126` emits `mon_hp` from `actor.hp`, `:179` emits `mon_name` from
  `actor.name`, both edited on the Sprite Forge's own general Actor panel,
  `renderer/forges/sprite/sprite.js:992,1025` — a control this design does not move); and the Build
  panel contributes more than "Highest level" alone (`battletables.js:87` reads `rpg.xpBase`/`xpGrow`
  via `xpCurve`, edited at `renderer/forges/build/build.js:80-81`, the same "RPG progression" panel
  section `maxLevel` is already in).
  - **Fixed the only way that actually closes this, per the round's own instruction**: ran `grep -noE
    "project\.[a-zA-Z]+" main/build/battletables.js | sort | uniq -c` and built the inventory from its
    output — one row per real top-level property (`sprites`, `party`, `spells`, `rpg`, `items`,
    `project`, `code`; two hits, `:43,205`, are false positives from an import path and a comment
    naming `shared/project.js`, checked and excluded rather than trusted blindly), each sub-field
    within it, the exact read line, and the real editing owner at HEAD — rather than reasoning from
    the three or four names a prior round's own rewrite already suggested looking for.
  - **Rewrote both `generate.js:2020` and `generate.js:2056` with no numeral for the Forge count at
    all** — "fed by every Forge listed here:" followed by the list, per the round's own explicit
    instruction not to introduce a replacement count that could go stale the same way "three" and
    "four" already had. `:2056`'s own comment ("three Forges") gets the identical treatment, since it
    has the identical staleness (bundled "Sprite's actors/party") for the identical reason (this
    design moves where party lives) — checked and confirmed rather than assumed, since the two
    comments serve different purposes (`:2020` explains lever attribution, `:2056` explains a single
    region-overflow error's own `where`) and could in principle have needed different fixes.
  - **A residual overclaim caught before this entry was written**: a first draft's closing paragraph
    claimed grepping the document for Forge-count phrases turned up hits only inside the two rewritten
    comments; actually running that grep found four more (a smoke-test step's own unrelated "visit
    every Forge," used twice, and the historical mention inside the v6 entry below). Rewritten to
    report what the grep actually returned.
  - **Per-section line counts, v6 → v7** (awk `## §`-boundary): §0 69→69, §1 23→23, §2 165→165, §3
    80→80, §4 52→52, §5 34→34, §6 33→33, §7 311→344 (+33, the mechanical inventory table and both
    no-numeral rewrites), §8 70→70, §9 40→40, "Places a claim..." 29→29, Changelog 240→(this entry,
    grows). No section shrank.
  - `docs/design-name-entry.md` needed no edit this round.
  - Findings not contested: none — `battletables.js:126,179`, `sprite.js:992,1025`,
    `battletables.js:87`, and `build.js:80-81` were each re-read directly before this entry was
    written.

- **v6**: round-6 reviewer finding (0 P1, 1 P2 — `docs/design-name-entry.md` untouched again this
  round, per the brief). The round-5 rewrite of `generate.js:2020`'s comment named three contributing
  Forges (Monster, Magic, Character) and missed a fourth: `main/build/battletables.js:198` reads
  `project.items` directly (`item_name` at `:203`, `item_heal` at `:216`) to emit real table content,
  making the Items Forge a fourth, live contributor the round-5 rewrite never named at all.
  - **Read `main/build/battletables.js` end to end this round, not grepped for the three names the
    comment itself already suggested** — the only way the Items gap could have been found, since
    nothing about the comment's own wording pointed at it. Found, in the same pass, that the *original*
    comment already knew this was coming: its own trailing note (`generate.js:2026-2029`) reads
    "ATTRIBUTION WILL HAVE TO WIDEN IN PHASE 5... once `project.items` exists this `where` can no longer
    name one Forge for every input" — `project.items` exists now, `battleTables` already reads it, and
    the widening that note itself predicted never happened. A fourth, independent staleness in the same
    three-round-old comment block, unrelated to the Character Forge.
  - **Checked, and excluded, a fifth candidate rather than assumed complete at four**:
    `project.code?.overrides` (`battletables.js:675,737,786`) backs `battleCodeOverridden`/
    `battleRegionPlacementOverridden`, a build-time override check, not data `battleTables` itself
    emits — not a table-data contributor, correctly left out.
  - **`generate.js:2056`'s own nearby comment, checked as instructed, already named Items correctly**
    but still bundled "Sprite's actors/party" as one name — the identical two-part staleness `:2020` had
    (monsters at the Monster Forge, party moving to the Character Forge under this design). Rewrote both
    comments together so they agree, rather than fixing one and letting the other drift further.
  - **A false claim caught and removed before this entry was written**: a first draft of this section
    claimed "§2's own earlier reference to 'three Forges'... names Monster/Magic/Items/Character
    individually there already" — grepped this document for that phrase and found no such reference
    anywhere; the claim was invented, not read, and is replaced with a real, checked grep result (no
    other Forge-count claim exists in this document to disagree with the corrected one).
  - **Per-section line counts, v5 → v6** (awk `## §`-boundary): §0 69→69, §1 23→23, §2 165→165, §3
    80→80, §4 52→52, §5 34→34, §6 33→33, §7 273→311 (+38, the Items contributor, the excluded
    Code-Forge-overrides check, the `generate.js:2056` companion fix, and both rewritten comment
    blocks), §8 70→70, §9 40→40, "Places a claim..." 29→29, Changelog 204→(this entry, grows). No
    section shrank.
  - `docs/design-name-entry.md` needed no edit this round, per the brief — the finding was entirely
    about this document's own §7 rewrite.
  - Findings not contested: none — `battletables.js:198,203,216` and `generate.js:2026-2029,2056-2062`
    were each re-read directly before this entry was written.

- **v5**: round-5 reviewer finding (0 P1, 1 P2 — `docs/design-name-entry.md` had no open finding this
  round and needed no change). The §7 comment audit mixed two different questions — "is this comment
  true right now, at HEAD" and "does this design change that" — into one "wrong"/"stale" verdict, in
  both directions at once: a comment that is *correct today* and only goes stale once this design's own
  move lands was called "live-wrong today," and a comment that is *already wrong today*, for reasons
  this design did not cause, was excused as "genuinely stays."
  - **Finding 2 (`:536` as of v4): `renderer/forges/magic/magic.js:1-2` ("learned spells stay on the
    Sprite Forge's party tab") is correct at HEAD — `battle.js:141` really is that surface right now —
    and was wrongly called "live-wrong today."** Reclassified: correct at HEAD, MOVES with this design.
    The fix this document already specified (rewrite to name the Character Forge) is unchanged; only
    the reason it needs the fix was wrong.
  - **Finding 1 (`:546` as of v4): `main/build/generate.js:2020`'s own comment says monsters, spells
    *and* the party all live in `renderer/forges/sprite/battle.js`; the prior round's fix called this
    "a party-only exception" and said monsters and spells "genuinely stay where this comment says."
    Checked directly against both files: false for two of the three, already, at HEAD.**
    `renderer/forges/magic/magic.js:1-4` already gives spell-catalog authoring to the Magic Forge — only
    a member's own *learned* spells remain on `battle.js` (`:141`), a party-record field, not a
    spell-catalog one. Grepping `renderer/forges/sprite/battle.js` for any of a monster's own battle
    stats (`atk`/`def`/`acc`/`eva`/`speed`/`xp`/`gold`/`weak`/`strong`/`spellId`/`drop`/`battleTile`)
    returns zero hits; the identical grep against `renderer/forges/monster/monster.js` returns every one
    of them (`:120-164`) — that Forge's own header (`:1-6`) states the boundary directly, `hp`/`damage`
    staying on the Sprite Forge's *general Actor panel* (a different surface, a different record,
    `project.sprites.actors[]` not `project.party[]`) because both are dual-purpose for an action
    project. Only "the party" was ever still true at HEAD, and even that goes stale once *this* design's
    own move lands. Rewrote the comment naming all three real, current owners individually — Monster
    Forge (battle stats), Magic Forge (spell catalog), Character Forge (party, once this design ships)
    — rather than carving one exception out of an otherwise-trusted sentence.
  - **Finding 3: applied the same distinction to every other "wrong"/"stale" framing in the §7 table and
    its own surrounding prose.** `shared/project.js:3042`'s own verdict already used "once... becomes"
    framing correctly and needed no change. The table's own intro paragraph (`:528-531` as of v4, "one
    already had [gone stale]") repeated finding 2's own error and is corrected alongside it. Both
    historical mentions of this material inside the v4 changelog entry itself (below) are given inline
    corrective notes rather than left to repeat the withdrawn claims silently, per this document's own
    convention that a history note must say a claim was corrected, not merely restate it.
  - **Per-section line counts, v4 → v5** (awk `## §`-boundary): §0 69→69, §1 23→23, §2 165→165, §3
    80→80, §4 52→52, §5 34→34, §6 33→33, §7 208→273 (+65, the reclassified table row, the intro
    paragraph's own correction, and the fully-rewritten `generate.js:2020` analysis with its own
    grep evidence and rewrite), §8 70→70, §9 40→40, "Places a claim..." 29→29, Changelog 154→159 (+5,
    the two inline historical corrections within the v4 entry). No section shrank.
  - `docs/design-name-entry.md` needed no edit this round — the finding was entirely about this
    document's own §7 comment audit, and nothing in the sibling document made the same claim.
  - Findings not contested: none — both re-derivations (`magic.js`'s own correctness at HEAD, and
    `generate.js:2020`'s own staleness for two of its three names) were checked directly against the
    cited source rather than against either the reviewer's or a prior round's own prose.

- **v4**: round-4 reviewer findings (NO-GO: 1 P1, 4 P2) — five findings, each naming a specific false
  sentence rather than a class of defect; closed by re-deriving the true claim from the source, not by
  softening the false one.
  - **P1a (§2): the `battleTables` verdict named only one production caller and missed a second, real
    one.** `main/build/battletables.js:585` (`battleTableBytes`) also calls `battleTables` directly,
    with no gate of its own — and `battleTableBytes` is itself the capacity path (`battleRegionBytes`,
    the Build panel's own meter). Traced the **full** caller graph to its root this time rather than
    stopping at the first caller found: `battleTableBytes` → `battleRegionBytes`/`battleShortfallAdvice`
    → `switchableMappers`'s filter (gated `bankedCode`), `generate.js`'s own capacity check (gated
    `bankedCode`), and the Build panel's meter (`renderer/forges/build/build.js:621`, gated `isRpg ? ...
    : null` — confirmed the Build panel mounts on both game types, but this specific expression, being
    inside the `isRpg ?` branch of a ternary, is never *evaluated* on an action project, not merely
    never *shown*). Every path traced to its root is gated; none reaches an action project in
    production. The verdict is rewritten to state the full chain rather than the one link found first.
  - **P1b (§2): "`pc_hp`/`pc_name_ram` do not exist on an action build's own save record at all" was
    false.** `shared/save.js:118,131` list both in `SAVE_FIELDS` **unconditionally**, every game type,
    the identical pattern `player_hp`'s own comment (`:107`) already states in the other direction —
    phase 1 shipped it that way on purpose. Rewrote the verdict with the true reason
    `test/unit/save.test.js` is unaffected: `SAVE_FIELDS`'s own layout is a fixed list of constants
    (`RPG_LIMITS.party`, `RPG_LIMITS.nameLength`), never a function of a specific project's
    `party.length` — D9 cannot touch it regardless of which project's fixtures a test happens to use.
  - **P2 (`:531`): the 47-comment exemption was itself false — a comment describing *where* a control
    is edited is exactly the claim that goes stale when the control moves.** *(Corrected the round
    after this one, finding 2/3: "one already had [gone stale]" below overstated it — the two comments
    named here are correct at HEAD and go stale only once this design's own move lands; see the v5
    entry for the present/future distinction this entry conflates.)* Re-read all 47 individually rather
    than exempting them as a class (round 3's own shortcut, now named as the defect it was). Found two
    real hits, not the one named: `shared/project.js:3042` ("Not drawn" in the Sprite Forge's battle tab
    — the `metaspriteId` picker's own option text, moving with the control) and a second one the
    finding's own citation did not name, `renderer/forges/magic/magic.js:1-2` ("A party member's own
    *learned* spells stay on that [Sprite Forge Party] tab") — found only by reading the full comment
    rather than the one line grep highlighted. Both reclassified MOVES; a third, related fix noted in
    `main/build/generate.js:2020`'s own comment (its "the party... lives in `battle.js`" premise needs
    a parenthetical now that the party lever's own `describe` string moved) — **this entry's own closing
    claim that "monsters/spells genuinely stay where it says" was itself wrong, corrected the round
    after this one: both were already stale at HEAD, independent of this design (the Monster Forge and
    Magic Forge own them respectively); see the v5 entry.** The other 45 re-verified individually and
    correctly stay.
  - **P2 (`:3758` in `docs/design-name-entry.md`) and P2 (`:2432` there) are that document's own
    findings**, closed there (the join-row hint's missing re-render, and `joinNamingCandidate`'s missing
    `export`) — neither claim originates in this document, so nothing here needed to change for them
    beyond the cross-references already in place.
  - **Per-section line counts, v3 → v4** (awk `## §`-boundary): §0 69→69, §1 23→23, §2 165→165 (0 net
    newlines — both fixes grew two existing table-row *cells* substantially, using `<br>` for internal
    line breaks rather than adding new table rows, so the section's own line count is unchanged even
    though real content was added; verified by re-reading both rows in full above, not inferred from
    the count), §3 80→80, §4 52→52, §5 34→34, §6 33→33, §7 189→208 (+19, the two-comment reclassification
    table and the `generate.js:2020` note), §8 70→70, §9 40→40, "Places a claim..." 29→29, Changelog
    107→(this entry, grows). No section shrank.
  - Findings not contested: none — every cited line held, and P1a/P1b in particular required tracing a
    real multi-hop call graph rather than accepting the first gate found as the whole story.

- **v3**: round-3 reviewer findings (NO-GO: 2 P1, 3 P2) — round 2 closed seven of round 1's eleven
  findings for real; the remaining four (this document's own share: findings 2, 4, 11, plus 1's own
  residue) were each an audit that said "every"/"all" and, on re-grep, was not. Fixed by actually
  running the audits to completion this round, pasting the counts rather than the word "every."
  - **P1 finding 2 (blast-radius table).** Re-run without any shortcut: `main/smoke.js` (18 hits total
    for `main/`, of which 11 are `main/smoke.js`'s own — all verified RPG-scoped individually, not
    assumed) and `tools/` (2 hits, both RPG-fixture generators) were entirely absent from the table;
    added. The `battletables.js` verdict — "every entry point gated" — was itself false for
    `battleTables` (`:112-115`), which reads `project.party` with **no** internal check at all; the
    verdict is corrected to name the one production caller that gates it instead
    (`main/build/generate.js:2432`) and the eight direct test call sites that bypass that gate (all
    individually confirmed to pass an RPG-typed project, so none is a live bug — but the safety
    property is now stated accurately: caller discipline, not the function's own body). §2's own count
    heading now states the exact per-directory total (main/ 18, renderer/ 13, shared/ 30, test/ 93,
    tools/ 2 — 156) rather than a summary claim.
  - **P1 finding 11 (`'Sprite Forge'` string audit).** Re-run unanchored (`grep -rn "Sprite Forge"`,
    no quotes) across all five directories: 143 total hits, split into 47 comment-only and 96 live
    string literals — round 2's own "twenty sites" table had missed `battletables.js:873` (an
    actor-related lever, correctly stays, but had to be found and listed) and every party-tab-specific
    string in `main/smoke.js` beyond the five rail-button hits it already had. Re-audited `main/smoke.js`
    itself down to the line (59 total, 6 comment, 53 live — verified with `grep -Fxf` against the file's
    own comment lines, not eyeballed) and found the real five that move (`:6845,6850,6853,6867,7004`),
    plus caught and fixed two of my own arithmetic slips while writing this round's own version of the
    table (a miscounted `renderer/` total that had silently dropped `events.js:1227`, and a
    `main/smoke.js` "live" figure that was actually the file's *total*, not its live count, before the
    grouped "stays" list was re-derived to match). Final, checked tally: 96 live sites, 10 real string
    changes (5 source, 5 test), 86 stay.
  - **P2 finding 1 (residue).** §3's own main text was already correct as of round 2; this round's own
    scope here was confirming that, and it held. `docs/design-name-entry.md` v16.3 is where the two
    surviving live copies of the withdrawn claim actually were.
  - **P2 finding 4 (residue).** §0 still repeated the withdrawn "no compositor exists outside
    `renderMetaspritePane`" claim — round 2 fixed §4 but never propagated the fix back to §0's own "what
    I read" summary. Fixed: §0 now names `paintMetasprite`/`drawPreviewOnly` directly and explains that
    the original name-based grep searched for the wrong function names, not that no compositor existed.
  - **P2 finding 12 (fresh).** The Map Forge's own join-row hint and summary line
    (`docs/design-name-entry.md` §13) read `member?.renamable` bare; fixed there, cross-referenced here
    (§3, §8's own phase-plan step 7). Grepping this document's own `.renamable` reads for the same
    pattern found one more prose site worth tightening (§3's own recommendation paragraph, now naming
    `joinNamingCandidate` explicitly rather than describing the mechanism as reading `renamable` alone) —
    the real second defect the same sweep found in `encodeCommand` itself is `docs/design-name-entry.md`
    v16.3's own finding, not this document's.
  - **Per-section line counts, v2 → v3** (awk `## §`-boundary): §0 61→69 (+8, the compositor-citation
    fix), §1 23→23, §2 133→165 (+32, the rebuilt blast-radius table and its own exact counts), §3
    79→80 (+1, the `joinNamingCandidate` naming fix), §4 52→52, §5 34→34, §6 33→33, §7 99→189 (+90,
    the exhaustive `'Sprite Forge'` re-audit), §8 69→70 (+1, step 7's own `joinNamingCandidate`
    correction), §9 40→40, "Places a claim..." 29→29, Changelog 51→(this entry, grows). No section
    shrank.
  - **The two grep audits this round required, pasted in full**: `.party` per directory — `main/` 18,
    `renderer/` 13, `shared/` 30, `test/` 93, `tools/` 2 (156 total, §2). `Sprite Forge` (unanchored)
    per directory — `main/` 67, `renderer/` 28, `shared/` 24, `test/` 24, `tools/` 0 (143 total, split
    47 comment / 96 live, §7).
  - Findings not contested: none — every citation re-verified against the source it named
    (`main/build/battletables.js:112-115,873`, `main/smoke.js`'s own line-by-line comment/live split,
    `renderer/forges/sprite/sprite.js:117-139,710-720`, `docs/design-name-entry.md`'s own §9/§13) before
    being closed.

- **v2**: round-2 reviewer findings (NO-GO: 6 P1, 5 P2) — every source citation the review named was
  verified directly before being closed; all eleven held. Findings closed in this document: finding 1
  (§3 — the "per-placement naming never mattered" claim was wrong and is withdrawn, not softened: it was
  real, observable, route-dependent behavior, and v16 gives it up because Chris's request specifies one
  flag per character, not because the old mechanism was inert); finding 2 (§2 — the blast-radius table
  rebuilt without exclusions, `shared/starters/` included and `test/` noted separately, two real ungated
  sites found — `renumberSpellDeletion`/`renumberMetaspriteDeletion`, both safe on inspection rather than
  by a blanket "gated" claim — and the false "eleven sites, all gated" summary replaced by the table
  itself as the claim); finding 3 (§8 — the `test/unit/project.test.js:226` breakage named explicitly,
  with the fixed assertion and three new tests: legacy-action normalization, the one-member cap, and
  idempotence); finding 4 (§4 — the compositor citation corrected: `paintMetasprite`/`drawPreviewOnly`
  are real, existing, already-correct code with a genuine per-tile palette, not the invented
  `{tile, dx, dy, flipH, flipV}` shape a prior pass cited, and the work is a signature-widening
  extraction, not new drawing logic); finding 5's own engine-side content lives in
  `docs/design-name-entry.md` v16.2 (the sprite-CHR-stamp fix does not touch this document); finding 6's
  own content is entirely `docs/design-name-entry.md` v16.2's; finding 7's own predicate is entirely
  `docs/design-name-entry.md` v16.2's (`joinNamingCandidate`), cited here rather than restated; finding 8
  (§8 — the phase plan cites `docs/design-name-entry.md` v16.2 §8's own fix and idempotence test rather
  than restating them, and this document's own stale "Member 1 vs. Hero" reasoned-instead entry is
  struck as resolved); finding 9 is entirely `docs/design-name-entry.md` v16.2's; finding 10 (§3, §9 —
  the `renamable` checkbox is disabled for an index > 0, `startsInParty`-true member, with the stated
  reason, and the "naming every starting member in sequence" alternative is named as future scope in
  `docs/design-name-entry.md` v16.2 §18, not built here); finding 11 (§7 — an exhaustive, individually
  classified table of all twenty `'Sprite Forge'` string sites found in `main/`/`shared/`, five moving to
  `'Character Forge'`, fifteen correctly staying). A second, real defect found and fixed while closing
  finding 8: `normalizeCharacterName` was defined twice — once (correctly) in `docs/design-name-entry.md`
  §8, and again, verbatim, in this document's own §6 — a real single-writer violation the "defined
  exactly once" rule this round added exists to catch; §6 now cites the one definition instead.
  - **Per-section line counts, v1 → v2** (awk `## §`-boundary): §0 61→61, §1 23→23, §2 97→133 (+36,
    finding 2's own rebuilt table), §3 46→79 (+33, findings 1 and 10), §4 41→52 (+11, finding 4), §5
    34→34, §6 39→33 (**-6, real shrink** — the duplicated `normalizeCharacterName` body removed in favor
    of citing `docs/design-name-entry.md` §8, the single-writer fix named above; the function's own text
    is not lost, only the second copy of it), §7 66→99 (+33, finding 11's own table), §8 42→69 (+27,
    finding 3's own test-migration step), §9 34→40 (+6, finding 10's own trap-list correction), "Places a
    claim..." 25→29 (+4, two entries struck as resolved by name-entry's own v16.2 fixes, replacing two
    stale ones rather than merely deleting them — CLAUDE.md's own docs-test discipline this project
    already holds to elsewhere is what a struck-not-deleted entry preserves: a reader can see a claim was
    made, checked, and retired, not wonder whether it was simply missed), Changelog 5→(this entry,
    grows). One section shrank (§6), with the line above stating what was removed and why, per this
    document's own rule.
  - **Findings not contested: none** — every citation (`engine/battle.asm:69-71,79-91`,
    `sprite.js:117-139,710-720`, `main/build/battletables.js:368,386,398,405,885`,
    `tools/make-rpg-save-sample.js:230`, `test/unit/project.test.js:226`, and the rest) was re-read
    directly rather than trusted from the review's own prose, per the round's own instruction, and all
    held.

- **v1** (this document, 2026-09-08): first version, written in response to Chris's own request
  (verbatim, above) as his answer to `docs/design-name-entry.md` §19 question 1. No prior version
  exists.
