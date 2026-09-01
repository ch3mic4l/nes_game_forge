# Routes implementation report

Implements `handoff-routes/design-routes.md` (5 review rounds, round 5 verdict "ready to
implement") in full. HEAD `6a44850`, nothing committed — all changes are in the working tree, per
the brief.

## What shipped

**`shared/eventrules.js`** — `ROUTE_LEG_OPS`, `routeLegs`, `legWithWho` added near the top, before
`isLive`. `isLive`'s route branch (`routeLegs(command.legs).some(isLive)`). `allCommands`'s
unfiltered `yield* allCommands(command.legs)`. `liveCommands`' route branch, recursing into
`routeLegs(command.legs)` instead of yielding the wrapper. The stale dangling-`call`
"can lie in the optimistic direction" paragraph in `liveCommands`' own doc comment deleted and
replaced with the current, accurate contract (call always agrees now; route is the one deliberate
departure, explained inline) — in the same edit, as the brief specified.

**`shared/project.js`** — `route` appended as the very last `EVENT_COMMANDS` entry, after `sting`,
with `nests: true`, `virtual: true`, and the full §5.1 comment; a standing catalog-invariant note
added to the array's own top doc comment. `IMPLEMENTED_COMMANDS` gains `'route'` plus the one-line
doc note. `normalizeEventCommand`'s `arg === 'route'` branch: route-level `who`, legs via
`routeLegs(raw?.legs)` → per-leg `normalizeEventCommand(leg, depth + 1, itemCtx)` → `delete
leg.who` for move/turn. Re-export block gains `ROUTE_LEG_OPS`, `routeLegs`, `legWithWho`.

**`main/build/textcompile.js`** — `encodeCommand`'s `'route'` case exactly per §5.3: `routeLegs` +
`legWithWho` + `encodeBody`, no `measured()` wrapper, no other change. Verified directly: a route
and the same legs hand-chained (`who: 'player'`, three legs) compile to byte-identical event
arrays, both standalone and nested inside a branch's `then`-side (including the branch's own
then-length byte).

**`main/build/generate.js`** — `projectWithoutCommands` exported, body unchanged. Nothing else in
the file touched.

**`renderer/forges/map/map.js`** — `eventContext(place)` gains its first parameter (confirmed it
took none before). Both placement-owned `editEvent` call sites (the "Edit event…" button and the
"Start from a template" flow) now pass `{ project: store.project, tilesetId:
currentMap().tilesetId, screen: currentScreen(), x: entity.x, y: entity.y }`. The common-event
path (`openCommonEventsEditor`) is untouched and still calls `eventContext()` with no argument.

**`renderer/forges/map/events.js`** — `defaultCommand`'s `arg === 'route'` case; `describeEnabled`'s
`'route'` case (reuses itself per leg via `legWithWho`); `commandRow`'s route branch:
canonicalizes `command.legs = routeLegs(command.legs)` at render time (a real removal from the
draft, before any rows/tools/adding-control are built); leg rows reuse the move/turn/wait row
markup minus the `who` select; the leg-adding control derives its three options from
`EVENT_COMMANDS.filter(entry => ROUTE_LEG_OPS.has(entry.id))`; the dead-page hint text widened to
name routes. The preview: a modal-local `MetatileRenderer` built once (lazily, on first use, and
reused across every route row and every rerender in the session) from `context.place.project`/
`tilesetId`; an exported pure `routeTrace(command, place)` function producing `{ caption,
instructions }` with the `segment`/`point`/`facing`/`pause` instruction vocabulary (a zero-distance
Move emits an explicit `point`, not an invisible zero-length segment); three distinct captions
(no-place/common-event, player-unknown-position, and the drawable self case); the pure function
re-filters its own input through `routeLegs` (the seventh defensive consumer, §3.3) independent of
the editor's own canonicalization. `offeredCommands` needed no code change — `route`'s
`IMPLEMENTED_COMMANDS` membership and the absence of any party/commonEvents/canSave-style gate
were already sufficient.

**`main/smoke.js`** — a "route authoring" step (add via "+ Add a command…", add a Move and a Wait
leg with real `<select>`/`<input>` interaction, assert the preview canvas is present, toggle `who`
to "The player" and assert the DOM swaps to the no-trace caption, toggle back to self and assert
the canvas returns, save, and assert the stored shape and the outside-the-modal summary line) and
a "route row-tool canonicalization" step (two fixtures — illegal leg first, illegal leg between
two admitted ones — injected via `store.commit` since `store.commit()` never runs
`normalizeProject`; Remove/Duplicate exercised on the real row buttons; both the DOM order before
Save and the persisted `store.project` shape after it asserted, never the modal's closure-private
draft).

