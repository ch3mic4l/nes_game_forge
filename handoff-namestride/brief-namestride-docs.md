# Brief: CLAUDE.md docs pass for the name-stride slice

Scope: CLAUDE.md only. No code, no tests, no other files. Do not commit. Do not contact reviewer. Report to handoff-namestride/namestride-docs-report.md.

## Background

Commit afc20d4 shipped the name-stride fix: `name_offset_pc` (engine/battle.asm) used to compute
`index * NAME_LEN` as an 8-bit offset and drop the carry, so index 26 wrapped. It now adds the
product into a 16-bit `ptr_lo/ptr_hi` and its four callers read `[ptr_lo],y`. Read
handoff-namestride/namestride-report.md and the two fixes reports for the full story before editing.
`BASE_BATTLE_CODE_BYTES_BY_MAPPER` in main/build/battletables.js moved +50 on every board and now
reads `{ 30: 3885, 1: 3885, 4: 3931 }`.

## What to change in CLAUDE.md

1. **"The battle system", the `BASE_BATTLE_CODE_BYTES_BY_MAPPER` passage (around line 1185).**
   The figures 3835 / 3835 / 3881 are stale. Update to 3885 / 3885 / 3931 and describe the +50 as
   the name-stride fix layered on top of the existing +14 battle-math saturation note -- keep the
   existing sentence about the saturation fixes; do not delete history, extend it. Point at
   handoff-namestride/namestride-report.md the same way the passage already points at
   handoff-battlemath/battlemath-report.md. Keep the "MMC3's extra 46 bytes" sentence true: check
   that 3931 - 3885 is still 46 and say so only if it is.

2. **Same section, a short new paragraph (or extension of the exactness paragraph)** recording:
   - `battleTables(project, battleStrings = BATTLE_STRINGS)` and
     `battleTableBytes(project, battleStrings = BATTLE_STRINGS)` both take the optional list,
     test-only injection; the default path is byte-identical to before. Say why both take it:
     round 2 of review found the counter could be fed a list the emission was not, a counter that
     could disagree with what it counts.
   - `checkBattleStringsCapacity` (battletables.js) fails the build at the 22nd battle string
     because `push_battle_string` (engine/battleui.asm) keeps the same 8-bit `index * MSG_COLS`
     stride that `name_offset_pc` lost -- left alone as an engine change on purpose, guarded at the
     generator instead. Read the function's own header comment for the exact reasoning and do not
     contradict it.

3. **"6502 traps this codebase has already hit"**: add one entry for the stride wrap, in the
   same voice and length as its neighbours. The shape: an 8-bit multiply used as an offset into a
   table read `absolute,Y` silently wraps past 255; the fix is to add it into a 16-bit pointer and
   read `[ptr],y`. Name the regression tests: the two rpg.test.js tests that read the nametable at
   actor 26 and item 26, and `assertForcesCarry` -- look at test/unit/rpg.test.js to get the test
   names exactly right; do not guess them.

## Constraints

- Every test name, constant, function and file you mention must exist in the tree. Grep for each
  one before writing it down.
- CLAUDE.md is under a 135,000-character budget checked by test/unit/docs.test.js
  (`fs.readFileSync(..., 'utf8').length`). It is at ~123,800 now. Stay under; prefer tightening
  nearby prose over growing the file if you are near the line.
- Any `handoff-*/*.md` path you add must exist on disk and be tracked by git. Every file in
  handoff-namestride/ is tracked. Verify with `git ls-files handoff-namestride`.
- Run `node --test test/unit/docs.test.js` when done and paste the result into the report.
- Do not touch any other file. Do not commit. Do not contact reviewer. Report to
  handoff-namestride/namestride-docs-report.md: what you changed (line ranges), the docs.test.js
  output, and the final character count.
