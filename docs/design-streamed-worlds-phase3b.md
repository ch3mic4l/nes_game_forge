# Design record: streamed worlds, phase 3b — the two-nametable ring and its entry gate (slice S1)

**Status, 2026-10-07.** Slice S1 of phase 3b is a *proof*, not an engine change. Nothing under `engine/`, `main/` or `shared/` changed. The whole ring
design below existed as three patches (`01-ring-select.patch`, `02-ring-engine.patch`, `03-player-far-branch.patch`) applied at
test time to a `mkdtemp` copy of those three directories, and the gate in `test/lua/ring_gate/` measured that copy on every acceptance cell. (Since S2 the
vertical half is production code, and since S3 C1 the horizontal half is too: the three patches are **retired**, see section 10. The gate once applied
`00-refusal-lift.patch` to a production tree; the lift shrank with each of S4a, S4b, S4c and S5 C2 and was **retired in S5 C3, section 19**: no cell carries a patch.) The
streamed-map refusal for mirrored boards stayed on through S3. Slices S2 onward wire the design into the shipped engine; each lands its own allowance and
proof docs. This file is a dated record: it names constants (`SW_RING_ROW_LEN`, the row fork's labels) that the S1 prototype's patches added and that production has carried since S3 C1.

**The gate certifies a baseline.** S1 made its patched copy from commit `5138c1f` (the tree after phase 3b slice S0 and the shipped fixes that
preceded S1). **S2 commit C3 rebaselined it onto C2, `cd7a9f8`, the production vertical ring; S3 commit C2 rebaselined it onto C1, `aaa678a`, the production vertical AND
horizontal ring; S4a commit C2 rebaselined it onto S4a C1, `9b00c59`, which admits MMC3 action games; S4b commit C2 rebaselined it onto S4b C1, `19ea33c`, which admits MMC1 action games; S4c commit C2 rebaselined it onto S4c C1, `bb43a2c`, which admits UNROM 512 action games; S5 commit C3 rebaselined it onto S5 C2, `f3833db`, which admits a streamed RPG on all three boards (section 19):** `BASELINE` in `test/lua/ring_gate/ringtree.mjs` is now `f3833dbefe85378b6d305f16a0bb341fd5044e96`, and `verifyBaseline()` there refuses to run if
`engine/`, `main/` or `shared/` differ from it. At S5 C3 the six cells (MMC1, MMC3 and U512, each V and H) run on shipped forks, byte for byte, and **no cell on either game type carries a patch**: every tree is `f3833db` itself (plus a control's own sabotage form); the refusal lift of sections 10 to 16 is retired (section 19). The measured table in section 3 below was produced at `5138c1f` (S1) and
`cd7a9f8` (S2 C3) and `aaa678a` (S3 C2), all kept there as history, and **last measured at `f3833db` by the S5 C3 final matrix** (section 3's certificate paragraph, section 19; the S4c C2 matrix at `bb43a2c`, the S4b C2 matrix at `19ea33c` and the S4a C2 matrix at `9b00c59` are history, sections 8 and 16).

**Not everything is certified.** Five items are declared UNCERTIFIED (option A, Chris), and the limits of the row 4 to 8 evidence are
recorded under "Limits of this proof". Both are stated plainly below; neither is shown as PASS anywhere the gate prints a table.

## 1. The design

### 1.1 Geometry per mirroring

The shipped streamed world is a torus of 32×30 metatile blocks over four nametables. On a board whose mirroring leaves two nametables distinct, the
ring *is* those two nametables and the dead axis is exactly one screen deep.

| Mirroring | ring | scrolls | dead axis | strip that exists | strip length | distinct nametables |
|---|---|---|---|---|---|---|
| vertical | 32×15 blocks (an N×1 world) | X | Y | column strip | **15** (not 30) | 2: `$2000`, `$2400` |
| horizontal | 16×30 blocks (a 1×N world) | Y | X | row strip | **16** (not 32) | 2: `$2000`, `$2800` |

A fork is mandatory, not an optimisation. The four-screen draw derives the nametable from the parity of both axes, so on a mirrored board a write to
"the other row's" half lands on the mirror of the live half and overwrites it: the render window would walk four nametables, and a 30-block column
strip's blocks 15 and up would be drawn at `+$08`, which on vertical mirroring *is* `$20xx`.

### 1.2 One logical, physical and shadow mapping

The shipped parity index is kept; it is not compacted. The nametable index is `n = 2·(screenRow&1) + (screenCol&1)`, exactly what `cam_nt` already
holds. The three coupled tables stay four entries. What forks is only which indices are live:

| Mirroring | live `n` | physical nametable | shadow offset `n·64` | indices never produced (they would alias) |
|---|---|---|---|---|
| vertical | {0, 1} | `$2000`, `$2400` | 0, 64 | 2, 3 |
| horizontal | {0, 2} | `$2000`, `$2800` | 0, 128 | 1, 3 |

The other indices are never produced because the dead axis is pinned by the extent clamp (`cam_y_lo` is 0 on a vertical ring, `cam_x_lo` on a
horizontal one). `attr_shadow` is unchanged and sparsely used. A Shake can write PPUCTRL nametable indices 1/3 transiently under horizontal
mirroring; those select the aliases of live 0/2, so nothing forks for it, but the oracle and the PPUCTRL trace include Shake.

Every consumer of the index (dialogue tile and attribute addresses, strip start, block and attribute draw, full-redraw callers, window enter/leave
maths) was audited and is unchanged except the three forks below.

### 1.3 The dead axis

Crossing the dead axis is a map-edge wall, not a flip and not a stream: the grid is one deep there, so the crossing branch finds no neighbour. The
camera freezes through the one-screen extent clamp, not through a new runtime branch; `cameraAxes` in `shared/cartridge.js` is the authoring-side
single writer `validateProject` consults.

### 1.4 What forks

- **Strip builders and the NMI wrap.** The column strip is 15 blocks on one screen (one `sw_goto` and restore), the row strip 16; the wrap modulus is
  15 and 16. Constants `SW_RING_COL_LEN` and `SW_RING_ROW_LEN`.
- **The render-window index sequence only.** Vertical steps 0,1 and ends at 2; horizontal steps 0,2 and ends at 4. Constants `SW_RW_NT_STEP` and
  `SW_RW_NT_END`. The tables, the shadow storage and the dialogue consumers are untouched, so horizontal index 2 keeps its base row 15.
- **One branch in `engine/player.asm`.** A horizontal streamed build fails to assemble (`beq cross_none` out of ±128). Only the failing site is
  patched (then `03-player-far-branch.patch`; since S3 C1 it is the shipped `ring_far1` branch, section 9, and the patch is retired), so that the fix is gated to leave the six fixtures' hashes unchanged.
- **Selection.** One generated constant, `STREAM_RING`: 0 (four-screen, every current build, byte-identical), 1 (vertical, X ring), 2 (horizontal,
  Y ring), derived from `cameraAxes` and the mirroring so the engine and the JavaScript cannot disagree. The forked code sits under an indented
  `.if STREAM_RING`.

### 1.5 The dialogue overlay and its close frame

The overlay needs no address change. Its close frame's packet queue differs by ring, in `main_loop`'s call order:

- **Vertical:** Flip 5 + Flip 5 + Flash 35 + arrow hide 4 + the close row split across the `$2000/$2400` join when the camera is mid-scroll
  (`3+a` and `3+b`, a+b=32) + terminator 1 = **88 bytes** (`vram_len` 87). 88 remains the global bound.
- **Horizontal:** `cam_x_lo` is pinned to 0, so the row never wraps: one packet `3+32`, 5+5+35+4+35+1 = **85 bytes** (`vram_len` 84).

A harness that hard-codes a length of 87 and two close packets cannot pass a valid horizontal ring, and its exit-7 "workload short" outcome there is
the harness's shape, not a finding about the engine; the row 6 judge takes the structure from the build instead.

### 1.6 RAM and kernel

No new RAM is expected: the fork reuses the strip state (`st_len`, `st_fnt`, `st_vary`, `sbuf`) and `sw_rw_nt`. The ring constants are assembled in.
The kernel cost of the fork is a render-loop increment and four constants, an estimate that slices S2 and S3 measure per board and game type.

## 2. The gate method

### 2.1 What counts as evidence

A cell is measured on the real emulator by an executable harness, from observed execution (memory callbacks, program counters, scanline and dot
positions), never from a state byte or a scene's name. An unmeasured required cell fails. A non-applicable cell needs a stated source proof. A
control is a deliberate mutation that must fail its stated check, run next to a matching positive that passes; a control caught by an unrelated
diagnostic does not count.

### 2.2 The cells

Six mapper and mirroring pairs (MMC1, MMC3 and UNROM 512, each vertical and horizontal), each × an action project and an RPG project, each × the
dialogue placement it actually gets (resident or banked, asserted from `streamworldDialogueBanked`). An action project cannot place the overlay in a
battle bank, so action × banked is N/A on every board, proved by the same predicate the build uses, applied to a scene carrying 3,000 characters of
text. That leaves 18 buildable cells (six pairs × action resident, RPG resident, RPG banked) × nine rows × two emulators.

### 2.3 The rows

| # | Row | What it asserts |
|---|---|---|
| 1 | ROM identity | header mapper and mirroring match the cell; `STREAM_RING` and the dialogue placement match; a four-screen fallback cannot pass |
| 2 | Workload witnesses | a witnessed maximum for every reachable frame path, with read, `sw_goto` and mapper-write counts |
| 3 | VRAM and attribute oracle | nametable and attribute bytes equal the oracle after a lap, every full-redraw path and dialogue open, write and close, at both live nametable indices |
| 4 | Mainline `G` | the full-system frame cost `G` is under 29,780 cycles for every witnessed class, with no overrun |
| 5 | NMI deadline | the strip drain finishes inside vblank with the ring's real length, wrap and destination |
| 6 | Close | the close frame's queue structure, drain, publication and scroll-tail restore, inside vblank |
| 7 | Decoded seam | a walk crossing and a scripted Move crossing, decoded |
| 8 | MMC3 split and lock | the R1 font and art selection and the scanline IRQ against strip work, the `split_lock` branch, PRG, CHR and terrain integrity |
| 9 | Controls | every control fails on its mutation and its matching positive passes |

### 2.4 The harness

- **One tree-maker.** `ringtree.mjs` copies `engine/`, `main/` and `shared/` to a temporary directory, applies the ring patches with `git apply`, and
  builds a project through *that copy's* public path. It never falls back to the unpatched tree. A sabotage is one more patch applied on top.
- **Two ring trees (S2 C3, S3 C2).** `makeTree({ ring: 1 })` is the **production-vertical** tree and `makeTree({ ring: 2 })` the **production-horizontal** tree: each is
  `BASELINE` plus `00-refusal-lift.patch` (the `validateProject` refusal of two-nametable streamed boards, which production still carries until S4) and nothing else.
  The S1 prototype patches `01-ring-select.patch`, `02-ring-engine.patch` and `03-player-far-branch.patch` are **retired** (`RETIRED_PATCHES`, `ringtree.mjs`): C1
  shipped all of their effect, so at this baseline each would be empty. A retired patch is never applied, hashed or listed again: `patchFile` and `makeTree` refuse its
  name, no ring's patch set holds it, no file of that name exists, `checkRetiredShipped` requires the baseline to still carry the code each used to add, and
  `prov_unit.mjs` pins all of it. A sabotage has a form per ring it is meaningful on (`sabotage/<name>.patch` for ring 2, `sabotage/vertical/<name>.patch` for ring 1): of the 28 sabotages, 25 have both
  forms (23 byte-identical for both rings because production is one code base for them; only `render-four-nts` and `compacted-cam-nt-horizontal` differ) and three have one,
  because on the other ring they are **equivalent mutants** (they assemble to the very ROM the positive builds, proved by building both and comparing bytes, `prov_unit.mjs`):
  `wrap-row-32` on a vertical ring (its `SW_RING_ROW_LEN` is already the literal 32), and `strip-len-30-vertical` and `wrap-col-30` on a horizontal ring (its
  `SW_RING_COL_LEN` is already 30). `SABOTAGE_RINGS` and `NO_FORM_REASON` (`ringsabotage.mjs`, the single writer; `regen_patches.mjs` refuses to cut a form for any other ring and
  deletes a stale one) make each a control-level N/A with a printed proof: the runners refuse it, the identity row witnesses the cell as N/A, the matrix never schedules the S1c control there, and the gate
  prints the reason with the absent patch file. The vertical catches of the two column forms and the horizontal `wrap-row-32` catches stay required, and no whole horizontal row-9 cell is N/A. A cell is built only from its own ring's tree, and the harness proves what a
  build actually consumed rather than assuming it. What the proof guarantees, and what it does not (the same for both rings):
  - **A tree, at check time.** `verifyProduction(root, applied, ring)` rebuilds the exact expected content (`BASELINE`'s blobs with the canonical, hashed patches applied in
    order, `expectedContent(applied, ring)`; each patch file is read once, and the bytes hashed are the bytes parsed and given to `git apply` on stdin) and requires
    every file under `engine/`, `main/` and `shared/` to equal it by git blob hash (the tree's `package.json`, which only supplies the module configuration, is excluded), so an edit inside a file a sabotage declares fails too, not only an edit to a file nobody declared
    (`engine/streamworld.asm`, `engine/player.asm`, `main/build/generate.js` and `shared/cartridge.js`, the shipped forks, are unmodified unless a sabotage names them, and then only by that
    sabotage's own patch). `loadTree` re-proves it at every build. A retired prototype patch can still be *applied* to a tree by hand: the proof then fails, which is
    the point of it. "Never re-patched" is a property of what the gate accepts, not of the directory.
  - **The bytes a build consumed (C3 fix 2, now both rings).** A check of the mutable tree before and after a build cannot see a source that is edited only while the generator copies it
    and restored right after. Every ring tree is therefore registered with a consumed-input guard (`ringtree.mjs`): the generator's engine copy is replaced by a *verified
    copy* (the source is read once, hashed against the expected blob, and those same bytes are written to the build directory, so the assembler reads what was
    verified), and every module of the tree (`main/`, `shared/`) goes through a *verified load* (the source the ES module loader read is hashed against the expected
    blob; a module is read once per URL and the build graph reads no source lazily afterwards). `buildCell` hashes the copies the assembler read once more, and every
    ring-1 and ring-2 build and run stamp carries the evidence (the engine set and each loaded module, with blobs), which `auditTreeProvenance` re-derives from `BASELINE` and
    the stamp's patches (`provenanceFor(ring)`). Not bound: the generated `assets/` (derived from the verified JS and the project, so a sabotage that targets the generator is bound by its
    patched blob, not by its output), the assembler and the host (their own stamps), and a third party that rewrites the private build directory after the copy.
  - **The audit requires it at this baseline.** Every ring-2 stamp at `aaa678a` must carry `treeKind: production-horizontal`, the exact-content proof (`productionProof`; the legacy field
    `productionVertical` is refused) and consumed evidence; `ringprovindex.mjs` refuses a ring-2 stamp that is prototype-kind, lacks evidence, carries the other ring's
    proof or contradicts itself (the ring-0 comparison builds' patched side included). The audit sabotages in `prov_unit.mjs` that must fail: a ring-2 stamp relabelled as a prototype
    with the three retired patches, a live tree re-patched with prototype-era file contents (`player.asm`, `generate.js`, `project.js` from git history), swapped consumed
    engine/JS files, and the restored-during-copy case on both rings.
  - **History.** The audit's historical waiver (`s1b_rejudge.mjs`) applies only to stamps of baseline `5138c1f` (`PRE_C2_BASELINE`) and of a kind the old S1b certificate contains
    (`HISTORICAL_KINDS`, unchanged by S3 C2: it admits no new kind); a current-baseline stamp is audited in full whatever the option says, and the tool refuses a directory that
    holds one. A prototype-horizontal stamp is acceptable only under its own historical baseline, exactly as narrowly as before.

  The certificate audit (`auditTreeProvenance`) re-derives the expected baseline, tree kind, patch names/order/hashes, proof and consumed-input evidence for every build
  and run stamp; `buildCell` refuses a tree whose ring is not the cell's; row 1 requires each ring's ROM to carry its shipped fork labels (production forks the row strip under every `.if STREAM_RING`, so a vertical ROM now carries the `sw_ring_row_*` labels with
  operand 32, `RING_GEOMETRY[1].row`; the horizontal ROM carries the same labels with operand 16). `prov_unit.mjs` holds the controls, including a tree re-patched with each retired prototype patch, which must fail, and the restored-during-copy
  case, which must fail in `buildCell` and in a scene build.
- **Who decides what.** Rows 5 and 8: a Lua script records what happened (writes with their PC, scanline and dot; interrupt entries; state at fixed points)
  plus the stimulus, and a Node judge holds an independent model of what had to happen, restated from the contract rather than read from the engine's source.
  This is why a patched engine that writes the wrong length disagrees with the model. Row 6 is split: its Lua template also validates the queue structure,
  the publication, the drain, the scroll restore and the deadline and prints `OK`/`FAIL` lines; the Node judge independently re-parses the printed queue and
  recomputes the deadline from the printed `nmi_rti` and last scroll write, but consumes the Lua's own evidence for the drain, publication and scroll items.
- **Row 5** (`ringnmi.mjs`, `test/lua/sw_nmi_ring.lua.template`): an independent model of the strip (axis, length, wrap, live nametables, the per-NMI
  chunk of 3 blocks, or 2 beside a queue of at most 35 bytes, the exact `$2006`/`$2007` sequence including the attribute read-modify-write, and the
  deadline in CPU cycles). Per cell: a parameterised poke over **every legal start** (vertical 0-14, horizontal 0-15) on both live nametables, strip-only and
  mixed, in both coordinate classes (the quadrant sequence of the attribute shift loop), plus the **worst family** (the metatile ids whose table reads cross a
  page in the most tables, class 1, strip-only and mixed beside both a one-packet and an eight-packet 35-byte queue, with MMC3's armed split tail); and a real
  arm, holding the walk button so the engine's own arm routine runs and its geometry is checked against the ring constants. `cover:domain` fails when a required
  start, class, worst-family tuple or simulated block class (28) was not observed (a FAIL, never an UNCERTIFIED); the deadline items name the case that set each minimum. Round 3
  adds a **finite bound**: `ringwcet.mjs` decodes each build's own `nmi` path from its ROM and takes the longest path (taken-branch and page-cross cycles at the assembled addresses, the
  514-cycle OAM DMA, every loop bounded by a budget argued from the source: chunk 3 / 2, a 35-byte queue, one wrap, the attribute-shift sum), charges a 22-cycle entry delay and
  rti, and `deadline:strip` / `deadline:mixed` report **both** the observed minimum margin and the certified margin, and FAIL when the certified margin is not positive, when an
  observation falsifies the bound, or when the ROM's chunk differs from the contract. The argument (the budgets, the drain formula with its two page-penalty exceptions, the entry allowance, the 18-build bound table) is summarised under Limits and the per-build figures are in section 3. What stays open is
  stated under Limits.
- **Row 6** (`ringclose.mjs`, the `ring` sections of `test/lua/sw_close_deadline.lua.template`): the template validates each packet header of the
  queue against the structure the build expects, and the judge parses the printed queue again independently. The talker stands where the camera is
  mid-scroll.
- **Row 8** (`ringsplit.mjs`, `test/lua/sw_split_ring.lua.template`): a harness build in which `switch_prg_bank` carries RAM-counted delay loops, zero
  unless the recorder pokes them, so the recorder can stretch the lock window until an NMI or the split IRQ falls inside it. The judge keeps a
  simulated MMC3 register file driven by the observed writes in time order and asserts the split program, `split_lock`'s contract, the four writes of
  `switch_prg_bank`, that every completed R6/R7 value commit equals the called bank (and none happens outside a call), that R0 and R2–R5 are not written while
  the world runs, and the exact mapper-write totals. `r8:coverage` requires at least two NMI landings and two IRQ assertions between the select and the value
  of R6 (after the first write) and of R7 (after the third); the other positions in the call are reported, not each required, and the trace includes the skipped
  trials. `r8:terrain` omits the boundary line, allows a deferred-IRQ transition band of 8 lines (`defer=8`), and requires a locked frame only to keep the R1 it
  started with.
- **Rows 2 and 4** (`run_s1b.mjs`): witness specs measure `G` per frame class with the read-price sweeps and cross-check the jsnes counters.
- **Provenance.** Every run writes a stamp (`ringprov.mjs`): the baseline, the patches applied, a fingerprint of every harness module and template that
  executed, the assembler, the host, the emulator build and the files its private HOME loaded. Every Mesen run uses a private HOME
  (`ringhome.mjs`), and the user's own save directory is snapshotted before and after. `ringprovindex.mjs` audits every stamp against its log, its
  result file and its retained raw recorder output, resolving every file from the two directory arguments only, and writes an index of their hashes. The mode is **explicit**: `--verify`
  re-checks a finalized index and FAILS when it is missing or unreadable; `--construct` builds one and labels its output UNFINALIZED. The gate and `run_sw_ring_gate.sh` verify by default;
  only the matrix's pre-finalization gate job passes `--construct`. For rows 5, 6 and 8 the content audit (`s1caudit.mjs`) reads the linked result and recomputes its identity, its exact
  required item set, its counts, failed ids and verdict from the items against the current declarations; a control's matching positive is validated the same way,
  and a stamp that says PASS over a missing, empty or contradictory result is a FAIL cell.
- **The matrix.** `run_matrix.mjs` runs every job in `ringjobs.mjs`, each declaring its expected exit status and a pattern its log must contain. A
  positive that fails, a control not caught and a selection error that stops erroring are all unexpected, and the matrix exits nonzero.
- **The table.** `test/lua/run_sw_ring_gate.sh <provenance-dir> <matrix-log-dir> [<s1b-records-dir>]` prints the rows × cells × emulators table from a
  certificate's evidence and exits nonzero on any FAIL or UNMEASURED cell or any unexpected job. Rows 2, 4 and 7 are re-derived from the S1b records
  the matrix wrote, or read from a directory given as the third argument; the header line says which. Nothing is hard-coded to a checkout.
- **Regression checks on tracked data (S2 C3 fixes 3 and 4).** `test/lua/ring_gate/s1c_noflag.mjs` (12 configurations) and `test/lua/ring_gate/s1b_noflag.mjs` (11) build with
  `STREAM_RING` absent and compare their artifacts byte for byte with the tracked baselines `test/lua/ring_gate/noflag/s1c-cd7a9f8.json` (recorded from a clean checkout of cd7a9f8, C2) and
  `test/lua/ring_gate/noflag/s1b-aaa678a.json` (recorded from a clean `git archive` of aaa678a, S3 C1; see section 10). **What a pass proves:** the flag-absent output is unchanged since C2 (S1c) and since C1 (S1b).
  **What it no longer proves:** the original inertness result (the ring patches leave a flag-absent build as it was), which was recorded against 5138c1f, before C2's
  production changes; C2 legitimately changed some ROMs (6 close-deadline ROMs and 33 S1b artifacts differ between the two baselines), so the first attempt at this
  matrix, which still compared with the 5138c1f files, failed on them. `s1b_unit.mjs` re-judges the authentic S1b record and its one historical stamp, kept in
  `test/lua/ring_gate/fixtures/s1b-r3-real/`, through the real `s1b_rejudge.mjs` command: the genuine record must pass and two corrupted copies must fail. Both baselines
  and all five fixture files are **required** inputs (`REQUIRED_DATA`, `test/lua/ring_gate/ringjobs.mjs`): the harness fingerprint hashes them and refuses to compute
  when one is absent, and the unit fails, never skips, without the fixture. No check reads a `handoff-next/` path.

### 2.5 Controls

The control declarations live in one table (`test/lua/ring_gate/s1ccontrols.mjs`) that the runner, the job list, the gate script and the unit tests
all read. A control that targets one axis declares what it does on the other: it must *pass* there, as a declared non-catch, so a control that
changes more than it says shows up. Harness mutations (the validator is told something false) are labelled as such.

| Target | Controls (S1 sabotage list, plan 2.6 and 2.7) |
|---|---|
| removed timing coverage | row 5 mutations `cover-drop-start`, `cover-drop-class`, `cover-drop-worst` (each fails `cover:domain` and nothing else) |
| strip length 30 | `strip-len-30-vertical` patch (vertical ring only: an equivalent mutant on a horizontal one; rows 1 static, 3, 5); row 5 arm mutation `arm-len30` |
| wrap left at 30 or 32 | `wrap-col-30` (vertical ring only), `wrap-row-32` (horizontal ring only) patches (rows 1 static, 5); the row 3 oracle declares it a non-catch for the column wrap, which is dead code in every legal scene |
| destination `+$08` on vertical | `dest-plus08-vertical` patch (rows 3, 5) |
| wrong axis, start offset past the wrap | row 5 arm mutations |
| render loop over four nametables, compacted `cam_nt` index, `STREAM_RING` forced 0 | patches caught by rows 1 and 3 |
| `chunk4`, `mixed3` | row 5 build breaks |
| `no-flash`, `slow-drain`, a fixed length of 87, a split close row on horizontal, an unsplit one on vertical | row 6 breaks and harness mutations |
| full-system padding | `pad-mainline-over` (fails the `G` gate), `pad-mainline-under` (passes the gate, refused by the class estimate) |
| R6/R7 corrupted transiently (restored before the routine returns), on RPG banked and action | `prg-transient` (caught on `r8:prg-group` and `r8:prg-window`; the run completes) |
| R6/R7 corrupted, R0 or a wrong R1, `sei` removed, `split_lock` removed, split armed in a locked frame, split IRQ left armed | row 8 overrides of `engine/banks.asm` and `engine/split.asm` |

## 3. The measured table

**The certificate** is the one full matrix of S5 commit C3: `run_matrix.mjs` into the provenance directory `s5-c3-provenance-final` and the log directory `s5-c3-logs-final`, `--jobs=18` (48 GB available), started 2026-10-15 05:37 PDT and
finished 07:01 PDT (84 minutes) with exit status 0, on baseline `f3833db` (S5 C2: a streamed RPG is admitted on every ring board, so no cell on either game type needs a lift) and a 250-input harness fingerprint that every one of its stamps carries. Result: 385 jobs, 0 unexpected, 1,793 provenance stamps (1,772 built, 15 error, 6
ring-0 comparisons), 0 problems. `ringprovindex.mjs --verify` passes on the finalized index with 0 problems and prints "no stamp carries a lift: 0 of 1,793", and `run_sw_ring_gate.sh` run in its default verify mode (INDEX hashes checked, 0 audit problems, 0 stale-fingerprint stamps; 384 matrix jobs judged, the gate does not judge itself) prints, over 24 cell and build lines × 9 rows × 2
emulators (432 entries): **146 PASS, 54 UNCERTIFIED, 232 N/A, 0 FAIL, 0 UNMEASURED**, `GATE PASS`. The table is the S4c C2 one cell for cell except row 9, Mesen column, of MMC3-V and MMC3-H RPG *resident* (N/A to PASS: those builds ran no S1c control before and now run the two row-8 session controls), which is the whole of the 144 to 146 and 234 to 232 movement; the UNCERTIFIED list and every other source proof are unchanged. **No stamp carries a patch other than a control's own sabotage form**: the 758 stamps of the six action cells (MMC1 257 = 142 empty patch set + 115 sabotage only, MMC3 258 = 160 + 98, UNROM 512 243 = 144 + 99) are as at S4c C2, and the 1,017 stamps of the six RPG cells, which carried the `ringGame` lift at S4c C2 (1,009), are now unlifted too (MMC1 329 = 222 + 107, MMC3 356 = 250 + 106, UNROM 512 332 = 225 + 107; the 8 extra are the new row-8 controls), every one `lifted:false` with `changed` empty on an empty patch set and the tree equal to `f3833db`. The 12 ring-0 builds are all unlifted (6 pristine, 6 on the production tree with an empty patch set: the same bytes) and the 6 comparisons are between equal production trees (so ring-0 row 1 proves the harness path, not a code difference, section 19). Every vertical stamp (901) is `production-vertical` and every horizontal stamp (886) is `production-horizontal`, each with an exact-content proof (`productionProof.exact`); 880 of the horizontal stamps and all 901 vertical ones carry consumed-input evidence (the other six horizontal stamps are the ring-0 identity comparisons, which carry the
proof of their patched side instead); the six pristine ring-0 builds have neither, and **no stamp is of a prototype kind**. The 232 N/A entries are source proofs: action × banked on every
board (108), row 8 on the MMC1 and U512 cells (24) and on jsnes for the MMC3 cells (6), rows 5 and 6 on jsnes (36), row 4 on jsnes (18), row 7 on Mesen (18), and row 9 where a build carries no S1c control or the emulator is
jsnes (22). Row 9 prints a control-level N/A proof for every equivalent mutant (section 2.4): `nmi-wrap-row-32` on the three vertical action resident cells, and `nmi-strip-len-30-vertical` and `nmi-wrap-col-30` on the three horizontal ones; those controls are not part of the cell's
row-9 verdict, which is its other controls, so no cell changed status. (The gate's printed reason for the row-9 N/A of a build with no control still reads "controls run on action resident, and on rpg banked for the deadline controls"; the MMC3 RPG resident builds now also run the two session controls. The wording lives in the frozen harness and is not a measurement.) **The only measurements that moved are the ones the slice meant to move:** of the 1,764 built ROMs the S4c C2 certificate also built, 1,762 are byte for byte the same-named ROM (same label, same SHA-256) and the two that differ are `s1b-U512-H-rpg-resident` and `s1b-U512-H-rpg-banked`, whose world is now 60 rows (S4c C2: 59); the 8 new row-8 controls (1,772 built ROMs in all) have no counterpart, and the 26 row-8 RPG session stamps additionally name a separate lifecycle ROM and Lua script in their hashed plan. Of the 327 JSON logs (S4c C2: 319), 252 are byte-identical to S4c C2's and 75 are not: 8 are new (the new controls), 29 are identity logs that differ in their provenance block only, 2 are the U512-H RPG S1b records (N = 60), and 36 are the row-8 logs of the six MMC3 cells. Of those 36, 18 are action-resident logs and are the same measurement (the Lua template changed, so their `luaSha256` differs; three of them also differ by one frame in the Mesen run length, e.g. `split-irq-left-armed` MMC3-H 1,554 to 1,555 frames, with every item status and verdict unchanged), and 18 are RPG logs that now fold in the session (the plain run's figures, 1,805 to 2,104 measured frames and 391 to 603 `switch_prg_bank` calls, are S4c C2's exactly) and carry the two new items `r8:lc-return` and `r8:lc-coverage`; in two of the RPG banked controls (`no-lock` and `no-sei` on MMC3-V) the folded evidence also fails `r8:prg-window`, which passed on the plain run alone, an additional catch on a control that was already caught as declared. **Every row-5 and row-6 log (positive or control) is byte-identical to S4c C2's, and so are 16 of the 18 positive S1b records supplying row 4**; the 29 identity logs, the 36 row-8 logs and the two U512-H RPG S1b records are the exceptions, and the `pad-mainline-over` witnesses (`s1b-pad-over-MMC3-H`, `s1b-pad-over-U512-V`) are byte-identical to S4c C2's this time.

*History.* The previous certificate was S4c C2's (matrix `s4c-c2-provenance-final`, 2026-10-14 12:15 to 13:38 PDT, baseline `bb43a2c`, 248-entry fingerprint, 377 jobs, 1,785 stamps (1,764 built, 15 error, 6 comparisons), all six action cells unlifted and every RPG cell on the `ringGame`-only lift, the U512-H RPG cells at 59 rows), with totals **144 PASS / 54 UNCERTIFIED / 234 N/A / 0 FAIL / 0 UNMEASURED** and the same table otherwise. It is now history (section 8): this harness no longer verifies it
(`gate-of-s4c-certificate-under-s5-harness.out`: 13,021 audit problems, the first a baseline mismatch against `f3833db`, 1,779 stale-fingerprint stamps, 56 FAIL/UNMEASURED cells and 8 unexpected jobs (the new controls it never ran), GATE FAIL, a property of that old index and of this checkout's baseline, not a defect of either). What differs from it: the baseline `bb43a2c` to `f3833db`; the stamps of the RPG cells (`lifted:false`, 1,017 against 1,009 lifted); 8 more jobs (377 to 385) and 8 more stamps (1,785 to 1,793), the new row-8 controls; the harness fingerprint (248 to 250 inputs); the sabotage patches' bytes (re-cut at the new baseline; the identity logs differ only in their provenance block); the U512-H RPG world (59 to 60); and the row-8 lifecycle evidence. The S4c C2 pad-witness and row-8 one-frame movements it recorded against S4b C2 are in section 16.
The S1c control tally is **155 runs (27 controls): 143 caught as declared, 12 passing as declared, 0 not as declared** (S4c C2: 147, 25, 135, 12): the 8 extra runs are the 8 new controls (`split-bank-restore-lost` and `split-lc-skip-warp`, each on MMC3-V and MMC3-H, RPG resident and banked), and the session runs add no stamps of their own (a row-8 RPG stamp is the plain run plus part A plus part B: 26 stamps = 4 positives, 8 new controls and the 14 existing split controls on RPG banked; 197 `s1c-run` stamps in all, S4c C2: 189). Rows 5 and 6 were produced by logs byte-identical to S4c C2's, so every certified margin, bound W, observed minimum and row 6's least margin (278.0) are S4c C2's (and S4b C2's, S4a C2's, S3 C2's and S2 C3's) for all 18 builds, and the largest measured `G` (20,026) is unchanged.

Before S4c C2 the current certificate was S4b C2's (matrix `s4b-c2-provenance-final`, 2026-10-13 21:50 to 23:26 PDT, baseline `19ea33c`, 248-entry fingerprint, 377 jobs, 1,785 stamps, UNROM 512 action on the lifted tree), with the same totals and table as S4c C2 (section 8).

Before S4b C2 the current certificate was S4a C2's (matrix `s4a-c2-provenance-final`, 2026-10-13 11:49 to 13:14 PDT, baseline `9b00c59`, 248-entry fingerprint, 377 jobs, 1,785 stamps, MMC1 and UNROM 512 action on the lifted tree), with the same totals and table (section 8); S4b C2 differed from it in the baseline, the MMC1 action trees (unlifted), 29 identity-log provenance blocks and 19 row-8 control logs that moved by one frame.

Before S4a C2 the current certificate was S3 C2's (matrix `s3-c2-provenance-final`, 2026-10-13 05:44 to 07:12 PDT, baseline `aaa678a`, 247-entry fingerprint, 377 jobs, 1,785 stamps, every ring cell on a lifted tree), with the same totals and table (section 8).

Before S3 C2, the S2 C3 certificate (matrix `s2-c3-provenance-final2`, 2026-10-12, baseline `cd7a9f8`, 383 jobs, 1,809 stamps, 250-entry fingerprint, vertical rows on production trees and horizontal rows on the prototype trees), which
section 8 describes as stale for the door landing-default fix and which stays intact as the historical record, was the current one; S3 C2 replaced it. Before it, a first S2 C3 attempt (2026-10-11, directories `s2-c3-provenance-final` and `s2-c3-logs-final`) exited 1 on two scheduling defects, not on any cell: the harness scheduled
`nmi-wrap-row-32` on the vertical cells, which have no form of it (fix 3 makes the control N/A there, printed under "control N/A proofs"), and the no-flag checks compared against baselines recorded before C2 (fixes 3 and 4,
section 2.4). The S1c certificate (matrix `s1c-provenance-final`, 2026-10-07, 386 jobs, 1,821 stamps, on the prototype trees) had the same totals. What S3 C2 differed in from S2 C3: six fewer jobs (383 to 377: the six horizontal
`nmi-strip-len-30-vertical` and `nmi-wrap-col-30` runs, equivalent mutants on a ring whose `SW_RING_COL_LEN` is already 30) and 24 fewer stamps (1,809 to 1,785: those six runs and the 18 identity builds of the two retired horizontal sabotage forms, all built), so **147 S1c control runs (25 controls): 135 caught as declared, 12 passing as declared, 0 not as
declared** (S2 C3: 153, 135, 18; S1c: 156, 135, 21); the horizontal stamps' tree kind (`prototype-horizontal` with null evidence at S2 C3, `production-horizontal` with evidence at S3 C2 and now); the no-flag check against `noflag/s1b-aaa678a.json` instead of `s1b-cd7a9f8.json` (section 10); and measured
quantities that moved by one frame or one body (row 8's measured-frame counts were one higher on five of the six MMC3 cells, and one Mesen body count in the `pad-mainline-over` MMC3-H witness was 374 against 375). Rows 5 and 6 were produced by byte-identical logs, so every certified margin, bound W and observed minimum, and row 6's least margin of 278.0, were those of the S2 C3 certificate for all 18 builds, **the horizontal cells included**: the production horizontal engine is line for line the prototype patch that S2 C3 measured, so no horizontal margin change was expected and none occurred. The
largest measured `G` (20,026) was unchanged, and is now.

| Row | Result | Figures (all on Mesen) |
|---|---|---|
| 1 identity | PASS, 18 buildable cells | static, emulator-independent |
| 2 workload | PASS with UNCERTIFIED items, both emulators | see below |
| 3 oracle | PASS, both emulators | |
| 4 mainline `G` | measured `G` PASS, class bounds UNCERTIFIED | the largest measured `G` over the classes C1 to C4c and their variants is 20,026 cycles (UNROM 512 horizontal action; S2 C3 and S4c C2: 20,026; S1c: 20,033) against the gate 29,780; the forced-blank C0 class is exempt and not counted; the UNROM 512 horizontal RPG cells at 60 rows peak at 19,427 (resident) and 19,423 (banked), class C3a |
| 5 NMI deadline | PASS on 18 buildable cells; every certified margin positive | tightest **certified** margin 33.67 cycles (mixed) and 115.67 (strip), MMC3-H RPG banked; tightest **observed** margin 90.0 (mixed) and 186.0 (strip), the same build; every certified margin, bound W and observed minimum is identical to the S3 C2 and S2 C3 certificates' (the horizontal cells moved from prototype to production code at S3 C2, the MMC3 action cells from a lifted to an unpatched tree at S4a C2, the MMC1 action cells at S4b C2, the UNROM 512 action cells at S4c C2 and every RPG cell at S5 C3 (the lift retired), with no change); against S1c five observed minima differ by 1 to 2 cycles (below) |
| 6 close | PASS on 18 buildable cells | vertical 88 bytes (`vram_len` 87) split, horizontal 85 bytes (`vram_len` 84) in one packet; least margin 278.0 cycles (MMC3 vertical action resident, on an unpatched tree; the same as S4c C2, S3 C2 and S2 C3; S1c: 277.0, MMC3 vertical RPG resident) |
| 7 decoded seam | PASS on jsnes; Mesen N/A | see "Limits" |
| 8 MMC3 split and lock | PASS on the 6 MMC3 buildable cells: 13 items on an action game, 15 on an RPG (the two lifecycle items, section 19) | plain run: 1,550 to 2,104 measured frames (equal to S4c C2's, S4a C2's and S2 C3's; S3 C2: 1,551 to 2,105), 389 to 603 `switch_prg_bank` calls and 1,261 to 1,748 split IRQs per cell (the last two unchanged); on an RPG additionally the session: part A 851 (MMC3-H) / 870 (MMC3-V) frames, 752 / 753 measured, 658 / 855 calls, 626 to 629 IRQs, part B 223 / 231 frames, 140 measured |
| 9 controls | 155 S1c control runs (27 controls): 143 caught as declared, 12 passing as declared (a declared non-catch on the other axis), 0 not as declared | plus the S1a and S1b controls; the four `prg-transient` runs are caught; `nmi-wrap-row-32` is N/A on the three vertical action resident cells and `nmi-strip-len-30-vertical` and `nmi-wrap-col-30` on the three horizontal ones (no form on that ring, equivalent mutants), whose row 9 is `P/N` |

Row 5 per build. "Observed" is the minimum margin to the end of vblank over every recorded interrupt (it contains the measured entry delay, at most 10.7 cycles). "Bound W" is the static longest path of the build's
own `nmi` handler; the **certified** margin is 2,272.67 − (22 entry + W + 6 `rti`). The two are recorded separately and never added. Cells: strip / mixed.

| cell | build | observed margin | bound W | certified margin |
|---|---|---|---|---|
| MMC1-V | action resident | 277.0 / 171.0 | 2030 / 2120 | 214.67 / 124.67 |
| MMC1-V | RPG resident | 277.0 / 171.0 | 2030 / 2119 | 214.67 / 125.67 |
| MMC1-V | RPG banked | 271.0 / 168.0 | 2049 / 2130 | 195.67 / 114.67 |
| MMC1-H | action resident | 258.0 / 127.0 | 2042 / 2164 | 202.67 / 80.67 |
| MMC1-H | RPG resident | 257.3 / 159.0 | 2042 / 2132 | 202.67 / 112.67 |
| MMC1-H | RPG banked | 250.0 / 154.0 | 2063 / 2145 | 181.67 / 99.67 |
| MMC3-V | action resident | 213.0 / 107.0 | 2096 / 2185 | 148.67 / 59.67 |
| MMC3-V | RPG resident | 213.3 / 108.0 | 2096 / 2185 | 148.67 / 59.67 |
| MMC3-V | RPG banked | 207.0 / 104.0 | 2115 / 2196 | 129.67 / 48.67 |
| MMC3-H | action resident | 193.0 / 95.0 | 2108 / 2198 | 136.67 / 46.67 |
| MMC3-H | RPG resident | 193.0 / 94.0 | 2108 / 2198 | 136.67 / 46.67 |
| MMC3-H | RPG banked | **186.0 / 90.0** | 2129 / 2211 | **115.67 / 33.67** |
| U512-V | action resident | 277.0 / 171.0 | 2030 / 2119 | 214.67 / 125.67 |
| U512-V | RPG resident | 277.0 / 171.0 | 2030 / 2119 | 214.67 / 125.67 |
| U512-V | RPG banked | 271.0 / 168.0 | 2049 / 2130 | 195.67 / 114.67 |
| U512-H | action resident | 258.7 / 158.0 | 2042 / 2132 | 202.67 / 112.67 |
| U512-H | RPG resident | 257.3 / 158.3 | 2042 / 2132 | 202.67 / 112.67 |
| U512-H | RPG banked | 250.3 / 155.3 | 2063 / 2145 | 181.67 / 99.67 |

The table above equals the S4c C2, S4b C2, S4a C2, S3 C2 and S2 C3 certificates' cell for cell (computed by `handoff-next/s5-c3/final_checks.mjs` from the stamps and logs: 18 positives, 14/14 items each, all certified margins positive, 0 cells differing from S4c C2's table; the 12 RPG cells are now measured on unlifted code, with no figure moved; these scenes run at N = 4, so the 60-row project supplies the S1b rows 2, 4 and 7 of the U512-H RPG pair and not these). Relative to the S1c certificate only the observed column of five action resident builds moved (strip / mixed; S1c in parentheses): MMC1-H 258.0 / 127.0 (259.0 / 126.0), MMC1-V 277.0 / 171.0 (277.0 / 170.0), MMC3-H 193.0 / 95.0
(194.0 / 94.0), U512-H 258.7 / 158.0 (257.0 / 159.0) and U512-V 277.0 / 171.0 (277.0 / 172.0). Every bound W and certified margin is unchanged, so the tightest certified margin is still 33.67 cycles (mixed), MMC3-H RPG banked, and the
observed minima are sampled over the recorded interrupts, not bounds. Row 6 moved the same way: ten of the 18 builds differ from S1c by 1 to 2 cycles (the least is now 278.0). The differences were not traced to a single cause.

## 4. Declared UNCERTIFIED (option A, Chris)

These pass nothing; the gate prints them as `UNCERTIFIED`, never PASS, and no distance from the gate derived from them may be quoted as headroom.

1. **`bound:certification`.** The class bounds are not proved: the remainder, the per-pass entity draw and the releasing NMI of every class are
   sampled maxima over the bodies the witness specs produced.
2. **`bound:<class>`** (C1, C1s, C2, C3a, C3b, C3s, C4a, C4b, C4bw, C4c). Each is a composed estimate, never PASS.
3. **`bound:CB`**, the battle class, on every RPG build.
4. **`agree:dsp`.** The cross-core equality of the entity draw's park-split counter `dsp` is not established. Only the per-emulator range guard
   `sanity:dsp` holds, so an in-range wrong or dead `dsp` hook in either emulator is not detected.
5. **`agree:chase`** in the horizontal cells (MMC1-H, MMC3-H and U512-H; action resident, RPG resident and RPG banked: nine builds). The
   damaging-chaser pursuit leaves lockstep between the two cores, so a jsnes counter that disagrees with Mesen there is not detected.

What is certified in spite of this: the measured Mesen `G` of every class against `G < 29,780` (strict), the per-class read counts, the exhaustive
read-price sweeps, the coverage conjunctions and the decoded seams.

## 5. Limits of this proof (rulings recorded: S1c reviews 1 and 3 and the S1c certificate review)

- **Row 7 on Mesen is N/A.** The seams are decoded from jsnes state only; Mesen runs the same two seam specs to their end and their bodies are
  compared with jsnes's, but no Mesen-side decode exists. Accepted as N/A by S1c reviews 1 and 3: jsnes supplies the decoded-seam evidence and no
  Mesen-side decode is claimed.
- **Rows 5, 6 and 8 on jsnes are not measured.** Mesen is the authoritative deadline and split measurement and this slice has no jsnes timing recorder. The
  vendored core does track the PPU at dot granularity (`ppu.advanceDots`), so a recorder is possible in principle; none exists and its agreement with Mesen
  would itself need certifying. For row 8 the core also clocks its MMC3 IRQ counter at scanline boundaries (`clockIrqCounter`), not on A12 edges, so the split
  IRQ line and register-write timing are an approximation there. No claim of hardware impossibility is made.
- **Row 5: what the static bound closes and what stays open.** Closed for the 18 fixed builds (the ring scenes, no Code Forge override of an NMI-path file, no Fade/Flash block, no camera shake): other
  offsets and chunk placements, every admitted queue, the armed and the locked `split_arm` tail without the poke, the interrupted-instruction latency and the quadrant sequences. Music is not part of this: it runs in
  `main_loop` (`engine/boot.asm:191`), not in the NMI.
  - *The queue.* `vram_drain` costs 34 cycles per packet, 15 per data byte and 23 for the terminating fetch, so a queue of k packets and d data bytes costs `34k + 15d + 23` **in the no-branch-page-penalty case**, with
    `3k + d <= 35`; the worst admitted queue is one 32-byte packet, 537 cycles. That is the case in 16 of the 18 builds. Two builds have a branch-page penalty in the assembled drain and are exceptions: the **MMC1-V
    action resident** build has base 24 and a 538-cycle maximum, and the **MMC1-H action resident** build has `24 + 33k + 16d` and a 569-cycle maximum. The static walk reads these from each build's own bytes.
  - *The entry allowance.* 22 cycles are charged once: the instruction in flight, one more instruction at a polling boundary, the seven-cycle interrupt sequence and one cycle of phase. A late NMI during an IRQ or
    BRK sequence finishes the remaining sequence and executes the first handler instruction before NMI entry (at most 7 + 7 + 7), which still fits; the whole IRQ handler is not charged. This is an inference from the
    documented interrupt sequencing, not an emulator measurement, and **not** an engine-wide guarantee over arbitrary IRQ/NMI collision schedules.
  - *No MMC3 IRQ in service at the NMI edge* is argued for the scoped row-5 scenes by source, **not** by row 8: the box program is `[191, 1, 0]`, so the visible-frame IRQ fires around scanline 192; the ordinary
    row-5 build has the stock 60-cycle `switch_prg_bank` (not row 8's delay harness) and no enabled save or flash critical section; the longest IRQ handler path is 85 cycles including `rti`; that is far shorter than
    the roughly 49 scanlines to the vblank edge. Row 8's `r8:arm-deadline` checks the last NMI arm write, not IRQ completion, and row 8 deliberately stretches the interrupt-mask windows, so it is no evidence for
    this. It is a fixed-scene exclusion.
  - *Open:* (1) **another project's build**, or a Code Forge override of an NMI-path file, has a different bound and is outside the certificate until the same judge runs on it; (2) the budget facts (chunk, wrap,
    quadrant alternation, the ring's own axis, a packet count of at least 1, the 35-byte queue) are argued from the source and checked by observation and the assembled constants, not proved for arbitrary Code Forge
    overrides or malformed queues; (3) the cycle table is the documented NMOS one and the vblank is NTSC scanlines 241-260 with the last legal dot (260, 340); PAL and Dendy are excluded. These are open, not N/A.
  - *Opcode costs are pinned (S2 C3).* The S1c certificate was produced when `s1c_unit.mjs` did not pin every opcode's absolute cost (a deliberately wrong PHA base cost, 3 changed to 2 in memory, passed all 116 of its tests); the submitted
    cost table was correct. `s1c_unit.mjs` now restates the documented NMOS timing rules independently and compares every entry of `OPCODES` with them, plus explicit PHA, PLA, PHP, PLP, RTI, RTS and JSR costs and a hand-assembled PHA/PLA path.
- **Row 8, one control is scoped.** `prg-r7-wrong` (R6/R7 permanently corrupted) is run on the action resident build only. On the RPG banked build a
  permanently wrong R7 runs the battle overlay out of the wrong window and the run does not finish (Mesen timeout, exit 99), which is not a sound run
  and so cannot count as a catch. `prg-transient` (wrong values committed and restored before the routine returns) completes on both builds and both MMC3
  axes and is caught on `r8:prg-group` and `r8:prg-window`. The other split controls run on both builds.
- **Row 8, `r8:prg-window` is weak on a one-bank world.** On a cell where only one bank value is ever called (every MMC3 vertical cell), a misdirected
  R6/R7 write rewrites an equal value and only `r8:prg-group`, `r8:terrain` and the lock items can see it.
- **The legacy close template keeps its fixed length.** With the `--ring` flag absent the close builder's output must be byte-identical to what it
  was, so its old section still carries the constant 87; the ring sections have no fixed length. That byte-identity is checked against the tracked cd7a9f8 baselines (section 2.4).
- **Sabotage 6 is interpreted.** "The split IRQ left armed across the strip" is implemented as the IRQ handler leaving the line enabled when its
  program ends, and is caught by the IRQ count and grammar items.

## 6. Where the proof lives

`test/lua/run_sw_ring_gate.sh` prints the table from a certificate. `test/lua/ring_gate/run_matrix.mjs` produces the certificate;
`test/lua/ring_gate/ringjobs.mjs` is its job list and `test/lua/ring_gate/s1ccontrols.mjs` its control table. The harness's own unit tests are
`iso_unit.mjs`, `judge_unit.mjs`, `prov_unit.mjs`, `s1b_unit.mjs`, `record_controls.mjs` and `s1c_unit.mjs` in the same directory.
`docs/design-streamed-worlds-phase3a.md` records the shelved handover window; `docs/design-streamed-worlds.md` is the current-state design.

## 7. Slice S2, commit C2: the vertical ring in the shipped engine

C2 carries the certified prototype's vertical semantics into production behind `STREAM_RING` (`docs/reference-engine.md`, "The vertical ring"),
still unreachable for a user: `validateProject` refuses every two-nametable streamed board and the generator refuses the horizontal mode. Decisions
and deviations from the prototype patches (`test/lua/ring_gate/02-ring-engine.patch`):

- **The row-strip forks are not shipped.** The prototype's `SW_RING_ROW_LEN`, `sw_ring_row_*` labels and the 32-wide shadow wrap belong to the
  horizontal ring (slice S3); a vertical ring has no row strip, so `STREAM_RING = 1` builds none of them.
- **`SW_RW_NT_STEP` stays an `adc`**, the prototype's form, so slice S3 changes only the constants (3 bytes of kernel-hi, measured, on every board).
- **Selection** is `streamRingMode`/`projectStreamRing`, not the prototype's inline mapper test; the generator refuses mode 2 with a message naming
  the Build panel.
- **Evidence** is the prototype's own scenes, interpreter and judge run against the production engine through a test-only bypass copy, plus the
  PPU write trace (no `$28xx`/`$2Cxx` write) the judge cannot see because it reads through the mirror. The sabotages and the file that catches each
  are in `handoff-next/s2-c2/sabotage.log` of the round-1 report; C3 rebaselines the ring gate onto C2 (section 2.4, "Two ring trees") and re-runs S1's cells,
so the vertical rows certify the production vertical ring at C2.

## 8. Certificate history: the S2 certificate stale for the door landing-default fix (2026-10-12), the S3 C2 certificate that replaced it, the S4a C2 certificate that replaced that, the S4b C2 certificate that replaced that, the S4c C2 certificate that replaced that, and the S5 C3 certificate that replaces it (2026-10-15)

The S2 certificate (S2 C3, reviewed at `6322c22`) is intact as a historical record but was **stale for the commit that gives a placed door's landing coordinates a default**
(`DOOR_LANDING_DEFAULT` in `shared/project.js`, read by `generate.js` and `streamed.js`; those files are in the ring harness fingerprint). On the tree after that fix
the recorded hashes of the archived S2 index verified intact, and `ringprovindex.mjs --verify` passed on it with the harness of that time (under today's S4a C2 harness it reports tree-provenance problems only, no INDEX hash failure, because the S2 trees are prototype-horizontal at baseline `cd7a9f8`), but `run_sw_ring_gate.sh` reported GATE FAIL on fingerprints only: 1803 stale-fingerprint
stamps, 0 FAIL or UNMEASURED cells, 0 unexpected jobs, 0 audit problems. By Chris's ruling of 2026-10-12 those stamps were not restamped and the fingerprint was
not weakened; the directories `s2-c3-provenance-final2` / `s2-c3-logs-final2` still hold exactly what they held, and the 1,803-stale-stamp result is the property of that old index, not of the current tree. S3's final matrix recertified: the **new production certificate** of section 3
(`s3-c2-provenance-final`, baseline `aaa678a`, 247-input fingerprint) carries the door default, the production horizontal ring and the S3 C2 harness, and gives a current `GATE PASS` on this harness and baseline. The two certificates must not be
mixed: the S2 one is evidence for `cd7a9f8` with prototype horizontal trees; the S3 one is evidence for `aaa678a` with production trees on both rings, and was the only one a reader could cite for the horizontal ring until S4a C2 (next paragraph). Declared limits carry over unchanged: the 54 UNCERTIFIED cells are Chris's option A items (section 4), the limits of section 5 apply, and the RULE-A boundary of section 10 stands (the S1b no-flag check
compares against C1 production output, so it cannot discover a regression already present in `aaa678a`). The no-flag baselines (`s1b-aaa678a.json` active for S1b with `s1b-cd7a9f8.json` kept unchanged as history, `s1c-cd7a9f8.json` active for S1c, section 10) and the pinned identity ROM hashes keep their historical bytes: the test builders that model inert NPCs write `toX: 0, toY: 0`
explicitly, so only a placement that leaves the fields out takes the new default.

**The S3 C2 certificate is history too (S4a C2, 2026-10-13).** S4a C1 changed `shared/` (admission) and the gate's baseline, lift patch, sabotage patches and tree maker moved with it, so the harness fingerprint is a different 248-entry one. The S3 C2 index (`s3-c2-provenance-final`, `s3-c2-logs-final`) is intact (its recorded hashes still check: zero INDEX hash failures) and
current strict `ringprovindex.mjs --verify` rejects its old provenance (exit 1, 18,872 tree-provenance problems, the first a baseline mismatch against `9b00c59`), and `run_sw_ring_gate.sh` on it reports GATE FAIL on fingerprints and baseline (1,779 stale-fingerprint stamps, 18,872 audit problems against this harness's baseline, 0 unexpected jobs), as the S2 index did. By the same ruling nothing was restamped and the fingerprint was not weakened.
The S4a C2 certificate (`s4a-c2-provenance-final`, baseline `9b00c59`, 248-input fingerprint, `GATE PASS`) was the current one from there until S4b C2; the S3 one is evidence for `aaa678a`, where MMC3 was refused for every game type, and the MMC3 action cells' evidence came from unpatched production code. Declared limits carried over unchanged: the 54 UNCERTIFIED cells (section 4), the limits of section 5, and the RULE-A boundary of section 10, which read against `9b00c59`: the S1b no-flag check
compares against C1 production output of `aaa678a` and the S1c one against `cd7a9f8`, so neither discovers a regression those baselines carry (both no-flag precheck jobs passed byte for byte against `s1c-cd7a9f8.json` and `s1b-aaa678a.json`, so no re-record was needed).

**The S4a C2 certificate is history too (S4b C2, 2026-10-13).** S4b C1 changed `shared/` (admission of MMC1), so the gate's baseline, lift patch, sabotage patches and tree maker moved again and the harness fingerprint is a different 248-entry one. The S4a C2 index (`s4a-c2-provenance-final`, `s4a-c2-logs-final`) is intact (its recorded hashes still check: zero INDEX hash failures) and
current strict `ringprovindex.mjs --verify` rejects its old provenance (exit 1, 16,609 tree-provenance problems, the first a baseline mismatch against `19ea33c`, and the rest including MMC1 action trees that carry the lift although production now admits them), and `run_sw_ring_gate.sh` on it reports GATE FAIL (54 FAIL/UNMEASURED cells, 16,609 audit problems against this harness's baseline, 1,779 stale-fingerprint stamps, 0 unexpected jobs), as the S3 index did at S4a. By the same ruling nothing was restamped and the fingerprint was not weakened.
The S4b C2 certificate (`s4b-c2-provenance-final`, baseline `19ea33c`, 248-input fingerprint, `GATE PASS`) was the current one from there until S4c C2: its MMC1 and MMC3 action cells come from unpatched production code, and its totals and table are S4a C2's, cell for cell. Declared limits carry over unchanged: the 54 UNCERTIFIED cells (section 4), the limits of section 5, and the RULE-A boundary of section 10, which now reads against `19ea33c`: the S1b no-flag check
compares against C1 production output of `aaa678a` and the S1c one against `cd7a9f8`, so neither discovers a regression those baselines carry (both no-flag jobs passed byte for byte again, in the pilot and in the matrix, so no re-record was needed).

**The S4b C2 certificate is history too (S4c C2, 2026-10-14).** The harness now pins `bb43a2c`, so the current gate reports GATE FAIL on `s4b-c2-provenance-final` (15,900 audit problems, the first a baseline mismatch against `bb43a2c`; 1,779 stale-fingerprint stamps; 0 unexpected jobs; `handoff-next/s4c-c2/gate-of-s4b-certificate-under-s4c-harness.out`), as every earlier index did. Nothing was restamped and the fingerprint was not weakened. The certificate that replaced it was S4c C2's (`s4c-c2-provenance-final`, baseline `bb43a2c`, 248-input fingerprint, `GATE PASS`): all six action cells (MMC1, MMC3 and UNROM 512, V and H) come from unpatched production code, its RPG cells from the `ringGame`-only lift, and its totals and table are S4b C2's, cell for cell. Declared limits carry over unchanged: the 54 UNCERTIFIED cells (section 4), the limits of section 5, and the RULE-A boundary of section 10, which now reads against `bb43a2c`: the S1b no-flag check compares against C1 production output of `aaa678a` and the S1c one against `cd7a9f8`, so neither discovers a regression those baselines carry (both no-flag jobs passed byte for byte in the precheck, the pilot and the matrix, so no re-record was needed).

**The S4c C2 certificate is history too (S5 C3, 2026-10-15).** S5 C2 admitted a streamed RPG on every ring board and the harness now pins `f3833db` with no lift, so the current gate reports GATE FAIL on `s4c-c2-provenance-final` (13,021 audit problems, the first a baseline mismatch against `f3833db`, and 1,021 of its stamps (the 1,009 RPG stamps and 12 ring-0 records) list a lift that production no longer takes; 1,779 stale-fingerprint stamps; 56 FAIL/UNMEASURED cells; 8 unexpected jobs, the row-8 controls it never ran; `handoff-next/s5-c3-final-checks/gate-of-s4c-certificate-under-s5-harness.out`; the INDEX hashes still verify), as every earlier index did. Nothing was restamped and the fingerprint was not weakened. The **current certificate** is section 3's (`s5-c3-provenance-final`, baseline `f3833db`, 250-input fingerprint, `GATE PASS`): no cell on either game type carries a patch, the U512-H RPG cells run at 60 rows (certified, section 19), the row-8 lifecycle evidence is part of the MMC3 RPG cells, and its totals are **146 / 54 / 232 / 0 / 0** (S4c C2: 144 / 54 / 234 / 0 / 0; the two row-9 cells of MMC3 RPG resident gained a control). Declared limits carry over unchanged: the 54 UNCERTIFIED cells (section 4), the limits of section 5, and the RULE-A boundary of section 10, which now reads against `f3833db`: the S1b no-flag check compares against C1 production output of `aaa678a` and the S1c one against `cd7a9f8`, so neither discovers a regression those baselines carry (both no-flag jobs passed byte for byte in the precheck and the matrix, so no re-record was needed).

## 9. Slice S3, commit C1: the horizontal ring in the shipped engine

C1 carries the prototype's horizontal half (the then-current `02-ring-engine.patch`, `03-player-far-branch.patch`; retired at C2, section 10) into production as `STREAM_RING = 2`
(`docs/reference-engine.md`, "The horizontal ring"). It is still unreachable for a user: `validateProject` refuses every two-nametable streamed board
(S4 lifts that), so the horizontal ring runs only through the test-only bypass copy. Section 7's statements that the generator refuses mode 2 and that the
row-strip forks are not shipped describe C2 and are history: the generator refusal is gone and the row forks are in. What production does against the prototype patches (`01-ring-select.patch`, `02-ring-engine.patch`, `03-player-far-branch.patch`):

- **The ring code is the prototype's, not a deviation from it.** The production diff of `engine/streamworld.asm` is exactly the hunks of
  `02-ring-engine.patch` for that file (compared line by line in fix round 1), and `generate.js`'s ring edits are `01-ring-select.patch`'s: selection
  through `streamRingMode`/`projectStreamRing`, the deleted mode-2 generator refusal, `SW_RING_ROW_LEN` and `SW_RW_NT_STEP`. So the three row forks guarded
  by `.if STREAM_RING` (non-zero, with `SW_RING_ROW_LEN` emitted as 32 on mode 0 and mode 1, which is what keeps a vertical ring's row sites at the torus
  literals and its ROM byte-identical to the one `803a252` built), the `SW_RW_NT_STEP` (2 on mode 2, 1 otherwise) and `SW_RW_NT_END` (2 on mode 1, 4 on mode 0
  and 2) values, and the labels `sw_ring_row_cmp`, `sw_ring_row_len` and `sw_ring_wrap_row` (which a test reads back out of the assembled ROM; the wrap
  compare is unreachable at run time on a 1 x N world, so the operand readback is its only pin) are all the prototype's. (The first round-1 report listed
  selection, the non-zero guard and the labels as deviations; against these patches they are not.)
- **The real differences** are: the far-branch comment (below) and the explanatory comments in `generate.js`; `validateProject`'s refusal is kept (the
  prototype's `00-refusal-lift.patch` is not applied; admission is S4's), so the horizontal ring runs only through the test-only bypass copy; `engine/streamdialog.asm`
  is untouched (as in the prototype, whose patches touch only `player.asm`, `streamworld.asm`, `generate.js` and `shared/project.js`); and what C1 adds around
  the code (the allowance, the tests, the sabotages, the certificates).
- **The far branch** (`engine/player.asm`, the `cross_left_cut` tail) sits under `.if STREAM_RING` nested inside the existing `.if !CAMERA_SLIDE_H`,
  with the comment the prototype lacked, and only at the one site the prototype demonstrated. Every cell (3 boards x 2 game types) assembles; an
  unfixed near branch is rejected by nesasm, which `streamringh.test.js` asserts. Torus and vertical builds keep the plain `beq`. The branch runs on an
  ORDINARY screen of a mixed project, so its condition is pinned by `streamringhfar.test.js` (an ordinary screen with a left neighbour crosses, one with none
  is blocked) and the `h-far-branch-inverted` sabotage; every other horizontal test walks streamed screens and passes with the condition reversed.
- **Byte identity** of the vertical ring and the four-screen torus: `handoff-next/s3-c1/vertical_identity.mjs` compares `803a252` with this tree on 138
  projects, **132 mode-1 builds plus 6 mode-0 controls**, the projects the S2 unit-test builders construct (laps, strips, seams, redraw paths, battle,
  landings, dialogue, kernelbytes shapes, close frames), all byte-identical, with a negative control that differs. It does **not** cover the ring gate's
  `run_s1b.mjs` workloads (`prepareRing` maximum-depth scenes, Move, bound-tile and chaser variants); nothing here claims those recipes. The four-screen
  ROMs are covered by the 11,760-record certificate below.
- **Allowance.** `STREAMWORLD_RING_H_KERNEL_ALLOWANCE` = 3 (kernel-lo, the far branch) and `STREAMWORLD_RING_H_KERNEL_HI_ALLOWANCE` = 0, charged on
  `projectStreamRing === 2` only, on top of the shared ring fork. A horizontal build cannot assemble with `STREAM_RING` forced to 0, so the cost is measured
  in two halves (`kernelbytes.test.js`): the engine forks against the same project with the ring forced to 0 and the far branch forced on, and the far
  branch alone on a non-streamed horizontal camera build. Free after C1 (kernel-hi / kernel-lo): MMC1 action 2673 / 1752, rpg 1442 / 1428; MMC3 action
  2673 / 1731, rpg 1442 / 1239; UNROM 512 action 2673 / 1560, rpg 1442 / 1233. The absolute check (`assertCovers`, on the shipped horizontal ring itself) holds
  a 22-byte margin on every cell: actual / reserved kernel-lo code bytes MMC1 action 5999 / 6021, rpg 6323 / 6345; MMC3 action 6020 / 6042, rpg 6512 / 6534;
  UNROM 512 action 6188 / 6210, rpg 6512 / 6534.
- **Evidence** reuses the S2 machinery with no parallel oracle: the prototype scenes, interpreter and judge (`ringscene`, `ringredraw`, `ringdialogue`,
  `ringrun_jsnes`, `ringjudge`) against the production engine through `ringbypass`, now ring-aware (live indices, alias range `$24xx`/`$2Cxx`). The close
  frame is captured under jsnes at `main_loop_ready` (`test/lib/ringcloseframe.js`): five packets, `vram_len` 84, against the vertical ring's split 87.
  Eleven `h-*` sabotages join `run_ring_sabotage.mjs`; each fails a horizontal test file.
- **Not done here** (C2 and later; C2 round 1 rebaselined the gate onto C1, section 10): the full matrix, the bound-curve sweep, the validate lift, RPG admission. The ring
  certificate of section 8 was stale at that point (C2's final matrix recertified it, section 3); C1 adds a new four-screen ROM-identity certificate (`test/fixtures/identity-cert/s3c1-horizontal.json`, 11760 of
  11760 records) and refreshes `test/fixtures/crossstage/exclusions-evidence.json` (only `prov.new.engine` and `prov.new.generator` change).

## 10. Slice S3, commit C2: the ring gate rebaselined onto production C1 (round 1)

C2 is harness-only (`test/lua/`, `test/unit/` ring files, `run_sw_ring_gate.sh`, docs): nothing under `engine/`, `main/` or `shared/` changed.

- **Baseline.** `BASELINE` = `aaa678a1a9c627a2306e083ca3ac298c349cb1fa` (S3 C1). `regen_patches.mjs` regenerates `00-refusal-lift.patch` against it (every anchor, the end
  anchor included, asserted to match exactly once); the patch only moved by an offset. Patches: `00-refusal-lift.patch` **kept** (re-cut, offset only; it must apply and change
  `shared/project.js`); `01-ring-select.patch`, `02-ring-engine.patch`, `03-player-far-branch.patch` **retired** (section 2.4); sabotage forms: 5 ring-2 forms re-cut, 16 ring-1 forms re-cut, the rest unchanged (round 1; fix 1 below retires two horizontal forms).
- **Production-horizontal proof.** The horizontal cells now build `treeKind: production-horizontal` trees with the exact-content proof and consumed-input evidence of the vertical
  cells (section 2.4): one generalized mechanism (`verifyProduction`, `expectedContent`, `provenanceFor`, `TREE_KIND`), not a parallel copy. This closes S2 C3 review 3's deferred item
  "ring 2 has no exact-content or consumed proof". Horizontal ROMs now come from production code; `ringbypass` supplies only the refusal lift.
- **S1b no-flag baseline (RULE-A).** C1's generator writes the geometry equate `SW_RING_ROW_LEN` (32 outside mode 2) into `config.inc` for every ring mode, and the scene builders list
  equates in `symbols.json`, so all 11 S1b configurations' symbol hashes changed while their ROM, rendered Lua and project hashes did not (the precheck `s1b-noflag` failed on exactly
  those 11 `symbols.json`). The re-record: `noflag/s1b-aaa678a.json` is the unmodified committed recorder's output from a clean `git archive` of the full aaa678a hash; the same command at
  cd7a9f8 reproduces `noflag/s1b-cd7a9f8.json` byte for byte (that file is kept unchanged as history, pinned by hash, and is a required fingerprinted input because `prov_unit.mjs`
  reads it). Continuity proof: same configuration and artifact key sets; 44 of 55 hash fields equal (every `project`, `rom`, `scene.nes`, `manifest.lua`); the ROM and Lua bytes
  compare equal; each `symbols.json` differs by exactly `ram.SW_RING_ROW_LEN = 32`, the serialized bytes equal after removing it. `s1c-cd7a9f8.json` stays the active S1c baseline (it still matches). **The boundary:**
  S1b's full-artifact check compares the current harness with C1 production output, so it cannot detect a regression already present in aaa678a; the entry-by-entry transition proof
  preserves the ROM/Lua/project continuity back to S2 C2 and documents the one symbol addition; the original-inertness evidence (5138c1f) and the engine/identity obligations are separate.
  The active baseline is a tracked, required, fingerprinted input; missing-input refusal and fingerprint sensitivity are unchanged.
- **Fix 1 (review round 1).** The review found two more equivalent mutants scheduled as ordinary controls: `strip-len-30-vertical` and `wrap-col-30` produce a horizontal ROM byte-identical to the
  positive on all three horizontal boards. Both are now ring-1-only (section 2.4): their horizontal patch forms are retired, `nmi-strip-len-30-vertical` and `nmi-wrap-col-30` are control-level N/A on the
  three horizontal cells, and the job and stamp expectations shrink accordingly (the fix-1 report holds the arithmetic). Whole-cell gate totals are unaffected: a cell is N/A only by its own rows.
- **Review round 2 and the final matrix.** The reviewer accepted the harness (matrix-ready on the diff of fix 1) and the ONE full matrix ran on exactly it (section 3): 377 jobs, 0 unexpected, 1,785 stamps, 0 problems, `GATE PASS`, 144 PASS / 54 UNCERTIFIED / 234 N/A / 0 FAIL / 0 UNMEASURED. Section 3's measured table and section 8's stale-certificate paragraph were
  rewritten from it. Nothing was restamped, no fingerprint was weakened and the S2 C3 directories are untouched. The declared UNCERTIFIED items, section 5's limits and the RULE-A boundary above are exactly as before.

## 11. Slice S4a, commit C1: the two-nametable ring admitted on MMC3, action games only

C1 is admission (`shared/`, `main/`, tests, docs): **no file under `engine/` changed**, and nothing about how a ring is built changed. What changed is that `validateProject` stops
refusing it for one board and one game type. Sections 7-10 say "`validateProject` still refuses every two-nametable streamed board"; that was true of each commit it describes and is
history from C1 on.

- **What is admitted.** An **action** project on **MMC3** with **horizontal or vertical** mirroring, with the dead-axis shape the mirroring allows (N x 1 under vertical, 1 x N under
  horizontal; the grid and dead-axis refusals are exactly as before). The decision is **one datum per registry entry**: `streamRingGameTypes` on the MMC3 entry of `shared/cartridge.js`
  (`['action']`), read through `streamRingBoardAdmitted(mapper, mirroring)` (a ring mirroring and a non-empty list) and `streamRingAdmitted(mapper, mirroring, gameType)`, next to
  `streamRingMode`. `streamedBoardProblems` asks those two and states no board or game type of its own, so S4b (MMC1) and S4c (UNROM 512) are one line each
  (`streamRingGameTypes: ['action']`) and S5 adds `'rpg'` to a list. The datum is per board because the two later slices are per board, and per game type because S5 is.
- **The refusals, before and after** (all in `streamedBoardProblems`, kind in brackets; `where` is the panel that fixes it):
  - board cannot stream at all [`capability`, Build]: "... cannot stream a world. Streamed maps need UNROM 512 with four-screen mirroring, or **MMC1, MMC3 or UNROM 512 with horizontal or
    vertical mirroring** -- change the board ..." became "... or **MMC3 with horizontal or vertical mirroring (action games)** -- ..." (MMC1 is no longer buildable, so it stopped being listed).
  - MMC1, or UNROM 512 non-four-screen [`capability`, Build]: "... which only reaches the two-nametable ring -- not implemented yet. Streamed maps need UNROM 512 with four-screen mirroring today ..."
    became "... -- not implemented yet **on this board**. Streamed maps work on **MMC3 with horizontal or vertical mirroring (action games) and on UNROM 512 with four-screen mirroring** ...". MMC3 is no longer refused by this.
  - **NEW** a streamed RPG on MMC3 (a board with a ring that does not admit the game type) [`ringGame`, Build]: "... is streamed in a turn-based RPG on MMC3 with vertical mirroring, which only
    reaches the two-nametable ring -- streamed RPGs are not implemented there yet. A streamed RPG needs UNROM 512 with four-screen mirroring today ..." Until S5. An RPG on MMC1 or UNROM 512 non-four-screen
    hits the board refusal above first (one message, not two); an RPG on UNROM 512 four-screen is untouched.
  - dead axis [`deadAxis`, Map Forge] and grid [`grid`, Map Forge]: unchanged, and now live on MMC3.
  Pinned in `docclaims.test.js` (T4, 13 entries): the narrowed capability refusal and the new `ringGame` refusal, each with the README sentence that names it.
- **`checkStreamedMapperSwitch` asks `ringGame` too.** Its tiers are now `capability`, `ringGame`, `deadAxis`, then the region count. `ringGame` is a property of the candidate board and the game
  type, exactly like `capability` (it does not depend on the grid), and it is the tier that stops the Build panel offering MMC3 to a streamed RPG; leaving it out would let the switch through to a
  project `validateProject` then refuses. The preflight and `switchableMappers` (which asks the preflight and `validateProject`) therefore never offer a refused board:
  `streamadmit.test.js` (d) checks every board x mirroring x game type x grid shape of the admission table against `streamedBoardProblems` after a reconcile.
- **`reconcileCartridge`, `checkCapacity`, `streamplacement.js`, `shared/streamlayout.js`: unchanged.** The Build panel's mirroring commit already reconciles in the same commit
  (`renderer/forges/build/build.js`, pinned at the source by `streamadmit.test.js` (d)); reconcile already moves a mirroring the new board lacks to `vertical`, which on MMC3 lands on an admitted ring.
  `streamedCapacityProblems` already counts regions per board, so the MMC3 figures below need no change.
- **Capacity, re-measured through the real path** (`handoff-next/s4a-c1/capacity.mjs`, `validateProject` + `checkCapacity` + a real `buildProject` of both sides of the boundary):

  | MMC3 action | largest that builds | smallest refused | refused by |
  | --- | --- | --- | --- |
  | vertical mirroring, N x 1 | **255** (the grid ceiling) | 256 | the grid ceiling (`LIMITS.streamedGrid`), "at most 255", Map Forge |
  | horizontal mirroring, 1 x N | **30** | **31** | `checkCapacity`: "The streamed maps need 31 of the 30 8 KB program regions MMC3 has free for world data", Map Forge |

  These equal the plan's scratch figures (30 action on a horizontal ring; the vertical ring builds to the grid ceiling). Pinned by `streamadmit.test.js` (the boundary builds, 1 x 30 and 255 x 1
  built, 1 x 31 refused) and, per board, by `streamedcapacity.test.js`' exact-fit-and-one-over table.
- **Saves (Chris's ruling 3).** A mirroring-only edit does not touch `saveCompatToken` (`reconcileCartridge` never draws it) and `saveIdentity` is unchanged; a resize still redraws it and changes the identity.
  Because MMC3's mirroring flips the dead axis, the only mirroring-only edits that leave an admitted project valid are those where **every streamed map is 1 x 1** -- an N x 1 map becomes refused
  when the mirroring flips (and says so, `deadAxis`). `streamadmit.test.js` (e) runs that case end to end: a 1 x 1 streamed MMC3 action project with a Title and a touch-triggered Saver is built on
  vertical mirroring; the player walks into the Saver (the battery RAM changes); the same project with only the mirroring changed is built; the saved battery RAM is carried into that ROM; Continue
  lands the player on the saved coordinates and both live nametables ($2000/$2800) and their attribute tables equal the independent oracle for the horizontal ring (`ringoracle.js` through the gate's
  judge); the control ROM with no carried save has no Continue. The 1 x 1 case is degenerate (the ring never scrolls), which is stated in the report as an open question, not widened.
- **Byte identity.** Every project that built at d1ed16f builds byte-identically: the six fixtures' ROM hashes equal `handoff-next/fixture-hashes-r4-before.txt` before and after
  (`fixture-hashes.mjs`), and the ring gate's own MMC3 action builds -- **98 scenes, both mirrorings**, every ring-gate scene id of `scenesFor(cell, 'action')` for `MMC3-V` and `MMC3-H`, resident placement,
  including the largest-N scenes -- build to the **same ROM bytes** from the C1 tree with no refusal lift as from a `d1ed16f` worktree with `00-refusal-lift.patch` applied
  (`handoff-next/s4a-c1/identity.mjs`, log `identity.log`: 98 EQUAL, 0 different). So admission is the lift and nothing else.
- **Certificates.** The generator fingerprint moved (`shared/` and `main/build/` changed; the engine did not, fingerprint `d5add2c0fc86` unchanged), so the four-screen ROM-identity certificate is renewed:
  `test/fixtures/identity-cert/s4a-c1.json` (`sw_identity_cert.mjs --dir=handoff-next/s2-c1/resweep`: **11760 of 11760** direct records matched, 832 reuses resolved, 0 mismatches; generator
  `4bef7ec98dec -> 7c8532f94749`, log `identity-cert.log`), and `test/fixtures/crossstage/exclusions-evidence.json` is refreshed by `refresh_sw_exclusions.mjs` (340 refusals, 340 parent receipts, 159 parent scenes
  by project+ROM identity, `--control=scene` refused as required; only `prov.new.generator` changed). `s3c1-horizontal.json` stays as history and `harnesstransfer.test.js` asserts its one stale binding (the generator).
- **What the production tests add.** `streamadmit.test.js` builds an admitted project through the real `cli.js` on both mirrorings (and shows MMC1, an MMC3 RPG and the wrong dead axis refused with no ROM
  written), builds the capacity boundaries, and runs a **lap of the ring on both mirrorings through `makeBypassTree({ bypass: false })`** -- a copy of the shipped tree with no refusal lift at all -- with the S2/S3
  oracle runner (terrain and attributes of both live nametables after every checkpoint, enter dialogues at every crossing, no alias write). The twelve sabotages of `handoff-next/s4a-c1/sabotage.mjs`
  are each caught (`sabotage.log`).
- **Not done here (C2 and later).** The ring gate is untouched: `BASELINE` is still `aaa678a`, `00-refusal-lift.patch` still lifts everything, nothing was restamped. C2 rebaselines it onto this commit,
  cuts the lift down to MMC1, UNROM 512 and RPG, and runs the one matrix with the MMC3 action cells on an unpatched production tree. MMC1 (S4b), UNROM 512 non-four-screen (S4c) and RPG (S5) remain refused,
  each with the message above.


## 12. Slice S4a, commit C2: the ring gate rebaselined onto C1, MMC3 action cells on unpatched production

C1 admitted the two-nametable ring on MMC3 for action games, so the old blanket refusal that `00-refusal-lift.patch` deleted is gone from production. C2 moves the gate onto that commit and
makes the lift a property of the **cell**, not of the gate. The MMC3 production table is at the end of this section and comes from the S4a C2 final matrix; section 3 now holds the S4b C2 certificate that replaced it (section 14), and the MMC1 production table is in section 14.

- **New baseline.** `BASELINE` in `test/lua/ring_gate/ringtree.mjs` was, at S4a C2, `9b00c5992a0ed2d9c34f1b710526af6977192ee6` (S4a C1; S4b C2 moved it, section 14). The gate's tree is still `git show` of that commit's `engine/ main/ shared/` plus
  canonical hashed patches, proven exact by content; nothing about the exact-content proof, the consumed-input guard or the stamp schema (`ring-prov-3`) changed.
- **What the lift still lifts.** `regen_patches.mjs` re-cuts `00-refusal-lift.patch` as one hunk that deletes the `else if (!streamCapableFourScreen(...))` block of `streamedBoardProblems` in
  `shared/project.js`: exactly the two refusals production still has, `capability` (MMC1 and UNROM 512 with horizontal or vertical mirroring) and `ringGame` (an RPG on MMC3). Every anchor of the regen
  asserts exactly one match, the end anchor included, and the sabotage patches are cut on both the lifted and the unlifted tree and compared byte for byte, so one file serves both.
- **The lift is a function of the cell, with one source.** `liftNeeded(cell, gameType)` (`ringtree.mjs`) asks production: `!streamRingAdmitted(mapper, mirroring, gameType)` from `shared/cartridge.js` **as it
  is at `BASELINE`** (a `git show` of the blob, loaded once), not from the working tree, so an old certificate is still audited against the tree it was built on. There is no board list in the harness: when S4b
  and S4c add `streamRingGameTypes: ['action']` to MMC1 and UNROM 512 the same rule drops their lift, and a baseline bump re-derives it. MMC3 action (V and H) is **unlifted**: its tree is `BASELINE`
  byte for byte (plus a sabotage patch on a control job); MMC3 RPG, MMC1 and UNROM 512 are **lifted**. The ring-0 patched side and the six-fixture comparison keep the lifted ring-2 tree (the comparison
  measures the lift-bearing build). The cell table moved to a leaf module, `ringcells.mjs`, so the tree maker, the stamp audit and the scene builder share it without an import cycle.
- **The audit follows the cell.** `auditTreeProvenance` derives the expected form of a stamp from its own cell and game type and refuses (a) an MMC3 action stamp that carries the lift, (b) a lifted cell
  stamp (MMC1, UNROM 512, MMC3 RPG) without it, (c) a stamp whose patch list, proof, or consumed evidence disagrees with its cell, and any stamp with an unknown cell or game type. `prov_unit.mjs` pins each as
  an audit sabotage that must fail, directly and through `auditStamp`. The historical waiver is exactly as narrow as before (`HISTORICAL_KINDS`, the one `PRE_C2_BASELINE`): a current-baseline stamp is
  never waived, and a unit pins that an MMC3 action stamp with a lift is refused even with the waiver option.
- **Sabotages.** `SABOTAGE_RINGS` stays the single source of which ring a sabotage exists on. Every sabotage patch applies exactly once at the new baseline and changes the same files on the lifted and the
  unlifted tree. The equivalent-mutant sweep of S3 C2 fix 1 (a positive and a sabotaged ROM per sabotage x ring x cell x {action resident, rpg resident, rpg banked}, each through its own cell's tree form)
  finds the same set as before and nothing new: no scheduled control builds a ROM equal to its positive.
- **MMC3 action on plain production.** A unit builds an MMC3-V and an MMC3-H action cell through the gate and compares its ROM with `node main/build/cli.js` on the same project in a fresh directory: byte for byte equal.
- **C1 review P3.** `streamadmit.test.js` changes the registry datum (`streamRingGameTypes`) in place, restored in `finally`, and asserts `streamedBoardProblems` and `validateProject` follow it; the
  escaping implementation (`mapper.id !== 4` and `gameType !== 'action'` hard-coded, helpers intact) fails that test and passes the earlier fourteen.
- **Result of the final matrix.** Section 3 held this certificate (now history, section 8): 377 jobs, 0 unexpected, 1,785 stamps (1,764 built, 15 error, 6 ring-0 comparisons), 0 problems, **144 PASS / 54 UNCERTIFIED / 234 N/A / 0 FAIL / 0 UNMEASURED**, `GATE PASS`, the table equal to S3 C2's cell for cell. Every one of the 1,764 built ROMs is byte for byte
  the ROM S3 C2 built from the same label, which is the point of the slice: moving the MMC3 action cells from a lifted to an unpatched tree is a change of provenance, not of bytes. Tree forms: MMC3 action V and H, 258 stamps: 160 with an empty patch set (`lifted:false`, tree == `9b00c59`) and
  98 carrying a sabotage patch only (their tree is `9b00c59` plus that one patch); MMC3 RPG 348, MMC1 586 and UNROM 512 575 lifted cell stamps; 12 ring-0 builds (6 pristine, 6 on the lifted tree) and 6 ring-0 comparisons. All 1,785 stamps carry the 248-entry final fingerprint and baseline `9b00c59`; there are no prototype-kind stamps; every ring-1 and ring-2 stamp has an exact-content proof and consumed-input evidence
  (the six comparisons carry the patched side's proof only, as before).
- **Mutants and controls.** The equivalent-mutant set is S3's exactly. The control-level N/A proofs still print (vertical `wrap-row-32`; horizontal `strip-len-30-vertical` and `wrap-col-30`). S1c controls: 147 runs, 135 caught, 12 passing as declared, 0 not as declared, as S3. The campaign controls that the matrix schedules only on MMC1 and UNROM 512 cells were also run during the pilot as extras outside the matrix (33 of 33 as declared); they are not part of this certificate.
- **What differed from the S3 C2 matrix**, all noise or provenance: 29 identity logs (provenance block only), and 10 Mesen logs where a frame or a body count moved by one (row 8 on five MMC3 cells, one `pad-over` body count, four row-8 controls on those cells); the 280 other JSON logs are byte-identical.

### The MMC3 production table

The two MMC3 **action** cells measured on **unlifted production code** (the tree is `9b00c59` with no patch, ROM equal to `node main/build/cli.js` output). Resident build; action × banked is N/A on every board.

| | MMC3-V (vertical mirroring) | MMC3-H (horizontal mirroring) |
|---|---|---|
| gate row, Mesen / jsnes | 1 P/P, 2 C/C, 3 P/P, 4 C/N, 5 P/N, 6 P/N, 7 N/P, 8 P/N, 9 P/N | the same |
| stamps (unlifted) | 80 empty patch set, 51 sabotage patch only | 80 empty patch set, 47 sabotage patch only |
| row 4 largest measured `G` (cycles; gate 29,780) | 18,871 (class C2); NMI handler maximum 2,142 | 19,040 (class C4a); NMI handler maximum 2,153 |
| row 5 observed margin, strip / mixed | 213.0 / 107.0 | 193.0 / 95.0 |
| row 5 bound W, strip / mixed | 2,096 / 2,185 | 2,108 / 2,198 |
| row 5 **certified** margin, strip / mixed | 148.67 / 59.67 | 136.67 / 46.67 |
| row 6 close frame | 88-byte queue (`vram_len` 87) split at the nametable join; margin 278.0 cycles | 85-byte queue (`vram_len` 84) in one packet; margin 314.0 cycles |
| row 8 run | 2,104 measured frames, 389 `switch_prg_bank` calls, 1,745 split IRQs | 1,550 measured frames, 477 `switch_prg_bank` calls, 1,261 split IRQs |
| row 8 arm deadline, least margin | 153.3 cycles | 138.3 cycles |
| row 9 | S1c controls caught as declared; `nmi-wrap-row-32` N/A | S1c controls caught as declared; `nmi-strip-len-30-vertical` and `nmi-wrap-col-30` N/A |

Every figure is identical to the S3 C2 certificate's for the same cell, where the tree was lifted (the logs for rows 4, 5 and 6 of these cells are byte-identical; row 8 differs by one frame, 2,105 and 1,551 there). The RPG and the other boards' cells are in section 3's per-build table, unchanged.


## 13. Slice S4b, commit C1: the two-nametable ring admitted on MMC1, action games only

C1 is admission again (`shared/`, `main/`, tests, docs): **no file under `engine/` changed**. It is section 11's change made for the second board: `validateProject` stops refusing the ring
for **MMC1** with horizontal or vertical mirroring, for action games. The gate (`test/lua/ring_gate/`) is untouched and still lifts MMC1 by patch; S4b commit C2 rebaselines it onto this
commit and makes the MMC1 action cells unpatched production.

- **What is admitted.** An **action** project on **MMC1** with **horizontal or vertical** mirroring and the dead-axis shape the mirroring allows (N x 1 under vertical, 1 x N under
  horizontal; grid and dead-axis refusals unchanged). One line: `streamRingGameTypes: ['action']` on the MMC1 entry of `shared/cartridge.js`, which is all `streamRingBoardAdmitted` and
  `streamRingAdmitted` read. `streamedBoardProblems` states no board. Still refused: UNROM 512 with horizontal or vertical mirroring (S4c, `capability`) and a streamed RPG on MMC1 or
  MMC3 (S5, `ringGame`; on UNROM 512 non-four-screen the board refusal comes first, one message).
- **The refusal messages now follow the registry.** S4a typed "MMC3" into the two messages that list the boards that work. `streamRingAdmittedBoardNames(gameType)` (`shared/cartridge.js`)
  now builds that list from the same datum, in registry order, and `streamedBoardProblems` interpolates it, so S4c and S5 move the text with the datum:
  - board cannot stream at all [`capability`, Build]: "... or **MMC3 with horizontal or vertical mirroring (action games)** ..." became "... or **MMC1 or MMC3 with horizontal or vertical mirroring (action games)** ...".
  - UNROM 512 non-four-screen [`capability`, Build] (MMC1 no longer reaches it): "... not implemented yet on this board. Streamed maps work on **MMC3 with** horizontal or vertical mirroring (action games) and on UNROM 512 with four-screen mirroring ..."
    became "... work on **MMC1 or MMC3 with** horizontal ... ".
  - streamed RPG [`ringGame`, Build]: the text is unchanged and now fires on MMC1 as well ("... on MMC1 with vertical mirroring, which only reaches the two-nametable ring -- streamed RPGs are not implemented there yet ...").
  - dead axis [`deadAxis`] and grid [`grid`], both Map Forge: unchanged, now live on MMC1 too. `docclaims.test.js` T4 pins the narrowed UNROM 512 refusal (with its README sentence) and that `ringGame` fires
    on MMC1 and MMC3. The S4a review's advisory P3 (a board id hard-coded in `streamedBoardProblems` escaping the datum) was closed by S4a C2's "follows the registry datum" test; it now also covers
    MMC1 and the message text, and a sabotage hard-codes `[1, 4]` in `streamedBoardProblems` to prove it.
- **Audited, unchanged.** `reconcileCartridge` (MMC1 has no four-screen option, so a four-screen request falls back to `vertical`, an admitted ring; the Build panel's mirroring commit already reconciles in the same
  commit), `switchableMappers` and `checkStreamedMapperSwitch` (the tiers are board properties; MMC1 is offered exactly where `streamedBoardProblems` accepts the moved project), `checkCapacity` and
  `streamedCapacityProblems` (already per-board region counts), `main/build/streamplacement.js` and `shared/streamlayout.js` (no board logic; a comment only), `shared/save.js` (battery media is the same on MMC1 and
  MMC3; mirroring is not in the save identity). MMC1's software mirroring (the serial control register, generated `MAPPER_MIRROR`) is the one thing that differs from MMC3: the save test below reads both
  nametables after a Continue across a mirroring flip, which fails if the register keeps the old mirroring.
- **Capacity, re-measured through the real path** (`handoff-next/s4b-c1/capacity.mjs`, log `capacity.log`):

  | MMC1 action | largest that builds | smallest refused | refused by |
  | --- | --- | --- | --- |
  | vertical mirroring, N x 1 | **255** (the grid ceiling) | 256 | the grid ceiling, "at most 255", Map Forge |
  | horizontal mirroring, 1 x N | **14** | **15** | `checkCapacity`: "The streamed maps need 15 of the 14 8 KB program regions MMC1 has free for world data", Map Forge |

  The plan's scratch measurement (14 action screens on MMC1-H) is exactly the real refusal; MMC1 has 7 data banks (14 regions) against MMC3's 15 (30). Pinned by `streamadmit.test.js` (built at both
  edges on both boards) and `streamedcapacity.test.js`.
- **Saves (ruling 3), MMC1.** The S4a test pattern, extended rather than duplicated: a mirroring-only edit keeps `saveCompatToken` and `saveIdentity` (the only valid such edit is all streamed maps 1 x 1, as on
  MMC3), a resize invalidates, and a save made on a vertical MMC1 ROM Continues on the horizontal one with both live nametables and attribute tables equal to the oracle (`ringoracle.js` through the gate's judge).
- **Byte identity.** The six fixtures' hashes equal `handoff-next/fixture-hashes-r4-before.txt` before and after, and the ROMs of `sample`, `sample-rpg` and the four save-check fixtures built by `cli.js` equal those of
  a `68f3097` worktree. The ring gate's MMC1 action builds -- **96 scenes** (49 on `MMC1-V`, 47 on `MMC1-H`), every `scenesFor(cell, 'action')` scene, resident placement -- build to the **same ROM bytes** from this
  tree with no lift as from a `9b00c59` worktree with `00-refusal-lift.patch` applied (`handoff-next/s4b-c1/identity.mjs`, log `identity.log`: 96 EQUAL, 0 different).
- **Certificates.** `shared/` and `main/build/` moved, so the generator fingerprint moved (`5b94bb9519d5 -> 614e1f1d678d`; the engine, `d5add2c0fc86`, did not): `test/fixtures/identity-cert/s4b-c1.json`
  (`sw_identity_cert.mjs --dir=handoff-next/s2-c1/resweep`: 11760 of 11760 direct records matched, 832 reuses, 0 mismatches), and `exclusions-evidence.json` refreshed by `refresh_sw_exclusions.mjs` (340 refusals, 340
  parent receipts, 159 parent scenes; `--control=scene` refused; only `prov.new.generator` changed). `s4a-c1.json` stays as history and `harnesstransfer.test.js` asserts its one stale binding.
- **Not done here (C2).** `BASELINE` is still `9b00c59`; `00-refusal-lift.patch` still lifts MMC1 (and UNROM 512, RPG); no stamp was restamped. C2 rebaselines onto this commit, re-cuts the lift to UNROM 512
  and `ringGame`, and runs the one matrix.

## 14. Slice S4b, commit C2: the ring gate rebaselined onto S4b C1, MMC1 action cells on unpatched production

C1 (section 13) admitted the two-nametable ring on MMC1 for action games, so MMC1 action no longer needs the refusal lift. C2 is **harness-only** (`test/lua/ring_gate/`, tests, docs; nothing under `engine/`, `main/` or `shared/`
changed) and moves the gate onto that commit. **Round 1 was the rebaseline, its units and a pilot; the one full matrix then ran on exactly the accepted tree (the reviewer's CODE-ACCEPT / MATRIX-READY), and its result, the measured table (section 3) and the MMC1 production table (end of this section) are below.** The S4a C2 certificate (baseline `9b00c59`) is
history from this commit on (the current harness refuses it: `run_sw_ring_gate.sh` on it reports 16,609 audit problems, the first a baseline mismatch against `19ea33c`, and 1,779 stale-fingerprint stamps; section 8).

- **New baseline.** `BASELINE` in `test/lua/ring_gate/ringtree.mjs` is `19ea33cc46bb2fecab8b387f03c75d7ed7f5107c` (S4b C1). Nothing about the exact-content proof, the consumed-input guard or the stamp schema (`ring-prov-3`) changed.
- **The lift, re-cut.** `regen_patches.mjs` produces `00-refusal-lift.patch` as the same one hunk (its start and end anchors each asserted to match exactly once, the end anchor too): it deletes the `else if (!streamCapableFourScreen(...))` block of
  `streamedBoardProblems`. At `19ea33c` that block holds exactly what production still refuses: `capability` for UNROM 512 with horizontal or vertical mirroring, and `ringGame` for a streamed RPG on MMC1 or MMC3 (on UNROM 512
  non-four-screen the board refusal comes first). The hunk's removed lines changed (the messages interpolate the registry list), the logic did not. The nine sabotage patches changed only in their `index` blob ids and in the generator context comment they carry ("MMC3-only admission" became "MMC3 and MMC1 admission"); no mutation instruction changed.
- **MMC1 action carries no lift, with no harness list edited.** `liftNeeded` (`ringtree.mjs`) is still `!streamRingAdmitted(...)` from `BASELINE`'s own `shared/cartridge.js`; at `19ea33c` the MMC1 datum makes it false for MMC1 action:

  | cell, game type | tree | patches |
  | --- | --- | --- |
  | MMC1 and MMC3, action, V and H | `19ea33c` itself (**unlifted**) | none (a sabotage control: that one patch) |
  | MMC1 and MMC3, RPG | lifted (`ringGame`) | `00-refusal-lift.patch` |
  | UNROM 512, action and RPG | lifted (`capability`) | `00-refusal-lift.patch` |

  `prov_unit.mjs` has a unit that scans the tree maker and the stamp audit for a cell-id literal or a mapper-number comparison (it fails if one appears) and a sabotage of `liftNeeded` that hard-codes `mapper === 1` fails 7 of its tests. The remaining
  mapper/cell literals in the harness (`ringcells.mjs`'s table, the job lists, row 8's MMC3-only rule, `ringcount.mjs`) describe cells and hardware, not which cells production admits.
- **The audit follows the cell.** The three audit sabotages S4a added (an admitted action stamp carrying the lift; a lifted cell's stamp without it; a patch list, proof, consumed evidence or proof lift flag that disagrees with the cell) now run
  over every admitted action cell, **MMC1 included**, directly and through `auditStamp`; the by-cell unit covers all six cells x two game types x {build, S1b witness, S1c run}; the historical waiver is exactly as narrow as before
  (the same four kinds under the one `PRE_C2_BASELINE`) and a unit shows a current-baseline MMC1 or MMC3 action stamp with a lift is refused even with `historicalTree: true`. The exact-content proof covers the empty patch set on MMC1 cells
  (`verifyProduction` on an unlifted tree: no changed file, proof `lifted:false`).
- **Plain production.** `handoff-next/s4b-c2/cli_compare.mjs` builds an MMC1-V and an MMC1-H action project (and MMC3-V/-H) through the gate's cell tree and with `node main/build/cli.js` on the same project in a fresh directory, no bypass: the ROMs are
  byte-identical (MMC1-V `727e1df4…`, MMC1-H `3fa283ac…`, 139,280 bytes each), the stamp's patch list is empty and its proof `lifted:false` (`prov_unit` pins the same for all four cells).
- **Sabotages.** Every ring sabotage patch applies once and changes the code it names on the lifted and the unlifted tree, MMC1 action included. The equivalent-mutant sweep (S4a C2's instrument, unchanged: 28 sabotages x ring x cell x {action resident, rpg resident,
  rpg banked}, positive and sabotaged ROM through the same cell tree) is **row for row equal to S4a C2's**: 480 rows, 84 identical (the feature-conditional set: `continue-pos-zero`, `move-scroll-stale`, `shake-no-nt-flip`, `shake-nt-eor2`, `battle-return-no-render` on action,
  and `forced-banked` on rpg-banked), 378 differ, 15 predeclared build-error witnesses (`forced-banked` on action, `ring-forced-0` on ring 2), 3 excluded. 477 builds: 371 lifted and 106 unlifted (53 MMC1 action, 53 MMC3 action; the 53 that moved are the MMC1 ones).
  Nothing new; no scheduled control builds a ROM equal to its positive.
- **No-flag precheck, first.** `run_matrix.mjs --only='^(s1c|s1b)-noflag$'`: both byte-identical to `noflag/s1c-cd7a9f8.json` and `s1b-aaa678a.json`; C1 changed no engine or `config.inc` output, so no re-record.
- **Pilot** (`handoff-next/s4b-c2/pilot-*`): 161 of the 377 jobs, one or more of every one of the 126 job kinds, one positive per acceptance row on the unlifted MMC1-V and MMC1-H action cells, MMC3-V action, an RPG on MMC1 and MMC3 and UNROM 512 cells
  (the narrowed lift still lifts); every sabotage is built on an unlifted MMC1 cell (27 as built stamps; `forced-banked` on action is its predeclared build-error witness). 160 jobs met their declaration; the one that did not is `s1c-gate`, which cannot
  pass on a partial selection. 1,460 stamps (1,439 built, 15 error, 6 ring-0 comparisons), 0 problems; no MMC1 or MMC3 action stamp carries the lift; all carry the 248-entry harness fingerprint. **All 1,439 built ROMs equal the ROM S4a C2's final matrix built
  from the same stamp name.** `ringprovindex.mjs --verify` passes; the gate in VERIFY mode reports the index and fingerprints clean and `GATE FAIL` by construction (222 UNMEASURED cells = jobs not run). A pilot samples one job per kind; it cannot
  certify the 216 unrun jobs, the measured table or the production table.
- **C1 review P3.** `streamadmit.test.js` no longer text-matches the Build panel's mirroring callback: acorn finds the `store.commit('Change mirroring', ...)` call in `renderer/forges/build/build.js` and the callback's own source is executed on real MMC1, MMC3 and UNROM 512 drafts (the selection
  lands, an unavailable mirroring is reconciled in the same call). The reviewer's commented-out assignment, a dropped `reconcileCartridge` and a reconcile placed before the assignment each fail it (`handoff-next/s4b-c2/p3-control.log`, a disposable copy). `renderer/` is not edited.
- **Result of the final matrix.** Section 3 holds the certificate; the expectation written before the run was met exactly. `run_matrix.mjs` once, 2026-10-13 21:50 to 23:26 PDT, `--jobs=18`, exit 0, on the frozen harness (the reviewed diff, a 248-input fingerprint equal to the pilot's): 377 jobs, 0 unexpected, 1,785 stamps (1,764 built, 15 error, 6 ring-0 comparisons), 0 problems under `ringprovindex.mjs --verify`; `run_sw_ring_gate.sh` in verify mode 0 audit problems and 0 stale fingerprints,
  **144 PASS / 54 UNCERTIFIED / 234 N/A / 0 FAIL / 0 UNMEASURED**, `GATE PASS`, its output equal to S4a C2's in every line but the directory paths; the control-level N/A proofs print; S1c controls 147 runs, 135 caught, 12 passing as declared. Tree forms: MMC1 action 257 stamps (142 empty patch set, 115 sabotage patch only) beside MMC3 action 258 (160, 98), 515 unlifted in all, 0 of them carrying the lift; lifted
  MMC1 RPG 329, MMC3 RPG 348, UNROM 512 575 (243 action, 332 RPG) = 1,252, plus 12 ring-0 builds (6 pristine, 6 lifted) and 6 comparisons; `lifted === liftNeeded` on every stamp; every ring-1 and ring-2 stamp production-kind with consumed-input evidence and an exact-content proof (the comparisons carry the patched side's), 0 prototype kinds, every stamp the final fingerprint and baseline `19ea33c`.
  **ROMs: all 1,764 built ROMs equal the same-named ROM of the S4a C2 matrix** (the pilot's 1,439 and C1's 96 were the previews). Row 5: 18 positives, 14/14 items, every certified margin positive, tightest 33.67 (mixed) / 115.67 (strip) on MMC3-H RPG banked; observed minimum, bound W and certified margin equal S4a C2's for all 18 cells, **no margin changed**. Logs: of 319, 271 are byte-identical to S4a C2's, 29 identity logs differ in their provenance block only, and 19 row-8 Mesen control logs
  (MMC3 cells) differ by one frame in their measured counts with calls, statuses and verdicts unchanged (18 one frame longer, `s1c-r8-ctl-split-wrong-r1-MMC3-V-rpg-banked` one shorter); every row 4, 5 and 6 log and the six row-8 positive measurement logs are byte-identical (the positive identity logs are among the 29 that differ in provenance only).

### The MMC1 production table

The two MMC1 **action** cells measured on **unlifted production code** (the tree is `19ea33c` with no patch, ROM equal to `node main/build/cli.js` output). Resident build; action × banked is N/A on every board. Figures for rows 4 to 6 are byte-identical to the logs of the S4a C2 matrix, where this tree carried the lift: production admits the same code the lift used to force.

| | MMC1-V (vertical mirroring) | MMC1-H (horizontal mirroring) |
|---|---|---|
| gate row, Mesen / jsnes | 1 P/P, 2 C/C, 3 P/P, 4 C/N, 5 P/N, 6 P/N, 7 N/P, 8 N/N, 9 P/N | the same |
| stamps (unlifted) | 73 empty patch set, 61 sabotage patch only | 69 empty patch set, 54 sabotage patch only |
| row 4 largest measured `G` (cycles; gate 29,780) | 19,085 (class C2); NMI handler maximum 2,102 | 18,433 (class C4a); NMI handler maximum 2,114 |
| row 5 observed margin, strip / mixed | 277.0 / 171.0 | 258.0 / 127.0 |
| row 5 bound W, strip / mixed | 2,030 / 2,120 | 2,042 / 2,164 |
| row 5 **certified** margin, strip / mixed | 214.67 / 124.67 | 202.67 / 80.67 |
| row 6 close frame | 88-byte queue (`vram_len` 87) split at the nametable join; margin 344.0 cycles | 85-byte queue (`vram_len` 84) in one packet; margin 378.0 cycles |
| row 8 | N/A (the split and lock are assembled only for MMC3) | N/A |
| row 9 | S1c controls caught as declared; `nmi-wrap-row-32` N/A | S1c controls caught as declared; `nmi-strip-len-30-vertical` and `nmi-wrap-col-30` N/A |

The RPG builds and the other boards' cells are in section 3's per-build table, unchanged.

## 15. Slice S4c, commit C1: the two-nametable ring admitted on UNROM 512, action games only

C1 is admission for the last board (`shared/`, `main/`, tests, docs): **no file under `engine/` changed, and lever B (a row-address table for `sw_goto`) was not needed**. After it every streamable
board admits the ring for action games; a streamed RPG on a two-nametable board waits for S5. The gate (`test/lua/ring_gate/`) is untouched and still lifts UNROM 512 by patch; S4c commit C2
rebaselines it onto this commit and runs the one matrix.

### The depth proof (done first; it gated the rest)

The worry: `sw_goto`'s row loop (`engine/streamworld.asm`, `sw_goto_rowloop`, `lda; clc; adc; sta; dex; bne`) costs 19 cycles per row, and UNROM 512 horizontal is the deepest world of any board
(61 rows against MMC3's 30 and MMC1's 14), about 1,140 cycles per call at row 60. The proof is that the S4b C2 certificate already measured that depth, so no new measurement was needed:

1. **Gate cells at the deepest admitted N.** `s1b-U512-H-action-resident` (`handoff-next/s4b-c2-logs-final/`; `run_s1b.mjs` cell `U512-H`, action; banked is N/A for action) runs at **N = 61**,
   `prepareRing` -> `maxWorkloadN` (`test/lua/ring_gate/ringcli.mjs`: bisection through the patched tree's own real `checkCapacity` from `hi` = 255): "the deepest world the capacity check
   admits with this workload". (The loop after the bisection that is meant to probe N+1 and N+2 for non-monotone admission never executes, because `lo + k <= hi` is false once the bisection has converged; for
   61 the neighbours 62 and 63 were each checked during the bisection, but the ceiling is **not** argued from that probe -- it rests on the production arithmetic in point 4.) MMC1-H runs at 14 and MMC3-H
   at 30; the vertical cells run at 255, where the row loop never iterates (`gridH` is 1). The row-4 mainline evidence (the S1b campaign, point 3) and the campaign cell run at this N; the row-5 and row-6
   interrupt cells do **not** (point 3b).
2. **The deepest row the read-cost sweep charges is row 60.** `path:deepest-row` (`s1bjudge.mjs`) passes: one arm `sw_goto` at row 60 ran the row loop 60 times (N-1; walk@287 in Mesen, @286 in jsnes).
   `cost:sweep` (`s1bcost.mjs`, `sweepReads`) is exhaustive over EVERY (current, target) pair of the 61-screen ring (13 distinct kernel layouts, repeated at 8 `mapper_shadow` values on UNROM 512), calling the
   real `sw_peek_byte` (Y=0, 255), `sw_goto` and `sw_locate_current` under jsnes: the dearest `sw_goto` is 1,290 cycles (target row 60), the dearest peek 1,415 / 1,417 (row 60), `sw_locate_current` 103,
   independent of the target; goto cost is independent of the current screen. `cost:events` shows every priced event in Mesen (1,769 goto / 1,843 locate / 1,226 peek) and jsnes equals the sweep, none outside it.
   The class bounds (`bound:Cx`) charge unattained reads at the ring-adjacent exhaustive price. In the measured Mesen bodies, 953 of 10,101 had a `sw_goto` at target row 57 or deeper.
3. **Worst frame against `G < 29,780` (row 4).** Measured: **20,026** cycles on U512-H (C4a, `say`@333, no reads), margin 9,754; the per-class maxima are 19,525 / 19,122 / 19,709 / 17,122 / 16,334 / 17,014
   (MMC3-H 19,040, MMC1-H 18,433). The class bounds stay UNCERTIFIED by design (section 4, option A): the worst class estimate on U512-H is **27,013** (C4c: sampled remainder plus the exhaustive read cost), margin
   2,767, against MMC3-H 25,498 (4,282) and MMC1-H 24,819 (4,961). The composed estimates are UNCERTIFIED; only the measured G (20,026) is a row-4 pass.
   **3b. What rows 5 and 6 are, and why they do not need N = 61.** They are interrupt (NMI) evidence, measured at **N = 4** (`ringnmi.mjs` builds row 5 with `n: 4`; `ringclose.mjs`'s `ringCloseProject` defaults
   to `n = 4` and its caller passes none):
   - **Row 5** (strip-only and mixed NMI) certifies the static longest NMI paths: **2,042 cycles (strip) and 2,132 (mixed)**, certified margins **202.67 and 112.67**, observed minimum margins 258.7 and 158.0
     (`s1c-r5-U512-H-action-resident.log`). These two pairs are both row 5. They are properties of the board's NMI code (MMC1-H 2,042 / 2,164, margins 202.67 / 80.67; MMC3-H 2,108 / 2,198, 136.67 / 46.67), not of N.
   - **Row 6** (the exclusive close drain: the 85-byte, five-packet close frame) reports the **observed** margin, **376.7 cycles** (`s1c-r6-U512-H-action-resident.log`; MMC1-H 378.0, MMC3-H 314.0), not a bound.
   - **Why a deeper scene adds nothing to either.** The NMI handler (`nmi` -> `vram_drain` / `sw_nmi_stream` / `sw_nmi_stream_reduced`) contains no `jsr sw_goto`; the only callers of `sw_goto` and
     `sw_peek_byte` are `sw_enter_screen`, `sw_terrain_or_fill_solid_type`, `sw_read_transaction`, `sw_read_run` and the relocators, all mainline. What the handler does depends on the queued bytes, not on the
     world's depth, so its cycle count at N = 4 and N = 61 is the same code path.
   - **The mainline half of the close does reach `sw_goto`, and is priced at depth in row 4.** Building the close row runs `text_close_step` -> `sw_dlg_hi_close_step` -> `sw_dlg_close_row` ->
     `sw_dlg_terrain_read` -> `sw_dlg_read_chunk` -> `sw_read_run` -> `sw_goto` (`engine/streamdialog.asm`, `engine/streamworld.asm`) in the frame that runs the close, before the NMI drains the queue. The retained
     S1b data witnesses it at the deepest row: `mv-lead`, Mesen frame 423, class C4c, **G = 17,014**, whose events include two `g:0:60:1277:0:59` (a `sw_goto` to row 60, 1,277 cycles) each followed by its
     restore `l:0:59:88` (`rowloop` 120 = 2 x 60); the jsnes bodies for the same scene agree (frames 422 and 423 carry the same events, 17,011 and 16,982 cycles). The N = 4 row-6 measurement is **not** a
     measurement of that mainline cost at N = 61; row 4 is.
4. **Production cannot admit a deeper world than the gate's 61.** `screenRegions` (`shared/cartridge.js`): UNROM 512 has 32 PRG units, 31 data banks, 62 regions; CHR-RAM boards put `max(1, tilesetCount)`
   tileset pages off the front, an RPG's battle bank one more, and a Save command's flash sector the last one. A 1 x N map is one region per row (`streamRegionsPerRow(1)`). No input gives more than
   **61**: `handoff-next/s4c-c1/capacity.mjs` (log `capacity.log`) walks tilesets 0-4 x banked code 0-1 x flash save, and builds the real project: **1 x 61 builds, 1 x 62 is refused** ("The streamed maps need
   62 of the 61 8 KB program regions UNROM 512 has free for world data", Map Forge). Two tilesets or a Save lower it to 60; four tilesets to 58.

`streamadmit.test.js` (f) pins it: the packer's ceiling per board (14, 30, 61) and the real refusal at N / N+1, hardcoded from the certificate's `N=`, so growing the board's region count (`prgUnits`, a CHR page no
longer charged, streamed maps allowed into payload regions) fails a test until the depth is recertified.

### What C1 changes

- **What is admitted.** An **action** project on **UNROM 512** with **horizontal or vertical** mirroring and the dead-axis shape the mirroring allows. One line: `streamRingGameTypes: ['action']` on the UNROM 512
  entry of `shared/cartridge.js`. The four-screen torus on UNROM 512 is a different path (`streamCapableFourScreen`) and is untouched: action and RPG, byte-identical.
- **Refusal messages (generated from the registry; two reworded).** `streamRingAdmittedBoardNames` now returns an English list ("UNROM 512, MMC1 or MMC3"; two boards "A or B"), and the "cannot stream"
  message is reordered so the four-screen clause is not repeated inside the list:

  | message [kind, where] | before (S4b) | after |
  | --- | --- | --- |
  | board cannot stream [`capability`, Build] | "Streamed maps need UNROM 512 with four-screen mirroring, or MMC1 or MMC3 with horizontal or vertical mirroring (action games) -- change the board ..." | "Streamed maps need UNROM 512, MMC1 or MMC3 with horizontal or vertical mirroring (action games), or UNROM 512 with four-screen mirroring -- change the board ..." |
  | ring board without a datum [`capability`, Build] | "... not implemented yet on this board. Streamed maps work on MMC1 or MMC3 with horizontal or vertical mirroring (action games) and on UNROM 512 with four-screen mirroring ..." | same text, from the same list; reachable only by deleting a datum (no registered board is in that state) |
  | streamed RPG [`ringGame`, Build] | UNROM 512 H/V got the board refusal | text unchanged; now fires on UNROM 512, MMC1 and MMC3 |
  | dead axis, grid [Map Forge] | unchanged | unchanged, now live on UNROM 512 too |

  `docclaims.test.js` T4 keeps the "no ring yet" refusal alive by removing UNROM 512's datum inside `fires()` and restoring it; the README sentence now says only the RPG refusal.
- **Audited, unchanged.** `reconcileCartridge` (UNROM 512 has four-screen, so the selection survives; the four-screen tileset trim happens in the Build panel's mirroring commit, now tested through the real callback
  for four-screen <-> H/V on a streamed project), `switchableMappers` and `checkStreamedMapperSwitch` (board properties: UNROM 512 is offered exactly where `streamedBoardProblems` accepts the moved project),
  `checkCapacity` / `streamedCapacityProblems` / `planStreamedRegions` (already per-board region counts), `main/build/streamplacement.js` and `shared/streamlayout.js` (a comment only), `shared/save.js` (no board
  logic; mirroring is not in the save identity), the `sample-u512` fixture (untouched), the renderer's Build and Map Forges (no board text). Stale comments in `shared/cartridge.js`, `generate.js` and `streamplacement.js` fixed.
- **Capacity, re-measured through the real path** (`handoff-next/s4c-c1/capacity.mjs`):

  | UNROM 512 action | largest that builds | smallest refused | refused by |
  | --- | --- | --- | --- |
  | vertical mirroring, N x 1 | **255** (the grid ceiling) | 256 | the grid ceiling, Map Forge |
  | horizontal mirroring, 1 x N | **61** | **62** | `checkCapacity`, "need 62 of the 61 8 KB program regions", Map Forge |
- **Saves (ruling 3), UNROM 512.** As on MMC3 and MMC1, a mirroring-only edit keeps `saveCompatToken` and `saveIdentity` and a resize invalidates. UNROM 512 saves to the flash sector inside the ROM, not battery RAM:
  the Continue test carries the 4 KB sector of the vertical ROM into the horizontal ROM image and lands on the saved position with both live nametables equal to the horizontal-ring oracle.
- **Byte identity.** The six fixtures' hashes equal `handoff-next/fixture-hashes-r4-before.txt` before and after, and all six built by `cli.js` equal those of a `5e9d389` worktree. The ring gate's UNROM 512
  action scenes -- **98** (both mirrorings, resident placement) -- build to the **same ROM bytes** from this tree with no lift as from a `19ea33c` worktree with `00-refusal-lift.patch` applied
  (`handoff-next/s4c-c1/identity.mjs`, log `identity.log`: 98 EQUAL, 0 different).
- **Certificates.** `shared/` and `main/build/` moved, so the generator fingerprint moved (`5b94bb9519d5 -> 972e6356fdc1`; the engine did not): `test/fixtures/identity-cert/s4c-c1.json` (11,760 of 11,760 direct
  records matched, 832 reuses, 0 mismatches), and `exclusions-evidence.json` refreshed by `refresh_sw_exclusions.mjs` (only `prov.new.generator` changed). `s4b-c1.json` stays as history and
  `harnesstransfer.test.js` asserts its one stale binding. No ring-gate stamp was touched. The certificate is a fingerprint renewal, not an admission proof; C2's matrix is the production proof.
- **Not done here (C2; section 16 is round 1 of it).** `BASELINE` is still `19ea33c`; `00-refusal-lift.patch` still lifts UNROM 512 (and RPG). C2 rebaselines onto this commit, re-cuts the lift to `ringGame` only, and runs the one matrix.

## 16. Slice S4c, commit C2: the ring gate rebaselined onto S4c C1, every action cell on unpatched production

C1 (section 15) admitted the two-nametable ring on UNROM 512 for action games, so no action cell on any board needs the refusal lift any more. C2 is **harness-only** (`test/lua/ring_gate/`, tests, docs; nothing under `engine/`, `main/` or `shared/`
changed). **Round 1 was the rebaseline, its units and a pilot; the one full matrix ran after the reviewer's CODE-ACCEPT on the frozen harness, and the measured table (section 3) and the production table at the end of this section are written from it.** The S4b C2 certificate is history (section 8).

- **New baseline.** `BASELINE` in `ringtree.mjs` is `bb43a2cbd5127b91430aa162b7e8388409272143` (S4c C1). The exact-content proof, the consumed-input guard and the stamp schema (`ring-prov-3`) are unchanged.
- **The lift, re-cut to the one refusal left.** `regen_patches.mjs` produces `00-refusal-lift.patch` as one hunk of `shared/project.js` that only deletes the `else if (!streamRingAdmitted(...))` arm of `streamedBoardProblems`, the `ringGame` refusal of a streamed
  RPG on a two-nametable board (start anchor and end anchor each asserted to match exactly once). It leaves the `capability` arm ("not implemented yet on this board") intact. **Why the arm stays:** since C1 every registered board has the datum, so that arm cannot fire, and a lift that removed it
  would make the lifted RPG tree differ from production by dead code S5 may or may not delete. Deleting only the arm that fires makes the lifted tree *production minus the one refusal S5 retires*, which is the closest a lift can be to what S5 ships (S5 is then a registry datum for the game type and the
  lift's retirement, with nothing else to compare). The patch must apply and change something on every cell that carries it: the lifted trees on both rings differ from `bb43a2c` in exactly `shared/project.js` (a unit pins the one hunk, the deletion-only shape, the intact `capability` arm and the changed-file list).
  The nine sabotage patches changed only in `index` blob ids and in one generator context comment ("MMC3 and MMC1" became "MMC3, MMC1 and UNROM 512"); no mutation instruction changed. A both-arms lift (the S4b C2 shape re-anchored) builds identical ROMs, so only the new scope unit tells it apart: it fails that one test.
- **U512 action carries no lift, with no harness list edited.** `liftNeeded` is unchanged (`!streamRingAdmitted(...)` from `BASELINE`'s own `shared/cartridge.js`); at `bb43a2c` it is false for every action cell:

  | cell, game type | tree | patches |
  | --- | --- | --- |
  | UNROM 512, MMC1 and MMC3, action, V and H | `bb43a2c` itself (**unlifted**) | none (a sabotage control: that one patch) |
  | UNROM 512, MMC1 and MMC3, RPG, V and H | lifted (`ringGame`) | `00-refusal-lift.patch` |

  The grep of the lift path (`ringtree.mjs`, `ringprovindex.mjs`, `ringcells.mjs`, `ringworld.mjs`, `ringjobs.mjs`, the units) finds no second list of admitted boards; `prov_unit.mjs`'s scan for a cell-id literal or a mapper-number comparison in the tree maker and the audit still passes,
  and a sabotage of `liftNeeded` that adds `|| cell.mapper === 30` fails 7 of its tests. `LIFT_TABLE`, the independent table the unit checks `liftNeeded` against, now has UNROM 512 action `false`; `PLAIN_CELLS` is all six cells, and `UNLIFTED[ring]` (found through `liftNeeded`) is the
  representative where a test needs an unlifted stamp.
- **The audit follows the cell, U512 included.** The audit sabotages (an admitted action stamp carrying the lift; a lifted RPG stamp without it; a patch list, proof, consumed evidence or proof lift flag that disagrees with the cell) now run on UNROM 512 action stamps directly and through `auditStamp`; the by-cell unit
  covers six cells x two game types x {build, S1b witness, S1c run}; the plain-production unit relabels an unlifted stamp as a UNROM 512 or MMC3 RPG and is refused. A mutant that makes the audit treat UNROM 512 as lifted fails 4 units. The historical waiver is exactly as narrow as before (the same four kinds, one
  `PRE_C2_BASELINE`, no new kind under an old baseline), and a current-baseline UNROM 512 action stamp with a lift is refused even with `historicalTree: true`. The exact-content proof covers the empty patch set on U512 (`verifyProduction`: no changed file, proof `lifted:false`).
- **Plain production.** `handoff-next/s4c-c2/cli_compare.mjs` builds U512-V and U512-H action through the gate's cell tree and with `node main/build/cli.js` on the same project in a fresh directory, no bypass: the ROMs are byte-identical at N = 4, at **U512-H N = 61** (`71eb1e0d…`) and at **U512-V N = 255**
  (`273b9e8d…`), 524,304 bytes each; the patch lists are empty and the proof `lifted:false`. MMC1 and MMC3 (`727e1df4…`, `3fa283ac…`, `a1af3231…`, `cf03d9b1…`) are the S4b C2 ROMs.
- **Sabotages.** Every ring sabotage patch applies once and changes the code it names on both forms of both rings. The equivalent-mutant sweep (S4b C2's instrument, run unchanged: 28 sabotages x ring x cell x {action resident, rpg resident, rpg banked}, positive and sabotaged ROM through the same cell tree)
  is **row for row equal to S4b C2's**: 480 rows, 84 identical (the same feature-conditional set), 378 differ, 15 predeclared build-error witnesses, 3 excluded, and not one of the 477 builds' ROM moved. 477 builds: 318 lifted (RPG: 106 each on MMC1, MMC3, UNROM 512) and 159 unlifted (53 per board); S4b had 371 / 106 - the 53 that moved are the UNROM 512 action builds.
- **No-flag precheck, first.** `run_matrix.mjs --only='^(s1c|s1b)-noflag$'`: both byte-identical to `noflag/s1c-cd7a9f8.json` and `s1b-aaa678a.json`; C1 changed no engine or `config.inc` output, so no re-record.
- **Pilot** (`handoff-next/s4c-c2/pilot-*`): 175 of the 377 jobs, one or more of every one of the 126 job kinds (`pilot-only.kinds.txt`), one positive per acceptance row on U512-V and U512-H action (S1b uses the deepest workload capacity admits, N = 255 vertical and 61 horizontal for the ordinary action workload; rows 5 and 6 keep their N = 4 interrupt scenes, `ringnmi.mjs` and `ringclose.mjs`, and section 15's depth argument), on MMC1 action and on MMC3 action, an RPG on every board (the narrowed
  lift still lifts), and every one of the 28 sabotages built on an unlifted UNROM 512 action cell (`forced-banked` and one `ring-forced-0` are their predeclared build-error witnesses; the patch list is that sabotage alone). 174 jobs met their declaration; the one that did not is `s1c-gate`, which cannot pass on a partial selection.
  1,610 stamps (1,589 built, 15 error, 6 ring-0 comparisons), 0 problems; UNROM 512 action 131 empty patch set + 94 sabotage only, 0 carrying the lift; every RPG stamp carries it; one 248-entry harness fingerprint; baseline `bb43a2c` on every stamp. **All 1,589 built pilot ROMs equal the same-named ROM of the S4b C2 final matrix**:
  UNROM 512 action unpatched == lifted (as C1's 98 predicted) and UNROM 512 RPG on the narrowed lift == the full lift (the unreachable arm). `ringprovindex.mjs --verify` passes; the gate in VERIFY mode reports the index and fingerprints clean and `GATE FAIL` by construction (166 cells FAIL/UNMEASURED = jobs not run). A pilot samples one job per kind;
  it cannot certify the 202 unrun jobs, the measured table or the production table.
- **Result of the final matrix.** The expectation written before the run (377 jobs, 144 / 54 / 234 / 0 / 0, every cell equal to S4b C2's, no ROM moved) was met. `run_matrix.mjs` once, 2026-10-14 12:15 to 13:38 PDT (83 minutes), `--jobs=18`, exit 0, on the frozen harness (the reviewed diff, a 248-input fingerprint equal to the pilot's): 377 jobs, 0 unexpected, 1,785 stamps (1,764 built, 15 error, 6 ring-0 comparisons), 0 problems under `ringprovindex.mjs --verify`; `run_sw_ring_gate.sh` in verify mode 0 audit problems and 0 stale fingerprints, **144 PASS / 54 UNCERTIFIED / 234 N/A / 0 FAIL / 0 UNMEASURED**, `GATE PASS`, its output equal to S4b C2's in every line but the directory paths; the control-level N/A proofs print; S1c controls 147 runs, 135 caught, 12 passing as declared. Tree forms: every action stamp unlifted, 758 in all (MMC1 257 = 142 empty patch set + 115 sabotage only, MMC3 258 = 160 + 98, UNROM 512 243 = 144 + 99), 0 carrying the lift; every RPG stamp lifted, 1,009 (MMC1 329, MMC3 348, UNROM 512 332), plus 12 ring-0 builds (6 pristine, 6 lifted) and 6 comparisons; `lifted === liftNeeded` on every stamp; every ring-1 and ring-2 stamp production-kind with consumed-input evidence and an exact-content proof (the comparisons carry the patched side's), 0 prototype kinds, every stamp the final fingerprint and baseline `bb43a2c`. **ROMs: all 1,764 built ROMs equal the same-named ROM of the S4b C2 matrix** (the pilot's 1,589 and C1's 98 were the previews). Row 5: 18 positives, 14/14 items, every certified margin positive, tightest 33.67 (mixed) / 115.67 (strip) on MMC3-H RPG banked; observed minimum, bound W and certified margin equal S4b C2's for all 18 cells, **no margin changed**. Logs: of 319, 271 are byte-identical to S4b C2's; 29 identity logs differ in their provenance block only; 17 row-8 Mesen control logs (MMC3 cells) are one frame shorter in their measured counts (byte-identical to S4a C2's), with calls, IRQ counts, statuses and verdicts unchanged; and the two `pad-mainline-over` witness logs (`s1b-pad-over-MMC3-H`, `s1b-pad-over-U512-V`), control jobs contributing to row 9, differ by one Mesen body (375 to 374, 370 to 371): the final over-budget body at the `chase`/`walkD` phase endpoint was removed or added, the shared prefix is identical, `cost:events` in the U512-V witness moves with it (`sw_goto` 1,611 to 1,614, `sw_locate_current` 1,555 to 1,558, `sw_peek_byte` 892 to 895), every item status and verdict is unchanged, and no root cause is proven. The **positive measurement records** (the 18 positive S1b records supplying row 4, every row-5 and row-6 positive record and the six row-8 positives) are byte-identical, so the UNROM 512 action positive records are exactly the ones measured on the lifted tree; no equality is claimed for the 29 identity provenance logs, the 17 row-8 controls or the two pad witnesses.

### The UNROM 512 production table

The two UNROM 512 **action** cells measured on **unlifted production code** (the tree is `bb43a2c` with no patch, ROM equal to `node main/build/cli.js` output at N = 4, 61 and 255). Resident build; action × banked is N/A on every board. Figures for rows 4 to 6 are byte-identical to the logs of the S4b C2 matrix, where this tree carried the lift: production admits the same code the lift used to force. N is the world size the row's scene was built at: S1b, which supplies rows 2, 4 and 7, runs the ordinary action workload at the deepest size capacity admits, 255 screens vertical and 61 horizontal; the identity (row 1) and oracle (row 3) scenes are N = 4 builds (`grid` 4x1 vertical, 1x4 horizontal), and rows 5 and 6 build their four-screen interrupt scenes.

| | U512-V (vertical mirroring) | U512-H (horizontal mirroring) |
|---|---|---|
| N (S1b / rows 5, 6) | 255 / 4 | 61 / 4 |
| gate row, Mesen / jsnes | 1 P/P, 2 C/C, 3 P/P, 4 C/N, 5 P/N, 6 P/N, 7 N/P, 8 N/N, 9 P/N | the same |
| stamps (unlifted) | 72 empty patch set, 51 sabotage patch only | 72 empty patch set, 48 sabotage patch only |
| row 4 largest measured `G` (cycles; gate 29,780) | 18,624 (class C2); NMI handler maximum 2,102 | 20,026 (class C4a); NMI handler maximum 2,114 |
| row 5 observed margin, strip / mixed | 277.0 / 171.0 | 258.7 / 158.0 |
| row 5 bound W, strip / mixed | 2,030 / 2,119 | 2,042 / 2,132 |
| row 5 **certified** margin, strip / mixed | 214.67 / 125.67 | 202.67 / 112.67 |
| row 6 close frame | 88-byte queue (`vram_len` 87) split at the nametable join; margin 342.7 cycles | 85-byte queue (`vram_len` 84) in one packet; margin 376.7 cycles |
| row 8 | N/A (the split and lock are assembled only for MMC3) | N/A |
| row 9 | S1c controls caught as declared; `nmi-wrap-row-32` N/A | S1c controls caught as declared; `nmi-strip-len-30-vertical` and `nmi-wrap-col-30` N/A |

The RPG builds and the other boards' cells are in section 3's per-build table, unchanged. UNROM 512-H's 20,026 cycles is the largest measured `G` of the whole certificate (the same figure as before, at N = 61).

## 17. Slice S5, commit C1: the RPG lifecycle on a ring, pinned before the admission

S5 puts RPG games on the two-nametable ring. C1 is the tests-only commit: it admits nothing, edits no engine, `shared/` or `main/` file, and leaves every certificate and fingerprint alone. **RPGs on a ring are still refused by `validateProject` until C2** (the `ringGame` arm of `streamedBoardProblems`); every build below goes through `test/lib/ringbypass.js`, which neutralizes the whole two-nametable branch of the board check in a copy and nothing else, so the engine, the generator and `checkCapacity` are production. C2 flips the refusal. Round 1 wrote the tests; fix round 1 (review 1, F1-F6) corrected the audit, widened the witnesses and added the ceiling work below.

### The audit

| row | before C1 | after C1 (fix 1) |
|---|---|---|
| (a) battle return vs the oracle, both nametable indices, both axes | return covered (`streamringredraw`/`streamringhredraw`, the gate's `battle-return-no-render`); **entry with a strip in flight** four-screen only (`streamworldlifecycle.test.js`) | `streamringrpg.test.js` "(a) call_battle cancels an in-flight strip" x 12, "(a)(e) a battle round trip" x 12, and (fix 1, F2) "(a) the first picture after a battle return matches the oracle" x 24 (6 cells x {resident, banked} x live nametable 0 and 1): a real fight, nonzero local scroll, and at the FIRST display-enable after the return the `$2000` nametable select, the `$2005` pair and the live nametable and attribute contents are compared with `ringoracle.js` before any further frame can repair them |
| (a)(f) the return contract of `call_battle` | gap on a ring | (fix 1, F3) "call_battle(BE_RESTORE) returns with the field's PRG window and mtptr" x 6 resident, "a banked dialogue overlay entry (BE_DLG_ARROW) returns ..." x 6 banked: the field location's PRG window differs from the battle bank's (MMC3-H banked screen 2 is the reviewer's construction; vertical rings put the field at screen 55 of 60), `mtptr` and `bt_arg` poisoned before the call, window bytes and `mtptr` required to be the field's on return |
| (b) naming grid on a streamed ring RPG | gap | "(b) the naming grid draws the same picture at the nametable seam as aligned" x 6 |
| (c) MMC3 split and lock across battle, Continue, warp | gap in jsnes; Mesen harness has no stimulus | `streamringsplit.test.js` x 8 (jsnes). Frames observed: the battle test checks EVERY frame boundary from the first idle field frame (the frames `bootToField` runs before it are not observed) through walk-in, entry, the command helper's own press and settle frames (`chooseCommand`'s per-frame callback, fix 2), fight and return; the Continue and warp tests check every frame from the one after `runSteps`/`bootToField` hands back (the helper's own frames are not observed). **Mesen half not done**: the row-8 harness only walks the ring and delays inside `switch_prg_bank`; a battle/Continue/warp op is an edit under `test/lua/ring_gate/`, the gate (C3) |
| (d) a session start clears `st_active` | gap on a ring | two separate contracts (fix 1, F6; round 1 had attributed it to the resolver alone). (d1) `init_session` is `jmp call_battle` with `BE_INIT`, and `call_battle`'s strip cancel clears `st_active` for every non-`BE_DLG_*` entry, so a session start cancels a stale strip **transitively**; (d2) `sw_resolve_screen` clears it again on every real landing. "(d1) init_session cancels a stale strip through call_battle(BE_INIT)", "(d2) sw_resolve_screen clears a stale strip on a real landing", "(d3) a restart landing carries no strip in its first picture" (the net effect: it fails only when BOTH mechanisms are gone) x 6 cells each |
| (e) `settle_owed` / `screen_fresh` after a battle, a warp, a Continue | four-screen only | the round-trip tests (first display-enable after the return: `screen_fresh` 1, `st_active` 0; the entry event does not replay), "(e) a warp landing ... settles its entry event once" x 6, "(e) a Continue landing ... settles its entry event once" x 6 |
| (f) banked-placement close frame at the RPG ceiling | partly (resident, N = 4) | `streamringresources.test.js`, C1's own scene (`ceilingCloseProject`, `test/lib/ringrpg.js`; the gate's `ringclose.mjs` is untouched; 26 tests), talker on the second-deepest live screen so the deepest row's address arithmetic runs, per board x placement: (1) the mixed scene (an ordinary map beside the world, so `flip_tick` assembles and the queue is Flip + Flash + arrow + row) at that scene's own ceiling, one region shallower than the board's; (2) the streamed map alone (no bound tile, so no Flip) at the board's universal RPG ceiling, 13 / 29 on MMC1-H / MMC3-H and, on UNROM 512 horizontal, **59 (the certified depth) and 60 (admitted, not yet measured: C3)**; vertical rings 247 mixed and 255 alone (the 255-screen grid limit, not capacity). Each run keeps the assembled overlay-address check (`sw_dlg_single` inside `$8000-$BFFF` exactly when the placement is banked) |
| (g) ruling 3 on an RPG | gap (action only) | "(g) ... a save made on vertical mirroring Continues on horizontal after a mirroring-only edit" x 3 boards: token and identity unchanged, party hit points and the saved variable restored, both live nametables equal the oracle, control without the save has no Continue (battery SRAM on MMC1/MMC3; the flash sector carried into the other ROM on UNROM 512) |
| (h) resource matrix on ring builds | `kernelbytes.test.js` already covers the ring kernel-hi/lo allowances (around lines 5413-5535, including the horizontal rings, action and RPG); `bankedbytes.test.js` has no streaming build, so no RPG battle region was measured on a ring | "(h) ring build resources" x 30 builds (6 action resident + 24 RPG: 6 cells x {resident, banked} x hero naming {off, on}; the 18 naming-off rows are the table below, action x banked being N/A) and "(h+) the eight battle features" x 12 (below) |
| (i) depth, proof gate half | not measured for RPGs | below |

### Depth (i): certified 60 (S5 C3; 59 at S4c C2), universal ceiling 60 on UNROM 512

Two numbers, not one, and since S5 C3 they are the same on every board. **Certified**: the ring gate runs each RPG cell at the deepest world its own workload admits, MMC1-H N = 13, MMC3-H N = 29, U512-H N = **60**, resident and banked (S5 C3 certificate, `handoff-next/s5-c3-logs-final/s1b-<cell>-rpg-<placement>.json`, field `n`; at the S4c C2 certificate U512-H ran at 59, `handoff-next/s4c-c2-logs-final/`, kept as history). **Structural ceiling**: the most 8 KB regions any RPG project can give streamed worlds, 13 / 29 / 60. MMC1 and MMC3 keep their tilesets in CHR ROM, so their ceilings do not depend on the project; on UNROM 512 every tileset takes an 8 KB CHR region, so the ceiling is 62 regions - 1 minimum CHR payload - 1 RPG code region = **60**, reached by a valid one-tileset RPG (`project.tilesets` of length 1, `rpg.battleTilesetId` 0: the battle uses the field's tileset), while the default RPG has two tilesets (Main + Battle) and reaches 59. The gate's S4c C2 workload was the default two-tileset one, so the 60th row of UNROM 512 horizontal RPG was admitted by the capacity check and built, and ran a banked close frame in the C1 tests, but was not measured by the ring gate (Chris, 2026-10-14: "Measure it in C3"). **S5 C3 resized the U512-H RPG gate cells to the one-tileset workload and measured it: the 60th row is certified** (section 19: both cells' S1b records at N = 60, `path:deepest-row` witnessing a `sw_goto` at row 59, an exhaustive read-cost sweep, and a worst non-exempt `G` of 19,427 / 19,423 against 29,780).

Each figure with the workload it was measured on (`handoff-next/s5-c1/measure.mjs`, log `measure-fix1.log`):

| cell | project | lightest, two tilesets | lightest, one tileset | gate workload (no per-screen talkers; banked adds 3000 chars) | gate workload, one tileset | per-screen enter talkers, resident / banked |
|---|---|---|---|---|---|---|
| MMC1-H | action | 14 | n/a | 14 | n/a | 14 / n/a |
| MMC1-H | RPG | 13 | 13 | 13 / 13 | 13 / 13 | 13 / 13 |
| MMC3-H | action | 30 | n/a | 30 | n/a | 30 / n/a |
| MMC3-H | RPG | 29 | 29 | 29 / 29 | 29 / 29 | 29 / 29 |
| U512-H | action | 61 | n/a | 61 | n/a | 37 / n/a |
| U512-H | RPG | 59 | **60** | 59 / 59 | 60 / 60 | 59 / 37 |

The structural ceiling is pinned the way `streamadmit.test.js` (f) pins the action one: "(i) depth pin" x 3 takes the maximum over `screenRegions(mapper, tilesets 0..4, bankedCode 1, {reserveFlashSave false/true})`, requires the lightest one-tileset RPG to be admitted at N and refused at every height from N + 1 to 255 with only Map Forge errors, requires the same of the default two-tileset project at 13 / 29 / 59, and builds both ceiling worlds (the U512-H one-tileset 60 row builds through the bypass; 61 is refused with "need 61 of the 60 8 KB program regions"). A second test pins that the two-tileset gate workload (the campaign scenes) bisects to 13 / 29 / 59 and the one-tileset gate workload, which the S5 C3 gate cells run, to the structural ceiling, which is the certified N. A future change that admits an RPG deeper than 13 / 29 / 60, or shrinks 60 below the certificate, fails them. (An enter talker per screen plus the 3000 characters is a workload, not a gate gap: 37 on U512-H.)

### Resource matrix (h) and the eight features (h+)

n = 4, one enter talker per screen; banked = 3000 characters. Columns: kernel-hi free / kernel-lo free / kernel code actual / reserved by `kernelCodeBytes` / battle region (assembled = predicted by `battleRegionBytesPlaced`; ceiling 8,172). No build has a capacity error.

| board | game | placement | kernel-hi | kernel-lo | code / reserved | battle region |
|---|---|---|---|---|---|---|
| MMC1-V | action | resident | 1056 | 1637 | 6090 / 6112 | n/a |
| MMC1-V | RPG | resident | 1113 | 1404 | 6323 / 6345 | 4268 |
| MMC1-V | RPG | banked | 1053 | 1392 | 6327 / 6349 | 5607 |
| MMC3-V | action | resident | 1056 | 1459 | 6268 / 6290 | n/a |
| MMC3-V | RPG | resident | 1113 | 1215 | 6512 / 6534 | 4308 |
| MMC3-V | RPG | banked | 1053 | 1203 | 6516 / 6538 | 5647 |
| U512-V | action | resident | 1056 | 1445 | 6279 / 6301 | n/a |
| U512-V | RPG | resident | 1113 | 1209 | 6512 / 6534 | 4268 |
| U512-V | RPG | banked | 1053 | 1197 | 6516 / 6538 | 5607 |
| MMC1-H | action | resident | 1056 | 1634 | 6093 / 6115 | n/a |
| MMC1-H | RPG | resident / banked | 1113 / 1053 | 1401 / 1389 | 6326 / 6348, 6330 / 6352 | 4268 / 5607 |
| MMC3-H | action | resident | 1056 | 1456 | 6271 / 6293 | n/a |
| MMC3-H | RPG | resident / banked | 1113 / 1053 | 1212 / 1200 | 6515 / 6537, 6519 / 6541 | 4308 / 5647 |
| U512-H | action | resident | 1056 | 1442 | 6282 / 6304 | n/a |
| U512-H | RPG | resident / banked | 1113 / 1053 | 1206 / 1194 | 6515 / 6537, 6519 / 6541 | 4268 / 5607 |

Reserved minus actual is 22 bytes on all 18 builds in the table (inside the `[KERNEL_SLACK, 2 x KERNEL_SLACK]` window `assertCovers` asks for); predicted equals assembled battle bytes on all 24 RPG builds (the 12 in the table and their 12 hero-naming twins); hero naming adds 827 bytes of battle region on every board in both placements (`NAME_ENTRY_BATTLE_ALLOWANCE` 737 + `NAME_COPY_BATTLE_ALLOWANCE` 43 + `STREAMWORLD_NAMEENTRY_BATTLE_ALLOWANCE` 47), pinned the same way. Action x banked is N/A on every board (an action project has no battle bank).

The matrix above leaves eight optional battle features off; fix 1 (F4) measures them: per RPG board x mirroring x placement (12 cells), a baseline with a metasprite and animation catalog, two spells, a Potion actor and a Monster actor, then each feature switched on by one field. In every one of the 12 builds each `projectUses*` predicate is TRUE in the build that carries the feature and FALSE in its baseline, the assembled battle region equals `battleRegionBytesPlaced`, the isolated code delta equals the feature's own allowance, and one more build with all eight on at once also assembles to its prediction:

| feature | predicate | isolated delta = allowance (bytes) |
|---|---|---|
| items | `projectUsesItems` | 17 (`ITEM_LIST_FILTER_BATTLE_ALLOWANCE`) |
| magic power | `projectUsesMagicPower` | 62 |
| magic defence | `projectUsesMagicDefence` | 56 |
| monster spell list | `projectUsesMonsterSpellList` | 125 |
| battle animation | `projectUsesAnyBattleAnimation` | 264 |
| party attack animation (against a baseline that already has the monster animation) | `projectUsesPartyAttackAnim` | 10 |
| hit feedback | `projectUsesHitFeedback` | 235 |
| miss | `projectUsesMiss` | 134 |

Battle region bases: 4394 (MMC3, resident), 5733 (MMC3, banked), 4354 / 5693 (MMC1 and UNROM 512); with all eight features on, 5377 / 6722 and 5337 / 6682, under the 8,172 ceiling. **Coverage claimed is what is listed**: the baseline, hero naming, the dialogue overlay placement and these eight features. Allowances not on that list (for example the Save, Move, shop and level-up terms) were not measured on a ring build in C1. **No allowance differs from what `checkCapacity` charges: no defect.**

### Tests and sabotages

Three files and two helpers, 179 tests (99 + 8 + 72), all passing on the production engine: `test/unit/streamringrpg.test.js`, `test/unit/streamringsplit.test.js`, `test/unit/streamringresources.test.js`; `test/lib/ringrpg.js` builds a ring project through the bypass, records the engine's state at each display-enable (`watchDisplayEnable`, with a `capture` mode for the `$2000`/`$2005`/VRAM snapshot) and owns the one-tileset RPG, the ceiling close scene and the eight-feature table; `test/lib/ringcloseframe.js` takes N and a caller-built project, can run a scene with no Flip, and returns the overlay address. Each test states in its header the wrong implementation it catches. `handoff-next/s5-c1/sabotage-fix1.mjs` applies one exact-once edit to a temporary copy of the tree and requires a failure; there is no "equivalent" class: see the report (`handoff-next/s5-c1-fix1-report.md`) for the table with the catching tests. Added in fix 1: the landing's `$2000` nametable select forced to 0 and its `$2005` x forced to 0 (F2), `set_screen_ptr` not re-locating the field after `call_battle` (F3; round 1 had called it equivalent, it is observed by the F3 tests), the banked placement's terrain read taking the resident path (F5), and neither session-start mechanism clearing `st_active` (F6).

The Mesen row-8 run for (c) is not done and is C3's: it needs a battle/Continue/warp stimulus op in `test/lua/sw_split_ring.lua.template` and `ringsplit.mjs`.

## 18. Slice S5, commit C2: a streamed RPG is admitted on the two-nametable ring

C2 is the admission commit. `streamRingGameTypes` becomes `['action', 'rpg']` on UNROM 512, MMC1 and MMC3 (`shared/cartridge.js`, the registry datum and nothing else), so a streamed turn-based RPG with horizontal or vertical mirroring, laid out N x 1 (vertical) or 1 x N (horizontal), validates and builds on all three boards. No engine file changes. The ring gate (`test/lua/ring_gate/`) is untouched: its `00-refusal-lift.patch` still deletes the `ringGame` arm, which is now a no-op for every registered board, and C3 rebaselines it, measures the 60th U512-H row and runs the one matrix.

### What is admitted, what is still refused

Unchanged, for both game types: the dead-axis refusals (an RPG ring is N x 1 under vertical mirroring and 1 x N under horizontal, by the same `cameraAxes` rule as an action game), the grid ceiling (255 per side, 255 screens), the capacity refusal (naming the Map Forge), NROM and the other non-streamable boards (`capability`, "cannot stream a world"), UNROM 512 four-screen (the torus, which already streamed an RPG). New: the `ringGame` refusal no longer fires for any registered board, and the Build panel's `switchableMappers` offers the ring boards to a streamed RPG (before, a streamed RPG on UNROM 512 four-screen was offered none).

Every message that names ring boards is generated from the registry and no longer carries the S4 "(action games)" qualifier: while both game types are admitted on the same boards the list is "UNROM 512, MMC1 or MMC3"; a datum that differs per game type is named per game type ("... (action games) and ... (turn-based RPGs)"). The full before/after table is `handoff-next/s5-c2/messages-before.txt` / `messages-after.txt`.

### The two arms that are now dead, kept and pinned

Chris (2026-10-14): keep both arms. `capability` "not implemented yet on this board" (a ring board with no datum) and `ringGame` (a board whose datum lacks the project's game type) are unreachable for a registered board, and stay as guards for a streamable board added without its datum or with a one-game-type one. Each is pinned on a **synthetic board** (`test/lib/syntheticboard.js`: a deep copy of the MMC3 entry, id 99, registered in `MAPPERS` for the length of one test and removed in `finally`; no production edit): `streamadmit.test.js` (b) asserts the kind, the exact message, `validateProject`'s error, the Build-panel preflight (`checkStreamedMapperSwitch`) and that `ringGame` pre-empts the dead axis. The docclaims entries for both warnings now fire on the synthetic board, and the README and `docs/reference-engine.md` sentences they anchor say what is true.

### Capacity: admitted, and certified by S5 C3

Through the real refusal (validate + `checkCapacity` + a real build, no bypass), `handoff-next/s5-c2/capacity.log`:

| board, horizontal 1 x N | one tileset: largest builds / smallest refused | default two tilesets |
|---|---|---|
| MMC1 | 13 / 14 | 13 / 14 |
| MMC3 | 29 / 30 | 29 / 30 |
| UNROM 512 | **60** / 61 | 59 / 60 |

Vertical N x 1 reaches the 255 grid ceiling on all three (256 is the grid's refusal, not capacity's). **60 on U512-H was admitted when C2 landed but not yet certified** (the S4c C2 gate's RPG cells ran at 59); the S5 C3 matrix measured the 60th row and certified it (section 19). `streamringresources.test.js` (i), the depth pin, now takes its admission verdicts from the real `validateProject` and `checkCapacity` and builds its ceiling worlds through the real `buildProject`, so it fails if a future change admits an RPG deeper than 13 / 29 / 60; `streamadmit.test.js` (g) pins the same figures plus the smallest refusal's wording.

### Saves (ruling 3) on an RPG

`streamringrpg.test.js` (g) builds the save ROMs through the real tree: a save made under vertical mirroring Continues under horizontal after a mirroring-only edit (the party and the ring survive, nametable and attribute oracle after the landing), on MMC3 and MMC1 (battery RAM) and UNROM 512 (flash sector); a resize (`growOrShrinkMap`) redraws `saveCompatToken` and the resized ROM refuses the old save. `streamadmit.test.js` (e) pins token and identity for both game types on all three boards.

### Evidence

- The six fixtures are byte-identical (hashes equal `fixture-hashes-r4-before.txt` before and after; `build:sample`, `build:sample:rpg` and the four save-check fixtures through `cli.js` produce the ROMs recorded in `handoff-next/s5-c2/fixture-roms.txt`, every before/after pair equal).
- Production vs lift, for **every RPG project the ring gate builds**: `handoff-next/s5-c2/identity.mjs` parses the gate's own job list (the `jobs` function of `test/lua/ring_gate/ringjobs.mjs`, 377 jobs), maps each of the 124 jobs that build an RPG to the project(s) it builds, and fails loudly on a job it cannot map. That is 1,287 job-project links, 917 distinct builds (586 `ringProject` projects of the campaign, oracle and identity runners; 252 S1b witness scenes built through the gate's own `runManifest` / `measureMove` with `prepareOnly`; 12 S1b touch-body calibration scenes, the separate lead-less Move scene `ringwork.runWitness` builds through `calibrateTouchBody` whenever `needsCalibration(spec)` holds, here the `mv-lead` spec on each of the six cells and both placements, reused by the fault job; 66 row 5/6/8 builds through the gate's own `buildNmiRing` / `buildCloseRing` / `buildSplitRing`; 1 scene of the harness unit `prov-unit`) and 887 distinct ROMs. Each builds the same ROM from the C2 tree with no patch as from the 51e8f72 tree with `00-refusal-lift.patch` applied (it applies cleanly with `-p2`): **917 of 917 byte-equal**. By kind: campaign 544 distinct scenes (556 rows) plus its 2 RPG controls, oracle 42, identity 12 (the 28 sabotage jobs reuse those 12), S1b witness 252 scenes plus 12 calibrations (12 jobs; the fault job maps to the same 21 scenes and the same calibration), row 5/6/8 positives 12 / 12 / 4 and RPG controls 12 / 12 / 14. The six harness unit jobs are audited one by one: each is re-run in a pristine 51e8f72 worktree under a build hook (`handoff-next/s5-c2/buildaudit-hook.mjs`) that records every `nesasm` assembly, and the audit fails if a job's RPG ring assemblies are not exactly the ones named. `s1c-unit` assembles two (MMC3-H and U512-H rpg banked, `wcetBuild`), both the row 5 positives; `prov-unit` assembles eight (the MMC1-V and MMC1-H rpg identity projects at `prov_unit.mjs:653`, `:755`, `:927`, the same two in a `render-four-nts` sabotage tree at `:969`, and the N=4 `SCENE` at `:954`, which is one new compared build) and refuses the rest with their reasons (generator capacity at `:115`, tree proof at `:688`, consumed-input guard at `:898`, `:915`, `:936`, `:942`); `judge-unit`, `record-controls`, `s1b-unit` and `iso-unit` assemble no RPG ring project. Two cross-checks: the S1b ring specs equal the gate's own `prepareRing` result for all 252, and the 54 row 5/6/8 builds without a post-build byte patch equal the gate's own lifted-tree ROM. Jobs mapped to no project carry their reason in the log (action-only, row-8 non-MMC3 N/A, declared-exit-2 selection errors, the capacity table, the mapper-30 four-screen repro and no-flag jobs, the report generators). `handoff-next/s5-c2/identity-fix2.log` supersedes `identity-fix1.log` (904 builds: no calibration and no harness-unit scene) and round 1's campaign-only `identity.log`.
- The identity certificate is renewed as `test/fixtures/identity-cert/s5-c2.json` (the generator fingerprint moved: `shared/` and `main/build/` changed; the engine is unchanged) and the crossstage exclusions evidence's `prov.new.generator` is refreshed, both by their documented tools; `s4c-c1.json` and earlier are history: the S3 C1 through S4c C1 certificates may only fail on the generator binding, while the door-landing and S2 certificates fail both the engine and the generator bindings (`harnesstransfer.test.js` asserts each).
- Sabotage: `handoff-next/s5-c2/sabotage.log`.

## 19. Slice S5, commit C3: the ring gate rebaselined onto S5 C2 (no lift left), the 60-row UNROM 512 RPG, and row 8 across a battle, a warp, a Save and a Continue

C2 (section 18) admitted a streamed RPG on every ring board, so no cell on either game type needs the refusal lift. C3 is **harness-only** (`test/lua/ring_gate/`, `test/lua/sw_split_ring.lua.template`, `test/lua/run_sw_move_manifest.mjs`, `test/lib/ringrpg.js`, tests, docs; nothing under `engine/`, `main/`, `shared/`
or any `sample*` fixture changed). **Round 1 was the rebaseline, the new stimulus, their units and a pilot; the one full matrix then ran on exactly the reviewed tree (the reviewer's CODE-ACCEPT, after fix 1 and fix 1b).** The bullets up to "Expected matrix" describe the harness and the pilot as they stood before that run; the measured table (section 3) and the production table at the end of this section are written from the matrix, and **60 is certified because both U512-H RPG cells passed it**.

- **New baseline.** `BASELINE` is `f3833dbefe85378b6d305f16a0bb341fd5044e96` (S5 C2). The exact-content proof, the consumed-input guard and the stamp schema (`ring-prov-3`) are unchanged.
- **The lift is retired, not kept empty.** An always-empty mechanism is a path nobody exercises that still has to be maintained, and "kept for symmetry" is exactly how a stale list survives. `00-refusal-lift.patch` is deleted; `patchSetFor(true)` throws; `liftNeeded` survives only as
  a *guard*: it is derived from `BASELINE`'s own `shared/cartridge.js` (`streamRingAdmitted`), must be false on all 18 cell x game-type pairs (`checkNoLiftNeeded()` returns the 12 distinct pairs it walks), and a future baseline that stopped admitting a cell fails loudly instead of quietly lifting it again.
  The lift's name and its last committed bytes (`61ed7f3`, sha-256 `3943e831…`) live in `RETIRED_PATCHES`, so a stamp that still lists it is refused *by name*. `canonicalPatches`, `verifyProduction`, `makeCellTree`, `forCell`, `assertCellRing` and `forRing` refuse a lifted tree.
  Both dead production arms (`capability`, `ringGame`) stay as guards in production (Chris, section 18); **nothing in the harness depends on either**: no cell asks the registry whether a game type is admitted, because the answer is "all of them" and the baseline guard says so once.
- **The audit says it positively.** `ringprovindex.mjs` fails the audit when a stamp lists the lift ("no stamp carries a lift"), when a cell is declared lifted ("production refuses it" -- it does not), and when a proof's `lifted` is anything but exactly `false`. The audit prints "no stamp carries a lift: N of M" on success.
  `prov_unit.mjs` pins each of the three, the independent `liftNeeded` table, the narrow historical waiver (the same four kinds, one `PRE_C2_BASELINE`, no new kind under an old baseline) and the plain-production equality (a gate cell tree equals `node main/build/cli.js` on the same project for 12 cell x game-type pairs).
- **`run_identity.mjs` caveat.** Its ring-0 patched side now takes `forRing(2)`; at this baseline that is the same bytes as the pristine tree, so ring-0 row 1 proves the harness path and not a code difference. The code-difference evidence for the lift's retirement is the identity certificate `s5-c2.json` (every RPG project the gate builds is byte-identical from C2 unpatched and from `51e8f72` plus the lift).
- **Sabotage patches.** `regen_patches.mjs` cuts each patch once against `BASELINE` (no lift stage; every anchor unique-checked). Nine sabotage patch files moved: their `index` blob ids, and, for two, hunk context (C2 reworded one comment in `main/build/generate.js`). No mutation instruction changed.

### The 60-row UNROM 512 RPG

The gate's RPG scene had two tilesets (Main + Battle), which on UNROM 512 takes one more 8 KB region than the lightest valid RPG: the S4c C2 certificate's RPG cells ran at 13 / 29 / **59**, and the board's real ceiling is 60 (section 18, `streamadmit.test.js` (g)).

- **The rule is derived, not listed.** `rpgLayoutFor(cell)` (`ringcli.mjs`) builds the gate's RPG workload twice through a fresh plain `BASELINE` tree -- default two tilesets, and one tileset with `rpg.battleTilesetId` = the field's -- and takes the layout whose `maxWorkloadN` is **strictly** deeper; on a tie the two-tileset project stays. Measured:
  MMC1-V 255 / 255, MMC1-H 13 / 13, MMC3-V 255 / 255, MMC3-H 29 / 29, U512-V 255 / 255, **U512-H 59 / 60**. So exactly one cell changes (U512-H RPG, resident and banked: N 59 to 60) and every MMC1, MMC3 and vertical RPG cell keeps its S4c C2 project and ROM.
- **Where the layout is applied.** As the scene's own `mutate`, which `buildSceneProject` runs before normalization and validation (`layoutMutate`, the leaf `ringlayout.mjs`; `oneTilesetRpg` is defined there once and `test/lib/ringrpg.js` re-exports it). It is **not** an option of `sw_manifest_scene.mjs`: that file is one of the six
  pinned harness files (`sw_provenance.mjs` `HARNESS_FILES`), whose hash every curve and identity certificate binds, and editing it moves the harness under evidence S5 C2 renewed (an earlier draft did; the first `npm test` caught it in five tests). A unit asserts that no pinned file mentions the layout.
- **A unit holds the ceiling.** `s1b_unit.mjs` hardcodes the production RPG ceiling per board, re-derives it from the plain tree's own capacity check on the lightest valid RPG, and fails if the gate's RPG cell on any board, resident or banked, runs shallower (forcing `oneTileset: false` fails it).
- Rows 5 and 6 run their interrupt scenes at N = 4 (`ringProject`) and `ringcapacity.mjs` `MAX_N` / the campaign keep their S4c C2 depths; only the workloads that ask `maxWorkloadN` (S1b's rows 2, 4 and 7, and the Move/close measurements) deepen.

### Row 8 across a battle, a warp, a Save and a Continue (MMC3 RPG)

C1 deferred the Mesen half of obligation (c): the MMC3 split and `split_lock` across a battle, a warp and a Continue. Row 8's ordinary run only walks the ring, pokes `split_mode` and delays inside `switch_prg_bank`; on an RPG it now also drives the real lifecycle.

- **The session** (`sw_split_ring.lua.template`, lifecycle mode; `ringsplit.mjs` `lifecycleScene`): a separate session ROM per MMC3 RPG build (resident and banked, V and H), the title screen, a Slime on the field screen, a touch Doorway to the next screen, a touch Saver on the field screen and an arrival Saver. Mesen runs two parts in one private HOME so the battery file persists:
  **part A** starts a game, walks into the Slime, loiters in the battle for the in-battle trials, fights it to the end, walks into the Doorway (a warp), and is saved by the arrival Saver (or, in the `lc-skip-warp` control, by the field's own Saver after no warp); **part B** powers on, chooses Continue and lands. No `split_mode` pokes: the engine's own state drives the split.
  **Where the register file is read: a completed return boundary, never a frame end.** `main_loop_ready` (`engine/boot.asm`) is reached straight after `ui_tick` returned -- in a battle, after `call_battle` returned, and `call_battle` ends `jmp set_screen_ptr` (`engine/banks.asm`), so the restore *is* the return. The main thread is single, so no `switch_prg_bank` is open at that point. The recorder prints one `M` event on every `main_loop_ready` pass of the session, and every mark (`field`, `battle-in/mid/late/ret/out`, `warp-out`, `save`, `cont-out`) is taken at such a boundary (it was first taken at the end of the frame, which is not one: the main thread can be inside a delayed `switch_prg_bank` when the frame ends, with the previous pair still in R6/R7 and `split_lock` not yet up -- legitimate, and a judge that sampled frame ends would reject it; the retained positives have such frame ends in the battle). The judge reads the simulated register file at each boundary and never at a frame end.
- **Two new items on the 13 row-8 items of an RPG** (15 in all; 13 on an action game, which has no lifecycle): `r8:lc-return` -- at **every** return boundary with `game_state` = battle the lock is down and the PRG pair is coherent and equal to the field's (R1 is `chr_r1` or the font page); at the first boundary after the fight and at every boundary from it up to the `battle-out` mark (about 72 in the pilot, against about 304 in the battle) the field is fully back: the pair, R0/R2-R5, `chr_r1`, R1 on the tileset page (the font page only while a split program is still selected), `game_state` 0 and the same screen; the scripted marks repeat the checks (the immediate `battle-ret` mark as strictly as `battle-out`), and at the warp, Save and Continue marks the lock is down, the pair coherent, R0/R2-R5 and `chr_r1` the field's, the landing screen of a warp the warp's target and of a Continue the Save's. What it does not claim: the pair at a *frame end* (see above), or which bank a screen *should* be on beyond "coherent, not the battle bank, equal to the last `switch_prg_bank` argument" (that last is `r8:prg-window`'s);
  `r8:lc-coverage` -- every mark is present, >= 60 battle boundaries and at least one after the fight were observed, the Save wrote SRAM, both parts finished, and the battle really exercised the split (>= 60 armed battle frames, >= 40 IRQs, >= 40 `switch_prg_bank` calls with >= 20 into the battle bank, NMIs landing at both interesting write positions inside a call). The plain items (arm/IRQ grammar, count, PRG group/window, terrain, lock, deadline, totals) are judged over the plain run *and* both session parts and folded.
  Forced-blank frames and title frames are not judged as world frames; the latch rules follow `split_mode` (box or battle), not an event.
- **Controls.** Every new item has a positive and a sabotage: `split-bank-restore-lost` (`engine/screens.asm`: the field's window is not restored after `set_screen_ptr_ordinary`; fails `r8:lc-return`) and `split-lc-skip-warp` (the session takes no warp; fails `r8:lc-coverage`), each on MMC3 V and H, rpg resident and banked (8 jobs). The seven existing split controls now also run on the session of rpg banked and stay caught
  (`no-sei` and `wrong-r1` additionally fail `r8:lc-return`). Section 5's scoping is kept: `prg-r7-wrong` stays an action-resident control (on an RPG banked scene a run that does not finish is not a catch).

### Sabotages, plain production, the pilot, and what the matrix is expected to show

- **Sabotages.** Every ring sabotage patch applies exactly once at `f3833db` and changes the code it names, on both forms of both rings. The equivalent-mutant sweep (S4c C2's instrument with the lift removed, plus the two one-tileset 60-row U512-H RPG builds): 532 rows = the 480 of S4c C2 and 52 new ones (28 sabotages x ring x cell x build, now with
  resident and banked U512-H RPG at N = 60): **93 identical** (S4c's 84 plus 9: `continue-pos-zero`, `move-scroll-stale`, `shake-no-nt-flip` and `shake-nt-eor2` on the two new builds, and `forced-banked` on U512-H RPG banked at 60), 419 differ, **17 predeclared build-error witnesses** (S4c's 15 plus `ring-forced-0` on the two new builds) and 3 excluded (`wrap-row-32` on ring 1, `wrap-col-30` and
  `strip-len-30-vertical` on ring 2, which have no form there). No lifted tree exists, so no row differs by a lift. The identical set is the same feature-conditional one as before.
- **Plain production.** `handoff-next/s5-c3/cli_compare.mjs` builds ten gate cells (RPG on every board, resident and banked, U512-H at N = 60 included, and three action cells) through the gate's cell tree and with `node main/build/cli.js` on a copy of the same project in a fresh directory, no bypass: the ROMs are byte-identical, the patch lists empty, the proof `lifted: false`.
- **Pilot** (`handoff-next/s5-c3/pilot-*`, 213 of 385 jobs, one or more of every one of the 128 job kinds): 212 jobs met their declaration; the one that did not is `s1c-gate`, which cannot pass on a partial selection. 1,411 stamps, `ringprovindex.mjs --verify` clean (0 problems, "no stamp carries a lift: 0 of 1,411"), the gate in VERIFY mode reports the index and one 250-entry harness fingerprint clean. The pilot found one defect before the matrix did: the provenance audit still expected a row-8 run to retain
  exactly one Mesen invocation, so the three-invocation session was refused (now audited as plain run + part A + part B, with the lifecycle ROM and Lua named in the hashed plan; `s1c_unit.mjs` pins each way to get it wrong). **All 1,380 pilot ROMs that have an S4c C2 counterpart are byte-identical to it; the only 2 that differ are U512-H RPG resident and banked at N = 60 (S1b)**, and the 8 new row-8 controls have no counterpart.
  A pilot samples one job per kind; it cannot certify the unrun 172 jobs, the full grid, the measured table or the production table.
- **The 60-row evidence, from the pilot** (the matrix repeats it, below): both U512-H RPG S1b cells ran at N = 60; `path:deepest-row` witnessed a `sw_goto` at row 59 (59 iterations of the row loop); `cost:sweep` was exhaustive over the 60-screen ring (13 kernel layouts, every (current, target) pair); the worst non-exempt `G` is **19,427** (resident) and **19,423** (banked), class C3a, against `G < 29,780` (S4c C2's 59-row cells: 19,373 and 19,366). Rows 5 and 6 at N = 4 are unchanged
  for every RPG cell on every board (observed margins, bounds W and certified margins equal to S4c C2's: the tightest certified margin stays 33.67, MMC3-H RPG banked; U512-H RPG close margin 375.3 cycles).
- **Expected matrix** (written before the run). 385 jobs (S4c C2 had 377: +8, the new row-8 controls). The gate table shape is unchanged (6 cells x 4 builds x 9 rows x 2 emulators = 432 results). Expected **146 PASS / 54 UNCERTIFIED / 232 N/A / 0 FAIL / 0 UNMEASURED** (S4c C2: 144 / 54 / 234 / 0 / 0): the only change is row 9, Mesen column, of MMC3-V and MMC3-H RPG *resident*, which had no control and was N/A and now has the two session controls (PASS).
  Every other cell must equal S4c C2's, and every ROM except the two U512-H RPG S1b ones must equal S4c C2's.

### Result of the final matrix

**The expectation above was met exactly.** `run_matrix.mjs` once, 2026-10-15 05:37 to 07:01 PDT (84 minutes), `--jobs=18`, exit 0, on the frozen harness (the reviewed diff, whose non-doc, non-`test/unit` part is unchanged by the documentation edits, and a 250-input fingerprint every stamp carries; it differs from the lifecycle pilot's only in `s1c_unit.mjs`, which fix 1b changed): 385 jobs, 0 unexpected, 1,793 stamps (1,772 built, 15 error, 6 ring-0 comparisons; S4c C2: 1,764 / 15 / 6, the difference being the 8 new controls), 0 problems under `ringprovindex.mjs --verify` ("no stamp carries a lift: 0 of 1,793"); `run_sw_ring_gate.sh` in verify mode: 0 audit problems, every stamp equal to this checkout's fingerprint, **146 PASS / 54 UNCERTIFIED / 232 N/A / 0 FAIL / 0 UNMEASURED**, `GATE PASS`. Its output differs from S4c C2's in these places and nowhere else: the provenance line (1,787 stamps counted without the ring-0 comparisons, against 1,779), rows 9 of MMC3-V and MMC3-H RPG resident (`N/N` to `P/N`), the totals, the row-9 N/A counts (jsnes 12 to 14, Mesen no-control 6 to 4, jsnes S1c-Mesen-only 6 to 4) and the judged-job count (376 to 384); all 24 rows of every other cell, the UNCERTIFIED list and every N/A proof, the control-level ones included, are identical.

- **Tree forms:** 1,793 of 1,793 stamps unlifted: 758 action (as S4c C2) and 1,017 RPG (MMC1 222 + 107, MMC3 250 + 106, UNROM 512 225 + 107 as empty patch set + sabotage only), 12 ring-0 builds and 6 comparisons, every stamp the final fingerprint and baseline `f3833db`, 0 prototype kinds (section 3).
- **ROMs:** 1,762 of the 1,764 built ROMs the S4c C2 certificate also built are equal; the two that differ are `s1b-U512-H-rpg-resident` and `-banked` (59 to 60 rows); 8 new controls and the lifecycle session ROMs have no counterpart.
- **Rows 5 and 6 (N = 4):** 18 row-5 positives, 14/14 items each, and 18 row-6 positives, 6/6 items each (all PASS), every row-5 certified margin positive, every observed minimum, bound W and certified margin equal to S4c C2's for all 18 cells (the 12 RPG cells now on unlifted code): the tightest certified margin stays **33.67 (mixed) / 115.67 (strip), MMC3-H RPG banked**, and row 6's least margin 278.0 (MMC3-V action resident); U512-H RPG certified 202.67 / 112.67 resident and 181.67 / 99.67 banked, close margin 375.3.
- **The 60th row.** `s1b-U512-H-rpg-resident` and `-banked` ran at **N = 60** on the one-tileset project: `path:deepest-row` PASS on both emulators (one arm `sw_goto` at row 59 ran the row loop 59 times, N - 1), `cost:sweep` PASS (13 distinct kernel layouts, every (current, target) pair of the ring called through `sw_peek_byte`, `sw_goto` and `sw_locate_current`; one of the 13 layouts, a resource-heavier one, is a 59-screen ring, which the record's per-layout sizes disclose) and `cost:events` PASS on both emulators with **0 events differing from the sweep** (resident 1,182 `sw_goto`, 4,987 `sw_locate_current` on both Mesen and jsnes, 729 `sw_peek_byte`; banked 1,182 / 5,143 on Mesen and 5,142 on jsnes / 729; zero price mismatches on either placement). The worst non-exempt measured `G` is **19,427** (resident) and **19,423** (banked), class C3a, against the strict `G < 29,780` (S4c C2's 59-row cells: 19,373 and 19,366; more than 10,000 cycles of room). Both cells have 167 of 183 items PASS; the other 16 are the declared N/A and UNCERTIFIED classes, as for the other horizontal RPG cells (the vertical RPG records have 168 of 183). **So 60 is certified.** The other RPG cells ran where S4c C2 ran them (MMC1-H 13, MMC3-H 29, the verticals 255), with unchanged worst `G` (17,297 / 17,310, 17,923 / 17,917, 18,413 to 18,895); the campaign (`MAX_N` 59 on U512-H) and the N = 4 interrupt scenes keep their depths (section 15's depth-independence argument for rows 5 and 6).
- **Row 8 across a lifecycle:** the four session positives (MMC3-V and MMC3-H, RPG resident and banked) pass all 15 items; `r8:lc-return` makes 1,541 to 1,544 checks per run (304 or 305 main-loop return boundaries in the battle and 72 from the first return after the fight to `battle-out`) and `r8:lc-coverage` sees 323 to 326 armed battle frames, 322 to 325 IRQs and 606 to 608 `switch_prg_bank` calls (303 or 304 into the battle bank), with the field's pair back at every mark (MMC3-H: 2/3 on the field screen, 4/5 after the warp). Controls: `split-bank-restore-lost` x4 caught by `r8:lc-return` (and `r8:lc-coverage` fails as a side effect), `split-lc-skip-warp` x4 caught by `r8:lc-coverage` alone, and the seven existing split controls on RPG banked, both orientations, caught by their declared items; `no-lock`, `no-sei`, `r0` and `wrong-r1` additionally fail `r8:lc-return` (undeclared extra catches), and `no-lock` and `no-sei` on MMC3-V now also fail `r8:prg-window`, which passed for them on the plain run alone.
- **Equivalent mutants and plain production** are as above (the sweep ran before the matrix, on the same tree).

### The RPG production table

The twelve RPG builds (six cells, resident and banked) measured on **unlifted production code** (the tree is `f3833db` with no patch, ROM equal to `node main/build/cli.js` output; the U512-H pair's S1b rows on the one-tileset 60-row project). Rows 4 to 6 are byte-identical to the S4c C2 logs where those cells carried the lift, except the S1b records of the U512-H pair, whose N moved. N is the world size the row's scene was built at: S1b (rows 2, 4 and 7) runs the RPG workload at the deepest size capacity admits for it (the table), the identity (row 1) and oracle (row 3) scenes are N = 4 builds, and rows 5 and 6 build their four-screen interrupt scenes. Row 8 is the MMC3 cells only (N/A elsewhere); gate rows, Mesen / jsnes, are `1 P/P, 2 C/C, 3 P/P, 4 C/N, 5 P/N, 6 P/N, 7 N/P, 8 N/N (MMC3: P/N), 9 P/N` for every cell and build except row 9 of the MMC1, U512 resident builds, which carry no S1c control (`N/N`).

| cell | build | N (S1b / rows 5, 6) | row 4 largest measured `G` (gate 29,780) | row 5 observed strip / mixed | row 5 bound W | row 5 **certified** strip / mixed | row 6 close margin (cycles) | row 8 (items; plain run) | cell's RPG stamps (empty patch set + sabotage only) |
|---|---|---|---|---|---|---|---|---|---|
| MMC1-V | resident | 255 / 4 | 18,895 (C2) | 277.0 / 171.0 | 2,030 / 2,119 | 214.67 / 125.67 | 344.0 | N/A | 112 + 55 |
| MMC1-V | banked | 255 / 4 | 18,856 (C2) | 271.0 / 168.0 | 2,049 / 2,130 | 195.67 / 114.67 | 342.0 | N/A | |
| MMC1-H | resident | 13 / 4 | 17,297 (C2) | 257.3 / 159.0 | 2,042 / 2,132 | 202.67 / 112.67 | 376.0 | N/A | 110 + 52 |
| MMC1-H | banked | 13 / 4 | 17,310 (C2) | 250.0 / 154.0 | 2,063 / 2,145 | 181.67 / 99.67 | 376.0 | N/A | |
| MMC3-V | resident | 255 / 4 | 18,630 (C2) | 213.3 / 108.0 | 2,096 / 2,185 | 148.67 / 59.67 | 279.0 | 15; 2,108 frames, 391 calls, 1,748 IRQs | 125 + 54 |
| MMC3-V | banked | 255 / 4 | 18,627 (C2) | 207.0 / 104.0 | 2,115 / 2,196 | 129.67 / 48.67 | 280.0 | 15; 2,089 frames, 391 calls, 1,732 IRQs | |
| MMC3-H | resident | 29 / 4 | 17,923 (C3a) | 193.0 / 94.0 | 2,108 / 2,198 | 136.67 / 46.67 | 313.0 | 15; 1,809 frames, 603 calls, 1,484 IRQs | 125 + 52 |
| MMC3-H | banked | 29 / 4 | 17,917 (C3a) | **186.0 / 90.0** | 2,129 / 2,211 | **115.67 / 33.67** | 312.0 | 15; 1,855 frames, 599 calls, 1,519 IRQs | |
| U512-V | resident | 255 / 4 | 18,413 (C2) | 277.0 / 171.0 | 2,030 / 2,119 | 214.67 / 125.67 | 343.3 | N/A | 113 + 54 |
| U512-V | banked | 255 / 4 | 18,422 (C2) | 271.0 / 168.0 | 2,049 / 2,130 | 195.67 / 114.67 | 341.3 | N/A | |
| U512-H | resident | **60** / 4 | 19,427 (C3a) | 257.3 / 158.3 | 2,042 / 2,132 | 202.67 / 112.67 | 375.3 | N/A | 112 + 53 |
| U512-H | banked | **60** / 4 | 19,423 (C3a) | 250.3 / 155.3 | 2,063 / 2,145 | 181.67 / 99.67 | 375.3 | N/A | |

Row 8 on the MMC3 RPG cells also runs the lifecycle session (part A and part B, the table's frame counts are the plain run's); a build carrying a control has `P/N` in row 9 (the MMC3 RPG resident builds now do). In the S1b depth / `G` and row-5/6 columns the U512-H pair is the only row of this table that differs from the S4c C2 certificate's RPG rows, and only in N and in `G` (19,373 / 19,366 at 59 rows). The row-8 column and the MMC3 cells' stamp counts also changed: MMC3 RPG row 8 grows from 13 to 15 items, and the two MMC3 cells' stamp subtotals grow by the eight new lifecycle controls (four per orientation); the ordinary row-8 frame, call and IRQ figures are unchanged, the session evidence is additional.

## 20. Slice S6, commit C1: release checks

S6 changes no code under `engine/`, `main/`, `shared/` or `renderer/`: the ring certificate of section 19 stands, and the identity fingerprint (250 inputs, `harnessFingerprint`) is equal before and after. What it adds is `test/unit/streamrelease.test.js`, five pins in `test/unit/docclaims.test.js`, and the documentation corrections below.

### What was audited

Four categories, each against the code rather than the prose: (1) the README, every figure and board list of the Streamed worlds and Camera rows, the mapper table and the four-screen paragraph; (2) every current-state sentence in the docs that still called a streamed board, game type or depth "refused", "not implemented yet" or "pending" (history in dated slice sections was left alone), with every named test and constant re-resolved; (3) the four refusal messages (`capability`, `ringGame`, `grid`, `deadAxis`) rendered for every board x mirroring x game type, checking that each names the right Forge, boards and axis; (4) ruling Q1, the Map Forge's size fields. The result: the README row was right except one clause (a default UNROM 512 RPG is 59 deep, not 60), ROADMAP item 15 and the status paragraphs of two design documents were stale, and no refusal text was wrong.

### Starters and the library on the ring

Every shipped starter, moved onto each of the six ring cells the way the Build panel does it (`reconcileCartridge`, camera on, every map streamed), with the result pinned by message:

| starter | UNROM 512 V / H | MMC1 V / H | MMC3 V / H |
|---|---|---|---|
| `blank-action`, `blank-rpg`, `overworld` | clean, builds | clean, builds | clean, builds |
| `dungeon` | refused: switch-bound tiles on a streamed screen | same | same |
| `rpg` | refused: kernel lookup-table bytes | clean, builds | refused: kernel lookup-table bytes |

Both refusals are older than the ring and their remedies work. The dungeon's first screen holds the project's only switch-bound tile; with only maps 1-3 streamed it validates on all six cells and builds. The `rpg` starter (Save commands, three maps, the camera) needs more kernel-lo table bytes than MMC3 or UNROM 512 have free once streaming takes its share. `checkCapacity`'s problem list already contains `validateProject`'s, so a probe that concatenates the two reports each error twice (the audit's did; the build and the Build panel's own lists do not). A map that is streamed beside ordinary maps is legal: there is no rule about what a door or warp points at, only each streamed map's own dead-axis rule (`streamedmixed.test.js` pins the engine for it; the overworld with only map 0 streamed on MMC3 horizontal validates and builds). A 2 x 1 map under horizontal mirroring, or 1 x 2 under vertical, is the `deadAxis` refusal on all six cells and nothing else.

`planLibraryImport` on a streamed ring project: all 22 library entries (5 terrain, 3 monster, 4 pickup, 8 sfx, 2 song) on all six cells and both game types, 264 plans, leave the input alone, equal the plan for the same project with streaming off, and apply to a project with no validate or capacity error. The function reads nothing about streaming.

### Q1: the Map Forge's size fields (Chris, 2026-10-15: record, do not fix)

The Map Forge has no streamed awareness. Each of its "Screens across / down" fields clamps the dimension you edit to `LIMITS.mapGrid` (4) and passes the other dimension through unchanged (`renderer/forges/map/map.js`: width `:2064`, height `:2072`, both into `resizeMap`), and `mapGridLimit(map)` (`shared/project.js`), written for them, is not called there. Everything below was run through the pure functions the handlers call (`growOrShrinkMap`, `duplicateScreenViaGrowthCore`, `validateProject`), with the handlers' own clamp.

- **Typing along the streaming direction of a long map shrinks it.** The audited case is a streamed 1 x 30 column (MMC3, horizontal mirroring): typing a height gives `resizeMap(1, min(4, typed))`, so 1 x 3 for a 3 and 1 x 4 for anything from 4 up, at most 4 screens. That total holds only because the other side is 1. The clamp touches the edited dimension only (`map.js:2064`, `:2072`): a 30 x 1 row (vertical mirroring) typed 2 in the height field goes to 30 x 2, 60 screens, and a 3 x 10 map typed 10 in the height field goes to 3 x 4, 12 screens. A shrink raises no prompt, except when it would drop a door or warp that points into a removed screen (`map.js:795`, `wouldDrop > 0`); Undo restores the whole project.
- **Typing across it can make a refused shape.** On a two-nametable board, a width above 1 on a column (a height above 1 on a row) is the `deadAxis` refusal, which names the Map Forge: the 1 x 30 column typed 2 in the width field is a 2 x 30 map the build refuses.
- **Duplicate screen has its own room check.** `hasRoom` is `gridW * gridH < LIMITS.mapGrid ** 2` (`map.js:844`), so 16 screens or more count as full. A map with room grows by `growthTarget` (`shared/project.js`: one more column if `gridW <= gridH` and `gridW < 4`, else one more row), and that **can** produce a refused shape but does not always: a ring map of 1 x 3 under horizontal mirroring becomes 2 x 3, refused; a streamed 1 x 1 under vertical mirroring becomes 2 x 1, legal. A map with 16 or more screens, including the audited 1 x 30 column, does not grow: if another map has room, a modal says the map "is already full (4×4 screens)" and lets you pick that map; if no other map has room, the screen is promoted to a new map with no modal (`map.js:852-885`). "Already full" is therefore shown only when there is another map to offer.

The README's Streamed worlds row says the short version (pinned by `docclaims.test.js`, which also pins that the code is still like that and that the demonstrated cases behave as stated, so the Map Forge tooling phase must delete the clause and the pin together).

*2026-10-15, fixed in phase 4 C1: see `docs/design-streamed-worlds-phase4.md`.*

### Known follow-ups

Deferred by Chris, 2026-10-15. Both are in files the ring certificate fingerprints, so fixing either is a certificate renewal, not an S6 edit.

- `main/build/generate.js:3126`, `streamedCapacityProblems`: the capacity message ends "or choose a board with more program space in the Build panel". That works on MMC1 and MMC3 (UNROM 512 has more) and **cannot work on UNROM 512, the largest board**. The text is in a fingerprinted file, so S6 left it (deferred to a wording pass, "C5").
- `shared/cartridge.js:305`, the MMC3 entry's `summary`: "Up to 512 KB of program and 256 KB of graphics ...". The entry's own `prgUnits` is 16 (256 KB), and so is the README's mapper table; the UI string says 512 KB. Deferred with the first (the file is a fingerprint input).
- The Map Forge knows nothing of a streamed map (Q1 above): its "Screens across / down" fields and Duplicate screen clamp every map to `LIMITS.mapGrid` (4) and, widened or duplicated, can make a shape the build refuses. This belongs to the item-15 "Map Forge tooling" phase, with the toggle and the live axis.

## 21. Equipment (ROADMAP item 5), commit C6: the ring certificate renewed onto C6b (2026-10-19)

Equipment (`docs/design-equipment.md`) changed `engine/`, `main/` and `shared/` after the S5 C3 certificate (section 19) was issued, so the ring gate's evidence was stale. C6 renews it. **Sections 3, 8, 19 and 20 are not edited and stay as history**; this section is the dated amendment, and where it and an older section disagree about the *current* baseline, snapshot or count, this section is right and the older one is a record of its day. The lines elsewhere that call `s1b-aaa678a.json` the active no-flag baseline (about lines 12-15, 203-205, 389-402, 454-466, 661 and 802 of this file) are such history; the active snapshots are named in 21.4.

C6 is four commits: **C6a** `0e59c68` (harness preparation), **C6b** `ce7d009` (the fresh bound sweep, the evidence it renews, and the commit whose `engine/ main/ shared/` the certificate is for), **C6c** `afbbc26` (the ring gate's baseline moves to C6b) and **C6d**, the commit this section ships in (this section, the docs, one sentence of `CLAUDE.md` and one test comment). Evidence directories are named in plain text below because `handoff-*/` is gitignored; every count in this section was written from the saved files, not recomputed from memory.

### 21.1 The route: `exact`, no new identity certificate

The bound curve (`test/fixtures/streambound/`) had to be re-measured because C1b and C3b moved every RPG ROM and the sweep's stage R builds RPG scenes. **Every figure of the curve was unchanged**, so `shared/streambound.js` needed no edit, the fresh curve records the engine, generator and harness that are now live, and `harnesstransfer.test.js` accepts it through the `exact` route. **No new identity certificate was issued.** The identity pins (`identitycert`, `identitymatrix`) bind to the S3b parent and to the sweep stage files, not to the ring fingerprint; section 9(6) of `docs/design-equipment.md` said otherwise and is corrected there.

- **C6a** (`0e59c68`): `sw_manifest_scene.mjs` scans `cartridge.inc` like the other builders, so `resolveEquates`' `EQUIP_SAVE_SHIFT` fallback is deleted (a build with no `cartridge.inc` now fails instead of guessing zero); `s3bparentbuild.test.js` builds the S3b parent tree. It shipped with the **five named reds** of ruling E13 (`crossevidence`, `harnesstransfer` x3, `streamtilebound`) and the 23 `prov_unit.mjs` reds of E17.
- **C6b** (`ce7d009`): the sweep, 2026-10-18 15:07-16:35, 12,590 jobs, 2 confirms, 0 bad, launched under E18's gate (below). `streambound-curve.json` was rewritten with every figure unchanged (certified/shipped 16/15 plain and 15/14 with bound tiles, margins 4,761 / 4,662 cycles, probe cliffs 55 / 54); `streambound-equivalence.json` rebuilt 11,760 of 11,760 records to the same project and ROM; the five E13 reds went green (`npm test` 4040 of 4040, 0 skip). The 340 exclusion rows were re-attested under E19 (21.6).
- **E18** (Chris, 2026-10-18): the launch load gate for the sweep, the pilot and the matrix is **1-minute load below 20**; the 5-minute check is dropped. Mesen measures emulated cycles, so host load cannot change a result; load only lengthens wall time and risks the 10-minute per-job kill, which the judge turns into a loud failure. A job timeout is a stop, never a re-run.

### 21.2 The certificate: baseline, counts, fingerprint

`BASELINE` (`test/lua/ring_gate/ringtree.mjs`; the C6c commit moved it) is **`ce7d0091ca6c016bfdfc5a3369af329fb3ba8bf9`**, the C6b commit, replacing S5 C2's `f3833db`. The exact-content proof, the consumed-input guard, the stamp schema (`ring-prov-3`) and the no-lift account of section 19 are unchanged: no stamp carries a lift (0 of 1,793; `--verify` reports 0 lifts). The ring gate's harness fingerprint is **252 inputs** (the plan counted 250 before C6c), `ringFingerprintSha` `b8e9295ffb719a25740f35917b14264c21a2f55d71e014617f74892775a218c6`, and every one of the 1,793 stamps carries that fingerprint and that baseline (the six ring-0 comparison stamps too).

**The matrix** (`run_matrix.mjs handoff-next/equip/c6/prov-final handoff-next/equip/c6/logs-final --jobs=18`, plain mode), launched 2026-10-19 08:23:51 PDT at HEAD `afbbc26` (C6c) with load1 4.97, 48 GB of memory available, 489 GB of disk and no Mesen process; finished 10:13:20, **exit 0**. Its closing line: `matrix: 385 jobs, 0 unexpected; provenance: 1793 stamps, 0 problems`.

- **`ringprovindex.mjs --verify`:** 1,793 stamps = **1,772 built + 15 error + 6 ring-0 comparisons**, 0 problems, 0 lifts. (The aggregate `status="built"` count of 1,778 includes the six comparisons.) The 15 error stamps are the declared negative-build witnesses, not missing builds: six `identity-forced-banked` undefined-symbol builds and nine horizontal `identity-ring-forced-0` out-of-range-branch builds. Kinds: 1,528 `cell-build`, 12 `ring0-build`, 6 `ring0-identity-comparison`, 50 `s1b-witness`, 197 `s1c-run`. Production proof: horizontal 886, vertical 901, none 6 (the ring-0 builds). Tree forms: every stamp unlifted, 1,793 of 1,793.
- **The gate** (`run_sw_ring_gate.sh`, verify mode): 0 audit problems, every stamp equal to this checkout's fingerprint, **146 PASS / 54 UNCERTIFIED / 232 N/A / 0 FAIL / 0 UNMEASURED, `GATE PASS`**. The saved gate output differs from S5 C3's in **one line**, the provenance/log-directory line (both print 1,787 stamps there, which excludes the six ring-0 comparisons). Every cell of the 432-cell table, the UNCERTIFIED list and every N/A proof, the control-level ones included, are identical.
- **"384 judged + the gate job = 385."** The gate reports `matrix jobs: 384 judged against their declared exit and log pattern, 0 unexpected`; `s1c_gate.mjs` (`:104`) filters out the `s1c-gate` job itself, and the matrix's own 385 includes it.
- **The control census** is **155 S1c control runs across 27 controls: 143 caught and 12 passing** (every passing one declared). The accepted plan's 147 / 135 / 12 (with 8 row-8 controls) is the **older count**, from before the eight lifecycle controls of section 19 were counted in; 155 = 147 + 8, caught 143 = 135 + 8, passing 12 unchanged.
- **Action cells equal S5 C3 exactly.** The six action row-5 positives, six action row-6 positives and two action row-8 positives have every item equal, and the deadline and minimum detail of the action controls (row 8 included) is equal. ROMs: of the 1,528 `cell-build` labels, 1,513 are built ROMs and 15 the expected errors; **589 action ROMs equal** and **924 RPG ROMs differ with `kernelLoFree` exactly 6 lower** (`ring0` fixtures are classified in 21.8). The row-5 certified margins and bounds W are unchanged and the tightest certified margin stays **33.67 (mixed) / 115.67 (strip), MMC3-H RPG banked**; no certified margin moved by more than the 10-cycle investigation threshold. The fixture hashes taken before the matrix equal `c3b/fixture-hashes-after.txt`.

The RPG margins that moved from section 19 are listed per item, with their causes, in 21.7.

### 21.3 The S5 C3 certificate is history

The harness now pins `ce7d009`. The S5 C3 evidence directory was run through the C6 gate **once**, as the plan required (`run_sw_ring_gate.sh handoff-next/s5-c3-provenance-final handoff-next/s5-c3-logs-final`, saved as c6d-s5c3-cert-under-c6-harness.out in the C6 final-checks directory):

```
GATE FAIL: 56 FAIL/UNMEASURED cell(s), 0 unexpected job(s), 25321 audit problem(s), 1787 stale-fingerprint stamp(s)
```

Its first lines: `evidence audit (read-only; every file resolved from those two directories): VERIFY: the recorded INDEX.json is required and its recorded hashes are checked; 25321 problem(s); harness fingerprint: 1787 stamp(s) carry a different fingerprint than this checkout's harness files`, then `AUDIT PROBLEM MMC1-H-action-resident-dlg-R0-p0.json: tree provenance: baseline "f3833dbefe85378b6d305f16a0bb341fd5044e96" is not the certification baseline ce7d0091ca6c016bfdfc5a3369af329fb3ba8bf9`. (S5 C3 did the same to S4c C2's certificate: 13,021 problems.) The refusal is by design: a certificate is for one baseline, and the S5 C3 numbers survive here as the *comparison* the matrix was held to, not as a certificate.

### 21.4 The no-flag proof boundary (E14, E15)

The no-flag jobs (`s1b_noflag.mjs`, `s1c_noflag.mjs`) build the pre-ring configurations and require their output unchanged. After C2 to C5b neither reproduced its tracked baseline, so each was **rebaselined additively from C6b**:

- **S1b** (11 configurations x five artifacts): the chain is `s1b-cd7a9f8.json` (S2 C2) -> `s1b-aaa678a.json` (S3 C1) -> **`s1b-ce7d009.json`, active now**. **S1c** (12 x two): `s1c-cd7a9f8.json` -> **`s1c-ce7d009.json`, active now**. The superseded files are kept, each pinned to its bytes by SHA-256 in `prov_unit.mjs` (`HISTORICAL_S1B_SHA`, `HISTORICAL_S1B_AAA_SHA`, `HISTORICAL_S1C_SHA`), and the **continuity tests** bind each adjacent pair: `aaa678a` -> `ce7d009` (the same 11 configurations; `manifest.lua` equal in all 11; `rom` and `scene.nes` equal in the eight action configurations and different in exactly the three RPG ones; `project` and `symbols.json` different in all 11) and `cd7a9f8` -> `ce7d009` for S1c (the six `nmi-*` ROM and Lua hashes equal, the six `close-*` Lua hashes equal, the six `close-*` `sw_close_deadline.nes` hashes different). The new snapshots were recorded twice with the unmodified recorder from the C6b `git archive`, and the recorder run at `37ca96f` reproduces `s1b-aaa678a.json` with 0 differences.
- **The audit** (`c6/noflag/audit.md`, written by `audit.mjs` from the tracked old baselines, the new snapshots, ten `git archive` bisection runs of both checkers and a `symbols.json` dump of each tree) covers all 79 artifact entries: **S1b 28 of 55 differ, 27 equal; S1c 6 of 24 differ, 18 equal; 0 violations**. What differs, and why: `project` x11 is C2's `party[].startEquip` default (with that key deleted in memory all 11 project hashes reproduce `aaa678a` exactly; a continuity test does it); `symbols.json` x11 is the names C3, C4 and C5b added, and in the RPG files the `code.*` addresses shifted +6 by C1b (77 symbols in `manifest-rpg-name`, 72 in each of `manifest-rpg-walk` and `move-rpg-flash-flash`); `rom` x3 and `scene.nes` x3 (`manifest-rpg-walk`, `manifest-rpg-name`, `move-rpg-flash-flash`) are C1b and C3b; `manifest.lua` differs in none; every action `rom` and `scene.nes` is unchanged. The ten-commit bisection: `37ca96f` and `4ab8332` (C1) change nothing; `720d976` (C1b) the three RPG `rom`/`scene.nes`/`symbols.json`; `dd7af55` (C2) `project` x11; `31e7fff` (C3) `symbols.json` x11; `7294592` (C3b) the three RPG `rom`/`scene.nes`; `a5336b3` (C4) `symbols.json` x11; `f2e4ebe` (C5) nothing; `3ca7b54` (C5b) `symbols.json` x11. S1c: the six `close-*` `sw_close_deadline.nes` files differ and nothing else does.
- **What the check proves now, and what it cannot.** A pass says the flag-absent output equals **C6b's production output**. It **cannot detect a regression already present in C6b**: the equipment commits' effect on those artifacts (the C2 schema in `project`, the C1b and C3b RPG ROM changes, the new symbols) is accepted at this boundary on the strength of the audit above, not re-proved by the check. Before C6c the equivalent statement was about `aaa678a`.

### 21.5 E17: the `prov_unit.mjs` exception, expired

`test/lua/ring_gate/prov_unit.mjs` is **outside `npm test`**. It went red at `d1cbf97` (phase 4 C1: 23 tests; the ring `BASELINE` `f3833db` no longer matched `main/`) and shipped red through the phase 4 release `8cb8033`, because the ring fingerprint's *stability* was taken to prove the ring units' health and it does not. E17 allowed the saved 23-name set at C6a and C6b only, with 0 skips; it **expired at C6c**, whose `BASELINE` move cleared all 23: **60 pass, 0 fail, 0 skip** (C6c commit message; C6d's final check re-ran it). **Release runs must include `node --test test/lua/ring_gate/prov_unit.mjs`**, the process gap this exception exposed.

### 21.6 E19: the six-byte cause

C1b (`720d976`, the B-press fix) adds six bytes to `dispatch_input` under `BATTLE_ENABLED`, so `kernelLoFree` is **6 lower on every RPG board** (all 924 RPG ROMs of the matrix: exactly -6). That is why C6b's 340 exclusion rows (all RPG; `test/fixtures/crossstage/exclusions-evidence.json`) were re-attested: `need` unchanged, `free` six lower (140 -> 134 on 262 rows, 97 -> 91 on 78), `shortfall` +6, attributed solely to C1b. The re-attestation is a **one-time delta table** in `test/lua/refresh_sw_exclusions.mjs`, bound to the old fixture's SHA-256 (`ae6c9fc9...e3bd`), its exact group and ID sets and the old and measured fingerprints; only those two free transitions, need +0, shortfall +6; every parent assertion, authority seal and scene-identity check is kept, and it never means "an unconditional -6". `crossevidence.test.js` (140 -> 134) and `crossstages.test.js` (shortfall range [5,42] -> [11,48]) follow.

### 21.7 E23 / Q5: the per-cell timing attribution

The matrix passed, but 44 numeric margin items in 42 RPG builds had moved from S5 C3 (seven row-5 positives with nine items, seven row-6 positives, four row-8 positives, four row-5 controls, twenty row-8 controls) and the plan's stop rule 8 / Q5 required a cause for each. Chris (E23) chose the **counterfactual proof**, run in scratch trees from `git archive afbbc26` with no tracked file touched: **V0** = C6c as is (= the C6 matrix), **V1** = C1b's six-byte insertion removed, **V2** = C3b's two operands reverted, **V3** = both reverted (= S5 C3 for rows 5 and 6; row 8 differs from S5 C3 by E20's relocation alone). All 44 items reproduce: **V0 and V2 give the C6 figure, V1 and V3 the S5 C3 figure. C1b is the cause of every item; C3b is the cause of none.** (Q5-MET-WITH-ADDITIONS, reviewer round 2; its two additions are in 21.7.4 and 21.7.5.)

**21.7.1 Identity.** Every retained build ROM was hashed: 66 each for V0, V1, V2 and V3, 48 for an S5 rebuild. V0 equals all 42 C6 stamps (lifecycle hashes and plain-build `kernelLoFree` included); V3 equals 18 of 18 S5 row-5/6 stamps; an S5-tree rebuild from `cf3ca57` equals the 24 row-8 stamps, and V3 differs from them in **11 bytes per ROM (48 ROMs, 528 bytes), each an absolute operand $07E0-$07E6 becoming $07C0-$07C6**: E20's relocation, nothing else. Statically, C1b moves exactly 72 symbols (74 in the 24 row-8 scenes), each by +6; the named NMI/RTI, main-loop, stream, close and split/IRQ symbols present in each build do not move, so that code sits at the same addresses. C3b moves no symbol.

**21.7.2 The 44 items.** Row-5/6 (field) items, margins in cycles, with the measured change of `dispatch_input`'s executed length between V1 and V0 per probed frame:

| # | build and item | S5 C3 | C6 | dispatch delta per probed frame |
|---|---|---|---|---|
| 1 | `r5-MMC1-H-rpg-banked` strip | 250 | 251 | +7 |
| 2 | `r5-MMC1-H-rpg-resident` strip | 257.33 | 258 | +7 |
| 3 | `r5-MMC1-H-rpg-resident` mixed | 159 | 158 | +7 |
| 4 | `r5-MMC1-V-rpg-banked` strip | 271 | 271.33 | +7 |
| 5 | `r5-MMC3-H-rpg-banked` strip | 186 | 187 | +7 |
| 6 | `r5-MMC3-H-rpg-resident` mixed | 94 | 95 | +7 |
| 7 | `r5-MMC3-V-rpg-resident` strip | 213.33 | 213 | +7 |
| 8 | `r5-MMC3-V-rpg-resident` mixed | 108 | 107 | +7 |
| 9 | `r5-U512-H-rpg-banked` mixed | 155.33 | 154.33 | +4 (7-3) |
| 10 | `r6-MMC1-H-rpg-resident` close:deadline | 376 | 378 | +7 |
| 11 | `r6-MMC1-V-rpg-resident` close:deadline | 344 | 342 | +7, +15 at PF 131 |
| 12 | `r6-MMC3-V-rpg-banked` close:deadline | 280 | 278 | +7 |
| 13 | `r6-MMC3-V-rpg-resident` close:deadline | 279 | 277 | +10, +11 at PF 131 |
| 14 | `r6-U512-H-rpg-banked` close:deadline | 375.33 | 377.33 | +3, +4 at PF 131/168 |
| 15 | `r6-U512-H-rpg-resident` close:deadline | 375.33 | 377.33 | +7 |
| 16 | `r6-U512-V-rpg-banked` close:deadline | 341.33 | 343.33 | +3, +4 at PF 131/168 |
| 17 | `r5-ctl-nmi-chunk4-U512-H-rpg-banked` mixed | 155.33 | 154.33 | +4 (7-3) |
| 18 | `r5-ctl-nmi-mixed3-MMC1-H-rpg-banked` strip | 250 | 251 | +7 |
| 19 | `r5-ctl-nmi-mixed3-MMC1-V-rpg-banked` strip | 271 | 271.33 | +7 |
| 20 | `r5-ctl-nmi-mixed3-MMC3-H-rpg-banked` strip | 186 | 187 | +7 |

*Causes by family.* The six bytes (three inserted instructions) cost **7 executed cycles per frame** on a field frame; the main loop's phase against vblank moves, and the NMI is entered at a different dot and interrupted PC; the NMI, stream and close code is unmoved. Twelve of the 18 probed scenes have exactly +7 in every paired frame (rows 1-8, 10, 12, 15, 18-20). In the other six a taken `dispatch_loop` branch changes page-crossing status: **r5 U512-H banked and its chunk4 control (rows 9, 17): +4 in every frame (7 - 3; the `bne $D7FB` loop-back stops crossing a page, three times a frame)**; and the four **row-6 exceptions**, where the ordinary delta is the static no-press path count and one or two button-press frames run callees inside the measured span:

| scene | complete distribution, V0 minus V1 | the exceptional frame |
|---|---|---|
| r6 MMC1-V resident (row 11) | +7 in 148 frames, +15 in 1 | PF 131 (A talks): 7 + 6 + 2 = 15; six `beq $DAFD` and two `bne $DAFD` in `do_interact_loop` go from no page crossing to a crossing (698 -> 713 cycles) |
| r6 MMC3-V resident (row 13) | +10 in 148 frames, +11 in 1 | PF 131: 7 + 3 + 1 = 11; the three ordinary loop-backs (`$DAFC` -> `$DAC4`) gain a crossing and one more at `$DBF5` -> `$DBFC` (691 -> 702); the statically changed `$DAF7` branch is not taken in either revision |
| r6 U512-H banked (row 14) | +3 in 139 frames, +4 in 2 | PF 131 (A talks) and PF 168 (A advances the dialog): 7 - 3 = 4; the `$DAFD` -> `$DB0E` `beq` loses its crossing three times, not the four of an ordinary no-press frame |
| r6 U512-V banked (row 16) | +3 in 139 frames, +4 in 2 | the same, `$DAFA` -> `$DB0B` |

The six exceptional frame pairs were re-checked against the raw TR/PF records, the ROM disassembly and the callee traces: after removing the three inserted instructions and normalizing the six-byte relocation, instruction PCs and registers agree and the switchable-bank bytes are unchanged between V0 and V1. (An earlier version of this account called +7 universal and said "13 of 18 scenes"; both were wrong, and are corrected here: **12 of 18**, with the complete distributions above.) The mixed and strip minima then move by one or two cycles in either direction because the NMI is entered at a different phase of the same code; the counterfactual runs, not an argument, fix the sign of each.

*Row 8* (the 24 MMC3 RPG items; plain / lifecycle A / lifecycle B least arm-deadline margin, cycles). The cause for all 24 is the **interrupt-phase effect of C1b**: `split_arm` and `nmi` are unmoved, but the +7-cycle main loop changes where the NMI lands (dot, interrupted PC, CPU-cycle parity of the entry clock), and the NMI-entry-to-last-arm-write span moves by 3 PPU dots per cycle of entry parity (for example MMC3-H banked lifecycle A: parity 1 -> 0, 5996 -> 5993 dots, margin 263.7 -> 264.7). Independently re-derived from the raw streams: all **144** V0/V1 plain/A/B minimum witnesses (lifecycle blank and title frames excluded); the **48 of 48** same-PC pairs satisfy span(V0) - span(V1) = 3 x (entryParity(V0) - entryParity(V1)) in dots. That is a correlation with entry parity; "**consistent with OAM-DMA alignment on CPU-cycle parity**" is an **inference**, not a measurement: to assert the mechanism, log the matched witness's `$4014` write clock and parity, the first CPU instruction after DMA and the final arm write. The controlled removal of C1b reproduces S5 C3 in every item, the interrupt code is unchanged, and C3b's separate counterfactual reproduces C6: that establishes the broader **C1b-induced interrupt-phase cause** Q5 asks for.

| # | build (all `rpg`, MMC3) | S5 C3 least arm-deadline margin, plain / A / B | C6 |
|---|---|---|---|
| 21 | `r8-MMC3-H-rpg-banked` | 135.3/263.7/1607.3 | 135.3/264.7/1606.3 |
| 22 | `r8-MMC3-H-rpg-resident` | 139.3/263.7/1607.3 | 139.3/264.7/1606.3 |
| 23 | `r8-MMC3-V-rpg-banked` | 152.3/280.3/1605.7 | 152.3/282.0/1605.3 |
| 24 | `r8-MMC3-V-rpg-resident` | 155.3/283.3/1606.7 | 155.3/281.0/1606.7 |
| 25 | `r8-ctl-split-arm-while-locked-MMC3-H-rpg-banked` | 135.3/263.0/1605.3 | 135.3/263.7/1605.3 |
| 26 | `r8-ctl-split-arm-while-locked-MMC3-V-rpg-banked` | 152.3/280.3/1605.7 | 151.7/282.0/1605.3 |
| 27 | `r8-ctl-split-bank-restore-lost-MMC3-H-rpg-banked` | 135.3/264.0/1607.3 | 135.3/264.7/1606.3 |
| 28 | `r8-ctl-split-bank-restore-lost-MMC3-H-rpg-resident` | 139.3/264.0/1607.3 | 139.3/264.7/1606.3 |
| 29 | `r8-ctl-split-bank-restore-lost-MMC3-V-rpg-banked` | 152.3/282.3/1605.7 | 152.3/280.0/1605.3 |
| 30 | `r8-ctl-split-bank-restore-lost-MMC3-V-rpg-resident` | 155.3/281.3/1606.7 | 155.3/283.0/1606.3 |
| 31 | `r8-ctl-split-irq-left-armed-MMC3-H-rpg-banked` | 135.3/264.7/1606.3 | 135.3/264.0/1606.3 |
| 32 | `r8-ctl-split-irq-left-armed-MMC3-V-rpg-banked` | 152.3/280.3/1606.3 | 152.3/282.0/1605.3 |
| 33 | `r8-ctl-split-lc-skip-warp-MMC3-H-rpg-banked` | 135.3/280.3/1606.3 | 135.3/284.0/1606.7 |
| 34 | `r8-ctl-split-lc-skip-warp-MMC3-H-rpg-resident` | 139.3/280.3/1606.3 | 139.3/284.0/1606.7 |
| 35 | `r8-ctl-split-lc-skip-warp-MMC3-V-rpg-banked` | 152.3/276.3/1606.7 | 152.3/277.0/1605.3 |
| 36 | `r8-ctl-split-lc-skip-warp-MMC3-V-rpg-resident` | 155.3/279.3/1606.3 | 155.3/279.0/1606.7 |
| 37 | `r8-ctl-split-no-lock-MMC3-V-rpg-banked` | 158.3/289.3/1612.7 | 158.3/289.3/1612.3 |
| 38 | `r8-ctl-split-no-sei-MMC3-H-rpg-banked` | 135.3/264.0/1607.3 | 135.3/265.0/1606.3 |
| 39 | `r8-ctl-split-no-sei-MMC3-V-rpg-banked` | 152.3/281.3/1606.7 | 152.3/281.3/1607.7 |
| 40 | `r8-ctl-split-prg-transient-MMC3-H-rpg-banked` | 134.3/263.7/1606.3 | 134.3/264.7/1607.3 |
| 41 | `r8-ctl-split-r0-MMC3-H-rpg-banked` | 135.3/263.7/1607.3 | 135.3/264.7/1606.3 |
| 42 | `r8-ctl-split-r0-MMC3-V-rpg-banked` | 152.3/280.3/1605.7 | 152.3/282.0/1605.3 |
| 43 | `r8-ctl-split-wrong-r1-MMC3-H-rpg-banked` | 136.3/265.0/1607.3 | 136.3/265.0/1608.3 |
| 44 | `r8-ctl-split-wrong-r1-MMC3-V-rpg-banked` | 153.3/283.3/1606.7 | 153.3/281.0/1607.7 |

**21.7.3 C3b.** `physical_damage` (`engine/battleturn.asm`) runs only in battle. It is **not reachable in any row-5 or row-6 field scene**, so there C3b is a ROM-only change. In row 8 its execution in lifecycle part A is separated by the V2 experiment, and V0 and V2 (and V1 and V3) have identical pre-first-DONE `F`/`TRIALS`/`DONE` streams in **72 of 72 parts per pair**: it is not the observed timing cause.

**21.7.4 The S1b figures (reviewer round 2, F1/F3).** No S1b item bears a changed margin, so this is a separate obligation, discharged from the saved bound objects (`remAt`, `atMaxG`) and the retained `*.json.bodies.json.gz` records plus static counts over rebuilt scratch assemblies (all 120 rebuilt S1b ROM hashes equal the retained spec hashes); no emulator was run and no sweep. **No item status changed: all 2,196 item/emulator statuses are identical and every UNCERTIFIED outcome stays.** The 924 numeric token changes include 92 above 14 in magnitude: `bound:CB` 58, `sanity:evidence` 13, `gate:CB` 12, `agree:bodies` 5, `gate:C4bw` 4 (the last four are witness *frame numbers*, not cycle counts).

- **The battle path C1b adds, which the field-only probes did not measure.** Under `ST_BATTLE` the new `beq dispatch_done` is *taken* and skips the whole old button-dispatch loop (`engine/input.asm`). Executing `dispatch_input` over the real ROM bytes with no button pressed, the saving per call is, by cell family (walk/touch/say ROMs; chase ROM): MMC1-H banked 187; 179, MMC1-H resident 187; 183, MMC1-V banked 183; 179, MMC1-V resident 187; 183, **all of MMC3 and UNROM 512, both orientations and placements, 181; 177** (for example 201 -> 14 cycles on MMC1-H banked). All **12** CB remainder-maximum drops equal the applicable static saving; at the retained `walk@406` body of MMC1-H banked the remainder falls 2310 -> 2123 and G 3831 -> 3643 with the NMI term 1360 -> 1359, a saving *at the same body*, not a reassigned witness. The remainder witness stays in four cells, the CB max-G witness in three, the C4bw max-G witness in six; where it moves, each body's change is its path saving plus a {-3, 0, +3} term plus an NMI-term change of 0 or +-1, and the maxima follow the changed bodies. The -120 `bound:CB` token (MMC3-V resident, worst unpaired body 3086 `heavy14@615` -> 2966 `touch+5@615`) is a change of that worst unpaired body, not a battle-path saving.
- **Corrections to the first account (round 2, F3).** (a) The 13 large `sanity:evidence` tokens are **10 jsnes `nmiT` totals and 3 jsnes counts**, not 11 + 2. (b) Each of MMC1-H resident and MMC3-H resident has **six, not three**, changed paired Mesen keys: three C0 -> CB class/profile changes **and three CB -> CB NMI-profile changes**; across the two cells twelve paired `nmiT` deltas have magnitude 692 or 693 (MMC1-H resident `touch+2/walkD@407`: both records CB, `nmiT` 1360 -> 667, the `nmb` counter replaced by `nms`). So neither "every per-body `nmiT` change is 0 or +-1" nor "no counter or term of any CB body differs" holds universally; the verified extrema and the five-spec residual counts are unaffected. (c) "Each extra body adds `mwm` 8" is only net arithmetic: MMC3-V banked `mwm` +64 is **+168 from eight unpartnered rows -104 from paired rows**; MMC3-V resident `mwm` -24 is **-63 from unpartnered rows +39 from paired rows**; `bank` +16 is eight added rows x 2. (d) A C0 row's duration is **not** the roughly 29,780-cycle cross-core duration difference (the unpartnered MMC3-V banked C0 rows have jsnes durations of about 35,200-35,285); MMC1-V resident has three removed keys and one added key (the added `warp/walkR@262` row is C3s), its NMI net is exactly +1117 paired -3806 unpartnered = -2689, and the other three reported NMI decompositions reproduce exactly. The C0-length explanation stays the existing judge's permitted cross-core accounting; its boundary mechanism is R2 below.

**21.7.5 Residuals, with their limits (reviewer round 2, F4).** None changes an item status or needs a ruling; none confers certification, an HP-correctness claim, or authority for a new S1b experiment.

- **R1, the {-3, 0, +3} term.** After subtracting the NMI-term change, the residual `(dG - dnmiT) + saving` over the 16,869 paired CB bodies of the five rebuilt specs is {-3: 4,414, 0: 8,428, +3: 4,027}. Subtraction does not establish statistical independence or exclude every C3b contribution in battle, and a similar residual in field bodies (where C3b is unreachable) shows C3b is not its universal explanation. The 3-cycle granularity of the `wait_vblank` poll is a hypothesis.
- **R2, a phase's C0 body count differs between the cores.** Recorded as observed C0-duration and count effects and exact aggregate decompositions (21.7.4); the frame-boundary mechanism is an inference.
- **R3, C3b.** It changes equal-cost zero-page operand instructions and moves no symbol. That does **not** prove equal total executed timing on every battle path, because damage values can steer conditionals in `physical_damage` and the battle behaviour after it; and equal remainder maxima do not establish "no cycle left for C3b" in every body. Recorded separately: the observed C1b savings, the accepted 44-item V0/V2 equality, and the unobserved HP and damage consequences (the saved S1b fields do not hold HP or damage). No claim of universal battle timing or gameplay equality is made.
- **R4, per-body `nmiT` +-1.** The ordinary paired changes are consistent with interrupt and DMA phase; the 21.7.4 (b) transitions are the exception. Row 8 supports the phase explanation; DMA alignment itself is an inference, not a measured S1b mechanism.
- **R5, 83 field pairs.** Of 14,928 field-body pairs, exactly 83 have residuals outside {-3, 0, +3}, ranging -14 to +2. Changed branch crossings in event routines are a **candidate** explanation, not a demonstrated location or mechanism for all 83.

**Runtime discipline of the diagnostic.** The retained status records account for exactly 410 successful Mesen processes (2 pilot, 72 row-5/6 plain, 36 probe, 288 row-8, 12 repeats) plus 8 successful trace scene runs (at most 2 concurrent, started at Mesen 0 and load1 13.58; a 36.21 attempt was refused and not started). No nonzero exit, isolation-chain problem or changed-user-save flag is recorded. This verifies the retained account, not an independent census of the historical processes.

**21.7.6 Residual follow-up (FU2, 2026-10-20).** The 21.7.5 residuals were re-examined from the retained bodies, the vendored jsnes core with jsnes instruction traces (no Mesen), and six scratch Mesen processes of a passive probe: MMC1-H banked / `walk`, MMC3-H resident / `touch+2` and U512-V resident / `chase`, each in the C6 tree and in the S5 C3 tree (ROMs byte-equal to the retained ones). Nothing in 21.7.5 or above changes, no item status changes, and nothing here confers certification. The probe and analysis scripts are untracked scratch and were not part of any fingerprinted harness; every Mesen statement below is about this Mesen build and the three cell/spec rows measured (3 of the 60 rows of the five-spec population), not about hardware or the unmeasured rows.

1. **R1, the {-3, 0, +3} term: closed as: measured in the three rows; not measured elsewhere.** In 2,993 collected bodies (1,496 paired between the trees) the NMI that releases the idle poll interrupted `wait_vblank_loop` at one of its two instruction boundaries, `lda <vblank` or `beq`, in every body (0 outside the loop, 0 in an overrun), and the release-to-body-start offset d = B - R is 11 at the first and 14 at the second, never another value; the two boundaries are 3 cycles apart. Between the trees delta(d) is {-3, 0, +3} in all 1,496 pairs (0: 732, +3: 343, -3: 421) and is 0 exactly when both trees were interrupted at the same boundary. For the 620 paired CB bodies delta(d) equals the retained residual (`dG - dnmiT` plus the battle saving) in 620 of 620. The identity delta(G) - delta(nmiT) - delta(main_cost) = delta(d) holds in all 1,496 pairs but is algebraic given the definitions (E, R, B, I as in `ringcount.mjs`), so it tests the logging; the evidence for the mechanism is d in {11, 14} by boundary and the match to the retained residual. Not shown: rows other than the three, releases outside the idle loop (none occurred, so that case is unvalidated), and the field-pair population beyond item 5's accounting. The retained coarse keys still do not determine the residual (purity 0.5895, 0.6922 with frame parity, against 0.4995; this refutes only a deterministic function of those keys).
2. **R2, C0 body counts: mechanism remains unestablished in this evidence; retained as an inference.** The 28 phase-count exceptions and 6 class changes are observed accounting outcomes: a C0 (forced-blank redraw) body one frame (about 29,78x cycles) longer in one core or tree than in the other. The six probe processes recorded none of the `$2002` reads and show one instance in Mesen (MMC3-H resident / `touch+2`: the S5 C3 tree's C0 body is 65,069 cycles, the C6 tree's 35,285). The vendored core is not coarse at the `$2002` edge, and no particular `$2002` race is demonstrated; no logging was bought for it.
3. **R3, C3b: closed as: the direct uninterrupted cycle difference of `physical_damage` between the C3b-reverted and C3b ROMs, for identical entry state, lies in [-2, +2] over the MMC1, MMC3 and UNROM 512 layouts with and without equipment.** The bound follows from a static path enumeration over the specified inputs (it holds for every crossing pattern of the three relative branches: path costs 11, 10, 9, 10 with no crossing penalty, largest absolute path difference 2); its domain and enumeration are validated by 163,008 paired inputs (326,016 routine executions) with legal levels of a generated MAX_LEVEL-15 table, the appended monster actors with ATK 0..255 including 253..255, real effective ATK/DEF verified against the generated tables, every party and monster target, all four noise outcomes, equal entry state asserted per pair and no stub of the `bt_tmp` clobber. The absolute W = 2 is attained in all six layouts (-2 observed); both signed endpoints are attained without equipment, and with equipment +1 is the maximum because the V0 P1 / V2 P3n pair requires the member-index operand to exceed DEF, which the worn bonuses of those layouts never allow, so the signed range is conservative there. Because a party target's `level_row` overwrites `bt_tmp`, the two ROMs compute different damage for the same inputs; the claim says nothing about `apply_damage`, rendering, deaths or later battle effects, which remain outside it.
4. **R4, per-body `nmiT` +-1 and the +-692/693 pairs: closed as: measured DMA-interval accounting on the sampled pairs, in this Mesen build.** (a) The twelve |dnmiT| >= 100 bodies in the retained evidence are six displaced key pairs: in the old tree a C0 body is one frame longer, so the single `nmb` body falls on adjacent keys. The probe re-measured MMC3-H resident / `touch+2`: realigned by body kind, C0 against C0 has dnmiT 0 and `nmb` against `nmb` has dnmiT -1 with every other counter equal. The latter NMIs have the same sequence number in the two runs, and their measured DMA intervals are 513 against 514 cycles. This supports displaced key pairing, not a drain moved between NMIs; the extra redraw frame's mechanism remains R2. (b) In MMC3-H resident / `touch+2` and U512-V resident / `chase` (4 processes), the probe reads the clock at the second instruction after `sta $4014` and subtracts the intervening `lda` (3 cycles, decoded from the ROM). This measures total extra CPU cycles between the callbacks, including any additional bus steals if present; it does not separately log those steals. Of 2,376 intervals, 1,120 are 513 and 1,256 are 514, with zero outside those values, consistent with OAM DMA in these runs. The interval is 514 exactly when the write cycle is odd under the stated convention (write cycle = callback clock - 1, so the callback clock is even), 2,376 of 2,376. (c) Between the trees, delta(nmiT) equals the measured interval difference in 995 of 995 paired bodies matching the recorded handler labels, `vram_len`, `st_active` and `st_cur`, with one DMA each; this comparison does not select pairs using nmiT. That metadata does not independently establish identical instruction paths. Descriptively, further splitting metadata groups at gaps greater than 1 in observed nmiT yields 86 duration clusters, within which nmiT minus the measured interval is constant (86 of 86; 59 contain both interval values). Because the splitting uses nmiT itself, this is conditional accounting within observed duration clusters, not independent proof of identical work or an explanation of the larger differences between clusters. The pilot row (MMC1-H banked / `walk`) did not measure the interval but agrees on nmiT against parity in 499 of 499 paired bodies and 28 of 28 duration clusters containing both parities. Not shown: the absolute interval in the pilot or unmeasured rows, unobserved handler paths, separate attribution under other bus-steal conditions (zero intervals outside 513/514 were observed), and hardware behavior.
5. **R5, 83 field pairs: closed as a conditional accounting decomposition.** The jsnes reconstructions contain 51 dispatch-skipped bodies and 32 dispatch-plus-audio-crossing bodies (`dispatch_input` once, +7 cycles, and one taken-branch crossing changed at `sfx_channel_tick+5`, -1). Applying those path costs to the 83 Mesen pairs, against the saved baselines (-7 in 78 keys, -11 in four, -3 in one), leaves {-3, 0, +3} in all cases, the R1 band. This is conditional accounting using the reconstructed paths; Mesen supports the totals and the identity of counters, events and state. In seven keys lying in the three measured rows (three reconstructed as dispatch-skipped, four as dispatch-plus-crossing), measured delta(main_cost) equals the aggregate reconstructed cost (0 or +6) in 7 of 7, and measured delta(d) equals the Mesen remainder in 7 of 7 (-3: 1, 0: 2, +3: 4). This directly supports the aggregate cost and the poll remainder on those seven keys; the individual dispatch executions and changed branch crossings in Mesen remain inferred for all 83 because this probe did not log those instructions. The poll mechanism on the other 76 keys also remains inferred. The jsnes poll column agrees with measured delta(d) in one of seven, so it is not a key-by-key measurement of Mesen's poll offset and is not used as that offset in this accounting. The counterpart matcher takes the nearest jsnes frame (eight keys have two candidates per tree; the same-frame alternatives give the same result); transfer of the matched paths remains an assumption.

(Item 5's wording replaces 21.7.5's "candidate explanation in event routines": the changed crossing found is in an audio routine, and most of the 83 are not crossings at all.)

### 21.8 E23 / triage: the row-8 logs, the fixture classification, the census

- **F2: the row-8 action log differences are post-DONE logging artifacts; pre-completion timing is byte-identical.** For all **eighteen** row-8 action ROM jobs the raw `F`, `TRIALS` and first `DONE` lines are byte-identical between S5 C3 and C6, every event's master clock, PC and PPU position included (the decompressed `*.raw.gz` were compared, not only the JSON). Thirteen changed item logs are all one frame difference *after the first `DONE`*: twelve gain one frame and `split-irq-left-armed` on MMC3-H loses one (S5 1 post-DONE frame, C6 0); `split-irq-left-armed` on V (1 and 1), `no-lock` on V and `no-sei` on H (0 and 0) and both action positives are unchanged. Example: `s1c-r8-ctl-split-r0-MMC3-H-action-resident` has the same events through `DONE frames=1570` in both runs, then C6 prints `F 1571`, another `TRIALS` line and `DONE frames=1571`, which turns its 1554 -> 1555 frame tally into a post-completion artifact, not a shift in its earlier offending write. The F/TRIALS/first-DONE lines (joined, newline-terminated) have the shared core SHA-256 `f2a78d0caf219b1761d2fbee84605a98773153100c048a9b1c0e1c28902d45f2` in both runs. **No E20 timing exception was needed.** The mechanism: `test/lua/sw_split_ring.lua.template` `onFrame` calls `emu.stop(0)` and sets `stage = "done"`, but neither it nor the memory callbacks has a terminal early return, so a later end-frame callback can still print (and `onNmi` no longer applies the `stage == "run"` forcing); `parseSplitOutput` (`ringsplit.mjs`) consumes every `F` line through EOF and never stops at `DONE`, so the judge includes the trailing non-trial frame and changes its off/armed/error counts. **That parser and terminal-callback quirk is a known future harness fix, a separate reviewed change outside C6; it was not made here.** The raw streams, results and index are preserved verbatim.
- **F3: the four "action" ROM diffs are RPG fixtures.** `rom_log_compare.py` set the game type to `?` when a stamp lacks `gameType` and printed everything except a literal `rpg` as ACTION. Ring-0 stamps carry `fixture`, not `gameType`: the four are the pristine and patched builds of `sample-rpg` and `sample-rpg-mmc1` (`kind=ring0-build`), whose pristine and patched sides match within each run (the `ring0-identity-comparison` stamps have `equal=true`): `sample-rpg` `83c21980...` -> `46197555...`, `sample-rpg-mmc1` `1da6101d...` -> `0cb33fec...` (both from C1b and C3b). The corrected comparison is saved under a **new** name (c6d-rom-log-compare-corrected.out, from c6d-rom_log_compare_corrected.py, in the C6 final-checks directory; `rom_log_compare.out` is kept as it was): **739 equal action ROMs (731 explicitly typed plus eight ring-0 action builds), 18 changed action harness ROMs (the row-8 harness, E20) and 1,015 changed RPG ROMs (1,011 typed plus these four)**; fifteen error stamps and six comparison stamps carry no direct `romSha256`.

### 21.9 E20 / E21: the pilot's RAM collision, the reservation and the build prerequisite

- **What happened.** The first C6c pilot (prepared 2026-10-18 20:08, 256 of the 385 jobs, candidate `cff0f1d6...`) ended `DONE exit=1` with **36 of 36 `s1c-r8-*` jobs failed at the harness's own build guard, 37 unexpected jobs (those 36 plus the expected partial `s1c-gate`) and 72 provenance problems** (each of the 36 failed `s1c-run` stamps has no result file and so breaks the two checks at `ringprovindex.mjs:196-199`, a linked result and a verdict: 36 x 2). Cause: the **row-8 split harness reserved $07E0-$07EF** (`ringsplit.mjs`, seven bytes used at $07E0-$07E6) and **equipment's `pc_eq_atk`, `pc_eq_def`, `pc_eq_mag` and `pc_eq_mdef` occupy $07E0-$07EF** (`engine/constants.asm`; the equates exist even when `EQUIP_ENABLED` is false). Both claimed the same 16 bytes of RAM, an "nothing else lives here" assumption in the harness (its comment said `engine/constants.asm` held nothing there) that C2-C5b made false.
- **Why nothing earlier caught it.** The collision is detected only when `buildSplitRing` assembles a row-8 scene, and nothing before the pilot did that on an equipment-era tree: the S1c unit tests exercise the split *judge* on synthetic event streams, the C6b bound sweep builds `sw_manifest_scene.mjs` scenes, and neither no-flag builder executes `buildSplitRing` (the split harness is not among their recorded artifacts), so the unchanged ring fingerprint and the unchanged no-flag snapshots said nothing about it. The old guard also scanned only literal `$hex` equates and treated an unresolved symbolic `@size` as one byte, so it was weaker than the replacement.
- **The fix (E20, Chris; a narrow C6c amendment).** Only the harness moves, to **$07C0-$07CF** (`preLo` $07C0, `preHi` $07C1, gaps $07C2-$07C6). `HD_RESERVATION` is the single numeric declaration; the HD addresses, the overlap bounds and the diagnostic derive from it. The guard resolves every RAM allocation name and `@size` from the build's own `constants.asm`, `config.inc` and `cartridge.inc` with the existing equate parser, checks the interval overlap of all sixteen bytes and **fails on anything unresolved: there is no one-byte fallback**. The engine arrays did not move. Range proof: in the worst current case (UNROM 512 + equipment + Save) `SAVE_RECORD_LEN` 139 occupies $0700-$078A and `EQUIP_SAVE_SHIFT` 12 moves the streamed block through $0799, so the free run is $079A-$07D1, below `eq_dirty` ($07D2), `eq_cur_slot` ($07D3) and `pc_equip` ($07D4); the reservation lies inside it. Four added tests pass, and scratch-only mutations show they reject an unresolved-size one-byte fallback (one test fails), a start-only interval guard (two) and a disabled guard (three).
- **The build prerequisite (E21).** `test/lua/ring_gate/split_prebuild.mjs` is tracked, fail-closed and build-only (no Mesen): the six positive MMC3 H/V action-resident and RPG-resident/banked row-8 configurations, the four RPG lifecycle variants and one UNROM 512 flash + equipment + Save range case (shift 12, record 139). It exercises assembly, symbols, the resolved `@size` overlap checks and Lua generation, rejects any build exception and never skips. **11 builds, 11 ok, 0 failed** (the C6c review, again before the pilot and before the matrix, and in the C6d final checks). It is a build/range prerequisite, **not a split-timing certificate**. **It runs before every future pilot and matrix launch and in the release run.**
- **The replacement.** The old candidate, freeze and failed pilot are kept as evidence. The new freeze, `c6c-candidate-r2.json` with `freeze-values-before-r2.json`, against the same C6b: candidate-set hash `751dba21c49059df9c1084f5444537c7fbbabf4e1b927b6aecac34e859edfe0b` (was `cff0f1d6776a53d5891703a16be9e0c6754b241bd36cc0a3f6c4f6abff1e6735`), modification-diff hash `61484ee1326a9ae0e5fa253a9b67975422db7f6acee5314b6a081009e21607fa` (was `be73ba4c...`), `productionDiffEmpty` true, ring fingerprint `b8e9295f...` over 252 inputs (was `bfb5f897...`). The four values were re-verified equal at the C6c commit and at the matrix launch (`freeze-values-matrix-r2.json`). The 11 regenerated sabotage patches change only index and hunk-offset lines (bodies byte-identical).
- **What did not change.** Neither no-flag snapshot (re-run after the fix: S1b 11 configurations x 5 artifacts and S1c 12 x 2 artifacts, byte-identical to the tracked snapshots), the production tree, any judge, threshold, bound or certificate. Only the row-8 harness ROM and Lua hashes changed, as E20 allowed (the 18 action harness ROMs of 21.8).
- **The runtime proof boundary.** The build check proves the relocated harness assembles and generates on every configuration it covers. Its split *timing* is proved only by the matrix's row 8, whose result is in 21.2, 21.7 and 21.8.

### 21.10 The pilot rulings and the partial-pilot counts (E22)

The replacement pilot (`pilot-r2`, the same 256-job manifest: 256 of 385 jobs, 128 of 128 kinds) was refused 16 times at the E18 gate (17 preflight attempts, from 21:39:24 at load1 22.46 to 21:54:31 at 20.38), then launched **at 21:55:32 at load1 19.66** (the threshold was not lowered) and finished 23:45:02 with `DONE exit=1`, `matrix: 256 jobs, 1 unexpected; provenance: 1664 stamps, 0 problems`. The one unexpected result is the expected partial-selection `s1c-gate` GATE FAIL. That saved launch is the L5 evidence of the E18 gate working: sixteen refusals above the threshold, then a launch at 19.66.

- **R1 (accepted by Chris, E22).** That exact partial pilot satisfies C6c step 9's pilot prerequisite, substituting `DONE exit=1` / `256 jobs, 1 unexpected; 1664 stamps, 0 problems` for the literal exit-0 / zero-unexpected wording. The full matrix's requirements (exit 0, 0 unexpected, `GATE PASS` 146/54/232/0/0) are unchanged and were met (21.2).
- **The truthful partial-pilot gate counts** are **132 PASS / 45 UNCERTIFIED / 226 N/A / 0 FAIL / 29 UNMEASURED**. The 29 UNMEASURED are **not all row 9**: **11 are row-9 Mesen control cells, and 18 are rows 2, 4 and 7 on both emulators** for the three deliberately omitted jobs `s1b-U512-V-action-resident`, `s1b-U512-V-rpg-resident` and `s1b-U512-V-rpg-banked`. These are planned pilot omissions, not failed run cells. The 45 UNCERTIFIED are the declared S1b items (15 row-2 Mesen, 15 row-2 jsnes, 15 row-4 Mesen); the three omitted jobs account for the other nine of the full matrix's 54.
- **The 15 expected error stamps:** the six `identity-forced-banked` and nine `identity-ring-forced-0` builds of 21.2, each carrying its witnessed-build-error result and the same status and first error line as its S5 C3 counterpart: 1,643 built + 15 error + 6 comparisons = 1,664 stamps.
- **Pilot checks:** 1,528 expected/present ROM labels from 80 selected build-stamping jobs, none short: 1,513 built ROMs (589 action equal, 924 RPG different with `kernelLoFree` exactly -6) and the 15 expected errors; the CLI-versus-gate comparison of ten cells (saved as cli-compare.out) all EQUAL; the fixture hashes equal `c3b/fixture-hashes-after.txt`.
- **R2 (accepted, E22).** The 11 regenerated sabotage patches (index and hunk-offset lines only) are approved for the frozen candidate despite stop rule 7's literal wording.
- **N1, a plan correction (the accepted plan is frozen and is not edited).** After the renewal, **step 10's F1 diagnostic operand is `--dir=handoff-next/equip/c6/resweep`**. The literal old operand (`handoff-next/s2-c1/resweep`) reports exactly three accounting errors (the recorded engine, harness and generator against the renewed curve), no action-ROM or binding violations and no unexplained project differences. Against the new directory the complete diagnostic passes: 11,760 direct records rebuilt and matched, 832 reuses matched, zero accounting errors, violations or unexplained deltas. The old-directory run stays as historical comparison evidence. The plan's prescribed `CLAUDE.md` sentence ("exactly three triggers") was likewise corrected in C6d for `eq_preview_stat`'s temporary recalculation; the frozen plan file is not edited.

### 21.11 What this section does and does not claim

It records the renewal of the ring certificate onto `ce7d009` and the evidence that the equipment commits changed no action production ROM and no action margin (C6c's E20 harness relocation did change the 18 row-8 action harness ROMs, whose raw streams are equal through the first DONE, 21.8), and changed RPG margins only through C1b's six bytes. It does **not** certify equipment gameplay, split timing by the build check, any S1b figure beyond the unchanged UNCERTIFIED statuses, or the S1b residuals R1-R5. Future work it names and does not do: the terminal-callback and `parseSplitOutput` harness fix (21.8), a measured `$4014` alignment log if the OAM-DMA mechanism is ever to be asserted (21.7.2), and putting `prov_unit.mjs` and `split_prebuild.mjs` into the release run (21.5, 21.9).

### 21.12 C6d final checks (2026-10-19, tree uncommitted at the time of writing)

Run on the C6d tree (HEAD `afbbc26` plus the docs, one `CLAUDE.md` sentence and one test comment), logs in the C6 final-checks directory as c6d-*: the three sample builds (`build:sample`, `build:sample:rpg`, `cli.js sample-rpg-mmc1`) exit 0; `npm test` **4040 pass, 0 fail, 0 skip**; `node --test test/lua/ring_gate/prov_unit.mjs` **60 pass, 0 fail, 0 skip**; `node test/lua/ring_gate/split_prebuild.mjs` **11 builds, 11 ok, 0 failed**; `docs.test.js` + `docclaims.test.js` 65 pass; `npm run smoke` passed (304 steps) at load1 13.8; the six fixture hashes equal `c3b/fixture-hashes-after.txt`; no Mesen process. `CLAUDE.md` went from 19,275 to 19,583 characters (budget 40,000).
