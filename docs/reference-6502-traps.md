# Reference: 6502 traps this codebase has already hit

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

## 6502 traps this codebase has already hit

Each of these cost real debugging time and now has a regression test. They are easy to reintroduce.

- **A routine returning a value must set the flags from that value.** `cmp` used for a range check
  leaves `Z` describing the comparison, not the accumulator. `probe_solid` returning after
  `cmp #3` made every movement read as blocked.
- **Branches are ±128 bytes.** Long dispatch chains need `jmp`; `music.asm` failed to assemble
  until two branches were inverted into jumps.
- **`tya`/`txa` clobber A inside a loop** that relied on a value loaded before it. The
  sprite-parking loop wrote each sprite's own offset instead of `$FF`, leaving 59 stray sprites.
- **Deciding a state inside several branches lets the last one win.** Setting a chaser's facing in
  both the horizontal and vertical movement branches meant vertical always overwrote horizontal,
  so the sideways animation was unreachable. Decide once, before acting.
- **Apply before advancing an envelope/animation step**, or the first entry is never used.
- **A helper called from a loop must hand back the registers the loop owns.** `combatant_alive`
  clobbering X made `battle_round` skip half the party — and the fix has a trap of its own, because
  `ldx`/`ldy` set the flags, so a routine that answers with the Z flag has to reload A *after*
  restoring them.
- **A guard copied from another routine may not mean the same thing.** `draw_entities` reads
  `oam_idx == 0` as "the shadow filled up"; `battle_draw_sprites` starts at zero, so the same test
  meant "nothing drawn" and silently skipped parking, leaving the field's HUD on the battle screen.
- **A `$2006` write moves the screen.** Its high byte lands in the PPU's `t` register,
  nametable-select bits and all, so any mid-frame VRAM write must be followed by a `$2000` rewrite
  as well as the `$2005` pair. Writing only `$2005` leaves the picture scrolled to a nametable
  nothing was drawn into, which presents as the screen going blank the first time a box opens.
- **What holds for registers holds for scratch bytes.** `draw_list` kept its row counter in
  `bt_tmp2` while `name_offset_pc` — called for every named row — hands its answer back *in*
  `bt_tmp2`, counting it down to zero; one list entry hid it, two hung the redraw loop, untested
  since no test ever opened a two-entry list. Fixed with a byte nothing downstream owns
  (`bt_vrow`). `bt_tmp2` is load-bearing again as `cast_all`'s own end-of-side
  sentinel for its `spell_damage`/`roll_spell_amount`/`mod8` chain
  — a new routine there has exactly one byte it may not pick.
- **A backward `.org` silently splices bytes into whatever already assembled there.** nesasm
  places a bank's contents at file offset `address & (bank size - 1)` with no check that the
  address is actually inside the bank being assembled — an address *behind* the bank's own base
  (`.org $0600` inside a `$C000`-based kernel bank) still produces a valid offset, so nesasm
  silently overwrites existing code, exit code 0 regardless. Proved empirically before
  `engine/flash.asm` was written, which is why that driver is position-independent (assembled at an
  ordinary address, copied to its real address at runtime) rather than reserving a fixed low
  address via `.org` — see its own header comment for the relocation rules that requires.
- **An 8-bit multiply used as a table offset silently wraps.** `name_offset_pc`
  (`engine/battle.asm`) computed `index * NAME_LEN` in a single accumulator with the carry
  discarded, so index 26 landed four bytes into entry 0 instead of entry 26's own name — `table,y`
  addressed correctly, only `y` was wrong. Fixed by adding the product into a 16-bit
  `ptr_lo`/`ptr_hi` and reading `[ptr_lo],y` instead. Regression tests (`test/unit/rpg.test.js`)
  read the nametable for a high-index monster and item, each paired with a low-index control
  that also forces the carry (`assertForcesCarry`), so a fixture
  that stopped needing the carry could not go silently vacuous.
- **A column-0 `.if` is read by nesasm v3.1 as a label, not a directive, and reports `Unknown
  instruction!` on that line — exit 0 regardless.** Indented, the identical file assembles cleanly.
  The trap is `.if`-specific: a flush-left `.else`/`.endif` alone does not fail; every `.if` in
  `engine/` is indented and must stay so. Found while listing magic power's `combatant_mag`
  (`docs/design-magic-power.md` §13 item 11); regression test in `test/unit/codebuild.test.js`,
  with indented controls proving the column is what fails, not the snippet.
- **nesasm v3.1 assembles a bare zero-page operand as 3-byte absolute, not the 2-byte zero-page
  encoding, unless it carries a `<` prefix.** Every zero-page operand in `engine/*.asm` went
  unprefixed for the engine's entire life — 1431 sites across 20 files, costing roughly 590
  kernel-lo bytes and 440 banked bytes per board. `<` isn't free to add blind: on a name resolving
  to `$100` or above, nesasm refuses it ("Incorrect zero page address!") but still exits 0 — the
  pipeline's own `# N error(s)` count, not the exit code, is what fails the build. Regression test
  `test/unit/zeropage.test.js`, three directions (an admitted bare operand, a `<` on a name
  resolving too high, and a `<` in an addressing mode with no zero-page form) over the shared
  equate resolver and per-mnemonic mode table in `test/lib/equates.js`. See
  `docs/design-kernel-diet.md` for the full sweep and the ledger it re-measured.
