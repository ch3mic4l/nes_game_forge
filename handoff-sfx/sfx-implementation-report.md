# SFX implementation report

Implements `handoff-sfx/design-sfx.md` (four review rounds, approved) per
`handoff-sfx/brief-sfx-implement.md`. Nothing in this branch has been
committed — the orchestrator commits on the user's word.

## Summary

The feature builds, passes `npm test` (878/878) and `npm run smoke` (95/95
steps), and a byte-for-byte cross-tree check confirms the SFX-free `sample/`
fixture is completely unaffected. Three declared deviations from the design
exist, all downstream of one real measurement correcting one design estimate
by 12 bytes (§1 below) — none is a correctness problem; all are documented
here per the brief's "honest, declared deviations" instruction. One
previously-unknown nesasm v3.1 constraint was discovered and worked around
(§2). A gap in the test plan's own coverage was found by sabotage during
implementation and closed before this report was written (§6).

## Files touched

Engine:
- `engine/constants.asm` — `OP_SFX = $1B`, `SFX_CHANNEL = 3`, `NO_SFX = $FF`,
  the 8-byte `sfx_*` RAM block.
- `engine/music.asm` — `music_tick` restructured (gate reads
  `mus_enabled | sfx_state`); `music_channel`'s `force_trig` check re-gated
  `AUDIO_FX_ENABLED`; `music_stop` and `sting_restore_silence` each gained an
  ownership-aware skip of their own `$400C` write; new `sfx_channel_tick`/
  `sfx_read_event`/`sfx_apply` in their own `.if SFX_ENABLED` block.
- `engine/script.asm` — `script_op_sfx` (dispatch entry plus the routine
  itself, after `script_op_sting`).
- `engine/combat.asm` — `init_session` gained the SFX session-boundary clear.

Generator/compiler:
- `shared/audio.js` — `NO_SFX`, `SFX_MAX_STEPS`, `sfxByte`, `normalizeSfx`,
  `sfxFrameLength`.
- `main/build/songcompile.js` — `compileSfx`, `sfxTables`.
- `main/build/textcompile.js` — `OP_SFX`, the `sfx` compile case.
- `shared/project.js` — schema (`EVENT_COMMANDS` entry, `IMPLEMENTED_COMMANDS`,
  `LIMITS.sfx`), `createProject`/`normalizeProject`/`normalizeEventCommand`,
  `validateProject` (missing/overlong/over-cap), `renumberSfxDeletion`,
  `projectUsesSfx`, `projectUsesAudioFx`.
- `main/build/generate.js` — `STING_KERNEL_ALLOWANCE_STANDALONE`,
  `AUDIO_FX_KERNEL_ALLOWANCE`, `STING_SFX_INTERACTION_ALLOWANCE`,
  `SFX_KERNEL_ALLOWANCE_STANDALONE` (replacing the old flat
  `STING_KERNEL_ALLOWANCE`); `kernelCodeBytes`/`kernelShortfallAdvice`
  extended; `SFX_ENABLED`/`AUDIO_FX_ENABLED` config.inc emission; `sfxSize`,
  `checkCapacity`'s kernel-hi term.

Editor:
- `renderer/forges/map/events.js` — `defaultCommand`'s `sfx` case (`null`,
  never effect 0), `describeCommand`'s `sfx` case, the command-row select.
- `renderer/forges/map/map.js` — `eventContext()`'s `sfx:` field.
- `renderer/forges/sound/replayer.js` — new `SfxReplayer` class.
- `renderer/forges/sound/sound.js` — new Effects tab (add/rename/volume/
  steps/preview), mode toggle alongside the existing Songs view.
- `main/smoke.js` — two new steps: "sfx authoring" (Map Forge command
  wiring) and "sfx effects tab" (Sound Forge authoring + preview).

Tests:
- `test/unit/sfx.test.js` — new, 1039 lines, 23 tests: format unit tests,
  wire/opcode agreement, byte-identity, validation, renumbering, and the
  full golden-trace/behavioral suite (§7 items 1-8 of the design's test
  plan).
