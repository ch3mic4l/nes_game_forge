# Design: camera / scroll control (ROADMAP item 12)

Status: design only, fix round 3. No engine, generator, renderer, schema or test file in the real
tree is touched — every code sample below was written and assembled in the same throwaway scratch
copy rounds 1/2/3 used, never in `/home/chris/nes_game_forge` itself. Written against HEAD `7810848`
(clean, `master`); the scratch copy's off-path output stays byte-identical to a fresh build of that
exact commit throughout this round too (re-verified after every edit, including the last one).

Round 2's reviewer (`handoff-next/camera-design-1-review2.md`) found one P1 and seven P2s, verdict
FIX, all addressed in round 2. **Round 3's reviewer**
(`handoff-next/camera-design-1-review3.md`) found seven more P2s, verdict FIX — the most severe
being that round 2's own edit had **deleted** substantial closed content from this document,
replacing full sections and appendices with hollow "unchanged from round 1" pointers to text that
no longer existed anywhere in the file. All seven are addressed below; §11's own changelog lists
every finding's disposition. **The publication P1 and the c-lite loop bug (round 2's own findings 1
and 2) are confirmed closed in the code and are not re-touched this round** except where a specific
round-3 finding names them.

## 11. Changelog

**Implementation outcome (phases 1-3 shipped, 2026-09-16/17)**, prepended ahead of the design rounds
below (this design shipped as `51d1a36`; phase 1 `34b4c96`; phase 2 `cba27dc`; phase 3 `65eabda`).
The shipped build implements candidate (b)'s register and slide mechanism, with the implementation
differences listed below. It renamed the six camera ledger constants and re-measured two of them
lower, because candidate (b) never needed the design's own candidate-(a) `_for` shims once actually
built — `set_screen_ptr`/`rebuild_bound_cache` already read `<flat_screen` internally, and (b)
never draws the outgoing screen, so `engine/camera.asm` calls them directly rather than through a
parametrized wrapper. `main/build/generate.js`'s own comment above
`CAMERA_SLIDE_KERNEL_ALLOWANCE` has the full decomposition, cited below.

- `CAMERA_PHASE1_KERNEL_ALLOWANCE` shipped as `CAMERA_KERNEL_ALLOWANCE`, unchanged at **20**.
- `SHAKE_CAMERA_PHASE1_INTERACTION` shipped as `CAMERA_SHAKE_INTERACTION_ALLOWANCE`, unchanged at
  **19**.
- `CAMERA_B_CONSUMER_BASE` (303) shipped as `CAMERA_SLIDE_KERNEL_ALLOWANCE`, re-measured at **298**
  — the prototype's own `set_screen_ptr_for` shim cost +5 over the shipped plain `jsr
  set_screen_ptr` (the shim itself +5 bytes, minus the 4 bytes it let the original routine drop,
  plus the 4 bytes its own two caller-side `ldy <flat_screen` sites cost: +5 -4 +4 = +5).
- `CAMERA_B_AXIS_ALLOWANCE` shipped as `CAMERA_AXIS_KERNEL_ALLOWANCE`, unchanged at **52** — it
  never depended on the `_for` shims.
- `CAMERA_B_SPLIT_INTERACTION` shipped as `CAMERA_SPLIT_INTERACTION_ALLOWANCE`, unchanged at **6**
  — it never depended on the `_for` shims either.
- `BOUND_TILE_CAMERA_B_INTERACTION` (13) shipped as `BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE`,
  re-measured at **6** — the prototype's own `rebuild_bound_cache_for` shim nets a separate +7 the
  same way (+5 shim, -2 for the one `ldy <flat_screen` the original no longer needs, +4 across two
  caller-side `ldy`s: +5 -2 +4 = +7); the shipped build's two plain `jsr rebuild_bound_cache` calls
  cost 3 bytes each (6 total) when `BOUND_TILE_ENABLED` is live, with no shim-shaped
  argument-passing cost on top.
- One live axis therefore totals `20 + 298 + 52 = **370**`, five bytes under this document's own
  375-byte prototype total — exactly the slide base's own 303 → 298 saving, since the axis and
  register terms are unchanged. The bound-tile interaction's own 13 → 6 saving is separate and
  only paid (or saved) by a project with switch-bound tiles live, so it is not part of the
  one-axis figure above.
- `draw_screen_at` shipped as specified (Appendix C's own shape); `draw_screen` became its
  two-instruction wrapper (`lda #0` / `jmp draw_screen_at`) rather than a separate parametrized
  routine, in a `CAMERA_SLIDE_ENABLED` build — the original `draw_screen` body is kept
  byte-identical when the flag is off.
- `cameraAxes` (§5/Q3) shipped with the specified axis-resolution logic and optional access to
  `cartridge?.mirroring`; `describeCameraAxes` was added beside it in phase 3, for the Build
  panel's own hint text — not specified here, since Q8 only asked for the indicator's existence,
  not its own helper function.
- The checkbox lives in the Build Forge's **Cartridge section, beside Mirroring** — not the Map
  Forge. §8's "Map Forge checkbox" phrasing was a slip; Q8's own "a checkbox beside the mirroring
  selector" was the actual intent, and `project.cartridge` has exactly one editing surface
  (CLAUDE.md's own single-writer discipline) for `renderer/forges/build/build.js` to extend.
- The per-edge "this edge will cut, not slide" tileset-mismatch note (§8, Q8) was **not built**: a
  tileset is a per-map property and `flattenScreens` (`main/build/generate.js`) never pairs
  neighbouring screens across a map boundary, so no authoring path in this codebase can ever produce
  a mismatched pair for the note to warn about (`handoff-next/camera-phase3-report.md`'s own
  "Decision 6 reading"). The engine's own tileset-compare cut fallback (`cross_right`'s
  `screen_tileset` check, among others) is kept as defence in depth regardless.
- The mirroring row shows on **every** board once camera is on, not only UNROM 512 — with the
  camera on, mirroring picks the sliding axis on every board, not just the four-screen one.
- §7's First-visible-frame row is satisfied by phase 2's own test,
  `test/unit/camera.test.js`'s "the coordinate lands on the PPU before rendering turns on, both at
  arm and at completion".
- Chris's own §9 answers: candidate (b), the player sprite pinned at the landing position, a fixed
  16 frames, slide-only for v1. Left open, each its own future design round: phase 4 (MMC1/MMC3
  runtime re-mirroring), a `Pan` cutscene verb, item 15's own streaming consumer, and an
  author-visible speed control.

**Round 6 nits**, listed first among the design rounds (round 6's own brief: `handoff-next/brief-camera-design-nits.md`;
review addressed: `handoff-next/camera-design-1-review6.md`, verdict **GO**, three P3 nits, applied
exactly and nothing else): (1) the stale "65 cycles" worst-case Shake+camera figure in §1 (two
occurrences) replaced with the authoritative table's own 83, with the mistake's own cause noted
inline (the 65 figure omitted the 18-cycle snapshot refresh finding 1 added); (2) Appendix F's
`constants.asm` diff — comment-trimmed against the scratch tree's own real diff, leaving its hunk
count stale and `git apply`-uncheckable — regenerated verbatim from `git diff 7810848`, verified
`git apply --check` clean against a fresh `7810848` checkout for all six printed diffs (boot,
screens, player, constants, main, generate.js); (3) three historical-formula passages that still
read as live instructions marked superseded and corrected: the `~line 488` "charge the flat 323
base" instruction now points at the disjoint register/consumer split; `~line 980`'s wiring
reference now names the current `CAMERA_PHASE1_KERNEL_ALLOWANCE`/`CAMERA_B_CONSUMER_BASE`
constants, not the retired `CAMERA_B_SHARED_BASE`; `~line 247`'s description of the double-count is
corrected from "323 + 52 was wrong" to the accurate "the wrong expression was `20 + 323 + 52`" (323
+ 52 was always the correct total).

**Round 5 revisions**, listed next (round 5's own brief: `handoff-next/brief-camera-design-fix5.md`;
review addressed: `handoff-next/camera-design-1-review5.md`, verdict FIX, three P2s + one P3):

- **Finding 1 (P2, the published listings did not implement the register/consumer gate split the
  scratch tree actually built)**: fixed. Appendices A, C and F regenerated verbatim from the scratch
  tree's own `git diff 7810848` — the frozen-world branch and every consumer conditional correctly
  read `CAMERA_SLIDE_ENABLED`, `nmi_scroll`'s own register/NMI rewrite correctly keeps
  `CAMERA_ENABLED`. Q6 states that one project predicate (`projectUsesCamera`) emits both flags
  together in the shipping product, that the two-flag split exists only for this document's own
  build-phase isolation measurement, and the invariant `CAMERA_SLIDE_ENABLED ⇒ CAMERA_ENABLED` holds
  by construction of the generator expression. Fixed the report's own stale "A/C/F unchanged" claim
  and added the environment-variable reproduction note to Appendix H.
- **Finding 2 (P2, the phase-1/consumer ledger double-counted the register path)**: fixed. The old
  `CAMERA_B_SHARED_BASE = 323` was measured against camera fully off and already contained the
  register gate's own 20 bytes; adding a separate 20 on top (as round 4's own phase-1 contract did)
  double-counted it. Replaced with two disjoint terms — register gate 20 (+19 with Shake), consumer
  gate 303 (measured incrementally against a phase-1-on build, not camera-off) + 52/axis + 6 split +
  13 bound-tile — verified directly on NROM and MMC3 (textless and with text), confirming
  303/303+6 exactly. Full one-axis totals and absolute-reservation margins unchanged (375/381,
  31/20); only the internal attribution was wrong before.
- **Finding 3 (P2, the dispatch-stop regression row described an engine path that cannot execute)**:
  fixed. `do_talk` explicitly skips `BEH_DOOR` (a door is walked through, not spoken to), so the
  round-4 door-based scenario was never reachable. Replaced with an ordinary NPC actor whose event's
  first command is an unconditional Warp — traced and verified the real synchronous call chain
  (`do_talk → start_dialog → script_op_warp → script_finish → box_close → close_ui`, all within one
  `do_action` call) with a real, executed jsnes scenario (real B+Select controller presses): the real
  engine lands the warp the same frame and suppresses the later action; the executed mutant (the
  `screen_fresh | warp_ready` stop condition removed, then reverted) lets the later action fire and
  strands the already-queued warp behind the menu it opened.
- **Finding 4 (P3, three harness assertions were weaker than their own labels claimed)**: fixed.
  Bound-ready preflight now uses independently expected opcodes, not a self-referential re-read;
  per-site hit counts are asserted exactly 1/1, not a shared total ≥ 2; the exact NMI sample count
  (19 for the four deterministic slide fixtures) is asserted, with the ≥16 floor kept as the
  documented fallback for non-deterministic content.
- **Also**: the master table's legend now distinguishes figures retained from earlier rounds from
  this round's own fresh measurements; the cut-heavy harness gained a real NMI deadline-check and
  exact-count assertion (5), closing the "mask-timing only" gap.

**Round 3 revisions**, listed first (round 3's own brief: `handoff-next/brief-camera-design-fix3.md`;
review addressed: `handoff-next/camera-design-1-review3.md`, verdict FIX, seven P2s):

