# Fix brief, round 2: one finding, the half-threaded injectable list

Reviewer's round-2 finding (`handoff-namestride/namestride-review2.md`), which I have confirmed
against the code: `battleTables(project, battleStrings)` emits from the injected list, but
`battleTableBytes(project)` (`main/build/battletables.js:521`) still calls `battleTables(project)`
with the default, so for an injected 21-entry list the emission is 584 bytes while the counter
says 464. Harmless for real builds, but a byte counter that can disagree with the emission it
counts is precisely the drift this file exists to prevent, and the round-1 call-site test cannot
see it because its only injected case (22 entries) throws before emission.

Fix, tests only plus the one signature:

1. `battleTableBytes(project, battleStrings = BATTLE_STRINGS)` passes the list through to
   `battleTables`. Do not change `battleRegionBytes`'s signature or `generate.js`; the default
   path must stay byte-identical (golden hash must not move).
2. Add a 21-entry integration control to `test/unit/bankedbytes.test.js`: build a fabricated
   21-entry list, assert `emittedBytes(battleTables(project, list)) === battleTableBytes(project,
   list)`, and assert that figure is exactly `(21 - BATTLE_STRINGS.length) * MSG_COLS` bytes more
   than `battleTableBytes(project)` (120 today). The second assertion is what makes the first
   non-vacuous: two functions that both ignored the list would still agree with each other.
3. Wrong-implementation sentence and sabotage proof: revert `battleTableBytes` to ignore the
   list, show the new test fails, restore.

Report in `handoff-namestride/namestride-fixes-round2-report.md` with `npm test` totals and
`git diff --stat`. No engine change. Do not commit. Do not contact `reviewer`.
