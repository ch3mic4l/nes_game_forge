# Design record: encounter groups (ROADMAP item 5, the remainder)

Status: **built** (2026-10-21; commits C1 `fa0fa3d` data model, persistence and validation; C2 `8a14dcd` generator, engine and capacity; C3 `4b5d17b`
Monster Forge Groups tab; C4 `bf03b65` Map Forge table editor, Convert and the way back, mode-aware battle-test; C5, this record and the docs). This is
the dated design record, written from the accepted design (`handoff-next/encgroups/design.md`, revision 3) and **brought up to what shipped**. Where the
design predicted and the build measured, the measurement is stated and the difference named; where the tree disagrees with the design, the tree wins.
Current-state rules live in the `docs/reference-*.md` files this record points at; this file is history and rationale, so it may name things by line
of reasoning that the reference docs state more tersely.

Equipment (`docs/design-equipment.md`) was the first piece of ROADMAP item 5 and left two things open: classes/growth profiles, and encounter groups.
This closes encounter groups. **Classes and selectable growth profiles stay open.**

## 1. What it does, in one paragraph

An RPG project can author **encounter groups** in the Monster Forge (a name and up to four monsters) and give a map an **encounter table** in the Map
Forge (up to eight `{group, weight}` rows). A wandering fight on such a map picks one row by weight and fights that whole formation. A map is a **legacy map** when its
`encounters.mode` is absent, and it fights exactly as it always did; a map with `mode: 'groups'` is in group mode **even when its `table` is `[]`**, in which case it
rolls and starts no fight (it never falls back to the actor list; only "Use the actor list again" goes back).

## 2. Chris's rulings of 2026-10-20 (quoted from the design, section 7)

1. "**Legacy maps keep their exact current behaviour.** The engine dispatches per map: a legacy map runs today's (rng&3)+1 prefix path byte-for-byte even
   in a project where other maps use groups. Converting one map never changes another map's per-seed outcomes."
2. **Event commands stay inline.** `battle` keeps its own formation; group references in events are a later follow-up, not this item.
3. **The RPG starter stays legacy.** No starter or fixture adopts groups in this item.
4. **The four authoring limits:** 32 groups per project, 8 entries per map table, weights 1-16, 255 compiled entries per project.

What was **deferred**: group references in events (a `battle` command naming a reusable group). Inline formations can already produce the same
immediate fight; a named reusable group in events would be a new capability, and nothing in `shared/eventrules.js` or `textcompile.js` reads a group.

## 3. What the code did before (the facts the design rested on)

- A wandering fight is **not** "every listed actor". `check_encounter` rolls `rng_next() & 3`, adds one, and `start_encounter` copies that many *leading*
  slots of the map's four-slot list. A list `[A,B,C,D]` fights `{A}` .. `{A,B,C,D}`; a one-actor list is always `{A}`; a rate>0 map with an empty list
  rolls, resets `enc_step` and starts nothing. Over one complete LFSR cycle the prefix counts occur 63, 64, 64, 64 times, not four equal quarters.
- `mapEncounterFormation` (`shared/project.js`) is the single writer of a legacy map's formation for the generator, draw validation and the Map Forge
  battle-test. It stays that for legacy maps.
- The formation lookup is **8-bit** (`asl a / asl a` on the map index), and no map-count cap makes that irrelevant: legacy map 64 reads the bytes of row 0,
  map 65 row 1. So **every `map_enc_actors` row is observable behaviour**, a converted map's row included. This is why the design never blanks a row.
- The table has to live in kernel-lo: `start_encounter` is kernel code and the `$8000` window may not hold the battle bank at roll time.

## 4. The data model

```
project.encounterGroups = [ { name, monsters: [id <= 4] } ]                              // <= 32
map.encounters = { rate, actorIds }                                                       // legacy: no `mode`
map.encounters = { rate, actorIds, mode: 'groups', table: [ { group, weight } ] }         // <= 8 rows
```

- **`mode` is the one discriminator.** Absent is legacy; `'groups'` is group mode **even when `table` is `[]`**. Every consumer reads `mode`, never
  `table.length` or `actorIds` (the `folder` precedent: absent unless set). `normalizeMap` drops any other `mode` value and ignores a `table` without it;
  a legacy map still serializes to exactly `{rate, actorIds}`. Normalization never changes a map's mode.
