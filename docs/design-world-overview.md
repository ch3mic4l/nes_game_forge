# Design: the world overview (ROADMAP item 7, last piece)

Status: **shipped** -- C1 `eb3c254` (World view, layout, start/title markers, navigation) and C2 (doors, warps, events,
talkers, links; closes ROADMAP item 7). Corrections the build made are listed under "Built" at the end. Written as design
round D2 (D1 fixed per review 1). **No product code is written by this document.** It
settles what ROADMAP item 7's last open bullet ("A **world overview** showing starts, warps and event markers")
builds, with Chris's four rulings (quoted at the end) held fixed. `docs/design-maporg.md` §12 sliced this out;
`docs/design-streamed-worlds-phase4.md` C2 shipped the *per-map* overview (`renderer/forges/map/overview.js`), whose
geometry discipline this reuses. That word already means the per-map scroll box, so the new thing is the **World
view** (the toolbar button says "World"); `overview.js` and `usesOverview` stay as they are.

## What the data actually holds (probe)

`handoff-next/worldview/d1/probe-counts.mjs` (read-only `loadProject`) found: `sample/` is 2×2 + 1×1 maps, 5 screens,
start at map 0 screen 0 (112,112), title map 1, **1 door** (screen 3 → 0, same map), **0 warps**, 2 event actors (both
*interact*) and 1 dialogue-only actor; `sample-rpg/` is one screen with a start, no title, no door, no warp and 1 event
actor; the four save-check fixtures are 3 screens each with 1 event actor and no door or warp. No checked-in fixture has a
cross-map link, a warp, a dangling target, a streamed map or a map past 4 × 4, so those cases are built in memory or in
`mkdtemp` directories. The ceilings size the design: 255 screens and 8 actors per screen (`LIMITS.entitiesPerScreen`), so
up to 2,040 placed actors. `probe-layout.out` measures extents (255 × 1 at scale 4 is 16,848 px wide, 1 × 255 is 15,842
tall); `d2/probe-alloc.out` adds the mixed-shape worst case.

## 1. Markers: the data

**Decision: a marker is a *place*, a link is a *destination*.** Every placed actor yields at most one marker; every
door actor and every `warp` command yields one link. So "50 warps from one cutscene actor" is 1 marker and 50 links,
and a link can be hidden without hiding where it starts.

| kind | source | position | tooltip |
|---|---|---|---|
| `start` | `project.project.startMap/startScreen/startX/startY` | the start pixel | "Start — Greenwood · screen 0, at 112,112" |
| `title` | `titleMap/titleScreen`, only when `titleMap !== null` | the screen's top-left tag | "Title screen" |
| `door` | a placed entity whose actor `behavior === 'door'` (the engine's and `buildEventIndex`'s test) | the entity's `x,y` | `entityLabel`, "Door → Castle · Throne room, lands at 112,112" |
| `event` | a placed entity with ≥1 event page that is not a door | the entity's `x,y`, glyph by `effectiveTrigger` | `entityLabel`, trigger, page count, the warps it makes, `compiled` or "switched off" |
| `talk` | a placed entity with no event pages and `effectiveDialogue(entity) !== ''` | the entity's `x,y`; off by default (a filter) | `Says “…”` (60 chars, as `buildEventIndex` does) |

A door that also has event pages stays one `door` marker; its warps are still links. An actor whose authored pages all
compile to nothing keeps its one `event` marker with `compiled: false`; if it also has plain dialogue the ROM runs that
(`effectiveDialogue` restores it), so the tooltip says "switched off; says “…” instead". Not markers, by decision:
pickups, patrollers/chasers, encounters, `hideSwitch` state (not W1's "starts, warps and event markers", and each would
multiply the dots; a later filter can add them). `title` is not in W1's words but is the same kind of fact as the start.

**Scope note.** Static screen targets exist only in door actors, `warp` commands and the start/title pointers. Not
links: item effects, route legs (move/turn/wait), battle exits (back to the world, or the existing game-over/restart
path), Continue (runtime saved location) and edge adjacency (not a door or warp operand). Title, new game and restart
reuse the title/start markers; a title marker does not mean its screen's actors run during the title.

**Which command walk: `allCommands` for what is mentioned, plus a structural `compiled` flag.** The shared walks
answer different questions (`shared/eventrules.js`: `allCommands` "what is mentioned", `liveCommands` "what compiles").
A world map is an authoring tool: a warp the author switched off, put on a page `compiledPages` drops or in a choice
option past `CHOICE_LIMITS.options` is still where they mean the player to go, so it is shown dashed and grey, "(switched
off)". `compiled` is **structural compilation status, never a promise the ROM executes it**: `liveCommands` does not
evaluate page conditions, the engine skips a `call` past `CALL_STACK_DEPTH` 4 (`engine/constants.asm:224`), and a `warp`
ends the whole script (`engine/script.asm:361`). Tooltips say "compiled" / "switched off", never "will run".

**Common events, with call-path status.** A `warp` in a common event runs from whichever actor `call`s it. Per root
actor, a `call` resolves by `commonEventId(command.event)` against the ids `resolveCommonEventIds(project.commonEvents,
project.commonEventSeq)` gives each entry (what the compiler does for a live, unnormalized project,
`textcompile.js:211-229`), and a callee counts as compiled only if its id is in `liveCommonEventIds(project)`. A command's
local status is membership in the identity `Set` that `liveCommands(page.commands, CHOICE_LIMITS.options)` yields over
`compiledPages(event)` (empty for an unadmitted body). The expansion is a worklist of `(calleeId, p)`, `p` = every call
on the path is compiled: it starts from the root body's `call`s with `p` = that call's local status; a popped `(id, p)`
is skipped unless it improves what is recorded for `id` (not reached, or reached with false and now true); it emits a
link per warp in the body with `compiled = p && local status`, and pushes each `call` in it with `p && that call's
local status`. A link's identity is `(root actor, warp command)` and its `compiled` the OR over every path, so a live
path is never hidden by an earlier dead one and visiting order cannot matter. Each id is visited at most twice per
root, so cycles terminate; a `call` to a missing id yields nothing. Each link carries `via`, the id and name of the body
holding the warp.

**Unresolved targets and landings.** A stored target is a loose 0-255 byte; `canonicalizeFlat(value, flat.length)`
(`shared/project.js:1480`) is the compiler's clamp, so every target resolves through it into `{ stored, resolved,
dangling: stored >= flat.length }`. A dangling link is drawn **to the screen the ROM uses** (the last), dashed in the
warning colour with a "!" on its marker, and never dropped; the tooltip says "points at screen 200 but the project has
5; the ROM goes to screen 4". A landing resolves at data resolution too: `x` to 0-240, `y` to 0-224 (`textcompile.js:270`;
doors normalize alike, `shared/project.js:5181`), a missing door landing to `DOOR_LANDING_DEFAULT`; a marker's own pixel
is the actor's stored `x,y` clamped into the 256 × 240 cell. A door pointing at its own screen and spot is a `self` link
(a ring, §3), not an error.

**Where it lives: a new pure module, `renderer/forges/map/worldmarkers.js`**, importing only `shared/` and
`shared/eventrules.js` (never `eventlist.js` or `events.js`, which import `ui.js` and cannot load in a node test).
`buildWorldMarkers(project)` returns `{ start, title, markers, links, byScreen }`:

```
marker: { kind, flat, mapIndex, screenIndex, entityIndex|null, x, y, title, trigger?, compiled?, says?, hasLinks }
link:   { kind: 'door'|'warp', from: { flat, mapIndex, screenIndex, entityIndex, x, y },
          to: { flat, mapIndex, screenIndex, x, y }, stored, dangling, compiled, via|null, self }
