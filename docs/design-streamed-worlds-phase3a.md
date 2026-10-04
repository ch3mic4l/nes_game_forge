# Design record: streamed worlds, phase 3a, slice S2 (the handover window) — SHELVED

**Shelved by Chris, 2026-10-01: measured, does not fit.** Nothing of S2's engine shipped. Slices S0 and S1 are recorded in
`docs/design-streamed-worlds.md`, `docs/reference-engine.md`, `docs/reference-kernel-budget.md` and their own commits
(`99d4156`, `a161a20`). This file is the record of the slice that was built, measured and dropped, so that no one has to
re-measure it.

**Where the work is.** The engine, the Build Forge checkbox, every handover test, the M12 measurement harness and the ROM-identity certifier were archived and removed from the shipping tree. The closure contains two documentation files and the SRAM test-harness needle fix on top of `a161a20`. The archive lives only in the maintainer's local `handoff-next/s2/archive/` — that directory is git-ignored (`handoff-*/`), so a fresh clone has none of it. Its local `README.md` records the restore commands and hashes for a clean `a161a20`. The slice's briefs, reports, reviews and measurement evidence remain under the maintainer's local, git-ignored `handoff-next/` tree.

## Goal

When the player crosses from one streamed screen to the next, the actors of the screen just left vanish at the seam, because
`spawn_entities` refills the eight live slots from the entered screen (`docs/design-streamed-worlds.md`, the accepted cost).
S2 would keep the actors still *visible* in the camera window as display-only "held" copies and hand them back (adoption) when the
player returned. It was opt-in, `project.cartridge.streamHandover`, with every handover-off ROM byte-identical to S1's.

## What was built

- **Engine**: a held store of eight slots (`held_*` arrays, 18 bytes of scratch, `$078E-$07EF`); an exchange run inside every crossing
  (depart, prune, adopt first, the shipped `spawn_streamed` loop with hooks, finish); admission by exact per-tile visibility and
  eviction by `2*visible + justLeft`; adoption by identity (screen tag plus record index); a held-actor draw after the live actors
  and an OAM stop; clears from `init_session` and `take_door`; and, in a fix round, a **row-arm deferral** (a four-byte guard that
  skips a row-strip arm on a body where `screen_fresh` is set).
- **Authoring**: a Build panel checkbox, its hint and warnings, `kernelShortfallAdvice` naming the handover, and a provisional held tile bound.
- **Cost**: **1,366 bytes of base kernel-hi cost** (1,370 with the row-arm deferral), plus 2 with a nonzero OAM reserve and another 5 with Show/Hide; 24 of kernel-lo, plus 4 when an RPG flips to banked dialogue.
- **Tests and harnesses**: six handover test files, an identity matrix, 25 per-routine span pins, a 10,893-record handover-off
  ROM-identity certifier (all matched), and an M12 crossing-frame harness. All 2786 tests passed on the final tree (zero skipped).

## The measurements

Gate: a streamed crossing frame must finish inside **29,780 cycles** (the full-system frame `G`: releasing interrupt through arrival
at `wait_vblank_loop`, including the tail after `main_loop_ready` and interrupt entry/RTI). Review 2 reran the current deferred crossings and the natural column route; it inspected the saved baseline and handover-off measurements. Those saved measurements are historical comparisons: some corner recipes did not reproduce their saved project/ROM hashes or timings on the final tree.

**Frame cost.** Eight scene/game/distribution combinations on the final tree, 20 vertical and corner crossings (the exchange with a
real store: empty on the first crossing, all eight matched on the reverse, a mixed-tag corner with the rank pass running):

| Scene | Crossing G | Following three bodies | |
| --- | ---: | --- | --- |
| Action vertical small, first | 31,052 | 26,735 / 21,663 / 21,490 | over |
| Action vertical small, reverse | 36,174 | 29,615 / 24,705 / 24,484 | over |
| Action vertical large, first | 25,404 | 21,233 / 16,161 / 15,990 | pass |
| RPG vertical small, reverse | 31,778 | 24,983 / 21,251 / 21,035 | over |
| RPG vertical small, first | 27,384 | 23,280 / 19,389 / 19,216 | pass |
| Action corner small, overflow | 36,448 | 26,935 / 21,866 / 21,694 | over |
| RPG corner small, overflow | 32,916 | 23,475 / 19,581 / 19,412 | over |
| RPG corner large, overflow | 26,900 | 17,762 / 13,869 / 13,698 | pass |

- **With the row-arm deferral, 10 of the 20 crossings are over the gate** (action maximum 36,448, RPG maximum 32,916). Without it,
  16 of 20: action **26,692–43,595**, RPG **23,171–39,617**. With the handover off the same rows are action **21,524–27,623**, RPG
  **18,005–22,884**. The deferral removes about 7k from a crossing body that carries a row arm and nothing from one that carries a column.
