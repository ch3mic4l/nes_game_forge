# Design: the Monster Forge (ROADMAP item 14)

Scope, per the brief: a design round, not code — the Forge-boundary question (Q1, the one that
matters), monster level (Q2, recommend-or-defer), and where battle-side animation (Q3, shared with
item 13) should actually get settled. No source file was touched to produce this; every claim below
is checked against the tree as it stands, file and line named, the same discipline
`docs/design-magic.md` (item 13's own design round, the precedent this follows) holds itself to.
Where ROADMAP's own account of item 14 turned out to be incomplete rather than wrong, §1 says so.

**v2 note**: this revision folds in `handoff-next/monster-design-1-review1.md` in full. Both its
high findings were real (the actor-creation-state claim in old §2, and the membership/"Remove from
this list" mismatch) and are fixed below, along with all five mediums and the low. §8 has the
finding-by-finding changelog.

## §0. What I read

Everything v1 read (unchanged — see the original list: `ROADMAP.md` items 13/14, `CLAUDE.md`'s
single-writer-rule/battle-system/kernel-budget sections, `docs/design-magic.md` in full,
`shared/project.js`'s actor/limits/deletion machinery, `main/build/battletables.js` in full, the
relevant `engine/*.asm` files, `renderer/forges/sprite/battle.js` and `sprite.js`,
`renderer/forges/map/map.js`, `renderer/forges/items/items.js`, `renderer/app.js` in full, the
relevant `main/smoke.js` slices) plus, for this round: `renderer/store.js` in full (`commit`,
`open`, `undo`/`redo`, the absence of any `normalizeProject` call); `renderer/forges/sprite/sprite.js`
:705-718 (the Add-actor handler's exact pushed shape) and :748-766 again, closely, for the delete
sequence; `shared/eventrules.js` in full (`allCommands`/`liveCommands`/`isLive`/`projectEvents`,
their own header comments on which question each answers); `shared/project.js`'s
`battleFormationSlice` (:1001-1002), `mapEncounterFormation` (:1019-1022), `deriveItemEffect`
(:3563-3567), `normalizeRpg`/`defaultRpg` (:3453-3462, :2500-2508), and the `validateProject` findings
at :4480-4544 and :4600-4607; `engine/rpg.asm`'s `check_encounter`/`check_encounter_done` (:29-52);
`main/build/generate.js`'s per-actor `spriteTables` byte accounting (:1815) and `battleShortfallAdvice`
(`main/build/battletables.js`:834-923, the actor-removal lever specifically); `test/unit/boundtiles.test.js`
:397-417 (the worktree-vs-same-tree proof-shape precedent); `test/unit/routes.test.js` (the
same-tree byte-identical-ROM comparison shape).

## §1. Inventory — what already exists, verified against the code

Unchanged from v1 — review confirmed all ten rows sound. Every field ROADMAP's "Already exists"
paragraph names is real and behaves as described. Verified directly, not taken on the roadmap's
word:

| Stat | Schema field | Compiled to | Authored today at |
|---|---|---|---|
| HP | `actor.hp` (`normalizeActor`, project.js:3333) | `mon_hp` (battletables.js:111) | Sprite Forge, general Actor panel (sprite.js:810-818) |
| MP | `actor.battle.mp` (:3344) | `mon_mp` (:112) | Sprite Forge, battle sub-page (battle.js:74) |
| Attack/Defence/Accuracy/Evasion/Speed | `battle.atk`/`def`/`acc`/`eva`/`speed` (:3339-3343) | `mon_atk`/`mon_def`/`mon_acc`/`mon_eva`/`mon_speed` (:113-117) | battle.js:67-73 |
| XP/Gold | `battle.xp`/`gold` (:3345-3346) | `mon_xp_lo`/`hi`/`mon_gold` (:118-120) | battle.js:77-78 |
| Weak/Resist | `battle.weak`/`strong`, one `ELEMENTS` id each (:3347-3348) | `mon_weak`/`mon_strong` (:121-122) | battle.js:81-82 |
| Cast spell | `battle.spellId`, `null` = swing-only (:3372-3373) | `mon_spell`, `$FF` for null or a stale id (:157-159) | battle.js:83-96 |
| Drop | `battle.drop` (item id, `NO_ITEM`), `dropPct` (:3361-3367) | `mon_drop`/`mon_drop_pct` (:137-140) | battle.js:98-111 |
| Battle art | `battle.battleTile`/`battleW`/`battleH`/`battlePalette` (:3376-3382) | `mon_tile`/`mon_w`/`mon_h`/`mon_attr` (:150-163) | battle.js:114-127, the `artPicker` sheet |
| "Is this a monster" | `actor.damage > 0` (`isMonsterActor`, :403) — **not a stored monster flag** | drives `entity_contact`'s RPG branch and `battle.js:45`'s own hint text; does **not** gate `mon_*` emission (§7, trap 1) | Sprite Forge, general Actor panel ("Contact damage") |
| Overworld sprites/animations | `project.sprites` (metasprites, animations, `actor.anims`) | unchanged | Sprite Forge, unconditionally |

**One field ROADMAP's list omits, still real and still compiled**: `battle.heal` (:3369) →
`mon_heal` (battletables.js:146). It is the pre-item-schema "this actor healed you when eaten/used"
number. Phase 4c (item 5) moved its only editing surface to the Items Forge's `effect.amount` field
and deleted the UI control for it entirely — `battleSection`'s own hint text at battle.js:64 says so
("Items — including what they heal or damage for — are authored in the Items Forge now"). The
`heal` clamp and the `mon_heal` emission are both still live: `mon_heal` is what `item_chosen`
(`engine/battleturn.asm`) reads for the `ITEMS_ENABLED`-false path, where the bag still holds legacy
actor ids (battletables.js:21-32, 141-146's own header comments). **It is also a live migration
source outside that path entirely** — see §2's boundary rule, corrected below, for why the field
does not simply "move" with the rest of `battle.*`.

Everything else in ROADMAP's "Already exists" account matches the code exactly: the battle-tile
16-tile-wide sheet and 4x4 attribute-cell anchoring (`draw_battle_attr`'s own header comment,
engine/battle.asm:419-421), the `battleArtTiles = 12` cap (RPG_LIMITS, project.js:984), and the
metasprite-fallback ("`mon_tile = $FF`", `draw_monsters`, engine/battle.asm:373-376). **I checked all
of it and found no claim that is wrong or stale** — only the one omission above.

## §2. Q1 — the Forge boundary

**The rule: a field stays on the Sprite Forge if it means something outside a battle; it moves to
the Monster Forge if it means nothing outside one — with one field, `heal`, that fits neither side
and moves nowhere.** This is not a line drawn by eye — it is checked against what actually consumes
each field:

- `actor.hp` compiles to **two** tables, not one: `mon_hp` (RPG battle, engine/battle.asm:219) *and*
  `actor_hp` → `ent_hp` (engine/entities.asm:77-78, "hits left, seeded from actor_hp at spawn"),
  which `do_attack` (engine/input.asm:202-224, bound to `ACT_ATTACK`, a Controller-Forge action
  available in *every* game type) decrements on every hit and checks for the kill. An action
  project's own enemies use exactly this path — `hp` is genuinely dual-purpose, which is why it
  stays on the general Actor panel rather than moving with the rest of the battle stats. This
  resolves the inconsistency the brief calls out directly: `hp`'s placement on the general panel was
  already correct, for a reason `battle.mp`'s placement doesn't share — `mon_mp` has no second,
  action-mode consumer at all.
- `actor.damage` is the same shape: contact damage to the player in an action project, and *purely*
  the hostility switch (`isMonsterActor`) in an RPG — `battle.atk`, not `damage`, decides how hard a
  monster hits (CLAUDE.md's own "Heal/Damage" passage states this split explicitly). Dual-purpose
  again, so it stays on the general panel too.
- Everything else under `actor.battle.*` — atk/def/acc/eva/speed/mp/xp/gold/weak/strong/spellId/
  drop/dropPct/battleTile/battleW/battleH/battlePalette — is a **currently author-facing** control
  with no consumer outside `BATTLE_ENABLED` engine code. This is exactly the set `battleSection`
  already gates on `store.project.project.gameType === 'rpg'` (sprite.js:874). All of it moves to
  the Monster Forge.
- **`heal` is the exception, and v1's "no consumer outside `BATTLE_ENABLED`" claim was false for it
  specifically** — review finding, verified myself before writing this: `deriveItemEffect`
  (project.js:3563-3567) reads `actor.battle.heal` as `normalizeItem`/`migrateItemsFromActors`'s
  one-time migration source for an item's `effect`. That runs during ordinary project
  normalization — on every load, for every game type — with no `gameType`/`BATTLE_ENABLED` gate at
  all; it is schema-migration logic, not engine-gated code. So `heal` is read outside the boundary
  this section's rule is built on, and neither "stays on Sprite" nor "moves to Monster" is correct
  for it: it is `mon_heal`'s data source (legacy `ITEMS_ENABLED`-false path, §1) and
  `deriveItemEffect`'s migration source (any game type, any time), has had no author-facing control
  anywhere since phase 4c, and this design adds one **nowhere** — not the Monster Forge, not the
  Sprite Forge. §7 trap 3 is what happens if an implementer "cleans it up" instead of leaving it be.

**Actor state is not as uniform as v1 claimed — this was High finding 1, confirmed by one grep, and
here is the fix.** v1 said "an actor with no battle record is not a state that exists," reasoning
from `normalizeActor` alone. That is false for any actor added in the same session and not yet
saved-and-reloaded: the Sprite Forge's own Add-actor handler (sprite.js:705-718) pushes
`{id, name, behavior, speed, hp, anims}` — no `battle`, no `damage` — and `renderer/store.js`'s
`commit`/`open` (read in full for this round) never call `normalizeProject` or `normalizeActor` at
all; nothing fills either field in until the next save/reload passes through
`main/project-io.js`'s `loadProject`. An author can add an actor, raise its Contact damage above
zero on the same general panel (making `isMonsterActor` true immediately), and open the Monster
Forge on it before any normalization has ever run.

**The invariant this design commits to, and why**: every read of `actor.battle` anywhere in the
Monster Forge — the membership calculation (below), the detail-pane render, and the mutator — goes
through `actor.battle ?? {}` with a per-field `?? default` fallback, never an unguarded
`actor.battle.field` access. This is not new: it is the exact discipline `battleSection` (battle.js:36,
`const battle = actor.battle ?? {}`), `battletables.js` (:109, `column((actor) => pick(actor.battle ?? {}, actor))`)
and `project.js:4487` (`const { battleTile, battleW = 4, battleH = 4 } = actor.battle ?? {}`) already
apply — a fourth call site inheriting a proven pattern, not a new one. The Monster Forge's own
`set()` mutator is `battleSection`'s own (battle.js:37-43: `target.battle = { ...target.battle,
[key]: value }`), moved verbatim, and it is already safe for this case: spreading `undefined`
produces `{}`, so the first edit to a battle-record-less actor creates a `battle` object with just
the one changed key, and every other field keeps reading its own default (`battle.def ?? 2`, etc.)
until it is touched or the project is next normalized — at which point `normalizeActor` fills the
rest in with the *identical* defaults the partial object was already reading, so nothing observably
changes at that boundary either.

**I considered fixing the shared creation path instead (the brief's other option: give
`sprites.js`'s Add handler the full normalized shape) and am not recommending it, for a reason
specific to blast radius.** Two things point away from it: first, it is one shared path several
other Forges and `main/smoke.js`'s own actor-add step depend on, and changing what it pushes is a
change this design would be making *outside* the Monster Forge for the Monster Forge's benefit —
exactly the kind of footprint a phase 1 that is supposed to be "extraction, not a rewrite" should
avoid unless nothing smaller closes the gap. Second, and more directly: it wouldn't even fully close
the gap on its own. The defensive-read discipline above is required regardless — for any actor added
by a build that predates whatever fix ships here, for a session already in progress when it ships,
and for the identical `actor.battle ?? {}` reads three *other* call sites already need for reasons
that have nothing to do with actor creation timing. Since the local fix is necessary either way, the
creation-path change buys nothing this design doesn't already have to do, for a real cost outside
this Forge's own files. **Phase 1 must include a test**: add an actor, give it contact damage, open
the Monster Forge on it in the same session without saving, and confirm the detail pane shows the
correct defaults and the first edit produces a `battle` object that normalizes identically to what
`normalizeActor` would have produced from nothing.

**The monster catalog is one shared, pure function — this was High finding 2, and the fix is a
precise specification, not a rename alone.** v1 defined membership as "the union of hostile actors
and actor ids named by a map encounter or a `battle` command" without saying which of several real
choices that means, and then proposed a "Remove from this list" action that, under that same union
rule, does not remove a referenced actor from the list at all — the button's own label promised a
result its mutation cannot deliver. Both are fixed together, because the fix to one constrains the
other.

**`monsterActorIds(project)`** — a new export in `shared/project.js`, beside `isMonsterActor`,
`battleFormationSlice` and `mapEncounterFormation` (the functions it composes), is the single
definition. It returns every actor id that either reads as a monster right now, or is named
*anywhere authored* as one — an array of actor ids, ascending, each guaranteed to index a real
entry in `project.sprites.actors`:

```js
export function monsterActorIds(project) {
  const actors = project.sprites?.actors ?? [];
  const inRange = (id) => Number.isInteger(id) && id >= 0 && id < actors.length;
  const ids = new Set();
  actors.forEach((actor, id) => { if (isMonsterActor(actor)) ids.add(id); });
  for (const map of project.maps ?? []) {
    for (const id of map.encounters?.actorIds ?? []) if (inRange(id)) ids.add(id);
  }
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op === 'battle') {
          for (const id of command.monsters ?? []) if (inRange(id)) ids.add(id);
        }
      }
    }
  }
  return [...ids].sort((a, b) => a - b);
}
```

Every specific choice the review asked for, decided and reasoned:

- **Authored mentions, not live commands, and not "what actually compiles."** `allCommands`
  (`shared/eventrules.js:105-118`), not `liveCommands` (:185-...). CLAUDE.md's own event-system
  section draws exactly this line and names which question each answers: `allCommands` is "what is
  mentioned" (a switched-off branch's contents included), `liveCommands` is "what the compiler would
  actually emit." The membership question here is the first one, deliberately: a `battle` command
  sitting inside a currently-disabled branch still names a real actor an author may re-enable at any
  time, and hiding that actor from the one Forge that edits monster stats the moment its reference
  goes dormant is the identical failure trap 1 (below) is about, one level of nesting deeper.
  `renumberActorDeletion` already makes this exact choice for the exact same reason
  (project.js:2239-2249 walks `allCommands`, not `liveCommands`, for its own actor-reference sweep) —
  this function follows established precedent, not a new one.
- **Common events**: covered for free. `projectEvents` (`shared/eventrules.js:249-260`) already
  yields both placed-entity events and `project.commonEvents` entries; walking it once covers both.
- **Nested branch/choice/route commands**: covered for free. `allCommands` already recurses into a
  branch's `then`/`else`, a choice option's `commands`, and a route's `legs` (:105-118) — no
  additional traversal is needed here.
- **Over-cap formation entries**: **included, deliberately, not truncated.** `battleFormationSlice`
  (project.js:1001-1002) truncates a `battle` command's `monsters` to
  `RPG_LIMITS.monstersPerBattle` (4) *for compilation* — but a fifth, authored-and-truncated-away
  monster id is still real authored data naming a real actor, exactly the "authored mention" this
  function tracks. `monsterActorIds` reads `command.monsters` raw, not through
  `battleFormationSlice`, for the same reason it uses `allCommands` over `liveCommands`: the concern
  is never hiding an actor an author is looking at, not deciding what the ROM will run. (The Monster
  Forge's own detail pane may still want to flag such an actor as "over-cap in this formation" —
  that is a UI refinement for the implementation slice, not a membership decision this function
  needs to make.)
- **Map encounter normalization, and zero-rate maps**: `map.encounters.actorIds` is read raw here
  too, not through `mapEncounterFormation` (project.js:1019-1022), for the identical reason — that
  function trims to ids that still resolve *and* slices to `RPG_LIMITS.encounterActors`, which is
  the "what would the ROM actually place" question, not "what is authored." And a rate-zero map's
  table needs no special case at all: `check_encounter_done` (engine/rpg.asm:29-52, specifically the
  `beq check_encounter_done ; this map has no wandering monsters` branch at :37) confirms the engine
  simply never rolls a wandering encounter for that map, but the Map Forge's own encounter-table UI
  (map.js:1719-1734) shows and lets an author edit `actorIds` regardless of `rate` — the data is
  real, visible, and battle-testable (`battleTestSection`, map.js:1790-1793) whether or not the
  engine will ever roll it at runtime. Membership follows the UI's own standard, not the engine's:
  an id sitting in a rate-zero map's table counts.

**The action is renamed to what it does, and the button no longer promises what it cannot
deliver.** "Remove from this list" becomes **"Make harmless"**: it clears `damage` to zero and
nothing else. Its own hint text says explicitly that an actor still named by a map's encounter table
or a `battle` command **stays listed here, marked stranded** (the same `stranded` treatment
`battleSettings` already gives a formation slot whose actor "no longer reads as a monster,"
map.js:1752-1758) — **because authored data still names it, not because the ROM necessarily still
fights it.** Round-2 review correctly caught that the two are not the same claim: `monsterActorIds`
deliberately includes dormant references (a `battle` command inside a currently-disabled branch, an
id sitting in a rate-zero map's table) and over-cap ones (a fifth formation entry
`battleFormationSlice` truncates away) precisely because they are real, editable data — but none of
those compiles into an actual fight today, so "the ROM still fights it" would be false for exactly
the cases this design chose to keep visible. The hint text says the accurate, weaker thing: the
reference is why the actor remains listed, whether or not that reference currently reaches the ROM.
Distinguishing a *live* stranded reference (would fight today) from a *dormant/over-cap* one (named,
but currently inert) in the UI — a label or a second badge — is a reasonable refinement; this design
does not spec it further, since either way the membership answer and the button's own honesty are
already correct without it. **This design does not build a reference-purging transaction** (clearing
every encounter-table slot and `battle`-command entry that names the actor, project-wide, so the
actor genuinely leaves the list) — that mutation's own blast radius is exactly Trap 2's shape, for
references instead of the actor itself, and nothing in item 14's ask requires it. If a future round
wants "truly remove this actor from every fight in the project," design that as its own transaction
against `monsterActorIds`'s own membership sources, not as a hidden side effect of "Make harmless."

**Selection and lifecycle — the identity, re-derivation and fallback rules this Forge is held to,
matching the contract every other Forge already keeps.** Selection is by **actor id**
(`state.selectedActorId`), never an array index into the catalog — the catalog's own order and
membership can both change between renders (an edit elsewhere adds or removes a monster from the
union), which an index survives silently wrong and an id does not. On every render: re-derive
`monsterActorIds(store.project)` fresh (never cached across renders — an external commit, an undo,
or a redo can change it while this Forge is mounted, the same reason `battleSettings`'s own
`hostile` list is recomputed every render rather than stored), and re-read the live actor object at
`store.project.sprites.actors[state.selectedActorId]` fresh alongside it — undo/redo
(`renderer/store.js:103-121`) replaces `store.project` with a `structuredClone`, so any object
reference held across a render is stale by construction, exactly the reason Items Forge's own
`item = () => items()[state.selected] ?? null` re-derives on every call rather than storing the
object. **Fallback**: if `state.selectedActorId` no longer resolves to a real actor, or that actor no
longer appears in `monsterActorIds`'s result, select the first id the catalog now returns, or show
an empty-catalog placeholder if it returns none — the same shape Items Forge's own
`if (state.selected >= items().length) state.selected = Math.max(0, items().length - 1)` guard
applies, adapted from index-bounds to set-membership. The mounted module returns
`{ onProjectChange: render }`, the contract every other Forge (`Items`, `Magic`, `Sprite`) already
implements, so undo, redo, and any other Forge's own commit all reach this one the normal way.

**Cross-links: a real navigation contract, in phase 1 — bounded in both lifetime and identity, not
the additive-looking-but-unsafe sketch v2 shipped.** v1 called the Monster ↔ Sprite links "the
identical shape" to Party → Magic's own "Manage spells in the Magic Forge →" button. Checked against
the code and it is not: `app.goTo` (renderer/app.js:150, `goTo: (id) => selectForge(id)`) takes
**only a forge id**. Party → Magic needs nothing more, because Magic Forge is a flat catalog with no
per-member selection to preserve. Monster ↔ Sprite is a different shape: both directions need to
land on a **specific actor**, and Sprite Forge's own `mount()` (sprite.js:27-44) creates a fresh
`state` every time, defaulting `state.tab = 'metasprites'` and `state.actor = 0` unconditionally — so
a bare `app.goTo('sprite')` from the Monster Forge would not land back on the Actors tab, let alone
the actor just being edited.

v2's own fix for this — a single unaddressed `pendingContext` slot plus `consumeContext()` — was
correctly rejected by round-2 review, on two independent grounds re-verified here:

- **Lifetime.** `selectForge` (renderer/app.js:230 onward) is asynchronous — it awaits `entry.load()`
  (a dynamic `import()`) before mounting — and nothing in v2's own sketch cleared `pendingContext` on
  either early return (`!store.isOpen`, an unknown `entry` — :231,233), the availability redirect to
  `'tile'` (:234-245), a superseded selection (a second `selectForge` call finishing first — the
  exact race `selectionToken` already exists to catch, :249,256,260), a load failure (the `catch`
  block), or a target Forge that simply never calls `consumeContext()`. Worse, a rail click calls
  `selectForge(entry.id)` **directly** (:221), bypassing `goTo` and its slot entirely, so it would not
  even overwrite a stale slot with `null`. A slot with no owner and no expiry can be read by a mount
  that has nothing to do with the navigation that wrote it.
- **Identity.** Even a context that reaches the *right* mount can name the *wrong* actor. Actor ids
  are positional, not identities: `renumberActorDeletion` exists at all because deleting actor 4
  restamps every later actor down by one (sprite.js:748-766's own
  `.forEach((entry, position) => (entry.id = position))`), so what was actor 5 becomes actor 4 the
  instant actor 4 is deleted. CLAUDE.md's own single-writer-rule section states the general rule this
  is one case of — "a screen or an actor's numeric position is not its identity." A context holding
  only `{ actorId: 4 }`, captured before the `await`, still passes a plain in-range check after that
  delete, and now names a different actor than the link was drawn from — which a bounds check alone
  cannot detect, so it cannot implement the "falls back rather than lands on the wrong actor" test
  this design already commits phase 1 to.

**The fix binds context to one target and one request, reusing `selectionToken` rather than a second
mechanism, plus one small addition to `renderer/store.js` for the identity half.**
`selectionToken` (renderer/app.js:124) is already "one per `selectForge` call... only the call still
holding the current token after its own await is allowed to touch `dom.stage`/`mounted`/status" — the
exact request identity this contract needs, so it is reused, not duplicated:

```js
// renderer/app.js
let pendingRequest = null; // { targetId, context, atRevision } -- written by goTo(), claimed once
let activeContext = null;  // { token, context } -- bound to whichever request is currently mounting

