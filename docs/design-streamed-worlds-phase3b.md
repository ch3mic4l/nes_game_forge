# Design record: streamed worlds, phase 3b — the two-nametable ring and its entry gate (slice S1)

**Status, 2026-10-07.** Slice S1 of phase 3b is a *proof*, not an engine change. Nothing under `engine/`, `main/` or `shared/` changed. The whole ring
design below existed as three patches (`01-ring-select.patch`, `02-ring-engine.patch`, `03-player-far-branch.patch`) applied at
test time to a `mkdtemp` copy of those three directories, and the gate in `test/lua/ring_gate/` measured that copy on every acceptance cell. (Since S2 the
vertical half is production code, and since S3 C1 the horizontal half is too: the three patches are **retired** and deleted, see section 10; the gate now applies
only `00-refusal-lift.patch` to a production tree; since S4a / S4b the lift is only needed for what production still refuses, sections 11 and 13.) The
streamed-map refusal for mirrored boards stayed on through S3. Slices S2 onward wire the design into the shipped engine; each lands its own allowance and
proof docs. This file is a dated record: it names constants (`SW_RING_ROW_LEN`, the row fork's labels) that the S1 prototype's patches added and that production has carried since S3 C1.

**The gate certifies a baseline.** S1 made its patched copy from commit `5138c1f` (the tree after phase 3b slice S0 and the shipped fixes that
preceded S1). **S2 commit C3 rebaselined it onto C2, `cd7a9f8`, the production vertical ring; S3 commit C2 rebaselined it onto C1, `aaa678a`, the production vertical AND
horizontal ring; S4a commit C2 rebaselined it onto S4a C1, `9b00c59`, which admits MMC3 action games:** `BASELINE` in `test/lua/ring_gate/ringtree.mjs` is now `9b00c5992a0ed2d9c34f1b710526af6977192ee6`, and `verifyBaseline()` there refuses to run if
`engine/`, `main/` or `shared/` differ from it. At S4a C2 the six cells (MMC1, MMC3 and U512, each V and H) run on shipped forks, byte for byte; the MMC3 action cells run on a tree that is `9b00c59` itself with no patch at all, the
other cells on `9b00c59` plus the narrowed refusal lift (sections 10 to 12). The measured table in section 3 below was produced at `5138c1f` (S1) and
`cd7a9f8` (S2 C3) and `aaa678a` (S3 C2), all kept there as history, and **re-measured once at `9b00c59` by the S4a C2 final matrix** (section 3's certificate paragraph).

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

**The certificate** is the one full matrix of S4a commit C2: `run_matrix.mjs` into the provenance directory `s4a-c2-provenance-final` and the log directory `s4a-c2-logs-final`, `--jobs=18` (49 GB available), started 2026-10-13 11:49 PDT and
finished 13:14 PDT with exit status 0, on baseline `9b00c59` (S4a C1: the production vertical and horizontal ring, admitted on MMC3 for action games) and a 248-input harness fingerprint that every one of its stamps carries (and every one of the 1,271 stamps of the pilot that preceded it). Result: 377 jobs, 0 unexpected, 1,785 provenance stamps (1,764 built, 15 error, 6
ring-0 comparisons), 0 problems. `ringprovindex.mjs --verify` passes on the finalized index with 0 problems, and `run_sw_ring_gate.sh` run in its default verify mode (INDEX hashes checked, 0 audit problems, 0 stale-fingerprint stamps; 376 matrix jobs judged, the gate does not judge itself) prints, over 24 cell and build lines × 9 rows × 2
emulators (432 entries): **144 PASS, 54 UNCERTIFIED, 234 N/A, 0 FAIL, 0 UNMEASURED**, `GATE PASS`: the same totals, and the same table cell for cell (the gate's output differs from S3 C2's in one line, the directory paths), as the S3 C2 and S2 C3 certificates and the S1c certificate (below, "history"). The stamps' tree form follows the cell: the 258 stamps of the two MMC3 action cells (V and H) are **unlifted**, 160 with an empty patch set and
`productionProof.lifted: false` (the tree is `9b00c59`, nothing else) and 98 carrying only a sabotage patch (the controls), and every MMC3 RPG, MMC1 and UNROM 512 stamp (1,509 of them) carries `00-refusal-lift.patch`; the form is derived from production's own `streamRingAdmitted` at the baseline, and
the audit found 0 stamps that disagree with it. Every vertical stamp (897) is
`production-vertical` and every horizontal stamp (882) is `production-horizontal`, each with an exact-content proof (`productionProof.exact`); 876 of the horizontal stamps and all 897 vertical ones carry consumed-input evidence (the other six horizontal stamps are the ring-0 identity comparisons, which carry the
proof of their patched side instead); the six pristine ring-0 builds have neither, and **no stamp is of a prototype kind**. The 234 N/A entries are source proofs: action × banked on every
board (108), row 8 on the MMC1 and U512 cells (24) and on jsnes for the MMC3 cells (6), rows 5 and 6 on jsnes (36), row 4 on jsnes (18), row 7 on Mesen (18), and row 9 where a build carries no S1c control or the emulator is
jsnes (24). Row 9 prints a control-level N/A proof for every equivalent mutant (section 2.4): `nmi-wrap-row-32` on the three vertical action resident cells, and `nmi-strip-len-30-vertical` and `nmi-wrap-col-30` on the three horizontal ones; those controls are not part of the cell's
row-9 verdict, which is its other controls, so no cell changed status. **No measurement moved because the MMC3 action cells lost the lift:** all 1,764 built ROMs are byte for byte the ROMs of the S3 C2 matrix (same label, same SHA-256), 280 of the 319 JSON logs are byte-identical (the other 39 differ in a provenance block or by one frame or one body), and the MMC3 action ROMs are also pinned equal to plain `node main/build/cli.js` output by a unit (section 12).

*History.* The previous certificate was S3 C2's (matrix `s3-c2-provenance-final`, 2026-10-13 05:44 to 07:12 PDT, baseline `aaa678a`, 247-entry fingerprint, 377 jobs, 1,785 stamps, every ring cell on a lifted tree), with the same totals and table. It is now history (section 8): this harness no longer verifies it
(`run_sw_ring_gate.sh` on its directories prints 1,779 stale-fingerprint stamps and GATE FAIL, which is a property of that old index and of this checkout's baseline, not a defect of either). What differs from it: the baseline and fingerprint; the stamps of the MMC3 action cells (`lifted:false`, empty patch set, or a sabotage patch only, against the lift before);
the sabotage and lift patches' bytes (re-cut at the new baseline; the identity logs differ only in their provenance block: 29 files); and measured quantities that moved by one frame or one body (Mesen run lengths are not deterministic to the frame): row 8's measured-frame counts are one *lower* on five of the six MMC3 cells (so they equal S2 C3's again), and one Mesen body count in the `pad-mainline-over` MMC3-H witness is 375 against 374, inside an item that passes as declared.
The S1c control tally is the same: **147 runs (25 controls): 135 caught as declared, 12 passing as declared, 0 not as declared.** Rows 5 and 6 were produced by logs byte-identical to S3 C2's, so every certified margin, bound W, observed minimum and row 6's least margin (278.0) are S3 C2's for all 18 builds, and the largest measured `G` (20,026) is unchanged.

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
| 4 mainline `G` | measured `G` PASS, class bounds UNCERTIFIED | the largest measured `G` over the classes C1 to C4c and their variants is 20,026 cycles (S2 C3: 20,026; S1c: 20,033) against the gate 29,780; the forced-blank C0 class is exempt and not counted |
| 5 NMI deadline | PASS on 18 buildable cells; every certified margin positive | tightest **certified** margin 33.67 cycles (mixed) and 115.67 (strip), MMC3-H RPG banked; tightest **observed** margin 90.0 (mixed) and 186.0 (strip), the same build; every certified margin, bound W and observed minimum is identical to the S3 C2 and S2 C3 certificates' (the horizontal cells moved from prototype to production code at S3 C2, and the MMC3 action cells from a lifted to an unpatched tree at S4a C2, with no change); against S1c five observed minima differ by 1 to 2 cycles (below) |
| 6 close | PASS on 18 buildable cells | vertical 88 bytes (`vram_len` 87) split, horizontal 85 bytes (`vram_len` 84) in one packet; least margin 278.0 cycles (MMC3 vertical action resident, now on an unpatched tree; the same as S3 C2 and S2 C3; S1c: 277.0, MMC3 vertical RPG resident) |
| 7 decoded seam | PASS on jsnes; Mesen N/A | see "Limits" |
| 8 MMC3 split and lock | PASS on the 6 MMC3 buildable cells | 1,550 to 2,104 measured frames (S3 C2: 1,551 to 2,105; S2 C3: 1,550 to 2,104, which this run equals again), 389 to 603 `switch_prg_bank` calls and 1,261 to 1,748 split IRQs per cell (the last two unchanged) |
| 9 controls | 147 S1c control runs (25 controls): 135 caught as declared, 12 passing as declared (a declared non-catch on the other axis), 0 not as declared | plus the S1a and S1b controls; the four `prg-transient` runs are caught; `nmi-wrap-row-32` is N/A on the three vertical action resident cells and `nmi-strip-len-30-vertical` and `nmi-wrap-col-30` on the three horizontal ones (no form on that ring, equivalent mutants), whose row 9 is `P/N` |

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

The table above equals the S3 C2 and S2 C3 certificates' cell for cell (computed by `handoff-next/s4a-c2/final_checks.mjs` from the stamps and logs: 18 positives, 14/14 items each, all certified margins positive, 0 cells differing from S3 C2's table). Relative to the S1c certificate only the observed column of five action resident builds moved (strip / mixed; S1c in parentheses): MMC1-H 258.0 / 127.0 (259.0 / 126.0), MMC1-V 277.0 / 171.0 (277.0 / 170.0), MMC3-H 193.0 / 95.0
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

## 8. Certificate history: the S2 certificate stale for the door landing-default fix (2026-10-12), the S3 C2 certificate that replaced it, and the S4a C2 certificate that replaces that (2026-10-13)

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
The **current certificate** is section 3's (`s4a-c2-provenance-final`, baseline `9b00c59`, 248-input fingerprint, `GATE PASS`); the S3 one is evidence for `aaa678a`, where MMC3 was refused for every game type, and the MMC3 action cells' evidence now comes from unpatched production code. Declared limits carry over unchanged: the 54 UNCERTIFIED cells (section 4), the limits of section 5, and the RULE-A boundary of section 10, which now reads against `9b00c59`: the S1b no-flag check
compares against C1 production output of `aaa678a` and the S1c one against `cd7a9f8`, so neither discovers a regression those baselines carry (both no-flag precheck jobs passed byte for byte against `s1c-cd7a9f8.json` and `s1b-aaa678a.json`, so no re-record was needed).

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
makes the lift a property of the **cell**, not of the gate. The measured table is section 3's, and the MMC3 production table is at the end of this section; both come from the one final matrix.

- **New baseline.** `BASELINE` in `test/lua/ring_gate/ringtree.mjs` is `9b00c5992a0ed2d9c34f1b710526af6977192ee6` (S4a C1). The gate's tree is still `git show` of that commit's `engine/ main/ shared/` plus
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
- **Result of the final matrix.** Section 3 holds the certificate: 377 jobs, 0 unexpected, 1,785 stamps (1,764 built, 15 error, 6 ring-0 comparisons), 0 problems, **144 PASS / 54 UNCERTIFIED / 234 N/A / 0 FAIL / 0 UNMEASURED**, `GATE PASS`, the table equal to S3 C2's cell for cell. Every one of the 1,764 built ROMs is byte for byte
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
