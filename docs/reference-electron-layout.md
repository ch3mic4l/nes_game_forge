# Reference: Electron layout, the Forge registry and the build gate

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

### Electron layout

- **Main** (`main/`) owns all filesystem access, the build pipeline, and settings.
- **Renderer** (`renderer/`) is sandboxed with `contextIsolation` — it has no `fs`. Everything it
  can reach is enumerated in `main/preload.cjs`.
- The app is served over a custom `forge://` scheme registered in `main/main.js`, **not**
  `file://`, because ES modules cannot be fetched from an opaque `file://` origin.
- Every `ipcMain.handle` (`main/ipc.js`) is wrapped through one `guardedHandle` refusing a call
  whose `event.senderFrame` isn't this app's own `forge://app/` origin. Saves queue one chain per
  canonicalized directory (`main/savequeue.js`/`main/paths.js`), so concurrent saves serialize
  rather than interleave, each file landing via a sibling temp file and atomic rename.
- **Unsaved changes are guarded in main, never by `beforeunload`.** The renderer pushes its dirty
  state to main (`project:dirty`) whenever it changes; the window's `close` handler — plus the
  View ▸ Reload item, discarding just as thoroughly — asks there. Vetoing `beforeunload` from
  the renderer *looks* like it works and is a trap: Electron cancels the close with no dialog,
  silently stopping the title-bar X for the rest of the session. The smoke test asserts the
  report reaches main — nothing in the renderer-side scenario can see this.
- **A pixel canvas is sized from its stage, never from a constant.** The shell is CSS grid and
  reflows on its own, but the drawing surfaces are integer-zoomed pixel art, so they only follow
  the window if something recomputes the zoom: `fitZoom()` and `observeSize()` in `renderer/ui.js`
  are that something, and the Tile, Sprite and Map Forges plus the emulator all go through them.
  Two rules keep the observer from chasing itself — it watches the *border* box, not the content
  box a scrollbar changes and the redraw affects, and it calls the redraw synchronously from the
  callback rather than deferring it a frame (which would trade a "ResizeObserver loop completed"
  renderer error for a redraw that never arrives in a throttled window). The smoke test
  resizes the real window and asserts the map screen grew — a
  hardcoded zoom looks correct at whatever size it was written for.
- **A Forge selection must check it is still current after its own `await`.**
  `selectForge(id)` (`renderer/app.js`) is called unawaited from `store.subscribe`'s `'open'`
  handler, so two selections can be in flight with the *earlier* finishing last. A module-level
  `selectionToken` bumps once per call past its own guards, re-checked after `await entry.load()`
  and again in the `catch`; a superseded call returns before mounting anything or setting the
  status bar, but has already torn the stage down — the token is taken *before* `mounted` is
  destroyed and `dom.stage` cleared, safe only because the winner's own later token tears down
  again, mounting after both. Missing the check reads like a screenshot or harness artefact, not a
  bug: the second Forge mounts, then the first's late import mounts over it, leaving two `.forge`
  elements in `#stage` — exactly what `main/smoke.js`'s same-tick selection race step catches.
- **The same token also bounds a navigation context's lifetime**, added for the Monster ↔ Sprite
  deep link. `app.goTo(id, context)` writes `pendingRequest = { targetId, context, atRevision:
  store.revision }` and calls `selectForge(id)`; `activeContext = { token, context }` binds only
  after `await entry.load()` and only if `store.revision` hasn't moved since, so a delete that
  renumbered an actor mid-flight can't smuggle a stale context through. `app.consumeContext()`
  hands it to the mounting Forge once, only when `activeContext.token === selectionToken`, so a
  superseded navigation's context never reaches the winner. `main/smoke.js` exercises this
  end-to-end; `docs/design-monster.md` §2 has the full race analysis.