// on the `app` object:
goTo(id, context = null) {
  pendingRequest = { targetId: id, context, atRevision: store.revision };
  return selectForge(id);
},
consumeContext() {
  if (!activeContext || activeContext.token !== selectionToken) return null;
  const context = activeContext.context;
  activeContext = null;
  return context;
}
```

```js
// selectForge(id), with the new lines marked
async function selectForge(id) {
  const incoming = pendingRequest;           // + claimed unconditionally, before either early return
  pendingRequest = null;                     // +
  if (!store.isOpen) return;
  let entry = FORGES.find((forge) => forge.id === id);
  if (!entry) return;
  if (!isForgeAvailable(entry, store.project)) {
    id = 'tile';
    entry = FORGES.find((forge) => forge.id === id);
  }
  activeForgeId = id;
  renderRail();

  const token = ++selectionToken;
  const candidateContext = incoming && incoming.targetId === id ? incoming : null; // +
  mounted?.destroy?.();
  mounted = null;
  clear(dom.stage);

  try {
    const module = await entry.load();
    if (token !== selectionToken) return; // superseded, unchanged
    // + bound only now, after the async gap: a store mutation during the
    // + load invalidates any actor id the context named.
    activeContext =
      candidateContext && candidateContext.atRevision === store.revision
        ? { token, context: candidateContext.context }
        : null;
    mounted = module.mount(dom.stage, app) ?? null;
    if (activeContext?.token === token) activeContext = null; // + consumed, or never going to be
    app.setStatus(entry.title, '');
  } catch (error) {
    if (activeContext?.token === token) activeContext = null; // +
    if (token !== selectionToken) return;
    // ...unchanged
  }
}
```

Every clearing point named in the review is satisfied by exactly one of these lines, not by
convention or by hoping a future call cleans up:

- **Both early returns**: `pendingRequest` is claimed (set to `null`) unconditionally at the very
  top, before either `if` — so a request that dies at an early return can never be read by a *later*,
  unrelated `selectForge` call; the slot is already empty for it.
- **The availability redirect**: `id` has already been rewritten to `'tile'` by the time
  `candidateContext` is computed, so `incoming.targetId === id` fails for any context aimed at
  `'monster'` or `'sprite'`, and `candidateContext` (and later `activeContext`) is `null`.
- **A superseded selection**: the newer call takes the next token and, in its own prologue, claims
  whatever `pendingRequest` currently holds and later assigns its *own* `activeContext` — overwriting
  the older call's binding outright, before the older call's `await` has even resolved. When the
  older call's `entry.load()` finally settles and hits `token !== selectionToken` (already existing,
  unchanged), it returns before `activeContext` is ever touched or `mount()` is ever called — nothing
  is bound or consumed on its behalf.
- **A load failure**: `entry.load()` throwing skips straight to `catch`, which never reached the
  `activeContext =` assignment at all for a load failure — there is nothing to clear in that specific
  case, since it never became active. The `catch`-block clear line covers the one path *after*
  binding that can still fail: `module.mount()` itself throwing, once `activeContext` has already
  been set for this token.
- **Not consumed**: the post-`mount()` line clears `activeContext` unconditionally for this call's
  own token, whether or not the mounted Forge called `consumeContext()`.
- **A store mutation during the async gap (the identity half)**: `atRevision`, captured in `goTo()`
  in the same synchronous tick that calls `selectForge` (nothing can run between them — neither
  contains an `await` before that point), is compared against `store.revision` again only *after*
  `entry.load()` resolves. If a commit, undo or redo happened while the dynamic import was in flight,
  `store.revision` has moved and the context is dropped — the exact mechanism round-2 review named
  ("capture a store/project revision and discard the context if it changed during the async load").

**`store.revision` does not exist today; phase 1 must add it.** Checked `renderer/store.js` in full —
nothing tracks a generation number currently, so this is a real, small, additive requirement on that
file, not something the implementer can skip or invent differently: a counter (exposed as a plain
getter, the same shape `isOpen` already is) bumped inside `commit()`, `undo()`, `redo()`, `open()` and
`close()` — every method that replaces or mutates `this.project` for this store. `beginStroke()`/
`touch()`/`endStroke()`/`cancelStroke()` are deliberately excluded: every actor deletion or
renumbering in this codebase goes through exactly one `commit()` call (sprite.js's own delete-actor
handler wraps its whole splice-and-renumber sequence in one `store.commit('Delete actor', ...)`),
never a stroke, and a stroke's own `touch()` calls fire on every pointer-move frame of an unrelated
drag — bumping revision there would make the identity check trip constantly for edits that could
never renumber an actor in the first place, without adding any real protection.

**Once bound this way, the rest of the contract is as v2 described.** A target Forge's own
`mount(container, app)` calls `app.consumeContext()` once, at the top, and uses it only if it
recognizes the shape it wants (`{ tab: 'actors', actorId }` for Sprite Forge; `{ actorId }` for the
new Monster Forge) — falling back to its ordinary default (`state.actor = 0` / the catalog's first
entry) whenever `consumeContext()` returns `null`, for any of the reasons above or simply because
nothing called `goTo` with a context at all. No existing Forge's `mount(container, app)` signature
changes; a Forge that never calls `consumeContext()` behaves exactly as it does today. This closes
the gap in phase 1 because, without it, the boundary split in this section creates real, daily
friction (an author bouncing between one monster's HP on Sprite and its stats on Monster has to
re-find the actor by hand every time), which undercuts the point of drawing the boundary well in the
first place.

**Narrowing v1's own "phase 1 delivers all of item 14 except level and animation" claim.** That is
only true once the deep-link above ships — without contextual access back to `hp` and the overworld
sprite/animation controls that correctly stay on Sprite Forge (§2's own rule), an author editing a
monster is one hop away from data this same section says belongs elsewhere, with no way to follow
that hop directly. With the deep-link, the claim holds; phase 1 (§6) includes it for that reason,
not as an optional nicety.

**`renderer/forges/sprite/battle.js` shrinks, it does not empty out.** `battleSection` and its
`artPicker` helper (lines 35-183, the monster half) move to the new Monster Forge module in full,
adjusted only for the `actor.battle ?? {}` invariant already stated above (no behavior change,
since that is already what the moved code does). `partyPanel` (lines 186-354, the party half)
stays — party members are not actors and have nothing to do with this boundary. The file goes from
355 lines to roughly the party half alone (~170 lines); `sprite.js` drops its `battleSection` import
and its one call site (sprite.js:875), replacing it with the cross-link button above.

**Deletion: none of the three existing shapes applies directly, and that is itself the answer.**
`renumberActorDeletion`/`renumberItemDeletion`/`renumberSpellDeletion` all exist because their
subject has its own id space that other records reference by number. A monster has no such space —
it *is* an actor id. So "delete a monster" is not a new renumbering problem; it is one of two
existing, differently-scoped operations, and the Monster Forge has to pick which one its own button
means:

1. **"Make harmless"** (above) — clear `damage` to 0. Non-destructive: the actor, its sprites, its
   animations, its placements and its (now-inert-in-name-only, still-editable) battle stats all
   survive untouched. No renumbering of anything, because nothing was removed from any array.
2. **"Delete the actor"** — the real, destructive operation Sprite Forge's own delete button already
   performs (sprite.js:748-766): splice `project.sprites.actors`, re-stamp every remaining actor's
   `id` by position, strip and renumber every map's `screen.entities` referencing it, *then* call
   `renumberActorDeletion` for the items/encounters/events/battle-command-formation references.
   `renumberActorDeletion`'s own header comment is explicit that it is not a complete delete on its
   own: **"Placed actors are renumbered separately, inline where they are deleted — this only ever
   needs to run alongside that, never instead of it"** (project.js:2211-2212). A Monster Forge delete
   button that only calls `renumberActorDeletion` — because that is the actor-space sibling of the
   `renumberItemDeletion`/`renumberSpellDeletion` calls its own list-detail UI otherwise mirrors —
   would leave every placed copy of that monster on every map dangling. See §7 trap 2.

This design recommends **shipping (1) only, in phase 1** (§6). A genuine delete-actor button is not
withheld out of caution alone — it would need to reproduce a five-step sequence that today exists in
exactly one place (sprite.js), which is a second-caller-drift risk this document is not willing to
accept inside the same phase that first extracts the Forge. If a later phase wants one, extracting
sprite.js's own sequence into a shared `deleteActorCore` (the same "one body, not two" shape
CLAUDE.md documents for the map-reorganization cores) is the prerequisite, not a Monster-Forge-local
copy of it.

**Registry: works with zero new mechanism for availability itself, confirmed rather than
assumed — but the in-place `gameType` question needs its own answer, below.** A `{ id: 'monster',
gameTypes: ['rpg'], ... }` entry in `FORGES` (renderer/app.js:9-87) is the registry change.
`app.forgeIds` (:164-166), `renderRail` (:208-228) and `selectForge`'s stale-`activeForgeId` fallback
(:230-247) all read through the one `isForgeAvailable` predicate (:97) already, exactly the way the
Magic Forge entry proved out. `main/smoke.js`'s `visitEveryForge` (:84-104) reads
`window.__app.forgeIds` generically and needs no change either. What a later implementation slice
*should* add, mirroring the Magic Forge's own coverage exactly: a positive assertion (`forgeIds`
includes `'monster'` for an RPG project, main/smoke.js ~:4188-4192's shape) and a negative one
(excluded, and absent from the rendered rail, for an action project, ~:2781-2789's shape).

**One correction v1 owed and didn't make**: `renderer/app.js`'s own comments describing the Magic
Forge as *the* `gameTypes` entry (e.g. main/smoke.js:90's "Magic Forge (item 13, phase 3) is
conditional on gameType" phrasing, and any equivalent in app.js itself) become false the moment
Monster becomes a second one — a comment sweep, not a functional change, but a real one this design
should not leave for the implementer to notice by accident.

**The in-place `gameType` question, settled directly rather than left as a risk to design
around.** Checked whether this application can mutate `project.project.gameType` on an
already-open project at all: it cannot. `gameType` is set exactly once, at project creation
(`chooseGameType()`/`createProjectAt`, app.js:359-364 and main/project-io.js:234-240, `main/ipc.js`'s
own `project:create` handler), and `normalizeProject`'s own gameType line (project.js:3753-3760)
only *validates* whatever was loaded against `GAME_TYPES` — it never derives a new value from a live
user action. A grep across every renderer and main file for an assignment to
`project.project.gameType` (or `raw.project.gameType`) finds nothing outside those two creation-time
sites. There is no menu item, form field, or Build-panel control that changes it once a project
exists. **So the scenario the review's own finding describes — Monster Forge mounted, `gameType`
mutated in place, rail and mounted Forge going stale — cannot occur, by the application's own
contract, not merely by convention.** The one real path that *does* change which project is open —
closing one project and opening a different one, of a different game type, via `store.open` — is
already handled: `store.subscribe`'s `'open'` handler (app.js:443-445) calls `selectForge(activeForgeId)`
unconditionally on every open, which re-runs `isForgeAvailable` and falls back to `'tile'` if the
newly-opened project can't show whatever was active. No code change is needed for this finding; the
comment sweep two paragraphs up is the only actionable item it leaves.

## §3. Q2 — monster level

**Recommendation, unchanged in conclusion, corrected in argument: ship display-only level metadata
now (phase 2); do not build a scaling or curve mechanism (deferred, with the real cost stated, not a
false zero-cost one).**

The party's own level is genuinely runtime state: `pc_level` is one live RAM byte per member
(engine/constants.asm:492), written by `battleturn.asm:954` on level-up, and every stat the engine
reads for a given member is looked up **at that runtime level** against a full precomputed table —
`pc_hp_at`/`pc_mp_at`/`pc_atk_at`/`pc_def_at`, one row per level per member (battletables.js:250-253,
via `statAt`/:83 and `xpCurve`/:72). That table exists because the *same* party member's level
changes over the course of a playthrough, and the engine has to be able to look up whichever level it
currently is. A monster has nothing analogous: `mon_hp`/`mon_atk`/etc. are one flat value per actor
id, selected once, at author time — nothing in the engine ever asks "what level is this monster
encounter."

**v1 said duplicating an actor to get a tougher variant costs "zero new schema and zero capacity
risk." That was false, and I re-measured the real number myself rather than adopting the review's
figure.** A duplicated actor costs bytes in two places, both real and both counted directly against
the emitting code, not estimated:

- **`main/build/generate.js`'s `spriteTables()` (:3087-3110)**, kernel-lo, every game type: one byte
  each for `actor_behavior`, `actor_speed`, `actor_hp`, `actor_damage`, plus four bytes of
  `actor_anim_dir` (one per facing) — **8 bytes**, and this is not my own count alone:
  `generate.js:1815`'s own capacity-model comment says so verbatim, `8 * Math.max(1, actors.length);
  // behavior, speed, hp, damage, 4 anim slots`. Kernel-lo is the tightly-margined 8,192-byte region
  CLAUDE.md's own kernel-budget section documents `KERNEL_SLACK = 20` against — 8 bytes there is
  real money, not noise.