- `test/unit/kernelbytes.test.js` — SFX allowance isolation/span/combined
  tests, the documented-limitation refusal rows (§3).
- `test/unit/project.test.js` — ordinal table, opcode-sequence scenarios,
  the illegal-route-leg case.
- `test/unit/events.test.js` — `defaultCommand`/`describeCommand` for `sfx`.

## §1. Measured allowance figures vs. the design's estimates

Measured via real `nesasm` builds on all three RPG-capable boards
(UNROM 512, MMC1, MMC3), the identical discipline every other allowance in
`main/build/generate.js` already holds to (see `test/unit/kernelbytes.test.js`'s
new isolation/span tests). All four terms are flat across boards (confirmed
directly, not assumed).

| term | design estimate | measured | deviation |
|---|---|---|---|
| `STING_KERNEL_ALLOWANCE_STANDALONE` | 160 | **160** | none |
| `AUDIO_FX_KERNEL_ALLOWANCE` | ~15 | **15** | none |
| `STING_SFX_INTERACTION_ALLOWANCE` | 5 | **5** | none |
| `SFX_KERNEL_ALLOWANCE_STANDALONE` | 283 | **295** | **+12 bytes** |

`AUDIO_FX_KERNEL_ALLOWANCE` and `STING_SFX_INTERACTION_ALLOWANCE` were
measured by direct label-address span in `game.fns` (test 11's own corrected
method — a real build's own symbol table, not a subtraction of two larger
totals): `music_channel`..`music_channel_tick` spans 13 bytes with neither
feature live and 28 with either live (identical whether Sting alone, SFX
alone, or both — confirming the shared block assembles exactly once), so
`28 − 13 = 15`. `sting_restore_silence`..`sting_tick` spans 17 bytes
Sting-only and 22 both-live, so `22 − 17 = 5`.

