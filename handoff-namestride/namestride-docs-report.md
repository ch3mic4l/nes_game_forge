# Report: CLAUDE.md docs pass for the name-stride slice

Scope held to CLAUDE.md only — `git status --short` shows exactly one modified file (`CLAUDE.md`),
nothing else touched.

## What changed

### 1. `BASE_BATTLE_CODE_BYTES_BY_MAPPER` passage — lines 1185-1192

Figures updated `3835/3835/3881` → `3885/3885/3931`. Extended (not replaced) the existing
saturation-fix parenthetical with a second clause covering the further +50 from the name-stride
fix, pointing at `handoff-namestride/namestride-report.md` the same way the passage already points
at `handoff-battlemath/battlemath-report.md`. The "MMC3's extra 46 bytes" sentence two lines below
(now unchanged text, still true: `3931 - 3885 = 46`) needed no edit — checked before touching
anything, per the brief.

### 2. New paragraph after the exactness paragraph — lines 1248-1260

Records that `battleTables(project, battleStrings = BATTLE_STRINGS)` and `battleTableBytes(project,
battleStrings = BATTLE_STRINGS)` both take the optional, test-only injected list, with the default
path byte-identical to before. States why *both* needed it: round 2 of review found
`battleTableBytes` still calling `battleTables(project)` with the default after `battleTables`
alone had the parameter, so an injected list's emission and the counter naming its size could
disagree. Also records `checkBattleStringsCapacity`'s own reasoning (the 22nd-`BATTLE_STRINGS`-entry
refusal, `push_battle_string`'s surviving 8-bit stride, left unfixed at the engine level on
purpose) without contradicting that function's own header comment in `battletables.js` — read
side-by-side before writing this paragraph.

### 3. New "6502 traps" entry — lines 1534-1545

One bullet, same voice/length as its neighbours: the 8-bit-multiply-as-table-offset wrap, `table,y`
addressing correctly but with a wrong `y`, the 16-bit `ptr_lo`/`ptr_hi` fix, and the two regression
tests named exactly as they appear in `test/unit/rpg.test.js` (grepped, not guessed):

- `'a monster at actor id 26 draws its own name when it attacks, and a low-index monster (one that
  also forces a carry out of ptr_lo) in the same fight still draws correctly'`
- `'an item at id 26 draws its own name in the battle ITEM list, and a low-index item in the same
  bag still draws correctly'`

plus `assertForcesCarry` (same file), and why it matters (a fixture that stopped needing the carry
could not go silently vacuous).

## Facts checked before writing (all confirmed by grep, not assumed)

```
main/build/battletables.js:433:  BASE_BATTLE_CODE_BYTES_BY_MAPPER = { 30: 3885, 1: 3885, 4: 3931 }
engine/battle.asm:534:            name_offset_pc:
main/build/battletables.js:97:   battleTables(project, battleStrings = BATTLE_STRINGS)
main/build/battletables.js:521:  battleTableBytes(project, battleStrings = BATTLE_STRINGS)
main/build/battletables.js:313:  checkBattleStringsCapacity(list = BATTLE_STRINGS)
engine/battleui.asm:657:         push_battle_string:
test/unit/rpg.test.js:2321:      function assertForcesCarry(symbolPath, label, index, stride)
test/unit/rpg.test.js:2334, 2439:  both test names, verbatim
3931 - 3885 = 46  (MMC3's extra-bytes sentence stays true, unedited)
```

`git ls-files handoff-namestride` confirms `namestride-report.md` and
`namestride-fixes-round1-report.md` (the two paths cited) are tracked.

## `node --test test/unit/docs.test.js`

```
1..10
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

All ten pass, including `'CLAUDE.md's pointer to handoff-namestride/namestride-report.md resolves
and is tracked by git'` — the pointer-discovery test found the new reference on its own and
verified it, rather than this report merely asserting it does.

## Final character count

`fs.readFileSync('CLAUDE.md', 'utf8').length` = **125,788** (was 123,191 before this pass; +2,597
chars), against the 135,000-character budget — **9,212 characters of headroom left**.

Not committed. `reviewer` was not contacted, per the brief.
