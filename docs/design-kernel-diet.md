# Kernel diet: zero-page addressing — design round

**v2 — round-1 fix.** Round 1 went to review with a literal-equates-only scope and received twelve
findings (FIX verdict); every figure and claim below is re-derived against the corrected, expanded
scope. See §14 for what changed and why.

## §0. What was read (HEAD `b1ea0d4`, tree clean before and after this round)

- `CLAUDE.md`, in full.
- `engine/constants.asm`, in full — the single allocation map. Its section boundaries ("zero page"
  `:5`, "battle RAM" `:131`, the enum/flag "constants" section `:1226`) and its four non-literal
  right-hand-side shapes (`name+token` ×34, `name+name` ×2 as a sub-case of that, a bare alias ×2,
  `name*token` ×1 — machine-counted against the file, matching the orchestrator's own census
  exactly) matter directly (§2).
- `shared/enginesyms.js:1-42` — `parseEquates`'s own comment and regex, and why it does **not**
  widen for this design (§2, §8): it is shipping code with a narrower contract of its own (resolving
  RAM addresses for `testplay.js`'s pokes), not a general expression evaluator.
- `test/unit/rammap.test.js`, in full — `isRamName` (`:48`, lower_snake_case vs. `UPPER_SNAKE_CASE`,
  `OAM` the one exception), `scanEquates`/`resolveEquates` (`:201-277`, the exact four-shape grammar
  this design's resolver reuses), and the two override tests (`:417-455`) — read in full for §8.
- `renderer/emulator/core/cpu.js` — the real opcode table, `:384` (`0xb6: LDX ZPY`) and `:478`
  (`0x96: STX ZPY`), confirmed directly against the addressing-mode table in §2, and the cycle
  table entries for `LDA` (`ZP`/`ZPX`/`ABS`/`ABSX`, all four rows) used in §7.
- `main/build/generate.js:1147-1265` (`kernelCodeBytes`), `:678` (`BASE_KERNEL_CODE_BYTES_BY_MAPPER`),
  `:744`, `:766`, `:794`, `:930` (`ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE`), `:1119`
  (`KERNEL_SLACK`), `:2010` (`kernelTableBytes`), `:2090` (`checkCapacity`), `:2736-2752`
  (`assets/battle.inc` included *before* `battle.asm`).
- `main/build/battletables.js:555`, `:603`, `:613`, `:623-624`, `:633`, `:642` (`BATTLE_SLACK`),
  `:901` (`battleRegionBytes`), `:971` (`battleShortfallAdvice`).
- `engine/main.asm`, in full — the tables-then-code layout (`:40-96`ish), and, read line-by-line
  (not summarized from a comment): the two `.if * > flash_commit_driver_end / .fail` and
  `.if flash_commit_driver_end > * / .fail` pairs guarding *equality*, not a one-sided ceiling — a
  different check from `flash.asm`'s own `.if flash_commit_driver_len > FLASH_DRIVER_MAX` (§7, §9).
  The vector table (`.org $FFFA` / `.dw nmi` / `.dw reset` / `.dw irq`) writes *labels*, not literal
  addresses — their encoded byte values move with the sweep (§6).
- `renderer/emulator/testplay.js:52-75` — `REQUIRED_RAM` (resolved through `parseEquates`, values
  that never move) versus `REQUIRED_SYMBOLS` (`main_loop`, `main_loop_warp`, resolved from
  `game.fns`'s own symbol table — addresses that *do* move, harmlessly, because the lookup is
  dynamic) — confirmed as two genuinely different mechanisms, corrected from v1's conflation (§7).
- `main/build/nesasm.js:98-113` — the real exit-code-and-error-count logic. Probed directly (§3):
  nesasm exits **0** even on a fatal "Incorrect zero page address!" error; it is this file's own
  `counted` regex (`/^#\s*([1-9]\d*)\s+error/im`), not the process exit code, that makes the build
  actually fail — corrected from v1's wrong "exit code 1" claim.
- `test/unit/codehighlight.test.js:81-113` — the escape test and the full-engine round-trip test,
  confirmed to cover a `<` character exactly the way §8 needs.
- `test/unit/kernelbytes.test.js` and `test/unit/bankedbytes.test.js`, both read far more broadly
  than round 1's own `:139-316` — specifically the `AUDIO_FX_KERNEL_ALLOWANCE`/
  `STING_SFX_INTERACTION_ALLOWANCE` label-span isolation (`:2993-3037`), the Sting-and-Sfx-together
  refusal test (`:3346-3364`), the omitted MMC3 Save+Move-no-item+Sfx test (`:3186-3223`), the
  bound-tile refusal tests (`:3541-3627`), and the 46-byte MMC3 band test in `bankedbytes.test.js`
  (`:1188-1195`).
- `engine/battleui.asm:185-194` and `:394-414` — `battle_menu_item`/`build_item_list`, read directly
  to confirm they *do* contain bare zero-page sites (`bt_len`, `inv_count`), correcting v1's false
  "no bare operand" claim (§4, §9).
- `test/unit/nameentry.test.js:92-119` — the six-fixture SHA-256 gate, confirmed to be a real,
  currently-passing `npm test` gate, not a mechanism this design can simply declare inapplicable.

### Provisional measurement, this round

Every provisional figure in §4/§5 was re-measured against the *expanded* sweep (§2) applied to the
working tree and reverted (`git status --short` after revert: nothing but this file — confirmed at
the end of this round). Two additional, temporary edits were needed to get *real, buildable*
capacity numbers for §5 (rather than component-sum projections) — a scratch copy of
`main/build/generate.js` and `main/build/battletables.js` with the newly-measured ledger constants
substituted in, so that `checkCapacity` (which still carries the stale HEAD constants otherwise)
would not refuse a project pre-flight that the real, swept assembler now fits. Both files were
restored from a pre-round backup immediately after (`git status --short` confirms neither is
modified in the final state); no engine file or ledger file ships from this design round.

## §1. Recommendation at a glance

**Ship it, at the full scope.** `nesasm` v3.1 assembles a bare zero-page-valued operand as 3-byte
absolute unless the operand carries a `<` prefix, on every name that *resolves* to an address below
`$100` — whether that resolution is a literal `$hex`/decimal equate or one of `constants.asm`'s own
four expression shapes (`name+token`, `name*token`, a bare alias; §2). No file in `engine/` uses `<`
anywhere today. The full sweep touches **1431** instructions across 20 of `engine/`'s 24 `.asm`
files (up from round 1's own undercounted 1270, which missed every expression-defined zero-page
name) and shrinks every board's kernel-lo base by roughly 585-600 bytes and its banked battle
region base by roughly 435-445 bytes (§4 has the exact, measured figures).

**What this means for capacity** is now **projected from measured component deltas, and separately
confirmed against real assembled builds for eight representative scenarios** (§5) — not "measured
directly," round 1's own overclaim, since the full documented-limitations inventory was not
individually rebuilt this round. Every scenario this round did build for real — seven of CLAUDE.md's
documented refusal rows, each reconstructed from its actual test file rather than a naming-off prose
approximation, several with the fixture's own real naming state left live rather than artificially
stripped — assembles successfully, with real margins of 340-675 bytes out of the 8192-byte bank. One
synthetic maximal-stress scenario (every conditional feature this design measured, stacked at once,
naming left live) still genuinely refuses, confirming the sweep does not make `checkCapacity`
vacuous.

**Blast radius, one sentence**: every one of the exported kernel-lo and banked-region ledger
symbols in `main/build/generate.js` and `main/build/battletables.js` — **30 kernel-lo symbols plus 8
banked-region symbols, 38 total including the two slack constants** (§4's exact count, corrected
from round 1's own "39" and its imprecise "every constant moved" claim — several genuinely do not
move) — needs its value re-derived from a real build, every test that pins one of those values by
exact equality needs re-tuning to the new value, and CLAUDE.md's own "Documented limitations"
paragraph and several of its prose byte figures go stale the moment the sweep lands.

## §2. The scope rule

**Admit an instruction whose operand is a bare symbol — no `#`, no `[...]`, no arithmetic — naming
a `constants.asm` name that RESOLVES to an address below `$100`, whether that name is defined by a
literal (`name = $XX` / `name = NN`) or by one of the file's own three other equate shapes (a bare
alias, `name+token`, `name*token`) — in whichever addressing mode the 6502 actually has a zero-page
form for, per mnemonic.** Round 1 restricted the admission set to literal equates alone
(`parseEquates`'s own contract) and to a regex that admitted either index unconditionally; both were
findings. Both are fixed here.

### The resolver (finding 1)

`shared/enginesyms.js`'s `parseEquates` is **not** widened for this design — it is shipping code
(`testplay.js`'s RAM-poke resolver) with its own narrower, deliberate contract, stated in its own
comment: skip an expression rather than guess at it. Widening a shipping module's contract to serve
a design document's own one-time census would be exactly the kind of casual scope-creep CLAUDE.md's
single-writer rule warns against elsewhere. Instead, this design lifts `test/unit/rammap.test.js`'s
own `scanEquates`/`resolveEquates` — a *test-only*, already-existing, strict resolver built for
exactly this file's own grammar — into a new shared module, **`test/lib/equates.js`**, and that
module owns **three** pieces, not one (corrected this round, finding 1): the equate grammar
(`scanEquates`/`resolveEquates`, literal `$hex`/decimal, bare alias, `name+token`, `name*token`,
failing loudly — never skipping — on any right-hand side it does not recognize), the per-mnemonic
zero-page addressing-mode table (§2 below), and the bare-zero-page-instruction scanner (the
function that recognizes an admissible line and hands back enough to rewrite it). Three consumers
share it: `rammap.test.js` itself (imports `scanEquates`/`resolveEquates` only, no behavioural
change — its own `isRamName` and its own two-input scan, `constantsText` then `configText` into one
`pending` map, `:320-329`, are untouched), the new guard test (§3), and the one-off sweep script
(shipped as a real, importing consumer in the appendix — not a second, independent
implementation of any of the three pieces). This is a single-writer relationship: nothing outside
`test/lib/equates.js` defines the grammar, the mode table, or the scanner a second time.

**Machine-counted against `engine/constants.asm` at `b1ea0d4`**: 477 total resolvable equates (280 hex-literal, 160 decimal-literal, 34 `name+token` sums
— of which exactly 2 have a *name* rather than a decimal literal as the second operand, `call_ret_hi
= call_ret_lo+CALL_STACK_DEPTH` and `ent_spawn_rec = call_ret_hi+CALL_STACK_DEPTH`, `constants.asm:
232` and `:239` — 2 bare aliases, 1 product, `BOUND_BOX_FIRST_CELL = BOX_MT_ROW*16`). Of the 477,
**394 resolve below `$100`** — the 358 literal ones round 1 already found, plus 36 of the 37
non-literal ones (the sole exception, `sting_shadow_inst_base`, chains up to `$570`, well above
zero page, and is correctly excluded). Two of the 36 newly-admitted names are, like round 1's own
11 hex-form flag constants, not addresses at all — `FLASH_ARM_VALUE` (a sentinel value, `= 7`) and
`BOUND_BOX_FIRST_CELL` itself (a dimension constant, its own comment in `constants.asm` says so
explicitly: "not a RAM address itself"). Confirmed, the same way round 1 should have confirmed it
for the 11: **neither is ever used as a bare instruction operand anywhere in `engine/*.asm`** — the
same reasoning §9's first item already gives for the 11 extends cleanly to these 2.

### The addressing-mode table (finding 2)

The NMOS 6502's zero-page forms, by mnemonic — verified directly against
`renderer/emulator/core/cpu.js`'s own opcode table (`:384` `0xb6: { ins: INS_LDX, mode: ADDR_ZPY }`,
`:478` `0x96: { ins: INS_STX, mode: ADDR_ZPY }`, confirming `stx`/`ldx` *do* have a `zp,y` form,
correcting round 1's own §9 claim that `stx <name,y` has none):

| Mnemonic | `zp` | `zp,x` | `zp,y` |
|---|---|---|---|
| `bit`, `cpx`, `cpy` | yes | — | — |
| `lda`, `sta`, `adc`, `sbc`, `and`, `ora`, `eor`, `cmp`, `asl`, `lsr`, `rol`, `ror`, `inc`, `dec`, `ldy`, `sty` | yes | yes | — |
| `ldx`, `stx` | yes | — | yes |

The sweep script (appendix) carries this table verbatim and refuses to prefix an indexed operand whose
mnemonic+index combination is not in it — `sta <name,y` and `lda <name,y` (no such 6502 instruction
exists) are left exactly as-is, never miscategorized as "an addressing-mode restriction the regex
happens not to enforce" the way round 1's regex actually behaved. **Checked against the real tree,
not merely specified**: `engine/*.asm` today has **zero** instructions where a zero-page name is
indexed by `,y` at all (any mnemonic), so the table currently excludes nothing real — it exists as a
correctness guarantee for whatever a future edit adds, not because today's sweep needs it to reject
anything. Exactly four legal `,x`-indexed sites exist and are included: `lda`/`sta call_ret_lo,x`
(`engine/script.asm:250`, `:965`, round 1's own finding) and, now in scope, `lda`/`sta
call_ret_hi,x` (`:252`, `:967` — the exact sites round 1's finding 1 named as missed).

**The scanner is case-insensitive on the mnemonic and admits an optional same-line `label:` prefix
(finding 2), corrected from round 1's own scanner, which silently passed over `  LDA zp` and
`label: lda zp`** — harmless against today's tree (every mnemonic in `engine/*.asm` is lowercase and
no file puts a label and an instruction on one line, both checked directly, §2's own census above),
but a permanent guard sharing that scanner would have silently missed either shape in a future edit
rather than admitting or explicitly rejecting it. `test/lib/equates.js`'s own
`scanZeroPageInstruction` (appendix) captures every piece of original formatting — leading
whitespace, an optional label, the mnemonic's own original case, inter-token spacing, a trailing
comment — so a rewrite reproduces the line exactly except for the inserted `<`. Both forms are named
controls in the guard test (§3).

**Excluded, each checked against the real tree**:

- **Immediates, `[ptr],y`/`[ptr,x]`, `jmp`/`jsr`** — as round 1 already established; unchanged.
- **Generated `config.inc` constants** — by construction, since the resolver only ever reads
  `engine/constants.asm`.
- **A value at or above `$100`, however it resolves** — `sting_shadow_inst_base` is the one
  non-literal example on this tree today; §3 covers what happens if a `<` targets one anyway.
- **An addressing mode the mnemonic+index pair does not support** — the table above.

**Keys on the name list, not on parsing each call site's own value** — round 1's own recommendation,
now correctly reachable for expression-defined names too: `test/lib/equates.js` resolves the whole
name-to-value map once, and both the sweep and the guard test consult that map, never re-deriving an
individual value from scratch at each call site.

### Census, full scope

**1431 bare-operand instructions across 20 files**, matching the review's own independent estimate
exactly:

| File | Sites (v2, full scope) | Sites (v1, literal-only) |
|---|---:|---:|
| `battleturn.asm` | 257 | 254 |
| `battleui.asm` | 171 | 163 |
| `entities.asm` | 156 | 113 |
| `script.asm` | 99 | 77 |
| `text.asm` | 98 | 95 |
| `battle.asm` | 79 | 65 |
| `ui.asm` | 79 | 76 |
| `player.asm` | 71 | 71 |
| `combat.asm` | 65 | 59 |
| `rpg.asm` | 52 | 47 |
| `music.asm` | 51 | 39 |
| `boot.asm` | 41 | 37 |
| `save.asm` | 40 | 13 |
| `input.asm` | 38 | 38 |
| `banks.asm` | 33 | 31 |
| `nameentry.asm` | 27 | 27 |
| `title.asm` | 25 | 21 |
| `screens.asm` | 19 | 15 |
| `oam.asm` | 17 | 17 |
| `split.asm` | 13 | 12 |
| **Total** | **1431** | **1270** |

Zero already-`<`-prefixed instructions; zero same-line `label: instruction` constructs anywhere in
`engine/*.asm` (checked directly, both scopes) — the anchor ("only whitespace before the mnemonic")
stays safe.

## §3. The silent-truncation hazard, and the guard against it

**Probed directly, and corrected from round 1's own wrong claim.** A minimal two-bank stub
assembling `lda <vram_buf` (`vram_buf = $0400`, `>= $100`) prints:

```
lda <vram_buf
Incorrect zero page address!
# 1 error(s)
```

and **exits 0** — not exit 1, round 1's own error. What actually turns this into a build failure a
user sees is `main/build/nesasm.js:98-113`'s own error-count fallback (`counted =
/^#\s*([1-9]\d*)\s+error/im.exec(output)`), which this codebase already carries for exactly this
reason — CLAUDE.md's own documented nesasm quirk ("nesasm's own `#[2] file`... exits 0 anyway"),
not a new mechanism this design invented. So the assembler-plus-pipeline combination refuses a
`< $0300+`-name mistake loudly, in the normal build path, with no change needed here.

**The guard test is not there to catch what the pipeline already catches — it is there so the diet
cannot regress one instruction at a time in a later, ordinary engine edit.** `test/unit/
zeropage.test.js` (proposed name), built on `test/lib/equates.js` (§2), asserts **three**
directions, corrected and extended from round 1's own two:

- **(a) Every operand the scope rule admits carries `<`.** *Sabotage*: hand-restore one swept line
  to its bare form; the test must fail, naming the file:line.
- **(b) Every `<`-prefixed operand names a symbol that resolves below `$100`.** *Sabotage*:
  hand-edit one swept line to reference `vram_buf` (or any other `>= $100` name) instead; the test
  must fail, naming the file:line and the resolved value.
- **(c) Every `<`-prefixed operand's mnemonic+index combination is in the addressing-mode table.**
  *New this round*: *sabotage* — hand-edit a line to `sta <call_ret_lo,y` (a combination the table
  does not admit for `sta`); the test must fail, naming the file:line and the disallowed
  mnemonic+index pair.

**Controls, both directions**: an immediate (`lda #ACT_UP`), an indirect operand (`lda
[ptr_lo],y`), and `lda save_flash_buf,x` (`save_flash_buf = $0700`, `>= $100`) must all be *ignored*
by the scanner (no finding, admitted or not); a genuinely legal indexed pair must be *accepted*
— `stx <name,y` / `ldx <name,y` on a real zero-page name must not trip direction (c), the correction
finding 2 forced. **Two more named controls, both must-admit (finding 2)**: `  LDA <name` (uppercase
mnemonic) and `label: lda <name` (a same-line label) must each be recognized and correctly matched
against the symbol table and mode table — not silently skipped the way round 1's own scanner would
have skipped them.

`test/lib/equates.js`'s own resolver already fails loudly on any right-hand-side shape it does not
recognize (§2) — a future equate written in a fifth shape breaks the guard test's own setup before
it can silently miscount anything, the identical fail-closed discipline `rammap.test.js` already
holds itself to.

**The Code Forge is out of scope for this scan on purpose** — it reads the repository's own
`engine/constants.asm` directly (never a project's `build/` copy, and never an override — see §9's
note on why that distinction matters here specifically), the same "audit the stock file, not a
user's own 6502" policy CLAUDE.md already states for capacity math generally.

## §4. The ledger re-measure, in full

**30 kernel-lo exported symbols plus 8 banked-region exported symbols, 38 total including
`KERNEL_SLACK` and `BATTLE_SLACK`** (36 excluding the two slacks) — corrected from round 1's own
imprecise "39," which conflated a table-entry count with an exported-symbol count. Every one of
those 38 was checked this round; several genuinely do not move (below), which round 1's own "every
constant moved" also overstated.

**Procedure, unchanged from round 1's own validated approach**: a standalone harness reproduces
`measureCodeBytes`/`measureRegion` from the two test files, minus the assertions, driven across
every board a term applies to without stopping at the first mismatch. Re-validated this round
against the *unswept* HEAD engine before trusting it against either swept scope — every figure
reproduced CLAUDE.md's own published constant exactly, both times.

**KERNEL_SLACK and BATTLE_SLACK stay at 20 — unconditionally, a policy decision, not a measurement.**
The saving is returned to the author as usable capacity, never pocketed as slack.

### Kernel-lo

| Constant | HEAD | v2 (full scope) | Δ | Moved in v1 (literal-only)? |
|---|---:|---:|---:|---|
| `BASE_KERNEL_CODE_BYTES_BY_MAPPER[0]` (NROM) | 5952 | 5367 | −585 | yes (v1: 5381, −571) |
| `BASE_KERNEL_CODE_BYTES_BY_MAPPER[1]` (MMC1) | 6022 | 5428 | −594 | yes (v1: 5442, −580) |
| `BASE_KERNEL_CODE_BYTES_BY_MAPPER[4]` (MMC3) | 6039 | 5449 | −590 | yes (v1: 5463, −576) |
| `BASE_KERNEL_CODE_BYTES_BY_MAPPER[30]` (UNROM 512) | 6217 | 5617 | −600 | yes (v1: 5631, −586) |
| `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[1]` | 253 | 229 | −24 | yes (v1: 234, −19) |
| `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[30]` | 253 | 229 | −24 | yes (v1: 234, −19) |
| `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[4]` (excl. SPLIT interaction) | 265 | 240 | −25 | yes (v1: 245, −20) |
| `TITLE_KERNEL_ALLOWANCE_BY_MAPPER[1]` | 212 | 200 | −12 | yes, identically (v1: 200, −12) |
| `TITLE_KERNEL_ALLOWANCE_BY_MAPPER[30]` | 212 | 200 | −12 | yes, identically |
| `TITLE_KERNEL_ALLOWANCE_BY_MAPPER[4]` | 224 | 211 | −13 | yes, identically |
| `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[1]` | 514 | 470 | −44 | yes (v1: 501, −13) |
| `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[4]` | 519 | 475 | −44 | yes (v1: 506, −13) |
| `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[30]` | 686 | 640 | −46 | yes (v1: 671, −15) |
| `SAVE_BATTLE_KERNEL_ALLOWANCE` | 41 | 41 | **0** | no (v1: 41, 0) — permanent zero so far |
| `MOVE_KERNEL_ALLOWANCE` | 379 | 324 | −55 | yes (v1: 357, −22) |
| `FACE_KERNEL_ALLOWANCE` | 16 | 13 | −3 | yes (v1: 14, −2) |
| `TURN_KERNEL_ALLOWANCE` | 35 | 33 | −2 | yes (v1: 34, −1) |
| `WAIT_KERNEL_ALLOWANCE` | 48 | 43 | −5 | **no — 0 in v1, now moves** (`wt_left`, `constants.asm`, an expression-chained name only reachable via §2's expanded resolver) |
| `SHAKE_KERNEL_ALLOWANCE` | 65 | 60 | −5 | **no — 0 in v1, now moves** (`shake_left`, same reason) |
| `VISIBLE_KERNEL_ALLOWANCE` | 49 | 47 | −2 | yes (v1: 47, −2) |
| `FADE_KERNEL_ALLOWANCE` | 146 | 124 | −22 | **no — 0 in v1, now moves** (`fade_step`/`fade_target`/`fade_left`/`fade_reload`, all four expression-chained) |
| `FLASH_KERNEL_ALLOWANCE` | 98 | 91 | −7 | **no — 0 in v1, now moves** (`flash_left`) |
| `PALETTE_FX_KERNEL_ALLOWANCE` | 55 | 52 | −3 | yes (v1: 53, −2) |
| `SPLIT_KERNEL_ALLOWANCE` (MMC3) | 165 | 151 | −14 | yes (v1: 154, −11); `split_lock` (`engine/split.asm:113`, round 1's own finding-1 example) is one more expression-chained name reachable in this term |
| `ITEM_KERNEL_ALLOWANCE` + `ITEM_EFFECT...action` (combined) | 79 | 77 | −2 | yes, unchanged from v1 (individual split still not isolated — no toggle turns one on without the other; see below) |
| `ITEM_KERNEL_ALLOWANCE` + `ITEM_EFFECT...rpg` (combined) | 76 | 75 | −1 | yes, unchanged from v1 |
| `STING_KERNEL_ALLOWANCE_STANDALONE` | 172 | 166 | −6 | resolved exactly this round (below) |
| `AUDIO_FX_KERNEL_ALLOWANCE` | 15 | 15 | **0** | resolved exactly, by the existing label-span isolation (below) — genuinely, permanently unaffected: `music_channel`'s force_trig block indexes `$0300+`/`$0500+` data, never a bare zero-page operand |
| `SFX_KERNEL_ALLOWANCE_STANDALONE` | 295 | 283 | −12 | resolved exactly this round |
| `STING_SFX_INTERACTION_ALLOWANCE` | 5 | 5 | **0** | resolved exactly, by the same span isolation — `sting_restore_silence`'s nested-ownership guard is likewise data-indexed |
| `BOUND_TILE_KERNEL_ALLOWANCE` | 388 | 381 | −7 | yes (v1: 385, −3) |
| `NAME_ENTRY_KERNEL_ALLOWANCE` (N) | 115 | 107 | −8 | yes, identically (v1: 107, −8) |
| `HERO_NAMING_KERNEL_ALLOWANCE` (H) | 10 | 10 | **0** | no, unchanged both scopes |
| `JOIN_NAMING_KERNEL_ALLOWANCE` (J) | 64 | 63 | −1 | yes, identically |
| `HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE` (HT) | 15 | 14 | −1 | yes, identically |
| `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE` | 709 | 683 | −26 | resolved exactly this round (finding 5, below) |
| `HERO_DEFAULT_KERNEL_ALLOWANCE` | 11 | 11 | **0** | no, exact by construction, both scopes — five unbranching instructions, none a bare zero-page operand (`hero_name_default,y` is indexed-absolute, not zero page); the one term this design can prove is permanently untouched by inspection alone, not merely by measurement |
| `NAME_TOKEN_KERNEL_ALLOWANCE` | 58 | 55 | −3 | yes, identically |
| `KERNEL_SLACK` | 20 | 20 | 0 (policy) | — |

**Exactly one term is proved permanently zero by inspection: `HERO_DEFAULT_KERNEL_ALLOWANCE`** — its
five-instruction body (`ldy #imm`/`lda abs,y`/`sta abs,y`/`dey`/`bpl`) contains no bare zero-page
operand at all, traced to source, not merely observed unchanged. **`SAVE_BATTLE_KERNEL_ALLOWANCE`,
`HERO_NAMING_KERNEL_ALLOWANCE` (H), `AUDIO_FX_KERNEL_ALLOWANCE`, and `STING_SFX_INTERACTION_
ALLOWANCE` are each *observed* unchanged, in both scopes — not yet proven why**, and are not claimed
as inspection-proved the way `HERO_DEFAULT` is; `AUDIO_FX`/`STING_SFX_INTERACTION` have the
strongest evidence short of a full trace (the label-span isolation below shows the *growth* each
undergoes is span-identical whether the admission set is literal-only or full-scope, which is
consistent with their own code using no zero-page bare operand, but the isolation was not built to
prove that directly). `SAVE_BATTLE`'s own `.if BATTLE_ENABLED` block and `H`'s own code in
`start_game` are flagged for implementation to trace directly (§15), the same way `HERO_DEFAULT`
was traced this round. **Not every zero in the v1 (literal-only) column was an artifact of missed
expression names** — four of them (`WAIT`, `SHAKE`, `FADE`, `FLASH`) were, each traced above to a
specific newly-admitted equate, but `SAVE_BATTLE`, `H`, `AUDIO_FX`, and `STING_SFX_INTERACTION`
stayed zero in *both* scopes, which is a different fact (their own code apparently has no eligible
site under either scope) from a term the expanded scope newly reaches.

**`NAME_ENTRY_ACTION_KERNEL_ALLOWANCE` (finding 5) — resolved, not merely re-reported.** Round 1's
675-vs-683 discrepancy had a source: `kernelbytes.test.js:4020-4034`'s own triangulation computes
`actionFromTitled = deltaTitled − NAME_ENTRY_KERNEL_ALLOWANCE − HERO_NAMING_KERNEL_ALLOWANCE −
HERO_DEFAULT_KERNEL_ALLOWANCE`, and the 675 round 1 reported came from a test run against the *old*
ledger — it subtracted the *old* `N = 115`, not the corrected `N = 107`. `675 + (115 − 107) = 683`
exactly, which is what round 1's own finding predicted and this round's real re-measurement
confirms independently: `deltaTitled` (the raw, measured hero-titled-action delta) is **811** in
both the literal-only and full-scope sweeps (round 1's own nameentry.asm sweep count is unchanged,
27 sites both times, and the additional expression-defined names elsewhere in the shared naming
plumbing cancel identically on both sides of this particular subtraction — see the general
cancellation note below). Deriving in dependency order with the *corrected* subtrahends: `683 = 811
− 107 (N) − 10 (H) − 11 (HERO_DEFAULT)`. Both scopes converge on **683**, confirmed by an
independent rerun rather than assumed algebraically.

**`STING`/`SFX`/`AUDIO_FX`/`STING_SFX_INTERACTION` — fully resolved this round, no unknown left
(finding 10).** Round 1 called this a rank-3 system needing a fifth measurement; it did not need
one — `kernelbytes.test.js:2993-3037` already isolates `AUDIO_FX_KERNEL_ALLOWANCE` and
`STING_SFX_INTERACTION_ALLOWANCE` as **span DIFFERENCES**, not span lengths: `AUDIO_FX_KERNEL_
ALLOWANCE` is `spanStingOnly − spanNeither` (`:3020`, the `music_channel`..`music_channel_tick`
label span with Sting off subtracted from the same span with it on), and `STING_SFX_INTERACTION_
ALLOWANCE` is `spanBothRestore − spanStingOnlyRestore` (`:3033`, the `sting_restore_silence`..
`sting_tick` span with only Sfx added on top). Rerun against the full-scope sweep: the raw spans
themselves shrink (`music_channel`..`music_channel_tick` measures 13 bytes with neither live and 28
with Sting or Sfx live, down from HEAD's own larger absolute spans), but **both differences are
identical to HEAD** — `28 − 13 = 15` and `22 − 17 = 5` — confirming `music_channel`'s force_trig
block and `sting_restore_silence`'s ownership guard shrank by the same amount on both sides of each
subtraction, consistent with (not directly proof of — see §15) neither block containing a bare
zero-page operand of its own. With those two differences pinned exactly, `STING_KERNEL_ALLOWANCE_
STANDALONE = 181 (measured Sting-alone combined) − 15 = 166` and `SFX_KERNEL_ALLOWANCE_STANDALONE =
298 (measured Sfx-alone combined) − 15 = 283` follow directly, and the both-live combined figure
checks out exactly: `166 + 283 + 15 + 5 = 469`, matching the independently measured combined delta.

**`ITEM_KERNEL_ALLOWANCE` vs. `ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE`'s individual split** is
still reported only as a combined delta per game type — no existing project toggle turns one on
without the other, unchanged from round 1's own honest gap here.

**The general cancellation pattern, stated once rather than repeated per term (finding 9's fix,
generalized)**: several deltas above measure identically whether or not a given feature's *own* code
happens to reach any of the newly-admitted expression-defined names, **because the admitted names
are shared, unconditional code both sides of the isolating subtraction already pay for equally.**
`ITEM_LIST_FILTER_BATTLE_ALLOWANCE`'s own zero delta (below) is the clearest, checked instance:
`build_item_list`/`battle_menu_item` (`engine/battleui.asm:394-414`, `:185-194`) **do** contain
several bare zero-page sites (`bt_len`, `inv_count` — both real zero-page names, confirmed present
in both the `ITEMS_ENABLED` and `!ITEMS_ENABLED` branches of `battle_menu_item`, and in
`build_item_list`'s own unconditional prologue). The delta stays 17 not because these routines have
no swept sites — they plainly do — but because both the item-on and item-off builds already pay the
identical savings on `bt_len`/`inv_count`, which cancels in the subtraction; the *conditional* part
of the filter (`item_effect_kind`/`item_effect_amount` table reads) touches item tables, not zero
page, so it contributes nothing new to shrink either. This is the correct explanation for every
"HEAD value stayed identical between v1 and v2" row above too — `TITLE`, `ITEM` (both combined
figures), `NAME_ENTRY_ACTION`, and the naming N/H/J/HT quartet all measure identically between the
literal-only and full-scope sweeps not because their own code has no expression-defined names, but
because whatever expression-defined savings exist nearby are shared code both sides of that
specific isolation already account for equally.

### Banked battle region

| Constant | HEAD | v2 (full scope) | Δ | Moved in v1? |
|---|---:|---:|---:|---|
| `BASE_BATTLE_CODE_BYTES_BY_MAPPER[1]` (MMC1) | 4220 | 3783 | −437 | yes (v1: 3808, −412) |
| `BASE_BATTLE_CODE_BYTES_BY_MAPPER[30]` (UNROM 512) | 4220 | 3783 | −437 | yes (v1: 3808, −412) |
| `BASE_BATTLE_CODE_BYTES_BY_MAPPER[4]` (MMC3) | 4266 | 3823 | −443 | yes (v1: 3848, −418) |
| `ITEM_LIST_FILTER_BATTLE_ALLOWANCE` | 17 | 17 | **0** | no, both scopes — cancellation, not absence (above) |
| `MAGIC_POWER_BATTLE_ALLOWANCE` | 72 | 62 | −10 | yes, identically |
| `MAGIC_DEFENCE_BATTLE_ALLOWANCE` | 65 | 56 | −9 | yes, identically |
| `MONSTER_SPELL_LIST_BATTLE_ALLOWANCE` | 153 | 125 | −28 | yes, identically |
| `NAME_ENTRY_BATTLE_ALLOWANCE` | 765 | 737 | −28 | yes, identically |
| `NAME_COPY_BATTLE_ALLOWANCE` | 47 | 43 | −4 | yes, identically |
| `BATTLE_SLACK` | 20 | 20 | 0 (policy) | — |

**The MMC3-vs-MMC1/UNROM 512 band moves from 46 to 40 bytes** (`3823 − 3783 = 40`) — the exact
figure `bankedbytes.test.js:1188-1195` asserts (`baseBattleCodeBytes(mmc3) − baseBattleCodeBytes
(mmc1) === 46` today) and the exact number CLAUDE.md's own "The battle system" prose cites twice
("MMC3 spends 46 more bytes of it," "an MMC3 project over by 1 to 46 bytes fits unchanged") — both
the test's asserted constant and both CLAUDE.md sentences need to become 40.

## §4b. Test re-tuning inventory

Every test whose expected numbers or filler counts are tuned to a HEAD-era figure this design
moves, by file — verified against the source this round (not inherited from the review unchecked);
several corrections are noted inline where a citation or a claim needed fixing.

**Categories**, used below: **(R)** exact re-measurement — the pinned figure itself changes, same
assertion shape; **(M)** deliberate baseline migration — a golden hash or fixed byte reference that
must be recaptured against the new-but-still-equivalent build; **(F)** newly-fitting scenario — a
former refusal becomes a build, needing a new, still-refusing configuration to keep the advice path
under test; **(U)** unchanged constraint — a data-format, directive-count, or content boundary this
design does not touch, listed only to say so explicitly.

### `test/unit/kernelbytes.test.js`

| Lines | What it pins | Category | Action |
|---|---|---|---|
| `:422-1218` | Per-board base/Save/action/RPG/item/movement/palette matrix | R | Re-measure every input from §4; the Save+Move loop at `:1129` excludes MMC3/UNROM 512 for a capacity reason that no longer holds — include them |
| `:1226`, `:1276`, `:1303`, `:1330`, `:1347`, `:1458`, `:1543`, `:1568` | Split isolation, text-off margin, route/Turn equality, fallback bases, item effect (action/rpg) | R | Track new ledger; zero-cost/fallback invariants stay valid as invariants |
| `:1640` (80 fillers), `:1669` (210), `:1714` (100) | Move / Move+split / Save solo advice | F | Re-derive positive-deficit bands; the hardcoded 560-byte "Move+split" message (`:1698`'s own `moveAlone = MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE`, then `moveAlone + SPLIT_KERNEL_ALLOWANCE`) becomes **488 = 324 + 13 + 151** under §4 |
| `:1742`/`:1772`, `:1874`/`:1883` (52 metasprites) | Mapper suggestion + no-user-code control | F | Old deficit gone; both need a shared, newly-derived setup |
| `:1791`/`:1819` (220 empty metasprites) | Full-occupancy mapper suggestion, comparing UNROM 512 vs. MMC1 (both RPG-capable, both paying identical naming/Join terms that cancel in the diff): 195 code / 9 table / 196 deficit / 204 total saving at HEAD | F | Code saving is the RPG-base difference — `(5617 + 229) − (5428 + 229) = 189` under §4 (both boards' `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER` term is identical and cancels, so this is just the two boards' `BASE_KERNEL_CODE_BYTES_BY_MAPPER` difference: `5617 − 5428 = 189`); table saving (9, the CHR-RAM streaming tables) is untouched by this design; full saving becomes **198 = 189 + 9**. The replacement positive-deficit band is **(189, 198]** — narrower than HEAD's, so the 220-filler count needs recalibration (left to implementation) to land a deficit inside it |
| `:1921`/`:1937` (126 actors) | Withhold mapper for insufficient tileset capacity | F | Recreate the kernel deficit; the tileset-capacity premise is unrelated to this design and must stay intact |
| `:1949` (300 actors) | Generic no-feature-removal fallback | R | Large overflow persists under the new base; recheck the premise rather than assume the count still works |
| `:2045`, `:2125` (+ no-item subcase) | MMC3 Save+Move+item; UNROM 512 Save+Move (item/no-item) | F | Former refusals become fit/build assertions — confirmed by real build this round for the MMC3+item and UNROM-512-no-item rows (§5) |
| `:2238` (25 actors), `:2256` (88 actors) | Save-or-Move solo choice; both-required combination, MMC3, `MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE` and `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[4] + SAVE_BATTLE_KERNEL_ALLOWANCE` explicitly (`:2066`) | F | Re-derive; the hardcoded 395/560/955-byte messages become **337 = 324 + 13** (Move+Face), **516 = 475 + 41** (Save+SaveBattle), and **853** combined under §4 |
| `:2290` … `:2724` (eleven rows, Wait/Turn+Wait/Shake/Shake+Wait/Show-Hide/Shake+Show-Hide/Fade/Shake+Fade/Fade-with-Flash-retained/absent-Fade/absent-Flash controls) | Solo/combined saving intervals | R/F | Re-derive every interval from §4's new WAIT/SHAKE/FADE/FLASH/PALETTE_FX figures — these four terms moved the most between the literal-only and full-scope sweeps (§4's "now moves" column), so these rows are the ones most likely to need a genuinely new filler count, not just a new expected number |
| `:2752`-`:3502` (Sting/Sfx/interaction/span/drop/bound-tile) | Exact span/delta assertions | R | Keep the span-isolation shape; the historical 187 (Sting-only combined) becomes **181** |
| `:2798` (210 actors) | Sting+split dependent saving | R | Old filler count likely no longer reaches the interval; re-derive |
| `:2846`, `:3223` | MMC3 Save+Move-no-item + Sting / + Sfx | F | Both build (confirmed by real build this round, §5) — `:2846` leaves naming live (its own fixture default), `:3223` turns it off explicitly; neither deficit is CLAUDE.md's own naming-off prose figure, and the two must not be conflated |
| `:3275`, `:3290`, `:3301`, `:3312`, `:3320` (**five**, not four, Sfx refusal cases), `:3346` (Sting AND Sfx together, not Sting alone) | MMC1/MMC3/UNROM 512 Sfx refusals; MMC1 Save+Move+item with BOTH Sting and Sfx | F | All fit — `:3346` confirmed by real build this round (§5, 405 bytes free); its own advice message hardcodes 395/555-byte figures that must be re-derived from the real, current `kernelShortfallAdvice` output, not assumed |
| `:3429`, `:3466` | Existing fits controls | U | Remain fits; no change needed beyond confirming they still assemble |
| `:3541`, `:3602` | Bound-tile+Save/Move (MMC3 no-item; MMC1+item) | F | Both build (confirmed by real build this round, §5) |
| `:3663`-`:4078` | Naming/token/title/placement/absolute measurement tests | R | Re-measure in dependency order (finding 5's method); `:3970`-adjacent NROM base pin (5952) must become 5367 |
| `:3921`, `:3962`, `:4691` | UNROM 512 naming+title+Save; hero naming on the three action-save fixtures; named-Join solo advice on UNROM 512 | F | Become fits; remove the old exclusions and add fresh, still-refusing padded cases so the advice path keeps coverage |
| `:4178` | Token advice depends on a 38-byte pre-token gap on MMC1 | F | Gap closes; construct a new token-solo deficit interval |
| `:4291`-`:4717` | Counterfactual token/default savings, CHR-table/placeholder/input-row accounting, whole-bank absolute checks | R/U | Code allowances re-measure; the 3-byte CHR, 4-byte input-row, and placeholder-floor facts are data-format invariants, not code size, and must not be touched |

### `test/unit/bankedbytes.test.js`

| Lines | What it pins | Category | Action |
|---|---|---|---|
| `:321`-`:769` | Base-minus-tables, item filter, mag/mdef/spell-list deltas, combined equalities, fixture slack, full-catalog fit | R | Re-measure; keep the equality/slack rules |
| `:536`/`:540-542` | Three literal mag-only ROM SHA-256 baselines | M | Re-pin all three — not same-tree comparisons |
| `:587`, `:662` | Dynamic mag/mdef padding, fit-to-refusal | U | Loops adapt to the base automatically; rerun paired checks |
| `:819`, `:859`, `:956` | Dynamic actor growth; minimal-removal advice; no-saving-from-shorter-names | U | Loops adapt; retain bounds and the unchanged name-table-size assertion |
| `:993`/`:1020-1021` | Override fit controls (0/3000 NOPs) | U | Fit more easily now; relocation-past-boundary failure cases are unrelated to base size |
| `:1188`/`:1194` | 46-byte MMC3 band | R | Becomes **40** (§4) — the test's own asserted constant, its title, and both CLAUDE.md prose citations all change together |
| `:1275`/`:1341-1381` | `switchableMappers`' Save+Move UNROM 512 overflow scenario | F | Assumption flips — recreate genuine overflow with padding so the cross-region-rejection path stays under test |
| `:1518`-`:1967` | Override/naming/token/spell-list advice; exact spans; mixed savings; generated-tables-only overflow | R | Most arithmetic is dynamic and self-corrects; the "812-byte" naming comment becomes **780** (§4) |
| `:194`, `:240`, `:268`, `:299`, `:1081`, `:1953` | Directive counts, string addressability, relocation warning, register-source scan | U | Not code-size baselines; unaffected |

### Other files

| File | What it pins | Category | Action |
|---|---|---|---|
| `test/unit/nameentry.test.js:92-119` | Six-fixture SHA-256 gate | M | **Remains a real, currently-passing `npm test` gate — must be explicitly re-pinned as part of the ledger-update commit, not waved off as "cannot apply."** §6's own equivalence-gate replacement is what verifies the new hashes are *equivalent*, not a reason to skip re-pinning them |
| `test/unit/playerparts.test.js:398-429` | A duplicate literal `sample` ROM hash | M | Re-pin consistently with the above; ROM length (40,976 bytes) is unaffected |
| `test/unit/items.test.js:380-399`, `:551-571` | Two literal no-item/no-Save action/RPG hashes | M | Re-pin; fixed padded ROM sizes are unaffected |
| `test/unit/flash.test.js:1013-1044`, `:1077-1128` | Historical Fade routine instruction bytes, a fixed reference length, relocation offsets | M | `sta tmp2`/`sbc tmp2` shrink within the reference (both are zero-page names) — masking old offsets cannot make this pass unmodified; the reference bytes and shifted relocation positions must be recaptured for real. The already-masked NMI PPUADDR JSR address is the only part already immune |
| `test/unit/move.test.js:312-379` | Real-cost upper bound, `cost > allowance - 120`, `allowance = MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE` (`:367`) | U | Both cost and allowance become **337** (`324 + 13`) under §4, not 324 alone — the loose bound still passes without changing the literal 120 either way; exact calibration belongs in `kernelbytes.test.js`'s own delta test, not here |
| `test/unit/boundtiles.test.js:346-414` | A 100-130-actor-filler search window | F | Recovered capacity (well over 400 bytes on every board) moves the interval outside this range — re-derive the range, or search from full occupancy instead of a fixed window |
| `test/unit/library.test.js:1219-1252` | Bounded actor-filler search reaching overflow, then one monster imported | F | **The bounded search no longer reaches overflow at all** on the new base — at 255 actors (`LIMITS.actors`), the total no longer overflows the (much larger) available room. Add legal non-actor padding ahead of the actor fillers so this remains a genuine one-monster capacity-boundary test rather than a search that silently stops proving anything |
| `test/unit/flashdriver.test.js:305-346` | A 15-filler-actor test that must move both the high and low byte of the flash driver's own origin | R | The driver body is untouched (flash.asm has zero swept sites, §7), but the *code before it* shrinking changes the driver's page alignment — recheck the high-byte guard specifically and recalibrate the filler count if it no longer crosses a page; do not remove the guard |
| `test/unit/metasprite.test.js:58-59`; `test/unit/script.test.js:1007-1037`, `:2306-2321`; `test/unit/library.test.js:621-622`, `:1149` | CHR-content hash; event-page 256-byte limits; tile-slot/kernel-hi text fillers | U | Data-format/content boundaries, not swept-code sizes — no re-pin needed |
| `test/unit/fade.test.js:545-557`; `test/unit/flash.test.js:800-805`, `:876`; `test/unit/codehighlight.test.js:87-113`; `test/unit/codebuild.test.js:120-135`; routes/Move/feature-off paired-ROM tests | MMIO opcode/JSR widths, source round-trip, same-tree no-op comparisons | U | Remain valid; the PPUADDR byte needle these check is not itself a zero-page access |
| `test/unit/rammap.test.js:295-312` (`buildAndRead`, the override mechanism), `:426-455` (the `cur_map`/`ent_spawn_rec` colliding-override test) | A `constants.asm` Code Forge override reassigning `cur_map` onto `ent_spawn_rec`'s own address, which must still assemble and must still be caught as a RAM-map collision | U, once `scanEquates`/`resolveEquates` are lifted into `test/lib/equates.js` | Explicitly requested for this inventory (finding 4). Both names resolve well under `$100` before and after this design, so the override neither triggers nor tests the `>= $100` truncation hazard (§8) — this row is about the resolver lift's own behavioural neutrality, not about the sweep. After the lift, this test must keep passing unchanged: it must still assemble (the override is a semantic collision, not a syntax error) and `auditRamMap` must still throw naming the collision — `isRamName` and the two-input scan stay in `rammap.test.js` itself, so nothing about this test's own logic should need to change, only its resolver functions' import source |

**What this inventory is not**: a claim that every row's new number has been computed and verified
this round. It is the map of *which* tests need touching and *what kind* of touch each needs — the
real re-derivation for the R/F rows is implementation work, per §11.

## §5. The documented limitations

**Every row below was reconstructed from its actual test-file constructor** (not a naming-off prose
approximation) and **checked with a real build against the full v2 sweep and the correspondingly
patched ledger constants** — not a component-sum projection. Naming/title/item/audio state is
stated explicitly per row, since it is not uniform across these tests (finding 6).

Every one of these scenarios includes a live Save command, which `validateProject` refuses without
a title screen — so every cited constructor sets `project.project.titleMap = 0` /
`titleScreen = 0` explicitly (verified per row against the source, not assumed from the Save
requirement alone); **title is "on" for every row in this table**, so it is not repeated as its own
column.

| Scenario | Naming state | Real build result (v2 sweep + patched ledger) |
|---|---|---|
| MMC3, Save+Move+1 item, naming OFF (`kernelbytes.test.js:2045` — this constructor explicitly sets both `renamable` flags false at `:2053-2054`; CLAUDE.md's own "90 short" clean baseline) | off | **Builds.** 7517/8192 used, 675 bytes free |
| The identical scenario with naming left AS `sample-rpg` ships — an additional variant this round constructed itself, with no direct test citation (corrected from round 1, which wrongly attributed this variant to `:2045`) | hero+Join live | **Builds.** 7701/8192 used, 491 bytes free |
| UNROM 512, Save+Move, no item, naming off (`:2126`) | off | **Builds.** 7608/8192 used, 584 bytes free |
| MMC3, Save+Move, no item + live Sting, naming AS SHIPPED (`:2846` — this constructor does not touch `renamable` at all, so `sample-rpg`'s own default naming stays live) | hero+Join live | **Builds.** 7804/8192 used, 388 bytes free |
| MMC3, Save+Move, no item + live Sfx, naming off (`:3223`, omitted from round 1's table — this constructor explicitly disables both `renamable` flags) | off | **Builds.** 7737/8192 used, 455 bytes free |
| MMC3, Save+Move, no item + a bound tile, naming off (`:3541`) | off | **Builds.** 7852/8192 used, 340 bytes free |
| MMC1, Save+Move+item + a bound tile, naming off (`:3602`) | off | **Builds.** 7731/8192 used, 461 bytes free |
| MMC1, Save+Move+item + **Sting AND Sfx together** (`:3346` — round 1 mislabeled this "Sting alone"), naming off | off | **Builds.** 7787/8192 used, 405 bytes free |

**Every real build attempted this round succeeds.** This is not the complete inventory of CLAUDE.md's
own documented-limitation rows (twelve distinct scenarios by the review's own count, not eleven —
finding 6's correction, `:3223` being the one round 1's table dropped entirely) — the remaining rows
follow the identical `kernelTableBytes`/real-nesasm-build method and are implementation work (§11),
not re-derived here.

**The synthetic maximal-stress control (§10) genuinely still refuses**, confirmed the same way: a
titled MMC3 `sample-rpg` with naming left live, every one of Save/Move/Turn/Wait/Shake/Visible/
Fade/Flash/Sting/Sfx/a bound tile/its one item all live at once fails `checkCapacity`'s own
pre-flight check under the patched v2 ledger, reporting a real, still-negative kernel-lo free figure
— not vacuously, since seven distinct real scenarios above already prove the ledger is not simply
refusing everything.

**What CLAUDE.md's own prose becomes**: the "Documented limitations" paragraph under "The kernel
budget" needs a rewrite once the *complete* inventory (not just these eight) is confirmed to close —
implementation's job, not this design's. The battle-system prose citing the 46-byte MMC3 band (§4b)
needs the same treatment as its own test.

## §6. Behavioural-equivalence gate

The six-fixture SHA-256 gate (`test/unit/nameentry.test.js:92-119`) **is a real, currently-passing
`npm test` gate and stays one** — round 1's "cannot apply" framing was wrong to suggest it could be
waved off; every one of its six hashes moves and must be **explicitly re-pinned**, the same way
`playerparts.test.js` (one hash) and `items.test.js` (two: `PINNED_BASELINE_HASH` and
`PINNED_RPG_BASELINE_HASH`) — three hashes total across those two files — must be. What genuinely
changes is what *proves the re-pin is to an equivalent ROM*, since byte-identity itself can no
longer be that proof.

**(a) The full existing test suite, for real, plus every Mesen Lua check** — `npm test` with 0
skipped, `npm run smoke`, `engine_smoke.lua`, `run_sram_check.sh` (with and without
`--break=mmc3-a001`), `run_flash_check.sh` (with and without `--break=u512-no-erase`),
`run_bound_tile_nmi_check.sh`, and `run_flash_nmi_check.sh`. Mesen is at `~/Downloads/Mesen2`, not on
`PATH`. None of this ran in this design round (no engine edit ships from a design round); this is a
directive for implementation.

**(b) A structural check — corrected this round to allow relocation rather than asserting raw
address equality (finding 3), since round 1's own "no label moves" claim is false whenever an
instruction *before* a label is removed.** `engine/main.asm`'s own layout (`:40-96`ish) is tables,
then code, in that order — everything before `reset` (the kernel-lo lookup tables) keeps its
address unconditionally, since nothing this design touches precedes it. Past `reset`, code shrinks,
so later labels move — the correct comparison is label **identity and order**, not address:

1. **`game.fns` carries the identical label SET, in the identical ORDER**, pre- and post-sweep, in
   every bank.
2. **Scoped to the kernel-lo bank specifically** (the banked region's own pre-code table labels are
   covered by rule 3's second bullet instead, in that bank's own address space): **every label
   before `reset`, and `reset` itself, sits at an identical address.** Every later kernel-lo code
   label sits at an address **less than or equal to** its old one — never greater, since the sweep
   only removes bytes.
3. **Whole-ROM byte EQUALITY is required OUTSIDE the union of three masks** — corrected this round
   from an inverted first draft that would have compared bytes only *inside* the changed regions
   (where they are legitimately different) rather than requiring identity everywhere *else* (where a
   mutation this check exists to catch, such as a shifted table byte, would otherwise go unseen).
   The three masks, each excluded from the equality requirement and covered instead by rules 1/2 or
   the vector rule below:
   - **Kernel-lo code**: from `reset` through the union of the old and new build's own code extents
     (so a byte that used to hold real code and now holds only unreached padding is correctly
     excluded, not flagged as a false mismatch).
   - **Banked battle code**: from `battle.asm`'s own first label through the region end.
     `assets/battle.inc` is `.include`d *before* `battle.asm` (`main/build/generate.js:2736-2749`),
     so the region's own tables sit at fixed, unmoved offsets *before* this mask begins and are
     therefore covered by the equality requirement like any other table, not excluded from it.
   - **The six vector bytes at `$FFFA-$FFFF`**: excluded from the flat equality check and validated
     separately — `nmi`/`irq`'s own two vector entries against each build's own `game.fns` symbol
     for that label (their addresses move with the code around them), while `reset`'s own vector
     bytes are *not* excluded from equality, since `reset` itself is pinned by rule 2.

   **How the mask endpoints and bank-relative ROM offsets are obtained**: `game.fns` gives each
   label's CPU address (e.g. `reset = $C123`); `shared/cartridge.js`'s `prgLayout(mapper)` gives
   `kernelLoBank`/`kernelHiBank` (the nesasm bank numbers mapped at `$C000`/`$E000`), and
   `codeRegions(mapper, tilesetCount, bankedCode)` gives the banked region's own `{nesasmBank, org}`
   (`org` is `$8000` or `$A000`). A label's ROM file offset is `16 (the iNES header) + nesasmBank ×
   8192 + (labelAddress − bankOrg)` — the identical arithmetic `measureCodeBytes`'s own `resetAddr
   − 0xc000` subtraction already performs for the kernel-lo case (§4's own harness), generalized to
   whichever bank a given label's mask needs. This gives every mask's **start** (`reset`'s own
   converted address for the kernel-lo mask; `battle.asm`'s own first label's converted address for
   the banked mask) — **corrected this round (round-3 finding 2): the kernel-lo mask's own upper
   endpoint was left unspecified**, and `game.fns` cannot supply it (it lists labels, not the byte
   length of the instructions after the last one).

   **The kernel-lo mask's upper endpoint is nesasm's own reported used-byte count for that build**,
   parsed exactly the way `test/unit/kernelbytes.test.js:257` already does from nesasm's own
   segment-usage table (`"BANK  62   7182/1010"`, the first number): `16 + kernelLoBank × 8192 +
   used`. `used` is measured **independently from each build** (the pre-sweep and the post-sweep
   ROM each report their own real figure), and the mask's actual end is the **maximum of the two** —
   so a byte that held real content in the larger (pre-sweep) build but now sits past the smaller
   (post-sweep) build's own `used` count is still inside the mask (correctly excluded as former
   code now unreached, per bullet 1's own reasoning), while nothing beyond either build's real
   content is ever masked away un-scrutinized. The **banked battle region's** own mask end is
   simpler, and does not need this same "used" figure: since `battle.asm` plus its own tables are
   the region's *only* occupant (no other content shares that bank), its mask runs to the whole
   region's own end, `16 + (nesasmBank + 1) × 8192` — with **no battle mask at all for a fixture
   that has no battle region** (an action project, where `codeRegions` returns nothing). Every
   other generated pointer table (screen/metasprite/animation pointers, `generate.js:3254-3266`/
   `:3451-3470`; SAVE field pointers, `:3107-3109`; music/Sfx pointers, `songcompile.js:173-201`/
   `:302-307`) targets unchanged data or RAM, confirmed by reading each site, and needs no mask of
   its own — the flat equality check already covers the table bytes those pointers point *into*,
   and the pointers' own bytes sit outside every masked region.

   **Rule 2's non-increasing-address check applies to the banked region's own later code labels
   too, not only kernel-lo's** — stated explicitly this round: any code label past `battle.asm`'s
   own first label must sit at an address less than or equal to its old one, the identical
   reasoning rule 2 already gives for kernel-lo, in that bank's own address space.

**A ONE-TIME acceptance step, not a permanent test (findings 3/9's correction).** Round 1 proposed
this as a permanent fixture. There is no reproducible baseline for a *permanent* version of this
check to compare against on every future run — two builds of whatever the tree happens to be at any
later point would pass the identity portion vacuously, proving nothing about *this* diet.
Implementation runs it once, comparing a pre-sweep build (from a real checkout of `b1ea0d4`, not an
assumed historical artifact) against the post-sweep build of the same six fixtures, as the round's
own acceptance gate — a one-off, not a fixture this repository carries forward. A concrete mutation
that this one-time check would catch, named so its own teardown criterion is unambiguous: an edit
that accidentally shifts a byte inside `assets/battle.inc`'s own table region (before `battle.asm`'s
first label) — rule 3's fixed-offset promise for that region would fail immediately, distinguishing
a genuine table corruption from a harmless code relocation.

**The source guard for the *permanent* guard test (§3) reads `engine/constants.asm` directly, not a
build copy** (finding 9) — `shared/enginesyms.js`'s own comment already explains why a *shipping*
consumer reads the build-matched copy (Code Forge overrides), but this guard's job is auditing the
*stock* engine's own source against itself, so reading the repository file directly, paired with
the resolver from `test/lib/equates.js` reading the identical file, is the correct and simpler
choice — no override, no build, no staleness question.

## §7. Cycle-timing side effects, enumerated

**Qualified by addressing mode, not claimed uniform (finding 7), and corrected again this round for
the four `call_ret_lo`/`call_ret_hi,x` sites specifically (finding 6).** Zero-page addressing is one
cycle faster than absolute for every *load/store/read-modify-write* mode this sweep touches (`lda
<name` is 3 cycles vs. `lda name`'s 4; `inc <name` is 5 vs. 6) — but **not every swept site is
actually replacing an absolute-non-indexed access, and the four `,x`-indexed sites do not even agree
with each other**: `renderer/emulator/core/cpu.js`'s own static cycle table gives `LDA ABSX`
(`0xbd`) 4 cycles, identical to `LDA ZPX`'s (`0xb5`) 4 — so the two `lda call_ret_lo,x` / `lda
call_ret_hi,x` sites (`engine/script.asm:250`, `:252`) save a byte and **zero cycles**. `STA ABSX`
(`0x9d`) is 5 cycles, one more than `STA ZPX`'s (`0x95`) 4 — so the two `sta call_ret_lo,x` / `sta
call_ret_hi,x` sites (`:965`, `:967`) save a byte **and one cycle each**, unlike their load
siblings. `X` ranges 0-3 here (`CALL_STACK_DEPTH = 4`, `:248-249`/`:957-965`), which is what keeps
every one of the four clear of a page boundary regardless. Byte savings are one each, all four
sites, regardless of the cycle difference.

**Relocation can change more than the instructions it directly touches — page-cross and
taken-branch penalties are not monotonic under a byte-shrinking edit** (`cpu.js:940-958`,
`:2536-2557` for the dynamic penalty logic), and OAM DMA timing depends on CPU cycle parity
(`renderer/emulator/core/ppu/index.js:1118-1126`). **This design does not claim, and withdraws round
1's claim, that total path timing cannot regress merely because most individual operands get
faster.** The actual proof obligation is the tests, not the arithmetic:

- **`test/unit/split.test.js`'s own row probes check tile ROWS, not scanlines, and the box below
  the split is the naming grid, not battle art** — corrected this round (finding 6): `probeRows`
  (`:343-356`) asserts tile row 23 (the last row above the box) still reads `'art'` — "the map's own
  art bank," not specifically battle art — and tile rows 24-28 read `'font'`, each one labeled "the
  naming grid's own box" in the test's own assertion messages, called from the hero-naming/Join-
  naming/action-placement scenarios (`:374`, `:410`, `:429`). These probes must be rerun against the
  post-sweep ROM and must still pass at the same rows.
- **`test/lua/engine_smoke.lua` asserts nothing about the split at all** — corrected this round
  (finding 6): a full read finds no scanline, CHR-bank, or font-related assertion anywhere in the
  file; it is a boot/movement/collision/screen-transition/naming smoke test. Running it on
  `sample-mmc3` under real Mesen (§6) stays a required directive — it is still useful as a general
  "does this ROM even work" check on the one board this design's split logic touches — but it must
  not be presented as verifying the split's own timing boundary, which no assertion in this file
  checks.
- **Both NMI-timing Lua checks** (`flash_nmi_timing.lua.template`, `bound_tile_nmi_timing.lua.
  template`) contain workload/equality guards and a vblank-interval check, **not only a maximum**
  (confirmed by reading `flash_nmi_timing.lua.template:174-211`/`:254-265` and the bound-tile
  counterpart `:167-207`/`:239-250`) — round 1's "every deadline is one-sided" claim was too broad;
  these two specifically assert workload correctness as well as timing, and both must be rerun, not
  assumed safe from a one-sided argument alone.

**The MMC3 scanline-IRQ counter itself is A12-clocked (PPU-timed) — that bounds the COUNTER, not
the CPU's own register write (finding 6's correction).** A faster CPU cannot change which A12 edge
the hardware counter reaches zero on, or what programmed value it was armed with — that part of
round 1's argument survives. But `engine/split.asm:141-163` performs the actual CHR switch and the
next rearm **in CPU code**, in sequence: `sta $8001` (`:155`, the CHR bank switch itself) is
followed by `inx`/`inx`/`stx split_idx` (advancing to the next split entry) and then, only if a
next entry exists this frame, `sta $C000` / `sta $C001` / `sta $E001` (`:161-163`, the reload latch,
the reload trigger, and the IRQ enable — together, the rearm for the *next* counter clock). Handler
latency (the delay between the counter's own IRQ firing and the CPU instruction stream actually
executing these writes) is a separate quantity this design has not measured and cannot bound by an
A12 argument alone.

**Corrected this round (round 3 finding 1): a trace that records only the `$8001` switch cannot
show the rearm's own placement, and comparing two `$8001` timestamps alone has no stated pass
condition** — some scanline/dot difference between the pre- and post-sweep ROM is *expected* (§7's
own point throughout), so a bare timestamp comparison would not distinguish a harmless shift from a
real problem. The proposed instrumentation is extended to cover the whole sequence, with a real pass
condition, in two separated uses:

- **The instrumentation itself**: a wrapper around the mapper's own write path
  (`renderer/emulator/core/mappers/mapper4.js`'s `write`, confirmed directly: register writes are
  handled by an `address & 0xe001` switch whose cases include `$8000`/`$8001`/`$c000`/`$c001`/
  `$e000`/`$e001`, `:39-96`) records, per event: the frame number, `nes.ppu.scanline`/`nes.ppu.curX`
  at the moment of the write (confirmed safe to read there: `renderer/emulator/core/cpu.js:2422`
  calls `this.nes.mmap.write(addr, val)` *before* `this.nes.ppu.advanceDots(3)` for any address
  `>= $8000`, so the PPU state read inside the mapper's own `write` reflects the instant of the bus
  write, not a state already advanced by it), the address, the value, and — for a `$8001` write
  specifically — the command last selected through the preceding `$8000` write (`this.command`,
  confirmed set at mapper4.js's own `$8000` case), so a CHR bank switch (`R1`, this engine's own
  target) is told apart from a PRG-bank `$8001` write the same register services. A second, narrow
  wrapper around `clockIrqCounter` (`mapper4.js:228`, confirmed: reloads from the latch when the
  counter is zero or a reload is pending, decrements otherwise, and requests the IRQ when it reaches
  zero with the line enabled) records each counter clock the identical way, so a reload/enable
  event can be related to the specific clock it was meant to arm for.
- **A permanent, baseline-free invariant, its own deadline anchored independently of the arm it is
  checking (`split.test.js`, corrected this round — round-4 finding 2)**: naively looking for "the
  next counter clock after the entry's own `$E001` write" is circular — a late rearm would simply
  find whatever clock came after it and call that the intended one, passing by construction. It is
  also unsound for a different, source-confirmed reason: `mapper4.js`'s own `clockIrqCounter`
  comment (`:223-227`) states the counter **runs whether or not the IRQ is enabled** — `$E000` only
  gates the interrupt *line*, never the counter itself — so a clock that occurs while an entry is
  still mid-arm silently consumes one of the counter's own counts (or a reload) with no IRQ fired
  and no trace of having happened, which "find the next clock after the rearm" can never see. The
  deadline is instead **derived from the split program's own schedule, never from when the rearm
  was observed to complete**:
  - **The first entry, armed by NMI**: the deadline is the frame's first counter clock after the
    vblank arm window (`split_arm`, `engine/split.asm:98-124` — the counter cannot fire before
    rendering, hence before this window, per that routine's own header comment).
  - **Each follow-up entry**: the deadline is the first counter clock *after the clock that asserted
    the preceding entry's own IRQ* — not the first clock after that entry's `$E001` write, and not
    the first clock after the handler returns.
  - **Expected entries are read off the active split program itself**
    (`split_progs`/`split_prog_box`/`split_prog_battle`/`split_prog_title`, `engine/split.asm:51-69`
    — `split_prog_title` in particular is the multi-entry case, four real entries before its own
    zero terminator), **with the zero terminator explicitly exempt** — it ends the frame's program
    and arms nothing.
  - **A `split_lock`-held frame is its own explicit case, not a missing arm**: `split_arm`'s own
    guard (`:112-115`, `lda split_lock` / `beq split_arm_unlocked` / `rts`) skips the whole frame's
    arm on purpose when `switch_prg_bank` holds the lock — the invariant must expect **no** arm at
    all on such a frame, not flag the absence as a failure.
  - **The check itself**: for every expected entry, its own `$C000`/`$C001`/`$E001` sequence must
    complete *before* its independently-anchored deadline clock — the rearm is never late.
  - **Negative control, to prove the invariant actually distinguishes late from on-time**: delay a
    follow-up rearm until just after its own intended clock and confirm the test fails. Implemented
    as a scratch build of `split.asm` with an added delay (a short spin loop between the `$8001`
    switch and the `$C000`/`$C001`/`$E001` rearm, `:155-161`) rather than an emulator-side artificial
    delay — a source-level delay exercises the real instruction stream the invariant is meant to
    police, where an emulator-side delay would only prove the *test harness* can detect a delay it
    injected itself.
  This invariant holds or fails regardless of whether this sweep ever ships — a real correctness
  property of `split.asm` itself, not a pre/post-sweep comparison — so it needs no baseline.
- **A one-time acceptance check (§6 family), over a NORMALIZED register-operation projection, not
  raw values (corrected this round — round-4 finding 1)**: the raw trace (address, value, frame,
  scanline, dot, and — for `$8001` — the preceding `$8000` command) is kept in full as the
  diagnostic record, but the **sequence comparison** is taken over a projection that keeps only
  what is semantically meaningful and normalizes the rest: `$C000`'s own latch value and
  `$8000`/`$8001`'s own select/bank values are preserved, while `$E000`, `$C001`, and `$E001`'s
  data bytes are each replaced with one fixed sentinel, since none of the three ever reads its own
  value — confirmed directly: `mapper4.js`'s own `case 0xc001`/`case 0xe000`/`case 0xe001` (`:84`,
  `:89`, `:94`) each ignore the `value` parameter entirely, and `split.asm`'s own `sta $E000` inside
  the IRQ handler (`:138-140`) carries whatever the interrupted instruction happened to leave in the
  accumulator, labeled "value irrelevant" in the source itself — a timing shift that interrupts a
  different instruction changes that byte with no behavioral difference at all, and raw-value
  equality would reject that harmless case. **Counter-clock events are excluded from this sequence
  comparison entirely** — they are what the permanent invariant above consumes, not part of the
  one-time projection. Scanline and dot stay excluded, as before, but **not because faster code can
  only ever land earlier** — that claim is deleted this round; it contradicts this same document's
  own page-cross/taken-branch/DMA qualification (§7, above) that total path timing is not
  monotonic. Scanline/dot are excluded because the projection's whole point is to compare *which*
  registers get written, in *what order*, with *what meaningful values* — not *when*.
  **Frame selection**: the title frame and the message-box frame must each be a complete, *settled*
  frame — the same logical state in both builds, not a transition frame that could pick up
  one-time transition-animation content instead of the split's own steady-state behavior.
  "Settled" is determined the same way `testplay.js` already reads engine state: poll `game_state`
  (`constants.asm:51`) for `ST_TITLE` and, separately, `box_state` (`:104`) past `BOX_OPENING`
  into its fully-open value, then advance a further, fixed number of frames past that point before
  capturing the trace — enough to clear any one-time box-raise or title-fade animation. The exact
  frame count is an implementation calibration, not a value this design pins.

Both uses are distinct from, and do not replace, the tile-row probes (`split.test.js`'s own
`probeRows`) or the required Mesen directives (`engine_smoke.lua`, both NMI-timing Lua checks) —
this trace is a third, independent kind of evidence, not a substitute for either.

**Music/SFX comparisons are per-frame, which is a coverage limit in one direction and real evidence
in the other (finding 6's correction, tightened again this round).** `music.test.js:521-565`/
`sfx.test.js:180-217`'s real APU-write format is **arrays of `[address, value]` per frame** —
round 1's `{frame, value}` description was the *separate* `cur_song` trace, a different, smaller
instrument, not the APU register trace itself. A per-frame comparison **cannot** see a write that
moved a few cycles within the same frame (no intra-frame timestamp exists to compare) — but it
**can** see a write that moved across a frame boundary: such a write would show up in a *different*
frame's own array than before, and a test asserting per-frame equality against a golden reference
would fail on exactly that mismatch (`music.test.js:541`, `sfx.test.js:180`, both confirmed by
reading the trace-building code directly, §0). This design does not claim its own byte-shrinking
causes a frame-boundary crossing, and has not proven one absent either — the honest position is
that the per-frame tests are a real, if partial, check for this specific failure mode, not a blind
spot for it.

**`renderer/emulator/testplay.js:52-75`'s own two mechanisms are genuinely different, and both are
safe, for different reasons (correcting round 1's conflation).** `REQUIRED_RAM` resolves through
`parseEquates` against `constants.asm` — values that never move, regardless of this design.
`REQUIRED_SYMBOLS` (`main_loop`, `main_loop_warp`) resolves against `game.fns`'s own symbol table —
addresses that *do* move, but harmlessly, because the poke mechanism looks the symbol up fresh
against whichever build it is handed, never a literal cached address.

**`main.asm:79-86`'s own `.if * > flash_commit_driver_end / .fail` and `.if
flash_commit_driver_end > * / .fail` pair enforces EQUALITY, not a one-sided "more room" bound**
(correcting round 1's conflation of this with `flash.asm`'s own, genuinely one-sided, `.if
flash_commit_driver_len > FLASH_DRIVER_MAX` ceiling check) — it guards that nothing was appended
after the flash driver's own body before `save.asm` is included. **The location counter's absolute
value at this point is NOT identical before and after** — every file assembled earlier in
`main.asm`'s own inclusion order (`boot.asm` through `title.asm`/`rpg.asm`, `:44-66`) has swept
sites and shrinks, so `*` at this exact point in the file sits at a lower absolute address
post-sweep. What stays true is that `*` and `flash_commit_driver_end` **move together**: both are
offsets from the same shrunk starting point, and `flash.asm` itself has zero swept sites (§9), so
the *relative* distance between them — which is what this check actually compares — is unchanged,
and the check keeps passing for that reason, not because either value is literally unaffected.

## §8. The Code Forge

**A stock source override generally keeps its own encodings and remains valid — but a
`constants.asm` override specifically is not unconditionally safe (finding 8, correcting round 1's
blanket claim).** Symbol *names* and stock RAM *allocations* are stable across this design; an old
override of `battle.asm` (say) taken before this diet shipped simply keeps its own pre-diet absolute
encodings, exactly as round 1 said. But a **`constants.asm` override that moves a stock zero-page
name to `>= $100`** breaks every *stock* consumer that now references that name with `<` — probed
directly this round: the identical `<wide` truncation-hazard build failure from §3 fires, at
assemble time, with the identical "Incorrect zero page address!" message, for a stock file trying to
`<`-address a name an override just relocated out of zero page. This is not a new instability this
design introduces so much as a new *consequence* of one: a `constants.asm` override always had to
preserve every stock consumer's expectations about a name's value; after this diet, "preserve the
value" additionally means "preserve zero-page placement," for every name any stock file now
addresses with `<`.

**Checked against the one existing `constants.asm` override test in this codebase**
(`test/unit/rammap.test.js:426-455`): it reintroduces a RAM *collision* (`cur_map` aliased onto
`ent_spawn_rec`'s own address) to prove the guard reads the override, not the stock file — and both
names involved resolve well under `$100` either way, so this specific existing test does **not**
exercise the `>= $100` hazard this design's own change introduces. No representative override test
of that shape exists in this codebase today; implementation should add one (a `constants.asm`
override moving a stock zero-page name like `player_x` to, say, `$0400`, confirming the stock
consumer's own `<` now fails loudly rather than silently) alongside the zero-page guard test itself.

**`kernelCodeBytes` measures stock code — unchanged policy**, and **`highlight.js` should still not
give `<` a token class of its own**: `tokenizeLine`'s fallback `punct` bucket (`renderer/forges/
code/highlight.js:153-177`, confirmed directly) already escapes `<` correctly, and
`test/unit/codehighlight.test.js:81-113`'s existing escape test plus its full-engine round-trip test
already cover it — no change recommended.

## §9. What could go wrong

1. **Names that resolve below `$100` but are not addresses at all.** This is the general case round
   1 first found a slice of (11 hex-literal bitmask/sentinel constants) and this design's own §2
   flagged 2 more of (`FLASH_ARM_VALUE`, `BOUND_BOX_FIRST_CELL`) — but the real, complete count is
   much larger. Using `test/unit/rammap.test.js`'s own `isRamName` rule (a name is a RAM address iff
   it starts lowercase, plus the one deliberate exception `OAM`), **232 of the 394 zero-page-
   resolving names are NOT RAM addresses at all** — enum, flag, and count constants, most written in
   `UPPER_SNAKE_CASE` for exactly that reason. Re-running the "never used as a bare operand" census
   over the full 232, not just the 13 named above: **all 232 are confirmed, by exhaustive census,
   never used as a bare instruction operand anywhere in `engine/*.asm` today.** The admission rule is
   safe on this tree because nothing currently misuses one of these names this way, not because the
   rule itself would catch the mistake if something did. A future `lda BTN_A` intending `#BTN_A` is
   a pre-existing authoring-mistake shape this design neither creates nor worsens: the read would
   already be wrong (zero-page address `$80`) with or without `<`.
2. **The sweep matching inside a comment or a `.db` string.** The anchor requires the line's first
   non-whitespace token to *be* the mnemonic; no directive (`.db`, `.dw`, `.byte`) is one of the
   admitted mnemonics, and a comment line starts with `;`. Verified empirically too: rebuilding all
   six fixtures under the full-scope sweep produced byte-identical CHR, music, text, and screen
   data.
3. **A label sharing a name with a zero-page equate.** Already a hard nesasm build error today,
   independent of this design.
4. **A `,y`-indexed store or load on a mnemonic that has no such mode** (`sta`/`lda`/five others) —
   nesasm refuses outright; the addressing-mode table (§2) never generates one regardless. `stx
   <name,y`/`ldx <name,y` **are** legal and correctly generated where they occur (none do, today).
5. **`flash.asm`'s own two `.if`/`.fail` checks (§7)** — both confirmed safe; the file has zero
   swept sites.
6. **nesasm's 30-character label limit** — irrelevant; this sweep renames nothing.
7. **A `constants.asm` override moving a stock zero-page name out of zero page (§8)** — the one
   genuinely new failure mode this design introduces, now stated and probed rather than assumed
   away.

## §10. Test plan

1. **`test/unit/zeropage.test.js`** (§3): three directions, each with its own sabotage, plus the
   ignored-forms and legal-indexed-forms controls.
2. **The re-measure** (§4, §4b): every one of the 36 non-slack ledger constants re-derived from a
   real build via the existing tests' own machinery, re-tuned per the §4b inventory.
3. **The equivalence gate** (§6): the full suite plus all five Mesen Lua checks, all passing, 0
   skipped; the one-time structural acceptance step.
4. **Proof the saving is real: real builds, not projections (finding 6's correction).** Seven of
   CLAUDE.md's documented refusal rows plus the naming-off clean baseline were rebuilt for real
   against the patched v2 ledger this round (§5), each labeled by its actual naming/item/audio
   state — **not** the "smallest HEAD deficit" reasoning round 1 used to justify picking one row (a
   *smaller* old deficit is closed *more* easily by a fixed saving, so it was never the tightest
   choice — round 1's own inversion, corrected here by simply testing every row directly instead of
   picking one by intuition).
5. **The still-refuses control** (§10 of round 1, reconfirmed this round): the synthetic
   maximal-stress MMC3 scenario, naming left live, every measured conditional feature stacked at
   once, genuinely still refuses under the patched v2 ledger — confirmed by a real build attempt,
   not merely restated.

## §11. Phasing

**One phase**, the dependency argument kept, the overclaim removed (finding 12). Updating an
allowance without its corresponding code edit would be wrong — but round 1 overstated this into "no
partial phase can be correct," which is false: a coherent subset of the engine edits, together with
its own correctly re-measured affected constants, could in principle be verified in isolation.
`nameentry.asm`'s dual placement (kernel-lo on an action project, banked on an RPG) is a genuine
cross-cutting *dependency* to account for in any phasing plan, not proof that no partial
implementation is measurable at all.

What still makes one phase the simpler, and this design's own recommended, choice: every
`kernelCodeBytes`/`battleRegionBytes` term shares the same additive expression (`generate.js:
1234-1264`), so a genuinely coherent partial update (the swept files plus every constant *their own*
code affects, correctly re-measured) would have to be scoped and validated as carefully as the whole
diet anyway, for a smaller win — and CLAUDE.md's own prose must never disagree with the generator at
a commit boundary, which a staged rollout would either violate for the length of the rollout or
require its own interim-prose discipline to avoid. One phase is simpler to validate atomically, not
the only *possible* correct sequence — recorded honestly as a choice, not an impossibility.

**No absolute `jsr`/`jmp` diet is named as a future candidate** — round 1's own §13 correctly said
no such shorter 6502 encoding exists, which directly contradicted a stray mention elsewhere; the
contradiction is removed rather than resolved by argument, since there was never a real future diet
to name here.

## §12. Open questions for Chris

**None that change the work.** Round 1's own "spend it or bank it" framing already had its answer
inside this design (§4: slack stays at 20, the saving returns to the author as usable capacity) — it
was never a real open question, just poorly separated from the one genuine follow-on decision, which
is not required to ship this diet: **whether to actively promote any of the newly-available feature
combinations in the UI** (the Build panel's own meter, `kernelShortfallAdvice`'s own message
wording) once the real capacity is confirmed — a distinct, later, optional scope question that this
design's own delivery does not depend on either answer to.

## §13. Out of scope, explicitly

- **Spending or promoting the recovered bytes** — §12.
- **The absolute `jsr`/`jmp` diet** — no such shorter encoding exists on the 6502; not a future
  phase of this diet, a non-candidate.
- **RAM layout changes.** No byte moves address; only how an unmoved byte's address is *encoded*
  changes.
- **Moving a `$0300+` array into zero page** to make it eligible for this diet — a real future
  design surface, not this one.

## §14. Changelog

- **Shipped (`bd24eb0`)**: the implementation commit, on top of v5 below. Every zero-page operand
  in `engine/*.asm` prefixed with `<`: 1431 instructions across 20 files, each one byte shorter.
  `test/lib/equates.js` (the equate resolver, the per-mnemonic zero-page addressing-mode table, and
  the instruction scanner) plus `test/unit/zeropage.test.js` (three directions: an admitted bare
  operand, a `<` on a name resolving ≥ `$100`, a `<` in a mode the 6502 has no zero-page form of)
  keep the diet from regressing one instruction at a time. Every kernel-lo and banked-region ledger
  constant re-measured from nesasm: base kernel-lo `{NROM 5952→5367, MMC1 6022→5428, MMC3
  6039→5449, UNROM 512 6217→5617}`, banked base `{4220→3783, MMC3 4266→3823}`, and every allowance
  in between (`WAIT`/`SHAKE`/`FADE`/`FLASH` moved only because their names are expression-defined
  equates `parseEquates` never saw); `KERNEL_SLACK` stays 20 on both banks. The final measured
  figures match this design's own provisional table exactly, past the one 675-vs-683 discrepancy
  the design itself traced and predicted correctly (§4/§15 above) — checked directly against the
  current `main/build/generate.js`/`battletables.js` for this docs pass, not merely assumed.
  `ITEM_KERNEL_ALLOWANCE`/`ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE`'s individual split (§15) is
  also resolved, by direct instruction accounting rather than a project toggle: 16 (`ITEM_KERNEL_
  ALLOWANCE`, unaffected by the diet) plus 61/59 (`ITEM_EFFECT...BY_GAME_TYPE`, action/rpg). Every
  combination CLAUDE.md's "Documented limitations" listed as a refusal now builds and is asserted
  by a real `buildProject` run, each with a padded sibling that keeps the refusal-advice path under
  test. `test/unit/split.test.js` gained the §7 deadline invariant this design specified, with
  missing-entry, late-initial-arm and register-preserving late-follow-up negative controls. The
  one-time structural acceptance step (§6) passed on all six fixtures: label set/order identical,
  pre-reset tables and reset at identical addresses, later labels ≤ old, whole-ROM byte equality
  outside the two code masks and the vectors, split register sequence identical on `sample-mmc3`.
  `npm test` 1591/1591 (0 skipped), `npm run smoke` 222/222. Mesen's `engine_smoke`/SRAM/flash
  checks and their negative controls on `sample`/`sample-rpg-mmc1`/`sample-u512` all pass. Three Lua
  checks fail, confirmed pre-existing and unrelated to the diet on a clean pre-diet worktree:
  `engine_smoke.lua` on `sample-mmc3` (exit 5 `NO_TRANSITION` — that script is written for
  `sample/`, and CLAUDE.md never names `sample-mmc3` for it, so this was never a documented claim);
  `test/lua/run_bound_tile_nmi_check.sh` (its fixture could not even build before the diet —
  kernel-lo overflow, "253 bytes needed, 78 free" — now builds, but the runner fails exit 3, dialog
  never opened); `test/lua/run_flash_nmi_check.sh` (exit 3, identical pre- and post-diet). Reviewer
  GO at round 2 — a post-implementation review, separate from this design document's own five
  rounds below.
- **v5 (this round)**: fix round 4, two P2s addressed, both in §7's split-trace specification —
  1. the one-time acceptance check moved from raw register-value sequence equality to a normalized
     projection — `$C000`/`$8000`/`$8001`'s own meaningful values kept, `$E000`/`$C001`/`$E001`'s
     own ignored data bytes replaced with a sentinel (confirmed: `mapper4.js`'s own handlers for all
     three discard `value` entirely, and `split.asm`'s own `sta $E000` inside the IRQ handler is
     labeled "value irrelevant" in the source), counter-clock events excluded from the sequence
     comparison (they belong to the invariant instead), and frame selection tightened to a
     *settled* frame — `game_state`/`box_state` polled past their own transition values, then a
     further fixed number of frames advanced, before capturing the trace; the "faster code can only
     ever land earlier" parenthetical deleted as self-contradictory against this same section's own
     non-monotonic-timing argument;
  2. the permanent invariant's own deadline anchored independently of the arm it checks, rather
     than circularly derived from "the next clock after `$E001`" — the first entry's deadline is
     the frame's first counter clock after the vblank arm window, a follow-up entry's deadline is
     the first counter clock after the clock that asserted the *preceding* entry's own IRQ; expected
     entries read off the active split program with its own zero terminator exempt, a
     `split_lock`-held frame treated as "no arm expected" rather than a missing one; a negative
     control specified (a scratch source-level rearm delay, chosen over an emulator-side one, since
     only the former exercises the real instruction stream).
- **v4**: fix round 3, two P2s addressed —
  1. the split trace (§7) extended from a single `$8001` timestamp (no stated pass condition) to
     the whole write-then-rearm sequence — a mapper-write wrapper covering `$8000`/`$8001`/`$C000`/
     `$C001`/`$E000`/`$E001` plus a `clockIrqCounter` wrapper, `$8001`'s own command disambiguated
     via the preceding `$8000` write — split into two separated uses: a permanent, baseline-free
     invariant (every armed entry's reload/enable writes land before the next counter clock it
     counts, proposed as a new `split.test.js` case) and a one-time acceptance check (per-frame
     event sequence identity, ignoring scanline/dot, on the MMC3 fixture's title and a message-box
     frame);
  2. §6's mask-endpoint paragraph completed — the kernel-lo mask's own upper endpoint, missing
     before, is now nesasm's own reported used-byte count per build (the same figure
     `kernelbytes.test.js:257` already parses), taken as the max of the pre- and post-sweep
     builds; the banked-region mask's own simpler whole-bank-width endpoint stated explicitly; rule
     2's non-increasing-address check extended to the banked region's own later labels.
- **v3**: fix round 2, six P2 and one P3 addressed —
  1. the appendix rewritten as a real JS consumer of `test/lib/equates.js` (which now owns the
     equate grammar, the addressing-mode table, AND the instruction scanner, not grammar alone),
     confirmed by a scratch dry-run reproducing the identical 394/1431 census;
  2. the scanner made case-insensitive on the mnemonic and given an optional same-line `label:`
     prefix, both added as named guard-test controls; the `cpu.js` citations corrected to `:384`/
     `:478`;
  3. §6 rule 3 inverted to what was meant — whole-ROM byte equality is required OUTSIDE the three
     masks, not compared inside them — with the mask-endpoint arithmetic (`game.fns` + `prgLayout`/
     `codeRegions`) specified, and rule 2 explicitly scoped to the kernel-lo bank;
  4. every wrong §4b figure corrected (Move+split 488, the `:1791` row's 189/198/(189,198] band, the
     `:2238`/`:2256` 337/516/853 messages, `move.test.js`'s own 337), "four" Sfx refusal cases
     corrected to five, and the requested `rammap.test.js:295-312`/`:426-455` override row added;
  5. §5's first row re-attached to its real constructor (`:2045` is the naming-OFF row; the
     naming-live 7701/491 figure is an additional variant with no test citation of its own), and an
     explicit statement that every row's title is on;
  6. four timing corrections: `STA`/`LDA` `,x` cycle savings distinguished (stores save one cycle,
     loads save zero); the split probes corrected to tile rows and the naming grid, not scanlines
     and battle art; `engine_smoke.lua` corrected to assert nothing about the split; the A12
     argument narrowed to bound the counter only, with a concrete, narrow measurement addition
     proposed for the CPU write/rearm's own placement; the frame-boundary sentence corrected to say
     a per-frame trace CAN see a boundary crossing;
  7. the two-permanent-zeros contradiction resolved (only `HERO_DEFAULT` is proved by inspection;
     `SAVE_BATTLE`/`H`/`AUDIO_FX`/`STING_SFX_INTERACTION` are observed, not proved, in both scopes);
     the `AUDIO_FX`/`STING_SFX_INTERACTION` figures corrected from span lengths to span
     *differences*; the flash location-counter claim corrected to "moves together," not
     "unaffected"; the universal partial-update-fails sentence deleted from §11; §9 item 1's count
     reconciled with a full, exhaustive 232-name non-RAM census (not just the 13 hex/expression
     examples); "four hashes" corrected to three.
- **v2**: fix round 1, all twelve findings addressed —
  1. expanded scope to every RESOLVING (not just literal) sub-`$100` equate, via a lifted
     `test/lib/equates.js` resolver; re-censused (1431 sites, up from 1270) and re-measured
     end-to-end;
  2. per-mnemonic addressing-mode table added, verified against `cpu.js`'s real opcode table,
     `stx <name,y`'s legality corrected;
  3. the structural equivalence gate rewritten to allow relocation, compare label identity/order
     rather than raw address equality, validate vectors against each build's own symbols, and
     demoted from a permanent test to a one-time acceptance step;
  4. the full test re-tuning inventory added (§4b), independently spot-checked against source;
  5. the 675/683 naming discrepancy resolved to 683, in dependency order, confirmed by rerun in
     both scopes;
  6. §5 rebuilt from real test constructors with naming/item/audio state stated explicitly, and
     confirmed by real builds rather than component-sum projection; the mislabeled
     Sting-alone/Sting-and-Sfx row corrected; the omitted `:3223` row added; the 46→40 MMC3 band
     fix folded in;
  7. timing claims qualified by addressing mode (the zero-cycle `call_ret_lo,x` case named
     explicitly), the monotonic-timing claim withdrawn, the music/Sfx trace format corrected;
  8. the Code Forge section corrected to name the one real new hazard (a `constants.asm` override
     moving a name out of zero page);
  9. the source guard specified to read `engine/constants.asm` directly;
  10. the ledger symbol count corrected to 30+8 (38 total), the item-filter zero-delta explanation
      corrected (cancellation, not absence of sites), `STING`/`SFX`/`AUDIO_FX` fully resolved via
      the existing label-span isolation;
  11. every misattributed mechanism corrected (nesasm's real exit code, `naming.js`'s hardcoded
      addresses, `testplay.js`'s two distinct resolution paths, the flash `.if`'s real equality
      semantics); the sweep script's full text now ships as an appendix;
  12. the one-phase argument's overclaim removed, the `jsr`/`jmp` contradiction removed, §12
      narrowed to the one genuine remaining question.
- v1: first design round. Superseded by the above; kept no content of its own in this file.

## §15. Claims reasoned rather than pinned

- ~~Four terms' zero deltas (`SAVE_BATTLE_KERNEL_ALLOWANCE`, `HERO_NAMING_KERNEL_ALLOWANCE`,
  `AUDIO_FX_KERNEL_ALLOWANCE`, `STING_SFX_INTERACTION_ALLOWANCE`) are observed identical in both
  scopes, not proved by inspection the way `HERO_DEFAULT_KERNEL_ALLOWANCE`'s is~~ — **half resolved
  by the implementation, half still open.** `AUDIO_FX_KERNEL_ALLOWANCE` and
  `STING_SFX_INTERACTION_ALLOWANCE` were traced directly, the same way §4 traced
  `HERO_DEFAULT_KERNEL_ALLOWANCE`, but by two different mechanisms, not one: `AUDIO_FX_KERNEL_
  ALLOWANCE`'s `music_channel` check-and-self-clear block indexes `force_trig,x` ($543) and
  `mus_trig,x` ($358), both well above `$100`, never a bare zero-page operand; `STING_SFX_
  INTERACTION_ALLOWANCE`'s `sting_restore_silence` ownership guard (`engine/music.asm:486-491`) is
  `ldy sfx_state / bne` — a plain absolute load of `sfx_state` ($0568), not an indexed array access
  at all — also never a bare zero-page operand. Either way the diet provably has nothing to shrink
  (`main/build/generate.js`'s own comments on each constant). `SAVE_BATTLE_KERNEL_ALLOWANCE` and
  `HERO_NAMING_KERNEL_ALLOWANCE` were not traced — both still say "observed, not yet traced to a
  specific reason" in their own comments — and stay open: implementation should trace each directly
  before relying on either staying zero under a future engine edit.
- ~~`engine/split.asm:141-163`'s own write-then-rearm sequence timing (§7) now has a fully
  specified measurement design ... but the measurement itself has not been taken~~ — **resolved by
  the implementation.** `test/unit/split.test.js` implements exactly this design: a baseline-free
  deadline invariant for the MMC3 split's reload/enable writes, anchored to the split program's own
  schedule via an externally-tracked frame tag rather than the arm's own observed position, with
  missing-entry, late-initial-arm and register-preserving late-follow-up negative controls, all
  passing against the diet's own shrunk code.
- ~~`test/lib/equates.js` and the appendix's own sweep script are design artifacts, not yet real
  repository files~~ — **resolved by the implementation.** `test/lib/equates.js` is a real,
  committed module (`test/unit/zeropage.test.js`'s own dependency), not a design artifact.
- ~~The full §4b inventory's individual new numbers beyond those explicitly derived this round
  (Move+split's 488, the `:1791` row's 189/198/(189,198] band, the `:2238`/`:2256` 337/516/853
  messages, `move.test.js`'s own 337, and the eight §5 scenarios) are still implementation work~~ —
  **shipped.** `test/unit/kernelbytes.test.js:1714` asserts Move+split's 488 directly; `:1849`/
  `:1864` assert the 189-code/198-combined MMC1 suggestion; `:2438`/`:2456` assert the 337/516/853
  Save-and-Move advice messages — all re-derived against a real `checkCapacity()` run, not carried
  over from the old proportions, matching what this design specified.
- ~~The individual `ITEM_KERNEL_ALLOWANCE`/`ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE` split remains
  unresolved — no existing project toggle isolates one from the other.~~ — **resolved by the
  implementation, without a toggle.** `main/build/generate.js`'s own comment on
  `ITEM_KERNEL_ALLOWANCE` gives a direct instruction-by-instruction accounting instead:
  `add_item`'s gated `cmp #NO_ITEM`/`beq` (4 bytes) plus `draw_item_icon` in full (12 bytes) = 16,
  unaffected by the diet because neither touches a zero-page-eligible operand — so the entire
  combined-delta shrinkage (79→77 action, 76→75 rpg) is provably `ITEM_EFFECT_KERNEL_ALLOWANCE_
  BY_GAME_TYPE`'s alone (→ 61/59).
- **Whether any test beyond the eight directly rebuilt in §5 has a genuinely different naming/
  item/audio state than its neighbors** (finding 6's broader point) has not been checked
  exhaustively — only the eight named rows were individually reconstructed from their own test
  constructors, across both fix rounds.
- **Diagnostic fields not recorded**: `test/unit/split.test.js`'s split trace (above) does not
  capture scanline, dot or the command byte for each event, only the address/frame/entry data the
  deadline invariant itself needs — the event-order checks did not need them. Left out deliberately,
  not an oversight; add them if a future failure needs finer-grained diagnosis than pass/fail plus
  frame and entry number.

## Appendix: the sweep script, verbatim, as a real consumer of `test/lib/equates.js`

**Corrected this round (finding 1): the appendix is now a JS script that actually imports the
shared module's exports, not an independent Python reimplementation of the same rule.** The
module owns all three pieces decision 11 assigned it — the equate grammar, the per-mnemonic
addressing-mode table, and the instruction scanner — and this script, plus `test/unit/
zeropage.test.js` (§3), are its two consumers. `test/unit/rammap.test.js` keeps its own two-input
audit exactly as it is today (`scanEquates(constantsText, pending); scanEquates(configText,
pending); resolveEquates(pending, symbols);`, `:320-329`) and its own `isRamName`/annotation logic
— the lift narrows to `scanEquates`/`resolveEquates` alone for that file, never a stock-only
convenience loader replacing its two-file audit.

**Dry-run confirmation, this round**: both files below were written to this session's own scratch
directory (`test/lib/equates.js` does not exist in the repository yet — this is the design for it,
not a claim that it is already there) and run directly against the real `engine/` tree. The dry
run reproduces **394 zero-page-resolving names and 1431 swept instructions**, with the identical
per-file breakdown §2's table already gives, confirming the JS port behaves identically to the
Python prototype used for every measurement in §4/§5. The scanner was additionally checked against
finding 2's own named controls: `  LDA bt_tmp2` (uppercase, admitted, `<` inserted, case preserved)
and `label: lda bt_tmp2` (same-line label, admitted, label preserved) are both correctly recognized
and correctly rewritten; a comment-only line, an immediate, an indirect operand, `lda
save_flash_buf,x` (`>= $100`), and `lda bt_tmp2,y` (a real zero-page name in an illegal mode for
`lda`) are all correctly left untouched; `stx bt_tmp2,y` (a legal mode) is correctly admitted.
`scanEquates`/`resolveEquates` were separately checked for first-definition-wins, and for failing
loudly on an unsupported shape (subtraction) and on a dangling reference — both throw, neither
silently drops the name from resolution.

### `test/lib/equates.js`

```js
// The engine's own equate grammar and zero-page instruction shape, in one
// place, for three consumers: test/unit/rammap.test.js (the RAM-map audit,
// scanEquates/resolveEquates only -- its own isRamName and two-input scan
// are untouched), the zero-page sweep script (below), and
// test/unit/zeropage.test.js (the permanent guard, docs/design-kernel-diet.md
// §3). scanEquates/resolveEquates are lifted verbatim from
// test/unit/rammap.test.js's own functions (historically at :201 and :246)
// -- identical mutation semantics (both take a Map and mutate it in place),
// identical first-definition-wins behaviour, identical fail-loud handling of
// an equate shape this grammar does not recognise.

export function scanEquates(text, pending) {
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+)/);
    if (!m) continue;
    const [, name, rawExpr] = m;
    if (pending.has(name)) continue;
    const expr = rawExpr.trim();
    const hex = expr.match(/^\$([0-9A-Fa-f]+)$/);
    const dec = expr.match(/^(\d+)$/);
    const sum = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([A-Za-z_][A-Za-z0-9_]*|\d+)$/);
    const product = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\*\s*([A-Za-z_][A-Za-z0-9_]*|\d+)$/);
    const bare = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
    if (hex) pending.set(name, { kind: 'literal', value: parseInt(hex[1], 16) });
    else if (dec) pending.set(name, { kind: 'literal', value: parseInt(dec[1], 10) });
    else if (sum) pending.set(name, { kind: 'sum', base: sum[1], add: sum[2] });
    else if (product) pending.set(name, { kind: 'product', base: product[1], mul: product[2] });
    else if (bare) pending.set(name, { kind: 'bare', ref: bare[1] });
    else {
      throw new Error(
        `${name} = ${expr} does not fit the restricted equate grammar this guard parses (literal $hex/decimal, ` +
          `a bare name, name+token, or name*token). Widen scanEquates deliberately, or fix the line.`
      );
    }
  }
}

export function resolveEquates(pending, symbols) {
  let progress = true;
  while (progress) {
    progress = false;
    for (const [name, spec] of pending) {
      let value;
      if (spec.kind === 'literal') {
        value = spec.value;
      } else if (spec.kind === 'sum') {
        const base = symbols.get(spec.base);
        const add = /^\d+$/.test(spec.add) ? parseInt(spec.add, 10) : symbols.get(spec.add);
        if (base === undefined || add === undefined) continue;
        value = base + add;
      } else if (spec.kind === 'product') {
        const base = symbols.get(spec.base);
        const mul = /^\d+$/.test(spec.mul) ? parseInt(spec.mul, 10) : symbols.get(spec.mul);
        if (base === undefined || mul === undefined) continue;
        value = base * mul;
      } else {
        const v = symbols.get(spec.ref);
        if (v === undefined) continue;
        value = v;
      }
      symbols.set(name, value);
      pending.delete(name);
      progress = true;
    }
  }
  if (pending.size) {
    throw new Error(`could not resolve: ${[...pending.keys()].join(', ')} -- each names something never defined`);
  }
}

/** Per-mnemonic zero-page addressing-mode legality, NMOS 6502 -- verified
 * against renderer/emulator/core/cpu.js's own opcode table (:384 LDX ZPY,
 * :478 STX ZPY). */
export const ZP_MODE_TABLE = {
  bit: new Set(), cpx: new Set(), cpy: new Set(),
  lda: new Set(['x']), sta: new Set(['x']), adc: new Set(['x']), sbc: new Set(['x']),
  and: new Set(['x']), ora: new Set(['x']), eor: new Set(['x']), cmp: new Set(['x']),
  asl: new Set(['x']), lsr: new Set(['x']), rol: new Set(['x']), ror: new Set(['x']),
  inc: new Set(['x']), dec: new Set(['x']), ldy: new Set(['x']), sty: new Set(['x']),
  ldx: new Set(['y']), stx: new Set(['y'])
};

const ZP_OPS = Object.keys(ZP_MODE_TABLE);
// Case-insensitive throughout (round-2 finding 2): an optional same-line
// `label:` prefix, any-case mnemonic, an optional `<`, a bare identifier, an
// optional `,x`/`,y` index, and an optional trailing comment -- nothing
// else. Every piece of original formatting is captured so a rewrite can
// reproduce the line exactly except for the inserted `<`.
const LINE_RE = new RegExp(
  '^(\\s*(?:[A-Za-z_][A-Za-z0-9_]*\\s*:\\s*)?)' + // 1: leading ws + optional "label:"
    '((?:' + ZP_OPS.join('|') + ')\\s+)' + // 2: mnemonic + its own trailing whitespace, original case
    '(<?)' + // 3: already prefixed?
    '([A-Za-z_][A-Za-z0-9_]*)' + // 4: operand name (case-sensitive comparison against the symbol map happens downstream)
    '(\\s*(?:,\\s*([xXyY]))?)' + // 5: index text, 6: index letter
    '(\\s*(?:;.*)?)$', // 7: trailing whitespace/comment
  'i'
);

/**
 * Scans one source line for an admissible bare zero-page instruction.
 * Returns null if the line does not match the shape at all (an immediate,
 * an indirect operand, a comment-only line, a directive, or simply no
 * instruction). Otherwise returns the parsed pieces plus a `rebuild()`
 * closure that reproduces the line with `<` inserted, byte-for-byte
 * identical to the input everywhere else -- callers decide admission
 * (does `name` resolve below $100, is `indexLetter` legal for `mnemonic`)
 * before calling `rebuild()`.
 */
export function scanZeroPageInstruction(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const [, leading, mnemonicPart, prefix, name, indexFull, indexLetter, tail] = m;
  const mnemonicText = mnemonicPart.match(/^(\S+)/)[1];
  return {
    mnemonic: mnemonicText.toLowerCase(),
    prefixed: prefix === '<',
    name,
    indexLetter: indexLetter ? indexLetter.toLowerCase() : null,
    rebuild: () => `${leading}${mnemonicPart}<${name}${indexFull}${tail}`
  };
}
```

### The sweep script (`tools/zp-sweep.mjs` or similar, implementation's own choice of path)

```js
// Zero-page addressing sweep -- the one-off script that applies test/lib/
// equates.js's own rule to engine/*.asm. Imports the shared module rather
// than reimplementing any part of it (round-2 finding 1).
import fs from 'node:fs';
import path from 'node:path';
import { scanEquates, resolveEquates, ZP_MODE_TABLE, scanZeroPageInstruction } from '../test/lib/equates.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONST = path.join(ROOT, 'engine', 'constants.asm');

function loadZpNames() {
  const text = fs.readFileSync(CONST, 'utf8');
  const pending = new Map();
  scanEquates(text, pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  const zp = new Set();
  for (const [name, value] of symbols) if (value < 0x100) zp.add(name);
  return zp;
}

function sweepFile(file, zpNames, apply) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let changed = 0;
  const out = lines.map((line) => {
    const scanned = scanZeroPageInstruction(line);
    if (!scanned) return line;
    if (scanned.prefixed || !zpNames.has(scanned.name)) return line;
    if (scanned.indexLetter && !ZP_MODE_TABLE[scanned.mnemonic].has(scanned.indexLetter)) return line;
    changed += 1;
    return scanned.rebuild();
  });
  if (apply && changed) fs.writeFileSync(file, out.join('\n'));
  return changed;
}

function main() {
  const apply = process.argv.includes('--apply');
  const zpNames = loadZpNames();
  console.log(`zero-page-resolving names: ${zpNames.size}`);
  let total = 0;
  const perFile = {};
  for (const file of fs.readdirSync(path.join(ROOT, 'engine')).filter((f) => f.endsWith('.asm')).sort()) {
    const full = path.join(ROOT, 'engine', file);
    const n = sweepFile(full, zpNames, apply);
    if (n) perFile[file] = n;
    total += n;
  }
  console.log(`instructions ${apply ? 'swept' : 'that would be swept'}: ${total}`);
  for (const [file, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${file}: ${n}`);
  }
}

main();
```
