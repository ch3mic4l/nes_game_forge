# Fix brief, round 1: two test-strength findings from review

Reviewer found no fault in the 6502 or the generator change. Two findings, both about what the
tests fail to catch. Both are real; fix both. Do not touch `engine/` or the generator's own logic
for either. Report in `handoff-namestride/namestride-fixes-round1-report.md`. Do not commit. Do
not contact `reviewer`.

## 1. The guard test never goes through `battleTables`

`test/unit/bankedbytes.test.js` (the new `checkBattleStringsCapacity` test) calls the exported
helper directly for all three assertions. Delete the `checkBattleStringsCapacity()` call at the
top of `battleTables` and the suite stays green while real builds emit an overlong table again —
which is exactly the wrong implementation the test should name and fail on.

Fix: at least the over-limit case must be driven through `battleTables(project)` itself, so the
call site is what is being tested. Two acceptable shapes — pick one and say why:

- Give `battleTables` (or the emitter it delegates to) an injectable strings list that both the
  guard and the emission read, defaulting to `BATTLE_STRINGS`, and pass a fabricated 22-entry
  list through it. Keep the default path byte-identical (the golden hash must not move again).
- Temporarily extend the exported `BATTLE_STRINGS` array in the test and restore it in a
  `finally` — only if it is genuinely the same mutable array the emitter reads.

Keep the direct-helper boundary assertions (21 passes, 22 throws) if you like; they are not the
problem. Add the wrong-implementation sentence for the new assertion: "removing the call at the
top of `battleTables` fails this test".

## 2. No fixture forces a carry out of `ptr_lo`

Both high-index fixtures use id 26, product `$0104`. With the tables where they land in these
builds, `LOW(table) + $04` does not cross a page boundary. So an implementation that computed
`index * NAME_LEN` correctly as 16 bits and then added only its low byte into `ptr_lo` without
carrying into `ptr_hi` — a perfectly plausible shift-add variant — passes every current assertion
and draws the wrong entry whenever `LOW(table) + LOW(index * NAME_LEN) >= 256`.

Fix: in each of the two emulator tests, add (or repoint) a control whose read crosses a page
relative to the table base. Reviewer suggested using the required <=25 control for it; any index
that makes `LOW(table) + index * NAME_LEN >= 256` is fine, including a second high index (e.g. 51,
product `$01FE`) if that is easier to seat. The essential part, which the reviewer's note does not
say and which matters more than the index chosen: **the test must assert the carry actually
happens**, by reading the table's address out of `build/game.fns` for that variant and asserting
`(LOW(base) + index * NAME_LEN) >= 256` before it checks the glyphs. Without that assertion the
fixture goes silently vacuous the first time a filler count or an engine edit moves the table.
The coder's own brief already named this trap ("a fixture whose wrapped read happens to produce
the right glyphs passes vacuously"); this is the same trap in a different coat.

If seating the extra control requires more filler actors, re-check the banked region still fits
on all three boards and say the figures. `BASE_BATTLE_CODE_BYTES_BY_MAPPER` must not move —
this round touches tests only.

Prove each strengthened test the way round 0 did: sabotage the routine to the exact wrong
implementation the test now names (e.g. replace `bcc`/`inc ptr_hi` with nothing) and show it
fails, then restore. Put the failing output in the report.

## Deliverable

The two test changes, `npm test` totals (pass/skip/fail), the sabotage output for each, the
wrong-implementation sentence for each, and confirmation that no engine file and no generator
logic changed (`git diff --stat` against the round-0 state).
