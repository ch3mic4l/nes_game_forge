# Review brief, round 2: the delta since your round-1 findings

Both round-1 findings were acted on. Review only what changed since
`handoff-namestride/namestride-review1.md`; the coder's account is
`handoff-namestride/namestride-fixes-round1-report.md`. Report to
`handoff-namestride/namestride-review2.md`. Do not edit anything. Do not contact `coder`.

## The delta

1. `battleTables(project, battleStrings = BATTLE_STRINGS)` in `main/build/battletables.js` —
   an injectable strings list that both the guard call and the two emission sites read. New test
   in `bankedbytes.test.js` drives a 22-entry list through `battleTables` itself.
2. `assertForcesCarry(symbolPath, label, index, stride)` in `test/unit/rpg.test.js` reads the
   table's address from the variant's own `game.fns` and asserts `LOW(base) + index*stride >= 256`
   before any glyph check. Low-index controls repointed: actor 3 → actor 23 ("IMP23"), item 0 →
   item 14 ("GEM14"). `buildVariant` split into `buildVariantFull` (returns `{romPath,
   symbolPath, ...}`) plus a one-line wrapper that keeps the old return shape.

## Already verified by me — do not re-do

- 932 pass / 0 skip / 0 fail.
- Sabotage A (delete `bcc`/`inc ptr_hi`): both emulator tests fail. Sabotage B (delete the
  `checkBattleStringsCapacity` call in `battleTables`): the new call-site test fails and only it.
- No engine file changed in this round; `generate.js` untouched throughout.

## What I want your eyes on

- Does the injectable parameter leave the default path byte-identical? Are there any other
  readers of `BATTLE_STRINGS` in the emit path (e.g. `battleTableBytes`, `BS_*` constant
  emission, anything computing the `bs_text` size) that still read the module constant and would
  now disagree with an injected list? Disagreement is harmless for the real build but would make
  the new test prove less than it claims.
- `assertForcesCarry`: is `parseSymbolFile`'s address for `mon_name`/`item_name` the table's base
  (not, say, a label one byte off), and is `NAME_LIMIT` the same value as the engine's `NAME_LEN`?
- The `buildVariantFull`/`buildVariant` split: any caller that now gets a different shape.
- Anything else since round 1, including anything your round-1 findings asked for that is not
  actually delivered.
