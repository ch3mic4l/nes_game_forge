# `BASE_KERNEL_CODE_BYTES_BY_MAPPER` overcharges every action project by 270-282 bytes

**Status: resolved.** `BASE_KERNEL_CODE_BYTES_BY_MAPPER` is now measured against `sample` (the action
fixture), and a new `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER` term carries the RPG-only remainder that used
to be silently folded into it (`main/build/generate.js`; equality-asserted, both halves, per board, in
`test/unit/kernelbytes.test.js`). Implemented per `handoff-magic/brief-kernel-base-1.md`; see
`handoff-magic/kernel-base-1-report.md` for the full account, including the real, re-measured figures
this document's own §6 sketch is checked against. Not yet committed as of this fix landing in the
tree — the commit that carries it will supersede this line with its own hash once it exists. §1-§5
and §7 below are left exactly as they were: the record of how this was found and what a fix would
have to do, not retroactively edited now that it is one.

## 1. The claim, in one line

`kernelCodeBytes(project, mapper)` reserves 270 bytes more kernel-lo space than nesasm actually uses
for an **action** project on MMC1 or UNROM 512, and 282 bytes more on MMC3 — before any conditional
term (title, Save, Move, …) enters the picture at all. The over-reservation is entirely in
`BASE_KERNEL_CODE_BYTES_BY_MAPPER`, which is measured exclusively against `sample-rpg` and then
charged unconditionally to action projects on the same board.

## 2. The measurement

Both fixtures, every RPG-capable board, in the plainest configuration each can be built in — title
off (`project.titleMap = null`), no live Save, no live Move, nothing else conditional switched on.
Real usage is nesasm's own kernel-lo bank figure from its segment-usage table, minus everything
before `reset` (the lookup tables), exactly the way `measureCodeBytes` in
`test/unit/kernelbytes.test.js` derives it — this is the same technique every other figure in the
kernel ledger is held to, not a second method invented here.

| Fixture | Board | nesasm real | `kernelCodeBytes` | margin |
|---|---|---|---|---|
| `sample` (action) | MMC1 | 6033 | 6303 | **270** |
| `sample` (action) | UNROM 512 | 6228 | 6498 | **270** |
| `sample` (action) | MMC3 | 6215 | 6497 | **282** |
| `sample-rpg` | MMC1 | 6280 | 6300 | 20 |
| `sample-rpg` | UNROM 512 | 6475 | 6495 | 20 |
| `sample-rpg` | MMC3 | 6474 | 6494 | 20 |

The RPG rows are the ledger working as designed: a margin of exactly `KERNEL_SLACK` (20), which is
what CLAUDE.md's "a correctly measured per-mapper base should leave *exactly* `KERNEL_SLACK`" means
in practice. The action rows are 13.5x that.

Reproduce with a script mirroring `measureCodeBytes`; the figures above were produced that way and
not copied from any earlier report.

## 3. Why it happens

`BASE_KERNEL_CODE_BYTES_BY_MAPPER` is one number per board describing "the stock RPG-capable kernel
with nothing conditional turned on". The word doing the damage is *RPG-capable*: the number was
measured by building `sample-rpg`, so it is the size of the kernel **with `BATTLE_ENABLED` set**.

`BATTLE_ENABLED` is not a small switch. It gates code in eight kernel files outside the banked battle
region — `player.asm`, `boot.asm`, `combat.asm`, `save.asm`, `rpg.asm`, `banks.asm`, `script.asm`,
`ui.asm`, plus `split.asm` on MMC3 — in both directions (`.if BATTLE_ENABLED` and
`.if !BATTLE_ENABLED`, an action project assembling its own hearts/knockback code where an RPG
assembles party code). The net is that an RPG's kernel is 270 bytes larger, and an action project is
charged for all of it.

**MMC3's extra 12 bytes are identified, not left as noise.** `split_select` (`engine/split.asm:82`)
carries an `.if BATTLE_ENABLED` arm that no other board assembles:

```
  lda game_state        ; 3
  cmp #ST_BATTLE        ; 2
  bne split_select_not_battle ; 2
  lda #SPL_BATTLE       ; 2
  jmp split_select_store      ; 3
```

12 bytes exactly, which is the whole of the 282-vs-270 difference. This is the same shape as
`TITLE_KERNEL_ALLOWANCE_BY_MAPPER`'s own MMC3-only +12, and for the same reason — `split_select` is
the one routine that grows a branch per optional game state.

## 4. What it actually costs a user

The direction is the safe one: `kernelCodeBytes` over-estimates, so `checkCapacity` never promises
table room the assembler will then refuse. Nothing miscompiles and no ROM is wrong. What happens
instead is that an action project is **refused capacity it really has**.

