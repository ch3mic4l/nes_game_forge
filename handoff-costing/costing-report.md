# Costing report: tile change vs. sound effect / sting

Measurement-only pass, per `handoff-costing/brief-costing.md`. HEAD is 4a4be92 (clean) throughout;
no tracked source, test or fixture file was edited. All builds ran against throwaway `mkdtemp`
clones of `sample-rpg`/`sample`, produced and deleted by a scratch script
(`buildProject`/`checkCapacity` called directly, the same way `test/unit/kernelbytes.test.js`
does); `git status` at the end of this session matches the start. No `npm run sample*` was run.

**Revised twice**: round 1 against `handoff-costing/costing-review1.md` (11 findings, six high),
round 2 against `handoff-costing/costing-review2.md` (7 findings, four high). See "Round 1
revisions" and "Round 2 revisions" at the end for what changed and why. Part 1 is untouched
throughout both rounds — neither review found fault with the measured margin table.

This is a costing pass, not a design. Part 2's routine tables are pre-implementation estimates —
the same status Fade's and Flash's own §7/§12 tables had before those features shipped — priced
with the codebase's own instruction-byte discipline (every symbolic RAM operand outside true zero
page — `$0000-$00FF` — assembles as a 3-byte absolute access, not 2-byte zero-page; confirmed
against `engine/constants.asm`: `ptr_lo`/`mtptr_lo`/`atptr_lo`/`tmp`/`tmp2`/`script_ptr_lo`/
`box_row`/`box_col` sit in true zero page, while every existing verb's own state — `mv_who`,
`wt_left`, `shake_left`, `fade_step`, `flash_left`, all four `mus_*` channel arrays — lives at
`$0300+` and is absolute. Any *new* RAM this report proposes also has to live at `$0300+`, since
zero page is already fully allocated, so every new symbol below is priced as 3-byte absolute
unless it reuses an existing zero-page scratch byte for the duration of one routine.)

No recommendation is made below. The numbers are laid out so the choice is real.

---

## Part 1 — real per-board kernel-lo margin, measured

Every row is a real `nesasm` build (or a real `checkCapacity` refusal) of a `sample-rpg`/`sample`
variant, not an estimate. "free" is nesasm's own `BANK n USED/FREE` line for the kernel-lo bank —
the *whole* bank (lookup tables + fixed bytes + engine code), which is the number that actually
decides whether the ROM assembles. Bank size is 8192 bytes on every board. A "REFUSED" row is
`checkCapacity`'s own pre-assembler message (nesasm was never invoked); the **signed free** figure
used everywhere in this report (including the fit matrix in Part 3) is
`(BANK_SIZE − kernelBudget − fixedBytes) − tableBytes` — i.e. `checkCapacity`'s own "only X free"
number minus the "need Y bytes" number — which is negative for a REFUSED row and exactly equals
`−deficit`. The deficit phrasing below is kept alongside it because it is what `checkCapacity`
actually prints to a user; the signed free figure is what Part 3 mechanically compares candidate
costs against.

Every verb-cost delta measured below reproduces `main/build/generate.js`'s own allowance
constants *exactly* (512 = TURN 35 + FACE 16 + WAIT 48 + SHAKE 65 + VISIBLE 49 + FADE 146 +
PALETTE_FX 55 + FLASH 98, on all three boards; Move's own marginal cost is 379 on all three) —
the existing estimates are not stale. That is itself useful: it means a new verb's own
pre-measurement estimate (Part 2) can be trusted at the same confidence the shipped ones now
carry, rather than needing to be discounted for known drift.

### MMC3 (kernel-lo bank 30)

| configuration | result | free / deficit | signed free |
|---|---|---|---|
| baseline (no Save/Move, no title, w/ item) | fits | **1180 free** | +1180 |
| Save + Move + item (documented limitation) | **REFUSED** | 11 short (need 129, only 118 free) | −11 |
| Save + Move, **no item** | fits | **88 free** | +88 |
| Save only, w/ item | fits | **404 free** | +404 |
| Move + item, **no Save** | fits | **785 free** | +785 |
| ALL 7 shipped verbs + Move + item, no Save | fits | **289 free** | +289 |
| ALL 7 shipped verbs + Save + Move + item | **REFUSED** | 507 short (need 129, only −378 free) | −507 |
| ALL 7 shipped verbs only, no Save/Move, w/ item | fits | **668 free** | +668 |

### MMC1 (kernel-lo bank 14)

| configuration | result | free / deficit | signed free |
|---|---|---|---|
| baseline (no Save/Move, no title, w/ item) | fits | **1374 free** | +1374 |
| Save + Move + item (the board that still fits) | fits | **220 free** | +220 |
| Save + Move, no item | fits | **299 free** | +299 |
| Save only, w/ item | fits | **615 free** | +615 |
| Move + item, no Save | fits | **979 free** | +979 |
| ALL 7 shipped verbs + Move + item, no Save | fits | **483 free** | +483 |
| ALL 7 shipped verbs + Save + Move + item | **REFUSED** (new finding) | **296 short** (need 129, only −167 free) | **−296** |
| ALL 7 shipped verbs only, no Save/Move, w/ item | fits | **862 free** | +862 |

**New finding, not in CLAUDE.md today:** MMC1's own Save+Move+item combination — "the board that
still fits" — stops fitting the moment every shipped verb is also live on the same project. It is
not a hypothetical: this is the exact "floor a new verb lands on in a maximal project" the brief
asked Part 1 to establish, and on MMC1 that floor is already negative (**296 bytes short**) once
Turn/Wait/Shake/Show/Hide/Fade/Flash are all present alongside Save+Move+item. A new verb cannot
be the thing that breaks this — it is already broken — but it means MMC1 is not the safety margin
it looks like from the Save+Move+item row alone.

### UNROM 512 (kernel-lo bank 62)

| configuration | result | free / deficit | signed free |
|---|---|---|---|
| baseline (no Save/Move, no title, w/ item) | fits | **1170 free** | +1170 |
| Save + Move + item (documented limitation) | **REFUSED** | 167 short (need 129, only −38 free) — matches CLAUDE.md's own figure exactly | −167 |
| Save + Move, **no item** | **REFUSED** (new finding) | 88 short (need 126, only 38 free) | −88 |
| Save only, w/ item | fits | **239 free** | +239 |
| Move + item, no Save | fits | **775 free** | +775 |
| ALL 7 shipped verbs + Move + item, no Save | fits | **279 free** | +279 |
| ALL 7 shipped verbs + Save + Move + item | **REFUSED** | 663 short (need 129, only −534 free) | −663 |
| ALL 7 shipped verbs only, no Save/Move, w/ item | fits | **658 free** | +658 |

**New finding, not in CLAUDE.md today:** CLAUDE.md documents UNROM 512's Save+Move shortfall as a
167-byte deficit — that figure already includes `sample-rpg`'s own live item (measureCodeBytes'
default). Dropping the item does **not** close the gap on this board: Save+Move alone, with no
item at all, is still 88 bytes short. This is the opposite of MMC3, where dropping the item *does*
close the identical combination (88 free without the item, vs. 11 short with it). An author told
"drop your items to fit Save+Move" would be given correct advice on MMC3 and wrong advice on
UNROM 512.

### Action side (`sample`, combat + text + all 7 shipped verbs live)

| board | kernel-lo bank | free | signed free |
|---|---|---|---|
| NROM | 2 | **861 free** | +861 |
| UxROM | 14 | **822 free** | +822 |

Confirms the brief's expectation: the action boards carry 800+ bytes of margin even with every
shipped verb live simultaneously. They are not, and are not expected to become, the constraint for
either candidate.

---

## Part 2 — candidate costs, from the real code

**Everything in this part is kernel-lo unless a row says otherwise.** Kernel-hi (compiled event
and song data, `$E000` bank) and `$0300+` RAM are both real, finite resources with their own
capacity checks, but neither is measured in Part 1's table. Each candidate's kernel-hi/RAM cost is
now stated explicitly, in its own labeled subsection, precisely because Part 3's fit matrix can
only ever answer "does this fit kernel-lo" — see the note at the top of Part 3.

### Tile change

Two features, costed separately per the handoff's own warning.

#### Visual-only (dies on redraw, like Hide)

Rides entirely existing, **unconditional** machinery: `vram_open`/`vram_push`/`vram_end`
(`engine/text.asm`) are not gated behind any `.if` — they assemble in every ROM regardless of
whether the project shows text, because Fade/Flash/the message box all already depend on them
unconditionally. A tile-change command that only queues packets through this machinery therefore
adds no dependency the way Move's own `SPLIT_LOCK_KERNEL_ALLOWANCE` does on MMC3 — **no implied
`projectUsesText`-style predicate flips on for this variant.**

**Correctness constraint: the producer bound.** `script_run` executes every non-suspending command
in a page straight through on one mainline frame — it is what lets Turn/Visible/Shake feel
instant. If Tile were built the same way, a page with several consecutive Tile commands would open
and close a `vram_buf` packet per command with **no cap**, on the same frame Flash may also be
ticking. CLAUDE.md's own measured ceiling for this queue — "at most two producers per frame... 71
of `vram_buf`'s 256 bytes, and roughly 1670-1740 cycles of full NMI time... against the ~2273-cycle
vblank window" — assumes exactly one instant-command packet plus Flash's own; an uncapped third
(or Nth) producer can overflow either the buffer or the vblank cycle budget outright, silently, on
a page an author is free to write.

