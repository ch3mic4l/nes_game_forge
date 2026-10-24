# Design: a seed picker for the Monster Forge's "Derive from level…" modal (rounds D1–D2)

Deferred by `docs/design-monster-level-scaling.md` §2 (shape 3), §6 Q3, N4. **Design only; no product code.**

## §0. Settled (quoted from the brief; not reopened)

- "Renderer-only and ROM-neutral. Add no new schema field and no stored seed or recipe." (Shape 2b, the saved recipe,
  was declined in level-scaling §2.)
- "`hp` stays out of the modal (design §3.3, the Forge boundary)."
- "The modal's Apply `onClick` does nothing fallible (design §3.1/N1; CLAUDE.md's `showModal` convention). Every guard
  and the plan run after the await. The seed control itself is local modal state."
- "`MONSTER_GROWTH_FIELDS` stays the single writer for row bounds. Seeded values must respect each row's `ceiling` and
  `perLevelMax`. A party member's growth must be read through `effectiveGrowth` / `memberStatAt` (`shared/project.js`),
  never the raw `baseX` / `xPerLevel` fields."

## §1. Ground truth (current tree)

| Fact | Where |
|---|---|
| Open: `picked[key] = { base: battle[key] ?? BATTLE_DEFAULTS[key], perLevel: 0 }`; body built once; Apply returns `{ ...picked }` | `renderer/forges/monster/monster.js:355-402` |
| Post-await guards (`destroyed`, `revision`, selected actor), plan, one commit | `monster.js:404-417` |
| `BATTLE_DEFAULTS` is `ACTOR_BATTLE_DEFAULTS` re-keyed for the seven rows | `monster.js:110-118`; `shared/project.js:5868-5884` |
| Local `select()` is flat (no groups); `animationSelect` is the shared-picker precedent | `monster.js:90-95`; `renderer/widgets/battlefxpreview.js:34` (also `magic.js:234`, `character.js:716`) |
| Catalog = `monsterActorIds`: `damage > 0` actors plus any named by an encounter table, group or battle command | `shared/project.js:1436`, `:588` |
| `MONSTER_GROWTH_FIELDS` (atk, def, mp, gold, mag, mdef, xp) with `ceiling` / `perLevelMax`; `planMonsterGrowth` clamps and diffs against stored values | `shared/project.js:6132-6176` |
| `GROWTH_LIMITS`: party mp base ≤ 99; `perLevel` ≤ 16 for the five eligible party stats (atk, def, mp, mag, mdef; hp's is 32 and hp is not a row) | `shared/project.js:6008-6015` |
| `effectiveGrowth(project, member)` returns `{ stat: { base, perLevel, shape } }` from the live profile, else the member's own fields (dangling `profileId` reads as none) | `shared/project.js:6078-6087` |
| `profileStatAt`: `early`/`late` hold `k = level-1` to 0..14; every shape equals `min(255, base + 14*perLevel)` at level 15 (non-negative inputs; cap `:5998`, `:6057`) and `base` at level 1 | `shared/project.js:6048-6058` |
| `RPG_LIMITS.maxLevel` is 15 = `GROWTH_HORIZON_LEVEL`; `battle.level` is clamped to it | `shared/project.js:1177`, `:6031`, `:5984` |
| `normalizeActor` fills `battle.*` via `clamp(value, min, max, fallback)`; a same-session actor may have no `battle` or only `{ level }`. `clamp` goes through `Number()`, so a stored `null` normalizes to 0 (`:5904`); the modal's `??` reads null as missing (§5) | `shared/project.js:5886-5987`, `:4863` |
| The defaults regression covers missing fields only, not null | `main/smoke.js:14436-14541` |
| `undo()`/`redo()` swap in a cloned `store.project` and bump `revision`; Ctrl/Cmd+Z is skipped while an INPUT, SELECT or TEXTAREA is focused (`app.js:674-681`), the new picker included | `renderer/store.js:232-252`; `renderer/app.js:672-684` |
| Character Forge shape names: Linear / Early bloomer / Late bloomer | `renderer/forges/character/character.js:342` |

## §2. Shape of the solution

Two pure helpers in `renderer/forges/monster/seed.js` (no DOM, no Node APIs; `node:test` imports it), reading its tables and `effectiveGrowth` / `monsterActorIds` from `shared/project.js`, repeating only its `clamp`. Not in `shared/`: `generatorHash` (`test/lua/sw_provenance.mjs:47`) hashes all of `shared/` and `main/build/`, so a placement there would force a bound-evidence renewal (Chris, 2026-10-24, option B):

- `seedMonsterGrowth(project, source)` with `source` either `{ kind: 'actor', index }` or `{ kind: 'party', index }`.
  Returns `{ rows, curves }`: `rows` holds only the keys that source supplies, each `{ base, perLevel }` inside that
  key's `MONSTER_GROWTH_FIELDS` bounds; `curves` lists `{ key, shape }` for non-linear stats (§4). Pure, fresh objects.
- `monsterSeedSources(project, actorIndex)` returns the picker's list, each `{ id, kind, group, name, label, rows, filled, curves }` (`kind` self/actor/party; `name` the bare name, for the note).
  Entry 0 is `self` (the open actor: today's default, read by §5's one rule). It is the single source of the modal's initial and reset rows (§7). Every other entry's `rows` is **total**: the
  source's own where supplied, `self`'s elsewhere. `filled` names the supplied keys, for the note.

The modal calls `monsterSeedSources(store.project, capturedActorId)` once, before `showModal`; `picked` starts from entry
0, replacing the loop at `monster.js:363-366`. The equivalence with today's rows has the scope stated in §5; U6d and S1 add the null case the defaults regression lacks.

## §3. Q1 — Party mapping

| Row | From a party member |
|---|---|
| `atk` `def` `mp` `mag` `mdef` | `effectiveGrowth(project, member)[stat]` → `{ base, perLevel }`, clamped to the monster row's bounds |
| `xp` `gold` | **not supplied**; they keep `self`'s value (§6) |
| `hp` | not a row (settled) |

`base` is the member's level-1 value (every shape returns it at level 1), the modal's own meaning of `Base`. **`effectiveGrowth`, not `memberStatAt`:** the modal needs the pair, not one level's value. Both read the live profile, so
a profile-only mage seeds its profile's mag.

**The cap differences run the safe way.** Party → monster only widens (mp base 99 ≤ 255; perLevel 16 ≤ 32, or = 16 for mag/mdef), so the clamp is defensive (a hand-poked member), not a visible loss.
For a linear member the seed reproduces the member exactly: both sides are `statAt` with ceiling 255, so a monster at
level L derives the member's own value for every L in 1..15, saturation included (both cap at 255).

## §4. Q2 — Growth shapes

**Recommend: copy `{ base, perLevel }` as is, and say so.** `perLevel` is documented as the average through level 15 (`profileStatAt`), so the straight line meets the curve at level 1 (`base`) and level 15 (`min(255, base + 14*perLevel)`, the same cap on both sides). The monster level cap *is* level 15 (§1), so nothing extrapolates past the plateau. In between they **can** differ (not always: saturated, they are equal). Base 10, +16, level 8 (`k = 7`): linear 10 + 112 = 122; early 10 + `floor(2359/14)` = 178; late 10 + `floor(791/14)` = 66 (gains 112 / 168 / 56), enough to need words. §10's oracle works the other shapes.

The self note's wording is the implementation's own. The author sees, under the picker, a note naming the member, the stats and the Character Forge's exact shape label (one clause per shape), only when a seeded stat is non-linear **and** has `perLevel > 0`:

> Copied Attack and Defence from Rian. Rian’s Attack grows as an Early bloomer and Defence grows as a Late bloomer; Derive grows each in a
> straight line, so they agree at level 1 and level 15 and can differ in between.

Alternatives and why not:

- **Refuse the option:** removes the most direct use of a party source (borrowing a profiled hero's numbers as a starting point), this design's stated reason for offering one; this design's priority, not every author's (Q-A).
- **Fit `perLevel` to the monster's level:** undefined at level 1, off by integer rounding, and a `+ / level` that matches nothing in the Character Forge.

## §5. Q4 — Actor seeds and partial actors

An actor stores flat values, no pair. **`Base` = the source's flat value, `+ / level` = 0, all seven rows**, which is
exactly the semantics the modal already gives the open monster (its current flat value becomes `Base`; level-scaling §5's "reopening shows Base 32, + / level 0" trap applies identically, so no new hint text).

- **One read for self and every actor (R4):** `battle = actor.battle ?? {}`, then per key `clamp(battle[key] ?? ACTOR_BATTLE_DEFAULTS[key], 0, ceiling, ACTOR_BATTLE_DEFAULTS[key])`. A nullish field is *missing* and opens as its default, as today's `??` (`monster.js:365`) does: `{ atk: null }` opens as 4, not the 0 `normalizeActor` gives a *loaded* null (`:5904`). A stored `0` stays `0` (a `||` fallback would turn xp 0 into 4). No `battle`, or only `{ level }`, seeds 4/2/0/2/0/0/4.
- **Equivalence scope:** entry 0 equals today's opening rows for every missing, nullish or in-range integer field. It differs only for hand-poked in-memory values (out-of-range, fractional, non-numeric): today they open raw and Apply clamps them; entry 0 shows them clamped (non-numeric: default). Other actors use the same rule.
- **Which actors:** `monsterActorIds(project)` minus the open actor (which is `self`). Not every actor: pickups and NPCs are outside the monster catalog (by its predicate, not by what they store), which the Forge hides. Stranded monsters are included, as in the catalog.
- **The source's `battle.level`:** irrelevant to the numbers (a flat value carries no growth to invert); it appears only in the label (`Snake · Lv 12`).

## §6. Q3 — Reward rows under a party seed

**Keep `self`'s current values.** A party member has no xp/gold to copy, and a reset would discard numbers the author set. The note says `Experience and Gold keep this monster’s values.` Under an actor seed all seven rows are filled.

## §7. Q5 — Reselecting mid-edit, and clearing

**Choosing any entry rewrites all seven rows from that entry's total `rows`**, typed rows included. The result is a pure function of the chosen entry: A then B equals B, and a party pick never leaves an actor's xp/gold behind. No dirty tracking; the note states what was filled.

**Clear is the first entry, `This monster’s current values`** (`self`). **Entry 0 is the one source of the modal's initial and reset rows** (decided here; formerly Q-F): the opening `picked`, the inputs' initial values and Clear all copy its `rows`; the modal keeps no second default table. The control sits above the rows; Cancel/Escape discards everything, as today. Overwriting typed edits is the price (Q-B).

The change handler writes `picked[key] = { ...row }` (never the options-list object) and sets each input's `.value` (inputs kept in a `key → { base, perLevel }` map). Programmatic `.value` writes fire no `change`, so `picked` is set explicitly; S2 checks both.

## §8. Q6 — Placement and wording

Between the hint paragraph and the first row: `field('Start from', <select>)`, then a `p.hint` note.

Options: `This monster’s current values`; group `Other monsters`: `Snake · Lv 12` (no level suffix when unset); group
`Party members`: the member's name. An empty `Other monsters` group is omitted; the Party group is never empty (an RPG
project always has a member: normalization supplies one, `shared/project.js:6745`, and the Character Forge offers removal only above one, `character.js:194`). Actor note: `Copied all seven numbers from Snake as Base (+ / level 0).`

**Widget:** no existing picker fits: `animationSelect` is animation-specific and the local `select()` has no
`<optgroup>`. Only this Forge uses it (`animationSelect` was shared because three did), so keep a small local builder in `monster.js`, fed by `monsterSeedSources`.

## §9. Q7 — Stale sources

**Read once, at open, into plain data, from `store.project`, before `showModal`.** Nothing reads the project at selection time, so selecting cannot throw and a label and its numbers cannot disagree.

- Not lazily from `store.project`: after a delete or undo/redo (`store.js:232-252`) an index can be out of range or name another actor, and the change handler is not a guarded post-await path.
- Not from the `actor` argument: undo may have replaced the project object it came from.

No new staleness path, **provided a pick never refreshes `revisionAtOpen`** (S6): `revision` moves on every commit (even a throwing mutator, `store.js:180-193`), undo, redo and open/close, so a profile edit, source deletion or undo after open makes the revision guard refuse Apply (`monster.js:406`) even if the author then picks a cached option. Strokes do not bump revision (`store.js:26-31`, `:203-221`) but change no value a seed caches. A seed reaches the store only as `picked → growth → planMonsterGrowth`, which re-clamps and re-diffs after the guards.

## §10. Q8 — Test plan

Unit file `test/unit/monsterseed.test.js` (new, no ROM; in-memory clones of `loadProject('sample-rpg')`); smoke steps extend `main/smoke.js`'s Derive section (`:13507-13617`, `:13640-13810`). "Catches" is a wrong implementation this test fails; "Still passes" is a *different* one it cannot see (the named test does).

**Fixture F** (rows atk/def/mp/gold/mag/mdef/xp; no default). Actors in order: `Slime`, the open monster: level 4, 7/5/3/11/2/6/13, hp 20; `Snake`: level 12, 21/17/9/33/5/8/70; `Ghoul`: damage 0 but named by an encounter group, no level, 3/6/2/9/1/4/8; `Potion`: damage 0, unreferenced. Party: `Rian`, no profile: atk 12 +2, def 9 +1, mp 6 +1, mag 4 +3, mdef 5 +2; `Mara`, linear.

**Oracle** (`profileStatAt`/`statAt`, cap 255; `k = L − 1`, early `floor((p·k·(28−k)+7)/14)`, late `floor((p·k²+7)/14)`; "seeded" is the monster's straight line):

| Shape | Source stat | L=1 | L=8 (k=7, unsaturated) | L=15 |
|---|---|---|---|---|
| linear | Rian atk 12 +2 | 12 | 12 + 2·7 = 26 | 12 + 28 = 40 |
| early | profile atk 10 +3 | 10 | curve 10 + `floor(448/14)` = 42; **seeded 10 + 3·7 = 31** | 52 |
| late | profile def 20 +2 | 20 | curve 20 + `floor(105/14)` = 27; **seeded 20 + 2·7 = 34** | 48 |
| saturating | Rian mag 99 +16 | 99 | 99 + 16·7 = 211 | `min(255, 99 + 224 = 323)` = 255; L=12: `min(255, 275)` = 255 |

| # | Test | Catches | Still passes |
|---|---|---|---|
| U1 | Rian: `rows` keys exactly atk/def/mp/mag/mdef with F's pairs (deepEqual) | invents xp/gold/hp; swaps def and atk; leaks an extra `shape` key | raw `baseX` read (U2) |
| U2 | Decoy `baseAtk` 99 +9, profile atk 10 +3 early assigned: atk `{10, 3}` | raw-field read (gives 99/9) | unguarded `growthProfiles[id]` (U3) |
| U3 | `profileId` 5, no profiles: the member's own pairs | throws, or zeros, on the dangling id | ignoring profiles entirely (U2) |
| U4 | Hand-poked member atk +40, mag +40, mp base 300: atk `perLevel` 32, mag 16, mp base 255 | no clamp (40 stays); `GROWTH_LIMITS` clamp (atk 16); one flat 32 (mag 32) | clamping party pairs only, not actors (U6a: xp 70000 → 65535) |
| U5 | Profile atk early +3, def late +2, mag linear +2, mdef early +0: `curves` = `[{atk, early}, {def, late}]` | lists by shape alone (adds mdef); never lists; names late as early | rows fitted rather than copied (U7) |
| U6a | Snake: seven rows = F's values, `perLevel` 0; a clone with xp 70000 → 65535 | omits xp/gold; returns defaults; no xp ceiling | `||` fallback (stored values are non-zero; U6c) |
| U6b | No `battle`, and `{ level: 12 }` only: 4/2/0/2/0/0/4 | no fallback (undefined); fallback 0 | `||` fallback (gives the same defaults here; U6c) |
| U6c | Stored atk 0, gold 0, xp 0 stay 0 | `||` fallback (4/2/4) | no fallback at all (U6b) |
| U6d | `{ atk: null, def: 5 }` and `{ atk: undefined }`: atk 4, def 5 | bare `clamp(battle[key])` (null → 0) | `||` fallback (null → 4 too; U6c) |
| U7 | `planMonsterGrowth` on Slime at L=1/8/15: linear 12/26/40; early 10/**31**/52; late 20/**34**/48; saturating 99/211/255 (L=12: 255) | wrong slot; fit to the monster's level (L=8 gives 45, not 31); endpoint fit `round((v₁₅−v₁)/14)` (99 → 255 is +11; L=8 = 176 ≠ 211) | wrong `curves` (U5) |
| U8 | Ids/groups/order only: `self`; Snake, Ghoul (id order; label order puts Ghoul first); Rian, Mara; no Potion, no second Slime | every-actor list; open actor twice; `filter(isMonsterActor)` (Ghoul absent); label sort | wrong label text (S8) |
| U9 | Slime xp 77, gold 33: Rian's rows hold all seven keys with xp 77, gold 33; `filled` = atk/def/mp/mag/mdef; Snake's `filled` is all seven | partial rows; xp/gold reset to defaults | wrong catalog filtering (U8) |
| U10 | Project JSON identical after both calls; mutating one returned row leaves the project, a second call's result and other entries (self's xp row inside Rian's) unchanged | mutates the project; row aliases project data; entries share one row object | an extra `shape` key in rows (U1) |

| # | Smoke step | Catches | Still passes |
|---|---|---|---|
| S1 | Open Slime: select shows `This monster’s current values`; Base 7/5/3/11/2/6/13, `+ / level` 0. Kept: a level-only actor (`battle: { level: 5 }`) shows 4/2/0/2/0/0/4 (Derive is disabled without a level, so no-`battle` is U6b's). New: `{ atk: null }` shows Attack 4 | control missing; default changed; null read as 0 | select present but unwired (S2, S3) |
| S2 | Pick Rian: five pairs shown = Rian's, xp/gold 13/11, note says they keep; Apply = one commit: atk 18, def 12, mp 9, mag 13, mdef 11 (L=4), xp/gold/hp/level untouched; one Undo restores | inputs set but `picked` stale (stored ≠ shown) or the reverse; xp/gold reset to 4/2 | reading Rian lazily at pick time (S6d) |
| S3 | Pick Snake (level 12 ≠ 4): Base 21/17/9/33/5/8/70, `+ / level` 0; Apply: stored equals them, level 4 and hp 20 unchanged, one undo entry, Undo restores Slime | actor option reusing self's or party rows; scaling by the source level | reselect not resetting (S4, S5) |
| S4 | Type Attack Base 61 and `+ / level` 5, pick Snake, then `current values`: all 14 inputs are Slime's 7/5/3/11/2/6/13 and 0s; then Apply: a strong no-op: full project, revision, dirty state, undo/redo contents unchanged | pick preserving typed rows; reset leaving them; reset to the hard-coded 4/2/0/2/0/0/4; a self/Clear branch that writes the inputs but leaves `picked` on Snake (Apply commits Snake's values) | Snake → Rian overlay (S5) |
| S5 | Pick Snake then Rian: xp 13, gold 11, all 14 inputs equal a fresh modal's straight Rian pick; then Apply: S2's five derived values, opening rewards 13/11, hp/level unchanged, one undo entry, Undo restores | overlay without reset (xp/gold stay 70/33); `picked` left on Snake after a second non-self pick | refreshing `revisionAtOpen` (S6) |
| S6 | Slime stays selected, Forge mounted; the seed would change Slime. (a) open → commit (Rian gets a profile) → pick Rian → Apply; (b) open → `store.undo()` (and undo, redo) → pick → Apply; (c) open → pick → commit → Apply; (d) open → pick Snake → delete Snake (`renumberActorDeletion`) → pick Snake's cached option, then Ghoul's: original numbers shown, no throw → Apply. Each ends in the toast `The project changed while this dialog was open — try again.` and `assertGuardStateUnchanged` taken after the intervening operation (a, b also with a Clear pick) | `revisionAtOpen = store.revision` on any pick, including Clear (a, b); lazy `store.project` reads, which show the shifted actor or throw (d) | dropping the selected-actor guard (existing `main/smoke.js:13703-13724`) |
| S7 | Profile P: atk early 10 +3, def late 20 +2, mdef early +0, assigned to Rian: note contains `Rian’s Attack grows as an Early bloomer`, `Defence grows as a Late bloomer`, `straight line`, never `Magic defence`; Mara's note has no `bloomer` | note always on or never; every shape named Early; stat or member missing; zero-growth stat named | missing `Experience and Gold keep` sentence (S2) |
| S8 | optgroups `Other monsters` (`Snake · Lv 12`, `Ghoul`) and `Party members` (`Rian`, `Mara`); no Potion, no `Lv` on Ghoul; no `Other monsters` once Snake and Ghoul are deleted | lists non-monsters; stranded Ghoul absent; `Lv` when unset; empty group shown | values not copied (S3) |

## §11. Phasing and cost

One slice: the helpers (`renderer/forges/monster/seed.js`), the modal edit, `monsterseed.test.js`, the smoke steps. No engine, generator, schema, fixture or `checkCapacity` change; a seeded `mag`/`mdef` flips the same gate hand-typing does (level-scaling §3.9).

## §12. Decisions (Chris, 2026-10-24)

- **Q-A Non-linear seeds:** copy and label (§4).
- **Q-B Typed edits on re-pick:** overwrite all seven rows.
- **Q-C Which actors:** monsters only (`monsterActorIds` minus the open actor).
- **Q-D Party reward rows:** party seeds keep this monster's xp/gold.
- **Q-E Wording:** the doc's wording stands: `Start from`, `Snake · Lv 12`, the Early/Late bloomer sentence.
- **Q-F Opening and reset rows:** entry 0 is the single source (§7).

## §13. Shipped

Built as one slice, uncommitted at the time of writing: `renderer/forges/monster/seed.js` (the helpers), `renderer/forges/monster/monster.js` (the picker), `test/unit/monsterseed.test.js` (U1-U10, 13 tests with U6a-d), `main/smoke.js` (S1-S8, 8 steps); `shared/` and `main/build/` are byte-identical to the prior commit. I2 implementation run `20261024-115713-all`: npm 4230/0/0 (4217 + 13), smoke 339 steps (331 + 8), Lua 42 OK, END 0. Final runs after the S7 and docs changes: `20261024-131415-npm` npm 4231/0/0 (the +1 is the `docs.test.js` pointer test for this doc) and `20261024-131450-smoke` 339 steps. The Lua 42 OK comes from the I2 run and was not rerun. Review: GO-with-nits; the one nit (S7 asserting the whole curve note) is closed.
