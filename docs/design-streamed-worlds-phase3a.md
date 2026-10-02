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