**A naive one-frame suspend does not actually enforce this bound.** The obvious fix — Tile
suspends the script and a `til_pending` flag checked once at the top of `ui_tick` clears itself and
resumes — turns out not to guarantee a real frame boundary passed. `engine/boot.asm`'s own
`main_loop` order is `settle_owed → dispatch_input → ui_tick → main_loop_draw`. An **interact**-
triggered event runs `start_dialog`/`script_start` from *inside* `dispatch_input`, on the same
frame the button was pressed; if the first command is Tile, `til_pending` is set within that same
`dispatch_input` call, and `game_state` is now non-zero, so `main_loop`'s own `bne main_loop_ui`
calls `ui_tick` **immediately afterward, still the same frame** — before `main_loop_draw`'s
end-of-frame `vram_ready` handshake has run at all, let alone before any NMI has drained the queue.
A single-state `til_pending` flag would see itself set, resume the script right then, and let a
second consecutive Tile command queue a second packet pair in the same frame — the exact hazard the
suspend was supposed to prevent. (`wt_left`/`mv_left` already have this same same-frame-resume
property — `wait_tick`'s very first call can decrement `wt_left` from 1 to 0 and `jmp
script_resume` within the arming frame — but it is harmless for Wait/Move because neither one
touches `vram_buf`; Tile inherits the property and cannot tolerate it.) Touch/enter-triggered events
happen to arm on a screen redraw and resume through the ordinary `settle_owed → main_loop_draw`
path on a later iteration, which hides this bug — a test covering only those triggers would pass.

**The fix: a two-phase armed state**, not a single pending flag. `til_pending` takes three values:
0 (idle), 1 (armed this call — a real frame boundary has not yet been proven to pass), 2 (armed on
a *prior* call — `wait_vblank` has run again since, so the NMI has genuinely drained the queue, and
resuming now is safe):

| routine | bytes | basis |
|---|---|---|
| `script_op_tile` sets `til_pending = 1` after queuing, instead of falling through to `script_run`, and returns | ~6 | `lda #1`(2)+`sta til_pending`(3, absolute)+`rts`(1) — the `rts` is required, not implicit: `script_op_tile` is reached by `jmp` from `script_run`'s dispatch (a tail jump, the same shape every other command's entry uses), so stopping here has to be an actual return to whatever called `script_run`, not a fall-through |
| `ui_tick` frozen-world priority-chain entry | 8 | `lda til_pending`(3, absolute)+`beq skip`(2)+`jmp tile_tick`(3), unchanged shape from `wt_left`'s own chain entry |
| `tile_tick`, two-phase | 21 | dispatch: `lda til_pending`(3)+`cmp #1`(2)+`beq tile_tick_arm`(2) = 7; resume path (til_pending was 2 — a real frame has passed): `lda #0`(2)+`sta til_pending`(3)+`jmp script_resume`(3) = 8; arm path (til_pending was 1 — bump and wait one more tick): `lda #2`(2)+`sta til_pending`(3)+`rts`(1) = 6 |
| **suspend/resume subtotal** | **35** | 6 + 8 + 21 = 35, exactly — no range, no unstated contingency |

**Honest throughput: this design drains one Tile every two main-loop iterations, not one per
iteration.** Tracing what actually happens when `tile_tick` resumes a script whose very next
command is another Tile: the resume branch (`til_pending` was 2) runs `script_resume`, which
immediately reaches `script_op_tile` again — still inside this same `ui_tick` call, on this same
iteration — queues the new packets, sets `til_pending = 1`, and `rts`s all the way back out to
`main_loop`. The *next* iteration's `wait_vblank` genuinely drains those packets (a real frame
boundary passed, so the queue is safe), but `ui_tick`'s chain entry sees `til_pending == 1` on that
same iteration and only *promotes* it to 2 — it does not resume the script yet. The script does not
actually reach the following command until the iteration *after that*. So a page with N consecutive
Tile commands takes roughly 2N main-loop iterations to fully execute, not N — a real, if minor,
authoring-visible throughput cost, not the same one-per-frame rate Move/Wait/Fade already have. This
is a correct, priced mechanism, not the fastest one: moving the 1→2 promotion to an end-of-frame
handshake point (so the very next post-drain `ui_tick` call already sees state 2 and can resume
immediately) would recover one-Tile-per-frame throughput, but is different code — it would need its
own instruction-level pricing, not assumed to cost the same as the sketch above, and is not designed
further here.

**Three-packet worst case: bytes and cycles, not a claim that the old two-packet measurement
already covers it.** Because Tile is now the fifth mutually-exclusive frozen-world state (alongside
move/wait/fade/text), it *replaces* whichever of those would otherwise have ticked that frame — it
does not add a fourth producer on top of them. The real new worst case is Tile's own two small
packets (top tile row + bottom tile row) sharing an NMI with Flash's one packet, computed the same
way CLAUDE.md's own Flash passage computes its two-32-byte-packet bound:

