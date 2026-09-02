# Review brief: the name-stride fix (uncommitted working tree)

You are the reviewer. Review the uncommitted diff in the working tree (`git diff`; seven files:
`engine/battle.asm`, `engine/battleui.asm`, `main/build/battletables.js`,
`test/unit/{bankedbytes,items,kernelbytes,rpg}.test.js`). Do not edit anything; report findings
to me in `handoff-namestride/namestride-review1.md`. Report only actionable findings, most severe
first, each with file:line and the concrete failure it causes. If you find nothing, say so
plainly rather than manufacturing style notes.

## What the change is

`name_offset_pc` (`engine/battle.asm`) computed `index * NAME_LEN` (NAME_LEN = 10) as an 8-bit
offset, discarding the carry, and every consumer read `lda <table>,y` absolute,Y — so index 26
(offset 260) wrapped to 4 and drew the tail of entry 0 plus the head of entry 1. The fix: callers
load the table base into the zero-page pair `ptr_lo`/`ptr_hi` ($00/$01), the routine adds
`index * NAME_LEN` into that pair as a 16-bit address, and consumers read `lda [ptr_lo],y`. Four
call sites: `draw_panel` (battle.asm), `draw_list_name` and both branches of `push_combatant_name`
(battleui.asm). The brief that produced it is `handoff-namestride/brief-namestride.md`; the
coder's report is `handoff-namestride/namestride-report.md`.

Also: `checkBattleStringsCapacity` in `battletables.js` is a generator-side guard (throws when
`BATTLE_STRINGS.length * MSG_COLS > 256`) for `push_battle_string`, which has the same 8-bit
stride and is deliberately left unchanged.

## Things I have already verified — do not spend time re-confirming them

- `npm test`: 931 pass, 0 skip, 0 fail.
- Both new emulator tests in `rpg.test.js` fail with the engine files stashed and pass with them
  restored (I ran that myself).
- `main/build/generate.js` is untouched, so kernel-lo figures cannot have moved.
- `bt_tmp` is dead after `battle_say` reads it at battleui.asm:597, so `push_combatant_name`
  newly clobbering it is safe.

## What I want your eyes on specifically

1. **Correctness of the 6502.** Register and flag contracts of `name_offset_pc`'s new body and
   each of the four call sites. In particular: `draw_panel_slot` relies on X surviving the call;
   `draw_list_name` now branches on `bt_phase` before the call and reaches the shared loop via
   `jmp draw_list_name_go` — check both `.if ITEMS_ENABLED` arms assemble to a correct base load;
   `push_combatant_monster` does `sec`/`sbc #MAX_PARTY`/`tax` before the actor-id load.
2. **Is `ptr_lo`/`ptr_hi` genuinely safe here?** The coder's census (report §"The ptr_lo census")
   says NMI never touches the pair and nothing on the path between the base load and the last
   read does. Check that claim against `engine/boot.asm`'s NMI handler, `vram_push`, `seek_at`,
   `queue_at`, and anything `draw_list`/`battle_say` runs between the load and the loop. A miss
   here would present as a wrong name only under a specific interrupt timing.
3. **The tests.** For each of the two emulator tests and the guard test: name a wrong
   implementation that would still pass it, if one exists that the report does not already name.
   Check the low-index controls are not vacuous (report §"Tests"). Check the item test's
   `inv_items` poke happens at a point the engine will actually honour.
4. **The `kernelbytes.test.js` recalibration** (128 → 126 filler actors in two tests). The report
   says this is the banked region's +50 cascading into a mapper-suggestion check, not a kernel-lo
   change. Confirm the two edited tests still assert what their names say, and that the rewritten
   comments' numbers are consistent with the diff.
5. **The `items.test.js` golden-hash re-pin.** The report's justification: `draw_list_name` is
   unconditional battle-region code that changed under `!ITEMS_ENABLED` too, so an RPG with no
   items legitimately produces a different ROM. Say whether that justification holds and whether
   the test's comment says so adequately.
6. **Anything the brief asked for that is missing**, and anything present the brief did not ask
   for.

Do not contact `coder`. Report to me only.
