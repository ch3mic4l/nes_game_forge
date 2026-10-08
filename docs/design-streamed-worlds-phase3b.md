# Design record: streamed worlds, phase 3b — the two-nametable ring and its entry gate (slice S1)

**Status, 2026-10-07.** Slice S1 of phase 3b is a *proof*, not an engine change. Nothing under `engine/`, `main/` or `shared/` changed. The whole ring
design below exists as three patches (`test/lua/ring_gate/01-ring-select.patch`, `02-ring-engine.patch`, `03-player-far-branch.patch`) applied at
test time to a `mkdtemp` copy of those three directories, and the gate in `test/lua/ring_gate/` measures that copy on every acceptance cell. The
streamed-map refusal for mirrored boards stays on. Slices S2 onward wire the design into the shipped engine; each lands its own allowance and
proof docs. This file is a dated record: it names constants that exist today only inside the patches.

**The gate certifies a baseline.** The patched copy is made from commit `5138c1f` (the tree after phase 3b slice S0 and the shipped fixes that
preceded S1); `verifyBaseline()` in `test/lua/ring_gate/ringtree.mjs` refuses to run if `engine/`, `main/` or `shared/` differ from it.

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
  patched (`03-player-far-branch.patch`), so that, when the fix lands, it is to be gated to leave the six fixtures' hashes unchanged.
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
  builds a project through *that copy's* public path. It never falls back to the unpatched tree. A sabotage is one more patch under
  `test/lua/ring_gate/sabotage/` applied on top.
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

### 2.5 Controls

The control declarations live in one table (`test/lua/ring_gate/s1ccontrols.mjs`) that the runner, the job list, the gate script and the unit tests
all read. A control that targets one axis declares what it does on the other: it must *pass* there, as a declared non-catch, so a control that
changes more than it says shows up. Harness mutations (the validator is told something false) are labelled as such.

| Target | Controls (S1 sabotage list, plan 2.6 and 2.7) |
|---|---|
| removed timing coverage | row 5 mutations `cover-drop-start`, `cover-drop-class`, `cover-drop-worst` (each fails `cover:domain` and nothing else) |
| strip length 30 | `strip-len-30-vertical` patch (rows 1 static, 3, 5); row 5 arm mutation `arm-len30` |
| wrap left at 30 or 32 | `wrap-col-30`, `wrap-row-32` patches (rows 1 static, 5); the row 3 oracle declares it a non-catch for the column wrap, which is dead code in every legal scene |
| destination `+$08` on vertical | `dest-plus08-vertical` patch (rows 3, 5) |
| wrong axis, start offset past the wrap | row 5 arm mutations |
| render loop over four nametables, compacted `cam_nt` index, `STREAM_RING` forced 0 | patches caught by rows 1 and 3 |
| `chunk4`, `mixed3` | row 5 build breaks |
| `no-flash`, `slow-drain`, a fixed length of 87, a split close row on horizontal, an unsplit one on vertical | row 6 breaks and harness mutations |
| full-system padding | `pad-mainline-over` (fails the `G` gate), `pad-mainline-under` (passes the gate, refused by the class estimate) |
| R6/R7 corrupted transiently (restored before the routine returns), on RPG banked and action | `prg-transient` (caught on `r8:prg-group` and `r8:prg-window`; the run completes) |
| R6/R7 corrupted, R0 or a wrong R1, `sei` removed, `split_lock` removed, split armed in a locked frame, split IRQ left armed | row 8 overrides of `engine/banks.asm` and `engine/split.asm` |

## 3. The measured table

**The certificate** is the one final matrix of S1c: `run_matrix.mjs` into the provenance directory `s1c-provenance-final` and the log directory `s1c-logs-final`, started 2026-10-07 21:26 PDT and finished
22:49 PDT with exit status 0 on the accepted 215-file harness fingerprint. Result: 386 jobs, 0 unexpected, 1,821 provenance stamps (1,800 built, 15 error, 6 ring-0 comparisons), 0 problems. `ringprovindex.mjs --verify`
passes on the finalized index with 0 problems, and `run_sw_ring_gate.sh` run in its default verify mode prints, over 24 cell and build lines × 9 rows × 2 emulators (432 entries):
**144 PASS, 54 UNCERTIFIED, 234 N/A, 0 FAIL, 0 UNMEASURED.** The 234 N/A entries are source proofs: action × banked on every board (108), row 8 on the MMC1 and U512 cells (24) and on jsnes for the MMC3
cells (6), rows 5 and 6 on jsnes (36), row 4 on jsnes (18), row 7 on Mesen (18), and row 9 where a build carries no S1c control or the emulator is jsnes (24).

| Row | Result | Figures (all on Mesen) |
|---|---|---|
| 1 identity | PASS, 18 buildable cells | static, emulator-independent |
| 2 workload | PASS with UNCERTIFIED items, both emulators | see below |
| 3 oracle | PASS, both emulators | |
| 4 mainline `G` | measured `G` PASS, class bounds UNCERTIFIED | the largest measured `G` over the classes C1 to C4c and their variants is 20,033 cycles against the gate 29,780 |
| 5 NMI deadline | PASS on 18 buildable cells; every certified margin positive | tightest **certified** margin 33.67 cycles (mixed) and 115.67 (strip), MMC3-H RPG banked; tightest **observed** margin 90.0 (mixed) and 186.0 (strip), the same build; per-build table below |
| 6 close | PASS on 18 buildable cells | vertical 88 bytes (`vram_len` 87) split, horizontal 85 bytes (`vram_len` 84) in one packet; least margin 277.0 cycles (MMC3 vertical RPG resident) |
| 7 decoded seam | PASS on jsnes; Mesen N/A | see "Limits" |
| 8 MMC3 split and lock | PASS on the 6 MMC3 buildable cells | 1,550 to 2,104 measured frames, 389 to 603 `switch_prg_bank` calls and 1,260 to 1,748 split IRQs per cell |
| 9 controls | 156 S1c control runs (25 controls): 135 caught as declared, 21 passing as declared (a declared non-catch on the other axis), 0 not as declared | plus the S1a and S1b controls; the four `prg-transient` runs are caught |

