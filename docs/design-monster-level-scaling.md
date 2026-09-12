# Design: Monster Forge phase 3 — level-derived stats (ROADMAP item 14, point 2)

**v3.1 note**: a GO with three low wording findings (N6-N8), no mechanism change — see §7.
No source file touched.

## §0. What I read

Everything v1/v2/v3 read, re-verified where touched again. This round adds:
`handoff-next/monster-phase3-design-3-review1.md` in full; `renderer/ui.js:92-96,129-130`
(`showModal` focuses the first input, sets an Escape listener and a backdrop handler, but traps
neither Tab nor makes the page inert); `renderer/app.js:673-683` (the global `keydown` handler only
intercepts Ctrl/Cmd+S and Ctrl/Cmd+Z — Tab/Enter/Space pass through). Re-verified, carried over:
`renderer/ui.js:114`; `librarypicker.js:290-335`/`:327-332`; `app.js:435-452`;
`app.css:738-753`; `index.html:45`; `shared/project.js:4995-4996`/`:4013-4028`; `sprite.js
:872-891`/`:765-836`; `monster.js:83-89`/`:166-179`/`:269-401`; `renderer/store.js:172-197`;
`battletables.js:139-227`/`:313-323`/`:614-651`/`:927-929`; `shared/project.js:3596`/`:4101-4105`/
`:5995-6014`; `character.js:174-193`; `rpg.test.js:20`/`save.test.js:44`; `test/lib/sourcescan.js`;
`battle.asm:350-360`; `input.asm:271-299`; `entities.asm:77-78`; `sample-rpg/project.json`.

## §1. Recommendation at a glance

**Still no new schema fields.** A per-monster "Derive from level…" modal, enabled only when
`battle.level` is not `null`, covering seven fields (atk/def/mag/mdef/mp/xp/gold) via `statAt` — now
moved to `shared/project.js`, re-exported verbatim from `battletables.js` (§3.4). The modal returns
only raw inputs; the actual mechanism is a **plan/apply split** run after every lifetime guard, in
one continuation with no intervening `await` (§3.1): `planMonsterGrowth` is pure, returning `null`
when every computed value already equals its *stored* value, or a plan naming what changes;
`applyMonsterGrowth` performs it, and the Forge skips `store.commit` entirely on `null`. One
descriptor table (§3.5) carries every stat's `Base`/`+ / level` bounds, read by both the UI and the
core, so they cannot disagree again. Modal lifetime is bound to the actor id captured at open, a
`destroyed` flag, and a selection check (§3.8) — three guards, not `store.revision` alone; no fourth
"second dialog" flag: the modal host already blocks a second *pointer* invocation, and a
keyboard-driven one is covered by the same guards regardless (§3.8). The zero-ROM-cost
claim is narrower, correctly qualified: no growth-specific schema/table/reader/allowance exists,
but a derived positive `mag`/`mdef` can flip a real, project-wide capacity gate exactly as
hand-typing it already can (§3.9).

## §2. Costing the candidate shapes

### Shape 1 — per-monster stored growth pairs

Rejected (unchanged). Fourteen display-only fields, cheap but redundant with the flat
field the moment either is hand-edited, with no way to tell which is "current."

### Shape 2 — a project-wide monster growth template

Not recommended (unchanged) — one shared curve forces every monster through the same numbers unless
re-edited between monsters, degrading to shape 3's ergonomics with extra ceremony. **Correction
(finding 10)**: v1's Slime/Snake "different curves by design" claim overstated the tree — flat
stats, no "curve" concept in the schema at all. Reworded as a *plausible authoring expectation*, not
a tree-established fact.

### Shape 2b — a saved recipe (finding 10, costed fairly and declined)

A **named**, project-stored `growth` template applied through an explicit "Apply recipe" action,
flat fields written once, no live link — still edit-time collapsing, no compiled reader. Answers
shape 2's "one curve" complaint with several named ones. Costs shape 3 does not: a persisted array
plus create/rename/delete UI, with no evidence authors want it. **Declined for scope**, not a flaw.

### Shape 3 — no new stored fields; ephemeral modal inputs (recommended)

