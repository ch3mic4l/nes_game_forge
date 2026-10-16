# Large streamed worlds, phase 4: the Map Forge learns a streamed map (ROADMAP item 15)

Design record, written 2026-10-15 at commit C1 (the Streamed toggle, the size fields, Duplicate screen). Phases 1-3b
(`docs/design-streamed-worlds.md`, `-phase3a.md`, `-phase3b.md`) made a streamed map build and run; until this phase a
streamed map could be authored only by hand in the project JSON. The long-form historical design is
`docs/design-streamed-worlds-history.md` ("Phase 4 - Map Forge tooling"); this file is the as-built record.

## Goal

Author a streamed map in the Map Forge instead of in JSON, with no way for the toggle, or for the size fields in a
project that holds a streamed map, to add a validation error the project did not already have. A project with no streamed
map resizes exactly as it did before C1 (see "Scope" under the preflight). That is a gate on *new* errors, not a promise of a valid project:
an error the project already had is left alone (so a shrink can repair it, and a total already over 255 screens can
still be edited), the board's byte capacity (`checkCapacity`) appears only at Build (R3), and the structural-edit
paths (Add map, Duplicate map, promoting a screen to a new map) are unchanged. Phase 4 is **renderer-only**: nothing under `shared/`, `main/build/` or
`engine/` changes, so the identity fingerprint does not move and no ring certificate is renewed.

- **C1 (this record):** the Streamed checkbox, the size fields, Duplicate screen.
- **C2 (next):** the world overview (the navigator at 1 x 255 / 255 x 1 and at a full project-sized map).

## Rulings

Chris, 2026-10-15, on the plan:

- **Q1 = A.** Turning Streamed off on a map larger than 4 x 4 is refused with a message naming the size; nothing is
  lost. (B, cropping to 4 x 4 behind a confirm, was not chosen.)
- **Q2 = A.** The overview is the design's minimum: click-to-select, scaled, scrolls to the current screen.
- **Q3 = A.** The two fingerprinted wording nits (`generate.js` capacity text, the MMC3 `summary`) ride along only if
  `shared/` is touched anyway. It is not, so they stay deferred.
- **Q4 = A.** Commit each accepted commit locally; push once at the close of the phase.

After the S0 audit (the same day):

- **R1.** The "in the project's map JSON" wording in `shared/` stays as it is: still true, only incomplete.
- **R2 = B.** A streamed map has no in-place Duplicate room; it falls into the existing "another map / new map" flow
  with streamed-specific wording.
- **R3.** A column's board capacity (`checkCapacity`) appears only at Build; no IPC is added.
- **R4.** There is no `fillMetatileId` field.
- **R5.** Turning Streamed on is refused, with nothing committed, when it adds any `validateProject` error; the first new
  message is shown inline.
- **R6.** A Build-panel board change under a streamed map is left as it is: the Build summary goes red and the checkbox
  stays visible and clearable.

## The C1 decisions

Every decision is in one pure module, `renderer/forges/map/streamedui.js` (DOM-free, imports `shared/` only), so
`node:test` pins it; `renderer/forges/map/map.js` draws and commits.

1. **Decide before `store.commit`, never inside it.** `store.commit` records an undo entry and sets dirty even when its
   mutator does nothing, and `resizeMap` used to ignore `growOrShrinkMap`'s `null`, so a refused resize was a phantom
   edit. Every toggle and resize is now `plan -> commitIfAllowed` (`streamedui.js:223`; callers `map.js:831`, `map.js:1938`).
   A refusal sets `settingsNote` (`map.js:179`), which the next `renderMapSettings` shows once, in red, under the Streamed
   row and redraws the field back to the real value.