Row 5 per build. "Observed" is the minimum margin to the end of vblank over every recorded interrupt (it contains the measured entry delay, at most 10.7 cycles). "Bound W" is the static longest path of the build's
own `nmi` handler; the **certified** margin is 2,272.67 − (22 entry + W + 6 `rti`). The two are recorded separately and never added. Cells: strip / mixed.

| cell | build | observed margin | bound W | certified margin |
|---|---|---|---|---|
| MMC1-V | action resident | 277.0 / 170.0 | 2030 / 2120 | 214.67 / 124.67 |
| MMC1-V | RPG resident | 277.0 / 171.0 | 2030 / 2119 | 214.67 / 125.67 |
| MMC1-V | RPG banked | 271.0 / 168.0 | 2049 / 2130 | 195.67 / 114.67 |
| MMC1-H | action resident | 259.0 / 126.0 | 2042 / 2164 | 202.67 / 80.67 |
| MMC1-H | RPG resident | 257.3 / 159.0 | 2042 / 2132 | 202.67 / 112.67 |
| MMC1-H | RPG banked | 250.0 / 154.0 | 2063 / 2145 | 181.67 / 99.67 |
| MMC3-V | action resident | 213.0 / 107.0 | 2096 / 2185 | 148.67 / 59.67 |
| MMC3-V | RPG resident | 213.3 / 108.0 | 2096 / 2185 | 148.67 / 59.67 |
| MMC3-V | RPG banked | 207.0 / 104.0 | 2115 / 2196 | 129.67 / 48.67 |
| MMC3-H | action resident | 194.0 / 94.0 | 2108 / 2198 | 136.67 / 46.67 |
| MMC3-H | RPG resident | 193.0 / 94.0 | 2108 / 2198 | 136.67 / 46.67 |
| MMC3-H | RPG banked | **186.0 / 90.0** | 2129 / 2211 | **115.67 / 33.67** |
| U512-V | action resident | 277.0 / 172.0 | 2030 / 2119 | 214.67 / 125.67 |
| U512-V | RPG resident | 277.0 / 171.0 | 2030 / 2119 | 214.67 / 125.67 |
| U512-V | RPG banked | 271.0 / 168.0 | 2049 / 2130 | 195.67 / 114.67 |
| U512-H | action resident | 257.0 / 159.0 | 2042 / 2132 | 202.67 / 112.67 |
| U512-H | RPG resident | 257.3 / 158.3 | 2042 / 2132 | 202.67 / 112.67 |
| U512-H | RPG banked | 250.3 / 155.3 | 2063 / 2145 | 181.67 / 99.67 |

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

## 5. Limits of this proof (rulings pending when this record was written)

- **Row 7 on Mesen is N/A.** The seams are decoded from jsnes state only; Mesen runs the same two seam specs to their end and their bodies are
  compared with jsnes's, but no Mesen-side decode exists.
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
  - *Known follow-up.* The harness's unit tests do not pin every opcode's absolute cost: a deliberately wrong PHA base cost (3 changed to 2, in memory) still passes all 116 `s1c_unit.mjs` tests. The submitted
    cost table is correct (all 151 documented opcode costs and lengths agree with the vendored CPU table), so this is a test-coverage gap, not an error in any bound; a direct assertion is a later hardening.
- **Row 8, one control is scoped.** `prg-r7-wrong` (R6/R7 permanently corrupted) is run on the action resident build only. On the RPG banked build a
  permanently wrong R7 runs the battle overlay out of the wrong window and the run does not finish (Mesen timeout, exit 99), which is not a sound run
  and so cannot count as a catch. `prg-transient` (wrong values committed and restored before the routine returns) completes on both builds and both MMC3
  axes and is caught on `r8:prg-group` and `r8:prg-window`. The other split controls run on both builds.
- **Row 8, `r8:prg-window` is weak on a one-bank world.** On a cell where only one bank value is ever called (every MMC3 vertical cell), a misdirected
  R6/R7 write rewrites an equal value and only `r8:prg-group`, `r8:terrain` and the lock items can see it.
- **The legacy close template keeps its fixed length.** With the `--ring` flag absent the close builder's output must be byte-identical to what it
  was, so its old section still carries the constant 87; the ring sections have no fixed length.
- **Sabotage 6 is interpreted.** "The split IRQ left armed across the strip" is implemented as the IRQ handler leaving the line enabled when its
  program ends, and is caught by the IRQ count and grammar items.

## 6. Where the proof lives

`test/lua/run_sw_ring_gate.sh` prints the table from a certificate. `test/lua/ring_gate/run_matrix.mjs` produces the certificate;
`test/lua/ring_gate/ringjobs.mjs` is its job list and `test/lua/ring_gate/s1ccontrols.mjs` its control table. The harness's own unit tests are
`iso_unit.mjs`, `judge_unit.mjs`, `prov_unit.mjs`, `s1b_unit.mjs`, `record_controls.mjs` and `s1c_unit.mjs` in the same directory.
`docs/design-streamed-worlds-phase3a.md` records the shelved handover window; `docs/design-streamed-worlds.md` is the current-state design.