byScreen: Map flat -> { markers: [...], out: [links], in: [links] }
```

**One definition of each fact (single-writer).** `eventlist.js` imports `doorTarget(project, flat, entity)` from this
module for its `→ label at x,y` line and keeps its wording for a dangling target (`eventlist.test.js` pins it), so the
dependency runs that way. "Which fields hold a screen reference" is `remapScreenReferences`'s (`shared/project.js:1510`);
W4 forbids editing `shared/`, so the read side cannot share its code. The module instead exports
**`referenceInventory(project)`**, the audited list of stored references the remapper rewrites: every placed entity's
`props.toScreen` (door or not; the remapper rewrites it unconditionally) and every `warp.screen` found by `allCommands`
over every page of every body, **each common-event body once, called or not**. §7's M6 holds inventory and remapper
together and a change detector makes a future field a red test. The expanded per-actor links are a different quantity,
tested separately.

## 2. Layout of the whole world

**Decision: maps in project order, packed left to right and wrapped into rows ("shelf" packing), one *block* per map.**

```
 Greenwood · 2×2            Title · 1×1        Caves · 1×30 streamed ...
 +----+----+                +----+             +----+
 |  0 |  1 |                |  4 |             | 5  |      a block = header strip
 +----+----+                +----+             +----+         + the map's grid (cells as overview.js lays them)
 |  2 |  3 |                                   | 6  |      a row wraps when the next block would pass the box;
 +----+----+                                   +----+      a lone over-wide block takes its own row and the box scrolls