- The deferred row lands on the next body, which can sit only 165 cycles under the gate (action reverse: 29,615).
- **The column hazard is reachable by walking, with no poke.** Author the player at the screen's local `(238,236)`, hold Down for three
  bodies, then Right: the row drains, X passes 248, and the crossing body arms a real column strip. Mesen measures **40,846 action /
  35,614 RPG** (37,933 + 1,454 + 1,459; 32,669 + 1,460 + 1,485). The column arm's own inclusive cost is 7,538 action / 5,808 RPG.
- The exchange's measured pieces (reverse, action): stage 1,584, find 1,272, adopt-copy 1,232, prune 1,364, base-coordinate 1,200,
  store 768; corner: base-coordinate 1,800, exact visibility 1,778, stage 1,548, put 1,111, prune 1,260. Roughly 10–11k of a crossing body.
- **Code space.** An action project with text, combat, hearts or any compiled event (any event turns text on) has a content
  ceiling of **−100 bytes** with the handover on (1,272 before): unbuildable. Action without text: 2,630 → 1,258 left. RPG, with its
  dialogue moved into the battle bank: 1,329 → 1,199. Recovering 60–115 bytes by factoring was estimated, never done, and would still
  leave about 15 bytes of content room.

## The routes, and why none fits (review 2 §G)

Closing the gate needs about **6.8k (action) and 3.3k (RPG)** more off the worst crossing, with a column arm also possible.

| Route | Effect | Verdict |
| --- | --- | --- |
| Defer the column arm too | 7,538 / 5,808 cycles off the column case only; nothing on a vertical row that already defers its arm | Necessary, not sufficient; action still over |
| Cheap staging and tag-arithmetic fixes | A broader estimate of about 1–2k, not a measured saving; delaying copies alone saves zero on an all-eight-visible reverse | Not a rescue |
| Spread the exchange over several bodies | about 5–5.5k off the peak two ways, 6.7–7.3k three ways | The only route with enough saving; needs a new atomic protocol, hundreds of bytes, 3+ rounds |
| Smaller exchange (`HELD_MAX` 4, fewer live) | a few thousand cycles at best; it does not halve a body | Changes the eight-actor promise; no passing bound measured |
| RPG-only scope | zero speedup | Solves only the code-space problem |

## The decision

Chris shelved S2 on 2026-10-01 as measured, does not fit. The vanishing actor at a streamed seam stands as the accepted cost.
**S3a depends on S1 only** (not on any S2 piece), and **S3b treats the handover being off as a supported shape**: nothing there may
assume held actors exist.

## For any future attempt

- Start from the five routes above; only spreading the exchange over bodies is a real candidate. It needs its own design first.
- The archived `test/lua/sw_m12.mjs` is **not fail-closed**: it collects harness errors and returns them with exit 0, a missing timing
  entry becomes a zero in `worstG`, and the pre-crossing tag/record membership and the pre-matched count are never asserted. Fix that before any reuse.
- The recorded-curve consumer (`streamtilebound.test.js`) was extended in the archive to accept a ROM-identity certificate; that
  version had an early return on an exact engine fingerprint that never consulted the generator. The shipped test is HEAD's exact-fingerprint check.
- The held tile bound was never derived; no user-facing text may quote one.

---

# Slice S3a: a streamed player `Move` tracks the camera and takes the shared step

S3a's parent is `3313b62` (S1 shipped, S2 shelved). It is a code slice with one defect and one deletion.

## Goal

Before S3a, nothing advanced the camera window while the world was frozen for a player `Move` on a streamed map (finding F6): a 200-pixel
`Move` left `sw_cam_origin_x` at 0 and the PPU scroll at 0 for the whole walk, no strip was ever armed, and the first unfrozen frame
paid for it with a full redraw -- one body of **~1.08 million cycles** on the parent in every Move scene measured below. The `Move`
also carried a private copy of the walk's collision probe (`sw_move_probe`/`sw_move_probe_solid`), which would have had to be taught the
crossing the next slice enables. S3a makes `move_tick` call the **shared** `sw_pstep_left/right/up/down` driver the held walk and
knockback already use, and calls `sw_frame_camera_window` after each granted step. The F6 redraw is a **stale-camera / large-Move** defect: it appears when a Move moves
the player far enough that the unfrozen frame finds the camera window behind it (the 200-pixel scenes measured below), not "after every Move".

## What was built