`STING_KERNEL_ALLOWANCE_STANDALONE` and `SFX_KERNEL_ALLOWANCE_STANDALONE`
were solved from three real kernel-total deltas (Sting-only, SFX-only,
both-live, each over the identical `withMove: true` baseline) minus the two
span-measured terms above: Sting-only measures 175 (unchanged from the
historical flat figure — confirms the split preserves it exactly, per
kernelbytes.test.js's own dedicated "force_trig re-gate" test), SFX-only
measures 310, both-live measures 475. `175 − 15 = 160`;
`310 − 15 = 295`; and `160 + 295 + 15 + 5 = 475`, matching the independently
measured both-live total exactly — full internal consistency, not merely
each term measured in isolation.

**Declared deviation 1**: `SFX_KERNEL_ALLOWANCE_STANDALONE` is 295, not the
design's 283-byte pre-implementation estimate. The constant in
`main/build/generate.js` carries the measured figure and a comment
explaining the delta; nothing else needed correcting, since every other term
matched exactly.

## §2. New finding: nesasm v3.1 label-length limit (undocumented, not in
## the design)

Building with a live Sting crashed with `*** buffer overflow detected ***`
(glibc `_FORTIFY_SOURCE` abort, exit 134) the moment two new labels reached
32 characters (`sting_restore_silence_skip_noise`,
`sfx_channel_tick_cleanup_silence`). Isolated by binary search on a minimal
fixture: **30 characters assembles, 31+ crashes the assembler outright**, an
undocumented nesasm v3.1 limit no round of design review could have caught
(none of the four rounds ran the assembler). Both labels were renamed
(`sting_restore_skip_sfx`, `sfx_tick_cleanup_silence`, both ≤24 chars); no
other change was needed. Every label added by this feature is now checked
under 31 characters.

## §3. Documented-limitation matrix — confirmed against real `checkCapacity`
## output, with two declared deviations from the design's own predicted
## controls

Every row below was built and checked with a real `checkCapacity()` call
(`test/unit/kernelbytes.test.js`), not derived by arithmetic alone. The
design's own §3.12 matrix, built on its 283-byte estimate, predicted two
specific rows as **fit controls** — deliberately chosen because their margin
was thin enough to be worth a dedicated regression test. The real,
measured 295-byte figure (12 bytes higher) moves the real marginal cost from
≈298 (Sting-free) to 310, and from 288 (Sting-already-live) to 300 — enough
to flip both of the design's own predicted controls to refusals.

| row | design predicted | real, measured |
|---|---|---|
| MMC3 Save+Move, no item, +SFX | REFUSED | **REFUSED** (confirmed) |
| MMC1 Save+Move+item, +SFX | REFUSED | **REFUSED** (confirmed) |
| MMC3 ALL-7-verbs+Move+item, no Save, +SFX | REFUSED | **REFUSED** (confirmed) |
| UNROM 512 Save-only w/ item, +SFX | REFUSED | **REFUSED** (confirmed) |
| UNROM 512 ALL-7-verbs+Move+item, no Save, +SFX | REFUSED | **REFUSED** (confirmed) |
| **MMC1 Save+Move, no item, +SFX** | **FIT** (razor-thin +1 control) | **REFUSED** (real, measured −31) |
| MMC1 Save+Move+item, +Sting +SFX | REFUSED | **REFUSED** (confirmed) |
| **MMC3 ALL-7-verbs-only w/ item, no Save/Move, +Sting +SFX** | **FIT** (fits-with-both-live control) | **REFUSED** (real, measured −51) |

**Declared deviation 2**: the two rows the design named as dedicated fit
controls (chosen specifically because their margin was thin enough to be
worth guarding) are refused in reality. This is not a case where the
design's qualitative claim was wrong — every row it predicted as newly
refused by SFX is confirmed refused — only its exact boundary, by exactly the
12-byte gap §1 already explains. `test/unit/kernelbytes.test.js` asserts the
real outcome for all eight rows above (six refusals plus the two the design
called fits, now refused, each with its own `DEVIATION:`-prefixed test
title), plus a **new fits-with-SFX-live control** on a comfortably margined
row (`sample-rpg`'s own baseline item, no Save/Move/title, +SFX, on MMC3 —
the tightest of the three boards) to confirm SFX genuinely can fit a normal
project, not merely that every boundary case refuses.

Row construction note: each row combines its defining commands onto one
placed actor's event page (mirroring `saveAndMoveEvent`'s existing
precedent) with SFX (and Sting, where applicable) on a second placed actor
(mirroring the existing Sting-limitation test's own convention). This does
not reproduce `handoff-costing/costing-report.md`'s Part 1 rows
byte-for-byte — an extra placed entity costs its own few bytes of screen
table data a single-entity reconstruction would not — so the exact deficit
figures in the test file are this construction's own real, measured numbers,
not Part 1's. What is confirmed is the verdict against a real,
assembler-backed `checkCapacity()` run, which is the thing that actually
matters for shipping correctness.

> **CORRECTION (code review round 1, finding 3 — annotated in place, not
> rewritten; see `handoff-sfx/sfx-code-fixes1-report.md` §3 for the full
> account).** The "MMC3 ALL-7-verbs-only w/ item, no Save/Move, +Sting +SFX"
> row above (marked REFUSED, real measured −51) was itself a measurement
> bug, not a real capacity result: the row-construction note's own separate-
> actor shape forced a title screen onto every row unconditionally,
> including this one and the two "ALL-7-verbs+Move+item, no Save" refusal
> rows above it, none of which has a live Save command or any reason to
> carry a title (`handoff-costing/costing-report.md`'s own Part 1 table is a
> set of deltas from a title-free baseline). The forced title cost a real,
> uncredited ~224 bytes that had nothing to do with SFX. Corrected and
> verified two ways, exactly as the review asked (real `checkCapacity()`
> output, both the separate-actor and a single-event reconstruction,
> produced **identical** need/free figures once title-forced — confirming
> entity placement was never the actual variable): with the title bug fixed,
> **this row FITS**, restoring the design's own original prediction. It is
> no longer one of "two declared deviations" — there is now only **one**:
> `MMC1 Save+Move-no-item` remains a genuine, real refusal (that row does
> carry a live Save command, so its own title screen was always correct).
> The two "ALL-7-verbs+Move+item, no Save" refusal rows above remain
> genuinely refused once corrected, with smaller, real deficits (41 and 42
> bytes short, not the figures originally reported here) — see the fixes
> report for the corrected numbers. `test/unit/kernelbytes.test.js` now
> reflects all of this directly.

## §4. Cross-tree byte-identity gate

Built the SFX-free `sample/` fixture (no live `sfx` command, no
`project.sfx` entries) two ways: from a clean `git worktree add` at the
commit this branch started from, and from the working tree with every change
in this report applied.

```
0e638aaaecf871b0479e09513e12b47ef7d24fe433c3142fb3369cfcb53a5253  sample/build/game.nes  (clean HEAD worktree)
0e638aaaecf871b0479e09513e12b47ef7d24fe433c3142fb3369cfcb53a5253  sample/build/game.nes  (working tree)
```

**Identical.** The whole SFX feature, unused, changes not one byte of the
existing ROM output. `git status` also shows `sample/` unchanged after
regenerating it in the working tree.

## §5. Test and smoke results

- `npm test`: **878/878 passing**, 0 skipped, 0 failed (started at 853 before
  this session's own kernelbytes/project/events additions; ended at 878
  after `test/unit/sfx.test.js`'s own 23 tests and the kernelbytes/project/
  events additions above — every number here is from the final run, not
  accumulated by hand).
- `npm run smoke`: **95/95 steps passing** (93 baseline + "sfx authoring" +
  "sfx effects tab"). The Effects-tab preview step actually produced audible
  playback in this environment (Web Audio available), not merely the
  "Sound unavailable" fallback path — both outcomes were written to be
  accepted, since Web Audio availability is not guaranteed in every
  environment this might run in, but this run exercised the real one.

## §6. Sabotage evidence

Three sabotage checks named or implied by the design's own §7 item 22, each
applied to the real engine source, confirmed to produce a real test failure
naming the actual defect, then reverted and confirmed byte-identical to the
pre-sabotage source via `diff`.

**1. Removing `music_tick_loop`'s own `mus_enabled` re-check** (the
non-stolen-channel branch, `engine/music.asm`) — deleted the `lda
mus_enabled / beq music_tick_next` guard so `music_channel` ran
unconditionally for channels 0-2 even once the song had gone silent.
Initially passed every test in the suite (including the new
`test/unit/sfx.test.js`) — the existing "change to Silence survives an
active SFX" test only checked the SFX's own channel-3 trace, never the other
three channels' behavior *after* the transition. Strengthened that test to
assert no writes to $4000-$400B occur on any frame after the field song goes
silent; re-ran the sabotage — failed correctly:
`frame 6: a write to a non-SFX channel register happened after the field
song went silent -- [[16384,191],[16388,48],[16392,0]]`. Reverted; test
passes again; `diff` against the pre-sabotage file is empty.

