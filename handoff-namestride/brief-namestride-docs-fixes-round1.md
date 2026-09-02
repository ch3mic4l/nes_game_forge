# Brief: CLAUDE.md docs pass, fixes round 1

Scope: CLAUDE.md only. Do not commit. Do not contact reviewer. Report to
handoff-namestride/namestride-docs-fixes-round1-report.md.

Two findings from handoff-namestride/namestride-docs-review1.md, both confirmed by the orchestrator
against the tree before routing.

1. **Hunk 2 (the new `battleTables`/`battleTableBytes` paragraph).** "The parameter is why
   `checkBattleStringsCapacity` (`battletables.js`) exists at all" is backwards. The guard exists
   because `push_battle_string` keeps its 8-bit stride; the parameter exists so a test can push a
   22-entry list through `battleTables`' own call site (test/unit/bankedbytes.test.js ~233-260).
   Rewrite that sentence so the guard is introduced on its own terms ("Separately, ...") and the
   parameter is described as what lets the guard be exercised through the emitter, not its cause.

2. **Hunk 3 (the traps bullet).** "offset 4 — four glyphs into the entry before it" is wrong:
   offset 4 is `table + 4`, four glyphs into entry 0, so the old read returned the last six glyphs
   of entry 0 and the first four of entry 1. Say that.

Keep the changes minimal. Re-run `node --test test/unit/docs.test.js` and report the character
count. Do not touch any other file.
