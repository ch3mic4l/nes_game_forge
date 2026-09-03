# `SPLIT_LOCK_KERNEL_ALLOWANCE` is never independently measured — a paired MMC3 drift would pass undetected

**Status: open, deliberately.** This is a documented gap, not a defect being fixed here. Chris's decision:
closing it is its own slice, not part of the round that found it (`handoff-magic/kernel-base-2-report.md`).
Written up per the same discipline `docs/kernel-base-overcharge-report.md` got before its own fix landed —
this document is that file's sibling, not its sequel.

## 1. The claim, in one line

`SPLIT_LOCK_KERNEL_ALLOWANCE` (19, MMC3-only, `main/build/generate.js`) is never measured in isolation
anywhere in this codebase. Every equality assertion that touches it (`test/unit/kernelbytes.test.js`)
uses it as a **subtrahend inside a residual** derived from a real build that already contains it mixed
in with other code — never as the direct subject of a before/after delta the way every other named
kernel-lo allowance in this file is measured. A one-byte real-code drift split between MMC3's split-lock
code and MMC3's non-split base code, in opposite directions, would leave every existing assertion true
while `BASE_KERNEL_CODE_BYTES_BY_MAPPER[4]` and `SPLIT_LOCK_KERNEL_ALLOWANCE` are both individually
wrong.

**This predates round 1 of the kernel base overcharge work** (`handoff-magic/brief-kernel-base-1.md`) —
it was equally true before that round touched anything, because `SPLIT_LOCK_KERNEL_ALLOWANCE` was never
isolated at any point in this file's history. Round 1 did not cause it. What round 1 changed is that the
ledger now leans on it twice instead of once (below), so the same pre-existing gap now sits underneath
more of the ledger's own equality claims than it used to.

## 2. What is measured, and what is not

Only nesasm's own output counts as measured, so this section states plainly which of the numbers below
came from a real build and which did not.

**Measured, on a real MMC3 build** (`test/unit/kernelbytes.test.js`, the "kernelCodeBytes covers the real
engine..." test, confirmed again while writing this report):

- `actionEntry.codeBytes` — `sample` (the action fixture) built on MMC3 with nothing conditional
  turned on. This is real nesasm output, and it includes MMC3's real split-lock code, because `sample`
  carries real dialogue and MMC3's `fontBankSplit` is gated on `projectUsesText` alone, not on game
  type.
- `rpgNoItemsEntry.codeBytes` — `sample-rpg` built on MMC3 with items stripped and nothing else
  conditional. Also real nesasm output, and it also includes MMC3's real split-lock code, for the
  identical reason (an RPG always shows text).
- `mmc3.codeBytes` — `sample-rpg` built on MMC3 with nothing conditional turned on (items included).
  Real nesasm output, split-lock code included.

**Not measured, anywhere:** the byte cost of MMC3's split-lock code (`split_select`'s `.if
SPLIT_ENABLED` machinery — see "The engine" in CLAUDE.md) in isolation from the rest of MMC3's base
kernel. No build in this codebase ever compares two MMC3 builds that differ **only** in whether the
font-bank split is active with everything else held constant. `SPLIT_LOCK_KERNEL_ALLOWANCE = 19` is a
number written into `main/build/generate.js` and trusted by every assertion that reads it; nothing
re-derives it from a diff.

## 3. Why the existing assertions cannot catch a paired drift

Three equality assertions touch split-lock, all in the same test. Written as equations, using `total`
for a real build's own nesasm output, `base`/`battle`/`split`/`item` for the four constants, and `SL`
for `SPLIT_LOCK_KERNEL_ALLOWANCE` specifically:

