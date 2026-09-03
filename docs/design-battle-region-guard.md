# The banked battle-region `.fail` guard: what it catches, and the two escapes it cannot close

Referenced from CLAUDE.md's "The battle system" section, which keeps only the invariant: the
`.fail` in the generated `assets/code.inc` bounds where the banked battle-code region *ends up*,
not whether nesasm accepted the override that put it there, and — even combined with
`checkCapacity`'s own text-scan warning — it cannot close every escape. This document is the
verification behind that claim.

## What the `.fail` actually bounds

An override of `battle.asm` (or `battleui.asm`/`battleturn.asm`, which it includes) that is simply
too big is caught by nesasm's own per-byte bank check first — no guard placed after the content can
beat it. So the `.fail` at the end of the generated region exists for the one thing that check
cannot see: an override that *relocates* with its own `.bank`/`.org` and finishes outside the
region. Nothing trips nesasm's per-byte check there, because the bytes land in a bank with room for
them.

Verified by stripping the guard and running nesasm by hand: an override ending `.bank 1 / .org
$A000` and one ending `.bank 2 / .org $C000` both assemble with exit 0, no reported errors and a
complete ROM, with battle code silently written over screen data and over the kernel — the second
being the backward-`.org` splice CLAUDE.md's own "6502 traps" section documents. Hence two
one-directional `>` comparisons (nesasm's grammar, the same restriction `engine/main.asm`'s flash
guard works within): the condition is "did the counter finish inside this region", not "is the
content too big".

## The two escapes the guard cannot close

`.if` can see neither the current bank nor any history, so two relocations get past the `.fail`
undetected:

1. **A relocation to the same address in a different bank** lands back inside the bounds the guard
   checks, even though it is a different bank's bytes occupying that address.
2. **A relocate-write-return** — confirmed on a real build: on UNROM 512, ending an override
   `.bank 0 / .org $8000 / .db $AA,$BB,$CC,$DD / .bank 1 / .org $B000` overwrites four bytes of the
   CHR payload already emitted at bank 0, finishes tidily inside the region, and ships that
   corruption in a ROM that assembled with no error at all.

So `checkCapacity` additionally *warns* when an override of a battle-region source contains a
**token shaped like** a `.bank`/`.org` relocation (`battleRegionRelocates`) — a weaker claim than
"contains a directive", deliberately: the scan is one file's text, so it sees a label named `org`
or a `.org` inside `.if 0` and cannot see a relocation reached through `.include` or produced by a
macro at all. A text scan is not the kind of guess this codebase refuses to make about hand-written
6502 — refusing to *size* it would be; noticing its text contains something spelled `.org` is a
fact about the text — and a warning that misfires costs nothing, which is why the false positives
are kept rather than filtered. It is per *token* rather than anchored to the start of a line,
because `BANK 0`, `bt_lab .org`, `.locallab: .org` and `zz_b:.org` (nesasm needs no whitespace after
a label's colon) all relocate and an anchored match sees only the last.

Neither mechanism makes the guard complete; together they mean nothing is claimed that is not true.
The guard is emitted into the generated file rather than added to `engine/main.asm` on purpose —
`main.asm` is a stock engine file an override could replace, taking the guard with it.

## Overriding `main.asm` itself: the one case with no refusal at all

An override of `battle.asm` (or the files it includes) leaves the tables where they are, so "the
tables alone must fit" survives it — that is the bound `battleRegionBytes`/`battleRegionCeiling`
enforce, and what CLAUDE.md's "The exactness is the part worth keeping" passage is about. An
override of `main.asm` does not: `assets/code.inc` — the region's own `.bank`/`.org`, the tables,
the include of `battle.asm`, and the end-of-region `.fail` described above — reaches the ROM only
because `main.asm` includes it, so a custom main may put the tables somewhere else entirely, or
nowhere. `battleRegionPlacementOverridden` / `BATTLE_REGION_PLACEMENT_SOURCES` is the predicate for
this, separate from `battleCodeOverridden` because the two license different amounts of arithmetic.

No capacity refusal is raised at all in that case, because the tables-only bound assumes exactly the
placement the author has taken over, and refusing on it would turn away a project that fits. The
`.fail` goes with the include, so this is the one case where neither the JS check nor the assembler
backstop covers this region — the ordinary consequence of taking over the file that decides the
ROM's whole layout, not a hole in either mechanism. The meter still shows the stock-based figure,
under a hint saying which number it is — the tables half is as real as ever, and hiding the meter
would leave an RPG author with nothing.

`battleTableBytes` therefore *throws* on a directive it cannot size instead of skipping it — the
count is complete only while `.db` is the sole storage directive `battleTables` emits, which is a
property of the emit and not of the counter.
