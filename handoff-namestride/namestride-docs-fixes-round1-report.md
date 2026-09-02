# Report: CLAUDE.md docs pass, fixes round 1

Scope held to CLAUDE.md only — `git status --short` shows exactly one modified file.

## 1. Hunk 2 — the backwards causality

**Before:** "The parameter is why `checkBattleStringsCapacity` (`battletables.js`) exists at all:
it refuses a build at the 22nd `BATTLE_STRINGS` entry, because `push_battle_string`
(`engine/battleui.asm`) keeps the identical 8-bit `index * MSG_COLS` stride `name_offset_pc` used
to have — deliberately left unfixed at the engine level ... and guarded at the generator instead."

**After** (lines 1255-1260): "Separately, `checkBattleStringsCapacity` (`battletables.js`) exists
because `push_battle_string` (`engine/battleui.asm`) keeps the identical 8-bit `index * MSG_COLS`
stride `name_offset_pc` used to have — deliberately left unfixed at the engine level (see that
function's own header comment for the reasoning) and guarded at the generator instead, refusing a
build at the 22nd `BATTLE_STRINGS` entry. The injected-list parameter is what lets that guard be
exercised through `battleTables`' own call site rather than only the helper called in isolation
(`test/unit/bankedbytes.test.js`), not what caused the guard to exist."

The guard is now introduced on its own terms ("Separately, ..."), and the parameter is described
as what lets it be *exercised through the emitter's own call site* — matching
`'battleTables itself refuses an over-limit strings list, not just the helper called in
isolation'` (`test/unit/bankedbytes.test.js:244`, inside the brief's cited ~233-260 range) —
rather than what caused it to exist.

## 2. Hunk 3 — the wrong entry named

**Before:** "so index 26 (`26 * 10 = 260`) came back as offset 4 — four glyphs into the entry
before it" — wrong: "the entry before it" reads as entry 25, but offset 4 is `table + 4`, inside
entry 0.

**After** (lines 1538-1541): "so index 26 (`26 * 10 = 260`) came back as offset 4 — `table + 4`,
four glyphs into the table's first entry (entry 0), so the ten-glyph read returned the last six
glyphs of entry 0 followed by the first four of entry 1, not entry 26's own name; `table,y`
addressed that offset correctly, only `y` itself was wrong."

Matches the review's own correction and the actual diagnostic in
`handoff-namestride/namestride-report.md` (the "e     Poti" / "on    I1  " wrapped-read examples,
both of which are entry-0-then-entry-1 blends, never entry-25-then-entry-26).

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

All ten pass.

## Final character count

`fs.readFileSync('CLAUDE.md', 'utf8').length` = **126,160** (was 125,788 before this round; +372
chars from making both corrections more precise), against the 135,000-character budget —
8,840 characters of headroom left.

Not committed. `reviewer` was not contacted, per the brief. No file other than CLAUDE.md touched.
