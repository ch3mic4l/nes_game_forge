# Design: Map organization and reuse (item 7 — "the reorder with teeth")

Status: design only, no code written, no tracked file touched. Written against HEAD `8e3e1c9`.
**Revised five times**, against five review rounds (round 1: ten findings, five High;
round 2: seven findings, three High;
round 3: seven findings, two High;
round 4: three findings, one High; and
round 5: five narrow pins, no blocking finding — **verdict: ready for
implementation**) — see the "Fix round 1" through "Fix round 5" entries in §15 for what moved and why in
each. Companion precedent:
`docs/design-routes.md` (the closest shipped neighbor in shape — a pure compiler/UI feature,
argued for zero engine cost, with a byte-identity proof) and the Tile Forge's own design (a Map Forge
authoring + preview feature). This design follows both for depth and format but departs from the
routes precedent on one central point: routes proved a **zero-byte, zero-order-change** authoring
convenience. Reorder and duplicate are **real structural edits** — they are supposed to change the
compiled screen tables' order and contents. The claim this design has to prove is not "produces an
identical ROM" but "changes only what the operation says it changes, and every reference still points
at the same *content*." §7 works this out in full, because the brief asks for it to be reasoned rather
than assumed.

## §1. What this is, and the invariant everything below has to satisfy

Item 7 (`ROADMAP.md` ~line 976) is six loosely related asks under one banner: duplicate a screen or a
map, copy/paste a rectangular region, folders/tree, reorder maps safely, named screens (shared with
item 2), and a world overview. The roadmap's own framing (line 988) is that reordering is "the one
with teeth": screen indices are referenced by warps, doors and compiled event bytecode, so a
restructuring edit has to be a single operation over the project, with a test that proves no reference
survives pointing at the wrong screen.

**The invariant everything below is built to satisfy:** every operation this design adds (reorder,
duplicate, and — see §4.2 — the three existing operations, Add Map included, that already restructure
the map list without this guarantee) is expressed as one `store.commit()` that mutates `project.maps`
**and** rewrites
every stored reference in the same pass, so a reference that pointed at a given screen's *content*
before the edit points at that same content afterward, in one undo entry. This is not a new mechanism
invented for this feature — `store.commit(label, mutate)` (`renderer/store.js:63-69`) already
snapshots the whole project once and applies an arbitrary mutation; nothing about "touch N different
fields in one edit" needs anything beyond what the store already does, which is confirmed directly by
reading it (§6.7). What is missing today is not undo infrastructure, it is the mutation itself: no
code anywhere in this repository currently computes "what does reordering/deleting a map do to every
stored screen reference," which §3's inventory and §4's findings establish concretely, and §6 supplies.
**One reference in that inventory lives outside project JSON entirely** — a saved game's own
`flat_screen` byte, on the cartridge — and round 1 of this design missed it; §3 row 17 and §6.10 are
the correction.

## §2. What I read

`ROADMAP.md`'s "## 7. Map organization and reuse" section (line 976) and the identity-decision
passage at lines 195-236 (the "considered and declined" persistent-id discussion, which explicitly
names item 7 as the place to revisit it). `CLAUDE.md`'s `shared/playscenario.js` bullet, the routes
passage, the Map Forge / store sections, and the single-writer/allCommands/`fill()` house rules.
`docs/design-routes.md` in full, for the nearest shipped precedent's shape and rigor.
Round 1's own review, in full, for this revision.