**Tests** — `test/unit/routes.test.js` (new, 420 lines, 16 tests): the two same-session
byte-identity ROM comparisons (route vs. hand-chained standalone with `who: 'player'`; off-route ≡
no-route); the branch-nesting byte-identity check (JS-level, via `compileText`); the predicate
trio; the direct empty/all-off-route test; the exported `projectWithoutCommands` structural test
plus the advice-string case (reusing the exact "sample-rpg + Save + Move on UNROM 512" documented
refusal `test/unit/kernelbytes.test.js` already establishes, with the Move wrapped in a route);
both round-trips; the direct `routeLegs` admission test; seven pure `routeTrace` tests (three
caption states, an off leg, an unadmitted leg, the zero-distance `point` case, a full multi-leg
trace). `test/unit/project.test.js`: `FIXED_OPCODE_WIDTH` gains `move: 4, turn: 3, wait: 2`; a
route scenario added to the existing compiled-sequence scenario table; a dedicated block (mirroring
the file's own dangling-`call` precedent) checking a route with an unadmitted leg against an
independently hand-written expected sequence (`['move', 'turn', 'wait']`, never derived by calling
`routeLegs`); the new ordinal test asserting every real `EVENT_COMMANDS` entry's `opIndex()`
against a hardcoded `engine/constants.asm` table and that the virtual tail is exactly `['route']`,
contiguous and last. `test/unit/script.test.js`: the `nests: true` boundary test (64 wrapping
branch/choice levels around a route throws; 63 does not), isolating the flag from the existing
200-vs-60 check, which never exercised it.

`ROADMAP.md` and `CLAUDE.md` were not touched, per the brief.

## Deviations from the design document

1. **Leg-adding defaults reuse `defaultCommand`'s existing non-zero defaults (16px, 30 frames)
   rather than the literal `0`/`0` §9's prose mentioned.** A literal-zero default would silently
   add a no-op leg the moment it's added (a distance-0 Move, a frame-0 Wait both compile to
   nothing), which contradicts this codebase's own already-established convention for the
   standalone commands (`defaultCommand`'s own `dist`/`frames` cases pick 16/30 specifically to
   avoid a fresh, silent no-op). Reusing `defaultCommand(op, context)` and stripping the `who`
   field it also stamps is simpler than reinventing separate zero-based leg defaults, and it is
   single-writer-consistent: legs get the identical "never a silent no-op" defaults a standalone
   command already gets. No test in the design's own §13 pins a specific default value, so nothing
   in the test plan conflicts with this.