Each Forge is a module exporting `mount(container, app)` and returning `{ destroy?,
onProjectChange? }`; `renderer/app.js`'s `FORGES` array is the single writer for which Forges
exist, lazily importing them — the Items Forge (`renderer/forges/items/items.js`, item 5's place to
author an item's name, effect and backing Pickup actor) is one of these, no special case.
`app.forgeIds` is that registry's derived getter (`FORGES.filter(...).map((f) => f.id)`), not a
second writer — so `main/smoke.js`'s "visit every Forge" step reads `FORGES` directly, not its own
hand-maintained list — the drift that nearly shipped the Items Forge unvisited. The Magic Forge
(`renderer/forges/magic/magic.js`, item 13's spell catalog, RPG-only) is `FORGES`' first
`gameTypes` entry; the Monster Forge (`renderer/forges/monster/monster.js`, item 14) is the second
— every other entry is unconditional, so the field is additive. `monsterActorIds(project)`
(`shared/project.js`) is the Monster Forge's single catalog predicate: it reads `allCommands`
(mentioned, disabled branches included), not `liveCommands` (compiles), and raw
`command.monsters`/`map.encounters.actorIds`, not `battleFormationSlice`/`mapEncounterFormation` —
so an over-cap or rate-zero monster still appears, never hiding an actor an author is watching.
`battle.level` is the one Monster-Forge-only field with no compiled reader: it normalizes to `null`
or `clamp(1, RPG_LIMITS.maxLevel)` — the fixed constant, never `project.rpg.maxLevel`, so a lowered
Build-panel level cap can't silently reclamp an already-authored bestiary (`docs/design-monster.md`
§3). See §2 for the Forge-boundary argument and `test/unit/monsterlevel.test.js` for the level
field's byte-identity proof. It also has a renderer-side reader, "Derive from level…"
(`planMonsterGrowth`/`applyMonsterGrowth`, `shared/project.js`): a plan/apply pair like
`planLibraryImport`/`applyPlannedProject`, commit skipped on `null`, writing only the flat
`battle.*` fields `MONSTER_GROWTH_FIELDS` names — single writer of each stat's Base ceiling and `+
/ level` max, read by modal and core; `hp` excluded per the boundary above. `statAt` now lives here
too, with an optional `ceiling`, re-exported verbatim from `battletables.js` for its importers —
the `songByte` precedent. `docs/design-monster-level-scaling.md`,
`test/unit/monstergrowth.test.js`. `isForgeAvailable(entry, project)` is the single predicate for
whether an entry applies to the open project, read by three call sites — `renderRail()`, the
`app.forgeIds` getter ("visit every Forge" needs no Magic special-case), and `selectForge`, a
second guard: a stale `activeForgeId` (a bare module-level variable outliving a project close)
falls back to `'tile'`, never reaching a Forge the rail never rendered a button for.
`main/smoke.js`'s negative case reads the rendered `.rail-item` titles, not `forgeIds` — catching a
`renderRail()` that filters differently from the getter, offering a clickable button into an
excluded Forge. `renderer/store.js` is the single project state: `commit()` for a discrete
edit, `beginStroke()`/`touch()`/`endStroke()` so a drag is one
undo entry. Undo is whole-project `structuredClone` snapshots.

**Map organization and reuse (ROADMAP item 7)** is what makes a store commit that restructures the
map list safe. `remapScreenReferences(project, translate)` in `shared/project.js` is the single
place that knows *which fields* hold a flat screen reference — every placed entity's
`props.toScreen`, every `warp` command's `screen` operand, reached through `allCommands` so a
nested one is not missed — and rewrites them under a caller-supplied `translate`, which must be
**total** — there's deliberately no "leave it alone" answer, since an unresolved reference is a
wrong one. `titleMap`/`titleScreen`/`startMap`/`startScreen` are
map-space, not flat-space, and are left to each operation's own fixup instead. Every restructuring
operation — `reorderMapsCore`, `addMapCore`, `duplicateMapCore`, `deleteMapCore`,
`growOrShrinkMap`, `duplicateScreenViaGrowthCore`, `duplicateScreenIntoNewMapCore`,
`pasteRegionCore` — is a commit-free core in `shared/project.js`, called by both
`renderer/forges/map/map.js` (wrapped in one `store.commit()`) and the unit tests directly — one
body, not two. A same-count reorder leaves `screenCount`/`mapCount` untouched — what
`saveCompatToken` (below, under `SAVE_LAYOUT_VERSION`) exists to catch. See `docs/design-maporg.md`
for the full mechanism — the `translate` builders, the duplicated-map/screen self/external target
split, `map.folder`, and the world overview.

### The build gate

The renderer already refuses a second, reentrant `build()` call from the same Build Forge mount (a
plain `building` boolean, checked before dispatch), but that only protects one mount against
itself, not a concurrent build after a fresh mount replaces it. `main/build/buildgate.js`'s
`createBuildGate()` closes that: it allows exactly one in-flight **`build:run` IPC call** per
project directory (canonicalized with `realpathSync`), refusing a second request outright rather
than queuing it — a queued snapshot would grow stale before its turn, since `build()`
(`renderer/forges/build/build.js`) clones the project before dispatching. It lives in main, not the
renderer, because the renderer gets destroyed if the user navigates away mid-build, so a
per-mount flag there can't stop a second caller from racing `generate.js`'s own `fs.rm(buildDir)`.
It only covers that one channel — unit and Lua tests import `buildProject`
(`main/build/pipeline.js`) directly, bypassing both this gate and `main/build/cli.js`, and
`npm run smoke` is the only thing that goes through `build:run` and is covered by it.