- **`main/build/battletables.js`'s `battleTables()` (:97-164)**, the banked battle region, RPG
  projects only: 20 one-byte columns per actor (`mon_hp`/`mp`/`atk`/`def`/`acc`/`eva`/`speed`/
  `xp_lo`/`xp_hi`/`gold`/`weak`/`strong`/`drop`/`drop_pct`/`heal`/`tile`/`w`/`h`/`spell`/`attr` —
  counted directly from the file, line by line) plus one `NAME_LIMIT`-padded `mon_name` block
  (10 bytes, `RPG_LIMITS.nameLength`) — **30 bytes**.

**Total: 8 + 30 = 38 bytes for a duplicated actor in an RPG project** — independently re-derived,
and it matches the review's own figure exactly. This is not a hypothetical cost either:
`battleShortfallAdvice` (battletables.js:834-923) already treats "fewer actors" as one of its own
real byte-recovery levers when a project overflows the banked region (:836-841,
`reduce: (draft, k) => draft.sprites.actors.splice(...)`, `describe: (k) => 'removing ... actors in
the Sprite Forge'`), and its own no-single-fix message (:919-923) lists "fewer actors" first among
the combination an author needs. Removing actors is a real capacity lever *today*, which is the
direct proof that adding one is a real capacity cost, not a free operation.