- **Finding 1 (P2, round 2's own edit had deleted closed content, replacing it with "unchanged from
  round 1" pointers to text that no longer existed anywhere in this document)**: fixed. §8, Appendix
  C, Appendix F's `main.asm`/`generate.js` diffs, Q4, Q6, the frozen-world-gate subsection, §6's own
  round-1 findings, the Q3 hint strings, and §0's nine-caller inventory/NT-address-derivation/
  `switch_prg_bank`-Y-preservation evidence are all restored in full. §9 rewritten so every item
  states its *current* recommendation in place, never "see round 1." Per-section character counts:
  see the round-3 report.
- **Finding 2 (P2, the ledger formula double-counted MMC3's split interaction into its own base)**:
  fixed. MMC3's isolated shared base is 323 (not 329), measured directly on a textless MMC3 build;
  the base collapses from a per-mapper table to one flat constant; `CAMERA_B_SPLIT_INTERACTION = 6`
  is charged only through `SPLIT_ENABLED`. Real absolute-reservation tuples computed against the
  actual `kernelCodeBytes` function (§5/Q5).
- **Finding 3 (P2, `cameraAxes` resolved the raw mirroring string against the global `MIRRORING`
  array, not the candidate mapper's own legal set)**: fixed and verified against the real, unmodified
  `shared/cartridge.js` — a four-screen UNROM 512 project evaluated as any other board now correctly
  answers H-only (§5/Q3).
- **Finding 4 (P2, the Appendix G harness set `completed` on entry to the completion routine, and
  checked `vram_len > 256`, a byte, which can never fire)**: fixed with a full harness rewrite,
  discriminating genuine completion from the 15 ordinary ticks sharing the same exit label, an
  independently-predicted `vram_buf` workload, and a byte-for-byte NT0/attribute compare against an
  independent JS-built reference read through Mesen's own PPU memory (Appendix G).
- **Finding 5 (P2, the "heavy workload" Flash was on the incoming screen, whose event cannot fire
  until after completion)**: fixed — Flash is now injected via a breakpoint at `redraw_screen_slide`'s
  own entry, verified to actually exercise `vram_reset`'s Flash-cancellation path (one real
  `vram_open`/`vram_end` pair). Both candidates run on the identical heavy workload; mask timestamps
  reported under one frame-labelling convention with no overlap (§3).
- **Finding 6 (P2, the cycle table undercounted the Shake-dirty-positive-wrap row by 6 cycles, and
  the RAM reservation was published as feature-liveness-conditional)**: fixed — one cycle table (46/
  29/83/66) used consistently in §1, §2 and this report; the RAM reservation is a flat 12 bytes,
  unconditional, for (b) (§2). A branch-page-penalty note added to the deadline check's own
  verification methodology.
- **Finding 7 (P2, several §7 rows exercised the wrong mechanism or claimed the wrong outcome)**:
  fixed — the dispatch-stop row now uses two real `dispatch_input` actions (never a direction); the
  owed-before-buttons row's competing event requests a different warp; the diagonal-crossing row
  attributes axis priority to `update_player`, not `dispatch_input`; the stale-slot and arming-frame
  rows' outcomes are restated precisely; two c-lite regressions and the touch-walk-off re-arming row
  are added; every synthetic test is labelled as such (§7).
- **Also**: §2 now states the coherent-stale-frame policy explicitly (an NMI interrupting a locked
  wrap shows the last complete snapshot for that whole frame; 16 logical ticks are not a guarantee
  of 16 distinct displayed positions).

**Round 2 revisions**, listed next:

- **Finding 1** (P1, the publication lock still permits torn coordinates, and its fallback violates
  the post-drain scroll contract): fixed, two independent defects. (a) Every wrap path raised
  `cam_dirty` *after* the low-byte store, not before — reordered so the lock now covers both stores
  on every wrap path in every candidate ((a)/(b)/(c-lite), twelve sites total). (b) "Skip the
  $2000/$2005 write when dirty" does not retain the previous coordinate, because NMI's own
  `vram_buf` drain (and the `PALETTE_FX_ENABLED` PPUADDR cleanup) already moved the PPU's `v`/`t`
  register before `nmi_scroll` ever runs — CLAUDE.md's own rule stands: the scroll must be rewritten
  after every drain, unconditionally. Fixed with an NMI-owned last-complete snapshot
  (`nmi_cam_x_lo`/`nmi_cam_y_lo`/`nmi_cam_nt`), refreshed from `cam_x_lo`/`y_lo`/`nt` only while
  `cam_dirty` is clear, and *always* what gets composed with Shake and written to $2000/$2005 —
  every vblank writes a complete coordinate, fresh or stale, never skipped. Costs 3 more RAM bytes
  and re-measured NMI cycles (§2, §7). Two new regression tests in §7 (an NMI landing mid-wrap; a
  dirty-set frame with a packet also draining the same NMI).
- **Finding 2** (P2, `cl_emit_row` clobbers X, the row budget, so one tick emits all 32 rows):
  fixed. The row budget now lives in a dedicated `cl_budget` byte, never in X — `cl_emit_row`'s own
  clobbers are documented on its header. Reproduced the bug first (one tick, 63,601 cycles, `cl_row`
  0→32, matching the reviewer's own reproduction exactly), then reproduced the fix working (one
  tick, `cl_row` advances by exactly 2, `vram_len` settles at 70) — both via direct CPU stepping,
  the same isolated-routine technique the reviewer used. Re-measured: +515 bytes (up from the
  round-1 buggy build's +500), and the corrected total tick count is **49** (16+16+16 plus the FLIP
  tick), confirmed by driving the whole state machine to completion, not merely one tick.
- **Finding 3** (P2, c-lite never cancels Flash/Shake/flip backlog, and simply inserting
  `vram_reset` would be wrong since it needs forced blank): **not re-engineered this round, per the
  brief's own instruction** ("do not design a rendering-on cancellation handshake in this round").
  Instead, every sentence calling c-lite a "foundation" or "validated" is corrected: it is now
  labelled, throughout §1/§3/§5/Q7/§9, an **explicitly experimental row-copy sketch**, with the
  cancellation problem and the column-major problem both named as open, unsolved questions for
  item 15's own design round — an *input*, not a foundation. The repaired byte/tick numbers are
  kept as a real, useful lower bound on what streaming costs, not as evidence the mechanism works
  against live Flash/Shake/flip.
- **Finding 4** (P2, the ledger mixes (a)'s costs with (b)'s, and RPG evidence was for the wrong
  candidate): fixed. One formula for (b), every term isolated by its own two-build delta: shared
  base 323 (329 on MMC3, live split), +52/axis, +6 split interaction (two `sta $E000`, not one —
  the round-1 prose saying 3 is corrected), +19 Shake interaction, +13 bound-cache interaction. The
  reviewer's own source-read cross-check (base 311, +52/axis, +6 split) is close to, but not
  identical to, the real measured base (323) — the gap is finding-1's own repair, applied after the
  reviewer's own estimate was written; the measured figure is what the table uses. (b) rebuilt and
  measured on `sample-rpg` (MMC1) and mkdtemp RPG variants on MMC3/UNROM 512: **every RPG delta
  exactly matches its own board's action-side delta** — no RPG-specific interaction term exists,
  confirmed by direct measurement, not analogy. The `8192-used` table is replaced with the real
  `assertCovers` shape (`test/unit/kernelbytes.test.js:287-317`) and a worked example against
  measured `codeBytes` (§5/Q5, §7).
- **Finding 5** (P2, the registry has eight boards, the table had four): fixed. All eight measured:
  CNROM, GxROM, Color Dreams and UxROM give the *identical* +375 one-axis delta NROM/MMC1/UNROM 512
  already had — confirmed by building on each, not assumed. A `cameraAxes(mapper, cartridge)` helper
  is specified (`shared/cartridge.js`), resolving through `mirroringById`/`mirroringOptions` rather
  than a raw string, consumed uniformly by the generator, ledger, hints, `switchableMappers` and the
  Build panel. `switchableMappers`' own camera rule is stated (a candidate that would silently lose
  an axis is excluded, matching the existing tileset/mirroring precedent, not merely noted).
  Switching away from four-screen is described (the vertical axis is lost, `reconcileCartridge`'s
  existing coercion to `vertical` is what does it, and where the UI shows it). The "neither axis"
  shape is dropped as a real state — confirmed unreachable by reading `normalizeCartridge`/
  `reconcileCartridge` directly, not merely asserted.
- **Finding 6** (P2, the Mesen harness proved mask intervals, not the transition): fixed. Appendix G
  is a new, complete rewrite: PC-breakpoint assertions on the crossing stub, the slide arm, the
  exact tick count, the completion routine, `vram_buf` bounded every frame (sampled pre-drain, not
  post-), and the NMI deadline met on every frame of the crossing (the `flash_nmi_timing.lua.template`
  dot-carry shape) — exits non-zero on any violation. Run on a new worst-case fixture (eight active
  switch-bound entries on both screens, a hold-terminal Flash at the crossing): **the transition
  still completes correctly and every NMI still meets its deadline, but each of (b)'s two blanks
  grows from 1 frame to 2 consecutive frames under this content** — a real, measured, content-
  dependent result, added to §9 as part of what Chris is accepting. **SUPERSEDED (round 4): this
  round's own jsnes-approximated worst-case fixture undercounted the real cost — the real, Mesen-
  measured figures (round 3's own real-Mesen fixture, round 4's own cut-baseline addition) are
  5+4=9 blank frames for (b) under heavy content, not "grows to 2" — see §3's master table and §9.**
- **Finding 7** (P2, the shipping RAM contract omitted two live bytes): fixed. (b)'s real allocation
  is republished in full: nine bytes without finding-1's fix (matching the reviewer's own count —
  `cam_far` and `nmi_tmp` were wrongly dropped from round 1's "seven"), **twelve** with it (the three
  `nmi_cam_*` snapshot bytes). §1's "+12 bytes/cycles" is corrected to the real figures: **+8
  bytes/+12 cycles before the finding-1 repair** (the reviewer's own correction, accepted), **+20
  bytes/+30 cycles after** (this round's own hand count, cross-checked against the reviewer's own
  83-cycle Shake-composition figure — see §2. Round 6 nit: this cross-check itself was printed
  wrong here as 65 for five rounds; §2's own 46/29/83/66 table was always the correct, authoritative
  figure — 65 omitted the 18-cycle snapshot refresh finding 1's own repair added).
- **Finding 8** (P2, several named tests don't exercise the rule they claim): fixed. §7 rebuilt: the
  `screen_fresh` rows now name the **arming frame** itself (`cross_*` → `redraw_screen_slide` → `rts`
  mid-`update_player`) as the precise trigger, not merely the frame after; the dead-entity row is
  replaced with explicit stale-slot injection, marked synthetic; "a second crossing does not re-fire"
  is replaced with the legitimate rule (re-entering re-arms; touch re-arms only by walking off);
  owed-before-buttons and dispatch-stop rows now name concrete competing inputs on the first resumed
  frame; the warp-chain row asserts the next screen's newly armed event survives the old event's
  own return. Finding-1/2's regressions and finding-4's absolute rows are added.

**Also, per the brief**: Pan, sprite interpolation and the `game_state`-gate alternative are each
now labelled **not costed** explicitly (§9), not "unchanged from round 1" by reference to replaced
text. §9 states the pinned-sprite picture in its own words. Every measured figure lives in the
single §3 table, with a "changed this round" marker on every figure finding 1/2/4/5/6 moved.

## 0. What was read, and corrections to earlier rounds' fact lists

Read in full for this round: `handoff-next/camera-design-1-review2.md` (all of it, including
"Completion routine and surviving sound conclusions" and the round-1 disposition table), the current
`docs/design-camera.md`, `engine/text.asm:150-169` (`vram_drain`'s own per-byte cost, re-checked for
finding 1's cycle math), `shared/cartridge.js`'s full `MAPPERS` array (all eight boards, for finding
5), `shared/project.js`'s `normalizeCartridge`/`reconcileCartridge` (for the same finding), and
`test/unit/kernelbytes.test.js:257-317` (`assertCovers`'s real shape, for finding 4).

No further corrections to round 1's own §0 (the nine-caller count, the mirroring-hint reversal, the
81 free zero-page bytes all stand, reconfirmed this round by direct re-read). One correction to
round 1's own fix-round-1 text: the claim that `cam_dirty` "skips" the scroll write is retracted —
see finding 1 above and §2 below for what actually happens.

**Restated in full this round (round 3 finding 1), not left as a pointer to a prior round's own
text**, since a reviewer implementing from this document alone cannot follow "see round 1":

- **`redraw_screen`'s callers are nine routines at ten call sites, not seven.**
  `grep -rn "jmp redraw_screen\|jsr redraw_screen" engine/*.asm` (excluding the definition itself)
  finds: `cross_left`/`cross_right`/`cross_up`/`cross_down` (`engine/player.asm:276,286,296,306` at
  the HEAD this document was written against, four call sites, one routine family), `take_door`
  (`engine/boot.asm:281`, one site), `battle_end` (`engine/rpg.asm:176`), `continue_game`
  (`engine/save.asm:567`), and `title.asm`'s `start_game` (two mutually-exclusive
  `.if HERO_NAMING_ENABLED`/`.if !HERO_NAMING_ENABLED` arms at lines 250 and 259 — only one ever
  assembles into a given ROM, so it counts once) and `restart_game` (line 276). **Nine distinct
  routines**: `cross_left`, `cross_right`, `cross_up`, `cross_down`, `take_door`, `battle_end`,
  `continue_game`, `start_game`, `restart_game`. Only the first four should ever slide — the other
  five are `jmp redraw_screen` unmodified by this design, every candidate's appendix included, and
  §6's own traps exist because it is easy to instead touch the shared routine those five also
  reach.
- **Zero page has 81 bytes free, not merely "some."** `bt_walk_step = bt_miss_left+1`
  (`engine/constants.asm:501` at HEAD) is the last symbol in the unconditionally-chained zero-page
  map, verified by evaluating every `name = expr` equate in the file in declaration order — not by
  `shared/enginesyms.js`'s `parseEquates`, which only catches literal-hex equates and silently
  skips the whole expression chain `bt_walk_step` itself sits inside. `bt_walk_step` resolves to
  `$AE`, leaving `$AF`-`$FF` (81 bytes) unclaimed by any symbol in the file before this feature's
  own chain (§2's RAM table) claims up to twelve of them, starting at `bt_walk_step+1` for exactly
  this reason — chaining off the last claimed byte rather than a literal address is what makes
  "camera off costs zero bytes" possible at all: no `.if` block ever needs to reserve the space,
  since an unclaimed equate costs nothing to declare and nothing reads it when the feature is off.
- **The NT (nametable) address a slide targets is derived from the crossing's own `DIR_*`, not
  stored per-screen.** A two-nametable mirror offers exactly two distinct *physical* pages beyond
  nametable 0 (Q3): one for the horizontal axis, one for the vertical axis — which the mirroring
  choice decides is which is a `mirroringById` question, not this feature's own. `cam_far_nt`
  (Appendix B/D, both candidates) is a four-entry table indexed by `DIR_*` (`DOWN`=0, `UP`=1,
  `LEFT`=2, `RIGHT`=3): `.db 2, 2, 1, 1` — DOWN and UP both resolve to nametable 2 ($2800), LEFT and
  RIGHT both resolve to nametable 1 ($2400), because a two-page mirror can only ever offer *one*
  page per axis regardless of which of the two directions on that axis is crossed. The byte-to-
  address conversion itself (`draw_screen_at`'s own `nt * 4`, added to `$20` for the hi byte —
  Appendix C) is arithmetic on the nametable *index* (0-3), not a second table: nametable `n`'s own
  PPU base address is `$2000 + n*$400`, so its hi byte is `$20 + n*4` — verified by hand against a
  standalone JS simulation of the same 16-tick sequence before being written into the assembly at
  all, and unchanged by any later fix (the publication-lock repair touches only *when* the register
  is read, never this derivation).
- **`switch_prg_bank`'s own callers always re-select, never assume the bank is already right** — the
  discipline this design's own `set_screen_ptr_for`/`draw_screen_at` calls hold to for the identical
  reason: `redraw_screen_slide`/`camera_slide_complete_b` call `set_screen_ptr_for` for whichever
  screen they are about to draw even though the *previous* call may have already selected the same
  bank, because the cost of a redundant select is a few bytes and cycles while the cost of a stale
  assumption is a screen drawn out of the wrong bank with no crash to flag it. Candidate (b)'s own
  `cross_right` comment states this explicitly at the call site: `; Y is still the outgoing id set
  up above` — Y is deliberately **not** reloaded before `jmp redraw_screen_slide`, because nothing
  between the `ldy <flat_screen` at `cross_right`'s own top and the jump touches Y, so reloading it
  would be the same "assume nothing, verify everything" discipline applied to a register that was,
  in this one case, provably never at risk — the comment exists so a future edit inserting code
  between them does not assume the same safety without re-checking it. **Shipped:** the shipped
  `engine/camera.asm` calls the plain, unparametrized `set_screen_ptr`/`rebuild_bound_cache`
  directly rather than a `_for` variant — both already read `<flat_screen` internally, and
  candidate (b) never draws the outgoing screen, so no parametrized wrapper was needed; the
  re-select discipline above still holds for the plain calls.
- **The mirroring-hint reversal**: unchanged from round 1 and round 2's own correction (Q3, below)
  — the engine's own mirroring math (`renderer/emulator/core/ppu/index.js:209-225`) says horizontal
  mirroring supports *vertical* scrolling and vertical mirroring supports *horizontal* scrolling,
  the opposite of what the pre-existing hint text claimed.

## 1. Recommendation at a glance

- **The camera register** (Q1): `cam_x_lo`/`cam_y_lo`/`cam_nt` (the live, mainline-owned register),
  `cam_dirty` (the publication lock, now correctly scoped), and — new this round —
  `nmi_cam_x_lo`/`nmi_cam_y_lo`/`nmi_cam_nt` (NMI's own last-complete snapshot, finding 1). Off-path
  cost: **0 bytes**, six-fixture SHA-256 identity reproven after every edit this round, including
  the last one. On-path NMI cost, corrected twice now: round 1 claimed +7, was actually **+8 bytes/
  +12 cycles** (the reviewer's own correction, accepted), and after finding-1's repair is now **+20
  bytes/+30 cycles** for the no-Shake path (hand-counted, §2) — worst-case Shake+camera composition
  is **83 cycles** (§2's own authoritative 46/29/83/66 table — clean, positive-wrap, including the
  18-cycle snapshot refresh; round 6 nit fix, this line previously said 65, omitting that refresh)
  against today's own 41.
- **The v1 consumer remains candidate (b)**, confirmed rather than merely re-asserted this round:
  fixed for finding 1, its own X-independent correctness proven by direct CPU stepping (the
  jsnes-based technique the reviewer used to find round-1's bugs, turned into a verification tool
  this round), and Mesen-confirmed to complete in exactly 16 ticks with the NMI meeting its deadline
  every single frame — on both a plain fixture and a worst-case one (eight active switch-bound
  entries on both screens plus a hold-terminal Flash). **The measured cost is now +375 bytes**
  (NROM/MMC1/UxROM/CNROM/GxROM/Color Dreams/UNROM 512, one axis), **+381 on MMC3** (live split) — up
  from round 1's +363/369 by finding-1's own +12-byte repair. **Formula, round 5's own disjoint
  accounting (§5/Q5) — two genuinely separate gates, never added to each other's own already-
  inclusive figure**: **register gate (phase 1, §8): 20, plus 19 more with Shake live** — **consumer
  gate: 303 (measured incrementally against a phase-1-on build, not camera-off) + 52/axis + 6 when
  split is live (charged through `SPLIT_ENABLED`, not the mapper number) + 13 when bound tiles are
  live**. A real one-axis project pays both gates together: `20 + 303 + 52 = 375`, the same total
  this document has measured throughout — **round 6 nit fix**: `323 + 52` itself was never the
  wrong expression (323 + 52 = 375, the correct total); the double-count was round 4's own separate
  practice of *also* adding a standalone 20-byte register term on top of it elsewhere in the
  document (`20 + 323 + 52 = 395`), since 323 was measured against camera fully off and already
  contained that same 20 bytes inside it; fixed round 5 (finding 2).
- **The blank-interval picture, re-measured this round with a real Mesen harness (not jsnes
  approximation)**: on plain content, (b) still shows two *separate* short blanks (1 frame each, 2
  total), against (a)'s one 2-frame blank — the same total, differently shaped. **On heavy content
  (eight active switch-bound entries on both screens, a real injected hold-terminal Flash), (b)'s
  two blanks grow to 5 and 4 frames (9 total), exceeding (a)'s own 8** — round 3's own most
  consequential result: (b) is no longer strictly better than (a) by this metric under heavy
  content, though the gap is one frame and both stay far below c-lite's ~48-49-frame cost for the
  same transition. This is new information this round surfaces (a heavier, differently-composed
  fixture than round 2's own) and is added to §9 as part of the acceptance decision.
- **Candidate (a)** stays the costed-and-rejected entry: re-measured with every fix applied,
  **+315 bytes** (NROM/MMC1/UNROM512 one-axis; +318 MMC3), still cheaper than (b) by the same ~60
  bytes as before, still rejected for the same reason (its own blank is 2 consecutive frames on
  *plain* content already, worse than (b)'s plain-content 1+1).
- **Candidate (c-lite)** is now explicitly labelled an **experimental row-copy sketch offered as an
  input to item 15's own design round, not a validated foundation** (finding 3). Its own X-clobber
  bug is fixed and reproduced-then-verified (finding 2): **+515 bytes** (up from the buggy build's
  +500), **49 ticks** to completion (not 48), still zero `$2001` writes (Mesen-reconfirmed after the
  fix). It still never calls `vram_reset` or an equivalent — Flash/Shake/flip cancellation for a
  rendering-on producer is a real, unsolved problem this document does not attempt to close this
  round, per the brief's own instruction.
- **Ledger placement, gating and mirroring** (§5): unchanged in shape from round 1
  (kernel-lo, `project.cartridge.camera`, boolean, default `false`), now backed by the real
  eight-board measurement and a real `cameraAxes` helper design (finding 5), and a real formula with
  real `assertCovers`-shaped evidence (finding 4).

## 2. Q1 — the camera register, the NMI rewrite, Shake composition (fixes: round 2 finding 1, round 1 findings 3/6)

### RAM, the real shipping contract (finding 7)

```
cam_x_lo      = bt_walk_step+1   ; horizontal scroll, 0-255 -- mainline-owned
cam_y_lo      = cam_x_lo+1       ; vertical scroll, 0-239
cam_nt        = cam_y_lo+1       ; PPUCTRL bits 0-1 -- mainline-owned
cam_slide_left = cam_nt+1        ; frames left in an active slide; 0 = idle
cam_slide_dir = cam_slide_left+1 ; DIR_* the active slide is animating
cam_far       = cam_slide_dir+1  ; resolved far-nametable index, staged across
                                  ; redraw_screen_slide's own body (finding 7:
                                  ; round 1 wrongly dropped this as "folded
                                  ; into cam_outgoing" -- it is a SEPARATE,
                                  ; still-needed byte under (b), which never
                                  ; had cam_outgoing to fold it into)
cam_dirty     = cam_far+1        ; publication lock, finding 1
nmi_cam_x_lo  = cam_dirty+1      ; NMI's own last-complete snapshot, finding 1
nmi_cam_y_lo  = nmi_cam_x_lo+1
nmi_cam_nt    = nmi_cam_y_lo+1
nmi_tmp       = nmi_cam_nt+1     ; NMI-private Shake-composition scratch, only
                                  ; live when SHAKE_ENABLED (finding 3, round 1)
cam_slide_b_pending = nmi_tmp+1  ; completion redraw owed, (b) only
```

**Twelve bytes, unconditional, for the shipping (b) shape — round 3 finding 6's own fix, replacing
a feature-liveness-conditional count.** Every symbol in the listing above is a plain equate chain
with no `.if` around any individual link — `nmi_tmp`'s own comment ("only live when
`SHAKE_ENABLED`") describes when the byte is *accessed* (NMI's own Shake-composition branch never
reads or writes it on a no-Shake build), not when it is *allocated*: the equate itself, and
therefore the reservation, is unconditional the moment `CAMERA_ENABLED` is on, regardless of
`SHAKE_ENABLED`. Publishing "nine without Shake, twelve with it" (round 2's own framing) implied
the *reservation* varied with a second, unrelated feature flag, which is wrong and which finding 6
catches: the real number a reviewer should reserve against is the flat **12**, every time camera is
live, Shake or no Shake — `cam_x_lo`/`cam_y_lo`/`cam_nt`/`cam_slide_left`/`cam_slide_dir`/`cam_far`/
`cam_dirty`/`nmi_cam_x_lo`/`nmi_cam_y_lo`/`nmi_cam_nt`/`nmi_tmp`/`cam_slide_b_pending` — eleven
camera-specific bytes plus `nmi_tmp` makes twelve, all reserved together (round 1's claimed "seven"
wrongly dropped `cam_far` and `nmi_tmp`; this round's finding-1 repair added three more —
`nmi_cam_x_lo`/`y_lo`/`nt` — on top of that corrected nine, giving the twelve above). `cam_outgoing`
(candidate (a)'s own scratch, holding the *outgoing* screen id across its two-screen draw) is
**not** part of (b)'s own shipping set at all — (b) never draws the outgoing screen, so it never
needed that byte; round 1's own "folded `cam_outgoing` into `cam_far`" language was describing a
fold that only ever removed `cam_outgoing`, never eliminated `cam_far`, which (b) needs for an
unrelated reason (staging the resolved far-nametable index between the table lookup and the draw
call several instructions later).

**The +19-byte Shake interaction (§3/§5) is UNCHANGED by this fix, and here is why it is not
double-counted.** That figure is a *delta*: (bytes with camera+Shake both live) minus (bytes with
camera alone live). Since the 12-byte reservation — `nmi_tmp` included — is already present on
*both* sides of that subtraction (camera alone already reserves all twelve bytes, per the fix
above), `nmi_tmp`'s own single byte cancels out of the delta exactly as it always did; the +19 is
counting the *code* the Shake+camera composition adds (the branch, the wrap-phase arithmetic), not
`nmi_tmp`'s own allocation, which was never what that delta measured. The 12-byte reservation is a
byte question; the +19 interaction is a cycle-adjacent code-size question — distinct, and this
fix does not move either one into the other's territory.

Zero page had 81 free bytes (round 1's own §0, restored in full above). Twelve is the real,
unconditional cost of (b)'s own shipping shape. Comfortably inside the 81, leaving 69 for whatever
needs zero page next.

### The NMI rewrite (finding 1, finding 3)

Full listing in Appendix A. Two real changes since round 1:

1. **The publication lock now covers both stores of every wrap update**, raised before the first
   (the low-byte coordinate) and released after the last (the `cam_nt` toggle), on every wrap path
   in `camera.asm`/`camera_b.asm`/`camera_c.asm` (twelve sites, fixed identically — Appendices
   B/D/E). Round 1's own reasoning ("the wrapped low byte alone is always a valid combination with
   the old nt bit") was wrong: the reviewer reproduced the actual torn state by stepping the
   vendored CPU one instruction past the low-byte store alone (LEFT's first tick: X changes to 240
   with NT still 0, when the intended combination was NT1/X=240) and confirmed the very next opcode
   was the `INC` that was supposed to have already raised the lock.
2. **`nmi_scroll` never skips the scroll write.** It maintains its own snapshot
   (`nmi_cam_x_lo`/`y_lo`/`nt`), refreshed from `cam_x_lo`/`y_lo`/`cam_nt` only while `cam_dirty` is
   clear (a plain three-`lda`/three-`sta` copy, unconditional in program order so an NMI reading
   `cam_dirty` as clear has necessarily already seen every byte of the *previous* tick's own
   complete write). The snapshot — never `cam_x_lo`/`y_lo`/`nt` directly — is what Shake composes
   with and what gets written to $2000/$2005, **unconditionally, every vblank**. Round 1's own
   "skip and the PPU keeps the last value" claim was false: the drain (`vram_drain`, `engine/
   text.asm:150-169`) issues its own `$2006` writes for every queued packet before `nmi_scroll` ever
   runs, and `PALETTE_FX_ENABLED`'s own PPUADDR cleanup does too — either already moves the PPU's
   `v`/`t` register, so *not* rewriting $2000/$2005 would leave the picture scrolled to wherever the
   drain last pointed it, not to any camera position at all. CLAUDE.md's own rule ("$2000 is
   rewritten after the drain, not before") already established this for the plain `(0,0)` case; the
   fix applies the identical rule here.

**Cycle accounting, redone by hand, cross-checked against the reviewer's own independent count**
(same 6502 opcode-cost table as round 1's own §2):

**One cycle table, used consistently everywhere in this document and in the round-3 report — round
3 finding 6's own fix** (round 2's own table undercounted the dirty-set-with-Shake row by 6 cycles,
by measuring the shared 60-cycle tail alone and forgetting the dirty-branch check itself also costs
cycles on that path):

| Path | Cycles | Compare |
|---|---:|---|
| Off-path, no Shake (unchanged) | 16 | — |
| No-Shake, clean (refresh runs — the common case, dirty clear) | **46** | +30 vs today's 16 |
| No-Shake, dirty (refresh skipped) | **29** | — |
| Off-path Shake, positive phase (unchanged) | 41 | — |
| Shake, clean, positive-wrap (refresh runs — longest) | **83** | +42 vs today's 41 |
| Shake, dirty, positive-wrap (refresh skipped) | **66** | not 60 — the dirty branch itself (`lda <cam_dirty` / `bne`) costs 6 more cycles before the existing 60-cycle Shake-compose tail; round 2's own 60-cycle figure measured only the shared tail and dropped the branch that reaches it |

The dirty-set rows are the rare case (the lock is held only across a handful of instructions inside
one tick, one tick out of sixteen per slide); the clean rows are what the overwhelming majority of
frames pay, and are the honest "the" figures. **+30 cycles no-Shake (clean), +42 cycles worst-case
Shake (clean)** — both still trivial against the 2,273-cycle vblank budget and the documented
1,670-1,740-cycle two-producer Flash figure.

**A note on branch-page penalties, added to the deadline check's own verification methodology
(finding 6).** The hand-counted table above uses the standard 6502 opcode-cost table (2 cycles for
a taken branch that stays on the same page, 3 if it crosses one) and does not itself special-case a
page-crossing branch anywhere in `nmi_scroll`'s own camera path — none of its branches are close
enough to a page boundary to make this a live concern in the *hand count*, but the Mesen deadline
check (Appendix G, finding 4) does not rely on the hand count at all: it samples
`emu.getState()`'s own real `ppu.scanline`/`ppu.cycle` after the real, executed instruction stream,
which already reflects whatever page-crossing penalty actually applied on that run, on real
hardware timing. The hand-counted table is a design-time estimate; the Mesen check is what actually
proves the deadline, and does not inherit any error the hand count might carry from an unaccounted
page crossing.

**Byte cost, hand-counted from the same instruction listing** (Appendix A): the no-Shake camera path
is 33 bytes (8 two-byte refresh instructions plus a 17-byte compose-and-write tail), against the
original 13-byte off-path body — **+20 bytes**, up from the pre-repair **+8 bytes** (the reviewer's
own corrected figure for round 1's code, accepted here as the "before" baseline).

**Correctness check, restated**: substituting `cam_x_lo=0, cam_nt=0` (camera at rest) into the
refresh-then-compose sequence still reproduces today's exact `PPUCTRL`/`$2005` output byte-for-byte
— the snapshot always mirrors the live register within one vblank of it being at rest, so this
regression guard (§7) still holds under the corrected mechanism.

**The coherent-stale-frame policy, stated explicitly (round 3, per the reviewer's own description
of what finding 1's fix actually guarantees).** An NMI that interrupts a locked wrap (`cam_dirty`
set) does not skip the write and does not read a torn value — it writes the **last complete
snapshot**, i.e. the whole frame it owns shows whichever coordinate was true before the in-progress
wrap started, never a mix of the old and new. The **next** NMI that lands with `cam_dirty` clear
catches up to the tick's real, current position. The consequence: **16 logical ticks over a slide
are not a guarantee of 16 distinct displayed camera positions.** If a frame runs long enough that
two vblanks' worth of real time separate one clean NMI from the next (a long frame, not a normal
one — nothing in this design lengthens a frame on its own), the display holds one snapshot across
both, and the tick that landed on `cam_dirty` during that stretch is never separately shown at all,
only superseded by whichever tick's own value the next clean NMI catches. This is not a bug this
design introduces — it is the necessary shape of "never torn, never skipped" applied to a value
that changes every tick rather than remaining constant — and it means a test asserting "16 distinct
displayed positions" would be asserting something this design does not promise; §7's own regression
rows assert *coherence* (no torn frame) and *eventual correctness* (the published value always
converges to the true tick value), not a one-to-one tick-to-displayed-frame count.

## 3. Q2 — the transition candidates, all figures re-measured this round

### The master measurement table

**Round 5's own correction to this legend (finding 4's "Also")**: the bold/dagger marks below are a
*running record carried forward across rounds*, not a claim that every figure was freshly
re-measured this round. **Bold** marks a figure that changed at some point since round 1's own
first fix (the round that changed it is named in prose nearby, not repeated per-cell); a dagger (†)
marks a figure that was new as of the round that introduced it (also named nearby), not
necessarily round 5. **Retained from earlier rounds, not re-measured this round**: every row of
this table except where round 5 is explicitly named below. **Freshly re-verified this round**
(finding 2): the consumer-vs-phase-1 incremental deltas on NROM and MMC3 (§5/Q5, both textless and
with text); the phase-1-alone isolation on all four boards (§8, unchanged from round 4's own
figures, re-run to confirm); the four candidate Mesen runs and the new cut-heavy fixture (§3's own
Mesen results and blank-timing tables, Appendix G). `mirroring: vertical` (one axis, the H axis,
the project default) unless noted, for every measurement below regardless of which round produced
it.

| Board | Baseline (camera off) | (a) one-axis | (b) one-axis | (b) RPG† | c-lite |
|---|---:|---:|---:|---:|---:|
| NROM | 7168 | **+315** | **+375** | n/a (no RPG-capable NROM config) | **+515** |
| MMC1 | 6708 | **+315** | **+375** | **+375**† (`sample-rpg`) | **+515** |
| MMC3 | 6896 | **+318** | **+381** | **+381**† (mkdtemp RPG variant) | **+515** |
| UNROM 512 | 7070 | **+315** | **+375** | **+375**† (mkdtemp RPG variant) | **+515** |
| CNROM† | 7185 | not separately re-measured this round (round-1 shape unaffected) | **+375**† | n/a | not measured |
| GxROM† | 7185 | — | **+375**† | n/a | not measured |
| Color Dreams† | 7197 | — | **+375**† | n/a | not measured |
| UxROM† | 7207 | — | **+375**† | n/a | not measured |

Both-axes (four-screen, UNROM 512 only): (a) **+367**†, (b) **+427**†, formula-consistent
(base+52+52) both times.

Shared-base/interaction terms (isolated, NROM unless noted, all fresh this round):

| Term | (a) | (b) |
|---|---:|---:|
| Full-camera subtotal, neither axis, vs. camera **off** (unreachable in a real project, §5) — **= register 20 + consumer base 303, never a term to add 20 to again (round 5 finding 2)** | 263 (266 MMC3) | **323**† |
| Full-camera subtotal, MMC3, **textless** (`SPLIT_ENABLED=0` — round 3 finding 2's own isolation row), vs. camera off | not separately isolated | **323**‡ — identical to every other board once the split interaction is charged separately |
| **Consumer base alone, vs. a phase-1-on build (round 5 finding 2's own disjoint isolation)** | not applicable — (a) has no phase-1/consumer split in this document | **303**§ — `323 - 20`; independently re-measured on NROM and MMC3 textless, both agreeing exactly (§5/Q5) |
| **Register gate alone, vs. camera off (§8's own phase-1 isolation)** | shares the identical register code as (b) — not separately isolated for (a) | **20**§ — flat across all four measured boards |
| Split interaction (MMC3, live text, `SPLIT_ENABLED=1`) — consumer's own | +3 (one `sta $E000`) | **+6**† (two `sta $E000` — round-1 prose said 3, wrong for (b)) |
| Per-axis allowance — consumer's own | +52 | +52 |
| Shake interaction — **register gate's own, not the consumer's (moved round 5, finding 2)** | not re-isolated this round | **+19**† |
| Bound-tile interaction — consumer's own | not re-isolated this round | **+13**† (matches round 1's own figure, unchanged) |

§ marks a round-5 addition (finding 2).

**Round 3 finding 2: the 329-MMC3-base figure round 2 published was a double-count, fixed this
round.** Measured directly (scratch harness, MMC3 build with `titleMap: null` and all dialogue
stripped so `projectUsesText`/`SPLIT_ENABLED` are both genuinely 0 — a textless MMC3 build, not
merely "MMC3 chosen as the board"):

```
MMC3 textless, one axis : baseline= 6059  camera-on= 6434  delta=+375
MMC3 with text, one axis: baseline= 6896  camera-on= 7277  delta=+381
MMC3 textless, neither axis: baseline= 6059  camera-on= 6382  delta=+323
```

**323 is MMC3's own isolated base, identical to every other board's 323 — not 329 (and, per round 5
finding 2 above, 323 itself is the full-camera subtotal `20 + 303`, never a figure to add the
register gate's own 20 to a second time).** Round 2's own
329 figure came from measuring MMC3's base *with SPLIT_ENABLED already live* (a titled/dialogue-
bearing MMC3 fixture) and treating the whole 329 as "the MMC3 base," which double-counts the
6-byte split interaction into both the base *and* the separately-charged split term — an author
whose MMC3 project has SPLIT_ENABLED live would have been charged 329 + 6 = 335 for the base+split
pair, six bytes over the real 329 (323+6). **Round 3's own fix instruction here — "charge the flat
323 base to every board unconditionally" — is superseded by round 5's own disjoint formula (finding
2): there is no longer a flat 323 base constant to charge at all; charge the register gate's own
flat 20 (§8) and the consumer gate's own flat 303 (§5/Q5) separately, which sum to the identical
323 for the common case (both live) without ever being written as one term.** The +6 split
interaction is still charged *only* through the `SPLIT_ENABLED` predicate (Q6, above) — never
folded into a per-mapper base entry, and still the consumer's own interaction term, unchanged by
the round-5 split. **The 311→323 base move round 2's own
report described is exactly this same 12-byte publication repair (finding 1), not a separate
correction** — round 1's original base (measured before finding 1's fix existed) was 311; finding
1's snapshot-publication repair added 12 bytes to every camera-enabled build regardless of board,
moving the base to 323 on every board including MMC3's own textless isolation — the number never
diverged between boards; only round 2's own measurement technique (folding a live split into "the
base") made it look like MMC3 diverged when it did not.

### Mesen results, this round (finding 4/5, full rewrite — real `~/Downloads/Mesen2 --testRunner`, not jsnes approximation)

**One harness (Appendix G), one heavy workload, both candidates, both content levels — four runs,
`exit 0` every time.** Round 2's own harness set `completed` on *entry* to the completion routine
(finding 4's own bug) and checked `vram_len > 256` (a byte, so it could never fire); both are fixed
this round, and every number below comes from a real, unmodified `Mesen --testRunner` run, not an
approximation.

**1. State-machine correctness, all four runs**: crossing triggered, completion detected on
genuine RETURN (not entry — discriminated from the 15 ordinary ticks sharing the same exit label by
`cam_slide_left == 0`, §4's own restored trap), idle camera state confirmed, rendering re-enabled
confirmed, the crossing's own real `vram_buf` workload (Flash's cancellation packet only — the bulk
draw never touches `vram_buf` at all, §4) matched against an independent prediction, every one of
the 1024 NT0 tile+attribute bytes matched against an independent JS-built reference read through
Mesen's own PPU memory, the first resumed NMI's deadline met, every symbol anchor preflighted:

**Round 4's own rewrite closes the gaps a round-4 review found in this proof**: every one of the 19
NMI samples is now individually deadline-checked (not just the first resumed one), and the sample
count is asserted against a real minimum, not printed; `cross_right`/the arm/`camera_slide_tick`
each have real exec-callback hit counts asserted (1/1/16); for (b), completion *entry*
(`camera_slide_complete_b`'s own first instruction) is required observed before its *return*, in
that order; for (a), the arm/tick sequence is required observed before a zero countdown is accepted
as completion; the idle assertion checks `cam_x_lo`/`cam_y_lo`/`cam_nt`/`cam_slide_left`/`cam_dirty`
(and, for (b), `cam_slide_b_pending`) all zero, not only the countdown; `bind_count == 8` is
observed and asserted at **each** of the two draw sites separately, not deferred to after
completion; every anchor this script uses is preflighted, `main_loop_ready` included:

| Fixture | Result | Completion frame | `vram_buf` workload (host-counted) | Bind count, both draw sites | NT0/attr match | Callback hits (cross/arm/tick) | NMI samples (all deadline-checked) |
|---|---|---:|---|---|---|---|---:|
| (a), plain | **PASS** | 39 | 0 packets, 0 bytes | n/a | 1024/1024 | 1/1/16 | 19 |
| (a), heavy (8 bound × 2 screens, injected Flash) | **PASS** | 45 | 1 packet, 32 bytes | 8/8, 8/8 | 1024/1024 | 1/1/16 | 19 |
| (b), plain | **PASS** | 39 | 0 packets, 0 bytes | n/a | 1024/1024 | 1/1/16 | 19 |
| (b), heavy | **PASS** | 46 | 1 packet, 32 bytes | 8/8, 8/8 | 1024/1024 | 1/1/16 | 19 |

**Finding 2's own fix, confirmed**: the workload column now reads 32 real appended bytes (the
Flash body alone, host-integer-counted via a `vram_push` breakpoint), not 35 (header-inclusive, the
round-3 figure) — the two are not in tension, they are counting different things: 32 is the real,
unwrapped body length finding 2 asked for; the packet's own 3-byte header is tracked separately and
the terminator is accounted for at the capacity check, never by re-reading the packet's own
one-byte count out of `vram_buf`, which is exactly the technique finding 2 found unsound for any
workload whose real count could exceed 255.

**2. Mask-off/mask-on timestamps, one frame-labelling convention, no overlap (finding 5, fixing
round 2's own "22→38" ambiguity)**: a mask event's `frame` is the frame during which the `$2001`
write executed, sampled directly via a write breakpoint. Blank-frame count is `on_frame -
off_frame` (the number of frames the picture is actually off, mask-off frame included, mask-on
frame excluded since rendering is live again by the time that frame's own picture is seen):

**Round 4 finding 3: today's cut (`CAMERA_ENABLED` off entirely) measured on the identical heavy
workload, added as the baseline** — same eight active bindings on both screens, the same
hold-terminal Flash injected at `redraw_screen`'s own entry (the cut's own analog of
`redraw_screen_slide`'s entry — `screens.asm:231`), the same mask-timing convention, the same
`vram_push`-counted workload (1 packet, 32 real appended bytes, confirmed), `bind_count == 8`
confirmed. This separates what the cut already costs from what the camera feature adds on top:

| Fixture | Blank 1 (entry draw): off→on | Length | Blank 2 (completion draw, (b) only): off→on | Length | Total blank frames |
|---|---|---:|---|---:|---:|
| **Cut, heavy (baseline, round 4)** | frame 21 → frame 26 | 5 | n/a — the cut has only one draw | — | **5** |
| (a), plain | frame 21 → frame 23 | 2 | n/a — (a) has no completion redraw | — | **2** |
| (a), heavy | frame 21 → frame 29 | 8 | n/a | — | **8** |
| (b), plain | frame 21 → frame 22 | 1 | frame 38 → frame 39 | 1 | **2** |
| (b), heavy | frame 21 → frame 26 | 5 | frame 42 → frame 46 | 4 | **9** |

**Reading the heavy row as "cut 5, (a) 8, (b) 5+4":** the cut's own single draw already costs 5
blank frames under this workload (the bound-tile lookups and the Flash cancellation packet are not
camera-specific costs — every crossing, camera or not, pays for drawing a screen this heavy). (a)
adds **+3** frames over the cut baseline (a second whole-screen draw, both under the same forced
blank). (b) adds **+4** frames over the cut baseline, split as a first blank identical in length to
the cut's own (+0 over cut — (b)'s own arm-time draw is not more expensive than the cut's single
draw, both drawing one screen's worth of heavy content) plus a second, completion-time blank the
cut never pays at all (+4, entirely new cost). Framed this way, (a)'s total marginal cost over the
cut (+3) is *smaller* than (b)'s (+4) under heavy content — the reversal in raw blank-frame count
(§9) is explained by (b) paying its second draw's cost in a place the cut and (a) do not pay
anything at all, not by (b)'s arm-time draw being unusually expensive.

**The plain-content pair, reported alongside for comparison, is what motivated the recommendation
and still holds**: (b) keeps its 1-frame-per-blank advantage over (a)'s 2-frame single blank on
ordinary content (2 total blank frames either way, but (b)'s is two short blanks bracketing a
visible slide, closer to today's instant cut in feel, against (a)'s one longer blank before any
motion is visible at all).

**This round's own most consequential result, now measured with a real harness rather than
approximated**: under heavy content, **(b)'s total blank frames (9) exceed (a)'s (8)** — the
worst-case content this round measured is heavy enough that (b) is no longer strictly better than
(a) by this metric, though the difference is one frame and both remain far below the ~48-49 frames
c-lite would cost for the same transition. The transition still *completes correctly* under this
content (proof 1, above) and the NMI still meets every deadline — this is a **visual** cost, not a
correctness one — but it means (b)'s advantage over (a) is not a property of the candidate, it is a
property of *content that stays cheap enough*, and round 3's own heavier fixture (an added
Flash-authoring NPC plus 8 bindings on both screens, a different specific worst-case than round 2's
own fixture) shows that advantage can fully erode under real content. §9 states this as part of
what Chris is accepting.

### Candidate (a): re-measured, still rejected

Fixes 1 applied (Appendix B, in full). +315/318 bytes one-axis (was +303/306 pre-repair). Rejected
for the identical reason round 1 gave: its own blank is 2 consecutive frames even on plain content
(round 1's own Mesen finding, unaffected by this round's fixes — the double-draw's own cycle cost
did not change).

### Candidate (b): re-measured, remains recommended, with a stated content-dependent caveat

Fixes 1 applied (Appendix D, in full — same structure as round 1's own bespoke completion routine,
which the reviewer confirmed structurally sound: correctly omits re-running `apply_map_music`/
`spawn_entities`, safely omits a redundant `switch_chr_bank` re-select, correctly leaves `fade_reload`
alone, and correctly re-runs `vram_reset` at completion without cancelling anything newly authored
since nothing could have been authored during the frozen slide). +375/381 bytes (up from +363/369).
Recommended for the same reason as before — its two blanks are individually 1 frame each on plain
content — now qualified by this round's own worst-case finding above, and by round 4's own real
Mesen measurement: heavy switch-bound-tile content does not merely narrow that advantage, it can
**reverse** it (5+4=9 total blank frames against (a)'s own 8, and against 5 for today's cut on the
identical workload — the master table and §9 below). §9 states this explicitly, including the cut
baseline, rather than leaving it implied or understated as a mere narrowing.

### Candidate (c-lite): experimental, not a foundation (findings 2, 3)

Relabelled throughout this document per finding 3's own explicit instruction. What changed this
round:

- **Finding 2's bug, reproduced then fixed then re-verified.** `cl_stream_tick` stored its row
  budget in X, then called `cl_emit_row`, which resets X to 0 and leaves it at 16 or 32 on return
  (its own tile/attribute loop counter) — `vram_push`/`vram_end` preserve *that* X, not the caller's
  original budget, so `DEX`/`BNE` against the returned value never terminated the loop early.
  Reproduced directly (CPU-stepped `cl_stream_tick` in isolation, matching the reviewer's own
  technique): one tick emitted all 32 rows, 63,601 cycles, `cl_row` 0→32, `vram_len` overflowing
  past 96 — this exact shape, independently reproduced, not merely trusted from the review. Fixed
  with a dedicated `cl_budget` byte; re-verified the same way: one tick now advances `cl_row` by
  exactly 2, `vram_len` settles at 70 (2 packets × (3-byte header + 32 bytes) = 70, the expected
  packet shape), a second tick advances it to 4. A full state-machine drive (calling the real
  `camera_slide_tick` dispatcher repeatedly, not `cl_stream_tick` directly) confirms **49 total
  ticks** to `cl_state == 0` and lands on `cam_nt == 0` — the FLIP tick the reviewer's own finding 2
  named, now proven to be a real, separate 49th call, not folded into the 48th.
- **Finding 3: the cancellation gap is real and is not closed this round, by instruction.** Appendix
  E's `redraw_screen_slide` still never calls `vram_reset` or an equivalent — it cannot, without
  forced blank, which this candidate deliberately never enters. Flash, Shake and switch-bound flip
  backlog can all coexist with the streaming producer, unaddressed. **This document does not design
  a rendering-on cancellation handshake this round.** Every place round 1 called this candidate a
  "foundation" or its numbers "validated" now says "experimental row-copy sketch" and "a lower bound
  on cost, not proof the mechanism works" instead (§1, §5/Q7, §9).

Bytes: **+515** (up from the buggy build's +500 — the extra 15 bytes are `cl_budget`'s own load/
store/decrement replacing `ldx`/`dex`, plus finding-1's own NMI repair shared with every candidate).
Mesen-reconfirmed after the fix: still zero `$2001` writes for the whole ~49-tick (~817ms) crossing.

### Candidate (c) proper: reasoned, not built — restored in full round 3

No new information this round changes round 1's own treatment; restated in full since round 2
pointed at it rather than restating it.

(c) proper streams *ahead of* the camera during a continuous slide, rather than fully before and
after it — the mechanism item 15 actually needs. Reasoned rather than measured, because it is a
**materially different, harder problem**, not merely a scheduling change on (c-lite)'s own code:

- **Interleaving is geometrically plausible and roughly free in frame count**: 16 slide ticks × 2
  rows/tick = 32 rows, exactly one screen, so a well-timed interleave could match (a)/(b)'s own
  16-frame visible duration instead of (c-lite)'s 49 — reasoned from (c-lite)'s own measured 2-rows/
  frame rate, not separately built.
- **The addressing is not the same shape as (c-lite)'s.** (c-lite) streams *whole rows*
  (row-major, each row a contiguous 32-byte VRAM run — exactly what `vram_open`/`vram_push`'s own
  packet model already fits). A camera sliding *horizontally* needs content revealed just ahead of
  the moving edge, which is a **column**, not a row — 30 bytes, one per tile row, at a stride of 32
  between them, not contiguous in VRAM address space at all. Writing a column through the existing
  packet model would need either 30 separate one-byte packets (30× the per-byte header overhead
  `vram_open`/`vram_drain` already spend cycles on) or a new, wider producer discipline this
  document does not design. **Reasoned cost: likely at or above (c-lite)'s own +515 bytes, not
  below** — the interleaving control flow folds (c-lite)'s separate `STREAM_FAR`/`STREAM_NT0`/
  `SLIDE` phase transitions into `camera_slide_tick` directly (saving some bytes), but the
  column-addressing complexity for a horizontal slide very plausibly costs more than that saves.
  **Not costed to a number**, honestly, because the addressing redesign it needs has not been
  designed, only named.

### Frozen-world gate: countdown vs. a new `game_state`, and what happens to `spawn_entities`, tileset mismatches, UNROM 512

**Restated in full this round**, since round 2 pointed at round 1's own text rather than restating
it and finding 1 requires every section to stand on its own.

**Countdown gate vs. a new `ST_SLIDE` `game_state`, both costed.** A new `game_state` value would
need: a corresponding `INPUT_STATES`/`input_actions` row (conditional the way `nameentry`'s already
is, CLAUDE.md's own precedent — but unlike naming, a slide plausibly wants **zero** input read at
all, not a state-specific subset, so the row would exist purely to be empty, which is not what
`input_actions` is for), a `ui_tick` dispatch arm to route to `camera_slide_tick` the way
`move_tick`/`wait_tick`/etc. already share one dispatch slot, and `settle_owed`'s own `game_state`
check would need to keep working across the transition. The countdown-gate shape actually built
touches none of that: zero wire-format change, and it blocks *every* button (not just the ones an
`ACT_*` table would omit), which is the correct behaviour for a transition where no authored
control should do anything. **Recommendation: the countdown gate, as built and measured — cheaper,
and a closer match to what a slide should actually accept as input (nothing).** `cam_slide_left`
(candidates (a)/(b)) or `cl_state` (candidate (c-lite), which has no slide sub-phase of its own to
count down — Appendix A's own `.if CAMERA_CANDIDATE_C` arm gates on `cl_state` instead) is the
whole gate, checked once at the top of `main_loop`, before `settle_owed`/`dispatch_input` are ever
reached.

**`spawn_entities` runs before the slide starts** (inside `redraw_screen_slide`, before arming
`cam_slide_left`): the incoming screen's actors are already standing in position when the far-
nametable content scrolls into view, and `pending_ent`/`screen_fresh` are armed exactly as they are
today — just not *settled* until the slide's last tick lets `main_loop`'s gate fall through to
`settle_owed` again, meaning an entry event fires on the first ordinary frame after the slide ends
rather than the frame after the (instant) cut does today. This reads as "the event waits for the
player to actually see the new screen," a behavioural improvement, not merely a side effect to
document.

**`apply_map_music` runs at its normal call site** inside the incoming-screen half of
`redraw_screen_slide`, unchanged from `redraw_screen`'s own sequence — it already compares maps and
no-ops on a same-map crossing (`cur_map`, `engine/constants.asm`), so nothing about the slide
changes that behaviour.

**A different-tileset crossing falls back to the hard cut**, decided by each `cross_*` stub before
ever calling `redraw_screen_slide` (Appendix C) — not refused, not drawn with the wrong tiles. CHR
is one 8KB bank at a time (`switch_chr_bank`) and `redraw_screen_slide` has no way to show two
different tilesets across the two nametables it draws into (candidate (a)) or across the arm-time
and completion-time draws (candidate (b)) simultaneously; the fallback costs nothing extra since
the check (`cmp screen_tileset,x`) is two instructions already present for the tileset-reselect
decision either way.

**UNROM 512's CHR-RAM tilesets are unaffected** because the fallback above means a same-tileset
slide never needs a CHR bank switch mid-sequence at all (the bank was already selected before the
crossing and stays selected through every draw the slide performs) — CHR-RAM streaming
(`chr_ram_init`) only ever runs at boot or on an actual tileset change, neither of which any
candidate's slide path triggers. `sample-u512` assembles and measures cleanly (§3's own table) with
no CHR-RAM-specific code needed.

## 4. The recommended shape: index to the listings

Retitled round 4 — the reviewer confirmed this section is an adequate short index now that the
appendices exist in full (finding 1's own restoration), and duplicating the listings here would be
redundant rather than complete; the retitle says plainly what the section is, rather than reading
like a second, competing summary of the shape.

**Candidate (b)**, unchanged in recommendation from round 1, now with the finding-1 repair and the
worst-case caveat above. Engine: Appendix A (`boot.asm`), Appendix D (`camera_b.asm`, in full). RAM
contract: §2's own corrected, flat twelve-byte accounting. Frame-by-frame state machine: §3's own
Mesen-proven 16-tick walkthrough. `vram_buf`/NMI accounting: (b) needs none — both its draws are
under forced blank, proven at 0 `vram_buf` occupancy on both the plain and worst-case fixtures.

## 5. Q3-Q8

### Q3 — mirroring, the axis gate, a real capability helper, all eight boards (fix: 5)

**All eight supported boards measured**, not four. `main/build/generate.js`'s current
`CAMERA_SLIDE_H`/`CAMERA_SLIDE_V` computation reads `project.cartridge.mirroring` as a raw string;
this is real, working code (verified: identical +375 delta on CNROM/GxROM/Color Dreams/UxROM as on
NROM/MMC1/UNROM 512, all measured directly), but finding 5 is right that it should route through the
resolved mirroring machinery instead of a raw string, so it automatically tracks
`normalizeCartridge`/`reconcileCartridge`'s own fallback behaviour rather than needing to reimplement
it. Proposed:

```js
// shared/cartridge.js
export function cameraAxes(mapper, cartridge) {
  // Round 3 finding 3's own fix: resolve the requested mirroring against
  // THIS CANDIDATE mapper's own legal set, not the global MIRRORING array.
  // mirroringById(cartridge.mirroring) alone answers "what does this id mean
  // in the abstract" -- it says nothing about whether the CANDIDATE mapper
  // being evaluated can actually provide it, so a four-screen UNROM 512
  // project evaluated against, say, NROM (switchableMappers asking "would
  // this board still work") would incorrectly report BOTH axes live: NROM
  // cannot do four-screen at all, but mirroringById('fourscreen') resolves
  // successfully regardless of which mapper is asking.
  const requested = mirroringById(cartridge.mirroring);
  const legal = mirroringOptions(mapper); // filters out fourScreen entries
                                           // for a mapper that doesn't
                                           // support them -- the same
                                           // predicate normalizeCartridge/
                                           // reconcileCartridge already use
  const mirroring = legal.some((entry) => entry.id === requested.id)
    ? requested
    : mirroringById('vertical'); // the identical fallback normalizeCartridge
                                  // uses for an out-of-set value -- MIRRORING[1],
                                  // never "neither axis"
  return {
    horizontal: mirroring.id === 'vertical' || Boolean(mirroring.fourScreen),
    vertical: mirroring.id === 'horizontal' || Boolean(mirroring.fourScreen)
  };
}
```

**Verified by hand against the real, unmodified `shared/cartridge.js`** (its actual
`mirroringById`/`mirroringOptions`/`MIRRORING` — not a reimplementation): a four-screen UNROM 512
project's `cartridge.mirroring === 'fourscreen'`, evaluated as `cameraAxes(nromMapper, cartridge)`
(NROM does not support four-screen), correctly answers `{horizontal: true, vertical: false}` — the
`'vertical'` fallback's own axes, H-only — where the unfixed helper above answered
`{horizontal: true, vertical: true}`, silently claiming an axis NROM cannot provide. **Two tests
specified**: (1) four-screen evaluated against each of the seven non-UNROM-512 boards individually,
asserting H-only every time (not merely "not both"); (2) an invalid mirroring string (not in
`MIRRORING` at all) evaluated against any mapper, asserting the identical H-only fallback rather
than a thrown error or `undefined` — matching `mirroringById`'s own `?? MIRRORING[1]` behaviour for
a value that fails even the first lookup.

**Generator, ledger, hints, Build panel and `switchableMappers` all consume this one function's
result, never a second reading of the raw mirroring string.** `CAMERA_SLIDE_H = cameraAxes(mapper,
project.cartridge).horizontal` (and the vertical counterpart) is what the generator emits;
`switchableMappers`' own camera rule (below) calls `cameraAxes(candidateMapper, cartridge)` —
*with the candidate mapper*, not the project's current one — which is exactly the case the fix
above exists for: evaluating what a *different* board would do to the project's current mirroring
choice is the one call site that was silently wrong before this round's fix, since every other
consumer only ever evaluated the project's own already-legal mirroring against its own already-
legal mapper, where the bug could never surface.

**"Neither axis" is not a real, reachable state, confirmed by reading the normalization code
directly, not merely asserted.** `normalizeCartridge` (`shared/project.js`): `mirroringOptions(mapper)
.some((entry) => entry.id === raw?.mirroring) ? raw.mirroring : 'vertical'` — any mirroring value not
in the board's own legal set falls back to `'vertical'` on load. `reconcileCartridge`'s own
equivalent check (the same shape, run after any mapper/mirroring edit) does the same. Because
`cameraAxes` above routes through `mirroringById`, which has the identical `?? MIRRORING[1]`
fallback, even a hypothetical un-normalized read degrades gracefully to the `'vertical'` default's
axes (H only) rather than producing "neither" — the dead-code shape is closed at the *helper* level,
not merely by trusting normalization to have already run. Round 1's own "neither axis" row (built by
forcing a raw garbage string directly, bypassing normalization entirely) is kept in §3's own earlier
measurement history as evidence the *shared machinery's own dead cost* is real (251/323 bytes,
depending on round), but is dropped as a user-facing "shape" needing a warning — there is no
normalized project state that reaches it.

**`switchableMappers`' own camera rule**: a candidate mapper is **excluded** from the offered set if
switching to it would cause `reconcileCartridge` to drop an axis the project's current mirroring
provides — the identical treatment CLAUDE.md's own existing rule already gives tilesets and mirroring
generally ("a mapper offered as a fix must still hold every tileset, every screen and the project's
mirroring choice"). This is chosen over "offer it with a note" for consistency with that existing,
established discipline, not as a new mechanism: mirroring degradation is already named in that rule
as disqualifying, not merely footnote-worthy, so camera axes (a direct consequence of mirroring) get
the same treatment rather than inventing a second category of "acceptable silent loss with a note."

**Switching away from four-screen**: only UNROM 512 offers `fourscreen`; switching to any other
mapper makes `mirroringOptions(mapper).some(...)` fail for the current `'fourscreen'` value, so
`reconcileCartridge` coerces it to `'vertical'` — the project **loses its vertical sliding axis**,
keeping only horizontal. This is the existing, unmodified reconciliation behaviour; camera adds no
new mechanism here, only a new *consequence* of it. The Build panel's own mirroring/axis indicator
(§8) should re-render off the same store subscription that already reacts to a mirroring change, so
this loss is visible the moment the mapper switch happens, not a silent capability drop.

**Default project** (`mirroring: vertical`): unchanged from round 1 — horizontal crossings slide,
vertical crossings cut, and every one of §3's own "one axis" rows above *is* this default
configuration on the H axis, not a forced variant.

**Hints** (`shared/cartridge.js:39`), restated in full — the actual proposed strings, not a pointer:

```
horizontal: "Rooms scroll up and down; side-to-side neighbours use hard cuts."
vertical:   "Rooms scroll side to side; up/down neighbours use hard cuts."
fourscreen: "Four independent nametables -- the only choice that can scroll both ways at once.
             Costs a tileset; pick it for that, not for cartridge-board compatibility alone."
```

Changed from round 1's own first-draft wording ("look the same room, mirrored") to "use hard cuts"
— the axis gate built this round means the unsupported axis never shows a mirrored repeat at all
(that was round 1's own fallback description before the gate was real code); it falls back to
today's ordinary cut instead, so the hint should say that, not the visual-glitch outcome the gate
now prevents.

### Q4 — a `Pan` cutscene verb: costed, not built, labelled not costed for byte totals

**Restated in full this round** (round 1's own reasoning, never actually replaced by anything
newer — round 2 pointed at "unchanged from round 1" without restating it).

Falls out of the same machinery with one new complication: `Pan` needs to slide to a screen-
relative or absolute offset and back, not to a *neighbouring screen's* content — there is nothing
to draw into the far nametable for an arbitrary pan target the way there is for a real screen edge
(the far nametable would have to hold a rendering of *part of the same screen*, offset, which the
existing tileset/mirroring machinery has no notion of at all). Wire format would plausibly be
`[OP_PAN, dx, dy, duration]`, suspending the script the way `Move` does (`script_op_move`'s own
shape). Position in `EVENT_COMMANDS`: before the virtual tail (`branch`/`choice`/`route`, in that
fixed order — CLAUDE.md's own "The event system" section), immediately after whichever real `OP_*`
command is added last as of whenever this ships.

**Recommendation: defer.** It is a materially different mechanism (an in-screen pan, not a
between-screens slide) built on the same register but not the same draw machinery this slice
ships, and costing it in full would mean designing a second, distinct consumer of the camera
register in the same document that is trying to keep this slice's own scope to "ships something a
player sees" — the brief's own Q1(a) bar. Costed here only to the depth needed to show it is
feasible and roughly where it would live, not built or byte-measured — **not costed** (§9, §1) means
no byte or cycle figure exists for it in this document, in any round; the mechanism sketch above is
the full extent of what has been designed.

### Q5 — placement, one disjoint formula for (b), measured where it is charged (fix: round 4 finding 4, round 5 finding 2)

**Round 5 finding 2 fixed a real double-count.** Round 4 published a standalone phase-1
(register/NMI) allowance of **20 bytes** (§8, isolated with no consumer assembled at all) *and*
kept the existing `CAMERA_B_SHARED_BASE = 323` as if it were an *additional*, disjoint consumer-only
cost — but 323 was measured against camera **fully off**, so it already contains the 20-byte
register path inside it. Adding `20 + 323 + 52` for a real one-axis project gives **395**, which
contradicts the document's own already-measured, already-correct one-axis total of **375**
everywhere else (§1, §3's master table, the absolute-reservation tuples below) — a NROM project's
proposed reservation under the double-counted formula would be 6936 against a real 6885 `codeBytes`,
margin **51**, outside the required `[20, 40]` band. The fix: **two genuinely disjoint terms**,
never added to each other's own already-inclusive figure:

```
-- Register gate (phase 1, §8) -- charged whenever CAMERA_ENABLED is live, consumer or not:
CAMERA_PHASE1_KERNEL_ALLOWANCE = 20         -- flat across every board (§8's own isolation)
SHAKE_CAMERA_PHASE1_INTERACTION = 19        -- flat, gated on SHAKE_ENABLED -- belongs to the
                                             -- register gate ALONE; there is no second +19 under
                                             -- the consumer (round 4's own doc had one; removed)

-- Consumer gate (phase 2, CAMERA_SLIDE_ENABLED) -- its own INCREMENTAL delta over a phase-1-on
-- build, never over camera-off (that would silently re-absorb the register's own 20 bytes):
CAMERA_B_CONSUMER_BASE = 303                -- flat across every board, MMC3 included (round 5
                                             -- finding 2's own re-measurement, isolated against
                                             -- phase-1-on, not camera-off)
CAMERA_B_AXIS_ALLOWANCE = 52                -- per enabled axis (cameraAxes().horizontal +
                                             -- cameraAxes().vertical, 0/1/2)
CAMERA_B_SPLIT_INTERACTION = 6              -- MMC3 only, gated on SPLIT_ENABLED (live text)
BOUND_TILE_CAMERA_B_INTERACTION = 13        -- flat, gated on BOUND_TILE_ENABLED
```

**Shipped:** `CAMERA_PHASE1_KERNEL_ALLOWANCE` → `CAMERA_KERNEL_ALLOWANCE` (20, unchanged);
`SHAKE_CAMERA_PHASE1_INTERACTION` → `CAMERA_SHAKE_INTERACTION_ALLOWANCE` (19, unchanged);
`CAMERA_B_CONSUMER_BASE` → `CAMERA_SLIDE_KERNEL_ALLOWANCE` (303 → 298); `CAMERA_B_AXIS_ALLOWANCE` →
`CAMERA_AXIS_KERNEL_ALLOWANCE` (52, unchanged); `CAMERA_B_SPLIT_INTERACTION` →
`CAMERA_SPLIT_INTERACTION_ALLOWANCE` (6, unchanged); `BOUND_TILE_CAMERA_B_INTERACTION` →
`BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE` (13 → 6) — §11's own changelog entry has the full
decomposition of both re-measured figures.

**The full-camera total for a real, shipping one-axis project is the SUM of both gates**: `20 + 303
+ 52 = 375` — identical to every already-measured total in this document, now correctly *derived*
from two disjoint terms rather than accidentally matching while one term silently double-counted
the other. **If 323 is written anywhere else in this document, it must be labelled "full-camera
subtotal = 20 (register) + 303 (consumer base)" and never added to the phase-1 term again** — it is
a convenience subtotal for the common case (both flags on, which is every real shipping project,
Q6 above), not an independent cost. **Shipped: 20 + 298 + 52 = 370**, five bytes under this
prototype total (§11's changelog entry).

**Consumer-only incremental delta, measured directly against a phase-1-on build (not camera-off),
on NROM and MMC3, confirming 303/303+6**:

```
--- NROM (sample), one axis ---
off=6510 phase1-only=6530 (+20) full-(b)=6885 (+375 over off, +355 over phase1)
--- MMC3 (sample-mmc3), one axis, textless (SPLIT_ENABLED=0) ---
off=5526 phase1-only=5546 (+20) full-(b)=5901 (+375 over off, +355 over phase1)
--- MMC3 (sample-mmc3), one axis, WITH text (SPLIT_ENABLED=1) ---
off=6363 phase1-only=6383 (+20) full-(b)=6744 (+381 over off, +361 over phase1)
```

**+355 over phase1 = 303 (consumer base) + 52 (one axis), exactly** — both NROM and MMC3 textless
agree, confirming the consumer base is flat across boards, the same discipline the (now-retired)
323 figure held to. **+361 over phase1 = 303 + 52 + 6 (split live)**, on MMC3 with text — confirming
the split interaction is still exactly 6, now correctly charged only on top of the consumer's own
303, not on top of a base that had already absorbed the register's 20.

**+19 belongs to the register gate alone.** Round 4's own document additionally listed
`SHAKE_CAMERA_B_INTERACTION = 19` under the *consumer* formula — removed this round: the Shake+
camera composition code lives entirely in `nmi_scroll` (Appendix A), which is phase-1's own file,
gated on `CAMERA_ENABLED`, not `CAMERA_SLIDE_ENABLED` — the consumer contributes no code to that
interaction at all, so charging it a second time under the consumer would double-count the
identical 19 bytes the register gate already charges (§8's own isolation, re-confirmed there:
`phase1-alone=6530`, `phase1+shake=6609`, interaction exactly 19).

**A real absolute-reservation check, re-derived with the disjoint formula**, using the scratch
harness's own real `kernelCodeBytes` import (`main/build/generate.js`) — not a worked example
against a nonexistent function, an actual call against the real one, with the two disjoint camera
terms added by hand to its return value and compared against nesasm's own measured usage:

```
NROM action, camera OFF : reservation(kernelCodeBytes)= 6541  real codeBytes= 6510  margin= 31
MMC1 RPG,    camera OFF : reservation= 5946  real codeBytes= 5926  margin= 20
--- with camera (disjoint formula: register 20 + consumer base 303 + one axis 52 = 375 added to each) ---
NROM action, camera ON  : proposed reservation= 6916  real codeBytes= 6885  margin= 31
MMC1 RPG,    camera ON  : proposed reservation= 6321  real codeBytes= 6301  margin= 20
```

**Both margins land inside `[KERNEL_SLACK, 2*KERNEL_SLACK]` = `[20, 40]`, unchanged from before**
(31→31, 20→20) — the total added (375) is numerically identical to round 4's own figure, since 375
was always the correct *total*; only the internal accounting that used to attribute it to `323 +
52` (an already-inclusive base plus axis, secretly missing the register's own explicit line item)
now correctly attributes it to `20 + 303 + 52` (three genuinely disjoint, individually-measured
terms that sum to the same real total). The margin check itself was never wrong; the formula
feeding it was.

**RPG measured directly on all three RPG-capable boards, not reasoned by analogy.** `sample-rpg`
(MMC1): +375, identical to the action-side MMC1 figure. mkdtemp RPG variants on MMC3 (+381) and
UNROM 512 (+375): both identical to their own action-side figures. **No RPG-specific interaction
term exists for candidate (b)** — a real, three-board-confirmed finding, closing the gap finding 4
named (round 1's own RPG row was candidate (a)'s own +303 figure, mislabelled as evidence for the
recommended (b); this round's own RPG measurements are all built with `FORGE_CAMERA_CANDIDATE_B=1`
and are the real thing).

**`assertCovers`'s real shape, not `8192 - used`.** `test/unit/kernelbytes.test.js:287-317`:
`kernelCodeBytes` (the *generated*, formula-computed reservation) is compared against
`codeBytes` — nesasm's real usage **measured from the `reset` label's own address**, not the whole
bank — and the margin between them must sit in `[KERNEL_SLACK, KERNEL_SLACK*2]` = `[20, 40]`, never
looser or tighter. Checked directly against this round's own measurements: for NROM, one-axis, (b),
`reset` resolves to the identical address with and without camera (`$C292` both times — camera adds
no code *before* `reset`, only after it), so `codeBytes`'s own delta equals the whole-bank `used`
delta exactly (375 both ways) — meaning every figure in this document's own table already **is** a
valid `codeBytes` delta, not merely a `used` delta, for every board and condition tested. Camera adds
no `kernelTableBytes` growth anywhere (no new per-screen or per-map table row), so this equivalence
holds everywhere, not just on the one board it was directly checked on.

**What was and was not run against the real function, stated precisely.** The absolute-reservation
tuples above call the real, imported `kernelCodeBytes` (`main/build/generate.js`) with the proposed
camera terms added by hand to its return value — a real call, not a reimplementation — and compare
it against nesasm's own real, measured `codeBytes`. What was **not** done this round: wiring
`CAMERA_PHASE1_KERNEL_ALLOWANCE`/`CAMERA_B_CONSUMER_BASE`/`CAMERA_B_AXIS_ALLOWANCE`/the interaction
terms *into* `kernelCodeBytes` itself as real, permanent formula terms (that is shipping code, out
of scope for a design document) — the tuples above add them by hand, on the outside, to the
function's own real output. **Round 6 nit fix**: this passage previously named the obsolete
`CAMERA_B_SHARED_BASE` (round 4's own single, already-inclusive term) as what should be wired in;
the current, disjoint pair (`CAMERA_PHASE1_KERNEL_ALLOWANCE` for the register gate,
`CAMERA_B_CONSUMER_BASE` for the consumer gate, §5/Q5 above) is the real implementation target.
Per CLAUDE.md's own discipline ("individual allowance deltas are equality-asserted... not
margin-checked"), each isolated term (`CAMERA_B_AXIS_ALLOWANCE`, the split/Shake/bound-tile
interactions) should be `assert.equal`'d against its own measured delta once wired in for real — no
slack at that level; the `[KERNEL_SLACK, KERNEL_SLACK*2]` margin check applies only to the
**whole-formula** total against real `codeBytes` usage, exactly what the tuples above already
confirm holds.

### Q6 — gating and schema, implementation-ready (fix: round 1 finding 8, restored in full round 3)

**Field**: `project.cartridge.camera`, boolean, default `false`. Lives in `project.cartridge`
(alongside `mapper`/`mirroring`), not `project.rpg` (this is not RPG-specific — §5's own RPG
measurement confirms the cost and behaviour are identical across game types) and not a bare
top-level field (every other cartridge-board-dependent capability — mirroring, battery save,
four-screen — already lives here, and this feature's own legality depends on the *board* the same
way: `rpgCapable()`'s own precedent is a capability gated on what a board can do, and camera's axis
gate is gated on the board's own mirroring choice, `project.cartridge.mirroring`, already a sibling
field).

**Normalization**: `normalizeProject` coerces any non-boolean to `false` (the same policy
`renamable`-style boolean flags already hold to elsewhere in this codebase) — never a thrown error,
since a hand-edited or future-version project with an unrecognized value should degrade to "off,"
not refuse to load.

**Invalid-value policy**: there is no invalid *value* beyond "not a boolean" (coerced above); there
is an invalid *combination* — `camera: true` on a board `rpgCapable()`/`chrPayloadRegions()` would
refuse for an unrelated reason is not this feature's own problem to solve, since the toggle itself
never claims a board it cannot build on (every board this document tested supports it).

**`reconcileCartridge` interaction**: a mapper or mirroring change does not need to touch `camera`
at all — the field is independent of which axis ends up live (that is `CAMERA_SLIDE_H`/`V`,
computed fresh at generation time from whatever mirroring is currently set, never stored). Changing
mirroring while `camera: true` silently changes *which* axis slides, exactly as intended — no
reconciliation needed, unlike a field that could become illegal under a new mapper.

**`validateProject`**: no new refusal. A project with `camera: true` and, say, a
different-tileset-everywhere map layout still builds — every crossing simply falls back to a hard
cut, per §3's own fallback rule. The toggle is a preference, not a promise every edge will slide.

**`projectUsesCamera(project)`** (`shared/project.js`, the single predicate every consumer reads):

```js
export function projectUsesCamera(project) {
  return Boolean(project.cartridge.camera);
}
```

**One project predicate emits both generated flags, round 5's own clarification.** In the shipping
product there is no separate "consumer" toggle — `projectUsesCamera(project)` is consumed by
`generate.js` to emit **both** `CAMERA_ENABLED` (phase 1's own register/NMI rewrite gate) **and**
`CAMERA_SLIDE_ENABLED` (the consumer gate — `screens.asm`'s draw family, `player.asm`'s `cross_*`
modifications, `main.asm`'s own candidate include) from the identical boolean, at the identical
value, always together: a real project's `camera: true` always ships with both flags on, `camera:
false` always ships with both off. **The two-flag split exists only for this document's own
build-phase isolation measurement** (§8's phase 1 contract) — `FORGE_CAMERA_PHASE1_ONLY`, a
scratch-only environment variable with no project-field equivalent, is what forces
`CAMERA_SLIDE_ENABLED` off while leaving `CAMERA_ENABLED` on, to measure phase 1's own +20-byte
cost with zero consumer code assembled. A real, authored project can never reach that
combination — it is a measurement tool, not a shape `projectUsesCamera` itself can produce.

**The invariant, stated and where it is enforced**: `CAMERA_SLIDE_ENABLED ⇒ CAMERA_ENABLED` — a
slide consumer can never be live without the register path also being live, since nothing else
publishes `cam_x_lo`/`cam_y_lo`/`cam_nt` for `nmi_scroll` to read. Enforced structurally, not by a
runtime check: `main/build/generate.js`'s own `CAMERA_SLIDE_ENABLED` expression
(`process.env.FORGE_CAMERA_PROTOTYPE && !process.env.FORGE_CAMERA_PHASE1_ONLY`) can only be true
when `FORGE_CAMERA_PROTOTYPE` is truthy, which is the identical condition `CAMERA_ENABLED` itself
tests — the consumer flag is a strict narrowing of the register flag's own condition, never an
independent one, so the invariant holds by construction of the generator expression itself, not by
a separate assertion that could drift out of sync with it. In the real, shippable field
(`project.cartridge.camera`, no phase-isolation variable), the two flags are simply identical at
every value, making the invariant trivially true there too.

Consumed by `generate.js` (emits both `CAMERA_ENABLED` and `CAMERA_SLIDE_ENABLED`), the kernel-lo
ledger (charges §5's own disjoint register/consumer terms, each gated on its own further
condition), `kernelShortfallAdvice` (the removal lever), and the Map Forge/Build panel UI (§8) —
one predicate, the same discipline `projectUsesShake`/`projectUsesMove` etc. already hold to.

**The `SPLIT_ENABLED`-gated bytes are charged on `SPLIT_ENABLED` itself (font-bank-split live, MMC3
only, which already means live text), not on "MMC3 as a mapper."** A camera-enabled MMC3 project
with no text at all does not pay it — `SPLIT_ENABLED`'s own gate (`fontBankSplit`) already answers
"is the scanline IRQ live," and this feature's own extra `sta $E000` inside `redraw_screen_slide`'s
forced-blank prologue is conditional on that, not on the mapper number, in the code as built
(`.if SPLIT_ENABLED`, Appendix D) — round 1's own ledger table conflated "MMC3" with "the split is
live," which round 2's own reviewer correctly flagged as two different conditions
(`fontBankSplit`/`SPLIT_ENABLED` depend on live text, per CLAUDE.md's own "The engine" section) —
finding 2 (this round) carries that correction one step further: the shared *base* (not just the
split interaction) had absorbed a repair that belonged in the interaction term instead (§5/Q5).

**No `SAVE_LAYOUT_VERSION` bump, with the fuller reasoning round 1's own finding 8 asked for**: not
merely "the gate blocks button dispatch" — `main_loop`'s own gate (Appendix A) skips `settle_owed`,
`dispatch_input`, `update_player` and `update_entities` *together*, for the whole slide/stream
duration, which is every path that could either (a) read a button into an action or (b) settle an
owed warp/entry event. A scripted `Save` command can only run through `start_dialog`'s own event
dispatch, which is itself only reached through `settle_owed` or `dispatch_input` — both skipped. So
it is not merely "Save's own path is blocked," it is "every path that could reach *any* scripted
command is blocked," Save included as one instance, not a special case.

**`cameraAxes` (Q3, above) is the one addition since round 1**: consumed by the same
`projectUsesCamera`-gated callers rather than a second reading of raw mirroring.

### Q7 — item 15 compatibility, c-lite's claim narrowed (fix: 3, 9 carried from round 1)

What item 15 **keeps**: the camera register and its NMI application (§2, including this round's own
snapshot-publication mechanism — item 15's own continuous camera would need the identical torn-
publication protection this round had to add for a 16-tick slide, so the mechanism generalizes
cleanly); the frozen-world gate shape; the parametrized `draw_screen_at`/`set_screen_ptr_for`/
`rebuild_bound_cache_for` trio.

What item 15 **cannot simply inherit from c-lite, stated plainly this round rather than hedged**:
row-major streaming is not directly reusable for a continuous, column-major horizontal camera (round
1's own correct narrow claim, kept); **and, new this round, c-lite's queue-protocol experience comes
with an unsolved cancellation problem attached** — a continuous gameplay camera's own streaming
producer would face the identical "Flash/Shake/flip backlog with no forced blank to cancel into"
problem c-lite never solved, at a much higher rate (every frame, indefinitely, not once per
crossing). Item 15's own design round inherits this as a **named open question**, not a solved
precedent. c-lite is offered as *queue-protocol experience and a row-expansion routine that can
inform later work* — the reviewer's own phrase, adopted verbatim — not as a foundation.

### Q8 — UI: unchanged from round 1, plus the axis-loss indicator (finding 5)

A checkbox beside the mirroring selector; the reworded hint text; a per-edge "this edge will cut, not
slide" note where tilesets differ; **new this round**, the same indicator should reflect an axis lost
to a four-screen-to-other mapper switch (Q3, above), reactively, off the existing mirroring-change
store subscription. ▶ Test stays a cut, unchanged.

**Shipped:** the checkbox is in the Build panel's Cartridge section, beside Mirroring, confirming
"beside the mirroring selector" rather than the Map Forge; the per-edge mismatch note was not built,
since no authoring path can produce a mismatched pair (`flattenScreens` never pairs neighbours
across a map boundary); the mirroring row shows on every board once camera is on, not only on a
four-screen switch. ▶ Test was confirmed unchanged by reading `renderer/emulator/testplay.js` in
full — no reference to `cross_*`, `CAM_*` or any camera symbol.

## 6. What could go wrong (fixes: round 2 findings 1, 2; round 1 findings 3, 4, 6, 7 — kept)

**Round 1's own findings, restated in full** (round 2 pointed at this text rather than repeating
it):

1. **A backward-compatible-looking single-body refactor of `nmi_scroll` cost 3 bytes on the
   off-path.** The first version of this prototype tried to add one `jmp nmi_scroll_done` at the
   end of the *original* (untouched-looking) no-Shake block, reasoning that both the old
   fall-through path and the new camera path needed to reach the same label. This is wrong: the
   original code never needed a `jmp` there because `nmi_scroll_done:` was the very next line;
   adding one changed the off-path's own assembled bytes even though the *source* around it looked
   unchanged, and even though the new `.if CAMERA_ENABLED` block was correctly gated to emit zero
   bytes when off. Caught only by actually diffing the assembled ROM's SHA-256 against a
   stashed-clean rebuild and bisecting the `.fns` symbol table to find the first address that moved
   — reading the diff alone did not surface it, because the diff *looked* like a pure addition.
   **The lesson: prove off-path byte identity by hash, on every board, after every edit that
   touches a file with an existing `.if !X` fallback body, not by re-reading the diff.**
2. **A `beq cross_none` became an out-of-range branch the moment the camera code was inserted ahead
   of it.** `cross_left/right/up/down` each have their own `cmp #NO_SCREEN` / `beq cross_none`
   pair, and `cross_none` is a single shared label after all four. Inserting the ~40-byte
   tileset-check-and-dispatch block between any one `beq` and the shared `cross_none` target pushed
   that branch past the 6502's ±128-byte range — nesasm's own "Branch address out of range!" error,
   exit code non-zero (this one *does* fail the build loudly) but only once all four directions
   were wired, not after the first. Fixed with the standard `bne <skip> / jmp cross_none / <skip>:`
   long-branch idiom (visible in every `cross_*` stub, Appendix C), gated the same way as
   everything else so the off-path keeps its original two-byte `beq`. **The lesson: any insertion
   ahead of an existing short branch's target must be checked for range, and the check has to
   happen after the *last* piece of new code is wired, not the first.**

**Read-only traps, confirmed against source rather than found by a failing build:**

3. **`bound_tile_lookup`/`rebuild_bound_cache` are keyed off `<flat_screen` for a single active
   cache.** A slide drawing two screens under one forced blank needs **two** rebuilds, correctly
   sequenced, or a switch-bound tile drawn during a slide shows whichever screen's cache happened
   to be resident last. `rebuild_bound_cache_for(y)` (Appendix C) is the fix — parametrized the same
   way `set_screen_ptr_for` already is, called once per screen inside `redraw_screen_slide`, back
   to back under the same forced blank with nothing else able to read or write the cache in
   between, so two persistent caches were never needed — one, reused sequentially, is always
   correct for whichever screen is about to be drawn. **Shipped:** candidate (b) calls plain `jsr
   rebuild_bound_cache` once at arming and once at completion, under separate forced blanks. Both
   calls read the incoming `<flat_screen`; the outgoing screen is never redrawn, so no
   parametrized wrapper or second cache is needed.
4. **`vram_reset` drops queued packets exactly as it does today.** A Flash or Fade command that was
   mid-flight the instant a screen edge is crossed loses its queued packet the same way it already
   would under today's hard cut. Nothing about the slide makes this worse; it is `redraw_screen`'s
   existing contract, inherited unchanged — and, per finding 7 (round 1) and finding 5 (round 3,
   this document), `vram_reset`'s own Flash-cancellation branch is what a live hold-terminal Flash
   at the crossing actually exercises, verified this round with a real injected `flash_left`.
5. **A live text box can never be open during a slide.** `cross_*` is only ever reached from
   `update_player`, which only runs while `game_state == ST_GAMEPLAY` (dialogue freezes the world
   via `ui_tick`'s own dispatch, never reaching `update_player` at all) — so `split_select`'s own
   `box_state` check (`engine/split.asm`) naturally evaluates `SPL_OFF` for the whole slide with no
   special-casing needed, verified by reading `split_select`'s body directly rather than assumed:
   a text box can never be open during a slide, so `split_select` naturally picks `SPL_OFF`.

**New this round:**

8. **A publication lock that only covers the second of two stores is not a lock.** Finding 1's own
   first half: reordering `inc <cam_dirty>` to before the first store, not after it, is the whole
   fix — `inc`/`dec` never touch the accumulator, so this reorder needed no register-preservation
   work, just moving one instruction. Easy to get wrong in exactly the direction round 1 did: writing
   the "obviously safe" single-byte store first and the "risky" two-byte toggle second, when the
   real risk starts at the *first* store of the pair, not the second.
9. **"Skip the write" is not the same as "keep the old value" once anything else could have touched
   the hardware register first.** Finding 1's own second half: NMI's own drain runs *before*
   `nmi_scroll`, and the drain's own `$2006` writes already move the PPU's addressing state — a
   routine that conditionally skips its own final write is not thereby preserving whatever was there
   before its own routine started; it is preserving whatever the *previous* routine left, which may
   not be what the skip's author had in mind. The fix (a snapshot that is always written, refreshed
   only when safe) avoids this by never skipping the write at all, only ever choosing which value to
   write.
10. **A loop-budget register handed to a callee is not preserved just because the callee's own
    convention preserves "X"** — it preserves whatever value is in X *when the callee's own body is
    done with it*, which may be a completely different number, in a completely different sense, than
    what the caller put there. Finding 2's own exact shape: `cl_emit_row`'s own internal loop
    (0→15 or 0→31) uses X for its own purposes and, being a well-behaved routine, leaves X in a
    defined state on return (16 or 32) — "well-behaved" and "preserves the caller's own value" are
    different properties, and conflating them is what let one tick silently consume the entire
    32-row budget.

## 7. Test plan, precise trigger/observation/outcome for every row (fix: round 2 finding 8, carrying round 1's own rebuild forward)

Every row below names its trigger, its observation point, and its expected outcome — the standard
finding 8 asks for, applied to every row, not only the ones it called out by name.

| Test | Trigger | Observation point | Expected outcome | Catches |
|---|---|---|---|---|
| Six-fixture SHA-256 identity | Build all six fixtures with `CAMERA_ENABLED` off | ROM hash | Byte-identical to a fresh HEAD build | Any off-path leak from any of findings 1-10 |
| Per-term kernel-lo delta, equality | Build with/without each of axis/split/Shake/bound-tile live, (b) only | `used`/`codeBytes` delta | Exactly matches §5's own named constant | A stale allowance |
| `assertCovers`-shaped absolute row | Full (b) build, each board/game-type §5 charges | `kernelCodeBytes` (once wired) vs. real `codeBytes` | Margin in `[KERNEL_SLACK, 2*KERNEL_SLACK]` | The base+camera sum drifting out of the real margin band (finding 4) |
| **Publication: NMI mid-wrap (finding 1, regression, synthetic)** | **Synthetic**: force an NMI to fire between a wrap tick's low-byte store and its `cam_nt` toggle (jsnes: step to the instruction boundary right after the low-byte `sta`, then invoke the NMI handler directly — real play cannot land an NMI at a chosen instruction boundary on demand) | `nmi_cam_x_lo`/`y_lo`/`nt` immediately after that NMI | Equal to the **pre-tick** complete coordinate (the snapshot was not refreshed, since `cam_dirty` was set at that exact boundary) — never the torn combination | Finding 1's own reproduced bug recurring |
| **Publication: dirty-set with a packet also draining (finding 1, regression, synthetic)** | **Synthetic**: hand-set `cam_dirty=1`, queue a one-byte packet via `vram_open`/`vram_push`, run one NMI | Live PPU scroll (`regH`/`regHT`/`regFH`/`regV`/`regVT`/`regFV`, the reviewer's own harness shape) after that NMI | Equal to the **last-complete snapshot's** coordinate, not `(0,0)` and not the drain's own leftover PPUADDR state | The exact defect the reviewer reproduced against `/tmp/mesen_b/game.nes` |
| `camera.test.js`: shake-over-rest-camera | Camera at rest (`cam_x_lo=cam_nt=0`), Shake live | `$2000`/`$2005` sequence over several NMIs | Byte-identical to today's unmodified Shake output | The composition regressing |
| **`screen_fresh`, arming frame (finding 8)** | Player at the crossing threshold, holds the crossing direction; observe the exact frame `cross_*` calls `redraw_screen_slide` and returns | Whether `update_player` executes its second-axis movement check, `player_hazard`, or `check_encounter` **on that same frame** | **No second-axis movement, no hazard, no encounter step** — `screen_fresh` (or the slide's own frozen-gate) stops the frame at the `rts` back into `update_player`, mid-routine | A slide's own arming frame silently falling through to ordinary per-frame updates |
| **First claim wins, with a competing actor (finding 8)** | Incoming screen's own entry-triggered event AND a touch-triggered actor positioned so the player's landing square also touches it | Which event's `pending_ent`/`talk_ent` ends up armed | The entry event wins — armed by `spawn_entities` before any touch check runs | Touch-vs-entry ordering breaking under a slide's own multi-frame span |
| **Pending disarmed before it runs (finding 8)** | Incoming screen's entry event fires once the slide settles | `pending_ent` immediately after `start_dialog` is entered | `NO_ENTITY` — disarmed before the event body runs, so a warp inside it does not re-trigger itself | A slide re-arming the same event on its own settle frame |
| **Legitimate re-arming on re-entry (finding 8)** | Cross back into the same screen a second time via its own edge (not the same standing position) | The screen's own entry event | Fires again — re-entering a screen legitimately re-arms its entry event | Conflating "an event that already ran on this visit" with "an event that can never run again" |
| **Touch re-arming only by walking off (finding 8, restored round 3 — dropped, not just moved, in round 2's own rebuild)** | Touch a touch-triggered actor, let its event finish, remain standing on it, then walk off and back onto it | The actor's own event on the second approach | Does **not** fire while still standing on it after the first run; fires again only after `ent_touched` is cleared by walking off (`update_entities`'s own edge, unrelated to any slide) | Conflating "re-entering a *screen*" (the row above) with "re-touching an *actor*" — two different re-arming rules this design must not blur under a slide's own multi-frame span |
| **Stale pending, explicit synthetic injection (finding 8, marked synthetic)** | **Synthetic**: hand-poke `pending_ent` to an inactive slot's own index (a state normal play cannot reach, since nothing can deactivate an entity during a frozen slide) | `settle_owed`'s own guard, which reads `ent_active,x` for the poked index | Falls through to `settle_owed_none` — **no `start_dialog`/event execution** (the guard does read `ent_active,x` to test the slot, it just never proceeds to run anything for an inactive one — "never dereferences" would be the wrong claim, since the read itself is exactly what the guard does) | The inactive-pending guard regressing, tested directly since it is not otherwise reachable |
| **Owed-before-buttons, competing warps — corrected round 4 (`engine/script.asm:358-373`, `engine/boot.asm:158-160,229-237`)** | On the settlement frame, `pending_ent` is armed for the incoming screen's own entry event, whose first command is an unconditional `Warp` to screen X; a held interact button is aimed at a *different* actor whose own event would request warp Y | `warp_scr`/`warp_x`/`warp_y`/`warp_ready` and `flat_screen`, sampled **on the settlement frame itself** and again **one frame later** | On the settlement frame: `settle_owed` finds `pending_ent` set (not `warp_ready`, which is still 0 — the warp hasn't happened yet), disarms it, and calls `start_dialog`, which runs the event's own `script_op_warp` — this only writes `warp_scr`/`warp_x`/`warp_y` and sets `warp_ready=1` (`engine/script.asm:358-373`); it does **not** change `flat_screen` itself. `settle_owed` returns 1, so `main_loop` jumps straight to `main_loop_draw`, and `dispatch_input` — the held interact button's own path — never runs this frame at all; warp Y's own actor is never touched. **One frame later**: `settle_owed` now finds `warp_ready` already set and calls `take_door`, which is what actually changes `flat_screen` to X. The correct assertion is therefore two-part: (1) settlement frame — `warp_ready` becomes 1 with the destination fields naming X, and `flat_screen` is **unchanged**; interact is suppressed; (2) the following frame — `flat_screen` becomes X when `take_door` runs. Asserting "`flat_screen` changed on the settlement frame" is the wrong claim and would pass a broken build that warped on the wrong frame just as easily as a correct one. | `settle_owed`'s own two-phase warp protocol (queue this frame, take the door next frame) being collapsed into "happens immediately," which would hide a regression that queues the warp correctly but never reaches `take_door` at all |
| **Dispatch stops after a screen/warp, two real `dispatch_input` actions — corrected round 5 (finding 3; `engine/input.asm:84-97`)** | `sample`'s own default bindings, unchanged: B (read before Select) = Interact, Select = Item. An **ordinary NPC actor** (`BEH_NPC`, not a door — round 5 finding 3's own correction, since `do_talk` explicitly skips `BEH_DOOR`, `engine/input.asm:335-346`: doors are touched, never talked to) placed within reach, whose event's first and only command is an unconditional `Warp` to a different screen. B and Select held together on the same frame. B's own `do_action_interact → do_talk → start_dialog → script_start` runs the event **synchronously within that one `do_action` call**: `script_op_warp` sets `warp_ready=1` and returns via `script_finish → box_close` (the box was never raised, so `box_close` takes its own `box_state == 0` shortcut straight to `close_ui`, which resets `game_state` to `ST_GAMEPLAY` — also synchronously, same call) | Whether Select's own effect (`game_state` becoming `ST_MENU`, `open_menu`'s own unconditional write) happens that frame, and where `flat_screen` ends up | It does **not** open — `dispatch_input`'s stop condition, read fresh after every button's own `do_action` call, is `lda screen_fresh; ora warp_ready; bne dispatch_done` (`engine/input.asm:88-90`), **not** a `game_state` re-read; B's own synchronous warp leaves `warp_ready=1`, so the `ora`/`bne` fires immediately after B and Select is never read at all that frame. `game_state` stays `ST_GAMEPLAY` (not `ST_MENU`) and, later the same frame, `main_loop`'s own `warp_ready` check (reached because `game_state == ST_GAMEPLAY` did not divert it to `main_loop_ui`) calls `take_door` — `flat_screen` lands on the warp target **the same frame**, verified: `finalFlatScreen=2` (the real warp target), `finalGameState=0` (`ST_GAMEPLAY`). **The executed mutant**: removed the `ora <warp_ready` / `bne dispatch_done` pair from the scratch tree's own `engine/input.asm` and re-ran the identical scenario (`verify_dispatch_stop.mjs mutant`, real jsnes stepping, real B+Select controller presses, no direct routine call) — result: `finalGameState=1` (`ST_MENU` — Select's own action *did* fire) and, further, `finalFlatScreen=0` (**the warp never lands at all** — `game_state` became `ST_MENU` before `main_loop` reached its own `warp_ready` check, so that check is skipped in favor of `main_loop_ui`, and the queued warp stalls behind the now-open menu with nothing left in the scenario to close it). The mutant is strictly worse than a same-frame ordering slip: it also loses the warp. | Two actions landing in the same settled frame; misattributing the stop condition to `game_state` instead of `screen_fresh \| warp_ready`, which would leave this exact regression un-caught since `game_state` genuinely does stay `ST_GAMEPLAY` on the correct build — the bug only shows up in `game_state`'s value on the *mutant*, once the mutant is actually run and compared, not by reasoning about the correct build alone |
| **Warp chain survives the old event's return (finding 8)** | Incoming screen's own entry event immediately issues a warp to a third screen | The third screen's own newly-armed `pending_ent`/`screen_fresh` after the warp lands | Both survive intact — not cleared by the original (now-returned) event's own cleanup path | A slide interacting with an existing warp-chain contract it did not itself change |
| **Diagonal crossing, axis priority correctly attributed (finding 7, corrected)** | Both a horizontal and vertical direction held at the crossing threshold | Which axis slides | Exactly one — **`update_player`'s own horizontal-then-vertical movement order** decides which axis is even evaluated first (`update_player` checks/applies the horizontal step, then the vertical one, every ordinary frame, slide or not); `dispatch_input` never sees a direction at all, since directions are read and applied inside `update_player`, not dispatched as `ACT_*` actions | A live slide and simultaneous-axis input interacting badly, and — separately — misattributing this to `dispatch_input`, which owns none of it |
| World frozen every tick | Sample `game_state`/`enc_step`/every entity's position on each of the 16 ticks | All 16 samples | Identical to the arming frame's own values | A mid-sequence tick falling through to ordinary updates |
| **Shake wrap lows, both nametables (marked synthetic)** | **Synthetic**: hand-set `cam_x_lo` to 0/1/254/255, both at rest (`cam_nt=0`) and mid-slide (`cam_nt=cam_far`) — a slide's own 16-step arithmetic does not naturally land on every one of these eight boundary combinations within a single crossing, so they are injected directly rather than driven to by play | Composed $2005 output | Correct for all eight combinations | The carry/borrow polarity being right at one nametable and wrong at the other |
| First-visible-frame | Read the PPU's actual scroll immediately after forced blank lifts, with and without an NMI landing before the first visible scanline | Camera position shown | Matches the published coordinate either way | Finding 1 (round 1) regressing. **Shipped:** satisfied by phase 2's own `test/unit/camera.test.js` test, "the coordinate lands on the PPU before rendering turns on, both at arm and at completion". |
| Bound-cache cross-bank | Distinct active bindings on outgoing and incoming screens | Collision result on the incoming screen immediately post-slide | Matches the incoming screen's own bindings, not the outgoing's | Finding 4 (round 1) regressing |
| Default-project vertical fallback | Default mirroring (`vertical`), cross a vertical edge | Whether a slide or a cut happens | A cut — `CAMERA_SLIDE_V` is 0 under vertical mirroring | The axis gate being backwards for the shipped default |
| **`cameraAxes` four-screen-as-each-other-board (finding 3)** | Evaluate `cameraAxes(candidateMapper, {mirroring: 'fourscreen'})` for each of the seven non-UNROM-512 boards in turn | The returned `{horizontal, vertical}` | H-only every time (`{horizontal: true, vertical: false}`) — never both, matching the `'vertical'` fallback, not the raw `fourscreen` value the candidate mapper cannot provide | The bug finding 3 found: `mirroringById` alone resolving successfully regardless of which mapper is asking |
| **`cameraAxes` invalid mirroring string (finding 3)** | Evaluate `cameraAxes(anyMapper, {mirroring: 'garbage'})` | The returned `{horizontal, vertical}` | H-only (the identical `'vertical'` fallback), not a thrown error and not `undefined` | A value that fails even `mirroringById`'s own first lookup crashing the ledger/generator instead of degrading gracefully |
| Mesen: transition proof (finding 4, rewritten round 3) | The full Appendix G harness — completion detected on RETURN, not entry; idle state, countdown zero, rendering enabled, first resumed NMI deadline all checked after completion; `vram_buf` workload independently predicted (not the wrapping `vram_len` byte) and bound-checked; final NT0 tile+attribute bytes compared against an independent JS-built reference via Mesen's own PPU memory; every symbol anchor preflighted | Stub taken, armed, ticks complete (16 for the slide, plus (b)'s own completion step), completion genuinely returned, workload matches prediction, NT0/attributes match byte-for-byte, NMI deadline met, every anchor preflighted | All pass, on (a) and (b), on both a plain and a worst-case (8 active bound entries × 2 screens, a real injected hold-terminal Flash) fixture — four runs, `exit 0` each | Exactly what round 2's own harness could not catch: a `completed` flag set on entry rather than return, and a `vram_len > 256` check that could never fire since it is a byte |
| **c-lite: two-row/70-byte budget per tick (finding 7)** | One `cl_stream_tick` call, post-fix (`cl_budget` byte, not X) | `cl_row`'s own advance and `vram_len` after the tick | `cl_row` advances by exactly 2; `vram_len` settles at 70 (2 packets × (3-byte header + 32 bytes)) | Finding 2 (round 2)'s own bug — the entire 32-row budget consumed in one tick — recurring |
| **c-lite: 49 ticks to completion (finding 7)** | Drive the real `camera_slide_tick` dispatcher repeatedly (not `cl_stream_tick` directly) from arm to `cl_state == 0` | Total tick count and final `cam_nt` | Exactly **49** ticks (16+16+16 plus the FLIP tick), landing on `cam_nt == 0` | The FLIP tick silently folding into the 48th, undercounting completion by one |
| `main/smoke.js` | Cross an edge with the toggle on | Post-slide state vs. a plain crossing's own end state; at least one intermediate frame's pixels differ from both endpoints | Match / differ as expected | A UI wiring regression |

## 8. Phasing

Restated in full — unchanged in shape from round 1, candidate updated to (b). **Round 4 finding 4**:
every phase now carries its own one-paragraph contract — gate, off-path identity, independently
measured on-path allowance, and ledger/test wiring — not a shared, implicit assumption borrowed
from the full candidate's own figures.

- **Phase 1 — the camera register and NMI rewrite alone (Q1), no consumer.** **Gate**:
  `CAMERA_ENABLED` alone (round 4's own split, `main/build/generate.js`) — this is now genuinely
  independent of whether any consumer exists: `CAMERA_SLIDE_ENABLED` is the separate flag gating
  `screens.asm`'s `draw_screen_at`/`set_screen_ptr_for`/`rebuild_bound_cache_for` family
  (**Shipped: only `draw_screen_at` shipped** — `set_screen_ptr`/`rebuild_bound_cache` are called
  directly, unparametrized, since they already read `<flat_screen` internally and (b) never draws
  the outgoing screen; see the note on §0/§6's own `_for` mentions below),
  `player.asm`'s `cross_*` stub modifications, `main.asm`'s own `camera*.asm` include, and
  `boot.asm`'s own frozen-world gate in `main_loop` — none of that consumer code assembles when
  `CAMERA_SLIDE_ENABLED` is 0, even with `CAMERA_ENABLED` on. **Off-path identity**: with
  `CAMERA_ENABLED` off, the six checked-in fixtures are byte-identical to a fresh HEAD build
  (unchanged, six-fixture SHA-256, reproven this round). **"ROM-neutral" defined precisely**: this
  means *disabled builds are unchanged* — it does **not** mean enabling phase 1 costs nothing; a
  project that turns phase 1 on pays a real, measured allowance whether or not a slide consumer is
  ever built on top. **Independently measured on-path allowance** (round 4, isolated with
  `CAMERA_ENABLED=1`, `CAMERA_SLIDE_ENABLED=0` — no consumer assembled at all, verified by
  `player.asm`'s `cross_*` stubs, `screens.asm`'s draw family and `main.asm`'s own include all
  compiling byte-identical to camera-off): **+20 bytes, flat across all four measured boards**
  (NROM 6510→6530, MMC1 5926→5946, MMC3 6363→6383, UNROM 512 6534→6554 — every board's own delta is
  exactly +20, matching §2's own hand-counted figure exactly, now confirmed as phase 1's *entire*
  cost, not merely a component of the full candidate's own base). The +19 Shake interaction is
  re-confirmed in this same isolation (base 6510→6530 phase-1-alone, Shake-alone 6510→6570,
  phase-1+Shake 6510→6609; naive sum 6590, actual 6609, interaction = exactly 19 — identical to the
  full candidate's own figure, since the composition code phase 1 owns is the same code either
  way). **Ledger/test wiring**: a new, standalone `CAMERA_PHASE1_KERNEL_ALLOWANCE = 20` term
  (flat, no per-mapper table needed — the isolation above measured all four boards identical),
  `assert.equal`'d against its own delta per CLAUDE.md's own per-term discipline, gated on
  `CAMERA_ENABLED` alone; an absolute row (`kernelCodeBytes` with phase-1-only vs. real `codeBytes`)
  belongs beside §5/Q5's own candidate-(b) rows once phase 1 is implemented for real, following the
  identical methodology. **Shipped as `CAMERA_KERNEL_ALLOWANCE`** — same figure, same isolation
  methodology. **Round 5 finding 2's own correction**: `CAMERA_B_CONSUMER_BASE`/axis/split
  terms (§5) are the *consumer's own* incremental delta measured against a **phase-1-on** build, not
  against camera-off — round 4's own text here claimed the old `CAMERA_B_SHARED_BASE = 323` was
  "additive, not overlapping" with this 20-byte term, which was wrong: 323 was measured against
  camera fully *off*, so it already contained this exact 20 bytes inside it, and adding them again
  would double-count the register path (finding 2, §5/Q5). The real, disjoint consumer base is
  **303** (`20 + 303 = 323`, the old figure, now correctly explained as a sum rather than treated as
  a second addend).
- **Phase 2 — candidate (b), screen-edge slides, one axis, same-tileset only.** **Gate**:
  `CAMERA_SLIDE_ENABLED` (derived from `CAMERA_ENABLED` for a real project — there is no separate
  project-level phase-2 toggle; the split is a *build-phase* concept for this document's own
  rollout plan, not a second schema field) plus `CAMERA_CANDIDATE_B`. **Off-path identity**: with
  either flag off, byte-identical (same six-fixture proof, phase 1's own identity already covers
  the `CAMERA_ENABLED`-off case; a `CAMERA_ENABLED=1`/`CAMERA_SLIDE_ENABLED=0` build is phase 1's
  own on-path case, covered above). **On-path allowance**: §5/Q5's own disjoint consumer formula
  (303 base + 52/axis + 6 split), measured incrementally against phase 1, not camera-off; **+13
  bound-tile is the consumer's own interaction, +19 Shake is the register gate's own** (not the
  consumer's — moved in round 5, finding 2). Combined with phase 1's own 20, the full one-axis total
  is 375, matching every other measurement in this document. **Ledger/test wiring**: §5/Q5 in
  full, §7's own per-term equality rows. **Shipped: 298 base + 52/axis + 6 split, 6 bound-tile, 370
  total for one axis** — the shipped build never needed candidate (a)'s `_for` shims, so both the
  base and the bound-tile interaction re-measured lower than this prototype's 303/13 (§11's
  changelog entry has the exact decomposition).
- **Phase 3 — UI (Q8).** **Gate**: none new — this is renderer-only (the Map Forge checkbox, the
  reworded hints, the per-edge tileset-mismatch note, and the Build panel's axis-loss indicator,
  finding 5) with no engine code or generated byte of its own, the same "renderer-only" shape
  item 13/14's own Phase 3 preview canvas used (CLAUDE.md's own precedent). **Off-path identity**:
  trivially holds — no ROM byte changes. **On-path allowance**: zero engine bytes; whatever the
  checkbox itself costs is ordinary renderer code, not kernel-lo. **Wiring**: `main/smoke.js`'s own
  "visit every Forge" coverage, not a Mesen/kernel-lo check. **Shipped:** the checkbox landed in the
  Build Forge's Cartridge section, beside Mirroring, not the Map Forge — this bullet's own phrasing
  was a slip, and Q8's "beside the mirroring selector" was the actual intent
  (`project.cartridge` has exactly one editing surface). The per-edge tileset-mismatch note was not
  built: it is unreachable by authoring, since a tileset is per map and `flattenScreens` never pairs
  neighbours across a map boundary (`handoff-next/camera-phase3-report.md`'s "Decision 6 reading");
  the engine's own tileset-compare cut fallback is kept regardless. The mirroring row shows on
  every board once camera is on, not only UNROM 512, since mirroring picks the sliding axis on
  every board once the camera is live.
- **Phase 4 (open) — MMC1/MMC3 runtime re-mirroring.** **Gate**: not yet designed — would need its
  own flag distinguishing "camera live" from "re-mirror on crossing," since a project could want the
  former without the latter. **Off-path identity**: not yet measured — this phase is costed only at
  the depth §5/Q3 gives it (cheap on MMC3, real-but-bounded on MMC1), not built. **On-path
  allowance**: not measured. **Wiring**: not designed. Named explicitly as open, not silently
  assumed to inherit phase 2's own contract.
- A `Pan` verb and item 15's own streaming consumer remain separate future design rounds — item 15's
  own scope question is answered explicitly (§9, Q7), not merely deferred by omission.
- **The docs pass**: every future addition still needs an itemized trim named in that phase's own
  brief, per CLAUDE.md's own size-budget discipline.

## 9. Open questions for Chris

- **(b) over (a): a preference on the shape of the interruption, not a measured quality advantage
  on heavy content — stated honestly, round 4.** **SUPERSEDED, this bullet's own earlier text said
  each (b) blank "grows to 2" under heavy content and the advantage merely "narrows"; both are
  wrong — see below and §3's own master table.** On plain content, (b) shows two separate 1-frame
  blanks against (a)'s one 2-frame blank (2 total either way — a difference of *shape*, not total
  duration: two short interruptions bracketing visible motion, closer to today's instant cut, vs.
  one longer blank before any motion is seen). **On the identical heavy workload (eight active
  switch-bound tile entries on both screens, a real injected hold-terminal Flash), with today's cut
  measured on the same workload as the baseline: cut 5, (a) 8 (+3 over cut), (b) 5+4=9 (+4 over
  cut)** — (b) is not merely narrower an advantage here, it is **strictly worse than (a)** by one
  total blank frame, and both candidates cost more than the cut already does (the cut's own single
  heavy draw is not free either). The transition still completes correctly and the NMI still meets
  its deadline under this content on every candidate (Mesen-proven, round 4's own real harness, not
  a jsnes approximation). **Recommendation: (b), on the shape argument, not because it wins on raw
  heavy-content blank-frame count — it does not.** Chris may prefer (a) instead if the one-frame
  heavy-content difference matters more than two-short-blanks-vs-one-long-blank does; the cut
  baseline is kept in this sentence specifically so Chris can see what the cut already costs before
  judging what either candidate adds on top of it.
- **Slide length: fixed 16-frame (~267ms) constant.** Chosen purely for its arithmetic property —
  16 is the largest common divisor of 256 (a screen's pixel width) and 240 (a screen's pixel
  height) that also keeps both per-frame steps whole numbers with no remainder to track. An
  author-visible speed control is real, wanted follow-on work, not designed here (a validated set
  of legal values — 1, 2, 4, 8, 16 — not an open integer range, per the same divisibility
  constraint). **Recommendation: ship the fixed constant first.**
- **Pinned vs. walking sprite: pinned at the landing position, for free.** `build_oam`/
  `draw_entities` already run unconditionally every slide frame from `main_loop_draw`, so the
  player and every entity draw at their already-updated landing position for the whole slide with
  zero new code. Making the player visibly walk across the seam would cost real new code (an
  interpolated on-screen position distinct from `player_x`/`player_y`, which stay at their landing
  values throughout) — this is **not** the ~1,500-1,600-cycle continuous-sync case the emulator's
  own NMI-cost comment rejects for a hypothetical always-on camera (that figure is for every frame
  of gameplay, indefinitely; a slide is 16 frames, once, from the main loop where cycles are
  cheap), but it is still unwritten, unmeasured code. **Recommendation: ship pinned-at-landing for
  v1; walking-across is a real candidate follow-on, not a default.**
- **The pinned-sprite picture, stated plainly, with a real recommendation for the incoming-actors
  question**: crossing right, the player is drawn at the **left edge of the display** the instant
  the slide starts (landing `player_x=0`), while the outgoing terrain visibly scrolls left
  underneath/past them. Any entity already spawned on the incoming screen is drawn **fixed in its
  own screen position, overlaid on the outgoing terrain**, for the whole slide — it does not enter
  from off-screen or track the terrain moving in around it, since entities are OAM-drawn at
  screen-relative coordinates with no camera-relative offset applied. **Recommendation: accept for
  v1.** Hiding incoming entities until the slide completes would need a new per-entity visibility
  state gated on the slide's own countdown (real, uncosted byte/behaviour cost, and a second thing
  for every entity-drawing call site to check) to fix a cosmetic overlay that is only visible for
  16 frames (~267ms) of a one-time transition — not a large enough problem, on the evidence this
  document has, to justify designing that mechanism before v1 ships; revisit if it reads as a
  visible defect once seen in motion, which this design-only, un-rendered document cannot itself
  judge.
- **Outgoing entities vanish: accept for v1.** Entities that were on the **outgoing** screen simply
  vanish the instant the slide starts (their own screen no longer being drawn to sprites at all) —
  free, since OAM only ever reflects the *incoming* screen's spawned entities. A moving patrol NPC
  on the screen being left would appear to vanish rather than scroll off. **Recommendation: accept
  for v1 (free); revisit only if it reads as a visible defect once seen in motion**, for the
  identical reason the incoming-actors question above is deferred to seeing it rendered.
- **Cut vs. refuse on a tileset mismatch: cut, never refuse.** This design falls back to a cut
  (today's existing behaviour) on every mismatched edge, never a refusal — an author can still
  cross, just without the visual flourish. **Recommendation: cut, not refuse** — refusing a legal,
  already-working crossing over a cosmetic-only feature would be a strictly worse outcome for the
  player than the byte floor this whole item already accepts.
- **MMC1/MMC3 runtime re-mirroring: not v1, a real phase-4 follow-on.** Costed in §5/Q3 (cheap on
  MMC3, one `$A000` write; real but bounded on MMC1, the existing 5-write serial shift, already
  proven safe at runtime by `switch_prg_bank`/`switch_chr_bank`'s own existing calls — §0's own
  restored evidence). **Recommendation: not v1**; a project stays on its one fixed mirroring choice
  and its one live axis for the whole slice.
- **A `Pan` verb: deferred, not this slice.** Costed only at the "different mechanism, not built
  here" depth (Q4). **Recommendation: later** — it is a second, real design surface (in-screen
  panning, not between-screen sliding) that would double this document's own scope for a use case
  the ROADMAP item does not name as urgent.
- **Per-map override of the toggle or slide length: not designed, and flagged for a reason.**
  Whether a future phase should allow a per-map override (e.g. a boss room that always hard-cuts
  for pacing) is not designed here. **Recommendation: no override in v1** — the single-writer
  discipline this codebase holds to (CLAUDE.md's own "The single-writer rule") would need an
  explicit answer before a per-map override could be added without becoming a second, disagreeing
  source of truth alongside the project-level `project.cartridge.camera` toggle: a per-map value
  would have to either win outright (making the project-level toggle misleading wherever it's
  overridden) or merge with it under some new precedence rule this document has not designed. Not a
  hard "never," just not before that rule exists.
- **Item 12 vs. item 15 streaming scope: v1 ships slide-only.** ROADMAP's own item-12 text assigns
  "streaming nametable content in ahead of the camera" to item 12 itself; this document recommends
  v1 ship slide-only (candidate (b)), with (c-lite)'s own producer shape recorded here as
  queue-protocol experience and a row-expansion routine that can inform item 15's own later
  streaming phase — explicitly not a validated mechanism (findings 2/3, round 2/3), narrower than
  "foundation" implied in earlier language. **Recommendation: slide-only v1; (c-lite) is item 15's
  own documented starting point, not this item's own deliverable.** The reasoning: (c-lite) costs
  +515 bytes against (b)'s +375/381 and takes 49 frames instead of ~18-25 (this round's own
  Mesen-measured completion frames, §3) for a single, one-time screen-to-screen transition — a
  trade that might make sense for a *continuous* world (item 15's own actual use case, where there
  is no "blank interval" framing at all, only ongoing motion) and a worse one for what this item is
  actually asked to ship.
- **The content-dependent blank length: see the "(b) over (a)" bullet above (§9's own opening
  bullet, round 4).** Round 4 consolidated what was previously two separately-maintained bullets on
  the identical question into one, specifically to close the drift that let the opening bullet go
  stale (the "grows to 2"/"narrows" language just fixed above) while a second, correct bullet
  existed a few items later — keeping both was how that staleness went unnoticed for a whole round.
- **Sprite interpolation, the `game_state`-gate alternative: not costed.** Neither has a byte or
  cycle figure in this document, in either round. Sprite interpolation is the same "walking sprite"
  question above, at the depth already given there; the `game_state`-gate alternative is reasoned
  against the countdown gate in §3's own frozen-world-gate subsection (restored in full this
  round), with the countdown recommended over it. Neither has been built or separately measured as
  its own candidate.

## 10. Out of scope

Restated in full, current as of round 3 (round 1's own list included two items later resolved by
round 1's own fix round — bound-tile support during a slide, and Flash/Fade mid-slide behaviour —
both now real, shipped code, Appendix C/§6, so they are removed from this list rather than
copied forward stale):

Continuous scrolling within a single screen (this ships only screen-to-screen slides, each exactly
one screen's width or height); item 15's own column/row streaming and world-model redesign (Q7); a
status bar (would contend with MMC3's scanline IRQ, already spoken for by the font split — a real,
documented future conflict this item does not resolve); platformer physics of any kind (top-down
four-direction movement is unaffected); parallax of any kind; a `Pan` cutscene verb in full (Q4,
costed only); MMC1/MMC3 runtime re-mirroring (Q3, costed only); per-map override of the toggle or
slide length (§9, not designed); an author-visible slide-speed control (Q6, a fixed constant ships
instead). **Added round 2**: a rendering-on cancellation/restoration handshake for c-lite (finding
3) — a real, named, unsolved problem, not designed here by that round's own brief instruction, and
still not designed this round.

## 12. Places a claim could not be pinned to a line and was reasoned instead

- **The absolute-reservation check (§5/Q5) — updated round 3.** Round 2's own version was a worked
  example against measured deltas, not a run of the real function. Round 3 corrected this: the
  tuples in §5/Q5 call the real, imported `kernelCodeBytes` (`main/build/generate.js`) with the
  camera terms added by hand to its return value, and compare against nesasm's own real `codeBytes`
  — a real call, not a reimplementation. What is still **not** done: wiring the camera terms *into*
  `kernelCodeBytes` itself as permanent formula code (shipping work, out of scope for a design
  document) — the tuples add them on the outside, by hand, each round they're checked.
- (a)'s own shared-base/split/Shake/bound-tile interaction terms were re-measured for the *base and
  axis* figures only this round (§3's table); Shake/bound-tile interactions were re-isolated for (b)
  specifically (the recommended candidate) but not separately re-confirmed for (a), since (a) is the
  costed-and-rejected entry and no decision rests on its own interaction terms being current to the
  byte.
- CNROM/GxROM/Color Dreams/UxROM were measured for candidate (b) only (all four boards, real
  builds, identical +375 each) — not for (a) or c-lite, since neither is the recommended candidate
  and the brief's own ask was specifically about (b)'s board coverage.
- **The `cameraAxes` helper (§5/Q3) — updated round 3.** Still specified but not implemented in the
  real tree (out of scope for a design document); its corrected behaviour (round 3 finding 3) *was*
  verified this round by running it as a standalone script against the real, unmodified
  `shared/cartridge.js` (its actual `mirroringById`/`mirroringOptions`/`MAPPERS`), not merely
  checked by hand against documented fallback behaviour — every board's own answer for a four-screen
  project, plus the invalid-string case, was printed and read, not reasoned about.
- **The Mesen state-machine/NT0-compare proof (Appendix G, finding 4) is a genuine round-3
  addition, not a reasoned gap.** All four runs (candidate × content) used the real
  `~/Downloads/Mesen2` `--testRunner` binary this round, not jsnes — closing what had been an open
  "not independently verified in a second emulator" gap for this specific proof. Mirroring/
  nametable-*page-assignment* agreement between Mesen and jsnes remains unverified (unchanged from
  both earlier rounds' own equivalent caveat) — this round's own Mesen work reads PPU memory and
  `$2001` writes, not the mirroring hardware's own page-select logic.

---

## Appendix A: `engine/boot.asm` diff (complete, regenerated round 5 from the scratch tree's own `git diff 7810848` — finding 1)

**Round 5 finding 1**: this appendix previously still showed the pre-split `CAMERA_ENABLED`-only
frozen-world gate — stale since round 4 actually built the `CAMERA_SLIDE_ENABLED` split.
Regenerated verbatim from `git diff 7810848` in the scratch tree; the frozen-world branch in
`main_loop` now correctly shows `CAMERA_SLIDE_ENABLED` (it is consumer logic, Q2 — gating it on
phase 1's own `CAMERA_ENABLED` would let a phase-1-only build's `main_loop` reference
`camera_slide_tick`, which does not exist without a consumer assembled), while `nmi_scroll`'s own
register/NMI rewrite correctly keeps `CAMERA_ENABLED` (it is phase 1's own code, Q1, and must run
whether or not a consumer is compiled in).

```diff
diff --git a/engine/boot.asm b/engine/boot.asm
index 59e9054..4a115d3 100644
--- a/engine/boot.asm
+++ b/engine/boot.asm
@@ -150,6 +150,34 @@ main_loop:
                               ; a documented, tested contract (test/unit/
                               ; flash.test.js), not an incidental placement
   .endif
+  ; design-camera.md Q2: a live slide owns the whole frame, the same way
+  ; paused/game_state already do below -- no buttons, no settle_owed (nothing
+  ; can be owed mid-slide; redraw_screen_slide's own spawn_entities already
+  ; armed whatever the incoming screen owes, and it is picked up once the
+  ; slide's last tick lets this check fall through instead). cam_slide_left
+  ; reaching zero is the same frame its own tick lands the camera on (0,0),
+  ; so the very next frame falls through here and resumes normally.
+  .if CAMERA_SLIDE_ENABLED
+  .if !CAMERA_CANDIDATE_C
+  lda <cam_slide_left
+  beq main_loop_no_slide
+  jsr camera_slide_tick
+  jmp main_loop_draw
+main_loop_no_slide:
+  .endif
+  .if CAMERA_CANDIDATE_C
+  ; Candidate (c-lite): the frame is owed for the WHOLE crossing, streaming
+  ; phases included, not merely the slide sub-phase -- cl_state is zero only
+  ; when nothing is in flight, so it (not cam_slide_left, which is only
+  ; non-zero during the slide sub-phase) is what this candidate's gate
+  ; checks.
+  lda <cl_state
+  beq main_loop_no_slide
+  jsr camera_slide_tick
+  jmp main_loop_draw
+main_loop_no_slide:
+  .endif
+  .endif
   ; What the last frame left owed, settled before the buttons are read into
   ; actions. It has to be before them and not merely before the world: an
   ; interact reaches start_dialog and an event is free to warp, so a button on
@@ -418,6 +446,7 @@ nmi_scroll:
   ; sprites needs the OAM DMA above reordered behind the shake decision, plus
   ; a per-frame cost of roughly 1,500-1,600 cycles against a ~2,273-cycle
   ; vblank budget that already spends 513 on that same DMA).
+  .if !CAMERA_ENABLED
   .if SHAKE_ENABLED
   lda <shake_left
   beq nmi_scroll_no_shake
@@ -445,6 +474,93 @@ nmi_scroll_no_shake:
   lda #$00                  ; this engine draws one screen at a time
   sta $2005
   sta $2005
+  .endif
+
+  ; design-camera.md Q1: cam_x_lo/cam_y_lo/cam_nt replace the constant (0,0)
+  ; above. Shake still perturbs the horizontal 9-bit coordinate by +-2, only
+  ; now that coordinate is cam_nt/cam_x_lo instead of always (0,0) -- the ADC
+  ; carry and SBC borrow each fire at a DIFFERENT threshold of cam_x_lo (255
+  ; vs 0..1), so the +2 and -2 phases cannot share one carry test the way a
+  ; fixed-at-zero shake could get away with skipping entirely. Reduces to
+  ; today's exact PPUCTRL/$2005 sequence when cam_x_lo=cam_nt=0 (camera at
+  ; rest) -- see camera.test.js's own shake-over-rest-camera assertion.
+  .if CAMERA_ENABLED
+  ; Fix round 2, finding 1: refresh the NMI-owned snapshot from cam_x_lo/
+  ; y_lo/nt only while cam_dirty is clear -- camera_slide_tick now raises
+  ; the lock BEFORE its first coordinate store and releases it AFTER its
+  ; last, on every wrap path (engine/camera_b.asm and friends), so "dirty"
+  ; means "mid-update, do not trust cam_* yet" for the *whole* two-store
+  ; sequence, not just the second store the round-1 bug left unprotected.
+  ; The snapshot itself (not cam_* directly) is what gets composed with
+  ; Shake and written below -- unconditionally, every vblank, dirty or not.
+  lda <cam_dirty
+  bne nmi_scroll_cam_stale
+  lda <cam_x_lo
+  sta <nmi_cam_x_lo
+  lda <cam_y_lo
+  sta <nmi_cam_y_lo
+  lda <cam_nt
+  sta <nmi_cam_nt
+nmi_scroll_cam_stale:
+  ; Fix round 2, finding 1's second half: round 1's "skip $2000/$2005 and
+  ; the PPU keeps the previous coordinate" claim was false. NMI's own drain
+  ; (above, before nmi_scroll runs at all) issues $2006 writes for every
+  ; queued packet, and PALETTE_FX_ENABLED's own PPUADDR cleanup does too --
+  ; either already moves the PPU's v/t register, so *not* rewriting $2000/
+  ; $2005 here would leave the picture scrolled to wherever the drain's own
+  ; addressing last left it, not to the camera's last position. CLAUDE.md's
+  ; own rule ("$2000 is rewritten after the drain, not before") already
+  ; established this for the plain (0,0) case; the fix is the same rule
+  ; applied here -- the block below runs and writes a complete coordinate
+  ; unconditionally, torn-avoidance handled entirely by which snapshot
+  ; (fresh or stale-but-complete) it draws from, never by skipping the
+  ; write itself.
+  .if SHAKE_ENABLED
+  ; Fix round 1, finding 3: nmi_tmp, not mainline <tmp -- see constants.asm's
+  ; own comment. Composes on nmi_cam_x_lo/nmi_cam_nt (the snapshot), not
+  ; cam_x_lo/cam_nt directly -- those may be mid-update.
+  lda <shake_left
+  beq nmi_scroll_cam_no_shake
+  dec <shake_left
+  lda <shake_left
+  and #1
+  bne nmi_scroll_cam_shake_neg
+  lda <nmi_cam_x_lo
+  clc
+  adc #2
+  sta <nmi_tmp
+  lda <nmi_cam_nt
+  bcc nmi_scroll_cam_shake_pos_nt
+  eor #1
+nmi_scroll_cam_shake_pos_nt:
+  jmp nmi_scroll_cam_shake_apply
+nmi_scroll_cam_shake_neg:
+  lda <nmi_cam_x_lo
+  sec
+  sbc #2
+  sta <nmi_tmp
+  lda <nmi_cam_nt
+  bcs nmi_scroll_cam_shake_neg_nt
+  eor #1
+nmi_scroll_cam_shake_neg_nt:
+nmi_scroll_cam_shake_apply:
+  ora #PPUCTRL_ON
+  sta $2000
+  lda <nmi_tmp
+  sta $2005
+  lda <nmi_cam_y_lo
+  sta $2005
+  jmp nmi_scroll_done
+nmi_scroll_cam_no_shake:
+  .endif
+  lda <nmi_cam_nt
+  ora #PPUCTRL_ON
+  sta $2000
+  lda <nmi_cam_x_lo
+  sta $2005
+  lda <nmi_cam_y_lo
+  sta $2005
+  .endif
 nmi_scroll_done:
 
   .if SPLIT_ENABLED
```

## Appendix B: `engine/camera.asm` (candidate (a), full, this round's fixes applied — costed-and-rejected record)

```asm
; camera.asm -- design-camera.md prototype (Q1/Q2 candidate (a)).
;
; PROTOTYPE ONLY. STATUS: costed-and-rejected -- candidate (b), engine/
; camera_b.asm, is the recommended v1 shape. Kept in full so the reviewer can
; re-assemble the rejected candidate too.
;
; Precondition enforced by the caller (cross_left/right/up/down), not here:
; the outgoing and incoming screens share a tileset, AND the crossing's axis
; is one the project's mirroring supports (CAMERA_SLIDE_H/CAMERA_SLIDE_V).

  .if CAMERA_ENABLED

CAM_SLIDE_FRAMES = 16       ; must divide both 256 and 240
CAM_STEP_X = 256/CAM_SLIDE_FRAMES
CAM_STEP_Y = 240/CAM_SLIDE_FRAMES

cam_far_nt:
  .db 2, 2, 1, 1             ; DOWN, UP, LEFT, RIGHT

; Entered instead of `jmp redraw_screen`. A = DIR_* just crossed. Y = the
; OUTGOING screen's own id (the caller's <flat_screen before it overwrote
; it).
redraw_screen_slide:
  sta <cam_slide_dir
  sty <cam_outgoing
  tax
  lda cam_far_nt,x
  sta <cam_far

  lda #$00
  sta $2000
  sta $2001
  .if SPLIT_ENABLED
  sta $E000
  .endif
  jsr vram_reset

  ldy <cam_outgoing
  jsr set_screen_ptr_for
  .if BOUND_TILE_ENABLED
  ldy <cam_outgoing
  jsr rebuild_bound_cache_for
  .endif
bound_ready_outgoing:          ; round 4 finding 1/5: bind_count observable here
                                ; (defined regardless of BOUND_TILE_ENABLED so
                                ; a plain-content harness build can still
                                ; preflight/breakpoint here -- bind_count
                                ; itself is only meaningful when the feature
                                ; is live)
  ldy <cam_outgoing
  lda screen_tileset,y
  jsr switch_chr_bank
  lda <cam_far
  jsr draw_screen_at           ; outgoing -> the far nametable

  ldy <flat_screen
  jsr set_screen_ptr_for
  .if BOUND_TILE_ENABLED
  ldy <flat_screen
  jsr rebuild_bound_cache_for
  .endif
bound_ready_incoming:           ; round 4 finding 1/5: bind_count observable here
  jsr apply_map_music
  jsr spawn_entities
  lda #0
  jsr draw_screen_at            ; incoming -> nametable 0
  jsr title_draw
  jsr build_oam
  jsr draw_entities

  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  lda <cam_far
  sta <cam_nt
  lda #CAM_SLIDE_FRAMES
  sta <cam_slide_left

  jsr wait_vblank_poll
  lda <cam_nt
  ora #PPUCTRL_ON
  sta $2000
  lda <cam_x_lo
  sta $2005
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  rts

; Ticked once per frame from main_loop while cam_slide_left is non-zero.
; cam_dirty around every two-store wrap sequence, raised before the first
; store and released after the last (round 2, finding 1 -- round 1's own
; "lo first, only the nt toggle needs the lock" was wrong).
camera_slide_tick:
  dec <cam_slide_left
  lda <cam_slide_dir
  cmp #DIR_LEFT
  bcc camera_slide_tick_y
  beq camera_slide_tick_x_dec
  lda <cam_x_lo
  clc
  adc #CAM_STEP_X
  bcc camera_slide_tick_x_store
  inc <cam_dirty
  sta <cam_x_lo
  lda <cam_nt
  eor #1
  sta <cam_nt
  dec <cam_dirty
  rts
camera_slide_tick_x_store:
  sta <cam_x_lo
  rts
camera_slide_tick_x_dec:
  lda <cam_x_lo
  sec
  sbc #CAM_STEP_X
  bcs camera_slide_tick_x_store
  inc <cam_dirty
  sta <cam_x_lo
  lda <cam_nt
  eor #1
  sta <cam_nt
  dec <cam_dirty
  rts
camera_slide_tick_y:
  lda <cam_slide_dir
  cmp #DIR_DOWN
  beq camera_slide_tick_y_inc
  lda <cam_y_lo
  sec
  sbc #CAM_STEP_Y
  bcs camera_slide_tick_y_store
  sec
  sbc #(256-240)
  inc <cam_dirty
  sta <cam_y_lo
  lda <cam_nt
  eor #2
  sta <cam_nt
  dec <cam_dirty
  rts
camera_slide_tick_y_inc:
  lda <cam_y_lo
  clc
  adc #CAM_STEP_Y
  cmp #240
  bcc camera_slide_tick_y_store
  sbc #240
  inc <cam_dirty
  sta <cam_y_lo
  lda <cam_nt
  eor #2
  sta <cam_nt
  dec <cam_dirty
  rts
camera_slide_tick_y_store:
  sta <cam_y_lo
  rts

  .endif
```

## Appendix C: `engine/screens.asm` and `engine/player.asm` diffs (complete, no ellipses; regenerated round 5, finding 1)

**Round 5 finding 1**: this appendix previously still gated the screen-helper family and every
`cross_*` stub on the pre-split `CAMERA_ENABLED` — stale since round 4 built
`CAMERA_SLIDE_ENABLED`. Regenerated verbatim from `git diff 7810848` in the scratch tree. Both
files are consumer code (Q2's own draw machinery and the crossing stubs), so every occurrence here
correctly reads `CAMERA_SLIDE_ENABLED`, not `CAMERA_ENABLED` — neither file references the register
path directly.

`engine/screens.asm`:

```diff
diff --git a/engine/screens.asm b/engine/screens.asm
index 1036dad..13d3b64 100644
--- a/engine/screens.asm
+++ b/engine/screens.asm
@@ -5,6 +5,7 @@
 ; contiguous in the nametable, so the whole 960 bytes go out in one sequential
 ; run of $2007 writes.
 
+  .if !CAMERA_SLIDE_ENABLED
 set_screen_ptr:
   ; Screen data lives in the switchable window, so select its bank before any of
   ; the pointers below are dereferenced. A no-op on an unbanked cartridge.
@@ -22,8 +23,35 @@ set_screen_ptr:
   lda screen_at_hi,y
   sta <atptr_hi
   rts
+  .endif
+
+  .if CAMERA_SLIDE_ENABLED
+; design-camera.md: redraw_screen_slide needs to point mtptr/atptr at the
+; OUTGOING screen (not <flat_screen, already overwritten with the incoming
+; one by the time it runs) as well as the incoming one, so the single
+; definition takes the screen id in Y rather than reading the global. The
+; off-path above stays byte-identical rather than growing this same jmp.
+set_screen_ptr:
+  ldy <flat_screen
+  jmp set_screen_ptr_for
+
+set_screen_ptr_for:
+  lda screen_bank,y
+  jsr switch_prg_bank
+
+  lda screen_mt_lo,y
+  sta <mtptr_lo
+  lda screen_mt_hi,y
+  sta <mtptr_hi
+  lda screen_at_lo,y
+  sta <atptr_lo
+  lda screen_at_hi,y
+  sta <atptr_hi
+  rts
+  .endif
 
 ; Must run with rendering disabled.
+  .if !CAMERA_SLIDE_ENABLED
 draw_screen:
   bit $2002
   lda #$20
@@ -101,6 +129,103 @@ draw_screen_attr:
   cpy #64
   bne draw_screen_attr
   rts
+  .endif
+
+  .if CAMERA_SLIDE_ENABLED
+; design-camera.md: redraw_screen_slide draws two screens under one forced
+; blank, one into nametable 0 and one into the far nametable a slide is about
+; to reveal -- so the nametable/attribute base addresses are a parameter (A =
+; nt index 0-3) rather than draw_screen's own hardcoded $20/$23. The off-path
+; above keeps the literal loads rather than paying this one extra `sta <tmp`
+; plus the two three-instruction address computations.
+draw_screen_at:
+  sta <tmp                  ; nt index -- survives the loops below untouched
+  asl a
+  asl a                      ; nt * 4 = nametable's own hi-byte offset from $20
+  clc
+  adc #$20
+  bit $2002
+  sta $2006
+  lda #$00
+  sta $2006
+
+  lda #0
+  sta <ds_row
+draw_screen_at_row:
+  lda <ds_row
+  asl a
+  asl a
+  asl a
+  asl a
+  sta <ds_base
+
+  ldx #0
+draw_screen_at_top:
+  txa
+  clc
+  adc <ds_base
+  tay
+  .if BOUND_TILE_ENABLED
+  jsr bound_tile_lookup
+  .else
+  lda [mtptr_lo],y
+  .endif
+  tay
+  lda mt_tl,y
+  sta $2007
+  lda mt_tr,y
+  sta $2007
+  inx
+  cpx #16
+  bne draw_screen_at_top
+
+  ldx #0
+draw_screen_at_bottom:
+  txa
+  clc
+  adc <ds_base
+  tay
+  .if BOUND_TILE_ENABLED
+  jsr bound_tile_lookup
+  .else
+  lda [mtptr_lo],y
+  .endif
+  tay
+  lda mt_bl,y
+  sta $2007
+  lda mt_br,y
+  sta $2007
+  inx
+  cpx #16
+  bne draw_screen_at_bottom
+
+  inc <ds_row
+  lda <ds_row
+  cmp #15
+  bne draw_screen_at_row
+
+  lda <tmp
+  asl a
+  asl a
+  clc
+  adc #$23
+  bit $2002
+  sta $2006
+  lda #$C0
+  sta $2006
+  ldy #0
+draw_screen_at_attr:
+  lda [atptr_lo],y
+  sta $2007
+  iny
+  cpy #64
+  bne draw_screen_at_attr
+  rts
+
+draw_screen:
+  lda #0
+  jmp draw_screen_at
+  .endif
 
 ; Swap to the screen already stored in flat_screen.
 redraw_screen:
@@ -195,6 +320,7 @@ btl_hit:
 ; see design-tile.md §3 for why re-walking <=8 ROM entries per flip is cheap
 ; enough not to need an incremental diff). Takes no parameters; the
 ; switch-matching pass is tile_switch_changed's own, separate walk.
+  .if !CAMERA_SLIDE_ENABLED
 rebuild_bound_cache:
   ldx #0                    ; active-cache write cursor
   ldy <flat_screen
@@ -230,3 +356,56 @@ rbc_done:
   stx bind_count
   rts
   .endif
+
+  .if CAMERA_SLIDE_ENABLED
+  ; closes at the end of rebuild_bound_cache_for below, then the outer
+  ; .if BOUND_TILE_ENABLED (opened above rebuild_bound_cache's own comment)
+  ; closes right after it -- two .endif in a row, not one.
+; design-camera.md finding 4 (round-1 fix): redraw_screen_slide rebuilds this
+; cache twice -- once for the outgoing screen just before drawing it into the
+; far nametable, once for the incoming screen just before drawing it into
+; nametable 0 -- so the single active cache below is always correct for
+; whichever screen is about to be drawn, and is left holding the INCOMING
+; screen's own bindings once the slide starts, matching what probe_type must
+; see for the rest of gameplay. One cache, reused sequentially: both rebuilds
+; happen back to back under the same forced blank with nothing else able to
+; read or write it in between, so two persistent caches were never needed.
+rebuild_bound_cache:
+  ldy <flat_screen
+  jmp rebuild_bound_cache_for
+
+rebuild_bound_cache_for:
+  ldx #0                    ; active-cache write cursor
+  lda screen_bound_lo,y
+  sta <bdptr_lo
+  lda screen_bound_hi,y
+  sta <bdptr_hi
+  ldy #0
+  lda [bdptr_lo],y          ; this screen's own authored-binding count (0-8)
+  beq rbc_done
+  sta bnd_scan_left
+  iny
+rbc_loop:
+  lda [bdptr_lo],y          ; this entry's switch
+  iny
+  jsr switch_test           ; preserves X and Y; Z set when the switch is off
+  beq rbc_skip
+  lda [bdptr_lo],y          ; cell index
+  sta bind_idx,x
+  iny
+  lda [bdptr_lo],y          ; substitute metatile
+  sta bind_mt,x
+  iny
+  inx
+  jmp rbc_next
+rbc_skip:
+  iny
+  iny
+rbc_next:
+  dec bnd_scan_left
+  bne rbc_loop
+rbc_done:
+  stx bind_count
+  rts
+  .endif
+  .endif
```

`engine/player.asm` (all four `cross_*` stubs, complete):

```diff
diff --git a/engine/player.asm b/engine/player.asm
index ab6c13a..8fe1ab9 100644
--- a/engine/player.asm
+++ b/engine/player.asm
@@ -265,21 +265,91 @@ probe_solid_done:
 
 ; ------------------------------------------------------- screen transitions
 
+; design-camera.md finding 5 (round-1 fix): CAMERA_SLIDE_H/CAMERA_SLIDE_V
+; (main/build/generate.js) are compile-time 0/1 constants, one project-wide
+; pair decided from the fixed mirroring choice (Q3) -- so each stub below
+; assembles in exactly one of three shapes, never a runtime branch on axis:
+; CAMERA_ENABLED with its own axis flag true (tileset-checked slide attempt,
+; fall back to a cut), CAMERA_ENABLED with its own axis flag false (nothing
+; extra at all -- the axis cannot show different content, so a slide would
+; either refuse or show a mirrored repeat, neither acceptable, see Q3), or
+; CAMERA_ENABLED off entirely (today's code, untouched). On the default
+; project (mirroring: vertical -- shared/project.js's own default), that
+; means CAMERA_SLIDE_H=1/CAMERA_SLIDE_V=0: cross_left/cross_right below
+; assemble their slide-attempt shape, cross_up/cross_down assemble their
+; plain-cut shape -- horizontal crossings slide, vertical crossings cut.
+
 cross_left:
   ldy <flat_screen
   lda screen_left,y
   cmp #NO_SCREEN
+  .if CAMERA_SLIDE_ENABLED
+  .if CAMERA_SLIDE_H
+  bne cross_have_left          ; a plain beq's target is now >128 bytes away
+  jmp cross_none
+cross_have_left:
+  pha
+  tax
+  lda screen_tileset,y
+  cmp screen_tileset,x
+  bne cross_left_cut
+  pla
+  sta <flat_screen
+  lda #MAX_X
+  sta <player_x
+  lda #DIR_LEFT
+  jmp redraw_screen_slide
+cross_left_cut:
+  pla
+  .endif
+  .if !CAMERA_SLIDE_H
   beq cross_none
+  .endif
+  .endif
+  .if !CAMERA_SLIDE_ENABLED
+  beq cross_none
+  .endif
   sta <flat_screen
   lda #MAX_X
   sta <player_x
   jmp redraw_screen
 
 cross_right:
-  ldy <flat_screen
+  ldy <flat_screen             ; kept as the OUTGOING id through this whole
+                                ; block -- nothing below touches Y until
+                                ; redraw_screen_slide itself is entered
   lda screen_right,y
   cmp #NO_SCREEN
+  .if CAMERA_SLIDE_ENABLED
+  .if CAMERA_SLIDE_H
+  bne cross_have_right          ; a plain beq's target is now >128 bytes away
+  jmp cross_none
+cross_have_right:
+  ; design-camera.md Q2: a slide needs both screens sharing a tileset -- the
+  ; far nametable draw below has no CHR bank of its own to fall back to mid-
+  ; slide. A mismatch falls back to today's hard cut rather than showing the
+  ; wrong tiles or refusing the crossing outright.
+  pha                          ; incoming id
+  tax
+  lda screen_tileset,y
+  cmp screen_tileset,x
+  bne cross_right_cut
+  pla                          ; A = incoming
+  sta <flat_screen
+  lda #0
+  sta <player_x
+  lda #DIR_RIGHT
+  jmp redraw_screen_slide      ; Y is still the outgoing id set up above
+cross_right_cut:
+  pla                          ; A = incoming, restored for the fallback
+  .endif
+  .if !CAMERA_SLIDE_H
+  beq cross_none
+  .endif
+  .endif
+  .if !CAMERA_SLIDE_ENABLED
   beq cross_none
+  .endif
   sta <flat_screen
   lda #0
   sta <player_x
@@ -289,7 +359,32 @@ cross_up:
   ldy <flat_screen
   lda screen_up,y
   cmp #NO_SCREEN
+  .if CAMERA_SLIDE_ENABLED
+  .if CAMERA_SLIDE_V
+  bne cross_have_up          ; a plain beq's target is now >128 bytes away
+  jmp cross_none
+cross_have_up:
+  pha
+  tax
+  lda screen_tileset,y
+  cmp screen_tileset,x
+  bne cross_up_cut
+  pla
+  sta <flat_screen
+  lda #MAX_Y
+  sta <player_y
+  lda #DIR_UP
+  jmp redraw_screen_slide
+cross_up_cut:
+  pla
+  .endif
+  .if !CAMERA_SLIDE_V
   beq cross_none
+  .endif
+  .endif
+  .if !CAMERA_SLIDE_ENABLED
+  beq cross_none
+  .endif
   sta <flat_screen
   lda #MAX_Y
   sta <player_y
@@ -299,7 +394,32 @@ cross_down:
   ldy <flat_screen
   lda screen_down,y
   cmp #NO_SCREEN
+  .if CAMERA_SLIDE_ENABLED
+  .if CAMERA_SLIDE_V
+  bne cross_have_down          ; a plain beq's target is now >128 bytes away
+  jmp cross_none
+cross_have_down:
+  pha
+  tax
+  lda screen_tileset,y
+  cmp screen_tileset,x
+  bne cross_down_cut
+  pla
+  sta <flat_screen
+  lda #0
+  sta <player_y
+  lda #DIR_DOWN
+  jmp redraw_screen_slide
+cross_down_cut:
+  pla
+  .endif
+  .if !CAMERA_SLIDE_V
   beq cross_none
+  .endif
+  .endif
+  .if !CAMERA_SLIDE_ENABLED
+  beq cross_none
+  .endif
   sta <flat_screen
   lda #0
   sta <player_y
```

## Appendix D: `engine/camera_b.asm` (candidate (b), full, this round's fixes applied — recommended v1 shape)

```asm
; camera_b.asm -- design-camera.md, candidate (b) prototype -- RECOMMENDED v1
; shape as of fix round 2 (see §1/§3/§9). Fix round 2, finding 1's own
; publication repair applied throughout.

  .if CAMERA_ENABLED
  .if CAMERA_CANDIDATE_B

CAM_SLIDE_FRAMES = 16
CAM_STEP_X = 256/CAM_SLIDE_FRAMES
CAM_STEP_Y = 240/CAM_SLIDE_FRAMES

cam_far_nt:
  .db 2, 2, 1, 1             ; DOWN, UP, LEFT, RIGHT

; Entered instead of `jmp redraw_screen`. A = DIR_* just crossed; Y is NOT
; used (unlike (a), (b) never draws the outgoing screen -- it is already
; sitting, untouched, in nametable 0). flat_screen/player_x/y already point
; at the incoming screen, set by the caller.
redraw_screen_slide:
  sta <cam_slide_dir
  tax
  lda cam_far_nt,x
  sta <cam_far

  lda #$00
  sta $2000
  sta $2001
  .if SPLIT_ENABLED
  sta $E000
  .endif
  jsr vram_reset

  ; Only ONE draw -- the incoming screen, into the FAR nametable. The
  ; outgoing screen already occupies nametable 0 and is left completely
  ; alone: this is the one draw today's ordinary cut already pays for.
  ldy <flat_screen
  jsr set_screen_ptr_for
  .if BOUND_TILE_ENABLED
  ldy <flat_screen
  jsr rebuild_bound_cache_for
  .endif
bound_ready_arm:                ; round 4 finding 1/5: bind_count observable here
  jsr apply_map_music
  jsr spawn_entities
  lda <cam_far
  jsr draw_screen_at            ; incoming -> the far nametable
  jsr title_draw
  jsr build_oam
  jsr draw_entities

  ; Camera starts at (0,0) -- already exactly what nametable 0 (the
  ; untouched outgoing screen) shows, so no pre-positioning is needed.
  ; Arm the slide toward the far nametable and flag the completion redraw.
  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  sta <cam_nt
  lda #CAM_SLIDE_FRAMES
  sta <cam_slide_left
  lda #1
  sta <cam_slide_b_pending

  jsr wait_vblank_poll
  lda <cam_nt
  ora #PPUCTRL_ON
  sta $2000
  lda <cam_x_lo
  sta $2005
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  rts

; Ticked once per frame from main_loop while cam_slide_left is non-zero.
; cam_dirty raised before the first store of a wrap, released after the
; last (fix round 2, finding 1, on all four wrap branches below).
camera_slide_tick:
  dec <cam_slide_left
  lda <cam_slide_dir
  cmp #DIR_LEFT
  bcc camera_slide_tick_y
  beq camera_slide_tick_x_dec
  lda <cam_x_lo
  clc
  adc #CAM_STEP_X
  bcc camera_slide_tick_x_store
  inc <cam_dirty
  sta <cam_x_lo
  lda <cam_nt
  eor #1
  sta <cam_nt
  dec <cam_dirty
  jmp camera_slide_tick_check
camera_slide_tick_x_store:
  sta <cam_x_lo
  jmp camera_slide_tick_check
camera_slide_tick_x_dec:
  lda <cam_x_lo
  sec
  sbc #CAM_STEP_X
  bcs camera_slide_tick_x_store
  inc <cam_dirty
  sta <cam_x_lo
  lda <cam_nt
  eor #1
  sta <cam_nt
  dec <cam_dirty
  jmp camera_slide_tick_check
camera_slide_tick_y:
  lda <cam_slide_dir
  cmp #DIR_DOWN
  beq camera_slide_tick_y_inc
  lda <cam_y_lo
  sec
  sbc #CAM_STEP_Y
  bcs camera_slide_tick_y_store
  sec
  sbc #(256-240)
  inc <cam_dirty
  sta <cam_y_lo
  lda <cam_nt
  eor #2
  sta <cam_nt
  dec <cam_dirty
  jmp camera_slide_tick_check
camera_slide_tick_y_inc:
  lda <cam_y_lo
  clc
  adc #CAM_STEP_Y
  cmp #240
  bcc camera_slide_tick_y_store
  sbc #240
  inc <cam_dirty
  sta <cam_y_lo
  lda <cam_nt
  eor #2
  sta <cam_nt
  dec <cam_dirty
  jmp camera_slide_tick_check
camera_slide_tick_y_store:
  sta <cam_y_lo

; Shared tail: has the slide just landed, and if so, is a completion redraw
; owed? Both cheap, paid every tick (15 of 16 fail the first check).
camera_slide_tick_check:
  lda <cam_slide_left
  bne camera_slide_tick_rts
  lda <cam_slide_b_pending
  beq camera_slide_tick_rts
  lda #0
  sta <cam_slide_b_pending
  jsr camera_slide_complete_b
camera_slide_tick_rts:
  rts

; The completion redraw candidate (b) owes once a slide lands on the far
; nametable: a second forced blank moving the SAME already-drawn content to
; nametable 0, without re-running apply_map_music or spawn_entities.
; mtptr/atptr/the PRG bank are exactly what the initial draw already left
; them at; set_screen_ptr_for is called again anyway, cheaply, rather than
; trusting that.
camera_slide_complete_b:
  lda #$00
  sta $2000
  sta $2001
  .if SPLIT_ENABLED
  sta $E000
  .endif
  jsr vram_reset
  ldy <flat_screen
  jsr set_screen_ptr_for
  .if BOUND_TILE_ENABLED
  ldy <flat_screen
  jsr rebuild_bound_cache_for   ; still the same screen's own bindings
  .endif
bound_ready_complete:           ; round 4 finding 1/5: bind_count observable here
  lda #0
  jsr draw_screen_at            ; incoming, again -> nametable 0 this time
  jsr wait_vblank_poll

  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  sta <cam_nt                   ; A is still 0 here (STA never touches A)
  ora #PPUCTRL_ON
  sta $2000
  lda <cam_x_lo
  sta $2005
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  rts

  .endif
  .endif
```

## Appendix E: `engine/camera_c.asm` (candidate (c-lite), full, this round's fixes applied — experimental row-copy sketch, not a foundation)

```asm
; camera_c.asm -- design-camera.md, candidate (c-lite) prototype.
;
; PROTOTYPE ONLY. STATUS as of fix round 2: an EXPLICITLY EXPERIMENTAL
; row-copy sketch, offered as an INPUT to item 15's own design round --
; NOT a validated foundation (fix round 2, finding 3). It never cancels
; Flash/Shake/switch-bound-flip backlog (it cannot, without forced blank,
; which this candidate deliberately never enters) and that gap is not
; closed this round, by explicit instruction. The numbers below are real,
; reproduced-then-verified measurements, useful as a lower bound on what
; streaming costs -- not proof the mechanism works against live content.
;
; Four phases, driven by cl_state, one main_loop tick per frame:
;   1 STREAM_FAR, 2 SLIDE, 3 STREAM_NT0, 4 FLIP -- see each routine's own
;   comment below. Verified this round (fix round 2, finding 2) to take
;   exactly 49 ticks to complete (16+16+16+1 FLIP), not 48.

  .if CAMERA_ENABLED
  .if CAMERA_CANDIDATE_C

CAM_SLIDE_FRAMES = 16
CAM_STEP_X = 256/CAM_SLIDE_FRAMES
CAM_STEP_Y = 240/CAM_SLIDE_FRAMES
CL_ROWS_PER_FRAME = 2       ; measured at 2; 3/4 costed by arithmetic, same
                             ; code either way (code size is independent of
                             ; this constant)

cam_far_nt:
  .db 2, 2, 1, 1             ; DOWN, UP, LEFT, RIGHT

CL_STREAM_FAR = 1
CL_SLIDE      = 2
CL_STREAM_NT0 = 3

; Entered instead of `jmp redraw_screen`. A = DIR_* just crossed. Y is not
; used. flat_screen/player_x/y already point at the incoming screen.
redraw_screen_slide:
  sta <cam_slide_dir
  tax
  lda cam_far_nt,x
  sta <cam_far

  ; No forced blank: rendering and NMI stay on throughout -- and, per
  ; finding 3, nothing here cancels any live Flash/Shake/flip backlog.
  ldy <flat_screen
  jsr set_screen_ptr_for
  .if BOUND_TILE_ENABLED
  ldy <flat_screen
  jsr rebuild_bound_cache_for
  .endif
  jsr apply_map_music
  jsr spawn_entities

  lda <cam_far
  sta <cl_target_nt
  asl a
  asl a
  clc
  adc #$20
  sta <cl_nt_hi
  lda #0
  sta <cl_row
  lda #CL_STREAM_FAR
  sta <cl_state
  rts

; Ticked once per frame from main_loop while cl_state is non-zero.
camera_slide_tick:
  lda <cl_state
  cmp #CL_SLIDE
  beq camera_c_slide_step
  cmp #4
  beq camera_c_flip
  jsr cl_stream_tick
  rts

; STREAM_NT0 just finished: nametable 0 already holds identical content to
; the far nametable the camera is still resting on -- a single, atomic
; (one-instruction), pixel-identical jump. No dirty-flag protection needed:
; cam_x_lo/y_lo never change here (already 0 throughout) and cam_nt's own
; store is the only write, inherently uninterruptible mid-instruction.
camera_c_flip:
  lda #0
  sta <cam_nt
  sta <cl_state
  rts

; The 16-tick per-axis step, identical to candidate (a)'s own -- starting it
; from cam_nt=0 (not cam_far) at the STREAM_FAR->SLIDE transition is the
; only change c-lite's geometry needs.
camera_c_slide_step:
  dec <cam_slide_left
  lda <cam_slide_dir
  cmp #DIR_LEFT
  bcc camera_c_slide_y
  beq camera_c_slide_x_dec
  lda <cam_x_lo
  clc
  adc #CAM_STEP_X
  bcc camera_c_slide_x_store
  inc <cam_dirty
  sta <cam_x_lo
  lda <cam_nt
  eor #1
  sta <cam_nt
  dec <cam_dirty
  jmp camera_c_slide_check
camera_c_slide_x_store:
  sta <cam_x_lo
  jmp camera_c_slide_check
camera_c_slide_x_dec:
  lda <cam_x_lo
  sec
  sbc #CAM_STEP_X
  bcs camera_c_slide_x_store
  inc <cam_dirty
  sta <cam_x_lo
  lda <cam_nt
  eor #1
  sta <cam_nt
  dec <cam_dirty
  jmp camera_c_slide_check
camera_c_slide_y:
  lda <cam_slide_dir
  cmp #DIR_DOWN
  beq camera_c_slide_y_inc
  lda <cam_y_lo
  sec
  sbc #CAM_STEP_Y
  bcs camera_c_slide_y_store
  sec
  sbc #(256-240)
  inc <cam_dirty
  sta <cam_y_lo
  lda <cam_nt
  eor #2
  sta <cam_nt
  dec <cam_dirty
  jmp camera_c_slide_check
camera_c_slide_y_inc:
  lda <cam_y_lo
  clc
  adc #CAM_STEP_Y
  cmp #240
  bcc camera_c_slide_y_store
  sbc #240
  inc <cam_dirty
  sta <cam_y_lo
  lda <cam_nt
  eor #2
  sta <cam_nt
  dec <cam_dirty
  jmp camera_c_slide_check
camera_c_slide_y_store:
  sta <cam_y_lo
camera_c_slide_check:
  lda <cam_slide_left
  bne camera_c_slide_rts
  lda #0
  sta <cl_target_nt
  lda #$20
  sta <cl_nt_hi
  lda #0
  sta <cl_row
  lda #CL_STREAM_NT0
  sta <cl_state
camera_c_slide_rts:
  rts

; Emits CL_ROWS_PER_FRAME logical rows this frame, advancing cl_row.
;
; Fix round 2, finding 2: the row budget cannot live in X across the jsr
; below. cl_emit_row's own tile loops all use X as their OWN 0-15/0-31
; counter, leaving it at 16 or 32 on return; vram_push/vram_end preserve
; that returned X, not this routine's original budget -- DEX/BNE against it
; did not do what it looked like it did. Reproduced: one tick emitted all 32
; rows, 63,601 cycles, vram_len overflowing past 96. cl_budget (dedicated
; RAM, never touched by cl_emit_row) is the fix -- verified afterward by the
; identical direct-CPU-stepping technique: one tick now advances cl_row by
; exactly 2, vram_len settles at 70.
cl_stream_tick:
  lda #CL_ROWS_PER_FRAME
  sta <cl_budget
cl_stream_tick_loop:
  jsr cl_emit_row
  inc <cl_row
  lda <cl_row
  cmp #32
  beq cl_stream_tick_phase_done
  dec <cl_budget
  bne cl_stream_tick_loop
  rts
cl_stream_tick_phase_done:
  lda <cl_state
  cmp #CL_STREAM_FAR
  bne cl_stream_tick_done
  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  sta <cam_nt
  lda #CAM_SLIDE_FRAMES
  sta <cam_slide_left
  lda #CL_SLIDE
  sta <cl_state
  rts
cl_stream_tick_done:
  lda #4
  sta <cl_state
  rts

; Row 0-31 in <cl_row>. Opens and fills one 32-byte vram_buf packet for
; that row of <cl_target_nt>.
;
; Clobbers: A, X, Y, <ds_row>, <ds_base>, <cl_addr_hi>, <cl_addr_lo>, <tmp2>.
; Leaves X at 16 (a tile row) or 32 (an attribute row) on return -- a
; caller must not treat X as still holding whatever it passed in
; (fix round 2, finding 2).
cl_emit_row:
  lda <cl_row
  cmp #30
  bcs cl_emit_row_attr

  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  sta <cl_addr_lo
  lda <cl_row
  lsr a
  lsr a
  lsr a
  clc
  adc <cl_nt_hi
  sta <cl_addr_hi

  lda <cl_row
  lsr a
  sta <ds_row
  lda <ds_row
  asl a
  asl a
  asl a
  asl a
  sta <ds_base

  lda <cl_addr_hi
  ldy <cl_addr_lo
  jsr vram_open

  lda <cl_row
  and #1
  bne cl_emit_row_bottom

  ldx #0
cl_emit_row_top:
  txa
  clc
  adc <ds_base
  tay
  .if BOUND_TILE_ENABLED
  jsr bound_tile_lookup
  .else
  lda [mtptr_lo],y
  .endif
  tay
  lda mt_tl,y
  jsr vram_push
  lda mt_tr,y
  jsr vram_push
  inx
  cpx #16
  bne cl_emit_row_top
  jmp vram_end

cl_emit_row_bottom:
  ldx #0
cl_emit_row_bottom_loop:
  txa
  clc
  adc <ds_base
  tay
  .if BOUND_TILE_ENABLED
  jsr bound_tile_lookup
  .else
  lda [mtptr_lo],y
  .endif
  tay
  lda mt_bl,y
  jsr vram_push
  lda mt_br,y
  jsr vram_push
  inx
  cpx #16
  bne cl_emit_row_bottom_loop
  jmp vram_end

cl_emit_row_attr:
  lda <cl_row
  sec
  sbc #30
  sta <tmp2
  asl a
  asl a
  asl a
  asl a
  asl a
  clc
  adc #$C0
  sta <cl_addr_lo
  lda <cl_nt_hi
  clc
  adc #3
  sta <cl_addr_hi

  lda <cl_addr_hi
  ldy <cl_addr_lo
  jsr vram_open

  lda <tmp2
  asl a
  asl a
  asl a
  asl a
  asl a
  tay
  ldx #0
cl_emit_row_attr_loop:
  lda [atptr_lo],y
  jsr vram_push
  iny
  inx
  cpx #32
  bne cl_emit_row_attr_loop
  jmp vram_end

  .endif
  .endif
```

## Appendix F: `engine/constants.asm` diff (complete, regenerated round 6 verbatim — nit 2)

**Round 6 nit 2**: this block had been comment-trimmed against the scratch tree's own real diff
(non-comment lines always matched, but the shortened comments left the hunk's own line count stale,
so `git apply --numstat`/`--check` reported "corrupt patch at line 55"). Regenerated verbatim from
`git diff 7810848 -- engine/constants.asm` in the scratch tree — no hand-editing, identical
technique to Appendices A/C/F's own main.asm/generate.js half (round 5, finding 1). Verified with
`git apply --check` against a clean copy of `7810848`: applies cleanly (see the round-6 report for
the full six-diff verification table, all clean).

```diff
diff --git a/engine/constants.asm b/engine/constants.asm
index c756761..6173f68 100644
--- a/engine/constants.asm
+++ b/engine/constants.asm
@@ -500,6 +500,85 @@ BT_MISS_FRAMES = 30
 ; not merely one authoring an attackAnim, since the walk itself has no gate.
 bt_walk_step = bt_miss_left+1
 WALK_TICKS = 8
+
+; ---------------------------------------------------------------- camera RAM
+; design-camera.md prototype. cam_x_lo/cam_y_lo/cam_nt are the camera
+; register nmi_scroll applies every vblank in place of the constant (0,0);
+; cam_slide_left/cam_slide_dir/cam_outgoing/cam_far are redraw_screen_slide's
+; and camera_slide_tick's own scratch. Reserved unconditionally, the same
+; reasoning flash_driver and pc_name_ram already hold to -- costs a board
+; that never assembles .if CAMERA_ENABLED code nothing, chained off
+; bt_walk_step so a switched-off camera cannot move any other symbol.
+cam_x_lo      = bt_walk_step+1
+cam_y_lo      = cam_x_lo+1
+cam_nt        = cam_y_lo+1
+cam_slide_left = cam_nt+1
+cam_slide_dir = cam_slide_left+1
+cam_outgoing  = cam_slide_dir+1
+cam_far       = cam_outgoing+1
+; Fix round 2, finding 1: cam_dirty is a publication lock, raised BEFORE the
+; first store of a wrap update (the low-byte coordinate) and released AFTER
+; the last (the cam_nt toggle) -- covering both stores, not just the second,
+; which is round 1's own bug (a torn NT0/X=240 combination was reproduced by
+; the reviewer stepping the vendored CPU one instruction after the low-byte
+; store alone). nmi_scroll's camera path no longer *skips* the scroll write
+; when dirty is set -- round 1's own "skip and the PPU keeps its last value"
+; claim was also wrong: NMI drains vram_buf (and, under PALETTE_FX_ENABLED,
+; cleans up a palette-space PPUADDR) *before* nmi_scroll runs, and either of
+; those already moves the PPU's own v/t register -- CLAUDE.md's own rule
+; ("$2000 is rewritten after the drain, not before") means the scroll must
+; be rewritten every single vblank, unconditionally, never skipped. Instead,
+; nmi_scroll maintains its own last-complete snapshot (nmi_cam_x_lo/y_lo/nt,
+; below): refreshed from cam_x_lo/y_lo/nt only when cam_dirty is clear, left
+; alone (the last known-good coordinate) when it is set, and ALWAYS the
+; thing actually written to $2000/$2005 -- so every vblank writes a real,
+; complete coordinate, torn or not, refreshed or stale.
+cam_dirty     = cam_far+1
+; Fix round 2, finding 1: NMI's own copy of the camera register -- the value
+; nmi_scroll actually composes with Shake and writes to $2000/$2005 every
+; vblank, refreshed from cam_x_lo/y_lo/cam_nt only while cam_dirty is clear.
+; Never written by mainline code.
+nmi_cam_x_lo  = cam_dirty+1
+nmi_cam_y_lo  = nmi_cam_x_lo+1
+nmi_cam_nt    = nmi_cam_y_lo+1
+; Fix round 1, finding 3: nmi_tmp is NMI-private scratch for the Shake+camera
+; composition math (engine/boot.asm's nmi_scroll), never touched by mainline
+; code -- nmi only saves/restores A/X/Y (engine/boot.asm's own nmi:
+; pha/txa/pha/tya/pha), so reusing mainline's <tmp there corrupted whatever
+; mainline routine (e.g. probe_type, engine/player.asm) was mid-use of it on
+; a long frame. camera_slide_tick's own vertical-wrap arithmetic needed no
+; equivalent byte once restructured to store its final corrected value
+; directly (engine/camera.asm) rather than staging it -- see that file's own
+; comment.
+nmi_tmp       = nmi_cam_nt+1
+; Candidate (b) prototype only (engine/camera_b.asm): non-zero means the
+; active slide still owes its completion redraw (moving the incoming
+; screen's already-drawn content from the far nametable back to nametable 0)
+; once cam_slide_left reaches zero. Unused, and therefore always zero, under
+; candidate (a) -- costs those builds one dead byte, not a behaviour change.
+cam_slide_b_pending = nmi_tmp+1
+; Candidate (c-lite) prototype only (engine/camera_c.asm): the queue-fed
+; streaming producer's own state. cl_state: 0 idle, 1 streaming to the far
+; nametable, 2 sliding (delegates to camera_slide_tick's own step math), 3
+; streaming to nametable 0 (off-screen -- the camera is still showing the
+; far nametable), 4 armed for the final instant flip. cl_row: 0-31, the
+; logical row this phase has reached (0-29 = nametable tile rows, 30-31 =
+; the two 32-byte attribute halves). cl_target_nt/cl_nt_hi: which nametable
+; the active streaming phase is writing into, and that nametable's own
+; address high byte ($20+nt*4), recomputed once per phase rather than every
+; row.
+cl_state      = cam_slide_b_pending+1
+cl_row        = cl_state+1
+cl_target_nt  = cl_row+1
+cl_nt_hi      = cl_target_nt+1
+cl_addr_hi    = cl_nt_hi+1
+cl_addr_lo    = cl_addr_hi+1
+; Round 2, finding 2: cl_stream_tick's own row budget, dedicated RAM rather
+; than X -- cl_emit_row's own tile loops use X as their own counter and
+; leave it at 16 or 32 on return, so a caller's DEX/BNE against X after the
+; call was silently counting the wrong thing. See cl_stream_tick's own
+; comment for the reproduced overflow this caused.
+cl_budget     = cl_addr_lo+1
 ; draw_battle_attr's own ground-row fill (engine/battle.asm) -- rows 1-4 of
 ; the attribute table get this value before any live monster's own mon_attr
 ; is written over the top. This is what a dead monster's own cell must be
```

`engine/main.asm` and `main/build/generate.js` (regenerated round 5, finding 1 — the previous text's claim that this round's fixes "touch no include structure and no new generated flag" was false since round 4, which is exactly when `CAMERA_SLIDE_ENABLED` was introduced; corrected here):

```diff
diff --git a/engine/main.asm b/engine/main.asm
index 04b0361..b8d5766 100644
--- a/engine/main.asm
+++ b/engine/main.asm
@@ -52,6 +52,19 @@
   .include "banks.asm"
   .include "split.asm"
   .include "screens.asm"
+  .if CAMERA_SLIDE_ENABLED
+  .if !CAMERA_CANDIDATE_B
+  .if !CAMERA_CANDIDATE_C
+  .include "camera.asm"
+  .endif
+  .endif
+  .if CAMERA_CANDIDATE_B
+  .include "camera_b.asm"
+  .endif
+  .if CAMERA_CANDIDATE_C
+  .include "camera_c.asm"
+  .endif
+  .endif
   .include "player.asm"
   .include "entities.asm"
   .include "oam.asm"
diff --git a/main/build/generate.js b/main/build/generate.js
index 48e46dd..4c4dd0c 100644
--- a/main/build/generate.js
+++ b/main/build/generate.js
@@ -3156,6 +3156,45 @@ export async function generateAssets({ dir, project, log = () => {} }) {
     // No companion *_ENABLED the way Turn has FACE_ENABLED: nothing else calls
     // into Shake's own code.
     `SHAKE_ENABLED = ${usesShake ? 1 : 0}`,
+    // design-camera.md prototype -- env-var gated in this scratch copy only,
+    // never wired to a real project field. Every checked-in fixture builds
+    // with this env var unset, so this line always emits 0 in the real tree.
+    `CAMERA_ENABLED = ${process.env.FORGE_CAMERA_PROTOTYPE ? 1 : 0}`,
+    // design-camera.md round 4 finding 4: phase 1 (the register + NMI
+    // rewrite, boot.asm alone) has its own gate, independent of whether a
+    // slide consumer exists. CAMERA_ENABLED alone now means "the register
+    // and NMI rewrite are live" (constants.asm's own RAM chain is always
+    // reserved regardless, per the existing "reserved unconditionally"
+    // note). CAMERA_SLIDE_ENABLED gates the consumer: screens.asm's
+    // draw_screen_at/set_screen_ptr_for/rebuild_bound_cache_for family,
+    // player.asm's cross_* stub modifications, and main.asm's own
+    // camera.asm/camera_b.asm/camera_c.asm include. Normally identical to
+    // CAMERA_ENABLED; FORGE_CAMERA_PHASE1_ONLY forces it off while leaving
+    // CAMERA_ENABLED on, isolating phase 1's own real byte cost with no
+    // consumer code assembled at all -- not "neither axis" (which still
+    // assembles the whole consumer, just with both stubs hard-cutting).
+    `CAMERA_SLIDE_ENABLED = ${(process.env.FORGE_CAMERA_PROTOTYPE && !process.env.FORGE_CAMERA_PHASE1_ONLY) ? 1 : 0}`,
+    // design-camera.md finding 5 (round-1 fix): which axis genuinely shows
+    // different content across an edge, decided once at build time from the
+    // project's own fixed mirroring choice (Q3) -- vertical mirroring makes
+    // horizontal neighbours differ, horizontal mirroring makes vertical
+    // neighbours differ, four-screen (UNROM 512 only) makes both differ.
+    // cross_left/right fold in CAMERA_SLIDE_H, cross_up/down fold in
+    // CAMERA_SLIDE_V; the crossing's own DIR_* decides which one applies, so
+    // no per-crossing branch is needed at runtime -- the whole gate is one
+    // compile-time constant per stub, folding to either "always try the
+    // tileset check" or "always hard cut."
+    `CAMERA_SLIDE_H = ${(project.cartridge.mirroring === 'vertical' || project.cartridge.mirroring === 'fourscreen') ? 1 : 0}`,
+    `CAMERA_SLIDE_V = ${(project.cartridge.mirroring === 'horizontal' || project.cartridge.mirroring === 'fourscreen') ? 1 : 0}`,
+    // Fix round 1, finding 2/9: candidate (b) prototype selector, scratch-only,
+    // never wired to a real project field. When set, main.asm includes
+    // camera_b.asm instead of camera.asm -- a standalone alternate
+    // implementation of redraw_screen_slide/camera_slide_tick, built to
+    // measure (b) on its own rather than as "(a) minus some bytes."
+    `CAMERA_CANDIDATE_B = ${process.env.FORGE_CAMERA_CANDIDATE_B ? 1 : 0}`,
+    // Fix round 1, finding 9: candidate (c-lite) prototype selector, the
+    // same scratch-only shape as CAMERA_CANDIDATE_B above.
+    `CAMERA_CANDIDATE_C = ${process.env.FORGE_CAMERA_CANDIDATE_C ? 1 : 0}`,
     // OP_VISIBLE, the same shape again -- see projectUsesVisible
     // (shared/project.js). No companion *_ENABLED: nothing else calls
     // script_op_visible or reads ENT_HIDDEN.
```

## Appendix G: the Mesen state-machine proof, in full (fix round 5, finding 4 — every preflight/count now independently checked)

**Round 5 finding 4** tightened three assertions that round 4's own harness had weakened by
accident: the bound-ready preflight previously supplied `read(BOUND_READY_1)` as its *own* expected
value (tautologically true regardless of what was actually there) — fixed with independently known
opcodes read directly off each label's own next real instruction in `camera.asm`/`camera_b.asm`
(Appendix B/D). The bound-observation check previously required only a shared total of at least two
callbacks, which could not detect two hits at the same site and zero at the other — fixed with
separate per-site counters, asserted exactly 1/1. The NMI floor of 16 permitted up to three missing
samples out of the 19 these four fixtures actually produce, and `nmiDeadlineChecks`/`nmiSamples`
incrementing together in the same callback meant their equality could never detect lost delivery —
fixed with an exact `EXPECTED_NMI_SAMPLES = 19` assertion for these four deterministic fixtures
(the reviewer's own re-verified figure under this harness's exact stopping convention: armed from
the trigger frame through 3 frames after completion, with forced-blank frames disabling NMI along
the way — not "one NMI per armed frame," which is why `armedFrames` differs from `nmiSamples`); the
`>= 16` floor is kept as the documented secondary check for any future non-deterministic content
run, where an exact count cannot be pinned down in advance.

**Round 4's own debugging lesson, kept**: an earlier version of this harness registered
`emu.addMemoryCallback(onVramEnd, ...)` with no `onVramEnd` function defined at all (finding 2's
own rewrite deleted the function but not the registration) — calling `nil()` inside Mesen's own
callback dispatch silently broke breakpoint delivery for the rest of that run, including completely
unrelated addresses (`main_loop_ready` stopped firing entirely, despite the underlying game logic
completing correctly — `tickHits` still reached 16, `cam_slide_left` still reached 0, only the
harness's own observation of it broke). Found by bisecting registrations one at a time. The general
lesson: a single `nil()` anywhere in a Lua callback set can silently disable delivery to *every*
other registered breakpoint for the rest of that run, with no error reaching `print()`-based
logging at all — worth re-checking first whenever a harness edit makes an assertion mysteriously
stop firing.

**Generated by `build_camera_check.mjs`** (Appendix H) from `camera_check.lua.template`,
substituting every `__TOKEN__` from that exact build's own `syms.json` (code labels), `ram.json`
(the camera zero-page chain, re-resolved per build since these are chain equates, not literals —
§0's own restored warning about trusting an address across builds), and `reference.json` (the
independent, JS-built NT0 tile+attribute reference, read straight from project data, never from any
candidate's own draw code). One template, run four ways: candidate × {a, b} × content × {plain,
heavy}.

```lua
-- camera_check.lua.template -- round 4's rewritten Appendix G harness.
-- Round 4 finding 1: the deadline check now covers EVERY observed NMI while
-- armed (not just the first resumed one), and the sample count is ASSERTED
-- against the real per-frame count, not merely printed. Real exec
-- callbacks are registered on cross_right/the slide arm/camera_slide_tick,
-- and their hit counts are asserted (1/1/16). For (b), completion ENTRY
-- (camera_slide_complete_b's own first instruction) must be observed before
-- its RETURN is accepted, in that order. For (a), the arm/tick sequence
-- must be observed before a zero countdown is accepted as completion. The
-- idle assertion checks cam_x_lo/y_lo/nt, cam_slide_left, cam_dirty, and
-- (b) cam_slide_b_pending -- not only the countdown. Every anchor this
-- script uses is preflighted, main_loop_ready included. bind_count == 8 is
-- observed at EACH draw site (both of them), not only after completion.
--
-- Round 4 finding 2: vram_push is now its own breakpoint, incrementing a
-- host Lua integer per REAL append -- the old technique read the packet's
-- own one-byte count out of vram_buf, which has already wrapped by the
-- time it is read for any workload heavier than 255 bytes (round 3's own
-- "real, unwrapped" comment was wrong: a byte read is still a byte read,
-- wrap and all, for any packet whose real count exceeds 255). The running
-- total is checked BEFORE each append would exceed the 256-byte queue, not
-- after. The independent "exactly one 32-byte Flash body" expectation is
-- kept as a second, separate assertion.
--
-- Generated by build_camera_check.mjs, which substitutes every double
-- -underscore placeholder below from that exact build's own
-- syms.json/ram.json/preflight.json/reference.json. Do not hand-edit the
-- generated .lua -- edit this template.
--
--   Mesen --testRunner <outDir>/camera_check.lua <outDir>/game.nes

local CANDIDATE     = "__CANDIDATE__"      -- "a" or "b"
local HEAVY         = __HEAVY__            -- true/false (Lua literal)

-- Code anchors (syms.json)
local CROSS_RIGHT           = __CROSS_RIGHT__
local REDRAW_SCREEN_SLIDE   = __REDRAW_SCREEN_SLIDE__
local CAMERA_SLIDE_TICK     = __CAMERA_SLIDE_TICK__
local NMI_RTI                = __NMI_RTI__
local MAIN_LOOP_READY        = __MAIN_LOOP_READY__
local VRAM_OPEN              = __VRAM_OPEN__
local VRAM_END               = __VRAM_END__
local VRAM_PUSH              = __VRAM_PUSH__
local COMPLETE_ENTRY         = __COMPLETE_ENTRY__     -- (b): camera_slide_complete_b; (a): -1 (unused)
local COMPLETE_RETURN        = __COMPLETE_RETURN__   -- (b): camera_slide_tick_rts; (a): -1 (unused)
local BOUND_READY_1          = __BOUND_READY_1__      -- (a): bound_ready_outgoing; (b): bound_ready_arm
local BOUND_READY_2          = __BOUND_READY_2__      -- (a): bound_ready_incoming; (b): bound_ready_complete
-- Round 5 finding 4: independently expected opcodes for each continuation
-- (not a re-read of the same address, which round 4's own preflight did --
-- tautologically true no matter what was actually there). Read directly off
-- each label's own real next instruction in camera.asm/camera_b.asm:
-- bound_ready_outgoing -> `ldy <cam_outgoing` ($A4); bound_ready_incoming and
-- bound_ready_arm -> `jsr apply_map_music` ($20); bound_ready_complete ->
-- `lda #0` ($A9).
local BOUND_READY_1_OPCODE   = __BOUND_READY_1_OPCODE__
local BOUND_READY_2_OPCODE   = __BOUND_READY_2_OPCODE__

-- RAM (ram.json, resolved fresh per build -- these are chain equates, not
-- literals, and shift with whatever else is compiled in)
local CAM_X_LO        = __CAM_X_LO__
local CAM_Y_LO        = __CAM_Y_LO__
local CAM_NT          = __CAM_NT__
local CAM_DIRTY       = __CAM_DIRTY__
local CAM_SLIDE_LEFT  = __CAM_SLIDE_LEFT__
local CAM_SLIDE_B_PENDING = __CAM_SLIDE_B_PENDING__   -- (a): -1 (unused)
local FLAT_SCREEN     = __FLAT_SCREEN__
local GAME_STATE      = __GAME_STATE__
local PLAYER_X        = __PLAYER_X__
local PLAYER_Y        = __PLAYER_Y__
local BIND_COUNT      = __BIND_COUNT__
local FLASH_LEFT      = __FLASH_LEFT__
local SWITCHES        = __SWITCHES__

local FLASH_PENDING = 0xFF
local BIND_EXPECTED = HEAVY and 8 or 0
local EXPECTED_TICKS = 16
local EXPECTED_NMI_SAMPLES = __EXPECTED_NMI_SAMPLES__  -- 19 for these four deterministic fixtures

-- Reference NT0 content (reference.json), independent of the candidate's own
-- draw code -- 960 tile bytes ($2000-$23BF minus the attribute table's own
-- 64, laid out row-major tl/tr then bl/br per metatile row) then 64
-- attribute bytes ($23C0-$23FF).
local REF_TILES = { __REF_TILES__ }
local REF_ATTRS = { __REF_ATTRS__ }

local EXIT_TIMEOUT        = 99
local EXIT_STALE_ANCHOR    = 6
local EXIT_NO_BOOT         = 2
local EXIT_NEVER_ARMED     = 4
local EXIT_DEADLINE_MISS   = 5
local EXIT_WORKLOAD_WRONG  = 7
local EXIT_BIND_MISMATCH   = 8
local EXIT_NT_MISMATCH     = 9
local EXIT_NEVER_COMPLETED = 10
local EXIT_CALLBACK_COUNT  = 12
local EXIT_ORDER_VIOLATION = 13
local EXIT_IDLE_STATE      = 14
local EXIT_NMI_COUNT       = 15
local EXIT_CAPACITY        = 16

local frame = 0
local phase = 1
local held = {}
local mark = 0

local armed = false          -- the crossing has been triggered this run
local armedFrames = 0        -- frames counted while armed, for the NMI-count assertion
local flashInjected = false

-- Finding 2: real host-integer append counting.
local packetCount = 0        -- vram_open hits
local pushCount = 0          -- vram_push hits (real appended bytes, host integer)
local capacityFailed = false

-- Finding 1: real callback-hit counters, asserted, not merely printed.
local crossRightHits = 0
local armHits = 0
local tickHits = 0
local completionEntryObserved = false
local boundReadyChecks = {}  -- {site=1|2, bindCount=n}

local completed = false
local completedFrame = nil
local maskWrites = {}        -- {frame=, scanline=, cycle=, value=} in order
local nmiSamples = 0         -- every NMI observed while armed
local nmiDeadlineChecks = 0  -- every one of those actually deadline-checked
local firstResumedNmiChecked = false
local reported = false

local VBLANK_FIRST_SCANLINE = 241
local VBLANK_LAST_SCANLINE  = 260
local DOTS_PER_SCANLINE     = 341
local PPU_DOTS_PER_CPU_CYCLE = 3
local RTI_REMAINING_CYCLES  = 6
local RTI_REMAINING_DOTS    = RTI_REMAINING_CYCLES * PPU_DOTS_PER_CPU_CYCLE

local function log(message)
  print(string.format("[%5d] %s", frame, message))
end

local function fail(code, message)
  log("FAIL: " .. message)
  emu.stop(code)
end

local function pass(message)
  log("ok   " .. message)
end

local function read(address)
  return emu.read(address, emu.memType.nesMemory)
end

local function write(address, value)
  emu.write(address, value, emu.memType.nesMemory)
end

local function readPpu(address)
  return emu.read(address, emu.memType.nesPpuMemory)
end

local function onInput()
  emu.setInput(held, 0)
end

-- Anchor preflight: every symbol this harness trusts, checked against the
-- ROM's own bytes (not against the harness's own assumption of where they
-- are) before frame 1 runs. main_loop_ready is included this round (round
-- 3's own harness used it as a breakpoint but never preflighted it).
local function preflight()
  local checks = {
    { "cross_right (LDY zp => $A4)", CROSS_RIGHT, 0xA4 },
    { "redraw_screen_slide (STA zp => $85)", REDRAW_SCREEN_SLIDE, 0x85 },
    { "camera_slide_tick (DEC zp => $C6)", CAMERA_SLIDE_TICK, 0xC6 },
    { "nmi_rti (RTI => $40)", NMI_RTI, 0x40 },
    { "vram_open (STX zp => $86)", VRAM_OPEN, 0x86 },
    { "vram_end (STX zp => $86)", VRAM_END, 0x86 },
    { "vram_push (STX zp => $86)", VRAM_PUSH, 0x86 },
    { "main_loop_ready (LDA zp => $A5)", MAIN_LOOP_READY, 0xA5 },
  }
  if CANDIDATE == "b" then
    table.insert(checks, { "camera_slide_complete_b (LDA # => $A9)", COMPLETE_ENTRY, 0xA9 })
    table.insert(checks, { "camera_slide_tick_rts / completion return (RTS => $60)", COMPLETE_RETURN, 0x60 })
  end
  if HEAVY then
    table.insert(checks, { "bound_ready_1 (first draw site)", BOUND_READY_1, BOUND_READY_1_OPCODE })
    table.insert(checks, { "bound_ready_2 (second draw site)", BOUND_READY_2, BOUND_READY_2_OPCODE })
    if BOUND_READY_1 == BOUND_READY_2 then
      fail(EXIT_STALE_ANCHOR, "bound_ready_1 and bound_ready_2 resolved to the identical address -- the two draw sites are not actually distinguishable this build")
      return false
    end
  end
  for _, c in ipairs(checks) do
    local name, addr, expected = c[1], c[2], c[3]
    local byte = read(addr)
    if byte ~= expected then
      fail(EXIT_STALE_ANCHOR, string.format("anchor %s at $%04x reads $%02x, not $%02x -- stale build", name, addr, byte, expected))
      return false
    end
  end
  pass("every symbol anchor this script uses preflighted against the ROM's own bytes, including main_loop_ready and both bound-ready sites")
  return true
end

local function onCrossRight()
  if not armed or completed then return end
  crossRightHits = crossRightHits + 1
end

local function onRedrawScreenSlide()
  if armed and not completed then
    armHits = armHits + 1
  end
  -- Finding 5 (round 3, kept): inject flash_left = FLASH_PENDING right at
  -- the slide's own entry -- the one point in the frame guaranteed to run
  -- after that frame's own ordinary flash_tick and before vram_reset's own
  -- check, so the injection is not silently consumed before it can matter.
  if HEAVY and armed and not flashInjected then
    flashInjected = true
    write(FLASH_LEFT, FLASH_PENDING)
    log("injected flash_left = FLASH_PENDING at redraw_screen_slide's own entry")
  end
end

local function onCameraSlideTick()
  if armed and not completed then
    tickHits = tickHits + 1
  end
end

-- Round 5 finding 4: a per-site hit counter, not a shared array whose length
-- alone was checked (>= 2 total would silently pass two hits at the SAME
-- site and zero at the other). boundReadySiteHits[1]/[2] are asserted
-- individually below.
local boundReadySiteHits = { [1] = 0, [2] = 0 }
local function onBoundReady(site)
  return function()
    if not HEAVY or not armed then return end
    boundReadySiteHits[site] = boundReadySiteHits[site] + 1
    table.insert(boundReadyChecks, { site = site, bindCount = read(BIND_COUNT) })
    if read(BIND_COUNT) ~= BIND_EXPECTED then
      fail(EXIT_BIND_MISMATCH, string.format("bind_count is %d at draw site %d, expected %d -- not deferred to after completion", read(BIND_COUNT), site, BIND_EXPECTED))
      return
    end
    pass(string.format("bind_count == %d confirmed at draw site %d", BIND_EXPECTED, site))
  end
end

local function onVramOpen()
  if not armed or completed then return end
  packetCount = packetCount + 1
end

-- Finding 2's own fix: count real appends via a breakpoint on vram_push
-- itself (a host Lua integer, immune to the 8-bit RAM byte's own wrap),
-- and fail BEFORE an append would exceed the 256-byte queue -- not after,
-- and not by reading the packet's own wrapped count byte back out of RAM.
local function onVramPush()
  if not armed or completed then return end
  local wouldBe = 3 * packetCount + pushCount + 1 -- headers-so-far + appends-so-far + this one
  if wouldBe + 1 > 256 then -- + the eventual terminator
    capacityFailed = true
    fail(EXIT_CAPACITY, string.format("vram_push would bring the real, host-counted total to %d bytes (+ terminator), exceeding the 256-byte queue", wouldBe))
    return
  end
  pushCount = pushCount + 1
end

-- Fires on camera_slide_complete_b's own first instruction -- observed
-- BEFORE its return is accepted (finding 1's own ordering requirement).
local function onCompleteEntry()
  if not armed or completed then return end
  if armHits < 1 or tickHits < 1 then
    fail(EXIT_ORDER_VIOLATION, "camera_slide_complete_b entered before the arm/tick sequence was observed")
    return
  end
  completionEntryObserved = true
end

-- Fires once, the instant camera_slide_tick has genuinely finished for the
-- LAST time this slide -- for (b), the instruction right after
-- `jsr camera_slide_complete_b` returns.
local function onCompleteReturn()
  if not armed or completed then return end
  -- camera_slide_tick_rts is the SHARED exit label for every tick, not just
  -- the completing one -- cam_slide_left == 0 is what distinguishes the
  -- genuinely-completing tick from the 15 ordinary ones sharing this exact
  -- machine address (round 3's own finding).
  if read(CAM_SLIDE_LEFT) ~= 0 then return end
  if not completionEntryObserved then
    fail(EXIT_ORDER_VIOLATION, "camera_slide_tick_rts reached with cam_slide_left == 0, but camera_slide_complete_b's own entry was never observed first -- entry-then-return ordering violated")
    return
  end
  completed = true
  completedFrame = frame
  pass("candidate (b): completion ENTRY observed, then RETURN observed, in that order -- camera_slide_complete_b has genuinely run to completion")
end

local function checkIdleState()
  local bad = {}
  if read(CAM_X_LO) ~= 0 then table.insert(bad, string.format("cam_x_lo=%d", read(CAM_X_LO))) end
  if read(CAM_Y_LO) ~= 0 then table.insert(bad, string.format("cam_y_lo=%d", read(CAM_Y_LO))) end
  if read(CAM_NT) ~= 0 then table.insert(bad, string.format("cam_nt=%d", read(CAM_NT))) end
  if read(CAM_SLIDE_LEFT) ~= 0 then table.insert(bad, string.format("cam_slide_left=%d", read(CAM_SLIDE_LEFT))) end
  if read(CAM_DIRTY) ~= 0 then table.insert(bad, string.format("cam_dirty=%d", read(CAM_DIRTY))) end
  if CANDIDATE == "b" and read(CAM_SLIDE_B_PENDING) ~= 0 then
    table.insert(bad, string.format("cam_slide_b_pending=%d", read(CAM_SLIDE_B_PENDING)))
  end
  if #bad > 0 then
    fail(EXIT_IDLE_STATE, "idle camera state violated: " .. table.concat(bad, ", "))
    return false
  end
  pass("idle camera state confirmed: cam_x_lo/y_lo/nt/cam_slide_left/cam_dirty all zero" .. (CANDIDATE == "b" and "/cam_slide_b_pending zero" or ""))
  return true
end

local function onMainLoopReady()
  if not armed then return end

  -- Candidate (a) has no separate completion call: the arm/tick sequence
  -- must be observed first (finding 1's own requirement), and completion is
  -- read off cam_slide_left reaching zero.
  if CANDIDATE == "a" and not completed then
    if read(CAM_SLIDE_LEFT) == 0 then
      if armHits < 1 or tickHits < 1 then
        fail(EXIT_ORDER_VIOLATION, "cam_slide_left read 0 before the arm/tick sequence was observed -- not accepted as completion")
        return
      end
      completed = true
      completedFrame = frame
      pass("candidate (a): arm/tick sequence observed, then cam_slide_left read 0 -- the whole tick has already returned")
    end
  end

  if not completed then return end

  if completedFrame == frame then
    -- Finding 2: the true vram_buf workload, in host integers, not a
    -- re-read of any RAM byte.
    local expectedPackets = HEAVY and 1 or 0
    local expectedPushes = HEAVY and 32 or 0
    if packetCount ~= expectedPackets or pushCount ~= expectedPushes then
      fail(EXIT_WORKLOAD_WRONG, string.format(
        "crossing's own vram_buf workload: %d packet(s), %d real appended bytes (host-counted), expected %d packet(s)/%d bytes (Flash's own cancellation edge, independently predicted)",
        packetCount, pushCount, expectedPackets, expectedPushes))
      return
    end
    pass(string.format("crossing's own vram_buf workload confirmed: %d packet(s), %d real appended bytes (host-counted, never re-read from a wrapping RAM byte)", packetCount, pushCount))

    -- Finding 1: assert the real callback-hit counts, not merely log them.
    if crossRightHits ~= 1 then
      fail(EXIT_CALLBACK_COUNT, string.format("cross_right was hit %d time(s), expected exactly 1", crossRightHits))
      return
    end
    if armHits ~= 1 then
      fail(EXIT_CALLBACK_COUNT, string.format("redraw_screen_slide (the arm) was hit %d time(s), expected exactly 1", armHits))
      return
    end
    if tickHits ~= EXPECTED_TICKS then
      fail(EXIT_CALLBACK_COUNT, string.format("camera_slide_tick was hit %d time(s), expected exactly %d", tickHits, EXPECTED_TICKS))
      return
    end
    pass(string.format("real callback hit counts confirmed: cross_right x1, arm x1, camera_slide_tick x%d", EXPECTED_TICKS))

    -- Round 5 finding 4: per-site hit counts, not a shared total -- two
    -- hits at the SAME site and zero at the other used to pass the old
    -- `>= 2` check silently.
    if HEAVY and (boundReadySiteHits[1] ~= 1 or boundReadySiteHits[2] ~= 1) then
      fail(EXIT_BIND_MISMATCH, string.format("draw-site hit counts were %d/%d, expected exactly 1/1 (outgoing/arm, incoming/complete)", boundReadySiteHits[1], boundReadySiteHits[2]))
      return
    end
    if HEAVY then
      pass(string.format("draw-site hit counts confirmed exactly 1/1 (site 1=%d, site 2=%d)", boundReadySiteHits[1], boundReadySiteHits[2]))
    end

    if not checkIdleState() then return end

    -- Rendering enabled: the completion routine's own last write to $2001
    -- is tracked via the write-breakpoint below (maskWrites); the most
    -- recent entry must show both background and sprites on.
    local lastMask = maskWrites[#maskWrites]
    if not lastMask or (lastMask.value & 0x18) ~= 0x18 then
      fail(EXIT_WORKLOAD_WRONG, string.format("rendering not enabled after completion (last $2001 write = %s)", lastMask and string.format("$%02x", lastMask.value) or "none"))
      return
    end
    pass(string.format("rendering enabled confirmed: last $2001 write = $%02x (background+sprites on)", lastMask.value))

    -- Independent NT0/attribute compare, read via Mesen's own PPU memory.
    local mismatches = 0
    for i = 0, 959 do
      local got = readPpu(0x2000 + i)
      local want = REF_TILES[i + 1]
      if got ~= want then
        mismatches = mismatches + 1
        if mismatches <= 3 then
          log(string.format("NT0 tile byte %d: got $%02x want $%02x", i, got, want))
        end
      end
    end
    for i = 0, 63 do
      local got = readPpu(0x23C0 + i)
      local want = REF_ATTRS[i + 1]
      if got ~= want then
        mismatches = mismatches + 1
        if mismatches <= 3 then
          log(string.format("attr byte %d: got $%02x want $%02x", i, got, want))
        end
      end
    end
    if mismatches > 0 then
      fail(EXIT_NT_MISMATCH, string.format("%d of 1024 NT0 tile+attribute bytes mismatch the independent reference", mismatches))
      return
    end
    pass("all 960 NT0 tile bytes + 64 attribute bytes match the independent JS-built reference, read via Mesen's own PPU memory")
  end
end

-- Fires on EVERY nmi_rti while armed (finding 1's own fix -- round 3's own
-- harness only deadline-checked the first NMI resumed after completion,
-- leaving 18 of 19 logged samples entirely unchecked).
local function onNmiRti()
  if not armed then return end
  nmiSamples = nmiSamples + 1
  nmiDeadlineChecks = nmiDeadlineChecks + 1
  local state = emu.getState()
  local scanline = state["ppu.scanline"]
  local cycle = state["ppu.cycle"]
  local finishDot = cycle + RTI_REMAINING_DOTS
  local finishScanline = scanline
  while finishDot >= DOTS_PER_SCANLINE do
    finishDot = finishDot - DOTS_PER_SCANLINE
    finishScanline = finishScanline + 1
  end
  if scanline < VBLANK_FIRST_SCANLINE or scanline > VBLANK_LAST_SCANLINE or finishScanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("NMI #%d (frame %d): rti reached scanline %d cycle %d (settles scanline %d) -- outside vblank (%d-%d)", nmiSamples, frame, scanline, cycle, finishScanline, VBLANK_FIRST_SCANLINE, VBLANK_LAST_SCANLINE))
    return
  end
  if completed and not firstResumedNmiChecked then
    firstResumedNmiChecked = true
    log(string.format("first resumed NMI after completion met its deadline: scanline %d cycle %d (settles scanline %d)", scanline, cycle, finishScanline))
  end
end

local function onMaskWrite(address, value)
  table.insert(maskWrites, { frame = frame, value = value })
  local state = emu.getState()
  maskWrites[#maskWrites].scanline = state["ppu.scanline"]
  maskWrites[#maskWrites].cycle = state["ppu.cycle"]
  local kind = (value & 0x18) == 0 and "MASK-OFF" or ((value & 0x18) == 0x18 and "MASK-ON " or "MASK-PARTIAL")
  log(string.format("%s $2001 <- $%02x (scanline %d, cycle %d)", kind, value, maskWrites[#maskWrites].scanline, maskWrites[#maskWrites].cycle))
end

local function onFrame()
  frame = frame + 1

  if frame == 1 then
    if not preflight() then return end
  end

  if frame > 3000 then
    fail(EXIT_TIMEOUT, "timed out in phase " .. tostring(phase))
    return
  end

  if armed and not completed then
    armedFrames = armedFrames + 1
  end

  if phase == 1 then
    if frame < 20 then return end
    held = {}
    phase = 2
    mark = frame
    return
  end

  -- 2: trigger the crossing by placing the player at the map's own right
  -- edge and holding Right.
  if phase == 2 then
    write(SWITCHES, 0xFF)
    write(FLAT_SCREEN, 0)
    write(PLAYER_X, 240)
    write(PLAYER_Y, 96)
    armed = true
    held = { right = true }
    pass("crossing triggered: flat_screen=0, player placed at the right edge, holding Right")
    phase = 3
    mark = frame
    return
  end

  if phase == 3 then
    if frame - mark < 6 then return end
    held = {}
    phase = 4
    mark = frame
    return
  end

  if phase == 4 then
    if completed then
      if not reported and frame - completedFrame >= 3 and firstResumedNmiChecked then
        reported = true
        -- Round 5 finding 4: assert the EXACT expected NMI sample count for
        -- these four deterministic fixtures (EXPECTED_NMI_SAMPLES = 19,
        -- reviewer-reproduced under this exact stopping convention: armed
        -- from the trigger frame through 3 frames after completedFrame,
        -- forced-blank frames disabling NMI along the way -- NOT "one NMI
        -- per armed frame", which is why armedFrames=24-25 on heavy content
        -- while nmiSamples stays 19). EXPECTED_TICKS (>=16, one per tick,
        -- since a tick only ever runs with rendering on) is kept as the
        -- documented secondary floor for any future NON-deterministic
        -- content run, where an exact count cannot be pinned down in
        -- advance.
        if EXPECTED_NMI_SAMPLES > 0 then
          if nmiSamples ~= EXPECTED_NMI_SAMPLES then
            fail(EXIT_NMI_COUNT, string.format("nmiSamples=%d, expected exactly %d under this fixture's own deterministic stopping convention", nmiSamples, EXPECTED_NMI_SAMPLES))
            return
          end
        elseif nmiSamples < EXPECTED_TICKS then
          fail(EXIT_NMI_COUNT, string.format("nmiSamples=%d is below the real minimum of %d (one per tick -- ticks only run with rendering on)", nmiSamples, EXPECTED_TICKS))
          return
        end
        if nmiDeadlineChecks ~= nmiSamples then
          fail(EXIT_NMI_COUNT, string.format("only %d of %d observed NMIs were deadline-checked", nmiDeadlineChecks, nmiSamples))
          return
        end
        pass(string.format("crossing completed at frame %d; %d packet(s)/%d real appended bytes; %d NMI samples observed and ALL deadline-checked (armedFrames=%d, expected=%d); %d mask writes; draw-site hit counts %d/%d", completedFrame, packetCount, pushCount, nmiSamples, armedFrames, EXPECTED_NMI_SAMPLES, #maskWrites, boundReadySiteHits[1], boundReadySiteHits[2]))
        emu.stop(0)
      end
      return
    end
    if frame - mark > 60 then
      fail(EXIT_NEVER_COMPLETED, "the crossing never completed (cam_slide_left/camera_slide_tick_rts never signalled done)")
      return
    end
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addEventCallback(onInput, emu.eventType.inputPolled)
emu.addMemoryCallback(onCrossRight, emu.callbackType.exec, CROSS_RIGHT)
emu.addMemoryCallback(onRedrawScreenSlide, emu.callbackType.exec, REDRAW_SCREEN_SLIDE)
emu.addMemoryCallback(onCameraSlideTick, emu.callbackType.exec, CAMERA_SLIDE_TICK)
emu.addMemoryCallback(onVramOpen, emu.callbackType.exec, VRAM_OPEN)
emu.addMemoryCallback(onVramPush, emu.callbackType.exec, VRAM_PUSH)
emu.addMemoryCallback(onMainLoopReady, emu.callbackType.exec, MAIN_LOOP_READY)
emu.addMemoryCallback(onNmiRti, emu.callbackType.exec, NMI_RTI)
if HEAVY then
  emu.addMemoryCallback(onBoundReady(1), emu.callbackType.exec, BOUND_READY_1)
  emu.addMemoryCallback(onBoundReady(2), emu.callbackType.exec, BOUND_READY_2)
end
if CANDIDATE == "b" then
  emu.addMemoryCallback(onCompleteEntry, emu.callbackType.exec, COMPLETE_ENTRY)
  emu.addMemoryCallback(onCompleteReturn, emu.callbackType.exec, COMPLETE_RETURN)
end
emu.addMemoryCallback(onMaskWrite, emu.callbackType.write, 0x2001)
```

**Real results, all four runs, real Mesen (`~/Downloads/Mesen2/bin/linux-x64/Release/Mesen
--testRunner`), round 5** — `exit 0` on every run, every tightened assertion included:

```
=== candidate a_plain ===
[    0] MASK-OFF $2001 <- $00 (scanline 0, cycle 96)
[    1] ok   every symbol anchor this script uses preflighted against the ROM's own bytes, including main_loop_ready and both bound-ready sites
[    2] MASK-ON  $2001 <- $1e (scanline 190, cycle 294)
[   21] ok   crossing triggered: flat_screen=0, player placed at the right edge, holding Right
[   21] MASK-OFF $2001 <- $00 (scanline 258, cycle 35)
[   23] MASK-ON  $2001 <- $1e (scanline 241, cycle 125)
[   39] ok   candidate (a): arm/tick sequence observed, then cam_slide_left read 0 -- the whole tick has already returned
[   39] ok   crossing's own vram_buf workload confirmed: 0 packet(s), 0 real appended bytes (host-counted, never re-read from a wrapping RAM byte)
[   39] ok   real callback hit counts confirmed: cross_right x1, arm x1, camera_slide_tick x16
[   39] ok   idle camera state confirmed: cam_x_lo/y_lo/nt/cam_slide_left/cam_dirty all zero
[   39] ok   rendering enabled confirmed: last $2001 write = $1e (background+sprites on)
[   39] ok   all 960 NT0 tile bytes + 64 attribute bytes match the independent JS-built reference, read via Mesen's own PPU memory
[   40] first resumed NMI after completion met its deadline: scanline 246 cycle 177 (settles scanline 246)
[   42] ok   crossing completed at frame 39; 0 packet(s)/0 real appended bytes; 19 NMI samples observed and ALL deadline-checked (armedFrames=18, expected=19); 4 mask writes; draw-site hit counts 0/0

=== candidate a_heavy ===
[    0] MASK-OFF $2001 <- $00 (scanline 0, cycle 96)
[    1] ok   every symbol anchor this script uses preflighted against the ROM's own bytes, including main_loop_ready and both bound-ready sites
[    3] MASK-ON  $2001 <- $1e (scanline 50, cycle 248)
[   21] ok   crossing triggered: flat_screen=0, player placed at the right edge, holding Right
[   21] injected flash_left = FLASH_PENDING at redraw_screen_slide's own entry
[   21] MASK-OFF $2001 <- $00 (scanline 258, cycle 140)
[   21] ok   bind_count == 8 confirmed at draw site 1
[   25] ok   bind_count == 8 confirmed at draw site 2
[   29] MASK-ON  $2001 <- $1e (scanline 241, cycle 113)
[   45] ok   candidate (a): arm/tick sequence observed, then cam_slide_left read 0 -- the whole tick has already returned
[   45] ok   crossing's own vram_buf workload confirmed: 1 packet(s), 32 real appended bytes (host-counted, never re-read from a wrapping RAM byte)
[   45] ok   real callback hit counts confirmed: cross_right x1, arm x1, camera_slide_tick x16
[   45] ok   draw-site hit counts confirmed exactly 1/1 (site 1=1, site 2=1)
[   45] ok   idle camera state confirmed: cam_x_lo/y_lo/nt/cam_slide_left/cam_dirty all zero
[   45] ok   rendering enabled confirmed: last $2001 write = $1e (background+sprites on)
[   45] ok   all 960 NT0 tile bytes + 64 attribute bytes match the independent JS-built reference, read via Mesen's own PPU memory
[   46] first resumed NMI after completion met its deadline: scanline 246 cycle 177 (settles scanline 246)
[   48] ok   crossing completed at frame 45; 1 packet(s)/32 real appended bytes; 19 NMI samples observed and ALL deadline-checked (armedFrames=24, expected=19); 4 mask writes; draw-site hit counts 1/1

=== candidate b_plain ===
[    0] MASK-OFF $2001 <- $00 (scanline 0, cycle 96)
[    1] ok   every symbol anchor this script uses preflighted against the ROM's own bytes, including main_loop_ready and both bound-ready sites
[    2] MASK-ON  $2001 <- $1e (scanline 190, cycle 84)
[   21] ok   crossing triggered: flat_screen=0, player placed at the right edge, holding Right
[   21] MASK-OFF $2001 <- $00 (scanline 258, cycle 11)
[   22] MASK-ON  $2001 <- $1e (scanline 241, cycle 127)
[   38] MASK-OFF $2001 <- $00 (scanline 255, cycle 21)
[   39] MASK-ON  $2001 <- $1e (scanline 241, cycle 143)
[   39] ok   candidate (b): completion ENTRY observed, then RETURN observed, in that order -- camera_slide_complete_b has genuinely run to completion
[   39] ok   crossing's own vram_buf workload confirmed: 0 packet(s), 0 real appended bytes (host-counted, never re-read from a wrapping RAM byte)
[   39] ok   real callback hit counts confirmed: cross_right x1, arm x1, camera_slide_tick x16
[   39] ok   idle camera state confirmed: cam_x_lo/y_lo/nt/cam_slide_left/cam_dirty all zero/cam_slide_b_pending zero
[   39] ok   rendering enabled confirmed: last $2001 write = $1e (background+sprites on)
[   39] ok   all 960 NT0 tile bytes + 64 attribute bytes match the independent JS-built reference, read via Mesen's own PPU memory
[   40] first resumed NMI after completion met its deadline: scanline 246 cycle 171 (settles scanline 246)
[   42] ok   crossing completed at frame 39; 0 packet(s)/0 real appended bytes; 19 NMI samples observed and ALL deadline-checked (armedFrames=18, expected=19); 6 mask writes; draw-site hit counts 0/0

=== candidate b_heavy ===
[    0] MASK-OFF $2001 <- $00 (scanline 0, cycle 96)
[    1] ok   every symbol anchor this script uses preflighted against the ROM's own bytes, including main_loop_ready and both bound-ready sites
[    3] MASK-ON  $2001 <- $1e (scanline 50, cycle 230)
[   21] ok   crossing triggered: flat_screen=0, player placed at the right edge, holding Right
[   21] injected flash_left = FLASH_PENDING at redraw_screen_slide's own entry
[   21] MASK-OFF $2001 <- $00 (scanline 258, cycle 119)
[   21] ok   bind_count == 8 confirmed at draw site 1
[   26] MASK-ON  $2001 <- $1e (scanline 241, cycle 116)
[   42] MASK-OFF $2001 <- $00 (scanline 255, cycle 151)
[   42] ok   bind_count == 8 confirmed at draw site 2
[   46] MASK-ON  $2001 <- $1e (scanline 241, cycle 138)
[   46] ok   candidate (b): completion ENTRY observed, then RETURN observed, in that order -- camera_slide_complete_b has genuinely run to completion
[   46] ok   crossing's own vram_buf workload confirmed: 1 packet(s), 32 real appended bytes (host-counted, never re-read from a wrapping RAM byte)
[   46] ok   real callback hit counts confirmed: cross_right x1, arm x1, camera_slide_tick x16
[   46] ok   draw-site hit counts confirmed exactly 1/1 (site 1=1, site 2=1)
[   46] ok   idle camera state confirmed: cam_x_lo/y_lo/nt/cam_slide_left/cam_dirty all zero/cam_slide_b_pending zero
[   46] ok   rendering enabled confirmed: last $2001 write = $1e (background+sprites on)
[   46] ok   all 960 NT0 tile bytes + 64 attribute bytes match the independent JS-built reference, read via Mesen's own PPU memory
[   47] first resumed NMI after completion met its deadline: scanline 246 cycle 176 (settles scanline 246)
[   49] ok   crossing completed at frame 46; 1 packet(s)/32 real appended bytes; 19 NMI samples observed and ALL deadline-checked (armedFrames=25, expected=19); 6 mask writes; draw-site hit counts 1/1

```

**Every preflight passed on all four runs, now with real independently-expected opcodes for both
bound-ready sites** (not a self-referential re-read). **Every callback-hit count matched exactly**
(`cross_right` x1, arm x1, `camera_slide_tick` x16, on all four). **Every one of the 19 observed
NMI samples was deadline-checked and the exact count of 19 was asserted** (not merely a `>= 16`
floor) on all four runs. **`bind_count == 8` was confirmed at both draw sites separately, with
per-site hit counts asserted exactly 1/1** on both heavy runs — not a shared total. **The real,
host-counted `vram_buf` workload reads 32 real appended bytes** on both heavy runs, 0 on both plain
runs.

See §3 for the full acceptance table, including the cut-heavy fixture (Appendix H,
`cut_check.lua.template`), which round 5 also gave a real NMI-sample assertion rather than leaving
it a mask-timing-only measurement.

## Appendix H: the fixture-builder and harness-generator scripts (round 4, "Also"; updated round 5, findings 1/4)

**These scripts live only in the scratch tree today, not in the real repository** — the design
work in this document was prototyped in a throwaway copy, per this document's own scope statement.
Printed here in full so the document outlives that scratch directory; the implementation phase
moves them under `test/lua/` (or a `main/build/`-adjacent scratch-tooling location) the way
`test/lua/build_flash_nmi_roms.mjs`/`build_bound_tile_nmi_roms.mjs` already live beside the checks
they build fixtures for — these are their direct analogues for the camera feature.

Four scripts: `build_mesen_fixture3.mjs` (the fixture/reference builder — builds a ROM for a given
candidate/content-level, and computes the independent NT0/attribute reference plus every RAM
address and preflight byte the harness needs; unchanged this round); `build_camera_check.mjs` (the
harness generator — instantiates `camera_check.lua.template`, Appendix G, against one built
fixture; updated round 5 with the independently-expected bound-ready opcodes and the exact
NMI-sample-count token, finding 4); `cut_check.lua.template` and `build_cut_check.mjs` (round 4's
own addition, finding 3 — the cut-baseline measurement on the identical heavy workload; updated
round 5 with a real NMI deadline-check and exact sample-count assertion, "Also").

**Reproduction note, round 5 (finding 1's own ask): which environment variables must be cleared by
hand before running these builders, since they do not sanitize every selector themselves.**
`build_mesen_fixture3.mjs` explicitly sets/clears only `FORGE_CAMERA_PROTOTYPE` and
`FORGE_CAMERA_CANDIDATE_B` based on its own `label` argument (`cut`/`a`/`b`) — it never touches
`FORGE_CAMERA_CANDIDATE_C` or `FORGE_CAMERA_PHASE1_ONLY`. A shell that still has either of those
set from an earlier phase-1-isolation run (§8, `measure_phase1_isolated.mjs`) or an earlier c-lite
measurement will silently carry it into the next build — e.g. a leftover `FORGE_CAMERA_PHASE1_ONLY=1`
would make a `label: 'b'` build compile with **no consumer at all** despite `FORGE_CAMERA_CANDIDATE_B`
being set, producing a ROM that looks like a normal build request but assembles as phase 1 alone,
with no error. Before running any Appendix H builder in a fresh shell:

```sh
unset FORGE_CAMERA_PROTOTYPE FORGE_CAMERA_CANDIDATE_B FORGE_CAMERA_CANDIDATE_C FORGE_CAMERA_PHASE1_ONLY
```

### `build_mesen_fixture3.mjs`

```js
// Fix round 3, findings 4/5: one verified heavy workload, shared by every
// candidate, with distinguishable substitutes and a real injected Flash.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from './main/project-io.js';
import { buildProject } from './main/build/pipeline.js';
import { parseSymbolFile } from './main/build/symbols.js';
import { screenAttributes } from './main/build/generate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const outDir = process.argv[2];
const label = process.argv[3]; // 'cut' | 'a' | 'b'
const heavy = process.argv[4] === 'heavy';

fs.mkdirSync(outDir, { recursive: true });

if (label === 'cut') {
  delete process.env.FORGE_CAMERA_PROTOTYPE;
  delete process.env.FORGE_CAMERA_CANDIDATE_B;
} else {
  process.env.FORGE_CAMERA_PROTOTYPE = '1';
  delete process.env.FORGE_CAMERA_CANDIDATE_B;
  if (label === 'b') process.env.FORGE_CAMERA_CANDIDATE_B = '1';
}

const project = await loadProject(path.join(ROOT, 'sample'));
project.party[0].renamable = false;
project.project.titleMap = null;
project.cartridge.mirroring = 'vertical';

// A live Flash command somewhere in the project is required for FLASH_ENABLED
// (and so PALETTE_FX_ENABLED, and so vram_reset's own Flash-cancellation
// block) to compile in at all -- injecting flash_left=FLASH_PENDING directly
// into RAM at the trigger does nothing observable if the code path that
// reacts to it was never assembled. Placed on screen 2 (never visited by
// this crossing) so it never actually fires on its own; only the direct RAM
// injection at trigger time (below) exercises it.
if (heavy) {
  const slime = project.sprites.actors[0];
  const npcId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'FlashAuthor', behavior: 'npc' });
  const farScreen = project.maps[0].screens[2];
  farScreen.entities = farScreen.entities || [];
  farScreen.entities.push({
    actorId: npcId,
    x: 32,
    y: 32,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] } }
  });
}

// Eight active bindings, both screens, distinguishable substitutes (finding
// 5: a substitute equal to its own original cannot distinguish "bound tile
// applied" from "bound tile never consulted").
function addBindings(screen) {
  const bindings = [];
  for (let r = 0; r < 8; r++) {
    const cellIndex = r * 16; // row r, col 0
    const paintedId = screen.metatiles[cellIndex];
    const paintedPalette = project.metatiles[paintedId].palette;
    let alt = -1;
    for (let id = 0; id < project.metatiles.length; id++) {
      if (
        id !== paintedId &&
        project.metatiles[id].palette === paintedPalette &&
        JSON.stringify(project.metatiles[id].tiles) !== JSON.stringify(project.metatiles[paintedId].tiles)
      ) {
        alt = id;
        break;
      }
    }
    if (alt < 0) throw new Error(`no distinguishable same-palette substitute for cell ${cellIndex}`);
    bindings.push({ switchId: r, row: r, col: 0, metatileId: alt });
  }
  screen.boundTiles = bindings;
  return bindings;
}

let referenceBindings = null;
if (heavy) {
  addBindings(project.maps[0].screens[0]);
  referenceBindings = addBindings(project.maps[0].screens[1]);
}

const dir = path.join(outDir, 'proj');
await saveProject(dir, project);
const lines = [];
const built = await buildProject({ dir, project, log: (l) => lines.push(l) });
fs.copyFileSync(built.romPath, path.join(outDir, 'game.nes'));
const symbols = fs.readFileSync(built.symbolPath, 'utf8');
const syms = parseSymbolFile(symbols);
fs.writeFileSync(path.join(outDir, 'syms.json'), JSON.stringify(syms));

{
  // Reference nametable-0 content for the INCOMING screen (1), independent
  // of any candidate's own draw code: read straight from project data
  // (screen.metatiles + the 8 active substitutions, when heavy -- else the
  // screen's own painted metatiles unmodified + project.metatiles' own
  // tiles/palette), the same source generate.js's own mt_tl/tr/bl/br
  // tables and screenAttributes() are built from. Always emitted (not just
  // for heavy) so the plain-content runs get the identical correctness
  // proof, not just the workload/timing numbers.
  const incoming = project.maps[0].screens[1];
  const substituted = incoming.metatiles.slice();
  if (heavy) {
    for (const b of referenceBindings) substituted[b.row * 16 + b.col] = b.metatileId;
  }

  const tileBytes = [];
  for (let mtRow = 0; mtRow < 15; mtRow++) {
    // top half: tl, tr for each of 16 columns
    for (let col = 0; col < 16; col++) {
      const id = substituted[mtRow * 16 + col];
      const [tl, tr] = project.metatiles[id].tiles;
      tileBytes.push(tl, tr);
    }
    // bottom half: bl, br for each of 16 columns
    for (let col = 0; col < 16; col++) {
      const id = substituted[mtRow * 16 + col];
      const [, , bl, br] = project.metatiles[id].tiles;
      tileBytes.push(bl, br);
    }
  }
  if (tileBytes.length !== 960) throw new Error(`expected 960 tile bytes, got ${tileBytes.length}`);

  const attrBytes = Array.from(screenAttributes({ metatiles: substituted }, project.metatiles));
  if (attrBytes.length !== 64) throw new Error(`expected 64 attribute bytes, got ${attrBytes.length}`);

  fs.writeFileSync(path.join(outDir, 'reference.json'), JSON.stringify({ tileBytes, attrBytes }));
}

// Resolve the RAM addresses findings 4/5's own harness needs to poke/read,
// out of THIS build's own constants.asm -- these are chain equates
// (`cam_x_lo = bt_walk_step+1`, ...) that shift with whatever else is
// compiled in, so a literal copied from one candidate's build is not safe
// to reuse against another's (round 3 finding 1's own restoration source,
// design-camera-fix1.md's NT-address-derivation section, makes the same
// point about not trusting a address across builds). Only plain
// `name = number` and `name = name +/- number` chains are needed here (no
// multi-hop `name = otherExpr` beyond one level deep is required for the
// names below); parseEquates() in shared/enginesyms.js deliberately can't
// walk a chain at all, so this is a small purpose-built resolver, not a
// reimplementation of that one.
{
  const constantsText = fs.readFileSync(path.join(outDir, 'proj', 'build', 'constants.asm'), 'utf8');
  const defs = {};
  for (const raw of constantsText.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*(?:;.*)?$/.exec(raw.trim());
    if (m) defs[m[1]] = m[2].trim();
  }
  const resolved = {};
  function term(t) {
    t = t.trim();
    if (/^\$[0-9A-Fa-f]+$/.test(t)) return parseInt(t.slice(1), 16);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    return resolve(t);
  }
  function resolve(name, stack = []) {
    if (name in resolved) return resolved[name];
    if (stack.includes(name)) throw new Error('cycle: ' + stack.concat(name).join(' -> '));
    const expr = defs[name];
    if (expr === undefined) throw new Error('undefined equate: ' + name);
    const m = /^([A-Za-z_0-9$]+)\s*([+-])\s*([A-Za-z_0-9$]+)$/.exec(expr);
    const val = m ? (term(m[1]) + (m[2] === '+' ? 1 : -1) * term(m[3])) : term(expr);
    resolved[name] = val;
    return val;
  }
  const wanted = [
    'cam_x_lo', 'cam_y_lo', 'cam_nt', 'cam_slide_left', 'cam_slide_dir',
    'cam_far', 'cam_outgoing', 'cam_dirty', 'nmi_cam_x_lo', 'nmi_cam_y_lo',
    'nmi_cam_nt', 'cam_slide_b_pending',
    'flat_screen', 'game_state', 'player_x', 'player_y', 'bind_count',
    'flash_left', 'switches', 'vram_len', 'vram_cnt', 'vram_buf',
  ];
  const ram = {};
  for (const name of wanted) {
    try { ram[name] = resolve(name); } catch { /* not defined on this candidate -- omitted */ }
  }
  fs.writeFileSync(path.join(outDir, 'ram.json'), JSON.stringify(ram));
}

console.log('built', label, heavy ? '(heavy workload)' : '(plain)', '->', outDir);

// Preflight bytes: read each anchor's own first byte straight out of the ROM
// via jsnes's own mapper (bank-agnostic for the always-mapped kernel region),
// so the Lua script can verify a resolved address is still the anchor it
// claims to be before trusting any breakpoint fired there (finding 4's own
// "preflight every symbol anchor" ask, generalized from nmi_rti's own
// existing $40/rti check to every anchor this harness uses).
{
  const NES = (await import('./renderer/emulator/core/nes.js')).default;
  const rom = fs.readFileSync(path.join(outDir, 'game.nes'));
  const nes = new NES({ onFrame() {}, onAudioSample() {} });
  nes.loadROM(rom.toString('binary'));
  const anchors = ['cross_right', 'redraw_screen_slide', 'camera_slide_tick', 'nmi_rti', 'main_loop_ready', 'vram_open', 'vram_end'];
  if (syms.camera_slide_complete_b !== undefined) anchors.push('camera_slide_complete_b', 'camera_slide_tick_rts');
  // Round 4 finding 1/5: per-draw-site bind_count observation points.
  for (const name of ['bound_ready_outgoing', 'bound_ready_incoming', 'bound_ready_arm', 'bound_ready_complete']) {
    if (syms[name] !== undefined) anchors.push(name);
  }
  const preflight = {};
  for (const name of anchors) {
    const addr = syms[name];
    if (addr === undefined) continue;
    preflight[name] = nes.mmap.load(addr) & 0xff;
  }
  fs.writeFileSync(path.join(outDir, 'preflight.json'), JSON.stringify(preflight));
}
```

### `build_camera_check.mjs`

```js
// Instantiates camera_check.lua.template against one already-built fixture
// directory (from build_mesen_fixture3.mjs -- game.nes, syms.json, ram.json,
// reference.json all present there), substituting every __TOKEN__ with that
// exact build's own resolved addresses. Usage:
//
//   node build_camera_check.mjs <outDir> <a|b> <plain|heavy>
//
// writes <outDir>/camera_check.lua, ready for:
//   Mesen --testRunner <outDir>/camera_check.lua <outDir>/game.nes
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
const candidate = process.argv[3];
const content = process.argv[4]; // 'plain' | 'heavy'
const heavy = content === 'heavy';

const syms = JSON.parse(fs.readFileSync(path.join(outDir, 'syms.json'), 'utf8'));
const ram = JSON.parse(fs.readFileSync(path.join(outDir, 'ram.json'), 'utf8'));
const reference = JSON.parse(fs.readFileSync(path.join(outDir, 'reference.json'), 'utf8'));

function need(obj, name) {
  const v = obj[name];
  if (v === undefined) throw new Error(`missing symbol/address: ${name}`);
  return v;
}

const isB = candidate === 'b';
const completeEntry = isB ? need(syms, 'camera_slide_complete_b') : -1;
const completeReturn = isB ? need(syms, 'camera_slide_tick_rts') : -1;
const boundReady1 = isB ? need(syms, 'bound_ready_arm') : need(syms, 'bound_ready_outgoing');
const boundReady2 = isB ? need(syms, 'bound_ready_complete') : need(syms, 'bound_ready_incoming');
const camSlideBPending = isB ? need(ram, 'cam_slide_b_pending') : -1;

// Round 5 finding 4: independently expected opcodes for each bound-ready
// continuation, read directly off camera.asm/camera_b.asm's own next
// instruction at each label -- never a re-read of the same address.
//   (a) bound_ready_outgoing -> `ldy <cam_outgoing` ($A4)
//   (a) bound_ready_incoming -> `jsr apply_map_music` ($20)
//   (b) bound_ready_arm      -> `jsr apply_map_music` ($20)
//   (b) bound_ready_complete -> `lda #0` ($A9)
const boundReady1Opcode = isB ? 0x20 : 0xA4;
const boundReady2Opcode = isB ? 0xA9 : 0x20;

// Round 5 finding 4: the exact expected NMI sample count for these four
// deterministic fixtures, reviewer-reproduced under the harness's own
// current start/stop convention (armed from the trigger frame through 3
// frames after completion). 0 for any other fixture (the cut-heavy harness
// does not use this template) falls back to the >=16 floor.
const expectedNmiSamples = 19;

const template = fs.readFileSync(new URL('./camera_check.lua.template', import.meta.url), 'utf8');
const subs = {
  // The template already wraps this token in Lua string quotes
  // ("__CANDIDATE__") -- JSON.stringify would double-quote it into invalid
  // Lua (""a""), which is exactly the bug that made Mesen's testRunner hang
  // instead of reporting a load error (round 3's own debugging note).
  CANDIDATE: candidate,
  HEAVY: heavy ? 'true' : 'false',
  CROSS_RIGHT: need(syms, 'cross_right'),
  REDRAW_SCREEN_SLIDE: need(syms, 'redraw_screen_slide'),
  CAMERA_SLIDE_TICK: need(syms, 'camera_slide_tick'),
  NMI_RTI: need(syms, 'nmi_rti'),
  MAIN_LOOP_READY: need(syms, 'main_loop_ready'),
  VRAM_OPEN: need(syms, 'vram_open'),
  VRAM_END: need(syms, 'vram_end'),
  VRAM_PUSH: need(syms, 'vram_push'),
  COMPLETE_ENTRY: completeEntry,
  COMPLETE_RETURN: completeReturn,
  BOUND_READY_1: boundReady1,
  BOUND_READY_2: boundReady2,
  BOUND_READY_1_OPCODE: boundReady1Opcode,
  BOUND_READY_2_OPCODE: boundReady2Opcode,
  EXPECTED_NMI_SAMPLES: expectedNmiSamples,
  CAM_X_LO: need(ram, 'cam_x_lo'),
  CAM_Y_LO: need(ram, 'cam_y_lo'),
  CAM_NT: need(ram, 'cam_nt'),
  CAM_DIRTY: need(ram, 'cam_dirty'),
  CAM_SLIDE_LEFT: need(ram, 'cam_slide_left'),
  CAM_SLIDE_B_PENDING: camSlideBPending,
  FLAT_SCREEN: need(ram, 'flat_screen'),
  GAME_STATE: need(ram, 'game_state'),
  PLAYER_X: need(ram, 'player_x'),
  PLAYER_Y: need(ram, 'player_y'),
  BIND_COUNT: need(ram, 'bind_count'),
  FLASH_LEFT: need(ram, 'flash_left'),
  SWITCHES: need(ram, 'switches'),
  REF_TILES: reference.tileBytes.join(','),
  REF_ATTRS: reference.attrBytes.join(','),
};

let out = template;
for (const [key, value] of Object.entries(subs)) {
  const token = `__${key}__`;
  if (!out.includes(token)) throw new Error(`template missing token ${token}`);
  out = out.split(token).join(String(value));
}
const leftover = out.match(/__[A-Z_0-9]+__/);
if (leftover) throw new Error(`unsubstituted token remains: ${leftover[0]}`);

fs.writeFileSync(path.join(outDir, 'camera_check.lua'), out);
console.log('wrote', path.join(outDir, 'camera_check.lua'));
```

### `build_cut_check.mjs` (round 4, finding 3; updated round 5, "Also")

```js
// Instantiates cut_check.lua.template against an already-built cut-heavy
// fixture directory (build_mesen_fixture3.mjs <outDir> cut heavy).
//
//   node build_cut_check.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
const syms = JSON.parse(fs.readFileSync(path.join(outDir, 'syms.json'), 'utf8'));
const ram = JSON.parse(fs.readFileSync(path.join(outDir, 'ram.json'), 'utf8'));

function need(obj, name) {
  const v = obj[name];
  if (v === undefined) throw new Error(`missing symbol/address: ${name}`);
  return v;
}

const template = fs.readFileSync(new URL('./cut_check.lua.template', import.meta.url), 'utf8');
const subs = {
  CROSS_RIGHT: need(syms, 'cross_right'),
  REDRAW_SCREEN: need(syms, 'redraw_screen'),
  NMI_RTI: need(syms, 'nmi_rti'),
  VRAM_OPEN: need(syms, 'vram_open'),
  VRAM_PUSH: need(syms, 'vram_push'),
  FLAT_SCREEN: need(ram, 'flat_screen'),
  PLAYER_X: need(ram, 'player_x'),
  PLAYER_Y: need(ram, 'player_y'),
  SWITCHES: need(ram, 'switches'),
  BIND_COUNT: need(ram, 'bind_count'),
  FLASH_LEFT: need(ram, 'flash_left'),
  // Round 5 "Also": the cut's own deterministic stopping convention (armed
  // from the trigger frame through 3 frames after settledFrame=28, counted
  // the identical way camera_check.lua.template counts through its own
  // +3-frame report delay) produces exactly 5 real NMI samples on this
  // heavy fixture -- probed empirically with a deliberately-impossible
  // expectation first, then set to the real observed count.
  EXPECTED_NMI_SAMPLES: 5,
};

let out = template;
for (const [key, value] of Object.entries(subs)) {
  const token = `__${key}__`;
  if (!out.includes(token)) throw new Error(`template missing token ${token}`);
  out = out.split(token).join(String(value));
}
const leftover = out.match(/__[A-Z_0-9]+__/);
if (leftover) throw new Error(`unsubstituted token remains: ${leftover[0]}`);

fs.writeFileSync(path.join(outDir, 'cut_check.lua'), out);
console.log('wrote', path.join(outDir, 'cut_check.lua'));
```

### `cut_check.lua.template` (round 4, finding 3; updated round 5, "Also")

```lua
-- cut_check.lua.template -- round 4 finding 3: today's cut (CAMERA off),
-- measured on the IDENTICAL heavy workload (8 active bindings on both
-- screens, a real injected hold-terminal Flash at redraw_screen's own
-- entry -- the cut's own analog of redraw_screen_slide's entry), same mask
-- timing convention as camera_check.lua.template, so the heavy-content
-- figures in design-camera.md read as "cut N, (a) 8, (b) 5+4" -- the cost
-- the cut already pays, not attributed to the camera feature.
--
-- Round 5 "Also": every observed NMI is now deadline-checked and the sample
-- count is asserted (not merely a mask-timing measurement, as round 4 left
-- it) -- the identical technique camera_check.lua.template uses.
--
-- Generated by build_cut_check.mjs. Mesen --testRunner <outDir>/cut_check.lua <outDir>/game.nes

local CROSS_RIGHT     = __CROSS_RIGHT__
local REDRAW_SCREEN   = __REDRAW_SCREEN__
local NMI_RTI         = __NMI_RTI__
local VRAM_OPEN       = __VRAM_OPEN__
local VRAM_PUSH       = __VRAM_PUSH__
local EXPECTED_NMI_SAMPLES = __EXPECTED_NMI_SAMPLES__

local FLAT_SCREEN  = __FLAT_SCREEN__
local PLAYER_X     = __PLAYER_X__
local PLAYER_Y     = __PLAYER_Y__
local SWITCHES     = __SWITCHES__
local BIND_COUNT   = __BIND_COUNT__
local FLASH_LEFT   = __FLASH_LEFT__
local FLASH_PENDING = 0xFF
local BIND_EXPECTED = 8

local EXIT_TIMEOUT = 99
local EXIT_STALE_ANCHOR = 6
local EXIT_NEVER_ARMED = 4
local EXIT_BIND_MISMATCH = 8
local EXIT_WORKLOAD_WRONG = 7
local EXIT_NEVER_SETTLED = 10
local EXIT_DEADLINE_MISS = 5
local EXIT_NMI_COUNT = 15

local VBLANK_FIRST_SCANLINE = 241
local VBLANK_LAST_SCANLINE  = 260
local DOTS_PER_SCANLINE     = 341
local RTI_REMAINING_DOTS    = 6 * 3

local frame = 0
local phase = 1
local held = {}
local mark = 0
local armed = false
local flashInjected = false
local crossHits = 0
local redrawHits = 0
local packetCount = 0
local pushCount = 0
local maskWrites = {}
local settled = false
local settledFrame = nil
local reported = false
local nmiSamples = 0
local nmiDeadlineChecks = 0

local function log(m) print(string.format("[%5d] %s", frame, m)) end
local function fail(code, m) log("FAIL: " .. m) emu.stop(code) end
local function pass(m) log("ok   " .. m) end
local function read(a) return emu.read(a, emu.memType.nesMemory) end
local function write(a, v) emu.write(a, v, emu.memType.nesMemory) end

local function preflight()
  local checks = {
    { "cross_right", CROSS_RIGHT, 0xA4 },
    { "redraw_screen (LDA # => $A9)", REDRAW_SCREEN, 0xA9 },
    { "nmi_rti (RTI => $40)", NMI_RTI, 0x40 },
    { "vram_open (STX zp => $86)", VRAM_OPEN, 0x86 },
    { "vram_push (STX zp => $86)", VRAM_PUSH, 0x86 },
  }
  for _, c in ipairs(checks) do
    local byte = read(c[2])
    if byte ~= c[3] then
      fail(EXIT_STALE_ANCHOR, string.format("anchor %s at $%04x reads $%02x, not $%02x", c[1], c[2], byte, c[3]))
      return false
    end
  end
  pass("every anchor preflighted")
  return true
end

local function onCrossRight()
  if armed and not settled then crossHits = crossHits + 1 end
end

local function onRedrawScreen()
  if armed and not settled then redrawHits = redrawHits + 1 end
  if not flashInjected and armed then
    flashInjected = true
    write(FLASH_LEFT, FLASH_PENDING)
    log("injected flash_left = FLASH_PENDING at redraw_screen's own entry (the cut's own analog of redraw_screen_slide's entry)")
  end
end

local function onVramOpen()
  if armed and not settled then packetCount = packetCount + 1 end
end

local function onVramPush()
  if armed and not settled then pushCount = pushCount + 1 end
end

-- Round 5 "Also": every observed NMI while armed is deadline-checked, not
-- merely counted for the mask-timing table.
-- Counts through the same "armed, plus 3 report-delay frames" window
-- camera_check.lua.template uses (not gated on `settled` the way the other
-- per-crossing counters above are), for one consistent convention across
-- every harness in this document.
local function onNmiRti()
  if not armed then return end
  nmiSamples = nmiSamples + 1
  nmiDeadlineChecks = nmiDeadlineChecks + 1
  local state = emu.getState()
  local scanline = state["ppu.scanline"]
  local cycle = state["ppu.cycle"]
  local finishDot = cycle + RTI_REMAINING_DOTS
  local finishScanline = scanline
  while finishDot >= DOTS_PER_SCANLINE do
    finishDot = finishDot - DOTS_PER_SCANLINE
    finishScanline = finishScanline + 1
  end
  if scanline < VBLANK_FIRST_SCANLINE or scanline > VBLANK_LAST_SCANLINE or finishScanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("NMI #%d (frame %d): rti reached scanline %d cycle %d (settles scanline %d) -- outside vblank", nmiSamples, frame, scanline, cycle, finishScanline))
  end
end

local function onMaskWrite(address, value)
  table.insert(maskWrites, { frame = frame, value = value })
  local state = emu.getState()
  local kind = (value & 0x18) == 0 and "MASK-OFF" or ((value & 0x18) == 0x18 and "MASK-ON " or "MASK-PARTIAL")
  log(string.format("%s $2001 <- $%02x (scanline %d, cycle %d)", kind, value, state["ppu.scanline"], state["ppu.cycle"]))
end

local function onInput()
  emu.setInput(held, 0)
end

local function onFrame()
  frame = frame + 1
  if frame == 1 then
    if not preflight() then return end
  end
  if frame > 500 then
    fail(EXIT_TIMEOUT, "timed out in phase " .. tostring(phase))
    return
  end

  if phase == 1 then
    if frame < 20 then return end
    held = {}
    phase = 2
    mark = frame
    return
  end

  if phase == 2 then
    write(SWITCHES, 0xFF)
    write(FLAT_SCREEN, 0)
    write(PLAYER_X, 240)
    write(PLAYER_Y, 96)
    armed = true
    held = { right = true }
    pass("crossing triggered: flat_screen=0, player at the right edge, holding Right")
    phase = 3
    mark = frame
    return
  end

  if phase == 3 then
    if frame - mark < 6 then return end
    held = {}
    phase = 4
    mark = frame
    return
  end

  if phase == 4 then
    if not settled and read(FLAT_SCREEN) == 1 and #maskWrites >= 2 then
      settled = true
      settledFrame = frame
    end
    if settled then
      if not reported and frame - settledFrame >= 3 then
        reported = true
        if crossHits ~= 1 then
          fail(EXIT_WORKLOAD_WRONG, string.format("cross_right hit %d times, expected 1", crossHits))
          return
        end
        if redrawHits ~= 1 then
          fail(EXIT_WORKLOAD_WRONG, string.format("redraw_screen hit %d times, expected 1", redrawHits))
          return
        end
        if packetCount ~= 1 or pushCount ~= 32 then
          fail(EXIT_WORKLOAD_WRONG, string.format("vram_buf workload: %d packet(s), %d bytes, expected 1/32 (Flash's own cancellation edge)", packetCount, pushCount))
          return
        end
        local bindCount = read(BIND_COUNT)
        if bindCount ~= BIND_EXPECTED then
          fail(EXIT_BIND_MISMATCH, string.format("bind_count is %d, expected %d", bindCount, BIND_EXPECTED))
          return
        end
        if nmiSamples ~= EXPECTED_NMI_SAMPLES then
          fail(EXIT_NMI_COUNT, string.format("nmiSamples=%d, expected exactly %d under this fixture's own deterministic stopping convention", nmiSamples, EXPECTED_NMI_SAMPLES))
          return
        end
        if nmiDeadlineChecks ~= nmiSamples then
          fail(EXIT_NMI_COUNT, string.format("only %d of %d observed NMIs were deadline-checked", nmiDeadlineChecks, nmiSamples))
          return
        end
        pass(string.format("cut settled at frame %d; cross_right x1, redraw_screen x1; vram_buf 1 packet/%d bytes; bind_count == %d; %d mask writes; %d NMI samples, all deadline-checked", settledFrame, pushCount, BIND_EXPECTED, #maskWrites, nmiSamples))
        emu.stop(0)
      end
      return
    end
    if frame - mark > 60 then
      fail(EXIT_NEVER_SETTLED, "the cut crossing never settled")
      return
    end
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addEventCallback(onInput, emu.eventType.inputPolled)
emu.addMemoryCallback(onCrossRight, emu.callbackType.exec, CROSS_RIGHT)
emu.addMemoryCallback(onRedrawScreen, emu.callbackType.exec, REDRAW_SCREEN)
emu.addMemoryCallback(onVramOpen, emu.callbackType.exec, VRAM_OPEN)
emu.addMemoryCallback(onVramPush, emu.callbackType.exec, VRAM_PUSH)
emu.addMemoryCallback(onNmiRti, emu.callbackType.exec, NMI_RTI)
emu.addMemoryCallback(onMaskWrite, emu.callbackType.write, 0x2001)
```
