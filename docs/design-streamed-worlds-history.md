> **This file is the round-by-round design-fix record (rounds 1 through fix round 12) for**
> **`docs/design-streamed-worlds.md`, kept for provenance only.** It is superseded as a
> specification by that file: `design-streamed-worlds.md` states the current contract with no
> round numbers in its body; this file preserves every fix round's own reasoning, retracted
> claims, superseded measurements and the full prototype appendix exactly as fix round 12 left it.

# Design: large streamed worlds (ROADMAP item 15)

**Fix round 4.** Review 3 (`handoff-next/streamed-worlds-design-1-review3.md`) returned FIX, 16
findings, eight P1, and — this is the load-bearing correction this round opens with — found that
**fix round 3's own headline claim was wrong**: "R1 is fully closed" and "the incremental torus is
genuinely built and verified" were false. `sw_render_window` (a full redraw) and the incremental
strips computed a world block's own physical position from two genuinely *different* mappings —
one window-relative, one absolute-parity — that only happened to agree at the one aligned origin
every fix-round-3 test used. Review 3's own reproduction (base region 2, window column 0/local 0,
row 0/local 1) is real: physical `$2040` read **33** after a full redraw and **17** after one
incremental strip drew the *same* physical slot — a full redraw and an incremental update
disagreeing about what belongs at one location, the exact defect a torus's own retention property
exists to rule out. **This round fixes it**, invents nothing new to fix it with (the missing piece
was FALLEN STAR's own `modx`/`mody`, world_render.asm:166-182, applied where fix round 3 never
applied it), and reproduces the reviewer's own case reading **17 both times** — confirmed, not
merely argued (§3). Review 3 also found round 3 had **reversed seven decisions earlier rounds had
already settled**, restoring rejected content (a discontinuous MAX_X/MAX_Y crossing model, a false
"screenAttributes clamps" claim, "the torus IS a 2×2 grid of screens," `testplay.js` poking `sw_*`
state directly, hiding the project-wide camera checkbox, and — round 3's own new mistake — a
fabricated "this engine has no `wait_vblank`, main_loop is free-running" methodology that
`engine/boot.asm:114-115`'s own literal `main_loop: jsr wait_vblank` directly contradicts. **All
seven are restored this round, quoted, and marked so they cannot be silently reversed a third
time** (§0/§4/§6/§10).

This round also builds two more real fixes review 3 asked for as P1s, not merely reasoning about
them: **finding 2 (map-edge policy)** — `sw_clamp_col`/`sw_clamp_row`, a real, tested window clamp
keeping the whole resident torus inside a map at least as big as it, proven exact (not
approximate) at all four edges and all four corners of a real grid, with the "map smaller than the
window" case explicitly left as a named, reasoned-not-built policy rather than silently assumed
away. **Finding 3 (the code-bank transaction)** — `sw_read_transaction`, a genuinely new routine
distinct from `sw_peek_byte`: it restores the **caller's own PRG bank** (an explicit argument), not
the field's current screen, proven against the reviewer's own exact stub (select bank 7, peek
(1,0), confirm `$8000` still reads the bank-7 byte after return) — `sw_peek_byte` is kept, unedited,
as the correct choice for a caller that genuinely *is* field code (the straddling-collision case,
§4/R8), not deleted, since review 3 asked to keep both and say which is which. The verification
suite grew from 49 checks to **60** (T8: an aligned odd/odd-parity redraw, all four terrain corners
and all four attribute quadrants of one cell, checked against independently hand-derived values,
never copied from the routine under test; T9: the code-bank transaction). Findings 4-16 and the
seven restored decisions are addressed below with real citations, each labelled honestly as fixed,
partially addressed, or still reasoned rather than built — the same three-category discipline
review 3's own disposition tables use, continued rather than restarted.

## 0. What was read, and this round's own methodology

### Corrections to the original brief's own "facts I measured" list (restored from round 1)

Round 2's own rewrite of this section dropped the following list outright, in violation of the fix
rounds' own "no whole-file writes, nothing shrinks without saying what left and why" rule — restored
here verbatim from round 1's own text (every item independently re-verified against this exact tree
during round 1, not carried on faith):

- **`LIMITS.metatiles` is 64, not 256.** `shared/project.js:242` reads `metatiles: 64`. The 256
  figure in the original brief's Q3 ("this project has up to 256 metatiles here") is the *tile*
  ceiling (one CHR bank's 256-entry background table), not the *metatile* ceiling — a metatile is a
  `{tiles:[4], palette, collision}` record over that tile table, and `LIMITS.metatiles` caps how
  many such records a project may author. Verified against the real `sample-u512` build:
  `assets/metatiles.inc` emits exactly 64 entries per `mt_tl`/`mt_tr`/`mt_bl`/`mt_br`/`mt_collision`
  column. This matters for the RAM-cache question — but turned out moot, since this engine needs no
  RAM cache of metatile defs at all (see the second structural fact below).
- Every other measured figure in the original brief's list was independently re-verified against
  this exact tree and found correct, including all six fixtures' kernel-lo free-byte figures
  (`node main/build/cli.js` on all six, byte-for-byte identical); `kernelTableBytes`'s 13
  bytes/screen + 9/map (`generate.js:2265-2341`, confirmed against the twelve named table
  emissions, one byte per screen each, at `generate.js:3601-3617` — one line off the original
  brief's own "~3601-3616," since the twelfth table, `screen_ent_hi`, is emitted at 3617);
  `SCREEN_BYTES=304`/`SCREEN_REGION_BYTES=8176`/`LIMITS.mapGrid=4`/`screenCols=16`/`screenRows=15`/
  `SCREEN_METATILES=240`; `screenAttributes`'s TL|TR<<2|BL<<4|BR<<6 packing (`generate.js:1979-1997`,
  the function itself — `shared/project.js:2217` the brief cites is only a *comment* pointing at it,
  not the function's own home) — **corrected this round (review 3, finding 16)**: round 1's own
  original text called the bottom-row treatment "clamped"; it is not. `generate.js:1993-1995`'s own
  `if (col >= LIMITS.screenCols || row >= LIMITS.screenRows) continue;` **skips** an out-of-range
  quadrant (leaves it 0, contributing nothing), the way this document's own R2 fix already
  correctly described it (§3: "matching this project's own `screenAttributes`' skip convention, not
  FALLEN STAR's clamp"). Round 1's own facts list said "clamped" from the start; fix round 3's own
  verbatim restoration of that list carried the error forward instead of catching it against
  content this document's own later sections had already corrected — the general lesson (§16 below):
  restoring historical text must be checked against what is CURRENTLY known to be true, not
  copied on faith merely because it once shipped. `set_screen_ptr`/
  `draw_screen_at`/`redraw_screen` and the RAM addresses named; the twelve camera zero-page bytes
  (`constants.asm:505-556`) and their unconditional-reservation discipline; `vram_buf`'s
  three-producer 81-byte worst case; `msg_name_idx=$059F` as the last claimed byte before the flash
  pages, confirmed with a fresh scan of every absolute (non-zero-page) RAM label in
  `constants.asm` — the free gap between it and `flash_driver=$0600` is exactly 96 bytes
  ($05A0-$05FF); `cameraAxes` at `cartridge.js:90-98`, verbatim.
- **One structural fact the original brief did not raise, load-bearing for Q1's own shape choice**:
  a screen's own 64-byte `_attr` table is *never stored in the project JSON* — `screenAttributes` is
  called only at generate time (`generate.js:3659`, `emitScreens`), from `project.metatiles`. A
  streamed map's screens can therefore drop the stored `_attr` table entirely with no authoring-side
  loss; see Q1 (§5).
- **A second structural fact, also load-bearing**: `mt_tl`/`mt_tr`/`mt_bl`/`mt_br`/`mt_collision`
  (`assets/metatiles.inc`) are emitted into the **fixed, permanently-mapped kernel-lo bank**
  (`engine/main.asm:44`, between the `kernel_lo.inc` bank/org directive at line 42 and `boot.asm`'s
  own include at line 51 — confirmed by reading the actual include order in a real build). FALLEN
  STAR's own `blk_tl/tr/bl/br/pal` (`assets/world.inc`) live in **`BANK_WORLD`, a switchable
  bank**, which is *why* FALLEN STAR needs `copy_block_defs` to mirror them into RAM (160 bytes)
  before the NMI streamer can read them without bank-switching. This project's metatile catalogue
  needs **no such RAM mirror at all** — `mt_tl,x` is readable from anywhere, including NMI, at any
  time, with zero bank switch. This is the single biggest mechanical difference from FALLEN STAR and
  is what makes the whole RAM budget lighter than FALLEN STAR's own.
- **A third, corrective fact**: this project has **no runtime per-metatile palette table at all**
  (no `mt_pal`) — `screenAttributes` computes the palette bits at *build* time from
  `project.metatiles[id].palette`, baking them into the stored `_attr` table, and nothing else ever
  reads a metatile's palette at runtime. FALLEN STAR's `blk_pal` (read every block by
  `ns_draw_attr`) has no existing counterpart here. Adding one — `mt_pal`, one byte per metatile,
  alongside `mt_collision` — is a real, additive generator change this design needs; it is not a
  gap in the original brief's fact list, it is a gap in the *engine*, found by trying to adapt
  FALLEN STAR's own attribute RMW to this project's tables (§3).
- **A fourth correction, on `prgLayout`**: the original brief's Q1 describes "26-per-region
  packing." That figure is unchanged and correct, but `shared/cartridge.js:554-568`'s own
  `prgLayout` reveals a fact the brief did not name and this design's addressing depends on: **one
  `switch_prg_bank` argument selects TWO 8 KB regions at once** — nesasm bank `prgBank*2` at
  `$8000`, `prgBank*2+1` at `$A000`, both mapped in by the same call. Confirmed against
  `sample-u512`'s own generated `assets/screens.inc`: `screen_0` is emitted under `.bank 1` / `.org
  $A000` — the *second* half of `switch_prg_bank`'s prgBank 0. §3's addressing routine folds this
  pairing in explicitly (one more bit: which half a given region index falls in), confirmed built.

### Finding 18 (fix round 1's own, kept — round 2 dropped this too)

Round 1's own Mesen testing — and fix round 1's own first attempt — never applied
`applyHeaderPatch`'s battery/four-screen/NES-2.0 rewrite, since it only runs inside `buildProject`'s
own pipeline (`main/build/pipeline.js`), never inside a direct `nesasm` invocation. Every ROM
tested against a bare `nesasm` build therefore carries a raw, unpatched header (ordinary vertical
mirroring, no NES 2.0 CHR-RAM declaration, no battery/flash bit) until this is corrected by hand.
The first real symptom, round 1, was two "different" physical nametables reading back identical
content — which looks exactly like an addressing bug until the header is checked. **This round hit
the identical trap a third time**, independently, before finding fix round 1's own note about it:
`minimal-u512/build/main.patched.nes` (this round's own R2/R5 fixtures) was stale relative to a
freshly reassembled `main.nes`/`main.fns` after this round's own edits (streamworld.asm's added
debug tables, the R4 NMI hook, `sw_peek_byte`), and every jsnes-side symbol lookup silently
continued to work (since `main.fns`'s own addresses matched the fresh build) while every *content*
assertion failed, because the CPU was executing against stale ROM bytes read from
`main.patched.nes`. Found by comparing file timestamps, not by symptom alone — the general lesson
finding 18 exists to record: **a header-patched ROM is a build artefact of its own, not a
byproduct of assembling `main.asm`, and must be regenerated (via `shared/cartridge.js`'s
`applyHeaderPatch`, called directly, mirroring what `buildProject`/`main/build/pipeline.js` do
inside the real pipeline) every time `main.nes` itself changes** — this round's own scripts
(`proto-tools/build_deadline_fixture.mjs`) automate this so it can no longer be forgotten by hand.

### This round's own new reading

`engine/entities.asm:358-381` (`entity_contact`) and `engine/player.asm:44-45` (the two-axis-
crossing claim) were re-read again this round and re-confirmed (§4); newly read this round:
`engine/combat.asm:300-345` (`player_hazard`'s own `probe_x = player_x+8`/`probe_y = player_y+12`
8-bit adds, and `probe_type`'s own `(probe_y & $F0) + (probe_x >> 4)` index formula, both in full —
§4/R8), `engine/player.asm:230-315` (`probe_type`/`probe_solid`/`cross_left`/`cross_right` in full,
the `MAX_X=240`/`MAX_Y=224` crossing-landing constants at `constants.asm:1363-1364`), `engine/
boot.asm:286-301` and `engine/save.asm:296-302` (both real `cmp #NUM_SCREENS` sentinel-range sites
— §5/R12), `engine/constants.asm:1373` (`NO_SCREEN = $FF`, the neighbour-table sentinel — §5/R12),
`main/build/generate.js:3111` (`NUM_SCREENS = ${flat.length}`, confirming the emitted equate is a
plain decimal literal, not a symbolic constant nesasm could otherwise widen).

**Methodology change from round 2, load-bearing for everything below**: round 2's own Mesen-only
verification missed the incremental-torus defect because the *test* (a single `sw_render_window`
call) could not have caught a bug that only exists in the *incremental strip* path — a full redraw
recomputes everything fresh every time, so a window-relative-addressing bug is invisible to it by
construction. This round's own primary verification tool is this project's own **jsnes core plus
`test/lib/callroutine.js`** (the identical technique `camera.test.js`/`rpg.test.js` already use for
isolated routine calls) rather than Mesen's own Lua sandbox — full multi-frame, multi-strip,
reversal and negative-control scenarios are far easier to drive and assert against deterministically
this way, and CLAUDE.md's own "Mesen, not jsnes, is the authority on vblank timing" caveat is about
*cycle-accurate timing*, not functional correctness of VRAM content, which jsnes reproduces exactly
(confirmed: every byte this round's own script asserts was cross-checked against the real, raw
fixture bytes on disk, not against jsnes's own behaviour circularly). Mesen is used this round only
for R4's own timing figures, via `test/lib/callroutine.js`'s identical stub-JSR technique running
inside jsnes (isolated CPU-cycle counts, the same shape the reviewer's own CPU-stepping used) —
**not** a full hardware-timed vblank proof, which remains unbuilt and is named as such in §12.

### Two real traps fix round 2's own testing hit, kept in the record

1. **`nes.ppu.vramMem` is indexed by the raw PPU address, not an offset from `$2000`.** The first
   version of fix round 2's own verification script computed `vramMem[address - 0x2000]` (matching a
   mental model of "vramMem starts at the nametables"), and every single content assertion failed
   as a result — not because the addressing code was wrong, but because the *test* was reading the
   wrong array slot. Found by instrumenting `nes.ppu.writeMem` directly (which confirmed the CPU was
   writing the *correct* values to the *correct* addresses, e.g. `writeMem($2b80, 5)`) and only then
   discovering the readback side was off by the `$2000` it shouldn't have subtracted. A second,
   related trap: `nes.cpu.REG_A` does not exist on this engine's own jsnes fork — the field is
   `REG_ACC` (confirmed by grepping `camera.test.js`'s own usage) — silently leaving the accumulator
   unset for a `callRoutine` invocation and making every test depending on the entering argument
   fail in a way that looked, at first, like a logic bug rather than a harness bug.
2. **`sw_render_window`'s own cold-path `sw_goto` calls make it cost roughly 210,000 emulated
   6502 steps for one full four-nametable pass** — comfortably over `callRoutine`'s own 20,000-step
   ceiling (chosen for ordinary single-routine calls). This is a real, measured cost of the
   *cold* path's own repeated-add multiplies and divisions running once per attribute cell and once
   per tile (60+ `sw_goto` calls per nametable), not a bug — consistent with §5's own placement
   argument that this path must never run from NMI. A local, raised-limit variant of `callRoutine`
   was used for `sw_render_window` calls only; the shared `test/lib/callroutine.js` file itself was
   not modified.

### Four real traps this round's own testing hit, kept in the record

3. **A jsnes ROM must run a few real boot frames before any routine call means anything, on a
   CHR-RAM/mapper-register board.** The first attempt at this round's own `sw_peek_byte` test
   (R5) called `NES.loadROM()` then jumped straight into `callRoutine` with no frames run first, and
   read back byte 255 (open-bus) for a neighbour screen whose real content was a known, small
   marker value — not because `sw_peek_byte`'s own switch was wrong, but because UNROM 512's mapper
   register (`mapper_shadow`) and CHR-RAM streaming state are only established by `reset`/
   `mapper_init`/`chr_ram_init`, none of which had run. `verify_torus.mjs`'s own `freshNes()`
   already runs five frames before returning (`for (let i = 0; i < 5; i++) nes.frame();`, its own
   comment: "past reset/mapper_init/chr_ram_init") — this round's own new, ad hoc diagnostic
   scripts that skipped this step reproduced the exact symptom the comment already warns about,
   confirming the five-frame rule is load-bearing, not decorative.
4. **`nes.mmap.load(address)` and `nes.cpu.loadFromCartridge(address)` are not the same read, and
   only the second one accounts for the currently-selected PRG bank the way the real CPU does.**
   A diagnostic script written to double-check `sw_goto`'s own bank selection from outside the
   emulated CPU (reading PRG data directly from JS, not through a `callRoutine`) used
   `nes.mmap.load` and got 255 for a byte independently confirmed, via the assembled `.inc` fixture
   file on disk, to be `$02` — `loadFromCartridge` (the same path `cpu.load()` itself uses for
   `addr >= 0x4000`, `renderer/emulator/core/cpu.js:2333-2358`) reads it correctly. Kept as a trap
   because it produced the identical symptom (255) as trap 3 above for an unrelated reason, and the
   two were briefly conflated before being told apart by re-testing with the five-frame boot fix
   applied and the read method unchanged (still 255 — proving read method, not boot state, was the
   second bug).
5. **`tya` clobbers A, and A can be a live argument the very next instruction still needs.**
   `sw_peek_byte`'s own first draft stashed its `Y` argument (a byte offset) across the `jsr sw_goto`
   call with `tya; pha` — but `sw_goto`'s own calling convention takes the target screen's column in
   `A`, and `tya` overwrites `A` with `Y`'s value *before* the call, silently substituting the wrong
   column. The routine still ran, still switched to *some* screen, and still returned a plausible-
   looking (wrong) byte — no crash, no obviously-invalid state, exactly the class of bug CLAUDE.md's
   own 6502-traps section already warns about ("`tya`/`txa` clobber A inside a loop that relied on a
   value loaded before it") applied to a register argument rather than a loop-carried value. Caught
   only because the test asserted the *specific* neighbour's *specific* marker byte, not merely "a
   byte came back." Fixed by not stashing `Y` at all: `sw_goto`'s own body never touches `Y`,
   confirmed by reading it, so no stash was ever needed.
6. **A scratch byte's name does not tell you who else uses it.** The same first draft also stashed
   the offset in `sw_tmp3` — a name that reads, in isolation, like free scratch — without checking
   that `sw_goto` itself uses `sw_tmp3` as its own row accumulator from its very first instruction
   (`stx sw_tmp3`). The call clobbered the stash before returning. This is the identical shape of
   bug R11 (fix round 2) already found and fixed once, in a *different* pair of routines
   (`sw_nmi_stream`/`sw_goto` sharing `sw_tmp4`) — the fix there (`sw_ns_chunk`, a byte dedicated to
   one routine alone) did not, and could not, prevent a *third* routine from making the same mistake
   against a *different* shared byte. The general lesson, not fixed by any one byte rename: **before
   using any `sw_tmp*` byte across a call to `sw_goto` (or anything that calls it), check what
   `sw_goto`'s own body already uses** — there is no compiler to catch this, and nesasm assembles a
   collision exactly as happily as it assembles correct code.

## 1. Recommendation at a glance

**Round 5 note, read this first**: the bullets below are fix round 4's own snapshot, kept as
written rather than rewritten bullet-by-bullet (§13's own round-5 changelog entry is the current,
authoritative summary of what changed this round). Specifically superseded by round 5, with the
real location named: **R9** (below, "unchanged... without a concrete implementation") — closed,
`sw_project_axis`, §4/finding 6; **R12**'s own `save.asm` gap ("not yet resolved") — closed, §5/
finding 10; **R5**'s own cost figures (§ below, superseded by finding 2's real, decomposed
measurement, §5); **R13's** ~698k-cycle anchor (superseded by the current tree's own 835,723-cycle
measurement, §10 decision 2). Everything else below is still accurate as fix round 4 left it.

- **R1 (the torus's own physical mapping — genuinely fixed THIS round, not fix round 3)**: fix
  round 3's own claim ("R1 is fully closed... genuinely built... verified") was **false**, per
  review 3 finding 1: `sw_render_window` (a full redraw) placed content using a *window-relative*
  mapping (`sw_col_at_offset`/`sw_row_at_offset` fed the raw torus position directly), while the
  incremental strips place content using the *absolute-parity* mapping — two different functions
  computing "where does world content X physically go," agreeing only at the one aligned origin
  every fix-round-3 test happened to use. Reproduced exactly as the reviewer described: physical
  `$2040` read 33 after a redraw and 17 after one incremental strip drew the same slot. **Fixed this
  round**: two new routines, `sw_rw_col_delta`/`sw_rw_row_delta`, compute the window's own ring
  origin (`wbase_col`/`wbase_row` — FALLEN STAR's own `wbase_x`/`wbase_y`, `world_render.asm:
  167-168`) once per redraw and subtract-and-wrap every torus position against it *before* handing
  the result to the existing (and already-correct) `sw_col_at_offset`/`sw_row_at_offset` — the
  missing half of FALLEN STAR's own `modx`/`mody`. Reproduces the reviewer's own case reading **17
  both times** now (`proto-tools/diag_r1_repro.mjs`), and a new integration test (T8) proves the fix
  at the *other* parity too (an aligned odd/odd-screen origin — every prior test only ever used
  even/even), checking all four physical nametables' own terrain and all four attribute quadrants
  of one cell against independently hand-derived values.
- **R2 (attribute correctness)**: unchanged from fix round 3 — the underlying skip-logic
  discrepancy really was a too-small test fixture (§3), not a code defect, and the fix (a taller
  fixture) still holds now that R1's own addressing is genuinely correct underneath it. **The
  verification suite is now 60 checks, 0 fail** (49 from fix round 3, +9: T8's own eight assertions,
  T9 below, +2 more overall from re-deriving the R2 test's own expected values against the corrected
  R1 mapping — see §3 for the exact count reconciliation, since review 3 finding 16 is right that
  "49," "45," and "43+2" all named genuinely different states of this suite and must not be
  conflated).
- **R3 (throughput)**: unchanged from fix round 2/3 — the "1 block/frame sustains 1 block/frame of
  camera travel" error stays retracted (a 30-block column write sustains only 0.53 px/frame of
  camera travel, not 1 block); six real choices with their own visible consequences remain returned
  to Chris (§10), not decided here.
- **R4 (NMI deadline)**: **the hardware-timed verdict from fix round 3 stands, but this round
  corrects a real methodology error in how it is explained** (review 3 finding 10). Fix round 3's
  own claim — "this engine has no `wait_vblank`, `main_loop` is a free-running loop, NMI is a
  genuinely asynchronous interrupt that can land anywhere" — is **false**: `engine/boot.asm:
  114-115` is literally `main_loop: jsr wait_vblank`, and `wait_vblank` (`:303-309`) clears and
  spins on the NMI-set `vblank` flag, meaning `main_loop` is synced to vblank at its own top, every
  single iteration. The **correct** explanation for why arming at `main_loop`'s own top raced
  `nmi_rti` (the real, reproducible symptom fix round 3 found): arming there pokes state *before*
  `wait_vblank` consumes the upcoming vblank — that imminent NMI fires while the CPU is still stuck
  inside `wait_vblank`'s own spin loop, well before that same iteration ever reaches
  `main_loop_ready` (near the very end, after `split_select` on MMC3, `:271-280`). The poked
  workload is therefore only actually *finished* one full iteration later, at the *following*
  `main_loop_ready`/`nmi_rti` pair — not the one the naive hook observes. Arming at
  `main_loop_ready`'s own exec instead (unchanged from fix round 3 — the *fix* was always correct,
  only the *explanation* was fabricated) targets exactly the right NMI, the last publication point
  before the loop returns to `wait_vblank` for a fresh, freshly-synced cycle. Result, on both the
  four-screen UNROM 512 fixture and
  MMC3 with the font split live: **`SW_STREAM_CHUNK=3` misses the deadline** (`exit 5`,
  reproducible on both boards — the NMI lands roughly 25-26 scanlines after vblank starts, well past
  scanline 260); **`SW_STREAM_CHUNK=1` meets it, with a real but thin margin** (`exit 0` on both
  boards, landing at scanline 259 of 260 — about one scanline, ~97 cycles, of headroom). A chunk=3
  negative control on the identical harness fails as it must, proving the check is not vacuous.
  Isolated (jsnes, `callRoutine`) cycle costs for the rebuilt routine, cross-checked against the
  Mesen result and internally monotonic: 404/841/1246 cycles for a 1/2/3-block chunk. **The
  recommendation changes**: ship `SW_STREAM_CHUNK=1` as the only size this round's own measurement
  found safe: this document's own earlier "measured both at 1 and 3 this round" framing is corrected
  — 3 was measured and found to fail.

  **SUPERSEDED (fix round 7, decision A) — this measurement was against the PRE-arbitration NMI
  (a drain and a chunk running unconditionally in the same vblank), never the real production
  shape.** Under decision A's own NMI arbitration (§10, boot.asm's own splice: either the drain
  runs or the strip runs, never both), `SW_STREAM_CHUNK=3` finishes inside real Mesen vblank timing
  with nothing else running that vblank, on both boards, both physical parities — the real,
  measured negative control is 4, not 2 or 3 (§10 Decision 1, proof 1). This measurement's own raw
  numbers (404/841/1246 isolated cycles, the drain+chunk miss at 3) are real and kept as history;
  only the *reading* — "1 is the only safe size" — no longer holds once the workload it was
  measured against is the correct production one.
- **R5 (the code-bank transaction — a genuinely new routine this round, not `sw_peek_byte`
  relabelled)**: review 3 finding 3 caught a real gap fix round 3 left: `sw_peek_byte` ends with
  `jsr sw_locate_current`, which restores the **field's current screen's own bank** — correct for a
  caller that genuinely *is* mainline/field code (the straddling-collision case, §4/R8), but wrong
  for a caller resident in a *different* bank (the RPG battle region, or any future banked
  strip-reader/`sw_render_window` placement), which would return into whatever the field bank's own
  instructions happen to be, not its own. **Built this round**: `sw_read_transaction`, a second,
  distinct routine taking the caller's own PRG bank number as an explicit argument
  (`sw_caller_bank`, set by the caller before the `jsr`) and restoring *that* via `switch_prg_bank`
  before returning — proven against the reviewer's own exact stub (T9): select bank 7, peek
  screen (1,0), confirm `$8000` still reads the bank-7 byte afterward, not the field bank's own
  content. **Both routines are kept** — `sw_peek_byte` is not deleted or redefined, since the
  straddling-collision consumer (§4/R8) genuinely wants "restore my own field screen," and
  `sw_read_transaction` is for anything that isn't field code. Cost, reviewer's own reproduction
  confirmed: sw_peek_byte at (1,0) costs ~292 cycles; the general-purpose `sw_goto`-based cost
  varies by target column/row (the reviewer's own 292/886/836/905-cycle spread at different
  coordinates, §4/R8, is `sw_goto`'s own cold-path cost, shared by both routines, not something
  `sw_read_transaction` adds on top).
- **R6 (the record)**: unchanged from fix round 2/3's own arithmetic (338-byte, uncapped, ported
  through `sw_goto`/`sw_cross_*`), but review 3 finding 5 found a real, unresolved contract gap this
  round does not close: **ordinary (non-streamed) screens still use today's 304-byte-plus-variable
  record** (`generate.js:2066-2076`), so "screens share the new record" was never true and is
  retracted — a streamed map's screens use the 338-byte record, an ordinary map's own screens are
  unchanged, and the generator must emit the *right one* per map, which is not yet designed to the
  byte level (§5).
- **R7 (capacity)**: this round's own re-run of the reviewer's own methodology against this exact
  tree reproduces the reviewer's numbers **exactly** (`handoff-next/streamed-worlds-ceilings-check.mjs`,
  the orchestrator's own script, run fresh this round: action 52 NROM / 170 MMC1 / 168 MMC3 / 156
  UNROM 512, RPG 153 MMC1 / 140 MMC3 / 138 UNROM 512, byte-for-byte) — these are no longer "borrowed
  numbers," they are this round's own independently reproduced measurement, with the script itself
  now in Appendix A. Region counts for a streamed map's own packing are freshly measured too, direct
  from `shared/cartridge.js`'s real exported functions (not reconstructed by hand): MMC1 14 data
  regions, MMC3 30 (`prgUnits` 16), UNROM 512 61 (62 total minus 1 CHR-RAM tileset region), UxROM 14
  — all with one tileset, no banked code. **Still missing, per review 3 finding 5**: these are raw
  region counts, not *usable* regions after the actual code placement (R5's own banked cold path),
  the RPG battle region, tilesets and the save reservation are all subtracted — §5's own
  `H×ceil(W/24)<=14` recommendation is retracted as stated for exactly this reason.
- **R8 (straddling and actors)**: this round re-confirms the exact index formula (`probe_type`'s
  own `(probe_y & $F0) + (probe_x >> 4)`, `engine/player.asm:230-252`) and corrects
  `entity_contact`'s own citation to `engine/combat.asm:358` (not `entities.asm`, fix round 3's own
  error). **Decision 1 (restored, review 3 finding 6) directly changes this section's own
  recommendation**: fix round 3's own "keep `MAX_X=240`/`MAX_Y=224` atomic landings" is **retracted**
  — a streamed crossing is continuous at the natural pixel origin (256/240) with overshoot
  preserved, not a discontinuous jump to a fixed far edge (moving right from world x=240 to a
  neighbour's x=0 under the OLD model changes world position by 16 px in one frame; the continuous
  model changes it by whatever the player's own speed is that frame, 2-4 px, matching every other
  frame of movement). `sw_peek_byte`/`sw_read_transaction` remain the concrete restore mechanism a
  continuous-crossing boundary probe needs; the consumer design itself (wiring these into
  `player_hazard`/`entity_contact`) is still reasoned, not built (§4/R8).
- **R11 (RAM/reentrancy)**: unchanged from fix round 2/3 — **fixed**, `sw_nmi_stream` owns
  `sw_ns_chunk`, confirmed still disjoint from `sw_goto`'s own scratch this round (and the general
  lesson generalised in §0's traps 5-6: the same *shape* of collision recurred in a third routine
  this round, against a different byte, proving the R11 fix does not by itself prevent the next one).
- **R12 (identity)**: the sentinel argument (255-screen ceiling, `NO_SCREEN=$FF`) stands, but review
  3 finding 12 caught a real off-by-one in how fix round 3 stated the *rule*: **refuse `count > 255`
  (not `count >= 255`)** — 255 screens means valid ids 0-254 with 255 reserved as the sentinel, so a
  project with exactly 255 screens is legal (id 254 is its highest, `cmp #255` still correctly
  rejects a warp/save target of 255). Fix round 3's own "refuses at 255" phrasing would have wrongly
  rejected a fully-legal 255-screen project. **Also found this round**: `engine/save.asm:314-325`
  rejects a save whose own `player_y > MAX_Y` (224) — a continuous-crossing player (decision 1,
  restored) can legitimately occupy y=225-239 while straddling a screen edge, which the *existing*
  save validator would reject outright; this is a real, new consequence of restoring the continuous
  model that the identity/save audit must now also cover, not yet resolved (§5).
- **R9 (projection)**: unchanged from fix round 2/3 — still names what's needed (a real coordinate
  conversion, camera derivation, OAM Y convention, per-tile edge policy) without a concrete
  implementation; §4 corrects the item-12 camera citation (`engine/camera.asm` is a screen-edge
  *slide*, not a centring camera — FALLEN STAR's own 120/112 centre offset is recommended, not
  already shipped).
- **R10 (frame ownership)**: the corrected rule (ownership change, not camera movement, sets
  freshness) stands; the transition table and short `cam_dirty` publication contract fix round 1
  had are restored this round (decision 6) after fix round 3 silently dropped them (§4).
- **R13-R16**: dialogue's costing, gating's per-mapper predicate, and bound-tile handling are
  addressed in their own sections below (§5/§6), citing real code this round checked; still design
  work, not built code, and labelled as such.

## 2. The FALLEN STAR mapping table

Every routine, RAM byte and constant the brief named, mapped to what this design does with it. "Adopted"
= carried over with no change to its own logic; "adapted" = the same idea, different mechanism;
"rejected" = not needed here, with the reason. **Four rows changed this round** (`update_stream`,
`mod30`, `modx`/`mody`, `block_solid_at` — review 3, findings 1/6/16, decision 3): fix round 3's own
claim that only the `modx`/`mody` row needed correcting was itself incomplete, since the "torus IS a
2×2 grid of screens, no modulo needed" premise it left standing in the *other* three rows was the
exact false premise R1's own real bug (§3) disproves. The `modx`/`mody` row's own history: round 1/2
rejected `modx`/`mody`-style mapping outright ("adapted, rejected re: modulo mapping"); fix round 3
claimed to have built and verified the fix but only implemented half of it (§3); this round (fix
round 4) completes it. This round adopts the logical-window/physical-ring separation FALLEN STAR's own
`win_bx/win_by` (logical, world-block-granular) and `wbase_x/wbase_y` (physical, `win_bx mod 32`/
`win_by mod 30`) represent, expressed in this project's own `(screen, local)` terms per the fix-2
brief's own explicit instruction ("in this project (screen, local) pairs are fine as the
representation").

| FALLEN STAR | Shape | This project's name | Disposition |
|---|---|---|---|
| `read_block` (`world_stream.asm:20-44`) | one bank-switched byte read, restore `BANK_WORLD` | `sw_goto`/`sw_locate_current` | **Adapted.** Granularity moved from "one metatile, always bank-switched" to "one *screen* (240 metatiles), bank-switched once per crossing" — because a screen here is already exactly a FALLEN-STAR-style 2-nametable-pair quadrant (16x15 metatiles = 16 wide, 15 tall, matching a torus quadrant 1:1), so per-metatile addressing is only needed for the *entering edge* strip, not for ordinary gameplay reads. `read_block`'s own "restore the caller's bank" contract is kept verbatim (`sw_stream_start_col`/`row` and `sw_render_window` each restore the current screen via `sw_locate_current` before returning). |
| `blk_tl/tr/bl/br/pal` (`world.inc`, BANK_WORLD) | switchable-bank block-def tables | `mt_tl/mt_tr/mt_bl/mt_br` (existing) + `mt_pal` (new) | **Adopted the concept, rejected the switchable placement.** Already fixed kernel-lo here (§0's correction) — no bank-switch needed to read a definition, ever. `mt_pal` is the one genuinely new table (§0), read directly by `sw_ns_draw_attr`/`sw_rw_attr_*`. |
| `copy_block_defs` (`world_stream.asm:551-567`) | boot-time RAM mirror of the block defs | — | **Rejected.** Exists only because FALLEN STAR's defs are switchable; this project's are already resident. Zero RAM, zero boot-time cost. |
| `blkc_tl/tr/bl/br/pal` (RAM, $0600-$069F, 32-byte stride) | RAM cache of block defs | — | **Rejected**, same reason. This is the single largest RAM saving versus a literal port: 160 bytes never allocated. |
| `stream_init`/`center_window` (`world_stream.asm:54-91`) | boot-time window centring + full render | `sw_goto` (built, generalized to the cold arbitrary-column/row case) + `sw_render_window` (built this round, §3) | **Adapted and now fully built.** `sw_goto` does the one-time division/multiply this design needs at map entry or any cold reposition; `sw_render_window` is the full four-nametable render, built and verified this round (§3), not merely reasoned as round 1 left it. |
| `world_to_cam_blocks` (`world_stream.asm:93-122`) | 16-bit world pixel → block coordinate | (folded into Q2's on-demand world-position derivation) | **Adapted.** No persistent 16-bit camera position is kept here (Q2); the equivalent derivation happens from `flat_screen`+`player_x/y` each frame it is needed. |
| `update_stream` (`world_stream.asm:132-223`) | per-frame window-follow + strip arming + teleport guard | not built this round — reasoned in §3/§4 | **Adapted, not yet built.** The teleport-guard shape (a lag threshold triggering a full re-render) is kept. **Corrected this round (review 3, finding 16, decision 3)**: round 3's own claim that this project's window is "screen-granular, not block-granular" in its outer loop is retracted — R1's own real fix (§3) needed genuine block-granular ring arithmetic (`sw_rw_wbase_col`/`sw_rw_wbase_row`, a physical ring position in BLOCK units, plus a real wraparound subtract), the identical granularity FALLEN STAR's own `wbase_x`/`wbase_y` use; the window is addressed in `(screen,local)` terms (Q1's own representation choice), not flat block numbers, but that is a coordinate *representation* choice, not a coarser *granularity* — the ring itself is still tracked one block at a time. |
| `stream_start_col`/`stream_start_row` (`world_stream.asm:227-307`) | read 30/32 block ids into `sbuf`, arm a strip | `sw_stream_start_col`/`sw_stream_start_row` | **Adapted and built (both axes, this round).** Reads a neighbour *screen's* own edge column/row via the incremental-addressing routine, not a raw 65536-block linear read; both take an absolute (screen,local) pair rather than a window-relative offset (R1's own fix, §3). |
| `mod30` (`world_stream.asm:309-317`) | modulo for the 30-row torus | `sw_rw_row_delta` (built this round, §3) | **Corrected this round (review 3, findings 1/16, decision 3) — retracted, not merely re-labelled.** Round 1/2's own rejection ("not needed... the torus IS a 2x2 grid of screens... no modulo arithmetic") was the exact premise R1's own real bug (§3) disproves: `sw_render_window` needed genuine wraparound arithmetic (`sw_rw_row_delta`, a conditional single subtract exploiting the bounded 0-29 input range — cheaper than FALLEN STAR's own general loop, but the same modulo *operation*, not its absence) to convert a physical ring position back to a world position correctly at any window alignment. "Which half of the torus a screen belongs to" is still a parity test (unaffected); "which world content a given physical slot holds" needed the modulo this row originally, wrongly, rejected outright. |
| `nmi_stream`/`ns_draw_block`/`ns_draw_attr` (`world_stream.asm:325-547`) | per-vblank chunk draw + attribute RMW via `attr_shadow` | `sw_nmi_stream`/`sw_ns_draw_block`/`sw_ns_draw_attr` | **Adapted and built, rebuilt this round for R1/R11.** Same `attr_shadow` RAM-mirror idea (unavoidable — PPU VRAM isn't cheaply re-readable mid-frame); same quadrant-packing math (this project's `screenAttributes` already uses the identical TL\|TR<<2\|BL<<4\|BR<<6 layout, §0, so no translation was needed); reads `mt_tl/tr/bl/br/pal` directly instead of a RAM cache. `sw_nmi_stream` now uses its own dedicated `sw_ns_chunk` byte (R11) and wraps `st_vary` at the real physical-ring bound (R1) instead of incrementing forever. FALLEN STAR's own chunk size (3) measured too expensive against the PRE-arbitration NMI this round found (§3/R4) — under fix round 7's own NMI arbitration (§10 Decision 1), chunk 3 is the real, measured, safe size on both boards after all; `SW_STREAM_CHUNK=1` is retracted. |
| `render_window` (`world_render.asm:15-140`) | full four-nametable forced-blank redraw, ~25 frames, keeps music ticking | `sw_render_window` (built and verified this round) | **Adapted and built this round.** This project's `redraw_screen` already blanks for exactly one frame and never needed a music-ticking trick (CLAUDE.md's own note); `sw_render_window` measured at ~210,000 jsnes emulated steps per call (§3) — real-hardware frame-count cost is not yet measured (R4, §7/§12), so whether the identical "keep music ticking across N frames" trick is needed here too remains open. |
| `modx`/`mody` (`world_render.asm:166-185`) | torus modulo-window coordinate mapping | `sw_rw_col_delta`/`sw_rw_row_delta` plus `sw_col_at_offset`/`sw_row_at_offset` (built and genuinely correct THIS round, §3 — fix round 3's own "built and verified" claim for this exact row was false, per review 3 finding 1) | **Built and verified this round, not fix round 3, despite fix round 3's own identical claim here.** Fix round 3 correctly diagnosed that round 1/2's rejection of `modx`/`mody` was wrong in principle, but its own replacement (`sw_col_at_offset`/`sw_row_at_offset` fed a raw torus position directly) implemented only HALF of `modx`/`mody`'s own two-step shape — the "decompose an origin-relative delta" half, never the "subtract the window's own ring origin and wrap" half that makes it origin-*relative* at all. `sw_rw_col_delta`/`sw_rw_row_delta` (this round, §3) supply exactly that missing half, computed from `sw_rw_wbase_col`/`sw_rw_wbase_row` (FALLEN STAR's own `wbase_x`/`wbase_y`, `world_render.asm:167-168`, in this project's `(screen,local)` terms). Reproduced against the reviewer's own exact case: `$2040` now reads 17 both after a redraw and after an incremental strip, where fix round 3's own incomplete version read 33 and 17 respectively. |
| `load_zone_palette`/`check_zone_palette`/`zone_pal_scan`/`nmi_zone_palette` (`world_stream.asm:570-637`, `world_render.asm:271-541`) | per-continent recolour, staged and committed only over open ocean | — | **Rejected, out of scope** (§11). Nothing in this project's schema has a "zone" concept; naming it as a future companion feature is as far as this round goes. |
| `block_solid_at` (`world_stream.asm:639-673`) | collision probe via `read_block` | `sw_peek_byte`/`sw_read_transaction` (§4/R8, §5) | **Rejected as a separate routine; the "collision unchanged" framing itself is retracted (review 3, finding 6/16, decision 3).** This project's own `probe_solid`-family reads collision off the *current* screen's own `mtptr`-relative data for a probe that stays on the current screen — that much is genuinely unchanged. But "Q2 keeps that unchanged" overstated it: a probe cast ahead of a *continuously crossing* player (decision 1) can reach a neighbour screen before ownership transfers, which `probe_type`'s own current-screen-only index formula cannot answer at all (§4/R8's own consumer audit) — real, new work (wide intermediates, per-direction normalisation, the `sw_peek_byte`/`sw_read_transaction` restore mechanism), not "no new collision-probe routine is needed." |
| `update_camera`/`update_scroll` (`data.asm:1112-1229`) | 16-bit-world-position camera centring and torus scroll-register derivation | item 12's own `cam_x_lo/y_lo/cam_nt` + a new per-frame derivation from `flat_screen`+`player_x/y` (not built this round) | **Adapted, reasoned not built.** Item 12 already ships the register and its NMI publication (§2 of `docs/design-camera.md`); this item's own job is only to keep that register fed continuously instead of only at a screen-edge slide, which is a mainline-code change (not built this round — see §4/§9's phase scope) rather than a new register. |
| `WORLD_WB=256`, `MAP_UBANK0` | world-size and map-bank-base constants | `sw_grid_w`/`sw_grid_h`/`sw_base_bank`/`sw_regions_per_row` (per-map, built) | **Adapted.** Per-map, not global — this project supports many maps, some streamed and some not, so these are per-map fields rather than global constants. |
| `WORLD_NUM_BLOCKS` copy-loop bound (`world_stream.asm:565`) | how many block defs to mirror | — | **Rejected**, no mirror exists to bound (§0's second correction). |
| a "block" (16x16 px, `{tl,tr,bl,br,pal,solid}`) | the addressable terrain unit | a metatile (`{tiles:[4], palette, collision}`) | **Adopted as a 1:1 concept match**, no translation needed beyond field names — confirmed by `screenAttributes`'s own quadrant math (§0) and `mt_collision`'s own existing role as `blk_solid`'s counterpart. |

## 3. Q3 — the streaming consumer: the torus, rebuilt and verified

### R1 — the physical ring: the strip's own addressing was correct; the full redraw's was not

**Fix round 3's own claim that this was "fully closed" was false (review 3, finding 1) — the
paragraph below describes the STRIP path's own addressing, which was and remains correct; the bug
was entirely in `sw_render_window`'s own, separate mapping, fixed further down this section.**

**The core fix**: a metatile's physical position in the 32×30 ring is a function of its **absolute**
`(screenCol, localCol)`/`(screenRow, localRow)`, never of "how far it sits from the window's current
edge." Because a screen (16×15 metatiles) is exactly half the ring on each axis, this reduces to a
single fact per axis: **the screen's own row/column parity selects the physical half** (even
screenCol → left half, odd → right half; even screenRow → top half, odd → bottom half), and the tile
position within that half is exactly `2×localCol` / `2×localRow` — no modulo arithmetic needed at
the point of drawing at all. This is a direct, derived consequence of the screen/ring size
relationship (16×2=32, 15×2=30), not an approximation: `sw_stream_start_col`/`row` now compute
`st_ftile`/`st_fnt` from the entering edge's own `(screenCol/Row, localCol/Row)` pair via this
parity rule, and `st_vary` — now genuinely the physical ring coordinate (0-29 for a column strip,
0-31 for a row strip) — is initialised at arm time from the window's own **current** varying-axis
start (`(win_row_screen&1)*15 + win_row_local` for a column strip; the column analogue for a row
strip) and **wrapped**, not merely incremented, by `sw_nmi_stream` (`inc st_vary`, then compare
against 30 or 32 and reset to 0 on overflow — round 2's own version never wrapped at all).

**Why the retained-content property now actually holds**: since physical position is a pure function
of world-absolute coordinates, drawing the entering edge at its own computed physical slot can never
disturb any *other* physical slot's own content — the ring's own defining property, which round 2's
window-relative addressing violated (it computed a physical position that changed every time the
window itself moved, requiring content to be redrawn everywhere to stay correct, which round 2 never
did). This is now provably true, not merely argued (below).

### R1's own real bug and fix: `sw_render_window` used a different mapping than the strips

**The bug, reproduced exactly as review 3 described it.** `sw_render_window`'s own `sw_rw_probe`
computes a torus position (`sw_rw_base_col + sw_rw_col`, `sw_rw_base_row + sw_rw_row` — 0-31/0-29,
correct so far) and then fed it **directly** to `sw_col_at_offset`/`sw_row_at_offset`, which add
`win_col_local`/`win_row_local` and decompose the sum into `(screenCol,localCol)`/
`(screenRow,localRow)` — a plain, unwrapped **addition**. The strips place content by **parity**
(above), a completely different function of the same inputs. At the aligned origin
(`win_col_local=win_row_local=0`) the two happen to agree; at review 3's own case (base region 2,
window column 0/local 0, row 0/local 1), they do not: physical `$2040` read **33** after a full
redraw and **17** after one incremental strip wrote the same slot — reproduced this round exactly
(`proto-tools/diag_r1_repro.mjs`), before any fix.

**The fix**: FALLEN STAR's own `modx`/`mody` (`world_render.asm:166-182`) are the missing piece —
they compute a **window-relative delta** (`(torusPos - wbase) mod ringSize`) before decomposing it
against the window's own origin, where `wbase_x`/`wbase_y` is the window's own logical origin
expressed *in ring coordinates*. This project's own `sw_col_at_offset`/`sw_row_at_offset` already
correctly implement the *second* half of that (decompose an origin-relative delta into
screen/local) — they were simply never given the delta; they were given the raw, un-wrapped torus
position instead. Two new routines close the gap:

```asm
sw_rw_col_delta:            ; A = torus col (0-31) -> A = window-relative delta
  sec
  sbc sw_rw_wbase_col
  and #31
  rts

sw_rw_row_delta:             ; A = torus row (0-29) -> A = window-relative delta
  clc
  adc #30
  sec
  sbc sw_rw_wbase_row
  cmp #30
  bcc sw_rw_row_delta_ok
  sec
  sbc #30
sw_rw_row_delta_ok:
  rts
```

`sw_rw_wbase_col`/`sw_rw_wbase_row` (two new RAM bytes, chained after `sw_rw_tmp2`) are computed
once per `sw_render_window` call — `(win_col_screen&1)*16 + win_col_local` /
`(win_row_screen&1)*15 + win_row_local` — FALLEN STAR's own `wbase_x`/`wbase_y`, expressed in this
project's `(screen,local)` terms. `sw_rw_probe` and all four attribute-quadrant probes
(`sw_rw_attr_x0/x1/y0/y1`) now call `sw_rw_col_delta`/`sw_rw_row_delta` immediately before
`sw_col_at_offset`/`sw_row_at_offset`, never after (Appendix A, in full).

**Reproduced fixed, not merely argued**: the identical reviewer's case now reads **17 both times**
(`diag_r1_repro.mjs`, re-run this round):

```
After sw_render_window, $2040 = 17 (expect 17, was 33 before the fix)
After one incremental sw_nmi_stream block, $2040 = 17 (expect 17, matching the redraw)
PASS: full redraw and incremental strip now agree (both 17)
```

**T8 (new this round) proves the fix at the *other* parity too** — every fix-round-3 test used an
even/even-screen window origin exclusively; T8 redraws at an *aligned odd/odd* origin
(screenCol=1,screenRow=1) and checks all four physical nametables' own terrain (block (0,0) of
each) plus all four attribute quadrants of one cell, against values independently hand-derived in
`proto-tools/diag_t8_design.mjs` (a plain-JS re-implementation of the same algorithm, not a copy of
the routine under test) — including the striking, correct fact that for this origin, physical NT0
(top-left) holds screen (2,2) — the *diagonal opposite* of the window's own named origin screen
(1,1), which lands in NT3 instead, because (1,1) is itself odd/odd and the parity rule places it in
the bottom-right physical quadrant. All eight T8 assertions pass.

### Finding 2 — map-edge policy: a real, tested window clamp for a map at least as big as the window

**The gap, confirmed real by review 3**: nothing clamped the window at all. `sw_grid_w`/`sw_grid_h`
were allocated fields with no reader — a window near a map's own far edge would happily compute
`screenCol`/`screenRow` values naming screens that do not exist, and `sw_goto` would switch to
whatever PRG bank that computation produced, reading garbage terrain (`$FF`) into `mt_pal` as an
out-of-bounds index — exactly the failure mode review 3's own finding 2 named, and the same shape
of bug R1's own fix (above) already fixed once for a *different* reason. Review 3 also confirmed the
widened 2×3 fixture from fix round 3 *itself* still overreads for a window with `localCol=1` — a
window origin at local offset 1 needs a screen one further right than its own starting screen, on
top of the row axis fix round 3 already widened for — closed this round by widening the fixture to
3×3 (§ Verification below).

**Built this round: `sw_clamp_col`/`sw_clamp_row`** (FALLEN STAR's own `center_window`,
`world_stream.asm:62-91`, clamps the *whole* window, not just the camera/viewport — the model this
design follows). Given a desired `(screenCol, localCol)` and the map's own `sw_grid_w` (screen
count), the routine clamps so the window's own far edge (32 blocks from its origin) never exceeds
the grid:

```asm
sw_clamp_col:
  sta sw_tmp2               ; desired screenCol
  stx sw_tmp                ; desired localCol
  lda sw_grid_w
  sec
  sbc #2
  cmp sw_tmp2
  bcc sw_clamp_col_clamp    ; max < screenCol -> overflow, clamp
  bne sw_clamp_col_fine     ; max > screenCol -> always fine, no clamp
  lda sw_tmp                ; max == screenCol: only local==0 is fine
  beq sw_clamp_col_fine
sw_clamp_col_clamp:
  lda sw_grid_w
  sec
  sbc #2
  ldx #0
  rts
sw_clamp_col_fine:
  lda sw_tmp2
  ldx sw_tmp
  rts
```

`sw_clamp_row` is the identical shape against `sw_grid_h` (screen height 15, not 16 — the clamp
*rule* is unchanged, since it never depended on the screen/ring size values, only on "a screen is
one unit of the grid axis"). **This clamp is exact, not approximate**, despite clamping at
screen+local granularity rather than full 16-bit flat arithmetic: the window's own far edge is
`origin + 32` (columns) or `+30` (rows), and a screen is exactly 16 (or 15) blocks — so the *only*
way a desired origin overflows the grid is (a) `screenCol` already exceeds `grid_w-2`, in which case
any local offset also overflows, or (b) `screenCol == grid_w-2` with a *nonzero* local offset (the
far edge lands exactly `local` blocks past the grid's own extent). Both cases clamp to the identical
result, `(grid_w-2, 0)` — proved by 16-bit derivation and confirmed by direct testing, not merely
reasoned.

**Tested at all four edges and all four corners of a real 5×4 grid** (`proto-tools/diag_r2_clamp.mjs`,
14 checks, all passing): the left/top edge (never clamped), the interior (never clamped), the
right/bottom edge exactly at the boundary (`(3,0)` on a 5-wide grid stays `(3,0)`, confirming the
clamp does not over-clamp a value that is already exactly valid), one block past the edge
(`(3,5)→(3,0)`), and fully past the edge (`(4,15)→(3,0)`) — plus all four corner combinations.

**Superseded this round (review 5, finding 2): no refusal, no wraparound — Chris's decision 3
(§10) already settled small maps with fill-metatile padding, built and tested, not merely
reasoned.** The `sw_grid_w >= 2`/`sw_grid_h >= 2` precondition above is **retracted as a
precondition at all**: `sw_terrain_or_fill` (`streamworld.asm`, §5/finding 2) checks the resolved
`(screenCol, screenRow)` against the map's own authored `sw_grid_w`/`sw_grid_h` **before** any bank
switch is attempted, substituting `sw_fill_metatile_id` (a new per-map field, default 0) whenever
the resolved screen falls outside the grid on *either* axis, in *either* direction — a one-wide or
one-tall map (the original ask's own SMB3-style case) works exactly the same way a normal-sized map
does, since the check is a plain unsigned comparison against whatever `sw_grid_w`/`sw_grid_h` is:
`screenCol >= gridW` catches both "past the right edge" and a wrapped-negative "past the left edge"
(`screenCol=255`, the 8-bit wrap of `-1`) with the identical branch, no separate sign test needed.
Proven (`proto-tools/diag_r5_fill.mjs`): the reviewer's own exact reproduction (`sw_grid_w=
sw_grid_h=1`, requesting screen `(1,1)`) now returns the fill id, not fixture id 12; in-bounds reads
on the same tiny grid are unaffected; a nonzero authored fill id is honoured; a wrapped-negative
coordinate on a real 2×2 grid hits the identical fill path; and a real 3×3 grid reads all nine real
screens correctly while everything one step outside reads fill. **No cylindrical wraparound was
built or is needed** — the fix-4 "wrap onto the same screen" idea is retracted along with the
refusal it was paired with, since fill padding answers the same original ask (a map narrower/
shorter than the window stays authorable) without the "retrofit every coordinate decomposition to
be grid-count-aware" cost that idea would have needed.

### Verification, in full — 61 checks, all passing (review 5, finding 10: T3 re-derived from the
compiled chunk, re-run fresh this round, not merely claimed)

**Re-run fresh this round, per review 5's own explicit finding**: the "60, all passing" claim was
stale the moment the compiled `SW_STREAM_CHUNK` default changed from 3 to 1 (decision 1, §10) — T3
hardcoded "10 NMIs" (30 blocks ÷ the OLD chunk-3 default), so this exact suite genuinely printed
**57 ok / 3 FAIL** before this round's own fix (reproduced fresh, not merely accepting the
reviewer's own report of it). **Fixed by deriving T3's own expectation from the real compiled value
instead of a second hardcoded literal**: `sw_debug_chunk` (`streamworld.asm`, a new one-byte ROM
export, `.db SW_STREAM_CHUNK`) lets the test read the actual compiled constant and compute
`Math.ceil(30 / compiledChunk)` itself — at the current default (1), that's 30 NMIs, not 10; the
watchdog is the expectation plus 10 frames of real margin, never tight against what it is checking.
**Currently 61 checks (was 60; T3 gained one assertion, the strip-2 NMI count, previously
unchecked), 0 FAIL, exit 0** — re-run fresh moments before this report, not carried from an earlier
round's own claim.

Built against `minimal-u512` (a from-scratch UNROM-512-fourscreen project, kept from round 2 for its
own kernel-lo headroom) with a fixture at the 338-byte stride (`proto-tools/build_r2_fixture.mjs`,
Appendix A) and `mt_tl[id]==id` (etc.) so any tile byte read back directly identifies which metatile
was drawn. **This round widened the fixture from 2×2 to 2×3 screens** (§ R2 below — the 2×2 grid was
the root cause of the one discrepancy fix round 2 left open, not a code defect), and added **T7**
(R5's own `sw_peek_byte` proof). `proto-tools/verify_torus.mjs` (Appendix A, in full):

```
$ node proto-tools/verify_torus.mjs
ok   T1 st_ftile = 0
ok   T1 st_fnt = 0
ok   T1 st_vary (start) = 0
... (49 lines total, every one "ok")
ALL PASS
```

Before this round's own fixture fix, the identical suite (2×2 fixture, no T7) printed **43 ok, 2
FAIL, exit 1** — reproduced fresh at the start of this round, not carried from memory: the design
document review that requested this round quoted "34 checks, all passing," which was already stale
by fix round 2's own end (fix round 2 built out to 34 named checks in its own narrative but the
shipped script asserts more individual `check()` calls than that once T4/T5's own multi-field
comparisons are each counted — 43, not 34); say exactly what passes and fails, not a round number:
**this round's own fresh run, before any fix, was 43 ok / 2 FAIL** (`R2 NT2 cell(7,0) BL skipped
(0)`, `R2 NT2 cell(7,0) BR skipped (0)`, both `expected 0, got` a nonzero value), and **after the
fixture fix plus T7, 49 ok / 0 FAIL, exit 0**.

- **T1 (column strip arming)**: entering `(screenCol=0, localCol=0)` against the aligned window
  origin `(0,0,0,0)` — confirms `st_ftile=0`, `st_fnt=0`, `st_vary=0`, and **four** of `sbuf`'s 30
  entries against the raw fixture bytes on disk (`sbuf[0]`, `sbuf[14]`, `sbuf[15]`, `sbuf[29]`, not
  every one of the 30 — corrected this round, review 3 finding 16: fix round 3's own text overstated
  this), chosen to include the row-15 screen-boundary crossing (`sbuf[14]` still screen (0,0)'s own
  local row 14; `sbuf[15]` already screen (1,0)'s own local row 0, the fixture's own marker 11).
- **T2 (row strip arming + draw, the reviewer's own reproduction shape)**: entering
  `(screenRow=1, localRow=14)` — odd screenRow, confirming `st_fnt=8` (bottom half) where round 2's
  own row starter always produced 0. Drawing the first block lands the tile at the hand-computed
  physical address `$2B80` (confirmed via direct `vramMem` readback, not an inference from register
  state) and confirms `$2BC0` (that nametable's own attribute space) is untouched by a tile draw —
  the literal shape of the reviewer's own "must not write $23A0/$23C0/$23F8" reproduction, now
  proven to land in nametable space instead.
- **T3 (successive strips through completed NMIs, the retention proof — R1's own central demand;
  fixed this round, review 5 finding 10)**: arms a column strip, drains it via real
  `sw_nmi_stream` calls — **10 of them at the current compiled `SW_STREAM_CHUNK=3`** (fix round 7,
  decision A — was 30 at the retracted `SW_STREAM_CHUNK=1`), derived from
  `sw_debug_chunk` rather than a hardcoded literal, so this expectation cannot silently go stale
  again the way the old "10" did, and self-adjusted correctly when the compiled chunk changed this
  round (re-run, still 61/61) — confirms the physical tiles at both halves of that column are
  correct, then calls `sw_cross_right` and arms a **second** strip one column over, drains it (now
  also asserting its own NMI count, not merely completion), and confirms **the first strip's own
  physical tiles are still exactly what they were** — not merely "still present," but
  byte-identical — while the second strip's own new physical column shows its own correct, different
  content. This is the actual ring-buffer property, proven by direct VRAM readback across two real
  streaming operations, not asserted from a single fresh render.
- **T4/T5 (reversal)**: crossing right twice then left once lands on exactly the same addressing
  state (`sw_col`, `sw_col_rem`, `sw_col_region`, the 16-bit byte offset, and `sw_locate_current`'s
  own resulting `mtptr`) as crossing right once from the same start — and a region-boundary reversal
  (crossing left across the 23→24 boundary, then right back across it) round-trips exactly to the
  starting state, exercising `sw_cross_left`'s own "recompute via a bounded loop" branch, which
  `sw_cross_right`'s own mirror-image branch never reaches.
- **T6 (negative control — R15's own explicit demand)**: arming a strip and **never calling
  `sw_nmi_stream` at all** (the "always-yielding" simulation) leaves the physical tile un-drawn and
  `st_active` still pending — proving this suite's own content assertions would catch a policy that
  never actually streams, not merely one that reports success.
- **T7 (R5's own `sw_peek_byte` proof, new this round)**: peeks screen (1,0)'s own byte 0 (marker 2)
  while `mtptr` is deliberately pre-set to screen (0,0)'s own address (marker 1) — confirms the
  returned byte is the *neighbour's* (2, not 1 and not garbage), confirms `mtptr` is restored to
  exactly its pre-call value afterward, and confirms that restored pointer is **still genuinely
  readable** (a follow-up read through it returns marker 1, the current screen's own real content,
  not merely a byte-identical-by-luck pointer value). See R5 (§5) for the routine itself and the two
  real bugs building it caught. **T7 does not test a banked caller** (review 3, finding 16) — the
  peek in T7 happens from the *same* PRG bank the field data already occupies, so it cannot
  distinguish "restores the field bank" from "restores the caller's own bank" (they're the same
  bank here); T9 below is the test that actually exercises a distinct caller bank.
- **T8 (R1's own real fix, new this round)**: see the R1 write-up above — an aligned odd/odd-screen
  window origin, all four physical nametables' own terrain and all four attribute quadrants of one
  cell, checked against independently hand-derived (not copied) expected values.
- **T9 (finding 3, new this round)**: the reviewer's own stub — select PRG bank 7 (simulating a
  banked caller resident there, distinct from the field's own current bank), call
  `sw_read_transaction` to peek screen (1,0)'s own byte, and confirm `$8000` still reads the
  bank-7 fingerprint afterward, not the field bank's own content. This is the test T7 could not be
  (above): a genuinely different caller bank, proving `sw_read_transaction`'s own code-bank-restore
  contract where `sw_peek_byte`'s field-bank-restore contract would have returned into the wrong
  bank's own instructions.

### R2 — fully closed this round: the discrepancy was the test fixture, not the code

`sw_rw_attr_y1`'s own missing `adc sw_rw_base_row` fix (fix round 2's own primary R2 correction:
`y0` had it, `y1` did not, so every bottom-half attribute quadrant read the wrong world row — as if
`base_row` were always 0) stands, unchanged, confirmed again this round against the reviewer's own
exact reproduction (window origin `(screenCol=0,localCol=1,screenRow=0,localRow=1)`, nametable 2's
cell (0,0) BL quadrant reads world row 17's own palette, not row 2's).

**The secondary refinement fix round 2 left open — the "isolated calls and a full trace both show
A=0 returned, yet the final stored shadow byte is nonzero" discrepancy — is now explained and
closed.** The root cause is a **test fixture too small for the reproduction case it was testing**,
found by direct instruction-level tracing this round (a write-watch on `nes.cpu.write`, since
`nes.mmap.write` never fires for RAM addresses below `$2000` — the CPU's own `write()`
(`renderer/emulator/core/cpu.js:2422-2440`) stores directly to `this.mem[addr & 0x7ff]` for those
addresses, bypassing the mapper entirely, a real trap of its own for anyone instrumenting jsnes RAM
writes from outside the CPU):

- `sw_rw_attr_bl`/`br`'s own `sw_rw_arow==7` skip (matching `screenAttributes`' "skip," not FALLEN
  STAR's clamp) is correct and was never the bug — confirmed again by tracing the actual store: the
  BL and BR quadrant calls for the failing cell genuinely return A=0, and the single 6502 `sta`
  instruction that lands the final byte executes exactly once, with the value it stores computed
  entirely from the accumulator the caller's own shift/OR chain built.
- **The TL/TR quadrants at that same cell (attribute row 7 of nametable 2, cell column 0) are the
  ones producing garbage — and they are never skip-gated, because for a normal, adequately-sized
  fixture they never need to be.** Attribute row 7's TL/TR use `sw_rw_attr_y0`'s own `world tile row
  = arow*2 + base_row` (14+15=29 for NT2, whose `base_row` constant is 15) — always within a
  physical nametable's valid 0-14 row span, so correctly never skipped. But `sw_row_at_offset` then
  adds the *window's own* `win_row_local` (1, in R2's own unaligned reproduction case) on top of
  that window-relative offset before wrapping through 15-row screens to find the real `(screenRow,
  localRow)` pair: `29 + 1 = 30`, which wraps past two full 15-row screens to **screen row 2** —
  a screen the reproduction's own 2×2 fixture never populated. The TL/TR read therefore lands on
  raw, unprogrammed ROM (`$FF`), and `mt_pal,x` with `x=$FF` reads **64 bytes past the end of a
  64-entry table** — the actual source of the nonzero garbage (`0x85` in this round's own
  reproduction), landing in the TL/TR bit positions of the final byte, not the BL/BR positions the
  original bug report's own symptom description implied (bits 0-3 of `0x95`, not bits 4-7 — a detail
  the isolated per-quadrant checks never distinguished, since they checked BL/BR specifically and
  never cross-checked TL/TR at the same cell).
- **Confirmed by extending the fixture, not by reasoning alone**: `build_r2_fixture.mjs` now emits a
  third screen row (`sw_r2_r2c0`/`sw_r2_r2c1`, bank 4, markers 21/22) — the *only* change — and the
  identical assertions that failed before now pass, with no change to `streamworld.asm` itself. This
  is the wrong-implementation-a-test-would-still-pass lesson run in reverse: a **too-small fixture**
  made a **correct implementation** look broken, the mirror image of a broken implementation passing
  a too-permissive test. `sw_render_window`'s own top-level contract (redraw a torus window that may
  span more than two screen rows) was never actually exercised by the 2×2 fixture for the specific
  unaligned window origin R2's reproduction needs — a gap in test coverage, not in the routine.

This closes R2 in full: **0 findings open**, `verify_torus.mjs` now 49/49 (T1-T7 plus both R2
sub-checks), `exit 0`.

### R3 — throughput, the arithmetic corrected

Round 2's own claim ("a 1-block/frame chunk supports 1 block/frame of camera travel") **confused
blocks written with pixels of camera travel**, exactly as the finding states. A 30-block column
needs all 30 of its own blocks written before the camera can have moved a full 16-pixel block's
worth — so **one write per frame sustains 16/30 ≈ 0.53 px/frame**, not 1 block/frame; three writes
sustain ≈1.6 px/frame (below a 2 px/frame walk); four is marginal for one-axis walking alone and
inadequate for dash (4 px/frame) or diagonal movement (both axes' own strips competing for the same
per-frame budget). **Six real, distinct choices**, each with its own visible consequence:

1. **Stop or slow the player at the dead-zone edge** — the player physically cannot outrun the
   camera past a fixed margin; visible as sudden resistance at the edge of the screen.
2. **Let the camera lose the player** — the streamer keeps pace with itself, the player may scroll
   off-screen; almost certainly not acceptable for a game with a single controllable character, named
   only for completeness.
3. **Blank to catch up (the lag guard, generalised)** — beyond a threshold lead, fall back to a full
   forced-blank `sw_render_window` resync rather than continuous streaming; visible as an occasional
   flash/pause rather than smooth scrolling, the identical trade-off FALLEN STAR's own teleport guard
   already accepts for the rare, out-of-band case, generalised here to the *ordinary* case if chosen.
4. **Shorter strips** (candidate (b) from round 1, still not built) — stream only what can become
   visible before the next strip starts, needing the reversal/coverage proof named but not built.
5. **More work per vblank on empty-queue frames** (R4's own variable-rate budget) — read `vram_len`
   and spend whatever cycles are actually free that frame; helps but, per R4's own re-measurement,
   still falls short of dash/diagonal rates even in the best case.
6. **A slower walk speed or no dash on a streamed map** — directly changes how the game *feels* to
   play, the most author-visible option of the six.

**None of these is recommended here as an engineering-only fact.** §10 returns the choice to Chris
explicitly, with the six options and their own visible consequences stated plainly, since no build
exists yet to play-test any of them against.

### R4 — NMI deadline: now a real hardware-timed verdict, not an isolated estimate

**This round built the full-NMI, hardware-timed deadline check R4 asked for and CLAUDE.md's own
"Mesen, not jsnes, is the authority on vblank timing" rule requires**, not merely re-measuring the
routine in isolation. The check (Appendix B: `sw_nmi_deadline.lua.template` +
`proto-tools/build_deadline_fixture.mjs`) follows the identical shape `flash_nmi_timing.lua.template`
already established for this exact class of proof:

- **The fixture**: the same worst-case 70-byte, two-full-32-byte-packet `vram_buf` shape
  `flash_nmi_timing.lua.template` uses (content arbitrary — this check times the drain, never
  renders it — but each packet's own header must be genuine: address-high in nametable space,
  count 32, so `vram_drain`'s own loop runs its full worst-case length rather than a short-circuited
  one), plus a ready-to-draw streaming chunk (`st_active=1`, `st_len`=the chunk size under test,
  `sbuf` holding valid metatile ids) poked directly into RAM — the identical simplification
  `flash_nmi_timing.lua.template` already makes for its own `FLASH_LEFT` arm, disclosed there and
  here rather than driving full gameplay to produce the same state.
- **Where the poke happens, corrected this round (review 3, finding 10)**: fix round 3's own claim
  here — "this engine's `main_loop` has no `wait_vblank` call, the mainline runs completely free of
  vblank, NMI is a genuinely asynchronous interrupt" — is **false**, confirmed by directly reading
  `engine/boot.asm:114-115`: `main_loop: jsr wait_vblank`, the very first thing the loop does every
  iteration, and `wait_vblank` (`:303-309`) clears the NMI-set `vblank` flag and spins until NMI
  sets it again — the loop is synced to vblank at its own top, not free-running at all. The **real**
  explanation for the ordering hazard a first attempt actually hit (arming from `main_loop`'s own
  top raced `nmi_rti` nondeterministically, confirmed: `nmi_rti` fired *before* `main_loop_ready`
  was ever reached, every single time over 200 real frames of run-up): arming at `main_loop`'s own
  top pokes state *before* `wait_vblank` consumes the upcoming vblank, so the imminent NMI (the one
  `wait_vblank` is that very instant waiting for) fires while the CPU is still stuck inside
  `wait_vblank`'s own spin loop — well before that same iteration's own `main_loop_ready` (near the
  end, after `split_select` on MMC3, `:271-280`) is ever reached. The workload only actually
  *finishes* one full iteration later. This is a real methodology error fix round 3 introduced
  while explaining an otherwise-correct fix, not a citation slip — the general lesson (§16, review 3
  finding 16): a fix can be right while its own stated reason is fabricated, and only reading the
  actual source (not re-deriving "what must be true" from an observed symptom) catches that. The
  fix itself is unchanged and still correct: **arm at `MAIN_LOOP_READY`'s own exec, the literal last
  mainline instruction before the `vram_len`/`vram_ready` handshake** — the last publication point
  before the loop returns to `wait_vblank` for a freshly-synced cycle — and check the deadline at
  the immediately following `nmi_rti`, confirmed stable, not merely plausible, by direct diagnostic
  (a dedicated read-back-immediately-after-arming probe, then a
  read-at-nmi probe, both agreeing across repeated runs).
- **Addresses derived from the build, never a literal**: `nmi_rti`/`main_loop_ready` come straight
  out of each build's own `main.fns`; the streaming-state addresses (`st_active`/`st_cur`/`st_len`/
  `st_ftile`/`st_fnt`/`st_vary`/`sbuf`) have no `.fns` entry at all (they are zero-page `=` equates,
  which nesasm's `-s` dump never emits — CLAUDE.md's own long-standing note, confirmed again this
  round) so `streamworld.asm` carries a small `sw_debug_addrs2` table of `LOW`/`HIGH` byte pairs at
  a real, `.fns`-resolvable label, and the builder script reads those two bytes per address straight
  out of the assembled ROM through this project's own jsnes core (`Emulator.peek`) — the same "peek
  the real mapper" technique `build_flash_nmi_roms.mjs` already uses for its own `flash_left`.

**Result — a real deadline miss, and a real, thin pass, both reproduced on two boards:**

| Board | `SW_STREAM_CHUNK` | Mesen exit | Landing (from diagnostic instrumentation) |
|---|---:|---:|---|
| UNROM 512, four-screen (`sample-u512`) | 3 | **5 (deadline miss)** | scanline ≈4 of the *next* frame — ~25-26 scanlines past vblank's own start, ~569 cycles over the ~2273-cycle vblank budget |
| UNROM 512, four-screen (`sample-u512`) | 1 | **0 (pass)** | scanline 259 of 260 — about 1 scanline (~97 cycles) of margin |
| MMC3, font split live (`sample-mmc3`) | 3 | **5 (deadline miss)** | reproduced, exit 5 |
| MMC3, font split live (`sample-mmc3`) | 1 | **0 (pass)** | reproduced, exit 0 |

Both boards use the **hot-path-only** build (`sw_nmi_stream`/`sw_ns_draw_block`/`sw_ns_draw_attr`,
no cold addressing code) — the shape R5's own placement conclusion (§5) says must be resident
regardless of where the cold path ends up — assembled and header-patched fresh for each run, not a
synthetic or shared ROM. **A chunk=3 negative control against the identical harness fails as it
must** (both boards, `exit 5`) — the check is not vacuous. Isolated (jsnes, `test/lib/callroutine.js`)
cycle costs for the same routine, cross-checked and internally monotonic:

| Chunk size | Cycles (isolated, `sw_nmi_stream` alone, real fixtures, both boards identical) |
|---|---:|
| 1 | 404 |
| 2 | 841 |
| 3 | 1246 |

(These are lower than fix round 2's own quoted 344-368/1264-1273 because that round measured the
*full* `streamworld.asm`'s own `sw_nmi_stream`, compiled alongside the cold-path code sharing its
own bank's global layout; this round's own hot-path-only extraction is a different, smaller
assembly and the two figures are not directly comparable byte-for-byte — both are real, both were
measured against a real assembled ROM, neither supersedes the other's own board/build context.)

**The recommendation changes as a direct result of this measurement: ship `SW_STREAM_CHUNK=1`.**
Chunk=3 is not merely "unproven" as fix round 2 left it — it is now **proven to miss the deadline**,
on real hardware timing, on both measured boards. Chunk=1's own margin (~97 cycles) is real but
thin: it assumes nothing else grows the worst-case `vram_buf` drain beyond the 70-byte two-packet
shape measured here, and MMC3's own `split_select` mainline cost (not itself inside the NMI, but
competing for the same frame budget) was not isolated separately this round. **Arbitration remains
specified, not built**: a starvation timeout must never force a chunk into a vblank that already
holds the existing worst-case drain — the same shape FALLEN STAR's own palette-commit skip
(`boot.asm:238-244`) already demonstrates (it *skips* the streaming chunk that vblank rather than
running both), adapted as "a streaming chunk yields to, and is never forced against, a non-empty
`vram_buf`." **`SW_STREAM_CHUNK` as a per-frame budget read from `vram_len`** (R4's own suggested
alternative to a fixed constant) is recommended in shape but not built or measured this round — a
real implementation would read `vram_len` before committing to a chunk size, and given chunk=1's own
thin margin, the variable-rate approach is now the more attractive target for recovering headroom on
an otherwise-idle frame, not merely a nice-to-have.

**SUPERSEDED (fix round 7, decision A) — the arbitration this section calls "specified, not built"
is now built and proven.** The measurement above (chunk=1 the only safe size, both producers
unconditional in the same vblank) was against the wrong NMI shape: fix round 7's own `boot.asm`
splice (§10 Decision 1) makes the drain and the strip genuinely exclusive per vblank — exactly the
"a streaming chunk yields to, and is never forced against, a non-empty `vram_buf`" rule this
paragraph already recommended, now real code, proven on both boards (`proto-tools/
build_arb_fixtures.mjs`, exit 0). Under that arbitration, chunk 3 is the real measured ceiling (not
1), and the variable-`vram_len`-budget alternative this paragraph flags as "more attractive" is no
longer needed to recover headroom — the fixed chunk of 3 already has real, proven margin (§10
Decision 1, proof 2) once it never has to share a vblank with the drain at all. The 404/841/1246
isolated-cycle table above is real hot-path-only `sw_nmi_stream` cost and is unaffected by this
correction; only the "chunk 1 is the ceiling" conclusion built on top of it is retracted.

## 4. Straddling, projection, and frame ownership — corrected against real code

### R8 — straddling and actors

**`engine/combat.asm:324-339`, read in full this round**: it adds 8 or 12 into an **8-bit** probe
coordinate before calling `probe_type`, with no wide or signed intermediate — a horizontal carry is
genuinely lost before any caller could identify "this probe belongs to the neighbouring screen." A
streamed-map probe crossing a screen edge needs a **wide (9-bit minimum) or signed intermediate**
computed *before* truncation, from which the design can decide "still this screen" vs. "the
neighbour" — not the existing 8-bit add. **Vertical normalisation is at 240** (the screen height in
pixels), not a natural 8-bit wrap (256) — the two axes are not symmetric the way round 2 assumed,
and any crossing-threshold design must treat them separately, per-direction, not with one shared
rule.

**`entity_contact` (`engine/combat.asm:358`, corrected this round — review 3, finding 6/8; every
prior round cited `entities.asm`, which does not have it) checks a live actor slot via
`entity_touching_player`**, not a terrain record at all — confirming round 2's own "peek and
restore" primitive, built for reading *terrain*, answers a completely different question than
"is there a live, interactive actor here." Under the current-screen-only entity policy, a
neighbouring screen's own actors are **not in the live array at all**, so no terrain-level peek can
ever populate them — contact, hazards and scripted `Move` all need their own, separate answer to
"what happens when the interaction target is a screen the player doesn't currently own," which this
design does not yet have. **An entity's own `ent_x` wrapping at 256 changes nothing about which
screen owns it, or a script's own identity for it** — round 2's "a Move simply can finish" glossed
over the fact that no representation exists at all for an actor whose *authored* position is on one
screen while gameplay has walked it past that screen's own edge under a streamed camera.

**The two-axis-per-frame claim is retracted.** `engine/player.asm:44-45`, confirmed by direct
reading: `update_player` **exits before the second axis** the moment the first crossing sets
`screen_fresh` — today's engine does not, in fact, cross both axes independently in one frame, the
opposite of what round 2 asserted while promising to preserve this "existing" behaviour. This
document must now **either** explicitly defer the second axis on an ownership-changing crossing (an
engineering decision, consistent with today's own behaviour) **or** deliberately change the
event-order rule and say so — not silently promise a two-axis interaction the current engine
provably does not have. **Recommendation: defer** — keep today's own single-axis-per-frame exit
rule unchanged for a streamed map's own crossings, since inventing simultaneous two-axis crossings
is new scope this round does not need to open.

**The consumer audit, this round's own new work — the exact formula a boundary probe must work
around, and the restore mechanism it now has:**

- **`probe_type`'s own index formula, read in full this round** (`engine/player.asm:230-252`):
  `Y = (probe_y & $F0) + (probe_x >> 4)`, then `[mtptr_lo],y` against the **current screen's own**
  240-metatile array (through `bound_tile_lookup` when `BOUND_TILE_ENABLED`, R16). Both halves of
  this index are **purely local to whichever screen `mtptr` currently addresses** — there is no
  screen identity encoded in the index at all, only a position within one screen's own 16×15 grid.
  A probe whose `probe_x`/`probe_y` has walked past that screen's own edge (0-255 either wrapping
  silently, per `combat.asm`'s own 8-bit add, or genuinely exceeding the screen's own 240/224-pixel
  extent) computes a Y that still looks like a valid index — `(probe_y & $F0)` masks to a
  same-screen row regardless of how far `probe_y` overshot — and reads whatever metatile happens to
  sit at that recycled index in the **wrong** screen's own data, silently, with no error and no
  crash. This is the concrete shape "the carry is lost" takes at the point of use, not just at the
  add.
- **Decision 1, restored (review 3, finding 6) — a streamed crossing is CONTINUOUS at the natural
  pixel origin (256/240), not the discontinuous `MAX_X`/`MAX_Y` atomic landing fix round 3 wrongly
  recommended keeping.** Quoted, so it cannot be silently reversed again: *"A streamed crossing is
  continuous at the natural origin (256/240) with overshoot preserved — not the `MAX_X`/`MAX_Y`
  (240/224) atomic landings §4 now recommends."* Today's own `MAX_X=240`/`MAX_Y=224`
  (`constants.asm:1363-1364`) landings are correct and unchanged for the **ordinary, non-streamed**
  engine — `cross_left`/`cross_right`/`cross_up`/`cross_down` (`engine/player.asm:282-...`) snap the
  player to the far edge of the *new* screen because an ordinary screen change is a hard cut with no
  continuous camera to preserve motion across. A **streamed** map has no such cut: the camera tracks
  the player continuously, so a crossing that snapped to a fixed far edge would visibly teleport the
  player by up to 16 px in one frame relative to the camera's own smooth motion (moving right from
  world x=240 to a neighbour's x=0 changes world position by 16 px under the atomic model, versus
  the player's own actual per-frame speed of 2-4 px under every other frame of movement) — exactly
  the discontinuity finding 6 caught. **The streamed crossing must instead preserve the player's own
  overshoot past 256 (or 240)**: crossing right at world x=256+n continues at the neighbour's own
  local x=n, not local x=0; `MAX_X`/`MAX_Y` are the ordinary-engine's own constants and are not
  reused for this path. This is a real, additional streamed-specific branch in
  `cross_left`/`right`/`up`/`down` (or a streamed-map-only sibling of them) that this round names
  but does not build — the byte-level implementation is reasoned, not coded, this round. **The
  straddling problem this creates**: a probe cast up to 12 pixels ahead of the player's own position
  (`player_hazard`'s own `+8`/`+12`) can legitimately reach past the current screen's own edge
  *before or during* a continuous crossing, needing an answer from a screen that is not yet, and may
  never become, the current one — narrower than "the player's position is ambiguous" (it never is,
  by construction — the player's own owning screen is decided by which side of the boundary its own
  origin sits on, even mid-crossing), but real.
- **The restore mechanism this design now has, that it did not before**: `sw_peek_byte` (§3/§5, R5)
  is exactly the "read one byte of a neighbour screen, then restore the caller's own current screen"
  primitive this straddling problem needs — proven correct, not merely proposed, and the *right*
  choice here specifically because a collision probe genuinely is field/mainline code (unlike a
  banked caller, which would need `sw_read_transaction` instead, §3/finding 3). A boundary-probe
  design built on it would: (1) compute `probe_x`/`probe_y` with a **wide (16-bit, or a signed
  8-bit-plus-carry pair) intermediate** before any truncation, so "still this screen" vs. "past its
  edge, by how much, in which direction" is a real, decidable fact rather than a wrapped 8-bit
  value; (2) on "past the edge," resolve which **neighbour screen** (via `screen_left`/`right`/`up`/
  `down`, the same tables `cross_*` already reads) and the **local** coordinate within it (the
  overshoot, mod the screen's own 16/15-metatile extent); (3) call `sw_peek_byte` with that
  neighbour's own `(screenCol, screenRow)` and the local index `probe_type` would compute *for that
  screen*; (4) use the returned byte exactly as `probe_type`'s own `[mtptr_lo],y` result is used
  today (`mt_collision,y` for a solid test, or the raw metatile id for anything else). **Still
  design, not code**: no engine file was edited to add this; `sw_peek_byte` itself lives only in the
  §5 Appendix A prototype. The per-axis asymmetry review 2 already named stands: horizontal overshoot
  wraps a *column* into the neighbour (a 16-wide unit), vertical overshoot wraps a *row* (15-tall) —
  the two neighbour lookups and the two local-index formulas are mirror images of each other, never
  one shared routine parameterised by axis, since `probe_type`'s own index formula itself treats X
  and Y asymmetrically (`>>4` vs `&$F0`) for the same reason a screen is 16 wide and 15 tall.
**Superseded below, not merely re-costed — kept here only as a pointer to avoid two competing
current claims (review 5, finding 12): the ~292-cycle bank/cache-restore figure and the "actor
ownership/contact/script semantics... still an open design gap" claim were both real once, and are
both replaced in full by finding 5's own real, chosen policy and real, re-measured costs directly
below** (`sw_peek_byte` at 219-261 cycles depending on coordinate, not a flat ~292; the actor policy
a real, chosen clamp-to-owning-screen rule, not an open gap).

**Finding 5, closed this round: the per-direction/corner algorithms, the map-edge wall, exact
ownership/cache timing, and real probe costs from finding 2's own measurement.**

**Per-direction algorithm, one shape, mirrored across four call sites** (`probe_right`/`left`/`up`/
`down`, each a sibling of `cross_right`/`left`/`up`/`down` rather than one axis-parameterised
routine — `probe_type`'s own asymmetric `>>4`/`&$F0` index formula, above, already rules out sharing
one body):

1. Compute the probe's own **wide, signed** target position: `wide_x = player_x_16 + dx`,
   `wide_y = player_y_16 + dy` (16-bit throughout, `dx`/`dy` the existing `+8`/`+12` probe offsets,
   signed for the leftward/upward probes) — never the existing 8-bit add, which loses the carry
   before any caller could see it (the concrete bug this whole finding traces back to).
2. **Same-screen fast path**: if `0 <= wide_x < 256` and `0 <= wide_y < 240` (the screen's own
   pixel extent), the probe is on the current screen — use `probe_type`'s own existing formula and
   `mtptr` unchanged; this is the overwhelmingly common case (every probe that is not within 12
   pixels of a screen's own edge) and costs nothing new.
3. **Cross-screen path**: otherwise, resolve the neighbour screen via the identical
   `sw_cross_right`/`left`/`up`/`down` computation the crossing routines already use (screenCol/Row
   ±1, clamped — the map-edge wall below), compute the **local** coordinate within it
   (`wide_x mod 256`/`wide_y mod 240`, i.e. the overshoot), and call **`sw_peek_byte`**, corrected
   this round (review 5, finding 4) — **not** `sw_read_transaction`, this document's own earlier,
   wrong choice: `sw_read_transaction` restores only the PRG bank, not `mtptr` (proven,
   `proto-tools/diag_r5_probe_restore.mjs` — reproducing the reviewer's own exact observation,
   `mtptr` moving from `$8000` to `$A152` across the probe and staying there), which is exactly
   wrong for a caller that IS field/mainline code and expects to keep dereferencing `mtptr` directly
   afterward (the "same-screen fast path," step 2). `sw_peek_byte` restores **both** the bank and
   `mtptr` (via `sw_locate_current`, which the general-purpose `sw_read_transaction` deliberately
   does not call, since a genuinely banked caller has no `mtptr` of its own to restore) — the same
   script proves a cross-screen `sw_peek_byte` probe followed immediately by a same-screen one reads
   the correct byte both times, with `mtptr` correctly restored after each. **The "pure peek"
   contract holds for `sw_peek_byte`, and only for it** — the earlier claim that
   `sw_read_transaction` was interchangeable here was the actual defect, not a documentation gap.
4. **Corner probes** (a diagonal movement check needing the metatile at both `dx` and `dy` applied
   together) resolve X and Y independently through steps 2-3 above, then combine — a corner never
   needs a third, diagonal-specific neighbour lookup, since the two axis-resolved screens (which may
   be the same screen, an adjacent one, or, at a true corner, a diagonal neighbour reached by
   resolving X's own crossing and then Y's own crossing against the result) already cover it.

**The map-edge wall**: a probe whose resolved neighbour would fall outside the map's own authored
grid (`screenCol < 0`, `screenCol >= gridW`, and the row equivalents) is **solid, unconditionally**
— the identical rule Chris's decision 3 (§10, below) states for terrain padding, applied here to
collision rather than terrain reads. This is a **non-mutating** answer (`solid: true`, no bank
switch, no `sw_goto` call at all) — resolving "is this off the map" must happen **before** any
`sw_read_transaction` call, not as a fallback after a failed read, since there is no real screen to
read at an out-of-grid coordinate at all.

**Ownership/cache publication timing**: a cross-screen probe's own `sw_peek_byte` call **never**
changes which screen `mtptr`/`sw_col_byte_lo/hi`/etc. call "current" — proven, not merely asserted,
this round (above) — so the probe result feeds directly into the caller's own existing branch
(`mt_collision,y` for solidity, the raw id for anything else) with **no** cache invalidation, no
`rebuild_bound_cache` re-run, and no `screen_fresh` interaction at all — ownership only changes on
an actual crossing (`sw_cross_*`, decision 1's continuous model), never on a probe that merely
*looks* at a neighbour.

**Actor crossing/contact/scripted-Move identity at a boundary, a real chosen policy this round
(review 5, finding 4) — not "unbuilt, disclosed work," which was itself the error**: a non-player
actor (an NPC, a monster, anything driven by a scripted `Move` or patrol AI) is **clamped to its own
owning screen's edge — it can never cross a screen boundary at all**, the identical wall rule the
map-edge collision already applies to the player at an unauthored map edge, applied here per-screen
to every other actor. A `Move` or ordinary AI step that would carry a non-player actor's origin past
its screen's own edge stops at the edge instead (the same "a move that cannot finish must end, not
hang" rule this engine's own `Move` command already uses for a wall, CLAUDE.md's own event-system
section) — never reassigned to a neighbour's array, never deleted, never duplicated.

**The numeric clamp, chosen this round (fix round 8, finding 8) — MAX_X/MAX_Y containment, not bare
origin clamping.** "Stops at the edge" needs one further number: does a non-player actor's own
ORIGIN clamp to `[0, 255]`/`[0, 239]` (the raw screen extent, letting its own 16×16 box extend past
the edge into the neighbour's own drawn space) or to `[0, MAX_X]`/`[0, MAX_Y]` (`240`/`224` —
`256 − 16`/`240 − 16`, the engine's own existing containment bound, `constants.asm:1363-1364`,
already how the player's own map-edge wall works)? **Chosen: `MAX_X`/`MAX_Y` containment, matching
the player's own existing wall exactly** — the text above already cites that rule as the model; this
is simply naming the number it actually uses rather than leaving "the edge" ambiguous between two
real candidates. A non-player actor's own sprite therefore never straddles a screen boundary at
all — its whole 16×16 box stays strictly on its own screen, visually and for collision alike, the
same guarantee the player's own edge-of-map wall already gives. Failed-Move and patrol AI share this
identical bound: an AI step that would carry the actor's own origin past `MAX_X`/`MAX_Y` on its
owning screen clamps to it, exactly as a scripted `Move` does, with no separate patrol-specific rule
needed. This closes
every question review 5 raised at once, because none of them can arise: **storage/capacity** are
unchanged (an actor never leaves the fixed-size live array its own screen already provides);
**lifetime** is unchanged (an actor's live state is exactly as ephemeral as it is today — discarded
and re-spawned fresh from the screen's own authored placement list on re-entry, the existing
`spawn_entities` behaviour, untouched by streaming); **duplicate spawn on revisit** cannot happen
(nothing about a clamped actor's own re-entry differs from today's ordinary screen re-entry);
**stable identity** is unchanged ("slot N of the currently active screen's own live array," exactly
today's meaning, since no actor ever changes which screen owns it). **The player is the one actor
this rule does not apply to** — decision 1's continuous crossing is specifically the player's own
mechanism, and the player has no "live array slot" to begin with.

**The disclosed gap this policy still leaves, honestly — corrected this round (fix round 11, review
8 finding 8): the previous screen's actors do not stay drawn, they disappear.** A non-player actor
sitting at its own screen's own edge, and a player who has just continuously crossed into the
neighbouring screen, can be close enough on real, physical torus pixels to look like they should
still touch — but `entity_contact`'s own live-array check only ever sees the **current** screen's own
actors, and the current-screen-only array (this section's own chosen policy, above) holds nothing for
the screen just departed: **that actor is gone from the live array the instant the crossing commits,
so it is neither drawn nor contactable, full stop** — review 8's own finding that the prior text's
"the actor is still drawn" claim contradicts the very policy this section chose. This is **not a new
defect streaming introduces**: it is the identical "absent, not inert" trade-off §10's own
decision-adjacent open question 3 already discloses to Chris, and today's ordinary (non-streamed)
engine already accepts the same shape of loss in a blunter form (a hard screen cut discards the
previous screen's actors outright, and touching them the instant after a cut is equally impossible).
Streaming does not make the actor linger on screen a moment longer than a cut would — it only makes
the *player's own continuous, uninterrupted view* make the disappearance more noticeable, since
nothing else about the transition (a scroll, not a blank) signals "the screen changed" the way a cut
does. No new mechanism is proposed to close it this round; it is named here as the accepted cost of
the current-screen-only entity policy already carried forward from phase 2's own scope.

**Representative and worst-case per-frame probe costs — CORRECTED AGAIN this round (fix round 8,
finding 8): the 219/261 figures belong to `sw_read_transaction`, not `sw_peek_byte`, and this round
re-measured the routine the text actually names, directly, rather than repeating the earlier
mislabelled pair a third time.** Same-screen (step 2) is unchanged, no new cost. A cross-screen
probe (step 3) costs one `sw_peek_byte` call — measured fresh this round, from a field screen at
(0,0): **274 cycles at a nearby coordinate** (target col=0,row=0 — matches review 6's own
independent 273-cycle measurement to within the stub's own ~1-cycle counting convention), **317
cycles at a one-row-and-one-column-boundary coordinate** (target col=1,row=1 — exact match to
review 6's own figure). `sw_read_transaction`'s own 219/261 pair (the earlier text's real source,
misattributed) remains correct for ITS OWN routine, used by a genuinely banked caller restoring its
own PRG bank rather than the field's current screen (§3, finding 3, this round) — the two routines
cost differently because `sw_read_transaction` restores via a caller-supplied bank number
(`sw_caller_bank`) while `sw_peek_byte` additionally calls `sw_locate_current`'s own O(1) hot-path
recompute, a real, disclosed cost difference, not an error either figure needs correcting for.
**The worst case is not `(254,254)`, and — corrected AGAIN this round (fix round 8, finding 8) — is
not `(0,254)` either.** A 255-screen total (R12's own ceiling, ids 0-254) cannot contain a 255×255
rectangle (65,025 screens), which fix round 7 already caught; but a 1-column × 255-row map ALSO
cannot exist on any real board, for a DIFFERENT reason finding 8 named this round: `STREAM_SCREENS_
PER_REGION=24` and a 1-column map needs exactly `gridH` regions (`ceil(1/24)=1` per row) — 255
regions — while the largest real board (UNROM 512, minimal tileset, no other reservations) has only
**61 screen regions total** (measured, `screenRegions(mapperById(30), 1, 0, {})`.length), MMC3 has
30, MMC1 has 14. A 255-row map fails the aggregate capacity check (finding 4/5, above) long before
the 255-screen id ceiling would ever refuse it — an author-unreachable shape, not a real worst case.
**The real, achievable worst case is bounded by the board's own real region count**: at
`(col=0,row=60)` — the true `screenRegions(mapperById(30), 1, 0, {}).length === 61` ceiling on
UNROM 512, **confirmed final by fix round 10, not merely hoped for**: the streaming mechanism's own
banked-strip-fetch primitive fits directly in kernel-lo once the resident set moved to kernel-hi
(§5, Round 10, above), so the extra switchable code-region reservation this paragraph used to hedge
against ("even after reserving room for other content") is **dropped, not merely assumed away** —
there is no other content competing for a region on this board, so 61 is the real ceiling, not a
best case. **Corrected this round (fix round 11, review 8 finding 8): the collision-probe cost is
`sw_peek_byte`'s own full transaction, not `sw_goto`'s bare cost.** A collision probe never calls
`sw_goto` directly (§4/§10 above, decision 3's own contract) — it calls `sw_peek_byte`
(`jsr sw_goto` + one byte read + `jsr sw_locate_current` to restore the caller's own current screen),
and the two routines cost differently by design (`sw_peek_byte`'s own header comment says so). Direct
measurement at the identical `(col=0,row=60)` shape (`proto-tools/diag_f11_row60_peek.mjs`, this
round): `sw_goto` alone reproduces the already-cited **1,288 cycles** exactly (a cross-check, not a
new number); `sw_peek_byte`'s own real, full cost at the same shape is **1,412 cycles** — 124 cycles
more, the byte read plus `sw_locate_current`'s own O(1) restore, a real, disclosed, previously
uncounted cost, not an error in the 1,288 figure itself (which was always a correct measurement of
`sw_goto` alone, just the wrong routine to cite for "a full probe"). **Budgeted against the whole
frame, not isolated locator costs alone**: a frame's own 29,780-cycle NTSC budget already carries
`music_tick`, `read_pad`, the one-block streaming write (decision A's own budget, §10), and whatever
the frozen/gameplay dispatch is doing — a corner check (four probes, two axes resolved independently
on both sides) at the *representative* cost (four × 317 ≈ 1,268 cycles, `sw_peek_byte`'s own
re-measured boundary-coordinate figure above) is a small fraction of the frame; at the *real*
worst-case row-60 cost (four × 1,412 = **5,648 cycles**, not the previously-cited 5,152) it is a real
but bounded fraction (**19.0%**, not the previously-cited ~17%) of the frame's own budget — still not
the "nearly two-thirds" the retracted row-254 figure implied, a materially less alarming, and now
correctly costed, number.

### R9 — projection: rebuilt this round, the double-centring and negative-edge bugs fixed and proven

**Review 5 reproduced two real defects in the fix-5 prototype — both fixed this round, with a
genuinely independent test suite, not a fourth repetition of the arithmetic problem statement.**

**Bug 1, double-centring, fixed by choosing the contract once.** The routine took a "centring
constant" argument and added it to `world − cam` — but `cam` was *also* documented as
`player − centring`, so the composition was `world − (player − centring) + centring = world −
player + 2×centring`, wrong by a full extra centring constant (reproduced: world 1000, camera 880,
X returned 240, not the intended 120). **Fixed by removing the second addition entirely**: the
routine's second argument is now the camera's own **world-space origin** — the world position
already sitting at screen column/row 0 — and the routine computes exactly `world − origin`, once,
with no separate constant. Deriving that origin from the player (`origin = player − centring`, the
120/112 constants, confirmed correct) is a **separate**, once-per-frame computation feeding the
camera register (below), not this routine's own job — so `sw_project_axis` itself no longer takes a
centring constant at all, and no longer needs the scratch byte (`sw_tmp5`) it used to hold one in.

**Bug 2, the negative-edge hardware error, fixed by removing the false "partial-left" case
entirely.** OAM X/Y are **unsigned** bytes with no representation for a negative screen position —
a tile at screen X=−7 truncates to 249, which the PPU draws at the **right** edge of the screen, not
as a sliver peeking in from the left (reproduced: −7 returned OAM X 249 with carry clear, i.e.
"visible" — visible at the wrong edge). There is no free hardware trick for the left/top edge the
way there is for the right/bottom (a sprite at X=248-255 or Y=232-239 genuinely does show a partial
tile, clipped for free, since those are real, in-range byte values whose only "overflow" is past the
edge of the *drawn* frame, not past the representable range at all) — so the chosen rule, per
review 5's own "skip unrepresentable negative tiles" option: **any negative delta hides,
unconditionally, no partial-left/top-edge case.** This also **simplifies** the routine to one test
instead of two: a tile is visible iff `0 <= delta < visibleWidth` (256 for X, the real 240 for Y,
passed by the caller — the Y-axis threshold simplification review 5 also caught, fixed by making it
a real argument rather than a hardcoded 255); the routine no longer special-cases the negative side
at all, since any negative delta already fails `delta_hi == 0`.

**The chosen representation, corrected**: world position and camera **origin** are each an
**unsigned 16-bit pair** (lo/hi bytes) — not signed, since a legal 255-screen-wide world can reach
world x=65,279, which no signed 16-bit value can hold (max +32,767). This does **not** change the
subtraction itself: 6502 `SBC` is representation-agnostic two's-complement arithmetic, identical
whether the operands are "meant" as signed or unsigned, so the existing subtract-and-classify code
needs no change for this — only the documentation needed correcting, since any camera-to-tile
distance this design ever asks about is small, and the result's own high byte reliably reads `$00`
(near, non-negative) or a small negative pattern whenever the tile is genuinely close, and something
else whenever it is far away, regardless of how the underlying 65,536-wide modulus wrapped to get
there. `sw_project_axis` (below) takes one axis at a time — X and Y never share scratch, since a
caller projecting an entity's full position calls it twice, once per axis, with a different
`visibleWidth`.

**`sw_project_axis`, rebuilt, costed, and proven against genuinely independent cases.** `A =
visibleWidth` (0 meaning 256 for X — the byte truncates — or the real 240 for Y, on entry); 16-bit
world position and 16-bit camera *origin* in scratch; computes `delta = world − origin` as one
16-bit subtract (no add, no multiply); visible iff `delta_hi == 0 AND delta_lo < visibleWidth` (or,
for X's `visibleWidth=0` case, `delta_hi == 0` alone, since every 0-255 low byte is then in range) —
carry clear means visible, and the truncated byte is the OAM value as-is; carry set means hidden,
returning the truncated byte anyway for a caller that wants it for other math. Measured
(`proto-tools/diag_r5_projection.mjs`, 14 cases, **every expected value hand-reasoned and written
as a plain number in the case's own label — never computed by a shared function the test also
calls**, closing review 5's own "the oracle repeats the arithmetic" complaint): the camera-origin
case, the centred case, the exact ±1-pixel visible/hidden boundary at both the left edge (no
partial-tile case, per the bug-2 fix) and the right edge (255 visible, 256 hidden, hardware clipping
free), two "far away" cases, a near-the-top-of-the-16-bit-range case (confirming the unsigned-world
contract), and a same-shape set for Y with its own 240-line threshold (239 visible, 240 hidden, even
though 240 fits trivially in a byte) — **all 14 pass**, at **51-67 cycles per call**, actually
*cheaper* than the buggy version (79-91) since the fix removed code rather than adding it.

**OAM Y's one-scanline-early convention, assigned to the caller, not this routine.** `sw_project_axis`
answers "is this logical row visible," not "what raw byte does `$2004` need" — a Y-axis caller
subtracts 1 from the returned byte before writing OAM (the standard NES quirk: sprite evaluation
reads Y one scanline ahead of where the sprite visually appears), documented at the call site, not
hardcoded into the shared routine both axes call. The one edge case this produces — a tile at
logical row 0 needs OAM Y `0 − 1`, wrapping to 255 — is named, not silently glossed over: 255 is
also this engine's own "hide" sentinel, so a sprite legitimately meant to start at the very first
visible scanline is indistinguishable, in the OAM byte alone, from a hidden one. Real NES engines
generally accept this (a sprite's own top edge is rarely required to land on scanline 0 exactly);
this design accepts the identical, standard trade-off rather than inventing a special case for it.

**Attached effects** project through the identical routine at the effect's own world position (the
entity's position plus its own authored offset) — no new mechanism, since an effect is just another
world-space point to project.

**Persistent camera storage, named**: the camera's own world-space origin (two unsigned 16-bit pairs,
X and Y — 4 bytes) needs real, assigned RAM, which did not exist before this round and still does
not have an address — folded into finding 9/§9's own complete RAM map, below, alongside the
movement-schedule and dialogue-save state finding 1/finding 8 also need.

**Converting between window-relative and camera-relative positions** still needs the physical ring
origin explicitly (`sw_rw_wbase_col`/`sw_rw_wbase_row`, §3) and the nametable-select bits — an
actor's OAM position is never simply its local pixel position, since the camera can be anywhere
within the resident torus; this composition (ring origin, camera position, and `sw_project_axis`
together) is not wired into a single call chain this round, only each piece proven separately.

**Neighbouring NPCs are absent, not "inert terrain"**: the screen records and full redraw hold
*terrain ids*, never entity sprites, so an actor on a screen the player does not currently own is
simply not drawn, full stop, not drawn-but-inert.

**The camera citation**: `engine/camera.asm:1-18` implements a *screen-edge slide* (item 12's own
mechanism, triggered only at a screen boundary), not a continuously player-centred camera — §10's
own camera-centring question is written against this fact.

### R10 — frame ownership, the actual rule

**Round 2's own "every camera-moving frame belongs to a transition" is wrong, confirmed by
reasoning through its own consequence**: a continuously-tracking streamed camera moves on *every*
ordinary walking frame — applying the "transition" rule literally would suppress hazards and
encounters on every single frame of normal play, which is clearly not the intent. **The corrected
rule**: `screen_fresh` means "a newly established context gets its own entry/settle turn" — an
*ownership-changing* crossing sets it (a real context change), while a same-screen resync (battle
return, a flash-save resync, the teleport guard) sets it **or does not**, by an explicit,
per-transition rule, not a blanket "every redraw is a transition." Round 2's own claim that "battle
return and an ownership change trigger the identical rule" is false: battle return can need
freshness (to re-settle the field's own owed work) **without** any ownership change having occurred
at all — the two are independent facts, not the same trigger under two names.

**A concrete pause predicate (finding 11)**: `sw_nmi_stream` must not write while the world is
frozen — the exact gate `main_loop`'s own `settle_owed`/world-update dispatch already uses,
`paused OR game_state != 0` (`game_state` nonzero covers both `ST_MENU` and `ST_DIALOG` as the
*single* existing byte the engine already checks for "is the world frozen," not two separate
checks) — added to `sw_nmi_stream`'s own early-out alongside its existing `st_active` check, not
instead of it.

**Pre-bank-switch cancellation before `call_battle`, corrected this round (review 3, finding 11)**:
fix round 3's own reasoning here was wrong. `call_battle` (`engine/banks.asm:410-416`) switches the
PRG bank the *field data* occupies to the RPG battle region — but `sw_nmi_stream`'s own hot path
reads `mt_tl`/`mt_tr`/`mt_bl`/`mt_br`/`mt_pal` from the **fixed, permanently-mapped kernel-lo bank**
(§0's own second structural fact), never the switched data bank, so an in-flight chunk running
during battle would **not** "run with no field data mapped in" — it would run *successfully*, and
keep writing nametable content, **corrupting whatever `battle_draw_sprites`/the battle screen's own
drawing is doing to the same VRAM** at the same time. **The real reason to cancel the strip before
`call_battle` is to protect battle's own VRAM writes, not because the chunk would fail or read the
wrong bank.**

- **The streamed redraw dispatch `battle_end`/`redraw_screen` needs** (`engine/rpg.asm:153-176`,
  confirmed `battle_end` uses the ordinary `redraw_screen` path): a streamed map's own return from
  battle needs its own dispatch (a `sw_render_window` resync), not the plain non-streamed
  `redraw_screen` every other return path uses today.

**The transition table, restored (decision 6, review 3 finding 11) — fix round 3 silently dropped
fix round 1's own version instead of correcting it; restored here with this round's own
corrections folded in**:

| Transition | Active strip | `screen_fresh` | Spawn/entry event | Overlay | Camera publication |
|---|---|---|---|---|---|
| Ordinary crossing (continuous, decision 1) | Continues uninterrupted — the entering edge is exactly what the strip mechanism exists for | Set (ownership changed) | `spawn_entities`/entry event armed for the newly-owned screen | None | Continuous, unaffected |
| Same-map warp/door | Cancelled, reinitialised via the one warp handshake (§6) | Set | Armed (a warp is always a fresh context) | None | Reset to the target's own resolved window origin |
| Battle entry | **Cancelled before `call_battle`** — protects battle's own VRAM, per the correction above | N/A (world frozen) | N/A | Battle screen | Frozen (streaming paused, not merely uncommitted) |
| Battle return | Not resumed automatically — `battle_end` needs its own `sw_render_window` resync dispatch (above) | **Set** — re-settles the field's own owed work, independent of ownership (round 2's own false equivalence, corrected) | **Spawn/restoration**: `spawn_entities` re-runs exactly as `battle_end`'s own existing redraw already triggers it, restoring the field's own actors — unchanged, real, needed lifecycle, distinct from the row below (review 4, finding 12: the two were wrongly collapsed into one "Suppressed" cell). **Entry event**: suppressed — `battle_end` redraws the field it never left, so the redraw must not re-arm the *entry* event a fresh arrival would trigger | Field, restored | Resynced fresh at the resume point |
| Menu open | Paused (the concrete predicate above) | Unaffected | N/A | Menu, over the frozen field | Frozen while open |
| Dialogue open | Paused (same predicate), **plus the snap/redraw open transaction** (decision 2, §10 — superseding R13's own earlier v1 restriction) | Unaffected on the field; the open/close transaction itself sets/clears freshness around a same-screen resync, not an ownership change | N/A | Message box, via the snap-to-current-screen NT0 draw (decision 2) | Snapped to the player's own screen at open (≈7 frames), restored to the torus at close (≈28 frames) |
| Flash save | Cancelled, resync runs **inside** the render-disabled save transaction (§5/R11), before `enable_rendering` | Not applicable to the resync itself | Not respawned/armed — a resync is not a screen crossing | Whatever overlay was on screen, restored | Resynced before rendering resumes |
| Continue | Cancelled (nothing was active before load) | Set (a fresh session context) | Armed | None | Reset via the same one-initialiser resolution as a warp (§5/R12) |
| ▶ Test | Cancelled | Set | Armed | None | Reset via the identical warp handshake (§6, decision 4) |
| Game over | Cancelled | N/A (`init_session` resets everything) | N/A | Game-over screen | Reset at the next session's own start |
| Teleport resync (the lag guard, §3/R3 option 3) | Cancelled, replaced by a full `sw_render_window` | Not set — this is a same-screen resync, no ownership change | Not armed | Whatever was on screen | Resynced to the corrected window origin |

**A short `cam_dirty` publication contract, restored (decision 6, fix round 1's own mechanism)**: a
transaction that changes more than one camera-register field atomically (a resync, a cross that
moves both the window origin and the physical ring state) sets `cam_dirty` before touching any of
them and clears it after the last one, so the NMI's own per-frame register publication (item 12's
existing mechanism) never applies a half-written combination — the identical shape item 12's own
`redraw_screen_slide` already uses for its own multi-field publication, extended here to streamed
transitions rather than invented fresh.

**Reconciled with R8's own two-axis rule**: since the second axis is now deferred on an
ownership-changing crossing (R8's own recommendation), `screen_fresh`'s own "context settling" rule
and `update_player`'s own single-axis-exit behaviour agree by construction — neither needs to know
about the other's own internals, since deferring the second axis *is* what "settle before the world
runs further this frame" already means.

**Finding 12's own second lifecycle gap, closed as a specification: `rebuild_bound_cache` is not
made inert by the bound-tile authoring restriction alone.** §5/R16 restricts a streamed map's own
screens from *placing* a bound-tile binding — but `rebuild_bound_cache` (`engine/screens.asm:
303-336`) reads `screen_bound_lo/hi` **by `flat_screen`, unconditionally**, for whichever screen is
current, and those columns are exactly the ones finding 3's own mixed-lookup contract (§5) removes
for a streamed screen (a streamed screen has no `screen_bound_lo/hi` entry at all, since it pays no
per-screen kernel-lo pointer columns). Authoring zero bindings on a streamed screen does not change
what `rebuild_bound_cache` itself *reads* — a real accessor must exist, or the routine reads
whatever byte finding 3's own compacted ordinary-screen columns happen to hold at a stale or
out-of-range index once a streamed screen's own `flat_screen` no longer maps into that table at
all. **The fix, specified**: `rebuild_bound_cache` and every later rebuild path (any future site
reading `screen_bound_lo/hi` by `flat_screen`) must branch on the map-type bit (§5, finding 3)
first — an ordinary screen resolves its compacted index and reads the columns exactly as today; a
streamed screen takes a **zero-record accessor** (`bind_count = 0`, no `screen_bound_lo/hi` read at
all) rather than attempting to index a table that was never sized for it. This is the identical
"restriction plus one entry-time clear" shape R16 already established for `bind_count`/
`flip_pending_count` on *entry* to a streamed map, extended to cover a rebuild that runs **while**
already on one (a later bound-tile-adjacent event on an ordinary screen elsewhere in a mixed
project must not leave `rebuild_bound_cache` pointed at a table index that has since been
repurposed). Not built this round — a specification, per finding 3's own lookup contract, not new
engine code — but the earlier text's claim that the authoring restriction alone "makes
`rebuild_bound_cache` inert" is retracted as stated.

## 5. Q1/Q5/Q6/Q7 — the record, capacity, RAM, gating, and placement

### R6 — the 338-byte record, uncapped, ported and retested

**Finished, not merely re-costed.** Per-screen: 240 terrain bytes + 98 metadata bytes — 1 entity
count + 8×9 entity records (72) + 1 bound-tile count + 8×3 bindings (24) = 98, the **full**
`MAX_ENTITIES=8`/`BOUND_CAP=8` worst case, **no artificial per-screen cap** (R6's own explicit
demand: compare honestly against a capped design before recommending one — the honest comparison is
that PRG space is cheap enough that the uncapped worst-case record is the simpler, equally-
affordable choice; a capped record would only save PRG bytes, a resource this design is not short
of, at the cost of a real authoring restriction). **`STREAM_SCREENS_PER_REGION = 24`**
(`floor(8176/338)`), replacing round 2's own 256-byte/31-per-region prototype.

**Ported, not merely redefined**: `sw_goto`, `sw_locate_current`, `sw_cross_right/left`, and both
fixture builders now use the new stride. Since 338 is not page-aligned, the round-2 "OR the column
remainder into `mtptr_hi`" trick is gone (confirmed removed) — replaced by a genuine 16-bit byte
offset (`sw_col_byte_lo/hi`), **maintained incrementally** (±338 per crossing, a 16-bit add/subtract,
never a multiply on the hot path) so `sw_locate_current`'s own O(1) cost is unchanged in shape. Only
`sw_goto`'s own cold, arbitrary-column path multiplies at all, via a bounded (≤23-iteration)
repeated-add loop.

**The 23→24 region boundary retested, both directions, both parities** (T5, §3): crossing left
across the boundary (`col_rem` wraps 0→23, `col_region` decrements) and back right (wraps 23→0,
`col_region` increments) both land on exactly the expected `sw_col`/`sw_col_rem`/`sw_col_region`/
16-bit byte-offset state — confirmed by direct comparison against hand-computed expected values, not
merely "looks plausible."

**Retained as the old prototype, explicitly labelled**: nothing at the 256-byte stride survives in
the current file — round 2's own 256-byte record and its 31-per-region packing are superseded, not
left alongside the new one under any name.

### Finding 5 — the emitted data contract: two record formats, not one shared record

**Retracted this round**: "ordinary and streamed screens share the 338-byte record" was never true
and review 3 caught it directly — `main/build/generate.js:2066-2076`'s own existing screen emission
is **304 bytes of terrain/attribute data plus variable metadata** (the count-prefixed entity/bound
lists this document's own R6 already describes for the *streamed* record, but at their existing,
uncapped variable length, not a fixed 98-byte worst case). **Two distinct emitted formats,
explicitly, one per map type**:

- **Ordinary (non-streamed) screens**: unchanged, byte-for-byte, from today's own `generate.js`
  emission — 304 bytes terrain+attributes plus variable entity/bound metadata, addressed by the
  existing per-screen kernel-lo pointer columns (`screen_map`/`screen_mt_lo/hi`/etc., 13 bytes/
  screen). **ROM-neutral off is non-negotiable** (the ground rule every round has held to): a
  project with no streamed map must assemble identically to today, and this split is exactly what
  makes that possible — the ordinary path is untouched code, not a special case of the new one.
- **Streamed screens**: the 338-byte uncapped record (R6, above), addressed by computed region/byte
  arithmetic (`sw_goto`/`sw_locate_current`), paying **zero** per-screen kernel-lo pointer columns —
  the whole point of Q1's own original recommendation (§1: "0 additional kernel-lo bytes per
  screen"). The generator must emit the *right* format per map — a real, concrete branch in
  `emitScreens` keyed on `map.streamed`, not designed to the exact diff this round, but the shape is
  now unambiguous given the two formats are explicitly distinct.

**Finding 3, closed this round: the full mixed-project lookup contract, not four bytes alone.**
Review 4 found the 4-byte-per-map locator (`sw_base_bank`/`sw_regions_per_row`/`sw_grid_w`/
`sw_grid_h`) real but insufficient — it lets `sw_goto` find a screen **once the map is already
known**, but names no accessor for "which map does global screen id N belong to," no replacement for
the ordinary map's own identity/metadata fields (`map_base`, `map_song`, encounter configuration —
`generate.js:3585-3600`), and no rule for how the *ordinary* maps' own existing per-screen columns
compact once some maps stop needing them. Specified in full:

**Rebuilt this round (review 5, finding 6): global ids preserved in real project order, and
`map_base` reused rather than duplicated.** Review 5 found the fix-5 pseudocode assigned every
ordinary map's ids *before* every streamed map's own, regardless of authored order — for
`[streamed A: 2 screens, ordinary B: 1 screen]`, it gave `A=1-2, B=0` when the correct, order-
preserving ids are `A=0-1, B=2` — and separately, that the proposed new `streamed_base_id` field
duplicated something that **already exists**: `flattenScreens` (`generate.js:2004-2020`) computes
`mapBase` by walking `project.maps` **in real project order**, pushing the running screen count
(`flat.length`) *before* each map's own screens are added — exactly "the first global id this map
owns," already emitted today as `map_base` (one of the ordinary map's own existing 9 identity
bytes). A streamed map needs no *second*, duplicate base-id field: the identical `map_base` byte,
computed the identical way (the running count advances by `gridW*gridH` instead of
`screens.length`, since a streamed map's own screens are not individually pushed into `flat`),
serves both map types.

**The emitted columns, per map type — CORRECTED this round (fix round 8, finding 4): the 9 identity
bytes do NOT hold tileset, review 6 found, and the table below claiming otherwise was wrong.**
`screen_tileset` (`generate.js:3585-3605`) is an existing **per-SCREEN** column, flattened from each
screen's own `map.tilesetId` at generate time — real, working, and exactly why an *ordinary* map
needs no separate per-map tileset byte of its own (every one of its screens already carries the
answer). A **streamed** map has no per-screen columns at all, by the whole design's own central
point (§1: "0 additional kernel-lo bytes per screen") — so it has nowhere for a tileset id to live
unless one is added at the **map** level, once, explicitly:

| Field | Ordinary map | Streamed map |
|---|---|---|
| Per-screen terrain+metadata | 304 bytes + variable, one pointer set per screen (`screen_map`/`screen_mt_lo/hi`/etc., 13 bytes/screen, `screen_tileset` included) | Computed (`sw_goto`), **0 bytes/screen** |
| `map_base`, `map_song`, encounter config | 9 bytes/map, unchanged, **including `map_base`, reused as-is** | **Identical 9 bytes, identical fields** — `map_base` is computed by the same in-order running-count walk for both map types; not a new field, not a duplicate |
| Tileset | Carried per-screen (`screen_tileset`), **0 additional bytes** — the 9 identity bytes above never held it, for either map type | **1 new byte/map** — every screen of one streamed map shares one tileset (`map.tilesetId`, the existing schema field this design already assumed but never charged the emission for), read once when the engine enters any of that map's screens, not per-screen |
| Fill metatile id | N/A (only a streamed map is padded) | **1 new byte/map** — `fillMetatileId` (§10 decision 3), an ordinary metatile reference on the map's own tileset, validated the same way any other out-of-range id already is |
| Range/locator (`sw_base_bank`/`regions_per_row`/`grid_w`/`grid_h`) | N/A | **4 bytes/map**, unchanged from before |
| **Map-type table (new), representation chosen**: **1 bit/map, packed**, not 1 byte — `ceil(mapCount / 8)` bytes total, a genuinely small, charged table (at `LIMITS.maps`' own ceiling, well under one byte per 8 maps even at the project's own largest legal map count), read once per warp/screen-entry to decide which locator table a given map uses; a full byte/map was considered and rejected here as an 8x waste for a single boolean fact | N/A (one shared project-wide table, not per-map) |

**A streamed map's own real incremental cost over an ordinary one is 6 bytes/map (tileset + fill +
the 4-byte locator), plus `1/8` byte/map (rounding up per byte) for the shared map-type table** —
not 4, not 14, and not the fix-5 formula's own earlier double-counted total. The 9 identity bytes
(`map_base` included) are paid by *every* map, streamed or not, via the single `9 × mapCount` term
below, never added a second time; tileset moves from "carried per-screen, free at the map level" to
"one new per-map byte" only for a streamed map, since that is the one case with no per-screen column
to read it from.

**Global `flat_screen`/warp-target resolution, corrected to use the existing field.** At GENERATE
time (JS), given a global screen id `N`, `flattenScreens` walks the map-type table in project order
and the first map whose own `[map_base, map_base + screenCount)` range contains `N` is the owner,
where `screenCount` is `gridW × gridH` for a streamed map or `screens.length` for an ordinary one —
this is the existing, real, already-shipped generator algorithm, unchanged.

**CORRECTED this round (fix round 8, finding 4) — the ENGINE's own runtime resolution (a warp
targeting a streamed screen, the one case that genuinely needs this at runtime) is a DIFFERENT
question, and "screens.length" is not an answer to it — that is a JS array property, not a ROM
byte.** An ordinary-to-ordinary warp never resolves "which map" at all: it uses the target
`flat_screen` id directly against the already-compacted ordinary per-screen columns, exactly as
today. Only a warp landing on a **streamed** screen needs the engine to find which map owns a given
global id, from real ROM data: the emitted per-map `map_base` table (9-byte identity block, one
entry per map, in the identical project order `map_base` was computed in at generate time — the two
never independently recomputed, so they cannot drift apart) plus `NUM_MAPS` (already generated into
`config.inc` for other purposes). The engine's own runtime walk is a linear scan of that real table:
starting from map 0, compare `N` against `map_base[mapIndex+1]` (the NEXT map's own base — for the
last map, the project's own emitted final total, a new one-time generated constant, not
`screens.length` re-derived at runtime) — the first map where `N < map_base[mapIndex+1]` is the
owner. This is `O(mapCount)` worst case, run only on a warp targeting a streamed screen (never on
ordinary gameplay's own hot path), against the SAME map-type table + `map_base` column the generator
already emits — no new ROM table beyond the one-map-type-bit and per-map-tileset/fill bytes above.

**The 16-bit pointer-plus-offset accessor for metadata up to byte 337, specified.** A streamed
screen's own 338-byte record holds metadata (entity/bound-tile lists) starting at byte 240 (past the
304-byte terrain+attribute block finding 5 above already reserves — 304, not 240, since attributes
are the trailing 64 bytes of that block) and running up to byte 337 — past what an 8-bit `Y` register
can address directly from a SINGLE base pointer (`mtptr`, which `sw_goto` already sets to the
record's own byte 0). `sw_goto`/`sw_peek_byte`/`sw_terrain_or_fill`'s own `Y` argument is genuinely
8-bit and already correct for the *terrain* block (offsets 0-239); metadata beyond byte 255 needs
the record's own base pointer ADVANCED by 256 first (`mtptr_lo/hi` incremented as a 16-bit pair,
exactly the same "PRG bank stays selected, only the pointer moves" step `sw_goto`'s own cold path
already performs internally when computing `col_byte_lo/hi`), then indexed by `Y = offset - 256`
(0-81 for the remaining 338-256=82 bytes). `spawn_entities` (the real consumer this accessor exists
for) is not rebuilt this round — routing it through this two-step accessor (advance-pointer-then-
index, rather than "just calling `sw_goto`" as the phrase review 6 flagged literally implies) is
named here as the precise contract a real implementation must follow, not built to the byte level.

This is the *same* `O(mapCount)` linear scan `flattenScreens` already performs once at
generate/normalize time — not a new runtime concept for the GENERATOR side, only a newly specified
one for the ENGINE side above. **Ordinary maps compact their own columns by counting only
ordinary screens** — the existing 13-byte-per-screen pointer columns are indexed by an **ordinary-
only** running index (not the raw `flat_screen`), so a mixed project's own ordinary-screen table
does not carry 13 wasted bytes for every streamed screen that will never use it; every consumer that
today indexes those columns directly by `flat_screen` must instead resolve "is this an ordinary
screen, and if so, its own compacted index" first — the map-type table plus the same in-order walk
above, and **toggling a map's own streamed flag no longer silently changes global ids**, since
`map_base` is computed from project order alone, unaffected by which maps around it are streamed —
closing the identity-drift risk review 5 also named.

**Runtime paths, named per consumer**:

- **Warps/collision/spawn**: resolve the map owner (above), then dispatch on the map-type bit — an
  ordinary target uses its compacted index into the existing pointer columns unchanged; a streamed
  target computes `(screenCol, screenRow) = ((N - map_base) % gridW, (N - map_base) / gridW)` and
  calls `sw_goto` with those two values (the identical convention `sw_goto`'s own A/X arguments
  already use) — `map_base`, not a second field, is what `N` is measured from.
- **Tilesets**: an ordinary map keeps `screen_tileset` indexed by compacted index; a streamed map's
  own tileset is a single per-map field (already among the unchanged 9 identity bytes, above) — a
  streamed map draws with **one** tileset for its whole grid, not a per-screen choice, which
  `chr_ram_init`/`switch_chr_bank` already assume today for any one map's own bank-resident screen
  data and is unchanged by streaming.
- **Music/encounters**: read directly off the unchanged 9-byte identity/metadata block for
  whichever map owns the current screen — no streaming-specific logic at all, since `map_song`/
  encounter configuration were never per-screen fields to begin with.

**Mixed-project charging in `kernelTableBytes`, corrected again this round (review 5, finding 6) —
the fix-5 formula double-counted, not merely omitted**: `13 × ordinaryScreenCount + 9 × mapCount + 4
× streamedMapCount` — **not** `13×ordinaryScreens + 9×mapCount + 14×streamedMapCount` (fix round 5's
own formula), which charged every streamed map's own 9 identity bytes **twice**: once inside the
`9 × mapCount` term (which already counts every map, streamed included) and again inside its own
14-byte-per-streamed-map total (9+4+1). With `map_base` reused rather than duplicated (above), the
streamed-only increment is exactly the 4-byte locator, no more. Plus the map-type table's own small
fixed cost (1 bit or byte per map). Not implemented this round — `kernelTableBytes` needs a
per-map-type branch mirroring the generator's own per-map format branch — but the formula above is
now derived directly from the corrected layout, not a placeholder or a re-guess.

**`emitScreens`, as a diff shape (pseudocode, not shipping code, per review 4's own "sufficient" bar
for this finding)**:

```js
function emitScreens(project) {
  // Review 5, finding 6's own fix: ONE running counter, advanced in REAL
  // PROJECT ORDER regardless of map type -- exactly flattenScreens' own
  // existing mapBase computation (generate.js:2004-2020), extended so a
  // streamed map advances it by gridW*gridH instead of screens.length.
  // Global ids are never grouped by type; map_base is the ONLY base-id
  // field either map type uses -- no second, streamed-only field.
  let ordinaryIndex = 0;   // the SEPARATE, ordinary-only compacted index
                             // the existing 13-byte pointer columns use
  let nextGlobalId = 0;     // = map_base for whichever map comes next, in order
  for (const map of project.maps) {
    const mapBase = nextGlobalId;
    if (!map.streamed) {
      for (const screen of map.screens) emitOrdinaryScreen(screen, ordinaryIndex++); // unchanged, today's own 304+variable emission
      emitMapIdentity(map, { mapBase, mapSong: true, encounters: true, tileset: true }); // unchanged 9 bytes, map_base included
      nextGlobalId += map.screens.length;
      continue;
    }
    emitStreamedMapLocator(map, { regionsPerRow: computeRegionsPerRow(map), grid: [map.gridW, map.gridH] }); // the 4-byte incremental cost, no base id here
    emitMapIdentity(map, { mapBase, mapSong: true, encounters: true, tileset: true }); // identical 9 bytes, identical call, map_base reused
    for (let row = 0; row < map.gridH; row++)
      for (let col = 0; col < map.gridW; col++)
        emitStreamedScreenRecord(map.screens[row * map.gridW + col]); // the new 338-byte record, packed per sw_goto's own region math
    nextGlobalId += map.gridW * map.gridH;
  }
}
```

The point of writing it this way: `emitMapIdentity` is the **same call** for both map types (matching
"a streamed map does not cease to need map music merely because terrain pointers are computed"),
including `map_base` itself — the branch is only in which screen-record emitter and which locator
table runs, not a second, parallel identity-emission path, and **one** counter (`nextGlobalId`)
assigns every map's own base id in the order maps actually appear in the project, so a project of
`[streamed A: 2 screens, ordinary B: 1 screen]` gives `A.map_base=0` (screens 0-1) and
`B.map_base=2` — the order-preserving result review 5's own reproduction demanded, not the earlier,
wrong `A=1-2, B=0`.

**Supported shapes per mirroring, corrected this round (review 5, finding 2)** (not "every
rectangular shape on every board," §7 below corrects this too): **no minimum grid size at all** —
fill-metatile padding (§3/finding 2, Chris's decision 3, §10) makes even a 1×1 streamed map legal,
retracting the earlier "at least 2×2" claim outright. On a two-nametable board (MMC1/MMC3, phase 3,
not yet built), the dead axis (the mirroring direction the board cannot scroll) has **one screen of
physical ring extent, not two** — a 32×15 or 16×30 two-nametable ring is exactly *half* the
four-screen ring's own 32×30 physical area, and a screen is 16×15 blocks, so the axis that cannot
scroll shows exactly one screen's worth of physical ring, never two. The correct shape restriction
is therefore **N×1 or 1×N** (the dead axis capped at exactly one screen deep, matching the ring's
own real capacity), not the earlier, wrong "2×N or N×2."

### R7 — capacity, now this round's own independently reproduced measurement

**Fixed this round**: re-running the reviewer's own methodology (`handoff-next/
streamed-worlds-ceilings-check.mjs`, the orchestrator's own script — `createProject`, camera off,
vertical mirroring, mapper set explicitly, full 4×4 maps plus a rectangular remainder, pushed to
`checkCapacity` failure) against this exact tree reproduces the reviewer's own numbers **exactly**,
byte for byte:

```
$ node handoff-next/streamed-worlds-ceilings-check.mjs
action NROM  max=52  next fails: lookup tables (52 also matches SCREEN_BYTES-driven data capacity)
action MMC1  max=170 next fails: lookup tables need 2347 bytes, 2335 free
action MMC3  max=168 next fails: lookup tables need 2321 bytes, 2314 free
action U512  max=156 next fails: lookup tables need 2156 bytes, 2143 free
rpg    MMC1  max=153 next fails: lookup tables need 2117 bytes, 2106 free
rpg    MMC3  max=140 next fails: lookup tables need 1939 bytes, 1923 free
rpg    U512  max=138 next fails: lookup tables need 1913 bytes, 1911 free
```

| Board | Action | RPG |
|---|---:|---:|
| NROM-256 | 52 | not tested (unsupported combination) |
| MMC1 | 170 | 153 |
| MMC3 | 168 | 140 |
| UNROM 512 | 156 | 138 |

These are no longer "the reviewer's own numbers, borrowed" — they are this round's own
independently reproduced measurement of the *existing, non-streamed* engine's own ceiling, included
in Appendix A in full so a future round need not re-derive them. (Fix round 2's own independent
script had a real, disclosed construction bug producing implausible thousands-of-screens results
for NROM — not diagnosed further, since re-running the reviewer's own already-correct script made
diagnosing the broken one unnecessary.)

**Region counts for a streamed map's own packing, freshly measured this round direct from
`shared/cartridge.js`'s real exported functions** — not reconstructed by hand from `prgLayout`'s own
source, which is how round 2's own 28-per-region figure and MMC3's own miscounted region total both
went uncaught for two rounds:

```js
import { MAPPERS, screenRegions, prgLayout } from './shared/cartridge.js';
for (const id of [0, 1, 2, 4, 30]) {
  const mapper = MAPPERS.find((m) => m.id === id);
  console.log(mapper.name, prgLayout(mapper).regions.length, screenRegions(mapper, 1, 0).length);
}
// NROM-256   2  2
// MMC1      14 14
// UxROM     14 14
```

```
// MMC3      30 30   (prgUnits=16)
// UNROM 512 62 61   (one CHR-RAM tileset region taken for one tileset)
```

`MMC1 14`, `MMC3 30` (`prgUnits` 16), `UNROM 512 61`, `UxROM 14` — with one tileset and no banked
code, matching the fix-3 brief's own cited figures exactly and correcting round 2's own MMC3 count
(round 2 never stated a wrong number outright, but never verified one against the real function
either; this round closes that gap).

**Usable regions after real reservations, corrected this round (review 4, finding 4) — not raw
region counts, and not the wrong battle-region charge fix round 4 stated**: `codeRegionCount`
(`generate.js:222`) returns **one** region for an RPG's battle bank, not two — confirmed by
reading the function (`gameType === 'rpg' ? 1 : 0`); fix round 4's own "`bankedCode=2`, the two
co-mapped regions `codeRegions` reserves" conflated the *hypothetical* two-region note under "When
8 KB genuinely runs out" (CLAUDE.md, a note about a future scenario nothing in this codebase uses
today) with the *actual*, current, always-one-region reservation. **The Placement section's own
conclusion also means a streaming-capable project needs a SECOND banked region, unconditionally**:
"the cold path must be banked, on every board" (§ Placement, below) is itself a `codeRegions`
reservation — `bankedCode=1` for streaming alone, `bankedCode=2` for an RPG that also streams (the
battle region and the streaming cold-code region are two separate 8 KB regions, never co-mapped
with each other, so their charges add). Freshly run against `shared/cartridge.js`'s own exported
`screenRegions`, both without and with the streaming charge:

```js
screenRegions(mapper, tilesetCount, bankedCodeRegions, { reserveFlashSave });
// Without the streaming charge (bankedCode = 0 action / 1 RPG-battle-only):
// MMC1:      action 14, RPG 13         -- no flash concept (battery, separate SRAM)
// MMC3:      action 30, RPG 29         -- no flash concept
// UNROM 512: action 61, action+flash 60, RPG 60, RPG+flash 59
//
// WITH the mandatory streaming cold-code region (bankedCode = 1 action-streamed / 2 RPG-streamed) --
// the real numbers a streamed project's own capacity check must use:
// MMC1:      action+streaming 13, RPG+streaming 12
// MMC3:      action+streaming 29, RPG+streaming 28
// UNROM 512: action+streaming 60, action+streaming+flash 59, RPG+streaming 59, RPG+streaming+flash 58
```

MMC1/MMC3 pay no flash-region cost at all (their own Save command uses battery-backed SRAM,
entirely outside the PRG screen-region budget); UNROM 512 pays one further region if its own Save
command is live (the flash sector, coming off the *back* of the region list per `screenRegions`'
own documented rule, never folded in unconditionally). **These streaming-charged numbers are what a
streamed map's own `H×ceil(W/24)` capacity check must compare against** — §10's own
`H*ceil(W/24)<=14` recommendation used the raw, unstreamed 14 for MMC1, not the correctly-charged
13 (action) or 12 (RPG); retracted below, §10, and again under finding 4's own aggregate-preflight
fix.

**Region-packing conclusions, confirmed unchanged**: region use for a streamed map is `H ×
ceil(W/24)` (24-per-region, `STREAM_SCREENS_PER_REGION` — see R6, §5) — a 1×H (tall) map costs one
region per screen, so **its own ceiling is the region count, not the 255-screen reference-format
ceiling** (R12, §5, resolved this round). A 16×16 square streamed map needs 16 regions (one per row, since 16 ≤ 24 fits one
region-width per row), which already **exceeds MMC1's own 14 total data regions** before any
CHR/code-region reservation is taken off the top, and comfortably exceeds NROM's 2 and comes close
to UxROM's 14 too — meaning a square streamed map of even moderate size is infeasible on any board
but MMC3 (30 regions) or UNROM 512 (61) without first accounting for what a real project's own
tileset/code/flash reservations leave available. **The dead-axis refusal (item 12's own
two-nametable rule, §6) restricts which shapes are legal at all** on MMC1/MMC3: a capacity table
must state supported shapes under that restriction, not assume every rectangular shape is
authorable on every board. **The flash-page reservation is not a universal MMC1 deduction** — it
applies only when the project's own mapper/save configuration actually uses it (UNROM 512's flash
save specifically), not as a blanket subtraction on every board.

### Finding 4 — aggregate capacity and preflight: allocate everything together, not map by map

**The gap review 4 found, then review 5's own further correction (finding 7)**: the fix-4 preflight
recommendation compared **each** streamed map's own `H×ceil(W/24)` against the usable-region count
individually — two maps can each pass that check on their own while their **combined** region need
exceeds what the board actually has. Fix round 5's own attempted aggregate fix then invented a
`ceil(ordinaryScreenCount * ORDINARY_RECORD_BYTES / SCREEN_REGION_BYTES)` term assuming a **fixed**
ordinary record size — but ordinary records are **variable** (`generate.js:2066-2076`, entity/
binding metadata varies per screen), and `screenCapacityFor`/`assignScreenBanks`
(`generate.js:2180-2245`) already pack them by **sequential whole-record bin-packing** — walking
region by region, adding whole records until the next one would not fit, never splitting one across
a region boundary, and never dividing a byte sum by a region size (which can both over- and
under-count against the real packer's own boundary-tail waste). **The fix: reserve streamed
regions outright, then run the REAL existing packer against what is left, not a division
formula**:

```
usable = screenRegions(mapper, tilesetCount, codeRegionCount(project) + (anyStreamedMap ? 1 : 0), { reserveFlashSave })
streamedNeed = sum over every streamed map of ceil(gridH * ceil(gridW / STREAM_SCREENS_PER_REGION))
// Streamed and ordinary content never share one region -- a streamed map's own
// row-chunk is whole regions, packed independently of ordinary byte-level
// packing -- so streamed regions are reserved first, unconditionally.
remainingRegions = usable.slice(streamedNeed)   // the same list screenCapacityFor would walk
refuse if streamedNeed > usable.length
refuse unless fitsCapacity(mapper, tilesetCount, codeRegionCount(project) + (anyStreamedMap ? 1 : 0),
                            reserveFlashSave, flatOrdinaryScreens, actorCount, boundTilesEnabled,
                            { regionsOverride: remainingRegions })
```

**SUPERSEDED (fix round 8, finding 5) — `screenCapacityFor`'s own return value is NOT what this
predicate should check, and this round found and fixed the exact reason why, reproducing review 6's
own defect against the real shipped function.** `screenCapacityFor` (`generate.js:2180-2206`)
returns **packed records PLUS hypothetical additional empty-screen-sized slots** in every region's
own leftover tail (`spare.reduce((total, free) => total + Math.floor(free / emptyScreen), 0)`) — a
valid answer to "how much generic capacity is left," never a valid answer to "do these specific,
real-sized records fit," since a leftover tail can hold one MORE *empty* screen while being too
small for the *actual* next record the caller is asking about. Comparing its count against
`flatOrdinaryScreens.length` (the pseudocode two rounds ago) is exactly the bug review 6's own
26-record MMC3 case demonstrated: `screenCapacityFor` returns 26 for 26 requested records (the tail
region's own leftover space "counts" as one more slot in the generic sense), while
`assignScreenBanks` — the REAL, ordered, whole-record walk that will actually run at build time —
throws, because the 26th record (402 bytes, eight actors and eight bindings) does not fit in that
tail's own real remaining space.

**The fix**: the acceptance predicate calls `assignScreenBanks` itself, in validation mode, rather
than trusting `screenCapacityFor`'s own count — reusing the exact packing logic that will actually
run at build time, so the check and the real emission can never disagree:

```js
function fitsCapacity(mapper, tilesetCount, bankedCode, reserveFlashSave, flat, actorCount, boundTilesEnabled) {
  try {
    assignScreenBanks(mapper, tilesetCount, bankedCode, reserveFlashSave, flat, actorCount, boundTilesEnabled);
    return true;
  } catch {
    return false;
  }
}
```

(`assignScreenBanks` does not take a `regionsOverride` parameter today, the same gap
`screenCapacityFor` itself has — the concrete shipping change is identical for both: a
`regionsOverride` parameter, or an equivalent slice of `screenRegions`' own output passed straight
through instead of recomputed inside. Not built this round; the acceptance LOGIC — call the real
walk, not the count — is what this finding fixes, verified below against the CURRENT, real,
already-shipped signatures with the streamed-region reservation modelled by construction, not a new
parameter.)

**Reproduced against the real shipped `screenCapacityFor`/`assignScreenBanks`
(`main/build/generate.js`), not a reimplementation** (`proto-tools/diag_r8_packing_predicate.mjs`):

```
$ node proto-tools/diag_r8_packing_predicate.mjs
MMC3, tilesetCount=1, bankedCode=1 -> 29 screen regions (8176 bytes each)
filler: 728 empty (306-byte) screens = exactly 26/region x 28 regions
screenCapacityFor(..., flat26 [754 records], ...) = 754 (requested 754)
ok   screenCapacityFor wrongly reports enough capacity for every record including the oversized last one
assignScreenBanks(..., flat26, ...) THREW: internal: 1 screens did not fit into MMC3's PRG banks
ok   assignScreenBanks throws on the exact same records screenCapacityFor accepted
ok   the thrown error names exactly 1 screen that did not fit
ok   the corrected predicate (assignScreenBanks-based) correctly REJECTS the case screenCapacityFor wrongly accepted
ok   the corrected predicate correctly ACCEPTS the same records minus the oversized last one
ALL PASS, exit 0
```

28 filler regions (728 identical 306-byte empty screens, exactly 26 per region — `floor(8176/306)`,
verified exact since 27 would need 8,262 bytes) precede the reviewer's own 25-record tail (20
one-actor screens at 315 bytes, 5 empty at 306) plus one 402-byte record (eight actors, eight
bindings) — every byte figure derived from the real `screenRecordBytes` formula
(`SCREEN_BYTES=304`, `ENTITY_RECORD=9`, `BOUND_TILE_RECORD=3`, +1 for the bound-tile-enabled flag),
not copied as a literal, and the thrown message — *"1 screens did not fit"* — matches review 6's own
report exactly. `ordinaryNeed` (the shorthand review 6 asked to have removed) never existed in
shipped code (confirmed by search) — it was pseudocode-only in this document's own earlier drafts,
and does not appear in the corrected version above.

`tilesetCount` is the project's own **actual** tileset count (not the "one tileset" placeholder
every prior round's own examples used) — `chrPayloadRegions` already takes it as a real parameter,
so charging the true count is a call-site fix, not a new mechanism. `codeRegionCount(project) + (anyStreamedMap
? 1 : 0)` charges the battle region and the streaming cold-code region **each once**, additively,
never doubled and never omitted (the exact defect this finding named). `reserveFlashSave` is passed
only when the project's own save configuration actually reserves it (UNROM 512 with a live flash
Save command) — never a blanket subtraction on every board, unchanged from R7's own existing rule.

**The candidate transformation, for the mapper-switch preflight (`checkStreamedMapperSwitch`,
R14 below)**: switching mapper or mirroring can itself change `tilesetCount`'s own ceiling
(`tilesetLimit`) and force a tileset or mirroring choice to be silently truncated by
`reconcileCartridge` — the preflight's own aggregate check must run against the **candidate's**
post-`reconcileCartridge` shape, not the pre-switch project's, or a switch that would silently lose
a tileset could pass a check computed against the tileset count it is about to lose. **Preserved
state on rejection**: the preflight runs against a `structuredClone`, never the live draft (R14's
own existing rule, restated here because the aggregate check is what runs inside it) — a refusal
leaves the project exactly as it was, cartridge fields included.

**Load-time refusal, before normalisation**: a project file hand-edited (or written by a later
version) to carry a mapper/streamed-map combination this aggregate check would refuse must be
refused **at load**, before `normalizeProject` runs — the identical ordering `validateProject`
already uses for every other over-capacity refusal (CLAUDE.md's own "an already-over-cap project is
refused... rather than silently sliced" rule, applied here to the aggregate region count rather than
an actor/item/metasprite id space). This closes the gap a Build-panel-only check would leave: a
project that was valid when saved, then opened by a version whose engine grew (a bigger cold path,
a wider battle region), must fail loudly at load rather than build a truncated ROM.

**Capability flags denote shipped consumers only**: `streamCapableFourScreen`/
`streamCapableTwoNametable` (R14, below) name what this document's own phases actually build —
phase 2's four-screen consumer is the only one with real code behind it this round; a two-nametable
capability flag must not flip true until phase 3 actually ships a two-nametable consumer, even
though the registry *fact* (which mapper/mirroring pairs are electrically capable) can be stated
now. The dead-axis shape restriction from finding 1/decision 3 (below) applies wherever a
two-nametable capability is live, exactly as R14 already states.

### R11 — RAM, reentrancy, and the flash-save transaction

**The reentrancy bug is fixed.** `sw_nmi_stream` now owns `sw_ns_chunk`, a dedicated zero-page byte
chained after the existing NMI-private scratch — confirmed by inspection to be a distinct address
from `sw_tmp4` (which `sw_goto`, called only from main-loop code, still uses as its own row
accumulator). An NMI landing mid-`sw_goto` can no longer corrupt the streaming chunk counter, or
vice versa; the two routines' own scratch needs are now fully disjoint.

**The reentrancy fix's own RAM footprint, historical (fix round 3's own count, superseded)**: fix
round 3 measured 73 absolute bytes (`$05A0`-`$05E8`, 23 free to `$05FF`) and twelve zero-page bytes
(ending `$C5`, 58 free) at the point `sw_ns_chunk` was added. **Superseded by every later round's own
additions** — the current, correct figures (83 absolute bytes ending `$05F2`/13 free; zero page
ending `$C6`/57 free after `sw_caller_bank`; further reduced this round by `sw_run_off`/
`sw_run_len`/`sw_run_buf`, see finding 2/8 below) are stated once, in the Placement section, and
this paragraph is kept only as a historical anchor for what the reentrancy fix itself cost, not as
a current RAM count — review 4, finding 8 found this stale figure still stated as if current
alongside the real one later in the same document, which this labelling now prevents.

**The flash-save resync, placed correctly this time**: `engine/save.asm:197-219`, confirmed by
re-reading, restores the mapper and **immediately** calls `enable_rendering` — meaning a
`sw_render_window` resync must run **before** that re-enable, inside the same render-disabled
transaction the save write itself already holds, not merely "before streaming resumes" (round 2's
own weaker, incorrect placement). This also means the resync must **restore whatever overlay was on
screen** (a menu or the save UI itself, both of which exist even under the no-dialogue restriction —
R13) rather than assuming a bare field screen, and must **not** respawn entities or arm an entry
event, since a resync is not a screen crossing. **The Continue-row contradiction is resolved**:
Continue **does** arm an entry event (matching every other load/warp-style entry this document
already specifies), correcting round 2's own text, which asserted the opposite in one place while
its own transition table said the opposite of that.

### R12 — identity: the project-wide ceiling question is now resolved, not merely audited

**Resolved this round, not merely audited at one more site.** `engine/boot.asm:286-290`'s own `cmp
#NUM_SCREENS` compares an **8-bit operand** against `NUM_SCREENS` — a literal decimal value emitted
by `generate.js:3111`'s own `NUM_SCREENS = ${flat.length}` (confirmed by reading the generator
source, not inferred), which must fit an 8-bit `CMP` immediate. `engine/save.asm:296-302` has the
identical shape, a second real site (round 2's own audit found only the first). At the project-wide
**256**-screen ceiling this document's own §1 recommendation has floated since round 1,
`NUM_SCREENS` itself would need to assemble as the literal `256` — either a nesasm error or a
silent truncation to 0, either way breaking every count check in the ROM, not just these two.

**But this project already has an existing, independent reason the real ceiling cannot be 256 at
all**: `NO_SCREEN = $FF` (`engine/constants.asm:1373`) is the neighbour-table sentinel
(`screen_left`/`right`/`up`/`down` all use it for "no screen that way," and `take_door`'s own
`cmp #NUM_SCREENS; bcs take_door_done` treats any value `>= NUM_SCREENS` as "ignore this warp
target" the identical way). A real screen id of 255 would be indistinguishable from "no screen" the
instant a project reached exactly 256 screens — the identical shape CLAUDE.md already documents for
`LIMITS.metasprites = NO_METASPRITE`/`LIMITS.actors`/`LIMITS.items` ("the cap IS the sentinel's own
value... an already-over-cap project is refused... rather than silently sliced"). **The same rule
applies here with no new mechanism needed: the project-wide streamed-world ceiling is 255 screens,
not 256.**

**The refusal rule itself, corrected this round (review 3, finding 12) — a real off-by-one**: 255
screens means valid ids **0-254**, with **255** reserved as the sentinel — `validateProject` must
refuse **`count > 255`**, not `count >= 255` as this document's own earlier phrasing said. A project
with *exactly* 255 screens is legal: its highest id is 254, `NUM_SCREENS` assembles as the literal
`255`, and `cmp #NUM_SCREENS`/`cmp #255` correctly rejects a warp/save target of 255 (`$FF`, the
sentinel) while accepting every real id up to 254. The earlier "refuses at 255" phrasing would have
wrongly rejected a fully legal, maximally-sized project. With the rule stated correctly, `NUM_SCREENS`
never exceeds `255` as a real decimal literal, and every existing `cmp #NUM_SCREENS` site is correct
exactly as written today, for any legal project, with **zero emitted-code change**. This closes the
concrete instance R12's own audit was asking for outright, rather than naming a special-cased
"is this the full case" branch that stating the rule correctly makes unnecessary. A sweep for any
*other* fixed-width count/sentinel comparison this reasoning might also apply to (any place a
project-wide count reaches into a byte-sized comparison) is not exhaustively performed this round
beyond the two `NUM_SCREENS` sites and the sentinel argument itself — named as the remaining,
narrower audit, not the wide-open one round 2 left.

**Finding 10, closed this round with a real decision: the coordinate domain per mode, the
save-validation rule, and the mode-toggle compatibility behaviour.** `engine/save.asm:314-325`
rejects a save whose own `player_y > MAX_Y` (224, the ordinary engine's own screen-height limit) —
a save-position range check with no knowledge of streaming at all. Decision 1's own
continuous-crossing model (restored, §4/R8) makes this check wrong for a streamed map: a player
genuinely, legitimately straddling a vertical screen boundary under continuous crossing can occupy
`y=225-239` (past the ordinary engine's own `MAX_Y`, within the streamed engine's own full
256-pixel vertical extent), and the *existing* save validator — unaware streaming exists at all —
would reject that save outright, breaking Continue for a player who happens to save mid-crossing.

- **Coordinate domain, decided per mode, keyed on the saved screen's own map-type bit (§5, finding
  3)**: an ordinary-screen save keeps today's own `0-224` (`MAX_Y`)/`0-240` (`MAX_X`) range,
  unchanged — the ordinary engine's own player-position clamp never changes shape. A streamed-screen
  save accepts the full `0-239` vertical / `0-255` horizontal range decision 1's continuous model can
  legitimately produce (`y` up to `239`, one pixel short of the next screen's own local `0`, matching
  the natural-origin-with-overshoot rule — not `255`, since the vertical screen height is 240 pixels,
  the identical `240` vs `256` distinction finding 6's own `112`/`120` correction turns on).
- **The validation rule**: `save_check_valid` (`engine/save.asm`) reads the saved screen's own
  map-type bit **before** applying either range — `player_y > 224` is refused only when the saved
  screen is ordinary; `player_y > 239` (or `player_x > 255`) is refused when it is streamed. This is
  one extra branch on a bit the mixed lookup contract (finding 3) already emits, not a second save
  format or a new field.
- **Mode-toggle compatibility, the specific case finding 10 named**: toggling a single map's own
  `map.streamed` flag with no other structural edit does **not** bump `saveCompatToken` (unchanged
  from the existing R12 decision, below) — but it **does** change which range rule a saved position
  on that map is checked against on the very next load, since the map-type bit the check reads is
  live project state, not baked into the save record itself. A save taken while streamed (legitimately
  at `y=230`, say) that is then loaded after the author toggles the same map back to ordinary would
  fail the now-active `224` check — **this is the correct, intended behaviour, not a bug to
  suppress**: the position genuinely is invalid for an ordinary screen (nothing renders past `y=224`
  there), and the existing "this save does not belong to this build" path (CLAUDE.md's own
  `SAVE_LAYOUT_VERSION` precedent) is the right response, not a silent clamp that would teleport the
  player to a position they never actually stood at. **No new compatibility token or normalisation
  step is needed**: the range check *is* the compatibility mechanism, reusing infrastructure that
  already exists for exactly this "does this save still make sense" question, rather than inventing
  a parallel one specific to streaming.

**`saveCompatToken` decision, unchanged from fix round 2, confirmed still correct**: a pure
`map.streamed` toggle with no reordering, deletion or resize does not itself invalidate a saved
`flat_screen` position (the position's own meaning is unchanged — still "this screen, addressed
globally"), so it does **not** need a token bump on its own; a *structural* edit to a streamed map
(reordering its own screens, resizing its grid) needs the identical token bump item 7's own existing
mechanism already gives every other structural edit — streamed maps are not a special case for this
purpose, they use the *same* mechanism, not a new one. **State initialisation through one
initialiser**: Continue, a warp's `warp_scr`, a door's `ent_to_scr`, and ▶ Test all need the
identical `sw_init_map`-style resolution (decompose a global screen index into `(col_rem,
col_region, row_bank_base)` via the one-time division) — named consistently across all four call
sites, not built as a shared routine this round (it existed in round 1's prototype, was dropped in
round 2's rebuild, and is not restored to working code here; `sw_goto`, this round's own resident
routine, §5, is the one-time-division primitive any such initialiser would call).

### R13 — dialogue: option 2, costed with a real number, and the call-reachability gap named

**Superseded by Chris's decision 2 (§10, round 5)**: the ~698,000-cycle anchor below was measured
against a prior version of `sw_render_window` (before this round's own `sw_rw_col_delta`/
`sw_rw_row_delta` addition) and priced the redraw alone, not the whole open/close transaction —
§10's own decision 2 has the current-tree measurement (835,723 cycles for the close, 29,831 for the
open) and the full transaction. **Kept below as history, not current guidance** — the
call-reachability finding (`liveCommands`, the second half of this section) is unaffected by either
figure and remains current.

**Option 2 (camera snap/rebase/redraw), costed against fix round 4's own measurement, historical**
— review 3's own reproduction gives the anchor figure: a full `sw_render_window` redraw
costs **~698,000 isolated CPU cycles (~212,000 6502 instructions) — roughly 23.4 NTSC frame periods
(1 frame ≈ 29,780 cycles)**, cross-checked against this round's own independent measurement of the
identical routine (~210,000 emulated jsnes steps, §0's own trap 2, both fix rounds). **This is the
dominant cost of option 2**, since a camera-position snap and a nametable-0 rebase are cheap,
constant-time operations by comparison (a handful of comparisons and a `$2006`/`$2005` write each) —
the real cost is that opening a box on a streamed map, under option 2, means **freezing the game for
roughly 23-24 frames** (~390 ms at 60 fps) while the whole window redraws under forced blank, a
duration a player would experience as a visible stall or flash, not a smooth transition. **RAM
cost**: no new persistent state beyond what `sw_render_window` already needs (`attr_shadow`,
`sw_rw_*` scratch, already allocated) — the snap/restore itself needs one saved copy of the
pre-snap window origin (4 bytes: `screenCol`/`localCol`/`screenRow`/`localRow`) to restore on close.
**Byte cost**: not measured to the instruction, but bounded by the same order of magnitude as the
existing `sw_render_window` call site plus a snap/restore wrapper — a few dozen bytes of new
kernel-lo code, not a new major subsystem, since the mechanism (redraw the whole window) already
exists and works (§3).

**This is a real, costed alternative now, not a placeholder** — 23-24 frozen frames every time
dialogue opens on a streamed map, against the v1 restriction's own cost (no in-map dialogue at
all). **The restriction is no longer presented as "engineering-only, accepted"** — it is a real,
author-visible scope decision (an RPG overworld with no in-map dialogue at all, or a real, visible
pause on every conversation), returned to Chris in §10 alongside this cost, not decided here.

**Call reachability, finding 13's own second point, confirmed real by re-reading the source
directly**: `shared/eventrules.js:201-228`'s own `liveCommands` recursively visits routes,
then/else branches and choices — but **it yields a `call` command, it does not follow the called
common event's own body**. A restriction applying `liveCommands` as its own predicate (this
document's own prior recommendation) would therefore see "this map event calls common event N" but
never check whether common event N's own body contains a `Say` — missing exactly the indirect path
the finding names. **A real fix needs a call-graph/reachability layer above `liveCommands`**: starting
from every map event's own live commands, follow every `call`'s own resolved target
(`liveCommonEvents`, CLAUDE.md's own event-system section already names this the single source of
truth for which common events are reachable at all) into *that* event's own `liveCommands`,
recursively, with cycle detection (two common events calling each other, CLAUDE.md's own
`CALL_STACK_DEPTH` precedent) — not designed to the function signature this round, but the shape is
now correctly named rather than "liveCommands alone is the right predicate," which review 3 correctly
found false. **Menu and save UI remain supported** even under the restriction — they are not
"dialogue" in the sense being restricted, though R11's own flash-save resync (above) and R10's own
pause gate both still need to account for them explicitly as overlays a resync or a pause must
respect; their own scrolled-nametable strategy (how a menu drawn as sprites, per CLAUDE.md's own
existing menu-as-sprites design, interacts with a camera that has scrolled away from nametable 0's
own fixed origin) is a separate, unaddressed question this round does not resolve.

### R14 — gating, on real per-mapper knowledge

**The `phase` object is retracted.** A global `phase.twoNametableConsumerShipped`-style flag admits
*every* switchable-PRG mapper the instant it flips true, which is not what "per-mapper, per-mirroring
consumer implemented" means — `streamCapable`/`streamCapableFourScreen` must instead be keyed the
same way `rpgCapable`/`supported`/`unsupportedReason` already are in the mapper registry itself
(`shared/cartridge.js`): a **per-mapper-entry fact**, not a session-global toggle, so that "phase 2
ships four-screen, phase 3 ships two-nametable" is expressed as which registry entries carry which
capability flag, not as a single flag every entry shares.

**The mutation/preflight contract, identified precisely**: `shared/project.js:1267`'s own
`reconcileCartridge` is called from `renderer/forges/build/build.js:503,568`, **inside** the Build
panel's own `store.commit` — meaning by the time `reconcileCartridge` could refuse a downgrade, the
draft project has already been mutated in place. A refusal-with-preserved-state contract needs a
**preflight validation step before that commit**, not a return value from `reconcileCartridge`
itself (which the existing tileset-reconciliation precedent, confirmed, never needed, since a
tileset reconciliation never has to *refuse* the whole edit — it can always fall back to a valid
tileset; a streamed map exceeding the new board's own screen/region ceiling has no equivalent safe
fallback, only "refuse the switch entirely"). This is a real, unresolved design gap distinct from the
"which predicate" question above; named, not designed to the byte level this round. **Kept from
round 2, confirmed still correct**: phase 1's own build refusal for an unsupported `map.streamed`
project, and the dead-axis refusal on a two-nametable board.

**A concrete preflight contract, per finding 14's own explicit demand**: `checkStreamedMapperSwitch
(project, candidateMapperId, candidateMirroring) -> { ok: true } | { ok: false, reason: string,
problems: [...] }` — a pure function, called **before** `renderer/forges/build/build.js:503,568`'s
own `store.commit`, against a `structuredClone` of the current project with only the cartridge
fields hypothetically changed, **then run through the identical `reconcileCartridge` the real
commit would apply** (finding 4, above — the candidate must be checked in its post-reconciliation
shape, since a tileset or mirroring loss the switch itself would cause must be visible to the
checks below). It checks, in order: (1) does the candidate mapper/mirroring pair carry a
`streamCapable` fact for *every* streamed map already in the project (the per-mapper-entry registry
fact, above); (2) for a two-nametable candidate, does every streamed map's own grid already respect
the dead-axis restriction (§5/finding 1, decision 3 below); (3) does the **aggregate** check
(finding 4, above — `streamedNeed <= usable.length` AND `fitsCapacity(...)` for the real remaining
ordinary records, fix round 8's own corrected predicate, not a byte-sum comparison — charging
tilesets by the reconciled candidate's own actual count, the battle region and the streaming
cold-code region each once, flash only where it applies) pass for the candidate mapper. On any
failure, `store.commit`
never runs — the pre-edit project (the real one, never the `structuredClone`) is untouched, and the
Build panel surfaces `reason`/`problems` the same way `checkCapacity`'s own existing refusals
already render, naming the Map Forge and the specific map. **This is a function signature and a
preflight ordering, not a shipped implementation** — the three checks above are named from facts
this document already established (the registry fact, the dead-axis rule, the aggregate
reservation formula), not new invention, but no code was written this round.

**The per-mapper/per-mirroring capability matrix, stated explicitly**: `streamCapableFourScreen` is
true only for UNROM 512 with `fourscreen` mirroring (phase 2, the only consumer built at all so
far — §9); `streamCapableTwoNametable` is true for MMC1/MMC3 under `vertical` or `horizontal`
mirroring *and* UNROM 512 under either without `fourscreen` (phase 3, not started — §9); every
other mapper/mirroring combination is `false`. The dead-axis rule (§5/finding 5) applies whenever
`streamCapableTwoNametable` is true and restricts the grid shape, not the capability flag itself —
a 2×2-or-larger map is still `streamCapable`, it is simply refused a *specific* shape (N×M with both
N,M>2) rather than the whole mapper.

### Placement — this round's own real measurements, on real fixtures

**Review 3 finding 3's own correction, resolved this round**: `sw_peek_byte`'s ending
(`jsr sw_locate_current`) restores the FIELD's current screen, correct only for a field/mainline
caller. `sw_read_transaction` (finding 3, §0/§3) is the *general* code-bank-restoring transaction —
it takes the caller's own PRG bank as an explicit argument and restores exactly that, correct for
*any* caller including one resident in a different bank entirely. Both are kept as distinct,
named routines (§0's own guidance: keep `sw_peek_byte` as the resident collision convenience, and
say so — done). **`sw_goto` itself must stay kernel-lo, full stop** — there is no safe way to bank
it at all under this project's own single-bank-at-a-time PRG model, since it is exactly the routine
that changes which bank is selected; a caller cannot "reselect its own bank after `sw_goto`
returns," because the instruction immediately after the `jsr` is already fetched from whatever bank
`sw_goto` just switched to. `sw_locate_current` (the O(1) restore) is in the identical position for
the same reason — this is *why* `sw_read_transaction` restores via an explicit argument rather than
trying to "return to" the caller's own bank some other way.

**Finding 2, closed this round: the resident bounded-run transaction, built, routed through a real
banked caller, and re-measured from scratch.** Review 4 found two real gaps in fix round 4's own
`sw_read_transaction`: (1) nothing in the prototype actually *called* it from a caller resident in a
switchable bank — `diag_r3_transaction.mjs`'s own "bank 7" was a JS-side `loadFromCartridge` peek
after a `switch_prg_bank` call, never an instruction stream physically executing there; (2) the
292/886/836/905-cycle figures measured **the entire old `sw_peek_byte`**, not `sw_goto` in
isolation, and mischaracterised what made `(0,30)` expensive ("two row-bank-base additions" is not
what the routine does — `(0,30)` pays 30 iterations of `sw_goto`'s own row loop, not two). Both are
fixed:

- **`sw_read_run`** (`streamworld.asm`, beside `sw_read_transaction`) is the resident bounded-run
  primitive finding 2 asked for: caller's bank in (`sw_caller_bank`), `sw_goto` selects the target
  screen, up to `sw_run_len` bytes (sized to 8 — the real worst case this design needs, a handful of
  metatiles across a straddled collision edge, not a whole 16-wide row) are copied into a dedicated
  `sw_run_buf` **before** the caller's own bank is restored — copying first is mandatory for the
  identical reason `sw_read_transaction` restores at all: the instruction after `switch_prg_bank`
  executes from whichever bank it just selected, so the target screen's own bytes cannot be
  dereferenced a second time once the caller's bank is back. `sw_run_buf` is its own buffer, never
  `sbuf` (the incremental-strip buffer) — reusing `sbuf` would recreate the exact `sw_tmp4`-style
  reentrancy bug already fixed once (§0), since a probe can run in the same frame as an in-flight
  NMI-drained strip still reading `sbuf`.
- **Proven from a REAL banked caller**, not a RAM stub: `sw_run_bank_test`, a small routine
  assembled at nesasm bank 14 (PRG register 7's own `$8000` half — `shared/cartridge.js`'s
  `prgLayout()` pairs nesasm bank `2N`/`2N+1` under hardware register `N`, so register 7 needs nesasm
  bank 14, not literal "bank 7"; caught by measurement, not assumed), whose own instructions (the
  register setup, the `jsr sw_read_run`, the trailing `rts`) are genuinely fetched from that
  switched-in bank. The scenario holds three distinct hardware banks live at once: the caller's code
  (register 7), the field's own "current screen" (register 2, left untouched throughout), and the
  probed target screen (register 1) — `proto-tools/diag_r4_bank_run.mjs` confirms all of: the
  caller's own fingerprint byte still reads back after the call; `sw_run_buf` holds the target
  screen's real first 8 bytes; the field's own persistent tracking bytes are byte-for-byte
  unchanged; and the field screen still independently resolves via `sw_locate_current` afterward.
- **Costs, decomposed and re-measured on the current tree, dropping the mischaracterised figures**
  (`proto-tools/diag_r4_run_cost.mjs`): `sw_goto` alone costs **149 cycles at (col=0,row=0)** (no
  loop iterations), **166 at (col=0,row=1)** (one row-loop iteration), **191 at (col=1,row=1)** (one
  column-byte-loop iteration plus one row-loop iteration) — and, at the real worst case
  `(col=254,row=254)` (the maximum legal coordinate under the 255-screen ceiling, R12), **5,479
  cycles**, entirely dominated by the row loop's own `O(row)` cost (up to 254 single-byte additions,
  no shortcut). `sw_read_transaction` (one byte) adds roughly 70 cycles over `sw_goto` alone at each
  coordinate (219/236/261 cycles for the same three); `sw_read_run` adds roughly 100 cycles of
  its own loop setup plus about 31 cycles per additional byte (251/268/293 cycles at length 1;
  468/485/510 at length 8) — confirmed strictly monotonic
  (`sw_read_transaction < sw_read_run(len=1) < sw_read_run(len=8)`) at a shared coordinate, so the
  per-byte loop genuinely runs rather than being folded away. **Decision, following directly from
  this table**: a consumer needing more than one byte from a neighbour screen uses `sw_read_run`
  (one relocate, a bounded copy, one restore); a consumer needing exactly one byte (the straddling-
  collision probe, §4/finding 5) uses `sw_read_transaction`; neither should be called in a
  byte-at-a-time loop, since each call re-pays the full `sw_goto` relocate cost. `sw_goto`'s own
  `O(row)` worst case (5,479 cycles, not a small constant) is itself new information this round's
  own measurement surfaces — a probe at an extreme row coordinate is measurably more expensive than
  one near row 0, relevant to finding 5's own worst-case per-frame probe budget below.

**Placement is a measured fact per board, not a reasoned split.** Four real builds, updated this
round for the two new routines (`sw_read_transaction`, `sw_clamp_col`/`sw_clamp_row`):

| Build | What's included | Result |
|---|---|---|
| `minimal-u512` (synthetic, no Save/Title/dialogue live) | Full mechanism: hot path + `sw_goto`/`sw_locate_current`/`sw_cross_*`/`sw_peek_byte`/`sw_read_transaction`/`sw_read_run`/`sw_clamp_col`/`sw_clamp_row`/`sw_project_axis`/both strip starters/`sw_nmi_stream`/`sw_render_window`/the debug tables/the bank-14 test caller | **Fits**, 100 bytes kernel-lo free after (166 before this round's own `sw_read_run` and `sw_project_axis`, 205 before fix round 4's own clamp/transaction routines) |
| `sample-u512` (real fixture: flash Save, dialogue, title live) | **Hot path only** (`sw_nmi_stream`/`sw_ns_draw_block`/`sw_ns_draw_attr`, unchanged this round) | **Fits**, 653 free after |
| `sample-mmc3` (real fixture: battery Save, dialogue, title, font split live) | **Hot path only** | **Fits**, 827 free after |
| `sample-mmc1` (real fixture: battery Save, dialogue, title live) | Full mechanism | **Overflows** — real nesasm diagnostic: `music.asm` (a **kernel-lo** file, confirmed below — the diagnostic names it only because it is whichever kernel-lo source crosses the bank boundary first, not evidence anything was pushed out of a different bank) reports `Bank overflow, offset > $1FFF!` on bank `0E` (MMC1's own kernel-lo bank, `prgLayout(mapper).kernelLoBank`) — unchanged from fix round 3, since the full mechanism already overflowed there before this round added more code to it |

**The conclusion this measurement supports, corrected this round (review 5, finding 9) — "the cold
path must be banked" was itself wrong, not merely uncosted.** The *hot path alone* is cheap enough
to fit kernel-lo unbanked on every real board tested — unchanged, still true. **But `sw_goto`,
`sw_locate_current`, `sw_peek_byte`, `sw_read_transaction` and `sw_read_run` cannot be banked at
all, ever, under this project's single-bank-at-a-time PRG model** — each of them dereferences
`mtptr` (or calls something that does) in its *own* code, immediately after its *own* `jsr sw_goto`,
so the instruction stream executing that dereference must itself be resident, exactly the reasoning
already given above for why `sw_goto` itself cannot move. Placing this earlier round's own placement
table listed these five as "Resident (cold)" and then said that category "must be banked" — a plain
self-contradiction review 5 caught directly; fixed by removing the "must be banked" claim from this
set entirely. **`sw_render_window` and the strip starters (`sw_stream_start_col`/`row`) are in the
identical position, for the identical reason**: their own code does `jsr sw_goto` and then
`lda [mtptr_lo],y` inline, so *they* too must be resident under the current design, not merely their
callers.

**What routing through `sw_read_run` would really cost, measured rather than assumed (finding 3)**:
covering one 15-byte metatile row (two `sw_read_run` calls, 8+7 bytes) at a cheap, aligned
coordinate costs **939 cycles** (`485+454`, both real Mesen/jsnes measurements) — a full 30-byte,
two-screen column strip assembled from four such calls would cost roughly **1,878 cycles** at that
*same* cheap coordinate, genuinely **less** than the direct reader's own real, reproduced **3,163
cycles** (`sw_stream_start_col`, measured fresh this round at the identical aligned origin the
reviewer's own figure used) — because `sw_read_run`'s tight copy loop has less per-byte branching
than the direct reader's own inline screen-boundary bookkeeping. **This does not hold at a worse
coordinate**: each `sw_read_run` call pays its *own* full `sw_goto` relocate, so covering one screen
in two chunks pays that relocate **twice** where the direct, lazy-relocate reader pays it **once** —
at the worst legal coordinate (`(0,254)`, finding 4's own corrected ceiling, `sw_goto` alone costs
4,973 cycles), four chunked calls would pay roughly `4×4,973 ≈ 19,892` cycles of relocates alone,
against the direct reader's own two relocates (`2×4,973 ≈ 9,946`) — **routing through the current
8-byte `sw_read_run` roughly doubles the worst-case cost**, a real, bounded, disclosed overhead
(not the byte-count-proportional blowup a naive reading might expect), not a free win.

**SUPERSEDED IN PART (fix round 8, finding 3) — the strip readers ARE now routed and proven bankable;
`sw_render_window` is not.** The paragraph below described real, then-current limits; decision A's
own frame budget made the underlying question urgent enough to actually build, this round, rather
than leave as a costed-but-deferred direction. `sw_banked_stream_start_col`/`row`
(`minimal-u512/build/streamworld.asm` via `proto-tools/rebuild_minimal_u512_fs3.mjs`'s own injected
source) replace `sw_stream_start_col`/`row`'s own inline `sw_goto`+dereference with 2-3 calls to a
new resident primitive, `sw_strip_fetch_run_col`/`row`, each fetching one whole screen's own
contribution to the strip in a single resident transaction and restoring the CALLER's own PRG bank
(`sw_caller_bank`) rather than the field's current screen — genuinely callable from a banked
context, not merely a bigger `sw_read_run`. Proven identical output to the already-proven mainline
routines at 8 representative origins (both axes, 2-screen and 3-screen cases — see below, a real
fact this round's own proof found: **a strip can touch three screens, not two**, whenever the
window's origin on that axis is not local-aligned), and proven to restore a genuinely different
caller's own bank correctly (§3 proof, this round). `sw_render_window` (the full four-nametable
renderer decision B's own dialogue close needs) is **not** rebuilt this round — it remains
mainline-only, `sw_locate_current`-restoring, exactly as before; decision B never calls it from a
banked context, so this was not required to close decision B, only decision A's own strip-arm
question. **The kernel-lo placement crisis is not solved, only relocated and sharpened**: the new
primitive itself must live in kernel-lo (never a switchable bank — see its own header for the real
crash that proved this), and minimal-u512's own kernel-lo has no room for it either; §9's own
placement figures, below, are the real, current numbers, not the stale ones this paragraph
originally reported.

**RAM allocation — two real errors found and corrected this round, not merely restated.** `73`/`$C5`
(fix round 3's own count) was already known wrong; the fix round 5-7 replacement, **`93` bytes ending
`$05FC`, 3 free**, is now ALSO found wrong this round — `sw_fill_metatile_id` (fix round 5's own
addition, `sw_run_buf+8`) resolves to `$05FD`, one byte past where every round since fix 5 has been
counting the chain's own end, meaning the real count was always **94 bytes, ending `$05FD`, 2 free
to `$05FF`** — a genuine, long-standing miscount surfaced only by the fix-8 brief's own explicit
instruction to re-derive it, not a fix-8 regression. This round's own additions (decision A's two
accumulators, decision B's ten dialogue bytes, and finding 3's `sw_banked_stream_start_col`/`row` +
`sw_strip_fetch_run_col`/`row`) use **zero** of the `$05A0-$05FF` gap's own two remaining free bytes
— finding 3's new routines reuse `sw_ss_sc`/`sw_ss_lc`/`sw_ss_sr`/`sw_ss_lr`, `sw_probe_row_screen`/
`local`, `sw_probe_col_screen`/`local`, `ss_i`, `sw_tmp`/`sw_tmp2`/`sw_tmp3`, `sw_run_off`/
`sw_run_len` and `sw_caller_bank` — every one an existing byte, none newly allocated, since the
arming loop's own bookkeeping needs nothing that must outlive the identical bounds the mainline
version already respects. **Instead, decisions A and B use two OTHER real, already-documented free
RAM blocks this prototype had never touched before fix round 7**: `engine/constants.asm:670-676`'s
own confirmed-free `$03D8-$03E3` (12 bytes, held `bt_line`, which turned out never to be needed) and
`:759`'s own `$035C-$035F` (4 bytes) — real, existing, unclaimed engine RAM, not a new chain
requiring its own accounting gap. Zero page is unchanged: twelve bytes ending `sw_ns_chunk=$C6`, 57
free.

**Fix round 11 (Part C, review 8's "axis-owner RAM" disposition): `sw_axis_pref` assigned to `$C7`,
zero page now 58 bytes used ending `$C7`, 56 free.** Review 8 confirmed `$C7` genuinely free
(`engine/constants.asm`'s own real equate table has no entry there — `BT_PARTY_X` is the next used
byte, at `$C8`, an RPG-only battle-table field this design's own action-only fixtures never touch,
so `$C7` is the one and only free byte before the next real allocation). `sw_axis_pref` needs no
further RAM: it is a single byte, `0` = X owns input, `1` = Y owns input, written only by
`sw_axis_arbitrate` (specified, §10 Decision 1 proof 2 — not built this round, engine/input.asm's own
scope). No other Part A/B mechanism in this round needs a new byte: the mixed-vblank threshold
(`MIXED_VBLANK_MAX_BYTES`) is a compile-time equate, not RAM, and the scheduler's own signed
desired/current window origin reuses the fields this design already carries
(`win_col_screen/local`/`win_row_screen/local`, §5 above) — proven by the fixture in Part A never
needing a new zero-page symbol (Appendix B, Round 11) and confirmed by `check_r10_symbol_ranges.mjs`
re-run this round (below) still reporting no growth in the resident set's own symbol count beyond the
two new routines named there.

**The complete RAM map, rewritten wholesale this round (fix round 7) — every byte in the
`$03D8-$03E3` gap is reassigned, not merely appended to**:

| Bytes | Field | Address | Owner |
|---|---|---|---|
| 4 | `sw_cam_origin_x_lo/hi`, `sw_cam_origin_y_lo/hi` — the camera's own world-space origin, `sw_project_axis`'s second argument | `$035C-$035F` | finding 5 (fix round 5), unchanged this round |
| 2 | `sw_walk_acc_x`, `sw_walk_acc_y` — decision A's own per-axis subpixel accumulators (`sw_walk_step_x/y`) | `$03D8-$03D9` | decision A, this round — reuses the byte `sw_move_gate` (RETIRED) freed |
| 2 | `sw_dlg_cam_x_lo`, `sw_dlg_cam_y_lo` — decision B's own pre-nudge camera snapshot | `$03DA-$03DB` | decision B, this round — replaces the RETIRED 4-byte `sw_dlg_win_col_screen/local`, `sw_dlg_win_row_screen/local` (the old snap-window/full-redraw transaction no longer exists) |
| 8 | `sw_dlg_ocol/olcol/orow/olrow` (persistent box origin) + `sw_dlg_rbrow/rscol/rlcol/rlrow` (transient resolve scratch) — `sw_dlg_metatile`'s own working set | `$03DC-$03E3` | decision B, this round |

**Fix round 5/6's own `sw_move_gate`/`sw_dlg_win_col_screen/local`/`sw_dlg_win_row_screen/local`
are RETIRED, not merely renamed** — decision A replaced the one-in-three schedule counter with two
accumulators (a genuinely different mechanism, not a resize of the same field), and decision B's
camera-nudge transaction never moves the window/torus at all, so there is no window origin left to
save. No new "active" flag is needed for the dialogue save state — `game_state`/`box_state`
(existing engine RAM) already say whether a dialogue is open. **All 12 bytes of the `$03D8-$03E3`
gap are now used** (was 9 of 16 across two blocks, fix round 6) — 0 remain free in this specific
gap; §9's own broader kernel-lo/placement decomposition (finding 7) is not re-measured this round
(still fix round 6's own figures below, flagged as such), so whether a real project's own full
kernel-lo build still fits is not re-proven here.

**One mutually-exclusive resident/banked/table/debug/trampoline budget, with real byte totals per
category (review 5, finding 9's own final demand — categories and locations alone were not
enough)**:

**REPLACED this round (fix round 8, finding 7) — every row below is a real symbol-span
decomposition, measured from `minimal-u512/build/main.fns` directly (`addr[next label] -
addr[this one]`), not the old indirect `8192-653` subtraction.** The orchestrator's own cited
example (`sw_nmi_stream=$C8F0..sw_render_window=$CA66`, 374 bytes) is reproduced here from the
CURRENT build's own addresses (which have shifted since whatever measurement that cited — this
round's own additions moved everything after `sw_goto`) — the identical **374-byte span**, exactly,
confirming the decomposition method against an independently-cited figure rather than merely
asserting a new number:

| Category | Contents | Real bytes (`minimal-u512`, this round) | Where it lives |
|---|---|---:|---|
| Switch primitives | `sw_goto`→`sw_read_run_done` (`sw_goto`/`sw_locate_current`/`sw_peek_byte`/`sw_terrain_or_fill`/`sw_read_transaction`/`sw_read_run`) | **233** | Kernel-lo, cannot ever be banked (this section's own argument above) |
| Projection | `sw_project_axis` (+ `sw_project_visible`/`sw_project_hide`) | **47** | Kernel-lo |
| Decision A accumulators | `sw_walk_step_x`/`sw_walk_step_y` (new this round's predecessor, fix round 7) | **32** | Kernel-lo |
| Window clamps | `sw_clamp_col`/`sw_clamp_row` | **80** | Kernel-lo |
| Ring crossings | `sw_cross_right`/`left`/`up`/`down` | **144** | Kernel-lo |
| Strip starters (mainline) | `sw_stream_start_col`/`row` | **345** | Kernel-lo today; `sw_banked_stream_start_col`/`row` (finding 3, this round) is the SAME job, resident in bank 14 instead — see below |
| NMI draw chain | `sw_nmi_stream`/`sw_ns_draw_block`/`sw_ns_draw_attr` | **374** (reproduces the orchestrator's own cited figure exactly, fresh addresses) | Kernel-lo, every board, unconditionally — this is the one row that genuinely cannot move; NMI code must be reachable with no bank switch in flight |
| Full renderer | `sw_render_window` + all `sw_rw_*` helpers and lookup tables | **646** | Kernel-lo today; decision B's own dialogue close needs it, mainline-only, never called from a banked context |
| **Subtotal, `sw_goto` through the end of `sw_render_window`** | | **1,901** | — matches the OLD indirect estimate's own "~1,900" almost exactly, once summed for real: the old METHOD was rightly criticized (an indirect subtraction, not a decomposition), but its own final NUMBER turns out to have been close regardless — worth stating plainly rather than implying the estimate was also numerically wrong |
| Finding 3's own new primitive | `sw_strip_fetch_run_col`/`row` (+ `sw_sfr_body`/`sw_sfr_finish`) | **72** | Kernel-lo, **mandatory placement** — proven by a real crash this round (its own header comment), not a choice |
| Finding 3's own new arm | `sw_banked_stream_start_col`/`row` | **137 + ~137 ≈ 274** | Bank 14 in this round's own proof (`minimal-u512-fs3`) — genuinely bankable, since it only ever `jsr`s into kernel-lo primitives and gets a clean `rts` back with its own bank restored |
| Decision B's own accessor | `sw_dlg_metatile` | **87** | Bank 14 in this round's own proof — same reasoning as the arm above (never itself executes underneath a live PRG switch) |
| Banked (RPG only, unrelated to streaming) | The RPG battle system (`engine/battle.asm`+`battleui.asm`+`battleturn.asm`) | Its own existing 8 KB region | `codeRegionCount=1` |
| Table (generated, per-map/per-screen) | The streamed per-map range/state table (finding 4, this round: 6 bytes/map now, not 14 — tileset+fill+locator) plus the existing ordinary columns (13/screen, 9/map) for non-streamed content | Sized by `kernelTableBytes`' own per-map branch (finding 4), not yet implemented | Kernel-lo |
| Debug (prototype only, never ships) | `sw_debug_addrs`/`sw_debug_addrs2`/`sw_debug_chunk`, `sw_run_bank_test`/`sw_run_bank_test_fingerprint` | Excluded from every figure above (measured off `minimal-u512-fs3`, which removes the three debug tables entirely, and off `minimal-u512` itself, whose own kernel-lo spans above never include bank-14 content) | Never shipped |
| Trampoline (not yet built, not yet needed) | A `call_battle`-style cross-bank entry/exit for a REAL banked caller of finding 3's own arm — only needed once a real project actually places `sw_banked_stream_start_col`/`row` in a switchable bank, not built this round | 0 (nothing to reach yet) | Unbuilt |

**The real, honest per-fixture margin, stated plainly (finding 7's own explicit demand: "if the
streamed feature cannot fit kernel-lo on a content-bearing project on some board, that is a finding
to report with numbers, not to defer").** The mandatory kernel-lo subtotal is **1,901 + 72 (finding
3's own new primitive, which cannot be banked) = 1,973 bytes**, before a single project-specific
table byte or any of the engine's own OTHER conditional features (Move/Turn/Wait/Fade/Flash/Sting/
Sfx/naming/battle, all separately charged in "The kernel budget," CLAUDE.md) are added. Measured
directly against `minimal-u512`'s own stripped baseline: this fixture, which starts from a near-
empty project, could fit 1,973 bytes of streaming-only resident code alongside its own baseline
kernel — but this round's own attempt to add JUST the 72-byte primitive (§3) already overflowed it
by enough that even reverting `CAMERA_ENABLED` and removing three debug-only tables (98 combined
bytes reclaimed) was needed to fit 8,164 of 8,192 bytes, 28 free. **A real, content-bearing project
(more screens, more actors, more of the engine's OTHER conditional features already resident) has
LESS baseline headroom than this stripped fixture, not more** — the placement crisis fix round 6
first named is not resolved by this round's own work; it is now measured precisely enough to say
exactly how tight it is, which is what finding 7 asked for.

**Round 9: the crisis has a real answer — kernel-hi, not kernel-lo.** `$E000-$FFFF` (kernel-hi:
compiled music, sfx, text, then the CPU vectors, CLAUDE.md's own PRG layout section) is PART OF THE
SAME FIXED KERNEL as `$C000-$DFFF` (kernel-lo) — both are permanently mapped on every supported
mapper, simultaneously, with no bank switch between them, so an ordinary `jsr`/`jmp` reaches either
from either with no trampoline, no cross-bank return-address hazard, and none of finding 3's own
"cannot live in a switchable bank" crash risk (that risk is specific to a GENUINELY switchable
bank, like bank 14's own test slot — kernel-hi is not one). Measured directly, both fixtures'
CURRENT kernel-hi occupancy (`main/build/generate.js`'s own existing `musicBytes + sfxBytes +
text.bytes > BANK_SIZE - 64` check, unchanged): kernel-hi free bytes on the same five real fixtures
finding 7's own kernel-lo figures used — sample 7,530; sample-rpg 7,815; sample-u512 7,844;
sample-mmc3 7,817; sample-mmc1 7,849 — **the mirror image of kernel-lo's own 1,024-1,724 free**. The
design document never mentioned this bank at all before this round.

**Proven in the scratch tree, `minimal-u512`, not merely argued.** Before: `nesasm -s main.asm` on
the unmodified board reports `BANK 62 (kernel-lo) 8146/46` (46 free) and `BANK 63 (kernel-hi)
329/7863` (7,863 free) — `CAMERA_ENABLED=1` and all three debug-only tables present, the carryover's
own explicit precondition. Relocating `streamworld.asm`'s own include line from inside
`assets/kernel_lo.inc`'s block to after `assets/kernel_hi.inc`'s (and changing the file's own two
internal `.bank 62` "return to the ambient bank" restores — either side of its own bank-14
excursions for `sw_dlg_metatile` and finding 3's banked primitives — to `.bank 63`, since kernel-hi
is now the file's own home bank) and rebuilding:

```
$ nesasm -s main.asm
BANK  62                            1623/6569
BANK  63                            6529/1663
```

**Both banks fit, with real margin on each side — 6,569 bytes free in kernel-lo (was 46), 1,663 free
in kernel-hi (was 7,863) — even moving the WHOLE prototype file (≈6,200 bytes: the mandatory
1,973-byte resident set fix round 8 itemised, plus every historical/superseded/debug-only routine
nine rounds of prototyping accumulated and never pruned, none of which a real generator
implementation would emit).** This is the honest, stronger result: the crisis dissolves even
without first separating the mandatory set from the prototype's own accumulated cruft, which a real
implementation would do anyway (emitting only the named `*_KERNEL_ALLOWANCE` terms, never the
debug tables or superseded history).

**Round 9 text, SUPERSEDED by round 10 below — "not fully closed" understated it: the crash's real
cause was never an nesasm bug at all.** [Original round-9 paragraph, kept for history: functional
verification (`proto-tools/verify_torus.mjs`) FAILS against this relocated build: `main.fns` reports
`sw_stream_start_col = $0160`, a RAM-range address, not a real kernel-hi code address — nesasm
mis-resolves at least one label's own final address when a single source file's own "ambient" bank
is switched away to a second, genuinely-switchable bank (14) and back TWICE within one file, a
pattern the file's own ORIGINAL kernel-lo placement also uses (and which assembles and runs
correctly there — `verify_torus.mjs` passes on the unmodified board, confirmed before and after
this experiment, so the bug is specific to the relocated placement, not a general problem with the
file's own bank-14 excursions). The likely real fix, not attempted that round: keep the two
bank-14-targeted routines (`sw_dlg_metatile`, the finding-3 banked primitives) in their OWN separate
source file, included from bank 14's own established place in `main.asm`, rather than interleaved
inline within the resident file's own text.] **Round 10 tried exactly that fix and it worked
completely — see "Round 10: the real root cause, and a working relocation" immediately below. The
review-8 reviewer's own read of nesasm's source (`source/command.c:530-537`, `source/main.c:300-305`
— `.bank`/`.org` state is saved and restored per bank, both start at zero, so repeated `.bank 14`
excursions are supported) was correct: there was no assembler bug to find.** `minimal-u512` itself
was fully restored to its prior, passing state (`verify_torus.mjs` re-confirmed ALL PASS) before
round 9's own further work continued elsewhere; round 10 started fresh from that restored state.

**What still has to stay in kernel-lo, regardless of where the rest moves**: anything reached by a
6502 BRANCH (not `jsr`/`jmp`) from code that itself stays in kernel-lo — branches are ±128 bytes
(CLAUDE.md's own 6502-traps section), so a routine split across the two banks by a stray branch
would fail to assemble (a real, build-time-caught error, not a silent corruption, matching this
codebase's own "the assembler is the capacity check" philosophy) — meaning a clean split must move
WHOLE routines, never partial ones, exactly the constraint the file-separation fix above already
respects. NMI's own hook (`jsr sw_nmi_stream` from `boot.asm`) is an ordinary `jsr`, unaffected
either way. The Code Forge's `usercode.inc` interaction is none: it is emitted into kernel-lo
unconditionally, regardless of where streaming's own resident code lives, so a Code Forge override
of engine files is unaffected either way.

**Round 9 text, SUPERSEDED — both open questions below are answered in "Round 10" immediately
following.** [Original: the charge, once the real generator work above is done: a new, named,
conditionally-charged `STREAMING_KERNEL_HI_ALLOWANCE` term (gated on `projectUsesStreaming`, any map
with `map.streamed`), added to `generate.js`'s existing `musicBytes + sfxBytes + text.bytes >
BANK_SIZE - 64` check, sized from the real mandatory-only figure (fix round 8's own 1,973 bytes).
Whether the banked (bank-14) cold path is still needed at all, once kernel-hi holds the mandatory
set with real margin, is a real open question this round surfaces but does not answer.]

### Round 10 (review 8, finding 6): the real root cause, and a working relocation

**Root cause, found by actually splitting the file rather than guessing at the assembler.** Review
8's own reading of nesasm's source was right: `.bank`/`.org` state is per-bank and round-trips fine
across repeated excursions to the same switchable bank. The `$0160` corruption had nothing to do
with *how many times* `streamworld.asm` switched to bank 14 and back — it was that `sw_dlg_metatile`
and `sw_run_bank_test`/`sw_run_bank_test_fingerprint` (two never-shipped, bank-14-only prototype
routines, each documented in its own header as living there "purely because this prototype has
nowhere else to put the bytes") sat **interleaved inline** inside the same source file being
relocated wholesale into kernel-hi. Splitting them into their own file, `streamworld_bank14.asm`
(kept at the file's ORIGINAL kernel-lo position in `main.asm` — the ambient bank a bank-14 excursion
returns to is irrelevant to *these* routines, since neither ships), and leaving `streamworld.asm`
itself with **no `.bank` directive of any kind** made the relocation work on the first real build,
no workaround needed:

```
$ nesasm -s main.asm    (streamworld.asm's own .include moved to after
                          assets/kernel_hi.inc/music.inc/text.inc, before the vectors;
                          CAMERA_ENABLED=1, all three debug tables present, matching
                          round 9's own precondition exactly)
BANK  62 (kernel-lo)     6210/1982
BANK  63 (kernel-hi)     2265/5927

$ grep sw_stream_start_col main.fns
sw_stream_start_col              = $E35B     -- a real kernel-hi code address, not $0160
```

`proto-tools/check_r10_symbol_ranges.mjs` confirms all **112** resident labels `main.fns` resolves
for `streamworld.asm` fall inside `$E000-$FFF9` (leaving `$FFFA-$FFFF` for the vectors), with the
resident span (`$E143-$E8D2`, 1,935 bytes between first and last label) sitting entirely above
`period_lo` (music.inc's own first table, `$E000`) — no overlap. `proto-tools/verify_torus.mjs`:
**61/61 checks, ALL PASS, exit 0**, against this relocated placement — the actual functional proof
round 9 could not close. `diag_r8_unaligned_parity.mjs` (56 observations) and a renamed
`diag_r10_banked_strip.mjs` (the fix round 8 banked-strip proof, re-pointed at `minimal-u512` itself
instead of the now-unnecessary `minimal-u512-fs3`, see below) both re-pass in full, 25/25 and 56/56.

**The bank-14 cold path is not needed. Both the mandatory primitive and its arm fit directly in
kernel-lo, with real margin, once the resident set has moved out to kernel-hi — drop the extra
switchable code-region reservation from the capacity model entirely, for this feature.** Adding
`sw_strip_fetch_run_col`/`row` (fix round 8's finding-3 primitive, 73 bytes, unmodified) directly to
kernel-lo as ordinary resident code: `BANK 62 6283/1909`. Adding `sw_banked_stream_start_col`/`row`
(the arm built on it, 275 bytes, unmodified) alongside it, also plain kernel-lo: `BANK 62 6558/1634`
— **1,634 bytes still free**, on the SAME stripped fixture that had only 46 bytes free before this
round even started. `diag_r10_banked_strip.mjs` (renamed from `diag_r8_banked_strip.mjs`, re-pointed
at `minimal-u512`) reproduces all 25 checks and the same real cycle costs fix round 8 measured
(2354/2752/2434/2839 cycles, within a handful of cycles of the originals — the small gap is ordinary
code-layout/page-crossing variance, the same kind CLAUDE.md's own review-8 finding 7 already
names), proving the banked arm's own contract (mainline/banked sbuf match exactly, caller's bank
genuinely restored) holds with everything resident. **`minimal-u512-fs3` is retired** — the separate
board fix round 8 had to invent specifically because `minimal-u512` had no kernel-lo room is no
longer needed for anything; every check that used to run against it now runs against
`minimal-u512` directly.

**The budget arithmetic for the written contract, with real numbers.** The resident set's own real
kernel-hi cost, measured with the three never-shipped debug tables removed (a real generator would
never emit them): `BANK 63` used drops from 2,265 to 2,230 (35 bytes), giving a mandatory delta of
`2,230 - 329 = 1,901` bytes — independently matching fix round 8's own byte-by-byte symbol-span
decomposition (`sw_goto` through the end of `sw_render_window`, table above) to the byte. **A named
`STREAMWORLD_KERNEL_HI_ALLOWANCE = 1,901`** (not fix round 8's own provisional 1,973 — that figure
double-charged the 72-byte finding-3 primitive against kernel-hi, when this round proves it belongs
in kernel-lo instead) joins `generate.js`'s existing check as:

```
musicBytes + sfxBytes + text.bytes + STREAMWORLD_KERNEL_HI_ALLOWANCE > BANK_SIZE - 64
```

gated on `projectUsesStreaming` (any map with `map.streamed`), named by the Sound Forge or Map Forge
exactly as the existing check already picks between the two. The largest music+sfx+text payload a
streamed project can carry becomes `8,128 - 1,901 = 6,227` bytes (not the reviewer's own cited 6,155
— that number was built on the same double-charged 1,973 figure this round corrects). `sw_strip_fetch_run_col`/`row`
and `sw_banked_stream_start_col`/`row`, now proven plain kernel-lo, are NOT charged here at all —
they join kernel-lo's own existing named-allowance accounting instead (a `STREAM_BANKED_ALLOWANCE ≈
348` bytes, measured, `73 + 275`), and only if a real banked caller ever needs them — no such caller
exists yet in this design (the arm's whole reason to exist is a caller resident in a switchable
bank, which no shipped feature currently is), so this term is conditional on that caller's own
future gate, not on `map.streamed` alone.

**Finding 7's own two remaining defects, fixed and re-measured.** (1) Both "hot" Mesen boards
(`sample-u512`, `sample-mmc3`) had `SW_STREAM_CHUNK = 1` as their own checked-in default, with a
comment saying 3 was "patched in at build time, never the checked-in default" — backwards from
decision A's own actual choice. Fixed: `SW_STREAM_CHUNK = 3` is now the checked-in default on both
boards; `build_arb_fixtures.mjs`/`build_f9_worst_chunk_fixture.mjs`'s own patch-and-restore
machinery is unaffected (it already patches to whatever value a run asks for and restores the
original afterward, so flipping the original from 1 to 3 needed no script change). (2)
`build_f9_worst_chunk_fixture.mjs`'s own MMC3 detection, `/SPLIT_ENABLED\s*=\s*1/.test(constantsText)`,
tested the wrong file — `SPLIT_ENABLED` is a generated flag in `assets/config.inc`, never restated as
text in `constants.asm` — so the regex could never match on EITHER board, and the MMC3 fixture never
actually forced `split_mode`/`box_state` into `split_arm_go`'s own longer path via its own "belt and
braces" direct poke (the `box_state` poke alone still drove `split_select`'s own per-frame
recomputation correctly, per CLAUDE.md's "the split follows state, not events," which is why the
prior round's own cycle counts turned out numerically unaffected — confirmed by re-running with the
fix in place). Fixed to read `assets/config.inc`; the harness now also asserts `SHAKE_ENABLED = 1`
in that same file before claiming the fixture's own "shake active" label is true.

**Real Mesen timing, relocated placement, `SHAKE_ENABLED = 1` genuinely compiled AND exercised, the
fixed MMC3 detection, chunk 3 vs. chunk 4** (`proto-tools/build_f9_worst_chunk_fixture.mjs`, worst
configuration unchanged from fix round 9: row strip, odd parity, `st_vary` starting at 29,
non-final):

```
sample-u512,  chunk 3: nmi_rti at scanline 259, cycle 38  -- margin ~208.7 cycles (626 dots), exit 0
sample-mmc3,  chunk 3: nmi_rti at scanline 259, cycle 235 -- margin ~143.0 cycles (429 dots), exit 0
                        ("...split forced to SPL_BOX" now genuinely printed, detection fixed)
sample-u512,  chunk 4: nmi_rti at scanline 0,   cycle 317 -- EXIT_DEADLINE_MISS (5)
sample-mmc3,  chunk 4: nmi_rti at scanline 1,   cycle 176 -- EXIT_DEADLINE_MISS (5)
```

Both boards still finish chunk 3 comfortably inside vblank with Shake's own longer composed path
genuinely running (not merely compiled), and chunk 4 still misses badly on both — the margins are
smaller than fix round 9's own un-exercised figures (237.7→208.7 on U512, 180.0→143.0 on MMC3, the
real cost of Shake's own composed-scroll branch actually executing), but both remain solidly
positive. `build_arb_fixtures.mjs`'s own chunk-3/chunk-4 strip-only and arbitration(both) fixtures
were re-run against the same relocated, Shake-on boards: chunk 3 exit 0 on both (strip-only and
arbitration), chunk 4 exit 5 (strip-only, the real negative control) / exit 0 (arbitration — the
drain wins, the strip yields entirely, exactly decision A's own arbitration contract) — unchanged
from before Shake was turned on, confirming Shake's own composed path does not disturb the
arbitration boundary itself.

### R16 — bound tiles: a validated authoring restriction on streamed maps, not a flip-sync design

**Decided this round, not designed to the mechanism level — the restriction option R16's own
finding explicitly allows.** `sw_stream_start_col`/`row`/`sw_render_window` all read raw
`[mtptr_lo],y` metatile ids directly off a screen's own terrain bytes, with no
`bound_tile_lookup` pass (`engine/screens.asm:52,72,149,169` is where that lookup happens for
ordinary, non-streamed drawing) — meaning a switch-bound tile's own *current* variant is invisible
to every streaming read this design has built or designed: the entering edge of an incoming strip,
a full `sw_render_window` redraw, and `sw_peek_byte`'s own neighbour peek (§5/R8) would all show a
bound tile's **base**, unflipped id, never whichever variant a Flash edge or a switch last selected
— on the ordinary, current screen, on a screen that has scrolled off-window but not yet
re-entered, and on a probed neighbour alike. Making this correct needs, at minimum: resolving the
bound variant at every one of those three read sites (not just the current-screen collision cache
`rebuild_bound_cache` already handles), and defining what a flip does to content **already drawn
into a physical nametable and its `attr_shadow` mirror** while the camera has moved past it —
neither of which this design has designed this round, and neither of which fix round 2 designed
either (R16 there was "not addressed... carried forward," and this round did not pick it up as
new build work, prioritising R2/R4/R5/R7's own real, closable gaps instead).

**Recommendation: a streamed map may not use switch-bound tiles, enforced by `validateProject`,
until a real flip-synchronisation design exists.** This is the honest, narrower alternative R16's
own finding names — "make bound tiles a validated restriction on streamed maps, or stop allocating
binding bytes for them and implying compatibility" — and this document takes the restriction, not
the implication. **The 338-byte record (§5, R6) still allocates the full `BOUND_CAP=8`/3-bytes-each
bound-tile-list bytes per screen** — that allocation is not retracted (it costs nothing to keep,
since PRG space is not the scarce resource here, §5/R6's own argument), even though finding 5 (§5)
retracted the *separate* claim that streamed and ordinary screens share one record format — the
338-byte streamed record still reserves the bytes on its own account, independent of what the
ordinary format does. The restriction is therefore: **a streamed map's own screens may not *place*
a bound-tile binding** (the count byte stays 0), not a schema change — `validateProject` refuses a
streamed map with a nonzero bound-tile count on any of its own screens, naming the Map Forge and the
specific screen, the same shape every other capacity/content refusal in this codebase already takes.

**Finding 15's own mixed-map lifecycle gap — the entry-time clear (below) is real and kept, but
"genuinely inert" was retracted by review 5's own finding 12, and the real fix lives in §4/R10
now, not here.** The authoring restriction alone does not clear a **different**, ordinary map's own
live bound-tile state when a mixed project's player enters a streamed map through it —
`rebuild_bound_cache` (`engine/screens.asm:303-336`), `flip_tick` (`engine/entities.asm:1096-1121`)
and `clear_text_state` (`engine/text.asm:103-105`) are none of them streamed-aware, so the
transition into a streamed map must explicitly zero `bind_count`/`flip_pending_count` at entry, or a
flip armed on the screen just left keeps draining. **That entry-time clear is kept, unchanged.**
**What is retracted**: this clear does **not**, by itself, make `rebuild_bound_cache` "genuinely
inert" — `rebuild_bound_cache` reads `screen_bound_lo/hi` **by `flat_screen`, unconditionally**, and
those are exactly the ordinary-only pointer columns finding 3/6 (§5) removes for a streamed screen;
zeroing `bind_count` once at entry does not stop a *later* rebuild (any subsequent call reached
while the streamed map is still current) from attempting to index a table that was never sized for
a streamed screen at all. The real fix — a streamed guard/zero-record accessor at `rebuild_bound_cache`
and every later rebuild path, keyed on the map-type bit finding 3/6 already specifies — is in
§4/R10, above, not duplicated here. This document's own author-visible restriction (no switch-bound
puzzle mechanics on a streamed map) and its own place in §10's Chris-facing list are both unchanged
by this correction.

## 6. Q7 — the Map Forge and world overview

Content carried from round 1, confirmed unrevised by review 2 itself — the review's own quote ("The
Test routing described in §7 correctly reuses the existing warp handshake," finding on the record's
maximum-count/sentinel cases) is about a *different* passage (R6, §5 above); nothing in review 2
disputes what follows, so it is reproduced rather than pointed at.

**Minimum to make a streamed map authorable**: a "Streamed" checkbox on the map's own properties
(visible only when `streamCapable` — the same `isForgeAvailable`-style gating precedent), which
replaces `growOrShrinkMap`'s `LIMITS.mapGrid` read with the new streamed ceiling for that one map;
`remapScreenReferences`/`saveCompatToken` per §5's Q6 gating above. `design-maporg.md`'s own §12 world
overview stops being optional the moment a map can hold 100+ screens — the existing screen-by-screen
picker (item 7's own grid) is not usable at that scale; this design treats §12 as a **required**
Q7 deliverable, not the "natural companion" ROADMAP item 15's own text called it, because there is no
other way to see or navigate a streamed map's own layout once it exceeds a handful of screens.

**▶ Test (decision 4, restored — review 3 finding 11): goes through the existing warp handshake,
never a direct `sw_*` poke from the renderer.** Fix round 3's own recommendation here — poke
`sw_col`/`sw_row`/`sw_col_rem`/`sw_col_region`/`sw_col_byte_lo/hi`/`sw_row_bank_base` directly from
`testplay.js` — is **retracted**: it reaches past the engine's own single warp-entry initialiser
(§5/R12's own "one initialiser" rule — Continue, a warp's `warp_scr`, a door's `ent_to_scr`, and
▶ Test all resolve identically) to poke internal addressing state the renderer has no business
touching directly, and would silently diverge from whatever that initialiser does the moment it is
built (two independent places deciding "how do I land on a streamed screen," CLAUDE.md's own
recurring failure shape). **The correct, unchanged design**: `testplay.js` pokes `warp_scr`/
`warp_x`/`warp_y` exactly as it does for an ordinary map today (`renderer/emulator/testplay.js:
12-44`'s own existing warp poke, confirmed unchanged), and the engine's own warp-entry initialiser
— once built, §5/R12/§9 phase 4 — does the `sw_goto`-style resolution internally, the identical
path a real door or warp command already takes. ▶ Test needs **no new poke surface at all**; it is
a genuine zero-cost inheritance once the warp-entry initialiser exists, exactly as fix round 3's own
predecessor (round 2) originally and correctly said before fix round 3 reversed it.

**Deferred, explicitly**: per-screen editing UI inside a streamed map is unchanged from today's
metatile painter (Chris's own decision #1 is satisfied with no UI work at all — a streamed screen
looks and edits identically to a non-streamed one); the world overview's own **richer**
click-to-navigate interaction, its rendering of warps/entry events on a 100+-screen canvas, and any
zoomed-out thumbnail rendering are all `design-maporg.md` §12's own scope, not re-designed here — a
**minimum** click-to-select grid, sufficient to make a streamed map navigable at all before §12's
own fuller design lands, is committed to phase 4 (§9, review 4 finding 13).

## 7. What could go wrong

Carried from round 2 (the `main.nes`/`game.nes` trap, the DMA-prologue conflation, the Lua sandbox's
`io.open` crash, the region-pairing off-by-one, the mirroring-vs-addressing-bug confusion), plus, new
this round:

13. **`nes.ppu.vramMem`'s own indexing convention (raw address, not offset) is easy to get wrong
    silently** — every content assertion in this round's own first verification attempt failed, and
    the natural first hypothesis (a bug in the addressing code) was wrong; the real cause was found
    only by instrumenting the PPU's own write function directly, which is the reliable way to settle
    "is the CPU writing the right thing" independent of how the test itself reads it back.
14. **A routine that makes many cold-path calls can legitimately need far more emulated steps than a
    generic call-isolation helper's own default ceiling assumes** — `sw_render_window`'s own
    ~210,000-step cost is real, not a bug, and a step-limited test harness needs to know the
    difference between "this routine is broken" and "this routine is just expensive," or it will
    misreport the former when the truth is the latter.
15. **An isolated, single-call test and a full-trace, call-by-call test can each report the *correct*
    intermediate result while the *final* stored value is still wrong for a reason neither level of
    testing was looking at** — fix round 2's own R2 skip-logic discrepancy (§3) turned out to be
    exactly this shape, resolved this round: both the isolated call and the traced integrated call
    correctly reported `A=0` at the moment `sw_rw_attr_bl`/`br` returned (they were never the bug),
    while the *actual* bug was in a *different* quadrant (TL/TR) that neither the isolated nor the
    traced test was checking, because nothing about R2's own original bug (the missing
    `adc sw_rw_base_row`) pointed at TL/TR at all. The fix (§3, R2) needed a third technique this
    round did add: an instruction-level write-watch on the exact target address, which surfaced the
    real culprit's own PC and revealed it was a completely different code path than either prior
    test had instrumented.
16. **`nes.mmap.write` never fires for RAM addresses below `$2000`.** A write-watch built by
    patching `nes.mmap.write` silently observed zero writes to a target address the CPU
    demonstrably did write to (confirmed by the final memory value) — because the CPU's own
    `write()` (`renderer/emulator/core/cpu.js:2422-2440`) stores directly into `this.mem[addr &
    0x7ff]` for addresses under `$2000`, never calling `mmap.write` at all. The same asymmetry holds
    for reads (`nes.mmap.load` vs. `nes.cpu.loadFromCartridge`, trap 4 above) — anyone instrumenting
    this jsnes fork from outside the CPU needs to patch `cpu.write`/use `cpu.loadFromCartridge`, not
    the mapper's own methods, for anything touching low RAM or PRG-space reads respectively.
17. **A jsnes ROM needs a few real frames of boot before any hand-poked routine call means
    anything, on a board with mapper/CHR-RAM state `reset` establishes.** Skipping `freshNes()`'s
    own five-frame run-up (a comment already present in `verify_torus.mjs`, easy to miss when
    writing a *new*, standalone diagnostic script rather than reusing the shared helper) produces
    open-bus reads (255) that look exactly like an addressing bug, on UNROM 512 specifically (its
    own mapper register and CHR-RAM streaming state have no reset-independent default).
18. **A register transfer instruction is also a register *clobber* instruction, and "stash this
    value" is not free of side effects just because it looks like bookkeeping.** `tya` to save `Y`
    across a call silently destroyed `A`, which the very next instruction's own callee needed as an
    argument — the routine did not crash or hang, it ran to completion and returned a
    plausible-looking wrong answer, the same "no error, no crash, just wrong" shape as an unprefixed
    zero-page operand or a tya/txa loop-carried-value clobber CLAUDE.md's own traps section already
    warns about, here applied to an argument register rather than a loop-carried accumulator.
19. **CORRECTED by review 3 (finding 10) — fix round 3's own item 19 here was itself wrong, kept
    for the record with the correction inline rather than deleted.** Fix round 3 wrote: "this
    engine's own `main_loop` has no `wait_vblank` call in its own steady-state path at all... NMI is
    a genuinely asynchronous hardware interrupt here, capable of landing anywhere in `main_loop`'s
    own software path." **False** — `engine/boot.asm:114-115` is literally `main_loop: jsr
    wait_vblank`, syncing the loop to vblank at its own top every iteration. The real trap, stated
    correctly this round: a diagnostic that observed "`nmi_rti` fired before `main_loop_ready` was
    reached" (real, reproducible, across 200 frames) is consistent with *either* "no sync exists" or
    "arming happened at a point in the synced loop that targets the wrong upcoming NMI" — and the
    natural first hypothesis (no sync) turned out to be the wrong one, findable only by actually
    reading `boot.asm`'s own source rather than reasoning backward from the symptom alone. The
    actual mechanism: arming at `main_loop`'s own top pokes state before `wait_vblank` consumes the
    upcoming vblank, so that imminent NMI fires while the CPU is still inside `wait_vblank`'s own
    spin loop, one full iteration before the workload is actually finished at `main_loop_ready`.
    Arming at `main_loop_ready`'s own exec — the literal last mainline instruction before the
    frame's own NMI — removes the race for the *correct* reason, the identical fix
    `flash_nmi_timing.lua.template` already uses for its own `FLASH_LEFT` arm, for the identical
    reason. **The general lesson this correction adds**: when a diagnostic symptom has more than one
    possible cause, reading the actual source to distinguish them is not optional, even when the
    *fix* derived from the wrong cause happens to still work.

## 8. Test plan

Carried from round 2's own list, corrected for R15's own findings (samples now counted and asserted,
addresses derived from `main.fns` rather than literals wherever `.fns` actually emits them — RAM
equates still require hand-resolution, disclosed each time, since nesasm's own `-s` dump never emits
them, confirmed again this round), plus:

- **The retention test** (T3, built and passing this round): catches exactly the round 1/2 defect —
  a physical-position computation tied to window-relative offset rather than world-absolute
  coordinate, which a single-shot full-redraw test structurally cannot see.
- **The reversal test** (T4/T5, built and passing): catches an asymmetric crossing implementation
  (a `sw_cross_left` that does not correctly mirror `sw_cross_right`'s own effect) that a
  one-directional test would never exercise.
- **The negative-control test** (T6, built and passing): catches a test suite that would report
  success on a non-streaming (`sw_nmi_stream` never called) or always-yielding implementation — the
  precise category of gap review 2 finding 15 named in round 2's own harness.
- **The R2 skip-logic test — built and passing this round**: the taller (2×3-screen) fixture plus
  the two existing `cell(7,0) BL/BR skipped` assertions now catch exactly the defect a too-small
  fixture could not — a TL/TR read that silently reaches past the fixture's own populated screens.
  Kept as a named test-quality lesson (§7, item 15): the fix was widening what the fixture covers,
  not adding a new assertion.
- **A full hardware-timed NMI deadline test — built and run this round (R4, Appendix B)**: asserts
  at `rti`, with the worst-case `vram_buf` fixture genuinely present, on both the four-screen UNROM
  512 fixture and MMC3 with the split live. Result: `SW_STREAM_CHUNK=3` fails (`exit 5`, both
  boards); `SW_STREAM_CHUNK=1` passes (`exit 0`, both boards, ~1 scanline of margin); a chunk=3
  negative control on the identical harness fails as required. This is the concrete phase-2
  acceptance gate for whatever chunk policy ships, and it now has a real result: chunk=1 is the
  gate's own answer, not merely its target. **SUPERSEDED (fix round 7)**: this test's own workload
  (drain and chunk unconditional in the same vblank) is now known to be the WRONG acceptance gate —
  decision A's real production NMI never runs both in the same vblank at all
  (`proto-tools/build_arb_fixtures.mjs`, both `sw_nmi_arb_striponly.lua`/`sw_nmi_arb_both.lua`,
  exit 0 on both boards at chunk 3); this historical result is kept as the "why arbitration exists"
  negative control, not as the phase-2 acceptance gate any more.
- **`sw_peek_byte`'s own resident-transaction test — built and passing this round (T7, R5)**:
  catches a peek that reads the *current* screen instead of the requested neighbour (the `tya`
  register-clobber bug this round's own first draft had), a peek that never restores the caller's
  screen, and a peek that restores a byte-identical-looking pointer that is not actually readable
  (the scratch-byte-collision bug this round's own first draft also had) — three real, distinct
  wrong implementations, each one this single test would have failed to catch if it checked only
  one of "right neighbour byte," "restored pointer value," or "restored pointer is live."
- **A save-mid-strip test and a menu-during-strip test** (R11, named, not built): must confirm the
  flash-save resync runs inside the render-disabled transaction and that `sw_nmi_stream`'s own
  (not-yet-built) pause gate actually stops writing when a menu opens.
- **A boundary-probe test** (R8, named, not built): once a straddling-collision design is actually
  wired into `player_hazard`/`entity_contact`, a test must probe within 12 pixels of a streamed
  screen's own right/bottom edge and confirm the read comes from the *neighbour* screen's own
  terrain, not a wrapped same-screen index — the exact failure mode `probe_type`'s own `(probe_y &
  $F0) + (probe_x >> 4)` formula produces today with no streamed-map awareness at all.

## 9. Phasing

Five phases, restored in full this round (fix round 2's own rewrite compressed this section to a
one-line pointer, in violation of the ground rule against shrinking a section without saying what
left and why — there was no such disclosure, so the content is reproduced here in full rather than
re-derived from scratch, matching fix round 1's own original text). Each phase is independently
shippable and **ROM-neutral off**: a project that never sets `map.streamed` assembles
byte-for-byte identical to today, on every phase, all the way through phase 5 — the same discipline
every other conditional feature in this codebase already holds to (CLAUDE.md's own kernel-budget
section: "a project never using a feature assembles byte-for-byte as if it didn't exist").

**Phase 1 — world model, generator, capacity; no engine change.** `map.streamed` (the schema field,
§5/Q6), the new grid ceiling beyond `LIMITS.mapGrid=4`, `reconcileCartridge`'s new downgrade job and
`validateProject`'s own new refusals (a streamed map over the grid cap, on a board that cannot
stream, past the 255-screen ceiling — R12, resolved this round), `saveCompatToken` wiring for the
structural-edit case (R12). **Phase 1 refuses a `map.streamed=true` build outright until a real
consumer exists in a later phase** — a hand-edited or round-tripped project carrying the flag with
no engine support must fail the build with a named error, not silently assemble old-shaped records
for an engine that cannot read them. Provable by the six-fixture SHA-256 hash (none of the six ever
sets `map.streamed`, so their own bytes cannot move) plus schema/capacity unit tests asserting the
new refusals fire and nothing else changes. **What fix rounds 1-2 changed about this phase**:
nothing structural — the phase's own scope (schema, capacity, refusal, no engine) has been stable
since round 1; what changed is the *ceiling* itself (255, not 256, resolved this round, R12) and the
record shape the capacity math must charge (338 bytes uncapped, not the round-1/2 256-byte
prototype, R6).

**Phase 2 — the UNROM 512 four-screen streaming consumer, hardened.** Both axes, all four
directions (`sw_cross_left/right/up/down`), the position-jump guard (specified in full, decision A
proof 4, this round — the lag-threshold fallback to a full `sw_render_window` resync, kept as a rare
backstop, shown unreachable by ordinary movement), `sw_render_window`
itself (built and verified this round via T1-T7), the chunk budget and yield gate — **corrected,
fix round 7**: ship `SW_STREAM_CHUNK=3` under decision A's own NMI arbitration (retracting
`SW_STREAM_CHUNK=1`, R4's own answer to the wrong, pre-arbitration workload; a variable-rate budget
reading `vram_len` is no longer needed to recover headroom, since arbitration already gives chunk 3
real proven margin) — with **the Mesen arbitration/deadline tests as this phase's own concrete
acceptance gate, updated this round** (§10 Decision 1 proof 1, `exit 0` on both boards, both
physical parities, at chunk 3; the old chunk=1 deadline test above is kept as the "why arbitration
exists" historical negative control, not the acceptance gate). `screen_fresh`'s own
corrected rule (§4/R10: ownership-changing crossings set it, camera movement alone never does) is
this phase's own highest-risk item, unchanged from fix round 2's own assessment — it touches every
existing frame-ownership consumer in the engine (hazards, encounters, `spawn_entities`, entry
events), not merely new streaming code, and is design-only going into this phase, not built. **What
fix rounds 1-2 changed about this phase**: round 1 shipped a single-nametable fragment mislabelled a
torus; fix round 1 built the real physical-row/column split but left the ring's own physical-vs-
window-relative addressing wrong; fix round 2 fixed that addressing (R1) and the attribute
initialisation (R2, now fully closed this round) — the phase's own scope has not moved, but what
"hardened" means for it has grown at every round as each layer's own defect was found only once the
layer beneath it was already fixed.

**Phase 3 — the two-nametable variant (MMC1/MMC3).** Its own addressing (a 32×15 or 16×30 ring, not
32×30 — half the physical extent, since only one axis scrolls under two-nametable mirroring), the
dead-axis refusal at authoring time (item 12's own two-nametable rule: the axis that cannot scroll
is either a hard cut or refused outright, never a slide, since a slide has no far nametable of its
own CHR bank to draw into), and this phase's own Mesen deadline proof (the four-screen check this
round built is not directly portable — a 32×15 ring's own row-15 split is `+$04`/`+$08` at
different boundaries than the four-screen case's `+$04`/`+$08` pairing, and MMC3's own font-bank
split timing interacts with a differently-shaped ring). **Not started this round** — R4's own
Mesen check was built and run on MMC3 already, but only proving the *four-screen*-shaped ring's own
timing on that board (§3), not a genuine two-nametable ring, which is this phase's own separate
addressing problem entirely.

**Phase 4 — Map Forge tooling.** The streamed toggle (gated on `streamCapable`, R14's own
per-mapper-entry predicate, not a global phase flag), the grid ceiling wired into
`growOrShrinkMap`'s own `LIMITS.mapGrid` read, the world overview from `design-maporg.md`'s own §12
— **required**, not the "natural companion" ROADMAP item 15's own text calls it, since there is no
other way to navigate a map past a handful of screens once one exists — and ▶ Test routed through
the same warp-entry initialiser every other landing site needs (R12's own "one initialiser" rule).
**A minimum navigable deliverable, committed here (review 4, finding 13)**: this phase ships, at
minimum, a **click-to-select** screen grid for a streamed map — the existing item-7 picker's own
interaction (click a cell, that screen opens in the metatile painter) extended to address a
streamed map's own computed `(screenCol, screenRow)` coordinate rather than a flat array index,
scaled to render at a size that stays usable past a handful of screens (a zoomed-out cell per
screen, not the full-size thumbnail item 7's own small grids use). The **richer** interaction
`design-maporg.md` §12 itself designs — warp/entry-event overlays, a zoomed thumbnail render,
pan/zoom past whatever fits one screen — remains that document's own scope, not redesigned here;
what this phase commits to is that a streamed map is never *unnavigable*, even before §12's own
fuller design lands. **Not started this round.**

**Phase 5 — the docs pass, blocked on a CLAUDE.md trim slice.** CLAUDE.md has **478 characters** of
budget left (136,522 of the 137,000-character limit `test/unit/docs.test.js` enforces, re-measured
this round: `fs.readFileSync('CLAUDE.md','utf8').length` = 136522, unchanged since this design's own
first round — nothing in this design's own work has touched CLAUDE.md). A dedicated trim slice
(shrinking existing prose, not this feature's own eventual entry) must land *before* this design's
own docs pass can be written into CLAUDE.md at all, the same sequencing the kernel-diet and other
past trim slices already established. **Not started, and out of scope for this design round
itself** — this document is the design; the CLAUDE.md entry summarising it is phase 5's own
deliverable, written once phases 1-4 exist to summarise honestly.

**Order and why**: 1→2→3→4→5, strictly, because phase 2 is where every genuinely hard mechanism
question (the torus, the NMI budget, frame ownership) gets answered against real hardware timing on
the *simpler* of the two board families (four-screen, one ring, no font-split interaction); phase 3
reuses phase 2's own answers to those questions rather than re-deriving them against a second,
harder addressing shape; phase 4's tooling has nothing to expose until phase 2 (or 3) gives it a
real engine to point at; phase 5 documents what shipped, not what was designed, so it cannot
precede any of the phases whose behaviour it describes.

## 10. Decided by Chris, 2026-09-17

Three decisions, settled scope from here on, not open questions — each written up to the numbers
the earlier open-question framing asked for, per the fix round 5 brief.

### Decision 1 — throughput: FALLEN STAR's own exclusive-vblank arbitration, chunk 3, 1.5 px/frame

**Chris, 2026-09-17, ~23:45 (fix round 7): the 0.333 px/frame one-in-three schedule is REJECTED.**
Verbatim: *"I want you to match the streaming from fallen star. This is something fable wrote in
another session we should just be able to reuse that streaming code and match that performance."*
20 px/s was roughly 4.5× slower than the reference implementation (`/home/chris/claude_nes_test/src/`,
`world_stream.asm`/`boot.asm`/`player.asm`/`constants.asm`). Fix round 6's own "1 is the only chunk
size measured safe" reasoning does not survive contact with the reference: that measurement
(`sw_nmi_deadline.lua.template`, the original template) always ran a `vram_buf` drain AND a strip
chunk **unconditionally in the same vblank** — never FALLEN STAR's own actual shape. FALLEN STAR's
NMI is **exclusive**: `boot.asm:239-243`, a zone-palette commit **skips that vblank's own strip
chunk** ("both in one vblank overrun into rendering"). That arbitration — not a per-frame
worst-case sum of every possible producer — is what this decision adopts, mechanically, on this
engine's own NMI, and it changes the answer completely:

| Candidate | Visible cost | Sustained-rate compatible? | Build cost | Status |
|---|---|---|---|---|
| 1. Stop/slow at a dead-zone | A firm edge of resistance the player feels as a wall | Yes, by definition | Needs a lead-distance tracker plus a resistance force | Rejected by Chris |
| 2. Lose the player | Visible corruption past the drawn edge | N/A | N/A | Never seriously proposed |
| 3. Blank-to-catch-up | A visible black/blank band during any fast run | Yes | Needs a "how far ahead is drawn" tracker plus a masking draw | Rejected by Chris |
| 4. Shorter strips | None directly — doesn't change the sustained rate | No | Real engine work for no throughput gain | Not viable |
| 5. More work per vblank on empty frames alone (no arbitration) | None when it fires; unavailable during a genuinely busy frame | Only opportunistically | Needs dynamic chunk sizing and an occupancy check | Superseded — see below |
| 6. One-in-three movement schedule at 0.333 px/frame (fix round 5/6's own chosen row) | A permanently, noticeably slower walk than Chris's own reference (20 px/s vs FALLEN STAR's 90 px/s) | Yes, by a wide margin — but the margin was the whole problem | `sw_move_tick`, one counter byte | **Rejected by Chris, fix round 7 — the numerical experience itself, not the mechanism, is what was wrong** |
| **7. FALLEN STAR's exclusive-vblank NMI arbitration + a per-axis subpixel accumulator (1.5 / 1.4375 px/frame)** | **A real but MUCH smaller restriction than decision 1's own original row 6 — walking at 96%/90% of ordinary non-streamed speed, not 22%** | **Yes — proven by real 6502 execution and a 5,000,000-frame queueing simulation, both axes (proof 2, below), not a mean-rate argument alone** | **A boot.asm splice (arbitration) + two accumulator bytes; no lead tracker, no resistance force, no dynamic chunk logic** | **Chosen** |

#### Proof 1 — the arbitration itself, Mesen, both boards, both compiled chunk sizes, both physical parities

The NMI splice (`minimal-u512/build/boot.asm`, `sample-u512/build/boot.asm`, `sample-mmc3/build/boot.asm`,
this round): where the pre-arbitration prototype had `lda vram_ready / beq nmi_scroll / jsr
vram_drain / ... / jsr sw_nmi_stream` (the strip call sat AFTER the branch target, so it only ran
in the SAME vblank as a drain — backwards from any working arbitration, and not what the fix-round-4
deadline harness had ever actually exercised as a production shape), the real fix is:

```
  lda <vram_ready
  beq nmi_no_drain
  jsr vram_drain
  .if PALETTE_FX_ENABLED
  ...                        ; unchanged
  .endif
  jmp nmi_scroll             ; the drain ran this vblank -- the strip yields
nmi_no_drain:
  jsr sw_nmi_stream          ; nothing else touched vram_buf this vblank
nmi_scroll:
```

Either the drain runs, or the strip runs — never both, in every vblank, unconditionally. This is
FALLEN STAR's own `nmi_zone_palette`-commits-skips-`nmi_stream` rule, expressed against this
engine's own `vram_ready`/`vram_drain` handshake instead of a zone-palette flag, with the identical
priority direction (the pre-existing producer wins; the strip is the one that waits, never the
reverse — a strip chunk never delays gameplay's own text/menu/Flash traffic).

**What "everything else the Forge NMI does" means, proven, not assumed**: both boards ran with
`CAMERA_ENABLED=1` (the register + NMI `$2000`/`$2005` rewrite every streamed map requires) and,
for `sample-mmc3`, `SPLIT_ENABLED=1` (`split_arm`, MMC3's own scanline-IRQ arm, runs at the very end
of the same NMI). Both assembled clean with no `.if` gaps (the RAM chains item 12's own camera
register needs are unconditionally reserved regardless of `CAMERA_ENABLED`, per CLAUDE.md's own
camera section, so flipping the flag costs no missing-symbol error).

```
$ node proto-tools/build_arb_fixtures.mjs sample-u512 <out> 3 3 even   (chunk 3, empty vram_buf queue)
$ Mesen --testRunner <out>/sw_nmi_arb_striponly.lua <out>/sw_nmi_arb.nes
exit 0 -- "the strip-only NMI finished ... inside vblank"

$ node proto-tools/build_arb_fixtures.mjs sample-mmc3 <out> 3 3 even
$ Mesen --testRunner <out>/sw_nmi_arb_striponly.lua <out>/sw_nmi_arb.nes
exit 0 -- same result, split_arm and the camera rewrite both live in the same NMI

$ node proto-tools/build_arb_fixtures.mjs sample-u512 <out> 3 3 odd     (the other physical parity)
$ node proto-tools/build_arb_fixtures.mjs sample-mmc3 <out> 3 3 odd
Mesen exit 0 on both boards, both parities
```

**Chunk 4, the real negative control this round found (not 2)** — empty queue, nothing else
running that vblank, on both boards:

```
$ node proto-tools/build_arb_fixtures.mjs sample-u512 <out> 4 4 even
$ Mesen --testRunner <out>/sw_nmi_arb_striponly.lua <out>/sw_nmi_arb.nes
exit 5 (EXIT_DEADLINE_MISS)

$ node proto-tools/build_arb_fixtures.mjs sample-mmc3 <out> 4 4 even
$ Mesen --testRunner <out>/sw_nmi_arb_striponly.lua <out>/sw_nmi_arb.nes
exit 5 (EXIT_DEADLINE_MISS)
```

3 is the real, measured ceiling on both boards — exactly FALLEN STAR's own threshold ("a miss at
4," `constants.asm:495-535`), not a coincidence: the arbitrated NMI now does structurally the same
amount of per-vblank work FALLEN STAR's own does (OAM DMA, one producer's worth of drawing, the
scroll rewrite), so the same 450-cycles/block budget applies.

**The drain-present case (arbitration holds, not merely "still fits")**, the same boards, the
worst-case 70-byte two-packet drain queued alongside an armed chunk:

```
$ node proto-tools/build_arb_fixtures.mjs sample-u512 <out> 3 3 even
$ Mesen --testRunner <out>/sw_nmi_arb_both.lua <out>/sw_nmi_arb.nes
exit 0 -- "drain-wins NMI finished ... inside vblank, strip correctly deferred"
         (vram_len drains to 0; st_cur/st_active read back UNCHANGED --
         the strip genuinely did not run, not merely "also finished")

$ node proto-tools/build_arb_fixtures.mjs sample-mmc3 <out> 3 3 odd
$ Mesen --testRunner <out>/sw_nmi_arb_both.lua <out>/sw_nmi_arb.nes
exit 0, both boards, both parities, chunk 3 and chunk 4 alike (the strip never executes at all when
a drain is queued, so its own compiled size cannot matter to that frame's timing)
```

**The historical control, kept exactly as the earlier rounds built it, run against a SEPARATE
never-shipped "unconditional" board copy** (`sw_nmi_stream` always called, drain or no drain — the
literal pre-arbitration shape) — proving the arbitration is load-bearing, not decorative:

```
$ node proto-tools/build_deadline_fixture.mjs /tmp/sw7-unconditional-u512 <out> 3 3 even
$ Mesen --testRunner <out>/sw_nmi_deadline.lua <out>/sw_nmi_deadline.nes
exit 5 (EXIT_DEADLINE_MISS) -- drain + chunk 3, unconditional, misses on UNROM 512

$ node proto-tools/build_deadline_fixture.mjs /tmp/sw7-unconditional-mmc3 <out> 3 3 even
$ Mesen --testRunner <out>/sw_nmi_deadline.lua <out>/sw_nmi_deadline.nes
exit 5 (EXIT_DEADLINE_MISS) -- same, MMC3
```

#### Proof 2 — the sustained rate genuinely closes, real 6502 execution plus a 5,000,000-frame simulation, both axes

`SW_STREAM_CHUNK=3`: a 30-block column strip is 10 vblanks; a 32-block row strip is 11 (the row
strip is bigger — 32 blocks, not 30 — because the physical ring is 32 blocks wide/30 tall, and a
COLUMN strip reads the window's own 30-block-tall column while a ROW strip reads its 32-block-wide
row; the two strip costs are genuinely asymmetric on this engine, unlike FALLEN STAR's own
identically-shaped 32×30 window whose two axes happen to need the SAME sustained speed only because
both strips are close enough in size). FALLEN STAR's own `WHOLE_STEP=1`/`SPEED_SUB=128` gives
1.5 px/frame; this design uses that figure **only on the X (column-strip) axis**:

- **`SW_SPEED_SUB_X = 128` (1.5 px/frame, FALLEN STAR's own value, unchanged)**. The worst-case
  single 16px crossing (all 256 accumulator phases, real 6502 execution) is **11 frames** — 1 frame
  of real margin over the column strip's own 10-vblank cost.
- **`SW_SPEED_SUB_Y = 112` (1.4375 px/frame — "a few percent under 1.5"), NOT 128.** At 128 the
  worst-case single vertical crossing is exactly 11 frames, **tying** the row strip's own 11-vblank
  cost with zero margin, and the MEAN crossing time (10.667 frames) is strictly *below* the 11
  vblanks needed — an unbounded deficit (review 6's own finding 1, confirmed this round by
  simulation: the position-jump resync guard fires after only **2,144 frames (~193 blocks, ~36
  seconds)** of ordinary continuous vertical walking — a real, quickly-reached failure, not a
  hypothetical one). At 112, the worst-case single crossing is **12 frames** (> 11 needed) and the
  mean is 11.130 frames (> 11 needed) — real positive margin on both measures, the identical
  "1-frame worst-case margin" shape the X axis gets.

Both proven with real assembled 6502 (`minimal-u512/build/streamworld.asm`'s own
`sw_walk_step_x`/`sw_walk_step_y`, FALLEN STAR's own `up_step_done` shape — `WHOLE_STEP` plus a
subpixel accumulator that carries one extra pixel on overflow — duplicated per axis because the two
axes need different rates here, unlike FALLEN STAR's own single shared accumulator):

```
$ node proto-tools/diag_r7_sustained_rate.mjs
ok   sw_walk_step_x's real 6502 output matches the SW_SPEED_SUB_X=128 model exactly over 4096 frames
ok   sw_walk_step_x sustained rate is exactly 1.5 px/frame (6144px / 4096f = 1.5000)
ok   sw_walk_step_y's real 6502 output matches the SW_SPEED_SUB_Y=112 model exactly over 320 frames
ok   sw_walk_step_y sustained rate is exactly 1.4375 px/frame (460px / 320f = 1.4375)
sw_walk_step_x worst-case single 16px crossing (real 6502, all 256 phases): 11 frames
sw_walk_step_y worst-case single 16px crossing (real 6502, all 256 phases): 12 frames
ok   X worst-case crossing (11 frames) beats the column strip's own 10-vblank cost, real margin 1 frame
ok   Y worst-case crossing (12 frames) beats the row strip's own 11-vblank cost, real margin 1 frame
X axis (column strip, 10 vblank): max window lag over 5,000,000 frames = 1 block(s)
Y axis (row strip, 11 vblank), SW_SPEED_SUB_Y=112: max window lag over 5,000,000 frames = 1 block(s)
ok   X axis window lag never exceeds 1 block over a 5,000,000-frame continuous walk (~23 hours held)
ok   Y axis (fixed, 112) window lag never exceeds 1 block over the same walk -- genuinely closes
UNFIXED regression (vertical at 1.5 px/frame against the 11-vblank row strip) reaches the 8-block
resync guard at frame 2144 (~35.7s of continuous walking)
ALL PASS
```

The 5,000,000-frame figure is not an arbitrary large number: it is the real periodic per-frame step
sequence (period 2 for X, period 16 for Y — both exactly rational, since the accumulator is 8-bit
add-with-carry) replayed through a queueing simulation of the strip scheduler (one strip in flight
at a time; a new strip starts the instant a block-crossing is demanded and none is in flight;
completes after exactly `stripFrames` vblanks) — a real, if compressed, stand-in for roughly 23
hours of continuously held movement in one direction, the longest any player could plausibly sustain
a single input. On both axes the window lag (demand minus completed strips, in blocks) never
exceeds 1, the same bound FALLEN STAR's own reference gets by construction.

**`SW_STREAM_CHUNK` is now 3, not 1** — fix round 6's own "1 is the only size measured safe" is
retracted; that figure was measured against the pre-arbitration NMI, which never reflects the real
production shape (either producer runs, never both).

**Diagonal rule, corrected this round: 4-way arbitration, not "forbidden."** Chris's underlying
decision (no diagonal movement on a streamed map) is unchanged; the mechanism is FALLEN STAR's own
`up_chkh` (`player.asm:26-52`), specified (not yet built this round — see §9's own disposition):
whichever axis was pressed most recently wins and masks the OTHER axis's own bits out of the held
pad state for as long as both remain held; releasing the winning axis hands ownership back to
whichever axis is still held. `sw_walk_step_x`/`y` are axis-agnostic (each only knows its own
accumulator) — this rule decides which one gets called a given frame, which is why the two never
run in the same frame and never need to coordinate.

**Knockback and scripted Move, restated against the new numbers.** Knockback
(`engine/combat.asm:292-309`, `KNOCKBACK_SPEED=3`, `KNOCKBACK_TIME=8` frames — 24px total, applied
directly via `move_up`/`move_down`/`move_left`/`move_right` with `cur_speed` set outright, bypassing
`dispatch_done`/the accumulator entirely) remains **exempt** from the accumulator gate, as decided —
but review 6's own finding 1 ("a finite individual knockback does not prove repeated hits cannot
consume available lead") is now checked, not merely asserted, against `IFRAME_TIME=60` (the
engine's own existing per-hit invincibility cooldown, the fastest a contact-damage source can
legally re-trigger knockback): a repeated-knockback simulation (an enemy re-hitting exactly on
every legal cooldown, forever, with ordinary sustained walking resuming between hits) shows the
average speed rises to **1.7 px/frame (X) / 1.646 px/frame (Y)** — both above their own axis's real
sustained ceiling (1.6 / 1.4545 px/frame) — so **sustained, repeated knockback genuinely can
diverge**, exactly what review 6 warned. This is not routine gameplay: every knockback event is
also a `lose_hearts` hit, so the same adversary landing knockback #10-17 in a row (the simulated
frame the 8-block resync guard is first reached, 9-16 seconds of continuous re-hits) has almost
certainly already ended the game on ordinary hearts before the guard would ever need to fire. The
position-jump guard (proof 4, below) is the accepted backstop for this one case — not the routine
throughput mechanism Chris rejected, but a rare, already-chaotic-looking safety net for an
authoring situation (an enemy landing every physically possible re-hit while the player keeps
walking into it) that is itself close to the edge of what the action combat model tolerates anyway.

A scripted `Move` on a streamed map is **not** exempt — `move_tick` must call through
`sw_walk_step_x`/`y` exactly as ordinary player movement does, so its own speed is capped at the
identical proven-closing rate (1.5 / 1.4375 px/frame); a scripted Move can never exhaust the window's
own margin any faster than the player's own held movement already cannot.

#### Proof 3 — yield losses (Flash bursts) are bounded, and bound-tile flips do not apply

While the player is walking, the only OTHER `vram_buf` producer that can compete with the strip is
Flash (CLAUDE.md's own "Flash is the first producer... queues on edges, not every frame") — the
frozen-world four (`move_tick`/`wait_tick`/`fade_tick`/`text_tick`) only run while the world is
frozen (no player movement, no new crossing demand, so their own vram_buf traffic cannot compound
with sustained-walking margin at all), and a live switch-bound tile's own `flip_tick` cannot
produce a packet at all on a streamed screen, because §10's own remaining-open-question 9 (unchanged
this round) still forbids switch-bound tiles on a streamed map entirely — `flip_tick` runs
unconditionally from `main_loop`, but has zero bound-tile records to act on for the current screen,
so it queues nothing while the player is on a streamed screen, regardless of what an ordinary map
elsewhere in the project has bound. **If that restriction is ever lifted, the identical math below
applies symmetrically** (a flip is also a single 32-byte-packet edge producer).

`flash_tick` (`engine/entities.asm:1126-1153`) queues exactly two 32-byte packets per burst — the
arm edge (`flash_apply_on`) and the end-of-hold edge (`fade_apply_palette`) — `FLASH_TOTAL_FRAMES=6`
apart, regardless of how long the hold lasts; every intervening frame is a plain countdown with no
`vram_buf` write. Under this decision's own arbitration, EITHER of those two edges costs the strip
exactly one lost chunk-vblank (whatever chunk was in flight simply doesn't advance that vblank).
Simulated (the same queueing model, injecting a Flash burst's own two-vblank cost at a chosen
recurrence period, 2,000,000-3,000,000 simulated frames per period):

- A single, isolated Flash burst (or bursts recurring no more often than roughly every 40 frames on
  X / 200 frames on Y — well inside ordinary, non-adversarial scripted use) costs **at most 2 blocks**
  of transient lag, comfortably inside the 8-block resync margin, and pays back down to the steady
  1-block bound within a handful of subsequent crossings.
- The precise safe-recurrence threshold, found by search: **X axis, period ≥ 32 frames (0.53s)**;
  **Y axis, period ≥ 171 frames (2.85s)** — below either threshold, lag diverges without bound over
  a sufficiently long run (the same shape as any producer sustained faster than the strip can drain
  it, true of every frame-budgeted engine, not a defect specific to this design). An author scripting
  Flash at ordinary cutscene pacing (once every few seconds at most) is comfortably inside the safe
  region on both axes; a scripted tight loop of `Flash`/`Wait 0` with no gap at all is the only way
  to reach the unsafe region, and the engine has no unconditional scripted-loop primitive to build
  one without an explicit, author-visible repeating structure.

#### Proof 4 — the position-jump guard, kept, and shown unreachable by ordinary movement

FALLEN STAR's own resync-at-lag-≥8 guard (`world_stream.asm:160-188`) is kept, specified identically
(a full forced-blank `sw_render_window` re-render, reachable only by a genuine position jump — a
warp or a debug teleport, both of which already redraw under forced blank and are not this case).
Chris rejected blank-to-catch-up as the *routine* mechanism, not as a rare backstop: proof 2 shows
ordinary held movement (no knockback) never exceeds 1 block of lag on either axis over a
5,000,000-frame simulated walk, and proof 3 shows ordinary Flash use adds at most 2 more, both far
under the 8-block threshold — so the guard is never reached by ordinary gameplay, and fires only for
a genuine jump or the adversarial repeated-knockback case proof 2 already characterises as
effectively self-limiting (the player's own hearts run out first, in the overwhelming majority of
cases).

#### Round 9 (review 7): four findings against decision A, each closed with real numbers

Review 7 found decision A's own proof 1 timed only an always-final, always-column, `st_vary=0`
chunk (finding 1), proof 2's lag model an independent-per-axis queue that cannot represent
`st_active`'s single shared server (finding 2), proof 3's Flash bound an author-visible threshold
rather than an engine guarantee (finding 3), and proof 2's own knockback disclosure a rarity
argument rather than a repayable cap (finding 4). All four are addressed below, each against real
measurements — Mesen for finding 1, a corrected discrete-event scheduler model (matching `st_active`
exactly) for findings 2-4, cross-checked against the already-proven single-axis bound before being
trusted.

**Finding 1 — the worst NON-final chunk, Mesen-timed, both boards, camera+shake+split live.** The
original proof-1 fixture (`build_arb_fixtures.mjs`) always arms `st_len = workloadLen`, so `st_cur`
reaches `st_len` on the timed chunk's own last block and `sw_ns_loop` takes the cheap
`sw_ns_finish` exit — skipping the wrap/continuation bookkeeping (`inc st_vary` + the mod-30/mod-32
wrap check) a REAL mid-strip chunk pays on every one of its own blocks. An isolated-cycle sweep
across both orientations, both physical parities, every `st_vary` start (0-31) and both final/
non-final shapes (`proto-tools/diag_f9_worst_chunk.mjs`, real 6502 via `callRoutine` against
`sample-u512`/`sample-mmc3` compiled at the chosen `SW_STREAM_CHUNK=3`) finds the worst case at
**row orientation, odd parity, `st_vary` starting at 29 (crosses the mod-32 wrap on the chunk's own
last block), non-final (`st_len=32 > 3`)**: 1,403 isolated cycles on UNROM 512, matching the
reviewer's own independently-cited 1,396 to within the same "helper JSR/return convention" 1%
counting-convention gap fix round 8 already noted for a different pair of figures — not a fresh
disagreement.

That exact configuration was then built as a REAL Mesen fixture
(`proto-tools/build_f9_worst_chunk_fixture.mjs`) against the arbitrated NMI itself — OAM DMA, the
camera `$2000`/`$2005` rewrite with `cam_dirty` CLEAR (the real per-vblank refresh path, not the
stale-skip shortcut), an ACTIVE shake (`shake_left` nonzero, so `nmi_scroll`'s longer
shake-composed path runs), and on `sample-mmc3`, `split_mode` forced to `SPL_BOX` (`box_state =
BOX_TYPING`) so `split_arm` takes its longer `split_arm_go` path, not the two-instruction `SPL_OFF`
shortcut:

```
$ node proto-tools/build_f9_worst_chunk_fixture.mjs sample-u512 <out>
$ Mesen --testRunner <out>/sw_nmi_worst.lua <out>/sw_nmi_worst.nes
exit 0 -- nmi_rti reached scanline 258, cycle 292 -- inside vblank, margin ~237.7 cycles (713 dots)

$ node proto-tools/build_f9_worst_chunk_fixture.mjs sample-mmc3 <out>
$ Mesen --testRunner <out>/sw_nmi_worst.lua <out>/sw_nmi_worst.nes
exit 0 -- nmi_rti reached scanline 259, cycle 124 -- inside vblank, margin ~180.0 cycles (540 dots)
```

**Chunk 4 at this identical worst configuration, both boards — the real negative control**:

```
$ node proto-tools/build_f9_worst_chunk_fixture.mjs sample-u512 <out> 4
$ Mesen --testRunner <out>/sw_nmi_worst.lua <out>/sw_nmi_worst.nes
exit 5 (EXIT_DEADLINE_MISS) -- nmi_rti lands on scanline 0 (past the end of vblank entirely)

$ node proto-tools/build_f9_worst_chunk_fixture.mjs sample-mmc3 <out> 4
$ Mesen --testRunner <out>/sw_nmi_worst.lua <out>/sw_nmi_worst.nes
exit 5 (EXIT_DEADLINE_MISS) -- nmi_rti lands on scanline 1
```

**Chunk 3 has real, measured margin at the true worst case on both boards — MMC3's own 180-cycle
margin is the tighter of the two, still comfortably positive; chunk 4 misses badly on both, not
narrowly.** No rounding up: the reviewer's own worst-case enumeration is confirmed, timed with the
real NMI, and the chosen chunk size holds.

**Finding 2 — the lag bound under the real shared scheduler, not an independent-per-axis queue.**
`st_active` (`streamworld.asm`) is ONE byte: 0 idle, 1 column strip, 2 row strip — a column strip and
a row strip can never run concurrently. Proof 2's own 5,000,000-frame simulation modelled each axis
as if it owned its own server, which cannot represent this — the reviewer's own critique. A corrected
model (`proto-tools/diag_f9_shared_strip_lag.mjs`) replaces it: ONE shared server (busy or idle,
never both axes at once), two independent per-axis demand queues fed by the real, 6502-proven
periodic crossing sequences (X: 10 or 11 frames, mean 10.667; Y: 11 or 12, mean 11.130 — proof 2's
own figures, unchanged), under decision A's own 4-way-exclusive movement (only one axis's
accumulator advances on any given frame). Sanity-checked first against the already-proven bound (a
pure single-axis hold reproduces `lagMax=1` exactly, both axes) before trusting anything built on it.

The real, physically-grounded reason this stays bounded: under 4-way-exclusive movement, a player is
never demanding crossings on both axes at once, and completing one 16px crossing takes 10-12 frames
of HOLDING that axis — close to or longer than the 10-11 vblanks the resulting strip needs to
service, so an axis switch essentially never finds the PREVIOUS axis's strip still running. Searched
directly, not merely argued: every fixed periodic "hold axis A for `nA` crossings, then axis B for
`nB`" cycle, `nA,nB` in `[1,6]`, both arm-preference choices, **never exceeds 1 block of lag** (the
worst found: `nA=nB=1`, still `lagMax=1`). A wider randomized adversarial sweep (40 seeds × 6
switch-probabilities × 2 arm-preferences × 400,000 frames — corrected this round, fix round 11,
review 8's own arithmetic check: 40×6×2×400,000 is **192 million**, not 19.2 million, simulated
frames of axis-switching play) finds a worst case of **2 blocks**, reached only under rare, low-probability
switching (an axis held a long, variable time before an infrequent switch — the shape that lets both
queues build a small backlog before either drains) — still an order of magnitude under the 8-block
resync guard.

**`sw_axis_pref` (decision A's own "whichever axis was pressed most recently wins" rule) needs
persistent state across multiple frames of both directions held — not merely a byte to place, a
byte this round's own audit could not find free.** The `$03D8-$03E3` gap is confirmed still fully
consumed (fix round 7's own RAM map, unchanged) and the wider `$0300-$03FF` RPG battle page has no
other genuinely free byte (`engine/constants.asm`'s own comment: "the $0300 page is spoken for down
to its last eight bytes"). **Not resolved this round**: the honest recommendation is a new
zero-page byte (competing directly with the kernel diet's own scarce zero-page budget,
`docs/design-kernel-diet.md`) or 1 bit borrowed from an audited-safe spare bit of an existing
single-purpose flag byte elsewhere in the engine — neither audited to completion here. **The tie
rule** (both axes newly pressed the same frame, from idle): X wins, the same fixed, stateless
default every frame re-derives from `pad_new` alone, needing no stored byte of its own.

**Finding 3 — Flash gets a real, bounded engine guarantee, not an author-visible recurrence
threshold.** The reviewer's own measured numbers stand (`flash_tick` queues exactly two
one-vblank-costing packets per burst, `FLASH_TOTAL_FRAMES=6` apart) and the arithmetic that a bare
"drain always wins" policy needs Y-axis recurrence no faster than every 171 frames is confirmed —
but under the corrected, `st_active`-accurate scheduler (finding 2's own model, extended with a
Flash producer), **a real mechanism closes this instead of disclosing it**: candidate (b) from the
brief — once the strip's own lag reaches a threshold, the strip wins arbitration and a queued Flash
packet defers, UNLESS that packet has already been deferred past a hard cap, in which case it drains
regardless of lag. Searched (`proto-tools/diag_f9_flash_priority.mjs`, sanity-checked against the
already-proven no-flash bound first): **`LAG_PRIORITY_THRESHOLD = 1` block, `DEFER_CAP = 1` frame**
bounds BOTH sides of the trade at once — under a PATHOLOGICAL Flash recurrence (bursts re-armed the
instant the previous one's confirm edge fires, `flashPeriod=6`, far beyond any authored use, let
alone the "once every few seconds" ordinary case), on the tight Y axis: **strip lag never exceeds 2
blocks, and a queued Flash packet is never deferred more than 1 frame (16.7ms, imperceptible)** —
both figures independent of how often Flash actually recurs. This replaces proof 3's own safe-
recurrence thresholds (X≥32 frames, Y≥171 frames) with an unconditional guarantee: **there is no
longer an authored Flash rate that can break the stream**, closing exactly what the reviewer asked
("guarantee stream service," not "disclose a threshold"). The arbitration in `boot.asm` (decision A's
own splice) gains one more input: `lag` (computed the same way the resync guard already tracks it)
gates which producer wins, and a Flash producer's own defer count (reset on every successful drain)
gates the hard cap — no other producer needs this (the frozen-world four never compete with a live
strip at all, proof 3's own unchanged argument).

**Finding 4 — knockback capped so its debt repays within the margin, not merely disclosed as rare.**
The six-heart, no-healing bound is confirmed precisely: `LIMITS` action projects cap at 6 hearts
(`shared/project.js`), so an uninterrupted sequence of undamped knockback hits (no `Heal`, no potion)
ends in at most 6 hits, before the ~10-17 needed to reach the resync guard — real, but not universal,
since `Heal`/items/events can replenish mid-encounter, exactly what the reviewer's own finding
names. **Fixed instead of merely disclosed**: today's knockback (`KNOCKBACK_SPEED=3`,
`KNOCKBACK_TIME=8`, 24px/burst, applied directly, bypassing the accumulator) demands more BLOCKS per
unit time than the strip can service, not merely more service-time cost the way a Flash edge does —
a rate problem, not a latency problem, so finding 3's own priority mechanism does not fix it; the
displacement itself must shrink. Simulated directly against the real periodic model (repeated hits
every legal `IFRAME_TIME=60`-frame cooldown, forever, with ordinary Y-axis walking resuming between
hits — the worst legal recurrence): knockback displacement of 24px diverges (`lagMax` in the
thousands over 600,000 frames); **12px is the real, measured safe ceiling** (`lagMax=2`, bounded);
**8px (`KNOCKBACK_SPEED_STREAMED=1`, matching `WHOLE_STEP`, `KNOCKBACK_TIME` unchanged at 8 frames)
is the chosen, more conservative cap — `lagMax=1`, the identical bound ordinary movement already
holds to, real margin rather than the tightest number that merely avoids divergence.** On a streamed
map specifically (an ordinary map's own knockback is unaffected — this is not a general combat
change), `KNOCKBACK_SPEED` is cut from 3 to 1 px/frame — corrected wording this round (fix round 11,
review 8 finding 8): **that is one third the speed, not "halved."** The knockback ANIMATION/duration
(`KNOCKBACK_TIME`) is unchanged at 8 frames, so the visible effect is both slower AND shorter over
those same 8 frames — 24px total shrinks to 8px, not "halved" to 12px — a real, disclosed gameplay
change, not an invisible substitution, and a single gated constant, not new mechanism.

#### Round 11 (review 8, findings 1 and 2): the retracted defer policy replaced, the shared scheduler
specified and exercised, real per-axis slack corrected

**Finding 1's own diagnostic bug, confirmed and retracted.** `diag_f9_flash_priority.mjs`'s own
`nextArm` schedule, at `flashPeriod=6`, computes `f + (6 - 6)` for the confirm-to-next-arm gap —
zero — so the loop's own `f === nextFlashEdge` test, having already passed that frame index, never
matches again: the "pathological" run it reported contained exactly two edges total, not repeated
bursts, and its own "lag stays ≤2" claim is vacuous. Reproduced this round, unchanged, as the
historical record of the bug (not fixed in place — that script is retired below). **The
`LAG_PRIORITY_THRESHOLD=1`/`DEFER_CAP=1` policy itself is retracted, not merely re-tested with a
fixed loop**: it defers a published `vram_buf` queue, and `flash_tick_confirm`
(`engine/entities.asm:1067-1085`) assumes every published queue drains on the very next NMI — skip
it and `FLASH_PENDING` clears before the palette restore actually reaches VRAM, a real handshake
break `diag_f9_flash_priority.mjs`'s own boolean model never represented. Both defects are why the
brief calls this "history": no amount of re-tuning the threshold/cap pair repairs a policy built on
a broken measurement AND a broken handshake at once.

**Part A — the mixed-vblank replacement, Mesen-timed, both boards, real Flash-shaped packets.** A
Flash edge (`flash_apply_on` or the restore through `fade_apply_palette`) is one real 32-byte
palette packet — 35 `vram_buf` bytes including its 3-byte header (`vram_open`/`vram_push`'s own
accounting: header 3 + 32 pushed bytes). The new NMI splice (`boot.asm`) branches on `vram_len`
**before** calling `vram_drain` at all — never after, which would need a saved flag byte to remember
the decision across the call: a queue `<= MIXED_VBLANK_MAX_BYTES` (35, exactly one real packet)
drains **and** lets a **reduced** strip chunk (`sw_nmi_stream_reduced`, sharing `sw_ns_loop`/
`sw_ns_draw_block`/`sw_ns_finish` verbatim with the unmodified `sw_nmi_stream`, armed with
`SW_STREAM_MIXED_CHUNK` instead of the compiled `SW_STREAM_CHUNK`) advance the **same** vblank; a
queue too big for that (a full text row, only ever queued while the world is frozen, so it never
actually competes with a live strip) keeps fix round 7's own exclusive drain, byte-identical. Nothing
is ever deferred: `vram_ready`/`vram_len` are cleared by the same, single `jsr vram_drain` call
either path takes, so `flash_tick_confirm`'s own "the next NMI already drained it" contract is
completely untouched — the fix removes the retracted policy's whole failure mode by construction,
not by re-tuning it.

Real Mesen timing (`proto-tools/build_f11_mixed_vblank_fixture.mjs`, this round), at the identical
worst non-final strip shape fix round 9 already established (row, odd parity, `st_vary` starting at
29, `st_len=32`), with Shake genuinely active and, on `sample-mmc3`, the split forced to its longer
`split_arm_go` path — the same "everything else the Forge NMI does" shape `build_f9_worst_chunk_
fixture.mjs` proved for the strip-only case — **and now a real 35-byte palette-shaped packet queued
and ready to drain in the same vblank** (`FLASH_ENABLED`/`PALETTE_FX_ENABLED` hand-flipped to 1 for
this measurement, the identical move fix round 10 used for `SHAKE_ENABLED`, since neither board's own
real content triggers Flash today):

| Reduced chunk | UNROM 512 margin | MMC3 margin | Verdict |
|---|---:|---:|---|
| 1 block | ~554.7 cycles | ~492.0 cycles | fits, more margin than needed |
| **2 blocks (chosen)** | **~109.7 cycles** | **~47.0 cycles** | **fits, real but tight margin** |
| 3 blocks (= unreduced — the one-more-block negative control) | **miss** (scanline 2 of the *next* frame) | **miss** (scanline 2 of the *next* frame) | **fails, badly not narrowly** |

Each run also asserts `vram_len=0`/`vram_ready=0` (the queue genuinely, fully drained) **and**
`st_cur` equals the reduced chunk count (the strip genuinely also advanced) in the *same* vblank —
not merely that the NMI finished in time. A byte-count boundary control (36 bytes, one more than the
threshold) correctly routes to the exclusive-drain path instead: `st_cur` stays 0 that vblank (the
strip does not advance at all), proving the branch itself, not merely its timing, is correct. **A
Flash edge now costs the strip exactly one block (chunk 3 → 2), not three (the old exclusive policy's
own full skipped vblank)** — the improvement Decision 1's own text promised, delivered as a real,
Mesen-timed mechanism rather than an author-visible threshold.

**The fastest legal Flash re-arm cycle, derived from the engine's own event rules, not assumed.**
`script_op_flash` (`engine/script.asm:790-795`) has **no "already active" guard** — it unconditionally
sets `flash_left = FLASH_ARM_VALUE`, so re-arming mid-hold immediately forces a fresh on-edge on the
very next tick, restarting the countdown; a burst's own natural lifecycle (arm → on-edge → six hold
ticks → restore-edge → confirm) is exactly `FLASH_ARM_VALUE + 1 = 8` ticks end to end. Every event —
`interact`, `touch`, `enter` alike — runs through `start_dialog`, which freezes the world (`game_state`
non-zero) **before** `script_start` runs a single command; a trivial `[Flash]`-only page (no `Say`)
never opens the box (`box_state` stays `BOX_CLOSED`), so `box_close` (`engine/text.asm:215-222`)
short-circuits straight to `close_ui` and the freeze lasts **exactly the one frame the event ran on**
— credited, per the brief's own framing, by simply not advancing either axis's accumulator that
frame in the model below. `touch`'s own "walk off and back on" restriction (`ent_touched` cleared
only by leaving the actor's own tile) applies **per actor**, not per screen: it does not stop an
author placing a *distinct* trivial-Flash touch actor on every metatile of a corridor, each starting
with its own clear `ent_touched`. That is the tightest **legal** re-arm cycle tied to real player
movement this engine's own rules permit — **once per crossing** (not once per frame: a period-1
re-arm requires either an unconditional scripted loop, already excluded by this project's own
standing precedent — CLAUDE.md's own "the engine has no unconditional scripted-loop primitive" — or
literal frame-perfect input mashing decoupled from any actual game action, neither of which "frames
of walking between triggers" describes). `interact` mashed while standing still needs no walking at
all, but generates **zero** movement demand simultaneously, so it cannot compete with strip lag in
the first place (Decision 1's own proof 3 preamble already makes this point); `enter` fires once per
screen, an order of magnitude slower. The touch-actor-per-tile corridor is therefore the correct
worst case to design against, not a hypothetical stress no author could actually build.

**SUPERSEDED by fix round 11b (below) — kept for history, quoted exactly as written:** *"That worst
case genuinely diverges under the mixed-vblank service alone — the honest finding this round's own
search made, not assumed to close just because each edge got 3× cheaper.
`proto-tools/diag_f11_flash_recurrence.mjs` (a faithful port of `flash_tick`'s real state machine,
not a boolean stand-in) sweeps recurrence periods against the pre-round-11 walking speeds
(`SW_SPEED_SUB_X=128`/`SW_SPEED_SUB_Y=112`) and finds the touch-per-tile rate (period ≈ the crossing
interval itself, 10-11 frames X / 11-12 frames Y) still reaches `lagMax` in the thousands — because
losing 2 blocks (one ON edge, one restore edge, both landing inside the same crossing's own strip
service) every ~11 frames exceeds the ~1-block-per-crossing margin proof 2's own numbers gave."* Fix
round 11b found the actual cause: that model never credited the real 1-frame freeze a touch event
costs (measured directly against the real engine, below), and treated the corridor as unbounded
rather than capped at the real `MAX_ENTITIES=8`-per-screen limit — both are model bugs, not a real
property of the workload. *"The brief's own named fallback — coalescing a restore+on pair into one
edge — does not help this specific case: coalescing only matters when successive bursts overlap...
and the touch-per-tile worst case's own period (10-12...) never overlaps"* — this part is **confirmed
independently correct** by fix round 11b's own real-engine measurement (below) and is not retracted.

**SUPERSEDED by fix round 11b — the speed reduction below was never shipped correctly and is
reverted; kept for history, quoted exactly as written:** *"The chosen lever: real per-axis slack,
both axes, not merely the Y axis the brief anticipated. `proto-tools/diag_f11_flash_speed_search.mjs`
searches `SW_SPEED_SUB_X`/`SW_SPEED_SUB_Y` directly against the touch-per-tile worst case... | X
(column strip) | `SW_SPEED_SUB_X=128` | **`SW_SPEED_SUB_X=112`** | 1.5 | **1.4375** | ... | Y (row
strip) | `SW_SPEED_SUB_Y=112` | **`SW_SPEED_SUB_Y=96`** | 1.4375 | **1.375** | ... Both reductions are
real, disclosed gameplay changes (≈4.2%/4.3% slower sustained walking, respectively)..."* **This
change is reverted.** `SW_SPEED_SUB_X=128`/`SW_SPEED_SUB_Y=112` — FALLEN STAR's own values, exactly
as Chris asked for — are restored and confirmed closing, with the model bug fixed rather than the
walk slowed. See "Round 11b" below, immediately after Part B, for the corrected model, the real-engine
measurement that found the bug, and the closing numbers at the restored speeds.

**Part B — the shared scheduler, specified as the engine will run it, and exercised.**
`proto-tools/diag_f11_scheduler.mjs` implements FALLEN STAR's own `update_stream` shape generalised
to this project's two independently-rated axes and one shared server: a **signed, flat (unwrapped)
desired position** per axis, derived from the player's own continuous accumulator progress (never
torus-wrapped — only `st_ftile`/`st_fnt`/`st_vary`'s own physical-ring addressing wraps, at draw
time); a **signed, flat current window origin** per axis (`win_col_screen`/`win_col_local`,
`win_row_screen`/`win_row_local` — this design's own real fields, previously read-only in every prior
round's prototype, since nothing before this round specified what writes them); **one shared server**
(`st_active`: idle, column, or row, exactly as today, never both); and the **order** the real engine
enforces: (1) **update** — the currently-owning axis's own accumulator advances, and a completed 16px
crossing changes that axis's own `desired` by exactly one block, clamped (`sw_clamp_col`/`row`'s own
`(grid-2, 0)` rule, unchanged); (2) **NMI service** — if a strip is active, it advances by the
compiled chunk (or the reduced chunk, if this vblank also drains a small Flash-shaped queue); (3)
**arm** — only when idle, and only if `desired != current` on some axis (X preferred on a tie, the
already-specified "simultaneous first press" rule), `current` moves by **exactly one block toward
desired** and a fresh strip is armed for that new entering edge; (4) **completion** — reaching
`st_len` sets `st_active` idle; a strip queued behind it may arm and begin its own service in the
very same vblank the previous one finished (`sw_ns_loop`'s own single-pass-per-NMI shape, proof 2's
own "two separate ifs" note) but does **not** also get serviced that same vblank (nesasm's `ns_go`
call happens once per NMI) — `sw_nmi_stream`'s call is what "publishes" a completed strip's own
content as safe to scroll past; the camera/viewport's own continuous position is a separate concern
(item 12) that this window-origin bookkeeping never touches directly. **The guard, measured exactly
as the engine will measure it**: `lag = max(|desiredX - currentX|, |desiredY - currentY|)`, in
blocks, at arm time — matching `st_lagmx`'s own FALLEN STAR shape (`max(|dx|,|dy|)`), generalised.

**The minimum valid-visible margin, derived, not borrowed as "8" unexplained.** The window (torus) is
32 blocks wide / 30 tall; the viewport is 16 / 15. When caught up (`lag=0`), the viewport's own left/
top edge coincides with the window's own current origin (FALLEN STAR's own `win_bx = cam_bx - 8`
shape: the viewport occupies the window's *first* half on each axis, leaving the *second* half — 16
blocks (X) / 15 blocks (Y) — as pure look-ahead buffer for the direction just travelled). A `lag` of
`L` blocks means the *actual* (continuously-following) viewport edge sits `L` blocks ahead of the
window's own last-recorded origin; the window's drawn span stays valid up to `current + (windowSize
- 1)`, so corruption (a genuinely undrawn column entering view) is only possible once `L` exceeds
`windowSize - viewportSize` — **16 blocks on X, 15 on Y**, the true per-axis hard limits, derived from
this project's own 32×30/16×15 shape, not FALLEN STAR's identical-axis 32×30/16×15 coincidence
(same numbers here, but arrived at independently, since this design's own two strip costs are
asymmetric where FALLEN STAR's are not — proof 2, above). **The kept threshold of 8 is confirmed
safe on both axes with real spare margin (8 blocks on X, 7 on Y before the true hard limit), not
merely copied**, and every measured lag in this round's own exercises (below) stays at 1-2 blocks —
two orders of magnitude under either hard limit, let alone the guard.

**Five exercises, each asserting its own event counts, plus a negative control that must fail:**

- **Held single axis** (X, then Y): `lagMax=0` both axes, ≥170,000 real crossings/arms each,
  confirming the already-proven bound survives the new, more literal desired/current model.
- **Turn onto the other axis every block**: every fixed `(nX, nY)` cycle in `[1,6]²`, both arm
  preferences (2,592,000 simulated frames total) — worst found `lagMax=1` (`nX=nY=1`, the tightest
  alternation), an order of magnitude under the guard.
- **Reversal mid-strip** (direction oscillated every `K` crossings, `K` in `{1,2,3,5}`, 4,000,000
  frames total, ≥17,000 real reversals exercised per `K`): `lagMax<=1` in every case. **The answer to
  "finish it, cancel it, or replace it": the engine finishes the in-flight strip, and never needs to
  choose otherwise, by construction** — `current` only ever advances at ARM time, gated on idle, so a
  strip already in flight represents a crossing that has *already physically happened*; a later
  reversal simply queues its own opposite-direction demand, serviced once idle, exactly like any
  other pending block. The accumulator itself is magnitude-only (`sw_walk_step_x/y` never reads
  direction), so a reversal costs the scheduler nothing a same-direction hold would not also cost.
- **Walking into a map clamp edge**: demand capped at a grid boundary (179,647 clamped frames
  exercised, out of 179,687 total crossings) — `lagMax=0`; `desired` simply stops advancing once
  clamped, `current` catches up, and lag never spikes on the way there.
- **The corrected Flash service at its proven worst legal recurrence** (every crossing, including
  re-arming an already-active burst): Y hold, `lagMax=1` (515,621 genuinely mixed vblanks exercised —
  an edge landing on a still-busy server, not merely configured); X hold, `lagMax=0`; combined with a
  turn-every-3 pattern as a bonus stress case, `lagMax=1`.
- **A dedicated, deterministic same-vblank-handoff check** (Exercise 6a): two crossings queued at
  once, confirming exactly one same-vblank strip-to-strip restart and both strips completing — the
  ordinary single-axis hold above never happens to exercise this path on its own (chunk 3 clears a
  strip in fewer vblanks than the crossing interval needs, so there is normally an idle vblank between
  strips — an honest finding, not a gap plugged by a misleading assertion).
- **Capped knockback, repeated at the fastest legal `IFRAME_TIME=60` cooldown**, ordinary walking
  resumed between hits, at the new slack values: `lagMax=0`, both axes — the existing 8px cap (finding
  4, above) holds with room to spare once the base walking speed itself is slower.
- **Negative control (must fail)**: the OLD `SW_SPEED_SUB_Y=128` value, no Flash at all, reaches the
  8-block resync guard at frame 2,495 — reproducing (order of magnitude, not the identical model) the
  original ties-with-zero-margin regression this project already rejected, proving the control itself
  is live, not merely present.

**Mainline frame budget — no arm overruns its frame.** The measured worst-case mainline arm costs
(fix round 10, real-read, fill-aware): `sw_stream_start_col` 3,911 cycles, `sw_stream_start_row`
4,077 cycles — both charged on the single frame a crossing arms a strip, never sustained. Against the
29,780-cycle NTSC frame budget, that is 13.1%/13.7% of one frame in ten or eleven, alongside
`music_tick`, `read_pad`, and whatever the frozen/gameplay dispatch is doing that frame — the same
"one arming frame, not a sustained tax" accounting fix round 10 already established for the bounds
check alone, now confirmed to include the corrected Flash/slack numbers above without changing in
kind. No frame in any exercise above ever needed to arm more than one strip (the shared server's own
one-in-flight rule makes a second same-frame arm structurally impossible), so no arm cost analysis
beyond the single worst-case figure is needed.

**What this round leaves honestly open**: `sw_axis_arbitrate` (the 4-way exclusive input rule) and
the mainline `update_stream`-equivalent driver itself (the routine that would actually call
`sw_walk_step_x/y`, detect a crossing, and perform the arm sequence specified above) remain specified,
not built — `engine/input.asm`'s own scope, phase 2, unchanged from every prior round's own
disposition. This round's own scheduler model is real, working code proving the *contract* closes;
wiring it into the shipping engine is not attempted here.

#### Round 11b: the speed reduction retracted — a model bug found by real-engine measurement, not a
real property of the workload

The orchestrator doubted the "must slow the walk" conclusion above on two grounds, both confirmed
correct this round: **(1) the touch corridor is bounded, not unbounded** — `MAX_ENTITIES=8`
(`engine/constants.asm:619`, `LIMITS.entitiesPerScreen=8`) is enforced by the generator itself
(confirmed directly this round: a 12-actor screen is refused with `"Greenwood · screen 0 has 12
entities; the engine allows 8"`, exit non-zero, not merely a warning) — a streamed map keeps only
the current screen's own actors live (Decision 3, above), so at most 8 of any 16 (X) or 15 (Y)
consecutive crossings can land on a fresh touch actor, never every single one forever. **(2) every
event freezes the world for at least one frame, and that frame's own vblank still services the
strip normally** — fix round 11's own model never credited this at all.

**Measured against the real engine, not modelled.** `proto-tools/measure_f11b_flash_touch_row.mjs`
builds a throwaway project (an `mkdtemp` copy of `sample/`, the checked-in fixture never touched) —
a row of 8 touch-trigger actors, one metatile (16px) apart, each carrying a single-command `[Flash]`
event and nothing else — boots it under jsnes (`test/lib/naming.js`'s own `finishNamingIfOpen` past
the naming grid, exactly as the unit tests do), holds Right, and logs real per-frame `player_x/y`,
`game_state`, `flash_left` and `vram_len` (the last via a wrapped `ppu.writeMem` hook catching a real
$3F00-$3F1F write the instant it happens, not after that frame's own NMI has already drained it back
to 0 — the identical technique `flash.test.js`'s own `countPaletteWrites` already established).
Addresses resolved from the built project's own `build/constants.asm` (`scanEquates`/
`resolveEquates`, the streaming prototype's own established technique), never hardcoded.

The real trace, one full event cycle (tile-aligned, 16px spacing, the realistic case):

```
f2:  x=14                              -- approaching the actor
f3:  x=14 (FROZEN)  flash_left 0->7    -- touch detected; world freezes for EXACTLY this one frame;
                                            script_op_flash arms flash_left, the whole [Flash]-only
                                            page starts and finishes within this same frame
                                            (box_close's own BOX_CLOSED short-circuit to close_ui,
                                            since no Say ever opened the box) -- game_state itself
                                            never even samples as non-zero at a frame boundary
f4:  x=16 (resumed) flash_left 7->6, vram_len=35   -- the ON edge queues here, one frame after arm
f5-f9: ordinary movement, flash_left 6->5->4->3->2->1, no vram_buf writes
f10: x=28           flash_left 1->255, vram_len=35 -- the RESTORE edge queues here (FLASH_TOTAL_
                                                         FRAMES=6 real frames after the on-edge,
                                                         exactly as engine/entities.asm specifies)
f11: x=30           flash_left 255->0              -- confirm, genuinely idle; movement unaffected
f12: x=30 (FROZEN)  flash_left 0->7                -- the NEXT actor's touch, same one-frame freeze
```

Exactly **one frame frozen per event** (confirmed across all 8 actors: 8 frozen frames in the full
row, each exactly 1 frame long), coincident with the arm itself, never longer — the model's own
"credit the frozen frame" language in fix round 11's own prose was real, but the actual JavaScript
model (`diag_f11_flash_speed_search.mjs`'s own `simulate()`) never implemented it: the accumulator
advanced every single simulated frame with no pause ever inserted, silently contradicting the fix
round 11 report's own claim of having credited it. **That is the whole bug** — not a wrong Flash
mechanism, not a wrong strip-service model, a missing three-line freeze insertion.

**Re-arming an active burst, confirmed for real too** (a forced, synthetic 4px-spaced version of the
same fixture, since natural 16px tile spacing at ordinary engine speed never overlaps — the gap
between touches, 8 movement frames, is shorter than the 8-tick Flash lifecycle only under this
artificial spacing): `flash_left` jumps straight from `5` back to `7` mid-hold with no restore edge
ever queued for the interrupted burst — `script_op_flash`'s own lack of an "already active" guard,
read from source in fix round 11, is exactly what real execution shows. Under the *realistic*,
tile-aligned 16px spacing this never actually happens (movement's own crossing interval, 10-12
frames at either streamed axis's real speed, is always longer than the 8-tick lifecycle + 1 freeze
frame = 9), so every touch produces a clean, independent 2-edge burst — confirmed by the corrected
model below (`mixedVblanks` is exactly `2 × events` in every legal-workload run).

**The corrected model** (`proto-tools/diag_f11b_legal_worst_case.mjs`): the real 1-frame freeze
(inserted immediately after a touch-triggering crossing, before the next accumulator step — matching
the measured f3/f12 pattern exactly) and the real `MAX_ENTITIES=8`-per-screen cap (searched both
`clustered` — all 8 actors on the first 8 metatiles of every screen, the burstiest legal arrangement
— and `spread` — evenly spaced — placements; neither is assumed worse without checking), **at the
restored FALLEN STAR speeds**:

| Axis | `SW_SPEED_SUB` | 8-per-screen, clustered | 8-per-screen, spread | Beyond-legal unbounded corridor (labelled stress) | No-flash control |
|---|---:|---:|---:|---:|---:|
| Y (row, 15 rows/screen) | 112 (1.4375 px/frame) | **lagMax=1** | **lagMax=1** | lagMax=1 | lagMax=1 |
| X (col, 16 cols/screen) | 128 (1.5 px/frame) | **lagMax=2** | **lagMax=2** | lagMax=1 | lagMax=1 |

10,000,000 simulated frames per cell (~46.3 hours of continuous holding). **Every legal workload
closes at the restored, unslowed speeds** — X's own worst found (2 blocks) is not even the unbounded
corridor's own figure (1 block, a real but small phase-alignment effect between the freeze-lengthened
demand cycle and the 10-vblank service cycle, not a monotonic "more demand is always worse"
relationship) — both are an order of magnitude under the 8-block resync guard. A sweep of
`perScreen` from 1 through the full row/column width finds no worse case than these two figures at
either axis. **`SW_SPEED_SUB_X=128`/`SW_SPEED_SUB_Y=112` are restored — the fix round 11 reduction to
112/96 is retracted in full.** No lever from the fix round 11b brief (the row strip's own wasted
11th-vblank block, restore/on-edge coalescing) was needed once the model itself was corrected; both
remain valid, unused optimizations for a real implementation, not required for this bound to hold.

**The MMC3 mixed-vblank margin (~47 cycles), re-examined**: what else could land in that same
vblank? Read `engine/boot.asm`'s real `nmi:` routine in full (lines 355-567) — its only two `jsr`
targets are `vram_drain` and `split_arm`; every other producer this design has (`music_tick`,
`sting_tick`, `flip_tick`) is called from `main_loop` (lines 114+), never from `nmi`, so none of them
can ever compete for NMI-side vblank time regardless of what a project authors. The fix round 11
Mesen fixture already includes literally everything `nmi:` does — OAM DMA, the drain, the
`PALETTE_FX_ENABLED` cleanup, the camera+Shake scroll composition, and MMC3's own `split_arm` on its
longer path — so the measured 47-cycle margin already reflects the true worst case with nothing
omitted. A bigger combined queue cannot additionally share that vblank either: `MIXED_VBLANK_MAX_
BYTES=35`'s own threshold check means anything larger routes to exclusive drain instead, where the
strip yields entirely and margin is not a question. **MMC3's reduced chunk stays 2, not 1** — no
producer exists that could push the real, already-complete 47-cycle figure negative.

### Decision 2 — dialogue: nudge the camera to metatile alignment, no torus redraw, no blank

**Chris, 2026-09-17, ~23:45 (fix round 7): the ~35-frame (0.58s) open+close blank is REJECTED.**
Verbatim: *"Ask for a cheaper path."* His EARLIER decision — quoted here so it cannot be silently
reversed again — is the part that still stands: *"a message box on a streamed map opens by snapping
the camera to the player's own screen origin and redrawing... on close, the full torus redraw
around the player and the camera back to centred."* Only the TRANSACTION's own mechanics are
replaced this round; a message box working at all on a streamed map, and the "not a no-dialogue
restriction" framing, are both unchanged.

**The candidate the fix-7 brief asked to evaluate first, adopted — no long forced blank, no torus
redraw, and, worked through in full below, no extra byte cost the round's own RAM budget cannot
absorb.** On open: nudge the camera to the nearest 16-pixel (metatile) alignment on both axes (at
most 15px per axis, applied as a single same-frame register write, the world already frozen by the
ordinary `game_state` transition that opening a box already causes) — no blank, no torus/window
change at all. The box occupies viewport tile rows 24-29 (CLAUDE.md's own "exactly metatile rows
12-14"); with the camera aligned, those six tile rows are exactly three whole metatile rows of
whatever real torus content already backs that part of the viewport, at a resolvable, wrapped
address. `text.asm`'s box drawing proceeds through the **existing, unmodified** `vram_buf`
mechanism (`box_begin`/`text_open_step`), with row addresses made camera-relative on a streamed map
(below) instead of the fixed `$23xx` literal `box_row_addr` already uses on an ordinary screen. On
close, the same six rows are rebuilt from the streamed record (`sw_dlg_metatile`, built and proven
this round, below) plus the attribute quadrants via `attr_shadow`'s own read-modify-write (the same
"rebuild rows 24-29 straight out of the screen's own data" rule `box_close` already applies on an
ordinary screen — CLAUDE.md's own `box_close` section — just sourced through the streamed accessor
instead of `[mtptr_lo],y`); the camera un-nudges back to continuous tracking once the rebuild
finishes. No torus redraw, no blank, either direction.

#### The real costs, measured against the ENGINE'S OWN existing box-open/close pacing, not re-derived from a full render

`BOX_ROWS_HIGH = 6` (`engine/constants.asm:1122`). `text_open_step` (`engine/text.asm:299-329`)
already draws one tile row per frame while raising the box — **6 frames**, unconditionally, on
every screen, streamed or not; this decision changes NONE of that code, so it costs nothing extra.
The camera nudge itself is two stores (`cam_x_lo`/`cam_y_lo`, or their per-axis equivalents) on the
SAME frame `box_begin` is called — the very next NMI's own `$2005` write already happens every
frame regardless, so the nudge and the box's own first drawn row land in the identical vblank, with
no misalignment frame possible. **Open cost: 0 extra frames beyond what box-opening already costs
on any screen.**

`text_close_step`/`text_close_attr` (`engine/text.asm:625-696`) already rebuild the SAME six rows
one per frame (`box_row` 0-5, 32 bytes/row = exactly one `vram_buf` packet) **plus one more frame
for all 16 attribute bytes in a single packet** — **7 frames total, on an ordinary screen today,
unconditionally** — not the ~28-frame full-torus-redraw this design proposed two rounds ago. Since
this decision reuses that identical per-row pacing (only the byte SOURCE changes, from `[mtptr_lo],y`
to `sw_dlg_metatile`'s own resolve-and-fill-aware read), **close cost is the same 7 frames an
ordinary screen already pays, not 28.** The whole reason the earlier ~28-frame figure existed was a
full four-nametable `sw_render_window` pass under forced blank; this design never calls it for a
dialogue transaction at all any more.

**A strip in flight when the box opens — resolved by decision A's own arbitration, no new mechanism
needed.** The box's own `vram_buf` traffic (open's 6 border-tile rows, close's 6 rebuilt rows +
1 attribute packet) is, from the NMI's own point of view, just more `vram_buf` demand — decision
A's arbitration already makes the strip yield to ANY queued drain, unconditionally, so a strip that
happens to be mid-flight simply pauses for however many vblanks the box's own traffic takes (at
most 7), exactly the way it already yields to a Flash edge (proof 3, decision 1). Because the world
is frozen for the whole transaction, no new block-crossing demand accrues during that pause, so
there is no possible write collision (arbitration serialises all `vram_buf`-consuming producers into
"one thing at a time, per vblank") and no accumulated lag risk beyond what proof 3 already bounds —
review 6's own "finish it first, or prove they cannot touch the same tiles" question is answered by
construction, not by adding a wait step.

**Music keeps its normal rate — falls out for free, exactly as the fix-7 brief predicted.** Fix
round 6's own defect (four `music_tick` calls crammed into a 28-frame close, roughly one-seventh
speed) existed only because that design ran its OWN long forced-blank loop, outside `main_loop`,
that had to remember to tick music explicitly. This design never runs such a loop: `box_begin`/
`text_open_step`/`text_close_step` are ordinary `ui_tick` states, stepped once per REAL game frame
from `main_loop`'s own existing, unconditional `music_tick` call (`boot.asm:117`) — the same call
every other dialogue box on every other screen already relies on. There is nothing new to disclose
here: music ticks at the ordinary rate through the whole transaction, by construction, not by an
added polling call.

#### `sw_dlg_metatile` — the close-path accessor, built and proven this round

The one genuinely new piece: a real accessor resolving a metatile position within the box's own
16-wide/3-tall band, against an explicit origin (the box's own top-left metatile position,
torus-absolute — however the caller derives that from the aligned camera and the window's own
origin is remaining open question 1's own unresolved camera/window integration, not new work this
decision needs to close), through `sw_terrain_or_fill` — bank-safe (restores the field's own
current screen, correct since `text_close_step` runs from mainline/field code, never a banked
caller) and fill-aware (a box straddling the map's own authored edge reads `sw_fill_metatile_id`,
never garbage). It composes two already-proven pieces rather than inventing new addressing math:
`sw_col_at_offset`/`sw_row_at_offset`'s own mod-16/mod-15 wrap shape (proven by
`sw_render_window`'s own tests), parameterised on a caller-supplied origin instead of the global
window state those two read, feeding `sw_terrain_or_fill` (review 5, `diag_r5_fill.mjs`).

Proven against an independently-resolved direct `sw_terrain_or_fill` call at the SAME target — two
separate invocations of real, assembled 6502 reaching the same physical byte — over seven cases
spanning no wrap, column-only wrap, row-only wrap, both axes wrapping together, a non-zero mid-grid
origin, and an origin that pushes the box entirely outside the authored grid (the fill path, both
calls independently reaching the same fill id):

```
$ node proto-tools/diag_r7_dialogue_accessor.mjs
ok   no wrap, origin (0,0,0,0), box (0,0) -- lands on screen (0,0) local(0,12)
ok   no wrap, box (15,2) -- lands on screen (0,0) local(15,14), the box's own far corner
ok   column wrap only: origin localCol=15, box col=1 -- screenCol+1
ok   row wrap only: origin localRow=3, box row=0 -- 3+12=15 -> screenRow+1, local 0
ok   both axes wrap at once: origin localCol=15/localRow=3, box (1,0)
ok   origin already mid-grid, no wrap: origin screen(1,1) local(5,5), box(3,1)
ok   origin at the grid's own far edge, wraps OUT of the 3x3 grid -> fill
ALL PASS
```

(Run against `minimal-u512`'s own 3×3 `r2` fixture — `build_r2_fixture.mjs`'s own `screenBytes()`
gives every offset of every screen a distinct, marker-dependent value, so a coordinate bug landing
on the wrong screen OR the wrong offset would be caught, not masked by a uniform fixture, the way
testing only offset 0 would be. `sw_dlg_metatile` itself is assembled into the never-shipped bank-14
test slot `sw_run_bank_test` already established, PRG register 7 — `minimal-u512`'s own stripped
fixture has no kernel-lo room left to hold it inline alongside decision A's own two new
accumulators; production placement is kernel-lo, like every other cold-path `sw_*` routine, and
owes the real kernel-lo budget a new, not-yet-measured `*_KERNEL_ALLOWANCE` term, §9.)

**Byte/RAM cost**: `sw_dlg_cam_x_lo`/`sw_dlg_cam_y_lo` (2 bytes — the pre-nudge camera pixel
position, restored verbatim on close; NOT the old 4-byte window-origin save, since the window never
moves at all under this design), plus `sw_dlg_metatile`'s own eight bytes (four persistent origin
bytes, four transient scratch — both needed because the routine's own nested
`sw_terrain_or_fill`/`sw_peek_byte`/`sw_goto` chain clobbers the shared cold-path `sw_tmp*` scratch,
so a value that must survive that call cannot live there). Ten bytes total, down from the four the
old window-origin design needed for its own save/restore alone, §9's own complete map below.

**SUPERSEDED HISTORY (fix round 6).** Review 5, finding 8 correctly found that the open transaction
cannot call `redraw_screen` (it indexes ordinary per-screen pointer columns a streamed screen has
none of, reads a precomputed attribute table a streamed record has no such table for, and calls
`spawn_entities`, wrong mid-conversation) — that retraction is still correct and stays retracted.
Fix round 6's own FIX for it — a new single-screen streamed draw at camera `(0,0)`, one quarter of a
full `sw_render_window` pass, ≈7 frames of forced blank to open and the full four-nametable
`sw_render_window` pass (measured 835,723 cycles ≈ 28.06 frames) to close — is itself now
**superseded** by decision B's own camera-nudge transaction, above: Chris's own "ask for a cheaper
path" rejects the ~35-frame combined blank that design implied, and the replacement needs neither a
saved 4-byte window origin (`sw_dlg_win_col_screen/local`, `sw_dlg_win_row_screen/local` — retired,
see §9's own RAM map) nor a new single-screen full-render routine at all — decision B's own close
cost (7 frames) reuses the ENGINE's existing per-row box-close pacing outright, cheaper than fix
round 6's own OPEN alone.

**The remaining items the fix-7 brief asked to be worked through, in full:**

- **The box's own palette, attribute quadrants, and the half-cell at the torus's own bottom
  attribute row.** Attribute bits are per 16×16-pixel quadrant (2 metatiles by 2 metatiles); the
  box's own six tile rows span exactly two attribute rows (attribute row 6 and 7 of whichever
  physical nametable backs them). A physical nametable is 30 tiles / 15 metatiles tall, an ODD
  number, so its own 8th attribute cell row (rows 28-29, covering metatile row 14 alone) has no
  valid same-nametable content below it — `sw_rw_attr_bl`/`sw_rw_attr_br` already special-case this
  (return 0, contribute nothing) for exactly this reason, proven by `sw_render_window`'s own tests.
  The box's own close-path attribute rebuild reuses that identical convention (not a new one): if
  the box's own bottom metatile row lands on a physical nametable's own attribute row 7, the BL/BR
  quadrant contributes nothing, matching what `sw_render_window` already draws there. This is a
  read-from-`attr_shadow`-and-RMW operation exactly as `text_close_attr` already does on an ordinary
  screen (CLAUDE.md's own `box_close` section), just against the streamed shadow instead of a
  precomputed 64-byte table.
- **The choice cursor.** `ARROW_TILE`, drawn in the padding column via the same `vram_buf`
  mechanism as any other box row — unaffected by camera-relative addressing, since it is a single
  fixed-offset tile write within whichever row is currently shown, the same shape on a streamed or
  ordinary screen.
- **The naming grid uses a DIFFERENT path, not this one.** In-game naming (hero or Join) draws far
  more of the screen than a six-row band — `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE`/`NAME_ENTRY_BATTLE_ALLOWANCE`
  (CLAUDE.md's own kernel-budget section) size a routine that owns most of the visible frame, not a
  bottom strip. Decision B's own cheap path does not generalise to it: naming on a streamed map
  keeps fix round 6's own more expensive snap-and-full-redraw mechanism (or an equivalent full-torus
  transaction), since there is no six-row optimisation available when the overlay itself is not six
  rows. This is a scoping decision, not an oversight — a project using naming on a streamed map pays
  the full transaction cost; one that only ever shows `Say`/choice dialogue there pays decision B's
  own cheap cost exclusively.
- **MMC3's split, verified, not merely asserted "unaffected."** `split_select` keys off
  `box_state`/`game_state` alone (`engine/split.asm`, CLAUDE.md's own MMC3 split section) — both are
  screen-position-independent by construction (`box_state` tracks the box's own lifecycle, not where
  in the torus its rows physically live), and the split's own scanline counts are calibrated against
  PHYSICAL SCANLINE numbers (screen row 24 onward), never against torus/camera position. Since
  decision B never changes `box_state`'s own semantics (still `BOX_OPENING`→`BOX_TYPING`/
  `BOX_CHOICE`→`BOX_CLOSING`→`BOX_CLOSED`, exactly as today) and never touches `game_state`
  differently from an ordinary screen's own dialogue, `split_select`'s own behaviour is provably
  unchanged: it selects the message-box font-bank program under the identical condition it always
  has, regardless of the camera's own current alignment.
- **Sprites while the box is up — corrected this round.** Fix round 6's own design needed a special
  "local, unprojected" sprite mode because it redrew NT0 to LOOK like an ordinary screen. Decision
  B never redraws NT0 at all — the torus keeps showing genuinely streamed content, just
  camera-nudged — so sprites continue through the ordinary `sw_project_axis` projection exactly as
  during normal walking, with **no special-casing needed at all**, simpler than fix round 6's own
  contract. A straddling player (decision 1's own overshoot) projects exactly as it already does
  mid-walk; the world being frozen changes nothing about how sprites are drawn, only whether the
  camera continues tracking.
- **A strip in flight when the box opens** — covered above (decision A's own arbitration already
  resolves this by construction; no finish-first wait, no new guard).
- **`vram_buf` and the strip sharing vblanks under decision A's arbitration** — covered above: the
  world is frozen for the whole transaction, so the box's own traffic simply has priority for as
  long as it runs (at most 7 vblanks), the identical shape a Flash burst already gets under proof 3.

**Menu and save UI, unchanged from fix round 5/6's own decision**: both compose through the
identical open/nudge/close shape above (a menu freezes the world the same way a message box does,
one `game_state`/`paused` gate already covers both) — no separate mechanism needed, and a nested
overlay must still not trigger a premature un-nudge/rebuild, the same caveat as before.

#### Round 9 (review 7): three findings against decision B, specified in full — not yet built or
Mesen-timed to the same depth as decision A's own round-9 proofs, above

Review 7 found the packet-address story ("only the byte source changes") false for every write
site once the camera is merely metatile-aligned rather than nametable-aligned (finding 5); the
open transaction's own "same-vblank publication" claim false against `box_begin`'s real control
flow, and the nudge/clamp/rounding/in-flight-strip rules genuinely unspecified (finding 6); and the
naming exception's own justification — "owns most of the screen" — built on a footprint claim this
round found is simply wrong (finding 7). All three are corrected below; **the accessor and packet
splitter finding 5 specifies is not built this round** (disclosed, not deferred silently — the
existing 7-case `sw_dlg_metatile` proof, decision B's own text above, remains what is actually
proven), so the real open/close frame counts below are a careful, checkable arithmetic bound, not a
fresh Mesen measurement, and are labelled as such throughout.

**Finding 7 first, because it changes what finding 5/6 actually have to cover.** `engine/
nameentry.asm:1-3` says plainly: "the in-game naming grid... reus[es] the message box's own
footprint (tile rows 24-29)." `nameentry_raise_step` draws its interior rows through
`box_text_row_addr`, `nameentry_queue_cell` writes through `BOX_TEXT_LO` — the identical six-row
band Say/choice already use, not "most of the visible screen." Fix round 6/8's own claim that
naming's footprint disqualifies it from decision B's cheap path is **retracted as a false premise,
not merely superseded**: `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE`/`NAME_ENTRY_BATTLE_ALLOWANCE`
(CLAUDE.md's own kernel-budget section) size a routine that DRAWS MORE CELLS within those six rows
(the A-Z/a-z grid, the preview, the sprite cursor) — a code-size fact, never a visual-footprint
one, and this round's own direct read of the engine source is what the earlier rounds' own
inference skipped. **Naming is rerouted onto decision B's own cheap path — the same camera nudge,
the same wrapped row/attribute accessor finding 5 specifies, the same close-path rebuild — with no
new mechanism of its own**: `nameentry.asm`'s preview-cell writes and `BE_NAME_*`'s own banked
callers are unaffected (they still call the SAME low-level row-write primitive; only that
primitive's own address computation changes, gated on `map.streamed`, identically to Say/choice);
the sprite cursor needs no change at all (decision B's own sprite analysis — projected coordinates,
no special-casing — already covers it). **The old ~35-frame snap-and-full-redraw transaction is
retired outright, for every case, not merely "kept for naming."** Review 6's own finding 6 (music
starvation, the invalid `atptr` restore) is now closed for real, not carried open for one remaining
path — there is no remaining path.

**Finding 5 — one address mapper, one split-at-seam packet writer, every write site routed through
it.** The camera is nudged to 16px (metatile) alignment, NOT to a nametable (256px) boundary — so a
box row is, in general, NOT a single contiguous 32-tile run in torus address space: it straddles
whichever physical nametable seam the aligned camera's own X falls inside. **The mapper**
(`sw_dlg_row_addr(logicalRow, colOffset)`, specified, composing the same primitives `sw_dlg_metatile`
already proves reachable — `sw_col_at_offset`/`sw_row_at_offset`'s own mod-16/mod-15 wrap shape,
parameterised on the aligned camera's own tile origin instead of the window's global state):

1. `camYTile = cam_y_lo/8` (0-29, always even, since `cam_y_lo` is metatile-aligned) is the
   WITHIN-nametable remainder; the box's absolute torus tile row before wrap is `camYTile + 24 +
   logicalRow` (`logicalRow` 0-5). **Wraps at 30, the real physical nametable height, not 32**:
   `physRow = (camYTile + 24 + logicalRow) mod 30`, and the CROSSING QUOTIENT is `yFlip = 1` exactly
   when `camYTile + 24 + logicalRow >= 30` (at most one wrap, since the unwrapped value tops out at
   `28 + 24 + 5 = 57 < 60`) — `yFlip` toggles `cam_nt` bit 1 relative to the viewport's own base
   value for that one row's packet only, never for the whole transaction (a still-open question in
   review 8's own reading, closed here: the quotient is per-row, the remainder-source `cam_y_lo`
   is shared by all six rows).
2. `camXTile = cam_x_lo/8` (0-31, always even) is the X remainder; for a given `colOffset` (0-31)
   the absolute torus tile column before wrap is `camXTile + colOffset`, **wraps at 32**:
   `physCol = (camXTile + colOffset) mod 32`, crossing quotient `xFlip = 1` exactly when `camXTile +
   colOffset >= 32` — at most one wrap per row (`camXTile` max 30, `colOffset` max 31, unwrapped max
   61 < 64), and since `camXTile` is always even, the seam offset (`32 - camXTile` when `camXTile !=
   0`) is always even too, matching the terrain content mapper's own even-boundary shape.
3. **`$2006`'s own hi/lo pair, from `physRow`/`physCol`/the combined nametable index, given
   explicitly** (this is the "how the incoming bit and quotient combine" review 8 asked for): let
   `ntIndex = cam_nt XOR (xFlip ? 1 : 0) XOR (yFlip ? 2 : 0)` (bit 0 the X half, bit 1 the Y half —
   PPUCTRL's own two nametable-select bits, composed independently per axis, so a corner packet that
   crosses BOTH seams at once XORs both bits, reaching the diagonally-opposite nametable of the
   four-screen ring, review 8's own "the full four-screen ring is 64×60 tiles" made concrete: 2 X
   halves x 2 Y halves x one nametable's own 32x30 tiles = 64x60). Then, since a nametable is 960
   bytes and `physRow*32` does not fit in one byte for `physRow >= 8`: `addrLo = ((physRow AND 7)
   << 5) OR physCol`, `addrHi = ($20 + ntIndex*4) + (physRow >> 3)` — exact 6502 arithmetic (no
   16-bit multiply: `physRow`'s low 3 bits shift into the top of the low byte, its own top 2 bits
   add directly into the high byte), verified against `box_row_addr`'s own existing ordinary-screen
   case as a control (`physRow` 24-29, `ntIndex` fixed at nametable 0 -> `addrHi = $20 + 3 = $23`,
   `BOX_ADDR_HI` exactly, and `addrLo` for `physRow=24,physCol=0` is `(24 AND 7)<<5 = 0`, matching
   `box_row_addr`'s own `row*32` for `box_row=0`).
4. **The packet writer splits at exactly the column where the mod-32 wrap occurs**, emitting TWO
   `vram_buf` packets for a row that crosses (first packet: the columns up to the seam at the BASE
   `ntIndex`, second: the remainder at `ntIndex` with the X bit flipped, each with its own 3-byte
   header and its own `addrHi`/`addrLo` from item 3) — or one, unchanged, for the aligned case
   (`camXTile mod 32 == 0`).

**SUPERSEDED (review 8, finding 3, bullet 3) — the packet-byte arithmetic was wrong.** This section
previously said a split row costs "35 total packet bytes... adding one more 3-byte header," which
undercounts: going from one packet to two does not add ONE header to an existing 35, it adds a
WHOLE SECOND packet. **The corrected count**: a split 32-tile row is two packets, each carrying
part of the 32 payload bytes and its OWN 3-byte header — `32 + 2*3 = 38` packet bytes, not 35 (the
existing 32-payload-bytes-per-row-per-frame cap is still unchanged in total PAYLOAD, only the
header count doubles). With a coincident 32-byte Flash palette packet drained the SAME vblank
(decision 1's own mixed-vblank mechanism, fix round 11 — `MIXED_VBLANK_MAX_BYTES=35` is the ceiling
a single packet must fit under to qualify; the row's OWN two packets are checked against it
individually, not summed, since the mixed-vblank branch tests `vram_len` once per NMI against the
WHOLE queue, so a queue already containing 38 split-row bytes plus 35 Flash bytes is 73, routed to
exclusive drain rather than the reduced-chunk path — see the Mesen timing below, which measures
this exact 73-byte, three-header shape rather than assuming it): `38 + 35 = 73` packet bytes, three
headers total (two for the split row, one for Flash), plus the queue's own one-byte `$00`
terminator (39 bytes of `vram_buf` occupied for the row alone, 74 combined with Flash) —
comfortably inside `vram_buf`'s 256-byte budget either way, but the number that must actually be
Mesen-timed, not the retracted 35/70-byte figures a single-packet-per-row design would have used.

**Every text/choice/clear/name-token destination routes through this ONE mapper, not four
different ones**: `box_row_addr` (the border frame), `box_text_row_addr` (interior text rows —
`text_put_char`, `text_clear_step` inherit it), `text_arrow_write` (the page-turn prompt, a
single-tile write, unaffected by the split rule — one tile is never wider than the seam it might sit
beside), `choice_cursor` (identical — a single fixed-offset tile within a row already resolved by
`box_text_row_addr`), and naming's own `nameentry_queue_cell` (finding 7, above). The `{name}` token
(`text_type_name`) writes through `text_put_char` already, so it inherits the mapper with no change
of its own.

**Attributes: 27 bytes, not 16, not contiguous — the real worst case, and the real restore
schedule.** A 16-metatile-wide band starting on an ODD metatile column touches 9 attribute columns
(not 8 — the review's own independent enumeration, confirmed by hand: 8 whole columns plus one
partial column straddling the band's own right edge); three metatile rows starting at physical
metatile row 13 touch attribute row 6, the half-height row 7 (covering metatile row 14 alone — a
physical nametable is 15 metatiles / 30 tiles tall, an ODD metatile-row count, so its own 8th
attribute cell row has no same-nametable content below it, matching `sw_rw_attr_bl`/`br`'s own
already-proven zero-contribution convention), and row 0 of the NEXT, vertically-stacked nametable —
**three attribute rows, one of them a real nametable seam of its own, distinct from the horizontal
one above.** `3 x 9 = 27` — a full, non-degenerate rectangle at this specific origin (band origin
`(1,13)`, the review's own cited worst case), so no cell is saved by clipping.

**The restore packet schedule (specified, not yet Mesen-timed): at most 6 packets, not 1.** The 27
bytes are not one contiguous run — each (nametable, contiguous-column-run) pair needs its own
packet, since crossing either a horizontal (X) or vertical (Y) nametable seam changes the `$23C0`-
style attribute-table BASE address, not merely the offset within one. Worst case: 3 attribute rows
x up to 2 nametable-halves per row (a horizontal seam splits a row's own 9 columns into two runs,
the same split rule the terrain packets already use) = **up to 6 packets, 27 data bytes total plus
up to 18 header bytes (3/packet) = 45 bytes**, each packet's own payload comfortably under 32 —
**spread over as many frames as packets** under the existing one-producer-per-vblank discipline
(6 frames, worst case, for the attribute restore alone, up from the ordinary screen's own single
16-byte/one-frame attribute packet).

**SUPERSEDED (review 8, finding 3, bullet 4) — "choose one shadow rule and keep it," done, with
explicit masks.** `attr_shadow` is the single terrain-truth source and **is never written by the
box, on open or close** — the box only ever mutates the PHYSICAL PPU byte, always through the SAME
formula, restated here as the one rule this design keeps: **`overlay = (terrain AND (NOT mask)) OR
(boxPalette AND mask)`**, where `terrain` is the current `attr_shadow` byte at that torus position,
`boxPalette` is `$00` (background palette 0, unchanged), and `mask` covers ONLY the quadrant bits
this specific byte has inside the band — never the whole byte, so quadrants outside the band but
inside a touched byte survive untouched by construction, not by a separate preservation step.
**The mask, given explicitly** (closing "untouched quadrants inside a touched byte still need
preservation" — review 7 — with the actual bit values, not just the principle): a quadrant byte
packs `TL OR (TR<<2) OR (BL<<4) OR (BR<<6)` (CLAUDE.md's own `screenAttributes` layout, `attr_shadow`
inherits it verbatim). For one of the box's three metatile-rows, `rowHalf = bandMetatileRow mod 2`
picks the row's own quadrant PAIR: `rowHalf=1` (odd, e.g. metatile row 13) touches the BOTTOM pair
(`BL`/`BR`, mask bits `$30`/`$C0`); `rowHalf=0` (even, e.g. metatile row 14, or row 0 of the next
Y-nametable) touches the TOP pair (`TL`/`TR`, mask bits `$03`/`$0C`). Within that row, each of the
(up to 9) attribute-byte COLUMNS covers metatile columns `{2k, 2k+1}`: `touchLeft` is true when
metatile column `2k` falls inside the band's own 16-wide run, `touchRight` likewise for `2k+1` — a
MIDDLE byte (both true) gets the full row-half mask (`$30|$C0=$F0` or `$03|$0C=$0F`); the band's own
LEFT edge byte, when the band starts on an odd metatile column (the `(1,13)` worst case), has
`touchLeft=false` (that quadrant's metatile column is the one immediately outside the band, whose
own content is authored terrain the box must not disturb, whether it happens to be currently
visible one row up or presently off the left edge of the viewport) — mask is the RIGHT quadrant
alone (`$C0` or `$0C`); the RIGHT edge byte mirrors this (`touchRight=false`, mask is the LEFT
quadrant alone, `$30` or `$03`). This is exactly the general form of the already-specified 8-whole-
plus-1-partial-column count (review 7): the partial columns are the two edges, each masked to one
quadrant; the other 7 are masked to the full row-half.

**Open uses the masked formula above; close does not need to, and is simpler because of it.**
Because open's masked write NEVER touches the outside-band quadrants of any of the 27 bytes, those
quadrants are byte-identical to `attr_shadow` for the ENTIRE time the box is up (the strip is
gated off the whole transaction — the pending-strip rule, below — so `attr_shadow` itself cannot
drift either). Close can therefore write the WHOLE byte from `attr_shadow`, unmasked, at each of
the same 27 positions: the untouched quadrants land back at the value they already had, and the
box's own quadrants land back at real terrain — one unmasked `lda [shadow],y : sta $2007` per byte,
no mask math on the close path at all. This is the "one shadow rule, kept" the finding asked for:
mask on the way in, plain restore on the way out, because only the way in can ever clobber
something the box does not own.

**SUPERSEDED (review 8, finding 3, bullet 4) — open's own attribute packets were left at "a single
frame," contradicted two paragraphs later.** Open needs the IDENTICAL up-to-6-packet schedule
close already has (three attribute rows x up to two nametable-halves per row, the same X-seam split
rule the terrain packets use, `main/build` review 7's own 27-byte/6-packet count) — a masked write
is no cheaper to schedule than an unmasked one, since both are one `vram_buf` packet per
(attribute-row, nametable-half) run, differing only in whether the payload byte is computed with
the mask formula (open) or read straight from `attr_shadow` (close). **The real open/close frame
counts, corrected**: `text_open_step`'s own 6 row-frames (`text.asm:299-343`'s six row-advance
steps, unchanged pacing, still one `vram_buf` packet per frame per row, now sometimes two packets
where a row splits — the payload-byte-per-frame cap is unchanged, only the header count grows,
finding 5 above) PLUS **up to 6 masked-attribute frames, not the ordinary screen's single 1-frame/
16-byte packet** — **open is up to 12 frames, not "0 extra"; that earlier claim is retracted, not
merely re-derived.** Close is the same shape: 6 row-rebuild frames (unchanged pacing) plus up to 6
unmasked-attribute-restore frames = **up to 12 frames, not 7.** Worst case for the whole
transaction, open through close, is therefore **up to 24 frames** (0.4s at 60Hz) — a real, disclosed
cost, still with zero forced blank either direction and still far short of the retracted ~28-35
frame full-redraw/blank figures two rounds ago. The BEST case (camera already nametable-aligned,
`camXTile mod 32 == 0` and the band's Y range not crossing 30) is unchanged at 7+7=14 frames, the
figure the ordinary non-streamed screen always pays.

#### Round 9 (review 7): the dialogue transaction's own state machine, finding 6

**`box_begin` draws nothing — the reviewer's own correct reading.** `text.asm:187-205` only sets
`box_state`/`box_after` and returns; for an OWED event (an entry event or a touch trigger),
`settle_owed` returns nonzero and `main_loop` jumps straight to drawing, so the FIRST
`text_open_step` runs on the frame AFTER `box_begin`, not the same one. The design's own earlier
"the nudge lands with the first row, same vblank" claim conflated "the nudge CAN be applied on
`box_begin`'s own frame" (true — a plain register store, cost-free whenever it runs) with "the
box's first VISIBLE row lands that same frame" (false). **Corrected**: the nudge is applied on
`box_begin`'s OWN frame (not the first drawn row's) — a register store has nothing to wait for —
so by the time `text_open_step` actually runs (whichever frame that is), the camera has already
settled at its aligned position for at least one full frame, which if anything is SAFER than
same-frame publication, not a defect: no drawn row can ever race a still-in-flight nudge.

**The camera rounding/tie/clamp rule, specified.** "Nearest 16px" rounds to the CLOSER of the two
bracketing multiples of 16 on each axis independently; an exact tie (camera pixel position ending
in `...8`, equidistant from both) rounds toward the CURRENT direction of travel if known, else
DOWN (the same direction `sw_clamp_col`/`row`'s own far-edge clamp already rounds, decision 3's own
established convention, reused rather than inventing a second tie rule).

**SUPERSEDED (review 8, finding 3, bullet 1) — nametable parity is not tile parity.** This section
previously said: *"Rounding UP crosses a physical nametable boundary exactly when the pre-round
camera position's own tile coordinate is odd and rounding pushes it to the next even tile."* That
claim is false and is retracted, not merely reworded: rounding tile 9 up to tile 16 (both inside
the first 0-255px span) never crosses a nametable, and the false rule would have flipped `cam_nt`
on every single odd-to-even rounding regardless of where the 256px/240px extent actually falls.
**The corrected rule, derived from the aligned absolute camera coordinate the mapper (finding 5)
already computes from, not from tile parity at all**: `cam_x_lo`/`cam_y_lo` are themselves already a
remainder-and-quotient pair by construction — `cam_x_lo` (0-255) is the low byte of the camera's
world-pixel X position, and `cam_nt` bit 0 is that position's own 256px quotient, mod 2 (identically
for Y: `cam_y_lo` 0-239 is the remainder of a 240px division, `cam_nt` bit 1 the quotient mod 2).
Nudging is therefore an ordinary bounded add/subtract of at most 15 in that SAME representation —
literally the identical carry/borrow arithmetic `camera_slide_tick`/`camera_slide_tick_y_inc/dec`
(`engine/camera.asm`) already perform for a slide, just a one-time jump instead of a per-frame
step: `cam_x_lo + delta` overflowing 256 (an ADC carry) crosses the X nametable boundary and flips
`cam_nt` bit 0 by exactly that carry, `cam_x_lo - delta` underflowing below 0 (an SBC borrow) does
the same in the other direction; `cam_y_lo + delta >= 240` (an explicit compare, 240 not being a
power of two, the same reason `camera_slide_tick_y_inc` compares against 240 rather than masking)
crosses the Y boundary and flips `cam_nt` bit 1, likewise `cam_y_lo - delta < 0` (compared as
`cam_y_lo - delta`, then `+ 240` on borrow). **Worked examples**: pre-nudge `cam_x_lo=140`, nearest
16 is 144 (delta +4) — no carry, `cam_nt` bit 0 unchanged, matching "X=9(tile)→16(tile) stays inside
the same nametable" from the finding. Pre-nudge `cam_x_lo=250`, nearest 16 is 256≡0 (delta +6) — an
ADC carry, so `cam_nt` bit 0 DOES flip here, the boundary genuinely crossed. Pre-nudge
`cam_y_lo=232`, nearest 16 is 240≡0 (delta +8, a tie broken toward travel or down) — the 240 compare
fires, `cam_nt` bit 1 flips. This closes finding 3's bullet 1 by construction: the flip test is a
literal carry/borrow/compare on the SAME bytes the mapper (finding 5) reads, never a separate
"was the tile odd" question. **The mapper's own quotient/remainder, restated to match**: `camXTile
= cam_x_lo/8` (0-31, always even since `cam_x_lo` is 16px-aligned) and `camYTile = cam_y_lo/8` (0-29,
always even) are the WITHIN-nametable tile remainders finding 5 already uses; `cam_nt`'s own two
bits are the CROSSING quotients (mod 2) for the whole viewport's origin, established once by this
nudge, not re-derived per row/column — finding 5's own per-row/per-column crossing (below) is a
SEPARATE, later question (does THIS box row/column run push past the *edge* of the nametable
`cam_nt` already names), not a second parity rule.

The nudge writes camera pixel AND (when the carry/borrow/compare above says so) `cam_nt` together,
through the SAME `cam_dirty`-guarded publication decision 1 of item 12's own design already
established (raised before the first store of the pair, released after the last).
**The clamp**: the already-specified decision 3 clamp (`clamp(nudged, 0, max(mapPixels -
viewportPixels, 0))` per axis) applies to the NUDGED value, exactly as decision 3's own text
already states — restated here because finding 6 asked for the interaction to be stated
explicitly, not because it changes.

**The viewport origin, corrected — `sw_dlg_metatile`'s own accessor adds 12 rows internally, so
its caller must pass the ALIGNED CAMERA's own viewport-relative origin, not "the box's top-left."**
The existing built accessor (decision B's own text, above) already documents this internally
(`sw_dlg_rbrow`'s own `adc #12`); the PROSE describing its caller was the part that called the
input "the box's own top-left metatile position" — corrected here to: the caller passes the
ALIGNED CAMERA's own world-tile origin (post-nudge, post-rounding), and the accessor's own `+12`
is what advances from the viewport's own top row to the box's own first row (row 12 of the 15-
metatile-tall viewport) — supplying the box's literal top-left instead would double-count that
offset and read terrain twelve rows too low, exactly the failure mode the review named.

**SUPERSEDED (review 8, finding 3, bullet 5) — publication allowed "the SAME frame or later" for
sprite projection, which is not an order at all.** Given a concrete frame boundary, "same frame or
later" cannot answer whether NMI ever draws a frame whose OAM shadow was built from the OLD camera
while `$2005`/`cam_nt` have already moved to the NEW one — exactly review 8's own concern. **The
actual order, read out of the existing code, not merely asserted**: the nudge is applied wherever
`start_dialog`/`box_begin` first runs, which is reached from `settle_owed` (`engine/boot.asm:175`,
BEFORE `dispatch_input`, CLAUDE.md's own "work owed is settled before `dispatch_input`" rule) — and
`build_oam`/`draw_entities` (`engine/boot.asm:266-267`, `main_loop_draw`) run LATER in that exact
same mainline pass, unconditionally (skipped only by a live battle, `:264`, which cannot coincide
with opening a field dialogue). So on the frame `box_begin` runs: `cam_x_lo`/`cam_y_lo`/`cam_nt` are
written FIRST (inside `settle_owed`'s own call chain, under `cam_dirty`), and `build_oam` — which is
what makes sprite projection real, not merely "re-derived every frame" as an abstract property —
runs SECOND, in the SAME frame, off the ALREADY-nudged bytes. **This closes the finding by
construction of the EXISTING main-loop order** (`settle_owed` before `main_loop_draw`), not by a
new synchronisation primitive or a "same frame or later" hand-wave: there is no frame at which NMI
can observe a new camera against an OAM shadow built from the old one, because the OAM shadow for
that very frame is built strictly after the nudge, in mainline, before NMI ever runs. The box's own
VRAM writes (finding 5's mapper) begin whichever LATER frame `text_open_step` actually runs (the
box draws nothing on `box_begin`'s own frame, CLAUDE.md's already-established rule below), reading
the by-then long-settled aligned camera — so camera, nametable-select and sprite projection are
never observed inconsistently at any single frame boundary, for a reason stated in terms of actual
call order, not merely claimed.

**SUPERSEDED (review 8, finding 3, bullet 5) — `text_close_attr` setting `BOX_CLOSED` the instant it
QUEUES the last restore packet, not when it DRAINS, is a real (if rare) race.** Ordinarily a packet
queued during one frame's mainline pass drains in that SAME frame's own vblank (CLAUDE.md's own
`vram_buf` rules), so "queued" and "drained" coincide in wall-clock terms almost always — but a
frame that ran long leaves `vram_ready` clear and defers the drain to the NEXT vblank (the
documented exception), and `text_close_attr` sets `box_state = BOX_CLOSED` unconditionally right
after `vram_end`, with no dependency on whether THAT drain actually happened yet. If tracking
resumption is gated on `box_state == BOX_CLOSED` alone, an overrun frame lets tracking resume — and
therefore lets a new strip arm — one frame before the box's own final restore packet has actually
reached VRAM, a genuine window for a fresh strip write to race the still-in-flight restore. **The
fix, one extra AND on an already-read byte**: the un-nudge/tracking-resume check (below) is
`box_state == BOX_CLOSED AND vram_ready == 0` (queue fully drained), never `box_state == BOX_CLOSED`
alone — free in the overwhelmingly common case (both are already true the same frame), and closes
the overrun case definitively rather than assuming the overrun never happens.

**The freeze is held for the WHOLE transaction, open through close, not merely across the open
nudge**: `game_state`'s own existing dialogue-freeze gate (unchanged) already covers this — camera
TRACKING (the continuous per-frame re-centring a streamed map otherwise performs) is what stops,
not camera PUBLICATION (which keeps running every vblank, republishing the same settled aligned
position each frame, the "coherent-stale-frame" policy already established for `cam_dirty`).
Tracking resumes the frame after the close-time restore's own last packet has drained — a
`box_state == BOX_CLOSED` check already gates the resumption point, since that is exactly the
existing signal every other dialogue-adjacent system already keys off.

**WITHDRAWN (review 8, finding 3, bullet 6, verbatim) — "the disjoint by construction argument is
withdrawn: tile-disjoint does not mean attribute-byte-disjoint, and a strip armed before the freeze
keeps drawing on later vblanks."** The paragraph this replaces argued the box's fixed aligned band
and a finishing strip's own pre-freeze-committed ring positions can never address the same physical
TILE — true, but not the question: the review's own reproduction (camBlockY=100, old window Y=86,
lag 7, arming down to row 116, camera advancing to 101 before the strip finishes, dialogue band at
rows 113-115) shows row 115 (dialogue) and strip row 116 sharing an ATTRIBUTE BYTE despite owning
different TILES — attribute granularity is coarser than tile granularity, so tile-disjointness does
not imply the byte-level disjointness the masked-overlay formula (above) actually depends on. A
full geometric proof of attribute-byte separation across all four directions, every seam, and the
map clamp, at the now-proven lag<=2 bound (fix round 11b), is the OTHER option the review offered
and is explicitly NOT attempted here — it is a materially larger proof obligation than this round's
own scope (the dialogue overlay alone), and the brief for this round permits the alternative:

**The rule adopted instead, explicit rather than proved geometrically: a box does not open while a
strip is active.** `box_begin` (or the field's own call into it) checks `st_active` first; if
nonzero, the open is DEFERRED — no nudge, no state change — until the currently-running strip
reaches `st_active == 0` on its own (arbitration already guarantees it runs to completion once
armed, decision A), at which point the deferred open proceeds exactly as already specified. **The
added latency is bounded and small**: the two strip shapes are a column strip (30 blocks at
`SW_STREAM_CHUNK=3` = 10 vblanks) and a row strip (32 blocks = 11 vblanks) — **at most 11 vblanks
(~0.183s) of extra wait**, and the world is ALREADY frozen for the whole wait (an event that reaches
`box_begin` has already stopped gameplay via the ordinary `game_state` transition, so the extra 11
vblanks are invisible latency before the box's own frame-by-frame raise starts, not a visible stall
mid-animation). **Nothing arms while the box is up**, restated rather than re-argued: the freeze
(no new crossing demand accrues) already holds for the whole open-through-close transaction (above),
so once the deferred open actually begins, `st_active` stays zero for the remainder of the
transaction by the same argument the withdrawn paragraph made correctly about NEW arming, just not
about a strip already in flight — which this rule now excludes by construction, having waited for
it first. This closes finding 6 without a per-geometry proof: the box's own traffic and a strip's
traffic are never both live at once, so there is no attribute byte either could disagree about.

**Same-box reuse, nested ownership, and Shake — specified.** `box_begin_clear` (same-box reuse,
e.g. one `Say` page's box staying open into the next) does not re-nudge or re-clamp — the camera is
already aligned from the FIRST open in the sequence, and re-deriving the same aligned value a
second time is idempotent, so the simplest correct rule is: nudge only on the transition INTO
`box_state != BOX_CLOSED` from `BOX_CLOSED`, never on a same-box continuation. A nested menu/save
exit while a dialogue's own aligned camera is already active must NOT trigger a premature
un-nudge/rebuild (the existing caveat, decision B's own text above) — concretely, the un-nudge/
rebuild is owned by whichever overlay's OWN close is the outermost one, tracked the same way
`box_after`/`box_state` already track a single owner today; a second, inner overlay opening while
the outer one is still up reuses the SAME already-aligned camera rather than re-nudging. **A running
Shake** composes AFTER the camera rewrite exactly as it already does today (`nmi_scroll`'s own
`±2` composition, unchanged code) — since the aligned camera is a fixed value for the whole
transaction, Shake's own `±2` perturbation is visually identical to a Shake during ordinary
stationary dialogue on a non-streamed screen (a 2px sliver of the horizontally-adjacent nametable,
the same accepted, documented cost CLAUDE.md's own camera section already names) — no new policy
needed, restated rather than newly specified.

**SUPERSEDED — "not built or Mesen-proven this round" no longer describes the current state.** Round
12 (below) builds and Mesen-times the mapper/packet-writer (finding 5), the masked/unmasked
attribute open and close (finding 3 bullet 4), and the pending-strip gate (finding 6); naming's own
reroute (finding 7) is unchanged and still not separately exercised (it reuses the same primitives,
per its own text above, and this round's scope was the dialogue overlay, not naming).

#### Round 12 (review 8, finding 3): the prototype built, and what it found

**Built and proven this round, real 6502 assembled into the scratch prototype
(`proto-tools/dlg_fix12.asm`, injected into `minimal-u512`'s own never-shipped bank-14 test slot),
exercised via real `vram_open`/`vram_push`/`vram_end`/`vram_drain` — the actual engine packet
mechanism, not a simulation of it:**

- **The address mapper** (`sw_dlg_yinfo`/`sw_dlg_seamx`/`sw_dlg_addr`), computing the exact `$2006`
  hi/lo pair from `cam_x_lo`/`cam_y_lo`/`cam_nt` plus a logical row/column offset, verified against
  `box_row_addr`'s own ordinary-screen case as a control (physical row 24-29, nametable 0 → hi
  `$23`, matching `BOX_ADDR_HI` exactly) before trusting it on a streamed origin.
- **The split-at-seam packet writer** for terrain rows (`sw_dlg12_open_row`/`close_row`) and for
  the up-to-9-byte-wide attribute band (`sw_dlg12_open_attr`/`close_attr`), both routed through the
  shared mapper.
- **The masked attribute open, with the corrected formula from finding 3 bullet 4 above** —
  `overlay = terrain AND NOT mask`, `mask` computed per byte from row-half and column-edge
  touch — and the unmasked close restore.
- **The pending-strip gate** (`sw_dlg12_can_open`), implementing finding 6's adopted explicit rule.
- **A single-tile write path** (`sw_dlg12_write_tile`) for the choice cursor / typed characters /
  the `{name}` token, proving finding 5's "every destination routes through this ONE mapper" claim
  directly rather than by inspection.

**Readback proof** (`proto-tools/dlg_fix12_readback.mjs`, jsnes, two independent oracles — an
address/mask model written from this document's own equations, never transcribed from the
assembly, and the existing r2 fixture's own published terrain formula plus the ROM's real
`mt_tl`/`tr`/`bl`/`br` tables read back, never recomputed) at five origins: the seam-crossing
`(1,13)` band start the review cited, fully inside one nametable, X-seam-only, Y-seam-only, and a
map-edge nudge at the camera clamp (exercising the fill path in the same transaction as everything
else). At every origin: every box tile lands at the mapper's own computed address with the right
border content on open and real terrain on close; every touched attribute byte is exactly the
masked overlay open expects (verified against attribute bytes independently pre-seeded with a
distinct-per-position, never-uniform pattern, so a masking bug clobbering an untouched quadrant is
caught, not hidden); every byte OUTSIDE the touched tile/attribute sets is provably unchanged
across the whole transaction; a typed-character write and a choice-cursor-shaped write both land
correctly; and close leaves the whole four-nametable space byte-identical to a REALISTIC pre-open
state (the box's own six rows pre-rendered with real terrain via the identical independent oracle,
not jsnes's blank canvas — the naive "compare against blank" version of this check is a false
positive, since close is correctly supposed to leave real terrain there, not zeros). The
pending-strip gate is exercised directly: `st_active=0` clears to open, `st_active!=0` defers.
`node proto-tools/dlg_fix12_readback.mjs` — exit 0, all checks pass at all five origins.

**A real defect this round's own prototyping found, not anticipated by review 8 or any prior
round**: when the box's own start metatile row is exactly EVEN (the aligned camera lands exactly on
an attribute-row boundary — the "fully inside one nametable" and "map-edge nudge" origins above both
hit it), two ADJACENT band rows are BOTH entirely inside the box and BOTH map to the SAME physical
attribute byte's two row-halves. Applying finding 3 bullet 4's masked formula independently per band
row is wrong there: each computes its overlay from pristine `attr_shadow`, so the second row's own
write undoes the first row's already-correct half (caught by real PPU readback — the queued packet
bytes were individually correct, but the SECOND band row's own packet overwrote the first's). The
fix needs no PPU read-back (illegal outside forced blank/vblank on real hardware, and unnecessary):
when two band rows share a byte they are BOTH always inside the box, so that byte's entire
row-portion is unconditionally box palette regardless of write order — forcing BOTH sides to the
FULL mask (`$33`/`$CC` in place of the single-half `$03`/`$30`/`$0C`/`$C0`) makes the write
idempotent and correct either order, with no cross-call state needed beyond precomputing each band
row's own `(ayflip,arow)` once and comparing adjacent pairs (`sw_dlg_attr_rows_precompute`/
`sw_dlg_attr_forcefull_for`). Close needs no equivalent fix: its unmasked whole-byte restore was
already order-independent. This is a genuine addition to finding 3's own mask rule, not a
correction of anything review 8 said — logged here rather than silently folded into the "masked
formula" text above, so a future round can see it was found empirically, not derived on paper.

**Frame counts and worst queue, measured, better than the pre-round-12 arithmetic assumed.** Each
`open_row`/`open_attr`/`close_row`/`close_attr` call is one real `vram_buf` transaction — the
production shape of one packet-build-then-drain per frame. Measured across all five origins:
**9 frames to open (6 rows + 3 attribute-row transactions, not 12)**, **9 to close (same shape)**,
**18 total** — better than the "up to 12+12=24" estimate above, because a split row's own TWO
packets (up to 38 bytes together) and a split attribute band's own two packets (up to 15 bytes
together) are queued and drained TOGETHER, one drain per band row, not one drain per packet. This
is safe, not merely convenient: the worst single-transaction queue measured is **38 bytes** (a
split terrain row, two 3-byte headers + 32 payload, finding 5's own corrected arithmetic, above),
comfortably under every exclusive-drain queue already Mesen-proven safe by earlier rounds. Best
case (camera already nametable-aligned) is unchanged at 14 frames (7+7, the ordinary screen's own
figure).

**Mesen timing, the worst single-transaction queue, both boards, Shake active, MMC3 split forced to
its longer `SPL_BOX` program** (`proto-tools/build_dlg_drain_fixture.mjs` +
`sw_dlg_drain_timing.lua.template`, the real, unmodified, already-shipping exclusive `vram_drain`
path — no streaming code is involved at all, since the pending-strip gate means no strip is ever
active while a box's own queue drains): a 38-byte queue (two packets, 16+16 payload — any split of
the 32 payload bytes into two packets times identically, since each `$2007` write costs the same
fixed cycles regardless of address/value) drains inside vblank on both `sample-u512` and
`sample-mmc3`, exit 0. A stress double (76 bytes, two split rows combined into one hypothetical
transaction — not what this design actually does, since each row is its own frame, but tested as a
"one more row" comparison) ALSO passes on both boards, exit 0 — this design's real worst case has
ample margin. Pushing further to find where the existing exclusive-drain mechanism (not anything
new this round) actually misses: MMC3 misses first, at 5 stacked 32-byte packets (175 bytes, exit
5/`EXIT_DEADLINE_MISS`); UNROM 512 tolerates one more (misses at 6 packets/210 bytes, passes at
76). Both boundaries sit roughly 4-5x this design's own real worst case, consistent with — not a
new proof of — decision A's own established exclusive-drain margins from fix rounds 7-11.

**Code size and placement, from `main.fns`'s own symbol spans** (this round's own routines,
`sw_dlg12_*`/`sw_dlg_addr`/`sw_dlg_yinfo`/`sw_dlg_seamx`/`sw_dlg_attr_*`, prototype-placed in the
same never-shipped bank-14 slot `sw_dlg_metatile` already occupies — PRG register 7, $8000-$9FFF):
bank 14 usage went from 884/7,308 bytes (this round's file, correctness fixes applied, before the
merge-detection addition) to **1,036/7,156 bytes** with it. This round's own code occupies
`$86AC-$89F5` (`sw_dlg12_open_row` through the end of `sw_dlg12_can_open`, `main.fns`'s own symbol
addresses) — **approximately 841 bytes**, injected immediately after `sw_dlg_metatile`'s own
existing `$8600-$86AC` span (172 bytes, unchanged this round). This is prototype placement
only, exactly like `sw_dlg_metatile` before it — the real engine allowance is a new, unmeasured
kernel-lo `*_KERNEL_ALLOWANCE` term, "The kernel budget"'s own discipline, not claimed here.

**RAM**: 35 new zero-page bytes, `$C7-$E9` for the mapper/packet-writer/attribute-mask scratch
(`sw_dlgw_lograw` through `sw_dlgw_canopen`) plus `$EA-$F1` for the merge-detection addition
(`sw_dlgw_ay0`/`ar0`/`ay1`/`ar1`/`ay2`/`ar2`/`forcefull`/`mergetmp`) — prototype scratch, freely
reused across calls since none of this runs at interrupt time or concurrently with itself (the same
convention `sw_tmp`-`sw_tmp6` already establish for the cold-path code this composes). Zero page
had 56 free bytes after `$C7` per review 8's own accounting; this prototype uses 35 of them,
**21 remain**. The existing `$03DA-$03E3` dialogue bytes (`sw_dlg_cam_x_lo/y_lo`,
`sw_dlg_metatile`'s own origin/scratch) are unchanged and reused as-is — this round adds no new
byte there, since the mapper reads `cam_x_lo`/`cam_y_lo`/`cam_nt` directly rather than needing its
own copy.

**What is still not built or Mesen-proven**: naming's own reroute onto this same path (finding 7);
the real nudge/rounding computation itself (this round's test pokes the aligned `cam_x_lo`/
`cam_y_lo`/`cam_nt` directly, matching decision 1's own "camera register fed continuously... not
built this round" scope boundary — the carry/borrow arithmetic in the corrected rounding rule above
is unchanged, established engine code (`camera_slide_tick`), not new code this round adds or
tests); wiring any of this into the real `box_begin`/`text_open_step`/`text_close_step` state
machine (still `ui_tick`/`main_loop` production work, phase 2 per review 8's own exit list); and the
`box_state`/`vram_ready` resumption-gate fix (finding 3 bullet 5, above) has no runtime to exercise
it against yet, since that requires the real state machine.

### Decision 3 — small maps: fill-metatile padding, with three separate bounds

**Chris, 2026-09-17: rows and columns outside the authored grid are padded with a fill metatile —
a per-map field, named `fillMetatileId`, default 0 — and collision outside the map is a wall.
One-high and one-wide maps stay in scope.** Review 4's own finding 1 named the exact confusion this
decision resolves: fix round 4's clamp routines conflated three genuinely different bounds under
one name. Specified separately:

1. **The window/viewport clamp** — `sw_clamp_col`/`sw_clamp_row` (§3/finding 2, unchanged): keeps
   the resident 32×30 window's own origin inside a map **at least as big as the window on that
   axis**. This clamp applies **only on an axis where the map's own extent exceeds the window's**
   (32 blocks wide / 30 tall) — a map narrower or shorter than the window on a given axis has
   nothing to clamp *to* on that axis, and the terrain-padding bound (below) is what makes reading
   past its edge safe instead. `sw_clamp_col`/`row` themselves are unchanged by this decision; the
   decision is that they are not the *only* bound a small map needs, which the next two points
   supply.
2. **The terrain-padding bound, built and proven this round (review 5, finding 2)**: every
   torus/window read that would otherwise land outside the authored grid — whether because the grid
   is smaller than the window on that axis, or because a window origin near a large map's own far
   edge still has some in-range columns/rows adjacent to out-of-range ones — yields
   `fillMetatileId` **by construction**, never `$FF` and never a stale or uninitialised byte.
   `sw_terrain_or_fill` (`streamworld.asm`) is this bound: it checks the resolved `(screenCol,
   screenRow)` against `sw_grid_w`/`sw_grid_h` **before** attempting any `sw_goto` at all, in *both*
   directions at once — an unsigned `cmp`/`cpx` against the grid dimensions catches a
   wrapped-negative resolved coordinate (`screenCol=255`, the 8-bit wrap of "one past the left
   edge") the identical way it catches one past the right edge, with no separate sign test.
   Proven (`proto-tools/diag_r5_fill.mjs`, five cases): the reviewer's own exact reproduction
   (`sw_grid_w=sw_grid_h=1`, screen `(1,1)`) now returns fill, not fixture data; in-bounds reads are
   unaffected; a nonzero authored fill id is honoured; a wrapped-negative coordinate hits the same
   fill path; and a real 3×3 grid reads every one of its nine real screens correctly while the
   immediate surrounding ring reads fill.
   **Validated against the map's own tileset, per finding 2's own explicit demand**: `fillMetatileId`
   is an ordinary metatile reference, so it is refused by the same `validateProject` check any other
   out-of-range metatile id on the map's own tileset already fails — no new validation mechanism,
   reusing the existing one.

   **Round 10 (review 8, finding 4) — `sw_terrain_or_fill` being proven was necessary but not
   sufficient: it was the map's ONLY fill-aware reader until this round, and neither mainline strip
   arm nor the full renderer called it at all.** `sw_stream_start_col`/`row` and `sw_render_window`
   (both terrain and attribute reads) each did their own `jsr sw_goto` + `lda [mtptr_lo],y` directly,
   inline, with no bounds check — a real, disclosed gap `sw_terrain_or_fill`'s own proof never closed,
   since building a strip or a full render never actually calls it. Fixed by giving each consumer its
   own bounds check using the identical unsigned `cmp sw_grid_w` / `cpx sw_grid_h` test
   `sw_terrain_or_fill` already established, rather than routing every single byte through a
   per-byte wrapper call (not required — see finding 4's own "a fill-aware bulk primitive is
   acceptable"): `sw_stream_start_col`/`row` check once per block, before the existing relocate-cache
   test, and substitute `sw_fill_metatile_id` with no `sw_goto` at all when out of bounds (the
   entering screen for a column strip, or the walking screen for a row strip, can each independently
   be out of bounds, checked separately); `sw_render_window` gained one new shared routine,
   `sw_rw_read_metatile`, checking a new `sw_rw_oob` flag that `sw_rw_probe` (terrain) and
   `sw_rw_attr_y_combine` (attribute) each set from the identical bounds test before deciding whether
   to relocate — every one of the renderer's three `[mtptr_lo],y` dereferences (two terrain, one
   attribute) now goes through that single routine. `sw_strip_fetch_run_col`/row` (fix round 8's own
   banked primitive, above) needed the same fix — a single call always targets exactly one screen
   (the arm splits a multi-screen strip into one call per segment), so it checks bounds once and
   either fills the WHOLE requested run or reads the WHOLE run for real. After this fix there is no
   raw `jsr sw_goto` + `[mtptr_lo],y` dereference left in any of these four consumers — confirmed by
   grep, not by inspection alone.

   **Proven**, real 6502 execution, `minimal-u512`'s own real 3×3 fixture, no new ROM needed for the
   small-grid cases (`sw_grid_w`/`sw_grid_h` are RAM bytes a test pokes smaller than the fixture's
   real physical extent — a screen beyond the announced grid is unreachable by these routines
   regardless of what real data sits behind it in ROM, exactly proving they respect the two bytes
   rather than the ROM's own physical shape): `proto-tools/diag_r10_smallgrid.mjs`, **528
   observations, ALL PASS** — both strip arms in both directions (an in-bounds entering edge and an
   out-of-bounds one), and the full renderer's terrain AND attribute output, on a 1×1 grid, a 1×3
   grid (1×N), a 3×1 grid (N×1), and a 3×3 re-confirmation. `proto-tools/diag_r10_primitive_fill.mjs`
   (**4 observations, ALL PASS**) proves the banked primitive's own fill path separately: the whole
   requested run fills with `sw_fill_metatile_id`, and the caller's own bank is never switched away at
   all (`sw_goto` never runs), cheaper than the real-read path, not merely different.

   **The full unaligned × all-parity `sw_render_window` regression, now genuinely runnable — fix
   round 8 could not attempt it, exactly because out-of-grid reads were undefined until this round.**
   `proto-tools/diag_r10_full_parity.mjs`: all 4 origin parities × all 16 col-local × 15 row-local
   offsets (240 combinations each) × all 4 nametables × 2 representative points per nametable
   (block(0,0) and block(3,3), fix round 8's own two points) — **7,680 independently-computed
   comparisons, ALL PASS**, in 101.5s. This is not claimed to be numerically identical to the
   reviewer's own cited 52,224-comparison figure (its derivation was not reproduced), but it is a
   genuine, exhaustive sweep of the entire origin-parity × local-offset space, not a sampled subset —
   many of the 7,680 comparisons resolve to fill on one or more nametables (any local offset pushing
   a screen past index 2, the fixture's own real extent), which fix round 8's own restricted sweep
   (origins kept at `{0,1}`, three representative local offsets) explicitly could not reach.

   **Costs, real-read vs. fill, both arms and the renderer** (`proto-tools/diag_r10_routed_costs.mjs`):
   `sw_stream_start_col` (30 blocks) real-read 3,911 cycles (13.13% of a 29,780-cycle NTSC frame,
   up from 3,192 pre-fix — the new bounds check costs 719 cycles/strip, about 24 cycles per block,
   two unsigned zero-page compares per block, run unconditionally whether or not the branch is ever
   taken), all-fill 2,179 cycles (7.32%, genuinely cheaper — no `sw_goto` at all);
   `sw_stream_start_row` (32 blocks) real-read 4,077 cycles (13.69%), all-fill 2,280 cycles (7.66%);
   `sw_strip_fetch_run_col` (8-byte run) real-read 666 cycles, all-fill 272 cycles;
   `sw_render_window` (full four-nametable redraw, a forced-blank once-per-crossing cost, never a
   per-frame one) 969,527 cycles on the 3×3 fixture (all real), 919,713 cycles on the 1×1 fixture
   (3 of 4 nametables fill). **The mainline per-frame cost at 1.5 px/frame is unchanged in kind by
   this round**: a column strip still arms once per 10-11 frames (the X crossing interval fix round 9
   measured under decision A's own `SW_SPEED_SUB_X=128`), so the new 719-cycle bounds-check overhead
   is paid on that same single arming frame, not every frame — 3,911 cycles is 13.1% of ONE frame in
   11, not a sustained per-frame tax; `sw_render_window` itself is charged only at a screen crossing,
   under forced blank, exactly as item 12's own `redraw_screen_slide` already is, never against the
   1.5px/frame mainline budget at all.
3. **The collision/probe bound**: a **non-mutating** resolver (finding 5's own map-edge wall, §4,
   restated here for terrain rather than collision) — a probe or crossing routine resolving a
   neighbour outside the authored grid gets a **wall** (solid, unconditionally) with no bank switch
   and no `sw_read_transaction` call, distinct from the *window* clamp above: a probe at column 4 of
   a five-wide map is a perfectly valid **neighbour** lookup (real content, real bank) even on a map
   whose own width (5) is *smaller* than the window's own 32-block span — the window clamp's own
   `gridW-2` maximum-origin bound has nothing to do with whether column 4 itself is a legal screen
   to probe, which it is. Conflating the two (using the window clamp's own bound to decide whether a
   *collision* neighbour exists) was fix round 4's real error, per finding 1's own "these are
   different bounds and cannot share that contract."

**One-high/one-wide maps, explicitly in scope**: a 1×N or N×1 streamed map has a real, legal grid on
one axis and a degenerate (size-1) extent on the other. The window/viewport clamp (point 1) simply
never engages on the degenerate axis (there is only ever one legal origin there); the terrain-
padding bound (point 2) supplies `fillMetatileId` for every row (or column) beyond that single
legal one, so the window's own physical torus always has *something* valid to show above/below (or
beside) the map's own single strip — visually, a fixed border of the fill tile, not a crash or
garbage. Collision (point 3) treats anything beyond the single legal row/column as a wall, so the
player cannot walk into the padding and discover it has no real content behind it.

**The window origin convention, exact for all three cases (review 5, finding 2's own explicit
demand)** — **nonnegative**, never a signed coordinate: the window origin (`win_col_screen`/
`win_col_local`, and the row equivalents) is always a valid, non-negative `(screenCol, local)` pair,
on every axis, in every case:

**Corrected this round (fix round 8, finding 2) — the WINDOW/RESIDENT origin and the CAMERA are two
separate things, and only one of them freezes in the two cases below.** Review 6's own finding 2
caught the conflation exactly: *"A 32-block-wide map is 512 pixels wide, while the visible viewport
is only 256... the resident window may stay at origin zero, but the camera must still traverse those
two screens; otherwise the player walks off the visible screen halfway through a legal map."* The
window (the resident 32×30-block torus buffer `sw_render_window` fills) is a *rendering* concern —
does the buffer need to re-center itself to keep showing real content; the camera (`sw_project_axis`'s
own second argument) is a *viewport* concern — which 256×240-pixel slice of that already-rendered
buffer the player currently sees. A map that exactly fills the window on some axis genuinely never
needs to re-render that axis (nothing outside the buffer to bring in) — but the player can still walk
the full width of that buffer, and the camera must track them across all of it.

- **Map larger than the window on this axis**: the WINDOW origin scrolls, clamped to
  `[0, gridSize-2]` screens by `sw_clamp_col`/`sw_clamp_row` (unchanged) — real content fills the
  whole window at every legal origin. The CAMERA clamps independently, in world pixels, to
  `[0, mapPixels - viewportPixels]` (below) — on this axis `mapPixels > windowPixels` always, so the
  camera's own range is bounded by the WINDOW's own current re-centring, not the map's full extent
  directly (the window itself is what keeps sliding new content into view as the camera approaches
  its edge).
- **Map exactly the window's own size on this axis** (32 blocks = 2 screens wide, or 30 blocks = 2
  screens tall): the WINDOW origin is **permanently `(0, 0)`** — there is exactly one legal
  placement, nothing to re-render, and no window clamp to compute — but the **CAMERA does not
  freeze**: `mapPixels` (512px wide, or 480px tall) exceeds `viewportPixels` (256/240) by exactly one
  screen, so the camera clamps to `[0, mapPixels - viewportPixels]` = a full one-screen-wide (or
  tall) range, exactly as it would on a larger map — the window just never has to slide to keep up,
  since it already holds the map's entire extent. This is the bug this round's own fix-8 brief
  named directly: the prior text froze the camera here too, which would have walked the player off
  the visible screen the instant they crossed the window's own midpoint.
- **Map smaller than the window on this axis** (including the degenerate one-screen case): the
  WINDOW origin is **also permanently `(0, 0)`**, with `sw_terrain_or_fill` (point 2, above) supplying
  the fill id for every physical position beyond the map's own real extent — and here the **CAMERA
  genuinely does freeze**, correctly: `mapPixels <= viewportPixels` (a one-screen map is exactly
  256×240, matching the viewport exactly), so `mapPixels - viewportPixels <= 0` and the clamp range
  collapses to a single point, `[0, 0]`. The two "permanently `(0,0)`" bullets read identically for
  the WINDOW; they are opposite cases for the CAMERA, which is exactly the distinction the prior text
  lost.

**The camera clamp, stated once, for every case above**: `cameraOrigin = clamp(desiredOrigin, 0,
max(mapPixels - viewportPixels, 0))` on each axis independently, where `mapPixels` is the map's own
authored extent in world pixels (`gridW screens × 256`, or `gridH screens × 240` — using each
screen's own real 16×15-block, 256×240-pixel size, not a block count alone) and `viewportPixels` is
the fixed 256 (X) / 240 (Y) visible size. `max(..., 0)` is what makes the single-screen case collapse
to a zero-width range rather than a negative one. This is a plain per-axis clamp on
`sw_project_axis`'s own second argument (the camera's world-space origin, §4/finding 5) — computed
from the player's own centred position exactly as before, just bounded by this range afterward,
independent of whatever the WINDOW's own origin currently is.

**Decision B's own camera nudge (§10) must clamp into this SAME range, not merely round to the
nearest 16px.** A nudge of up to 15px per axis, applied naively, can push the camera past
`mapPixels - viewportPixels` near a map's own far edge (the box would show past the authored content,
into whatever the fill tile or an adjacent screen's own data happens to occupy). The fix is the same
clamp, applied after rounding: compute the nearest-16 value first (as decision B already specifies),
then `clamp(nudged, 0, max(mapPixels - viewportPixels, 0))` — on an axis where the nearest-16 value
would exceed the max, **it rounds DOWN to the clamp's own maximum instead of up past it**, the same
direction `sw_clamp_col`/`row`'s own existing far-edge clamp already rounds (§10 Decision 3's own
`(grid_w-2, 0)` result is the identical "clamp to the last legal position, never past it" choice,
applied here to pixels instead of screens). This can only matter within 15px of a map's own true
edge — the overwhelmingly common case (anywhere else in a map) rounds to the nearest 16px exactly as
already specified, unaffected.

**The two-nametable dead axis (phase 3, not yet built) is this same rule, not a separate one,
corrected this round (review 5, finding 2)**: the dead axis's own physical ring extent is **one
screen, not two** — a 32×15 or 16×30 two-nametable ring is exactly half the four-screen ring's own
32×30 physical area, so the axis that cannot scroll shows exactly one screen's worth of ring, never
two. §5/finding 2's own shape restriction is corrected to match: a two-nametable streamed map's
dead axis is capped at **exactly one screen deep** (an authoring restriction, `validateProject`),
which — since one screen deep exactly equals the ring's own one-screen capacity there — is simply
the "map exactly the window's own size on this axis" case above, needing no special-casing at all
once the authoring restriction holds. The terrain-padding and collision bounds (points 2-3) still
apply normally
on the *scrolling* axis, unchanged from the four-screen case.
### Remaining open questions

Nine questions still open, unchanged in shape from fix round 4 except renumbered (throughput and
dialogue moved to the decisions above, and are no longer numbered here). Each has this document's
own recommendation stated plainly; none is decided here.

1. **Camera centring — corrected this round (review 4, finding 6): item 12 does not already ship a
   centring convention to choose between.** `engine/camera.asm:1-18` implements a *screen-edge
   slide* (triggered only at a screen boundary), not a continuous player-centred camera — there is
   no existing "convention" for FALLEN STAR's own `player − (120,112)` formula to compete against.
   The real, now-resolved question is narrower: whether the **register** item 12 already ships
   (`cam_x_lo`/`cam_y_lo`/`cam_nt`, the NMI publication) is the right destination for a *new*
   continuous-centring source, or whether streaming needs its own register too. **Recommendation,
   updated**: yes, reuse item 12's own existing register and publication mechanism as the
   destination — `sw_project_axis` (§4/finding 6, built and measured this round) is a genuine,
   working candidate for the *source* computation that register would receive on every frame a
   streamed map is current, at 79-91 cycles/axis/call. This is no longer a choice between two
   existing conventions; it is confirming the one register destination already exists and can be
   fed from either a slide trigger (ordinary maps, unchanged) or a continuous per-frame derivation
   (streamed maps, this design's own new work).
2. **Whether the camera clamps at the map edge**: a streamed map's own camera could clamp so the
   window never shows a torus wraparound past the map's authored own extent (like most games'
   scrolling cameras), or it could wrap continuously (a genuinely cylindrical or toroidal world).
   **Recommendation**: clamp. A wrapping world is a much larger design question (what does "north of
   the northernmost screen" mean for warps, doors, and the world overview's own rendering?) that
   ROADMAP item 15 never asked for, and FALLEN STAR's own reference implementation itself clamps
   (its own world is a fixed 256×256-block rectangle, not a torus at the *map* level — only the
   *streaming window*, a fixed-size viewport, is a torus, which this design already adopts).
3. **The entity policy's own visible pop-in/pop-out trade-off (R8/R9) — corrected this round
   (review 3, finding 11): this is a genuinely worse artifact under streaming, not merely a more
   frequent version of an existing one.** Fix round 3's own "a streamed map does not make this
   trade-off worse, only more frequent" is wrong: under the **ordinary** engine, a screen change is
   a discrete, instantaneous cut — the player never sees two screens' worth of content at once, so
   an actor's own absence on the far side of a cut is never *witnessed* as a pop, only inferred
   after the fact. Under **streaming**, the camera continuously shows parts of up to four screens
   simultaneously — an NPC standing near the edge of the player's own current screen is **visibly
   on screen**, in the corner of a continuously-rendered viewport, and would have to **vanish
   outright, mid-view, with the camera not having cut at all**, the instant screen ownership
   transfers (§4/R9: "absent, not inert" — the terrain-only screen records have nothing to draw it
   with once it is not the current screen's own actor). This is a real, qualitatively different, more
   jarring artifact than today's engine has anywhere. **Recommendation, unchanged in conclusion but
   not in reasoning**: keep today's current-screen-only model for phase 2 regardless — a wider
   live-entity window is a real scope increase this document does not cost anywhere — but present
   the trade-off honestly to Chris as a new, visible cost streaming introduces, not a
   frequency change to an existing one.
4. **Whether the two-nametable variant ships or four-screen only (Phase 3)**: MMC1/MMC3 support
   doubles the addressing surface and needs its own Mesen deadline proof (§9). **Recommendation**:
   ship it — MMC1 and MMC3 are this codebase's own most commonly targeted boards for a real RPG
   (`rpgCapable`), and a streamed-world feature that only works on UNROM 512 (CHR-RAM, no CHR-ROM
   art pipeline) would exclude the board family most RPG-shaped streamed worlds would actually want.
5. **Whether a streamed map may also carry item 12's own slide setting — decision 5, restored
   (review 3, finding 11): the project-wide camera checkbox stays visible on a mixed project; there
   is no per-map checkbox to hide.** Quoted, so it cannot be silently reversed again: *"The
   project-wide camera checkbox stays visible on a mixed project; `CAMERA_ENABLED` is the register,
   `CAMERA_SLIDE_ENABLED` the ordinary maps' slide."* Fix round 3's own "hide/disable the Build
   panel's slide checkbox for a streamed map" is **wrong for the reason finding 11 gives**:
   `project.cartridge.camera` is a **single, project-wide** field (CLAUDE.md's own camera section:
   "one project-wide pair decided from the fixed mirroring choice"), not a per-map setting — a
   mixed project (some streamed maps, some ordinary) needs the camera register **on** for the whole
   project (the streamed maps need it continuously; the ordinary maps' own slide, item 12's existing
   mechanism, also depends on it being on) — hiding or disabling the *checkbox itself* would remove
   camera functionality from the ordinary maps too, breaking the mixed-project contract. **The real
   distinction is a compile-time constant, not a UI control**: `CAMERA_ENABLED` gates the register
   and its NMI publication (on whenever any map needs it); `CAMERA_SLIDE_ENABLED` gates the
   screen-edge slide code specifically (item 12's own existing mechanism, used by ordinary maps'
   own crossings) — a streamed map's own crossing simply never calls the slide code at runtime
   (`map.streamed` routes to the continuous streaming path instead, §3/§4), with **no UI change
   needed at all**: both flags stay exactly as item 12 already ships them, and the *map's own*
   `streamed` field is what actually decides which runtime path a given crossing takes.
6. **The grid cap** — how large a streamed map's own grid may be authored, beyond the 4×4 ordinary
   ceiling. **Retracted and corrected twice now**: fix round 3's own `H × ceil(W/24) <= 14` used
   MMC1's own **raw** 14 data regions; fix round 5 corrected it to a **wrongly two-region-charged**
   RPG figure of 12 (the `codeRegionCount` returns **one** region for RPG battle code, not two — §5/
   finding 4, this round). And no single per-map cap is the real answer at all: finding 7/finding 4
   (§5, this round) replace a per-map grid cap with the **aggregate** allocation check — two streamed
   maps, or a streamed map plus a project's own ordinary screens, must fit *together* against one
   shared region list, which a flat per-map ceiling cannot express regardless of which number it
   uses. **Recommendation, updated**: no flat constant at all — the Map Forge's own capacity meter
   should run the real aggregate check (§5, finding 4/7) against the project's *current* full
   configuration (every map, streamed and ordinary, the actual tileset count, the actual
   battle/streaming-code/flash reservations) every time a grid is resized, not compare one map's own
   `H×ceil(W/24)` against a cached ceiling.
7. **The four-screen tileset cost**: four-screen mirroring already costs a tileset (`tilesetLimit`,
   CLAUDE.md's own camera section: "four-screen costs a tileset because the extra nametables are
   backed by the last CHR-RAM page"), and a streamed world's own four-screen consumer inherits this
   unconditionally. **Recommendation**: confirmed, not reopened — this is existing, shipped item-12
   behaviour this design does not change or need to change; the Build panel's own existing message
   already explains it.
8. **The entity-count cap, if any survives review round 6**: whether a streamed map needs its own,
    separate entity-count ceiling beyond the existing per-screen `MAX_ENTITIES=8`. **Recommendation**:
    no separate cap — R6's own 338-byte record already charges every screen (streamed or not) the
    full uncapped `MAX_ENTITIES=8` worst case, so a streamed map's own entity budget is identical to
    an ordinary map's, screen for screen; the only new ceiling this design introduces is the
    project-wide 255-screen count (R12), not a per-screen entity count.
9. **Bound tiles on a streamed map (R16), added this round — finding 15 correctly noted this list
    never actually included it despite §5's own recommendation.** No switch-bound tiles on a
    streamed map at all, enforced by `validateProject`, until a real flip-synchronisation design
    exists (§5/R16). **Recommendation**: confirmed as this document's own primary path — the
    restriction is real and author-visible (no switch-bound puzzle mechanics on a streamed map), but
    it is the only alternative this round actually designed to completion (the mixed-map entry-time
    clear, §5/R16), versus a flip-sync mechanism that remains genuinely unscoped.

## 11. Out of scope

Unchanged from round 2's own list (platformer physics, a status bar, parallax, FALLEN STAR's zone
palettes and vehicles, MMC1/MMC3 runtime re-mirroring, a `Pan` verb, the world overview's own
click-to-navigate rendering — `design-maporg.md` §12's own scope, not re-designed here).

**Resolved this round, removed from the open list**: the R2 skip-logic discrepancy's own root cause
(§3 — a fixture-size defect, found and fixed); a full hardware-timed NMI deadline proof (§3/R4 —
built and run, on both boards, both chunk sizes); the resident single-transaction rebuild of
`sw_goto`'s own placement contract (§5/R5 — `sw_peek_byte`, built, measured, tested); an
independently reproduced capacity-measurement (§5/R7 — the reviewer's own script re-run against
this tree, byte-identical, plus the real region-count script); the project-wide screen ceiling
question (§5/R12 — resolved at 255, the sentinel-collision argument, no special-cased 256 branch
needed).

**Still out of scope, carried forward**: the full 256-boundary sentinel/count audit beyond the two
`NUM_SCREENS` sites and the `NO_SCREEN` argument itself (R12 — the *conclusion* is resolved, a
narrower residual sweep is not performed); option 2's own dialogue costing in real bytes/RAM/frames
(R13 — named, not built); the preflight/atomic-rejection mechanism for a mapper downgrade (R14 —
the mutation site is pinpointed, the mechanism itself is not designed to the byte level); the
bound-tile flip-synchronisation *mechanism* (R16 — this round decided the narrower question,
restricting switch-bound tiles from streamed maps entirely rather than designing the sync, so the
mechanism itself remains genuinely out of scope, not merely unbuilt); the boundary-collision design
actually wired into `player_hazard`/`entity_contact`/scripted `Move` (R8 — the restore primitive
and the index formula it must work around are now real, the consumer-side design that calls them is
not); the variable-rate (`vram_len`-read) chunk-budget implementation (R4 — recommended in shape,
not built); the teleport guard's own implementation (named every round since round 1, never built);
the two-nametable variant in full (phase 3, §9 — not started).

## 12. Places a claim could not be pinned to a line and was reasoned instead

**Resolved this round, removed from this list**: the R2 skip-logic discrepancy's own root cause
(now found and fixed, §3 — a fixture-size defect, not a hypothesis); R5's own resident-transaction
contract (now built and cycle-measured, §5); R7's own capacity numbers (now this round's own
independently reproduced measurement, §5); R12's own project-wide ceiling (now resolved by the
sentinel-collision argument, §5, not merely audited at one site).

**Still reasoned, not pinned to a build, this round**:

- **R9's projection cost** and **R13's option 2 cost** are both explicitly unestimated, not
  guessed at with a placeholder number — neither has a concrete implementation to measure yet.
- **R10's named hooks** (the pause gate, pre-battle cancellation, the streamed redraw dispatch) are
  specified in prose, with real call-site citations, but not implemented as working code this round.
- **R8's boundary-collision consumer design** (§4) — the restore primitive (`sw_peek_byte`) and the
  exact index formula it must work around (`probe_type`'s own `(probe_y & $F0) + (probe_x >> 4)`)
  are now real and cited, but the design connecting them (which neighbour, which local index, at
  which threshold) is reasoned from those two facts, not built into `player_hazard`/`entity_contact`
  or tested against a real straddling scenario.
- **R14's preflight/atomic-rejection mechanism** — the mutation site (`reconcileCartridge` called
  inside `store.commit`) is pinned to real line numbers, but the mechanism that would refuse a
  downgrade before that commit runs is reasoned about in the abstract ("a preflight validation step
  is needed"), not designed to the level of what function signature or where it would live.
- **R16's own restriction, not its enforcement mechanism** — deciding "no bound tiles on a streamed
  map" is a real decision (§5), but the exact `validateProject` error shape (which fields it reads,
  where in the existing validation pass it runs relative to the other capacity checks) is reasoned
  about by analogy to existing refusals, not written as a diff against `shared/project.js`.

## 13. Changelog

**Round 1 → fix round 1** (restored this round — fix round 2's own rewrite dropped this table
outright, in violation of the ground rule against shrinking a section without saying what left and
why; rebuilt from `handoff-next/streamed-worlds-design-fix1-report.md` and cross-checked against
review 2's own end-of-review disposition table, since review 2 is itself an assessment of what fix
round 1 actually achieved). Seventeen findings from `streamed-worlds-design-1-review1.md`, verdict
FIX, plus finding 18 (fix round 1's own disclosure, not a reviewer finding). Disposition is
review 2's own later judgment of fix round 1's work, not fix round 1's own self-report, since that
is the more reliable source available:

| # | Finding (review 1) | Disposition after fix round 1 (per review 2) |
|---|---|---|
| F1 | Sustained throughput infeasible | Rates quantified, policy infeasible as stated — Open |
| F2 | Torus not built (single-nametable fragment) | Full-window redraw rebuilt; incremental mapping/row writes still broken — Open |
| F3 | Chunk loop loses the final frame | **Closed** — completion retest confirmed by CPU-stepping |
| F4 | Reference/save model loses map identity | Global `flat_screen` fixes the central ambiguity; max-count audit/token/range init remain — Partially closed |
| F5 | Straddling collision unresolved | Crossing-threshold intent better; consumers/actors/corners unresolved — Open |
| F6 | World sprites need camera projection | Formula introduced; coordinate-frame/clipping/visibility contract inconsistent — Open |
| F7 | Message box "freeze, unaffected" is false | False claim withdrawn; no costed option or accepted restriction — Partially closed |
| F8 | Storage schema/capacity unfinished | Record still incomplete, prototype uses old stride, packing conclusions false — Open |
| F9 | Frame ownership/transitions unspecified | Table useful but several rows rely on nonexistent gates/hooks — Open |
| F10 | Vblank arithmetic double-counts | Double-counting and citation corrected; timing/deadline still unsupported — Partially closed |
| F11 | Fixture doesn't exercise the addressing | Real records exist, CPU address reads pass; shipped Mesen assertion doesn't execute its hook — Partially closed |
| F12 | RAM totals/flash coexistence unresolved | Real footprint identifiable; totals/reentrancy/save transaction still wrong — Open |
| F13 | Gating admits UxROM; downgrade destroys maps | Hardware-plus-consumer intent right; capability/mutation contract unfinished — Partially closed |
| F14 | Placement contradicts itself | Measured spans/co-mapping useful; bank-return contract still unexecutable — Open |
| F15 | Timing harness isn't an acceptance test | Incremental negative control cannot fail the current full-redraw test — Open |
| F16 | Phase 1 lacks a safety boundary | Phase-1 refusal, minimal overview, Test warp handshake specified correctly — Partially closed |
| F17 | Attribute bottom-row equivalence claim false | Generator-skip vs. reference-clamp correction accepted; replacement claim false — Partially closed |
| 18 | (fix round 1's own finding, not review 1's) | `applyHeaderPatch` never applied to a bare `nesasm` build — every Mesen test through fix round 1 used an unpatched header until found and corrected by hand |

Verdict after fix round 1 (review 2's own words): "Only F3 is fully closed... The full-window
terrain redraw is a useful improvement; it is not evidence that the incremental torus works." FIX,
sixteen new/continuing findings (review 2's own numbering, R1-R16, superseding F1-F17 above).

**Round 2 → fix round 2.** Sixteen findings from `streamed-worlds-design-1-review2.md`, verdict FIX,
each disposed in the reviewer's own three categories.

| # | Finding | Working fix (evidence) | Proposed design (reasoned) | Still open |
|---|---|---|---|---|
| R1 | Incremental torus broken | Rebuilt; 34 passing checks incl. retention, reversal, negative controls (§3) | — | — |
| R2 | Attribute init wrong | `y1` fix confirmed against reviewer's exact case (§3) | — | 8th-row skip logic: isolated/integrated discrepancy unresolved (§3/§7/§12) |
| R3 | Throughput infeasible | Arithmetic corrected (blocks written ≠ px of travel) | Six choices costed | Recommendation returned to Chris (§10), not decided |
| R4 | NMI deadline unproven | Rebuilt-routine cycle counts measured (§3) | Arbitration rule specified (yield, never force against a full drain) | Full hardware-timed deadline proof; variable-rate chunk budget |
| R5 | Banked read impossible as specified | — | Resident single-transaction contract reasoned | Not built or re-costed |
| R6 | 288-byte record incomplete | 338-byte uncapped record built, ported, 23→24 boundary retested both directions/parities (§3/§5) | — | — |
| R7 | Capacity/packing wrong | Region-packing formula corrected (`H×ceil(W/24)`) | — | Independent measurement script still broken; reviewer's own numbers used |
| R8 | Straddling/actors unresolved | Carry-loss and two-axis claims confirmed/retracted against real code (§4) | Wide/signed intermediate, per-direction normalisation named | Full consumer audit; actor ownership at a boundary |
| R9 | Projection frame mismatch | — | One-coordinate-space rule, per-tile edge policy, "absent not inert" stated | Cost of the chosen implementation |
| R10 | Frame ownership contradictory | Corrected rule (ownership change, not camera movement, sets freshness) (§4) | Named hooks (pause gate, pre-battle cancel, streamed dispatch) | Hooks not implemented |
| R11 | RAM/reentrancy/save unsafe | `sw_ns_chunk` fixes the reentrancy bug; RAM table corrected; resync placement fixed (§5) | — | Save-mid-strip/menu-during-strip tests not built |
| R12 | Identity audit incomplete | One real sentinel site identified (`boot.asm:286-290`) (§5) | `saveCompatToken`/initialiser rules stated | Full 256-boundary audit incomplete |
| R13 | Dialogue not costed | Restriction reframed as a real scope choice, not engineering-only (§5) | Option 2's own required pieces named | Option 2 not costed in bytes/RAM/frames |
| R14 | Gating/downgrade contracts wrong | Per-mapper predicate shape identified; mutation site pinpointed (`build.js:503,568`) (§5) | — | Preflight/atomic-rejection mechanism not designed |
| R15 | Harness couldn't detect failures | Rebuilt: real strips through real NMIs, sample counts asserted, negative controls pass (§3/§8) | — | Full Mesen hardware-timed proof (R4's own gap) |
| R16 | Bound tiles unaddressed | — | — | Not addressed this round; carried forward |

**Round 3 (this round).** Sixteen findings from review 2 (R1-R16), re-assessed after this round's
own building and measuring — plus the restoration of content two prior fix rounds silently dropped
(§0's corrections list and finding 18, §9's five-phase table, this table's own round1→fix1 row, and
Appendix B, all restored from their own cited sources rather than re-derived).

| # | Finding | Working fix (evidence) | Proposed design (reasoned) | Still open |
|---|---|---|---|---|
| R1 | Incremental torus broken | Unchanged from fix round 2 — still closed, reconfirmed (§3) | — | — |
| R2 | Attribute init wrong | **Fully closed.** The `y1` fix stands; the "8th-row skip logic" discrepancy is now explained (a fixture-size defect, not a code defect) and fixed — 49/49 checks pass (§3) | — | — |
| R3 | Throughput infeasible | Unchanged from fix round 2 | Six choices stand, unchanged | Recommendation returned to Chris (§10), not decided |
| R4 | NMI deadline unproven | **A real hardware-timed verdict now exists**: Mesen deadline check built and run on two boards; chunk=3 fails (`exit 5`), chunk=1 passes (`exit 0`, ~1 scanline margin) (§3) | Arbitration rule unchanged (yield, never force against a full drain); variable-rate budget still recommended, not built | Full arbitration/anti-starvation code; MMC3 `split_select`'s own mainline cost not isolated separately |
| R5 | Banked read impossible as specified | **Built and measured**: `sw_peek_byte`, one resident routine, ~292 cycles, proven by a real neighbour-byte read plus a genuine restore (T7) (§5) | Placement conclusion (hot resident/cold banked, no exceptions) now stated as a measured fact, not a reasoned split | The banked cold path's own `codeRegions` placement and trampoline (not built) |
| R6 | 288-byte record incomplete | Unchanged from fix round 2 — 338-byte record stands | — | — |
| R7 | Capacity/packing wrong | **Independently reproduced this round**: the reviewer's own script re-run against this tree, byte-identical; region counts freshly measured direct from `shared/cartridge.js` (§5) | — | — |
| R8 | Straddling/actors unresolved | Real citations re-confirmed; `probe_type`'s own exact index formula and `MAX_X`/`MAX_Y` newly cited; `sw_peek_byte` gives the design a real restore mechanism it did not have (§4) | The consumer design connecting the formula and the primitive, reasoned but not built | Actor ownership/contact/script semantics at a boundary; the design not wired into `player_hazard`/`entity_contact` |
| R9 | Projection frame mismatch | — | Unchanged from fix round 2 | Cost of the chosen implementation |
| R10 | Frame ownership contradictory | Unchanged from fix round 2 | Named hooks unchanged | Hooks not implemented |
| R11 | RAM/reentrancy/save unsafe | Unchanged from fix round 2 — `sw_ns_chunk` fix confirmed still disjoint; the identical *shape* of bug recurred in a third routine this round (§0), underscoring the fix does not generalise | — | Save-mid-strip/menu-during-strip tests not built |
| R12 | Identity audit incomplete | **The project-wide ceiling is resolved**: `NO_SCREEN=$FF` plus `NUM_SCREENS`'s own literal-decimal emission force a 255-screen ceiling, the same sentinel-is-the-cap pattern this codebase already uses elsewhere — no special-cased 256 branch needed (§5) | `saveCompatToken`/initialiser rules unchanged | A narrower residual sweep for any other fixed-width count this same reasoning might also bind |
| R13 | Dialogue not costed | Unchanged from fix round 2 | Option 2's own required pieces unchanged | Option 2 not costed in bytes/RAM/frames |
| R14 | Gating/downgrade contracts wrong | Unchanged from fix round 2 | — | Preflight/atomic-rejection mechanism not designed |
| R15 | Harness couldn't detect failures | Unchanged from fix round 2 — still closed; the R4 deadline harness (Appendix B) is new work built to the same "derive addresses, watchdog, assert observations, prove a negative control" standard | — | — |
| R16 | Bound tiles unaddressed | **Decided**: streamed maps may not place a bound-tile binding, enforced by `validateProject`, until a flip-synchronisation design exists (§5) | The restriction's own exact `validateProject` error shape, reasoned by analogy | The flip-synchronisation *mechanism* itself remains genuinely out of scope, not merely unbuilt |

**Round 4 (this round).** Review 3 (`streamed-worlds-design-1-review3.md`) returned FIX, 16 findings,
eight P1 — and, distinctly from every prior review, found that **fix round 3 had reversed seven
decisions earlier rounds already settled**, restoring rejected content into the document's own
operative sections. All seven are restored this round, quoted verbatim in the operative sections
themselves (§0/§4/§6/§10), not merely listed here. Review 3's own round-1 (F1-F17) and round-2
(R1-R16) disposition tables are the most current, most reliable record of those two rounds' own
history — reproduced here rather than re-derived, since review 3 is itself a later, corrected
assessment of what fix rounds 1-3 actually achieved (the identical "later review is the more
reliable source" principle fix round 3 already applied to review 2's own end-of-review table):

| Finding (round 1, F-numbering) | Disposition per review 3 |
|---|---|
| F1 throughput | Open — arithmetic fixed, no sustainable implementation-ready policy/option costing |
| F2 torus | Partial — strip splits/wrap/retention improved; full redraw composition and bounds broken (closed this round, R1/finding 2) |
| F3 final-chunk completion | **Closed** |
| F4 map/save identity | Partial — global identity retained; count off-by-one (closed this round), range table and coordinate validation unresolved |
| F5 straddling | Open — old atomic landing model was reintroduced by fix round 3 (reversed again this round, decision 1); actors/corners/cost unresolved |
| F6 OAM projection | Open — wrong claims withdrawn, replacement implementation contract now written this round (finding 7) |
| F7 message box | Partial — freeze-only claim withdrawn; viable costed UI decision given this round (finding 13) |
| F8 storage/capacity | Partial — stride/schema arithmetic and stock measurements fixed; mixed records/table budget/reservations addressed this round (finding 5) |
| F9 frame ownership | Open — basic rule improved, transition/publication contracts restored this round (decision 6, finding 11) |
| F10 vblank arithmetic | Partial — double-count fixed and real deadline fixture exists; the methodology's own wait_vblank claim corrected this round (finding 10, decision 7) |
| F11 addressing fixture | Partial — actual data reads exist; the code-bank return contract built this round (finding 3) |
| F12 RAM/flash coexistence | Partial — NMI scratch split and save-resync placement fixed; totals corrected this round (finding 4) |
| F13 capability/downgrade | Partial — correct predicate direction; concrete preflight contract given this round (finding 14) |
| F14 placement | Open — measured spans useful; code-bank return contract now built and placement numbers corrected this round (findings 3-4) |
| F15 acceptance harness | Partial — real strip observations/derived anchors improved; missing integration/controls named, harness parameters still not fully built (finding 9) |
| F16 phased/editor safety | Partial — phase-1 build refusal restored; Test/global camera/overview regressions reversed back this round (decisions 4-5) |
| F17 attribute equivalence | Partial — actual y1/skip fixes accepted; the false restored clamp claim corrected this round (finding 16) |

| # (round 2, R-numbering) | Disposition per review 3 | This round's own change |
|---|---|---|
| R1 incremental ring/row writes | Partial → **the full-redraw/strip composition mismatch (finding 1) is now closed** | Built: `sw_rw_col_delta`/`sw_rw_row_delta`; reproduced the reviewer's own case fixed; T8 added |
| R2 attributes | Partial, unaffected by this round's own R1 fix — the underlying y1/skip fixes stand | Unchanged |
| R3 throughput | Open, unchanged | Unchanged — still returned to Chris, §10 |
| R4 NMI deadline/arbitration | Partial, unaffected — the deadline harness itself stands; only its own methodology comment was wrong (finding 10) | Corrected the wait_vblank/main_loop explanation; the harness and its exit codes are unchanged |
| R5 banked return | Open → **closed this round** (finding 3) | Built: `sw_read_transaction`, proven against the reviewer's own bank-7 stub (T9) |
| R6 288-byte schema | Partial, unaffected | Unchanged |
| R7 capacity | Partial → the usable-region-after-reservations gap (finding 5) addressed | Real usable-region table added; §10's own grid-cap recommendation corrected |
| R8 straddling/actors | Open → the citation (finding 8) and crossing-model (finding 6/decision 1) corrected | `entity_contact` citation fixed to `combat.asm:358`; continuous crossing restored |
| R9 projection | Open → **an actual implementation contract now exists** (finding 7) | Camera citation corrected (item 12 is a slide, not a centring camera); FALLEN STAR's 120/112 offset recommended; per-tile/OAM-Y rules stated |
| R10 transitions | Open → the transition table and `cam_dirty` contract restored (decision 6, finding 11) | Full per-transition table restored; the `call_battle` cancellation reason corrected (protects battle VRAM, not a bank-mapping failure) |
| R11 RAM/reentrancy/save | Partial, unaffected | Unchanged |
| R12 identity ceiling/save | Partial → the off-by-one (finding 12) fixed, the `save.asm` coordinate gap named | `count > 255` (not `>= 255`) stated correctly; `save.asm:314-325`'s own `MAX_Y` conflict with decision 1 named |
| R13 dialogue | Open → costed with a real number (finding 13) | Option 2 costed at ~698,000 cycles / ~23.4 frames for the redraw alone; `liveCommands`'s own call-reachability gap named |
| R14 capability/preflight | Partial → a concrete contract given (finding 14) | `checkStreamedMapperSwitch` function signature and ordering specified |
| R15 harness/crash | Partial, unaffected | Unchanged |
| R16 bound tiles | Partial → the mixed-map lifecycle gap (finding 15) closed | The entry-time `bind_count`/`flip_pending_count` clear specified; added to §10's own Chris-facing list |

**Round 5 (this round).** Review 4 (`streamed-worlds-design-1-review4.md`) returned FIX, 13
findings, seven P1 — and, independently, **closed** the redraw/strip mapping (52,224 unaligned
comparisons on four parities) and the timing methodology, the two findings review 3 itself first
raised. Chris settled three decisions the same evening (§10): throughput (speed cap, no dash, no
diagonal), dialogue (camera snap/redraw), small maps (fill-metatile padding, three separate
bounds) — all three written up to real numbers, not left as open questions.

**Working fix (real code, real measurement, this round)**:
- **Finding 2** — `sw_read_run`, the resident bounded-run transaction; proven from a genuine
  banked caller (nesasm bank 14, PRG register 7, three distinct hardware banks live at once —
  caller/field/target); `sw_goto`/`sw_read_transaction`/`sw_read_run` costs re-measured and
  decomposed (149-5,479 cycles), the mischaracterised 292/886/836/905 figures dropped.
- **Finding 6** — `sw_project_axis`, a real, costed projection prototype (79-91 cycles/axis),
  signed 16-bit throughout, hardware-correct OAM Y=255/partial-tile-visibility semantics, the
  `112 = 240/2-8` (not `224/2-8`) error fixed.
- **Finding 9** — the compiled `SW_STREAM_CHUNK` is now a real, restoring builder argument
  (`withCompiledChunk`), independent of the Lua workload length/parity; the real negative control
  (compiled chunk=3) reproduced; a genuinely new result — `SW_STREAM_CHUNK=2` also misses the
  deadline (never tested via Mesen before) — and the DMA-prologue control (`build_dma_control_
  fixture.mjs`) causally proves it: removing the OAM DMA write flips chunk=2 from fail to pass. The
  full-render Mesen quadrant template (8/8 checks, all four nametables' terrain and attributes, a
  real unaligned origin) is built and passing — and surfaced a genuine, disclosed jsnes-only
  four-screen-mirroring collapse Mesen does not share (new, unresolved, named for the next round).
  `streamworld_hot.asm` is now in Appendix B.
- Chris's decisions 1-3 (§10): the throughput table with real sustained-rate numbers and the
  chosen row marked; the dialogue open/close transaction, re-measured on the current tree
  (835,723 cycles / 28.06 frames for the close, not the stale ~698k figure; 29,831 cycles / 1.00
  frame for the open); the three small-map bounds, separated.

**Proposed design (specified in full, not built — the review's own "required now" bar for these,
not shipping code)**:
- **Finding 3** — the full mixed-project lookup contract: the real emitted-column table (14
  bytes/streamed-map, not 4), global `flat_screen` resolution, ordinary-column compaction, runtime
  paths per consumer, an `emitScreens` pseudocode diff.
- **Finding 4** — the aggregate allocation formula (ordinary and streamed maps together, not
  map-by-map), the real battle-region charge (one, not two — `codeRegionCount` corrected), the
  streaming cold-code region charged alongside it, the candidate-transformation/rejection-
  preservation/load-time-refusal contract.
- **Finding 5** — the per-direction/corner probe algorithm, the map-edge wall, ownership/cache
  timing, actor/contact/scripted-Move identity at a boundary, representative and worst-case
  per-frame probe costs from finding 2's own real numbers.
- **Finding 10** — the save coordinate domain per mode, the mode-aware validation rule, and why no
  new compatibility token is needed (the range check itself is the compatibility mechanism).
- **Finding 12** — the battle-return spawn/restoration vs. entry-event-suppression split; the
  `rebuild_bound_cache` streamed-guard/zero-record-accessor specification.

**Still open, honestly**: the map-narrower-than-window wraparound policy (finding 1, named, not
built); the generator's real `emitScreens` diff and `kernelTableBytes` per-map branch (finding 3,
shipping code); the collision/actor consumer wiring (`player_hazard`/`entity_contact`, finding 5);
`checkStreamedMapperSwitch`'s own shipped implementation (finding 4); the `sw_project_axis`
Y-axis threshold parameterisation (finding 6, a disclosed simplification: `delta > 255` is exact
for X, a stand-in for Y's real 239-line threshold); the jsnes four-screen-mirroring collapse
(finding 9, new this round); phase 3's own two-nametable addressing and Mesen proof.

**Round 6 (this round).** Review 5 (`streamed-worlds-design-1-review5.md`) returned FIX, 12
findings, seven P1 — Chris's three decisions stayed settled throughout; every finding was about
implementing them correctly, not reopening them.

**Working fix (real code, real measurement, this round)**:
- **Finding 1** — `sw_move_tick`, a real, tested, evenly-spaced one-in-three movement schedule
  (0.333 px/frame, real margin below both 0.5/0.533 sustained rates), gating movement application
  rather than fighting `dispatch_done`'s own per-frame `cur_speed` rewrite; knockback exempted,
  scripted `Move` not; no stop/blank backstop (retracted — the schedule genuinely closes).
- **Finding 2** — `sw_terrain_or_fill`, a real fill-aware resolver routing every terrain read
  through a bounds check before any bank switch; proven against the reviewer's own exact
  reproduction (1×1 grid, screen `(1,1)`, now returns fill not fixture data); the 2×2 minimum and
  the refusal-until-wraparound text retracted; the dead axis corrected to one screen, not two; a
  full viewport-origin convention (smaller/equal/larger than the window) specified.
- **Finding 4** — the real defect (`sw_read_transaction` restores the bank but not `mtptr`)
  reproduced exactly, and fixed by correcting *which primitive* a collision probe uses
  (`sw_peek_byte`, which restores both — proven cross-screen-then-same-screen); a real, chosen actor
  policy (non-player actors clamped to their own screen, never reassigned); the cost table's
  illegal `(254,254)` and wrong 295-cycle figure both corrected.
- **Finding 5** — `sw_project_axis` rebuilt: the double-centring bug and the negative-edge hardware
  error both fixed and proven with 14 genuinely independent, hand-computed test cases (not an
  oracle repeating the routine's own arithmetic); cheaper than the buggy version (51-67 cycles, not
  79-91).
- **Finding 9** — real byte totals per placement category; the `sw_goto`-family "must be banked"
  contradiction fixed by correcting the underlying claim (they cannot be, ever); a real measured
  cost comparison for routing the strip readers through `sw_read_run` (cheaper at good coordinates,
  ~2× worse at the worst legal one); a complete RAM map for every new byte this round needed,
  placed in two real, previously-untouched free blocks once the `$05A0-$05FF` gap was exhausted.
- **Finding 10** — the suite re-run fresh (57 ok/3 FAIL, reproduced before the fix); `sw_debug_chunk`
  (a new ROM byte) lets T3 derive its own NMI-count expectation from the real compiled constant
  instead of a second hardcoded literal; 61 checks, 0 FAIL, exit 0, re-run again just before this
  report.
- **Finding 11** — the "jsnes four-screen collapse" claim retracted and replaced with the real
  explanation (a raw, unpatched-header ROM compared against a patched one); re-verified
  independently; a header-byte assertion added to the quadrant builder.

**Proposed design (specified, not built — review 5's own "required now" bar)**:
- **Finding 6** — global ids reassigned in real project order (the ordering bug fixed) and
  `map_base` reused rather than duplicated, removing the double-counted charging formula; the
  corrected formula and `emitScreens` pseudocode both derived from the fix, not re-guessed.
- **Finding 7** — the aggregate allocation check rebuilt around the real existing packer
  (`screenCapacityFor`'s own sequential whole-record bin-packing), not an invented fixed-record
  division formula.
- **Finding 8** — the dialogue open transaction corrected (it cannot call `redraw_screen` at all,
  for three real reasons — ordinary-only tables, precomputed attributes the streamed record lacks,
  and a wrong entity respawn); a real single-screen streamed-draw cost reasoned from
  `sw_render_window`'s own measured per-nametable cost (≈7 frames, not the borrowed 1-frame
  figure); an explicit in-loop music beat, sprite-mode, MMC3-split and overlay-nesting contract.
- **Finding 12** — the reconciliation sweep: §3's refusal-until-wraparound and §5's 2×2 minimum
  retracted with the real fix in their place; the transition table's stale "dialogue banned in
  phase 2" row corrected to match decision 2; R8's own superseded ~292-cycle/open-gap bullets
  replaced with a pointer to the real fix; R16's "genuinely inert" claim retracted in favour of the
  real streamed-guard requirement already specified in §4.

**Still open, honestly**: the map-narrower-than-window wraparound policy remains out of scope
(fill padding answered the original ask without it, so this is no longer blocking); shipping
generator code (`emitScreens`, `kernelTableBytes`, `screenCapacityFor`'s own region-slice
parameter); the collision/actor consumer wiring into `player_hazard`/`entity_contact`;
`checkStreamedMapperSwitch`'s own shipped implementation; the bulk-copy restructuring that would
make `sw_render_window`/the strip starters genuinely bankable (named as a real, phase-2-blocking
risk this round, not a footnote); the new single-screen streamed-draw routine itself (reasoned and
costed, not built); phase 3's own two-nametable addressing and Mesen proof.

**Round 6 → fix round 7 (this round).** Review 6 (`streamed-worlds-design-1-review6.md`) returned
FIX, 9 findings, 7 P1 — but this round's own headline was two NEW decisions from Chris
(2026-09-17, ~23:45), each rejecting a whole mechanism fix round 5/6 had built, not merely asking
for a correction to it:

- **Decision A, throughput — REJECTED and rebuilt.** Chris: *"match the streaming from fallen
  star... reuse that streaming code and match that performance."* The one-in-three schedule
  (0.333 px/frame, 20 px/s) is retracted outright, along with `sw_move_tick`/`sw_move_gate`
  (kept as commented-out history, not deleted). Replaced with FALLEN STAR's own exclusive-vblank
  NMI arbitration (`boot.asm`'s own splice, this round: either `vram_drain` runs or `sw_nmi_stream`
  runs, never both in one vblank) plus a per-axis subpixel accumulator
  (`sw_walk_step_x`/`sw_walk_step_y`, `SW_SPEED_SUB_X=128`/`SW_SPEED_SUB_Y=112` — 1.5/1.4375
  px/frame). `SW_STREAM_CHUNK` raised 1→3 — real, measured (both boards, both physical parities,
  Mesen exit 0), not a rounded-up guess; 4 is the real negative control (not 2), matching FALLEN
  STAR's own documented threshold exactly. Proven: the arbitration itself (Mesen, both boards,
  chunk 3/4, empty/non-empty queue, even/odd parity, plus a separate never-shipped "unconditional"
  board copy as the historical negative control); the sustained rate (real 6502 execution of both
  accumulators cross-checked against the arithmetic model, worst-case single-crossing margin, and a
  5,000,000-frame queueing simulation showing window lag never exceeds 1 block on either axis —
  versus the UNFIXED vertical-at-128 regression, which reaches the 8-block resync guard after only
  2,144 frames, a real, quickly-reached failure this round found, not a hypothetical one); Flash's
  own yield cost (bounded, safe-recurrence thresholds found by search, both axes); repeated
  knockback (review 6's own finding 1 concern, checked against `IFRAME_TIME=60` and shown to
  genuinely diverge under sustained abuse, with the position-jump guard as the accepted, rare
  backstop for that one case). The 4-way diagonal-arbitration rule (`sw_axis_arbitrate`, FALLEN
  STAR's own `up_chkh`) is specified, not built, this round.
- **Decision B, dialogue — REJECTED and rebuilt, dramatically cheaper.** Chris: *"Ask for a cheaper
  path."* Fix round 6's own ~35-frame (0.58s) open+close forced-blank transaction (a new
  single-screen `sw_render_window`-shaped draw to open, a full four-nametable `sw_render_window`
  pass to close) is retracted. Replaced with a camera NUDGE to the nearest 16px alignment (at most
  15px/axis, one same-frame register write, no torus/window change at all) plus a real, proven
  accessor (`sw_dlg_metatile`, composing `sw_terrain_or_fill` with a caller-supplied origin) for the
  close-path rebuild. Measured against the ENGINE's own existing box-open/close pacing (not
  re-derived): open costs **0 extra frames** (the nudge lands in the same vblank as the box's own
  first drawn row); close costs the same **7 frames** an ordinary screen's own `box_close` already
  pays (6 rows + 1 attribute packet), not 28 — because this design reuses that exact mechanism
  outright rather than a full torus redraw. Music keeps its normal rate for free (no long
  forced-blank loop exists to starve it, unlike fix round 6's own design, which needed an added
  polling call to avoid exactly that). `sw_dlg_metatile` proven against an independently-resolved
  direct `sw_terrain_or_fill` call, seven cases (no wrap, column wrap, row wrap, both, mid-grid,
  fill). The naming grid is explicitly scoped OUT of this cheap path (it draws far more than six
  rows) and keeps the older, more expensive transaction; MMC3's split, sprites and a strip-in-flight
  are each worked through and shown unaffected/resolved by decision A's own arbitration, not
  merely asserted.
- **Findings 2 (fill/camera), 3 (banked-consumer routing), 4 (emitted layout), 5 (packing
  predicate), 7 (placement decomposition), 8 (collision costs/actor bounds), 9 (one specification)
  — carried forward, not re-opened this round.** Chris's own two new decisions were this round's
  explicit scope (`brief-streamed-worlds-design-fix7.md`'s own "headline of this round" framing);
  these seven findings stand exactly as review 6 stated them, still real, still unresolved. The RAM
  map (§5) and the two stale sections directly contradicted by decisions A/B (§3's own R4 throughput
  conclusion, §9's own phase-2 chunk policy) were corrected for internal consistency, since leaving
  them would have created a document that disagreed with itself; nothing beyond that internal-
  consistency requirement was attempted for findings 2-5/7-9.

**Round 7 → fix round 8 (this round).** The orchestrator's own instruction: fix 7 called findings
2, 3, 4, 5, 7, 8, 9 "not touched this round... because the two decisions were the headline" — but
"headline does not mean only." This round is those seven findings, all of them, to the depth the
fix-7 brief itself states. Decisions A and B are unchanged (their own proofs were independently
reproduced by the orchestrator before this round began) and are not reopened.

**Working fix (real code, real Mesen/6502/JS execution, this round)**:
- **Finding 3** (P1, banked consumer routing — "the headline engineering item," per the brief) —
  built and proven: `sw_strip_fetch_run_col`/`row` (a new resident, kernel-lo primitive fetching one
  screen's own strip contribution in a single switch/read/restore transaction, restoring via
  `sw_caller_bank`) and `sw_banked_stream_start_col`/`row` (the arm built on it, composed from 2-3
  whole-screen run fetches instead of 30/32 individual byte reads). Proven identical to the
  already-proven mainline routines at 8 origins spanning both axes and both the 2- and 3-screen
  cases this round's own work found real (a strip touches THREE screens, not two, whenever the
  window's own local origin is nonzero — a genuine fact, not previously stated this precisely
  anywhere in this document). Proven callable from a genuinely banked context (PRG register 7
  selected before the call, restored after). Real cycle costs measured: 2,357-2,843 cycles per
  complete arm (7.9-9.6% of one NTSC frame). **Three real bugs were found and fixed via this proof,
  not merely reasoned about**: the primitive cannot live in a switchable bank at all (a real crash,
  "invalid opcode," the moment `sw_goto`'s own internal bank switch ran); `sw_goto` clobbers
  `sw_tmp2` internally, so a value stashed there before calling it is destroyed, not merely
  fragile; and a copy-paste slip in the row arm read the entering screenRow where the entering
  localRow belonged. `minimal-u512`'s own kernel-lo has no room for the primitive (finding 7,
  below) — `minimal-u512-fs3`, reproducibly derived (`proto-tools/rebuild_minimal_u512_fs3.mjs`,
  injecting the real, bug-fixed source from two template files, never requiring the shared
  `minimal-u512` itself to carry code it cannot assemble), is where the proof actually runs.
- **Finding 5** (P1, packing predicate) — the reviewer's own 26-record MMC3 case reproduced against
  the REAL shipped `screenCapacityFor`/`assignScreenBanks` (not a reimplementation), reaching the
  identical "1 screens did not fit" message; the fix (call `assignScreenBanks` itself, in validation
  mode, rather than trusting `screenCapacityFor`'s own count) proven to correctly reject the bad
  case and accept the good one. `ordinaryNeed` confirmed never to have existed in shipped code.
- **Finding 9** (P2, one specification) — a real unaligned/all-parity `sw_render_window` regression
  (56 independent observations: all 4 origin parities at aligned local=0, plus a genuine unaligned
  sweep at 3 nonzero local offsets, cross-checked against an independently-transcribed formula
  feeding the already-proven `sw_terrain_or_fill` accessor) — smaller than the reviewer's own
  52,224-comparison exhaustive ask (disclosed honestly: most origin/local combinations read past the
  3×3 fixture's own real data, which is `sw_render_window`'s own separate, already-named finding-2
  gap, not this test's job to re-litigate), but real, new coverage where only one point previously
  existed. The stale, unlabelled "old projection commentary" (finding 9's own named complaint) is
  now marked SUPERSEDED HISTORY rather than left ambiguous about which of two comment blocks
  describes current behaviour.
- **Finding 8** (P2, collision costs/actor bounds) — `sw_peek_byte` re-measured directly (274/317
  cycles at (0,0)/(1,1), confirming review 6's own 273/317 figures and correcting the doc's own
  mislabelling of `sw_read_transaction`'s 219/261 as `sw_peek_byte`'s); the `(0,254)` "worst case"
  retracted as author-unreachable (a 1-column×255-row map needs 255 screen regions, more than any
  real board has — UNROM 512's own ceiling is 61) and replaced with a real, reachable worst case
  (`(0,60)`, 1,288 cycles); the numeric actor clamp chosen explicitly (`MAX_X`/`MAX_Y` containment,
  matching the player's own existing wall, not bare origin clamping).

**Proposed design (specified, not built — real numbers where measurable, real code where the
brief's own scope allowed)**:
- **Finding 2** (P1, camera clamp) — the conflation between the WINDOW's own resident-buffer origin
  (correctly frozen on a map exactly the window's own size) and the CAMERA's own viewport position
  (which must still traverse the full map, and was wrongly frozen too) is corrected: `cameraOrigin =
  clamp(desired, 0, max(mapPixels - viewportPixels, 0))`, independent of the window's own state;
  decision B's own camera nudge is specified to clamp into this same range, rounding down at a map's
  own far edge rather than past it.
- **Finding 4** (P1, emitted layout) — the false claim that tileset was already part of the 9
  per-map identity bytes retracted (it is a per-SCREEN column, `screen_tileset`, which a streamed
  map has none of); a real per-map tileset byte and `fillMetatileId` byte added to the charge (6
  bytes/map incremental, not 4); the map-type table's own representation chosen (1 bit/map, packed,
  not 1 byte — an explicit rejection of an 8x-wasteful alternative); the engine's own runtime
  resolution for a streamed-screen warp target specified against real ROM data (the emitted
  `map_base` table and a new final-total constant), not a JS `screens.length`; the 16-bit
  pointer-plus-offset accessor for metadata past byte 255 specified precisely (advance `mtptr` by
  256, then index 0-81).
- **Finding 7** (P1, placement/RAM) — a real symbol-span decomposition of every resident piece,
  reproducing the orchestrator's own cited 374-byte NMI-chain figure exactly from this round's
  shifted addresses (validating the method); the mandatory kernel-lo subtotal (1,901 bytes) is
  shown to be almost exactly what the old, criticized-for-its-method "~1,900" estimate already said
  — the method was wrong, the resulting number happened to be close; finding 3's own new primitive
  adds 72 more MANDATORY kernel-lo bytes (1,973 total), and this round's own attempt to add it
  overflowed even the stripped `minimal-u512` fixture, needing two real reductions (camera off,
  debug tables removed, 98 bytes reclaimed) just to fit with 28 bytes free — reported as the real,
  disclosed finding-7 result the brief asked for ("if the streamed feature cannot fit kernel-lo... on
  some board, that is a finding to report with numbers, not to defer"), not deferred again. The
  94-bytes/2-free RAM chain error (a byte miscounted since fix round 5, `sw_fill_metatile_id` at
  `$05FD` never included) is also found and corrected this round.

**Still open, honestly**: finding 4's own shipping generator changes (`emitScreens`, the map-type
bit table, `kernelTableBytes`' per-map branch, the runtime `map_base`-walk routine and the 16-bit
metadata accessor — all specified this round, none built); finding 7's own kernel-lo margin crisis
is measured, not solved — no reduction this round makes the mandatory resident set fit a
content-bearing project, only this round's own stripped test fixture, after real cuts; the
bulk-copy restructuring for `sw_render_window` itself (not attempted this round — decision B never
calls it from a banked context, so it was not required); production wiring of the actor
clamp/collision policy into `player_hazard`/`entity_contact`; `checkStreamedMapperSwitch`'s own
shipped implementation; phase 3's own two-nametable addressing and Mesen proof.

**Two housekeeping items from fix 7, closed**: the two "unconditional NMI" board copies (decision
A's own historical negative control) are no longer ad hoc `/tmp/sw7-*` directories —
`proto-tools/build_unconditional_board.mjs sample-u512 unconditional-u512` (and the identical
command for `sample-mmc3`) reproducibly builds each one under the scratch tree root, from a fresh
copy of the named board, by reverting exactly the two lines the real arbitration splice changed —
re-run this round and confirmed to reproduce the identical `exit 5` (`EXIT_DEADLINE_MISS`) result
`build_deadline_fixture.mjs` already measures. `proto-tools/rebuild_minimal_u512_fs3.mjs` is the
same discipline applied to this round's own new board, built fresh from a script, not a hand-held
copy, every time.

### Round 8 → fix round 9 (this round)

Every one of review 7's seven findings addressed, plus the carried-over kernel-lo placement crisis
(fix round 8) given a real, measured answer.

**Working fix, real 6502/Mesen measurement**:
- **Finding 1** (P2, worst chunk untimed) — the true worst NON-final chunk (row, odd parity,
  `st_vary=29`, wrap-crossing) found by exhaustive isolated-cycle sweep (1,403 cycles, confirming
  the reviewer's own 1,396 to within an established counting-convention gap), then Mesen-timed
  against the REAL arbitrated NMI with camera publication, an active shake, and (MMC3) the split's
  own longer enabled branch, both boards: **exit 0, real margin (~237.7 cycles U512, ~180.0 cycles
  MMC3)**. Chunk 4 at the identical worst configuration misses on both boards (`EXIT_DEADLINE_MISS`,
  landing past the end of vblank entirely) — the real negative control, not a rounded-up guess.
- **Finding 2** (P1, lag model didn't match the real shared scheduler) — `st_active` is one shared
  byte; fix round 7's own per-axis-independent queue model is retracted and replaced with a
  scheduler that matches it exactly, sanity-checked against the already-proven single-axis bound
  first. Real result: every fixed periodic axis-switching pattern tested (36 combinations) stays at
  `lagMax<=1`; a 19.2-million-frame randomized adversarial sweep finds a worst case of 2 blocks —
  both far under the 8-block resync guard. `sw_axis_pref`'s own storage is NOT resolved (the
  `$03D8-$03E3` gap and the wider `$0300-$03FF` page both audited and confirmed exhausted); the tie
  rule (X wins on a simultaneous first press) is stateless and needs no byte.
- **Finding 3** (P1, Flash needed a real engine answer) — a lag-triggered strip-priority policy
  (`LAG_PRIORITY_THRESHOLD=1`, `DEFER_CAP=1`, searched and sanity-checked against the no-flash
  baseline) bounds BOTH sides unconditionally: strip lag stays <=2 blocks and a queued Flash packet
  is never deferred more than 1 frame, under a PATHOLOGICAL Flash recurrence (bursts re-armed the
  instant the previous one's confirm edge fires) — independent of how often Flash actually recurs,
  replacing the old author-visible recurrence thresholds (X>=32, Y>=171 frames) with an
  unconditional guarantee.
- **Finding 4** (P2, knockback disclosed as divergent rather than capped) — simulated directly
  against the real repeated-hit model: today's 24px knockback diverges under sustained worst-case
  re-hits; 12px is the real safe ceiling; **8px (`KNOCKBACK_SPEED` cut from 3 to 1 px/frame — one
  third the speed, not "halved" — on a streamed map, `KNOCKBACK_TIME` unchanged, so 24px shrinks to
  8px) is the chosen cap**, giving the identical `lagMax<=1` bound ordinary
  movement already holds to — a real, gated constant, not a bigger disclosure.
- **Finding 7's own footprint premise** (naming "owns most of the screen") — read directly against
  `engine/nameentry.asm:1-3` and found false: naming reuses the same six-row box footprint as
  Say/choice. Naming is rerouted onto decision B's own cheap path with no new mechanism; the old
  ~35-frame transaction is retired for every case, not merely superseded for one.
- **The kernel-lo placement crisis (fix round 8, carried over)** — kernel-hi (`$E000-$FFFF`) is part
  of the SAME fixed kernel as kernel-lo, simultaneously mapped, reachable by ordinary `jsr`/`jmp`
  with no trampoline and none of finding 3's own switchable-bank hazard. Measured, both before and
  after relocating `streamworld.asm`'s own home bank in `minimal-u512`: kernel-lo free bytes rise
  from 46 to 6,569; kernel-hi free bytes fall from 7,863 to 1,663 — even moving the WHOLE
  ~6,200-byte prototype file (debug tables and historical cruft included), not just the mandatory
  1,973-byte subset. The crisis is dissolved by this measurement.

**Proposed design, specified in full, not built this round**:
- **Finding 5** (wrapped dialogue writes) — one address mapper + split-at-seam packet writer for
  every text/choice/clear/name-token destination, specified precisely (mod-30/mod-32 wrap rules,
  the real 27-byte/9-column/3-row worst-case attribute footprint, up to 6 restore packets, the
  `attr_shadow`-as-restore-source rule). Real open/close frame counts derived arithmetically (open:
  still 0 extra frames, 7 drawing steps not 6; close: up to 12 frames, not 7, from the corrected
  attribute-restore packet count) — not yet Mesen-measured.
- **Finding 6** (the dialogue transaction's own state machine) — `box_begin` draws nothing (the
  reviewer's own correct reading, the design's earlier "same-vblank publication" claim retracted);
  the camera rounding/tie/clamp rule, the viewport-origin correction (`sw_dlg_metatile`'s own `+12`
  already handles it; the CALLER's own input was misdescribed), coherent publication through
  `cam_dirty`, an in-flight strip's own address-disjointness proof, same-box/nested/Shake policy —
  all specified. Not built or Mesen-exercised this round (a seam-crossing open, map-edge nudge,
  typing wait, sprites and close on MMC3 remain the concrete next scope).
- **The kernel-hi placement's own functional half** — the capacity math is proven (above); the
  actual generator/engine change (splitting the two bank-14-targeted routines into their own file
  to avoid a real nesasm mis-resolution this round's naive relocation hit, then re-proving
  `verify_torus.mjs`/the arbitration Mesen checks/finding 3's own banked-strip proof against the
  corrected placement) is not done this round.

**Still open, honestly**: everything the "Working fix" list above did not close outright —
`sw_axis_pref`'s own real storage byte; the new arbitration's own `boot.asm` splice (specified, not
spliced); the streamed-knockback constant's own engine wiring; naming's own generator/engine
routing change; findings 5/6's own mapper, packet writer and state-machine code; the kernel-hi
placement's own working generator/engine change. Everything finding 4 (§5, emitted layout),
finding 5 (§5, packing predicate — CLOSED, unaffected by this round), finding 8/9 (§5, collision
costs/one specification — CLOSED, unaffected) already closed in fix round 8 remains closed,
untouched this round.

### Round 9 → fix round 10 (this round)

A narrow brief: exactly the two engineering builds review 8's own exit list named as deliverables 3
and 4 (finding 6, the kernel-hi placement; finding 4, fill-aware consumer routing). No other finding
touched. Both builds are **working, proven, real**, not merely specified.

**Build 1 (review 8, finding 6) — working fixed-bank placement, root cause found, bank-14 cold path
retired.** The round-9 `$0160` crash's real cause: `sw_dlg_metatile` and `sw_run_bank_test` (two
never-shipped, bank-14-only prototype routines) sat interleaved inline inside `streamworld.asm`
itself, the file being relocated wholesale — not an nesasm multi-bank bug (review 8's own reading of
`source/command.c`/`main.c` was correct: repeated `.bank 14` excursions round-trip their own
location counter and page fine). Splitting them into their own file, `streamworld_bank14.asm`, kept
at the file's original kernel-lo position, and leaving `streamworld.asm` with no `.bank` directive
of its own made the relocation work immediately: `nesasm -s main.asm` gives `BANK 62 (kernel-lo)
6210/1982`, `BANK 63 (kernel-hi) 2265/5927`; `main.fns` resolves `sw_stream_start_col = $E35B`, a
real kernel-hi address. `proto-tools/check_r10_symbol_ranges.mjs` confirms all 112 resident labels
fall inside `$E000-$FFF9` with no overlap against music/text. `verify_torus.mjs` **61/61 ALL PASS**;
`diag_r8_unaligned_parity.mjs` 56/56; a renamed `diag_r10_banked_strip.mjs` (re-pointed at
`minimal-u512`, `minimal-u512-fs3` retired) 25/25, real cycle costs reproduced within a few cycles of
fix round 8's own figures. **New result, not merely a repair**: with the resident set moved out,
kernel-lo has enough spare room (1,982 bytes) that fix round 8's own banked primitive (73 bytes) AND
its arm (275 bytes) both fit directly as ordinary kernel-lo code, with 1,634 bytes still free — the
bank-14 cold path this design carried since fix round 8 is not needed at all; the extra switchable
code-region reservation is dropped from the capacity model for this feature. A new named allowance,
`STREAMWORLD_KERNEL_HI_ALLOWANCE = 1,901` (not fix round 8's own provisional 1,973 — that figure
double-charged the now-kernel-lo primitive), joins `generate.js`'s existing
`musicBytes+sfxBytes+text.bytes > BANK_SIZE-64` check; the largest music+sfx+text payload a streamed
project can carry is `6,227` bytes, not the previously-estimated 6,155. **Finding 7's own two real
defects fixed**: `SW_STREAM_CHUNK=3` is now the checked-in default on both "hot" Mesen boards
(previously 1, backwards from decision A's own choice); `build_f9_worst_chunk_fixture.mjs`'s own
MMC3 detection tested `constants.asm` for a flag only `assets/config.inc` ever defines, so it never
actually forced `split_mode` on MMC3 in any prior round (fixed; a `box_state` poke already drove
`split_select` correctly regardless, so no prior timing number changes). Re-timed with `SHAKE_ENABLED
= 1` genuinely compiled AND exercised (asserted in the harness, not merely claimed) on the relocated
placement: `sample-u512` margin 208.7 cycles (down from round 9's own un-exercised 237.7), `sample-
mmc3` margin 143.0 cycles (down from 180.0) — both still solidly positive at chunk 3; chunk 4 still
misses badly on both boards.

**Build 2 (review 8, finding 4) — fill-aware consumers, complete, and the full regression, now
runnable.** `sw_terrain_or_fill` being proven (fix round 5) was necessary but not sufficient: neither
mainline strip arm, the full renderer, nor fix round 8's own banked primitive ever called it — each
did its own raw `jsr sw_goto` + `[mtptr_lo],y` inline. Fixed: `sw_stream_start_col`/`row` check
bounds once per block before the existing relocate-cache test; `sw_render_window` gained one shared
`sw_rw_read_metatile` routine, fed by a new `sw_rw_oob` flag `sw_rw_probe` (terrain) and
`sw_rw_attr_y_combine` (attribute) each set from the identical bounds test; `sw_strip_fetch_run_col`/
`row` checks bounds once per call (a call always targets exactly one screen) and fills the whole
requested run or reads it for real, never a mix. No raw `sw_goto`+`[mtptr_lo],y` dereference remains
in any of the four consumers — confirmed by grep. **Proven**: `diag_r10_smallgrid.mjs`, 528
observations, ALL PASS, on a 1×1, a 1×3 (1×N), a 3×1 (N×1) and a 3×3 grid — both arms in both
directions, the renderer's terrain and attribute output, all against `minimal-u512`'s own real
fixture with `sw_grid_w`/`sw_grid_h` poked smaller than the fixture's physical extent (no new ROM
needed); `diag_r10_primitive_fill.mjs`, 4/4, proves the banked primitive's own fill path separately
(whole run filled, caller's bank never switched away, cheaper than the real path). **The full
unaligned × all-parity regression fix round 8 explicitly could not attempt is now real**:
`diag_r10_full_parity.mjs`, all 4 origin parities × all 240 local-offset combinations × 4 nametables
× 2 points each, **7,680 comparisons, ALL PASS** (101.5s) — not claimed identical to the reviewer's
own cited 52,224-comparison figure (its derivation was not reproduced), but a genuine exhaustive
sweep of the entire parity/local-offset space, many of whose comparisons resolve to fill on screens
the 3×3 fixture never populated. Costs re-measured, real-read vs. fill, both arms, the primitive and
the renderer (`diag_r10_routed_costs.mjs`): the new bounds check costs ~719 cycles per 30-block
column strip (~24 cycles/block, two unconditional zero-page compares); the mainline per-frame cost
at 1.5 px/frame is unchanged in kind — a column strip still arms once per 10-11 frames, so this
overhead lands on that single arming frame, not every frame. The collision-outside-the-grid-is-a-wall
contract (Decision 3, point 3, §10) needed no new code this round — it was already specified and
remains a design contract for the (unbuilt) production collision code, distinct from the terrain-fill
contract this round's own work extended to every consumer.

**Ground rules honoured**: `minimal-u512-fs3` retired (superseded by proof that `minimal-u512` itself
now holds everything); all throwaway Mesen/build output for this round lives under the scratch
tree's own `fix10-out/` directory, nothing under a bare `/tmp/sw10-*`; both builds' own source edits
are real, working 6502/JS, not specification prose.

**Still open, honestly**: findings 1/2/3/5/8 (§1/§2/§3, the scheduler/Flash/dialogue-transaction
proofs) are untouched this round, exactly as briefed — the shared-server model, the Flash priority
policy, the dialogue mapper/state-machine specification and the collision-cost corrections all stand
as fix round 9 left them; finding 5's own emitted-layout production generator changes remain unbuilt;
`STREAMWORLD_KERNEL_HI_ALLOWANCE`/`STREAM_BANKED_ALLOWANCE`'s own real `generate.js` wiring is
specified this round, not shipped; `sw_dlg_metatile` (decision B's own dialogue accessor) stays in
the bank-14 test file, untouched — it is a different finding's own prototype, not part of this
round's scope, though the same headroom that let the banked primitive/arm move to kernel-lo would
very likely also fit it there, unmeasured this round.

### Round 10 → fix round 11 (this round)

The one deliverable the brief named: the service design (findings 1 and 2, review 8), plus Part C's
own archival/wording/collision corrections. No other finding touched.

**Part A — Flash, replaced not repaired.** `diag_f9_flash_priority.mjs`'s own two-edges-total bug
confirmed and retired as history (its `nextArm` schedule zeroes out at `flashPeriod=6`); the
`LAG_PRIORITY_THRESHOLD`/`DEFER_CAP` deferral policy itself retracted, not re-tuned — it breaks
`flash_tick_confirm`'s own "every published queue drains on the very next NMI" handshake regardless
of the threshold chosen. **Replacement, real and Mesen-timed**: a "mixed vblank" — a small
(`<=35`-byte, one real packet) queue drains in full **and** a reduced strip chunk (3→2 blocks)
advances the same vblank, on a single branch taken *before* `vram_drain` runs (no RAM byte needed).
Margins: UNROM 512 ~109.7 cycles, MMC3 ~47.0 cycles, both real and positive at the worst strip shape
with Shake/camera/split live; the one-more-block negative control (an unreduced chunk of 3 combined
with the same drain) misses badly on both boards; a byte-count boundary control (36 bytes) correctly
falls back to exclusive drain. **The fastest legal Flash re-arm cycle derived from the engine's own
rules, not assumed**: a corridor of distinct touch-triggered `[Flash]`-only actors, one per metatile
(each freezing the world for exactly the one frame it runs on, `box_close`'s own `BOX_CLOSED`
short-circuit), re-arms Flash on literally every crossing — the tightest rate the engine's touch/
interact/enter rules permit while still tied to real player movement. **That case genuinely diverges
under the mixed-vblank mechanism alone** — an honest finding, not assumed to close because each edge
got 3× cheaper. Coalescing (the brief's other named lever) does not help it: the worst legal period
(10-12 frames) never overlaps a burst's own ~8-frame lifecycle, the only regime coalescing improves.
**The chosen lever: real per-axis slack, both axes** — `SW_SPEED_SUB_X` 128→112 (1.5→1.4375
px/frame), `SW_SPEED_SUB_Y` 112→96 (1.4375→1.375 px/frame), found by direct search
(`diag_f11_flash_speed_search.mjs`, confirmed at 10,000,000 simulated frames) and confirmed closing
the worst legal recurrence at `lagMax=1` on both axes (the same bound the no-flash baseline already
holds) — a wider correction than the brief's own Y-only framing anticipated, since X's own margin
turns out equally exposed under the Flash-loaded case, reported rather than narrowed to match.

**Part B — the shared scheduler, specified as the engine will run it, and exercised for real.**
FALLEN STAR's own `update_stream` shape (signed desired/current window origin per axis, current
advancing by exactly one block at ARM time, one shared server, arm only when idle) generalised to
this project's asymmetric axis costs and screen/local addressing (`diag_f11_scheduler.mjs`). The
minimum valid-visible margin derived from the real 32×30 torus / 16×15 viewport shape (hard limits:
16 blocks X, 15 blocks Y, before a genuinely undrawn column could enter view) — the existing flat "8"
threshold confirmed safe on both axes with real spare margin, not merely copied from FALLEN STAR.
Five exercises plus a forced same-vblank-handoff check plus a negative control, each asserting its
own event counts: held single axis (`lagMax=0`), turn every block (`lagMax=1` worst found, 2,592,000
frames swept), reversal mid-strip (`lagMax<=1`, ≥17,000 reversals exercised per case — **the engine
always finishes the in-flight strip, by construction, since the accumulator is magnitude-only and
`current` only ever advances for a crossing that already physically happened**, not a new mechanism),
walking into a map clamp edge (`lagMax=0`), the corrected Flash service at its worst legal recurrence
(`lagMax<=1`, 515,621 genuinely mixed vblanks exercised on the tight Y axis), a forced deterministic
same-vblank handoff (exactly 1, as designed), and capped knockback repeated at `IFRAME_TIME=60`
forever (`lagMax=0` at the new slack — better than the historical D=8 table's own `lagMax=1`). The
negative control (the OLD `SW_SPEED_SUB_Y=128`, no Flash) reaches the resync guard at frame 2,495,
proving the control lives. Mainline arm costs (fix round 10's own 3,911/4,077-cycle figures) charged
against the 29,780-cycle frame budget at 13.1%/13.7% of the single arming frame, unsustained.

**Part C — archive and correct.** `sw_axis_pref` assigned `$C7` (confirmed free), zero-page ledger
now 56 free (was 57). The knockback table archived for real
(`diag_f11_knockback_archive.mjs`) — D=24/20/16/12/8 → 7,174/4,674/2,175/2/1, an exact reproduction
of review 8's own independently-reconstructed figures. Wording fixed in both places it appeared:
3→1 px/frame is **one third** the speed, not "halved"; 24px→8px over the unchanged 8-frame
`KNOCKBACK_TIME`. Finding 8's contradiction fixed: the previous screen's actors **disappear**, not
"still drawn" — the current-screen-only live array holds nothing for a departed screen, full stop.
The collision worst-case cost corrected to `sw_peek_byte`'s own real, measured total (1,412 cycles at
`(col=0,row=60)`, not `sw_goto`'s bare 1,288) and the stale "even after reserving room for other
content" hedge removed — fix round 10 already confirmed the streaming mechanism itself needs no
switchable code-region reservation, so 61 (UNROM 512) genuinely is the final, unconditional region
ceiling, not a hopeful best case; the four-probe worst-case fraction of the frame budget corrected to
19.0% (was ~17%, using the wrong routine's cost). The fix-9 arithmetic slip corrected: 40×6×2×400,000
is 192 million frames, not 19.2 million (the sweep's own worst-lag finding, 2 blocks, is unaffected —
only the frame count was wrong).

**Ground rules honoured**: no whole-file writes, every edit a targeted insertion or precise
string-replace; §13 (this entry), a per-section before/after char table (below), Appendix B
(Round 11) all real command output; only `docs/design-streamed-worlds.md` and `handoff-next/` changed
in the real tree; every throwaway build/Mesen/simulation artefact lives under the scratch tree's own
`fix11-out/` directory.

**Still open, honestly**: findings 3/5 (§2/§3, the dialogue overlay transaction and the emitted-layout
production generator changes) are untouched this round, exactly as briefed — next round's own scope.
Consolidating the document into one current, non-historical contract remains the round after that.
Production wiring of everything proven this round (`sw_axis_arbitrate`, the mainline
`update_stream`-equivalent driver, `SW_SPEED_SUB_X/Y`'s own real generator constants,
`MIXED_VBLANK_MAX_BYTES`/`sw_nmi_stream_reduced`'s own shipping placement) remains phase 1/2, as
every prior round's own disposition already states for this class of change.

### Round 11 → fix round 11b (this round)

A one-item follow-up, briefed by the orchestrator directly (not a fresh reading of review 8): fix
round 11's own conclusion that both axes needed slowing down is **wrong**, caused by a real bug in
`diag_f11_flash_speed_search.mjs`'s own simulation, not by a real property of the workload.

**The bug**: the model's own prose claimed to credit the 1-frame freeze a touch event costs, but the
actual `simulate()` function never paused the accumulator for that frame at all — every simulated
frame advanced movement unconditionally, silently contradicting the report's own claim. **The second,
compounding error**: the "worst legal recurrence" was modelled as an unbounded corridor (Flash
re-armed on literally every crossing forever), when the real engine caps a screen at `MAX_ENTITIES=8`
(confirmed by generator refusal, not merely cited) — a streamed map's own current-screen-only entity
policy (Decision 3, above) means no more than 8 of any 16/15 consecutive crossings can ever carry a
fresh touch actor.

**Measured against the real engine** (`proto-tools/measure_f11b_flash_touch_row.mjs`, an `mkdtemp`
copy of `sample/`, the checked-in fixture untouched): a real touch-triggered `[Flash]`-only event
freezes movement for exactly one frame, coincident with the arm, confirmed across 8 real actor
contacts; re-arming an active burst (forced via a synthetic close-spaced fixture, since realistic
16px spacing never naturally overlaps) makes `flash_left` jump straight back to 7 with no restore
edge ever queued for the interrupted burst, exactly as `script_op_flash`'s own missing guard
predicts. Both facts, fed into a corrected model (`proto-tools/diag_f11b_legal_worst_case.mjs`) with
the real 1-frame freeze and the real 8-per-screen cap, close at the **restored, unslowed FALLEN STAR
speeds** — `SW_SPEED_SUB_X=128`/`SW_SPEED_SUB_Y=112` — with `lagMax<=2` on both axes over 10,000,000
simulated frames, including the (labelled beyond-legal) unbounded-corridor stress. **Fix round 11's
own 112/96 reduction is retracted in full**; Decision 1's own text is marked superseded rather than
rewritten, quoting the retracted claims exactly.

**The MMC3 mixed-vblank margin (~47 cycles) was also re-examined this round**: a full read of
`engine/boot.asm`'s real `nmi:` routine confirms its only two `jsr` targets are `vram_drain` and
`split_arm` — every other producer (`music_tick`, `sting_tick`, `flip_tick`) runs from `main_loop`,
never `nmi`, and cannot compete for that vblank regardless of project content; the fix round 11
Mesen fixture already modelled the complete routine. MMC3's reduced chunk stays 2.

**Ground rules honoured**: no whole-file writes; this entry plus the superseded-and-quoted Decision 1
text plus the updated Appendix A/B staleness notes are the only design-doc changes; the report is
appended to (`streamed-worlds-design-fix11-report.md`), not replaced or duplicated into a new file,
per the brief's own instruction.

### Round 11b → fix round 12 (this round): the dialogue overlay prototype, review 8 finding 3

The one deliverable this round: fix review 8 finding 3's own contradictions in Decision 2 (nametable
parity vs. tile parity, the mapper's quotient/remainder, packet-byte arithmetic, masked-attribute
open/close, publication ordering, the pending-strip rule) and BUILD a real prototype of the mapper,
split-at-seam packet writer, masked attribute open and terrain restore — "specified, not built" was
explicitly called out as a failed round by the brief. All seven fixes are in Decision 2 above,
marked SUPERSEDED/WITHDRAWN in place per the ground rule against appending a contradicting rule
beside old text, not appended as a separate errata list.

**The prototype** (`proto-tools/dlg_fix12.asm`, ~841 bytes, injected into `minimal-u512`'s own
never-shipped bank-14 slot right after `sw_dlg_metatile`) builds and Mesen-times real 6502: the
address mapper, the split-at-seam packet writer for both terrain rows and the attribute band, the
masked open / unmasked close, and the pending-strip gate. Proven at five origins (the cited seam
crossing `(1,13)`, fully inside one nametable, X-seam-only, Y-seam-only, and a map-edge clamp) via
real `vram_open`/`push`/`end`/`drain` and jsnes PPU readback against two independent oracles —
`node proto-tools/dlg_fix12_readback.mjs`, exit 0, every check passes at every origin, including
close restoring the whole four-nametable space byte-identical to a REALISTIC pre-open state (real
terrain pre-rendered via the same independent oracle, not jsnes's blank canvas — the naive
blank-canvas version of this check is a false positive, corrected mid-round).

**One real, previously unknown defect found by this round's own readback, not anticipated by any
prior review**: when the box's own start metatile row is exactly nametable-Y-aligned, two adjacent
band rows share one physical attribute byte and each's masked write independently clobbered the
other's already-correct half. Fixed by forcing the full mask (idempotent, order-independent) when
two band rows are detected to share a byte (`sw_dlg_attr_rows_precompute`/
`sw_dlg_attr_forcefull_for`) — logged as a genuine addition to the mask rule, not folded silently
into the "already specified" text.

**Frame counts, measured, better than assumed**: 9 frames to open, 9 to close (18 total, not the
"up to 12+12=24" the corrected-but-unmeasured arithmetic implied), because a split row's own two
packets queue and drain together, one transaction per band row rather than one per packet. Worst
single-transaction queue measured: 38 bytes.

**Mesen, the real unmodified exclusive `vram_drain` path, Shake active, MMC3 split forced to
`SPL_BOX`** (`proto-tools/build_dlg_drain_fixture.mjs` + `sw_dlg_drain_timing.lua.template`, real
`sample-u512`/`sample-mmc3` builds, no streaming code involved since the pending-strip gate means
no strip is ever active during a box's own drain): the 38-byte worst case drains inside vblank on
both boards, exit 0; a 76-byte stress double also passes, exit 0; pushed further to find the
already-existing (not new this round) exclusive-drain boundary, which misses first on MMC3 at 175
bytes and on UNROM 512 at 210 bytes (exit 5) — both roughly 4-5x this design's own real worst case.

**RAM**: 35 new zero-page bytes (`$C7-$E9`) plus 8 more for the merge fix (`$EA-$F1`) — prototype
scratch, 21 of the 56 free bytes after `$C7` remain. The existing `$03DA-$03E3` dialogue bytes are
unchanged; the mapper reads `cam_x_lo`/`cam_y_lo`/`cam_nt` directly rather than keeping its own copy.

**What is still not built**: naming's own reroute onto this path; the real nudge computation itself
(this round pokes the aligned camera bytes directly, matching decision 1's own "camera register fed
continuously... not built this round" scope, per §2's own table); wiring any of this into the real
`box_begin`/`text_open_step`/`text_close_step` state machine (phase 2); the `vram_ready`
resumption-gate fix has no runtime yet to exercise it against.

**Ground rules honoured**: no whole-file writes; edits made in place with SUPERSEDED/WITHDRAWN
markers quoting the retracted text, never a contradicting rule appended beside it; this entry is
the only §13 addition; `handoff-next/streamed-worlds-design-fix12-report.md` has every command run,
its exit code, the size table, `verify_torus.mjs`'s own re-run, `git status --short` and `npm test`.

## Appendix A: the prototype, complete (rebuilt this round)

**Staleness note, fix round 12**: unchanged this round — `dlg_fix12.asm` (the dialogue overlay
mapper/packet-writer/masked-attribute code, §13's own round-12 entry) is a NEW file injected into a
separate `minimal-u512-fix12` copy (`proto-tools/rebuild_fix12.mjs`), never merged into
`minimal-u512` or this embed; `streamworld.asm`/`streamworld_bank14.asm` below are byte-identical to
what fix round 11b left them.

**Staleness note, fix round 10**: `streamworld.asm`'s own full-file embed below is from fix round 7
and does NOT reflect round 10's own real changes — the file no longer contains any `.bank`
directive (the two bank-14 excursions moved to a new `streamworld_bank14.asm`, and the whole file's
own `.include` moved to after kernel-hi in `main.asm`), and the strip arms/`sw_render_window` now
carry the fill-aware bounds checks Appendix B's own new round-10 scripts exercise. Re-embedding the
full ~1,700-line current prototype here is consolidation-round work (§ "Consolidation and the exact
exit" in the review), not repeated every fix round; the authoritative current source is the scratch
tree named in the fix-10 report, not this appendix. Every command and diagnostic script this round
actually ran is embedded in full in Appendix B below, which IS current.

**Staleness note, fix round 11**: unchanged from the round-10 note above, now also stale by one more
round — the embedded `boot.asm` splice below is fix round 7's own arbitration only, and does NOT show
fix round 11's own mixed-vblank branch (Part A, Decision 1's own Round 11 text, Appendix B's own
Round 11 section) or `SW_STREAM_MIXED_CHUNK`/`sw_nmi_stream_reduced`. Appendix B's own Round 11
section has every command that proves the mixed-vblank mechanism.

**Staleness note, fix round 11b**: fix round 11's own speed reduction (112/96) is retracted (Decision
1's own "Round 11b" text, and Part C's corrections below) — `SW_SPEED_SUB_X=128`/`SW_SPEED_SUB_Y=112`
below (the `streamworld.asm` full-file embed) are therefore **current again**, not stale, by
coincidence of the revert landing back on fix round 7's own original values. Nothing else in this
appendix's own embed changed this round.

### `boot.asm`'s own NMI splice, new this round -- decision A, proof 1's own arbitration (the whole change; the surrounding `nmi:` routine is stock `engine/boot.asm`, unmodified)

Applied identically to `minimal-u512/build/boot.asm`, `sample-u512/build/boot.asm` and
`sample-mmc3/build/boot.asm` (the three boards decision A's own proofs use):

```asm
  lda <vram_ready            ; a frame that ran long has not finished appending;
  beq nmi_no_drain            ; skipping leaves the writes for the next vblank
  jsr vram_drain

  .if PALETTE_FX_ENABLED
nmi_fade_ppuaddr:
  lda #$00
  sta $2006
  sta $2006
nmi_fade_ppuaddr_done:
  .endif

  jmp nmi_scroll             ; decision A (fix round 7): the drain ran
                              ; this vblank -- the strip yields. Never
                              ; both a vram_buf drain and a strip chunk
                              ; in the same vblank (FALLEN STAR's own
                              ; nmi_zone_palette-commits-skips-nmi_stream
                              ; arbitration, adopted verbatim).

nmi_no_drain:
  jsr sw_nmi_stream           ; nothing else touched vram_buf this vblank
                              ; -- the strip may advance one chunk

nmi_scroll:
  ; ... unchanged: $2000/$2005 rewrite (camera-composed when CAMERA_ENABLED),
  ; then .if SPLIT_ENABLED / jsr split_arm, then the ordinary nmi epilogue.
```

The pre-arbitration prototype hook (`jsr sw_nmi_stream` placed AFTER `beq nmi_scroll`'s own target
label, unconditionally, every round from R4 on) is retired by this change: it only ever ran the
strip in the SAME vblank as a drain, never on an otherwise-idle vblank -- backwards from any working
arbitration, and never actually exercised as a production NMI shape until this round's own Mesen
proofs (`proto-tools/build_arb_fixtures.mjs`) built one.

### `streamworld.asm`, in full (1853 lines, fix round 7: `sw_move_tick`/`sw_move_gate` retired (SUPERSEDED HISTORY, decision A); `sw_walk_step_x`/`sw_walk_step_y` + `SW_SPEED_SUB_X`/`SW_SPEED_SUB_Y` built (decision A's own per-axis accumulator, proof 2); `sw_axis_arbitrate` specified, not built (decision A's own 4-way rule); `SW_STREAM_CHUNK` raised 1→3 (decision A, proof 1 — the NMI arbitration itself lives in `boot.asm`, not this file); `sw_dlg_metatile` built (decision B's own close-path accessor); the RAM map at `$03D8-$03E3` rewritten wholesale -- kept from earlier rounds: `sw_project_axis`, `sw_terrain_or_fill`, `sw_read_run`/`sw_run_bank_test`, `sw_rw_col_delta`/`sw_rw_row_delta`, `sw_clamp_col`/`sw_clamp_row`, `sw_read_transaction`, `sw_caller_bank`)

```asm
; streamworld.asm -- PROTOTYPE for docs/design-streamed-worlds.md, Q3.
; FIX ROUND 2: rebuilt to answer review 2's findings R1/R2/R6/R11 -- see the
; design doc's own §13 changelog. Not part of the shipping engine.
;
; R1's own correction, adopted: the physical ring position of a world
; metatile is a function of its ABSOLUTE (screenCol,localCol)/(screenRow,
; localRow), never of "how far it sits from the window's current left/top
; edge" -- the fix round 1 defect (round 1 tied physical position to a
; window-RELATIVE offset, which is wrong the moment the window slides, since
; retained content must keep its physical slot while only the entering edge
; moves). Because a screen (16 cols x 15 rows) is exactly half the 32x30
; torus on each axis, the physical half a metatile belongs to is simply its
; owning screen's own row/column PARITY (even screenCol -> left half, odd ->
; right half; even screenRow -> top half, odd -> bottom half), and its tile
; position within that half is exactly 2*localCol / 2*localRow -- no modulo,
; no window-relative math, at the point of drawing. This is FALLEN STAR's
; own wbase_x/wbase_y (win_bx mod 32, win_by mod 30) fact, expressed in this
; project's own (screen,local) terms rather than a flat linear block index.
STREAM_SCREENS_PER_REGION = 24   ; floor(8176/338) -- SCREEN_REGION_BYTES,
                                  ; R6's own uncapped 338-byte record (240
                                  ; terrain + 98 worst-case entity/bound
                                  ; metadata, MAX_ENTITIES=8 * 9 + 1 count +
                                  ; BOUND_CAP=8 * 3 + 1 count = 73+25=98 --
                                  ; NO per-screen entity cap, unlike the
                                  ; round-1/round-2 256-byte record this
                                  ; replaces)
STREAM_SCREEN_BYTES = 338
; SW_STREAM_CHUNK = 3 -- fix round 7, decision A, proof 1: R4's own "1 is the
; only size measured safe" is RETRACTED. That measurement was against the
; PRE-arbitration NMI, which ran a drain AND a chunk unconditionally in the
; same vblank (build_deadline_fixture.mjs's own original template) -- never
; the actual production shape. Under decision A's real arbitration (either
; the drain runs or the strip runs, never both -- boot.asm's own splice,
; this round), a chunk of 3 finishes inside real Mesen vblank timing with
; NOTHING else running that vblank, on BOTH measured boards, both physical
; parities (proto-tools/build_arb_fixtures.mjs, `sw_nmi_arb_striponly.lua`):
; sample-u512 exit 0, sample-mmc3 exit 0 (with SPLIT_ENABLED's own
; split_arm and CAMERA_ENABLED's own $2000/$2005 rewrite both live in the
; same NMI). 4 is the real negative control this round found (not 2): both
; boards MISS at a compiled chunk of 4 with nothing else running that
; vblank (EXIT_DEADLINE_MISS) -- the exact FALLEN STAR threshold ("a miss at
; 4," constants.asm:495-535), not a coincidence, since the arbitrated NMI
; now does structurally the same per-vblank work FALLEN STAR's own does.
; The drain-present case (arbitration-both) still finishes inside vblank at
; every chunk size tested, trivially -- the strip never executes that
; vblank at all when a drain is queued, so its own compiled size cannot
; matter to that frame's timing.
SW_STREAM_CHUNK = 3

; Decision A's own per-axis walk speeds (sw_walk_step_x/y, below).
; SW_SPEED_SUB_X = 128: FALLEN STAR's own WHOLE_STEP=1/SPEED_SUB=128,
; verbatim -- 1.5 px/frame, matched to the column strip's own 30-block/
; 10-vblank cost with a full 1-frame worst-case margin (proof 2).
; SW_SPEED_SUB_Y = 112: NOT the same value -- the row strip costs 32
; blocks/11 vblanks (asymmetric window, unlike FALLEN STAR's own
; matched-cost axes), so matching FALLEN STAR's horizontal rate on this
; axis too would run at an unbounded deficit (proof 2, below). 1.4375
; px/frame is the chosen fix: real positive margin, proven by simulation
; and reasoned from the same worst-case-single-crossing method as the X
; axis.
SW_SPEED_SUB_X = 128
SW_SPEED_SUB_Y = 112

; ---- RAM: chained off msg_name_idx (engine/constants.asm:874).
sw_col            = msg_name_idx+1   ; player's current absolute screen col
sw_row            = sw_col+1         ; player's current absolute screen row
sw_col_rem        = sw_row+1         ; sw_col mod STREAM_SCREENS_PER_REGION
sw_col_region     = sw_col_rem+1     ; sw_col div STREAM_SCREENS_PER_REGION
; sw_col_byte_lo/hi -- R6's own fix: STREAM_SCREEN_BYTES (338) is not a
; power of two and not page-aligned, so the round-1/2 "OR col_rem into
; mtptr_hi" trick (valid only for a 256-byte stride) no longer applies.
; This is the 16-bit byte offset col_rem*338 WITHIN the current region,
; maintained INCREMENTALLY (+/-338 per crossing, sw_cross_right/left) so the
; hot path (sw_locate_current) never multiplies at all -- only sw_goto's own
; cold, arbitrary-column path does, via a bounded repeated-add loop.
sw_col_byte_lo    = sw_col_region+1
sw_col_byte_hi    = sw_col_byte_lo+1
sw_row_bank_base  = sw_col_byte_hi+1
sw_base_bank      = sw_row_bank_base+1
sw_regions_per_row = sw_base_bank+1
sw_grid_w         = sw_regions_per_row+1
sw_grid_h         = sw_grid_w+1
sw_tmp            = sw_grid_h+1
sw_tmp2           = sw_tmp+1
sw_tmp3           = sw_tmp2+1
sw_tmp4           = sw_tmp3+1
sw_tmp5           = sw_tmp4+1        ; sw_goto's own byte_lo scratch
sw_tmp6           = sw_tmp5+1        ; sw_goto's own byte_hi scratch

; ---- window origin, block (metatile) granular, INDEPENDENT of screen-record
; addressing. win_col_local (0-15) and win_row_local (0-14) ARE the physical
; local coordinate within whichever half win_col_screen/win_row_screen's own
; PARITY selects -- this is the whole R1 fix: nothing here is "window-
; relative offset from the left/top edge" any more.
win_col_screen    = sw_tmp6+1
win_col_local     = win_col_screen+1   ; 0-15
win_row_screen    = win_col_local+1
win_row_local     = win_row_screen+1   ; 0-14

; ---- streaming state + entering-edge buffer.
; st_vary is now GENUINELY the physical ring coordinate (0-29 for a column
; strip, 0-31 for a row strip) -- R1's own fix. It is INITIALISED at arm
; time from the window's own current varying-axis start (parity*half +
; local), and WRAPPED (not merely incremented) by sw_nmi_stream.
st_active   = win_row_local+1     ; 0 idle, 1 column strip, 2 row strip
st_cur      = st_active+1
st_len      = st_cur+1
st_ftile    = st_len+1            ; fixed tile coordinate (2*local of the
                                    ; entering edge's own screen/local pair)
st_fnt      = st_ftile+1          ; fixed nametable-hi contribution (parity
                                    ; of the entering edge's own screenCol/Row
                                    ; * 4 or 8) -- R1's fix: round 1 left this
                                    ; 0 for every row strip, always wrong
st_vary     = st_fnt+1
ss_i        = st_vary+1
sbuf        = ss_i+1              ; @size=32
sw_ss_sc    = sbuf+32             ; sw_stream_start_col/row's own saved
sw_ss_lc    = sw_ss_sc+1          ; entering-edge (screen,local) argument --
sw_ss_sr    = sw_ss_lc+1          ; column-strip and row-strip names share
sw_ss_lr    = sw_ss_sr+1          ; the same four bytes, never live together

; ---- strip-arming / render-window probe scratch (main-loop side; not
; touched by NMI).
sw_probe_col_screen = sw_ss_lr+1
sw_probe_col_local  = sw_probe_col_screen+1
sw_probe_row_screen = sw_probe_col_local+1
sw_probe_row_local  = sw_probe_row_screen+1
sw_last_screen_col  = sw_probe_row_local+1
sw_last_screen_row  = sw_last_screen_col+1
sw_rw_nt            = sw_last_screen_row+1
sw_rw_row           = sw_rw_nt+1
sw_rw_col           = sw_rw_row+1
sw_rw_base_col      = sw_rw_col+1
sw_rw_base_row      = sw_rw_base_col+1
sw_rw_offset        = sw_rw_base_row+1
sw_rw_arow          = sw_rw_offset+1
sw_rw_acol          = sw_rw_arow+1
sw_rw_tmp           = sw_rw_acol+1
sw_rw_tmp2          = sw_rw_tmp+1
; R1 fix (review 3, finding 1): the window's own ring origin, computed once
; per sw_render_window call. FALLEN STAR's own wbase_x/wbase_y
; (world_render.asm:167-168), expressed in this project's own (screen,local)
; terms: wbase_col = (win_col_screen&1)*16 + win_col_local, wbase_row =
; (win_row_screen&1)*15 + win_row_local. Without this, sw_col_at_offset/
; sw_row_at_offset were being fed a raw torus position instead of a
; window-relative DELTA, which only happened to agree with FALLEN STAR's own
; modx/mody at the aligned (local=0) origin -- review 3's own reproduction
; (local=1) is exactly the case that exposed it.
sw_rw_wbase_col     = sw_rw_tmp2+1
sw_rw_wbase_row     = sw_rw_wbase_col+1
; R3 fix (review 3, finding 3): the caller's own PRG bank number, set by a
; BANKED caller before jsr sw_read_transaction, so the transaction can
; restore THAT bank (not the field's current screen) before returning --
; sw_peek_byte's own "jsr sw_locate_current" ending is only correct for a
; caller that IS the field/mainline code; a caller resident in the RPG
; battle bank (or any other codeRegions bank) needs its OWN bank restored.
sw_caller_bank      = sw_rw_wbase_row+1
; Review 4, finding 2: the resident BOUNDED-RUN transaction's own scratch.
; Sized to the real remaining budget in this $05A0-$05FF gap (13 bytes free
; before this addition -- 10 used here, 3 left), not to an aspirational
; whole-row size; see sw_read_run's own header for why 8 bytes is the
; realistic worst case this design actually needs.
sw_run_off          = sw_caller_bank+1
sw_run_len          = sw_run_off+1
sw_run_buf          = sw_run_len+1     ; @size=8
; Review 5, finding 2: the one remaining byte of this chain's own budget
; (2 of the last 3 free bytes stay free) -- the current map's own fill
; metatile id, per-map authored state (default 0, Chris's decision 3).
sw_fill_metatile_id = sw_run_buf+8

; Review 5, finding 9: the $05A0-$05FF gap is exhausted otherwise (2 bytes
; now free, and finding 1/5/8 together need 9 more) -- rather than force
; everything into one gap, this round uses the codebase's own two OTHER
; confirmed-free RAM blocks (engine/constants.asm:670-676's own documented
; $03D8-$03E3, 12 bytes, and :759's own $035C-$035F, 4 bytes), real,
; existing, unclaimed RAM this prototype had not touched before. Real
; fixed addresses, not chained off another equate, since they are not
; part of this file's own scratch region at all.
sw_cam_origin_x_lo = $035C    ; finding 5's own persistent camera-origin
sw_cam_origin_x_hi = $035D    ; storage -- world-space position already
sw_cam_origin_y_lo = $035E    ; sitting at screen column/row 0, the second
sw_cam_origin_y_hi = $035F    ; argument sw_project_axis now takes directly
; Fix round 7 RAM map for this $03D8-$03E3 gap (12 bytes, engine/
; constants.asm:670-676), replacing review 5/6's own layout wholesale --
; decision A retires sw_move_gate (the one-in-three schedule counter is
; gone, superseded by the two per-axis accumulators below) and decision B
; replaces the old "save 4 bytes of window origin, redraw the whole torus"
; dialogue transaction with a camera NUDGE that never moves the window at
; all (below) -- so the dialogue side only ever needs to remember the
; pre-nudge CAMERA pixel position (2 bytes), not the window's own
; screen/local origin (4 bytes). Net: 4 bytes used of the 12 ($03D8-$03DB),
; not 5 -- one MORE byte freed than review 6's own accounting, not fewer.
;
; sw_move_gate ($03D8) -- RETIRED, freed, reused below as sw_walk_acc_x.
; sw_dlg_win_col_screen/local, sw_dlg_win_row_screen/local ($03D9-$03DC,
; 4 bytes) -- RETIRED, freed. The old snap-window/save-origin/full-torus-
; redraw transaction they served is superseded by decision B's camera-nudge
; transaction (below), which never moves the window/torus at all and so has
; no window origin to save. Kept here as a comment for history, not code:
; the byte layout they named ($03D9=col screen, $03DA=col local, $03DB=row
; screen, $03DC=row local) is no longer allocated to anything.
sw_walk_acc_x      = $03D8    ; decision A's own per-axis subpixel
sw_walk_acc_y      = $03D9    ; accumulators (sw_walk_step_x/y, above) --
                                ; two bytes, not one, since the two axes run
                                ; at different sustained rates (128/112)
sw_dlg_cam_x_lo    = $03DA    ; decision B's own pre-nudge camera snapshot
sw_dlg_cam_y_lo    = $03DB    ; (2 bytes -- cam_x_lo/cam_y_lo's own values
                                ; immediately before the open transaction's
                                ; alignment nudge, restored verbatim by the
                                ; close transaction; no window/local state
                                ; to save at all, since the window itself
                                ; never moves for a dialogue box any more)
; sw_dlg_metatile's own eight bytes (below): four persistent (the box's own
; origin, caller-set once per open/close, must survive the nested
; sw_terrain_or_fill/sw_peek_byte/sw_goto call chain, which clobbers
; sw_tmp*-sw_tmp6 as ITS OWN scratch -- exactly why these cannot live
; there) plus four transient (spent and reloaded within one call, but not
; sw_tmp*-safe for the same reason). Uses the entire remaining 8 bytes of
; this gap -- $03DC-$03E3, none left free after this round.
sw_dlg_ocol   = $03DC    ; box origin: screenCol
sw_dlg_olcol  = $03DD    ; box origin: localCol
sw_dlg_orow   = $03DE    ; box origin: screenRow
sw_dlg_olrow  = $03DF    ; box origin: localRow
sw_dlg_rbrow  = $03E0    ; sw_dlg_metatile's own scratch: boxRow (X on
                          ; entry, stashed since X is reused for the
                          ; resolved screenRow before boxRow is consumed)
sw_dlg_rscol  = $03E1    ; sw_dlg_metatile's own scratch: resolved screenCol
sw_dlg_rlcol  = $03E2    ; sw_dlg_metatile's own scratch: resolved localCol
sw_dlg_rlrow  = $03E3    ; sw_dlg_metatile's own scratch: resolved localRow

; ---- attr_shadow, 256 bytes. $0600 collides with flash_driver here (design
; doc §5/§11); FALLEN STAR's own attr_shadow is $0700.
attr_shadow = $0600             ; @size=256

; ==========================================================================
; sw_goto -- A=absolute screen column (0-254), X=absolute screen row
; (0-254). Selects the PRG bank holding that screen and points mtptr at its
; own terrain block, offset 0. Cold path only (strip-arming, render-window,
; map entry) -- the hot path (sw_locate_current, sw_cross_*) never calls
; this or multiplies anything.
; ==========================================================================
sw_goto:
  stx sw_tmp3                ; row
  ldx #0
sw_goto_coldiv:
  cmp #STREAM_SCREENS_PER_REGION
  bcc sw_goto_colrem
  sec
  sbc #STREAM_SCREENS_PER_REGION
  inx
  jmp sw_goto_coldiv
sw_goto_colrem:
  sta sw_tmp                 ; col_rem
  stx sw_tmp2                ; col_region
  ; col_byte = col_rem * STREAM_SCREEN_BYTES, bounded repeated-add (<=23
  ; iterations) -- cold path only, never the hot path's own concern.
  lda #0
  sta sw_tmp5
  sta sw_tmp6
  ldx sw_tmp
  beq sw_goto_bytedone
sw_goto_byteloop:
  lda sw_tmp5
  clc
  adc #LOW(STREAM_SCREEN_BYTES)
  sta sw_tmp5
  lda sw_tmp6
  adc #HIGH(STREAM_SCREEN_BYTES)
  sta sw_tmp6
  dex
  bne sw_goto_byteloop
sw_goto_bytedone:
  lda #0
  sta sw_tmp4                 ; row_bank_base accumulator
  ldx sw_tmp3
  beq sw_goto_rowdone
sw_goto_rowloop:
  lda sw_tmp4
  clc
  adc sw_regions_per_row
  sta sw_tmp4
  dex
  bne sw_goto_rowloop
sw_goto_rowdone:
  lda sw_tmp4
  clc
  adc sw_tmp2
  clc
  adc sw_base_bank            ; A = absolute region index
  lsr a                       ; carry = region's low bit (org half)
  pha
  lda sw_tmp6
  bcc sw_goto_8000
  clc
  adc #$A0
  jmp sw_goto_orgset
sw_goto_8000:
  clc
  adc #$80
sw_goto_orgset:
  sta <mtptr_hi
  lda sw_tmp5
  sta <mtptr_lo
  pla
  jsr switch_prg_bank
  rts

; sw_locate_current -- O(1) recompute of the CURRENT screen's bank+mtptr
; from the persistently-maintained sw_col_byte_lo/hi/sw_col_region/
; sw_row_bank_base. Every caller that peeked at another screen calls this
; again afterward to restore.
sw_locate_current:
  lda sw_row_bank_base
  clc
  adc sw_col_region
  clc
  adc sw_base_bank
  lsr a
  pha
  lda sw_col_byte_hi
  bcc sw_lc_8000
  clc
  adc #$A0
  jmp sw_lc_orgset
sw_lc_8000:
  clc
  adc #$80
sw_lc_orgset:
  sta <mtptr_hi
  lda sw_col_byte_lo
  sta <mtptr_lo
  pla
  jsr switch_prg_bank
  rts

; ==========================================================================
; sw_peek_byte -- fix round 3's own R5 resident read transaction: the whole
; switch/read/restore sequence as ONE kernel-lo routine, never split across
; a caller-side "switch here, restore there" pair. R5's own finding: a
; caller CANNOT reselect its own code bank after a jsr to a routine that
; just switched PRG banks out from under it -- the instruction immediately
; following the jsr is fetched from whatever bank sw_goto/switch_prg_bank
; just selected, not the caller's own. So this routine holds the whole
; transaction itself: switch to the requested neighbour screen, read
; exactly one byte, restore the CALLER's own current screen (via
; sw_locate_current, which already persists that state), THEN return. A
; caller never sees an intermediate state where the "wrong" screen is
; mapped in. This is the general-purpose primitive R8's straddling-probe
; work needs (peek one byte of a neighbouring screen's terrain, e.g. for a
; boundary collision probe, without disturbing mtptr's own meaning for the
; rest of the frame).
;
; In: A = target screenCol, X = target screenRow, Y = byte offset within
;     that screen's own terrain (0-239).
; Out: A = the byte. sw_tmp3 clobbered (scratch: the requested offset).
; Clobbers X, Y. Costs one sw_goto (the general, divide-based cold path --
; this is NOT the O(1) sw_cross_* hot path) plus one sw_locate_current.
; ==========================================================================
sw_peek_byte:
  ; Y (the offset) needs no stashing at all: sw_goto's own body never
  ; touches Y (confirmed by reading it -- only A/X and sw_tmp*), so it
  ; survives the jsr naturally. Two real bugs this round's own isolated
  ; test caught before landing here: (1) stashing the offset in sw_tmp3
  ; -- sw_goto uses sw_tmp/sw_tmp2/sw_tmp3/sw_tmp4/sw_tmp5/sw_tmp6 as its
  ; own scratch (sw_tmp3 as its row accumulator, from its very first
  ; instruction), clobbering it before sw_goto even returned; (2) a `tya`
  ; to stash Y on the stack, which clobbers A -- the very register holding
  ; the caller's own screenCol argument sw_goto needs. Y needs no register
  ; transfer and no stash; A and X must reach sw_goto exactly as the
  ; caller set them.
  jsr sw_goto
  lda [mtptr_lo],y
  pha
  jsr sw_locate_current
  pla
  rts

; ==========================================================================
; sw_terrain_or_fill -- review 5, finding 2's own required fix: routes
; EVERY terrain read through a fill-aware bounds check BEFORE any bank
; switch is attempted, closing the exact gap the reviewer's own
; reproduction demonstrated (sw_grid_w=sw_grid_h=1, requesting screen
; (1,1), returned fixture id 12 -- a real screen's own data, not fill 0 --
; because nothing before this round ever checked the resolved screen
; against the map's own authored grid at all).
;
; Works for EVERY caller shape this design has (the same-screen fast path,
; a cross-screen collision probe, a full-render probe, a strip starter)
; because the check is UNSIGNED: a resolved screenCol/Row of 255 (the
; 8-bit wraparound of a probe one column/row past the LEFT/TOP edge, e0g.
; screenCol=-1) is >= any real sw_grid_w/sw_grid_h, so it falls into the
; fill path exactly the same way a resolved coordinate past the RIGHT/
; BOTTOM edge does -- one check covers every direction, with no separate
; sign test needed.
;
; In: A=screenCol, X=screenRow, Y=offset within that screen (as
;     sw_peek_byte/sw_goto already expect).
; Out: A = the byte -- either the real terrain byte (sw_peek_byte's own
;     full switch/read/restore, unchanged) or sw_fill_metatile_id, with NO
;     bank switch attempted at all in the fill case (there is no real
;     screen there to switch to). Clobbers X, Y exactly as sw_peek_byte
;     does in the real-read case; clobbers nothing in the fill case.
; ==========================================================================
sw_terrain_or_fill:
  cmp sw_grid_w
  bcs sw_tof_fill              ; screenCol >= gridW (or wrapped negative) -> fill
  cpx sw_grid_h
  bcs sw_tof_fill              ; screenRow >= gridH (or wrapped negative) -> fill
  jmp sw_peek_byte             ; in bounds -- the real, restoring read
sw_tof_fill:
  lda sw_fill_metatile_id
  rts

; ==========================================================================
; sw_dlg_metatile -- fix round 7, decision B's own real accessor: given the
; box's own top-left metatile ORIGIN (torus-absolute, set once per box open/
; close by the caller into sw_dlg_ocol/olcol/orow/olrow -- however the
; caller derives that origin from the aligned camera, which is remaining
; open question 1's own unresolved camera/window integration, not new work
; here) and a metatile position WITHIN the box's own 16-wide/3-tall band
; (A=boxCol 0-15, X=boxRow 0-2 -- boxRow 0 is metatile row 12 of the local
; screen, the box's own known fixed offset, CLAUDE.md's own "box rows 24-29
; are exactly metatile rows 12-14"), resolves to a real (screenCol,
; screenRow,localCol,localRow) and reads through sw_terrain_or_fill --
; bank-safe (restores the field's own current screen) AND fill-aware
; (a box straddling the map's authored edge reads sw_fill_metatile_id, not
; garbage or a wrong neighbour's data). This is NOT a new addressing
; mechanism: it composes two already-proven pieces --
; sw_col_at_offset/sw_row_at_offset's own mod-16/mod-15 wrap shape (proven
; by sw_render_window's own tests), parameterized on a caller-supplied
; origin instead of the global window state those two read, feeding
; sw_terrain_or_fill (proven above, review 5/diag_r5_fill.mjs).
;
; In: A=boxCol (0-15), X=boxRow (0-2). sw_dlg_ocol/olcol/orow/olrow =
; the box's own origin, caller-set once before the row loop begins.
; Out: A = the metatile id (real terrain byte or fill). Clobbers X, Y,
; sw_dlg_rscol -- and, via sw_terrain_or_fill/sw_peek_byte/sw_goto, the
; shared sw_tmp/sw_tmp2/.../sw_tmp6 cold-path scratch -- which is exactly
; why the ORIGIN needs its own dedicated bytes rather than living in
; sw_tmp*: sw_goto (reached through this call, when in bounds) clobbers
; sw_tmp*-sw_tmp6 as ITS OWN scratch, so a persistent value stored there
; would not survive the very call that needs it.
;
; PROTOTYPE PLACEMENT NOTE: this routine is a real, mainline (never-NMI)
; candidate for kernel-lo, exactly like every other cold-path sw_* routine
; in this file -- but minimal-u512's own stripped test fixture has no
; spare kernel-lo room left to hold it alongside everything else this round
; added (decision A's own two accumulators, the retired-but-still-present
; sw_move_tick history comment costs nothing, real code does). It is
; assembled into the SAME never-shipped bank 14 test slot
; sw_run_bank_test already uses, below -- purely so this prototype has
; somewhere to put the bytes and a real PRG bank to call it from; the
; number this design owes the real kernel-lo budget is a NEW, not-yet-
; measured `*_KERNEL_ALLOWANCE` term (decision B's own byte cost, §9),
; the same discipline every other conditional feature in "The kernel
; budget" already follows -- not a claim that dialogue's own accessor
; ships from bank 14 in the real engine.
  .bank 14
  .org $8600
sw_dlg_metatile:
  stx sw_dlg_rbrow          ; boxRow, stashed (X is about to be reused)
  clc
  adc sw_dlg_olcol
  cmp #16
  bcc sw_dlgm_col_ok
  sbc #16
  sta sw_dlg_rlcol
  lda sw_dlg_ocol
  clc
  adc #1
  jmp sw_dlgm_col_done
sw_dlgm_col_ok:
  sta sw_dlg_rlcol
  lda sw_dlg_ocol
sw_dlgm_col_done:
  sta sw_dlg_rscol
  lda sw_dlg_rbrow
  clc
  adc #12
  clc
  adc sw_dlg_olrow
  cmp #15
  bcc sw_dlgm_row_ok
  sbc #15
  sta sw_dlg_rlrow
  lda sw_dlg_orow
  clc
  adc #1
  jmp sw_dlgm_row_done
sw_dlgm_row_ok:
  sta sw_dlg_rlrow
  lda sw_dlg_orow
sw_dlgm_row_done:
  tax                       ; X = resolved screenRow (sw_terrain_or_fill's own arg)
  lda sw_dlg_rlrow
  asl a
  asl a
  asl a
  asl a                     ; localRow * 16
  clc
  adc sw_dlg_rlcol
  tay                       ; Y = offset = localRow*16 + localCol
  lda sw_dlg_rscol          ; A = resolved screenCol
  jmp sw_terrain_or_fill
  .bank 62

; ==========================================================================
; sw_read_transaction -- review 3's own finding 3: the GENERAL resident
; switch/read/restore transaction, distinct from sw_peek_byte's own
; field-probe convenience. Where sw_peek_byte always restores the CURRENT
; FIELD screen (correct only when the caller IS mainline/field code),
; sw_read_transaction restores whatever PRG bank the caller itself asks
; for -- correct for a caller resident in ANY bank, including a banked
; consumer (the RPG battle bank, a future banked strip reader/
; sw_render_window placement) whose own code bank is NOT the field's
; current screen. This is the routine finding 3 actually asked for; keep
; sw_peek_byte too, for the callers that really do want "restore my own
; field screen" (the straddling-collision case, R8) -- do not delete it.
;
; In: A = target screenCol, X = target screenRow, Y = offset within screen,
;     sw_caller_bank = the PRG bank number to restore (the CALLER's own
;     bank -- set this BEFORE the jsr, e.g. `lda #RPG_BANK_ID` if the
;     caller's own bank is a compile-time constant, which it always is for
;     a banked region assigned by codeRegions).
; Out: A = the byte read. Clobbers X, Y.
; ==========================================================================
sw_read_transaction:
  jsr sw_goto
  lda [mtptr_lo],y
  pha
  lda sw_caller_bank
  jsr switch_prg_bank
  pla
  rts

; ==========================================================================
; sw_read_run -- review 4, finding 2: the resident BOUNDED-RUN transaction.
; sw_read_transaction (above) reads exactly one byte; several real
; consumers (a collision probe checking more than one metatile across a
; straddled edge, §4/finding 5) need more than one, and copying them to a
; buffer BEFORE the restoring switch_prg_bank runs is mandatory for the
; same reason sw_read_transaction restores before returning at all: the
; instruction immediately after switch_prg_bank executes from whatever
; bank it just selected, so a caller resident in a DIFFERENT bank cannot
; safely dereference the target screen's own mtptr a second time once the
; restore has happened -- the whole run must complete first.
;
; In: A = target screenCol, X = target screenRow, Y = starting offset
;     within that screen's record, sw_run_len = byte count (1-8),
;     sw_caller_bank = the PRG bank number to restore (as sw_read_transaction).
; Out: sw_run_buf[0..sw_run_len-1] holds the copy. Clobbers A, X, Y.
; Constraint, real and disclosed rather than guarded: Y+sw_run_len-1 must
; not exceed 255 (indirect-indexed addressing has no second index register
; to carry an overflow into mtptr_hi). Every caller in this design reads at
; most 8 bytes starting at a probe-computed offset within a 240-byte
; terrain block, so this never binds; a future caller requesting a run
; that WOULD cross 255 must split it into two calls.
; ==========================================================================
sw_read_run:
  jsr sw_goto
  sty sw_run_off
  ldx #0
sw_read_run_loop:
  cpx sw_run_len
  bcs sw_read_run_done
  txa
  clc
  adc sw_run_off
  tay
  lda [mtptr_lo],y
  sta sw_run_buf,x
  inx
  jmp sw_read_run_loop
sw_read_run_done:
  lda sw_caller_bank
  jsr switch_prg_bank
  rts

; ==========================================================================
; SUPERSEDED HISTORY (fix round 8, finding 9 -- labelled, not deleted, per
; the ground rule): the comment block immediately below describes the OLD,
; review-4-era sw_project_axis contract, which no longer exists as code --
; review 5's own rebuild (the SECOND "sw_project_axis --" header just past
; this one) replaced it entirely, fixing the double-centring bug and the
; negative-edge hardware error named there. Kept as a record of what
; changed and why, not as a description of current behaviour; the rebuilt
; routine's own body, below the second header, is what actually assembles.
; ==========================================================================
; sw_project_axis -- review 4, finding 6's own required concrete projection
; prototype. Signed 16-bit world position minus signed 16-bit camera
; position, plus the FALLEN STAR centring constant for this axis (120 for X
; -- 256/2-8 -- 112 for Y -- 240/2-8 -- passed in A on entry, review 4's own
; correction: 112 is derived from 240, the SCREEN height, not 224), then
; clipped to hardware OAM semantics rather than a software all-or-nothing
; guess: a sprite whose 8-pixel span falls anywhere in [-7,255] is left
; PARTIALLY visible by the PPU itself (X wraps naturally as an 8-bit OAM
; byte; the hardware draws whatever falls in 0-255 and clips the rest for
; free) -- only a position with NO overlap at all (delta < -7 or > 255) is
; hidden by this routine, and only Y=255 is a real hide value (X has no
; hardware "hide," which is why the X and Y prototypes differ: X truncates
; and lets hardware clip, Y must explicitly substitute 255 whenever the
; unclipped math would land at/after scanline 240, which is itself a
; legal Y value -- 240-254 are just past the visible frame, not a
; sentinel -- so this returns a SEPARATE hide flag in the carry, not a
; magic Y value, leaving the Y-specific 255-substitution to the caller,
; which alone knows it's projecting Y and not X).
;
; In: A = axis centring constant (120 or 112), sw_tmp/sw_tmp2 = world
;     position lo/hi (signed 16-bit), sw_tmp3/sw_tmp4 = camera position
;     lo/hi (signed 16-bit).
; Out: A = the 8-bit OAM coordinate (valid regardless of carry). Carry SET
;     means fully offscreen on this axis (caller substitutes Y=255 for a
;     Y-axis call, or skips OAM emission entirely for X); carry CLEAR
;     means at least one pixel of the 8x8 tile overlaps the visible frame.
; Clobbers X. Reuses sw_tmp/2/3/4 as its own scratch -- safe because this
; prototype never runs concurrently with sw_goto's cold path (both are
; mainline-only, never interrupt-time).
; ==========================================================================
; ==========================================================================
; sw_project_axis -- review 5, finding 5's own rebuild: fixes the double-
; centring bug (the OLD routine took a "centring constant" argument and
; added it on top of a caller-supplied `cam` that review 5 proved was
; ALREADY `player - centring` -- world - (player - centring) + centring =
; world - player + 2*centring, wrong by one full centring constant) and the
; negative-edge hardware error (the OLD routine treated delta -7..-1 as
; "visible," truncating to OAM X 249-255 -- which draws at the RIGHT edge
; of the screen, not as a partially-visible sprite peeking in from the
; LEFT; OAM X has no representation for negative screen position at all).
;
; THE CONTRACT, chosen once: the second argument (sw_tmp3/sw_tmp4) is the
; camera's own WORLD-SPACE ORIGIN -- the world position already sitting at
; screen column/row 0 -- never the player's own centre position. Deriving
; that origin from the player (origin = player - centring, ONE subtraction,
; the 120/112 constants review 5 confirmed are otherwise correct) is a
; SEPARATE, once-per-frame computation (§4/R9, below), not this routine's
; job -- so this routine itself needs no centring constant at all, and
; needs no sw_tmp5 scratch to hold one (the old routine's own undocumented
; scratch use, per review 5's own finding, is now simply gone).
;
; World and camera positions are UNSIGNED 16-bit (0-65,535) -- a legal
; 255-screen-wide world can reach world x=65,279, which a SIGNED 16-bit
; value cannot hold (max +32,767). This does not change the subtraction
; below at all: 6502 SBC is representation-agnostic two's-complement
; arithmetic, identical whether the operands are "meant" as signed or
; unsigned -- what matters is that any camera-to-tile distance this design
; ever asks about is small, so the RESULT's own high byte is reliably $00
; (a small positive/visible delta) or $FF (a small negative delta) whenever
; the tile is anywhere near the camera, and reliably something else
; whenever it is far away in either direction, regardless of how the
; underlying 65,536-wide modulus wrapped to get there.
;
; Visibility, simplified from the old two-threshold rule to one: a tile is
; visible iff 0 <= delta < visibleWidth (256 for X, 240 for Y -- passed by
; the caller, this routine does not hardcode either). ANY negative delta
; hides -- there is no partial-left-edge case, per the hardware finding
; above; the positive edge needs no special case at all, since OAM X/Y
; truncation already draws a partial sprite for free the instant
; visibleWidth's own upper bound is respected (delta 248-255 for X, the
; caller's own concern for Y -- see the one-scanline note below).
;
; In: A = visibleWidth (256 truncates to 0 in an 8-bit compare, so the
;     caller passes 0 for X's own 256-wide case and the real 240 for Y --
;     documented at each call site, not a magic default here),
;     sw_tmp/sw_tmp2 = world position lo/hi, sw_tmp3/sw_tmp4 = camera
;     ORIGIN lo/hi (already centred, per the contract above).
; Out: A = the 8-bit OAM byte (valid regardless of carry -- a hidden tile's
;     own truncated byte is still returned, for a caller that wants it for
;     other math). Carry SET means fully hidden; CLEAR means visible.
;     Y-axis callers apply the one-scanline-early OAM convention
;     themselves (subtract 1, below) -- this routine answers "is this
;     logical row visible," not "what raw byte does $2004 need."
; Clobbers nothing but A. Reuses sw_tmp/sw_tmp2/sw_tmp3/sw_tmp4/sw_tmp6
; (sw_goto's own byte_hi scratch -- safe under the same never-concurrent
; argument sw_clamp_col/row already rely on) to stash visibleWidth; no
; sw_tmp5.
; ==========================================================================
sw_project_axis:
  sta sw_tmp6                 ; stash visibleWidth (0 means "256" for X)
  lda sw_tmp
  sec
  sbc sw_tmp3                 ; delta_lo = world_lo - cam_lo
  sta sw_tmp
  lda sw_tmp2
  sbc sw_tmp4                 ; delta_hi = world_hi - cam_hi
  sta sw_tmp2
  bne sw_project_hide         ; delta_hi != 0 (neither a small positive nor
                                ; a small negative delta) -> nowhere close
  lda sw_tmp6
  beq sw_project_visible      ; visibleWidth==0 means 256 -- every delta_hi==0
                                ; value (0-255) is visible, no further test
  lda sw_tmp
  cmp sw_tmp6                 ; delta_lo < visibleWidth (Y's real 240)?
  bcc sw_project_visible
sw_project_hide:
  lda sw_tmp
  sec
  rts
sw_project_visible:
  lda sw_tmp
  clc
  rts

; ==========================================================================
; sw_move_tick -- SUPERSEDED HISTORY (fix round 7, decision A). Review 5's
; own one-in-three gate was a real, tested, evenly-spaced schedule (10
; move-frames in 30, no drift, max burst 1px/3-frame window -- all true, and
; the code below did exactly what it claimed). What review 6's finding 1
; established is that 0.333 px/frame (20 px/s) was never what Chris asked
; for once he saw it named plainly, and fix round 7's own decision A
; ("match FALLEN STAR... this engine reuse that streaming code and match
; that performance") replaces the whole mechanism: FALLEN STAR's own
; exclusive-vblank NMI arbitration (above, boot.asm's own splice) plus a
; per-axis subpixel accumulator (sw_walk_step_x/y, below) at 1.5 / 1.4375
; px/frame, not a fixed-fraction gate at all. sw_move_gate ($03D8) is
; RETIRED and freed (§9's own RAM map, below) -- reused as sw_walk_acc_x.
; This routine's own body is kept, unmodified, as a record of what it
; proved (the schedule genuinely had no drift), not as a claim that
; 0.333 px/frame was ever the right number:
;
; sw_move_tick:
;   lda sw_move_gate
;   clc
;   adc #1
;   cmp #3
;   bcc sw_move_tick_store
;   lda #0
; sw_move_tick_store:
;   sta sw_move_gate
;   cmp #0
;   beq sw_move_tick_go
;   clc
;   rts
; sw_move_tick_go:
;   sec
;   rts
;
; ==========================================================================
; sw_walk_step_x / sw_walk_step_y -- decision A's own replacement: FALLEN
; STAR's exact mechanism (world_stream.asm's own up_step_done -- WHOLE_STEP
; plus a subpixel accumulator that carries one extra pixel on overflow),
; duplicated per axis because the two axes need DIFFERENT sustained rates on
; this engine (FALLEN STAR needed only one -- its own row and column strips
; both cost 10/11 vblanks against an IDENTICAL 1.5 px/frame on both axes
; only by chance of using a square-ish window; this design's own strip
; costs are asymmetric -- a column strip is 30 blocks/10 vblanks, a row
; strip is 32 blocks/11 vblanks -- so a single shared accumulator would
; either overshoot the row strip's own tighter deadline or undershoot the
; column strip's own real margin).
;
; SW_SPEED_SUB_X = 128 (WHOLE_STEP 1 + overflow every other frame = exactly
; 1.5 px/frame, FALLEN STAR's own number, horizontal). Proof this closes,
; real numbers (fix round 7, decision A, proof 2): a column strip is 30
; blocks at SW_STREAM_CHUNK=3 = 10 vblanks; the WORST-CASE single 16px
; crossing at 1.5 px/frame (accumulator phase 0, the ONLY phase that reaches
; it) takes 11 frames, not the 10.667 mean -- still 1 frame of real margin
; over the 10 vblanks the strip needs, and a 5,000,000-frame simulated walk
; (diag_r7_sustained_rate.mjs) never lets the window lag exceed 1 block,
; the same bound FALLEN STAR's own reference gets away with by construction.
;
; SW_SPEED_SUB_Y = 112 (1.4375 px/frame -- "a few percent under 1.5," Chris's
; own accepted framing), NOT 128: at 128 the worst-case single vertical
; crossing is exactly 11 frames, TYING the row strip's own 11-vblank
; requirement with zero margin, and the MEAN crossing time (10.667 frames)
; is strictly LESS than the 11 vblanks the strip needs -- an unbounded
; deficit that reaches the 8-block resync guard after only 2,144 frames
; (~193 blocks, ~36 seconds) of ordinary continuous vertical walking,
; confirmed by simulation, not hypothetical. At 112, mean crossing time is
; 16/1.4375 = 11.130 frames (> 11 needed, real positive margin) and the
; WORST-CASE single crossing is 12 frames (still > 11) -- the identical
; "window lag never exceeds 1 block" bound horizontal gets, proven the same
; way (diag_r7_sustained_rate.mjs, both axes, 5,000,000 simulated frames
; each). This is the FALLEN STAR performance Chris asked for, on the axis
; that actually needs to be a little slower to keep the row strip's own
; larger (32-block/11-vblank, not 30/10) cost from ever falling behind.
;
; In: nothing. Out: A = this frame's whole-pixel step (1 or 2) for the
; named axis, applied at the movement site in place of the streamed-map
; branch `dispatch_done` (engine/input.asm:99-105) needs -- `cur_speed` is
; set to THIS return value for exactly this frame's probe/apply, not read
; from PLAYER_SPEED/dash_on at all while a streamed map is current; dash
; stays forced off (Chris's original decision, unchanged) since there is no
; longer a fixed `cur_speed` for ACT_DASH to inflate. Clobbers nothing but A.
; Each axis's own accumulator persists only while that axis is the one
; actually moving (4-way arbitration below never calls both in the same
; frame), so switching axes never loses or duplicates fractional progress
; on the axis not currently held -- exactly FALLEN STAR's own single
; accumulator's behaviour, generalised to two axes that don't share a rate.
; ==========================================================================
sw_walk_step_x:
  lda sw_walk_acc_x
  clc
  adc #SW_SPEED_SUB_X
  sta sw_walk_acc_x
  lda #1
  bcc sw_walk_step_x_done
  lda #2
sw_walk_step_x_done:
  rts

sw_walk_step_y:
  lda sw_walk_acc_y
  clc
  adc #SW_SPEED_SUB_Y
  sta sw_walk_acc_y
  lda #1
  bcc sw_walk_step_y_done
  lda #2
sw_walk_step_y_done:
  rts

; ==========================================================================
; sw_axis_arbitrate -- decision A's own 4-way rule, specified: FALLEN STAR's
; own up_chkh (player.asm:26-52), not "diagonal forbidden" (fix round 5's
; wording) -- Chris's underlying decision (no diagonal movement on a
; streamed map) is UNCHANGED, only the mechanism is: rather than refusing a
; diagonal hold outright, whichever axis was PRESSED MOST RECENTLY (a
; newly-pressed direction this frame) wins and masks the other axis out of
; the held pad state for as long as both remain held; releasing the winning
; axis hands ownership back to whichever axis (if any) is still held. This
; is strictly FALLEN STAR's own rule (a real reference implementation this
; document already reasoned FALLEN STAR's own code sample by sample), not a
; new invention:
;   - A frame where a NEW direction is pressed (pad_new has a bit set for
;     one axis) makes that axis's own sw_axis_pref the owner immediately,
;     regardless of what the other axis is doing.
;   - A frame with no new press keeps the CURRENT owner (sw_axis_pref
;     unchanged), masking the pad byte to strip the non-owning axis's own
;     bits before dispatch_input/movement ever sees them -- so a diagonal
;     HOLD (both axes already down, neither newly pressed this frame) keeps
;     resolving to whichever axis won the moment the second one was added.
;   - A frame where the owning axis is released and the other axis is still
;     held hands ownership to whatever remains (FALLEN STAR's own
;     up_vnone/up_hnone arms).
; sw_walk_step_x/y are axis-agnostic (each only knows its own accumulator,
; never which axis currently owns input) -- this routine decides WHICH one
; gets called a given frame, which is why the two never run in the same
; frame and never need to coordinate. Specified, not built this round (§9's
; own disposition) -- the pad/pad_new mechanics it composes with live in
; engine/input.asm, outside this prototype's own scope.
;
; ==========================================================================
; sw_clamp_col/sw_clamp_row -- review 3, finding 2: clamp a DESIRED window
; origin so the whole 32x30 resident window stays inside a map at least as
; big as the window (FALLEN STAR's own center_window, world_stream.asm:
; 62-91, clamps the WHOLE window, not just the camera/viewport -- the bug
; this fixes is that nothing clamped the window at all, so a window near a
; map's own far edge would read screens that do not exist).
;
; EXACT, not approximate, despite clamping at screen+local granularity
; rather than doing 16-bit flat arithmetic: the window's own far edge is
; origin+32 blocks (columns) or +30 (rows), and a screen is exactly 16 (or
; 15) blocks wide -- so the ONLY way a desired origin can overflow the grid
; is (a) screenCol already > grid_w-2, in which case ANY local offset also
; overflows, or (b) screenCol == grid_w-2 with a NONZERO local offset (the
; window's own far edge would land exactly grid_w*16+local blocks in, past
; the grid's own grid_w*16-block extent by exactly `local`). Both cases
; clamp to the identical result: (grid_w-2, 0), the exact rightmost/
; bottommost valid placement -- proved by a 16-bit derivation (design doc
; §4/finding 2) and confirmed by direct nesasm testing at every one of the
; four edges/corners, not merely reasoned from this comment.
;
; Precondition, checked by the CALLER (not this routine): sw_grid_w >= 2
; (cols) / sw_grid_h >= 2 (rows) -- a map narrower/shorter than the window
; itself is a DIFFERENT policy (wrap the affected axis onto itself, since
; there is no second screen to show) that this routine does not implement;
; see the design doc's own §4/finding-2 write-up for why that case is
; reasoned, not built, this round.
;
; In: A=screenCol/screenRow, X=localCol/localRow (desired).
; Out: A=screenCol/screenRow, X=localCol/localRow (clamped).
; Clobbers sw_tmp/sw_tmp2 (cold-path-only scratch, safe: this runs only at
; window-repositioning time, the same call class as sw_goto's own cold
; path, never from NMI).
; ==========================================================================
sw_clamp_col:
  sta sw_tmp2               ; desired screenCol
  stx sw_tmp                ; desired localCol
  lda sw_grid_w
  sec
  sbc #2
  cmp sw_tmp2
  bcc sw_clamp_col_clamp    ; max < screenCol -> overflow, clamp
  bne sw_clamp_col_fine     ; max > screenCol -> always fine, no clamp
  lda sw_tmp                ; max == screenCol: only local==0 is fine
  beq sw_clamp_col_fine
sw_clamp_col_clamp:
  lda sw_grid_w
  sec
  sbc #2
  ldx #0
  rts
sw_clamp_col_fine:
  lda sw_tmp2
  ldx sw_tmp
  rts

; sw_clamp_row: identical shape, screen height 15 (not 16) and ring height
; 30 (not 32) -- the clamp rule (max_screen = grid_h-2, force local=0 at
; the max) is unchanged, since it never depended on the screen/ring size
; values themselves, only on "a screen is one unit of the grid axis."
sw_clamp_row:
  sta sw_tmp2
  stx sw_tmp
  lda sw_grid_h
  sec
  sbc #2
  cmp sw_tmp2
  bcc sw_clamp_row_clamp
  bne sw_clamp_row_fine
  lda sw_tmp
  beq sw_clamp_row_fine
sw_clamp_row_clamp:
  lda sw_grid_h
  sec
  sbc #2
  ldx #0
  rts
sw_clamp_row_fine:
  lda sw_tmp2
  ldx sw_tmp
  rts

; sw_cross_right/left/up/down -- O(1) incremental updates. R6's own fix:
; sw_col_byte_lo/hi track col_rem*STREAM_SCREEN_BYTES incrementally (+/-338
; per step, or reset/recomputed only at a region-boundary wrap), never a
; runtime multiply on this path.
sw_cross_right:
  inc sw_col
  inc sw_col_rem
  lda sw_col_rem
  cmp #STREAM_SCREENS_PER_REGION
  bne sw_cr_addbyte
  lda #0
  sta sw_col_rem
  inc sw_col_region
  sta sw_col_byte_lo
  sta sw_col_byte_hi
  rts
sw_cr_addbyte:
  lda sw_col_byte_lo
  clc
  adc #LOW(STREAM_SCREEN_BYTES)
  sta sw_col_byte_lo
  lda sw_col_byte_hi
  adc #HIGH(STREAM_SCREEN_BYTES)
  sta sw_col_byte_hi
  rts

sw_cross_left:
  lda sw_col_rem
  bne sw_cl_subbyte
  lda #STREAM_SCREENS_PER_REGION-1
  sta sw_col_rem
  dec sw_col_region
  ; recompute byte via a bounded repeated-add (rare: only at a region-
  ; boundary crossing, at most once every 24 screens of walking)
  lda #0
  sta sw_col_byte_lo
  sta sw_col_byte_hi
  ldx #STREAM_SCREENS_PER_REGION-1
sw_cl_wraploop:
  lda sw_col_byte_lo
  clc
  adc #LOW(STREAM_SCREEN_BYTES)
  sta sw_col_byte_lo
  lda sw_col_byte_hi
  adc #HIGH(STREAM_SCREEN_BYTES)
  sta sw_col_byte_hi
  dex
  bne sw_cl_wraploop
  jmp sw_cl_done
sw_cl_subbyte:
  dec sw_col_rem
  lda sw_col_byte_lo
  sec
  sbc #LOW(STREAM_SCREEN_BYTES)
  sta sw_col_byte_lo
  lda sw_col_byte_hi
  sbc #HIGH(STREAM_SCREEN_BYTES)
  sta sw_col_byte_hi
sw_cl_done:
  dec sw_col
  rts

sw_cross_down:
  inc sw_row
  lda sw_row_bank_base
  clc
  adc sw_regions_per_row
  sta sw_row_bank_base
  rts

sw_cross_up:
  dec sw_row
  lda sw_row_bank_base
  sec
  sbc sw_regions_per_row
  sta sw_row_bank_base
  rts

; --------------------------------------------------------------------------
; sw_stream_start_col -- A=screenCol, X=localCol of the ENTERING edge
; (an absolute screen/local pair, never a window-relative offset -- R1's own
; fix). Reads 30 world metatiles (the window's own current row range,
; starting at win_row_screen/win_row_local) into sbuf, and sets st_ftile/
; st_fnt/st_vary from this project's own parity rule, not window-relative
; bit masking. Restores the CURRENT (player) screen's own bank before
; returning. Clobbers A, X, Y.
; --------------------------------------------------------------------------
sw_stream_start_col:
  stx sw_ss_lc
  sta sw_ss_sc
  txa
  asl a
  sta st_ftile                ; tile column = 2*localCol
  lda sw_ss_sc
  and #1
  asl a
  asl a
  sta st_fnt                  ; nt-hi contribution = (screenCol&1)*4
  ; st_vary starting value = (win_row_screen&1)*15 + win_row_local -- the
  ; window's own CURRENT physical row start, R1's own fix (round 1/2 left
  ; this uninitialised).
  lda win_row_local
  sta st_vary
  lda win_row_screen
  and #1
  beq sw_ssc_novoffset
  lda st_vary
  clc
  adc #15
  sta st_vary
sw_ssc_novoffset:
  lda win_row_screen
  sta sw_probe_row_screen
  lda win_row_local
  sta sw_probe_row_local
  lda #0
  sta ss_i
  lda #$FF
  sta sw_last_screen_row
  sta sw_last_screen_col
sw_ssc_loop:
  lda sw_ss_sc
  cmp sw_last_screen_col
  bne sw_ssc_relocate
  lda sw_probe_row_screen
  cmp sw_last_screen_row
  beq sw_ssc_read
sw_ssc_relocate:
  lda sw_ss_sc
  sta sw_last_screen_col
  lda sw_probe_row_screen
  sta sw_last_screen_row
  lda sw_ss_sc
  ldx sw_probe_row_screen
  jsr sw_goto
sw_ssc_read:
  lda sw_probe_row_local
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_ss_lc
  tay
  lda [mtptr_lo],y
  ldy ss_i
  sta sbuf,y
  inc ss_i
  inc sw_probe_row_local
  lda sw_probe_row_local
  cmp #15
  bne sw_ssc_noadv
  lda #0
  sta sw_probe_row_local
  inc sw_probe_row_screen
sw_ssc_noadv:
  lda ss_i
  cmp #30
  bne sw_ssc_loop
  jsr sw_locate_current        ; restore the CURRENT (player) screen
  lda #30
  sta st_len
  lda #0
  sta st_cur
  lda #1
  sta st_active
  rts

; sw_stream_start_row -- A=screenRow, X=localRow of the entering edge.
; Mirrors sw_stream_start_col's own shape exactly, R1's own fix applied to
; both st_ftile/st_fnt (round 1/2's row starter never set st_fnt at all) and
; st_vary (never initialised, never wrapped).
sw_stream_start_row:
  stx sw_ss_lr
  sta sw_ss_sr
  txa
  asl a
  sta st_ftile                ; tile row = 2*localRow
  lda sw_ss_sr
  and #1
  asl a
  asl a
  asl a
  sta st_fnt                  ; nt-hi contribution = (screenRow&1)*8
  lda win_col_local
  sta st_vary
  lda win_col_screen
  and #1
  beq sw_ssr_novoffset
  lda st_vary
  clc
  adc #16
  sta st_vary
sw_ssr_novoffset:
  lda win_col_screen
  sta sw_probe_col_screen
  lda win_col_local
  sta sw_probe_col_local
  lda #0
  sta ss_i
  lda #$FF
  sta sw_last_screen_row
  sta sw_last_screen_col
sw_ssr_loop:
  lda sw_probe_col_screen
  cmp sw_last_screen_col
  bne sw_ssr_relocate
  lda sw_ss_sr
  cmp sw_last_screen_row
  beq sw_ssr_read
sw_ssr_relocate:
  lda sw_probe_col_screen
  sta sw_last_screen_col
  lda sw_ss_sr
  sta sw_last_screen_row
  lda sw_probe_col_screen
  ldx sw_ss_sr
  jsr sw_goto
sw_ssr_read:
  lda sw_ss_lr
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_probe_col_local
  tay
  lda [mtptr_lo],y
  ldy ss_i
  sta sbuf,y
  inc ss_i
  inc sw_probe_col_local
  lda sw_probe_col_local
  cmp #16
  bne sw_ssr_noadv
  lda #0
  sta sw_probe_col_local
  inc sw_probe_col_screen
sw_ssr_noadv:
  lda ss_i
  cmp #32
  bne sw_ssr_loop
  jsr sw_locate_current
  lda #32
  sta st_len
  lda #0
  sta st_cur
  lda #2
  sta st_active
  rts

; ==========================================================================
; sw_nmi_stream -- draw SW_STREAM_CHUNK metatiles per vblank from sbuf. R11's
; own fix: uses sw_ns_chunk (a DEDICATED, NMI-exclusive zero-page byte),
; never sw_tmp4 -- round 1/2's own sw_tmp4 was ALSO sw_goto's row-
; accumulator scratch, a real reentrancy bug (an NMI landing mid-sw_goto,
; which runs from main-loop code, would corrupt sw_goto's own in-flight
; computation the instant sw_nmi_stream also touched sw_tmp4). R1's own fix:
; st_vary is WRAPPED (mod 30 for a column strip, mod 32 for a row strip),
; not merely incremented forever.
; ==========================================================================
sw_nmi_stream:
  lda st_active
  bne sw_ns_go
  rts
sw_ns_go:
  lda #SW_STREAM_CHUNK
  sta <sw_ns_chunk
sw_ns_loop:
  lda st_cur
  cmp st_len
  bcs sw_ns_finish
  jsr sw_ns_draw_block
  inc st_cur
  lda st_cur
  cmp st_len
  bcs sw_ns_finish
  inc st_vary
  lda st_active
  cmp #1
  bne sw_ns_wrap32
  lda st_vary
  cmp #30
  bne sw_ns_wrapdone
  lda #0
  sta st_vary
  jmp sw_ns_wrapdone
sw_ns_wrap32:
  lda st_vary
  cmp #32
  bne sw_ns_wrapdone
  lda #0
  sta st_vary
sw_ns_wrapdone:
  dec <sw_ns_chunk
  bne sw_ns_loop
  rts
sw_ns_finish:
  lda #0
  sta st_active
  rts

; --------------------------------------------------------------------------
; sw_ns_draw_block -- draws metatile sbuf[st_cur] at its own TORUS position.
; UNCHANGED from round 2's own shape: this split logic (physical row 15 /
; column 16 boundary) was always correct once st_vary genuinely holds the
; physical ring coordinate -- R1's own bug was entirely in how st_vary got
; its starting value and how it wrapped, both fixed above, not in this
; routine's own split. X = metatile id.
; --------------------------------------------------------------------------
sw_ns_draw_block:
  ldy st_cur
  ldx sbuf,y
  lda st_active
  cmp #1
  bne sw_ndb_row
  lda st_ftile
  sta <sw_ns_col
  lda st_vary
  cmp #15
  bcc sw_ndb_col_top
  sec
  sbc #15
  asl a
  sta <sw_ns_row
  lda st_fnt
  clc
  adc #$08
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_col_top:
  asl a
  sta <sw_ns_row
  lda st_fnt
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_row:
  lda st_ftile
  sta <sw_ns_row
  lda st_vary
  cmp #16
  bcc sw_ndb_row_left
  sec
  sbc #16
  asl a
  sta <sw_ns_col
  lda st_fnt
  clc
  adc #$04
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_row_left:
  asl a
  sta <sw_ns_col
  lda st_fnt
  sta <sw_ns_nt
sw_ndb_addr:
  lda <sw_ns_row
  lsr a
  lsr a
  lsr a
  clc
  adc #$20
  clc
  adc <sw_ns_nt
  sta <sw_ns_row_hi
  lda <sw_ns_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  ora <sw_ns_col
  sta <sw_ns_row_lo
  bit $2002
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  lda mt_tl,x
  sta $2007
  lda mt_tr,x
  sta $2007
  lda <sw_ns_row_lo
  clc
  adc #32
  sta <sw_ns_row_lo
  bcc sw_ns_nohi
  inc sw_ns_row_hi
sw_ns_nohi:
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  lda mt_bl,x
  sta $2007
  lda mt_br,x
  sta $2007
  ; fall through to the attribute RMW (X still = metatile id)

sw_ns_draw_attr:
  lda <sw_ns_col
  lsr a
  and #1
  sta <sw_ns_q
  lda <sw_ns_row
  lsr a
  and #1
  asl a
  ora <sw_ns_q
  sta <sw_ns_q
  lda mt_pal,x
  ldy <sw_ns_q
  beq sw_nda_pdone
sw_nda_pshift:
  asl a
  asl a
  dey
  bne sw_nda_pshift
sw_nda_pdone:
  sta <sw_ns_pb
  lda #3
  ldy <sw_ns_q
  beq sw_nda_cdone
sw_nda_cshift:
  asl a
  asl a
  dey
  bne sw_nda_cshift
sw_nda_cdone:
  eor #$FF
  sta <sw_ns_cm
  lda <sw_ns_row
  lsr a
  lsr a
  asl a
  asl a
  asl a
  sta <sw_ns_ai
  lda <sw_ns_col
  lsr a
  lsr a
  ora <sw_ns_ai
  sta <sw_ns_ai
  lda <sw_ns_nt
  asl a
  asl a
  asl a
  asl a
  ora <sw_ns_ai
  sta <sw_ns_row_lo
  lda #HIGH(attr_shadow)
  sta <sw_ns_row_hi
  ldy #0
  lda [sw_ns_row_lo],y
  and <sw_ns_cm
  ora <sw_ns_pb
  sta [sw_ns_row_lo],y
  pha
  lda <sw_ns_nt
  clc
  adc #$23
  sta <sw_ns_row_hi
  lda <sw_ns_ai
  ora #$C0
  sta <sw_ns_row_lo
  bit $2002
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  pla
  sta $2007
  rts

; ==========================================================================
; sw_render_window -- full four-nametable forced-blank redraw from the
; current window origin. R2's own fix: sw_rw_attr_y1 gains the missing
; `adc sw_rw_base_row` (round 1/2's own bug -- y0 had it, y1 did not, so
; every bottom-quadrant read used the WRONG world row); sw_rw_attr_bl/br
; SKIP entirely (return 0, contribute nothing) for the 8th attribute cell
; row (arow==7), since a single 15-block-tall physical nametable has no
; valid content for that quadrant at all (its own row 15 belongs to a
; DIFFERENT physical nametable) -- matching this project's own
; screenAttributes' skip convention, not FALLEN STAR's clamp.
; ==========================================================================
sw_render_window:
  ; R1 fix (review 3, finding 1): compute the window's own ring origin once,
  ; before any nametable is drawn -- FALLEN STAR's own wbase_x/wbase_y
  ; (world_render.asm:167-168), expressed in (screen,local) terms.
  lda win_col_screen
  and #1
  beq sw_rw_wbc_even
  lda #16
  jmp sw_rw_wbc_add
sw_rw_wbc_even:
  lda #0
sw_rw_wbc_add:
  clc
  adc win_col_local
  sta sw_rw_wbase_col
  lda win_row_screen
  and #1
  beq sw_rw_wbr_even
  lda #15
  jmp sw_rw_wbr_add
sw_rw_wbr_even:
  lda #0
sw_rw_wbr_add:
  clc
  adc win_row_local
  sta sw_rw_wbase_row
  lda #0
  sta sw_rw_nt
sw_rw_nt_loop:
  ldx sw_rw_nt
  lda sw_rw_nt_hi,x
  bit $2002
  sta $2006
  lda #0
  sta $2006
  lda sw_rw_ntx,x
  sta sw_rw_base_col
  lda sw_rw_nty,x
  sta sw_rw_base_row
  lda #$FF
  sta sw_last_screen_row
  sta sw_last_screen_col
  lda #0
  sta sw_rw_row
sw_rw_brow:
  lda #0
  sta sw_rw_col
sw_rw_top:
  jsr sw_rw_probe
  ldy sw_rw_offset
  lda [mtptr_lo],y
  tax
  lda mt_tl,x
  sta $2007
  lda mt_tr,x
  sta $2007
  inc sw_rw_col
  lda sw_rw_col
  cmp #16
  bne sw_rw_top
  lda #0
  sta sw_rw_col
sw_rw_bot:
  jsr sw_rw_probe
  ldy sw_rw_offset
  lda [mtptr_lo],y
  tax
  lda mt_bl,x
  sta $2007
  lda mt_br,x
  sta $2007
  inc sw_rw_col
  lda sw_rw_col
  cmp #16
  bne sw_rw_bot
  inc sw_rw_row
  lda sw_rw_row
  cmp #15
  bne sw_rw_brow
  lda sw_rw_nt
  asl a
  asl a
  asl a
  asl a
  asl a
  asl a
  sta <sw_rw_shadow_lo
  lda #HIGH(attr_shadow)
  sta <sw_rw_shadow_hi
  lda #0
  sta sw_rw_arow
sw_rw_arow_loop:
  lda #0
  sta sw_rw_acol
sw_rw_acol_loop:
  jsr sw_rw_attr_tl
  sta sw_rw_tmp
  jsr sw_rw_attr_tr
  asl a
  asl a
  ora sw_rw_tmp
  sta sw_rw_tmp
  jsr sw_rw_attr_bl
  asl a
  asl a
  asl a
  asl a
  ora sw_rw_tmp
  sta sw_rw_tmp
  jsr sw_rw_attr_br
  asl a
  asl a
  asl a
  asl a
  asl a
  asl a
  ora sw_rw_tmp
  sta $2007
  ldy #0
  sta [sw_rw_shadow_lo],y
  inc sw_rw_shadow_lo
  bne sw_rw_shadow_nohi
  inc sw_rw_shadow_hi
sw_rw_shadow_nohi:
  inc sw_rw_acol
  lda sw_rw_acol
  cmp #8
  bne sw_rw_acol_loop
  inc sw_rw_arow
  lda sw_rw_arow
  cmp #8
  bne sw_rw_arow_loop
  inc sw_rw_nt
  lda sw_rw_nt
  cmp #4
  beq sw_rw_done
  jmp sw_rw_nt_loop
sw_rw_done:
  jsr sw_locate_current
  rts

sw_rw_probe:
  lda sw_rw_base_col
  clc
  adc sw_rw_col
  jsr sw_rw_col_delta
  jsr sw_col_at_offset
  sta sw_probe_col_screen
  stx sw_probe_col_local
  lda sw_rw_base_row
  clc
  adc sw_rw_row
  jsr sw_rw_row_delta
  jsr sw_row_at_offset
  sta sw_probe_row_screen
  stx sw_probe_row_local
  lda sw_probe_row_local
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_probe_col_local
  sta sw_rw_offset
  lda sw_probe_col_screen
  cmp sw_last_screen_col
  bne sw_rwp_relocate
  lda sw_probe_row_screen
  cmp sw_last_screen_row
  beq sw_rwp_done
sw_rwp_relocate:
  lda sw_probe_col_screen
  sta sw_last_screen_col
  lda sw_probe_row_screen
  sta sw_last_screen_row
  lda sw_probe_col_screen
  ldx sw_probe_row_screen
  jsr sw_goto
sw_rwp_done:
  rts

; sw_rw_col_delta/sw_rw_row_delta -- R1 fix (review 3, finding 1): A = a
; TORUS/physical position (0-31 col, 0-29 row) -> A = the window-relative
; DELTA (0-31 / 0-29) sw_col_at_offset/sw_row_at_offset actually expect.
; This is FALLEN STAR's own modx/mody (world_render.asm:166-182), split into
; its own "subtract wbase and wrap" half -- the other half (decompose
; window-origin + delta into screen/local) is exactly what
; sw_col_at_offset/sw_row_at_offset already did correctly; the bug was
; calling them with the raw torus position instead of this delta.
sw_rw_col_delta:
  sec
  sbc sw_rw_wbase_col
  and #31
  rts

sw_rw_row_delta:
  clc
  adc #30
  sec
  sbc sw_rw_wbase_row
  cmp #30
  bcc sw_rw_row_delta_ok
  sec
  sbc #30
sw_rw_row_delta_ok:
  rts

; sw_col_at_offset/sw_row_at_offset -- window-relative-DELTA-to-world
; mapping (the delta already wbase-relative, via sw_rw_col_delta/
; sw_rw_row_delta above), used ONLY by sw_render_window/sw_rw_probe (a full,
; fresh-every-time redraw, where window-relative addressing is safe --
; nothing is "retained" across calls the way the incremental strip path
; must retain physical positions, R1's own distinction).
sw_col_at_offset:
  clc
  adc win_col_local
  pha
  and #15
  tax
  pla
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc win_col_screen
  rts

sw_row_at_offset:
  clc
  adc win_row_local
  ldx #0
sw_row_off_loop:
  cmp #15
  bcc sw_row_off_done
  sec
  sbc #15
  inx
  jmp sw_row_off_loop
sw_row_off_done:
  tay
  txa
  clc
  adc win_row_screen
  pha
  tya
  tax
  pla
  rts

; sw_rw_attr_* -- return A = mt_pal of one of the current cell's four
; blocks, or 0 if the quadrant has no valid same-nametable content (R2).
sw_rw_attr_tl:
  jsr sw_rw_attr_x0
  jsr sw_rw_attr_y0
  jmp sw_rw_attr_read
sw_rw_attr_tr:
  jsr sw_rw_attr_x1
  jsr sw_rw_attr_y0
  jmp sw_rw_attr_read
sw_rw_attr_bl:
  lda sw_rw_arow
  cmp #7
  beq sw_rw_attr_zero
  jsr sw_rw_attr_x0
  jsr sw_rw_attr_y1
  jmp sw_rw_attr_read
sw_rw_attr_br:
  lda sw_rw_arow
  cmp #7
  beq sw_rw_attr_zero
  jsr sw_rw_attr_x1
  jsr sw_rw_attr_y1
sw_rw_attr_read:
  ldy sw_rw_offset
  lda [mtptr_lo],y
  tax
  lda mt_pal,x
  rts
sw_rw_attr_zero:
  lda #0
  rts
sw_rw_attr_x0:
  lda sw_rw_acol
  asl a
  clc
  adc sw_rw_base_col
  jsr sw_rw_col_delta
  jsr sw_col_at_offset
  sta sw_tmp3
  jmp sw_rw_attr_x_read
sw_rw_attr_x1:
  lda sw_rw_acol
  asl a
  clc
  adc #1
  clc
  adc sw_rw_base_col
  jsr sw_rw_col_delta
  jsr sw_col_at_offset
  sta sw_tmp3
sw_rw_attr_x_read:
  stx sw_rw_tmp2
  rts
sw_rw_attr_y0:
  lda sw_rw_arow
  asl a
  clc
  adc sw_rw_base_row
  jsr sw_rw_row_delta
  jsr sw_row_at_offset
  jmp sw_rw_attr_y_combine
sw_rw_attr_y1:
  lda sw_rw_arow
  asl a
  clc
  adc #1
  clc
  adc sw_rw_base_row          ; R2 FIX: this line was missing -- every
                                ; bottom-half quadrant read the wrong world
                                ; row (as if base_row were always 0)
  jsr sw_rw_row_delta
  jsr sw_row_at_offset
sw_rw_attr_y_combine:
  pha
  txa
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_rw_tmp2
  sta sw_rw_offset
  lda sw_tmp3
  cmp sw_last_screen_col
  bne sw_rwa_relocate
  pla
  cmp sw_last_screen_row
  beq sw_rwa_done
  pha
sw_rwa_relocate:
  lda sw_tmp3
  sta sw_last_screen_col
  pla
  sta sw_last_screen_row
  lda sw_tmp3
  ldx sw_last_screen_row
  jsr sw_goto
sw_rwa_done:
  rts

sw_rw_nt_hi:  .db $20, $24, $28, $2C
sw_rw_ntx:    .db 0, 16, 0, 16
sw_rw_nty:    .db 0, 0, 15, 15

; ---- NMI-private scratch, zero page, chained off cam_slide_b_pending.
; R11's own fix: sw_ns_chunk is a NEW, thirteenth byte here, dedicated to
; sw_nmi_stream alone -- fixing the sw_tmp4 reentrancy bug (sw_tmp4 was
; shared with sw_goto's own row accumulator, a main-loop routine an NMI can
; interrupt at any point).
sw_ns_row     = cam_slide_b_pending+1
sw_ns_col     = sw_ns_row+1
sw_ns_nt      = sw_ns_col+1
sw_ns_q       = sw_ns_nt+1
sw_ns_pb      = sw_ns_q+1
sw_ns_cm      = sw_ns_pb+1
sw_ns_ai      = sw_ns_cm+1
sw_ns_row_lo  = sw_ns_ai+1
sw_ns_row_hi  = sw_ns_row_lo+1
sw_rw_shadow_lo = sw_ns_row_hi+1
sw_rw_shadow_hi = sw_rw_shadow_lo+1
sw_ns_chunk   = sw_rw_shadow_hi+1    ; NEW this round -- R11

; TEMPORARY debug export -- resolves zero-page/absolute equate chain
; addresses for the JS/Mesen verification harnesses (fix round 3's own R4
; Mesen deadline check reads the second block below; this file is a
; prototype, never part of the shipping engine, and this table never ships).
; Both blocks are LOW/HIGH byte pairs at a real, .fns-resolvable label, so a
; harness computes every address fresh from whatever exact build it is
; testing rather than trusting a copied-in literal (CLAUDE.md's own
; "labels, not addresses" discipline, applied to a prototype that has no
; .fns entries for its own `=` equates at all).
sw_debug_addrs:
  .db LOW(sw_ns_row), HIGH(sw_ns_row)
  .db LOW(sw_ns_col), HIGH(sw_ns_col)
  .db LOW(sw_ns_nt), HIGH(sw_ns_nt)
  .db LOW(sw_ns_row_lo), HIGH(sw_ns_row_lo)
  .db LOW(sw_ns_row_hi), HIGH(sw_ns_row_hi)
  .db LOW(sw_ns_chunk), HIGH(sw_ns_chunk)
  .db LOW(cam_slide_b_pending), HIGH(cam_slide_b_pending)

; R4's own deadline-harness addresses: the streaming state sw_nmi_stream/
; sw_ns_draw_block actually read, so a Mesen script can poke a chunk
; directly into flight without driving the strip-arming machinery first --
; the identical simplification flash_nmi_timing.lua.template already makes
; by poking FLASH_LEFT directly rather than simulating a full Flash arm.
sw_debug_addrs2:
  .db LOW(st_active), HIGH(st_active)
  .db LOW(st_cur), HIGH(st_cur)
  .db LOW(st_len), HIGH(st_len)
  .db LOW(st_ftile), HIGH(st_ftile)
  .db LOW(st_fnt), HIGH(st_fnt)
  .db LOW(st_vary), HIGH(st_vary)
  .db LOW(sbuf), HIGH(sbuf)
  .db LOW(sw_caller_bank), HIGH(sw_caller_bank)   ; R3 fix, index 7
  .db LOW(sw_run_len), HIGH(sw_run_len)           ; R4 finding-2 fix, index 8
  .db LOW(sw_run_buf), HIGH(sw_run_buf)           ; R4 finding-2 fix, index 9

; Review 5, finding 10: SW_STREAM_CHUNK is a compile-time `=` equate, never
; dumped by `nesasm -s` and never stored anywhere in RAM -- a test deriving
; its own drain-completion expectations from it needs a real, resolvable
; place to read it, not a second hardcoded literal that can drift out of
; sync with this file's own compiled default the way T3's own "10 NMIs"
; assumption did. One literal ROM byte, not an address pair (unlike every
; entry above) -- the harness reads it directly via loadFromCartridge.
sw_debug_chunk:
  .db SW_STREAM_CHUNK

; ==========================================================================
; sw_run_bank_test -- review 4, finding 2's own required proof: a caller
; whose CODE physically executes in a switchable bank, not a JS/RAM call
; stub (T9/diag_r3_transaction's own gap, named by the review). UNROM 512's
; own register is a 16 KB PRG-bank number (`switch_prg_bank`'s `and #$1F`,
; engine/banks.asm:242) covering TWO 8 KB nesasm banks at once --
; `shared/cartridge.js`'s own `prgLayout()` pairs nesasm bank `2N` ($8000
; half) with `2N+1` ($A000 half) under PRG-bank-register value N. To make
; `sw_caller_bank=7` (the register value) actually select this code, it
; must live at nesasm bank 14 (2*7), not literal bank 7 -- a real
; nesasm-bank-vs-hardware-register distinction this design's own sw_goto
; already divides/multiplies around (the `lsr a` after computing a region
; index), caught here empirically (bank 7's own $8000 first read back the
; unassigned-bank $FF fill, not this code's fingerprint, until fixed).
; Nesasm bank 14/15 is otherwise unused by every other file in this build
; (checked: 0-4, 10-12, 40-42, 62-63) -- this exists only to give the proof
; a real bank to execute from, and never ships.
; ==========================================================================
  .bank 14
  .org $8000
sw_run_bank_test_fingerprint:
  .db 200        ; read back after the call -- proves PRG register 7 (THIS
                  ; code's own bank) is what switch_prg_bank restored, not
                  ; the field's current screen's bank
sw_run_bank_test:
  lda #8
  sta sw_run_len
  lda #7
  sta sw_caller_bank
  lda #0         ; target screenCol
  ldx #1         ; target screenRow
  ldy #0         ; offset within that screen's record
  jsr sw_read_run
  rts

  .bank 62
```

### `proto-tools/diag_r8_banked_strip.mjs`, new this round -- fix round 8, finding 3's own proof: sw_banked_stream_start_col/row vs. the already-proven mainline routines, both axes, 2- and 3-screen cases, real cycle costs

```javascript
// diag_r8_banked_strip.mjs -- fix round 8, finding 3's own required proof:
// sw_banked_stream_start_col/row (minimal-u512-fs3/build/streamworld.asm,
// PRG register 7's own bank-14 test slot) produce EXACTLY the same sbuf[]
// contents as the already-proven mainline sw_stream_start_col/row
// (verify_torus.mjs's own T1-T3), called from a genuinely banked context
// (register 7 selected before the call, sw_caller_bank=7), restoring the
// caller's own bank correctly afterward -- and measures the real 6502
// cycle cost of the complete banked arm at both the 2-screen (local=0) and
// 3-screen (local!=0, this round's own real finding) cases, both axes.
//
// Board: minimal-u512-fs3, NOT minimal-u512 -- a real, disclosed finding-7
// result forced this: minimal-u512's own kernel-lo, accumulated over four
// prototype rounds, has 45 free bytes; sw_strip_fetch_run_col/row (below,
// and REQUIRED to live in kernel-lo, not bank 14 -- see its own header for
// why) costs more than that even after sharing its two entry points' own
// loop body. minimal-u512-fs3 is minimal-u512 with CAMERA_ENABLED reverted
// to 0 (this specific proof does not exercise the camera) and the
// TEMPORARY/never-shipped sw_debug_addrs/sw_debug_addrs2/sw_debug_chunk
// tables removed (this script resolves every address from the real
// equate chain directly instead, below, not from those tables) --
// `node proto-tools/rebuild_minimal_u512_fs3.mjs` reproduces it from
// minimal-u512 exactly. Real kernel-lo cost, measured: BANK 62 8164/8192
// (28 free) WITH the new primitive in this reduced build; see the report
// for the isolated primitive-only byte delta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512-fs3', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512-fs3', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

// RAM chain off msg_name_idx (same as diag_r5_fill.mjs / diag_r7_*).
const RAM = {};
{
  let a = 0x59f;
  for (const n of ['sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi', 'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h', 'sw_tmp', 'sw_tmp2', 'sw_tmp3', 'sw_tmp4', 'sw_tmp5', 'sw_tmp6', 'win_col_screen', 'win_col_local', 'win_row_screen', 'win_row_local', 'st_active', 'st_cur', 'st_len', 'st_ftile', 'st_fnt', 'st_vary', 'ss_i', 'sbuf']) {
    a += 1; RAM[n] = a;
  }
}
// sbuf is @size=32 starting right after ss_i in that chain -- RAM.sbuf
// above already names its FIRST byte correctly (the chain increments once
// per name, matching streamworld.asm's own `sbuf = ss_i+1` equate).

// sw_caller_bank is a chained `=` expression equate (sw_rw_wbase_row+1, a
// SEPARATE chain from the msg_name_idx one RAM{} resolves above), so it is
// absent from main.fns for the same reason sw_fill_metatile_id always is.
// This board has no sw_debug_addrs2 table left to resolve it from (removed
// to make room, above), so this continues the SAME chain by hand instead,
// straight out of streamworld.asm's own equates (sw_ss_sc = sbuf+32,
// then +1 per name through sw_rw_wbase_row, sw_caller_bank = that+1) --
// cross-checked against minimal-u512's own sw_debug_addrs2-resolved value
// (0x5f2) before this board existed, and identical, since neither board's
// RAM layout up to this chain differs.
const RAM_CALLER_CHAIN = {};
{
  let a = RAM.sbuf + 32; // sw_ss_sc
  for (const n of ['sw_ss_sc', 'sw_ss_lc', 'sw_ss_sr', 'sw_ss_lr', 'sw_probe_col_screen', 'sw_probe_col_local', 'sw_probe_row_screen', 'sw_probe_row_local', 'sw_last_screen_col', 'sw_last_screen_row', 'sw_rw_nt', 'sw_rw_row', 'sw_rw_col', 'sw_rw_base_col', 'sw_rw_base_row', 'sw_rw_offset', 'sw_rw_arow', 'sw_rw_acol', 'sw_rw_tmp', 'sw_rw_tmp2', 'sw_rw_wbase_col', 'sw_rw_wbase_row', 'sw_caller_bank', 'sw_run_off', 'sw_run_len']) {
    RAM_CALLER_CHAIN[n] = a;
    a += 1;
  }
}
const SW_CALLER_BANK = RAM_CALLER_CHAIN.sw_caller_bank;
if (SW_CALLER_BANK !== 0x5f2) throw new Error(`sw_caller_bank chain mismatch: got 0x${SW_CALLER_BANK.toString(16)}, expected 0x5f2 (cross-checked against minimal-u512's own debug table last round)`);

// Header byte 6 assertion (ground rule): the patched ROM must be four-
// screen WITHOUT the battery bit ($E9) -- this board (unlike sample-u512,
// which has a live Save command and reads $EB) has SAVE_ENABLED=0, so
// applyHeaderPatch's own battery bit never sets. A direct nesasm build
// (unpatched) would read $E1 and silently mean vertical mirroring instead
// (CLAUDE.md's own documented trap, closed for the deadline harnesses in
// fix round 6, applied here too).
{
  const headerBytes = fs.readFileSync(ROM).subarray(0, 16);
  if (headerBytes[6] !== 0xe9) {
    throw new Error(`header byte 6 is 0x${headerBytes[6].toString(16)}, expected 0xe9 (four-screen, no battery) -- rebuild main.patched.nes via applyHeaderPatch`);
  }
}

function freshNes() {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame();
  nes.mmap.write(0x2000, 0);
  return nes;
}

function setup3x3(nes) {
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_grid_w] = 3;
  nes.cpu.mem[RAM.sw_grid_h] = 3;
}

let failures = 0;
function check(name, cond) { if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

function readSbuf(nes, len) {
  const out = [];
  for (let i = 0; i < len; i++) out.push(nes.cpu.mem[RAM.sbuf + i]);
  return out;
}

// ---- Column strips: mainline vs. banked, at local=0 (2-screen) and
// local=1/7/14 (3-screen, this round's own finding).
console.log('=== column strip: sw_stream_start_col (mainline, proven) vs. sw_banked_stream_start_col (banked, register 7) ===');
for (const L of [0, 1, 7, 14]) {
  // Mainline reference
  const nesA = freshNes();
  setup3x3(nesA);
  nesA.cpu.mem[RAM.win_row_screen] = 0;
  nesA.cpu.mem[RAM.win_row_local] = L;
  nesA.cpu.REG_ACC = 1; // entering screenCol
  nesA.cpu.REG_X = 0;   // entering localCol
  callRoutine(nesA, addr('sw_stream_start_col'));
  const refSbuf = readSbuf(nesA, 30);
  const refStFtile = nesA.cpu.mem[RAM.st_ftile];
  const refStFnt = nesA.cpu.mem[RAM.st_fnt];

  // Banked version: select register 7 first (bank 14, where the routine
  // itself and this "caller" both live), set sw_caller_bank=7, call.
  const nesB = freshNes();
  setup3x3(nesB);
  nesB.cpu.mem[RAM.win_row_screen] = 0;
  nesB.cpu.mem[RAM.win_row_local] = L;
  nesB.cpu.REG_ACC = 7;
  callRoutine(nesB, addr('switch_prg_bank'));
  const fingerprintBefore = nesB.cpu.loadFromCartridge(0x8000);
  nesB.cpu.mem[SW_CALLER_BANK] = 7;
  nesB.cpu.REG_ACC = 1;
  nesB.cpu.REG_X = 0;
  const cycles = callRoutine(nesB, addr('sw_banked_stream_start_col'));
  const bankedSbuf = readSbuf(nesB, 30);
  const fingerprintAfter = nesB.cpu.loadFromCartridge(0x8000);

  const match = refSbuf.join(',') === bankedSbuf.join(',');
  console.log(`  local=${L}: mainline/banked sbuf match=${match}, st_ftile ${refStFtile}/${nesB.cpu.mem[RAM.st_ftile]}, cycles=${cycles}`);
  check(`column local=${L}: banked sbuf matches mainline exactly (30 bytes)`, match);
  check(`column local=${L}: st_ftile/st_fnt match`, refStFtile === nesB.cpu.mem[RAM.st_ftile] && refStFnt === nesB.cpu.mem[RAM.st_fnt]);
  check(`column local=${L}: caller's own bank (7) restored, fingerprint unchanged`, fingerprintBefore === fingerprintAfter);
  check(`column local=${L}: st_active armed (1)`, nesB.cpu.mem[RAM.st_active] === 1);
  check(`column local=${L}: st_len is 30`, nesB.cpu.mem[RAM.st_len] === 30);
}

console.log('\n=== row strip: sw_stream_start_row (mainline, proven) vs. sw_banked_stream_start_row (banked, register 7) ===');
for (const L of [0, 1, 8, 15]) {
  const nesA = freshNes();
  setup3x3(nesA);
  nesA.cpu.mem[RAM.win_col_screen] = 0;
  nesA.cpu.mem[RAM.win_col_local] = L;
  nesA.cpu.REG_ACC = 1; // entering screenRow
  nesA.cpu.REG_X = 0;   // entering localRow
  callRoutine(nesA, addr('sw_stream_start_row'));
  const refSbuf = readSbuf(nesA, 32);

  const nesB = freshNes();
  setup3x3(nesB);
  nesB.cpu.mem[RAM.win_col_screen] = 0;
  nesB.cpu.mem[RAM.win_col_local] = L;
  nesB.cpu.REG_ACC = 7;
  callRoutine(nesB, addr('switch_prg_bank'));
  const fingerprintBefore = nesB.cpu.loadFromCartridge(0x8000);
  nesB.cpu.mem[SW_CALLER_BANK] = 7;
  nesB.cpu.REG_ACC = 1;
  nesB.cpu.REG_X = 0;
  const cycles = callRoutine(nesB, addr('sw_banked_stream_start_row'));
  const bankedSbuf = readSbuf(nesB, 32);
  const fingerprintAfter = nesB.cpu.loadFromCartridge(0x8000);

  const match = refSbuf.join(',') === bankedSbuf.join(',');
  console.log(`  local=${L}: mainline/banked sbuf match=${match}, cycles=${cycles}`);
  check(`row local=${L}: banked sbuf matches mainline exactly (32 bytes)`, match);
  check(`row local=${L}: caller's own bank (7) restored, fingerprint unchanged`, fingerprintBefore === fingerprintAfter);
  check(`row local=${L}: st_active armed (2)`, nesB.cpu.mem[RAM.st_active] === 2);
  check(`row local=${L}: st_len is 32`, nesB.cpu.mem[RAM.st_len] === 32);
}

// ---- Real cost table: complete banked arm, both axes, 2-screen and
// 3-screen cases -- the number decision A's own "fold into the frame
// budget" question needs.
console.log('\n=== real cycle costs, complete banked arm (fresh call each time) ===');
const FRAME_BUDGET = 29780; // ~1.789773 MHz / 60.0988 Hz, one full NTSC frame
function measureCost(routineName, winField, L, axisArg) {
  const nes = freshNes();
  setup3x3(nes);
  nes.cpu.mem[RAM[winField[0]]] = 0;
  nes.cpu.mem[RAM[winField[1]]] = L;
  nes.cpu.REG_ACC = 7;
  callRoutine(nes, addr('switch_prg_bank'));
  nes.cpu.mem[SW_CALLER_BANK] = 7;
  nes.cpu.REG_ACC = axisArg[0];
  nes.cpu.REG_X = axisArg[1];
  return callRoutine(nes, addr(routineName));
}
const results = {
  'column, local=0 (2 screens)': measureCost('sw_banked_stream_start_col', ['win_row_screen', 'win_row_local'], 0, [1, 0]),
  'column, local=7 (3 screens, worst-ish)': measureCost('sw_banked_stream_start_col', ['win_row_screen', 'win_row_local'], 7, [1, 0]),
  'row, local=0 (2 screens)': measureCost('sw_banked_stream_start_row', ['win_col_screen', 'win_col_local'], 0, [1, 0]),
  'row, local=8 (3 screens, worst-ish)': measureCost('sw_banked_stream_start_row', ['win_col_screen', 'win_col_local'], 8, [1, 0]),
};
for (const [label, cycles] of Object.entries(results)) {
  const pct = (cycles / FRAME_BUDGET * 100).toFixed(2);
  console.log(`  ${label}: ${cycles} cycles (${pct}% of a ${FRAME_BUDGET}-cycle NTSC frame)`);
}
// No pass/fail threshold here -- decision A's own frame budget is not
// this script's to assert against (main_loop's own remaining slack after
// read_pad/music_tick/dispatch_input/world-update/build_oam/draw_entities
// is not measured anywhere in this suite); these are the real, disclosed
// numbers for the report to reason about, not a claim this script verifies.

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);

```

### `proto-tools/rebuild_minimal_u512_fs3.mjs`, new this round -- fix round 8, finding 3's own reproducible board derivation (minimal-u512-fs3, injecting the kernel-lo primitive and banked arm from the two template files below)

```javascript
#!/usr/bin/env node
// rebuild_minimal_u512_fs3.mjs -- fix round 8, finding 3: reproducibly
// builds minimal-u512-fs3 from a FRESH copy of minimal-u512 (which must
// stay byte-for-byte the fix-7 baseline every OTHER script in this suite
// depends on -- verify_torus.mjs, diag_r7_sustained_rate.mjs,
// diag_r7_dialogue_accessor.mjs all assemble it whole and would break the
// moment it stopped fitting kernel-lo, which is exactly what happened the
// first time this round's own finding-3 code was added directly to it).
//
// Real, disclosed reason this script injects source rather than just
// trimming: sw_strip_fetch_run_col/row (finding3_kernel_lo_primitive.asm)
// MUST live in kernel-lo (see its own header comment for why -- a real
// crash, not a guess), and minimal-u512's own kernel-lo, accumulated over
// four prototype rounds, has no room left for it (45 free bytes measured
// before this addition; the primitive alone needs more even after sharing
// its two entry points' own loop body). So this script:
//   1. Copies minimal-u512 fresh (never mutates the source board).
//   2. Reverts CAMERA_ENABLED 1->0 in assets/config.inc (this proof does
//      not exercise the camera).
//   3. Removes the TEMPORARY/never-shipped sw_debug_addrs/sw_debug_addrs2/
//      sw_debug_chunk tables (this board's own diag_r8_banked_strip.mjs
//      resolves every address it needs from the real equate chain
//      directly instead -- see its own header for the cross-check against
//      minimal-u512's own debug-table-resolved values).
//   4. Injects finding3_kernel_lo_primitive.asm into kernel-lo (right
//      after sw_read_run_done's own rts) and finding3_banked_arm.asm into
//      the existing bank-14 test slot (right after sw_dlg_metatile's own
//      jmp sw_terrain_or_fill, before the `.bank 62` that resumes
//      kernel-lo) -- both files are the REAL, bug-fixed, already-proven
//      source (diag_r8_banked_strip.mjs: 25/25 checks, ALL PASS), not
//      re-derived here.
//
//   node proto-tools/rebuild_minimal_u512_fs3.mjs
//
// Prints the real BANK 62 usage/free figure nesasm reports, so this is
// also the command that reproduces the "28 free" (now measured fresh
// below) number the report cites.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'minimal-u512');
const DST = path.join(ROOT, 'minimal-u512-fs3');
const PRIMITIVE_PATH = path.join(ROOT, 'proto-tools', 'finding3_kernel_lo_primitive.asm');
const ARM_PATH = path.join(ROOT, 'proto-tools', 'finding3_banked_arm.asm');

function copyDir(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
}

function main() {
  copyDir(SRC, DST);

  // 1. Camera off.
  const configPath = path.join(DST, 'build', 'assets', 'config.inc');
  let config = fs.readFileSync(configPath, 'utf8');
  const cameraPattern = /^CAMERA_ENABLED = 1$/m;
  if (!cameraPattern.test(config)) throw new Error('CAMERA_ENABLED = 1 not found in config.inc -- minimal-u512 changed shape');
  config = config.replace(cameraPattern, 'CAMERA_ENABLED = 0');
  fs.writeFileSync(configPath, config);

  // 2. Remove the three debug tables.
  const asmPath = path.join(DST, 'build', 'streamworld.asm');
  let lines = fs.readFileSync(asmPath, 'utf8').split('\n');
  {
    const out = [];
    let skipping = false;
    let removedTables = 0;
    for (const line of lines) {
      if (/^sw_debug_addrs:$/.test(line) || /^sw_debug_addrs2:$/.test(line) || /^sw_debug_chunk:$/.test(line)) {
        skipping = true;
        removedTables++;
        continue;
      }
      if (skipping) {
        if (line.trim().startsWith('.db')) continue;
        skipping = false;
      }
      out.push(line);
    }
    if (removedTables !== 3) throw new Error(`expected to remove exactly 3 debug tables, removed ${removedTables}`);
    lines = out;
  }

  // 3. Inject the kernel-lo primitive right after sw_read_run_done's own rts.
  const primitiveText = fs.readFileSync(PRIMITIVE_PATH, 'utf8').replace(/\n$/, '');
  {
    const idx = lines.findIndex((l) => l.trim() === 'sw_read_run_done:');
    if (idx === -1) throw new Error('sw_read_run_done: not found');
    // body is exactly 3 lines: lda sw_caller_bank / jsr switch_prg_bank / rts
    const rtsIdx = idx + 3;
    if (lines[rtsIdx].trim() !== 'rts') throw new Error(`expected rts at sw_read_run_done+3, found: ${lines[rtsIdx]}`);
    lines = [...lines.slice(0, rtsIdx + 1), '', ...primitiveText.split('\n'), '', ...lines.slice(rtsIdx + 1)];
  }

  // 4. Inject the banked arm into bank 14, right after sw_dlg_metatile's
  // own jmp sw_terrain_or_fill, before the `.bank 62` that follows it.
  const armText = fs.readFileSync(ARM_PATH, 'utf8').replace(/\n$/, '');
  {
    const idx = lines.findIndex((l) => l.trim() === 'jmp sw_terrain_or_fill');
    if (idx === -1) throw new Error('jmp sw_terrain_or_fill not found (sw_dlg_metatile changed shape)');
    if (lines[idx + 1].trim() !== '.bank 62') throw new Error(`expected .bank 62 right after jmp sw_terrain_or_fill, found: ${lines[idx + 1]}`);
    lines = [...lines.slice(0, idx + 1), '', ...armText.split('\n'), '', ...lines.slice(idx + 1)];
  }

  fs.writeFileSync(asmPath, lines.join('\n'));

  const buildDir = path.join(DST, 'build');
  const result = execFileSync('nesasm', ['-s', 'main.asm'], { cwd: buildDir, encoding: 'utf8' });
  if (/\berror\b/i.test(result) || /bank overflow/i.test(result)) {
    throw new Error(`nesasm reported a real diagnostic:\n${result}`);
  }
  const bank62Line = result.split('\n').find((l) => l.includes('BANK  62'));
  console.log('minimal-u512-fs3 rebuilt and assembled clean.');
  console.log(bank62Line.trim());
}

main();

```

### `proto-tools/finding3_kernel_lo_primitive.asm`, new this round -- fix round 8, finding 3's own kernel-lo primitive source, injected by rebuild_minimal_u512_fs3.mjs (sw_strip_fetch_run_col/row)

```asm
; ==========================================================================
; sw_strip_fetch_run_col / sw_strip_fetch_run_row -- fix round 8, finding 3's
; own required resident, BANKED strip-fetch primitive: a caller resident in
; ANY PRG bank (not just mainline/field code) can fetch one screen's own
; contribution to a strip DIRECTLY into sbuf, restoring via sw_caller_bank
; exactly as sw_read_transaction does -- the "caller resident in a
; switchable bank" case review 6's own finding 3 requires proven, not just
; sw_peek_byte's own field-restore convenience.
;
; Two entry points, one shared body, stride hardcoded per entry rather than
; taken as a caller-set byte (saving the one RAM byte a stride parameter
; would otherwise cost, in a gap finding 7 already has none free in):
; sw_strip_fetch_run_col reads STRIDED bytes (stride 16 -- one column of a
; screen's own terrain, offset/offset+16/offset+32/...) for the banked
; column arm below; sw_strip_fetch_run_row reads CONTIGUOUS bytes (stride 1
; -- one local row of a screen's own terrain) for the banked row arm.
;
; In: A=screenCol, X=screenRow, Y=starting sbuf index, sw_run_off=starting
;     offset within the target screen's own 240-byte terrain block,
;     sw_run_len=count (1-16), sw_caller_bank=the caller's own PRG register.
; Out: sbuf[Y..Y+count-1] filled. Clobbers A, X, Y, sw_tmp, sw_tmp2, sw_tmp3.
;
; PLACEMENT IS NOT OPTIONAL: kernel-lo, always, never a switchable bank --
; found by a real crash, not reasoned in advance. A first draft put this
; primitive in bank 14 alongside its own caller (sw_banked_stream_start_col/
; row, below): "invalid opcode at $c051" (inside mt_tl, a DATA table) the
; instant sw_goto's own internal jsr switch_prg_bank ran. The reason is
; exactly the hazard sw_peek_byte's own header already names for its
; CALLER's sake, applied here to this routine's OWN code: sw_goto switches
; the $8000-$9FFF window to the TARGET screen's own bank before it returns;
; a caller-resident-in-that-same-window's own "return here" address is now
; pointing at the target screen's DATA, not this routine's own next
; instruction, so the very next fetch after `jsr sw_goto` executes garbage.
; Kernel-lo is exempt because it is the one window every PRG-switch leaves
; untouched -- exactly why sw_read_run/sw_peek_byte/sw_read_transaction all
; already live there. The CALLER (sw_banked_stream_start_col/row) can
; safely live in a switchable bank instead, because it only ever reaches
; this primitive through a `jsr` to a KERNEL-LO target and gets back a
; clean `rts` with its own bank (sw_caller_bank) already restored -- it
; never itself executes code from underneath a live PRG switch.
;
; Both entries share the loop body below (a code-size trim found necessary
; while chasing this round's own kernel-lo overflow, below). REAL BUG this
; round's own proof caught (diag_r8_banked_strip.mjs, a two-segment column
; wrote its second segment's own bytes back over its first's, at sbuf
; index 0 instead of 15): the FIRST draft did `sty sw_tmp2` to stash the
; starting sbuf index BEFORE `jsr sw_goto` -- but sw_goto's own clobber
; list is sw_tmp THROUGH sw_tmp6, ALL SIX, including sw_tmp2 as its own
; cold-path column-region accumulator, so the stashed value was destroyed
; mid-call, not preserved. A SECOND draft "fixed" this by pushing Y on the
; stack instead (`tya/pha`) -- which is real progress (the stack is the one
; place sw_goto truly cannot reach) but introduced a NEW bug the same
; proof caught immediately after: `tya` clobbers A, and A is where
; sw_goto's own screenCol ARGUMENT lives at entry, so the push destroyed
; the very argument the upcoming `jsr sw_goto` needed. The actual fix
; needs neither maneuver: sw_goto's own body contains no Y-register
; instruction anywhere (checked directly, not merely asserted) -- Y
; survives a `jsr sw_goto` call for free, exactly as sw_peek_byte's own
; header already documents for ITS caller's offset argument. So the
; starting sbuf index needs no stashing at all before the call; it is
; simply read INTO sw_tmp2 (and sw_tmp3 for the stride) once sw_goto has
; already returned, the identical "safe once returned" reuse
; sw_dlg_metatile's own header already relies on for the same two bytes.
; ==========================================================================
sw_strip_fetch_run_col:
  jsr sw_goto
  sty sw_tmp2                 ; starting sbuf index -- safe NOW, sw_goto
                               ; has already returned and never touched Y
  lda #16                     ; column stride
  sta sw_tmp3
  jmp sw_sfr_body
sw_strip_fetch_run_row:
  jsr sw_goto
  sty sw_tmp2
  lda #1                      ; row stride
  sta sw_tmp3
sw_sfr_body:
  lda sw_run_off
  sta sw_tmp                  ; running source offset
  ldx #0
sw_sfr_loop:
  cpx sw_run_len
  bcs sw_sfr_finish
  ldy sw_tmp
  lda [mtptr_lo],y
  ldy sw_tmp2
  sta sbuf,y
  lda sw_tmp
  clc
  adc sw_tmp3
  sta sw_tmp
  inc sw_tmp2
  inx
  jmp sw_sfr_loop
sw_sfr_finish:
  lda sw_caller_bank
  jsr switch_prg_bank
  rts

```

### `proto-tools/finding3_banked_arm.asm`, new this round -- fix round 8, finding 3's own bank-14 arm source, injected by rebuild_minimal_u512_fs3.mjs (sw_banked_stream_start_col/row)

```asm
; ==========================================================================
; sw_banked_stream_start_col / sw_banked_stream_start_row -- fix round 8,
; finding 3's own required banked strip ARM, built on the primitive above.
; Same shape as sw_stream_start_col/row (below, unchanged, the mainline
; caller's own version -- kept, not deleted, since mainline field code has
; no reason to pay a banked caller's own extra switch/restore per segment),
; but composed from 2-3 whole-screen RUN fetches instead of 30/32 individual
; byte reads, and ending with a sw_caller_bank restore instead of
; sw_locate_current -- correct for a caller resident in ANY bank, per
; finding 3's own explicit ask.
;
; REAL FACT this round's own simulation found, not previously stated this
; precisely anywhere in this document: a column or row strip touches
; **three** distinct screens, not two, whenever the window's own origin on
; that axis is NOT local-aligned (local != 0) -- the window's own physical
; extent is exactly two screens on either axis, but a strip's own 30 or 32
; blocks, read starting from an arbitrary interior local offset, overruns
; the second screen's own 15/16-local-unit extent by up to 14/15 units,
; landing in a THIRD screen for the remainder. Confirmed by simulating the
; existing, already-proven sw_stream_start_col/row's own relocation logic
; exactly (not reasoned from scratch) at every local offset 0-14/0-15: at
; local=0 the strip is genuinely 2 screens (15+15 / 16+16); at every OTHER
; local value it is 3 screens, with segment lengths (15-L, 15, L) for a
; column or (16-L, 16, L) for a row. Both the ARM below and finding 2's own
; "the window/viewport clamp... keeps the resident window inside a map at
; least as big as the window" text must be read with this in mind: the
; STRIP's own worst-case screen-touch count (3) is larger than the WINDOW's
; own worst-case simultaneously-resident screen count on that axis (2) --
; different questions, not a contradiction, but easy to conflate.
;
; In: A=screenCol, X=localCol (the entering edge, column mode) or
;     A=screenRow, X=localRow (row mode); sw_caller_bank=the caller's own
;     PRG register, set before the jsr. win_row_screen/local (column mode)
;     or win_col_screen/local (row mode) name the window's own current
;     origin on the FIXED axis, exactly as the mainline version reads them.
; Out: sbuf[0..29] (column) or sbuf[0..31] (row) filled; st_ftile/st_fnt/
;     st_len/st_cur/st_active armed exactly as the mainline version leaves
;     them, so sw_nmi_stream needs no changes to draw a banked-armed strip.
;     Clobbers A, X, Y and everything sw_strip_fetch_run_col/row clobbers.
; ==========================================================================
sw_banked_stream_start_col:
  stx sw_ss_lc
  sta sw_ss_sc
  txa
  asl a
  sta st_ftile
  lda sw_ss_sc
  and #1
  asl a
  asl a
  sta st_fnt
  lda win_row_local
  sta sw_probe_row_local
  lda win_row_screen
  sta sw_probe_row_screen
  lda #0
  sta ss_i                    ; sbuf write cursor / blocks placed so far
sw_bsc_segment:
  ; segment length = min(15 - probe_row_local, 30 - ss_i)
  lda #15
  sec
  sbc sw_probe_row_local       ; A = 15-local (room left in this screen)
  sta sw_tmp3                  ; stash candidate length (sw_tmp3 -- NOT yet
                                ; clobbered: sw_goto has not run this segment
                                ; yet, and sw_tmp3 is sw_goto's own row
                                ; accumulator, safe to use up until the jsr)
  lda #30
  sec
  sbc ss_i                     ; A = 30 - already-placed (room left overall)
  cmp sw_tmp3
  bcc sw_bsc_seglen_ok         ; overall-remaining < screen-remaining -> use it
  lda sw_tmp3                  ; else the screen's own remaining room is smaller
sw_bsc_seglen_ok:
  sta sw_run_len
  lda sw_probe_row_local
  asl a
  asl a
  asl a
  asl a                        ; local_row * 16
  clc
  adc sw_ss_lc                 ; + fixed localCol
  sta sw_run_off
  lda sw_ss_sc
  ldx sw_probe_row_screen
  ldy ss_i
  jsr sw_strip_fetch_run_col
  lda ss_i
  clc
  adc sw_run_len
  sta ss_i
  inc sw_probe_row_screen
  lda #0
  sta sw_probe_row_local        ; every segment after the first starts at local 0
  lda ss_i
  cmp #30
  bne sw_bsc_segment
  lda #30
  sta st_len
  lda #0
  sta st_cur
  lda #1
  sta st_active
  lda sw_caller_bank
  jsr switch_prg_bank           ; the loop's own segments already each
  rts                          ; restore it, but a defensive final restore
                                ; costs 5 bytes/cycles and closes the case
                                ; where a future edit adds a segment path
                                ; that doesn't call the primitive

sw_banked_stream_start_row:
  stx sw_ss_lr
  sta sw_ss_sr
  txa
  asl a
  sta st_ftile
  lda sw_ss_sr
  and #1
  asl a
  asl a
  asl a
  sta st_fnt
  lda win_col_local
  sta sw_probe_col_local
  lda win_col_screen
  sta sw_probe_col_screen
  lda #0
  sta ss_i
sw_bsr_segment:
  lda #16
  sec
  sbc sw_probe_col_local
  sta sw_tmp3
  lda #32
  sec
  sbc ss_i
  cmp sw_tmp3
  bcc sw_bsr_seglen_ok
  lda sw_tmp3
sw_bsr_seglen_ok:
  sta sw_run_len
  lda sw_ss_lr               ; BUG this round's own proof caught: this read
                              ; sw_ss_sr (the entering SCREEN row) before --
                              ; the offset formula needs the entering LOCAL
                              ; row (mainline's own sw_stream_start_row/
                              ; sw_ssr_read uses sw_ss_lr for the identical
                              ; reason), a copy-paste slip adapting the
                              ; column arm's own sw_ss_lc reference.
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_probe_col_local
  sta sw_run_off
  lda sw_probe_col_screen
  ldx sw_ss_sr
  ldy ss_i
  jsr sw_strip_fetch_run_row
  lda ss_i
  clc
  adc sw_run_len
  sta ss_i
  inc sw_probe_col_screen
  lda #0
  sta sw_probe_col_local
  lda ss_i
  cmp #32
  bne sw_bsr_segment
  lda #32
  sta st_len
  lda #0
  sta st_cur
  lda #2
  sta st_active
  lda sw_caller_bank
  jsr switch_prg_bank
  rts

```

### `proto-tools/diag_r8_packing_predicate.mjs`, new this round -- fix round 8, finding 5's own proof: the reviewer's 26-record MMC3 case reproduced against the real shipped screenCapacityFor/assignScreenBanks, plus the corrected validation predicate

```javascript
// diag_r8_packing_predicate.mjs -- fix round 8, finding 5: reproduces review
// 6's own exact defect (screenCapacityFor's return mixes real packed
// records with HYPOTHETICAL empty-screen-sized capacity in each region's
// own leftover tail, so it is not proof that N specific, real-sized
// records actually fit) against the REAL shipped functions
// (main/build/generate.js's screenCapacityFor/assignScreenBanks, not a
// reimplementation), then proves the fix: call assignScreenBanks itself
// (which does the real, ordered, whole-record walk, and already throws
// exactly when something doesn't fit) in validation mode instead of
// trusting screenCapacityFor's own count.
import assert from 'node:assert/strict';
import { screenCapacityFor, assignScreenBanks } from '../main/build/generate.js';
import { mapperById, screenRegions, SCREEN_REGION_BYTES } from '../shared/cartridge.js';

let failures = 0;
function check(name, cond) { if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

const mapper = mapperById(4); // MMC3
const tilesetCount = 1;
const bankedCode = 1; // one banked region reserved (the RPG battle bank), same shape review 6's own repro used
const regions = screenRegions(mapper, tilesetCount, bankedCode, { reserveFlashSave: false });
console.log(`MMC3, tilesetCount=${tilesetCount}, bankedCode=${bankedCode} -> ${regions.length} screen regions (${SCREEN_REGION_BYTES} bytes each)`);
assert.ok(regions.length >= 2, 'need at least 2 regions to build filler + a tail region');

// The reviewer's own record shapes, built from REAL screenRecordBytes math
// (SCREEN_BYTES=304, ENTITY_RECORD=9, BOUND_TILE_RECORD=3, +1 for the
// bound-tile-enabled flag byte): one-actor screens are 304+1+9+1=315 bytes,
// empty screens are 304+1+1=306 bytes, the final record (8 actors, 8
// bindings) is 304+1+9*8+1+3*8=402 bytes -- exactly the reviewer's own
// three figures, derived here from the real formula, not copied as a
// literal.
const oneActorScreen = { screen: { entities: [{ actorId: 0 }], boundTiles: [] } };
const emptyScreen = { screen: { entities: [], boundTiles: [] } };
const bigScreen = {
  screen: {
    entities: Array.from({ length: 8 }, () => ({ actorId: 0 })),
    boundTiles: Array.from({ length: 8 }, (_, i) => ({ switchId: 0, row: 0, col: i, metatileId: 0 })),
  },
};

// Filler: EXACTLY enough 306-byte empty screens to fill every region but
// the last one, so the packer's own sequential walk reaches the last
// region with a fresh 8176-byte budget. 306-byte screens pack identically
// every region (floor(8176/306)=26 per region, 220 bytes wasted -- 27
// would need 8262 > 8176), so this is exact, not a margin guess.
const perRegionFillerCount = Math.floor(SCREEN_REGION_BYTES / 306);
const fillerRegions = regions.length - 1;
const fillerCount = fillerRegions * perRegionFillerCount;
const filler = Array.from({ length: fillerCount }, () => emptyScreen);
console.log(`filler: ${fillerCount} empty (306-byte) screens = exactly ${perRegionFillerCount}/region x ${fillerRegions} regions`);

const tail25 = [
  ...Array.from({ length: 20 }, () => oneActorScreen),
  ...Array.from({ length: 5 }, () => emptyScreen),
];
const flat25 = [...filler, ...tail25];
const flat26 = [...filler, ...tail25, bigScreen];

const actorCount = 1;
const boundTilesEnabled = true;

// ---- Reproduce the defect exactly, against the REAL shipped function. ----
const capacity26 = screenCapacityFor(mapper, tilesetCount, bankedCode, flat26, actorCount, false, boundTilesEnabled);
console.log(`screenCapacityFor(..., flat26 [${flat26.length} records], ...) = ${capacity26} (requested ${flat26.length})`);
check('screenCapacityFor wrongly reports enough capacity for every record including the oversized last one', capacity26 >= flat26.length);

let assignThrew = false;
let assignError = null;
try {
  assignScreenBanks(mapper, tilesetCount, bankedCode, false, flat26, actorCount, boundTilesEnabled);
} catch (e) {
  assignThrew = true;
  assignError = e;
}
console.log(`assignScreenBanks(..., flat26, ...) ${assignThrew ? `THREW: ${assignError.message}` : 'did NOT throw'}`);
check('assignScreenBanks throws on the exact same records screenCapacityFor accepted', assignThrew);
check('the thrown error names exactly 1 screen that did not fit', assignThrew && /1 screens? did not fit/.test(assignError.message));

// ---- The fix: a validation-mode predicate built on assignScreenBanks
// itself (the real, ordered, whole-record walk -- the SAME logic that will
// actually run at build time), not screenCapacityFor's own count. ----
function fitsCapacity(mapper, tilesetCount, bankedCode, reserveFlashSave, flat, actorCount, boundTilesEnabled) {
  try {
    assignScreenBanks(mapper, tilesetCount, bankedCode, reserveFlashSave, flat, actorCount, boundTilesEnabled);
    return true;
  } catch {
    return false;
  }
}

check('the corrected predicate (assignScreenBanks-based) correctly REJECTS the case screenCapacityFor wrongly accepted', fitsCapacity(mapper, tilesetCount, bankedCode, false, flat26, actorCount, boundTilesEnabled) === false);
check('the corrected predicate correctly ACCEPTS the same records minus the oversized last one', fitsCapacity(mapper, tilesetCount, bankedCode, false, flat25, actorCount, boundTilesEnabled) === true);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);

```
### `proto-tools/build_arb_fixtures.mjs`, new this round -- fix round 7, decision A, proof 1's own builder (the two arbitrated-NMI deadline fixtures, strip-only and drain-plus-strip)

```javascript
#!/usr/bin/env node
// Fix round 7, decision A, proof 1 -- builds the ARBITRATED NMI's own two
// deadline fixtures against a real board build (the boot.asm splice this
// round made: "either vram_drain runs or sw_nmi_stream runs, never both in
// the same vblank"). Mirrors build_deadline_fixture.mjs's own derive-never-
// hardcode discipline (every address read back out of THIS exact build's
// main.fns / sw_debug_addrs2 table), but emits two ROMs/lua pairs instead of
// one:
//   1. strip-only  -- vram_ready=0 (nothing else queued this vblank), a
//      WORKLOAD_LEN-block chunk armed. Proves the strip alone, at the
//      compiled chunk size, finishes inside vblank -- decision A's own
//      "chunk 3, empty queue -> exit 0" requirement.
//   2. arbitration -- the worst-case 70-byte two-packet vram_buf drain AND a
//      chunk both armed, on the ARBITRATED rom. Proves the drain still wins
//      (vram_len drains to 0) and the strip yields (st_cur/st_active
//      unchanged) -- decision A's own "queue non-empty -> drain runs, strip
//      does not advance, exit 0" requirement -- distinct from
//      build_deadline_fixture.mjs's own unmodified template, which is kept
//      as the historical "why arbitration exists" negative control and run
//      ONLY against the separate pre-arbitration "unconditional" board copy.
//
//   node proto-tools/build_arb_fixtures.mjs <boardDir> [outDir] [chunkLen] [workloadLen] [parity]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { applyHeaderPatch, MAPPERS } from '../shared/cartridge.js';
import { Emulator } from '../renderer/emulator/runcontrol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [, , boardDirArg, outDirArg, chunkLenArg, workloadLenArg, parityArg] = process.argv;
if (!boardDirArg) {
  console.error('usage: node proto-tools/build_arb_fixtures.mjs <boardDir> [outDir] [chunkLen=3] [workloadLen=chunkLen] [parity=even|odd]');
  process.exit(2);
}
const chunkLen = chunkLenArg ? Number(chunkLenArg) : 3;
if (!Number.isInteger(chunkLen) || chunkLen < 1 || chunkLen > 4) {
  throw new Error(`chunkLen must be an integer 1-4 (sbuf is pre-poked with 4 valid ids), got ${chunkLenArg}`);
}
const workloadLen = workloadLenArg ? Number(workloadLenArg) : chunkLen;
if (!Number.isInteger(workloadLen) || workloadLen < 1 || workloadLen > 4) {
  throw new Error(`workloadLen must be an integer 1-4, got ${workloadLenArg}`);
}
const parity = parityArg || 'even';
if (parity !== 'even' && parity !== 'odd') throw new Error(`parity must be 'even' or 'odd', got ${parityArg}`);
const [ftileValue, fntValue] = parity === 'odd' ? [2, 8] : [0, 0];
const boardDir = path.resolve(ROOT, boardDirArg);
const buildDir = path.join(boardDir, 'build');
const outDir = outDirArg ? path.resolve(ROOT, outDirArg) : buildDir;

function fnsToMap(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
    if (m) map[m[1]] = parseInt(m[2], 16);
  }
  return map;
}

function assembleOrThrow() {
  const result = execFileSync('nesasm', ['-s', 'main.asm'], { cwd: buildDir, encoding: 'utf8' });
  if (/\berror\b/i.test(result) || /bank overflow/i.test(result)) {
    throw new Error(`nesasm reported a real diagnostic despite exit 0 -- refusing to trust stale artefacts:\n${result}`);
  }
  return result;
}

const SW_ASM_PATH = path.join(buildDir, 'streamworld.asm');
function withCompiledChunk(chunkLen, fn) {
  const original = fs.readFileSync(SW_ASM_PATH, 'utf8');
  const pattern = /^SW_STREAM_CHUNK = \d+(?=\s)/m;
  const occurrences = (original.match(pattern) || []).length;
  if (occurrences !== 1) throw new Error(`expected exactly one SW_STREAM_CHUNK definition, found ${occurrences}`);
  const patched = original.replace(pattern, `SW_STREAM_CHUNK = ${chunkLen}`);
  fs.writeFileSync(SW_ASM_PATH, patched);
  try {
    return fn();
  } finally {
    fs.writeFileSync(SW_ASM_PATH, original);
  }
}

// The two lua bodies, generated inline (no separate .template files -- both
// share the same substitution set as sw_nmi_deadline.lua.template, so they
// follow its own header comment for methodology/derivation rather than
// repeating it).
function stripOnlyLua(subs) {
  return `-- GENERATED by build_arb_fixtures.mjs (strip-only mode). Fix round 7,
-- decision A proof 1: the ARBITRATED nmi, with NOTHING queued in vram_buf
-- (vram_ready=0), running a ${'${'}WORKLOAD_LEN} -block streaming chunk alone.
-- Proves the compiled chunk size finishes inside real Mesen vblank timing
-- with no competing producer that vblank -- the "empty queue" half of
-- decision A's proof-1 requirement.
local NMI_RTI         = ${subs.NMI_RTI}
local MAIN_LOOP_READY = ${subs.MAIN_LOOP_READY}
local ST_ACTIVE_ADDR  = ${subs.ST_ACTIVE}
local ST_CUR_ADDR     = ${subs.ST_CUR}
local ST_LEN_ADDR     = ${subs.ST_LEN}
local ST_FTILE_ADDR   = ${subs.ST_FTILE}
local ST_FNT_ADDR     = ${subs.ST_FNT}
local ST_VARY_ADDR    = ${subs.ST_VARY}
local SBUF_ADDR       = ${subs.SBUF}
local VRAM_LEN  = 0x3c
local VRAM_READY = 0x3f
local WORKLOAD_LEN = ${subs.WORKLOAD_LEN}
local FTILE_VALUE = ${subs.FTILE_VALUE}
local FNT_VALUE = ${subs.FNT_VALUE}
local RUNUP_FRAMES = 400
local EXIT_TIMEOUT         = 99
local EXIT_STALE_ANCHOR    = 6
local EXIT_NEVER_ARMED     = 8
local EXIT_WORKLOAD_SHORT  = 7
local EXIT_DEADLINE_MISS   = 5
local VBLANK_FIRST_SCANLINE = 241
local VBLANK_LAST_SCANLINE  = 260
local DOTS_PER_SCANLINE     = 341
local PPU_DOTS_PER_CPU_CYCLE = 3
local RTI_REMAINING_CYCLES  = 6
local RTI_REMAINING_DOTS    = RTI_REMAINING_CYCLES * PPU_DOTS_PER_CPU_CYCLE

local frame = 0
local checkedAnchor = false
local armed = false
local checkedDeadline = false

local function log(message) emu.log(string.format("[%5d] %s", frame, message)) end
local function fail(code, message) log("FAIL: " .. message) emu.stop(code) end
local function pass(message) log("ok   " .. message) end
local function read(a) return emu.read(a, emu.memType.nesMemory) end
local function write(a, v) emu.write(a, v, emu.memType.nesMemory) end

local function checkAnchor()
  local nmiByte = read(NMI_RTI)
  if nmiByte ~= 0x40 then
    fail(EXIT_STALE_ANCHOR, string.format("byte at NMI_RTI (0x%04x) is 0x%02x, not rti", NMI_RTI, nmiByte))
    return false
  end
  pass(string.format("NMI_RTI anchor verified: 0x%04x is $40 (rti)", NMI_RTI))
  return true
end

local function armStripOnly()
  write(VRAM_LEN, 0)
  write(VRAM_READY, 0)      -- nothing queued this vblank -- the whole point
  write(ST_FTILE_ADDR, FTILE_VALUE)
  write(ST_FNT_ADDR, FNT_VALUE)
  write(ST_VARY_ADDR, 0)
  write(SBUF_ADDR + 0, 0)
  write(SBUF_ADDR + 1, 1)
  write(SBUF_ADDR + 2, 2)
  write(SBUF_ADDR + 3, 0)
  write(ST_CUR_ADDR, 0)
  write(ST_LEN_ADDR, WORKLOAD_LEN)
  write(ST_ACTIVE_ADDR, 1)
  armed = true
  pass(string.format("armed strip-only at main_loop_ready: vram_ready=0, st_active=1, st_len=%d", WORKLOAD_LEN))
end

local function onMainLoopReady()
  if armed or frame < RUNUP_FRAMES then return end
  armStripOnly()
end

local function onNmiRti()
  if not armed or checkedDeadline then return end
  checkedDeadline = true
  local state = emu.getState()
  local scanline = state["ppu.scanline"]
  local cycle = state["ppu.cycle"]
  local vramLen = read(VRAM_LEN)
  local stCur = read(ST_CUR_ADDR)
  log(string.format("nmi_rti reached: scanline=%d cycle=%d vram_len=%d st_cur=%d", scanline, cycle, vramLen, stCur))
  if vramLen ~= 0 then
    fail(EXIT_DEADLINE_MISS, string.format("vram_len should stay 0 (nothing queued), saw %d", vramLen))
    return
  end
  if stCur ~= WORKLOAD_LEN then
    fail(EXIT_WORKLOAD_SHORT, string.format("st_cur is %d, not %d -- the chunk did not actually run", stCur, WORKLOAD_LEN))
    return
  end
  if scanline < VBLANK_FIRST_SCANLINE or scanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("nmi_rti landed on scanline %d, outside vblank (%d-%d)", scanline, VBLANK_FIRST_SCANLINE, VBLANK_LAST_SCANLINE))
    return
  end
  local finishDot = cycle + RTI_REMAINING_DOTS
  local finishScanline = scanline
  while finishDot >= DOTS_PER_SCANLINE do
    finishDot = finishDot - DOTS_PER_SCANLINE
    finishScanline = finishScanline + 1
  end
  if finishScanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("rti's own remaining dots push past vblank (scanline %d -> %d)", scanline, finishScanline))
    return
  end
  pass(string.format("strip-only NMI finished at scanline %d, cycle %d (rti settles on scanline %d) -- inside vblank", scanline, cycle, finishScanline))
  emu.stop(0)
end

local function onFrame()
  frame = frame + 1
  if not checkedAnchor then
    checkedAnchor = true
    if not checkAnchor() then return end
  end
  if armed and not checkedDeadline and frame > RUNUP_FRAMES + 20 then
    fail(EXIT_NEVER_ARMED, "armed but no nmi_rti followed within 5 frames")
    return
  end
  if frame > 600 then
    fail(EXIT_TIMEOUT, "timed out waiting for nmi_rti after arming")
    return
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addMemoryCallback(onMainLoopReady, emu.callbackType.exec, MAIN_LOOP_READY)
emu.addMemoryCallback(onNmiRti, emu.callbackType.exec, NMI_RTI)
`;
}

function arbitrationLua(subs) {
  return `-- GENERATED by build_arb_fixtures.mjs (arbitration mode). Fix round 7,
-- decision A proof 1: the ARBITRATED nmi, with BOTH a worst-case two-packet
-- (70-byte) vram_buf drain queued AND a ${'${'}WORKLOAD_LEN} -block streaming chunk
-- armed. Proves the drain wins (vram_len drains to 0) and the strip YIELDS
-- (st_cur/st_active left exactly as armed, untouched) -- the "queue
-- non-empty -> drain runs, strip does not advance" half of decision A's
-- proof-1 requirement -- and that this drain-only-effectively NMI still
-- finishes inside vblank (a strict subset of the unconditional variant's own
-- workload, which the separate negative control proves misses).
local NMI_RTI         = ${subs.NMI_RTI}
local MAIN_LOOP_READY = ${subs.MAIN_LOOP_READY}
local ST_ACTIVE_ADDR  = ${subs.ST_ACTIVE}
local ST_CUR_ADDR     = ${subs.ST_CUR}
local ST_LEN_ADDR     = ${subs.ST_LEN}
local ST_FTILE_ADDR   = ${subs.ST_FTILE}
local ST_FNT_ADDR     = ${subs.ST_FNT}
local ST_VARY_ADDR    = ${subs.ST_VARY}
local SBUF_ADDR       = ${subs.SBUF}
local VRAM_LEN  = 0x3c
local VRAM_BUF  = 0x0400
local VRAM_READY = 0x3f
local EXPECTED_VRAM_LEN = 70
local WORKLOAD_LEN = ${subs.WORKLOAD_LEN}
local FTILE_VALUE = ${subs.FTILE_VALUE}
local FNT_VALUE = ${subs.FNT_VALUE}
local RUNUP_FRAMES = 400
local EXIT_TIMEOUT         = 99
local EXIT_STALE_ANCHOR    = 6
local EXIT_NEVER_ARMED     = 8
local EXIT_WORKLOAD_SHORT  = 7
local EXIT_DEADLINE_MISS   = 5
local EXIT_ARBITRATION_BROKEN = 4
local VBLANK_FIRST_SCANLINE = 241
local VBLANK_LAST_SCANLINE  = 260
local DOTS_PER_SCANLINE     = 341
local PPU_DOTS_PER_CPU_CYCLE = 3
local RTI_REMAINING_CYCLES  = 6
local RTI_REMAINING_DOTS    = RTI_REMAINING_CYCLES * PPU_DOTS_PER_CPU_CYCLE

local frame = 0
local checkedAnchor = false
local armed = false
local checkedDeadline = false

local function log(message) emu.log(string.format("[%5d] %s", frame, message)) end
local function fail(code, message) log("FAIL: " .. message) emu.stop(code) end
local function pass(message) log("ok   " .. message) end
local function read(a) return emu.read(a, emu.memType.nesMemory) end
local function write(a, v) emu.write(a, v, emu.memType.nesMemory) end

local function checkAnchor()
  local nmiByte = read(NMI_RTI)
  if nmiByte ~= 0x40 then
    fail(EXIT_STALE_ANCHOR, string.format("byte at NMI_RTI (0x%04x) is 0x%02x, not rti", NMI_RTI, nmiByte))
    return false
  end
  pass(string.format("NMI_RTI anchor verified: 0x%04x is $40 (rti)", NMI_RTI))
  return true
end

local function armBoth()
  local i = 0
  for pkt = 0, 1 do
    write(VRAM_BUF + i, 0x20); i = i + 1
    write(VRAM_BUF + i, 0x00); i = i + 1
    write(VRAM_BUF + i, 32); i = i + 1
    for b = 1, 32 do write(VRAM_BUF + i, 0xAA); i = i + 1 end
  end
  write(VRAM_BUF + i, 0)
  write(VRAM_LEN, EXPECTED_VRAM_LEN)
  write(VRAM_READY, 1)
  write(ST_FTILE_ADDR, FTILE_VALUE)
  write(ST_FNT_ADDR, FNT_VALUE)
  write(ST_VARY_ADDR, 0)
  write(SBUF_ADDR + 0, 0)
  write(SBUF_ADDR + 1, 1)
  write(SBUF_ADDR + 2, 2)
  write(SBUF_ADDR + 3, 0)
  write(ST_CUR_ADDR, 0)
  write(ST_LEN_ADDR, WORKLOAD_LEN)
  write(ST_ACTIVE_ADDR, 1)
  armed = true
  pass(string.format("armed BOTH at main_loop_ready: vram_len=%d, vram_ready=1, st_active=1, st_len=%d -- watching for arbitration", EXPECTED_VRAM_LEN, WORKLOAD_LEN))
end

local function onMainLoopReady()
  if armed or frame < RUNUP_FRAMES then return end
  armBoth()
end

local function onNmiRti()
  if not armed or checkedDeadline then return end
  checkedDeadline = true
  local state = emu.getState()
  local scanline = state["ppu.scanline"]
  local cycle = state["ppu.cycle"]
  local vramLen = read(VRAM_LEN)
  local stActive = read(ST_ACTIVE_ADDR)
  local stCur = read(ST_CUR_ADDR)
  log(string.format("nmi_rti reached: scanline=%d cycle=%d vram_len=%d st_active=%d st_cur=%d", scanline, cycle, vramLen, stActive, stCur))
  if vramLen ~= 0 then
    fail(EXIT_DEADLINE_MISS, string.format("the drain should have completed (vram_len=0), saw %d", vramLen))
    return
  end
  if stCur ~= 0 or stActive ~= 1 then
    fail(EXIT_ARBITRATION_BROKEN, string.format("the strip should NOT have advanced this vblank (st_cur=0, st_active=1 expected), saw st_cur=%d st_active=%d -- arbitration did not hold", stCur, stActive))
    return
  end
  if scanline < VBLANK_FIRST_SCANLINE or scanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("nmi_rti landed on scanline %d, outside vblank (%d-%d)", scanline, VBLANK_FIRST_SCANLINE, VBLANK_LAST_SCANLINE))
    return
  end
  local finishDot = cycle + RTI_REMAINING_DOTS
  local finishScanline = scanline
  while finishDot >= DOTS_PER_SCANLINE do
    finishDot = finishDot - DOTS_PER_SCANLINE
    finishScanline = finishScanline + 1
  end
  if finishScanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("rti's own remaining dots push past vblank (scanline %d -> %d)", scanline, finishScanline))
    return
  end
  pass(string.format("drain-wins NMI finished at scanline %d, cycle %d (rti settles on scanline %d) -- inside vblank, strip correctly deferred", scanline, cycle, finishScanline))
  emu.stop(0)
end

local function onFrame()
  frame = frame + 1
  if not checkedAnchor then
    checkedAnchor = true
    if not checkAnchor() then return end
  end
  if armed and not checkedDeadline and frame > RUNUP_FRAMES + 20 then
    fail(EXIT_NEVER_ARMED, "armed but no nmi_rti followed within 5 frames")
    return
  end
  if frame > 600 then
    fail(EXIT_TIMEOUT, "timed out waiting for nmi_rti after arming")
    return
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addMemoryCallback(onMainLoopReady, emu.callbackType.exec, MAIN_LOOP_READY)
emu.addMemoryCallback(onNmiRti, emu.callbackType.exec, NMI_RTI)
`;
}

function main() {
  withCompiledChunk(chunkLen, assembleOrThrow);
  const fnsText = fs.readFileSync(path.join(buildDir, 'main.fns'), 'utf8');
  const syms = fnsToMap(fnsText);
  for (const name of ['nmi_rti', 'main_loop_ready', 'sw_debug_addrs2']) {
    if (!Number.isFinite(syms[name])) throw new Error(`${name} missing from main.fns -- rebuild or check the include`);
  }

  const romBytesRaw = new Uint8Array(fs.readFileSync(path.join(buildDir, 'main.nes')));
  const projectJson = JSON.parse(fs.readFileSync(path.join(boardDir, 'project.json'), 'utf8'));
  const cartridge = projectJson.project?.cartridge ?? projectJson.cartridge;
  const mapper = MAPPERS.find((m) => m.id === cartridge.mapper);
  if (!mapper) throw new Error(`unknown mapper id ${cartridge.mapper}`);
  const patched = applyHeaderPatch(romBytesRaw.slice(), mapper, cartridge, true);

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(patched);

  function peekPairs(baseAddr, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const lo = emulator.peek(baseAddr + i * 2);
      const hi = emulator.peek(baseAddr + i * 2 + 1);
      out.push(lo | (hi << 8));
    }
    return out;
  }
  const [stActive, stCur, stLen, stFtile, stFnt, stVary, sbuf] = peekPairs(syms.sw_debug_addrs2, 7);

  fs.mkdirSync(outDir, { recursive: true });
  const romPath = path.join(outDir, 'sw_nmi_arb.nes');
  fs.writeFileSync(romPath, Buffer.from(patched));

  const subs = {
    NMI_RTI: `0x${syms.nmi_rti.toString(16)}`,
    MAIN_LOOP_READY: `0x${syms.main_loop_ready.toString(16)}`,
    ST_ACTIVE: `0x${stActive.toString(16)}`,
    ST_CUR: `0x${stCur.toString(16)}`,
    ST_LEN: `0x${stLen.toString(16)}`,
    ST_FTILE: `0x${stFtile.toString(16)}`,
    ST_FNT: `0x${stFnt.toString(16)}`,
    ST_VARY: `0x${stVary.toString(16)}`,
    SBUF: `0x${sbuf.toString(16)}`,
    WORKLOAD_LEN: String(workloadLen),
    FTILE_VALUE: String(ftileValue),
    FNT_VALUE: String(fntValue),
  };

  const stripOnlyPath = path.join(outDir, 'sw_nmi_arb_striponly.lua');
  fs.writeFileSync(stripOnlyPath, stripOnlyLua(subs), 'utf8');
  const arbitrationPath = path.join(outDir, 'sw_nmi_arb_both.lua');
  fs.writeFileSync(arbitrationPath, arbitrationLua(subs), 'utf8');

  console.log(`board: ${boardDirArg} (mapper ${mapper.name}), compiled SW_STREAM_CHUNK=${chunkLen}, workloadLen=${workloadLen}, parity=${parity}`);
  console.log(`rom: ${romPath}`);
  console.log(`strip-only lua: ${stripOnlyPath}`);
  console.log(`arbitration (both) lua: ${arbitrationPath}`);
  for (const [k, v] of Object.entries(subs)) console.log(`${k}: ${v}`);
}

main();

```

### `proto-tools/diag_r7_sustained_rate.mjs`, new this round -- fix round 7, decision A, proof 2 (real 6502 execution of sw_walk_step_x/y, cross-checked against the arithmetic model, plus the 5,000,000-frame window-lag simulation, both axes)

```javascript
// diag_r7_sustained_rate.mjs -- fix round 7, decision A, proof 2: proves the
// two per-axis subpixel-accumulator routines (sw_walk_step_x/y,
// minimal-u512/build/streamworld.asm) produce the EXACT periodic pixel-step
// sequence FALLEN STAR's own mechanism guarantees (a real 6502 call, not a
// reimplementation), then feeds that REAL sequence into a queueing
// simulation of the strip scheduler (one strip in flight at a time, a
// column strip costs 10 vblanks, a row strip costs 11) to report the
// worst-case window lag ever reached over a long continuous walk on each
// axis -- the number decision A's own "does this genuinely close" question
// needs, not a mean-rate argument alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

const nes = new NES({ onFrame: () => {}, emulateSound: false });
nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
for (let i = 0; i < 5; i++) nes.frame();
nes.mmap.write(0x2000, 0);

let failures = 0;
function check(name, cond) { if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

// ---- Part 1: real 6502 execution of sw_walk_step_x/y over enough frames to
// observe several full accumulator periods, cross-checked against the exact
// rational arithmetic model (both are the identical 8-bit add-with-carry;
// this proves the ASSEMBLED code matches the model, not merely that the
// model is internally consistent).
// callRoutine returns the cycle count, not A. Read A from the CPU object
// directly after each call instead.
function realStepsFromA(routineName, frames) {
  const steps = [];
  for (let i = 0; i < frames; i++) {
    callRoutine(nes, addr(routineName));
    steps.push(nes.cpu.REG_ACC);
  }
  return steps;
}

function modelSteps(speedSub, frames) {
  let acc = 0;
  const steps = [];
  for (let i = 0; i < frames; i++) {
    const na = acc + speedSub;
    if (na >= 256) { steps.push(2); acc = na - 256; } else { steps.push(1); acc = na; }
  }
  return steps;
}

const FRAMES_X = 4096; // 2048 full periods at SPEED_SUB=128 (period 2)
const FRAMES_Y = 320;  // 20 full periods at SPEED_SUB=112 (period 16)

const realX = realStepsFromA('sw_walk_step_x', FRAMES_X);
const modelX = modelSteps(128, FRAMES_X);
check(`sw_walk_step_x's real 6502 output matches the SW_SPEED_SUB_X=128 model exactly over ${FRAMES_X} frames`,
  realX.join(',') === modelX.join(','));
const sumX = realX.reduce((a, b) => a + b, 0);
check(`sw_walk_step_x sustained rate is exactly 1.5 px/frame (${sumX}px / ${FRAMES_X}f = ${(sumX / FRAMES_X).toFixed(4)})`,
  sumX === FRAMES_X * 1.5);

const realY = realStepsFromA('sw_walk_step_y', FRAMES_Y);
const modelY = modelSteps(112, FRAMES_Y);
check(`sw_walk_step_y's real 6502 output matches the SW_SPEED_SUB_Y=112 model exactly over ${FRAMES_Y} frames`,
  realY.join(',') === modelY.join(','));
const sumY = realY.reduce((a, b) => a + b, 0);
check(`sw_walk_step_y sustained rate is exactly 1.4375 px/frame (${sumY}px / ${FRAMES_Y}f = ${(sumY / FRAMES_Y).toFixed(4)})`,
  sumY === FRAMES_Y * 1.4375);

// ---- Part 2: worst-case single 16px crossing, from the REAL per-frame step
// sequence (all 256 accumulator phases), for both axes -- the number
// decision A's own "compare against the strip's fixed vblank cost" needs.
function worstCrossingFromRealSequence(routineName, need = 16) {
  // Reset the accumulator to each of the 256 possible phases and walk the
  // REAL routine until `need` pixels have accumulated, taking the max.
  const accAddr = routineName === 'sw_walk_step_x' ? 0x03d8 : 0x03d9;
  let worst = 0, worstPhase = 0;
  for (let phase = 0; phase < 256; phase++) {
    nes.cpu.mem[accAddr] = phase;
    let dist = 0, frames = 0;
    while (dist < need) {
      callRoutine(nes, addr(routineName));
      dist += nes.cpu.REG_ACC;
      frames++;
    }
    if (frames > worst) { worst = frames; worstPhase = phase; }
  }
  return { worst, worstPhase };
}
const worstX = worstCrossingFromRealSequence('sw_walk_step_x');
const worstY = worstCrossingFromRealSequence('sw_walk_step_y');
console.log(`sw_walk_step_x worst-case single 16px crossing (real 6502, all 256 phases): ${worstX.worst} frames (phase ${worstX.worstPhase})`);
console.log(`sw_walk_step_y worst-case single 16px crossing (real 6502, all 256 phases): ${worstY.worst} frames (phase ${worstY.worstPhase})`);
check('X worst-case crossing (11 frames) beats the column strip\'s own 10-vblank cost, real margin 1 frame', worstX.worst === 11);
check('Y worst-case crossing (12 frames) beats the row strip\'s own 11-vblank cost, real margin 1 frame', worstY.worst === 12);

// ---- Part 3: long-run window-lag simulation, driven by the REAL per-frame
// step sequence captured in part 1 but extended (the sequence is exactly
// periodic -- period 2 for X, period 16 for Y -- so replaying the real,
// 6502-verified period is equivalent to calling the routine 5,000,000
// times, at a fraction of the wall-clock cost, with no loss of fidelity).
function simulateLag(periodSteps, stripFrames, totalFrames) {
  const period = periodSteps.length;
  let pixelPos = 0, demand = 0, completed = 0, stripBusy = false, stripRemaining = 0, maxLag = 0;
  for (let f = 0; f < totalFrames; f++) {
    pixelPos += periodSteps[f % period];
    while (pixelPos >= 16) { pixelPos -= 16; demand += 1; }
    if (stripBusy) { stripRemaining -= 1; if (stripRemaining === 0) { stripBusy = false; completed += 1; } }
    if (!stripBusy && demand > completed) { stripBusy = true; stripRemaining = stripFrames; }
    const lag = demand - completed;
    if (lag > maxLag) maxLag = lag;
  }
  return maxLag;
}
const TOTAL = 5_000_000;
const lagX = simulateLag(modelX.slice(0, 2), 10, TOTAL); // period-2 real sequence [1,2] replayed
const lagY = simulateLag(realY.slice(0, 16), 11, TOTAL); // period-16 real sequence replayed
console.log(`X axis (column strip, 10 vblank): max window lag over ${TOTAL.toLocaleString()} frames = ${lagX} block(s)`);
console.log(`Y axis (row strip, 11 vblank), SW_SPEED_SUB_Y=112: max window lag over ${TOTAL.toLocaleString()} frames = ${lagY} block(s)`);
check('X axis window lag never exceeds 1 block over a 5,000,000-frame continuous walk (~23 hours held)', lagX <= 1);
check('Y axis (fixed, 112) window lag never exceeds 1 block over the same walk -- genuinely closes, not a mean-only argument', lagY <= 1);

// ---- Part 3b: reproduce the UNFIXED regression (SPEED_SUB_Y=128, i.e. the
// same rate as X) to show the real, non-hypothetical failure this round's
// fix replaces -- how fast the 8-block resync guard is actually reached.
function firstLagN(periodSteps, stripFrames, targetLag, maxFrames) {
  const period = periodSteps.length;
  let pixelPos = 0, demand = 0, completed = 0, stripBusy = false, stripRemaining = 0;
  for (let f = 0; f < maxFrames; f++) {
    pixelPos += periodSteps[f % period];
    while (pixelPos >= 16) { pixelPos -= 16; demand += 1; }
    if (stripBusy) { stripRemaining -= 1; if (stripRemaining === 0) { stripBusy = false; completed += 1; } }
    if (!stripBusy && demand > completed) { stripBusy = true; stripRemaining = stripFrames; }
    if (demand - completed >= targetLag) return f + 1;
  }
  return null;
}
const unfixedFrame = firstLagN(modelX.slice(0, 2), 11, 8, 20_000_000); // SAME 1.5px/frame sequence as X, but against the row strip's 11-vblank cost
console.log(`UNFIXED regression (vertical at 1.5 px/frame against the 11-vblank row strip) reaches the 8-block resync guard at frame ${unfixedFrame} (~${(unfixedFrame / 60).toFixed(1)}s of continuous walking)`);
check('the unfixed regression is real and reached quickly (< 5,000 frames), not a hypothetical worst case', unfixedFrame !== null && unfixedFrame < 5000);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);

```

### `proto-tools/diag_r7_dialogue_accessor.mjs`, new this round -- fix round 7, decision B's own proof (sw_dlg_metatile vs. an independently-resolved direct sw_terrain_or_fill call, seven wrap/fill cases)

```javascript
// diag_r7_dialogue_accessor.mjs -- fix round 7, decision B's own proof:
// sw_dlg_metatile (minimal-u512/build/streamworld.asm, assembled into the
// never-shipped bank-14 test slot, PRG register 7) resolves an explicit
// dialogue-box origin + a metatile position WITHIN the box's own 16-wide/
// 3-tall band to the SAME real terrain byte sw_terrain_or_fill itself
// reaches when called DIRECTLY with the independently-computed
// (screenCol,screenRow,offset) -- proving the new coordinate math, not
// re-proving sw_terrain_or_fill's own already-proven read/fill behaviour
// (diag_r5_fill.mjs). Uses the SAME 3x3 r2 fixture diag_r5_fill.mjs uses
// (sw_base_bank=2, sw_regions_per_row=1, sw_grid_w=sw_grid_h=3), whose own
// screenBytes() generator (build_r2_fixture.mjs) gives every offset of
// every screen a DISTINCT, marker-dependent value -- so a coordinate bug
// landing on the wrong screen OR the wrong offset is caught, not masked by
// a uniform fixture.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

// sw_col/.../sw_grid_h chain off msg_name_idx+1, same as diag_r5_fill.mjs.
const RAM = {};
{
  let a = 0x59f;
  for (const n of ['sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi', 'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h']) {
    a += 1; RAM[n] = a;
  }
}
// sw_dlg_* are real, literal `= $03Dx` equates in streamworld.asm --
// EVERY `=` equate in this prototype is absent from main.fns (nesasm's -s
// dump is label-only), the same reason sw_fill_metatile_id above needs the
// indirect sw_debug_addrs2 lookup. These four are plain, non-expression
// literals, so unlike sw_fill_metatile_id they need no such lookup -- the
// literal value written in streamworld.asm's own RAM map is trustworthy
// here precisely because a mismatch would make EVERY case below fail
// (there is no expression to silently drift).
const OCOL = 0x03dc;
const OLCOL = 0x03dd;
const OROW = 0x03de;
const OLROW = 0x03df;

const SW_DLG_METATILE = addr('sw_dlg_metatile'); // $8600, PRG register 7 ($8000-$9FFF)
const SW_TERRAIN_OR_FILL = addr('sw_terrain_or_fill'); // kernel-lo, permanently mapped

function freshNes() {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame();
  nes.mmap.write(0x2000, 0);
  return nes;
}

function setup3x3(nes, fillId = 42) {
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_grid_w] = 3;
  nes.cpu.mem[RAM.sw_grid_h] = 3;
  // sw_fill_metatile_id resolved the same indirect way diag_r5_fill.mjs
  // does (sw_run_len+1+8 -- an expression equate, absent from main.fns).
  const dbg2 = addr('sw_debug_addrs2');
  const lo = nes.cpu.loadFromCartridge(dbg2 + 8 * 2);
  const hi = nes.cpu.loadFromCartridge(dbg2 + 8 * 2 + 1);
  const SW_FILL_METATILE_ID = (lo | (hi << 8)) + 1 + 8;
  nes.cpu.mem[SW_FILL_METATILE_ID] = fillId;
}

// Reaches bank-14/register-7's own $8600 -- must select PRG register 7
// first (switch_prg_bank, the same real routine sw_run_bank_test itself
// goes through -- not a raw mmap poke) or the CPU fetches whatever the
// FIELD's current screen bank left mapped at $8000-$9FFF instead.
function callDlgMetatile(nes, boxCol, boxRow) {
  nes.cpu.REG_ACC = 7;
  callRoutine(nes, addr('switch_prg_bank'));
  nes.cpu.REG_ACC = boxCol;
  nes.cpu.REG_X = boxRow;
  callRoutine(nes, SW_DLG_METATILE);
  return nes.cpu.REG_ACC;
}

function callTerrainOrFill(nes, screenCol, screenRow, offset) {
  nes.cpu.REG_ACC = screenCol;
  nes.cpu.REG_X = screenRow;
  nes.cpu.REG_Y = offset;
  callRoutine(nes, SW_TERRAIN_OR_FILL);
  return nes.cpu.REG_ACC;
}

// The independent JS model of what sw_dlg_metatile itself computes --
// verified separately (/tmp/dlg_check.mjs during development) before any
// 6502 was written, so this is a SECOND, independent statement of the same
// rule, not a copy of the implementation.
function resolve(ocol, olcol, orow, olrow, boxCol, boxRow) {
  let lc = olcol + boxCol, sc = ocol;
  if (lc >= 16) { lc -= 16; sc += 1; }
  let lr = olrow + 12 + boxRow, sr = orow;
  if (lr >= 15) { lr -= 15; sr += 1; }
  return { screenCol: sc & 255, screenRow: sr & 255, offset: (lr * 16 + lc) & 255 };
}

let failures = 0;
function check(name, cond) { if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

const CASES = [
  // label, ocol, olcol, orow, olrow, boxCol, boxRow
  ['no wrap, origin (0,0,0,0), box (0,0) -- lands on screen (0,0) local(0,12)', 0, 0, 0, 0, 0, 0],
  ['no wrap, box (15,2) -- lands on screen (0,0) local(15,14), the box\'s own far corner', 0, 0, 0, 0, 15, 2],
  ['column wrap only: origin localCol=15, box col=1 -- screenCol+1', 0, 15, 0, 0, 1, 0],
  ['row wrap only: origin localRow=3, box row=0 -- 3+12=15 -> screenRow+1, local 0', 0, 0, 0, 3, 0, 0],
  ['both axes wrap at once: origin localCol=15/localRow=3, box (1,0)', 1, 15, 1, 3, 1, 0],
  ['origin already mid-grid, no wrap: origin screen(1,1) local(5,5), box(3,1)', 1, 5, 1, 5, 3, 1],
  ['origin at the grid\'s own far edge, wraps OUT of the 3x3 grid -> fill', 2, 15, 2, 3, 1, 2],
];

console.log('=== sw_dlg_metatile vs. an independently-resolved direct sw_terrain_or_fill call (3x3 r2 fixture) ===');
for (const [label, ocol, olcol, orow, olrow, boxCol, boxRow] of CASES) {
  const nesA = freshNes();
  setup3x3(nesA);
  nesA.cpu.mem[OCOL] = ocol; nesA.cpu.mem[OLCOL] = olcol;
  nesA.cpu.mem[OROW] = orow; nesA.cpu.mem[OLROW] = olrow;
  const got = callDlgMetatile(nesA, boxCol, boxRow);

  const expectedCoord = resolve(ocol, olcol, orow, olrow, boxCol, boxRow);
  const nesB = freshNes();
  setup3x3(nesB);
  const want = callTerrainOrFill(nesB, expectedCoord.screenCol, expectedCoord.screenRow, expectedCoord.offset);

  console.log(`  ${label}: resolved (${expectedCoord.screenCol},${expectedCoord.screenRow})+${expectedCoord.offset} -> sw_dlg_metatile=${got}, direct=${want}`);
  check(label, got === want);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);

```
### `proto-tools/diag_r8_unaligned_parity.mjs`, new this round -- fix round 8, finding 9's own unaligned/all-parity sw_render_window regression (56 independent observations, real 3x3 fixture)

```javascript
// diag_r8_unaligned_parity.mjs -- fix round 8, finding 9: extends T8
// (verify_torus.mjs), which only ever exercised ONE unaligned/parity
// combination (screenCol=1,screenRow=1, local=0 -- an ALIGNED odd/odd
// origin), to real UNALIGNED local offsets on top of every one of the 4
// origin parities the fixture's own 3x3 grid can hold without reading past
// its own populated data (an origin screen of 2 would need screen 3,
// unpopulated -- this round's own finding-3 work found that a nonzero
// local offset can genuinely touch a THIRD screen, so origins are kept at
// {0,1} on each axis so the window's own 2-screen span plus a local
// overflow never exceeds the fixture's own 3x3 extent).
//
// SCOPE, disclosed honestly: this is NOT the reviewer's own full
// 52,224-comparison exhaustive sweep (every torus tile at every parity/
// local combination) -- it is a real, meaningful expansion (4 parities x 4
// representative local offsets per axis x a representative point per
// nametable, all independently computed, not just the single aligned
// odd/odd point T8 already covers), not the maximal one. The independent
// oracle is `sw_col_at_offset`/`sw_row_at_offset`'s own formula (read
// directly from streamworld.asm, transcribed here in JS, not re-derived
// from the render routine's own output) feeding `sw_terrain_or_fill`'s own
// INDEPENDENTLY PROVEN accessor (diag_r5_fill.mjs, diag_r7/r8's own reuse)
// for the expected byte -- so the render routine and the expected-value
// computation never share the same code path for the actual READ, only
// for the coordinate DECOMPOSITION (disclosed, not hidden).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

const RAM = {};
{
  let a = 0x59f;
  for (const n of ['sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi', 'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h', 'sw_tmp', 'sw_tmp2', 'sw_tmp3', 'sw_tmp4', 'sw_tmp5', 'sw_tmp6', 'win_col_screen', 'win_col_local', 'win_row_screen', 'win_row_local']) {
    a += 1; RAM[n] = a;
  }
}

function freshNes() {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame();
  nes.mmap.write(0x2000, 0);
  return nes;
}

// callRoutine's own 20,000-step watchdog is too tight for a full render
// (T8's own note: it needs a slower cap) -- mirror verify_torus.mjs's own
// callRoutineSlow.
function callRoutineSlow(nes, address) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let cycles = 0, steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    cycles += nes.cpu.emulate();
    if (++steps >= 2_000_000) throw new Error('sw_render_window never returned to the stub');
  }
  return cycles;
}

// Independent oracle: sw_col_at_offset/sw_row_at_offset's own formula,
// transcribed directly from streamworld.asm (not re-derived from
// sw_render_window's own behaviour):
//   colTotal = delta + win_col_local; localCol = colTotal & 15;
//   screenCol = win_col_screen + (colTotal >> 4)
//   rowTotal = delta + win_row_local; localRow = rowTotal mod 15 (repeated subtract);
//   screenRow = win_row_screen + floor(rowTotal / 15)
function colAtOffset(delta, winColScreen, winColLocal) {
  const total = delta + winColLocal;
  return { screenCol: winColScreen + (total >> 4), localCol: total & 15 };
}
function rowAtOffset(delta, winRowScreen, winRowLocal) {
  let total = delta + winRowLocal;
  let screenRowAdd = 0;
  while (total >= 15) { total -= 15; screenRowAdd += 1; }
  return { screenRow: winRowScreen + screenRowAdd, localRow: total };
}
// wbase: the window's own ring-relative origin (sw_rw_wbase_col/row).
function wbaseCol(winColScreen, winColLocal) { return (winColScreen & 1) * 16 + winColLocal; }
function wbaseRow(winRowScreen, winRowLocal) { return (winRowScreen & 1) * 15 + winRowLocal; }
// physical torus position (0-31 col / 0-29 row) -> window-relative delta,
// via sw_rw_col_delta/sw_rw_row_delta's own wrap.
function colDelta(torusCol, winColScreen, winColLocal) {
  return (((torusCol - wbaseCol(winColScreen, winColLocal)) % 32) + 32) % 32;
}
function rowDelta(torusRow, winRowScreen, winRowLocal) {
  let d = (((torusRow - wbaseRow(winRowScreen, winRowLocal)) % 30) + 30) % 30;
  return d;
}
function expectedScreenLocal(torusCol, torusRow, winColScreen, winColLocal, winRowScreen, winRowLocal) {
  const cd = colDelta(torusCol, winColScreen, winColLocal);
  const rd = rowDelta(torusRow, winRowScreen, winRowLocal);
  const { screenCol, localCol } = colAtOffset(cd, winColScreen, winColLocal);
  const { screenRow, localRow } = rowAtOffset(rd, winRowScreen, winRowLocal);
  return { screenCol, localCol, screenRow, localRow };
}

let failures = 0;
let observations = 0;
function check(name, cond) { observations++; if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

function readExpectedTerrain(nes, screenCol, screenRow, localCol, localRow) {
  // sw_terrain_or_fill: A=screenCol, X=screenRow, Y=offset(=localRow*16+localCol)
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_grid_w] = 3;
  nes.cpu.mem[RAM.sw_grid_h] = 3;
  nes.cpu.REG_ACC = screenCol;
  nes.cpu.REG_X = screenRow;
  nes.cpu.REG_Y = localRow * 16 + localCol;
  callRoutine(nes, addr('sw_terrain_or_fill'));
  return nes.cpu.REG_ACC;
}

// Torus physical position (0,0) of each of the 4 nametables, in blocks:
// NT0=(0,0), NT1=(16,0), NT2=(0,15), NT3=(16,15) -- matches T8's own
// ntBase ordering (NT0/1/2/3 -> $2000/$2400/$2800/$2C00).
const NT_TORUS_ORIGIN = [[0, 0], [16, 0], [0, 15], [16, 15]];
const ntBase = [0x2000, 0x2400, 0x2800, 0x2c00];

function renderAndCheck(winColScreen, winColLocal, winRowScreen, winRowLocal, label) {
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.win_col_screen] = winColScreen;
  nes.cpu.mem[RAM.win_col_local] = winColLocal;
  nes.cpu.mem[RAM.win_row_screen] = winRowScreen;
  nes.cpu.mem[RAM.win_row_local] = winRowLocal;
  // Current-field-screen state for sw_locate_current's own end-of-render
  // restore -- set to match the window's own origin screen, as T8 does.
  nes.cpu.mem[RAM.sw_col] = winColScreen;
  nes.cpu.mem[RAM.sw_row] = winRowScreen;
  nes.cpu.mem[RAM.sw_col_rem] = winColScreen;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = (338 * winColScreen) & 0xff;
  nes.cpu.mem[RAM.sw_col_byte_hi] = ((338 * winColScreen) >> 8) & 0xff;
  nes.cpu.mem[RAM.sw_row_bank_base] = winRowScreen;

  callRoutineSlow(nes, addr('sw_render_window'));

  // Check block (0,0) of each nametable (matching T8's own point) PLUS one
  // more representative interior point per nametable (block (3,3)) -- 8
  // real, independently-computed comparisons per parity/local combination.
  for (const [nt, [tc0, tr0]] of NT_TORUS_ORIGIN.entries()) {
    for (const [dc, dr] of [[0, 0], [3, 3]]) {
      const torusCol = tc0 + dc, torusRow = tr0 + dr;
      const exp = expectedScreenLocal(torusCol, torusRow, winColScreen, winColLocal, winRowScreen, winRowLocal);
      const expectedByte = readExpectedTerrain(freshNesForRead(), exp.screenCol, exp.screenRow, exp.localCol, exp.localRow);
      // vramMem tile row = torusRow*2 (each block is 2x2 tiles), col = torusCol*2 -- read the TL tile id, which for this fixture's own mt_tl table equals the metatile id itself only if mt_tl[x]=x; instead read back via the metatile id indirectly is not possible from vramMem alone, so this check reads mt_tl[id] through the SAME expected-id path used elsewhere in this suite (T1/T8): the marker IS both the metatile id and (by fixture construction) directly comparable, since mt_tl,mt_tr,mt_bl,mt_br tables in this build's own fixture are identity-mapped for ids used here (T8's own check divides by 4 for the attribute palette only; the raw tile id equality already holds for T1/T3/T8 above without a table lookup, so it holds here too).
      const ntBaseAddr = ntBase[nt];
      const withinNtRow = torusRow - tr0;
      const withinNtCol = torusCol - tc0;
      const tileAddr = ntBaseAddr + (withinNtRow * 2) * 32 + (withinNtCol * 2);
      const actualByte = nes.ppu.vramMem[tileAddr];
      check(`${label} NT${nt} block(${dc},${dr}) torus(${torusCol},${torusRow}) -> screen(${exp.screenCol},${exp.screenRow}) local(${exp.localCol},${exp.localRow}) expected=${expectedByte} actual=${actualByte}`, actualByte === expectedByte);
    }
  }
}
function freshNesForRead() {
  const nes = freshNes();
  return nes;
}

console.log('=== fix round 8, finding 9: unaligned x all-parity render_window regression ===');
// All 4 origin parities, local=0 (T8 already proves (1,1); this proves the
// other 3 for the first time) plus 3 unaligned local offsets each, kept
// in-bounds for the 3x3 fixture (origin screens restricted to {0,1}).
// Pass 1: all four origin parities, ALIGNED (local=0) -- (1,0) and (0,1)
// are genuinely new; (0,0) and (1,1) were already covered by T1/T8 and are
// re-checked here as a consistency cross-check against the SAME independent
// oracle this round's own new script uses (not merely trusting the older
// tests' own hand-derived expectations again).
for (const [oc, or_] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
  renderAndCheck(oc, 0, or_, 0, `origin(${oc},${or_}) local(0,0) [aligned parity sweep]`);
}
// Pass 2: a deep UNALIGNED sweep at the one origin (0,0) where a local
// overflow (this round's own real "a strip/window can touch a third
// screen when local != 0" finding, §5/finding 2, §10 decision A) never
// exceeds the fixture's own 3x3 extent -- every other origin's own
// unaligned case would read screens the fixture never populated, which
// sw_render_window (unlike sw_terrain_or_fill) does not fill-guard at all
// (finding 2's own still-open complaint), so it is not this test's job to
// re-litigate that separate, already-named gap.
for (const [lc, lr] of [[1, 1], [7, 7], [14, 13]]) {
  renderAndCheck(0, lc, 0, lr, `origin(0,0) local(${lc},${lr}) [unaligned sweep, in-bounds]`);
}

console.log(`\n${observations} observations, ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);

```
### `proto-tools/build_unconditional_board.mjs`, new this round -- fix round 8 housekeeping: reproducibly builds decision A's own historical unconditional-NMI negative control under the scratch tree, replacing fix 7's own ad hoc /tmp copies

```javascript
#!/usr/bin/env node
// build_unconditional_board.mjs -- fix round 8 housekeeping: reproduces
// decision A's own historical negative control (the pre-arbitration NMI,
// where sw_nmi_stream ran unconditionally regardless of a pending
// vram_buf drain) from the scratch tree, not an ad hoc /tmp copy fix
// round 7 left behind. Reverts exactly the two lines the real arbitration
// splice changed in a fresh copy of the named board, leaving everything
// else (including this round's own additions to that board, if any)
// untouched.
//
//   node proto-tools/build_unconditional_board.mjs <boardName> <outName>
//   e.g. node proto-tools/build_unconditional_board.mjs sample-u512 unconditional-u512
//        node proto-tools/build_unconditional_board.mjs sample-mmc3 unconditional-mmc3
//
// Then assemble/patch/test exactly as any other board:
//   cd <outName>/build && nesasm -s main.asm
//   (apply applyHeaderPatch, then run against sw_nmi_deadline.lua.template
//    via build_deadline_fixture.mjs, which already accepts any boardDir)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [, , boardName, outName] = process.argv;
if (!boardName || !outName) {
  console.error('usage: node proto-tools/build_unconditional_board.mjs <boardName> <outName>');
  process.exit(2);
}
const SRC = path.join(ROOT, boardName);
const DST = path.join(ROOT, outName);

function main() {
  fs.rmSync(DST, { recursive: true, force: true });
  fs.cpSync(SRC, DST, { recursive: true });

  const bootPath = path.join(DST, 'build', 'boot.asm');
  let text = fs.readFileSync(bootPath, 'utf8');

  const arbitratedBlock = /  jmp nmi_scroll             ; decision A \(fix round 7\): the drain ran\n(?:.*\n)*?  nmi_no_drain:\n  jsr sw_nmi_stream           ; nothing else touched vram_buf this vblank\n(?:.*\n)*?\nnmi_scroll:\n/;
  const match = text.match(arbitratedBlock);
  if (!match) throw new Error('arbitrated NMI block not found -- boot.asm changed shape since this script was written');
  const unconditionalReplacement =
    '  ; UNCONDITIONAL variant (fix round 7/8\'s own negative control, never\n' +
    '  ; shipped): the pre-arbitration R4 prototype hook -- sw_nmi_stream always\n' +
    '  ; runs, drain or no drain -- kept ONLY to prove decision A\'s arbitration is\n' +
    '  ; actually load-bearing (drain+chunk misses the vblank deadline together).\n' +
    '  jsr sw_nmi_stream\n\nnmi_scroll:\n';
  text = text.replace(arbitratedBlock, unconditionalReplacement);

  const branchPattern = /beq nmi_no_drain           ; skipping leaves the writes for the next vblank/;
  if (!branchPattern.test(text)) throw new Error('arbitration branch not found');
  text = text.replace(branchPattern, 'beq nmi_scroll              ; skipping leaves the writes for the next vblank');

  fs.writeFileSync(bootPath, text);

  const buildDir = path.join(DST, 'build');
  const result = execFileSync('nesasm', ['-s', 'main.asm'], { cwd: buildDir, encoding: 'utf8' });
  if (/\berror\b/i.test(result) || /bank overflow/i.test(result)) {
    throw new Error(`nesasm reported a real diagnostic:\n${result}`);
  }
  console.log(`${outName} rebuilt from ${boardName} with the unconditional (pre-arbitration) NMI hook, assembled clean.`);
}

main();

```
### `proto-tools/build_r2_fixture.mjs` (the fixture builder, in full -- this round: widened to 3x3 screens, closing review 3 finding 2's own overread)

```js
// build_r2_fixture.mjs -- fix round 4: 3x3 screens (widened again from
// round 3's own 2x3), because review 3 finding 2 found the 2x3 fixture
// still overread past screen column 2 for the R2 attribute test's own
// window origin (col local=1) -- a window origin at local offset 1 needs
// its own resident torus to reach one screen further right than its own
// starting screen, exactly as a local-offset-1 row origin already needed
// one screen further down (round 3's own fix). 3x3 is the minimum square
// that supports local=1 on BOTH axes at once, which review 3's own R2 test
// origin (col local=1, row local=1) needs simultaneously.
import fs from 'node:fs';

function screenBytes(marker) {
  const bytes = new Array(338).fill(0);
  bytes[0] = marker;
  for (let i = 1; i < 240; i++) bytes[i] = (i * 5 + marker) % 64;
  return bytes;
}
function dbBlock(arr, perLine = 16) {
  const lines = [];
  for (let i = 0; i < arr.length; i += perLine) {
    lines.push('  .db ' + arr.slice(i, i + perLine).map((v) => '$' + v.toString(16).toUpperCase().padStart(2, '0')).join(','));
  }
  return lines.join('\n');
}

// Region layout: sw_base_bank=2, sw_regions_per_row=1 -- one region (one
// nesasm bank) per screen ROW, all 3 columns of that row packed into the
// SAME region (3*338=1014 bytes, comfortably under the 8176-byte region
// budget and under STREAM_SCREENS_PER_REGION=24 screens/region). Row 0 ->
// bank 2 ($8000 half), row 1 -> bank 3 ($A000 half; region index
// base_bank+row*regions_per_row = 2+1=3), row 2 -> bank 4 ($8000 half,
// region index 2+2=4).
const rows = [
  { bank: 2, org: '$8000', markers: [1, 2, 3] },
  { bank: 3, org: '$A000', markers: [11, 12, 13] },
  { bank: 4, org: '$8000', markers: [21, 22, 23] }
];

const out = [];
for (const row of rows) {
  out.push(`  .bank ${row.bank}`, `  .org ${row.org}`);
  row.markers.forEach((marker, col) => {
    if (col > 0) out.push(`  .org ${row.org}+${col * 338}`);
    out.push(`sw_r2_r${rows.indexOf(row)}c${col}:`, dbBlock(screenBytes(marker)));
  });
}
out.push('');
fs.writeFileSync(process.argv[2], out.join('\n'));
console.log('wrote', process.argv[2]);
```

### `proto-tools/verify_torus.mjs` (the full jsnes/callRoutine verification suite, 61 checks, all passing -- this round: T3 derives its own NMI-count expectation from `sw_debug_chunk`, the real compiled `SW_STREAM_CHUNK`, instead of a hardcoded '10', review 5 finding 10)

```js
// verify_torus.mjs -- fix-round-2 verification using this project's own
// jsnes core + test/lib/callroutine.js technique (the identical approach
// camera.test.js/rpg.test.js already use for isolated routine calls),
// rather than Mesen's Lua sandbox -- much faster to iterate and fully
// scriptable. Mesen is reserved for the final NMI-deadline timing proof
// (CLAUDE.md: "Mesen, not jsnes, is the authority on vblank timing"), not
// needed for FUNCTIONAL correctness of the addressing/torus mechanism.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

// sw_render_window makes many cold-path sw_goto calls (each its own
// division/multiply loop), which legitimately takes well over
// callRoutine's own 20000-step ceiling under jsnes's per-opcode emulate()
// stepping (measured: ~210000 steps for one full four-nametable render).
// This is a real cost of the cold path, not a bug -- a raised local limit,
// not a change to the shared test helper other files also rely on.
function callRoutineSlow(nes, address, maxSteps = 1000000) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    nes.cpu.emulate();
    if (++steps >= maxSteps) throw new Error('routine never returned to the stub (slow)');
  }
  return steps;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');

const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!(name in symbols)) throw new Error(`symbol not found: ${name}`);
  return symbols[name];
}

// Hand-resolved RAM equates (nesasm's -s dump does not emit RAM equates --
// confirmed empirically both rounds). msg_name_idx = $059F.
const RAM = {};
{
  let a = 0x59f;
  const names = [
    'sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi',
    'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h',
    'sw_tmp', 'sw_tmp2', 'sw_tmp3', 'sw_tmp4', 'sw_tmp5', 'sw_tmp6',
    'win_col_screen', 'win_col_local', 'win_row_screen', 'win_row_local',
    'st_active', 'st_cur', 'st_len', 'st_ftile', 'st_fnt', 'st_vary', 'ss_i'
  ];
  for (const n of names) { a += 1; RAM[n] = a; }
  RAM.sbuf = RAM.ss_i + 1; // 32 bytes
}

let failures = 0;
function check(name, actual, expected) {
  if (actual !== expected) {
    failures++;
    console.log(`FAIL ${name}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`ok   ${name} = ${actual}`);
  }
}

function freshNes() {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame(); // past reset/mapper_init/chr_ram_init
  return nes;
}

function pokeAB(nes, aVal, xVal, routine) {
  nes.cpu.REG_ACC = aVal;
  nes.cpu.REG_X = xVal;
  return callRoutine(nes, addr(routine));
}

// --------------------------------------------------------------------------
// Test 1: sw_stream_start_col arming, aligned window (0,0,0,0), entering
// screenCol=0, localCol=0 -- the simplest case. Fixture: sw_r2_r0c0 marker=1
// at screen(0,0), sw_r2_r1c0 marker=11 at screen(0,1) (row=1). Reading world
// row 0..29 at column (screenCol=0, localCol=0):
//   world rows 0-14 -> screen(0,0), localRow 0-14
//   world rows 15-29 -> screen(1,0)... wait row axis: screenRow=1 means the
//   SECOND row of screens, which in this fixture is sw_r2_r1c0 (marker=11).
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.win_col_screen] = 0;
  nes.cpu.mem[RAM.win_col_local] = 0;
  nes.cpu.mem[RAM.win_row_screen] = 0;
  nes.cpu.mem[RAM.win_row_local] = 0;
  nes.cpu.mem[RAM.sw_col] = 0;
  nes.cpu.mem[RAM.sw_row] = 0;
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;

  pokeAB(nes, 0, 0, 'sw_stream_start_col'); // screenCol=0, localCol=0

  check('T1 st_ftile', nes.cpu.mem[RAM.st_ftile], 0); // localCol*2 = 0
  check('T1 st_fnt', nes.cpu.mem[RAM.st_fnt], 0); // (screenCol&1)*4 = 0
  check('T1 st_vary (start)', nes.cpu.mem[RAM.st_vary], 0); // win_row_screen&1=0, local=0
  check('T1 st_active', nes.cpu.mem[RAM.st_active], 1);
  check('T1 st_len', nes.cpu.mem[RAM.st_len], 30);
  // sbuf[0] should be world row 0 = screen(0,0) local(0,0) = marker 1
  check('T1 sbuf[0]', nes.cpu.mem[RAM.sbuf + 0], 1);
  // sbuf[14] = screen(0,0) local(14,0): offset=14*16+0=224, (224*5+1)%64=(1120+1)%64=1121%64=1
  check('T1 sbuf[14]', nes.cpu.mem[RAM.sbuf + 14], (224 * 5 + 1) % 64);
  // sbuf[15] = screen(1,0) local(0,0) = marker 11 (row crosses into screen row 1)
  check('T1 sbuf[15]', nes.cpu.mem[RAM.sbuf + 15], 11);
  // sbuf[29] = screen(1,0) local(14,0): offset=224, (224*5+11)%64=(1120+11)%64=1131%64=11
  check('T1 sbuf[29]', nes.cpu.mem[RAM.sbuf + 29], (224 * 5 + 11) % 64);
}

// --------------------------------------------------------------------------
// Test 2: the reviewer's own repro shape, adapted to the NEW interface --
// arm a ROW strip whose entering edge is screenRow=1 (odd -- bottom half),
// localRow=14 (the LAST local row of that screen), and confirm st_fnt/
// st_ftile/st_vary are all correct and that drawing the first block lands
// in nametable space, never attribute space ($23xx).
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.win_col_screen] = 0;
  nes.cpu.mem[RAM.win_col_local] = 0;
  nes.cpu.mem[RAM.win_row_screen] = 0;
  nes.cpu.mem[RAM.win_row_local] = 0;
  nes.cpu.mem[RAM.sw_col] = 0;
  nes.cpu.mem[RAM.sw_row] = 0;
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;

  pokeAB(nes, 1, 14, 'sw_stream_start_row'); // screenRow=1 (odd), localRow=14

  check('T2 st_ftile', nes.cpu.mem[RAM.st_ftile], 28); // localRow*2 = 28
  check('T2 st_fnt', nes.cpu.mem[RAM.st_fnt], 8); // (screenRow&1)*8 = 8
  check('T2 st_vary (start)', nes.cpu.mem[RAM.st_vary], 0); // win_col_screen&1=0, local=0

  // Draw the first block (st_cur=0, st_vary still 0 from arming) directly
  // and confirm the write lands at the hand-computed physical tile address,
  // and NOT anywhere in attribute space. For a ROW strip at st_vary=0
  // (<16 -> left half): tileCol=0*2=0, nt=st_fnt(8). st_ftile(28) is the
  // FIXED tile row. addrHi = $20 + (28>>3) + 8 = $20+3+8 = $2B, addrLo =
  // ((28&7)<<5)|0 = $80 -- $2B80, inside nametable 2's own tile space
  // (base $2800, offset $380 = tile row 28), never $2BC0-$2BFF (that NT's
  // own attribute table) the way round 1/2's bug would have produced.
  nes.cpu.mem[RAM.sbuf + 0] = 5; // a known, recognisable metatile id
  nes.cpu.mem[RAM.st_cur] = 0;
  callRoutine(nes, addr('sw_ns_draw_block'));
  const expectedHi = 0x2b, expectedLo = 0x80;
  const writtenTile = nes.ppu.vramMem[expectedHi * 256 + expectedLo];
  check('T2 tile landed at $2B80 (mt_tl[5], not attribute space)', writtenTile, 5);
  const attrByte = nes.ppu.vramMem[0x2bc0];
  check('T2 attribute space ($2BC0) untouched by this draw', attrByte, 0);
}


// --------------------------------------------------------------------------
// Test 3 -- R1/R15's own explicit demand: drive SUCCESSIVE strips through
// COMPLETED NMIs (not a single forced-blank shot), in more than one
// direction, and confirm retained content keeps its physical slot while
// only the entering edge changes -- the actual ring-buffer property F2/R1
// exists to prove. Sequence: arm a column strip (screenCol=0,localCol=0),
// drain it fully via repeated sw_nmi_stream calls (simulating one NMI per
// call), confirm torus column 0's own physical tiles are correct; then
// cross right (sw_cross_right) and arm the NEW entering edge
// (screenCol=1,localCol=0 -- still inside screen 0 since STREAM_SCREENS_
// PER_REGION=24 and localCol wraps at 16, not the region boundary), drain
// it, and confirm BOTH the old column's own physical tiles (still there,
// untouched) AND the new column's own tiles are correct simultaneously --
// proving retention, not just fresh-every-time correctness.
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.win_col_screen] = 0;
  nes.cpu.mem[RAM.win_col_local] = 0;
  nes.cpu.mem[RAM.win_row_screen] = 0;
  nes.cpu.mem[RAM.win_row_local] = 0;
  nes.cpu.mem[RAM.sw_col] = 0;
  nes.cpu.mem[RAM.sw_row] = 0;
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;

  // Review 5, finding 10: derive the expected NMI count from the COMPILED
  // SW_STREAM_CHUNK (sw_debug_chunk, a real ROM byte, not a second
  // hardcoded literal that can drift -- this is exactly what went wrong
  // last round, when the compiled default changed from 3 to 1 (decision 1,
  // §10) and this test's own "10 NMIs" assumption did not follow it).
  const compiledChunk = nes.cpu.loadFromCartridge(addr('sw_debug_chunk'));
  const expectedNmis = Math.ceil(30 / compiledChunk);
  const watchdog = expectedNmis + 10; // real margin, never tight against the expectation it's checking

  function drainViaNmis(maxNmis) {
    let n = 0;
    while (nes.cpu.mem[RAM.st_active] !== 0 && n < maxNmis) {
      callRoutine(nes, addr('sw_nmi_stream'));
      n++;
    }
    return n;
  }

  // Strip 1: entering column (screenCol=0, localCol=0).
  pokeAB(nes, 0, 0, 'sw_stream_start_col');
  const nmis1 = drainViaNmis(watchdog);
  check('T3 strip1 fully drained', nes.cpu.mem[RAM.st_active], 0);
  check(`T3 strip1 NMI count == ${expectedNmis} (30 blocks / compiled chunk ${compiledChunk})`, nmis1, expectedNmis);
  // Column 0's own physical tiles: world rows 0-14 -> screen(0,0), world
  // rows 15-29 -> screen(1,0) (marker 11). Spot-check row 0 and row 15.
  const t0Row0 = nes.ppu.vramMem[0x2000]; // physCol=0,physRow=0 -> tileHi=$20,lo=0
  const t0Row15 = nes.ppu.vramMem[0x2800]; // physRow=15 -> bottom half, nt+=8 -> $28
  check('T3 strip1 physical (0,0) tile', t0Row0, 1); // screen(0,0) local(0,0)=marker 1
  check('T3 strip1 physical (0,15) tile', t0Row15, 11); // screen(1,0) local(0,0)=marker 11

  // Now cross right (still inside screen 0's own 16 local columns) and arm
  // the new entering edge at localCol=1 -- exercising sw_cross_right's own
  // incremental update AND a second successive strip.
  callRoutine(nes, addr('sw_cross_right'));
  nes.cpu.mem[RAM.win_col_local] = 1; // the window's own logical origin also
                                       // slides one block right (main-loop
                                       // responsibility, not sw_cross_right's
                                       // own job -- sw_cross_right only
                                       // updates the CURRENT-SCREEN addressing
                                       // state, confirmed by inspecting its
                                       // own body, §5's own scope note)
  pokeAB(nes, 0, 1, 'sw_stream_start_col'); // entering screenCol=0, localCol=1
  const nmis2 = drainViaNmis(watchdog);
  check('T3 strip2 fully drained', nes.cpu.mem[RAM.st_active], 0);
  check(`T3 strip2 NMI count == ${expectedNmis} (30 blocks / compiled chunk ${compiledChunk})`, nmis2, expectedNmis);

  // RETENTION check: torus column 0's own tiles (written by strip 1) must
  // be UNCHANGED after strip 2 draws column 1's own physical position
  // (which is a DIFFERENT physical tile column, 2 tiles over) -- this is
  // the actual ring-buffer property. Round 1/2's own bug would have
  // redrawn EVERYTHING at the SAME window-relative physical slot on every
  // strip, corrupting column 0's own content the moment column 1 was drawn.
  check('T3 RETENTION: column 0 tile (0,0) unchanged after strip 2', nes.ppu.vramMem[0x2000], 1);
  check('T3 RETENTION: column 0 tile (0,15) unchanged after strip 2', nes.ppu.vramMem[0x2800], 11);
  // Column 1's own new content: screen(0,0) local(0,1) -- offset=0*16+1=1,
  // marker=1 -> id=(1*5+1)%64=6. Physical tile column 1*2=2 (tileCol),
  // same physical row half (0). Address: hi=$20, lo=2.
  const expectedCol1Id = (1 * 5 + 1) % 64;
  check('T3 strip2 new column tile (physCol=1,row=0)', nes.ppu.vramMem[0x2002], expectedCol1Id);
}

// --------------------------------------------------------------------------
// Test 4 -- reversal (R1's own explicit demand: "test successive strips...
// with a reversal"). Cross right twice, then left once, and confirm the
// addressing state returns EXACTLY to what a single net crossing would
// have produced -- not merely that it "looks plausible."
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_col] = 0;
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;
  callRoutine(nes, addr('sw_cross_right'));
  callRoutine(nes, addr('sw_cross_right'));
  callRoutine(nes, addr('sw_cross_left'));
  // Net: +1. Compare against a FRESH state that only ever went +1 once.
  const nes2 = freshNes();
  nes2.cpu.mem[RAM.sw_base_bank] = 2;
  nes2.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes2.cpu.mem[RAM.sw_col] = 0;
  nes2.cpu.mem[RAM.sw_col_rem] = 0;
  nes2.cpu.mem[RAM.sw_col_region] = 0;
  nes2.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes2.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes2.cpu.mem[RAM.sw_row_bank_base] = 0;
  callRoutine(nes2, addr('sw_cross_right'));
  check('T4 reversal: sw_col matches', nes.cpu.mem[RAM.sw_col], nes2.cpu.mem[RAM.sw_col]);
  check('T4 reversal: sw_col_rem matches', nes.cpu.mem[RAM.sw_col_rem], nes2.cpu.mem[RAM.sw_col_rem]);
  check('T4 reversal: sw_col_region matches', nes.cpu.mem[RAM.sw_col_region], nes2.cpu.mem[RAM.sw_col_region]);
  check('T4 reversal: sw_col_byte_lo matches', nes.cpu.mem[RAM.sw_col_byte_lo], nes2.cpu.mem[RAM.sw_col_byte_lo]);
  check('T4 reversal: sw_col_byte_hi matches', nes.cpu.mem[RAM.sw_col_byte_hi], nes2.cpu.mem[RAM.sw_col_byte_hi]);
  // And confirm sw_locate_current agrees: both should select the same bank
  // and mtptr.
  callRoutine(nes, addr('sw_locate_current'));
  callRoutine(nes2, addr('sw_locate_current'));
  check('T4 reversal: mtptr_lo matches', nes.cpu.mem[0x02], nes2.cpu.mem[0x02]);
  check('T4 reversal: mtptr_hi matches', nes.cpu.mem[0x03], nes2.cpu.mem[0x03]);
}

// --------------------------------------------------------------------------
// Test 5 -- a region-boundary reversal (col_rem wraps 0<->23 crossing the
// region), exercising sw_cross_left's own "recompute via loop" branch,
// which sw_cross_right's own mirror-image branch never reaches.
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_col] = 24; // one full region in
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 1;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;
  callRoutine(nes, addr('sw_cross_left')); // col_rem 0 -> wraps to 23, region 1->0
  check('T5 region-boundary left: sw_col', nes.cpu.mem[RAM.sw_col], 23);
  check('T5 region-boundary left: sw_col_rem', nes.cpu.mem[RAM.sw_col_rem], 23);
  check('T5 region-boundary left: sw_col_region', nes.cpu.mem[RAM.sw_col_region], 0);
  const expectedByte = 23 * 338;
  check('T5 region-boundary left: sw_col_byte_lo', nes.cpu.mem[RAM.sw_col_byte_lo], expectedByte & 0xff);
  check('T5 region-boundary left: sw_col_byte_hi', nes.cpu.mem[RAM.sw_col_byte_hi], (expectedByte >> 8) & 0xff);
  // Now cross right back across the same boundary and confirm we land
  // exactly back where we started (col=24, rem=0, region=1, byte=0).
  callRoutine(nes, addr('sw_cross_right'));
  check('T5 back across boundary: sw_col', nes.cpu.mem[RAM.sw_col], 24);
  check('T5 back across boundary: sw_col_rem', nes.cpu.mem[RAM.sw_col_rem], 0);
  check('T5 back across boundary: sw_col_region', nes.cpu.mem[RAM.sw_col_region], 1);
  check('T5 back across boundary: sw_col_byte_lo', nes.cpu.mem[RAM.sw_col_byte_lo], 0);
  check('T5 back across boundary: sw_col_byte_hi', nes.cpu.mem[RAM.sw_col_byte_hi], 0);
}

// --------------------------------------------------------------------------
// Test 6 -- R15's own explicit negative controls: a no-op sw_nmi_stream and
// an always-yielding policy must both FAIL this suite's own content check,
// proving the test observes real work rather than merely that a callback
// ran. Simulated here (rather than reassembling a second ROM) by directly
// checking that if sw_nmi_stream is never called at all (the "always-
// yielding" case), the strip's own physical content is NEVER written --
// the exact failure a vacuous test cannot detect.
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.win_col_screen] = 0;
  nes.cpu.mem[RAM.win_col_local] = 0;
  nes.cpu.mem[RAM.win_row_screen] = 0;
  nes.cpu.mem[RAM.win_row_local] = 0;
  nes.cpu.mem[RAM.sw_col] = 0;
  nes.cpu.mem[RAM.sw_row] = 0;
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;
  pokeAB(nes, 0, 0, 'sw_stream_start_col');
  // Deliberately do NOT call sw_nmi_stream at all (the "always-yielding"
  // simulation) -- st_active must still read nonzero (a real streamer's
  // own work is still pending) and the physical tile must still read
  // whatever was there before arming (0 on a cold, fresh VRAM), never the
  // fixture's own marker value -- proving a test that only checked
  // st_active/sbuf without ALSO draining and reading VRAM (round 2's own
  // documented gap, review 2 finding 15) would have missed this class of
  // bug entirely.
  check('T6 always-yield: st_active still pending', nes.cpu.mem[RAM.st_active], 1);
  check('T6 always-yield: physical tile NOT yet drawn', nes.ppu.vramMem[0x2000], 0);
}


// --------------------------------------------------------------------------
// R2 verification: sw_render_window's own attribute computation, RE-DERIVED
// this round against the R1-fixed (finding 1, review 3) absolute-parity
// mapping -- the world position a given physical cell maps to changed when
// sw_rw_col_delta/sw_rw_row_delta were added, so the expected value here is
// no longer round 2/3's own "world row 17" (that was the correct answer
// under the OLD, buggy window-relative mapping's own arithmetic, not a
// fact about the fixture). Window origin (screenCol=0,localCol=1,
// screenRow=0,localRow=1) -- the same unaligned "(1,1)" case used
// throughout. NT2 (bottom-left), cell (arow=0,acol=0), BL quadrant.
//
// Hand-derived under the CURRENT (fixed) mapping: wbase_col=(0&1)*16+1=1,
// wbase_row=(0&1)*15+1=1. BL's own torus position for this cell is
// (col=0,row=16) [x0=acol*2+ntx(0)=0, y1=arow*2+1+nty(15)=16]. delta_col =
// (0-1)&31 = 31; sw_col_at_offset(31) -> win_col_local(1)+31=32 ->
// screenCol=0+(32>>4)=2, localCol=32&15=0. delta_row: (16+30-1)=45, >=30 so
// -30 = 15; sw_row_at_offset(15) -> 15+win_row_local(1)=16, one 15-subtract
// -> localRow=1, screenRow=0+1=1. World position: screen(col=2,row=1),
// local(row=1,col=0) -- marker 13 (this round's own widened 3x3 fixture,
// r1c2) -- offset=1*16+0=16, id=(16*5+13)%64=29, pal=29%4=1.
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.win_col_screen] = 0;
  nes.cpu.mem[RAM.win_col_local] = 1;
  nes.cpu.mem[RAM.win_row_screen] = 0;
  nes.cpu.mem[RAM.win_row_local] = 1;
  nes.cpu.mem[RAM.sw_col] = 0;
  nes.cpu.mem[RAM.sw_row] = 0;
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;

  callRoutineSlow(nes, addr('sw_render_window'));

  // NT2 (bottom-left) attribute shadow base = 2*64 = 128 = $0080 offset
  // into attr_shadow ($0600) -- byte at $0680, cell (0,0), BL = bits 4-5.
  const shadowByte = nes.cpu.mem[0x0680];
  const blPalette = (shadowByte >> 4) & 3;
  const expectedId = (16 * 5 + 13) % 64;
  check('R2 NT2 cell(0,0) BL = screen(2,1) local(1,0) palette (re-derived, R1 fix)', blPalette, expectedId % 4);
  // The OLD (pre-R1-fix, window-relative) mapping's own prediction -- world
  // row 17 under round 2/3's own arithmetic -- would have given a different
  // palette; confirm we do NOT match it, i.e. the fix actually changed
  // something observable here rather than coincidentally landing on the
  // same byte.
  const oldMappingPrediction = ((33 * 5 + 11) % 64) % 4;
  check('R2 NOT the pre-R1-fix window-relative value', blPalette === oldMappingPrediction ? 1 : 0, 0);

  // Skip-logic check: NT2's own 8th attribute cell row (arow=7) BL/BR must
  // be 0 (skipped -- no valid same-nametable content), never a relocated
  // read into some other screen's own data.
  const lastCellShadowByte = nes.cpu.mem[0x0680 + 7 * 8 + 0]; // nt2 base + arow7*8+acol0
  const lastBl = (lastCellShadowByte >> 4) & 3;
  const lastBr = (lastCellShadowByte >> 6) & 3;
  check('R2 NT2 cell(7,0) BL skipped (0)', lastBl, 0);
  check('R2 NT2 cell(7,0) BR skipped (0)', lastBr, 0);
}

// --------------------------------------------------------------------------
// Test 7 (R5): sw_peek_byte -- the whole switch/read/restore transaction as
// ONE resident routine. Peeks screen (1,0)'s own byte 0 (marker=2) while
// mtptr is deliberately left pointed at screen (0,0) beforehand (marker=1),
// proving three things in one call: the read reaches the REQUESTED
// neighbour (not the current screen -- the `tya` bug this round's own
// isolated testing caught first), the CALLER's own current screen is
// genuinely restored afterward (not merely left on whatever bank the peek
// used), and a real, unrelated read against the restored mtptr confirms
// the restore is functionally correct, not just byte-identical by
// coincidence.
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_col] = 0;
  nes.cpu.mem[RAM.sw_row] = 0;
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;
  nes.cpu.mem[0x02] = 0x00;
  nes.cpu.mem[0x03] = 0x80; // mtptr pre-set to the current screen (0,0)

  nes.cpu.REG_ACC = 1; // screenCol
  nes.cpu.REG_X = 0; // screenRow
  nes.cpu.REG_Y = 0; // offset (screen (1,0)'s own byte 0 = its marker, 2)
  const cycles = callRoutine(nes, addr('sw_peek_byte'));

  check('T7 peeked neighbour byte (screen 1,0 marker)', nes.cpu.REG_ACC, 2);
  check('T7 mtptr restored (lo)', nes.cpu.mem[0x02], 0x00);
  check('T7 mtptr restored (hi)', nes.cpu.mem[0x03], 0x80);
  check('T7 restored screen genuinely readable (marker 1)', nes.cpu.loadFromCartridge(nes.cpu.mem[0x02] | (nes.cpu.mem[0x03] << 8)), 1);
  console.log(`     T7 sw_peek_byte cost: ${cycles} cycles (incl. the callRoutine stub's own ~6)`);
}

// --------------------------------------------------------------------------
// Test 8 (finding 1, review 3): full redraw at an ALIGNED ODD/ODD-parity
// window origin (screenCol=1,localCol=0,screenRow=1,localRow=0) -- every
// prior test (T1-T7, the R1/R2 fixes) only ever exercised an EVEN-parity
// origin (win_col_screen=win_row_screen=0). Odd/odd is a genuinely
// different case: the window's own NAMED origin screen (1,1) is itself
// odd/odd, so under the parity rule it lands in NT3 (bottom-right), not
// NT0 -- the diagonally OPPOSITE screen (2,2) lands in NT0 instead. Values
// below are independently hand-derived (proto-tools/diag_t8_design.mjs),
// not copied from the routine under test.
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.win_col_screen] = 1;
  nes.cpu.mem[RAM.win_col_local] = 0;
  nes.cpu.mem[RAM.win_row_screen] = 1;
  nes.cpu.mem[RAM.win_row_local] = 0;
  nes.cpu.mem[RAM.sw_col] = 1;
  nes.cpu.mem[RAM.sw_row] = 1;
  nes.cpu.mem[RAM.sw_col_rem] = 1;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 338 & 0xff;
  nes.cpu.mem[RAM.sw_col_byte_hi] = (338 >> 8) & 0xff;
  nes.cpu.mem[RAM.sw_row_bank_base] = 1;

  callRoutineSlow(nes, addr('sw_render_window'));

  // Terrain: block (0,0) of each of the four physical nametables. NT bases:
  // 0=$2000, 1=$2400, 2=$2800, 3=$2C00; block row 0 -> tile row 0 -> the
  // mt_tl byte lands at the NT's own base address exactly.
  const ntBase = [0x2000, 0x2400, 0x2800, 0x2c00];
  check('T8 NT0 block(0,0) = screen(2,2) (odd/odd origin, opposite corner)', nes.ppu.vramMem[ntBase[0]], 23);
  check('T8 NT1 block(0,0) = screen(1,2)', nes.ppu.vramMem[ntBase[1]], 22);
  check('T8 NT2 block(0,0) = screen(2,1)', nes.ppu.vramMem[ntBase[2]], 13);
  check('T8 NT3 block(0,0) = screen(1,1) (the window\'s own named origin)', nes.ppu.vramMem[ntBase[3]], 12);

  // All four attribute quadrants of NT0's own cell (0,0) -- not just BL/BR
  // (R2's own original scope) or just one quadrant (finding 16's own
  // complaint that no test checks every quadrant at once).
  const shadowByte = nes.cpu.mem[0x0600]; // NT0 base = 0*64 = 0
  const tlPal = shadowByte & 3;
  const trPal = (shadowByte >> 2) & 3;
  const blPal = (shadowByte >> 4) & 3;
  const brPal = (shadowByte >> 6) & 3;
  check('T8 NT0 cell(0,0) TL palette', tlPal, 23 % 4);
  check('T8 NT0 cell(0,0) TR palette', trPal, 28 % 4);
  check('T8 NT0 cell(0,0) BL palette', blPal, 39 % 4);
  check('T8 NT0 cell(0,0) BR palette', brPal, 44 % 4);
  // The written PPU byte (via $2007) must match the shadow mirror exactly --
  // confirms the shadow is not merely internally self-consistent but
  // genuinely mirrors what actually reached the nametable's own attribute
  // table ($23C0, NT0's own attribute base).
  check('T8 NT0 attribute byte written to $23C0 matches attr_shadow', nes.ppu.vramMem[0x23c0], shadowByte);
}


// --------------------------------------------------------------------------
// Test 9 (finding 3, review 3): sw_read_transaction -- the GENERAL
// code-bank-restoring transaction, distinct from sw_peek_byte's own
// field-restore convenience. Reviewer's own stub: select PRG bank 7 (a
// stand-in for a banked caller, e.g. the RPG battle bank), peek screen
// (1,0), and confirm $8000 still reads the bank-7 byte after return --
// proving the caller's own CODE bank is restored, not the field's current
// screen (sw_peek_byte would restore the field bank instead, which is
// wrong for this caller).
// --------------------------------------------------------------------------
{
  const nes = freshNes();
  const dbg2 = addr('sw_debug_addrs2');
  const callerBankAddr = nes.cpu.loadFromCartridge(dbg2 + 14) | (nes.cpu.loadFromCartridge(dbg2 + 15) << 8);

  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_col] = 1;
  nes.cpu.mem[RAM.sw_row] = 1;
  nes.cpu.mem[RAM.sw_col_rem] = 1;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 338 & 0xff;
  nes.cpu.mem[RAM.sw_col_byte_hi] = (338 >> 8) & 0xff;
  nes.cpu.mem[RAM.sw_row_bank_base] = 1;

  nes.cpu.REG_ACC = 7;
  callRoutine(nes, addr('switch_prg_bank'));
  const bank7Fingerprint = nes.cpu.loadFromCartridge(0x8000);

  nes.cpu.mem[callerBankAddr] = 7;
  nes.cpu.REG_ACC = 1; // target screenCol
  nes.cpu.REG_X = 0;   // target screenRow
  nes.cpu.REG_Y = 0;   // offset
  callRoutine(nes, addr('sw_read_transaction'));
  check('T9 sw_read_transaction returns the target byte (screen(1,0) marker)', nes.cpu.REG_ACC, 2);
  check('T9 caller\'s own code bank restored (bank 7, not the field bank)', nes.cpu.loadFromCartridge(0x8000), bank7Fingerprint);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
```

## Appendix B: the Mesen/timing harness (updated this round, finding 9)

Fix round 2's own Appendix B was retired outright (a stale `$C356` literal hook, an "unresolved
Mesen crash" that was actually a stale-hook timeout). Fix round 4 rebuilt it from nothing, following
`test/lua/flash_nmi_timing.lua.template` + `test/lua/build_flash_nmi_roms.mjs`'s own shape. Review 4
finding 9 found two real gaps this round closes: the builder's own `chunkLen` argument only ever
drove the Lua workload, leaving the ASSEMBLED `SW_STREAM_CHUNK` fixed regardless of the argument;
and the explicit reproducibility deliverables (a full-render Mesen quadrant template, a DMA-prologue
control, `streamworld_hot.asm` itself) were still missing from this appendix. All three are now
below, in full, alongside the deadline harness.

### `proto-tools/sw_nmi_deadline.lua.template`, in full (this round: the compiled chunk is a real builder argument, workload length/parity are independent parameters)

```lua
-- sw_nmi_deadline.lua.template -- R4's own Mesen (cycle-accurate) proof that
-- one streaming chunk sharing a vblank with the worst-case pre-existing
-- vram_buf drain (the 70-byte two-packet shape flash_nmi_timing.lua.template
-- uses) still finishes inside vblank, on real hardware timing -- jsnes does
-- not enforce a hard vblank deadline (CLAUDE.md: "Mesen, not jsnes, is the
-- authority on vblank timing"), so this is the one part of R4 that must be
-- proven here, not in verify_torus.mjs.
--
-- This is a TEMPLATE. proto-tools/build_deadline_fixture.mjs instantiates it
-- per board, substituting every __PLACEHOLDER__ below with an address
-- resolved fresh out of that exact build (nmi_rti/main_loop_ready from
-- main.fns; the sw_* addresses from streamworld.asm's own sw_debug_addrs/
-- sw_debug_addrs2 tables, read back out of the assembled ROM by the builder
-- via this project's own jsnes core -- the same "derive, never hardcode"
-- rule flash_nmi_timing.lua.template already follows, applied to a
-- prototype that has no .fns entries for its own zero-page `=` equates).
--
-- Simplification, disclosed: this check pokes the worst-case vram_buf
-- fixture and a ready-to-draw streaming chunk directly into RAM rather than
-- driving real gameplay/strip-arming to produce them -- the identical
-- simplification flash_nmi_timing.lua.template already makes for its own
-- FLASH_LEFT arm. sw_nmi_stream/sw_ns_draw_block read only st_active/
-- st_cur/st_len/st_ftile/st_fnt/st_vary/sbuf -- none of the strip-arming
-- machinery (sw_col/row, the region math) -- so poking those seven fields
-- exercises the exact code path a real strip would run through this NMI,
-- with no loss of fidelity for a TIMING (not addressing) question.
--
-- Arming point, CORRECTED (review 3, finding 10): this engine's main_loop
-- (engine/boot.asm:114-115) is literally `main_loop: jsr wait_vblank` --
-- the loop IS synced to vblank at its own top every iteration (a fix-3
-- draft of this comment claimed the opposite, "no wait_vblank, a
-- free-running loop"; that claim was false, found by directly reading
-- boot.asm rather than re-deriving a story from the symptom below).
-- Arming at main_loop's own top (this check's first, abandoned draft)
-- still raced nmi_rti nondeterministically -- confirmed on sample-u512 by
-- direct diagnostic: nmi_rti fired before main_loop_ready reached, every
-- time, regardless of how many frames were let pass first -- but the real
-- reason is that arming there pokes state BEFORE wait_vblank consumes the
-- upcoming vblank, so that imminent NMI fires while the CPU is still
-- inside wait_vblank's own spin loop, one full iteration before the
-- workload is actually finished at main_loop_ready. Arming at
-- MAIN_LOOP_READY's own exec instead -- literally the last mainline
-- instruction before the vram_len/vram_ready handshake, right before the
-- loop returns to wait_vblank for a freshly-synced cycle -- and checking
-- the very next nmi_rti removes the race for the CORRECT reason: confirmed stable across
-- 200 real frames of run-up.
--
--   node proto-tools/build_deadline_fixture.mjs <boardDir> [outDir] [chunkLen] [workloadLen] [parity]
--   Mesen --testRunner <outDir>/sw_nmi_deadline.lua <outDir>/sw_nmi_deadline.nes

local NMI_RTI         = __NMI_RTI__
local MAIN_LOOP_READY = __MAIN_LOOP_READY__
local ST_ACTIVE_ADDR  = __ST_ACTIVE__
local ST_CUR_ADDR     = __ST_CUR__
local ST_LEN_ADDR     = __ST_LEN__
local ST_FTILE_ADDR   = __ST_FTILE__
local ST_FNT_ADDR     = __ST_FNT__
local ST_VARY_ADDR    = __ST_VARY__
local SBUF_ADDR       = __SBUF__

local VRAM_LEN  = 0x3c
local VRAM_BUF  = 0x0400
local VRAM_READY = 0x3f

-- The worst-case two-packet fixture flash_nmi_timing.lua.template proves:
-- two full 32-byte packets (35 bytes each including their own 3-byte
-- header) plus a terminator, 70 bytes of vram_buf. Content is arbitrary
-- (this check never renders it, only times the drain), but each header's
-- own count byte must read 32 or vram_drain's own loop would run short and
-- understate the worst case.
local EXPECTED_VRAM_LEN = 70

-- Review 4, finding 9: the COMPILED SW_STREAM_CHUNK is now a real builder
-- argument too (build_deadline_fixture.mjs's own withCompiledChunk patches
-- streamworld.asm's source line before assembling -- fix round 4's
-- "chunkLen" only ever drove this workload length, leaving the assembled
-- constant fixed at 3). WORKLOAD_LEN is this NMI's own queued block count
-- (normally equal to the compiled chunk, but independently settable);
-- FTILE/FNT_VALUE select which physical origin parity the entering block
-- represents -- all three are independent CLI arguments now:
-- `node build_deadline_fixture.mjs <boardDir> [outDir] [chunkLen] [workloadLen] [parity]`
local WORKLOAD_LEN = __WORKLOAD_LEN__
local FTILE_VALUE = __FTILE_VALUE__
local FNT_VALUE = __FNT_VALUE__

-- Run-up frames before arming: main_loop_ready's own address is hit from
-- the very first post-reset frame, but the game may still be on a title
-- screen or otherwise mid-boot; the run-up costs nothing and rules out any
-- boot-transient state affecting the measurement.
local RUNUP_FRAMES = 400

local EXIT_TIMEOUT         = 99
local EXIT_STALE_ANCHOR    = 6
local EXIT_NEVER_ARMED     = 8
local EXIT_WORKLOAD_SHORT  = 7
local EXIT_DEADLINE_MISS   = 5

local VBLANK_FIRST_SCANLINE = 241
local VBLANK_LAST_SCANLINE  = 260
local DOTS_PER_SCANLINE     = 341
local PPU_DOTS_PER_CPU_CYCLE = 3
local RTI_REMAINING_CYCLES  = 6
local RTI_REMAINING_DOTS    = RTI_REMAINING_CYCLES * PPU_DOTS_PER_CPU_CYCLE

local frame = 0
local checkedAnchor = false
local armed = false
local checkedDeadline = false

local function log(message) emu.log(string.format("[%5d] %s", frame, message)) end
local function fail(code, message) log("FAIL: " .. message) emu.stop(code) end
local function pass(message) log("ok   " .. message) end
local function read(a) return emu.read(a, emu.memType.nesMemory) end
local function write(a, v) emu.write(a, v, emu.memType.nesMemory) end

-- Fires once, before anything else: prove NMI_RTI still names nmi's own
-- rti ($40) rather than a stale address left by a rebuild.
local function checkAnchor()
  local nmiByte = read(NMI_RTI)
  if nmiByte ~= 0x40 then
    fail(EXIT_STALE_ANCHOR, string.format(
      "byte at NMI_RTI (0x%04x) is 0x%02x, not rti ($40) -- stale address, re-run build_deadline_fixture.mjs",
      NMI_RTI, nmiByte))
    return false
  end
  pass(string.format("NMI_RTI anchor verified: 0x%04x is $40 (rti)", NMI_RTI))
  return true
end

-- Poke the worst-case vram_buf fixture plus a ready-to-draw 3-block chunk,
-- hooked to MAIN_LOOP_READY's own exec (see the header comment above for
-- why here, not main_loop's top or an endFrame callback).
local function armWorstCase()
  local i = 0
  for pkt = 0, 1 do
    write(VRAM_BUF + i, 0x20); i = i + 1        -- addr hi (nametable space)
    write(VRAM_BUF + i, 0x00); i = i + 1        -- addr lo
    write(VRAM_BUF + i, 32); i = i + 1          -- count
    for b = 1, 32 do write(VRAM_BUF + i, 0xAA); i = i + 1 end
  end
  write(VRAM_BUF + i, 0)  -- terminator
  write(VRAM_LEN, EXPECTED_VRAM_LEN)
  write(VRAM_READY, 1)

  -- A ready workload of up to 3 blocks: metatile ids 0/1/2 (all valid,
  -- LIMITS.metatiles >= 3 on every fixture this ships against), starting at
  -- the FTILE/FNT origin the builder selected, column-strip mode.
  write(ST_FTILE_ADDR, FTILE_VALUE)
  write(ST_FNT_ADDR, FNT_VALUE)
  write(ST_VARY_ADDR, 0)
  write(SBUF_ADDR + 0, 0)
  write(SBUF_ADDR + 1, 1)
  write(SBUF_ADDR + 2, 2)
  write(ST_CUR_ADDR, 0)
  write(ST_LEN_ADDR, WORKLOAD_LEN)
  write(ST_ACTIVE_ADDR, 1)

  local vramLen = read(VRAM_LEN)
  local stActive = read(ST_ACTIVE_ADDR)
  if vramLen ~= EXPECTED_VRAM_LEN or stActive ~= 1 then
    fail(EXIT_WORKLOAD_SHORT, string.format(
      "immediately after arming: vram_len=%d (want %d), st_active=%d (want 1) -- the poke did not stick",
      vramLen, EXPECTED_VRAM_LEN, stActive))
    return
  end
  armed = true
  pass(string.format("armed at main_loop_ready: vram_len=%d, st_active=%d, st_len=%d, ftile=%d, fnt=%d -- watching the immediately following nmi_rti", vramLen, stActive, WORKLOAD_LEN, FTILE_VALUE, FNT_VALUE))
end

local function onMainLoopReady()
  if armed or frame < RUNUP_FRAMES then return end
  armWorstCase()
end

-- Fires at nmi's own rti -- the deadline assertion, on the first nmi_rti
-- after arming.
local function onNmiRti()
  if not armed or checkedDeadline then return end
  checkedDeadline = true
  local state = emu.getState()
  local scanline = state["ppu.scanline"]
  local cycle = state["ppu.cycle"]
  local vramLen = read(VRAM_LEN)
  local stActive = read(ST_ACTIVE_ADDR)
  local stCur = read(ST_CUR_ADDR)
  log(string.format("nmi_rti reached: scanline=%d cycle=%d vram_len=%d st_active=%d st_cur=%d", scanline, cycle, vramLen, stActive, stCur))
  if vramLen ~= 0 then
    fail(EXIT_DEADLINE_MISS, string.format("vram_len should be 0 right after the drain, saw %d", vramLen))
    return
  end
  if stCur ~= WORKLOAD_LEN then
    fail(EXIT_WORKLOAD_SHORT, string.format("st_cur is %d, not %d -- the chunk did not actually run this NMI", stCur, WORKLOAD_LEN))
    return
  end
  if scanline < VBLANK_FIRST_SCANLINE or scanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("nmi_rti landed on scanline %d, outside vblank (%d-%d)", scanline, VBLANK_FIRST_SCANLINE, VBLANK_LAST_SCANLINE))
    return
  end
  local finishDot = cycle + RTI_REMAINING_DOTS
  local finishScanline = scanline
  while finishDot >= DOTS_PER_SCANLINE do
    finishDot = finishDot - DOTS_PER_SCANLINE
    finishScanline = finishScanline + 1
  end
  if finishScanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("rti's own remaining dots push past vblank (scanline %d -> %d)", scanline, finishScanline))
    return
  end
  pass(string.format("the drain+chunk NMI finished at scanline %d, cycle %d (rti settles on scanline %d) -- inside vblank (%d-%d)", scanline, cycle, finishScanline, VBLANK_FIRST_SCANLINE, VBLANK_LAST_SCANLINE))
  emu.stop(0)
end

local function onFrame()
  frame = frame + 1
  if not checkedAnchor then
    checkedAnchor = true
    if not checkAnchor() then return end
  end
  if armed and not checkedDeadline and frame > RUNUP_FRAMES + 20 then
    fail(EXIT_NEVER_ARMED, "armed but no nmi_rti followed within 5 frames")
    return
  end
  if frame > 600 then
    fail(EXIT_TIMEOUT, "timed out waiting for nmi_rti after arming")
    return
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addMemoryCallback(onMainLoopReady, emu.callbackType.exec, MAIN_LOOP_READY)
emu.addMemoryCallback(onNmiRti, emu.callbackType.exec, NMI_RTI)
```

### `proto-tools/build_deadline_fixture.mjs`, in full (this round: `withCompiledChunk` patches the ASSEMBLED `SW_STREAM_CHUNK` before nesasm runs, restores the source afterward; `workloadLen`/`parity` are independent CLI arguments)

```js
#!/usr/bin/env node
// R4's own Mesen deadline-check builder. Assembles <boardDir>/build/main.asm
// with real nesasm, applies the same header patch buildProject's own
// pipeline would (shared/cartridge.js's applyHeaderPatch -- necessary
// because a raw nesasm invocation, unlike main/build/cli.js, does no
// post-processing at all), resolves every address the generated .lua needs
// out of THIS exact build (main.fns for nmi_rti/main_loop_ready; the
// streamworld.asm prototype's own sw_debug_addrs/sw_debug_addrs2 tables,
// read back out of the assembled ROM through this project's own jsnes core
// -- the same "peek the real mapper" technique build_flash_nmi_roms.mjs
// uses for flash_left), and writes <outDir>/sw_nmi_deadline.nes plus the
// substituted .lua.
//
//   node proto-tools/build_deadline_fixture.mjs <boardDir> [outDir]
//
// <boardDir> must already have streamworld.asm included in its main.asm's
// kernel-lo bank, the two sw_debug_addrs tables in streamworld.asm, and the
// `jsr sw_nmi_stream` hook in boot.asm's nmi -- this script does not add
// those; it only builds and measures whatever board directory it is given.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { applyHeaderPatch, MAPPERS } from '../shared/cartridge.js';
import { Emulator } from '../renderer/emulator/runcontrol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = path.join(ROOT, 'proto-tools/sw_nmi_deadline.lua.template');

// Review 3, finding 9: chunk size is a builder argument, not a hand-edited
// template constant. Review 4, finding 9: that argument only ever drove the
// LUA workload, leaving the COMPILED SW_STREAM_CHUNK fixed at 3 -- fixed by
// withCompiledChunk below. This round also separates the compiled chunk
// from the workload length (how many blocks are queued for this one NMI --
// normally equal to chunkLen, but settable higher to test a workload that
// spans more than one NMI) and the origin parity (even/odd -- FTILE/FNT
// values representing a different physical half of the ring), so all three
// axes finding 9 asked for are independent CLI arguments, not folded into
// one "chunkLen."
const [, , boardDirArg, outDirArg, chunkLenArg, workloadLenArg, parityArg] = process.argv;
if (!boardDirArg) {
  console.error('usage: node proto-tools/build_deadline_fixture.mjs <boardDir> [outDir] [chunkLen=1] [workloadLen=chunkLen] [parity=even|odd]');
  process.exit(2);
}
const chunkLen = chunkLenArg ? Number(chunkLenArg) : 1;
if (!Number.isInteger(chunkLen) || chunkLen < 1 || chunkLen > 3) {
  throw new Error(`chunkLen must be an integer 1-3 (sbuf is only pre-poked with 3 valid ids), got ${chunkLenArg}`);
}
const workloadLen = workloadLenArg ? Number(workloadLenArg) : chunkLen;
if (!Number.isInteger(workloadLen) || workloadLen < 1 || workloadLen > 3) {
  throw new Error(`workloadLen must be an integer 1-3, got ${workloadLenArg}`);
}
const parity = parityArg || 'even';
if (parity !== 'even' && parity !== 'odd') throw new Error(`parity must be 'even' or 'odd', got ${parityArg}`);
// FTILE = the entering edge's own fixed tile coordinate (2*local); FNT = its
// fixed nametable-hi contribution (parity*4-or-8, per sw_ns_draw_block's own
// column-strip encoding). 'odd' represents local=1 on an odd-parity screen
// (bottom half of a column strip); 'even' is the aligned local=0 origin
// every prior deadline run used.
const [ftileValue, fntValue] = parity === 'odd' ? [2, 8] : [0, 0];
const boardDir = path.resolve(ROOT, boardDirArg);
const buildDir = path.join(boardDir, 'build');
const outDir = outDirArg ? path.resolve(ROOT, outDirArg) : buildDir;

function fnsToMap(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
    if (m) map[m[1]] = parseInt(m[2], 16);
  }
  return map;
}

// Review 3, finding 9: nesasm exits 0 even on a real bank-overflow diagnostic
// (CLAUDE.md's own documented trap) -- the builder must not trust the exit
// code alone, or it silently reads stale main.nes/main.fns from a PREVIOUS
// successful build while reporting today's (broken) one as fine.
function assembleOrThrow() {
  const result = execFileSync('nesasm', ['-s', 'main.asm'], { cwd: buildDir, encoding: 'utf8' });
  if (/\berror\b/i.test(result) || /bank overflow/i.test(result)) {
    throw new Error(`nesasm reported a real diagnostic despite exit 0 -- refusing to trust stale artefacts:\n${result}`);
  }
  return result;
}

// Review 4, finding 9: fix round 4's own "chunkLen" argument only ever
// substituted the LUA workload's own CHUNK_LEN constant -- the ASSEMBLED
// SW_STREAM_CHUNK in streamworld.asm stayed hardcoded (3, then patched to 1
// as the new checked-in default), so a "chunkLen=1" run was really "arm a
// one-block workload inside a chunk-3-compiled ROM," never an ongoing
// chunk-1 STREAMER. This patches the source line itself, asserts the
// substitution really happened exactly once, assembles, and restores the
// original line afterward so re-running this script twice in a row (or any
// other script reading streamworld.asm) never sees a mutated file.
const SW_ASM_PATH = path.join(buildDir, 'streamworld.asm');
function withCompiledChunk(chunkLen, fn) {
  const original = fs.readFileSync(SW_ASM_PATH, 'utf8');
  const pattern = /^SW_STREAM_CHUNK = \d+(?=\s)/m;
  const occurrences = (original.match(pattern) || []).length;
  if (occurrences !== 1) throw new Error(`expected exactly one SW_STREAM_CHUNK definition, found ${occurrences}`);
  const patched = original.replace(pattern, `SW_STREAM_CHUNK = ${chunkLen}`);
  fs.writeFileSync(SW_ASM_PATH, patched);
  try {
    return fn();
  } finally {
    fs.writeFileSync(SW_ASM_PATH, original);
  }
}

function main() {
  withCompiledChunk(chunkLen, assembleOrThrow);
  const fnsText = fs.readFileSync(path.join(buildDir, 'main.fns'), 'utf8');
  const syms = fnsToMap(fnsText);
  for (const name of ['nmi_rti', 'main_loop_ready', 'sw_debug_addrs', 'sw_debug_addrs2']) {
    if (!Number.isFinite(syms[name])) throw new Error(`${name} missing from main.fns -- rebuild or check the include`);
  }

  const romBytesRaw = new Uint8Array(fs.readFileSync(path.join(buildDir, 'main.nes')));

  const projectJson = JSON.parse(fs.readFileSync(path.join(boardDir, 'project.json'), 'utf8'));
  const cartridge = projectJson.project?.cartridge ?? projectJson.cartridge;
  const mapperId = cartridge.mapper;
  const mapper = MAPPERS.find((m) => m.id === mapperId);
  if (!mapper) throw new Error(`unknown mapper id ${mapperId}`);
  // Every fixture used here (sample-u512, sample-mmc3) has a live Save
  // command, so saveEnabled=true matches what a real buildProject() call
  // would pass -- confirmed per-board by the cli.js build log this script's
  // own report quotes ("Rewrote the header for ... battery-backed save" /
  // "... flash save").
  const patched = applyHeaderPatch(romBytesRaw.slice(), mapper, cartridge, true);

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(patched);

  function peekPairs(baseAddr, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const lo = emulator.peek(baseAddr + i * 2);
      const hi = emulator.peek(baseAddr + i * 2 + 1);
      out.push(lo | (hi << 8));
    }
    return out;
  }

  // sw_debug_addrs: sw_ns_row, sw_ns_col, sw_ns_nt, sw_ns_row_lo, sw_ns_row_hi, sw_ns_chunk, cam_slide_b_pending
  // sw_debug_addrs2: st_active, st_cur, st_len, st_ftile, st_fnt, st_vary, sbuf
  const [, , , , , ,] = peekPairs(syms.sw_debug_addrs, 7);
  const [stActive, stCur, stLen, stFtile, stFnt, stVary, sbuf] = peekPairs(syms.sw_debug_addrs2, 7);

  fs.mkdirSync(outDir, { recursive: true });
  const romPath = path.join(outDir, 'sw_nmi_deadline.nes');
  fs.writeFileSync(romPath, Buffer.from(patched));

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const substitutions = {
    __NMI_RTI__: `0x${syms.nmi_rti.toString(16)}`,
    __MAIN_LOOP_READY__: `0x${syms.main_loop_ready.toString(16)}`,
    __ST_ACTIVE__: `0x${stActive.toString(16)}`,
    __ST_CUR__: `0x${stCur.toString(16)}`,
    __ST_LEN__: `0x${stLen.toString(16)}`,
    __ST_FTILE__: `0x${stFtile.toString(16)}`,
    __ST_FNT__: `0x${stFnt.toString(16)}`,
    __ST_VARY__: `0x${stVary.toString(16)}`,
    __SBUF__: `0x${sbuf.toString(16)}`,
    __WORKLOAD_LEN__: String(workloadLen),
    __FTILE_VALUE__: String(ftileValue),
    __FNT_VALUE__: String(fntValue)
  };
  let generated = template;
  for (const [token, value] of Object.entries(substitutions)) {
    const occurrences = generated.split(token).length - 1;
    if (occurrences !== 1) throw new Error(`expected exactly one occurrence of ${token}, found ${occurrences}`);
    generated = generated.split(token).join(value);
  }
  const luaPath = path.join(outDir, 'sw_nmi_deadline.lua');
  fs.writeFileSync(luaPath, generated, 'utf8');

  console.log(`board: ${boardDirArg} (mapper ${mapper.name}), compiled SW_STREAM_CHUNK=${chunkLen}, workloadLen=${workloadLen}, parity=${parity}`);
  console.log(`rom: ${romPath}`);
  console.log(`lua: ${luaPath}`);
  for (const [k, v] of Object.entries(substitutions)) console.log(`${k}: ${v}`);
}

main();
```

### `proto-tools/sw_quadrant_check.lua.template`, new this round — the required full-render Mesen quadrant template

Arms on a memory-exec callback at `RENDER_TEST_DONE` (a label right after `minimal-u512/build/
boot.asm`'s own `jsr sw_render_window` prototype hook returns), not a fixed frame count — the
full redraw costs ~324,000 CPU instruction steps (§ below), comfortably more than one frame's own
budget, so a frame-count sample would race the routine's own completion (confirmed empirically: a
10-frame jsnes sample caught it partway through; a 60-frame sample caught ordinary post-boot
gameplay having already overwritten the result). **Coverage, stated exactly, per review 5's own
finding 10**: eight samples (each nametable's own tile(0,0) and one attribute cell) at **T8's own
aligned odd/odd origin** (`screenCol=1,localCol=0,screenRow=1,localRow=0`) — not every quadrant at
every unaligned origin, which is what the earlier jsnes-only 52,224-comparison suite (accepted,
unaffected by anything this round found) already covers exhaustively. This check's own real
contribution is proving that same aligned-origin composition holds on **real, cycle-accurate Mesen
hardware timing**, not that it covers unaligned origins a second time — **8/8 checks pass**, against
an independently-derived oracle (`diag_quadrant_expected.mjs`, below).

```lua
-- sw_quadrant_check.lua.template -- review 4, finding 9's own required
-- "full-render Mesen quadrant template": jsnes functional coverage (the
-- 52,224-comparison proof) does not by itself prove real PPU hardware
-- timing/addressing agrees, so this exercises the SAME full-redraw call
-- (sw_render_window, minimal-u512/build/boot.asm's own PROTOTYPE hook,
-- T8's aligned odd/odd origin: screenCol=1,localCol=0,screenRow=1,
-- localRow=0) on Mesen's cycle-accurate core, arming on a memory-exec
-- breakpoint at RENDER_TEST_DONE (right after the `jsr sw_render_window`
-- returns) rather than a fixed frame count -- the redraw costs on the
-- order of 300,000+ CPU instruction steps, comfortably more than one
-- NTSC frame's own ~29,780 cycles, so a frame-count-based sample point
-- would race the routine's own completion (confirmed empirically: a
-- 10-frame jsnes sample caught it PARTWAY through, a 60-frame sample
-- caught NORMAL GAMEPLAY DRAWING having already overwritten the result).
--
-- RETRACTED this round (review 5, finding 11): an earlier draft of this
-- check ran the identical scenario under jsnes first as a cheap pre-check,
-- loading minimal-u512/build/main.nes -- the RAW, unpatched assembler
-- output, whose own header byte 6 is $E1 (vertical mirroring, nesasm's own
-- default before the real four-screen bit is patched in) -- and found
-- nametable 2's write landing on nametable 0's own physical byte. This was
-- NOT a jsnes core defect: main.patched.nes (header $EB, four-screen,
-- the file every real check including this one loads) keeps all four
-- nametables genuinely independent under jsnes too, re-verified directly.
-- renderer/emulator/core/ppu/index.js:183-255 correctly maintains four
-- independent nametables in four-screen mode and needed no change. The
-- earlier draft simply compared a patched-header Mesen ROM against an
-- unpatched-header jsnes one and attributed the header's own real
-- difference to the wrong emulator -- the fix is asserting header state
-- in test setup, not distrusting jsnes's own four-screen support.
--
--   node proto-tools/build_quadrant_fixture.mjs
--   Mesen --testRunner minimal-u512/build/sw_quadrant_check.lua minimal-u512/build/sw_quadrant_check.nes

local RENDER_TEST_DONE = __RENDER_TEST_DONE__
local EXIT_NEVER_REACHED = 9
local EXIT_MISMATCH = 5

local function log(message) emu.log(message) end
local function fail(code, message) log("FAIL: " .. message) emu.stop(code) end
local function pass(message) log("ok   " .. message) end
local function readPpu(a) return emu.read(a, emu.memType.nesPpuMemory) end

local reached = false
local frame = 0

local function onRenderTestDone()
  if reached then return end
  reached = true

  -- This harness's own emu.log output is not reliably visible in the
  -- calling shell, and io.open() crashed the process outright when tried
  -- -- so a mismatch exits with the ACTUAL byte value itself (0-63, always
  -- distinct from the 0/100+ codes below), letting the calling shell's own
  -- $? read back what was really there with no other channel needed.
  local failures = 0
  local function check(name, actual, expected)
    if actual ~= expected then
      failures = failures + 1
      fail(actual, string.format("%s: expected %d, got %d", name, expected, actual))
    else
      pass(string.format("%s = %d", name, actual))
    end
  end

  -- mt_tl is identity-mapped in this fixture (checked: assets/metatiles.inc's
  -- own mt_tl table is `.db $00,$01,...`), so the raw PPU byte equals the
  -- metatile id directly. All four independently derived (proto-tools/
  -- diag_quadrant_expected.mjs), not copied from streamworld.asm.
  check("NT0 ($2000) tile(0,0), screen(2,2) local(0,0)", readPpu(0x2000), 23)
  check("NT0 ($23C0) attribute cell(0,0)", readPpu(0x23c0), 51)
  check("NT1 ($2400) tile(0,0), screen(1,2) local(0,0)", readPpu(0x2400), 22)
  check("NT1 ($27C0) attribute cell(0,0)", readPpu(0x27c0), 238)
  check("NT2 ($2800) tile(0,0), screen(2,1) local(0,0)", readPpu(0x2800), 13)
  check("NT2 ($2BC0) attribute cell(0,0)", readPpu(0x2bc0), 153)
  check("NT3 ($2C00) tile(0,0), screen(1,1) local(0,0)", readPpu(0x2c00), 12)
  check("NT3 ($2FC0) attribute cell(0,0)", readPpu(0x2fc0), 68)

  if failures == 0 then
    log("ALL PASS (within the disclosed two-screen-mirroring limitation)")
    emu.stop(0)
  end
end

local function onFrame()
  frame = frame + 1
  if not reached and frame > 120 then
    fail(EXIT_NEVER_REACHED, "RENDER_TEST_DONE never reached within 120 frames")
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addMemoryCallback(onRenderTestDone, emu.callbackType.exec, RENDER_TEST_DONE)
```

### `proto-tools/build_quadrant_fixture.mjs`, new this round

```js
#!/usr/bin/env node
// build_quadrant_fixture.mjs -- review 4, finding 9's own required
// "full-render Mesen quadrant template" builder. Assembles minimal-u512
// (whose boot.asm already carries the sw_render_window PROTOTYPE hook,
// docs/design-streamed-worlds.md's own F2 hook, repointed at the real r2
// fixture this round), resolves RENDER_TEST_DONE fresh from main.fns, and
// writes the substituted Lua plus the header-patched ROM.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { applyHeaderPatch, MAPPERS } from '../shared/cartridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boardDir = path.join(ROOT, 'minimal-u512');
const buildDir = path.join(boardDir, 'build');
const TEMPLATE_PATH = path.join(ROOT, 'proto-tools/sw_quadrant_check.lua.template');

const result = execFileSync('nesasm', ['-s', 'main.asm'], { cwd: buildDir, encoding: 'utf8' });
if (/\berror\b/i.test(result) || /bank overflow/i.test(result)) {
  throw new Error(`nesasm reported a real diagnostic despite exit 0:\n${result}`);
}

const fnsText = fs.readFileSync(path.join(buildDir, 'main.fns'), 'utf8');
const syms = {};
for (const line of fnsText.split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) syms[m[1]] = parseInt(m[2], 16);
}
if (!Number.isFinite(syms.render_test_done)) throw new Error('render_test_done missing from main.fns');

const romBytesRaw = new Uint8Array(fs.readFileSync(path.join(buildDir, 'main.nes')));
const projectJson = JSON.parse(fs.readFileSync(path.join(boardDir, 'project.json'), 'utf8'));
const cartridge = projectJson.project?.cartridge ?? projectJson.cartridge;
const mapper = MAPPERS.find((m) => m.id === cartridge.mapper);
const patched = applyHeaderPatch(romBytesRaw.slice(), mapper, cartridge, true);
// Review 5, finding 11: assert the real mirroring header bit rather than
// assuming it -- the earlier round's own "jsnes four-screen collapse"
// finding was entirely a header-patch artefact (a script loading the raw,
// unpatched main.nes, header byte 6 = $E1/vertical, alongside a patched
// $EB/four-screen fixture elsewhere). $EB is FORGE-PATCHES.md's own
// documented mapper-30 four-screen encoding.
if (patched[6] !== 0xeb) {
  throw new Error(`expected header byte 6 = 0xEB (four-screen), got 0x${patched[6].toString(16)} -- refusing to build a quadrant check against the wrong mirroring mode`);
}
const romPath = path.join(buildDir, 'sw_quadrant_check.nes');
fs.writeFileSync(romPath, Buffer.from(patched));

const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
const token = '__RENDER_TEST_DONE__';
const value = `0x${syms.render_test_done.toString(16)}`;
const occurrences = template.split(token).length - 1;
if (occurrences !== 1) throw new Error(`expected exactly one ${token}, found ${occurrences}`);
const generated = template.split(token).join(value);
const luaPath = path.join(buildDir, 'sw_quadrant_check.lua');
fs.writeFileSync(luaPath, generated, 'utf8');

console.log('render_test_done =', value);
console.log('rom:', romPath);
console.log('lua:', luaPath);
```

### `proto-tools/diag_quadrant_expected.mjs`, the independent oracle the quadrant check's own expected values come from

```js
// diag_quadrant_expected.mjs -- independent oracle for sw_quadrant_check.lua.template's
// own expected values, re-implementing the SAME algorithm streamworld.asm's
// sw_rw_probe/sw_col_at_offset/sw_row_at_offset/sw_rw_col_delta/
// sw_rw_row_delta implement (the shape diag_t8_design.mjs already
// established), for T8's own aligned odd/odd origin (screenCol=1,
// localCol=0, screenRow=1, localRow=0), against the real r2 fixture
// (build_r2_fixture.mjs, markers 1,2,3/11,12,13/21,22,23).
function wbase(screenAxis, local, half) { return (screenAxis & 1) * half + local; }
function colAtOffset(offset, winScreen, winLocal) { const sum = offset + winLocal; return { screen: winScreen + (sum >> 4), local: sum & 15 }; }
function rowAtOffset(offset, winScreen, winLocal) { let sum = offset + winLocal; let screen = winScreen; while (sum >= 15) { sum -= 15; screen += 1; } return { screen, local: sum }; }
function colDelta(torus, wb) { return (torus - wb) & 31; }
function rowDelta(torus, wb) { let v = (torus + 30 - wb); if (v >= 30) v -= 30; return v; }
function marker(screenCol, screenRow) { const table = [[1, 2, 3], [11, 12, 13], [21, 22, 23]]; return table[screenRow]?.[screenCol]; }
function idAt(screenCol, screenRow, localCol, localRow) {
  const m = marker(screenCol, screenRow);
  const offset = localRow * 16 + localCol;
  if (offset === 0) return m;
  return (offset * 5 + m) % 64;
}

const winColScreen = 1, winColLocal = 0, winRowScreen = 1, winRowLocal = 0;
const wbaseCol = wbase(winColScreen, winColLocal, 16);
const wbaseRow = wbase(winRowScreen, winRowLocal, 15);
const ntx = [0, 16, 0, 16];
const nty = [0, 0, 15, 15];

function worldAt(nt, blockRow, blockCol) {
  const torusCol = ntx[nt] + blockCol;
  const torusRow = nty[nt] + blockRow;
  const dCol = colDelta(torusCol, wbaseCol);
  const dRow = rowDelta(torusRow, wbaseRow);
  const { screen: sc, local: lc } = colAtOffset(dCol, winColScreen, winColLocal);
  const { screen: sr, local: lr } = rowAtOffset(dRow, winRowScreen, winRowLocal);
  return { sc, sr, lc, lr, id: idAt(sc, sr, lc, lr) };
}

for (let nt = 0; nt < 4; nt++) {
  const tl = worldAt(nt, 0, 0);
  const tr = worldAt(nt, 0, 1);
  const bl = worldAt(nt, 1, 0);
  const br = worldAt(nt, 1, 1);
  const attrByte = (tl.id % 4) | ((tr.id % 4) << 2) | ((bl.id % 4) << 4) | ((br.id % 4) << 6);
  console.log(`NT${nt}: tile(0,0)=screen(${tl.sc},${tl.sr}) local(${tl.lc},${tl.lr}) id=${tl.id}, attr(cell 0,0)=${attrByte} (0x${attrByte.toString(16)})`);
}
```

**Retracted this round (review 5, finding 11): the earlier "jsnes four-screen collapse" claim was a
header-patch artefact in this document's own test methodology, not a core defect.** An earlier
draft of this same scenario, run first under jsnes as a cheap sanity check, loaded
`minimal-u512/build/main.nes` — the **raw, unpatched** assembler output, whose own iNES header byte
6 is `$E1` (vertical mirroring, `nesasm`'s own default when the project's real four-screen bit has
not yet been patched in) — while the Mesen check above (and every other real fixture this design
measures against) loads `main.patched.nes`, whose header is `$EB` (four-screen, correctly patched).
Re-verified directly this round: `main.patched.nes` writes 41/42/43/44 to the four nametable bases
and reads all four back independently, `[41,42,43,44]`; the raw, unpatched `main.nes` reproduces
the exact "collapse" the earlier draft found, `[43,44,0,0]` — because it genuinely *is* requesting
two-screen (vertical) mirroring, not four-screen, so a real, correct PPU implementation collapses it
that way. `renderer/emulator/core/ppu/index.js:183-255` does maintain four independent nametables
in four-screen mode, unmodified this round and not in question — the earlier draft simply compared
a patched-header Mesen ROM against an unpatched-header jsnes one and attributed the header's own
real difference to the wrong emulator. **No core change is made or was ever needed.** Every harness
in this suite that loads a ROM for a four-screen-mirroring test must load the header-patched file
and may assert the header byte directly as a setup guard — the concrete, cheap fix this finding
recommends, adopted in `diag_r5_fill.mjs`/`diag_r5_projection.mjs`/`diag_r5_probe_restore.mjs`
above, all of which load `main.patched.nes` exclusively.

### `proto-tools/build_dma_control_fixture.mjs`, new this round — the required DMA-prologue control

Every deadline measurement above reads scanline/cycle at `nmi_rti`'s own exec, at the END of the
real `engine/boot.asm` NMI handler — which already performs the ordinary `lda #$02 / sta $4014` OAM
DMA (513-514 CPU cycles) at its own top, before `vram_drain`/`sw_nmi_stream` ever run, so every
prior margin figure already has DMA's real cost baked in. This script proves that causally rather
than asserting it from reading the source: it neutralises the DMA write in a scratch copy of
`boot.asm` (`sta $4014` → `nop`), rebuilds, and re-runs the identical deadline check, reporting the
before/after exit code so DMA's own real contribution is an observed delta.

```js
#!/usr/bin/env node
// build_dma_control_fixture.mjs -- review 4, finding 9's own "DMA-prologue
// template/control": every sw_nmi_deadline.lua measurement so far reads
// scanline/cycle at nmi_rti's OWN exec, at the END of the real
// engine/boot.asm nmi handler -- which already performs the ordinary
// `lda #$02 / sta $4014` OAM DMA (513-514 CPU cycles) at its own top,
// BEFORE vram_drain/sw_nmi_stream ever run. So every prior margin figure
// already has DMA's cost baked in -- but nothing yet PROVED that, rather
// than merely asserting it by reading the source. This script neutralises
// the DMA write in a scratch copy of boot.asm (`sta $4014` -> `nop`, one
// byte shorter -- nesasm reassembles every later address itself, no manual
// realignment needed), rebuilds and re-runs the identical deadline check,
// and reports the margin BEFORE and AFTER so the DMA's own real
// contribution is an observed delta, not an assumption. Restores the
// original boot.asm afterward, matching build_deadline_fixture.mjs's own
// no-side-effects discipline for streamworld.asm.
//
//   node proto-tools/build_dma_control_fixture.mjs <boardDir> [chunkLen=1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , boardDirArg, chunkLenArg] = process.argv;
if (!boardDirArg) {
  console.error('usage: node proto-tools/build_dma_control_fixture.mjs <boardDir> [chunkLen=1]');
  process.exit(2);
}
const chunkLen = chunkLenArg ? Number(chunkLenArg) : 1;
const boardDir = path.resolve(ROOT, boardDirArg);
const bootPath = path.join(boardDir, 'build', 'boot.asm');

const original = fs.readFileSync(bootPath, 'utf8');
const pattern = /  sta \$4014                 ; OAM DMA from \$0200\n/;
if (!pattern.test(original)) throw new Error('expected exactly one matching OAM DMA line in boot.asm -- source shape changed, update this script');
const patched = original.replace(pattern, '  nop                        ; DMA control: neutralised by build_dma_control_fixture.mjs\n');
fs.writeFileSync(bootPath, patched);

function runOnce(label) {
  execFileSync('node', ['proto-tools/build_deadline_fixture.mjs', boardDirArg, `${boardDirArg}/build`, String(chunkLen), String(chunkLen), 'even'], { cwd: ROOT, stdio: 'inherit' });
  const mesen = '/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen';
  let exitCode = 0;
  let output = '';
  try {
    output = execFileSync(mesen, ['--testRunner', `${boardDir}/build/sw_nmi_deadline.lua`, `${boardDir}/build/sw_nmi_deadline.nes`], { encoding: 'utf8' });
  } catch (e) {
    exitCode = e.status;
    output = (e.stdout || '') + (e.stderr || '');
  }
  const m = output.match(/finished at scanline (\d+), cycle (\d+) \(rti settles on scanline (\d+)\)/);
  console.log(`\n[${label}] exit=${exitCode}`);
  if (m) console.log(`[${label}] nmi_rti scanline=${m[1]} cycle=${m[2]}, rti settles at scanline ${m[3]} (deadline: 260)`);
  else console.log(`[${label}] (no PASS line -- deadline missed or other failure)\n${output}`);
  return { exitCode, output };
}

try {
  console.log(`=== WITH DMA removed (control), chunk=${chunkLen} ===`);
  const withoutDma = runOnce('DMA-OFF');
  fs.writeFileSync(bootPath, original);
  console.log(`\n=== WITH DMA present (normal), chunk=${chunkLen} ===`);
  const withDma = runOnce('DMA-ON');
  console.log('\nDMA-off exit:', withoutDma.exitCode, ' DMA-on exit:', withDma.exitCode);
} finally {
  fs.writeFileSync(bootPath, original);
}
```

### `proto-tools/streamworld_hot.asm`, new this round — the source the hot-only Placement figures (653/827 bytes free, `sample-u512`/`sample-mmc3`) actually measure

Extracted from the full `streamworld.asm` (§ Appendix A): only `sw_nmi_stream`/`sw_ns_draw_block`/
`sw_ns_draw_attr`, the NMI-resident hot path — the cold path (`sw_goto`, `sw_locate_current`,
`sw_cross_*`, the strip starters, `sw_render_window`) is not included here at all, which is the
whole point of the split the Placement section's own conclusion rests on.

```asm
; streamworld_hot.asm -- R4/R5 prototype: the NMI-resident HOT PATH only
; (sw_nmi_stream/sw_ns_draw_block/sw_ns_draw_attr), extracted from the full
; streamworld.asm for fix round 3's own R4/R5 measurements. Not part of the
; shipping engine. See docs/design-streamed-worlds.md section 5 (R5
; placement) for why this split is the real one: the cold path (sw_goto,
; sw_locate_current, sw_cross_*, sw_stream_start_*, sw_render_window) is
; not included here at all.

; streamworld.asm -- PROTOTYPE for docs/design-streamed-worlds.md, Q3.
; FIX ROUND 2: rebuilt to answer review 2's findings R1/R2/R6/R11 -- see the
; design doc's own §13 changelog. Not part of the shipping engine.
;
; R1's own correction, adopted: the physical ring position of a world
; metatile is a function of its ABSOLUTE (screenCol,localCol)/(screenRow,
; localRow), never of "how far it sits from the window's current left/top
; edge" -- the fix round 1 defect (round 1 tied physical position to a
; window-RELATIVE offset, which is wrong the moment the window slides, since
; retained content must keep its physical slot while only the entering edge
; moves). Because a screen (16 cols x 15 rows) is exactly half the 32x30
; torus on each axis, the physical half a metatile belongs to is simply its
; owning screen's own row/column PARITY (even screenCol -> left half, odd ->
; right half; even screenRow -> top half, odd -> bottom half), and its tile
; position within that half is exactly 2*localCol / 2*localRow -- no modulo,
; no window-relative math, at the point of drawing. This is FALLEN STAR's
; own wbase_x/wbase_y (win_bx mod 32, win_by mod 30) fact, expressed in this
; project's own (screen,local) terms rather than a flat linear block index.
STREAM_SCREENS_PER_REGION = 24   ; floor(8176/338) -- SCREEN_REGION_BYTES,
                                  ; R6's own uncapped 338-byte record (240
                                  ; terrain + 98 worst-case entity/bound
                                  ; metadata, MAX_ENTITIES=8 * 9 + 1 count +
                                  ; BOUND_CAP=8 * 3 + 1 count = 73+25=98 --
                                  ; NO per-screen entity cap, unlike the
                                  ; round-1/round-2 256-byte record this
                                  ; replaces)
STREAM_SCREEN_BYTES = 338
SW_STREAM_CHUNK = 3              ; measured both at 1 and 3 this round (R4)

; ---- RAM: chained off msg_name_idx (engine/constants.asm:874).
sw_col            = msg_name_idx+1   ; player's current absolute screen col
sw_row            = sw_col+1         ; player's current absolute screen row
sw_col_rem        = sw_row+1         ; sw_col mod STREAM_SCREENS_PER_REGION
sw_col_region     = sw_col_rem+1     ; sw_col div STREAM_SCREENS_PER_REGION
; sw_col_byte_lo/hi -- R6's own fix: STREAM_SCREEN_BYTES (338) is not a
; power of two and not page-aligned, so the round-1/2 "OR col_rem into
; mtptr_hi" trick (valid only for a 256-byte stride) no longer applies.
; This is the 16-bit byte offset col_rem*338 WITHIN the current region,
; maintained INCREMENTALLY (+/-338 per crossing, sw_cross_right/left) so the
; hot path (sw_locate_current) never multiplies at all -- only sw_goto's own
; cold, arbitrary-column path does, via a bounded repeated-add loop.
sw_col_byte_lo    = sw_col_region+1
sw_col_byte_hi    = sw_col_byte_lo+1
sw_row_bank_base  = sw_col_byte_hi+1
sw_base_bank      = sw_row_bank_base+1
sw_regions_per_row = sw_base_bank+1
sw_grid_w         = sw_regions_per_row+1
sw_grid_h         = sw_grid_w+1
sw_tmp            = sw_grid_h+1
sw_tmp2           = sw_tmp+1
sw_tmp3           = sw_tmp2+1
sw_tmp4           = sw_tmp3+1
sw_tmp5           = sw_tmp4+1        ; sw_goto's own byte_lo scratch
sw_tmp6           = sw_tmp5+1        ; sw_goto's own byte_hi scratch

; ---- window origin, block (metatile) granular, INDEPENDENT of screen-record
; addressing. win_col_local (0-15) and win_row_local (0-14) ARE the physical
; local coordinate within whichever half win_col_screen/win_row_screen's own
; PARITY selects -- this is the whole R1 fix: nothing here is "window-
; relative offset from the left/top edge" any more.
win_col_screen    = sw_tmp6+1
win_col_local     = win_col_screen+1   ; 0-15
win_row_screen    = win_col_local+1
win_row_local     = win_row_screen+1   ; 0-14

; ---- streaming state + entering-edge buffer.
; st_vary is now GENUINELY the physical ring coordinate (0-29 for a column
; strip, 0-31 for a row strip) -- R1's own fix. It is INITIALISED at arm
; time from the window's own current varying-axis start (parity*half +
; local), and WRAPPED (not merely incremented) by sw_nmi_stream.
st_active   = win_row_local+1     ; 0 idle, 1 column strip, 2 row strip
st_cur      = st_active+1
st_len      = st_cur+1
st_ftile    = st_len+1            ; fixed tile coordinate (2*local of the
                                    ; entering edge's own screen/local pair)
st_fnt      = st_ftile+1          ; fixed nametable-hi contribution (parity
                                    ; of the entering edge's own screenCol/Row
                                    ; * 4 or 8) -- R1's fix: round 1 left this
                                    ; 0 for every row strip, always wrong
st_vary     = st_fnt+1
ss_i        = st_vary+1
sbuf        = ss_i+1              ; @size=32

attr_shadow = $0600             ; @size=256 -- $0600 collides with flash_driver, design doc §5/§11

; ---- NMI-private scratch, zero page, chained off cam_slide_b_pending.
; interrupt at any point).
sw_ns_row     = cam_slide_b_pending+1
sw_ns_col     = sw_ns_row+1
sw_ns_nt      = sw_ns_col+1
sw_ns_q       = sw_ns_nt+1
sw_ns_pb      = sw_ns_q+1
sw_ns_cm      = sw_ns_pb+1
sw_ns_ai      = sw_ns_cm+1
sw_ns_row_lo  = sw_ns_ai+1
sw_ns_row_hi  = sw_ns_row_lo+1
sw_rw_shadow_lo = sw_ns_row_hi+1
sw_rw_shadow_hi = sw_rw_shadow_lo+1
sw_ns_chunk   = sw_rw_shadow_hi+1    ; NEW this round -- R11

; TEMPORARY debug export -- resolves zero-page/absolute equate chain
; addresses for the JS/Mesen verification harnesses (fix round 3's own R4
; Mesen deadline check reads the second block below; this file is a
; prototype, never part of the shipping engine, and this table never ships).
; Both blocks are LOW/HIGH byte pairs at a real, .fns-resolvable label, so a
; harness computes every address fresh from whatever exact build it is
; testing rather than trusting a copied-in literal (CLAUDE.md's own
; "labels, not addresses" discipline, applied to a prototype that has no
; .fns entries for its own `=` equates at all).
sw_debug_addrs:
  .db LOW(sw_ns_row), HIGH(sw_ns_row)
  .db LOW(sw_ns_col), HIGH(sw_ns_col)
  .db LOW(sw_ns_nt), HIGH(sw_ns_nt)
  .db LOW(sw_ns_row_lo), HIGH(sw_ns_row_lo)
  .db LOW(sw_ns_row_hi), HIGH(sw_ns_row_hi)
  .db LOW(sw_ns_chunk), HIGH(sw_ns_chunk)
  .db LOW(cam_slide_b_pending), HIGH(cam_slide_b_pending)

; R4's own deadline-harness addresses: the streaming state sw_nmi_stream/
; sw_ns_draw_block actually read, so a Mesen script can poke a chunk
; directly into flight without driving the strip-arming machinery first --
; the identical simplification flash_nmi_timing.lua.template already makes
; by poking FLASH_LEFT directly rather than simulating a full Flash arm.
sw_debug_addrs2:
  .db LOW(st_active), HIGH(st_active)
  .db LOW(st_cur), HIGH(st_cur)
  .db LOW(st_len), HIGH(st_len)
  .db LOW(st_ftile), HIGH(st_ftile)
  .db LOW(st_fnt), HIGH(st_fnt)
  .db LOW(st_vary), HIGH(st_vary)
  .db LOW(sbuf), HIGH(sbuf)

; ==========================================================================
; sw_nmi_stream -- draw SW_STREAM_CHUNK metatiles per vblank from sbuf. R11's
; own fix: uses sw_ns_chunk (a DEDICATED, NMI-exclusive zero-page byte),
; never sw_tmp4 -- round 1/2's own sw_tmp4 was ALSO sw_goto's row-
; accumulator scratch, a real reentrancy bug (an NMI landing mid-sw_goto,
; which runs from main-loop code, would corrupt sw_goto's own in-flight
; computation the instant sw_nmi_stream also touched sw_tmp4). R1's own fix:
; st_vary is WRAPPED (mod 30 for a column strip, mod 32 for a row strip),
; not merely incremented forever.
; ==========================================================================
sw_nmi_stream:
  lda st_active
  bne sw_ns_go
  rts
sw_ns_go:
  lda #SW_STREAM_CHUNK
  sta <sw_ns_chunk
sw_ns_loop:
  lda st_cur
  cmp st_len
  bcs sw_ns_finish
  jsr sw_ns_draw_block
  inc st_cur
  lda st_cur
  cmp st_len
  bcs sw_ns_finish
  inc st_vary
  lda st_active
  cmp #1
  bne sw_ns_wrap32
  lda st_vary
  cmp #30
  bne sw_ns_wrapdone
  lda #0
  sta st_vary
  jmp sw_ns_wrapdone
sw_ns_wrap32:
  lda st_vary
  cmp #32
  bne sw_ns_wrapdone
  lda #0
  sta st_vary
sw_ns_wrapdone:
  dec <sw_ns_chunk
  bne sw_ns_loop
  rts
sw_ns_finish:
  lda #0
  sta st_active
  rts

; --------------------------------------------------------------------------
; sw_ns_draw_block -- draws metatile sbuf[st_cur] at its own TORUS position.
; UNCHANGED from round 2's own shape: this split logic (physical row 15 /
; column 16 boundary) was always correct once st_vary genuinely holds the
; physical ring coordinate -- R1's own bug was entirely in how st_vary got
; its starting value and how it wrapped, both fixed above, not in this
; routine's own split. X = metatile id.
; --------------------------------------------------------------------------
sw_ns_draw_block:
  ldy st_cur
  ldx sbuf,y
  lda st_active
  cmp #1
  bne sw_ndb_row
  lda st_ftile
  sta <sw_ns_col
  lda st_vary
  cmp #15
  bcc sw_ndb_col_top
  sec
  sbc #15
  asl a
  sta <sw_ns_row
  lda st_fnt
  clc
  adc #$08
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_col_top:
  asl a
  sta <sw_ns_row
  lda st_fnt
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_row:
  lda st_ftile
  sta <sw_ns_row
  lda st_vary
  cmp #16
  bcc sw_ndb_row_left
  sec
  sbc #16
  asl a
  sta <sw_ns_col
  lda st_fnt
  clc
  adc #$04
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_row_left:
  asl a
  sta <sw_ns_col
  lda st_fnt
  sta <sw_ns_nt
sw_ndb_addr:
  lda <sw_ns_row
  lsr a
  lsr a
  lsr a
  clc
  adc #$20
  clc
  adc <sw_ns_nt
  sta <sw_ns_row_hi
  lda <sw_ns_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  ora <sw_ns_col
  sta <sw_ns_row_lo
  bit $2002
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  lda mt_tl,x
  sta $2007
  lda mt_tr,x
  sta $2007
  lda <sw_ns_row_lo
  clc
  adc #32
  sta <sw_ns_row_lo
  bcc sw_ns_nohi
  inc sw_ns_row_hi
sw_ns_nohi:
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  lda mt_bl,x
  sta $2007
  lda mt_br,x
  sta $2007
  ; fall through to the attribute RMW (X still = metatile id)

sw_ns_draw_attr:
  lda <sw_ns_col
  lsr a
  and #1
  sta <sw_ns_q
  lda <sw_ns_row
  lsr a
  and #1
  asl a
  ora <sw_ns_q
  sta <sw_ns_q
  lda mt_pal,x
  ldy <sw_ns_q
  beq sw_nda_pdone
sw_nda_pshift:
  asl a
  asl a
  dey
  bne sw_nda_pshift
sw_nda_pdone:
  sta <sw_ns_pb
  lda #3
  ldy <sw_ns_q
  beq sw_nda_cdone
sw_nda_cshift:
  asl a
  asl a
  dey
  bne sw_nda_cshift
sw_nda_cdone:
  eor #$FF
  sta <sw_ns_cm
  lda <sw_ns_row
  lsr a
  lsr a
  asl a
  asl a
  asl a
  sta <sw_ns_ai
  lda <sw_ns_col
  lsr a
  lsr a
  ora <sw_ns_ai
  sta <sw_ns_ai
  lda <sw_ns_nt
  asl a
  asl a
  asl a
  asl a
  ora <sw_ns_ai
  sta <sw_ns_row_lo
  lda #HIGH(attr_shadow)
  sta <sw_ns_row_hi
  ldy #0
  lda [sw_ns_row_lo],y
  and <sw_ns_cm
  ora <sw_ns_pb
  sta [sw_ns_row_lo],y
  pha
  lda <sw_ns_nt
  clc
  adc #$23
  sta <sw_ns_row_hi
  lda <sw_ns_ai
  ora #$C0
  sta <sw_ns_row_lo
  bit $2002
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  pla
  sta $2007
  rts
```

### `proto-tools/diag_f9_worst_chunk.mjs`, new this round -- fix round 9, finding 1's own isolated-cycle worst-chunk sweep (both orientations, both parities, every st_vary start, final/non-final), used to CHOOSE the Mesen fixture's own configuration below, not to time it authoritatively

```js
// Fix round 9, finding 1 (review 7): the arbitration fixture always arms a
// column, st_vary=0, st_len=3 -- always the strip's FINAL chunk, never a
// continuation, never a row strip, never a wrap boundary. This script
// enumerates the isolated cost of sw_nmi_stream (the real routine the NMI
// calls this round, not a stand-in) across the real parameter space --
// both orientations (st_active 1=col/2=row), both physical parities
// (st_ftile/st_fnt even/odd), every st_vary starting position (0..31),
// and both "final chunk" (st_len==compiled chunk) and "non-final chunk"
// (st_len > compiled chunk, so the wrap/continuation bookkeeping actually
// runs) -- to find the real worst case, independently reproducing/
// confirming the reviewer's own 1,396-cycle finding before it is fed into
// a real Mesen fixture (build_f9_worst_chunk_fixture.mjs).
//
// Board: sample-u512 and sample-mmc3, the same two boards decision A's own
// Mesen proof already uses (not minimal-u512) -- this is the real
// arbitrated-NMI shape, compiled at the CHOSEN chunk size (3), not a
// prototype-only board.
//
//   node proto-tools/diag_f9_worst_chunk.mjs <boardDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';
import { applyHeaderPatch, MAPPERS } from '../shared/cartridge.js';
import { scanEquates, resolveEquates } from '../test/lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , boardDirArg, chunkArg] = process.argv;
if (!boardDirArg) { console.error('usage: node proto-tools/diag_f9_worst_chunk.mjs <boardDir> [chunkLen=3]'); process.exit(2); }
const boardDir = path.resolve(ROOT, boardDirArg);
const buildDir = path.join(boardDir, 'build');
const wantChunk = chunkArg ? Number(chunkArg) : 3;

// SW_STREAM_CHUNK's CHECKED-IN value on this board is 1 (the pre-decision-A
// default); decision A's own chosen value (3) is patched in at build time by
// every Mesen fixture script (build_arb_fixtures.mjs's own withCompiledChunk)
// and NEVER left in the tree -- this script follows the identical discipline:
// patch, rebuild, load, then restore the original source unconditionally.
const SW_ASM_PATH = path.join(buildDir, 'streamworld.asm');
const originalStreamworld = fs.readFileSync(SW_ASM_PATH, 'utf8');
{
  const pattern = /^SW_STREAM_CHUNK = \d+(?=\s)/m;
  const occurrences = (originalStreamworld.match(pattern) || []).length;
  if (occurrences !== 1) throw new Error(`expected exactly one SW_STREAM_CHUNK definition, found ${occurrences}`);
  fs.writeFileSync(SW_ASM_PATH, originalStreamworld.replace(pattern, `SW_STREAM_CHUNK = ${wantChunk}`));
}
function restore() { fs.writeFileSync(SW_ASM_PATH, originalStreamworld); }
process.on('exit', restore);
try {
  const result = execFileSync('nesasm', ['-s', 'main.asm'], { cwd: buildDir, encoding: 'utf8' });
  if (/\berror\b/i.test(result) || /bank overflow/i.test(result)) {
    throw new Error(`nesasm reported a real diagnostic despite exit 0:\n${result}`);
  }
} catch (e) {
  restore();
  throw e;
}

function fnsToMap(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
    if (m) map[m[1]] = parseInt(m[2], 16);
  }
  return map;
}
const fnsText = fs.readFileSync(path.join(buildDir, 'main.fns'), 'utf8');
const syms = fnsToMap(fnsText);
function addr(name) {
  if (!Number.isFinite(syms[name])) throw new Error(`${name} missing from main.fns`);
  return syms[name];
}

// Resolve the chained zero-page/RAM equates (st_active..sbuf, shake_left,
// cam_dirty, split_mode) straight out of this build's own constants.asm /
// streamworld.asm, the same discipline test/lib/equates.js exists for
// (CLAUDE.md's "nesasm zero page is absolute" trap section) -- never a
// hand-copied literal.
const constantsText = fs.readFileSync(path.join(buildDir, 'constants.asm'), 'utf8');
const streamworldText = fs.readFileSync(path.join(buildDir, 'streamworld.asm'), 'utf8');
const pending = new Map();
scanEquates(constantsText, pending);
scanEquates(streamworldText, pending);
const symbols = new Map();
resolveEquates(pending, symbols);
function ram(name) {
  const v = symbols.get(name);
  if (!Number.isFinite(v)) throw new Error(`${name} not resolved out of constants.asm/streamworld.asm`);
  return v;
}
const RAM = {};
for (const n of ['st_active', 'st_cur', 'st_len', 'st_ftile', 'st_fnt', 'st_vary', 'sbuf', 'shake_left', 'cam_dirty', 'box_state', 'split_mode']) {
  RAM[n] = ram(n);
}

const headerBytes = fs.readFileSync(path.join(buildDir, 'main.nes')).subarray(0, 16);
const projectJson = JSON.parse(fs.readFileSync(path.join(boardDir, 'project.json'), 'utf8'));
const cartridge = projectJson.project?.cartridge ?? projectJson.cartridge;
const mapper = MAPPERS.find((m) => m.id === cartridge.mapper);
if (!mapper) throw new Error(`unknown mapper id ${cartridge.mapper}`);
const romBytesRaw = new Uint8Array(fs.readFileSync(path.join(buildDir, 'main.nes')));
const patched = applyHeaderPatch(romBytesRaw.slice(), mapper, cartridge, true);

function freshNes() {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(patched);
  for (let i = 0; i < 5; i++) nes.frame();
  nes.mmap.write(0x2000, 0);
  return nes;
}

// SW_STREAM_CHUNK, read back from the build's own source (the chosen value,
// 3, not hardcoded).
const chunkMatch = streamworldText.match(/^SW_STREAM_CHUNK = (\d+)/m);
if (!chunkMatch) throw new Error('SW_STREAM_CHUNK not found in streamworld.asm');
const CHUNK = Number(chunkMatch[1]);

function armAndRun({ active, ftile, fnt, vary, len }) {
  const nes = freshNes();
  const m = nes.cpu.mem;
  m[RAM.st_active] = active;
  m[RAM.st_cur] = 0;
  m[RAM.st_len] = len;
  m[RAM.st_ftile] = ftile;
  m[RAM.st_fnt] = fnt;
  m[RAM.st_vary] = vary;
  for (let i = 0; i < 32; i++) m[RAM.sbuf + i] = i % 4; // valid metatile ids (0-3 present in every fixture tileset)
  return callRoutine(nes, addr('sw_nmi_stream'));
}

console.log(`board: ${boardDirArg} (mapper ${mapper.name}), compiled SW_STREAM_CHUNK=${CHUNK}`);

let worst = { cycles: -1 };
const wrapMod = { 1: 30, 2: 32 };
for (const active of [1, 2]) {
  const mod = wrapMod[active];
  for (const [ftile, fnt, parityName] of [[0, 0, 'even'], [2, 8, 'odd']]) {
    for (let vary = 0; vary < mod; vary++) {
      for (const finalChunk of [true, false]) {
        const len = finalChunk ? CHUNK : mod; // non-final: strip continues past this vblank's chunk
        const cycles = armAndRun({ active, ftile, fnt, vary, len });
        if (cycles > worst.cycles) {
          worst = { cycles, active, ftile, fnt, parityName, vary, len, finalChunk };
        }
      }
    }
  }
}

console.log(`worst isolated sw_nmi_stream cost: ${worst.cycles} cycles`);
console.log(`  orientation: ${worst.active === 1 ? 'column' : 'row'} (st_active=${worst.active})`);
console.log(`  parity: ${worst.parityName} (st_ftile=${worst.ftile}, st_fnt=${worst.fnt})`);
console.log(`  st_vary start: ${worst.vary}, st_len: ${worst.len} (${worst.finalChunk ? 'final chunk' : 'non-final, wrap bookkeeping runs'})`);

// Reviewer's own two cited figures, reproduced for cross-check.
const reviewerFinal = armAndRun({ active: 1, ftile: 0, fnt: 0, vary: 0, len: CHUNK });
const reviewerFinalOdd = armAndRun({ active: 1, ftile: 2, fnt: 8, vary: 0, len: CHUNK });
console.log(`cross-check, fixture-shaped final chunks: even=${reviewerFinal} odd=${reviewerFinalOdd} (reviewer cited 1241/1287)`);
const reviewerWorst = armAndRun({ active: 2, ftile: 2, fnt: 0, vary: 29, len: 32 });
console.log(`cross-check, reviewer's own cited worst (row, ftile=2,fnt=0,vary=29,non-final): ${reviewerWorst} (reviewer cited 1396)`);
```

### `proto-tools/build_f9_worst_chunk_fixture.mjs`, new this round -- fix round 9, finding 1's own real Mesen fixture at the worst configuration diag_f9_worst_chunk.mjs found, against the full arbitrated NMI (camera publication, active shake, MMC3's own longer split branch)

```js
#!/usr/bin/env node
// Fix round 9, finding 1 (review 7): times the WORST non-final strip chunk
// -- not the arbitration fixture's always-final, always-column, st_vary=0
// case -- against the real, full arbitrated NMI (OAM DMA, camera $2000/
// $2005 rewrite with cam_dirty CLEAR so the real per-vblank refresh runs,
// an ACTIVE Shake, and on sample-mmc3 the split's own LONGER enabled branch
// via box_state != BOX_CLOSED, so split_arm takes the split_arm_go path,
// not the two-instruction SPL_OFF shortcut), in real Mesen, both boards.
//
// Worst parameters (found by proto-tools/diag_f9_worst_chunk.mjs's own
// exhaustive isolated-cycle sweep on sample-u512, the uncontaminated board --
// sample-mmc3's own isolated-cycle numbers are NOT trustworthy for this
// search: mapper4's own scanline-IRQ counter can fire mid-callRoutine in the
// jsnes harness regardless of the stub's F_INTERRUPT mask, intermittently
// inflating an isolated MMC3 measurement by 300-400 cycles for reasons
// unrelated to sw_nmi_stream's own real cost -- confirmed by timing a
// trivial 3-instruction routine on the same board and seeing the identical
// contamination. The WORST PARAMETERS themselves (which branch/wrap path
// sw_nmi_stream takes) do not depend on the mapper at all -- the routine's
// compiled bytes are confirmed byte-identical between boards (both 80
// bytes, sw_nmi_stream..sw_ns_draw_block) -- so the isolated U512 search is
// what chooses this fixture's own row/parity/vary/non-final configuration;
// Mesen (a real, accurate full-system emulator, not the isolated JS stub)
// is what actually times it on both boards, sidestepping the contamination
// entirely): row strip, odd parity, st_vary=29, st_len > compiled chunk
// (non-final, wrap bookkeeping runs on the chunk's own last block).
//
//   node proto-tools/build_f9_worst_chunk_fixture.mjs <boardDir> [outDir]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { applyHeaderPatch, MAPPERS } from '../shared/cartridge.js';
import { Emulator } from '../renderer/emulator/runcontrol.js';
import { scanEquates, resolveEquates } from '../test/lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , boardDirArg, outDirArg, chunkArg] = process.argv;
if (!boardDirArg) { console.error('usage: node proto-tools/build_f9_worst_chunk_fixture.mjs <boardDir> [outDir] [chunkLen=3]'); process.exit(2); }
const boardDir = path.resolve(ROOT, boardDirArg);
const buildDir = path.join(boardDir, 'build');
const outDir = outDirArg ? path.resolve(ROOT, outDirArg) : buildDir;
const wantChunk = chunkArg ? Number(chunkArg) : 3;

function fnsToMap(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
    if (m) map[m[1]] = parseInt(m[2], 16);
  }
  return map;
}

const SW_ASM_PATH = path.join(buildDir, 'streamworld.asm');
const originalStreamworld = fs.readFileSync(SW_ASM_PATH, 'utf8');
{
  const pattern = /^SW_STREAM_CHUNK = \d+(?=\s)/m;
  const occurrences = (originalStreamworld.match(pattern) || []).length;
  if (occurrences !== 1) throw new Error(`expected exactly one SW_STREAM_CHUNK definition, found ${occurrences}`);
  fs.writeFileSync(SW_ASM_PATH, originalStreamworld.replace(pattern, `SW_STREAM_CHUNK = ${wantChunk}`));
}
function assembleOrThrow() {
  const result = execFileSync('nesasm', ['-s', 'main.asm'], { cwd: buildDir, encoding: 'utf8' });
  if (/\berror\b/i.test(result) || /bank overflow/i.test(result)) {
    throw new Error(`nesasm reported a real diagnostic despite exit 0:\n${result}`);
  }
  return result;
}
try {
  assembleOrThrow();
} finally {
  fs.writeFileSync(SW_ASM_PATH, originalStreamworld);
}

const fnsText = fs.readFileSync(path.join(buildDir, 'main.fns'), 'utf8');
const syms = fnsToMap(fnsText);
for (const name of ['nmi_rti', 'main_loop_ready', 'sw_debug_addrs2']) {
  if (!Number.isFinite(syms[name])) throw new Error(`${name} missing from main.fns`);
}

// Resolve the chained RAM equates the debug table does not cover
// (shake_left, cam_dirty, box_state, split_mode) straight from this build's
// own constants.asm -- never a hand-copied literal.
const constantsText = fs.readFileSync(path.join(buildDir, 'constants.asm'), 'utf8');
const streamworldText = fs.readFileSync(path.join(buildDir, 'streamworld.asm'), 'utf8');
const pending = new Map();
scanEquates(constantsText, pending);
scanEquates(streamworldText, pending);
const symbolTable = new Map();
resolveEquates(pending, symbolTable);
function ram(name) {
  const v = symbolTable.get(name);
  if (!Number.isFinite(v)) throw new Error(`${name} not resolved out of constants.asm/streamworld.asm`);
  return v;
}
const SHAKE_LEFT = ram('shake_left');
const CAM_DIRTY = ram('cam_dirty');
const BOX_STATE = ram('box_state');
const isMmc3 = /SPLIT_ENABLED\s*=\s*1/.test(constantsText);
const SPLIT_MODE = isMmc3 ? ram('split_mode') : null;
const BOX_TYPING = 2; // engine/constants.asm: BOX_CLOSED=0, BOX_OPENING=1, BOX_TYPING=2

const romBytesRaw = new Uint8Array(fs.readFileSync(path.join(buildDir, 'main.nes')));
const projectJson = JSON.parse(fs.readFileSync(path.join(boardDir, 'project.json'), 'utf8'));
const cartridge = projectJson.project?.cartridge ?? projectJson.cartridge;
const mapper = MAPPERS.find((m) => m.id === cartridge.mapper);
if (!mapper) throw new Error(`unknown mapper id ${cartridge.mapper}`);
const patched = applyHeaderPatch(romBytesRaw.slice(), mapper, cartridge, true);
// Ground rule: assert header byte 6 of the ROM actually run, not a direct
// unpatched nesasm build (CLAUDE.md's own documented trap -- a direct build
// silently means a DIFFERENT mirroring). UNROM 512 needs NES2.0 four-screen
// (0xEB, vs the raw 0xE1); MMC3 takes its mirroring from its own registers,
// not the header bit, so applyHeaderPatch only sets the battery bit here
// (0x43, vs the raw 0x41) -- both checked against the RAW build's own byte 6
// so patching is proven to have actually run, not merely asserted equal to
// a value that happens not to differ.
const EXPECTED_BYTE6 = { 'UNROM 512': 0xeb, MMC3: 0x43 };
const expected = EXPECTED_BYTE6[mapper.name];
if (expected === undefined) throw new Error(`no known expected header byte 6 for mapper ${mapper.name} -- add one rather than skip the check`);
if (patched[6] !== expected) {
  throw new Error(`header byte 6 is 0x${patched[6].toString(16)}, expected 0x${expected.toString(16)} for ${mapper.name} -- rebuild via applyHeaderPatch`);
}
if (patched[6] === romBytesRaw[6]) {
  throw new Error(`header byte 6 (0x${patched[6].toString(16)}) matches the RAW unpatched build -- applyHeaderPatch did not actually change anything`);
}

const emulator = new Emulator({ onFrame: () => {} });
emulator.loadROM(patched);
function peekPairs(baseAddr, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const lo = emulator.peek(baseAddr + i * 2);
    const hi = emulator.peek(baseAddr + i * 2 + 1);
    out.push(lo | (hi << 8));
  }
  return out;
}
const [stActive, stCur, stLen, stFtile, stFnt, stVary, sbuf] = peekPairs(syms.sw_debug_addrs2, 7);

fs.mkdirSync(outDir, { recursive: true });
const romPath = path.join(outDir, 'sw_nmi_worst.nes');
fs.writeFileSync(romPath, Buffer.from(patched));

const CHUNK = wantChunk;
const WORKLOAD_LEN = CHUNK; // blocks actually drawn this vblank (non-final: st_len > this)
const TOTAL_LEN = 32; // > CHUNK, so wrap/continuation bookkeeping genuinely runs

function lua() {
  return `-- GENERATED by build_f9_worst_chunk_fixture.mjs. Fix round 9, finding 1:
-- the worst NON-FINAL strip chunk (row orientation, odd parity, st_vary
-- starting at 29 so the chunk's own last block crosses the mod-32 wrap
-- boundary), with the full arbitrated NMI's real "everything else" live:
-- OAM DMA, the camera $2000/$2005 rewrite with cam_dirty CLEAR (the real
-- per-vblank refresh path, not the stale-skip shortcut), an ACTIVE shake
-- (shake_left nonzero), and on a SPLIT_ENABLED board, split_mode forced to
-- SPL_BOX (box_state=BOX_TYPING) so split_arm takes its longer
-- split_arm_go path, not the two-instruction SPL_OFF shortcut.
local NMI_RTI         = ${'0x' + syms.nmi_rti.toString(16)}
local MAIN_LOOP_READY = ${'0x' + syms.main_loop_ready.toString(16)}
local ST_ACTIVE_ADDR  = ${'0x' + stActive.toString(16)}
local ST_CUR_ADDR     = ${'0x' + stCur.toString(16)}
local ST_LEN_ADDR     = ${'0x' + stLen.toString(16)}
local ST_FTILE_ADDR   = ${'0x' + stFtile.toString(16)}
local ST_FNT_ADDR     = ${'0x' + stFnt.toString(16)}
local ST_VARY_ADDR    = ${'0x' + stVary.toString(16)}
local SBUF_ADDR       = ${'0x' + sbuf.toString(16)}
local SHAKE_LEFT_ADDR = ${'0x' + SHAKE_LEFT.toString(16)}
local CAM_DIRTY_ADDR  = ${'0x' + CAM_DIRTY.toString(16)}
local BOX_STATE_ADDR  = ${'0x' + BOX_STATE.toString(16)}
${SPLIT_MODE !== null ? `local SPLIT_MODE_ADDR = ${'0x' + SPLIT_MODE.toString(16)}` : '-- no split on this board'}
local VRAM_LEN  = 0x3c
local VRAM_READY = 0x3f
local WORKLOAD_LEN = ${WORKLOAD_LEN}
local TOTAL_LEN = ${TOTAL_LEN}
local FTILE_VALUE = 2
local FNT_VALUE = 8
local VARY_START = 29
local ST_ACTIVE_ROW = 2
local RUNUP_FRAMES = 400
local EXIT_TIMEOUT         = 99
local EXIT_STALE_ANCHOR    = 6
local EXIT_NEVER_ARMED     = 8
local EXIT_WORKLOAD_SHORT  = 7
local EXIT_DEADLINE_MISS   = 5
local VBLANK_FIRST_SCANLINE = 241
local VBLANK_LAST_SCANLINE  = 260
local DOTS_PER_SCANLINE     = 341
local PPU_DOTS_PER_CPU_CYCLE = 3
local RTI_REMAINING_CYCLES  = 6
local RTI_REMAINING_DOTS    = RTI_REMAINING_CYCLES * PPU_DOTS_PER_CPU_CYCLE

local frame = 0
local checkedAnchor = false
local armed = false
local checkedDeadline = false

local function log(message) local s = string.format("[%5d] %s", frame, message) emu.log(s) print(s) end
local function fail(code, message) log("FAIL: " .. message) emu.stop(code) end
local function pass(message) log("ok   " .. message) end
local function read(a) return emu.read(a, emu.memType.nesMemory) end
local function write(a, v) emu.write(a, v, emu.memType.nesMemory) end

local function checkAnchor()
  local nmiByte = read(NMI_RTI)
  if nmiByte ~= 0x40 then
    fail(EXIT_STALE_ANCHOR, string.format("byte at NMI_RTI (0x%04x) is 0x%02x, not rti", NMI_RTI, nmiByte))
    return false
  end
  pass(string.format("NMI_RTI anchor verified: 0x%04x is $40 (rti)", NMI_RTI))
  return true
end

local function armWorst()
  write(VRAM_LEN, 0)
  write(VRAM_READY, 0)          -- strip-only: this finding isolates the worst CHUNK, not arbitration
  write(ST_ACTIVE_ADDR, ST_ACTIVE_ROW)
  write(ST_FTILE_ADDR, FTILE_VALUE)
  write(ST_FNT_ADDR, FNT_VALUE)
  write(ST_VARY_ADDR, VARY_START)
  for i = 0, 31 do write(SBUF_ADDR + i, i % 4) end
  write(ST_CUR_ADDR, 0)
  write(ST_LEN_ADDR, TOTAL_LEN)  -- > compiled chunk (3): non-final, wrap bookkeeping runs
  write(SHAKE_LEFT_ADDR, 4)      -- active shake: nmi_scroll's longer shake-composed path
  write(CAM_DIRTY_ADDR, 0)       -- clear: the real per-vblank camera refresh runs, not the stale-skip
  write(BOX_STATE_ADDR, 2)       -- BOX_TYPING: split_select (already run this frame) -> SPL_BOX
${SPLIT_MODE !== null ? '  write(SPLIT_MODE_ADDR, 1) -- SPL_BOX, forced directly too, belt and braces' : ''}
  armed = true
  pass(string.format("armed worst-chunk: row strip, odd parity, vary=%d, len=%d (non-final), shake active, cam_dirty clear${SPLIT_MODE !== null ? ', split forced to SPL_BOX' : ''}", VARY_START, TOTAL_LEN))
end

local function onMainLoopReady()
  if armed or frame < RUNUP_FRAMES then return end
  armWorst()
end

local function onNmiRti()
  if not armed or checkedDeadline then return end
  checkedDeadline = true
  local state = emu.getState()
  local scanline = state["ppu.scanline"]
  local cycle = state["ppu.cycle"]
  local vramLen = read(VRAM_LEN)
  local stCur = read(ST_CUR_ADDR)
  log(string.format("nmi_rti reached: scanline=%d cycle=%d vram_len=%d st_cur=%d", scanline, cycle, vramLen, stCur))
  if stCur ~= WORKLOAD_LEN then
    fail(EXIT_WORKLOAD_SHORT, string.format("st_cur is %d, not %d -- the chunk did not actually run", stCur, WORKLOAD_LEN))
    return
  end
  if scanline < VBLANK_FIRST_SCANLINE or scanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("nmi_rti landed on scanline %d, outside vblank (%d-%d)", scanline, VBLANK_FIRST_SCANLINE, VBLANK_LAST_SCANLINE))
    return
  end
  local finishDot = cycle + RTI_REMAINING_DOTS
  local finishScanline = scanline
  while finishDot >= DOTS_PER_SCANLINE do
    finishDot = finishDot - DOTS_PER_SCANLINE
    finishScanline = finishScanline + 1
  end
  if finishScanline > VBLANK_LAST_SCANLINE then
    fail(EXIT_DEADLINE_MISS, string.format("rti's own remaining dots push past vblank (scanline %d -> %d)", scanline, finishScanline))
    return
  end
  -- Margin: how many PPU dots remain to the end of vblank (scanline 260, dot 340) once rti settles.
  local dotsUsedThisVblank = (scanline - VBLANK_FIRST_SCANLINE) * DOTS_PER_SCANLINE + cycle
  local dotsBudget = (VBLANK_LAST_SCANLINE - VBLANK_FIRST_SCANLINE + 1) * DOTS_PER_SCANLINE
  local marginDots = dotsBudget - dotsUsedThisVblank - RTI_REMAINING_DOTS
  local marginCycles = marginDots / PPU_DOTS_PER_CPU_CYCLE
  pass(string.format("worst-chunk NMI finished at scanline %d, cycle %d (rti settles on scanline %d) -- inside vblank, margin ~%.1f cycles (%.0f dots) to end of vblank", scanline, cycle, finishScanline, marginCycles, marginDots))
  emu.stop(0)
end

local function onFrame()
  frame = frame + 1
  if not checkedAnchor then
    checkedAnchor = true
    if not checkAnchor() then return end
  end
  if armed and not checkedDeadline and frame > RUNUP_FRAMES + 20 then
    fail(EXIT_NEVER_ARMED, "armed but no nmi_rti followed within 5 frames")
    return
  end
  if frame > 600 then
    fail(EXIT_TIMEOUT, "timed out waiting for nmi_rti after arming")
    return
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addMemoryCallback(onMainLoopReady, emu.callbackType.exec, MAIN_LOOP_READY)
emu.addMemoryCallback(onNmiRti, emu.callbackType.exec, NMI_RTI)
`;
}

const luaPath = path.join(outDir, 'sw_nmi_worst.lua');
fs.writeFileSync(luaPath, lua(), 'utf8');

console.log(`board: ${boardDirArg} (mapper ${mapper.name}), compiled SW_STREAM_CHUNK=3, worst config: row/odd/vary=29/len=32(non-final)`);
console.log(`rom: ${romPath}`);
console.log(`lua: ${luaPath}`);
```

### `proto-tools/diag_f9_shared_strip_lag.mjs`, new this round -- fix round 9, finding 2's own corrected lag model: ONE shared st_active-style server, not an independent queue per axis, sanity-checked against the already-proven single-axis bound before trusting anything built on it

```js
// Fix round 9, finding 2 (review 7): the reviewer's core critique is that
// fix round 7's own lag simulation modelled EACH AXIS as if it had its own
// independent scheduler -- but st_active (streamworld.asm) is ONE shared
// byte (0 idle / 1 column strip / 2 row strip): a column strip and a row
// strip can never run concurrently. Under 4-way exclusive movement (decision
// A: only one axis moves at a time), this matters whenever the player turns
// from one axis to the other while a strip for the PREVIOUS axis is still
// in flight -- the new axis's own crossing must wait for st_active to clear
// before it can even START its own service, which this script now models
// explicitly (fix round 7's own model never could, since it ran each axis
// as an independent queue).
//
// Real, 6502-measured inputs (not re-derived here): a column strip is 10
// vblank frames (SW_STREAM_CHUNK=3, 30 blocks / 3), a row strip is 11 (32
// blocks / 3, rounds up). Per-axis crossing timing is the exact periodic
// sequence proof 2 (fix round 7) already proved against real 6502 execution
// (diag_r7_sustained_rate.mjs): X at SW_SPEED_SUB_X=128 crosses every 10 or
// 11 frames (period 2, mean 10.667); Y at SW_SPEED_SUB_Y=112 crosses every
// 11 or 12 frames (period 16, mean 11.130).
//
//   node proto-tools/diag_f9_shared_strip_lag.mjs
const COL_VBLANKS = 10;
const ROW_VBLANKS = 11;

// Exact per-frame crossing sequences (0/1 = did this axis complete a 16px
// crossing on this frame), reproducing diag_r7_sustained_rate.mjs's own
// periodic pattern arithmetically (128/256 = 1.5 exactly -> alternating
// 10,11; 112/256 = 0.4375 fractional part -> a period-16 pattern of eleven
// 11s and one 12 ... regenerated here from the accumulator rule itself, not
// hand-copied, so a change to SW_SPEED_SUB_X/Y is caught by construction).
function crossingIntervals(sub, maxFrames) {
  // Mirrors sw_walk_step_x/y: acc += (128+sub)>>? -- actually the real
  // routine is WHOLE_STEP(1px) + an 8-bit accumulator that carries an extra
  // px on overflow. Reproduce it bit-for-bit: each frame moves 1px, plus a
  // carry px when acc+sub overflows 256.
  let acc = 0;
  let pxSinceCross = 0;
  const intervals = [];
  let framesThisCrossing = 0;
  for (let f = 0; f < maxFrames; f++) {
    framesThisCrossing++;
    let px = 1;
    const next = acc + sub;
    if (next >= 256) { px += 1; acc = next - 256; } else { acc = next; }
    pxSinceCross += px;
    if (pxSinceCross >= 16) {
      intervals.push(framesThisCrossing);
      pxSinceCross -= 16;
      framesThisCrossing = 0;
    }
  }
  return intervals;
}

const xIntervals = crossingIntervals(128, 20000);
const yIntervals = crossingIntervals(112, 20000);
console.log('X crossing interval set (frames):', [...new Set(xIntervals)].sort((a,b)=>a-b), 'mean', (xIntervals.reduce((a,b)=>a+b,0)/xIntervals.length).toFixed(4));
console.log('Y crossing interval set (frames):', [...new Set(yIntervals)].sort((a,b)=>a-b), 'mean', (yIntervals.reduce((a,b)=>a+b,0)/yIntervals.length).toFixed(4));

// ---------------------------------------------------------------------
// Shared-scheduler simulation. State: a single st_active-style server
// (idle, or busy with 'col' or 'row', counting down vblanksLeft). Two
// independent demand queues (colPending, rowPending), each incremented
// every time that axis's own accumulator completes a 16px crossing.
// A frame's own strip service: if idle and either queue is nonempty,
// arm whichever is preferred, PROVING a tie/starvation rule is needed --
// the axis NOT armed keeps accumulating pending demand, which is exactly
// the sharing cost the reviewer's finding names.
// ---------------------------------------------------------------------
function simulateShared({ pattern, frames, armPreference }) {
  // pattern: a generator yielding which axis (or null) is being held this
  // frame -- 'x', 'y', or null (idle). Movement only ever proceeds on the
  // held axis (4-way exclusive), so crossings only accrue for the CURRENTLY
  // held axis, using that axis's own real per-frame interval sequence.
  let colPending = 0, rowPending = 0;
  let server = null; // null | 'col' | 'row'
  let serverLeft = 0;
  let colLagMax = 0, rowLagMax = 0;
  let colCompleted = 0, rowCompleted = 0, colDemanded = 0, rowDemanded = 0;
  let xAcc = 0, xSince = 0, yAcc = 0, ySince = 0;
  for (let f = 0; f < frames; f++) {
    const held = pattern(f);
    if (held === 'x') {
      let px = 1;
      const next = xAcc + 128;
      if (next >= 256) { px += 1; xAcc = next - 256; } else { xAcc = next; }
      xSince += px;
      if (xSince >= 16) { xSince -= 16; colPending++; colDemanded++; }
    } else if (held === 'y') {
      let px = 1;
      const next = yAcc + 112;
      if (next >= 256) { px += 1; yAcc = next - 256; } else { yAcc = next; }
      ySince += px;
      if (ySince >= 16) { ySince -= 16; rowPending++; rowDemanded++; }
    }
    // Service tick.
    if (server) {
      serverLeft--;
      if (serverLeft <= 0) {
        if (server === 'col') colCompleted++; else rowCompleted++;
        server = null;
      }
    }
    if (!server) {
      if (colPending > 0 && (armPreference === 'col' || rowPending === 0)) {
        server = 'col'; serverLeft = COL_VBLANKS; colPending--;
      } else if (rowPending > 0) {
        server = 'row'; serverLeft = ROW_VBLANKS; rowPending--;
      }
    }
    const colLag = colDemanded - colCompleted - (server === 'col' ? 0 : 0);
    const rowLag = rowDemanded - rowCompleted;
    // Lag = blocks demanded but not yet fully drawn (matches fix round 7's
    // own "window lag = demand minus completed strips" definition, now fed
    // by a scheduler that can starve one axis behind the other).
    if (colLag > colLagMax) colLagMax = colLag;
    if (rowLag > rowLagMax) rowLagMax = rowLag;
  }
  return { colLagMax, rowLagMax, colPendingEnd: colPending, rowPendingEnd: rowPending };
}

// Test 1: pure single-axis holds (sanity check against fix round 7's own
// 1-block result -- the shared server never even sees contention here).
{
  const r = simulateShared({ pattern: () => 'x', frames: 500000, armPreference: 'col' });
  console.log('pure X hold, 500k frames: colLagMax=', r.colLagMax, 'rowLagMax=', r.rowLagMax);
}
{
  const r = simulateShared({ pattern: () => 'y', frames: 500000, armPreference: 'row' });
  console.log('pure Y hold, 500k frames: colLagMax=', r.colLagMax, 'rowLagMax=', r.rowLagMax);
}

// Test 2: the staircase -- alternate axis every SINGLE crossing (the
// tightest legal alternation: hold X until exactly one 16px crossing
// completes, then immediately hold Y until exactly one completes, forever).
// This is the adversarial case the reviewer's finding 2 names: does the
// shared single-strip constraint make a switching player's lag diverge?
{
  function staircasePattern() {
    let axis = 'x';
    let xAcc = 0, xSince = 0, yAcc = 0, ySince = 0;
    return (f) => {
      // Determine if the CURRENT axis is about to complete a crossing on
      // this very frame (peek without mutating the outer accumulator state
      // -- simulateShared owns the real accumulators, so this closure just
      // tracks which axis is "current" using its OWN shadow accumulator,
      // switching the moment its shadow completes a crossing).
      if (axis === 'x') {
        let px = 1; const next = xAcc + 128;
        if (next >= 256) { px += 1; xAcc = next - 256; } else { xAcc = next; }
        xSince += px;
        if (xSince >= 16) { xSince -= 16; axis = 'y'; }
        return 'x';
      } else {
        let px = 1; const next = yAcc + 112;
        if (next >= 256) { px += 1; yAcc = next - 256; } else { yAcc = next; }
        ySince += px;
        if (ySince >= 16) { ySince -= 16; axis = 'x'; }
        return 'y';
      }
    };
  }
  const r = simulateShared({ pattern: staircasePattern(), frames: 2000000, armPreference: 'col' });
  console.log('staircase (alternate every single crossing), 2M frames: colLagMax=', r.colLagMax, 'rowLagMax=', r.rowLagMax, 'endPending col/row=', r.colPendingEnd, r.rowPendingEnd);
}

// Test 3: the genuinely adversarial case -- hold X for exactly ONE crossing
// (X's own service, 10-11 frames), then Y for exactly TWO crossings back to
// back (so a second Y crossing is DEMANDED while the first Y strip, or a
// leftover X strip, might still be draining), repeating. This probes
// whether demanding two crossings on the SAME axis back-to-back (which
// ordinary held movement already does every ~11 frames) compounds with an
// axis switch's own service backlog.
{
  function twoYPattern() {
    let phase = 'x1';
    let xAcc = 0, xSince = 0, yAcc = 0, ySince = 0, yCrossCount = 0;
    return () => {
      if (phase === 'x1') {
        let px = 1; const next = xAcc + 128;
        if (next >= 256) { px += 1; xAcc = next - 256; } else { xAcc = next; }
        xSince += px;
        if (xSince >= 16) { xSince -= 16; phase = 'y'; yCrossCount = 0; }
        return 'x';
      } else {
        let px = 1; const next = yAcc + 112;
        if (next >= 256) { px += 1; yAcc = next - 256; } else { yAcc = next; }
        ySince += px;
        if (ySince >= 16) { ySince -= 16; yCrossCount++; if (yCrossCount >= 2) phase = 'x1'; }
        return 'y';
      }
    };
  }
  const r = simulateShared({ pattern: twoYPattern(), frames: 2000000, armPreference: 'col' });
  console.log('X1-then-Y2 pattern, 2M frames: colLagMax=', r.colLagMax, 'rowLagMax=', r.rowLagMax);
}

// Test 4: worst-case adversarial search -- try every fixed "hold axis A for
// exactly nA crossings, then axis B for exactly nB crossings" cycle up to
// nA,nB in [1,6], both arm-preference choices, to find the single worst
// lag any FIXED periodic switching pattern can produce (a search, not a
// single hand-picked case).
{
  let worst = { lag: -1 };
  for (const armPreference of ['col', 'row']) {
    for (let nX = 1; nX <= 6; nX++) {
      for (let nY = 1; nY <= 6; nY++) {
        function pattern() {
          let phase = 'x'; let count = 0;
          let xAcc = 0, xSince = 0, yAcc = 0, ySince = 0;
          return () => {
            if (phase === 'x') {
              let px = 1; const next = xAcc + 128;
              if (next >= 256) { px += 1; xAcc = next - 256; } else { xAcc = next; }
              xSince += px;
              if (xSince >= 16) { xSince -= 16; count++; if (count >= nX) { phase = 'y'; count = 0; } }
              return 'x';
            } else {
              let px = 1; const next = yAcc + 112;
              if (next >= 256) { px += 1; yAcc = next - 256; } else { yAcc = next; }
              ySince += px;
              if (ySince >= 16) { ySince -= 16; count++; if (count >= nY) { phase = 'x'; count = 0; } }
              return 'y';
            }
          };
        }
        const r = simulateShared({ pattern: pattern(), frames: 300000, armPreference });
        const lag = Math.max(r.colLagMax, r.rowLagMax);
        if (lag > worst.lag) worst = { lag, nX, nY, armPreference, colLagMax: r.colLagMax, rowLagMax: r.rowLagMax };
      }
    }
  }
  console.log('worst FIXED periodic switching pattern found:', JSON.stringify(worst));
}

// Test 5: randomized adversarial fuzz -- at each moment (still 4-way
// exclusive: one axis at a time), a pseudo-random switch decision with
// probability 1/N per frame for varying N, run long, seeded for
// reproducibility, to catch a phase-alignment case the fixed nX/nY search
// (test 4) might miss.
{
  let seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  let worst = { lag: -1 };
  for (const switchProb of [0.02, 0.05, 0.1, 0.2, 0.3, 0.5]) {
    function pattern() {
      let axis = rnd() < 0.5 ? 'x' : 'y';
      return () => {
        if (rnd() < switchProb) axis = axis === 'x' ? 'y' : 'x';
        return axis;
      };
    }
    for (const armPreference of ['col', 'row']) {
      const r = simulateShared({ pattern: pattern(), frames: 1000000, armPreference });
      const lag = Math.max(r.colLagMax, r.rowLagMax);
      if (lag > worst.lag) worst = { lag, switchProb, armPreference, colLagMax: r.colLagMax, rowLagMax: r.rowLagMax };
    }
  }
  console.log('worst RANDOM switching pattern found (1M frames each):', JSON.stringify(worst));
}
```

### `proto-tools/diag_f9_flash_priority.mjs`, new this round -- fix round 9, finding 3's own lag-triggered strip-priority search (LAG_PRIORITY_THRESHOLD/DEFER_CAP), bounding both the strip's own lag and Flash's own visible defer simultaneously, independent of Flash's own recurrence rate

```js
// Fix round 9, finding 3 (review 7): Flash needs a real engine answer, not
// an author-visible recurrence threshold. Candidate (b) from the brief:
// once the strip's own lag reaches LAG_PRIORITY_THRESHOLD blocks, the strip
// wins arbitration instead of a queued vram_buf drain -- UNLESS that
// producer's own packet has already been deferred DEFER_CAP consecutive
// frames, in which case it drains anyway (a hard cap on producer latency,
// so Flash's own visible timing can never slip by more than a small,
// STATED number of frames, independent of how often it recurs).
//
// This script searches (LAG_PRIORITY_THRESHOLD, DEFER_CAP) pairs and proves,
// for each candidate, two things TOGETHER: (1) the strip's own lag stays
// bounded (well under the 8-block resync guard) even under a PATHOLOGICAL
// Flash recurrence (every single frame, far beyond any authored use), and
// (2) a queued Flash packet is never deferred more than DEFER_CAP frames --
// the real, provable guarantee the brief asks for, decoupled from having to
// reason about a safe recurrence rate at all.
//
//   node proto-tools/diag_f9_flash_priority.mjs
const COL_VBLANKS = 10;
const ROW_VBLANKS = 11;

function crossingIntervals(sub, maxFrames) {
  let acc = 0, pxSinceCross = 0, framesThisCrossing = 0;
  const intervals = [];
  for (let f = 0; f < maxFrames; f++) {
    framesThisCrossing++;
    let px = 1;
    const next = acc + sub;
    if (next >= 256) { px += 1; acc = next - 256; } else acc = next;
    pxSinceCross += px;
    if (pxSinceCross >= 16) { intervals.push(framesThisCrossing); pxSinceCross -= 16; framesThisCrossing = 0; }
  }
  return intervals;
}

// Single-axis sustained hold (the case that matters -- Y is the tight one),
// with a Flash producer recurring every `flashPeriod` frames (a two-edge
// burst: FLASH_TOTAL_FRAMES=6 apart, per engine/entities.asm), under the
// candidate priority policy.
function simulate({ axis, flashPeriod, lagPriorityThreshold, deferCap, frames }) {
  const sub = axis === 'x' ? 128 : 112;
  const stripVblanks = axis === 'x' ? COL_VBLANKS : ROW_VBLANKS;
  let acc = 0, pxSince = 0;
  let demanded = 0, completed = 0;
  let server = false, serverLeft = 0;
  let pending = 0; // strip blocks demanded, not yet armed/serviced
  let lagMax = 0;
  let flashQueued = false, flashDeferFrames = 0, flashDeferMax = 0;
  let nextFlashEdge = Number.isFinite(flashPeriod) ? 6 : Infinity; // FLASH_TOTAL_FRAMES: arm edge, then confirm edge 6 frames later; Infinity = no flash ever (true baseline)
  let edgesFired = 0;
  const FLASH_TOTAL_FRAMES = 6;
  for (let f = 0; f < frames; f++) {
    // Movement demand.
    let px = 1;
    const next = acc + sub;
    if (next >= 256) { px += 1; acc = next - 256; } else acc = next;
    pxSince += px;
    if (pxSince >= 16) { pxSince -= 16; pending++; demanded++; }

    // Flash producer: two edges per burst (arm, then confirm), bursts
    // recurring every flashPeriod frames -- a burst is queued as TWO
    // separate one-vblank drain demands, FLASH_TOTAL_FRAMES apart.
    if (f === nextFlashEdge) {
      flashQueued = true;
      edgesFired++;
      nextFlashEdge = (edgesFired % 2 === 1) ? f + FLASH_TOTAL_FRAMES : f + (flashPeriod - FLASH_TOTAL_FRAMES);
    }

    const lag = demanded - completed;
    // Arbitration this vblank.
    let stripRunsThisVblank = false;
    let drainRunsThisVblank = false;
    if (flashQueued) {
      const forceDrain = flashDeferFrames >= deferCap;
      if (lag >= lagPriorityThreshold && !forceDrain) {
        // strip wins; flash defers
        flashDeferFrames++;
        if (flashDeferFrames > flashDeferMax) flashDeferMax = flashDeferFrames;
        stripRunsThisVblank = true;
      } else {
        drainRunsThisVblank = true;
        flashQueued = false;
        flashDeferFrames = 0;
      }
    } else {
      stripRunsThisVblank = true;
    }

    if (stripRunsThisVblank) {
      // Two SEPARATE `if`s, not `if/else if` -- a server that frees up this
      // very vblank (serverLeft reaches 0) must be able to start the next
      // pending block THE SAME vblank, matching sw_nmi_stream's own
      // sw_ns_loop (which does not return between blocks within one
      // chunk) and, at a chunk boundary, matching the fact that the very
      // next vblank's own sw_nmi_stream call starts fresh with no built-in
      // idle frame. An else-if here silently inserts a phantom 1-frame gap
      // after every completed strip -- caught by cross-checking against
      // diag_f9_shared_strip_lag.mjs's own pure-single-axis result (which
      // must stay at lagMax<=1, the already-proven bound) before trusting
      // any Flash-interaction number built on this scheduler core.
      if (server) {
        serverLeft--;
        if (serverLeft <= 0) { completed++; server = false; }
      }
      if (!server && pending > 0) {
        server = true; serverLeft = stripVblanks; pending--;
      }
    }
    // drainRunsThisVblank: strip does not advance this vblank at all.

    const curLag = demanded - completed;
    if (curLag > lagMax) lagMax = curLag;
  }
  return { lagMax, flashDeferMax };
}

console.log('=== sanity: no-flash baseline must reproduce the already-proven <=1 block bound (Y axis) ===');
{
  const r = simulate({ axis: 'y', flashPeriod: Infinity, lagPriorityThreshold: 1, deferCap: 1, frames: 500000 });
  console.log('  no-flash Y baseline:', JSON.stringify(r));
  if (r.lagMax > 1) throw new Error(`scheduler core is broken: no-flash Y baseline lag ${r.lagMax} exceeds the already-proven 1-block bound -- do not trust anything below until this is 1`);
}

console.log('=== searching (lagPriorityThreshold, deferCap) for Y axis (the tight one), pathological Flash every frame ===');
let best = null;
for (const lagPriorityThreshold of [1, 2, 3]) {
  for (const deferCap of [1, 2, 3, 4]) {
    // Pathological: flashPeriod as small as physically possible (a burst is
    // 6 frames apart internally; back-to-back bursts -- re-arming an
    // already-active Flash -- means flashPeriod can be as low as 6).
    const r = simulate({ axis: 'y', flashPeriod: 6, lagPriorityThreshold, deferCap, frames: 500000 });
    console.log(`  threshold=${lagPriorityThreshold} deferCap=${deferCap}: lagMax=${r.lagMax} flashDeferMax=${r.flashDeferMax}`);
    if (r.lagMax <= 8 && r.flashDeferMax <= deferCap) {
      if (!best || (r.lagMax < best.lagMax)) best = { lagPriorityThreshold, deferCap, ...r };
    }
  }
}
console.log('best candidate (lowest lagMax while flashDeferMax stays within its own cap):', JSON.stringify(best));

console.log('\n=== confirm chosen candidate under a realistic ordinary rate too (X axis, flashPeriod=40) ===');
{
  const r = simulate({ axis: 'x', flashPeriod: 40, lagPriorityThreshold: best.lagPriorityThreshold, deferCap: best.deferCap, frames: 500000 });
  console.log('X axis, ordinary Flash rate:', JSON.stringify(r));
}
console.log('\n=== confirm chosen candidate reduces to todays behaviour once no Flash queued (X axis, no flash: flashPeriod=Infinity) ===');
{
  const r = simulate({ axis: 'x', flashPeriod: Infinity, lagPriorityThreshold: best.lagPriorityThreshold, deferCap: best.deferCap, frames: 500000 });
  console.log('X axis, no flash:', JSON.stringify(r));
}
console.log('\n=== the OLD policy (drain always wins), for contrast, pathological flashPeriod=6, Y axis ===');
{
  const r = simulate({ axis: 'y', flashPeriod: 6, lagPriorityThreshold: 999999, deferCap: 999999, frames: 500000 });
  console.log('old policy, Y axis, flash every 6 frames:', JSON.stringify(r));
}
```

### Commands and results, this round

```
$ node proto-tools/build_deadline_fixture.mjs sample-u512 sample-u512/build 1 1 even
$ Mesen --testRunner sample-u512/build/sw_nmi_deadline.lua sample-u512/build/sw_nmi_deadline.nes
exit 0   -- compiled chunk 1, workload 1, aligned parity: meets the deadline

$ node proto-tools/build_deadline_fixture.mjs sample-u512 sample-u512/build 1 1 odd
$ Mesen --testRunner sample-u512/build/sw_nmi_deadline.lua sample-u512/build/sw_nmi_deadline.nes
exit 0   -- identical chunk/workload, ODD origin parity: meets the deadline (parity does not change the verdict)

$ node proto-tools/build_deadline_fixture.mjs sample-u512 sample-u512/build 3 3 even
$ Mesen --testRunner sample-u512/build/sw_nmi_deadline.lua sample-u512/build/sw_nmi_deadline.nes
exit 5   -- compiled chunk 3 (the ASSEMBLED constant, not merely the workload): misses the deadline,
         -- the real negative control finding 9 asked for, not fix round 4's own workload-only chunk=3

$ node proto-tools/build_deadline_fixture.mjs sample-u512 sample-u512/build 1 3 even
$ Mesen --testRunner sample-u512/build/sw_nmi_deadline.lua sample-u512/build/sw_nmi_deadline.nes
exit 7   -- compiled chunk 1, workload 3: a compiled-chunk-1 ROM only advances 1 block per NMI
         -- regardless of how many are queued, correctly detected as workload-short, not a deadline miss

$ node proto-tools/build_deadline_fixture.mjs sample-u512 sample-u512/build 3 1 even
$ Mesen --testRunner sample-u512/build/sw_nmi_deadline.lua sample-u512/build/sw_nmi_deadline.nes
exit 0   -- compiled chunk 3 asked to do only 1 block of real work still finishes fine (the loop's
         -- own cur>=len early exit), confirming the deadline problem is about a FULL chunk-3
         -- workload, not the compiled constant's mere presence

$ node proto-tools/build_deadline_fixture.mjs sample-mmc3 sample-mmc3/build 1 1 even
$ Mesen --testRunner sample-mmc3/build/sw_nmi_deadline.lua sample-mmc3/build/sw_nmi_deadline.nes
exit 0

$ node proto-tools/build_deadline_fixture.mjs sample-mmc3 sample-mmc3/build 3 3 even
$ Mesen --testRunner sample-mmc3/build/sw_nmi_deadline.lua sample-mmc3/build/sw_nmi_deadline.nes
exit 5

$ node proto-tools/build_deadline_fixture.mjs sample-mmc3 sample-mmc3/build 1 1 odd
$ Mesen --testRunner sample-mmc3/build/sw_nmi_deadline.lua sample-mmc3/build/sw_nmi_deadline.nes
exit 0

$ node proto-tools/build_dma_control_fixture.mjs sample-u512 1
exit(DMA-off)=0  exit(DMA-on)=0   -- chunk 1 passes either way, generous margin

$ node proto-tools/build_dma_control_fixture.mjs sample-u512 2
exit(DMA-off)=0  exit(DMA-on)=5   -- REAL FLIP: chunk 2 (never tested via Mesen before this round)
                                  -- misses the deadline WITH DMA present, passes with it removed --
                                  -- the OAM DMA stall is exactly what separates safe (chunk 1) from
                                  -- unsafe (chunk 2) at this granularity, an observed causal proof,
                                  -- not an assumption from reading the source

$ node proto-tools/build_dma_control_fixture.mjs sample-mmc3 2
exit(DMA-off)=0  exit(DMA-on)=5   -- identical flip on the font-split board

$ node proto-tools/build_quadrant_fixture.mjs
$ Mesen --testRunner minimal-u512/build/sw_quadrant_check.lua minimal-u512/build/sw_quadrant_check.nes
exit 0   -- all 8 checks pass: all four physical nametables' own terrain AND attribute bytes,
         -- at a real unaligned origin, hardware-timed, matching the independent oracle exactly

$ node proto-tools/build_deadline_fixture.mjs sample-mmc1
Error: nesasm reported a real diagnostic despite exit 0 -- refusing to trust stale artefacts:
       Bank overflow, offset > $1FFF!
```

`sample-mmc1` correctly refuses to trust a broken build (finding 9's own assembler-rejection fix,
kept from fix round 4). Every command above is independently reproducible from this tree; no
hand-edited intermediate state survives between runs (`withCompiledChunk`, the DMA control's own
`finally` block, and every `.inc` fixture generator all restore or regenerate their own inputs).

### Round 10 (fix round 10): commands, scripts and real output

Build 1 (review 8, finding 6) and Build 2 (review 8, finding 4). Every script below is new this
round, lives in the scratch tree's `proto-tools/`, and was run against `minimal-u512` (Build 1's
own relocation, Build 2's own routing fixes) unless stated otherwise. `diag_r10_banked_strip.mjs`
is fix round 8's own `diag_r8_banked_strip.mjs`, re-pointed at `minimal-u512` instead of the now-
retired `minimal-u512-fs3` (a two-line path change: `'minimal-u512-fs3'` -> `'minimal-u512'`),
not re-embedded here since it is otherwise byte-identical to the already-embedded fix round 8
version above.

#### `proto-tools/streamworld_bank14.asm`, new this round — the two never-shipped bank-14 routines, split out so `streamworld.asm` itself carries no `.bank` directive

```asm
; streamworld_bank14.asm -- fix round 10, review 8 finding 6: the streamed-worlds
; prototype's own bank-14 TEST/PROTOTYPE-ONLY routines, split out of
; streamworld.asm so that file can be relocated wholesale into kernel-hi as a
; pure resident include with NO internal .bank excursion of its own. Neither
; routine below ships in the real engine -- see each one's own header comment.
; Included from the SAME kernel-lo position streamworld.asm used to occupy, so
; nesasm's ambient bank here is still 62 (kernel-lo) both before and after each
; excursion, unchanged from every prior round.

; ==========================================================================
; sw_dlg_metatile -- fix round 7, decision B's own real accessor: given the
; box's own top-left metatile ORIGIN (torus-absolute, set once per box open/
; close by the caller into sw_dlg_ocol/olcol/orow/olrow -- however the
; caller derives that origin from the aligned camera, which is remaining
; open question 1's own unresolved camera/window integration, not new work
; here) and a metatile position WITHIN the box's own 16-wide/3-tall band
; (A=boxCol 0-15, X=boxRow 0-2 -- boxRow 0 is metatile row 12 of the local
; screen, the box's own known fixed offset, CLAUDE.md's own "box rows 24-29
; are exactly metatile rows 12-14"), resolves to a real (screenCol,
; screenRow,localCol,localRow) and reads through sw_terrain_or_fill --
; bank-safe (restores the field's own current screen) AND fill-aware
; (a box straddling the map's authored edge reads sw_fill_metatile_id, not
; garbage or a wrong neighbour's data). This is NOT a new addressing
; mechanism: it composes two already-proven pieces --
; sw_col_at_offset/sw_row_at_offset's own mod-16/mod-15 wrap shape (proven
; by sw_render_window's own tests), parameterized on a caller-supplied
; origin instead of the global window state those two read, feeding
; sw_terrain_or_fill (proven above, review 5/diag_r5_fill.mjs).
;
; In: A=boxCol (0-15), X=boxRow (0-2). sw_dlg_ocol/olcol/orow/olrow =
; the box's own origin, caller-set once before the row loop begins.
; Out: A = the metatile id (real terrain byte or fill). Clobbers X, Y,
; sw_dlg_rscol -- and, via sw_terrain_or_fill/sw_peek_byte/sw_goto, the
; shared sw_tmp/sw_tmp2/.../sw_tmp6 cold-path scratch -- which is exactly
; why the ORIGIN needs its own dedicated bytes rather than living in
; sw_tmp*: sw_goto (reached through this call, when in bounds) clobbers
; sw_tmp*-sw_tmp6 as ITS OWN scratch, so a persistent value stored there
; would not survive the very call that needs it.
;
; PROTOTYPE PLACEMENT NOTE: this routine is a real, mainline (never-NMI)
; candidate for kernel-lo, exactly like every other cold-path sw_* routine
; in this file -- but minimal-u512's own stripped test fixture has no
; spare kernel-lo room left to hold it alongside everything else this round
; added (decision A's own two accumulators, the retired-but-still-present
; sw_move_tick history comment costs nothing, real code does). It is
; assembled into the SAME never-shipped bank 14 test slot
; sw_run_bank_test already uses, below -- purely so this prototype has
; somewhere to put the bytes and a real PRG bank to call it from; the
; number this design owes the real kernel-lo budget is a NEW, not-yet-
; measured `*_KERNEL_ALLOWANCE` term (decision B's own byte cost, §9),
; the same discipline every other conditional feature in "The kernel
; budget" already follows -- not a claim that dialogue's own accessor
; ships from bank 14 in the real engine.
  .bank 14
  .org $8600
sw_dlg_metatile:
  stx sw_dlg_rbrow          ; boxRow, stashed (X is about to be reused)
  clc
  adc sw_dlg_olcol
  cmp #16
  bcc sw_dlgm_col_ok
  sbc #16
  sta sw_dlg_rlcol
  lda sw_dlg_ocol
  clc
  adc #1
  jmp sw_dlgm_col_done
sw_dlgm_col_ok:
  sta sw_dlg_rlcol
  lda sw_dlg_ocol
sw_dlgm_col_done:
  sta sw_dlg_rscol
  lda sw_dlg_rbrow
  clc
  adc #12
  clc
  adc sw_dlg_olrow
  cmp #15
  bcc sw_dlgm_row_ok
  sbc #15
  sta sw_dlg_rlrow
  lda sw_dlg_orow
  clc
  adc #1
  jmp sw_dlgm_row_done
sw_dlgm_row_ok:
  sta sw_dlg_rlrow
  lda sw_dlg_orow
sw_dlgm_row_done:
  tax                       ; X = resolved screenRow (sw_terrain_or_fill's own arg)
  lda sw_dlg_rlrow
  asl a
  asl a
  asl a
  asl a                     ; localRow * 16
  clc
  adc sw_dlg_rlcol
  tay                       ; Y = offset = localRow*16 + localCol
  lda sw_dlg_rscol          ; A = resolved screenCol
  jmp sw_terrain_or_fill
  .bank 62

; ==========================================================================
; sw_run_bank_test -- review 4, finding 2's own required proof: a caller
; whose CODE physically executes in a switchable bank, not a JS/RAM call
; stub (T9/diag_r3_transaction's own gap, named by the review). UNROM 512's
; own register is a 16 KB PRG-bank number (`switch_prg_bank`'s `and #$1F`,
; engine/banks.asm:242) covering TWO 8 KB nesasm banks at once --
; `shared/cartridge.js`'s own `prgLayout()` pairs nesasm bank `2N` ($8000
; half) with `2N+1` ($A000 half) under PRG-bank-register value N. To make
; `sw_caller_bank=7` (the register value) actually select this code, it
; must live at nesasm bank 14 (2*7), not literal bank 7 -- a real
; nesasm-bank-vs-hardware-register distinction this design's own sw_goto
; already divides/multiplies around (the `lsr a` after computing a region
; index), caught here empirically (bank 7's own $8000 first read back the
; unassigned-bank $FF fill, not this code's fingerprint, until fixed).
; Nesasm bank 14/15 is otherwise unused by every other file in this build
; (checked: 0-4, 10-12, 40-42, 62-63) -- this exists only to give the proof
; a real bank to execute from, and never ships.
; ==========================================================================
  .bank 14
  .org $8000
sw_run_bank_test_fingerprint:
  .db 200        ; read back after the call -- proves PRG register 7 (THIS
                  ; code's own bank) is what switch_prg_bank restored, not
                  ; the field's current screen's bank
sw_run_bank_test:
  lda #8
  sta sw_run_len
  lda #7
  sta sw_caller_bank
  lda #0         ; target screenCol
  ldx #1         ; target screenRow
  ldy #0         ; offset within that screen's record
  jsr sw_read_run
  rts

  .bank 62
```

#### `main.asm`'s own two relocation edits, new this round (the whole change; everything else in the file is stock)

```asm
; 1. Where streamworld.asm used to sit (kernel-lo, unchanged position), now includes only the
;    never-shipped test scaffolding plus (this round's own decision test) the banked primitive
;    and arm directly, as ordinary kernel-lo code:
  .include "screens.asm"
  .include "streamworld_bank14.asm"
  .include "streamworld_banked_primitive.asm"
  .include "streamworld_banked_arm.asm"
  .if CAMERA_SLIDE_ENABLED

; 2. The resident set itself, relocated to after kernel-hi's own existing contents, before the
;    vectors -- no .bank/.org of its own; continues in nesasm's ambient bank (63) from
;    assets/kernel_hi.inc's own header:
  .include "assets/kernel_hi.inc"
  .include "assets/music.inc"
  .include "assets/text.inc"
  .include "streamworld.asm"

  .org $FFFA
```

#### `proto-tools/check_r10_symbol_ranges.mjs`, new this round — every resident label inside kernel-hi bounds, no overlap

```javascript
#!/usr/bin/env node
// Fix round 10, build 1 (review 8 finding 6): every resident sw_* label
// streamworld.asm now defines must land inside kernel-hi's own bounds
// ($E000-$FFF9, leaving $FFFA-$FFFF for the vectors), with no overlap
// against the music/text/vector ranges it now shares kernel-hi with, and
// separately, every kernel-lo sw_* label (the bank-14 test entries plus
// any resident kernel-lo hook the arbitration wiring still needs) is listed
// with its own byte span so the two halves of this round's placement are
// never conflated.
//
//   node proto-tools/check_r10_symbol_ranges.mjs <boardDir>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , boardDirArg] = process.argv;
if (!boardDirArg) { console.error('usage: node proto-tools/check_r10_symbol_ranges.mjs <boardDir>'); process.exit(2); }
const buildDir = path.join(path.resolve(ROOT, boardDirArg), 'build');

const fnsText = fs.readFileSync(path.join(buildDir, 'main.fns'), 'utf8');
const streamworldSrc = fs.readFileSync(path.join(buildDir, 'streamworld.asm'), 'utf8');
const bank14Src = fs.existsSync(path.join(buildDir, 'streamworld_bank14.asm'))
  ? fs.readFileSync(path.join(buildDir, 'streamworld_bank14.asm'), 'utf8')
  : '';

function labelsOf(src) {
  const out = new Set();
  for (const line of src.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (m) out.add(m[1]);
  }
  return out;
}

const residentLabels = labelsOf(streamworldSrc);
const bank14Labels = labelsOf(bank14Src);

const symbols = {};
for (const line of fnsText.split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}

const KERNEL_HI_LO = 0xE000;
const KERNEL_HI_HI = 0xFFF9; // vectors own FFFA-FFFF
const MUSIC_TEXT_START = symbols['period_lo']; // first kernel-hi table, music.inc
// text.inc's own first label varies per project; use kernel_hi lower bound and
// the resident set's own lowest label instead of naming a text.inc symbol.

let failures = 0;
let residentChecked = 0;
console.log(`board: ${boardDirArg}`);
console.log(`kernel-hi bounds checked: $${KERNEL_HI_LO.toString(16)}-$${KERNEL_HI_HI.toString(16)}`);
console.log('');
console.log('-- resident (streamworld.asm) labels --');
const residentAddrs = [];
for (const name of [...residentLabels].sort()) {
  if (!(name in symbols)) continue; // local branch targets nesasm may have folded
  const addr = symbols[name];
  residentAddrs.push([name, addr]);
  residentChecked++;
  const inRange = addr >= KERNEL_HI_LO && addr <= KERNEL_HI_HI;
  if (!inRange) {
    failures++;
    console.log(`  FAIL ${name.padEnd(28)} $${addr.toString(16).padStart(4, '0')}  -- outside kernel-hi bounds`);
  }
}
console.log(`  ${residentChecked} resident labels resolved from main.fns, all inside kernel-hi bounds: ${failures === 0}`);

// Overlap check: resident set's own address span must not intersect the
// music/text tables that precede it in kernel-hi (both instantiated by the
// SAME assembler pass, so an overlap would only ever show up as one of the
// two areas silently containing the other's bytes -- check by address
// interval, not by re-reading ROM content).
const residentMin = Math.min(...residentAddrs.map(([, a]) => a));
const residentMax = Math.max(...residentAddrs.map(([, a]) => a));
console.log('');
console.log(`  resident span: $${residentMin.toString(16)}-$${residentMax.toString(16)} (${residentMax - residentMin} bytes between first/last label)`);

// music.inc/text.inc tables all resolve below the resident span, since
// streamworld.asm's own include now runs strictly after both in main.asm;
// confirm every table symbol nesasm emits for period_lo/song data (music.inc's
// own first label) sits below residentMin.
if (Number.isFinite(MUSIC_TEXT_START)) {
  const ok = MUSIC_TEXT_START < residentMin;
  console.log(`  period_lo (music.inc's first label) = $${MUSIC_TEXT_START.toString(16)}, below resident span: ${ok}`);
  if (!ok) failures++;
}

console.log('');
console.log('-- kernel-lo hooks (streamworld_bank14.asm) --');
let bank14Checked = 0;
for (const name of [...bank14Labels].sort()) {
  if (!(name in symbols)) continue;
  const addr = symbols[name];
  bank14Checked++;
  console.log(`  ${name.padEnd(28)} $${addr.toString(16).padStart(4, '0')}`);
}
console.log(`  ${bank14Checked} bank-14 test labels listed (never shipped; not part of the resident kernel-hi budget)`);

console.log('');
console.log(failures === 0 ? `ALL PASS, exit 0` : `${failures} FAILURES, exit 1`);
process.exit(failures === 0 ? 0 : 1);
```

Real output:
```
board: minimal-u512
kernel-hi bounds checked: $e000-$fff9

-- resident (streamworld.asm) labels --
  121 resident labels resolved from main.fns, all inside kernel-hi bounds: true

  resident span: $e143-$e95d (2074 bytes between first/last label)
  period_lo (music.inc's first label) = $e000, below resident span: true

-- kernel-lo hooks (streamworld_bank14.asm) --
  sw_dlg_metatile              $8600
  sw_dlgm_col_done             $861f
  sw_dlgm_col_ok               $8619
  sw_dlgm_row_done             $8644
  sw_dlgm_row_ok               $863e
  sw_run_bank_test             $8001
  sw_run_bank_test_fingerprint $8000
  7 bank-14 test labels listed (never shipped; not part of the resident kernel-hi budget)

ALL PASS, exit 0
```

#### `streamworld.asm`'s own fill-aware routing edits, new this round (Build 2) — the changed routines in full, everything else in the file unchanged from fix round 7

The mainline column arm (`sw_stream_start_row` mirrors this exactly, on its own axis):
```asm
sw_ssc_loop:
; Fix round 10, build 2 (review 8 finding 4): fill-aware bounds check,
; BEFORE the relocate cache test -- sw_ss_sc is fixed for the whole column
; strip, so an out-of-bounds ENTERING column (a map narrower than the
; window needs) fills every block; sw_probe_row_screen advances every 15
; local rows, so it alone can also carry the strip off the map's own
; authored bottom edge on a shorter map. Same unsigned test
; sw_terrain_or_fill already uses (a wrapped-negative screen index is also
; caught, since it reads as >= gridW/gridH the same way).
  lda sw_ss_sc
  cmp sw_grid_w
  bcs sw_ssc_fill
  lda sw_probe_row_screen
  cmp sw_grid_h
  bcs sw_ssc_fill
  lda sw_ss_sc
  cmp sw_last_screen_col
  bne sw_ssc_relocate
  lda sw_probe_row_screen
  cmp sw_last_screen_row
  beq sw_ssc_read
sw_ssc_relocate:
  lda sw_ss_sc
  sta sw_last_screen_col
  lda sw_probe_row_screen
  sta sw_last_screen_row
  lda sw_ss_sc
  ldx sw_probe_row_screen
  jsr sw_goto
sw_ssc_read:
  lda sw_probe_row_local
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_ss_lc
  tay
  lda [mtptr_lo],y
  jmp sw_ssc_store
```

The renderer's own bounds check and shared fill-aware read point:
```asm
sw_rw_probe:
  lda sw_rw_base_col
  clc
  adc sw_rw_col
  jsr sw_rw_col_delta
  jsr sw_col_at_offset
  sta sw_probe_col_screen
  stx sw_probe_col_local
  lda sw_rw_base_row
  clc
  adc sw_rw_row
  jsr sw_rw_row_delta
  jsr sw_row_at_offset
  sta sw_probe_row_screen
  stx sw_probe_row_local
  lda sw_probe_row_local
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_probe_col_local
  sta sw_rw_offset
; Fix round 10, build 2 (review 8 finding 4): bounds check BEFORE the
; relocate cache test -- a probed cell can resolve to a screen past the
; map's own authored extent on either axis whenever the map is smaller
; than the render window's own two-screen physical reach (a 1x1/1xN/Nx1
; map, or any map at the far/near edge of a larger one). Same unsigned
; test sw_terrain_or_fill/the strip arms already use.
  lda sw_probe_col_screen
  cmp sw_grid_w
  bcs sw_rwp_fill
  lda sw_probe_row_screen
  cmp sw_grid_h
  bcs sw_rwp_fill
  lda #0
  sta sw_rw_oob
  lda sw_probe_col_screen
  cmp sw_last_screen_col
  bne sw_rwp_relocate
  lda sw_probe_row_screen
  cmp sw_last_screen_row
  beq sw_rwp_done
sw_rwp_relocate:
  lda sw_probe_col_screen
  sta sw_last_screen_col
  lda sw_probe_row_screen
  sta sw_last_screen_row
  lda sw_probe_col_screen
  ldx sw_probe_row_screen
  jsr sw_goto
sw_rwp_done:
  rts
sw_rwp_fill:
; No real screen at this probe position -- invalidate the cache (a render
; pass revisits screens in a fixed raster order, never depending on a
; fill excursion leaving a stale "current" screen behind) and let
; sw_rw_read_metatile substitute the fill metatile with no dereference.
  lda #1
  sta sw_rw_oob
```

The attribute quadrant's own independent bounds check (`sw_rw_attr_read` now just `jsr
sw_rw_read_metatile`, shown above):
```asm
sw_rw_attr_y_combine:
  pha
  txa
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_rw_tmp2
  sta sw_rw_offset
; Fix round 10, build 2 (review 8 finding 4): the same bounds check as
; sw_rw_probe, applied to the ATTRIBUTE quadrant's own (possibly
; different) probed screen -- an attribute lookup can reach one metatile
; past the terrain probe's own position (the neighbour quadrant), so it
; needs its own independent check, not a reuse of the terrain probe's.
  lda sw_tmp3                 ; screenCol
  cmp sw_grid_w
  bcs sw_rwa_fill_col
  pla                          ; A = screenRow, stack now balanced
  cmp sw_grid_h
  bcs sw_rwa_fill_row
  pha                          ; restore the original stack shape for the
                                ; unchanged cache-compare logic below
  lda #0
  sta sw_rw_oob
  lda sw_tmp3
  cmp sw_last_screen_col
  bne sw_rwa_relocate
  pla
  cmp sw_last_screen_row
  beq sw_rwa_done
  pha
sw_rwa_relocate:
  lda sw_tmp3
  sta sw_last_screen_col
  pla
  sta sw_last_screen_row
  lda sw_tmp3
  ldx sw_last_screen_row
  jsr sw_goto
sw_rwa_done:
  rts
sw_rwa_fill_col:
  pla                          ; balance the entry pha; value unused (fill)
sw_rwa_fill_row:
```

#### `streamworld_banked_primitive.asm`'s own fill-aware bounds check, new this round

```asm
; ==========================================================================
; sw_strip_fetch_run_col / sw_strip_fetch_run_row -- fix round 8, finding 3's
; own required resident, BANKED strip-fetch primitive: a caller resident in
; ANY PRG bank (not just mainline/field code) can fetch one screen's own
; contribution to a strip DIRECTLY into sbuf, restoring via sw_caller_bank
; exactly as sw_read_transaction does -- the "caller resident in a
; switchable bank" case review 6's own finding 3 requires proven, not just
; sw_peek_byte's own field-restore convenience.
;
; Two entry points, one shared body, stride hardcoded per entry rather than
; taken as a caller-set byte (saving the one RAM byte a stride parameter
; would otherwise cost, in a gap finding 7 already has none free in):
; sw_strip_fetch_run_col reads STRIDED bytes (stride 16 -- one column of a
; screen's own terrain, offset/offset+16/offset+32/...) for the banked
; column arm below; sw_strip_fetch_run_row reads CONTIGUOUS bytes (stride 1
; -- one local row of a screen's own terrain) for the banked row arm.
;
; In: A=screenCol, X=screenRow, Y=starting sbuf index, sw_run_off=starting
;     offset within the target screen's own 240-byte terrain block,
;     sw_run_len=count (1-16), sw_caller_bank=the caller's own PRG register.
; Out: sbuf[Y..Y+count-1] filled. Clobbers A, X, Y, sw_tmp, sw_tmp2, sw_tmp3.
;
; PLACEMENT IS NOT OPTIONAL: kernel-lo, always, never a switchable bank --
; found by a real crash, not reasoned in advance. A first draft put this
; primitive in bank 14 alongside its own caller (sw_banked_stream_start_col/
; row, below): "invalid opcode at $c051" (inside mt_tl, a DATA table) the
; instant sw_goto's own internal jsr switch_prg_bank ran. The reason is
; exactly the hazard sw_peek_byte's own header already names for its
; CALLER's sake, applied here to this routine's OWN code: sw_goto switches
; the $8000-$9FFF window to the TARGET screen's own bank before it returns;
; a caller-resident-in-that-same-window's own "return here" address is now
; pointing at the target screen's DATA, not this routine's own next
; instruction, so the very next fetch after `jsr sw_goto` executes garbage.
; Kernel-lo is exempt because it is the one window every PRG-switch leaves
; untouched -- exactly why sw_read_run/sw_peek_byte/sw_read_transaction all
; already live there. The CALLER (sw_banked_stream_start_col/row) can
; safely live in a switchable bank instead, because it only ever reaches
; this primitive through a `jsr` to a KERNEL-LO target and gets back a
; clean `rts` with its own bank (sw_caller_bank) already restored -- it
; never itself executes code from underneath a live PRG switch.
;
; Both entries share the loop body below (a code-size trim found necessary
; while chasing this round's own kernel-lo overflow, below). REAL BUG this
; round's own proof caught (diag_r8_banked_strip.mjs, a two-segment column
; wrote its second segment's own bytes back over its first's, at sbuf
; index 0 instead of 15): the FIRST draft did `sty sw_tmp2` to stash the
; starting sbuf index BEFORE `jsr sw_goto` -- but sw_goto's own clobber
; list is sw_tmp THROUGH sw_tmp6, ALL SIX, including sw_tmp2 as its own
; cold-path column-region accumulator, so the stashed value was destroyed
; mid-call, not preserved. A SECOND draft "fixed" this by pushing Y on the
; stack instead (`tya/pha`) -- which is real progress (the stack is the one
; place sw_goto truly cannot reach) but introduced a NEW bug the same
; proof caught immediately after: `tya` clobbers A, and A is where
; sw_goto's own screenCol ARGUMENT lives at entry, so the push destroyed
; the very argument the upcoming `jsr sw_goto` needed. The actual fix
; needs neither maneuver: sw_goto's own body contains no Y-register
; instruction anywhere (checked directly, not merely asserted) -- Y
; survives a `jsr sw_goto` call for free, exactly as sw_peek_byte's own
; header already documents for ITS caller's offset argument. So the
; starting sbuf index needs no stashing at all before the call; it is
; simply read INTO sw_tmp2 (and sw_tmp3 for the stride) once sw_goto has
; already returned, the identical "safe once returned" reuse
; sw_dlg_metatile's own header already relies on for the same two bytes.
; ==========================================================================
; Fix round 10, build 2 (review 8 finding 4): fill-aware bounds check,
; before sw_goto -- a single call always targets exactly ONE screen (the
; caller/arm splits a multi-screen strip into one call per screen segment),
; so this checks bounds once and either fills the WHOLE run or reads the
; WHOLE run for real, never a mix. Same unsigned test sw_terrain_or_fill/
; the mainline arms use.
sw_strip_fetch_run_col:
  cmp sw_grid_w
  bcs sw_sfr_fill
  cpx sw_grid_h
  bcs sw_sfr_fill
  jsr sw_goto
  sty sw_tmp2                 ; starting sbuf index -- safe NOW, sw_goto
                               ; has already returned and never touched Y
  lda #16                     ; column stride
  sta sw_tmp3
  jmp sw_sfr_body
sw_strip_fetch_run_row:
  cmp sw_grid_w
  bcs sw_sfr_fill
  cpx sw_grid_h
  bcs sw_sfr_fill
  jsr sw_goto
  sty sw_tmp2
  lda #1                      ; row stride
  sta sw_tmp3
sw_sfr_body:
  lda sw_run_off
  sta sw_tmp                  ; running source offset
  ldx #0
sw_sfr_loop:
  cpx sw_run_len
  bcs sw_sfr_finish
  ldy sw_tmp
  lda [mtptr_lo],y
  ldy sw_tmp2
  sta sbuf,y
  lda sw_tmp
  clc
  adc sw_tmp3
  sta sw_tmp
  inc sw_tmp2
  inx
  jmp sw_sfr_loop
sw_sfr_finish:
  lda sw_caller_bank
  jsr switch_prg_bank
  rts
sw_sfr_fill:
; No real screen -- sw_goto never ran, so the caller's own bank was never
; switched away and there is nothing for switch_prg_bank to restore here
; (unlike sw_sfr_finish's own real-read exit). Y (starting sbuf index) is
; still exactly what the caller passed, untouched by the cmp/cpx above.
  sty sw_tmp2
  ldx #0
sw_sfr_fill_loop:
  cpx sw_run_len
  bcs sw_sfr_fill_done
  lda sw_fill_metatile_id
  ldy sw_tmp2
  sta sbuf,y
  inc sw_tmp2
  inx
  jmp sw_sfr_fill_loop
sw_sfr_fill_done:
  rts
```

#### `proto-tools/diag_r10_smallgrid.mjs`, new this round — integrated fill-aware tests, 1x1/1xN/Nx1/3x3

```javascript
// diag_r10_smallgrid.mjs -- fix round 10, build 2: integrated fill-aware
// tests on 1x1, 1xN and Nx1 grids, plus a 3x3 re-confirmation, per the
// brief's own explicit ask. Reuses minimal-u512's own real r2_data fixture
// (a physically-populated 3x3 grid, screens (screenCol,screenRow) with
// markers 1,2,3 / 11,12,13 / 21,22,23 -- build_r2_fixture.mjs's own
// screenBytes(marker) formula: byte 0 = marker, byte i = (i*5+marker)%64)
// UNCHANGED -- no new ROM build needed. A "1x1"/"1xN"/"Nx1" grid is
// exercised by poking sw_grid_w/sw_grid_h SMALLER than the fixture's real
// physical extent: the bounds check this round added is a pure RAM-byte
// comparison, so a screen beyond the announced grid is unreachable by the
// routines under test regardless of what real data physically sits behind
// it in ROM -- exactly proving the routines respect sw_grid_w/sw_grid_h
// rather than the ROM's own physical shape. sw_fill_metatile_id is poked
// to 99, a value no real marker or its (offset*5+marker)%64 derivative can
// ever produce (real terrain values are 0-63), so a fill read is
// unambiguous.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

function callRoutineSlow(nes, address, maxSteps = 1000000) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    nes.cpu.emulate();
    if (++steps >= maxSteps) throw new Error('routine never returned to the stub (slow)');
  }
  return steps;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

const RAM = {};
{
  let a = 0x59f;
  for (const n of ['sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi',
    'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h',
    'sw_tmp', 'sw_tmp2', 'sw_tmp3', 'sw_tmp4', 'sw_tmp5', 'sw_tmp6',
    'win_col_screen', 'win_col_local', 'win_row_screen', 'win_row_local',
    'st_active', 'st_cur', 'st_len', 'st_ftile', 'st_fnt', 'st_vary', 'ss_i']) {
    a += 1; RAM[n] = a;
  }
  RAM.sbuf = RAM.ss_i + 1; // 32 bytes
}
// sw_fill_metatile_id: chained off sw_run_buf (RAM.sbuf+32's own chain,
// same derivation diag_r8_banked_strip.mjs already cross-checked) --
// sw_ss_sc..sw_run_buf[8], then +1.
const RAM_TAIL = {};
{
  let a = RAM.sbuf + 32; // sw_ss_sc
  for (const n of ['sw_ss_sc', 'sw_ss_lc', 'sw_ss_sr', 'sw_ss_lr', 'sw_probe_col_screen', 'sw_probe_col_local',
    'sw_probe_row_screen', 'sw_probe_row_local', 'sw_last_screen_col', 'sw_last_screen_row',
    'sw_rw_nt', 'sw_rw_row', 'sw_rw_col', 'sw_rw_base_col', 'sw_rw_base_row', 'sw_rw_offset',
    'sw_rw_arow', 'sw_rw_acol', 'sw_rw_tmp', 'sw_rw_tmp2', 'sw_rw_wbase_col', 'sw_rw_wbase_row',
    'sw_caller_bank', 'sw_run_off', 'sw_run_len']) {
    RAM_TAIL[n] = a; a += 1;
  }
  RAM_TAIL.sw_run_buf = a; a += 8;
  RAM_TAIL.sw_fill_metatile_id = a; a += 1;
  RAM_TAIL.sw_rw_oob = a;
}
if (RAM_TAIL.sw_caller_bank !== 0x5f2) throw new Error(`sw_caller_bank chain mismatch: got 0x${RAM_TAIL.sw_caller_bank.toString(16)}, expected 0x5f2`);
// 50: unused by any real marker or (offset*5+marker)%64 comparison this
// file makes at the specific positions it checks, AND inside mt_tl/tr/bl/
// br's own real 0-63 identity-mapped range (metatiles.inc) -- a fill value
// of 99 first exposed this: mt_tl only has 64 entries, so index 99 reads
// 35 bytes into mt_tr's OWN table by simple overrun, not a routing bug
// (caught by testRenderWindow, which checks the rendered TILE id via
// mt_tl/mt_pal, not the raw sbuf/mtptr byte the strip tests check).
const FILL = 50;

function marker(screenCol, screenRow) {
  const table = { '0,0': 1, '1,0': 2, '2,0': 3, '0,1': 11, '1,1': 12, '2,1': 13, '0,2': 21, '1,2': 22, '2,2': 23 };
  return table[`${screenCol},${screenRow}`];
}
function realByte(screenCol, screenRow, offset) {
  const m = marker(screenCol, screenRow);
  return offset === 0 ? m : (offset * 5 + m) % 64;
}

function freshNes(gridW, gridH) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_grid_w] = gridW;
  nes.cpu.mem[RAM.sw_grid_h] = gridH;
  nes.cpu.mem[RAM_TAIL.sw_fill_metatile_id] = FILL;
  return nes;
}

let failures = 0, observations = 0;
function check(name, cond) { observations++; if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

// -------------------------------------------------------------------------
// Column-strip test: entering (screenCol, localCol=0), full 30-block strip
// down the window's own current row origin (win_row_screen/local, always
// (0,0) here). Real markers where screenRow < gridH AND screenCol < gridW,
// fill otherwise.
function testColumnStrip(label, gridW, gridH, enterScreenCol) {
  const nes = freshNes(gridW, gridH);
  nes.cpu.mem[RAM.win_row_screen] = 0;
  nes.cpu.mem[RAM.win_row_local] = 0;
  nes.cpu.REG_ACC = enterScreenCol;
  nes.cpu.REG_X = 0;
  callRoutine(nes, addr('sw_stream_start_col'));
  for (let i = 0; i < 30; i++) {
    // localRow 0-14 -> screenRow 0 (rows 0-14), localRow 15-29 -> screenRow 1
    const screenRow = i < 15 ? 0 : 1;
    const localRow = i < 15 ? i : i - 15;
    const inBounds = enterScreenCol < gridW && screenRow < gridH;
    const expected = inBounds ? realByte(enterScreenCol, screenRow, localRow * 16 + 0) : FILL;
    const actual = nes.cpu.mem[RAM.sbuf + i];
    check(`${label} col-strip enter=${enterScreenCol} sbuf[${i}] (screen ${enterScreenCol},${screenRow} local(0,${localRow})) expected=${expected} actual=${actual}`, actual === expected);
  }
}

// Row-strip test: entering (screenRow, localRow=0), full 32-block strip
// across the window's own current col origin (win_col_screen/local, (0,0)).
function testRowStrip(label, gridW, gridH, enterScreenRow) {
  const nes = freshNes(gridW, gridH);
  nes.cpu.mem[RAM.win_col_screen] = 0;
  nes.cpu.mem[RAM.win_col_local] = 0;
  nes.cpu.REG_ACC = enterScreenRow;
  nes.cpu.REG_X = 0;
  callRoutine(nes, addr('sw_stream_start_row'));
  for (let i = 0; i < 32; i++) {
    const screenCol = i < 16 ? 0 : 1;
    const localCol = i < 16 ? i : i - 16;
    const inBounds = enterScreenRow < gridH && screenCol < gridW;
    const expected = inBounds ? realByte(screenCol, enterScreenRow, 0 * 16 + localCol) : FILL;
    const actual = nes.cpu.mem[RAM.sbuf + i];
    check(`${label} row-strip enter=${enterScreenRow} sbuf[${i}] (screen ${screenCol},${enterScreenRow} local(${localCol},0)) expected=${expected} actual=${actual}`, actual === expected);
  }
}

// Full sw_render_window test at origin (0,0,0,0): checks terrain block
// (0,0) of all 4 nametables plus the corresponding attribute byte.
const NT_TORUS_ORIGIN = [[0, 0], [16, 0], [0, 15], [16, 15]];
const ntBase = [0x2000, 0x2400, 0x2800, 0x2c00];
const NT_SCREEN = [[0, 0], [1, 0], [0, 1], [1, 1]]; // origin (0,0,0,0) -> NTk names screen (k&1, k>>1)

function testRenderWindow(label, gridW, gridH) {
  const nes = freshNes(gridW, gridH);
  nes.cpu.mem[RAM.win_col_screen] = 0;
  nes.cpu.mem[RAM.win_col_local] = 0;
  nes.cpu.mem[RAM.win_row_screen] = 0;
  nes.cpu.mem[RAM.win_row_local] = 0;
  nes.cpu.mem[RAM.sw_col] = 0;
  nes.cpu.mem[RAM.sw_row] = 0;
  nes.cpu.mem[RAM.sw_col_rem] = 0;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = 0;
  nes.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nes.cpu.mem[RAM.sw_row_bank_base] = 0;
  callRoutineSlow(nes, addr('sw_render_window'));

  for (let nt = 0; nt < 4; nt++) {
    const [screenCol, screenRow] = NT_SCREEN[nt];
    const inBounds = screenCol < gridW && screenRow < gridH;
    const expectedTerrain = inBounds ? realByte(screenCol, screenRow, 0) : FILL;
    const tileAddr = ntBase[nt];
    const actualTerrain = nes.ppu.vramMem[tileAddr];
    check(`${label} render NT${nt} block(0,0) screen(${screenCol},${screenRow}) terrain expected=${expectedTerrain} actual=${actualTerrain}`, actualTerrain === expectedTerrain);

    // Attribute byte for arow=0,acol=0: TL/TR/BL/BR quadrants there are
    // local (0,0)/(1,0)/(0,1)/(1,1) -- all four stay inside THIS SAME
    // screen (local < 16 col, < 15 row), never the neighbour, so the
    // whole byte is determined by this one screen's in/out-of-bounds
    // status alone. pal(v) = v % 4 (mt_pal's own real, checked table).
    const pal = (v) => v % 4;
    const q = (localCol, localRow) => inBounds ? pal(realByte(screenCol, screenRow, localRow * 16 + localCol)) : pal(FILL);
    const tl = q(0, 0), tr = q(1, 0), bl = q(0, 1), br = q(1, 1);
    const expectedAttr = tl | (tr << 2) | (bl << 4) | (br << 6);
    const attrAddr = ntBase[nt] + 0x3c0; // arow=0,acol=0 -> first attribute byte
    const actualAttr = nes.ppu.vramMem[attrAddr];
    check(`${label} render NT${nt} block(0,0) screen(${screenCol},${screenRow}) attribute expected=${expectedAttr} actual=${actualAttr}`, actualAttr === expectedAttr);
  }
}

console.log('=== fix round 10, build 2: integrated fill-aware tests, small grids ===');

console.log('\n-- 1x1 grid (gridW=1, gridH=1) --');
testColumnStrip('1x1', 1, 1, 0);
testColumnStrip('1x1', 1, 1, 1); // entering column itself OOB -> all fill
testRowStrip('1x1', 1, 1, 0);
testRowStrip('1x1', 1, 1, 1); // entering row itself OOB -> all fill
testRenderWindow('1x1', 1, 1);

console.log('\n-- 1xN grid (gridW=1, gridH=3) --');
testColumnStrip('1x3', 1, 3, 0);   // entering col in-bounds, walks 2 real screens down
testColumnStrip('1x3', 1, 3, 1);   // entering col itself OOB
testRowStrip('1x3', 1, 3, 0);      // entering row 0, but window col axis only 1 wide
testRowStrip('1x3', 1, 3, 2);      // entering row 2 (last real row) then off the bottom for local>=15... row strip doesn't cross rows though
testRenderWindow('1x3', 1, 3);

console.log('\n-- Nx1 grid (gridW=3, gridH=1) --');
testColumnStrip('3x1', 3, 1, 0);
testColumnStrip('3x1', 3, 1, 2);   // last real column, row axis only 1 tall
testRowStrip('3x1', 3, 1, 0);
testRowStrip('3x1', 3, 1, 1);      // entering row itself OOB
testRenderWindow('3x1', 3, 1);

console.log('\n-- 3x3 grid re-confirmation (gridW=3, gridH=3, real data, no fill expected) --');
testColumnStrip('3x3', 3, 3, 0);
testColumnStrip('3x3', 3, 3, 1);
testRowStrip('3x3', 3, 3, 0);
testRowStrip('3x3', 3, 3, 1);
testRenderWindow('3x3', 3, 3);

console.log(`\n${observations} observations, ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
```

Real output (tail):
```
ok   3x3 render NT1 block(0,0) screen(1,0) terrain expected=2 actual=2
ok   3x3 render NT1 block(0,0) screen(1,0) attribute expected=238 actual=238
ok   3x3 render NT2 block(0,0) screen(0,1) terrain expected=11 actual=11
ok   3x3 render NT2 block(0,0) screen(0,1) attribute expected=51 actual=51
ok   3x3 render NT3 block(0,0) screen(1,1) terrain expected=12 actual=12
ok   3x3 render NT3 block(0,0) screen(1,1) attribute expected=68 actual=68

528 observations, ALL PASS
```

#### `proto-tools/diag_r10_primitive_fill.mjs`, new this round — the banked primitive's own fill path

```javascript
// diag_r10_primitive_fill.mjs -- fix round 10, build 2: proves the BANKED
// sw_strip_fetch_run_col primitive's own fill path (review 8 finding 4
// explicitly names this primitive, not just the two mainline arms and
// sw_render_window). A single call always targets exactly one screen (the
// caller/arm splits a multi-screen strip into one call per segment), so
// this checks: (1) an out-of-bounds target fills the WHOLE requested run
// with sw_fill_metatile_id, not a mix or garbage; (2) the caller's own
// bank is genuinely never switched away in that case (sw_goto never runs),
// proven the same fingerprint way diag_r10_banked_strip.mjs already
// proves the REAL-read path's own restore; (3) the real-read path is
// unaffected (still returns real markers) for contrast.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

const RAM = {};
{
  let a = 0x59f;
  for (const n of ['sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi',
    'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h',
    'sw_tmp', 'sw_tmp2', 'sw_tmp3', 'sw_tmp4', 'sw_tmp5', 'sw_tmp6',
    'win_col_screen', 'win_col_local', 'win_row_screen', 'win_row_local',
    'st_active', 'st_cur', 'st_len', 'st_ftile', 'st_fnt', 'st_vary', 'ss_i']) {
    a += 1; RAM[n] = a;
  }
  RAM.sbuf = RAM.ss_i + 1;
}
const TAIL = {};
{
  let a = RAM.sbuf + 32;
  for (const n of ['sw_ss_sc', 'sw_ss_lc', 'sw_ss_sr', 'sw_ss_lr', 'sw_probe_col_screen', 'sw_probe_col_local',
    'sw_probe_row_screen', 'sw_probe_row_local', 'sw_last_screen_col', 'sw_last_screen_row',
    'sw_rw_nt', 'sw_rw_row', 'sw_rw_col', 'sw_rw_base_col', 'sw_rw_base_row', 'sw_rw_offset',
    'sw_rw_arow', 'sw_rw_acol', 'sw_rw_tmp', 'sw_rw_tmp2', 'sw_rw_wbase_col', 'sw_rw_wbase_row',
    'sw_caller_bank', 'sw_run_off', 'sw_run_len']) {
    TAIL[n] = a; a += 1;
  }
  TAIL.sw_run_buf = a; a += 8;
  TAIL.sw_fill_metatile_id = a;
}
if (TAIL.sw_caller_bank !== 0x5f2) throw new Error(`chain mismatch: 0x${TAIL.sw_caller_bank.toString(16)}`);

function freshNes(gridW, gridH, fillId) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_grid_w] = gridW;
  nes.cpu.mem[RAM.sw_grid_h] = gridH;
  nes.cpu.mem[TAIL.sw_fill_metatile_id] = fillId;
  return nes;
}

let failures = 0, observations = 0;
function check(name, cond) { observations++; if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

console.log('=== fix round 10, build 2: sw_strip_fetch_run_col/row fill path ===\n');

// -- Fill case: screenCol=1, sw_grid_w=1 -> out of bounds --
{
  const nes = freshNes(1, 1, 77);
  nes.cpu.REG_ACC = 7;
  callRoutine(nes, addr('switch_prg_bank'));
  const fpBefore = nes.cpu.loadFromCartridge(0x8000);
  nes.cpu.mem[TAIL.sw_caller_bank] = 7;
  nes.cpu.mem[TAIL.sw_run_off] = 5;
  nes.cpu.mem[TAIL.sw_run_len] = 4;
  nes.cpu.REG_ACC = 1; nes.cpu.REG_X = 0; nes.cpu.REG_Y = 10; // sbuf[10..13]
  const cycles = callRoutine(nes, addr('sw_strip_fetch_run_col'));
  const fpAfter = nes.cpu.loadFromCartridge(0x8000);
  const got = [10, 11, 12, 13].map((i) => nes.cpu.mem[RAM.sbuf + i]);
  check('fill: sbuf[10..13] all = 77', got.every((v) => v === 77));
  check('fill: caller bank never switched away (fingerprint unchanged)', fpBefore === fpAfter);
  console.log(`  fill-path cost: ${cycles} cycles (4-byte run)`);
}
// -- Row primitive, same check --
{
  const nes = freshNes(1, 1, 88);
  nes.cpu.REG_ACC = 7;
  callRoutine(nes, addr('switch_prg_bank'));
  nes.cpu.mem[TAIL.sw_caller_bank] = 7;
  nes.cpu.mem[TAIL.sw_run_off] = 0;
  nes.cpu.mem[TAIL.sw_run_len] = 3;
  nes.cpu.REG_ACC = 0; nes.cpu.REG_X = 1; nes.cpu.REG_Y = 5; // screenRow=1, grid_h=1 -> OOB
  callRoutine(nes, addr('sw_strip_fetch_run_row'));
  const got = [5, 6, 7].map((i) => nes.cpu.mem[RAM.sbuf + i]);
  check('fill (row): sbuf[5..7] all = 88', got.every((v) => v === 88));
}
// -- Real case for contrast: screenCol=1, screenRow=0, in-bounds --
{
  const nes = freshNes(3, 3, 77);
  nes.cpu.REG_ACC = 7;
  callRoutine(nes, addr('switch_prg_bank'));
  nes.cpu.mem[TAIL.sw_caller_bank] = 7;
  nes.cpu.mem[TAIL.sw_run_off] = 0;
  nes.cpu.mem[TAIL.sw_run_len] = 2;
  nes.cpu.REG_ACC = 1; nes.cpu.REG_X = 0; nes.cpu.REG_Y = 0;
  callRoutine(nes, addr('sw_strip_fetch_run_col'));
  const got = [0, 1].map((i) => nes.cpu.mem[RAM.sbuf + i]);
  // screen(1,0) marker=2: offset 0 -> 2, offset 16 (stride 16) -> (16*5+2)%64=18
  check('real: sbuf[0..1] = [2, 18] (screen(1,0), stride 16)', got[0] === 2 && got[1] === 18);
}

console.log(`\n${observations} observations, ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
```

Real output:
```
=== fix round 10, build 2: sw_strip_fetch_run_col/row fill path ===

ok   fill: sbuf[10..13] all = 77
ok   fill: caller bank never switched away (fingerprint unchanged)
  fill-path cost: 152 cycles (4-byte run)
ok   fill (row): sbuf[5..7] all = 88
ok   real: sbuf[0..1] = [2, 18] (screen(1,0), stride 16)

4 observations, ALL PASS
```

#### `proto-tools/diag_r10_routed_costs.mjs`, new this round — real cycle costs, routed arms and renderer

```javascript
// diag_r10_routed_costs.mjs -- fix round 10, build 2: real 6502 cycle costs
// of the now fill-aware mainline strip arms, the banked strip-fetch
// primitive, and the full renderer, on minimal-u512's own real 3x3
// fixture. Reports both the REAL-READ path (in-bounds, same work as
// before plus the new bounds check) and the FILL path (skips sw_goto and
// the mtptr dereference entirely, cheaper), so the report can state the
// worst-case (real-read, which is a superset of fill's own work on every
// arm here) mainline per-frame cost against decision A's own budget.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

function callRoutineSlow(nes, address, maxSteps = 2_000_000) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let cycles = 0, steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    cycles += nes.cpu.emulate();
    if (++steps >= maxSteps) throw new Error('routine never returned to the stub');
  }
  return cycles;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

const RAM = {};
{
  let a = 0x59f;
  for (const n of ['sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi',
    'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h',
    'sw_tmp', 'sw_tmp2', 'sw_tmp3', 'sw_tmp4', 'sw_tmp5', 'sw_tmp6',
    'win_col_screen', 'win_col_local', 'win_row_screen', 'win_row_local',
    'st_active', 'st_cur', 'st_len', 'st_ftile', 'st_fnt', 'st_vary', 'ss_i']) {
    a += 1; RAM[n] = a;
  }
  RAM.sbuf = RAM.ss_i + 1; // 32 bytes
}
const RAM_TAIL = {};
{
  let a = RAM.sbuf + 32; // sw_ss_sc
  for (const n of ['sw_ss_sc', 'sw_ss_lc', 'sw_ss_sr', 'sw_ss_lr', 'sw_probe_col_screen', 'sw_probe_col_local',
    'sw_probe_row_screen', 'sw_probe_row_local', 'sw_last_screen_col', 'sw_last_screen_row',
    'sw_rw_nt', 'sw_rw_row', 'sw_rw_col', 'sw_rw_base_col', 'sw_rw_base_row', 'sw_rw_offset',
    'sw_rw_arow', 'sw_rw_acol', 'sw_rw_tmp', 'sw_rw_tmp2', 'sw_rw_wbase_col', 'sw_rw_wbase_row',
    'sw_caller_bank', 'sw_run_off', 'sw_run_len']) {
    RAM_TAIL[n] = a; a += 1;
  }
  RAM_TAIL.sw_run_buf = a; a += 8;
  RAM_TAIL.sw_fill_metatile_id = a;
}
if (RAM_TAIL.sw_caller_bank !== 0x5f2) throw new Error(`chain mismatch: 0x${RAM_TAIL.sw_caller_bank.toString(16)}`);

function freshNes(gridW, gridH) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_grid_w] = gridW;
  nes.cpu.mem[RAM.sw_grid_h] = gridH;
  return nes;
}

const FRAME_BUDGET = 29780;
function pct(c) { return (c / FRAME_BUDGET * 100).toFixed(2); }

console.log('=== fix round 10, build 2: real cycle costs, fill-aware routed arms ===\n');

// -- Mainline column/row arms: real-read (3x3 grid, in bounds) vs fill (1x1
// grid, entering column/row itself out of bounds -- pure fill, no sw_goto
// at all) --
{
  const nesReal = freshNes(3, 3);
  nesReal.cpu.mem[RAM.win_row_screen] = 0;
  nesReal.cpu.mem[RAM.win_row_local] = 0;
  nesReal.cpu.REG_ACC = 1; nesReal.cpu.REG_X = 0;
  const realCost = callRoutine(nesReal, addr('sw_stream_start_col'));

  const nesFill = freshNes(1, 1);
  nesFill.cpu.mem[RAM.win_row_screen] = 0;
  nesFill.cpu.mem[RAM.win_row_local] = 0;
  nesFill.cpu.REG_ACC = 1; nesFill.cpu.REG_X = 0; // entering col 1, grid_w=1 -> all fill
  const fillCost = callRoutine(nesFill, addr('sw_stream_start_col'));

  console.log(`sw_stream_start_col (30 blocks): real-read=${realCost} cycles (${pct(realCost)}%), all-fill=${fillCost} cycles (${pct(fillCost)}%)`);
}
{
  const nesReal = freshNes(3, 3);
  nesReal.cpu.mem[RAM.win_col_screen] = 0;
  nesReal.cpu.mem[RAM.win_col_local] = 0;
  nesReal.cpu.REG_ACC = 1; nesReal.cpu.REG_X = 0;
  const realCost = callRoutine(nesReal, addr('sw_stream_start_row'));

  const nesFill = freshNes(1, 1);
  nesFill.cpu.mem[RAM.win_col_screen] = 0;
  nesFill.cpu.mem[RAM.win_col_local] = 0;
  nesFill.cpu.REG_ACC = 1; nesFill.cpu.REG_X = 0;
  const fillCost = callRoutine(nesFill, addr('sw_stream_start_row'));

  console.log(`sw_stream_start_row (32 blocks): real-read=${realCost} cycles (${pct(realCost)}%), all-fill=${fillCost} cycles (${pct(fillCost)}%)`);
}

// -- Banked primitive (sw_strip_fetch_run_col), real vs fill, 8-byte run --
{
  const nesReal = freshNes(3, 3);
  nesReal.cpu.REG_ACC = 7; callRoutine(nesReal, addr('switch_prg_bank'));
  nesReal.cpu.mem[RAM_TAIL.sw_caller_bank] = 7;
  nesReal.cpu.mem[RAM_TAIL.sw_run_off] = 0;
  nesReal.cpu.mem[RAM_TAIL.sw_run_len] = 8;
  nesReal.cpu.REG_ACC = 1; nesReal.cpu.REG_X = 0; nesReal.cpu.REG_Y = 0;
  const realCost = callRoutine(nesReal, addr('sw_strip_fetch_run_col'));

  const nesFill = freshNes(1, 1);
  nesFill.cpu.REG_ACC = 7; callRoutine(nesFill, addr('switch_prg_bank'));
  nesFill.cpu.mem[RAM_TAIL.sw_caller_bank] = 7;
  nesFill.cpu.mem[RAM_TAIL.sw_run_off] = 0;
  nesFill.cpu.mem[RAM_TAIL.sw_run_len] = 8;
  nesFill.cpu.REG_ACC = 1; nesFill.cpu.REG_X = 0; nesFill.cpu.REG_Y = 0; // screenCol=1, grid_w=1 -> fill
  const fillCost = callRoutine(nesFill, addr('sw_strip_fetch_run_col'));

  console.log(`sw_strip_fetch_run_col (8-byte run): real-read=${realCost} cycles, all-fill=${fillCost} cycles (cheaper: no sw_goto/switch_prg_bank at all)`);
}

// -- Full renderer: 3x3 (all real) vs 1x1 (3 of 4 nametables fill) --
{
  const nesReal = freshNes(3, 3);
  nesReal.cpu.mem[RAM.win_col_screen] = 0; nesReal.cpu.mem[RAM.win_col_local] = 0;
  nesReal.cpu.mem[RAM.win_row_screen] = 0; nesReal.cpu.mem[RAM.win_row_local] = 0;
  nesReal.cpu.mem[RAM.sw_col] = 0; nesReal.cpu.mem[RAM.sw_row] = 0;
  nesReal.cpu.mem[RAM.sw_col_rem] = 0; nesReal.cpu.mem[RAM.sw_col_region] = 0;
  nesReal.cpu.mem[RAM.sw_col_byte_lo] = 0; nesReal.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nesReal.cpu.mem[RAM.sw_row_bank_base] = 0;
  const realCost = callRoutineSlow(nesReal, addr('sw_render_window'));

  const nesFill = freshNes(1, 1);
  nesFill.cpu.mem[RAM.win_col_screen] = 0; nesFill.cpu.mem[RAM.win_col_local] = 0;
  nesFill.cpu.mem[RAM.win_row_screen] = 0; nesFill.cpu.mem[RAM.win_row_local] = 0;
  nesFill.cpu.mem[RAM.sw_col] = 0; nesFill.cpu.mem[RAM.sw_row] = 0;
  nesFill.cpu.mem[RAM.sw_col_rem] = 0; nesFill.cpu.mem[RAM.sw_col_region] = 0;
  nesFill.cpu.mem[RAM.sw_col_byte_lo] = 0; nesFill.cpu.mem[RAM.sw_col_byte_hi] = 0;
  nesFill.cpu.mem[RAM.sw_row_bank_base] = 0;
  const fillCost = callRoutineSlow(nesFill, addr('sw_render_window'));

  console.log(`sw_render_window (full 4-nametable redraw): 3x3-real=${realCost} cycles, 1x1(3/4 NT fill)=${fillCost} cycles`);
  console.log('  (sw_render_window is a forced-blank, once-per-crossing cost, not a per-frame one -- CLAUDE.md\'s own "redraw_screen_slide" discipline; not charged against the 1.5px/frame mainline budget below.)');
}

console.log(`\nFrame budget: ${FRAME_BUDGET} cycles (NTSC, 60.0988 fps).`);
console.log('Decision A (SW_SPEED_SUB_X=128, 1.5 px/frame): a column strip arms once per 10-11 frames');
console.log('(the X crossing interval fix round 9 measured), so the mainline per-frame COST this adds is');
console.log('the real-read sw_stream_start_col cost above, amortized: worst single frame pays the full');
console.log('arm cost the frame a crossing completes, zero on every other frame -- unchanged in KIND from');
console.log('every prior round\'s own accounting (fix round 9\'s own worst-chunk NMI proof already carries');
console.log('the DRAIN side of this; this script is the ARM/PROBE side, main-loop, never NMI).');
```

Real output:
```
=== fix round 10, build 2: real cycle costs, fill-aware routed arms ===

sw_stream_start_col (30 blocks): real-read=3911 cycles (13.13%), all-fill=2179 cycles (7.32%)
sw_stream_start_row (32 blocks): real-read=4077 cycles (13.69%), all-fill=2280 cycles (7.66%)
sw_strip_fetch_run_col (8-byte run): real-read=666 cycles, all-fill=272 cycles (cheaper: no sw_goto/switch_prg_bank at all)
sw_render_window (full 4-nametable redraw): 3x3-real=969527 cycles, 1x1(3/4 NT fill)=919713 cycles
  (sw_render_window is a forced-blank, once-per-crossing cost, not a per-frame one -- CLAUDE.md's own "redraw_screen_slide" discipline; not charged against the 1.5px/frame mainline budget below.)

Frame budget: 29780 cycles (NTSC, 60.0988 fps).
Decision A (SW_SPEED_SUB_X=128, 1.5 px/frame): a column strip arms once per 10-11 frames
(the X crossing interval fix round 9 measured), so the mainline per-frame COST this adds is
the real-read sw_stream_start_col cost above, amortized: worst single frame pays the full
arm cost the frame a crossing completes, zero on every other frame -- unchanged in KIND from
every prior round's own accounting (fix round 9's own worst-chunk NMI proof already carries
the DRAIN side of this; this script is the ARM/PROBE side, main-loop, never NMI).
```

#### `proto-tools/diag_r10_full_parity.mjs`, new this round — the full exhaustive unaligned x all-parity regression, now runnable

```javascript
// diag_r10_full_parity.mjs -- fix round 10, build 2 (review 8 finding 4):
// the full unaligned x all-parity sw_render_window regression fix round 8
// (diag_r8_unaligned_parity.mjs) explicitly could not run, because a local
// overflow could push a probe onto a THIRD screen the 3x3 fixture never
// populated, and sw_render_window had no fill guard at all -- exactly the
// gap this round's own routing work closed. Now that sw_rw_probe/
// sw_rw_attr_y_combine/sw_rw_read_metatile treat any screen past
// sw_grid_w/sw_grid_h as fill rather than reading unpopulated ROM, EVERY
// origin/local combination is well-defined (real marker inside the 3x3
// grid, sw_fill_metatile_id outside it), so the sweep below drops fix
// round 8's own restriction (origins kept at {0,1}, only 3 representative
// local offsets) and exhaustively covers all 4 origin parities x all 16
// col-local x 15 row-local offsets (240 combinations each) x all 4
// nametables x 2 representative points per nametable (block(0,0) and
// block(3,3), the same two points fix round 8 already used) --
// 4*16*15*4*2 = 7,680 independently-computed comparisons. This is not
// claimed to be numerically identical to the reviewer's own cited
// 52,224-comparison figure (its derivation was not reproduced), but it is
// a genuine, EXHAUSTIVE sweep of the entire origin-parity x local-offset
// space, not a sampled subset of it, and it is what "now runnable because
// out-of-grid reads return fill" concretely means: many of these 7,680
// comparisons resolve to fill on one or more of the 4 nametables (any
// local offset that pushes a screen past index 2), which fix round 8
// could not even attempt. The independent oracle is
// `sw_col_at_offset`/`sw_row_at_offset`'s own formula (read directly from
// streamworld.asm, transcribed here in JS, not re-derived from the render
// routine's own output) feeding `sw_terrain_or_fill`'s own
// INDEPENDENTLY PROVEN accessor (diag_r5_fill.mjs, diag_r7/r8's own reuse)
// for the expected byte -- so the render routine and the expected-value
// computation never share the same code path for the actual READ, only
// for the coordinate DECOMPOSITION (disclosed, not hidden).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

const RAM = {};
{
  let a = 0x59f;
  for (const n of ['sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi', 'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h', 'sw_tmp', 'sw_tmp2', 'sw_tmp3', 'sw_tmp4', 'sw_tmp5', 'sw_tmp6', 'win_col_screen', 'win_col_local', 'win_row_screen', 'win_row_local']) {
    a += 1; RAM[n] = a;
  }
}

function freshNes() {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame();
  nes.mmap.write(0x2000, 0);
  return nes;
}

// callRoutine's own 20,000-step watchdog is too tight for a full render
// (T8's own note: it needs a slower cap) -- mirror verify_torus.mjs's own
// callRoutineSlow.
function callRoutineSlow(nes, address) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let cycles = 0, steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    cycles += nes.cpu.emulate();
    if (++steps >= 2_000_000) throw new Error('sw_render_window never returned to the stub');
  }
  return cycles;
}

// Independent oracle: sw_col_at_offset/sw_row_at_offset's own formula,
// transcribed directly from streamworld.asm (not re-derived from
// sw_render_window's own behaviour):
//   colTotal = delta + win_col_local; localCol = colTotal & 15;
//   screenCol = win_col_screen + (colTotal >> 4)
//   rowTotal = delta + win_row_local; localRow = rowTotal mod 15 (repeated subtract);
//   screenRow = win_row_screen + floor(rowTotal / 15)
function colAtOffset(delta, winColScreen, winColLocal) {
  const total = delta + winColLocal;
  return { screenCol: winColScreen + (total >> 4), localCol: total & 15 };
}
function rowAtOffset(delta, winRowScreen, winRowLocal) {
  let total = delta + winRowLocal;
  let screenRowAdd = 0;
  while (total >= 15) { total -= 15; screenRowAdd += 1; }
  return { screenRow: winRowScreen + screenRowAdd, localRow: total };
}
// wbase: the window's own ring-relative origin (sw_rw_wbase_col/row).
function wbaseCol(winColScreen, winColLocal) { return (winColScreen & 1) * 16 + winColLocal; }
function wbaseRow(winRowScreen, winRowLocal) { return (winRowScreen & 1) * 15 + winRowLocal; }
// physical torus position (0-31 col / 0-29 row) -> window-relative delta,
// via sw_rw_col_delta/sw_rw_row_delta's own wrap.
function colDelta(torusCol, winColScreen, winColLocal) {
  return (((torusCol - wbaseCol(winColScreen, winColLocal)) % 32) + 32) % 32;
}
function rowDelta(torusRow, winRowScreen, winRowLocal) {
  let d = (((torusRow - wbaseRow(winRowScreen, winRowLocal)) % 30) + 30) % 30;
  return d;
}
function expectedScreenLocal(torusCol, torusRow, winColScreen, winColLocal, winRowScreen, winRowLocal) {
  const cd = colDelta(torusCol, winColScreen, winColLocal);
  const rd = rowDelta(torusRow, winRowScreen, winRowLocal);
  const { screenCol, localCol } = colAtOffset(cd, winColScreen, winColLocal);
  const { screenRow, localRow } = rowAtOffset(rd, winRowScreen, winRowLocal);
  return { screenCol, localCol, screenRow, localRow };
}

let failures = 0;
let observations = 0;
function check(name, cond) { observations++; if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

function readExpectedTerrain(nes, screenCol, screenRow, localCol, localRow) {
  // sw_terrain_or_fill: A=screenCol, X=screenRow, Y=offset(=localRow*16+localCol)
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_grid_w] = 3;
  nes.cpu.mem[RAM.sw_grid_h] = 3;
  nes.cpu.REG_ACC = screenCol;
  nes.cpu.REG_X = screenRow;
  nes.cpu.REG_Y = localRow * 16 + localCol;
  callRoutine(nes, addr('sw_terrain_or_fill'));
  return nes.cpu.REG_ACC;
}

// Torus physical position (0,0) of each of the 4 nametables, in blocks:
// NT0=(0,0), NT1=(16,0), NT2=(0,15), NT3=(16,15) -- matches T8's own
// ntBase ordering (NT0/1/2/3 -> $2000/$2400/$2800/$2C00).
const NT_TORUS_ORIGIN = [[0, 0], [16, 0], [0, 15], [16, 15]];
const ntBase = [0x2000, 0x2400, 0x2800, 0x2c00];

function renderAndCheck(winColScreen, winColLocal, winRowScreen, winRowLocal, label) {
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  // Fix round 10, build 2: sw_render_window is now fill-aware too, reading
  // sw_grid_w/sw_grid_h exactly as sw_terrain_or_fill/readExpectedTerrain
  // above already do -- this fixture is the real 3x3 grid, matched here.
  nes.cpu.mem[RAM.sw_grid_w] = 3;
  nes.cpu.mem[RAM.sw_grid_h] = 3;
  nes.cpu.mem[RAM.win_col_screen] = winColScreen;
  nes.cpu.mem[RAM.win_col_local] = winColLocal;
  nes.cpu.mem[RAM.win_row_screen] = winRowScreen;
  nes.cpu.mem[RAM.win_row_local] = winRowLocal;
  // Current-field-screen state for sw_locate_current's own end-of-render
  // restore -- set to match the window's own origin screen, as T8 does.
  nes.cpu.mem[RAM.sw_col] = winColScreen;
  nes.cpu.mem[RAM.sw_row] = winRowScreen;
  nes.cpu.mem[RAM.sw_col_rem] = winColScreen;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = (338 * winColScreen) & 0xff;
  nes.cpu.mem[RAM.sw_col_byte_hi] = ((338 * winColScreen) >> 8) & 0xff;
  nes.cpu.mem[RAM.sw_row_bank_base] = winRowScreen;

  callRoutineSlow(nes, addr('sw_render_window'));

  // Check block (0,0) of each nametable (matching T8's own point) PLUS one
  // more representative interior point per nametable (block (3,3)) -- 8
  // real, independently-computed comparisons per parity/local combination.
  for (const [nt, [tc0, tr0]] of NT_TORUS_ORIGIN.entries()) {
    for (const [dc, dr] of [[0, 0], [3, 3]]) {
      const torusCol = tc0 + dc, torusRow = tr0 + dr;
      const exp = expectedScreenLocal(torusCol, torusRow, winColScreen, winColLocal, winRowScreen, winRowLocal);
      const expectedByte = readExpectedTerrain(freshNesForRead(), exp.screenCol, exp.screenRow, exp.localCol, exp.localRow);
      // vramMem tile row = torusRow*2 (each block is 2x2 tiles), col = torusCol*2 -- read the TL tile id, which for this fixture's own mt_tl table equals the metatile id itself only if mt_tl[x]=x; instead read back via the metatile id indirectly is not possible from vramMem alone, so this check reads mt_tl[id] through the SAME expected-id path used elsewhere in this suite (T1/T8): the marker IS both the metatile id and (by fixture construction) directly comparable, since mt_tl,mt_tr,mt_bl,mt_br tables in this build's own fixture are identity-mapped for ids used here (T8's own check divides by 4 for the attribute palette only; the raw tile id equality already holds for T1/T3/T8 above without a table lookup, so it holds here too).
      const ntBaseAddr = ntBase[nt];
      const withinNtRow = torusRow - tr0;
      const withinNtCol = torusCol - tc0;
      const tileAddr = ntBaseAddr + (withinNtRow * 2) * 32 + (withinNtCol * 2);
      const actualByte = nes.ppu.vramMem[tileAddr];
      check(`${label} NT${nt} block(${dc},${dr}) torus(${torusCol},${torusRow}) -> screen(${exp.screenCol},${exp.screenRow}) local(${exp.localCol},${exp.localRow}) expected=${expectedByte} actual=${actualByte}`, actualByte === expectedByte);
    }
  }
}
function freshNesForRead() {
  const nes = freshNes();
  return nes;
}

console.log('=== fix round 10, build 2: EXHAUSTIVE unaligned x all-parity render_window regression ===');
const START = Date.now();
for (const [oc, or_] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
  for (let lc = 0; lc < 16; lc++) {
    for (let lr = 0; lr < 15; lr++) {
      renderAndCheck(oc, lc, or_, lr, `origin(${oc},${or_}) local(${lc},${lr})`);
    }
  }
  console.log(`  ...parity (${oc},${or_}) done, ${observations} observations so far, ${((Date.now() - START) / 1000).toFixed(1)}s elapsed`);
}

console.log(`\n${observations} observations, ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} (${((Date.now() - START) / 1000).toFixed(1)}s)`);
process.exit(failures === 0 ? 0 : 1);
```

Real output (head and tail; the full run is 7,680 observations):
```
=== fix round 10, build 2: EXHAUSTIVE unaligned x all-parity render_window regression ===
ok   origin(0,0) local(0,0) NT0 block(0,0) torus(0,0) -> screen(0,0) local(0,0) expected=1 actual=1
ok   origin(0,0) local(0,0) NT0 block(3,3) torus(3,3) -> screen(0,0) local(3,3) expected=0 actual=0
ok   origin(0,0) local(0,0) NT1 block(0,0) torus(16,0) -> screen(1,0) local(0,0) expected=2 actual=2
ok   origin(0,0) local(0,0) NT1 block(3,3) torus(19,3) -> screen(1,0) local(3,3) expected=1 actual=1
ok   origin(0,0) local(0,0) NT2 block(0,0) torus(0,15) -> screen(0,1) local(0,0) expected=11 actual=11
ok   origin(0,0) local(0,0) NT2 block(3,3) torus(3,18) -> screen(0,1) local(3,3) expected=10 actual=10
ok   origin(0,0) local(0,0) NT3 block(0,0) torus(16,15) -> screen(1,1) local(0,0) expected=12 actual=12
ok   origin(0,0) local(0,0) NT3 block(3,3) torus(19,18) -> screen(1,1) local(3,3) expected=11 actual=11
ok   origin(0,0) local(0,1) NT0 block(0,0) torus(0,0) -> screen(0,2) local(0,0) expected=21 actual=21
ok   origin(0,0) local(0,1) NT0 block(3,3) torus(3,3) -> screen(0,0) local(3,3) expected=0 actual=0
ok   origin(0,0) local(0,1) NT1 block(0,0) torus(16,0) -> screen(1,2) local(0,0) expected=22 actual=22
...

#### `proto-tools/diag_r10_full_parity.mjs`, new this round — the full exhaustive unaligned x all-parity regression, now runnable

```javascript
// diag_r10_full_parity.mjs -- fix round 10, build 2 (review 8 finding 4):
// the full unaligned x all-parity sw_render_window regression fix round 8
// (diag_r8_unaligned_parity.mjs) explicitly could not run, because a local
// overflow could push a probe onto a THIRD screen the 3x3 fixture never
// populated, and sw_render_window had no fill guard at all -- exactly the
// gap this round's own routing work closed. Now that sw_rw_probe/
// sw_rw_attr_y_combine/sw_rw_read_metatile treat any screen past
// sw_grid_w/sw_grid_h as fill rather than reading unpopulated ROM, EVERY
// origin/local combination is well-defined (real marker inside the 3x3
// grid, sw_fill_metatile_id outside it), so the sweep below drops fix
// round 8's own restriction (origins kept at {0,1}, only 3 representative
// local offsets) and exhaustively covers all 4 origin parities x all 16
// col-local x 15 row-local offsets (240 combinations each) x all 4
// nametables x 2 representative points per nametable (block(0,0) and
// block(3,3), the same two points fix round 8 already used) --
// 4*16*15*4*2 = 7,680 independently-computed comparisons. This is not
// claimed to be numerically identical to the reviewer's own cited
// 52,224-comparison figure (its derivation was not reproduced), but it is
// a genuine, EXHAUSTIVE sweep of the entire origin-parity x local-offset
// space, not a sampled subset of it, and it is what "now runnable because
// out-of-grid reads return fill" concretely means: many of these 7,680
// comparisons resolve to fill on one or more of the 4 nametables (any
// local offset that pushes a screen past index 2), which fix round 8
// could not even attempt. The independent oracle is
// `sw_col_at_offset`/`sw_row_at_offset`'s own formula (read directly from
// streamworld.asm, transcribed here in JS, not re-derived from the render
// routine's own output) feeding `sw_terrain_or_fill`'s own
// INDEPENDENTLY PROVEN accessor (diag_r5_fill.mjs, diag_r7/r8's own reuse)
// for the expected byte -- so the render routine and the expected-value
// computation never share the same code path for the actual READ, only
// for the coordinate DECOMPOSITION (disclosed, not hidden).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { callRoutine } from '../test/lib/callroutine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROM = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.patched.nes');
const FNS = path.join(ROOT, '..', 'minimal-u512', 'build', 'main.fns');
const symbols = {};
for (const line of fs.readFileSync(FNS, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\s*=\s*\$([0-9A-Fa-f]+)/);
  if (m) symbols[m[1]] = parseInt(m[2], 16);
}
function addr(name) {
  if (!Number.isFinite(symbols[name])) throw new Error(`${name} missing from main.fns`);
  return symbols[name];
}

const RAM = {};
{
  let a = 0x59f;
  for (const n of ['sw_col', 'sw_row', 'sw_col_rem', 'sw_col_region', 'sw_col_byte_lo', 'sw_col_byte_hi', 'sw_row_bank_base', 'sw_base_bank', 'sw_regions_per_row', 'sw_grid_w', 'sw_grid_h', 'sw_tmp', 'sw_tmp2', 'sw_tmp3', 'sw_tmp4', 'sw_tmp5', 'sw_tmp6', 'win_col_screen', 'win_col_local', 'win_row_screen', 'win_row_local']) {
    a += 1; RAM[n] = a;
  }
}

function freshNes() {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM)));
  for (let i = 0; i < 5; i++) nes.frame();
  nes.mmap.write(0x2000, 0);
  return nes;
}

// callRoutine's own 20,000-step watchdog is too tight for a full render
// (T8's own note: it needs a slower cap) -- mirror verify_torus.mjs's own
// callRoutineSlow.
function callRoutineSlow(nes, address) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let cycles = 0, steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    cycles += nes.cpu.emulate();
    if (++steps >= 2_000_000) throw new Error('sw_render_window never returned to the stub');
  }
  return cycles;
}

// Independent oracle: sw_col_at_offset/sw_row_at_offset's own formula,
// transcribed directly from streamworld.asm (not re-derived from
// sw_render_window's own behaviour):
//   colTotal = delta + win_col_local; localCol = colTotal & 15;
//   screenCol = win_col_screen + (colTotal >> 4)
//   rowTotal = delta + win_row_local; localRow = rowTotal mod 15 (repeated subtract);
//   screenRow = win_row_screen + floor(rowTotal / 15)
function colAtOffset(delta, winColScreen, winColLocal) {
  const total = delta + winColLocal;
  return { screenCol: winColScreen + (total >> 4), localCol: total & 15 };
}
function rowAtOffset(delta, winRowScreen, winRowLocal) {
  let total = delta + winRowLocal;
  let screenRowAdd = 0;
  while (total >= 15) { total -= 15; screenRowAdd += 1; }
  return { screenRow: winRowScreen + screenRowAdd, localRow: total };
}
// wbase: the window's own ring-relative origin (sw_rw_wbase_col/row).
function wbaseCol(winColScreen, winColLocal) { return (winColScreen & 1) * 16 + winColLocal; }
function wbaseRow(winRowScreen, winRowLocal) { return (winRowScreen & 1) * 15 + winRowLocal; }
// physical torus position (0-31 col / 0-29 row) -> window-relative delta,
// via sw_rw_col_delta/sw_rw_row_delta's own wrap.
function colDelta(torusCol, winColScreen, winColLocal) {
  return (((torusCol - wbaseCol(winColScreen, winColLocal)) % 32) + 32) % 32;
}
function rowDelta(torusRow, winRowScreen, winRowLocal) {
  let d = (((torusRow - wbaseRow(winRowScreen, winRowLocal)) % 30) + 30) % 30;
  return d;
}
function expectedScreenLocal(torusCol, torusRow, winColScreen, winColLocal, winRowScreen, winRowLocal) {
  const cd = colDelta(torusCol, winColScreen, winColLocal);
  const rd = rowDelta(torusRow, winRowScreen, winRowLocal);
  const { screenCol, localCol } = colAtOffset(cd, winColScreen, winColLocal);
  const { screenRow, localRow } = rowAtOffset(rd, winRowScreen, winRowLocal);
  return { screenCol, localCol, screenRow, localRow };
}

let failures = 0;
let observations = 0;
function check(name, cond) { observations++; if (!cond) { failures++; console.log('FAIL', name); } else { console.log('ok  ', name); } }

function readExpectedTerrain(nes, screenCol, screenRow, localCol, localRow) {
  // sw_terrain_or_fill: A=screenCol, X=screenRow, Y=offset(=localRow*16+localCol)
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  nes.cpu.mem[RAM.sw_grid_w] = 3;
  nes.cpu.mem[RAM.sw_grid_h] = 3;
  nes.cpu.REG_ACC = screenCol;
  nes.cpu.REG_X = screenRow;
  nes.cpu.REG_Y = localRow * 16 + localCol;
  callRoutine(nes, addr('sw_terrain_or_fill'));
  return nes.cpu.REG_ACC;
}

// Torus physical position (0,0) of each of the 4 nametables, in blocks:
// NT0=(0,0), NT1=(16,0), NT2=(0,15), NT3=(16,15) -- matches T8's own
// ntBase ordering (NT0/1/2/3 -> $2000/$2400/$2800/$2C00).
const NT_TORUS_ORIGIN = [[0, 0], [16, 0], [0, 15], [16, 15]];
const ntBase = [0x2000, 0x2400, 0x2800, 0x2c00];

function renderAndCheck(winColScreen, winColLocal, winRowScreen, winRowLocal, label) {
  const nes = freshNes();
  nes.cpu.mem[RAM.sw_base_bank] = 2;
  nes.cpu.mem[RAM.sw_regions_per_row] = 1;
  // Fix round 10, build 2: sw_render_window is now fill-aware too, reading
  // sw_grid_w/sw_grid_h exactly as sw_terrain_or_fill/readExpectedTerrain
  // above already do -- this fixture is the real 3x3 grid, matched here.
  nes.cpu.mem[RAM.sw_grid_w] = 3;
  nes.cpu.mem[RAM.sw_grid_h] = 3;
  nes.cpu.mem[RAM.win_col_screen] = winColScreen;
  nes.cpu.mem[RAM.win_col_local] = winColLocal;
  nes.cpu.mem[RAM.win_row_screen] = winRowScreen;
  nes.cpu.mem[RAM.win_row_local] = winRowLocal;
  // Current-field-screen state for sw_locate_current's own end-of-render
  // restore -- set to match the window's own origin screen, as T8 does.
  nes.cpu.mem[RAM.sw_col] = winColScreen;
  nes.cpu.mem[RAM.sw_row] = winRowScreen;
  nes.cpu.mem[RAM.sw_col_rem] = winColScreen;
  nes.cpu.mem[RAM.sw_col_region] = 0;
  nes.cpu.mem[RAM.sw_col_byte_lo] = (338 * winColScreen) & 0xff;
  nes.cpu.mem[RAM.sw_col_byte_hi] = ((338 * winColScreen) >> 8) & 0xff;
  nes.cpu.mem[RAM.sw_row_bank_base] = winRowScreen;

  callRoutineSlow(nes, addr('sw_render_window'));

  // Check block (0,0) of each nametable (matching T8's own point) PLUS one
  // more representative interior point per nametable (block (3,3)) -- 8
  // real, independently-computed comparisons per parity/local combination.
  for (const [nt, [tc0, tr0]] of NT_TORUS_ORIGIN.entries()) {
    for (const [dc, dr] of [[0, 0], [3, 3]]) {
      const torusCol = tc0 + dc, torusRow = tr0 + dr;
      const exp = expectedScreenLocal(torusCol, torusRow, winColScreen, winColLocal, winRowScreen, winRowLocal);
      const expectedByte = readExpectedTerrain(freshNesForRead(), exp.screenCol, exp.screenRow, exp.localCol, exp.localRow);
      // vramMem tile row = torusRow*2 (each block is 2x2 tiles), col = torusCol*2 -- read the TL tile id, which for this fixture's own mt_tl table equals the metatile id itself only if mt_tl[x]=x; instead read back via the metatile id indirectly is not possible from vramMem alone, so this check reads mt_tl[id] through the SAME expected-id path used elsewhere in this suite (T1/T8): the marker IS both the metatile id and (by fixture construction) directly comparable, since mt_tl,mt_tr,mt_bl,mt_br tables in this build's own fixture are identity-mapped for ids used here (T8's own check divides by 4 for the attribute palette only; the raw tile id equality already holds for T1/T3/T8 above without a table lookup, so it holds here too).
      const ntBaseAddr = ntBase[nt];
      const withinNtRow = torusRow - tr0;
      const withinNtCol = torusCol - tc0;
      const tileAddr = ntBaseAddr + (withinNtRow * 2) * 32 + (withinNtCol * 2);
      const actualByte = nes.ppu.vramMem[tileAddr];
      check(`${label} NT${nt} block(${dc},${dr}) torus(${torusCol},${torusRow}) -> screen(${exp.screenCol},${exp.screenRow}) local(${exp.localCol},${exp.localRow}) expected=${expectedByte} actual=${actualByte}`, actualByte === expectedByte);
    }
  }
}
function freshNesForRead() {
  const nes = freshNes();
  return nes;
}

console.log('=== fix round 10, build 2: EXHAUSTIVE unaligned x all-parity render_window regression ===');
const START = Date.now();
for (const [oc, or_] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
  for (let lc = 0; lc < 16; lc++) {
    for (let lr = 0; lr < 15; lr++) {
      renderAndCheck(oc, lc, or_, lr, `origin(${oc},${or_}) local(${lc},${lr})`);
    }
  }
  console.log(`  ...parity (${oc},${or_}) done, ${observations} observations so far, ${((Date.now() - START) / 1000).toFixed(1)}s elapsed`);
}

console.log(`\n${observations} observations, ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} (${((Date.now() - START) / 1000).toFixed(1)}s)`);
process.exit(failures === 0 ? 0 : 1);
```

Real output (head and tail; the full run is 7,680 observations, 101.5s):
```
=== fix round 10, build 2: EXHAUSTIVE unaligned x all-parity render_window regression ===
ok   origin(0,0) local(0,0) NT0 block(0,0) torus(0,0) -> screen(0,0) local(0,0) expected=1 actual=1
ok   origin(0,0) local(0,0) NT0 block(3,3) torus(3,3) -> screen(0,0) local(3,3) expected=0 actual=0
ok   origin(0,0) local(0,0) NT1 block(0,0) torus(16,0) -> screen(1,0) local(0,0) expected=2 actual=2
ok   origin(0,0) local(0,0) NT1 block(3,3) torus(19,3) -> screen(1,0) local(3,3) expected=1 actual=1
ok   origin(0,0) local(0,0) NT2 block(0,0) torus(0,15) -> screen(0,1) local(0,0) expected=11 actual=11
ok   origin(0,0) local(0,0) NT2 block(3,3) torus(3,18) -> screen(0,1) local(3,3) expected=10 actual=10
ok   origin(0,0) local(0,0) NT3 block(0,0) torus(16,15) -> screen(1,1) local(0,0) expected=12 actual=12
ok   origin(0,0) local(0,0) NT3 block(3,3) torus(19,18) -> screen(1,1) local(3,3) expected=11 actual=11
ok   origin(0,0) local(0,1) NT0 block(0,0) torus(0,0) -> screen(0,2) local(0,0) expected=21 actual=21
ok   origin(0,0) local(0,1) NT0 block(3,3) torus(3,3) -> screen(0,0) local(3,3) expected=0 actual=0
ok   origin(0,0) local(0,1) NT1 block(0,0) torus(16,0) -> screen(1,2) local(0,0) expected=22 actual=22
...
ok   origin(1,1) local(15,14) NT1 block(3,3) torus(19,3) -> screen(3,2) local(3,3) expected=0 actual=0
ok   origin(1,1) local(15,14) NT2 block(0,0) torus(0,15) -> screen(2,3) local(0,0) expected=0 actual=0
ok   origin(1,1) local(15,14) NT2 block(3,3) torus(3,18) -> screen(2,3) local(3,3) expected=0 actual=0
ok   origin(1,1) local(15,14) NT3 block(0,0) torus(16,15) -> screen(3,3) local(0,0) expected=0 actual=0
ok   origin(1,1) local(15,14) NT3 block(3,3) torus(19,18) -> screen(3,3) local(3,3) expected=0 actual=0
  ...parity (1,1) done, 7680 observations so far, 101.5s elapsed

7680 observations, ALL PASS (101.5s)
```

#### Finding 7's own fix to `build_f9_worst_chunk_fixture.mjs` (the corrected MMC3 detection and the new SHAKE_ENABLED assertion; everything else in the file is fix round 9's own unchanged version)

```javascript
const SHAKE_LEFT = ram('shake_left');
const CAM_DIRTY = ram('cam_dirty');
const BOX_STATE = ram('box_state');
// Fix round 10, review 8 finding 7: SPLIT_ENABLED is a GENERATED flag in
// assets/config.inc, not something constants.asm ever defines or restates
// as text -- the prior version's own /SPLIT_ENABLED\s*=\s*1/ test against
// constantsText could never match on EITHER board, so the MMC3 fixture
// silently never forced split_mode/box_state and never exercised
// split_arm_go's own longer path at all. Read the real generated flag.
const configText = fs.readFileSync(path.join(buildDir, 'assets', 'config.inc'), 'utf8');
const isMmc3 = /^SPLIT_ENABLED\s*=\s*1$/m.test(configText);
const SPLIT_MODE = isMmc3 ? ram('split_mode') : null;
// Fix round 10, review 8 finding 7: assert the feature this fixture claims
// to time is actually compiled in, rather than trusting the board's own
// name/history -- a stale config.inc would otherwise silently time the
// SHORTER, unshaken path while the report claimed the opposite.
if (!/^SHAKE_ENABLED\s*=\s*1$/m.test(configText)) {
```

Real Mesen output, relocated placement, Shake genuinely compiled and exercised, split detection fixed:
```
[    1] ok   NMI_RTI anchor verified: 0xc444 is $40 (rti)
[  400] ok   armed worst-chunk: row strip, odd parity, vary=29, len=32 (non-final), shake active, cam_dirty clear
[  401] nmi_rti reached: scanline=259 cycle=38 vram_len=0 st_cur=3
[  401] ok   worst-chunk NMI finished at scanline 259, cycle 38 (rti settles on scanline 259) -- inside vblank, margin ~208.7 cycles (626 dots) to end of vblank

[    1] ok   NMI_RTI anchor verified: 0xc448 is $40 (rti)
[  400] ok   armed worst-chunk: row strip, odd parity, vary=29, len=32 (non-final), shake active, cam_dirty clear, split forced to SPL_BOX
[  401] nmi_rti reached: scanline=259 cycle=235 vram_len=0 st_cur=3
[  401] ok   worst-chunk NMI finished at scanline 259, cycle 235 (rti settles on scanline 259) -- inside vblank, margin ~143.0 cycles (429 dots) to end of vblank

(chunk 4, both boards, real negative control)
[  400] ok   armed worst-chunk: row strip, odd parity, vary=29, len=32 (non-final), shake active, cam_dirty clear
[  401] nmi_rti reached: scanline=0 cycle=317 vram_len=0 st_cur=4
[  401] FAIL: nmi_rti landed on scanline 0, outside vblank (241-260)
[  400] ok   armed worst-chunk: row strip, odd parity, vary=29, len=32 (non-final), shake active, cam_dirty clear, split forced to SPL_BOX
[  401] nmi_rti reached: scanline=1 cycle=176 vram_len=0 st_cur=4
[  401] FAIL: nmi_rti landed on scanline 1, outside vblank (241-260)
```

### Round 11 (fix round 11): the Flash service, the shared scheduler, and Part C's corrections

Every script below is new this round, lives in the scratch tree's `proto-tools/`. The Mesen fixture
(`build_f11_mixed_vblank_fixture.mjs`) runs against `sample-u512`/`sample-mmc3`; the pure-JS models
(`diag_f11_*.mjs`) need no build at all. `diag_f9_flash_priority.mjs` (fix round 9, already embedded
above) is retired, not re-embedded, per Part A's own retraction — its own two-edges-total bug is
history, quoted in Decision 1's own Round 11 text above, not repeated here.

#### `proto-tools/build_f11_mixed_vblank_fixture.mjs` — the mixed-vblank NMI splice, real Mesen timing on both boards

```javascript
#!/usr/bin/env node
// Fix round 11, Part A: the "mixed vblank" candidate. Review 8 finding 1
// retracted the round-9 "defer a published Flash edge" policy outright (it
// breaks flash_tick_confirm's own "every published queue drains on the very
// next NMI" handshake, engine/entities.asm:1067-1085). This is the
// replacement: when the published vram_buf queue is SMALL (<= one 32-byte
// packet, MIXED_VBLANK_MAX_BYTES=35 bytes total including its 3-byte
// header), the NMI drains it in full AND still lets a REDUCED strip chunk
// advance the SAME vblank -- nothing is ever deferred, nothing is ever
// skipped for more than the one vblank a chunk always costs today. A large
// queue (a full text row, only ever queued while the world is frozen, so it
// never actually competes with a live strip) keeps the exclusive-drain
// policy fix round 7 already proved.
//
// The NMI splice branches ONCE, immediately, on vram_len BEFORE calling
// vram_drain at all -- two independent code paths (small: drain + reduced
// chunk; big: drain alone, byte-identical to fix round 7's own shape), no
// RAM byte needed to remember the decision across the vram_drain call. The
// only duplicated code is the 6-byte PALETTE_FX_ENABLED v-pointer fix
// (engine/boot.asm's own nmi_fade_ppuaddr block), not vram_drain itself
// (a jsr to a single shared subroutine either way) and not the 22-line
// comment above it.
//
//   node proto-tools/build_f11_mixed_vblank_fixture.mjs <boardDir> [outDir] [reducedChunk=2] [queueBytes=35]

// [Config-patch step: FLASH_ENABLED/PALETTE_FX_ENABLED hand-flipped to 1,
// the same move fix round 10 used for SHAKE_ENABLED, restored in a finally
// block after assembly, identical shape to build_f9_worst_chunk_fixture.mjs.]

// streamworld.asm patch: SW_STREAM_MIXED_CHUNK = <reducedChunk> defined
// beside SW_STREAM_CHUNK=3, and a new routine added right after the
// existing sw_ns_finish (verbatim, unmodified):
//
//   sw_nmi_stream_reduced:
//     lda st_active
//     bne sw_nsr_go
//     rts
//   sw_nsr_go:
//     lda #SW_STREAM_MIXED_CHUNK
//     sta <sw_ns_chunk
//     jmp sw_ns_loop
//
// -- shares sw_ns_loop/sw_ns_draw_block/sw_ns_finish verbatim with the
// unmodified sw_nmi_stream; only the armed chunk count differs.

// boot.asm patch: two independent, verified exact-text insertions (no
// giant block reconstructed by hand). The NMI splice's opening becomes:
//
//   lda <vram_ready
//   beq nmi_no_drain
//   MIXED_VBLANK_MAX_BYTES = 35
//   lda <vram_len
//   cmp #MIXED_VBLANK_MAX_BYTES+1
//   bcs nmi_drain_big
//   jsr vram_drain
//   ; ... [unchanged 22-line Fade comment + .if PALETTE_FX_ENABLED block] ...
//   jsr sw_nmi_stream_reduced   ; the small-queue path -- reduced chunk, same vblank
//   jmp nmi_scroll
//
//   nmi_drain_big:              ; a queue too big for a mixed vblank -- exclusive drain, unchanged
//   jsr vram_drain
//   .if PALETTE_FX_ENABLED
//   lda #$00
//   sta $2006
//   sta $2006
//   .endif
//   jmp nmi_scroll
//
//   nmi_no_drain:
//   jsr sw_nmi_stream           ; unchanged -- full chunk, no drain this vblank
//   nmi_scroll:
//
// One branch, taken BEFORE vram_drain runs -- no RAM byte needed to
// remember which path was taken across the call. Only the 6-byte
// PALETTE_FX_ENABLED block is duplicated (a real, disclosed, small kernel-lo
// cost a shipping version could fold back into one copy with a saved flag;
// not attempted here, a design-round prototype favouring correctness-by-
// construction over byte-shaving).

// [Assembles for real via nesasm, header-patches via applyHeaderPatch,
// asserts header byte 6 actually changed, generates a Lua fixture that
// arms the worst non-final strip chunk (row, odd parity, st_vary=29,
// len=32) AND queues a real 35-byte palette-shaped packet with
// vram_ready=1, then checks vram_len=0/vram_ready=0 (fully drained) AND
// st_cur equals the reduced chunk count (the strip also advanced), in the
// SAME vblank, before checking the NMI finished inside vblank at all.]
```

```
$ node proto-tools/build_f11_mixed_vblank_fixture.mjs sample-u512 fix11-out/mixed-u512-r2 2 35
$ Mesen --testRunner fix11-out/mixed-u512-r2/sw_nmi_mixed.lua fix11-out/mixed-u512-r2/sw_nmi_mixed.nes
[    1] ok   NMI_RTI anchor verified: 0xc466 is $40 (rti)
[  400] ok   armed MIXED vblank: 35-byte queue ready + worst-chunk row strip (vary=29, len=32), reduced chunk=2, shake active
[  401] nmi_rti reached: scanline=259 cycle=335 vram_len=0 vram_ready=0 st_cur=2
[  401] ok   mixed-vblank NMI finished at scanline 259, cycle 335 (rti settles on scanline 260) -- QUEUE DRAINED AND st_cur=2 -- margin ~109.7 cycles (329 dots) to end of vblank
exit 0

$ node proto-tools/build_f11_mixed_vblank_fixture.mjs sample-mmc3 fix11-out/mixed-mmc3-r2 2 35
$ Mesen --testRunner fix11-out/mixed-mmc3-r2/sw_nmi_mixed.lua fix11-out/mixed-mmc3-r2/sw_nmi_mixed.nes
[    1] ok   NMI_RTI anchor verified: 0xc46a is $40 (rti)
[  400] ok   armed MIXED vblank: 35-byte queue ready + worst-chunk row strip (vary=29, len=32), reduced chunk=2, shake active, split forced to SPL_BOX
[  401] nmi_rti reached: scanline=260 cycle=182 vram_len=0 vram_ready=0 st_cur=2
[  401] ok   mixed-vblank NMI finished at scanline 260, cycle 182 (rti settles on scanline 260) -- QUEUE DRAINED AND st_cur=2 -- margin ~47.0 cycles (141 dots) to end of vblank
exit 0

(reducedChunk=1, both boards: margin ~554.7 / ~492.0 cycles, exit 0 -- more margin than needed)

$ node proto-tools/build_f11_mixed_vblank_fixture.mjs sample-u512 fix11-out/mixed-u512-r3 3 35
$ Mesen --testRunner fix11-out/mixed-u512-r3/sw_nmi_mixed.lua fix11-out/mixed-u512-r3/sw_nmi_mixed.nes
[  401] FAIL: nmi_rti landed on scanline 2, outside vblank (241-260)
exit 5   -- the one-more-block negative control: unreduced chunk (3) combined with the drain misses badly

$ node proto-tools/build_f11_mixed_vblank_fixture.mjs sample-mmc3 fix11-out/mixed-mmc3-r3 3 35
[  401] FAIL: nmi_rti landed on scanline 2, outside vblank (241-260)
exit 5   -- same, MMC3

$ node proto-tools/build_f11_mixed_vblank_fixture.mjs sample-u512 fix11-out/mixed-u512-r2-q36 2 36
[  401] FAIL: st_cur is 0, not 2 -- the reduced chunk did not actually run alongside the drain
exit 7   -- the byte-count BOUNDARY control: 36 bytes (one over MIXED_VBLANK_MAX_BYTES) correctly
          -- routes to the exclusive-drain path instead -- st_cur stays 0, proving the branch itself
```

#### `proto-tools/diag_f11_flash_recurrence.mjs` — Flash's real state machine, faithfully ported, sweeping recurrence

```javascript
// Fix round 11, Part A: does the mixed-vblank service (a Flash edge costs
// the strip exactly ONE block that vblank, chunk 3 -> 2, never a deferred
// packet and never a fully-skipped vblank) keep the strip's own lag bounded
// under the fastest legal recurrence the engine's own event rules permit,
// including re-arming an already-active Flash? A faithful port of
// flash_tick's real state machine (engine/entities.asm:1125-1153) --
// FLASH_ARM_VALUE=7, FLASH_TOTAL_FRAMES=6, FLASH_PENDING confirm tick all
// reproduced -- not a boolean "queued/not queued" stand-in.
//
//   node proto-tools/diag_f11_flash_recurrence.mjs
[full script archived in the scratch tree's own proto-tools/ -- reproduces
flash_tick's real 8-tick lifecycle (arm -> on-edge -> 6 hold ticks ->
restore-edge -> confirm) against a single-axis crossing queue, at the
PRE-round-11 walking speeds, sweeping recurrence period]
```

```
$ node proto-tools/diag_f11_flash_recurrence.mjs
=== sanity: no-flash baseline must reproduce the already-proven <=1 block bound (both axes) ===
  x no-flash baseline: {"lagMax":1,...}
  y no-flash baseline: {"lagMax":1,...}
=== pathological: Flash re-armed every 6 frames (back-to-back), 3,000,000 frames, Y axis ===
   {"lagMax":19533,"mixedVblanks":499998,"fullVblanks":2499991,...}
=== sweep: find where (if anywhere) the Y axis lag actually diverges under the mixed-vblank policy ===
  period=   1: lagMax=54688
  period=   6: lagMax=13022
  period=  11: lagMax=13022   -- the touch-actor-per-tile worst LEGAL case: STILL DIVERGES at the old speed
  period=  16: lagMax=4689
  period=  32: lagMax=2
  period=  40: lagMax=1
=== contrast: the OLD (retracted) exclusive-only policy, period=6, Y axis ===
  OLD policy, Y axis, period=6, 600000 frames: lagMax=8453 (diverges without bound)
```

#### `proto-tools/diag_f11_flash_speed_search.mjs` and `diag_f11_slack_derivation.mjs` — finding the real per-axis slack

```
$ node proto-tools/diag_f11_flash_speed_search.mjs
=== Y axis: search SW_SPEED_SUB_Y for the touch-actor-per-tile worst case ===
  SW_SPEED_SUB_Y=112: lagMax=17579
  SW_SPEED_SUB_Y=104: lagMax=11720 (10,000,000-frame re-check: lagMax=39064 -- confirms genuine divergence, not slow settling)
  SW_SPEED_SUB_Y=101: lagMax=23194 (10M frames)
  SW_SPEED_SUB_Y=100: lagMax=1     (10M frames -- the real boundary)
  SW_SPEED_SUB_Y=96:  lagMax=1
=== X axis: search SW_SPEED_SUB_X for the SAME worst case ===
  SW_SPEED_SUB_X=128: lagMax=8524  (10M frames: 8879)
  SW_SPEED_SUB_X=118: lagMax=3996  (10M frames)
  SW_SPEED_SUB_X=116: lagMax=1     (10M frames -- the real boundary)
  SW_SPEED_SUB_X=112: lagMax=1
```

Chosen with real margin below each boundary (112 for X, 96 for Y — not the knife's-edge 116/100), and
cross-checked analytically (`diag_f11_slack_derivation.mjs`: `vblanksNeeded(32, 2)=12`,
`vblanksNeeded(30, 2)=11` — the strip needs one more vblank once it must also absorb 2 blocks lost to
a same-cycle Flash burst; the analytic single-crossing-margin heuristic under-predicts the safe
boundary the full discrete-event simulation finds, which is why the simulation, not the heuristic, is
what this round trusts — the identical "searched directly, not merely argued" discipline proof 2's
own adversarial sweep already established).

#### `proto-tools/diag_f11_flash_final_check.mjs` — the chosen combination, final confirmation

```
$ node proto-tools/diag_f11_flash_final_check.mjs
Chosen: SW_SPEED_SUB_X=112 (1.4375 px/frame), SW_SPEED_SUB_Y=96 (1.3750 px/frame)
=== 1. no-flash baseline, 5,000,000 frames, both axes -- must stay <=1 ===
  x: lagMax=1
  y: lagMax=1
=== 2. worst LEGAL recurrence (Flash re-armed on every crossing), 10,000,000 frames ===
  x: lagMax=1 (~46.3 hours of continuous every-crossing Flash re-arming)
  y: lagMax=1 (~46.3 hours of continuous every-crossing Flash re-arming)
=== 3. sweep arbitrary periods, both axes, 3,000,000 frames each ===
  x: worst sampled fixed period = {"lag":69532,"period":1}   -- period=1 excluded, see Decision 1 text
  y: worst sampled fixed period = {"lag":70313,"period":1}
```

#### `proto-tools/diag_f11_scheduler.mjs` — Part B, the shared scheduler, five exercises plus a forced handoff check plus a negative control

```
$ node proto-tools/diag_f11_scheduler.mjs
=== Exercise 1: held single axis (X then Y) ===
  X hold: {"crossingsX":179687,"colArms":179687,"sameVblankRestarts":0,...} lagMax= 0
  Y hold: {"crossingsY":171875,"rowArms":171875,"sameVblankRestarts":62500,...} lagMax= 0
=== Exercise 2: turn onto the other axis every block ===
  worst fixed turn cycle: {"lag":1,"nX":1,"nY":1}
=== Exercise 3: reversal mid-strip (oscillate direction every K crossings) ===
  K=1 crossings between reversals: lagMax=0, reversalsX=89843, colArms=89843
  K=2: lagMax=0, reversalsX=44921   K=3: lagMax=0, reversalsX=29947   K=5: lagMax=0, reversalsX=17968
=== Exercise 4: walking into a map clamp edge ===
  clamp at 40 blocks: {"colArms":40,"clampedFramesX":179647,...} lagMax= 0
=== Exercise 5: the corrected Flash service at its proven worst LEGAL recurrence ===
  Y hold, Flash every crossing: {"rowArms":257812,"sameVblankRestarts":257810,"mixedVblanks":515621,...} lagMax= 1
  X hold, Flash every crossing: {"colArms":269531,"mixedVblanks":503904,...} lagMax= 0
  Flash armed every crossing + turning every 3 (bonus stress): {"mixedVblanks":429685,...} lagMax= 1
=== Exercise 6: capped knockback, repeated every IFRAME_TIME=60, new slack values ===
  x axis: lagMax=0   y axis: lagMax=0
=== NEGATIVE CONTROL (must fail): Y axis at the OLD SW_SPEED_SUB_Y=128, no Flash ===
  OLD Y speed (128): lagMax=1421, resync guard first reached at frame=2495
=== Exercise 6a: the final-chunk same-vblank handoff, forced deterministically ===
  completions=2, sameVblankRestarts=1
ALL PASS
```

#### `proto-tools/diag_f11_row60_peek.mjs` — Part C (finding 8): `sw_peek_byte`'s real cost, not `sw_goto`'s

```
$ node proto-tools/diag_f11_row60_peek.mjs
sw_peek_byte(col=0, row=60) real cost: 1412 cycles
sw_goto(col=0, row=60) alone: 1288 cycles (design doc's own already-cited figure)
sw_peek_byte overhead beyond sw_goto (byte read + sw_locate_current restore): 124 cycles

four-probe corner check at this real worst case: 4 * 1412 = 5648 cycles
as a fraction of the 29,780-cycle NTSC frame budget: 19.0%
```

#### `proto-tools/diag_f11_knockback_archive.mjs` — Part C: the knockback table, archived, reproduced exactly

```javascript
// Fix round 11, Part C: review 8 independently reconstructed this table
// ("a simple 600,000-frame Y queue: eight displacement frames per sixty-
// frame hit period, then ordinary accumulator walking, eleven service
// vblanks per row") but no reproducible script existed in proto-tools.
// Archived here, against the PRE-round-11 walking speed (SW_SPEED_SUB_Y=112,
// the value these historical D=24/20/16/12/8 figures were measured against)
// -- Part B's own Exercise 6 separately re-confirms the CHOSEN cap (D=8)
// stays bounded at fix round 11's own new slack values too (lagMax=0 there).
const ROW_VBLANKS = 11, SUB_Y = 112, IFRAME_TIME = 60, KNOCKBACK_TIME = 8;
function simulate(D, frames) {
  let acc = 0, pxSince = 0, demanded = 0, completed = 0, pending = 0, blocksRemaining = 0, lagMax = 0;
  const perFrame = D / KNOCKBACK_TIME;
  let knockLeft = 0, nextHit = IFRAME_TIME;
  for (let f = 0; f < frames; f++) {
    if (f === nextHit) { knockLeft = KNOCKBACK_TIME; nextHit = f + IFRAME_TIME; }
    if (knockLeft > 0) { pxSince += perFrame; knockLeft--; }
    else {
      let px = 1; const next = acc + SUB_Y;
      if (next >= 256) { px += 1; acc = next - 256; } else acc = next;
      pxSince += px;
    }
    if (pxSince >= 16) { pxSince -= 16; pending++; demanded++; }
    if (blocksRemaining > 0) { blocksRemaining -= 3; if (blocksRemaining <= 0) { completed++; blocksRemaining = 0; } }
    if (blocksRemaining === 0 && pending > 0) { pending--; blocksRemaining = 32; }
    const lag = demanded - completed;
    if (lag > lagMax) lagMax = lag;
  }
  return lagMax;
}
for (const D of [24, 20, 16, 12, 8]) console.log(`D=${D}: lagMax=${simulate(D, 600000)}`);
```

```
$ node proto-tools/diag_f11_knockback_archive.mjs
D (px/burst) -> lagMax over 600,000 frames, repeated every IFRAME_TIME=60 legal re-hit:
  D=24: lagMax=7174
  D=20: lagMax=4674
  D=16: lagMax=2175
  D=12: lagMax=2
  D=8: lagMax=1
```

Exact match to review 8's own independently-reconstructed figures (7,174 / 4,674 / 2,175 / 2 / 1) —
the "two separate ifs" service/arm convention (a strip that just completed hands off to a freshly
armed one in the SAME iteration, but that fresh strip's own service does not also run that same
iteration) is what real hardware does (mainline arms during the visible frame; the NMI that services
it is the *next* one), and is the convention every fix round 11 script above already used.

### Round 11b (fix round 11b): the real-engine measurement, the corrected model, both new scripts in full

#### `proto-tools/measure_f11b_flash_touch_row.mjs` — the real engine, not a model

```javascript
// Fix round 11b: measure the REAL engine, not a model. A throwaway project
// (mkdtemp copy of `sample/`, never touching the checked-in fixture) with a
// row of 8 touch-trigger actors, one metatile (16px) apart, each carrying a
// single-command [Flash] event and nothing else. Boots under jsnes, holds
// Right, and logs per real frame: player x/y, game_state, flash_left,
// vram_len (sampled via a wrapped ppu.writeMem hook so a real $3F00-$3F1F
// write is caught at the instant it happens, not after that same frame's
// NMI has already drained vram_len back to 0).
//
//   node proto-tools/measure_f11b_flash_touch_row.mjs [spacingPx=16] [actorCount=8]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../main/project-io.js';
import { buildProject } from '../main/build/pipeline.js';
import { finishNamingIfOpen } from '../test/lib/naming.js';
import { BUTTON } from '../renderer/emulator/runcontrol.js';
import { scanEquates, resolveEquates } from '../test/lib/equates.js';

// [Builds an mkdtemp copy of sample/, pushes ACTOR_COUNT `behavior: 'npc'`
// actors onto project.sprites.actors, places them at x = 24 + i*SPACING,
// y=96 on screen 0 with `props: { trigger: 'touch', event: { pages: [{
// cond: {type:'none',arg:0}, commands: [{op:'flash'}] }] } }`, wipes the
// screen's metatiles to 0 (open, walkable), builds for real via
// buildProject, resolves player_x/player_y/game_state/flash_left/vram_len
// out of the BUILT project's own build/constants.asm via scanEquates/
// resolveEquates (flash_left is a computed equate, fade_reload+1, so the
// simple parseEquates regex cannot resolve it -- the streaming prototype's
// own established technique), boots past the naming grid via
// finishNamingIfOpen, forces the player to a known x=8 start, then holds
// Right for 400 frames logging player_x/y, game_state, flash_left, vram_len
// every frame plus every real $3F00-$3F1F write's own frame number via a
// wrapped ppu.writeMem hook (countPaletteWrites' own technique,
// test/unit/flash.test.js) -- so a packet's real publication frame is
// caught at the instant it happens, never after that frame's own NMI has
// already drained vram_len back to 0.]
```

```
$ node proto-tools/measure_f11b_flash_touch_row.mjs 16 8
Resolved addresses: { PLAYER_X: '$10', PLAYER_Y: '$11', GAME_STATE: '$25', FLASH_LEFT: '$a0', VRAM_LEN: '$3c' }

=== Full per-frame dump, first 35 frames ===
  f2:  x=14 gs=0 fl=0   vl=0
  f3:  x=14 gs=0 fl=7   vl=0     <- FROZEN (x unchanged from f2); touch detected+armed this frame
  f4:  x=16 gs=0 fl=6   vl=35    <- movement resumed; ON edge published
  f5:  x=18 gs=0 fl=5   vl=0
  f6:  x=20 gs=0 fl=4   vl=0
  f7:  x=22 gs=0 fl=3   vl=0
  f8:  x=24 gs=0 fl=2   vl=0
  f9:  x=26 gs=0 fl=1   vl=0
  f10: x=28 gs=0 fl=255 vl=35    <- RESTORE edge published (FLASH_TOTAL_FRAMES=6 after the on-edge)
  f11: x=30 gs=0 fl=0   vl=0     <- confirm, genuinely idle
  f12: x=30 gs=0 fl=7   vl=0     <- FROZEN again; the NEXT actor's touch

total frozen frames (x unchanged from prior logged frame): 170 / 400 (one per each of ~19 touches
crossed in 400 held frames at ordinary 2px/frame speed -- NOT the streamed accumulator rate, this is
the shipped, non-streaming engine; only the FREEZE-PER-EVENT fact transfers to the streaming model)

game_state sampled 0 at every single logged frame -- the freeze happens and resolves entirely WITHIN
one frame's own dispatch (start_dialog raises it, the Flash-only page finishes with no Say, box_close
short-circuits to close_ui), so a once-per-frame sample never catches game_state non-zero at all.

$ node proto-tools/measure_f11b_flash_touch_row.mjs 4 8   # forced overlap (unrealistic spacing)
  f3: x=14  fl 0->7   (arm 1)
  f4: x=16  fl 7->6   vl=35   (on-edge 1)
  f5: x=18  fl 6->5
  f6: x=18  fl 5->7   (RE-ARM WHILE COUNTING -- no restore edge for burst 1 ever queued)
  f7: x=20  fl 7->6   vl=35   (on-edge 2, redundant color push)
  f8: x=22  fl 6->5
  f9: x=22  fl 5->7   (re-arm again)
  ... (repeats until the actor row runs out, THEN flash_left finally completes its full 5->4->3->2->1->255 countdown)
```

#### `proto-tools/diag_f11b_legal_worst_case.mjs` — the corrected model, at the restored FALLEN STAR speeds

```javascript
// Fix round 11b: the CORRECTED scheduler model -- the real 1-frame freeze
// (measured above) and the real MAX_ENTITIES=8-per-screen cap, at the
// RESTORED FALLEN STAR speeds (SW_SPEED_SUB_X=128, SW_SPEED_SUB_Y=112).
const CHUNK = 3, MIXED_CHUNK = 2;
const FLASH_ARM_VALUE = 7, FLASH_PENDING = -1;
function makeFlashTicker() {
  let flashLeft = 0;
  return (armNow) => {
    if (armNow) flashLeft = FLASH_ARM_VALUE;
    if (flashLeft === 0) return false;
    let edge = false;
    if (flashLeft === FLASH_PENDING) { flashLeft = 0; return false; }
    if (flashLeft === FLASH_ARM_VALUE) edge = true;
    flashLeft -= 1;
    if (flashLeft === 0) { flashLeft = FLASH_PENDING; edge = true; }
    return edge;
  };
}
function simulate({ sub, stripLen, rowsPerScreen, perScreen, frames, placement, unbounded = false }) {
  const tick = makeFlashTicker();
  let acc = 0, pxSince = 0, demanded = 0, completed = 0, pending = 0, blocksRemaining = 0, lagMax = 0;
  let crossingIndexInScreen = 0, frozenThisFrame = false, armPending = false;
  const spreadStep = perScreen > 0 ? Math.max(1, Math.round(rowsPerScreen / perScreen)) : Infinity;
  for (let f = 0; f < frames; f++) {
    let crossedThisFrame = false;
    if (frozenThisFrame) { frozenThisFrame = false; }
    else {
      let px = 1; const next = acc + sub;
      if (next >= 256) { px += 1; acc = next - 256; } else acc = next;
      pxSince += px;
      if (pxSince >= 16) {
        pxSince -= 16; demanded++; pending++; crossedThisFrame = true;
        const idx = crossingIndexInScreen;
        crossingIndexInScreen = (crossingIndexInScreen + 1) % rowsPerScreen;
        const hasActor = unbounded ? true
          : placement === 'clustered' ? idx < perScreen
          : (idx % spreadStep) === 0 && Math.floor(idx / spreadStep) < perScreen;
        if (hasActor) { frozenThisFrame = true; armPending = true; } // freeze the VERY NEXT frame
      }
    }
    const armNow = armPending; armPending = false;
    const edge = tick(armNow);
    if (blocksRemaining > 0) { blocksRemaining -= edge ? MIXED_CHUNK : CHUNK; if (blocksRemaining <= 0) { completed++; blocksRemaining = 0; } }
    if (blocksRemaining === 0 && pending > 0) { pending--; blocksRemaining = stripLen; }
    const lag = demanded - completed;
    if (lag > lagMax) lagMax = lag;
  }
  return { lagMax };
}
```

```
$ node proto-tools/diag_f11b_legal_worst_case.mjs
=== 10,000,000 frames each, reverted FALLEN STAR speeds (X=128, Y=112), real freeze credit, real 8-per-screen cap ===

--- Y axis (row strip, 32 blocks, 11-vblank service), rowsPerScreen=15 ---
  8-per-screen, clustered: lagMax=1 events=457256 mixedVblanks=914512 freezeFrames=457256
  8-per-screen, spread:    lagMax=1 events=457256 mixedVblanks=914512 freezeFrames=457256
  BEYOND-LEGAL unbounded corridor (labelled stress): lagMax=1 events=824372 mixedVblanks=1648744
  control, no flash at all: lagMax=1

--- X axis (column strip, 30 blocks, 10-vblank service), rowsPerScreen=16 ---
  8-per-screen, clustered: lagMax=2 events=447762 mixedVblanks=895523 freezeFrames=447762
  8-per-screen, spread:    lagMax=2 events=447761 mixedVblanks=895522 freezeFrames=447761
  BEYOND-LEGAL unbounded corridor: lagMax=1 events=857142 mixedVblanks=1714284
  control, no flash at all: lagMax=1

--- Sweep perScreen 1..15/16, both axes, clustered placement ---
  Y perScreen=1..15: lagMax=1 (every value)
  X perScreen=1..15: lagMax=2 (every value)   X perScreen=16 (=unbounded): lagMax=1
```

`mixedVblanks` equals exactly `2 × events` in every legal (8-per-screen) run on both axes — direct,
independent confirmation that no legal-spacing touch ever overlaps a still-counting previous burst
(every event produces its own clean, independent 2-edge cost), matching the real-engine measurement
above.

## Verification

- `git status --short` on the real tree: only `docs/design-streamed-worlds.md` (untracked, as every
  round). No engine, generator, renderer, schema or test file in the real tree was touched this
  round — every build, assembly and Mesen run happened in the scratch copy named in the brief.
- All new prototype work this round (`sw_rw_col_delta`/`sw_rw_row_delta`, `sw_clamp_col`/
  `sw_clamp_row`, `sw_read_transaction`, the widened 3x3 fixture, T8/T9) lives in the scratch tree's
  own `minimal-u512`/`sample-u512`/`sample-mmc3`/`sample-mmc1`/`proto-tools` directories, never the
  real tree.
- `npm test` on the real, untouched tree, run fresh this round: **1812 tests, 0 failures, 0
  skipped** — unchanged from every prior round, confirming nothing regressed by the act of
  reading/greping the real tree's own source files during research.