Unchanged verdict: recommended. **A no-new-fields seed picker** — pre-filling `Base`/`+ / level`
from another actor or a party member — was proposed in v2 as an included enhancement, but is
**deferred, per N4**: a party member's growth fields can't define all seven rows (no party
`xp`/`gold` growth pair — `shared/project.js:4013-4028`), and an actor seed's missing fields
need a fallback too. Costed as a future candidate: whichever slice builds it specifies the
five-field party mapping, the reward rows' behavior, the partial-actor fallback, and whether
reselecting mid-edit replaces every row or only supported ones. Retyping on re-derive (v1's
"re-entry cost") is real but accepted (§6).

**Shape 3 still wins** without the picker: no schema growth, no new engine surface — retyping is a
UI-polish gap, not a correctness one.

## §3. The recommended shape, in full

### §3.1 Mechanism — modal returns raw inputs; guard, then plan-and-commit in one continuation

A "Derive from level…" button sits beside the Level row (`monster.js:152-163`), enabled only when
`battle.level` is not `null` (a fractional value is fine — §3.5). Clicking it opens a modal with one
row per covered stat (§3.5's descriptor table): a `Base` field and a `+ / level` field
("+ / level" is the Character Forge's label, reused verbatim; "Base" is this design's own — v1
wrongly claimed both were reused, finding 11). `Base` defaults to the current flat value; `+ /
level` defaults to `0`.

**Fixed per N1: the modal's `onClick` must do nothing fallible.** `renderer/ui.js:114` awaits
`action.onClick()` before ever calling `close()`, so a callback that throws leaves the dialog
unresolved by that failed action — its continuation (the guards, the plan, the commit) is not
reached until another dismissal (Escape, backdrop) settles the promise, per N8. So Apply's `onClick`
only reads the modal's local input state and returns the seven raw `{base, perLevel}` pairs as
a plain object — no project access, no `clamp`, nothing that can throw. Everything fallible runs
*after* `await showModal(...)` resolves, in one synchronous continuation with no further `await` —
the real precedent is `librarypicker.js:327-332` (plan, check `.ok`, `store.commit`, all
back-to-back immediately after that function's `revisionAtOpen` re-checks), not "no await
between plan and apply" as v2 wrongly cited, since `showModal` itself always awaits the action:

```js
const growth = await showModal({ /* … */ });
if (!growth) return;                                  // Cancel / Escape / backdrop
if (destroyed) return;                                // §3.8
if (store.revision !== revisionAtOpen) { toast(/*…*/); return; }
if (state.selectedActorId !== capturedActorId) { toast(/*…*/); return; }
const plan = planMonsterGrowth(store.project, capturedActorId, growth);
if (!plan) return;
store.commit('Derive stats from level', (project) => applyMonsterGrowth(project, plan));
render();
```

**This is the actual N1 defect, not a restyling.** v2's sketch called `planMonsterGrowth`
*inside* `onClick`, against `store.project` at click time, before any guard — a captured actor
deleted while the dialog sat open, or the project closed/replaced entirely, made the planner throw
reading `actor.battle` off `undefined` or `project.sprites` off a closed project. The fix moves
every fallible read to *after* the three guards, so a delete/close/replace is caught by
`store.revision` moving first.

### §3.2 Which stats — unchanged from v1

Attack, Defence, Magic, Magic defence, Magic points, Experience, Gold — matching the party's
growth coverage minus `hp` (§3.3), plus `xp`/`gold` (no party analog, but a plausible authoring need
for rewards to track difficulty). `acc`/`eva`/`speed` stay flat, matching the party; `weak`/
`strong`/`spellIds`/`drop`/`dropPct`/battle-art fields are untouched — none has a "grows with level"
meaning.

### §3.3 The Forge boundary — `hp` stays out

Unchanged from v1: `actor.hp` compiles to both `mon_hp` and, through `actor_hp` → `ent_hp`,
`do_attack` in every game type (correctly cited now at `input.asm:271-299`, `entities.asm:77-78`,
`battle.asm:356` — finding 11). The boundary rule is about which Forge's UI owns a field, not
whether a batch action may touch it structurally — but `Base`/`+ / level` inputs for `hp` *inside*
the Monster Forge's modal would mean authoring a Sprite-Forge-owned field from a Forge whose
header comment says it never does that, with no field there to trace the change back to. **`hp`
stays excluded, permanently, on every game type.**

### §3.4 `statAt` — moved and re-exported, not merely moved

`statAt` moves to `shared/project.js` (`main/build/` imports from `shared/`, never the reverse).
Unlike v1, `battletables.js` **re-exports it verbatim** — `export { statAt } from '../../shared
/project.js';` — not importing it privately, since `rpg.test.js:20` and `save.test.js:44`
both import `statAt` from `battletables.js` today (finding 6; v1 missed these). Identical shape to
CLAUDE.md's "music format" passage (`songByte`/`NO_SONG`, `shared/audio.js`, re-exported "for its
existing importers"). Signature gains one optional parameter: `statAt(base, perLevel, level,
ceiling = 255)`.

**The one-formula "proof" is dropped, per finding 5, not merely relocated.** A grep for
`base + perLevel * (level - 1)` already hits other design docs and this prose — "exactly
one hit" is unsatisfiable, and `base + (level - 1) * perLevel` would pass anyway. Replaced with: (a)
direct inspection (§0's citations) that both call paths use the same exported binding with no
independent arithmetic; and (b) a structural test. `test/lib/sourcescan.js`'s `identifiers`/`imports`
neither associate an imported *name* with its module nor detect a *declaration* versus a call —
missing primitives, needing a small addition (the same token-scan style `isDynamicImportSpecifier`
uses) or a local `acorn` `tokenizer` scan. Either way: assert `battletables.js` declares no
`function statAt` and its binding imports from `'../../shared/project.js'`, with a negative control
(a local `function statAt` reinserted) rejected.

### §3.5 Numeric policy — one descriptor table (N2, fixed)

**v2 had a real bug, not just under-specification.** Its prose put Gold's `+ / level` at 0-32, but
the code sketch's ternary let Gold's growth reach 255 — the two disagreed in the same document.
**Fixed by construction**: one exported descriptor table is now the *only* place a bound is written,
read by both the modal's widgets and `planMonsterGrowth`'s `clamp` calls — no second place to
duplicate or mis-copy a range into.

```js
// shared/project.js
export const MONSTER_GROWTH_FIELDS = [
  { key: 'atk', label: 'Attack', ceiling: 255, perLevelMax: 32 },
  { key: 'def', label: 'Defence', ceiling: 255, perLevelMax: 32 },
  { key: 'mp', label: 'Magic points', ceiling: 255, perLevelMax: 32 },
  { key: 'gold', label: 'Gold', ceiling: 255, perLevelMax: 32 },
  { key: 'mag', label: 'Magic', ceiling: 255, perLevelMax: 16 },
  { key: 'mdef', label: 'Magic defence', ceiling: 255, perLevelMax: 16 },
  { key: 'xp', label: 'Experience', ceiling: 65535, perLevelMax: 65535 }
];
```

**Correcting the brief's decision, with evidence.** A flat `0-32` for every `+ / level` row
doesn't match precedent: the Character Forge bounds `atkPerLevel`/`defPerLevel`/`mpPerLevel` to
`0-32` but `magPerLevel`/`mdefPerLevel` to `0-16` (`character.js:187-192`). `gold` mirrors `atk`'s
posture, no party analog to match. `xp`'s `perLevelMax` stays at its `Base` ceiling: the party's
`xpBase`/`xpGrow` size the *required-XP* curve, an unrelated quantity to a reward's growth, so
borrowing that scale would be an unjustified analogy, not evidence. Negative growth is unsupported
everywhere, matching the Character Forge's non-negative posture (finding 4).

**Rounding, not merely bounding**: `planMonsterGrowth` runs every input through the same
module-private `clamp` `normalizeActor` uses (`shared/project.js:4101-4105`, `Math.round` inside)
before calling `statAt` — the UI widgets bound range but never round to an integer, and `showModal`
doesn't validate a form, so the core must not rely on widgets for a constraint they don't enforce
(finding 4). An empty input already reads as `Number('') === 0`.

**`battle.level` is rounded the same way, not required to already be an integer.** `numberOrNull`
(`monster.js:53-58`) accepts a fractional value with no rounding. The Level row's enable check tests
only `!= null`; if the core refused a fractional level outright (v1's `Number.isInteger` guard),
the button would be enabled while Apply silently did nothing (finding 4). Fix: `planMonsterGrowth`
checks `null`/`undefined` *first*, explicitly (`clamp(null, …)` alone is unsafe — `Number(null) ===
0` is finite, silently clamping a missing level to `1`) and otherwise rounds via `clamp(rawLevel, 1,
RPG_LIMITS.maxLevel)`. The Level widget's `onchange` should gain the same rounding as a one-line
follow-up — UI consistency, not a behavior change to the party's `statAt` calls.

```js
// shared/project.js, continued -- planMonsterGrowth reads MONSTER_GROWTH_FIELDS, nothing else
export function planMonsterGrowth(project, actorIndex, growth) {
  const actor = project.sprites.actors[actorIndex];
  const rawLevel = actor.battle?.level;
  if (rawLevel === null || rawLevel === undefined) return null;
  const level = clamp(rawLevel, 1, RPG_LIMITS.maxLevel);
  const battle = actor.battle ?? {};
  const writes = {};
  for (const { key, ceiling, perLevelMax } of MONSTER_GROWTH_FIELDS) {
    const g = growth[key];
    if (!g) continue;
    const base = clamp(g.base, 0, ceiling);
    const perLevel = clamp(g.perLevel, 0, perLevelMax);
    const value = statAt(base, perLevel, level, ceiling);
    if (battle[key] !== value) writes[key] = value;
  }
  return Object.keys(writes).length ? { actorIndex, writes } : null;
}

export function applyMonsterGrowth(project, plan) {
  Object.assign(project.sprites.actors[plan.actorIndex].battle, plan.writes);
}
```

`planMonsterGrowth` is the commit-free core (CLAUDE.md's "Map organization and reuse" shape);
`applyMonsterGrowth` is the apply, an `Object.assign` onto `battle` exactly as `applyPlannedProject`
is for a whole project. Comparing `battle[key] !== value` against the **stored** value (not the
rendered default) is what makes finding 8's "no-op" promise the strong one: an already-normalized
actor's fields are all concrete numbers, so untouched defaults reproduce them exactly and
`writes` stays empty — `null`, no commit at all.

**This also resolves finding 1, as a direct consequence, not a special case.** A same-session
actor with only `battle = { level: 12 }` (`sprite.js:872-891` pushes no `battle` key; `monster.js
:84-89`'s `set()` spreads `undefined` into `{ level: 12 }`) has every other field genuinely
`undefined`. `Base` still renders the modal's default (`:166-179`), so the plan computes a real
number for each — but the stored value is `undefined`, never equal to a number, so *every* field is
written on the first Apply. Not the "no-op" case: the modal fills in missing stats, a desirable side
effect that must be documented, not promised away. **Also flagged, out of scope (decision 2,
corrected per N5)**: the renderer's `xp`/`gold` defaults (4/2, `:178-179`) **agree** with
`normalizeActor`'s fallback (`shared/project.js:4995-4996`) — only `battletables.js`'s compiled
fallback (`?? 0`, `:158-160`) differs from both. A never-saved actor compiles to `mon_xp = 0` today
but reaches `4` the moment Apply runs once — a pre-existing mismatch this design did not create.

### §3.6 `battle.level` nullable — unchanged, refuse

The button stays disabled while `battle.level` is `null` — no change from v1. The Level field's
hint text ("For your own reference only — the battle system never reads this," `monster.js:161`)
stays accurate: the compiled ROM still never reads it; only the renderer-side derivation does.

### §3.7 Proof — a same-tree comparison against an independent expectation

**Finding 2 is fixed by strengthening the assertion, not merely re-describing it.** A grep for
`applyMonsterGrowth`/`monsterGrowth` (kept, as an aid) cannot rule out a wrong implementation that
reads `battle.level` conditionally *inside* the existing `mon_atk` emission — it still imports the
real `statAt`, adds no occurrence of either searched name, and passes the arithmetic unit tests. The
real test: build two copies of `sample-rpg` in a `mkdtemp` directory. Copy A: call the plan/apply on
one monster. Copy B: an independently constructed project with the same seven fields hand-set to
values computed inline in the test (not by calling `statAt` again). Assert `assert.deepEqual` **in
full** (the `bankedbytes.test.js`/`playersprite.test.js` shape used elsewhere for "nothing else was
touched") — rejecting any stray write to `hp`, `level`, another actor, or a persisted input. Then
assert `battleTables(A) === battleTables(B)` (emitted text, not a ROM). **Without re-applying**,
change `battle.level` on copy A and assert output doesn't move. **Include a case that flips a magic
gate**: a derived `mag` crosses `0` for the first time, asserting `battleTableBytes(A) ===
battleTableBytes(B)`. **Per N2, sharpened per N7**: cases must use **unsaturated** inputs, or a
wrong cap is indistinguishable from a right one — `Base` 255, growth 100 clamps to 255 under both
the correct 32 cap and v2's wrong 255 one, proving nothing. Concretely: `Base` 0, `Level` 2, Gold
`+ / level` 33 → `32` (not `33`); Magic/Magic defence `+ / level` 17 → `16`; XP `+ / level` 300 at
`Level` 2 → `300` uncapped. **Also per N7**: read the rendered inputs' `max` attributes against
`MONSTER_GROWTH_FIELDS` — a widget hardcoding the wrong maximum would pass every arithmetic
assertion above and still ship a range an author can't reach.

### §3.8 Modal lifetime — three independent guards, not `store.revision` alone

**Finding 9, fixed.** v1 claimed `actorIndex` is "re-resolved from `state.selectedActorId`" after the
await, citing `openPaletteSwapModal` — false: it captures `actorIndex = state.actor` before the
`await` (`:786`) and uses that same value unchanged at the commit (`:832`), never re-reading
selection. Its only guard is the revision check (`:820-829`), insufficient here: **selecting
a different monster never bumps `store.revision`** (`monster.js:324-327`'s `onchange` mutates local
`state` only) — a plain revision check would let an author open the modal on Snake, switch to Slime
while it's open, and have Apply write Snake's derived stats onto Slime.

Three guards, all checked after the `await`, none sufficient alone: **(1)**
`store.revision !== revisionAtOpen` — any commit while open, as `openPaletteSwapModal` does. **(2)**
`state.selectedActorId !== capturedActorId` — a plain selection change (1) cannot see. **(3)** a
`destroyed` flag from `destroy()` (today `monster.js:398-401` only calls `app.setMeta('')`) —
navigating away entirely, since `#modalHost` is a single global element outside any Forge's
container (`renderer/ui.js:81`), so unmounting does **not** close a modal it opened.

**No fourth "second dialog" guard, per N3 — checked, genuinely unnecessary.** v2's module-scoped
`deriving` flag outlived Forge destruction/remounting with nothing to clear it on supersession — a
worse bug than what it guarded against. **Checked whether the scenario is even reachable**:
`app.css:738-753` — `.modal-host { position: fixed; inset: 0; z-index: 100 }`, its comment:
"this overlay covers the viewport and eats every click" — and `index.html:45` confirm `#modalHost`
is full-viewport while any modal shows, blocking a second *pointer* invocation. **Narrowed per N6**:
that's pointer clicks only — `showModal` neither traps Tab nor makes the rest of the page inert
(`ui.js:92-96,129-130`), and the app's key handler doesn't intercept Tab/Enter/Space
(`app.js:673-683`), so a keyboard user could in principle Tab past the modal and activate the button
behind it. Either route to a second dialog is the identical, already-harmless case: the Unsaved-
changes modal `ensureProjectCanBeReplaced` raises (`app.js:435-452`) can already supersede an open
derive dialog without calling its `close()`, and its promise is not "permanently pending" (too
absolute, per N3 — the derive dialog's Escape listener, `ui.js:129`, is never removed, so a
**later** Escape meant for whatever's visible now resolves the abandoned promise to `null`). The
resumed continuation checks all three guards before touching `store.project` again, so a
late-resolving promise — from a second pointer OR keyboard invocation — produces at most a no-op,
never a stray commit or a throw. The flag stays deleted either way; fixing every `showModal`
caller's supersession generally is `renderer/ui.js`-wide, out of scope here.

**Regression cases**: a commit elsewhere while open (guard 1); the Forge navigated away and back
(guard 3); a different monster re-selected while open (guard 2); Cancel/Escape/backdrop (no
commit); **the captured actor deleted while open** (N1 — guard 1 fires before `planMonsterGrowth`
reads the missing actor, settling with nothing thrown); **the project closed or replaced while
open** (N1 — same, before `store.project` is read again); superseded by Unsaved-changes, cancelled,
then Derive reopened and completed fresh.

### §3.9 Capacity — the real contract, not a flat byte count

**No growth-specific schema, table, reader, or allowance exists anywhere** — the plan/apply writes
only into fields `battletables.js` emits today. **But the claim stops there — finding 3,
fixed.** `mon_mag`/`mon_mdef` are *conditional* columns (`:149-154`), gated on
`projectUsesMagicPower`/`projectUsesMagicDefence` (`shared/project.js:5995-6014`) — reading every
actor's `battle.mag`/`mdef` *and* every party member's growth fields, project-wide. Deriving a
positive `mag`/`mdef` for the first time flips that gate on for the whole ROM, exactly as
hand-typing it already would. The same gate enables `pc_mag_at`/`pc_mdef_at` (`:319-323`), the
party's per-level table, even though nothing about the party changed. `mon_spell` is similarly
conditional in width (1 byte/actor, or 4 under `projectUsesMonsterSpellList`) — part of why a flat
"38 bytes always" figure is stale.

**Recomputed duplicate-actor cost** (8 kernel-lo bytes/actor, `shared/project.js:3596`, unconditional
below): base case is 19 one-byte columns + 1 (`mon_spell` off) + 10 (`mon_name`) = 30 banked, **38
total** — unchanged from `docs/design-monster.md` §3. Magic power: 39. Both gates: 40. Spell list
too: 43.

**Flipping a gate the first time costs far more than "+1 byte," paid once, project-wide.** Worked
example, `sample-rpg` (4 actors, 2 party, `maxLevel 8`): a first positive `mag` adds 62 (code) + 4
(one `mon_mag` row per existing actor) + 16 (`pc_mag_at`, `8 × 2`) — **82 bytes**, not 1, identical
to hand-typing the same number today.

**No fixture changes.** **Docs to touch later**: CLAUDE.md's Monster Forge paragraph, `ROADMAP.md`
item 14 point 2. CLAUDE.md is near its budget — a later pass must trim first.

### §3.10 Smoke

`main/smoke.js`'s existing Level section is extended: after confirming a typed Level reaches the
store, click "Derive from level…", set Attack's `Base`/`+ / level`, Apply, assert `battle.atk`
through exactly one commit; Undo and assert it reverts. The button is disabled while `battle.level`
is unset. New this round: open the modal, switch the catalog's `<select>` to a different monster
without closing it, then Apply — assert nothing was written and a toast explains why (§3.8, through
the real UI); and, per N7, one field's rendered `max` checked against `MONSTER_GROWTH_FIELDS` in the
real DOM, not only in the same-tree test's arithmetic.

## §4. Phased plan

**Phase 3a.** Move `statAt` to `shared/project.js`, add `ceiling`, re-export verbatim from
`battletables.js`. Zero behavior change for its six call sites plus two test importers (finding
6/N5). Independently shippable.

**Phase 3b.** `planMonsterGrowth`/`applyMonsterGrowth`, the modal and its lifetime guards, every
test in §3.5/§3.7/§3.8/§3.10. No seed picker (deferred, N4). Depends on 3a; nothing
unspecified.

No further phase proposed.

## §5. What could go wrong

**Trap — Base/repeat-Apply semantics, unexplained (finding 7).** `Base` pre-fills from a stat already
evaluated *at the current level*. At level 12, `Base` 10 and `+ / level` 2 produce `32`; reopening
shows `Base` 32, `+ / level` 0 — typing `2` again produces `54`, not `32`. Hint copy must say this
plainly; v1's "remember `+ / level` only" suggestion is deleted, not qualified — it would silently
compound growth on repeat Apply, the live-multiplier hazard shape 1 was rejected for.

**Trap — treating `!plan` as "always safe to ignore."** A fully-populated, unchanged actor also
produces `plan === null` from a genuine Apply click; don't assume `plan` is truthy whenever Apply
was clicked, since `showModal` also resolves `null` for Cancel.

**Trap — doing fallible work inside `onClick`, not after the `await` (N1).** Anything that can throw
must not run inside a `showModal` action: `ui.js:114` awaits it before `close()`, so a throw leaves
the dialog unresolved by that failed action until another dismissal settles it (N8). The fix is
structural (§3.1), not a try/catch on the callback.

**Trap — one ceiling constant for both `Base` and `+ / level` (N2).** Different questions —
conflating them (v2's ternary) let Gold's growth reach 255 while the prose said 32.
`MONSTER_GROWTH_FIELDS` carries both, separately.

**Trap — the magic-gate cascade reads as "this feature broke capacity."** §3.9's 82-byte example is
identical to what hand-typing the same number costs today.

**Trap — reaching for `statAt`'s old three-argument call out of habit**, for `xp` — unchanged.

## §6. Open questions for Chris

1. **Include `xp`/`gold`, or only five combat stats?** Recommend both — leaving them out only costs
   two modal rows.
2. **Leave `hp` out permanently, or give it a path on the Sprite Forge later?** Recommend
   leaving it out; a future HP path belongs on the Sprite Forge's panel.
3. **Is the seed picker (§2) worth a follow-up slice?** Not free (N4): no party `xp`/`gold` fields
   to copy, and a partial actor seed needs its fallback rule.
4. **The pre-existing `xp`/`gold` renderer-vs-compiler mismatch (§3.5)**: worth its own fix,
   independent of this design? Surfaced, not proposed to fix here.

## §7. Changelog

**Shipped** (this change): `monster.js`'s "Derive from level…" action, `shared/project.js`'s
`planMonsterGrowth`/`applyMonsterGrowth`/`statAt`/`MONSTER_GROWTH_FIELDS`;
`test/unit/monstergrowth.test.js` (14 tests), seven `main/smoke.js` steps; three review rounds
(`handoff-next/monster-phase3-impl-{1,2,3}-review1.md`), GO; `npm test` 1605/1605/0, `npm run
smoke` 229.

**v3.1** — GO. Three lows, wording only, no mechanism change: **N6** narrowed the second-dialog
"unreachable/impossible" claim to pointer clicks (`showModal` doesn't trap keyboard focus) —
keyboard supersession is another instance of the already-discussed shared-modal behavior, equally
harmless. **N7** sharpened §3.7/§3.10's out-of-range cases to unsaturated inputs (Gold
33→32, Magic/Magic defence 17→16, XP 300 uncapped) plus a rendered-`max` check, since a saturated
example can't distinguish a correct cap from a wrong one. **N8** replaced "unresolved forever" with
"left unresolved by the failed action until another dismissal settles it." Detail:
`handoff-next/monster-phase3-design-4-report.md`.

**v3** — folds in `handoff-next/monster-phase3-design-2-review1.md`. 9 of 11 round-1 fixes accepted;
4 and 9 partly resolved (remainders N2 and N1/N3). Five new findings. Detail:
`handoff-next/monster-phase3-design-3-report.md`.

| # | Finding | Disposition |
|---|---|---|
| N1 high | Plan computed inside modal `onClick`, before any guard; a throw left the dialog unresolved (`ui.js:114`) | Fixed: modal returns raw inputs only; guards run first, plan/commit after (§3.1); precedent corrected; two regression cases |
| N2 medium | Gold's `+ / level` ternary let it reach 255 while prose said 32 | Fixed: one `MONSTER_GROWTH_FIELDS` descriptor read by UI and core alike (§3.5); out-of-range cases added (§3.7) |
| N3 medium | Module-scoped `deriving` flag outlives Forge destruction; nothing clears it on supersession | Fixed: deleted — the overlay blocks a second *pointer* invocation; keyboard is covered by the guards regardless (§3.8, N6) |
| N4 medium | Seed picker's party-member mapping has no `xp`/`gold` fields, no partial-actor fallback | Fixed: deferred out of phase 3b; costed as a follow-up (§2/§6) |
| N5 low | Said normalizer differed from renderer; said "eight importers" | Fixed: renderer/normalizer agree, only compiler differs; "six call sites plus two test importers" |

**v2** — folds in `handoff-next/monster-phase3-design-1-review1.md` (11 findings: 9 blocking, 2 more
required).

| # | Finding | Disposition |
|---|---|---|
| 1 high | Same-session actor, `battle.level` only → `undefined` fields | Fixed: plan diffs stored values (§3.5) |
| 2 high | Compiled-reader grep permits a wrong implementation | Fixed: same-tree `deepEqual` + table equality (§3.7) |
| 3 medium | Conditional columns; 38-byte figure stale | Fixed: real contract + 82-byte example (§3.9) |
| 4 medium | Core/widgets disagree on fractional inputs; bounds unspecified | Partly fixed — remainder is N2 |
| 5 medium | One-formula grep unsatisfiable | Fixed: inspection + structural test (§3.4) |
| 6 medium | Private move breaks two external importers | Fixed: verbatim re-export (§3.4) |
| 7 medium | Base/repeat-Apply semantics unexplained | Fixed: hint copy + example (§5) |
| 8 medium | "No-op" contradicted unconditional `commit` | Fixed: plan/apply split (§3.1) |
| 9 medium | No lifetime fence beyond revision | Partly fixed — remainder is N1/N3 |
| 10 medium | Stored-growth dichotomy not exhaustive | Fixed — remainder is N4 |
| 11 low | Five citations drifted | Fixed throughout |

**v1** — first draft.