- **Bytes.** Each Tile packet is a 3-byte header (`addr_hi, addr_lo, count`) plus a 2-byte body (one
  tile row's worth), so 5 bytes × 2 packets = 10, plus Flash's own header(3)+body(32) = 35, plus one
  shared terminator = **46 bytes of `vram_buf`'s 256** — well under the 71-byte figure the existing
  Flash+Fade worst case already measures, because Tile's bodies are tiny next to a full 32-byte
  palette write.
- **Cycles**, from `vram_drain`'s own instruction stream (`engine/text.asm`), NMOS 6502 timings:
  each packet's header costs `lda abs,X`(4)+`beq`(2)+`bit abs`(4)+`sta abs`(4)+`inx`(2)+`lda abs,X`(4)+
  `sta abs`(4)+`inx`(2)+`ldy abs,X`(4)+`inx`(2) = 32 cycles, and each body byte costs `lda abs,X`(4)+
  `sta $2007`(4)+`inx`(2)+`dey`(2)+`bne`(3) = 15 cycles. A Tile packet (2-byte body) drains in
  32+2×15+3(jmp back) ≈ 65 cycles; two of them ≈ 130. A Flash packet (32-byte body) drains in
  32+32×15+3 ≈ 515 cycles. Terminator check + `vram_drain_done` cleanup ≈ 23. Total drain-loop time
  for Tile×2 + Flash×1 ≈ 130+515+23 = **~668 cycles**, against roughly **1030 cycles** the existing
  two-32-byte-packet (Flash+Fade) worst case spends in the identical drain loop (515×2) — the
  three-packet case is *cheaper* in drain time, not more expensive, because two small Tile packets
  cost less than one more full palette write. Adding the same fixed overhead CLAUDE.md's own figure
  already accounts for (the 513-cycle OAM DMA, register save/restore, and the PPUADDR fix — together
  roughly 640-710 cycles, backed out from CLAUDE.md's own 1670-1740 total minus the ~1030-cycle
  two-packet drain time above) gives an estimated **~1300-1380 cycles** of full NMI time for the new
  worst case, against the same **~2273-cycle** vblank window — comfortably under, with more margin
  (roughly 890-975 spare cycles) than the existing Flash+Fade worst case's own ~530-600.

The address/write mechanics: every *existing* `vram_buf` producer targets a *fixed* nametable
region known at compile time (the box is always rows 24-29, so `box_row_addr` gets away with a
single-byte row offset and a constant high byte `BOX_ADDR_HI`; `draw_screen` writes the whole
nametable sequentially and never computes a mid-screen address at all). A tile change targets an
*arbitrary* (row 0-14, col 0-15) position chosen by the author, which crosses all four nametable
pages ($2000/$2100/$2200/$2300) — genuine 16-bit address arithmetic no existing producer needs.

| routine | bytes | basis |
|---|---|---|
| `script_op_tile` operand read (col, row, metatile) + `script_skip` | ~24 | 3 operands, `script_op_move`'s own exact per-operand shape: op1 `ldy #1`(2)+`lda [script_ptr_lo],y`(2, zp-indirect,Y)+`sta` new $0300+ byte(3, absolute)=7; op2/op3 each `iny`(1)+`lda[]`(2)+`sta`(3)=6×2=12; `lda #3`(2)+`jsr script_skip`(3)=5; total 7+12+5=24 |
| nametable address computation | ~20-30 | row/col → $2000+row·64+col·2 crosses page boundaries a fixed-row producer never has to handle; cheapest shape is a generated 15-entry `screen_row_lo/hi` table (30 ROM bytes, one-time, priced separately below) indexed by row, plus a col·2 low-byte add with carry into the table's high byte |
| write one metatile — instruction-by-instruction, no double-counting | **~44-52** | one packet is `vram_open` setup (~7) + two `(lda mt_tl,y(3, absolute,Y) + jsr vram_push(3))` pairs at 6 each = 12 + `vram_end`(3) = **22 per packet**. Two packets (top tile row + bottom tile row, 32 bytes apart in the nametable) = 44, plus ~4-8 to shuffle the metatile id out of Y before `vram_open` overwrites Y with the address low byte and back after (Y is the one register both `vram_open`'s calling convention and the `mt_tl/tr/bl/br,y` lookups want) |
| `script_run` dispatch entry | 7 | precedent shape every prior verb's entry measures at (`cmp`/`bne`/`jmp`) |
| generated `screen_row_lo/hi` table (ROM data, not code — kernel-lo tables region, same as `mt_tl`/`mt_collision`) | 30 | 15 rows × 2 bytes, one-time |
| suspend/resume subtotal (above, two-phase, exact) | 35 | correctness requirement; two Tile-drains per frame, not one — see above |
| **headline: visual-only tile change** | **~160-178 kernel-lo** | 24 + (20-30) + (44-52) + 7 + 30 + 35 — the headline is exactly this sum, no unexplained contingency |

This lands just outside the top of the ~50-150 window prior verbs' own design docs used as a
sanity check — not comfortably inside it — and, unlike Move, carries no dependent term that turns
on anything else.

**Attribute-byte question.** A NES attribute byte covers a 32×32-pixel block = 4 metatiles, one
2-bit palette field per metatile. Swapping a metatile to one drawn from a *different* palette means
the visible tile art is right but the color is wrong unless that metatile's own 2-bit field in the
shared attribute byte is also rewritten. `vram_buf`'s NMI drain only *writes* (there is no queued
read), a mainline `$2007` read while rendering is on is neither queued nor safe, and reading the
*original* byte from `[atptr_lo]` (the ROM copy) instead of PPU VRAM only works for the **first**
change to land in a given attribute square: a second, different metatile change landing in a
sibling quadrant of the same byte would rebuild from the untouched ROM copy and silently erase the
first change's palette bits. There is also no `mt_palette` table today for the engine to even know
which palette a newly-painted-over metatile *wants*. Two real branches, priced separately:

- **Constrain authoring (the assumption this report's headline above uses).** The Map/Tile Forge
  only offers metatiles that already share the target cell's existing palette group as legal
  tile-change targets. Costs 0 engine bytes; the attribute byte is never touched because it never
  needs to change. Real UI/validation work this report does not scope (kernel-lo only) — **and see
  the common-events caveat below: this branch is not coherent for every authoring surface.**
- **Pay for a real attribute overlay — corrected arithmetic.** This needs: a generated `mt_palette`
  table (one byte per metatile, **64 kernel-lo data bytes** — `LIMITS.metatiles` is 64, a fixed
  cost regardless of how many metatiles a given project actually uses, the same shape `mt_tl`/
  `mt_collision` already are); a per-redraw copy of `[atptr_lo]` into an in-RAM shadow of the
  screen's *current* attribute table, so a second change to the same byte reads its own prior write
  rather than the untouched original (~15-20 kernel-lo code bytes); and the actual quadrant-shift/
  mask/OR/push logic (~30-45 kernel-lo code bytes). **Kernel-lo total: 64 + (15-20) + (30-45) =
  ~109-129 bytes** — not the ~215-240 an earlier draft of this report claimed, which summed to
  roughly another full visual implementation without ever naming what the extra ~106-115 bytes
  were for. The **64-byte shadow itself is RAM, not kernel-lo**, and must not be added to the
  kernel-lo figure — kept as its own, separately-stated `$0300+` cost. **Visual-only tile change
  plus this overlay: 160-178 + 109-129 = ~269-307 kernel-lo, plus 64 bytes of new `$0300+` RAM** —
  materially cheaper than the earlier draft's 365-420 claim, and now close enough to persistent
  tile change's own cosmetic-only cost (258-315, below) that the two land in almost the same fit
  class rather than clearly different ones — see Part 3.
- **Common events break the constrained-authoring assumption — a restriction this report's 0-byte
  branch needs to name, not a cost.** One compiled common event can be called from actors placed on
  different screens, where the same authored row/column can sit over different original palette
  groups depending on which screen the call happens to run from — there is no single "the target
  cell's palette" the editor can derive a legal replacement list from when the Tile command lives in
  a common event rather than a per-placement event. The zero-engine-byte branch above therefore
  assumes one of: Tile is unavailable inside common events (the cheapest fix, a product restriction
  rather than an engine cost); a conservative rule validating every call site's own screen/position
  combination and refusing if any of them disagree (real compiler work, not costed here); or a
  different operand/runtime mechanism entirely (effectively the paid attribute-overlay branch, or
  something not designed in this report). Added to Open Questions.

#### Persistent (survives redraw/warp/battle-return)

Screen data is ROM (`draw_screen` reads straight from `[mtptr_lo],y` → `mt_tl/tr/bl/br`, confirmed
in `engine/screens.asm`), so persistence needs a RAM overlay consulted both at redraw time and,
if it should affect solidity, by collision. A full per-screen shadow of all 240 metatile ids
(240 bytes) is not seriously considered — `$0300+` RAM is nowhere near that spacious — so the only
realistic shape is a small, fixed-size **sparse override table**: N entries of
`{screen, row, col, metatile}`, N picked by the user (this report costs N=8 as a working number;
see Open Questions for why the RAM cost this implies is not checked against any measured budget).

The initial mid-gameplay push (triggering a persistent change while the world is running, not at a
redraw) needs the identical address computation, packet write and two-phase suspend visual-only
already prices above — it is not re-derived here, only referenced, so it is not double-counted.
Genuinely new on top of it:

| routine | bytes | basis |
|---|---|---|
| `script_op_tile_persist` find-or-allocate | ~55-70 | linear scan of N=8 entries for an existing `(screen,row,col)` match or the first free slot: loop body `lda ov_screen,x`(3, absolute,X)+`cmp flat_screen`(3)+`bne next`(2)+`lda ov_row,x`(3)+`cmp`(3)+`bne`(2)+`lda ov_col,x`(3)+`cmp`(3)+`beq found`(2) ≈ 24, plus loop overhead (`inx`/`cpx #8`/`bne` ≈ 5) and the not-found/allocate/write-slot tail (~4 field stores × 3 = 12, plus branch glue ~10-15) |
| **slot-full policy.** All N=8 slots occupied by *distinct* `(screen,row,col)` triples, and a *new* one is requested. Silently dropping it is the kind of silent failure this codebase's own conventions refuse elsewhere; the cheapest real policy is round-robin eviction: a 1-byte `ov_next` index, advanced and wrapped whenever the find-or-allocate scan falls through with no match and no empty slot | ~10-15 | folded into the find-or-allocate row's own high end above, not a separate line: `inc ov_next`(5, absolute RMW)+`lda ov_next`(3)+`cmp #8`(2)+`bne skip`(2)+`lda #0`(2)+`sta ov_next`(3) ≈ 17, trimmed against shared branch glue already present |
| redraw-time reapplication, folded into `draw_screen`'s own per-cell loop | ~25-40 | reapplying under forced blank can piggyback directly on `draw_screen_row`/`draw_screen_bottom`'s existing per-cell body (a linear N=8 scan before `tay`/`lda mt_tl,y`, substituting the override's metatile id on a hit) rather than going back through `vram_buf` — cheaper than a second queued pass, and guarantees the override always shows on the very first redrawn frame |
| **`init_session` must clear all N override slots.** Every other piece of engine state `init_session` is the single "new game" definition for (CLAUDE.md's own framing) already gets cleared there; a persistent-tile table left uninitialized on a cold boot or a game-over restart would show whatever garbage RAM happened to hold | ~8-12 | `ldx #0`/loop: `lda #NO_SCREEN`(a sentinel, reusing the existing `NO_SCREEN`/`NO_ACTOR` convention as "slot empty")/`sta ov_screen,x`(3, absolute,X)/`inx`(1)/`cpx #8`(2)/`bne`(2) — one small loop |
| dispatch entry | 7 | precedent — this is the persistent variant's own opcode, separate from visual-only's; the two are costed as alternative products, not as one command with a flag, so their dispatch entries are not shared |
| RAM: 8 × 4 bytes (screen, row, col, metatile) + 1 byte `ov_next` | **33 bytes of `$0300+` RAM**, plus the 4 bytes (`til_pending`, `til_col`, `til_row`, `til_mt`) visual-only's own suspend/operand state already needs (see the correction below) | not a kernel-lo cost — see the kernel-hi/RAM subsection below |
| **headline: persistent, cosmetic-only, session-scoped (does not survive Continue)** | **~258-315 kernel-lo** | visual-only's own corrected headline (160-178, reused as the initial-push mechanism) + find/allocate+eviction (65-85) + redraw reapply (25-40) + `init_session` clear (8-12) |

Two further, independently-priced increments, per the brief's own explicit questions:

- **Does a changed tile change solidity?** `probe_type` (`engine/player.asm`) currently reads
  `[mtptr_lo],y` → `mt_collision,y` with nothing else — a very tight ~15-byte routine called up to
  4×/frame from player movement plus more from entity AI (`engine/entities.asm`). Making a
  persistent change affect collision means this hot-path routine also needs the same 8-entry scan
  the redraw path uses, before falling back to `mt_collision`. **+25-35 bytes**, paid once in code
  size (the scan itself is cheap in cycles — `probe_solid` is not vblank-bound the way NMI code
  is), but real: a persistent Damage or solid tile appearing under a script could trap the player
  mid-event, which is a design question this report flags rather than resolves.
  Answering "no" (cosmetic-only even when persistent) costs nothing beyond the headline above.
- **Does it survive a save? — re-costed from the real descriptor-table precedent, corrected for the
  ordinary partially-filled-table case.** `engine/save.asm:406-531` already has exactly *one*
  table-driven `save_write_body` and one table-driven `load_apply_body` that walk every entry in the
  generated `save_field_lo/hi/len` table (`assets/save.inc`, from `shared/save.js`'s `SAVE_FIELDS`)
  with a single shared loop each. Adding the 32-byte override table as one more `SAVE_FIELDS` entry
  (provided the four 8-byte arrays — `ov_screen`/`ov_row`/`ov_col`/`ov_metatile` — are allocated
  contiguously and exposed as one 32-byte span, the same shape every existing multi-byte field
  already is) costs **three descriptor bytes** — not two new serialization loops.

  What genuinely costs real bytes is **range validation**, and it needs a branch this report's own
  first sketch got wrong. `save_check_valid`'s own gate 4 (`engine/save.asm:234-261`) exists
  specifically because "every restored value `load_apply_body` is about to trust as a table index"
  must be bounds-checked — the identical reasoning the file's own header already applies to
  `player_dir`, `pc_level` and every `inv_items` entry. But `init_session` (above) deliberately
  fills *unused* slots with the `NO_SCREEN` sentinel, and a normal save with fewer than eight active
  overrides — the ordinary case — therefore contains one or more `NO_SCREEN` entries. A validation
  loop that checks `screen < NUM_SCREENS` unconditionally would reject `NO_SCREEN` (`$FF`, always
  ≥ `NUM_SCREENS`) on *every* normal save, making Continue disappear the instant this feature ships
  regardless of whether a project uses it. The loop must accept/skip `NO_SCREEN` first and validate
  `row` (< 15), `col` (< 16) and `metatile` (< `LIMITS.metatiles`, 64) only for active entries:

  ```
  ldx #0
  save_check_ov_loop:
    lda SAVE_OV_SCREEN,x
    cmp #NO_SCREEN
    beq save_check_ov_next      ; empty slot -- nothing to validate
    cmp #NUM_SCREENS
    bcs save_check_invalid
    lda SAVE_OV_ROW,x
    cmp #15
    bcs save_check_invalid
    lda SAVE_OV_COL,x
    cmp #16
    bcs save_check_invalid
    lda SAVE_OV_METATILE,x
    cmp #LIMITS_METATILES
    bcs save_check_invalid
  save_check_ov_next:
    inx
    cpx #8
    bne save_check_ov_loop
  ```

  the same shape as the existing `inv_items` bounded loop (`save_check_inv_loop`) but checking four
  fields per entry with an early skip, rather than one field with none — **~39-56 bytes** (the
  `NO_SCREEN` skip-branch itself is the small addition over the original 35-50 estimate: `cmp
  #NO_SCREEN`(2)+`beq skip`(2) ≈ 4-6 bytes). **+42-59 bytes total** (3 descriptor + 39-56
  validation). The `SAVE_LAYOUT_VERSION` bump (0 code bytes, a constant change) is required **only
  if the overlay is serialized at all** — a session-only overlay does not touch the save record and
  needs no version bump — but it still carries CLAUDE.md's own noted consequence when it does apply:
  every prior save on this build stops validating the moment this ships, regardless of whether a
  given project uses tile change. Every existing `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` figure would need
  re-measuring either way, since it is a per-mapper delta, not a flat one. Answering "no" (a
  persistent change reverts on Continue, the same way `ENT_HIDDEN` already resets on every redraw
  regardless of intent) costs nothing beyond the headline.

| combination | headline range |
|---|---|
| cosmetic-only, session-scoped | **~258-315** |
| + affects collision | **~283-350** |
| + save-serialized | **~300-374** |
| + affects collision + save-serialized | **~325-409** |

The brief's own "if it lands 150-300+, say so" threshold is met by *every* persistent variant.

**Kernel-hi and RAM, persistent tile change:** 4 event bytes per occurrence (opcode + col + row +
metatile, same shape as visual-only) in the compiled event stream; 33 bytes of new `$0300+` RAM
(the override table plus `ov_next`) shared with the 4 bytes of `til_pending`/`til_col`/`til_row`/
`til_mt` visual-only also needs.
Neither is in Part 1's kernel-lo table; see the subsection after Part 2's sound-sting section for
both candidates side by side.

### Sound effect / sting

`engine/music.asm` (329 lines total, read in full), confirmed directly from the code:

- **`set_music` replaces the song outright with no completion signal.** `music_play` (line 63)
  unconditionally re-initializes all four channels' pointers/duration/step/note/trigger the moment
  it is called with a new song index; nothing anywhere writes back to a caller when a song (or a
  channel within it) finishes. There is no hook to build a "the sting is done" callback on top of.
- **`music_tick` runs unconditionally every frame in every build**, called from `boot.asm`'s
  `main_loop` (line 105, "music keeps playing while the world is paused" — i.e. even during
  dialogue/menu states) with no `.if` gate anywhere around it or around `set_music`/`music_play`/
  `music_stop`. The whole music system is base engine, not a conditionally-assembled verb.
- **`music_channel` unconditionally clears the per-channel trigger flag at the very top of every
  call, before `music_apply` ever runs**: `engine/music.asm:127-129` is `lda #0 / sta mus_trig,x`,
  the very first thing every call does, for every channel, every frame. This is the fact both
  shapes below got wrong in an earlier draft of this report — see the correctness passages under
  each.
- Compiled song data (`assets/music.inc`) lives in the **kernel-hi** ($E000) bank
  (`engine/main.asm` line 93), separate from the driver code (`engine/main.asm` line 85, kernel-lo)
  and from this report's Part 1 margin table entirely — kernel-hi has its own, independent capacity
  check (`musicBytes + text.bytes > BANK_SIZE - 64`, `main/build/generate.js`), not measured here.

`shared/audio.js` (145 lines) and `main/build/songcompile.js` (185 lines) confirm the wire format:
songs are compiled into 4 fixed per-channel byte streams (note/duration pairs, `$F0-$F7` instrument
select, `$FF` loop-jump), instruments are shared globally across every song in the project, and
`song_ptr_lo/hi` holds one 2-byte entry **per channel per song** — a song with 3 silent channels
still reserves all 4 pointer-table slots. `songTables` therefore has a **fixed minimum floor of 28
kernel-hi bytes per extra compiled song** — 8 pointer-table bytes (4 channels × lo/hi) plus four
minimum 5-byte channel streams (`OP_REST, duration` then the 3-byte loop-jump tail) — before any
authored content, regardless of how many of those channels a project's own sting actually uses.

Three shapes, per the brief's own sketch.

**A shared correctness fix both shapes need, priced once and reused by each.** Writing
`mus_trig,x = 1` during a hand-back does *not* make the next `music_apply` call re-drive a period,
because `music_channel` clears that same byte to 0 at the top of its *own* next call — before
`music_apply` is reached — so a flag set on a completion frame that then returns (or jumps past the
shared tail) is erased before it is ever read. The fix is a second, independent flag that survives
the ordinary per-frame clear: a 4-byte `force_trig` array (one per channel, `$0300+`), checked
*after* the existing clear and *before* the normal duration/read-event logic, self-clearing the
instant it fires:

```
music_channel:
  lda #0
  sta mus_trig,x
  .if SFX_ENABLED
  lda force_trig,x
  beq music_channel_noforce
  lda #0
  sta force_trig,x
  lda #1
  sta mus_trig,x
music_channel_noforce:
  .endif
  lda mus_dur,x
  ...                          ; unchanged from here
```

Either shape's own hand-back logic sets `force_trig,x = 1` for whichever channel(s) need a
retrigger; this shared check is what actually makes it stick. Priced once, `.if SFX_ENABLED`-gated
so a project with neither shape live pays nothing:

| routine | bytes | bank | basis |
|---|---|---|---|
| `force_trig` check inside `music_channel` | ~15 | kernel-lo | `lda force_trig,x`(3, absolute,X)+`beq`(2)+`lda #0`(2)+`sta force_trig,x`(3)+`lda #1`(2)+`sta mus_trig,x`(3) |
| `force_trig` array | 4 bytes | `$0300+` RAM | one byte per channel |

**A second shared mechanism, for cancellation — corrected this round.** `music_play` (`engine/
music.asm`) opens with `sta cur_song`, then `cmp #NO_SONG`/`asl a`/`asl a`, using `A` as the song
index throughout. A cancellation check placed at the very top — `lda sfx_left`/`lda sting_left`,
and on the active path `lda #0` — runs *before* `sta cur_song` and clobbers the song argument in
`A`, corrupting every call. The check has to run *after* `cur_song` is safely stored, with `A`
preserved around it:

```
music_play:
  sta cur_song
  .if SFX_ENABLED
  pha                        ; the song index is still needed below
  lda sfx_left                ; or sting_left, whichever shape shipped
  beq music_play_no_cancel
  lda #0
  sta sfx_left
music_play_no_cancel:
  pla
  .endif
  cmp #NO_SONG
  ...                          ; unchanged from here
```

**This is not the whole cancellation surface, and the earlier "any Play-music or map-change call
cancels" framing overclaimed.** `set_music` (the wrapper every ordinary Play-music command and
`apply_map_music` actually call) returns *before* ever reaching `music_play` when the requested
song already equals `cur_song`: `cmp cur_song / beq set_music_done`. For shape (a), `cur_song`
still names the interrupted song throughout a channel-steal (only one channel is borrowed; the
other three, and the shadow of "what's playing," are untouched) — so a Play-music command or map
change naming that *same* song never reaches `music_play` at all, and the sting is not cancelled.
The corrected policy, stated plainly: **a request for a *different* song cancels the sting (via the
`music_play` check above); a request naming the song already playing is already a no-op in
`set_music`'s own existing dedup and correctly leaves the sting alone**, since nothing about the
audible song is actually changing — this second case costs nothing further to get right, it falls
out of code that already ships.

**`init_session` bypasses `music_play` entirely.** It calls `music_stop` directly
(`engine/combat.asm:105-108`), not through `set_music`/`music_play`, so the check above never runs
on a session reset — a sting mid-flight at the moment of a game over or a fresh boot would leave
`sfx_left`/`sting_left` still counting down into the *new* session. For shape (b) this is a real,
audible bug, not a merely theoretical one: `resume_song` would eventually fire and restore the
*previous* session's own shadowed channel state — whatever song was playing when the old session's
sting started — directly over the new session's freshly-silenced boot, rather than staying silent.
The cheapest fix, cheaper than constructing a placement-based harmlessness proof (and correct for
both shapes uniformly): one more line in `music_stop` itself, since every silencing path — the
`music_play` NO_SONG branch and `init_session`'s own direct call alike — funnels through it:

```
music_stop:
  lda #NO_SONG
  sta cur_song
  lda #0
  sta mus_enabled
  .if SFX_ENABLED
  sta sfx_left               ; or sting_left -- A is already 0 from the line above
  .endif
  lda #$30
  ...                          ; unchanged from here
```

| routine | bytes | bank | basis |
|---|---|---|---|
| `music_play` cancellation check, `A`-preserving | 12 | kernel-lo | `pha`(1)+`lda sfx_left`/`sting_left`(3, absolute)+`beq`(2)+`lda #0`(2)+`sta sfx_left`/`sting_left`(3)+`pla`(1) |
| `music_stop` sting-state clear | 3 | kernel-lo | one `sta sfx_left`/`sting_left`(3, absolute), reusing the `A = 0` the two lines above it already load — closes the `init_session` bypass for both shapes at their one shared choke point |

Priced once here; each shape's own table below includes its own copy of these two rows (each ships
independently, so each pays for its own copy of the fix, not a shared one split between them).

#### (a) Channel-steal sting over the running song

Steal one channel (noise is the natural candidate — least likely to be carrying a melody the
player would miss) for N frames while the other three continue the song untouched.

**Format.** The priced reader below assumes a genuinely separate, smaller **sting format** — fixed
volume, no instrument/envelope table lookup, one channel only — which means `main/build/
songcompile.js` needs its own small `compileSting()`-shaped sibling (no fixed engine-byte cost;
real, uncosted JS/compiler work), not literal reuse of `compileSong` (whose streams carry real
`$F0-$F7` instrument opcodes a fixed-volume reader would not understand). The alternative — reusing
the full song format via a real 5th "virtual channel" slot in the `mus_*` arrays — is a structural
change to the 4-channel driver, not a minor variant, and is not priced.

**Cancellation and second-sting policy — one minimum viable policy, priced concretely.** A second
sting arriving while the first is still stealing the channel **replaces it outright**: no queueing,
no stacking. Because this shape never shadows the song (the other three channels are untouched the
whole time, and the stolen channel's own song-state is simply left alone, to resume exactly where
it was), a new sting can freely re-point `sfx_ptr_lo/hi` at the new stream and reset `sfx_left` to
the new duration with no separate guard — the existing trigger row already covers this. What does
need an explicit fix: a `music_play` call for a **different** song than `cur_song` arriving mid-steal
must not leave the stolen channel's own `sfx_left` counting down against a song that no longer
exists (a request naming the *same* song already playing is already a no-op in `set_music` and
correctly leaves the sting alone — see the corrected policy above), and a session reset must not
leave `sfx_left` counting down into a new session — the shared `music_play`/`music_stop` mechanism
above is what closes both:

| routine | bytes | bank | basis |
|---|---|---|---|
| `script_op_sting` trigger | ~20-25 | kernel-lo | 1-2 operand bytes (sting id, maybe an explicit duration) read via the same `[script_ptr_lo],y` shape, stored to new `$0300+` scratch; non-suspending like Turn/Visible; re-arms `sfx_ptr_lo/hi`/`sfx_left` unconditionally, which is what makes a second sting replace the first with no extra guard |
| gate check inside `music_tick_loop`/`music_channel` | ~15-20 | kernel-lo | `cpx #SFX_CHANNEL`(2)+`bne normal`(2)+`lda sfx_left`(3, absolute)+`beq normal`(2)+`jsr sfx_channel_tick`(3)+`jmp music_channel_done`(3) — **gated `.if SFX_ENABLED`, so a project with no live sting pays 0 of this** |
| `sfx_channel_tick` — its own dedicated reader (fixed volume, no instrument/envelope) | ~40-70 | kernel-lo | a small, self-contained note+duration reader and APU writer, not a reuse of `music_read_event`/`music_apply` |
| hand-back on completion | ~10-13 | kernel-lo | clear `sfx_left`; `lda #1`/`sta force_trig,x` (the shared mechanism above, not an inline `mus_trig` write that `music_channel`'s own clear would erase) |
| `music_play` cancellation check, `A`-preserving (shared mechanism above) | 12 | kernel-lo | this candidate's own copy of the corrected check — a same-map screen redraw never calls `set_music`/`music_play` at all (`apply_map_music` only calls it when the destination's map differs from `cur_map`), so this and the `music_stop` row below are the *entire* cancellation surface, not a Flash-style `vram_reset` hook |
| `music_stop` sting-state clear (shared mechanism above) | 3 | kernel-lo | closes the `init_session` bypass |
| dispatch entry | 7 | kernel-lo | precedent |
| shared `force_trig` mechanism (above) | ~15 | kernel-lo | shared with shape (b); priced once here as this candidate's own share of it |
| compiled sting stream(s) | tens of bytes, author-controlled, ≥ its own small pointer/loop-jump floor | **kernel-hi**, not kernel-lo | its own compiler path, not `compileSong`/`songTables` reuse |
| **headline: shape (a)** | **~122-165 kernel-lo** | | plus kernel-hi data, separately budgeted; plus ~6-8 bytes of `$0300+` RAM (`sfx_ptr_lo/hi`, `sfx_dur`, `sfx_left`) + the shared 4-byte `force_trig` array |

#### (b) Interrupt-and-resume (whole song pauses, sting plays alone, song resumes where it left off)

Shadowing and restoring the six per-channel RAM arrays puts the *bookkeeping* back, but — the same
gap the shared fix above closes — the APU's actual period/volume registers are not rewritten just
because the RAM that describes them was restored; all four channels need the `force_trig`
treatment, not a bare copy-back. Separately, if the state being restored is **Silence**
(`mus_enabled = 0`), simply restoring that flag leaves the sting's own last written APU values
latched forever — `music_tick`'s very first line (`lda mus_enabled / beq music_tick_done`) means
nothing will ever touch `$4000-$400F` again once `mus_enabled` goes back to 0. Restoring a state of
*Silence* therefore has to explicitly re-silence the hardware (the same four writes `music_stop`
already makes: `$30` to `$4000`/`$4004`/`$400C`, `0` to `$4008`) before restoring `mus_enabled = 0`.

**Cancellation and second-sting policy.** Same minimum viable policy as shape (a): a second sting
replaces the first outright. Unlike shape (a), this shape *does* shadow the whole song, so the
policy needs one more guard the review named explicitly: **the snapshot is only taken when no
sting is already active** (`sting_left == 0` at trigger time) — a second sting arriving mid-first
must not re-snapshot over the already-shadowed real song state with the *first* sting's own state.
The ordering `script_op_sting` needs, made concrete: **snapshot (only if not already mid-sting) →
call `music_play(stingIndex)` → arm `sting_left`.** `music_play` is called *after* the snapshot so
the shadow captures the real song's state, not the sting's; `script_op_sting`'s own call into
`music_play` harmlessly triggers the same top-of-routine cancellation check shape (a) needs
(zeroing `sting_left` as a side effect, since a fresh arm follows immediately after) — this is the
"snapshot, canceling play, arm" order the review asked for, and it is free: no extra bytes beyond
what the trigger row and the shared cancellation check already price.

| routine | bytes | bank | basis |
|---|---|---|---|
| shadow-save all 4 channels' state before switching | ~13 | kernel-lo | the 6 per-channel arrays (`mus_ptr_lo/hi`, `mus_dur`, `mus_inst`, `mus_step`, `mus_note`, confirmed contiguous from `$0340`) are a 24-byte contiguous block, so one indexed loop copies all of it: `lda mus_ptr_lo,x`(3)+`sta shadow,x`(3)+`inx`(1)+`cpx #24`(2)+`bne`(2) |
| shadow-restore (plain copy-back — the retrigger no longer lives here) | ~13 | kernel-lo | mirror of the save loop above |
| force-retrigger all 4 channels via the shared mechanism | ~12-14 | kernel-lo | `ldx #0`/loop: `lda #1`(2)+`sta force_trig,x`(3)+`inx`(1)+`cpx #4`(2)+`bne`(2) — a small loop, not four unrolled stores |
| `cur_song`/`mus_enabled` save+restore, plus explicit hardware silencing when the restored state is Silence | ~30-35 | kernel-lo | 2 bytes each direction for the flags themselves (~15) + a conditional call to a small shared silence routine (4 register writes, ~15-20, reusable by `music_stop` itself rather than duplicated) when the saved `mus_enabled` was 0 — this branch was already correct in the prior draft |
| `sting_left` countdown (top-level, not per-channel) | ~15 | kernel-lo | `lda sting_left`(3)+`beq skip`(2)+`dec sting_left`(3)+`bne skip`(2)+`jsr resume_song`(3) — **also `.if SFX_ENABLED`-gated** |
| `script_op_sting` trigger, **with the "skip snapshot if already mid-sting" guard** | ~25-30 | kernel-lo | reuses `music_play` unmodified for the actual sting playback; `lda sting_left`(3)+`bne skip_snapshot`(2) added before the existing snapshot block |
| `music_play` cancellation check, `A`-preserving (shared mechanism above) | 12 | kernel-lo | this candidate's own copy of the corrected check — same single choke point as shape (a); a request for the song already playing is a `set_music`-level no-op, not a cancel (corrected policy above); no separate redraw-path glue needed since `apply_map_music` only calls `set_music` on an actual map change |
| `music_stop` sting-state clear (shared mechanism above) | 3 | kernel-lo | closes the `init_session` bypass — the real, audible bug this shape has if skipped: a stale shadow would eventually restore the *previous* session's own song state over a freshly-silenced new session |
| dispatch entry | 7 | kernel-lo | precedent |
| shared `force_trig` mechanism (above) | ~15 | kernel-lo | this candidate's own share of the shared check |
| **headline: shape (b)** | **~145-157 kernel-lo** | | 13+13+(12-14)+(30-35)+15+(25-30)+12+3+7+15 — the headline is the exact component sum; plus kernel-hi sting data (the full 28-byte floor legitimately applies here — shape (b) plays a real multi-channel sting alone, unlike shape (a)'s single stolen channel); plus ~28-30 bytes of `$0300+` RAM (24-byte shadow + `cur_song`/`mus_enabled`/`sting_left`) + the shared 4-byte `force_trig` array |

#### (c) Sting-as-song with scripted restore

`[OP_MUSIC, stingIndex]`, then `[OP_WAIT, N]`, then `[OP_MUSIC, songIndex]` in an event page.
`OP_MUSIC` is unconditional, but `OP_WAIT` is not: `engine/script.asm:192-197` and
`engine/entities.asm`'s `wait_tick` are both wrapped `.if WAIT_ENABLED`, gated by
`projectUsesWait` (`main/build/generate.js:638,681`), and `WAIT_KERNEL_ALLOWANCE` is a real,
already-measured 48 kernel-lo bytes (Part 1's own table). This costs **48 kernel-lo bytes** for a
project whose only reason to turn Wait on would be this sequence, and **0 marginal kernel-lo** when
Wait is already live for an unrelated reason (every "ALL 7 shipped verbs" row in Part 1, say).

**Is this a new command, or a documented recipe using existing commands? — priced both ways.**
- **Reading 1: no feature work, a documented authoring pattern.** An author manually sequences
  three existing, already-shipped opcodes. Kernel-lo cost is exactly the conditional 0-or-48 above
  and nothing else; there is no new command to add to `IMPLEMENTED_COMMANDS`, no new schema/
  normalization/compiler/editor case.
- **Reading 2: a first-class Sound Sting command that lowers to the same three opcodes.** Costs the
  identical 0-or-48 kernel-lo, but is not free elsewhere: it needs `IMPLEMENTED_COMMANDS`/schema/
  `normalizeEntity`/`textcompile.js` coverage and a Map Forge editor case (Flash's own §8 precedent
  — cheap, "a case in the summary function," not costed further here since it is not a kernel-lo
  number) so the author gets one authored step instead of three, with the engine-side Wait-duration
  figured out for them rather than hand-tuned.

Cost is otherwise entirely kernel-hi under either reading (the sting is just another compiled song,
using `compileSong`/`songTables` completely unmodified — the one shape in this report that
genuinely needs no new format) plus authoring friction under reading 1 specifically: the author must
hand-tune the Wait to the sting's real length, must know and re-specify which song was playing
before (no automatic "whatever was playing" resume), and the resumed song always restarts from its
own beginning rather than continuing from where it was cut off.

#### What each shape does to the three-times-implemented format, and the test's real scope

- **Shape (c)** needs **zero changes** to `shared/audio.js`, `main/build/songcompile.js`, or
  `renderer/forges/sound/replayer.js` under either reading above. A sting is indistinguishable from
  an ordinary song to every one of the three; `music.test.js`'s register-identity diff needs no
  change either, because nothing about what gets written to `$4000-$400F` or when is new.
- **Shapes (a)/(b).** `test/unit/music.test.js:172-240` boots the checked-in `sample` project,
  compiles its ordinary song, and diffs 150-200 frames of the ROM's *actual, untouched boot song*
  against `Replayer` — it never authors, triggers, or executes a sting at all. An engine sting
  implementation that writes completely wrong APU values the moment a sting actually fires would
  still pass this exact test unmodified, because the test never puts the ROM in a state where a
  sting is playing — **this test's current scope does not force any `Replayer` work.** `Replayer`'s
  own API also only accepts one compiled song and models no map event or second, simultaneous
  playback context. Both shapes could also reuse the existing per-channel song byte format unchanged
  if the format question above were resolved the other way — the new behavior is driver
  *scheduling*, not necessarily a new wire format.

  What is actually needed: **independent behavioral coverage of a real sting and its interruption/
  resume timing** — a test that boots a ROM with a live sting authored into it and asserts the real
  APU register sequence against a hand-computed expected timeline. Extending both the ROM driver and
  `Replayer` together and cross-checking them against *each other* risks the matched-pair hole this
  codebase's own reviewer-role brief warns about. Whether `Replayer` gains sting support at all is a
  **preview product decision**, not something this test's existing scope requires.

### Kernel-hi and RAM costs, both candidates — not measured in Part 1

| candidate | kernel-hi (per occurrence / fixed) | new `$0300+` RAM |
|---|---|---|
| visual-only tile change | 4 event bytes (opcode+col+row+metatile) | 4 bytes: `til_pending` plus the 3 operand bytes (`til_col`, `til_row`, `til_mt`) the 24-byte operand-read row already prices as new `$0300+` stores — corrected this round to agree with that row rather than omit them |
| visual-only + attribute overlay | same 4 event bytes, plus the 64-byte `mt_palette` table (kernel-lo data, already counted in the 269-307 figure) | +64 bytes (attribute shadow), on top of the 4 bytes above |
| persistent tile change | 4 event bytes, same shape | 33 bytes (8×4 override table + `ov_next`), plus the same 4 bytes visual-only needs |
| sting (a) | its own small compiler path, no fixed per-song floor the way a full song has (single-channel format) — tens of bytes, author-controlled | ~6-8 bytes (`sfx_ptr_lo/hi`, `sfx_dur`, `sfx_left`) + shared 4-byte `force_trig` |
| sting (b) | full `songTables` floor legitimately applies — **28 kernel-hi bytes minimum** per sting, plus author content | ~28-30 bytes (24-byte channel-state shadow + `cur_song`/`mus_enabled`/`sting_left`) + shared 4-byte `force_trig` |
| sting (c) | 6 event bytes (`OP_MUSIC`×2 + `OP_WAIT`) + one full extra compiled song at the **28-byte floor**, plus author content | 0 new |

Kernel-hi has its own real, independent capacity check (`musicBytes + text.bytes > BANK_SIZE - 64`)
and `$0300+` RAM has a real, finite allocation map; this report has not measured representative
headroom on either, on any board, for any of these numbers to be checked against. See Open
Questions.

---

## Part 3 — fit matrix (kernel-lo only)

**This matrix answers "does the kernel-lo bank have room," nothing else.** A candidate that fits
every row below can still be blocked by kernel-hi or `$0300+` RAM headroom this report has not
measured (see the table just above) — "fits" in this section is not the same claim as "ships."

Recomputed mechanically from `(low, high, free)` per candidate and configuration, from the round 2
corrected ranges — a small script (kept in this session's scratchpad, not committed) applied the
rule stated here to every cell:

- **FITS** when `free ≥ high` (the candidate's own worst case still leaves room).
- **borderline** when `low ≤ free < high` (whether it fits depends on where in the priced range the
  real implementation lands).
- **NO FIT** when `free < low` (even the candidate's cheapest realistic implementation overflows).
- **already broken** when the configuration itself is already refused today (`free < 0`), independent
  of anything this report is costing.

Rows where every candidate FITS comfortably are collapsed to one summary line per board, to keep
the table readable; the full 26-row × 10-candidate mechanical output is not reproduced here but
every number in it is derived the same way as the rows shown.

| configuration (signed free) | visual-only tile (160-178) | visual-only + attr overlay (269-307) | persistent, cosmetic (258-315) | persistent, +collision (283-350) | persistent, +save (300-374) | persistent, +collision+save (325-409) | sting (a) (122-165) | sting (b) (145-157) | sting (c) (0 or 48) |
|---|---|---|---|---|---|---|---|---|---|
| MMC3 Save+Move+item (−11) | already broken | already broken | already broken | already broken | already broken | already broken | already broken | already broken | already broken |
| **MMC3 Save+Move, no item (+88)** | **NO FIT** | NO FIT | NO FIT | NO FIT | NO FIT | NO FIT | **NO FIT** | NO FIT | FITS |
| MMC3 Save only, w/ item (+404) | FITS | FITS | FITS | FITS | FITS | borderline | FITS | FITS | FITS |
| MMC3 ALL verbs+Move+item, no Save (+289) | FITS | borderline | borderline | borderline | NO FIT | NO FIT | FITS | FITS | FITS |
| MMC3 ALL verbs+Save+Move+item (−507) | already broken | already broken | already broken | already broken | already broken | already broken | already broken | already broken | already broken |
| MMC1 Save+Move+item (+220) | FITS | NO FIT | NO FIT | NO FIT | NO FIT | NO FIT | FITS | FITS | FITS |
| MMC1 Save+Move, no item (+299) | FITS | borderline | borderline | borderline | NO FIT | NO FIT | FITS | FITS | FITS |
| MMC1 ALL verbs+Save+Move+item (−296) | already broken | already broken | already broken | already broken | already broken | already broken | already broken | already broken | already broken |
| UNROM 512 Save+Move, no item (−88) | already broken | already broken | already broken | already broken | already broken | already broken | already broken | already broken | already broken |
| UNROM 512 Save only, w/ item (+239) | FITS | NO FIT | NO FIT | NO FIT | NO FIT | NO FIT | FITS | FITS | FITS |
| UNROM 512 ALL verbs+Move+item, no Save (+279) | FITS | borderline | borderline | **NO FIT** | NO FIT | NO FIT | FITS | FITS | FITS |
| every other measured row (MMC3/MMC1/UNROM 512 baselines, Move+item-no-Save, ALL-verbs-only; MMC1 Save-only/Move+item/ALL-verbs+Move+item; UNROM 512 Move+item-no-Save/ALL-verbs-only; both action boards) | FITS | FITS | FITS | FITS | FITS | FITS | FITS | FITS | FITS |

**The central finding stands, and is now reinforced rather than reversed.** MMC3's own
Save+Move-no-item configuration has exactly 88 bytes free; every priced candidate's own *lower*
bound (160 for visual-only tile, 122/145 for sting (a)/(b)) clears it, so all three create a clean
**NO FIT** on this one currently-building configuration — the same reversal round 1 of this report
established, now confirmed against corrected, higher-fidelity ranges rather than weakened by them.

**Restated per candidate, from the corrected matrix:**

- **Sound sting shape (c)**: still the only candidate that creates no new refusal anywhere in the
  matrix — 0-or-48 kernel-lo cannot push anything over that free space of at least 88 could not
  already absorb (the smallest positive `free` value measured in Part 1).
- **Visual-only tile change (same-palette-constrained)**: creates exactly one new refusal in this
  matrix (MMC3 Save+Move-no-item) and otherwise fits every other measured configuration cleanly —
  its own 160-178 range is narrow enough that no row lands in the "borderline" band. This is the
  headline reached by the correctly-priced two-phase suspend, which drains one Tile every two
  main-loop iterations rather than one per iteration — see Part 2 for that honesty correction; it
  changes authoring throughput, not this fit-matrix conclusion.
- **Visual-only tile change with a real attribute overlay**: no longer in a materially different
  risk class from persistent tile change's own cosmetic-only variant — the corrected 269-307 range
  produces the **identical** fit pattern across this whole matrix as persistent, cosmetic (borderline
  on the same three rows, NO FIT on the same three rows). The two variants price out to almost the
  same risk once the arithmetic is corrected, which was not visible under the earlier, inflated
  365-420 figure.
- **Sound sting shapes (a)/(b)**: create the same one new refusal as visual-only tile change on
  MMC3's Save+Move-no-item row, and otherwise fit every configuration that was not already broken —
  the corrected `music_play`/`music_stop` cancellation lifecycle raised both headlines slightly
  (shape (a) to 122-165, shape (b) to 145-157) but did not change which rows fit; shape (b) in
  particular still fits MMC1's Save+Move+item row (220 free) with real margin (63-75 bytes spare).
- **Persistent tile change, any variant**: the corrected costs (258-409) fail to fit **every**
  RPG-capable configuration this report measured except the loosest ones (baseline, Save-only,
  Move-only-no-Save) — including MMC1's own Save+Move+item row, which every *other* candidate in
  this matrix still fits. The `+collision` variant is now also a clean NO FIT (not borderline) on
  UNROM 512's own ALL-verbs+Move+item-no-Save row (279 free against a 283-350 range) — a further,
  small tightening from the corrected visual-only base this variant is built on. The `+save` variant
  is a clean **NO FIT** on MMC3's own ALL-verbs+Move+item-no-Save row (289 free against a 300-374
  range), a real, if modest, further degradation from the added save-validation cost; the
  `+collision+save` variant now even
  turns MMC3's own comfortable Save-only-w/-item row (404 free) borderline. This remains the
  candidate most likely, by a wide margin, to become a new documented limitation the moment it is
  combined with a project that also carries Save+Move.

---

## Part 4 — open questions the costing cannot settle

1. **Tile change — does a persistent change need to survive Continue (a save), or only a warp/
   battle-return within the current session?** This remains the single largest cost lever in this
   report: ~258-315 (session-only, cosmetic) vs. up to ~325-409 (collision-affecting and
   save-serialized). A `SAVE_LAYOUT_VERSION` bump is required *only* if the overlay is actually
   serialized — a session-only overlay never touches the save record at all and needs no version
   bump. When it does apply, it still unconditionally breaks every prior save on this build the
   moment it ships, regardless of whether a given project uses tile change — a decision with real
   player-facing cost, not just a kernel-lo one.
2. **Tile change — does a persistent change need to affect collision?** A real gameplay-design
   question (can a scripted tile change trap the player, or open a path, mid-event), not just a
   pricing one, and it costs ~25-35 bytes on a routine (`probe_type`) called from the hottest path
   in the engine.
3. **Tile change — how many concurrent persistent overrides does the feature actually need?**
   This report costed N=8 as a working number; the RAM cost (4N+1 bytes of `$0300+`) scales linearly
   and this report has no measured `$0300+` budget to check it against — that RAM headroom is a
   genuinely separate, unmeasured resource from every number in Part 1's table, and this costing
   pass cannot say how much of it is actually free on any board.
4. **Tile change — does the Map/Tile Forge constrain which metatiles are legal tile-change
   targets to the target cell's existing palette group** (0 extra engine bytes, real UI/validation
   work not scoped here; this is the assumption this report's headline visual-only/persistent
   numbers use), **or does the engine pay for a real attribute-shadow overlay** (roughly +109-129
   kernel-lo and +64 bytes of new `$0300+` RAM — corrected this round from an earlier, materially
   larger estimate — now close enough to persistent tile change's own cost class that the two
   candidates' risk profiles largely converge)?
5. **Tile change — is Tile available inside a common event at all, and if so, how does the
   Map/Tile Forge enforce the same-palette constraint when one compiled common event can be called
   from actors on different screens with different original palette groups at the same authored
   row/column?** The zero-engine-byte constrained-authoring branch this report's headline assumes
   is not coherent for that authoring surface as stated; a product restriction (Tile unavailable in
   common events), a conservative all-call-sites validation rule, or the paid attribute-overlay
   branch are the three live answers, and none is designed here.
6. **Tile change — is the two-frame-per-Tile throughput of the priced two-phase suspend acceptable,
   or does the product want one Tile per frame?** This report's headline numbers assume the
   two-phase design as priced (correct, but draining one Tile every two main-loop iterations, not
   one per iteration — see Part 2); recovering one-per-frame throughput needs the 1→2 promotion
   moved to an end-of-frame handshake point, which is different code this report has not priced. A
   cheaper design in the other direction — silently dropping a same-frame second Tile, or capping
   consecutive Tile commands at compile time (`checkCapacity`) — trades authoring flexibility for a
   smaller suspend/resume mechanism.
7. **Persistent tile change — what happens when all N override slots are occupied and a new,
   distinct one is requested?** This report's headline assumes round-robin eviction (priced above,
   folded into the find-or-allocate cost); silently refusing the new change, or refusing loudly in
   a way the author can observe (there is no runtime error channel a script can surface today), are
   both real, differently-costed alternatives.
8. **Sound sting — which of the three shapes does the user actually want?** These are not just
   three price points on the same feature: (a) layers a burst over the running song at the cost of
   one channel briefly; (b) silences the whole song briefly and resumes it exactly where it left
   off; (c) costs 0-48 kernel-lo but requires the author to manually re-trigger the prior song from
   its own beginning with a hand-tuned Wait (or, under reading 2, lets the compiler compute that
   Wait automatically, at no extra kernel-lo cost, in exchange for real but uncosted compiler/editor
   work). The user experience differs meaningfully between them in a way this report's numbers alone
   cannot resolve.
9. **Sound sting shapes (a)/(b) — for channel steal specifically, does the stolen channel pause
   (freezing its own note-timing until handed back, this report's assumption) or advance silently
   in the background (staying rhythmically synchronized with the other three channels at the cost of
   losing whatever time it spent stolen)?** Both are real, differently-costed designs; this report
   prices the "pause" reading only.
10. **MMC1's Save+Move+item combination no longer has real margin once every shipped verb is also
    live** (Part 1: 483 free with all verbs and no Save, but the ALL-verbs-plus-Save-Move-item
    combination itself refuses by **296 bytes**) — a finding from this costing pass, not previously
    documented, and independent of whether either candidate ships. Worth deciding whether this
    should be logged as its own documented limitation regardless of what happens next.
11. **UNROM 512's Save+Move shortfall does not close by dropping the item** (still 88 short with no
    item at all, vs. MMC3's identical combination which does close by dropping the item) — an
    asymmetry between the two boards' own documented limitations that this report surfaced but did
    not previously exist in CLAUDE.md's prose.

---

## Round 1 revisions

Applied against `handoff-costing/costing-review1.md`'s 11 findings (six high). Summary of what
moved and why; Part 1 is unchanged throughout.

- **Finding 1 (fit matrix, high).** The matrix was recomputed mechanically from every candidate's
  corrected `(low, high)` against Part 1's own signed `free` figures, per the rule stated at the top
  of Part 3, rather than hand-classified. The central conclusion **reverses**: visual-only tile
  change and sound sting shapes (a)/(b) do create a new refusal, on MMC3's Save+Move-no-item
  configuration — the original round's claim that neither candidate created a third documented
  limitation was wrong on the report's own numbers.
- **Finding 2 (shape (c) Wait gating, high).** Corrected from "0 kernel-lo" to "48 kernel-lo when
  Wait is not already live elsewhere in the project, 0 marginal when it is." Added the "documented
  recipe vs. first-class command" fork, priced both readings.
- **Finding 3 (visual tile-change producer bound, high).** Added the missing correctness
  requirement — Tile must suspend for one frame per occurrence, the same "frozen world" shape
  Move/Wait/Fade already use.
- **Finding 4 (packet-write arithmetic, medium).** Rewrote the write-one-metatile row
  instruction-by-instruction: 22 bytes per packet (not 16), 44 for two packets (not 32).
- **Finding 5 (runtime attribute handling, high).** Replaced a claim that relied on a PPU read
  `vram_buf` cannot perform. Two branches priced separately: same-palette-constrained authoring (0
  engine bytes) or a real attribute-shadow overlay.
- **Finding 6 (save serialization and missing persistent machinery, medium).** Replaced "two new
  20-30 byte serialization loops" with the real mechanism — `engine/save.asm`'s existing table-driven
  `save_write_body`/`load_apply_body` — and added the genuinely missing pieces: `init_session`
  clearing all override slots, a round-robin slot-full eviction policy, and range validation.
- **Finding 7 (sting shapes (a)/(b) correctness, high).** Rewrote both shapes' state-restoration
  sketches for the stale-pitch and ringing-forever bugs, folded the previously-excluded
  cancellation cost into both headlines. (Round 2 found the retrigger fix itself did not survive
  `music_channel`'s own clear — see below.)
- **Finding 8 (forced-replayer-work claim, high).** Removed; replaced with an accurate account of
  `music.test.js`'s real scope.
- **Finding 9 (unpriced kernel-hi/RAM, medium).** Added a dedicated kernel-hi/RAM subsection for
  every candidate and labeled Part 3's matrix "kernel-lo only" throughout.
- **Finding 10 (open question 7's 167 → 296, medium).** Corrected in place.
- **Finding 11 (missing decision questions, medium).** Added four open questions the review named.

## Round 2 revisions

Applied against `handoff-costing/costing-review2.md`'s 7 findings (four high).

- **Finding 1 (Tile's suspend could resume same-frame, high).** The round 1 single-flag
  `til_pending` design does not work: an interact-triggered event runs `ui_tick` on the *same*
  frame `script_op_tile` armed it (`main_loop`'s real order is `settle_owed → dispatch_input →
  ui_tick → main_loop_draw`, confirmed against `engine/boot.asm`), so a naive flag would resume —
  and could queue a second packet — before any NMI had drained the first. Replaced with a two-phase
  armed state (`til_pending`: 0 idle, 1 armed-this-call, 2 safe-to-resume), which forces at least
  one real `wait_vblank` between any two Tile-originated packet queues. Raised the suspend/resume
  subtotal from ~25-30 to ~30-38 bytes, and the visual-only headline from ~150-180 to ~155-181.
  Added the byte/cycle accounting the finding asked for: Tile's own two small packets sharing an
  NMI with Flash's one packet cost ~46 bytes of `vram_buf` and an estimated ~1300-1380 cycles
  against the ~2273-cycle window — both figures computed fresh from `vram_drain`'s own instruction
  stream, not claimed covered by the old two-packet measurement.
- **Finding 2 (retrigger fix erased by `music_channel`'s own clear, high).** Confirmed directly:
  `engine/music.asm:127-129` clears `mus_trig,x` at the top of every `music_channel` call, before
  `music_apply` runs, so a flag set during hand-back and then skipped past (shape (a)) or restored
  before the next tick (shape (b)) is wiped before it is ever read. Replaced with a shared, second
  `force_trig` array checked *after* the ordinary clear and self-clearing on use — priced once
  (~15 kernel-lo bytes + 4 RAM bytes) and reused by both shapes' own hand-back logic. Re-priced
  shape (a) (107-162 → 115-162) and shape (b) (125-145 → 143-155) from this corrected flow.
- **Finding 3 (attribute-overlay sum, high).** The stated components (64 data + 15-20 code + 30-45
  code) sum to 109-129 kernel-lo, not the previously claimed 215-240 — an arithmetic error that
  effectively double-counted roughly another full visual implementation without naming what it was
  for. Corrected; visual-only tile change plus the attribute overlay now totals ~264-310 kernel-lo
  (not 365-420), and every Part 3/Part 4 statement that placed this branch in persistent tile
  change's own risk class was recomputed — it turns out to land almost exactly there anyway, on
  the corrected, much lower number, which the matrix now shows directly rather than asserts.
- **Finding 4 (validation rejects `NO_SCREEN` slots, high).** The save-validation sketch checked
  every slot's `screen < NUM_SCREENS` unconditionally, which would reject `init_session`'s own
  `NO_SCREEN` sentinel on every normal, partially-filled save — killing Continue outright. Added
  the accept/skip branch (`cmp #NO_SCREEN` / `beq` past the row/col/metatile checks) to the
  instruction sketch, raising the validation estimate from ~35-50 to ~39-56 bytes (+42-59 total
  with the 3-byte descriptor, was +38-53), and propagated through every persistent `+save` figure.
- **Finding 5 (sting lifecycle still unpriced, medium).** Replaced the generic, unnamed "+15-25
  cancellation glue" with one concrete minimum viable policy for both shapes: a second sting always
  replaces the first outright; shape (b) additionally skips its own snapshot when a sting is already
  active, so it never overwrites the real song's shadow with a sting's own state; `music_play` is
  the single choke point that cancels an in-flight sting on any external Play-music or map-change
  call, with the "snapshot, canceling play, arm" ordering made explicit. Corrected the mistaken
  Flash/`vram_reset` analogy: a same-map screen redraw never calls `set_music`/`music_play` at all,
  so no separate redraw-path glue is needed — the fix is entirely inside `music_play` itself
  (~8-12 bytes for shape (a), ~10 bytes plus a ~5-byte trigger-side guard for shape (b)), cheaper
  than the round 1 estimate it replaces.
- **Finding 6 (common events break the same-palette constraint, medium).** Added the missing
  restriction: the constrained-authoring branch has no single "target cell's palette" to validate
  against when a Tile command lives in a common event callable from multiple screens. Named the
  three live answers (Tile unavailable in common events; conservative all-call-sites validation;
  the paid attribute-overlay branch) and added it to Open Questions rather than assuming one.
- **Finding 7 (150-180 vs. component sum of 173, low).** The displayed visual-only components
  summed to 150-173, not 150-180 — folded into the finding 1 rework above; the new headline
  (~155-181) is now the exact, unpadded sum of its own listed components.

## Round 3 revisions

Applied against `handoff-costing/costing-review3.md`'s 4 findings (one high) — the closing round;
all four were verified directly against source before pricing a fix.

- **Finding 1 (Tile throughput + subtotal, medium).** Confirmed by tracing the two-phase state
  machine frame by frame: when `tile_tick` resumes a script whose next command is another Tile, the
  new command's own `til_pending = 1` is set and returned from *within the same `ui_tick` call* that
  just resumed, so the *next* main-loop iteration only promotes `til_pending` from 1 to 2 (even
  though the real NMI drain it was waiting for already happened that iteration) — the script does
  not actually reach the following command until the iteration after that. Consecutive Tile commands
  therefore drain one every **two** main-loop iterations, not one per iteration as the prior round
  claimed; corrected the prose to state this honestly rather than re-engineer the state machine, and
  named the (unpriced) end-of-frame-promotion alternative a later design pass could use to recover
  one-per-frame throughput. Fixed the suspend/resume subtotal to the exact sum of its own rows —
  5 (set flag) + 1 (the `rts` the tail needs, previously omitted) + 8 (chain entry) + 21 (`tile_tick`)
  = **35**, not a 30-38 range — and propagated the +5-net change through the visual-only headline
  (155-181 → 160-178) and every figure downstream of it (the attribute-overlay total, every
  persistent-tile combination, and the fit matrix).
- **Finding 2 (cancellation lifecycle, high).** Confirmed directly: `music_play` (`engine/music.asm`)
  opens with `sta cur_song`, so the sketched top-of-routine cancellation check (`lda sfx_left`/
  `sting_left`, then `lda #0` on the active path) clobbered the song-index argument in `A` before
  `sta cur_song` ever ran — a non-working sequence. Re-sequenced: the check now runs *after*
  `sta cur_song`, wrapped in `pha`/`pla` to preserve `A` across it (+2 bytes, fixed at 12 total, not
  a range). Corrected the overclaimed policy: `set_music` returns before ever reaching `music_play`
  when the requested song already equals `cur_song`, so a Play-music command or map change naming
  the *same* song a channel-steal sting is built on does not cancel it — named this as the actual,
  correct policy ("same song is already a no-op in `set_music`, not a cancellation case") rather than
  the prior "any Play-music or map-change call cancels" overclaim. Closed the `init_session` bypass
  the review found (`engine/combat.asm:105-108` calls `music_stop` directly, never through
  `music_play`): added a 3-byte `.if SFX_ENABLED` clear inside `music_stop` itself, reusing the `A=0`
  already loaded for `mus_enabled` just above it — cheaper than constructing a harmlessness proof,
  and correct for shape (b)'s real bug (a stale shadow could otherwise restore a *previous* session's
  song state over a freshly-silenced new one). Both fixes are priced once as a shared mechanism and
  included in both shapes' own headlines: shape (a) 115-162 → 122-165, shape (b) 143-155 → 145-157.
- **Finding 3 (shape (b) headline vs. sum, low).** The displayed 143-155 was not the exact sum of
  its own rows (approximately 140-152 before finding 2's fixes). Recomputed with finding 2's
  corrected cancellation-check (+2) and the new `music_stop` clear (+3) folded in: the headline is
  now the exact component sum, 145-157, stated as such in the table rather than left to be
  independently re-derived.
- **Finding 4 (operand RAM inconsistency, medium).** The 24-byte operand-read row already priced
  three `sta` instructions to new `$0300+` bytes for col/row/metatile, but the kernel-hi/RAM summary
  table listed only the 1-byte `til_pending` for visual-only tile change — the two could not both be
  right. Kept the existing instruction arithmetic (new `$0300+` bytes, 3-byte absolute stores, no
  change to the priced 24-byte row) and corrected every RAM table to list all 4 bytes
  (`til_pending`, `til_col`, `til_row`, `til_mt`) rather than 1, including the persistent-tile
  variant's own reference to the same shared state.

**Net effect on the fit matrix**, recomputed mechanically from the corrected ranges: the central
finding (visual-only tile change and both sting shapes create a new refusal on MMC3's own
Save+Move-no-item row) is unchanged and, if anything, reinforced by the corrected — and generally
higher — lower bounds. Two further cells moved, both tightening: `persistent +collision` is now a
clean NO FIT (was borderline) on UNROM 512's own ALL-verbs+Move+item-no-Save row, and `persistent
+save` is now a clean NO FIT (was borderline) on MMC1's own Save+Move-no-item row (299 free against
the new 300-374 range) — both a small additional tightening from the corrected visual-only base
every persistent variant is built on. No other classification in the matrix changed.