2. **Sabotage numbering: the brief's "test 6" and my final design document's own "test 6" name
   different tests.** The brief says "test 6 (make `isLive`'s route branch return `true`
   unconditionally)" — but in the design document as it stands after round 4's revision (verified
   by review 5, "ready to implement"), test 6 is "`FACE_KERNEL_ALLOWANCE` sharing," which the
   design's own text states explicitly *cannot* distinguish that sabotage (a route with a
   genuinely live Turn is live under both a correct and broken `isLive`). The test that *does*
   catch it is design test 7, "Direct empty-route and all-off-route test." I applied the sabotage
   the brief actually describes (`isLive`'s route branch unconditionally `true`) and confirmed it
   is caught by `test/unit/routes.test.js`'s `'an empty or all-off route costs a project nothing
   and does not turn on projectUsesText'` test (the implementation of design test 7) — not by
   anything literally labeled "test 6." Reported here rather than silently reinterpreting the
   brief or silently trusting the wrong test number.

3. **Two bugs found and fixed in my own first draft of the smoke-test additions, caught by
   actually running `npm run smoke` before treating the work as done** (not design deviations —
   implementation mistakes, reported for transparency): (a) the leg-adding dropdown's option-list
   check used `.filter(Boolean)` on option text, which does not exclude the non-empty placeholder
   option `"+ Add a leg…"`; fixed to filter by `option.value !== ''`. (b) Several DOM references in
   the route-authoring step were captured once and reused across `rerender()` calls, which replace
   the whole modal body (`fill` = `clear` + `append`) on every change — a classic stale-node bug;
   fixed by re-deriving the route row/block fresh after every `dispatchEvent`. (c) The
   route-authoring step originally called `store.undo()` twice ("the Save" and "the Add"), copying
   the shape of the Turn/Wait/Sting sections above it without checking that those extra commits
   actually existed for a route — adding a route, adding legs, and toggling `who` all mutate only
   the modal's own local draft (`rerender()`, never `store.commit`) until Save, so there is only
   ever one commit to undo. The extra undo silently popped one entry too many off the undo stack,
   which surfaced much later in the script as an unrelated-looking failure ("the duplicate did not
   carry the event across"). Fixed to a single `store.undo()`.

## The one-time implementation gate (§13 item 4)

Built the route-free `sample/` project from a clean `git worktree add` at `6a44850` (this session's
own starting point, so "pre-slice" and "post-slice" are the same commit — nothing was committed
during this implementation) and from the current working tree, via `node main/build/cli.js sample`
in each (equivalent to `npm run build:sample`).

- Pre-slice: `0e638aaaecf871b0479e09513e12b47ef7d24fe433c3142fb3369cfcb53a5253`
- Post-slice: `0e638aaaecf871b0479e09513e12b47ef7d24fe433c3142fb3369cfcb53a5253`

**Identical.** The worktree was removed after the comparison (`git worktree remove --force`); no
side effects on the shared working tree, and `sample/build/game.nes` was rebuilt in place via
`npm run build:sample` per the standing rules (never `npm run sample`).

## Sabotage evidence

Each applied via a direct edit, confirmed failing, then reverted and confirmed passing again
before moving to the next. No sabotage marker remains anywhere in the tree (`grep -rn SABOTAGE`
over `shared/`, `main/`, `renderer/` returns nothing).

1. **Design test 1 — reverse the emitted leg order.** `textcompile.js`'s route case:
   `.reverse()`d the mapped legs. `'a route compiles byte-identical to the same legs hand-chained'`
   failed with a byte-array mismatch (`deepStrictEqual`). Reverted; passes.
2. **Design test 1 — break `who` injection to always compile `self`.** `legWithWho`: hardcoded
   `who: 'self'` regardless of the `who` parameter. The same test failed identically (the fixture
   uses `who: 'player'` throughout specifically so this sabotage disagrees with the control).
   Reverted; passes.
3. **Design test 2 (the ordinal test) — moved `route` before `sting` in `EVENT_COMMANDS`.**
   `'EVENT_COMMANDS: every real-opcode entry keeps its engine constant value...'` failed
   immediately: `sting must compile to $1a... 27 !== 26`. Reverted; passes.
4. **"`isLive`'s route branch returns `true` unconditionally"** (the brief's own "test 6"; actually
   design test 7 — see Deviation 2 above). `isLive`'s route branch: `return true;` unconditionally.
   `'an empty or all-off route costs a project nothing and does not turn on projectUsesText'`
   failed: `a page whose only command is a dead route has no live commands — 1 !== 0`. Reverted;
   passes.
5. **Design test 12 — made `liveCommands` yield the route wrapper.** Removed the route special
   case from `liveCommands` entirely, so a route command falls through to the generic path (which
   has no `.legs` case, so its legs are dropped from the sequence too — an even more broken
   variant of "yields the wrapper"). `'liveCommands and encodeBody agree on the actual sequence of
   compiled opcodes'` failed at the scenario table's own route entry: expected `['route']`, got
   `['move', 'turn', 'wait']` (compiled) vs. the wrapper-yielding live sequence. Reverted; passes.
6. **Design test 13 — restored the filtered-position-vs-raw-array splice (skipped
   canonicalization).** `commandRow`'s route branch: rendered from a filtered *copy*
   (`legsFiltered`) without writing it back onto `command.legs`, so `listTools` kept splicing the
   raw array by the filtered row's position — round 2's own shipped defect. Ran the full
   `npm run smoke`: failed exactly as predicted —
   `fixture A: after Remove on the visible Turn row, expected exactly [Move] to remain, saw
   [Turn]`. Reverted; `npm run smoke` passes again in full (93 steps).

## Test/smoke counts

- `npm test`: **836 tests, 836 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo.**
- `npm run smoke`: **93 steps, all passed** ("Smoke test passed (93 steps).").
- The Mesen Lua layer was not run, per the brief — nothing in this slice touches the engine, NMI,
  or vblank budgets.

## Working-tree status

Only the files the brief scoped were changed, plus the new test file:

```
 main/build/generate.js        |   2 +-
 main/build/textcompile.js     |  18 +-
 main/smoke.js                 | 295 +++++
 renderer/forges/map/events.js | 370 +++++
 renderer/forges/map/map.js    |  40 ++-
 shared/eventrules.js          |  83 ++-
 shared/project.js             |  87 ++-
 test/unit/project.test.js     | 129 ++-
 test/unit/script.test.js      |  45 ++
 test/unit/routes.test.js      | 420 (new)
```

`ROADMAP.md` and `CLAUDE.md` are untouched. Nothing has been committed.