- In group mode `actorIds` is **retained and dormant for that map's own fights**. An empty table compiles to "roll, start nothing" and can never revive
  the hidden list for that map; the list's `mapEncounterFormation` bytes still ship in `map_enc_actors` (section 6).
- Group mode with **rate 0** is valid and inert, and does not turn the project predicate on.
- The four limits are `RPG_LIMITS.encounterGroups`, `encounterTableEntries`, `encounterWeightMax` and `encounterEntriesTotal` (32 / 8 / 16 / 255). A group
  of duplicates is legal; a table cannot hold one group twice (same-group entries are merged by the normalizer).
- Persistence: `encounterGroups.json` beside `items.json`, **always written** (`[]` too), absent reads as `[]` (`main/project-io.js`). Map JSON gains
  `mode`/`table` only for group-mode maps. `createProject` gains `encounterGroups: []`; the blank starters stay byte-identical to it.
- No save-format change: no encounter state is in the save record, so there is no `SAVE_LAYOUT_VERSION` bump and no `saveCompatToken` change.
- The helpers, all in `shared/project.js`: `projectUsesEncounterGroups` (`gameType === 'rpg'` and some map is group-mode with rate > 0), `mapEncounterEntries`
  (the single writer of a group map's compiled entries; never reads `actorIds`), `encounterThresholds` (the one place the weight-to-byte rule lives),
  `encounterGroupFormation` (the 4-id `$FF`-padded list), `encounterRowPlan` and `encounterEntryTotal` (the row policy and the entry total, shared by
  validation, the generator and the capacity model), `planEncounterConversion` / `applyEncounterConversion` / `useLegacyEncounterList`.
- `monsterActorIds` also walks group members, so a monster named only by a group is still "named anywhere authored" in the Monster Forge catalog.

## 5. Selection law (no multiply on the 6502)

Per group-mode map, entries `i = 0..n-1` with weights `w_i`, `total = sum(w) <= 128`. `encounterThresholds` computes `thr_i = floor(cum_i * 255 / total)`
for `i < n-1` and `thr_{n-1} = 255`. The engine takes the roll `r` (1..255; `rng_next` never returns 0) and picks the first entry with `r <= thr_i`. Each
probability is within 1/255 of its ideal share, every entry is reachable, and the last threshold being `$FF` ends the scan, so there is no count byte and no
sentinel. The Map Forge's chance column is computed from `encounterThresholds`, never a second division (equal weights 4:4 read 49.8% / 50.2%).

## 6. Generator tables and the engine picker

**Per-map dispatch.** `map_enc_off` (1 B/map, kernel-lo `maps.inc`, emitted only under `ENC_GROUPS`): `$FF` is a legacy map; a rate>0 group map holds the
index of its first entry; a rate-0 group map holds 0 and is never read (the rate gate returns first).

```
map_enc_rate      1 B/map    unchanged
map_enc_actors    4 B/map    unchanged for EVERY map: the mapEncounterFormation bytes, any mode, rate or ENC_GROUPS
map_enc_off       1 B/map    $FF = legacy, else first-entry offset            (under ENC_GROUPS)
enc_thr           1 B/entry  cumulative, a map's last is $FF                  (under ENC_GROUPS)
enc_grp           1 B/entry  the UNSCALED row index, 0..32                    (under ENC_GROUPS)
enc_group_actors  4 B/row    ids, $FF padded; row r at byte 4r               (under ENC_GROUPS)
```

**Allocation policy.** Entries: for each rate>0 group map in map order, its compiled entries in table order; a rate>0 group map with no live entry gets one
**fallback entry** (`$FF`, the shared empty row). Rows are dense: one per *live* group (at least one live actor) referenced by a compiled entry of a rate>0
group map, in authored group order, then one shared all-`$FF` empty row **only if** a fallback exists. So rows <= 33 and the largest byte offset is 128.
Generator: `encounterGroupTables` (`main/build/generate.js`), spliced into `maps.inc`.

**Engine** (`engine/rpg.asm`). Under `.if ENC_GROUPS`, `check_encounter` stores the raw roll in `bt_tmp2` (the same single `rng_next` call). After
`start_encounter_ord` the dispatch reads `map_enc_off`: `$FF` converts the roll to today's count (`and #3`, `clc`, `adc #1`) and falls into the unchanged legacy
copy loop; anything else enters `enc_group_path`, scans `enc_thr` for the first entry >= the roll, scales `enc_grp` once, copies four ids into `mon_slot_actor`
and joins `start_encounter_first`, whose existing `cmp #$FF / beq start_encounter_none` covers "start nothing". No new RAM, no new cross-bank call. The
streamed-world dispatch bracket (`*_dispatch`..`*_ord`, `STREAMWORLD_ENCOUNTER_KERNEL_ALLOWANCE`) is untouched; the new code is after it, and
`map_enc_off` is indexed by the raw owning map index, `cur_map` for a streamed screen.

**Groups off is byte-identical.** The labels `start_encounter_legacy` and `start_encounter_first` exist only inside `.if ENC_GROUPS`. The design named them
unconditionally; as first written they added two names to the symbol table, which failed twenty `identitymatrix.test.js` rows ("byte-identical ... and its
symbol table"), so they moved inside the conditional. A project with no rate>0 group map assembles byte-for-byte as before. C2 compared all six fixture ROMs and their
`game.fns` against the parent (`c2/report.md`, `rom-identity.txt`); the C1, C3, C4 and C5 six-fixture checks are ROM comparisons only.

## 7. Capacity: predicted against measured

`ENCGROUP_KERNEL_ALLOWANCE = 48` (`main/build/generate.js`), charged when `usesBattleBase && projectUsesEncounterGroups`. The tables are priced in
`kernelTableBytes` as `1*maps + 4*rows + 2*entries` (rows per the policy above, entries over rate>0 group maps with a fallback counting 1), flat when off.

| figure | design (hand count, predicted) | C2 (measured, `c2/report.md`) |
| --- | --- | --- |
| code, MMC1 / MMC3 / UNROM 512, ordinary and streamed | +48 | **+48** on all six cells, no `*_BY_MAPPER` term |
| `sample-rpg` shape (1 map, 1 group, 1 entry) tables | 7 B (55 with code) | **7 B** (55 raw growth) |
| 32 maps x 7 entries over 32 live groups | 608 B tables (656 with code) | **608 B**, equal to the bytes parsed out of `maps.inc` |
| the same plus a fallback map | 608 + 4 + 2 + 1 | **608 + 4 + 2 + 1** |
| upper bound | `M + 690` B, symbolic in M | at the largest M that capacity accepts (51 on a bare MMC3 RPG): tables `M + 4*33 + 2*255 = 693`, kernel-lo used 8162, margin 20 |
| whole-bank margin, converting a map | n/a | **20 -> 20** (ordinary), **22 -> 22** / 20 -> 20 (streamed): the byte model and nesasm agree |
| banked battle region / kernel-hi | 0 / 0 | not touched |

The measurement equals the prediction on every cell, so nothing in the design's figures needed correcting. (The design's earlier "336 B worst case" had been
withdrawn before the build.) An action project carrying a group-mode map pays **0**: identical `kernelCodeBytes`, `kernelTableBytes` and nesasm kernel-lo
usage on MMC1, MMC3 and UNROM 512, and `ENC_GROUPS = 0` in `config.inc`. The code gate and the table gate differ by one condition on purpose: tables are
emitted into `maps.inc` whenever `projectUsesEncounterGroups`, the code allowance additionally needs the battle base (`rpg.asm` assembles only under
`.if BATTLE_ENABLED`).

**No free-space assurance is given.** Cost is project-dependent and some supported conjunctions already have only 20-44 bytes free. `checkCapacity` refuses an
overflow as `kernel-lo-tables-over` and `kernelShortfallAdvice` offers a lever, "the encounter groups (the maps go back to their actor lists)", priced by full
occupancy through `projectWithoutEncounterGroups`. A real overflow is a test: `sample-rpg` on MMC1 plus the largest filler count that still fits legacy;
converting map 0 is refused, the advice's freed-bytes figure equals the counterfactual occupancy difference (`maps + 6 + 48`), and the stripped project builds.

**The bounds and their named refusals.** Entries total <= 255 project-wide, fallback entries included (`$FF` is spent as the legacy marker); rows <= 33. The
errors `encounter-entries-over` and `encounter-rows-over` are raised in `validateProject` (inside `checkCapacity`) before a byte is emitted. The advice must
name edits that actually lower the compiled total: removing a map's only live row frees nothing (it becomes a fallback), so the text lists maps with two or
more live entries and what each can free, and when row removal cannot suffice recommends rate 0 or "Use the actor list again" per named map. The defensive
re-assertion is the exported `assertEncounterGroupBounds`, called after the capacity gate and before `fs.rm` or any write; since validation refuses first it is
reachable only on an un-normalized project, and is tested directly there. (The design had inlined it in the generator; no input could reach inlined code.)

**Code Forge.** `validateProject` raises the error `encounter-groups-code-override` (naming the Code Forge and the Map Forge) when `projectUsesEncounterGroups`
and `code.overrides` holds `rpg.asm`. It is a conservative incompatibility policy, not a proof of breakage: a replacement cannot be known to honour the picker.
Hand-written code stays outside `checkCapacity`'s byte math; the table bytes are still priced. (C1 deferred this rule to C2, where the generator lives.)

## 8. Conversion and the way back

A map's mode changes only by an explicit action, and each action is one `store.commit`.

- **Convert to groups.** `planEncounterConversion(project, mapIndex)` is pure and returns `{ok, mapIndex, newGroups, table}` or `{ok:false, message}`. `L` is
  the live ids of the map's authored list (`mapEncounterFormation` filtered, never the raw `actorIds`), `k = |L|`; for `j = 1..k` the prefix `L[0..j-1]` gets
  weight 1, the last `5-k` (k=4: 1,1,1,1; k=2: `{A}` 1, `{A,B}` 3; k=1: `{A}` 4), the legacy prefix law. A prefix whose id list matches an existing group
  **reuses** it (its name wins); the rest become new groups named by joining the actor names with " + " (a blank name is `#id`). `k = 0` is defined:
  `mode: 'groups'`, `table: []`. Preflight, before any write: existing + new groups <= 32, and the compiled entry total <= 255 (a rate>0 map costs
  `max(1, k)`, a rate-0 map none); a refusal names the number needed and the number free. It also refuses a missing map and one already in group mode (C1
  additions). **The caller's exact order** (the `planLibraryImport` precedent): plan, show `plan.message` and return with `store.commit` never called on a
  refusal, otherwise one `store.commit` whose mutator is only the apply, no `await` between. A refusal inside the callback would push undo and bump
  revision and `dirty` for an unchanged project. The real caller is `commitConvertEncounters` (`shared/encountergroups.js`).
- **Use the actor list again** (`useLegacyEncounterList`): removes `mode` and `table`, leaves `encounterGroups` untouched, and the retained `actorIds` are live
  again. It is the only way back; deleting groups or rows never does it. It sits behind a confirm, and `confirmUseActorListAgain`
  (`renderer/forges/map/encounterway.js`) captures the store revision, awaits the confirm, then **before** the commit checks that the Forge is still mounted,
  the same map is still selected, the revision is unchanged, and the target is still in group mode; any failure changes nothing (C4 fix round 1).
- **Distribution, not sequence.** Converted tables use the section 5 thresholds (k=2: 63/192, k=3: 63/64/128, k=4: 63/64/64/64 of the 255 rolls), equal to the
  legacy complete-cycle prefix counts for a map whose legacy lookup reads its own row. Per-seed choices differ (`r & 3` against a threshold on the whole
  byte), so converting a map may change **that map's** outcomes and never any remaining legacy map's, aliased ones included, because the converted map's
  `map_enc_actors` row is preserved.

## 9. Deleting things

- `renumberActorDeletion` also walks `encounterGroups[].monsters` exactly as it walks `battle.monsters` and every `actorIds` (delete, shift, `NO_ACTOR` fixed
  point). An emptied group stays (its name is the author's work); `mapEncounterEntries` drops an entry whose group has no live actor, so a map of dead
  groups compiles to "no fight" and warns.
- `renumberEncounterGroupDeletion(project, index)` removes table entries naming the group, shifts higher ids down, never touches `mode`. A table left empty
  stays empty and group-mode, through save/load, duplicate, undo/redo and a ROM encounter attempt (rolls, starts nothing, never fights the retained list). The
  Monster Forge delete (`deleteEncounterGroup`) is one `store.commit`; a confirm naming the maps appears only when a table uses the group, and re-checks the
  revision after its `await`.
- The Sprite Forge's actor-delete confirm appends "It will also be removed from N encounter group(s)." only when N > 0.
- `duplicateMapCore` needs no change: `mode` and `table` ride the structured clone, and group references are project-level.

## 10. Authoring UI

**Monster Forge, Groups tab** (`renderer/forges/monster/monster.js`, logic in `shared/encountergroups.js`; `goTo('monster', {tab: 'groups'})` lands on it). Add
(a new empty group named "Group N", the first unused) and Duplicate (a copy of the members, named the source's name plus " copy", with no search for an unused name), rename, up to four monster slots each a select over the Forge's catalog (a stale id is offered once as "(missing)"; a
slot opens only after the previous is filled; duplicates legal), delete, and the 32-group limit named on the disabled Add. Per-group warnings (`missing`, `dead`)
and a usage line listing the maps whose tables use the group. Every refusal is decided before `store.commit`.

**Map Forge, "Battles here"** (`renderer/forges/map/map.js`, helpers in `shared/encountergroups.js`).
- *Legacy map:* the rate and four slot selects as before, plus **Convert to groups**, shown whenever the map is legacy (also with an empty list).
- *Group map:* the table editor, shown **whenever the selected map is in group mode** (`encounterEditorVisible`), including with zero groups and zero hostile
  actors, so deleting the only group can never hide the empty-table warning or the way back. Rows are group, weight 1-16, chance % from
  `encounterThresholds`, remove; **+ Add group** is a select of the groups not already in the table (a table cannot hold one twice), disabled with text pointing
  at the Monster Forge when there are none; the 8-entry and 255-total limits are named. Each edit is one commit with its refusal decided first.
- **Deviation from the design sketch:** no per-row "test" button; the Battle-test section already has one button per distinct live group, and a second set
  would answer the same question twice.

**Mode-aware battle-test.** The old "This map's table" button fires the dormant `actorIds` for a group map, which its ROM picker never uses, so it exists
only for legacy maps, and its hint gains one sentence that it fires the full list, which the ROM produces 1 time in 4 for four actors (pre-existing, not fixed for
legacy maps). A group map gets **one "▶ <group>" per distinct live referenced group** and an empty-table note when there is none; the hand-picked formation
tool stays in both modes. Section visibility is "any group formation or any hostile actor" for a group map, separate from editor visibility
(`battleTestOffer`). A harmless-but-explicitly-referenced group stays testable.

## 11. Validation

**Definition level** (not gated by any map's mode or the build predicate): `encounter-group-actor-missing`, a warning raised for any authored group naming a missing actor,
used or not, so an unused stale group in an otherwise all-legacy project still warns (legacy projects with no groups are unchanged).
**Map level and compiled rules**, which concern group-mode maps and `projectUsesEncounterGroups`: `encounter-table-empty` (a warning: rate>0 and no live entry, never-filled and
emptied alike), `encounter-entries-over` and `encounter-rows-over` (errors), `encounter-groups-code-override` (an error). The legacy `encounter-actor-missing` check skips a group-mode map's dormant list.
`battleFormations` yields one formation per distinct live referenced group for a rate>0 group map and none for a rate-0 map (draw validation costs).

## 12. Tests that guard each part

| part | file |
| --- | --- |
| data model, mode matrix, normalizers, both renumbers (with sabotage), thresholds (exhaustive n <= 4, seeded n 5..8), conversion plan, validation and advice | `test/unit/encountergroups.test.js` |
| the ROM: every roll per layout against hand-written literal laws on MMC1, MMC3, UNROM 512; legacy beside group map; streamed owner at a nonzero index; empty group map; 65-map aliasing; rate-0 map; the four-slot group; ROM identity with a mutation | `test/unit/encountergroupsrom.test.js`, `test/lib/encgroups.js` |
| row policy literals, `map_enc_actors` kept in every mode, table term against emitted bytes, the 33-row / 255-entry bound, advice, Code Forge pair, real overflow and the lever | `test/unit/encountergroupscapacity.test.js` |
| the allowance on six board/shape cells (code delta equality, whole-bank model) and the action-build zero | `test/unit/kernelbytes.test.js` (`ENCGROUP_KERNEL_ALLOWANCE`) |
| Monster Forge Groups logic: add, rename, limit, delete, warnings, actor-delete count | `test/unit/encountergroupsui.test.js` |
| Map Forge table: caller order with the commit spy, table edits, odds, limits, way back stale cases, RC2.3 empty catalog, battle-test per mode | `test/unit/encountertable.test.js` |
| the real DOM paths (create/delete/undo, Convert refusal, table, group battle-test, way back, zero-catalog editor) | `main/smoke.js` |

Sabotage each slice ran (all red, then reverted): C1 inferred-mode and skipped group shift; C2 blanked `map_enc_actors` rows, a picker scanning one threshold,
every `map_enc_off` zero, the legacy branch without `and #3`, the allowance 47; C3 a delete without renumber, no group limit, a fourth slot forced empty; C4
the plan inside the commit, a table button on a group map, the editor hidden at zero groups, an unconditional over-limit refusal.

**Known limits.** The streamed-owner-at-index->=64 case cannot be built (a camera-streamed world leaves room for far fewer than 63 filler maps); the streamed
lookup is covered at the highest feasible nonzero index, 41, where no aliasing is exercised, and the ordinary 65-map case does exercise the aliasing. Raising a
rate from 0 to positive on a near-full group map project can push the compiled entry total over 255; the table-edit refusals do not cover the rate field,
and the build-time `encounter-entries-over` validation catches it. The way back's real wiring (`state.mapIndex`, `destroyed`) is checked by smoke and a
production-caller diagnostic, not a mutated smoke. The save/reload of RC2.3 is a `normalizeProject(JSON round trip)` in a unit test, not a disk round trip.

## 13. Verification boundary

The ring matrix was not rebuilt or remeasured for encounter groups. Its certificate remains scoped to ce7d009. These no-flag checks establish only their enumerated artifacts; no current ring/split/lifecycle certificate is claimed. The live ring suites currently have the named 36 failures.

The named failures, by suite (each run on its own, outside `npm test`, which is `node --test "test/unit/*.test.js"`): `prov_unit.mjs` 24, `iso_unit.mjs` 6,
`s1b_unit.mjs` 1, `s1c_unit.mjs` 5 (`judge_unit.mjs` is green). They are baseline refusals (`ringtree.mjs` refuses the moved production tree), not newly
measured timing or RAM failures, and a fresh bound curve repairs none of them.

The no-flag checks, enumerated (from `handoff-next/encgroups/e10/plan.md`, sections 3 and 6):
- **S1c:** `s1c_noflag.mjs check test/lua/ring_gate/noflag/s1c-ce7d009.json`: 12 flag-absent deadline configurations x 2 artifacts, **byte-identical** to
  `s1c-ce7d009.json`.
- **S1b:** `s1b_noflag.mjs check ...s1b-ce7d009.json`: 11 flag-absent configurations, **0** `rom`, `scene.nes` or `manifest.lua` differences and 22 documented
  differences, 11 `project` (the defaulted `encounterGroups` key) and 11 `symbols.json` (the encounter names).
These do not prove the 1,528 ring-cell ROMs, the split and lifecycle variants or the current matrix. The old 1,793-stamp matrix (`docs/design-streamed-worlds-phase3b.md`
section 21) is historical evidence for `ce7d009`, not an inherited certificate for this tree.

**Chris's ruling of 2026-10-21:** the ring gate is **DOCUMENT ONLY**. `BASELINE` stays at `ce7d009`, all 36 failures are accepted **for this item**, and
renewal is deferred to a future release run. That ruling is the disposition for encounter groups only: a future release run must renew the ring gate
(`BASELINE`, the `prov_unit.mjs` literal, the sabotage patches, the additive S1b/S1c snapshots, the pilot and the matrix, with its own plan and review gates) and
bring the live ring suites to green before any current ring/split/lifecycle certificate is claimed. Until then none is claimed.

**What is renewed separately.** The streamed-world bound evidence (the three `npm test` failures `crossevidence`, `harnesstransfer` and `streamtilebound`, which
bind the engine and generator fingerprints that C1-C4 moved) is renewed by a **separate later commit, E10**, which writes its own dated section in
`docs/design-streamed-worlds-phase3b.md`. This record does not write that section and does not edit that file. The E10 plan's read-only diagnostic (not a certificate) found that rebuilding all 11,760
direct sweep jobs on the live tree gives 0 ROM-hash mismatches and differs only by the one defaulted `encounterGroups: []` project key, which is why the planned
route is the `exact` one (a fresh curve), not a new identity certificate.

## 14. Docs written at the close

`README.md` (the Monster Forge and Map Forge rows, the how-to row and a paragraph), `ROADMAP.md` (encounter groups struck through where listed as remaining),
`docs/design-equipment.md` (a dated note; its "encounter groups remain" lines stay as history), and the references `docs/reference-kernel-budget.md` (the
allowance), `docs/reference-battle-system.md` (dispatch and picker), `docs/reference-event-system.md` (the renumber helpers) and
`docs/reference-single-writer.md` (the single writers).