Source, read in full or in the cited ranges: `shared/project.js` (schema: `createScreen`, `createMap`,
`LIMITS`, `normalizeMap`/`normalizeScreen`/`normalizeEntity`, `normalizeProject`'s title/start clamps,
`flatScreens`, `screenLabel`, `EVENT_COMMANDS`, `normalizeEventCommand`'s generic-arg fallback, the
`renumberSongDeletion`/`renumberSfxDeletion`/`renumberActorDeletion`/`renumberItemDeletion` family,
`validateProject`'s item/actor-reference warnings, `screenIndex`); `shared/eventrules.js` in full
(`allCommands`, `liveCommands`, `isLive`, `projectEvents`); `shared/playscenario.js` in full
(`describePlayScenario`/`resolveStartAt`/`resolveFormation`, and this revision's own closer read of
`mapsNamed`/`screensNamed`'s exact-match semantics against `map.js:1518`'s "a name can never be blanked
to empty" rename guard); `main/build/generate.js` (`flattenScreens`, `emitScreens`, `screenAttributes`,
`kernelTableBytes`, `checkCapacity`'s screen-count error, the `screen_map`/`screen_tileset`/
`screen_left`/`right`/`up`/`down` table emission, `encounters`/`battleSkyTile`/`battleGroundTile`/song
per-map tables, `startFlat`/`titleFlat` derivation); `main/build/textcompile.js` (`encodeCommand`'s full
switch, `opIndex`, `compileText`'s exported return shape — `strings`/`events`/`eventFor`/`problems`/
`bytes` — and the placement-event compile loop's `mapIndex`/`screenIndex` labeling and its
`eventFor.set(entity, events.length)` slot assignment, `textcompile.js:511-535`); `renderer/forges/map/
map.js` (map/screen state, Add/Delete Map, `resizeMap`, `doorTarget`, `titleScreenSelect`, the existing
actor clipboard, `store.commit` call sites, screen/map rename); `renderer/forges/map/eventlist.js` in
full (the existing searchable world index — directly informs the world-overview slicing decision,
§12); `renderer/store.js` in full (`commit`/`beginStroke`/`touch`/`endStroke`, and this revision's own
confirmation that `commit`'s return value is discarded by every existing call site, `renderer/store.js:
63-69`); `renderer/emulator/testplay.js` (the ▶ Test tool's flat-index poke); `renderer/app.js`
(`playScenario` state); `main/smoke.js`'s Map Forge section (the multi-screen-map smoke coverage
already in place); `test/unit/project.test.js:3255-3281` (the `flatScreens`/`flattenScreens` agreement
test — directly relevant to §4.1's finding). New for this revision: `shared/save.js` in full (`SAVE_FIELDS`,
`SAVE_LAYOUT_VERSION`, `saveIdentity`'s djb2-style fold and its own extensive history comments);
`engine/save.asm:260-320` (`save_check_valid`'s marker/identity/checksum/range gates, confirming
`SAVE_FLAT_SCREEN` is range-checked against `NUM_SCREENS` only) and `:540-549` (`continue_game`'s
`load_apply_body` then `jmp redraw_screen`); `main/build/generate.js:1880-1890, 2260-2390` (where
`saveIdentity(project)` is computed at build time and baked into `SAVE_IDENTITY_0..3`); `test/unit/
save.test.js` in full, in particular its `buildSaveable`/`boot`/`tap`/`touchSaver` harness (lines
93-200) and its own `"a save from a different project's build is refused, not misapplied"` test
(lines 406-452) — the direct precedent §6.10's own integration test is modeled on.

## §3. Deliverable one: the reference inventory, verified

Every row below was read in the cited file, not inferred from the brief or the roadmap. "Index space"
follows the brief's own framing: **flat** (position in `flattenScreens(project).flat` /
`flatScreens(project)` — maps in `project.maps` order, screens within a map in that map's own
`screens` array order), **map** (position in `project.maps`), **per-map** (position in one map's own
`screens` array — this is a *grid cell*, not a free list position; see §6.5).

| # | Field / table | File : line | Written by | Index space | Notes |
|---|---|---|---|---|---|
| 1 | `entity.props.toScreen` (door target) | `shared/project.js:2178` (loose 0-255 clamp on save); `main/build/generate.js:2582-2586` (real clamp to `flat.length-1` at compile time) | `normalizeEntity`; `emitScreens` | **flat** | Read only by `entity_door` at the engine end (CLAUDE.md). The compiled byte slot (`ent_to_scr`) is shared with a pickup actor's item id, but **at the schema level `props.toScreen` never holds an item id** — a pickup actor's granted item comes from `project.items[].actorId` (a completely different field), never from this one. `emitScreens`'s ternary (line 2583-2586) picks which *source* feeds the compiled byte; it does not repurpose this JS field. Confirmed no code anywhere writes an item id into `props.toScreen` (grepped every renderer/ reference to `toScreen`: only `renderer/forges/map/map.js:1008` — the door-target `<select>` — and `renderer/forges/map/eventlist.js:75-76` — a read-only display — touch it). **This means a schema-level remap of `props.toScreen` is safe to apply unconditionally to every entity**, door-behavior or not; see §6.2's correction of the brief's literal warning. **A stored value can legally be 0-255 while `flat.length` is smaller** — `normalizeEntity`'s clamp is a byte clamp, not a current-range clamp, so this field's own "true" value is only resolved by the compiler's `Math.min` at build time. §6.1's canonicalization step (Fix round 1, finding 4) exists precisely because this row's "real target" and "stored number" can diverge. |
| 2 | `Warp player` command's `screen` arg | `shared/project.js:631` (schema entry, falls through to the generic `out[arg] = clamp(raw?.[arg],0,255,0)` at line 1930 — no dedicated handler); `main/build/textcompile.js:241-247` | `normalizeEventCommand`; `encodeCommand`'s `warp` case | **flat** | The *only* `EVENT_COMMANDS` entry with a screen operand — verified against every other case in the switch (give/take/setSwitch/setVar/heal/damage/save/move/turn/wait/route/shake/visible/fade/flash/join/call/music/sting/sfx/battle/branch/choice all checked; none carry a screen or map operand). Found via `allCommands`, not a page's top level — a warp can sit inside a branch, a choice option, or (per `routeLegs`) never inside a route (routes only ever hold move/turn/wait). `screenCount` at `textcompile.js:172` is a **second, independent** recomputation of `flat.length` (`project.maps.reduce((t,m)=>t+m.screens.length,0)`) — same value by construction, not by shared code; see §4.1. Same loose-clamp-vs-real-clamp divergence as row 1 — `byte(command.screen, screenCount-1)` at compile time is the real ceiling; the stored value can already be stale. |
| 3 | `project.project.titleMap` / `titleScreen` | `shared/project.js:1553-1554` (default), `2732-2736` (normalize clamp), `2794-2797` (post-map-normalize re-clamp) | `createProject`/`normalizeProject` | `titleMap`: **map**. `titleScreen`: **per-map** | Confirmed by the clamp itself: `titleScreen` is clamped against `maps[project.titleMap].screens.length` (line 2795), never against flat count. The Map Forge's own picker (`renderer/forges/map/map.js:1212-1229`) stores exactly this pair, not a flat index (`chosen.mapIndex`/`chosen.screenIndex`). **A maps-only reorder therefore never has to touch `titleScreen` — only `titleMap`, remapped by the map permutation directly** (§6.6). **Delete and resize are not the same case** — deleting or shrinking the map these point into, or the map itself, requires the per-map object-identity diff and fallback policy §6.8/§6.9 define; round 1 of this design stopped at reorder's easier case and did not specify these (Fix round 1, finding 2). |
| 4 | `project.project.startMap` / `startScreen` | `shared/project.js:2727-2728`, `2788-2789` | `normalizeProject` | `startMap`: **map**. `startScreen`: **per-map** | Identical shape to row 3, same reasoning applies, same round-1 gap closed the same way in §6.8/§6.9. `main/build/generate.js`'s `startFlat` computation (`mapBase[project.project.startMap] + project.project.startScreen`, ~line 2109-2126 range) confirms both spaces at the point they're converted to flat for compilation. |
| 5 | `map.encounters.actorIds` / `.rate` | `shared/project.js:2266-2269` (schema) | `normalizeMap` | n/a (actor ids, not screen refs) | Checked and ruled out: an encounter table names actors (`renumberActorDeletion` already renumbers this, `shared/project.js:1276-1280`), not screens. Included here only to record it was checked, not missed. |
| 6 | `map.tilesetId` | `shared/project.js:2263` | `normalizeMap` | n/a (tileset id, not a screen ref) | Checked, ruled out for the same reason — but load-bearing for §6.3 (copy/paste across tilesets). |
| 7 | `map.songId`, `map.battleSkyTile`, `map.battleGroundTile` | `shared/project.js:2260, 2264-2265` | `normalizeMap` | n/a | Per-**map** data, moves as a unit with its map during a reorder (it lives inside the map object) — never itself a screen/map index. Ruled out. |
| 8 | `screen_map` table | `main/build/generate.js:2508` | `emitScreens`'s siblings | **flat**-indexed, **map**-valued | `dbBlock(flat.map(entry => project.maps.indexOf(entry.map)))` — recomputed fresh from object identity every build, never a stored value. Not a stale-reference risk; regenerated from `project.maps` order every time. |
| 9 | `screen_tileset` table | `main/build/generate.js:2511` | same | **flat**-indexed, tileset-id-valued | Same as row 8 — regenerated, not stored. |
| 10 | `screen_left`/`right`/`up`/`down` (neighbour tables) | `main/build/generate.js:1271-1279, 2515-2518` | `flattenScreens` | **flat**-indexed, **flat**-valued (or `$FF` sentinel) | Computed from each screen's **grid position** (`col = index % map.gridW`, `row = index / map.gridW`, both derived from **per-map array index**, at `generate.js:1265-1266`) — a map boundary is a hard edge (`0xff`), never crosses into another map. This is the single most load-bearing fact for §6.5: **a screen's per-map array position is not an arbitrary label, it is a grid coordinate the engine's own edge-crossing depends on.** Regenerated every build; not a stale-reference risk in itself, but it is why "reorder screens within a map" is not the same kind of operation as "reorder maps." |
| 11 | `map.id` | `shared/project.js:2255` (`normalizeMap(map, id, ...)`, `id` = the `.map()` callback's array index at `shared/project.js:2785-2787`) | `normalizeMap` | **map**, reassigned every normalize | **Write-only.** Grepped every `.js` file in the repository for a read of `map.id` / `\.id\b` in a map context: none found. It is not `NO_ACTOR`/`NO_ITEM`-shaped (no sentinel, no engine meaning) and nothing depends on its value being stable — it is reassigned to the map's current array position on every `normalizeProject` pass (confirmed at `shared/project.js:2785-2787`, `raw.maps.map((map, id) => normalizeMap(map, id, itemCtx))`), the same non-identity CLAUDE.md's own `createScreen()` comment already warns about for screens. A field named `id` that is not actually an id is exactly the kind of trap a future maintainer could misread as "the stable identity was already here." §4.3 flags this. |
| 12 | `renderer/emulator/testplay.js`'s ▶ Test tool | `renderer/emulator/testplay.js:93, 118-121` | testplay's own `where.screen` argument | **flat**, computed fresh at invocation, never persisted | Pokes `warp_scr` directly. Self-heals completely: the flat index is computed at the moment ▶ Test is pressed, against whatever the project looks like *then* — never cached across a reorder. Not a stale-reference risk. |
| 13 | Remembered play scenario (`renderer/app.js`'s `playScenario`) | `renderer/app.js:103, 140-165`; `shared/playscenario.js` in full | `describePlayScenario`/`resolveStartAt`/`resolveFormation` | **name-resolved**, never index-cached | `describeStartAt` (`shared/playscenario.js:45-49`) converts a flat index into `{mapName, screenIndex (per-map), screenName, x, y}` **at the moment a scenario is picked**, then discards the flat index entirely. `resolveStartAt` (lines 71-105) re-resolves fresh against whatever project is in hand at reload time: map by name (refuses on 0 or 2+ matches), screen by name if named, else by its remembered **per-map** position (refuses only if that position no longer exists). **This subsystem needs no reorder-awareness at all — it already treats "the map/screen moved" as an ordinary edit it was built to survive.** Two pre-existing, unchanged-by-this-design edge cases worth stating explicitly rather than silently inheriting: (a) a duplicate whose name collides with its source makes `resolveStartAt` refuse on the very next reload (existing "refuse rather than guess" behavior, not a bug — §6.2's duplicate-naming rule avoids triggering it); (b) an *unnamed* screen's identity is its per-map position, so a hypothetical future "reorder screens within a map" (which this design does **not** propose — §6.5) would silently resolve a remembered unnamed screen to different content, not refuse — a pre-existing, documented limitation of session-scoped state (`shared/playscenario.js`'s own header comment, lines 6-17), inherited unchanged, not introduced by this design. |
| 14 | Map Forge UI state (`state.mapIndex`, `state.screenIndex`) | `renderer/forges/map/map.js:109` and every mutation site (449, 468, 574, 617, 693, 717, 729, 992, 1177, 1463, 1480, 1503, 1596-1608, 1755) | in-memory editor cursor, not project data | **map** / **per-map**, session-only | Not a persisted reference at all — the currently-open screen in the editor. A reorder/duplicate operation must reset or re-target this cursor sensibly (§12), but there is nothing here to "fix up" in the project-correctness sense; it's UI focus state, rebuilt from `renderAll()` on every relevant change already. |
| 15 | `eventlist.js`'s search index | `renderer/forges/map/eventlist.js:39-120` | `buildEventIndex`, called fresh every time the search modal opens | **flat**/`mapIndex`+`screenIndex`, all read live from `flatScreens(project)` | Not a stored reference — rebuilt from the live project on every open. Self-heals by construction; included because it independently reads `props.toScreen` (line 75) and needed checking. |
| 16 | Two independent flatteners | `main/build/generate.js:1255-1279` (`flattenScreens`, build-side) vs. `shared/project.js:2232-2240` (`flatScreens`, UI-side) | both compute "maps in order, screens in order," reconciled only by `test/unit/project.test.js:3265-3281` | both **flat** | Not a stale-*reference* risk by itself (both are recomputed from `project.maps` live, never cached), but a **single-writer violation** this design's own new code must not add a third instance of — see §4.1. |
| 17 | **Saved game's `flat_screen` byte** (battery/flash cartridge save, not project JSON) | `shared/save.js:90-91` (`SAVE_FIELDS[0] = { ram: 'flat_screen', size: 1 }`); `engine/save.asm:296-302` (`save_check_valid`'s only guard: `cmp #NUM_SCREENS` / `bcs save_check_invalid` — range only); `engine/save.asm:540-549` (`continue_game`: `load_apply_body` restores it, then `jmp redraw_screen` draws whatever screen the restored value now names) | Written by `script_op_save`/`continue_save` at play time (`engine/save.asm:471-486` writes the identity bytes; the body write, including `flat_screen`, is the routine just above); read by `continue_game` on every Continue | **flat**, **persisted outside the project entirely, on the player's own cartridge** | **Missed by round 1 of this design, and by its own "never serialized into a save slot" claim in the prior §5 — both wrong, corrected here.** `saveIdentity()` (`shared/save.js:207-247`) folds in `screenCount`/`mapCount` (**counts**, not order — confirmed reading the fold loop, lines 229-241), so a reorder that preserves both counts (the common case: swapping two maps, or any permutation that adds or removes nothing) leaves `saveIdentity`'s output **completely unchanged**. `save_check_valid`'s marker, identity, and checksum gates therefore all still pass, and the range check (line 301, `cmp #NUM_SCREENS`) still passes too, because the *count* of screens is exactly what did not change. The record is accepted, `continue_game` restores the stored `flat_screen` byte verbatim, and `redraw_screen` draws whatever content now sits at that flat position — which, after a correct reorder, is very likely a *different room* than the one the player actually saved in. This is the identical stale-reference class the whole feature exists to eliminate, on a byte this design's original inventory did not think to look for because it lives on the cartridge, not in `project.json`. §6.10 is the fix; §11's save-compatibility test matrix is its proof. |

**What the inventory rules out, checked and not merely assumed:** metatile-collision type `'warp'`
(`shared/project.js:210`, `engine/constants.asm:761` `COL_WARP`) carries no target screen at all —
grepped every `.asm` file for `COL_WARP` outside its own definition: none found beyond the
"passable, like damage" comment in `probe_solid` (`engine/player.asm:259-264`). It is a Tile Forge
authoring/coloring category with no distinct engine behavior today, and no screen-index payload to
remap. `join`/`battle` (party recruitment slot, monster actor ids) carry no map-adjacent operand,
verified directly against `encodeCommand`'s cases (`textcompile.js:321-322, 378-392`). Common events
(`shared/project.js`'s `normalizeCommonEvents`, `main/build/textcompile.js`'s common-event table) have
no map affinity in the wire format at all — a common event is a pure id→slot table, callable from any
placement, confirmed by `commonEventTableIndex`'s assignment order having nothing to do with which
screen calls it. **Checked again for this revision and still ruled out:** `cur_map`/`pc_status` are
deliberately *not* in `SAVE_FIELDS` (`shared/save.js:74-88`'s own comment explains why for each), so
neither is a second cartridge-persisted screen/map reference alongside row 17 — `flat_screen` is the
only one.

## §4. Findings — pre-existing gaps this research surfaced, not asked for

These are not features the brief requested; they are facts about the current tree this design cannot
honestly omit, because the mechanism this design builds (§5-§6) sits directly on top of all three.
Presented for the review rounds to weigh, not silently fixed or silently ignored.

### §4.1 — Two independently-written flatteners, reconciled only by a test

`main/build/generate.js`'s `flattenScreens` (build-side, computes flat order + grid neighbours +
per-map base) and `shared/project.js`'s `flatScreens` (UI-side, computes flat order + labels for
pickers) are two separate implementations of "maps in `project.maps` order, screens in each map's own
order." They are held equal only by `test/unit/project.test.js:3265-3281`
(`'the screen list the UI offers is numbered the way the engine numbers screens'`), not by either
importing the other — `generate.js` cannot import from the renderer-adjacent picker-label code and
`shared/project.js` cannot import `main/build/generate.js` (that direction would pull `node:fs` into a
module both the renderer and `node:test` import, the same boundary `battletables.js` was split out to
respect). **This design does not fix that split — fixing it is a larger, orthogonal single-writer
change with its own risk (touching the one function every screen picker and every compiled table both
depend on) — but it does not add a third implementation either.** §6.1's remap primitive is built by
calling `shared/project.js`'s existing `flatScreens` twice (before/after a mutation) and diffing by
object identity, never by re-deriving flat-index arithmetic by hand. Recorded as a finding for the
review rounds to decide: accept the pre-existing split as out of scope, or fold a unification into
this slice. This design's own recommendation is to leave it: unifying it correctly means either
`generate.js` importing UI-adjacent code or `shared/project.js` growing a `node:fs` dependency, and
either is a bigger, riskier change than what item 7 asks for. The existing test is what item 7's own
new code must keep passing, unchanged. **Confirmed correct by round 1's review** ("Leaving the two
flatteners separate is defensible in this slice... The new remap should keep consuming `flatScreens`,
not add a third arithmetic implementation") — unchanged in this revision.

### §4.2 — Add/Delete Map and Resize Map already restructure the map/screen list with zero reference repair

Read `renderer/forges/map/map.js:1476-1505` (Add/Delete Map) and `598-619` (`resizeMap`) in full.

**Add Map** (`map.js:1474-1478`) is the third case, named in this section's own title from round 1 but
never actually analyzed until this revision (Fix round 3, finding 2 — the review's own citation of the
gap this left). The handler is bare: `project.maps.push(createMap(project.maps.length, ...))`, nothing
else. This is the identical append-retargeting hole §6.2 already found and fixed for Duplicate Map's own
append path (Fix round 1, finding 4), left unfixed here: pushing a new map lengthens `flat.length`
without touching a single pre-existing reference, so a stored operand that was already out of the
project's *current* range — legal per §3 rows 1-2's loose byte clamp, e.g. a door's `props.toScreen =
255` in a three-screen project, already resolving to screen 2 via the compiler's own `Math.min` — gets
silently re-clamped against the *larger* post-append count the next time the project builds, and now
resolves to whatever new screen the append just created instead of the screen it always meant. Add Map's
own new map starts with a single blank screen and no entities of its own, so — unlike Duplicate Map —
there is no self-referential/external split to worry about; the *only* fix Add Map needs is the same
project-wide canonicalizing pass §6.2 already built for duplicate-append, applied to the rest of the
project before the new map's own screens can retarget anything. §6.2 now states this explicitly and
generalizes the shared primitive so all three callers (Fix round 5, finding 5 — corrected from "both,"
stale since §6.2.1's own fallback became a third one) use one function, not three.

**Delete Map** (lines 1494-1501): `project.maps.splice(index, 1)`, then `entry.id = position` for
every remaining map (which only touches the already-vestigial `id` field, §3 row 11), then a **range**
clamp on `startMap`/`startScreen` if they now point past the end, **and no clamp of any kind on
`titleMap`/`titleScreen`**. **No walk of any entity's `props.toScreen`, any `warp` command's `screen`
operand happens at all.** Deleting a map that owned flat indices 3-7 (say) leaves every door/warp that
targeted flat index 8+ now pointing 5 positions too high — silently landing the player on whatever
screen now happens to occupy that slot, with no warning, because (per §3 row 1/2) these fields are
never range-checked against "does this still make sense," only clamped to "is this a legal byte" at
compile time. **Resize Map** (`resizeMap`, lines 598-619) has the identical gap: shrinking a grid drops
the screens that fall outside the new `gridW × gridH`, discards them, and touches only `startScreen`
(a range clamp, not a content-preserving fixup, and only when the *currently open* map is the one being
resized and happens to be the start map) — no door/warp anywhere in the project is walked, and
`titleScreen` is not touched even by a range clamp.

This is not a new problem item 7 introduces; it is the problem item 7 exists to solve, already present
in shipped, undocumented form. **This design retrofits all three — no longer a proposal left to the
review rounds' discretion (round 1 offered Delete/Resize as optional; the review's own finding 2 in each
round treats the gap as in-scope, and this revision agrees: it is the identical mechanism reorder needs,
and shipping a "safe reorder" beside three known-unsafe siblings that already exist and already look
superficially similar would be an inconsistent result for a feature item 7 explicitly frames as being
about safety).** §6.2 (Add Map, alongside Duplicate Map's own append path), §6.8 (Delete Map) and §6.9
(Resize Map) are the full specifications, including the map/per-map translations round 1 did not define
at all. The marginal cost is near zero once §6.1's `remapScreenReferences` exists: all three call sites
already funnel through `store.commit`, so the fix is a bare `push`/`splice`/truncation each gaining the
same remap call reorder and duplicate-append already use, plus the per-map fixup §6.8/§6.9 add for
Delete/Resize specifically (Add Map, per the paragraph above, needs only the canonicalizing half — it
neither drops nor relocates any pre-existing map).

### §4.3 — No duplicate-name validation for maps or screens

Grepped `shared/project.js`'s entire `validateProject` for any check comparing two map or screen
names: none exists. This matters concretely, not just tidiness: `shared/playscenario.js`'s
`resolveStartAt` (§3 row 13) **refuses to resolve** a remembered scenario the moment two maps or two
same-map screens share a name ("more than one map/screen is named X" — the file's own documented
"refuse rather than guess" policy). A duplicate feature that defaults to reusing the source's exact
name would trip this refusal on the very next ↻ Reload Test. §6.2 makes duplicate auto-suffix names to
avoid manufacturing this collision by construction, for both maps (confirmed correct by round 1's
review) and — corrected this revision, Fix round 1 finding 6 — screens as well; §9 adds a
`validateProject` warning (not an error — nothing is actually broken at compile time, screens still
compile fine with duplicate names) so an author who renames things back into collision by hand is
told, the same "warn, don't block" shape the existing pickup-actor-with-no-item warning already uses
(`shared/project.js:3738-3747`).

## §5. The identity question

`ROADMAP.md` lines 219-228 record that a persistent opaque id per map/screen/actor was considered and
declined for play scenarios — a schema migration carried forever to serve throwaway session state —
and names item 7's reordering as "the likely place to revisit it."

**Decision: pure renumber, no persistent ids.** Reorder, duplicate, and (per §4.2) the retrofit of
delete and resize are all expressed as a **remap function over the flat/map/per-map index spaces**,
applied in the same `store.commit()` that performs the structural edit — the same shape
`renumberSongDeletion`/`renumberSfxDeletion`/`renumberActorDeletion`/`renumberItemDeletion`
(`shared/project.js:1145-1181, 1261-1293, 1327+`) already establish for four other reference domains.
No new field is added to `project.maps[]` or `map.screens[]` for identity purposes. (§6.10 adds one
field, `project.project.saveCompatToken` — a project-wide, independently-redrawn 16-bit nonce for the
save record's own compatibility check, drawn fresh on every qualifying structural edit (reuse possible
with probability `1/65535`, per §6.10's own honest accounting), categorically **not** a per-map/
per-screen id; see §6.10's own note on why this does not weaken the decision below.)

**Why this is sufficient, argued from the actual mechanism rather than by analogy alone:**

1. **The permutation is always known exactly, in advance, by the operation itself.** Unlike a
   deletion elsewhere in this codebase (where "shift everything above the hole down by one" has to be
   *inferred* from a single removed index), a reorder's whole *purpose* is that the UI gesture — drag
   a map to a new position, or a duplicate's insertion point — already fully determines the old→new
   mapping before any mutation runs. There is no uncertainty to resolve with an id lookup; the
   permutation *is* the input to the operation, not something recovered after the fact.
2. **The remap can be built by diffing the existing `flatScreens()` primitive against itself, keyed by
   object identity, rather than by any new index arithmetic.** §6.1 computes it as: snapshot
   `flatScreens(project)` before mutating `project.maps`'s order, mutate, snapshot `flatScreens(project)`
   again, and match old and new flat positions by `entry.screen` object identity (the same screen
   object simply moved to a different array slot; JS object identity survives an array permutation for
   free). This reuses the one already-tested flattening primitive twice rather than re-deriving "where
   did flat index N go" by hand — the single-writer discipline applied to the remap itself, not just to
   the schema fields it touches. The same diff-by-identity idea, applied to one map's own `screens`
   array instead of the whole project's flat list, is what §6.9 uses for Resize Map's per-map fixup —
   one idea, two scales, not two mechanisms.
3. **An opaque id would have to be threaded through every one of the ~17 sites in §3's inventory**,
   each already storing a numeric index today, each already correctly normalized/clamped by existing
   code that has nothing to do with identity. Every one of those sites still needs *some* resolution
   step at build time (an id is not a compiled address either — the ROM still needs a flat byte index,
   §3 rows 1-2), so an id buys nothing at the one place that ultimately matters (the compiled bytecode)
   and adds a live schema migration (`SAVE_LAYOUT_VERSION`-adjacent risk) for a problem the remap
   already solves completely.
4. **`map.id` (§3 row 11) already looks like it could be this identity, and already is not.** It is
   reassigned to array position on every `normalizeProject`, unread anywhere, and would need to become
   a genuinely stable, uniquely-generated value (and every map-referencing field converted to store it
   instead of an array index) to serve as identity — a strictly larger change than adding the remap,
   for a field that presently does nothing.
5. **This mirrors the routes precedent's own methodology, not just its conclusion**: `design-routes.md`
   chose "reuse the machinery that is already correct" (`isLive`/`allCommands`/`encodeBody`) over
   inventing a parallel mechanism. Here, the renumber-on-delete family is the already-correct machinery;
   generalizing it from "delete → shift by one" to "arbitrary permutation, known in advance" is a
   smaller, more consistent step than introducing ids.

**Round 1's review confirmed this decision directly** ("Declining persistent per-map/per-screen ids
remains honest for the operations in scope: the gesture knows the permutation, and one atomic renumber
commit can preserve project references") **with one qualification this revision addresses rather than
disputes: "The missed cartridge save does require a compatibility revision/fingerprint, not necessarily
object ids."** §6.10's `saveCompatToken` is exactly that fingerprint (in the shape the round-2 brief's
own framing invited — a "generation/nonce," independently redrawn rather than layout-derived, per
§6.10's own argument that a layout-derived one is unachievable without per-screen identity), and it is
deliberately *not* a per-map/per-screen
id — it never names any particular map or screen, only "has the project's screen layout structurally
changed since this value was last drawn," which is a single project-wide fact, not an identity for
anything. The distinction matters: an id would have to be stable, unique, and attached to the *thing*
it identifies, threaded through every reference; `saveCompatToken` is a plain value attached to the
*project*, read in exactly one place (`saveIdentity`), and this decision's argument against ids (point 3
above) is completely unaffected by adding it.

**Where this decision would break, stated honestly:** if a future feature needed to survive *content*
identity across an edit where the permutation is genuinely unknowable in advance — e.g., detecting
that a map was deleted and a near-identical one re-created by hand outside this UI, and treating them
as "the same map" — no renumber scheme can do that; only a real persistent id could. Nothing in item
7's actual feature list (duplicate, reorder, folders, named screens, copy/paste, overview) needs that
guarantee. If a future roadmap item does, the identity question should be revisited again, and this
design does not foreclose adding a persistent id later — the schema has no field currently occupying
the name a real one would want (`map.id`'s vestigial write-only status, §3 row 11, means a future
persistent id could even claim that name once repurposed, though that repurposing is itself out of
scope here).

## §6. The central mechanism

### §6.1 — `remapScreenReferences(project, translate)`, the one new shared function

Lives in `shared/project.js` (single-writer: it is a schema-fact-adjacent operation over stored
references, the same tier `renumberActorDeletion` etc. already occupy in this file). Signature and
body are **unchanged from round 1** — what changes this revision is what `translate` itself must do
before this function ever sees it (Fix round 1, finding 4, below), which is deliberately kept *outside*
this function so it stays a dumb, generic walker:

```js
/**
 * Rewrites every stored screen/map reference in `project` through `translate`
 * — a function from an old flat screen index to either a new flat screen
 * index, or DROPPED_SCREEN (a screen that no longer exists after this edit).
 * The caller supplies `translate`; this function is the single place that
 * knows *which fields* to walk, not how any particular operation computes
 * its permutation. Mutates `project` in place and returns it, matching
 * renumberActorDeletion's own contract.
 *
 * translate must be TOTAL over every raw stored value this function can
 * encounter, including one already out of the project's current flat range
 * (see the canonicalization note on every translate-builder below) -- there
 * is no third answer ("leave it alone"): a reference this function does not
 * resolve is a reference this function is wrong about, not one that is safe
 * to skip.
 */
export function remapScreenReferences(project, translate) {
  const droppedTargets = [];

  // 1. Door targets -- every placed entity, every map, every screen, whether
  //    or not its actor is currently door-behaved (see §3 row 1: this field
  //    is only ever screen-shaped at the schema level, so walking it
  //    unconditionally is correct, not merely permitted).
  for (const map of project.maps) {
    for (const screen of map.screens) {
      for (const entity of screen.entities ?? []) {
        const old = entity.props?.toScreen ?? 0;
        const next = translate(old);
        if (next === DROPPED_SCREEN) {
          droppedTargets.push({ kind: 'door', entity });
          entity.props.toScreen = FALLBACK_SCREEN(project); // §6.4
        } else {
          entity.props.toScreen = next;
        }
      }
    }
  }

  // 2. Warp command operands, wherever a warp sits -- allCommands, not a
  //    page's own top level (CLAUDE.md's own warning: a switch set inside a
  //    branch was invisible to a top-level-only walk once already).
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op !== 'warp') continue;
        const next = translate(command.screen);
        if (next === DROPPED_SCREEN) {
          droppedTargets.push({ kind: 'warp', command });
          command.screen = FALLBACK_SCREEN(project);
        } else {
          command.screen = next;
        }
      }
    }
  }

  // 3. titleMap/titleScreen and startMap/startScreen are NOT flat-space --
  //    see §6.6 (reorder's easy case, where they barely move) and §6.8/§6.9
  //    (delete/resize's harder case, where a genuine per-map translation is
  //    required). This function only ever receives a flat-space translate;
  //    map-space and per-map-space fixups are distinct, smaller steps each
  //    caller applies itself, because folding them in here would force
  //    every caller of THIS function (including a future one that only ever
  //    touches flat space) to also supply translates it may not have.

  return { project, droppedTargets };
}
```

`DROPPED_SCREEN` is a module-local sentinel (a unique object or symbol, never serialized — it never
survives past this one function call, so it needs no wire representation and no
`shared/project.js`-exported constant the way `NO_ACTOR`/`NO_ITEM` are). `droppedTargets` is returned,
not thrown away — §6.4/§9's reporting story (rewritten this revision, Fix round 1 finding 7) consumes
it directly, not through the project schema.

**Fix round 1, finding 4 — canonicalize before translating, not after.** Round 1's translate-builders
looked up `before[oldFlat]` directly; if `oldFlat` was already out of the project's *current* flat
range (a legal 0-255 byte per §3 rows 1-2's loose schema clamp, just larger than `flat.length`), the
lookup found nothing and the value was treated as `DROPPED_SCREEN` — redirected to `FALLBACK_SCREEN`
(flat 0) even when the compiler's own clamp (`Math.min`/`byte`, §3 rows 1-2) would have resolved it to
a real, specific, *already-intended* screen. The review's own worked example: a stored `255` in a
three-screen project already means screen 2 (`Math.min(255, 2)`); round 1's reorder translator would
have redirected it to screen 0 instead of following screen 2 to wherever it moved. **Every
translate-builder below now canonicalizes its input first** — resolves the raw stored value through
the *same* clamp the compiler already applies, against the flat count *as it was before this edit
began*, and only then looks up where that resolved screen went:

```js
// Shared by every translate-builder in §6.1.1/§6.1.3/§6.7/§6.8/§6.9. Not
// exported -- it is an implementation detail of how a translate resolves its
// input, never called on its own. Mirrors main/build/generate.js:2586's
// Math.min(toScreen, flat.length-1) and main/build/textcompile.js:171-172's
// byte(command.screen, screenCount-1) exactly, against the PRE-edit flat
// count, because that is the count the stored value's own meaning was last
// resolved against -- resolving it against a POST-edit count (as duplicate's
// append would, if this step were skipped) lets an unrelated capacity change
// silently retarget an already-meaningful reference. See §6.2's own honest
// accounting of what this costs duplicate.
function canonicalizeFlat(value, flatLengthBefore) {
  return Math.max(0, Math.min(value | 0, flatLengthBefore - 1));
}
```

With this step, `DROPPED_SCREEN` now means exactly one thing across every translate-builder: **this
screen was deleted by *this* operation**, never "the stored number happened to be too big." A
value that was already garbage before the edit began is resolved to whatever it already, effectively,
meant — and *then* translated like any other reference. This is a real behavior change from round 1,
stated honestly rather than folded in silently: **it means every stored reference, project-wide, is a
candidate for rewriting on every structural edit — including duplicate-append, which round 1 claimed
needed "zero rewriting."** §6.2 corrects that claim directly.

#### §6.1.1 — Building `translate` for Reorder (a total bijection, canonicalizing)

```js
function buildReorderTranslate(project, newMapOrder /* array of old map indices, in new order */) {
  const before = flatScreens(project); // OLD project.maps order
  const reordered = newMapOrder.map((oldIndex) => project.maps[oldIndex]);
  const probe = { ...project, maps: reordered }; // no mutation yet -- a read-only probe
  const after = flatScreens(probe); // NEW order, screen objects unchanged
  const afterIndexOf = new Map(after.map((entry, i) => [entry.screen, i]));

  return (oldFlat) => {
    const canonical = canonicalizeFlat(oldFlat, before.length);
    const screen = before[canonical]?.screen;
    if (!screen) return DROPPED_SCREEN; // only when before.length === 0 -- an empty project, unreachable in practice
    return afterIndexOf.get(screen); // always found -- reorder drops nothing
  };
}
```

`probe` is a shallow object spread, not a clone — `flatScreens` only ever reads `.maps`/`.screens`, so
this costs nothing and mutates nothing. The actual mutation (`project.maps = reordered`) happens once,
in the `store.commit` callback, after `translate` has already been built from the pre-mutation state —
ordering matters: `translate` must be computed from `before`/`after` around the *specific* mutation
being applied, so the caller always does "capture `translate`, mutate `project.maps`, call
`remapScreenReferences`" in that order, never mutate-then-build.

#### §6.1.2 — Duplicate does not build a project-wide `translate` for its own copy

Covered in full in §6.2 — duplicate's copy is new content with no "old" flat index to translate *from*,
so its own internal self/external split is computed directly, not through `remapScreenReferences`.
What duplicate *does* now use `remapScreenReferences` for, corrected this revision, is a project-wide
**canonicalizing pass** (§6.2's own subsection) — a distinct, smaller job from the copy's own rewrite.

#### §6.1.3 — Building `translate` for the Delete Map retrofit (flat-space half; the map/per-map half is §6.8)

```js
function buildDeleteMapTranslate(project, mapIndexToDelete) {
  const before = flatScreens(project);
  const survivingScreens = new Set(
    before.filter((entry) => entry.mapIndex !== mapIndexToDelete).map((entry) => entry.screen)
  );
  const probe = { ...project, maps: project.maps.filter((_, i) => i !== mapIndexToDelete) };
  const after = flatScreens(probe);
  const afterIndexOf = new Map(after.map((entry, i) => [entry.screen, i]));

  return (oldFlat) => {
    const canonical = canonicalizeFlat(oldFlat, before.length);
    const screen = before[canonical]?.screen;
    if (!screen || !survivingScreens.has(screen)) return DROPPED_SCREEN;
    return afterIndexOf.get(screen);
  };
}
```

This is the flat-space half only — every door/warp project-wide. §6.8 assembles the full Delete Map
operation, including the map-space (`startMap`/`titleMap`) fixup this translator does not and cannot
cover (it only ever answers "where did flat index N go," never "which map was that in").

#### §6.1.4 — Building `translate` for the Resize Map retrofit (flat-space half; the per-map half is §6.9)

```js
function buildResizeTranslate(project, mapIndex, newScreens /* the resized map's own new screens array, resizeMap's own algorithm */) {
  const before = flatScreens(project); // pre-resize, whole project
  const keptFromResizedMap = new Set(newScreens); // screens that survive the resize (grow: all of them; shrink: a subset)
  const probe = {
    ...project,
    maps: project.maps.map((m, i) => (i === mapIndex ? { ...m, screens: newScreens } : m))
  };
  const after = flatScreens(probe);
  const afterIndexOf = new Map(after.map((entry, i) => [entry.screen, i]));

  return (oldFlat) => {
    const canonical = canonicalizeFlat(oldFlat, before.length);
    const entry = before[canonical];
    if (!entry) return DROPPED_SCREEN;
    if (entry.mapIndex === mapIndex && !keptFromResizedMap.has(entry.screen)) return DROPPED_SCREEN; // a shrink dropped it
    return afterIndexOf.get(entry.screen);
  };
}
```

A grow never drops anything (`keptFromResizedMap` is a superset of the resized map's old screens, plus
new blanks nothing yet references); a shrink drops exactly the screens `resizeMap`'s own row/column-
preserving rebuild leaves out of `newScreens`. Every screen belonging to *another* map is untouched by
`keptFromResizedMap`'s check and simply follows its own (possibly shifted, since every map after this
one's flat base moves when this map's own screen count changes) new flat position via the diff — the
identical mechanism a reorder or a delete already uses, applied to a resize's own before/after shape.

### §6.2 — Duplicate (and Add Map plus §6.2.1's fallback, the other two append-shaped operations — Fix round 3, finding 2; Fix round 5, finding 5)

**The complete set of bare-append operations, stated once (per the brief's own sweep request), so no
fourth one can hide.** Three places push a new map onto `project.maps` without inserting or removing
anything else: **Add Map** (`renderer/forges/map/map.js:1474-1478`, a brand-new, empty map),
**Duplicate Map** (below, a cloned map), and — **corrected this revision, Fix round 4, finding 1** —
**"duplicate a screen into a brand-new 1×1 map,"** the single-screen-duplicate fallback offered when
every existing map is already full at `4×4`. Round 3's own text called this third path "mechanically
identical to duplicate a whole map... with a synthetic one-screen source" and left it there, as an
analogy rather than an assembled operation — the review is right that an analogy does not answer any of
the observable questions a real implementer would hit first (what metadata the synthetic map gets, what
it and its one screen are named, which source range is "self" for the clone). §6.2.1 (below) is the full,
named specification; it is presented as its own operation because its contract genuinely differs from
whole-map Duplicate's (a *singleton* source range — one screen, not a whole map's worth — and freshly
*synthesized* map metadata rather than a cloned map object), even though it reuses the identical shared
primitives every other append site here does, never a second implementation of either. Checked against
this design's own full operation inventory (§12's UI list) for anything else that could silently push
onto `project.maps`: Delete/Resize splice or replace in place (§6.8/§6.9), region copy/paste never
touches `project.maps` at all (§6.3), and folder edits touch only a `.folder` field, never the array's
own length (§8). These three are therefore the complete set — all funnel through the same shared
primitive:

```js
// Shared by all three bare-append operations (Fix round 5, finding 5 --
// corrected from "both," stale since §6.2.1's fallback became a third
// caller). beforeAppendFlatLength is
// captured BEFORE anything is pushed. Every surviving old flat index
// keeps EXACTLY its old numeric value after an append (nothing moved),
// so the only real work this does is resolving pre-existing garbage
// (§6.1's canonicalizeFlat) to its already-effective target -- never
// DROPPED_SCREEN, since append removes nothing.
function buildAppendCanonicalizeTranslate(beforeAppendFlatLength) {
  return (oldFlat) => canonicalizeFlat(oldFlat, beforeAppendFlatLength);
}
```

**Add Map, assembled — the whole fix, since a fresh empty map has no self-referential/external split to
worry about (§4.2's own argument):**

```js
// Fix round 3's own self-check (below) found the real shipped handler's
// naming template, `Map ${project.maps.length}`, collides after a Delete:
// two maps, delete the first, Add Map again -- project.maps.length is back
// to 1, so the new map is named "Map 1", identical to the surviving
// original. nameForNewMap closes it the same way nameForDuplicateScreen
// (below) already avoids the identical collision for a duplicated screen --
// scan for the first untaken "Map N", not just the current length.
function nameForNewMap(existingMaps) {
  const taken = new Set(existingMaps.map((m) => m.name.trim()));
  for (let n = existingMaps.length; ; n++) {
    const candidate = `Map ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function addMap() {
  store.commit('Add map', (project) => {
    const beforeAppendFlatLength = flatScreens(project).length;
    project.maps.push(createMap(project.maps.length, nameForNewMap(project.maps)));
    remapScreenReferences(project, buildAppendCanonicalizeTranslate(beforeAppendFlatLength));
    // No saveCompatToken redraw -- screenCount/mapCount already change
    // (§6.10), the identical argument this section already makes for
    // Duplicate Map's own append path, below.
  });
}
```

**Duplicate a whole map.** Always **appended** to the end of `project.maps` — never inserted in the
middle. This keeps every *already-in-range* existing reference's flat *value* unchanged (append never
shifts an existing screen's position), which is most of why duplicate stays cheap — but, corrected in an
earlier revision (Fix round 1, finding 4), it is no longer true that **nothing** in the rest of the
project is touched:

- The map is `structuredClone`d, given a name (`${source.name} copy`, then ` copy 2`, ` copy 3`, ... —
  the first name not already used by any existing map, closing §4.3's collision risk by construction
  rather than by validation alone), and pushed onto `project.maps`.
- **A project-wide canonicalizing pass runs immediately after the append, via
  `remapScreenReferences(project, buildAppendCanonicalizeTranslate(beforeAppendFlatLength))`** — the
  identical shared primitive Add Map uses above, not a second, duplicate-specific implementation.

  **This is the honest correction the review demands (Fix round 1, finding 4): duplicate-append is no
  longer a zero-rewrite free ride.** Round 1's claim that "every existing reference in the project needs
  zero rewriting" was true only for references that were *already* in canonical range. A stored `255` in
  a three-screen project (meaning screen 2, per the compiler's own clamp) would, after an unguarded
  append that grows `flat.length` to 5, silently start meaning screen 4 (the new last screen, i.e. part
  of the very thing that was just duplicated) instead of the screen it always meant — a real, silent
  retarget caused by content elsewhere in the project growing. Running this canonicalizing pass closes
  it: every already-in-range value is untouched (a true no-op rewrite — the pass writes back the exact
  same number), and every already-out-of-range value is corrected to its pre-edit effective target,
  immune to the append's own growth. **This walk also reaches the copy's own freshly-cloned entities
  and events**, which is deliberate and necessary — see the next bullet.
- **The self-referential/external split, worked through concretely, now including the copy's own event
  pages (Fix round 1, finding 3's second half).** Before cloning, capture
  `sourceFlatRange = [oldBase, oldBase + sourceMap.screens.length)` (the source map's own flat range,
  from `flatScreens(project)` computed *before* the duplicate is appended). After the clone is pushed
  and the canonicalizing pass above has run (so every reference inside the copy is now a real,
  in-range, already-resolved flat index — never raw garbage), its own new flat range is
  `[newBase, newBase + sourceMap.screens.length)` at the same relative offsets (screen *i* of the
  source is always screen *i* of the copy, since both are the identical per-map array order). A single
  scoped helper, applied to the copy's screens only:

  ```js
  // delta = newBase - oldBase. Runs AFTER the canonicalizing pass above, so
  // every value read here is already a real, in-range flat index -- this
  // function only ever decides self-referential vs. external, never resolves
  // garbage (that already happened).
  function rewriteClonedRange(copyScreens, sourceFlatRange, delta) {
    const inRange = (flat) => flat >= sourceFlatRange[0] && flat < sourceFlatRange[1];
    for (const screen of copyScreens) {
      for (const entity of screen.entities ?? []) {
        const target = entity.props?.toScreen ?? 0;
        if (inRange(target)) entity.props.toScreen = target + delta;
        // else: external -- already correctly canonicalized above, untouched here.
        if (entity.props?.event) {
          for (const page of entity.props.event.pages ?? []) {
            for (const command of allCommands(page.commands)) {
              if (command.op !== 'warp' || !inRange(command.screen)) continue;
              command.screen += delta;
            }
          }
        }
      }
    }
  }
  ```

  For a whole-map duplicate, `copyScreens` is the copy's own `.screens` array. **Round 1's design
  called this split "the self-referential/external split" but applied it only to entities' own door
  bytes — never to `warp` commands sitting inside the copy's own entity-attached events (top-level,
  inside a `branch`, inside a `choice` option), leaving a copied nested Warp aimed at the original map
  forever (finding 3's second half).** `allCommands`, not a page's top level, closes this the same way
  §6.1's project-wide walk already does — a route can never carry a warp leg (`routeLegs` admits only
  move/turn/wait, §3 row 2's own note), so no fourth nesting shape needs separate handling here.
  **`project.commonEvents` is deliberately never touched by this function** — a common event is not
  "the copy's own"; it is a project-wide, id-referenced body any placement's `call` can reach
  (`projectEvents`'s own definition walks it separately, §2), so duplicating a map that contains a
  placement which `call`s a common event leaves that common event completely alone, correctly: the
  common event still means whatever it meant before, for every caller, original and copy alike.
- `titleMap`/`titleScreen`/`startMap`/`startScreen`: untouched. They name a specific map by its old
  array index, which is unaffected by an append (§6.6's map-space reasoning applies identically here —
  nothing shifted).
- Capacity: no new code. The duplicate simply makes `project.maps`/`flat.length` longer, and
  `checkCapacity`'s existing screen-count and kernel-table-byte math (`main/build/generate.js:1629-1638`,
  `kernelTableBytes`'s `13 * flat.length + 9 * project.maps.length`, `generate.js:1564`) already
  refuses with its existing plain-language "This project has N screens but {mapper} holds M" message —
  exactly the brief's requirement, met by construction rather than by new capacity code.
- **Save compatibility: deliberately not bumped.** §6.10 explains why — `screenCount` (already folded
  into `saveIdentity`) strictly increases on every append, so an old save is already refused without
  needing `saveCompatToken` too.

**Duplicate a single screen.** More constrained than duplicating a map, because — per §3 row 10 — a
map's screens are a `gridW × gridH` grid, not a free list: there is no "append one more screen" the
way there is for maps. **Fix round 1, finding 3 — blank-cell reuse is dropped entirely, not renamed.**
Round 1's algorithm's first option silently overwrote a `createScreen()`-shaped cell with the
duplicate's content, on the theory that a content-empty cell was an unreferenced slot. The review is
right that this is false: a blank cell is a real screen with a real flat index — it participates in the
neighbour tables (§3 row 10), it can already be a door/warp target, it can already be `startScreen`/
`titleScreen`, and (§3 row 17) it can already be a saved `flat_screen`. Overwriting it in place changes
what every one of those existing references means, silently, with no numeric value moving at all —
exactly the class of bug this whole design exists to prevent, reintroduced through the one path that
looked cheap enough not to need the mechanism. **This design does not offer a destructive "Replace a
blank cell" operation either** — weighed against the brief's own steer to keep it only if genuinely
useful, the three remaining paths below already cover the real use case (reusing screen real estate
without wasting it) with no added risk surface, so the simpler, safer choice is to drop it outright
rather than design and test a second destructive confirmation flow whose main benefit over "grow the
grid" is a few saved bytes of capacity. The algorithm, in order of preference:

1. **Grow the current map's grid by one row or column**, if `gridW * gridH < LIMITS.mapGrid ** 2` (16),
   using the *exact* growth `resizeMap` already performs (`map.js:598-619`: existing screens keep their
   row/col; new cells fill with `createScreen()`) — with the duplicate's content placed into one of the
   newly-created cells instead of a blank one. **This does not run through the whole-map case's
   `rewriteClonedRange` split above, and does not run the clone's operands through the generic resize
   remap either — both would silently mis-route a self-reference the moment growth actually relocates
   the source screen, per Fix round 2, finding 2's own counterexample.** §6.9's own resolution
   (`growOrShrinkMap`, `buildCloneTranslate`, `applyCloneTranslate`, and the assembled
   `duplicateScreenViaGrowth`) is the complete, corrected mechanism for this path; it is presented there,
   beside the resize machinery it shares a commit with, rather than duplicated here.
2. **A different, existing map with room to grow.** Offered as a target-map picker in the duplicate
   dialog (§12) when the current map is already full (`gridW * gridH === LIMITS.mapGrid ** 2`);
   mechanically identical to (1) once a target map is chosen — `duplicateScreenViaGrowth`'s own
   `mapIndex` argument simply names the chosen map instead of the currently-open one.
3. **A brand-new 1×1 map**, if nothing above applies (every existing map full at 4×4). **Fully specified
   in §6.2.1, corrected this revision (Fix round 4, finding 1)** — not "mechanically identical to
   duplicate a whole map" as round 3 left it, since that phrase never actually answered what the
   synthetic map's own metadata or either name is, or which source range is "self" for the clone.

This is not new machinery invented for duplicate — steps 1 and 3 reuse `resizeMap`'s own mechanism and
this section's own shared append primitives respectively, rather than reimplementing either, which is
the same "reuse what's already correct" discipline §5's identity decision argues for.

**Screen naming on duplicate (Fix round 1, finding 6).** Round 1 specified auto-suffixing for a
duplicated *map's* name but left a duplicated *screen's* name unresolved — an omission the review
correctly calls out, since cloning a screen named "Boss Room" produces two screens named "Boss Room" in
the same map, which `resolveStartAt`'s `screensNamed` (`shared/playscenario.js:61-63`, exact-string
match) refuses to disambiguate the moment either is remembered by a play scenario. **Decision:
auto-suffix, the identical rule the map case already uses, but scoped correctly — only when the source
screen's name is non-empty.** An empty name (`''`, the default `createScreen()` shape) is copied as
`''` verbatim, never suffixed into something like `" copy"` — a screen named `''` has no identity to
collide (`resolveStartAt`'s own bypass, §3 row 13(b)), and giving the copy a synthetic non-empty name
would be *inventing* a collision-prone identity where none was ever authored. The rule, checked against
every screen in the **destination map only** (the same map/per-map scoping `resolveStartAt`'s own
`screensNamed` uses — a same-named screen in a *different* map is not a collision `resolveStartAt` can
even observe, per §9's revised warning below):

```js
function nameForDuplicateScreen(sourceName, destinationMapScreens) {
  const trimmed = sourceName.trim();
  if (!trimmed) return ''; // unnamed stays unnamed -- nothing to collide
  const taken = new Set(destinationMapScreens.map((s) => s.name.trim()).filter(Boolean));
  if (!taken.has(trimmed)) return trimmed;
  // The unsuffixed "copy" candidate is generated on its own, once, before
  // the numbered loop starts at 2 -- producing exactly this prose's own
  // stated sequence, "copy, then copy 2, copy 3, ...". Phase 2 fixes round
  // 1, finding 3 corrects this sketch: an earlier version folded the
  // unsuffixed candidate into the loop by special-casing n===2 to omit the
  // number (`${trimmed} copy${n > 2 ? ` ${n}` : ''}`), which skips "copy 2"
  // entirely whenever "copy" itself is already taken -- contradicting this
  // same prose stated twice (here and in §6.2.1). See §15's own changelog
  // entry.
  const first = `${trimmed} copy`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${trimmed} copy ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
```

**Cross-tileset duplicate/paste — not a corruption risk, a content-fidelity warning, and it is a
*return value* from the operation, not a `validateProject`/`checkCapacity` finding.** `project.metatiles`
is a single **project-global** array of 64 metatile definitions (`shared/project.js:1564`,
`Array.from({length: LIMITS.metatiles}, ...)`), shared by every tileset — confirmed by
`renderer/forges/map/render.js:24-27`'s `MetatileRenderer.rebuild(project, tilesetId)`, which walks the
one global `project.metatiles` list and resolves each entry's raw tile indices against whichever CHR
bank `tilesetId` selects. A metatile id is therefore never "owned" by one tileset — the same id 5 can
draw completely different art depending on which tileset a screen uses, **already true today for any
multi-tileset project**, independent of copy/paste. Duplicating a screen (or, per §6.3, pasting a
region) onto a screen whose map uses a different `tilesetId` than the source cannot produce an invalid
reference (metatile ids are always in-range 0-63 by construction, `LIMITS.metatiles`), only
*potentially different-looking* art. **Fix round 1, finding 8 corrects where this warning can live**:
once the paste/duplicate completes, the resulting project contains only metatile ids — nothing in the
schema records "these ids arrived via a cross-tileset paste," so a *later* `validateProject`/
`checkCapacity` pass, run at some arbitrary future time against a project that has long since forgotten
where any given metatile id came from, cannot possibly reconstruct this warning. §6.3/§9's revised text
makes this explicit: the warning is returned synchronously by the duplicate/paste operation itself
(`{ warning: 'This map uses a different tileset — the copied art may not look the same here.' } | null`),
shown as an immediate toast, and never claimed as build-time diagnostic output.

### §6.2.1 — Duplicate screen into a brand-new map, assembled (Fix round 4, finding 1)

**The four observable choices the review names, decided and argued, before the assembled operation.**

- **The new map's metadata.** `tilesetId`, `songId`, `battleSkyTile`/`battleGroundTile`, `encounters`
  (rate + actor ids), **and `folder`** (Fix round 5, finding 1 — round 4's own list omitted it) all come
  from the **source map**, not `createMap`'s own generic defaults (`tilesetId: 0`, `songId: null`,
  `folder: null`, etc.). Argued as one policy, not five separate picks: the screen being promoted to its
  own map was authored against the source map's tileset — its metatile ids mean whatever they mean under
  *that* tileset's CHR bank (the identical cross-tileset reasoning this section's own closing paragraph
  already establishes for paste), so copying `tilesetId` is not a preference, it is the only choice that
  keeps the screen looking like it did a moment ago. `songId` and `encounters` are copied for the same
  reason applied to *behavior* rather than art: an author promoting one room out of a dungeon to its own
  map most plausibly wants that room to keep sounding and playing like it did inside the dungeon, not
  silently fall back to "no music, no wandering monsters." `folder` follows the identical reasoning
  applied to *organization*: whole-map Duplicate already preserves it for free (its own
  `structuredClone(sourceMap)` carries every field, `folder` included, §8's own display-only field), so a
  fallback that left the promoted screen's new map outside its source's folder would be the one
  observable place this operation's own "copy behaves like the original" policy quietly stopped applying
  — not a deliberate choice, an omission. Clearing `folder` (treating the fallback as "a genuinely new,
  unfiled map") was considered and rejected for the same reason a defaults-only metadata policy already
  is: it would be a second, unstated policy competing with the uniform one this section otherwise holds
  to throughout. A defaults-only alternative (leave `createMap`'s own zero-value fields) was considered
  and rejected: it
  would be a second, unstated policy competing with whole-map Duplicate's own "the copy behaves like the
  original" convention, for no benefit an author has asked for. `battleSkyTile`/`battleGroundTile` follow
  the identical reasoning for consistency, even though (per CLAUDE.md's own note) they index the
  *battle* tileset rather than the map's own — copying them keeps the promoted screen's battle backdrop
  visually identical to what it would have shown before, the same "the copy behaves like the original"
  argument applied uniformly rather than carving out an unexplained exception for two fields alone. One
  direct consequence worth stating: because `tilesetId` is always copied verbatim, **this path never
  needs this section's own cross-tileset warning at all** — the new map's tileset is, by construction,
  always the same tileset the screen was authored against.
- **The new map's own name.** The identical *shape* of collision-avoiding suffix whole-map Duplicate
  already uses (`${source.name} copy`, then ` copy 2`, ` copy 3`, ...), scoped against every existing
  map's name — a third sibling in the same naming-discipline family as `nameForNewMap` (Add Map, §6.2)
  and `nameForDuplicateScreen` (below): all three scan for the first untaken candidate rather than
  trusting a raw count, and none of the three duplicates another's own logic.

  ```js
  function nameForNewMapFromSource(sourceMap, existingMaps) {
    const trimmed = sourceMap.name.trim();
    const taken = new Set(existingMaps.map((m) => m.name.trim()).filter(Boolean));
    if (!taken.has(`${trimmed} copy`)) return `${trimmed} copy`;
    for (let n = 2; ; n++) {
      const candidate = `${trimmed} copy ${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  ```
- **The screen's own name, in its new per-map namespace.** `nameForDuplicateScreen`'s own rule (below),
  called exactly as written — non-empty names auto-suffix, empty names stay empty — against the *new*
  map's own `screens` array. Stated explicitly because it is worth naming even though it is a no-op in
  practice here: a freshly-`createMap`'d map's only screen is the very one about to be overwritten with
  the clone's content, so the "taken" set this call builds is always empty (a blank screen's own `''`
  name is filtered out by the same non-empty check `nameForDuplicateScreen` already applies) — the
  function is still called, for the same reason `remapScreenReferences` is still called on a bijection
  that provably drops nothing (§6.7): the uniform rule is what makes the *design* trustworthy, not a
  case-by-case judgment that this particular call happens to be safe to skip.
- **The captured source range.** A **singleton** — `[sourceFlatIndex, sourceFlatIndex + 1)`, exactly the
  one screen being duplicated, computed from `flatScreens(project)` *before* the new map is appended.
  This is deliberately narrower than whole-map Duplicate's own `sourceFlatRange` (which spans an entire
  source map's worth of screens): only the source *screen* is being promoted, so only a reference to that
  one screen counts as "self" for the clone. A reference on the clone to some *other* screen belonging to
  the same source map — a door on the promoted screen that used to lead to a neighboring room in the same
  dungeon — is **external** under this narrower range, and stays pointing at that other screen in the
  *original* map, unchanged: promoting one room out of a dungeon does not pull the rest of the dungeon
  along with it, so a door that used to lead deeper into the dungeon should keep leading there, not to a
  nonexistent second screen on the new 1×1 map. **Incoming references — anything elsewhere in the project
  that already pointed at the source screen — are left aimed at the original**, for the identical reason
  whole-map Duplicate's own original is never touched: nothing about *this* operation moves or removes
  the source screen, so nothing referencing it has to change.

Assembled, as one `store.commit`, reusing `buildAppendCanonicalizeTranslate` and `rewriteClonedRange` —
the same two shared primitives every other append site in this design already uses, never a second
implementation of either:

```js
function duplicateScreenIntoNewMap(sourceScreen) {
  let outcome;
  store.commit('Duplicate screen', (project) => {
    const beforeFlat = flatScreens(project); // pre-append, whole project
    const sourceFlatIndex = beforeFlat.findIndex((e) => e.screen === sourceScreen);
    const sourceMap = beforeFlat[sourceFlatIndex].map;
    const sourceFlatRange = [sourceFlatIndex, sourceFlatIndex + 1]; // singleton -- this screen only

    const newMap = createMap(project.maps.length, nameForNewMapFromSource(sourceMap, project.maps));
    newMap.tilesetId = sourceMap.tilesetId;
    newMap.songId = sourceMap.songId;
    newMap.battleSkyTile = sourceMap.battleSkyTile;
    newMap.battleGroundTile = sourceMap.battleGroundTile;
    newMap.encounters = structuredClone(sourceMap.encounters);
    newMap.folder = sourceMap.folder; // Fix round 5, finding 1 -- uniform policy, §8's field

    const cloned = structuredClone(sourceScreen);
    cloned.name = nameForDuplicateScreen(sourceScreen.name, newMap.screens); // identity here -- see above
    newMap.screens = [cloned]; // replaces createMap's own blank default screen

    project.maps.push(newMap);

    // Project-wide canonicalizing pass -- reaches the clone's own (still
    // raw) operands too, exactly like every other append site.
    remapScreenReferences(project, buildAppendCanonicalizeTranslate(beforeFlat.length));

    // Self/external split, scoped to the SINGLETON source range above --
    // not the whole source map's range, since only one screen moved.
    const afterFlat = flatScreens(project);
    const newFlatIndex = afterFlat.findIndex((e) => e.screen === cloned);
    rewriteClonedRange([cloned], sourceFlatRange, newFlatIndex - sourceFlatIndex);

    // No saveCompatToken redraw -- append, screenCount already moves, the
    // identical argument every other append site in this design makes.

    outcome = { newMap, cloneScreen: cloned };
  });
  return outcome;
}
```

**Test:** §11 test 27, the reviewer's own every-map-4×4 fixture, calling `duplicateScreenIntoNewMap`
directly as a unit/operation-level test (Fix round 5, finding 2 — corrected from an earlier "real UI
path" framing; §12's own smoke plan is where real UI routing to this operation is actually proven). §11
test 26's own non-qualifying draw census also gains this operation as its tenth fixture.

### §6.3 — Copy/paste of a rectangular region

**Scope: metatiles only by default, entities via the existing actor clipboard, boundTiles included.**
`screenAttributes` (`main/build/generate.js:1230-1252`) is a **pure function** of `screen.metatiles` and
`project.metatiles[].palette` — nothing stores attributes separately, so "metatiles and attributes"
(the brief's framing) collapses to one concern: copying the metatile-id grid *is* copying the
attributes, for free, since they are derived at build (and render) time from whichever ids land in the
destination. There is no separate attribute-copy question to design.

**Entities are not part of the rectangle by default.** This repository already has a working,
precedented clipboard for a single placed actor (`renderer/forges/map/map.js:50-88` — a module-level
`clipboard` variable, outside `mount()`, deliberately outliving any one Forge mount so "copy here, go
check something in another Forge, come back and paste" works; scoped by
`clipboardIsHere() = clipboard.dir === store.dir && rosterOf(store.project) === clipboard.roster`, i.e.
valid only within the same open project, because `actorId` has no meaning across two different
projects' actor lists). A rectangular metatile region gets an **analogous, separate module-level
clipboard** (not a reuse of the same variable — a metatile-region copy and an actor copy are different
shapes and pasting one where the other is expected should not silently coerce), guarded the identical
way: `clipboard.dir === store.dir` (metatile ids, like actor ids, have no portable meaning across two
different open projects — `project.metatiles[5]` in one project can be an entirely different definition
than `project.metatiles[5]` in another). Shape:

```js
{
  dir: store.dir,
  width, height,           // metatiles
  metatiles: number[],     // width*height ids, row-major, relative to the copied rectangle
  boundTiles: [{ row, col, switchId, metatileId }], // relative row/col, only cells inside the rectangle that HAD a binding
  sourceTilesetId: number  // for the cross-tileset warning, §6.2
}
```

**Pasting is destination-rectangle *replace*, not overlay, for `boundTiles` (Fix round 1, finding 8).**
Round 1 specified only what happens when the source has a binding at a cell the destination also binds
(the pasted one wins) but said nothing about a destination cell inside the pasted rectangle that has a
binding the source does *not* — round 1's silence there means such a binding survives the paste,
attached to whatever metatile the paste just overwrote, which is not "this rectangle now looks and
behaves like the copied one," it is a mix of new art and old behavior the author never authored
together. **Decision, the reviewer's own stated default: clear every `boundTiles` entry whose `(row,
col)` falls inside the destination rectangle first, then write the source's own bindings (offset by the
paste origin) on top.** This makes "paste this rectangle" reproduce the source's authored behavior
exactly, including the *absence* of a binding — a cell the source never bound is a cell that ends up
unbound at the destination too, not one that keeps whatever the destination happened to have. Pasting
writes the `metatiles` grid into the destination screen at the chosen origin (clamped so the whole
rectangle stays on-screen — the same clamp shape `normalizeScreen` already applies to
`SCREEN_METATILES`), then applies the clear-then-add rule above, `boundTiles`' switch reference
(`switchId`) left exactly as copied either way — a bound tile's switch reference is a project-wide RPG
switch, identical in meaning wherever the cell lands, no remap needed, the same reason an actor's own
`actorId` is never remapped by `placeCopy` (`map.js:701-722`).

**Entity inclusion is a second, optional step, reusing the existing single-actor clipboard rather than
inventing a second entity-copy mechanism.** Selecting entities inside the rectangle before copying
extends the *existing* `clipboard` variable's shape from one entity to an array (a backward-compatible
widening — `clipboardIsHere()`'s own guard is unaffected), and `placeCopy` (`map.js:701-722`) already
offsets a single pasted entity by one metatile so it doesn't land exactly under its source; a multi-
entity paste offsets the whole group by the same delta the region's own origin moved by (source
rectangle origin → destination rectangle origin), preserving each entity's position *relative to the
copied region* rather than a flat +1 metatile nudge (which would be wrong for a multi-tile paste, since
entities inside the region should move together with it). This is presented as a **second slice within
copy/paste**, not deferred to a different roadmap item — the region-only paste (metatiles/attributes)
is useful and shippable alone; the entity extension is small, additive, and reuses 100% existing
machinery, but is called out separately so a reviewer can accept the first half without gating on the
second.

### §6.4 — Fallback policy and reporting when a reference's target screen is gone (`DROPPED_SCREEN`)

**The fallback value is unchanged from round 1.** There is no `NO_SCREEN` sentinel today (checked:
grepped `shared/project.js` and `engine/constants.asm` for `NO_SCREEN` — absent), and introducing one
is explicitly out of scope: unlike `NO_ACTOR`/`NO_ITEM` (which are nullable by design — Give/Take/a
formation slot already has a defined "names nothing" state, both in schema and in the engine's own
dispatch), a door/warp target has **no engine-side "do nothing" branch** — `entity_door` unconditionally
treats its operand as a real screen to warp to. Adding one would mean new engine dispatch code, which
contradicts the brief's zero-engine-cost requirement (§10). **`FALLBACK_SCREEN(project)` is therefore
defined as "flat index 0"** — the project's own first screen, always in range for any non-empty
project, requiring no engine change and matching the shape of the *already-existing* emit-time clamp
(`generate.js:2586`'s `Math.min(toScreen, flat.length-1)`, which silently redirects an out-of-range
value to the *last* valid screen rather than a defined "safe" one — this design's choice of the *first*
screen instead is deliberate: index 0 is stable across further edits in the same session in a way
"whatever the last index currently is" is not, and is the same screen `startScreen`/`titleScreen`
already default to on their own out-of-range fallback, `normalizeProject:2788-2797`). §6.9's per-map
fallback (for `startScreen`/`titleScreen` when the map's own resize drops the screen they pointed at)
uses the identical reasoning, one level down: per-map position 0 within the *same* map.

**Fix round 1, finding 7 — the reporting mechanism, decided rather than asserted.** Round 1 claimed a
redirected reference is "surfaced as a `validateProject` warning naming the entity/command and its new
target" — the review correctly points out this is impossible as stated: `remapScreenReferences`'
`droppedTargets` is a value returned from a single function call, gone the moment that call returns
unless something captures it; `store.commit`'s own implementation (`renderer/store.js:63-69`) discards
whatever `mutate` returns; and by the time any *later* `validateProject(project)` pass runs, the
post-edit project contains only a plain in-range `toScreen`/`screen` value pointing at flat index 0 —
indistinguishable from an author who authored a door to screen 0 on purpose. There is nothing left in
the schema to reconstruct the warning from. **Decision: two paths, chosen per operation by whether it
already asks for confirmation, and no new schema field ("audit metadata") is added — the brief's own
steer against one is followed.**

- **Delete Map and Resize-shrink** (§6.8/§6.9) already show a `confirmModal` before committing
  (`map.js:1492`'s existing "Delete map" dialog is the precedent). Both are extended to run a **real
  reference audit** first — a pure function call against the *current*, uncommitted project, no mutation
  — and fold the count into the confirmation text: `"Delete "Dungeon" and everything on it? 3 doors/warps
  that lead here from other maps will be redirected to the first screen."` The author sees the
  consequence *before* choosing to proceed, which is the only point in these two operations' own flow
  where showing it is actually useful — after the commit, the moment has passed.

  **Fix round 2, finding 4 — round 1's dry run counted the wrong thing.** `translate` is a function from
  one flat index to one flat index; it has no `droppedTargets` array of its own and does not walk the
  project. Round 1's sketch, `before.filter((_, i) => dryTranslate(i) === DROPPED_SCREEN).length`,
  counts **how many screens the deleted map itself contains** — five deleted, empty screens reports
  "5 doors/warps," and one deleted screen with ten real incoming doors reports "1." Neither number is
  the question the confirmation text asks. The real audit walks every *surviving* entity and event,
  excluding any whose *own* screen is being discarded (a reference leaving with its own screen is not
  "redirected," it is simply gone), and counts each one whose target — canonicalized and translated,
  exactly as `remapScreenReferences` itself would — comes back `DROPPED_SCREEN`:

  ```js
  // Pure, no mutation -- callable as a dry run before any commit exists.
  // discardedScreens is the set of screen objects the operation is about to
  // remove; a reference living ON one of those screens is leaving with it,
  // not being redirected, and is excluded from the count for that reason.
  function auditDroppedReferences(project, translate, discardedScreens) {
    let count = 0;
    const checkScreen = (screen) => {
      if (discardedScreens.has(screen)) return;
      for (const entity of screen.entities ?? []) {
        if (translate(entity.props?.toScreen ?? 0) === DROPPED_SCREEN) count++;
        for (const page of entity.props?.event?.pages ?? []) {
          for (const command of allCommands(page.commands)) {
            if (command.op === 'warp' && translate(command.screen) === DROPPED_SCREEN) count++;
          }
        }
      }
    };
    for (const map of project.maps) for (const screen of map.screens) checkScreen(screen);
    // Common events are never discarded by a screen operation -- always
    // audited, with no screen-ownership exclusion to apply.
    for (const entry of project.commonEvents ?? []) {
      for (const page of entry.event?.pages ?? []) {
        for (const command of allCommands(page.commands)) {
          if (command.op === 'warp' && translate(command.screen) === DROPPED_SCREEN) count++;
        }
      }
    }
    return count;
  }
  ```

  `translate` already canonicalizes its own input (§6.1), so the audit calls it directly on the stored
  value — no separate canonicalization step needed here. For Delete Map, `discardedScreens` is every
  screen belonging to the map about to be removed; for Resize-shrink, it is whichever of the map's own
  old screens `resizeMap`'s row/column-preserving rebuild leaves out of the new arrangement. This is the
  count §6.8/§6.9's dry-run calls now use in place of round 1's screen-count mistake, and §11 test 22
  asserts it directly, decoupled from how many screens the operation removes.
- **Reorder never has anything to preflight** — its `translate` (§6.1.1) is a total bijection and
  `droppedTargets` is always empty by construction (asserted directly, §11 test 5's own sabotage
  target). No confirmation, no toast, nothing to report, ever.
- **Duplicate's canonicalizing pass (§6.2) can, in principle, still redirect a reference** — a
  pre-existing out-of-range value canonicalizes to *something*, never `DROPPED_SCREEN` (append drops
  nothing), so duplicate's own `droppedTargets` is likewise always empty by construction; nothing to
  report there either. Worth stating precisely: duplicate's canonicalization can *change* a stored
  number (correcting garbage), but it can never *drop* one, so it needs no confirmation or toast either.
- **In every case where a real `store.commit()` for Delete/Resize completes with a non-empty
  `droppedTargets`,** the caller captures the result via a closure variable declared *outside* the
  `mutate` callback and assigned *inside* it — `store.commit`'s own body (`renderer/store.js:63-69`)
  calls `mutate(this.project)` synchronously, so by the time `store.commit(...)` returns, the outer
  variable is already populated with no change to `store.js` needed at all:

  ```js
  let result;
  store.commit('Delete map', (project) => {
    const translate = buildDeleteMapTranslate(project, index);
    // ...mutate project.maps, apply §6.8's map-space fixup...
    result = remapScreenReferences(project, translate);
  });
  // result.droppedTargets is now populated; the confirm dialog already told
  // the author the count before this ran, so nothing further is shown here
  // for Delete/Resize -- this capture exists so a future caller (or a test)
  // can inspect exactly what happened, not to duplicate the preflight.
  ```

  No Build-panel `validateProject` claim survives this revision — that claim is retracted outright, not
  softened.

### §6.5 — Reorder's unit is maps, not screens-within-a-map (continues §3 row 10)

The brief's first open question is "what is the operation's unit — reorder maps within the project,
screens within a map, both?" **Decision: maps only.** A screen's position within its own map's
`screens` array is not an arbitrary author-facing order — it is a **grid coordinate**
(`col = index % gridW`, `row = index / gridW`, `main/build/generate.js:1265-1266`), and that
coordinate is what `screen_left`/`right`/`up`/`down` (§3 row 10) bakes into the compiled edge-crossing
tables. "Reordering screens within a map" would therefore not be a benign relabeling the way reordering
maps is — it would silently re-lay-out the map's own internal geography (which room is north of which),
which is not what an author asking to "organize my maps better" wants, and is already a fully separate,
already-shipped concern: `resizeMap` (`map.js:598-619`) is the existing tool for placing screens at grid
positions, and nothing about item 7 asks for a *second* way to move a screen to a different cell. This
design's "reorder" therefore means permuting `project.maps`' own order — which map is first, second,
etc. — never touching any map's internal grid layout. `LIMITS.mapGrid = 4` (max 4×4 = 16 screens/map)
and the existing, unused `screenIndex(map, col, row) = row * map.gridW + col` helper
(`shared/project.js:3977`, confirmed unimported/unused anywhere today) are the inverse of the grid math
`flattenScreens` already performs — available if a future, separate "move this screen to a different
grid cell" feature is ever built, but this design does not use or extend it. **Confirmed correct by
round 1's review** ("Maps-only reorder is the right unit; a screen's per-map position is geography, not
display order") — unchanged in this revision.

### §6.6 — Why `titleMap`/`titleScreen`/`startMap`/`startScreen` barely move under a *maps-only reorder*

**This section covers reorder only.** Delete Map and Resize Map are a genuinely harder case, specified
separately in §6.8/§6.9 — round 1 conflated the two (finding 2), and this revision keeps them apart on
purpose rather than trying to generalize one argument to cover both.

Because reorder never touches a map's own `screens` array (§6.5), and because `titleScreen`/
`startScreen` are stored in **per-map** space (§3 rows 3-4) rather than flat space, **a maps-only
reorder requires zero changes to `titleScreen`/`startScreen`'s stored values** — the map they belong to
still contains the same screen at the same per-map position, wherever that map now sits in
`project.maps`. Only `titleMap`/`startMap` (map-space) need updating, and the update is the map
permutation itself, applied directly — no flat-space translate needed for these two fields at all:

```js
// Inside the same store.commit callback, after project.maps has been reordered
// and remapScreenReferences (flat-space) has already run:
const oldMapIndexOfTitle = project.project.titleMap;
if (oldMapIndexOfTitle !== null) {
  project.project.titleMap = newMapOrder.indexOf(oldMapIndexOfTitle);
}
project.project.startMap = newMapOrder.indexOf(project.project.startMap);
// titleScreen / startScreen: untouched, per the argument above.
```

This is the single cleanest confirmation that the schema's existing index-space separation (flat vs.
map vs. per-map) was already the right shape for this feature — most of the "safety" the brief asks for
falls out of fields simply not needing to move, rather than out of new fixup code. **Delete and resize
do not get this shortcut — a map can genuinely disappear (delete) or a map's own screens can genuinely
change which per-map position holds which content (resize) — which is exactly why §6.8/§6.9 exist as
separate, more involved specifications instead of reusing this section's argument.**

### §6.7 — Reorder Maps, assembled end to end

```js
function reorderMaps(newMapOrder /* array of old map indices, length === project.maps.length */) {
  store.commit('Reorder maps', (project) => {
    const translate = buildReorderTranslate(project, newMapOrder); // §6.1.1, built from the PRE-mutation state
    const oldTitleMap = project.project.titleMap;
    const oldStartMap = project.project.startMap;

    project.maps = newMapOrder.map((oldIndex) => project.maps[oldIndex]);

    remapScreenReferences(project, translate); // §6.1 -- droppedTargets is always [] for a bijection
    project.project.titleMap = oldTitleMap === null ? null : newMapOrder.indexOf(oldTitleMap);
    project.project.startMap = newMapOrder.indexOf(oldStartMap);
    // titleScreen/startScreen untouched -- §6.6.
    project.project.saveCompatToken = drawSaveCompatToken(); // §6.10
  });
}
```

One `store.commit()`, one undo entry, restoring every reference at once on undo (the whole-project
`structuredClone` snapshot `store.undo()` already performs, `renderer/store.js:103-111`, needs no
awareness that a reorder happened — undo already restores the *entire* project object, index remaps
included, for free — and that includes `saveCompatToken`: undoing a reorder correctly restores its
pre-reorder value, since after undo the project's screen layout genuinely matches what it was before
this reorder ran, and any save recorded then is once again valid to resume; see §6.10's own discussion
of why the *next*, different edit after such an undo needs a freshly-drawn value rather than a
deterministic one to stay correct). This directly answers the brief's first open question: the
operation's unit is "reorder the list of maps," expressed as one commit touching `project.maps`' order,
every door/warp operand project-wide, `titleMap`/`startMap`, and the save-compatibility token.

### §6.8 — Delete Map, assembled end to end (the retrofit, Fix round 1 finding 2)

The flat-space translator (§6.1.3) only ever answers "where did this screen go" — it has no opinion
about `startMap`/`titleMap`, which name a *map*, not a screen. Deleting a map requires a second,
independent decision for those two fields, with an explicit fallback when the deleted map *was* the
start or title map — something round 1 never specified at all (the review's own citation:
`map.js:1494-1500` today only range-clamps `startMap`, and never touches `titleMap`).

**The map-space policy, stated absolutely (Fix round 2, finding 6 — round 1's own prose bullets here had
the two ordinary cases exactly reversed; the pseudocode below was always correct, so this text is
corrected to match the pseudocode, not the other way around):**

- If `startMap`/`titleMap`'s referenced index is **`< mapIndex`** (the deleted map's own array
  position), it is **unchanged** — nothing before the deleted position ever shifts in an ordinary array
  splice.
- If `startMap`/`titleMap`'s referenced index is **`> mapIndex`**, it **decrements by 1** — the same
  shift every other array-position reference in this codebase already applies on a delete
  (`renumberActorDeletion`'s own `shift`, `shared/project.js:1264`).
- If `startMap`/`titleMap`'s referenced index is **`=== mapIndex`** (the deleted map *itself*):
  `titleMap` falls back to `null` — a
  titleless project is already a legal, supported state (`createProject`'s own default,
  `shared/project.js:1554`), so removing the map that held the title screen simply removes the title
  screen, the same as an author explicitly clearing it via `titleScreenSelect`'s "None" option
  (`map.js:1226`). `startMap` **cannot** fall back to `null` — every project must have a start position
  — so it falls back to map 0 of the *surviving* array (i.e., whichever map now sits at index 0 after
  the splice), `startScreen` reset to 0 alongside it — the identical fallback shape
  `normalizeProject`'s own existing range clamp already uses today (`shared/project.js:2788-2789`), now
  applied deliberately, inside the same commit, rather than accidentally on the next load.

```js
function deleteMap(mapIndex) {
  let result;
  const dryProject = currentProject();
  const dryTranslate = buildDeleteMapTranslate(dryProject, mapIndex); // dry run for the confirm dialog, no mutation
  const discarded = new Set(
    flatScreens(dryProject).filter((e) => e.mapIndex === mapIndex).map((e) => e.screen)
  );
  const wouldDrop = auditDroppedReferences(dryProject, dryTranslate, discarded); // §6.4's real audit, not a screen count
  // ...confirmModal text includes wouldDrop, per §6.4...
  store.commit('Delete map', (project) => {
    const translate = buildDeleteMapTranslate(project, mapIndex); // §6.1.3, built from PRE-mutation state
    const oldTitleMap = project.project.titleMap;
    const oldStartMap = project.project.startMap;

    project.maps.splice(mapIndex, 1);

    result = remapScreenReferences(project, translate); // §6.1 -- flat-space: doors, warps

    // Map-space, per the policy above.
    project.project.titleMap =
      oldTitleMap === null ? null : oldTitleMap === mapIndex ? null : oldTitleMap > mapIndex ? oldTitleMap - 1 : oldTitleMap;
    project.project.startMap = oldStartMap === mapIndex ? 0 : oldStartMap > mapIndex ? oldStartMap - 1 : oldStartMap;
    if (oldStartMap === mapIndex) project.project.startScreen = 0;
    // titleScreen: only reset if titleMap just became null (nothing to point
    // into); otherwise the title map itself was untouched by this delete
    // (its own screens array is unaffected -- only OTHER maps' positions in
    // project.maps shifted), so titleScreen needs no change at all.
    if (project.project.titleMap === null) project.project.titleScreen = 0;

    project.project.saveCompatToken = drawSaveCompatToken(); // §6.10 -- see below on why this is often redundant with screenCount, and why it is applied anyway
  });
}
```

**Why the token is redrawn here even though `screenCount` (already folded into `saveIdentity`) almost
always changes too on a delete:** `createMap` never produces a zero-screen map (`screens:
[createScreen()]`, `shared/project.js:1118`), so deleting any map removes at least one screen and
`screenCount` strictly decreases — meaning `saveIdentity` already changes on its own, today, for this
specific operation, without needing the token at all. This design redraws it anyway, uniformly across
every structural operation in §6.7/§6.8/§6.9, rather than reasoning case-by-case about which ones are
"already covered" by an existing term: that reasoning is exactly the kind of fragile, easy-to-silently-
break assumption a future change to `screenCount`'s own fold (or to `createMap`'s own invariant) could
quietly invalidate, and the cost of redrawing unconditionally is zero for a project that never performs
any of these operations (§6.10's own property (b)). Duplicate-by-append is one deliberate exception
(§6.2), argued on its own terms: append always strictly grows `screenCount`, already refusing an old
save without the token's help. **Single-screen duplicate via grid growth is not a second exception — see
§6.9.1's own resolution of Fix round 2, finding 2's epoch question.**

**Test matrix (Fix round 1, finding 2's own ask; corrected and completed this revision, Fix round 2,
finding 6 — the map-space relationship now has three cases, not two, and all three are tested):**

- **delete-before**: delete a map at an index **lower** than the start/title map's own referenced index
  (i.e., the referenced index is `> mapIndex` — the deleted map comes *before* it in `project.maps`) →
  `startMap`/`titleMap` **decrements by 1**; `startScreen`/`titleScreen` unchanged (the map they point
  into was never touched, only its own position in `project.maps` shifted down). Round 1's own test plan
  already exercised this direction.
- **delete-after**: delete a map at an index **higher** than the start/title map's own referenced index
  (i.e., the referenced index is `< mapIndex` — the deleted map comes *after* it) → `startMap`/
  `titleMap` **unchanged**; `startScreen`/`titleScreen` unchanged. **New this revision — round 1's test
  plan never exercised this relationship at all**, per the review's own finding: an implementation that
  decrements *every* surviving reference regardless of which side of `mapIndex` it falls on would have
  passed delete-before (where "decrement everything" and "decrement only when referenced `> mapIndex`"
  happen to agree, since delete-before's own fixture has nothing positioned after `mapIndex` to wrongly
  decrement) and only fails here, where the two rules genuinely disagree.
- **delete-target**: delete the actual start/title map (referenced index `=== mapIndex`) → `titleMap` →
  `null`, and `titleScreen` → 0 alongside it; `startMap` → 0 (the surviving array's own first map),
  `startScreen` → 0. A separate, explicit assertion confirms `titleMap === null` **stays** `null` after
  this case (not re-derived, not accidentally reset to some other map) — the review's own third naming
  of what test 18 must cover.
- (The remaining two rows in this matrix's brief-mandated grouping — width-grow relocation,
  shrink-target — are Resize Map's cases, §6.9, not Delete's; grouped together here only because §11's
  test plan treats all five as one combined matrix per the brief's own original framing.)

### §6.9 — Resize Map, assembled end to end (the retrofit, Fix round 1 finding 2)

Resize never removes a map and never changes `startMap`/`titleMap` (the map itself is unaffected — only
its own `screens` array changes shape). What it *can* change is **which per-map position** holds the
content `startScreen`/`titleScreen` name, when the map being resized is the start or title map — the
reviewer's own worked example: a 2×2 map `[a,b,c,d]` resized to 3×2 (`resizeMap`'s existing row/column-
preserving rebuild, `map.js:598-612`) produces `[a,b,new,c,d,new]`; a start/title on `c` (old per-map
index 2) must become 3, not stay 2 (which is now `new`, a blank cell).

**The per-map object-identity diff — the same idea as §6.1's flat-space diff, one level down, applied
to a single map's own `screens` array instead of the whole project's flat list:**

```js
function buildPerMapTranslate(oldScreens, newScreens) {
  const newIndexOf = new Map(newScreens.map((screen, i) => [screen, i]));
  return (oldPerMapIndex) => {
    const screen = oldScreens[oldPerMapIndex];
    if (!screen) return DROPPED_SCREEN; // an out-of-range stored value (hand-edited or pre-existing garbage)
    const next = newIndexOf.get(screen);
    return next === undefined ? DROPPED_SCREEN : next; // a shrink dropped this screen
  };
}
```

**Fix round 2, finding 2 — this section now also owns a commit-free core, `growOrShrinkMap`, extracted
so §6.2's single-screen-duplicate-via-growth can share it inside its own, single `store.commit` rather
than nesting a second commit or duplicating this logic.** Round 1's `resizeMap` owned its own
`store.commit` outright, which the review correctly names as the reason "screen duplicate inherits
Resize's bump" could only ever be a hand-wave: nothing composed the two operations into one atomic edit.
The refactor: everything `resizeMap`'s `store.commit` callback used to do — build `newScreens`, compute
both translates, mutate the map, run the project-wide remap, apply the per-map start/title fixup, draw a
fresh token — moves into a plain function taking `project` as an argument and mutating it in place,
**with no `store.commit` of its own**:

```js
/**
 * The commit-free core of Resize Map. Every caller wraps this in exactly
 * one store.commit -- this function does not, so a caller that needs to do
 * more inside the same atomic edit (§6.2's single-screen duplicate via
 * growth) can. Returns enough state for such a caller to build on: the
 * screens array before and after, and a full flatScreens() snapshot from
 * both moments, needed to build a dedicated clone translation (below).
 */
function growOrShrinkMap(project, mapIndex, newWidth, newHeight) {
  const map = project.maps[mapIndex];
  const oldScreens = map.screens;
  const flatBefore = flatScreens(project); // captured before any mutation below

  const newScreens = [];
  for (let row = 0; row < newHeight; row++) {
    for (let col = 0; col < newWidth; col++) {
      newScreens.push(row < map.gridH && col < map.gridW ? oldScreens[row * map.gridW + col] : createScreen());
    }
  }

  const flatTranslate = buildResizeTranslate(project, mapIndex, newScreens); // §6.1.4, from flatBefore
  const perMapTranslate = buildPerMapTranslate(oldScreens, newScreens);

  const wasStartHere = project.project.startMap === mapIndex;
  const wasTitleHere = project.project.titleMap === mapIndex;
  const oldStartScreen = project.project.startScreen;
  const oldTitleScreen = project.project.titleScreen;

  map.gridW = newWidth;
  map.gridH = newHeight;
  map.screens = newScreens;

  const result = remapScreenReferences(project, flatTranslate); // doors, warps, project-wide

  if (wasStartHere) {
    const next = perMapTranslate(oldStartScreen);
    project.project.startScreen = next === DROPPED_SCREEN ? 0 : next; // §6.4's per-map fallback
  }
  if (wasTitleHere) {
    const next = perMapTranslate(oldTitleScreen);
    project.project.titleScreen = next === DROPPED_SCREEN ? 0 : next;
  }
  // startMap/titleMap themselves: never touched by a resize -- the map
  // itself still exists, at the same array position, per the opening
  // paragraph above.

  project.project.saveCompatToken = drawSaveCompatToken(); // §6.10 -- unconditional; every caller inherits this

  const flatAfter = flatScreens(project); // AFTER mutation + remap -- every screen's real final position
  return { oldScreens, newScreens, flatBefore, flatAfter, result };
}
```

`resizeMap`, the ordinary UI entry point, is now a thin wrapper — one `store.commit`, nothing else:

```js
function resizeMap(mapIndex, newWidth, newHeight) {
  let outcome;
  store.commit('Resize map', (project) => {
    outcome = growOrShrinkMap(project, mapIndex, newWidth, newHeight);
  });
  return outcome.result;
}
```

**The dry-run confirmation for a shrink (Fix round 2, finding 4) — Resize had none at all in round 1;
this revision gives it the identical real audit Delete Map now uses (§6.4/§6.8), not a screen count:**

```js
function confirmResizeIfShrinking(mapIndex, newWidth, newHeight) {
  const dryProject = currentProject();
  const map = dryProject.maps[mapIndex];
  if (newWidth * newHeight >= map.gridW * map.gridH) return true; // growing or same size -- nothing ever drops
  const oldScreens = map.screens;
  const newScreens = []; // the identical rebuild growOrShrinkMap performs, run here read-only
  for (let row = 0; row < newHeight; row++) {
    for (let col = 0; col < newWidth; col++) {
      newScreens.push(row < map.gridH && col < map.gridW ? oldScreens[row * map.gridW + col] : createScreen());
    }
  }
  const dryTranslate = buildResizeTranslate(dryProject, mapIndex, newScreens);
  const discarded = new Set(oldScreens.filter((s) => !newScreens.includes(s)));
  const wouldDrop = auditDroppedReferences(dryProject, dryTranslate, discarded);
  // ...confirmModal text includes wouldDrop, per §6.4, only when it is nonzero...
  return confirmModal(/* ... */);
}
```

#### §6.9.1 — Duplicate-screen-via-growth, assembled (§6.2's own single-screen-growth case, rebuilt this revision — Fix round 2, finding 2)

The reviewer's own 2×2→3×2 trace is exact, and this is the fix: **the clone's own operands are never
run through `growOrShrinkMap`'s generic `flatTranslate` at all.** They are inserted *after*
`growOrShrinkMap` has already returned — the blank cell it creates is genuinely empty (`createScreen()`,
zero entities) at the moment the generic walk runs over it, so there is nothing on it for that walk to
touch or mistranslate; the clone's real content only exists once the caller writes it in, strictly
afterward. **This is the "insert it after the walk" branch of the brief's own choice, not "exclude the
inserted clone from the walk"** — chosen because it needs no change to `remapScreenReferences`'s
signature or behavior at all (it stays the same generic, dumb walker every other operation in this
design already shares), where exclusion would have required threading a skip-set through the one shared
primitive for the sake of a single caller.

A dedicated translate, built from the *semantic old-target identity* the brief specifies, not from
`growOrShrinkMap`'s own generic one:

```js
/**
 * flatBefore/flatAfter: growOrShrinkMap's own returned snapshots -- before
 * any mutation, and after the resize's mutation + generic remap have both
 * already run, but BEFORE the clone's own content has been written into
 * cloneScreen (so flatAfter already correctly maps every OTHER screen,
 * sourceScreen included, to its final position). sourceScreen: the screen
 * being duplicated. cloneScreen: the blank cell the resize just created,
 * about to receive the clone's content.
 */
function buildCloneTranslate(flatBefore, sourceScreen, flatAfter, cloneScreen) {
  const afterIndexOf = new Map(flatAfter.map((entry, i) => [entry.screen, i]));
  const cloneNewFlat = afterIndexOf.get(cloneScreen);
  return (oldFlatOnSource) => {
    // oldFlatOnSource is the RAW, still-original operand structuredClone
    // copied verbatim from the source -- canonicalize against the PRE-resize
    // flat order, the order it was actually authored against.
    const canonical = canonicalizeFlat(oldFlatOnSource, flatBefore.length);
    const targetScreen = flatBefore[canonical]?.screen;
    if (targetScreen === sourceScreen) return cloneNewFlat; // self -- route to the clone itself
    return afterIndexOf.get(targetScreen); // external -- wherever the resize's own remap already put it
  };
}

function applyCloneTranslate(cloneScreen, translate) {
  for (const entity of cloneScreen.entities ?? []) {
    entity.props.toScreen = translate(entity.props?.toScreen ?? 0);
    for (const page of entity.props?.event?.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op === 'warp') command.screen = translate(command.screen);
      }
    }
  }
}
```

Traced against the reviewer's own worked example: source `c` at old flat index 2, resize to
`[a,b,NEW,c,d,NEW2]`. `flatBefore[2]` is `c`; `flatAfter` places `c` at 3 and `NEW` (the blank cell,
about to become the clone) at 2. A self-door on `c` (raw stored value `2`, copied verbatim onto the
clone by `structuredClone`) canonicalizes to `2`, resolves `flatBefore[2]` to `c` itself, and — because
`targetScreen === sourceScreen` — routes to `cloneNewFlat` (`2`, the clone's *own* new position), not to
`3` (where the *original* `c` ended up). The original `c`'s own self-door, untouched by this function at
all, was already correctly rewritten to `3` by `growOrShrinkMap`'s ordinary generic walk, exactly as
every other pre-existing reference in the project is. An external door on `c` (say, targeting screen `e`
on a different map) canonicalizes and resolves to `e`, which is not `sourceScreen`, so it routes through
`afterIndexOf.get(e)` — wherever the resize's own remap placed `e`, correctly external in both builds.

Assembled, as one `store.commit`:

```js
function duplicateScreenViaGrowth(mapIndex, sourceScreen) {
  let outcome;
  store.commit('Duplicate screen', (project) => {
    const map = project.maps[mapIndex];

    // Cloned BEFORE growOrShrinkMap runs -- corrected, phase 4 implementation
    // fix (§15's own changelog entry). growOrShrinkMap's own generic remap
    // walks the WHOLE project, sourceScreen's own live entities included
    // whenever sourceScreen belongs to the map being resized -- it correctly
    // rewrites them in place for the ORIGINAL, but cloning AFTER that walk
    // would silently copy the already-translated values instead of the raw,
    // pre-resize ones buildCloneTranslate is built to interpret via
    // flatBefore, corrupting exactly the self-reference case this mechanism
    // exists to get right.
    const cloned = structuredClone(sourceScreen);

    const { newWidth, newHeight } = growthTarget(map); // grid grows by one row or column, §6.2's own rule
    const { oldScreens, newScreens, flatBefore, flatAfter } = growOrShrinkMap(project, mapIndex, newWidth, newHeight);
    // The blank cell growth introduced: present in newScreens, absent from
    // oldScreens -- the first one in row-major order.
    const cloneScreen = newScreens.find((s) => !oldScreens.includes(s));

    // Overwrite the blank cell's OWN fields in place -- preserves its object
    // identity, so flatAfter's already-computed position for it stays valid.
    cloneScreen.metatiles = cloned.metatiles;
    cloneScreen.entities = cloned.entities;
    cloneScreen.boundTiles = cloned.boundTiles;
    cloneScreen.name = nameForDuplicateScreen(sourceScreen.name, map.screens);

    const cloneTranslate = buildCloneTranslate(flatBefore, sourceScreen, flatAfter, cloneScreen);
    applyCloneTranslate(cloneScreen, cloneTranslate);

    outcome = { cloneScreen };
  });
  return outcome;
}
```

**The epoch/token contradiction the review names — resolved, not left as a hand-wave.** Because
`duplicateScreenViaGrowth` calls `growOrShrinkMap` as a genuine sub-step of its own single commit, and
`growOrShrinkMap` unconditionally draws a fresh `saveCompatToken` (§6.10) every time it runs, single-
screen duplicate via growth **does** redraw the token — automatically, mechanically, as a direct
consequence of which underlying primitive it routes through, not as a separately-asserted policy that
could drift from the code. This is deliberately **not** the same answer whole-map duplicate and
new-map duplicate give (§6.2's own "deliberately not bumped" argument, unchanged): those two route
through an *append*, never through `growOrShrinkMap`, so they never draw a fresh token, and
`screenCount`'s own strict increase already covers them. **The rule, stated once, for every duplicate
path:** *append never redraws the token (screenCount already covers it); grow always does (it is,
mechanically, a resize)* — not "duplicate never bumps," which was never true of every path and is
retracted as a blanket claim.

**Test matrix, the remaining two cases from §6.8's list, for both start and title, plus the forced
width-grow duplicate fixture the review names directly:**

- **width-grow relocation**: the reviewer's own `[a,b,c,d]` → `[a,b,new,c,d,new]` example, start/title
  on `c` (old per-map index 2) → `startScreen`/`titleScreen` becomes 3 (the per-map object-identity diff
  finds `c` at its new position).
- **shrink-target**: the map is shrunk such that the screen holding start/title is one of the ones
  `resizeMap`'s own rebuild drops → `startScreen`/`titleScreen` → 0 (per-map fallback, §6.4's reasoning
  one level down: per-map position 0 is stable and already what every other out-of-range per-map fallback
  in this schema uses).
- **Forced width-grow duplicate (new — Fix round 2, finding 2's own explicit fixture demand, §11 test
  23):** the source screen deliberately placed on **row 1** of a 2×2 map (per-map index 2 or 3, not 0 or
  1), so the growth this fixture forces is guaranteed to relocate it — a row-only-growth case where every
  index happens not to move (the defect the review names would hide behind exactly that coincidence) is
  not sufficient. The source carries a self-door, an external door, and nested top-level/branch/choice
  Warps of both kinds. See §11 test 23 for the full assertion list.

### §6.10 — Save-compatibility token (Fix round 1, finding 1; rebuilt this revision, Fix round 2, finding 1)

**The problem, restated precisely from §3 row 17:** `saveIdentity()` (`shared/save.js:207-247`) folds in
`screenCount` and `mapCount` — the *counts* the fold loop reads at lines 229-241 — never the *order* of
`project.maps`. A reorder that changes neither count (the common case — any permutation) therefore
leaves `saveIdentity`'s four-byte output completely unchanged, so `save_check_valid`'s marker, identity,
checksum, and range gates (`engine/save.asm:264-302`) all still pass on a save recorded before the
reorder, and `continue_game` (`engine/save.asm:540-549`) restores the stored `flat_screen` byte and
draws whatever now occupies that flat position — not necessarily, after a correct reorder, the room the
player actually saved in.

**Fix round 2, finding 1 — round 1's monotonic counter is not unique across an undo branch, and the
review's counterexample is exact.** Round 1 argued a counter value could only ever correspond to one
layout in a project's history because "the epoch [is never] reset... which it is not." That is false:
`store.undo()`'s whole-project `structuredClone` restore (§13) resets *every* field to its pre-commit
value, `saveCompatToken` included, by construction — the same mechanism this design relies on everywhere
else to make undo "just work" is exactly what breaks a plain counter here. Concretely: start at
`[A,B,C]`, token 0. Reorder to `[B,A,C]`, token → 1 (round 1's `+= 1`); save a cartridge game on B.
Undo: `[A,B,C]` restored, token back to 0. A *different* reorder, to `[C,A,B]`: token → 1 again — the
identical value the first reorder produced, on a layout with the same `screenCount`/`mapCount`/every
other `saveIdentity` term. `saveIdentity` emits the same four bytes both times, `save_check_valid`
accepts the old cartridge record, and Continue restores B's saved position onto whatever now occupies
that flat number in `[C,A,B]` — exactly the stale-Continue failure this whole mechanism exists to
prevent, reachable the moment an author undoes and redoes differently, which `renderer/store.js`'s own
undo stack (`UNDO_LIMIT = 100`) makes an entirely ordinary editing action, not an edge case. A second,
independent problem compounds it: the real fold loop masks every value to 16 bits before folding
(`hashLo = (hashLo * 33) ^ (value & 0xffff)`, `shared/save.js:228-247`), so a counter is not even unique
against *itself* past 65536 edits — token 1 and token 65537 contribute the identical `& 0xffff` term,
and `Number.isInteger(...) && >= 0` (round 1's own normalize clamp) enforces no upper bound at all.

**The mechanism, rebuilt: an independently-redrawn 16-bit nonce, redrawn — not incremented — on every
qualifying edit, explicitly pinned to the fold's real 16-bit width.** "Independently redrawn" is the
precise claim, not "non-reused" — §6.10's own collision-probability discussion below states plainly
that two draws *can* coincide, at `1/65535`; nothing about this mechanism prevents reuse, only makes it
unlikely rather than the deterministic certainty round 1's counter had on an undo-then-different-edit
branch.

- **Why a token, not a layout-derived fingerprint.** The brief invites weighing a fingerprint that
  "naturally reverts with the layout" instead of a nonce that does not. A fingerprint with that property
  would have to be a pure function of the project's own current screen *order* alone — computed fresh at
  build time, the way `screenCount`/`mapCount` already are, needing no stored field and no undo
  interaction at all. The obstacle is real and structural, not incidental: without a stable per-screen
  identity — which §5 declines to add, for reasons unrelated to this problem — there is no way to tell
  "map B is now first" apart from "map C is now first" except by hashing each screen's own *content*
  (its metatiles, its name, its entities). Doing that has two failure modes of its own, either of which
  is worse than the one being fixed: (1) it would fold in a screen's *content*, so an ordinary metatile
  edit that changes nothing about layout would also change the fingerprint, refusing saves for edits that
  never touched `flat_screen`'s meaning at all — a new false-refusal class this design does not otherwise
  have anywhere; (2) it is expensive to compute at every build (hashing every screen's own metatile
  array, project-wide) for a value `saveIdentity` currently computes from eleven small numbers. A
  content-blind, order-only fingerprint (say, a hash of `project.maps.map(m => m.screens.length)`, the
  per-map screen *counts* in their current array order) comes closer but still fails on the review's own
  counterexample shape whenever two maps happen to have equal screen counts: `[A(1),B(1),C(1)]` and
  `[C(1),A(1),B(1)]` hash identically under that scheme despite being different, real layouts — the
  exact ambiguity a persistent id would resolve and a renumbering scheme structurally cannot. **This
  design agrees with the review's own framing: a layout-derived fingerprint that both reverts correctly
  under undo and distinguishes every layout `saveIdentity`'s other terms do not already distinguish is
  not achievable without the per-screen identity §5 declines — so this design takes the nonce.**
- **Schema — unchanged in shape from round 1, only in how its value is produced.**
  `project.project.saveCompatToken: number`, a plain integer in `[0, 0xFFFF]`. `createProject`'s default
  project object gains `saveCompatToken: 0`. `normalizeProject` gains:

  ```js
  saveCompatToken: Number.isInteger(raw.project?.saveCompatToken) &&
    raw.project.saveCompatToken >= 0 && raw.project.saveCompatToken <= 0xffff
    ? raw.project.saveCompatToken
    : 0,
  ```

  **The upper bound is new this revision and closes the width hole directly** — clamping to `0xFFFF`
  (matching `shared/save.js`'s own fold width, `value & 0xffff`, exactly, so the value this field can
  ever hold and the width the fold can ever distinguish are pinned to the same number in one place)
  means every legal stored value is already unique with respect to the fold's own masking; there is no
  larger value for a future edit to alias against.
- **Who redraws it, and how — `+= 1` is gone.** On every qualifying structural edit — Reorder (§6.7),
  Delete Map (§6.8), Resize Map (§6.9), and (§6.2) single-screen duplicate specifically when it routes
  through Resize's own grow helper — the same `store.commit` callback that performs the edit **redraws
  a fresh, independent random value**, replacing whatever `saveCompatToken` held before, never adding to
  it:

  ```js
  // Uniform in [1, 0xFFFF] -- never 0, which is reserved to mean "no
  // qualifying edit has ever happened" (the conditional-fold trick below).
  // A fresh call on every qualifying edit, independent of the field's own
  // previous value -- this is a REPLACEMENT, not an increment, which is
  // exactly what makes an undo-then-different-edit branch land on a
  // different value than the branch that was undone, almost always.
  function drawSaveCompatToken() {
    return 1 + Math.floor(Math.random() * 0xffff);
  }
  ```

  `Math.random()` is sufficient — this is a collision-avoidance token, not a security credential, and
  needs no cryptographic guarantee, only a wide, roughly uniform range. **Build reproducibility is
  unaffected**: `saveCompatToken` is drawn once, at edit time, and persisted into `project.json` like any
  other field; rebuilding the *same*, unedited project any number of times reads the same stored value
  and produces the same `saveIdentity` output every time — nothing about this design re-draws the token
  at build time, only at the moment of the qualifying edit itself.
- **The collision probability, stated rather than hidden behind determinism the mechanism no longer
  has — and, per Fix round 3's own finding 7, not overstated as comparable to a different risk this file
  already accepts.** Two qualifying edits within one project's history — an undo-then-different-reorder
  branch, most concretely — draw two independent values uniform in `[1, 0xFFFF]` (65535 possible
  values); they collide with probability exactly `1/65535 ≈ 0.0000153`, about 1 in 65 thousand. This is
  not zero, and is not claimed to be. `saveIdentity`'s own docstring (`shared/save.js:189-206`) already
  states its 32-bit djb2-style fold "makes a collision between two differently-shaped projects unlikely;
  it cannot make one impossible" — the whole mechanism has never promised determinism, only a cheap
  check that makes misapplication unlikely, backstopped by `save_check_valid`'s own range checks for
  anything the identity happens to miss (`shared/save.js:189-206`'s own closing argument, which this
  design does not disturb). **Both risks are probabilistic, not "the same order of magnitude"** — a
  32-bit space is `2^16` (65,536) times larger than the 16-bit token's own `[1, 0xFFFF]` range, so a
  per-pair 32-bit collision is correspondingly far less likely than this field's own `1/65535`; the
  honest claim is that this design accepts a *second*, independently-sized probabilistic risk alongside
  the one `saveIdentity` already carries, not that the two happen to land at comparable odds. What makes
  the new risk acceptable is not its size relative to the old one, but what it replaces: round 1's own
  mechanism was not probabilistic at all in the failure the review found — it was a **deterministic**
  collision, certain to occur on exactly the undo-then-different-edit shape and reachable by any author
  who undoes a reorder and reorders differently, an ordinary editing action. Trading a certain failure on
  a common path for a `1/65535` failure on an uncommon one (undo followed by a *different* structural
  edit *and* a save made in the interval that specifically straddles both) is the honest tradeoff this
  design makes, not a weaker guarantee dressed as a stronger one, and not one dressed as smaller than it
  is either.
- **The fold, `shared/save.js`'s `saveIdentity()` — the conditional-push shape is unchanged from round 1,
  because it is orthogonal to counter-vs-nonce and was never the defect the review found:**

  ```js
  const saveCompatToken = project?.project?.saveCompatToken ?? 0;
  const values = [
    RPG_LIMITS.variables, RPG_LIMITS.party, MAX_ITEMS, screenCount, mapCount,
    actorCount, maxLevel, partyCount, battleEnabled, itemsEnabled, itemCount
  ];
  if (saveCompatToken) values.push(saveCompatToken); // ONLY when nonzero
  for (const value of values) { /* unchanged djb2-style fold, value & 0xffff each step */ }
  ```

  A project that has never performed a qualifying edit keeps `saveCompatToken === 0` forever and folds
  the identical eleven-term sequence `saveIdentity` already computes today — byte-identical, satisfying
  property (b) unchanged from round 1's own argument.
- **Undo.** Still automatic (§13) — `store.undo()`'s whole-project restore reverts `saveCompatToken`
  along with everything else, with no special-casing. What changes this revision is *why that is now
  correct rather than the source of the bug*: undoing a reorder genuinely restores the pre-reorder
  layout, so a save from that point validly resuming again is the right outcome — that argument survives
  unchanged. What round 1 got wrong was the *next* edit after an undo, not the undo itself: a fresh,
  independently-drawn token on that next edit (rather than a deterministic `+= 1` from the just-restored
  value) is what makes the undo-then-different-edit branch land on a *different* token with overwhelming
  probability, closing the gap without changing anything about the undo step itself.
- **The reorder-then-inverse-reorder consequence, stated as the brief demands rather than left implicit.**
  Reordering and then applying the exact inverse permutation restores `project.maps` to its original
  order — but each of the two reorders is its own qualifying edit, so each draws its own fresh token.
  Two independent draws from `[1, 0xFFFF]` differ with probability `65534/65535` — for all practical
  purposes, certainly — so a save-enabled project's `saveCompatToken` (and therefore its
  `SAVE_IDENTITY_0..3`) genuinely differs before the round trip and after it, even though the *map order*
  is byte-identical. **This is an accepted, conservative, and now explicitly decided policy, not an
  oversight**: a round-trip reorder is indistinguishable, from inside this mechanism, from "two edits
  happened," and refusing an old save after two edits it did not know about is the safe direction to be
  wrong in — the alternative (recognizing a round trip as a no-op and restoring the original token) would
  require comparing the *current* layout against some *prior* one, which is exactly the content-derived
  fingerprint already argued above to be unachievable without per-screen identity. §7 item 3 and §11 test
  8 are corrected to state this precisely: the inverse-permutation *ROM* byte-identity claim is scoped to
  a **save-free** fixture (where `saveCompatToken`'s value never reaches a compiled byte at all, since
  `SAVE_ENABLED` gates whether `save.asm`'s routines — the only code that ever reads `SAVE_IDENTITY_0..3`
  as an instruction operand — assemble into the ROM in the first place), which keeps a real, honest,
  byte-identical claim rather than a false one.
- **Relationship to `SAVE_LAYOUT_VERSION` (`shared/save.js:56`) — unchanged from round 1.**
  `SAVE_LAYOUT_VERSION` separates one *engine version* from another; `saveCompatToken` separates two
  builds of the *same* project whose screen layouts have diverged. Neither substitutes for the other.
- **Zero engine cost — unchanged from round 1.** `saveIdentity(project)` is called only at build time
  (`main/build/generate.js:1885`), baked into four already-existing constants, `SAVE_IDENTITY_0..3`
  (`generate.js:2264-2267`). `engine/save.asm`'s `save_check_valid` (lines 264-282) is completely
  unchanged — it already compares exactly these four bytes, whatever produced them.

**Tests:** §11 test 20 (widened, unchanged in shape) plus new test 21 — the reviewer's own
undo-then-different-reorder cartridge scenario, run against the real engine, not just asserted at the
`saveIdentity()` level. See §11.

## §7. The no-stale-reference test, and whether "byte-identical" is even the right claim

The brief asks this to be reasoned out, not assumed. **It is not the right claim, and here is why,
worked from the actual compiled output:**

Routes (`design-routes.md` §6) proved *byte-identical* ROMs because a route is defined to compile to
*exactly* the same bytes, in the same position, as its hand-chained equivalent — nothing about the
authored content changes, only how it's expressed. Reorder is the opposite kind of change: it is
**supposed** to change the compiled screen tables' order. `screen_map`/`screen_tileset`/`screen_left`/
`right`/`up`/`down` (§3 rows 8-10) are all keyed by flat index and rebuilt fresh every build in
whatever order `project.maps` currently has — after a reorder, these tables *will* differ from before,
by design, and bank packing (`assignScreenBanks`, sequential over `flat` order, per the generate.js
research) will very likely place different screens in different PRG banks too. Asserting byte-identity
between a project and its reordered self would therefore be asserting something false, or at best
something so fragile (dependent on exactly which screens happen to still land in the same relative
bank positions) that it isn't a meaningful correctness claim.

**Fix round 1, finding 5 — round 1's proposed replacement (a multiset of raw compiled per-screen byte
blocks) is itself false, and is retracted, not patched.** A compiled screen's own entity-list block
(`emitScreens`'s `bytes` array, `main/build/generate.js:2572-2601`) contains **both** the door-target
byte (`target`, line 2583-2586, which a correct reorder is required to change when the door's
*destination* moved) **and** the placement-event slot (`text.eventFor.get(entity)`, line 2594) — and
that slot number is assigned by `compileText`'s own placement loop iterating `project.maps` in flat
order (`textcompile.js:511-535`, `eventFor.set(entity, events.length)`), so it too can change for an
entity whose *own* screen never moved, purely because some earlier map/screen in the new flat order now
contributes a different number of preceding events. A trivial two-screen swap where screen A has a door
to screen B changes A's compiled entity-list byte from "target 1" to "target 0" — the pre/post byte
blocks for screen A **cannot** be equal, multiset or otherwise, under a *correct* reorder. Worse, as the
review states directly: an implementation that reorders `project.maps` but performs **no** door/warp
remap at all leaves that byte completely unchanged, and is *more* likely to pass round 1's proposed
test than a correct one — the multiset comparison rewards the bug this design exists to prevent.
`screenRecordBytes` (`generate.js:1317`, private, no `export`) was also never a usable foundation for
locating these blocks in a test without a new export or a duplicated offset calculation, which round 1
never named.

**The claim that is actually provable, and is the one this design's tests assert, has three parts —
two kept from round 1 (with (2) replaced) and one new:**

1. **Content-preservation (unit-level, the primary "no stale reference" test, unchanged from round 1).**
   For every reference kind in §3's inventory, build a fixture project exercising every kind at once (a
   self-referential door within a map, a door pointing at a different map, a warp inside a branch, a
   warp inside a choice option, `titleMap`/`titleScreen` set, `startMap`/`startScreen` set), record —
   *before* the reorder — which screen's *content* (its `.name`, or, for an unnamed screen, its object
   identity, since the fixture controls this directly) each reference points at, apply `reorderMaps`,
   then re-walk the identical set of references (`allCommands` for warps, every entity for doors, the
   two title/start pairs) and assert each one, looked up in the *new* `flatScreens(project)`/
   `project.maps` arrangement, still names the same screen content as before. This needs no ROM build at
   all — it is pure project-JSON surgery, the fastest and most direct form of the brief's own demand.
2. **A real semantic decoder (integration-level, REPLACING round 1's own semantic-normal-form sketch,
   which the round-2 review found was not one — Fix round 2, finding 3).** Round 1's version compared
   `eventsBefore[slot]`/`eventsAfter[slot]` for raw byte-equality, which is false for exactly the events
   that matter most: a Warp's operand is the destination's *flat number*, which a correct reorder is
   required to change, and a Say/Choice-option's string id is assigned by `internString`'s dedup-on-
   first-encounter order (`textcompile.js:511-535` walks placements in `project.maps`/`screens` order),
   so identical dialogue can land on a different id purely because some earlier map/screen in the new
   flat order now interns its strings first. Round 1's own test dodged this by picking a placement whose
   event happened to contain neither a Warp nor a Say — a real "compiler agreement" implementation that
   never decoded either would still have passed.

   **Fix round 3, finding 1 — round 2's own decoder was itself wrong against the real wire format, on
   two independent counts, and is rebuilt here against `encodeCommand`'s actual cases (`main/build/
   textcompile.js`), not the authored `EVENT_COMMANDS.args` table.** (a) Choice's real framing
   (`textcompile.js:438-452`) stores `recordLength = body.length + 2` as the record's own length byte,
   then emits `[recordLength, ...body, OP_JUMP, past]` — a **record** of `1 + recordLength` bytes whose
   **body** is `recordLength - 2` bytes, not `recordLength` bytes. Round 2's decoder passed the full
   `recordLength` to `decodeBody`, which tries to decode the trailing `OP_JUMP` (`0xFE`) itself as
   `EVENT_COMMANDS[254]` and then advances the cursor by `len + 2` a *second* time past a length already
   counted once — round 2's own test 7 fixture, the one place this design actually authors a Choice,
   would have failed on a correctly-compiling project before any semantic comparison ever ran. (b) The
   "generic width" rule (`1 + entry.args.length`) is not the wire format for every opcode: `sting` and
   `sfx` each declare one authored metadata arg (the song/sfx id) but the compiler always appends a
   second, *computed* duration byte the authored schema never counts (`textcompile.js:356-376`,
   `[OP_STING, index, duration]`/`[OP_SFX, index, duration]`, 3 bytes each, not 2); `battle` declares one
   `monsters` arg but the compiler pads to a **fixed**, schema-independent `RPG_LIMITS.monstersPerBattle`
   actor-id bytes regardless of how many were authored (`textcompile.js:378-391`,
   `[OP_BATTLE, ...4 ids]` on this project's own `RPG_LIMITS`, 5 bytes, not 2). A decoder built on the
   authored-args table desynchronizes silently on any project whose corpus does not happen to include
   one of these three opcodes followed by something distinctively-shaped enough to expose the drift —
   exactly the "untested suffix" the review names.

   **The corrected decoder decodes the actual compiled bytes, opcode by opcode, against every real case
   in `encodeCommand`'s own switch — walked exhaustively below, not sampled — with an explicit width
   table for the exceptions, hard failure on anything not a real, live, decodable opcode, and exact
   consumption asserted at every body, page, and the final terminator:**

   | op | wire bytes | width | source |
   |---|---|---|---|
   | `say` | `[op, stringId]` | 2 | generic (`1+1`) |
   | `warp` | `[op, screen, x, y]` | 4 | generic (`1+3`) |
   | `give`/`take` | `[op, itemByte]` | 2 | generic (`1+1`) |
   | `setSwitch`/`clearSwitch` | `[op, switch]` | 2 | generic (`1+1`) |
   | `setVar`/`addVar`/`subVar` | `[op, variable, value]` | 3 | generic (`1+2`) |
   | `heal`/`damage` | `[op, value]` | 2 | generic (`1+1`) |
   | `save`/`flash` | `[op]` | 1 | generic (`1+0`) |
   | `move` | `[op, who, dir, dist]` | 4 | generic (`1+3`) |
   | `turn` | `[op, who, dir]` | 3 | generic (`1+2`) |
   | `wait`/`shake` | `[op, frames]` | 2 | generic (`1+1`) |
   | `visible` | `[op, state]` | 2 | generic (`1+1`) |
   | `fade` | `[op, dir]` | 2 | generic (`1+1`) |
   | `join` | `[op, member]` | 2 | generic (`1+1`) |
   | `call` | `[OP_CALL, slot]` | 2 | generic (`1+1`) — value not screen/string-relocatable |
   | `music` | `[OP_MUSIC, songByte]` | 2 | generic (`1+1`) |
   | `sting` | `[OP_STING, index, duration]` | **3** | **exceptional** — `textcompile.js:356-368`, duration is compiler-computed, not authored |
   | `sfx` | `[OP_SFX, index, duration]` | **3** | **exceptional** — `textcompile.js:370-376`, same shape |
   | `battle` | `[OP_BATTLE, ...monsters]` | **`1 + RPG_LIMITS.monstersPerBattle`** | **exceptional** — `textcompile.js:378-391`, fixed-width padded array, not `1+1` |
   | `branch` | `[OP_IF, cond×3, thenLen, …then…, OP_JUMP, elseLen, …else…]` | `5 + thenLen + 2 + elseLen` | **exceptional/framed** — own recursive decode |
   | `choice` | `[OP_CHOICE, count, …ids…, per-option [recordLength, …body(recordLength-2)…, OP_JUMP, past]]` | `2 + count + Σ(1 + recordLength)` | **exceptional/framed** — own recursive decode; `past` is *validated*, not merely consumed (Fix round 4, finding 2) |
   | `route` | *(none — see below)* | 0 (contributes no opcode) | its legs compile and decode as ordinary `move`/`turn`/`wait` entries |

   ```js
   // Test-only decoder -- lives beside the test, never exported from
   // main/build/. EXCEPTIONAL_WIDTHS names every opcode whose compiled
   // width diverges from the generic 1 + entry.args.length rule, verified
   // against encodeCommand's own cases above, not assumed from the
   // authored schema. branch/choice are handled by their own framing
   // logic below, never by this table.
   const EXCEPTIONAL_WIDTHS = {
     sting: 3, // [op, index, duration] -- duration is compiler-computed
     sfx: 3,   // [op, index, duration] -- same shape
     battle: 1 + RPG_LIMITS.monstersPerBattle // fixed-width padded actor ids
   };

   function decodeCommand(bytes, at, ctx) {
     const opcode = bytes[at];
     const entry = EVENT_COMMANDS[opcode];
     // Hard failure (Fix round 3, finding 1) on anything that is not a
     // real, live, decodable opcode at this position: past the real
     // prefix, the virtual tail (route -- never a compiled opcode byte,
     // see below), or either framing sentinel (OP_END/OP_JUMP, $00/$FE),
     // neither of which is ever a real command's own opcode -- both are
     // consumed explicitly by decodeEvent/the branch+choice cases below
     // and must never reach this generic dispatch.
     if (!entry || entry.virtual || opcode === OP_END || opcode === OP_JUMP) {
       throw new Error(`decodeCommand: opcode ${opcode} at byte ${at} is not a real, decodable command`);
     }

     if (entry.id === 'branch') {
       const [cond, arg, value, thenLen] = bytes.slice(at + 1, at + 5);
       const then = decodeBody(bytes, at + 5, thenLen, ctx);
       const jumpByte = bytes[at + 5 + thenLen];
       if (jumpByte !== OP_JUMP) throw new Error(`branch at ${at}: expected OP_JUMP, got ${jumpByte}`);
       const elseLen = bytes[at + 5 + thenLen + 1];
       const els = decodeBody(bytes, at + 5 + thenLen + 2, elseLen, ctx);
       return { form: 'branch', cond: [cond, arg, value], then, else: els, size: 5 + thenLen + 2 + elseLen };
     }

     if (entry.id === 'choice') {
       // Corrected round 3: recordLength = body.length + 2
       // (textcompile.js:438-452), so the body is recordLength - 2 bytes,
       // and the whole record is 1 + recordLength bytes -- not
       // 1 + recordLength + 2, round 2's own double-counting bug.
       const count = bytes[at + 1];
       const labels = bytes.slice(at + 2, at + 2 + count).map((id) => ctx.strings[id]); // CONTENT, not id
       let cursor = at + 2 + count;
       const records = [];
       for (let i = 0; i < count; i++) {
         const recordLength = bytes[cursor];
         const bodyLength = recordLength - 2;
         const body = decodeBody(bytes, cursor + 1, bodyLength, ctx);
         const jumpByte = bytes[cursor + 1 + bodyLength];
         if (jumpByte !== OP_JUMP) {
           throw new Error(`choice option ${i} at ${cursor}: expected OP_JUMP, got ${jumpByte}`);
         }
         const pastByte = bytes[cursor + 1 + bodyLength + 1];
         records.push({ body, recordLength, past: pastByte });
         cursor += 1 + recordLength; // exactly textcompile.js's own per-record size
       }
       // Fix round 4, finding 2 -- VALIDATE the trailing "past" byte, not
       // merely consume it. textcompile.js's own past[index]
       // (textcompile.js:444-446) is the total size of every record AFTER
       // this one -- exactly how far script_skip (engine/script.asm) must
       // jump to land past every remaining option once this one is chosen.
       // A decoder that only advanced the cursor past this byte, never
       // checking its value, would pass a corpus where every record
       // happened to carry past=0 -- wrong bytes that merely "look
       // consumed." Verified against the identical formula the compiler
       // itself uses, not re-derived independently.
       for (let i = 0; i < records.length; i++) {
         const expectedPast = records.slice(i + 1).reduce((sum, r) => sum + 1 + r.recordLength, 0);
         if (records[i].past !== expectedPast) {
           throw new Error(`choice option ${i}: past=${records[i].past}, expected ${expectedPast}`);
         }
       }
       return {
         form: 'choice',
         labels,
         options: records.map((r) => r.body),
         past: records.map((r) => r.past), // retained in the decoded form -- structure-only, reorder-invariant, harmless to compare
         size: cursor - at
       };
     }

     if (entry.id === 'warp') {
       const [screenByte, x, y] = bytes.slice(at + 1, at + 4);
       // Canonicalize identically to the compiler's own clamp (§6.1's
       // canonicalizeFlat, mirroring generate.js:2586/textcompile.js:171-172)
       // against THIS build's own flat array, then resolve to the screen
       // OBJECT -- reference equality is sufficient here since both builds
       // exist in the same test process; no serialization boundary to cross.
       return { form: 'warp', target: ctx.flat[canonicalizeFlat(screenByte, ctx.flat.length)]?.screen, x, y, size: 4 };
     }

     if (entry.id === 'say') {
       return { form: 'say', text: ctx.strings[bytes[at + 1]], size: 2 };
     }

     // Every remaining real op: EXCEPTIONAL_WIDTHS when listed there, else
     // the generic 1 + entry.args.length -- see the width table above.
     // None of these ever carry a screen or string reference (§3's
     // inventory), so raw bytes are already the correct comparison.
     const width = EXCEPTIONAL_WIDTHS[entry.id] ?? 1 + entry.args.length;
     return { form: entry.id, raw: bytes.slice(at + 1, at + width), size: width };
   }

   function decodeBody(bytes, at, length, ctx) {
     const commands = [];
     let cursor = at;
     while (cursor < at + length) {
       const decoded = decodeCommand(bytes, cursor, ctx);
       commands.push(decoded);
       cursor += decoded.size;
     }
     // Fix round 3, finding 1 -- exact consumption, not "close enough": a
     // width bug that under- or over-counts leaves cursor short of or past
     // at+length, which a bare loop condition would silently absorb into
     // the NEXT command's own opcode byte instead of failing loudly.
     if (cursor !== at + length) {
       throw new Error(`decodeBody: consumed ${cursor - at}, expected exactly ${length}`);
     }
     return commands;
   }

   function decodeEvent(bytes, ctx) {
     const pages = [];
     let cursor = 0;
     while (bytes[cursor] !== EVT_PAGES_END) {
       const [cond, arg, value, bodyLen] = bytes.slice(cursor, cursor + 4);
       // The page body's own final byte is a real OP_END ($00) -- included
       // in bodyLen, but OP_END is never itself a decodable command
       // (decodeCommand's own guard refuses opcode 0). Decode the body
       // EXCLUDING that final byte, then verify it explicitly.
       const body = decodeBody(bytes, cursor + 4, bodyLen - 1, ctx);
       const endByte = bytes[cursor + 4 + bodyLen - 1];
       if (endByte !== OP_END) throw new Error(`page at ${cursor}: expected OP_END, got ${endByte}`);
       pages.push({ cond: [cond, arg, value], body });
       cursor += 4 + bodyLen;
     }
     // Fix round 3, finding 1 -- the terminator itself must be the exact
     // last byte; nothing may follow it unconsumed.
     if (cursor !== bytes.length - 1) {
       throw new Error(`decodeEvent: EVT_PAGES_END at ${cursor}, expected last byte of ${bytes.length}`);
     }
     return pages;
   }
   ```

   **`route` and the corpus, stated explicitly per the brief's own ask.** `route` is `virtual: true` and
   contributes no opcode byte of its own — `encodeCommand`'s own `'route'` case returns
   `encodeBody(legs, ...)` directly, so a compiled route's bytes are indistinguishable from its own
   `move`/`turn`/`wait` legs authored standalone at that position. The decoder therefore needs, and has,
   no `'route'` case at all: `decodeCommand`'s own hard-failure guard explicitly excludes `entry.virtual`
   opcodes from ever being *dispatched to*, which is correct because a route's own opcode value is never
   written to the stream in the first place — there is nothing at that position for the guard to reject.
   The decoder-corpus test (below) covers this not with a dedicated case but by including an authored
   `route` in its fixture and asserting the decoded body contains the route's own legs as ordinary,
   individually-decoded `move`/`turn`/`wait` entries — proving the zero-framing compilation this codebase
   already guarantees (`design-routes.md` §6) survives decoding intact, through the identical generic path
   those two ops already exercise standalone elsewhere in the same corpus.

   **Ordering requirement, stated explicitly per the brief's own instruction (Fix round 4, finding 2):**
   the Choice `past`-byte validation above must land, and §11 test 24 must confirm it (below), **before**
   this decoder is trusted as the semantic oracle for tests 6 and 7 — a decoder that only ever consumes
   `past` without checking it would still report two builds' Choice structures as semantically equal even
   if one of them carried a `past` value that would misdirect the engine's own `script_skip` at runtime,
   silently certifying a corruption the whole point of this decoder is to catch. This is not a new,
   separate gate; it is this same code path, corrected once, that both the corpus test and tests 6/7
   already depend on.

   The test builds both projects, calls `compileText`/`flattenScreens` on each to get real `events`/
   `eventFor`/`strings`/`flat`, then for every entity tracked by object identity across both builds calls
   `decodeEvent(eventsBefore[eventForBefore.get(entity)], { strings: stringsBefore, flat: flatBefore })`
   and the equivalent for "after," and deep-compares the two decoded structures — a plain
   `assert.deepEqual`, since every relocatable field is already resolved to build-independent content
   (a screen object reference, a string's own text) before the comparison runs, and every other field is
   a raw, genuinely-invariant byte.
   **Door/pickup targets are handled separately, and correctly this time (Fix round 2, finding 3's second
   half — round 1's `resolveDoorTarget` sketch could not be extracted with the signature given, and was
   wrong for a pickup actor regardless).** Round 1 proposed `resolveDoorTarget(entity, actor, itemsEnabled,
   itemIdForActor)`, omitting the one value the real ternary (`generate.js:2582-2586`) actually closes
   over — `flat.length`, needed for its own `Math.min` clamp — and implicitly promising every entity
   resolves to a screen index, which is false for a pickup actor (§3 row 1): its compiled byte is an item
   id, a completely different id space, never a `flat[...]` lookup target. The corrected, exported
   function gets every dependency it uses and returns a tagged result the test (and `emitScreens` itself,
   which this revision updates to call it in place of its own inline ternary — the one small, justified
   refactor this design proposes, not scope creep) both switch on explicitly rather than assuming:

   ```js
   // Exported from main/build/generate.js, replacing the inline ternary at
   // emitScreens:2582-2586 verbatim -- same two branches, same values, now
   // named and given every dependency the ternary itself reads.
   export function resolveEntityByte(entity, actor, itemsEnabled, itemIdForActor, flatLength) {
     if (itemsEnabled && canBackItem(actor)) {
       return { kind: 'item', itemId: itemIdForActor.get(entity.actorId) ?? NO_ITEM };
     }
     return { kind: 'screen', flatIndex: Math.min(entity.props?.toScreen ?? 0, Math.max(0, flatLength - 1)) };
   }
   ```

   The test calls this once per entity per build; for `kind === 'screen'`, resolves `flat[flatIndex].screen`
   and compares identity across builds exactly like a decoded Warp's target; for `kind === 'item'`,
   compares `itemId` directly — never resolved through `flat[...]`, since it was never a screen index to
   begin with, and (correctly) never expected to change under a reorder at all, since `project.items` is
   untouched by any screen/map operation.

   This is the decoder the round-2 review's finding 3 asked for, not a lighter substitute: it walks
   pages, branch arms, and choice option records, replaces exactly the two relocatable operand kinds this
   codebase's own wire format actually has (verified against §3's inventory, not assumed), and gives the
   entity-target helper its real dependencies with the door-vs-pickup split made explicit in its own
   return type. **It was still wrong, in the two ways round 3's own review found (Choice's framing, and
   the generic-width assumption) — corrected above, this round, against `encodeCommand`'s actual cases
   rather than the authored schema, with the explicit width table and the hard-failure/exact-consumption
   discipline now stated as design requirements, not left implicit for an implementer to reconstruct.**
3. **The one thing that IS byte-provable, kept from round 1, its scope now corrected rather than merely
   its weakness stated (Fix round 1, finding 5's own ask; Fix round 2, finding 1 forces a further
   correction):** reordering and then un-reordering (applying the inverse permutation) is a true no-op
   **for a save-free project** — build one, build its ROM, apply `reorderMaps` with some permutation,
   apply it again with the inverse permutation, build again, assert the two `.nes` files ARE
   byte-identical. This is provable because a bijection composed with its own inverse is the identity,
   `reorderMaps`'s `translate` (§6.1.1) is built fresh from `flatScreens` on each call rather than
   accumulating drift, and — the correction this revision adds — a save-free fixture never assembles
   `engine/save.asm`'s routines at all (`SAVE_ENABLED` gates them), so `saveCompatToken`'s own value,
   though it genuinely changes twice during this round trip (§6.10: each reorder redraws its own fresh
   token, never restoring the pre-round-trip value), never reaches a single compiled byte — nothing in a
   save-free ROM ever encodes `SAVE_IDENTITY_0..3` as an instruction operand. **A save-enabled project's
   inverse-reorder round trip is *not* byte-identical**, by design (§6.10's own explicit policy) — its
   `SAVE_IDENTITY_0..3` bytes differ before and after, even though the map order returns to its original
   arrangement, because each reorder is its own qualifying edit and draws its own fresh token. §11 test 8
   is pinned to a save-free fixture for exactly this reason, with a comment recording why, rather than
   silently relying on a fixture that happens not to exercise Save.

   **Its remaining weakness, unchanged from round 1's own honesty about it and still worth stating: a
   no-remap implementation (one that permutes `project.maps` but never touches a single door, warp, or
   event slot) passes this test too** — permuting the map array and then permuting it back with the
   inverse restores the exact original array, and if nothing else was ever touched, the compiled output
   is trivially identical at the end regardless of whether the remap machinery exists at all. **This is
   exactly why test 2 above is load-bearing and not optional**: a no-remap implementation fails test 2
   immediately after the *first* reorder (a door's resolved target screen identity would not match its
   pre-reorder identity, since the stale byte still points at the old flat number, which the new flat
   order has reassigned to different content) — the inverse-permutation test alone proves nothing about
   correctness mid-sequence, only that whatever the mechanism does, doing and undoing it cancels out;
   test 2 is what proves the mechanism does anything correct in the first place.

## §8. Folders/tree

**Decision: display-only metadata, in-scope for this slice (cheap enough not to defer) — unchanged from
round 1, confirmed by the review** ("Display-only folders... are reasonable"). A new field,
`map.folder: string | null` (default `null` — "no folder," matching every other optional grouping field
in this schema's style, e.g. `hideSwitch`'s `null` = "always here"). **Fix round 1, finding 10 — both
schema touchpoints, named explicitly rather than left implicit:**

- **`createMap(id, name)`** (`shared/project.js:1112-1128`) gains `folder: null` in its returned object
  literal, alongside `songId: null` and the rest — the field exists on every freshly created map from
  the moment `createMap` is called, not only after the first explicit assignment.
- **`normalizeMap(raw, id, itemCtx)`** (`shared/project.js:2248-2270`) gains, in its own returned object:
  `folder: typeof raw?.folder === 'string' ? raw.folder.trim().slice(0, AUTHOR_NAME_MAX) : null` —
  the round-trip half. Without this, a project saved with a folder name, then reloaded, loses it
  silently: `createMap`'s own default only covers a map created fresh in the current session; every map
  read back from disk goes through `normalizeMap`, and any field `normalizeMap` does not explicitly copy
  is simply absent from the normalized result, the review's own precise citation of how this bug would
  present ("an implementation that forgets to add `folder: null` to `createMap` and forgets the
  `normalizeMap` round-trip still passes" a test that only checks the compiler ignores the field, since
  such a test never reloads the project at all).

**The build ignores it entirely** — `flattenScreens`, `emitScreens`, `checkCapacity`, every compiled
table, all read `project.maps` in array order exactly as they do today; nothing about a folder name
changes flat index, bank packing, or any compiled byte. This is the "cheapest honest answer" the brief
invites: a folder is purely a per-map label the Map Forge's own map picker
(`renderer/forges/map/map.js:1449-1470`) displays **alongside `project.maps`' own unmodified order,
never as a regrouping of it** — §12 states the exact display rule and the reasoning (Fix round 2,
finding 7: an `<optgroup>`-style regroup was considered and retracted, because it can make a real
reorder invisible in the one place an author would check it). No new capacity term, no new
`validateProject` rule beyond the existing string-length clamp every other author-facing name field
already gets.

## §9. Named screens — what item 2 already shipped vs. what's left

Verified against the actual code, not assumed from the brief: **almost everything is already done.**
`createScreen()`'s `name` field (`shared/project.js:1105-1110`, with its own "an unnamed screen is the
empty string... `screenLabel` supplies the fallback" comment) and `screenLabel` (`shared/project.js:
2217-2222`, "Every warp target, door target, title-screen picker and search result goes through this")
are both already in place and already consumed by every picker checked in this research: the door
target select (`map.js:1011`, `→ ${entry.label}`), the warp command's picker (`context.screens`, built
from `flatScreens(...).map(entry => entry.label)` at `map.js:639`, consumed by `events.js:1599`), the
title-screen select (`map.js:1214-1229`), and `eventlist.js`'s search index (line 103). **Renaming a
screen already exists** (`map.js:1596-1608`, the map-settings panel's screen-name field). **What is
genuinely left**, per §4.3: a `validateProject` warning when two maps, or two screens within the same
map, share a name — because `resolveStartAt`'s own "refuse rather than guess" policy makes this a real,
if soft, consequence rather than cosmetic.

**Fix round 1, finding 6 — the screen half of this check must exclude empty names, or it fires on nearly
every ordinary project.** `createScreen()` defaults every screen's `name` to `''`, and the vast majority
of screens in any real project stay that way (only screens an author specifically named ever have a
non-empty value). `resolveStartAt` (`shared/playscenario.js:81`, `if (screenName)`) already bypasses
name-based lookup entirely for an empty `screenName`, falling straight to per-map position — so two
unnamed screens sharing the map are never actually ambiguous to it. A same-map name-count check that
does not exclude `''` before counting would warn on almost every multi-screen map with fewer named
screens than total screens — a false positive so common it would train authors to ignore the warning
category entirely, defeating its purpose for the one time it names a real collision. Map names cannot
trigger this failure mode (`map.js:1518`'s own rename handler, `value = event.target.value.trim() ||
`Map ${index}``, guarantees a map name can never be blanked to `''`), so only the screen half needs the
guard — stated explicitly here so the asymmetry is not mistaken for an oversight. Corrected check:

```js
// New validateProject check, added beside the existing item/actor-name checks.
const mapNameCounts = new Map();
for (const map of project.maps) {
  const name = map.name.trim();
  mapNameCounts.set(name, (mapNameCounts.get(name) ?? 0) + 1);
}
const dupMapNames = [...mapNameCounts.values()].filter((n) => n > 1).length;
if (dupMapNames) {
  add('warning', 'Map Forge',
    `${dupMapNames} map name${dupMapNames === 1 ? ' is' : 's are'} used more than once — ` +
    'the remembered ▶ Test scenario can\'t tell two same-named maps apart and will refuse to resolve.');
}

// Screens: scoped per-map (screenLabel already disambiguates ACROSS maps via
// the map.name prefix, and resolveStartAt's own screensNamed lookup is
// scoped to one map -- a same name in two DIFFERENT maps is not a collision
// either of them can observe), and -- the fix -- only non-empty trimmed
// names are counted at all. An unnamed screen has no name to collide with
// anything; resolveStartAt never calls screensNamed for one (§3 row 13(b)).
for (const map of project.maps) {
  const screenNameCounts = new Map();
  for (const screen of map.screens) {
    const name = screen.name.trim();
    if (!name) continue; // the fix -- exclude empty names from the count entirely
    screenNameCounts.set(name, (screenNameCounts.get(name) ?? 0) + 1);
  }
  const dupScreenNames = [...screenNameCounts.values()].filter((n) => n > 1).length;
  if (dupScreenNames) {
    add('warning', 'Map Forge',
      `"${map.name}" has ${dupScreenNames} screen name${dupScreenNames === 1 ? '' : 's'} used more than ` +
      'once — the remembered ▶ Test scenario can\'t tell same-named screens apart within this map and ' +
      'will refuse to resolve.');
  }
}
```

## §10. Compiler impact — argued, not just asserted, to be zero

No new `EVENT_COMMANDS` entry, no new opcode, no new `OP_*` constant, no engine RAM. Every field this
design touches (`props.toScreen`, a `warp` command's `screen`, `titleMap`/`titleScreen`/`startMap`/
`startScreen`, `map.folder`) already exists in the schema and already compiles through unmodified
existing code (`emitScreens`, `encodeCommand`'s `warp` case, `startFlat`/`titleFlat`'s derivation) —
this design only changes *which values* those fields hold at the moment a build runs, never *how* they
are compiled. `map.folder` is read by nothing in `main/build/`. The duplicate-name warning is a new
`validateProject` entry, which is JS-only diagnostic text, not compiled output. **`saveCompatToken`
(§6.10) is the one new field with a genuine, if indirect, compiled-output effect — it changes the value
of `SAVE_IDENTITY_0..3` (four already-existing constants) on a project that has performed a qualifying
structural edit, and changes nothing else: no new engine RAM, no new dispatch, `engine/save.asm`'s
`save_check_valid` is completely unchanged, since it already only ever compares those four constants
against the save's own stored bytes, whatever produced them.** §7's `resolveEntityByte` extraction is a
pure refactor of existing JS-side compile logic with no ROM-visible effect at all — the bytes
`emitScreens` writes are unchanged; only which function computes the value that feeds them moves. §7's
own decoder (`decodeCommand`/`decodeBody`/`decodeEvent`) is test-only code, never imported by
`main/build/`, so it has no compiled-output effect of any kind, direct or indirect.
**Verification plan, matching the routes precedent's own implementation-gate step (`design-routes.md`
§6, "one-time, not a permanent test"):** build a route-free, reorder-free, duplicate-free, folder-free
project (i.e., an ordinary project untouched by any of this slice's own new UI, with
`saveCompatToken` at its default 0) from the pre-slice tree and the post-slice tree, compare the two
`.nes` files, and record both SHA-256 hashes in the implementation report — establishing once, at
merge time, that a project that never uses any of item 7's new operations compiles exactly as it did
before this slice existed. Not carried forward as a permanent test, for the identical reason the routes
design gives: ordinary regression coverage protects it afterward.

## §11. Test plan, with sabotages

Unit tests, in `shared/project.js`'s associated test file (`test/unit/project.test.js`, alongside the
existing renumber-family tests) unless noted. Tests 21-23 are new this round (Fix round 2, findings 1, 2
and 4/6); tests 3, 7, 8, 18, 19, 20 are corrected or widened in place, each marked where it happens.
**Fix round 1, finding 9 — every new test below is either new or materially widened from round 1's
version; the closing subsection re-runs the "name a wrong implementation that would still pass" exercise
against this revised list, per the brief's own explicit
ask, and records the answer rather than only asserting the list is now complete.**

1. **`remapScreenReferences` walks every reference kind from §3's inventory, isolated.** A fixture with
   one door (self-referential: points at another screen in the same map), one door pointing at a
   different map, one `warp` command inside a page's top level, one `warp` command inside a `branch`'s
   `then`, one inside a `choice` option — apply a `translate` that permutes every flat index by a known
   rule (e.g. reverse the whole flat order) and assert every one of the five references now names the
   screen the rule predicts.
   *Sabotage it would catch:* an implementation that only walks `allCommands` at a page's own top level
   (the exact defect CLAUDE.md documents `usedSwitches` once had) — the branch/choice-nested warps would
   silently keep their stale value and the test would only pass if both nested cases are exercised
   separately, which this fixture does.

2. **A door's `props.toScreen` is remapped even when its actor is not currently door-behaved.** Fixture:
   an entity with `props.toScreen` set to some value, but its `actorId` names a pickup actor, not a
   door. Apply a reorder; assert `props.toScreen` was still rewritten per `translate` (not skipped).
   *Sabotage it would catch:* an implementation that gates the door-target walk on `actor.behavior ===
   'door'` (a plausible-looking but wrong reading of the brief's own "must never run for a pickup
   actor's byte" warning, corrected by §3 row 1's verified finding that this field is never actually
   read as an item id at the schema level) — such an implementation would leave a *future* door (an
   author changing this placement's actor back to a door-behaved one later) pointing at a stale target,
   invisibly, because the remap silently skipped it on the (wrong) assumption that "not currently a
   door" meant "not a screen reference."

3. **`canonicalizeFlat` resolves a pre-edit out-of-range value to its already-effective target, not to
   `DROPPED_SCREEN` (new — Fix round 1, finding 4; fixture corrected — Fix round 2, finding 5).**
   **Round 1's own fixture proved nothing**: it moved screen 2's content to flat 0, and
   `FALLBACK_SCREEN(project)` is *also* flat 0 (§6.4) — so round 1's own broken implementation
   (classifying an out-of-range `255` as `DROPPED_SCREEN` and applying the fallback) produced the exact
   value this test asserted and passed cleanly, indistinguishable from the correct mechanism. **Corrected
   fixture:** a four-screen project (`0,1,2,3`), one door with `props.toScreen = 255` (compiler-effective
   target: screen 3, `Math.min(255, 3)`), one warp command with `command.screen = 255` inside a `choice`
   option (same effective target). Apply a reorder that moves screen 3's content to flat position **2**
   — a nonzero destination, deliberately distinct from `FALLBACK_SCREEN`'s own value of 0. Assert both
   references now point at flat 2 (the screen that was screen 3's content), and — the second, independent
   half of the fix — assert `remapScreenReferences`' own returned `droppedTargets` array has length 0 for
   this reorder, proving the value was reached by translation, not by the fallback path being silently
   taken and happening to land on a number that looked right.
   *Sabotage it would catch:* round 1's own implementation shape — treating any `oldFlat >= before.length`
   as `DROPPED_SCREEN` — which this corrected fixture forces to disagree with the compiler's own clamp on
   both counts: the resolved value (0 vs. 2) and the `droppedTargets` count (nonzero vs. 0), where round
   1's fixture could only ever have disagreed on a value that happened to coincide.

4. **Duplicate-append canonicalizes a pre-existing out-of-range value against the PRE-append flat
   count, not the post-append one (new — Fix round 1, finding 4's own "append is worse" point).**
   Fixture: a three-screen project (one map), one door with `props.toScreen = 255` (effective target:
   screen 2, the map's own last screen). Duplicate that same map (now six screens total, `screenCount`
   doubled). Assert the original door's `props.toScreen` is now the literal number `2` — its own already-
   resolved, pre-edit effective target — and specifically **not** `5` (the new, post-append last screen,
   which is what re-clamping `255` against the *new*, larger `screenCount` would silently produce).
   *Sabotage it would catch:* an implementation that treats duplicate-append as truly "zero rewrite" (no
   canonicalizing pass at all, round 1's own claim) — the stored `255` survives verbatim, and the *next*
   build silently retargets it to the newly duplicated content purely because that content happened to
   grow `flat.length`, with no edit ever touching this door directly.

5. **Reorder's `titleScreen`/`startScreen` are byte-identical before and after — only `titleMap`/
   `startMap` change; `droppedTargets` is always empty for a reorder (widened — asserts the emptiness
   directly, per §6.4's own claim).** Fixture: two maps, title on map 1 screen 2. Reorder to swap map
   order. Assert `titleScreen` is unchanged (still 2), `titleMap` is now 0, and the `remapScreenReferences`
   call's own returned `droppedTargets` array has length 0.
   *Sabotage it would catch:* an implementation that (incorrectly) treats `titleScreen` as flat-space
   and runs it through the same `translate` the door/warp walk uses — it would compute a wrong new
   value that happens to still be in-range (since `translate` is total), passing a range check but
   pointing at the wrong screen inside the correct map, the exact "clamped but wrong" failure mode this
   whole design exists to prevent, now self-inflicted by the fix; the `droppedTargets` assertion
   separately catches a `buildReorderTranslate` that returns `DROPPED_SCREEN` for any in-range input,
   which the bijection argument (§6.1.1) says can never happen.

6. **Content-preservation across reorder — the brief's own headline test.** The fixture from §7 item 1
   (self-referential door, cross-map door, warp at top level, warp in branch, warp in choice option,
   title, start), reorder applied, every reference re-resolved and asserted to name the same screen
   *content* as before (compare `.name`/object identity through the fixture's own tracking, not just
   "is still in range").
   *Sabotage it would catch:* anything that produces an in-range but wrong flat index anywhere in the
   walk — the class of bug a range-only assertion would miss entirely.

7. **The real semantic decoder, compiler-agreement check (REPLACES round 1's raw-ROM-multiset test AND
   round 1's own semantic-normal-form sketch, which the round-2 review found was not one — Fix round 1,
   finding 5; Fix round 2, finding 3; fixture corrected — Fix round 3, finding 3).** Build a project with
   two maps of text, reordered — deliberately engineered so **both** relocatable operand kinds shift, not
   just one, closing the exact gap round 1's test left open (its own "third placement whose event is
   unaffected" dodge): (a) a `warp` command on map A targeting a screen on map B, so the operand's raw
   byte is required to change between builds.

   **(b) and (c), rebuilt per Fix round 3, finding 3 — round 2's own fixture could not actually force a
   string id to shift.** `internString` (`main/build/textcompile.js`) interns by *encoded-content key*,
   not by which placement authors it: two placements with byte-identical dialogue create exactly one
   string-table entry, at whichever point in the distinct-content sequence either occurrence is first
   *encountered* — swapping which of the two *placements* comes first changes nothing, since the shared
   content still arrives at the same position in that sequence either way. Round 2's own fixture — "map A
   has the shared string, map B has the shared string, swap them" — was therefore not discriminating: the
   shared string's id is identical in both orders, and the test's own independent "assert the ids differ"
   check would have failed against a *correctly compiling* project, not merely against a wrong decoder.
   **The fix is the ordering the review itself sketches, which changes the *distinct-content sequence*
   rather than merely which placement holds the shared text:** map A authors, in order, (i) a `Say` with
   a string unique to A ("Only in A"), then (ii) a `Say` with the shared dialogue ("Hello"); map B authors
   only (iii) a `Say` with the identical shared dialogue ("Hello"), nothing unique before it. In the
   A-before-B build, the distinct-content sequence encounters A's unique string first (id `0`), then the
   shared string for the first time (id `1`); B's own occurrence of it reuses id `1`. In the B-before-A
   build (after the reorder), the shared string is now encountered *first*, on map B (id `0`); A's unique
   string is now new content at that point (id `1`); A's own occurrence of the shared string reuses id
   `0`. The shared string's raw compiled id is therefore **provably** `1` in one order and `0` in the
   other — not merely asserted to differ, but derived here from `internString`'s own actual
   dedup-by-content rule, so the fixture cannot fail against a correctly-compiling project the way round
   2's own version could have. The identical construction is applied to the Choice label: map A authors a
   `Choice` whose one option's label is the shared text, preceded (elsewhere on the same page, before the
   `Choice`) by an unrelated unique string; map B authors only a `Choice` with the identical shared label
   and nothing unique before it — the choice command itself is nested inside a `branch`'s `then`, so the
   fixture also exercises the decoder's own recursion through both nesting shapes at once, unchanged from
   round 2's intent.

   Build both projects, call `compileText`/`flattenScreens` on each. Run the §7-item-2 decoder
   (`decodeEvent(events[eventFor.get(entity)], { strings, flat })`) against each placement's compiled
   event in both builds, and `assert.deepEqual` the decoded structures: the warp's decoded `target` is
   the same screen object (via the before/after object-identity tracking every other test in this plan
   already uses) in both; the `Say`/Choice-option's decoded `text`/`labels` are the same *content* in
   both, and — now provable rather than merely hoped for — the test independently asserts the shared
   string's raw compiled id is `1` in the A-before-B build and `0` in the B-before-A build, exactly as
   derived above, confirming the fixture genuinely exercises the shift rather than coincidentally landing
   on an unchanged id. Separately, run `resolveEntityByte` (§7 item 2's corrected export) on a pickup-actor
   entity in both builds and assert its `itemId` is compared directly, never routed through `flat[...]`.
   *Sabotage it would catch:* the exact gap the round-2 review names by construction — an implementation
   that decodes and resolves Warp operands correctly (passing a warp-only version of this test) but
   compares Say/Choice string operands as raw ids rather than decoded content fails the moment the
   fixture's own derived id shift (1→0, 0→1) disagrees with a raw-id comparison, which this corrected
   fixture *provably* produces rather than merely asserts; an implementation that never decodes at all
   (round 1's own gap) fails on the warp half exactly as round 1's own test 7 already caught. An
   implementation that resolves a pickup's compiled byte through `flat[itemId]` (treating every entity's
   byte as a screen index) fails the separate `resolveEntityByte` assertion directly, typically by
   resolving to whatever screen happens to sit at that flat position or by throwing on an out-of-range
   lookup.

8. **Reorder-then-inverse-reorder is byte-identical on a save-free fixture (the permanent, cheap
   regression test — §7 item 3); a save-enabled fixture is explicitly a different, non-byte-identical
   claim (Fix round 2, finding 1's own pinning requirement).** Build once, reorder, reorder back with the
   inverse permutation, build again, assert `.nes` equality — **the fixture carries no `Save` command
   and no title screen**, stated directly in the test's own name/comment, so `SAVE_ENABLED` is off and
   `save.asm`'s routines never assemble at all, meaning `saveCompatToken`'s own value (which the test
   separately asserts changed twice during the round trip, §6.10) never reaches a single compiled byte —
   the ROM comparison is therefore genuinely, unconditionally byte-identical, not byte-identical by
   accident of a fixture that happened not to exercise Save. The test's own comment also records
   explicitly that byte-identity alone does not prove correctness (a no-remap implementation passes it
   too, §7's own worked argument) — test 7 above is what actually proves the mechanism does something,
   this test only proves it does that something *reversibly*. A **second, separate** assertion — not a
   second test, folded into this one since it shares the same round-trip fixture shape — confirms the
   *opposite* claim on a save-enabled variant: build a save-enabled project, reorder then inverse-reorder,
   and assert the two builds' `SAVE_IDENTITY_0..3` bytes **differ**, with a comment citing §6.10's own
   explicit policy (two qualifying edits, two independently-drawn tokens, no attempt to recognize a
   round trip as a no-op) so a future reader does not mistake this for a bug the save-free half somehow
   missed.
   *Sabotage it would catch:* any drift in how `translate` is derived across repeated calls — e.g. an
   implementation that accumulates a running index map instead of recomputing fresh from `flatScreens`
   each time, which could compound rounding/off-by-one errors invisible in a single-application test but
   visible the moment the same operation runs twice. The save-enabled half separately catches an
   implementation that (incorrectly) tries to make the token "smart" — recognizing a round trip and
   restoring the original value — which §6.10 argues is unachievable without per-screen identity and
   this design does not attempt; such an attempt would most likely produce a token that matches on some
   round trips and not others, exactly the non-uniform behavior this assertion is positioned to catch.

9. **Duplicate map: self-referential doors follow the copy; external doors do not; the copy's own
   nested Warp commands (top-level, branch, choice) follow the identical split (widened — Fix round 1,
   finding 3's second half and finding 9's own explicit demand).** Fixture: a two-screen map, a door on
   screen 0 pointing at screen 1 (self-referential), a door on screen 0 pointing at an unrelated second
   map (external), **and** an event on screen 0 with a top-level `warp` command targeting screen 1
   (self-referential), a `warp` inside a `branch`'s `then` targeting the external map, and a `warp` inside
   a `choice` option targeting screen 1 again. Duplicate the first map. Assert: every self-referential
   reference (door and all three Warp shapes) in the copy points at the *copy's* screen 1, not the
   original's; every external reference in the copy still points at the same external target the
   original's does; the original map's own entities and events are completely unchanged (byte-for-byte,
   compared directly against a pre-duplicate snapshot).
   *Sabotage it would catch:* precisely the gap the review's finding 9 names by construction — an
   implementation that correctly rewrites the copy's entity `toScreen` bytes (passing a doors-only
   version of this test, which is all round 1's own test 7 checked) but never walks the copy's own event
   pages at all, leaving every nested Warp in the copy silently aimed at the original map's screens. This
   fixture cannot pass without both halves working, unlike round 1's, which could.

10. **Duplicate map: auto-suffixed name avoids §4.3's collision, verified against `resolveStartAt`.**
    Duplicate a map named "Dungeon"; assert the copy is named "Dungeon copy" (or "Dungeon copy 2" if that
    collides too); then run `resolveStartAt` with a remembered scenario naming "Dungeon" and assert it
    still resolves (does not refuse) — a direct, integration-shaped proof that the naming choice actually
    prevents the real consequence §4.3 identifies, not just a cosmetic string check.
    *Sabotage it would catch:* an implementation that copies the name verbatim (visually plausible, looks
    like "it duplicated correctly") — this test fails specifically on the `resolveStartAt` call, which a
    naive "does the name look right" test would never exercise.

11. **Duplicate screen naming (new — Fix round 1, finding 6, the screen half round 1 left unresolved).**
    Two fixtures. (a) Duplicate a screen named "Boss Room" within the same map; assert the copy is named
    "Boss Room copy" (auto-suffixed, scoped to the destination map's own screens), and that
    `resolveStartAt` with a scenario remembering "Boss Room" still resolves without refusing. (b)
    Duplicate an *unnamed* screen (`name === ''`); assert the copy's name is also `''` — not suffixed
    into a synthetic name — and that this produces **no** `validateProject` warning from §9's own check
    (which excludes empty names from its count).
    *Sabotage it would catch:* (a) an implementation that copies a named screen's name verbatim, the
    identical class of bug test 10 catches for maps, now isolated for screens; (b) an implementation that
    "fixes" every duplicated screen's name into something non-empty (e.g. `"Screen copy"` for an
    originally-unnamed one) on the theory that every duplicate needs *a* name — this manufactures an
    identity, and a collision, where none was ever authored, and this fixture's `resolveStartAt`/warning
    assertions catch it directly rather than merely checking a string looks reasonable.

12. **Duplicate screen: no blank-cell reuse exists (widened from round 1's now-obsolete test — Fix
    round 1, finding 3's first half).** Fixture: a 2×2 map with one blank cell (content-equal to
    `createScreen()`). Duplicate a filled screen from the same map. Assert the map's `gridW`/`gridH`
    grew (this design's own decision, §6.2, offers no path that reuses the blank cell), the blank cell's
    own content is **still** exactly `createScreen()`-shaped afterward (untouched, not silently claimed),
    and every other screen's door/warp targets that pointed at the (still-blank, still-in-its-old-flat-
    position-or-shifted-by-growth) cell resolve to the *same content* as before (the blank screen's own
    identity, tracked through the resize's own object-identity diff, §6.9) — proving the blank cell was
    treated as a real, referenceable screen throughout, never as free real estate.
    *Sabotage it would catch:* a reintroduction of round 1's dropped blank-cell-reuse path — this fixture
    fails immediately if the duplicate's content ends up written into the blank cell instead of a newly
    grown one, since the "still exactly `createScreen()`-shaped" assertion would find the duplicate's
    metatiles sitting there instead.

13. **Cross-tileset paste/duplicate returns a warning from the operation itself, never from
    `validateProject`/`checkCapacity` (rewritten — Fix round 1, finding 8).** Paste a region (or
    duplicate a screen) between two maps with different `tilesetId`s; assert the paste/duplicate
    function's own **return value** contains the warning text; separately, build the resulting project
    and assert `checkCapacity`'s `problems` array contains **no** entry mentioning tileset mismatch at
    all (not even as a warning) — proving the information genuinely does not survive into the schema, as
    §6.2 argues, rather than merely asserting it is the right severity as round 1's version did.
    *Sabotage it would catch:* round 1's own test, which asserted the (impossible) `validateProject`
    warning existed — this revision's version fails loudly if a future implementation tries to resurrect
    that approach, since the second assertion explicitly requires the warning's *absence* from build
    output.

14. **`boundTiles` paste is destination-rectangle replace, not overlay (new — Fix round 1, finding 8).**
    Fixture: a destination rectangle containing one bound-tile cell the source clipboard has **no**
    binding for. Paste the region. Assert that destination cell's binding is gone — not merely
    overwritten by a source binding (there isn't one to overwrite with), genuinely cleared.
    *Sabotage it would catch:* an overlay implementation (write source bindings on top, touch nothing
    else) — this fixture's destination binding would survive, attached to newly pasted art the author
    never bound it to.

15. **Copy/paste region respects `SCREEN_METATILES` bounds and does not corrupt adjacent content.**
    Paste a region whose origin would run past the screen edge; assert it is clamped fully on-screen
    (never wraps or writes out of the `240`-entry `metatiles` array), and assert metatiles *outside* the
    pasted rectangle are byte-identical to before the paste.
    *Sabotage it would catch:* an off-by-one in the row/col-to-flat-metatile-index arithmetic that
    bleeds one row/column into a neighboring, unrelated area of the screen — a defect that would be
    invisible in a paste-in-the-middle-of-the-screen test but real at any edge.

16. **Folder field round-trips through save/load, normalizes idempotently, and is ignored by the build
    (widened — Fix round 1, finding 10, which found round 1's version alone insufficient).** Three
    assertions, not one: (a) set `map.folder = 'Dungeons'`, build, then build the identical project with
    `map.folder` deleted entirely, assert the two `.nes` files are byte-identical (round 1's original
    check, kept); (b) `saveProject`/`loadProject` (`main/project-io.js`) round-trip a project with
    `map.folder` set, assert the reloaded project's `map.folder` is still `'Dungeons'` (closes the gap an
    implementation missing `normalizeMap`'s own round-trip would fall into); (c) `normalizeProject` is
    idempotent on its own output — normalize a project with `map.folder` set, normalize the *result*
    again, assert `map.folder` survives both passes unchanged.
    *Sabotage it would catch:* exactly the implementation the review names — one that adds `folder` only
    to the live in-memory object the Map Forge mutates directly (skipping both `createMap`'s default and
    `normalizeMap`'s round-trip) — round 1's test (a) alone cannot see this, since it never reloads the
    project; (b) fails immediately the moment the project is saved and reopened, which is exactly the
    real-world path an author hits every session.

17. **Duplicate-name `validateProject` warning fires for maps and for same-map screens (excluding empty
    screen names), and not for cross-map same-named screens (widened — Fix round 1, finding 6's warning
    half).** Four fixtures: two maps sharing a name (warns); two *non-empty-named* screens on the *same*
    map sharing a name (warns); two screens on *different* maps sharing a name (does not warn —
    `screenLabel` already disambiguates by map name, and `resolveStartAt`'s own screen lookup is scoped
    per-map); an ordinary multi-screen map where every screen is unnamed (`''`) except possibly one
    (does not warn — the new case this revision adds, directly proving §9's fix).
    *Sabotage it would catch:* an implementation that treats screen names as one flat, project-wide
    namespace (the wrong generalization from "map names are project-wide") and warns on the cross-map
    case too; separately, an implementation that forgets to exclude empty names (round 1's own bug, per
    finding 6) — the fourth fixture fails immediately and loudly on any real multi-screen project, which
    is exactly the false-positive-on-nearly-everything failure mode finding 6 describes.

18. **Delete Map retrofit — the three-case map-space matrix, both start and title, plus the `titleMap ===
    null` stay-null check (widened — Fix round 1, findings 2 and 9; corrected — Fix round 2, finding 6,
    which found round 1's own three-case claim was actually two, missing the "deleted map positioned
    after the referenced one" relationship entirely).** Seven assertions total (3 cases × {start, title},
    plus one for the null-stays-null check), each its own fixture per §6.8's own corrected "Test matrix"
    list: delete-before (referenced index `> mapIndex` → decrements by 1 — round 1's plan already covered
    this direction), delete-after (referenced index `< mapIndex` → unchanged — **new this revision;
    round 1's plan never built this fixture at all**), delete-target (referenced index `=== mapIndex` →
    falls back to `null`/map 0 per the policy). Each fixture also asserts every door/warp elsewhere in
    the project still resolves to the same content (test 6's own content-preservation shape, reused here
    against Delete rather than Reorder). **The seventh assertion, corrected — Fix round 3, finding 4:
    round 2's own version of this assertion re-proved delete-target's own title half (a non-null title
    correctly *becomes* `null`), not the genuinely separate claim the brief actually asks for.** A wrong
    implementation that defaults an *already-null* title to map 0 (treating `null` as "unset, pick
    something" rather than "deliberately titleless") would pass all six non-null start/title cases above
    *and* the repeated delete-target assertion, since neither ever starts from `titleMap: null`. The real
    seventh fixture is independent of the six above: build a project with `titleMap: null` from the
    start (never set to any map at all — the ordinary titleless-project shape, `createProject`'s own
    default), delete *any* map (not necessarily the one that would have held a title, since there is
    none), and assert both that `titleMap` **stays** `null` and that `titleScreen` is not synthesized
    into naming some map's real screen — a titleless project deleting an unrelated map must remain
    exactly as titleless as it started.
    *Sabotage it would catch:* the exact gap the review names directly by citation — `map.js:1494-1500`'s
    current shipped behavior, which only range-clamps `startMap` and never touches `titleMap` at all; no
    test in round 1's plan ever built a fixture that would fail against that code, and this one does,
    immediately, on the delete-target/title case. The new delete-after fixture separately catches an
    implementation that decrements **every** surviving reference regardless of which side of `mapIndex`
    it falls on (the reversed-prose bug §6.8's own bullets carried in round 1) — such an implementation
    passes delete-before (where "decrement everything" and the correct rule happen to agree) and fails
    only on delete-after. **The corrected seventh fixture separately catches an implementation that
    defaults any `titleMap === null` to map 0 on delete** — a bug none of the six non-null cases, nor
    round 2's own mistaken re-test of delete-target, could ever have observed, since all of them start
    from a real, non-null title.

19. **Resize Map retrofit — the remaining two-case matrix, both start and title (new — Fix round 1,
    findings 2 and 9).** Four assertions (2 cases × {start, title}), each per §6.9's own "Test matrix"
    list: width-grow relocation (the reviewer's own `[a,b,c,d]`→`[a,b,new,c,d,new]` shape, asserting
    `startScreen`/`titleScreen` moves from 2 to 3), shrink-target (asserting fallback to per-map 0). Also
    asserts every door/warp elsewhere in the project (including on *other* maps, whose flat base shifts
    when this map's own screen count changes) still resolves to the same content.
    *Sabotage it would catch:* an implementation that retrofits Delete Map (test 18) but treats Resize as
    "already handled" by the existing range clamp on `startScreen` alone (`resizeMap`'s current shipped
    behavior, `map.js:613-615`) — the width-grow case fails immediately, since a range clamp never
    *relocates* a value that is already in range but now wrong, only rejects one that is out of range.

20. **Save-compatibility token — the matrix Fix round 1's finding 1 demands (widened this revision —
    part (a)'s exact-value assertion is corrected, since the token is a redraw, not a deterministic
    counter, per Fix round 2, finding 1).** Modeled directly on `test/unit/save.test.js:406-452`'s own
    `"a save from a different project's build is refused, not misapplied"` test, using the identical
    `buildSaveable`/`boot`/`tap`/`touchSaver` harness (`test/unit/save.test.js:93-200`). (a) **JS-level,
    fast:** build a save-enabled fixture (a live `Save` command, a title screen), two maps of one screen
    each. Compute `saveIdentity(project)`. Apply a same-flat-count reorder (swap the two maps —
    `screenCount`/`mapCount` both unchanged). Assert `project.project.saveCompatToken` is now a nonzero
    integer in `[1, 0xFFFF]` — **not** the literal value `1`, which round 1's own assertion wrongly
    assumed a deterministic counter would produce and which a random token cannot promise — and assert
    `saveIdentity(project)` (post-reorder) differs from the pre-reorder value. **A fourth assertion, added
    by this revision's own self-check below:** hand-construct a raw project object with
    `project.project.saveCompatToken = 0x10001` (65537) and run it through `normalizeProject`; assert the
    normalized result's `saveCompatToken` is `0`, proving the schema's upper-bound clamp (§6.10) actually
    closes the `& 0xffff`-aliasing hole finding 1 names, rather than only the lower bound being enforced.
    (b) **Full integration,
    modeled on the cited precedent:** build ROM 1 from the fixture project, boot it headlessly, trigger a
    real in-game save (`tap(nes, START)` then `touchSaver(nes)`), capture the resulting SRAM bytes.
    Apply the identical same-flat-count reorder to the project, build ROM 2, boot it, load the captured
    SRAM bytes into it (`other.cpu.mem.set(foreignBattery, SRAM_BASE)`), attempt Continue
    (`tap(other, SELECT)`), and assert `GAME_STATE === ST_TITLE` — refused, not misapplied. (c) **The
    negative control:** repeat (b) but build ROM 2 from the *unmodified* (non-reordered) project — assert
    Continue **succeeds** this time (`GAME_STATE === ST_GAMEPLAY`), proving the refusal in (b) is
    specifically caused by the reorder's token redraw and not by some unrelated build nondeterminism.
    *Sabotage it would catch:* the entire class of bug finding 1 exists to prevent — an implementation
    that never adds `saveCompatToken` at all (or adds it but never redraws it, or redraws it but never
    folds it into `saveIdentity`) fails (a) immediately (the two `saveIdentity` values would be equal) and
    (b) conclusively (Continue would wrongly succeed). The negative control (c) additionally catches an
    implementation that redraws the token on *every* build regardless of whether a qualifying edit
    occurred (which would also break property (b), §6.10) — such a bug would make (c) fail too, refusing
    a save that never should have been invalidated.

21. **Undo-then-different-reorder cartridge test — the reviewer's own counterexample, run for real, and
    made deterministic (new — Fix round 2, finding 1's central demand; reworked — Fix round 3, finding 6,
    which found the original version's own collision handling — "retry the draw once" — was itself
    unsound).** **Round 2's own version is corrected here, not merely re-described**: asserting
    `t2 !== t1` against two genuinely random draws is inherently a probabilistic assertion (the very
    `1/65535` risk §6.10 documents), and "retry the draw once on collision" does not fix that — a retry
    draws a value for a *different*, hypothetical redo of the same commit, not the value the actual
    structural commit under test produced, so asserting against the retried value no longer tests what
    the real history did; and if the retry *also* collided, the test would still be probabilistic, only
    twice as unlikely to expose it. **The fix: control `Math.random` for the exact history under test**
    (the same mocking approach test 26 uses), so both draws are known in advance and provably distinct
    by construction — no retry, no residual probabilism anywhere in this test. The exact history the
    review names: build a save-enabled, three-map fixture (`[A,B,C]`); with the mock queued to return a
    first known value, reorder to `[B,A,C]` — assert the resulting `saveCompatToken` equals the mocked
    draw's own known value, call it `t1`; build ROM 1, boot it, save a game on map B (`touchSaver`);
    capture the SRAM. Apply `store.undo()` to the *project* (not the ROM), restoring `[A,B,C]` and
    `saveCompatToken` to its pre-reorder value; assert this restoration happened. With the mock now
    queued to return a **second, different known** value, perform a **different** reorder, to `[C,A,B]`
    — assert the resulting token equals that second known value, call it `t2`, and that `t2 !== t1` by
    construction of the two queued mock values (a fact known before the test runs, never a runtime
    coincidence). Build ROM 2 from `[C,A,B]`, boot it, load the SRAM captured from the `[B,A,C]`/B-save
    above, attempt Continue, and assert `GAME_STATE === ST_TITLE` — refused. This is the test round 1's
    single linear test 20 could not exercise at all, and is exactly the shape the review's own finding 1
    demands: an undo branch followed by a genuinely different structural edit, now run exactly and
    non-flakily while the *production* policy (real `Math.random`, no mock) remains explicitly
    probabilistic, per §6.10's own honest accounting — this test's own use of a controlled source proves
    the mechanism's *logic* is correct; it does not, and is not meant to, alter the real collision risk
    real play carries.
    *Sabotage it would catch:* round 1's own mechanism precisely — a monotonic `+= 1` counter reset to 0
    by undo and incremented back to the identical value `1` by any subsequent reorder, regardless of
    which one. That implementation passes test 20 (a single linear reorder) in full and fails only here,
    on the undo branch, which is exactly the gap the review's finding 1 exists to close and round 1's
    plan could not see. The deterministic rework additionally catches an implementation whose redraw
    ignores the injected/mocked source entirely (e.g. reading a module-cached `Math.random` reference
    captured before the mock was installed) — the "assert the resulting token equals the mocked draw's
    own known value" checks would fail immediately, which a bare `t2 !== t1` inequality check never
    could have caught on its own.

22. **The real reference audit, decoupled from screen count (new — Fix round 2, finding 4).** Three
    fixtures against `auditDroppedReferences` directly (no UI, no commit): (a) delete a map containing
    five screens with **zero** incoming references from elsewhere in the project — assert the audit
    reports `0`, not `5`; (b) delete a map containing **one** screen with **ten** distinct doors/warps
    from surviving screens and common events targeting it — assert the audit reports `10`, not `1`; (c)
    a reference whose *own* screen is inside the discarded map (i.e., it is leaving with its own screen,
    not being redirected) — assert it is excluded from the count entirely, neither inflating nor
    (via some double-counting bug) being counted twice. Repeat (a)/(b) against Resize-shrink's own
    `discardedScreens` set.
    *Sabotage it would catch:* round 1's own category error exactly — counting `before.filter((_, i) =>
    dryTranslate(i) === DROPPED_SCREEN).length`, which is a count of deleted *screens*, not redirected
    *references*. Fixture (a) and (b) are chosen specifically to make the two numbers disagree (5 vs. 0,
    1 vs. 10) so no implementation computing the wrong thing can coincidentally pass either.

23. **Forced width-grow single-screen duplicate — self/external doors and nested Warps across a real
    relocation (new — Fix round 2, finding 2's own explicit fixture demand).** A 2×2 map; the source
    screen is placed on **row 1** (per-map index 2 or 3), not row 0 — chosen deliberately so the grid's
    forced width-grow (per §6.9's own worked trace) is guaranteed to relocate the source screen to a new
    per-map/flat position, unlike a row-0 source or a height-only grow, either of which could leave every
    index unchanged and hide the defect the review names behind coincidence. The source carries: a
    self-door (targeting its own screen), an external door (targeting a screen on a different map), a
    top-level `warp` targeting itself, a `warp` inside a `branch`'s `then` targeting the external map, and
    a `warp` inside a `choice` option targeting itself again. Duplicate this screen via grid growth.
    Assert: every self-referential reference in the **clone** points at the clone's own new flat position,
    not the original's (wherever the original was relocated to by the same operation); every external
    reference in the clone is unchanged in *content* (resolves to the same external screen); the
    **original** source screen's own self-references correctly follow *it* to its own new position
    (proving the ordinary `growOrShrinkMap` walk still worked correctly on the untouched original,
    unaffected by the clone's presence); and `project.project.saveCompatToken` changed (§6.9's own
    resolution: growth-routed duplicate redraws it).
    *Sabotage it would catch:* precisely the defect the round-2 review traced by hand — an implementation
    that runs the clone's own operands through the generic `flatTranslate` (or applies
    `rewriteClonedRange`'s old-range-containment test, built for the append case, unmodified) instead of
    the dedicated `buildCloneTranslate`. Such an implementation resolves the clone's self-door through the
    generic translate, which correctly answers "where did old-target-2 go" — the *original* source
    screen's new position — and wrongly leaves the clone pointing at the original instead of itself. A
    row-0 or height-only fixture would let this exact bug hide behind a coincidence where old and new
    per-map indices happen to match; this fixture is chosen specifically to rule that out.

24. **Decoder corpus round-trip — every real opcode, encode then decode, one build, on a pinned *valid*
    project (new — Fix round 3, finding 1; corrected — Fix round 4, findings 2 and 3).** No reorder, no
    second build — this test isolates the decoder's own correctness from the reorder-semantics question
    tests 6/7 already cover.

    **The fixture, pinned as a concrete valid project (Fix round 4, finding 3 — round 3's version never
    said what project the corpus lived in, so a fixture could "cover" an opcode while only ever
    exercising its sentinel/failure encoding).** An RPG on MMC1 (RPG-capable and save-capable in one
    choice, so Join/Battle and Save are all reachable from a single mapper pick — `shared/project.js:
    3423-3559`, `:3567-3603`), with: an effective title screen (Save's own requirement); one recruited
    party member (Join's requirement); one real, in-range monster actor (Battle's requirement,
    `shared/project.js:3423-3559`); one real item (Give/Take's requirement, `:3822-3842`); **two**
    distinguishable short songs and **two** distinguishable short SFX entries, each at most 255 frames
    (Sting/SFX's requirement, `:3851-3919` — widened from one each to two, Fix round 5, finding 3, so the
    corpus can target a *nonzero* catalog entry rather than the one index a hardcoded-to-0 implementation
    would also satisfy); and **two** live common events (Call's requirement, `:3953-3971` — likewise
    widened from one to two, for the identical reason applied to Call's own table slot). **Before
    compiling, assert `validateProject(project)` reports zero errors** — the fixture must be legal on its
    own terms, not merely "big enough to host every opcode," so a corpus that silently exercises a
    sentinel/failure path instead of the real one (an unresolved Sting, a dangling Call) is caught by
    this assertion before the decoder is ever trusted to say anything about it.

    One event, one page, authoring in this order: `say` (a specific, known dialogue string — Fix round 5,
    finding 3, needed for the new explicit content assertion below), `give`, `take`, `setSwitch`,
    `clearSwitch`, `setVar`, `addVar`, `subVar`, `heal`, `damage`, `save`, `move`, `turn`, `wait`,
    `shake`, `visible`, `fade`, `flash`, `join`, `call` (targeting the **second** of the two live common
    events, not the first — Fix round 5, finding 3, so its own slot is provably nonzero), `music`, then a
    `route` with two legs (a `move` and a `turn`, distinct authored values from any standalone
    `move`/`turn` earlier in the corpus, so a decode that accidentally reused the wrong entry's values
    could not pass by coincidence), then `sting` (targeting the **second** of the two songs — Fix round 5,
    finding 3), then `sfx` (targeting the **second** of the two SFX entries, same reason), then `battle`
    with fewer than `RPG_LIMITS.monstersPerBattle` monsters authored (so the `NO_ACTOR`-padding is
    genuinely exercised, not just the fixed width), then a `branch` whose `then` contains a `warp`
    (targeting a real, in-range, *specific and known* screen — Fix round 5, finding 3, needed for the new
    explicit target assertion below) and whose `else` contains a `choice`, the `choice` itself holding two
    options — one with an empty `commands` list (a legal, zero-length nested body — the minimal case for
    the corrected `recordLength - 2` arithmetic) and one containing a further, nested `choice` (recursion,
    two levels deep). `compileText` the project once; run `decodeEvent` on the resulting bytes.

    **Assertions, corrected per Fix round 4, finding 3, and further completed per Fix round 5, finding
    3 — "raw equals authored value exactly" is only asserted for commands whose compiled byte genuinely
    *is* a direct, unresolved pass-through of the authored number (`give`/`take`/`setSwitch`/
    `clearSwitch`/`setVar`/`addVar`/`subVar`/`heal`/`damage`/`wait`/`shake`/`join`/`music`, all confirmed
    against `encodeCommand`'s own cases to perform no lookup and no resolution — a raw clamp of an
    already-legal authored value is the identity function). Every other command gets its own explicit
    assertion, in the form its own decoded shape actually returns:**
    - `say`: **not a `raw` form at all — a decoder-resolved `{ text }` (Fix round 5, finding 3, closing
      the exact gap the review names: round 4's catch-all wrongly implied `say` had raw bytes to
      compare).** Assert the decoded `text` equals the authored dialogue string's own content exactly.
    - `warp`: **likewise not a `raw` form — a decoder-resolved `{ target, x, y }`.** Assert the decoded
      `target` is the *screen object* the authored, known target screen resolves to (via `flat[...]`, the
      same object-identity tracking every other test in this plan uses), and `x`/`y` equal their authored
      values directly (both are plain clamped numbers, never resolved through anything).
    - `move`/`turn`: assert the decoded `who`/`dir` bytes equal `MOVE_TARGETS.findIndex(e => e.id ===
      command.who)`/`MOVE_DIRECTIONS.findIndex(e => e.id === command.dir)` — the exact resolution
      `encodeCommand` itself performs, computed independently through the same authoritative arrays
      (`shared/project.js`), never compared to the authored string id directly.
    - `visible`: assert the decoded `state` byte equals `VISIBLE_STATES.findIndex(e => e.id ===
      command.state)`, the identical resolution.
    - `fade`: assert the decoded `dir` byte equals `FADE_DIRECTIONS.findIndex(e => e.id === command.dir)`.
    - `call`: **strengthened, Fix round 5, finding 3 — "not `NO_COMMON_EVENT_SLOT`" alone let a decoder
      hardcoded to slot `0` pass against a single-common-event fixture.** With two live common events
      authored and the corpus's own `call` targeting the second, assert the decoded slot equals
      `liveCommonEvents(project).findIndex(e => e.id === secondCommonEvent.id)` — the identical ordered
      list `compileText` itself assigns slots from (`textcompile.js:183-207`), computed independently
      through that authoritative function rather than the raw authored common-event id (a different id
      space entirely; the wire byte is a *position* in the compiled events table) — and separately assert
      that resolved slot is **not** `0`, so a hardcoded-to-the-first-slot implementation cannot pass by
      coincidence.
    - `sting`/`sfx`: **strengthened, Fix round 5, finding 3 — a single catalog entry each let an
      implementation hardcoded to index `0` pass, and deriving duration from the *decoded* index (rather
      than the authored one) made the duration check circular.** With two distinguishable songs/SFX
      entries authored and the corpus's own `sting`/`sfx` targeting the second of each, assert the decoded
      index equals `songByte(project.songs, command.song)` / `sfxByte(project.sfx, command.sfx)` —
      computed from the **authored** `command.song`/`command.sfx` field, the exact function
      `encodeCommand`'s own cases call, never re-derived from whatever index the decoder happened to
      return — and separately assert that resolved index is **not** `0`. Duration is asserted against
      `Math.min(songFrameLength(project.songs[songByte(project.songs, command.song)]), 255)` (and the
      equivalent `sfxFrameLength` call) — indexed through the same **authored**-target resolution, never
      through the decoded value, so a decoder that returns a wrong-but-plausible index cannot coincidentally
      "pass" a duration check that was quietly validating itself.

    Every other simple op's decoded `raw` bytes are asserted to match its own authored values exactly, in
    order — valid for these because, per the paragraph above, their own compiled byte never resolves
    through anything but a direct clamp. The route's two legs decode as ordinary `move`/`turn` entries
    (not a `route`-shaped form — §7 item 2's own note on why no such case exists) with the *route's*
    authored values (resolved through the identical `MOVE_TARGETS`/`MOVE_DIRECTIONS` lookup as any other
    move/turn), distinguishable from the standalone `move`/`turn` earlier in the corpus; `battle` decodes
    with exactly `RPG_LIMITS.monstersPerBattle` raw bytes, the unauthored slots equal to `NO_ACTOR`, the
    authored slot equal to the real monster actor's own id; the `branch`/`choice`/nested-`choice`
    structure decodes with the exact nesting shape authored, including the zero-length option body **and**
    — Fix round 4, finding 2 — each option's own decoded `past` value verified against
    `records.slice(i+1).reduce((sum,r) => sum + 1 + r.recordLength, 0)`, per §7's own corrected decoder;
    and `decodeEvent` returns normally (no thrown "exact consumption," "unknown opcode," or "expected
    OP_JUMP"/`past`-mismatch error) — proving every opcode's width correctly accounts for the one
    immediately following it, all the way to the terminator, rather than merely "looking plausible" on a
    corpus that never exercises the exceptional widths together.
    *Sabotage it would catch:* precisely the defects the round-3 and round-4 reviews found by hand — a
    decoder using `recordLength` instead of `recordLength - 2` for a Choice option's body would either
    throw (attempting to decode `OP_JUMP`/`0xFE` as a command) or desynchronize silently and corrupt every
    opcode after the first Choice in the corpus, including the deliberately-placed nested nested-choice
    and everything a fresh test 7-style fixture might place after it; a decoder using the generic
    `1 + args.length` rule for `sting`/`sfx`/`battle` desynchronizes starting at the very next byte after
    whichever of those three appears first in the corpus, corrupting every subsequent op's decode — this
    fixture places multiple exceptional opcodes with real structure both before and after each other
    specifically so no single narrow fix could pass it by accident. A decoder that consumes but never
    validates the Choice `past` byte passes even if every non-final option carries `past = 0` — invisible
    to every other assertion in this test, since the nested bodies and exact-consumption checks stay
    green regardless of `past`'s own value; the new independent verification catches it directly, on
    exactly the two-option shape this fixture already authors, one option's own `past` provably nonzero
    (the size of the record after it) and the last option's provably zero. A fixture that authors an
    unresolved Sting/dangling Call/invalid actor "to save the trouble of making it real" fails the
    `validateProject`-zero-errors assertion immediately, before the decoder is ever consulted — closing
    the "the corpus can appear to cover an opcode while only exercising its failure encoding" gap
    directly. An implementation that compares Move/Turn/Visible/Fade/Call's own wire bytes to their raw
    authored id — a plausible-looking mistake, since it "worked" for every other simple op in this same
    corpus — fails on the very first categorical assertion, since an authored string id and a resolved
    array-position byte are never the same value except by coincidence. **The Fix round 5, finding 3
    strengthenings each catch their own, otherwise-invisible bug:** a decoder that returns `say`'s raw
    string id instead of its resolved text, or `warp`'s raw screen byte instead of its resolved object,
    would have silently passed the old catch-all (which never actually inspected either shape) and now
    fails on its own dedicated assertion; a `call` implementation hardcoded to slot `0` regardless of
    which common event was actually named passes a one-common-event fixture by construction and only
    fails once a second one exists and the corpus deliberately targets it, which this fixture now does; a
    `sting`/`sfx` implementation hardcoded to catalog index `0`, or one that derives duration from its own
    (possibly wrong) decoded index rather than the authored target — passing a duration check that was
    quietly validating itself against its own error — both fail once two catalog entries exist and
    duration is independently re-derived from the authored field alone.

25. **Add Map keeps a pre-existing out-of-range operand's effective target — the Add-specific variant of
    test 4 (new — Fix round 3, finding 2).** A three-screen project (one map), one door with
    `props.toScreen = 255` (effective target: screen 2, the map's own last screen) and one `warp` command
    nested inside a `branch`'s `then`, also `255`. Call `addMap()` (now four screens total across two
    maps, `screenCount` grown by one). Assert both the door's `props.toScreen` and the nested warp's
    `command.screen` are now the literal number `2` — their own already-resolved, pre-edit effective
    target — and specifically **not** `3` (the new map's own single screen, which is what re-clamping
    `255` against the *new*, larger `screenCount` would silently produce). A second fixture confirms no
    `saveCompatToken` redraw occurs for Add Map (§6.2's own stated policy — `screenCount` already moves).
    **A third fixture, added by this round's own self-check exercise below:** two maps, `["Dungeon",
    "Map 1"]`; delete `"Dungeon"` (one map remains, `"Map 1"`, at array length `1`); call `addMap()`;
    assert the new map's name is **not** `"Map 1"` (the literal collision `Map ${project.maps.length}`
    would produce, since length is back down to `1`) but a name distinct from every existing map's, per
    `nameForNewMap`'s own scan.
    *Sabotage it would catch:* the exact gap the round-3 review names directly by citation — Add Map's
    real, shipped handler (`map.js:1474-1478`), which is a bare `project.maps.push(...)` with no
    canonicalizing pass at all. Test 4 alone cannot see this bug, since it only ever exercises
    duplicate-append; this fixture drives Add Map specifically, and fails immediately against the
    unfixed handler, on both the door and the nested-warp assertion.

26. **The draw-site census — exactly one redraw per qualifying commit, zero for every non-qualifying one
    (new — Fix round 3, finding 6; widened to ten fixtures — Fix round 4, finding 1).** Controls
    `Math.random` directly for the duration of the test (e.g.
    `t.mock.method(Math, 'random', () => queue.shift())` with a pre-seeded queue of distinct fractional
    values, Node's own built-in test-mocking facility — no change to `drawSaveCompatToken`'s own
    signature is needed, since it already reads the global `Math.random` internally) so every call is
    both counted and individually distinguishable. Ten fixtures, one per operation named in §6.10's own
    policy: **qualifying** (assert the mock was called **exactly once** during the commit, and that the
    resulting `saveCompatToken` equals the mocked draw's own known value) — reorder (§6.7), delete map
    (§6.8), grow-resize (§6.9), shrink-resize (§6.9), growth-routed single-screen duplicate (§6.9.1);
    **non-qualifying** (assert the mock was called **zero** times, and `saveCompatToken` is unchanged
    from its pre-commit value) — append-only whole-map duplicate (§6.2), Add Map (§6.2, this revision),
    a folder-name edit (§8), a region paste (§6.3), and — **the tenth fixture, added this revision, Fix
    round 4's own missing branch** — duplicate-screen-into-a-brand-new-map (§6.2.1), the all-maps-full
    fallback, an append like whole-map Duplicate and Add Map and therefore covered by the identical
    "screenCount already moves" argument, never separately asserted until now.
    *Sabotage it would catch:* an implementation that omits the redraw call on Delete or ordinary
    (non-duplicate-routed) Resize specifically — round 2's own finding 6 names this exact gap: both
    operations already change `screenCount`/`mapCount`, so `saveIdentity`'s own output already differs
    without the token's help, meaning no test that only inspects `saveIdentity`'s final value (rather
    than the token/draw-count directly) could tell a uniformly-applied policy apart from one that quietly
    skips these two "already covered" cases — exactly the fragile reasoning §6.8's own text argues
    against relying on. This test observes the draw site itself, not merely a downstream effect it could
    coincidentally share with a different cause. It also catches a token implementation that redraws on
    *every* commit indiscriminately (append/Add Map/folder/paste/fallback-duplicate included) — a bug the
    five "non-qualifying, zero draws" fixtures fail directly, independent of and complementary to test
    20(c)'s own negative control.

27. **The every-map-4×4 fallback fixture — the reviewer's own scenario, reached by calling
    `duplicateScreenIntoNewMap` directly, a unit/operation-level test (new — Fix round 4, finding 1;
    strengthened — Fix round 5, findings 1-2).** **This is a unit/operation test of §6.2.1's own
    function, not a real-window test** — corrected this revision, per the review's own finding 2: round
    4's text twice called this "the real duplicate-screen UI path," which overstates what a direct
    function call proves; real UI routing (does the button reach this operation at all, among the other
    two branches) is the separate smoke case's own job (§12), not this test's.

    Build a project where **every** existing map is already at its `4×4` ceiling
    (`gridW * gridH === LIMITS.mapGrid ** 2`, so neither §6.2's step 1 — grow the current map — nor step
    2 — grow a different map — has anywhere left to place the duplicate). Give the source screen a
    **non-empty name** (`"Boss Room"`, say — Fix round 5, finding 2: round 4's fixture never stated one,
    so the fixture could never actually exercise `nameForDuplicateScreen`'s own non-empty branch). Author,
    on the source screen: a self-door and an external door (targeting a screen on a different, also-full
    map); a **top-level** `warp` targeting itself and a **top-level** `warp` targeting the external map;
    and a `branch` whose `then` contains a **nested** `warp` targeting itself and whose `else` contains a
    **nested** `warp` targeting the external map — four Warps in total, two self and two external, one of
    each at the top level and one of each nested (Fix round 5, finding 2: round 4's own fixture authored
    only a top-level self-Warp and a nested *external* Warp, then claimed to assert "both nested-warp
    self-references," which do not exist in that fixture — corrected here to actually author and assert
    all four). This reuses the identical self/external/nested-warp shape test 23's own forced-width-grow
    fixture already uses, so the two tests remain directly comparable in what they prove about their
    respective paths. Also place, elsewhere in the project, one door and one nested warp already pointing
    *at* the source screen (an incoming reference, to prove the original stays reachable), and one door
    elsewhere with an out-of-range stored value (`255` in a project whose pre-append flat count makes its
    effective target some specific, known screen). Call `duplicateScreenIntoNewMap(sourceScreen)` — on
    this fixture the operation is the only one that could ever apply, since nothing has room to grow.

    Assert, all in one fixture:

    - The new map is genuinely `1×1` (`gridW === gridH === 1`, one screen).
    - Its `tilesetId`/`songId`/`battleSkyTile`/`battleGroundTile`/`encounters`/**`folder`** (Fix round 5,
      finding 1 — omitted from round 4's own assertion list) equal the *source map's* own values, not
      `createMap`'s generic defaults.
    - The new map's own name is `nameForNewMapFromSource`'s own output (collision-checked against every
      existing map, not merely `${source.name} copy` asserted blindly — a second, differently-named
      existing map already claiming that exact string is part of the fixture, forcing the ` copy 2`
      branch).
    - **`cloneScreen.name` equals `"Boss Room"` exactly (Fix round 5, finding 2)** — the source screen's
      own non-empty name, carried into the new map's own (always-empty) namespace unsuffixed, proving
      `nameForDuplicateScreen` was actually called and actually asked to do something, not merely present
      in the code path unexercised.
    - Each of the four Warps individually: the top-level self-Warp and the branch-`then` nested self-Warp
      both resolve to the *clone's* own (singleton) flat position; the top-level external-Warp and the
      branch-`else` nested external-Warp both resolve, unchanged in content, to the same external screen
      the original's do.
    - The self-door resolves to the clone's own position; the external door resolves, unchanged, to the
      same external screen.
    - The pre-existing incoming door/warp (aimed at the source screen from elsewhere) still resolves to
      the *original* screen's content, untouched.
    - The pre-existing out-of-range door's stored value now equals its own pre-append effective target
      (canonicalized, not redirected to the new map's own screen — the identical claim test 4/25 already
      make for the other two append sites, proven here for the third).
    - `project.project.saveCompatToken` is unchanged from its pre-commit value (no draw — append, per
      §6.2.1's own stated policy).
    - **No aliasing (Fix round 5, finding 2):** `cloneScreen !== sourceScreen`, and — the stronger,
      behavioral proof, not merely a reference-inequality check a shallow copy could still pass — mutate
      one of the clone's own entities after duplication (move its `x` by one pixel, say) and assert a
      pre-duplication snapshot of the *source* screen's matching entity is unaffected; `newMap.encounters`
      is `assert.deepEqual` to `sourceMap.encounters` in content but **not** the same object reference
      (`newMap.encounters !== sourceMap.encounters`), so a later edit to one's `actorIds` array cannot
      silently mutate the other's.

    *Sabotage it would catch:* every one of the concrete gaps the review names by construction — an
    implementation that creates the new map with `createMap`'s own bare defaults (fails the metadata
    assertion, `folder` included); one that names it something other than the collision-checked
    `nameForNewMapFromSource` output, or skips the collision check entirely (fails the naming assertion,
    specifically on the forced ` copy 2` branch); one that clears every cloned screen's name regardless of
    source (fails the `cloneScreen.name` assertion directly, a gap round 4's own fixture could not have
    seen at all); a "fallback-specific walker" that only ever handles the top-level self-Warp — plausible
    precisely because round 4's own fixture never authored a nested self-Warp to catch it — fails on the
    branch-`then` nested self-Warp assertion specifically; one that runs the clone's own operands through
    the generic append-canonicalizing translate alone, without the dedicated self/external split
    `rewriteClonedRange` provides (leaves the clone's self-references aimed at the original — the
    identical class of bug test 23 already proves for the growth path, now proven independently, on all
    four Warp shapes, for the fallback path); one that aliases `newMap.encounters` to the source's own
    object, or reuses the source screen object outright, initially satisfying every equality assertion and
    only failing once something is edited — caught directly by the aliasing checks, not left to a later
    editing session to discover; and one that redraws `saveCompatToken` on this path (fails the final
    assertion, and — per test 26's own tenth fixture — is independently caught there too).

**The "wrong implementation that passes every test" exercise, re-run against this revised plan (Fix
round 1, finding 9's own explicit demand):** The most complete plausible failure that survives every
test above: an implementation that gets §6.1-§6.9's mechanism exactly right, adds `saveCompatToken` and
redraws it correctly on reorder/delete/resize, but implements the **Resize Map retrofit's per-map
translate using flat-space indices instead of per-map ones** — i.e., it correctly rewrites project-wide
doors/warps via `buildResizeTranslate` (so test 19's own "every door/warp elsewhere resolves to the same
content" clause passes), but for the `startScreen`/`titleScreen` fixup specifically, it reuses
`flatTranslate` (the project-wide flat-space translator) instead of `perMapTranslate` (§6.9's own
per-map-scoped one) — passing a *flat* index where a *per-map* index is expected. On a map that happens
to be the **first** map in `project.maps` (flat base 0), flat-space and per-map-space coordinates are
numerically identical for every screen in that map, so this bug is invisible on any fixture where the
resized map is the first one — **which every fixture in test 19 as specified above happens to be**,
since neither this design's own §6.9 pseudocode nor test 19's description pins the resized map's
position in `project.maps`. The fix, recorded as a requirement on the *test*, not the design (§6.9's own
mechanism is correct as specified — `perMapTranslate` is genuinely per-map, built from `oldScreens`/
`newScreens`, never from `flatScreens`): test 19's fixtures must place the resized map **second or later**
in `project.maps` (nonzero flat base), so a flat-space/per-map-space confusion produces a *visibly wrong,
in-range* value distinguishable from the correct one — the identical "a range-only or coincidentally-
correct assertion would miss this" discipline every sabotage note above already applies to the design
itself, turned back on the test plan one level up. This is recorded here as a binding correction to
test 19's own fixture requirements, not a new numbered test.

**The exercise, re-run a second time against this revision's full plan (Fix round 2, finding 9's own
demand — a genuinely new pass, not a restatement of round 1's finding above, which stands unchanged):**
the most complete plausible failure that survives every test above, including the new tests 21-23: an
implementation that gets `drawSaveCompatToken` and every one of §6.7-§6.9's redraw call sites correct,
but implements `normalizeProject`'s own clamp on the stored field as `Number.isInteger(...) &&
raw.project.saveCompatToken >= 0` — the **lower**-bound half of §6.10's own schema rule — while omitting
the **upper** bound (`<= 0xFFFF`) entirely. Every test in this plan constructs its fixtures by *drawing*
tokens through the normal edit path (`drawSaveCompatToken`, always in range by construction) or by
reading an in-memory project object directly, never by round-tripping a hand-authored, out-of-range
value through `normalizeProject` itself — so no test as specified would ever exercise the missing
half of the clamp, and this omission reintroduces exactly the "value 1 and value 65537 fold identically"
hole finding 1 names explicitly, reachable the moment a hand-edited or foreign-tool-authored project
file carries a `saveCompatToken` above `0xFFFF` (nothing else in this schema forbids a project file from
being loaded from outside the Map Forge's own UI, per this repository's own "buildProject is handed
whatever the app is holding" caution, cited throughout this design). **Closed here, in the test plan
itself, rather than left as a residual gap:** test 20(a) is widened with one more assertion —
hand-construct a raw project object with `project.project.saveCompatToken = 0x10001` (65537), run it
through `normalizeProject`, and assert the normalized result's `saveCompatToken` is `0` (out of range,
falls back to the "no qualifying edit" default) rather than `65537` or `1` (its own `& 0xffff` alias).
This is the identical shape round 1's own self-check finding took — a real gap, found by re-running the
exercise honestly against the finished plan rather than assuming completeness, closed by amending the
one test whose fixture was missing exactly the case that would have caught it, not by inventing a new,
separately-numbered test for a single assertion that belongs beside the schema rule it verifies.

**The exercise, re-run a third time against this revision's full plan (the brief's own explicit demand
for round 3) — a genuinely new pass, not a restatement of either finding above, both of which stand
unchanged.** This pass turned up a real gap **adjacent to**, not inside, the mechanisms round 3's own
seven findings targeted directly — worth stating honestly, since it is a softer finding than the
previous two self-checks (it produces an author-visible warning on the next `validateProject` pass
rather than a silent, undetectable corruption, but was still genuinely unguarded and untested).
**Add Map's own naming, copied verbatim from the real shipped handler
(`` `Map ${project.maps.length}` ``), collides with an existing map's name after a Delete**: two maps,
delete the first, and `project.maps.length` returns to `1` — the exact same number the *surviving*
second map was itself named from when it was created, so the next Add Map produces a second map named
identically to the first. None of tests 1-24 exercises Add Map's own naming at all (test 25, as
originally drafted for this round, only ever checked the canonicalization fix, never the name), and
§4.3's own duplicate-name warning (§9) — while it *would* eventually flag the resulting collision on the
next validate pass — is not itself a design defect this exercise is looking for; the gap is that nothing
in this design *prevented* an entirely avoidable collision the same way `nameForDuplicateScreen` already
prevents the identical class of collision for a duplicated screen. **Closed directly, not left
residual:** §6.2's `addMap()` now calls a new `nameForNewMap(existingMaps)` helper (scanning for the
first untaken `Map N`, the identical discipline `nameForDuplicateScreen` already applies one level over),
and test 25 gains a third fixture proving the specific delete-then-add collision is avoided. This is the
same "find it, fix it in the plan itself, say so plainly" discipline both earlier self-check passes
already established, applied a third time rather than assumed to no longer be necessary now that the
mechanism has been through two prior rounds of scrutiny.

**The exercise, re-run a fourth time against this revision's full plan (the brief's own standing
demand) — a genuinely new pass, not a restatement of any finding above, all of which stand unchanged.**
This pass found a gap in the identical shape round 3's own finding 5 (the audit-UI wiring) already
established, applied to §6.2.1's new fallback instead of the audit helper: **test 27 proves the
fallback's own mechanism is correct, entirely at the unit level — nothing in this plan drives the real
Map Forge UI into the all-maps-full scenario and confirms the "Duplicate screen" control actually
*routes* to it.** An implementation could ship `duplicateScreenIntoNewMap` exactly as specified, pass
test 27 in full (since that test calls the mechanism directly, or via a UI path this plan never
specifies precisely enough to distinguish from a direct call), and still have the *real* button's own
fallback-detection logic — "is every map already `4×4`?" — wired wrong: checking the wrong map, checking
`>=` when it should check `===`, or simply never reached at all because an earlier branch's own "room to
grow" check has an off-by-one that always claims room exists. None of this plan's other UI coverage
would catch it, since every other smoke case for Duplicate (§12) exercises the ordinary, room-to-grow
path, never the all-maps-full one specifically. **Closed directly:** a new smoke case (below) builds a
real project where every map is genuinely `4×4`, drives the actual "Duplicate screen" control through the
real window, and asserts a new, `1×1` map appears in the map picker with the expected name — proving the
UI reaches §6.2.1's own operation, not merely that the operation is correct in isolation, the same
distinction round 3's own finding 5 already drew for the audit helper.

**Smoke coverage** (`main/smoke.js`, extending the existing Map Forge section that already resizes a
map and asserts the navigator's screen count, `main/smoke.js:97-161`): drive an actual Add Map → rename
→ reorder (via whatever drag/button UI §12 settles on) → assert the map picker's `<select>` options
reflect the new order **and** — Fix round 1, finding 9's own explicit demand, since a `<select>`-order
check alone passes for an implementation that reorders the UI and never repairs a single reference —
place a door on one of the two reordered maps before reordering, note which map (by name) it led to,
reorder, then use the Map Forge's own door-target picker to read the door's *current* target back out
and assert its label still names the same map by name, not merely that some option is selected; drive a
Duplicate Map button and assert the map count increased and the new map's name is visibly auto-suffixed;
drive a region copy/paste via the actual canvas interaction and assert the destination screen's rendered
thumbnail changed; set a map's folder field, reload the project (closing and reopening it in the running
window, the real-window equivalent of unit test 16(b)'s `saveProject`/`loadProject` round trip), and
assert the map picker's folder-prefixed labels still reflect the folder after reload, **in
`project.maps`' own order** — not merely that a folder grouping exists, which round 1's smoke plan would
have accepted from a regrouped `<optgroup>` too.

**The interleaved-folder reorder case (new — Fix round 2, finding 7's own explicit demand).** Create
three maps, `[A(folder X), B(folder Y), C(folder X)]`; assert the picker reads, in order, `[X] A`,
`[Y] B`, `[X] C` — the `[X]` label genuinely repeating, non-adjacent, never grouped together. Swap B and
C via the reorder control (§12), producing `[A(X), C(X), B(Y)]`; assert the picker now reads `[X] A`,
`[X] C`, `[Y] B` — the **visible order actually changed** to show the two X-folder maps now genuinely
adjacent, proving the display tracks `project.maps`' real order rather than a `<optgroup>`-style
regrouping that could have looked identical before and after the swap (the exact failure the review's
own worked example describes). This is the one smoke case round 1's plan had no equivalent of at all —
its own reorder smoke case used ungrouped maps, so a folder-hiding regroup could have shipped invisibly
behind it.

**The audit-UI wiring case (new — Fix round 3, finding 5).** `auditDroppedReferences` (§6.4) is proven
correct in isolation by unit test 22, but nothing in round 2's plan ever opened the real confirmation
dialog that is supposed to *display* its count — an implementation could ship the correct, unused helper
alongside an unchanged Delete Map confirmation (or one that displays the removed-*screen* count instead)
and pass every test proposed so far. Two real-window cases, both dialogs:

- **Delete Map.** Build a disagreement fixture — a two-screen map about to be deleted, with **zero**
  screens of its own holding incoming references but **three** doors/warps elsewhere in the project
  targeting into it (so the screen-count and reference-count numbers genuinely disagree, `2` vs. `3`,
  the identical discipline test 22's own fixtures already use to make the two numbers distinguishable).
  Open the real Delete Map confirmation through the actual button. Assert the dialog's own displayed
  text names `3` — the incoming-reference count — never `2`, the screen count. Click Cancel. Assert no
  commit occurred: `project.maps` still has its original length, and no door/warp anywhere changed.
- **Resize (shrink).** An analogous disagreement fixture for a shrinking resize — screens about to be
  dropped by the row/column-preserving rebuild, with a reference count that disagrees with the dropped-
  screen count the same way. Open the real shrink confirmation (via the actual grid-size control).
  Assert the displayed count is the reference count. Click Cancel. Assert no commit occurred: the map's
  `gridW`/`gridH`/`screens` are unchanged, and no door/warp anywhere changed.

Both cases drive the real handler and the real dialog, not the pure helper — closing exactly the gap the
review names: a correct, unused `auditDroppedReferences` behind an unwired or wrongly-wired confirmation
passes every unit test in this plan and only fails here.

**The duplicate-screen UI routing matrix — all three branches, not just the all-full one (widened — Fix
round 4's own self-check finding; completed — Fix round 5, finding 4, which found the all-full case alone
does not prove the *other* two branches are reachable, only that this one is).** §6.2's own three-step
preference order (grow the current map; offer a target-map picker among another map with room; fall
through to §6.2.1's brand-new map) is a real UI branch, and each branch needs its own real-window case —
an implementation that wires "Duplicate screen" to `duplicateScreenIntoNewMap` **unconditionally**, for
every press regardless of whether room exists anywhere, would still pass an all-full-only case (nothing
about that fixture could tell "correctly reached the fallback" apart from "always goes straight to the
fallback"). Three cases:

- **Room-to-grow.** A project where the current map has room to grow (`gridW * gridH < LIMITS.mapGrid **
  2`). Drive the real "Duplicate screen" control. Assert: the *current* map's own grid grew (one more
  cell than before); the project's own map **count** is unchanged (no new map appeared) — the
  discriminating assertion against the always-fallback implementation, which would wrongly show a new
  map here.
- **Full, but another map has room.** The current map is already `4×4`; a *different* map is not. Drive
  the control. Assert: a target-map picker appears, offering (at least) the map with room; choosing it
  grows *that* map's own grid by one cell; the project's own map count is unchanged. This is the one
  branch neither test 23 (which forces growth directly, never exercising the picker's own appearance) nor
  any prior smoke case touches at all.
- **All-full.** Every existing map is genuinely `4×4`. Drive the control. Assert: a new map appears in
  the map picker; its grid is `1×1` (one screen, `gridW === gridH === 1`); its name is visibly derived
  from the source map's own name (the `nameForNewMapFromSource` suffix, not a generic placeholder); the
  project's own map count increased by exactly one.

Together, the three cases prove the UI's own branching genuinely discriminates all three outcomes, not
merely that the fallback endpoint is reachable in isolation — test 23 and test 27 each prove their own
endpoint is *correct*; this matrix is what proves the *button* chooses correctly among all three.

Per this repository's own stated precedent (the reviewer role's own briefing, and CLAUDE.md's
Testing section), Map Forge *control* behavior (does the button wire to the right handler, does the
picker show the right options) belongs in the real-window smoke test, not a fake-DOM unit test — a
`commandRow`-shaped "does the element exist" unit assertion cannot tell an `onchange` from an
`onchanged`.

## §12. The Map Forge UI

**Reorder.** Two up/down arrow buttons per map row in the map picker (`renderMapSettings`,
`map.js:1449-1509`, the same location Add/Delete Map already live) — swapping a map with its immediate
neighbor is `reorderMaps` (§6.7) called with a `newMapOrder` that swaps two adjacent old indices, the
simplest possible gesture that still needs the full mechanism (a real permutation, exercising
`translate` fully, not a degenerate no-op). A drag-to-reorder list is a strictly nicer version of the
identical operation and is not precluded by this design — the mechanism (§6.7) takes an arbitrary
permutation, so a richer gesture is a UI-only follow-up, not a design change.

**Duplicate.** A "⧉ Duplicate" button beside each map row (whole-map duplicate, §6.2) and, inside a
screen's own context (the screen thumbnail strip already rendered per map, `map.js` — exact location
TBD by whoever implements against current line numbers, since this design does not propose moving
existing UI), a "⧉ Duplicate screen" action that walks the three-step preference order in §6.2: grow the
current map if it has room; offer a target-map picker among any *other* map with room if the current one
does not; and — only when **every** map is already `4×4` — fall all the way through to §6.2.1's own
operation, with no further prompt (there is nothing left to choose between; a brand-new map is the only
remaining option, so this step commits directly rather than asking the author to confirm an outcome with
no alternative). **No "Replace a blank cell" control exists** — §6.2's finding 3 correction drops it
outright, so there is nothing here to name or gate behind a confirmation.

**Delete Map / Resize Map (retrofitted — Fix round 1, finding 7).** Delete Map's existing
`confirmModal` (`map.js:1492`) gains a second line naming the dry-run `droppedTargets.length` from
§6.4/§6.8, when nonzero: *"3 doors/warps that lead here from other maps will be redirected to the first
screen."* Resize Map's shrink direction gains an equivalent confirmation it does not have today (growing
never drops anything, so it needs none) — the identical dry-run pattern, sourced from §6.9's own
`buildResizeTranslate`.

**Copy/paste region.** A rectangle-select tool alongside the Map Forge's existing stamp/rectangle/fill/
picker tools (CLAUDE.md's own line, "The Map Forge already has stamp, rectangle, fill, picker, start
and actor tools"), Ctrl/Cmd-C / Ctrl/Cmd-V or explicit toolbar buttons, following the existing
clipboard's own UX precedent (`map.js:1099-1109`'s "Paste ⟨label⟩" button, only rendered when
`clipboardIsHere()`). A paste that crosses tilesets shows its returned warning (§6.2/§6.3) as an
ordinary `toast()` (`renderer/ui.js:60`, already used elsewhere in this Forge), not a persistent panel
entry — it describes a moment, not an ongoing project state.

**Folders (Fix round 2, finding 7 — round 1's `<optgroup>` regrouping is retracted; it hides exactly the
order Reorder edits).** Round 1 proposed grouping the map `<select>`'s `<option>`s under `<optgroup
label="...">` per distinct `map.folder` value. The review is right that this lies about structure: for
`[A(folder X), B(folder Y), C(folder X)]`, ordinary `<optgroup>` rendering shows every X-folder map
together (A, C) followed by every Y-folder map (B) — A, C, B — while `project.maps`' real, compiled
order is still A, B, C. Reordering B and C (a real structural edit with real reference consequences,
§6.7) can leave the *grouped* picker looking unchanged, while conversely two maps that are genuinely
adjacent in `project.maps` can render apart from each other if a differently-foldered map sits between
them. Since this design's own §8 explicitly declines to make folders a structural, order-affecting field
(sorting `project.maps` by folder would be exactly that — a real structural edit needing the full
remap machinery, which folders are deliberately not built to require), the picker must not fake an order
it does not have. **Decision: an ordered list, never regrouped — the cheaper of the two options the
brief names, and the one that costs no new machinery.** Each `<option>`'s own label is prefixed with its
folder when it has one (`folder ? `[${folder}] ${map.name}` : map.name`), but every `<option>`'s
position in the `<select>` stays exactly `project.maps`' own array order, always — for the fixture
above, the picker literally reads `[X] A`, `[Y] B`, `[X] C`, in that order, with the `[X]` label
*repeating* rather than the two X-folder maps being drawn together. This is honest by construction:
the DOM's own option order is the array's own order, so there is no separate "does the display agree
with the model" invariant to maintain or accidentally break. A fancier alternative — visually grouping
only *already-adjacent* same-folder runs, never reordering to create adjacency that is not already there
— is a legitimate later polish (the brief's own second cheap option) but is not needed for correctness
and is not adopted here, to keep this slice's UI change minimal. Explicitly rejected: sorting
`project.maps` by folder on assignment, which the brief itself flags as a structural edit with reference
consequences that would need to route through §6's own remap machinery — folders stay display-only, so
this option is not taken. A folder-name field sits next to the map's own name field, same style as the
existing Name field (`map.js:1511-1525`); this part is unchanged from round 1.

**Named screens.** No new UI beyond §9's warning surfacing through the Build panel's existing problem
list (`checkCapacity`'s `problems` array, already rendered wherever `validateProject`'s output is shown
today).

**World overview: explicitly sliced out of this design.** Per the brief's own invitation ("It is
legitimate for the design to slice item 7 and declare the overview... a later slice"), and per the
concrete precedent found during research: `renderer/forges/map/eventlist.js`'s `buildEventIndex`
(§3 row 15) **already produces exactly the underlying data a visual overview would need** — every
placed actor's location, its door target, its event summary, its dialogue — as a live, searchable list,
today, shipped. A spatial/visual overview (a grid of map thumbnails with warp lines and event markers
drawn on top) is real, additive UI work with no backend design content of its own — it would consume
`buildEventIndex`'s exact rows (or a close variant) and render them positionally instead of as list rows.
Given it has no reference-safety story of its own (it is read-only, rebuilt live, same as the existing
list), and given reorder/duplicate/copy-paste are the roadmap's own "teeth," this design recommends
shipping this slice without the overview and taking it up separately once §6-§9 have shipped and any
schema changes (folders, in particular) have settled — an overview built against a folder scheme that
hasn't landed yet risks needing rework the moment folders' final shape is decided. **Confirmed correct
by round 1's review** — unchanged in this revision.

## §13. Store/undo semantics — resolved by §6.7/§8/§9 directly, restated here for clarity

Every operation in this design is exactly one `store.commit(label, mutate)` call
(`renderer/store.js:63-69`), where `mutate` performs the structural edit **and** every reference fixup
in the same synchronous callback — `commit` snapshots once, before `mutate` runs, and emits one
`change` event after. This was verified, not assumed: `commit`'s own implementation
(`renderer/store.js:63-69`) places no constraint on how many fields `mutate` touches, and `undo()`
(`renderer/store.js:103-111`) restores the entire pre-commit `structuredClone`, so a reorder's `undo`
needs no special-casing — every field this design's `mutate` touched (map order, every door, every
warp, `titleMap`/`startMap`, and — new this revision — `saveCompatToken`, §6.10) reverts together, for
free, because undo was never field-scoped to begin with. **`store.commit`'s discarded return value**
(the fact the review's finding 7 turns on) is likewise confirmed rather than assumed — `commit`'s own
body (`renderer/store.js:63-69`) calls `mutate(this.project)` for its side effect only and returns
nothing; §6.4's reporting mechanism works around this with an outer closure variable rather than
proposing a `store.js` change, since `mutate` already runs synchronously and a plain JS closure captures
its result with no timing risk. Nothing here is new store infrastructure; it is a direct consequence of
reading the existing `commit`/`undo` implementation and confirming they already support "one gesture,
arbitrarily many fields, one undo entry" with no changes needed.

## §14. Non-goals

No engine changes, no new `EVENT_COMMANDS` opcode, no new engine RAM, no `NO_SCREEN` sentinel (§6.4
argues why one is unneeded and would require engine dispatch this design explicitly avoids), no
free reordering of screens within a map's own grid (§6.5 — that is a different, already-served concern),
no persistent opaque ids (§5 — `saveCompatToken`, §6.10, is explicitly not one, see §5's own closing
note), no unification of the two independent flatteners (§4.1 — recorded as a finding, deliberately not
fixed here), no world overview (§12's slicing decision), no multi-select rectangular *actor* copy beyond
the extension sketched in §6.3 (a genuine second slice, not blocked on but not required by the
region-copy slice), no fixing `map.id`'s vestigial status beyond noting it (§3 row 11) — repurposing it
as a real identity is foreclosed by §5's decision, not merely deferred. **New this revision:** no
"Replace a blank cell" destructive duplicate path (§6.2's finding-3 correction drops it rather than
naming and confirming it, judged not worth the added risk surface against the three non-destructive
paths already covering the use case); no audit-metadata schema field for reporting dropped references
(§6.4's finding-7 resolution — the brief's own steer against one is followed, in favor of a closure-
captured synchronous result plus preflight confirmation for the two operations that can actually drop
anything); no schema-level record of a paste/duplicate's tileset provenance (§6.2/§6.3's finding-8
resolution — the cross-tileset warning is a transient return value from the operation, never persisted).
**New this round (Fix round 2):** no cryptographically-secure random source for `saveCompatToken`
(§6.10 — `Math.random()` is sufficient for a collision-avoidance value, not a security credential); no
layout-derived save-compatibility fingerprint (§6.10 argues one is unachievable without per-screen
identity, which §5 declines, and takes the independently-redrawn nonce instead — recorded as a
considered and rejected alternative, not merely unconsidered); no exclusion set added to
`remapScreenReferences`'s own
signature for the single-screen-duplicate-via-growth case (§6.9.1 — the clone's content is inserted
*after* the generic walk runs instead, needing no change to the one shared primitive); no `<optgroup>`
regrouping or array-sort-by-folder for the Map Forge's map picker (§8/§12's finding-7 resolution — an
order-preserving, folder-prefixed label list is used instead, and sorting `project.maps` by folder is
explicitly named and rejected as an unrouted structural edit).

## §15. Changelog

### Fix round 1 (against that round's own review, 10 findings, 5 High)

1. **The save record (High) — retracted and fixed.** §5's old "never serialized into a save slot" claim
   removed; §3 gains row 17 (saved `flat_screen`, `shared/save.js`/`engine/save.asm`); new §6.10
   (`project.project.saveCompatToken`, folded into `saveIdentity` only when nonzero so an untouched
   project's identity is byte-identical to today); reorder/delete/resize bump it, duplicate deliberately
   does not (argued: `screenCount` already moves on append); new §11 test 20, modeled directly on
   `test/unit/save.test.js`'s existing "different project" test, including a negative control.
2. **Map/per-map translations for delete/resize/grow (High) — specified in full.** New §6.1.4
   (`buildResizeTranslate`, flat-space), new §6.8 (Delete Map assembled end to end, with the map-space
   `startMap`/`titleMap` decrement-or-fallback policy round 1 never stated), new §6.9 (Resize Map
   assembled end to end, with the per-map object-identity diff — `buildPerMapTranslate` — for the
   reviewer's own `[a,b,c,d]`→`[a,b,new,c,d,new]` case). §6.6 narrowed to state explicitly it covers
   reorder only. New §11 tests 18-19 covering the full delete-before/delete-target/width-grow-relocation/
   shrink-target matrix for both start and title.
3. **Blank-cell reuse (High) — dropped, not renamed.** §6.2's duplicate-screen algorithm no longer offers
   blank-cell reuse at all (argued: the three remaining paths already cover the use case without the
   added risk of a destructive Replace operation). The clone-side self/external rewrite (§6.2) now also
   walks the copy's own event pages (`allCommands`, top-level/branch/choice) via a new
   `rewriteClonedRange` helper, not just entities' door bytes. New/widened §11 tests 9, 12.
4. **Out-of-range stored operands (High) — canonicalize-first adopted.** New shared `canonicalizeFlat`
   helper (§6.1), applied by every translate-builder against the pre-edit flat count before translation.
   §6.2 states honestly that duplicate-append is no longer zero-rewrite — it now runs a project-wide
   canonicalizing pass. New §11 tests 3-4.
5. **The ROM comparison (High) — replaced, not patched.** Round 1's raw-per-screen-byte multiset test
   retracted with the reviewer's own counterexample recorded (§7). Replaced with a generated-asset-level
   semantic-normal-form check using `flattenScreens`/`compileText` (both already exported) plus one new,
   small, single-writer-preserving export, `resolveDoorTarget` (extracted verbatim from `emitScreens`'s
   own ternary) — no `screenRecordBytes` export or duplication needed. Inverse-permutation byte-identity
   test kept, its weakness (a no-remap implementation passes it) now stated explicitly in both §7 and the
   test's own documentation (§11 test 8). New §11 test 7.
6. **Screen naming on duplicate (Medium) — resolved.** §6.2 gains `nameForDuplicateScreen`: non-empty
   source names auto-suffix within the destination map; empty names copy as empty (no synthetic
   identity). §9's warning check corrected to exclude empty screen names from its count entirely (round
   1's version would have warned on nearly every ordinary multi-screen map). New/widened §11 tests 11, 17.
7. **The dropped-reference report (Medium) — decided.** Round 1's impossible "Build-panel `validateProject`
   warning from post-edit state" claim retracted. §6.4 now specifies: preflight confirmation (extending
   Delete Map's/Resize-shrink's existing `confirmModal`) for the two operations that can actually drop a
   reference, a closure-captured synchronous result (no `store.js` change) for callers that want it after
   the fact, and explicitly no new schema/audit-metadata field, per the brief's own steer.
8. **Copy/paste semantics (Medium) — decided.** §6.3: pasted `boundTiles` now clear-then-add across the
   whole destination rectangle (replace, not overlay) — new §11 test 14. §6.2/§6.3: the cross-tileset
   warning is now explicitly a return value from the paste/duplicate operation, never a
   `validateProject`/`checkCapacity` claim (which cannot see it after the fact) — rewritten §11 test 13
   asserts both the returned warning's presence and its absence from build diagnostics.
9. **Test-plan gaps (Medium) — closed, and the self-check re-run.** Added: the duplicated map/screen's
   own event-page walk (test 9), the Delete Map and shrink-Resize retrofits (tests 18-19), the
   save-compatibility matrix (test 20), a semantic (not merely `<select>`-order) smoke assertion after
   reorder. The "wrong implementation that passes every test" exercise re-run against the full revised
   plan at the end of §11, finding and recording one surviving gap (a flat-space/per-map-space mix-up in
   the Resize retrofit invisible only when the resized map happens to be first in `project.maps`) as a
   binding fixture requirement on test 19 rather than a design change, since §6.9's own mechanism is
   already correct as specified.
10. **Folder persistence (Medium) — both touchpoints named.** §8 now names `createMap`'s own
    `folder: null` default and `normalizeMap`'s round-trip explicitly (previously implied, not stated).
    New §11 test 16 widened to three assertions: build-invisibility (round 1's original), a real
    `saveProject`/`loadProject` round trip, and `normalizeProject` idempotence. Smoke coverage (§11) gains
    a real project-reload check that the folder grouping survives.

### Fix round 2 (against that round's own review, 7 findings, 3 High)

1. **Epoch reuse across an undo branch (High) — the counter is replaced with an independently-redrawn
   16-bit nonce, and the fold width is pinned.** Round 1's `saveCompatEpoch` (a monotonic `+= 1`) is
   renamed `saveCompatToken` and rebuilt as a fresh, independently-drawn random value in `[1, 0xFFFF]` on
   every qualifying edit — never incremented from its prior value on a *new* edit, though `store.undo()`
   correctly *does* restore whatever value the field held before the commit being undone, as one field
   among all the others a whole-project snapshot restores (§13) — reuse across two separate draws remains
   possible, at `1/65535`, precisely the honest probability §6.10 states rather than a claim of
   uniqueness. §6.10 argues explicitly why a layout-derived fingerprint (the alternative the brief invited
   weighing) is not achievable without per-screen identity, which §5 declines, and takes the nonce as the
   brief's own steer anticipated. The schema gains an explicit upper-bound clamp (`<= 0xFFFF`) matching
   the real fold's `& 0xffff` masking, closing the "1 and 65537 alias" hole by construction. The collision
   probability (`1/65535`) is stated as its own, separately-sized probabilistic risk — not claimed to be
   the same order of magnitude as `saveIdentity`'s own pre-existing, documented birthday-bound tolerance
   for its 32-bit fold, which a `2^16`-times-larger space makes a materially different comparison (Fix
   round 3, finding 7 corrects round 2's own overstated comparison here),
   not hidden behind false determinism. §7 item 3 and §11 test 8 are corrected: the inverse-permutation
   ROM byte-identity claim is now explicitly pinned to a **save-free** fixture, with a save-enabled
   variant's own `SAVE_IDENTITY_0..3` divergence asserted as the *opposite*, intentional claim. New §11
   test 21, the reviewer's own `[A,B,C]`→undo→`[C,A,B]` cartridge scenario, run against the real engine.
2. **The clone/resize index-space collision (High) — rebuilt around semantic old-target identity, and
   the operation is genuinely one commit.** §6.9 gains a commit-free core, `growOrShrinkMap`, shared by
   the ordinary `resizeMap` UI entry point and (new) §6.9.1's `duplicateScreenViaGrowth` — both wrap it
   in exactly one `store.commit` each, closing the review's own "resize already owns its commit" objection.
   The clone's own operands are excluded from `growOrShrinkMap`'s generic remap by construction (its
   own blank cell has nothing on it yet) and are instead resolved by a new, dedicated
   `buildCloneTranslate`/`applyCloneTranslate` pair: canonicalize against the pre-resize flat order,
   route the source's own identity to the clone, route every external identity through the resize's own
   after-index map — traced explicitly against the reviewer's own 2×2→3×2 example. The epoch/token
   contradiction is resolved with one stated rule, not two competing claims: append never redraws the
   token (§6.2, unchanged); grow always does, because it is mechanically a resize (§6.9.1). New §11 test
   23, the forced-width-grow fixture (source on row 1, self/external doors, nested top-level/branch/
   choice Warps) the review names directly.
3. **The compiler comparison still compares relocatable bytes (High) — replaced with a real opcode
   decoder.** §7 item 2 is rebuilt in full: a test-only `decodeCommand`/`decodeBody`/`decodeEvent`
   recursive decoder, walking pages/branches/choice options exactly per the wire format `encodeCommand`/
   `EVT_PAGE_HEAD` already specify, replacing only the two operand kinds ever relocatable under a
   reorder (a Warp's screen operand, a Say/choice-label string id) with resolved, build-independent
   content, comparing everything else (opcodes, length bytes, every non-relocatable operand type) as raw
   bytes — argued directly from §3's own inventory, not assumed. The door/pickup helper is corrected to
   `resolveEntityByte(entity, actor, itemsEnabled, itemIdForActor, flatLength)` — every real dependency
   named, a tagged `{kind: 'screen'|'item', ...}` return the caller switches on explicitly rather than
   assuming every entity resolves through `flat[...]`. Rewritten §11 test 7 adds the required reordered-
   Warp-and-shared-dialogue fixture, engineered so both relocatable operand kinds are proven to shift
   between builds, closing round 1's own "picked an unaffected placement" dodge.
4. **The preflight count counts the wrong thing (Medium) — replaced with a real reference audit.** New
   `auditDroppedReferences(project, translate, discardedScreens)` (§6.4), walking every surviving
   entity/event (and common events, unconditionally) via `allCommands`, excluding references whose own
   screen is being discarded, counting each one whose canonicalized-and-translated target is
   `DROPPED_SCREEN` — replacing round 1's `before.filter((_, i) => dryTranslate(i) === DROPPED_SCREEN)
   .length`, which counted deleted screens, not redirected references. §6.8's `deleteMap` and §6.9's new
   `confirmResizeIfShrinking` both call it. New §11 test 22, with fixtures chosen specifically to make
   the two candidate numbers disagree (5 deleted screens/0 incoming references; 1 deleted screen/10
   incoming references).
5. **Test 11.3's fixture proves nothing (Medium) — corrected.** §11 test 3's fixture now moves the old
   effective last screen to flat position 2 (nonzero, distinct from `FALLBACK_SCREEN`'s own 0) and
   separately asserts `droppedTargets` is empty — round 1's own broken implementation (classify-as-
   dropped, apply fallback) can no longer coincidentally produce the asserted value.
6. **§6.8's reversed prose (Medium) — corrected to match the pseudocode, and the missing case is
   tested.** The map-space policy is restated as three absolute cases (`< mapIndex` unchanged, `>
   mapIndex` decremented, `=== mapIndex` fallback) rather than the reversed "before/after" language round
   1 shipped. §6.8's own Test matrix and §11 test 18 both gain the missing "delete-after" case (a
   referenced map positioned *after* the deleted one, proving it stays unchanged) alongside the
   already-tested "delete-before" case, plus a direct `titleMap === null` stay-null assertion — seven
   assertions in place of round 1's miscounted eight-that-were-really-four.
7. **Folders must not hide build order (Medium) — the `<optgroup>` regroup is retracted.** §8/§12 now
   specify an ordered, never-regrouped picker: each map's own `<option>` label is folder-prefixed
   (`[folder] name`), but position always follows `project.maps`' own real array order, so a folder never
   makes two structurally-adjacent maps look apart, or two non-adjacent same-folder maps look grouped.
   Sorting `project.maps` by folder is explicitly named and rejected, since that would be a structural
   edit needing the full remap machinery this design deliberately does not give folders. New smoke case:
   an interleaved `[A(X),B(Y),C(X)]` fixture, reordered to `[A(X),C(X),B(Y)]`, asserting the picker's
   *visible* order actually changes to show the swap — the exact case round 1's ungrouped reorder smoke
   test could not have caught a regrouping regression with.

The "wrong implementation that passes every test" exercise was re-run against this revision's complete
plan (§11's own closing subsection, after round 1's still-standing finding): it found `normalizeProject`'s
own schema clamp on `saveCompatToken` could omit its upper bound (`<= 0xFFFF`) without any test in the
plan noticing, since every fixture draws tokens through the normal edit path rather than round-tripping
a hand-authored, out-of-range value — closed directly by widening test 20(a) with a fourth assertion,
rather than left as a residual gap or spun into a separate test.

### Fix round 3 (against that round's own review, 7 findings, 2 High)

1. **The decoder (High) — rebuilt against `encodeCommand`'s actual cases, not the authored `args`
   table.** Two independent defects, both real. Choice's own framing
   (`textcompile.js:438-452`) stores `recordLength = body.length + 2`; the decoder now decodes each
   option body with `recordLength - 2`, verifies the trailing `OP_JUMP` explicitly, and advances the
   cursor by `1 + recordLength` — round 2's own version passed the full `recordLength` to `decodeBody`,
   which tried to decode `OP_JUMP` itself as a command and then double-counted the framing bytes. The
   generic `1 + entry.args.length` rule is corrected with an explicit `EXCEPTIONAL_WIDTHS` table for the
   three opcodes whose compiled width the authored schema does not predict: `sting`/`sfx` (3 bytes each —
   a compiler-computed duration byte the schema never declares) and `battle` (`1 +
   RPG_LIMITS.monstersPerBattle`, a fixed-width padded array regardless of how many monsters were
   authored) — the full width table for every real opcode is written into §7 directly, not left to be
   reconstructed from the schema. `decodeCommand` now hard-fails on any opcode that is not a real, live,
   decodable one (past the real prefix, `route`'s own `virtual: true` tail, or either framing sentinel —
   `OP_END`/`OP_JUMP` — appearing where neither may legitimately sit), and `decodeBody`/`decodeEvent`
   both assert exact byte consumption at every body, page, and the final terminator, failing loudly on
   any under- or over-count rather than silently absorbing it into the next command's own opcode byte.
   `route`'s own zero-framing compilation is stated explicitly as needing no decoder case at all — its
   legs decode as ordinary `move`/`turn`/`wait` entries through the same generic path those ops already
   use standalone. New §11 test 24, the decoder-corpus round-trip test the review names: one build, every
   real opcode (battle/sting/sfx and a two-level-nested Choice included, plus a route), encoded then
   decoded, asserting exact-shape round-trip with no thrown consumption/opcode error.
2. **Add Map (High) — brought into append canonicalization, alongside Duplicate Map.** §4.2 gains the
   analysis Add Map's own title always promised but never delivered: the real handler
   (`map.js:1474-1478`) is a bare `push`, carrying the identical append-retargeting hole §6.2 already
   fixed for Duplicate Map. §6.2 is retitled to cover both, generalizes the shared canonicalizing
   primitive (renamed `buildAppendCanonicalizeTranslate`, used by both callers, not duplicated), and
   states the complete, swept set of bare-append operations (Add Map, Duplicate Map — the "brand-new 1×1
   map" duplicate-screen path is confirmed to be a caller of Duplicate Map's own mechanism, not a third
   site) so no other one can hide. §1 and §4.2's own closing paragraph are corrected from "two existing
   operations"/"retrofits both" to three, throughout. No token redraw for Add Map (`screenCount` already
   moves — the identical argument already established for duplicate-append). New §11 test 25, the
   Add-specific variant of test 4 (an out-of-range door and a nested warp keep their pre-append effective
   target across `addMap()`).
3. **The string-shift fixture (Medium) — rebuilt to actually force an id to shift.** `internString`
   interns by encoded-content key, so round 2's own "swap two placements with identical dialogue"
   fixture could never have changed the shared string's id — both orders produce the identical
   distinct-content sequence for that content. Test 7 is corrected to the ordering the review itself
   sketches: map A authors a unique string before the shared one, map B authors only the shared one —
   giving the shared content id `1` in A-before-B order and id `0` in B-before-A order, derived directly
   from `internString`'s own dedup rule rather than merely asserted. The identical construction is
   applied to the Choice label.
4. **The titleless fixture (Medium) — a genuinely separate case, not a re-test of delete-target.** Test
   18's seventh assertion previously re-proved delete-target's own title half (non-null → `null`), which
   a wrong implementation defaulting an *already-null* title to map 0 would still pass. The corrected
   seventh fixture starts from `titleMap: null`, deletes an unrelated map, and asserts the title both
   stays `null` and is not synthesized into a real map's screen.
5. **The audit UI (Medium) — real-window coverage of the actual dialogs added.** New smoke cases open the
   real Delete Map and shrink-Resize confirmations on a disagreement fixture (reference count ≠ screen
   count), asserting the *displayed* count is the reference count and that Cancel commits nothing — for
   both dialogs, closing the gap where a correct, unused `auditDroppedReferences` could ship behind an
   unwired or wrongly-wired confirmation and pass every prior test.
6. **Deterministic token tests (Medium) — draw-source control specified, "retry the draw" dropped.** Test
   21 now controls `Math.random` for its exact history (no retry, no residual probabilism), asserting
   each drawn token against its own known mocked value rather than merely `t1 !== t2`. New §11 test 26,
   the draw-site census: exactly one draw per qualifying commit (reorder, delete, grow, shrink,
   growth-routed duplicate) and zero for every non-qualifying one (append-only duplicate, Add Map,
   folder edits, region paste) — closing the gap where Delete/ordinary-Resize's own redraw call could be
   silently omitted, since their `screenCount` changes already alter `saveIdentity` without it.
7. **Language cleanup (Low) — absolutes corrected to match the mechanism's own honest policy.** The
   opening status line now says "Revised three times" and names all three reviews. §15's own Fix round 2
   entry 1 no longer calls the token "non-reused"/"never restored" — it is an independently-redrawn
   16-bit nonce, reuse possible at `1/65535`, and `store.undo()` correctly restores the field as one of
   the others a snapshot restores. The comparison to the 32-bit identity fold's own collision tolerance
   is softened from "same order of magnitude" to "both probabilistic, differently sized" — a `2^16`
   factor separates the two per-pair spaces, stated directly rather than elided.

The "wrong implementation that passes every test" exercise was re-run a third time (§11's own closing
subsection, after both earlier findings, which stand unchanged): it found Add Map's own naming, copied
from the real shipped handler, collides with an existing map's name after a Delete (`project.maps.length`
returning to a value an earlier map was already named from) — a softer finding than the prior two (it
produces an author-visible `validateProject` warning on the next build rather than silent corruption),
but genuinely unguarded and untested. Closed directly: §6.2 gains `nameForNewMap`, the identical
collision-avoidance discipline `nameForDuplicateScreen` already applies one level over, and test 25 gains
a third fixture proving the specific delete-then-add collision is avoided.

### Fix round 4 (against that round's own review, 3 findings, 1 High)

1. **The all-maps-full duplicate fallback (High, blocking) — assembled as a named, fully specified
   operation.** Round 3's own text left "a brand-new 1×1 map" as an analogy — "mechanically identical to
   duplicate a whole map... with a synthetic one-screen source" — which never actually answered any of
   the observable questions an implementer would hit first. New §6.2.1 answers all four the review names,
   each argued rather than merely picked: the new map's metadata (`tilesetId`/`songId`/
   `battleSkyTile`/`battleGroundTile`/`encounters`) comes from the **source map**, on the single argument
   that the promoted screen was authored against that map's tileset and behavior, not `createMap`'s own
   generic defaults; the new map's own name uses a third sibling in the `nameForNewMap`/
   `nameForDuplicateScreen` collision-avoidance family (`nameForNewMapFromSource`); the screen's own name
   in its new (always-empty) per-map namespace uses `nameForDuplicateScreen` directly, called for
   uniformity even though it degrades to identity here; and the captured source range is the
   **singleton** source screen alone, not the whole source map's range — a self-reference is only the
   clone's own screen, every other source-map screen (including ones the promoted screen used to lead to)
   stays external, and every incoming reference stays with the original. One `store.commit`, reusing the
   identical `buildAppendCanonicalizeTranslate`/`rewriteClonedRange` primitives every other append site
   already shares — no third implementation of either. No token draw (append; `screenCount` already
   moves). §6.2's own "complete append set" statement is corrected from two sites to three, and §1/§4.2
   are swept for the same undercount elsewhere in the document. New §11 test 27, the reviewer's own
   every-map-4×4 fixture, reached through the real duplicate-screen operation; test 26's non-qualifying
   draw census widens to ten fixtures.
2. **The Choice `past` operand (Medium, pinned) — validated, not merely consumed.** The decoder now reads
   the trailing byte on every option record and verifies it equals the sum of `1 + recordLength` over
   every remaining record — `textcompile.js`'s own formula, computed independently and compared as a
   derived invariant, not merely advanced past. The value is retained in the decoded form. §7 states
   explicitly that this correction must land before the decoder is trusted as the oracle for tests 6-7.
   Test 24 gains the explicit two-option assertion (first option's `past` provably nonzero, last option's
   provably zero).
3. **The corpus fixture (Medium, pinned) — pinned as a concrete valid project, with corrected
   assertions.** Test 24's fixture is now a named, specific RPG on MMC1 with an effective title, a party
   member, a real monster actor, a real item, a short song, a short SFX entry, and a live common event —
   `validateProject` asserted to report zero errors before compiling, closing the gap where a fixture
   could "cover" an opcode while only exercising its sentinel/failure encoding. The "raw equals authored
   value exactly" assertion is corrected to apply only to commands whose compiled byte is a genuine,
   unresolved pass-through; Move/Turn's `who`/`dir`, Visible's `state`, and Fade's `dir` are now asserted
   against the identical `MOVE_TARGETS`/`MOVE_DIRECTIONS`/`VISIBLE_STATES`/`FADE_DIRECTIONS` array-index
   resolution `encodeCommand` itself performs; Call is asserted non-sentinel (a live table slot, never
   compared to the authored common-event id); Sting/SFX are asserted non-sentinel with their durations
   independently re-derived through `songFrameLength`/`sfxFrameLength` and compared as a result, never as
   raw authored metadata.

The "wrong implementation that passes every test" exercise was re-run a fourth time (§11's own closing
subsection, after all three earlier findings, which stand unchanged): in the identical shape round 3's
own finding 5 (the audit-UI wiring) already established, it found that §6.2.1's new fallback mechanism
had unit coverage (test 27) but nothing proving the real Map Forge UI actually *routes* to it on an
all-maps-full project — an implementation could ship a correct `duplicateScreenIntoNewMap` behind a
button whose own "is there room to grow" branching never reaches it, and pass every test in this plan.
Closed directly: a new smoke case builds an all-maps-full project, drives the real "Duplicate screen"
control, and asserts a new `1×1` map with the expected name actually appears — proving the UI reaches the
operation, not merely that the operation is correct in isolation.

### Fix round 5 (against that round's own review, 5 findings, 4 Medium/1 Low — micro round, no
architectural redesign; verdict: ready for implementation)

1. **§§6.2.1/8/11.27 (Medium) — the fallback's "source-map metadata" list omitted `folder`.** Corrected
   to one uniform policy across all five copied fields: `newMap.folder = sourceMap.folder`, joining
   `tilesetId`/`songId`/`battleSkyTile`/`battleGroundTile`/`encounters`, argued the same way the other
   four already were (whole-map Duplicate's own `structuredClone` necessarily preserves `folder` too, so
   clearing it here would be an unstated, competing policy). Test 27's metadata assertions now include it.
2. **§11.27 (Medium) — the fallback fixture didn't pin the screen-name contract, and its nested-warp
   prose didn't match its own fixture.** The source screen now has a stated non-empty name, asserted on
   the clone via `nameForDuplicateScreen`'s namespace rule. The fixture now authors all four Warp shapes
   the prose was already claiming — top-level self, top-level external, Branch/Choice-nested self, and
   nested external — each asserted individually, closing the gap where only a top-level self-Warp handler
   would have passed. No-aliasing is now asserted directly: the clone and its mutable children are
   distinct objects (identity checks plus a mutate-the-clone-then-check-the-source-snapshot proof), and
   `newMap.encounters` is asserted equal-but-not-`===`-to `sourceMap.encounters`. The two "real UI path"
   statements are corrected — test 27 is a unit/operation-level test calling `duplicateScreenIntoNewMap`
   directly; real window/UI routing is left entirely to §12's smoke plan (finding 4, below).
3. **§11.24 (Medium) — three assertion holes in the decoder corpus.** Say and Warp are no longer folded
   into the "raw bytes equal authored values" catch-all (they're exceptional decoder forms — resolved
   text and a resolved screen object/`x`/`y`, not raw bytes) and now get their own explicit content/target
   assertions. Call's fixture widens to two live common events with stable ids distinct from their table
   slots; the authored call now targets the nonzero slot, asserted against the exact position
   independently derived from `liveCommonEvents(project)` — closing the gap where a slot-0-always decoder
   would have passed a one-event fixture. Sting/SFX similarly widen to two distinguishable catalog entries
   each; the authored fixture now targets the nonzero entry, asserted against the exact `songByte`/
   `sfxByte` result, with duration re-derived through the **authored** target rather than the decoded
   index (deriving from the decoded index would make the assertion circular against exactly the bug it's
   meant to catch).
4. **§§11/12 (Medium) — the all-full smoke case pinned only one branch of a three-way UI decision.**
   Widened into the three-branch matrix the review names: current map has room (grid grows, map count
   fixed), current map is full but another map has room (the target-map picker appears, the chosen
   destination grows, map count fixed), and every map is full (a new 1×1 map appears — round 4's original
   case, kept). Together these close the wrong implementation the round-4 case alone couldn't catch —
   wiring "Duplicate screen" to the fallback unconditionally, skipping the room-to-grow and picker
   branches entirely.
5. **§§4.2/6.2 (Low) — stale "both"/"the other append-shaped operation" wording after round 4 already
   named a third append site.** Swept to "all three callers"/"the other two append-shaped operations"
   throughout, including the shared primitive's own code comment in §6.2 and §6.2's section title. No
   behavior change; a document-consistency cleanup the round-4 count-correction had left half-finished.

No further architectural redesign was indicated by this round, per the review's own verdict — all five
findings are test/contract pins and one wording sweep, closed without touching §6.2.1's assembled
mechanism from round 4.

*(Round 0 predates this changelog. Future review rounds append below this entry, in the same
routes/SFX style: finding, what changed, where.)*

### Implementation fix (phase 2, code review round 1)

Design review ended at round 5 with no blocking finding, and implementation began. Phase 2's own
code review (not a design review — the design was already "ready for implementation") found a real
defect in this document's own §6.2 code sketch for `nameForDuplicateScreen`, which phase 2 had
implemented verbatim.

1. **§6.2's `nameForDuplicateScreen` code sketch (Low) — contradicted this document's own prose.**
   The sketch's loop started at `n = 2` and folded the unsuffixed `copy` candidate into it by
   special-casing `n === 2` to omit the number (`` `${trimmed} copy${n > 2 ? ` ${n}` : ''}` ``). Once
   `${trimmed} copy` is already taken, that special-case is never revisited — the very next
   iteration is `n = 3`, so `${trimmed} copy 2` is never generated, and a project that already holds
   both `X` and `X copy` gets `X copy 3` for a third duplicate, not `X copy 2`. This directly
   contradicts the sequence this document's own prose states twice, unchanged since round 1: "copy,
   then copy 2, copy 3, ..." (§6.2, describing a duplicated map's own name, and §6.2.1, describing
   `nameForNewMapFromSource`'s identical shape). The prose is the authority; the sketch was wrong and
   is corrected in place at §6.2, generating the unsuffixed `copy` candidate once, before a loop that
   starts numbering at 2. Found because phase 2 implemented the sketch byte-for-byte and its own test
   10 gained a second collision fixture (requiring exactly `Dungeon copy 2` against a destination
   already holding both `Dungeon` and `Dungeon copy`) that the sketch's own bug fails outright.
   `nameForNewMapFromSource` (§6.2.1, the *map's* own name in the phase 4 fallback) is a genuinely
   separate sibling, not a caller of this function, and its own sketch was already written in the
   correct shape (the unsuffixed candidate generated once, before a loop numbering from 2) — it
   never had this bug. `nameForDuplicateScreen` itself, though, is directly reused by §6.2.1 for the
   *screen's* own name inside the fallback's brand-new map (§6.2.1's own "the screen's own name, in
   its new per-map namespace" bullet), so this fix reaches that call site before phase 4 is ever
   implemented against it — even though §6.2.1's own text notes that particular call's `taken` set is
   always empty in practice, so the bug would not have been observable there specifically; the growth
   path's own reuse of the same function (§6.2's `duplicateScreenViaGrowth`, phase 4) has no such
   always-empty guarantee.

### Implementation fix (phase 4, self-check, no review filing — a defect found and fixed during phase 4's own implementation, before any report was sent)

Phase 4 implemented §6.9.1's `duplicateScreenViaGrowth` sketch verbatim, including its own literal
call order — `structuredClone(sourceScreen)` *after* `growOrShrinkMap(project, mapIndex, ...)` returns.
Test 23 (§11), run against that literal order, failed: a self-door on the source screen came back
pointing at an unrelated third screen instead of the clone.

1. **§6.9.1's own assembled code sketch (High) — the clone was taken from an already-mutated source,
   not the raw one its own translate assumes.** `growOrShrinkMap`'s generic `remapScreenReferences`
   walk runs the *whole* project, `sourceScreen`'s own live entities included whenever `sourceScreen`
   belongs to the map being resized (the ordinary case) — and it correctly rewrites them in place, for
   the *original*, exactly as intended (this is the walk test 23's own "the ORIGINAL's own references
   correctly follow it to its own new position" assertions confirm still works). But the sketch's own
   order calls `structuredClone(sourceScreen)` *after* that walk has already run, so the clone silently
   inherits the already-translated values instead of the raw, pre-resize ones this section's own prose
   claims ("raw stored value 2, copied verbatim onto the clone by `structuredClone`") and
   `buildCloneTranslate` is built to interpret via `flatBefore`. Traced concretely against this
   section's own worked example: a self-door on `c` (raw `2`) is rewritten by the generic walk to `3`
   (`c`'s own new position) *before* the sketch's own clone step runs; cloning afterward copies `3`,
   not `2`; `buildCloneTranslate`'s own `canonicalizeFlat(3, flatBefore.length)` then resolves against
   `flatBefore[3]` — a *different* screen than `c` — so the self-check `targetScreen === sourceScreen`
   fails, and the clone's own self-door is wrongly treated as external, landing on whatever screen
   happens to sit at that unrelated position instead of the clone itself. **Fixed by moving the
   `structuredClone` call to before `growOrShrinkMap` runs** — `duplicateScreenViaGrowthCore`
   (`shared/project.js`) now captures `cloned = structuredClone(sourceScreen)` first, then calls
   `growOrShrinkMap`, then writes `cloned`'s fields onto the blank cell exactly as before. This is the
   only change; `buildCloneTranslate`/`applyCloneTranslate` themselves are correct as specified and
   needed no change — confirmed directly: an isolated call to `buildCloneTranslate` with hand-supplied
   `flatBefore`/`flatAfter`/`cloneScreen` already produced the exactly-correct answer before this fix,
   proving the defect was in the sketch's own *call order*, not in either translate function. §6.9.1's
   own code sketch above is corrected in place to reflect the fixed order. Found by test 23
   (this document's own §11), which the design's own review process (Fix rounds 1-5)
   never ran against real code — this is the first point in item 7's history a §6.9.1-shaped fixture
   was actually executed, not merely traced by hand.