```

Project order is the flat-index order every door and warp number means, and `docs/design-maporg.md` §12 retracted
regrouping by `map.folder` ("fakes an order it does not have"); a block shows its folder as a `[folder]` prefix. A single
column wastes width; a bin-packer breaks "block N is map N".

`renderer/forges/map/worldlayout.js` (new, pure, DOM-free, imports `shared/` and `overview.js` only):

- `layoutWorld(maps, box, scale)`, `maps = [{ gridW, gridH }]`, `box = { width, height }` (the scroll box's client
  size), returns `{ scale, blocks, width, height, scrollX, scrollY }`. A block is `{ mapIndex, x, y, w, h, gridX,
  gridY, grid }`; `grid` has exactly `overview.js`'s layout shape, the header strip is `WORLD_HEADER` (14 px) above it,
  a block is at least `WORLD_MIN_BLOCK_W` (96 px) wide, blocks are `WORLD_BLOCK_GAP` apart, the world has `WORLD_PAD`
  round it (the design gave no values; the extents it quotes, 4,336 × 4,190 and 8,400 × 8,060 for the mixed world and
  16,848 × 94 and 112 × 15,842 for the longest, fix `WORLD_PAD` = 8 and `WORLD_BLOCK_GAP` = 14, and `worldlayout.test.js` L1 pins them). A block wraps when `x + w` would pass `box.width - WORLD_PAD` and the row is not empty; a row is as tall as
  its tallest block; `scrollX`/`scrollY` are true exactly when the extent exceeds the box on that axis.
- `worldCellRect(layout, mapIndex, screenIndex)` and `worldHit(layout, x, y)`: **exact inverses**, the
  `cellRect`/`cellAt` discipline. A point inside `worldCellRect(m, s)` answers `{ mapIndex: m, screenIndex: s }` and
  nowhere else does; a header-strip point answers `{ mapIndex, header: true }`, kept distinct from any cell; the margin,
  the gaps and anything outside answer `null`. Per-cell arithmetic is `overview.js`'s `cellRect`/`cellAt` called on
  `block.grid` with block-relative coordinates, not a second copy.
- `chooseWorldScale(maps, box)` (Fit): the largest integer scale 1..4 at which the whole world fits with no scrolling.
  **If none fits, the fallback is 2** (a 1× cell is 16 × 15 px, too small for a marker): a fallback, not a minimum, so when
  only 1× fits whole Fit picks 1. The toolbar offers Fit · 1× · 2× · 3× · 4×; a choice overrides Fit, and every scale is
  always offered because nothing allocates in proportion to the extent (§5).
- `worldScrollTarget(layout, mapIndex, screenIndex, view)` and `worldInView(...)` use `scrollTarget`'s rule (leave a
  whole-visible cell alone, else centre and clamp). `overview.js` gains three **behaviour-identical extractions** so the
  arithmetic is not copied: `gridLayoutAt(gridW, gridH, scale)` (geometry fields only: `gridW, gridH, scale, cellW, cellH,
  gap, pad, width, height`), `scrollTargetFor(rect, gap, extent, view)` and (the third, added in C1 so that `worldInView` does not copy `fitsAxis`) `inViewFor(rect, gap, view)`, which `inView` now calls with `cellRect`. `layoutOverview` becomes `{ ...gridLayoutAt(...),
  scrollX, scrollY }`, the flags still computed from the box, so its return shape is unchanged.
- `blockLabel(map, mapIndex)`: `[folder] Name · 2×2` plus ` · streamed`; the DOM side truncates to the block width.

**The box.** It fills the stage (`stageInner()`), is `overflow: auto` with `scrollbar-gutter: stable` (so `clientWidth`,
which the wrap uses, never changes when a scrollbar appears and re-wraps the world), and is constrained to the stage
with `flex: 1 1 0; min-width: 0; min-height: 120px; max-width: 100%`: a flex child otherwise grows to its content.
Being its own scroll container, both ends of a scrolled axis are reachable (C2's lesson, fixed there by `flex-shrink: 0`
and `safe center`).
*Build correction (C1):* with `scrollbar-gutter: stable` and no vertical scrollbar showing, Chromium (Electron 38) takes the
gutter out of `clientWidth` but not out of the range the box may scroll, so a surface exactly the world wide could never
be scrolled its last gutter-wide (15 px) strip: at the end of a 255 × 1 row the last cell was cut off by 5 px, found by the
W4 check that the last cell and its gap are whole in the view. The surface is therefore the world's width plus the measured
gutter (`box.offsetWidth - box.clientWidth - 2 * box.clientLeft`), blank and hit-tested as nothing; `data-world-extent` and
every layout figure stay the world's own.

## 3. Links

**Decision: a link is a quadratic curve with an arrowhead at its landing point, drawn on the overlay in three modes:
All, Focus, Off.** It runs from the source marker (the door actor's pixel) to `to.x, to.y` inside the target cell, both
mapped to world pixels by `scale / 16`, so the arrow lands where the player would; the landing gets a small ring.
Each is a pure function of its endpoints in `renderer/forges/map/worldlinks.js` (`linkPath(link, layout)`):

- **within a screen**: a short arrow; if the endpoints are closer than a marker (`self`), a ring with an arrow stub.
- **within a map / across maps**: the same curve, longer across maps, drawn over whatever blocks lie between. Each is
  stroked twice, a 3 px dark halo under a 1.5 px coloured line, so it reads over any thumbnail. Colour is by kind
  (door, warp); dashed grey for switched off; dashed warning colour for dangling.
- **many to one target**: arrows converge on their own landings; where landings coincide the tooltip counts them
  ("3 links land here"). Nothing is offset or de-duplicated, so none is hidden.
- **two-way pairs**: every link bows to the **same side of its own directed chord**: the control point is
  `mid + bow · n`, `n` the unit normal of `from → to` rotated +90° (`n = (−dy, dx)/len`), `bow = clamp(0.18·len, 6, 40)`.
  Reversing the chord reverses `n`, so A → B and B → A bow to opposite sides by construction, always the same way for
  the same pair. There is **no index term**: D1's `from.flat < to.flat ? +1 : −1` reversed `n` back and put both
  directions on one curve (`d2/probe-curve.out`, both at (50, 20)). A zero-length chord is the `self` ring.

**What keeps 50+ links legible.** All draws every link at reduced alpha and the *focus* screen's links (out, in and self)
at full strength; Focus draws only those; Off draws none. The focus screen is the one under the pointer, else the current
one. The default is All up to 32 links and Focus above (`defaultLinkMode(count)`, pure); the toolbar overrides it until
the Forge is left. Markers are always drawn, so a door without its link still shows it is a door. `linkFocus(links,
byScreen, flat)` returns the incident set.

## 4. Interaction

**Entering and leaving.** A **World** toggle in the Map Forge toolbar (`data-world-toggle`, no `data-tool`, so no
`[data-tool]` loop sees it). On: the editing controls (tools, checkboxes, bind selects, zoom) are hidden by one root
class, `mapStage`'s children are swapped for the World box (the swap `renderNavigator` already does between the legacy
thumbnails and the overview, on the same element, so the stage's size observer, `stageInner()` and `data-laid-out` keep
working), and the toolbar shows scale, link mode and marker filters. Off: the toggle again, or **any click on a screen,
marker or link**, which opens that screen. The side panels stay live, so a rename or metatile edit visibly updates the view.

**Clicks**, all through one synchronous `openFromWorld({ mapIndex, screenIndex, entityIndex? })` in `map.js`:

| click on | opens | also |
|---|---|---|
| a screen / the `start` or `title` marker | that screen | |
| a map header | that map's screen 0 | |
| a `door`/`event`/`talk` marker | the marker's screen | scrolls the actor's row into view and focuses it (`findEvent`'s post-render statements, `map.js:1199-1201`, without its async modal) |
| a link, anywhere along it | the link's **target** screen | |

`openFromWorld` sets `state.mapIndex`/`screenIndex`, clears `state.regionSelection`, turns the mode off and calls
`renderAll()` once. It uses the Forge's own state, not `app.goTo`: nothing leaves the Map Forge, so there is no
navigation context and no `selectionToken` window. **The World view's boundary is local to it**: no `await`, no
`import(`, synchronous handlers, no `store`. The general rule stands (`docs/reference-electron-layout.md`): a handler
that awaits re-reads `store.project`, compares `store.revision` taken before the await and checks it is still mounted.
`docclaims.test.js` pins that `world.js` has no `await`/`import(` and that `openFromWorld` is a non-`async` function
without one; smoke W2 reads the result in the same task as the click, which an async path could not satisfy.

**Hover and tooltip.** `.world-surface` is the **sole pointer target** (both canvases are `pointer-events: none`): it
supplies the coordinates (its own `getBoundingClientRect`, which includes the scroll offset) and carries the native
`title`, set on pointer move and cleared when nothing is hit. Those coordinates are **full-world pixels**, never window
pixels: `worldHit` and `worldCellRect` never see the drawing window (§5, "Two coordinate frames"). One pure lookup (marker, then link with a 3 px tolerance,
nearest wins, ties by smaller `from.flat`, then cell) feeds focus and `title`: a cell reads "Greenwood · Screen 3 — Cave
mouth (col 1, row 1) · 1 door, 2 events", a marker its §1 line, a link "Door ‘Cellar door’ → Castle · Throne room at
112,112 (click to go there)" (plus "dangling" or "switched off").

**Nothing stale survives a project change.** `world.hover`/`world.focus` hold **no indices**, only the pointer's last
pixel, re-resolved through the new layout and the new `buildWorldMarkers` result on every render. The layout and markers
are replaced wholesale on each project-driven render (`renderAll` is synchronous, so no event arrives between a change and
its re-layout) and a click reads the current result at event time, never a closure over an earlier render. The picture
snapshots do persist, but each is validated by `worldBlockKey`, which includes `mapIndex` and position (§5), so a block
shifted by a delete or reorder is redrawn whole and never diffed against another map's snapshot. That makes delete,
reorder, undo and redo safe (§7, W6).

**Lifetime of the mode.** `state.world` lives in `mount()` beside `state.mapIndex`. A commit goes `store` →
`onProjectChange` → `renderAll()`, which draws the World view when the mode is on. Undo/redo replace `store.project` with
a clone, so the view reads it afresh and keeps only by-value snapshots; a map delete goes through `onProjectChange`'s
existing clamp. **A project switch resets the mode, decided here**: the store's `open` remounts the
Forge, and the mode must not outlive the project it described. Leaving the Forge resets it too (R4, accepted), as
`state.mapIndex` does. There is no keyboard shortcut and no global listener. **The scroll listener is on the World box
and is new work for `destroy()`:** `leaveWorld()` (the toggle, `openFromWorld`, leaving the Forge) and `destroy()` both
remove it, drop the window and every snapshot, and discard the box with its canvases; `destroy()` additionally calls
`stopWatchingStage`. The flush the listener calls is synchronous and queues nothing, so nothing is left running (§5, "What
is stale, and when").

**Read-only, evidenced rather than hoped.** `world.js` and the three pure modules do not import `renderer/store.js`;
`map.js` hands the DOM side `getProject = () => store.project` and `openFromWorld`. A passed project is still writable
without a store import, so behaviour is checked: the pure modules run on a deep-frozen project, and smoke compares
`store.revision`, undo depth, `store.dirty` and `JSON.stringify(store.project)` before and after entering, hovering,
clicking and leaving. `docclaims.test.js` pins that the four World files mention no `commit(`, `beginStroke`, `touch(`
or `store`, and that `world.js` imports `worldHit`, `worldCellRect` and `buildWorldMarkers` (the pure helpers, not a
private copy). Existing side-panel edits remain authored writes; the promise is about World gestures.

## 5. Drawing and updates

**Decision: a surface sized to the world, with two canvases sized to the window.** The scroll box holds
`div.world-surface`, `position: relative` and sized to the layout extent (a `div` has no backing store), under which sit
a *picture* canvas (header strips and thumbnails) and an *overlay* canvas (markers, links, start/current/hover frames),
both `pointer-events: none` (§4) and neither a `canvas.pixels`. Each is only as large as the **window**, a
rectangle in full-world pixels: the box's viewport plus `WORLD_WINDOW_MARGIN` (256 px) on every side, clipped to the
extent. It is re-placed, and both canvases repainted, by one synchronous flush (below) when the viewport comes within
`WORLD_WINDOW_SLACK` (64 px) of an uncovered window edge.
D1 sized both to the whole extent, unbounded for mixed shapes: a 127 × 1 map plus a 1 × 128 map is 4,336 × 4,190 at 2×
(139 MiB for the pair) and 8,400 × 8,060 at 4× (517 MiB), under D1's 16,000 px guard (`d2/probe-alloc.out`). A window
pair is 11 MiB at 900 × 520, 30 MiB at 1920 × 1080 and 89 MiB at 4K for any world, so there is **no extent guard and
every scale stays available** (§2). The overlay is separate because it repaints on every hover, which must not repaint
255 thumbnails.

**The window and its one flush.** This is the drawing mechanism's state and ordering contract.

- **Pure parts, `worldlayout.js`.** `view = { left, top, width, height }` is the box's `scrollLeft`, `scrollTop`,
  `clientWidth`, `clientHeight`, clamped inside the extent by the function. A window is `{ x, y, w, h }`, integers in
  full-world pixels. `windowRetains(win, layout, view)` is true exactly when `win` is no wider than `view.width + 2·256`
  nor taller than `view.height + 2·256`, lies inside the extent, **and** the viewport grown by `WORLD_WINDOW_SLACK` on every
  side, clipped to `[0, width] × [0, height]`, lies inside `win`; that grown rectangle is the *inner zone*. The size bound is
  what keeps the area bound below true of a window returned by identity: a window made for a larger viewport still covers a
  smaller one, so after a viewport shrink coverage alone would keep the large canvases for good. Every window `worldWindow`
  itself makes for the same-size viewport satisfies it, so no scroll position retains less than it did. Clipping makes the zone inclusive at the world's edge, so a window clipped to an edge
  never asks for coverage beyond the extent and does not thrash there. `worldWindow(layout, view, prev)` returns `prev`
  itself (the same object) when `prev` is non-null and `windowRetains`, else the ideal window: the viewport grown by
  `WORLD_WINDOW_MARGIN`, clipped to the extent. A moved window therefore depends on the layout and the view only, never
  on history, so returning to an earlier scroll position yields the earlier rectangle exactly; recentring leaves 256 px
  of cover against 64 px of slack, so the next move needs at least 192 px of travel on some axis. Always: the window
  contains the clipped viewport; its area is at most `(width + 2·256) × (height + 2·256)`, for a `prev` too (a `prev` above
  the bound is recomputed); a `prev` that exceeds the current extent is not retained. A viewport shrink therefore needs no
  caller rule: the resize flush's `worldWindow` call returns a new window, `flushWorld` sees `win !== world.win`, and both
  canvases are resized and repainted in that same task, with the scroll offsets untouched. `windowRetains` sees four coordinates and the current extent, never where `prev` came from, so a
  `prev` generated for a larger extent that still fits a shrunken one is retained by the function; **extent-change
  invalidation is the caller's obligation**, met by `flushWorld`'s `layoutKey` check (step 2) and tested at integration
  level (W5). Example, 900 × 520 viewport on the 8,400 × 8,060 world: left 0 → `{0, 0, 1156, 776}`;
  left 192 is retained; left 193 → `{0, 0, 1349, 776}`; a jump to left 5000 → `{4744, 0, 1412, 776}`, which shares
  no pixel with the old window.
- **One flush.** `flushWorld()` in `world.js` is the **only** function that sizes, positions, clears or paints either canvas.
  It takes no scroll offset and no layout argument: it reads `world.layout`, the markers and links, the pointer and the
  box's `scrollLeft/scrollTop/clientWidth/clientHeight` when it runs, so it is always the latest state. In one task, with
  no `await` and no yield: (1) `win = worldWindow(layout, view, world.win)`. (2) If `win !== world.win`, or
  `world.layoutKey` changed (the extent, the scale and every block's `[mapIndex, x, y, w, h]`: a moved block must not leave
  its old pixels behind), or a paint-all was requested: set both canvases' `width`/`height` (which clears them) and their
  `left`/`top` to the window **together**, translate both contexts by `(−win.x, −win.y)`, discard every block's cell
  snapshots and header keys (the canvases no longer hold what they describe), then paint **every** header strip and **every**
  cell of every block that intersects the window, regardless of `changedCells` and the keys (a diff can be empty), then the
  whole overlay. (3) Otherwise the retained window takes §5's diff path below, limited to cells intersecting it, and repaints
  the overlay. (4) Record `world.win` and `world.layoutKey`; update `data-world-window` (the canvases' size and origin),
  `data-world-moves` (moved flushes) and `data-world-flushes`. Both canvases move together and are painted before
  the flush returns, and the browser cannot present a frame inside a task, so there is no state in which a canvas sits at a
  new origin over blank, old or half-painted content. Snapshots exist only for what the window holds; a cell outside it has
  none, so a later move paints it fresh, and an edit made while it was outside cannot be skipped.
- **When it runs: synchronously, never deferred.** (a) The box's `scroll` listener calls `flushWorld()` directly. Scroll
  events are coalesced by the browser to one per rendered frame and dispatched in its update-the-rendering step, before
  animation callbacks and before paint, so a scrollbar-thumb jump, wheel, keyboard or programmatic scroll is repainted
  before the first main-thread frame at the new offset; a `requestAnimationFrame` flush would be a second queue to
  invalidate and cancel for no gain, so there is none. A compositor-threaded scroll may show the browser's own checkerboard
  if it presents before the main thread commits; that is outside the page's control and invisible to a DOM test, so the
  design promises, and W11 asserts, the canvas state at the first main-thread frame, not more. (b) `renderWorld()`
  (project change, scale, filters, resize) ends by flushing. (c) **Programmatic scrolling** (entering World, a scale change,
  a different current screen) sets the surface size first, writes `scrollLeft`/`scrollTop`, then flushes, **reading the
  offsets back from the box** (the browser clamps; the target is not trusted); the scroll event that follows finds the
  window retained and moves nothing. A resize re-lays-out through `renderWorld()` and flushes against the new size and the
  offsets after the scroll rules of "Resize" below. Hover alone repaints the overlay, never the picture.
- **Two coordinate frames, never mixed.** Painting is in *window* coordinates: every rectangle comes from
  `worldCellRect`/`blocks` in full-world pixels and the context translate does the subtraction, so there is no second set
  of rectangles. Hit-testing, `data-world-*` and the tooltip are in *full-world* coordinates
  (`pointer.clientX − surface.getBoundingClientRect().left`, the surface being the full-extent `div`). The pointer keeps
  only its last **client** pixel; every flush re-resolves hover, focus, the overlay frame and `title` through the current
  surface rect, so a scroll with the pointer still re-targets (the content moved, the pixel did not) without a pointermove.
- **What is stale, and when.** The flush closes over no layout, window, marker or link: it reads `world.*` when it runs,
  and `world.win` is **kept across a layout replacement**: a geometry-equivalent layout (same `layoutKey`) keeps the window and every snapshot, so a one-metatile edit, a rename, a start-only change or a no-change render takes the diff path; a `layoutKey` change forces the full repaint (step 2); `world.win` is dropped (null) only on project open or replacement and `leaveWorld()`. A scroll event the
  browser already queued when World is left never fires (the listener is removed) or, if its handler is running, returns
  on `world.box !== event.currentTarget`. A scroll followed by a project change before its event is dispatched flushes
  against the new layout, the new markers and the box's browser-clamped offsets, never the layout the scroll happened under.

**Thumbnails and what invalidates them.** Each map's screens are drawn at the layout scale with `MetatileRenderer.draw`.
A tileset decides how a metatile looks, so `world.js` keeps a pool `tilesetId → { renderer, serial }` (one
`MetatileRenderer` per tileset in use, `rebuild`-ed each render, dropped when unused); `serial` is a never-reused counter
because `renderer.version` belongs to an instance, not to a map's assignment (`render.js:15-35`). Invalidation is per
block, by two pure keys in `worldlayout.js`:

- **`worldBlockKey`**: `[mapIndex, x, y, scale, gridW, gridH, tilesetId, serial, version]`. A block whose key changed
  is redrawn whole; so is every block, headers included, when the window moves or `layoutKey` changes (the flush above). Two maps exchanging tileset ids change `tilesetId`
  while geometry, tiles and renderer versions stay equal, and still redraw.
- **`worldHeaderKey`**: `[x, y, w, scale, label]` where `label` is the `blockLabel` text. A rename or folder edit
  redraws that header strip only.

Within an unchanged block, `overview.js`'s `changedCells(drawn[m], map.screens, -1, -1)` redraws only the differing
cells that intersect the window (`drawn` is an exact `Uint16Array` copy per cell, not a hash; a cell and its gap are
cleared first, as `drawOverviewCell` does). Start, current and hover are overlay, not baked in, so moving the selection
or the start redraws zero thumbnails. `buildWorldMarkers` runs once per project change, never per hover; the overlay is
repainted whole each render, its area bounded by the window.

**Cost at 255 screens** (the measurement goes into C1's closing notes): first paint is at most 255 × 240 = 61,200
`drawImage` calls from the prebuilt metatile canvases (the Forge pays 240 per screen already); an unchanged repaint is a
61,200-compare scan and zero draws; one edited screen is 240 draws; a marker-only or start-only change is zero thumbnail
draws; a rename is one header strip. Snapshots are about 122 KB. **C1's acceptance check measures**, on the 255 × 1
streamed world and the mixed 127 × 1 + 1 × 128 world: both canvases' allocated sizes (`data-world-window`), first
paint, an overlay repaint on hover, a one-cell edit **and a window move (a jump)**, in the style of C2's "Measured: the cost
of a stroke". A move repaints every screen the window intersects, so its draw count is at most min(intersecting screens, 255) × 240,
never more than 61,200 metatile draws (empty window area adds none). A draw count is not a frame-time claim, so the
full-path timing and allocation above are measured, not inferred from counts. The contract above does not depend on its speed, and a number over
a frame is a finding for review, not a licence to defer the flush.

**Resize.** `observeSize(mapStage)` calls `renderWorld()` instead of `renderOverview()`/`renderScreen()` when the mode is
on. The scroll rules are C2's: a repaint never moves the box; entering, a scale change and a different current screen
scroll the current cell into view; a resize that took room from a whole-visible cell keeps it in view and leaves a
deliberately scrolled-away box alone. Whole-visibility is decided from what the box showed **before**: the previous layout, the
previous size and the offsets it had (`worldResizeTarget(prev, layout, …)` takes `prev = { layout, view }` captured before the
layout is replaced), never by asking the new layout about the old size, because a wrap can move a cell out of a viewport it was
in without changing the scale or the current screen. Each case ends in the flush, which reads the box's size and
offsets after any scroll was written (above).

## 6. Relationship to the per-map overview

**Shared, by import:** `OVERVIEW_GAP`, `OVERVIEW_PAD`, `OVERVIEW_MAX_SCALE`, `cellRect`, `cellAt`, `cellState`,
`changedCells`, `cellLabel`, plus the two extractions (§2). **Not shared:** everything that exists because there is more
than one map (packing, blocks, headers, the cross-map hit-test), the markers, the links and all DOM. `usesOverview` and
C2's behaviour are unchanged: the only edit to `overview.js` is the two extractions, its 20 tests
(`test/unit/mapoverview.test.js`) pass untouched, and the golden table (§7, E1) lands in the same commit.

**Existing selectors and tests the mode could disturb, and what keeps them safe:**

- `[data-map-overview]`, `[data-map-overview-box]` and their `data-*` attributes (smoke streamed steps 7, 7b, 8), the
  thirteen legacy 64 × 60 thumbnail selectors and `mapStage.dataset.laidOut`: untouched. World uses `data-world-*` only,
  its cells are not that size and are absent when the mode is off, and the same observer still sets `laidOut`.
- `#stage .canvas-stage canvas.pixels` (sixteen smoke sites): the stage and screen canvas keep their identity (detached
  while the mode is on, re-attached by `renderAll()` on leaving); `[data-tool]`, `[data-zoom]` and the toolbar are hidden
  by one root class, not removed or renamed.
- `docclaims.test.js`'s C2 pins (predicate, swap, shared `selectScreen`, the box's overflow, the version check) and
  smoke's `atMinimumWindow`: kept true, re-run in C1; World gets its own minimum-window step.
- `renderAll()` is the one function that changes shape: `renderNavigator(); renderScreen();` become "the World view when
  the mode is on, else those two". `renderMapSettings()` runs in both and, like `renderEntities`, reads nothing from the
  detached screen canvas; C1 confirms that, and any dependency found is a C1 finding.

## 7. Tests

Every pure module gets unit tests, each stating the wrong implementation it catches. `sample/` and `sample-rpg/` are only
read (`loadProject`); every cross-map, warp, streamed and dangling case is built in memory or in a `mkdtemp` directory.

**`test/unit/worldlayout.test.js`** (C1; over 1 × 1, 4 × 4, 1 × 30, 30 × 1, 255 × 1, 1 × 255, 16 × 15, 255 maps of
1 × 1, and the mixed 127 × 1 + 1 × 128):

- **L1 packing and extent.** Map order, no overlap, all inside the extent, a block wraps when it would pass the box, a
  lone over-wide block takes its own row; `scrollX`/`scrollY` are true iff the extent exceeds the box on that axis (a lone
  255 × 1 sets `scrollX` only). Catches `>=`/`>` off by one, a row as tall as the *last* block, a block y that ignores the
  header or gap, blocks sorted by area or folder, a flag that lies, a layout that squeezes a wide map to fit.
- **L2 exact inverse, and independently asserted.** A brute-force pixel scan of a mixed multi-row world at scales 1-4:
  every pixel in a `worldCellRect` answers that cell and no other does. Plus two assertions not derived from the code
  under test: (a) **row-major**, hand-written literals for a 3 × 2 map at 2× (screen 4 is col 1, row 1 at the literal
  rect), because a transposed `cellRect` and a transposed `worldHit` are exact inverses and pass any self-derived scan;
  (b) **headers**, every header-strip pixel answers `{ mapIndex, header: true }`, never a cell, and the pixel below it is
  the first cell row. Catches a transposed `col*gridH+row`, the header
  answering a cell, off-by-one at a gap or the last row/column, a hit-test using a `pad` the rect does not.
- **L3 scale.** Fit picks the largest fitting scale; when none fits the answer is the **fallback 2**; a world only 1×
  fits is 1; **255 × 1 at 4× (16,848 × 94) and 1 × 255 at 4× (112 × 15,842) are allowed** (no extent guard, no
  unavailable scale), and Fit picks 2 for them in the 900 × 520 box because they do not fit. Catches "always 4",
  "always smallest", a fallback that forbids 1, a stale guard, and "not fitting" confused with "unavailable".
- **L4 scroll target and label.** A whole-visible cell leaves the box alone, a far one is centred and clamped;
  `blockLabel` carries folder, size, streamed suffix. Catches centring every call, no clamp, a header without folder.
- **L5 keys.** One edited screen is one stale cell however many exist; a moved block, new scale or reshaped
  grid invalidates its block; **two maps exchanging tileset ids change `worldBlockKey` while geometry, tiles and
  renderer versions are equal**; a recreated pooled renderer never reuses a `serial`; **a rename or folder-only edit
  changes `worldHeaderKey` and nothing else**. Catches a key without the
  tileset binding or the label, a version-only key, a full rebuild per edit.
- **L6 window and retention** (`worldWindow(layout, view, prev)`, `windowRetains`; literals from §5's example, not
  recomputed from the code under test). (a) **Slow scroll:** from left 0, one pixel at a time, on the 8,400 × 8,060 world,
  `prev` is returned *by identity* through left 192 and the first new window at 193 is `{0, 0, 1349, 776}`. Catches
  recomputing every call (identity lost, a clear per scroll event), an inner zone of the wrong size, a window re-centred
  too early. (b) **Jump larger than the margin:** left 0 → 5000 gives `{4744, 0, 1412, 776}`, which contains the viewport and
  is disjoint from the old window. Catches a retention test that compares scroll deltas to the margin, or a one-step
  shift. (c) **Diagonal, mixed shape** (127 × 1 + 1 × 128 at 2×, 4,336 × 4,190): a path that leaves vertically while x is
  still inside its zone moves the window; one that leaves horizontally while y is inside moves it; both leaving moves it
  once; after every step the window contains the viewport. Catches a retention test on one axis, per-axis windows that
  disagree with the canvas rectangle. (d) **Return:** left 5000 → left 0 gives exactly `{0, 0, 1156, 776}` again, the
  same value as the first visit; a path out and back never drifts. Catches an accumulated or history-dependent origin.
  (e) **Edges:** viewport flush against the right and bottom edge keeps its clipped window with `windowRetains` true for
  every step inside it (no thrash at the extent); a `prev` rectangle that actually exceeds the new extent is not retained (the function is not asked to detect a `prev` that
  merely came from another extent and still fits: that is the caller's `layoutKey` obligation, W5); offsets beyond
  `extent − size` or negative are clamped; an extent smaller than the viewport gives the whole extent. (f) Area ≤
  `(width + 512) × (height + 512)` for every case above, 255 × 1 and 1 × 255 at 4× included. Catches a window the size of
  the extent, an unclipped inner zone, an unclamped view. (g) **Shrink:** a 3,800 × 2,100 viewport's window
  `{0, 0, 4056, 2356}` (9,555,936 px) passed as `prev` for a 500 × 300 viewport is not retained and the new window is
  `{0, 0, 756, 556}`, under `(500 + 512) × (300 + 512)`; a `prev` exactly at the bound is kept, one pixel over either axis is
  not. Catches retention that checks coverage only, which keeps the large canvases for good.
- **L4 resize target** (`worldResizeTarget`). Three 4 × 4 maps at 4×: the third map's first cell at `{570, 24, 64, 60}` in a
  900-wide box is `{10, 580, 64, 60}` at 560 (the block wraps); the target scrolls the new cell whole; a cell that was not whole
  before gets `null`. Catches asking the new layout about the old viewport size.
- **E1 extractions, golden.** Frozen from the code *before* the refactor: `layoutOverview`'s **full return value
  including `scrollX`/`scrollY`**, `cellRect`, `cellAt`, `inView` and `scrollTarget` over grids and boxes chosen at the
  scale thresholds (each of 4 → 1 flipping at its exact pixel), one pixel either side of every fit boundary, each scroll
  axis independently visible/hidden, gap-inclusive visibility, clamp/rounding boundaries, invalid indices, tiny and
  zero-size views. `gridLayoutAt`'s shared fields are compared to `layoutOverview`'s separately (three arguments cannot
  carry the flags). A finite table is evidence, not a proof; the 20 existing tests and C2's smoke steps run beside it.
- **P1 purity.** The pure modules import only `shared/` and sibling pure modules; no DOM global, no `store`.

**`test/unit/worldmarkers.test.js`** (C1: start/title; C2: the rest):

- **M1 start, title, doors.** With `startMap: 1, startScreen: 0` the start's `flat` is the *flat* index at `startX,startY`;
  `titleMap: null` gives no title marker. Only `behavior === 'door'` actors give door links (a non-door's default `toScreen: 0` gives none);
  map/screen derive from the flat index across maps; same screen is `self`; landing is `toX,toY` clamped to 240/224,
  default when absent. Catches `startScreen` as a flat index, swapped x/y, a phantom title, reading every entity as
  `remapScreenReferences` does, map-space/flat-space mixing.
- **M2 dangling.** `toScreen: 200` in a five-screen project resolves to flat 4, `dangling: true`, link present; a warp
  landing of x 255, y 239 resolves to 240, 224 while the source marker at 255, 239 stays inside the cell. Catches no clamp
  (off the map), a dropped link, and source bounds confused with landing bounds.
- **M3 warps.** Warps in a `then`, an `else`, a choice option and a nested branch are found; `off` commands, pages
  `compiledPages` drops and an option past `CHOICE_LIMITS.options` are present with `compiled: false`; an ordinary one
  `true`. Catches `liveCommands`-only (nested-off warps vanish), `allCommands`-only (all shown compiled), top level only.
- **M4 common events, by call path.** The same callee with an **off** call and a **live** call, in both orders: the one
  link is `compiled: true` both times. A **disabled call** to a body whose warp is enabled: mentioned, `compiled: false`.
  A nested off call (A live → B off → C): C's warp not compiled. A callee whose pages all compile away: not compiled.
  A callee with a missing, string, duplicate or `NO_COMMON_EVENT_ID` raw `id`: resolved by `resolveCommonEventIds`, so
  the link attaches to the entry the compiler would call. Two callers give two links with `via`; A → B → A terminates;
  a missing target yields nothing and does not throw; an uncalled body yields nothing. Catches local-membership
  liveness, a per-root visited set that lets a dead path hide a live one, order dependence, raw `entry.id`, recursion.
- **M5 events and talk.** The trigger is `effectiveTrigger` (an RPG monster actor stored *touch* reads *interact*); an
  event with all pages off is one `event` marker with `compiled: false`; **if it also has plain dialogue the marker
  carries `says`**, and an actor with a compiled event and dialogue is `event` only; a dialogue-only actor is `talk`; a
  door with an event is one `door` marker. Catches copying the stored trigger, counting dead dialogue, a vanished marker.
- **M6 the remap oracle and its change detector.** (a) On a project with doors, a non-door entity with a stored
  `toScreen`, nested warps, a **multiply called** body, an **uncalled** body and raw/dangling targets, the stored values
  `remapScreenReferences` asks its recording `translate` about equal `referenceInventory(project)` as a multiset: each
  body once, called or not (D1's expanded count gave `[2,2,0,0]` against the remapper's `[0,0,2]`, `probe-remap.out`).
  (b) After a rotation permutation, rebuilt links' targets equal the permutation of the old, expanded per caller,
  including dangling ones. (c) **The change detector:** the **raw SHA-256 of the whole files `shared/project.js` and `shared/eventrules.js`**
  (no comment/whitespace normalisation, no short hash: both missed real changes, `d2-review2.md` finding 2) is pinned in
  the test, whose failure message says "audit `referenceInventory` against `remapScreenReferences` (and
  `projectEvents`/`allCommands`), then update the pinned digests". It reddens on any edit to either file, including a
  harmless one; a field added to the remapper cannot pass unnoticed even when no fixture carries it. The claim is that,
  not automatic coverage. The recording-`translate` oracle of (a) stays a separate behavioural assertion.
- **M7 read-only, fixtures, `eventlist.js`.** `buildWorldMarkers` on a deep-frozen project neither throws nor changes it
  (catches an in-place sort). `sample/` gives 1 start, 1 title, 1 door marker, 2 event markers, 1 talk marker and 1 link
  (screen 3 → 0); `sample-rpg/` 1 start, no title, 1 event, no link (the probe's numbers). `eventlist.js`'s door line,
  dangling and normal, is unchanged after importing `doorTarget`.

**`test/unit/worldlinks.test.js`** (C2): **reciprocal side, independently asserted**: for A = (0,0), B = (100,0) the public `linkPath`
has `bow = clamp(0.18·100, 6, 40)` = 18, so A → B has control point (50, 18) and B → A (50, −18), also with the endpoints
swapped and for a vertical pair, as literals (D1's rule gives (50, 18) twice and fails this); the helper that takes an
explicit bow is also tested with a 20 px example ((50, 20) / (50, −20)), beside tests of the public formula and its clamps. A `self` link is a ring, never a zero-length path; an arrow
ends inside the target cell for landings at 0 and at 240/224; `linkAt` picks the nearest within tolerance and nothing
beyond; marker beats link beats cell; `linkFocus` includes incoming, outgoing and self links; `defaultLinkMode` flips at 32.

**Smoke, in the real window** (`main/smoke.js`, a new block after the streamed block; `s.commit` setups undone to a JSON
baseline as that block does, on the temp copy of `sample/`; screenshots go under `handoff-next/worldview/c1/` and `c2/`):

- **W1 enter.** Click `[data-world-toggle]`: box exists, editing controls hidden, screen canvas and navigator not in the
  document, one block per map; `store.revision`, undo depth, `dirty` and the JSON unchanged.
- **W2 click through, across maps.** A third map and a door from screen 3 to it. Click that cell at coordinates computed
  from `data-world-*` (block origin + cell rect, not the pure helper): mode off, that map and screen shown, the "Screen N
  name" label follows, nothing committed, all read in the same task as the click.
- **W3 follow a door (C2).** `elementFromPoint` at the marker is `.world-surface` and its `title` (or `closest('[title]')`)
  names the target; the link click opens the target in the other map; the marker click opens the source screen and focuses
  the actor's row. A dangling door shows `data-world-dangling`.
- **W4 a long streamed map.** A streamed 255 × 1: `scrollWidth > clientWidth`, entering scrolls the current cell into
  view, a click on the last cell opens screen 254, and the box stays inside the stage at the minimum window (own step).
- **W5 draw counts.** In World mode, one metatile commit, undo and redo leave the mode on and `data-world-redrawn` exactly
  the changed cell; an art change to a shared metatile redraws all; **a start-only or marker-only change and a no-change
  render draw zero thumbnails**, and across each of those renders and the one-cell edit `data-world-window` and `data-world-moves` are unchanged as well (wrong: a replaced layout that drops the window and repaints everything); **a scale change or a resized map (a `layoutKey` change) repaints fully even when the old window rectangle still fits the new extent**; a repaint never moves the scroll.
- **W6 structure.** Delete a *preceding* map, reorder, undo, redo, in World mode: the mode stays on, the block count follows,
  no console error; after each step click a surviving **cell, marker and cross-map link** and assert the destination by
  **content** (the opened screen's metatiles/name, the focused actor's label), never an index or a count.
- **W7 lifetime.** Another Forge and back: editing mode. **Opening another project while World is on** (the real open
  path, the Open button, the native picker answered by the harness's `dialog:openProject` override): editing mode. A resize keeps a whole-visible current cell visible and leaves a deliberately scrolled-away box alone, **including a resize that wraps the blocks** (three 4 × 4 maps at an explicit scale, one row then one row narrower).
- **W8 minimum window:** positive box height, first and last cells reachable. **W9 read-only:** W1's comparison after hover,
  click, scale change, filter toggles and leave. **W10 caches (C1):** rename a map and edit its folder: only that header
  strip redraws (`data-world-headers-redrawn`), zero thumbnails, with `data-world-window` and `data-world-moves` unchanged; exchange two cached maps' tilesets: both blocks
  redraw; undo and redo of each.
- **W11 window, scroll and coordinates (C1; on the streamed 255 × 1 and the mixed 127 × 1 + 1 × 128 world, built in a temp
  copy).** "Covered" below means the picture canvas's pixel at the centre of every visible cell and the overlay's start/
  current frame have the alpha they must (`getImageData`; a thumbnail is opaque, the gap is transparent), the header
  strips intersecting the viewport are opaque, and both canvases have equal `width`/`height` and the same `left`/`top`.
  Every check after a **task-written scroll** ((a)-(f), (h), and the enter and scale cases of (g)) is made **in the first
  `requestAnimationFrame` callback after the scroll was written**, which runs after the frame's scroll event and before its
  paint, never after an extra settling wait; the resize cases of (g) are the exception, below. (a) **Slow scroll** inside the retained
  window: covered, `data-world-moves` unchanged, `data-world-window` unchanged (wrong: a clear and repaint per scroll
  event). (b) **Jump beyond the margin** by `scrollLeft = 5000` (what a scrollbar-thumb drag does): covered at the first
  frame, `data-world-moves` +1, the window contains the viewport (wrong: a delayed or rAF-deferred shift, a shift that
  paints only `changedCells`, which is empty here, exposing a blank band). (c) **Diagonal** in the mixed-shape world:
  covered at each step, vertical-only and horizontal-only exits both move the window (wrong: one-axis retention).
  (d) **Return** to the first window: covered, `data-world-window` equals its first value, and a metatile edited while
  the box was scrolled away shows in its cell after the return (wrong: snapshots kept across a move, painting only what
  the diff names). (e) **Clicks at nonzero offsets**, after each of (b)-(d) and with the scroll beyond the first window:
  click a cell, a marker (C2) and a cross-map link (C2) at client coordinates computed from `data-world-*` plus the box's
  own scroll offsets, never from the pure helpers, and assert the destination by content (the opened screen's metatiles and
  name, the focused actor's label), not index (wrong: hit-testing in window coordinates, which opens a neighbour from the
  second window on). (f) **Scroll with the pointer still:** `pointermove` over a cell, scroll the box by a cell and a
  half, wait one frame without moving the pointer: `title` and the overlay's hover frame name the cell now under the
  pixel (wrong: hover cached in world or window coordinates until the next pointer event). (g) **Programmatic scrolls:**
  enter World with the current screen far from the origin and change the scale: each is covered at its first frame, the
  current cell is visible, the offsets read back equal the box's (wrong: flushing against the target or the pre-scroll
  offsets). **Resize** (both W7 cases): `ResizeObserver` delivery follows animation callbacks, so a first-rAF check can
  precede a correct same-frame repaint; coverage is inspected instead **right after the resize observer's synchronous
  flush**, through an explicit test hook the test installs (a call at the end of the resize-driven flush, a no-op in the
  product), before presentation and with no settling-frame wait. A box whole-visible before the resize has its current cell
  visible and covered after it; a deliberately scrolled-away box keeps its `scrollLeft`/`scrollTop` (subject to the
  browser's clamping) and is covered at its own offsets (wrong: recentring a scrolled-away box, a resize repaint deferred
  past the flush). **Shrink** (mixed world scrolled to 700,700, then a smaller stage): right after the flush the canvases are at most `(clientWidth + 512) × (clientHeight + 512)`, the window moved once, the offsets are unchanged and the view is covered (wrong: a window kept because it still covers). (h) **Scroll then
  change or leave, before the queued event runs:** in one task, write `scrollLeft` far away and then (i) commit a
  project change (delete a preceding map, then undo) or (ii) click the toggle off, or (iii) open another project; wait
  two frames. Expected: no console error, (i) covered against the new layout and the clicked destination correct by
  content, (ii)/(iii) no `.world-surface`, canvas or listener left (`data-world-*` absent, the editing screen intact,
  `store.revision` unchanged), and re-entering starts from a fresh window that is covered. Wrong: a flush closing over the
  old layout or a null box, a leaked listener, a deferred paint into a detached canvas.

## 8. Slicing

**Two commits, each green and shippable alone** (W3: about three review rounds in all). Neither touches `shared/`,
`main/build/` or `engine/`, so the ROM identity fingerprint is byte-equal before and after each; each close records that
check, as phase 4 did. Commits stay local and are pushed once, at the close of C2.

- **C1: the World view, layout, start/title, navigation.** `worldlayout.js`, the `start`/`title` cut of `worldmarkers.js`,
  `world.js` (box, surface, windowed canvases, keys and diffing, hover, click-through), the `overview.js` extractions with
  the golden table, the `map.js` swap, toggle and scale buttons, CSS, docclaims pins, smoke W1, W2, W4-W10 (minus link
  parts), L6 and W11 (W11's actor-marker and cross-map-link parts finish in C2). Shippable as "a map of all your maps you can click through"; does not close item 7. Review focus: inverse, keys,
  window, stage swap, read-only pins.
- **C2: doors, warps, events and links.** The rest of `worldmarkers.js` (call-path expansion, `referenceInventory`),
  `worldlinks.js`, overlay drawing, link modes and filters, the `eventlist.js` `doorTarget` import, M6 with its change
  detector, smoke W3. Review focus: single-writer story, `compiled`, call-path status, many-links legibility. Item 7
  closes only here.

## 9. Docs at the build's close

- `ROADMAP.md` item 7: strike the last bullet and change "Five of six … sliced out" and "Item 7 is not wholly done" to say
  it is done, with C1 and C2's hashes; fix the item 15 passages that still call the overview "the remaining open piece".
- `README.md`: a clause in the Map Forge feature-table row and a short paragraph under "Things worth knowing about the Map
  Forge once a project is more than a screenful". `docs/design-maporg.md` §12: one line pointing here.
- `docs/reference-electron-layout.md`: the World view's place in `renderAll()` and its **local** boundary (synchronous, no
  store handle, no `await`); the general async rule is unchanged.
- `CLAUDE.md`: **no new bullet.** The single-writer entry for flat-screen references already names `remapScreenReferences`;
  the inventory maintenance obligation (re-audit `referenceInventory`, update the digest) lives in `worldmarkers.test.js`
  M6 and this file's Closed paragraph. Revisit only if C2's review finds a distinct silent-bug rule; the 40,000-character
  budget (`docs.test.js`) is checked either way. This file gets a "Closed" paragraph, as phase 4's did.

## Accepted taste decisions (Chris, 2026-10-16)

All six defaults are accepted and settled; none is open and none blocks the build. Also settled, not asked: W4 stands (no
`shared/` edit; audited inventory plus change detector, §1/§7 M6); enter-shadow warnings are left out and marker status is
structural (§1); the mode resets on project switch (§4).

- **R1 Default link mode:** All up to 32 links, Focus above; the user overrides All / Focus / Off.
- **R2 Dialogue-only actors:** `talk` markers are available, off by default behind a filter.
- **R3 Title-screen marker:** kept.
- **R4 Mode reset:** World mode resets on leaving the Map Forge and on project switch, as `state.mapIndex` does.
- **R5 Fit:** picks the largest fitting scale 1..4 and falls back to 2 when none fits; explicit 1×-4× buttons.
- **R6 Tooltips:** native `title` on the actual hit surface, as the per-map overview's are.

## Rulings quoted

Chris, 2026-10-16:

- **W1 Shape: the whole world.** One view of every map, each as a block of its screen thumbnails, with the start
  marked, warp and door links drawn between screens (including across maps), and event markers on screens. Clicking
  a screen or a marker opens it.
- **W2 Placement: a Map Forge mode.** A "World" toggle or tab inside the Map Forge swaps the editing stage for the
  overview; clicking a screen returns to editing it. No change to `renderer/app.js`'s `FORGES` array.
- **W3 Process: short design, then build.** This document, reviewed (budget about 2 review rounds); then
  implementation (budget about 3 review rounds), committed locally and pushed once at the close.
- **W4 Renderer-only (orchestrator default, from the follow-up policy).** The build must not edit `shared/`,
  `main/build/` or `engine/`: any such edit moves the ROM identity fingerprint and costs a ~90 minute ring-certificate
  renewal. Importing from `shared/` is fine. If the design finds something that genuinely needs a `shared/` edit,
  name it as an open question for Chris, with the renderer-only alternative and its cost; do not assume it.

## Built: C1 `eb3c254` and C2

Where the build departed from, or pinned down, the text above (each is also in `handoff-next/worldview/c2/report.md`):

- **M6(c), the change detector.** Before: a digest of the comment-stripped `remapScreenReferences.toString()`. After: the raw
  SHA-256 of the whole files `shared/project.js` and `shared/eventrules.js` (section 7, M6 (c)).
- **The bow literal.** Before: `bow` 20 with control points (50, ±20) for the public function. After: the public `linkPath`
  has `bow = clamp(0.18·len, 6, 40)` = 18 for a 100 px chord, so (50, ±18); the helper `quadraticControl(a, b, bow)` is tested
  with the 20 px example too.
- **Focus and what can be clicked.** In Focus only the links of the focus screen (the one under the pointer, else the current
  one) are drawn *and* hit-tested, so the middle of a long link is clickable in All, or while its end screen is in focus;
  the end markers and the landing are always reachable. This is what "what is drawn is what is clickable" means.
- **`self`** records only that the link is incident on one screen (a door or warp that lands on its own flat screen); it does not
  choose the drawing. `linkPath` reads the geometry alone: ends closer than `worldMarkerSize` draw a ring at the landing, separated
  ends (a same-screen door from (0, 0) to (240, 224)) draw a curve, as any other link does.
- **A click on an actor marker** passes `entityIndex` to `openFromWorld`, which scrolls that actor's row into view and focuses
  its first input, the statements `findEvent` uses, without its modal.
- **The controls.** Links Auto / All / Focus / Off (`data-world-links`) and Show Doors / Events / Talkers
  (`data-world-filter`) sit in `.world-controls`; their state is `worldOptions` in `mount()`, so it lasts as long as the
  Forge is mounted and is reset with it (R4 holds for it as for the mode). `state.world` is unchanged.
- **Cost.** `buildWorldMarkers` runs once per render, so an edit in a world with about 2,000 links costs about 90 ms to flush
  (against 18 ms with none); a hover costs 0.9 ms in Focus and 3.4 ms in All at that size (`handoff-next/worldview/c2/measurements.md`).
