# Review brief: CLAUDE.md docs pass for the name-stride slice (round 1)

Review only. Do not edit any file except your findings file. Do not contact coder.
Write findings to handoff-namestride/namestride-docs-review1.md.

## What to review

`git diff CLAUDE.md` -- the only modified file. It was produced from
handoff-namestride/brief-namestride-docs.md; the coder's own account is
handoff-namestride/namestride-docs-report.md. Three hunks:

1. "The battle system": `BASE_BATTLE_CODE_BYTES_BY_MAPPER` figures 3835/3835/3881 -> 3885/3885/3931,
   with a clause about the +50 name-stride fix.
2. A new paragraph after the exactness paragraph, about `battleTables`/`battleTableBytes`'s optional
   `battleStrings` parameter and `checkBattleStringsCapacity`.
3. A new "6502 traps" bullet for the 8-bit stride wrap.

## What to check

- Every claim against the tree, not against the report: main/build/battletables.js (lines ~97,
  ~305-322, ~433, ~521), engine/battle.asm `name_offset_pc` and its four callers,
  engine/battleui.asm `push_battle_string`, test/unit/rpg.test.js (`assertForcesCarry`, the two
  named tests around lines 2334 and 2439), test/unit/bankedbytes.test.js lines ~205-280.
- The orchestrator already doubts one sentence in hunk 2: "The parameter is why
  `checkBattleStringsCapacity` exists at all." Read bankedbytes.test.js ~233-260 and the
  function's header comment, and say whether the causality is right or backwards. Do not stop at
  that one; it is a pointer, not the whole review.
- Any other claim in the three hunks that a reader could be misled by: numbers, file names, which
  routine does what, what a test asserts, "wrapped past entry 25" arithmetic with NAME_LEN = 10.
- Whether the new prose contradicts anything already in CLAUDE.md (grep for `name_offset_pc`,
  `bt_tmp2`, `BASE_BATTLE_CODE_BYTES_BY_MAPPER`, `battleTableBytes`).
- Voice and length of the traps bullet against its neighbours.

Report each finding as: location (hunk + quoted phrase), what the tree actually says, and the
minimal correction. Say explicitly if you found nothing.