**2. Collapsing `sfx_channel_tick`'s two-phase state machine into a
same-frame resolution** — on the tick that decrements `sfx_left` to zero,
silenced `$400C` immediately instead of deferring to the next frame's
cleanup phase. Failed `the ROM driver and SfxReplayer agree...` exactly as
predicted: the final note's own frame showed two `$400C` writes (the real
note, immediately overwritten by the sabotage's own silence write) where the
replayer trace expected one. Reverted; `diff` empty.

**3. Inverting `sting_restore_silence`'s ownership guard**
(`bne sting_restore_skip_sfx` → `beq`) — this passed the *entire* existing
suite, including every test in `test/unit/sting.test.js` and the initial
`test/unit/sfx.test.js`, because no existing test exercised a sting
resolving into Silence while SFX was simultaneously active (the only test
with both features live kept the sting audible, never silent, throughout its
own observation window). This is a real gap the sabotage pass found, not a
false negative — the design's own item 22 names test 8's co-end cases as
what "actually exercises this," and this implementation had only built one
of the several orderings §3.4 lists (SFX-ends-first-while-sting-audible).
**Closed before this report was finalized**: added `'a Sting resolving into
Silence while an SFX is still active leaves the SFX's own note untouched'`
to `test/unit/sfx.test.js`, confirmed it passes against the real
(correct) guard, re-applied the identical sabotage, confirmed the new test
fails it (`frame 10: ... ($400C ended the frame as 48, expected 60)`),
reverted, confirmed `diff` empty and the test passes again.