1. **Action residual** (pins `base` given `SL`'s stored value): `actionTotal - item - SL == base`
2. **Battle residual** (pins `battle` given `base` and `SL`'s stored value, both already trusted from
   equation 1): `rpgNoItemsTotal - base - SL == battle`
3. **Extended check** (the one round 1 added a subtraction to, per round-1 review finding 2):
   `mmc3Total - base - battle - item - itemEffect == SL`

Substitute equation 1's `base` and equation 2's `battle` into equation 3 and it reduces to `SL == SL` —
true by construction, for any value `SL` happens to hold, the moment 1 and 2 already hold. It is not
an independent measurement; it is arithmetic that was true before either constant was touched. The
round-1 review's own finding 2 says this precisely, and this document exists because that finding was
independently verified, not merely quoted: re-tracing the exact three equations above by hand against
the current test file confirms the substitution goes through.

**The concrete escape.** Suppose a future engine change moves exactly one byte from MMC3's non-split
base code into MMC3's split-lock code — a real change to `split_select` or a neighboring routine that
happens to shrink the base path by 1 byte and grow the split path by 1 byte, for any reason (a
different addressing mode, an instruction reordered across the boundary the two code paths share).
The true, physical base cost is now `base_true = base_stored - 1` and the true split-lock cost is
`SL_true = SL_stored + 1`. Every quantity nesasm actually measures — `actionTotal`, `rpgNoItemsTotal`,
`mmc3Total` — is a sum that includes both `base_true` and `SL_true` (since every MMC3 build this file
measures carries real text, hence real split-lock code), so each real total is **unchanged** by a
drift that only redistributes bytes between two code paths without changing their sum. Equation 1
still computes `actionTotal - item - SL_stored == base_stored`, using the *stored* `SL` constant, not
the true one — and since `actionTotal` didn't move, this is still true. Equation 2 is the same
argument. Equation 3 is still `SL_stored == SL_stored` by the substitution above. Nothing fails. Both
`BASE_KERNEL_CODE_BYTES_BY_MAPPER[4]` and `SPLIT_LOCK_KERNEL_ALLOWANCE` are now silently wrong by one
byte apiece, in opposite directions, with the combined reservation for either individual project shape
(action-with-text vs. RPG) still correct — because that combined figure is exactly what the real
totals above equal, and those never moved.

A single-byte drift is the minimal case; nothing about the argument requires it to stay that small. Any
paired change that conserves the sum of the two code paths escapes the same way.

## 4. What it costs a user today

Nothing, as far as this document can show. The escape only fires when `base` and `SL` drift in
opposite directions by matching amounts from a single real-code change — a specific, narrow kind of
edit, not something a routine engine change is likely to produce by accident. And even if it happened,
the *combined* reservation for any project shape this ledger actually charges (an action project with
text, an RPG with or without items) stays correct, because that combined figure is what the real
builds in §3 actually pin. What breaks is narrower and more specific: `kernelShortfallAdvice`'s
counterfactual-occupancy pricing (CLAUDE.md, "The kernel budget") for the one scenario where dropping a
command frees split-lock's bytes **without** also changing the base — which does not currently exist,
because every path in this codebase that turns split-lock off (dropping the project's only live event)
also changes which project shape is being measured. So this is a real gap in what is *proven*, not a
known-wrong number in the shipped ledger.

## 5. Why no test caught it, which is the part worth keeping

The same shape `docs/kernel-base-overcharge-report.md` §5 already describes for the base/battle split:
every absolute check in this file that touches split-lock is a residual built from a real total that
already contains split-lock's own bytes baked in, never a diff between two builds that isolate it. The
round-1 review found this by tracing the equations algebraically rather than by running anything — the
same discipline this document's own §3 repeats independently rather than taking on faith. `SAVE_BATTLE_
KERNEL_ALLOWANCE` and `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER` were both isolated this way when they were
introduced (a real build with and without the feature, everything else held constant); split-lock never
was, because at the time it was introduced there was no companion base figure precise enough for the
gap to matter, and no test since has gone back to isolate it on its own terms.

**Round 1 made this gap more load-bearing, without creating it.** Before round 1, `SPLIT_LOCK_KERNEL_
ALLOWANCE` sat under one equality assertion (the extended check, equation 3 above, in its old,
algebraically-broken form — see the round-1 review's finding 2 for what that old form actually
asserted). Round 1 added the action and battle residuals (equations 1 and 2) as new equality
assertions, both of which also subtract `SL`'s stored value rather than a re-measured one. So the same
unverified 19 now sits underneath three equality claims instead of one, all three of which would stay
green under the identical paired-drift scenario in §3. That is a fact about how much of the ledger
currently rests on this number, not a claim that round 1 introduced the gap — §1 above already states
that plainly, and this section exists so the two claims (predates round 1; round 1 increased reliance
on it) are not read as in tension with each other.

## 6. What a fix would have to do (sketch, not a plan)

**This is a sketch. Every number in it is illustrative, not measured, and must be re-derived from a
real build before anything here is trusted — the same warning `docs/kernel-base-overcharge-report.md`
§6 carries for its own sketch, and for the identical reason.**

The shape: one real-build isolation that toggles `fontBankSplit` while holding everything else in the
kernel-lo configuration constant, on MMC3, and equality-asserts the delta against `SPLIT_LOCK_KERNEL_
ALLOWANCE` directly — the same technique every other named allowance in this file already uses, applied
to the one term that has so far gotten away without it.

1. **Find (or build) two MMC3 configurations that differ only in whether `fontBankSplit` is true.**
   `fontBankSplit(project, mapper)` (`shared/font.js`) is `mapper.scanlineIrq && projectUsesText(project)`
   in effect (see that function's own definition for the exact predicate) — so the naive approach,
   toggling `projectUsesText`, does not hold "everything else constant": removing the project's only
   text-producing content (its dialogue, or its only Move/Sting-carrying event) also changes
   `usesMove`/`usesSting`/whatever made the project use text in the first place, which would charge or
   uncharge *those* allowances in the same delta and contaminate the isolation. A clean isolation needs
   a project whose `projectUsesText` can be forced independently of every other conditional term this
   file already tracks — which may mean a synthetic project built for this test alone (an entity with a
   `Say` command that contributes text without also turning on Move, Turn, Wait, Save, Sting, Sfx, or
   items), not one of the five checked-in fixtures.
2. **Build it twice on MMC3**: once as constructed (split-lock on), once with the text-bearing content
   removed in a way that is verified — not assumed — to leave every other conditional predicate this
   file tracks (`projectUsesMove`, `projectUsesSave`, …) exactly as it was. The second build needs some
   other, non-text-producing way to keep the project otherwise identical, or the delta will not
   actually isolate split-lock.
3. **Equality-assert the delta against `SPLIT_LOCK_KERNEL_ALLOWANCE` directly** — not against a residual
   computed from `base`/`battle`/`item`, the mistake this whole document is about.
4. **Once split-lock is independently pinned, equations 1 and 2 in §3 above stop being co-dependent**:
   equation 1 can then trust `SL` as a real, independently-measured quantity rather than an assumed one,
   which is what actually makes it a measurement of `base` alone rather than of `base + SL` together.
   The extended check (equation 3) may stay as a cross-check, but its comment should say plainly that it
   is a consequence of 1 and 2 rather than an independent proof, per the round-1 review's own correction.

Two things to check before starting, neither settled here:

- **Whether a synthetic fixture is worth adding just for this isolation**, versus finding a lighter
  way to force `projectUsesText` independently of every other predicate on one of the existing fixtures
  — a judgement call about test-suite weight, not something this document should decide in advance of
  actually attempting it.
- **Whether the same gap exists on a future second scanline-IRQ board.** `fontBankSplit`'s comment
  already says it generalizes past MMC3 if one is ever added (`kernelbytes.test.js`'s own comment
  beside the split-lock residual makes the same claim: `fontBankSplit`, not a hardcoded MMC3 check).
  Whatever isolation this fix adds should be written against `scanlineIrq: true` generally, not against
  mapper id 4 specifically, or it will need rediscovering a second time.

## 7. Relationship to the kernel base overcharge work

Found while reviewing round 1 of that work (`handoff-magic/kernel-base-1-review1.md`, finding 2), not
by this document's own investigation — this write-up exists to record what the review found and verify
it independently, the same role `docs/kernel-base-overcharge-report.md` played for round 1's own
defect before it was fixed. The two documents share a lesson, restated for this case:

> A residual computed from a real build that already contains the term being asserted is not a
> measurement of that term — it is arithmetic that happens to be true given every other constant it
> depends on. Isolating a term means building it on and off with everything else held constant, the
> same discipline every other named allowance in this ledger is supposed to meet and this one alone has
> not, until it does.

Unlike the base/battle split, this one was never wrong — split-lock's own measured value may well be
exactly 19, and the base may well be exactly what `BASE_KERNEL_CODE_BYTES_BY_MAPPER[4]` says. What is
missing is proof, not a known-bad number, which is why this document's own status is "open, deliberately"
rather than "resolved": there is nothing here to fix yet, only a gap in what the test suite can catch if
something does go wrong.