2. **The preflight asks the validator, restates nothing.** `planStreamOn` (`streamedui.js:117`) and `planResize`
   (`streamedui.js:203`) apply the candidate edit to a `structuredClone` and compare `validateProject`'s errors with the
   live project's. An error is *new* by **rule**, one for one (`newErrors`, `streamedui.js:65`), so an edit that keeps or
   lowers a violation of a rule the project already fails passes, an edit that adds a rule it did not fail is refused, and
   so is a second instance of one (a second map, a second screen). The refusal text is validateProject's own, word for
   word. `growOrShrinkMap`'s `null` (a streamed map's own grid rules) is worded by `streamedGridProblems`. The
   project-wide 255 total, which `growOrShrinkMap` never enforced, is caught the same way.
   - **The identity** (`ruleKey`, `streamedui.js:51`). A `validateProject` problem carries only `{ severity, where,
     message }` (no code, kind or map index), so there is no structured id to compare. A rule is its `where` plus its
     words with the count, the grammatical number that follows it and the punctuation taken out; text inside double
     quotes (a map's name) is kept verbatim, case included (`Map "A"` and `Map "a"` are two keys, U6d). A first version
     blanked digits only and refused a repair: "2 Give item / Take item commands do not name..." becomes "1 Give item / Take item command do not name..." when the shrink fixes one
     of two (review round 1, finding 1). U6e reads every `=== 1` / `!== 1` count ternary out of `shared/project.js` and
     checks each folds, so a new irregular noun or verb pair worded that way fails a test. It is scoped to those recognised
     forms and is not an exhaustiveness check: a `> 1` form or a plural helper is invisible to it (review round 2 found
     none in `validateProject` today; whoever adds one extends the scan).
   - **Already over the total is the same rule.** 256 -> 257 screens is the existing "holds N screens" rule speaking
     again, so it is allowed (and 256 -> 100 is the repair); only the first crossing, 255 -> 256, is refused. This is the
     accepted policy, not an absolute cap, and U6c pins it so it cannot be read as one.
   - `shared/project.js` already has `attributedErrors` for the library import. It was not reused: its skeleton is the
     same digit-blanking (the same singular/plural gap) and it calls a larger number worse, which would refuse 256 -> 257.
   - **Scope: only a project that holds a streamed map.** `planResize` returns `{ ok: true, noop: false }` at once for a
     project with no streamed map, so an ordinary-only resize is exactly the pre-C1 handler's, whatever the new screens add
     to `validateProject`. That is deliberate and is not because an ordinary resize cannot add an error: a new screen holds
     metatile 0, and a damaging metatile 0 turns combat and the message font on, which can introduce a Tile Forge error
     about `$A0-$FF` background art in an otherwise valid project (review round 2, P2; U6f pins it through the real
     `Store`). Inside a project that holds a streamed map every resize, an ordinary map's beside it included, is
     preflighted as above, and a repair shrink of an error it already has (U6b) is allowed.
   - **A confirmed resize is bound to the project it was planned on.** Undo stays reachable behind the "drop N
     doors/warps" dialog, so `commitAfterConfirm` (`streamedui.js`) reads `store.revision` before the wait and commits
     nothing if it moved after it (Undo, Redo, any edit, a replacement): the resize is cancelled with a settings note and
     never silently re-planned, for an ordinary map and a streamed one alike (U6g; the pre-C1 handler had the same stale
     commit; review round 3, P2).
3. **The Streamed checkbox** (`streamToggleState`, `streamedui.js:101`; drawn at `map.js:2132`). Always visible. A streamed
   map is always checked and clearable, even on a board that can no longer stream (R6), with a `note` carrying the
   validator's own capability sentence; an ordinary map on a board that cannot stream is disabled with that sentence as the
   reason. Whether a board streams is `streamCapable`; the sentence comes from `streamedBoardProblems` run on a one-map
   synthetic project, so drawing the box never clones the whole project.
4. **Turning off is per axis, not by area** (`planStreamOff`, `streamedui.js:129`; Q1 = A). Both axes must be at most
   `mapGridLimit({})`. 16 x 1 has an area of 16 and `normalizeProject` would still clamp it to 4 x 1 on the next load. The
   mutator **deletes** `streamed` and `fillMetatileId` (`applyStreamOff`, `streamedui.js:154`), so the map's JSON equals an
   ordinary map's; `streamed = false` would be dropped on the next save and rewrite a fixture.
5. **The size fields** (`sizePlan`, `streamedui.js:169`; `clampAxis`, `streamedui.js:187`). `max` and the clamp are
   `mapGridLimit(map)`. On a two-nametable board the dead axis of a streamed map is held at 1 and locked, with a one-line
   reason, and the axis is `streamRingMode`'s (1 = vertical mirroring scrolls sideways, so the *height* is dead; 2 =
   horizontal, the *width*). A non-number leaves the size alone and a fraction rounds. An unchanged size is a no-op, never a
   commit.
6. **Duplicate screen** (`hasDuplicateRoom`, `streamedui.js:235`; `duplicateFullMessage`, `streamedui.js:240`). A streamed
   map has no in-place room, because the core's `growthTarget` knows nothing of the live axis and would make a dead-axis
   shape of a 1 x 1 under horizontal mirroring. The picker's candidate filter and the in-place check are the same
   predicate (`map.js:873`), and the modal for a streamed source says it is sized with the size fields and never "4×4". The
   ordinary wording is byte-for-byte unchanged.

Departures from the S0 audit's proposal, each deliberate: the dead-axis field is locked only while it is 1, so a dead axis
already above 1 (the Build panel moved the board under the map) stays editable and can be set back to 1; the same-size
no-op and `NaN`/fraction handling are fixed in passing; the new-error preflight runs only in a project that holds a streamed map (an ordinary-only
project resizes exactly as before C1, even when the edit would add a validation error, which U6f pins; the first version
ran it for every project and refused such a resize), and a repair shrink of an existing error is allowed there, which U6b pins.