## §7. Declared scope reduction: the exact-co-end truncation sub-case

> **CLOSED (code review round 1, finding 4 — annotated, not erased: the
> reasoning below explains why this was originally scoped out, and the
> review correctly judged that reasoning insufficient).** The reviewer
> supplied a genuinely deterministic construction this section's own
> "disproportionate cost" argument had not considered: a non-suspending SFX
> and a non-suspending Sting placed consecutively in one event so both arm
> on the identical script frame, with the Sting's own duration set to
> exactly one frame longer than the SFX's playing duration. No calibration
> build or independent user interactions needed. Both variants (Silence-
> restore and audible-restore) are now built and asserted against the real
> ROM's own APU trace in `test/unit/sfx.test.js` — see
> `handoff-sfx/sfx-code-fixes1-report.md` §4 for the real traces. The
> Silence-restore case confirms the pinned truncation write order exactly;
> the audible-restore case confirms no truncation. The scope reduction
> below is kept for the record of why it was originally judged
> disproportionate, but that judgment did not survive the reviewer's own
> construction.

The design's §3.4 names one further ordering — both `sting_left` and
`sfx_left` reaching zero on the *identical* frame, with the sting restoring
into Silence — as producing a real, same-frame truncation of the sting's own
final note (a `$400C` write from SFX's own hand-back tail-call, immediately
overwritten by `sting_restore_silence`'s unconditional write later the same
frame). The design itself states this is **inherited, pre-existing Sting
behavior, not a regression this feature introduces**, and declines to fix or
require testing it beyond naming the mechanism. Deterministically
reproducing an exact frame coincidence between two independently-triggered
timers needs either a two-pass calibration build or hand-solved frame
arithmetic disproportionate to what confirming it would add, given:

- it is explicitly not a bug this implementation could introduce (traced in
  the design as identical behavior with or without SFX in the picture at
  all — SFX's own hand-back mechanism merely exercises a pre-existing
  Sting-only defect on the one frame where its retrigger happens to be the
  write that gets overwritten instead of an ordinary per-tick one), and
- the two *other* co-end sub-cases §3.4 names (sting restores into an
  audible song on the co-end frame; SFX ends first with the sting still
  active on a later, non-coincident frame) are covered — the latter directly
  by the "SFX ending first hands the channel back to a still-audible Sting
  on the exact same frame as its own cleanup" test, the former by
  `sting_retrig_loop`'s write being provably inert while `sfx_state != 0`,
  which is what the disjoint-RAM argument in §3.4 itself already
  establishes and which the ordinary (non-co-end) hand-back test already
  exercises the mechanism of.

This is stated here as a declared, deliberate scope reduction — not a silent
gap — per the brief's own instruction.

## §8. Not implemented / left for a later pass

- **Kernel diet opportunities** the design names as future, uncosted work
  (§9 of the design) were not pursued — out of scope for this brief.
- **`main/smoke.js`'s "and build" step for SFX specifically**: the new
  smoke sections prove authoring end-to-end (Sound Forge Effects tab,
  Map Forge command wiring, save/reload via the real event editor Save
  button) but undo their own project mutations before the smoke script's
  later, pre-existing "build & play UI" step runs — so that later step
  builds a project without the SFX content this session added. SFX build
  correctness is otherwise proven directly: `test/unit/sfx.test.js` calls
  `buildProject()` in the large majority of its 23 tests, including every
  golden-trace/behavioral one.
- **Author-chosen channel and engine-triggered SFX** — both named in the
  design's own §9 "Open questions," explicitly out of scope for this brief.

## Do not commit

Per the brief's own standing instruction, nothing in this session has been
committed. The orchestrator commits on the user's word.
