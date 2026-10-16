# Large streamed worlds, phase 4: the Map Forge learns a streamed map (ROADMAP item 15)

Design record, written 2026-10-15 at commit C1 (the Streamed toggle, the size fields, Duplicate screen) and closed 2026-10-16 at
commit C2 (the world overview). Phases 1-3b
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

- **C1:** the Streamed checkbox, the size fields, Duplicate screen.
- **C2:** the world overview (the navigator at 1 x 255 / 255 x 1 and at a full project-sized map). **Phase 4 is closed with C2,
  and so is ROADMAP item 15.**

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

## C2: the world overview

`renderNavigator` drew one 64 x 60 canvas per screen in the centred `.canvas-stage`, which clips negative overflow: at
1 x 30 the first thumbnails were unreachable, at 255 x 1 about 129 were, and every edit rebuilt them all. C2 gives a
streamed map, and any ordinary map over 4 per axis, its own scroll box with scaled cells; an ordinary map of 4 x 4 or
fewer keeps the legacy thumbnails untouched (thirteen smoke selectors find them). Still **renderer-only**: the identity
fingerprint is byte-equal before and after.

### Decisions

- **One pure module, `renderer/forges/map/overview.js`** (DOM-free; imports only `LIMITS` and `mapGridLimit` from
  `shared/project.js`, so the "ordinary map" threshold is the limit itself, not a literal 4). `usesOverview(map)` (`:30`) is the
  single predicate for which navigator a map gets: `streamed === true`, or either axis over `mapGridLimit({})`. `overviewBox`
  (`:40`) bounds the room (width = the stage's, height clamped to 96..264 px, whatever the map). `layoutOverview` (`:59`) picks the
  **largest integer scale 1..4 at which the whole grid fits, else scale 1 and the box scrolls**, and reports the extent
  (`2*pad + n*cell*scale + (n-1)*gap`). `cellRect` (`:89`) and `cellAt` (`:105`) are exact inverses: the flat index is
  `row*gridW + col`, a point in the margin, a gap, past the last column/row, or not a number answers `null`. `scrollTarget`
  (`:138`) leaves a cell whose whole box (plus a gap) is already in view alone and otherwise centres it, clamped to the extent;
  `inView` (`:124`) asks the same question without moving anything. `changedCells` (`:178`) compares a per-cell snapshot (`cellState`, `:159`; a `Uint16Array` copy, because metatile ids exceed 255)
  with what is on screen, so a redraw touches only what changed.
- **Scale 1 when it does not fit, not 2 (a departure from the first sketch).** A scrolling box shows the most of the world at
  the smallest scale; a 1 x 30 column at scale 1 is 16 x 15 px per screen, about ten screens visible at the usual window height.
  The cost is small thumbnails; the cure (a larger box) is bounded by what the screen leaves, deliberately.
- **One canvas plus hit-testing, not a canvas per cell** (`map.js:242`, `overviewCellAt` `:450`). A 255-screen map as 255 DOM
  nodes was the cost being removed; with one canvas an edit, an undo or a redo redraws exactly the cells whose snapshot differs
  (`renderOverview`, `:488`), and the current screen's 2 px frame lives in the gap, so it is stroked on every pass. The box is
  `overflow:auto` with its own `max-width`/`max-height` (`:254` and `renderOverview`) and `flex-shrink: 0` (`:262`), a sibling of
  the screen in the stage, never a child that overflows the centred flex (headline 5 of the audit); while it is in the stage the
  stage centres `safe` (`renderNavigator`, `:573`), so what does not fit runs off the end a scrollbar reaches (Fix round 1, below).
- **Which navigator is in the stage** is swapped by `renderNavigator` (`:564`) when `usesOverview(map)` changes; the legacy path
  is the code that was there, untouched. The metatile renderer carries a `version` that moves only when the art changes
  (`renderer/forges/map/render.js:19-35`). New art, or a change in the drawing layout (grid shape, scale or extent: the `key`
  in `renderOverview`), clears `overview.drawn` (`map.js:495-502`) and so redraws every cell; nothing else does.
- **Selection** goes through one `selectScreen` (`:430`), shared by the legacy thumbnail and the overview: set the screen,
  clear the region selection, `renderScreen`, `renderNavigator`, **`renderMapSettings`**. The last is a departure that fixes a
  legacy bug: a thumbnail click left the panel's "Screen N name" label and field on the screen just left. It is the one change
  to ordinary maps' behaviour; smoke step 8 pins that the label now follows.
- **The current screen scrolls into view** (`renderOverview`, via `scrollTarget`) when the map, the screen or the layout changed,
  and when a resize of the box took the room a screen that **was** whole in view had (`keepInView`, via `inView`,
  `map.js:527-538`; Fix round 1). Never because a stroke merely repainted, and never for a screen the author had scrolled away
  from -- either would snatch the box from where they put it. Selection, a Build-panel change and a shrinking map go through it.
- **`screenZoom` reserve** (`:347`) is the overview box's (bounded) height plus the gap, not the height of a navigator that grew
  with the map; `observeSize(mapStage)` (`:2543`) relays the overview out before the screen, which fits to what is left.
- **Streamed always uses the overview, even at 1 x 1.** The alternative, legacy thumbnails for a small streamed map, was
  considered: C1's smoke steps do not rely on legacy thumbnails for a streamed map, and one predicate is simpler than two;
  the cost is small: a streamed 1 x 1 is drawn at the largest scale that fits, which in the normal window is 4 (a 64 x 60 cell,
  the legacy thumbnail's size); only a world too big to fit even at scale 1 draws 16 x 15 cells and scrolls.
- **Out of scope (Chris, Q2 = A):** warp/door overlays, zoomed thumbnails, pan/zoom.

### Tests, and what each catches

`test/unit/mapoverview.test.js` (20 tests), over 1 x 30, 30 x 1, 255 x 1, 1 x 255, 16 x 15, 17 x 15 and 4 x 4, including the
last column and row, and a range of box sizes:

- **U9** geometry and hit-test: the first three catch a transposed index (`col*gridH + row`), an off-by-one at the last column or
  row (or one past it), a gap or the margin answering a screen, and a column-major `cellRect`; the brute-force pixel map of a
  small overview proves the inverse for every pixel, not only cell centres.
- **U10** layout and predicate: the extent fits or the box scrolls on the axis it exceeds, never where it cannot (catches a
  scroll flag that lies); the largest scale that fits (catches fixed 64 px cells and "always the smallest"); the bounded box
  (catches a box that takes whatever the stage has left); the predicate per axis (catches "overview for every map", "streamed
  only", and a test by area).
- **U12** `scrollTarget`: whole cell in view, an in-view cell leaves the box alone (catches centring on every click), far cells
  centre and clamp to the extent (catches no clamp, no scrolling). `inView` (Fix round 1): agrees with `scrollTarget` (a screen
  is in view exactly when the target leaves the box where it is), counts the gap round the cell to the pixel, and answers
  "hidden" once a view shrinks under a screen that was whole in it (catches an always-yes `inView`, one that ignores an axis
  or the gap).
- **U13** `changedCells`: nothing drawn means all stale and drawn means none; one edit is one cell however many screens exist
  (catches a full rebuild per edit); selecting redraws the two frame cells; a start-marker move redraws two; an id above 255 is
  compared, not truncated; a reshaped grid is stale only where it has no drawn cell.
- `cellLabel`, the flat index and the column and row in the tooltip.

`test/unit/docclaims.test.js` has a new test pinning what this record claims: the README's streamed-worlds row says a streamed
map's screens appear as a scrolling overview; `map.js` has the predicate, the swap, the shared `selectScreen`, the box's
own overflow and bounds, and the version check; `overview.js` is DOM-free, imports only `shared/project.js` and states no
literal limit; `render.js` bumps `version` only when the art key changes.

`main/smoke.js`, three more steps after "streamed 6", in the real window. Every wait is on a state: after a stage resize, on the size the Forge reports having laid out for
(`data-laid-out` on the stage, set by the size observer after each pass, `map.js:2547`; the earlier fixed `wait(150)` there is gone),
and the one polled wait is `window.resizeTo` taking effect, bounded at three seconds:

7. **streamed 7, a 1 x 30 column on MMC3 horizontal:** no legacy thumbnails, two size inputs, the first cell and the scroll box
   inside the stage (which, in the usual window, has no overflow, and whose children lie inside it, because the centred stage hides top/left overflow
   from `scrollHeight`); in a 900 px stage the screen stays at zoom 2 and nothing is cut off, in a 1100 px stage it grows to zoom
   3 beside the same box (catches a reserve that is zero, or one that grows with the map); a click on row 5 selects screen 5 and
   the "Screen 5 name" label follows; the last row, once scrolled to, selects screen 29; one stroke redraws exactly one cell, a
   rename none, a metatile-art change all thirty; shrinking to 1 x 20 scrolls screen 0 into view (a selection change with no
   click); a click on a cell shown only in part brings the whole cell into view (catches no scroll-into-view). At the minimum
   window (`atMinimumWindow`, 1500 x 680 and 1080 x 680, by a real `window.resizeTo`; if the window manager refuses, a fallback pins
   the stage to approximately the remaining size calculated from the window-size deltas -- an approximate constrained-stage regression, not the real window: it narrows the
   stage only, so it does not reproduce the reflow a real narrow window causes (the toolbar wraps and takes another 28 px at
   1080 x 680), which only a resize that succeeds covers; the step's log line names which path ran): the box keeps its height, the stage
   scrolls to the whole box, the top of the screen is not above the stage, and the first cell and the last are reachable
   (`elementFromPoint` finds the canvas at their centres) and selectable. (1080 wide is narrower than the screen at zoom 2, 512 px,
   so the stage has always scrolled sideways there; that width is not asked to avoid it.)
7b. **streamed 7b, a 17 x 15 four-screen map and a 255 x 1 row:** a click at (3, 2) selects screen 37, at (16, 14) screen 254,
   at (16, 0) screen 16, at (0, 14) screen 238 (a transposed index lands elsewhere; the last column and row work); a click in a
   gap selects nothing; selecting then stroking redraws three cells; a taller stage shows all of 17 x 15 at once, and in the
   usual stage it scrolls; the 255 x 1 row's first cell is in the stage and its box, and a click at (254, 0) after scrolling
   selects screen 254. A stage made 70 px shorter (17 x 15) or 150 px narrower (255 x 1) under the selected last screen at the
   same scale leaves that screen in its box; scrolled away from it, a stroke and a further shrink leave the box where the author
   put it, whether the stage shrinks in height (17 x 15) or in width (255 x 1: the box scrolled to the start stays at the start
   through a 150 px narrower stage and back); the 255 x 1 row is then also checked at the minimum window.
8. **streamed 8, an ordinary 4 x 4 map:** sixteen 64 x 60 canvases, no overview in the page, two number inputs, and a thumbnail
   click moves the "Screen N name" label (catches the overview used for small maps, and the `selectScreen` fix dropped).

Screenshots (`FORGE_SHOT_FORGE=map`, `FORGE_SHOT_SETUP`): `handoff-next/mapforge/c2/overview-1x30.png` and `overview-16x15.png`. Fix round 1 adds `handoff-next/mapforge/c2-fix1/overview-1x30-min-window.png`, the 1 x 30 map at the 1500 x 680 minimum window (the stage scrolled to its end: the lower part of the screen, then the overview box with the current screen framed).

### Measured: the cost of a stroke

A real pointer stroke on the screen canvas, in the built Electron window, on a 255-screen map (17 x 15, four-screen), median
of seven strokes, the old code (a `git archive HEAD` copy) and the new one interleaved three rounds on a machine at load ~21
(`handoff-next/mapforge/c2/ab-*.log`, `probe.mjs`): **1007 / 1141 / 553 ms before; 56 / 62 / 32 ms after** (rounds 1 / 2 / 3). At 255 x 1: **848 / 612 / 634 ms
before, 127 / 49 / 29 ms after**, in the same round order (the 127 is the first round, the noisiest). A stroke did two full
navigator rebuilds (the change event's `renderAll` and the pointer-up's own `renderNavigator`); both are now a diff that scans
the snapshots: the first after a stroke draws the one changed cell, the second draws none. The probe times the whole synchronous
handler, so it does not say where the ~30 ms that remain goes. A full rebuild per edit is caught by U13 and by smoke step 7's
redrawn-cell count, not only by this measurement.

### Fix round 1 (the review of C2)

Two P2 findings and the record, all renderer-only.

- **The overview collapsed at the supported minimum window height** (`main/main.js` `minHeight: 680`). The stage is a column flex
  box; when the screen (at its smallest zoom, 480 px), the gap and the box outgrew it, the one child allowed to give way was the
  scroll box, which was squeezed to `clientHeight` 0, and the centred stage put the excess above the screen where no scrollbar
  reaches. Now the box has `flex-shrink: 0` (`map.js:262`) and, while the overview is in the stage, the stage is `safe center`
  on both axes (`renderNavigator`, `map.js:573-574`; cleared again when the legacy navigator returns, so ordinary maps keep the
  stage's own centring). The excess runs off the bottom (and right), where the stage's scrollbar reaches it. Caught by smoke
  `atMinimumWindow` (above): a box free to shrink fails on its height, the old centring on the screen's top edge being above the
  stage.
- **A viewport resize could hide the current screen.** The "shown" key (map, screen, layout) ignored the box's client size, so
  shrinking the window at an unchanged scale skipped `scrollTarget`. Adding the size to the key would have fixed that and made
  every resize snatch a box the author had scrolled elsewhere, so `renderOverview` remembers the box's client size
  (`overview.view`) and, when it changed, asks `inView` whether the current screen was whole in the **old** view at the present
  scroll offsets; only then does it scroll (`keepInView`). Caught by smoke 7b: a shorter stage (17 x 15) and a narrower one
  (255 x 1) under the last screen; and by the same block's "scrolled away" half, which fails an implementation that scrolls on
  every repaint or on every resize.
- **Tests' limits, closed.** U10 cannot see the DOM collapse and U12 cannot see its caller skipping `scrollTarget`; the smoke
  steps above are the tests that can, and each was shown red against the wrong implementation
  (`handoff-next/mapforge/c2-fix1/sabotage-*.log`).
- **The record:** the corrections to the redraw, 1 x 1, wait, measurement and attribution statements above.

### Closed

Phase 4 ships in two renderer-only commits (C1, C2); the identity fingerprint did not move, no ring certificate was renewed,
and the two deferred wording nits in fingerprinted files stay deferred. ROADMAP item 15 is done.
