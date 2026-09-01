# SFX code fix round 1 report

Fixes `handoff-sfx/sfx-code-review1.md` per `handoff-sfx/brief-sfx-code-fixes-round1.md`. All six
findings accepted and addressed. Nothing has been committed.

## Summary

`npm test`: **880/880 passing** (0 skipped, 0 failed; up from 878 before this round — net +2 new
tests, the exact-co-end pair from finding 4). `npm run smoke`: **97/97 steps passing** (up from 95 —
"sfx editor boundary gates" and "sfx/song transport isolation" are new; "sfx effects tab" now also
verifies the cleanup-tick trace). The cross-tree byte-identity gate was re-run: the SFX-free `sample/`
fixture still builds byte-for-byte identical (`0e638aaa...`) from a clean worktree and the working
tree — this round touched no code path a Sting/SFX-free project runs.

## 1. High — Sound Forge preview (`renderer/forges/sound/sound.js`)

**What changed.** `playSfx()`'s timer callback no longer runs an independent `framesLeft` countdown
that calls `stopSfx()` in the same callback that applies the final playing tick. It now drives
completion from `SfxReplayer`'s own `state` field: the interval keeps ticking (and applying) until
`sfxReplayer.state === 0`, which is only true *after* the state-2 cleanup tick has run and its own
write has already reached `synth.apply`. This is the same two-phase discipline the ROM's own
`sfx_channel_tick` holds to, now mirrored in the preview.

The Songs/Effects mode buttons now each call both `stop()` and `stopSfx()` before switching mode
(the brief's own "stopping both is fine" allowance), rather than each stopping the wrong (incoming,
not outgoing) transport.

**Evidence.** A new real-DOM smoke test, "sfx/song transport isolation": starts the song transport,
switches to the Effects tab, and asserts the Play button reads "▶ Play" (not a stale "⏸ Stop") —
under the pre-fix code, clicking Effects called only `stopSfx()`, leaving `state.playing` (and so the
button text) untouched, so this specific check distinguishes the bug from the fix.

A second real-DOM check, folded into the existing "sfx effects tab" smoke step: `Synth.prototype.apply`
is monkey-patched to record every write batch the preview sends. For the effect this section authors
(1 seeded rest-step frame + 20 added-step frames = 21 playing frames), the real run recorded **82**
total calls across the whole `npm run smoke` session-worth of Preview usage — for the specific
boundary-gate effect (8 steps, more frames), the isolated assertion is `applyCalls.length ===
totalFrames + 1` (playing frames plus exactly one cleanup call), and the cleanup call's own write is
asserted to be exactly `[[0x400c, 0x30]]`. Both assertions pass against the fixed code; before the fix
they could not have (the cleanup tick never ran at all).

## 2. High — the session-reset test (`test/unit/sfx.test.js`)

**What changed.** Rebuilt per the review's own spec:

- A 200-frame held effect (replacing the 13-frame `effectA()`), long enough to still be mid-flight
  through the real transition.
- `sfx_state` polled every frame; the test asserts it was non-zero on the frame immediately *before*
  the reset, not merely "not yet observed to have stopped."
- The `$400C` observer is installed before the trigger and stays live across the whole run — no gap
  where a write could happen unobserved.
- **A real correction the review did not anticipate, found while rebuilding this test**: `player_died`
  (`engine/combat.asm`) sets `game_state = ST_GAMEOVER` on the death frame, but `init_session` — the
  actual reset that clears `sfx_state`/`sfx_left` and writes `$400C = $30` — does not run until
  `restart_game` is reached, which requires a Start press on the game-over/title screen
  (`engine/title.asm`; CLAUDE.md: "Where a game over lands is `restart_game`... `init_session` is the
  single definition of 'new game'"). Confirmed empirically: death and the real reset are ~48-57 frames
  apart on this fixture, not the same frame. The rebuilt test now taps Start in the same cadence
  `test/unit/music.test.js`'s own "game over into a Silence map" test already uses, and inspects
  whichever frame `sfx_state` actually reaches 0 on, not the death frame. It also silences the title
  screen's own map song (`restart_game` lands there, and the sample's title screen has one with real
  noise-channel content, which produced a real, unrelated non-silent `$400C` write that the test's
  final "stays silent" check would otherwise (correctly) flag as a false positive).
- The reset frame's own write is asserted to *include* `$400C = $30` (not to be the only write that
  frame) — confirmed by direct observation that `music_tick` still applies that frame's ordinary SFX
  output first (`$400C = $3C`), and `init_session`'s own clear runs later the same frame
  (`$400C = $30` second) — both are expected, in that order.
- `sfx_state == 0` and `sfx_left == 0` asserted immediately after.
- The final "no later non-silent write" check now explicitly releases Start before its own 30-frame
  watch window, since a still-held Start on the freshly-reached title screen would otherwise start a
  second fresh game mid-check.