## Tests, and what each catches

`test/unit/mapstreamedui.test.js`, over every registered board and mirroring:

- **U1** turn-off per axis (16 x 1, 1 x 30, 5 x 1 refused; 4 x 4, 1 x 1 allowed): catches an area test.
- **U2** turn-off leaves the ordinary JSON: catches `streamed = false` and a leftover `fillMetatileId`.
- **U3** the checkbox state: catches hiding the box when the board cannot stream.
- **U4** turn-on refused with the validator's own message (2 x 2 on MMC3 H/V and MMC1 V, NROM, UxROM, camera off), allowed
  for 1 x 1 and 4 x 4 four-screen: catches a permissive toggle and a hard-coded rule.
- **U5, U5b, U5c** the dead axis equals the one `streamedBoardProblems` names, on every board; a dead axis above 1 is
  repairable; the clamp: catches swapped H/V and `LIMITS.mapGrid` left in the clamp.
- **U6** the project total, a streamed map's grid rules and the dead axis refuse; an ordinary-only project is unaffected:
  catches a per-axis clamp standing in for the aggregate.
- **U6f** an ordinary-only, normalized, valid project grows to 2 x 1 although the new screen adds a Tile Forge error (damaging
  metatile 0 plus `$A0-$FF` background art): size, one undo entry, undo restores. The converse, the same edit on an
  ordinary map beside a streamed one, is refused with no undo entry: catches the gate running for every project, and the
  gate dropped.
- **U6b** a repair shrink (2 -> 1 missing-item commands) is allowed on an ordinary and on a streamed map, through the real
  `Store`; **U6c** the already-over-total policy (256 -> 257 allowed, 255 -> 256 refused); **U6d** the rule identity
  (A -> B refused, a count or grammar change not, a second instance is new); **U6e** every `=== 1` / `!== 1` count ternary in
  `shared/project.js` folds to one rule (those recognised forms only); **U4b** switch-bound tiles refuse a turn-on.
- **index** every function above reads the *selected* map: a distinct map 0 gives a different answer, so a `maps[0]` fails.
- **U7** a refused plan never reaches the real `Store` (undo depth and dirty unchanged); an allowed one is one entry:
  catches a commit wrapping a refusal.
- **U8** no streamed map has duplicate room, the wording: catches the old `w*h < 16` check.
- **U11** (`test/unit/docclaims.test.js`, replacing the S6 Q1 tripwire): the README no longer carries the old caveats and
  says what the Map Forge now does; `map.js` has the wiring and no literal limit; `streamedui.js` restates no limit and is
  DOM-free. It pins what is present, not only what is absent.

`main/smoke.js`, six steps ("streamed 1" to "streamed 6"). Every navigation is `await window.__app.goTo(...)` followed by
`until` on the controls it needs, and every action waits on the state it expects, never on a fixed delay:

1. the toggle is one undo entry; a 2 x 2 on MMC3 and a camera-off turn-on are **refused** inline, with the project, the
   undo depth and the dirty flag unchanged;
2. the dead axis is locked and the height goes 1 x 30 then 1 x 100;
3. the project total refuses 1 x 255 beside a 4 x 4 map with the reason shown, no undo entry, no project change and no
   dirty flag; a project **already over** the total lets 240 -> 241 and then the repair to 100 through (U6c's policy, in
   the real window);
4. turn-off is refused on 1 x 100 and allowed at 1 x 4, deleting both keys;
5. Duplicate screen's wording for a streamed source and an ordinary full map, and the real picker offers a map with room
   but not **another streamed map**;
6. the Build panel moving the mirroring, and then the mapper to NROM, leaves the box visible, checked and enabled (the
   second with a note beside it), and **clearing it there** is one undo entry that undo restores.

The scenario keeps its assertion of exactly two number inputs.

## Next: C2, the world overview

`renderNavigator` draws one 64 x 60 canvas per screen in the centred `.canvas-stage`, which clips negative overflow: at
1 x 30 the first thumbnails are unreachable, at 255 x 1 about 129 are, and every edit rebuilds them all (about 120 ms at
240 screens). C2 gives a streamed (or larger than 4 x 4) map its own bounded scroll box with scaled cells, keeps the
current screen in view, keeps the legacy 64 x 60 thumbnails for ordinary maps of 4 x 4 or fewer (thirteen smoke selectors
find them), and stops `screenZoom` reserving the navigator's height. Pure layout and hit-test in `overview.js`, a unit test,
two smoke steps and a screenshot. ROADMAP item 15 closes at C2.