- **`move_tick`** (`engine/entities.asm`, `move_tick_streamed`..`move_tick_ordinary`): the clip prefix is unchanged
  (`mv_step = min(raw, mv_left)`, the accumulator advanced exactly once in `move_speed_player`); then `cur_speed = mv_step`, `moving = 0`,
  `inc sw_step_nocross`, `jsr sw_pstep_<dir>`, `dec sw_step_nocross` (S3a; the inc/dec pair is gone since S3b); `moving == 0` is a blocked step (`move_wall`), anything else calls
  `sw_frame_camera_window` and `move_advance`, which subtracts the CLIPPED step. The shared labels `move_wall`/`move_advance`/
  `move_blocked`/`move_finish` are kept, so the ordinary-map path is byte-identical.
- **The ownership stop** (S3a only -- **deleted by S3b, 2026-10-04: see "S3b: measured outcomes" below; the byte, the guards and `move_tick`'s raise/drop no longer exist**) stayed, through one new byte: `sw_step_nocross` (`$077F`, `engine/constants.asm`). Each `sw_pstep_*` tests it at its
  crossing branch and refuses before any commit (`.if MOVE_ENABLED`, 5 bytes each). Slice S3b deletes the flag and enables crossings;
  S3a promises the shipped stop and `streamedmove*.test.js` / `streamworldclosemove.test.js` still assert it **unmodified**.
- **Deleted:** `sw_move_probe`, `sw_move_probe_solid` and their `_cross`/`_same`/`_no_dy`/`_have_dy`/`_solid_done` labels.
  `sw_terrain_or_fill_solid_type` stays (`sw_hazard_probe_cross` inlines it).
- **A behaviour change, recorded as a finding.** The shared driver probes both leading corners of the body (`BODY_L`=2, `BODY_R`=13,
  `BODY_T`=8, `BODY_B`=15); the retired private probe probed one. A vertical Move at x=243 is now blocked by the right neighbour's solid
  column 0 (x=242 completes). **The two horizontal cases (y=225) are behaviourally unchanged**: the retired probe and the shared rule both stop
  them at the bottom neighbour's row 0; the S3a report's "red" for them came only from needles that mutated code which no longer exists. Chris
  ruled (2026-10-02, option A) that a streamed `Move` collides exactly as walking does. Fix round 1 therefore edited the four shipped
  "vertical/horizontal probe inset" tests in `streamedmove.test.js` and nothing else in the `streamedmove*`/`streamworldclosemove` files: the
  vertical expectations follow the walking rule, and all four now mutate the shared driver itself (`sw_pd_c1`/`sw_pu_c3` `adc #BODY_R` ->
  `#BODY_L`, `sw_pr_c1`/`sw_pl_c1` `adc #BODY_B` -> `#BODY_T`), each shown failing on that real mutation.

## Ledger

| Term | Before | After | Note |
| --- | --- | --- | --- |
| `STREAMWORLD_MOVE_KERNEL_ALLOWANCE` (kernel-lo) | 117 | **83** (77 since S3b) | the 67-byte delegation span + the 16-byte streamed branch of `move_speed_player` |
| `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE` (kernel-hi) | 76 | **20** (deleted by S3b) | the four `sw_step_nocross` guards, 5 bytes each |
| `contentCeilingBytes`, action, Move | 1151 | **1207** | +56; no-Move shapes unchanged (2861 action, 1560 rpg). *S3a.5 +78 on all, then S3b -188 on the Move shapes: 1097 final* |
| `contentCeilingBytes`, rpg, Move | 1208 | **1264** | *1154 final (same two steps)* |
| relocated-dialogue ceiling, Move (`streamworlddialogueboundary.test.js`) | 2450 | **2506** | the authored figure moved with the term; *2584 after S3a.5, 2396 after S3b* |

Both allowances stay equality-asserted against nesasm by `kernelbytes.test.js` on action, rpg and action-mixed (the delegation-span test replaced
S1's probe-stage test).

## The measured frames (manifest row M11, Mesen full-system, gate `G <= 29,780`)

`test/lua/run_sw_move_manifest.mjs` (one cell), `run_sw_move_sweep.mjs` (a campaign), their one shared policy `sw_move_policy.mjs` (options, cell
identity, composition, the gate) and the compaction pair `sw_compact_actors.mjs`/`sw_compact_root.mjs` reuse the shipped manifest harness unchanged
and are **not** in `sw_provenance.mjs`'s `HARNESS_FILES` (`streambound-curve.json` pins that hash), so the recorded curve's provenance is untouched.
The scene is the shipped walk scene at the tile bound (15, wide and tight art, both game types, eight live actors) with the touch actor moved onto
the Down target and its event replaced by `[lead] + Move player down <dist> + [tail]`; bodies are classed by execution marks (`move_tick`,
`move_finish`), not by frame number.

**Three different bodies of evidence, kept apart.**

1. *The first sweep (S3a, before the fix rounds).* 752 cells (distance 150..165 so the final step meets every strip-arm phase, plus 200 and 240;
   tails none/Say/Flash/switch/second Move; the live tree and the parent beside it), 8.4 minutes, 0 bad: **one population, no bound tile**, no
   composition assertions. Its table is below; it is not the campaign.
2. *The saved campaign (fix round 1).* Fail closed, 16 jobs, ~45 minutes, five stages, **6,232 cells**: the strip-arm phase sweep (640), the seven
   measured Flash-lead arrangements of the final-body coincidence (280), populations of exactly 15 tiles (many-small, few-large 1-4 with seven
   zero-tile actors' overhead, front, back) and the same at 14 with the switch-bound tile (5,040), the P8 mixed-animation preset (240), and the Say
   lead (32). Table: `handoff-next/s3a/fix2/m11-table-saved-campaign.md` (the fix-1 table omitted the Say-lead rows). **Its `pops` stage holds 999
   capacity refusals: 481 new-engine and 518 parent.** 37 new-engine RPG bound-tile/Flash cells *succeeded* while their parent counterparts were refused,
   so "the parent beside every cell" is true of every cell except those 518: there is **no measured parent baseline** for them, and the "8.7-13.5k"
   parent figures are not a baseline for them.
3. *Fix round 2.* The refusals were not a property of the workload: they described one encoding of the scene (below). Round 2 adds the compaction, the
   5-, 6- and 7-actor distributions and the fail-closed policy; its measurements are listed under "Round 2": the `pops` stage re-run in one go (7,200 cells, 4,004 reused and
   re-validated, **3,196 measured in 958 s**, 0 problems over 7,052 gated rows).

**Maxima of the saved campaign (round 1, before round 2's additional cells; margins to 29,780).** Without a Say lead: M11a **action 23,113**
(`new/action/wide/back/P8/plain/tail-say/d159`), **rpg 19,366** (`wide/back/P8/plain/tail-flash/d159`); M11b **action 25,248** (`tight/many-small/P1/
tail-move2/d164`), **rpg 20,326** (`tight/many-small/P8/tail-move2/d164`). A Say lead's own step and final bodies are M11 rows too (only its pre-Move
close bodies are `before.*`) and reach **25,428** (action step, tight/many-small/P1/d200) and 16,113 (action final); rpg 20,504 and 13,549. **All-M11
maxima: action step 25,428 (margin 4,352), final 25,248 (4,532); rpg step 20,504 (9,276), final 20,326 (9,454).** No new-engine cell exceeds the gate.
(The first version of this paragraph quoted 22,702 / 18,946 for the no-Say-lead M11a maxima; the saved campaign holds the higher numbers above.)
The final-body coincidence is reachable only with a Flash LEAD (a Flash tail publishes a body late; a Say tail's 38-byte packet drains at the next NMI,
and a Say lead is closed before the Move by the close-for-Move barrier); three compositions are asserted per cell (`strip`: a 1..35-byte queue drained
with a strip already in flight in a reduced chunk, `arm`: the same drain on the body that arms the strip -- the heaviest -- and `pub`: the final body
publishes Flash's packet). The per-population table is `handoff-next/s3a/fix2/m11-table-saved-campaign.md`.

First sweep (round 0), one population, no bound tile (S3a engine **before** S3a.5's camera lever; the S3b-engine figures for the same scenes are in the reconciliation table below, about 4.8k lower on action and 2.4k on rpg):

| Row | action (wide / tight) | rpg (wide / tight) | parent, same scenes |
| --- | --- | --- | --- |
| **M11a** max mid-Move step | 25,264 / 25,462 | 20,330 / 20,534 | 10.2-10.7k / 10.0-10.5k |
| **M11b** final frame, Move alone | 21,081 / 21,285 | 17,338 / 17,542 | 8.4-8.9k |
| M11b + `Say` | 21,416 / 21,617 | 17,635 / 17,826 | |
| M11b + `Flash` | 21,251 / 21,453 | 17,515 / 17,719 | |
| M11b + switch effect | 21,304 / 21,508 | 17,561 / 17,762 | |
| M11b + second `Move` | 25,047 / 25,248 | 20,123 / 20,327 | |
| every body of the phase, worst | 28,860 | 23,962 | |

(Its M11a 25,264 / 25,462 are higher than the saved campaign's no-Say-lead step maxima; the first sweep included distances 200 and 240, which the
campaign's strip-arm phase set (150..165) does not -- the cause of the difference was not isolated. Both are under the gate.) The step frame is ~15k heavier than the parent's because the parent ran nothing the camera needed; that work
is exactly what F6 had omitted.

**Round 2 measurements (new this round, `handoff-next/s3a/fix2/m11-table-fresh.md`):** the 1,524 new-engine cells and 1,191 parent cells measured now,
including the few-large-5/-6/-7 populations (1,080 new-engine cells). Worst new-engine bodies among them: M11a **22,465** (action, wide, few-large-7,
margin 7,315), M11b **25,107** (action, tight, few-large-7, margin 4,673); RPG M11a **19,278** (margin 10,502; `new/rpg/wide/back/P1/bound/lead-none/tail-flash/d150/y60/compact`, whose parent is refused, 132 needed / 126 free, so it has no paired parent G or delta) and M11b 20,182. The wide few-large-7 row alone is RPG M11a 18,709 (parent 12,436; delta 6,273; margin 11,071). Parent worst beside them: 12,921 (M11a),
13,121 (M11b). Every one is under the gate, and **none exceeds the saved campaign's maxima, so the campaign maxima above stand**: action M11a 23,113
(25,428 with a Say lead), M11b 25,248; rpg M11a 19,366 (20,504), M11b 20,326. Deltas to the parent are 9.7k-10.1k (M11a) and 11.9k-12.9k (M11b) on
action, 6.2k-8.5k and 7.3k-10.5k on rpg. The full table of the whole campaign, in one place: `m11-table-final.md`. Parent baselines exist only for the
cells the parent could build: e.g. rpg wide bound few-large-5/-6 has 8 of its 45 cells measured on the parent.

**Round 2 (review 2): coverage, one policy.**

- *The RPG + bound tile + Flash scenes are buildable.* The scene builder gave each placed entity its own actor definition and defined a ninth,
  never-placed `DamageNpc`; every definition costs 8 lookup-table bytes. `sw_compact_actors.mjs` drops unplaced definitions and shares identical ones,
  and **proves** (`assertPreserved`) that every placed entity's actor body, tile count, position, trigger and script, and everything else in the
  project, is unchanged. `sw_compact_root.mjs` applies it at the build seam (the scene's own art assertions run first, on the uncompacted project; the
  harness files are untouched). The reviewer's RPG tight/P1/bound/few-large-2 Flash-lead scene (161 bytes of 160 uncompacted) builds on both engines and
  measures **identically to the reviewer's own run: new final 12,679, parent final 9,086** (q=35, st0=2, st1=2). Cells of an RPG project with a bound
  tile and a Flash command are identified `.../compact`.
- *Residue, ruled by Chris (2026-10-02).* Of the 3,196 cells the plan had to measure, 2,715 build and were measured (1,524 new-engine, 1,191 parent);
  **481 are still refused by the generator** even compacted: 74 new-engine refusals and 407 parent refusals: 74 matching partners plus 333 parent-only refusals. The 74 are RPG, wide art, a switch-bound tile, a
  Flash command, P1 animations, few-large-1 (165 table bytes of 160 free) and few-large-3 (163 of 160); the parent refuses the same 74 (it has 126 free).
  The bytes are the art itself, so no content-only change helps (neither does grid size: `handoff-next/s3a/fix2/grid-probe.mjs`, `tables-probe.mjs`).
  **Ruling: accepted as unreachable exclusions**, by one explicit rule (`UNREACHABLE_ARRANGEMENTS` / `acceptedUnreachable` in
  `run_sw_move_sweep.mjs`: that exact shape, population, byte figure on both engines, new engine at 160 free and parent below it), pinned by tests to
  exactly those 74 planned cells. They stay visible in the verdict (`accepted`, with `excluded`) and are never counted as measurements. Every other
  new-engine refusal is still a problem; the 333 further parent-only refusals are `parentUnavailable` (no parent baseline, recorded, none invented).
  The verdict of the re-run: `ok`, 0 problems.
- *Populations.* `populations()` now also has few-large-5, -6 and -7, so every actor-count distribution 1..8 (and front/back) is planned at 15 and 14
  tiles on all four project shapes.
- *One policy, fail closed.* `sw_move_policy.mjs` is the only definition of the options, the cell's identity, its required composition and which rows
  are gated; the campaign (`verdict`) and the standalone command (`run_sw_move_manifest.mjs`, now exit 2 on any unknown or malformed option or a full
  machine, exit 1 on an unsound or over-gate cell) both use it. **A Say lead's step and final bodies are gated**; only its pre-Move close bodies
  (`before.*`) are diagnostic. A new-engine refusal fails unless it is one of the explicitly approved 74 cells with its matching parent refusal. `--reuse` re-validates saved results under the
  current policy, `<out>.partial` makes a long run resumable, and `--only` (an unverifiable subset) is gone.

**A pre-existing failure the sweep found, not caused by S3a (known, out of scope).** A `Say` *before* the `Move` (the close-for-Move barrier) on
an **action** project has six consecutive bodies of ~38.6k cycles (`main` ~37.2k, the box's close packets draining at 35 bytes) -- the same six
frames, to within 15 cycles, on the parent (38,646 against 38,633). The RPG rows pass. Review 1's attribution: the close span is **29,227
cycles** and contains **16 `sw_peek_byte` reads**, i.e. the dialogue-restoration path re-reading the streamed world while it restores the
screen under the box. It is a **dialogue-restoration performance issue**, outside M11(a) (a mid-Move step) and M11(b) (the final Move frame),
which `run_sw_move_sweep.mjs` classes separately (`before.*`, the pre-Move close bodies, are the only exempt ones; the same cell's own step and final bodies are gated). The text-box Move is behaviourally unchanged
(`streamworldclosemove.test.js` is green and unmodified); its frame cost is a shipped property that S3a neither created nor changes.

## Tests

T1/T1v (`streamedmovecamera.test.js`): 12 tests, all 12 fail on the unfixed engine (the first divergence is frame 14 on screen 0 and frame 1 on
screen 1 and in the vertical case: the origin stays at 0 while the player ends at x=254; the vertical case stays at 138 against an expected 358). T3-T6 and T5b (`streamedmovestep.test.js`, 41): the clipped step, the single
accumulator advance, blocked detection, the inset scenes and an executed-path trace that no PC of a Move falls in a probe of its own. T8
(`streamedmovevram.test.js`, 10): the final-frame VRAM envelope -- a strip alone takes full chunks of 3, Flash's 35-byte packet shares the vblank
with a 2-chunk reduced strip, and Say's 38-byte packet takes the exclusive drain only after the strip has finished. The identity matrix
(`identitymatrix.test.js`) covers 40 shapes, and a rewritten certifier (`test/lua/sw_identity_cert.mjs`) re-derived every recorded sweep job's
ROM (10,893 matched, 643 resolved reuses, 0 mismatches) so the bound curve stays valid for the S3a engine; its certificate is
`test/fixtures/identity-cert/s3a.json`. **Consequence:** any later engine or generator edit now needs re-certification (about 90 s).

*(S3a.5, 2026-10-02/03, history above not rewritten.)* The camera lever changed every streamed ROM, so that certificate (10,893 of 10,893 direct records mismatched on the new engine, as they must) no longer pins the checked-in curve, and the recorded curve was re-swept on the new engine (12,590 jobs, 68 min for stages A, B, C, R, F plus 2 min for the probe). Under the new engine the S1 rule's second fact could not be met as written: stage F's 500 candidates per curve at 17 / 16 found no failing row (worst 25,130 / 25,227 against the 29,780 gate), the cliff is at n = 56 plain / 54 bound tiles, and an exhaustive partition stage at a certified n there is about 219,000 jobs per curve (about 20 hours). **Chris ruled (2026-10-03, option 1): the shipped bounds stay 15 / 14 and the second fact is amended**: the certified n (16 / 15) is the policy figure, and a bounded probe (`plan P`, the record's `probe`) records the cliff with each failing row confirmed by an isolated re-run, the cliff at least certified+2. Fact 1 (exhaustive at the certified n) is unchanged. The spare cycles stay as headroom for S3b's Move ring and S4. Not chosen: raising the bound, sampling stage C, re-running the old rule at 17 / 16. The rule is written in `test/lua/sw_bound_sweep.mjs`'s header, enforced by `streamtilebound.test.js` and described in `docs/reference-engine.md`; `run_sw_cadence.mjs` keeps its walk at 15; `overrun-p` is the probe shape at the plain cliff (n = 56, Flash x 241) and `overrun-b` is the x = 242 variant at the probe's bound cliff population (n = 54). *(S3a.5 fix round 1, 2026-10-03: `test/fixtures/identity-cert/s3a.json` was deleted as superseded; it bound the pre-lever curve and could not certify the new one. `streamtilebound.test.js` now passes through its exact-current-source branch, the record's recorded engine and generator equalling the live ones, and an absent certificate directory certifies nothing, as that test's own non-vacuity check pins. The text above is kept as the history of S3a.)*

*(S3b fix round 1, 2026-10-03.)* **S9b — the discard reset in `settle_owed` is kept, and is not claimed killed.** Sabotage S9b (the `settle_owed` discard branch
without `sw_talker_reset`) survives every test, because it is an equivalent mutant on every *reachable* path, not on every path: an event's end resets the talker
identity through `close_ui` (script end, `box_close`), a Load/Continue/restart through `init_session`, and a valid warp through `take_door`, each before
`settle_owed` can see an inactive pending slot, and `settle_owed` itself requires gameplay. The five kernel-lo bytes stay as defence in depth against a future
path that skips those three; there is deliberately no test that "kills" the mutant, because a test would have to poke an unreachable state, and the kernel
allowance is priced with the bytes in (`TALKER_KERNEL_LO_ALLOWANCE_SETTLE`, 5, equality-asserted by `kernelbytes.test.js`).

## S3b: measured outcomes (2026-10-04)

Slice S3b deletes S3a's ownership stop: a scripted player `Move` on a streamed map crosses a seam exactly as a walking step does, and the
event it belongs to keeps its talker (`talk_rec`/`talk_scr`/`talk_crossed`/`owed_enter_rec`, Rule R, `sw_battle_resume`; mechanism and pins in
`docs/reference-engine.md`, "The talker across a seam", and `docs/reference-event-system.md`). The Map Forge's "a Move cannot cross" warning is
deleted with it. Everything below is **measured on the final tree**, not designed: Mesen runs of step D and RS, 2026-10-03/04. The S3b report
(`handoff-next/streamed-worlds-phase3a-s3b-report.md`) holds the raw launch tables.

**Kernel (details and the per-site table: `docs/reference-kernel-budget.md`, "Phase 3a slice S3b").** kernel-hi +188 (talker 196 + 12 crossing calls,
minus the deleted 20); kernel-lo +13 action / +16 RPG (talker call sites 19, +3 for `battle_end` on an RPG, minus 6 from
`STREAMWORLD_MOVE_KERNEL_ALLOWANCE` 83 -> 77), so an RPG Move scene has 144 free lookup bytes where it had 160. `contentCeilingBytes`, Move shapes:
action 1,285 -> **1,097**, rpg 1,342 -> **1,154** (every other shape unchanged; the relocated-dialogue Move row 2,584 -> **2,396**).
The five capacity-refusal groups (74 + 111 + 89 appendix + the 66 originals = 18 `origParentRefused` + 48 `origNewRegression`) are exact-ID, kept apart and
never coverage; the final aggregate has 13,808 results, 0 problems and 0 refusals outside a group.

**Reconciliation table (the long-`Move` envelope, M11, worst frame G against 29,780).** The numbers that looked contradictory were different workloads
on different engines, not a regression. Per row: the engine, the workload, the worst M11a (an ordinary **nonfinal, noncrossing** mid-Move step body, pre-seam row-arm bodies included), M11b (the final `move_finish` body; in the S3b rows,
the **noncrossing** final bodies -- a final body that crosses is M11c) and M11c (the crossing bodies), action / rpg. M11a and M11b are exclusive in the S3b rows.

| Row | Engine | Workload | M11a | M11b | M11c |
| --- | --- | --- | --- | --- | --- |
| First sweep (round 0) | S3a, before S3a.5 | one population, no bound tile, distances 200 and 240, no `Say` lead | 25,264-25,462 / 20,330-20,534 | 21,081-21,285 / 17,338-17,542 | (no crossing: the stop) |
| S3a campaign (`handoff-next/s3a/fix2/m11-table-final.md`) | S3a, before S3a.5 | the `phase` set stops at distance 165; distance-200 cells carry a `Say` lead; many populations incl. bound tiles | 23,113 (25,428 with a `Say` lead) / 19,366 (20,504) | 25,248 / 20,326 | (no crossing) |
| **S3b long-`Move`** (L1, L3 `x1`-`x3`, L4) | S3b (carries S3a.5's camera lever) | distances 166-230 x four projects x five tails, the six historical P0 rows, touchY phase, a populated destination (`x3`), leads, animations, populations | **21,257** / **18,660** (`x3`, populated destination, pre-seam arm; `x1` alone 20,697 / 18,122; L1 20,668 / 18,080) | **20,865** / **18,297** (`x1`; L1 phase 20,521 / 17,936; L4 20,506 / 17,923) | unpopulated crossing floor `x1` 11,045 / 9,644, `x2` 10,743 / 9,338; populated `x3` 17,375 / 15,962 |
| **Composed crossing** (L3 `x4`, `x5h`, `x5r`, `x6`) | S3b | a real populated destination (eight actors, an enter `Set`), a Flash/`Say` lead and tails, horizontal classes `hseam-a`/`hseam-b`, a return `Move`, hand-written code | `x5h` 19,721 / 17,163 | `x5r` 16,936 / 15,516 (noncrossing final bodies) | `vseam` `x4` 23,909 / 21,323; `x6` code 23,646 / 21,149; `hseam-a` 23,329 / 20,751; `hseam-b` 26,138 / 23,566; `x5r` `hseam-b` 26,176 / 23,613, `return` 18,030 / 17,220 |

**The worst gated Move/crossing bodies of the phase are composed horizontal crossings, M11c: 26,176 (action, `x5r` `hseam-b`, margin 3,604 under the gate) and 23,613 (rpg, margin 6,167).** No **gated Move or crossing body** exceeds 29,780. (The exempt, ungated `before.*` close-for-`Move` maximum, 38,641 cycles, is a separate pre-existing case: below.) The parent's own Move bodies measured in the same campaign top out at 21,262 / final 20,877 (6,723 parent
cells). The six historical P0 rows replayed on the S3b engine, against the parent re-measured today and the historical figure:

| Row (distance 200, no `Say` lead) | historical | 15c11b7 today | S3b |
| --- | ---: | ---: | ---: |
| action wide / `say` tail | 25,264 | 20,510 | 20,466 |
| action tight / `say` tail | 25,462 | 20,714 | 20,663 |
| rpg wide / `flash` tail | 20,330 | 17,926 | 17,916 |
| rpg tight / `flash` tail | 20,534 | 18,133 | 18,119 |

The drop from the historical column is S3a.5's camera lever (about 4.8k on action, 2.4k on rpg); S3b's step bodies in the four paired rows above are 44, 51, 10 and 14 cycles below the parent's
(S3b removes a guard per step and adds none). **A pre-existing exception, unchanged and exempt:** the `before.*` close-for-`Move` bodies of an action
`Say` lead are 38,641 cycles (rpg 28,942), the dialogue-restoration cost documented in S3a; the same cells' own step and final bodies are gated and pass.

**The bound is unchanged: 15 / 14.** `STREAM_TILE_BOUND` 15 and `STREAM_TILE_BOUND_WITH_BOUND_TILES` 14 (certified n 16 / 15, probe cliff n = 56 plain at
31,253 cycles / n = 54 with bound tiles at 31,243, margins 4,768 / 4,669 against the tightest passing rows 25,012 / 25,111). RS re-swept the whole record on the S3b engine
(12,590 jobs, 98 probe records, 89 min 42 s) and every `maxG`, `gateFail`, confirmation and probe row came out identical to S3a.5's; the provenance stamp moved
(engine `aaa235270e07`, generator `e4cd0e975976`) and **seven tied worst-scene witnesses** changed (rows 835, 837, 887, 1101, 1489, 1901 and 1902, each at equal G, e.g. row 835 back split -> front split at 24,009); no timing figure or bound changed. The rebuild check matched 11,712 of 11,712 Mesen-run records, the ROM-identity certificate is
`test/fixtures/identity-cert/s3b-rs.json` (11,712 / 11,712), the cadence check passes 3/3, and `shared/streambound.js` was not edited
(`docs/reference-engine.md`, "The S3b re-sweep"). The older `s3b-stepC.json` certified the S3a.5 sweep's records and no longer described a curve file in the tree; **retired after the final review
(2026-10-04)**, moved to `handoff-next/s3b/impl/retired/s3b-stepC.json` (README there), superseded by `s3b-rs.json`.

**L5 and X5.** L5 (the 24 talker + scripted-`Battle` cases of `streamedtalker.test.js` T5/T6, all RPG, replayed through Mesen's independent core by `test/lua/sw_talker_battle.mjs`): **24 cases, 24
completed, 0 failed.** X5 (`handoff-next/s3b/impl/fix1/classaprobe.mjs`, a dev probe, not a gate; 312 runs, 0 error rows) confirms the horizontal class-(a)
composition on the leads that build: action plain, 26 alignments each, hseam-a hits `ref` 26, `lr1` 8, `rl1` 8, `r1` 4, `r2` 8, `l1` 4, `ud1` 8 and `flashflash` 0 (it
produces no hseam-a body), all 26 runs of every lead crossing; rpg with a bound tile, `lr1`/`rl1`/`r2`/`ud1` 8 hits each. Worst hseam-a G **23,335** (action,
`r1`) and **20,687** (rpg bound, `lr1`). **The RPG-bound `ref` lead is a capacity refusal, not covered:** it errors on all 26 alignments with the generator's
"lookup tables need 128 bytes but only 101 are free"; `flashflash`, `r1` and `l1` were never run on RPG-bound.

**No new 6502 trap was hit.** The slice applied two existing ones with their regression tests: a routine answering with a stored sentinel must load it explicitly, never
leave a leftover accumulator (`sw_talker_cross`'s `lda #NO_ENTITY` before `cpx`, pinned by the decoy-record case in `streamedtalker.test.js` T5), and a
routine whose caller branches on Z must say what Z holds (`sw_talker_reset` ends with `lda #0`, so `settle_owed`'s `beq` reads it as set).

**Stale statements this slice made false, dated rather than rewritten above:** the "ownership stop stays" bullet, the S3a ledger and the first-sweep table in this file;
`docs/reference-engine.md`'s "never crosses ... slice S3b deletes the flag" and "S3b headroom" sentences; `docs/reference-kernel-budget.md`'s `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE = 20`,
`= 83`, "1207 / 1264" and "2506 after S3a" figures; and the Map Forge warning documented in `docs/reference-event-system.md`.