**The Phase 2/3 separation survives this correction; the argument for it changes, and — per round-2
review — does not overreach a second time.** 38 bytes is real but small and, importantly, **an
opt-in, per-use cost**: an author who never places a second variant never pays it, and one who does
pays it once, in the one region `battleShortfallAdvice` already prices reductions against. A level
parameter added naively to every encounter-table slot and every `battle`-command formation entry —
the shape a first implementation of a runtime scaling mechanism would most likely reach for — *would*
cost bytes in every project whether or not it ever sets a non-default level, the same eager-layout
tax `mon_*`'s own unconditional per-actor columns already impose today. But that is a cost of one
representative, easiest-to-build layout, not an established property of "a scaling mechanism" in
general — a later design could gate that field's emission on whether any encounter/formation entry
actually uses a non-default level, the same way `projectUsesItems`/`ITEMS_ENABLED` already gate a
whole table family on whether a project uses items at all. This design does not need that stronger,
harder-to-establish claim to justify deferring the mechanism: the measured, opt-in 38-byte cost of
"place another actor" already delivers the real feature at less implementation risk than designing,
building and verifying a new gated schema/engine mechanism would — a simpler argument, and one this
document can actually stand behind.

**The level field itself: default and clamp, settled precisely rather than left "TBD."** `battle.level`
defaults to `null` ("not set"), the same convention this exact schema already uses for
`battle.spellId`/`battle.battleTile` (both `null`-or-`clamp(...)` — project.js:3372-3373,
3376-3379) — a monster with no authored level shows as unset, not a fabricated "Level 1" nobody
typed. When set, it clamps to `1..RPG_LIMITS.maxLevel` (1-15, the fixed engine constant,
project.js:972-982) — **not** to `project.rpg.maxLevel`, the project's own, separately adjustable
ceiling (defaults to `RPG_LIMITS.maxLevel`, `defaultRpg()`, project.js:2500-2508, but can be lowered
per-project, e.g. as one of `battleShortfallAdvice`'s own capacity levers, :854-860). Binding
monster level to the party's own adjustable ceiling instead of the fixed engine constant would mean
lowering "Highest level" in the Build panel to fix an unrelated capacity shortfall silently
reclamps every monster's already-authored level on the next normalize — an author fixing a byte
budget should not find their bestiary quietly rewritten as a side effect. Binding to the fixed
constant instead avoids that coupling entirely, and costs nothing else: the field has no engine
consumer to enforce range against either way, so the only question is which ceiling reads sensibly
to an author, and "the hard maximum a level can ever be" is that one, not "whatever the current
project happens to allow the party to reach" — a monster well above the party's own ceiling (an
off-the-charts final boss) is an ordinary thing to author, not an error.