Kernel-lo is shared between engine code and the project's lookup tables, so 270 bytes of phantom code
reservation is 270 bytes of real table space withheld. At `kernelTableBytes`' 13 bytes per screen (4
neighbours, 4 data pointers, 2 actor-list pointers, tileset, bank, map), that is **roughly 20 screens
an action project is told it cannot have** on any of these three boards — or the equivalent in
metasprites, actors and items. An author hits a capacity refusal, and the refusal is wrong.

Scope: only action projects on MMC1, MMC3 and UNROM 512. Every other board falls back to
`FALLBACK_BASE_KERNEL_CODE_BYTES`, which is a different (and deliberately generous) number with its
own separate justification, and is not what this document is about.

## 5. Why no test caught it, which is the part worth keeping

`kernelbytes.test.js` was thorough in one axis and blind in another. Every absolute
`assertCovers(...)` check — the one assertion that compares `kernelCodeBytes` against real usage
rather than comparing two builds to each other — is run against `sample-rpg`. Every *action*-side
check in the file (`ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.action`'s own test, for instance) is a
**delta** between two action builds, and a delta cancels the base term out. So the base was never
once compared to reality on an action project, on any board.

`assertCovers`' own ceiling (`margin <= KERNEL_SLACK * 2`, i.e. 40) is precisely the mechanism that
would have caught this — a 270-byte margin fails it loudly. It simply was never pointed at this
configuration.

That is why the Save-split work that found this deliberately **did not** add an `assertCovers` call
to its new action-side loop: doing so would have made an unrelated, out-of-scope defect fail that
change's own test run, conflating two things. The omission is commented in place at the loop in
`test/unit/kernelbytes.test.js`.

## 6. What a fix would have to do (sketch, not a plan)

The shape is already established by the Save split that found this — the same defect, one level down,
fixed the same way:

1. Re-measure the base against `sample` (action) per board, and let
   `BASE_KERNEL_CODE_BYTES_BY_MAPPER` hold the **action-side** figure. Note the arithmetic, which is
   easy to get wrong: the correction is the margin's *excess over `KERNEL_SLACK`* (270-20 = 250, or
   282-20 = 262 on MMC3), **not** the margin itself, and it is applied to the old base rather than
   derived from real usage — real usage in §2's table includes each fixture's own conditional terms,
   which the base does not carry. That gives `{1: 5954, 4: 6117, 30: 6149}`. Arithmetic from §2, not
   a measurement: re-measure before trusting it, per the house rule that only nesasm's own output
   counts as measured.
2. Add a `BATTLE_KERNEL_ALLOWANCE`-shaped term for the RPG-only supplement, gated on the same
   recomputed `codeRegions(...).length > 0` predicate `usesSaveBattle` already uses — **not** on
   `gameType === 'rpg'`, for the reason that gate's own comment gives.
3. That term is `{1: 250, 4: 262, 30: 250}` — the same excess figures from item 1, since restoring
   the RPG side's 20-byte margin means handing back exactly what the base gave up. It is **not**
   flat, so unlike `SAVE_BATTLE_KERNEL_ALLOWANCE` it earns `*_BY_MAPPER` treatment on real measured
   variance, with `split.asm:82`'s 12 bytes as the identified cause of MMC3's difference.
4. Equality-assert both halves, and add the `assertCovers` call to the action loop that §5 explains
   was withheld.

Two things to check before starting, neither of which is settled here:

- **`SAVE_BATTLE_KERNEL_ALLOWANCE` may be absorbed by this.** It is the same `.if BATTLE_ENABLED`
  predicate charging for the same kind of code. Whether Save's 36 bytes stay a separate named term or
  fold into a general battle supplement is a judgement about which reads better in
  `kernelShortfallAdvice`'s output, not about arithmetic — the sum is identical either way. The
  argument for keeping it separate is that `kernelShortfallAdvice` prices "drop every Save command"
  and needs Save's own share nameable.
- **Every "documented limitation" row moves.** The refusal rows in `kernelbytes.test.js` and the
  figures CLAUDE.md's "The kernel budget" section quotes are all RPG configurations, so most should
  be *unchanged* — but "should be" is not measured, and this ledger's whole discipline is that only
  nesasm's own output counts. Re-run all of them.

## 7. Relationship to the Save allowance split

Found while implementing that split, not before it, and by the same means: measuring a term against
`sample` for the first time instead of only ever against `sample-rpg`. The two defects are
independent — the Save split is correct and complete on its own, and its 36-byte RPG supplement is a
real measured figure regardless of what the base does — but they share one root cause worth stating
plainly:

> Every figure in the kernel ledger was measured against the RPG fixture, because that is the fixture
> the tight configurations live on. A term measured on one game type and charged to both is wrong for
> the one it was not measured on, and no delta-based test can see it.

`SAVE_KERNEL_ALLOWANCE_BY_MAPPER` was the instance that got fixed. This one is the instance that got
written down.
