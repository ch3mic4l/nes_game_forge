# Report: namestride round 2 — the half-threaded injectable list

One finding, confirmed exactly as described: `battleTables(project,
battleStrings)` (round 1) emits from the injected list, but
`battleTableBytes(project)` (`main/build/battletables.js:521`, pre-fix) still
called `battleTables(project)` with the default — so for an injected 21-entry
list the real emission is 584 bytes while the counter said 464. The round-1
call-site test can't see this because its only injected case (22 entries)
throws before any emission happens.

## Fix

```js
export function battleTableBytes(project, battleStrings = BATTLE_STRINGS) {
  return emittedBytes(battleTables(project, battleStrings));
}
```

One signature, one body change. Default (`battleStrings = BATTLE_STRINGS`)
reproduces prior behavior exactly for every existing call site
(`generate.js:1692`, `battletables.js`'s own `battleRegionBytes`/
`battleShortfallAdvice`/`checkBattleTables`, and every test that calls
`battleTableBytes(project)` with one argument) — none of them pass a second
argument, so nothing about the default path changed. `battleRegionBytes`'s
own signature and `generate.js` are untouched, per the brief.

## New test (`test/unit/bankedbytes.test.js`)

`'battleTableBytes counts what its own injected list emits, not the default
list'` — builds `sample-rpg`'s project, constructs a fabricated 21-entry
list, and asserts two things:

1. `battleTableBytes(project, list21) === emittedBytes(battleTables(project,
   list21))` — the counter agrees with the real emission for the *same*
   injected list.
2. `battleTableBytes(project, list21) - battleTableBytes(project) === (21 -
   BATTLE_STRINGS.length) * MSG_COLS` — today `(21 - 11) * 12 = 120`, matching
   the brief's own figure exactly.

The second assertion is what makes the first non-vacuous, per the brief: an
implementation that silently ignores the injected parameter and always
counts the default `BATTLE_STRINGS` would still make assertion 1 pass
*trivially* if `battleTables` were sabotaged the same way — two functions
that both ignore the list agree with each other on some (wrong) shared
number. Assertion 2 pins the actual, non-zero delta a real 21-entry list must
cost, which an implementation ignoring the parameter cannot produce (its own
delta would be zero, not 120).

`MSG_COLS` is not exported from `battletables.js` (module-private); hardcoded
in the test as `12` with a comment naming the single writer, the same
convention this codebase's own tests already use for unexported constants
(and the one this same test file already used informally in a comment on the
prior test, `22*12=264`).

## Wrong-implementation sentence

An implementation of `battleTableBytes` that accepts the second parameter but
keeps calling `battleTables(project)` internally (ignoring it) fails this
test's second assertion (delta would be `0`, not `120`) even though its first
assertion could coincidentally hold if `battleTables` itself were sabotaged
the same way.

## Sabotage proof

Reverted `battleTableBytes` to ignore the parameter:

```js
export function battleTableBytes(project, battleStrings = BATTLE_STRINGS) {
  return emittedBytes(battleTables(project));   // battleStrings dropped
}
```

Result:

```
# Subtest: battleTableBytes counts what its own injected list emits, not the default list
not ok 5 - battleTableBytes counts what its own injected list emits, not the default list
  error: |-
    battleTableBytes(project, list) must count exactly what battleTables(project, list) itself emits

    464 !== 584
```

Fails at the first assertion already — with the exact numbers the review
finding itself named (464 vs 584). Restored the fix; reran
`test/unit/bankedbytes.test.js`: 16/16 pass.

## `npm test` totals

**933 pass / 0 skip / 0 fail** (up from round 1's 932 — the one new test).

```
1..933
# tests 933
# suites 0
# pass 933
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## No engine change

`engine/battle.asm` and `engine/battleui.asm` are untouched this round —
confirmed by `git diff main/build/battletables.js` showing this round's only
addition is `battleTableBytes`'s four-line signature/body change on top of
round 1's own diff; no other hunk in that file or in `engine/` moved.

```
$ git diff --stat
 engine/battle.asm             |  39 +++++-
 engine/battleui.asm           |  66 ++++++----
 main/build/battletables.js    |  33 ++++-
 test/unit/bankedbytes.test.js |  94 +++++++++++++++
 test/unit/items.test.js       |  19 ++-
 test/unit/kernelbytes.test.js |  44 +++----
 test/unit/rpg.test.js         | 271 +++++++++++++++++++++++++++++++++++++++++-
 7 files changed, 505 insertions(+), 61 deletions(-)
```

(`engine/battle.asm`, `engine/battleui.asm`, `test/unit/items.test.js`,
`test/unit/kernelbytes.test.js`, and `test/unit/rpg.test.js` are carried
forward unchanged from rounds 0-1; only `main/build/battletables.js` (+4
lines) and `test/unit/bankedbytes.test.js` (+41 lines) gained anything in
round 2.)

Not committed. `reviewer` was not contacted, per the brief.