**A scaling input that derives the statline at build time** (`battletables.js`, reusing `statAt` the
way the party already does) remains a real, cheap *authoring convenience* — not a different
capability, since a monster's row is one flat value regardless of whether it arrived as
`base + perLevel * (level - 1)` or typed by hand — and can be added later, losslessly, on top of the
display-only field without touching the compiled output at all. See §6 phase 3, still explicitly not
committed to by this design.

**When to revisit the mechanism deferral**: if a future item wants a monster's *effective*
difficulty to change without re-placing actors — a New Game+ mode, a difficulty setting, or scaling
to the party's own level — that is the trigger, and the two costed shapes above (a per-encounter
level parameter, or a party-style per-level table) are where to start.

## §4. Q3 — battle-side animations

Unchanged from v1 — review found this sound and out of scope for revision. Not designed here, per
the brief and per item 14's own text ("the two items would want one shared answer, not two
separately designed ones"). Recorded instead, continuing rather than repeating `docs/design-magic.md`
§13 (which already states the shared constraints from item 13's side: a stable place in the banked
region's headroom to grow into, a Forge-boundary posture that does not harden around "no animation,"
and the requirement that the shared design pick where an animation reference is hung — none of which
this document overrides).

**Verified, not merely restated: battle art is completely static today, on *both* its paths.**
ROADMAP's "no motion and no attack/cast animation on a monster at all" is exactly right, and it is
worth having actually checked the metasprite-fallback path rather than assumed it, because that path
looked at first read like it might already animate (the fallback is "drawn with the sprites,"
engine/battle.asm:375, the same pipeline the overworld's own animated actors use). It does not:
`battle_sprite_mon` (engine/battleui.asm:824-847) calls `draw_actor_icon`
(engine/ui.asm:428-444), which always draws **frame 0** of the actor's down-facing animation and
nothing else — the identical single-frame shape `draw_item_icon` (:459-467) uses for a bag icon.
Neither battle art path has ever had a form of motion to lose; item 14's own framing needed no
correction here.

**What item 14 adds to the shared question that item 13 did not have to consider**: a spell's
animation target is the *player's own screen position* relative to a combatant slot; a monster's own
animation is additionally constrained by which of the two battle-art paths it is on — a block-art
monster's "animation" would need to live in the same 16-wide/4x4-attribute-cell background region
`draw_mon_block`/`draw_battle_attr` (engine/battle.asm:384-453) already anchor its single static
frame to, while a metasprite-fallback monster's animation is a sprite question closer to item 13's
own (reusing `draw_metasprite`, just cycling frames the field already has instead of pinning frame
0). These are not the same mechanism, and a shared design has to either pick one monster-art path to
animate and say so, or solve both — a decision this document explicitly leaves to that slice, not to
either Forge's own implementation reaching a conclusion first by accident of which one ships sooner.

**Recommendation**: a dedicated animation design slice, scoped to both items together, is where this
gets settled — not folded into either this Forge's phase 1 or a Magic Forge follow-up. Until then,
the Monster Forge phase 1 in §6 below reserves no UI space or schema field for it, matching
design-magic.md §13's own posture exactly.

## §5. Verifying the zero-engine-cost claim

**The whole boundary answer in §2, and the display-only level field in §3, touch no engine file, no
generator table, and no compiled byte.** §2 moves which *renderer* module owns a set of `<input>`
elements that already write to `actor.battle.*`, adds the `pendingRequest`/`activeContext`/`goTo`/
`consumeContext` navigation mechanism and a `store.revision` counter (both `renderer/` session state,
never serialized, never read by anything under `main/build/`), and adds `monsterActorIds` (a pure
read, no compiled output) — the underlying `store.commit` calls, the schema, and everything
`main/build/battletables.js` emits from that schema are unchanged. §3's `level` field is read by
normalization (`normalizeActor`, `shared/project.js`), the Monster Forge's own render, `main/smoke.js`
and the unit tests — the true boundary is narrower than "nothing outside the Forge": no
compiled-byte emitter reads it. A direct search finds no `battle.level` or `mon_level` anywhere
under `main/build/` or `engine/`; `test/unit/monsterlevel.test.js` separately proves the narrower
claim that a build with the field left unset and one set to 7 compile to byte-identical ROMs.

**v1's proof procedure conflated two different things the review correctly separated: a claim only a
cross-tree comparison can prove, and a claim a same-tree unit test can prove — and a `test/unit` test
cannot build `master` from inside itself.** This codebase already has the right shape for both, side
by side, in `test/unit/boundtiles.test.js:397-417`: a **one-time, out-of-band `git worktree`**
comparison against a historical commit (recorded in that feature's own implementation report, with
both sha256 hashes cited, explicitly *not* pinned as a repeatable test — "That check is not
repeatable here without pinning a whole-ROM hash against a fixed historical commit, which would
break the moment any unrelated engine change lands"), alongside a **repeatable, same-tree** test that
proves a narrower, permanently-checkable invariant.

This design asks for the identical split, not a single mixed procedure:

- **Phase 1's own proof is the one-time, cross-tree kind**, and belongs in that phase's
  implementation report, not in `test/unit/`: build `sample-rpg` from a clean `git worktree` at the
  commit immediately before phase 1's own first commit, and again from the tree after phase 1 lands,
  and compare the two `game.nes` outputs (a `sha256` digest of each, both recorded in the report —
  the `boundtiles.test.js` shape exactly). This is the only way to prove "moving `battleSection` into
  a new Forge changed no compiled byte," because the claim is about master-before versus
  branch-after, which no single checkout's own test run can execute.
- **Phase 2's own proof is the repeatable, same-tree kind, and belongs in `test/unit/`**: build two
  variants of the same project *from the same tree* — one where a monster actor's `battle.level` is
  unset, one where it is set to some value — with everything else identical, and assert the two
  compiled outputs are byte-identical. This is exactly `test/unit/routes.test.js`'s own comparison
  shape (two differently-authored-but-should-compile-identically variants, built and compared in one
  test run, in one checkout) and needs no worktree, no historical commit, and no maintenance burden
  a pinned hash would carry.

**Both existing tests remain green; new tests are additions, not neutral.** v1 asked for "an
unchanged pass count," which the review correctly flagged as wrong the moment a phase adds its own
tests: phase 1 adds the membership, lifecycle, actor-state and validation-attribution tests named in
§2 and §6; phase 2 adds the level-normalization and same-tree byte-identity tests just above. Each
phase's own report should say the existing suite stayed green and name how many tests it added, not
claim the total held still.

**Capped-array check, per the brief.** No new id space is proposed anywhere in this design.
`LIMITS.actors` is already `NO_ACTOR` (0xFF, project.js:84,148) — the sentinel-equals-cap discipline
CLAUDE.md documents for actors, items and metasprites alike — and a monster consumes exactly one
actor id it already had. `RPG_LIMITS` (project.js:972-988) needs no new entry: `monstersPerBattle`
(4) and `encounterActors` (4) already bound how many monster actor ids one battle or one map's
wandering table may name, and neither number is touched by anything here.

## §6. Phased implementation plan

**Phase 1 — the Forge extraction (§2), complete this time, not a partial slice to be revised
again.** Move `battleSection`/`artPicker` from `battle.js` into a new
`renderer/forges/monster/monster.js`, mounted as a list-detail Forge (the Items Forge's own shape).
Specifically, this phase includes all of:

- `monsterActorIds(project)` in `shared/project.js`, exactly as specified in §2, with its own unit
  tests: authored-mention inclusion (a battle command inside a disabled branch, a common event, a
  nested choice option, an over-cap 5th formation slot, a rate-zero map's encounter table) and
  exclusion (an out-of-range id, a non-`battle` command).
- The list-detail UI: selection by actor id, re-derivation of both the catalog and the live actor on
  every render, the empty-catalog and stale-selection fallbacks, `{ onProjectChange: render }` — all
  per §2's lifecycle contract, with tests for undo/redo and an external commit changing catalog
  membership while this Forge is mounted, confirming an edit never lands on a different actor.
- The `actor.battle ?? {}` invariant applied throughout, with the same-session
  added-actor-with-no-battle-record test from §2.
- The "Make harmless" action (clear `damage`), with a test confirming a still-referenced actor stays
  listed, marked stranded, after it.
- The registry entry (`gameTypes: ['rpg']`) and the two `main/smoke.js` assertions from §2
  (positive/negative `forgeIds` inclusion), plus the comment sweep for every place calling Magic Forge
  the sole `gameTypes` entry.
- The navigation contract from §2 in full: `store.revision` (`renderer/store.js`), and the
  `pendingRequest`/`activeContext`/`goTo`/`consumeContext` mechanism in `renderer/app.js`, both
  directions (Sprite → Monster, Monster → Sprite) landing on the correct tab and actor. Tests, each
  exercising a distinct clearing point named in §2: a plain deleted-actor fallback (the target id no
  longer exists at all); a *renumbered*-actor fallback specifically (a different, later delete shifts
  some other actor down onto the linked-to id, so the id still resolves but now names the wrong
  actor — the case only the `store.revision` check catches, not a bounds check); a superseded
  navigation (a second `goTo`/rail click before the first's `import()` resolves) does not leak its
  context into the winning mount; and a rail click (bypassing `goTo` entirely) never consumes a
  stale `pendingRequest`/`activeContext` left over from an earlier link.
- The two `validateProject` attribution fixes (§2/§7 note below): the battle-art-collision error
  (project.js:4494-4501) and the stale-drop warning (project.js:4534-4543) change `where:
  'Sprite Forge'` to `where: 'Monster Forge'`. The "no actor deals damage" warning (:4482) and both
  "names an actor that no longer exists" findings (:4506, :4600-4607, already `'Map Forge'`) are
  confirmed to need no change — `damage` stays on Sprite Forge by §2's own rule, and the latter two
  were never Sprite's to begin with. The code comment at project.js:462 naming "the Sprite Forge's
  Drops select" is swept to name the Monster Forge instead.

Must prove: the phase-1 cross-tree ROM comparison from §5; every test bullet above passes; the
existing suite stays green (count rises by however many tests this phase adds, not unchanged); the
smoke test's existing zeroed-damage "stranded encounter" step (~main/smoke.js:4678-4700) still
passes unmodified, since it exercises the exact code path (`mapEncounterFormation`) `monsterActorIds`
has to agree with, from a different Forge.

**Phase 2 — monster level, display-only (§3).** Add `battle.level` to `normalizeActor`
(`null`-or-`clamp(1, RPG_LIMITS.maxLevel)`, per §3), a number field in the Monster Forge's detail
pane, and the `test/unit/project.test.js` normalization round-trip test every other `battle.*` field
already has. Must prove: the §5 same-tree byte-identity test (two builds differing only in whether a
monster's `level` is set, identical output); the existing suite stays green (count rises by the new
tests this phase adds).

**Phase 3 — optional, build-time-derived stat convenience, only if requested.** A per-stat
`base`/`perLevel` pair (or a single shared growth multiplier, whichever the actual authoring UI
review prefers) that computes the same `atk`/`def`/etc. numbers `statAt` would produce for the
party, collapsed into the stored fields at edit time — not a new compiled table, not a new engine
consumer, per §5's own constraint on why this stays zero-cost. This phase is explicitly not
committed to by this design; it is here so a future author of it does not have to re-derive why the
collapsing behavior (rather than a live multiplier) is the one that keeps §5's proof valid.

**Phase 4 — battle-side animation.** Out of scope for this Forge's own implementation entirely (§4).
Tracked here only so the phase list does not read as though item 14 is "done" without it — it isn't,
and it is deliberately not this document's or this Forge's decision to make alone.

Each phase is independently shippable: phase 2 has no dependency on phase 3 ever happening, and
phase 1 alone already delivers the entire ROADMAP ask except level and animation — a claim that now
actually holds, per §2's own narrowing, because phase 1 includes the deep-link that gives contextual
access to the fields it correctly leaves on Sprite Forge.

## §7. What could go wrong

**A note on the brief's own example.** The brief cites "a routine reached by `jsr` that wanted to
`jmp player_died`" as something item 13's design round found before any code was written. Checked
against the tree: that trap is real, but it traces to `engine/ui.asm`'s `use_item_apply`
(item 5's phase 4c, CLAUDE.md's own "event system" section — "`use_item_apply` is reached by `jsr`
and must never itself `jmp player_died`"), not to anything in `docs/design-magic.md`, which contains
no `jmp player_died` reference at all. Worth correcting per "verify rather than assume" rather than
silently repeating an attribution the code does not support — it does not change anything else in
this document.

**Trap 1 — a monster's own list must not be gated on `isMonsterActor` alone, because that predicate
is derived and mutable, and this codebase has already shipped this exact bug once.**
`mapEncounterFormation` (the compiler's own single writer for what a map's wandering table contains)
"does not filter by `isMonsterActor`/damage at all" (map.js:1778's own comment) — an actor already
sitting in an encounter table or a battle-command formation keeps compiling into a real fight after
its `damage` is edited down to zero elsewhere. An earlier version of the Map Forge's own battle-test
button *did* gate on `hostile.length` and hid the one tool for previewing a fight the ROM still
shipped (map.js:1783-1788's own account of the regression); `main/smoke.js` (~:4678-4700) now
exercises exactly this scenario as a permanent regression check. A Monster Forge that lists monsters
by `project.sprites.actors.filter(isMonsterActor)` — the natural, Items-Forge-shaped first draft —
reintroduces the identical failure in a new place. §2's `monsterActorIds` bakes the fix (the
union-plus-stranded-label shape, now precisely specified) in from the start rather than shipping the
naive filter and finding this the way the Map Forge did.

**Trap 2 — "delete a monster" is not one function to call, it is a five-step sequence that exists in
exactly one place today.** §2's deletion discussion above states the fix (ship only the
non-destructive "Make harmless" action in phase 1); this is the trap that answer avoids. The
tempting shape — mirror `renumberItemDeletion`'s own call site in `items.js` and call
`renumberActorDeletion` from a new Monster Forge delete button — is incomplete on its own by that
function's own documentation: **"Placed actors are renumbered separately, inline where they are
deleted — this only ever needs to run alongside that, never instead of it"** (project.js:2211-2212).
The actual sequence (splice, id restamp, `screen.entities` filter-and-shift across every map, *then*
`renumberActorDeletion`) exists only inline inside `sprite.js`'s own delete-actor handler today. A
second caller that reproduces only part of it — most plausibly, calling `renumberActorDeletion` and
stopping there, since that is the part with an exported name to import — would leave every placed
copy of the deleted monster on every map pointing at a shifted or nonexistent actor id, silently:
nothing in `renumberActorDeletion` itself would catch it, because by its own contract it isn't
supposed to.

**Trap 3 — `mon_heal` looks like dead weight and is not, and now has a second reason not to touch
it.** §1/§2 name `battle.heal`/`mon_heal` as a field with no author-facing purpose since phase 4c —
and, per §2's corrected boundary rule, a field that reaches beyond the `BATTLE_ENABLED` boundary
every other `battle.*` field respects, since `deriveItemEffect` reads it during ordinary
normalization regardless of game type. A Monster Forge implementer who notices the UI is gone and
"helpfully" removes the field, its clamp, or the `mon_heal` emission — reasoning that nothing edits
it any more — would break two things at once: the `ITEMS_ENABLED`-false path for any existing RPG
project with no `items[]` at all (`item_chosen`, `engine/battleturn.asm`, still reads `mon_heal`
directly — battletables.js's own header comment, :21-32, is explicit that deleting either table
"would break the disabled path's byte-for-byte promise to master") *and* item migration for any
project, any game type, the moment an item is derived from a legacy actor. The field is legacy on
two independent fronts, not dead on either; the fix is simply: leave it exactly as it is, unedited
and unexposed in both Forges, the same posture this design already takes toward every other field
this document does not otherwise touch.

## §8. Changelog

**2026-09-04** — Phase 2 (§3/§6, display-only `battle.level`) shipped, commit `9e66fe2`. Corrected
§5's own claim above: the field is read by normalization, the Monster Forge and the tests, not "by
nothing outside the Forge that authors it" — the true boundary, confirmed by source inspection, is
that no compiled-byte emitter reads it; the byte-identity test itself proves only the narrower claim
that a build with the field unset and one set to 7 compile to identical ROMs.

**v3** — folds in `handoff-next/monster-design-2-review1.md` (a confirmation pass on v2: nine of
nine round-1 findings resolved, one blocking finding raised fresh against v2's own navigation fix,
plus two non-blocking corrections). Full detail in `handoff-next/monster-design-3-report.md`.

| # | Finding | Disposition |
|---|---|---|
| Blocking | v2's `pendingContext`/`consumeContext()` sketch has no bounded lifetime (never cleared on either early return, the availability redirect, a superseded selection, a load failure, or a non-consuming Forge; bypassed entirely by a direct rail click) and no identity check that can tell a deleted-then-restamped actor id from the one a context originally named | Fixed: rebuilt the mechanism around `selectionToken` (reused, not duplicated) plus a new `pendingRequest`/`activeContext` pair with an explicit clearing line at every point named, and a new `store.revision` counter (specified as a required, small addition to `renderer/store.js`, verified not to exist today) compared before/after the async `import()` to catch a renumber that happens during the load. Both mechanisms and their interaction are spelled out in full, including a corrected code sketch (the identity check must run *after* `await entry.load()`, not before, or it cannot see a mutation that happened during the load) |
| Non-blocking | §2 said a stranded, still-referenced actor stays listed "because the ROM still fights it" — false for the dormant (disabled-branch) and over-cap (5th formation slot, rate-zero map) cases `monsterActorIds` deliberately includes, none of which currently compiles into a fight | Fixed: reworded to "because authored data still names it," with the live/dormant distinction noted as an optional UI refinement, not a membership decision |
| Non-blocking | §3 claimed a future scaling mechanism "necessarily" costs bytes in every RPG project, whether used | Fixed: reframed as the cost of one representative, easiest-to-build (unconditionally-eager) layout, not an established property of every possible design — a gated emission could avoid it, the same way `ITEMS_ENABLED` already gates a whole table family. The 38-byte opt-in cost of "place another actor" already justifies deferral without the stronger, unestablished claim |
| Correction | Round-2 brief undercounted round-1's findings as eight; the file has nine (2 high, 6 medium, 1 low) | Fixed: v2's own changelog intro line corrected below; its disposition table already had all nine rows, so no row was missing, only the summary count above it |

**v2** — folds in `handoff-next/monster-design-1-review1.md` in full (9 findings: 2 high, 6 medium,
1 low — the round-2 brief undercounted this as eight; the table below always had all nine rows).
Finding-by-finding disposition (full detail in `handoff-next/monster-design-2-report.md`):

| # | Finding | Disposition |
|---|---|---|
| High 1 | Actor-state claim false for freshly-added, unsaved actors | Fixed: retracted the claim, committed to the `actor.battle ?? {}` invariant (matching three existing call sites), argued against the alternative (fixing the shared creation path) on blast-radius grounds, added a phase-1 test |
| High 2 | Membership underspecified; "Remove from this list" doesn't remove | Fixed: specified `monsterActorIds(project)` exactly (`allCommands` over `liveCommands`, common events, over-cap entries, zero-rate maps, all decided and cited); renamed the action to "Make harmless"; explicitly declined to design a reference-purging transaction |
| Medium | Selection/lifecycle/undo-redo missing | Fixed: id-based selection, re-derive every render, explicit fallback, `{ onProjectChange: render }`, tests named |
| Medium | Cross-links not equivalent to Party→Magic; `app.goTo` takes only an id | Partially fixed at the time (see v3: the replacement mechanism itself needed a second round) — verified `app.goTo`'s real signature; put the work in phase 1; narrowed the "phase 1 delivers everything except level/animation" claim to depend on it |
| Medium | In-place `gameType` mutation unresolved | Settled: verified the app has no code path that mutates `gameType` on an open project at all (creation-time only); declared the scenario impossible by contract rather than designing around it; kept only the comment-sweep action item |
| Medium | `heal` field-boundary claim contradicted its own deferral | Fixed: verified `deriveItemEffect` reads `battle.heal` outside `BATTLE_ENABLED`; rewrote the boundary rule as two-sided-plus-one-exception instead of universal; trap 3 updated to name both reasons |
| Medium | Level tradeoff rested on a false zero-cost claim; clamp undecided | Fixed: re-measured the duplicated-actor cost myself (8 kernel-lo + 30 banked-region = 38 bytes, independently arriving at the review's own figure) rather than adopting it unchecked; rebuilt the phase 2/3 argument around bounded-vs-unbounded cost instead of free-vs-costly; settled the default (`null`) and clamp (`1..RPG_LIMITS.maxLevel`, deliberately not `project.rpg.maxLevel`, with the coupling hazard stated) |
| Medium | Validation-attribution and behavior tests missing | Fixed: identified the exact two `validateProject` findings that need `where` updated (project.js:4494-4501, :4534-4543), confirmed which stay on Sprite (:4482) or were already elsewhere (:4506, :4600-4607), added the comment sweep, folded all of it into phase 1 |
| Low | Proof procedure mixed cross-tree and same-tree claims; required an unchanged pass count | Fixed: split into a one-time worktree comparison (phase 1, implementation report) and a repeatable same-tree test (phase 2, `test/unit/`), matching `test/unit/boundtiles.test.js:397-417`'s own precedent; dropped the unchanged-pass-count requirement |

**v1** — first draft, no code written, checked against HEAD at the time of writing (post the
CLAUDE.md pruning-pass slice).