**Sabotage-check result (brief item 2).** Commented out `init_session`'s SFX-clear block
(`engine/combat.asm:114-126`, the six-line `.if SFX_ENABLED` block) and re-ran the rebuilt test. It
**failed**, as required:

```
error: 'the reset took 205 frames after the trigger -- the 200-frame effect is not long enough to
still be mid-flight; lengthen it'
```

This is the test's own guard-rail assertion firing (not the "sfx_state != 0 before reset" assertion
directly) — with the clear removed, `sfx_state` never reaches 0 via a real reset at all; it only
reaches 0 once the 200-frame effect finishes *naturally*, ~205 frames after the trigger. The guard
rail exists precisely to catch this shape of false pass (an effect that "completes" for the wrong
reason), and it did. Reverted the edit (`diff` against the pre-sabotage file is empty) and re-ran: the
test passes again.

## 3. Medium — the both-live fit control (`test/unit/kernelbytes.test.js`)

**What changed.** Verified empirically with both constructions, exactly as asked. Four real
`checkCapacity()` runs, MMC3, `sample-rpg`, ALL-7-shipped-verbs + live Sting + live SFX, no Save/Move,
one live item:

| construction | `titleMap` | result |
|---|---|---|
| separate actors (the row-commands / Sting / SFX each on their own placed entity — `assertSfxRefusal`'s existing shape) | `0` (forced) | `need 129, free 78` — **REFUSED** |
| single event (every command on one placed actor — the review's own reconstruction) | `0` (forced) | `need 129, free 78` — **REFUSED, identical numbers** |
| separate actors | `null` | **FITS** |
| single event | `null` | **FITS** |

**The reviewer's conclusion is correct (the row fits), but the reviewer's own proposed mechanism
(single-event vs. separate-actor placement) is not what actually explains the previous refusal — the
title screen is.** The two title-forced runs produced *identical* `need`/`free` figures regardless of
whether the commands sat on one actor or three, which is the direct proof: entity placement was never
the variable. `assertSfxRefusal` forced `project.project.titleMap = 0` unconditionally for every row
it built, including this one — but `handoff-costing/costing-report.md`'s own Part 1 table is a set of
deltas from its "no Save/Move, **no title**, w/ item" baseline, and this row has no live Save command
(the only thing that requires one). The forced title cost a real, uncredited
`TITLE_KERNEL_ALLOWANCE_BY_MAPPER[4]` = 224 bytes that has nothing to do with SFX at all.

**Fix applied**: `assertSfxRefusal` gained a `noTitle` option. The both-live control is restored as
its own dedicated test (single-event shape, per the review's own explicit ask), asserting a real
buildable ROM. Per the brief's own fallback ("keep the separate-actor refusal only if relabeled...
never attributed to the 12-byte correction"): **the separate-actor refusal is not kept at all**, since
the table above shows it was never a real, independent limitation — once the title bug is fixed, that
shape fits too (identical to the single-event figure). Keeping a "refusal" that turned out to mean
nothing would have been more misleading than removing it.

**This also surfaced two more rows the same fixture bug affected**, beyond the one the review named:
the two "ALL-7-verbs + Move + item, no Save" refusal rows (MMC3, UNROM 512) also had no live Save
command and so were also title-inflated. Re-checked with `noTitle: true`:

| board | `titleMap=0` (old) | `titleMap=null` (corrected) | verdict |
|---|---|---|---|
| MMC3 | need 129, free −136 | need 129, free 88 | still **REFUSED**, 41 bytes short (not the old, inflated figure) |
| UNROM 512 | need 129, free −125 | need 129, free 87 | still **REFUSED**, 42 bytes short |

Both rows remain genuinely refused — the review did not flag these two, and the brief did not ask me
to re-check them, but the same fixture defect applied to them and I was not going to leave a
known-inflated figure standing once the mechanism producing it was identified. Fixed the same way
(`noTitle: true`), with corrected, real deficits.

**`sfx-implementation-report.md` correction** (brief: "annotate the correction in place, don't
silently rewrite"): its §3 section now carries a note above the original matrix explaining the title
inflation bug, which of the two originally-declared "flipped" rows was real (MMC1 Save+Move-no-item)
and which was not (the MMC3 both-live control — restored as a fit), and pointing at this report for
the full account. See that file's own §3 for the annotated text.

## 4. Medium — the exact-co-end case (`test/unit/sfx.test.js`)

**What changed.** Built the reviewer's own deterministic construction: a non-suspending SFX and a
non-suspending Sting placed consecutively in one event (`[{op:'sfx',...}, {op:'sting',...}]`), both
arming on the identical script frame, with the Sting's own duration set to exactly one frame longer
than the SFX's playing duration (4-frame SFX, 5-frame Sting) — `sfx_channel_tick` runs before
`sting_tick` every frame (`engine/boot.asm`'s fixed order), so SFX's own cleanup phase and
`sting_left` reaching 0 land on the identical frame with no calibration build needed. Two variants
built and run against the real ROM:

- **Silence-restore**: real trace on the co-end frame is `[$400C=$3F, $400E=$06, $400F=$08, $400C=$30]`
  — the retriggered sting content first, then `sting_restore_silence`'s own unconditional overwrite
  second, in that exact order, matching the design's own pinned write order precisely.
- **Audible-restore**: real trace on the co-end frame is exactly one `$400C` write plus its
  `$400E`/`$400F` pair — no truncation, confirming `sting_retrig_loop`'s own write is inert here as
  the design claims.

Both tests build a real ROM and assert on the real APU trace, matching design test 8's own requirement
directly rather than the design-conforming-but-untested claim the implementation report previously
made.

**`sfx-implementation-report.md` §7 update** (annotated, not erased): the "declared scope reduction"
section now records that this case was subsequently built and closed in code review round 1, with a
pointer to the two new tests, rather than reading as a still-open gap.

## 5. Medium — the ordinary-song hand-back test (`test/unit/sfx.test.js`)

**What changed.** Added `fieldSongWithNoise()` (a variant of the existing `fieldSong()` with a real,
held noise-channel note, `fieldSong()` itself left untouched since other tests depend on its
pulse1-only shape). The rebuilt test now asserts, in addition to the existing "other three channels
unchanged" baseline comparison:

- **Pause**: `mus_dur` for channel 3 (`$034B`, `MUS_DUR_NOISE`) is sampled every frame while SFX owns
  the channel and asserted constant throughout — a genuine freeze, not merely "produced no APU
  writes" (which a channel silently ticking toward its own next, still-unheard note would also
  satisfy).
- **Resume**: the cleanup/hand-back frame is asserted to contain a real `$400E`/`$400F` retrigger
  pair, not just a `$400C` volume byte.

Both pass against the real engine.

## 6. Low — changelog and boundary-gate tests

**Design changelog** (`handoff-sfx/design-sfx.md`): a new "Implementation — measured values" entry
appended to the Fix rounds changelog, one line per allowance term (160/15/5/295), each stated against
its own pre-implementation estimate, with a one-line summary of how each was measured. The historical
§8 estimate table is left untouched, per this file's own established convention of treating that table
as a record of what was estimated, not edited in place.

**Editor-boundary gate tests**: added to `main/smoke.js`'s existing Sound Forge Effects-tab scenario,
real DOM interaction throughout. **Chosen split**: the step-count gate (max 8) is driven with real
clicks the whole way (cheap: 6 more clicks from the section's existing 2-step effect reaches 8); the
effect-count gate (max `LIMITS.sfx` = 255) fills to one below the cap via a direct `store.commit` (the
same shape this section already uses to author the Sting scenario's own song) and drives only the
actual boundary-crossing click for real — 255 real clicks would cost roughly 40-50 seconds of `await
wait(...)` for a boundary this file's own established "direct commit + one real click at the edge"
precedent (e.g. the Items Forge's own over-cap tests) already covers cheaply. Both gates assert the
button disables exactly at the cap and that a further click on a disabled button is a genuine no-op
(the control itself refuses, not merely the caller choosing not to press it), per design test 20a's
own wording. New smoke step: "sfx editor boundary gates."

A real bug was found and fixed while building this: `addStepButton`/`addEffectButton` were captured
once, before any interaction, but `sound.js`'s own `render()` uses `fill()` (clear + append) on every
change, so a button reference from before a change is a detached node afterward — the identical
"re-found fresh, never cached across a change" discipline this file's own route-authoring section
already documents and follows. Fixed by re-querying both buttons fresh at every check after the first
click.

## Final cleanup round (against `handoff-sfx/sfx-code-review2.md`)

Fixed the review's one low finding: two stale comments giving a false account of adjacent, already-
passing tests. `test/unit/sfx.test.js` (~1028-1040) no longer claims the exact-co-end case is
out-of-scope/untested — it now routes to the two exact-co-end tests below and points at the
implementation report's own closure note. `main/smoke.js` (~2479-2486) no longer says the preview
effect is 21 playing frames/22 calls — it now describes the real 8-step, 81-playing-frame effect the
prior boundary-gate check grows it to (82 calls total), matching the dynamic assertion beside it. No
code or assertion changed; `node --test test/unit/sfx.test.js` still passes 25/25, unchanged.

## Do not commit

Per the brief's own standing instruction, nothing in this session has been committed.
